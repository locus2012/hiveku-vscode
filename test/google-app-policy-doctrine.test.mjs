/**
 * Hiveku's Google app policy (2026-09-27), as this extension teaches it.
 *
 * The only Google app an account may own is its internal Gmail app. Every other
 * Google product (Google Ads, Analytics and the Tag Manager that rides on it,
 * Search Console, Business Profile, Calendar) runs on Hiveku's own Google app
 * and, for Google Ads, Hiveku's developer token. The builder refuses an own app
 * for those products (400 google_own_app_not_allowed) and a Google Ads developer
 * token (400 developer_token_not_allowed), and moves a connection still on an
 * own app with a reconnect link that names oauth_app_id 'platform'.
 *
 * The extension's own texts still taught the old way: each department's
 * SETUP.md (src/deptData.ts, src/setupPlaybooks.ts, and src/dept-manifest.json,
 * which the Claude Code plugin mirrors) walked the user through a Google Cloud
 * project and oauth_app_create for Google Ads, Search Console and Business
 * Profile and asked for a developer token; the "Copy setup prompt" texts
 * (src/setupPrompts.ts) did the same; /hiveku-connect (src/roleCommands.ts) and
 * the account CLAUDE.md (src/knowledge.ts) sent agents to a shared Google client
 * with GOOGLE_ADS_DEVELOPER_TOKEN; and the vendored skills (assets/, copied from
 * the plugin) predated plugin 0.27.4. "Hiveku: Set Up Codex Support" mirrors
 * /hiveku-connect and the vendored skills into .agents/skills/, so the Codex
 * lane carried all of it too.
 *
 * These pins keep:
 *   - no text an agent reads offering an own Google app, own Google client
 *     credentials or a developer token for a Google product other than Gmail,
 *     unless the sentence says it is refused (positive controls below prove
 *     each old wording is caught);
 *   - the connect texts naming both refusals and the move;
 *   - Microsoft Ads and Gmail keeping their own apps;
 *   - every 'unverified app' screen tied to Google Ads;
 *   - wherever hiveku_native false means an own app, Google Business Profile
 *     named as the exception.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const knowledge = loadOut('knowledge');
const { ROLES } = loadOut('roles');
const { DEPARTMENTS } = loadOut('deptData');
const { SETUP_PROMPTS } = loadOut('setupPrompts');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const KEY = 'olp_test_key_123';
const BASE = 'https://core.hiveku.com';
const RECORD = { accountId: ACCOUNT, label: 'Western Stairlifts' };

/** Collapse whitespace and drop backticks so a pinned phrase may wrap and carry code marks. */
const flat = (s) => s.replace(/`/g, '').replace(/\s+/g, ' ');

/**
 * The old offers. Each is a way a text sent an agent to an own Google app, own
 * Google client credentials, or a developer token for a Google product other
 * than Gmail. The first group is the plugin's own list
 * (hiveku-claude-plugin/test/google-app-policy-doctrine.test.mjs); the second
 * is this extension's.
 */
const OLD_OFFERS = [
  /google_ads (?:create )?with the account's OWN Google app/i,
  /google_ads needs developer_token/i,
  /developer_token \(BYOK/i,
  /\bG(?:SC|BP) (?:as|by) BYOK\b/i,
  /google_search_console: \{ platform, site_url, client_id/i,
  /google_business_profile: \{ platform, client_id/i,
  /Each Google source needs a per-account OAuth app/i,
  /call ppc_connection_update with \{\s*developer_token/i,
  /The call needs a developer_token and returns 412/i,
  /A 412 with a hint means no developer token/i,
  /For Google Ads, prefer integration_oauth_initiate over BYOK/i,
  /Nothing connected: ppc_connection_create builds a BYOK connection/i,
  /seo_connection_create \(BYOK/i,
  /seo_connection_create per the BYOK arguments/i,
  /\[CONFIRM, BYOK\]/,
  /BYOK credentials; GSC needs/i,
  /platform: 'google_search_console', site_url, client_id/i,

  // oauth_app_create for a Google product other than Gmail.
  /oauth_app_create\(\{[^{}]*provider: ['"]google['"][^{}]*products: ?\[\s*['"]?(?:google_ads|google_search_console|google_business_profile|google_analytics|google_calendar_meet)\b/i,
  // A tool call that carries a developer token.
  /\(\{[^{}]*\bdeveloper_token\b[^{}]*\}\)/,
  // Where to fetch one: the MCC's API Center.
  /\bdeveloper_token\b[^.]{0,60}\bAPI Center\b/i,
  /(?<!never )ask (?:me|the user|them|anyone) for (?:a |the |their )?developer[_ ]token/i,
  /needs developer_token set/i,
  // The shared agency Google client.
  /GOOGLE_ADS_(?:CLIENT_ID|CLIENT_SECRET|DEVELOPER_TOKEN)/,
  /One Google client can back/i,
  /customer_id \/ manager_id \/ developer_token/i,
  /provider "google" for google_\*/i,
  // Google Cloud Console work for a product that runs on Hiveku's app.
  /the Google OAuth app \(BYOK\)/i,
  /register our own Google OAuth client/i,
  /a Google Cloud "Web application" OAuth/i,
  /Google Ads \/ Search Console API enabled/i,
  /enable the (?:\*\*)?(?:Google Ads|Search Console|Business Profile|Tag Manager|Google Analytics(?: Admin| Data)?) API\b/i,
  /Tag Manager API enabled/i,
  // A Google SEO source created by hand.
  /seo_connection_create\(\{[^{}]*\bgoogle_(?:search_console|business_profile)\b/,
  /Google Ads connects via integration_oauth_initiate/i,
];

/** add_products: ['google_analytics'] (or another Google product but Gmail) not stated as refused. */
const EXTEND_GOOGLE_APP = /add_products: \[\s*'(?:google_analytics|google_ads|google_search_console|google_business_profile)'/g;

function offersIn(text) {
  const t = flat(text);
  const hits = OLD_OFFERS.filter((re) => re.test(t)).map(String);
  for (const m of t.matchAll(EXTEND_GOOGLE_APP)) {
    const before = t.slice(Math.max(0, m.index - 80), m.index);
    if (!/refuse|never/i.test(before)) hits.push(`extends an own Google app: ${m[0]}`);
  }
  return hits;
}

/** Every regular file under `dir` whose name ends in .md, as absolute paths. */
function walkMd(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMd(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** The vendored skills and commands (copied from the plugin by npm run gen:skills). */
const ASSETS = walkMd(path.join(root, 'assets')).map((file) => ({
  where: path.relative(root, file),
  text: readFileSync(file, 'utf8'),
}));

/** Each department's SETUP.md and crud text, from the registry and from the manifest the plugin mirrors. */
const MANIFEST = JSON.parse(readFileSync(path.join(root, 'src', 'dept-manifest.json'), 'utf8'));
const DEPT_TEXTS = [
  ...DEPARTMENTS.flatMap((d) => [
    ...(d.setup ? [{ where: `deptData ${d.id}.setup`, text: d.setup }] : []),
    ...(d.crud ? [{ where: `deptData ${d.id}.crud`, text: d.crud }] : []),
  ]),
  ...MANIFEST.departments.flatMap((d) => [
    ...(d.setup ? [{ where: `dept-manifest.json ${d.id}.setup`, text: d.setup }] : []),
    ...(d.crud ? [{ where: `dept-manifest.json ${d.id}.crud`, text: d.crud }] : []),
  ]),
];

/** Every "Copy setup prompt" text, built for one account. */
const PROMPTS = SETUP_PROMPTS.map((p) => ({ where: `setup prompt ${p.id}`, id: p.id, text: p.build(RECORD) }));

/** Every markdown file a scaffolded account folder gives an agent, Codex on, per role. */
const scaffolds = new Map();
const tmpDirs = [];

async function agentFiles(dir) {
  const files = [];
  for (const sub of ['.claude', '.agents']) files.push(...walkMd(path.join(dir, sub)));
  for (const top of ['CLAUDE.md', 'AGENTS.md']) {
    if (existsSync(path.join(dir, top))) files.push(path.join(dir, top));
  }
  return Promise.all(files.map(async (file) => ({ where: path.relative(dir, file), text: await fs.readFile(file, 'utf8') })));
}

before(async () => {
  knowledge.setCodexSupport(true);
  for (const role of [undefined, ...ROLES.map((r) => r.id)]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-google-policy-'));
    tmpDirs.push(dir);
    await knowledge.writeScaffold({ baseDir: dir, accountLabel: RECORD.label, apiKey: KEY, baseUrl: BASE, role, accountId: ACCOUNT });
    scaffolds.set(role ?? '(none)', { dir, files: await agentFiles(dir) });
  }
});

after(async () => {
  knowledge.setCodexSupport(false);
  for (const dir of tmpDirs) await fs.rm(dir, { recursive: true, force: true });
});

const allTexts = () => [
  ...ASSETS,
  ...DEPT_TEXTS,
  ...PROMPTS,
  ...[...scaffolds].flatMap(([role, s]) => s.files.map((f) => ({ where: `scaffold (${role}) ${f.where}`, text: f.text }))),
];

describe('no text offers an own Google app, own Google credentials or a developer token (Gmail aside)', () => {
  test('the vendored skills and commands', () => {
    assert.ok(ASSETS.length > 100, `expected the vendored assets, found ${ASSETS.length} files`);
    assert.deepEqual(ASSETS.flatMap((s) => offersIn(s.text).map((h) => `${s.where}: ${h}`)), []);
  });

  test("each department's SETUP.md and crud text, in the registry and in the mirrored manifest", () => {
    assert.ok(DEPT_TEXTS.length > 40, `expected the department texts, found ${DEPT_TEXTS.length}`);
    assert.deepEqual(DEPT_TEXTS.flatMap((s) => offersIn(s.text).map((h) => `${s.where}: ${h}`)), []);
  });

  test('every "Copy setup prompt" text', () => {
    assert.ok(PROMPTS.length >= 5);
    assert.deepEqual(PROMPTS.flatMap((s) => offersIn(s.text).map((h) => `${s.where}: ${h}`)), []);
  });

  test('every file a scaffolded account folder gives an agent, per role, with the Codex mirror', () => {
    for (const [role, s] of scaffolds) {
      assert.ok(s.files.some((f) => f.where === 'CLAUDE.md'), `role ${role}: no CLAUDE.md`);
      assert.ok(s.files.some((f) => f.where === path.join('.agents', 'skills', 'hiveku-connect', 'SKILL.md')), `role ${role}: no Codex mirror of /hiveku-connect`);
      assert.deepEqual(s.files.flatMap((f) => offersIn(f.text).map((h) => `role ${role} ${f.where}: ${h}`)), []);
    }
  });
});

test('flags each old wording (positive controls)', () => {
  for (const old of [
    // The plugin's (commands/connect-integration.md, commands/integrations.md, the SEO references).
    "- `google_ads` create with the account's OWN Google app: `developer_token` and `customer_id` up\n  front (the server refuses without them).",
    'Each Google source needs a per-account OAuth app (BYOK) — same pattern as Google Ads.',
    "- google_search_console: `{ platform, site_url, client_id, client_secret, refresh_token }`",
    // src/deptData.ts PPC_SETUP and LOCALSEO_SETUP, and the localseo crud.
    "Then: \`oauth_app_create({ provider: 'google', name: '<acct> Google Ads', client_id, client_secret, products: ['google_ads'] })\`.",
    'From the user: **developer_token** (their Google Ads MCC → Tools & Settings → API Center — required for EVERY',
    "1. \`integration_oauth_initiate({ provider_slug: 'google_ads', customer_id, manager_id?, developer_token })\`",
    '2. \`ppc_ads_discover_customers({ id: connection_id })\` → accessible customer IDs (needs developer_token set; 412 if missing).',
    "then: \`oauth_app_create({ provider: 'google', name, client_id, client_secret, products: ['google_search_console'] })\`",
    'CONNECT a source: `seo_connection_create({ platform: "bing_webmaster"|"google_search_console"|"google_business_profile", site_url, ... })` ',
    // src/setupPlaybooks.ts SEO_SETUP.
    '## STEP 0 (once per account) — the Google OAuth app (BYOK)',
    // src/setupPrompts.ts.
    "If the 'google_ads' connector is ready (client.would_use is 'hiveku' or 'byok'), skip to step 2 — no Google Cloud work is needed. Only if it is NOT ready, help me register our own Google OAuth client:",
    '- In Google Cloud Console: create/pick a project, enable the Search Console API, configure the OAuth consent screen',
    "2. Only if the connector uses our OWN Google app (client.would_use 'byok'): ask me for developer_token (from my Google Ads MCC → Tools & Settings → API Center)",
    "Call integration_connect_link_create({ connector: 'google_ads', source: 'vscode', customer_id, manager_id, developer_token (only when collected) })",
    // src/roleCommands.ts /hiveku-connect.
    'GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN / MICROSOFT_ADS_CLIENT_ID /',
    'client (provider "google" for google_* ; "microsoft" for microsoft_ads). One Google client can back',
    'First Google Ads connect: add customer_id / manager_id / developer_token from the\n     shared file.',
    '1. ONE-TIME cloud app (per provider, reused for ALL accounts): a Google Cloud "Web application" OAuth',
    'client (on Workspace, set it INTERNAL so tokens never expire), the Google Ads / Search Console API\n     enabled,',
    // src/knowledge.ts CLAUDE.md.
    'GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN (from your agency MCC API',
    'it has the exact step-by-step (Google Ads connects via \`integration_oauth_initiate\` end-to-end;',
    // The Tag Manager fix on an own app.
    "Fix with `oauth_app_update({ oauth_app_id, add_products:\n   ['google_analytics'] })` - use `add_products`, which merges.",
    'the customer\'s Google Cloud project must have the **Tag\nManager API enabled**',
  ]) {
    assert.ok(offersIn(old).length > 0, `not flagged: ${old}`);
  }
  // The new wording states the refusal, and is not flagged.
  for (const ok of [
    "`oauth_app_update` refuses\n   `add_products: ['google_analytics']` with 400 `google_own_app_not_allowed`",
    'never ask anyone for a developer token',
    'never ask me for a developer token',
    'never ask for or pass a developer token, a client id, a client secret or a refresh token',
    "`oauth_app_create({ provider: 'microsoft', name, client_id, client_secret, products: ['microsoft_ads'] })`",
    "`seo_connection_create({ platform: 'bing_webmaster', site_url, api_key })`",
  ]) {
    assert.deepEqual(offersIn(ok), [], ok);
  }
});

describe('the connect texts name both refusals and the move', () => {
  const POLICY = ['google_own_app_not_allowed', 'developer_token_not_allowed', "oauth_app_id: 'platform'", "Hiveku's own Google app"];

  test('/hiveku-connect, and its Codex mirror', () => {
    const { files } = scaffolds.get('(none)');
    for (const where of [path.join('.claude', 'commands', 'hiveku-connect.md'), path.join('.agents', 'skills', 'hiveku-connect', 'SKILL.md')]) {
      const file = files.find((f) => f.where === where);
      assert.ok(file, `${where} was not written`);
      const t = flat(file.text);
      for (const phrase of POLICY) assert.ok(t.includes(phrase), `${where} does not say ${phrase}`);
      assert.ok(t.includes("integration_connect_link_create({ connector, source: 'vscode' })"), `${where} does not mint the connect link`);
      assert.ok(t.includes('The only Google app an account may own is its internal Gmail app.'), where);
    }
  });

  test('the account CLAUDE.md', () => {
    for (const [role, s] of scaffolds) {
      const t = flat(s.files.find((f) => f.where === 'CLAUDE.md').text);
      for (const phrase of POLICY) assert.ok(t.includes(phrase), `role ${role}: CLAUDE.md does not say ${phrase}`);
    }
  });

  test('the Google Ads, Search Console and Local SEO SETUP.md', () => {
    const setup = (id) => flat(DEPARTMENTS.find((d) => d.id === id).setup);
    const ppc = setup('ppc');
    for (const phrase of POLICY) assert.ok(ppc.includes(phrase), `ppc SETUP.md does not say ${phrase}`);
    assert.ok(ppc.includes("integration_connect_link_create({ connector: 'google_ads', source: 'vscode' })"));
    assert.ok(ppc.includes('developer_token_missing'), 'ppc SETUP.md does not say what a 412 from discovery means');
    for (const id of ['seo', 'localseo']) {
      const t = setup(id);
      for (const phrase of ['google_own_app_not_allowed', "oauth_app_id: 'platform'", "Hiveku's own Google app", 'hiveku_report_issue']) {
        assert.ok(t.includes(phrase), `${id} SETUP.md does not say ${phrase}`);
      }
      assert.ok(t.includes("integration_connect_link_create({ connector: 'google_search_console', source: 'vscode' })"), id);
    }
    assert.ok(setup('localseo').includes("integration_connect_link_create({ connector: 'google_business_profile', source: 'vscode' })"));
  });

  test('the Google "Copy setup prompt" texts connect with a link and collect nothing', () => {
    for (const id of ['google_ads', 'google_search_console', 'google_business_profile']) {
      const t = flat(PROMPTS.find((p) => p.id === id).text);
      for (const phrase of POLICY) assert.ok(t.includes(phrase), `${id} prompt does not say ${phrase}`);
      assert.ok(t.includes(`integration_connect_link_create({ connector: '${id}'`), `${id} prompt does not mint the link`);
      assert.ok(!t.includes('oauth_app_create({'), `${id} prompt still registers an app`);
      assert.ok(!/Google Cloud Console/i.test(t), `${id} prompt still sends the user into Google Cloud Console`);
    }
    assert.ok(!/developer token/i.test(SETUP_PROMPTS.find((p) => p.id === 'google_ads').blurb), 'the Google Ads blurb still names a developer token');
  });
});

describe('the providers that keep their own apps still do', () => {
  test('Microsoft Ads keeps its own Azure app, and Gmail its internal Google app', () => {
    const microsoft = flat(PROMPTS.find((p) => p.id === 'microsoft_ads').text);
    assert.ok(microsoft.includes("oauth_app_create({ provider: 'microsoft', name: 'Microsoft Ads app', client_id, client_secret, products: ['microsoft_ads'] })"));
    const ppc = flat(DEPARTMENTS.find((d) => d.id === 'ppc').setup);
    assert.ok(ppc.includes("oauth_app_create({ provider: 'microsoft', name, client_id, client_secret, products: ['microsoft_ads'] })"));
    const crm = flat(DEPARTMENTS.find((d) => d.id === 'crm').setup);
    assert.ok(crm.includes("a Google OAuth app with product 'crm_email_calendar'"), 'the CRM inbox no longer names its Gmail app');
    const connect = flat(scaffolds.get('(none)').files.find((f) => f.where === path.join('.claude', 'commands', 'hiveku-connect.md')).text);
    assert.ok(connect.includes('MICROSOFT_ADS_CLIENT_ID / MICROSOFT_ADS_CLIENT_SECRET'));
    assert.ok(connect.includes('crm_email_calendar'));
  });
});

test("every 'unverified app' screen is tied to Google Ads", () => {
  const loose = [];
  for (const s of allTexts()) {
    const t = flat(s.text);
    for (const m of t.matchAll(/unverified app'? screen/gi)) {
      if (!t.slice(Math.max(0, m.index - 80), m.index).includes('Google Ads')) loose.push(`${s.where} @${m.index}`);
    }
  }
  assert.deepEqual(loose, []);
});

test('wherever hiveku_native false means an own app, Google Business Profile is named as the exception', () => {
  const missing = [];
  let seen = 0;
  for (const s of allTexts()) {
    const t = flat(s.text);
    for (const m of t.matchAll(/hiveku_native: false means|false means the customer must register their own app/g)) {
      seen += 1;
      if (!t.slice(Math.max(0, m.index - 200), m.index + 400).includes('Google Business Profile')) missing.push(`${s.where} @${m.index}`);
    }
  }
  assert.ok(seen > 0, 'no text says what hiveku_native false means');
  assert.deepEqual(missing, []);
});
