/**
 * What a scaffolded site folder teaches and allows about versions (Wave 2, D7).
 *
 * - `.claude/settings.json` auto-approves project_vcs_status BY NAME (a read)
 *   and never project_vcs_rollback, nor any project_vcs_* glob that would
 *   sweep it (or merge, stash, branch delete) in.
 * - No generated command pre-approves project_vcs_rollback in its
 *   allowed-tools: applying a rollback moves the live project's source and
 *   must always ask.
 * - /hiveku-rollback exists and is dry run -> yes -> apply with the head ->
 *   a separate deploy; /hiveku-commit teaches the no-files version on Your
 *   site, the plain-language name and 409 nothing_to_commit = done;
 *   /hiveku-push always versions after a push that fully landed.
 * - CLAUDE.md's loop is save/push -> verify -> version -> deploy, with a
 *   rollback paragraph; Codex AGENTS.md carries the three-line rule and
 *   stays small.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const knowledge = loadOut('knowledge');
const codex = loadOut('codex');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const PROJECT = '11111111-2222-3333-4444-555555555555';

async function scaffoldProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-versions-'));
  await knowledge.writeProjectScaffold({
    baseDir: dir, accountLabel: 'Western Stairlifts', apiKey: 'olp_test_key_123', baseUrl: 'https://core.hiveku.com',
    role: 'dev', accountId: ACCOUNT, projectId: PROJECT, projectName: 'Main site',
  });
  return dir;
}

const read = (dir, ...p) => fs.readFile(path.join(dir, ...p), 'utf8');

describe('permissions', () => {
  test('project_vcs_status is allowed by name; rollback and any project_vcs_* glob never are', async () => {
    const dir = await scaffoldProject();
    const settings = JSON.parse(await read(dir, '.claude', 'settings.json'));
    const allow = settings.permissions?.allow ?? [];
    assert.ok(allow.includes('mcp__hiveku__project_vcs_status'));
    assert.ok(!allow.some((r) => /project_vcs_rollback/.test(r)), 'rollback is never auto-approved');
    assert.ok(!allow.some((r) => /project_vcs_\*|project_\*|mcp__hiveku__\*$/.test(r)), 'no glob sweeps the vcs writes in');
  });

  test('project_vcs_rollback ALWAYS asks: an explicit ask rule, which holds in every mode (Autonomous included)', async () => {
    for (const mode of ['acceptEdits', 'bypassPermissions', 'default']) {
      knowledge.setPermissionMode(mode);
      try {
        const dir = await scaffoldProject();
        const settings = JSON.parse(await read(dir, '.claude', 'settings.json'));
        assert.equal(settings.permissions.defaultMode, mode);
        assert.ok(settings.permissions.ask?.includes('mcp__hiveku__project_vcs_rollback'), `${mode}: rollback is in permissions.ask`);
      } finally {
        knowledge.setPermissionMode('acceptEdits');
      }
    }
  });

  test('the ask rule merges: the user\'s own ask rules stay, and a re-scaffold adds no duplicate', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-versions-ask-'));
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fs.writeFile(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { ask: ['Bash(git push:*)'] } }));
    const args = {
      baseDir: dir, accountLabel: 'Western Stairlifts', apiKey: 'olp_test_key_123', baseUrl: 'https://core.hiveku.com',
      role: 'dev', accountId: ACCOUNT, projectId: PROJECT, projectName: 'Main site',
    };
    await knowledge.writeProjectScaffold(args);
    await knowledge.writeProjectScaffold(args);
    const settings = JSON.parse(await read(dir, '.claude', 'settings.json'));
    const ask = settings.permissions.ask;
    assert.equal(ask[0], 'Bash(git push:*)', "the user's own ask rule stays first");
    assert.equal(ask.filter((r) => r === 'mcp__hiveku__project_vcs_rollback').length, 1, 'the rollback rule is written once');
    assert.equal(new Set(ask).size, ask.length, 'a re-scaffold adds no duplicate');
  });

  test('no generated command pre-approves project_vcs_rollback in allowed-tools', async () => {
    const dir = await scaffoldProject();
    const cmdDir = path.join(dir, '.claude', 'commands');
    for (const name of await fs.readdir(cmdDir)) {
      const text = await fs.readFile(path.join(cmdDir, name), 'utf8');
      const allowed = (text.match(/^allowed-tools:(.*)$/m) ?? [])[1] ?? '';
      assert.ok(!/project_vcs_rollback/.test(allowed), `${name} pre-approves project_vcs_rollback`);
    }
  });
});

describe('what the commands teach', () => {
  test('/hiveku-rollback: dry run, an explicit yes, apply with the head, then a separate deploy', async () => {
    const dir = await scaffoldProject();
    const text = await read(dir, '.claude', 'commands', 'hiveku-rollback.md');
    const dry = text.indexOf('dry_run: true');
    const yes = text.indexOf('explicit YES');
    const apply = text.indexOf('dry_run: false');
    const deploy = text.indexOf('SEPARATE `/hiveku-deploy production`');
    assert.ok(dry !== -1 && yes > dry && apply > yes && deploy > apply, 'dry run, yes, apply, separate deploy, in that order');
    assert.match(text, /expected_head_commit_id: <the preview's head_commit_id>/);
    assert.match(text, /APPEND-ONLY/);
    assert.match(text, /branch_changed/);
    assert.match(text, new RegExp(PROJECT));
  });

  test('/hiveku-commit: a no-files version on Your site, plain-language names with examples, 409 = done', async () => {
    const dir = await scaffoldProject();
    const text = await read(dir, '.claude', 'commands', 'hiveku-commit.md');
    assert.match(text, /The usual call has NO files/);
    assert.match(text, /On Your site it saves EVERYTHING on Hiveku that is not a version yet/);
    assert.match(text, /"Updated the pricing section on the Home page"/);
    assert.match(text, /Never a file path, file name or extension, a `fix:`\/`feat:` prefix/);
    assert.match(text, /409 `nothing_to_commit` means everything is already a\s+version: that is DONE/);
    assert.doesNotMatch(text, /One call = one versioned commit/);
    assert.doesNotMatch(text, /source: "vscode"/, 'an agent never claims to be the extension');
  });

  test('/hiveku-push: always a version once every batch landed, never after a partial push', async () => {
    const dir = await scaffoldProject();
    const text = await read(dir, '.claude', 'commands', 'hiveku-push.md');
    assert.match(text, /A push is NOT a version\. Once EVERY batch landed, ALWAYS save it as one, on Your site and on a branch/);
    assert.match(text, /After a\s+partial push, do NOT save a version/);
  });

  test('/hiveku-pull pages the checkout and removes local files the tree no longer has (never local-only ones)', async () => {
    const dir = await scaffoldProject();
    const text = await read(dir, '.claude', 'commands', 'hiveku-pull.md');
    assert.match(text, /limit: 2000/);
    assert.match(text, /cursor: <next_cursor>/);
    assert.match(text, /DELETE local files that are not in the tree/);
    assert.match(text, /Never delete local-only files \(`\.hiveku\/`,\s+`\.claude\/`, `\.mcp\.json`, `\.env\*`/);
    assert.match(text, /`public\/<folder>\/`/);
  });

  test('/hiveku-rollback: rollback_incomplete finishes with THIS answer\'s head; a timeout is re-sent, not re-previewed', async () => {
    const dir = await scaffoldProject();
    // Prose wraps, so compare with whitespace collapsed.
    const text = (await read(dir, '.claude', 'commands', 'hiveku-rollback.md')).replace(/\s+/g, ' ');
    // The MCP tool's three cases: files WERE written; the preview's head or
    // saved_before.id -> apply with this answer's head and no fingerprint; any
    // other head -> someone else saved, so a new preview and a new yes.
    assert.ok(text.includes('409 `rollback_incomplete` (Your site only): files WERE written, so never say nothing changed'));
    assert.ok(text.includes("when its `head_commit_id` is the preview's `head_commit_id` or `saved_before.id`"));
    assert.ok(text.includes("apply again with `expected_head_commit_id` set to THIS answer's `head_commit_id` and without `expected_live_fingerprint`"));
    assert.ok(text.includes('Any other `head_commit_id` means someone else saved as well: preview again (step 3) and ask again.'));
    // No clear answer: never "nothing changed"; re-send the identical call or read History before any new preview.
    assert.ok(text.includes('No clear answer (a timeout, a 524, a network error, a 5xx): never say nothing changed.'));
    assert.ok(text.includes('call again with exactly the same arguments (409 `idempotency_pending`'));
    assert.ok(text.includes('Do not preview again until you know.'));
    // Wave 3c: the builder replays a cached answer only when that run succeeded
    // and nothing was saved since; otherwise the re-send runs again and can
    // answer branch_changed although files WERE written. The History check is
    // tied to the preview's head (an older rollback to the same version also has
    // that rolled_back_to).
    assert.ok(text.includes('then you get that run\'s own answer only when it succeeded and nothing was saved since; otherwise the call runs again'));
    assert.ok(text.includes("a version newer than the preview's `head_commit_id` whose `rolled_back_to` is this version means it finished"));
    assert.ok(text.includes('If the re-send answers 409 `branch_changed`, the first run may have finished or stopped part way, so never say nothing changed: read `project_vcs_history`.'));
    // "Saved before rollback" is the name every rollback's save-first version
    // gets (a teammate's dashboard rollback, an AI-turn Undo), so only one that
    // is the ONLY version newer than the preview's head is this rollback's own.
    assert.ok(text.includes('A "Saved before rollback" version at the top (the `branch_changed` answer\'s `head_commit_id`) that is the ONLY version newer than the preview\'s `head_commit_id` means it stopped part way: finish it as for `rollback_incomplete` (apply with that `head_commit_id` as `expected_head_commit_id`, without `expected_live_fingerprint`, on the same yes).'));
    assert.ok(text.includes('Anything else, including a "Saved before rollback" version with other versions between it and the preview\'s `head_commit_id`, means someone else saved as well: preview again (step 3) and ask again.'));
    assert.doesNotMatch(text, /version at the top \(the `branch_changed` answer's `head_commit_id`\) means it stopped part way/, 'the finish is tied to the preview\'s head');
    // The plain branch_changed rule defers to the timeout case, which comes later.
    assert.ok(text.includes('409 `branch_changed`: someone saved since the preview (unless it answers a re-send after a timeout: see below); preview again and ask again.'));
    assert.doesNotMatch(text, /then you get that run's own answer\)/, 'the replay promise is qualified');
    assert.doesNotMatch(text, /a new version whose `rolled_back_to`/, 'the History check is tied to the preview\'s head');
    // The old advice: after rollback_incomplete the preview can say noop (every
    // file is back) and the rollback would never be recorded as a version.
    assert.doesNotMatch(text, /apply with the NEW preview's head/);
    assert.doesNotMatch(text, /preview again: `noop: true` means it landed/);
    // CLAUDE.md names the field the preview returns, not the argument it feeds.
    const claude = (await read(dir, 'CLAUDE.md')).replace(/\s+/g, ' ');
    assert.ok(claude.includes("with the preview's `head_commit_id` as `expected_head_commit_id` (on Your site also its `live_fingerprint` as `expected_live_fingerprint`)"));
    assert.doesNotMatch(claude, /the preview's `expected_head_commit_id`/);
  });

  test('no generated text promises an automatic save after a few quiet minutes', async () => {
    const dir = await scaffoldProject();
    for (const f of [['CLAUDE.md'], ['.claude', 'commands', 'hiveku-commit.md'], ['.claude', 'commands', 'hiveku-push.md']]) {
      assert.doesNotMatch(await read(dir, ...f), /quiet minutes/, f.join('/'));
    }
  });

  test('a no-files version never re-reads the branch etag (it does not change the working tree)', async () => {
    const dir = await scaffoldProject();
    const push = await read(dir, '.claude', 'commands', 'hiveku-push.md');
    assert.doesNotMatch(push, /re-read\s+`project_vcs_branches` afterwards/);
    assert.match(push, /keep the\s+`last_tree_etag` from step 6/);
    const commit = await read(dir, '.claude', 'commands', 'hiveku-commit.md');
    assert.match(commit, /A version with NO files leaves the working tree and\s+its etag as they were/);
  });

  test('/hiveku-deploy checks for changes that are not a version yet', async () => {
    const dir = await scaffoldProject();
    const text = await read(dir, '.claude', 'commands', 'hiveku-deploy.md');
    assert.match(text, /^allowed-tools:.*mcp__hiveku__project_vcs_status/m);
    assert.match(text, /save a version before deploying/);
  });

  test('CLAUDE.md: save/push, verify, version, deploy, and how to go back', async () => {
    const dir = await scaffoldProject();
    const text = await read(dir, 'CLAUDE.md');
    assert.match(text, /The loop is save\/push → verify → \*\*version\*\* → deploy/);
    assert.match(text, /\*\*Go back\*\* with `\/hiveku-rollback`/);
    assert.match(text, /`\/hiveku-rollback \[version\]`/);
    assert.doesNotMatch(text, /One call = one\s+versioned commit on `main`/);
  });
});

describe('Codex', () => {
  test('AGENTS.md carries the versions rule and stays small', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-codex-versions-'));
    await codex.writeCodexScaffold({
      baseDir: dir, apiKey: 'olp_test_key_123', baseUrl: 'https://core.hiveku.com', accountLabel: 'Western Stairlifts',
      accountId: ACCOUNT, kind: 'project', projectName: 'Main site',
    });
    const agents = await read(dir, 'AGENTS.md');
    assert.match(agents, /\*\*Versions\.\*\*/);
    assert.match(agents, /`project_vcs_commit\(\{ project_id, message \}\)`\s+with NO files/);
    assert.match(agents, /`project_vcs_rollback`: dry run first, the user's yes/);
    assert.ok(Buffer.byteLength(agents, 'utf8') < 8 * 1024);
  });
});
