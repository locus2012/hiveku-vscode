// How extension.ts wires offboarding O8a, read from its source: activate() needs
// all of VS Code, so these pin the few lines that decide what a removal may
// touch. The behaviour behind each line is tested in key-standing,
// offboarding-removal, offboarding-store and account-binding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'extension.ts'), 'utf8');

/** The body of a top-level function in extension.ts, up to the next top-level declaration. */
function body(name) {
  const start = SRC.search(new RegExp(`^(export )?(async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} not found`);
  const rest = SRC.slice(start + 1);
  const end = rest.search(/^(export |async |function |const |let |\/\*\*|\/\/ ──)/m);
  return SRC.slice(start, end < 0 ? undefined : start + 1 + end);
}

test('the extension makes account folders only through makeAccountFolder, which marks only a folder it made', () => {
  assert.match(body('ensureAccountFolder'), /await makeAccountFolder\(dir, account\)/);
  assert.match(body('reconcileAccountFolders'), /makeAccountFolder\(canonical, account\)/);
  assert.doesNotMatch(SRC, /markFolderAsExtensions|folderIsNewOrEmpty/);
  assert.doesNotMatch(body('ensureAccountFolder'), /fs\.mkdir\(dir/);
});

test("the store's refusals go to the watcher, and the watcher asks the website at the machine-scoped app address", () => {
  assert.match(SRC, /accounts\.setKeyRefusedListener\(\(accountId, key\) => keyWatcher\?\.onRefused\(accountId, key\)\)/);
  assert.match(SRC, /ask: \(opts\) => askKeyStanding\(\{ \.\.\.opts, userAgent: hivekuUserAgent\(\) \}\)/);
  assert.match(SRC, /keyWatcher = new KeyRefusalWatcher\(\{\s*appUrl,/);
  assert.match(SRC, /remove: \(accountId, reason\) => removeAccountForLostAccess\(accountId, reason\)/);
});

test('a removal forgets the key through the store, deletes only through runAccountRemoval, and runs nothing', () => {
  const remove = body('removeAccountForLostAccess');
  assert.match(remove, /await runAccountRemoval\(ctx, \{/);
  assert.match(remove, /forgetAccount: \(id\) => accounts\.forgetRemovedAccount\(id\)/);
  assert.match(remove, /tombstoneDir: removalStorageDir\(\)/);
  assert.match(remove, /home: os\.homedir\(\)/);
  assert.match(remove, /otherAccountFolders: otherAccountFolders\(accountId\)/);
  for (const forbidden of [/teardownAccountAutomations/, /moveToTrash/, /\bcp\./, /\bfs\.(rm|unlink|rename)/]) {
    assert.doesNotMatch(remove, forbidden);
    assert.doesNotMatch(body('finishPendingAccountRemovals'), forbidden);
  }
  // Every other account the extension holds, active and archived, counts as another account's folder.
  assert.match(body('otherAccountFolders'), /accounts\.allRecords\(\)/);
  assert.match(body('finishPendingAccountRemovals'), /accountIsBack: \(accountId\) => accounts\.allRecords\(\)\.some/);
});
