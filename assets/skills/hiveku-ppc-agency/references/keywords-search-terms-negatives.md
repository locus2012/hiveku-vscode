# Keywords, Match Types, Search Terms, Negatives, Forecasting

## What this covers / when to load this

The deep manual behind SKILL section 2 (search-term mining) and 4.5 (match-type migration). Load it when
you are changing what queries the account buys: the weekly mining loop, building or repairing a negative
architecture, choosing match types, promoting or pruning keywords, routing a query to the right ad group,
or forecasting before a launch. The SKILL gives the rhythm and the guardrails; this gives the judgment,
the tool chains, the thresholds that trigger action, and the failure modes that cost clients money.
Reading numbers for a report does not need this file; touching the query layer does.

## 0. Gates before you touch the query layer

1. **Local data first.** Read `hiveku-data/ppc/search_terms.json` and `hiveku-data/ppc/keywords.json`
   before any live call; if they synced inside 7 days, mine them and spend live calls only on writes.
   `ppc_search_terms_report` on a large account is a 140s API call, the local file is free. Refresh with
   the department-data pull (`/hiveku:pull`, Ads (PPC)), never by looping the report tool.
2. **`account_context_get({ domain: "ppc" })` before any strategy.** Query work is strategy: a negative
   on "free" is a mistake if the client runs a free-trial motion, and the avatars live in context.
3. **`memory_list` for the PPC record:** target CPA/ROAS, protected and brand campaigns, approval
   thresholds, do-not-block terms, competitor-bidding permissions, negatives ledger (section 8). Memory
   overrides every default in section 5.
4. **Scope.** Everything except the research fallbacks needs `connection_id` (from the connections read in
   `references/account-structure.md`). The Google ops family (`ppc_keyword_*`, `ppc_negative_keyword_*`,
   `ppc_search_terms_report`, `ppc_google_shared_negatives`, `ppc_keyword_planner_forecast`) is **Google
   Ads only** and returns a wrong-platform error, not an empty result, on any other connection. Bing
   writes go through `ppc_platform_keyword_add`, `ppc_platform_keyword_bid_update`,
   `ppc_platform_keyword_match_type_change` and `ppc_platform_negative_keyword_add`. Five tools take
   EITHER platform (the connection picks the lane, every number is that platform's own):
   `ppc_search_terms_mine`, `ppc_negatives_audit`, `ppc_negatives_lint`, `ppc_negatives_remove` and
   `ppc_keyword_ideas`.
5. **Consent lane.** Negatives and promotions are structure changes: batch the analysis, present it, take
   ONE confirmation, execute item by item. Bids are spend changes, one confirmation each. Anything
   touching a protected or brand campaign gets a callout even if it is "just a negative". Never
   bulk-apply, never write silently.
6. **Goals.** `ppc_goals_get` holds the target CPA (`target_cpa_cents`) and target cost per lead the cut
   rule in section 5 needs. The miner and the breakdown take `target_cpa` in currency UNITS: divide the
   cents by 100. No target recorded: ask once, record it with `ppc_goals_set`, never invent one.

## 1. Framework A: the search-term verdict

Every term with spend resolves to one of four verdicts. There is no fifth.

| Verdict | Signature | Action |
|---|---|---|
| PROMOTE | Converted at or below target CPA, not already an exact keyword | Add as keyword, usually exact |
| HARVEST-WATCH | Converted above target CPA, or 1 conversion on thin volume | Watchlist, promote if it repeats |
| BLEED | Spend, zero conversions, intent plausibly right | Cut on the cost rule, not on clicks |
| IRRELEVANT | Wrong intent entirely (jobs, salary, DIY, free, wrong product, wrong geo) | Negative now, ignore spend |

What separates an operator from a script: **BLEED is a threshold decision, IRRELEVANT is a judgment
decision.** Never wait for spend on an irrelevant term; never cut a relevant term on a hunch. Mixing
these over-negates the account into a slow death: the term list shrinks, volume drops, smart bidding
loses its exploration surface, and CPA rises three weeks later with no obvious cause. **The intent test:**
could a person typing this query, on their best day, become a customer of this business? Yes means BLEED
(apply the cost threshold), no means IRRELEVANT. Run it against the avatars from `account_context_get`.

## 2. Framework B: match-type portfolio doctrine

Match types are a **bid-priority and routing system**, not a targeting spectrum: phrase absorbed
broad-match-modifier, exact matches same-meaning close variants, broad is an ML surface keyed to the
whole account signal set.

- **Exact is for proven demand.** A term earns exact after it converts, or after forecast plus competitor
  evidence says it is a core money query. Cleanest CPA control and attribution.
- **Phrase is the workhorse:** researched keywords whose variants you want but whose category you do not
  want to leave. Default new non-brand keywords to phrase, not broad.
- **Broad is a discovery instrument under three simultaneous conditions:** conversion-based smart bidding,
  verified healthy conversion tracking, and a mature negative architecture already in place. Two of three
  is not enough. Broad on manual CPC with no negative lists is a spend leak with a research excuse.
- **Brand: exact and phrase only.** Broad on brand lets Google spend brand budget on category queries at
  brand's lower CPA target, laundering non-brand waste into the brand campaign's numbers.

**The tiered-intent structure** (needs volume): one campaign holds exact proven terms at the aggressive
bid, a second holds phrase on the same themes at a lower bid, and each exact text becomes a
**campaign-level exact negative on the phrase campaign**, forcing exact-matching traffic into the exact
campaign. This is the only legitimate use of a negative to route rather than block, and it must be
documented in memory or a cleanup collapses it.

## 3. Framework C: negative-keyword architecture

Four tiers. Placing a negative at the wrong tier is the most common self-inflicted wound in an inherited
account.

- **Tier 1, account-wide junk** in a `ppc_google_shared_negatives` set attached to every search
  campaign: jobs, salary, career, hiring, free, diy, how to make, torrent, crack, wikipedia, reddit
  (verify per account), plus compliance blocks. One edit propagates everywhere, the point and the danger.
- **Tier 2, campaign theme fences** via `ppc_negative_keyword_add({ campaign_id })`: legitimate for the
  account, wrong for this campaign. Exact terms kept out of the phrase campaign, service lines this
  campaign does not sell, non-brand kept out of brand.
- **Tier 3, ad-group routing** via `ppc_negative_keyword_add({ ad_group_id })`: cannibalization control.
- **Tier 4, one-off exact blocks** at the narrowest scope. These accumulate; prune the noise annually.

**Negative match type is a separate decision from tier.** Exact for a specific query you are killing,
phrase for a recurring pattern where word order matters ("free trial", "jobs near me"). Broad blocks any
query containing all those words **in any order**, so use it only for single-word junk: a broad negative
"free shipping" blocks "shipping options for our free consultation".

**The default is broad, and that is a trap.** `ppc_negative_keyword_add` defaults `match_type` to
`'broad'`; `ppc_google_shared_negatives` `shared-set-keywords-add` defaults to `'phrase'`. Pass
`match_type` explicitly on every call in both tools so a schema default never decides what your client
stops buying. (`ppc_platform_negative_keyword_add` requires it, so Bing cannot bite you this way.)

**The blast-radius test, before every negative, is `ppc_negatives_lint`.** Does this negative, at this
match type and reach, block an ENABLED keyword, a search term that converted, a place a campaign
targets, or a protected term from memory (`params.protected_terms`)? Does it duplicate one already
there, or would the platform reject it? **A negative always beats a positive keyword.** Add only
items whose verdict is `clear`; for a `conflicts` item narrow the match type or move it down a tier
and lint again. Lint is a FLOOR (Hiveku's implementation of each platform's matching), and on
Microsoft a `pending` search-terms check means lint again in a minute.

## 4. The plays

### Play 1: The weekly search-terms mining loop

0. **Where the waste sits, first:** `ppc_search_terms_mine({ connection_id, params: { days: 28,
   protected_terms, target_cpa } })`, Google or Microsoft. It aggregates every visible term into
   1-3 word n-grams, match sources and triggering keywords. Read `verdict.kind` before anything:
   `long_tail` (most waste in 1-2-click terms) is a match-type or AI-expansion problem, so fix
   structure and do not pile on negatives; `concentrated` is a negatives job; `no_conversions_measured`
   stops the loop until tracking is fixed. `coverage.unseen_cost` is Google spend no visible term
   carries and no negative reaches: state it before sizing the waste. On Microsoft `status: 'pending'`
   means call again in about 30 s with `params.resume_token`, re-sending `protected_terms`,
   `target_cpa` and the other non-scope params. Its `candidates[]` come back as `lint_handoff`; they are
   never added by the miner.
1. Row-level evidence: prefer `hiveku-data/ppc/search_terms.json`. If stale:
   `ppc_search_terms_report({ connection_id, days: 28 })`. Use `days: 28` for the weekly loop
   (whole weeks, no weekday skew), 7 for a launch or anomaly chase, 90 for a quarterly rebuild or a
   seasonal vertical. On a big account call `summary_only: true` first, then pull FILTERED pages of
   `limit` 200 or less (`campaign_id`, `ad_group_id`, `min_spend`, `zero_conversions_only`), paging with
   `offset = next_offset`; `truncated` / `output_trimmed` mean more rows follow, never "that is all".
2. **Read out per row:** query, matched keyword, match type, ad group, campaign, cost, clicks,
   impressions, conversions, CTR, avg CPC. Compute the two things the report omits: CPA on converting
   rows, and cost as a multiple of target CPA on zero-conversion rows. That multiple drives every cut.
3. **Sort by cost descending and work top-down**: waste recovered tracks spend, not row count, and the
   bottom 60% of rows by cost is usually under 5% of spend. Classify each with framework A.
4. **Group negatives before writing them.** Find the pattern, not the instance: twelve queries containing
   "salary" is one phrase negative, not twelve exacts. A list of 400 one-off exacts is unmaintainable.
5. **Lint, then present the batch and take one confirmation.** Pass the miner's `lint_handoff.params`
   (or your own grouped list, Editor notation `"phrase"` / `[exact]`, with the reach you intend) to
   `ppc_negatives_lint`; drop or rework everything not `clear`. Then present: negatives grouped by tier
   and match type with the spend each recovers and the lint verdict, promotions with conversion
   history, the carried watchlist, total spend redirected.
6. **Execute.** Account-level junk on Google can go to the one account-level list with
   `ppc_google_account_negatives_add` (preview-first; it reaches Performance Max and AI Max too, and
   holds back conflicting terms unless told otherwise). Tier 1 goes through `ppc_google_shared_negatives({ connection_id, operation:
   'shared-set-keywords-add', params: { shared_set_resource_name, keywords: [...], match_type: 'phrase' }
   })`, max 200 keywords per call at 80 chars each, **effective immediately on every attached campaign**.
   Tiers 2-4 go through `ppc_negative_keyword_add({ connection_id, text, match_type, campaign_id })` or
   `({ ..., ad_group_id })` with **exactly one** of the two; do not pre-format `text` with quotes or
   brackets, `match_type` controls that. **Capture every returned `resource_name`**, the only undo handle
   for `ppc_negative_keyword_remove({ connection_id, resource_name })`.
7. Promotions per Play 3, then log per section 8.

### Play 2: Building a negative architecture (inherited account)

1. `ppc_negatives_audit({ connection_id })` (`params.summary_only: true` first on a big account):
   every negative at every level (campaign, ad group, shared list, Google's account-level list, brand
   lists), list hygiene (`empty`, `orphaned` - attached to nothing, so it blocks nothing), and the
   CONFLICTS ranked: `blocks_keyword`, `blocks_converting_term`, `blocks_geo` (a broad or phrase
   'georgia' blocks every search naming Georgia), `blocks_protected_term` (pass never-negate terms from
   memory in `params.protected_terms`). Works on Microsoft too (its keyword conflicts come from
   Microsoft's own conflict report). `coverage` decides whether it is complete: a `pending` report or
   `conflicts_complete: false` is partial, not clean. `ppc_google_shared_negatives` `shared-sets-list`
   (`params.shared_set_id`) still reads one Google list's members page by page.
2. `ppc_search_terms_mine({ connection_id, params: { days: 90 } })` for the full waste picture.
3. Fix the self-blocking ones first: `ppc_negatives_remove({ connection_id, params: { remove_handles } })`
   with the `remove_handle`s from the audit. It WIDENS reach immediately (and a list detach reopens
   every member at once), so the preview's `plan[]` goes to the owner with what reopens, the yes is
   explicit, and only then the SAME call with `confirm: true` and `params.expected_preview_hash`.
   Only a complete preview carries a hash: remove fewer handles if it has none.
4. Build Tier 1 with `ppc_google_shared_negatives`: `operation: 'shared-set-create', params: { name }` (255 chars max, creates an **empty**
   list that blocks nothing), then `shared-set-keywords-add` in batches of 200, then `shared-set-attach`
   with `params: { campaign_id, shared_set_resource_name }` per campaign. Attach is immediate: confirm
   the campaign list first, and exclude brand campaigns unless you have checked the words against brand
   queries. `shared-set-detach` takes `params.campaign_shared_set_resource_name`, and direction matters:
   detach **widens** reach and blocked queries start spending again, so treat it as a spend change.

Google-side limits: ~20 shared lists per account, 5,000 per list, ~10,000 negatives per campaign.

### Play 3: Promoting a converting search term

1. Confirm it is not already a keyword: `ppc_keyword_list({ connection_id, days: 30, limit: 2000 })` or
   local `keywords.json`. A term can appear in the search-terms report while already existing as a
   keyword in another ad group.
2. Choose the ad group by **intent theme, not convenience**. If no existing group's ads would honestly
   answer this query, the right move is a new themed ad group (`references/account-structure.md`); a
   keyword in a mismatched group starts with low ad relevance and never recovers. Match type per
   framework B: 2+ conversions on the exact text means exact, a converting family means phrase.
3. `ppc_keyword_add({ connection_id, ad_group_id, text, match_type, cpc_bid? })`. Omit `cpc_bid` to
   inherit the ad-group default (correct under smart bidding); under manual or enhanced CPC, seed near
   the term's observed avg CPC from the report. **Capture the returned `criterion_id` and
   `resource_name`** for later bid or match-type work.
4. Bing parity: `ppc_platform_keyword_add({ connection_id, ad_group_id, text, match_type, bid? })`, where
   `match_type` is **required**, unlike the Google tool.

### Play 4: Match-type migration

**Tightening.** Trigger: search-terms rows scattered and off-theme AND 30-day cost at or above 2x target
CPA with zero conversions, or conversion rate under half the ad group average. Then
`ppc_keyword_match_type_change({ connection_id, criterion_id, ad_group_id, new_match_type,
preserve_bid: true })`.

**What it actually does:** Google cannot mutate match type in place, so this **removes the criterion and
creates a new one**, returning the OLD resource_name (removed) and the NEW one. State the costs first:
QS history resets, so expect a QS dip and CPC bump for roughly 2 weeks; criterion-level conversion
history is gone, which can destabilize smart bidding on a low-volume ad group; anything keyed to the old
resource_name breaks. Therefore **tighten reactively, never preemptively**, and never run an account-wide
broad-to-phrase sweep, which resets your winners' history along with your losers'.

**Loosening a starved exact** (strong conversion rate, impression-limited over 3 weeks, lost IS to rank
not the cause): add the phrase version as a **new** keyword rather than converting the exact one, so you
keep the exact keyword's history and can compare them.

**Bing:** `ppc_platform_keyword_match_type_change({ connection_id, keyword_id, ad_group_id, match_type })`.
`ad_group_id` is REQUIRED (Microsoft addresses a keyword through its ad group): both ids come from the
keyword's row in `ppc_bing_keyword_performance` (`keyword_id`, `platform_ad_group_id`). Microsoft edits
match type IN PLACE (its docs list Keyword.MatchType as "Update: Optional"; live-validated 2026-07-17),
so the keyword keeps its id. Only if the call fails with a Microsoft PartialError, fall back to adding
the new keyword and pausing the old one.

### Play 5: Prune sweep and cannibalization (monthly)

`ppc_keyword_list({ connection_id, days: 90, limit: 5000 })`, ninety days because pruning on 30 kills
seasonal and long-cycle keywords. **Zero impressions in 90 days** is dead weight and removal is optional,
but never prune a brand-protective or competitor-defensive term just because it is quiet. **Impressions
but no clicks** is a relevance problem, so send it to QS triage (SKILL section 4) before deleting.
**Clicks with cost at or above 3x target CPA and zero conversions** is the real prune list: pause rather
than delete on the first pass so history survives and the move reverses.

Cannibalization shows as one query matched by different keywords in different ad groups at visibly
different CPA. Pick the winner by conversion rate, then CPA, then ad relevance, and force the routing
with `ppc_negative_keyword_add({ connection_id, text: <query>, match_type: 'exact',
ad_group_id: <loser> })`, one per losing group. **Do not delete the losing keyword**, which may serve
other queries: negate the query, keep the keyword, log it as a ROUTING negative.

### Play 6: Forecasting before a build or a budget ask

`ppc_keyword_planner_forecast({ connection_id, keywords: [...], bid_micros, daily_budget, language_id,
geo_target_ids })`. `bid_micros` is micros, so 2000000 equals $2.00, and getting this wrong by a factor of
a million is the most common error with this tool. `language_id` defaults to 1000 (English).
`geo_target_ids` are geo constants: 2840 US, 2826 UK, 2124 Canada. **Always pass the real geo**, because
a national forecast for a three-county service area gets quoted back at you. **Forecast the match types
you will launch** (`match_type`, default broad, or `keyword_specs` `[{ text, match_type }]`): a broad
forecast overstates an exact or phrase plan. Lead-gen: `bidding_strategy: 'maximize_conversions'` with
`daily_budget` and never `bid_micros`. Read every output as order-of-magnitude only: Planner runs
optimistic on clicks and low on CPC for competitive terms.

**Microsoft twin:** `ppc_bing_keyword_traffic_estimates({ connection_id, keywords | keyword_specs,
max_cpc_bids, location_ids })` - one call estimates 1-3 bids (e.g. the idea's `suggested_bid` at 0.7x,
1x and 1.4x). **Its numbers are PER WEEK:** size a daily budget from `cost_per_day` (weekly cost / 7),
never from the weekly cost. Without `location_ids` it covers the whole United States: pass the service
area.

**How a senior operator uses it:** run it three times at roughly 0.7x, 1.0x and 1.4x expected market CPC
and read the **shape** of the curve, not the point estimate. Where clicks stop rising as bid rises is the
ceiling of available demand, the real answer to "how much can we spend here". Then check forecast CPA
against target: if Planner's own CPA already exceeds target at your bid, the keyword set does not work
and no optimization saves it. Some MCCs have Planner API access disabled and the response says so; the
fallback is the dashboard's Keyword Planner (no tool) plus `web_search` and `web_scrape`, labelled
directional and UI-sourced.

### Play 7: Net-new keyword discovery

**The ideas generator is `ppc_keyword_ideas`**, on Google or Microsoft (the connection picks, every
number is that platform's own). `mode: 'ideas'` (default) expands seed `keywords` and/or a `seed_url`
into ideas with volume, monthly history, competition and bids; multi-word seeds are fine;
`mode: 'metrics'` measures exactly the keywords you give and lists any the platform did not return in
`not_returned`. **Location is per platform and never optional in practice:** Google `geo_target_ids`
(from `ppc_google_targeting` 'geo-target-search') and `language_id`; Microsoft `location_ids` (from
`ppc_bing_location_search`), `language`, and `exclude_account_keywords`. Without a location both
default to the whole United States and say so in `warnings` - a national number for a local client.
Page with `limit` / `offset` (`next_offset`). Google allows about 1 Planner request per second per
account: on RESOURCE_EXHAUSTED wait and call again. Then size the survivors with the forecast in Play 6.
It replaces the raw read lane's `keyword-ideas` action (`ppc_google_ads_read`, English only, no
location, single-token seeds). The DataForSEO lane (visible to marketing keys - profiles.ts grants it to marketing-ads)
carries `keywords_data_google_ads_search_volume`, `dataforseo_labs_google_keyword_ideas` and
`dataforseo_labs_google_keyword_suggestions`; these are registry-verified names with no local manual -
read each tool's own schema before the first call and label output with its source.
Fallbacks, best first: (1) the account's own search terms, since your best ideas are queries that already
converted, so mine `ppc_search_terms_report` at `days: 90` for PROMOTE rows; (2) the site's own language,
via `web_map` for URL inventory then `web_scrape` or `web_extract` on service pages; (3) competitor
language, via `web_search` on the category then `web_scrape` and `web_extract` on the top competitors'
pages, which also builds the competitor list for Play 8; (4) organic data if SEO is connected, since the
`hiveku-seo-agency` keyword tools hold volume and SERP data PPC lacks; (5)
`talk_to_department({ domain: "ppc", message })` for brand-hydrated expansion of a seed list. Score what
you gather with `ppc_keyword_ideas` `mode: 'metrics'` and the Play 6 forecast, and write only survivors
with `ppc_keyword_add` (Microsoft: `ppc_platform_keyword_add`). Never
launch a list that came only from step 5: generated lists are fluent and frequently contain terms with no
commercial intent and no volume.

### Play 8: Brand and competitor query control

From `ppc_search_terms_report`, separate brand queries (brand token plus common misspellings) from
non-brand. Brand queries in non-brand campaigns means that campaign is harvesting cheap conversions and
flattering its own CPA; fix it with campaign-level phrase negatives on the brand token in every non-brand
campaign, `ppc_negative_keyword_add({ connection_id, text: <brand>, match_type: 'phrase', campaign_id })`.
**Do this before evaluating any non-brand campaign**, or every number you report is wrong. For competitor
terms, check memory and `account_context_get` for whether competitor bidding is permitted, since some
clients have contractual prohibitions; if prohibited, competitor names go into the Tier 1 shared list as
phrase negatives and you say so in the report. **Never add the client's own brand as a negative** without
explicit written confirmation: it destroys the account's cheapest conversions, and it is easy to do by
accident when the brand name is also a common word.

## 5. Thresholds and benchmarks (defaults; memory overrides)

**Cutting a term (zero conversions).** Cost at or above 1x target CPA, negative it now. 0.5x to 1x,
watchlist and cut next cycle if still zero. Below 0.3x, noise, leave it, because cutting here produces
churn not savings. Clicks alone never justify a cut, and irrelevant intent cuts at any spend.

**Promoting.** 2+ conversions at or below target CPA in 30 days promotes to exact. 1 conversion well
below target with 3+ clicks goes on the watchlist and promotes on the second. A converting family (5+
related queries, 3+ conversions) promotes as the phrase stem.

**Mining cadence.** Weekly over $10k/month, biweekly under, daily for the first 14 days of a new campaign
or broad-match rollout: a fresh broad campaign wastes more in week one than a mature account does in a
quarter. Judge no keyword before 100 clicks or 30 days; under 20 clicks, any difference is chance.

**Negative hygiene.** More than 30 new negatives in a weekly pass on a mature account means something
upstream broke (match type loosened, a Google recommendation applied, budget jumped): find the cause, do
not just add 30. Past ~500 negatives on one campaign you are negating instance-by-instance instead of by
pattern.

## 6. Diagnosis: when the data looks wrong

**Report returns fewer rows than expected, or is empty.** Google withholds low-volume and
privacy-thresholded queries, so a real share of spend never appears; that is why search-terms cost never
reconciles to campaign cost, and why you must never present the report total as the campaign's spend.
Then check `days` (a window before the connection existed returns nothing) and `limit` (the default 1000
truncates large accounts silently). Empty on a campaign that clearly spent usually means campaign type:
Display, Video and Performance Max do not populate search_term_view the way Search does. Local files are
only as fresh as the last sync, and the tools use complete days while the Google UI includes today.

**A keyword or a state went quiet after a negatives cleanup, or never served.** `ppc_negatives_audit`
first: a `blocks_keyword` or `blocks_geo` conflict is a negative silently beating your own keyword or
targeted place (one audited account had seven).

**A negative was added but the query still shows.** In order: wrong scope, so another ad group serves it;
the match type is narrower than you think, and an exact negative blocks only that exact query; the shared
list is not attached to that campaign, verify with `shared-sets-list` and read the attached-campaigns
field; or reporting lag, where the row predates your write.

**A new keyword shows zero impressions.** In order: ad group or campaign paused; a negative at any tier
blocks it (the blast-radius failure); bid far below first-page estimate under manual bidding; duplicate
of a higher-Ad-Rank keyword in another group; or no eligible ad in the group, since a disapproved or
paused-only group serves nothing regardless of keywords.

**Conversions look wrong on a term.** Stop. Query decisions are downstream of conversion tracking: if
tracking is broken every PROMOTE and BLEED verdict is noise, and negatives added on bad data are
permanent damage. Verify tracking, then resume.

## 7. Edge cases and failure modes

**Every level is readable now.** `ppc_keyword_list` excludes negatives, but `ppc_negatives_audit`
enumerates campaign, ad-group, shared-list, account-level and brand-list negatives on Google, and
campaign, ad-group and shared-list negatives on Microsoft, each with the `remove_handle` the remove
tool takes. What stays honest: its conflict matching is a FLOOR on Google (Hiveku's implementation of
negative matching), the Microsoft geo check is not available yet (`coverage.geo.available: false`),
and a partial `coverage` is never a clean audit. **Keep your own ledger** (section 8) anyway: the
reason a negative exists lives nowhere else.

**Never:**

- **Loop `ppc_negative_keyword_add` over a report without confirmation on the batch**, or touch a
  protected or brand campaign flagged in memory, or add a negative `ppc_negatives_lint` did not mark
  `clear`. Reversing is `ppc_negatives_remove` (up to 100 handles per call, previewed, read back), and
  it widens reach, so it is its own confirmed change.
- **Add a broad multi-word negative.** Use phrase. Word-order-free blast radius is the top cause of
  accidental traffic collapse.
- **Treat `ppc_keyword_bid_update` as effective under smart bidding.** The bid is recorded and ignored
  for ranking, and the response says so; confirm the strategy first, because reporting ignored bids as
  optimization is a fabricated deliverable. On Bing, `ppc_platform_keyword_bid_update({ connection_id,
  keyword_id, ad_group_id, bid })` says NOTHING about smart bidding in its response, so read the
  campaign's `bidding_strategy` with `ppc_campaign_get` before a Bing keyword bid change.

**Subtle traps.** **Exact is not exact**: close variants match plurals, misspellings, reorderings and
paraphrases, so check the report for what your exact keywords really match. **Tiered structures are
symmetric**: forget the matching exact negative on the phrase campaign and the two campaigns bid against
each other while you pay yourself a premium. **Post-negative CPA rise** is real, because heavy negation
shrinks the exploration surface smart bidding needs, so if CPA climbs 2-3 weeks after a large negative
batch, suspect the negatives and reverse the least-confident ones from the ledger.

## 8. Persistence and reporting

**Memory.** After every mining cycle, `memory_list({ domain: "ppc" })` then `memory_update({ memory_id,
content })` the PPC record with the returned body plus your addition, since that call REPLACES it and a
bare delta wipes the ledger (or `memory_create({ type:
"memory", name: "ppc", content })` if none exists). Hold: target CPA/ROAS and when it was set; the
negatives ledger (text, match type, scope, `resource_name`, reason code JUNK / THEME / ROUTING / ONE-OFF,
date, routing negatives marked so a cleanup does not remove them); the match-type doctrine in force;
protected campaigns, do-not-block terms, competitor-bidding permissions; and the watchlist with expiry
dates.

**PM tasks.** One per mining cycle: `pm_tasks_create` titled with the week and connection, then record
in comments the batch presented, the confirmation received and from whom, the writes executed with their
resource_names, the spend redirected, and the watchlist. `pm_tasks_update` in flight,
`pm_tasks_complete` at close. Chat does not survive the session; comments do.

**Client reporting.** Report the query layer in money, not counts. "We added 23 negatives" says nothing;
"we stopped $1,840/month on job-seeker and DIY queries and moved it into the four service terms
converting at $61 against a $95 target" does. Always include spend redirected, terms promoted with their
proven CPA, the watchlist and when it resolves, and any finding you flagged but did not act on because it
touched a protected campaign or exceeded the approval threshold.

**Cross-references.** `account-structure.md`, `bidding-budgets-pacing.md`, `ads-assets-quality.md`,
`measurement-and-conversions.md` (conversion tracking, the gate on all of this), and
`paid-social-and-bing.md` for Bing reads, since Bing keywords are not mirrored locally. Unsure of a
schema: `hiveku_docs_search` then `hiveku_docs_get`.
