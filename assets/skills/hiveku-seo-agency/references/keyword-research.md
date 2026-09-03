# Keyword and Topic Research: Operator Manual

## What this covers / when to load this

The deep manual behind the keyword-research lane of the `hiveku-seo-agency` SKILL.md: building a keyword universe from
seeds, qualifying it, clustering it, tearing down the SERP to learn what the page has to be, sizing the
opportunity with a defensible forecast, choosing what to track, and re-qualifying on a cadence. Load it
for net-new research, rebuilding a stale keyword set, planning a content roadmap, judging whether a
cluster is winnable, forecasting traffic or revenue from rankings, or diagnosing keyword and ranking
data that looks wrong. Not for rank reporting (`rankings-and-search-console.md`), briefs and refresh
decisions (`content-strategy.md`), or competitor and link intelligence
(`link-building-and-competitors.md`). The metered DataForSEO Labs expansion and qualification
catalog AND the shared CTR and difficulty tables live in `metered-research-suite.md`.
This file repeats neither.

## Availability

Cost classes: A = free DB read; write = free, confirm-gated; B = Labs / keywords_data per request
(batch up to 1,000 keywords; COUNTRY location codes only, 2840 = US, the server retries with US
and returns `location_note`); C = live SERP per request per location (city and region codes
accepted). A negative DataForSEO balance makes every metered call a 402; 503
`dataforseo_unconfigured` means no credentials. Neither is "no keywords".

| Tool | Status | Cost class | Note |
|---|---|---|---|
| `seo_research` | LIVE | B / C | 60-action router: `keyword-ideas`, `related-keywords`, `keyword-overview`, `keyword-gap`, `historical-search-volume`, `keyword-trends`, `top-searches`, `serp`, `maps-serp`, `ai-keyword-volume`; returns without persisting |
| `dataforseo_labs_google_keyword_ideas`, `dataforseo_labs_google_keyword_suggestions`, `dataforseo_labs_google_related_keywords`, `dataforseo_labs_google_keywords_for_site` | LIVE | B | the expansion set; batch rules in metered-research-suite.md |
| `dataforseo_labs_google_top_searches` | LIVE | B | the 7-billion-keyword pool by location; a category sweep when seeds are thin |
| `dataforseo_labs_google_page_intersection` | LIVE | B | keywords 2-20 specific URLs share; a rival pillar versus ours |
| `dataforseo_labs_google_historical_keyword_data` | LIVE | B | monthly volume back to August 2021; the seasonal-index input |
| `ai_optimization_keyword_data_search_volume` | LIVE | B | GOOGLE volume as an AI-demand proxy; no per-engine AI volume exists anywhere |
| `keywords_data_google_ads_search_volume` | LIVE | B | Ads-grade volume for the qualified set |
| `seo_serp_get` | LIVE | A | stored SERP analysis rows (no writer today); the live SERP is `seo_research({ action: 'serp' })` or `serp_organic_live_advanced`, class C |
| `seo_serp_features`, `seo_featured_snippets` | LIVE | A | feature history and winnable snippets, written by AEO audit runs |
| `seo_entity_check` | LIVE | free | Knowledge Graph lookup |
| `seo_keyword_clusters`, `seo_topic_clusters` | LIVE | A | STORED cluster rows; empty until something created them |
| `seo_keyword_cluster_create`, `seo_topic_cluster_create` | LIVE | write | one confirmed cluster at a time |
| `seo_track_keyword` | LIVE | write, then about $0.003 per scheduled organic check; AI lanes about $0.10 per keyword per engine | one keyword = up to nine lanes (Play 7) |
| `seo_tracked_keywords_list`, `seo_rankings_list` (= `seo_list_rankings`) | LIVE | A | `group_by_keyword: true` pages by keyword; `total_groups` is the keyword count |
| `seo_tracked_keyword_delete` - the row history dies, the lanes pause | LIVE | write | the config row and its `keyword_rank_history` are gone with no undo; the rank lanes are PAUSED (checks and billing stop, lane history kept) unless a sibling row keeps them running; resume takes re-track plus `seo_tracked_keyword_update` (seo-change-discipline.md 2.7); never a keyword that appeared in a delivered report |
| `seo_list_keywords` (= `seo_keywords_list`) | LIVE | A | the domain's currently ranked keywords from domain analysis, not your research |
| `seo_ranking_predictions` | LIVE | A | `{ domain, risk_level, limit }`; linear extrapolation, Play 6 |
| `seo_tracked_keyword_get` | LIVE | A | one tracked-keyword row by `keyword_id`; `seo_tracked_keywords_list` remains the bulk read |
| `seo_tracked_keyword_update` | LIVE | write | `target_url`, `search_engine`, `location_code`, `language_code`, `device_type`, `is_active`, `tracking_frequency`, `target_rank`, `tags`; mirrors the edit onto the `website_rankings` lanes and returns `lanes_updated` - read it back; `is_active: false` pauses every lane (checks and billing stop, all history kept), `is_active: true` resumes paused lanes at the row's `tracking_frequency`; delete plus re-track still destroys the row's history |
| `seo_rankings_platforms_set` | LIVE | write | ask-gated; sets a keyword's lanes in one call: `engines[]`, `track_mobile`, `track_local`, `business_name`; REMOVING a lane deletes that lane's history; it never unpauses an existing lane |
| `seo_rankings_locations` | LIVE | free | live DataForSEO location directory, US-only; resolves the exact `location_code` + `location_name` pair `seo_track_keyword` and `seo_rankings_platforms_set` need; `q` substring search, default 50 rows, max 500; `serp_locations` stays the vendor alternative and the only path to non-US city codes |
| `seo_keyword_cluster_get`, `seo_keyword_cluster_update`, `seo_keyword_cluster_delete` | LIVE | A / write | by `cluster_id`; delete is ask-gated; `seo_keyword_clusters` remains the list read |
| `seo_topic_cluster_get`, `seo_topic_cluster_update`, `seo_topic_cluster_delete` | LIVE | A / write | by `cluster_id`; delete is ask-gated; `seo_topic_clusters` remains the list read |

---

## 0. Pre-flight (never skip; free)

1. `account_context_get({ domain: 'seo' })`. Read the `instructions` field before any generative call.
   Mine it for what the client actually sells (business-value scoring is worthless without it), the
   geography they serve, and any protected terms (brand, partner marks, conquest rules).
2. `memory_list`, then read prior research memories: a previous session almost certainly agreed a
   competitor set, location code, seed vocabulary and rejected-terms list.
3. Local snapshot before live calls: `hiveku-data/seo/keywords.json`, `rankings.json`, `projects.json`,
   `competitors.json`, plus `hiveku-data/localseo/*.json`. Free orientation, never decision-grade.
4. Scope: `seo_list_projects` for `project_id` (its rows carry the tracked domain;
   `seo_project_list_active` is the richer read, with is_active/search/page filters), and
   `seo_connections_list` for which sources are configured. Do NOT reach for
   `seo_project_get` here: it reads a WEBSITE project's site-level SEO settings and takes the
   builder project id, a different id space entirely (see reporting-and-delivery.md, Play G).
   Nearly every tool below needs `project_id`. No project or no data sources: stop and run the
   setup path (`seo_create_project` for the tracking project, `seo_connection_create` per the
   BYOK arguments in `outcomes-and-measurement.md`, then `seo_sync`), never improvise it.
   `get_account_info` gives the account-level domain and timezone for report framing.

Alias note: several reads ship under two names (`seo_list_keywords` / `seo_keywords_list`,
`seo_list_rankings` / `seo_rankings_list`); same capability, so call one and try the other if it rejects
an argument shape, before concluding data is missing.

---

## 1. Decision frameworks

### 1.1 The funnel

`seeds -> universe -> qualified -> clustered -> mapped -> prioritized -> tracked -> forecast -> roadmap`

Every stage removes keywords. A pass ending with more keywords than it can defend is a spreadsheet, not
research. Healthy shrinkage on a service business: 25 seeds, 3,000 universe, 600 qualified, 40 clusters,
8 prioritized this quarter, 60 tracked.

### 1.2 Seeds are a business question

You cannot expand your way out of a bad seed set. Build from four labelled sources: **offer seeds** (the
services or products, in the client's words and in the customer's words, which differ; the
`account_context_get` avatars carry the customer's), **problem seeds** (the symptom typed before the
buyer knows the product name), **comparison seeds** (category plus vs, alternative, best, pricing,
cost), and **geography seeds** (local clients only, and only units they can serve). Validate the
vocabulary first: `web_search` two or three problem seeds and read the language in the top results, or
`web_scrape` the client's service pages plus a competitor's and `web_extract` the recurring nouns.

### 1.3 The SERP is the specification

Never decide what to build from volume and difficulty alone. `seo_serp_get({ keyword })` on the cluster
head, every time, before the cluster is committed. Read the **result type mix** (top ten are product
category pages, a blog post cannot win however good; top ten are editorial listicles, a product page
cannot win), **who holds 1-5** (three or more national brands, marketplaces or Wikipedia means re-scope
whatever the difficulty number says), **freshness** (top five all dated inside 90 days makes this a
recurring-refresh keyword, and that ongoing cost is part of the decision), and **depth signals**
(word-count band, subheading pattern, tables, calculators, video). Then
`seo_serp_features({ project_id, keyword })` for the feature layout (AI Overview, featured snippet,
People Also Ask, local pack, shopping, video, sitelinks). Features are a tax on CTR (3.2) and sometimes
the only winnable slot on the page.

### 1.4 Intent taxonomy, and what it forces you to build

| Intent | Signal | Page type that ranks | Weight |
|---|---|---|---|
| Transactional | buy, quote, near me, hire, book, pricing | Money page, service page, product | 1.0 |
| Commercial | best, vs, review, top, alternatives | Comparison, listicle, case study | 0.8 |
| Informational | how, what, why, guide | Guide, pillar, tutorial | 0.4 |
| Navigational | brand names | Existing brand asset | 0.1 |

Two rules violated constantly. Intent is whatever the SERP shows, not what the modifier suggests ("best
X" often returns product category pages). And one intent gets one URL: same-intent keywords split across
clusters is cannibalization on paper, which materializes the day both pages publish.

### 1.5 Priority scoring

Base score per cluster: **volume x intent weight x business value / difficulty band**. Intent weight
is the 1.4 column (transactional 1.0, commercial 0.8, informational 0.4, navigational 0.1);
business value is the client-confirmed 1 to 3 (do they sell this?); the difficulty band is the
attackable band for the client's authority tier (`metered-research-suite.md`). Rank descending:
that ordering IS the roadmap. Persist the matrix into the strategy deliverable via
`seo_sheet_create_tab` so nobody re-pays for the same research next quarter, and before any
net-new plan leaves this play check it against what already ranks (`seo_cannibalization`,
`seo_list_rankings`): a plan drawn up blind manufactures cannibalization against the client's own
ranking pages. Then apply three adjustments the base formula leaves out:

- **Serviceability (0 or 1)**: can the client fulfil this, in this geography, at this price? A 0 kills
  the keyword regardless of score. Main source of roadmaps that generate unqualified leads.
- **SERP feature drag (0.5 to 1.0)**: the factor from 3.2. A 1,000-volume keyword under a full AI
  Overview plus local pack is worth less than a clean 400-volume SERP.
- **Asset readiness (0.7 to 1.3)**: already ranking 5-30 discounts the cost, so a bonus; a net-new
  pillar plus spokes on a KD-50 cluster takes the penalty.

Rank clusters descending. That ordering is the roadmap; write it and its inputs to memory so next
quarter argues with numbers.

### 1.6 Sequencing doctrine

Ordered by time-to-value: (1) **harvest** striking distance, positions 4-15 on keywords we already rank
for, weeks; (2) **refresh** decaying URLs that hold the intent, weeks to two months; (3) **fill**
clusters missing one spoke; (4) **build** net-new pillars, three to six months; (5) **siege** KD 60-plus
heads, only with a funded link plan. Never open an engagement at step 4: the first 60 days need a
visible win, and steps 1 and 2 are where it lives.

---

## 2. The plays

### Play 1: Build the universe

1. Pre-flight, then seeds per 1.2.
2. Expand with the metered suite catalogued in `metered-research-suite.md` (keyword ideas,
   suggestions, related keywords, keywords-for-site, bulk difficulty and intent, Ads-grade volume):
   batch to the documented maximum at the correct location and language, dedupe the union before
   qualifying, qualify in bulk. One call with 25 seeds, never 25 calls with one seed. Metered, and
   the most expensive routine action in this manual. `seo_research` is an alternative surface over
   some of the same endpoints: an action-router whose `action` argument is required and picks the
   endpoint (`keyword-ideas`, `related-keywords`, `keyword-overview`, `keyword-gap` and the rest of
   its catalog), fed by `keyword` / `keywords` / `domain` plus `location_code` and `language`. It
   takes NO `project_id` - the proxy silently drops arguments a tool does not declare, so passing
   one changes nothing - and it RETURNS results without persisting them anywhere you can read back
   (its one persisting action is `aeo-audit`, which writes the SERP-feature tables, and the
   dedicated `seo_aeo_audit_run` supersedes that). Four Labs tools that widen the universe when the
   standard expansion runs thin, all class B and confirmed before calling:
   - `dataforseo_labs_google_top_searches`: the whole keyword database for a location, with Ads
     metrics. A category sweep when the client's vocabulary is unknown; filter hard, it is a
     firehose (`seo_research({ action: 'top-searches', location_code })` is the routed form).
   - `dataforseo_labs_google_page_intersection`: keywords 2-20 named URLs share, organic, local
     pack and featured snippet included. Point it at a rival's pillar and ours: the difference is
     the missing spokes.
   - `dataforseo_labs_google_historical_keyword_data`: monthly searches back to August 2021 per
     keyword. The input for a seasonal index and the only honest answer to "is this term growing".
   - `ai_optimization_keyword_data_search_volume`: labelled AI search volume, but DataForSEO
     publishes NO per-engine AI volume; this is Google volume used as a proxy (same as
     `seo_research({ action: 'ai-keyword-volume' })`). Never present it as ChatGPT demand.
3. Read out keyword, volume, difficulty, intent, CPC. On first read look for **shape**, not individual
   keywords: volume concentrated in three heads or spread across a long tail, intent mix commercial or
   informational. That decides pillar-and-spoke build versus money-page tuning.
4. The universe you just built exists only in this session until you persist it yourself: memory for
   the seed set and decisions (section 6), a deliverable sheet for the qualified matrix
   (`reporting-and-delivery.md`), `seo_keyword_cluster_create` for committed clusters,
   `seo_track_keyword` for the tracked list. `seo_list_keywords({ project_id })` does NOT read your
   research back: it reads the project keyword store that the dashboard's domain analysis populates
   with the domain's currently ranked keywords, and no tool in this manual writes to it. Read it as
   a second orientation source - what the domain already ranks for - never as confirmation that a
   research pass landed.

**Decision**: whether the account has a real demand pool. Under roughly 150 qualified keywords with
meaningful volume is a low-demand niche; say so, and pivot toward conversion, local and AEO rather than
promising traffic growth. **Closes the loop**: `memory_create` with the seed set, location and language
codes, run date, universe size, and rejected terms with reasons.

### Play 2: Cluster the universe

1. `seo_keyword_clusters({ project_id })` is a free DB read of the cluster rows already stored for
   the project (from prior `seo_keyword_cluster_create` calls, yours or the dashboard's). An empty
   result means nothing has been stored yet, not that research failed; clustering a fresh universe
   is your work, done on the Play 1 expansion output. Read out label, member count, aggregate
   volume, dominant intent, difficulty spread.
2. Audit before accepting. Three failure shapes: **mega-cluster** (200 keywords under one label; split
   by intent then modifier family), **singleton spray** (dozens of one-member clusters; merge by SERP
   overlap, not string similarity), **intent bleed** (transactional and informational together; always
   split).
3. Confirm the structure with the user, then `seo_keyword_cluster_create` per agreed cluster with an
   explicit name and member list. This is a write; never bulk-create forty clusters from a machine
   grouping you have not read.
4. For clusters deserving a pillar, `seo_topic_clusters({ project_id })` for hub-and-spoke mapping, then
   `seo_topic_cluster_create` for pillar plus spokes. Same rule.

**Keyword vs topic cluster**: a keyword cluster is queries sharing one URL; a topic cluster is one
pillar, N spokes, and the internal links between them. Never create both for the same keyword set, or
the next session builds both. Under 5 keywords or ~300 aggregate MSV it is a keyword cluster on a single
page. **Closes the loop**: `pm_tasks_create`, one per committed cluster, titled with the head keyword and
page type.

### Play 3: SERP teardown before a cluster is committed

Run on the cluster head and its two highest-volume members, not on all of them.

1. `seo_serp_get({ keyword })` at the right location. Read the ten organic results per 1.3.
2. `seo_serp_features({ project_id, keyword })`. Record the features present; this feeds the CTR haircut
   and the format decision.
3. `seo_entity_check` on the client's brand and on the topic entity. A weak or absent entity on a
   commercial cluster means the trust layer (about, authorship, citations, schema) ships alongside the
   money page, or that page underperforms its difficulty score.
4. If the SERP is ambiguous, `web_scrape` the top two results and `web_extract` their headings.

**Decision**: page type, depth, schema, go/no-go. A cluster that survives the score but fails the top-5
composition test gets demoted to siege or dropped.

### Play 4: Striking-distance harvest (do this first, every account)

`seo_list_rankings({ project_id, limit: 200 })`, filtered to positions 4-15 and cross-referenced against
the qualified universe for real volume and business value, is the harvest list. Per item,
`seo_serp_get({ keyword })` confirms the intent still matches the ranking URL, since intent drift is the
most common reason a page sits at 8 forever.

**Decision**: the first 30 days of work, as on-page tune, internal link and content-addition tasks, not
net-new pages. **Closes the loop**: `pm_tasks_create` per item with URL, target keyword, current
position and the specific change; `seo_track_keyword` for anything not already tracked so movement is
provable.

### Play 5: Featured snippet and SERP feature targeting

`seo_featured_snippets({ project_id })` gives the winnable list, and a position 4-8 page on a snippet
SERP is the cheapest top-of-page real estate on the board. Per candidate, `seo_serp_get({ keyword })` and
read the **current snippet format**: paragraph, numbered list, bulleted list, table. Match it; answering
a table query with a paragraph loses. `seo_serp_features({ project_id, keyword })` confirms the feature
is still live, since presence is volatile and stored data can be days old; if it shows on two of three
checks, treat it as present. You generally need to be top 10 already, ideally top 5, before format
optimization matters; at position 14 this is a ranking problem. No tool here publishes the change, so
raise `pm_tasks_create` and hand it to the content play.

### Play 6: Forecasting (pointer)

The full method, the seasonal index, the hand-built band and the roadmap impact column live in
`references/forecasting-and-seasonality.md`. What this file keeps: the tool call is
`seo_ranking_predictions({ domain, risk_level, limit })`, a free read of 30-day forecasts computed every
Sunday by LINEAR trend extrapolation over rank-check history (organic keywords with 5+ checks spanning
21+ days in the last 120; `confidence_score` = fit R-squared x 100; `backlinks_needed` NOT computed).
Gates before quoting it: no keyword with under ~8 weeks of history (`seo_tracked_keywords_list` gives
the start date), nothing that never entered the top 50, no predicted improvement over 15 positions
inside 90 days without a funded plan, `confidence_score` under 40 ignored. Show the client a band
(plus or minus 30 percent at 90 days, 50 at six months) built from MSV x seasonal index x CTR x the 3.2
feature factor x geo share, never the model's point. **Closes the loop**: `memory_create` the forecast,
its inputs and its date.

### Play 7: Tracking list construction and pruning

Tracking is a reporting decision: track what you will report on.

1. `seo_tracked_keywords_list` for the current list.
2. Target 20-100 keywords: 40 percent money terms tied to revenue, 30 percent striking distance (the
   harvest list), 20 percent cluster heads for work in flight, 10 percent sentinels (brand, plus one or
   two competitor-owned terms).
3. `seo_track_keyword({ keyword, target_domain })` per keyword. `goal_id` auto-derives from
   (account, domain) so they group; `location_code` defaults to 2840 (US); the first check is queued
   immediately. **Set `location_code` explicitly for any non-US client.** Tracking a Canadian, UK or
   Australian client at 2840 produces plausible, entirely wrong rankings, silently. Track 20-100
   keywords, not 1,000: track what you report on.
4. **The nine lanes.** One tracked keyword is up to nine rows: `google`, `bing`, `local`
   (`ranking_type: 'local'` with `business_name`, city-level location), `mobile`, and the AI engines
   `ai_overview`, `chatgpt`, `claude`, `gemini`, `perplexity` (`search_engine` on `seo_track_keyword`).
   Read them with `seo_rankings_list({ group_by_keyword: true })`: `pagination.total_groups` is the
   honest keyword count, `total` counts lanes. A keyword created before the AI engines existed has
   NO AI lanes: a blank AI column is "not tracked", never "not ranking". `previous_rank` advances only
   on a new check day; `check_frequency` defaults to weekly. Cost: about $0.003 per scheduled organic
   check, about $0.10 per keyword per engine per AI check (class G), so confirm the engine list and
   the count before adding AI lanes (references/aeo.md Play H).
5. Editing a tracked row (location, device, engine, target URL, frequency) is
   `seo_tracked_keyword_update`: it mirrors the edit onto the `website_rankings` lanes and returns
   `lanes_updated` - read it back. The one-call lane setter is `seo_rankings_platforms_set`
   (ask-gated): removing a lane deletes that lane's history, so treat it like a delete.
   `is_active: false` is the pause: it parks every lane at `check_frequency: 'paused'`, which the
   daily worker skips, so checks and billing stop with the config row and all history kept;
   `is_active: true` resumes them at the row's `tracking_frequency`. Prefer it to a delete, which
   destroys the row's `keyword_rank_history`; never use delete as an edit.
6. `seo_tracked_keyword_delete` removes the keyword row and its `keyword_rank_history`
   irreversibly (the rank lanes are paused, not deleted: their history survives and spending
   stops - seo-change-discipline.md 2.7), and that history is
   what makes next quarter's report possible. Prune only at a quarterly review, with explicit
   confirmation, one at a time, never a keyword that appeared in a delivered report in the last two
   quarters. If the list is merely too long, stop adding rather than deleting history.

### Play 8: Local and geo-modified expansion

For locations or service areas, "service + city" is the opportunity, not the head term. Include only
places the client will actually serve, and do not filter geo terms on volume: they report 10-50 or zero,
and a zero-reported "emergency plumber + suburb" converts at rates that make its cluster the most
valuable on the account. Run `seo_serp_get` on two or three representative geo terms; a SERP dominated
by a local pack means the win is a Google Business Profile play, not a page. For the pack itself,
`seo_research({ action: 'maps-serp', keyword, location_code, device })` returns the Google Maps SERP
at ONE city-level location code (class C, point-in-time, not a grid): who holds the pack and with
how many reviews decides whether a page or the listing is the play. Local plays: `local-seo.md`.

### Play 9: Quarterly re-qualification

Volume and difficulty do not move daily; weekly re-pulls waste metered budget. Once a quarter, re-run
the same metered expansion calls on the same seeds, location and language, and diff against the
universe you recorded in memory and the deliverable sheet on the first pass (that record is the stored
universe; nothing else holds it) for new keywords and any whose volume moved more than 40 percent;
re-read `seo_keyword_clusters({ project_id })` against the
committed clusters, adding new members via a confirmed `seo_keyword_cluster_create`; and read
`seo_list_rankings` for which clusters are moving, because a shipped pillar with no movement after six
months is a strategy failure, not a patience problem. Close with `memory_update`.

### Generative work

Anything strategic or written (cluster rationale, topic-map narrative, briefs, the roadmap) goes through
`talk_to_department({ domain: 'seo', message })`, then persists with the matching direct tool. Feed it
evidence, not the request: the cluster and members, the SERP teardown findings, the top-3 result
formats, the intent verdict, internal link targets, and the `account_context_get` constraints. A brief
without SERP evidence is a guess with good grammar. Pure CRUD uses the direct tools.

---

## 3. Thresholds and benchmarks

### 3.1 Gates

| Gate | Threshold | Action if failed |
|---|---|---|
| Keyword volume floor | < 10 MSV | Keep only if transactional, geo-modified, or in a cluster with >= 150 aggregate |
| Cluster viability | >= 5 keywords or >= 300 aggregate MSV | Merge into a neighbor or fold into an existing page |
| Pillar viability | >= 12 keywords, >= 800 aggregate MSV, >= 3 sub-intents | Build one page, not a pillar |
| Top-5 composition | >= 3 of top 5 are national brands, marketplaces or Wikipedia | Demote to siege or drop, whatever the KD |
| Difficulty vs authority | Bands in `metered-research-suite.md` | Over band: a funded link plan attaches, or it does not enter the roadmap |
| Tracked list size | 20-100 | Over 100: stop adding, review at quarter end |
| Ranking history for a forecast | >= 8 weeks | Below: CTR model only, say predictions are unavailable |
| Shipped pillar, no movement | 6 months | Escalate with a revised plan, do not quietly extend |

### 3.2 SERP feature CTR haircuts (multiply the position CTR)

Working factors for opportunity sizing, not measurements of this client's SERPs.

| SERP condition | Factor |
|---|---|
| Clean SERP, no features above organic | 1.0 |
| Featured snippet held by someone else | 0.6 to 0.75 |
| Featured snippet held by us | 1.3 to 1.8 on that keyword |
| AI Overview, informational query | 0.55 to 0.7 |
| AI Overview, commercial or transactional | 0.75 to 0.85 |
| Local pack above organic | 0.7 to 0.8 |
| Four top ads on a commercial query | 0.75 to 0.85 |
| Shopping carousel | 0.6 to 0.75 |

Stack multiplicatively; floor the product at 0.35.

### 3.3 Timing expectations for the plan

Striking-distance tune plus internal links, 2 to 6 weeks. Refresh of a ranking URL, 3 to 8 weeks.
Net-new page in an established cluster, 2 to 4 months. Net-new pillar in a new topic area, 4 to 8
months. KD 60-plus head with a link campaign, 2 to 4 quarters. Put these in writing at plan time.

---

## 4. Diagnosis: when data looks wrong

| Symptom | Cause, in check order | Action |
|---|---|---|
| `seo_research` or a metered expansion returns few or no keywords | `action` wrong for the input shape (each action needs its own input: `keyword` vs `keywords[]` vs `domain`, and unknown extra arguments are silently dropped, not rejected); `location_code`/language invalid or mismatched; seeds too narrow or branded; metered credit exhausted, which surfaces as an empty result, not an error | Test one broad seed, then one `seo_serp_get` on a keyword known to have volume. SERP works and research does not means the provider is at fault, not the account |
| Volumes uniform, round, or all zero | Provider fallback or a cached low-fidelity source | Spot-check two keywords against `seo_serp_get` result depth and ad density plus a `web_search` read. Not credible means unusable: say so and re-run, never forecast on it |
| `seo_keyword_clusters` / `seo_topic_clusters` empty | These read STORED cluster rows; none have been created for this project yet | Not a research failure. Build clusters from the Play 1 expansion output and persist the agreed ones via `seo_keyword_cluster_create` / `seo_topic_cluster_create` |
| `seo_list_rankings` empty or thin | Nothing tracked, or nothing synced yet | `seo_tracked_keywords_list` to confirm. Rankings populate on a sync cadence; a keyword tracked an hour ago having no data is correct |
| Rankings look wrong to the client | `location_code` mismatch (2840 on a non-US client); a personalized mobile SERP versus a clean desktop SERP at a set location; local pack read as organic; direction, where lower is better | Reproduce with `seo_serp_get({ keyword })` at the tracked location before conceding an error |
| `seo_ranking_predictions` empty or absurd | Insufficient ranking history | Check the tracking start date, fall back to Play 6 Method B, say predictions arrive after a full quarter |
| `seo_entity_check` says the brand is unrecognized | A finding, not an error | Often why a page ranks below its difficulty band. Route to the entity, schema and AEO work |

Two standing rules: when `hiveku-data/` disagrees with a live tool the live tool wins, and when an
argument shape is unclear use `hiveku_docs_search` then `hiveku_docs_get` rather than guessing, because
guessed arguments against a live account are how silent wrong-data failures start.

---

## 5. Edge cases and failure modes

- **Zero-volume keywords that print money.** Emergency, hyper-local and new-category terms report zero
  and convert at 10 percent. Never cut on volume alone; cut on serviceability and intent.
- **Brand terms inflate everything.** With brand queries in the universe, cluster volumes, average
  difficulty and the forecast all lie. Segment brand out before scoring, and never propose
  deprioritizing or repurposing a brand page or term: brand is protected, as is anything flagged
  protected in `account_context_get`.
- **Seasonal keywords.** Volume is a 12-month average, so a term doing 40,000 in December and 200 in
  July looks like a steady mid-volume opportunity. Apply a seasonal index or be wrong twice a year.
- **Machine clusters are a draft.** Two keywords 80 percent alike in string with different SERPs belong
  on different pages: the SERP overlap test beats the string test.
- **Never bulk-create or bulk-track from a machine list.** Every `seo_keyword_cluster_create`,
  `seo_topic_cluster_create`, `seo_track_keyword` and `seo_tracked_keyword_delete` writes to a live
  client account. Summarize, confirm, execute deliberately. Confirmation can cover a batch of related
  writes, but the user must see the list before it lands. `seo_tracked_keyword_delete` in particular is
  still destructive: the row's `keyword_rank_history` does not come back (the rank lanes pause
  with their history intact and spending stops), and the lane setter
  `seo_rankings_platforms_set` deletes a lane's history outright when a lane is removed.
- **Do not track competitor brand terms without approval.** It consumes the tracking allotment, shows up
  in reports, and some clients have contractual reasons against it.
- **Do not present `seo_ranking_predictions` output as a commitment.** It is a model, the client will
  remember the number, and you will own it. Band it, caveat it, or use the CTR model.
- **Do not build a roadmap without `account_context_get`.** Scoring business value without knowing what
  the client sells optimizes for traffic they cannot monetize, the top cause of a technically correct
  SEO program getting cancelled.
- **Do not let the tracked list become the strategy.** Tracking 400 keywords does not move rankings.

---

## 6. Persistence and client reporting

**Memory**, so the next session does not re-derive: `memory_create` after the first universe build
(seeds by category, location and language codes, universe and qualified sizes, run date, rejected terms
with reasons); after cluster commitment (head keyword, page type, adjusted score, ordering); and after
any forecast shown to a client (inputs, factors, band, date). `memory_update({ memory_id, content })` at
quarterly re-qualification, `memory_list({ domain: "seo" })` first to find the canonical record and to get
the body you must resend: `memory_update` REPLACES the document, it does not append.

**PM tasks**, so the work is visible: `pm_tasks_create` one per committed cluster and per harvest item,
titled with the target keyword and the deliverable, carrying target URL, current position and the window
from 3.3. `pm_tasks_update` when a target changes or blocks. `pm_tasks_complete` only when the change is
live, not when it is drafted or committed.

**Reporting**: the research artifact (priority matrix, cluster table, forecast) belongs in a deliverable
with a sheet tab so nobody re-pays for it next quarter; those tools live in `reporting-and-delivery.md`.
Lead with the decision and its reason, not the method: which clusters, in what order, why, expected
impact and by when. Every number must be reproducible from a named tool call, and nothing client-visible
goes out without explicit confirmation.

---

## 7. No tool for these (use the fallback, never invent one)

- **Keyword-level conversion or revenue data**: none. Get it from the analytics or PPC surfaces or the
  client; CVR figures stay benchmarks until then.
- **Competitor keyword gap and domain intersection**: `content-strategy.md` Play C4 (the
  intersection tools) and `link-building-and-competitors.md`.
- **SERP screenshots, visual layout, competitor on-page structure**: none. Use `web_scrape` plus
  `web_extract`, or the dashboard.
- **Bulk export of the universe**: none here. Use a deliverable sheet (`reporting-and-delivery.md`).
- **Editing a tracked keyword's location, device or engine**: `seo_tracked_keyword_update`
  (mirrors onto the lanes, returns `lanes_updated`) or the lane setter
  `seo_rankings_platforms_set` (Availability table). Pausing is
  `seo_tracked_keyword_update({ is_active: false })`. Delete plus re-track destroys the row's
  history (lanes pause and resume on re-track); never use delete as an edit.
- **Historical volume by month and seasonality**: `references/forecasting-and-seasonality.md`
  (`dataforseo_labs_google_historical_keyword_data`, the Trends family, GSC YoY).
