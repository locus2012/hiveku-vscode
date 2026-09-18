/**
 * Prove the two scripts the extension writes onto a user's machine identify as
 * Hiveku and read the edge firewall's answer correctly.
 *
 * WHY. automations/lib.mjs and .hiveku/pull-data.mjs run outside the extension
 * host, so nothing in the extension's own runtime ever exercises them: they are
 * template strings in src/localAutomations.ts and src/dataRunner.ts, and a slip
 * there ships as a script that fails on the customer's machine at 3am. The
 * generated http() helper also has to tell the edge firewall's challenge (any
 * response carrying x-amzn-waf-action, or HTTP 202 with an empty body) apart
 * from a third-party API's ordinary async accept (HTTP 202 with a small JSON
 * body, no header): the first version of that check threw the firewall sentence
 * for ANY small 202 and broke a legitimate path with a message that blamed the
 * wrong system. This script runs the generated file against a local server that
 * answers every one of those ways.
 *
 * Reads the compiled out/ (the version string comes from package.json relative
 * to __dirname, which only exists in the CommonJS build), so run `npm run
 * compile` first; a missing or stale out/ is refused rather than tested.
 *
 * Run: npm run check:generated-scripts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

for (const name of ['hivekuUserAgent', 'localAutomations', 'dataRunner']) {
  const src = join(ROOT, 'src', `${name}.ts`);
  const out = join(ROOT, 'out', `${name}.js`);
  if (!existsSync(out)) {
    console.error(`check-generated-scripts: ${out} is missing. Run 'npm run compile' first.`);
    process.exit(1);
  }
  if (statSync(out).mtimeMs < statSync(src).mtimeMs) {
    console.error(`check-generated-scripts: ${out} is older than ${src}. Run 'npm run compile' first.`);
    process.exit(1);
  }
}

let n = 0;
const check = (name, fn) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};
const checkAsync = async (name, fn) => {
  await fn();
  n++;
  console.log(`  ok  ${name}`);
};
const nodeCheck = (file) => {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, `node --check ${file}: ${r.stderr}`);
};

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const ua = require(join(ROOT, 'out', 'hivekuUserAgent.js'));
const la = require(join(ROOT, 'out', 'localAutomations.js'));
const dr = require(join(ROOT, 'out', 'dataRunner.js'));
const AGENT = /^(HivekuVSCode|HivekuLocalAutomation|HivekuDataRunner)\/(\d+\.\d+\.\d+) \(\+https:\/\/hiveku\.com\)$/;

// ── the helper every client uses ────────────────────────────────────────────
check('hivekuUserAgent() follows the convention and carries the installed version', () => {
  const agent = ua.hivekuUserAgent();
  const m = AGENT.exec(agent);
  assert.ok(m, agent);
  assert.equal(m[1], 'HivekuVSCode');
  assert.equal(m[2], pkg.version);
  assert.match(agent, /Hiveku/);
});
const headers = (o = {}) => ({ get: (k) => o[k.toLowerCase()] ?? null });
check('isEdgeChallenge: the header is authoritative on any status', () => {
  assert.equal(ua.isEdgeChallenge({ status: 202, headers: headers({ 'x-amzn-waf-action': 'challenge' }) }, 0), true);
  assert.equal(ua.isEdgeChallenge({ status: 405, headers: headers({ 'x-amzn-waf-action': 'captcha' }) }), true);
  assert.equal(ua.isEdgeChallenge({ status: 200, headers: headers({ 'x-amzn-waf-action': 'challenge' }) }, 50000), true);
});
check('isEdgeChallenge: a bare 202 with no or a tiny body is the challenge, a real page is not', () => {
  assert.equal(ua.isEdgeChallenge({ status: 202, headers: headers() }), true);
  assert.equal(ua.isEdgeChallenge({ status: 202, headers: headers() }, 0), true);
  assert.equal(ua.isEdgeChallenge({ status: 202, headers: headers() }, 5000), false);
  assert.equal(ua.isEdgeChallenge({ status: 200, headers: headers() }, 50000), false);
  assert.equal(ua.isEdgeChallenge({ status: 404, headers: headers() }, 10), false);
});
check('EDGE_CHALLENGE_MESSAGE names the firewall, the Hiveku agent and HEAD, and rules out the wrong verdicts', () => {
  assert.match(ua.EDGE_CHALLENGE_MESSAGE, /edge firewall/);
  assert.match(ua.EDGE_CHALLENGE_MESSAGE, /containing Hiveku/);
  assert.match(ua.EDGE_CHALLENGE_MESSAGE, /HEAD/);
  assert.match(ua.EDGE_CHALLENGE_MESSAGE, /not an empty site and not a failed deploy/);
});

// ── the generated files ─────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'hiveku-generated-scripts-'));
const libPath = join(tmp, 'lib.mjs');
check('automations/lib.mjs bakes HivekuLocalAutomation/<version> in and sends it on every rpc', () => {
  const lib = la.automationFiles()['automations/lib.mjs'];
  assert.equal(typeof lib, 'string');
  const m = /HIVEKU_USER_AGENT = '([^']+)'/.exec(lib);
  assert.ok(m, 'HIVEKU_USER_AGENT constant missing');
  const agent = AGENT.exec(m[1]);
  assert.ok(agent, m[1]);
  assert.equal(agent[1], 'HivekuLocalAutomation');
  assert.equal(agent[2], pkg.version);
  assert.match(lib, /'User-Agent': HIVEKU_USER_AGENT/);
  writeFileSync(libPath, lib);
  nodeCheck(libPath);
});
await checkAsync('.hiveku/pull-data.mjs bakes HivekuDataRunner/<version> in and parses', async () => {
  await dr.writeDataRunner(tmp);
  const runner = readFileSync(join(tmp, dr.RUNNER_REL_PATH), 'utf8');
  const m = /'User-Agent': '([^']+)'/.exec(runner);
  assert.ok(m, 'User-Agent header missing from the data runner rpc');
  const agent = AGENT.exec(m[1]);
  assert.ok(agent, m[1]);
  assert.equal(agent[1], 'HivekuDataRunner');
  assert.equal(agent[2], pkg.version);
  assert.equal(dr.RUNNER_VERSION, 4);
  nodeCheck(join(tmp, dr.RUNNER_REL_PATH));
});

// ── the generated http() against a server that answers every way ───────────
const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  const seenAgent = req.headers['user-agent'] || '';
  const custom = req.headers['x-custom'] || null;
  switch (pathname) {
    case '/ok':
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ agent: seenAgent, custom }));
    // The edge firewall's real answer to a client that cannot run JavaScript.
    case '/waf-202':
      res.writeHead(202, { 'x-amzn-waf-action': 'challenge' });
      return res.end();
    // The same header on a body and on other statuses (a captcha is 405).
    case '/waf-202-body':
      res.writeHead(202, { 'x-amzn-waf-action': 'challenge', 'content-type': 'text/html' });
      return res.end('<html><body><script src="challenge.compact.js"></script></body></html>');
    case '/waf-405':
      res.writeHead(405, { 'x-amzn-waf-action': 'captcha' });
      return res.end();
    case '/waf-200':
      res.writeHead(200, { 'x-amzn-waf-action': 'challenge', 'content-type': 'text/html' });
      return res.end('<html></html>');
    // A 202 with nothing in the body and no header: the challenge through a proxy that dropped the header.
    case '/bare-202':
      res.writeHead(202);
      return res.end();
    case '/bare-202-whitespace':
      res.writeHead(202, { 'content-type': 'text/plain' });
      return res.end('\n  \n');
    // The ordinary async accept of a third-party API. Never a challenge.
    case '/accepted-json':
      res.writeHead(202, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'accepted', id: 'abc123' }));
    case '/accepted-text':
      res.writeHead(202, { 'content-type': 'text/plain' });
      return res.end('queued');
    default:
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('no such route');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const host = `127.0.0.1:${server.address().port}`;
const base = `http://${host}`;
const lib = await import(pathToFileURL(libPath).href);
const thrown = async (path, opts) => {
  try {
    await lib.http(base + path, opts);
  } catch (err) {
    return err.message;
  }
  assert.fail(`http('${path}') returned instead of throwing`);
};
const CHALLENGE = /the edge firewall challenged this client; send a user agent containing Hiveku, or use a HEAD request\. This is not an empty site and not a failed deploy\./;

await checkAsync('http() sends the Hiveku agent by default', async () => {
  const body = await lib.http(base + '/ok');
  assert.match(body.agent, AGENT);
  assert.match(body.agent, /^HivekuLocalAutomation\//);
});
await checkAsync('http() keeps a worker\'s own headers as a plain object, a Headers instance or an array', async () => {
  const plain = await lib.http(base + '/ok', { headers: { 'User-Agent': 'MyWorker/1.0', 'X-Custom': 'a' } });
  assert.equal(plain.agent, 'MyWorker/1.0');
  assert.equal(plain.custom, 'a');
  const instance = await lib.http(base + '/ok', { headers: new Headers({ 'X-Custom': 'b' }) });
  assert.equal(instance.custom, 'b');
  assert.match(instance.agent, /^HivekuLocalAutomation\//);
  const pairs = await lib.http(base + '/ok', { headers: [['X-Custom', 'c']] });
  assert.equal(pairs.custom, 'c');
});
await checkAsync('http() reads the firewall header as the challenge on 202, 405 and 200, body or not, and names the host', async () => {
  for (const [path, status, action] of [['/waf-202', 202, 'challenge'], ['/waf-202-body', 202, 'challenge'], ['/waf-405', 405, 'captcha'], ['/waf-200', 200, 'challenge']]) {
    const message = await thrown(path);
    assert.match(message, CHALLENGE, path);
    assert.ok(message.startsWith(`HTTP ${status} from ${host} (x-amzn-waf-action: ${action}): `), `${path}: ${message}`);
    assert.doesNotMatch(message, /not on Hiveku hosting/, `${path}: the header is proof, no hedge`);
  }
});
await checkAsync('http() reads a header-less 202 with an empty body as the challenge, names the host and says what else it could be', async () => {
  for (const path of ['/bare-202', '/bare-202-whitespace']) {
    const message = await thrown(path);
    assert.match(message, CHALLENGE, path);
    assert.ok(message.startsWith(`HTTP 202 from ${host} with an empty body: `), `${path}: ${message}`);
    assert.match(message, new RegExp(`If ${host.replace('.', '\\.')} is not on Hiveku hosting, it accepted the request and returned nothing`), path);
  }
});
await checkAsync('http() returns a header-less 202 that carries a body: the async accept of a third-party API is not a challenge', async () => {
  assert.deepEqual(await lib.http(base + '/accepted-json'), { status: 'accepted', id: 'abc123' });
  assert.equal(await lib.http(base + '/accepted-text'), 'queued');
});
await checkAsync('http() still reports an ordinary error status as HTTP <status>', async () => {
  const message = await thrown('/missing');
  assert.match(message, /^HTTP 404: no such route/);
  assert.doesNotMatch(message, /edge firewall/);
});

server.close();
rmSync(tmp, { recursive: true, force: true });
console.log(`OK: ${n} checks on the generated scripts (lib.mjs, pull-data.mjs) and the user-agent helper`);
