/**
 * Prove every tool the department registry names actually exists on the MCP server.
 *
 * WHY THIS EXISTS. src/dept-manifest.json (and its byte-identical mirror in
 * hiveku-claude-plugin/lib/dept-manifest.json) is the projection of DEPARTMENTS
 * in src/deptData.ts. It names MCP tools in four places: each dataset's `tool`,
 * each scope step's `parentTool`, each reference's `tool`, and the backticked
 * names inside the `crud` and `setup` prose that the assistant reads verbatim
 * before touching an account. check-dept-manifest-drift.mjs proves the two
 * copies agree with EACH OTHER; nothing proved either of them agreed with the
 * SERVER. A tool renamed or removed in hiveku-mcp-api-server left both copies
 * consistent, green, and wrong: a dataset pull that fails with "unknown tool",
 * or first-run guidance that walks the assistant into a name that no longer
 * exists. The email department is the live case (plan OPS-11): its setup text
 * was rewritten in 2026-09 to name the readiness gates (`marketing_setup_status`,
 * `email_domain_check_dns`, `email_audience_preview`, the send ladder) and the
 * only thing that would notice those names going stale is this check.
 *
 * WHAT IT READS. The server's tool declarations, preferring the compiled
 * hiveku-mcp-api-server/dist (what a Render deploy actually serves) and falling
 * back to src/tools/*.ts. Both are parsed with the same line-anchored name regex
 * gen-tool-index.mjs uses, for the reason it documents: a loose /name:\s*'…'/
 * also matches `pathParams: { name: 'name' }` inside a real tool and invents a
 * phantom. The DataForSEO tools are registered at runtime from class methods
 * (`getName() { return '…'; }`) and are invisible to that regex, so those are
 * read from dist/modules (src/modules) too - otherwise every `backlinks_*`
 * reference would be reported missing on a healthy tree.
 *
 * WHAT COUNTS AS A TOOL NAME IN PROSE. A backticked token is a tool reference
 * when it is a bare snake_case identifier (optionally followed by an argument
 * list) whose first segment is a prefix some declared tool uses. That excludes
 * argument names (`filter_json`, `dry_run`), refusal codes (`domain_unverified`)
 * and dataset/file names, all of which the prose also backticks. Shorthand
 * continuations like `email_campaign_create` / `_update` / `_pause` resolve
 * against the nearest preceding full name by trying every prefix of it, longest
 * first (`email_campaign_test_send` / `_resend_non_openers` has to become
 * `email_campaign_resend_non_openers`, not `email_campaign_test_resend_non_openers`).
 *
 * KNOWN_NOT_TOOLS below is a baseline of identifiers that look like tools by the
 * prefix rule but are table names, dataset ids or column names. It is checked in
 * both directions: an entry that starts resolving to a real tool is a stale
 * baseline and fails, so the list cannot rot into cover for a growing problem.
 *
 * Exit codes: 0 ok / skipped (sibling MCP checkout absent), 1 unknown or missing
 * names, 2 could not read the manifest.
 *
 * Usage: node scripts/check-dept-manifest-tools.mjs [--verbose]
 * Override the server checkout with HIVEKU_MCP_PATH.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(here, '..', 'src', 'dept-manifest.json');
const MCP_ROOT =
  process.env.HIVEKU_MCP_PATH || join(here, '..', '..', 'hiveku-mcp-api-server');
const VERBOSE = process.argv.includes('--verbose');

/**
 * The gates the email first-run guidance is built on (plan OPS-11). The
 * department's setup + crud text must name every one of these: they are the
 * readiness checks, the consent-count dry run, the test-send rung, the in-flight
 * hold, and the metrics read that the send ladder depends on. Dropping one from
 * the prose is a silent regression of the ladder, not a wording change.
 */
const REQUIRED_BY_DEPARTMENT = {
  email: [
    'marketing_setup_status',
    'email_domain_check_dns',
    'marketing_mailing_address_set',
    'email_audience_preview',
    'email_campaign_send_now',
    'email_campaign_test_send',
    'email_campaign_pause',
    'email_campaign_resume',
    'email_campaign_metrics',
  ],
};

/**
 * Backticked identifiers that are never tools whatever their prefix: arguments
 * and response fields. `project_id`, `media_urls`, `oauth_app_id`, `job_title`
 * all start with a segment some tool uses, and the prose backticks hundreds of
 * them. Checked on the LAST segment only.
 */
const FIELD_SUFFIXES = new Set([
  'id', 'ids', 'url', 'urls', 'type', 'types', 'at', 'json', 'cents', 'key', 'secret',
  'name', 'title', 'count', 'domain', 'email', 'token', 'enabled', 'status_code',
]);

/**
 * Identifiers the prose backticks that pass the prefix rule and are not caught
 * by FIELD_SUFFIXES, yet are not tools. Each is one of: a database table, a
 * dataset or local file the pull writes, a refusal code, an enum value
 * (`admin_action`, `intent_type`, `provider`), or a response field. A BASELINE,
 * not an allowlist: adding here is a deliberate act with the reason beside it,
 * and the check fails if an entry starts resolving to a real tool so the list
 * cannot rot into cover for a growing problem.
 */
const KNOWN_NOT_TOOLS = new Set([
  // Database tables named in the prose ("a `workflow_triggers` row").
  'workflow_triggers',
  'account_integrations',
  'cold_email_integrations',
  // Dataset ids / the <dataset>.json files the local pull writes.
  'crm_activities',
  'crm_companies',
  'email_webhooks',
  'ppc_connections',
  'accounting_vendors',
  // Refusal / error codes relayed verbatim to the operator.
  'domain_unverified',
  'email_service_suspended',
  'integration_inactive',
  'integration_missing_key',
  // Enum values: shopify_admin's admin_action, shopify_connect_start's intent_type,
  // oauth_app provider/product slugs, social target_platforms.
  'create_product_draft',
  'get_shop',
  'list_installed_apps',
  'list_orders',
  'list_products',
  'shopify_account_connect',
  'shopify_project_connect',
  'shopify_reconnect',
  'shopify_storefront',
  'google_ads',
  'google_business_profile',
  'google_search_console',
  // Arguments and response fields FIELD_SUFFIXES does not reach.
  'on_duplicate',
  'brand_applied',
]);

/**
 * Same declaration grammar as hiveku-claude-plugin/scripts/gen-tool-index.mjs:
 * `name: '…',` alone on its line (TS/compiled JS) or its pasted-JSON twin
 * `"name": "…",`. Line-anchored on purpose - see the header.
 */
const NAME_LINE = /^[ \t]*(?:name:\s*'([a-z0-9_]+)'|"name":\s*"([a-z0-9_]+)"),[ \t]*$/gm;

/** Runtime-registered modules: `getName() { return 'backlinks_anchors'; }` (or `(): string {` in TS). */
const GET_NAME = /getName\(\)(?::\s*string)?\s*\{\s*return\s+'([a-z0-9_]+)'/g;

/** iCloud leaves "foo 2.js" twins beside the real file; they are never the source of truth. */
const isIcloudTwin = (name) => / \d+(\.|$)/.test(name);

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (isIcloudTwin(entry) || entry === 'node_modules' || entry === '__tests__') continue;
    if (statSync(full).isDirectory()) walk(full, filter, out);
    else if (filter(entry)) out.push(full);
  }
  return out;
}

/** Returns { names: Set, source: string } or null when neither dist nor src is on disk. */
function loadDeclaredTools() {
  const candidates = [
    { dir: 'dist', ext: '.js', label: 'dist' },
    { dir: 'src', ext: '.ts', label: 'src (compiled dist absent)' },
  ];
  for (const { dir, ext, label } of candidates) {
    const toolsDir = join(MCP_ROOT, dir, 'tools');
    if (!existsSync(toolsDir)) continue;
    const names = new Set();
    const toolFiles = readdirSync(toolsDir)
      .filter((f) => f.endsWith(ext) && !f.includes('.test.') && !isIcloudTwin(f))
      .map((f) => join(toolsDir, f));
    for (const file of toolFiles) {
      for (const match of readFileSync(file, 'utf8').matchAll(NAME_LINE)) {
        names.add(match[1] ?? match[2]);
      }
    }
    const moduleFiles = walk(join(MCP_ROOT, dir, 'modules'), (f) => f.endsWith(`.tool${ext}`));
    for (const file of moduleFiles) {
      for (const match of readFileSync(file, 'utf8').matchAll(GET_NAME)) names.add(match[1]);
    }
    return { names, source: `${label}: ${toolFiles.length} tool files, ${moduleFiles.length} runtime modules` };
  }
  return null;
}

/**
 * Collect every tool reference in the manifest, keyed by name, with the places
 * that use it. Prose references are resolved against the declared set so a
 * shorthand `_update` lands on the right full name.
 */
function collectReferences(manifest, declared) {
  const prefixes = new Set([...declared].map((n) => n.split('_')[0]));
  const refs = new Map();
  const ignoredProse = new Map();
  const note = (map, name, where) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(where);
  };

  const isField = (ident) => FIELD_SUFFIXES.has(ident.slice(ident.lastIndexOf('_') + 1));

  /**
   * `email_campaign_create` / `_update` / `_pause`: resolve a shorthand against
   * the full names seen so far in this prose, nearest first, trying every prefix
   * of each (longest first). Nearest-first matters because a parenthetical can
   * interrupt a chain: "`_send_reply` (render a macro first with
   * `helpdesk_macros_render`) / `_escalate_to_human`" belongs to the ticket
   * family, not the macros one.
   */
  const resolveShorthand = (suffix, fullNames) => {
    for (let i = fullNames.length - 1; i >= 0; i--) {
      const parts = fullNames[i].split('_');
      for (let keep = parts.length - 1; keep >= 1; keep--) {
        const candidate = `${parts.slice(0, keep).join('_')}${suffix}`;
        if (declared.has(candidate)) return candidate;
      }
    }
    return null;
  };

  const scanProse = (text, where) => {
    const fullNames = [];
    for (const match of text.matchAll(/`([^`]+)`/g)) {
      const token = match[1].match(/^(_?[a-z][a-z0-9]*(?:_[a-z0-9]+)*)(?:\(.*)?$/s);
      if (!token) continue;
      const ident = token[1];
      if (ident.startsWith('_')) {
        // Only a `/`-chained continuation is shorthand; "tagged `_parent`" is a field.
        const before = text.slice(0, match.index).trimEnd();
        if (!before.endsWith('/')) { note(ignoredProse, ident, `${where} (not in a / chain)`); continue; }
        const nearest = fullNames[fullNames.length - 1];
        if (!nearest) { note(refs, ident, `${where} (shorthand with no preceding full name)`); continue; }
        const resolved = resolveShorthand(ident, fullNames);
        if (resolved) { note(refs, resolved, where); fullNames.push(resolved); }
        else note(refs, `${nearest.split('_').slice(0, -1).join('_')}${ident}`, `${where} (shorthand ${ident} after ${nearest}; no declared tool matches)`);
        continue;
      }
      if (!ident.includes('_') || !prefixes.has(ident.split('_')[0])) {
        if (ident.includes('_')) note(ignoredProse, ident, where);
        continue;
      }
      if (KNOWN_NOT_TOOLS.has(ident)) { note(ignoredProse, ident, `${where} (baseline)`); continue; }
      if (!declared.has(ident) && isField(ident)) { note(ignoredProse, ident, `${where} (field suffix)`); continue; }
      note(refs, ident, where);
      fullNames.push(ident);
    }
  };

  for (const dept of manifest.departments ?? []) {
    for (const dataset of dept.datasets ?? []) {
      note(refs, dataset.tool, `${dept.id}/${dataset.id}.tool`);
      for (const step of dataset.scope ?? []) {
        if (step?.parentTool) note(refs, step.parentTool, `${dept.id}/${dataset.id}.scope.parentTool`);
      }
    }
    for (const reference of dept.references ?? []) {
      note(refs, reference.tool, `${dept.id}.references/${reference.id}`);
    }
    if (dept.crud) scanProse(dept.crud, `${dept.id}.crud`);
    if (dept.setup) scanProse(dept.setup, `${dept.id}.setup`);
  }
  return { refs, ignoredProse };
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch (error) {
  console.error(`FAIL: cannot read ${MANIFEST}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const declaredInfo = loadDeclaredTools();
if (!declaredInfo) {
  // A missing sibling checkout is not a failure - this has to pass for a repo
  // cloned on its own. It is a SKIP and says so, never a silent green.
  console.log(`SKIP: hiveku-mcp-api-server not found at ${MCP_ROOT} (sibling checkout absent) - tool names not verified`);
  process.exit(0);
}
const { names: declared, source } = declaredInfo;
if (declared.size < 500) {
  console.error(`FAIL: only ${declared.size} tool declarations parsed from ${MCP_ROOT} (${source}) - the parser or the checkout is broken`);
  process.exit(1);
}

const { refs, ignoredProse } = collectReferences(manifest, declared);
const failures = [];

const unknown = [...refs.keys()].filter((name) => !declared.has(name)).sort();
for (const name of unknown) {
  failures.push(`unknown tool \`${name}\` referenced by: ${[...refs.get(name)].join(', ')}`);
}

const staleBaseline = [...KNOWN_NOT_TOOLS].filter((name) => declared.has(name)).sort();
for (const name of staleBaseline) {
  failures.push(`KNOWN_NOT_TOOLS lists \`${name}\` but the server declares it - remove it from the baseline`);
}

for (const [deptId, required] of Object.entries(REQUIRED_BY_DEPARTMENT)) {
  const dept = (manifest.departments ?? []).find((d) => d.id === deptId);
  if (!dept) { failures.push(`department \`${deptId}\` is missing from the manifest`); continue; }
  const prose = `${dept.crud ?? ''}\n${dept.setup ?? ''}`;
  const named = new Set(
    [...prose.matchAll(/`(_?[a-z][a-z0-9_]*)(?:\(.*?)?`/gs)].map((m) => m[1]),
  );
  // Also accept the shorthand form resolved by the prose scan (`_pause` after `email_campaign_create`).
  for (const [name, places] of refs) {
    if ([...places].some((p) => p.startsWith(`${deptId}.`))) named.add(name);
  }
  for (const tool of required) {
    if (!named.has(tool)) failures.push(`department \`${deptId}\` must name \`${tool}\` in its setup or crud text`);
  }
}

if (VERBOSE) {
  console.log(`declared tools: ${declared.size} (${source})`);
  console.log(`referenced tools: ${refs.size}`);
  for (const name of [...refs.keys()].sort()) console.log(`  ${declared.has(name) ? 'ok ' : 'MISSING'} ${name}  <- ${[...refs.get(name)].slice(0, 3).join(', ')}`);
  console.log(`prose identifiers skipped as non-tools: ${ignoredProse.size}`);
  for (const name of [...ignoredProse.keys()].sort()) console.log(`  skip ${name}  <- ${[...ignoredProse.get(name)].slice(0, 2).join(', ')}`);
}

if (failures.length === 0) {
  const datasets = (manifest.departments ?? []).reduce((n, d) => n + (d.datasets?.length ?? 0), 0);
  console.log(
    `OK: every tool the department registry names exists on the MCP server ` +
      `(${refs.size} distinct tools across ${manifest.departments.length} departments / ${datasets} datasets; ` +
      `${declared.size} declared, read from ${source})`,
  );
  process.exit(0);
}

console.error(`FAIL: the department registry names tools the MCP server does not declare.\n`);
for (const failure of failures) console.error(`  - ${failure}`);
console.error(
  `\n  ${failures.length} problem(s).\n` +
    `  manifest: ${MANIFEST}\n  server  : ${MCP_ROOT} (${source})\n\n` +
    `  Fix the name in src/deptData.ts (the registry source), then 'npm run sync:registry'\n` +
    `  so both clients pick it up. If the tool was renamed on the server, the prose in\n` +
    `  setupPlaybooks / deptData is what went stale, not this check. Re-run with --verbose\n` +
    `  to see every reference and every identifier the prose scan skipped.`,
);
process.exit(1);
