# Google Ads Advanced: raw read lane, Performance Max, Shopping, targeting, recommendations, forecasting, experiments

## What this covers / when to load this

The deep-Google reference: the parts of an account the cross-platform tools cannot express. Load it for the raw
read lane into the Google implementation (`ppc_google_ads_read`), Performance Max and Shopping work, geo /
proximity / language targeting (`ppc_google_targeting`), conversion actions that must be created or repaired
rather than merely diagnosed (`ppc_google_conversion_actions`), remarketing list plumbing
(`ppc_google_user_lists`), account-wide blocklists (`ppc_google_shared_negatives`), creative bytes
(`ppc_google_asset_upload`), competitive pressure (`ppc_impression_share` — Auction Insights is UI-only and
`ppc_auction_insights` always refuses), pre-launch volume math
(`ppc_keyword_planner_forecast`), Google's own recommendations (`ppc_recommendations_list` /
`ppc_recommendation_apply`), campaign settings with before/after (`ppc_google_campaign_settings_get` and
its preview-first writes, section 2.3), campaign experiments on Google and Microsoft (section 11), and
account binding (`ppc_ads_discover_customers`). SKILL.md section 0 is in force
without restatement: context first, fresh data or no data, confirm every spend-affecting write, protected
campaigns untouchable. Structure, keyword strategy, bids and budgets, ad copy and measurement have their own
references; this one assumes them.

---

## 1. Three lanes into one account

**Lane A: the curated tools.** The `ppc_*` surface in SKILL.md. First choice always: schema-validated,
tenant-scoped, writes carrying Hiveku's budget ceilings and paused-on-create behavior.

**Lane B: the raw read lane.** `ppc_google_ads_read({ connection_id, action, args })` shells the same Python
module (`ppc_google_ads`) the marketing department agent runs and hands you its read actions directly. Not a
reimplementation, not a cache: every call is live. Use it when Lane A has no tool, lacks a parameter, or when
the mirror looks stale.

**Lane C: the Google-ops plumbing tools.** `ppc_google_targeting`, `ppc_google_conversion_actions`,
`ppc_google_user_lists`, `ppc_google_shared_negatives`, `ppc_google_asset_upload`, `ppc_google_pmax` (asset
groups - see section 5), plus the read-only `ppc_google_pmax_performance`: functions below the CLI's own
entry point, one tool per capability with an `operation` enum and a free-form `params` object. Their `*-list`
operations are the only way to see geo criteria, language criteria, shared sets, user lists, stored assets
and PMax asset groups at all. **None of those sets a budget or a bid**, and the one create among them that
touches a serving surface (`ppc_google_pmax` asset-group-create) lands PAUSED by design. The same route
carries the `settings` module (one read, six preview-first writes, section 2.3) and the `experiments`
module (`ppc_experiments_list`, `ppc_experiment_create`, `ppc_experiment_schedule`, `ppc_experiment_end`,
`ppc_experiment_graduate`, section 11): a custom experiment's create lands in SETUP where nothing
serves, and schedule and graduate, the two operations that start or add spend, are two-step confirm
gates, graduate additionally capped by the agent daily-budget ceiling.

**There is no write door, on purpose.** `ppc_google_ads_read` refuses non-reads with
`code: "action_not_allowed"` plus the supported list. Campaign, budget, bid and audience writes stay behind Lane
A or `talk_to_department({ domain: "ppc" })`, which apply ceilings and staged approval the raw bridge does not
reproduce. Do not read that refusal as a bug and hunt for a back door. For what is not in the account at all,
`web_search` / `web_scrape` / `web_extract`.

**Read local first.** `hiveku-data/ppc/` holds `connections`, `campaigns`, `ad_groups`, `ads`, `keywords`,
`search_terms`, `metrics_daily`, `recommendations`, `disapprovals`, `conversion_actions` plus `SETUP.md`. A PMax
audit and most of section 13 run from disk with zero live calls. Check `fetched_at`; `truncated: true` means
`count` is a floor; an `error` with empty `rows` means NOT RETRIEVED, never "none exist." Auction insights,
forecasts, geo criteria, shared sets, user lists, asset groups and experiments are live-only.

---

## 2. Decision frameworks

### 2.1 Is Performance Max the right instrument, or the convenient one

PMax is a channel bundle with one budget, one target, almost no lever:

- **Real conversion signal?** Below roughly 30 conversions per 30 days it has nothing to optimize and spends the
  budget discovering that. Fix tracking or run Search first.
- **Budget above the floor?** At or above **3x target CPA** per day. A campaign that cannot buy three
  conversions a day never leaves learning.
- **Brand traffic fenced?** PMax buys the client's own brand queries at prospecting budget and reports them as
  conversions it created. Unfenced PMax is the most common cause of "our numbers look great and the phone is not
  ringing more."
- **Feed or creative library?** Retail with a healthy Merchant Center feed is its strongest case; lead gen with
  three stock images and no video is its weakest.

Two or more no answers means Search first, PMax later, and you say so plainly.

### 2.2 A recommendation is a priced proposal from a counterparty

Price every row `ppc_recommendations_list` returns. **Cost delta as a percentage of that campaign's daily
budget:** above **+10%** it is a budget request in an optimization costume and goes to the client, not to
`ppc_recommendation_apply`. **Implied CPA of the delta** (`cost_delta / conversions_delta`): worse than the
campaign's current CPA means Google is selling you worse traffic, so decline and record why. **No
`conversions_delta`** means Google cannot claim an outcome and it needs a hypothesis from you first. Type-level
posture and the never-loop rule live in `account-structure.md` Play 7.

### 2.3 Targeting geometry: presence versus interest

Google's default positive geo target type is `PRESENCE_OR_INTEREST`: people in the area **or** people anywhere
showing interest in it. Fine for national ecommerce, a leak for a local service business where somebody three
states away researching your city clicks the ad. On service-area accounts `PRESENCE` is almost always correct,
and switching it is the highest-yield change that risks nothing structural. It narrows who sees ads, so it is a
serving change and gets a confirmation.

**Read the setting before you say anything about it, then write it with proof.**
`ppc_google_campaign_settings_get` returns, per campaign, `location.positive_geo_target_type` (flag
`LOCATION_PRESENCE_OR_INTEREST`), the networks (`SEARCH_PARTNERS_ON`, `DISPLAY_EXPANSION_ON`), the URL
options, text automation (`TEXT_AUTOMATION_ON`, `FINAL_URL_EXPANSION_ON`, `AI_MAX_ON`), the schedule
(`SCHEDULE_MODIFIERS_IGNORED` under Smart Bidding), bidding, audience exclusions and the biddable
conversion goals, plus the account's auto-tagging, call reporting and auto-apply. The flags are facts,
not verdicts. The writes, each on ONE campaign (or the account), preview-first with before/after and a
read-back: `ppc_google_campaign_settings_set` (networks, location option, tracking template, final URL
suffix, custom parameters in one atomic update), `ppc_google_campaign_ai_settings_set` (stop Google
writing ad text: `params.auto_generated_text: false`), `ppc_google_ad_schedule_set`, `ppc_google_call_settings_set`,
`ppc_google_audience_exclusions_set` and `ppc_google_auto_apply_set`. The confirm is the SAME call with
`confirm: true` at the top level and `params.expected_preview_hash`; trust `after`, not `requested`.
Setting `negative_geo_target_type` from PRESENCE_OR_INTEREST to PRESENCE also widens reach and the
preview does not warn about that one: say it yourself. Still UI-only: the account-level automated-assets
switch, and auto-apply types outside the 15 the API exposes.

---

## 3. Play: bind the connection to the right customer

Wrong binding makes every number here a stranger's numbers. Run on any new connection and any time the data
looks like a different business.

1. `ppc_ads_discover_customers({ id })` with no `manager_customer_id` returns the customers the OAuth user can
   log in as, each with `name` and `is_manager`.
2. **Campaigns never live on an MCC.** If every row is `is_manager: true`, call
   `ppc_ads_discover_customers({ id, manager_customer_id })` for the ENABLED clients under it.
3. Match by name and currency against `account_context_get` and `get_account_info`, never by list position.
   Binding itself is a connection write outside this surface: hand the chosen `customer_id` (plus `manager_id`
   for an MCC child, sent as login-customer-id on every call) to the connection-update step in
   `account-structure.md`, then persist it with `memory_create`. A `412` with a hint means no developer token:
   see `hiveku-data/ppc/SETUP.md`.

---

## 4. Play: driving the raw read lane without tripping over it

`ppc_google_ads_read({ connection_id, action, args })`. Exactly 23 read actions are allowed: `account-settings`,
`anomaly-check`, `auction-insights`, `audience-performance`, `billing-summary`, `change-history`,
`conversion-tracking-status`, `impression-share`, `keyword-ideas`, `keyword-metrics`,
`keyword-planner-forecast`, `linked-accounts`, `list-conversion-actions`, `list-disapprovals`, `list-keywords`,
`list-recommendations`, `period-comparison`, `pull-ad-groups`, `pull-ads`, `pull-campaigns`, `pull-metrics`,
`search-terms`, `segment-report`. Anything else returns a structured 400 naming those. Do not guess adjacent
names.

**The argument contract, where this lane bites.** `args` is a flat object of CLI flag names without leading
dashes: `{ "days": 30, "campaign-id": "123", "limit": 500 }`.

- Flag names: lowercase, leading letter, digits and hyphens. **Values may contain only letters, digits and
  `_ , . : / -`, up to 120 characters, no spaces**, and a value containing `..` is rejected outright.
- Consequence you hit first: **multi-word keywords cannot be passed on this lane.**
  `{"seed-keywords": "emergency plumber"}` is refused; comma-joined single tokens work, phrases do not. For
  keyword research use `ppc_keyword_ideas` (multi-word seeds, location, language, paging) and for volume
  `ppc_keyword_planner_forecast`, whose `keywords` is a real array; see `keywords-search-terms-negatives.md`.
- Unknown flags are a hard error, not a silent ignore. The date window flag is **`days`**; there is no
  date-range flag on this module and passing one fails the whole call.

**Defaults differ from the curated tools, which is the point and the trap.** Here `days` defaults to **7** and
`limit` to **1000**, while the curated twin of the same report usually defaults to 30 days. Run both bare and
you get two different reports with the same name, then explain the gap to a client. Always pass `days` and
`limit` explicitly on the raw lane.

**Scope and safety.** The bridge expects platform `google_ads`; a Microsoft or Meta connection id fails as
wrong-platform or not-found rather than returning empty rows, so the mistake is loud. Calls are live and can
exceed a minute: scope with `campaign-id`. `period-comparison` is the one action worth coming here for on its
own: it needs all four of `period-a-start`, `period-a-end`, `period-b-start`, `period-b-end`, plus `scope`.

---

## 5. Play: Performance Max audit and containment

1. **Identify.** `hiveku-data/ppc/campaigns.json`, or
   `ppc_google_ads_read({ connection_id, action: "pull-campaigns", args: { limit: 200 } })`. Every row carries
   `campaign_type`: `performance_max`, and also `shopping`, `display`, `video`, `demand_gen`, which share the
   same reporting opacity.
2. **Check servability.** A PMax campaign with no asset group can never serve; one missing a required slot
   serves at a fraction of its potential. `ppc_google_pmax` operation `asset-group-list` is the read: every
   group with per-slot asset counts, signals, ad_strength, primary_status, and `missing_requirements`
   naming exactly why an idle group cannot serve. Repair a missing slot with `asset-group-asset-add`
   (assets uploaded first via `ppc_google_asset_upload`; CAUTION - on an ENABLED group in an ENABLED
   campaign the new creative serves immediately, so confirm first). Net-new groups: `asset-group-create` is
   ONE atomic write that refuses to build a group missing anything Google requires, and lands PAUSED;
   enabling the group and the campaign are two separate approvals on the enable lane. Signals via
   `asset-group-signal-add` are HINTS, not targeting fences - they never narrow delivery.
3. **Test the brand fence.** This is the whole game. Compare brand-campaign impression share and conversions
   across the launch date with `ppc_google_ads_read({ action: "period-comparison", args: { "period-a-start":
   ..., "period-a-end": ..., "period-b-start": ..., "period-b-end": ..., scope: "campaign" } })`. The
   cannibalization signature: PMax cost and conversions rise while brand Search conversions fall by a similar
   count, its lost impression share does not explain the drop, and blended CPA looks flat. Nothing was created;
   volume moved and got relabeled. `ppc_google_pmax_performance` makes the mechanism visible: it returns
   per-asset-group metrics PLUS Google's per-channel split of where PMax delivery actually went
   (segments.ad_network_type - SEARCH, SEARCH_PARTNERS, CONTENT/Display, YOUTUBE, GMAIL, DISCOVER, MAPS,
   GOOGLE_TV; MIXED = cross-network), channels sorted by spend - a PMax campaign whose spend concentrates
   in SEARCH while brand Search bleeds is the fence failing in one read. A non-PMax campaign_id is refused
   with a pointer to `ppc_metrics`; asset groups with zero traffic in the window are absent (asset-group-list
   shows every group); if the channel query fails on an old agent image, asset-group rows still return and
   `channel_split_unavailable` says why.
4. **Build the fence** with `ppc_google_shared_negatives`: `shared-set-create({ params: { name } })`, then
   `shared-set-keywords-add({ params: { shared_set_resource_name, keywords: [...], match_type: "phrase" } })`
   with the brand name and its misspellings, then
   `shared-set-attach({ params: { campaign_id, shared_set_resource_name } })`. Brand exclusion on PMax is a
   Google-side setting with its own eligibility rules, so verify in the UI that it took effect there.
   **Serving change, immediate on every attached campaign. Confirm first.**
5. **Read what PMax will tell you.** `segment-report` on `date`, `device` and `ad_network_type` works;
   `search-terms` does **not**, because it reads `search_term_view`, which has no PMax rows. Say "not
   available on this surface," never "PMax had no search terms."
6. **Judge on time, not impatience:** two conversion cycles or six weeks, whichever is longer. And **signals are
   hints, not fences** - they bias exploration, never restrict delivery, and the client should hear that before
   launch rather than at the first invoice.

---

## 6. Play: Shopping, and where the tooling stops

**What works.** `pull-campaigns` shows `campaign_type: "shopping"`; `search-terms` works for Shopping (unlike
PMax), so mining and negatives apply as in `keywords-search-terms-negatives.md`; `segment-report` on `device`
and `ad_network_type` works; `ppc_google_shared_negatives` attaches blocklists,
`ppc_google_targeting` sets geo and language. Shopping competitor domains are NOT retrievable —
`ppc_auction_insights` refuses on every campaign type, Shopping included.

**What does not.** There is **no Merchant Center tool** in this plugin: no feed read, no product-status check,
no disapproved-product list, no feed rule, no listing group or product partition edit. Those are the levers that
fix most Shopping problems. Fallbacks in order: read Merchant Center diagnostics in the dashboard with the
client's access; `web_scrape` / `web_extract` the product pages to verify the structured data and pricing the
feed is built from; `hiveku_docs_search` then `hiveku_docs_get` in case an integration exists this reference has
not been told about; escalate via `talk_to_department({ domain: "ppc" })`. Never present a Shopping plan that
quietly assumes you can see the feed. On "impressions collapsed," name the feed gap up front, then rule out what
you can see: geo criteria, a newly attached shared negative, `change-history`, `list-disapprovals`.

---

## 7. Play: geo, proximity and language audit

Run at onboarding on every account, and whenever spend appears from places the client does not serve. Evidence
first: `ppc_performance_breakdown({ connection_id, params: { dimension: "location", service_area } })`
over 30 days - spend from people IN the area versus only interested in it (`INTEREST_ONLY_SPEND`),
outside the targeted area, and outside the client's service area from memory, each finding naming its
fix tool - or `ppc_segment_report` with `dimensions: ["geo"]` for the raw table.

1. **Resolve names to ids.** `ppc_google_targeting({ connection_id, operation: "geo-target-search",
   params: { query: "Dallas, Texas", country_code: "US", limit: 20 } })` takes place names or postal codes and
   returns geo target ids with reach estimates. Never hand-type a geo id.
2. **Read state.** `campaign-geo-targets-list({ params: { campaign_id } })`; every row has a `resource_name`,
   and **`negative: true` means EXCLUDED** - misreading that line has caused people to "add" a location that was
   deliberately excluded. `campaign-language-targets-list` returns language criteria, and **no criteria means
   all languages**, a common silent source of irrelevant traffic on English-only businesses.
3. **Fix, one confirmed change at a time.**
 - `campaign-geo-target-add({ params: { campaign_id, geo_target_ids: [...] } })`, max 100 per call. **Adding
     the first positive location narrows the campaign from everywhere to only those places** - the largest
     single-call reach change in this reference. Confirm it in those words. The same op with `negative: true`
     excludes; a `bid_modifier` is not allowed on an exclusion.
 - `campaign-geo-target-remove({ params: { resource_names: [...] } })`, max 100; removing an exclusion WIDENS
     reach. `campaign-proximity-add({ params: { campaign_id, latitude, longitude, radius, radius_units:
     "MILES" } })`, max 500 miles or 800 kilometers, is the instrument for service areas that ignore city lines.
 - The location option: prefer `ppc_google_campaign_settings_set` with `params.positive_geo_target_type:
     "PRESENCE"` (same change with before/after and a read-back, per 2.3); `campaign-location-settings-update`
     makes it without either. `campaign-language-target-add({ params: { campaign_id, language_ids: ["en"] } })`, max 50, matches the
     user's Google interface language, not the language of their query.

---

## 8. Play: conversion action surgery

The measurement reference diagnoses tracking; `ppc_google_conversion_actions` **fixes** it. Tracking gates every
bid and budget decision, so this outranks optimization when both are open.

**Create:** `conversion-action-create({ params: { name, category, type_ } })`. Note the **trailing underscore on
`type_`**; `type` is silently not the parameter. Values: `WEBPAGE` (site tag, default), `UPLOAD_CLICKS` (CRM
import), `UPLOAD_CALLS` (PBX import), `AD_CALL`, `WEBSITE_CALL`, `CLICK_TO_CALL`. Offline conversion upload
requires an upload-type action to exist first, so this is the missing first step of that loop.

- `count_type`: `ONE_PER_CLICK` for lead gen, `MANY_PER_CLICK` for ecommerce. A lead-gen account on
  MANY_PER_CLICK double-counts one prospect submitting twice, and every CPA in the account is a lie until fixed.
- `include_in_conversions_optimization: false` makes an action reporting-only, out of Smart Bidding. Correct for
  secondary signals such as page views; true on a low-intent action is how an account learns to buy junk.
- `click_through_lookback_days` 1 to 90. Match the real sales cycle: 30 for fast lead gen, 60 to 90 for
  considered B2B. Too short and Smart Bidding never sees the conversion it caused.
- `phone_call_duration_seconds` 1 to 10000 on call types. **Calls shorter than it record nothing.** 60 seconds
  is the workhorse default; 30 counts wrong numbers, 120 discards real short bookings.
- The response carries `conversion_action_id` and `tag_snippets`. Hand those to the site owner as a PM task; do
  not mark tracking fixed until a fire is observed. `conversion-action-get-tag({ params: {
  conversion_action_id } })` returns the site tag, event snippet, `AW-` id and label: proof a page carries the
  right label, not a stale one from a previous agency.

**Update:** `conversion-action-update({ params: { conversion_action_id, ... } })`. `status: "HIDDEN"` retires an
action from reporting; **`REMOVED` is refused on this lane** because removal is permanent and destroys what
Smart Bidding optimizes toward, so a client who insists goes through the department's human-approval flow.
`always_use_default_value: true` **flattens every conversion to one value and destroys transaction-level revenue
reporting**: reversible, but any ROAS reported while it was on is wrong. Flipping
`include_in_conversions_optimization` changes what Smart Bidding chases and starts fresh learning: same gravity
as a bidding-strategy change. Everything here is spend-consequential through the bidding signal. Confirm each
individually.

---

## 9. Play: user lists, shared negatives, stored assets

**User lists.** `ppc_google_user_lists({ connection_id, operation: "user-lists-list", params: { limit } })` is
the **only** way to get the `user_list_id` that customer-match upload requires; nothing else surfaces it. It
also returns the resource names the audience-attach tools consume, plus sizes and eligibility.
`user-list-create-rule-based` builds a website-visitor list from the Google tag: `params.rules_json` is a JSON
array of up to 20 rules `{name, operator, value}`, `name` being `url__` or `referrer__url__` and `operator`
CONTAINS / EQUALS / STARTS_WITH / ENDS_WITH or their NOT_ variants; plus `membership_life_span_days` 1 to 540
(default 30), `rule_operator`, and `prepopulate` to backfill 30 days. It creates a visitor list, **not** a
customer-match list, and uploads no customer data. Duration is a strategy choice: 30 days for impulse purchases,
90 for considered ones, 180 to 540 for renewal and win-back. A list needs roughly **100 members to serve on
Search and 1,000 on Display**; a fresh list serving nothing is expected, not broken.

**Shared negatives as architecture.** The account-wide blocklist layer, distinct from the per-campaign negatives
in `keywords-search-terms-negatives.md`. What holds up: one permanent list of universal junk (jobs, salary,
free, DIY, wrong-industry homonyms), one competitor list attached and detached as strategy changes, one brand
fence for PMax and broad match; per-campaign negatives then carry only what is campaign-specific.
`shared-set-keywords-add` takes up to 200 keywords per call, defaults to **phrase**, and takes effect
**immediately on every attached campaign**. Google's ceilings: roughly 5,000 keywords per list, 20 lists per
account. `shared-set-detach` widens reach, so blocked queries serve again: spend-affecting, own confirmation.
Read state first with `shared-sets-list({ params: { shared_set_id } })`, which lists that set's keywords and
attached campaigns, so you never attach twice or block a term the client sells.

**Stored assets.** `ppc_google_asset_upload({ connection_id, operation: "image-asset-create", params: { name,
media_source } })`, `media_source` being an https URL or an `s3://` key in Hiveku's buckets, fetched through a
guarded pipeline with a **5 MB cap** then stored by Google, so the source can later disappear. The response's
`suggested_field_types` names the slots the image legally fills: MARKETING_IMAGE 1.91:1, SQUARE_MARKETING_IMAGE
and LOGO 1:1, PORTRAIT_MARKETING_IMAGE 4:5. **Read that field rather than assuming**: a wrongly shaped image is
the usual reason a creative slot stays empty. `youtube-video-asset-create({ params: { youtube_video_id } })`
takes the 11-character id or a watch URL, and the video must already be public or unlisted. `assets-list` is the
read side. Uploading spends nothing and serves nothing.

---

## 10. Play: competitive read, forecast, recommendation cross-check

**Auction insights: NOT RETRIEVABLE, on any account, through any lane.** Google exposes no `auction_insight`
resource and none of `overlap_rate` / `outranking_share` / `position_above_rate` exist on Metrics in any
current API version. `ppc_auction_insights` returns a refusal naming this, and so does
`ppc_google_ads_read({ action: "auction-insights" })` — the raw lane calls the same implementation, so it is
not a workaround. Do not budget a report section for competitor domains and do not retry with a wider window.

What to run instead: `ppc_impression_share({ connection_id, days: 30 })`, which carries the account's own
search impression share plus the split between share **lost to rank** and **lost to budget**. That split
answers the question the competitor table was being used for — high lost_to_rank means you are being
outranked (a Quality Score and bid problem), high lost_to_budget means you stopped showing (a budget
problem) — without naming anyone. If the client specifically needs rival domains, a human exports Google Ads
UI > Campaigns > Insights > Auction insights; say that plainly rather than reporting "no competitors found".

**Forecasting.** `ppc_keyword_planner_forecast({ connection_id, keywords: [...], bid_micros, daily_budget,
language_id, geo_target_ids })`. `bid_micros` is micros (2000000 = $2.00); `language_id` defaults to 1000
(English); `geo_target_ids` is numeric ids, 2840 US, 2826 UK, 2124 Canada. **The bridge worth knowing:** for
anything smaller than a country, resolve ids first with `ppc_google_targeting({ operation: "geo-target-search",
params: { query: "Fort Worth, Texas", country_code: "US" } })` and pass those in. Skipping it is how a
three-county service business gets quoted national volume, the most common forecasting error in this account
type. Some MCCs have Keyword Planner API access disabled and the response says so; fall back to `web_search`
with third-party estimates labeled as such. Seeds come from `ppc_keyword_ideas`; forecast the match types
you will launch (`match_type` or `keyword_specs`), and for lead gen `bidding_strategy:
'maximize_conversions'` with `daily_budget`, never `bid_micros`. Seed selection lives in
`keywords-search-terms-negatives.md` Play 6. For a campaign that already has history, the simulator
(`ppc_bid_budget_simulate`, `bidding-budgets-pacing.md` Framework B) replays real auctions instead.
**Credibility:** discount forecast clicks **20 to 40%** on an account with no history, compare forecast CPC
against the account's actual CPC on similar terms, and quote ranges as "Google's planner projects," never point
estimates and never "we expect." A forecast CPC under half the observed CPC is geo-wrong or match-optimistic.

**Recommendations.** `ppc_recommendations_list({ connection_id, types, limit })` takes uppercase underscored
type names (KEYWORD, KEYWORD_MATCH_TYPE, RESPONSIVE_SEARCH_AD, BIDDING_STRATEGY, TARGET_CPA_OPT_IN,
CAMPAIGN_BUDGET, MOVE_UNUSED_BUDGET, USE_BROAD_MATCH_KEYWORD), `limit` 1 to 500 (default 100), sorted by
absolute conversion delta. When a client says "Google says our optimization score is 62 and you are ignoring
it," pull the list live with `ppc_google_ads_read({ action: "list-recommendations", args: { types:
"CAMPAIGN_BUDGET,KEYWORD", limit: 200 } })` (comma-joined, no spaces) so you quote the account rather than the
mirror, price each row by 2.2, and present the declines as decisions with reasons.
`ppc_recommendation_apply({ connection_id, resource_name })` applies **one**, with Google's default parameters.
Some types are UI-gated and return a structured 400; surface it verbatim.

---

## 11. Play: campaign experiments (Google and Microsoft)

A treatment copy of one campaign, a traffic split against the original, an honest readout, then adopt or
drop. The lane is declared on both platforms and has never been driven end to end against a live account:
every claim below is the declared contract. **The first live experiment through it needs the account owner's
explicit yes** (experiments split real traffic). On first use per account, read everything back through
`ppc_experiment_readout` and in the platform UI, then record in memory that the lane is validated there.
`spend-change-discipline.md`'s governing rule applies in full: no testing means no capability claim.

**What an experiment can be here.**

- **Google:** SEARCH and DISPLAY campaigns; PMax, Shopping, Video and Demand Gen are refused. The default
  `params.experiment_type: 'custom'` builds a treatment COPY you edit. `'broad_match'` is Google's intra-campaign
  broad-match test on a SEARCH campaign: no copy to edit, cannot be graduated, 50/50, and Google turns the
  campaign's broad match setting on AT CREATION with no preview or confirm - treat that create as a live
  change to the base campaign: owner's yes, a low-risk campaign, keywords and search terms checked right after.
- **Microsoft:** Search campaigns. `ppc_bing_experiment_create` copies the base and the copy SERVES ON
  `start_date` with whatever it contains, so the create IS the money step (no new spend: the base budget
  is split). An unedited copy tests nothing.
- **The split is a whole percent, 1 to 99**, the treatment's share, fixed after create.
- **ONE hypothesis per experiment.** `ppc_experiment_treatment_set` puts exactly one change into the copy,
  a bidding switch OR a landing-page swap (keyword-level final URL), never both. The base campaign is never
  written.

### 11.1 The lifecycle

1. **Read first.** `ppc_experiment_readout({ connection_id })` with no `params.experiment_id` is the roster
   on both platforms (state not_started | running | finished | failed). On Google,
   `ppc_experiments_list({ connection_id, params: { limit } })` adds Google's own `status` (**SETUP means
   nothing is serving or spending**; INITIATED / ENABLED means the copy is SPENDING), `arms[]` with
   `in_design_campaigns` (the copy) and `promote_status`. A second experiment on the same base campaign is a
   design error.
2. **Create.** Google: `ppc_experiment_create({ connection_id, params: { name, campaign_id,
   traffic_split_percent, suffix, description, start_date, end_date, experiment_type } })` (`name` and the
   numeric `campaign_id` required) - one write, lands in SETUP, no confirm; Google builds the copy
   asynchronously. Microsoft: `ppc_bing_experiment_create({ connection_id, params: { name, campaign_id,
   start_date, end_date, traffic_split_percent, split_method } })` - preview-first (Hiveku's own check;
   Microsoft has no validate-only mode), `start_date` tomorrow UTC at the earliest, `end_date` required.
   It is the Microsoft money step, so the confirm waits for the owner's yes on the preview.
3. **Put the one change in.** `ppc_experiment_treatment_set({ connection_id, params: { experiment_id,
   bidding | landing_page } })`, preview-first. Google refuses while the copy is still being built
   (`treatment_not_built`: retry in a minute); Microsoft accepts it only while the experiment is Scheduled.
4. **Design check.** `ppc_experiment_readout` with `params.experiment_id` on a not-started experiment
   returns the design view: what the copy changes, Google's own schedule check (validate-only), a
   shared-budget warning, and the days needed to reach the floors from the base campaign's last 30 days.
   Set `end_date` from that projection, not from the client's patience, and write `earliest_callable_date`
   into the PM task.
5. **Start.** Google: `ppc_experiment_schedule({ connection_id, params: { experiment_id } })` - TWO-STEP:
   the first call returns `requires_confirm: true` with the preview; put it in front of the owner and
   only on their yes does the identical call with `confirm: true` start the split (never chain the
   two). `scheduled: true` means accepted; trust `verified` and `status_after`.
   Microsoft starts on `start_date` by itself. Running an experiment switches Google's bid and budget
   simulator off for that campaign until 8 days after it ends.
6. **Read.** `ppc_experiment_readout` with `params.experiment_id` (`primary_metric` cpa | conversions |
   roas). Section 11.2 decides what you may say.
7. **Finish, one of four.**
   - **End** (the copy stops; nothing applied to the base): Google `ppc_experiment_end({ connection_id,
     params: { experiment_id } })`, a single call with no confirm, `ended: true` only after the status is
     read back, a SETUP experiment refused; Microsoft `ppc_bing_experiment_update` with `params.status:
     'ended'` (if Microsoft refuses that write, the answer names the alternative: `end_date` set to today). Ending early discards every click bought: diff and approval.
   - **Promote** (ADOPT the treatment INTO the base campaign, NO new budget): `ppc_experiment_promote`,
     both platforms. On Microsoft the base adopts every setting of the copy and any change made to the base
     during the test is DELETED.
   - **Graduate** (the copy becomes a SEPARATE campaign on its own budget, the base keeps running, account
     spend goes UP): Google `ppc_experiment_graduate({ connection_id, params: { experiment_id,
     daily_budget } })`, two-step confirm; Microsoft `ppc_bing_experiment_update` with `params.status:
     'graduated'` (the same daily budget as the base; the spend guardrail is checked first). Graduate is
     NOT promote. A broad-match experiment cannot be graduated.
   - **Discard** (never started, nothing served): `ppc_experiment_discard`, Google SETUP only, Microsoft
     Creating / Scheduled / CreationFailed. This is how a stuck SETUP experiment is cleared.

   Microsoft's own docs contradict each other on writing an experiment's status and that write is untested
   live: `microsoft_rejected` carries the alternative, `microsoft_status_update_unconfirmed` means it did
   not move, and Hiveku never switches to a different write on its own.

**The write contract** for `ppc_experiment_treatment_set`, `_promote`, `_discard` and both
`ppc_bing_experiment_*` writes: preview first, then the SAME call with `confirm: true` at the top level and
`params.expected_preview_hash`. A stale hash (the experiment moved, or the write already landed) writes
nothing: preview again. Sent once: after a slow or failed confirm, read `ppc_experiment_readout` before
calling again. `pending: true` means the platform accepted a long-running change that has not finished:
re-read before reporting it done.

### 11.2 Calling the test

**The readout never says "winner", and neither do you.** `treatment_better` / `treatment_worse` only when
every arm has at least 100 clicks, 10 conversions and 14 days, p < 0.05 with an interval that excludes zero,
AND the experiment is final (ended, promoted or graduated, or past its end date). Before that a significant
result is `interim_better` / `interim_worse`: INTERIM IS NOT FINAL, never act on it as a result. Below the
floors the verdict is `insufficient_data` or `too_early` however large the difference looks: say how far
off the floors are and quote `earliest_callable_date`. `min_clicks_per_arm`, `min_conversions_per_arm` and
`min_days` can raise the floors, never lower them. ROAS without Google's own statistics is
`not_computable`. Real Hiveku leads per arm (`lead_truth`) are a separate verdict needing 10 leads per arm,
never merged into the platform one. Microsoft's split lets one searcher see both arms, so its comparison is
approximate: say so.

**Do the arithmetic before you start:** at 50/50 each arm sees half the campaign's traffic, so a campaign
doing 60 clicks a week needs about four weeks before both arms clear 100 clicks; at 20/80 the treatment arm
needs five times the campaign-weeks the base would.

**Verdict rules.** Promote or graduate only on a final `treatment_better` on the primary metric (CPA or
ROAS, per account memory), with the owner's yes. End when control wins, or when `end_date` will arrive
before the floors can. A flat result is an end, not a graduate: graduating a tie buys a budget raise for
nothing. **One experiment is the base campaign's one change for its window:** no bidding-strategy, budget,
geo or shared-negative change on that campaign while it runs, and no experiment on a campaign still inside
a learning phase, or the two arms stop measuring the same thing.

---

## 12. Thresholds and benchmarks

Account memory overrides these. They are the defaults you argue from.

| Signal | Threshold | Action |
|---|---|---|
| PMax conversions / 30d | below 30 | too little signal; fix tracking or run Search first |
| PMax daily budget | below 3x target CPA | underfunded; raise it or do not launch |
| PMax age at first verdict | under 6 weeks or 2 conversion cycles | do not call it yet |
| Brand conversions after PMax launch | down while PMax up by a similar count | cannibalization; fence it |
| Recommendation cost delta | above +10% of campaign daily budget | client approval, never auto-apply |
| Recommendation implied CPA | worse than current campaign CPA | decline, document the reason |
| overlap_rate | above 60% | a real competitor worth researching |
| outranking_share | below 40% at high overlap | Quality Score and bid problem, not budget |
| Geo positive type, local account | PRESENCE_OR_INTEREST | propose PRESENCE |
| count_type on lead gen | MANY_PER_CLICK | double counting; every CPA is wrong |
| User list size | under 100 Search / 1,000 Display | cannot serve yet; expected on new lists |
| Forecast CPC vs account CPC | under half | geo or match type wrong; re-resolve geo ids |
| Experiment status (Google) | SETUP | nothing serving or spending; a confirmed schedule is the only way it runs (discard it if unwanted) |
| Experiment arm at verdict | under 100 clicks or 10 conversions in either arm, or under 14 days | `insufficient_data` / `too_early`: not callable; quote `earliest_callable_date` |
| Experiment verdict | `interim_better` / `interim_worse` | interim, not final: act on nothing until the planned end |
| Experiment result | not a final `treatment_better` on the primary metric | end it; a tie is never a promote or a graduate |

---

## 13. Diagnosis: when the data looks wrong

- **Blank impression share on PMax / Display / Video.** Expected: these are Search impression-share metrics and
  non-Search channels have none. Never report it as zero.
- **No PMax search terms.** Expected: `search-terms` reads `search_term_view`, which has no PMax rows. Say "not
  exposed on this surface," never "no wasted queries."
- **Segment report dropped clicks and cost.** Expected when `dimensions` includes `conversion_action` or
  `conversion_action_category`: Google refuses to pair those with click and cost metrics, so the implementation
  narrows to conversion metrics rather than failing. Run two reports.
- **`invalid_arg_value`:** a space, quote, shell character or `..` in a value, or over 120 characters.
  **`action_not_allowed`:** read the `supported` array; if you wanted a write, that is the boundary.
- **Two reports with the same name disagree.** Almost always the 7-vs-30-day and 1000-vs-100-row default gap
  between lanes; re-run both with explicit `days` and `limit`. **Numbers belong to a different business:**
  binding, so re-run section 3 and check `manager_id` on MCC children.
- **Conversions went to zero overnight.** In order: `list-disapprovals`, `change-history` (30 days is all Google
  keeps), `conversion-tracking-status`, then whether an action was set HIDDEN or
  `include_in_conversions_optimization` was flipped.
- **Spend from places the client does not serve.** `campaign-geo-targets-list` for criteria,
  `ppc_performance_breakdown` (`params.dimension: "location"`) for evidence, `ppc_google_campaign_settings_get`
  for the location option, then 2.3.
- **An audience will not serve:** `user-lists-list` for size and eligibility, since under the floor it cannot,
  and 24 to 48 hours after an upload is normal. **A creative slot stays empty:** `assets-list`, compare
  `suggested_field_types` to the slot. **The forecast errors:** Keyword Planner disabled on that MCC.
  **Nothing fits:** `hiveku_docs_search` then `hiveku_docs_get` before concluding a capability is missing.
- **An experiment has sat in SETUP for weeks.** Expected: create lands there by design and nothing serves
  until a confirmed `ppc_experiment_schedule`. A `requires_confirm: true` response is the preview, not a
  failure and not a success; the experiment is still in SETUP until the `confirm: true` call returns.
  A SETUP experiment nobody wants is removed with `ppc_experiment_discard`, never ended (end refuses it).
- **The readout says `interim_better`.** It is not a result until the planned end: report it as interim.
  **The experiment tools are not in the session at all:** a profile question first, then `/hiveku:update`.

---

## 14. Edge cases, failure modes, what not to do

- **Do not hunt for a write door on the raw lane.** It is read-only because writes spend money and the ceilings
  and approvals live above it. Routing a write around that control to save a step is the worst thing you can do
  with this reference.
- **Do not report NOT RETRIEVED as zero.** An error row, an empty auction-insights report, a blank PMax
  search-term result and an unreadable feed are four kinds of "I do not know," each labeled as such. And **do
  not fabricate a tool for a gap**: Merchant Center, product partitions and campaign drafts have no tool here
  (PMax asset groups have `ppc_google_pmax`; experiments have section 11), so the honest moves are
  `talk_to_department`, the dashboard, or `web_*` research.
- **Do not chain an experiment's preview and confirm calls**, and **do not graduate a tie**: graduation is a
  budget raise with a test result stapled to it (a SEPARATE campaign on new money; adopting the treatment
  into the base is promote), and a flat result justifies neither. Do not schedule an
  experiment on a campaign inside a learning phase, and do not touch the base campaign's strategy, budget or
  geo while one runs.
- **Do not attach a shared negative list without reading it first:** attachment blocks every keyword in it on
  that campaign immediately, and a list built for one competitor set can contain a term another campaign sells.
  **Do not add the first positive geo target casually:** it converts a campaign from everywhere to only there in
  one call. **Do not set `always_use_default_value`** to tidy revenue reporting. **Do not remove a conversion
  action:** HIDDEN is the retirement path. **Do not loop `ppc_recommendation_apply`:** Optimization Score is
  Google's metric for Google's revenue.
- **Do not stack changes during learning:** a bidding target change, a geo geometry change and a new shared
  negative on the same day produce a week of data that answers nothing.
- **Respect protected and brand campaigns absolutely.** If `memory_list` or `account_context_get` marks a
  campaign protected you do not attach a list to it, change its geo, fence it, pause it, or apply a
  recommendation scoped to it. Flag and ask every time, even when the change looks obviously correct.
- **Currency, MCC, latency.** Every number is in the bound account's currency, an MCC with children in three
  currencies cannot be summed, and a wrong `manager_id` yields plausible data from the wrong account rather than
  an error. Raw-lane calls run live: scope by `campaign-id`, cap `limit`, never poll in a loop.

---

## 15. Persistence and reporting

**Memory.** After any session producing a durable fact, write it with `memory_create({ type: "memory",
name: "ppc", content })`, or, to correct one, `memory_update({ memory_id, content })` with the whole
merged document, since it REPLACES the entry and takes no `type`/`name`. Record the bound `customer_id` and `manager_id` and why
that child; protected campaigns; the brand fence's shared-set name, resource name and attached campaigns; the
primary conversion action ids and the reasoning behind their `count_type` and lookback; the geo geometry
decision and its date; the PMax verdict window's end date, so the next session does not re-litigate early;
every running experiment's `experiment_id`, base campaign, split, `start_date` and the earliest callable date
from 11.2; recommendation categories carrying standing approval or refusal. Read it back with `memory_list` before
strategy, next to `account_context_get({ domain: "ppc" })`.

**PM tasks are the audit trail.** `pm_tasks_create` per piece of work. Record the exact operations with their
arguments, the resource names returned (the undo handles, and shared-set and criterion resource names exist
nowhere else once the call is gone), the client's confirmation and its wording, and what was proposed and
declined. Advance with `pm_tasks_update`; close with `pm_tasks_complete` only once the effect is verified in
data, not merely applied.

**Client reporting.** Translate: "we changed the positive geo target type to PRESENCE" becomes "your ads now
show to people in your service area rather than anyone anywhere researching it." Report declined recommendations
as work, with the cost delta and implied CPA that justified declining, and the PMax fence as protection of brand
spend with before-and-after numbers. Keep raw-lane mechanics out of the client document. For net-new narrative,
`talk_to_department({ domain: "ppc", message })` returns brand-hydrated copy you then edit.
