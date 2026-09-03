# Account Structure: campaigns, ad groups, naming, bulk ops, change history, recommendations

## What this covers / when to load this

The structural half of the PPC operating system: how a client's paid accounts are wired (connection to
customer to campaign to ad group), how to judge that wiring, how to change it safely, and how to prove what
changed. Load it for an onboarding structure audit, campaign builds and splits, ad-group re-theming,
naming, bulk state work, forensics on "something moved and nobody knows why," recommendation triage, and
account binding. Keywords, bids, ad copy, audiences and measurement are separate references. SKILL.md
section 0 is assumed in force.

---

## 1. The mental model

**Four layers.** **Connection** (a UUID row per ad account per platform: platform, customer_id,
manager_id, currency, status, and a `settings` blob of budget guardrails; nearly every ops tool takes
`connection_id`, not the platform's account id) -> **customer / advertiser account** (Google 10-digit
customer_id, Bing advertiser id, Meta ad account; point the connection at the wrong one and everything
below is silently a stranger's account) -> **campaign** (budget, bidding, geo, network, schedule) ->
**ad group** (theme, default bid, keywords, ads, audience criteria).

**Two data paths that disagree by design.** The **cached mirror** (`ppc_campaign_list`,
`ppc_ad_group_list`, `ppc_campaign_get`) is fast, cross-platform, paginated, and only as fresh as the last
sync. The **live ops surface** (`ppc_campaign_create`, `ppc_ad_group_create`, `ppc_enable_resource`,
`ppc_pause_resource`, `ppc_bulk_edit`, `ppc_change_history`, `ppc_recommendations_list`,
`ppc_recommendation_apply`, `ppc_account_settings_get`, `ppc_linked_accounts_list`,
`ppc_ads_discover_customers`) hits the API live, and those writes do not reach the mirror until you run the
sync step from SKILL.md section 0.3, so a write followed by a mirror read shows you the old state.

**Google-only versus cross-platform.** Every live-ops tool above is Google Ads only; a non-Google
connection_id returns a wrong-platform error, not an empty result, so the mistake fails loudly. Portable:
`ppc_platform_pause_resource` / `ppc_platform_enable_resource` (all five platforms) and
`ppc_platform_ad_group_create` (Microsoft only, starts PAUSED where the Google one starts ENABLED).

**Read local first.** `/hiveku:pull ppc` writes `hiveku-data/ppc/` (`connections`, `campaigns`,
`ad_groups`, `ads`, `keywords`, `search_terms`, `metrics_daily`, `recommendations`, `disapprovals`,
`conversion_actions` as .json, plus `SETUP.md`) and `hiveku-data/STATUS.json`. A structure audit reads
`campaigns.json` + `ad_groups.json` + `ads.json` with zero live calls. Check `fetched_at`;
`truncated: true` means `count` is a floor; an `error` with empty `rows` means NOT RETRIEVED, never "no
data." Change history has no local snapshot.

---

## 2. Decision frameworks

### 2.1 Restructure or tune in place?

Restructuring resets learning and Quality Score history and produces a noisy week that degrades every
other diagnosis. Restructure only when at least **two** are true:

- **Budget contention.** Brand and non-brand share a budget, or a proven winner and an experiment do.
- **Bidding contention.** One campaign holds conversion profiles differing by more than roughly 2x in CPA
  or value, so no single target serves both.
- **Reporting opacity.** The client asks a question the structure cannot answer without manual arithmetic.
- **Theme collapse.** Ad-group keywords no longer share intent, so no single ad fits all of them.
- **Targeting collision.** Two campaigns eligible for the same query with different budgets or strategies,
  so Google's tiebreak allocates your budget.

If only one is true, tune in place. Structure is the last lever, and never inside the first 30 days unless
tracking is proven broken and structure is the reason.

### 2.2 What earns its own campaign

A dimension earns campaign separation when it needs its own **budget**, **bidding target**, **geo or
schedule**, or **reporting line**. Descending by how often it is correct: **brand versus non-brand**
(always, since brand CPA is a fraction of non-brand and blending makes any smart-bidding target
meaningless); **intent tier** where economics differ sharply; **geography** when budget must differ by
market, since geo bid modifiers are cheaper than a split; **product line** with different margin;
**campaign type**, because Display and Pmax eat a shared budget alive; and **test versus control**.
Anything else belongs in an ad group.

### 2.3 Ad group granularity

Default to **themed ad groups (STAG)**: 5 to 20 tightly related keywords, one intent, one landing-page
concept, 1 to 2 RSAs written to that intent. SKAGs are legacy, made mostly obsolete by close-variant
matching; reserve them for the top 3 to 5 revenue keywords. Theming test: could you write one headline
honestly relevant to every keyword in the group? If no, split.

### 2.4 Naming convention

There is **no rename tool** (section 6), so naming is a build-time decision changed only in the Ads UI. Use
a delimited scheme with fixed field order, for example `Search | NB | US-TX | Roof-Repair | SRCH | EXACT |
v1`. One delimiter used nowhere else (never a hyphen, because service names contain hyphens); fixed field
count, so a short name is a detectable error rather than a guess; brand flag in a fixed position
(BR/NB/COMP), the field you filter on most; ad groups name the theme, not the keyword list. **Match the
account's existing convention if it is consistent**, and record the choice in memory. Inheriting a mess is
not a mandate for a mass rename: it is UI-only, it breaks saved reports and rules, and it improves nothing.

### 2.5 The change-risk ladder (this sets how you confirm)

- **Tier 0, read-only** (every read tool in section 1): no confirmation.
- **Tier 1, inert creates** (`ppc_campaign_create`, `ppc_ad_group_create` under a paused campaign,
  `ppc_platform_ad_group_create`, all landing PAUSED or under a paused parent): one for the whole plan.
- **Tier 2, structure change with no immediate spend** (pausing a zero-spend zombie, re-theming): one
  confirmation for the batch, items enumerated by name.
- **Tier 3, spend-affecting** (`ppc_enable_resource` / `ppc_platform_enable_resource`, `ppc_pause_resource`
  on anything with volume, `ppc_bulk_edit` ENABLED ops, `ppc_recommendation_apply`): per change, one at a
  time. "With volume" means spend in the last 30 days or over ~100 impressions a week; zero impressions in
  90 days is tier 2.
- **Tier 4, account identity** (binding a customer_id after `ppc_ads_discover_customers`): explicit, with
  customer_id and account name read back.

### 2.6 Sequencing

`account_context_get({ domain: "ppc" })` plus `memory_list` -> read local `hiveku-data/ppc/*` ->
`ppc_change_history`, because you never propose a structural fix for what a human did on Tuesday -> propose
in writing with impact and risk tier per item -> confirm at that tier -> build paused, verify, enable ->
re-sync and re-read -> persist to PM task and memory.

---

## 3. The plays

### Play 1: Account topology map

1. `ppc_connection_list` (optional `{ platform: "google" | "meta" | "linkedin" | "microsoft" | "tiktok" }`):
   platform, status, campaign_count, name. **Status pending or campaign_count 0 is not connected**, whatever
   the name says. Two google_ads connections for one client usually means one stale duplicate.
2. `ppc_connection_get({ id })` per connection: `customer_id`, `manager_id`, currency, `settings`. In
   `settings`, `monthly_budget_target_cents` arms the daily guardrail sweep, `guardrail.alert_at_pct`
   (default 85) files inbox alerts, and `guardrail.pause_at_pct` is opt-in **auto-pause**. If it is set,
   say so: the account can pause itself without you.
3. `ppc_account_settings_get({ connection_id })` per Google connection: currency_code, time_zone,
   auto-tagging, conversion-tracking status and id, customer name, manager/test-account flags,
   tracking_url_template, final_url_suffix. Auto-tagging off means no gclid, breaking offline conversion
   import and most attribution (P1); test-account true means none of this is real spend; time_zone defines
   "yesterday"; currency never blends.
4. `ppc_linked_accounts_list({ connection_id })`: GA4 and Merchant Center. A dropped GA4 link is the usual
   cause of "imported conversions stopped"; a dropped Merchant Center link kills Shopping and Pmax feeds.
5. `ppc_campaign_list({ limit: 200, connection_id?, status?, platform?, page? })` into a table, then
   `ppc_ad_group_list({ campaign_id })` or `ppc_campaign_get({ id, include: "ad_groups,ads,metrics" })`
   for a one-call deep read.

A wrong customer_id, a test account, auto-tagging off, or a dead GA4 link each outrank every optimization
on the list. Persist the topology to memory.

### Play 2: Structure audit and scorecard

Run off the local files, with section 4 supplying the thresholds. Score **brand isolation**, since brand
terms in a broad generic campaign flatter its CPA and hide non-brand's real cost; **budget independence**,
where identical budget values suggest a shared budget whose change hits every campaign on it (flag Pmax or
Display sharing with Search too); **campaign count versus spend**; **ad group density** and **RSA
coverage** from `keywords.json` and `ads.json` grouped by ad_group_id, since keywords with no live ad spend
nothing and present as "the keywords stopped working"; and **naming consistency**, by splitting names on
the delimiter and counting field cardinality, where over ~20 percent unparseable means there is no
convention. Close with `pm_tasks_create`, scorecard in the body, one child task per accepted item.

### Play 3: Greenfield campaign build (Google)

Confirm the plan as a batch (tier 1), then:

1. `ppc_campaign_create({ connection_id, name, campaign_type, daily_budget, bidding_strategy?, target_cpa?, target_roas? })`.
   `campaign_type`: search | display | shopping | video | performance_max | discovery | demand_gen.
   `bidding_strategy`: manual_cpc | max_clicks | max_conversions | max_conversion_value | target_cpa |
   target_roas | target_impression_share, default manual_cpc, with `target_cpa` / `target_roas` required
   for their own strategies (roas is a ratio: 1.5 = 150 percent). **Always starts PAUSED**, with an inline
   non-shared budget, so a new campaign never joins someone else's pool. Greenfield means manual_cpc or
   max_clicks. Geo and language default to all targeted countries and this tool cannot refine them
   (section 6). Record the returned campaign id.
2. `ppc_ad_group_create({ connection_id, campaign_id, name, default_bid? })` per theme. **Ad groups start
   ENABLED**, safe only because the parent campaign is paused. `default_bid` is the CPC fallback for
   keywords without their own, ignored under smart bidding.
3. Ads and keywords: see the ads-assets-quality and keywords references. RSAs also create paused.
4. **Verify before enabling.** `ppc_campaign_get({ id, include: "ad_groups,ads" })` and read the whole tree
   back to the user.
5. Enable at tier 3, one confirmation each, **ads, then ad groups, then the campaign last**:
   `ppc_enable_resource({ connection_id, resource_type: "ad", resource_id, ad_group_id })`, then
   `resource_type: "ad_group"`, then `"campaign"`, which is the one switch that starts spend.
6. Re-sync and re-read to confirm the enabled state landed.

### Play 4: Restructures (splitting a campaign, re-theming an ad group)

**Splitting**, brand isolation being the common case: build parallel, then switch, never mutate in place.
Map the current state with `ppc_campaign_get({ id, include: "ad_groups,ads,metrics" })`; build the new
campaign(s) paused via Play 3, budgets sized from the extracted segment's trailing 30-day spend; **add the
extracted terms as negatives in the ORIGINAL campaign before enabling the new one**, or both compete for
the same queries for a week. Confirm, enable (tier 3), then watch 7 to 14 days before pausing anything in
the original. Once proven, pause the superseded ad groups with `ppc_bulk_edit`, recording the old ids so
the move is reversible. New budgets must sum to the old unless the client approved an increase.

**Re-theming**, triggered by low ad-relevance Quality Score or a failed one-honest-headline test: read
`ppc_ad_group_list({ campaign_id })` plus keyword rows from `keywords.json` grouped by ad_group_id and
cluster by intent, not string similarity ("roof repair cost" and "roof repair near me" are research vs
hire). `ppc_ad_group_create` one group per cluster named for the intent, add keywords and an RSA per group,
then pause the originating keywords in the old group. **There is no move operation**: re-theming is add-new
plus pause-old, on fresh Quality Score history. Expect a 1 to 2 week dip, and say so beforehand.

### Play 5: Bulk state hygiene (zombie sweep, "pause everything in X")

`ppc_bulk_edit({ connection_id, operations: [...] })` does multi-resource STATUS edits in ONE round-trip,
**max 100 operations per call**, with three op shapes:
`{ mutate_op: "campaign_status", campaign_id, status: "ENABLED" | "PAUSED" }`,
`{ mutate_op: "ad_group_status", ad_group_id, status }`, and
`{ mutate_op: "keyword_status", ad_group_id, criterion_id, status }`. Budget ops are **refused** with code
`budget_op_in_bulk_edit`; budgets go one campaign at a time through the step-capped path in
`references/bidding-budgets-pacing.md`.

Build candidates from the local files joined to `metrics_daily.json` using the section-4 zombie criteria.
**Enumerate to the user by name**: "pause 34 ad groups" is not a confirmation, 34 vetoable names is. Chunk
to at most 100 ops and read `applied` and `skipped_unknown` per chunk. **`skipped_unknown` > 0 means ids
did not resolve**, usually a stale mirror where the resource was removed or renamed upstream: re-sync and
re-derive rather than retrying. Then re-read `ppc_campaign_list` / `ppc_ad_group_list` to confirm.

Use it freely for PAUSED sweeps of dead resources (tier 2), almost never for ENABLED sweeps: bulk-enabling
is bulk-spending. Non-Google has no bulk equivalent: loop `ppc_platform_pause_resource` /
`ppc_platform_enable_resource` per resource, using each platform's resource_type vocabulary. google_ads and
microsoft_ads take campaign | ad_group | ad | keyword (the last two require `ad_group_id`); meta_ads
campaign | ad_set | ad; linkedin_ads campaign | campaign_group, no ad-level status in their API; tiktok_ads
campaign | adgroup | ad.

### Play 6: Change-history forensics

Run this BEFORE any diagnostic theory; it resolves a large share of mysteries outright.

1. `ppc_change_history({ connection_id, days: 30, limit: 2000 })`. Max 30 days back (Google API limit);
   defaults are days 7 and limit 200, so pass both explicitly.
2. Read `timestamp`, `user_email`, `client_type`, `resource_type`, the operation, and the affected campaign
   or ad group. A third-party `user_email` on an account you solely manage is a finding for the client
   report. `client_type` GOOGLE_ADS_UI means a human clicked and GOOGLE_ADS_API an integration, so API
   changes you did not make mean another automation is still running here.
3. Correlate timestamps against the daily metric series. A cost spike starting the same day as a bidding or
   budget row is explained; one that does not line up sends you to disapprovals and conversion tracking.
4. Google's auto-applied recommendations appear here too. If auto-apply is on, recommend turning it off.

Paste material rows into the PM task comment and **snapshot change history into the monthly report**,
because the API reaches only 30 days.

### Play 7: Recommendations triage (Google is a counterparty, not a colleague)

1. `ppc_recommendations_list({ connection_id, types?, limit? })`. Limit 1 to 500, default 100, sorted by
   absolute conversion delta. Filter with `types` to work one category at a time, for example
   `["KEYWORD", "KEYWORD_MATCH_TYPE"]` or `["BIDDING_STRATEGY", "TARGET_CPA_OPT_IN"]`.
2. Read type, scope, and the impact estimate, **cost delta first**: plus 40 clicks and plus 18 percent cost
   for plus 0.4 conversions is Google selling inventory.
3. Triage. **Structural, safe after review**: RESPONSIVE_SEARCH_AD, ad-strength and asset recs, disapproval
   fixes, redundant-keyword cleanup. **Review hard**: KEYWORD, KEYWORD_MATCH_TYPE, USE_BROAD_MATCH_KEYWORD
   and OPTIMIZE_AD_ROTATION all loosen targeting, so accept only when your search-term evidence agrees.
   **Client approval always**: CAMPAIGN_BUDGET, MOVE_UNUSED_BUDGET, TARGET_CPA_OPT_IN, BIDDING_STRATEGY,
   ENHANCED_CPC_OPT_IN.
4. Apply **one at a time**: `ppc_recommendation_apply({ connection_id, resource_name })`, which uses
   Google's defaults exactly like the UI Apply button, so you do not control the specifics. UI-only types
   return a structured 400 with a reason: surface it rather than retrying. Re-read with `ppc_campaign_get`
   afterwards to confirm the defaults did what you expected.

**Never loop `ppc_recommendation_apply` over the list.** Optimization Score is Google's metric for Google's
revenue, not a client KPI.

### Play 8: Binding, rebinding, MCC hygiene (tier 4)

`ppc_connection_get({ id })` for the current customer_id / manager_id, then
`ppc_ads_discover_customers({ id })` with no `manager_customer_id`, listing the customers the OAuth user
can log in as with name and `is_manager`. Agency users typically see MCC managers there, and **campaigns
never live on an MCC**, so never bind one as customer_id: pass `{ id, manager_customer_id }` to list the
ENABLED client accounts under it. The call needs a developer_token and returns 412 with a hint without
one. Binding is a connection update outside this tool set: follow `hiveku-data/ppc/SETUP.md`, using
customer_id = the client id and manager_id = the MCC id,
since manager_id rides as login-customer-id on every sync and omitting it makes syncs fail. Read the name
and customer_id back verbatim, get an explicit yes, then test, sync, and re-run Play 1.

---

## 4. Thresholds and benchmarks

Defaults. Account memory overrides them, always.

**Campaign level.** Under **15 conversions / 30 days** it cannot support smart bidding: consolidate or
accept manual bidding, and more than 3 such campaigns is a consolidation finding. Under **10 dollars/day**
on a competitive Search campaign it never exits learning. Sane count: roughly 1 campaign per 500 to 1,000
dollars of monthly search spend. Flag any **shared budget across more than 2 campaigns**, and **brand plus
non-brand in one campaign** at any spend.

**Ad group level.** Over **25 keywords** is theme-collapse risk; under **3 keywords and under 10
clicks/week** is over-split; **zero enabled ads with enabled keywords** is a P1 silent full stop; under
**2 RSAs** above roughly 500/month means no creative test is running.

**Zombie criteria (safe to bulk-pause).** Enabled campaign, 0 impressions in 30 days, no seasonal reason in
memory. Enabled ad group, 0 impressions in 30 days while the parent campaign is spending, so it is not a
budget issue. Enabled keyword, 0 impressions in 90 days.

**Recommendations and velocity.** Apply nothing projecting a cost delta over +10 percent of current
campaign spend without explicit sign-off; a healthy account sits at 70 to 85 percent Optimization Score.
At most one structural change per campaign per 14 days, and none during a learning phase (roughly 7 days
after a bidding switch).

---

## 5. Diagnosis

**"Campaign list is empty or missing campaigns."** Local staleness first (`hiveku-data/STATUS.json`
`failed[]`, `fetched_at`, `truncated`), since `truncated: true` is a page cap. Then check you did not filter
yourself out (`status: "active"` hides paused; `connection_id` scopes to one account). Then binding via
`ppc_connection_get` and Play 8, because an MCC bound as customer_id shows zero campaigns.

**"Numbers do not match the Ads UI."** Timezone from `ppc_account_settings_get`, then currency, then
mirror freshness, then date range (the UI usually excludes today).

**"A campaign is enabled but not serving."** In cost order: parent status (an enabled ad group under a
paused campaign serves nothing, and `ppc_campaign_get({ include: "ad_groups,ads" })` shows the whole chain
in one call), then zero enabled ads, then disapprovals, then budget exhausted, then bid too low, then
targeting too narrow for inventory.

**"An integration went dead."** `ppc_connection_list` status and campaign_count first: a working connection
now at status pending means the refresh token died, so re-auth per `hiveku-data/ppc/SETUP.md`. Then
`ppc_linked_accounts_list`, since a dropped GA4 or Merchant Center link explains vanished imported
conversions and dead Shopping feeds with nothing wrong in Ads. Then `ppc_account_settings_get` for
conversion-tracking status and auto-tagging.

**"A number will not move."** `ppc_change_history` first: confirm your changes landed and nobody reverted
them. Then confirm the change targeted the binding constraint, since a budget raise on a rank-limited
campaign changes nothing by design. Then check the campaign is not in learning, and that you are not
judging an ad-group change on account-level metrics.

---

## 6. Edge cases and failure modes

- **`ppc_campaign_create` always starts PAUSED; `ppc_ad_group_create` always starts ENABLED**, the ad group
  inheriting the campaign's paused state. On Microsoft, `ppc_platform_ad_group_create` starts PAUSED, so
  enabling is two calls, and its ownership check reads the LOCAL mirror, so sync before any Bing
  ad-group-scoped write. Backwards, you ship a dead build or an unintentionally live one.
- **No rename tool** for campaigns or ad groups. **No ad-schedule or network criteria tool.**
  **No keyword-move operation.** **No campaign-settings update** beyond budget and bidding strategy here.
  Geo, proximity, language and location-settings targeting DO have a tool: `ppc_google_targeting`
  (`references/google-ads-advanced.md`). There is no raw Google Ads mutate surface on this lane; for
  everything else, the Ads UI with exact steps for the client. Never pretend a capability exists.
- **No delete.** `ppc_pause_resource` and `ppc_bulk_edit` set status only; removal is a UI action. Both
  pause and enable require `ad_group_id` for resource_type "ad" or "keyword", the most common call error
  here. `ppc_bulk_edit`'s `operations` schema accepts a `daily_budget` field that is refused.
- **`ppc_recommendation_apply` uses Google's defaults**, not yours: you cannot set the target on a
  TARGET_CPA_OPT_IN rec through it. Decline and set the strategy explicitly through the bidding tools.
- **Protected and brand campaigns.** If `memory_list` or `account_context_get` names a campaign protected,
  you do not pause, re-theme, rebuild, or apply a recommendation scoped to it. Flag it and ask, even when
  the data says it underperforms: the client may be defending a trademark or a commitment invisible in the
  metrics. Approval thresholds apply too, since a restructure that alters total budget is a budget change.
- **Do not restructure and re-bid in the same week**, and **do not bulk-enable, ever, as a batch**: each
  enable is a spend decision.
- **Do not trust campaign_count as proof of health**: a stale cached count survives a dead refresh token.
  With two connections for one client, confirm which one the syncs populate before deleting either,
  because deletion cascades campaigns, ad groups, ads and metrics.

---

## 7. Persisting and reporting

**Memory.** After any structural session, `memory_list({ domain: "ppc" })` to find the existing PPC memory,
then `memory_update({ memory_id, content })` with its returned `content` plus your addition, because that
call REPLACES the document (or `memory_create({ type: "memory", name: "ppc", content })` if none exists). In 10 to
20 lines: connection inventory (UUID, platform, customer_id, manager_id, currency, timezone); the naming
convention with an example; protected campaigns by name and id and why; approval thresholds and who
approves; target CPA/ROAS per segment; structural decisions with rationale and a revisit date, because a
future session that does not know why will undo them; deferred debt with its trigger; and guardrails,
especially any `pause_at_pct`.

**PM tasks.** One task per structural initiative via `pm_tasks_create`, proposal in the body with a risk
tier per item. `pm_tasks_update` records each confirmation received and each write executed with returned
ids, so every change is reversible from the task alone. `pm_tasks_complete` only after the change is
re-read and verified post-sync, never on a 200 alone.

**Client reporting.** Structure work is invisible in a metrics table, so it needs its own narrative: what
the structure was; what changed, why, and what it should improve, in the client's language; the
`ppc_change_history` extract for the period, including changes by people outside the engagement, which is
proof of custody; and what was proposed and declined, with reasons. Name declined Google recommendations
explicitly ("we declined 6 of 9 because they projected 18 percent more spend for 3 percent more
conversions" is one of the most trust-building lines an agency can write). For net-new strategic
framing, route through `talk_to_department({ domain: "ppc", message })` for brand-hydrated output;
`get_account_info` supplies report-header identity; `hiveku_docs_search` / `hiveku_docs_get` confirm how a
Hiveku surface behaves before you tell a client it does; and `web_search`, `web_scrape`, `web_map`,
`web_crawl`, `web_extract` cover competitor structure the account cannot tell you.
