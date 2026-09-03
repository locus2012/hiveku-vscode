# Content Strategy - senior operator manual

## What this covers / when to load this

The manual behind the SEO skill's content lane: deciding what content to write, refresh, merge, or
kill, and proving the decision paid. SKILL.md gives the arc and the tool list; this file gives
the mechanics the tools hide, the numbers that trigger action, the exact call order per play,
and the failure modes that make a confident answer wrong. Load it for content audits, the
refresh program, cannibalization, SERP features and snippets, E-E-A-T, and shipping any of it
through the SEO implement rail. Not for keyword discovery, crawl and indexation, GSC or Bing
analytics, links, or report assembly (references/keyword-research.md, technical-seo.md,
rankings-and-search-console.md, link-building-and-competitors.md, reporting-and-delivery.md).
Assumes `account_context_get({ domain: 'seo' })` has run and you hold a `project_id` from
`seo_list_projects` (or `hiveku-data/seo/projects.json`).

## Availability

Cost classes: A = free DB read; write = free, confirm-gated; B = Labs per request; C = live SERP
per request per location; E = on_page instant per URL; F = crawl per page. Every metered call
returns 402 when the DataForSEO balance is negative and 503 `dataforseo_unconfigured` with no
credentials: neither means clean or empty.

| Tool | Status | Cost class | Note |
|---|---|---|---|
| `seo_content_decay` | LIVE | A | Sunday sweep output; worst 30 rows, account-scoped |
| `seo_cannibalization` | LIVE | A | same sweep; rows self-delete when resolved |
| `seo_eeat_scores` | LIVE | A | top 10 GSC pages per account, ~28-day cadence |
| `seo_featured_snippets` | LIVE | A | written only by AEO audit runs (references/aeo.md Play C) |
| `seo_serp_features` | LIVE | A | append-only feature history from the same runs |
| `seo_serp_get` | LIVE | A | stored SERP analysis rows; a LIVE SERP is `seo_research({ action: 'serp' })` or `serp_organic_live_advanced` (C) |
| `seo_content_gaps` | LIVE | A | stored gap rows, empty until the compute writer below has run for the project; empty means "not computed", never "no gaps" (Play C4) |
| `seo_content_gaps_compute` | LIVE | B + write | computes and PERSISTS gaps: one Labs domain_intersection call per competitor (up to 3 tracked competitors, or one explicit `competitor_domain`; `limit` keywords stored per competitor, default 100, max 300; about 2 minutes per competitor); REPLACES the row per project+competitor, never accumulates; 402 = monthly research cap; read back with `seo_content_gaps` |
| `dataforseo_labs_google_domain_intersection` | LIVE | B | keywords a rival ranks for that you do not: the gap analysis |
| `dataforseo_labs_google_page_intersection` | LIVE | B | the same at URL level, 2-20 pages |
| `seo_research` | LIVE | B / C / E | actions `keyword-gap`, `page-intersection`, `keyword-density` (needs `target` = a `seo_audit_start` task_id; live-tested 2026-08-30), `serp` |
| `on_page_content_parsing` | LIVE | E | structured headings, links and text of ONE URL; outline benchmarking |
| `seo_internal_links` | LIVE | A | Hiveku-hosted published projects only; `suggested_links_to/from` not computed |
| `seo_cro_audit` | LIVE | free | heuristic audit of one URL, works on competitor pages |
| `seo_task_list`, `seo_task_get`, `seo_task_implement`, `seo_task_implement_status` | LIVE | write (implement spends a paid agent turn) | the implement rail, Play C7; the diff reader an approver needs is `seo_task_changes`, see references/reporting-and-delivery.md |
| `pages_list`, `pages_update`, `cms_list_collections`, `cms_read_entry`, `cms_write_entry` | LIVE | write | Hiveku-hosted page and CMS edits; `cms_*` not visible to a marketing-seo key |
| `project_files_bulk_save`, `project_vcs_commit`, `deploy_site` | LIVE | write | the code lane; not visible to a marketing-seo key |
| `content_create` | LIVE | write | persists a brief or draft |
| `talk_to_department` | LIVE | free | briefs and copy; its numbers are never evidence |
| `web_map`, `web_crawl`, `web_extract`, `web_search`, `web_scrape` | LIVE | free | the volume-blind fallback for gap work |

---

## 0. How this data is actually produced

Every content tool here reads a table a cron wrote. None compute anything live. Knowing the
pipeline separates "the site has no decay" from "the sweep has never run for this account".

| Tool | Written by |
|---|---|
| `seo_content_decay` | seo-analysis-sweep cron, Sundays 05:35 UTC |
| `seo_cannibalization` | same sweep |
| `seo_eeat_scores` | same sweep, 28-day per-page cadence |
| `seo_featured_snippets` | AEO audit runs only (references/aeo.md Play C) |
| `seo_serp_features` | AEO audit runs only, append-only history |
| `seo_serp_get` | stored SERP analysis rows (no writer today); the LIVE SERP is `seo_research({ action: 'serp' })` or `serp_organic_live_advanced`, metered |
| `seo_content_gaps` | the gap compute writer (Availability table), on demand; nothing else, and no cron |

- **Windows.** Decay and cannibalization compare two 28-day windows anchored at the most recently
  archived GSC day, not today (GSC lags 2 to 3 days): current = maxDate-27d..maxDate, prior =
  maxDate-55d..maxDate-28d. Under 42 days of archive the account is skipped entirely.
- **Decay floors.** Prior window needs 100+ impressions and 5+ clicks. Flagged when clicks fell
  25 percent or more (`decay_type: 'traffic'`), or impression-weighted average position worsened
  by 3.0+ while clicks fell 10 percent or more (`'position'`), or both. `decay_severity`: severe
  at 60 percent decline, moderate at 40, else mild. Top 100 pages per account per run.
- **Cannibalization floors** (the backing table of `seo_cannibalization`). Per (domain, query) in the
  current window a competing page needs 50+ impressions; a finding needs 2+ such pages and 200+
  combined impressions. `severity: 'high'` when 3+ pages compete or the runner-up takes 40 percent or more of the
  leader's clicks; `'low'` when at most one page earns clicks; else `'medium'`.
- **Both converge and self-delete.** Rows with `status: 'detected'` that are no longer detected
  are deleted next run, so a page you fixed **disappears**: that is the success signal, and why
  you copy `peak_traffic`, `current_traffic`, `traffic_decline_pct` and
  `top_declining_keywords` into the PM task before shipping. Human-re-statused rows survive.
- **E-E-A-T covers the account's top 10 GSC pages, not the site.** Fetched live and LLM-scored
  under a 150-page-per-run fleet budget, with a heuristic fallback. Read `*_signals.method`:
  `'llm'` reflects the prose, `'heuristic_only'` only the presence of a byline, a contact link,
  an Article schema. `competitor_scores` is not computed. `overall_score` weights trust 0.35,
  expertise 0.25, experience 0.20, authority 0.20.
- **`seo_content_gaps` is empty until its compute writer has run** (the Availability
  table). Empty means gaps have not been computed for this project, never that there are no gaps -
  run the compute (or, until it ships, the intersection tools, Play C4) before telling a client
  anything about their gap list.

Scoping quirks, verified against the routes:

- `seo_content_decay`, `seo_cannibalization` and `seo_featured_snippets` accept `project_id` but
  the routes **ignore it** and scope by account, so on a multi-site account filter each row's
  `domain` or `url` yourself. They cap at 30 rows (ordered by `traffic_decline_pct`,
  `traffic_loss_estimate`, `opportunity_score` desc) and MCP forwards none of their `domain` /
  `severity` / `status` / `limit` filters: **you get the worst 30 and nothing else**.
- `seo_eeat_scores` is the exception: it forwards `domain`, `url`, `is_ymyl`, `min_score`,
  `max_score`, `page`, `limit` (max 100). `seo_serp_features` forwards `keyword`
  (case-insensitive contains), ignores `project_id`, orders `checked_at` desc.
- `seo_serp_get` (`keyword` required, `location_code` 2840 = US, `language_code`, `device`)
  reads stored SERP analysis rows, and nothing writes them today, so an empty result means
  unpopulated. Wherever a play below says "read the SERP" and the stored row is empty, the live
  read is `seo_research({ action: 'serp', keyword, location_code })` or
  `serp_organic_live_advanced` (class C, per request per location): never loop either.

**Local first.** `hiveku-data/seo/gsc_pages.json`, `gsc_queries.json`, `keywords.json`,
`rankings.json`, `tracked_keywords.json`, `competitors.json` and `audits.json` orient you at zero
cost; `hiveku-data/STATUS.json` carries the fetch timestamp. Older than the last material account
change is orientation only.

---

## 1. Decision frameworks

### 1.1 The portfolio model

Every URL is in one of five states and the monthly job is knowing the count in each:
**performing** (stable, correct intent), **decaying** (in `seo_content_decay`), **split** (in
`seo_cannibalization`), **weak** (indexed, thin or low E-E-A-T, impressions without clicks),
**absent**. Decaying and split are the cheapest wins: links, age and history already exist.
Budget by maturity: a mature site (150+ URLs, 10+ decay rows) runs roughly 60 percent refresh
and 40 percent new, a young site (under 40 URLs) 90 percent new. A net-new plan on a site with
30 severe decay rows is malpractice.

### 1.2 The five-way disposition

| Disposition | Choose when | Window |
|---|---|---|
| Leave | Stable top 3, or the decline is seasonal or SERP-layout driven | n/a |
| Refresh | Ranks 5 to 30 for its head term, decay row present, intent still matches | 2 to 6 weeks |
| Rewrite | Ranks 5 to 30 but `seo_serp_get` shows a different content type in the top 5 | 4 to 10 weeks |
| Consolidate | 2+ URLs on one intent, neither stable in the top 5 | 3 to 8 weeks |
| New | No URL of ours in the top 50 for the head term, or every existing URL serves another intent | 3 to 6 months |

Never create a second page on an intent you already cover: that manufactures a cannibalization
row you pay to fix next quarter.

### 1.3 Prioritization

```
recoverable = peak_traffic - current_traffic       # clicks per 28 days
effort      = 1 (metadata + internal links) | 2 (section rewrite) | 3 (full rewrite + assets)
priority    = recoverable * confidence * business_value / effort
```

`confidence`: 0.6 for `decay_type: 'traffic'` (freshness usually explains it), 0.4 for
`'position'` (something displaced you), 0.75 for `'both'` on a page untouched 12+ months, 0.2
once `seo_serp_get` shows the SERP changed shape. `business_value` is the client-confirmed 1 to 3
(do they sell this?). Cannibalization rows use `traffic_loss_estimate`, snippet rows
`opportunity_score`.

### 1.4 Sequencing

Out of order the work cancels itself: cannibalization first (refreshing one of two competing
pages just moves the split), then the decay cohort by priority score, then E-E-A-T on money pages
(template work), then snippet capture on top-10 pages, then net-new.

### 1.5 The refresh depth ladder

- **Tier 1 (1 to 2 hours):** title and meta rewritten against the current SERP, the H2s
  `top_declining_keywords` names, refreshed dates and statistics, 3 to 5 internal links from
  healthy pages. Expect 20 to 40 percent of `recoverable`.
- **Tier 2 (half a day):** plus 500 to 1500 words of new substance covering subtopics the top 3
  cover and you do not, plus schema and an answer block. Expect 40 to 70 percent.
- **Tier 3 (multi-day):** full rewrite against a new intent, new assets, SME quotes, new URL only
  if the old one is wrong (then a 301, never a delete). Top-decile `peak_traffic` only.

### 1.6 The cause test (before any refresh)

A decay row says clicks fell, never why. Five causes, four of which a rewrite does not fix.

1. **Staleness** - out of date versus the top 3. Refresh works, Tier 1 or 2.
2. **Displacement** - `seo_serp_get` shows a new domain in the top 3. Refresh plus links, slowly.
3. **SERP layout shift** - an AI Overview, carousel or local pack absorbs the clicks; position
   flat, CTR collapsed. Check `seo_serp_features` history and switch to feature capture or AEO.
4. **Intent shift** - the top 5 are a different content type. Rewrite, not refresh.
5. **Self-inflicted** - a redeploy changed the template, a noindex slipped in, a link block
   vanished. That is technical-seo.md; check the audit delta before blaming the copy.

The tell separating 1 and 2 from 3 and 4: `peak_avg_position` versus `current_avg_position`. Flat
with clicks down hard means the SERP changed around you; down 3+ means you were beaten.

---

## 2. The plays

### Play C1 - Weekly portfolio triage (about 10 minutes, zero metered calls)

1. `account_context_get({ domain: 'seo' })`. Re-read `instructions` before anything generative;
   note protected pages, the approval threshold, which pages are money pages.
2. `seo_content_decay({ project_id })`. Per row: `domain`, `url`, `decay_severity`,
   `decay_type`, `peak_traffic`, `current_traffic`, `traffic_decline_pct`, `position_decline`,
   `keywords_lost`, `top_declining_keywords[]` (`query`, `prior_clicks`, `current_clicks`,
   `prior_position`, `current_position`, `clicks_lost`), `refresh_priority`, `status`,
   `last_analyzed_at`. Filter to this client's `domain`; `last_analyzed_at` older than 8 days
   means the sweep skipped the account, so say so.
3. `seo_cannibalization({ project_id })`. Per row: `domain`, `keyword`, `page_count`,
   `competing_pages[]` (`page`, `clicks`, `impressions`, `avg_position`), `severity`,
   `traffic_loss_estimate`, `recommended_primary_url`.
4. `seo_task_list({ status: 'todo', task_type: 'seo' })`, then `task_type: 'content'` (the
   default is `'seo'`). Read `implementable` and `implement`.
5. Anything new at `decay_severity: 'severe'`, or cannibalization `severity: 'high'` on a money
   page, gets a task this week (`pm_tasks_create({ project_id, title, description,
   task_type: 'seo', priority })`); the rest queues for the monthly cohort.

### Play C2 - The refresh program (the play the retainer pays for)

1. Candidates from `seo_content_decay` (C1 step 2), 4 to 8 per month at a mid-tier retainer.
   Score with 1.3, keep the top N.
2. Cause test (1.6) on each survivor: one
   `seo_serp_get({ keyword, location_code: 2840, device: 'mobile' })` per page, on the highest
   `clicks_lost` query (mobile, because layout shifts show there first). Read who holds 1 to 3,
   their content type, which features are present. Discard causes 3 and 5, routing to C5 or
   technical-seo.md.
3. Brief each survivor: `talk_to_department({ domain: 'seo', message })` carrying the URL, the
   `top_declining_keywords` table verbatim, peak versus current numbers, the top-3 competitor
   outline, internal-link targets, schema, refresh tier, and the voice constraints from
   `account_context_get` (`domain: 'content'` when brand voice dominates). A brief without SERP
   evidence is a guess.
4. Persist with `content_create` (confirm its fields first; it is a write). Client sees the brief
   before the draft and the draft before it ships. Never let generated copy reach a live site
   unread: invented statistics and credentials are the standard LLM failure mode, and a fake
   credential on a YMYL page is a liability.
5. Ship. Hiveku-hosted sites go through the implement rail (Play C7) or the site tools in
   Play C8. Externally hosted sites get the brief plus exact copy blocks and their team
   ships: no tool edits a site Hiveku does not host.
6. Record ship date and before-numbers, then `pm_tasks_update` / `pm_tasks_complete`.
7. Measure at 28 days: the clean signal is the decay row vanishing after the next sweep, the
   numbers come from the GSC period tools (rankings-and-search-console.md) with a page filter.

### Play C3 - Cannibalization resolution

1. `seo_cannibalization({ project_id })`, filtered to the client's domain.
2. Per finding above threshold, `seo_serp_get({ keyword })`. One question: **same intent, or two
   legitimate pages that happen to share a query?** Long-tail queries pull in a category page and
   a guide all the time; that is coverage, not cannibalization.
3. Same intent, neither stable in the top 5: consolidate onto `recommended_primary_url` (the
   highest-click page, tie-broken by position). Merge the losers' substance in, 301 them,
   re-point internal links. Never delete without a redirect: that throws away the links.
4. Same intent, one page clearly winning (top 3, stable): leave it, and de-optimize the loser
   only if it draws impressions for the head term (retitle toward its own intent, do not gut it).
   Overlapping but distinct intents: retitle, re-angle H1 and intro, cross-link.
5. Consolidation is a redirect plus a content merge, so it needs explicit approval: name every
   source URL, the target, and the redirect type. Redirects are hard to unwind once cached.
6. `pm_tasks_create` per consolidation with the full URL list, then `memory_update` the SEO
   memory so a future session does not "discover" the merged page as a gap.

### Play C4 - Content gaps (compute-then-read; the intersection tools are the manual method)

`seo_content_gaps({ project_id, competitor_domain })` returns `missing_keywords`,
`content_opportunities` and `traffic_potential` ordered by `priority_score` - but only after the
gap compute writer (Availability table) has persisted rows for the project. Once it
is live the play is compute-then-read: run the compute [SPENDS, class B - one Labs
domain_intersection call per competitor, up to 3 tracked competitors or one explicit
`competitor_domain`, about 2 minutes each; confirm the spend], which finds the keywords the rival
ranks for that the project does not and REPLACES the stored row for that project+competitor
(re-running refreshes, never accumulates), then read `seo_content_gaps` back and work the list. A
402 is the monthly research cap; a 400 with no competitor means none is tracked - add one with
`seo_add_competitor` or pass `competitor_domain`.

Until the compute ships - and afterward, whenever you want a gap read without persisting
anything - build the gap by hand with the intersection tools:

**Manual method [SPENDS, class B].** Confirm the spend, then one call per rival, batched:
1. `dataforseo_labs_google_domain_intersection` with the rival and the client as the two
   targets, US country code 2840 (Labs takes COUNTRY codes only; the server retries with US and
   returns `location_note`). Rows are keywords both rank for, with volume, CPC and each side's
   SERP element; the rival-only set comes from the intersection filters or from
   `seo_research({ action: 'keyword-gap', domain, competitors: [...] })`, which returns keywords
   the competitors rank for that the domain does not, volume and difficulty attached.
2. `dataforseo_labs_google_page_intersection` on 2-20 URLs when the question is one hub versus
   theirs (which spokes their pillar covers that ours does not). Supports organic, local pack and
   featured-snippet results. `seo_research({ action: 'page-intersection', targets: [...] })` is
   the same read through the router.
3. Cluster the rival-only keywords by intent (keyword-research.md Play 2), drop what the client
   cannot serve, and validate the top 10 with `seo_serp_get`: a SERP of national brands means
   re-scoping to the long tail however big the gap looks.

**Fallback, free and volume-blind:** `web_map({ url: competitorDomain })` for their URL space,
`web_crawl` or `web_extract` on their content hubs for titles, H1s and publish dates,
`web_search` for "topic + competitor", then diff against `hiveku-data/seo/gsc_pages.json` and
your sitemap. Honest, but it cannot size anything: label it as such.

Output is a ranked gap list in the strategy deliverable (a sheet tab, so nobody re-pays next
quarter); gaps become tasks only once the client agrees they are worth writing.

### Play C5 - SERP features and featured snippets

1. `seo_featured_snippets({ project_id })`. Read `keyword`, `our_position`, `can_win_snippet`,
   `opportunity_score`, `snippet_type`, `snippet_holder_domain`, `required_content_type`,
   `required_format`, `target_word_count`, `question_to_answer`, `content_gap`, `our_url`,
   `status`. Empty is normal until an AEO audit has run for the domain (references/aeo.md
   Play C): run it, then come back, since this tool is a free DB read.
2. Qualify: only `can_win_snippet: true` **and** `our_position` 10 or better (snippets come from
   page one, mostly the top 5). `our_position: 34` is a ranking project, not a snippet one.
3. Verify the live format: `seo_serp_features({ keyword })` for persisted history
   (`features_present[]`, `featured_snippet`, `people_also_ask`, `ai_overview`,
   `we_have_featured_snippet`, `we_in_ai_overview`, `our_organic_position`, `checked_at`), plus
   `seo_serp_get({ keyword })` when the newest `checked_at` is over ~30 days old.
4. Write to the observed format: paragraph snippets take a 40 to 60 word answer immediately
   under an H2 restating `question_to_answer`; list snippets 5 to 8 short parallel items; table
   snippets a real HTML table. Answer block at the top of its section, never in a summary.
   Coverage instruments before you write: `on_page_content_parsing({ url })` on the holder's
   page (class E) returns its headings, links and text, the outline you are answering against;
   `seo_research({ action: 'keyword-density', target: <seo_audit_start task_id> })` shows which
   terms our page already carries. The brief spec itself (title, H1, answer block, entity
   coverage, schema, internal links) is section 2 of references/on-page-optimization.md.
5. Ship via C2 step 5, then re-probe after the next AEO audit and report
   `we_have_featured_snippet` flipping true. Two probes 30 days apart before claiming a win.

### Play C6 - E-E-A-T remediation

1. `seo_eeat_scores({ domain, max_score: 65, limit: 100 })`. Read `url`, `overall_score`, the
   four dimension scores, the four `*_signals` objects, `is_ymyl`, `ymyl_category`, `issues[]`,
   `quick_wins[]`, `scored_at`.
2. Check `*_signals.method` first. On `'heuristic_only'` a low score means "signals missing",
   never "the writing is untrustworthy", and it is not an assessment you may quote to a client.
3. Triage by weight. Trust is 35 percent of the composite and cheapest to fix; `trust_signals`
   names what is missing (`contact_link`, `about_link`, `privacy_or_terms_link`,
   `phone_or_email`, `address_tag`, `modified_date`). Template fixes: one ticket, whole site.
4. Then `expertise_signals` (`author_name`, `meta_author`, `references_section`,
   `cite_elements`) and `authority_signals` (`schema_author`, `article_schema`, `external_links`,
   `published_date`). A credentialed byline plus Article and Person schema moves three at once.
5. `is_ymyl: true` raises the bar: `overall_score` under 60 is urgent and a missing credentialed
   author is the first fix, before any copy work.
6. The sample is 10 pages re-scored roughly every 28 days: do not extrapolate to the site, do not
   expect a re-score the day after you ship, and say "the 10 pages we have scores for". File with
   `pm_tasks_create`, template fixes as one task each.
7. When the fix is copy depth rather than signals, measure coverage before briefing:
   `on_page_content_parsing({ url })` on the top-3 pages for the head term versus ours, and
   `seo_research({ action: 'keyword-density', target })` after a crawl, so the brief names the
   subtopics and entities missing rather than "write more". Brief spec: section 2 of
   references/on-page-optimization.md.

### Play C7 - The implement rail (SEO task to deployed code)

1. Hiveku-hosted sites only, and only where the PM project is bound to a website project.
   `seo_task_list({ status: 'todo', task_type: 'seo' })`, then `'content'`. Read `implementable`.
2. `seo_task_get({ task_id })`. Read `description`, `ai_instructions`, the resolved `page_url`,
   the linked website project, `implementable`, and the rail summary (`session_id`,
   `dispatched_at`, `approved_at`, `deployment_id`). Unresolved `page_url` means the agent edits
   the wrong file: fix the task first.
3. `seo_task_implement({ task_id })` **without** `confirm`. It dispatches nothing and returns
   `{ requires_confirm: true, preview }` with task, target project, domain and page anchor: show
   that preview verbatim.
4. On an explicit yes, repeat the identical call with `confirm: true` (strict boolean); this
   spends a paid agent turn. Only open tasks (todo, queued, blocked, need_info) dispatch; a
   running session 409s, an already-deployed task 409s, an exhausted AI budget 402s.
5. Poll `seo_task_implement_status({ task_id })`. Phases: `idle`, `running`,
   `awaiting_approval` (staged deploy, token and expiry in the response), `deploying`,
   `completed` (`deployed_at`, `deployment_url`, task auto-completed at deploy time), `failed`
   (`stage: 'agent' | 'deploy'` with the error).
6. **Do not approve the staged deploy yourself.** Hand the summary and expiry to the user to
   approve in their SEO workspace or the dashboard approval rail.
7. On `failed`: `agent` means the instruction was unusable (usually a missing `page_url`, or a
   task written as a wish), so rewrite `ai_instructions` and re-dispatch; `deploy` means the
   build broke, which is technical-seo.md.

### Play C8 - Opportunity sweep, briefs and where the fix ships

The monthly sweep (all project-scoped DB reads, free, run them together): `seo_content_decay`
(the refresh queue), `seo_cannibalization` (URLs competing for one query), `seo_internal_links`
(point authority at striking-distance pages first; Hiveku-hosted published projects only, and
its suggested-link fields are not computed, so read the graph and decide yourself),
`seo_eeat_scores` (money pages first), `seo_schema_markup` (detected versus suggested structured
data), `seo_featured_snippets` (verify the format with `seo_serp_get` or `seo_serp_features`
before writing the answer block), and `seo_cro_audit({ url })` on striking-distance pages that
already earn traffic: five sections scored 0-100 (speed, clarity, friction, trust, cta), each
finding carrying issue, why it costs conversions and the fix, plus `quick_wins`. Free, works on
competitor pages, audit only; run experiments as PM tasks.

Outline benchmarking before a brief: `on_page_instant_pages` (load and on-page metrics) and
`on_page_content_parsing` (structured headings and text) on any URL, both class E; batch rules in
references/metered-research-suite.md.

**Briefs and drafts.** `talk_to_department({ domain: 'seo', message })` with the target cluster,
the SERP intent evidence, the top-3 competitor outlines, internal-link targets and required
schema. A brief without SERP evidence is a guess. Persist with `content_create` or as a
deliverable; the department's prose is a draft, and every number in it is unverified until you
trace it to a tool call.

**Ship fixes where the site actually lives.** Hiveku-hosted pages: `pages_list` then
`pages_update` (titles, meta, slugs, SEO fields); CMS content via `cms_list_collections`,
`cms_read_entry`, `cms_write_entry`. Code-level changes (templates, JSON-LD, redirects): pull
the project, edit, `project_files_bulk_save` in ONE call, `project_vcs_commit`, verify the
build, `deploy_site` only after approval. Commit is not live. On a marketing-seo scoped key the
`cms_*`, `project_*` and `deploy_site` tools are not visible (say "not visible to this key",
never "does not exist"): ship page-level fixes via `pages_update` and route code-level changes
through the implement rail (Play C7) or a full-profile key. The per-path matrix and the 12-step
page protocol are section 1 of references/on-page-optimization.md; every mutation clears the
gate in references/seo-change-discipline.md first. Never report a fix as shipped because the
edit call succeeded: `fetch_url` the live URL. After shipping, note the date, then
`seo_gsc_time_series` with a page filter (for example `{ dimension: 'page', operator:
'contains', expression: '/blog/' }`) proves the change worked in the next report.

---

## 3. Thresholds and benchmarks

Act on: decay `'severe'` (60 percent+) on any page with `peak_traffic` 20+ clicks per 28 days;
decay `'moderate'` on a money page; `position_decline` 5.0+ (investigate displacement before
assuming staleness); cannibalization `severity: 'high'`, `traffic_loss_estimate` 20+ clicks per
28 days, or `page_count` 3+; snippets with `can_win_snippet: true` and `our_position` 10 or
better; `overall_score` under 60 on YMYL or under 50 on a money page, `trust_score` under 50
anywhere as a template fix; any money page moving 20 percent+ week over week, same-day.

Queue only: decay `'mild'` (next cohort, Tier 1) and cannibalization `severity: 'low'`, where
one page earns the clicks and the split is cosmetic.

Sizing (never promises): 4 to 8 pages per cohort, 2 to 3 if each is Tier 3; a consolidation
returns 60 to 90 percent of `traffic_loss_estimate` once the redirect settles, in 3 to 8 weeks;
snippet capture shows 1 to 4 weeks after re-crawl. Recovery per tier is in 1.5, time-to-signal in
1.2, the CTR curve and difficulty bands in references/metered-research-suite.md. Four strong
pages a month beats twelve thin ones: thin pages become next year's decay rows.

---

## 4. Diagnosis

**Every content tool returns empty.** In order: look for the `note` field, since decay and
cannibalization say "no analysis exists yet" when the result is unanalyzed rather than clean, so
empty with no note means analyzed and clean; check Search Console is connected with a `site_url`
exactly matching the property string (`sc-domain:` and url-prefix are not interchangeable, and a
mismatch produces silent empties); check there are 42+ days of archive; check a Sunday has passed
since connection (the sweep is bounded to 500 accounts per run, so a new account can miss a
cycle). `seo_content_gaps` empty resolves only by running its compute (Play C4); empty `seo_featured_snippets` or
`seo_serp_features` means no AEO audit has run for this domain.

**A page you know is dying is not in the decay list.** The floors exclude it: under 100 prior
impressions or 5 prior clicks, decline under 25 percent, or outside the top-100-per-account cap.
Small and new pages are structurally invisible here; verify with the GSC page-filtered tools.

**Numbers do not match the client's own Search Console.** Expected: the windows are two archived
28-day spans anchored at the last archived day, not the last 28 days from today; GSC lags 2 to 3
days; the archive is query x page x day, so summing across dimensions double-counts. Explain the
window instead of adjusting the number.

**`implementable: false` on a task you can see.** The PM project is not bound to a website
project, and binding is a dashboard action with no MCP tool. Also check it is not a subtask:
`pm_tasks_create` force-flips `task_type` to `'subtask'` whenever `parent_task_id` is passed, and
the rail queue filters to `'seo'` or `'content'`, so a task filed under a parent vanishes from
`seo_task_list` entirely. Create SEO and content tasks flat.

**`seo_task_implement` returned success and nothing happened.** Poll
`seo_task_implement_status` before believing any dispatch: this rail has a documented history of
reporting success on a dispatch that never created an agent turn. `phase: 'idle'` after a
confirmed dispatch means the turn did not start. Do not re-dispatch blindly; escalate.

**A refresh shipped and the metric will not move.** In order: was the page re-crawled; has 28
days passed; was the cause actually content (re-run 1.6); did a competitor ship at the same time
(`seo_serp_get`); did the ship change the URL, canonical or internal links.

---

## 5. Edge cases and failure modes

- **Do not touch a stable top-3 page.** Refresh programs lose more traffic to over-optimized
  winners than they gain from mild-decay pages. Not in the decay list, not in the cohort.
- **A vanished decay row is not proof the refresh worked.** Rows also vanish when the page falls
  below the 100-impression floor, which is decay completing, not reversing.
- **Do not delete pages in a consolidation.** 301 them, or you discard the backlinks that made
  the page worth consolidating. And `recommended_primary_url` is only the highest-click page in
  one 28-day window, which can be a seasonal outlier: sanity-check it.
- **Do not bulk-apply anything.** No mass retitling, no mass redirects, no publishing a cohort
  in one shot, no looping a metered call. Every write is named and confirmed individually (exact
  URLs, changes, redirect targets) and nothing client-facing goes out without a yes. Protected
  pages and approval thresholds from `account_context_get` are read-only to you.
- **Do not promise snippet capture:** snippets oscillate, can be removed from a SERP entirely,
  and are increasingly displaced by AI Overviews.
- **Do not paper over a dead integration.** With no GSC connection the honest deliverable is "we
  cannot see decay, cannibalization, E-E-A-T or query data until this is fixed", plus a task to
  fix it.

---

## 6. Persistence and reporting

**Memory.** Durable decisions go to the SEO domain memory: refresh cadence and cohort size, the
consolidation map (which URLs merged into which, and when), pages declared off-limits, intent
verdicts per cluster, and any conclusion that cost a metered call. Check `memory_list` first: it
is one document per account and project, so `memory_create({ type: 'memory', name: 'seo',
content })` returns 409 once it exists and you `memory_update` the merged body instead. Losing
this is how the next session rebuilds a page you deliberately redirected.

**PM tasks.** One task per shippable unit, flat (never `parent_task_id`), `task_type: 'seo'` or
`'content'`. The description carries the before-numbers from the decay or cannibalization row,
the disposition and tier, the target keywords, and the acceptance criterion. `pm_tasks_update`
for status, `pm_tasks_complete` on ship with the live URL and date. An analysis without tickets
is a PDF, not a service.

**Client reporting.** The content section of the monthly report (reporting-and-delivery.md)
carries: pages refreshed with before and after clicks and ship dates; consolidations with the URL
map; snippet wins with probe dates; E-E-A-T fixes scoped to the pages actually scored; the next
cohort with expected impact and its window. Every number must be reproducible from a named tool
call, and a missing capability (no gap-analysis table, no GSC connection, a site you cannot deploy
to) is stated, not quietly omitted.
