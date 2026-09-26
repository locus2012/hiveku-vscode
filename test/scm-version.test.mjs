/**
 * The Source Control provider's side of versions (scm.ts), driven end to end
 * through HivekuScm with the vscode stub, a real temp folder and a fake MCP
 * client that records every tool call.
 *
 * What is pinned, and why each would fail without the change:
 * - only a push that FULLY landed becomes a version: a failed batch or a
 *   cancelled deletion makes no project_vcs_commit call and says so;
 * - a push that landed makes exactly ONE no-files version, as vscode;
 * - after that version a branch keeps the etag its own last save returned: a
 *   version never re-keys the working tree, and re-reading it would record
 *   someone else's save as ours and silence the "branch changed" warning;
 * - the same for a promote from a clean branch folder: the etag read BEFORE
 *   the modal is recorded, never a fresh one;
 * - the Commit button refuses a name that is not plain before sending anything;
 * - 409 nothing_to_commit on a commit WITH files is "already a version";
 * - "everything is already a version" is only said when Hiveku said so.
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

const { HivekuScm } = loadOut('scm');

const NEW_TOOLS = ['project_vcs_commit', 'project_vcs_status', 'project_vcs_rollback', 'project_vcs_history'];
const OLD_TOOLS = ['project_vcs_commit', 'project_vcs_history', 'project_vcs_revert'];
const log = { lines: [], appendLine(l) { this.lines.push(l); } };

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
function answers({ warning, info, input } = {}) {
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
}

const made = [];
beforeEach(() => {
  Object.assign(vscodeStub.window, original);
  resetCalls();
  config.clear();
  log.lines.length = 0;
});
afterEach(() => {
  for (const scm of made.splice(0)) scm.dispose();
});

/** A folder with `files` ({ path: text }) and a link on `branch`. */
async function folder(files, link = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-scm-'));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), text);
  }
  return {
    dir,
    link: { project_id: 'p1', account_id: 'a1', account_label: 'Acme', project_name: 'Site', ...link },
  };
}

function scmFor(f, c) {
  const scm = new HivekuScm(vscodeStub.Uri.file(f.dir), f.link, async () => c, log);
  made.push(scm);
  return scm;
}

const tree = (branch, files, etag = null) => ({
  data: { branch_name: branch, files: files.map(([p, content]) => ({ path: p, content, encoding: 'utf-8' })), head_commit_id: 'h1', working_tree_etag: etag, next_cursor: null, total_files: files.length },
});
const saved = (n, etag) => ({ data: { summary: { total: n, succeeded: n, failed: 0 }, results: [], working_tree_etag: etag } });
const commits = (c) => c.seen.filter((s) => s.name === 'project_vcs_commit');

/** project_vcs_branches: `first` for the first read, `later` for every read after it. */
function branchesThen(first, later) {
  let n = 0;
  return () => {
    n++;
    const ref = n === 1 ? first : later;
    return { data: [{ branch_name: 'feat/x', head_commit_id: 'bh', ...ref }] };
  };
}

describe('push: only a push that fully landed becomes a version', () => {
  test('a failed batch saves no version and says so', async () => {
    config.set('push.saveVersion', 'auto');
    const f = await folder({ 'src/a.ts': 'new', 'src/b.ts': 'added' }, { branch: 'feat/x', last_tree_etag: 'e1' });
    const c = client(NEW_TOOLS, {
      project_vcs_checkout: tree('feat/x', [['src/a.ts', 'old']], 'e1'),
      project_vcs_branches: branchesThen({ working_tree_etag: 'e1' }, { working_tree_etag: 'e1' }),
      project_files_bulk_save: new Error('socket hang up'),
      project_vcs_commit: { data: { id: 'v1', promoted: true } },
    });
    await scmFor(f, c).push();
    assert.equal(commits(c).length, 0);
    assert.match(calls.errors.at(-1)[0], /^Push incomplete: .*Not saved as a version until every file is in\.$/);
  });

  test('a cancelled deletion saves no version and says so, even though its uploads landed', async () => {
    config.set('push.saveVersion', 'auto');
    const f = await folder({ 'src/a.ts': 'new' }, { branch: 'feat/x', last_tree_etag: 'e1' });
    const c = client(NEW_TOOLS, {
      project_vcs_checkout: tree('feat/x', [['src/a.ts', 'old'], ['src/gone.ts', 'x']], 'e1'),
      project_vcs_branches: branchesThen({ working_tree_etag: 'e1' }, { working_tree_etag: 'e1' }),
      project_files_bulk_save: saved(1, 'e2'),
      project_file_delete: { data: { ok: true } },
      project_vcs_commit: { data: { id: 'v1', promoted: true } },
    });
    answers({ warning: (_m, _o, ...b) => (b.includes('Upload and delete') ? 'Upload and delete' : undefined) });
    vscodeStub.window.withProgress = (_opts, task) => task({ report() {} }, { isCancellationRequested: true, onCancellationRequested() { return { dispose() {} }; } });
    await scmFor(f, c).push();
    assert.equal(c.seen.filter((s) => s.name === 'project_files_bulk_save').length, 1, 'the upload half ran');
    assert.equal(c.seen.filter((s) => s.name === 'project_file_delete').length, 0);
    assert.equal(commits(c).length, 0);
    assert.ok(calls.warnings.some((w) => /^Push cancelled — .*Not saved as a version\.$/.test(w[0])));
  });

  test('a full push on Your site makes exactly one no-files version, as vscode', async () => {
    config.set('push.saveVersion', 'auto');
    const f = await folder({ 'src/app/about/page.tsx': 'new' });
    const c = client(NEW_TOOLS, {
      project_vcs_checkout: tree('main', [['src/app/about/page.tsx', 'old']]),
      project_files_bulk_save: saved(1),
      project_files_status: { data: { changed: [], only_local: [], only_remote: [] } },
      project_vcs_commit: { data: { id: 'v1', promoted: true } },
    });
    await scmFor(f, c).push();
    assert.equal(commits(c).length, 1);
    assert.deepEqual(commits(c)[0].args, { project_id: 'p1', message: 'Edited the About page', files: [], deletedFiles: [], source: 'vscode' });
  });

  test('after a branch push is saved as a version, the etag is the one this push saved, never a re-read', async () => {
    config.set('push.saveVersion', 'auto');
    const f = await folder({ 'src/a.ts': 'new', 'src/b.ts': 'added' }, { branch: 'feat/x', last_tree_etag: 'e1' });
    const c = client(NEW_TOOLS, {
      project_vcs_checkout: tree('feat/x', [['src/a.ts', 'old']], 'e1'),
      // The guard's read sees e1; any later read sees someone else's save.
      project_vcs_branches: branchesThen({ working_tree_etag: 'e1' }, { working_tree_etag: 'e-someone-else' }),
      project_files_bulk_save: saved(2, 'e2'),
      project_vcs_commit: { data: { id: 'v1', promoted: true } },
    });
    const scm = scmFor(f, c);
    await scm.push();
    assert.equal(commits(c).length, 1);
    assert.equal(commits(c)[0].args.branch, 'feat/x');
    assert.equal(scm.link.last_tree_etag, 'e2');
    const onDisk = JSON.parse(await fs.readFile(path.join(f.dir, '.hiveku', 'project.json'), 'utf8'));
    assert.equal(onDisk.last_tree_etag, 'e2');
    assert.equal(c.seen.filter((s) => s.name === 'project_vcs_branches').length, 1, 'only the guard reads the branch');
  });
});

describe('the Commit button', () => {
  test('a name that is not plain is refused before anything is sent', async () => {
    const f = await folder({ 'src/a.ts': 'new' });
    const c = client(NEW_TOOLS, {});
    const scm = scmFor(f, c);
    scm.sc.inputBox.value = 'fix: header.tsx';
    await scm.commit();
    assert.equal(c.seen.length, 0);
    assert.equal(calls.warnings.length, 1);
    assert.match(calls.warnings[0][0], /./);
    assert.equal(scm.sc.inputBox.value, 'fix: header.tsx', 'the name stays to be fixed');
  });

  test('409 nothing_to_commit on a commit WITH files is "already a version", not an error', async () => {
    const f = await folder({ 'src/a.ts': 'same-as-live' });
    const c = client(NEW_TOOLS, {
      project_files_status: { data: { changed: [{ path: 'src/a.ts' }], only_local: [], only_remote: [] } },
      project_vcs_commit: refusal(409, { error: 'nothing to commit on main: every change is already in a version', code: 'nothing_to_commit', latest_version: null }),
    });
    const scm = scmFor(f, c);
    scm.sc.inputBox.value = 'Updated the header';
    await scm.commit();
    assert.equal(commits(c).length, 1);
    assert.equal(commits(c)[0].args.files.length, 1);
    assert.equal(commits(c)[0].args.source, 'vscode');
    assert.equal(calls.errors.length, 0);
    assert.ok(calls.infos.some((i) => i[0] === 'Already saved as a version. Nothing new to save.'));
    assert.equal(scm.sc.inputBox.value, '');
  });

  test('a clean folder on an old server says only that it matches (no claim about versions)', async () => {
    const f = await folder({ 'src/a.ts': 'x' });
    const c = client(OLD_TOOLS, { project_files_status: { data: { changed: [], only_local: [], only_remote: [] } } });
    const scm = scmFor(f, c);
    scm.sc.inputBox.value = 'Updated the header';
    await scm.commit();
    assert.equal(calls.infos.at(-1)[0], 'Nothing to save: this folder matches Hiveku.');
  });

  test('a clean folder whose status cannot be read does not claim everything is a version', async () => {
    const f = await folder({ 'src/a.ts': 'x' });
    const c = client(NEW_TOOLS, {
      project_files_status: { data: { changed: [], only_local: [], only_remote: [] } },
      project_vcs_status: new Error('offline'),
    });
    const scm = scmFor(f, c);
    scm.sc.inputBox.value = 'Updated the header';
    await scm.commit();
    assert.doesNotMatch(calls.infos.at(-1)[0], /everything is already a version/);
    assert.match(calls.infos.at(-1)[0], /could not say/);
  });

  test('promoting a clean branch folder records the etag read before the modal, not a fresh one', async () => {
    const f = await folder({ 'src/a.ts': 'same' }, { branch: 'feat/x', last_tree_etag: 'e0' });
    const c = client(NEW_TOOLS, {
      project_vcs_checkout: tree('feat/x', [['src/a.ts', 'same']], 'e5'),
      project_vcs_branches: branchesThen({ working_tree_etag: 'e5', uncommitted: true }, { working_tree_etag: 'e-someone-else', uncommitted: false }),
      project_vcs_commit: { data: { id: 'v1', promoted: true } },
    });
    answers({ info: (_m, _o, ...b) => (b.includes('Save version') ? 'Save version' : undefined) });
    const scm = scmFor(f, c);
    scm.sc.inputBox.value = 'Updated the header';
    await scm.commit();
    assert.equal(commits(c).length, 1);
    assert.deepEqual(commits(c)[0].args, { project_id: 'p1', message: 'Updated the header', files: [], deletedFiles: [], branch: 'feat/x', source: 'vscode' });
    assert.equal(scm.link.last_tree_etag, 'e5');
  });
});
