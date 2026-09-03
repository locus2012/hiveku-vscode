# Ads, Assets and Quality: RSAs, extensions, ad strength, disapprovals, auction insights

## What this covers / when to load this

Everything between the query and the click: responsive search ads, the asset (extension) layer around them,
the ad-strength grade, the policy system that silently switches ads off, and the two competitive readouts
(impression share, auction insights) that say whether a weak result is a creative, bid, budget or rival
problem. Load it for creative audits, shipping RSAs, running an ad test, building a sitelink/callout/
snippet stack, remediating disapprovals, raising ad strength, or answering "why are we losing to this
competitor." Keywords, bids and budgets, audiences and measurement are separate references; SKILL.md
section 0 (context first, confirm every spend-affecting write, fresh data or no data, PM tasks) is in
force here.

---

## 1. The mental model

**An RSA is an inventory of parts, not an ad.** Up to 15 headlines (30 chars) and 4 descriptions (90
chars); Google assembles 2 to 3 headlines and 1 to 2 descriptions per auction, so the set must read well in
every combination and duplicated or contradictory lines tax a fraction of every impression. Headlines 1 and
2 nearly always serve, headline 3 sometimes and truncated, description 2 often not at all, so anything
legally required or offer-critical living only there is frequently absent. That is the argument for
pinning.

**Ad strength is a coverage meter, not a quality score.** It grades variety and keyword overlap in your
inputs, is computed before a single impression serves, and does not feed the auction: Quality Score does
that. Poor is a build defect, Excellent optional.

**Assets are free CTR.** Sitelinks, callouts and structured snippets cost nothing and lift CTR roughly 10
to 20 percent on a top-position ad: the best first hour on an inherited account.

**Policy is a silent kill switch.** A disapproved ad does not warn you and does not spend; it stops being
eligible, and the group serves nothing if it was the only ad. Disapprovals are therefore the first check on
an unexplained volume cliff, before change history and tracking.

**Read local first.** `/hiveku:pull ppc` writes `hiveku-data/ppc/` (`ads.json`, `disapprovals.json`,
`campaigns.json`, `ad_groups.json`, `metrics_daily.json`); a creative audit needs the first two and no live
calls. Check `fetched_at`; `truncated: true` means `count` is a floor; an `error` with empty `rows` means
NOT RETRIEVED, never "none exist," and must never reach a client as "you have no disapprovals."

**Google-only versus portable.** Every creative, asset, disapproval and competitive tool here is Google Ads
only and errors on a non-Google connection_id, so the mistake fails loudly; `ppc_ad_list` is the cached
cross-platform read.

---

## 2. Gates before you touch creative

1. `account_context_get({ domain: "ppc" })` for brand voice, persona, prohibited claims and regulated
   language. In health, legal, finance, housing and employment it carries the phrases legal cleared and the
   ones that trigger disapproval; skipping it earns a misrepresentation strike.
2. `memory_list`, then the `ppc` memory: protected or brand campaigns you must not touch, the approval
   threshold, target CPA/ROAS, previously disapproved copy, cleared or rejected offer claims, and the
   asset resource_names created before (section 8: your only registry).
3. `get_account_info` for legal business name, live phone and canonical domain before writing callouts or
   call assets. Never invent a phone number for an ad.
4. If `hiveku-data/ppc/` is over roughly 24 hours old, sync per SKILL.md 0.3 before quoting an ad-level
   number.

---

## 3. Decision frameworks

### 3.1 Framework A: is this a creative problem at all?

`ppc_impression_share({ connection_id, days: 30 })`, per campaign. Read `search_impression_share`,
`search_lost_is_budget`, `search_lost_is_rank`, top and absolute-top share.

- **Lost to budget dominant** (roughly 20 points or more): a money decision, bidding reference. New ads
  change nothing when you already turn away demand you cannot afford.
- **Lost to rank, CTR healthy**: outbid, or the landing page drags quality. Bidding reference.
- **Lost to rank, CTR weak**: yours; expected CTR is what headlines and assets move.
- **High impression share, low CTR**: pure creative and asset problem, the cleanest mandate you will get.
- **High CTR, weak conversion rate**: the ad writes a cheque the page does not cash. A final-URL and
  message-match problem (Play 1 step 4); better headlines buy more of the same.

### 3.2 Framework B: ad strength triage

Grades run Incomplete, Poor, Average, Good, Excellent; judge against spend. Incomplete or Poor with any
spend: fix this week. Average above 1x monthly target CPA in spend: queue for the next sprint, below that
leave it. Good is the ship bar; above it, test for performance instead of touching the grade, and never
trade message discipline for the badge.

Diagnose the deficiency, do not add filler. Under 8 headlines: add distinct angles, not synonyms.
Redundant headlines: give each one a job (keyword mirror, benefit, proof, offer, CTA, objection handler,
differentiator, urgency). No keyword in any headline: add two carrying it verbatim, the highest-weight
single input and an ad-relevance lift too. Heavy pinning: unpin what Framework C does not compel. Under 4
descriptions: add them. Ship the fix as a replacement RSA (Play 2) beside the incumbent and test it
(Play 3).

### 3.3 Framework C: pinning doctrine

Pin only when compelled: legally required disclosure, regulated qualifier, brand name in a brand campaign,
franchise or location name, a price or term that is wrong without context. Never pin for aesthetics; that
is the whole failure mode. **Pin in pairs or triples, never singly**: to own headline 1, pin two or three
headlines to position 1 so Google still chooses within the slot. A lone pin collapses that slot, is the
harshest ad-strength penalty there is, and cuts the combination space by an order of magnitude.

### 3.4 Framework D: the ad-group RSA portfolio

Google permits up to 3 enabled RSAs per ad group. **1** is acceptable under roughly 100 clicks a month but
is a single point of failure: one disapproval and the group goes dark. **2** is the working default,
control plus challenger. **3** triples time to significance, so only above roughly 1,000 clicks a month. A
disapproved ad is not a spare. Vary the challenger on ONE axis: value proposition, proof type
(social proof vs credential vs guarantee), CTA (quote vs book vs call), or offer framing.

### 3.5 Framework E: asset hierarchy and attach level

Assets live at account, campaign and ad-group level and **the most specific level wins outright**: an
ad-group sitelink set overrides the campaign set, which overrides the account set. No blending, and this is
the detail people get wrong. Rule for `ppc_asset_attach`: **account** for what is true everywhere (trust
callouts, the primary snippet); **campaign** as the default (service-line sitelinks, offer callouts, geo
claims); **ad group** only when intent is narrower and destinations better matched, because a two-sitelink
ad-group attachment replaces a four-sitelink campaign set and shrinks the ad. Complete sets only.

### 3.6 Framework F: disapproval severity ladder

Triage top down, never as one "fix the disapprovals" task; within a tier, by 30-day spend.

1. **Account suspension or account-level flag.** Everything is off. Stop other work, notify the client
   within the hour, go to the Ads UI Policy Manager; no tool remediates this.
2. **Destination or site-wide issue** (malware, landing page down): a web-team task; pause the ads
   pointing there meanwhile so you stop paying for failed auctions.
3. **Ad disapproved, other enabled ads present.** Contained; fix this week.
4. **Ad disapproved, only ad in the group.** The group is dark. Fix today: a revenue outage disguised as
   housekeeping.
5. **Eligible (limited).** Serves but restricted (geography, uncertified vertical); silently caps volume
   and explains impression-share mysteries no bid change fixes.
6. **Asset disapproved** while the ad is fine. Low urgency, but it can drop you under a render minimum.

### 3.7 Framework G: reading auction insights like an operator

Per competing domain you get impression share, overlap rate, position above rate, top of page rate, abs top
of page rate, outranking share. Classify:

- **High overlap, they outrank you**: a rival bidding harder or with better quality on core terms. A
  strategy conversation, not a tactic.
- **High overlap, you outrank them**: you are winning. Do not escalate an auction you lead; it inflates
  CPCs for the whole vertical, yours too.
- **New domain, overlap rising month over month**: a new entrant, and the finding that explains rising
  CPCs the client will otherwise blame on you.
- **Aggregators and marketplaces on top**: unwinnable on head terms. Pivot to long-tail intent and brand
  defence.

Auction insights is context, not a trigger: nothing in it moves a bid.

---

## 4. The plays

### Play 1: Creative audit of an inherited account

1. Read `hiveku-data/ppc/ads.json`, `ad_groups.json`, `campaigns.json` (refresh per SKILL.md 0.3 if stale).
   Live fallback `ppc_ad_list({ connection_id, limit: 500 })`, filtered by campaign or ad group.
2. Four counts: ad groups with **zero enabled ads** (dark, urgent), **one** RSA (fragile), **legacy
   expanded text ads** (dead format, removal is housekeeping not a performance action), **3 enabled RSAs**
   (over-split). Per ad capture headline and description count, ad strength if returned, final URL and
   status; under 8 headlines or 3 descriptions is under-built.
3. `ppc_disapprovals_list({ connection_id })`, joined to step 2 and triaged by Framework F, then
   `ppc_impression_share({ connection_id, days: 30 })` for whether creative is even the binding constraint
   (Framework A). Both before promising anyone a creative fix.
4. Message match: `web_scrape` or `web_extract` a sample of the distinct final URLs (`web_map` first on a
   large site to find the page that should have been the destination). Do they resolve, do they redirect
   into a homepage, does the page echo the ad's headline and offer, is the CTA the promised one, is the
   form above the fold. Fix by repointing the ad (new RSA, corrected final_url) or a web-team task, not
   with budget.
5. `pm_tasks_create` ("PPC creative and asset audit YYYY-MM") with findings ranked by ad-group spend and a
   sequence. Fix nothing during the audit: present, get approval, then execute.

### Play 2: Ship a new RSA

1. Gates from section 2, then pull the ad group's keyword theme so headlines mirror real query language.
   For net-new copy at volume, `talk_to_department({ domain: "ppc", message })` with the theme, keywords,
   offer, brand constraints and the character limits stated explicitly; that is a starting inventory,
   edited down against the section 5 standard.
2. `ppc_responsive_search_ad_create({ connection_id, ad_group_id, headlines, descriptions, final_url,
   path1?, path2?, pinned_headlines? })`. Limits are API-enforced (30 / 90 / 15) and one over-length string
   fails the whole call, so count before sending. **The ad is created PAUSED**, deliberately.
3. Record the returned ad `resource_name` and any ad strength; you need it to pause the ad later.
4. Review the paused ad in the dashboard (no preview tool exists), confirm with the approving stakeholder
   in one explicit exchange, then `ppc_enable_resource({ connection_id, resource_type: "ad", resource_id,
   ad_group_id })`; the parent `ad_group_id` is required, as it is for `ppc_pause_resource`.
5. If this replaces an incumbent, do not pause the incumbent in the same breath unless it is disapproved:
   run Play 3.

Microsoft parity: `ppc_platform_responsive_search_ad_create` takes the same shape. Bing imports from Google
then drifts (imported ads stop updating, assets often do not come across), and since the asset and
disapproval tools are Google-only, Microsoft policy states are read in that UI or inferred from enabled ads
showing zero impressions.

### Play 3: The RSA test protocol

1. Precondition: exactly two enabled RSAs differing on ONE axis (Framework D), same final URL and paths,
   roughly 100 clicks per variant per month available.
2. Check ad rotation in the dashboard first. **No tool exposes rotation.** Under Optimize, Google skews
   delivery to its own prediction: fine for performance, poison for a clean read. Say so in the write-up
   rather than pretend the split was even.
3. Minimum read is the section 5 significance bar. Never call a test in week one, nor on CTR when the goal
   is conversions.
4. Read `ppc_ad_list` rows or `hiveku-data/ppc/metrics_daily.json` at ad granularity, same window for both;
   ties go to the control, since switching costs learning.
5. Confirm, then `ppc_pause_resource({ connection_id, resource_type: "ad", resource_id, ad_group_id })` on
   the loser and queue the next challenger; a one-ad group is fragile. `memory_update` the `ppc` memory
   with hypothesis, variant, window, numbers and decision.

### Play 4: Asset buildout, then pruning

Sequence: callouts (no destinations), sitelinks (need real URLs), structured snippets, images.

1. `ppc_asset_create({ connection_id, asset_type, ... })` per asset. Limits that matter:
 - **callout**: 25 chars, 2 minimum to serve, 4 to 6 working set. Differentiators, not adjectives:
     "Same-day service" beats "Great service".
 - **sitelink**: 25-char link text plus two optional 35-char description lines. **Always write both
     lines** (much larger desktop rendering), and **four sitelinks is the magic number**: below that the
     row often will not render.
 - **structured_snippet**: a header from Google's fixed list (Services, Brands, Types, Models,
     Amenities, Insurance Coverage) plus 3 values minimum of up to 25 chars; supply 5 to 8.
 - **call**: the verified number from `get_account_info`, never an unconfirmed tracking number.
 - **promotion / price**: strong, date-bound, a compliance liability the day they expire. Build only
     with an owner and an end date in a PM task.
2. Record every returned `resource_name` in the PM task and the `ppc` memory. To re-enumerate what the
   account holds, `ppc_google_asset_upload` operation `assets-list` is the read-only inventory (filter
   by asset_type - sitelink, callout, structured_snippet, call, promotion, price, business_name, text,
   image, youtube_video; image rows carry pixel dimensions plus suggested_field_types).
3. `ppc_asset_attach({ connection_id, asset_resource_name, campaign_id | ad_group_id })` at the Framework
   E level, complete sets only. Confirm the batch first: attachment is a structure change, not a spend
   change, so one confirmation covers it. Verify rendering in the dashboard, then log the names with
   `pm_tasks_update`.
4. Images: to spec first (landscape 1.91:1 at 1200x628, 600x314 min; square 1:1 at 1200x1200, 300x300 min;
   logos 1:1 from 128x128 and 4:1; under roughly 5MB). `ppc_google_asset_upload` puts the file in the
   account, `ppc_asset_attach` places it, and an unattached upload does nothing. Images get their own
   policy review and are the most rejected type (no text-heavy overlays, collages, blurry crops), so
   re-check `ppc_disapprovals_list` next day. YouTube video ASSETS: `ppc_google_asset_upload` operation
   `youtube-video-asset-create` takes the 11-char video id or a pasted watch URL - the video must
   already be public or unlisted on YouTube, Google Ads never hosts video bytes.
5. Prune quarterly or on any offer change. Google labels asset performance Low / Good / Best / Learning in
   the UI and **no tool exposes these**: read them in the dashboard, never inferring from ad-level metrics.
   Retire anything on an expired promotion, dead service, changed price, dead number or a URL that now
   404s (`web_scrape` to verify). `ppc_asset_detach({ connection_id, asset_resource_name, campaign_id |
   ad_group_id })` removes the LINK, not the asset, so it is reversible; replace before detaching when a
   minimum is at stake, since dropping one of four sitelinks shrinks every ad.

### Play 5: Disapproval remediation loop

1. `ppc_disapprovals_list({ connection_id })`: per row read the ad or asset identity, policy topic,
   approval status (disapproved vs eligible-limited) and the parent group and campaign.
2. Classify by Framework F and by policy topic, because remedies differ completely:
 - **Editorial** (capitalization, punctuation, repetition, gimmicky characters): a copy defect; rewrite
     the offending strings and ship via Play 2.
 - **Trademark**: a competitor or brand term in the copy. Remove it; appeal only if the client holds
     documented authorization, and that is a UI escalation, not a rewrite.
 - **Destination mismatch or page not working**: the URL, not the ad. `web_scrape` the exact final URL,
     then fix the site or repoint the ad.
 - **Misrepresentation or unreliable claims**: superlatives, guarantees, results claims. Soften or
     substantiate on the page; this tier escalates toward suspension if you resubmit unchanged.
 - **Regulated vertical** (healthcare, finance, gambling, alcohol): certification, an account-level UI
     process, no tool. Raise as a client action naming it.
3. Remediate. Google ads are effectively immutable, so the pattern is **replace, never edit**: create the
   corrected RSA with `ppc_responsive_search_ad_create` (lands paused), review, confirm, enable with
   `ppc_enable_resource`, and only once it is live and eligible, `ppc_pause_resource` the disapproved one;
   pause first and the group is dark for the whole review window.
4. **There is no appeal or request-review tool**; appeals happen in the Ads UI Policy Manager. When appeal
   is right, raise it as a client-facing action naming the exact policy rather than rewriting around a
   wrong disapproval. Re-check `ppc_disapprovals_list` at 24 and 48 hours ("fixed" is a status you observe,
   not one you assert), and put repeat offences in the `ppc` memory as a prohibited-phrase list.
5. **The same loop on the other platforms** - a rejected ad spends nothing and silently starves its
   parent, so these run weekly alongside the Google read:
 - **Meta** `ppc_meta_disapprovals_list`: ads with effective_status DISAPPROVED (refused to serve) or
     WITH_ISSUES (serving restricted), with policy reasons from issues_info. Empty reasons means Graph
     attached no detail, NOT that no reason exists. Same response shape as the Google tool
     (disapproved_count + items with reasons and parent ids).
 - **TikTok** `ppc_tiktok_disapprovals`: ads with secondary_status AD_STATUS_REJECT plus rejection
     reasons. UNVALIDATED-LIVE; paginated one page per call (pagination.has_more / next_page); reasons
     resolved for the first 300 rejected ads per call, beyond that items are status-only
     (reasons_available=false); ads still IN review (AUDIT/REAUDIT) are deliberately absent - do not
     report an in-review ad as approved or rejected.
 - **LinkedIn** `ppc_linkedin_creative_disapprovals`: creatives whose review REJECTED them, detected
     from the review object or REJECT-flavoured servingHoldReasons. UNVALIDATED-LIVE; rejection-reason
     text is app-tier-dependent and may come back status-only (reasons_available=false) with the detail
     living in Campaign Manager; LinkedIn creatives are unnamed (name is always null) - use
     content_reference or `ppc_linkedin_creatives` detail for context; optional campaign_id scopes.
   Remediation on all three follows the Meta/LinkedIn build lanes in `paid-social-and-bing.md` (replace
   + pause, never edit-in-place where the platform forbids it), each write confirmed.

### Play 6: Competitive review

1. `ppc_impression_share({ connection_id, days: 30 })` first, always (Framework A), segmented by campaign:
   account totals hide the campaign where the problem lives.
2. There is NO competitor-domain data. Auction Insights is a Google Ads UI-only report; Google exposes no
   `auction_insight` resource and none of the four competitor metrics, so `ppc_auction_insights` always
   refuses and nothing can be planned around it. Read the competitive pressure out of step 1 instead:
   `lost_to_rank` IS "somebody is outranking me", `lost_to_budget` is "I am outbidding nobody because I
   stopped showing". If the client needs rival domains by name, a human exports Google Ads UI > Campaigns >
   Insights > Auction insights; say so rather than implying the data was unavailable this month.
3. Name rivals from the public ad libraries via the web lane, then classify per Framework G and track month
   over month; the trend is the insight. Enrich the top rivals with `web_search` plus `web_scrape` on their
   landing pages, the only route to competitor creative since no tool exposes rivals' ad copy. Output is a
   report section and a hypothesis, not a bid
   change.

---

## 5. Thresholds and benchmarks (defaults; account memory overrides)

**RSA build standard.** 12 to 15 headlines, 4 descriptions, both paths, 2 headlines carrying the primary
keyword verbatim, at most 3 pinned headlines and only when compelled, zero duplicate claims. Below 8
headlines or 3 descriptions is under-built regardless of grade. Review RSAs quarterly and replace on decay
or an offer change, never on a schedule.

**Character limits (API-enforced; count before sending).** Headline 30, description 90, path 15 each,
sitelink text 25, sitelink description lines 35 each, callout 25, structured snippet value 25. Count real
characters including spaces, and remember keyword insertion and countdown customizers expand at serve time,
so a 28-character headline with an insertion can exceed the limit live.

**Asset minimums to render.** Sitelinks 4; callouts 2 minimum, 4 to 6 target; structured snippets 3 values
minimum, 5 to 8 target. A full stack that gains nothing in two weeks at stable position usually means an
ad-group attachment is suppressing the campaign set (Framework E).

**CTR.** Non-brand search 3 to 6 percent healthy; below 2 percent at decent position is a creative or
relevance failure. Brand 10 percent and up, and below 8 percent usually means a competitor is bidding on
the name. Never blend brand with non-brand, or Display and Discovery with search, in one average.

**Impression share.** Brand holds 90 percent or better; under 80 percent on brand is an urgent defence
problem. Non-brand lost-to-budget over 20 percent with CPA at target is growth headroom, not a creative
issue, and absolute top share under 20 percent where top presence matters is a rank problem.

**Test significance.** About 100 clicks AND about 10 conversions per variant, or two full weeks, whichever
is later; a 15 percent or better delta in cost per conversion to call a winner, and CTR-only wins reported
as CTR-only wins.

**Disapproval clocks.** Only-ad-in-group: same day. Any disapproval on a campaign above 20 percent of
account spend: 24 hours. Everything else: the weekly cadence. Account suspension: immediately, telling the
client first.

---

## 6. Diagnosis: when the data looks wrong

- **Impressions dropped off a cliff overnight.** `ppc_disapprovals_list` first: an overnight policy sweep
  is the commonest cause and is invisible everywhere else. Then the change-history and tracking steps in
  SKILL.md 1.3 and 6, then `ppc_impression_share` for whether you fell out of the auction rather than out
  of eligibility.
- **An ad group spends nothing.** Count enabled ads via `ppc_ad_list` filtered to that group: zero enabled
  ads, or one that appears in `ppc_disapprovals_list`, explains it. Second cause: the ad is enabled but the
  parent group or campaign is paused, so the ad's own status misleads.
- **`ppc_impression_share` shows nulls or zeros.** Not available for every campaign type or for very low
  volume, and Display and video report different share metrics; never show a null as a zero or average
  across types. Ad strength is likewise sometimes absent: read it in the dashboard or say it was not
  retrieved, never infer it from headline count and call it Google's grade. `ppc_auction_insights` is a
  different story and not a data-volume one: it can NEVER return data on any account, because Google does
  not expose the report through the API at all. Do not widen the window and retry.
- **`ads.json` disagrees with the Ads UI.** Staleness (check `fetched_at`, sync per SKILL.md 0.3), else
  timezone or attribution lag; and a write that just succeeded is absent from the mirror until a sync, so
  do not "fix" it twice and create duplicate ads.
- **"We fixed it and it is still disapproved."** Review takes hours to days, and if it trips the same
  policy the offending string is still there, usually in a description or path, not the headline.

---

## 7. Edge cases and failure modes

- **Never bulk-enable ads, and never enable one without its own confirmation.** Enabling puts live copy in
  front of the public under the client's name; hence RSAs are created paused. Equally, never pause the last
  enabled ad in a group without a replacement live and eligible: that is a revenue outage.
- **Never edit around a disapproval you believe is wrong** without telling the client: you discard their
  appeal and often their strongest claim. Never resubmit unchanged copy after a misrepresentation or
  trademark disapproval either; that escalates toward suspension.
- **Never attach a partial asset set at ad-group level**, and never chase Excellent by removing a compelled
  pin. **Detach is not delete**: an asset still showing after a detach is attached at another level, and
  you never delete one to tidy up, since with no list tool you cannot see where else it is used.
- **One creative test per ad group at a time**, with no final-URL, landing-page, bid-strategy or budget
  change on that campaign mid-test; any of those makes the test unreadable, worse than no test.
- **Protected campaigns and approval thresholds**: inside a campaign account memory marks protected you
  create, enable, pause and reattach nothing, not even a "harmless" test ad; surface it and stop. Creative
  work sits below the spend-approval line, but any change to a live offer, price, guarantee or legal claim
  goes to the client whatever the spend impact.

---

## 8. Persistence and reporting

**Memory is your asset registry.** With no asset list tool, after every build write the inventory back with
`memory_update({ memory_id, content })` on the `ppc` memory (`memory_create` if none exists). That call
REPLACES the document, so send the body `memory_list({ domain: "ppc" })` returned with the new rows folded
in, never the new rows alone. Record: asset type, the copy, the returned
resource_name, the attach level, the campaign or ad group ids. Also persist prohibited phrases from
disapprovals, concluded RSA tests with their numbers, the pins that are legally compelled, and the
auction-insights competitor set by month.

**PM tasks carry the narrative.** `pm_tasks_create` per creative sprint, per disapproval batch and per
running test with its end date; `pm_tasks_update` for findings, the exact confirmations received (quote the
approval) and resource_names created or paused; `pm_tasks_complete` only once the change is live and
verified. Landing-page and certification items become client or web-team tasks.

**Client reporting.** The creative section of the monthly report carries, in order: ads shipped and tests
concluded with hypothesis, variant, window, result and decision; asset coverage before and after with
CTR effect; policy events with what was fixed and what is still an open client action; impression share
split into lost-to-rank versus lost-to-budget, so the client sees whether the constraint is craft or money;
auction insights month over month with new entrants named. Source every claim from a tool
response or a dashboard reading, label manual UI readings as such, and name the capabilities that have no
tool (asset performance labels, appeals, ad rotation, video, Microsoft disapprovals) rather than leave a
silent gap.
