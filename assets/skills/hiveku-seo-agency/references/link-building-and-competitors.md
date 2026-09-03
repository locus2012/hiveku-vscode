# Link Building and Competitor Intelligence - Operator Manual

## What this covers / when to load this

The authority baseline, the opportunity queue, lost-link recovery, the
competitor set, the change-response loop, SERP-level link-gap work on one money keyword, the metered
vendor catalogue for links and competitor intelligence, and the outreach handoff to Outbound. **Load
this when** the ask is backlinks, referring domains, anchor text, link velocity, toxic links, link
reclamation, "why did they hold and we dropped", competitor teardowns, or the Authority section of
the monthly report. Not for brand mentions, sentiment and digital-PR angles
(`references/digital-pr-and-brand-mentions.md`), keyword gaps as content planning
(`content-strategy.md` Play C4) or internal linking (`technical-seo.md`). SKILL.md gives the arc;
this is the manual it points at, with the response shapes, traps, numbers and sequencing.

## Availability

Cost classes: A = free DB read; write = free, confirm-gated; B = Labs per request (COUNTRY codes
only); C = live SERP; D = backlinks per request (`backlinks_bulk_*` take up to 1,000 targets in one
call, the cheap way to qualify a list). A 402 on any of them is a negative DataForSEO balance.

| Tool | Status | Cost class | Note |
|---|---|---|---|
| `seo_backlinks_list` | LIVE | A | profile row from the dashboard's Domain Analysis run; the per-link rows have no writer (4.1) |
| `seo_backlink_opportunities` | LIVE | A | account-wide prospect queue; `project_id` ignored |
| `seo_new_lost_backlinks` | LIVE | A | the MANUAL link tracker (links you built or pursued), not DataForSEO new/lost; `since` ignored (4.2) |
| `seo_bing_backlinks` | LIVE | A | Bing's independent count, no anchors |
| `seo_competitors_list` (= `seo_list_competitors`), `seo_add_competitor` | LIVE | A / write | add is confirmed by name; a Domain Analysis run replaces the list |
| `seo_competitor_changes` | LIVE | A | written by a workflow node; empty forever without one |
| `seo_serp_get` | LIVE | A | stored SERP rows (no writer today); the live SERP is `seo_research({ action: 'serp' })` or `serp_organic_live_advanced`, class C |
| `backlinks_summary`, `backlinks_backlinks`, `backlinks_referring_domains`, `backlinks_anchors`, `backlinks_referring_networks`, `backlinks_domain_pages`, `backlinks_domain_pages_summary`, `backlinks_available_filters` | LIVE | D | profile and page-level reads for ANY domain (section 7) |
| `backlinks_timeseries_summary`, `backlinks_timeseries_new_lost_summary` | LIVE | D | velocity over `date_from`/`date_to`, grouped day/week/month/year |
| `backlinks_bulk_ranks`, `backlinks_bulk_spam_score`, `backlinks_bulk_referring_domains`, `backlinks_bulk_backlinks`, `backlinks_bulk_new_lost_backlinks`, `backlinks_bulk_new_lost_referring_domains`, `backlinks_bulk_pages_summary` | LIVE | D | prospect-list qualification in one call, up to 1,000 targets |
| `backlinks_domain_intersection`, `backlinks_page_intersection` | LIVE | D | the two gap tools |
| `dataforseo_labs_google_competitors_domain`, `dataforseo_labs_google_serp_competitors`, `dataforseo_labs_google_ranked_keywords`, `dataforseo_labs_google_domain_rank_overview`, `dataforseo_labs_google_domain_intersection`, `dataforseo_labs_google_subdomains` | LIVE | B | competitor discovery and sizing (section 7) |
| `domain_analytics_technologies_domain_technologies`, `domain_analytics_whois_overview` | LIVE | B | a rival's tech stack; domain age and registrar with backlink and traffic stats |
| `seo_research` | LIVE | B / C / D / E | actions `domain-backlinks`, `referring-domains`, `backlinks-anchors`, `backlinks-timeseries`, `backlinks-history`, `backlinks-competitors`, `bulk-page-summary`, `link-gap`, `competitors`, `ranked-keywords`, `gbp-locations`, `gbp-info`, plus `broken-links` (`url` required; one rendered fetch, class E; the broken-link-building prospector, see metered-research-suite.md for the row); returns without persisting |
| `web_scrape`, `web_map`, `web_crawl`, `web_extract`, `web_search` | LIVE | free | verification and contact discovery |
| `seo_backlink_tracker_list`, `seo_backlink_tracker_add`, `seo_backlink_tracker_get`, `seo_backlink_tracker_update`, `seo_backlink_tracker_delete` | LIVE | A / write | the manual tracker: `url`, `title`, `target_url`, `target_anchor`, `link_type`, `status`, `date_published`, `page_authority`, `domain_authority`, `notes`, `project_id` = the WEBSITE project id; delete is ask-gated; `seo_new_lost_backlinks` reads the same tracker |
| `seo_backlink_opportunity_create`, `seo_backlink_opportunity_get`, `seo_backlink_opportunity_update`, `seo_backlink_opportunity_delete` | LIVE | A / write | `target_domain`, `source_domain`, `source_type`, `domain_rating`, `contact_email`, `status`, `notes`; delete is ask-gated |
| `seo_competitor_get`, `seo_competitor_update`, `seo_competitor_delete` | LIVE | A / write | by `competitor_id`; delete is ask-gated, confirmed by name, one at a time; the agreed set still lives in memory |

---

## 0. Ground truth: where this data actually lives

Four stores sit behind these nine tools, populated by different pipelines, and three can be
legitimately empty on a healthy account. Confusing "not populated" with "no links" is the most
expensive mistake here: it becomes a false client-facing claim.

| Tool | Store | Scope | Populated by | Sort |
|---|---|---|---|---|
| `seo_backlinks_list` | backlink **profile** (one row per SEO project) + link rows | SEO project (required) | the dashboard's Domain Analysis run. The link rows have **no writer** in the API | links by domain_rating desc |
| `seo_backlink_opportunities` | prospect queue | **account-wide** | dashboard prospecting, imports | opportunity_score desc |
| `seo_new_lost_backlinks` | the **manual link tracker** (links built or pursued) | website project, optional | you, in the dashboard | created_at desc |
| `seo_bing_backlinks` | Bing Webmaster link counts | Bing connection site | Bing, live | Bing's order |
| `seo_competitors_list` / `seo_list_competitors` | competitor analysis rows | SEO project (required) | Domain Analysis, or `seo_add_competitor` | organic_traffic desc |
| `seo_competitor_changes` | competitor activity feed | **account-wide** | an SEO competitor-change workflow node | change_detected_at desc |
| `seo_serp_get` | live SERP (metered) | keyword | live, per call | SERP order |

Work from local files: `hiveku-data/seo/backlinks.json` (`seo_backlinks_list` per project, limit
200), `hiveku-data/seo/competitors.json` (`seo_list_competitors`), and
`hiveku-data/localseo/bing_backlinks.json` - Bing backlinks land under **localseo**, not seo, so do
not conclude the pull failed. Read `hiveku-data/STATUS.json` `failed[]` first: empty rows after an
`error` mean NOT RETRIEVED, never "no data". **No local snapshot exists** for
`seo_backlink_opportunities` or `seo_competitor_changes`; both are live and cheap. `seo_serp_get` is
the only metered call here.

---

## 1. Decision frameworks

### 1.1 The authority question, in order

Never open with "how do we get links". An earlier answer usually kills the work implied by a later
one.

1. **Is authority actually the constraint?** If we rank 4-15 for the cluster it is not: on-page and
   internal linking are, and striking-distance harvesting beats a link campaign on speed and cost.
   Authority binds only when we are absent from the top 50 and the top 5 are materially stronger
   domains.
2. **Are we losing what we already have?** Recovery is 5-10x cheaper than acquisition and is the
   only link work with a predictable close rate. Lane 1 before Lane 4.
3. **Where would a new link even land?** Links to commercial money pages arrive slowly and look
   forced. With no linkable asset, the first deliverable is the asset, not the outreach.
4. **Can we route authority internally instead?** One earned link into a hub feeding 12 spokes beats
   three on orphan pages. Internal routing lives in the technical reference.

### 1.2 Scoring one opportunity: R-A-P-D

`opportunity_score` is a **relative sort key within one pull**, not an absolute grade: a stored
decimal whose scale is not guaranteed across import batches. Normalize by rank inside the batch,
then re-score the top on four axes.

- **R - Relevance** (`topical_relevance`, `industry_match`, verified with `web_scrape`). Predicts
  movement best, so weight it hardest.
- **A - Authority** (`domain_rating`, `domain_traffic`). Directional only: a DR 45 niche publication
  beats a DR 78 aggregator for a specialist client.
- **P - Placement** (`source_type`). In-body editorial on an indexed, trafficked page, or a sitewide
  slot worth a fraction of it.
- **D - Durability.** Guest posts and listings churn; a link in a page that ranks and earns its own
  links compounds. Score paid or sponsored low.

Kill the prospect if R is low, however high A is. Two high-R links beat ten high-A ones.

### 1.3 The four lanes, in priority order

Later lanes get only the hours earlier ones do not consume.

1. **Reclamation.** Lost links, links pointed at our 404s or redirect chains, unlinked brand
   mentions. Highest close rate on the board, near 100 percent when the fix is our own redirect.
2. **Relationship.** Partners, vendors, associations, sponsorships, customers, press we already
   know (`account_context_get`, `get_account_info`). Clients typically have 10-30 unclaimed link
   relationships they never framed as SEO.
3. **Relevance gap.** Domains linking to two or more competitors but not us. Relevance is proven and
   the pitch writes itself: the warmest cold list that exists.
4. **Net new.** Digital PR, linkable assets, original data. Highest cost and ceiling, slowest, and
   never the first lane on a new engagement or the only lane on a mature one.

### 1.4 Competitor set doctrine, and sequencing

Keep three lists. **SERP competitors** (who occupies the SERPs for priority clusters, from
`seo_serp_get` plus the competitor analysis rows) drive tactics. **Business competitors** (who the
client believes they compete with - ask) overlap less than clients expect and drive what the client
believes about the report. **Link-profile competitors** (similar backlink profile, whatever they
sell) are the source of the warmest gap lists. Track **4 to 8**, never 20: each is a recurring cost
and a recurring paragraph, so drop any that has sat two quarters without changing a decision.
Confirm the set with the client and record it in memory - the most re-litigated decision in a
retainer. A row whose `last_analyzed` is older than 60 days is a historical artifact, not current
standing; a competitor gaining referring domains at more than 2x our rate for two straight months is
a strategy conversation, not an appendix bullet.

Quarter shape: month 1 baseline, set agreed, reclamation sweep, relationship list; month 2
relevance-gap list to outbound, assets scoped; month 3 net-new campaign, weekly reclamation habit,
teardown ships. Windows to put in the plan in writing: a recovered link restores rankings in 2-6
weeks, a net-new campaign moves them in 8-16, and link work never moves a SERP whose top results
beat us on relevance rather than authority.

---

## 2. The plays

Every play assumes `account_context_get({ domain: 'seo' })` has run and its instructions field has
been read: pitches written without brand voice get accounts flagged.

### Play A - Authority baseline (month 1, then monthly)

1. `seo_list_projects` for `project_id`; note the project's domain, which you compare against every
   `target_domain` you meet later.
2. `seo_backlinks_list({ project_id, limit: 100 })`. `data.profile` first: `referring_domains`,
   `total_backlinks`, `dofollow_backlinks`/`nofollow_backlinks`, `gov_backlinks`/`edu_backlinks`,
   `new_backlinks_30d`, `lost_backlinks_30d`, `toxic_score`, `avg_domain_rating`, `link_velocity`,
   `last_updated`. Then `data.backlinks[]`: `source_url`, `source_domain`, `target_url`,
   `anchor_text`, `domain_rating`, `page_rating`, `is_dofollow`, `link_type`, `first_seen`/
   `last_seen`, `is_active`, `traffic`.
3. `seo_bing_backlinks({ site_url, limit: 200 })` as an independent second opinion (referring URLs
   and counts, no anchors, from Bing's index): for magnitude sanity, when `last_updated` is stale,
   and when a client disputes the numbers. `site_url` falls back to the connection's value, so omit
   rather than guess. Differing magnitudes are normal: name one source primary, never average.

**Read out of it:** `referring_domains`, never `total_backlinks` (40,000 links from 60 domains is a
sitewide footer, not authority). Dofollow share below 0.3 on a small profile means comment and
syndication noise. `avg_domain_rating` with `referring_domains` says broad-and-weak vs
narrow-and-strong, deciding whether the next campaign chases volume or a few real placements.
`last_updated` decides whether any of it is reportable (4.1).

**Quarterly, on the same pull:** page while `pagination.total_pages > 1` and build the anchor
distribution from `anchor_text` (branded, naked URL, generic, partial match, exact-match commercial)
against `profile.toxic_score`; when the link rows are empty (4.1), `backlinks_anchors({ target })`
or `seo_research({ action: 'backlinks-anchors', target })` [SPENDS, class D] returns the
distribution directly. Rising exact-match share becomes a real problem when those anchors
concentrate in a few low-quality domains acquired in a narrow window: a bought-link burst that
usually predates the engagement.

**Closes the loop** (the tier this sets caps attackable difficulty for the whole roadmap):
`memory_create` an authority-baseline note (domain, referring domains, dofollow ratio, avg DR, toxic
score, date), since next month's delta is only credible if this month was recorded. Then
`pm_tasks_create` one task per lane.

### Play B - Weekly link delta and lost-link recovery

Ten minutes weekly, and the highest-yield recurring habit in link work.

1. `seo_new_lost_backlinks({})` - deliberately with **no** `project_id` on the first call (trap
   4.2). Manual-tracker rows, newest first: `url`, `title`, `target_url`, `target_anchor`,
   `link_type`, `status` (`published` | `unpublished`), `date_published`, `page_authority`,
   `domain_authority`, `notes`.
2. Compare `profile.lost_backlinks_30d` and `new_backlinks_30d` from `seo_backlinks_list` with last
   week's recorded values.
3. For each loss worth chasing, `web_scrape({ url: <source_url> })` and classify it:
 - Page live, our link removed: editorial or redesign. Recoverable by outreach.
 - Page 404: host removed it. Not recoverable; hunt a replacement page with
     `web_map({ url: <source_domain> })`.
 - Our target URL 404s or chains: **our fault**. Fix the redirect. Free recovery, today.
 - Page live and link present: crawler artifact. Do not chase, do not report as lost.
4. `seo_serp_get({ keyword: <cluster head the link supported> })` only if a top-10 position moved
   the same week. A lost link plus a stable ranking is a logging item, not an incident.

**Closes the loop:** `pm_tasks_create` per recoverable link, titled with source domain plus
classification, so the report can count recoveries. Ship our-fault redirect fixes through the site
tools in the technical reference, then `pm_tasks_complete`. Log a won link with `seo_backlink_tracker_add`
(Availability) and mirror it in a PM task. For velocity beyond the profile's 30-day counters,
`backlinks_timeseries_new_lost_summary({ target, date_from, date_to })` or
`seo_research({ action: 'backlinks-timeseries', target, date_from, date_to })` [SPENDS, class D]
chart new and lost referring domains by week or month: DataForSEO's new/lost, which
`seo_new_lost_backlinks` is NOT (it reads the manual tracker).

### Play C - Opportunity triage and the outbound handoff

1. `seo_backlink_opportunities({ limit: 100 })`. Account-wide, `opportunity_score` desc. Decision
   fields: `target_domain`, `source_domain`, `source_type`, `domain_rating`, `domain_traffic`,
   `spam_score`, `topical_relevance`, `contact_email`, `competitors_linked`,
   `competitor_anchor_texts`, `status`, `outreach_attempts`.
2. **Filter by `target_domain` yourself.** The tool takes `project_id`; the endpoint ignores it, so
   on a multi-site account you are seeing every site's prospects at once.
3. Drop rows where `status` is not `new` or `contacted`, where `outreach_attempts >= 3`, or where
   `spam_score` breaches section 3. Re-contacting a prospect that already said no burns the client's
   sending domain.
4. Score survivors on R-A-P-D. `competitors_linked` is the gold column: two or more tracked
   competitors linked makes it Lane 3, and `competitor_anchor_texts` shows what they were willing to
   link with, which shapes the ask.
5. Fill contact gaps: `web_map({ url: <source_domain> })` for about / contact / write-for-us paths,
   then `web_extract` for the editor name and address. Verify before loading; list quality is
   deliverability.
6. Angles: `talk_to_department({ domain: 'seo', message })` with the client's assets, the segment
   and the competitor link that proves relevance. One angle per segment, not per prospect.
7. Handoff: `talk_to_department({ domain: 'outbound', message })` with the segmented list, angles
   and target pages. Outbound owns loading, sequencing and sending. **Do not send from here.**

**Closes the loop:** `pm_tasks_create` for the campaign with segment counts and target link count;
`memory_create` the angle and segments, or, if the note already exists, `memory_update({ memory_id,
content })` with the existing link-strategy note plus your addition, since that call REPLACES it.

**Confirm before handoff:** segment counts, five sample prospects with why each qualifies, and the
angle copy. Get a yes. Outreach is client-facing sending: never silent, never bulk-applied.

### Play D - Building and maintaining the competitor set

1. `seo_competitors_list({ project_id })`, or `seo_list_competitors({ project_id, limit: 50 })` when
   you need paging (same endpoint; `seo_list_competitors` is the one carrying `page`/`limit`). Rows:
   `competitor_domain`, `domain_rating`, `organic_keywords`, `organic_traffic`, `shared_keywords`,
   `keyword_gap`, `backlinks_count`, `referring_domains`, `market_share`, `trend_direction`,
   `last_analyzed`.
2. Cross-check SERP reality on 3-5 cluster heads with `seo_serp_get({ keyword, location_code,
   language_code, device })`. If fewer than half the top 10 belong to tracked domains, the set is
   stale or wrong.
3. Add what is missing with `seo_add_competitor({ project_id, competitor_domain })`, confirmed
   **by name, one at a time**. A duplicate returns 409 "already tracked": a successful no-op, not an
   error to retry.
4. Publishing velocity has no tool: `web_scrape` or `web_crawl` the competitor's blog index and
   count posts per month over the last quarter. Link velocity does:
   `backlinks_timeseries_summary({ target })` [SPENDS, class D] by month for the rival and for us.
5. Teardown extras, each class B and confirmed before spending:
   `domain_analytics_technologies_domain_technologies({ target })` lists the rival's stack (CMS,
   analytics, tag manager, schema plugins, chat, review widgets), which explains a rich-result edge
   or a speed gap in one call; `domain_analytics_whois_overview` returns domain age and registrar
   with backlink and traffic stats, the normalizer for "they have 3,000 referring domains" (a
   15-year-old domain should); `dataforseo_labs_google_subdomains({ target })` lists a rival's
   subdomains with their ranking distribution, which finds the blog, the docs or the store that is
   doing the ranking when the root domain looks quiet.
6. Edit a tracked competitor's fields with `seo_competitor_update`; remove one with
   `seo_competitor_delete` (ask-gated, by name, one at a time); the agreed set in memory is the
   restore point.

**Read out of it:** `keyword_gap` and `shared_keywords` size the overlap; `trend_direction` and
`market_share` say who is moving (`account_context_get` and `get_account_info` often already name
the client's own rival list). A rival with lower traffic, rising trend and 3x our velocity is a
bigger threat than the incumbent leader.

**Traps:** a competitor added via `seo_add_competitor` comes back with **null** metrics because the
tool writes only the domain; null means "not analyzed yet", not zero. And a dashboard Domain
Analysis run **replaces the whole competitor list for the project** (delete then re-insert from the
vendor list), so manually added competitors silently disappear. Re-check after any run and keep the
agreed set in `memory_create` as the restore point.

### Play E - Competitor change-response loop (weekly)

1. `seo_competitor_changes({})`. Account-wide, newest first, roughly 30 rows: `our_domain`,
   `competitor_domain`, `competitor_url`, `keyword`, `change_type`, `change_detected_at`,
   `before_snapshot`/`after_snapshot`, `changes`, `ranking_before`/`ranking_after`, `urgency`,
   `requires_response`, `response_status`.
2. Filter client-side to this project's `our_domain`, then `requires_response === true` or `urgency`
   high/critical. The tool passes no filters, so never claim "no urgent changes" from an unfiltered
   read that simply paged past them.
3. Read `before_snapshot` vs `after_snapshot` and `changes[]`, then confirm on the live SERP with
   `seo_serp_get({ keyword })`; the feed can lag.
4. `web_scrape({ url: competitor_url })`: is the win depth, a new asset, or a SERP-feature capture?

Most changes deserve nothing. Respond when a competitor took a position we held or captured a SERP
feature on a money term. **Closes the loop:** `pm_tasks_create` per counter-move, keyword and
competitor URL in the body. There is **no tool to mark a change row responded**: `response_status`
stays `pending` forever from here, so track it in the PM task and never report it as live state.

### Play F - SERP-level link gap for one money keyword

For a keyword worth the surgery: high commercial intent, stuck outside the top 10, content at
parity.

1. `seo_serp_get({ keyword, location_code: 2840, language_code: 'en', device: 'desktop' })`; add
   `device: 'mobile'` for consumer-facing clients, the sets differ. Take the top 5 URLs and
   `web_scrape` each to confirm intent and build the outline benchmark.
2. Pull the opportunity queue (Play C) and filter `competitors_linked` to those five domains: those
   prospects link to a page outranking us on this exact query, the highest-relevance list these
   tools can produce.
3. Where the queue is thin, `web_search` the keyword plus link-intent modifiers (resource lists,
   roundups, association directories) and `web_crawl` candidates for a contact path.

**Threshold for the metered call:** the keyword is on the tracked priority list AND either a top-10
position moved this week or a campaign is being planned against it. Weekly per keyword at most.

---

## 3. Thresholds and benchmarks

Triggers for investigation, never promises to clients.

**Profile health.** Referring domains under 20: authority is a real constraint (cap the roadmap at
KD 0-20 long-tail); 20-100: mid-tier, KD up to about 40. Dofollow share under 30 percent:
noise-heavy, investigate before reporting growth. `avg_domain_rating` under 15 across hundreds of
referring domains: near-certain directory or scraper inflation, so caveat the count. `toxic_score`
over 30: quarterly hygiene item; over 50: raise with the human and investigate the acquisition
window and anchor concentration, never acting unilaterally.

**Velocity and delta.** `lost_backlinks_30d` above 10 percent of `referring_domains`: same-week
investigation, and the number most likely to precede an unexplained ranking drop. Any loss from a
domain with DR above 40, or a page with `traffic` above 0: individual ticket. `new_backlinks_30d`
above 3x the trailing average with no campaign running: check for a scraper network before
celebrating. Referring domains moving over 20 percent between monthly reads: a data event until
verified with `seo_bing_backlinks`.

**Anchor distribution** (healthy organic profile, directional): branded plus naked URL 50 percent or
more; generic 15-30; partial match 10-25; exact-match commercial under 5, never over 10. Past 10,
stop requesting exact-match anchors and shift new asks to branded.

**Opportunity queue.** `spam_score` over 30: drop; over 15 with low `topical_relevance`: drop.
`domain_traffic` 0 or null with DR above 30: inflated or parked, verify with `web_scrape`.
`outreach_attempts >= 3`: dead. Working list 20-40 live prospects per month for a single-site
retainer; 300 is a deliverability incident waiting to happen. Close rates for sanity-checking a
forecast: reclamation 30-60 percent, warm relationship 20-40, relevance gap 3-8, cold net-new 1-3.

---

## 4. Diagnosis: when the data looks wrong

**4.1 `seo_backlinks_list` returns a profile but `backlinks: []`.** Expected, not broken: the
per-link table has no writer in the API surface, and the profile summary comes from the dashboard's
Domain Analysis run. Empty means **not populated**, never "no backlinks", and is never reported as
zero links. Recover by reading `profile.dataforseo_raw_data` for the vendor summary, cross-checking
`seo_bing_backlinks`, and asking the user to run Domain Analysis in the dashboard for this project.
Say exactly that; do not invent a refresh tool.

**4.2 `seo_new_lost_backlinks` returns an empty array.** Three causes, likeliest first. (a) **Wrong
project id**: this tool's `project_id` scopes to the **website/builder** project, not the SEO
project from `seo_list_projects`. Pass an SEO project id and you get zero rows with a 200 OK, so
call it with no `project_id` first and filter yourself. (b) **`since` does nothing**: the tool
accepts it, the endpoint ignores it. Rows are newest-first, so filter on `created_at` or
`date_published` client-side, and never say "no links lost since X" from a `since` you passed.
(c) The tracker is genuinely empty because it is manual and unused: the common case on a new
account, and a process fix rather than a tool fix.

**4.3 `seo_backlink_opportunities` shows another site's prospects.** `project_id` is accepted by the
tool and ignored by the endpoint; the queue is account-scoped, so filter on `target_domain`. Same
for `seo_competitor_changes` (`our_domain`) and unscoped `seo_new_lost_backlinks`. On an agency
account this is also confidentiality: never surface another client's rows in this client's report.

**4.4 `seo_competitor_changes` is empty.** The feed is written by an SEO competitor-change workflow
node; with no such workflow on the account it is permanently empty, and calling harder will not
populate it. Confirm with `hiveku_docs_search` then `hiveku_docs_get` on competitor change
detection, tell the user monitoring is not running, and offer the fallback: weekly `seo_serp_get` on
5 cluster heads plus `web_scrape` of competitor blog indexes. Never present an empty feed as "no
competitor activity".

**4.5 `min_authority` on `seo_backlinks_list` does nothing.** The endpoint does not read it. Rows
are already sorted by `domain_rating` desc, so page 1 is your high-DR set; filter client-side. Same
class as 4.2 and 4.3: **an accepted argument is not a honored argument**. When a filter feeds a
client-facing number, verify it by inspecting the returned rows.

**4.6 Numbers do not move.** Check in order: `last_updated` (if the analysis has not re-run, the
number cannot move); whether links landed on indexed, trafficked pages; whether target URLs resolve
without a redirect chain; whether the timeframe is honest against 1.4. Three of the four are
plumbing, not strategy.

---

## 5. Edge cases and failure modes

- **Never buy links, propose a paid placement network, or run a PBN.** Explain the risk and
  redirect to digital PR and relationships, whatever a competitor appears to do.
- **Never send outreach from this skill.** Sending is Outbound's job and needs explicit human
  approval; a silently sent campaign is a deliverability risk and a trust breach.
- **Never build a disavow file from these tools.** Nothing here exposes disavow, the data cannot
  support the judgment, and a bad disavow is one of the few irreversible harms in SEO. If it looks
  warranted, escalate to the human with the evidence.
- **Never bulk-add competitors.** Each `seo_add_competitor` is confirmed by name; a bulk-added set
  is one nobody agreed to, and it inflates every future report.
- **Do not treat vendor DR as truth, and never report `total_backlinks` growth as authority
  growth.** One sitewide footer link adds thousands of backlinks and zero authority. Report
  referring domains, normalized for the rival's age and size: a 15-year-old incumbent always wins
  raw count, so the reportable comparison is velocity and relevance.
- **Do not let an empty response become a claim** (4.1, 4.2, 4.4). Reported as "no links" or "no
  competitor activity", it is a false statement that will eventually be discovered.
- **Respect approval thresholds and protected assets.** Anything touching the live site, redirect
  fixes included, goes through SKILL.md's confirmation and deploy discipline: commit is not live,
  and an unreviewed redirect fix can take a page down.
- **Multi-site accounts:** filter every account-scoped read by domain before counting (4.3).

---

## 6. Persistence and reporting

**Memory (decisions, not data).** `memory_list({ domain: "seo" })` first to avoid duplicates, then
`memory_create` only when nothing came back. To amend, send `memory_update({ memory_id, content })`
the whole document with your edit folded in: it REPLACES the entry, so a bare amendment erases every
prior decision. In memory: the agreed competitor set and why; the
authority baseline with its date; the link strategy (lanes, assets, anchors we will and will not
request); vetoed domains; the disavow stance. Never link tables or prospect lists - those live in
deliverable sheets and `hiveku-data/`.

**PM tasks (the work).** `pm_tasks_create` per accepted item: one per recoverable link, campaign,
counter-move and asset, with source domain, target URL and lane in the title so the report assembles
from task titles alone. `pm_tasks_update` the moment one stalls or changes owner, and
`pm_tasks_complete` only when the link is live and verified, not when the email went out. With no write tool on the
tracker, the PM task **is** the record of a won link.

**The Authority section of the monthly report** (assembled with the reporting tools in the
reporting-and-delivery reference): referring domains this month vs last, delta stated first; links
won, each named with source domain, target page and lane (links won, not emails sent); links lost
and recovered with the Play B classification; anchor distribution only when it moved materially;
competitor movement, including why we did not respond where we did not; next month's lane,
prospects, asset and timing window from 1.4. Every number must be reproducible from a named tool
call, and a figure from `web_scrape` or a dashboard view is labelled as such.

**Where each capability lives** (name the fallback, never invent a tool). Anchor distribution:
`backlinks_anchors` or `seo_research({ action: 'backlinks-anchors' })`. Link velocity, ours or a
rival's: `backlinks_timeseries_summary`, `backlinks_timeseries_new_lost_summary`, or
`seo_research` actions `backlinks-timeseries` and `backlinks-history`. Creating or editing an
opportunity row, writing to the link tracker, and editing or deleting a tracked competitor: the
`seo_backlink_opportunity_*`, `seo_backlink_tracker_*` and `seo_competitor_*` writes
(Availability table), mirrored into PM tasks and memory.
Marking a competitor change responded: none; the PM task is the record. Disavow: none, and a hard
stop (section 5). And `seo_project_get` is not the SEO-project read: it carries site-level SEO
settings and takes the builder project id, not the `seo_list_projects` id.

---

## 7. The metered vendor catalogue and the outreach program (the hub's link and competitor plays)

The plays above (A-F) run on the project-scoped `seo_*` surface; the catalogue below is the
per-call-billed DataForSEO family, same cost rules as `references/metered-research-suite.md`
(batch, persist, never re-pull unchanged data), and it answers for ANY domain, ours or a rival's.
Every call here is confirmed with the human first.

**Competitor intelligence (class B).** Run on a priority cluster before writing for it, and feed the
winners into keyword-research qualification:
- `dataforseo_labs_google_competitors_domain({ target })` - SERP-overlap competitors (month 1, then
  quarterly); cross-check against who the client THINKS competes, both lists matter; persist with
  `seo_add_competitor`, read back with `seo_list_competitors`.
- `dataforseo_labs_google_domain_intersection` - THE gap tool: keywords a rival ranks for that we
  do not, sized. `dataforseo_labs_google_serp_competitors` (who owns the SERPs for a keyword set),
  `dataforseo_labs_google_ranked_keywords` (everything a rival ranks for),
  `dataforseo_labs_google_domain_rank_overview` (traffic and rank distribution).
- Monitoring: `seo_competitor_changes({})` weekly (Play E); brief the client when a rival ships
  something material. Deliverable: quarterly teardown (`seo_deliverable_save`, type
  `competitor_analysis`): their clusters, publishing velocity, link velocity, stack (Play D step 5),
  and our counter-moves.

**Profile (class D; target = any domain):**
- `backlinks_summary` - topline backlinks, referring domains, rank. Monthly for us plus the set.
- `backlinks_backlinks` - individual links, filterable (`backlinks_available_filters` lists the
  filter fields per endpoint, read it once before building a filter); `backlinks_referring_domains`
  - domain-level rollup; `backlinks_referring_networks` - referring IP networks, the check for a
  link scheme behind a sudden spike.
- `backlinks_anchors` - anchor-text distribution; flag over-optimized exact-match anchors before
  they become a problem.
- `backlinks_timeseries_summary` and `backlinks_timeseries_new_lost_summary` - velocity and
  new/lost by day, week, month or year between `date_from` and `date_to`. These are DataForSEO's
  new/lost; `seo_new_lost_backlinks` is the MANUAL tracker of links you built, a different record.
- `backlinks_domain_pages` and `backlinks_domain_pages_summary` - a domain's pages ranked by the
  links they earn. Run on a rival: their most-linked pages ARE the linkable-asset brief (what earned
  links in this niche), and on us: which asset to point a campaign at.

**Bulk qualification (class D, up to 1,000 targets per call):** `backlinks_bulk_ranks`,
`backlinks_bulk_spam_score`, `backlinks_bulk_referring_domains`, `backlinks_bulk_backlinks`,
`backlinks_bulk_new_lost_backlinks`, `backlinks_bulk_new_lost_referring_domains`,
`backlinks_bulk_pages_summary`. One call qualifies a whole prospect list (rank, spam, referring
domains, recent growth) instead of one summary per domain; the R-A-P-D authority axis comes from
here. A spike in high-spam referrers is a hygiene item, not a panic item.

**Prospecting:**
- `seo_backlink_opportunities({ project_id })` - the stored prospect queue (Play C: the endpoint
  ignores `project_id`, filter by `target_domain` yourself).
- `backlinks_domain_intersection` - who links to multiple competitors but not us.
- `backlinks_page_intersection` - who links to the competitor PAGES ranking for our target keyword
  (link gap for a single SERP: the highest-relevance list there is).
- `seo_research({ action: 'broken-links', target })` [free read of a crawl you already paid for:
  `target` is the task_id from a `seo_audit_start` of THEIR site] - the dead external links on a
  resource or roundup page you want a link from: each row's `link_to` (`page_to_status_code >= 400`
  or `is_broken`) is the pitch ("your link to X is dead; our page covers it"), with `text` telling
  you what the page meant to link to. Results cap at `limit`; an empty list means none of the
  links the crawl RESOLVED were broken, not a verified page - unresolved targets carry a null
  status and are counted neither way. Log keepers as
  opportunity rows (`seo_backlink_opportunity_create`, `source_type: 'broken_link'`).
- Digital-PR angles, unlinked-mention reclamation and the sentiment watch:
  `references/digital-pr-and-brand-mentions.md`.

Rule: links to money pages arrive slowly and look unnatural when forced. Aim campaigns
at linkable assets, then route the authority internally (`seo_internal_links`).

Running the outreach (cross-discipline with Outbound - this is a paid agency service):
1. Build the target list from the prospecting tools above. For each domain record WHY
   it should link: which of our pages/assets, and the competitor link that proves the
   relevance (from `backlinks_page_intersection`).
2. Find the human: `web_search` / `web_scrape` the site for author, editor or contact pages; for
   local prospects `seo_research({ action: 'gbp-locations', query, location_name })` finds
   businesses and `seo_research({ action: 'gbp-info', domain })` (or `target` / `place_id`)
   returns one business's snapshot, both metered and confirmed first. Verify addresses before
   loading: list quality IS deliverability.
3. Hand the list to the outbound program (the `hiveku-outbound-agency` skill has a
   dedicated "Backlink outreach campaigns" section): contacts loaded via
   `crm_contacts_bulk_create` tagged link-outreach, a Smartlead campaign for the
   sends, pitch copy per segment via `talk_to_department({ domain: "outbound" })`.
4. Track wins here: replies flow through the outbound triage loop; verify placements
   with `backlinks_backlinks` / `seo_new_lost_backlinks`; log each won link
   (`crm_create_activity`) and report links-won + cost-per-link in the monthly report.

Visibility caveat on step 4: `crm_create_activity` is NOT visible to a `marketing-seo` key (that
profile carries only the seven CRM contact tools; `crm_contacts_bulk_create` in step 3 is one). On
a scoped key record the won link as a PM task, section 6's rule anyway. Outreach never sends from
this skill: drafting and handoff is this file's job, sending is Outbound's, and "just send the
pitches from here" is refused, including sending through a survey, a GBP review reply or
`social_create_post`.
