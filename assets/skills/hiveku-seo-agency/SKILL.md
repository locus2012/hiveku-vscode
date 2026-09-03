---
name: hiveku-seo-agency
description: "Full SEO agency methodology for operating a Hiveku account. Load when someone says \"we're not showing up on Google\", \"we dropped off page one\", \"why does [competitor] come up above us?\", \"our Google listing has the wrong hours\", \"someone left us a bad review on Google\", \"our old blog posts don't bring in leads anymore\", \"ChatGPT never mentions us\", \"we just signed a new SEO client\", \"build us an SEO strategy\", \"what keywords should we go after\", \"optimize this page\", \"write a brief for\", \"run a technical audit\", \"get us more backlinks\", \"who's mentioning us\", \"we're redesigning the site\", \"was it the Google update\", \"traffic fell off a cliff\", \"rank us for X\", \"did organic actually convert\", \"our Shopify store doesn't rank\", or \"rank our YouTube videos\" - and for ANY SEO work: keyword research, technical or content audits, rank tracking and ranking movements, content gaps, decay, cannibalization, on-page and schema fixes, backlinks and link building, competitor intelligence, local SEO and Google Business Profile (the map pack, listings, review replies), AEO / AI-answer visibility, and weekly checkups or monthly SEO reports and deliverables. ALSO load before risky SEO asks - deleting tracked keywords, projects, or GBP review replies, replying to all reviews at once, skipping the audit or baseline, \"disavow these links\", \"submit us to every directory\", \"crawl the whole site\", \"sync every keyword on every AI engine\", \"block the crawlers in robots.txt\", \"delete the tracking project and start over\", \"generate 50 city pages\" - the refusal rules live here."
---

# Hiveku SEO Agency Operating System

Operate the account like a retainer agency charging thousands per month: baseline once, set
strategy, run the plays weekly, ship a monthly report the client would pay for. The reads are
cheap; the metered calls spend real money; the writes change a live site or a public listing.
This file is the map and the rules; the reference manuals carry the mechanisms.

## What this skill owns

The entire `seo_` prefix (tracking and rank lanes, Search Console and Bing, audits, content and
on-page, GBP and local, citations, AEO, GA4 outcomes, deliverables, the implement rail) plus the
metered DataForSEO vendor families `backlinks_`, `dataforseo_labs_`, `serp_`,
`on_page_`, `keywords_data_`, `content_analysis_`, `domain_analytics_`, `business_data_`,
`ai_optimization_` and bare `crawl`. `seo_research` (60 actions) wraps most of them.

**Profile visibility** (from `profiles.ts`):

- `seo_` is granted on **full**, **marketing** and **marketing-seo** only (both marketing profiles
  also carry `agent_approval_` and `agent_inbox_` to finish the implement rail). The vendor
  families need `includeDataForSEO`: full, marketing, marketing-seo and marketing-ads. Bare `crawl`
  rides `includeCrawl4AI`, which every non-full profile has.
- **marketing-seo** = the shared marketing prefixes (`memory_`, `content_`, `pm_`, `workflow_`, `kb_`,
  `knowledge_`, `analytics_`, `room_`, `discussion_`, `marketing_`, `media_`, `survey_`) plus `seo_`,
  `pages_`, `social_`, the approval prefixes, and by exact name TASK_NAMES (`add_task_comment`,
  `complete_task`, `create_task`, `delete_task`, `get_task`, `list_tasks`, `update_task`),
  PROJECT_NAMES (`get_account_info`, `get_project`, `list_projects`), CMS_LEGACY_NAMES
  (`create_content`, `list_content`, `get_content`, `update_content`, `delete_content`) and the
  seven `crm_` contact names.
- TODAY neither marketing key sees `web_crawl`, `web_scrape`, `web_map`, `web_extract` (an orphan
  `web_` prefix), `sites_list`, `project_*` including redirects, `cms_*` or `deploy_site`. A named
  grant is coming; until then use `pages_update`, `seo_task_implement`, and the always-available
  `fetch_url` and `web_search`.
- A tool outside your key's profile is INVISIBLE and fails exactly like a missing feature. Say "not
  visible to this key", never "does not exist", and file the step with `pm_tasks_create` naming the
  exact tool.

**Discovery.** `hiveku_find_tools` and the directory focus key on the FIRST token of a tool name.
The alias landed: `department: 'seo'` or a focus of `seo` now reaches the vendor families too -
`seo,backlinks,dataforseo,serp,on,keywords,content,domain,business,ai` is the list it covers.

## The availability rule

The SEO surface is growing in batches. Each reference opens with an Availability table saying which
of its tools are LIVE and which are INCOMING, with the fallback.

**A name that does not resolve has not shipped on this server yet - it is NOT proof the capability
does not exist.** When a documented name fails, climb the ladder: (1) your key's profile, then the
direct tool; (2) a `seo_research` action that wraps the same vendor call; (3) a workflow template or
node; (4) the dashboard, handed off as one precise step and filed with `pm_tasks_create` naming the
exact tool. Never say Hiveku cannot do the thing, and never invent a name. **Naming discipline:** an
INCOMING name is spelled in exactly ONE reference's Availability table; this hub never spells one.

## Operating principles

**Foundation first.** Keyword strategy is what the BUYER types, and the buyer is defined by
the customer avatars; intent tiers map to journey stages. Before a strategy, a content brief
or a cluster: check the avatars and journey exist, are linked and are valid; create with
grounding when missing, flag and fix when invalid, and name which persona and stage each
target query serves. Check, criteria and ladder: `hiveku-orient/references/foundation-first.md`.

- **`account_context_get({ domain: 'seo' })` FIRST** - before any analysis, plan or copy: persona,
  brand voice, avatars, domain memory, skills, rules. Re-read it before generating.
- **Hiveku is the source of truth.** Durable findings go to the `seo` memory document; work items to
  `pm_tasks_create` / `pm_tasks_complete`; client-facing artifacts to `seo_deliverable_save`.
- **Memory is read-merge-write.** ONE document per domain and `memory_update` REPLACES it:
  `memory_list({ domain: 'seo' })`, append to the `content` it returns, then
  `memory_update({ memory_id, content })` with the whole merged body; sending only the new note
  destroys every prior entry. `memory_create({ type: 'memory', name: 'seo', content })` only on the
  first run (409 = one exists); `memory_list_versions` then `memory_restore_version` recovers a
  clobbered document. One catch on the read: `memory_list({ domain: 'seo' })` returns ACCOUNT-level
  rows only; a project-scoped document needs `project_id` or `include_project_scoped: true`. Skip
  that and the account looks empty, you `memory_create` a second document, and the SEO history
  splits across two rows.
- **You are not the only writer.** The Sunday sweep rewrites decay, cannibalization, E-E-A-T and
  predictions; the rank worker writes the lanes daily; the 6-hour sync refreshes GBP and connection
  snapshots. Read before you write and date every finding.
- **Confirm before writes, one artifact per yes.** Say exactly what will be created, updated,
  published, submitted or deployed and get a yes on THAT. Tracking a keyword is reversible;
  publishing, sitemap submits, GBP fields, GA4 key events and deploys are not.
- **Reads are free; metered calls spend money.** Name the cost class before any vendor call, batch
  inputs, persist results to sheets, never re-pull unchanged data.
- **Every number traces to a tool call.** A failed source makes its section partial or
  `insufficient_evidence` - never zero, never from priors. `hiveku-data/seo/*.json` is orientation.
- **Generative output** goes through `talk_to_department({ domain: 'seo', message })`, then persists
  with the direct tool. **Setup when nothing exists:** `seo_connections_list`, `seo_create_project`,
  `seo_connection_create` (BYOK; args in `references/outcomes-and-measurement.md`), then `seo_sync`.

## Hard stops - response contracts, not suggestions

- **"Reply to all the unanswered reviews in one go."** Refuse the batch. Each `seo_gbp_review_reply`
  posts PUBLICLY on the live listing, REPLACES any existing owner reply and is two-step confirmed
  per review; never loop the confirm, pre-collect one yes for N, or route replies through
  `social_create_post`. Offer: `seo_gbp_reviews` triage, one confirmed reply at a time (`/hiveku:reviews`).
- **"Clear the report workspace so we can start this month clean."** Never without the blast radius
  accepted: `seo_report_clear` wipes EVERY Report Preview section in the account's single workspace
  (`deliverable_slug` is a no-op; sheet tabs survive). Offer: `seo_report_add_section` /
  `seo_report_update_section`, or a new `seo_deliverable_save`.
- **"Just approve the staged deploy for me."** Refuse. `agent_approval_approve` EXECUTES a production
  deploy to the client's live site, and today the approver sees one line of prose. "Implement this"
  is not pre-approval; re-dispatching `seo_task_implement` around a rejection is the same violation.
  Offer: `seo_task_implement_status` (staged summary, preview URL) for the human to read first.
- **"Skip the audit / baseline, we already know what's wrong."** Refuse to skip. The baseline is the
  one capture of GSC's rolling 16 months and the before-state every future report reconciles
  against. Offer: compress it (R1's short form, `references/seo-playbooks.md`).
- **"Delete all keywords with zero volume" (any delete by pattern).** Never derive a deletion target
  by pattern - only ids the user named or a reviewed list they approved. `seo_tracked_keyword_delete`
  takes the row's rank history with it, no undo (its lanes pause - checks and billing stop, lane
  history kept; seo-change-discipline.md 2.7); `seo_deliverable_delete` is permanent;
  `seo_ga4_key_event_delete` silently flatlines any Ads conversion imported from it. Offer: archive
  (`seo_deliverable_update({ status: 'archived' })`) or a reviewed list, then one confirmed delete per id.
- **"Crawl the whole site."** Refuse: `max_crawl_pages` clamps at 500 and every crawled page is
  metered (class F). Offer: `web_map` for the URL count, a template-sampled crawl (`seo_audit_start`,
  50-500 pages), and `seo_research({ action: 'instant-page' })` per template.
- **"Disavow these links."** Refuse: no disavow tool exists, disavow is the site owner's own act in
  Search Console, and a wrong file silently removes real links. Offer: a toxic-link review
  (`backlinks_bulk_spam_score` over `backlinks_backlinks`) and a documented list the owner uploads
  themselves.
- **"Submit us to every directory."** Refuse: no submission tool exists;
  `seo_citations_audit` audits only (one Business Listings search, 24-hour cooldown). Offer: the NAP
  fix list from `seo_citations_get` and one claim-your-listing `pm_tasks_create` per missing directory.
- **"Sync every keyword on every AI engine."** Refuse the loop. `seo_aeo_rankings_sync` costs about
  $0.10 per keyword per engine with no confirm gate and no balance pre-check; 200 keywords on five
  engines is about $100 per run, and a scheduled lane keeps paying. Offer: the 10-25 priority set on
  `ai_overview` first, then one engine at a time with the number stated.
- **"Block the AI crawlers / noindex staging in robots.txt."** Refuse to do it through
  `seo_project_update` `robots_txt_content`: it is a deploy-time fallback, served only from the next
  `deploy_site` and only on a project whose code ships no robots source, so the stored write alone
  changes nothing live. Never report a robots.txt as live until `fetch_url` shows it; a wrong
  Disallow deindexes the site. Offer: `public/robots.txt` via the code lane with a reviewed diff (`project_files_bulk_save`, `project_vcs_commit`, `deploy_site`).
- **"Delete the tracking project and start fresh."** Refuse. No tool deletes a tracking project
  today, and the one coming is ask-gated because it destroys the rank history every future report
  reconciles against. Offer: keep the project, prune to what you report on
  (`seo_tracked_keyword_delete`, reviewed list, one per id), add the new set with `seo_track_keyword`.
- **"Generate 50 location pages from the template."** Refuse: the doorway-page family ranks nowhere
  and risks a manual action. Offer: the substitution test (swap the city name; if nothing else would
  change, it is a doorway) and a per-location content spec from `references/local-seo.md`, one page
  at a time.

## Cheat sheets

**The nine rank lanes.** One tracked keyword = up to nine `website_rankings` rows.

| Lane | How it is tracked | Cost |
|---|---|---|
| google, bing, mobile | organic and device lanes from `seo_track_keyword` (check its schema for the device argument), checked daily | about $0.003 per scheduled check |
| local | `ranking_type: 'local'` with `business_name`; reads back as `local_pack_position` | organic rate |
| ai_overview, chatgpt, claude, gemini, perplexity | `seo_aeo_rankings_sync`, or `seo_track_keyword` with the engine as `search_engine`; citations, not positions | about $0.10 per keyword per engine |

`seo_rankings_list({ group_by_keyword: true })` pages by keyword; `pagination.total_groups` is the
keyword count (`total` counts lanes). Keywords created before the AI engines have NO AI lanes:
a blank AI column means "not tracked", never "not ranking". `previous_rank` only advances on a new
check day. `check_frequency` defaults to weekly.

**Two location vocabularies.**

| Family | Accepts | Note |
|---|---|---|
| SERP: `serp_locations`, `serp_organic_live_advanced`, `seo_serp_get`, `seo_research` serp / maps-serp | city or region codes | pick the code from `serp_locations` |
| Labs: every `dataforseo_labs_*` tool | COUNTRY codes only (2840 = US) | the server retries with US and returns `location_note` |

**GSC truths.**

| Truth | Consequence |
|---|---|
| Rows are dated in Pacific time; final after about 3 days | a GSC day is not the client's day; never compare the last three days |
| Rolling ~16-month retention | the baseline rolls off; capture it in month 1 |
| Five stored dimension signatures (date-only, query, page, device, country) | never sum across them, nor across GSC, Bing, the tracker, vendor estimates and GA4 |
| `date,query,page` lives only in the permanent archive | read it with `seo_query_page_metrics` (`references/rankings-and-search-console.md`); `seo_gsc_search_analytics` covers only Google's 16 months |
| `seo_local_*` tools halve the window you pass | pass 180 for a 90-vs-90 |

**Id spaces.**

| Id | Comes from | Feeds |
|---|---|---|
| SEO tracking project id | `seo_list_projects` (= `seo_project_list_active`) | `seo_list_keywords`, `seo_run_audit`, `seo_add_competitor`, `seo_content_gaps`, most `seo_*` reads |
| Builder website project id | `sites_list` (`project_get` for one; `list_projects` returns PM projects) | `seo_project_get`, `seo_project_update`, `pages_*`, `project_*`, `deploy_site`, `seo_generate_sitemap` |
| PM project id | `pm_projects_list` | `pm_tasks_create` |
| `connection_id` | `seo_connections_list` | GSC, Bing, GBP, GA4 and citations tools |
| `ranking_id` / `audit_id` | a `seo_rankings_list` row / `seo_run_audit` | history reads / `seo_audit_get` |
| crawl `task_id` | `seo_audit_start` | `seo_research` crawl actions as `target` |

**Cost classes.**

| Class | What | Examples |
|---|---|---|
| A free | DB and platform-key reads | project-scoped `seo_*` reads, `seo_local_*`, cached GBP reads, `seo_citations_get`, `seo_core_web_vitals`, `seo_entity_check`, `seo_aeo_readiness`, `seo_cro_audit` |
| B per request | Labs and keywords_data (batch up to 1,000 keywords) | `dataforseo_labs_bulk_keyword_difficulty`, `keywords_data_google_ads_search_volume` |
| C per request per location | live SERP | `serp_organic_live_advanced`, `seo_research` serp |
| D per request | backlinks (`backlinks_bulk_*` for lists) | `backlinks_summary`, `backlinks_backlinks` |
| E per URL | on-page instant | `on_page_instant_pages`, `on_page_content_parsing` |
| F per page | crawl (`max_crawl_pages` default 50, clamp 500) | `seo_audit_start` |
| G about $0.10 per keyword x engine | LLM mentions | `seo_aeo_rankings_sync`, the AI lanes |
| H LLM-scored, budget-gated | sweeps | `seo_eeat_scores`, `seo_aeo_brand_audit` daily budget |
| I one search, 24h cooldown | listings footprint | `seo_citations_audit` |

The DataForSEO balance can go NEGATIVE: every metered call then returns 402 with no per-tool
warning; 503 `dataforseo_unconfigured` means no credentials. Neither means "clean" or "no data".

## Dispatch table - play, first tools, then load the reference

| The ask | First tools | Reference and command |
|---|---|---|
| "We just signed a new SEO client" / month-1 baseline | `account_context_get`, `seo_connections_list`, `seo_list_projects`, `seo_sync` | `references/seo-playbooks.md` R1; `/hiveku:seo-onboard` |
| "Build us an SEO strategy" / roadmap, seasonality, forecast | `seo_keyword_clusters`, `seo_topic_clusters`, `seo_ranking_predictions`, `keywords_data_google_trends_explore`, `dataforseo_labs_google_historical_keyword_data` | `references/content-strategy.md`, `references/forecasting-and-seasonality.md`; `/hiveku:seo-strategy` |
| "What keywords should we go after" / "rank us for X" | `dataforseo_labs_google_keyword_ideas`, `dataforseo_labs_bulk_keyword_difficulty`, `dataforseo_labs_search_intent` | `references/keyword-research.md`; `/hiveku:seo-keywords` |
| "How are our rankings this week" / "we dropped off page one" | `seo_rankings_list({ group_by_keyword: true })`, `seo_gsc_period_comparison`; on a loss `seo_research({ action: 'serp' })` | `references/rankings-and-search-console.md`; `/hiveku:weekly` |
| "Was it the Google update" / "traffic fell off a cliff" | `seo_gsc_time_series`, `seo_bing_period_comparison` (control), `dataforseo_labs_google_historical_serp` | `references/seo-playbooks.md` R8, R9 |
| "Optimize this page" / "add schema" | `seo_gsc_search_analytics`, `on_page_content_parsing`, `seo_schema_markup`, `seo_entity_check` | `references/on-page-optimization.md`; `/hiveku:seo-onpage`, then `/hiveku:seo-fix` |
| "Write a brief for" | `seo_research({ action: 'serp' })`, `seo_featured_snippets`, `talk_to_department({ domain: 'seo' })` | `references/content-strategy.md`; `/hiveku:seo-brief` |
| "Our old posts don't get traffic anymore" / cannibalization | `seo_content_decay`, `seo_cannibalization` | `references/content-strategy.md`; `/hiveku:seo-decay` |
| "Run a technical audit" / "the site is slow" | `seo_audit_start`, then `seo_research` crawl actions with `target` = the task_id; `seo_core_web_vitals({ url, include: 'field' })` (pass `origin` when `field.available` is false), `seo_research({ action: 'lighthouse' })` | `references/technical-seo.md`; `/hiveku:seo-technical` |
| "Get us more backlinks" | `backlinks_summary`, `backlinks_domain_intersection`, `seo_backlink_opportunities` | `references/link-building-and-competitors.md`; `/hiveku:seo-links` |
| "Who's mentioning us" / unlinked mentions, sentiment | `content_analysis_summary`, `content_analysis_search`, `backlinks_backlinks` | `references/digital-pr-and-brand-mentions.md` |
| "Why does [competitor] come up above us?" | `dataforseo_labs_google_competitors_domain`, `dataforseo_labs_google_domain_intersection`, `seo_competitor_changes` | `references/link-building-and-competitors.md`; `/hiveku:seo-competitors` |
| "Our Google listing has the wrong hours" / photos, services, citations, new location | `seo_gbp_listing`, `seo_gbp_location` (once), `seo_gbp_location_update` (two-step); `seo_citations_get`, then `seo_citations_audit`; `seo_gbp_discover_locations`, `seo_track_keyword({ ranking_type: 'local', business_name })` | `references/local-seo.md`, `references/seo-playbooks.md` R7; `/hiveku:local`, `/hiveku:seo-citations` |
| "Someone left us a bad review on Google" | `seo_gbp_reviews`, `seo_gbp_review_reply` | `references/local-seo.md`; `/hiveku:reviews` |
| "ChatGPT never mentions us" | `seo_aeo_readiness`, `seo_aeo_audit_get`, then `seo_aeo_audit_run` | `references/aeo.md`; `/hiveku:aeo` |
| "We're redesigning the site" / migration | `web_map`, `project_redirects_list`, `project_redirect_create`, `project_redirects_deploy` | `references/seo-playbooks.md` R6; `/hiveku:seo-migration` |
| "Did organic actually convert" | `seo_ga4_conversion_audit`, `seo_ga4_report({ preset: 'landing_pages' })` | `references/outcomes-and-measurement.md` |
| Monthly report | `seo_deliverable_save`, `seo_report_add_section`, then the `marketing_report_*` rail | `references/reporting-and-delivery.md`; `/hiveku:report` |
| "Apply the fix and push it live" | `pages_update`, or the code lane, or `seo_task_implement` then `agent_approval_approve` | `references/seo-change-discipline.md` FIRST; `/hiveku:seo-fix` |
| "Our Shopify store doesn't rank" | `shopify_connection_status`, `seo_ga4_report({ preset: 'ecommerce_revenue' })`, `seo_research({ action: 'google-shopping-products' })` | `references/ecommerce-seo.md`; R12 |
| "Rank our YouTube videos" | `serp_youtube_organic_live_advanced`, `serp_youtube_video_info_live_advanced` | `references/on-page-optimization.md` (video) |
| "Install the recurring one" | `workflow_templates_list`, `workflow_create_from_template` | SEO in workflows below; `hiveku-automation-agency/references/templates.md` |

## SEO in workflows

Several plays ship as installable templates (rank-drop response, content-decay refresh, lost-backlink
alert, GBP review SLA, CWV watch and more): `workflow_templates_list`, then
`workflow_create_from_template({ slug, overrides })`. Read the
template's `variables[]` FIRST - a missing required variable is a 400. It defaults `is_enabled: true`,
so pass `is_enabled: false` and enable after review, or confirm the default. Node families: schedule
triggers, SEO read nodes (rankings, GSC, audit, backlinks), notification and PM-task nodes, and the
GBP and PPC action nodes that STAGE to the approval inbox rather than auto-applying.
Field shapes, payloads and traps: `hiveku-automation-agency/references/node-rail.md`.

## Boundaries

- **hiveku-analytics-agency** owns the traffic ledger, the `marketing_report_*` rail and the CRO
  backlog ("how is the site doing" routes there first; this skill owns why organic moved).
  **hiveku-conversion-tracking** owns the GTM tag program and the attribution verdict; the GA4
  outcome reads (`seo_ga4_conversion_audit`, `seo_ga4_report`) stay here, tag surgery does not.
- **hiveku-web-agency** owns the code lane, redirects, domains, deploy tiers and staging headers. This
  skill says what to change and verifies the live URL.
- **hiveku-content-agency** owns publishing and `content_*` (briefs drafted here, persisted there);
  **hiveku-outbound-agency** sends the link outreach (drafts here, nothing sends);
  **hiveku-commerce-agency** owns the Shopify catalog (not Hiveku-hosted: findings become tasks).
- **hiveku-social-agency** publishes GBP posts: `social_create_post` with platform
  `google_business_profile`. There is no GBP post tool in this lane.
- **Reputation:** Google review REQUESTS have no MCP tool; a review ask goes out on the client's
  comms rail, with consent - never claim to have sent one from here.
- `/hiveku:research` is the generic web ladder for non-tool questions.

## Pitfalls

- Aliases: `seo_rankings_list` = `seo_list_rankings`, `seo_keywords_list` = `seo_list_keywords`,
  `seo_list_projects` = `seo_project_list_active`, `seo_audit_list` = `seo_list_audits`,
  `seo_competitors_list` = `seo_list_competitors`. One capability each.
- `audit_type` is ignored - ONE crawl type. The persisted audit lane is live (since 2026-08-30):
  `seo_run_audit` / `seo_audit_start` return 202 `{ audit_id, task_id, status: 'queued' }` and
  `seo_audit_get` polls and persists. An empty audit list means no crawl has run, never a clean site.
- `seo_audit_start` IS the crawl for `seo_research` (live-tested 2026-08-30): its task_id is the
  `target` for `redirect-chains`, `duplicate-content`, `duplicate-tags`, `non-indexable`,
  `internal-links` and `keyword-density`; `instant-page` and `lighthouse` take `url`.
  `duplicate-content` also REQUIRES `url` (the page to compare); without it the response is an empty
  results array that reads like "no duplicates". A finished crawl reports `crawl_progress` 'finished'
  with `crawl_status { pages_crawled }`; an empty items list is "none found" only when it is finished.
- `seo_internal_links`: Hiveku-hosted published projects only, static weekly scan;
  `suggested_links_to` / `suggested_links_from` are NOT computed.
- `seo_eeat_scores`: top 10 GSC pages, monthly; `competitor_scores` not computed; check the signals
  method (`llm` vs `heuristic_only`) first.
- `seo_ranking_predictions({ domain, risk_level, limit })` is linear extrapolation, not ML;
  `backlinks_needed` is not computed.
- `seo_citations_audit`: one search per run; a 429 inside 24 hours returns the stored audit;
  `basis: 'no_signal'` means UNVERIFIED, never "missing".
- The GBP Q&A write API is dead (Google, 2025-11); GBP posts go through `social_create_post`.
- No disavow, directory submission, hreflang builder, log-file analyzer or geo-grid: describe the
  gap and escalate; never invent a name.
- Declared filters match what each route reads as of 2026-08-30; still read the response, not the
  request - an empty list can mean the backing table simply has no writer.
- `seo_gsc_inspect_url` is the indexed snapshot (no live test): verify a fix only after a recrawl;
  "Discovered / Crawled - currently not indexed" at scale is a quality or linking problem.
- Commit is not live: `project_vcs_commit` saves a version, `deploy_site` ships it, `fetch_url` proves
  it. `seo_generate_sitemap` returns content, not a submission: commit, deploy, then
  `seo_gsc_submit_sitemap` and `seo_bing_submit_sitemap`; verify with `seo_gsc_list_sitemaps`.
- `seo_connection_update` accepts `ga_property_id`; list a connection's candidate GA4 properties
  with `seo_analytics_discover_properties` (`references/outcomes-and-measurement.md`).
- Live GBP reads (`seo_gbp_attributes`, `seo_gbp_services`, `seo_gbp_media`, `seo_gbp_location`) are
  auto-approved but quota-limited: once per location, never looped; `gbp_quota_exceeded` = wait,
  `gbp_quota_not_approved` = the Cloud project never passed review.
- `seo_serp_get` is a DB read of stored SERP rows (no writer today); a LIVE SERP is
  `seo_research({ action: 'serp' })` or `serp_organic_live_advanced`.
- `seo_new_lost_backlinks` reads the MANUAL link tracker; DataForSEO new/lost is
  `backlinks_bulk_new_lost_backlinks`, `backlinks_timeseries_new_lost_summary` or
  `seo_research({ action: 'backlinks-timeseries' })`.
- `seo_content_gaps` reads STORED gap rows and is empty until its compute writer has run for the
  project (INCOMING; named with its spend in the Availability table and Play C4 of
  `references/content-strategy.md`): empty means "not computed", never "no gaps". Compute, then
  read it back - or build the gap by hand with `dataforseo_labs_google_domain_intersection`,
  `dataforseo_labs_google_page_intersection` or `seo_research({ action: 'keyword-gap' })`.
- `seo_ga4_report` 429 is the hourly quota - do not retry; it is the ONLY GA4 numbers tool.
- Position deltas are signed Google-style (negative = improved); never flip signs in a report.

## Reference map - load the one that matches the work

| Reference | Load it when |
|---|---|
| `references/metered-research-suite.md` | Before any vendor call: cost classes A-I; 402/503; SERP-vs-Labs locations; vendor and `seo_research` catalogues; CTR and KD tables; batching. |
| `references/keyword-research.md` | Seed to universe to clustered to tracked; intent and difficulty; the priority matrix; lanes and edits; top searches; historical volume. |
| `references/forecasting-and-seasonality.md` | `seo_ranking_predictions` and its real args; the Trends family; historical keyword data; YoY; the forecast band; seasonal index; roadmap impact. |
| `references/rankings-and-search-console.md` | GSC and Bing like an analyst: the nine lanes; real move vs noise; measurement artifacts; algorithm updates; index coverage; archive reader and issues feed (Availability). |
| `references/content-strategy.md` | What to write, refresh, merge or retire; decay and cannibalization dispositions; gaps via intersection tools; briefs with SERP evidence; E-E-A-T. |
| `references/on-page-optimization.md` | The four write paths; the per-page protocol; title, H1 and meta formulas; entities; JSON-LD eligibility; image SEO; hreflang by hand; video; per-page SEO and schema writes (Availability). |
| `references/technical-seo.md` | Crawl and index health; Core Web Vitals field vs lab; rendering; architecture; sitemaps; tech-stack recon; severity-by-effort triage. |
| `references/technical-seo-blind-spots.md` | Before any audit you report on: checks that pass per page and fail across the set; crawl deep-dive actions; what Hiveku has no tool for; sample coverage. |
| `references/seo-change-discipline.md` | BEFORE your first SEO write of the session: the mutation gate; the read spine; diff discipline per object class; code guardrails vs prose warnings; verify-after-write; pre-flight card. |
| `references/link-building-and-competitors.md` | Authority baselines; the opportunity queue; lost links; anchors and velocity; competitor teardowns; tech stack and whois; outreach handoff; tracker and opportunity edits (Availability). |
| `references/digital-pr-and-brand-mentions.md` | Mention baseline; unlinked-mention reclamation; sentiment watch; PR angles; linkable assets on rivals. |
| `references/local-seo.md` | Before any GBP play: listing score; reviews and replies; attributes, services, media; citations and NAP; local lanes; the review-request truth; GBP posts and listings (Availability). |
| `references/aeo.md` | AI answers: readiness; entity; audit and citation sources; AI-lane read-back; robots, llms.txt and JSON-LD; the brand-audit budget; AI visibility (Availability). |
| `references/outcomes-and-measurement.md` | GA4 and GTM: the conversion audit; `seo_ga4_report` presets; key-event setup; GTM install truth; BYOK connection args; connection health and organic leads (Availability). |
| `references/reporting-and-delivery.md` | Deliverables, sections and sheets; workspace destruction semantics; the implement rail and its approval; task changes (Availability). |
| `references/seo-playbooks.md` | End-to-end jobs: R1 baseline; R2 strategy; R3 weekly; R4 monthly; R5 quarterly; R6 migration; R7 new location; R8 algorithm update; R9 traffic crash; R10 rank for X; R11 refresh; R12 ecommerce. |
| `references/ecommerce-seo.md` | Shopify and catalog sites: category and faceted policy; canonicals; Product, Offer and Breadcrumb schema; Merchant Center; out-of-stock URLs; revenue. |
