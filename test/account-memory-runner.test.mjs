/**
 * The account memory outside the extension host (memory programme A7, review
 * findings A7-X4 and A7-X5).
 *
 * X4: the generated `.hiveku/pull-data.mjs` is what agents run in a VS Code
 * account folder. It must accept `account` as a target and refresh
 * hiveku-data/account/ACCOUNT_MEMORY.md on every run except `--dataset`, with
 * the SAME bytes the extension (and the plugin) writes, read-only, and never
 * over a good copy when the read fails.
 *
 * X5: STATUS.json reports the account memory the way the plugin does: an
 * `account_memory` block and a `failed` entry `{ department: 'account',
 * dataset: 'account-memory' }`. The extension's exporter must not erase that
 * entry, and the extension's own copy refresh must record its result there.
 *
 * The runner is driven for real: generated into a temp folder and run with
 * node against a local fake MCP server.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadOut, fakeClient } from './helpers/load.mjs';

const am = loadOut('accountMemory');
const dr = loadOut('dataRunner');
const dx = loadOut('dataExport');
const { DEPARTMENTS } = loadOut('deptData');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const MEMORY = {
  data: {
    content: '## About the business\nFamily-run stairlift installer in Leeds.\n',
    version: 12,
    updated_at: '2026-09-23T14:02:11.000Z',
    bytes: 63,
    suggestions: [
      { id: 'a1', at: '2026-09-23T14:02:00Z', source: 'Sales', text: 'Closed on Mondays from November to March.' },
      { id: 'b2', at: 'not a date', source: '', text: 'Say "hi"\u2028there\\now' },
    ],
    suggestions_version: 3,
    injected: '<account_memory>...</account_memory>',
    truncated: true,
  },
};
const DEPT = DEPARTMENTS.find((d) => d.datasets.length > 0 && !d.references?.length && !d.datasets.some((ds) => ds.scope || ds.detail));

// ── fake MCP server ─────────────────────────────────────────────────────────
// `answers[tool]` is a value, an Error (a tool error), or a function.
let answers = {};
let seen = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const msg = JSON.parse(body);
  const reply = (result) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  };
  if (msg.method !== 'tools/call') return reply({});
  const name = msg.params.name;
  seen.push(name);
  let a = answers[name];
  if (a === undefined) a = { data: [] };
  if (typeof a === 'function') a = a();
  if (a instanceof Error) return reply({ isError: true, content: [{ type: 'text', text: a.message }] });
  return reply({ content: [{ type: 'text', text: JSON.stringify(a) }] });
});
let endpoint;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
});
after(() => server.close());

async function accountFolder() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-am-runner-'));
  await dr.writeDataRunner(dir, [DEPT.id]);
  await fs.writeFile(
    path.join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { hiveku: { url: endpoint, headers: { Authorization: 'Bearer test' } } } }),
  );
  return dir;
}

/** Run the generated runner (no shell); resolves with its exit code and output. */
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

const fileOf = (dir) => path.join(dir, 'hiveku-data', 'account', 'ACCOUNT_MEMORY.md');
const readStatus = async (dir) => JSON.parse(await fs.readFile(path.join(dir, 'hiveku-data', 'STATUS.json'), 'utf8'));
const fetchedAtOf = (text) => /^fetched_at: "([^"]+)"$/m.exec(text)?.[1];
function reset(extra = {}) {
  seen = [];
  answers = { account_memory_get: MEMORY, get_account_info: { data: [{ id: ACCOUNT, name: 'Acme' }] }, ...extra };
}

describe('generated runner: the account memory (A7-X4)', () => {
  test('a test department exists', () => assert.ok(DEPT, 'no simple department in the registry'));

  test('`account` is a target: writes the same bytes the extension writes, read-only, and records it in STATUS.json', async () => {
    reset();
    const dir = await accountFolder();
    const r = await run(dir, 'account');
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const text = await fs.readFile(fileOf(dir), 'utf8');
    const fetchedAt = fetchedAtOf(text);
    assert.ok(fetchedAt, 'fetched_at in the front matter');
    const ours = am.renderAccountMemoryDocument(am.parseAccountMemory(MEMORY), { accountId: ACCOUNT, fetchedAt });
    assert.equal(text, ours, 'byte for byte the extension renderer');
    assert.equal((await fs.stat(fileOf(dir))).mode & 0o222, 0, 'no write bit');
    assert.ok(!seen.some((t) => t !== 'account_memory_get' && t !== 'get_account_info'), `no department tool: ${seen}`);
    const st = await readStatus(dir);
    assert.deepEqual(st.account_memory, {
      file: 'hiveku-data/account/ACCOUNT_MEMORY.md',
      read_only: true,
      fetched_at: fetchedAt,
      version: 12,
      suggestions: 2,
    });
    assert.deepEqual(st.failed, []);
    assert.match(r.stdout, /account\/ACCOUNT_MEMORY\.md: version 12, 2 suggestions \(read-only; edit on the dashboard\)/);
  });

  test('a department pull refreshes the copy too, and replaces a read-only one', async () => {
    reset();
    const dir = await accountFolder();
    assert.equal((await run(dir, 'account')).code, 0);
    reset({ account_memory_get: { data: { ...MEMORY.data, content: 'Second version.', version: 13 } } });
    const r = await run(dir, DEPT.id);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    const text = await fs.readFile(fileOf(dir), 'utf8');
    assert.ok(text.includes('Second version.'));
    assert.equal((await fs.stat(fileOf(dir))).mode & 0o222, 0);
    assert.deepEqual(await fs.readdir(path.dirname(fileOf(dir))), ['ACCOUNT_MEMORY.md'], 'no temp file left');
    assert.ok(seen.includes(DEPT.datasets[0].tool), 'negative control: the department was pulled');
  });

  test('--dataset does not read the account memory (a targeted refresh after a write)', async () => {
    reset();
    const dir = await accountFolder();
    const r = await run(dir, '--dataset', `${DEPT.id}:${DEPT.datasets[0].id}`);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.ok(!seen.includes('account_memory_get'));
    await assert.rejects(fs.access(fileOf(dir)));
  });

  test('an unknown name is still refused (negative control: only `account` was added)', async () => {
    reset();
    const dir = await accountFolder();
    const r = await run(dir, 'accounts');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Unknown department\(s\): accounts/);
    assert.ok(!seen.length, 'nothing called');
  });

  test('a failed read keeps the previous copy and records the failure the way the plugin does', async () => {
    reset();
    const dir = await accountFolder();
    assert.equal((await run(dir, 'account')).code, 0);
    const before = await fs.readFile(fileOf(dir), 'utf8');
    reset({ account_memory_get: new Error('boom 500') });
    const r = await run(dir, 'account');
    assert.equal(r.code, 1, 'the only read failed');
    assert.equal(await fs.readFile(fileOf(dir), 'utf8'), before);
    const st = await readStatus(dir);
    assert.deepEqual(st.failed, [
      { department: 'account', dataset: 'account-memory', error: 'Tool account_memory_get errored: boom 500' },
    ]);
    assert.equal(st.account_memory.kept_previous, true);
    assert.equal(st.account_memory.error, 'Tool account_memory_get errored: boom 500');
    // A later department run that does read it clears the entry.
    reset();
    assert.equal((await run(dir, DEPT.id)).code, 0);
    const again = await readStatus(dir);
    assert.deepEqual(again.failed.filter((f) => f.department === 'account'), []);
    assert.equal(again.account_memory.version, 12);
  });

  test('a wrong-shaped answer is a failure, not an empty memory over a good copy', async () => {
    reset();
    const dir = await accountFolder();
    assert.equal((await run(dir, 'account')).code, 0);
    const before = await fs.readFile(fileOf(dir), 'utf8');
    reset({ account_memory_get: { data: { version: 'x' } } });
    await run(dir, 'account');
    assert.equal(await fs.readFile(fileOf(dir), 'utf8'), before);
    assert.match((await readStatus(dir)).failed[0].error, /unexpected shape/);
  });

  test('without an account id the link is the unscoped dashboard page', async () => {
    reset({ get_account_info: new Error('not in this profile') });
    const dir = await accountFolder();
    assert.equal((await run(dir, 'account')).code, 0);
    const text = await fs.readFile(fileOf(dir), 'utf8');
    assert.equal(text, am.renderAccountMemoryDocument(am.parseAccountMemory(MEMORY), { accountId: '', fetchedAt: fetchedAtOf(text) }));
    assert.ok(text.includes('edit_url: "https://app.hiveku.com/dashboard/memory"'));
    assert.ok(!text.includes('<account'));
  });

  test('a failure recorded for a department is kept when only the account memory is read', async () => {
    reset({ [DEPT.datasets[0].tool]: new Error('dept down') });
    const dir = await accountFolder();
    await run(dir, DEPT.id);
    const first = await readStatus(dir);
    assert.ok(first.failed.some((f) => f.department === DEPT.id), `the department failure is recorded: ${JSON.stringify(first.failed)}`);
    reset();
    await run(dir, 'account');
    const st = await readStatus(dir);
    assert.ok(st.failed.some((f) => f.department === DEPT.id), 'kept');
  });

  test('--stale refreshes a stale copy and skips a fresh one; --list shows it', async () => {
    reset();
    const dir = await accountFolder();
    const list0 = await run(dir, '--list');
    assert.match(list0.stdout, /account\s+not downloaded \(account memory, read-only\)/);
    assert.equal((await run(dir, DEPT.id)).code, 0);
    reset();
    const fresh = await run(dir, '--stale', '12');
    assert.equal(fresh.code, 0, fresh.stderr);
    assert.match(fresh.stdout, /All default departments fresh/);
    assert.ok(!seen.includes('account_memory_get'));
    // Age only the account memory copy.
    const text = await fs.readFile(fileOf(dir), 'utf8');
    await fs.chmod(fileOf(dir), 0o644);
    await fs.writeFile(fileOf(dir), text.replace(/^fetched_at: "[^"]+"$/m, 'fetched_at: "2020-01-01T00:00:00.000Z"'));
    reset();
    const stale = await run(dir, '--stale', '12');
    assert.equal(stale.code, 0, stale.stderr);
    assert.ok(seen.includes('account_memory_get'), 'stale copy refreshed');
    assert.ok(!seen.includes(DEPT.datasets[0].tool), 'fresh department left alone');
    const list = await run(dir, '--list');
    assert.match(list.stdout, /account\s+fetched 20\d\d-/);
  });
});

describe('STATUS.json and the account memory (A7-X5)', () => {
  test('refreshAccountMemoryCopy records success, then a failure, the way the plugin does', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-am-status-'));
    await fs.mkdir(path.join(dir, 'hiveku-data'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'hiveku-data', 'STATUS.json'),
      JSON.stringify({ failed: [{ department: 'seo', dataset: 'keywords', error: 'x' }] }),
    );
    const ok = await am.refreshAccountMemoryCopy(fakeClient({ account_memory_get: MEMORY }), dir, { accountId: ACCOUNT });
    assert.equal(ok.ok, true);
    let st = await readStatus(dir);
    assert.deepEqual(st.account_memory, {
      file: 'hiveku-data/account/ACCOUNT_MEMORY.md',
      read_only: true,
      fetched_at: ok.fetched_at,
      version: 12,
      suggestions: 2,
    });
    assert.deepEqual(st.failed, [{ department: 'seo', dataset: 'keywords', error: 'x' }], 'other entries kept');
    const before = await fs.readFile(fileOf(dir), 'utf8');

    const bad = await am.refreshAccountMemoryCopy(fakeClient({ account_memory_get: new Error('down') }), dir, { accountId: ACCOUNT });
    assert.deepEqual({ ok: bad.ok, kept: bad.kept, error: bad.error }, { ok: false, kept: true, error: 'down' });
    assert.equal(await fs.readFile(fileOf(dir), 'utf8'), before, 'good copy kept');
    st = await readStatus(dir);
    assert.deepEqual(st.failed, [
      { department: 'seo', dataset: 'keywords', error: 'x' },
      { department: 'account', dataset: 'account-memory', error: 'down' },
    ]);
    assert.deepEqual(st.account_memory, {
      file: 'hiveku-data/account/ACCOUNT_MEMORY.md',
      read_only: true,
      fetched_at: bad.fetched_at,
      error: 'down',
      kept_previous: true,
    });

    // Success again clears the account entry, and only it.
    await am.refreshAccountMemoryCopy(fakeClient({ account_memory_get: MEMORY }), dir, { accountId: ACCOUNT });
    st = await readStatus(dir);
    assert.deepEqual(st.failed, [{ department: 'seo', dataset: 'keywords', error: 'x' }]);
  });

  test('refreshAccountMemoryCopy never throws, even with no STATUS.json and no copy', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-am-status-'));
    const r = await am.refreshAccountMemoryCopy(fakeClient({ account_memory_get: { data: [] } }), dir, { accountId: ACCOUNT });
    assert.equal(r.ok, false);
    assert.equal(r.kept, false);
    assert.match(r.error, /unexpected shape/);
    const st = await readStatus(dir);
    assert.deepEqual(st.failed, [{ department: 'account', dataset: 'account-memory', error: r.error }]);
  });

  test('the exporter keeps the account memory failure and block when it rewrites `failed`', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-am-export-'));
    await fs.mkdir(path.join(dir, 'hiveku-data'), { recursive: true });
    const block = { file: 'hiveku-data/account/ACCOUNT_MEMORY.md', read_only: true, fetched_at: 'T', error: 'down', kept_previous: true };
    await fs.writeFile(
      path.join(dir, 'hiveku-data', 'STATUS.json'),
      JSON.stringify({
        account_memory: block,
        failed: [
          { department: 'account', dataset: 'account-memory', error: 'down' },
          { department: DEPT.id, dataset: DEPT.datasets[0].id, error: 'old failure' },
          { department: 'zz-not-exported', dataset: 'rows', error: 'still down' },
        ],
      }),
    );
    const client = fakeClient(Object.fromEntries(DEPT.datasets.map((ds) => [ds.tool, { data: [{ id: 1 }] }])));
    await dx.exportDepartments(client, [DEPT], dir, 'Acme');
    const st = await readStatus(dir);
    assert.deepEqual(st.account_memory, block);
    assert.deepEqual(st.failed, [
      { department: 'account', dataset: 'account-memory', error: 'down' },
      { department: 'zz-not-exported', dataset: 'rows', error: 'still down' },
    ]);
    // Negative control: the exported department's old failure is gone (it succeeded).
    assert.ok(!st.failed.some((f) => f.department === DEPT.id));
  });

  test('the exporter still records a fresh department failure (negative control)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-am-export-'));
    const client = fakeClient(Object.fromEntries(DEPT.datasets.map((ds) => [ds.tool, new Error('dead key')])));
    await dx.exportDepartments(client, [DEPT], dir, 'Acme');
    const st = await readStatus(dir);
    assert.equal(st.failed.length, DEPT.datasets.length);
    assert.ok(st.failed.every((f) => f.department === DEPT.id));
  });
});
