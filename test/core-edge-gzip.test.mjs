/**
 * HK-847: every body this extension sends to core is gzip-compressed, and a
 * refusal from the web edge in front of Hiveku fails only the request it
 * refused, never as a key problem. Covers src/mcpClient.ts, the two scripts the
 * extension writes onto a machine (automations/lib.mjs and
 * .hiveku/pull-data.mjs, both carrying src/coreEdgeScript.ts), and the readers
 * that turn a 401 into "your key expired" (tree.ts loadFailureNode, and the
 * dataset errors dataRefresh.ts and extension.ts read through isCoreEdgeRefusal;
 * test/edge-refusal-readers.test.mjs pins what each of those readers says).
 *
 * The Claude Code plugin did this first (HK-838, lib/upstream.mjs and
 * test/edge-refusal.test.mjs there). What happened: the edge in front of core
 * answered one pm_tasks_create with an HTML 403 titled "Blocked" because of what
 * the task's text held. The call never reached Hiveku.
 *
 * Everything runs against a local HTTP stub on 127.0.0.1 (test/helpers/core-stub.mjs).
 * No request reaches a live host, and no test holds an attack-shaped string:
 * the stub refuses on a marker of its own.
 *
 * Pinned:
 *   1. The client sends every body gzip: Content-Encoding gzip, every other
 *      header as before, and the inflated bytes are exactly the JSON it sent
 *      before; the customer's text is not readable on the wire. The handshake
 *      leaves no request timer armed (the 204 clears its own).
 *   2. An HTML 403 from the edge is McpEdgeRefusalError (edge_blocked, the
 *      status, the ray id), and the next call is sent and answered.
 *   3. Every other answer on 401, 403 or 429 that is not Hiveku's own JSON-RPC
 *      error is the edge's too, and an edge 429 is never slept on or re-sent.
 *   4. Hiveku's own refusals, replayed as hiveku-mcp-api-server sends them
 *      (src/middleware/mcp-auth.ts, rate-limiter.ts): its JSON 401 still throws
 *      `MCP HTTP 401: <body>` and the tree still offers reconnect, its JSON 403
 *      is unchanged, and its JSON 429 still waits Retry-After and is sent once
 *      more. A 503 keeps the generic path, whatever its body.
 *   5. A refusal whose body cannot be read is no key problem either.
 *   6. The readers: the tree never offers reconnect for an edge refusal, a
 *      dataset's error string from a real export is recognised with its kind,
 *      and only Hiveku's own 401 is a key refusal.
 *   7. The words: plain, the ray id first, no em dash, no vendor names, and no
 *      advice to reconnect.
 *   8. The generated scripts send gzip and refuse the same way with the same
 *      words, and the runner's closing line blames the key only when Hiveku
 *      itself refused it, and counts answers that could not be read apart.
 *   9. coreEdgeScript.ts decides and words every answer as mcpClient.ts does.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';
import { isGzip } from './helpers/request-body.mjs';
import {
  BLOCK_PAGE,
  EDGE_429_PAGE,
  NOT_HIVEKU,
  OTHER_ACCOUNT_MESSAGE,
  RAY,
  REFUSE_MARKER,
  REVOKED_KEY_MESSAGE,
  coreAuthRefusal,
  coreRateLimit,
  cutOff,
  refuseMarked,
  rejection,
  startStub,
} from './helpers/core-stub.mjs';

const mc = loadOut('mcpClient');
const tree = loadOut('tree');
const dx = loadOut('dataExport');
const dr = loadOut('dataRunner');
const la = loadOut('localAutomations');
const { CORE_EDGE_SCRIPT } = loadOut('coreEdgeScript');
const { DEPARTMENTS } = loadOut('deptData');

const RECORD = { label: 'Acme', accountId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' };
/** A department with plain list datasets only, as test/account-memory-runner.test.mjs picks it. */
const DEPT = DEPARTMENTS.find((d) => d.datasets.length > 0 && !d.references?.length && !d.datasets.some((ds) => ds.scope || ds.detail));

const clientFor = (stub) => new mc.HivekuMcpClient({ baseUrl: stub.base, apiKey: 'hvk_test_placeholder' });

/** The words, checked the same way everywhere (part 7). */
function assertPlainEdgeWords(message, { status, ray }) {
  assert.match(message, /^The web edge in front of Hiveku (refused|turned) this one request/);
  if (ray) {
    const at = message.indexOf(`ray id ${ray}`);
    assert.ok(at > 0 && at < 120, `the ray id comes first: ${message}`);
  }
  assert.ok(message.includes(`(HTTP ${status}${ray ? `, ray id ${ray}` : ''})`), message);
  assert.match(message, /It never reached Hiveku and nothing was saved\./);
  assert.match(message, /Hiveku did not refuse your key, so there is no need to reconnect: the next request is sent as usual\./);
  assert.match(message, /code and file paths are the usual cause/);
  assert.ok(message.endsWith(`tell Hiveku support and give them ${ray ? `ray id ${ray}` : 'the time it happened'}.`), message);
  assert.doesNotMatch(message, /[—–]/, 'no em or en dash');
  assert.doesNotMatch(message, /cloudflare|render\b|\bwaf\b|\bcdn\b|amazon|\baws\b/i, 'no vendor names in words a person reads');
  // Never advice to reconnect: the only "reconnect" is the "no need to" one.
  assert.equal(message.split(/reconnect/i).length - 1, 1, message);
  assert.doesNotMatch(message, /\b(expired|revoked|invalid)\b/i, 'never a key problem');
}

/* ── 1. gzip on the wire ─────────────────────────────────────────────────── */

describe('HivekuMcpClient: every body to core goes gzip (HK-847)', () => {
  test('each request is gzip with Content-Encoding, every other header as before, and inflates to exactly the JSON it sent', async () => {
    const stub = await startStub();
    try {
      const client = clientFor(stub);
      const text = `Ünïcode "quotes" \\ back, a path like src/app/page.tsx, and ${REFUSE_MARKER}`;
      await client.callTool('pm_tasks_create', { title: 'Plain', description: text });
      assert.deepEqual(stub.requests.map((r) => r.rpc?.method), ['initialize', 'notifications/initialized', 'tools/call']);
      for (const request of stub.requests) {
        assert.equal(request.headers['content-encoding'], 'gzip');
        assert.equal(request.headers['content-type'], 'application/json');
        assert.equal(request.headers.accept, 'application/json');
        assert.equal(request.headers.authorization, 'Bearer hvk_test_placeholder');
        assert.equal(request.headers['x-hiveku-client'], 'vscode-extension');
        assert.match(request.headers['user-agent'], /^HivekuVSCode\//);
        assert.deepEqual([...request.raw.subarray(0, 2)], [0x1f, 0x8b], 'the bytes on the wire are gzip');
        assert.equal(Number(request.headers['content-length']), request.raw.length);
        // Byte for byte the JSON the client sent before: same members, same order.
        const { id, method, params } = request.rpc;
        assert.equal(gunzipSync(request.raw).toString('utf8'), JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      }
      assert.equal(stub.requests[2].headers['mcp-session-id'], 'stub-session');
      assert.deepEqual(stub.toolCalls()[0].rpc.params, { name: 'pm_tasks_create', arguments: { title: 'Plain', description: text } });
      assert.ok(!stub.toolCalls()[0].raw.includes(Buffer.from(REFUSE_MARKER)), 'the text must not be readable on the wire');
    } finally {
      await stub.close();
    }
  });

  test('gzipJsonBody is gzip of the UTF-8 JSON, nothing else', async () => {
    const message = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'x', arguments: { a: 'é' } } };
    const body = await mc.gzipJsonBody(message);
    assert.equal(gunzipSync(body).toString('utf8'), JSON.stringify(message));
  });

  test("the handshake leaves no request timer armed: the 204 to notifications/initialized clears its own", async () => {
    // Every request arms a timer for its whole budget (135 s by default). The
    // 204 path returned without clearing it, so one stayed armed after every
    // handshake. Watch the long timers armed while initialize() runs.
    const stub = await startStub();
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const armed = new Set();
    globalThis.setTimeout = (fn, ms, ...rest) => {
      const handle = realSetTimeout(fn, ms, ...rest);
      if (ms >= 60_000) armed.add(handle);
      return handle;
    };
    globalThis.clearTimeout = (handle) => {
      armed.delete(handle);
      return realClearTimeout(handle);
    };
    let leftArmed;
    try {
      await clientFor(stub).initialize();
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
      leftArmed = armed.size;
      // Never hold the test run open for the budget, whatever the outcome.
      for (const handle of armed) realClearTimeout(handle);
      await stub.close();
    }
    assert.deepEqual(stub.requests.map((r) => r.rpc?.method), ['initialize', 'notifications/initialized']);
    assert.equal(stub.requests.length, 2);
    assert.equal(leftArmed, 0, 'every request timer is cleared once its answer is in, the 204 included');
  });
});

/* ── 2 and 3. the edge's refusals ────────────────────────────────────────── */

describe('HivekuMcpClient: a refusal from the web edge fails that one request', () => {
  test('an HTML 403 "Blocked" page is McpEdgeRefusalError with the ray id, and the next call is sent and answered', async () => {
    const stub = await startStub(refuseMarked(BLOCK_PAGE));
    try {
      const client = clientFor(stub);
      const err = await rejection(client.callTool('pm_tasks_create', { title: `Fix the path ${REFUSE_MARKER}` }));
      assert.ok(err instanceof mc.McpEdgeRefusalError, String(err));
      assert.equal(err.kind, 'edge_blocked');
      assert.equal(err.httpStatus, 403);
      assert.equal(err.rayId, RAY);
      assert.equal(err.message, mc.coreEdgeRefusalMessage(403, RAY));
      assert.equal(mc.isCoreEdgeRefusal(err), true);
      assertPlainEdgeWords(err.message, { status: 403, ray: RAY });

      const before = stub.toolCalls().length;
      const answer = await client.callToolJson('pm_tasks_create', { title: 'A plain one-line task' });
      assert.deepEqual(answer, { data: [] });
      await client.callToolJson('pm_tasks_list', {});
      assert.equal(stub.toolCalls().length, before + 2, 'each later call is sent, nothing kept from the refusal');
    } finally {
      await stub.close();
    }
  });

  const EDGE_SHAPES = [
    { what: 'a plain-text 403 with a ray id header', reply: { status: 403, headers: { 'content-type': 'text/plain', 'cf-ray': RAY }, body: 'Forbidden' }, ray: RAY },
    { what: 'an empty 403 with no ray id', reply: { status: 403, headers: {}, body: '' }, ray: null },
    {
      what: 'a JSON 403 that is not a JSON-RPC error, ray id in the body',
      reply: { status: 403, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Forbidden', status: 403, ray_id: '8f1c2d3e4f5a6b7d' }) },
      ray: '8f1c2d3e4f5a6b7d',
    },
    {
      what: 'a block page that names its ray id in the HTML',
      reply: { status: 403, headers: { 'content-type': 'text/html' }, body: '<html><title>Attention Required!</title><p>Ray ID: <strong class="x">8f1c2d3e4f5a6b7e</strong></p></html>' },
      ray: '8f1c2d3e4f5a6b7e',
    },
    { what: 'an HTML 401', reply: { status: 401, headers: { 'content-type': 'text/html', 'cf-ray': RAY }, body: '<html><title>Unauthorized</title></html>' }, ray: RAY },
    { what: 'an HTML 429 that asks for a wait', reply: EDGE_429_PAGE, ray: RAY },
  ];

  for (const shape of EDGE_SHAPES) {
    test(`${shape.what} is the edge refusing this one request: not re-sent, no key problem, the next call goes out`, async () => {
      const stub = await startStub(refuseMarked(shape.reply));
      try {
        const client = clientFor(stub);
        const err = await rejection(client.callTool('crm_contacts_create', { notes: REFUSE_MARKER }));
        assert.ok(err instanceof mc.McpEdgeRefusalError, String(err));
        assert.equal(err.kind, 'edge_blocked');
        assert.equal(err.httpStatus, shape.reply.status);
        assert.equal(err.rayId, shape.ray);
        assertPlainEdgeWords(err.message, { status: shape.reply.status, ray: shape.ray });
        // A re-send would have happened before the call settled (request() awaits it), so one send is the proof.
        assert.equal(stub.toolCalls().length, 1, 'refused once, never slept on and sent again');
        // The tree reads it as a failure, never as a dead key.
        const node = tree.loadFailureNode('Contacts', err, RECORD);
        assert.equal(node.command, undefined, JSON.stringify(node));
        assert.equal(node.label, `Contacts: ${err.message}`);
        await client.callToolJson('crm_contacts_list', {});
        assert.equal(stub.toolCalls().length, 2);
      } finally {
        await stub.close();
      }
    });
  }
});

/* ── 4. Hiveku's own refusals are as they were ───────────────────────────── */

describe("HivekuMcpClient: Hiveku's own refusals keep the path they had", () => {
  test('its JSON 401 (a revoked key) still throws MCP HTTP 401 with its body, and the tree still offers reconnect', async () => {
    let sent = null;
    const stub = await startStub((rpc) => {
      if (rpc?.method !== 'initialize') return undefined;
      sent = coreAuthRefusal(401, rpc.id, REVOKED_KEY_MESSAGE);
      return sent;
    });
    try {
      const err = await rejection(clientFor(stub).callTool('get_account_info', {}));
      assert.ok(!(err instanceof mc.McpEdgeRefusalError));
      assert.equal(err.message, `MCP HTTP 401: ${sent.body.slice(0, 500)}`);
      assert.equal(mc.isCoreEdgeRefusal(err), false);
      assert.equal(mc.isHivekuKeyRefusal(err), true, 'the one refusal reconnecting fixes');
      const node = tree.loadFailureNode('Projects', err, RECORD);
      assert.equal(node.label, 'Key expired for Acme — click to reconnect');
      assert.deepEqual(node.command, { command: 'hiveku.connect', title: 'Reconnect Hiveku', arguments: [RECORD] });
    } finally {
      await stub.close();
    }
  });

  test('its JSON 403 (a key for another account) still throws MCP HTTP 403 with its body', async () => {
    let sent = null;
    const stub = await startStub(refuseMarked((rpc) => (sent = coreAuthRefusal(403, rpc.id, OTHER_ACCOUNT_MESSAGE))));
    try {
      const err = await rejection(clientFor(stub).callTool('pm_tasks_create', { title: REFUSE_MARKER }));
      assert.ok(!(err instanceof mc.McpEdgeRefusalError));
      assert.equal(err.message, `MCP HTTP 403: ${sent.body.slice(0, 500)}`);
      assert.equal(mc.isCoreEdgeRefusal(err), false);
      assert.equal(mc.isHivekuKeyRefusal(err), false, 'a 403 is not the key being refused');
    } finally {
      await stub.close();
    }
  });

  test('its JSON 429 still waits the Retry-After it sent and is sent once more', async () => {
    let refused = 0;
    const stub = await startStub((rpc) => {
      if (rpc?.method !== 'tools/call') return undefined;
      if (refused++ === 0) return coreRateLimit(rpc.id);
      return undefined;
    });
    try {
      const started = Date.now();
      const answer = await clientFor(stub).callToolJson('crm_contacts_list', {});
      assert.deepEqual(answer, { data: [] });
      assert.equal(stub.toolCalls().length, 2, 'one wait, one more send');
      assert.ok(Date.now() - started >= 900, 'it waited the second the server asked for');
    } finally {
      await stub.close();
    }
  });

  const ANY_503 = [
    { what: "carrying Hiveku's own JSON", type: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'stub says try later' } }) },
    { what: 'with an HTML page', type: 'text/html', body: '<html><title>Service unavailable</title></html>' },
  ];
  for (const shape of ANY_503) {
    test(`a 503 ${shape.what} keeps the generic MCP HTTP 503 path`, async () => {
      const stub = await startStub(refuseMarked({ status: 503, headers: { 'content-type': shape.type, 'cf-ray': RAY }, body: shape.body }));
      try {
        const err = await rejection(clientFor(stub).callTool('pm_tasks_create', { title: REFUSE_MARKER }));
        assert.ok(!(err instanceof mc.McpEdgeRefusalError));
        assert.equal(err.message, `MCP HTTP 503: ${shape.body.slice(0, 500)}`);
      } finally {
        await stub.close();
      }
    });
  }
});

/* ── 5. an unreadable refusal ────────────────────────────────────────────── */

test('a 401 whose body is cut off before it can be read is no key problem, and the next call goes out', async () => {
  const stub = await startStub(refuseMarked(() => cutOff(401)));
  try {
    const client = clientFor(stub);
    const err = await rejection(client.callTool('pm_tasks_create', { title: REFUSE_MARKER }));
    assert.ok(err instanceof mc.McpEdgeRefusalError, String(err));
    assert.equal(err.kind, 'unreadable');
    assert.equal(err.httpStatus, 401);
    assert.equal(err.rayId, null);
    assert.equal(err.message, mc.coreRefusalUnreadMessage(401));
    assert.match(err.message, /could not be read, so it is not known whether Hiveku or the web edge in front of Hiveku refused it/);
    assert.doesNotMatch(err.message, /[—–]/);
    assert.equal(tree.loadFailureNode('Tasks', err, RECORD).command, undefined, 'never "click to reconnect"');
    assert.equal(mc.coreEdgeRefusalKind(err), 'unreadable');
    assert.equal(mc.coreEdgeRefusalKind(err.message), 'unreadable', 'the words alone say which kind');
    assert.equal(mc.isHivekuKeyRefusal(err), false);
    await client.callToolJson('pm_tasks_list', {});
  } finally {
    await stub.close();
  }
});

/* ── 6. the readers that only have the text ──────────────────────────────── */

describe('isCoreEdgeRefusal: the readers that turn a 401 into "your key expired"', () => {
  test('a real export the edge refused: every dataset failed, and its error string reads as the edge, not the key', async () => {
    assert.ok(DEPT, 'no simple department in the registry');
    const stub = await startStub((rpc) => (rpc?.method === 'tools/call' ? BLOCK_PAGE : undefined));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-edge-export-'));
    try {
      const results = await dx.exportDepartments(clientFor(stub), [DEPT], dir, 'Acme');
      assert.equal(dx.everyDepartmentFailed(results), true);
      const first = dx.failedDatasets(results)[0];
      assert.ok(first, 'a failed dataset');
      assert.equal(first.error, mc.coreEdgeRefusalMessage(403, RAY));
      // extension.ts reads the failed datasets' errors; dataRefresh.ts reads the message it builds around one.
      assert.equal(mc.isCoreEdgeRefusal(first.error), true);
      assert.equal(mc.coreEdgeRefusalKind(first.error), 'edge_blocked');
      assert.equal(mc.isHivekuKeyRefusal(first.error), false);
      assert.equal(mc.isCoreEdgeRefusal(`every dataset failed (${first.department}/${first.dataset}): ${first.error}`.slice(0, 300)), true);
    } finally {
      await stub.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test("Hiveku's own refusals and ordinary failures are not edge refusals, and only Hiveku's own 401 is a key refusal", () => {
    const hivekuKey = `MCP HTTP 401: ${coreAuthRefusal(401, 1, REVOKED_KEY_MESSAGE).body}`;
    for (const notEdge of [
      hivekuKey,
      'MCP HTTP 403: {"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"API key does not belong to the specified account"}}',
      'MCP request timed out after 135s (tools/call)',
      new Error('fetch failed'),
      undefined,
      null,
    ]) {
      assert.equal(mc.isCoreEdgeRefusal(notEdge), false, String(notEdge));
      assert.equal(mc.coreEdgeRefusalKind(notEdge), null, String(notEdge));
      assert.equal(mc.isHivekuKeyRefusal(notEdge), notEdge === hivekuKey, String(notEdge));
    }
    assert.equal(mc.isHivekuKeyRefusal(new Error(hivekuKey)), true);
    assert.equal(mc.isHivekuKeyRefusal(`every dataset failed (crm/deals): ${hivekuKey}`), true, 'inside a message built around it');
    const rethrown = new Error(`Could not load: ${mc.coreEdgeRefusalMessage(401, null)}`);
    assert.equal(mc.isCoreEdgeRefusal(rethrown), true, 'rethrown with the message inside');
    assert.equal(mc.coreEdgeRefusalKind(rethrown), 'edge_blocked');
    for (const status of [401, 403, 429]) {
      assert.equal(mc.coreEdgeRefusalKind(new mc.McpEdgeRefusalError('edge_blocked', status, RAY)), 'edge_blocked');
      assert.equal(mc.coreEdgeRefusalKind(new mc.McpEdgeRefusalError('unreadable', status)), 'unreadable');
      assert.equal(mc.coreEdgeRefusalKind(mc.coreEdgeRefusalMessage(status, RAY)), 'edge_blocked');
      assert.equal(mc.coreEdgeRefusalKind(mc.coreRefusalUnreadMessage(status)), 'unreadable');
      // An edge 401 never reads as Hiveku refusing the key, even with "MCP HTTP 401:" around it.
      assert.equal(mc.isHivekuKeyRefusal(`MCP HTTP 401: ${mc.coreEdgeRefusalMessage(status, RAY)}`), false);
    }
  });
});

/* ── 7. the words, and the two readers of an answer ──────────────────────── */

describe('the words and the classifiers', () => {
  test('every refusal is said plainly: what happened, that nothing was saved, and what to try', () => {
    for (const status of [401, 403, 429]) {
      for (const ray of [RAY, null]) assertPlainEdgeWords(mc.coreEdgeRefusalMessage(status, ray), { status, ray });
    }
    const blocked = mc.coreEdgeRefusalMessage(403, RAY);
    assert.match(blocked, /refused this one request \(HTTP 403, ray id 8f1c2d3e4f5a6b7c-SJC\), most often because of something in its text\./);
    assert.match(blocked, /If every request is refused this way, even a plain one, the block is on where the requests come from/);
    const busy = mc.coreEdgeRefusalMessage(429, RAY);
    assert.match(busy, /turned this one request away \(HTTP 429, ray id 8f1c2d3e4f5a6b7c-SJC\)\. It does that when it is busy/);
    assert.match(busy, /Wait a minute and try it once more/);
    assert.doesNotMatch(busy, /If every request is refused/, 'the every-request advice is for a 401 or 403');
    assert.doesNotMatch(busy, /rate limit/i, "never read back as Hiveku's rate limit");
  });

  test("isHivekuErrorAnswer accepts only Hiveku's JSON-RPC error, and edgeRayId only an id", () => {
    assert.equal(mc.isHivekuErrorAnswer(coreAuthRefusal(401, 1, REVOKED_KEY_MESSAGE).body), true);
    assert.equal(mc.isHivekuErrorAnswer(coreAuthRefusal(403, null, OTHER_ACCOUNT_MESSAGE).body), true);
    assert.equal(mc.isHivekuErrorAnswer(coreRateLimit(7).body), true);
    for (const notHiveku of NOT_HIVEKU) assert.equal(mc.isHivekuErrorAnswer(notHiveku), false, notHiveku);

    const headers = (ray) => new Headers(ray === undefined ? {} : { 'cf-ray': ray });
    assert.equal(mc.edgeRayId(headers(RAY), ''), RAY);
    assert.equal(mc.edgeRayId(headers('8f1c2d3e4f5a6b7c'), ''), '8f1c2d3e4f5a6b7c');
    assert.equal(mc.edgeRayId(headers('<b>not an id</b>'), 'Ray ID: <strong>8f1c2d3e4f5a6b7f</strong>'), '8f1c2d3e4f5a6b7f');
    assert.equal(mc.edgeRayId(headers(undefined), '<html>no id here 8f1c2d3e4f5a6b7c</html>'), null, 'a hex run not named as a ray id is not one');
    assert.equal(mc.edgeRayId(headers(undefined), ''), null);
  });
});

/* ── 8. the generated scripts ────────────────────────────────────────────── */

describe('automations/lib.mjs (localAutomations.ts): gzip, and the same refusal', () => {
  let lib;
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-edge-lib-'));
    await fs.writeFile(path.join(dir, 'lib.mjs'), la.automationFiles()['automations/lib.mjs']);
    lib = await import(pathToFileURL(path.join(dir, 'lib.mjs')).href);
  });
  after(async () => {
    delete process.env.HIVEKU_MCP_URL;
    delete process.env.HIVEKU_MCP_KEY;
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("hiveku() sends gzip, an edge 403 fails that call in the extension's words, an edge 429 is not re-sent, and Hiveku's 429 still is", async () => {
    let hivekuLimited = false;
    const stub = await startStub((rpc) => {
      if (rpc?.method !== 'tools/call') return undefined;
      if (rpc.params.name === 'edge_busy') return EDGE_429_PAGE;
      if (rpc.params.name === 'hiveku_busy' && !hivekuLimited) {
        hivekuLimited = true;
        return coreRateLimit(rpc.id);
      }
      return refuseMarked(BLOCK_PAGE)(rpc);
    });
    process.env.HIVEKU_MCP_URL = stub.url;
    process.env.HIVEKU_MCP_KEY = 'hvk_test_placeholder';
    try {
      const err = await rejection(lib.hiveku('pm_tasks_create', { title: REFUSE_MARKER }));
      assert.equal(err.message, mc.coreEdgeRefusalMessage(403, RAY));
      assert.equal(err.edgeRefusal, true);
      assert.deepEqual(await lib.hiveku('pm_tasks_list', {}), { data: [] }, 'the next call is sent and answered');

      const busy = await rejection(lib.hiveku('edge_busy', {}));
      assert.equal(busy.message, mc.coreEdgeRefusalMessage(429, RAY));
      // rpc() awaits any re-send before it settles, so one send is the proof.
      assert.equal(stub.toolCalls().filter((r) => r.rpc.params.name === 'edge_busy').length, 1, 'never slept on and sent again');

      assert.deepEqual(await lib.hiveku('hiveku_busy', {}), { data: [] });
      assert.equal(stub.toolCalls().filter((r) => r.rpc.params.name === 'hiveku_busy').length, 2, "Hiveku's own 429: one wait, one more send");

      for (const request of stub.requests) {
        assert.ok(isGzip(request.headers['content-encoding']), request.rpc?.method);
        assert.equal(request.headers['content-type'], 'application/json');
        assert.match(request.headers['user-agent'], /^HivekuLocalAutomation\//);
        const { id, method, params } = request.rpc;
        assert.equal(gunzipSync(request.raw).toString('utf8'), JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      }
      assert.ok(!stub.toolCalls()[0].raw.includes(Buffer.from(REFUSE_MARKER)), 'the text must not be readable on the wire');
    } finally {
      await stub.close();
    }
  });
});

describe('.hiveku/pull-data.mjs (dataRunner.ts): gzip, the same refusal, and a closing line that blames the key only when Hiveku did', () => {
  async function accountFolder(stub) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-edge-runner-'));
    await dr.writeDataRunner(dir, [DEPT.id]);
    await fs.writeFile(
      path.join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { hiveku: { url: stub.url, headers: { Authorization: 'Bearer hvk_test_placeholder' } } } }),
    );
    return dir;
  }
  function run(dir, ...args) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(dir, '.hiveku', 'pull-data.mjs'), ...args]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (b) => (stdout += b));
      child.stderr.on('data', (b) => (stderr += b));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }

  test('a run the edge refuses: gzip on the wire, the plain message with the ray id in STATUS.json, and no word about the key', async () => {
    assert.ok(DEPT, 'no simple department in the registry');
    const stub = await startStub((rpc) => (rpc?.method === 'tools/call' ? BLOCK_PAGE : undefined));
    const dir = await accountFolder(stub);
    try {
      const r = await run(dir, DEPT.id);
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.match(
        r.stderr,
        /Every dataset failed\. The web edge in front of Hiveku refused \d+ request\(s\) in this run \(their errors are in hiveku-data\/STATUS\.json\): those never reached Hiveku, so they say nothing about the account key\./,
      );
      assert.doesNotMatch(r.stderr, /check the account key/);
      const status = JSON.parse(await fs.readFile(path.join(dir, 'hiveku-data', 'STATUS.json'), 'utf8'));
      assert.equal(status.runner_version, 6);
      const failed = status.failed.filter((f) => f.department === DEPT.id);
      assert.ok(failed.length > 0, JSON.stringify(status.failed));
      for (const f of failed) {
        assert.equal(f.error, mc.coreEdgeRefusalMessage(403, RAY).slice(0, 200), 'cut at 200, the ray id still in it');
        assert.ok(f.error.includes(`ray id ${RAY}`));
      }
      assert.ok(stub.toolCalls().length > 0);
      for (const request of stub.requests) {
        assert.ok(isGzip(request.headers['content-encoding']), request.rpc?.method);
        assert.match(request.headers['user-agent'], /^HivekuDataRunner\//);
        const { id, method, params } = request.rpc;
        assert.equal(gunzipSync(request.raw).toString('utf8'), JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      }
    } finally {
      await stub.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('a run where Hiveku itself also refused the key still names the key, even beside edge refusals', async () => {
    const stub = await startStub((rpc) => {
      if (rpc?.method !== 'tools/call') return undefined;
      return rpc.params.name === 'account_memory_get' ? coreAuthRefusal(401, rpc.id, REVOKED_KEY_MESSAGE) : BLOCK_PAGE;
    });
    const dir = await accountFolder(stub);
    try {
      const r = await run(dir, DEPT.id);
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /Every dataset failed — check the account key in \.mcp\.json\./);
      assert.doesNotMatch(r.stderr, /web edge/);
    } finally {
      await stub.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('a run Hiveku refuses with its own JSON 401 keeps the closing line it had', async () => {
    const stub = await startStub((rpc) => (rpc?.method === 'initialize' ? coreAuthRefusal(401, rpc.id, REVOKED_KEY_MESSAGE) : undefined));
    const dir = await accountFolder(stub);
    try {
      const r = await run(dir, DEPT.id);
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /Every dataset failed — check the account key in \.mcp\.json\./);
      assert.doesNotMatch(r.stderr, /web edge/);
      const status = JSON.parse(await fs.readFile(path.join(dir, 'hiveku-data', 'STATUS.json'), 'utf8'));
      const failed = status.failed.filter((f) => f.department === DEPT.id);
      assert.ok(failed.length > 0);
      for (const f of failed) assert.match(f.error, /^MCP HTTP 401: \{"jsonrpc":"2\.0"/);
    } finally {
      await stub.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('a run whose answers could not be read says so: it names neither the web edge nor the key', async () => {
    const stub = await startStub((rpc) => (rpc?.method === 'tools/call' ? cutOff(401) : undefined));
    const dir = await accountFolder(stub);
    try {
      const r = await run(dir, DEPT.id);
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.match(
        r.stderr,
        /Every dataset failed\. The answers to \d+ request\(s\) in this run could not be read, so it is not known whether Hiveku or the web edge in front of Hiveku refused them \(their errors are in hiveku-data\/STATUS\.json\): none of that is a sign that the account key stopped working\./,
      );
      assert.doesNotMatch(r.stderr, /check the account key|refused \d+ request/);
      const status = JSON.parse(await fs.readFile(path.join(dir, 'hiveku-data', 'STATUS.json'), 'utf8'));
      const failed = status.failed.filter((f) => f.department === DEPT.id);
      assert.equal(failed.length, DEPT.datasets.length, JSON.stringify(status.failed));
      for (const f of failed) assert.equal(f.error, mc.coreRefusalUnreadMessage(401).slice(0, 200));
    } finally {
      await stub.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('a run the web edge refused and whose other answers could not be read counts each apart, and still names no key', async () => {
    const unreadTool = DEPT.datasets[0].tool;
    const stub = await startStub((rpc) => {
      if (rpc?.method !== 'tools/call') return undefined;
      return rpc.params.name === unreadTool ? cutOff(401) : BLOCK_PAGE;
    });
    const dir = await accountFolder(stub);
    try {
      const r = await run(dir, DEPT.id);
      assert.equal(r.code, 1, r.stdout + r.stderr);
      // Every other request (the other datasets and the account memory) the edge refused; one answer was cut off.
      const refused = stub.toolCalls().filter((c) => c.rpc.params.name !== unreadTool).length;
      assert.equal(stub.toolCalls().length - refused, 1, 'one answer cut off');
      assert.ok(refused >= DEPT.datasets.length - 1, String(refused));
      const line =
        `Every dataset failed. The web edge in front of Hiveku refused ${refused} request(s) in this run, and the answers to 1 more ` +
        'could not be read (their errors are in hiveku-data/STATUS.json): none of that is a sign that the account key stopped working.';
      assert.ok(r.stderr.includes(line), r.stderr);
      assert.doesNotMatch(r.stderr, /check the account key/);
    } finally {
      await stub.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

/* ── 9. the pasted source agrees with mcpClient.ts ───────────────────────── */

test('coreEdgeScript.ts decides and words every answer exactly as mcpClient.ts does', async () => {
  assert.doesNotMatch(CORE_EDGE_SCRIPT, /`|\$\{/, 'nothing a template literal would read');
  // Loaded the way a generated script carries it: pasted after the zlib import.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-edge-script-'));
  const file = path.join(dir, 'core-edge.mjs');
  await fs.writeFile(
    file,
    "import { gzipSync } from 'node:zlib';\n" +
      CORE_EDGE_SCRIPT +
      '\nexport { hivekuGzipBody, hivekuErrorAnswer, hivekuEdgeRayId, hivekuEdgeRefusalText, hivekuRefusalUnreadText, hivekuEdgeRefusal };\n',
  );
  try {
    const script = await import(pathToFileURL(file).href);
    const message = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'x', arguments: { t: 'é' } } };
    assert.equal(gunzipSync(script.hivekuGzipBody(message)).toString('utf8'), JSON.stringify(message));

    for (const status of [401, 403, 429]) {
      assert.equal(script.hivekuRefusalUnreadText(status), mc.coreRefusalUnreadMessage(status));
      for (const ray of [RAY, null]) assert.equal(script.hivekuEdgeRefusalText(status, ray), mc.coreEdgeRefusalMessage(status, ray));
    }
    const hiveku = [coreAuthRefusal(401, 1, REVOKED_KEY_MESSAGE).body, coreAuthRefusal(403, 2, OTHER_ACCOUNT_MESSAGE).body, coreRateLimit(3).body];
    for (const text of [...hiveku, ...NOT_HIVEKU]) assert.equal(script.hivekuErrorAnswer(text), mc.isHivekuErrorAnswer(text), text);

    const pages = [
      [{ 'cf-ray': RAY }, ''],
      [{ 'cf-ray': '<b>no</b>' }, 'Ray ID: <strong>8f1c2d3e4f5a6b7f</strong>'],
      [{}, '{"ray_id":"8f1c2d3e4f5a6b7d"}'],
      [{}, '<html>no id here 8f1c2d3e4f5a6b7c</html>'],
      [{}, ''],
    ];
    for (const [h, text] of pages) assert.equal(script.hivekuEdgeRayId(new Headers(h), text), mc.edgeRayId(new Headers(h), text), text);

    // The whole decision, on every status and body: an Error with the extension's words, or null where Hiveku answered.
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      for (const text of [...hiveku, ...NOT_HIVEKU, null]) {
        const res = { status, headers: new Headers({ 'cf-ray': RAY }) };
        const ours = script.hivekuEdgeRefusal(res, text);
        const refusal = [401, 403, 429].includes(status) && (text === null || !mc.isHivekuErrorAnswer(text));
        if (!refusal) {
          assert.equal(ours, null, `${status} ${text}`);
          continue;
        }
        const expected = text === null ? mc.coreRefusalUnreadMessage(status) : mc.coreEdgeRefusalMessage(status, mc.edgeRayId(res.headers, text));
        assert.equal(ours?.message, expected, `${status} ${text}`);
        assert.equal(ours.edgeRefusal, true);
        // The kind the runner counts by is the kind the extension reads off the same words.
        assert.equal(ours.kind, text === null ? 'unreadable' : 'edge_blocked', `${status} ${text}`);
        assert.equal(mc.coreEdgeRefusalKind(ours.message), ours.kind, `${status} ${text}`);
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
