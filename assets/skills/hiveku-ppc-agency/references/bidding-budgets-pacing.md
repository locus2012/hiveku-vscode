# Bidding, Budgets, Pacing: strategies, modifiers, spend control, impression-share economics

## What this covers / when to load this

The money half of the PPC operating system: how much the account may spend, how fast it is spending it,
what it bids into each auction, and what that buys in share of demand. Load it for pacing reviews, budget
reallocation, "can we spend more," bidding-strategy changes and rescues, target CPA / ROAS setting and
ratcheting, bid modifiers, keyword bids under manual bidding, impression-share diagnosis, seasonal prep,
and billing triage. Keywords, ad copy, targeting and conversion measurement are separate references
(`keywords-search-terms-negatives.md`, `ads-assets-quality.md`, `audiences-and-remarketing.md`,
`measurement-and-conversions.md`); SKILL.md is the router. Everything here is a spend-affecting write, so
SKILL.md section 0 holds throughout: context first, one confirmation per change, protected campaigns
untouchable, no silent bulk apply.

---

## 1. Gates, and the five money questions

Four gates. A failed gate stops the work there.

1. **Context.** `account_context_get({ domain: "ppc" })`, then `memory_list` for the money facts: monthly
   ceiling, target CPA/ROAS, approval threshold, protected and brand campaigns, sacred geos, blackout
   periods. No ceiling and no target in memory means no mandate to optimize: ask, persist with
   `memory_create`, then start. `get_account_info` names the account in the report.
2. **Local data first.** Read `hiveku-data/ppc/campaigns.json` (budgets, strategies, statuses),
   `metrics_daily.json`, `keywords.json`, `hiveku-data/STATUS.json` before any live call. Check
   `fetched_at`; `truncated: true` means `count` is a floor; an `error` with empty rows means NOT
   RETRIEVED, never "no spend." Fine for analysis, NOT as the pre-write read of a value you are about to
   overwrite (Play 2, step 3).
3. **Conversion-signal trust.** Every play optimizes toward conversions, so a broken signal makes the
   account worse with more confidence. Verify per `measurement-and-conversions.md` first. The killers: an
   enabled action with zero recent fires, every-per-click counting on lead gen, GA-imported duplicates on
   top of first-party tags, a primary goal the client does not value.
4. **Freshness.** Cached reads reflect the last sync (SKILL.md 0.3). Sync before a write batch and after.

Then five questions, in order, because answering 4 before 2 is the commonest way to waste money.
(1) Is the signal trustworthy? No means change nothing. (2) Budget-constrained or rank-constrained
(Framework B)? Money and bids are not interchangeable. (3) In a learning phase or change freeze? Any
strategy, target, or large budget change inside 7 to 14 days makes today's numbers noise. (4) Is the target
achievable or aspirational (Framework D)? (5) Whose money, what ceiling? Reallocation inside the ceiling is
a routine confirmed change; raising the total is a client decision with a written rationale.

**Queue by dollars at stake:** losing money at scale, then constrained-while-profitable (share lost to
budget at target CPA: the cheapest growth in the account), then drifted targets, then modifier hygiene,
then cosmetic tidying. The first two are weekly work; the last two are monthly at most.

---

## 2. Framework B: budget-constrained or rank-constrained

The central diagnosis. `ppc_impression_share({ connection_id, days: 30 })` returns search impression share
plus the two loss reasons, lost to budget and lost to rank - Google Ads. Microsoft has its own:
`ppc_bing_impression_share_report` (async) returns impression_share, lost_to_budget and lost_to_rank per
campaign plus a `scaling_headroom` summary - budget_limited (>=10% lost to budget: raise-budget
candidates) and rank_limited (>=20% lost to rank: bids or quality score, not budget) - and an
impressions-weighted average IS. Same matrix below applies to both. The concept does not exist on Meta or TikTok.

| Lost to budget | Lost to rank | CPA vs target | Lever |
|---|---|---|---|
| High (>10%) | Low | At or below | Budget-constrained and profitable. Raise budget: cheapest growth available. |
| High (>10%) | Low | Above | Budget masks inefficiency. Do NOT raise. Fix efficiency first. |
| Low | High (>25%) | At or below | Rank-constrained and profitable. Raise bids or loosen target, not budget. |
| Low | High (>25%) | Above | Quality problem. Bidding up buys expensive bad traffic. See `ads-assets-quality.md`. |
| Low | Low | Any | Demand-constrained. Growth is new keywords, geos, channels, not money. |
| High | High | Any | Both, and the budget cap hides the rank number. Fix budget, re-read after 7 days. |

Lost-to-rank impressions were never offered to you, so an unspent budget increase changes no auction
outcome. Bidding up a budget-capped campaign buys fewer, dearer clicks with the same money.

---

## 3. Framework C: the bidding-strategy ladder

`ppc_bidding_strategy_update({ connection_id, campaign_id, bidding_strategy, target_cpa?, target_roas? })`
for Google, `ppc_platform_bidding_strategy_update` elsewhere. Strategy strings differ per platform: confirm
the enum with `hiveku_docs_search` / `hiveku_docs_get` rather than guessing. Climb on trailing-30-day
conversions **on that campaign**, not the account:

- **Under 15 conv/30d:** manual CPC or maximize clicks. Smart bidding has nothing to learn.
- **15 to 30:** maximize conversions, no target.
- **30+:** target CPA, initial target at the trailing-30d ACTUAL CPA, not the aspiration.
- **50+ with trustworthy conversion VALUES:** target ROAS. If every conversion carries the same default
  value, tROAS is tCPA with extra arithmetic and more ways to break. Offline conversion upload
  (`measurement-and-conversions.md`) is what makes lead-gen values real.
- **Brand or defensive with a share mandate:** target impression share with a max CPC ceiling. A share
  instrument, not an efficiency instrument.

Climbing down is legitimate: below the gate two months running, a target-CPA campaign collapsed to
near-zero impressions, or a conversion action found broken after weeks of training. Drop one rung, run two
weeks, re-climb.

**Every rung change costs 7 to 14 days of learning, or two conversion cycles, whichever is longer.** Tell
the client before, not after. Freeze other changes on that campaign for the window. One strategy change per
campaign per two weeks, hard. Change a strategy and a budget the same day and you have learned nothing.

---

## 4. Framework D: target arithmetic

Derive targets, write the derivation into memory, reuse it.

**Lead gen:** `max allowable CPA = deal gross profit x lead-to-close rate x allowable CAC share`. Worked:
2,400 gross profit x 12% close x 30% allowable = 86.40. That is the ceiling; the operating target runs 15
to 25% under it.

**Ecommerce:** `tROAS = 1 / allowable cost-of-sale share`; 20% allowable gives 5.0. Confirm whether the
tool wants a ratio (1.5) or a percentage. The SKILL convention is a ratio where 1.5 means 150%, and that
mix-up is a 100x error in the direction that silently kills delivery.

**The ratchet.** Set the current actual first, tighten 10 to 15% per step, one step per 14 days minimum,
hold whenever volume drops more than 20% at a step. A target more than about 30% below trailing actual does
not make the account efficient; it makes the campaign stop entering auctions. If the client demands the
aspiration now, say plainly what happens to volume, put it on the PM record, and ratchet anyway. Loosening
is a real lever too: a target above actual with lost-to-rank high and margin available is often the fastest
volume unlock available, reversible in one call.

---

## 5. Framework E: pacing as a control loop

`ppc_pacing_summary({ connection_id })` returns per campaign: month-to-date target, actual, pace ratio,
projected end-of-month spend, and pre-flags campaigns over 20% off pace. Agency tolerance is tighter: act
at plus or minus 10%. Read `pace_ratio = actual_mtd / target_mtd` against the day of month, because the
same ratio means different things on the 5th and the 25th.

- **Front-loaded burn** (well above 1.0 early, projected EOM over ceiling): usually a budget raised without
  a ceiling conversation, a fresh switch to maximize conversions, or CPCs falling as a competitor exits.
  Find what changed before cutting.
- **Flat underspend** (0.7 to 0.9 all month, smooth): rank- or demand-constrained, so raising budget does
  nothing. The most-often misdiagnosed shape, and invisible: nothing bad happens, the account simply fails
  to grow.
- **Mid-month cliff** (on pace, then near zero): something stopped serving. Disapprovals, a paused
  resource, billing, or a tracking break that starved smart bidding. Never a budget fix.

**Reallocation is zero-sum by default:** fund winners from losers so the total holds the ceiling. A proposal
that only adds budget is a budget-increase request and goes to the client as one.

---

## 6. Framework F: modifiers, stacking, and what smart bidding ignores

`ppc_bid_modifier_update({ connection_id, target_type, target_value, bid_modifier, campaign_id | ad_group_id })`.
Google only. Device (MOBILE, DESKTOP, TABLET) and location (a geo target constant id) are campaign level
only; audience works at either level. 1.0 neutral, 1.2 is +20%, 0.8 is -20%.

**Under target CPA, target ROAS and maximize conversions, Google ignores device, location and audience bid
modifiers.** The model bids per auction on those signals directly. The only one that still bites is a full
exclusion (-100% device), a targeting decision rather than a bid hint. Manual/eCPC, target impression share
and maximize clicks respect modifiers. Under smart bidding the real levers are exclusion, a separate
campaign with its own target, or better conversion data.

**Stacking multiplies:** 1.2 x 1.2 x 1.2 = 1.728, a 73% increase you did not intend. Compute the product
before adding a third modifier to the same traffic; keep the stack inside roughly +50% / -40%.

**Evidence first.** Device, hour, day-of-week and geo pivots come from the segment reporting in
`measurement-and-conversions.md`. Minimum to move anything: 30+ clicks in the segment or cost of at least
1x target CPA. Cap the first move at 20 to 30%, re-read in 14 days, step again if the direction holds.

**Dayparting has no tool here.** `ppc_bid_modifier_update` has no ad-schedule target type, so hour and
day-of-week adjustments are a dashboard job. Do the analysis, hand over the schedule, record a PM task.

---

## 7. Framework G: impression-share economics

IS is a ratio whose denominator you do not control, with three consequences.

**It can fall while everything you did was right:** a new competitor enlarges the denominator, so your
impressions held and your share dropped. Check absolute volume before calling a decline a failure.

**The last points cost the most:** the auctions you lose are the ones where you were outbid or less
relevant, so moving non-brand search IS from roughly 60% to 80% commonly costs 2 to 3x average CPC at a
lower conversion rate. Marginal CPA there can be double blended CPA while the blended number barely moves.

**The efficient frontier is rarely 100%:** brand and defensive 90%+ (cheap, high converting, and ceding it
invites conquesting); non-brand search 60 to 70%, higher only with fat margin, CPA headroom, and an explicit
client choice of share over efficiency. Never blend Shopping or Display share with search.

So decide on marginal, not average: degrade current CPA by 20 to 40% for the incremental slice and compare
to the Framework D ceiling. If it breaks, the honest answer is "this campaign is done growing efficiently."

---

## 8. The plays

### Play 1: The Monday pacing loop (weekly, per connection)

1. `ppc_pacing_summary({ connection_id })`: read target_mtd, actual_mtd, pace_ratio, projected_eom_spend,
   off-pace flags. Sum projected_eom_spend against the memory ceiling: that number is the headline.
2. Classify each off-pace campaign into a Framework E shape. The ratio alone does not name the lever.
3. For underpacers, `ppc_impression_share({ connection_id, days: 30 })` and apply Framework B. Only the
   budget-constrained-and-profitable quadrant becomes an increase proposal.
4. Build one table: campaign, current budget, proposed, delta, reason, expected effect. Net delta zero unless
   you are deliberately asking for more. Present it, then take confirmations ONE CAMPAIGN AT A TIME: batch
   the analysis, never the consent.
5. `ppc_budget_update({ connection_id, campaign_id, daily_budget })` per confirmed row.
6. Read each response. If it flags the budget as explicitly shared, STOP: you changed every campaign on that
   budget. Surface which, re-confirm, revert if unwanted. No budget-create tool exists here, so splitting a
   shared budget is a dashboard task.
7. Sync, then log the loop with `pm_tasks_update` including confirmation quotes.

### Play 2: Reallocation between campaigns (zero-sum)

1. Performance from `metrics_daily.json`, budgets from `campaigns.json`. Rank by CPA vs target and pace ratio.
2. Donors: above target CPA and on or over pace. Recipients: at or below target CPA with lost-to-budget share.
3. **Re-read the current budget of every campaign you are about to write, live.** `ppc_budget_update` sets an
   absolute value, not a delta. Overwriting a colleague's Friday change with a stale Monday number is a real
   and common failure.
4. Cap each step at 20 to 30% of current daily budget. Two 25% steps beat one 50% step: big jumps destabilize
   delivery and make next week unreadable.
5. Confirm and apply per campaign, `ppc_budget_update` or `ppc_platform_budget_update` (Play 9).
6. Freeze 7 days, no simultaneous strategy or target change, freeze end date written into the PM task.

### Play 3: Budget increase, and brand share defense

1. Establish the constraint with `ppc_impression_share`. Lost to budget justifies an increase; lost to rank
   does not. On a brand campaign, IS under 90% means competitors or your own budget are eating the cheapest
   conversions in the account; brand lost-to-rank is unusual enough to check for a too-tight target CPA and
   weak ad relevance before spending anything.
2. Establish the current money works: 30-day CPA at or under the memory target on a trustworthy action.
3. Estimate the marginal outcome per Framework G. Give a range and name the degradation assumed.
4. Check plumbing: `ppc_billing_summary({ connection_id })` for payment setup, spend to date, account-level
   spend cap. Asking for 3,000 more on an account with a payment problem or a hard cap wastes the week.
5. Draft the rationale with `talk_to_department({ domain: "ppc", message })`, then edit it. You do not send it
   anywhere yourself. On approval: `memory_update` the ceiling, `ppc_budget_update` per campaign with
   per-campaign confirmation, `pm_tasks_create` a day-14 review grading your forecast against reality.
6. Brand campaigns are frequently protected in memory: propose and flag, never write. Never fund prospecting
   by starving brand, and never let a shared budget make them compete for one pool.

### Play 4: Escalate up the ladder, then ratchet

1. Verify the volume gate on THAT campaign from `metrics_daily.json`, that the conversion action is clean
   (gate 3), and that nothing else changed on the campaign in 14 days.
2. Initial target per Framework D: trailing-30d actual, not the goal.
3. Confirm with the client, naming the 7 to 14 day learning period and expected instability. That sentence is
   the difference between "the agency warned us" and "the agency broke it."
4. `ppc_bidding_strategy_update({ connection_id, campaign_id, bidding_strategy: "target_cpa", target_cpa })`.
   Non-Google: `ppc_platform_bidding_strategy_update`, enum confirmed via `hiveku_docs_get` first.
5. Record switch date and freeze end date in memory and the PM task. Review day 14, not day 3.
6. Monthly after that: at or under target with stable volume, tighten 10 to 15% through the same tool with a
   new `target_cpa` / `target_roas`; above target with high lost-to-rank and margin available, consider
   loosening 10 to 15%. One move per campaign per 14 days, never inside a learning window.
7. Volume down more than 20% at the new step: step back. That campaign has found its frontier, and the client
   should be told so in plain language.

### Play 5: Rescuing a collapsed smart-bidding campaign

Symptom: impressions and spend fell off a cliff after a target change, and the CPA on the trickle looks great.

1. Do not celebrate the CPA. Look at conversion VOLUME and spend: a target so tight the campaign stops
   entering auctions produces a beautiful CPA on a worthless number of conversions.
2. Check the sequence: previous target, new target, trailing actual when set. More than about 30% under
   trailing actual is the cause.
3. Rule out alternatives: a conversion action that stopped firing (the model sees nothing and throttles),
   disapprovals, a budget cut, a shared-budget change elsewhere.
4. Fix: raise the target back toward trailing actual in ONE move. This is the exception to the ratchet: you
   are undoing a bad step, not tuning. Confirm, apply via `ppc_bidding_strategy_update`.
5. Still dead after two weeks: de-escalate one rung to maximize conversions, rebuild, re-climb. Record the
   episode in memory so nobody repeats the target.

### Play 6: Modifiers from evidence (manual/eCPC only)

Confirm the strategy from `campaigns.json` first; on smart bidding, stop (Framework F). Pull the pivot from
`measurement-and-conversions.md` and require 30+ clicks or 1x target CPA in segment cost. Then:

- **Device.** Compute rather than pick a round number: `modifier = segment target CPA / segment actual CPA`,
  clamped to the 20 to 30% first-move cap. Mobile 40% worse implies 0.7; cap the first move at 0.8, step
  again in two weeks.
  `ppc_bid_modifier_update({ connection_id, campaign_id, target_type: "device", target_value: "MOBILE", bid_modifier: 0.8 })`.
  Campaign level only; an ad_group_id fails. A device that is bad because the mobile landing page is bad is
  not a bidding problem: PM task to the web team.
- **Location.** `target_type: "location"`, `target_value` is the geo target constant id, not a place name. If
  you cannot resolve the id confidently, use the dashboard rather than guess. Sacred geos in memory are
  flagged, not bid down on one soft month; a geo unprofitable across two quarters is an exclusion decision.
- **Audience.** Attach in observation at 1.0 to collect data without restricting reach; after 30 days promote
  strong to 1.1 to 1.3, demote weak to 0.7 to 0.9. Mechanics: `audiences-and-remarketing.md`.

### Play 7: Keyword bids under manual bidding

1. `ppc_keyword_bid_update` only changes behavior under manual or enhanced CPC; under smart bidding the value
   is stored and ignored. Verify the strategy from `campaigns.json` first. Setting keyword bids across a
   target-CPA campaign and reporting it as optimization is a fabricated deliverable.
2. Conversions at or under target CPA: raise toward top-of-page. Cost approaching 1x target CPA with zero
   conversions: cut 20 to 30% and send the term into `keywords-search-terms-negatives.md`, because the fix is
   often a negative, not a bid.
3. Steps of 10 to 20%, never multiples. A bid doubled to reach page one usually buys position on a query that
   was never going to convert.
4. One confirmation covers a batch inside one ad group; an account-wide bid sweep is not something you do. If
   a whole ad group's bids are systematically wrong, the fix is the ad group default bid or a strategy change.

### Play 8: Month-end control, temporary changes, and seasonality

1. Day 20 to 22: `ppc_pacing_summary` and project. Over ceiling now means 8 to 10 days to correct gently
   instead of 2 days to correct violently. Trim the worst performers first in 20% steps, never an
   across-the-board slash, and never pause to hit a ceiling when a reduction will do: pausing costs learning
   history, a reduction does not.
2. Underspending with days left: resist dumping budget into the last week. A 60% increase on day 27
   destabilizes smart bidding through the first week of NEXT month, a worse trade than returning the underspend.
3. For a known spike, pre-raise budgets with `ppc_budget_update` and loosen target CPA via
   `ppc_bidding_strategy_update` for the window. No tool here applies Google's seasonality adjustments or data
   exclusions: those are dashboard actions, so say so rather than implying you applied one. With no account
   history for the event, get demand evidence via `web_search` / `web_scrape`, or `web_extract` for a
   structured pull from a named source.
4. **Every temporary change gets a written revert date, in the PM task AND in memory.** A "temporary" trim
   nobody reverses is a permanent silent budget cut that surfaces badly in a quarterly review.

### Play 9: Non-Google budgets and strategies

`ppc_platform_budget_update` and `ppc_platform_bidding_strategy_update` are the cross-platform writes. Meta:
daily OR lifetime budget, exactly one, at campaign level (CBO) or ad set level, not both; learning exits near
50 optimization events per ad set per 7 days and a change over roughly 20% can re-enter it, so step 20% and
leave it a week. Microsoft: closest to Google, daily budget per campaign, parallel strategies. LinkedIn:
daily OR total budget, practical floor near 10/day per campaign. TikTok: campaign OR ad group level, with
platform minimums (commonly ~50/day campaign, ~20/day ad group) that are rejected rather than clamped.

Confirm argument names and enums with `hiveku_docs_search` / `hiveku_docs_get` first; Google's `daily_budget`
semantics do not carry across. `ppc_pacing_summary`, `ppc_impression_share` and `ppc_billing_summary` are
Google tools, so for other platforms pace from the cached metrics series and read share in the platform UI.

### Play 10: Billing triage

Spend fell to zero across every campaign at once, or campaigns show eligible-but-not-serving. A simultaneous
cross-campaign stop is almost never a bidding problem. `ppc_billing_summary({ connection_id })` first, for
payment setup, account spend cap and balance; if that is clean the cause is upstream (connection auth,
disapprovals, a paused parent) and belongs to `account-structure.md` / `ads-assets-quality.md`. Billing fixes
have no tool here and cannot: cards, spending limits and payment profiles are the client's financial
credentials. Escalate with the exact change needed and `pm_tasks_create` so the outage has an owner.

---

## 9. Thresholds and benchmarks (defaults; memory overrides)

- **Pacing:** act at plus or minus 10% of month-to-date target. The tool flags at 20%, which is late.
- **Budget step:** 20 to 30% of current daily budget, one move per campaign per 7 days.
- **Google delivery:** a daily budget can overspend up to 2x on a high-demand day, monthly charge capped near
  daily x 30.4. One day of overspend is not an incident; a week of it is.
- **Volume gates:** 15 conv/30d for maximize conversions, 30+ for target CPA, 50+ with real values for target
  ROAS, per campaign.
- **Learning:** 7 to 14 days or two conversion cycles, whichever is longer, with a full change freeze.
- **Change velocity:** one strategy change and one target ratchet per campaign per 2 weeks; never a strategy
  change and a budget change on the same campaign the same day.
- **Targets:** initial = trailing 30d actual; ratchet 10 to 15% per step; never more than 30% below trailing
  actual in one move.
- **Modifiers:** minimum 30 clicks or 1x target CPA in segment cost; first move capped at 20 to 30%;
  multiplied stack inside +50% / -40%.
- **Impression share:** brand 90%+; non-brand search 60 to 70% healthy. Lost to budget above 10% at target CPA
  is a growth signal; lost to rank above 25% is a bid or quality signal.
- **Marginal CPA forecast:** degrade current CPA 20 to 40% and say which end you used.
- **Keyword bids:** 10 to 20% steps; cut 20 to 30% at zero conversions with cost near 1x target CPA.
- **Approval:** anything raising total spend, anything above the memory approval threshold, and anything
  touching a protected or brand campaign goes to the client first. Always.

---

## 10. Diagnosis: when the numbers do not move

- **Raised the budget, spend unchanged.** Not budget-constrained: lost-to-rank high with lost-to-budget near
  zero means budget was never the cap. Revert and work the rank lever.
- **Pacing disagrees with the dashboard.** Staleness (sync and re-read); timezone (the platform reports in
  the ACCOUNT timezone, so a day-boundary mismatch shifts month-to-date by up to a day of spend); or a
  shared budget, where per-campaign totals do not sum as expected.
- **Budget update succeeded, value unchanged.** Check the explicitly-shared flag, whether another operator
  reverted it (change history: `account-structure.md`), and whether you re-read a stale cache.
- **Target CPA set, actual CPA ignores it.** It is a target, not a cap: judge over 30 days and 30+
  conversions. Persistently 40%+ above means the target is aspirational (Framework D) or the signal is
  polluted (double counting deflates apparent CPA; a broken tag does the reverse).
- **Bid modifier did nothing.** Almost always smart bidding (Framework F); then wrong level (device and
  location are campaign-only); then another modifier in the stack pulling the other way.
- **Impression share missing, zero, or absurd.** Not reported for very low-volume campaigns, not comparable
  across campaign types, unavailable for non-Google platforms here. An empty response is NOT 0% share; an
  error is an integration problem, so check connection state per `account-structure.md` first.
- **A dead integration looks like good news.** A connection that stopped syncing shows flat spend at a stable
  CPA, which reads like an efficiency win. When a metric goes quiet, verify freshness before reporting: a
  sync outage reported as a win is the most damaging mistake in this file.

---

## 11. Edge cases and failure modes

- **Shared budgets.** `ppc_budget_update` on one changes every attached campaign; the response flags it, so
  read it. No tool here creates or detaches a budget: that fix is a dashboard change plus a PM task.
- **Portfolio bid strategies.** A campaign in a portfolio may reject a campaign-level strategy write, or may
  detach and take its own settings, silently changing shared learning for every other campaign in it. No
  portfolio tool exists here: if a write behaves oddly, stop and use the dashboard.
- **Units and currency.** Confirm currency units versus micros with `hiveku_docs_get` when unsure: a micros
  mix-up is a 1,000,000x error, a ROAS ratio-versus-percentage mix-up is 100x, and both are recoverable only
  within hours. Never blend spend across connections in different currencies.
- **Never bulk-apply money changes.** There is no bulk budget or bid tool here, and that is a feature.
  Wanting to write 40 budgets in a loop means the right move is a structural proposal, not 40 writes.
- **Sequence your levers.** Do not optimize during learning (the numbers mean nothing and acting on them
  starts an oscillation that takes a month to settle), and never move two levers at once on one campaign:
  budget and strategy, or target and modifiers, together means neither result is attributable.
- **Four things never to do:** raise budget to fix CPA (more money on an inefficient campaign buys more
  inefficiency); chase 100% impression share (Framework G); set keyword bids on smart-bidding campaigns and
  call it optimization; write to a protected or brand campaign, however right the arithmetic and however
  urgent the client, because that protection exists for a reason.
- **Confirm and be able to revert.** "Just increase everything 30%" still gets a per-campaign proposal table
  and one explicit approval on it. Capture the pre-change value in the PM task BEFORE each write.

---

## 12. Persistence and reporting

**Memory** holds the account's money doctrine and is what the next session inherits. After any material
change, `memory_create({ type: "memory", name: "ppc", content })` on the first run, then
`memory_update({ memory_id, content })` after (it takes ONLY `memory_id` and `content`, never
`type`/`name`, and REPLACES the document, so resend the merged body), covering: the monthly
ceiling and its approval date; target CPA/ROAS per campaign with the Framework D derivation; current bidding
strategy per campaign and the date set; active freeze end dates; protected campaigns; every temporary budget
or target change with its revert date; and frontier conclusions ("campaign X cannot grow past ~70% IS at
target CPA; tested Aug 2026").

**PM tasks** are the client-visible record. `pm_tasks_create` the sprint or weekly task, `pm_tasks_update` as
work proceeds with the proposal table as presented, the pre-change value of every setting, the confirmation
received (quoted), the post-change value, and the review date. `pm_tasks_complete` only when the review has
happened, not when the write landed: a budget change with no reviewed outcome is an unfinished task. Anything
no tool can do (dayparting, seasonality adjustments, shared-budget restructuring, billing fixes) becomes its
own task with the dashboard steps written out, so the gap stays visible instead of quietly dropped.

**Client reporting.** The money section answers four questions in order: did we spend what we said (pacing
and ceiling), what did it buy (conversions or revenue against target), what did we change and why (the
confirmed log with pre and post values), and what headroom or risk remains (share lost to budget versus
rank, targets at their frontier, upcoming seasonality). Draft it with
`talk_to_department({ domain: "ppc", message })` for voice, then edit for accuracy: the department writes
well, you are responsible for the numbers being true. Nothing reaches the client until the send is approved.
