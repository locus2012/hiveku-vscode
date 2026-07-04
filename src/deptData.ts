/**
 * Department data registry — the single source of truth for "what operational
 * data each department has, and which MCP tool returns it." Powers BOTH:
 *   • the local export (dataExport.ts) — writes each dataset to hiveku-data/<dept>/<ds>.json
 *     so Claude Code can grep/analyze it like project code, and
 *   • the Account Console (console.ts) — renders each dataset as a table.
 *
 * Some data is account-level (one tool call). Some is parent-scoped — SEO
 * rankings/keywords/backlinks are per SEO-project, PPC keywords are per ad
 * connection — so those datasets declare a `scope` and the fetcher lists the
 * parents first, then pulls each child, tagging every row with its parent.
 */

import { HivekuMcpClient } from './mcpClient';
import { SEO_SETUP, CRM_SETUP, EMAIL_SETUP, SOCIAL_SETUP, OUTBOUND_SETUP, ACCOUNTING_SETUP } from './setupPlaybooks';

export type Row = Record<string, unknown>;

export interface Column {
  /** Row key(s) — first present wins. Dot-paths allowed (e.g. 'stage.name'). */
  key: string | string[];
  label?: string;
  money?: boolean;
  cents?: boolean;
  date?: boolean;
}

export interface ScopeStep {
  parentTool: string;
  parentIdKey: string;
  parentLabelKey?: string;
  argKey: string;
  /** Static args passed to this step's parentTool (merged with accumulated args). */
  parentArgs?: Record<string, unknown>;
}

export interface Dataset {
  id: string;
  label: string;
  tool: string;
  args?: Record<string, unknown>;
  /**
   * Parent-scoped fetch. A single step lists `parentTool`, then calls `tool` per
   * parent with { [argKey]: parent[parentIdKey] }. An ARRAY chains levels (e.g.
   * project → collection → entries): each step's parentTool is called with the
   * args accumulated so far, fanning out; the leaf `tool` runs per leaf context.
   * Rows are tagged with `_parent` (the joined parent labels, e.g. "Site / blog").
   */
  scope?: ScopeStep | ScopeStep[];
  /**
   * Rolling date-window args resolved at FETCH time: arg name → "N days ago"
   * (ISO yyyy-mm-dd), merged over `args`. Declarative — NOT a closure — so the
   * local data runner's manifest.json carries the exact same windows.
   */
  dynArgs?: Record<string, number>;
  /**
   * Also dump each list row's FULL object (rich documents — workflow graphs,
   * customer avatars/journeys, brand guides, CMS entries) by calling `detailTool`
   * per row → `<dept>/<dir|id>/<slug>.json`. The flat list stays the index.
   */
  detail?: { detailTool: string; idKey?: string; argKey?: string; nameKey?: string; dir?: string };
  columns: Column[];
}

/** A single full-object reference written as-is (e.g. the workflow node-type catalog). */
export interface ReferenceSpec {
  id: string; // filename (no extension)
  label: string;
  tool: string;
  args?: Record<string, unknown>;
}

export interface Department {
  id: string;
  label: string;
  /** pageAccess gate key (plan/role entitlement). */
  gate?: string;
  datasets: Dataset[];
  /** Read-only department (no CRUD via MCP) — console/exports won't imply writes. */
  readOnly?: boolean;
  /** Static reference docs (catalogs/schemas) Claude Code needs to edit. Export-only. */
  references?: ReferenceSpec[];
  /** CRUD how-to written into the department README so Claude Code knows the write path. */
  crud?: string;
  /** Integration/connection SETUP playbook → written as `<dept>/SETUP.md` for Claude Code. */
  setup?: string;
}

// ── Row extraction (tools wrap inconsistently) ───────────────────────────────
function firstObjectArray(obj: Record<string, unknown>): unknown[] | undefined {
  let fallback: unknown[] | undefined;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object' && v[0] !== null) return v;
      if (!fallback) fallback = v;
    }
  }
  return fallback;
}
export function extractRows(payload: unknown): Row[] {
  const inner =
    payload && typeof payload === 'object' && 'data' in (payload as Row)
      ? (payload as { data: unknown }).data
      : payload;
  if (Array.isArray(inner)) return inner as Row[];
  if (inner && typeof inner === 'object') {
    const a = firstObjectArray(inner as Record<string, unknown>);
    if (a) return a as Row[];
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const a = firstObjectArray(payload as Record<string, unknown>);
    if (a) return a as Row[];
  }
  return [];
}

/** Cap on paginated fetches so a huge/looping list can't run away. */
const MAX_EXTRA_PAGES = 40;

/** Pull `{ page, total_pages, total }` from a response, whether at the top level or under `data`. */
function paginationOf(raw: unknown): { page?: number; total_pages?: number; total?: number } | undefined {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const p = (r.pagination ?? (r.data && (r.data as Record<string, unknown>).pagination)) as
      | { page?: number; total_pages?: number; total?: number }
      | undefined;
    if (p && typeof p === 'object') return p;
  }
  return undefined;
}

interface PagedResult {
  rows: Row[];
  /** Server's reported row count, when the envelope carries one. */
  total?: number;
  /** True when the MAX_EXTRA_PAGES cap stopped us before the last page. */
  truncated?: boolean;
}

/**
 * Call a list tool and follow its pagination envelope to completion. Most list
 * routes hard-cap `limit` (~100) and return `{ page, total_pages }`; without
 * this the mirror silently held only the first page. Robust to tools that don't
 * page: if a requested page doesn't advance, we stop (never duplicate).
 * `maxRows` short-circuits once enough rows are collected (the console only
 * shows a slice — it doesn't need the full fan-out).
 */
async function fetchPaged(
  client: HivekuMcpClient,
  tool: string,
  args: Record<string, unknown>,
  maxRows?: number,
): Promise<PagedResult> {
  const first = await client.callToolJson<unknown>(tool, args);
  let rows = extractRows(first);
  const pg = paginationOf(first);
  const total = pg && pg.total != null ? Number(pg.total) : undefined;
  const totalPages = pg ? Number(pg.total_pages) || 1 : 1;
  const startPage = pg ? Number(pg.page) || 1 : 1;
  if (totalPages <= 1 || startPage >= totalPages) return { rows, total };
  if (maxRows && rows.length >= maxRows) return { rows, total }; // enough for the caller
  const last = Math.min(totalPages, startPage + MAX_EXTRA_PAGES);
  for (let p = startPage + 1; p <= last; p++) {
    let raw: unknown;
    try {
      raw = await client.callToolJson<unknown>(tool, { ...args, page: p });
    } catch {
      break; // keep the pages we already have
    }
    const rpg = paginationOf(raw);
    if (!rpg || Number(rpg.page) !== p) break; // tool ignored `page` — stop before duplicating
    rows = rows.concat(extractRows(raw));
    if (maxRows && rows.length >= maxRows) return { rows, total };
  }
  // Cap hit before the reported last page → the mirror is incomplete; say so.
  const truncated = last < totalPages || (total != null && rows.length < total);
  return { rows, total, truncated };
}

/** Fetch a dataset's rows (handles parent-scoped datasets). Never throws — a
 *  failed child is skipped; a top-level failure returns an empty result + error.
 *  `maxRows` caps pagination for callers (the console) that only render a slice. */
export async function fetchDataset(
  client: HivekuMcpClient,
  ds: Dataset,
  maxRows?: number,
): Promise<{ rows: Row[]; error?: string; parents?: number; total?: number; truncated?: boolean }> {
  try {
    const baseArgs = { ...(ds.args ?? {}), ...resolveDynArgs(ds.dynArgs) };
    if (!ds.scope) {
      const r = await fetchPaged(client, ds.tool, baseArgs, maxRows);
      return { rows: r.rows, total: r.total, truncated: r.truncated };
    }
    // Walk the scope chain: each step fans every current context out over its
    // parents, accumulating the arg + a label path. Works for 1, 2, or N levels.
    const steps = Array.isArray(ds.scope) ? ds.scope : [ds.scope];
    let contexts: Array<{ args: Record<string, unknown>; label: string }> = [{ args: {}, label: '' }];
    let firstStep = true;
    for (const step of steps) {
      const isFirst = firstStep;
      firstStep = false;
      const expanded = await mapLimit(contexts, 5, async (ctx) => {
        let parents: Array<Row | string>;
        try {
          parents = extractRows(await client.callToolJson<unknown>(step.parentTool, { ...(step.parentArgs ?? {}), ...ctx.args })) as Array<Row | string>;
        } catch (err) {
          // The ROOT parent listing failing = the dataset failed (dead key/endpoint)
          // — surface the error instead of masking it as "no parents = 0 rows".
          // Deeper partial failures still skip quietly. Mirrors the local runner.
          if (isFirst) throw err;
          return [] as typeof contexts;
        }
        const out: typeof contexts = [];
        for (const p of parents) {
          const pid = typeof p === 'string' ? p : p[step.parentIdKey];
          if (pid == null || pid === '') continue;
          const plabel = typeof p === 'string' ? p : step.parentLabelKey ? p[step.parentLabelKey] ?? pid : pid;
          out.push({ args: { ...ctx.args, [step.argKey]: pid }, label: ctx.label ? `${ctx.label} / ${plabel}` : String(plabel) });
        }
        return out;
      });
      contexts = expanded.flat();
      if (contexts.length === 0) break;
    }
    let anyTruncated = false;
    const chunks = await mapLimit(contexts, 5, async (ctx) => {
      try {
        const r = await fetchPaged(client, ds.tool, { ...baseArgs, ...ctx.args }, maxRows);
        if (r.truncated) anyTruncated = true;
        return r.rows.map((row) =>
          typeof row === 'string' ? ({ _parent: ctx.label, value: row } as Row) : ({ _parent: ctx.label, ...row } as Row),
        );
      } catch {
        return [] as Row[]; // one leaf failing must not sink the dataset
      }
    });
    return { rows: chunks.flat(), parents: contexts.length, truncated: anyTruncated || undefined };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function unwrapAny(payload: unknown): unknown {
  return payload && typeof payload === 'object' && 'data' in (payload as Row) ? (payload as { data: unknown }).data : payload;
}
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

/** Run `fn` over items with bounded concurrency (keeps per-item fetches fast without hammering the API). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Fetch a single object via a detail/reference tool, unwrapped as-is. */
export async function fetchReference(
  client: HivekuMcpClient,
  tool: string,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error?: string }> {
  try {
    return { data: unwrapAny(await client.callToolJson<unknown>(tool, args ?? {})) };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── The registry ─────────────────────────────────────────────────────────────
const seoProjectScope = { parentTool: 'seo_list_projects', parentIdKey: 'id', parentLabelKey: 'name', argKey: 'project_id' };
const ppcConnScope = { parentTool: 'ppc_connection_list', parentIdKey: 'id', parentLabelKey: 'display_name', argKey: 'connection_id' };
// The /ppc/ops-backed tools (keywords, search terms, recommendations, disapprovals,
// conversion actions) accept ONLY google_ads connections — filter the parent so a
// Bing/Meta connection doesn't produce a failed fetch per dataset.
const ppcGoogleScope = { ...ppcConnScope, parentArgs: { platform: 'google_ads' } };
const seoConnScope = { parentTool: 'seo_connections_list', parentIdKey: 'id', parentLabelKey: 'platform', argKey: 'connection_id' };
// Website-project parent: sites_list returns every buildable website_project (id + name).
const siteScope = { parentTool: 'sites_list', parentIdKey: 'id', parentLabelKey: 'name', argKey: 'project_id' };

/** ISO yyyy-mm-dd for N days ago (rolling window for analytics). */
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
/** Resolve a Dataset.dynArgs spec ({ arg: daysAgo }) to concrete ISO dates. */
export function resolveDynArgs(dyn?: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, n] of Object.entries(dyn ?? {})) out[k] = daysAgoIso(n);
  return out;
}

// ── Connection setup playbooks (written to <dept>/SETUP.md) ──────────────────
const PPC_SETUP = `# Connecting Google Ads & Microsoft (Bing) Ads — exact, verified steps

Connections live in \`ppc_connections\`. Check current state any time: \`ppc_connection_list\`.
Hiveku has NO platform-shared OAuth — every account brings its own OAuth client (BYOK).

## STEP 0 (once per account) — the OAuth app
Check for an existing app: \`oauth_app_list({ provider: 'google' })\`. If none is enabled for the product
(\`google_ads\`), create one — first the user does this in **Google Cloud Console**:
  1. Create/pick a Google Cloud project → enable the **Google Ads API**.
  2. OAuth consent screen → External; add the user as a test user (or publish).
  3. Credentials → Create OAuth client ID → **Web application** → Authorized redirect URI MUST include
     \`https://app.hiveku.com/api/oauth/google/callback\`.
  4. Copy the Client ID + Client Secret.
Then: \`oauth_app_create({ provider: 'google', name: '<acct> Google Ads', client_id, client_secret, products: ['google_ads'] })\`.
(Skipping this → \`integration_oauth_initiate\` returns **412 integration_not_configured**.)

## Google Ads — collect 3 fields, then run
From the user: **developer_token** (their Google Ads MCC → Tools & Settings → API Center — required for EVERY
Ads API call), **customer_id** (client account, 10 digits no dashes), **manager_id** (the MCC id — ONLY if the
client account sits under a manager account; Google needs login-customer-id or sync fails).

Path A — you have the customer_id:
1. \`integration_oauth_initiate({ provider_slug: 'google_ads', customer_id, manager_id?, developer_token })\`
   → \`{ setup_url, setup_token, connection_id }\`. (It pre-creates the ppc_connections row, status 'pending'.)
2. Give the user \`setup_url\`; they complete Google's consent screen.
3. **Poll** \`integration_oauth_check({ setup_token })\` every ~5s until \`status: 'completed'\` (expired=15min → re-initiate).
   OAuth writes the refresh_token; with customer_id set, status auto-promotes to **connected**.
4. \`ppc_connection_test({ id: connection_id })\` — live API check of OAuth + permissions.
5. \`ppc_sync({ connection_id })\` (incremental, ≤60s; full 5-year backfill → \`ppc_sync_async\` then poll \`job_status_get\`).
6. Verify: \`ppc_account_settings_get({ connection_id })\`, \`ppc_campaign_list\`, \`ppc_conversion_tracking_status({ connection_id })\`.

Path B — discover the customer_id (user doesn't know it):
1. \`integration_oauth_initiate({ provider_slug: 'google_ads', developer_token })\` → connection_id; user authorizes; poll check.
2. \`ppc_ads_discover_customers({ id: connection_id })\` → accessible customer IDs (needs developer_token set; 412 if missing).
3. \`ppc_connection_update({ id: connection_id, customer_id, manager_id? })\` → status auto-flips to **connected**.
4. test → sync → verify (Path A steps 4–6).

Re-auth a dead connection (refresh_token died): \`integration_oauth_initiate({ provider_slug: 'google_ads', target_connection_id })\`.

## Microsoft / Bing Ads
Microsoft Ads OAuth is **dashboard-initiated** — \`integration_oauth_initiate\` is Google-only, so an agent cannot
start the Microsoft consent from here. Steps:
1. (Once) register the Azure app: \`oauth_app_create({ provider: 'microsoft', name, client_id, client_secret, products: ['microsoft_ads'] })\`
   (client_id/secret from Azure AD app registration; redirect URI → \`https://app.hiveku.com/api/oauth/microsoft/callback\`).
2. The user connects Microsoft Ads in the **Hiveku dashboard** (Marketing → Ads → connect Microsoft). The
   microsoft OAuth callback creates a \`ppc_connections\` row with \`platform=microsoft_ads\` (NO developer_token needed).
3. Back here: \`ppc_connection_list\` shows it → \`ppc_sync({ connection_id })\` → all ppc_* read/CRUD tools work the same.

## After connecting (either platform)
Re-run "Download Department Data → Ads (PPC)" to refresh \`hiveku-data/ppc/*.json\`, then mine
\`keywords.json\` (quality scores), \`search_terms.json\` (negative candidates), \`recommendations.json\`, \`disapprovals.json\`.
`;

const LOCALSEO_SETUP = `# Connecting Local SEO sources (GBP, Search Console, Bing Webmaster) — verified

Connected sources: \`seo_connections_list\`. Local rank/query data comes from synced GSC + Bing.
Each Google source needs a per-account OAuth app (BYOK) — same pattern as Google Ads.

## STEP 0 (once per product) — the OAuth app
\`oauth_app_list({ provider: 'google' })\`; if none for the product, create it. The user first does Google Cloud
Console setup (project → enable the product's API [Search Console API / Business Profile API] → OAuth consent
screen → Web-app client → Authorized redirect URI must include \`https://app.hiveku.com/api/oauth/google/callback\`),
then: \`oauth_app_create({ provider: 'google', name, client_id, client_secret, products: ['google_search_console'] })\`
(or \`['google_business_profile']\`). Missing app → \`integration_oauth_initiate\` returns 412.

## Google Business Profile (core of Local SEO)
1. \`integration_oauth_initiate({ provider_slug: 'google_business_profile' })\` → \`{ setup_url, setup_token, connection_id }\`; user authorizes.
2. Poll \`integration_oauth_check({ setup_token })\` until \`status: 'completed'\`.
3. \`seo_gbp_discover_locations({ id: connection_id })\` → accounts[].locations[] (location_id + title).
4. \`seo_connection_update({ id: connection_id, gbp_account_id, gbp_location_id })\` → status flips to **connected** once BOTH set.
5. Then \`seo_gbp_insights({ connection_id })\` (clicks/calls/directions) + \`seo_gbp_reviews({ connection_id })\` work.

## Google Search Console (organic + local queries)
1. \`integration_oauth_initiate({ provider_slug: 'google_search_console' })\` → connection_id; user authorizes; poll \`integration_oauth_check\`.
2. \`seo_gsc_discover_sites({ id: connection_id })\` → pick a verified site (or use \`sc-domain:<domain>\` if 0 listed).
3. \`seo_connection_update({ id: connection_id, site_url })\` → **connected**. Then \`seo_gsc_search_queries\`, \`seo_gsc_top_pages\`, etc.

## Bing Webmaster (API key — fully connectable from here, no dashboard)
\`integration_create({ provider_slug: 'bing_webmaster', credentials: { api_key } })\` (the user's Bing Webmaster
API key from bing.com/webmasters → Settings → API access). Then \`seo_bing_keywords\`, \`seo_bing_pages\`, \`seo_bing_stats\`
populate, and the \`seo_local_*\` aggregates pick up \`source: bing|all\`.

## After connecting
\`seo_sync\` to pull fresh data, then "Download Department Data → Local SEO" to refresh \`hiveku-data/localseo/*.json\`.
`;

const AEO_SETUP = `# AEO (Answer Engine Optimization) — running audits

AEO measures whether the domain appears in AI Overviews, Featured Snippets, and People-Also-Ask for target keywords.

1. **Run an audit** (costs DataForSEO calls — ~1 per keyword, cap ~25):
   \`seo_aeo_audit_run({ domain: 'acme.com', keywords: ['...'], max_keywords: 25, location_code: 2840 })\`.
   It probes each SERP, records AI-overview / snippet / PAA presence + whether the domain is cited, and PERSISTS to history.
2. **Read the latest results** (no cost — DB read): \`seo_aeo_audit_get({ domain })\` → per-keyword presence + readiness %.
   This is what the \`audit.json\` dataset here mirrors.
3. **Sync rankings**: \`seo_aeo_rankings_sync\` to refresh tracked AEO positions.
4. Use the readiness % + per-keyword gaps to prioritize content/schema changes, then re-run to measure lift.
`;

const COMMERCE_SETUP = `# Connecting a Shopify store

Hiveku is headless: a connected store renders live on the site (products/inventory aren't copied in).
Shopify uses a bring-your-own-app OAuth model (app client_id/secret live per-account).

1. **Register the Shopify app** (once) — in the **Hiveku dashboard** at Commerce → Settings → Shopify, register
   the app inline (client_id + client_secret from the user's Shopify Partner/custom app; the connect dialog there
   walks through it). OAuth apps for Shopify are dashboard-registered (not via oauth_app_create).
2. **Start the install**: \`shopify_connect_start\` → returns the Shopify install/authorize URL; give it to the user to approve on their store.
3. **Poll**: \`shopify_connection_status({ shop_domain })\` until a row appears with \`disconnected_at = null\` (approval done).
4. **Verify**: \`shopify_status({ project_id })\` and \`shopify_catalog_list({ project_id })\` (per website project — get project_id from \`sites_list\`).

Products/orders stay in Shopify Admin; this department reads catalog + inventory and supports draft-product creation.
`;

export const DEPARTMENTS: Department[] = [
  {
    id: 'workflows',
    label: 'Automations',
    gate: 'workflows',
    datasets: [
      // Each workflow is a ReactFlow graph — the list is the index, `detail` dumps
      // the full {nodes,edges} graph per workflow to definitions/<wf>.json.
      { id: 'workflows', label: 'Workflows', tool: 'workflow_list', args: { limit: 200 }, detail: { detailTool: 'workflow_get', nameKey: 'name', dir: 'definitions' }, columns: [{ key: 'name' }, { key: 'is_enabled', label: 'enabled' }, { key: ['run_count', 'runs'], label: 'runs' }, { key: 'updated_at', label: 'updated', date: true }] },
      // since defaults to the last HOUR server-side — pull a rolling 7-day window so the mirror is useful for debugging.
      { id: 'recent_runs', label: 'Recent runs (7d)', tool: 'workflow_runs_recent', args: { limit: 200 }, dynArgs: { since: 7 }, columns: [{ key: ['workflow_name', 'workflow_id'], label: 'workflow' }, { key: 'status' }, { key: ['started_at', 'created_at'], label: 'when', date: true }] },
    ],
    // Reference catalogs Claude Code needs to author valid graphs, triggers, and templating.
    references: [
      { id: 'node-catalog', label: 'Node type catalog (260+ types)', tool: 'workflow_node_types_list' },
      { id: 'trigger-types', label: 'Trigger types + config keys', tool: 'workflow_trigger_types_list' },
      { id: 'event-trigger-types', label: 'Event trigger types', tool: 'workflow_event_trigger_types_list' },
      { id: 'templating-syntax', label: 'Templating syntax reference', tool: 'workflow_templating_syntax' },
    ],
    crud:
      'To EDIT a workflow: read `definitions/<wf>.json` (its `{nodes,edges}` graph) and `node-catalog.json` ' +
      '(valid node `type` strings + each type\'s `data` fields). Then make SURGICAL edits — ' +
      '`workflow_node_add({workflow_id,type,data,position})`, `workflow_node_update({workflow_id,node_id,data})`, ' +
      '`workflow_node_delete` (cascades its edges), `workflow_edge_add({workflow_id,source,target,sourceHandle?})`, ' +
      '`workflow_edge_delete` — each is version-snapshotted. Or replace the whole graph with ' +
      '`workflow_update({workflow_id,definition:{nodes,edges}})`. CREATE: `workflow_create({name})` then build incrementally. ' +
      'TRIGGERS (two parts): every workflow needs one trigger-category node AND, for external triggers, a `workflow_triggers` row — ' +
      'after `workflow_node_add` of the trigger node call `workflow_trigger_create({workflow_id,name,node_id,trigger_type,config})` ' +
      '(check `trigger-types.json` for config keys); manage via `workflow_trigger_update`/`workflow_trigger_delete`. For a webhook-in, ' +
      '`workflow_provision_webhook({name})` does create+node+trigger in one shot (bearer token shown once). ' +
      'VERIFY BEFORE ENABLING: `workflow_validate({workflow_id})` after every batch of edits, then dry-run with ' +
      '`workflow_test({workflow_id,input_data})` — it fires NO real side effects. NEVER use `workflow_run` to test (it sends real ' +
      'emails/Slack/CRM writes and burns run quota). Debug a run via `workflow_run_get` (per-node step_states) + `workflow_run_logs`. ' +
      'SCHEDULE: `workflow_set_schedule({workflow_id,cron_expression,timezone?,enabled?})` (upsert), read `workflow_get_schedule`, ' +
      'remove `workflow_delete_schedule`. ROLLBACK: `workflow_versions_list` → `workflow_version_restore`. ' +
      'Enable/disable: `workflow_enable`/`workflow_disable`. Run for real: `workflow_run`. Delete: `workflow_delete`. ' +
      'TEMPLATES + FORM-WIRING: skip hand-building — `workflow_templates_list` → `workflow_create_from_template({ slug, overrides })`. ' +
      'To wire EVERY form in a website project in ONE call: `workflow_bulk_provision_for_project({ project_id, template_slug, ' +
      'file_paths?, dry_run: true })` (dry-run first) — provisions a submit-handler workflow per form; single form: ' +
      '`workflow_bind_form({ workflow_id, project_id, form_file_path })`. Set who gets notified with `workflow_set_recipient`.',
  },
  {
    id: 'seo',
    label: 'SEO',
    setup: SEO_SETUP,
    gate: 'marketing_seo',
    datasets: [
      { id: 'projects', label: 'SEO projects', tool: 'seo_list_projects', columns: [{ key: 'name' }, { key: ['domain', 'website_url'], label: 'domain' }] },
      { id: 'keywords', label: 'Keywords', tool: 'seo_keywords_list', args: { limit: 200 }, scope: seoProjectScope, columns: [{ key: '_parent', label: 'project' }, { key: 'keyword' }, { key: ['search_volume', 'volume'], label: 'volume' }, { key: ['search_intent', 'intent'], label: 'intent' }] },
      { id: 'rankings', label: 'Rankings', tool: 'seo_rankings_list', args: { limit: 200 }, scope: seoProjectScope, columns: [{ key: '_parent', label: 'project' }, { key: ['keyword', 'keyword_text'], label: 'keyword' }, { key: ['position', 'rank'], label: 'position' }, { key: ['url', 'ranking_url'], label: 'url' }] },
      { id: 'backlinks', label: 'Backlinks', tool: 'seo_backlinks_list', args: { limit: 200 }, scope: seoProjectScope, columns: [{ key: '_parent', label: 'project' }, { key: ['source_url', 'url_from'], label: 'from' }, { key: ['domain_authority', 'authority', 'rank'], label: 'authority' }, { key: ['anchor', 'anchor_text'], label: 'anchor' }] },
      { id: 'gsc_queries', label: 'GSC queries (28d)', tool: 'seo_gsc_search_analytics', args: { dimensions: ['query'], row_limit: 1000 }, dynArgs: { start: 28 }, columns: [{ key: 'keys', label: 'query' }, { key: 'clicks' }, { key: 'impressions', label: 'impr' }, { key: 'ctr' }, { key: 'position' }] },
      { id: 'gsc_pages', label: 'GSC pages (28d)', tool: 'seo_gsc_search_analytics', args: { dimensions: ['page'], row_limit: 500 }, dynArgs: { start: 28 }, columns: [{ key: 'keys', label: 'page' }, { key: 'clicks' }, { key: 'impressions', label: 'impr' }, { key: 'ctr' }, { key: 'position' }] },
      { id: 'audits', label: 'Audits', tool: 'seo_list_audits', scope: seoProjectScope, columns: [{ key: '_parent', label: 'project' }, { key: 'status' }, { key: ['score', 'health_score'], label: 'score' }, { key: 'created_at', label: 'when', date: true }] },
      { id: 'competitors', label: 'Competitors', tool: 'seo_list_competitors', scope: seoProjectScope, columns: [{ key: '_parent', label: 'project' }, { key: ['domain', 'name', 'competitor_domain'], label: 'domain' }] },
      // Rank-TRACKED keywords are a different table from `keywords` (research) —
      // deletes need the id from HERE, not keywords.json.
      { id: 'tracked_keywords', label: 'Tracked keywords', tool: 'seo_tracked_keywords_list', scope: seoProjectScope, columns: [{ key: '_parent', label: 'project' }, { key: 'keyword' }, { key: ['search_engine', 'engine'], label: 'engine' }, { key: ['location_code', 'location'], label: 'location' }, { key: 'id' }] },
    ],
    crud:
      'SEO tracking project: `seo_create_project` (no update/delete tool — create-only via MCP). ' +
      'Website on-page SEO settings (robots.txt, sitemap_settings, meta): `seo_project_get` / `seo_project_update` with the ' +
      'BUILDER project_id from `list_projects` — NOT the `seo_list_projects` id. ' +
      'Tracked keywords: `seo_track_keyword` to add, `seo_tracked_keyword_delete` to remove (id from `tracked_keywords.json`, ' +
      'NOT keywords.json — different table). Competitors: `seo_add_competitor`. ' +
      'Audits: `seo_run_audit` / `seo_audit_start` → `seo_audit_get`. Sitemaps: `seo_generate_sitemap` / `seo_gsc_submit_sitemap` ' +
      '(remove `seo_gsc_delete_sitemap`); Bing: `seo_bing_submit_sitemap` / `seo_bing_submit_url`. ' +
      'Deliverables/reports: `seo_deliverable_save` / `seo_deliverable_update` / `seo_deliverable_delete`; ' +
      'report sections `seo_report_add_section` / `seo_report_update_section` / `seo_report_clear`. Refresh data: `seo_sync`. ' +
      'Keywords/rankings/backlinks/audits are per SEO project (project_id from `seo_list_projects`).',
  },
  {
    id: 'ppc',
    label: 'Ads (PPC) — Google & Bing',
    gate: 'marketing_ppc',
    datasets: [
      { id: 'connections', label: 'Ad accounts', tool: 'ppc_connection_list', columns: [{ key: ['display_name', 'name'], label: 'account' }, { key: 'platform' }, { key: ['connection_status', 'status'], label: 'status' }, { key: 'customer_id', label: 'customer' }, { key: 'campaign_count', label: 'campaigns' }] },
      { id: 'campaigns', label: 'Campaigns', tool: 'ppc_campaign_list', args: { limit: 200 }, columns: [{ key: 'name' }, { key: 'platform' }, { key: 'status' }, { key: ['campaign_type', 'type'], label: 'type' }, { key: ['budget_amount', 'daily_budget'], label: 'budget', money: true }, { key: 'objective' }] },
      { id: 'ad_groups', label: 'Ad groups', tool: 'ppc_ad_group_list', args: { limit: 500 }, columns: [{ key: 'name' }, { key: 'status' }, { key: ['campaign_name', 'campaign_id'], label: 'campaign' }, { key: ['cpc_bid', 'cpc_bid_micros'], label: 'cpc bid', money: true }] },
      { id: 'ads', label: 'Ads (RSAs)', tool: 'ppc_ad_list', args: { limit: 500 }, columns: [{ key: ['name', 'headline', 'id'], label: 'ad' }, { key: 'status' }, { key: ['ad_type', 'type'], label: 'type' }, { key: 'approval_status', label: 'approval' }] },
      { id: 'keywords', label: 'Keywords +QS (Google)', tool: 'ppc_keyword_list', args: { days: 30, limit: 2000 }, scope: ppcGoogleScope, columns: [{ key: '_parent', label: 'account' }, { key: ['keyword', 'text'], label: 'keyword' }, { key: 'match_type', label: 'match' }, { key: ['quality_score', 'qs'], label: 'QS' }, { key: ['cpc_bid', 'cpc'], label: 'cpc', money: true }, { key: 'status' }] },
      { id: 'search_terms', label: 'Search terms (Google)', tool: 'ppc_search_terms_report', args: { days: 28, limit: 2000 }, scope: ppcGoogleScope, columns: [{ key: '_parent', label: 'account' }, { key: ['search_term', 'query']  , label: 'query' }, { key: 'clicks' }, { key: 'impressions', label: 'impr' }, { key: ['cost', 'cost_micros'], label: 'cost', money: true }, { key: 'conversions', label: 'conv' }] },
      { id: 'metrics_daily', label: 'Daily metrics (per campaign, 56d)', tool: 'ppc_metrics', args: { limit: 200 }, dynArgs: { since: 56 }, scope: { parentTool: 'ppc_campaign_list', parentIdKey: 'id', parentLabelKey: 'name', argKey: 'campaign_id', parentArgs: { limit: 200 } }, columns: [{ key: '_parent', label: 'campaign' }, { key: 'date', date: true }, { key: 'cost', money: true }, { key: 'clicks' }, { key: 'impressions', label: 'impr' }, { key: 'conversions', label: 'conv' }, { key: 'ctr' }, { key: 'cpa' }, { key: 'roas' }] },
      { id: 'recommendations', label: 'Google recommendations', tool: 'ppc_recommendations_list', args: { limit: 200 }, scope: ppcGoogleScope, columns: [{ key: '_parent', label: 'account' }, { key: ['type', 'recommendation_type'], label: 'type' }, { key: 'scope' }, { key: ['impact', 'conversions_delta'], label: 'impact' }] },
      { id: 'disapprovals', label: 'Disapproved ads (Google)', tool: 'ppc_disapprovals_list', args: { limit: 500 }, scope: ppcGoogleScope, columns: [{ key: '_parent', label: 'account' }, { key: ['ad_name', 'ad_id'], label: 'ad' }, { key: 'approval_status', label: 'approval' }, { key: ['policy_topics', 'review_status'], label: 'reason' }] },
      { id: 'conversion_actions', label: 'Conversion actions (Google)', tool: 'ppc_conversion_actions_list', scope: ppcGoogleScope, columns: [{ key: '_parent', label: 'account' }, { key: 'name' }, { key: 'status' }, { key: 'category' }, { key: 'primary_for_goal', label: 'primary' }] },
    ],
    crud:
      'PLATFORM SPLIT (read first): the `ppc_*` ops tools below are GOOGLE-ONLY (they route through /ppc/ops which accepts ' +
      'only google_ads connections). BING (Microsoft) has exactly FOUR working write tools — `ppc_platform_pause_resource` / ' +
      '`ppc_platform_enable_resource` / `ppc_platform_budget_update` (resource_type: campaign|ad_group|ad|keyword) + ' +
      '`ppc_platform_period_comparison` (read). Everything else is Google-only: keyword bids, match types, negatives, RSAs, ' +
      'assets, recommendations, search-terms, conversion actions have NO Bing write/read path yet. READS: campaigns + daily ' +
      'metrics DO sync for Bing (platform-generic), but ad groups + ads do NOT (a server sync gap) — so `ad_groups.json` / ' +
      '`ads.json` are Google-only. Connect Bing Ads via the DASHBOARD (marketing/ppc) OAuth — the CLI OAuth initiate is ' +
      'Google-only. ' +
      'CAMPAIGN BUILD (Google): `ppc_campaign_create` → `ppc_ad_group_create` → `ppc_responsive_search_ad_create` → `ppc_keyword_add`. ' +
      'TUNE: `ppc_budget_update`, `ppc_keyword_bid_update`, `ppc_keyword_match_type_change`, `ppc_bid_modifier_update`, ' +
      '`ppc_bidding_strategy_update`, `ppc_negative_keyword_add` / `_remove` (mine `search_terms.json` for waste). ' +
      'ASSETS/AUDIENCES: `ppc_asset_create` → `ppc_asset_attach` / `_detach`; `ppc_custom_audience_create` → `ppc_audience_attach`; ' +
      'CRM loops `ppc_customer_match_upload` / `ppc_offline_conversion_upload`. ' +
      'STATE (Google): `ppc_pause_resource` / `ppc_enable_resource` (campaign/ad_group/ad/keyword). ' +
      'CHEAP WINS: read `recommendations.json` then `ppc_recommendation_apply`. Bulk: `ppc_bulk_edit`. ' +
      'DIAGNOSE: `ppc_conversion_tracking_status`, `ppc_disapprovals_list`, `ppc_anomaly_check`, `ppc_pacing_summary`. ' +
      'Most write tools take a `connection_id` + the resource id. Always `ppc_sync({ connection_id })` after big changes.',
    setup: PPC_SETUP,
  },
  {
    id: 'crm',
    label: 'CRM / Sales',
    setup: CRM_SETUP,
    gate: 'crm',
    datasets: [
      { id: 'deals', label: 'Deals', tool: 'crm_list_deals', args: { limit: 200 }, columns: [{ key: 'name' }, { key: 'value', money: true }, { key: ['stage.name', 'stage_name'], label: 'stage' }, { key: 'status' }, { key: 'close_date', label: 'close', date: true }] },
      { id: 'contacts', label: 'Contacts', tool: 'crm_list_contacts', args: { limit: 200 }, columns: [{ key: ['first_name', 'name'], label: 'name' }, { key: 'last_name' }, { key: 'email' }, { key: 'lifecycle_stage', label: 'stage' }, { key: 'lead_score', label: 'score' }] },
      { id: 'companies', label: 'Companies', tool: 'crm_list_companies', args: { limit: 200 }, columns: [{ key: 'name' }, { key: ['domain', 'website'], label: 'domain' }, { key: 'industry' }] },
      { id: 'pipelines', label: 'Pipelines', tool: 'crm_list_pipelines', columns: [{ key: 'name' }] },
      { id: 'sequences', label: 'Sequences', tool: 'crm_list_sequences', columns: [{ key: 'name' }, { key: 'is_active', label: 'active' }, { key: 'active_enrollments', label: 'enrolled' }] },
      { id: 'activities', label: 'Activities', tool: 'crm_list_activities', args: { limit: 200 }, columns: [{ key: ['subject', 'type', 'title'], label: 'subject' }, { key: 'type' }, { key: 'created_at', label: 'when', date: true }] },
      // Owner/id lookups the write tools need — never hardcode an owner_id or a status/source string.
      { id: 'users', label: 'Users (owner ids)', tool: 'crm_list_users', columns: [{ key: ['first_name', 'name'], label: 'first' }, { key: 'last_name', label: 'last' }, { key: 'email' }, { key: 'id' }] },
      { id: 'custom_fields', label: 'Custom fields', tool: 'crm_list_custom_fields', columns: [{ key: ['label', 'name'], label: 'name' }, { key: ['field_key', 'key'], label: 'key' }, { key: ['field_type', 'type'], label: 'type' }, { key: ['object_type', 'entity'], label: 'entity' }] },
      { id: 'lead_status_options', label: 'Lead status options', tool: 'crm_list_lead_status_options', columns: [{ key: ['label', 'name'], label: 'status' }, { key: 'id' }] },
      { id: 'lead_source_options', label: 'Lead source options', tool: 'crm_list_lead_source_options', columns: [{ key: ['label', 'name'], label: 'source' }, { key: 'id' }] },
    ],
    crud:
      'Contacts: `crm_create_contact` / `crm_update_contact` / `crm_delete_contact` / `crm_contact_upsert_by_email` / ' +
      '`crm_contact_merge` (bulk: `crm_import_preflight` then `crm_contacts_bulk_create`). Resolve `owner_id` from ' +
      '`users.json` (`crm_list_users`), never hardcode. ' +
      'Companies: `crm_create_company` / `crm_update_company` / `crm_delete_company` + `crm_link_contact_company`. ' +
      'Deals: `crm_create_deal` (name + pipeline_id + stage_id from `pipelines.json`) / `crm_update_deal` (stage moves, ' +
      'status, value) / `crm_delete_deal` + `crm_link_deal_contact` (bulk: `crm_deals_bulk_create`). ' +
      'Activities: `crm_create_activity` / `crm_update_activity` / `crm_delete_activity`. ' +
      'Sequences: enroll/leave with `crm_enroll_sequence` / `crm_unenroll_sequence` / `crm_pause_sequence_enrollment` / ' +
      '`crm_resume_sequence_enrollment`; edit steps via `crm_update_sequence` / `crm_update_sequence_step`. ' +
      'Tags: `crm_attach_tag` / `crm_detach_tag`. Custom fields: `crm_create_custom_field` / `crm_set_custom_field_value` ' +
      '(keys in `custom_fields.json`). Lead options: `crm_add_lead_status_option` / `crm_add_lead_source_option`. ' +
      'Compliance: `crm_set_dnc` / `crm_remove_dnc` before any outreach.',
  },
  {
    id: 'outbound',
    label: 'Outbound (BDR)',
    setup: OUTBOUND_SETUP,
    gate: 'outbound',
    datasets: [
      { id: 'campaigns', label: 'Campaigns', tool: 'outbound_list_campaigns', args: { limit: 200 }, columns: [{ key: ['name', 'campaign_name'], label: 'campaign' }, { key: 'status' }, { key: ['provider', 'integration_provider', 'integration_id'], label: 'provider' }, { key: ['lead_count', 'total_leads', 'leads_count'], label: 'leads' }, { key: ['reply_count', 'replied_count', 'replies'], label: 'replies' }] },
      { id: 'leads', label: 'Leads', tool: 'outbound_list_leads', args: { limit: 500 }, columns: [{ key: ['first_name', 'name'], label: 'name' }, { key: 'last_name' }, { key: 'email' }, { key: ['company', 'company_name'], label: 'company' }, { key: ['internal_status', 'status'], label: 'status' }, { key: 'is_interested', label: 'interested' }, { key: ['has_replied', 'replied'], label: 'replied' }, { key: ['campaign_name', 'campaign_id'], label: 'campaign' }] },
    ],
    crud:
      'Create a lead: `outbound_create_lead`. After a reply, mark interest/stage with ' +
      '`outbound_update_lead({lead_id, is_interested, internal_status})`. New campaign: `outbound_create_campaign`. ' +
      'Lists: `outbound_list_campaigns` / `outbound_list_leads` (filters: status, is_interested, has_replied, campaign_id). ' +
      'For Smartlead/HeyReach two-way sync, drive sends from those tools and persist replies here.',
  },
  {
    id: 'social',
    label: 'Social',
    setup: SOCIAL_SETUP,
    gate: 'marketing_social',
    datasets: [
      { id: 'accounts', label: 'Accounts', tool: 'social_list_accounts', columns: [{ key: ['display_name', 'name', 'username'], label: 'account' }, { key: 'platform' }, { key: 'follower_count', label: 'followers' }] },
      { id: 'posts', label: 'Posts', tool: 'social_list_posts', args: { limit: 200 }, columns: [{ key: ['title', 'content', 'caption'], label: 'post' }, { key: 'status' }, { key: ['scheduled_at', 'created_at'], label: 'when', date: true }] },
      { id: 'pillars', label: 'Pillars', tool: 'social_pillar_list', columns: [{ key: ['name', 'title'], label: 'pillar' }] },
    ],
    crud:
      'Posts: `social_create_post` / `social_update_post` (content/media/schedule ONLY) / `social_delete_post` / ' +
      '`social_publish_post`. NOTE `social_update_post` IGNORES status/approval_status — drive status via `scheduled_at` ' +
      '(draft↔scheduled) and `social_publish_post`; approval is dashboard-only. ' +
      'Pillars: `social_pillar_create` / `_update` / `_delete`. Sync analytics: `social_post_sync_analytics`. ' +
      'Connect social accounts via the Hiveku dashboard (OAuth). For brand-aligned copy, prefer `talk_to_department({ domain: "social" })` then persist.',
  },
  {
    id: 'content',
    label: 'Content',
    gate: 'marketing_content',
    datasets: [
      { id: 'content', label: 'Content', tool: 'content_list', args: { limit: 200 }, columns: [{ key: ['title', 'slug'], label: 'title' }, { key: 'status' }, { key: 'content_type', label: 'type' }, { key: ['scheduled_publish_at', 'published_at', 'created_at'], label: 'when', date: true }] },
      { id: 'templates', label: 'Templates', tool: 'marketing_content_templates', columns: [{ key: ['name', 'title'], label: 'template' }] },
    ],
    crud:
      'Content: `content_create` / `content_update` / `content_delete` / `content_schedule` (publish/unpublish at a time) / ' +
      '`content_link_tasks` / `content_unlink_tasks`. Templates + categories are dashboard-managed (read-only via MCP). ' +
      'For brand-aligned drafts, prefer `talk_to_department({ domain: "content" })` then persist with `content_create`.',
  },
  {
    id: 'email',
    label: 'Email Marketing',
    setup: EMAIL_SETUP,
    gate: 'marketing_email',
    datasets: [
      { id: 'campaigns', label: 'Campaigns', tool: 'email_campaign_list', args: { limit: 200 }, columns: [{ key: ['name', 'subject'], label: 'campaign' }, { key: 'status' }, { key: ['recipients_count', 'sent_count'], label: 'sent' }, { key: ['scheduled_at', 'created_at'], label: 'when', date: true }] },
      { id: 'audiences', label: 'Audiences', tool: 'email_audience_list', columns: [{ key: 'name' }, { key: 'kind' }, { key: 'estimated_size', label: 'size' }] },
      { id: 'sequences', label: 'Sequences', tool: 'email_sequence_list', columns: [{ key: 'name' }, { key: 'is_active', label: 'active' }, { key: 'total_enrolled', label: 'enrolled' }] },
      { id: 'templates', label: 'Templates', tool: 'email_template_list', columns: [{ key: 'name' }, { key: 'subject' }, { key: 'id' }] },
      { id: 'suppressions', label: 'Suppressions', tool: 'email_suppression_list', columns: [{ key: ['email_address', 'email'], label: 'email' }, { key: ['suppression_type', 'reason', 'type'], label: 'reason' }, { key: 'created_at', label: 'when', date: true }] },
    ],
    crud:
      'Campaigns: `email_campaign_create` / `_update` / `_schedule` / `_send_now` / `_pause` / `_resume` / `_cancel` / ' +
      '`_delete` / `_duplicate` / `_test_send` / `_resend_non_openers`; metrics: `email_campaign_metrics`. ' +
      'Audiences: `email_audience_create` / `_update` (edits filter_json) / `_archive` (soft-delete) + ' +
      '`email_audience_members_add` / `_remove`. ' +
      'Sequences: `email_sequence_create` / `_update` / `_add_step` / `_update_step` / `_delete_step` / `_activate` / ' +
      '`_pause` / `_archive`; enrollment `_enroll` / `_exit` / `_enrollments`. ' +
      'Suppressions (unsubscribes/bounces/compliance): `email_suppression_add` / `_remove` / `_list` — remove refuses on ' +
      'sticky bounce/complaint entries. Templates: `email_template_create` / `_update` / `_delete`. ' +
      'Sending domains: `email_domain_add` / `_verify` / `_set_default`.',
  },
  {
    id: 'accounting',
    label: 'Accounting & Finance',
    setup: ACCOUNTING_SETUP,
    gate: 'accounting',
    datasets: [
      { id: 'bills', label: 'Bills (AP)', tool: 'accounting_bill_list', args: { status: 'all', limit: 200 }, detail: { detailTool: 'accounting_bill_get', argKey: 'bill_id', nameKey: 'bill_number', dir: 'bills-detail' }, columns: [{ key: 'bill_number', label: 'bill' }, { key: ['vendor.name', 'vendor_name'], label: 'vendor' }, { key: 'status' }, { key: ['total_cents', 'amount_cents'], label: 'total', money: true, cents: true }, { key: 'due_date', label: 'due', date: true }] },
      { id: 'invoices', label: 'Invoices (AR)', tool: 'accounting_invoice_list', args: { status: 'all', limit: 200 }, columns: [{ key: 'invoice_number', label: 'invoice' }, { key: 'status' }, { key: ['total_cents'], label: 'total', money: true, cents: true }, { key: 'due_date', label: 'due', date: true }] },
      { id: 'vendors', label: 'Vendors', tool: 'accounting_vendor_list', args: { limit: 500 }, columns: [{ key: 'name' }, { key: 'email' }, { key: ['default_payment_terms', 'terms'], label: 'terms' }, { key: ['target_currency', 'currency'], label: 'currency' }] },
      { id: 'members', label: 'Payroll members', tool: 'accounting_member_list', columns: [{ key: 'name' }, { key: 'pay_rate', label: 'rate' }, { key: 'pay_rate_type', label: 'type' }, { key: 'pay_period', label: 'period' }] },
      { id: 'payroll_runs', label: 'Payroll runs', tool: 'accounting_payroll_run_list', columns: [{ key: ['label', 'period'], label: 'period' }, { key: 'status' }, { key: ['total_cents'], label: 'total', money: true, cents: true }, { key: 'member_count', label: 'members' }] },
      { id: 'expense_categories', label: 'Expense categories', tool: 'accounting_expense_category_list', columns: [{ key: 'name' }, { key: ['code', 'account_code'], label: 'code' }, { key: 'id' }] },
    ],
    references: [
      { id: 'ap-aging', label: 'AP aging', tool: 'accounting_ap_aging' },
      { id: 'ar-aging', label: 'AR aging', tool: 'accounting_ar_aging' },
      { id: 'pnl-summary', label: 'P&L summary', tool: 'accounting_pnl_summary' },
    ],
    crud:
      'Bills (AP): `accounting_bill_create` → `accounting_bill_submit` → `accounting_bill_approve` → ' +
      '`accounting_bill_record_payment` / `accounting_bill_void`. Vendors: `accounting_vendor_create`. ' +
      'Payroll members: `accounting_member_create`; runs: `accounting_payroll_run_create` (computes from tracked time × rate). ' +
      'AR invoice payments: `accounting_invoice_record_payment` (invoice AUTHORING is CRM-side: ' +
      '`crm_estimate_convert_to_invoice`). All money fields are in CENTS. Aging + P&L are summary objects (the `*.json` references).',
  },
  {
    id: 'creative',
    label: 'Brand & Creative',
    gate: 'marketing',
    datasets: [
      { id: 'avatars', label: 'Customer avatars', tool: 'customer_avatar_list', args: { limit: 100 }, detail: { detailTool: 'customer_avatar_get', nameKey: 'name' }, columns: [{ key: 'name' }, { key: 'occupation' }, { key: 'location' }, { key: 'income_range', label: 'income' }] },
      { id: 'journeys', label: 'Customer journeys', tool: 'customer_journey_list', detail: { detailTool: 'customer_journey_get', nameKey: 'name' }, columns: [{ key: 'name' }, { key: 'is_active', label: 'active' }] },
      { id: 'brand-guides', label: 'Brand guides', tool: 'brand_guide_list', detail: { detailTool: 'brand_guide_get', nameKey: 'name' }, columns: [{ key: 'name' }, { key: 'color_primary', label: 'color' }, { key: 'is_default', label: 'default' }] },
      { id: 'grids', label: 'Before/after grids', tool: 'before_after_grid_list', detail: { detailTool: 'before_after_grid_get', nameKey: 'name' }, columns: [{ key: 'name' }, { key: 'is_active', label: 'active' }] },
      { id: 'designs', label: 'Designs', tool: 'design_list', detail: { detailTool: 'design_state_get', nameKey: 'title' }, columns: [{ key: 'title' }, { key: ['design_type', 'designType'], label: 'type' }, { key: 'status' }] },
    ],
    crud:
      'Avatars / journeys / brand-guides / grids: `*_create` / `*_update` / `*_delete`. AI-fill with `*_populate` ' +
      '(avatars, journeys, grids — NOT brand guides); relate with `*_link_to_avatar` (journeys + grids only). ' +
      'Brand guide: delete is SOFT (`brand_guide_delete`) then `brand_guide_purge` for hard; logo via `brand_guide_set_logo`. ' +
      'Designs: READ the canvas FIRST via `design_get` / `design_state_get` (design_update REPLACES the whole canvasData — ' +
      'a blind overwrite otherwise); snapshot with `design_version_create` BEFORE destructive edits; export via ' +
      '`design_export_image` / `design_export_mp4`. ' +
      'The four marketing entities (avatars/journeys/brand-guides/grids) are dumped full to `<dataset>/<item>.json`; ' +
      'designs are list-only locally (use `design_state_get` for the canvas).',
  },
  {
    id: 'helpdesk',
    label: 'Helpdesk',
    gate: 'helpdesk',
    datasets: [
      { id: 'tickets', label: 'Tickets', tool: 'helpdesk_ticket_list', args: { limit: 200 }, columns: [{ key: ['subject', 'title'], label: 'subject' }, { key: 'status' }, { key: 'priority' }, { key: 'channel' }, { key: 'assigned_to_id', label: 'assignee' }, { key: 'last_activity_at', label: 'activity', date: true }] },
      { id: 'queues', label: 'Queues', tool: 'helpdesk_queues_list', columns: [{ key: 'name' }, { key: 'strategy' }, { key: 'member_count', label: 'members' }, { key: 'is_active', label: 'active' }] },
      { id: 'macros', label: 'Macros', tool: 'helpdesk_macros_list', args: { limit: 200 }, columns: [{ key: 'title' }, { key: 'tags' }, { key: 'usage_count', label: 'uses' }] },
      { id: 'kb_categories', label: 'KB categories', tool: 'helpdesk_kb_categories_list', columns: [{ key: 'name' }, { key: 'parent_id', label: 'parent' }, { key: 'article_count', label: 'articles' }] },
      { id: 'csat', label: 'CSAT', tool: 'helpdesk_csat_list', args: { limit: 200 }, columns: [{ key: 'ticket_id', label: 'ticket' }, { key: 'rating' }, { key: 'feedback' }] },
      { id: 'automations', label: 'Automations (read-only)', tool: 'helpdesk_automations_get', columns: [{ key: 'name' }, { key: 'is_active', label: 'active' }, { key: 'trigger' }] },
    ],
    crud:
      'Tickets: `helpdesk_ticket_create`; update via `helpdesk_ticket_set_status` / `_set_priority` / `_assign` / ' +
      '`_add_message` / `_send_reply` (render a macro first with `helpdesk_macros_render`) / `_escalate_to_human` / ' +
      '`_transfer_to_voice` / `_merge` (no hard delete — close/merge). ' +
      'Queues: `helpdesk_queues_create` / `_update` / `_delete` (+ `_add_member` / `_remove_member`). ' +
      'Macros: `helpdesk_macros_create` / `_update` / `_delete` / `_render`. ' +
      'KB categories: `helpdesk_kb_categories_create` (list via `helpdesk_kb_categories_list`; no update/delete — create-only). ' +
      'KB articles: `helpdesk_kb_article_create` / `_update` / `_delete` (no list-all tool — find via `helpdesk_kb_search({ q })`).',
  },
  {
    id: 'pm',
    label: 'Projects & Tasks',
    gate: 'pm_projects',
    datasets: [
      { id: 'projects', label: 'PM projects', tool: 'pm_projects_list', columns: [{ key: 'name' }, { key: 'project_type', label: 'type' }, { key: 'status' }, { key: 'task_count', label: 'tasks' }, { key: 'created_at', label: 'created', date: true }] },
      { id: 'tasks', label: 'Tasks', tool: 'pm_tasks_list', args: { limit: 500 }, columns: [{ key: ['task_number', 'id'], label: '#' }, { key: 'title' }, { key: 'status' }, { key: ['assigned_to.name', 'assigned_to.email'], label: 'assignee' }, { key: 'priority' }, { key: 'task_type', label: 'type' }, { key: 'due_date', label: 'due', date: true }, { key: 'project.name', label: 'project' }] },
      { id: 'milestones', label: 'Milestones', tool: 'pm_milestones_list', columns: [{ key: 'name' }, { key: 'status' }, { key: 'due_date', label: 'due', date: true }] },
      { id: 'recurrences', label: 'Recurring tasks', tool: 'pm_task_recurrence_list', columns: [{ key: 'title' }, { key: 'cron' }, { key: 'is_active', label: 'active' }, { key: 'last_fired_at', label: 'last fired', date: true }] },
      { id: 'sections', label: 'Sections', tool: 'pm_sections_list', scope: { parentTool: 'pm_projects_list', parentIdKey: 'id', parentLabelKey: 'name', argKey: 'project_id' }, columns: [{ key: '_parent', label: 'project' }, { key: 'name' }, { key: 'sort_order', label: 'order' }] },
    ],
    crud:
      'Projects: `pm_projects_create` / `_update` / `_delete`. Tasks: `pm_tasks_create` (+`_create_bulk`) / `_update` / ' +
      '`_delete` / `_complete` / `_uncomplete` / `_comment` / `_reassign_bulk`; attachments `pm_task_attachment_create` / ' +
      '`_delete`. Sections: `pm_sections_create` (project_id + name [+ sort_order]; no update/delete tool — create-only). ' +
      'Milestones: `pm_milestones_create` / `_update` / `_delete` / `_close`. ' +
      'Recurrences: `pm_task_recurrence_create` / `_update` / `_delete` / `_pause` / `_resume` / `_run_now`.',
  },
  {
    id: 'mc',
    label: 'Mission Control',
    gate: 'pm_projects',
    datasets: [
      { id: 'tasks', label: 'MC cards', tool: 'mc_tasks_list', args: { limit: 200 }, columns: [{ key: 'title' }, { key: 'status' }, { key: 'priority' }, { key: ['lane_id', 'lane'], label: 'lane' }, { key: 'assignee' }, { key: 'created_at', label: 'created', date: true }] },
      { id: 'lanes', label: 'Lanes', tool: 'mc_lanes_list', columns: [{ key: 'name' }, { key: ['display_order', 'order'], label: 'order' }, { key: 'color' }] },
      { id: 'schedules', label: 'Recurring-card schedules', tool: 'mc_schedules_list', columns: [{ key: 'name' }, { key: 'cron' }, { key: 'template_name', label: 'template' }, { key: 'enabled' }] },
      { id: 'templates', label: 'Card templates', tool: 'mc_templates_list', columns: [{ key: 'name' }, { key: 'domain' }] },
      { id: 'decisions', label: 'Pending decisions (HITL)', tool: 'mc_decisions_pending', args: { limit: 100 }, columns: [{ key: ['title', 'task_title'], label: 'card' }, { key: 'priority' }, { key: 'created_at', label: 'raised', date: true }] },
    ],
    crud:
      'Mission Control is the account-wide operator QUEUE (distinct from PM projects). Signals: `mc_tasks_next` ' +
      '(what to work now), `mc_sla_breached`, `mc_tasks_stalled`, `mc_tasks_aged`. ' +
      'Cards: `mc_task_create({ title, lane_id?, priority?, decision_options? })` / `mc_task_transition({ id, to_status })` / ' +
      '`mc_task_comment` / `mc_task_decide` (resolve a HITL choice). ' +
      'HUMAN-IN-THE-LOOP: poll `mc_decisions_pending` → present each to the user → `mc_decision_check` / `mc_task_decide`; ' +
      'persist the ruling with `mc_decision_to_memory` so the agents learn it. ' +
      'Lanes (board columns): `mc_lane_create` / `_update` / `_delete`. ' +
      'RECURRING work: `mc_schedule_create({ name, cron, template_name, target_account_filter })` spawns one card per ' +
      'account on a cron; manage via `mc_schedule_update` / `_delete` / `_fire` (run now). ' +
      'Card templates: `mc_template_create` / `_update`; render with `mc_templates_render`. ' +
      'External intake (email/webhook → a card): `mc_intake_external` then `mc_intake_classify`. ' +
      'Turn a card into board work: `mc_task_spawn_pm` (create a linked PM task) / `mc_task_link_pm` / `mc_task_mirror_from_pm`.',
  },
  {
    id: 'voice',
    label: 'Communications (Voice)',
    gate: 'communications',
    readOnly: true,
    datasets: [
      { id: 'numbers', label: 'Numbers', tool: 'voice_numbers_list', args: { limit: 200 }, columns: [{ key: ['e164', 'number'], label: 'number' }, { key: 'is_active', label: 'active' }, { key: 'provider' }] },
      { id: 'extensions', label: 'Extensions', tool: 'voice_extensions_list', args: { limit: 200 }, columns: [{ key: 'extension' }, { key: 'display_name', label: 'name' }, { key: 'endpoint_type', label: 'type' }, { key: 'presence_state', label: 'presence' }] },
      { id: 'ring_groups', label: 'Ring groups', tool: 'voice_ring_groups_list', columns: [{ key: 'name' }, { key: 'strategy' }, { key: 'member_count', label: 'members' }] },
      { id: 'ivrs', label: 'IVRs', tool: 'voice_ivrs_list', columns: [{ key: 'name' }] },
      { id: 'e911', label: 'E911 addresses', tool: 'voice_e911_addresses_list', args: { limit: 200 }, columns: [{ key: ['label', 'name'], label: 'label' }, { key: ['street', 'address'], label: 'address' }, { key: 'city' }, { key: ['state', 'region'], label: 'state' }, { key: 'postal_code', label: 'zip' }] },
      { id: 'calls', label: 'Recent calls', tool: 'voice_calls_list', args: { limit: 200 }, columns: [{ key: 'direction' }, { key: 'disposition' }, { key: ['from_e164', 'from'], label: 'from' }, { key: ['to_e164', 'to'], label: 'to' }, { key: 'started_at', label: 'started', date: true }] },
    ],
  },
  {
    id: 'hiveboards',
    label: 'Hiveboards',
    gate: 'hiveboards',
    datasets: [
      { id: 'hiveboards', label: 'Boards', tool: 'hiveboard_list', args: { limit: 200 }, detail: { detailTool: 'hiveboard_get', argKey: 'board_id', nameKey: 'name', dir: 'boards' }, columns: [{ key: 'name' }, { key: 'element_count', label: 'elements' }, { key: ['last_edited_at', 'updated_at'], label: 'updated', date: true }] },
    ],
    crud:
      'Boards: `hiveboard_create` / `_update` / `_delete` / `_duplicate`. Elements: `hiveboard_element_create` / `_update` / ' +
      '`_delete` (+ `hiveboard_elements_bulk_create`, `hiveboard_sitemap_scaffold`). Each board\'s full element graph is in ' +
      '`boards/<board>.json`.',
  },
  {
    id: 'knowledge',
    label: 'Knowledge & Memory',
    datasets: [
      { id: 'memory', label: 'AI memory (skills/rules/facts)', tool: 'memory_list', detail: { detailTool: 'memory_get', argKey: 'memory_id', nameKey: 'domain', dir: 'memory-detail' }, columns: [{ key: 'domain' }, { key: 'type' }, { key: 'version' }] },
      { id: 'kbs', label: 'Knowledge bases', tool: 'kb_list', columns: [{ key: 'name' }, { key: 'context_type', label: 'type' }, { key: 'is_default', label: 'default' }, { key: 'tags' }] },
      { id: 'kb_documents', label: 'KB documents', tool: 'kb_documents_list', scope: { parentTool: 'kb_list', parentIdKey: 'id', parentLabelKey: 'name', argKey: 'kb_id' }, columns: [{ key: '_parent', label: 'kb' }, { key: 'title' }, { key: 'source_url', label: 'source' }, { key: 'tags' }] },
    ],
    crud:
      'Memory: `memory_create` / `memory_bulk_create` / `memory_update` / `memory_delete` (versioned, recoverable). ' +
      'KBs: `kb_create` / `kb_update` / `kb_delete`; documents: `kb_documents_index_text` (create+embed) / `kb_documents_delete`. ' +
      'Each memory\'s full markdown content is in `memory-detail/<domain>.json`.',
  },
  {
    id: 'media',
    label: 'Media Library',
    datasets: [
      { id: 'assets', label: 'Assets', tool: 'media_library_list', args: { limit: 200 }, columns: [{ key: ['title', 'filename'], label: 'file' }, { key: 'media_type', label: 'type' }, { key: 'source_type', label: 'source' }, { key: 'tags' }] },
      { id: 'folders', label: 'Folders', tool: 'media_folders_list', columns: [{ key: 'name' }, { key: 'asset_count', label: 'assets' }] },
      { id: 'collections', label: 'Collections', tool: 'media_collections_list', columns: [{ key: 'name' }, { key: 'is_public', label: 'public' }] },
    ],
    crud:
      'Assets: `media_upload` (base64) / `media_library_register_external_url`, `media_update` (metadata only — bytes are ' +
      'immutable, delete+re-upload), `media_delete` (`force:true` to orphan an in-use asset). Folders: `media_folder_create` / ' +
      '`_update` / `_delete`. Collections: `media_collection_create` / `_update` / `_delete` (+ `_add_item` / `_remove_item`).',
  },
  {
    id: 'localseo',
    label: 'Local SEO (GBP, GSC, Bing)',
    gate: 'marketing_seo',
    datasets: [
      { id: 'connections', label: 'SEO data sources', tool: 'seo_connections_list', columns: [{ key: 'platform' }, { key: ['connection_status', 'status'], label: 'status' }, { key: ['site_url', 'gbp_location_id', 'display_name'], label: 'bound to' }, { key: 'last_synced_at', label: 'synced', date: true }] },
      { id: 'top_queries', label: 'Top queries (GSC+Bing)', tool: 'seo_local_top_queries', args: { days: 90, source: 'all', limit: 200 }, columns: [{ key: ['query', 'keyword'], label: 'query' }, { key: ['_sum.clicks', 'clicks'], label: 'clicks' }, { key: ['_sum.impressions', 'impressions'], label: 'impr' }, { key: ['_avg.ctr', 'ctr'], label: 'ctr' }, { key: ['_avg.position', 'position'], label: 'position' }] },
      { id: 'top_pages', label: 'Top pages', tool: 'seo_local_top_pages', args: { days: 90, limit: 200 }, columns: [{ key: ['page', 'url'], label: 'page' }, { key: ['_sum.clicks', 'clicks'], label: 'clicks' }, { key: ['_sum.impressions', 'impressions'], label: 'impr' }, { key: ['_avg.position', 'position'], label: 'position' }] },
      { id: 'rank_changes', label: 'Rank drops', tool: 'seo_local_rank_changes', args: { days: 30, min_drop: 3 }, columns: [{ key: ['keyword', 'query'], label: 'keyword' }, { key: ['drop', 'position_change'], label: 'drop' }, { key: ['current_position', 'position'], label: 'now' }] },
      { id: 'gbp_insights', label: 'GBP insights', tool: 'seo_gbp_insights', args: { limit: 90 }, scope: seoConnScope, columns: [{ key: '_parent', label: 'source' }, { key: 'date', date: true }, { key: 'website_clicks', label: 'web' }, { key: 'call_clicks', label: 'calls' }, { key: 'direction_requests', label: 'directions' }] },
      { id: 'gbp_reviews', label: 'GBP reviews', tool: 'seo_gbp_reviews', args: { limit: 100 }, scope: seoConnScope, columns: [{ key: '_parent', label: 'source' }, { key: 'rating' }, { key: ['comment', 'text'], label: 'review' }, { key: 'reply_state', label: 'replied' }] },
      // Bing Webmaster organic data (direct seo_bing_* — needs a bing_webmaster connection).
      { id: 'bing_query_stats', label: 'Bing query stats', tool: 'seo_bing_query_stats', columns: [{ key: ['query', 'Query'], label: 'query' }, { key: ['clicks', 'Clicks'], label: 'clicks' }, { key: ['impressions', 'Impressions'], label: 'impr' }, { key: ['avg_position', 'AvgImpressionPosition'], label: 'position' }] },
      { id: 'bing_pages', label: 'Bing pages', tool: 'seo_bing_pages', columns: [{ key: ['page', 'Query', 'url'], label: 'page' }, { key: ['clicks', 'Clicks'], label: 'clicks' }, { key: ['impressions', 'Impressions'], label: 'impr' }, { key: ['avg_position', 'AvgImpressionPosition'], label: 'position' }] },
      { id: 'bing_crawl_stats', label: 'Bing crawl stats', tool: 'seo_bing_crawl_stats', columns: [{ key: ['date', 'Date'], label: 'date', date: true }, { key: ['crawled_pages', 'CrawledPages'], label: 'crawled' }, { key: ['in_index', 'InIndex'], label: 'indexed' }, { key: ['crawl_errors', 'CrawlErrors'], label: 'errors' }] },
      { id: 'bing_backlinks', label: 'Bing backlinks', tool: 'seo_bing_backlinks', columns: [{ key: ['url', 'Url'], label: 'url' }, { key: ['inbound_links', 'TotalInboundLinks', 'count'], label: 'links' }] },
    ],
    references: [{ id: 'search-performance', label: 'Search performance (GSC+Bing summary)', tool: 'seo_local_search_performance', args: { days: 90, source: 'all' } }],
    crud:
      'Local SEO data is read + sync. GBP review replies + posts happen in the GBP UI; rank tracking via `seo_track_keyword`. ' +
      'CONNECT a source: `seo_connection_create({ platform: "bing_webmaster"|"google_search_console"|"google_business_profile", site_url, ... })` ' +
      '(Bing needs only { platform, site_url, api_key } — no OAuth), then `seo_connection_update` to bind + `seo_sync`. ' +
      'Bing organic tools: `seo_bing_query_stats` / `_pages` / `_crawl_stats` / `_backlinks` / `_stats` / `_period_comparison`. ' +
      'Submit sitemaps/URLs: `seo_gsc_submit_sitemap` / `seo_bing_submit_sitemap` / `seo_bing_submit_url`. Refresh: `seo_sync`. ' +
      'See SETUP.md to connect Google Business Profile / Search Console / Bing Webmaster.',
    setup: LOCALSEO_SETUP,
  },
  {
    id: 'aeo',
    label: 'AEO (Answer Engine Optimization)',
    gate: 'marketing_seo',
    datasets: [
      { id: 'audit', label: 'AEO audit (AI Overview / snippets / PAA)', tool: 'seo_aeo_audit_get', args: { limit: 300 }, columns: [{ key: 'keyword' }, { key: ['domain' ], label: 'domain' }, { key: ['ai_overview_present', 'has_ai_overview'], label: 'AI overview' }, { key: ['domain_in_ai_overview', 'domain_cited'], label: 'cited' }, { key: ['featured_snippet_present', 'has_snippet'], label: 'snippet' }, { key: ['paa_present', 'has_paa'], label: 'PAA' }, { key: 'checked_at', label: 'checked', date: true }] },
    ],
    crud:
      'Run a fresh audit: `seo_aeo_audit_run({ domain, keywords:[...], max_keywords:25 })` (DataForSEO cost ~1/keyword). ' +
      'Read latest (free): `seo_aeo_audit_get({ domain })`. Sync tracked AEO ranks: `seo_aeo_rankings_sync`. ' +
      'Use the per-keyword AI-Overview/snippet/PAA gaps to prioritize content + schema; see SETUP.md.',
    setup: AEO_SETUP,
  },
  {
    id: 'commerce',
    label: 'Commerce (Shopify + quotes)',
    gate: 'commerce',
    datasets: [
      { id: 'shopify_connections', label: 'Shopify stores', tool: 'shopify_connection_status', columns: [{ key: 'shop_name', label: 'store' }, { key: 'shop_domain', label: 'domain' }, { key: 'scope' }, { key: 'installed_at', label: 'installed', date: true }] },
      { id: 'products', label: 'Products', tool: 'shopify_catalog_list', args: { params: { first: 100 } }, scope: siteScope, columns: [{ key: '_parent', label: 'site' }, { key: 'handle' }, { key: 'title' }, { key: 'status' }, { key: 'totalInventory', label: 'stock' }, { key: 'price', money: true }] },
      { id: 'estimates', label: 'Estimates', tool: 'crm_estimate_list', columns: [{ key: 'estimate_number', label: 'estimate' }, { key: 'status' }, { key: ['total_cents'], label: 'total', money: true, cents: true }] },
      { id: 'contracts', label: 'Contracts (e-sign)', tool: 'crm_envelope_list', columns: [{ key: 'title' }, { key: 'status' }, { key: 'subject_type', label: 'type' }] },
    ],
    crud:
      'Shopify products/orders are managed in Shopify Admin (read here; drafts via `shopify_admin({admin_action:"create_product_draft"})`). ' +
      'Estimates: `crm_estimate_create` / `_update` (draft; 409 on accepted/converted) / `_send` / `_mark_accepted` / ' +
      '`_convert_to_invoice` / `_delete` (soft-delete a draft). ' +
      'Contracts: `crm_envelope_create` / `_update` (draft only — retitle, swap layout, edit signer roster) / `_send` / `_void` ' +
      '(add signers via `crm_envelope_add_signer`). See SETUP.md to connect a Shopify store.',
    setup: COMMERCE_SETUP,
  },
  {
    id: 'pages',
    label: 'Website Pages',
    gate: 'websites',
    datasets: [
      { id: 'pages', label: 'Pages', tool: 'pages_list', scope: siteScope, columns: [{ key: '_parent', label: 'site' }, { key: 'name' }, { key: 'slug' }, { key: ['page_type', 'type'], label: 'type' }, { key: 'is_published', label: 'published' }] },
    ],
    crud:
      'Pages are per website project (project_id from sites_list). Create: `pages_create({project_id, name, slug, page_type})`; ' +
      'update/SEO/nav: `pages_update`; homepage: `pages_set_homepage`. Hard delete: `pages_delete({project_id, page_id})` ' +
      '(destructive — removes the row; prefer unpublishing via `pages_update` when you only want it off the live site). ' +
      'For page CODE, download the project and edit files; for CMS-driven content use the Website Content (CMS) department.',
  },
  {
    id: 'analytics',
    label: 'Analytics & Visitors',
    gate: 'visitor_intelligence',
    readOnly: true,
    datasets: [
      { id: 'visitors', label: 'Visitor intelligence', tool: 'analytics_visitors', args: { limit: 100, sort_by: 'last_seen' }, columns: [{ key: ['name', 'email'], label: 'visitor' }, { key: 'email' }, { key: 'icp_match_confidence', label: 'ICP fit' }, { key: 'event_count', label: 'events' }, { key: 'last_seen_at', label: 'last seen', date: true }] },
      { id: 'top_pages', label: 'Top pages (90d)', tool: 'analytics_pages', args: { limit: 200 }, dynArgs: { from_date: 90, to_date: 0 }, scope: siteScope, columns: [{ key: '_parent', label: 'site' }, { key: ['path', 'url', 'page'], label: 'page' }, { key: ['pageviews', 'views'], label: 'views' }, { key: 'sessions' }, { key: ['bounce_rate', 'bounce'], label: 'bounce' }] },
      { id: 'sessions', label: 'Sessions (90d)', tool: 'analytics_sessions', args: { limit: 200 }, dynArgs: { from_date: 90, to_date: 0 }, scope: siteScope, columns: [{ key: '_parent', label: 'site' }, { key: 'country' }, { key: ['device_category', 'device'], label: 'device' }, { key: ['source', 'referrer'], label: 'source' }, { key: ['started_at', 'created_at'], label: 'started', date: true }] },
    ],
  },
  {
    id: 'cms',
    label: 'Website Content (CMS)',
    gate: 'websites',
    datasets: [
      { id: 'collections', label: 'Collections', tool: 'cms_list_collections', scope: siteScope, columns: [{ key: '_parent', label: 'site' }, { key: 'name' }, { key: 'format' }, { key: 'field_count', label: 'fields' }, { key: 'route_pattern', label: 'route' }] },
      // Two-level: site → collection → entries. Local index of all CMS content;
      // read/edit full bodies with cms_read_entry / cms_write_entry (needs slug).
      { id: 'entries', label: 'Entries', tool: 'cms_list_entries', args: { limit: 200 }, scope: [siteScope, { parentTool: 'cms_list_collections', parentIdKey: 'id', parentLabelKey: 'name', argKey: 'collection_id' }], columns: [{ key: '_parent', label: 'site / collection' }, { key: ['slug', 'id'], label: 'slug' }, { key: ['title', 'name'], label: 'title' }, { key: 'status' }, { key: ['updated_at', 'date'], label: 'updated', date: true }] },
    ],
    crud:
      'Collections (per project_id from sites_list): `cms_create_collection` / `cms_delete_collection`; fields via ' +
      '`cms_add_field` / `cms_update_field` / `cms_remove_field` (types from `cms_field_types`); full schema `cms_read_manifest`. ' +
      'ENTRIES are downloaded too (`entries.json`, tagged `_parent` = "site / collection"). Read full bodies / edit with ' +
      '`cms_read_entry` → `cms_write_entry` (upsert by slug) / `cms_delete_entry` (versioned via `cms_list_entry_versions` / ' +
      '`cms_restore_entry_version`). ' +
      'PUBLISH/SCHEDULE: `cms_write_entry` takes top-level status=draft|published|scheduled + publish_at (ISO); publish a saved ' +
      'draft live with `cms_promote_draft` (force:true overrides the 409 lost-update guard). Site code date-gates on publishAt — ' +
      'no cron flips status. BULK-create in ONE call with `cms_bulk_import` (entries:[{slug?,fields}], on_conflict=skip|overwrite) ' +
      'instead of N `cms_write_entry` calls. collection_id is the collection slug from the manifest, not a UUID.',
  },
  {
    id: 'database',
    label: 'Project Database',
    gate: 'websites',
    datasets: [
      { id: 'tables', label: 'Tables', tool: 'database_tables', scope: siteScope, columns: [{ key: '_parent', label: 'site' }, { key: ['table_name', 'name', 'table', 'value'], label: 'table' }] },
      // Two-level: site → table → columns. The full schema, grep-able locally.
      { id: 'schema', label: 'Schema (columns)', tool: 'database_describe', scope: [siteScope, { parentTool: 'database_tables', parentIdKey: 'table_name', parentLabelKey: 'table_name', argKey: 'table' }], columns: [{ key: '_parent', label: 'site / table' }, { key: ['column_name', 'name', 'column'], label: 'column' }, { key: ['data_type', 'type'], label: 'type' }, { key: ['is_nullable', 'nullable'], label: 'null' }, { key: ['column_default', 'default'], label: 'default' }] },
    ],
    crud:
      'Per website project (project_id from sites_list). Inspect: `database_status`, `database_tables`, ' +
      '`database_describe({project_id, table})` (columns/types). Read: `database_query({project_id, sql})` (SELECT only). ' +
      'WRITE: `database_execute({project_id, sql})` — INSERT/UPDATE/DELETE/DDL, NOT sandboxed (destructive; no per-table guardrails). ' +
      'Provision: `database_provision`. The full SCHEMA is downloaded (`schema.json` = every column/type/nullable per table, ' +
      'tagged "site / table"); ROW data is arbitrary SQL, so `database_query` it live rather than expecting pre-baked files.',
  },
];

export function departmentById(id: string): Department | undefined {
  return DEPARTMENTS.find((d) => d.id === id);
}

// ── Local data-runner manifest ────────────────────────────────────────────────
/**
 * Serializable snapshot of the registry for `.hiveku/pull-data.mjs` (the runner
 * Claude Code executes to pull/refresh hiveku-data/ WITHOUT the extension).
 * Regenerated from DEPARTMENTS on every scaffold/export — the runner itself is
 * generic and dataset-agnostic, so registry changes never drift.
 */
export function dataManifest(defaultDeptIds?: string[]): Record<string, unknown> {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    // The role's departments — what `--default` (and no-arg staleness) pulls.
    default_departments: defaultDeptIds && defaultDeptIds.length ? defaultDeptIds : DEPARTMENTS.map((d) => d.id),
    departments: DEPARTMENTS.map((d) => ({
      id: d.id,
      label: d.label,
      ...(d.readOnly ? { read_only: true } : {}),
      // Doc strings ride along so the runner can write README.md (the CRUD
      // how-to) and SETUP.md locally — scaffold-only accounts must not need an
      // extension export to learn the write path.
      ...(d.crud ? { crud: d.crud } : {}),
      ...(d.setup ? { setup: d.setup } : {}),
      datasets: d.datasets.map((ds) => ({
        id: ds.id,
        label: ds.label,
        tool: ds.tool,
        ...(ds.args ? { args: ds.args } : {}),
        ...(ds.dynArgs ? { dyn_args: ds.dynArgs } : {}),
        ...(ds.scope ? { scope: Array.isArray(ds.scope) ? ds.scope : [ds.scope] } : {}),
        ...(ds.detail ? { detail: ds.detail } : {}),
      })),
      ...(d.references?.length
        ? { references: d.references.map((r) => ({ id: r.id, label: r.label, tool: r.tool, ...(r.args ? { args: r.args } : {}) })) }
        : {}),
    })),
  };
}
