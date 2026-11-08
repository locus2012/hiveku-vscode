// Offboarding O8a review: a key pasted with "Sign in with a key" may be a
// teammate's. The website records who made a key, never who holds it, so its
// answer about a refused key is about whoever made it. A teammate who leaves the
// team switches off every key they made; the person here, still on the team,
// must keep everything. Only a key Connect Hiveku made here, for the person
// signed in to the browser, may remove an account from this computer.
//
// The store runs on an in-memory stand-in for VS Code's globalState and
// SecretStorage. The MCP server, the website's standing route and Connect's
// exchange are stubs on 127.0.0.1: no request reaches a Hiveku host. Every
// folder is under a fresh temporary folder, and every root, the home folder and
// the storage folder are passed in, so nothing outside it can be reached even
// with a check broken. Every key and id is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadOut } from './helpers/load.mjs';
import { coreAuthRefusal, REVOKED_KEY_MESSAGE, startStub } from './helpers/core-stub.mjs';

const { AccountStore } = loadOut('accounts');
const { ConnectFlow } = loadOut('connect');
const ks = loadOut('keyStanding');
const off = loadOut('offboarding');
const binding = loadOut('accountBinding');

const A = 'a0a0a0a0-0b0b-4c0c-8d0d-0e0e0e0e0e0e';
const madeUpKey = () => `hvk_${randomBytes(32).toString('hex')}`;

function fakeContext() {
  const state = new Map();
  const secrets = new Map();
  return {
    globalState: {
      get: (k, d) => (state.has(k) ? structuredClone(state.get(k)) : d),
      update: async (k, v) => { if (v === undefined) state.delete(k); else state.set(k, structuredClone(v)); },
    },
    secrets: {
      get: async (k) => secrets.get(k),
      store: async (k, v) => { secrets.set(k, v); },
      delete: async (k) => { secrets.delete(k); },
    },
  };
}

/** Every file and folder under `dir`, with contents and link targets: compared before and after. */
async function snapshot(dir) {
  const out = [];
  async function walk(p) {
    const st = await lstat(p);
    const rel = path.relative(dir, p) || '.';
    if (st.isSymbolicLink()) out.push(`L ${rel} -> ${await readlink(p)}`);
    else if (st.isDirectory()) {
      out.push(`D ${rel}`);
      for (const name of (await readdir(p)).sort()) await walk(path.join(p, name));
    } else out.push(`F ${rel} ${createHash('sha256').update(await readFile(p)).digest('hex')}`);
  }
  await walk(dir);
  return out;
}

const exists = (p) => lstat(p).then(() => true, () => false);

function fakeClock() {
  let now = Date.parse('2026-11-08T12:00:00Z');
  const timers = [];
  return {
    now: () => now,
    schedule: (fn, ms) => {
      const timer = { at: now + ms, fn, cancelled: false };
      timers.push(timer);
      return { cancel: () => { timer.cancelled = true; } };
    },
    async advance(ms, watcher) {
      const until = now + ms;
      for (;;) {
        const due = timers.filter((x) => !x.cancelled && !x.ran && x.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        due.ran = true;
        due.fn();
        await watcher.settled();
      }
      now = until;
    },
  };
}

/**
 * The website on 127.0.0.1: the standing route answers removed_from_team for
 * every key (what it says once a key's maker left the team), and Connect's
 * exchange hands over `connectKey` for the account.
 */
async function startWebsite(connectKey) {
  const seen = [];
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    for await (const _ of req);
    seen.push(req.url);
    if (req.method === 'POST' && req.url === '/api/account/mcp-keys/standing') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ standing: 'removed_from_team' }));
    }
    if (req.method === 'POST' && req.url === '/api/connect/vscode/exchange') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ accounts: [{ account_id: A, account_name: 'Northwind', api_key: connectKey }], departments: [], connected_as: 'sam@example.com' }));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not found"}');
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    appUrl: `http://127.0.0.1:${server.address().port}`,
    standingQuestions: () => seen.filter((u) => u === '/api/account/mcp-keys/standing').length,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** The MCP server: get_account_info names Northwind until `refusing` is set, then Hiveku's own 401 for every call. */
async function startMcp() {
  const mcp = { refusing: false };
  const stub = await startStub((rpc) => {
    if (rpc?.method !== 'tools/call') return undefined;
    if (mcp.refusing) return coreAuthRefusal(401, rpc.id, REVOKED_KEY_MESSAGE);
    const text = JSON.stringify({ data: { account_id: A, name: 'Northwind' } });
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text }] } }) };
  });
  mcp.base = stub.base;
  mcp.close = () => stub.close();
  return mcp;
}

/** Connect Hiveku's way back from the browser: the extension's own state, then the exchange (connect.ts handleUri). */
async function connectThroughTheBrowser(ctx, store, appUrl) {
  const flow = new ConnectFlow(ctx, store, () => appUrl, () => undefined);
  await ctx.globalState.update('hiveku.connect.pendingState', { state: 'made-up-state', at: Date.now() });
  await flow.handleUri({ path: '/auth', query: 'code=made-up-code&state=made-up-state' });
}

/**
 * The account's folder as the extension makes one, with the person's own work in
 * it, and the watcher wired the way extension.ts wires it: the store's refusals go
 * to the watcher, which asks the website, checks the key with the store, and
 * removes through runAccountRemoval. Then the sidebar refreshes every five
 * minutes for an hour, each call refused.
 */
async function anHourOfRefusals(t, { connectKey, before }) {
  const base = await mkdtemp(path.join(tmpdir(), 'hiveku-o8a-pasted-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const root = path.join(home, 'Hiveku-Accounts');
  const storage = path.join(base, 'vscode-storage', 'removing');
  await mkdir(root, { recursive: true });

  const website = await startWebsite(connectKey ?? madeUpKey());
  t.after(() => website.close());
  const mcp = await startMcp();
  t.after(() => mcp.close());
  const ctx = fakeContext();
  const store = new AccountStore(ctx);
  await before({ ctx, store, website, mcp });
  const record = store.list().find((r) => r.accountId === A);
  assert.ok(record, 'the account is connected');
  const key = await store.getKey(A);

  const folder = path.join(root, 'northwind-a0a0a0a0');
  assert.equal(await binding.makeAccountFolder(folder, record), 'marked');
  await store.setFolder(A, folder);
  await mkdir(path.join(folder, 'sites', 'main-site'), { recursive: true });
  await writeFile(path.join(folder, 'sites', 'main-site', 'index.html'), '<h1>an edit not saved as a version yet</h1>\n');
  await writeFile(path.join(folder, '.env'), `OLYMPUS_API_KEY=${key}\n`);
  const folderBefore = await snapshot(folder);

  const clock = fakeClock();
  const removals = [];
  const notices = [];
  const watcher = new ks.KeyRefusalWatcher({
    appUrl: () => website.appUrl,
    storedKey: (id) => store.getKey(id),
    fromConnect: (id, k) => store.keyCameFromConnect(id, k),
    ask: (q) => ks.askKeyStanding({ ...q, timeoutMs: 2000 }),
    remove: async (accountId, reason) => {
      removals.push({ accountId, reason });
      const rec = store.allRecords().find((r) => r.accountId === accountId);
      const result = await off.runAccountRemoval(
        { accountId, label: rec.label, reason, root, recordedFolder: store.getFolder(accountId), canonicalFolder: folder, otherAccountFolders: [], home },
        {
          forgetAccount: (id) => store.forgetRemovedAccount(id),
          journal: { add: async () => undefined, remove: async () => undefined },
          tombstoneDir: storage,
          log: () => undefined,
        },
      );
      notices.push(off.removalNotice(result, home));
    },
    keyStopped: (accountId) => notices.push(off.keyStoppedNotice(store.allRecords().find((r) => r.accountId === accountId)?.label ?? '')),
    log: () => undefined,
    now: clock.now,
    schedule: clock.schedule,
  });
  store.setKeyRefusedListener((accountId, k) => watcher.onRefused(accountId, k));
  t.after(() => watcher.dispose());

  // The key's maker leaves the team: Hiveku switches off every key they made.
  mcp.refusing = true;
  const client = await store.getClient(A, mcp.base);
  for (let i = 0; i < 12; i++) {
    await client.callTool('get_account_info', {}).catch(() => undefined);
    await watcher.settled();
    await clock.advance(5 * 60 * 1000, watcher);
  }
  return { store, key, folder, folderBefore, removals, notices, website };
}

async function signInWithAKey(store, mcp, key) {
  const record = await store.signIn(key, mcp.base);
  assert.equal(record.accountId, A);
}

test('a pasted key whose maker left the team: two removal answers keep the folder, its unsaved work and the key; the person is told the key stopped working', async (t) => {
  const pasted = madeUpKey();
  const e = await anHourOfRefusals(t, { before: ({ store, mcp }) => signInWithAKey(store, mcp, pasted) });
  assert.ok(e.website.standingQuestions() >= 1, 'the website was asked');
  assert.deepEqual(e.removals, [], 'runAccountRemoval is never reached');
  assert.deepEqual(await snapshot(e.folder), e.folderBefore, 'the folder, byte for byte');
  assert.equal(await e.store.getKey(A), pasted, 'the saved key stays');
  assert.deepEqual(e.store.list().map((r) => r.accountId), [A], 'the account stays');
  assert.deepEqual(e.notices, [off.keyStoppedNotice('Northwind')], 'told once');
  assert.doesNotMatch(e.notices[0], /team|closed|you were removed|no longer have access/, 'nothing said about whoever made the key');
  assert.match(e.notices[0], /Nothing was removed from this computer/);
});

test('a key pasted over an account first connected with Connect Hiveku still removes nothing', async (t) => {
  const pasted = madeUpKey();
  const e = await anHourOfRefusals(t, {
    connectKey: madeUpKey(),
    before: async ({ ctx, store, website, mcp }) => {
      await connectThroughTheBrowser(ctx, store, website.appUrl);
      // Later, a teammate's key pasted with "Sign in with a key" replaces it.
      await signInWithAKey(store, mcp, pasted);
    },
  });
  assert.deepEqual(e.removals, []);
  assert.deepEqual(await snapshot(e.folder), e.folderBefore);
  assert.equal(await e.store.getKey(A), pasted);
  assert.deepEqual(e.notices, [off.keyStoppedNotice('Northwind')]);
});

test('the key Connect Hiveku handed over: two removal answers remove the folder and the key (the same world, so the pasted cases are not empty)', async (t) => {
  const connectKey = madeUpKey();
  const e = await anHourOfRefusals(t, {
    connectKey,
    before: ({ ctx, store, website }) => connectThroughTheBrowser(ctx, store, website.appUrl),
  });
  assert.equal(e.key, connectKey, 'Connect stored the key it was handed');
  assert.deepEqual(e.removals, [{ accountId: A, reason: 'removed_from_team' }]);
  assert.equal(await exists(e.folder), false);
  assert.equal(await e.store.getKey(A), undefined);
  assert.equal(e.store.allRecords().length, 0);
  assert.equal(e.notices.length, 1);
  assert.match(e.notices[0], /^You no longer have access to Northwind: you were removed from its team\./);
});
