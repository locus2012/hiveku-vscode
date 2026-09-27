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
 * VERSIONS (Wave 2). The same file pins the extension's side of "versions you
 * can roll back": the naming port (src/versionName.ts) against EVERY row of the
 * builder's fixture table (copied to scripts/fixtures/version-naming-cases.json),
 * the guarantee that a suggested name never carries a path, extension or byline,
 * that vcsCommit only promotes main when a caller with server capabilities asks,
 * that a rollback always sends dry_run and never applies on main without the dry
 * run's head, and that a checkout pages until the tree ends (src/versions.ts).
 *
 * Run: node --import ./scripts/register-ts.mjs scripts/check-vcs-helpers.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const api = await import('../src/hivekuApi.ts');
const vn = await import('../src/versionName.ts');
const versions = await import('../src/versions.ts');

let n = 0;
const check = async (name, fn) => {
  await fn();
  n++;
  console.log(`  ok  ${name}`);
};

await check('branchArg omits main / empty / whitespace-main', () => {
  assert.deepEqual(api.branchArg('main'), {});
  assert.deepEqual(api.branchArg(''), {});
  assert.deepEqual(api.branchArg(undefined), {});
  assert.deepEqual(api.branchArg(null), {});
  assert.deepEqual(api.branchArg('  main '), {});
});
await check('branchArg forwards a real branch, trimmed', () => {
  assert.deepEqual(api.branchArg('feat/x'), { branch: 'feat/x' });
  assert.deepEqual(api.branchArg(' feat/x '), { branch: 'feat/x' });
});

await check('readPromoted reads promoted inside data (the commit route shape)', () => {
  assert.equal(api.readPromoted({ data: { id: 'c1', promoted: true }, preview_effect: {} }), true);
});
await check('readPromoted reads a hoisted sibling too', () => {
  assert.equal(api.readPromoted({ data: { id: 'c1' }, promoted: true }), true);
});
await check('readPromoted is false, never undefined, when absent or malformed', () => {
  assert.equal(api.readPromoted({ data: { id: 'c1' } }), false);
  assert.equal(api.readPromoted({ data: { id: 'c1', promoted: 'yes' } }), false);
  assert.equal(api.readPromoted(null), false);
  assert.equal(api.readPromoted('nope'), false);
});

await check('readSibling prefers data, falls back to root, else undefined', () => {
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
await check('bindingLabel names the served branch per tier', () => {
  assert.equal(api.bindingLabel('development', bindings), 'development - serves branch feat/x');
  assert.equal(api.bindingLabel('staging', bindings), 'staging - serves main');
  assert.equal(api.bindingLabel('production', bindings), 'production - always main');
});
await check('bindingLabel never guesses when bindings are unavailable', () => {
  assert.equal(api.bindingLabel('development', undefined), 'development - binding unknown');
  assert.equal(api.bindingLabel('production', undefined), 'production - always main');
});
await check('tiersBoundTo lists only tiers bound to that branch', () => {
  assert.deepEqual(api.tiersBoundTo(bindings, 'feat/x'), ['development']);
  assert.deepEqual(api.tiersBoundTo(bindings, 'main'), []);
  assert.deepEqual(api.tiersBoundTo(undefined, 'feat/x'), []);
});

await check('diffSideText: absent side is empty, binary and oversized are labelled', () => {
  assert.equal(api.diffSideText(null), '');
  assert.equal(api.diffSideText({ content: 'hi', encoding: 'utf-8' }), 'hi');
  assert.equal(api.diffSideText({ content: 'aGk=', encoding: 'base64' }), '(binary file — no text diff)');
  assert.equal(api.diffSideText({ tooLarge: true }), '(file over 1 MB — too large to show)');
});

await check('stashCounts still normalizes both lanes (envelope irregularity kept)', () => {
  assert.deepEqual(api.stashCounts({ status: 'stashed', modified: 1, pendingAdds: 2, pendingDeletes: 3 }), {
    modified: 1,
    added: 2,
    deleted: 3,
    total: 6,
  });
});

// ── Versions (Wave 2) ─────────────────────────────────────────────────────────

const FIXTURE_PATH = new URL('./fixtures/version-naming-cases.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

await check('naming fixture: the copied table is whole (153 paths, 94 changes, 31 name checks, max 80)', () => {
  assert.equal(fixture.max_name_length, 80);
  assert.equal(vn.MAX_VERSION_NAME_LENGTH, fixture.max_name_length);
  assert.ok(fixture.paths.length >= 153, `paths: ${fixture.paths.length}`);
  assert.ok(fixture.changes.length >= 94, `changes: ${fixture.changes.length}`);
  assert.ok(fixture.name_checks.length >= 31, `name_checks: ${fixture.name_checks.length}`);
});

await check('naming fixture: describePath matches EVERY paths row (whole object, route only on pages)', () => {
  for (const c of fixture.paths) {
    const expected = { kind: c.expected_kind, name: c.expected_name };
    if (c.expected_route !== undefined) expected.route = c.expected_route;
    assert.deepEqual(vn.describePath(c.path), expected, c.path);
  }
});

await check('naming fixture: describeChanges matches EVERY changes row', () => {
  for (const c of fixture.changes) assert.equal(vn.describeChanges(c.input), c.expected, JSON.stringify(c.input));
});

await check('naming fixture: isPlainVersionName and stripLegacyVersionPrefix match EVERY name_checks row', () => {
  let bylineRows = 0;
  for (const c of fixture.name_checks) {
    assert.equal(vn.isPlainVersionName(c.name), c.expected_plain, JSON.stringify(c.name));
    if (typeof c.expected_without_byline === 'string') {
      bylineRows++;
      assert.equal(vn.stripLegacyVersionPrefix(c.name), c.expected_without_byline, JSON.stringify(c.name));
    }
  }
  assert.ok(bylineRows >= 11, `byline rows: ${bylineRows}`);
});

await check('versionNameProblem says nothing exactly when a name is plain (never accepts what the rule refuses)', () => {
  const names = [...fixture.name_checks.map((c) => c.name), 'Updated globals.css', 'feat: x', 'AI: y', 'a/b', 'x'.repeat(81)];
  for (const name of names) {
    const problem = vn.versionNameProblem(name);
    assert.equal(problem === undefined, vn.isPlainVersionName(name), JSON.stringify(name));
    if (problem) assert.ok(!/[\\/]|\.tsx?\b/.test(problem.replace(/'[^']*'/g, '')), `the explanation itself stays plain: ${problem}`);
  }
});

/** A small deterministic generator, so the property checks are the same on every run. */
function prng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

await check('describeChanges never emits a path, extension, prefix or byline (every fixture input + 3,000 random mixes)', () => {
  const pool = fixture.paths.map((c) => c.path);
  const ugly = [
    'src/app/(site)/pricing/page.tsx', 'components/Header.tsx', 'app/globals.css', '.env.local',
    'public/images/hero.png', 'pages/api/contact.ts', 'lib/db.ts', 'README.md', 'package.json',
    'fix:/weird.ts', 'AI:/notes.md', 'x/y/z/very-long-folder-name-that-keeps-going/and-going/page.tsx',
  ];
  const all = [...pool, ...ugly];
  const assertPlain = (name, input) => {
    assert.ok(vn.isPlainVersionName(name), `${JSON.stringify(name)} from ${JSON.stringify(input).slice(0, 200)}`);
    assert.ok(!name.includes('/'), name);
  };
  for (const c of fixture.changes) assertPlain(vn.describeChanges(c.input), c.input);
  const rand = prng(20260925);
  for (let i = 0; i < 3000; i++) {
    const pick = () => all[Math.floor(rand() * all.length)];
    const size = () => Math.floor(rand() * 12);
    const input = {
      added: Array.from({ length: size() }, pick),
      modified: Array.from({ length: size() }, pick),
      removed: Array.from({ length: size() }, pick),
    };
    const name = vn.describeChanges(input);
    if (name !== 'No changes') assertPlain(name, input);
    const single = vn.describeChange([...input.added, ...input.modified]);
    if (single !== 'No changes') assertPlain(single, input);
  }
});

await check('the fixture copy matches the builder checkout next door, when one is there (warning only)', () => {
  for (const rel of ['../../hiveku_builder/src/lib/vcs/__fixtures__/version-naming-cases.json']) {
    const sibling = new URL(rel, import.meta.url);
    if (!existsSync(sibling)) continue;
    const theirs = readFileSync(sibling, 'utf8');
    const ours = readFileSync(FIXTURE_PATH, 'utf8');
    if (theirs !== ours) {
      console.warn(`  !!  ${sibling.pathname} differs from scripts/fixtures/version-naming-cases.json: re-copy it and re-port versionName.ts if the rules changed`);
    }
  }
});

/** A fake MCP client: answers by tool name, records every call. */
function fakeClient(answers, toolNames) {
  const seen = [];
  const client = {
    seen,
    listCalls: 0,
    async callToolJson(name, args = {}) {
      seen.push({ name, args });
      const a = answers[name];
      if (typeof a === 'function') return a(args, seen.filter((s) => s.name === name).length);
      if (a instanceof Error) throw a;
      if (a === undefined) throw new Error(`unexpected tool ${name}`);
      return a;
    },
  };
  if (toolNames) {
    client.listToolNames = async () => {
      client.listCalls++;
      if (toolNames instanceof Error) throw toolNames;
      return toolNames;
    };
  }
  return client;
}

/** A tool refusal as the MCP proxy delivers it: { error, status, details: <route body> }. */
function refusal(status, body) {
  const err = new Error(`Tool failed (${status}): ${body.error}`);
  err.payload = { error: body.error, status, details: body, attempts: 1 };
  return err;
}

const NEW_TOOLS = ['project_vcs_commit', 'project_vcs_status', 'project_vcs_rollback', 'project_vcs_history'];
const CAPS_ON = { status: true, rollback: true };
const CAPS_OFF = { status: false, rollback: false };

await check('vcsCommit: an empty commit on main is refused client-side unless the caller allows a promote', async () => {
  const client = fakeClient({ project_vcs_commit: { data: { id: 'v1', promoted: true } } });
  await assert.rejects(() => api.vcsCommit(client, 'p1', 'Updated the Home page', [], []), /Nothing to commit on main/);
  assert.equal(client.seen.length, 0, 'nothing was sent');
  const commit = await api.vcsCommit(client, 'p1', 'Updated the Home page', [], [], 'main', { source: 'vscode', allowEmptyMain: true });
  assert.equal(commit.promoted, true);
  assert.deepEqual(client.seen[0].args, {
    project_id: 'p1', message: 'Updated the Home page', files: [], deletedFiles: [], source: 'vscode',
  });
});

await check('vcsCommit: without options the wire bytes are unchanged (no source key)', async () => {
  const client = fakeClient({ project_vcs_commit: { data: { id: 'v2' } } });
  await api.vcsCommit(client, 'p1', 'x', [{ path: 'a.txt', content: 'a', encoding: 'utf-8' }], [], 'feat/x');
  assert.ok(!('source' in client.seen[0].args));
  assert.equal(client.seen[0].args.branch, 'feat/x');
});

await check('saveVersion: main without server versions sends nothing; with them it promotes as vscode', async () => {
  const off = fakeClient({});
  assert.deepEqual(await versions.saveVersion(off, 'p1', 'Updated the Home page', 'main', CAPS_OFF), { outcome: 'unsupported' });
  assert.equal(off.seen.length, 0);
  const on = fakeClient({ project_vcs_commit: { data: { id: 'v3', promoted: true } } });
  const r = await versions.saveVersion(on, 'p1', '  Updated the Home page ', undefined, CAPS_ON);
  assert.equal(r.outcome, 'saved');
  assert.equal(on.seen[0].args.message, 'Updated the Home page');
  assert.equal(on.seen[0].args.source, 'vscode');
  assert.deepEqual(on.seen[0].args.files, []);
  assert.ok(!('branch' in on.seen[0].args), 'main is never sent explicitly');
});

await check('saveVersion: 409 nothing_to_commit is a result, not an error; other refusals still throw', async () => {
  const latest = { id: 'v0', message: 'Earlier', source: 'vscode', created_at: '2026-09-25T00:00:00Z' };
  const nothing = fakeClient({
    project_vcs_commit: refusal(409, { error: 'nothing to commit on main', code: 'nothing_to_commit', latest_version: latest }),
  });
  assert.deepEqual(await versions.saveVersion(nothing, 'p1', 'Updated the Home page', 'main', CAPS_ON), {
    outcome: 'nothing',
    latestVersion: latest,
  });
  const busy = fakeClient({ project_vcs_commit: refusal(409, { error: 'busy', code: 'branch_busy' }) });
  await assert.rejects(() => versions.saveVersion(busy, 'p1', 'Updated the Home page', 'main', CAPS_ON), /busy/);
});

await check('saveVersion: a name that is not plain is refused before anything is sent', async () => {
  const client = fakeClient({ project_vcs_commit: { data: { id: 'x' } } });
  for (const bad of ['fix: header', 'Edited page.tsx', 'AI: Updated the header', 'src/app/page.tsx', '']) {
    await assert.rejects(() => versions.saveVersion(client, 'p1', bad, 'feat/x', CAPS_ON));
  }
  assert.equal(client.seen.length, 0);
});

await check('serverCaps: exact tool names, asked once per client, a failed list is not remembered', async () => {
  const both = fakeClient({}, NEW_TOOLS);
  assert.deepEqual(await versions.serverCaps(both), CAPS_ON);
  assert.deepEqual(await versions.serverCaps(both), CAPS_ON);
  assert.equal(both.listCalls, 1);
  assert.deepEqual(await versions.serverCaps(fakeClient({}, ['project_vcs_commit', 'project_vcs_status_x', 'x_project_vcs_rollback'])), CAPS_OFF);
  assert.deepEqual(await versions.serverCaps(fakeClient({}, ['project_vcs_status'])), { status: true, rollback: false });
  assert.deepEqual(await versions.serverCaps(fakeClient({})), CAPS_OFF, 'a client that cannot list tools has no new features');
  const flaky = fakeClient({}, new Error('offline'));
  assert.deepEqual(await versions.serverCaps(flaky), CAPS_OFF);
  assert.deepEqual(await versions.serverCaps(flaky), CAPS_OFF);
  assert.equal(flaky.listCalls, 2, 'the failure was not cached');
});

await check('vcsRollback: dry_run is always sent; applying on main needs the dry run head and sends it', async () => {
  const dryAnswer = { data: { dry_run: true, head_commit_id: 'h1', live_fingerprint: 'f'.repeat(64), noop: false } };
  const applied = { data: { dry_run: false, version: { id: 'v9', name: 'Rolled back' }, noop: false } };
  const client = fakeClient({ project_vcs_rollback: (args) => (args.dry_run === false ? applied : dryAnswer) });
  const dry = await versions.vcsRollback(client, 'p1', { commitId: 'c1', dryRun: true });
  assert.equal(dry.head_commit_id, 'h1');
  assert.deepEqual(client.seen[0].args, { project_id: 'p1', commit_id: 'c1', dry_run: true });
  await assert.rejects(() => versions.vcsRollback(client, 'p1', { commitId: 'c1', dryRun: false }), /preview/);
  await assert.rejects(() => versions.vcsRollback(client, 'p1', { commitId: 'c1', branch: 'main', dryRun: false, expectedHeadCommitId: '' }), /preview/);
  assert.equal(client.seen.length, 1, 'an apply without the head was never sent');
  await versions.vcsRollback(client, 'p1', {
    commitId: 'c1', dryRun: false, expectedHeadCommitId: 'h1', expectedLiveFingerprint: dry.live_fingerprint,
  });
  assert.deepEqual(client.seen[1].args, {
    project_id: 'p1', commit_id: 'c1', dry_run: false, expected_head_commit_id: 'h1', expected_live_fingerprint: 'f'.repeat(64),
  });
  await versions.vcsRollback(client, 'p1', { commitId: 'c2', branch: 'feat/x', dryRun: false, expectedHeadCommitId: 'h2', expectedLiveFingerprint: 'zz' });
  assert.deepEqual(client.seen[2].args, { project_id: 'p1', commit_id: 'c2', dry_run: false, branch: 'feat/x', expected_head_commit_id: 'h2' });
});

const file = (p, c = p) => ({ path: p, content: c, encoding: 'utf-8' });

await check('checkoutTree: pages with limit + cursor until next_cursor is null, and returns every file', async () => {
  const pages = {
    '': { data: { branch_name: 'main', files: [file('a'), file('b')], head_commit_id: 'h', working_tree_etag: null, uncommitted: false, next_cursor: 'b', total_files: 5 } },
    b: { data: { branch_name: 'main', files: [file('c'), file('d')], head_commit_id: 'h', working_tree_etag: null, uncommitted: false, next_cursor: 'd', total_files: 5 } },
    d: { data: { branch_name: 'main', files: [file('e')], head_commit_id: 'h', working_tree_etag: null, uncommitted: false, next_cursor: null, total_files: 5 } },
  };
  const client = fakeClient({ project_vcs_checkout: (args) => pages[args.cursor ?? ''] });
  const tree = await versions.checkoutTree(client, 'p1', 'main', { pageFiles: 2 });
  assert.deepEqual(tree.files.map((f) => f.path), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(client.seen.map((s) => s.args), [
    { project_id: 'p1', branch: 'main', limit: 2 },
    { project_id: 'p1', branch: 'main', limit: 2, cursor: 'b' },
    { project_id: 'p1', branch: 'main', limit: 2, cursor: 'd' },
  ]);
});

await check('checkoutTree: a server that does not page answers once with the whole tree', async () => {
  const client = fakeClient({ project_vcs_checkout: { data: { branch_name: 'main', files: [file('a'), file('b')], head_commit_id: 'h' } } });
  const tree = await versions.checkoutTree(client, 'p1', 'main');
  assert.equal(tree.files.length, 2);
  assert.equal(client.seen.length, 1);
});

await check('checkoutTree: a branch saved to mid-read (etag moved) is read again from the start', async () => {
  let round = 0;
  const client = fakeClient({
    project_vcs_checkout: (args) => {
      if (!args.cursor) round++;
      const etag = round === 1 && args.cursor ? 'e2' : `e${round}`;
      return args.cursor
        ? { data: { branch_name: 'x', files: [file('z')], working_tree_etag: etag, next_cursor: null, total_files: 2 } }
        : { data: { branch_name: 'x', files: [file('a')], working_tree_etag: `e${round}`, next_cursor: 'a', total_files: 2 } };
    },
  });
  const tree = await versions.checkoutTree(client, 'p1', 'x');
  assert.equal(round, 2, 'restarted once');
  assert.deepEqual(tree.files.map((f) => f.path), ['a', 'z']);
  assert.equal(tree.working_tree_etag, 'e2');
});

await check('checkoutTree: a cursor that never moves is refused instead of looping forever', async () => {
  const client = fakeClient({ project_vcs_checkout: { data: { branch_name: 'main', files: [file('a')], next_cursor: 'a', total_files: 9 } } });
  await assert.rejects(() => versions.checkoutTree(client, 'p1', 'main'), /same part/);
  assert.ok(client.seen.length <= 3);
});

await check('checkoutTree: the 150 MB answer becomes a plain SiteTooLargeError', async () => {
  const client = fakeClient({
    project_vcs_checkout: refusal(413, { error: 'Your site has too many files', code: 'content_too_large', branch: 'main', total_files: 1687, total_bytes: 745 * 1024 * 1024 }),
  });
  await assert.rejects(
    () => versions.checkoutTree(client, 'p1', 'main'),
    (err) => err instanceof versions.SiteTooLargeError && /about 745 MB/.test(err.message) && /Nothing was changed/.test(err.message),
  );
});

await check('checkoutTree: Your site changing mid-read (count off) is read again, then returned as read', async () => {
  let calls = 0;
  const notes = [];
  const client = fakeClient({
    project_vcs_checkout: () => {
      calls++;
      return { data: { branch_name: 'main', files: [file('a')], next_cursor: null, total_files: 2 } };
    },
  });
  const tree = await versions.checkoutTree(client, 'p1', 'main', { onNote: (n) => notes.push(n) });
  assert.equal(calls, 3, 'three attempts');
  assert.equal(tree.files.length, 1);
  assert.equal(notes.length, 3);
});

await check('routeErrorOf reads the proxy envelope and a direct body alike', () => {
  const e = refusal(409, { error: 'moved', code: 'branch_changed', head_commit_id: 'h2' });
  assert.deepEqual(
    { status: versions.routeErrorOf(e).status, code: versions.routeErrorOf(e).code, head: versions.routeErrorOf(e).body.head_commit_id },
    { status: 409, code: 'branch_changed', head: 'h2' },
  );
  const direct = Object.assign(new Error('x'), { payload: { error: 'nope', code: 'not_in_history', status: 400 } });
  assert.equal(versions.routeErrorOf(direct).code, 'not_in_history');
  assert.equal(versions.routeErrorOf(new Error('plain')), undefined);
});

await check('rollback words: counts and pages in plain language, never a path; each refusal says nothing changed', () => {
  const dry = {
    dry_run: true, branch: 'main', head_commit_id: 'h', live_fingerprint: null, target: { id: 't', name: 'Before the sale' }, noop: false,
    changes: {
      files: { changed: 3, removed: 1, added_back: 2 },
      entries: [{ path: 'src/app/page.tsx', status: 'changed' }, { path: 'app/globals.css', status: 'changed' }],
      pages: [{ label: 'Home', route: '/', status: 'changed', paths: ['src/app/page.tsx'] }],
      hidden: 0,
    },
    auto_version: { will_create: true, name: 'Saved before rollback' },
    versions_undone: { count: 4, newest: [{ id: 'a', name: 'Sale banner' }, { id: 'b', name: 'New prices' }] },
    assets_affected: true, live_includes_undone_work: true, ai_turn_running: false,
  };
  const lines = versions.rollbackPlanLines(dry).join('\n');
  assert.match(lines, /3 files go back to how they were; 1 file added since then is removed; 2 files removed since then come back\./);
  assert.match(lines, /Pages: Home\./);
  assert.match(lines, /4 newer versions are undone \("Sale banner", "New prices", …\)\. They stay in History/);
  assert.match(lines, /saved first as "Saved before rollback"/);
  assert.match(lines, /shared image library are not changed/);
  assert.match(lines, /live site still shows the newer work/);
  assert.ok(!/src\/|\.tsx|\.css/.test(lines), 'no path or file type reaches the modal');
  for (const code of ['branch_changed', 'ai_turn_running', 'not_in_history', 'content_unavailable', 'branch_tree_unavailable', 'branch_busy']) {
    assert.match(versions.rollbackErrorMessage(refusal(409, { error: 'x', code })), /Nothing was changed/, code);
  }
  assert.match(versions.rollbackErrorMessage(refusal(409, { error: 'x', code: 'rollback_incomplete' })), /again/);
});

await check('status bar: Your site (main) by name, a dot and hiveku.commit only when something is not a version', () => {
  const clean = versions.branchBarState('main', 0, { uncommitted: false });
  assert.equal(clean.text, '$(git-branch) Your site (main)');
  assert.equal(clean.command, 'hiveku.switchBranch');
  const remote = versions.branchBarState('main', 0, { uncommitted: true, files: 2 });
  assert.equal(remote.text, '$(git-branch) Your site (main) $(circle-filled)');
  assert.equal(remote.command, 'hiveku.commit');
  assert.match(remote.tooltip, /changes on Hiveku not yet a version/);
  const local = versions.branchBarState('feat/x', 3, undefined);
  assert.equal(local.text, '$(git-branch) feat/x $(circle-filled)');
  assert.match(local.tooltip, /^3 local changes\./);
  assert.equal(versions.branchBarState('main', 0, undefined).command, 'hiveku.switchBranch', 'unknown is not dirty');
});

await check('deploy gate: the tree a tier ships comes from the bindings, unknown stays unknown', () => {
  assert.equal(versions.treeThatShips('production', undefined), 'main');
  assert.equal(versions.treeThatShips('development', bindings), 'feat/x');
  assert.equal(versions.treeThatShips('staging', bindings), 'main');
  assert.equal(versions.treeThatShips('development', undefined), null);
});

await check('push naming: a plain typed name wins, anything else falls back to a name from what changed', () => {
  const changes = { modified: ['src/app/pricing/page.tsx'] };
  assert.deepEqual(versions.pushVersionName(changes, ' Spring prices '), { name: 'Spring prices', typed: 'Spring prices' });
  assert.deepEqual(versions.pushVersionName(changes, 'fix: prices'), { name: 'Edited the Pricing page', typed: 'fix: prices' });
  assert.deepEqual(versions.pushVersionName(changes, ''), { name: 'Edited the Pricing page', typed: '' });
  assert.equal(versions.readPushVersionMode('auto'), 'auto');
  assert.equal(versions.readPushVersionMode('never'), 'never');
  assert.equal(versions.readPushVersionMode('sometimes'), 'ask');
});

await check('version picker rows read name · who · when, never a checkpoint hash', () => {
  const row = versions.versionPickItem({ id: 'v', message: 'New prices', source: 'ai_turn', created_at: '2026-09-25T10:00:00Z', checkpoint_hash: 'abc123', branch_name: 'main', files_committed: 0, files_deleted: 0 });
  assert.equal(row.label, 'New prices');
  assert.match(row.description, /^AI request · /);
  assert.ok(!JSON.stringify(row).includes('abc123'));
});

await check('commitVersion: 409 nothing_to_commit on a commit WITH files is "already a version", not an error', async () => {
  const client = fakeClient({ project_vcs_commit: refusal(409, { error: 'the files sent are already the current version', code: 'nothing_to_commit', latest_version: null }) });
  const r = await versions.commitVersion(client, 'p1', 'Updated the header', [{ path: 'a.txt', content: 'a', encoding: 'utf-8' }], [], undefined, CAPS_ON);
  assert.deepEqual(r, { outcome: 'nothing', latestVersion: null });
  assert.equal(client.seen[0].args.files.length, 1);
  assert.equal(client.seen[0].args.source, 'vscode');
});

await check('rollback apply: only a clear refusal means nothing changed; a timeout, a 5xx, rollback_incomplete may have landed', () => {
  for (const code of ['branch_changed', 'ai_turn_running', 'not_in_history', 'content_unavailable', 'branch_busy', 'expected_head_required', 'commit_not_found']) {
    assert.equal(versions.rollbackMayHaveLanded(refusal(409, { error: 'x', code })), false, code);
  }
  assert.equal(versions.rollbackMayHaveLanded(refusal(409, { error: 'x', code: 'rollback_incomplete', applied: ['a'], failed: [] })), true);
  assert.equal(versions.rollbackMayHaveLanded(refusal(409, { error: 'x', code: 'idempotency_pending' })), true);
  assert.equal(versions.rollbackMayHaveLanded(new Error('MCP request timed out after 135s (tools/call)')), true);
  assert.equal(versions.rollbackMayHaveLanded(refusal(502, { error: 'Bad gateway' })), true);
  assert.equal(versions.rollbackMayHaveLanded(refusal(404, { error: 'Project not found' })), false);
});

await check('the client-side "preview first" refusal reads as a person would, never an API field name', async () => {
  const client = fakeClient({});
  let err;
  try {
    await versions.vcsRollback(client, 'p1', { commitId: 'c1', dryRun: false });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'refused');
  const said = versions.rollbackErrorMessage(err);
  assert.equal(said, 'Going back needs the preview step first. Nothing was changed. Try again.');
  assert.ok(!/expected_head|commit_id/.test(said));
  assert.equal(versions.rollbackMayHaveLanded(err), false, 'nothing was sent');
});

await check('plainErrorMessage drops the tool wrapper and JSON tail; a timeout reads as a sentence', () => {
  const wrapped = Object.assign(new Error('Tool deploy_site failed (409): Deploy already running — {"error":"Deploy already running","code":"deploy_busy"}'), {
    payload: { error: 'Tool error', status: 409, details: { error: 'Deploy already running', code: 'deploy_busy' } },
  });
  assert.equal(versions.plainErrorMessage(wrapped), 'Deploy already running');
  assert.equal(versions.plainErrorMessage(new Error('MCP request timed out after 135s (tools/call)')), 'Hiveku did not answer in time.');
  assert.equal(versions.plainErrorMessage(new Error('Tool x failed (500): boom — {"a":1}')), 'boom');
});

await check('after "update live site": "updating" only when the deploy ships the version the rollback made', () => {
  assert.equal(versions.liveUpdateSentence({ vcs_commit_id: 'v2' }, 'v2'), 'The live site is updating.');
  assert.equal(versions.liveUpdateSentence({ vcs_commit_id: 'v3', note: 'The version "X" is being put on your live site.' }, 'v2'), 'The version "X" is being put on your live site.');
  assert.match(versions.liveUpdateSentence({}, 'v2'), /did not confirm it ships the version you went back to/);
});

await check('what is promised when a push is not a version: nothing that is not scheduled today', () => {
  for (const b of ['main', undefined, 'feat/x']) {
    const line = versions.notVersionedYetSentence(b);
    assert.match(line, /Hiveku: Save a Version/);
    assert.doesNotMatch(line, /automatically|quiet minutes/);
  }
  assert.match(versions.notVersionedYetSentence('main'), /publishing Your site to production also saves it first/);
  assert.doesNotMatch(versions.notVersionedYetSentence('feat/x'), /publishing/);
  assert.match(versions.nothingToSaveMessage('clean'), /everything is already a version/);
  for (const why of ['notes', 'unknown', 'unsupported']) assert.doesNotMatch(versions.nothingToSaveMessage(why), /everything is already a version/);
});

await check('notes-only changes are not "needs a version"; a legacy head and no version yet are', () => {
  const s = (uncommitted, reason, files) => ({ uncommitted, uncommitted_reason: reason, latest_changes: files === undefined ? null : { state: 'pending', since: null, summary: null, files } });
  assert.equal(versions.onlyNotesChanged(s(true, 'changed', 0)), true);
  assert.equal(versions.needsVersion(s(true, 'changed', 0)), false);
  assert.equal(versions.needsVersion(s(true, 'changed', 2)), true);
  assert.equal(versions.needsVersion(s(true, 'legacy_head', 0)), true);
  assert.equal(versions.needsVersion(s(true, 'no_version_yet', 0)), true);
  assert.equal(versions.needsVersion(s(false, 'unknown')), false);
});

await check('history pages: before=nextBefore, stop on an empty or short page whatever meta.truncated says', async () => {
  const full = Array.from({ length: 3 }, (_, i) => ({ id: `v${i}`, branch_name: 'main', message: `V${i}`, created_at: '2026-09-20T00:00:00Z' }));
  const client = fakeClient({ project_vcs_history: (args) => (args.before ? { data: full.slice(0, 1), meta: { truncated: true, nextBefore: 'x' } } : { data: full, meta: { truncated: true, nextBefore: 'c1' } }) });
  const p1 = await versions.versionHistoryPage(client, 'p1', 'main', { limit: 3 });
  assert.equal(p1.nextBefore, 'c1');
  assert.deepEqual(client.seen[0].args, { project_id: 'p1', limit: 3, branch: 'main' });
  const p2 = await versions.versionHistoryPage(client, 'p1', 'main', { limit: 3, before: p1.nextBefore });
  assert.equal(client.seen[1].args.before, 'c1');
  assert.equal(p2.nextBefore, null, 'a short page is the last');
  const empty = fakeClient({ project_vcs_history: { data: [], meta: { truncated: true, nextBefore: 'z' } } });
  assert.equal((await versions.versionHistoryPage(empty, 'p1', 'main')).nextBefore, null);
});

await check('the go-back picker never offers a version whose files cannot be read back', () => {
  const entries = [
    { id: 'head', branch_name: 'main' },
    { id: 'a', branch_name: 'main', restorable: true },
    { id: 'b', branch_name: 'main', restorable: false, restore_blocked_reason: 'no saved copy' },
    { id: 'c', branch_name: 'main' },
    { id: 'd', branch_name: 'feat/x', restorable: true },
  ];
  assert.deepEqual(versions.goBackTargets(entries, 'main', 'head').map((e) => e.id), ['a', 'c']);
});

await check('the too-large answer names only things that exist (no "Hiveku: Reconnect" command)', async () => {
  const client = fakeClient({ project_vcs_checkout: refusal(413, { error: 'too big', code: 'content_too_large', total_bytes: 200 * 1024 * 1024 }) });
  await assert.rejects(
    () => versions.checkoutTree(client, 'p1', 'main'),
    (err) => err instanceof versions.SiteTooLargeError && !/Hiveku: Reconnect/.test(err.message) && /Reconnect Hiveku/.test(err.message),
  );
});

console.log(`✓ ${n} vcs helper checks passed`);
