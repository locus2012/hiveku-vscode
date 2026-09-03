# Rankings, Search Console and Bing Webmaster: the analyst's manual

## What this covers / when to load this

Reading Google Search Console and Bing Webmaster like an analyst: telling a real
ranking movement apart from noise, seasonality, a measurement artifact or a Google update, running the
comparison cadence, harvesting striking-distance and CTR opportunities, and proving a shipped change
worked. **Load this when** you run a weekly checkup, diagnose "traffic dropped" or "we lost a ranking",
build the rankings and traffic sections of a report, size an opportunity from impressions, or the
client asks "why did this move". Not for keyword discovery, crawl and index fixes, forecasting, or
report assembly (`references/keyword-research.md`, `technical-seo.md`,
`forecasting-and-seasonality.md`, `reporting-and-delivery.md`); the end-to-end recipes (weekly pass,
algorithm-update response, traffic-crash triage) are in `references/seo-playbooks.md`. SKILL.md is
the operating system; this is one instrument panel.

## Availability

Cost classes: A = free DB read; write = free, confirm-gated; B = Labs per request (COUNTRY codes
only); C = live SERP per request per location. GSC reads are free platform calls against Google's
quota. A 402 on a metered call is a negative DataForSEO balance, never "no data".

| Tool | Status | Cost class | Note |
|---|---|---|---|
| `seo_gsc_search_analytics` | LIVE | A | any combination of `date`, `query`, `page`, `country`, `device`, `searchAppearance`; 25,000 rows, `start_row` to page; bounded by Google's ~16-month retention |
| `seo_gsc_search_queries`, `seo_gsc_top_pages`, `seo_gsc_time_series`, `seo_gsc_period_comparison` | LIVE | A | the reporting set; comparison caps winners/losers at 50 rows each |
| `seo_gsc_list_sites`, `seo_gsc_discover_sites` | LIVE | free | the heartbeat; `restricted_sites` separates 403-prone properties |
| `seo_gsc_inspect_url`, `seo_gsc_index_coverage` | LIVE | free | indexed snapshot only (no live test); coverage caps at 50 URLs per call |
| `seo_bing_stats`, `seo_bing_query_stats`, `seo_bing_pages`, `seo_bing_keywords`, `seo_bing_period_comparison`, `seo_bing_list_sites` | LIVE | A | ~6 months of daily history; comparison is site-level only |
| `seo_rankings_list` (= `seo_list_rankings`) | LIVE | A | the nine-lane tracker read; `group_by_keyword: true`; `view: 'history'` per `ranking_id` |
| `seo_ranking_predictions` | LIVE | A | `{ domain, risk_level, limit }`; linear extrapolation (Play 8 pointer) |
| `seo_competitor_changes` | LIVE | A | account-wide feed written by a workflow node; empty with no such workflow |
| `seo_sync` | LIVE | write | fans out across every connection unless `connection_id` scopes it; `full: true` forces a full re-sync; confirm on large accounts |
| `seo_serp_get` | LIVE | A | stored SERP analysis rows (no writer today); the live SERP is `seo_research({ action: 'serp' })` or `serp_organic_live_advanced`, class C |
| `dataforseo_labs_google_historical_serp` | LIVE | B | the SERP as it stood on past dates for one keyword and location: who held the positions before the cliff |
| `seo_connection_create`, `seo_connection_delete` | LIVE | write | GSC needs the FULL `webmasters` scope; delete is a soft delete |
| `seo_query_page_metrics` | LIVE | A | the permanent query x page x day archive; `site_url` or `connection_id`, `from`, `to`, `query_like`, `page_like`, `group_by`, returns rows plus `archive_coverage`; `seo_gsc_search_analytics` with `dimensions: ['date','query','page']` covers only Google's 16 months |
| `seo_issues` | LIVE | A | position drops and CTR anomalies computed from GSC; Play 2 and Play 5 stay the hand-run deep dive |
| `seo_tracking_project_get`, `seo_tracking_project_update`, `seo_tracking_project_delete` | LIVE | A / write | the `seo_projects` row (`name`, `description`, `target_country`, `target_language`, `is_active`) - distinct from `seo_project_get`, which is the WEBSITE project's SEO settings; delete is ask-gated and takes the tracked history with it, a hard stop without a named id and a written yes |

---

## 1. The three ledgers

Three independent records of "how are we doing in search". They disagree, and the disagreements are
the diagnosis. Never blend them into one number.

| Ledger | Holds | Does NOT hold |
|---|---|---|
| **Search Console**: `seo_gsc_search_analytics`, `seo_gsc_search_queries`, `seo_gsc_top_pages`, `seo_gsc_time_series`, `seo_gsc_period_comparison` | What Google served and users clicked | Rank on a given day (position is impression-weighted across devices, countries, personalisation); anything past ~16 months; queries below the privacy threshold |
| **Bing Webmaster**: `seo_bing_stats`, `seo_bing_query_stats`, `seo_bing_pages`, `seo_bing_keywords`, `seo_bing_period_comparison` | An independent engine, ~6 months of daily history, a proxy for Copilot-class AI surfaces | Per-query or per-page diffs. Bing's API has no dimensions parameter, so `seo_bing_period_comparison` is site-level only |
| **Rank tracker**: `seo_rankings_list` (alias `seo_list_rankings`), `seo_ranking_predictions` | A scheduled check of keywords you chose, at fixed device and location. One tracked keyword is up to NINE lanes (rows): `google`, `bing`, `local` (pack position), `mobile`, and the AI engines `ai_overview`, `chatgpt`, `claude`, `gemini`, `perplexity`. `group_by_keyword: true` pages by keyword and `pagination.total_groups` is the honest keyword count (`total` counts lanes). `previous_rank` advances only on a new check day, so a same-day re-read shows no delta. `check_frequency` defaults to weekly. About $0.003 per scheduled organic check, about $0.10 per keyword per engine per AI check | Anything untracked (a 12-keyword tracker cannot explain a sitewide move). AI lanes on keywords created before the AI engines existed: a blank AI column means NOT TRACKED, never "not ranking" |

**The tracker tells you position, GSC tells you consequence, Bing tells you whether it is you or
Google.** A tracked keyword falling 4 to 9 with GSC clicks flat is usually noise. GSC clicks halving
with the tracker flat is coverage, CTR or SERP shape, not rank. Both engines falling on the same date
is almost never an algorithm update; it is your site. (Always use the named `seo_gsc_*` tools below.
There is no generic Search Console tool to fall back on, so if none of them covers what you need,
say so rather than reaching for something that does not exist.)

### 1.1 The archive and the issue feed

Behind the GSC tools sits a synced metrics table that holds FIVE dimension signatures side by side
(date-only, query, page, device, country). Each live tool pins one signature; summing across them
multiplies clicks. The `date,query,page` combination does not live there at all: it lives only in a
permanent query x page x day archive, read with `seo_query_page_metrics` (Availability). The same
rows also come from `seo_gsc_search_analytics({ dimensions: ['date','query','page'] })`, bounded by
Google's rolling ~16 months, which is why the month-1 baseline captures the full window. The
archive reader returns `archive_coverage` beside its rows: read it before claiming YoY on a property
connected eleven months ago.

`seo_issues` is the automated issue feed (position drops and CTR anomalies computed from GSC);
Play 2 and Play 5 remain the weekly hand-run deep dive behind whatever it raises.

The `seo_projects` row itself (the tracking project's name, target country and language,
`is_active`) is read with `seo_tracking_project_get`, edited with `seo_tracking_project_update`,
listed by `seo_list_projects`. Do not confuse it with `seo_project_get` / `seo_project_update`, which
take the WEBSITE project id and carry site-level SEO settings. Deleting the tracking project deletes
every tracked keyword and its history: a named id, the blast radius stated, a written yes, or refuse.

---

## 2. Read local data first

`/hiveku:pull seo` and `/hiveku:pull localseo` put the snapshot on disk. `hiveku-data/seo/`:
`rankings.json`, `tracked_keywords.json` (a different table from `keywords.json`), `gsc_queries.json`,
`gsc_pages.json` (28-day snapshots), `projects.json` (the `project_id` every project-scoped tool needs).
`hiveku-data/localseo/`: `bing_query_stats.json`, `bing_pages.json`, `bing_crawl_stats.json`,
`connections.json`. Read `hiveku-data/STATUS.json` and its `failed` array first.

Three rules that stop bad reporting: `fetched_at` over 48 hours old is orientation, not evidence;
`truncated: true` means `count` is a floor, never a total; a file with an `error` and empty `rows`
means **not retrieved**, never "no data" (telling a client they have no Bing traffic when the API key
expired is the most damaging mistake here). Anything reaching a report gets re-pulled live.

---

## 3. Decision frameworks

### 3.1 The attribution ladder (stop at the first confirmed cause)

1. **Measurement.** Wrong window, wrong property, data still processing, dead connection. Explains roughly a third of reported drops. Section 6.
2. **Us.** Deploy, redirect, noindex, title change, migration. Check ship dates in memory and PM tasks before blaming Google.
3. **Demand.** Impressions down with position flat means the query got less popular. Nothing is broken, and this is the most misdiagnosed case.
4. **SERP shape.** Same position, fewer clicks: an AI Overview, an ad block, PAA expansion, a carousel or a rival's sitelinks took the click.
5. **Competitors.** Someone outranked us. Confirm with `top_competitor_domain` and a live look.
6. **Algorithm.** Only after 1 to 5 are eliminated, and only if the move is broad: many unrelated queries, one date, the engines diverging. Confirm with `web_search` first.

Naming an update without eliminating 1 to 5 is malpractice, and unfalsifiable, which is why it is
tempting.

### 3.2 The four-signal decomposition

Clicks = impressions x CTR, and CTR is mostly position plus SERP shape. Pull all four for one window
and classify:

| Impressions | Position | CTR | Diagnosis and action |
|---|---|---|---|
| Down | Flat | Flat | Demand or coverage fell. Check YoY; if YoY is also down, check indexation |
| Flat | Worse | Down | Genuine rank loss. Play 3 |
| Up | Worse | Down | Long-tail impressions at bad ranks. Harmless dilution unless a new page cannibalises |
| Flat | Flat | Down | A SERP feature or snippet change took the click. Title/meta or answer-block work |
| Down | Better | Up | Shedding junk impressions, keeping good ones. Do nothing: a consolidation that looks like a drop on a clicks-only chart |

That last row is why you never report clicks alone.

### 3.3 Choosing the window

- **WoW**: 7 days vs the prior 7, matching weekday sets. Day-of-week seasonality on B2B sites runs 3x weekday to weekend.
- **MoM**: last 28 days vs the 28 before, never calendar months, which differ by up to 3 days and by weekend count and manufacture a 10 percent swing on their own.
- **YoY**: the same 28 days a year earlier. The only window that survives seasonality; lead with it in seasonal verticals (tax, education, retail, travel, home services) and check it before escalating a drop.
- **Pre vs post ship**: `period_a` = 28 days before, `period_b` = 28 after, filtered to the affected pages. Under 14 days post-ship is a guess.
- **Never end a window on today.** GSC finalises with a ~3-day lag, so a window ending today carries thin days. End 3 days back with `data_state: 'final'`; `data_state: 'all'` pulls in still-processing rows and is only right when you want the freshest signal and say so out loud. Days are Pacific-time days (section 6).

### 3.4 Materiality and write discipline

Rank findings by clicks at risk or available, not by position delta: a keyword moving 30 to 22 is a
bigger headline than 3 to 2 and worth far less. Use
`impact = impressions in window x (CTR at achievable position - current CTR)` with the section 5 curve
and work the top three. Ship three fixes a week that each move 50+ clicks a month, not thirty that move
two.

Almost everything here is a read; the writes are `seo_sync`, `memory_*` and `pm_tasks_*`. The failure
mode is therefore not a destructive write, it is a **confident wrong narrative** shipped to a client.
Still: confirm before `seo_sync` on a large account (unscoped it fans out across every connection;
`connection_id` narrows it) and before
creating tasks in bulk, never send anything client-facing without an explicit yes, and never target
what the account context marks protected.

---

## 4. The plays

### Play 0 - Open the session (every time)

`account_context_get({ domain: 'seo' })`; `memory_list` for what the last session decided and which
ship dates exist; `hiveku-data/STATUS.json` and `projects.json` for `project_id` and freshness, with
`get_account_info` to confirm the bound account; then `seo_gsc_list_sites`, the heartbeat that fails
loudly when the refresh token dies. `memory_create` the property string once.

### Play 1 - Weekly ranking review (tracker first)

```
seo_rankings_list({ view: 'keywords', domain, search_engine: 'google',
                    ranking_type: 'organic', group_by_keyword: true, limit: 200 })
```

- `group_by_keyword: true` collapses the nine lanes to one row per keyword; `pagination.total_groups`
  is the keyword count you report. `previous_rank` advances only on a new check day, so a movement
  read on the day of the check compares against the prior check, not against yesterday.
- `current_rank` was <= 10 and `previous_rank` now > 10: **top-10 losses**, investigated the same day:
  the URL, the live SERP, and `seo_competitor_changes({})` filtered to `our_domain` for a rival that
  shipped something.
- `current_rank` 4 to 15 with a strong `best_rank`: the striking-distance list, feeds Play 4.
- `last_checked_at` over 48 hours old on `check_frequency: 'daily'` rows: the **tracker** is stalled, not the ranking. Section 6 before believing this screen.
- `local_pack_position` going null on `ranking_type: 'local'` rows: a listing problem, not a page problem. Route to `references/local-seo.md`.

For anything worth explaining, `seo_rankings_list({ view: 'history', ranking_id, from_date, to_date })`
and read `rank_position` by `check_date` plus `serp_features`. A one-day spike that reverts is noise;
three consecutive checks in the new position is a real move; a `serp_features` change on the same date
means the SERP changed shape. Then the AI-surface pass most agencies skip: the same call with
`search_engine: 'ai_overview'` and `'perplexity'`. Losing an AI Overview citation while holding
position 3 explains an otherwise inexplicable CTR drop; fix via `references/aeo.md`.

### Play 2 - Weekly GSC comparison (the money call)

```
seo_gsc_period_comparison({
  site_url,
  period_a: { start: <day -17>, end: <day -11> },
  period_b: { start: <day -10>, end: <day -4> },
  dimensions: ['query'], row_limit: 5000 })
```

Repeat with `dimensions: ['page']`. Reading it:

- `summary` carries `a_total_clicks`, `b_total_clicks`, `keys_in_a`, `keys_in_b`, `keys_in_both`. **Read `keys_in_both` first.** A collapse versus `keys_in_a` means lost coverage, not lost rankings: whole queries stopped appearing, which is an indexation question.
- `winners` / `losers` sort by `clicks_delta` and are **capped at 50 rows each**, so the tail is invisible on a large site. Never sum `losers` as the loss; totals come from `summary`.
- `rank_climbers` / `rank_droppers` are also capped at 50 and filtered to `|position_delta| > 1` with a nonzero position in **both** periods, so a query that newly appeared or fully vanished never shows here, only in `winners` / `losers`. For "what did we lose completely", diff two `seo_gsc_search_queries` calls.
- `position_delta` is signed Google-style: **negative is improvement.** Do not flip it in a report, and do not let a chart library flip it for you.

Then the call that finds the real story: the same comparison on `dimensions: ['query','page']`, where
`key` comes back as `query | page`. Two rows, same query, different pages, one gaining and one losing,
is **not** a ranking loss: Google swapped which URL it serves. That is consolidation or live
cannibalisation, and it belongs to `references/content-strategy.md`, not to "fixing" the loser.

### Play 3 - Diagnosing a real drop

Trigger: a top-10 loss, or any traffic move over 20 percent WoW on a money page. Same-day, and the
client never finds out first. Measurement artifacts are ruled out BEFORE any causal story (property
string, the lag, impression-weighted position, a dead connection: section 6), and only then
indexation via `seo_gsc_inspect_url`, SERP-feature shifts and competitor launches.

1. **Rule out a window artifact.** `seo_gsc_time_series({ site_url, start: <90d back>, end: <day -3>, filters: [{ dimension: 'page', operator: 'equals', expression: <url> }], data_state: 'final' })`. A cliff on one date is an event; a slope over weeks is decay or competition; a dip that recovers is the lag.
2. **Decompose the four signals** across both windows (3.2). That alone routes you.
3. **Position worsened:** `seo_rankings_list({ view: 'history', keyword, domain })` gives `top_competitor_domain` and `serp_features`; `web_scrape` the competitor URL to see what changed.
4. **Impressions collapsed, position held:** coverage. Route to `references/technical-seo.md`. Causes in frequency order: a deploy changed the URL, a canonical points elsewhere, a template lost its internal links, a noindex or robots rule slipped in, the sitemap stopped listing it.
5. **CTR fell, position flat:** `seo_gsc_search_analytics` on `dimensions: ['query','searchAppearance']` for that page across both windows. A `searchAppearance` value that appeared or vanished is the answer; otherwise it is title and meta.
6. **Cross-check the second engine.** `seo_bing_period_comparison({ site_url, period_a, period_b })` over the same dates. Bing falling in lockstep means the cause is on your site; Google-only means it is Google. This one call settles more arguments than anything else here.
7. **Only now** consider an update: `web_search` for independent sources dated within a day or two of your cliff, `web_scrape` two or three to date it. No source, no update.
8. **Date the SERP itself** [SPENDS, class B]: `dataforseo_labs_google_historical_serp` for the keyword and location over the window around the cliff returns the SERPs as collected on past dates, features included. Who held position 3 the week before and who holds it now is the difference between "we slipped" and "the SERP was rebuilt", and it is the only tool evidence that dates a layout change. One keyword per money page, never the tracked list. The full sequence for a suspected update (Bing as the control, the two-week no-reactive-rewrite rule) is Recipe 8 in references/seo-playbooks.md; a sitewide crash walks Recipe 9 in references/seo-playbooks.md first, which starts at the measurement-artifact ladder.

**When the move is sitewide**, run step 1 unfiltered at 180 days to find the cliff date, then
`seo_gsc_period_comparison` on `['page']` across it (losses in one directory means a section problem:
template, content type, intent mismatch; spread evenly means sitewide), then segment with
`seo_gsc_search_analytics` on `['device']` and `['country']`, where mobile-only is a rendering or vitals
story and single-country is usually SERP features or local competition.

Close the loop: `pm_tasks_create` for the fix with the diagnosis in the body, `memory_create` with the
cliff date, cause and evidence chain. Report the elimination chain, not just the verdict.

### Play 4 - Striking-distance harvest (the highest-ROI hour)

```
seo_gsc_search_analytics({ site_url, start: <day -31>, end: <day -3>,
                           dimensions: ['query','page'], row_limit: 25000 })
```

Filter to `position` 4 to 15 and `impressions` >= 100 per 28 days, compute
`impressions x (CTR at position 3 - current ctr)`, sort descending, take the top 10, group by page.
Pages appearing repeatedly are the targets: one edit lifts several queries. Cross-check with
`seo_rankings_list({ view: 'keywords', min_position: 4, max_position: 15 })`, which also catches rows
where tracker and GSC disagree by over five places. Deliver as `pm_tasks_create`, one task per page
naming the queries, current and target position, and modelled gain. Never one giant task.

### Play 5 - CTR outlier harvest

`seo_gsc_search_queries({ site_url, start: <day -31>, end: <day -3>, row_limit: 1000 })`. For rows
with impressions >= 200, compare actual `ctr` to expected CTR at that `position` and flag anything
below **60 percent of expected**: the ranking already won the click and the title is losing it. Rule
out a feature artifact first with `seo_gsc_search_analytics` on
`dimensions: ['query','searchAppearance']` filtered to the query; if the query only appears inside a
feature you do not own, no rewrite helps and the honest answer is that the click is not available.
Draft replacements with `talk_to_department({ domain: 'seo', message })`, feeding it the query, title,
position, actual and expected CTR, and the voice from `account_context_get`. Confirm each rewrite.

### Play 6 - Did the thing we shipped work

`seo_gsc_period_comparison` with `period_a` = the 28 days before the ship, `period_b` = the 28 after,
`dimensions: ['page']` and a filter such as
`{ dimension: 'page', operator: 'contains', expression: '/services/' }`. Then `seo_gsc_time_series` over
the same span and filter, which shows whether the lift starts at the ship date or was already drifting
up. The control question that separates an analyst from a dashboard: **did the rest of the site move
the same way?** Run the identical time series with no filter. If the site rose 18 percent and your page
rose 19, you shipped nothing. Report the delta against the site trend, then `pm_tasks_complete` with the
result in the note and `memory_update` the strategy memory.

### Play 7 - Bing as an independent instrument

Bing is rarely a traffic story (2 to 8 percent of Google clicks in the US; higher in enterprise,
government, healthcare and desktop B2B). Four jobs: confounder control
(`seo_bing_period_comparison` over Play 2's windows); crawl feedback (a new URL in `seo_bing_pages` is
early evidence the change was discoverable); AI-surface proxy (Copilot-class surfaces lean on Bing's
index, so `seo_bing_query_stats` presence leads the AEO work); and a query-set diff against
`seo_gsc_search_queries`, where a query performing on Bing but absent from Google is usually a
Google-side coverage gap.

- `seo_bing_period_comparison` returns `summary` with `a_clicks`, `b_clicks`, `clicks_delta`, `a_position`, `b_position`, `position_delta` (negative is better), `a_ctr` / `b_ctr` **already in percent**, `ctr_delta_pp` in percentage points, and `a_day_count` / `b_day_count`. **Always compare the day counts**: unequal counts mean unequal windows and a fictional delta. `daily_a` / `daily_b` chart the trend without a second call.
- A `hint` appears on zero rows or an empty period. Bing retains ~6 months of daily history, so older periods come back empty: retention, not a drop.
- `seo_bing_keywords` (tracked keyword performance; `country`, `language`, default `us` / `en-US`) is a different dataset from `seo_bing_query_stats` (queries traffic came from). Never cite one as the other. `seo_bing_stats` is the raw daily series and the Bing heartbeat; `seo_bing_list_sites` shows what the key sees.

### Play 8 - Forecasting and expectation setting (pointer)

The method lives in `references/forecasting-and-seasonality.md`. What this instrument panel keeps:
`seo_ranking_predictions({ domain, risk_level: 'high', limit: 100 })` is a free read of 30-day
forecasts computed every Sunday by linear trend extrapolation over rank-check history (organic keywords
with 5+ checks spanning 21+ days in the last 120; `confidence_score` = fit R-squared x 100;
`backlinks_needed` not computed; empty with a note when history is short). Use it as a triage queue:
`risk_level: 'high'` with `confidence_score` >= 60 is a real downward trend worth a defensive task now;
below 40 the fit is unusable; anything projected into the top 3 stays out of client material.

### Play 9 - Baseline and monthly narrative

Baseline (month 1; Recipe 1 in references/seo-playbooks.md) captures the full ~16-month GSC window, all Google retains, with
`seo_gsc_search_analytics` on `['date']`, `['query']`, `['page']` and `['query','page']` at
`row_limit: 25000`, paginating with `start_row` whenever a call returns exactly `row_limit` rows.
`memory_create` the totals, seasonal peaks, top 20 pages and top 50 queries: every YoY claim depends
on it.

Monthly: `seo_gsc_period_comparison` MoM on `['query']` then `['page']`; `seo_gsc_time_series` for the
current 28 days and the same 28 a year ago; `seo_rankings_list` for the tracked-keyword table;
`seo_gsc_top_pages` and `seo_gsc_search_queries` for the tables; `seo_bing_period_comparison` for a
second-engine note when it changes the interpretation. Annotate the trend with ship dates from
completed PM tasks, or the client invents their own causal story.

---

## 5. Thresholds and benchmarks

**Position-to-CTR (blended, for sizing only, never a promise).** p1 ~28%, p2 ~15%, p3 ~10%, p4 ~7%,
p5 ~5%, p6-10 ~2-4%, page 2 <1%. Branded queries run 2 to 3x these; an AI Overview or large feature
block runs 30 to 50 percent below. State the assumption behind every modelled gain.

| Signal | Threshold | Action |
|---|---|---|
| Tracked keyword leaves top 10 | any | Same-day investigation (Play 3) |
| Money-page clicks WoW | -20% or worse | Same-day investigation |
| Sitewide clicks WoW | -15% with impressions down too | Site event until disproven |
| Sitewide clicks WoW | +/-10% | Normal variance. No ticket |
| `position_delta`, 500+ impression query | > +3 | Investigate. The tool's >1 floor is too noisy |
| CTR vs expected, impressions >= 200 | < 60% of expected | Title/meta rewrite candidate (Play 5) |
| Striking distance | position 4-15, impressions >= 100 / 28d | On-page plus internal-link task (Play 4) |
| `keys_in_both` vs `keys_in_a` | down > 15% | Coverage problem, not ranking. Route to technical |
| `last_checked_at` on a daily row | > 48h old | Tracker stalled. Section 6 |
| `confidence_score` on a prediction | < 40 | Ignore the forecast |
| Bing share of Google clicks | < 2% or > 15% | Investigate; both extremes usually mean a measurement fault |

**Time to effect, to quote in the plan:** title/meta 1 to 3 weeks; technical fix on an indexed page 2
to 6 weeks; refresh of a ranking URL 2 to 8 weeks; net-new content 3 to 6 months; links a quarter.
**Volatility floor:** positions swing 1 to 3 places day to day with no cause, so below a 3-place move
on one keyword, write nothing.

---

## 6. Diagnosis: when the data itself looks wrong

**Empty GSC response.**

1. `seo_gsc_list_sites`: does the property appear, at what permission level? A `siteRestrictedUser` property lists but 403s on data queries; `seo_gsc_discover_sites({ id })` separates queryable `sites` from `restricted_sites`.
2. **Property string mismatch is cause number one.** `sc-domain:example.com` covers every subdomain and protocol; `https://example.com/` covers exactly that prefix, so `https://www.example.com/` is a different property with different data. Match it exactly.
3. **The silent failure that burns hours:** the route matches `site_url` against the account's connections, and when nothing matches it **falls back to the first connection**. A typo'd property does not error cleanly; it queries Google with the wrong credentials and returns a 403 or an empty set. On multi-property accounts, omit `site_url` and let the bound connection answer, or copy the string verbatim.
4. A 412 "No Google Search Console connection configured", or a token-refresh failure, means the OAuth is dead. Reconnecting is a setup task: follow the SEO SETUP.md (written to `hiveku-data/seo/SETUP.md` by `/hiveku:pull` only where an integration needs connecting), or create the connection directly with `seo_connection_create` - for GSC that is `{ platform: 'google_search_console', site_url, client_id, client_secret, refresh_token }` with the FULL `webmasters` scope, not `.readonly`, or sitemap submit/delete will 403. A phantom or stuck pending row from a failed OAuth is removed with `seo_connection_delete` (soft delete: sets `is_active=false`, keeps the row for audit history).

**Numbers do not reconcile between calls.** GSC deduplicates per dimension set: summed per-query clicks
land **under** the site total because sub-threshold queries are withheld, and summed per-page clicks
can land **over** it. Both are expected. Quote each figure from the dimension set that produced it.
**The five-signature rule:** the synced table holds five dimension signatures (date-only, query,
page, device, country) side by side; never sum across signatures, and never add a `query` figure to
a `page` figure to make a total. Totals come from the date-only signature or from
`seo_gsc_period_comparison`'s `summary`.

**The Pacific-time boundary.** GSC rows are dated in Pacific time, not the client's timezone and
not UTC. A "yesterday" window drawn in UTC straddles two Google days; a Monday-to-Sunday week in
Eastern time is not the week Google counted. Draw every window in Pacific days, end it 3 days back
(`data_state: 'final'`), and say so when a client's own dashboard disagrees by a day.

**Position moved but nobody changed anything.** Position is impression-weighted, so winning new
impressions in another country at position 40 drags the average down while nothing lost a ranking.
Segment by `['country']` or `['device']` first. Relatedly, tracker and GSC are expected to disagree:
the tracker checks one device in one location while GSC averages everything, and divergence over five
places usually means `location_name` or `device_type` misses the client's audience.

**Rank tracker stalled.** Old `last_checked_at` across many rows means the daily ranking worker did not
run, not that rankings froze. Confirm from `seo_rankings_list`, then `seo_sync({ project_id })` and
re-read. Never report a stale `current_rank`.

**Capabilities with no tool at all.** Manual actions and security issues are absent from Google's API
and from Hiveku: if you suspect a penalty, the client must open Search Console's UI and read it back.
There is no live URL test either, only the indexed snapshot. SERP-volatility indices and update
confirmation have no tool: use `web_search` and `web_scrape`. Bing crawl stats and URL inspection live
in `references/technical-seo.md` (local copy: `hiveku-data/localseo/bing_crawl_stats.json`).

**Bing returns nothing.** `seo_bing_list_sites` first: failure means the API key is dead or rotated.
Success with an empty `seo_bing_stats` means the property is verified but has no traffic yet, common in
the first 30 days; the `hint` on `seo_bing_period_comparison` says which case you are in. The account
resolves a single Bing connection, so a second Bing property added later may not be the one queried.
**A project-scoped tool returning nothing** usually means a wrong `project_id`, which yields an empty
set, not an error. Still stuck: `hiveku_docs_search` then `hiveku_docs_get`.

---

## 7. Edge cases and failure modes

- **Never flip the sign of `position_delta`.** Negative is improvement in both period-comparison tools.
- **Never tell a brand story without splitting it.** A brand-heavy site can lose every commercial ranking while total clicks stay flat because brand demand rose. Split with `filters: [{ dimension: 'query', operator: 'excludingRegex', expression: '<brand>' }]`; nonbrand clicks are the number that measures your work.
- **Never read a Discover cliff as a search problem.** `search_type: 'discover'` is a separate surface with its own volatility; report web and Discover separately.
- **The migration mirage.** After a domain or URL migration, page-level comparisons across the cutover show near-total loss because the keys changed. Compare on `['query']`, not `['page']`.

---

## 8. Persistence and reporting

**Memory.** `memory_create` for: the GSC property string and its type, the Bing property, baseline
totals, every cliff date with its cause and evidence chain, the brand-term regex, seasonal peak months,
and the tracker's location and device convention. `memory_update({ memory_id, content })` when a fact
changes rather than creating a second contradicting memory, and `memory_list({ domain: "seo" })` every
session so you inherit these. `memory_update` REPLACES the document, so the body you send is the one
`memory_list` returned with the fact edited in, never the edit on its own.

**PM tasks.** `pm_tasks_create` one task per actionable finding, carrying the query or page, current
and target numbers, modelled click impact, and the time to effect from section 5. `pm_tasks_update`
when blocked or rescoped, with the reason. `pm_tasks_complete` only after Play 6 measured the outcome,
with the delta in the note. An analysis that produces no tasks produced no value.

**Client reporting.** Assembly lives in `references/reporting-and-delivery.md`. What this reference
owes it: nonbrand clicks MoM and YoY with the window in days; movement from
`seo_gsc_period_comparison` plus the `seo_rankings_list` table, written as "was 12, now 6" rather than
signed deltas, which clients misread every time; a one-sentence cause per material move from the 3.1
chain; and the striking-distance list with its CTR assumption spelled out. Draft with
`talk_to_department({ domain: 'seo', message })`, verify every figure against the call that produced it,
and ship nothing client-visible without confirmation.
