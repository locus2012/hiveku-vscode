/**
 * The edge firewall's two refusals, read by every client this extension ships.
 *
 * An automated client the firewall cannot identify gets a 202 challenge (empty
 * body, x-amzn-waf-action: challenge) or a 403 with x-hiveku-firewall: blocked;
 * a request from a known bulk-scraper network gets a 403 with
 * x-hiveku-firewall: blocked-network; a 403 without that header comes from the
 * site itself. The header decides, never the body text: the site's own 403 here
 * carries the firewall's exact body and must still read as the site's.
 *
 * Covers the helper (src/hivekuUserAgent.ts), the project download
 * (src/download.ts), the http() helper written into automations/lib.mjs
 * (src/localAutomations.ts), and the CLAUDE.md prose (src/knowledge.ts).
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const ua = loadOut('hivekuUserAgent');
const { downloadAndExtract } = loadOut('download');
const { automationFiles } = loadOut('localAutomations');
const knowledge = loadOut('knowledge');

const BLOCKED_BODY =
  "This site's firewall does not serve automated clients it cannot identify. If you run a legitimate service, " +
  'ask the site owner to allow it in the Firewall section of their hosting settings.';
const NETWORK_BODY = "This site's firewall does not serve requests from this network.";

const headers = (o = {}) => ({ get: (k) => o[k.toLowerCase()] ?? null });
const res = (status, h) => ({ status, headers: headers(h) });

describe('hivekuUserAgent: the 403 block beside the 202 challenge', () => {
  test('a 403 is the firewall block only with x-hiveku-firewall: blocked or blocked-network, any case', () => {
    assert.equal(ua.edgeBlockKind(res(403, { 'x-hiveku-firewall': 'blocked' })), 'blocked');
    assert.equal(ua.edgeBlockKind(res(403, { 'x-hiveku-firewall': 'blocked-network' })), 'blocked-network');
    assert.equal(ua.edgeBlockKind(res(403, { 'x-hiveku-firewall': 'BLOCKED' })), 'blocked');
    assert.equal(ua.edgeBlockKind(res(403, { 'x-hiveku-firewall': ' Blocked-Network ' })), 'blocked-network');
    assert.equal(ua.isEdgeBlock(res(403, { 'x-hiveku-firewall': 'blocked' })), true);
    assert.equal(ua.isEdgeRefusal(res(403, { 'x-hiveku-firewall': 'blocked-network' })), true);
  });

  test("a 403 without the header, or with another value, is the site's own", () => {
    for (const h of [{}, { 'x-hiveku-firewall': 'allowed' }, { 'x-hiveku-firewall': 'blocked-foo' }, { 'x-hiveku-firewall': '' }]) {
      assert.equal(ua.edgeBlockKind(res(403, h)), null, JSON.stringify(h));
      assert.equal(ua.isEdgeBlock(res(403, h)), false, JSON.stringify(h));
      assert.equal(ua.isEdgeRefusal(res(403, h), 20000), false, JSON.stringify(h));
      assert.equal(ua.edgeRefusalMessage(res(403, h)), null, JSON.stringify(h));
    }
  });

  test('the header on any status but 403 is not a block', () => {
    for (const status of [200, 202, 404, 429, 500]) {
      assert.equal(ua.isEdgeBlock(res(status, { 'x-hiveku-firewall': 'blocked' })), false, String(status));
    }
  });

  test('challenge detection is unchanged, and a refusal is either one', () => {
    assert.equal(ua.isEdgeChallenge(res(202, { 'x-amzn-waf-action': 'challenge' }), 0), true);
    assert.equal(ua.isEdgeChallenge(res(202, {})), true);
    assert.equal(ua.isEdgeChallenge(res(202, {}), 5000), false);
    assert.equal(ua.isEdgeChallenge(res(403, { 'x-hiveku-firewall': 'blocked' })), false);
    assert.equal(ua.isEdgeRefusal(res(202, { 'x-amzn-waf-action': 'challenge' })), true);
    assert.equal(ua.isEdgeRefusal(res(200, {}), 50000), false);
    assert.equal(ua.isEdgeRefusal(res(429, {}), 40), false);
  });

  test('edgeRefusalMessage names which refusal it was', () => {
    assert.equal(ua.edgeRefusalMessage(res(202, { 'x-amzn-waf-action': 'challenge' })), ua.EDGE_CHALLENGE_MESSAGE);
    assert.equal(ua.edgeRefusalMessage(res(403, { 'x-hiveku-firewall': 'blocked' })), ua.EDGE_BLOCK_MESSAGE);
    assert.equal(ua.edgeRefusalMessage(res(403, { 'x-hiveku-firewall': 'blocked-network' })), ua.EDGE_NETWORK_BLOCK_MESSAGE);
    assert.equal(ua.edgeRefusalMessage(res(200, {}), 50000), null);
  });

  test('the block messages are plain, name the header, and never blame the site or the deploy', () => {
    assert.match(ua.EDGE_BLOCK_MESSAGE, /edge firewall blocked this client as an automated client it cannot identify/);
    assert.match(ua.EDGE_BLOCK_MESSAGE, /HTTP 403 with x-hiveku-firewall: blocked\)/);
    assert.match(ua.EDGE_BLOCK_MESSAGE, /containing Hiveku/);
    assert.match(ua.EDGE_BLOCK_MESSAGE, /HEAD/);
    assert.match(ua.EDGE_BLOCK_MESSAGE, /Firewall section/);
    assert.match(ua.EDGE_BLOCK_MESSAGE, /not an empty site and not a failed deploy/);
    assert.match(ua.EDGE_NETWORK_BLOCK_MESSAGE, /known bulk-scraper network/);
    assert.match(ua.EDGE_NETWORK_BLOCK_MESSAGE, /x-hiveku-firewall: blocked-network/);
    assert.match(ua.EDGE_NETWORK_BLOCK_MESSAGE, /do not lift/);
    assert.match(ua.EDGE_NETWORK_BLOCK_MESSAGE, /not an empty site and not a failed deploy/);
    assert.doesNotMatch(ua.EDGE_NETWORK_BLOCK_MESSAGE, /containing Hiveku, or use a HEAD/);
  });
});

/** A local server that answers every way the edge and a site can. */
function refusalServer() {
  return createServer((req, out) => {
    const { pathname } = new URL(req.url, 'http://x');
    switch (pathname) {
      case '/challenge':
        out.writeHead(202, { 'x-amzn-waf-action': 'challenge' });
        return out.end();
      case '/block':
        out.writeHead(403, { 'x-hiveku-firewall': 'blocked', 'content-type': 'text/plain' });
        return out.end(BLOCKED_BODY);
      case '/block-upper':
        out.writeHead(403, { 'X-Hiveku-Firewall': 'BLOCKED', 'content-type': 'text/plain' });
        return out.end(BLOCKED_BODY);
      case '/block-network':
        out.writeHead(403, { 'x-hiveku-firewall': 'blocked-network', 'content-type': 'text/plain' });
        return out.end(NETWORK_BODY);
      // The site's own 403, even one whose body reads exactly like the firewall's.
      case '/site-403-lookalike':
        out.writeHead(403, { 'content-type': 'text/plain' });
        return out.end(BLOCKED_BODY);
      case '/site-403-json':
        out.writeHead(403, { 'content-type': 'application/json' });
        return out.end(JSON.stringify({ error: 'Download link expired' }));
      case '/site-403-other-value':
        out.writeHead(403, { 'x-hiveku-firewall': 'allowed', 'content-type': 'text/plain' });
        return out.end('Forbidden');
      case '/header-on-200':
        out.writeHead(200, { 'x-hiveku-firewall': 'blocked', 'content-type': 'application/json' });
        return out.end(JSON.stringify({ ok: true }));
      case '/rate-limited':
        out.writeHead(429, { 'content-type': 'text/plain' });
        return out.end('Too many requests');
      default:
        out.writeHead(404, { 'content-type': 'text/plain' });
        return out.end('no such route');
    }
  });
}

let server;
let base;
let host;
let dir;
before(async () => {
  server = refusalServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  host = `127.0.0.1:${server.address().port}`;
  base = `http://${host}`;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-firewall-refusal-'));
});
after(async () => {
  server?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

async function downloadError(route) {
  try {
    await downloadAndExtract(base + route, path.join(dir, 'dest'));
  } catch (err) {
    return err.message;
  }
  assert.fail(`downloadAndExtract('${route}') resolved instead of throwing`);
}

describe('project download reads the firewall block', () => {
  test('a 403 with x-hiveku-firewall: blocked is named as the firewall block', async () => {
    assert.equal(await downloadError('/block'), `Download failed: ${ua.EDGE_BLOCK_MESSAGE}`);
    assert.equal(await downloadError('/block-upper'), `Download failed: ${ua.EDGE_BLOCK_MESSAGE}`);
  });

  test('a 403 with x-hiveku-firewall: blocked-network is named as the network block', async () => {
    assert.equal(await downloadError('/block-network'), `Download failed: ${ua.EDGE_NETWORK_BLOCK_MESSAGE}`);
  });

  test('the 202 challenge still reads as the challenge', async () => {
    assert.equal(await downloadError('/challenge'), `Download failed: ${ua.EDGE_CHALLENGE_MESSAGE}`);
  });

  test("a 403 without the header is the server's own answer, with its body", async () => {
    assert.equal(await downloadError('/site-403-json'), 'Download failed: HTTP 403 — Download link expired');
    const lookalike = await downloadError('/site-403-lookalike');
    assert.ok(lookalike.startsWith('Download failed: HTTP 403 — '), lookalike);
    assert.doesNotMatch(lookalike, /edge firewall/);
    const other = await downloadError('/site-403-other-value');
    assert.equal(other, 'Download failed: HTTP 403 — Forbidden');
  });
});

describe('automations/lib.mjs http() reads the firewall block', () => {
  let lib;
  before(async () => {
    const file = path.join(dir, 'lib.mjs');
    await fs.writeFile(file, automationFiles()['automations/lib.mjs']);
    lib = await import(pathToFileURL(file).href);
  });
  const thrown = async (route) => {
    try {
      await lib.http(base + route);
    } catch (err) {
      return err.message;
    }
    assert.fail(`http('${route}') returned instead of throwing`);
  };

  test('a 403 with x-hiveku-firewall: blocked names the block, the host and the fix, any case', async () => {
    for (const route of ['/block', '/block-upper']) {
      const message = await thrown(route);
      assert.ok(message.startsWith(`HTTP 403 from ${host} (x-hiveku-firewall: blocked): `), `${route}: ${message}`);
      assert.match(message, /the edge firewall blocked this client as an automated client it cannot identify; send a user agent containing Hiveku, or use a HEAD request\./);
      assert.match(message, /A service that is not Hiveku needs the site owner to allow it in the Firewall section of the site's hosting settings\./);
      assert.match(message, /This is not an empty site and not a failed deploy\.$/);
    }
  });

  test('a 403 with x-hiveku-firewall: blocked-network names the network block', async () => {
    const message = await thrown('/block-network');
    assert.ok(message.startsWith(`HTTP 403 from ${host} (x-hiveku-firewall: blocked-network): `), message);
    assert.match(message, /came from a known bulk-scraper network/);
    assert.match(message, /A Hiveku user agent and a firewall allowance do not lift this block/);
    assert.doesNotMatch(message, /use a HEAD request/);
  });

  test("a 403 without the header is the site's own HTTP 403, even with the firewall's body text", async () => {
    const lookalike = await thrown('/site-403-lookalike');
    assert.ok(lookalike.startsWith('HTTP 403: '), lookalike);
    assert.doesNotMatch(lookalike, /edge firewall/);
    assert.equal(await thrown('/site-403-other-value'), 'HTTP 403: Forbidden');
  });

  test('the header on a 200 is not a block, and a 429 is still the plain status', async () => {
    assert.deepEqual(await lib.http(base + '/header-on-200'), { ok: true });
    assert.equal(await thrown('/rate-limited'), 'HTTP 429: Too many requests');
  });

  test('the 202 challenge still reads as the challenge', async () => {
    const message = await thrown('/challenge');
    assert.ok(message.startsWith(`HTTP 202 from ${host} (x-amzn-waf-action: challenge): the edge firewall challenged this client`), message);
  });
});

describe('the project CLAUDE.md teaches both refusals', () => {
  test('the firewall paragraph carries the contract wording and never calls every 403 the firewall', async () => {
    const project = path.join(dir, 'project');
    await fs.mkdir(project, { recursive: true });
    await knowledge.writeProjectScaffold({
      baseDir: project,
      accountLabel: 'Western Stairlifts',
      apiKey: 'olp_test_key_123',
      baseUrl: 'https://core.hiveku.com',
      accountId: '0b6f1c2e-1111-4a4a-9c9c-222233334444',
      projectId: '11111111-2222-3333-4444-555555555555',
      projectName: 'Main site',
    });
    const text = (await fs.readFile(path.join(project, 'CLAUDE.md'), 'utf8')).replace(/\s+/g, ' ');
    assert.match(
      text,
      /An automated client the firewall cannot identify gets a 202 challenge \(empty body, `x-amzn-waf-action: challenge`\) or a 403 with `x-hiveku-firewall: blocked`; a request from a known bulk-scraper network gets a 403 with `x-hiveku-firewall: blocked-network`; a 403 without that header comes from the site itself\./,
    );
    assert.match(text, /never by the 403's body text/);
    assert.match(text, /never past the per-IP limit \(429\), the high-volume challenge or the `blocked-network` 403/);
    assert.doesNotMatch(text, /a 403 is always/i);
  });
});
