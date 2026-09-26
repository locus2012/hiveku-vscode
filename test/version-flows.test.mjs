/**
 * Versions you can roll back, the VS Code side (versionFlows.ts): the dialogs
 * and the status-bar dot, driven through the vscode stub with a fake MCP
 * client that records every tool call.
 *
 * What is pinned, and why each would fail without the Wave 2 change:
 * - a push that fully landed is saved as ONE version (no files re-sent,
 *   source vscode), named from the Source Control box (used as is when it is
 *   plain) or from what changed; "never" and Escape save nothing and promise
 *   only what holds today; an old server is left alone;
 * - the Commit button on a clean folder offers to version what Hiveku holds
 *   on Your site (main) when the server reports it, and says "everything is
 *   already a version" only when Hiveku said so;
 * - going back lists only restorable versions (paged), previews first, offers
 *   "Go back and update live site" FIRST, applies with the preview's head,
 *   deploys only as a separate call after the rollback, only when chosen, and
 *   says "updating" only when the deploy ships that version; files the
 *   rollback removed leave the folder before the re-download; an apply that
 *   may have landed (timeout, rollback_incomplete) is checked again, never
 *   reported as "nothing changed";
 * - the deploy gate offers to save a version when the shipped tree has
 *   changes that are not one yet (not for the assistant's notes alone), and
 *   never blocks on its own failure;
 * - the dot reflects the server's "not a version yet", stays hidden on an old
 *   server, and the 60-second read stops when the server has no status tool.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vscodeStub, calls, config, resetCalls } from './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const flows = loadOut('versionFlows');

const NEW_TOOLS = ['project_vcs_commit', 'project_vcs_status', 'project_vcs_rollback', 'project_vcs_history'];
const OLD_TOOLS = ['project_vcs_commit', 'project_vcs_history', 'project_vcs_revert'];
const log = { lines: [], appendLine(l) { this.lines.push(l); } };

/** A fake MCP client: tools/list from `tools`, answers by tool name, records every call. */
function client(tools, answers = {}) {
  const seen = [];
  return {
    seen,
    async listToolNames() {
      return tools;
    },
    async callToolJson(name, args = {}) {
      seen.push({ name, args });
      const a = answers[name];
      if (typeof a === 'function') return a(args);
      if (a instanceof Error) throw a;
      if (a === undefined) throw new Error(`unexpected tool ${name}`);
      return a;
    },
  };
}

function refusal(status, body) {
  const err = new Error(`Tool failed (${status}): ${body.error}`);
  err.payload = { error: body.error, status, details: body, attempts: 1 };
  return err;
}

const original = { ...vscodeStub.window };
/** Script the person's answers: modal buttons, typed names, picks. */
function answers({ warning, info, input, pick } = {}) {
  vscodeStub.window.showWarningMessage = (...a) => {
    calls.warnings.push(a);
    return Promise.resolve(typeof warning === 'function' ? warning(...a) : warning);
  };
  vscodeStub.window.showInformationMessage = (...a) => {
    calls.infos.push(a);
    return Promise.resolve(typeof info === 'function' ? info(...a) : info);
  };
  vscodeStub.window.showInputBox = (...a) => {
    calls.inputs.push(a);
    return Promise.resolve(typeof input === 'function' ? input(...a) : input);
  };
  vscodeStub.window.showQuickPick = (...a) => {
    calls.picks.push(a);
    return Promise.resolve(typeof pick === 'function' ? pick(...a) : pick);
  };
}

beforeEach(() => {
  Object.assign(vscodeStub.window, original);
  resetCalls();
  config.clear();
  log.lines.length = 0;
});

const commitAnswer = { data: { id: 'v1', promoted: true } };
const PUSH_CHANGES = { added: ['src/app/pricing/page.tsx'], modified: [], removed: [] };

describe('D2: a push that fully landed becomes one version', () => {
  test('ask (default): prefilled from what changed, checked, saved with no files as vscode', async () => {
    let offered;
    answers({
      input: (opts) => {
        offered = opts;
        return 'Added the Pricing page';
      },
    });
    const c = client(NEW_TOOLS, { project_vcs_commit: commitAnswer });
    const box = { value: '' };
    const r = await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'main', inputBox: box, log, changes: PUSH_CHANGES });
    assert.equal(r.outcome, 'saved');
    assert.equal(offered.value, 'Added the Pricing page', 'prefilled from describeChanges');
    assert.equal(typeof offered.validateInput('fix: prices'), 'string', 'a commit prefix is refused in the box');
    assert.equal(offered.validateInput('Added the Pricing page'), undefined);
    const commit = c.seen.find((s) => s.name === 'project_vcs_commit');
    assert.deepEqual(commit.args, { project_id: 'p1', message: 'Added the Pricing page', files: [], deletedFiles: [], source: 'vscode' });
  });

  test('ask: a plain name typed in the Source Control box is used without asking again, then cleared', async () => {
    answers({ input: (opts) => opts.value });
    const c = client(NEW_TOOLS, { project_vcs_commit: commitAnswer });
    const box = { value: 'Spring prices' };
    await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'feat/x', inputBox: box, log, changes: PUSH_CHANGES });
    assert.equal(calls.inputs.length, 0, 'the person already named it');
    const commit = c.seen.find((s) => s.name === 'project_vcs_commit');
    assert.equal(commit.args.message, 'Spring prices');
    assert.equal(commit.args.branch, 'feat/x');
    assert.equal(box.value, '');
  });

  test('ask: a typed name that is not plain is offered in the box, where the rule says why', async () => {
    let offered;
    answers({ input: (opts) => { offered = opts; return 'Updated the prices'; } });
    const c = client(NEW_TOOLS, { project_vcs_commit: commitAnswer });
    const box = { value: 'fix: prices.tsx' };
    await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'main', inputBox: box, log, changes: PUSH_CHANGES });
    assert.equal(calls.inputs.length, 1);
    assert.equal(offered.value, 'fix: prices.tsx');
    assert.equal(typeof offered.validateInput(offered.value), 'string');
    assert.equal(c.seen.find((s) => s.name === 'project_vcs_commit').args.message, 'Updated the prices');
  });

  test('Escape saves nothing and says only what holds today: save by hand, or a production publish saves it', async () => {
    answers({ input: undefined });
    const c = client(NEW_TOOLS, { project_vcs_commit: commitAnswer });
    const r = await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'main', inputBox: { value: '' }, log, changes: PUSH_CHANGES });
    assert.equal(r, 'declined');
    assert.equal(c.seen.filter((s) => s.name === 'project_vcs_commit').length, 0);
    const said = calls.infos.at(-1)[0];
    assert.match(said, /^Pushed, not saved as a version yet\. Save one any time with Hiveku: Save a Version; publishing Your site to production also saves it first\.$/);
    assert.doesNotMatch(said, /automatically|quiet minutes/, 'no promise of a sweeper that is not scheduled');
  });

  test('on a branch the not-a-version line does not mention publishing Your site', async () => {
    answers({ input: undefined });
    const c = client(NEW_TOOLS, { project_vcs_commit: commitAnswer });
    await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'feat/x', inputBox: { value: '' }, log, changes: PUSH_CHANGES });
    assert.equal(calls.infos.at(-1)[0], 'Pushed, not saved as a version yet. Save one any time with Hiveku: Save a Version.');
  });

  test('auto: no prompt, the name comes from what changed', async () => {
    config.set('push.saveVersion', 'auto');
    const c = client(NEW_TOOLS, { project_vcs_commit: commitAnswer });
    await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'main', inputBox: { value: '' }, log, changes: PUSH_CHANGES });
    assert.equal(calls.inputs.length, 0);
    assert.equal(c.seen.find((s) => s.name === 'project_vcs_commit').args.message, 'Added the Pricing page');
  });

  test('auto with a box name that is not plain falls back to the made name', async () => {
    config.set('push.saveVersion', 'auto');
    const c = client(NEW_TOOLS, { project_vcs_commit: commitAnswer });
    const box = { value: 'fix: pricing page.tsx' };
    await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'main', inputBox: box, log, changes: PUSH_CHANGES });
    assert.equal(c.seen.find((s) => s.name === 'project_vcs_commit').args.message, 'Added the Pricing page');
    assert.equal(box.value, 'fix: pricing page.tsx', 'a name that was not used stays in the box');
  });

  test('never: nothing is asked or saved', async () => {
    config.set('push.saveVersion', 'never');
    const c = client(NEW_TOOLS, { project_vcs_commit: commitAnswer });
    assert.equal(await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'main', inputBox: { value: '' }, log, changes: PUSH_CHANGES }), 'skipped');
    assert.equal(calls.inputs.length, 0);
    assert.equal(c.seen.length, 0);
  });

  test('an old server (no project_vcs_status) keeps the old behaviour: no version, no prompt', async () => {
    const c = client(OLD_TOOLS, {});
    assert.equal(await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'feat/x', inputBox: { value: '' }, log, changes: PUSH_CHANGES }), 'skipped');
    assert.equal(calls.inputs.length, 0);
    assert.equal(c.seen.length, 0);
  });

  test('a push of shared-library images only has nothing to version', async () => {
    const c = client(NEW_TOOLS, {});
    assert.equal(await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'main', inputBox: { value: '' }, log, changes: { added: [], modified: [], removed: [] } }), 'skipped');
    assert.equal(calls.inputs.length, 0);
  });

  test('a refused save never throws: it says the push landed and the version did not', async () => {
    answers({ input: 'Added the Pricing page' });
    const c = client(NEW_TOOLS, { project_vcs_commit: refusal(409, { error: 'busy', code: 'branch_busy' }) });
    const r = await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'main', inputBox: { value: '' }, log, changes: PUSH_CHANGES });
    assert.equal(r, 'failed');
    assert.match(calls.warnings.at(-1)[0], /^Pushed, but it was not saved as a version/);
  });

  test('409 nothing_to_commit is "already a version", not an error', async () => {
    answers({ input: 'Added the Pricing page' });
    const c = client(NEW_TOOLS, { project_vcs_commit: refusal(409, { error: 'nothing', code: 'nothing_to_commit', latest_version: null }) });
    const r = await flows.versionAfterPush({ client: c, projectId: 'p1', branch: 'main', inputBox: { value: '' }, log, changes: PUSH_CHANGES });
    assert.equal(r.outcome, 'nothing');
    assert.equal(calls.warnings.length, 0);
  });
});

describe('D3: the Commit button on a clean folder versions what Hiveku holds on Your site', () => {
  const dirty = { data: { branch: 'main', head_commit_id: 'h1', uncommitted: true, uncommitted_reason: 'changed', latest_changes: { state: 'pending', since: null, summary: 'Edited the Home page', files: 1 } } };

  test('offers "Save version" in words about Your site (main), then promotes with no files', async () => {
    answers({ info: (msg) => (/Your site \(main\)/.test(msg) ? 'Save version' : undefined) });
    const c = client(NEW_TOOLS, { project_vcs_status: dirty, project_vcs_commit: commitAnswer });
    const box = { value: 'Updated the Home page' };
    assert.equal(await flows.promoteMainIfUncommitted({ client: c, projectId: 'p1', name: 'Updated the Home page', log, inputBox: box }), 'offered');
    const commit = c.seen.find((s) => s.name === 'project_vcs_commit');
    assert.deepEqual(commit.args, { project_id: 'p1', message: 'Updated the Home page', files: [], deletedFiles: [], source: 'vscode' });
    assert.equal(box.value, '');
    assert.match(calls.infos[0][0], /aren't a version yet/);
    assert.ok(!/commit/i.test(calls.infos[0][0]), 'says version, not commit');
  });

  test('declined: nothing is saved, the name stays, and the caller does not also say "nothing to save"', async () => {
    answers({ info: undefined });
    const c = client(NEW_TOOLS, { project_vcs_status: dirty, project_vcs_commit: commitAnswer });
    const box = { value: 'Updated the Home page' };
    assert.equal(await flows.promoteMainIfUncommitted({ client: c, projectId: 'p1', name: 'Updated the Home page', log, inputBox: box }), 'offered');
    assert.equal(c.seen.filter((s) => s.name === 'project_vcs_commit').length, 0);
    assert.equal(box.value, 'Updated the Home page');
  });

  test('"everything is already a version" only when Hiveku said so: clean, old server, failed read', async () => {
    const clean = client(NEW_TOOLS, { project_vcs_status: { data: { branch: 'main', uncommitted: false, uncommitted_reason: null } } });
    assert.equal(await flows.promoteMainIfUncommitted({ client: clean, projectId: 'p1', name: 'x', log }), 'clean');
    const old = client(OLD_TOOLS, {});
    assert.equal(await flows.promoteMainIfUncommitted({ client: old, projectId: 'p1', name: 'x', log }), 'unsupported');
    assert.equal(old.seen.length, 0, 'an old server is not even asked');
    const broken = client(NEW_TOOLS, { project_vcs_status: new Error('offline') });
    assert.equal(await flows.promoteMainIfUncommitted({ client: broken, projectId: 'p1', name: 'x', log }), 'unknown');
    assert.equal(calls.infos.length, 0, 'no modal for any of them');
    const versions = loadOut('versions');
    assert.match(versions.nothingToSaveMessage('clean'), /everything is already a version/);
    for (const why of ['unsupported', 'unknown', 'notes']) {
      assert.doesNotMatch(versions.nothingToSaveMessage(why), /everything is already a version/, why);
    }
  });

  test('a status that says it does not know still offers the save, worded as not known', async () => {
    answers({ info: (msg) => (/could not say/.test(msg) ? 'Save version' : undefined) });
    const unknown = { data: { branch: 'main', uncommitted: false, uncommitted_reason: 'unknown', latest_changes: null } };
    const c = client(NEW_TOOLS, { project_vcs_status: unknown, project_vcs_commit: refusal(409, { error: 'nothing', code: 'nothing_to_commit', latest_version: null }) });
    assert.equal(await flows.promoteMainIfUncommitted({ client: c, projectId: 'p1', name: 'Updated the Home page', log }), 'offered');
    assert.match(calls.infos[0][0], /could not say whether everything on Your site \(main\) is a version yet/);
    assert.equal(calls.infos.at(-1)[0], 'Already saved as a version. Nothing new to save.');
  });

  test('only the assistant notes changed: not offered, and said as such', async () => {
    const notes = { data: { branch: 'main', uncommitted: true, uncommitted_reason: 'changed', latest_changes: { state: 'pending', summary: "Updated the assistant's notes", files: 0 } } };
    const c = client(NEW_TOOLS, { project_vcs_status: notes, project_vcs_commit: commitAnswer });
    assert.equal(await flows.promoteMainIfUncommitted({ client: c, projectId: 'p1', name: 'x', log }), 'notes');
    assert.equal(calls.infos.length, 0);
    assert.equal(c.seen.filter((s) => s.name === 'project_vcs_commit').length, 0);
  });

  test('a save that fails is said, and never thrown into the Commit button', async () => {
    answers({ info: 'Save version' });
    const c = client(NEW_TOOLS, { project_vcs_status: dirty, project_vcs_commit: refusal(409, { error: 'Another save is running', code: 'branch_busy' }) });
    assert.equal(await flows.promoteMainIfUncommitted({ client: c, projectId: 'p1', name: 'Updated the Home page', log }), 'offered');
    assert.equal(calls.warnings.at(-1)[0], 'The version was not saved: Another save is running.');
  });
});

describe('D4: going back to a version', () => {
  const history = {
    data: [
      { id: 'head', branch_name: 'main', message: 'Newest', source: 'ai_turn', created_at: '2026-09-25T10:00:00Z', restorable: true },
      { id: 't1', branch_name: 'main', message: 'Before the sale', source: 'vscode', created_at: '2026-09-24T10:00:00Z', checkpoint_hash: null, restorable: true },
    ],
    meta: { total: 2, returned: 2, truncated: false, nextBefore: null },
  };
  const dry = {
    data: {
      dry_run: true, branch: 'main', head_commit_id: 'head', live_fingerprint: 'f'.repeat(64), target: { id: 't1', name: 'Before the sale' },
      noop: false, changes: { files: { changed: 2, removed: 0, added_back: 0 }, pages: [{ label: 'Home', status: 'changed', paths: [] }], hidden: 0 },
      auto_version: null, versions_undone: { count: 1, newest: [{ id: 'head', name: 'Newest' }] }, assets_affected: false,
      live_includes_undone_work: true, ai_turn_running: false,
    },
  };
  const applied = { data: { dry_run: false, version: { id: 'v2', name: 'Rolled back to "Before the sale"' }, auto_version: null, branch: { name: 'main', head_commit_id: 'v2' }, noop: false, target: { id: 't1', name: 'Before the sale' } } };

  async function tmpRoot() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'hk-goback-'));
  }

  function ctx(c, order, branch = 'main', extra = {}) {
    return {
      client: c,
      projectId: 'p1',
      branch,
      log,
      root: extra.root ?? path.join(os.tmpdir(), 'hk-goback-none'),
      localChanges: async () => extra.local ?? 0,
      pullInto: async () => order.push('pull'),
      refresh: async () => order.push('refresh'),
      deployProduction: async () => {
        order.push('deploy');
        return extra.deploy ?? { deployment_id: 'd1', status: 'queued' };
      },
    };
  }

  function rollbackAnswers(order, applyAnswer = applied, dryAnswer = dry) {
    return {
      project_vcs_status: { data: { branch: 'main', head_commit_id: 'head', uncommitted: false } },
      project_vcs_history: history,
      project_vcs_rollback: (args) => {
        order.push(args.dry_run === false ? 'apply' : 'dry');
        if (args.dry_run === false && applyAnswer instanceof Error) throw applyAnswer;
        if (args.dry_run !== false && typeof dryAnswer === 'function') return dryAnswer(args);
        return args.dry_run === false ? applyAnswer : dryAnswer;
      },
    };
  }

  test('"Go back and update live site" is the first button; apply uses the preview head; deploy is a separate, later call', async () => {
    const order = [];
    let modal;
    answers({
      pick: (items) => items.find((i) => i.entry?.id === 't1'),
      warning: (msg, opts, ...buttons) => {
        modal = { msg, opts, buttons };
        return buttons[0];
      },
    });
    const c = client(NEW_TOOLS, rollbackAnswers(order));
    assert.equal(await flows.goBackToVersion(ctx(c, order, 'main', { deploy: { deployment_id: 'd1', status: 'queued', vcs_commit_id: 'v2' } })), 'applied');
    assert.deepEqual(modal.buttons, ['Go back and update live site', 'Go back only']);
    assert.match(modal.msg, /^Go back to "Before the sale"\? Newer versions stay in History\.$/);
    assert.match(modal.opts.detail, /2 files go back/);
    assert.deepEqual(order, ['dry', 'apply', 'deploy', 'pull', 'refresh']);
    const apply = c.seen.find((s) => s.name === 'project_vcs_rollback' && s.args.dry_run === false);
    assert.deepEqual(apply.args, { project_id: 'p1', commit_id: 't1', dry_run: false, expected_head_commit_id: 'head', expected_live_fingerprint: 'f'.repeat(64) });
    const dryCall = c.seen.find((s) => s.name === 'project_vcs_rollback');
    assert.equal(dryCall.args.dry_run, true, 'the preview sends dry_run explicitly');
    const said = calls.infos.at(-1)[0];
    assert.match(said, /The live site is updating\./, 'the deploy shipped the version the rollback made');
    assert.match(said, /To undo it, go back to the version before it \(Hiveku: Go Back to a Version…\)\./);
    assert.doesNotMatch(said, /from History/, 'History is a read-only list');
  });

  test('a deploy that does not report shipping that version relays its note instead of "updating"', async () => {
    const order = [];
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => b[0] });
    const note = 'Publishing your current files. They could not be saved as a version first, so this publish is not linked to a version.';
    const c = client(NEW_TOOLS, rollbackAnswers(order));
    await flows.goBackToVersion(ctx(c, order, 'main', { deploy: { deployment_id: 'd1', status: 'queued', note } }));
    const said = calls.infos.at(-1)[0];
    assert.ok(said.includes(note));
    assert.doesNotMatch(said, /The live site is updating/);
    // GitHub-connected: no version fields and no note at all.
    resetCalls();
    const order2 = [];
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => b[0] });
    const c2 = client(NEW_TOOLS, rollbackAnswers(order2));
    await flows.goBackToVersion(ctx(c2, order2, 'main', { deploy: { deployment_id: 'd2', status: 'queued' } }));
    assert.match(calls.infos.at(-1)[0], /did not confirm it ships the version you went back to/);
  });

  test('the picker lists this branch\'s restorable versions except the current one, as name · who · when', async () => {
    const order = [];
    let items;
    answers({ pick: (i) => { items = i; return undefined; } });
    const withBlocked = {
      data: [
        ...history.data,
        { id: 'old', branch_name: 'main', message: 'Checkpoint era', created_at: '2026-01-01T10:00:00Z', restorable: false, restore_blocked_reason: 'No saved copy' },
      ],
      meta: { nextBefore: null },
    };
    const c = client(NEW_TOOLS, { ...rollbackAnswers(order), project_vcs_history: withBlocked });
    assert.equal(await flows.goBackToVersion(ctx(c, order)), 'cancelled');
    const versions = items.filter((i) => i.entry);
    assert.deepEqual(versions.map((i) => i.entry.id), ['t1'], 'restorable:false is never offered');
    assert.equal(versions[0].label, 'Before the sale');
    assert.match(versions[0].description, /^VS Code · /);
    assert.ok(items.some((i) => i.blocked && /1 older version can only be restored from Project history/.test(i.label)));
    assert.deepEqual(order, [], 'nothing previewed or applied');
    const h = c.seen.find((s) => s.name === 'project_vcs_history');
    assert.deepEqual(h.args, { project_id: 'p1', limit: 100, branch: 'main' });
  });

  test('older versions are paged with before= (meta.nextBefore) when the person asks for them', async () => {
    const order = [];
    const page1 = { data: Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, branch_name: 'main', message: `Change ${i}`, created_at: '2026-09-20T10:00:00Z', restorable: true })), meta: { nextBefore: '2026-09-20T09:00:00Z' } };
    const page2 = { data: [{ id: 'ancient', branch_name: 'main', message: 'Launch day', created_at: '2026-01-01T10:00:00Z', restorable: true }], meta: { nextBefore: '2026-01-01T09:00:00Z' } };
    let shown = 0;
    answers({
      pick: (items) => {
        shown++;
        if (shown === 1) return items.find((i) => i.older);
        assert.ok(!items.some((i) => i.older), 'a short page is the last one, whatever meta says');
        return undefined;
      },
    });
    const c = client(NEW_TOOLS, {
      ...rollbackAnswers(order),
      project_vcs_history: (args) => (args.before ? page2 : page1),
    });
    await flows.goBackToVersion(ctx(c, order));
    const calls2 = c.seen.filter((s) => s.name === 'project_vcs_history');
    assert.equal(calls2.length, 2);
    assert.equal(calls2[1].args.before, '2026-09-20T09:00:00Z');
    assert.equal(calls.picks.at(-1)[0].filter((i) => i.entry).length, 101, 'older versions are added below the newer ones');
  });

  test('"Go back only" never deploys', async () => {
    const order = [];
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => b[1] });
    const c = client(NEW_TOOLS, rollbackAnswers(order));
    await flows.goBackToVersion(ctx(c, order));
    assert.deepEqual(order, ['dry', 'apply', 'pull', 'refresh']);
    assert.match(calls.infos.at(-1)[0], /live site was not changed/);
  });

  test('closing the modal applies nothing', async () => {
    const order = [];
    answers({ pick: (i) => i[0], warning: undefined });
    const c = client(NEW_TOOLS, rollbackAnswers(order));
    assert.equal(await flows.goBackToVersion(ctx(c, order)), 'cancelled');
    assert.deepEqual(order, ['dry']);
  });

  test('on Your site, local changes are described truthfully: edits replaced, files only here kept', async () => {
    const order = [];
    let detail;
    answers({ pick: (i) => i[0], warning: (_m, o) => { detail = o.detail; return undefined; } });
    const c = client(NEW_TOOLS, rollbackAnswers(order));
    await flows.goBackToVersion(ctx(c, order, 'main', { local: 2 }));
    assert.match(detail, /2 local changes in this folder: edited files are replaced when it re-downloads; files only in this folder are kept\./);
  });

  test('files the rollback removed leave the folder (to the trash) before the re-download; local-only and outside paths never', async () => {
    const root = await tmpRoot();
    const outside = await tmpRoot();
    await fs.mkdir(path.join(root, 'src/app/sale'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/app/sale/page.tsx'), 'sale');
    await fs.writeFile(path.join(root, '.env.local'), 'SECRET=1');
    await fs.writeFile(path.join(root, 'keep.txt'), 'mine');
    await fs.writeFile(path.join(outside, 'x.txt'), 'x');
    const rel = path.relative(root, path.join(outside, 'x.txt'));
    const removing = {
      data: {
        ...dry.data,
        changes: {
          files: { changed: 0, removed: 3, added_back: 0 },
          entries: [
            { path: 'src/app/sale/page.tsx', status: 'removed' },
            { path: '.env.local', status: 'removed' },
            { path: rel, status: 'removed' },
            { path: 'keep.txt', status: 'changed' },
          ],
          truncated: false, pages: [], hidden: 0,
        },
      },
    };
    const order = [];
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => b[1] });
    const c = client(NEW_TOOLS, rollbackAnswers(order, applied, removing));
    const context = ctx(c, order, 'main', { root });
    context.pullInto = async () => {
      order.push('pull');
      await assert.rejects(fs.access(path.join(root, 'src/app/sale/page.tsx')), 'removed before the snapshot re-download');
    };
    assert.equal(await flows.goBackToVersion(context), 'applied');
    await assert.rejects(fs.access(path.join(root, 'src/app/sale/page.tsx')));
    assert.deepEqual(calls.trashed, [{ path: path.join(root, 'src/app/sale/page.tsx'), useTrash: true }]);
    await fs.access(path.join(root, '.env.local'));
    await fs.access(path.join(root, 'keep.txt'));
    await fs.access(path.join(outside, 'x.txt'));
  });

  test('a truncated removal list says how many removed files may still be in the folder', async () => {
    const root = await tmpRoot();
    const many = { data: { ...dry.data, changes: { files: { changed: 0, removed: 700, added_back: 0 }, entries: [{ path: 'a.txt', status: 'removed' }], truncated: true, pages: [], hidden: 0 } } };
    const order = [];
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => b[1] });
    const c = client(NEW_TOOLS, rollbackAnswers(order, applied, many));
    await flows.goBackToVersion(ctx(c, order, 'main', { root }));
    assert.match(calls.infos.at(-1)[0], /Up to 699 more files removed on Hiveku may still be in this folder/);
  });

  test('a branch re-downloads with its own tree (which deletes): nothing is trashed by hand', async () => {
    const root = await tmpRoot();
    await fs.writeFile(path.join(root, 'gone.txt'), 'x');
    const order = [];
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => b[0] });
    const branchHistory = { data: [{ id: 'b1', branch_name: 'feat/x', message: 'First try', created_at: '2026-09-24T10:00:00Z' }] };
    const c = client(NEW_TOOLS, {
      project_vcs_branches: { data: [{ branch_name: 'feat/x', head_commit_id: 'bh' }] },
      project_vcs_history: branchHistory,
      project_vcs_rollback: (args) => {
        order.push(args.dry_run === false ? 'apply' : 'dry');
        return args.dry_run === false
          ? applied
          : { data: { ...dry.data, branch: 'feat/x', head_commit_id: 'bh', live_fingerprint: null, changes: { files: { changed: 0, removed: 1, added_back: 0 }, entries: [{ path: 'gone.txt', status: 'removed' }] } } };
      },
    });
    assert.equal(await flows.goBackToVersion(ctx(c, order, 'feat/x', { root })), 'applied');
    assert.equal(calls.trashed.length, 0);
  });

  test('someone saved since the preview: the refusal says nothing changed; no re-check, no deploy, no re-pull', async () => {
    const order = [];
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => b[0] });
    const c = client(NEW_TOOLS, rollbackAnswers(order, refusal(409, { error: 'moved', code: 'branch_changed', head_commit_id: 'h9' })));
    let shown;
    vscodeStub.window.showErrorMessage = (m) => { shown = m; return Promise.resolve(undefined); };
    assert.equal(await flows.goBackToVersion(ctx(c, order)), 'refused');
    assert.deepEqual(order, ['dry', 'apply']);
    assert.match(shown, /Someone changed this while you were looking\. Nothing was changed\./);
  });

  test('no answer from the apply (client timeout): asked again; noop means it landed, so the folder catches up', async () => {
    const order = [];
    let asked = 0;
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => b[1] });
    const c = client(NEW_TOOLS, rollbackAnswers(order, new Error('MCP request timed out after 135s (tools/call)'), () => {
      asked++;
      return asked === 1 ? dry : { data: { ...dry.data, head_commit_id: 'v9', noop: true } };
    }));
    let errorShown = false;
    vscodeStub.window.showErrorMessage = () => { errorShown = true; return Promise.resolve(undefined); };
    assert.equal(await flows.goBackToVersion(ctx(c, order)), 'applied');
    assert.deepEqual(order, ['dry', 'apply', 'dry', 'pull', 'refresh']);
    assert.equal(errorShown, false, 'never "nothing was changed" for a rollback that may have landed');
    assert.match(calls.infos.at(-1)[0], /is back to "Before the sale"/);
  });

  test('rollback_incomplete: files WERE written; "Finish going back" applies with the FRESH preview head', async () => {
    const order = [];
    let asked = 0;
    const warnings = [];
    answers({
      pick: (i) => i[0],
      warning: (msg, _o, ...b) => {
        warnings.push(msg);
        return b.includes('Finish going back') ? 'Finish going back' : b[1];
      },
    });
    let applies = 0;
    const c = client(NEW_TOOLS, {
      ...rollbackAnswers(order),
      project_vcs_rollback: (args) => {
        if (args.dry_run === false) {
          order.push('apply');
          applies++;
          if (applies === 1) throw refusal(409, { error: 'incomplete', code: 'rollback_incomplete', applied: ['a'], failed: ['b'], head_commit_id: 'mid' });
          return applied;
        }
        order.push('dry');
        asked++;
        return asked === 1 ? dry : { data: { ...dry.data, head_commit_id: 'mid', live_fingerprint: 'e'.repeat(64) } };
      },
    });
    assert.equal(await flows.goBackToVersion(ctx(c, order)), 'applied');
    assert.deepEqual(order, ['dry', 'apply', 'dry', 'apply', 'pull', 'refresh']);
    assert.match(warnings[1], /Some files went back to "Before the sale", but not all of them\. Finish going back\?/);
    const second = c.seen.filter((s) => s.name === 'project_vcs_rollback' && s.args.dry_run === false)[1];
    assert.equal(second.args.expected_head_commit_id, 'mid');
    assert.equal(second.args.expected_live_fingerprint, 'e'.repeat(64));
  });

  test('rollback_incomplete, not finished: the folder is refreshed and told not to push the newer files back', async () => {
    const order = [];
    let asked = 0;
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => (b.includes('Finish going back') ? undefined : b[1]) });
    const c = client(NEW_TOOLS, rollbackAnswers(order, refusal(409, { error: 'incomplete', code: 'rollback_incomplete', applied: [], failed: ['b'] }), () => {
      asked++;
      return asked === 1 ? dry : { data: { ...dry.data, head_commit_id: 'mid' } };
    }));
    assert.equal(await flows.goBackToVersion(ctx(c, order)), 'incomplete');
    assert.deepEqual(order, ['dry', 'apply', 'dry', 'refresh']);
    assert.match(calls.warnings.at(-1)[0], /^Not finished\. .*Pull Latest/);
  });

  test('already there on Hiveku but not in this folder: offers to re-download instead of stopping', async () => {
    const order = [];
    answers({ pick: (i) => i[0], info: (_m, _o, ...b) => b[0] });
    const c = client(NEW_TOOLS, rollbackAnswers(order, applied, { data: { ...dry.data, noop: true } }));
    assert.equal(await flows.goBackToVersion(ctx(c, order, 'main', { local: 3 })), 'noop');
    assert.deepEqual(order, ['dry', 'pull', 'refresh']);
    assert.match(calls.infos[0][0], /already matches "Before the sale" on Hiveku, but this folder has 3 local changes/);
  });

  test('the AI still working stops at the preview', async () => {
    const order = [];
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => b[0] });
    const busy = { data: { ...dry.data, ai_turn_running: true } };
    const c = client(NEW_TOOLS, { ...rollbackAnswers(order), project_vcs_rollback: (args) => { order.push(args.dry_run === false ? 'apply' : 'dry'); return busy; } });
    assert.equal(await flows.goBackToVersion(ctx(c, order)), 'refused');
    assert.deepEqual(order, ['dry']);
  });

  test('a branch gets one "Go back" button and never a deploy', async () => {
    const order = [];
    let buttons;
    answers({ pick: (i) => i[0], warning: (_m, _o, ...b) => { buttons = b; return b[0]; } });
    const branchHistory = { data: [{ id: 'b1', branch_name: 'feat/x', message: 'First try', created_at: '2026-09-24T10:00:00Z' }] };
    const c = client(NEW_TOOLS, {
      project_vcs_branches: { data: [{ branch_name: 'feat/x', head_commit_id: 'bh' }] },
      project_vcs_history: branchHistory,
      project_vcs_rollback: (args) => {
        order.push(args.dry_run === false ? 'apply' : 'dry');
        return args.dry_run === false ? applied : { data: { ...dry.data, branch: 'feat/x', head_commit_id: 'bh', live_fingerprint: null } };
      },
    });
    assert.equal(await flows.goBackToVersion(ctx(c, order, 'feat/x')), 'applied');
    assert.deepEqual(buttons, ['Go back']);
    assert.deepEqual(order, ['dry', 'apply', 'pull', 'refresh']);
    const apply = c.seen.find((s) => s.name === 'project_vcs_rollback' && s.args.dry_run === false);
    assert.deepEqual(apply.args, { project_id: 'p1', commit_id: 'b1', dry_run: false, branch: 'feat/x', expected_head_commit_id: 'bh' });
  });
});

describe('D5: the deploy gate', () => {
  const dirty = {
    data: {
      branch: 'main', uncommitted: true, latest_changes: { state: 'pending', summary: 'Edited the Home page', files: 1 },
      changed_files: [{ path: 'src/app/about/page.tsx', status: 'modified' }],
    },
  };

  test('changes not yet a version: "Save version & deploy" saves one (prefilled from what changed), then proceeds', async () => {
    let offered;
    answers({ warning: (_m, _o, ...b) => b[0], input: (opts) => { offered = opts; return opts.value; } });
    const c = client(NEW_TOOLS, { project_vcs_status: dirty, project_vcs_commit: commitAnswer });
    assert.equal(await flows.versionBeforeDeploy({ client: c, projectId: 'p1', tree: 'main', tier: 'production', log }), 'proceed');
    assert.equal(offered.value, 'Edited the About page');
    const status = c.seen.find((s) => s.name === 'project_vcs_status');
    assert.equal(status.args.detail, 'files');
    const commit = c.seen.find((s) => s.name === 'project_vcs_commit');
    assert.deepEqual(commit.args, { project_id: 'p1', message: 'Edited the About page', files: [], deletedFiles: [], source: 'vscode' });
    assert.deepEqual(calls.warnings[0].slice(2), ['Save version & deploy', 'Deploy anyway']);
  });

  test('"Deploy anyway" proceeds without a version; closing cancels the deploy', async () => {
    answers({ warning: 'Deploy anyway' });
    const c = client(NEW_TOOLS, { project_vcs_status: dirty });
    assert.equal(await flows.versionBeforeDeploy({ client: c, projectId: 'p1', tree: 'main', tier: 'development', log }), 'proceed');
    answers({ warning: undefined });
    assert.equal(await flows.versionBeforeDeploy({ client: c, projectId: 'p1', tree: 'main', tier: 'development', log }), 'cancel');
  });

  test('a bound branch is checked, not Your site', async () => {
    answers({ warning: 'Deploy anyway' });
    const c = client(NEW_TOOLS, { project_vcs_status: { data: { branch: 'feat/x', uncommitted: false } } });
    await flows.versionBeforeDeploy({ client: c, projectId: 'p1', tree: 'feat/x', tier: 'staging', log });
    assert.equal(c.seen[0].args.branch, 'feat/x');
    assert.equal(calls.warnings.length, 0, 'clean: no modal');
  });

  test('only the assistant notes changed: no modal, the deploy goes ahead', async () => {
    const notes = { data: { branch: 'main', uncommitted: true, uncommitted_reason: 'changed', latest_changes: { state: 'pending', summary: "Updated the assistant's notes", files: 0 }, changed_files: [] } };
    const c = client(NEW_TOOLS, { project_vcs_status: notes });
    assert.equal(await flows.versionBeforeDeploy({ client: c, projectId: 'p1', tree: 'main', tier: 'production', log }), 'proceed');
    assert.equal(calls.warnings.length, 0);
  });

  test('a head from before versions still asks (legacy_head reads as needing a version)', async () => {
    answers({ warning: 'Deploy anyway' });
    const legacy = { data: { branch: 'main', uncommitted: true, uncommitted_reason: 'legacy_head', latest_changes: { state: 'pending', summary: null, files: 0 } } };
    const c = client(NEW_TOOLS, { project_vcs_status: legacy });
    await flows.versionBeforeDeploy({ client: c, projectId: 'p1', tree: 'main', tier: 'production', log });
    assert.equal(calls.warnings.length, 1);
    assert.match(calls.warnings[0][1].detail, /^Production ships Your site \(main\)\./);
  });

  test('never blocks on its own failure, and an old server is not asked', async () => {
    const broken = client(NEW_TOOLS, { project_vcs_status: new Error('timeout') });
    assert.equal(await flows.versionBeforeDeploy({ client: broken, projectId: 'p1', tree: 'main', tier: 'production', log }), 'proceed');
    const old = client(OLD_TOOLS, {});
    assert.equal(await flows.versionBeforeDeploy({ client: old, projectId: 'p1', tree: 'main', tier: 'production', log }), 'proceed');
    assert.equal(old.seen.length, 0);
  });
});

describe('D6: the status-bar dot', () => {
  const folder = { root: '/tmp/site', branch: 'main', link: { project_id: 'p1', account_id: 'a1' } };
  // Every indicator is disposed after its test, pass or fail: a live
  // 60-second timer would otherwise keep the test runner from exiting.
  const live = [];
  afterEach(() => { for (const ind of live.splice(0)) ind.dispose(); });
  const indicator = (...args) => { const ind = new flows.VersionIndicator(...args); live.push(ind); return ind; };

  test('Hiveku reports changes not yet a version: a dot, and a click saves a version; the 60-second read runs', async () => {
    const c = client(NEW_TOOLS, { project_vcs_status: { data: { branch: 'main', uncommitted: true, uncommitted_reason: 'changed', latest_changes: { files: 2 } } } });
    const ind = indicator(async () => c, () => folder, log);
    let fired = 0;
    ind.onDidChange(() => fired++);
    await ind.refreshNow(folder);
    const bar = ind.barState(folder, 0);
    assert.equal(bar.text, '$(git-branch) Your site (main) $(circle-filled)');
    assert.equal(bar.command, 'hiveku.commit');
    assert.equal(fired, 1);
    assert.equal(ind.polling, true);
    ind.dispose();
    assert.equal(ind.polling, false);
  });

  test('an old server: no dot at all (not even for local changes), a click still switches branch, no 60-second read', async () => {
    const c = client(OLD_TOOLS, {});
    const ind = indicator(async () => c, () => folder, log);
    await ind.refreshNow(folder);
    assert.equal(ind.remote(folder), undefined);
    assert.equal(ind.barState(folder, 0).text, '$(git-branch) Your site (main)');
    const withLocal = ind.barState(folder, 3);
    assert.equal(withLocal.text, '$(git-branch) Your site (main)', 'the compatibility matrix: indicator hidden');
    assert.equal(withLocal.command, 'hiveku.switchBranch');
    assert.equal(ind.polling, false);
    assert.equal(c.seen.length, 0);
    ind.dispose();
  });

  test('before the first read the bar keeps its old behaviour', () => {
    const ind = indicator(async () => client(NEW_TOOLS, {}), () => folder, log);
    assert.equal(ind.barState(folder, 2).command, 'hiveku.switchBranch');
    ind.dispose();
  });

  test('local changes on a server with versions: a dot and a click that saves a version', async () => {
    const c = client(NEW_TOOLS, { project_vcs_status: { data: { branch: 'main', uncommitted: false, uncommitted_reason: null } } });
    const ind = indicator(async () => c, () => folder, log);
    await ind.refreshNow(folder);
    const bar = ind.barState(folder, 2);
    assert.equal(bar.text, '$(git-branch) Your site (main) $(circle-filled)');
    assert.equal(bar.command, 'hiveku.commit');
    ind.dispose();
  });

  test('only the assistant notes changed on Hiveku: no dot', async () => {
    const c = client(NEW_TOOLS, { project_vcs_status: { data: { branch: 'main', uncommitted: true, uncommitted_reason: 'changed', latest_changes: { files: 0 } } } });
    const ind = indicator(async () => c, () => folder, log);
    await ind.refreshNow(folder);
    assert.equal(ind.barState(folder, 0).text, '$(git-branch) Your site (main)');
    ind.dispose();
  });

  test('a failed read is unknown, never a dot', async () => {
    const c = client(NEW_TOOLS, { project_vcs_status: new Error('offline') });
    const ind = indicator(async () => c, () => folder, log);
    await ind.refreshNow(folder);
    assert.equal(ind.remote(folder), undefined);
    assert.equal(ind.barState(folder, 0).command, 'hiveku.switchBranch');
    ind.dispose();
  });

  test('refresh-driven reads are throttled; a forced read is not', async () => {
    const c = client(NEW_TOOLS, { project_vcs_status: { data: { branch: 'main', uncommitted: false } } });
    const ind = indicator(async () => c, () => folder, log);
    await ind.refreshNow(folder);
    ind.refreshSoon(folder);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(c.seen.length, 1, 'a refresh right after a read does not read again');
    await ind.refreshNow(folder);
    assert.equal(c.seen.length, 2);
    ind.dispose();
  });
});
