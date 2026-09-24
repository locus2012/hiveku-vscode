/**
 * What the scaffolded folders teach an agent about memory (memory surface gaps
 * G18, G19, G20).
 *
 * G18: department memory is ONE document per department and memory_update
 *      replaces all of it. The old scaffold text said "create it, and on a 409
 *      use memory_update", with a short note as the content, and called the
 *      domain free-form. Followed literally that replaced the whole department
 *      memory with one note, and a made-up domain (dev) is saved but never
 *      reaches any agent. Every generated command and CLAUDE.md now teaches
 *      read, merge, then send the whole document, with the real domain list.
 * G19: the Codex AGENTS.md region says to call account_context_get first, that
 *      the account memory is read-only (suggest with account_memory_append),
 *      and how to change department memory, and stays well under Codex's
 *      32 KiB instruction cap.
 * G20: the Codex MCP config sends X-Hiveku-Client = codex beside the key, in
 *      the one http_headers table (TOML forbids a second http_headers key).
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
const { ROLES } = loadOut('roles');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const KEY = 'olp_test_key_123';
const BASE = 'https://core.hiveku.com';

/** The department domains hydration understands (hiveku-orient, "The domain is not free-form"). */
const CANONICAL_DOMAINS = [
  'marketing', 'content', 'seo', 'social', 'ppc', 'outbound', 'branding', 'customer_avatar',
  'customer_journey', 'website_design', 'knowledge_base', 'workflow', 'before_after_grid', 'email',
  'sales', 'helpdesk', 'production', 'accounting', 'comms', 'coder', 'orchestrator',
];

/**
 * The exact teachings that wipe a department's memory or split it across
 * domains. Each one appeared in a generated file before this change.
 */
const CLOBBER_PATTERNS = [
  [/FREE-FORM label/i, 'calls the memory domain free-form'],
  [/on a 409[^\n]*\n?[^\n]*use\s+`memory_update`\s+instead/i, 'create, then memory_update on a 409'],
  [/returns 409 if it already exists\s*→\s*`memory_update`/, 'create, then memory_update on a 409'],
  [/`memory_create`\/`memory_update`/, 'a short note sent to memory_create or memory_update'],
  [/content \}\)` or `memory_update`/, 'memory_create or memory_update, with no read and merge'],
  [/e\.g\. `"seo"`, `"marketing"`, `"dev"`/, 'names dev, which no agent reads, as a domain'],
];

async function tmp(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Every markdown file an agent reads in a scaffolded folder. */
async function agentFacingFiles(dir) {
  const out = [];
  async function walk(d) {
    let entries = [];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        // Vendored agency skills are generated from the plugin, not written here.
        if (entry.name === 'skills' || entry.name === 'node_modules') continue;
        await walk(full);
      } else if (entry.name.endsWith('.md')) {
        out.push(full);
      }
    }
  }
  await walk(path.join(dir, '.claude'));
  for (const top of ['CLAUDE.md', 'AGENTS.md']) {
    try {
      await fs.access(path.join(dir, top));
      out.push(path.join(dir, top));
    } catch {
      /* not written */
    }
  }
  return out;
}

/** Scaffold an account folder and a project folder for a role, Codex on. */
async function scaffoldBoth(role) {
  knowledge.setCodexSupport(true);
  const account = await tmp('hk-mem-acct-');
  await knowledge.writeScaffold({
    baseDir: account, accountLabel: 'Western Stairlifts', apiKey: KEY, baseUrl: BASE, role, accountId: ACCOUNT,
  });
  const project = await tmp('hk-mem-proj-');
  await knowledge.writeProjectScaffold({
    baseDir: project, accountLabel: 'Western Stairlifts', apiKey: KEY, baseUrl: BASE, role, accountId: ACCOUNT,
    projectId: '11111111-2222-3333-4444-555555555555', projectName: 'Main site',
  });
  return { account, project };
}

function tomlSection(toml, name) {
  const start = toml.indexOf(`[${name}]`);
  assert.notEqual(start, -1, `[${name}] missing`);
  const rest = toml.slice(start + name.length + 2);
  const next = rest.search(/^\[|^# hiveku:end/m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Parse a one-line TOML inline table of quoted string pairs into an object. */
function inlineStringTable(line) {
  const outer = line.match(/^\s*http_headers = \{ (.*) \}\s*$/);
  assert.ok(outer, `not an inline table: ${line}`);
  const body = outer[1];
  const obj = {};
  let consumed = 0;
  for (const hit of body.matchAll(/"([^"]+)" = "([^"]*)"(?:, |$)/g)) {
    assert.equal(hit.index, consumed, `unparsed text in ${line}`);
    obj[hit[1]] = hit[2];
    consumed = hit.index + hit[0].length;
  }
  assert.equal(consumed, body.length, `unparsed text in ${line}`);
  return obj;
}

describe('G18: generated commands and CLAUDE.md teach read, merge, then write the whole document', () => {
  const roleIds = [undefined, ...ROLES.map((r) => r.id)];
  for (const role of roleIds) {
    test(`role ${role ?? '(none)'}: no generated file teaches the memory-wiping pattern`, async () => {
      const { account, project } = await scaffoldBoth(role);
      const files = [...(await agentFacingFiles(account)), ...(await agentFacingFiles(project))];
      assert.ok(files.length > 5, 'scaffold wrote the command files');
      for (const file of files) {
        const text = await fs.readFile(file, 'utf8');
        for (const [pattern, why] of CLOBBER_PATTERNS) {
          assert.doesNotMatch(text, pattern, `${path.basename(file)} ${why}`);
        }
        // Any file that tells the agent to write memory with memory_update also
        // says the write carries the WHOLE document.
        if (/`memory_update/.test(text)) {
          assert.match(text, /whole/i, `${path.basename(file)} names memory_update without the whole-document rule`);
        }
      }
    });
  }

  test('/hiveku-remember reads first, merges, and sends the whole document; domains are the real list', async () => {
    const { project } = await scaffoldBoth('dev');
    const remember = await fs.readFile(path.join(project, '.claude', 'commands', 'hiveku-remember.md'), 'utf8');
    const read = remember.indexOf('memory_list({ domain');
    const write = remember.indexOf('memory_update({ memory_id, content })');
    assert.ok(read !== -1 && write !== -1 && read < write, 'reads with memory_list before memory_update');
    assert.match(remember, /WHOLE/);
    for (const domain of CANONICAL_DOMAINS) assert.match(remember, new RegExp('`' + domain + '`'));
    assert.match(remember, /`dev`[^\n]*\n?[^\n]*never reaches/i, 'says dev is not a domain');
    assert.match(remember, /409[^\n]*\n?[^\n]*read/i, 'a 409 on create sends the agent back to read');
    assert.match(remember, /account_memory_append/);
    assert.match(remember, /^allowed-tools:.*mcp__hiveku__memory_list/m);
  });

  test('the project CLAUDE.md sync section carries the same rules', async () => {
    const { project } = await scaffoldBoth('seo');
    const claude = await fs.readFile(path.join(project, 'CLAUDE.md'), 'utf8');
    const section = claude.slice(claude.indexOf('### Keep Hiveku in sync'), claude.indexOf('### Work tracking'));
    assert.ok(section.length > 100);
    assert.match(section, /memory_list/);
    assert.match(section, /whole/i);
    assert.match(section, /`coder`/);
    assert.match(section, /account_memory_append/);
  });
});

describe('G19: the Codex AGENTS.md region covers context and memory', () => {
  for (const kind of ['account', 'project']) {
    test(`${kind} folder: account_context_get first, read-only account memory, read-merge-write`, async () => {
      const dir = await tmp('hk-codex-');
      await codex.writeCodexScaffold({
        baseDir: dir, apiKey: KEY, baseUrl: BASE, accountLabel: 'Western Stairlifts', accountId: ACCOUNT, kind,
        projectName: 'Main site',
      });
      const agents = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
      assert.match(agents, /`account_context_get\(\{ domain \}\)` first/);
      assert.match(agents, /account memory is read-only/i);
      assert.match(agents, /dashboard/);
      assert.match(agents, /`account_memory_append`/);
      assert.match(agents, /`hiveku-data\/account\/ACCOUNT_MEMORY\.md`/);
      assert.match(agents, /memory_list\(\{ domain \}\)/);
      assert.match(agents, /whole document with\s+`memory_update/);
      assert.match(agents, /never create-then-overwrite on a 409/i);
      // Codex reads at most 32 KiB of instructions; the managed region leaves
      // nearly all of it for the user's own AGENTS.md content.
      assert.ok(Buffer.byteLength(agents, 'utf8') < 8 * 1024, `AGENTS.md region is ${Buffer.byteLength(agents)} bytes`);
    });
  }

  test('re-running keeps one managed region and the user text outside it', async () => {
    const dir = await tmp('hk-codex-rerun-');
    await fs.writeFile(path.join(dir, 'AGENTS.md'), '# Mine\nKeep this.\n');
    const opts = { baseDir: dir, apiKey: KEY, baseUrl: BASE, accountLabel: 'Acme', accountId: ACCOUNT, kind: 'account' };
    await codex.writeCodexScaffold(opts);
    await codex.writeCodexScaffold(opts);
    const agents = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    assert.equal(agents.match(/account_memory_append/g).length, 1);
    assert.match(agents, /^# Mine\nKeep this\.\n/);
  });
});

describe('G20: the Codex MCP config labels the client', () => {
  test('the hiveku server sends X-Hiveku-Client = codex beside the key, in one http_headers table', async () => {
    const dir = await tmp('hk-codex-toml-');
    await codex.writeCodexScaffold({
      baseDir: dir, apiKey: KEY, baseUrl: BASE, accountLabel: 'Acme', accountId: ACCOUNT, kind: 'account',
    });
    const toml = await fs.readFile(path.join(dir, '.codex', 'config.toml'), 'utf8');
    const hiveku = tomlSection(toml, 'mcp_servers.hiveku');
    const headerLines = hiveku.split('\n').filter((line) => /^\s*http_headers\s*=/.test(line));
    assert.equal(headerLines.length, 1, 'exactly one http_headers key (a second one is a TOML error)');
    assert.deepEqual(inlineStringTable(headerLines[0]), {
      Authorization: `Bearer ${KEY}`,
      'X-Hiveku-Client': 'codex',
    });
    // The label is for the Hiveku server only, never sent to a third party.
    assert.doesNotMatch(tomlSection(toml, 'mcp_servers.playwright'), /X-Hiveku-Client/);
  });

  test('the VS Code account scaffold writes the same labelled config when Codex support is on', async () => {
    const { account } = await scaffoldBoth('owner');
    const toml = await fs.readFile(path.join(account, '.codex', 'config.toml'), 'utf8');
    assert.match(tomlSection(toml, 'mcp_servers.hiveku'), /"X-Hiveku-Client" = "codex"/);
  });
});
