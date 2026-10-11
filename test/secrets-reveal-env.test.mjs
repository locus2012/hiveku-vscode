/**
 * The extension reads a site's values only through project_secrets_reveal, and
 * its other secrets surfaces show names only (plan B3).
 *
 *   - Pull Env: one reveal for the development tier; on approval_required it
 *     opens the approval page, then repeats the same call with the token every
 *     5 s for up to 10 minutes; writes .env.local mode 0600 even over an
 *     existing 0644 file, values encoded so dotenv + dotenv-expand (Next.js,
 *     Vite, Expo) read them back exactly, withheld names as comments; writes
 *     nothing when nothing came back, a person declined, or the wait was
 *     cancelled.
 *   - Push Env: development values only (tier 'development', so KEY_DEV),
 *     never a bare key, and never a key suffixed for staging or production.
 *   - The Secrets module, Manage Secrets and the virtual env document ask with
 *     metadata_only and never show a value, a hint or a mask; the document is
 *     read-only and a save is refused before any request.
 *   - Nothing in the extension calls project_secrets_list without metadata_only.
 *   - The .mcp.json it writes for Claude Code declares
 *     vscode-extension/<package.json version>; the Codex config and the
 *     extension's own calls do not declare.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calls, resetCalls, vscodeStub } from './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const env = loadOut('env');
const api = loadOut('hivekuApi');
const platformFs = loadOut('platformFs');
const resources = loadOut('resources');
const modules = loadOut('modules');
const knowledge = loadOut('knowledge');
const { McpToolError } = loadOut('mcpClient');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const PROJECT = '11111111-1111-4111-8111-111111111111';
// Built at run time: gitleaks refuses token-shaped literals.
const TOKEN = ['3f2b1c4d', '5e6f', '4a7b', '8c9d', '0e1f2a3b4c5d'].join('-');
const APPROVE_URL = `https://app.hiveku.com/${ACCOUNT}/dashboard/${PROJECT}/env/reveal-approval?token=${TOKEN}`;
const SECRET_VALUE = ['sk', 'live', 'q'.repeat(20)].join('_');

const asked = { code: 'approval_required', approval: { token: TOKEN, approve_url: APPROVE_URL, tier: 'development', keys: null, names: ['SITE_NAME'] }, withheld: [], missing: [] };
const revealed = (extra = {}) => ({
  tier: 'development',
  values: { SITE_NAME: 'Acme shop', API_SECRET: SECRET_VALUE, PEM: '-----BEGIN KEY-----\nMII\n-----END KEY-----', ...extra },
  source_keys: {},
  withheld: [{ key: 'STRIPE_SECRET_KEY', reason: 'sensitive', why: 'Marked sensitive (write-only).' }],
  missing: [],
});
const toolError = (code, status) => new McpToolError(`Tool project_secrets_reveal errored (${status})`, 'project_secrets_reveal', { error: code, status, details: { error: code, code, message: code } });

/** A fake client that answers project_secrets_reveal in order and records every call. */
function revealClient(answers) {
  const seen = [];
  return {
    seen,
    async callToolJson(name, args = {}) {
      seen.push({ name, args });
      if (name !== 'project_secrets_reveal') throw new Error(`unexpected tool ${name}`);
      const next = answers.length > 1 ? answers.shift() : answers[0];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

async function scmIn(dir) {
  return { root: dir, link: { account_id: ACCOUNT, project_id: PROJECT, project_name: 'Acme' } };
}

beforeEach(() => {
  resetCalls();
  env.envTiming.sleep = async () => undefined;
  env.envTiming.pollMs = 5_000;
  env.envTiming.waitMs = 10 * 60_000;
  vscodeStub.window.showInformationMessage = (...a) => { calls.infos.push(a); return Promise.resolve(a.includes('Open approval page') ? 'Open approval page' : undefined); };
  vscodeStub.window.showWarningMessage = (...a) => {
    calls.warnings.push(a);
    return Promise.resolve(a.find((x) => x === 'Write .env.local' || x === 'Overwrite' || x === 'Push to Hiveku'));
  };
});

describe('Pull Env through the reveal', () => {
  test('★ asks once, opens the approval page, waits with the token, then writes .env.local 0600', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-env-'));
    const client = revealClient([asked, toolError('approval_pending', 409), toolError('approval_pending', 409), revealed()]);
    await env.pullEnv(await scmIn(dir), async () => client);
    assert.deepEqual(client.seen.map((c) => c.name), Array(4).fill('project_secrets_reveal'));
    assert.deepEqual(client.seen[0].args, { project_id: PROJECT, tier: 'development' });
    for (const later of client.seen.slice(1)) assert.deepEqual(later.args, { project_id: PROJECT, tier: 'development', approval_token: TOKEN });
    assert.deepEqual(calls.openExternal.map((u) => u.raw ?? String(u)), [APPROVE_URL]);
    const file = path.join(dir, '.env.local');
    const text = await fs.readFile(file, 'utf8');
    assert.match(text, /^API_SECRET=sk_live_q+$/m);
    assert.ok(text.includes("PEM='-----BEGIN KEY-----\nMII\n-----END KEY-----'"), 'a multi-line value is quoted');
    assert.match(text, /^# STRIPE_SECRET_KEY: Marked sensitive \(write-only\)\.$/m);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    // No value in any message the user was shown.
    assert.ok(!JSON.stringify([calls.infos, calls.warnings, calls.errors]).includes(SECRET_VALUE));
    // What the file says reads back exactly through the same rules the push uses.
    const back = env.parseEnvFile(text);
    assert.equal(back.API_SECRET, SECRET_VALUE);
    assert.equal(back.PEM, '-----BEGIN KEY-----\nMII\n-----END KEY-----');
  });

  test('0600 even over an existing 0644 file, and no temporary file is left', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-env-'));
    const file = path.join(dir, '.env.local');
    await fs.writeFile(file, 'OLD=1\n', { mode: 0o644 });
    await fs.chmod(file, 0o644);
    await env.pullEnv(await scmIn(dir), async () => revealClient([revealed()]));
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.ok(!(await fs.readFile(file, 'utf8')).includes('OLD=1'));
    assert.deepEqual((await fs.readdir(dir)).sort(), ['.env.local', '.gitignore']);
  });

  test('★ nothing revealed: nothing written, and an existing file stays as it was', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-env-'));
    const file = path.join(dir, '.env.local');
    await fs.writeFile(file, 'KEEP=me\n');
    await env.pullEnv(await scmIn(dir), async () => revealClient([{ ...revealed(), values: {} }]));
    assert.equal(await fs.readFile(file, 'utf8'), 'KEEP=me\n');
    assert.ok(calls.infos.some((a) => String(a[0]).includes('left as it was')));
  });

  test('a decline stops the wait with a message and writes nothing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-env-'));
    await env.pullEnv(await scmIn(dir), async () => revealClient([asked, toolError('approval_pending', 409), toolError('approval_declined', 403)]));
    assert.deepEqual(await fs.readdir(dir), []);
    assert.ok(calls.warnings.some((a) => String(a[0]).includes('declined')));
  });

  test('closing the approval question asks nothing more and writes nothing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-env-'));
    vscodeStub.window.showInformationMessage = (...a) => { calls.infos.push(a); return Promise.resolve(undefined); };
    const client = revealClient([asked]);
    await env.pullEnv(await scmIn(dir), async () => client);
    assert.equal(client.seen.length, 1);
    assert.equal(calls.openExternal.length, 0);
    assert.deepEqual(await fs.readdir(dir), []);
  });

  test('nobody approves within 10 minutes: it stops asking and writes nothing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-env-'));
    let clock = 0;
    env.envTiming.now = () => clock;
    env.envTiming.sleep = async (ms) => { clock += ms; };
    try {
      const client = revealClient([asked, toolError('approval_pending', 409)]);
      await env.pullEnv(await scmIn(dir), async () => client);
      assert.equal(client.seen.length, 1 + (10 * 60_000) / 5_000);
      assert.deepEqual(await fs.readdir(dir), []);
      assert.ok(calls.warnings.some((a) => String(a[0]).includes('10 minutes')));
    } finally {
      env.envTiming.now = () => Date.now();
    }
  });
});

describe('the .env encoding round-trips', () => {
  const VALUES = {
    PLAIN: 'abc123',
    SPACES: 'hello world',
    HASH: 'a#b # c',
    DOLLAR: 'pa$$word$FOO${FOO}',
    BSN: 'line1\\nline2',
    NL: 'line1\nline2\n',
    JSON: '{"private_key":"-----BEGIN KEY-----\\nMIIabc\\n-----END KEY-----\\n"}',
    SQ: "it's",
    DQ: 'say "hi"',
    BT: 'a`b',
    TAB: 'a\tb',
    QUOTES3: `a'b"c`,
    EMPTY: '',
  };

  test('every value written by renderEnvFile is read back by parseEnvFile', () => {
    const { text, written, notes } = env.renderEnvFile({ values: VALUES });
    assert.deepEqual(notes, []);
    assert.deepEqual(written, Object.keys(VALUES).sort());
    assert.deepEqual(env.parseEnvFile(text), VALUES);
  });

  test('a value no form can carry is left out with a comment, never written wrong', () => {
    assert.equal(env.encodeEnvValue('ends \\'), null);
    const { text, written } = env.renderEnvFile({ values: { OK: 'x', BAD: 'ends \\' } });
    assert.deepEqual(written, ['OK']);
    assert.match(text, /^# BAD: its value cannot be written/m);
  });

  test('server text in a comment stays on one line', () => {
    const { text } = env.renderEnvFile({ values: { A: '1' }, withheld: [{ key: 'X', reason: 'r', why: 'one\nEVIL=1' }] });
    assert.ok(!/^EVIL=/m.test(text));
    assert.deepEqual(Object.keys(env.parseEnvFile(text)), ['A']);
  });
});

describe('Push Env saves development values only', () => {
  test('tier development, and keys for staging or production are left out', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-env-'));
    await fs.writeFile(path.join(dir, '.env.local'), "SITE_NAME='Acme shop'\nAPI_URL=https://x.test\nSENTRY_DSN_PROD=nope\nFLAG_STAGING=nope\n");
    const seen = [];
    const client = { async callToolJson(name, args) { seen.push({ name, args }); return { ok: true }; } };
    await env.pushEnv(await scmIn(dir), async () => client);
    assert.deepEqual(seen, [
      {
        name: 'project_secrets_set',
        args: { project_id: PROJECT, secrets: { SITE_NAME: 'Acme shop', API_URL: 'https://x.test' }, apply_to_preview: true, tier: 'development' },
      },
    ]);
  });
});

describe('names only everywhere else', () => {
  const NAMES = {
    success: true,
    keys: ['API_URL', 'STRIPE_SECRET_KEY'],
    count: 2,
    sensitive_keys: ['STRIPE_SECRET_KEY'],
    variables: [
      { key: 'API_URL', stored_keys: ['API_URL', 'API_URL_DEV'], tiers: ['preview', 'development', 'staging', 'production'], sensitive: false, managed: false },
      { key: 'STRIPE_SECRET_KEY', stored_keys: ['STRIPE_SECRET_KEY'], tiers: ['production'], sensitive: true, managed: false },
    ],
  };

  test('the Secrets module asks with metadata_only and its rows carry no value', () => {
    const sections = [...modules.MODULES, modules.PROJECT_MODULE].flatMap((m) => m.sections ?? []);
    const secrets = sections.find((s) => s.id === 'secrets' && s.tool === 'project_secrets_list');
    assert.ok(secrets, 'could not find the Secrets section');
    assert.deepEqual(secrets.args, { metadata_only: true });
    const rows = secrets.transform({ data: NAMES });
    assert.deepEqual(rows, [
      { key: 'API_URL', tiers: 'preview, development, staging, production', flags: '' },
      { key: 'STRIPE_SECRET_KEY', tiers: 'production', flags: 'sensitive' },
    ]);
  });

  test('the env document lists names, is read-only, and refuses a save before any request', async () => {
    const seen = [];
    const client = { async callToolJson(name, args) { seen.push({ name, args }); return NAMES; } };
    const provider = new platformFs.HivekuFileSystem(async () => client, () => 'https://app.example.test');
    const uri = platformFs.envUri(ACCOUNT, PROJECT, 'Acme');
    const text = new TextDecoder().decode(await provider.readFile(uri));
    assert.deepEqual(seen, [{ name: 'project_secrets_list', args: { project_id: PROJECT, metadata_only: true } }]);
    assert.match(text, /^API_URL {4}# reaches preview, development, staging, production; stored as API_URL, API_URL_DEV$/m);
    assert.match(text, /^STRIPE_SECRET_KEY {4}# reaches production; sensitive: write-only$/m);
    assert.ok(!/=/.test(text.split('\n').filter((l) => !l.startsWith('#')).join('\n')), 'no KEY=value line');
    assert.equal(provider.stat(uri).permissions, vscodeStub.FilePermission.Readonly);
    await assert.rejects(provider.writeFile(uri, new TextEncoder().encode('API_URL=changed\n')), (err) => err.code === 'NoPermissions');
    assert.equal(seen.length, 1, 'the save made no request');
  });

  test('Manage Secrets lists names with where they reach, never a value or a mask', async () => {
    const seen = [];
    const client = { async callToolJson(name, args) { seen.push({ name, args }); return NAMES; } };
    let shown;
    vscodeStub.window.showQuickPick = (items) => { shown = items; return Promise.resolve(undefined); };
    await resources.manageSecrets(await scmIn(os.tmpdir()), async () => client);
    assert.deepEqual(seen, [{ name: 'project_secrets_list', args: { project_id: PROJECT, metadata_only: true } }]);
    const keys = shown.filter((i) => i.action === 'key');
    assert.deepEqual(keys.map((i) => [i.key, i.description]), [
      ['API_URL', 'preview, development, staging, production'],
      ['STRIPE_SECRET_KEY', 'production · sensitive'],
    ]);
    assert.ok(!JSON.stringify(shown).includes('••••'));
  });

  test('nothing in the extension calls project_secrets_list without metadata_only', () => {
    const src = path.join(ROOT, 'src');
    const offenders = [];
    for (const f of readdirSync(src).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(path.join(src, f), 'utf8');
      for (const m of text.matchAll(/callToolJson<[^>]*>\('project_secrets_list',([^)]*)\)/g)) {
        if (!/metadata_only: true/.test(m[1])) offenders.push(`${f}: ${m[0].slice(0, 120)}`);
      }
      if (/tool: 'project_secrets_list'/.test(text) && !/tool: 'project_secrets_list', args: \{ metadata_only: true \}/.test(text)) offenders.push(`${f}: a module section without metadata_only`);
    }
    assert.deepEqual(offenders, []);
    // The value helpers are gone.
    for (const gone of ['secretsMap', 'secretsMapWithSensitive', 'secretsList', 'maskSecret']) assert.equal(api[gone], undefined, gone);
  });
});

describe('the declaration', () => {
  // The builder's DECLARED_RE (hiveku_builder src/lib/secrets/reveal-client.ts), character for character.
  const BUILDER_DECLARED_RE = /^([a-z][a-z0-9-]{0,39})\/(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,5})$/;

  test('the .mcp.json for Claude Code declares vscode-extension/<package.json version>', () => {
    const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const entry = knowledge.hivekuMcpServer('olp_test_key_123', 'https://core.hiveku.com');
    assert.equal(entry.headers['X-Hiveku-Client'], `vscode-extension/${version}`);
    assert.match(entry.headers['X-Hiveku-Client'], BUILDER_DECLARED_RE);
  });

  test('the ask rules it rests on reach every folder: reveal and hiveku_batch ask', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-ask-'));
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fs.writeFile(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: {} }));
    const added = await knowledge.ensureSpendAskRules(dir);
    assert.ok(added.includes('mcp__hiveku__project_secrets_reveal'));
    assert.ok(added.includes('mcp__hiveku__hiveku_batch'));
  });

  test('the extension\'s own calls and the Codex config do not declare', () => {
    const mcpClient = readFileSync(path.join(ROOT, 'src', 'mcpClient.ts'), 'utf8');
    assert.match(mcpClient, /'X-Hiveku-Client': 'vscode-extension',/);
    const codex = readFileSync(path.join(ROOT, 'src', 'codex.ts'), 'utf8');
    assert.match(codex, /"X-Hiveku-Client" = "codex"/);
  });
});
