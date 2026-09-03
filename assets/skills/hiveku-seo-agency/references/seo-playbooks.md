# Reference: SEO Playbooks - twelve end-to-end recipes

## What this covers / when to load this

The jobs an SEO client actually asks for, each as an ordered recipe: goal, preconditions, tools in
order with every confirmation gate and metered call marked, the read-back after each write, what
to tell the client, what to file. This is the choreography; depth lives in the sibling reference
each step names. Load it when a `/hiveku:seo-*` command runs, at engagement start, before a
migration, redesign or new location, on a traffic crash, or for "rank for X". Not for one tool
family's mechanics, the write discipline behind one mutation
(seo-change-discipline.md), or report assembly (reporting-and-delivery.md).

**How to read a recipe:**

- **[CONFIRM]**: show the exact before/after (or draft, list, spend), get an explicit yes on THAT
  plan, make the one write. One object per yes; a batch is confirmed as a reviewed list.
- **[SPENDS]**: a metered DataForSEO call, tagged with cost class and request count (B Labs and
  keywords_data; C live SERP per location; D backlinks; E on_page per URL; F crawl per page; G LLM
  mentions about $0.10 per keyword per engine; H LLM-scored, budget-gated; I the citations audit).
  A 402 is a negative balance, a 503 `dataforseo_unconfigured` is no credentials: neither is clean.
- **Read back after every write**: the read-back named in the step is the verification, not the
  200. **Hydrate first**: `account_context_get({ domain: 'seo' })` and `memory_list({ domain:
  'seo' })` (`include_project_scoped: true` on project-scoped accounts) before every recipe.
- **Two id spaces**: `seo_list_projects` = the SEO TRACKING project id (keywords, audits,
  competitors, clusters); `sites_list` = the builder WEBSITE project id (`pages_*`, `project_*`,
  `deploy_site`, `seo_project_get`).

## Availability

| Recipe | Fully live today? |
|---|---|
| 1. New-client onboarding | LIVE end to end |
| 2. Strategy and forecast | LIVE end to end |
| 3. Weekly pass | LIVE end to end |
| 4. Monthly report | LIVE end to end |
| 5. Quarterly hygiene | LIVE end to end |
| 6. Site migration | LIVE on a full-profile key |
| 7. New-location launch | LIVE end to end |
| 8. Algorithm-update response | LIVE end to end |
| 9. Traffic-crash triage | LIVE end to end |
| 10. "Rank for X" | LIVE end to end |
| 11. Content refresh sprint | LIVE end to end |
| 12. Ecommerce / Shopify | Reads LIVE; a store Hiveku does not host gets client tasks |

---

## Recipe 1: New-client onboarding, month 1

**Goal:** the before-state every future report reconciles against, captured once; nothing on the
site changes. Compress the baseline if you must, never skip it. `get_account_info` confirms the
account; the client's competitor list and GSC property string in hand.

1. `seo_list_projects` for the SEO tracking `project_id`; none means `seo_create_project({ domain,
   name, target_country, target_language })` [CONFIRM]; read back `seo_list_projects`.
2. `seo_connections_list`: per platform, present, status, `last_error`; copy the GSC `site_url`
   VERBATIM (sc-domain vs url-prefix differ). Missing sources: `seo_connection_create` per
   `references/outcomes-and-measurement.md` [CONFIRM, BYOK], then `seo_sync`. The one-call health
   read is `seo_connections_health` (see that file).
3. `seo_sync({ project_id, full: true })` [CONFIRM on a large account; it fans out]. Read back
   `seo_rankings_list({ domain, group_by_keyword: true, limit: 200 })`:
   `pagination.total_groups` is the keyword count.
4. Crawl: `web_map({ url })` for the URL count, then `seo_audit_start({ project_id, target_url,
   max_crawl_pages })` [SPENDS F per page; default 50, clamp 500; name the count]. It returns 202 with
   `audit_id` and `task_id` ('queued'); `seo_audit_get` polls and persists (live since
   2026-08-30); 25 pages take about 4 minutes.
   Read it via `seo_research` with `target` = that task id: `non-indexable`, `redirect-chains`,
   `internal-links`, `keyword-density` return `crawl_status { pages_crawled }` (empty items on a
   finished crawl = none found; state the sample); `duplicate-content` REQUIRES `url`;
   `duplicate-tags` is title-only [SPENDS B per request]; `instant-page` takes `url`, one per
   template [SPENDS E]. An empty `seo_list_audits` means no crawl has run, never clean; carry the
   coverage block (blind-spots section 0).
5. The GSC capture, all ~16 months Google retains: `seo_gsc_list_sites` as the heartbeat, then
   `seo_gsc_search_analytics({ site_url, start: <16 months back>, end: <day -3>, data_state:
   'final', dimensions: ['date'] })`, then `['query']`, `['page']`, `['query','page']`, each
   `row_limit: 5000`, paging with `start_row` when a call returns exactly `row_limit` rows. Land
   each in a dated tab (step 13); never sum across dimension sets.
6. Bing, free: `seo_bing_list_sites`, `seo_bing_stats({ site_url })`, `seo_bing_crawl_stats({
   site_url })`.
7. Vitals, free: `seo_core_web_vitals({ url: <home>, include: 'field' })` plus one URL per
   template; `url` first, `origin` when `field.available` is false; label field vs lab.
8. Free gates: `seo_aeo_readiness({ domain })`, `seo_entity_check({ query: '<Brand Name>' })`; a
   blocked AI crawler or no Knowledge Graph entity is a headline finding. The llms.txt generator is
   `seo_llms_txt_generate` (see `references/aeo.md`; WEBSITE project id).
9. `backlinks_summary({ target })` for the client and each rival [SPENDS D, one per domain];
   report `referring_domains`, never `total_backlinks`.
10. `dataforseo_labs_google_competitors_domain({ target, location_code: 2840 })` [SPENDS B x1;
    COUNTRY codes only] against the client's own list; persist 4 to 8 with `seo_add_competitor({
    project_id, competitor_domain })` [CONFIRM by name, one at a time; 409 = already tracked];
    read back `seo_list_competitors({ project_id })` (null metrics = not analyzed yet).
11. `seo_ga4_conversion_audit({ connection_id, days: 90 })`; a silent key event is a month-1
    task. No google_analytics connection: Outcomes reads "not measurable yet" plus the setup task.
12. Locations or a service area: `/hiveku:local` (Play L1) runs here too.
13. `seo_deliverable_save({ title, slug: 'seo-baseline-<yyyy-mm>', deliverable_type: 'audit',
    status: 'draft', target_domain, summary, content, recommendations })` [CONFIRM]; read
    `existed`. Tables via `seo_sheet_create_tab({ deliverable_slug, name: '<yyyy-mm> ...',
    columns })` then one batched `seo_sheet_add_rows`; date-prefix every tab.

**Tell the client:** what is connected and what that caps, pages crawled vs site size, the
16-month shape, the authority tier, the competitor set, whether conversions are measurable, the
month-1 tickets with windows (technical 2 to 6 weeks, content 3 to 6 months).

**File:** memory (domain, exact property string, competitor set, traffic level and peaks, top
pages, constraints, exclusions); `pm_tasks_create({ project_id, title, task_type: 'seo' })` per
ticket, flat, never `parent_task_id`.

---

## Recipe 2: Strategy, 6-month roadmap and forecast

**Goal:** a signed-off roadmap and the tracking list that proves it. Needs Recipe 1, a qualified
universe in a sheet tab from `/hiveku:seo-keywords`, business value per cluster confirmed.

1. `seo_keyword_clusters({ project_id })` reads STORED rows (empty = nothing saved). Audit the
   draft grouping, then `seo_keyword_cluster_create` per agreed cluster [CONFIRM the list, one
   write each; `cluster_name` unique, 409 = exists]; pillars via `seo_topic_clusters` then
   `seo_topic_cluster_create` [CONFIRM]. Read back both. Edit or delete a cluster with
   `seo_keyword_cluster_update` / `seo_keyword_cluster_delete` and the topic-cluster twins
   (deletes ask-gated; `references/keyword-research.md`).
2. Priority matrix: SKILL.md's formula plus `references/keyword-research.md` 1.5. Tear down each
   top head: `seo_serp_get({ keyword })` for stored rows, `seo_research({ action: 'serp', keyword,
   location_code })` for the live SERP [SPENDS C, one per head].
3. Refresh vs new: `seo_cannibalization({ project_id })`, `seo_content_decay({ project_id })`,
   `seo_rankings_list({ domain, group_by_keyword: true })` against the matrix, with the five-way
   disposition in `references/content-strategy.md` 1.2. Never a second page on a covered intent.
4. Forecast band per `references/forecasting-and-seasonality.md`: `seo_ranking_predictions({
   domain, risk_level, limit })` (linear extrapolation, gated on history) beside the hand-built
   method, as a band (plus or minus 30 percent at 90 days, 50 at six months). Never a point.
5. `talk_to_department({ domain: 'seo', message })` for the narrative, fed the matrix, SERP
   verdicts, dispositions and constraints; reconcile every number against its call.
6. `seo_deliverable_save({ title, slug: 'seo-strategy-<yyyy-mm>', deliverable_type: 'strategy',
   target_domain, summary, recommendations })` [CONFIRM]; the matrix as a dated
   `seo_sheet_create_tab`.
7. Sign-off [CONFIRM, the client's yes on the ORDERED roadmap], then `seo_deliverable_update({ id,
   status: 'published' })`.
8. Tracking [CONFIRM, the reviewed 20 to 100]: `seo_track_keyword({ keyword, target_domain,
   location_code })` per keyword, `location_code` explicit for non-US clients; AI lanes (G) only on
   the priority set. Read back `seo_rankings_list({ domain, group_by_keyword: true })`.

**Tell the client:** the ordered clusters and why, refresh vs new, the technical debt that goes
first, link targets and lane, the band and window per item.

**File:** memory (cluster order and scores, intent verdicts, forecast inputs dated, tracking
convention); `pm_tasks_create` for month 1 with due dates inside the month.

---

## Recipe 3: Weekly pass

**Goal:** the standing thirty minutes; the body of `/hiveku:weekly`. Money pages in memory;
`hiveku-data/STATUS.json` read if you orient locally.

1. `seo_rankings_list({ domain, group_by_keyword: true, limit: 200 })`: `pagination.total_groups`;
   `current_rank` vs `previous_rank` (advances only on a new check day; `check_frequency` defaults
   to weekly); `last_checked_at` over 48 hours on a daily row = a stalled tracker, `seo_sync` and
   re-read. Blank AI lanes = untracked, never "not ranking".
2. Top-10 losses, same day: `seo_rankings_list({ view: 'history', ranking_id, from_date, to_date
   })` for the shape, then `seo_serp_get({ keyword })` or, when stale, `seo_research({ action:
   'serp', keyword, location_code })` [SPENDS C, one per keyword]. Below a 3-place move on one
   keyword, write nothing.
3. `seo_gsc_period_comparison({ site_url, period_a: { start: <day -17>, end: <day -11> },
   period_b: { start: <day -10>, end: <day -4> }, dimensions: ['query'], row_limit: 5000 })`, then
   `['page']`. `summary.keys_in_both` first (a collapse vs `keys_in_a` is coverage); totals come
   from `summary`, not the 50-row lists; deltas are signed Google-style, negative = improved,
   never flipped. Then `['query','page']`: one query moving between two pages is a URL
   swap, not a loss. The query x page archive reader is `seo_query_page_metrics`
   (`references/rankings-and-search-console.md`).
4. `seo_new_lost_backlinks({})` reads the MANUAL link-building tracker (no `project_id` first;
   `since` is ignored, filter `created_at`). DataForSEO's lost links:
   `backlinks_bulk_new_lost_backlinks({ targets: [domain] })` [SPENDS D x1]. Classify with
   `web_scrape` per `references/link-building-and-competitors.md` Play B. Log a won link with
   `seo_backlink_tracker_add` (see that file); mirror it in a PM task.
5. Audit delta: `seo_list_audits({ project_id })` vs last week; no re-crawl without a deploy.
   After any deploy: `seo_gsc_inspect_url({ site_url, inspection_url })` on home and two money
   pages.
6. `seo_competitor_changes({})` filtered to this `our_domain` and `requires_response: true`; empty
   with no competitor-change workflow = monitoring not running.
7. `pm_tasks_list({ project_id })`; stalled means escalate, not re-date.
8. Anomaly rule: a money page moving 20 percent or more week over week, or sitewide clicks down
   15 percent with impressions down too, is same-day. The measurement-artifact ladder FIRST
   (Recipe 9 step 1), then indexation, SERP shape, competitors, and last an update (Recipe 8).
   Never let the client find out first.

**Tell the client (only when something moved):** "was 12, now 6" with location and device, the
cause with its elimination chain, what ships this week.

**File:** a five-line "what changed / what's next" note by read-merge-write; `pm_tasks_create` per
accepted fix (each its own confirmed write in the recipe that owns it).

---

## Recipe 4: Monthly report

**Goal:** the artifact the retainer pays for, every number reconcilable to its call.
`references/reporting-and-delivery.md` loaded (one workspace per account; `seo_report_clear`
wipes it all).

1. `seo_deliverable_list({ deliverable_type: 'monthly_report', limit: 12 })` for last month's slug
   and promises; `seo_automated_reports({ project_id })` (account rows, filter by domain) to avoid
   double-emailing.
2. `seo_deliverable_save({ title: 'SEO Monthly Report - <Month Year>', slug:
   'seo-monthly-<yyyy-mm>', deliverable_type: 'monthly_report', target_domain, summary })`
   [CONFIRM]; read `existed`.
3. Appendix tabs first (dated): `seo_rankings_list({ domain, group_by_keyword: true, limit: 200 })`,
   `seo_gsc_search_queries`, `seo_gsc_top_pages`, via `seo_sheet_create_tab` and one
   `seo_sheet_add_rows` each.
4. Sections via `seo_report_add_section({ deliverable_slug, title: '<yyyy-mm> ...', content })`,
   in this order, the executive summary written LAST and placed first:
   - Rankings: `seo_rankings_list` plus `seo_gsc_period_comparison` on the last 28 days vs the
     prior 28 (never calendar months), `['query']` then `['page']`.
   - Organic traffic: `seo_gsc_time_series` for the 28 days and the same 28 a year earlier;
     nonbrand via an `excludingRegex` query filter; ship dates from completed tasks.
   - Outcomes, the three-call GA4 recipe in `references/outcomes-and-measurement.md`:
     `seo_ga4_conversion_audit({ connection_id, days: 30 })`, `seo_ga4_report({ connection_id,
     preset: 'channel_sessions' })` (rows include an "AI Assistant" channel group; report it on
     its own line), `seo_ga4_report({ connection_id, preset: 'landing_pages' })`. A 429 is the
     hourly quota: partial, no retry. No connection: "not measurable yet" plus the task. Organic
     leads come from `seo_organic_leads` (see that file's cross-check).
   - Authority: `backlinks_summary({ target })` [SPENDS D x1] vs last month's stored figure,
     `referring_domains` first; links won from tasks; losses from Recipe 3 step 4.
   - Local (clients with locations): `seo_gbp_overview({ connection_id, days: 30 })` per location,
     `seo_local_compare_periods({ days: 56, source: 'all' })` (it halves the window).
   - AI visibility: `seo_rankings_list({ domain, search_engine: 'ai_overview' })` (also `chatgpt`,
     `perplexity`, `claude`, `gemini`; blank = untracked) plus `seo_aeo_audit_get({ domain })`
     coverage and citation rate.
   - Work completed (live URL per item); Next month (roadmap slice with a window each).
5. Honesty pass: every figure traces to a named call; a failed source is partial, never zero;
   unknown and not_applicable never become a pass; every aggregate states N, how chosen, what was
   excluded; GSC, Bing, tracker, vendor estimates and GA4 are never summed.
6. Sign-off [CONFIRM], then `seo_deliverable_update({ id, status: 'published', recommendations })`.
7. Delivery through `/hiveku:report` (regenerate, share link or PDF, preview-then-confirm send);
   the email and the narrative must agree.

**Tell the client:** five bullets under 25 words: headline metric with direction, biggest win,
biggest risk, what shipped, what is next; partial sections named as partial.

**File:** memory (slug, period, headline metrics, promises); `pm_tasks_complete` the report task;
`pm_tasks_create` each next-month item.

---

## Recipe 5: Quarterly hygiene and re-qualification

**Goal:** prune what rotted, re-qualify, refresh the competitor set, retire superseded artifacts,
consolidate memory, without deleting history anyone reports on.

1. `seo_tracked_keywords_list({ project_id })` against the last two quarters' reports; candidates
   go to the client as a list, then `seo_tracked_keyword_delete` [CONFIRM, one keyword at a time,
   by name; the row's rank history dies with it - the lanes pause, so checks and billing stop
   with lane history kept (seo-change-discipline.md 2.7)]. Never a keyword reported in the last
   two quarters; if the list is merely long, stop adding, or pause with
   `seo_tracked_keyword_update({ is_active: false })`. In-place edits of lanes, location or
   target URL: `seo_tracked_keyword_update` and `seo_rankings_platforms_set`
   (`references/keyword-research.md`); delete and re-track still loses the row's history.
2. Re-qualification (`references/keyword-research.md` Play 9): re-run the SAME expansion calls on
   the same seeds, location and language [SPENDS B, name the count], diff against the stored
   universe tab, `seo_keyword_cluster_create` for agreed additions [CONFIRM].
3. `seo_list_competitors({ project_id })` (`last_analyzed` older than 60 days is history);
   `dataforseo_labs_google_competitors_domain({ target, location_code: 2840 })` [SPENDS B x1]; add
   with `seo_add_competitor` [CONFIRM by name]. Edit one with `seo_competitor_update`, remove with
   `seo_competitor_delete` (ask-gated; `references/link-building-and-competitors.md`); memory
   holds the agreed set.
4. `backlinks_anchors({ target })` [SPENDS D x1]; exact-match commercial above 10 percent means
   stop requesting them. No disavow exists; escalate with evidence.
5. `seo_deliverable_list({ limit: 50 })`; superseded rows get `seo_deliverable_update({ id,
   status: 'archived' })` [CONFIRM]; `seo_deliverable_delete` is permanent, not a tidying tool.
6. `workflow_list` against `workflow_templates_list`; install a missing standing play with
   `workflow_create_from_template({ slug, overrides, is_enabled: false })` [CONFIRM], read
   `variables[]` first, enable after review.
7. `seo_ga4_conversion_audit({ connection_id, days: 90 })`; a key event silent for a quarter is a
   task; `seo_ga4_key_event_delete` never runs from a sweep.
8. Memory consolidation: `memory_list({ domain: 'seo' })`, rewrite into one current state,
   `memory_update({ memory_id, content })` with the WHOLE merged body [CONFIRM, it replaces];
   `memory_list_versions({ memory_id })` is the safety net.

**Tell the client:** what was pruned and why, what the universe gained, next quarter's competitor
set, which automations now run, the measurement gaps closed.

**File:** the consolidated memory document dated; `pm_tasks_create` for dashboard-only edits and
next quarter's first month.

---

## Recipe 6: Site migration / redesign

**Goal:** a URL, template or platform change that keeps rankings, links and measurement. Needs a
full-profile key (`project_*`, `cms_*`, `deploy_site` are not visible to a marketing-seo key: say
"not visible to this key"), the WEBSITE project id from `sites_list`, a checkpoint via
`/hiveku:checkpoint`, and `references/seo-change-discipline.md` read.

1. Freeze into dated tabs: the 16-month GSC set (Recipe 1 step 5); `seo_backlinks_list({
   project_id: <SEO id>, limit: 100 })` for the link targets; `seo_rankings_list({ domain,
   group_by_keyword: true, limit: 200 })`; `seo_core_web_vitals({ url, include: 'field' })` per
   template; `seo_schema_markup({ project_id })`; `pages_list({ project_id: <website id> })`;
   `seo_gsc_list_sitemaps({ site_url })`.
2. URL map: `seo_sheet_create_tab({ deliverable_slug, name: '<yyyy-mm> Migration URL map', columns
   })` (old URL, new URL, status, links, clicks in 28 days, notes) then one `seo_sheet_add_rows`.
   Every old URL with clicks or links gets a one-to-one row; never a blanket redirect to home.
3. `project_redirects_list({ project_id })`, then `project_redirect_create({ project_id, from_path,
   to_path, status_code: 301, match_type: 'exact' })` per row [CONFIRM each; a `prefix` rule has
   blast radius]. Nothing serves until `project_redirects_deploy({ project_id, tier: 'staging' })`;
   verify with `fetch_url({ url })` on the staging host (`data.url` equals the target in one hop,
   status 200), then `project_redirects_deploy({ project_id, tier: 'production' })` [CONFIRM, live].
4. Canonicals, noindex, robots via the code lane: `project_files_bulk_get` -> edit ->
   `project_files_bulk_save` in ONE call -> `project_test_build({ use_db_state: true })` ->
   `project_vcs_commit` [CONFIRM] -> `deploy_site({ environment })` [CONFIRM, commit is not live].
   `seo_project_update({ robots_txt_content })` only serves as a deploy-time fallback where the code
   ships no robots source, so robots.txt ships as `public/robots.txt`, verified with `fetch_url`. Per-page SEO field and schema writes:
   `seo_page_seo_set` and `seo_page_schema_set` (`references/on-page-optimization.md`);
   `pages_update` and the code lane still work.
5. `seo_generate_sitemap({ project_id: <website id> })` returns `{ file_path: 'public/sitemap.xml',
   content }`; save via `project_files_bulk_save`, commit, deploy, `fetch_url` it live, then
   `seo_gsc_submit_sitemap({ site_url, sitemap_url })` and `seo_bing_submit_sitemap({ site_url,
   sitemap_url })` [CONFIRM]. The old one: `seo_gsc_delete_sitemap({ site_url, sitemap_url })`
   [CONFIRM, only when the file no longer exists at that path; it destroys the reporting history,
   not the URLs].
6. Post-launch watch, daily for two weeks: `seo_gsc_index_coverage({ site_url, urls })` in 50-URL
   batches by value (batch N of M); `seo_gsc_inspect_url` on home and money pages;
   `seo_gsc_period_comparison` before vs after on `['query']` (never `['page']`: the keys
   changed); `seo_bing_period_comparison({ site_url, period_a, period_b })`
   as the control; `backlinks_bulk_new_lost_backlinks({ targets: [domain] })` [SPENDS D x1].
7. Mechanical follow-ups on a hosted site: `seo_task_implement` two-step, human
   `agent_approval_approve`, never auto-approved; read the staged diff with `seo_task_changes`
   (`references/reporting-and-delivery.md`).

**Tell the client:** the map and what each old URL now does, redirects live on production with
fetch evidence, what the sitemap lists, re-evaluation over 2 to 6 weeks with the first two watched
daily, which numbers look wrong during the swap.

**File:** memory (cutover date, the map's tab name, sitemap paths, accepted exclusions);
`pm_tasks_create` per unresolved coverage bucket and lost link worth chasing.

---

## Recipe 7: New-location launch

**Goal:** a new location bound, complete, cited, tracked and internally linked within 30 days,
publishing nothing to Google the client did not approve. `references/local-seo.md` loaded.

1. Bind: `seo_connections_list` for the google_business_profile row (one connection = one
   location; `needs_setup` = unbound). `seo_gbp_discover_locations({ id: <connection uuid> })`
   once, then `seo_connection_update` with `gbp_account_id` and
   `gbp_location_id` [CONFIRM]; status auto-flips to `connected`. `seo_sync`, read back
   `seo_gbp_listing({ connection_id })`.
2. Baseline: `seo_gbp_listing` (read `items`; `unknown` is renormalized out), `seo_gbp_overview({
   connection_id, days: 90 })`, then ONE pass of the live reads `seo_gbp_attributes`,
   `seo_gbp_services`, `seo_gbp_media`, never looped. Gaps become tasks; the GBP writes publish
   PUBLICLY and none run here.
3. Location page: brief via `talk_to_department({ domain: 'seo', message })` with NAP matching GBP
   character for character, LocalBusiness JSON-LD with `sameAs`, the service list, and genuine
   local substance. Ship via the path
   `references/on-page-optimization.md` section 1 assigns [CONFIRM]; verify with `fetch_url`.
4. Tracking [CONFIRM, the reviewed 20 to 40 service-plus-city and near-me terms]:
   `seo_track_keyword({ keyword, target_domain, ranking_type: 'local', business_name,
   location_code: <city-level code from serp_locations> })`, never the national default. Read
   back `seo_rankings_list({ domain, ranking_type: 'local' })`.
5. `seo_citations_get({})` first (free; `audit: null` = never audited), then ONE
   `seo_citations_audit({ connection_id })` [SPENDS I; 24h cooldown returns 429 with the stored
   audit]. `missing_major` with `basis: 'no_signal'` is UNVERIFIED, never "not listed". No
   directory write exists: per-directory tasks.
6. `business_data_business_listings_search` for the category around the location [SPENDS, one
   Business Listings request; check the schema for the category and coordinate arguments].
7. After publish, `seo_internal_links({ project_id: <SEO id> })` to confirm the page is not
   orphaned; link from the service pages and the locations hub [CONFIRM].
8. 30-day watch: `seo_local_rank_changes({ days: 28, min_drop: 2 })` weekly,
   `seo_local_rank_history({ keyword, domain, days: 90 })` on movers, `seo_gbp_insights({
   connection_id })` for calls and directions. GBP posts publish via `social_create_post` with
   platform `google_business_profile`; read posts back with `seo_gbp_posts`; the listings
   scan is `seo_listings_scan` (ask-gated, spends; `references/local-seo.md`).

**Tell the client:** which location binds to which branch, the Listing Score and gaps, citations
consistent / inconsistent / unverified, the page URL, pack positions at a named city and device.

**File:** memory (connection id and branch, canonical NAP as published, categories, baseline score
and rating dated); `pm_tasks_create` per listing gap and inconsistent citation, plus the weekly
review and rank-watch items.

---

## Recipe 8: Algorithm-update response

**Goal:** confirm whether a dated update explains a move, classify what it rewarded, hold the line
against reactive rewrites until the rollout ends. Recipe 9 steps 1 to 7 ran first (an update is
the LAST explanation).

1. `web_search` for Google's Search Status Dashboard and two independent sources dated within a day
   or two of the cliff; `web_scrape` them to date it. No source, no update.
2. `dataforseo_labs_google_historical_serp({ keyword, location_code: 2840, date_from, date_to })`
   for 3 to 5 money keywords [SPENDS B, one per keyword]: who entered and left the top 10, which
   features appeared, whether winners share a content type.
3. `seo_gsc_period_comparison({ site_url, period_a: <14 days before>, period_b: <14 days after>,
   dimensions: ['query'], row_limit: 5000 })` then `['page']`; segment with
   `seo_gsc_search_analytics` on `['device']` and `['country']`. Losses in one directory point at a
   template or content type.
4. Control: `seo_bing_period_comparison({ site_url, period_a, period_b })` on the same dates. Both
   engines falling = the site; Google-only = Google.
5. Classify: SERP shape (`seo_serp_features({ keyword })` history), quality (`seo_eeat_scores({
   domain, limit: 10 })`), links (`backlinks_bulk_new_lost_backlinks({ targets: [domain] })`
   [SPENDS D x1]), technical (`seo_gsc_index_coverage` on the affected pages).
6. Hold: no reactive rewrites for two weeks; rollouts run about that long and partially revert.
   Protected pages stay untouched.
7. After the rollout: re-run step 3 on the full window, then decide per directory with the
   five-way disposition in `references/content-strategy.md`.

**Tell the client:** the update's name and dates, the evidence chain or its absence, what it
rewarded, why nothing ships for two weeks, what will after.

**File:** memory (date, name, verdict, evidence, affected directories, hold-until date);
`pm_tasks_create` only for confirmed causes, dated after the hold.

---

## Recipe 9: Traffic-crash triage

**Goal:** name the cause the same day, in the order that stops a counting bug from being blamed on
the market, and tell the client before they ask. `references/rankings-and-search-console.md`
section 6 open.

1. The measurement-artifact ladder, stopping at the first confirmed cause: (a) the `site_url`
   matches the connected property string in `seo_connections_list` EXACTLY (a mismatch returns
   empties or a 403, not an error); (b) every row's status and
   `last_error`; (c) `seo_sync({ project_id })` and re-read; (d) GSC's ~3-day lag: end at day -3
   with `data_state: 'final'`; (e) if reading locally, `hiveku-data/STATUS.json` `failed[]` and
   `fetched_at`; (f) a GA4-side drop: `seo_gtm_install_status`. `seo_connection_test` (ask-gated)
   writes connection_status (`references/outcomes-and-measurement.md`).
2. `seo_gsc_time_series({ site_url, start: <90 days back>, end: <day -3>, data_state: 'final' })`
   unfiltered for the cliff date, then `seo_gsc_period_comparison` on `['page']` across it.
3. `seo_gsc_inspect_url({ site_url, inspection_url })` on home and the top losers, then
   `seo_gsc_index_coverage({ site_url, urls })` on the top 50 by value: `indexing_state`,
   `google_canonical` vs `user_canonical`, `robots_txt_state`.
4. `fetch_url({ url })` on the top 5 losers: `status`, whether `data.url` differs from the input (a
   redirect), the body for a meta robots noindex and the canonical; `fetch_url` on `/robots.txt`.
   No Hiveku tool reads a production X-Robots-Tag: say so (blind-spots section 2).
5. `seo_core_web_vitals({ url, include: 'field' })` on the losing template vs baseline; over 15
   percent movement is a lead.
6. `seo_serp_get({ keyword })` for the money keywords; when stale, `seo_research({ action: 'serp',
   keyword, location_code })` [SPENDS C, one per keyword]. A new top-3 domain or a feature that
   took the click is the answer at this rung.
7. `backlinks_bulk_new_lost_backlinks({ targets: [domain] })` [SPENDS D x1]; a loss above 10
   percent of referring domains in 30 days precedes drops.
8. Only now, Recipe 8. 9. Same-day note to the client whatever rung you stopped on.

**Tell the client:** what was checked in what order, where the chain stopped, whether the number
is real or a counting artifact, what is being done and by when.

**File:** memory (cliff date, cause, evidence chain); `pm_tasks_create` for the fix with the
diagnosis in the body, and for any rung you could not close (headers, server logs).

---

## Recipe 10: "Rank for X" single-keyword campaign

**Goal:** one keyword, one URL, a 90-day plan the client can hold you to.
`references/on-page-optimization.md` loaded; the authority tier from the last `backlinks_summary`.

1. Qualify [SPENDS B x3]: `dataforseo_labs_google_keyword_overview({ keywords: [X], location_code:
   2840 })`, `dataforseo_labs_bulk_keyword_difficulty({ keywords: [X, ...variants] })`,
   `dataforseo_labs_search_intent({ keywords })`. KD above the tier's band means a funded link plan
   or a re-scope, decided now.
2. Teardown: `seo_serp_get({ keyword: X })` for stored rows; the live SERP is `seo_research({
   action: 'serp', keyword: X, location_code })` [SPENDS C x1]; `seo_serp_features({ keyword: X })`
   for the feature tax. Three national brands in the top 5 = re-scope to the long tail.
3. `dataforseo_labs_google_serp_competitors({ keywords: [X, ...variants] })` [SPENDS B x1] for who
   owns the SERP set.
4. ONE URL: `seo_gsc_search_analytics({ site_url, dimensions: ['page'], filters: [{ dimension:
   'query', operator: 'equals', expression: X }] })` for the page Google already serves, and
   `seo_cannibalization({ project_id })`. Refresh the earning page; write new only when no URL sits
   in the top 50 or every URL serves another intent.
5. The 12-step protocol (`/hiveku:seo-onpage <url>`), shipped through the path section 1 assigns
   [CONFIRM per write], verified with `fetch_url`. Per-page SEO field writes: `seo_page_seo_set`
   (see that file); `pages_update` and the code lane still work.
6. Link gap: `backlinks_page_intersection` with the top-ranking URLs as targets and ours excluded
   [SPENDS D x1; check the schema for the targets shape]; for resource-page prospects,
   `seo_research({ action: 'broken-links', target })` [free; `target` is the task_id of a crawl
   of THEIR site, so the spend is that crawl] finds the dead external links that make the pitch (`references/link-building-and-competitors.md`
   Prospecting); hand the segmented list and one angle per
   segment to Outbound via `talk_to_department({ domain: 'outbound', message })` [CONFIRM the
   list]. Nothing sends here.
7. Track [CONFIRM]: `seo_track_keyword({ keyword: X, target_domain, location_code })` organic;
   `ranking_type: 'local'` with `business_name` when a pack shows; AI lanes only if the SERP
   carries an AI Overview (G). Read back `seo_rankings_list({ domain, keyword: X })`.
8. The window in writing: striking distance 2 to 6 weeks, refresh 3 to 8, net-new 2 to 4 months,
   KD 60 plus with links 2 to 4 quarters.

**Tell the client:** the verdict (winnable, winnable with links, re-scope), the URL and why, what
ships this week, the link plan and lane, the window, what "ranked" will mean in the report.

**File:** memory (keyword, URL, verdict, window, SERP incumbents dated); `pm_tasks_create` for the
on-page work, the link campaign, the 90-day review.

---

## Recipe 11: Content refresh sprint

**Goal:** a monthly cohort of 4 to 8 pages recovered from decay or consolidated out of
cannibalization, each with a cause, tier, brief, ship date and 28-day proof.
`references/content-strategy.md` loaded.

1. `seo_content_decay({ project_id })` and `seo_cannibalization({ project_id })`, account-scoped,
   worst 30, filtered to this domain yourself; a `note` = not analyzed, not clean. Copy
   `peak_traffic`, `current_traffic`, `traffic_decline_pct`, `top_declining_keywords` now:
   resolved rows self-delete.
2. Triage: cannibalization first, then decay by the priority score (content-strategy 1.3). Cause
   test per survivor: one `seo_serp_get({ keyword })` on the highest `clicks_lost` query (stale:
   `seo_research({ action: 'serp' })` [SPENDS C, one per page]); route by the five causes in
   content-strategy 1.6.
3. Disposition per URL: leave, refresh, rewrite, consolidate, new.
4. Brief per URL: `on_page_content_parsing({ url })` on the top 3 [SPENDS E, three per page], then
   `talk_to_department({ domain: 'seo', message })` with the declining-keyword table verbatim, peak
   vs current, the benchmark, targets from `seo_internal_links({ project_id })`, schema, tier,
   voice. Persist with `content_create` [CONFIRM]; the client sees the brief, then the draft.
5. Ship via the path `references/on-page-optimization.md` section 1 assigns [CONFIRM per write].
   A consolidation is a merge plus `project_redirect_create({ project_id, from_path, to_path,
   status_code: 301 })` per losing URL [CONFIRM, every source and the target] then
   `project_redirects_deploy` [CONFIRM]; never delete without a redirect. Per-page SEO field
   writes: `seo_page_seo_set` (see that file).
6. Re-date honestly (`dateModified` reflects a real change), re-point internal links, verify with
   `fetch_url`, record the ship date.
7. Proof at 28 days: `seo_gsc_time_series({ site_url, start: <28 days before ship>, end: <day -3>,
   filters: [{ dimension: 'page', operator: 'equals', expression: <url> }] })` beside the same call
   unfiltered, and the decay row vanishing after the next sweep.

**Tell the client:** the cohort with cause and tier, the consolidation map, the tier's typical
recovery band (20 to 40 percent of recoverable clicks for tier 1, 40 to 70 for tier 2), the proof
date.

**File:** memory (consolidation map, off-limits pages, intent verdicts); `pm_tasks_create` per URL
with before-numbers in the body, `pm_tasks_complete` on the live URL and date.

---

## Recipe 12: Ecommerce / Shopify pass

**Goal:** category health, faceted and canonical policy, Product schema that matches the feed,
out-of-stock handling, revenue attribution, the shopping SERP. `references/ecommerce-seo.md`
carries the policy and decides the write path: a Hiveku-hosted storefront ships through the code
lane; a Shopify store is not Hiveku-hosted, so its theme, pages and product fields go through the
commerce lane or to the client as tasks.

1. `seo_gsc_search_analytics({ site_url, dimensions: ['page'], filters: [{ dimension: 'page',
   operator: 'contains', expression: '/collections/' }] })` (or the store's category path);
   `seo_cannibalization({ project_id })` for category vs product vs blog splits;
   `seo_gsc_index_coverage({ site_url, urls })` on a 50-URL sample of facet and parameter URLs.
2. Faceted and canonical policy per `references/ecommerce-seo.md`: which facets index, which
   canonicalize to the parent, which are noindexed. Never block parameters in robots.txt.
3. `seo_schema_markup({ project_id })` detected vs suggested; Product needs Offer with price,
   currency and availability matching the Merchant Center feed; BreadcrumbList on every product.
   Writes through the store's path [CONFIRM].
4. Out-of-stock: keep the URL live with availability set while demand exists; 301 to the parent
   only when gone for good; never a 404 on a URL with links.
5. `seo_ga4_report({ connection_id, preset: 'ecommerce_revenue' })` (free; property from the
   connection row; 429 = hourly quota, partial, no retry) beside `seo_ga4_report({ connection_id,
   preset: 'channel_sessions' })` so organic revenue is stated per channel (the "AI Assistant"
   channel group on its own line).
6. `seo_research({ action: 'google-shopping-products', query })` [SPENDS B, one per query] for the
   category heads: who holds the carousel and at what price band.
7. `seo_core_web_vitals({ url, include: 'field' })` on one collection page and one product page.

**Tell the client:** which categories earn and which cannibalize, the facet policy in one table,
schema gaps against the feed, the out-of-stock rule, organic revenue by channel with its source,
what the carousel shows.

**File:** memory (facet and canonical policy, out-of-stock rule, feed-to-schema mapping);
`pm_tasks_create` per store change, marked client-owned where Hiveku does not host the store.
