/**
 * Claude Code's connection in a folder declares this release
 * (X-Hiveku-Client: vscode-extension/<version>) only while the folder's
 * .claude/settings.json holds every HIVEKU_ASK rule. The builder reads the
 * declaration as "Claude Code here asks a person before these tools": a
 * secret reveal skips the dashboard approval on it, and each read of the
 * person's own direct messages is refused without it.
 *
 *   - Activation (updateFolderAsks): a folder an older release made keeps
 *     declaring that release. Once its rules are all there, the hiveku
 *     server's X-Hiveku-Client in its .mcp.json changes to this release, and
 *     nothing else does; never before, never another client's value.
 *   - The scaffold writes the ask rules before .mcp.json and declares only
 *     when they landed: a failed settings write leaves the undeclared name.
 *   - The account command (pointClaudeCodeAt) writes the ask rules into the
 *     folder first, one the extension never scaffolded included, and declares
 *     only when they landed.
 *
 * The undeclared name is `claude-code`, what this .mcp.json sent before it
 * declared: it names no release, so nothing reaches the builder as a
 * declaration and the builder refuses the gated tools, while the MCP
 * server's label, rate limit and feedback surface read it as they read the
 * declaration.
 *
 * Runs against the compiled extension (npm test compiles first). HOME is a
 * scratch folder, so the ~/.claude.json the account command writes is too.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOut } from './helpers/load.mjs';

// First: the account command writes ~/.claude.json.
const REAL_HOME = os.homedir();
const HOME = mkdtempSync(path.join(os.tmpdir(), 'hk-declare-home-'));
process.env.HOME = HOME;
assert.equal(os.homedir(), HOME, 'HOME did not move: the account command would write the real ~/.claude.json');
assert.notEqual(HOME, REAL_HOME);

const knowledge = loadOut('knowledge');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
const KNOWLEDGE_SRC = readFileSync(path.join(ROOT, 'src', 'knowledge.ts'), 'utf8');
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const DECLARED = `vscode-extension/${VERSION}`;
const UNDECLARED = 'claude-code';
const OLD = 'vscode-extension/0.91.75';
const KEY = 'olp_test_key_123';
const BASE = 'https://core.hiveku.com';
const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
// The builder's DECLARED_RE: only a value of this form is read as a declaration.
const BUILDER_DECLARED_RE = /^([a-z][a-z0-9-]{0,39})\/(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,5})$/;
/** The reads of a person's own messages, whose ask rules arrived in 0.91.76. */
const PRIVATE_READS = [
  'mcp__hiveku__discussion_private_list',
  'mcp__hiveku__discussion_private_messages',
  'mcp__hiveku__discussion_private_search',
];

const dirs = [HOME];
after(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

async function tmp(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const settingsPath = (dir) => path.join(dir, '.claude', 'settings.json');
const mcpPath = (dir) => path.join(dir, '.mcp.json');
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

async function seedSettings(dir, settings) {
  await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
  const text = typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2) + '\n';
  await fs.writeFile(settingsPath(dir), text, 'utf8');
}

async function seedMcp(dir, text) {
  await fs.writeFile(mcpPath(dir), text, { encoding: 'utf8', mode: 0o600 });
}

/** The .mcp.json an earlier release wrote, its hiveku server sending `client`. */
const oldMcpJson = (client) =>
  JSON.stringify(
    {
      mcpServers: {
        hiveku: { type: 'http', url: `${BASE}/mcp`, headers: { Authorization: `Bearer ${KEY}`, 'X-Hiveku-Client': client } },
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
      },
    },
    null,
    2,
  ) + '\n';

const clientIn = async (dir) => (await readJson(mcpPath(dir))).mcpServers.hiveku.headers['X-Hiveku-Client'];

/** Every HIVEKU_ASK rule, in order: what ensureSpendAskRules adds to a settings file with none. */
let ALL;
/** What a folder made by 0.91.75 asks: every rule but the private reads. */
let OLD_RULES;
before(async () => {
  const dir = await tmp('hk-declare-all-');
  await seedSettings(dir, {});
  ALL = await knowledge.ensureSpendAskRules(dir);
  for (const name of PRIVATE_READS) assert.ok(ALL.includes(name), `${name} is not an ask rule`);
  OLD_RULES = ALL.filter((name) => !PRIVATE_READS.includes(name));
});

/** A folder an earlier release made: its settings ask `ask`, its .mcp.json sends `client`. */
async function oldFolder(ask, client = OLD) {
  const dir = await tmp('hk-declare-old-');
  await seedSettings(dir, {
    permissions: { defaultMode: 'acceptEdits', allow: ['mcp__hiveku__*_get'], deny: ['Read(**/.env.local)'], ask },
  });
  await seedMcp(dir, oldMcpJson(client));
  return dir;
}

/** The body of a top-level function in extension.ts, up to the next top-level declaration. */
function body(name) {
  const start = SRC.search(new RegExp(`^(export )?(async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} not found`);
  const rest = SRC.slice(start + 1);
  const end = rest.search(/^(export |async |function |const |let |\/\*\*|\/\/ ──)/m);
  return SRC.slice(start, end < 0 ? undefined : start + 1 + end);
}

describe('askRulesInPlace: when a folder may declare', () => {
  test('every rule asked: yes; any one of them missing: no', async () => {
    assert.equal(await knowledge.askRulesInPlace(await oldFolder(ALL)), true);
    assert.equal(await knowledge.askRulesInPlace(await oldFolder(['WebFetch', ...ALL])), true);
    for (const missing of [ALL[0], ALL.at(-1), 'mcp__hiveku__project_secrets_reveal', ...PRIVATE_READS]) {
      assert.equal(await knowledge.askRulesInPlace(await oldFolder(ALL.filter((name) => name !== missing))), false, missing);
    }
  });

  test('a deny that covers a tool stands in for its ask, since that tool never runs; a deny of another tool does not', async () => {
    const dir = await tmp('hk-declare-deny-');
    await seedSettings(dir, { permissions: { ask: OLD_RULES, deny: ['mcp__hiveku__discussion_private_*'] } });
    assert.equal(await knowledge.askRulesInPlace(dir), true);
    await seedSettings(dir, { permissions: { ask: OLD_RULES, deny: ['mcp__hiveku__discussion_list'] } });
    assert.equal(await knowledge.askRulesInPlace(dir), false);
  });

  test('no settings file, one that does not parse, or permissions of the wrong shape: no', async () => {
    assert.equal(await knowledge.askRulesInPlace(await tmp('hk-declare-none-')), false);
    const shapes = ['{ "permissions": { "ask": [ ', '[]', '{"permissions": []}', '{"permissions": "x"}', JSON.stringify({ permissions: { ask: ALL.join(',') } })];
    for (const text of shapes) {
      const dir = await tmp('hk-declare-shape-');
      await seedSettings(dir, text);
      assert.equal(await knowledge.askRulesInPlace(dir), false, text.slice(0, 60));
    }
  });
});

describe('Activation: an older folder\'s declaration comes up to this release', () => {
  test('once its rules are complete, and not before', async () => {
    const dir = await oldFolder(OLD_RULES);
    const original = await fs.readFile(mcpPath(dir), 'utf8');
    // Not before: the private reads do not ask there yet.
    assert.equal(await knowledge.refreshDeclaration(dir), false);
    assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), original);
    // The start adds the three rules, then declares this release.
    assert.deepEqual(await knowledge.updateFolderAsks(dir), { added: PRIVATE_READS, declared: true });
    assert.equal(await clientIn(dir), DECLARED);
    assert.match(DECLARED, BUILDER_DECLARED_RE);
    assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), original.replace(OLD, DECLARED));
    assert.equal((await fs.stat(mcpPath(dir))).mode & 0o777, 0o600, 'the key file stays owner-only');
    // The next start has nothing to change and writes nothing.
    const { mtimeMs } = await fs.stat(mcpPath(dir));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(await knowledge.updateFolderAsks(dir), { added: [], declared: false });
    assert.equal((await fs.stat(mcpPath(dir))).mtimeMs, mtimeMs, 'a start with nothing to change rewrote .mcp.json');
  });

  test('a partial rules set never upgrades', async () => {
    const partials = [
      [],
      ALL.slice(0, Math.floor(ALL.length / 2)),
      ALL.slice(0, -1),
      OLD_RULES,
      ALL.filter((name) => name !== 'mcp__hiveku__discussion_private_messages'),
      ALL.filter((name) => name !== 'mcp__hiveku__project_secrets_reveal'),
    ];
    for (const ask of partials) {
      const dir = await oldFolder(ask);
      const original = await fs.readFile(mcpPath(dir), 'utf8');
      assert.equal(await knowledge.refreshDeclaration(dir), false, `${ask.length} of ${ALL.length} rules`);
      assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), original, `${ask.length} of ${ALL.length} rules`);
    }
  });

  test('a folder whose rules the start cannot complete keeps its .mcp.json as it was', async () => {
    // No settings file (a start never makes one), one that does not parse, and an ask that is not a list.
    for (const settings of [null, '{ "permissions": { "ask": [ ', JSON.stringify({ permissions: { ask: 'WebFetch' } })]) {
      const dir = await tmp('hk-declare-stuck-');
      if (settings !== null) await seedSettings(dir, settings);
      await seedMcp(dir, oldMcpJson(OLD));
      assert.deepEqual(await knowledge.updateFolderAsks(dir), { added: [], declared: false }, String(settings));
      assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), oldMcpJson(OLD), String(settings));
      if (settings === null) await assert.rejects(fs.access(settingsPath(dir)), 'the start made a settings file');
    }
  });

  test('only the hiveku server\'s X-Hiveku-Client changes: every other byte of .mcp.json stays', async () => {
    // Written by hand: a four-space indent and CRLF, the person's own server first (sending the same old release in its
    // own headers), the header before the key, numbers and an escape JSON.stringify would rewrite, no final newline.
    const template = [
      '{',
      '    "mcpServers": {',
      `        "mine": { "type": "http", "url": "https://example.test/mcp", "headers": { "X-Hiveku-Client": "${OLD}" } },`,
      '        "hiveku": {',
      '            "type": "http",',
      `            "url": "${BASE}/mcp",`,
      '            "headers": {',
      '                "X-Hiveku-Client": "@CLIENT@",',
      `                "Authorization": "Bearer ${KEY}"`,
      '            }',
      '        },',
      '        "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest", "--headed"] }',
      '    },',
      '    "timeout": 1.0, "retries": 3e0, "label": "caf\\u00e9"',
      '}',
    ].join('\r\n');
    const dir = await tmp('hk-declare-bytes-');
    await seedSettings(dir, { permissions: { ask: ALL } });
    await seedMcp(dir, template.replace('@CLIENT@', OLD));
    assert.equal(await knowledge.refreshDeclaration(dir), true);
    assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), template.replace('@CLIENT@', DECLARED));
  });

  test('only a value this extension wrote changes; another client\'s, or none, stays', async () => {
    // Its own: the name before it declared, an older declaration, and the name without a release.
    for (const own of ['claude-code', 'vscode-extension/0.91.8', OLD, 'vscode-extension']) {
      const dir = await oldFolder(ALL, own);
      assert.equal(await knowledge.refreshDeclaration(dir), true, own);
      assert.equal(await clientIn(dir), DECLARED, own);
    }
    // Not its own: other clients' names.
    for (const other of ['hiveku-sync/0.5.59', 'hiveku-desktop', 'codex']) {
      const dir = await oldFolder(ALL, other);
      assert.equal(await knowledge.refreshDeclaration(dir), false, other);
      assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), oldMcpJson(other), other);
    }
    // A hiveku server that sends no name (the shape hiveku-sync writes) gets none added.
    const dir = await tmp('hk-declare-noheader-');
    await seedSettings(dir, { permissions: { ask: ALL } });
    const synced = JSON.stringify({ mcpServers: { hiveku: { type: 'http', url: `${BASE}/mcp`, headers: { Authorization: 'Bearer ${OLYMPUS_API_KEY}' } } } }, null, 2) + '\n';
    await seedMcp(dir, synced);
    assert.equal(await knowledge.refreshDeclaration(dir), false);
    assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), synced);
  });

  test('a link, a file that does not parse, no hiveku server and no .mcp.json are left alone', async () => {
    // A link may be shared with a folder whose rules are not in place: what it points at stays as it was.
    const shared = await tmp('hk-declare-shared-');
    const target = path.join(shared, 'mcp.json');
    await fs.writeFile(target, oldMcpJson(OLD));
    const linked = await tmp('hk-declare-link-');
    await seedSettings(linked, { permissions: { ask: ALL } });
    await fs.symlink(target, mcpPath(linked));
    assert.equal(await knowledge.refreshDeclaration(linked), false);
    assert.equal(await fs.readFile(target, 'utf8'), oldMcpJson(OLD));
    assert.ok((await fs.lstat(mcpPath(linked))).isSymbolicLink());

    for (const text of ['{ "mcpServers": { "hiveku": ', JSON.stringify({ mcpServers: { playwright: { command: 'npx' } } })]) {
      const dir = await tmp('hk-declare-odd-mcp-');
      await seedSettings(dir, { permissions: { ask: ALL } });
      await seedMcp(dir, text);
      assert.equal(await knowledge.refreshDeclaration(dir), false, text);
      assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), text, text);
    }

    const none = await tmp('hk-declare-nomcp-');
    await seedSettings(none, { permissions: { ask: ALL } });
    assert.equal(await knowledge.refreshDeclaration(none), false);
    await assert.rejects(fs.access(mcpPath(none)), 'a .mcp.json was made');
  });

  test('every start runs it for each open Hiveku folder, after the ask rules, one folder at a time (source)', () => {
    const fn = body('applySpendAskRules');
    assert.match(fn, /const \{ added, declared \} = await updateFolderAsks\(root\);/);
    assert.doesNotMatch(fn, /ensureSpendAskRules|refreshDeclaration/, 'a start adds the rules and declares through updateFolderAsks only');
    // One folder that fails does not stop the others.
    assert.match(fn, /for \(const folder of vscode\.workspace\.workspaceFolders \?\? \[\]\) \{\s*const root = folder\.uri\.fsPath;\s*try \{/);
    assert.match(SRC, /void applySpendAskRules\(\)\.catch\(/);
  });
});

describe('The scaffold declares only when its ask rules landed', () => {
  const scaffoldAccount = (dir) =>
    knowledge.writeScaffold({ baseDir: dir, accountLabel: 'Acme', apiKey: KEY, baseUrl: BASE, accountId: ACCOUNT });
  const scaffoldSite = (dir) =>
    knowledge.writeProjectScaffold({
      baseDir: dir, accountLabel: 'Acme', apiKey: KEY, baseUrl: BASE, accountId: ACCOUNT,
      projectId: '11111111-2222-3333-4444-555555555555', projectName: 'Main site',
    });

  test('a fresh account or site folder gets the rules, then the declaration', async () => {
    for (const scaffold of [scaffoldAccount, scaffoldSite]) {
      const dir = await tmp('hk-declare-fresh-');
      await scaffold(dir);
      assert.equal(await knowledge.askRulesInPlace(dir), true);
      assert.equal(await clientIn(dir), DECLARED);
    }
  });

  test('a failed settings write leaves the undeclared name, and a later setup that lands declares', async () => {
    for (const [what, scaffold] of [['account', scaffoldAccount], ['site', scaffoldSite]]) {
      const dir = await tmp('hk-declare-failed-');
      // .claude/settings.json is a folder, so the settings write fails.
      await fs.mkdir(settingsPath(dir), { recursive: true });
      await scaffold(dir);
      const server = (await readJson(mcpPath(dir))).mcpServers.hiveku;
      assert.deepEqual(server, { type: 'http', url: `${BASE}/mcp`, headers: { Authorization: `Bearer ${KEY}`, 'X-Hiveku-Client': UNDECLARED } }, what);
      assert.doesNotMatch(UNDECLARED, BUILDER_DECLARED_RE);
      // A start cannot add rules to a settings file it cannot read, so it does not declare.
      assert.deepEqual(await knowledge.updateFolderAsks(dir), { added: [], declared: false }, what);
      assert.equal(await clientIn(dir), UNDECLARED, what);
      // Once the settings can be written, Refresh Setup lands the rules and declares.
      await fs.rmdir(settingsPath(dir));
      await scaffold(dir);
      assert.equal(await knowledge.askRulesInPlace(dir), true, what);
      assert.equal(await clientIn(dir), DECLARED, what);
    }
  });

  test('every hiveku server takes its client from the folder\'s rules, never the declaration itself (source)', async () => {
    const calls = [];
    for (const file of (await fs.readdir(path.join(ROOT, 'src'))).filter((name) => name.endsWith('.ts'))) {
      const text = await fs.readFile(path.join(ROOT, 'src', file), 'utf8');
      for (const m of text.matchAll(/(?<!function )hivekuMcpServer\(/g)) {
        let depth = 1;
        let i = m.index + m[0].length;
        while (depth > 0 && i < text.length) {
          if (text[i] === '(') depth += 1;
          else if (text[i] === ')') depth -= 1;
          i += 1;
        }
        calls.push(`${file}: ${text.slice(m.index + m[0].length, i - 1)}`);
      }
    }
    assert.equal(calls.length, 3, calls.join('\n'));
    for (const call of calls) {
      assert.doesNotMatch(call, /declaredClaudeCodeClient/, call);
      assert.match(call, /, (await claudeCodeClientFor\([^)]*\)|client)$/, call);
    }
    assert.match(
      KNOWLEDGE_SRC,
      /const client = await claudeCodeClientFor\(folderPath\);\n\s*await setLocalHivekuServer\(folderPath, hivekuMcpServer\(apiKey, baseUrl, client\)\);/,
    );
  });
});

describe('The account command writes the ask rules first and declares only if they landed', () => {
  const claudeJsonPath = () => path.join(os.homedir(), '.claude.json');
  const localServer = async (dir) => (await readJson(claudeJsonPath())).projects[dir].mcpServers.hiveku;

  test('a folder the extension never scaffolded: the ask rules land, then the server declares', async () => {
    const dir = await tmp('hk-declare-cmd-');
    assert.equal(await knowledge.pointClaudeCodeAt(dir, KEY, BASE), true);
    // Only the ask rules: nothing else of the scaffold's settings comes with them.
    assert.deepEqual(await readJson(settingsPath(dir)), { permissions: { ask: ALL } });
    assert.deepEqual(await fs.readdir(dir), ['.claude']);
    assert.deepEqual(await fs.readdir(path.join(dir, '.claude')), ['settings.json']);
    assert.deepEqual(await localServer(dir), {
      type: 'http',
      url: `${BASE}/mcp`,
      headers: { Authorization: `Bearer ${KEY}`, 'X-Hiveku-Client': DECLARED },
    });
  });

  test('the person\'s own settings stay, and only the missing ask rules are added', async () => {
    const dir = await tmp('hk-declare-cmd-own-');
    const have = ['WebFetch', ...ALL.slice(0, 5)];
    await seedSettings(dir, { model: 'opus', permissions: { allow: ['Bash(make:*)'], ask: have } });
    assert.equal(await knowledge.pointClaudeCodeAt(dir, KEY, BASE), true);
    const kept = await readJson(settingsPath(dir));
    assert.deepEqual(kept, { model: 'opus', permissions: { allow: ['Bash(make:*)'], ask: [...have, ...ALL.slice(5)] } });
    assert.equal((await localServer(dir)).headers['X-Hiveku-Client'], DECLARED);
  });

  test('the rules come first: when ~/.claude.json cannot be written, they are in the folder anyway', async () => {
    const dir = await tmp('hk-declare-cmd-first-');
    const brokenHome = await tmp('hk-declare-home-broken-');
    await fs.mkdir(path.join(brokenHome, '.claude.json'));
    process.env.HOME = brokenHome;
    try {
      await assert.rejects(knowledge.pointClaudeCodeAt(dir, KEY, BASE), /Could not read/);
    } finally {
      process.env.HOME = HOME;
    }
    assert.equal(os.homedir(), HOME);
    assert.deepEqual((await readJson(settingsPath(dir))).permissions.ask, ALL);
  });

  test('rules that could not be written: the server sends the undeclared name, and the folder stays as it was', async () => {
    const cases = [
      ['a settings file that does not parse', (dir) => seedSettings(dir, '{ "permissions": { "ask": [ ')],
      ['an ask that is not a list', (dir) => seedSettings(dir, JSON.stringify({ permissions: { ask: 'WebFetch' } }))],
      ['a settings file that is a folder', (dir) => fs.mkdir(settingsPath(dir), { recursive: true })],
      ['a .claude that is a file', (dir) => fs.writeFile(path.join(dir, '.claude'), 'not a folder')],
      [
        'a settings file whose write fails',
        async (dir) => {
          await fs.mkdir(path.join(dir, '.claude'));
          await fs.symlink(path.join(dir, 'no-such-folder', 'settings.json'), settingsPath(dir));
        },
      ],
    ];
    for (const [what, seed] of cases) {
      const dir = await tmp('hk-declare-cmd-fail-');
      await seed(dir);
      const seeded = await snapshot(dir);
      assert.equal(await knowledge.pointClaudeCodeAt(dir, KEY, BASE), false, what);
      const client = (await localServer(dir)).headers['X-Hiveku-Client'];
      assert.equal(client, UNDECLARED, what);
      assert.doesNotMatch(client, BUILDER_DECLARED_RE, what);
      assert.deepEqual(await snapshot(dir), seeded, `${what}: the folder changed`);
    }
  });

  test('the account command and the repoint after a download both go through it (source)', () => {
    const command = body('setClaudeCodeAccount');
    assert.match(command, /declared = await pointClaudeCodeAt\(folderPath, key, baseUrl\(\)\);/);
    assert.match(command, /\$\{declared \? '' : NO_ASK_RULES_NOTE\}/);
    const repoint = body('warnIfClaudeShadowsProject');
    assert.match(repoint, /const declared = await pointClaudeCodeAt\(folderPath, key, baseUrl\(\)\);/);
    assert.match(repoint, /\$\{declared \? '' : NO_ASK_RULES_NOTE\}/);
    // Nothing else in the extension builds a hiveku server or writes one into ~/.claude.json.
    assert.doesNotMatch(SRC, /hivekuMcpServer\(|setLocalHivekuServer\(/);
  });
});

/** Every path under `dir` with what it is: a file's text, a link's target, or a folder. */
async function snapshot(dir, rel = '') {
  const out = {};
  for (const name of (await fs.readdir(path.join(dir, rel))).sort()) {
    const sub = path.join(rel, name);
    const stat = await fs.lstat(path.join(dir, sub));
    if (stat.isSymbolicLink()) out[sub] = `link to ${await fs.readlink(path.join(dir, sub))}`;
    else if (stat.isDirectory()) Object.assign(out, { [sub]: 'folder' }, await snapshot(dir, sub));
    else out[sub] = await fs.readFile(path.join(dir, sub), 'utf8');
  }
  return out;
}
