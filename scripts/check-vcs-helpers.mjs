/**
 * Pin the pure envelope/label helpers behind the branch flow.
 *
 * WHY. These read response shapes that unwrap() would otherwise erase or that
 * the routes have changed under callers before (`content` vs `file_content`,
 * `{data:{pr,merge}}`), and they decide user-facing sentences on the deploy
 * picker. A wrong `readPromoted` reports a real promote as a no-op; a wrong
 * `branchArg` sends `branch: "main"` explicitly and changes the wire bytes for
 * every main caller; a wrong `bindingLabel` tells the operator the wrong tree
 * ships. None of these needs VS Code, so they are checked here with plain node.
 *
 * Run: node --import ./scripts/register-ts.mjs scripts/check-vcs-helpers.mjs
 */
import assert from 'node:assert/strict';

const api = await import('../src/hivekuApi.ts');

let n = 0;
const check = (name, fn) => {
  fn();
  n++;
  console.log(`  ok  ${name}`);
};

check('branchArg omits main / empty / whitespace-main', () => {
  assert.deepEqual(api.branchArg('main'), {});
  assert.deepEqual(api.branchArg(''), {});
  assert.deepEqual(api.branchArg(undefined), {});
  assert.deepEqual(api.branchArg(null), {});
  assert.deepEqual(api.branchArg('  main '), {});
});
check('branchArg forwards a real branch, trimmed', () => {
  assert.deepEqual(api.branchArg('feat/x'), { branch: 'feat/x' });
  assert.deepEqual(api.branchArg(' feat/x '), { branch: 'feat/x' });
});

check('readPromoted reads promoted inside data (the commit route shape)', () => {
  assert.equal(api.readPromoted({ data: { id: 'c1', promoted: true }, preview_effect: {} }), true);
});
check('readPromoted reads a hoisted sibling too', () => {
  assert.equal(api.readPromoted({ data: { id: 'c1' }, promoted: true }), true);
});
check('readPromoted is false, never undefined, when absent or malformed', () => {
  assert.equal(api.readPromoted({ data: { id: 'c1' } }), false);
  assert.equal(api.readPromoted({ data: { id: 'c1', promoted: 'yes' } }), false);
  assert.equal(api.readPromoted(null), false);
  assert.equal(api.readPromoted('nope'), false);
});

check('readSibling prefers data, falls back to root, else undefined', () => {
  assert.equal(api.readSibling({ data: { working_tree_etag: 'abc' } }, 'working_tree_etag'), 'abc');
  assert.equal(api.readSibling({ data: {}, working_tree_etag: 'def' }, 'working_tree_etag'), 'def');
  assert.equal(api.readSibling({ data: { working_tree_etag: null } }, 'working_tree_etag'), null);
  assert.equal(api.readSibling({ data: {} }, 'working_tree_etag'), undefined);
});

const bindings = {
  development: { branch: 'feat/x', bound: true },
  staging: { branch: 'main', bound: false },
  production: { branch: 'main', bound: false, locked: true },
};
check('bindingLabel names the served branch per tier', () => {
  assert.equal(api.bindingLabel('development', bindings), 'development - serves branch feat/x');
  assert.equal(api.bindingLabel('staging', bindings), 'staging - serves main');
  assert.equal(api.bindingLabel('production', bindings), 'production - always main');
});
check('bindingLabel never guesses when bindings are unavailable', () => {
  assert.equal(api.bindingLabel('development', undefined), 'development - binding unknown');
  assert.equal(api.bindingLabel('production', undefined), 'production - always main');
});
check('tiersBoundTo lists only tiers bound to that branch', () => {
  assert.deepEqual(api.tiersBoundTo(bindings, 'feat/x'), ['development']);
  assert.deepEqual(api.tiersBoundTo(bindings, 'main'), []);
  assert.deepEqual(api.tiersBoundTo(undefined, 'feat/x'), []);
});

check('diffSideText: absent side is empty, binary and oversized are labelled', () => {
  assert.equal(api.diffSideText(null), '');
  assert.equal(api.diffSideText({ content: 'hi', encoding: 'utf-8' }), 'hi');
  assert.equal(api.diffSideText({ content: 'aGk=', encoding: 'base64' }), '(binary file — no text diff)');
  assert.equal(api.diffSideText({ tooLarge: true }), '(file over 1 MB — too large to show)');
});

check('stashCounts still normalizes both lanes (envelope irregularity kept)', () => {
  assert.deepEqual(api.stashCounts({ status: 'stashed', modified: 1, pendingAdds: 2, pendingDeletes: 3 }), {
    modified: 1,
    added: 2,
    deleted: 3,
    total: 6,
  });
});

console.log(`✓ ${n} vcs helper checks passed`);
