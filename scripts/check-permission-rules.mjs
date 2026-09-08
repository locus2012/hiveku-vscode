#!/usr/bin/env node
/**
 * Guard: the scaffolded Claude Code permission allow-list must be (a) valid
 * glob syntax and (b) reads only.
 *
 * Two separate defects motivated this, both shipped for months:
 *
 *   1. Every rule was written REGEX-shaped — `mcp__hiveku__.*_get`. Claude Code
 *      permission rules are GLOBS: `*` is the only wildcard and `.` is literal,
 *      so those matched nothing. The block that exists to stop prompting on
 *      reads stopped none of it, silently. Two separate passes over this file
 *      each missed a subset, because a grep for `.*` right after the prefix
 *      does not catch `get_.*`.
 *
 *   2. Fixing the syntax naively opens a hole in the other direction. Glob `*`
 *      spans underscores, so `*_status` also matches `helpdesk_ticket_set_status`
 *      — a PATCH against a customer-facing ticket — which the list's own header
 *      promises is excluded.
 *
 *   3. Filtering only PATCH/PUT/DELETE left POST wide open — the exact hole
 *      knowledge.ts predicted in its own comment ("a POST leak through a glob
 *      would pass it silently"). Three live Microsoft Ads writes
 *      (ppc_bing_shared_negative_list_create / _items_add / _associate) rode
 *      in on '*_list_*' and were auto-approved for months while this gate
 *      printed "0 mutations". Most Hiveku reads are POST-dispatched, so POST
 *      cannot simply be banned: the rule is now "GET, or readOnlyHint, or
 *      named in POST_READS below", which forces a human decision on the next
 *      one instead of silence.
 *
 * So syntax alone is not enough: this expands every rule against the REAL tool
 * registry and fails if any tool that is not a declared read would be
 * auto-approved.
 *
 * Usage: node scripts/check-permission-rules.mjs   (exit 1 on any violation)
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const SRC = new URL('../src/knowledge.ts', import.meta.url).pathname;
const REGISTRY = new URL(
  '../../hiveku-mcp-api-server/dist/tools/olympus-tools.js',
  import.meta.url,
).pathname;

const src = readFileSync(SRC, 'utf8');

// ★ Scope the scrape to the ALLOW array. A bare file-wide match also swept up
// the mcp__hiveku__* names in the DENY list, counting rules that REMOVE a
// permission as rules that grant one — so denying a tool made this gate report
// one more approved tool, not one fewer.
const allowBlock = /const HIVEKU_ALLOW: string\[\] = \[([\s\S]*?)\n\];/.exec(src);
if (!allowBlock) {
  console.error('✖ could not find the HIVEKU_ALLOW array — did the allow-list move or get renamed?');
  process.exit(1);
}
const rules = [...allowBlock[1].matchAll(/'(mcp__hiveku__[^']+)'/g)].map((m) => m[1]);

// Everything else in the file that names a Hiveku tool is a deny rule (the
// writeClaudeSettings deny loop). Deny beats allow and beats the permission
// mode, so a denied name is NOT auto-approved and must not be reported as such.
const denied = new Set(
  [...src.replace(allowBlock[0], '').matchAll(/'mcp__hiveku__([^']+)'/g)].map((m) => m[1]),
);

if (rules.length === 0) {
  console.error('✖ no mcp__hiveku__ permission rules found — did the allow-list move?');
  process.exit(1);
}

/**
 * POST-dispatched tools that really are reads.
 *
 * Hiveku routes many reads through POST (an `action:` body), so "method !== GET"
 * cannot mean "write" here. Each name below was checked against its route and
 * its registered description. Adding to this list is a decision to defend in
 * review — which is the entire point: the next POST that leaks through a glob
 * fails this gate instead of passing it silently.
 */
const POST_READS = new Set([
  // analytics probes — fetch a page / diagnose tracking, no writes
  'analytics_channel_scorecard', 'analytics_diagnose_tracking', 'analytics_probe_page',
  // builder inspection + dry runs
  'project_files_snapshot', 'project_files_status', 'project_checkpoint_restore_dry_run',
  'project_state_at', 'project_test_build', 'project_files_search', 'checkpoint_create',
  'verify_typecheck', 'verify_lint', 'verify_run_tests',
  'preview_http_get', 'preview_runtime_errors', 'preview_client_errors', 'preview_screenshot',
  // supabase inspection
  'supabase_auth_config_get', 'supabase_storage_list', 'supabase_edge_functions_list',
  'supabase_storage_objects_list', 'supabase_auth_users_list', 'supabase_auth_user_get',
  'supabase_table_rows_list', 'supabase_policies_list', 'supabase_migrations_list',
  // commerce + marketing reads
  'shopify_catalog_list', 'shopify_inventory_get',
  'ppc_experiments_list', 'marketing_offline_conversion_actions_list',
  'marketing_call_attribution_list', 'marketing_call_transcript_get',
  'email_campaign_metrics', 'content_page_views_get',
]);

const problems = [];

// ── (a) syntax ────────────────────────────────────────────────────────────
// A '.' is literal in a glob, so any '.' inside a rule is a regex leftover.
for (const rule of rules) {
  const tail = rule.replace('mcp__hiveku__', '');
  if (tail.includes('.')) {
    problems.push(`${rule} — regex syntax; globs use '*' only ('.' is a literal dot, so this matches nothing)`);
  }
}

// ── (b) reads only ────────────────────────────────────────────────────────
if (!existsSync(REGISTRY)) {
  console.warn(
    '⚠ tool registry not built (../hiveku-mcp-api-server/dist) — syntax checked, ' +
      'read-only NOT verified. Run `npm run build` there to enable the full check.',
  );
} else {
  const require_ = createRequire(import.meta.url);
  const { olympusTools, hivekuMetaTools } = require_(REGISTRY);
  const all = [...olympusTools, ...hivekuMetaTools];
  const toRe = (glob) =>
    new RegExp(
      '^' +
        glob
          .split('*')
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*') +
        '$',
    );
  const approved = new Set();
  for (const rule of rules) {
    const re = toRe(rule.replace('mcp__hiveku__', ''));
    for (const t of all) if (re.test(t.name)) approved.add(t.name);
  }
  // A denied name is not approved, whatever the globs matched.
  for (const name of denied) approved.delete(name);

  // A tool is auto-approvable only if the server declares it a read: method GET,
  // or an explicit readOnlyHint, or a POST vetted by name above.
  const leaked = all.filter(
    (t) =>
      approved.has(t.name) &&
      t.mapping &&
      t.mapping.method !== 'GET' &&
      t.readOnlyHint !== true &&
      !POST_READS.has(t.name),
  );
  for (const t of leaked) {
    problems.push(
      `${t.name} (${t.mapping.method}) is AUTO-APPROVED — the allow-list is documented as reads only. ` +
      'If it really is a read, add it to POST_READS with the route checked; otherwise deny it by name.',
    );
  }
  if (problems.length === 0) {
    console.log(
      `✓ ${rules.length} allow rules, ${denied.size} denied — ${approved.size} read tools auto-approved, 0 mutations`,
    );
  }
}

if (problems.length) {
  console.error(`\n✖ ${problems.length} permission-rule problem(s) in src/knowledge.ts:\n`);
  for (const p of problems) console.error('   ' + p);
  console.error(
    '\n   Fix: use glob syntax (mcp__hiveku__*_get), and never let a glob span a\n' +
      '   mutating tool — enumerate the safe names instead (see the _status block).\n',
  );
  process.exit(1);
}
