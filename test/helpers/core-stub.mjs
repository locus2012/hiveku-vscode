/**
 * A local stand-in for core.hiveku.com/mcp and the web edge in front of it
 * (HK-847), shared by test/core-edge-gzip.test.mjs and
 * test/edge-refusal-readers.test.mjs. It answers on 127.0.0.1 only: no request
 * reaches a live host, and nothing here is an attack-shaped string (the stub
 * refuses on a marker of its own). Hiveku's own refusals are replayed as
 * hiveku-mcp-api-server sends them. Not a test file itself.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readRequest } from './request-body.mjs';

export const RAY = '8f1c2d3e4f5a6b7c-SJC';
/** The stub refuses a tools/call whose arguments hold this. Not an attack string: a label. */
export const REFUSE_MARKER = 'stub-edge-refuses-this';

/* ── what core and the edge send ─────────────────────────────────────────── */

/**
 * hiveku-mcp-api-server src/middleware/mcp-auth.ts at origin/main: a revoked
 * or unknown key (401, with WWW-Authenticate) and a key used for another
 * account (403), both as res.status(status).json({ jsonrpc: '2.0', id, error:
 * { code: -32001, message } }).
 */
export const REVOKED_KEY_MESSAGE =
  'Invalid or inactive API key. Verify the key in your Hiveku dashboard ' +
  "(Settings → API & Connectors) and confirm it's active. If you rotated the " +
  "key, update .mcp.json (or your client's env) and restart the MCP client.";
export const OTHER_ACCOUNT_MESSAGE = 'API key does not belong to the specified account';

export function coreAuthRefusal(status, id, message) {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Every answer through core's zone carries a ray id, Hiveku's own too:
      // a cf-ray header alone never makes an answer the edge's.
      'cf-ray': RAY,
      ...(status === 401
        ? { 'www-authenticate': 'Bearer realm="hiveku-mcp", resource_metadata="https://core.hiveku.com/.well-known/oauth-protected-resource/mcp"' }
        : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: id || null, error: { code: -32001, message } }),
  };
}

/** hiveku-mcp-api-server src/middleware/rate-limiter.ts rateLimitMiddleware's 429, with a one-second wait. */
export function coreRateLimit(id) {
  return {
    status: 429,
    headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '1', 'cf-ray': RAY },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: id || null,
      error: {
        code: -32000,
        message: 'Rate limit exceeded. Maximum 100 requests per 60 seconds. Retry after 1 seconds.',
        data: { kind: 'rate_limit', retry_after_seconds: 1, limit: 100, window_seconds: 60 },
      },
    }),
  };
}

/** The edge's block page, in the shape seen on 2026-10-28: HTML, titled "Blocked". */
export const BLOCK_PAGE = {
  status: 403,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cf-ray': RAY },
  body:
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Blocked</title></head>' +
    '<body><h1>Blocked</h1><p>This request was blocked.</p></body></html>',
};

/** The edge turning a request away on 429, with a Retry-After of its own: still never slept on. */
export const EDGE_429_PAGE = {
  status: 429,
  headers: { 'content-type': 'text/html', 'cf-ray': RAY, 'retry-after': '1' },
  body: '<html><title>Too many requests</title></html>',
};

/** Bodies that are not Hiveku's JSON-RPC error. */
export const NOT_HIVEKU = [
  BLOCK_PAGE.body,
  '',
  '   ',
  'Forbidden',
  '[]',
  'null',
  JSON.stringify({ error: { code: -32001, message: 'no jsonrpc member' } }),
  JSON.stringify({ jsonrpc: '2.0', error: 'a string' }),
  JSON.stringify({ jsonrpc: '2.0', error: { code: '403', message: 'code is not a number' } }),
  JSON.stringify({ jsonrpc: '2.0', error: { code: 1.5, message: 'code is not whole' } }),
  JSON.stringify({ jsonrpc: '2.0', error: { code: -32001 } }),
  JSON.stringify({ jsonrpc: '2.0', result: {} }),
];

/* ── the stub ────────────────────────────────────────────────────────────── */

export function defaultAnswer(rpc) {
  if (rpc?.method === 'initialize') {
    return {
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': 'stub-session' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'stub', version: '0' } } }),
    };
  }
  if (rpc?.method === 'notifications/initialized') return { status: 204, headers: {}, body: '' };
  if (rpc?.method === 'tools/call') {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify({ data: [] }) }] } }),
    };
  }
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpc?.id ?? null, result: {} }) };
}

/**
 * A local MCP endpoint. `answer(rpc, seen)` returns { status, headers, body },
 * a function that writes the response itself, or undefined for the default.
 * Every request is kept: its headers, the raw bytes, and what core's body
 * parser would make of them.
 */
export async function startStub(answer = () => undefined) {
  const requests = [];
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    let raw = Buffer.alloc(0);
    let text = null;
    let rpc = null;
    try {
      ({ raw, text } = await readRequest(req));
      rpc = JSON.parse(text);
    } catch {
      // Kept as null: a test that expects JSON fails on it.
    }
    const seen = { headers: req.headers, raw, text, rpc };
    requests.push(seen);
    const reply = answer(rpc, seen) ?? defaultAnswer(rpc);
    if (typeof reply === 'function') return reply(res);
    res.writeHead(reply.status, reply.headers);
    res.end(reply.body);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    url: `${base}/mcp`,
    requests,
    toolCalls: () => requests.filter((r) => r.rpc?.method === 'tools/call'),
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A tools/call whose arguments hold the marker is refused with `reply`; everything else is answered. */
export const refuseMarked = (reply) => (rpc) =>
  rpc?.method === 'tools/call' && JSON.stringify(rpc.params?.arguments ?? {}).includes(REFUSE_MARKER)
    ? (typeof reply === 'function' ? reply(rpc) : reply)
    : undefined;

export async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('the call was expected to fail');
}

/**
 * A reply that writes a refusal's status and the start of its body, then cuts
 * the connection, so the client cannot read the answer (an `unreadable` refusal).
 */
export const cutOff = (status) => (res) => {
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': '400' });
  res.write('{"jsonrpc":"2.0","id":3,"error":');
  setTimeout(() => res.socket.destroy(), 20);
};
