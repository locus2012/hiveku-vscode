// Removing an account from this computer when its person lost access
// (offboarding O8a, src/offboarding.ts). Real folders are planted under a fresh
// temporary folder for each test: a "home" with a Hiveku root inside it, an
// "outside" folder, and the extension's storage folder. Every root, the home
// folder and the storage folder are passed in, so nothing outside the temporary
// folder can be reached even with a check broken. Every key is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadOut } from './helpers/load.mjs';

const off = loadOut('offboarding');
const ks = loadOut('keyStanding');

const A = 'a0a0a0a0-0b0b-4c0c-8d0d-0e0e0e0e0e0e';
const B = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const madeUpKey = () => `hvk_${randomBytes(32).toString('hex')}`;

/* ── the planted world ──────────────────────────────────────────────────── */

/** Every folder under `dir` made readable and writable again (a test locks one), never through a link. */
async function openUp(dir) {
  const st = await lstat(dir).catch(() => null);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return;
  await chmod(dir, 0o700).catch(() => undefined);
  for (const name of await readdir(dir).catch(() => [])) await openUp(path.join(dir, name));
}

async function world(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'hiveku-o8a-removal-'));
  // Cleaned up even when a broken check moved a locked folder somewhere the test did not expect.
  t.after(async () => {
    await openUp(base);
    await rm(base, { recursive: true, force: true });
  });
  const home = path.join(base, 'home');
  const root = path.join(home, 'Hiveku-Accounts');
  const outside = path.join(base, 'outside');
  const storage = path.join(base, 'vscode-storage', 'removing');
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  return { base, home, root, outside, storage };
}

/**
 * An account folder as the extension leaves one: its binding (or none), .env and
 * .mcp.json with a made-up key, a downloaded site, data, knowledge.
 */
async function plantAccountFolder(dir, { accountId, boundBy = 'hiveku-vscode', siteAccountId } = {}) {
  await mkdir(path.join(dir, '.hiveku'), { recursive: true });
  if (boundBy !== null) {
    await writeFile(path.join(dir, '.hiveku', 'account.json'), JSON.stringify({ version: 1, account_id: accountId, label: 'x', bound_by: boundBy }));
  }
  await writeFile(path.join(dir, '.env'), `OLYMPUS_API_KEY=${madeUpKey()}\n`);
  await writeFile(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { hiveku: { headers: { Authorization: `Bearer ${madeUpKey()}` } } } }));
  await writeFile(path.join(dir, 'CLAUDE.md'), '# workspace\n');
  await mkdir(path.join(dir, 'sites', 'main-site', '.hiveku'), { recursive: true });
  await writeFile(path.join(dir, 'sites', 'main-site', '.hiveku', 'project.json'), JSON.stringify({ project_id: 'p1', account_id: siteAccountId ?? accountId }));
  await writeFile(path.join(dir, 'sites', 'main-site', 'index.html'), '<h1>site</h1>\n');
  await mkdir(path.join(dir, 'sites', 'main-site', 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(dir, 'sites', 'main-site', 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n');
  await mkdir(path.join(dir, 'hiveku-data', 'crm'), { recursive: true });
  await writeFile(path.join(dir, 'hiveku-data', 'crm', 'contacts.json'), '[]\n');
  await mkdir(path.join(dir, 'memory'), { recursive: true });
  await writeFile(path.join(dir, 'memory', 'brand.md'), 'voice\n');
  return dir;
}

/** Every file, folder and link under `dir`, with contents and link targets: compared before and after. */
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

function ctxFor(w, extra = {}) {
  return {
    accountId: A,
    label: 'Northwind',
    reason: 'removed_from_team',
    root: w.root,
    recordedFolder: path.join(w.root, 'northwind-a0a0a0a0'),
    canonicalFolder: path.join(w.root, 'northwind-a0a0a0a0'),
    otherAccountFolders: [path.join(w.root, 'acme-1a2b3c4d')],
    home: w.home,
    ...extra,
  };
}

/** What a removal is given: a journal and a key store that record what they were asked, in order. */
function depsFor(w) {
  const order = [];
  const entries = [];
  return {
    order,
    forgetAccount: async (id) => { order.push(`forget ${id}`); },
    journal: {
      entries,
      add: async (entry) => { order.push('journal add'); entries.push(entry); },
      remove: async (id) => { order.push('journal remove'); entries.splice(0, entries.length, ...entries.filter((e) => e.accountId !== id)); },
    },
    tombstoneDir: w.storage,
    log: () => undefined,
  };
}

/* ── what goes ──────────────────────────────────────────────────────────── */

test("the account's own folder goes, with its downloads, .env and .mcp.json; the key goes first", async (t) => {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const deps = depsFor(w);
  let folderThereWhenKeyWent = null;
  deps.forgetAccount = async (id) => {
    deps.order.push(`forget ${id}`);
    folderThereWhenKeyWent = await exists(mine);
  };
  const result = await off.runAccountRemoval(ctxFor(w), deps);
  assert.equal(await exists(mine), false);
  assert.equal(folderThereWhenKeyWent, true, 'the key went before any file');
  assert.deepEqual(deps.order, ['journal add', `forget ${A}`, 'journal remove']);
  assert.equal(result.keyRemoved, true);
  assert.equal(result.removed.length, 1);
  assert.deepEqual(result.kept, []);
  assert.deepEqual(deps.journal.entries, []);
  // Deleted for good: nothing is left in the storage folder it passed through, and nothing went to a Trash.
  assert.deepEqual(await readdir(w.storage), []);
  assert.deepEqual((await readdir(w.root)).sort(), []);
});

test('the journal names the folders before anything is deleted', async (t) => {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const deps = depsFor(w);
  let journaled = null;
  deps.forgetAccount = async () => { journaled = JSON.parse(JSON.stringify(deps.journal.entries)); };
  await off.runAccountRemoval(ctxFor(w), deps);
  assert.equal(journaled.length, 1);
  assert.equal(journaled[0].accountId, A);
  assert.equal(journaled[0].reason, 'removed_from_team');
  assert.deepEqual(journaled[0].folders.map((f) => path.basename(f)), [path.basename(mine)]);
});

/* ── what stays ─────────────────────────────────────────────────────────── */

test("another account's folder stays, byte for byte, whatever made it", async (t) => {
  const w = await world(t);
  await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const acme = await plantAccountFolder(path.join(w.root, 'acme-1a2b3c4d'), { accountId: B });
  const acmeByApp = await plantAccountFolder(path.join(w.root, 'acme-1a2b3c4d-2'), { accountId: B, boundBy: 'hiveku-desktop' });
  const before = [await snapshot(acme), await snapshot(acmeByApp)];
  const result = await off.runAccountRemoval(ctxFor(w), depsFor(w));
  assert.equal(result.removed.length, 1);
  assert.deepEqual([await snapshot(acme), await snapshot(acmeByApp)], before);
});

test("the account's folder made by the Hiveku app stays; so does one another Hiveku tool made", async (t) => {
  const w = await world(t);
  const byApp = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A, boundBy: 'hiveku-desktop' });
  const byPlugin = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0-2'), { accountId: A, boundBy: 'hiveku-claude-plugin' });
  const before = [await snapshot(byApp), await snapshot(byPlugin)];
  const result = await off.runAccountRemoval(ctxFor(w), depsFor(w));
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map((k) => [path.basename(k.path), k.why]).sort(), [
    ['northwind-a0a0a0a0', 'desktop'],
    ['northwind-a0a0a0a0-2', 'other_tool'],
  ]);
  assert.deepEqual([await snapshot(byApp), await snapshot(byPlugin)], before);
  assert.equal(result.keyRemoved, true, 'the key still goes');
});

test('an old folder without the mark stays, and the notice says where it is and why', async (t) => {
  const w = await world(t);
  const old = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A, boundBy: null });
  const before = await snapshot(old);
  const result = await off.runAccountRemoval(ctxFor(w), depsFor(w));
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map((k) => k.why), ['no_mark']);
  assert.deepEqual(await snapshot(old), before);
  const notice = off.removalNotice(result, w.home);
  assert.match(notice, /You no longer have access to Northwind: you were removed from its team\./);
  assert.match(notice, /Removed from this computer: its saved key\./);
  assert.match(notice, /Left in place: ~\/Hiveku-Accounts\/northwind-a0a0a0a0 \(it was made before this version of the extension, so it cannot tell it made it; delete it yourself if you no longer need it\)\./);
});

test('a link stays: the link itself, and what it points at', async (t) => {
  const w = await world(t);
  // The account's folder is a link to a marked folder outside the root.
  const target = await plantAccountFolder(path.join(w.outside, 'northwind-real'), { accountId: A });
  await symlink(target, path.join(w.root, 'northwind-a0a0a0a0'));
  const before = await snapshot(target);
  const result = await off.runAccountRemoval(ctxFor(w), depsFor(w));
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map((k) => k.why), ['link']);
  assert.equal((await lstat(path.join(w.root, 'northwind-a0a0a0a0'))).isSymbolicLink(), true);
  assert.deepEqual(await snapshot(target), before);
});

test('a link inside the folder goes with it, and what it points at stays', async (t) => {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const precious = path.join(w.outside, 'precious');
  await mkdir(precious);
  await writeFile(path.join(precious, 'keep.txt'), 'mine, not the account\'s\n');
  await symlink(precious, path.join(mine, 'linked-folder'));
  await symlink(path.join(precious, 'keep.txt'), path.join(mine, 'sites', 'main-site', 'linked-file.txt'));
  const before = await snapshot(precious);
  const result = await off.runAccountRemoval(ctxFor(w), depsFor(w));
  assert.equal(result.removed.length, 1);
  assert.equal(await exists(mine), false);
  assert.deepEqual(await snapshot(precious), before);
});

test('a marked folder reached through a linked folder under the root stays', async (t) => {
  const w = await world(t);
  const realParent = path.join(w.outside, 'real-parent');
  await mkdir(realParent);
  await symlink(realParent, path.join(w.root, 'linked-parent'));
  const target = await plantAccountFolder(path.join(realParent, 'northwind-a0a0a0a0'), { accountId: A });
  const before = await snapshot(target);
  const result = await off.runAccountRemoval(ctxFor(w, { recordedFolder: path.join(w.root, 'linked-parent', 'northwind-a0a0a0a0') }), depsFor(w));
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map((k) => k.why), ['link']);
  assert.deepEqual(await snapshot(target), before);
});

test('a path outside the root that leads into it through a link is never followed in', async (t) => {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  await symlink(w.root, path.join(w.outside, 'into-root'));
  const before = await snapshot(mine);
  const ctx = ctxFor(w, { recordedFolder: path.join(w.outside, 'into-root', 'northwind-a0a0a0a0'), canonicalFolder: undefined });
  assert.deepEqual(await off.checkRemovable(path.join(w.outside, 'into-root', 'northwind-a0a0a0a0'), ctx), { ok: false, why: 'outside_root' });
  const done = await off.deleteFolderForGood(path.join(w.outside, 'into-root', 'northwind-a0a0a0a0'), ctx, w.storage);
  assert.deepEqual(done, { outcome: 'refused', why: 'outside_root' });
  assert.deepEqual(await snapshot(mine), before);
});

test('a folder replaced by a link after it was planned stays, and so does what the link points at', async (t) => {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const decoy = await plantAccountFolder(path.join(w.outside, 'decoy'), { accountId: A });
  const before = await snapshot(decoy);
  const deps = depsFor(w);
  deps.forgetAccount = async () => {
    await rm(mine, { recursive: true, force: true });
    await symlink(decoy, mine);
  };
  const result = await off.runAccountRemoval(ctxFor(w), deps);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map((k) => k.why), ['link']);
  assert.equal((await lstat(mine)).isSymbolicLink(), true);
  assert.deepEqual(await snapshot(decoy), before);
});

test('a link that appears between the link checks and the delete is still caught by the real path', async (t) => {
  const w = await world(t);
  const realParent = path.join(w.outside, 'real-parent');
  const target = await plantAccountFolder(path.join(realParent, 'northwind-a0a0a0a0'), { accountId: A });
  const linkedParent = path.join(w.root, 'parent');
  await symlink(realParent, linkedParent);
  const before = await snapshot(target);
  // White box: the folder-by-folder link check is told the parent is a plain folder, as it was a moment earlier.
  const fsp = createRequire(import.meta.url)('fs/promises');
  const realLstat = fsp.lstat;
  fsp.lstat = async (p, ...rest) => (p === linkedParent ? realLstat(realParent, ...rest) : realLstat(p, ...rest));
  t.after(() => { fsp.lstat = realLstat; });
  const folder = path.join(linkedParent, 'northwind-a0a0a0a0');
  const verdict = await off.checkRemovable(folder, ctxFor(w));
  fsp.lstat = realLstat;
  assert.deepEqual(verdict, { ok: false, why: 'outside_root' });
  assert.deepEqual(await snapshot(target), before);
});

test('a marked folder outside the root stays', async (t) => {
  const w = await world(t);
  const away = await plantAccountFolder(path.join(w.outside, 'northwind-a0a0a0a0'), { accountId: A });
  const before = await snapshot(away);
  const result = await off.runAccountRemoval(ctxFor(w, { recordedFolder: away }), depsFor(w));
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map((k) => k.why), ['outside_root']);
  assert.deepEqual(await snapshot(away), before);
});

test('with no Hiveku root set, nothing is deleted', async (t) => {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const before = await snapshot(mine);
  const result = await off.runAccountRemoval(ctxFor(w, { root: undefined, canonicalFolder: undefined }), depsFor(w));
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map((k) => k.why), ['no_root']);
  assert.deepEqual(await snapshot(mine), before);
});

test('the root itself and the home folder are never deleted, even marked', async (t) => {
  const w = await world(t);
  await mkdir(path.join(w.root, '.hiveku'), { recursive: true });
  await writeFile(path.join(w.root, '.hiveku', 'account.json'), JSON.stringify({ account_id: A, bound_by: 'hiveku-vscode' }));
  await writeFile(path.join(w.root, 'other-stuff.txt'), 'x');
  const rootBefore = await snapshot(w.root);
  const asRoot = await off.runAccountRemoval(ctxFor(w, { recordedFolder: w.root, canonicalFolder: undefined }), depsFor(w));
  assert.deepEqual(asRoot.removed, []);
  assert.deepEqual(asRoot.kept.map((k) => k.why), ['is_root']);
  assert.deepEqual(await snapshot(w.root), rootBefore);

  // The home folder, under a root set above it.
  await mkdir(path.join(w.home, '.hiveku'), { recursive: true });
  await writeFile(path.join(w.home, '.hiveku', 'account.json'), JSON.stringify({ account_id: A, bound_by: 'hiveku-vscode' }));
  const homeBefore = await snapshot(w.home);
  const asHome = await off.runAccountRemoval(ctxFor(w, { root: w.base, recordedFolder: w.home, canonicalFolder: undefined }), depsFor(w));
  assert.deepEqual(asHome.removed, []);
  assert.deepEqual(asHome.kept.map((k) => k.why), ['home']);
  assert.deepEqual(await snapshot(w.home), homeBefore);
});

test("a marked folder that holds another account's folder or site stays", async (t) => {
  const w = await world(t);
  const holdsBound = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  await mkdir(path.join(holdsBound, 'clients', 'acme', '.hiveku'), { recursive: true });
  await writeFile(path.join(holdsBound, 'clients', 'acme', '.hiveku', 'account.json'), JSON.stringify({ account_id: B, bound_by: 'hiveku-claude-plugin' }));
  const before = await snapshot(holdsBound);
  const first = await off.runAccountRemoval(ctxFor(w), depsFor(w));
  assert.deepEqual(first.kept.map((k) => k.why), ['holds_other_account']);
  assert.deepEqual(await snapshot(holdsBound), before);

  const w2 = await world(t);
  const holdsSite = await plantAccountFolder(path.join(w2.root, 'northwind-a0a0a0a0'), { accountId: A, siteAccountId: B });
  const before2 = await snapshot(holdsSite);
  const second = await off.runAccountRemoval(ctxFor(w2), depsFor(w2));
  assert.deepEqual(second.kept.map((k) => k.why), ['holds_other_account']);
  assert.deepEqual(await snapshot(holdsSite), before2);
});

test('a marked folder that cannot be read through stays: it might hold another account\'s folder', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async (t) => {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const locked = path.join(mine, 'sites', 'locked');
  await mkdir(path.join(locked, 'inner'), { recursive: true });
  await chmod(locked, 0o000);
  const result = await off.runAccountRemoval(ctxFor(w), depsFor(w));
  await openUp(w.base);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map((k) => k.why), ['not_read_through']);
  assert.equal(await exists(path.join(mine, 'sites', 'main-site', 'index.html')), true);
});

test("a marked folder that is another account's folder of the extension stays", async (t) => {
  const w = await world(t);
  const shared = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const before = await snapshot(shared);
  const result = await off.runAccountRemoval(ctxFor(w, { otherAccountFolders: [shared] }), depsFor(w));
  assert.deepEqual(result.kept.map((k) => k.why), ['other_account_folder']);
  assert.deepEqual(await snapshot(shared), before);
});

test('a folder bound to another account at the account\'s own path stays', async (t) => {
  const w = await world(t);
  const theirs = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: B });
  const before = await snapshot(theirs);
  const result = await off.runAccountRemoval(ctxFor(w, { otherAccountFolders: [] }), depsFor(w));
  assert.deepEqual(result.kept.map((k) => k.why), ['other_account']);
  assert.deepEqual(await snapshot(theirs), before);
});

test('every folder under the root bound to the account by the extension goes (a renamed account), and nothing else', async (t) => {
  const w = await world(t);
  const renamed = await plantAccountFolder(path.join(w.root, 'old-name-a0a0a0a0'), { accountId: A });
  const current = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const unrelated = path.join(w.root, 'my-notes');
  await mkdir(unrelated);
  await writeFile(path.join(unrelated, 'n.md'), 'mine');
  const before = await snapshot(unrelated);
  const result = await off.runAccountRemoval(ctxFor(w, { recordedFolder: undefined }), depsFor(w));
  assert.equal(result.removed.length, 2);
  assert.equal(await exists(renamed), false);
  assert.equal(await exists(current), false);
  assert.deepEqual(await snapshot(unrelated), before);
});

test('each folder is checked again right before it is deleted: a mark that changed keeps it', async (t) => {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const deps = depsFor(w);
  deps.forgetAccount = async () => {
    // Between the plan and the delete, the Hiveku app takes the folder over.
    await writeFile(path.join(mine, '.hiveku', 'account.json'), JSON.stringify({ account_id: A, bound_by: 'hiveku-desktop' }));
  };
  const result = await off.runAccountRemoval(ctxFor(w), deps);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map((k) => k.why), ['desktop']);
  assert.equal(await exists(path.join(mine, 'sites', 'main-site', 'index.html')), true);
});

/* ── a crash halfway, and a second window ───────────────────────────────── */

test('a folder already gone (another window removed it) is not an error', async (t) => {
  const w = await world(t);
  const done = await off.deleteFolderForGood(path.join(w.root, 'northwind-a0a0a0a0'), ctxFor(w), w.storage);
  assert.deepEqual(done, { outcome: 'gone' });
});

test('what a crash left in the storage folder is deleted at the next start', async (t) => {
  const w = await world(t);
  await plantAccountFolder(path.join(w.storage, 'mzz-abc123'), { accountId: A });
  await mkdir(path.join(w.outside, 'pointed-at'));
  await writeFile(path.join(w.outside, 'pointed-at', 'keep.txt'), 'x');
  await symlink(path.join(w.outside, 'pointed-at'), path.join(w.storage, 'a-link'));
  const results = await off.finishPendingRemovals([], { ...depsFor(w), accountIsBack: () => false, contextFor: () => ctxFor(w) });
  assert.deepEqual(results, []);
  assert.deepEqual(await readdir(w.storage), []);
  assert.equal(await readFile(path.join(w.outside, 'pointed-at', 'keep.txt'), 'utf8'), 'x');
});

test('a removal left halfway is finished at the next start, checked again', async (t) => {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const deps = depsFor(w);
  deps.journal.entries.push({ accountId: A, label: 'Northwind', reason: 'account_closed', folders: [mine], at: new Date().toISOString() });
  const results = await off.finishPendingRemovals([...deps.journal.entries], { ...deps, journal: deps.journal, accountIsBack: () => false, contextFor: () => ctxFor(w) });
  assert.equal(await exists(mine), false);
  assert.equal(results.length, 1);
  assert.equal(results[0].removed.length, 1);
  assert.deepEqual(deps.journal.entries, []);
});

test('a removal left halfway for an account connected again since deletes nothing', async (t) => {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const before = await snapshot(mine);
  const deps = depsFor(w);
  deps.journal.entries.push({ accountId: A, label: 'Northwind', reason: 'removed_from_team', folders: [mine], at: new Date().toISOString() });
  const results = await off.finishPendingRemovals([...deps.journal.entries], { ...deps, journal: deps.journal, accountIsBack: (id) => id === A, contextFor: () => ctxFor(w) });
  assert.deepEqual(results, []);
  assert.deepEqual(await snapshot(mine), before);
  assert.deepEqual(deps.journal.entries, []);
});

/* ── the notice ─────────────────────────────────────────────────────────── */

test('the notice says plainly what went and what stayed, in plain words', async (t) => {
  const w = await world(t);
  await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0-2'), { accountId: A, boundBy: 'hiveku-desktop' });
  const result = await off.runAccountRemoval(ctxFor(w, { reason: 'account_closed' }), depsFor(w));
  const notice = off.removalNotice(result, w.home);
  assert.equal(
    notice,
    'You no longer have access to Northwind: the account was closed. Removed from this computer: its folder ' +
      '~/Hiveku-Accounts/northwind-a0a0a0a0 (with its downloaded sites, data, .env and .mcp.json) and its saved key. ' +
      'Left in place: ~/Hiveku-Accounts/northwind-a0a0a0a0-2 (the Hiveku app made it and removes it itself).',
  );
  assert.doesNotMatch(notice, /[\u2014\u2013]|Claude|Anthropic|OpenAI|Cloudflare|Render|Supabase/);
  const lines = off.removalLogLines(result);
  assert.ok(lines.some((l) => l.includes(path.join(w.root, 'northwind-a0a0a0a0-2'))));
});

/* ── end to end: the watcher, the website's answers and the removal ─────── */

async function startRoute(answer) {
  const sockets = new Set();
  let count = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) void _;
    count += 1;
    const reply = answer(count);
    if (typeof reply === 'function') return reply(res);
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(reply.body);
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    appUrl: `http://127.0.0.1:${server.address().port}`,
    count: () => count,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

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

async function endToEnd(t, answer, opts = {}) {
  const w = await world(t);
  const mine = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0'), { accountId: A });
  const theirs = await plantAccountFolder(path.join(w.root, 'acme-1a2b3c4d'), { accountId: B });
  const byApp = await plantAccountFolder(path.join(w.root, 'northwind-a0a0a0a0-2'), { accountId: A, boundBy: 'hiveku-desktop' });
  const before = { mine: await snapshot(mine), theirs: await snapshot(theirs), byApp: await snapshot(byApp) };
  const route = await startRoute(answer);
  t.after(() => route.close());
  const key = madeUpKey();
  const forgotten = [];
  const clock = fakeClock();
  const watcher = new ks.KeyRefusalWatcher({
    appUrl: () => route.appUrl,
    storedKey: async (id) => (forgotten.includes(id) ? undefined : key),
    // The key Connect Hiveku handed over for this account (the pasted-key worlds are in offboarding-pasted-key).
    fromConnect: (id, k) => id === A && k === key,
    ask: (q) => ks.askKeyStanding({ ...q, timeoutMs: opts.timeoutMs ?? 2000 }),
    remove: async (accountId, reason) => {
      await off.runAccountRemoval(ctxFor(w, { accountId, reason }), {
        ...depsFor(w),
        forgetAccount: async (id) => { forgotten.push(id); },
      });
    },
    log: () => undefined,
    now: clock.now,
    schedule: clock.schedule,
  });
  // The sidebar's scan every five minutes for an hour, each refused.
  for (let i = 0; i < 12; i++) {
    watcher.onRefused(A, key);
    await watcher.settled();
    await clock.advance(5 * 60 * 1000, watcher);
  }
  return { w, mine, theirs, byApp, before, route, forgotten };
}

test('end to end: removed_from_team twice removes the account\'s own folder and key, and nothing else', async (t) => {
  const e = await endToEnd(t, () => ({ status: 200, body: JSON.stringify({ standing: 'removed_from_team' }) }));
  assert.equal(await exists(e.mine), false);
  assert.deepEqual(e.forgotten, [A]);
  assert.deepEqual(await snapshot(e.theirs), e.before.theirs);
  assert.deepEqual(await snapshot(e.byApp), e.before.byApp);
  assert.equal(e.route.count(), 2, 'two questions, then quiet');
});

for (const [name, answer, timeoutMs] of [
  ['an error (the route answers 500)', () => ({ status: 500, body: '{"error":"unavailable"}' }), undefined],
  ['a 502 page', () => ({ status: 502, body: 'Bad gateway' }), undefined],
  ['a 503', () => ({ status: 503, body: '{"error":"unavailable"}' }), undefined],
  ['a 429', () => ({ status: 429, body: '{"error":"too_many_requests"}' }), undefined],
  ['a timeout (the route never answers)', () => () => {}, 100],
  ['an unreadable answer', () => ({ status: 200, body: '<html>removed_from_team</html>' }), undefined],
  ['key_switched_off', () => ({ status: 200, body: JSON.stringify({ standing: 'key_switched_off' }) }), undefined],
  ['active', () => ({ status: 200, body: JSON.stringify({ standing: 'active' }) }), undefined],
  ['a removal answer once, then an error', (n) => (n === 1 ? { status: 200, body: JSON.stringify({ standing: 'removed_from_team' }) } : { status: 500, body: '{}' }), undefined],
]) {
  test(`end to end: ${name} deletes nothing and keeps the key`, async (t) => {
    const e = await endToEnd(t, answer, { timeoutMs });
    assert.deepEqual(await snapshot(e.mine), e.before.mine);
    assert.deepEqual(await snapshot(e.theirs), e.before.theirs);
    assert.deepEqual(await snapshot(e.byApp), e.before.byApp);
    assert.deepEqual(e.forgotten, []);
    assert.ok(e.route.count() >= 1);
  });
}
