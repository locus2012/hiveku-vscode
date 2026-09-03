# Technical SEO - Operator Manual

## What this covers / when to load this

The deep manual behind the technical play of the SEO agency skill: the audit rail and what it really
delivers today, reading a crawl through the `seo_research` crawl actions, crawl and index health,
Core Web Vitals, sitemaps, robots, internal linking, entity signals, tech-stack reconnaissance, and
the Search Console and Bing surfaces that prove any of it. Load it when running or reading an audit,
when pages are not indexed or the site is slow, after a deploy, when deciding whether a ranking loss
is technical or editorial, or before touching canonicals, sitemaps, robots or schema on a live site.

Not covered here: the checks that pass per page and fail across the set (X-Robots-Tag, canonical
graphs, redirect chain depth, near-duplicates, thin pages, index-coverage truth) are in
`references/technical-seo-blind-spots.md` - load both before any audit you will report on. Per-page
work and JSON-LD templates: `references/on-page-optimization.md`. Migrations: Recipe 6 in
`references/seo-playbooks.md`. The gate every index-affecting write clears:
`references/seo-change-discipline.md`. Argument shapes are the declared ones as of 2026-08-30; where
one is not stated, check the tool's schema rather than guessing.

## Availability

Every tool here is LIVE unless the Note says otherwise; a name that does not resolve on your key is
"not visible to this key", never "does not exist". Two capabilities are owned elsewhere and named
only by description: the diff-and-preview reader for a staged implement task
(`references/reporting-and-delivery.md` Availability) and the per-page meta and schema write path
(`references/on-page-optimization.md` Availability).

| Tool | Status | Cost | Note |
|---|---|---|---|
| `seo_audit_start` | LIVE | F, crawl per page | The ONE crawl type; `max_crawl_pages` default 50, clamp 500; returns `audit_id` + `task_id`; `seo_audit_get` polls and persists (live since 2026-08-30). |
| `seo_run_audit` | LIVE | F, crawl per page | Same crawl; `audit_type` required and ignored; no `max_crawl_pages` or `target_url`, so always 50 pages. Prefer `seo_audit_start`. |
| `seo_audit_get`, `seo_list_audits`, `seo_audit_list` | LIVE | A, free | Read the persisted `seo_site_audits` rows (written since 2026-08-30). An empty list means no crawl has run, never a clean site. |
| `seo_research` crawl actions | LIVE, live-tested 2026-08-30 | E, per request | `target` = task_id for `redirect-chains`, `non-indexable`, `duplicate-tags`, `duplicate-content` (also REQUIRES `url`), `internal-links`, `keyword-density`; `url` for `instant-page`, `lighthouse`. |
| `seo_core_web_vitals` | LIVE | free, platform key | `url` or `origin`, `strategy`, `include`. Any URL. NOT `project_id`. |
| `seo_gsc_index_coverage`, `seo_gsc_inspect_url`, `seo_gsc_list_sitemaps`, `seo_gsc_get_sitemap`, `seo_gsc_submit_sitemap`, `seo_gsc_delete_sitemap` | LIVE | free | 50 URLs per call; indexed snapshot only; `feedpath` = full sitemap URL; delete is ask-gated. |
| `seo_bing_crawl_stats`, `seo_bing_inspect_url`, `seo_bing_list_sitemaps`, `seo_bing_submit_sitemap`, `seo_bing_submit_url` | LIVE | free | Bing takes `sitemap_url` and `url`. |
| `seo_generate_sitemap`, `seo_internal_links`, `seo_schema_markup`, `seo_entity_check`, `seo_aeo_readiness`, `seo_project_get`, `seo_project_update` | LIVE | free | Hosted projects for the first three; `seo_generate_sitemap` needs WEBSITE `project_id` + `base_url` and writes nothing; `robots_txt_content` is a deploy-time fallback only (1.4). |
| `domain_analytics_technologies_domain_technologies`, `domain_analytics_whois_overview` | LIVE | B, per request | Vendor tools; need includeDataForSEO. |
| `fetch_url`, `web_map`, `web_scrape`, `web_extract`, `web_crawl`, `project_files_bulk_save`, `project_vcs_commit`, `deploy_site`, `project_redirects_list`, `project_redirect_create`, `project_redirects_deploy` | LIVE | free; crawl credits for `web_crawl` | `web_crawl` and the code and redirect lanes are not visible to a marketing-seo key today. |

---

## 0. Orientation before any technical work

1. `account_context_get({ domain: 'seo' })` - persona, rules, approval thresholds. Re-read its
   `instructions` field before any generative call.
2. `memory_list` - prior decisions before re-deriving them: the exact GSC property string, canonical
   strategy, protected templates, accepted exclusions, CWV baseline, the last crawl `task_id` and
   its page cap. `hiveku-data/seo/` files are orientation only; decision-grade data is pulled live.
3. `seo_list_projects` -> the SEO tracking `project_id` (for `seo_audit_start`, `seo_run_audit`,
   `seo_list_audits`), then `seo_project_get` for domain, site_url and sources. The WEBSITE project
   id (`sites_list`) is a different id space: `seo_project_get`, `seo_project_update`,
   `seo_generate_sitemap`, `pages_update`, `project_*` and `deploy_site` take that one.

No GSC or Bing source on `seo_project_get` means a crawl opinion, not an indexation report - say so.
No tool here connects a source; that is the setup doc (`hiveku_docs_search`) or the dashboard.

---

## 1. Ground truth: the audit rail and the tool surface

### 1.1 The audit rail - what round-trips today (verified 2026-08-30)

- `seo_audit_start({ project_id, target_url, max_crawl_pages })` queues one DataForSEO crawl and
  returns 202 with `{ audit_id, task_id, target, project_id, max_crawl_pages, status: 'queued' }` (an
  `audit_type` is echoed, never used); a 25-page crawl finished in about 4 minutes live. There is ONE
  crawl type: `seo_run_audit` requires `audit_type` and the route ignores it, so 'technical',
  'content' and 'mobile' are the same crawl. `max_crawl_pages` defaults to 50 and clamps at 500 -
  always pass it, and compare it with the URL count from `web_map`.
- The Olympus rail persists (live-smoked 2026-08-30): `seo_run_audit` and `seo_audit_start` return
  `{ audit_id, task_id }`, `seo_audit_get({ audit_id })` polls and persists the result, and
  `seo_list_audits` / `seo_audit_list` list the `seo_site_audits` rows (the dashboard's own
  site-audit screen persists into a different table). An empty audit list still means no crawl has
  run, never a clean site.
- The working rule: start the crawl with `seo_audit_start`, keep the `task_id`, poll
  `seo_audit_get` for the persisted summary, and read the crawl through the `seo_research` crawl
  actions in 1.2 for the deep dive.
- 402 = the metered budget is exhausted or the DataForSEO balance went negative; 503
  `dataforseo_unconfigured` = no credentials. Neither means "clean" or "no data".

### 1.2 Reading a crawl: the `seo_research` crawl actions

| Action | Needs | Returns | Used in |
|---|---|---|---|
| `redirect-chains` | `target` = task_id, `limit` | every chain the crawl followed, hop by hop | Play T2, blind spots 4 |
| `non-indexable` | `target` | pages the crawler could not index, with a reason each | Play T4 |
| `duplicate-tags` | `target` | duplicate titles only; `results: []` = none in the crawled set | Play T2 |
| `duplicate-content` | `target` + `url` (REQUIRED) | pages similar to `url` with a similarity score; without `url` you get `results: []`, which means "no page given", not "no duplicates" | blind spots 5 |
| `internal-links` | `target`, optional `filters` | the link rows the crawl recorded, 50 per page with a `search_after_token` (790 rows on a 25-page site) | Play T7 |
| `keyword-density` | `target` | two-word phrase frequency, 50 per page with `total_items_count` | on-page work |
| `instant-page` | `url`, optional `device: 'mobile'` | one URL rendered with JavaScript: checks, meta, timing, content metrics | verification, blind spots 3 and 6 |
| `lighthouse` | `url` | a DataForSEO Lighthouse run | raw Lighthouse JSON only; CWV field data is `seo_core_web_vitals` |

Live-tested 2026-08-30 on a 25-page crawl. `redirect-chains` and `non-indexable` return
`results[0]` with `crawl_status` (`max_crawl_pages`, `pages_in_queue`, `pages_crawled`) plus
`items`; zero items with `crawl_progress: 'finished'` is a real "none found" in the crawled set,
while any other progress value means the crawl is not ready - never read a not-ready crawl as clean.
`limit` defaults to 50 rows - state the row cap in the coverage block. When a call fails, record the
error string and the date, use the blind-spots file's manual escalation, and report the check as not
run, never as clean.

### 1.3 Caps, and what has no tool

`seo_gsc_index_coverage` is max 50 URLs per call and slow. `seo_gsc_inspect_url` returns the indexed
snapshot only; Google's API has no live URL test. `seo_core_web_vitals` returns field and lab data
and every report labels which. No tool exists for server logs or log-file analysis (client export
only), Google's crawl-stats report and Removals (Search Console UI), or a bulk index-coverage export
(Google's limitation, so batches of 50).

### 1.4 Robots, meta robots, headers, rendering - which tool sees what

- **robots.txt**: `fetch_url` on the live `https://domain/robots.txt` returns the raw body;
  `seo_aeo_readiness({ domain })` reads the robots AI-crawler directives, `llms.txt`, homepage
  JSON-LD, meta and h1, and the sitemap in one free call - run it first.
  `seo_project_update({ robots_txt_content })` is a deploy-time fallback, not a live setting
  (`seo_project_get` shows the stored value). From the next `deploy_site` it is emitted as the site's
  `/robots.txt`, but only on a project whose code ships no robots source of its own, and never on the
  Fly preview, the dev tier, a GitHub-connected project, or a raw-source static project carrying a
  `package.json`. The file in the code always wins, so a real robots.txt still ships as
  `public/robots.txt` through the code lane (`project_files_bulk_save` -> `project_vcs_commit` ->
  `deploy_site`), the one lane that works on every project shape, and is verified with `fetch_url` on
  the live URL. Never report the stored field as the live file.
- **meta robots**: `web_scrape` with `formats: ['rawHtml']`, or `instant-page` for the rendered view.
- **X-Robots-Tag**: no HTML reader sees it; `references/technical-seo-blind-spots.md` section 2.
- **Ad-hoc crawl outside the audit**: `seo_audit_start` with `max_crawl_pages` set, then the crawl
  actions; `instant-page` for one URL; `web_map` for discovery; `web_crawl` for bodies.
- **Rendering diff**: `web_scrape` raw HTML against the rendered `instant-page` result and against
  what `seo_gsc_inspect_url` reports Google saw.

### 1.5 Writes and their lanes

`pages_update` (pages-model title, meta, slug, sitemap flags) and `cms_write_entry` for content-level
fields; the code lane (`project_files_bulk_save` in ONE call -> `project_vcs_commit` ->
`deploy_site`) for robots.txt, the sitemap file, template JSON-LD, headers and middleware; redirects
via `project_redirect_create` -> `project_redirects_deploy` (nothing is live until the deploy); the
implement rail `seo_task_implement` (two-step confirm) stages a production deploy behind a human
`agent_approval_approve` - never auto-approve; "implement this" is not pre-approval. Per-page meta
and schema writes: `references/on-page-optimization.md`. Every index-affecting write clears
`references/seo-change-discipline.md` first.

---

## 2. Decision frameworks

### 2.1 The CIRR ladder - which layer is actually broken

Work on a higher rung is wasted while a lower one is broken.

1. **Crawl** - can a bot fetch it? robots.txt Disallow, 5xx, timeouts, auth walls, parameter space,
   redirect chains.
2. **Index** - will the engine store it? noindex, canonical elsewhere, thin or duplicate, soft 404.
3. **Render** - does the stored version contain the content? JS-dependent copy, blocked resources.
4. **Rank** - does it compete? Internal links, schema, CWV, relevance.

"Our new service pages get no traffic": do not start with CWV, walk the ladder. `seo_gsc_inspect_url`
on the affected URL resolves rungs 1 to 3 in one call; if clean, read the newest crawl
(`non-indexable` and `redirect-chains` on the stored task_id) for a template regression; if still
clean it is not technical - hand it to rankings, content, or authority and say so.

### 2.2 Severity x effort x blast radius - the triage matrix

- **Severity**: removes pages from the index (5), suppresses rankings sitewide (4), degrades a
  template (3), affects a handful of pages (2), cosmetic (1).
- **Effort**: one config or template change (1), template plus content pass (2), code change with a
  deploy and QA (3), migration (5). **Blast radius**: how many URLs one fix touches.

Priority = (Severity x Blast radius) / Effort. Above ~8 this week; 3 to 8 this sprint; below 3 gets
batched into the next content refresh. In practice it sorts into three tiers:

1. Crawl blockers, accidental noindex, broken canonicals, redirect chains, 5xx - high severity,
   usually low effort. Fix this week.
2. Template-level issues (one fix, many pages) - high leverage. Fix this sprint.
3. Page-by-page cosmetics - batch into content refreshes, never standalone work.

Think in templates: 380 of 400 findings sharing a path prefix is ONE ticket worth 380 pages. **An
audit finding without a `pm_tasks_create` is a PDF, not a service.** Mechanical fixes can go down
the implement rail (`seo_task_implement`, staged behind `agent_approval_approve`).

### 2.3 Sequencing: fix, then ask for a recrawl

Never resubmit a sitemap or submit a URL *as* the fix, and never mass-submit weak URLs: submission
only accelerates discovery of a change you already made. Diagnose -> fix at source -> confirm live
with `fetch_url` -> `seo_gsc_submit_sitemap` / `seo_bing_submit_url` -> re-verify with
`seo_gsc_inspect_url` after 3 to 14 days.

### 2.4 Is it technical at all?

Rule out three cheaper explanations for a drop first: seasonality (year over year), a core algorithm
update (`web_search` the date), and measurement breakage (tags removed, property changed, a filter
left on). Technical fixes verify slowly, so a wrong diagnosis costs a month.

### 2.5 Indexation rules

`seo_gsc_index_coverage` results are a sample: report N, how the URLs were chosen, and what was left
out, never a census. "Discovered - currently not indexed" and "Crawled - currently not indexed" at
scale are a quality or internal-linking problem, not a submission problem. A 50-page crawl is a
50-page opinion about the site, whatever the site's size.

---

## 3. The plays

### Play T1 - Technical baseline (onboarding, once)

1. Orientation per section 0. `seo_list_audits({ project_id })` - a row from the last 14
   days is a crawl to read instead of paying for a new one. Empty means no crawl has run,
   not that nothing is wrong.
2. `web_map({ url })` for the URL universe, then `seo_audit_start({ project_id, target_url,
   max_crawl_pages })` with the cap set against that count (clamp 500). Keep the `task_id`. Wait a
   few minutes (about 4 for 25 pages); poll `seo_audit_get` for the persisted summary.
3. Read the crawl through `seo_research` with `target` = task_id: `non-indexable`, `redirect-chains`,
   `duplicate-tags`, `internal-links`, then `instant-page` on one URL per template family for missing
   H1, meta and rendered content. Every count carries its denominator: "12 of the 200 pages crawled".
4. `seo_core_web_vitals({ url, strategy: 'mobile' })` on the home page and one URL per template,
   `include: 'field'` for the fast p75 read. `field.available: false` on an exact URL means thin
   traffic: re-call with `origin` for site-level p75 (`lcp_ms`, `cls`, `inp_ms`, which can be null,
   with a `collection_period`) and say the number is origin-level. Label field vs lab everywhere.
5. `seo_gsc_index_coverage({ site_url, urls })` on the top 50 URLs **by business value** (home, money
   pages, one per template), not a random slice. Bucket the coverage states.
6. `seo_internal_links({ project_id })` - orphans, depth, link distribution (static weekly scan,
   hosted projects only; suggested links are not computed). `seo_schema_markup({ project_id })` -
   detected vs suggested per template. `seo_entity_check({ query })` on the brand.
   `seo_aeo_readiness({ domain })` for robots, `llms.txt`, JSON-LD and sitemap, free.
   `seo_bing_crawl_stats({ site_url })` - a free second opinion; Bing crawls more literally.
7. Play T8 for the stack and hosting story before proposing fixes.

**Close the loop**: one `memory_create` entry, "<domain> technical baseline": crawl task_id and
date, page cap and URL-universe count, index ratio, the CWV triple with its field/lab label, the top
five findings with priority scores, the exact GSC property string, approved exclusions. Confirm the
fix list, then `pm_tasks_create` one ticket per accepted fix.

### Play T2 - Regression sweep (monthly, and after every deploy)

Monthly, and within 24 hours of any deploy touching templates, routing, or the CMS - the post-deploy
pass is the highest-value habit in technical SEO and the one nobody does.

1. `memory_list` for the previous task_id and page cap, then `seo_audit_start` with the SAME
   `max_crawl_pages` and `target_url`, so the two crawls are comparable. Keep both ids.
2. Run `non-indexable`, `redirect-chains` and `duplicate-tags` on both task ids and **diff them**.
   The delta is the report, not the absolute counts. Hunt: a new noindex reason on a template, a
   flipped canonical, a jump in 404s (a deploy changed slugs), a new redirect chain, a title pattern
   that lost its brand suffix. Any **new** severity-5 finding is a same-day escalation. Diff
   `seo_audit_get`'s issue list the same way.
3. Post-deploy, hunt the four classic regressions: a staging noindex in production; robots.txt
   replaced with a blanket Disallow (`fetch_url` the live file); slugs changed without 301s;
   canonicals pointing at staging or the home page. Smoke-test with `seo_gsc_inspect_url` on the
   home page and two money pages, `instant-page` on one URL per changed template,
   `seo_bing_crawl_stats` for an independent error count, and `seo_core_web_vitals` against the
   memory baseline (over 15 percent movement on any metric gets Play T3).
4. `pm_tasks_update` on in-flight tickets; `pm_tasks_complete` only with proof attached (inspection
   result, crawl delta, GSC number) - complete on "the engine agrees", never on "the code shipped".
   On a regression, escalate same day at severity 5, and only once the fix is live use
   `seo_gsc_submit_sitemap` and `seo_bing_submit_url` to accelerate recovery.

### Play T3 - Core Web Vitals remediation

Thresholds in section 4. A URL group passes only when LCP, INP, and CLS are all Good at p75. Field
data is a **28-day rolling window**, which drives the verification schedule below.

1. `seo_core_web_vitals({ url, strategy: 'mobile' })` then `strategy: 'desktop'`, per template URL.
   Mobile is what matters; desktop passing while mobile fails is the normal shape. `include: 'field'`
   skips the 20 to 60 second Lighthouse run when you only need p75; `field.available: false` on an
   exact URL means thin traffic - re-call with `origin` and say the number is origin-level. A null
   `inp_ms` is "not enough interactions sampled", not a pass.
2. Group failing URLs by template: /blog/* failing LCP while /product/* passes is one defect.
3. Attribute before proposing a fix. LCP poor **with** TTFB over 800 ms is server or cache, not the
   image; LCP poor with TTFB fine is the hero resource (preload, dimensions, format, lazy-load above
   the fold); CLS poor is unsized images or embeds, injected banners, late webfonts; INP poor is
   main-thread work from third-party scripts, hydration, or unthrottled handlers. The lab half of
   the same call ranks opportunities by estimated savings; `instant-page` adds resource timing.
4. Content-level fixes (oversized hero uploads, missing dimensions) via `pages_update` or
   `cms_write_entry` after confirmation. Code-level (preload hints, script deferral, caching headers)
   is a deploy - `pm_tasks_create` and get approval.
5. **Verification schedule**: no field movement for ~7 days, partial at 14, full at 28. Set the
   task's verification date at fix_date + 28; never call a fix failed before day 28.

Never chase a Lighthouse performance score: it is a lab composite that moves for reasons users never
feel, and "we made it faster" without a p75 number is not evidence.

### Play T4 - Indexation investigation

Trigger: pages not appearing, an index-count drop, "is Google seeing this?".

1. `seo_gsc_index_coverage({ site_url, urls })` in prioritized batches of 50. Read the bucket counts.
2. For each failing bucket, one representative URL to `seo_gsc_inspect_url({ site_url,
   inspection_url })`: coverage state, Google-selected vs declared canonical, crawl and indexing
   allowed, last crawl date, referring page, rich-result detection. One call, CIRR rungs 1 to 3.
3. If indexing is disallowed, find the source: `fetch_url` the live robots.txt, `web_scrape` the URL,
   and `seo_research({ action: 'non-indexable', target: task_id })` for every crawled page with its
   reason. The three mechanisms fail differently: **robots.txt Disallow** leaves the URL indexable
   URL-only and hides any meta-noindex from Google, so never combine them; **meta robots noindex /
   X-Robots-Tag** removes reliably but needs the page crawlable; **canonical** is a hint, not a
   directive.
4. Cross-check with `seo_bing_inspect_url({ site_url, url })`, free and literal: Bing indexed and
   Google not means Google-side quality or canonicalization; neither engine having it means crawl
   access, so confirm with `seo_bing_crawl_stats`.
5. Fix at source, Play T5 to resubmit, re-inspect after 3 to 14 days.

Bucket meanings: **Discovered - not indexed** = Google has not bothered (depth, crawl budget,
internal linking). **Crawled - not indexed** = Google declined, a quality problem no submission
fixes. **Duplicate, Google chose a different canonical** = accept Google's pick and redirect, or
align internal links, sitemap membership and the self-referencing canonical until the signals agree.

### Play T5 - Sitemap lifecycle

A sitemap holds only canonical, self-canonicalizing, 200-status, indexable URLs - no noindexed URLs,
redirects, parameterized duplicates, or 404s. Max 50,000 URLs and 50 MB per file, an index file
above that. `lastmod` must be truthful, or engines learn to ignore the field.

1. `seo_gsc_list_sitemaps({ site_url })`, then `seo_gsc_get_sitemap({ site_url, feedpath })` for
   `lastSubmitted`, `lastDownloaded`, `isPending`, `errors[]`, `warnings[]` and `contents[]` (counts
   by type, not URLs). A sitemap last downloaded months ago is itself a signal.
   `seo_bing_list_sitemaps({ site_url })` for Bing.
2. `seo_generate_sitemap({ project_id, base_url })` on a Hiveku-hosted project returns the content
   the sitemap *should* hold from published pages honoring `show_in_sitemap`; it writes nothing.
   Ship it as `public/sitemap.xml` through the code lane, then `fetch_url` the live file.
3. **Validate before submitting.** Diff the generated URL set against `web_map({ url: domain })`,
   and spot-check a sample through `seo_gsc_index_coverage` for noindex or canonical-elsewhere URLs.
   A dirty sitemap teaches the engine your sitemap is unreliable.
4. Confirm with the client, then `seo_gsc_submit_sitemap({ site_url, feedpath })` and
   `seo_bing_submit_sitemap({ site_url, sitemap_url })`; verify with the two list tools. For a few
   urgent URLs, `seo_bing_submit_url({ site_url, url })` nudges Bing directly; there is no Google
   submit-URL tool here, so Google discovery goes through the sitemap or the Search Console UI.
5. `seo_gsc_delete_sitemap({ site_url, feedpath })` [CONFIRM] is for one situation only: a sitemap
   file that no longer exists at that path after a migration, or one created in error. Deleting does
   **not** deindex its URLs; it destroys the reporting row and the submission history behind your
   index ratio, so never call it to tidy an error count. The submitted-vs-indexed gap from
   `seo_gsc_get_sitemap` is your cleanest index ratio: track it monthly; widening while URL count is
   flat means quality or duplication, not crawling.

### Play T6 - Structured data program

1. `seo_schema_markup({ project_id })` - detected vs suggested per template. Templates with nothing
   at all come first; missing beats malformed. `seo_aeo_readiness({ domain })` reads the homepage
   JSON-LD for free.
2. Target set by business model, not by what is available. The per-type templates and the 2025
   eligibility rules (what earns a rich result, what carries entity value only) are section 4 of
   `references/on-page-optimization.md` - do not restate them here; pick from that list per template.
3. Implement: content-level fields via `cms_write_entry` or `pages_update` after confirmation;
   template-level JSON-LD is a code-lane change, so `pm_tasks_create` and route to the deploy
   workflow; the per-page schema write path is in `references/on-page-optimization.md`.
   `seo_task_implement` hands an accepted task to the implementation pipeline - confirm the exact
   change first, because it writes.
4. Verify with `seo_gsc_inspect_url` (detected rich-result types) after the recrawl, and re-run
   `seo_schema_markup` after the next weekly scan. Markup that does not match visible content risks a
   manual action.
5. Entity layer: `seo_entity_check({ query })` on the brand - does it resolve, does `sameAs` match
   real profiles, are name and description consistent across site, profiles and schema? Use the
   returned `kg_id` and official URL in `sameAs`; where entity data is thin, `web_search` and
   `web_extract` gather the profile URLs.

### Play T7 - Internal link architecture

1. `seo_internal_links({ project_id })` - orphans, depth, link distribution (static weekly scan of a
   hosted project's code; dynamic and CMS-driven links are invisible; empty is never no-issues).
   `seo_research({ action: 'internal-links', target: task_id })` returns the link rows the crawl
   recorded, which does see rendered links.
2. Cross-reference striking-distance pages (positions 4 to 15, from the rankings reference): routing
   authority at a page on the cusp is the highest return per unit of effort; pages ranking 30+ do
   not have an internal-link problem.
3. Per target page, three to eight named source pages and the exact anchor, varied rather than one
   exact-match phrase sitewide. Implement via `cms_write_entry` or `pages_update` in confirmed
   batches by template - never bulk-apply an opportunity list, which is how a footer ends up with 60
   links. Re-run `seo_internal_links` after the next scan and record the ship date for attribution.

### Play T8 - Tech stack and hosting reconnaissance

Once at onboarding, before any migration, and on each named competitor. It decides which lane every
later fix travels: a Hiveku-hosted Next.js project is a code-lane ticket you can ship; a WordPress
or Shopify site is a client ticket with instructions.

1. `sites_list` - is the domain a Hiveku-hosted project, which tiers are deployed, is GitHub
   connected. Not hosted here means every fix is client-executed, and you write it as such.
2. `domain_analytics_technologies_domain_technologies` on the domain (check the tool's schema for
   the argument name) - CMS, framework, CDN, analytics and tag managers. The only Hiveku read that
   identifies the CDN, since `fetch_url` returns no server headers. One class-B request per domain.
3. `domain_analytics_whois_overview` (or `seo_research({ action: 'whois-overview', domain })`) -
   registration age, registrar, expiry. An expiry inside 90 days is a severity-5 client ticket.
4. `seo_research({ action: 'subdomains', domain })` - a staging or dev subdomain that resolves is
   the classic finding: check it with `seo_gsc_inspect_url` if it is in the property, otherwise a
   `web_search` site: query, and get it noindexed or removed.
5. `fetch_url` on the four host variants (http and https, apex and www): `status` and `data.url`
   show whether they collapse to one canonical host in one hop; anything else is a redirect-chain
   ticket.
6. Persist one memory line: stack, host, CDN, registrar and expiry, canonical host, subdomains and
   their intended state.

**Site migration or redesign**: the before-state freeze, the URL map, the redirect batch through
`project_redirects_list` -> `project_redirect_create` -> `project_redirects_deploy`, sitemap
regenerate, submit and delete-old, and the post-launch watch are Recipe 6 in
`references/seo-playbooks.md`. Do not improvise a migration from this file.

---

## 4. Thresholds that trigger action

| Signal | Source | Act when |
|---|---|---|
| LCP p75 mobile | `seo_core_web_vitals` field | > 2.5 s (poor > 4.0 s) |
| INP p75 mobile | `seo_core_web_vitals` field | > 200 ms (poor > 500 ms) |
| CLS p75 mobile | `seo_core_web_vitals` field | > 0.1 (poor > 0.25) |
| TTFB (diagnostic) | `seo_core_web_vitals` / `instant-page` timing | > 800 ms (poor > 1800 ms) |
| Index ratio (indexed/submitted) | `seo_gsc_get_sitemap` | < 80 pct investigate, < 60 pct escalate |
| Crawled - not indexed | `seo_gsc_index_coverage` | > 20 pct of the sample (quality problem) |
| Discovered - not indexed | `seo_gsc_index_coverage` | > 10 pct of the sample (crawl/linking) |
| Google chose different canonical | `seo_gsc_index_coverage` | > 5 pct of the sample |
| Soft 404 on a money page | `seo_gsc_inspect_url` | any, same day |
| Broken internal links | `seo_internal_links` / `internal-links` action | > 1 pct of internal links |
| Redirect chain length | `seo_research` `redirect-chains` | >= 2 hops fix, >= 3 hops urgent |
| Orphan indexable pages; money page deeper than 3 clicks | `seo_internal_links` | any |
| Non-indexable pages in the crawl | `seo_research` `non-indexable` | any money or template URL you did not exclude |
| 4xx on indexable URLs | crawl / `seo_bing_crawl_stats` | > 1 pct of crawled |
| 5xx anywhere | crawl / `seo_bing_crawl_stats` | any, same day |
| Duplicate titles | `seo_research` `duplicate-tags` | > 5 pct of crawled pages |
| Domain expiry | `domain_analytics_whois_overview` | inside 90 days, same day |

CWV bands are Google's published thresholds; the percentages are agency benchmarks over the crawl
cap or the GSC sample, never "the site". Technical fixes move in 2 to 6 weeks, CWV field data needs
the full 28 days, new content takes 3 to 6 months.

---

## 5. Diagnosis: when the data looks wrong

**GSC calls return empty**, in order of likelihood: (1) property string mismatch -
`sc-domain:example.com` and `https://example.com/` are different properties and `site_url` must match
the connected string exactly (check `seo_project_get` and memory; the number one cause); (2) about
three days of data lag; (3) about 16 months of retention; (4) OAuth expired or revoked - no
reconnect tool here, so say so rather than reporting a zero; (5) a filter matching nothing.

**The audit list is empty after a crawl.** That is the rail today (section 1.1), not a failed crawl:
read the crawl through the `seo_research` crawl actions with the task_id you kept. A
`crawl_progress` other than 'finished' in `results[0]` means the crawl is still running (about 4
minutes for 25 pages); an error naming the task means the id is wrong. Do not start another crawl
inside the same hour. A 402 or 503 from an action is budget or credentials: report the check as not
run, name the code, never "no issues found". When `seo_gsc_index_coverage` returns fewer rows than
you sent, re-run the missing URLs through `seo_gsc_inspect_url`, whose last-crawl date also tells
you whether the engine has re-evaluated your fix.

**CWV shows no movement.** At day 7 expect a quarter of the eventual movement, and verify the fix
reached the template you measured - a fix on /product/ never moves /blog/. Lab-good with field-poor
is third-party scripts or real-device CPU; field-good with lab-poor is a throttled synthetic run.
**Schema implemented but not detected** is JavaScript-injected JSON-LD, a syntax error, or no
recrawl yet: compare `web_scrape` raw HTML, the rendered `instant-page` result and
`seo_gsc_inspect_url` detection.

**robots.txt looks right in Hiveku and wrong on the site.** `seo_project_get` shows the stored
`robots_txt_content`, which reaches the site only at the next `deploy_site`, and only where the code
ships no robots source; a `public/robots.txt` in the code beats it every time. `fetch_url` the live
URL and treat that as the only truth.

**Tools disagree.** Crawl counts are the crawler's view of `max_crawl_pages` pages, GSC counts are
Google's over the URLs you sent, Bing's are Bing's. One named source per metric, forever. Where a
source is missing, report the ceiling ("without Search Console I can report crawl health but not
indexation") and get it connected. Never estimate the gap.

---

## 6. Edge cases and failure modes

- **noindex plus robots.txt Disallow on the same URL.** A blocked page cannot be crawled, so the
  noindex is never seen and the URL stays indexed URL-only. Allow the crawl, keep the noindex, wait
  for the drop, then block. Canonical plus noindex is likewise contradictory: pick one. Paginated
  series self-canonicalize; canonicalizing them to page one removes deep items.
- **"Update the robots.txt" through `seo_project_update`.** The write lands in the column, not on
  the site: nothing changes until the next `deploy_site`, and a robots source in the code wins
  outright, so the client's site can keep the old file while you report a fix that did not happen. Ship
  `public/robots.txt` through the code lane and verify with `fetch_url`. Never block crawlers in
  robots.txt on an ask alone: a blanket Disallow is the fastest way to deindex a site.
- **Bulk canonical or redirect changes off an audit list.** Audit tools do not know which duplicate
  is business-critical: review every canonical change by template with a named winner URL, and if a
  fix implies a URL change the redirect map is part of the same ticket. Never block parameters in
  robots.txt to fix duplication: blocked pages keep their links and their duplication, they just
  become invisible to you.
- **Protected surfaces and approval thresholds.** Legal, pricing, checkout, and any template the
  account context marks protected get no edits without explicit itemized approval, even when an
  audit flags them - read the rules field from `account_context_get` first. Every index-affecting or
  client-visible change is confirmed and applied in reviewed batches; `pages_update`,
  `cms_write_entry`, `seo_task_implement`, the sitemap submit and delete tools, `seo_bing_submit_url`,
  `project_redirect_create`, `project_redirects_deploy`, `project_vcs_commit` and `deploy_site` are
  all writes: say what you will do, get a yes, then do it, one artifact per yes.
- **Cost discipline.** Check memory for the last task_id before re-crawling; never re-run a crawl
  inside the same week without a deploy or incident, and never crawl the whole site "to be thorough"
  - the cap is a coverage statement, so choose it and state it.

---

## 7. Persistence and reporting

**Memory** (`memory_list({ domain: "seo" })` first, then `memory_create` only if nothing came back,
otherwise `memory_update({ memory_id, content })` carrying the WHOLE merged document, because that
call REPLACES the entry). Keep current: the exact GSC property string and Bing site_url; the last
crawl task_id, page cap and date; the canonical and indexation strategy with intentional exclusions;
the CWV baseline with date and field/lab label; the Play T8 stack line; protected templates and
client constraints; resolved decisions. Update rather than stack: five stale CWV baselines are worse
than one current entry.

**PM tasks.** One `pm_tasks_create` per fix, after the client has agreed to the list. Each ticket
carries the finding, the priority score and its three inputs, the affected URL pattern or template,
the fix and its lane (code lane, `pages_update`, client-executed, implement rail), the owner, and the
verification date plus the exact tool call that will prove it. `pm_tasks_update` when work starts or
blocks; `pm_tasks_complete` only once the verification call agrees - completing on "shipped" is how
technical debt silently returns. An implement-rail task is approved by a human through
`agent_approval_approve` after reading the staged change (the diff-and-preview reader:
`references/reporting-and-delivery.md` Availability).

**Reporting.** Per fix, one line in the client's language: what was broken, how many pages out of
how many examined, what changed, and when the effect becomes measurable - every number reproducible
from a named tool call with its denominator. Assemble from completed pm tasks plus the crawl diff
and hand it to the reporting-and-delivery reference. For judgment rather than data,
`talk_to_department({ domain: 'seo', message })`, then persist the outcome with the direct tools.
