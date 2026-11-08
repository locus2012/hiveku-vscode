// The mark that says the extension made an account's folder (offboarding O8a,
// src/accountBinding.ts). Every folder here is planted under a fresh temporary
// folder; nothing outside it is read or written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadOut } from './helpers/load.mjs';

const { readFolderBinding, markFolderAsExtensions, folderIsNewOrEmpty, isAccountUuid, EXTENSION_BINDER } = loadOut('accountBinding');

const A = '7f6bb2cf-a04e-4efa-afd0-db6dd3aafd79';

async function base(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'hiveku-o8a-binding-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('a new folder gets the extension\'s mark, naming the account, with no key in it', async (t) => {
  const dir = path.join(await base(t), 'northwind-7f6bb2cf');
  await mkdir(dir);
  assert.equal(await markFolderAsExtensions(dir, { accountId: A, label: 'Northwind' }, new Date('2026-11-08T00:00:00Z')), 'marked');
  const text = await readFile(path.join(dir, '.hiveku', 'account.json'), 'utf8');
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body).sort(), ['account_id', 'bound_at', 'bound_by', 'label', 'note', 'version']);
  assert.equal(body.account_id, A);
  assert.equal(body.bound_by, EXTENSION_BINDER);
  assert.equal(body.bound_by, 'hiveku-vscode');
  assert.equal(body.bound_at, '2026-11-08T00:00:00.000Z');
  assert.doesNotMatch(text, /hvk_|Bearer|https?:/);
  assert.deepEqual(await readFolderBinding(dir), { kind: 'bound', accountId: A, boundBy: 'hiveku-vscode' });
});

test('the mark is never written over a binding already there', async (t) => {
  const dir = path.join(await base(t), 'northwind');
  await mkdir(path.join(dir, '.hiveku'), { recursive: true });
  const desktops = JSON.stringify({ version: 1, account_id: A, bound_by: 'hiveku-desktop' });
  await writeFile(path.join(dir, '.hiveku', 'account.json'), desktops);
  assert.equal(await markFolderAsExtensions(dir, { accountId: A, label: 'Northwind' }), 'already_bound');
  assert.equal(await readFile(path.join(dir, '.hiveku', 'account.json'), 'utf8'), desktops);
});

test('the mark is never written through a link, nor for an id that is not an account id', async (t) => {
  const root = await base(t);
  const elsewhere = path.join(root, 'elsewhere');
  await mkdir(elsewhere);
  const dir = path.join(root, 'northwind');
  await mkdir(dir);
  await symlink(elsewhere, path.join(dir, '.hiveku'));
  assert.equal(await markFolderAsExtensions(dir, { accountId: A, label: 'Northwind' }), 'not_marked');
  assert.deepEqual(await readdir(elsewhere), []);

  const linked = path.join(root, 'linked-folder');
  await symlink(elsewhere, linked);
  assert.equal(await markFolderAsExtensions(linked, { accountId: A, label: 'Northwind' }), 'not_marked');
  assert.deepEqual(await readdir(elsewhere), []);

  const plain = path.join(root, 'plain');
  await mkdir(plain);
  for (const id of ['key-1a2b3c', A.toUpperCase(), '', 'acme']) {
    assert.equal(await markFolderAsExtensions(plain, { accountId: id, label: 'x' }), 'not_marked');
  }
  assert.deepEqual(await readdir(plain), []);
  assert.equal(isAccountUuid(A), true);
  assert.equal(isAccountUuid(A.toUpperCase()), false);
});

test('readFolderBinding: none, a link, an unreadable file, and whose it says it is', async (t) => {
  const root = await base(t);
  const none = path.join(root, 'none');
  await mkdir(path.join(none, '.hiveku'), { recursive: true });
  assert.deepEqual(await readFolderBinding(none), { kind: 'none' });
  assert.deepEqual(await readFolderBinding(path.join(root, 'missing')), { kind: 'none' });

  const linkedFile = path.join(root, 'linked-file');
  await mkdir(path.join(linkedFile, '.hiveku'), { recursive: true });
  await writeFile(path.join(root, 'real.json'), JSON.stringify({ account_id: A, bound_by: 'hiveku-vscode' }));
  await symlink(path.join(root, 'real.json'), path.join(linkedFile, '.hiveku', 'account.json'));
  assert.deepEqual(await readFolderBinding(linkedFile), { kind: 'link' });

  for (const [name, text] of [['broken', 'not json'], ['empty', '{}'], ['array', '[]'], ['number-id', '{"account_id": 7}']]) {
    const dir = path.join(root, name);
    await mkdir(path.join(dir, '.hiveku'), { recursive: true });
    await writeFile(path.join(dir, '.hiveku', 'account.json'), text);
    assert.deepEqual(await readFolderBinding(dir), { kind: 'unreadable' }, name);
  }

  const plugin = path.join(root, 'plugin');
  await mkdir(path.join(plugin, '.hiveku'), { recursive: true });
  await writeFile(path.join(plugin, '.hiveku', 'account.json'), JSON.stringify({ account_id: A.toUpperCase(), bound_by: 'hiveku-claude-plugin' }));
  assert.deepEqual(await readFolderBinding(plugin), { kind: 'bound', accountId: A, boundBy: 'hiveku-claude-plugin' });
});

test('folderIsNewOrEmpty: true only for a missing or empty real folder', async (t) => {
  const root = await base(t);
  assert.equal(await folderIsNewOrEmpty(path.join(root, 'missing')), true);
  const empty = path.join(root, 'empty');
  await mkdir(empty);
  assert.equal(await folderIsNewOrEmpty(empty), true);
  await writeFile(path.join(empty, '.DS_Store'), '');
  assert.equal(await folderIsNewOrEmpty(empty), true);
  const full = path.join(root, 'full');
  await mkdir(full);
  await writeFile(path.join(full, 'notes.md'), 'mine');
  assert.equal(await folderIsNewOrEmpty(full), false);
  const link = path.join(root, 'link');
  await symlink(empty, link);
  assert.equal(await folderIsNewOrEmpty(link), false);
  await writeFile(path.join(root, 'a-file'), 'x');
  assert.equal(await folderIsNewOrEmpty(path.join(root, 'a-file')), false);
});
