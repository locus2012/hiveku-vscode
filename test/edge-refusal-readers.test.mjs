/**
 * HK-847: what each reader says when requests to Hiveku fail. A refusal from
 * the web edge in front of Hiveku is never told as an expired key, and never
 * offers to reconnect; Hiveku's own JSON 401 still is, and still does.
 * test/core-edge-gzip.test.mjs covers the client and the scripts; this file
 * covers the words and buttons people see:
 *   1. console.ts deadKeyBanner: the account console's "key looks dead" banner.
 *   2. dataFailures.ts readAllFailed: why every department failed. The rule is
 *      the data runner's closing line: only Hiveku's own 401 blames the key, and
 *      it does even beside edge refusals.
 *   3. allFailedWarning: Download Department Data's words and buttons.
 *   4. everythingDataNote: Download Everything's sentence (also the
 *      post-connect "Set up which account?" flow).
 *   5. DataRefresher: auto-refresh's stale-data warning, end to end.
 *   6. /hiveku-pull-data step 4 follows the runner's closing line.
 * Each one runs on real errors from a local stub (test/helpers/core-stub.mjs):
 * the edge's block page, an answer cut off before it could be read, and
 * Hiveku's own JSON 401. No request reaches a live host.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calls, resetCalls } from './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';
import { BLOCK_PAGE, RAY, REVOKED_KEY_MESSAGE, coreAuthRefusal, cutOff, rejection, startStub } from './helpers/core-stub.mjs';

const mc = loadOut('mcpClient');
const dx = loadOut('dataExport');
const df = loadOut('dataFailures');
const dr = loadOut('dataRunner');
const { deadKeyBanner } = loadOut('console');
const { DataRefresher } = loadOut('dataRefresh');
const { writeRoleSlashCommands } = loadOut('roleCommands');
const { DEPARTMENTS } = loadOut('deptData');

/**
 * The smallest department with two or more plain list datasets and a page gate
 * of its own (content today): an export pauses 250 ms between datasets, and the
 * gate lets auto-refresh export it alone.
 */
const DEPT = DEPARTMENTS.filter(
  (d) =>
    d.datasets.length >= 2 &&
    !d.references?.length &&
    !d.datasets.some((ds) => ds.scope || ds.detail) &&
    DEPARTMENTS.filter((other) => other.gate === d.gate).length === 1,
).sort((a, b) => a.datasets.length - b.datasets.length)[0];
const RECORD = { label: 'Acme', accountId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' };
const clientFor = (stub) => new mc.HivekuMcpClient({ baseUrl: stub.base, apiKey: 'hvk_test_placeholder' });
const tmp = (prefix) => fs.mkdtemp(path.join(os.tmpdir(), prefix));
const datasets = (n) => (n === 1 ? '1 dataset' : `${n} datasets`);

/** Hiveku's own 401, as core's auth middleware sends it for a revoked key. */
const keyRefusal = (rpc) => coreAuthRefusal(401, rpc.id, REVOKED_KEY_MESSAGE);
const serverError = {
  status: 500,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'stub server error' } }),
};

/**
 * The ways a whole download fails. `answer(rpc)` is the stub's answer to each
 * tools/call (the handshake is answered as usual).
 */
const RUNS = {
  edge: () => BLOCK_PAGE,
  key: keyRefusal,
  // The first dataset the edge refused, the second Hiveku refused the key, the rest the edge again.
  edgeThenKey: (rpc) => (rpc.params.name === DEPT.datasets[1].tool ? keyRefusal(rpc) : BLOCK_PAGE),
  unread: () => cutOff(401),
  // One answer the edge sent, every other one cut off.
  edgeAndUnread: (rpc) => (rpc.params.name === DEPT.datasets[0].tool ? BLOCK_PAGE : cutOff(401)),
  server: () => serverError,
};

/** Export DEPT against a stub answering every tools/call with `answer`; the failed datasets come back. */
async function exportWith(answer) {
  const stub = await startStub((rpc) => (rpc?.method === 'tools/call' ? answer(rpc) : undefined));
  const dir = await tmp('hvk-readers-export-');
  try {
    const results = await dx.exportDepartments(clientFor(stub), [DEPT], dir, RECORD.label);
    assert.equal(dx.everyDepartmentFailed(results), true, 'every department failed');
    return dx.failedDatasets(results);
  } finally {
    await stub.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const failedBy = {};
before(async () => {
  assert.ok(DEPT, 'a small department with plain list datasets and a gate of its own');
  for (const [name, answer] of Object.entries(RUNS)) failedBy[name] = await exportWith(answer);
});

/** Words a person reads: plain, no em or en dash, no vendor names. */
function assertPlain(text) {
  assert.doesNotMatch(text, /[—–]/, `no em or en dash: ${text}`);
  assert.doesNotMatch(text, /cloudflare|render\b|\bwaf\b|\bcdn\b|amazon|\baws\b/i, `no vendor names: ${text}`);
}

/* ── 1. the console banner ───────────────────────────────────────────────── */

describe('console.ts deadKeyBanner', () => {
  async function errorFrom(reply) {
    const stub = await startStub((rpc) => (rpc?.method === 'tools/call' ? reply(rpc) : undefined));
    try {
      return await rejection(clientFor(stub).callTool('account_entitlements', {}));
    } finally {
      await stub.close();
    }
  }

  test('a refusal from the web edge, on any status, or an answer that could not be read, gets no banner', async () => {
    const edge403 = await errorFrom(() => BLOCK_PAGE);
    const edge401 = await errorFrom(() => ({ status: 401, headers: { 'content-type': 'text/html', 'cf-ray': RAY }, body: '<html><title>Unauthorized</title></html>' }));
    const unread = await errorFrom(() => cutOff(401));
    for (const err of [edge403, edge401, unread, new Error(`Could not load: ${edge401.message}`), edge401.message]) {
      assert.equal(deadKeyBanner(err), null, String(err));
    }
    assert.match(edge401.message, /HTTP 401/, 'the edge 401 carries its status, which the banner used to read as a dead key');
  });

  test("Hiveku's own JSON 401 and a missing key still get the banner", async () => {
    const own401 = await errorFrom(keyRefusal);
    assert.match(own401.message, /^MCP HTTP 401: \{"jsonrpc":"2\.0"/);
    const banner = deadKeyBanner(own401);
    assert.equal(banner, `This account's key looks dead (${own401.message.slice(0, 120)}). Run "Hiveku: Connect Hiveku" to mint a fresh one.`);
    assert.match(deadKeyBanner(new Error(`No stored key for account ${RECORD.accountId}. Run "Hiveku: Sign In".`)), /^This account's key looks dead \(No stored key/);
    assert.equal(deadKeyBanner(new Error('MCP request timed out after 135s (tools/call)')), null, 'a time-out is no key problem');
  });
});

/* ── 2. why every department failed ──────────────────────────────────────── */

describe('dataFailures.ts readAllFailed: the runner closing line rule', () => {
  test('the edge refused every dataset: the edge, counted, and the first one shown', () => {
    const failed = failedBy.edge;
    assert.equal(failed.length, DEPT.datasets.length);
    const reading = df.readAllFailed(failed);
    assert.equal(reading.cause, 'edge');
    assert.equal(reading.edgeRefused, failed.length);
    assert.equal(reading.unreadable, 0);
    assert.equal(reading.shown, failed[0]);
    assert.equal(reading.shown.error, mc.coreEdgeRefusalMessage(403, RAY));
  });

  test("Hiveku's own JSON 401 on every dataset: the key", () => {
    const reading = df.readAllFailed(failedBy.key);
    assert.equal(reading.cause, 'key');
    assert.match(reading.shown.error, /^MCP HTTP 401: /);
  });

  test("Hiveku's own 401 on one dataset beside edge refusals still blames the key, and shows that dataset", () => {
    const failed = failedBy.edgeThenKey;
    assert.ok(mc.isCoreEdgeRefusal(failed[0].error), 'the first failure is the edge refusing');
    const reading = df.readAllFailed(failed);
    assert.equal(reading.cause, 'key');
    assert.equal(reading.shown.dataset, DEPT.datasets[1].id);
    assert.match(reading.shown.error, /^MCP HTTP 401: /);
    assert.equal(reading.edgeRefused, failed.length - 1);
  });

  test('answers that could not be read are counted apart from the edge, and are no key problem', () => {
    const unread = df.readAllFailed(failedBy.unread);
    assert.deepEqual([unread.cause, unread.edgeRefused, unread.unreadable], ['edge', 0, DEPT.datasets.length]);
    assert.equal(unread.shown.error, mc.coreRefusalUnreadMessage(401));
    const mixed = df.readAllFailed(failedBy.edgeAndUnread);
    assert.deepEqual([mixed.cause, mixed.edgeRefused, mixed.unreadable], ['edge', 1, DEPT.datasets.length - 1]);
    assert.equal(mixed.shown.dataset, DEPT.datasets[0].id, 'the edge refusal is shown first: it carries the ray id');
  });

  test('failures that are none of these keep the old reading', () => {
    const reading = df.readAllFailed(failedBy.server);
    assert.deepEqual([reading.cause, reading.edgeRefused, reading.unreadable], ['other', 0, 0]);
    assert.equal(reading.shown, failedBy.server[0]);
  });
});

/* ── 3. Download Department Data ─────────────────────────────────────────── */

describe('dataFailures.ts allFailedWarning (Download Department Data)', () => {
  const warn = (failed) => df.allFailedWarning({ label: RECORD.label, datasetTotal: failed.length, failed });
  const lead = (n) => `Nothing was downloaded for Acme: no department returned data (${n} of ${n} datasets failed), so hiveku-data/ has no new data.`;

  test('the edge refused the requests: no Reconnect, no word of an expired key, and the ray id in the first error', () => {
    const failed = failedBy.edge;
    const { message, actions } = warn(failed);
    assert.deepEqual(actions, ['Open index']);
    assert.ok(message.startsWith(lead(failed.length)), message);
    assert.ok(
      message.includes(
        `The web edge in front of Hiveku refused the requests for ${datasets(failed.length)}, so they never reached Hiveku. ` +
          'None of this is a sign that the account key stopped working, so there is no need to reconnect. Run this again later.',
      ),
      message,
    );
    assert.ok(message.includes(`First error: ${DEPT.id}/${DEPT.datasets[0].id}: The web edge in front of Hiveku refused this one request (HTTP 403, ray id ${RAY})`), message);
    assert.doesNotMatch(message, /expired|revoked|usual cause/i);
    assertPlain(message);
  });

  test("Hiveku's own JSON 401 keeps Reconnect and the key wording", () => {
    const { message, actions } = warn(failedBy.key);
    assert.deepEqual(actions, ['Reconnect account', 'Open index']);
    assert.ok(message.includes('The usual cause is an expired or revoked account key: reconnect and run this again.'), message);
    assert.ok(message.includes(`First error: ${DEPT.id}/${DEPT.datasets[0].id}: MCP HTTP 401: `), message);
    assertPlain(message);
  });

  test("an edge refusal first and Hiveku's own 401 later keeps Reconnect, and shows the 401, not the edge's words", () => {
    const { message, actions } = warn(failedBy.edgeThenKey);
    assert.deepEqual(actions, ['Reconnect account', 'Open index']);
    assert.ok(message.includes(`First error: ${DEPT.id}/${DEPT.datasets[1].id}: MCP HTTP 401: `), message);
    assert.doesNotMatch(message, /no need to reconnect/, 'never "reconnect" and "no need to reconnect" in one warning');
  });

  test('answers that could not be read say so, offer no Reconnect, and never claim the edge refused them', () => {
    const unread = warn(failedBy.unread);
    assert.deepEqual(unread.actions, ['Open index']);
    assert.ok(
      unread.message.includes(
        `For ${datasets(DEPT.datasets.length)} the answers could not be read, so it is not known whether Hiveku or the web edge in front of Hiveku refused them.`,
      ),
      unread.message,
    );
    assert.doesNotMatch(unread.message, /refused the requests for/);
    assertPlain(unread.message);
    const mixed = warn(failedBy.edgeAndUnread);
    assert.deepEqual(mixed.actions, ['Open index']);
    assert.ok(mixed.message.includes('The web edge in front of Hiveku refused the requests for 1 dataset, so they never reached Hiveku.'), mixed.message);
    // One dataset the edge refused; every other answer was cut off.
    const rest = DEPT.datasets.length - 1;
    const unreadWords =
      rest === 1
        ? 'For 1 dataset the answer could not be read, so it is not known whether Hiveku or the web edge in front of Hiveku refused it.'
        : `For ${rest} datasets the answers could not be read, so it is not known whether Hiveku or the web edge in front of Hiveku refused them.`;
    assert.ok(mixed.message.includes(unreadWords), mixed.message);
  });

  test('other failures keep the old reading: Reconnect, the usual cause', () => {
    const { message, actions } = warn(failedBy.server);
    assert.deepEqual(actions, ['Reconnect account', 'Open index']);
    assert.ok(message.includes('The usual cause is an expired or revoked account key'), message);
    assertPlain(message);
  });
});

/* ── 4. Download Everything ──────────────────────────────────────────────── */

describe('dataFailures.ts everythingDataNote (Download Everything, and "Set up which account?")', () => {
  const note = (failed, extra = {}) => df.everythingDataNote({ deptCount: 1, failed, allFailed: true, ...extra });
  const RECONNECT = 'Reconnect with the command "Hiveku: Connect Hiveku (sign in via browser)", then run this again.';

  test('the edge refused every request: no reconnect, and where the errors are', () => {
    const text = note(failedBy.edge);
    assert.ok(text.startsWith(` No department returned data: all 1 of them failed (${datasets(failedBy.edge.length)}). `), text);
    assert.ok(text.includes(df.notTheKeyWords({ edgeRefused: failedBy.edge.length, unreadable: 0 })), text);
    assert.ok(text.endsWith('is in hiveku-data/STATUS.json under "failed".'), text);
    assert.ok(!text.includes(RECONNECT), text);
    assert.doesNotMatch(text, /expired|revoked/i);
    assertPlain(text);
  });

  test("Hiveku's own JSON 401, alone or after edge refusals, names the reconnect command", () => {
    for (const failed of [failedBy.key, failedBy.edgeThenKey]) {
      const text = note(failed);
      assert.ok(text.endsWith(`which usually means this account's key is expired or revoked. ${RECONNECT}`), text);
      assertPlain(text);
    }
  });

  test('answers that could not be read get no reconnect either', () => {
    const text = note(failedBy.unread);
    assert.ok(!text.includes(RECONNECT), text);
    assert.ok(text.includes('the answers could not be read'), text);
  });

  test('the other notes: an export that threw, some datasets failed, none failed', () => {
    assert.equal(df.everythingDataNote({ deptError: 'disk full', deptCount: 0, failed: [], allFailed: false }), ' Department data was NOT downloaded: disk full');
    assert.equal(
      df.everythingDataNote({ deptCount: 2, failed: failedBy.edge.slice(0, 1), allFailed: false }),
      ' 1 dataset(s) failed and were not saved: they are listed in hiveku-data/STATUS.json under "failed".',
    );
    assert.equal(df.everythingDataNote({ deptCount: 2, failed: [], allFailed: false }), '');
  });
});

/* ── 5. auto-refresh ─────────────────────────────────────────────────────── */

describe('DataRefresher: the stale-data warning after a run of failed refreshes', () => {
  /** Only DEPT's page is entitled, so a tick exports just DEPT. */
  const DEPT_ONLY = Object.fromEntries(DEPARTMENTS.map((d) => [d.gate, d.id === DEPT.id]));

  /** One tick for an account whose refresh already failed twice, against a stub answering tools/call with `answer`. */
  async function tickWith(answer) {
    const stub = await startStub((rpc) => (rpc?.method === 'tools/call' ? answer(rpc) : undefined));
    const folder = await tmp('hvk-readers-refresh-');
    const state = new Map([['hiveku.autoRefresh', { [RECORD.accountId]: { enabled: true, intervalHours: 6, failures: 2 } }]]);
    const ctx = { globalState: { get: (k, d) => (state.has(k) ? state.get(k) : d), update: async (k, v) => void state.set(k, v) } };
    const accounts = { list: () => [RECORD], getFolder: () => folder, getRole: () => undefined, getDepartments: () => [] };
    try {
      resetCalls();
      const refresher = new DataRefresher(ctx, accounts, async () => clientFor(stub), async () => ({ page_access: DEPT_ONLY }), () => {});
      await refresher.tick();
      const prefs = state.get('hiveku.autoRefresh')[RECORD.accountId];
      assert.equal(prefs.failures, 3, 'the third failure in a row');
      assert.equal(calls.warnings.length, 1, 'one warning');
      const [message, ...actions] = calls.warnings[0];
      return { message, actions, lastError: prefs.lastError };
    } finally {
      await stub.close();
      await fs.rm(folder, { recursive: true, force: true });
    }
  }

  test('the edge refused the refresh: no Reconnect, and the edge words with the ray id as the last error', async () => {
    const { message, actions, lastError } = await tickWith(RUNS.edge);
    assert.deepEqual(actions, ['Retry now', 'Turn off auto-refresh']);
    assert.ok(lastError.startsWith(`every dataset failed (${DEPT.id}/${DEPT.datasets[0].id}): The web edge in front of Hiveku refused this one request (HTTP 403, ray id ${RAY})`), lastError);
    assert.ok(message.endsWith(`Last error: ${lastError}`), message);
  });

  test("Hiveku's own 401 anywhere in the run keeps Reconnect, and the last error is that 401", async () => {
    const { actions, lastError } = await tickWith(RUNS.edgeThenKey);
    assert.deepEqual(actions, ['Reconnect account', 'Retry now', 'Turn off auto-refresh']);
    assert.ok(lastError.startsWith(`every dataset failed (${DEPT.id}/${DEPT.datasets[1].id}): MCP HTTP 401: `), lastError);
  });

  test('refreshWarningActions reads the last error the same way', () => {
    assert.deepEqual(df.refreshWarningActions(`every dataset failed (${DEPT.id}/${DEPT.datasets[0].id}): ${mc.coreRefusalUnreadMessage(401)}`), ['Retry now', 'Turn off auto-refresh']);
    assert.deepEqual(df.refreshWarningActions(`No stored key for account ${RECORD.accountId}.`), ['Reconnect account', 'Retry now', 'Turn off auto-refresh']);
  });
});

/* ── 6. /hiveku-pull-data follows the runner ─────────────────────────────── */

describe('/hiveku-pull-data step 4 follows the data runner closing line', () => {
  let dir;
  let command;
  let runner;
  before(async () => {
    dir = await tmp('hvk-readers-pull-');
    await writeRoleSlashCommands(dir, undefined);
    command = await fs.readFile(path.join(dir, '.claude', 'commands', 'hiveku-pull-data.md'), 'utf8');
    await dr.writeDataRunner(dir, [DEPT.id]);
    runner = await fs.readFile(path.join(dir, dr.RUNNER_REL_PATH), 'utf8');
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('the key advice only on the line that names the key; the edge and unreadable lines say the key is fine', () => {
    const step = command.slice(command.indexOf('4. If the runner fails on every dataset'));
    const flat = step.replace(/\s+/g, ' ');
    assert.ok(flat.startsWith("4. If the runner fails on every dataset, its last line says why; follow it: - \"check the account key in .mcp.json\": the key is no longer valid. Tell the user to run \"Hiveku: Connect Hiveku\" for this account (never open or print the key file)."), flat);
    assert.ok(
      flat.includes(
        '- The web edge in front of Hiveku refused the requests, or their answers could not be read: the key is fine, so never ' +
          'tell the user to reconnect for it. Say so, and run it again later. If every run is refused that way, tell the user ' +
          'to give Hiveku support the ray id from the errors in hiveku-data/STATUS.json.',
      ),
      flat,
    );
    assert.doesNotMatch(flat, /errors on every dataset, this account's key is no longer valid/, 'the old categorical line is gone');
    assertPlain(step);
    // The phrases it keys on are the runner's own.
    assert.ok(runner.includes("'Every dataset failed — check the account key in .mcp.json.'"), 'the key line');
    assert.ok(runner.includes("'Every dataset failed. The web edge in front of Hiveku refused '"), 'the edge line');
    assert.ok(runner.includes('could not be read, so it is not known whether Hiveku or the web edge in front of Hiveku refused them'), 'the unreadable line');
  });
});

/* ── the readers use these helpers ───────────────────────────────────────── */

test('extension.ts and console.ts show these words, not words of their own', async () => {
  const src = (f) => fs.readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', f), 'utf8');
  const ext = await src('extension.ts');
  assert.match(ext, /const warning = allFailedWarning\(\{ label: account\.label, datasetTotal, failed \}\);\s*choice = await vscode\.window\.showWarningMessage\(warning\.message, \.\.\.warning\.actions\);/);
  assert.match(ext, /const dataNote = everythingDataNote\(\{ deptError, deptCount, failed: deptFailed, allFailed: deptAllFailed \}\);/);
  assert.match(ext, /deptFailed = failedDatasets\(results\);/);
  assert.doesNotMatch(ext, /usually means this account's key is expired|The usual cause is an expired or revoked account key/, 'the key wording lives in dataFailures.ts only');
  const consoleSrc = await src('console.ts');
  assert.match(consoleSrc, /const banner = deadKeyBanner\(err\);\s*if \(banner\) panel\.webview\.postMessage\(\{ type: 'banner', text: banner \}\);/);
});
