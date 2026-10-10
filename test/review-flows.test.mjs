/**
 * Pull requests, the VS Code side of the features live on 2026-10-08
 * (src/reviewFlows.ts): what a refused merge means, the conflict resolve, and
 * archived branches. Driven through the vscode stub with a fake MCP client that
 * records every tool call.
 *
 * What is pinned, and why each would fail without this change:
 * - a merge refused for conflicts reads the paths AND the `resolve` target at
 *   the depth the MCP proxy puts them (details.*), and the sentence never sends
 *   the person back to the dead end ("resolve on the branch, save a version,
 *   merge again" never clears a conflict: notes/vcs-capability-verification-2026-10-07);
 * - the approval rule's refusals and a draft are recognised and keep the
 *   route's own sentence; a direct merge refused with pull_request_required
 *   gets a plain sentence (the route's names an API tool);
 * - "Resolve here" sends ONLY the files the person chose, each with its
 *   parent_hash, after a confirmation; Escape or "leave it" sends nothing; a
 *   refusal says nothing changed only when the route said so;
 * - the dashboard link is account-scoped;
 * - a write refused with branch_archived offers "Restore branch", which calls
 *   project_vcs_branch_restore for that branch;
 * - the scaffolded /hiveku-pr command teaches the resolve step and never
 *   offers to delete a merged branch.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vscodeStub, calls, resetCalls } from './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

const flows = loadOut('reviewFlows');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const PROJECT = '6d676101-3c0e-4b7a-9d7e-2f1a5c3e8b10';
const log = { lines: [], appendLine(l) { this.lines.push(l); } };

/** A tool refusal the way the MCP client throws it: { error, status, details: <route body> }. */
function refusal(status, body, tool = 'project_vcs_pr_merge') {
  const err = new Error(`Tool ${tool} failed (${status}): ${body.error}`);
  err.payload = { error: body.error, status, details: body, attempts: 1 };
  return err;
}

const CONFLICT_BODY = {
  error: 'merge conflicts — nothing was merged. Resolve them on feature-b against Your site (keep the branch\'s version, take Your site\'s, or write the final text) with POST /api/olympus/builder/projects/x/vcs/branches/resolve, passing each file\'s parent_hash from GET ..., or with the project_vcs_resolve tool. Then merge again.',
  code: 'merge_conflicts',
  conflicts: ['index.html', 'about.html'],
  conflict_details: { 'index.html': '<<<<<<< ...' },
  conflict_count: 2,
  resolve: { branch: 'feature-b', parent: 'main', conflicts_route: 'GET ...', resolve_route: 'POST ...', tool: 'project_vcs_resolve' },
  data: { conflicts: ['index.html', 'about.html'] },
};

const original = { ...vscodeStub.window };
function script({ picks = [], warning, info } = {}) {
  const queue = [...picks];
  vscodeStub.window.showQuickPick = (items, opts) => {
    calls.picks.push([items, opts]);
    const want = queue.shift();
    if (want === undefined) return Promise.resolve(undefined);
    const found = items.find((i) => i.label === want);
    assert.ok(found, `no item "${want}" in ${items.map((i) => i.label).join(' | ')}`);
    return Promise.resolve(found);
  };
  vscodeStub.window.showWarningMessage = (...a) => {
    calls.warnings.push(a);
    return Promise.resolve(typeof warning === 'function' ? warning(...a) : warning);
  };
  vscodeStub.window.showInformationMessage = (...a) => {
    calls.infos.push(a);
    return Promise.resolve(typeof info === 'function' ? info(...a) : info);
  };
}

beforeEach(() => {
  resetCalls();
  log.lines.length = 0;
});
afterEach(() => {
  Object.assign(vscodeStub.window, original);
});

describe('a refused pull request merge', () => {
  test('conflicts: the paths and the resolve target are read where the proxy nests them', () => {
    const r = flows.prMergeRefusal(refusal(409, CONFLICT_BODY));
    assert.equal(r.kind, 'conflicts');
    assert.deepEqual(r.paths, ['index.html', 'about.html']);
    assert.deepEqual(r.resolve, { branch: 'feature-b', parent: 'main' });
    // Only under data (an older answer), and only in the message text: still found.
    const older = refusal(409, { error: 'merge conflicts', data: { conflicts: ['a.html'] } });
    assert.deepEqual(flows.prMergeRefusal(older), { kind: 'conflicts', paths: ['a.html'], resolve: null });
    const textOnly = new Error('Tool project_vcs_pr_merge failed (409): {"details":{"data":{"conflicts":["b.html"]}}}');
    assert.deepEqual(flows.prMergeRefusal(textOnly).paths, ['b.html']);
  });

  test('the conflict sentence names the files and the way out, never the dead end or a tool', () => {
    const msg = flows.conflictRefusalMessage({ paths: ['index.html', 'about.html'], resolve: { branch: 'feature-b', parent: 'main' } });
    assert.match(msg, /^Nothing was merged: 2 files conflict \(index\.html, about\.html\)\./);
    assert.match(msg, /keep the branch's version, use Your site's, or edit the final text in the dashboard/);
    assert.match(msg, /Editing the file on the branch and saving a version does not clear a conflict/);
    assert.doesNotMatch(msg, /project_vcs_|\/api\/|save a version, then merge again/);
    // NEGATIVE CONTROL: the old sentence is what this replaces.
    assert.match('Resolve them on "feature-b", save a version, then merge again.', /save a version, then merge again/);
    const noTarget = flows.conflictRefusalMessage({ paths: ['a'], resolve: null });
    assert.match(noTarget, /Neither branch was started from the other/);
    assert.match(noTarget, /^Nothing was merged: 1 file conflicts \(a\)\./);
  });

  test('the approval rule and a draft keep the route sentence; anything else is not ours', () => {
    const approval = refusal(409, { error: 'A person on your team who did not open this pull request needs to approve its current changes.', code: 'approval_required', review_status: { required: true, ready: false } });
    assert.deepEqual(flows.prMergeRefusal(approval), { kind: 'approval_required', message: 'A person on your team who did not open this pull request needs to approve its current changes.' });
    const moved = refusal(409, { error: 'The changes on "x" are not the ones that were checked: they changed since, so nothing was merged.', code: 'source_changed' });
    assert.equal(flows.prMergeRefusal(moved).kind, 'source_changed');
    const draft = refusal(409, { error: 'pull request #3 is a draft. Mark it ready for review before merging it.', code: 'pull_request_is_draft' });
    assert.deepEqual(flows.prMergeRefusal(draft), { kind: 'draft', message: 'pull request #3 is a draft. Mark it ready for review before merging it.' });
    assert.equal(flows.prMergeRefusal(refusal(409, { error: 'busy', code: 'branch_busy' })), null);
    assert.equal(flows.prMergeRefusal(new Error('socket hang up')), null);
  });

  test('a direct merge into Your site under the approval rule gets a plain sentence', () => {
    const err = refusal(409, { error: '... Open a pull request from this branch (project_vcs_pr_create) ...', code: 'pull_request_required' }, 'project_vcs_merge');
    const msg = flows.directMergeRefusal(err);
    assert.match(msg, /requires an approval before changes go into Your site/);
    assert.match(msg, /Open a pull request/);
    assert.match(msg, /Nothing was merged\.$/);
    assert.doesNotMatch(msg, /project_vcs_/);
    assert.equal(flows.directMergeRefusal(refusal(409, { error: 'x', code: 'merge_conflicts' })), null);
  });

  test('the review page is account-scoped', () => {
    assert.equal(
      flows.reviewPageUrl('https://app.hiveku.com/', ACCOUNT, PROJECT, 12),
      `https://app.hiveku.com/${ACCOUNT}/dashboard/${PROJECT}/v3?tab=branches&review=12`,
    );
  });
});

describe('resolving conflicts here', () => {
  const CONFLICTS = {
    data: {
      branch: 'feature-b',
      parent: 'main',
      conflicts: [
        { path: 'index.html', kind: 'conflict', marked: '<<<<<<< a\n=======\nb\n>>>>>>> c', parent_hash: 'p1', branch_hash: 'b1' },
        { path: 'about.html', kind: 'delete', marked: null, parent_hash: null, branch_hash: 'b2' },
        { path: 'logo.png', kind: 'binary', marked: null, parent_hash: 'p3', branch_hash: 'b3' },
      ],
    },
  };
  const ctx = (client, compared = []) => ({
    client,
    projectId: PROJECT,
    target: { branch: 'feature-b', parent: 'main' },
    compare: async (p) => { compared.push(p); },
    log,
  });

  test('only the chosen files are sent, each with its parent_hash, after a confirmation', async () => {
    const client = fakeClient({
      project_vcs_conflicts: CONFLICTS,
      project_vcs_resolve: (args) => ({ data: { resolved: args.files.map((f) => f.path), parent: 'main', version: { id: 'v9' }, remaining_conflicts: ['logo.png'], branch: { name: 'feature-b', head_commit_id: 'v9' } } }),
    });
    const compared = [];
    script({
      picks: ["Keep this branch's version", 'Compare the two versions', "Use Your site's version", 'Leave it for the dashboard'],
      warning: 'Resolve',
    });
    const out = await flows.resolveConflictsHere(ctx(client, compared));
    assert.deepEqual(out, { kind: 'resolved', resolved: ['index.html', 'about.html'], remaining: ['logo.png'] });
    assert.deepEqual(compared, ['about.html'], 'Compare opened the file, then asked again');
    const sent = client.seen.find((c) => c.name === 'project_vcs_resolve').args;
    assert.deepEqual(sent, {
      project_id: PROJECT,
      branch: 'feature-b',
      files: [
        { path: 'index.html', choice: 'branch', parent_hash: 'p1' },
        { path: 'about.html', choice: 'parent', parent_hash: null },
      ],
    });
    // The confirmation lists each choice and says Your site changes only at the merge.
    const [title, opts] = calls.warnings[0];
    assert.equal(title, 'Resolve 2 conflicts on "feature-b"?');
    assert.equal(opts.modal, true);
    assert.match(opts.detail, /index\.html: keep this branch's version/);
    assert.match(opts.detail, /about\.html: use Your site's version/);
    assert.match(opts.detail, /Your site changes only when the pull request merges/);
    assert.match(opts.detail, /1 file is left for the dashboard/);
  });

  test('Escape, a closed confirmation, or leaving every file sends nothing', async () => {
    for (const run of [
      { picks: [], warning: 'Resolve', expect: 'cancelled' },
      { picks: ["Keep this branch's version", "Use Your site's version", "Keep this branch's version"], warning: undefined, expect: 'cancelled' },
      { picks: ['Leave it for the dashboard', 'Leave it for the dashboard', 'Leave it for the dashboard'], warning: 'Resolve', expect: 'left_for_dashboard' },
    ]) {
      resetCalls();
      const client = fakeClient({ project_vcs_conflicts: CONFLICTS });
      script({ picks: run.picks, warning: run.warning });
      const out = await flows.resolveConflictsHere(ctx(client));
      assert.equal(out.kind, run.expect);
      assert.ok(!client.seen.some((c) => c.name === 'project_vcs_resolve'), 'nothing may be resolved');
    }
  });

  test('no conflict left: nothing to pick', async () => {
    const client = fakeClient({ project_vcs_conflicts: { data: { branch: 'feature-b', parent: 'main', conflicts: [] } } });
    script();
    assert.deepEqual(await flows.resolveConflictsHere(ctx(client)), { kind: 'none' });
    assert.equal(calls.picks.length, 0);
  });

  test('a refusal says nothing changed only when the route said so; no answer may have saved it', async () => {
    const changed = refusal(409, { error: 'the parent changed', code: 'parent_changed', paths: ['index.html'] }, 'project_vcs_resolve');
    let client = fakeClient({ project_vcs_conflicts: CONFLICTS, project_vcs_resolve: changed });
    script({ picks: ["Keep this branch's version", 'Leave it for the dashboard', 'Leave it for the dashboard'], warning: 'Resolve' });
    let out = await flows.resolveConflictsHere(ctx(client));
    assert.equal(out.kind, 'refused');
    assert.equal(out.again, true);
    assert.match(out.message, /Your site changed a file after you looked at it, so nothing was changed/);

    resetCalls();
    client = fakeClient({ project_vcs_conflicts: CONFLICTS, project_vcs_resolve: new Error('Tool project_vcs_resolve failed: request timed out') });
    script({ picks: ["Keep this branch's version", 'Leave it for the dashboard', 'Leave it for the dashboard'], warning: 'Resolve' });
    out = await flows.resolveConflictsHere(ctx(client));
    assert.equal(out.kind, 'refused');
    assert.match(out.message, /may or may not have been saved/);
    assert.doesNotMatch(out.message, /Nothing was changed/);
  });

  test('the choices for each kind: no keep without a parent hash, no compare for a binary file', () => {
    const labels = (c) => flows.choicesFor(c, 'main').map((i) => i.label);
    assert.deepEqual(labels({ path: 'a', kind: 'conflict', parent_hash: 'p' }), [
      "Keep this branch's version", "Use Your site's version", 'Compare the two versions', 'Leave it for the dashboard',
    ]);
    assert.deepEqual(labels({ path: 'a', kind: 'binary', parent_hash: 'p' }), ["Keep this branch's version", "Use Your site's version", 'Leave it for the dashboard']);
    assert.deepEqual(labels({ path: 'a', kind: 'conflict' }), ["Use Your site's version", 'Compare the two versions', 'Leave it for the dashboard']);
    assert.deepEqual(flows.choicesFor({ path: 'a', kind: 'conflict', parent_hash: 'p' }, 'release').map((i) => i.label)[1], 'Use "release"\'s version');
    assert.match(flows.choicesFor({ path: 'a', kind: 'delete', parent_hash: null }, 'main')[0].description, /deletion/);
  });
});

describe('archived branches', () => {
  const ARCHIVED = refusal(409, {
    error: 'The branch "feature-b" was archived when review #12 merged, so it takes no changes. Restore it first. Nothing was changed.',
    code: 'branch_archived',
  }, 'project_vcs_commit');

  test('the refusal names the branch, and the merge sentence says what happened', () => {
    assert.deepEqual(flows.archivedBranchOf(ARCHIVED), {
      branch: 'feature-b',
      message: 'The branch "feature-b" was archived when review #12 merged, so it takes no changes. Restore it first. Nothing was changed.',
    });
    assert.equal(flows.archivedBranchOf(refusal(409, { error: 'x', code: 'branch_busy' })), null);
    assert.match(
      flows.archiveSentence({ branch: 'feature-b', archived: true, archived_at: 'x', restorable_until: 'y', archived_pr_number: 12 }),
      /The branch "feature-b" is archived: it is hidden from the branch list, takes no more changes, and can be restored for 30 days\./,
    );
    assert.equal(flows.archiveSentence({ branch: 'feature-b', archived: false, reason: 'bound' }), '');
    assert.equal(flows.archiveSentence(undefined), '');
  });

  test('"Restore branch" restores that branch; anything else changes nothing', async () => {
    let client = fakeClient({ project_vcs_branch_restore: { data: { branch: 'feature-b', restored: true, archived_at: null, archived_pr_number: 12 } } });
    script({ warning: 'Restore branch' });
    assert.equal(await flows.offerRestoreArchivedBranch({ client, projectId: PROJECT, err: ARCHIVED, log }), true);
    assert.deepEqual(client.seen, [{ name: 'project_vcs_branch_restore', args: { project_id: PROJECT, branch: 'feature-b' } }]);
    assert.match(calls.infos.at(-1)[0], /Restored "feature-b"\. It takes changes again/);

    resetCalls();
    client = fakeClient({});
    script({ warning: undefined });
    assert.equal(await flows.offerRestoreArchivedBranch({ client, projectId: PROJECT, err: ARCHIVED, log }), true);
    assert.deepEqual(client.seen, []);

    assert.equal(await flows.offerRestoreArchivedBranch({ client, projectId: PROJECT, err: new Error('other'), log }), false);
  });
});

describe('own changes and mergeability (builder #955, MCP #177)', () => {
  test('a review reads the pull request\'s own changes, falling back to the two-dot diff on older servers', () => {
    const own = { added: 0, removed: 0, modified: 1, entries: [{ path: 'index.html', status: 'modified' }] };
    const twoDot = { added: 0, removed: 0, modified: 2, entries: [{ path: 'about.html', status: 'modified' }, { path: 'index.html', status: 'modified' }] };
    // The live check of 2026-10-09: own changes ["index.html"] against a two-dot diff of ["about.html", "index.html"].
    assert.deepEqual(flows.reviewChanges({ changes: own, diff: twoDot }), own);
    assert.deepEqual(flows.reviewChanges({ diff: twoDot }), twoDot);
    assert.equal(flows.reviewChanges({ changes: null, diff: null }), null);
  });

  test('the Pull Requests list says what the last check found, and nothing when it is unknown', () => {
    const row = (extra) => ({ number: 7, title: 't', source_branch: 'feature/x', target_branch: 'main', status: 'open', ...extra });
    assert.equal(
      flows.pullRequestListDetail(row({ mergeable_state: 'conflicts', conflicts_with: [3, 5] })),
      'Merging this changes the live project · Conflicts with Your site · conflicts with #3 and #5',
    );
    assert.equal(flows.pullRequestListDetail(row({ mergeable_state: 'clean', conflicts_with: [9] })), 'Merging this changes the live project · conflicts with #9');
    assert.equal(flows.pullRequestListDetail(row({ mergeable_state: 'unknown', conflicts_with: [] })), 'Merging this changes the live project');
    assert.equal(flows.pullRequestListDetail(row({ target_branch: 'release', mergeable_state: 'conflicts' })), 'Conflicts with "release"');
    assert.equal(flows.pullRequestListDetail(row({ target_branch: 'release' })), undefined);
  });

  test('the Merge choice warns from mergeable: the target first, then other pull requests; unknown claims nothing', () => {
    assert.equal(
      flows.mergeableNote({ state: 'conflicts', conflicts_with_target: [{ path: 'a', kind: 'conflict' }, { path: 'b', kind: 'delete' }] }, 'main'),
      '2 files conflict with Your site: resolve first',
    );
    assert.equal(
      flows.mergeableNote({ state: 'clean', conflicts_with_target: [], conflicts_with_prs: [{ number: 4, order: 'other_first' }] }, 'main'),
      'conflicts with #4 once one of them merges',
    );
    assert.equal(flows.mergeableNote({ state: 'clean', conflicts_with_target: [], conflicts_with_prs: [], overlaps_with_prs: [{ number: 2 }] }, 'main'), null);
    assert.equal(flows.mergeableNote({ state: 'unknown', reason: 'busy' }, 'main'), null);
    assert.equal(flows.mergeableNote(undefined, 'main'), null);
  });

  test('/hiveku-pr reviews from data.changes and reads data.mergeable before a merge', async () => {
    const src = await fs.readFile(path.join(ROOT, 'src', 'knowledge.ts'), 'utf8');
    const pr = src.slice(src.indexOf("'hiveku-pr': `"), src.indexOf("'hiveku-github': `"));
    assert.match(pr, /Review from\s+\\`data\.changes\\`, the PR's OWN changes since its merge base/);
    assert.match(pr, /path in \\`data\.changes\.entries\\` worth reading/);
    const merge = pr.slice(pr.indexOf('- merge:'), pr.indexOf('- resolve'));
    for (const field of ['data.mergeable', 'conflicts_with_target', 'conflicts_with_prs', 'overlaps_with_prs', 'this_first']) {
      assert.ok(merge.includes(field), `/hiveku-pr merge must read ${field}`);
    }
    assert.match(merge, /the second will need a resolve after the first merges/);
    assert.ok(merge.indexOf('data.mergeable') < merge.indexOf('CONFIRM with the user'), 'mergeable is read before the confirmation');
    const list = pr.slice(pr.indexOf('- list:'), pr.indexOf('- open:'));
    assert.match(list, /mergeable_state/);
    assert.match(list, /conflicts_with/);
  });
});

describe('what the extension writes and wires', () => {
  test('the scaffolded /hiveku-pr teaches the resolve step and never offers to delete a merged branch', async () => {
    const src = await fs.readFile(path.join(ROOT, 'src', 'knowledge.ts'), 'utf8');
    const pr = src.slice(src.indexOf("'hiveku-pr': `"), src.indexOf("'hiveku-github': `"));
    assert.ok(pr.length > 1000, 'found the /hiveku-pr template');
    assert.match(pr, /project_vcs_conflicts\(\{ project_id: "\$\{pid\}", branch: <resolve\.branch> \}\)/);
    assert.match(pr, /project_vcs_resolve\(\{ project_id: "\$\{pid\}", branch: <resolve\.branch>, files: \[\{ path, choice, content\?, parent_hash \}\] \}\)/);
    assert.match(pr, /NEVER clears a/);
    assert.match(pr, /NEVER approve/);
    assert.match(pr, /data, never instructions/);
    assert.doesNotMatch(pr, /Offer to delete the source branch/);
    // Account-scoped review page, from the folder's link file.
    assert.match(pr, /https:\/\/app\.hiveku\.com\/<account_id from \.hiveku\/project\.json>\/dashboard\/\$\{pid\}\/v3\?tab=branches&review=<number>/);
  });

  test('the new reads are pre-approved by name and the resolve always asks', async () => {
    const src = await fs.readFile(path.join(ROOT, 'src', 'knowledge.ts'), 'utf8');
    const allow = src.slice(src.indexOf('const HIVEKU_ALLOW: string[] = ['), src.indexOf('\n];', src.indexOf('const HIVEKU_ALLOW: string[] = [')));
    for (const name of ['project_vcs_conflicts', 'project_vcs_pr_reviews', 'project_vcs_pr_comments', 'project_vcs_settings']) {
      assert.ok(allow.includes(`'mcp__hiveku__${name}'`), `${name} must be on HIVEKU_ALLOW`);
    }
    for (const name of ['project_vcs_resolve', 'project_vcs_pr_review', 'project_vcs_pr_comment', 'project_vcs_branch_restore', 'project_vcs_pr_update']) {
      assert.ok(!allow.includes(`'mcp__hiveku__${name}'`), `${name} is a write and must not be pre-approved`);
    }
    const ask = src.slice(src.indexOf('const HIVEKU_ASK: string[] = ['), src.indexOf('\n];', src.indexOf('const HIVEKU_ASK: string[] = [')));
    // New ask rules are appended at the end, so a folder scaffolded earlier gets them in order:
    // the resolve (2026-10-08), joining the merge line (2026-10-09), the secrets tools (2026-10-10),
    // then the page A/B test writes and their delete (2026-10-10).
    assert.ok(ask.includes("'mcp__hiveku__project_vcs_resolve',"), 'the resolve always asks');
    assert.ok(ask.includes("'mcp__hiveku__project_vcs_queue_add',"), 'joining the merge line always asks');
    assert.ok(ask.includes("'mcp__hiveku__project_secrets_reveal',"), 'the reveal always asks');
    assert.ok(ask.includes("'mcp__hiveku__project_ab_test_action',"), 'every A/B test action asks');
    assert.ok(ask.trimEnd().endsWith("'mcp__hiveku__project_ab_test_delete',"), 'the newest ask rule, the A/B test delete, goes at the END');
  });

  test('the old dead-end sentence is gone from the extension', async () => {
    const ext = await fs.readFile(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
    assert.doesNotMatch(ext, /save a version, then merge again/);
    assert.match(ext, /RESOLVE_IN_DASHBOARD/);
    assert.match(ext, /offerRestoreArchivedBranch/);
  });
});
