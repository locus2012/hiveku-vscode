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
 *     nothing else does; never before, never another client's value, never a
 *     later release's, never through a link (symbolic or hard). The new file
 *     is renamed over the old one, owner-only.
 *   - Activation (updateLocalDeclaration), in every open folder: the
 *     local-scope server the account command wrote into ~/.claude.json comes
 *     up to this release once the folder's rules are all there, and stops
 *     declaring while they are not; only that value changes, under Claude
 *     Code's own lock on the file.
 *   - The scaffold writes the ask rules before .mcp.json and declares only
 *     when they landed: a failed settings write leaves the undeclared name.
 *   - The account command (pointClaudeCodeAt) writes the ask rules into the
 *     folder first, one the extension never scaffolded included, and declares
 *     only when they are all there. The rules go into the settings file's own
 *     text, every other byte kept; the home folder's settings and a linked
 *     settings file are left alone.
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
import { createRequire } from 'node:module';
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

  test('a hard-linked .mcp.json is left alone, so a folder sharing it does not start declaring', async () => {
    // Folder A asks before every rule; folder B, an older one, does not, and shares A's .mcp.json by a hard link.
    const a = await oldFolder(ALL);
    const b = await oldFolder(OLD_RULES);
    await fs.rm(mcpPath(b));
    await fs.link(mcpPath(a), mcpPath(b));
    assert.equal(await knowledge.refreshDeclaration(a), false);
    assert.deepEqual(await knowledge.updateFolderAsks(a), { added: [], declared: false });
    assert.equal(await fs.readFile(mcpPath(b), 'utf8'), oldMcpJson(OLD), 'B started declaring this release without its rules');
    assert.equal((await fs.stat(mcpPath(a))).nlink, 2, 'the link between the two folders was broken');
  });

  test('the new .mcp.json replaces the old one whole, and an older 0644 one comes out owner-only', async () => {
    const dir = await oldFolder(OLD_RULES);
    await fs.chmod(mcpPath(dir), 0o644);
    const before = await fs.stat(mcpPath(dir));
    const entries = (await fs.readdir(dir)).sort();
    assert.deepEqual(await knowledge.updateFolderAsks(dir), { added: PRIVATE_READS, declared: true });
    const after = await fs.stat(mcpPath(dir));
    assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), oldMcpJson(DECLARED));
    // A new file renamed over the old: a reader at that moment sees one or the other, never an empty file.
    assert.notEqual(after.ino, before.ino, '.mcp.json was rewritten in place, so a reader could see it empty');
    assert.equal(after.mode & 0o777, 0o600, 'the key file is not owner-only');
    assert.deepEqual((await fs.readdir(dir)).sort(), entries, 'a temporary file was left beside .mcp.json');
  });

  test('a write that cannot finish leaves the old .mcp.json whole', { skip: process.getuid?.() === 0 && 'root writes into a read-only folder' }, async () => {
    const dir = await oldFolder(ALL);
    await fs.chmod(dir, 0o500);
    try {
      await assert.rejects(knowledge.refreshDeclaration(dir));
      assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), oldMcpJson(OLD));
    } finally {
      await fs.chmod(dir, 0o700);
    }
    assert.deepEqual((await fs.readdir(dir)).sort(), ['.claude', '.mcp.json']);
  });

  test('a later release\'s declaration stays: another install of the extension may share the folder', async () => {
    const [major, minor, patch] = VERSION.split('.').map(Number);
    for (const later of [`vscode-extension/${major}.${minor}.${patch + 1}`, `vscode-extension/${major}.${minor + 1}.0`, `vscode-extension/${major + 1}.0.0`]) {
      const dir = await oldFolder(ALL, later);
      assert.equal(await knowledge.refreshDeclaration(dir), false, later);
      assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), oldMcpJson(later), later);
    }
  });

  test('which values a release replaces with its own declaration', () => {
    const replaces = (current, version) => knowledge.upgradedClaudeCodeClient(current, version);
    // Its own undeclared names and an earlier release of it: replaced.
    for (const current of ['claude-code', 'vscode-extension', 'vscode-extension/0.91.75', 'vscode-extension/0.91.9', 'vscode-extension/0.0.0', 'vscode-extension/0.90.99']) {
      assert.equal(replaces(current, '0.91.77'), 'vscode-extension/0.91.77', current);
    }
    // Numbers compare as numbers, not text: 0.91.9 is earlier than 0.91.10.
    assert.equal(replaces('vscode-extension/0.91.9', '0.91.10'), 'vscode-extension/0.91.10');
    // This release, a later one, another client's value, or a value that names no release: kept.
    for (const current of ['vscode-extension/0.91.77', 'vscode-extension/0.91.78', 'vscode-extension/0.92.0', 'vscode-extension/1.0.0', 'vscode-extension/dev', 'hiveku-sync/0.5.59', 'codex', '']) {
      assert.equal(replaces(current, '0.91.77'), null, current);
    }
    // A release that cannot read its own version (it reads as 0.0.0) changes nothing.
    for (const current of ['claude-code', 'vscode-extension', 'vscode-extension/0.91.75']) {
      assert.equal(replaces(current, '0.0.0'), null, current);
      assert.equal(replaces(current, 'not-a-version'), null, current);
    }
    // Without a version given, it is this release.
    assert.equal(replaces('claude-code'), DECLARED);
  });

  test('an install that cannot read its own version leaves a working declaration alone', async () => {
    // The compiled extension beside a package.json with no version, as an unreadable one reads: 0.0.0.
    const copy = await tmp('hk-declare-noversion-');
    await fs.cp(path.join(ROOT, 'out'), path.join(copy, 'out'), { recursive: true });
    await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: 'hiveku-vscode' }));
    const unversioned = createRequire(path.join(copy, 'out', 'knowledge.js'))('./knowledge.js');
    assert.equal(unversioned.declaredClaudeCodeClient(), 'vscode-extension/0.0.0');
    for (const client of [DECLARED, UNDECLARED, OLD]) {
      const dir = await oldFolder(ALL, client);
      assert.equal(await unversioned.refreshDeclaration(dir), false, client);
      assert.equal(await fs.readFile(mcpPath(dir), 'utf8'), oldMcpJson(client), client);
    }
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
    assert.deepEqual(await knowledge.pointClaudeCodeAt(dir, KEY, BASE), { declared: true, leftAlone: null });
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
    assert.deepEqual(await knowledge.pointClaudeCodeAt(dir, KEY, BASE), { declared: true, leftAlone: null });
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
    ];
    // A settings file the owner cannot write (root writes it anyway, so not then).
    if (process.getuid?.() !== 0) {
      cases.push([
        'a settings file whose write fails',
        async (dir) => {
          await seedSettings(dir, { permissions: { allow: ['Bash(make:*)'] } });
          await fs.chmod(settingsPath(dir), 0o444);
        },
      ]);
    }
    for (const [what, seed] of cases) {
      const dir = await tmp('hk-declare-cmd-fail-');
      await seed(dir);
      const seeded = await snapshot(dir);
      assert.deepEqual(await knowledge.pointClaudeCodeAt(dir, KEY, BASE), { declared: false, leftAlone: null }, what);
      const client = (await localServer(dir)).headers['X-Hiveku-Client'];
      assert.equal(client, UNDECLARED, what);
      assert.doesNotMatch(client, BUILDER_DECLARED_RE, what);
      assert.deepEqual(await snapshot(dir), seeded, `${what}: the folder changed`);
    }
  });

  test('the account command and the repoint after a download both go through it, and say why it did not declare (source)', () => {
    const command = body('setClaudeCodeAccount');
    assert.match(command, /pointed = await pointClaudeCodeAt\(folderPath, key, baseUrl\(\)\);/);
    assert.match(command, /\$\{askRulesNote\(pointed\)\}/);
    const repoint = body('warnIfClaudeShadowsProject');
    assert.match(repoint, /const pointed = await pointClaudeCodeAt\(folderPath, key, baseUrl\(\)\);/);
    assert.match(repoint, /\$\{askRulesNote\(pointed\)\}/);
    // No note when it declared; the home folder and a link each get their own.
    const note = body('askRulesNote');
    assert.match(note, /if \(declared\) return '';/);
    assert.match(note, /leftAlone === 'home'\) return HOME_SETTINGS_NOTE;/);
    assert.match(note, /leftAlone === 'link'\) return LINKED_SETTINGS_NOTE;/);
    assert.match(note, /return NO_ASK_RULES_NOTE;/);
    // Nothing else in the extension builds a hiveku server or writes one into ~/.claude.json.
    assert.doesNotMatch(SRC, /hivekuMcpServer\(|setLocalHivekuServer\(/);
  });
});

describe('The account command adds only the rules, and leaves the home folder\'s settings and links alone', () => {
  const claudeJsonPath = () => path.join(os.homedir(), '.claude.json');
  const localClient = async (dir) => (await readJson(claudeJsonPath())).projects[dir].mcpServers.hiveku.headers['X-Hiveku-Client'];

  test('a hand-formatted settings file keeps every byte; the rules go in after what it asks', async () => {
    // CRLF, a four-space indent, an escape, a number JSON.stringify would rewrite, a one-line list, no final newline.
    const own = '{\r\n    "model": "opus",\r\n    "env": { "GREETING": "caf\\u00e9", "RETRIES": 3e0 },\r\n    "permissions": {\r\n        "allow": ["Bash(make:*)"],\r\n        "ask": [\r\n            "WebFetch"\r\n        ]\r\n    }\r\n}';
    const dir = await tmp('hk-declare-cmd-bytes-');
    await seedSettings(dir, own);
    assert.deepEqual(await knowledge.pointClaudeCodeAt(dir, KEY, BASE), { declared: true, leftAlone: null });
    const rules = ALL.map((rule) => `,\r\n            "${rule}"`).join('');
    assert.equal(await fs.readFile(settingsPath(dir), 'utf8'), own.replace('            "WebFetch"', `            "WebFetch"${rules}`));
    assert.equal(await localClient(dir), DECLARED);
  });

  test('a start adds the missing rules into the text the same way', async () => {
    const dir = await tmp('hk-declare-start-bytes-');
    const own = `{\n\t"model": "opus",\n\t"permissions": {\n\t\t"ask": [\n${OLD_RULES.map((rule) => `\t\t\t"${rule}"`).join(',\n')}\n\t\t],\n\t\t"deny": ["Read(**/.env.local)"]\n\t}\n}\n`;
    await seedSettings(dir, own);
    await seedMcp(dir, oldMcpJson(OLD));
    assert.deepEqual(await knowledge.updateFolderAsks(dir), { added: PRIVATE_READS, declared: true });
    const last = `\t\t\t"${OLD_RULES.at(-1)}"`;
    assert.equal(await fs.readFile(settingsPath(dir), 'utf8'), own.replace(`${last}\n`, `${last}${PRIVATE_READS.map((rule) => `,\n\t\t\t"${rule}"`).join('')}\n`));
  });

  test('a linked settings file, or a linked .claude, is left alone, and the server does not declare', async () => {
    const own = '{\n\t"model": "opus",\n\t"permissions": { "allow": ["Bash(make:*)"] }\n}\n';
    // Each case links into a shared folder of its own, holding one settings file with no other link to it.
    const cases = [
      ['a symbolic link', async (dir, target) => { await fs.mkdir(path.join(dir, '.claude')); await fs.symlink(target, settingsPath(dir)); }],
      ['a hard link', async (dir, target) => { await fs.mkdir(path.join(dir, '.claude')); await fs.link(target, settingsPath(dir)); }],
      ['a linked .claude', async (dir, target) => { await fs.rename(target, path.join(path.dirname(target), 'settings.json')); await fs.symlink(path.dirname(target), path.join(dir, '.claude')); }],
      ['a link to no file', async (dir, target) => { await fs.mkdir(path.join(dir, '.claude')); await fs.symlink(path.join(path.dirname(target), 'none', 'settings.json'), settingsPath(dir)); }],
    ];
    for (const [what, seed] of cases) {
      const shared = await tmp('hk-declare-dotfiles-');
      const target = path.join(shared, 'claude-settings.json');
      await fs.writeFile(target, own);
      const dir = await tmp('hk-declare-cmd-link-');
      await seed(dir, target);
      const before = await snapshot(shared);
      assert.deepEqual(await knowledge.pointClaudeCodeAt(dir, KEY, BASE), { declared: false, leftAlone: 'link' }, what);
      assert.deepEqual(await snapshot(shared), before, `${what}: the shared settings changed`);
      assert.equal(await localClient(dir), UNDECLARED, what);
    }
  });

  test('a linked settings file that already asks before every rule: the server declares, and the file is not written', async () => {
    const shared = await tmp('hk-declare-dotfiles-full-');
    const target = path.join(shared, 'claude-settings.json');
    await fs.writeFile(target, JSON.stringify({ permissions: { ask: ALL } }));
    const { mtimeMs } = await fs.stat(target);
    const dir = await tmp('hk-declare-cmd-link-full-');
    await fs.mkdir(path.join(dir, '.claude'));
    await fs.symlink(target, settingsPath(dir));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(await knowledge.pointClaudeCodeAt(dir, KEY, BASE), { declared: true, leftAlone: 'link' });
    assert.equal((await fs.stat(target)).mtimeMs, mtimeMs);
    assert.equal(await localClient(dir), DECLARED);
  });

  test('in the home folder, .claude/settings.json is Claude Code\'s settings for every folder: left alone', async () => {
    const userSettings = '{\n    "model": "opus",\n    "statusLine": { "type": "command", "command": "echo hi" }\n}\n';
    await fs.mkdir(path.join(HOME, '.claude'), { recursive: true });
    await fs.writeFile(path.join(HOME, '.claude', 'settings.json'), userSettings);
    try {
      assert.deepEqual(await knowledge.pointClaudeCodeAt(HOME, KEY, BASE), { declared: false, leftAlone: 'home' });
      assert.equal(await fs.readFile(path.join(HOME, '.claude', 'settings.json'), 'utf8'), userSettings);
      assert.equal(await localClient(HOME), UNDECLARED);
      // Also when the folder is named another way.
      assert.deepEqual(await knowledge.pointClaudeCodeAt(`${HOME}${path.sep}`, KEY, BASE), { declared: false, leftAlone: 'home' });
      assert.equal(await fs.readFile(path.join(HOME, '.claude', 'settings.json'), 'utf8'), userSettings);
    } finally {
      await fs.rm(path.join(HOME, '.claude'), { recursive: true, force: true });
    }
  });
});

describe('A start brings the local-scope server the account command wrote in line with the folder\'s rules', () => {
  const claudeJsonPath = () => path.join(os.homedir(), '.claude.json');
  const server = (client) => ({
    type: 'http',
    url: `${BASE}/mcp`,
    headers: client === undefined ? { Authorization: `Bearer ${KEY}` } : { Authorization: `Bearer ${KEY}`, 'X-Hiveku-Client': client },
  });

  /** ~/.claude.json as Claude Code keeps it (owner-only), with `folder`'s local hiveku server sending `client`. */
  async function seedClaudeJson(folder, client) {
    const cfg = {
      numStartups: 41,
      mcpServers: { hiveku: server('claude-code') },
      projects: {
        '/somewhere/else': { allowedTools: [], mcpServers: { hiveku: server('vscode-extension/0.91.70') }, lastCost: 1.5 },
        [folder]: { allowedTools: ['Bash(make:*)'], hasTrustDialogAccepted: true, mcpServers: { mine: { command: 'npx' }, hiveku: server(client) } },
      },
    };
    await fs.rm(claudeJsonPath(), { recursive: true, force: true });
    await fs.writeFile(claudeJsonPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
    return cfg;
  }

  async function folderAsking(ask) {
    const dir = await tmp('hk-declare-local-');
    if (ask) await seedSettings(dir, { permissions: { ask } });
    return dir;
  }

  test('a folder with no ask rules stops declaring: only that one value changes', async () => {
    for (const declared of ['vscode-extension/0.91.77', 'vscode-extension/0.91.8', DECLARED]) {
      const dir = await folderAsking(null);
      const cfg = await seedClaudeJson(dir, declared);
      assert.equal(await knowledge.updateLocalDeclaration(dir), UNDECLARED, declared);
      cfg.projects[dir].mcpServers.hiveku.headers['X-Hiveku-Client'] = UNDECLARED;
      assert.deepEqual(await readJson(claudeJsonPath()), cfg, declared);
      assert.equal((await fs.stat(claudeJsonPath())).mode & 0o777, 0o600, 'the file holds keys: it stays owner-only');
    }
    // With some of the rules, it is the same.
    const partial = await folderAsking(OLD_RULES);
    await seedClaudeJson(partial, 'vscode-extension/0.91.77');
    assert.equal(await knowledge.updateLocalDeclaration(partial), UNDECLARED);
    // Nothing is left beside the file: no lock, no temporary file.
    assert.deepEqual((await fs.readdir(HOME)).filter((name) => name.startsWith('.claude.json')), ['.claude.json']);
  });

  test('a folder with every ask rule comes up to this release; a later release, another client\'s value and none stay', async () => {
    for (const earlier of ['vscode-extension/0.91.75', 'claude-code', 'vscode-extension']) {
      const dir = await folderAsking(ALL);
      await seedClaudeJson(dir, earlier);
      assert.equal(await knowledge.updateLocalDeclaration(dir), DECLARED, earlier);
      assert.equal((await readJson(claudeJsonPath())).projects[dir].mcpServers.hiveku.headers['X-Hiveku-Client'], DECLARED, earlier);
    }
    const [major, minor, patch] = VERSION.split('.').map(Number);
    const kept = [[ALL, `vscode-extension/${major}.${minor}.${patch + 1}`], [ALL, DECLARED], [ALL, 'hiveku-sync/0.5.59'], [ALL, undefined], [null, 'claude-code'], [OLD_RULES, 'vscode-extension']];
    for (const [ask, client] of kept) {
      const dir = await folderAsking(ask);
      await seedClaudeJson(dir, client);
      const before = await fs.readFile(claudeJsonPath(), 'utf8');
      const { mtimeMs } = await fs.stat(claudeJsonPath());
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(await knowledge.updateLocalDeclaration(dir), null, String(client));
      assert.equal(await fs.readFile(claudeJsonPath(), 'utf8'), before, String(client));
      assert.equal((await fs.stat(claudeJsonPath())).mtimeMs, mtimeMs, `${client}: a start with nothing to change wrote ~/.claude.json`);
    }
    // No local server for the folder, or no ~/.claude.json at all: nothing to do.
    const other = await folderAsking(null);
    await seedClaudeJson('/not/this/folder', 'vscode-extension/0.91.77');
    assert.equal(await knowledge.updateLocalDeclaration(other), null);
    await fs.rm(claudeJsonPath());
    assert.equal(await knowledge.updateLocalDeclaration(other), null);
    await assert.rejects(fs.access(claudeJsonPath()), 'a ~/.claude.json was made');
  });

  test('while Claude Code holds its lock on ~/.claude.json nothing is written; once it lets go, the change lands', async () => {
    const dir = await folderAsking(null);
    await seedClaudeJson(dir, 'vscode-extension/0.91.77');
    const before = await fs.readFile(claudeJsonPath(), 'utf8');
    const lock = `${await fs.realpath(claudeJsonPath())}.lock`;
    await fs.mkdir(lock);
    try {
      assert.equal(await knowledge.updateLocalDeclaration(dir), null);
      assert.equal(await fs.readFile(claudeJsonPath(), 'utf8'), before);
    } finally {
      await fs.rmdir(lock);
    }
    assert.equal(await knowledge.updateLocalDeclaration(dir), UNDECLARED);
    await assert.rejects(fs.access(lock), 'the lock was not let go');
  });

  test('a linked ~/.claude.json stays a link; the file it points at is changed', async () => {
    const dir = await folderAsking(null);
    await seedClaudeJson(dir, 'vscode-extension/0.91.77');
    const dotfiles = await tmp('hk-declare-dotfiles-claude-');
    const target = path.join(dotfiles, 'claude.json');
    await fs.rename(claudeJsonPath(), target);
    await fs.symlink(target, claudeJsonPath());
    try {
      assert.equal(await knowledge.updateLocalDeclaration(dir), UNDECLARED);
      assert.ok((await fs.lstat(claudeJsonPath())).isSymbolicLink());
      assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).projects[dir].mcpServers.hiveku.headers['X-Hiveku-Client'], UNDECLARED);
    } finally {
      await fs.rm(claudeJsonPath(), { force: true });
    }
  });

  test('a start runs it for every open folder, Hiveku or not, after the ask rules and on its own (source)', () => {
    const fn = body('applySpendAskRules');
    const local = fn.indexOf('await updateLocalDeclaration(root)');
    assert.ok(local > fn.indexOf('await updateFolderAsks(root)'), 'the local server is updated after the folder\'s rules');
    // Not only in Hiveku folders: the account command wires any folder.
    assert.match(fn, /if \(isProject \|\| isAccount\) \{\s*const \{ added, declared \} = await updateFolderAsks\(root\);/);
    assert.doesNotMatch(fn, /continue;/);
    // Its own try, so a failed rules step does not skip it.
    assert.match(fn, /ask rules failed: \$\{errMsg\(err\)\}`\);\s*\}\s*try \{\s*const sent = await updateLocalDeclaration\(root\);/);
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
