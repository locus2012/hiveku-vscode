/**
 * permissions.ask for the tools that start ad spend (src/knowledge.ts HIVEKU_ASK).
 *
 * Claude Code 2.1.283+ opens VS Code chats in auto mode, whose classifier
 * blocks an "enable the campaign" MCP call with no prompt at all. An explicit
 * ask rule is resolved before the classifier, so writeClaudeSettings writes one
 * per serving-start tool into every scaffolded folder's .claude/settings.json:
 * additive, idempotent, never an allow, and never beside a deny of the same name.
 *
 * "Never beside a deny" means any deny that covers the tool: its exact name,
 * the bare server (`mcp__hiveku`) or a glob (`mcp__hiveku__ppc_*`, `mcp__*`).
 *
 * ensureSpendAskRules adds only these rules to a folder scaffolded before they
 * existed (the extension runs it on activation), and changes nothing else.
 *
 * Also pins the permission gate (scripts/check-permission-rules.mjs) on the
 * ask array: an ask name a deny covers, or a glob, fails it. And the Autonomous
 * copy, which must not promise that nothing asks.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const knowledge = loadOut('knowledge');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const KEY = 'olp_test_key_123';
const BASE = 'https://core.hiveku.com';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The serving-start tools, as the scaffold must write them (the .mcp.json server is "hiveku"). */
const EXPECTED_ASK = [
  'mcp__hiveku__ppc_enable_resource',
  'mcp__hiveku__ppc_platform_enable_resource',
  'mcp__hiveku__ppc_experiment_schedule',
  'mcp__hiveku__ppc_bing_experiment_create',
];

const dirs = [];
after(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

async function tmp(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const scaffoldAccount = (dir) =>
  knowledge.writeScaffold({ baseDir: dir, accountLabel: 'Acme', apiKey: KEY, baseUrl: BASE, accountId: ACCOUNT });

const scaffoldProject = (dir) =>
  knowledge.writeProjectScaffold({
    baseDir: dir, accountLabel: 'Acme', apiKey: KEY, baseUrl: BASE, accountId: ACCOUNT,
    projectId: '11111111-2222-3333-4444-555555555555', projectName: 'Main site',
  });

const settingsPath = (dir) => path.join(dir, '.claude', 'settings.json');

async function readSettings(dir) {
  return JSON.parse(await fs.readFile(settingsPath(dir), 'utf8'));
}

async function seedSettings(dir, settings) {
  await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
  await fs.writeFile(settingsPath(dir), JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/** Claude Code permission globs: '*' is the only wildcard. */
const globMatches = (glob, name) =>
  new RegExp('^' + glob.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(name);

describe('Scaffolded settings: ask rules for the tools that start ad spend', () => {
  test('a fresh account folder asks for every serving-start tool, and allows none of them', async () => {
    const dir = await tmp('hk-ask-fresh-');
    await scaffoldAccount(dir);
    const { permissions } = await readSettings(dir);
    assert.deepEqual(permissions.ask, EXPECTED_ASK);
    for (const name of EXPECTED_ASK) {
      assert.ok(!permissions.allow.includes(name), `${name} was written as an allow`);
      assert.ok(!permissions.deny.includes(name), `${name} was written as a deny`);
      // No allow rule may approve it either: ask beats allow, but an allow here
      // would be a scaffold bug the ask only happens to mask.
      const approving = permissions.allow.filter((rule) => globMatches(rule, name));
      assert.deepEqual(approving, [], `${name} is approved by ${approving.join(', ')}`);
    }
    // The extension's own prefix only: it writes no plugin-prefix rules anywhere.
    assert.ok(permissions.ask.every((rule) => rule.startsWith('mcp__hiveku__')));
  });

  test('a site folder gets the same ask rules', async () => {
    const dir = await tmp('hk-ask-project-');
    await scaffoldProject(dir);
    const { permissions } = await readSettings(dir);
    assert.deepEqual(permissions.ask, EXPECTED_ASK);
  });

  test("the user's ask entries, other rule lists and top-level keys are kept, in order", async () => {
    const dir = await tmp('hk-ask-user-');
    const userAsk = ['Bash(git push:*)', 'mcp__hiveku__deploy_site', 'WebFetch'];
    await seedSettings(dir, {
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] },
      permissions: {
        ask: [...userAsk],
        allow: ['Bash(make:*)'],
        deny: ['Read(./secrets/**)'],
        additionalDirectories: ['../shared'],
      },
    });
    await scaffoldAccount(dir);
    const settings = await readSettings(dir);
    const { permissions } = settings;
    assert.deepEqual(permissions.ask.slice(0, userAsk.length), userAsk, 'user ask entries moved or were dropped');
    assert.deepEqual(permissions.ask.slice(userAsk.length), EXPECTED_ASK);
    assert.equal(permissions.allow[0], 'Bash(make:*)');
    assert.equal(permissions.deny[0], 'Read(./secrets/**)');
    assert.deepEqual(permissions.additionalDirectories, ['../shared']);
    assert.equal(settings.model, 'opus');
    assert.deepEqual(settings.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] });
  });

  test('an entry the user already has keeps its place and is not repeated', async () => {
    const dir = await tmp('hk-ask-have-');
    const userAsk = ['Bash(git push:*)', 'mcp__hiveku__ppc_experiment_schedule', 'WebFetch'];
    await seedSettings(dir, { permissions: { ask: [...userAsk] } });
    await scaffoldAccount(dir);
    const { permissions } = await readSettings(dir);
    assert.deepEqual(permissions.ask.slice(0, userAsk.length), userAsk);
    assert.deepEqual(
      permissions.ask.slice(userAsk.length),
      EXPECTED_ASK.filter((name) => name !== 'mcp__hiveku__ppc_experiment_schedule'),
    );
    assert.equal(permissions.ask.filter((rule) => rule === 'mcp__hiveku__ppc_experiment_schedule').length, 1);
  });

  test('idempotent: re-scaffolding writes the same rules and duplicates nothing', async () => {
    const dir = await tmp('hk-ask-again-');
    await seedSettings(dir, { permissions: { ask: ['Bash(git push:*)'] } });
    await scaffoldAccount(dir);
    const first = (await readSettings(dir)).permissions;
    await scaffoldAccount(dir);
    await scaffoldProject(dir);
    await scaffoldAccount(dir);
    const last = (await readSettings(dir)).permissions;
    assert.deepEqual(last, first);
    assert.equal(new Set(last.ask).size, last.ask.length, 'ask has a duplicate');
    assert.deepEqual(last.ask, ['Bash(git push:*)', ...EXPECTED_ASK]);
  });

  test('a tool the user denied stays denied and is not also asked', async () => {
    const dir = await tmp('hk-ask-denied-');
    await seedSettings(dir, { permissions: { deny: ['mcp__hiveku__ppc_platform_enable_resource'] } });
    await scaffoldAccount(dir);
    const { permissions } = await readSettings(dir);
    assert.ok(permissions.deny.includes('mcp__hiveku__ppc_platform_enable_resource'), 'the user deny was dropped');
    assert.ok(!permissions.ask.includes('mcp__hiveku__ppc_platform_enable_resource'), 'a denied tool was also asked');
    assert.deepEqual(permissions.ask, EXPECTED_ASK.filter((name) => name !== 'mcp__hiveku__ppc_platform_enable_resource'));
    // And nothing the scaffold denies on its own is asked.
    assert.deepEqual(permissions.ask.filter((rule) => permissions.deny.includes(rule)), []);
  });

  test('a server-level or glob deny covers the tools it matches, so they are not asked', async () => {
    const cases = [
      // [deny rules, the ask rules that must still be written]
      [['mcp__hiveku'], []],
      [['mcp__hiveku__*'], []],
      [['mcp__*'], []],
      [['*'], []],
      [['mcp__hiveku__ppc_*'], []],
      [['mcp__hiveku__ppc_*enable_resource'], ['mcp__hiveku__ppc_experiment_schedule', 'mcp__hiveku__ppc_bing_experiment_create']],
      [['mcp__hiveku__*_experiment_*'], ['mcp__hiveku__ppc_enable_resource', 'mcp__hiveku__ppc_platform_enable_resource']],
      // Not a cover: another server, a name prefix with no glob, a Bash rule.
      [['mcp__hiveku_old', 'mcp__hiveku__ppc', 'mcp__other__*', 'Bash(*)'], EXPECTED_ASK],
    ];
    for (const [deny, expected] of cases) {
      const dir = await tmp('hk-ask-cover-');
      await seedSettings(dir, { permissions: { deny: [...deny] } });
      await scaffoldAccount(dir);
      const { permissions } = await readSettings(dir);
      assert.deepEqual(permissions.ask ?? [], expected, `deny ${JSON.stringify(deny)}`);
      for (const rule of deny) assert.ok(permissions.deny.includes(rule), `the user deny ${rule} was dropped`);
    }
  });

  test('with every one denied and no user ask list, no ask key is written', async () => {
    const dir = await tmp('hk-ask-none-');
    await seedSettings(dir, { permissions: { deny: [...EXPECTED_ASK] } });
    await scaffoldAccount(dir);
    const { permissions } = await readSettings(dir);
    assert.equal(permissions.ask, undefined);
    for (const name of EXPECTED_ASK) assert.ok(permissions.deny.includes(name));
  });
});

describe('ensureSpendAskRules: a folder scaffolded before the ask rules', () => {
  /** The settings.json an older scaffold wrote: allow + deny + mode, no ask. */
  const OLD = {
    model: 'opus',
    permissions: {
      defaultMode: 'acceptEdits',
      allow: ['mcp__hiveku__*_get', 'Bash(make:*)'],
      deny: ['Read(**/.env.local)', 'Write(//tmp/**)'],
    },
    sandbox: { enabled: false },
  };

  test('adds exactly the ask rules and changes nothing else', async () => {
    const dir = await tmp('hk-ensure-old-');
    await seedSettings(dir, OLD);
    const added = await knowledge.ensureSpendAskRules(dir);
    assert.deepEqual(added, EXPECTED_ASK);
    const after = await readSettings(dir);
    assert.deepEqual(after, { ...OLD, permissions: { ...OLD.permissions, ask: EXPECTED_ASK } });
  });

  test("keeps the user's ask entries first, and a second run writes nothing", async () => {
    const dir = await tmp('hk-ensure-again-');
    await seedSettings(dir, { ...OLD, permissions: { ...OLD.permissions, ask: ['WebFetch', 'mcp__hiveku__ppc_enable_resource'] } });
    assert.deepEqual(
      await knowledge.ensureSpendAskRules(dir),
      EXPECTED_ASK.filter((name) => name !== 'mcp__hiveku__ppc_enable_resource'),
    );
    const once = await fs.readFile(settingsPath(dir), 'utf8');
    assert.deepEqual(JSON.parse(once).permissions.ask.slice(0, 2), ['WebFetch', 'mcp__hiveku__ppc_enable_resource']);
    const { mtimeMs } = await fs.stat(settingsPath(dir));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), []);
    assert.equal(await fs.readFile(settingsPath(dir), 'utf8'), once);
    assert.equal((await fs.stat(settingsPath(dir))).mtimeMs, mtimeMs, 'a run with nothing to add rewrote the file');
  });

  test('skips what the deny list covers, by name or glob', async () => {
    const dir = await tmp('hk-ensure-deny-');
    await seedSettings(dir, { permissions: { deny: ['mcp__hiveku__ppc_*enable_resource', 'mcp__hiveku__ppc_experiment_schedule'] } });
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), ['mcp__hiveku__ppc_bing_experiment_create']);
    const { permissions } = await readSettings(dir);
    assert.deepEqual(permissions.ask, ['mcp__hiveku__ppc_bing_experiment_create']);
    assert.deepEqual(permissions.deny, ['mcp__hiveku__ppc_*enable_resource', 'mcp__hiveku__ppc_experiment_schedule']);
  });

  test('leaves a missing, unparseable or oddly shaped file alone', async () => {
    const missing = await tmp('hk-ensure-missing-');
    assert.deepEqual(await knowledge.ensureSpendAskRules(missing), []);
    await assert.rejects(fs.access(settingsPath(missing)), 'a folder with no settings got one');

    const shapes = ['{ "permissions": { "allow": [ ', '[]', '{"permissions": "x"}', '{"permissions": {"ask": "WebFetch"}}'];
    for (const text of shapes) {
      const dir = await tmp('hk-ensure-odd-');
      await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
      await fs.writeFile(settingsPath(dir), text, 'utf8');
      assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], text);
      assert.equal(await fs.readFile(settingsPath(dir), 'utf8'), text, `rewrote ${text}`);
    }
  });

  test('a settings.json with no permissions block gets one holding only the ask rules', async () => {
    const dir = await tmp('hk-ensure-noperms-');
    await seedSettings(dir, { model: 'opus' });
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), EXPECTED_ASK);
    assert.deepEqual(await readSettings(dir), { model: 'opus', permissions: { ask: EXPECTED_ASK } });
  });
});

describe('Permission gate: the ask array', () => {
  const gate = path.join(ROOT, 'scripts', 'check-permission-rules.mjs');

  /** Run the gate against a copy of knowledge.ts with `mutate` applied, from a scratch tree. */
  async function runGateOn(mutate) {
    const dir = await tmp('hk-ask-gate-');
    await fs.mkdir(path.join(dir, 'scripts'));
    await fs.mkdir(path.join(dir, 'src'));
    await fs.copyFile(gate, path.join(dir, 'scripts', 'check-permission-rules.mjs'));
    const src = await fs.readFile(path.join(ROOT, 'src', 'knowledge.ts'), 'utf8');
    const changed = mutate(src);
    assert.notEqual(changed, src, 'the mutation did not apply: the negative control would pass for the wrong reason');
    await fs.writeFile(path.join(dir, 'src', 'knowledge.ts'), changed, 'utf8');
    return spawnSync(process.execPath, [path.join(dir, 'scripts', 'check-permission-rules.mjs')], { encoding: 'utf8' });
  }

  test('the real source passes and counts the ask rules apart from the denies', () => {
    const run = spawnSync(process.execPath, [gate], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    // With no registry build the gate stops after the syntax pass, so the count
    // line is only asserted when it printed.
    if (/allow rules/.test(run.stdout)) assert.match(run.stdout, /\b3 denied, 4 ask\b/);
  });

  test('an ask name that is also denied fails the gate', async () => {
    const run = await runGateOn((src) =>
      src.replace("    'Read(**/.env.local)',\n", "    'mcp__hiveku__ppc_enable_resource',\n    'Read(**/.env.local)',\n"),
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ppc_enable_resource is in HIVEKU_ASK and covered by the deny list/);
  });

  test('an ask name a deny glob covers fails the gate', async () => {
    const run = await runGateOn((src) =>
      src.replace("    'Read(**/.env.local)',\n", "    'mcp__hiveku__ppc_*_resource',\n    'Read(**/.env.local)',\n"),
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ppc_enable_resource is in HIVEKU_ASK and covered by the deny list \(mcp__hiveku__ppc_\*_resource\)/);
    assert.match(run.stderr, /ppc_platform_enable_resource is in HIVEKU_ASK and covered/);
    assert.doesNotMatch(run.stderr, /ppc_experiment_schedule is in HIVEKU_ASK/);
  });

  test('a glob in the ask array fails the gate', async () => {
    const run = await runGateOn((src) =>
      src.replace('const HIVEKU_ASK: string[] = [\n', "const HIVEKU_ASK: string[] = [\n  'mcp__hiveku__ppc_*_enable',\n"),
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ppc_\*_enable — an ask rule names one tool exactly/);
  });
});

describe('Autonomous mode copy', () => {
  // Ask rules prompt in every mode, bypassPermissions included, so the copy for
  // it must not promise that nothing asks.
  test('the setting and the mode picker say turning ads on still asks', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const setting = pkg.contributes.configuration.properties['hiveku.claudeCodePermissionMode'];
    const bypass = setting.enumDescriptions[setting.enum.indexOf('bypassPermissions')];
    assert.match(bypass, /turn ads on, which always ask/);
    assert.doesNotMatch(bypass, /entirely/);
    assert.match(setting.markdownDescription, /tools that turn ads on \(and start spend\) always ask first/);
    const extensionSrc = await fs.readFile(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
    assert.doesNotMatch(extensionSrc, /Skip ALL prompts/);
    assert.match(extensionSrc, /Turning ads on still asks/);
  });
});
