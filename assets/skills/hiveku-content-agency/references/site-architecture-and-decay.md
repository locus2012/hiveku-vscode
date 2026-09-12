# Site architecture and decay - page roles, clusters, the keyword map, bottom-funnel pages and the decision loop

Load this file before placing a piece on the site (its cluster, its role in it, its page role,
the money page and the pillar it must link), before choosing a keyword for a new piece (the
keyword map and its collisions), before planning or writing a comparison, alternatives or
"best X for Y" page (`/hiveku:bofu`), and before any refresh, consolidate or prune decision
(`/hiveku:refresh`: the decay columns, the refresh brief, the prune list, the disposition on the
row). Authors, the SERP brief, positioning, titles, offers and CTAs are in
`references/structure-and-conversion.md`, which also carries the field table for every column
named here and the table of the eleven elite check rules.

## Availability - the elite content program's round B hands (contracted 2026-09-12)

Builder routes live on `main`; MCP names declared by the parallel MCP lane and carried by
`test/pending-tools.mjs` as ELITE-B until `lib/tool-index.json` regenerates after that deploy.

| Tool | Status | Route (Olympus auth, account-scoped) |
|---|---|---|
| `site_page_roles_get` | LIVE (build 8) | `GET /api/olympus/marketing/site-architecture/page-roles?project_id=` |
| `site_page_roles_set` | LIVE (build 8) | `POST /api/olympus/marketing/site-architecture/page-roles` |
| `content_keyword_map` | LIVE (build 8) | `GET /api/olympus/marketing/content/keyword-map?project_id=` |
| `content_bofu_plan` | LIVE (build 9) | `POST /api/olympus/marketing/content/bofu-plan` |
| `content_bofu_plan_get` | LIVE (build 9) | `GET /api/olympus/marketing/content/bofu-plan?project_id=` |
| `content_prune_candidates` | LIVE (build 7) | `GET /api/olympus/marketing/content/prune-candidates` |
| `content_refresh_brief_get` | LIVE (build 7) | `GET /api/olympus/marketing/content/:contentId/refresh-brief` |
| `content_site_links` | LIVE, changed (`content_id`, roles, anchors) | `GET /api/olympus/marketing/content/site-links` |
| `seo_topic_clusters` | LIVE, changed (recomputed every Sunday) | `GET /api/olympus/seo/topic-clusters` |
| `seo_keyword_clusters` | LIVE, changed (mapped to published items) | `GET /api/olympus/seo/keyword-clusters` |

A key whose server does not serve a name yet answers unknown-tool: say so, run the tool-free form
of the step (money pages from the SEO memory's "Money pages:" line and `seo_topic_clusters` for
the pillars; `seo_cannibalization` and `content_list` for collisions; the rival pages read with
`web_scrape`; `seo_content_decay` and `content_analytics_get` for the refresh and prune reads)
and never present the gap as "Hiveku cannot do this". `content_site_links` answers the new
order and columns today; the `content_id` param reaches the route with the same MCP deploy (an
undeclared param is dropped at the proxy, so a response with `item: null` and no `pillar` on a
key that predates it is the old order, not a missing pillar).

## Page roles - `site_page_roles_get({ project_id })` / `site_page_roles_set({ pages } | { project_id, seed, apply? })`

One vocabulary on every page and post of a site: `money` (the pages that convert - pricing,
contact, quote, demo, book), `pillar` (cluster hubs), `support` (posts), `utility` (legal, auth,
thank-you, housekeeping). Roles are STORED, never inferred at read time: `content_site_links` and
the `money_link_missing` / `pillar_link_missing` rules read the stored role only, so an account
that has marked no money page gets a note ("no money page is marked; set page roles"), not a
guess.

- `site_page_roles_get({ project_id })` (the website project UUID from `sites_list`) returns `{
  data: { project { id, name, host }, pages [{ page_id, content_id, title, route, url,
  page_role, kind: website_page | content_item, cluster_role, topic_cluster_id, status }],
  suggestions [{ page_id, content_id, title, route, url, page_role, current_role, reason:
  conversion_goal | seo_memory | route_pattern | cluster_pillar_url | cluster_role_pillar,
  source }], counts { money, pillar, support, utility }, notes } }`. Suggestions exist only for
  rows whose role is unset: money from the account's URL conversion goals (a goal on a
  confirmation route such as `/thank-you` is skipped), from the SEO memory's money-page list
  ("Money pages: /pricing, /contact", or a "Money pages" heading with bullet paths - the line
  `/hiveku:seo-decay` writes, so keep writing it there) and from conversion route names;
  pillar from the clusters' `pillar_url` and items marked `cluster_role: "pillar"`; utility
  from housekeeping route names. 400 `project_id_required`, 404 `project_not_found`.
- `site_page_roles_set` takes one of two bodies: `{ pages: [{ page_id | content_id, page_role:
  money | pillar | support | utility | null }] }` sets roles in bulk (max 500, each entry its own
  write, null clears; a row outside the account is `not_found`, never updated; `results[]` says
  which entries failed with `invalid_target | invalid_role | not_found | write_failed`), or `{
  project_id, seed: true }` returns the suggestions and `{ project_id, seed: true, apply: true }`
  writes them onto rows whose role is still unset - a role a person set is never overwritten, by
  the route, not by your care. Idempotency-Key honoured. Seeding is explicit: run it on the
  owner's yes after showing the suggestions with their `reason`.
- A page that exists only in the crawl index (a site Hiveku does not host) cannot hold a role
  until it has a page row; the seed and the site-links read match crawl rows to roles by route,
  so a role set on the page row applies to the crawled URL too.

## Clusters on the row - `topic_cluster_id`, `cluster_role`, and the Sunday cluster sweep

A cluster is ONE pillar page plus its spokes, and the row says which it is: `topic_cluster_id`
(a `seo_topic_clusters` row in the account; the SEO skill's `/hiveku:seo-strategy` makes them)
and `cluster_role` (`pillar` | `spoke`), set at brief time on `content_create` and read back as
`topic_cluster { id, pillar_keyword }`. Nothing infers them: the writer sets them, the sidebar
and the department read them, and the draft header carries `Cluster: <cluster name> (pillar |
spoke); pillar: <url or "none yet">; page role: <page_role or unset>` (`Cluster: none` when the
row has no cluster).

Every Sunday (06:30 UTC, after the decay run) the cluster sweep recomputes each cluster from
PUBLISHED content: `coverage_score` (the share of the cluster's keywords a published item
targets, account-wide), `missing_subtopics[]` (the keywords nothing targets - the next briefs,
up to 100), `internal_link_score` (the share of spokes whose body links the pillar URL; null
with no pillar or no spokes) and `linking_issues[]` (`spoke_missing_pillar_link` per spoke,
naming it, or `no_pillar_url`), stamped on `seo_topic_clusters` - so a hand-set score survives
only until Sunday. The pillar URL is the cluster's `pillar_url`, else the URL of the item marked
`cluster_role: "pillar"` (the sweep fills `pillar_url` from it when null and never changes a
stored one). The same run flips `seo_keyword_clusters` rows to `content_status: "mapped"` with
the item URL whenever a published item targets their primary or a member keyword; a row a
person mapped to a URL no content item serves (a hosted service page, a page on another site)
is kept and named in the run's notes - the sweep only moves a mapping between URLs the content
system owns. Read the scores with `seo_topic_clusters` / `seo_topic_cluster_get`, or grouped
with the keyword map below.

## Link targets by role - `content_site_links({ project_id, content_id?, limit? })`

The link picker (`references/site-publishing.md` for the base contract) is now ordered for
architecture. Pass `content_id` (the item being written) and the rows come back money pages
first, then the item's own pillar (its cluster's `pillar_url`, else the cluster's item marked
pillar; a pillar URL nothing lists is synthesised with `id: "pillar:<url>"`), then the other
pillars, then the rest by recency; the requesting item is never listed as its own target. Every
row adds `role` (money | pillar | support | utility | null), `suggested_anchor` (the target's
keyword, else its focus keyword, else its title without a " | Brand" suffix, 80 chars) and
`is_pillar_for_item`; the response adds `roles { money, pillar }`, `item { id, topic_cluster_id,
cluster_role } | null`, `pillar { id, title, url, cluster { id, name } } | null` and a note when
no money page is marked, no pillar could be found, or `content_id` is unknown (400 only when it
is malformed).

- **Every draft links its pillar (when it is a spoke) and at least one money page**, using the
  `suggested_anchor` of the chosen rows - `[<suggested_anchor>](<url>)` - and the publish summary
  names the money page and the pillar it linked. The Play 3 gate reads them: `money_link_missing`
  is an ERROR on a consideration or decision piece (a warn at awareness or retention; skipped
  when no money page is marked), `pillar_link_missing` an ERROR on a spoke whose cluster has a
  pillar URL (a warn, naming the cluster, when it has none yet).
- A pillar item gets `pillar: null` and no `is_pillar_for_item` row, with a note saying it IS the
  pillar: it links down to its spokes and to the money pages; never wait for a "your pillar" row
  on a pillar.
- The older two-links rule still holds (two internal links by real URL); the money page and the
  pillar are the two that matter first.

## The keyword map - `content_keyword_map({ project_id? })`

Read it BEFORE choosing a keyword for a new piece, and before the calendar. One read:
keyword -> item -> live URL -> best rank position -> decay status, grouped by topic cluster with
the pillar row first, plus the collisions a site must not carry. `{ data: { generated_at,
project_id, groups [{ cluster { id, name, domain, pillar_keyword, pillar_url, coverage_score,
internal_link_score, missing_subtopics } | null, rows [{ keyword, normalized_keyword,
content_id, title, status, content_type, url, project_id, cluster_id, cluster_role, page_role,
search_intent, best_position, tracked_keywords, decay_status, refresh_priority,
review_disposition, published_at }] }], collisions [{ keyword, kind: duplicate_target |
cannibalization, items [{ content_id, title, url, status }], cannibalization { id, domain,
severity, status, recommended_primary_url, competing_pages } | null }], without_keyword [{
content_id, title, status, url }], totals { items, with_keyword, without_keyword, clusters,
collisions, ranked, decaying } } }`. Every cluster is a group, an empty cluster still lists its
`missing_subtopics` (those are the next briefs), and items with no cluster are the last group.
`best_position` is the lowest rank among the keywords publish-to-site enrolled for the item;
`decaying` counts rows whose `decay_status` is set and not `recovered`.

- **A keyword the map lists as a collision is refused** for a new piece unless the owner says
  consolidate: `duplicate_target` names the two items on one keyword (one of them is a refresh or
  a consolidation, never a third page); `cannibalization` carries the open finding and its
  `recommended_primary_url`. `without_keyword[]` is the list of pieces written for no query -
  count them on their own line in the coverage report, never guess a keyword for them.
- The brief picks its keyword from the cluster's `missing_subtopics` when nobody named one; the
  create then carries `topic_cluster_id`, `cluster_role: "spoke"` and the keyword together.
- After the write, `keyword_already_targeted` (a warn in the check, a `warnings[]` line on the
  create or update) is the safety net for a collision the map did not show (a legacy row whose
  keyword lives only in its settings, say); it never blocks, and it is never ignored.

## Bottom-funnel pages - `content_bofu_plan({ project_id, max_candidates?, seed_drafts?, min_volume?, max_difficulty?, rivals?, include_ideas? })` / `content_bofu_plan_get({ project_id })`

The pages people read when they are choosing now: "[brand] vs [rival]", "[rival] alternatives",
"best [category] for [segment]". Three content types carry them (`comparison`, `alternatives`,
and `research` for an original data study), each a real `content_type` value on every content
route; a comparison or alternatives page is `page_role: "money"`, `journey_stage` Decision,
`search_intent: "commercial"`.

**The plan.** `content_bofu_plan` reads the tracked competitor set (the SEO project whose domain
is the site's host; `rivals[]` adds or supplies hosts), the active customer avatars (the
segments) and the brand guide (the name; `positioning.category_name`, else the industry, as the
category), asks DataForSEO for the volume and difficulty of every phrase, and returns `{ data: {
plan { project_id, project_name, brand, category, rivals [{ host, name, shared_keywords,
organic_traffic, source }], segments [{ avatar_id, name }], candidates [{ type: vs |
alternatives | best_for, title, target_keyword, keyword_variants[], volume, keyword_difficulty,
rival, rival_name, segment, search_intent, avatar_id, template_slug, content_type, evidence {
rival_facts_sources[] (the rival's pricing page first), own_proof { testimonial, review, ticket,
call, survey, grid_result, objection } } }], dropped [{ type, title, target_keyword, reason:
volume_below_floor | difficulty_above_cap | keyword_collision | keyword_too_long, detail, volume
}], filters, spent { keyword_overview_requests, keyword_ideas_requests }, warnings[], notes[],
generated_at }, seeded, artifact_id, artifact_created, artifact_error }, result_info }`.
**It spends up to two DataForSEO research calls** against the monthly cap (one keyword overview
for every phrase, one keyword-ideas discovery unless `include_ideas: false`); a spent cap is a 402
with nothing written, and a cap hit or vendor error on the second call is a warning. Gates, in
order: a phrase over 255 chars, `volume_below_floor` (`min_volume`, default 10),
`difficulty_above_cap` (`max_difficulty`, default 70), `keyword_collision` - an item in the account
already targets the phrase or a variant, or an open cannibalisation finding names it; the drop
names the item, and that item is a refresh, never a twin. An empty competitor set, no category or
no avatars returns 201 with `candidates: []` and a note per gap, spending nothing. The plan is
stored as one `bofu_plan` artifact per project in the Content research knowledge base;
`content_bofu_plan_get({ project_id })` returns the newest (`{ data: { artifact_id,
knowledge_base_id, updated_at, plan, seeded } | null }`).

**Seeding.** `seed_drafts: true` (on the owner's yes, with `max_candidates` set to the approved
count) writes one DRAFT row per candidate from the three bottom-funnel templates (materialised
once per account as `marketing_content_templates` rows with `default_settings.template_slug`
`brand-vs-rival`, `rival-alternatives`, `best-category-for-segment`): `content_type`, `status:
"draft"`, tags `["bottom-funnel", <type>]`, `avatar_id`, `journey_stage` Decision,
`target_keyword`, `search_intent`, `page_type` (comparison, else listicle), `page_role: "money"`,
the project, and `settings { bofu { type, rival, rival_name, segment, sources[], own_proof,
keyword_variants[], volume, keyword_difficulty, template_slug, template_id, plan_generated_at },
comparison_table { columns: [brand, rival | placeholders], rows: six criteria with empty values },
decision_cta { decision: "", label: "", url: null, offer_id: null } }` plus a first version.
`seeded { created [{ content_id, slug, title, type, content_type, target_keyword, template_slug
}], skipped [{ title, target_keyword, reason: keyword_collision | write_failed |
invalid_candidate, detail }], template_ids }` - the gate re-runs against fresh rows at seed time.
Idempotency-Key honoured, so a retried POST does not seed twice.

**The comparison table contract** (`settings.comparison_table`): `{ columns: string[] (the brand
FIRST), rows: [{ criterion, values: string[] (one per column, in column order), source: <the
URL read>, checked_at: <ISO date> }] }`. Every row about a rival carries the `source` it was read
from and the `checked_at` date it was read on; a body table satisfies the same rules when every
data row carries a link (or a `[source: ...]` marker) and the table, its caption or the line
under it carries a date ("Prices checked 2026-09-01"). `settings.decision_cta { decision, label,
url, offer_id }` names the ONE decision the page ends on and where it goes (a brand offer by
`offer_id` - `references/structure-and-conversion.md` - or a URL). The check enforces both:
`comparison_table_missing` (error: no table anywhere) and `competitor_claim_unsourced` (error: a
rival row without `source` and `checked_at`, one finding per row, naming the criterion).

**Filling a seeded draft, in this order.** (1) Rival facts come from the tracked competitor
(`seo_competitor_get` for the profile, `seo_competitor_changes` for what moved) and from READING
the URLs in `settings.bofu.sources` with `web_scrape` - the pricing page first; every table cell
about the rival is copied from a page read this session, with that URL as `source` and today as
`checked_at`. Never write a rival price or feature from memory: a claim about a rival with no
source and date is refused by the check, and a wrong one is a legal letter. (2) Own proof comes
from `content_proof_pack({ avatar_id, journey_stage: "Decision" })`; `settings.bofu.own_proof`
says what exists before the call, and a segment with no consented proof is a page with a
weaker brand column, said out loud, not a padded one. (3) The body follows the seeded template's
headings; the honest-concession section (where the rival is the better choice) is required - it
is what makes the rest believable. (4) `settings.decision_cta` names one decision and the offer;
"learn more" is not a decision. (5) `content_seo_check` clean (the two table rules, `cta_missing`,
`money_link_missing` does not apply to a money page but the pillar link does) before the client
review. A candidate the plan `dropped` for `keyword_collision` names the item to refresh instead.

## The decision loop - `content_prune_candidates({ min_age_days?, limit?, project_id? })`, `content_refresh_brief_get({ content_id })`, and `review_disposition`

Every published piece is, once a year, one of five decisions: `double_down`, `refresh`,
`rewrite`, `consolidate`, `prune`. The decision is RECORDED on the row's `review_disposition`
through `content_update` (the one decay-side column a session writes; `content_list` filters on
it); the Sunday runs and the reads below only suggest.

**What the row carries** (read-only; `references/structure-and-conversion.md` for the 400):
`decay_status` (`detected` from the Sunday decay run, whatever a person moved the finding to,
`recovered` when the finding converged away, null when it never decayed; decaying = set and not
in resolved | refreshed | ignored | dismissed | recovered), `refresh_priority` (an integer rank,
higher sooner: 3xxx severe, 2xxx moderate, 1xxx mild, the remainder the clicks lost),
`top_declining_keywords[{ query, prior_clicks, current_clicks, prior_position, current_position,
clicks_lost }]`, and `refreshed_at` (stamped by the publish path when a live piece republishes on
the same URL, and by the Sunday run from the last publish after the detection). The link run
(Sunday 06:20 UTC, after the 05:35 SEO analysis sweep) resolves every decay finding to the
published item that serves its URL, stamps the item, and once per episode fires the
`content.decay_detected` workflow event (node type `contentDecayDetectedTrigger`, listed by
`workflow_event_trigger_types_list`; filters `project_id`, `content_types`, `severities`,
`min_refresh_priority`); when no workflow in the account handles it, the run files a PM task
"Refresh: <title>" carrying the refresh brief instead. `settings.decay_episode` is that claim -
never clear it. Two limits to carry: a Sunday whose URL resolver fails writes nothing for that
account (the stamps from the last good run stand and next Sunday retries), and a finding a
person closed on the SEO side (`resolved`, `ignored`) keeps its id, so a page that decays again
under a closed finding is not re-notified - the queue below still shows it, the task does not
come back on its own.

**The refresh queue.** `content_list({ limit: 200 })` and keep the rows whose `decay_status` is
decaying, ordered by `refresh_priority` descending (the list carries the columns; there is no
server-side sort on them yet, so the ordering is yours and the report says so). Before proposing
net-new topics, read this queue and the prune list: a decaying page on the keyword is a REFRESH,
never a new page; a zero-traffic page on the keyword is consolidate-or-prune first.

**The refresh brief.** `content_refresh_brief_get({ content_id })` assembles the brief from rows
that already exist and spends nothing: `{ data: { version: 1, generated_at, content_id, title,
url, content_type, page_role, target_keyword, search_intent, page_type, published_at,
last_published_at, refreshed_at, word_count, website_project_id, decay { decay_id, status,
severity, decay_type, traffic_decline_pct, peak_traffic, current_traffic, peak_keywords,
current_keywords, keywords_lost, peak_avg_position, current_avg_position, position_decline,
content_age_days, detected_at, last_analyzed_at, refreshed_at, recommended_actions[] } | null,
declining_keywords[] (worst click loss first), serp_brief { captured_at, brief } | null,
scorecard { source, as_of, window, views, visitors, form_submits, leads, contacts, lead_rate,
best_position, deals_won, won_value_cents } | null, keyword_siblings[{ content_id, title, url }],
cannibalization { keyword, primary_url, page_count, severity } | null, link_donors[{ content_id,
title, url, published_at, same_cluster }] (newer published pieces, same cluster first, at most
8), refresh_priority, decay_status, review_disposition, suggested_disposition, checklist[] },
markdown }` (404 outside the account). `suggested_disposition` follows the rule every channel
shares: zero traffic for twelve months -> prune, or consolidate when a keyword sibling exists;
a sibling or an open cannibalisation -> consolidate (the sibling holds the keyword); severe
decay with current traffic at a quarter of peak or less -> rewrite; any other decay -> refresh;
a top performer that is not decaying -> double down.

**The refresh play - the URL stays.** A refresh keeps the URL and its authority; a new URL starts
from zero. In order: `content_version_create({ content_id })` FIRST (the only undo); read the
brief; re-read the SERP brief it carries and build a fresh one with `content_brief_build` when
none is stored or the outline moved; cover every `declining_keywords[].query` on the page; close
the gaps against the top-3 outlines; add links FROM the `link_donors` (edit those pieces to
link this one) and up to the pillar; route the rewrite through `talk_to_department` like any
draft; re-run `content_seo_check`; publish the new version on the SAME URL through the Play 4
bridge (never a new slug); then record the decision with `content_update({ content_id,
review_disposition: "refresh" })` and cite `refreshed_at` (and the publish response's `refreshed:
true`) as the proof the refresh shipped. `rewrite` is the same play with the body replaced
rather than patched. `double_down` is a refresh plus distribution: a new title test, the social
set again, a link from every newer donor.

**The prune list.** `content_prune_candidates({ min_age_days? (30-1095, default 365), limit?
(1-200, default 50), project_id? })` lists published items at least a year old with zero views
and zero leads across the last twelve months: `{ data: { generated_at, window { from, to,
min_age_days }, candidates [{ content_id, title, url, content_type, page_role, published_at,
age_days, target_keyword, views_12m, leads_12m, measured_by: content_analytics | views_lookup,
suggested_disposition, consolidate_into { content_id, title, url } | null, review_disposition,
decay_status, default_action { tool: "content_unpublish_from_site", route, content_id, body {
unpublish: true } } }], unmeasured [{ content_id, title, reason: no_page | clickhouse_unavailable
}], counts { published_eligible, candidates, measured_by_analytics, measured_by_views_lookup,
unmeasured, excluded_money_pages, truncated }, warnings[] } }`. Measurement is honest about its
source: an item with no scorecard rows covering the window is measured through the live views
lookup and `warnings[]` says so; an item that CANNOT be measured (no page, the collector down)
is listed under `unmeasured`, never as a candidate - a zero the collector could not produce is
not a zero. Stored scorecard rows count as the twelve-month measurement only when they cover
the window (the earliest row within three days of the window start, or of the publish date
when the piece is younger than the window); otherwise the piece is measured through the views
lookup over the whole window and `warnings[]` says which rows were missing. Money pages are
excluded and counted. Read-only, nothing spent.

- **`consolidate`**: the stronger sibling (`consolidate_into`, or the map's
  `recommended_primary_url`) absorbs what is worth keeping (a Play 3 revision of THAT row), then
  the loser is redirected to it (`project_redirect_create`, a 301, confirmed) and taken down
  with `content_unpublish_from_site`. Never a take-down without the redirect.
- **`prune`**: the `default_action` is `content_unpublish_from_site` - it drafts the entry and
  deletes nothing, and NOTHING leaves the internet until the project deploys; say both. Per
  named id, each confirmed, never from a pattern; `content_delete` is not the prune tool.
- Record every decision - including `double_down` on the pieces that earn it - with
  `content_update({ content_id, review_disposition })`, and name the count per disposition in
  the monthly report. The decision is the deliverable; the row is where it lives.
