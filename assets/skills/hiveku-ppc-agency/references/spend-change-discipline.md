# Spend-change discipline

## What this covers

The rules for changing anything on a paid-media account that moves money: budgets, bids, bidding
strategies, status flips, negatives, targeting, audience uploads, conversion uploads. It is the
safety layer that sits underneath every play in the hub skill and every other reference in this
directory. Load it before your first write of a session on any account you did not build yourself,
and load it whenever you are about to touch a live campaign that is already spending.

It does not teach bidding theory (that is `references/bidding-budgets-pacing.md`), negative strategy
(`references/keywords-search-terms-negatives.md`), or measurement integrity
(`references/measurement-and-conversions.md`). It teaches the sequence: what you must know before a
write, what you must say before a write, what Hiveku refuses on its own, and what you must read
after a write to know it actually happened.

Every tool named in this file was verified against
`hiveku-mcp-api-server/src/tools/marketing-tools.ts` and `olympus-tools.ts`, and every enforcement
claim against the builder routes that back them. Where a capability does not exist, this file says
so rather than inventing a tool name. The one exception is the campaign-experiment lane
(`ppc_experiments_list`, `ppc_experiment_create`, `ppc_experiment_schedule`, `ppc_experiment_end`,
`ppc_experiment_graduate`), new as of 2026-08-29: those five are described from the builder route
contract (`/api/olympus/ppc/google-ops`, module `experiments`) because their tool declarations ship
after the route deploys, and none has been live-validated. Every claim about them below is contract,
not observation, until a session has driven one end to end. Their lifecycle and verdict rules live in
`references/google-ads-advanced.md` section 11.

## The governing rule

> No source means no platform claim, no testing means no capability claim, no approval means no
> mutations.

Three separate refusals, and they fail in that order.

- **No source means no platform claim.** Do not tell the client what Google or Meta is doing until
  you have pulled it. "Impression share is probably budget-limited" is not a finding;
  `ppc_impression_share` returning a high `lost_to_budget` on a named campaign is a finding.
- **No testing means no capability claim.** Several write paths in this surface carry the literal
  words "Write path not yet live-validated" in their own tool descriptions
  (`ppc_meta_campaign_update`, `ppc_meta_ad_set_update`, `ppc_meta_campaign_push`) or
  "UNVALIDATED-LIVE" (`ppc_linkedin_conversions`, `ppc_linkedin_audience_segments`,
  `ppc_linkedin_abm_segment`), and as of 2026-08-29 the whole experiment lane is in the same state
  without a tool description to carry the words yet. Do not promise a client an outcome through a
  lane nobody has driven end to end. Say what is validated, say what is not, and let the operator
  choose.
- **No approval means no mutations.** Every spend-affecting change gets its own approval exchange.
  Not a batch approval, not an implied approval from an earlier "sounds good", not an approval you
  inferred from a plan the client skimmed last week.

The rest of this file is that rule turned into an order of operations.

## 0. The gate a mutation must clear

Before any spend-affecting write, all six of these are true, and you can point at what makes each
one true:

1. **A tested capability exists for the operation.** A named tool, on the right platform family. The
   rich `ppc_*` ops surface is GOOGLE ADS ONLY; a Microsoft, Meta, LinkedIn or TikTok
   `connection_id` returns a wrong-platform error, not an empty result. Cross-platform writes go
   through `ppc_platform_*`, per-platform writes through `ppc_bing_*` / `ppc_meta_*` /
   `ppc_linkedin_*` / `ppc_tiktok_*`.
2. **Explicit ids.** `connection_id` from `ppc_connection_list`, plus the platform-side
   `campaign_id` / `ad_group_id` / `criterion_id` / `resource_name` from a read you ran this
   session. Never an id you carried over from a conversation about a different account.
3. **A human-readable before and after, with blast radius.** Section 2.
4. **Owner approval, inside the account's own ceiling.** The client's monthly budget cap and target
   CPA/ROAS live in `memory_list({ domain: "ppc" })`. If they are not there, you do not have a
   ceiling, and getting one is the change you propose first.
5. **An audit trail.** The PM task comment (`pm_tasks_comment`) carries the diff you showed, the
   approval you got, and every `resource_name` the write returned. Undo tools need those strings;
   `ppc_negative_keyword_remove` takes nothing else.
6. **Remote state matches your preconditions.** The local mirror can be a day stale. Section 1.3.

Until all six hold, the change is a DRAFT. Write drafts into the PM task, not into the ad account.

## 1. Read-only by default

### 1.1 The read spine

Open every session with reads, in this order, before you form an opinion about anything:

| Read | What it settles |
| --- | --- |
| `ppc_connection_list` | Which platforms exist, their status, campaign_count. Source of every `connection_id` below. `ppc_connection_test({ id })` on anything suspect. |
| `ppc_digest` | Cross-platform spend/clicks/conversions in one call, plus `warnings[]` naming connections stale over 25h. Local cache, no external calls, no `connection_id` needed. |
| `ppc_account_settings_get` | Currency, time zone, auto-tagging, conversion-tracking status, manager/test-account flags. Answers "am I even looking at a real spending account". |
| `ppc_conversion_tracking_status` | Whether the numbers you are about to optimize toward are real. Returns `silent_count` and a `warnings[]` array. |
| `ppc_change_history` | Who changed what in the last 30 days, including `client_type` GOOGLE_ADS_API. Answers "did a human already do this on Tuesday". Hard 30-day limit from Google. |

If `ppc_conversion_tracking_status` reports silent enabled actions, stop. Read its two-number rule
first: it returns both `conversions` (the Conversions column, what Smart Bidding optimizes on) and
`all_conversions`. Silence is judged on `all_conversions`, so an action showing `conversions: 0`
with `all_conversions: 50` is deliberately excluded from the column, not dead. Do not report that as
a broken tag, and do not change a bidding strategy on top of either interpretation until you know
which one you are looking at.

### 1.2 The read that builds the case for each class of change

Never propose a change class without the read that justifies it in hand.

| Change you want to make | The read that earns it |
| --- | --- |
| Raise or lower a daily budget | `ppc_pacing_summary` (target_mtd vs actual_mtd, pace_ratio, projected_eom_spend) plus `ppc_impression_share` (high lost-to-budget is the only honest reason to raise) |
| Move budget between platforms | `ppc_reallocation_plan` - a plan generator that NEVER applies anything; it names the guardrailed tool per move in `apply_with` and lists `data_gaps[]` |
| Change a bidding strategy | `ppc_campaign_get` for the current strategy, plus 30-day conversion volume from `ppc_metrics` or `ppc_segment_report({ dimensions: ["date"] })` |
| Change a keyword bid | `ppc_campaign_get` FIRST - under target CPA/ROAS/Max Conversions the bid is recorded and ignored for ranking; `ppc_keyword_list` for the keyword's current bid and quality components |
| Add a negative keyword | `ppc_search_terms_report` (Google) or `ppc_bing_search_terms_report` (Microsoft, which returns a `wasted_spend` summary of zero-conversion queries) |
| Pause a campaign, ad group, ad or keyword | `ppc_metrics` or `ppc_period_comparison` for the trend, `ppc_disapprovals_list` to check it is not already dead for a policy reason |
| Enable anything | `ppc_campaign_get({ include: "ad_groups,ads,metrics" })` - proof it has an ad group, an ad and a keyword or audience, so it does not enable into an empty shell |
| Change a bid modifier | `ppc_segment_report` with `["device"]`, `["hour"]`, `["day_of_week"]` or `["geo_target_constant"]`, or `ppc_audience_performance` for audience modifiers |
| Apply a Google recommendation | `ppc_recommendations_list` with its per-rec impact estimate, plus the read that would justify the same change if you had proposed it yourself |
| Touch quality-score keywords | `ppc_keyword_list` (Google, includes the three components) or `ppc_bing_quality_score_report` (Microsoft, returns a `low_quality` summary with spend at risk) |
| Upload offline conversions | `ppc_conversion_actions_list` to confirm an Upload-source action exists |
| Upload customer-match members | `ppc_google_user_lists` operation `user-lists-list` - the ONLY tool that surfaces the `user_list_id` that `ppc_customer_match_upload` requires |
| Change Meta ad set targeting | `ppc_sync` then `ppc_ad_group_list` for the ad set row's `targeting` JSON - the only whole-spec read in this surface. `ppc_meta_audiences_list` operation `ad-set-audiences` is NOT that read: it returns the audience lists plus the NAMES of the other targeting keys, never their values. See 2.4 |
| Change a PMax asset group | `ppc_google_pmax` operation `asset-group-list` - read-only, returns `missing_requirements` naming exactly why an idle group cannot serve |
| Schedule, end or graduate a campaign experiment | `ppc_experiments_list` for the experiment's `status` and `arms` (SETUP means nothing is serving), the per-arm clicks and conversions against the SKILL.md section-9 minimums for any verdict, and for graduate the reads a budget raise needs: `ppc_pacing_summary` plus the base campaign's current `daily_budget` from `ppc_campaign_get` after a fresh `ppc_sync` |

### 1.3 Freshness is a precondition, not a nicety

`ppc_digest`, `ppc_campaign_list`, `ppc_ad_group_list`, `ppc_ad_list`, `ppc_campaign_get` and
`ppc_metrics` all read the LOCAL mirror. They are exactly as fresh as the last sync.

- `ppc_sync({ connection_id })` is synchronous, and the network bounds it at about 120s, not the
  300s this file used to claim. The edge in front of Hiveku ends a synchronous call there and
  answers 524, so a sync that needs longer can never complete on this lane no matter how the
  budgets are set. After a timeout, or for any full backfill, use `ppc_sync_async` +
  `job_status_get` rather than re-sending.
- `ppc_sync_async({ connection_id })` returns a job id immediately; poll `job_status_get({ job_id })`.
  Use it for 5-year backfills. It accepts an `idempotency_key`, so a retry after a conversation
  resume returns the existing job instead of stacking a second one.

Sync before you analyze, and sync again after a batch of writes so your own next read does not
contradict the change you just made. There is a second, sharper reason to sync before a budget
write, in 4.1: one of Hiveku's two budget rails only fires when the mirror knows the current budget.

Microsoft Ads has an extra dependency worth knowing before you plan writes: Bing write ops scoped to
a `campaign_id` or `ad_group_id` verify ownership against the local mirror, and the live fallback
refuses accounts with more than 50 campaigns when the mirror is cold. Run `ppc_sync`, then
`ppc_bing_pull_ad_groups` before any ad-group-scoped Bing call.

### 1.4 Two tools that are read-only by construction

Worth knowing because they are the safe way to go deeper without reaching for a write.

- `ppc_google_ads_read` exposes the marketing agent's own Google Ads CLI read surface directly, for
  anything the curated `ppc_*` tools do not cover: `account-settings`, `anomaly-check`,
  `auction-insights`, `audience-performance`, `billing-summary`, `change-history`,
  `conversion-tracking-status`, `impression-share`, `keyword-ideas`, `keyword-metrics`,
  `keyword-planner-forecast`, `linked-accounts`, `list-conversion-actions`, `list-disapprovals`,
  `list-keywords`, `list-recommendations`, `period-comparison`, `pull-ad-groups`, `pull-ads`,
  `pull-campaigns`, `pull-metrics`, `search-terms`, `segment-report`. Its description states the
  reason writes are deliberately absent: they spend money, and the approval flow around them is not
  reproduced on that path.
- `ppc_reallocation_plan` ranks connections by marginal efficiency and proposes conservation-balanced
  monthly moves that net to zero, step-capped at 25 percent of any connection's monthly target per
  plan. Its own honesty contract says it NEVER applies anything. Treat its output as a draft that
  still has to clear section 2 per move.

## 2. The diff discipline

### 2.1 The three lines

Never apply a change without first putting these in front of the operator, in the chat and in the PM
task comment:

```
CHANGE:   <tool> on <account / campaign / object, by id>
CURRENT:  <the value you read, and the read you got it from>
PROPOSED: <the exact value you will send>
IF WRONG: <what it costs, in money and in time-to-notice>
SCOPE:    <every object this touches, not just the one you named>
UNDO:     <the tool and the identifier that reverses it, or "none">
```

`IF WRONG` is the line that does the work. It forces you to price the mistake before you make it.
`SCOPE` is the line that catches the shared-budget and shared-negative-list cases, where the object
you named is not the only object that changes.

### 2.2 Budgets: the obvious case

```
CHANGE:   ppc_budget_update, connection <conn-uuid>, campaign 1234567890 "Non-Brand - Services"
CURRENT:  daily_budget 120.00 USD (ppc_campaign_get, synced 2h ago)
PROPOSED: daily_budget 160.00 USD (+33%)
IF WRONG: +40/day, about +1,200/month. Visible within 24h in ppc_pacing_summary.
          Reversible in one call. Low cost to be wrong.
SCOPE:    this campaign only IF the response comes back explicitly_shared: false.
          If explicitly_shared is true the change hits EVERY campaign on that budget -
          the response carries a warning field. Stop and re-confirm on that flag.
UNDO:     ppc_budget_update back to 120.00
```

A budget mistake is loud, bounded, and reversible. That is why it is the case everyone remembers and
the case that hurts least. The `explicitly_shared` flag is the one part of a budget change that is
not bounded, and it is the reason `SCOPE` is a required line rather than a nice one.

Non-Google budgets go through `ppc_platform_budget_update`, which has a different shape per platform
and a matching set of ways to hit the wrong object:

- Google: `campaign_id` + `daily_budget`.
- Meta: campaign-level (CBO) with `campaign_id`, or ad-set-level (ABO) with `budget_level: "ad_set"`
  + `ad_set_id`. Most Meta accounts budget at the ad-set level. If the campaign-level write refuses
  with a CBO error, the budget lives on the ad sets and you were about to change the wrong layer.
- Microsoft: `campaign_id` + `daily_budget`.
- LinkedIn: `campaign_id` + `daily_budget` OR `total_budget`. LinkedIn defaults USD for the money
  object's currency code and hard-caps every budget write at 100,000. Campaign-GROUP budgets are not
  on this tool at all; they live only on `ppc_linkedin_campaign_group_update`.
- TikTok: exactly one of `campaign_id` OR `adgroup_id`, plus `daily_budget`.

### 2.3 Bid strategies: the dangerous quiet one

A bidding-strategy change looks like a settings toggle and behaves like a controlled outage.

```
CHANGE:   ppc_bidding_strategy_update, campaign 1234567890 "Non-Brand - Services"
CURRENT:  manual_cpc (ppc_campaign_get)
PROPOSED: target_cpa, target_cpa 85.00 (trailing-30d actual CPA, not the aspiration)
IF WRONG: about 7 days of unstable delivery with no clean signal, and the damage is
          NOT a number you can read tomorrow. Reverting does not restore the prior
          state - it starts a SECOND learning phase. The real cost is two weeks of
          the account's learning budget plus a month of unusable period comparisons.
SCOPE:    this campaign. Every keyword-level bid in it becomes advisory: after this,
          ppc_keyword_bid_update records a bid that is ignored for ranking.
UNDO:     ppc_bidding_strategy_update back to manual_cpc, which is NOT a real undo.
```

Why it is quiet, and why it deserves more ceremony than a budget change:

- **The tool warns, the platform does not stop you.** `ppc_bidding_strategy_update`'s own description
  says smart-bidding strategies enter a roughly 7-day LEARNING phase where performance is unstable,
  and instructs you to surface that warning to the user. Nothing in code enforces it.
- **It is not reversible in the way a budget is.** Flipping back is a second change of the same class,
  with its own learning phase. There is no restore.
- **The blast radius includes tools you will reach for later.** `ppc_keyword_bid_update` is explicitly
  a no-op for ranking under target CPA / target ROAS / Max Conversions; the response carries a note
  when that is the case. An operator who does not know the strategy changed will spend an afternoon
  setting bids that do nothing.
- **It corrupts measurement, not just delivery.** A `ppc_period_comparison` spanning the switch is
  measuring the learning phase, not your optimization.
- **Microsoft has a hard precondition.** `ppc_platform_bidding_strategy_update` refuses
  `max_conversions` / `target_cpa` / `target_roas` unless the account has an active, bidding-eligible
  conversion goal. Check `ppc_bing_conversion_tracking_status` first. Note also that its
  `target_roas` is a RATIO, not a percent: 2.5 means 250 percent. Sending 250 is a 25,000 percent
  target and the campaign stops serving.

Treat a strategy change as a scheduled event: announce it, freeze other changes on that campaign for
the learning window, and put the end date in the PM task so the next session does not read the
learning phase as a performance collapse. A running campaign experiment is the same kind of event: from
a confirmed `ppc_experiment_schedule` until `ppc_experiment_end` or `ppc_experiment_graduate`, it IS
the base campaign's one change for its window, so nothing else lands on that campaign meanwhile.

### 2.4 The diffs that do not look like diffs

These are writes whose "after" state includes things you never mentioned. Each one has bitten someone
because the operator diffed the field they were changing rather than the object they were replacing.

- **`ppc_meta_ad_set_update` targeting replaces the WHOLE spec.** Graph has no partial merge. Whatever
  you send becomes the entire targeting spec and anything omitted is DROPPED (`geo_locations` stays
  mandatory). The spec you need to edit is NOT what `ppc_meta_audiences_list` operation
  `ad-set-audiences` returns: that gives the include and exclude audience lists, their counts, and
  `other_targeting_keys`, which is a sorted list of the REMAINING key NAMES with no values attached.
  It tells you what an overwrite would destroy; it does not tell you what to send back. The one
  whole-spec read in this surface is the synced ad-set row: `ppc_sync({ connection_id })`, then
  `ppc_ad_group_list({ campaign_id })` and take that ad set's `targeting` JSON (Meta's ad-set pull
  stores the full spec there). `campaign_id` on that call is the Hiveku campaign uuid from
  `ppc_campaign_list`, not the Meta campaign id. It is a mirror copy, so it is exactly as fresh as
  that sync. Edit that object, send it back whole. If all you need to change is the audience lists,
  do not hand-write the blob at all: `ppc_meta_ad_set_audiences_update` reads the spec server-side and
  writes it back with only the two audience keys changed, so geo, age, interests and placements
  survive. Editing targeting on a delivering ad set also re-enters the learning phase.
- **`ppc_meta_ad_set_audiences_update` mode `replace` means the lists you pass are the WHOLE lists.**
  Mode `add` merges. This changes delivery on a live ad set immediately, which is why it previews
  first and requires `confirm: true`.
- **`ppc_linkedin_audience_segments` operation `campaign-audiences-update`** has the same
  add-versus-replace shape and the same confirm gate.
- **`ppc_audience_detach` deliberately does NOT change the entity's observation/targeting mode.**
  Detaching the last audience from a targeting-mode ad group makes it serve BROADLY. That is a reach
  expansion disguised as a removal. Decide it explicitly and put it in the `SCOPE` line.
- **`ppc_audience_attach` is a TARGETING criterion**, so it RESTRICTS serving to that audience. If you
  wanted observation plus a bid modifier, the tool is `ppc_bid_modifier_update` with
  `target_type: "audience"` and `bid_modifier: 1.0`.
- **Shared negative lists take effect immediately, everywhere.** `ppc_google_shared_negatives`
  operation `shared-set-keywords-add` starts blocking on every campaign the list is attached to the
  moment it lands, and a broad negative blocks any query containing all the words in any order. The
  Microsoft twin, `ppc_bing_shared_negative_list_items_add`, says the same thing. Their `SCOPE` line
  is a list of campaigns, and the two lanes are not equally able to give it to you. On Google,
  `shared-sets-list` returns member counts AND attached campaigns, so build the line from it before
  you write. On Microsoft there is no equivalent read: `ppc_bing_shared_negative_list_list` returns
  only id, name and item count, and nothing in this surface reads associations back
  (`ppc_bing_shared_negative_list_associate` creates them one campaign at a time and returns no
  roster). Real next step on the Bing lane: log every association in the PM task at the moment you
  create it, and for a list you did not attach yourself, read the attached campaigns out of the
  Microsoft Ads UI before adding items. Do not write to an existing Bing shared list whose blast
  radius you cannot name.
- **`ppc_google_shared_negatives` operation `shared-set-detach` WIDENS reach.** Blocked queries start
  serving again. A detach is a spend-increasing change and gets a spend change's approval.
- **`ppc_keyword_match_type_change` deletes and recreates.** Google cannot mutate match type in place
  because it is part of the criterion's identity, so the tool removes the existing keyword and creates
  a new one, preserving the bid unless `preserve_bid: false`. The old `resource_name` is gone, a new
  one is returned, and quality-score history resets. Your `IF WRONG` line for this one is "the
  keyword's QS history is not recoverable", which is why it belongs in the search-term-evidence lane
  and never in a preemptive tidy-up. The Microsoft variant,
  `ppc_platform_keyword_match_type_change`, may reject in-place edits outright; if it does, the
  documented path is add a new keyword and pause the old one, which is again two objects, not one.

## 3. One at a time, never bulk

### 3.1 Why bulk is the wrong shape for spend changes

A single wrong negative keyword is a recoverable incident: you have the `resource_name` the write
returned, `ppc_negative_keyword_remove` takes it back, and the damage window is one day of a term
you can name.

Fifty applied at once is not recoverable in the same sense, and the reason is not that fifty undos
are hard. It is that fifty were never reviewed. Nobody read the fiftieth line. When traffic drops
next week, the investigation has to reconstruct which of fifty simultaneous changes did it, and
`ppc_search_terms_report` can only show you what stopped appearing, not which negative stopped it.
One wrong broad negative in a batch of fifty can silently remove a converting query family, and the
account looks like it merely had a slow week.

The asymmetry is the whole argument:

- Reviewable means a human can hold the change in their head and say no to it specifically.
- A batch of fifty converts fifty individual decisions into one decision about a list nobody read.
- Recoverability degrades with concurrency, not with count. Fifty changes applied one at a time over
  a week are each attributable. Fifty applied in one call are one undifferentiated event.

Hiveku encodes part of this in code. `ppc_bulk_edit` refuses budget operations outright, returning
`code: budget_op_in_bulk_edit`, with the stated reason that budget changes must go through
`ppc_budget_update`, which enforces the step-cap guardrail that `bulk_edit` would bypass.

### 3.2 The one legitimate bulk

`ppc_bulk_edit` exists for STATUS flips in one round-trip, up to 100 operations per call, and only
three op types: `campaign_status`, `ad_group_status`, `keyword_status`, each `ENABLED` or `PAUSED`.
Its honest use is the "pause everything in campaign X" pattern, where the decision is genuinely one
decision that happens to touch N objects. The response counts `applied` and `skipped_unknown`, so
read both: a high `skipped_unknown` means your ids were stale and the pause you just reported did not
fully happen.

Note the sharp edge: `ppc_bulk_edit` can flip `campaign_status` to `ENABLED`. A batch that reads as
housekeeping can turn on spend. Bulk-enabling is never one decision. Enable one at a time.

### 3.3 Batch the analysis, never the consent

The workable middle, and the rule the hub skill already states:

- Reports, classification and proposals: batch freely. Mine 2,000 search terms in one pass, classify
  every one, write the whole list into the PM task.
- Structure changes that do not move spend (negatives, keyword promotions): summarize the batch,
  present the full list, take ONE approval for that reviewed list, then execute item by item so each
  returned `resource_name` lands in the log.
- Anything that changes what the account spends or how it bids: one change, one diff, one approval.
  Every time. There is no batch size at which this becomes reasonable.

## 4. What Hiveku already enforces

Verified against the source. Two things are worth separating carefully: a rail that lives in CODE and
will refuse you, versus a warning that lives in a tool DESCRIPTION and will not. Both matter, but only
one of them saves you when you are wrong.

### 4.1 The budget guardrail (code, hard, cannot be bypassed from an MCP session)

Implemented in `hiveku_builder/src/lib/marketing/ppc-budget-guardrail.ts`. It is deliberately dumb and
hard:

| Rail | Value | Applies to |
| --- | --- | --- |
| Absolute daily ceiling | 10,000 per day, account currency | every daily-budget write |
| Absolute lifetime/total ceiling | 100,000 | every lifetime/total budget write |
| Step cap | at most 2x the current daily budget, per change | daily budgets only. Google Ads: always (read live from Google). Other platforms: only when the mirror knows the current budget |

A refusal comes back as HTTP 400 with `code: budget_guardrail` and a message telling you to raise in
steps or use the dashboard.

Where it fires: the Google ops budget update and campaign create, the cross-platform budget update,
`ppc_bing_push_campaign`, `ppc_meta_ad_set_create`, `ppc_meta_advantage_create`,
`ppc_linkedin_campaign_group_create` and `ppc_linkedin_campaign_group_update`. In other words, every
budget-bearing create as well as every budget update. As of 2026-08-29 that list gains
`ppc_experiment_graduate` (contract, not yet live-validated): its `daily_budget` becomes the promoted
campaign's budget, so the guardrail runs on it BEFORE the confirm preview in 4.2 is even built, and a
refusal is `code: budget_guardrail` with no preview attached.

Two things you need to know about it:

- **You cannot turn it off.** The routes accept an `override_guardrail` flag for the dashboard UI, but
  that flag appears in NO MCP tool schema, and the Olympus proxy sends only the parameters each tool
  declares in its `bodyParams` allowlist, dropping undeclared arguments. From this session the
  override does not exist. Do not tell a client you can raise a budget past the ceiling; the real next
  step is a human setting it in the dashboard or the ad platform directly.
- **On Google Ads the step cap is now authoritative; everywhere else it is still conditional.**
  There are two implementations and they are not equivalent.

  The builder's check (`ppc-budget-guardrail.ts`) looks the campaign's `daily_budget` up in the local
  `ppc_campaigns` mirror and can only fire when it finds a value greater than zero. That is the rail
  that failed: a campaign created through the tools has no cached budget, a successful update never
  wrote one back, and so a live Google Ads budget went 1 -> 2 -> 50 in three calls with `warning: null`
  (2026-08-30). Two things changed. The route now writes the applied budget back into the mirror, so
  the SECOND change to any campaign is always checked; and the response carries
  `local_guardrail.step_cap_checked_locally`, so "the cap did not apply here" no longer looks
  identical to "the cap checked and was happy". Read that field.

  For **Google Ads** the cap also lives in `budget_update` in the marketing agent's
  `ppc_google_ads.py`, which compares against the budget GOOGLE reports microseconds before the
  mutate. That one cannot be blind, fires on the first change to a brand-new campaign, and returns
  `code: budget_guardrail` with `max_allowed_this_step`. The response's `guardrails` block states the
  ceiling, the multiple, and whether the cap was enforced or overridden.

  For **Microsoft, Meta, LinkedIn, TikTok, Amazon, Vibe and ChatGPT Ads** only the mirror-based check
  exists, so a never-synced campaign still gets the 10,000 ceiling and nothing else. Run
  `ppc_sync({ connection_id })` before a budget write on those platforms. The same applies to a
  graduate: the step cap compares the new `daily_budget` against the BASE campaign's synced budget.

There is also a per-connection MONTHLY guardrail, armed by configuration rather than always-on:
`ppc_budget_target_set({ id, monthly_budget_target_cents })` (integer CENTS — 500000 is $5,000/month) arms a daily budget
sweep; `settings.guardrail.alert_at_pct` (default 85) files inbox alerts at that % of target, and
`settings.guardrail.pause_at_pct` (opt-in) auto-pauses live campaigns at that % of target. Arm it at
onboarding with the client's explicit consent - an auto-pause is a spend change the client must have
pre-approved.

`settings` is now MERGED, not replaced — a `ppc_connection_update` PATCH keeps the keys you do not
send, and `null` deletes one. It used to replace the whole object, so setting a budget target
silently disarmed `guardrail.pause_at_pct`; that is fixed, and `settings_replace: true` is the
deliberate opt-in if you really want the old object gone. Prefer `ppc_budget_target_set` for the
target itself: it merges only that key and cannot touch the guardrail settings at all.

### 4.2 Tools with a real two-step confirm gate (code, verified)

These preview on the first call and execute only when the IDENTICAL call is repeated with
`confirm: true`. The first call returns `requires_confirm: true` plus the numbers you are about to
commit. Show those numbers to the operator. Never auto-confirm by immediately re-firing the call.

| Tool | What is gated, and why |
| --- | --- |
| `ppc_customer_match_upload` | Dry-run preview of member counts and totals. Members must be PRE-HASHED sha256; raw PII is rejected with `code: raw_pii_rejected`. Consent for `ad_user_data` and `ad_personalization` is per regional privacy law - pass GRANTED only when consent was actually collected. |
| `ppc_offline_conversion_upload` | Dry-run preview of row counts and value totals. Partial-failure mode is on: bad rows come back in `results[]` with `ok: false` while good rows land. |
| `ppc_meta_archive` | IRREVERSIBLE through this surface. ARCHIVED at the wire, the entity stops serving permanently. The tool itself tells you to use `ppc_platform_pause_resource` for a temporary stop. |
| `ppc_meta_ad_set_audiences_update` | Changes delivery on a LIVE ad set immediately and re-enters the learning phase. |
| `ppc_linkedin_campaign_update` | Gate is on `operation: "archive"` only. Irreversible. |
| `ppc_linkedin_campaign_group_update` | Gate is on `operation: "archive"` only. Irreversible, and it takes the group's campaigns with it. Budget edits on this tool are guardrailed, hard-capped at 100,000. |
| `ppc_linkedin_creatives` | Gate on `operation: "set-status"` with `status: "enabled"` (enabling can make the ad deliverable immediately) and on `archive`. Pausing needs no confirm - the safe direction is ungated by design. |
| `ppc_linkedin_conversions` | `conversion-event-send` ALWAYS previews, and `conversion-rule-create` previews whenever `default_value` is set. The stated reason: conversion data trains LinkedIn's bidding and uploaded conversions cannot be recalled. |
| `ppc_linkedin_audience_segments` | Gate on `campaign-audiences-update`: it changes delivery on a possibly-live campaign immediately. |
| `ppc_linkedin_abm_segment` | Gate on `company-segment-add`: campaigns targeting the segment start reaching the added companies. Person-level identifiers are REFUSED by policy on this lane. |
| `ppc_experiment_schedule` | STARTS SPENDING on the treatment copy of the base campaign at the experiment's traffic split. The first call (no `confirm`) executes nothing and returns `requires_confirm: true` with the preview (arms, split, dates); the identical call with `confirm: true` executes. Until then the experiment stays in SETUP, serving nothing. New as of 2026-08-29, contract-described, not yet live-validated. |
| `ppc_experiment_graduate` | ADOPTS the treatment into the base campaign as a promoted campaign with a NEW `daily_budget`: a budget raise with a test result attached. The budget guardrail (4.1) runs on `daily_budget` FIRST, then the same two-step confirm as schedule. Its diff's CURRENT line is the base campaign's daily budget today; IF WRONG is the delta times 30. New as of 2026-08-29, contract-described, not yet live-validated. |

Note the pattern across LinkedIn and Meta: the gate is on the direction that starts or expands
delivery, and on anything terminal. Pausing is ungated everywhere. That is a deliberate asymmetry and
a good model for your own judgment where no gate exists. The experiment lane follows it exactly:
schedule and graduate gated, end ungated, create needing no gate because it lands in SETUP.

### 4.3 Warnings that are prose only (they will NOT stop you)

These are documented dangers with no code gate behind them. You are the gate.

| Tool | The documented danger |
| --- | --- |
| `ppc_budget_update` | If the budget is SHARED (`explicitly_shared: true`), the change affects EVERY campaign using it. The response carries an explicit `warning` field and the flag. The tool says confirm before applying shared-budget changes; nothing enforces it. |
| `ppc_recommendation_apply` | Applies Google's auto-generated default parameters, exactly like the UI Apply button. Side effects vary by type and some types are UI-only and return a structured 400. The tool says confirm before applying budget or bidding-strategy recs. |
| `ppc_bidding_strategy_update` | The roughly 7-day learning phase. Surface it to the user. |
| `ppc_keyword_match_type_change` | Removes and recreates the criterion. New `resource_name`, quality-score history resets. |
| `ppc_connection_delete` | HARD delete. Removes the connection row plus all linked campaigns, ad groups, ads and metrics by FK cascade. Not a soft delete. The tool says confirm before calling on a connection with `campaign_count > 0`. There is NO confirm flag on it. |
| `ppc_audience_ops` operation `delete` | Removes the PLATFORM audience; platform-side deletion is not reversible. It refuses with `audience_has_active_sync` while a live CRM sync feeds it, and on Google additionally with `audience_attached_to_criteria` while live criteria target it. `force: true` overrides both and disables the orphaned sync rows. Do not pass `force` to get past a refusal you did not investigate. |
| `ppc_keyword_bid_update` | A no-op for ranking under smart bidding. The response carries a note; read it rather than assuming the write worked as intended. |
| `ppc_bing_shared_negative_list_items_add` | Every campaign already associated with the list starts blocking immediately. |
| `ppc_google_shared_negatives` | `shared-set-keywords-add` takes effect immediately on every attached campaign; `shared-set-attach` starts blocking immediately on that campaign; `shared-set-detach` widens reach. |
| `ppc_negative_keyword_add` | Defaults to BROAD match if you omit `match_type`. A broad negative blocks any query containing the words in any order. Always pass `match_type` explicitly. |
| `ppc_experiment_end` | No confirm flag: a single call, like a pause. The treatment stops serving, the base campaign continues unchanged, and the test cannot be resumed. Ungated because it is the safe direction, but ending early discards every click the treatment has bought, so it still gets a diff and an approval, with each arm's clicks and conversions against the section-9 minimums in the CURRENT line. New as of 2026-08-29, contract-described, not yet live-validated. |

### 4.4 The rails that do not exist

Say these out loud in your own head before you assume you are protected.

- **Enabling has no gate on the Google lane.** `ppc_enable_resource` has no confirm flag and no budget
  check. The builder's own source comment on the campaign-create guardrail states it plainly: "created
  paused" is NOT a rail, because `ppc_enable_resource` has no confirm and no budget check, and
  `ppc_bulk_edit` will flip `campaign_status` to `ENABLED`. Everything that creates paused
  (`ppc_campaign_create`, `ppc_responsive_search_ad_create`, `ppc_bing_push_campaign`,
  `ppc_meta_campaign_push`, `ppc_google_pmax` asset groups) is relying on YOU as the last gate.
- **Bid modifiers have no ceiling.** `ppc_bid_modifier_update` will take any multiplier you send.
- **Bids have no step cap.** `ppc_keyword_bid_update` and `ppc_platform_keyword_bid_update` have
  nothing analogous to the budget guardrail.
- **Pausing has no gate**, correctly. Pausing is the safe direction. But pausing a high-volume campaign
  is still a spend change with a real cost, so it still gets a diff and an approval.

## 5. Verify after writing

A write that returns success is not proof the platform applied it. It is proof the request was
accepted by the route. Between there and the ad platform sit a CLI, an API, partial-failure modes,
and a local mirror that will happily keep showing you the old value.

### 5.1 What confirms what

| Change class | Immediate check | Independent confirmation |
| --- | --- | --- |
| Google daily budget | The response returns `old_daily_budget` and `new_daily_budget`; read `explicitly_shared` | `ppc_sync` then `ppc_campaign_get`, plus `ppc_pacing_summary` the next day for actual spend behavior |
| Cross-platform budget | Response payload | `ppc_sync` then `ppc_campaign_get` / `ppc_campaign_list` |
| Bidding strategy | Response payload | `ppc_sync` then `ppc_campaign_get` (the strategy field), and `ppc_change_history`, which records the API-client change and needs no sync |
| Keyword bid | The response note about whether the bid is honored under the current strategy | `ppc_keyword_list` for the stored bid |
| Bid modifier | Response payload | `ppc_audience_performance` (audience modifiers report `bid_modifier`), or `ppc_segment_report` for the segment's behavior over the following days |
| Negative keyword (Google) | The returned `resource_name` - capture it, it is the only handle `ppc_negative_keyword_remove` accepts | `ppc_search_terms_report` over the following week: the blocked term should stop appearing |
| Negative keyword (Microsoft) | Response payload | `ppc_bing_search_terms_report` |
| Shared negative list (Google) | Response payload | `ppc_google_shared_negatives` operation `shared-sets-list` - member counts AND attached campaigns |
| Shared negative list (Microsoft) | Response payload | `ppc_bing_shared_negative_list_list` confirms the item count moved. WHICH campaigns the list blocks on is not readable in this surface - Microsoft Ads UI, or your own association log |
| Keyword add or match-type change | The returned `criterion_id` and new `resource_name`, plus the OLD `resource_name` that is now removed | `ppc_keyword_list` - the new criterion present, the old absent |
| Pause or enable (any platform) | Response payload | `ppc_sync` then `ppc_campaign_list` / `ppc_ad_group_list` / `ppc_ad_list` filtered by status |
| Bulk status flip | `applied` and `skipped_unknown` counts in the response - read BOTH | Same status reads as above |
| New RSA | Response payload | `ppc_ad_list`, then `ppc_disapprovals_list` a day later; a new ad can be disapproved after it is created |
| PMax asset group | Response servability note | `ppc_google_pmax` operation `asset-group-list` - `missing_requirements` and `primary_status` |
| Campaign experiment (schedule, end, graduate) | The `confirm: true` response (schedule, graduate) or the single-call response (end) | `ppc_experiments_list` - `status` off SETUP after a schedule, ended after an end; after a graduate, `ppc_sync` then `ppc_campaign_get` on the base campaign for the new `daily_budget`, plus `ppc_change_history` for the API-client write. Per-arm metrics have no confirmed read on this surface yet (`google-ads-advanced.md` 11.2). Contract-described as of 2026-08-29, not yet live-validated |
| Offline conversion upload | `results[]` per row, checking every `ok: false` | `ppc_conversion_tracking_status` and `ppc_segment_report({ dimensions: ["conversion_action"] })` a few hours later; conversions are not instant |
| Customer match upload | The confirm-call response | `ppc_google_user_lists` operation `user-lists-list` for sizes and eligibility. The job runs async on Google's side and audience sizes take 24 to 48 hours |
| Audience sync (any platform) | `processed_adds` / `processed_removes` / `remaining` from `ppc_audience_ops` `process-pending` | `ppc_audience_ops` operation `stats`, which returns `matched_count` where the platform reports one, else null |
| Meta ad set targeting | Response payload | `ppc_sync` then `ppc_ad_group_list` - diff the ad set row's `targeting` JSON against what you sent, because omitted fields were dropped. `ad-set-audiences` is a partial check only: it confirms the audience lists and NAMES the surviving top-level keys, so it catches a dropped key but never a changed value |
| Anything at all, on Google | - | `ppc_change_history` shows your own write with `client_type` GOOGLE_ADS_API, and only reaches 30 days back |
| Anything written from a Hiveku MCP session, any platform | - | `audit_query` (always-available on every key profile) reads the account's MCP audit log: every tool call with key preview (last 10 chars), tool name, sanitized args summary, status, duration. Filters compose with AND (`tool_name`, `tool_contains`, `args_contains`, `since`, `status`). It answers "which key did what" for disputed changes - but records only Hiveku-side calls, never edits made in a platform UI |

### 5.2 The ordering rule

`ppc_sync` between the write and the cached read, or you are verifying against the pre-write mirror
and will confidently report a change that did not land. `ppc_change_history` and the platform reports
run on the live ops lane and do not need it. Every mirror-backed read from 1.3 does:
`ppc_campaign_list`, `ppc_ad_group_list`, `ppc_ad_list`, `ppc_campaign_get`, `ppc_metrics` and
`ppc_digest`.

`ppc_campaign_get` is the one that catches people out. It reads like a live fetch of a single named
object, and it is a lookup of one `ppc_campaigns` row in the local mirror. Verifying a budget or a
bidding-strategy write with it and no sync in between reads back the value you just tried to change
and reports success.

### 5.3 Where verification is genuinely not available

Say this plainly rather than implying a check you cannot run.

- **Google Ads asset links.** `ppc_asset_create`, `ppc_asset_attach` and `ppc_asset_detach` exist, but
  there is NO tool in this surface that lists an account's asset links, and `ppc_google_ads_read` has
  no asset action either. Real next step: capture the link `resource_name` that `ppc_asset_attach`
  returns into the PM task (it is the only handle `ppc_asset_detach` accepts), and confirm the
  attachment visually in the Ads UI, or infer it from `ppc_change_history` within the 30-day window.
- **Detailed invoices and spend breakdowns.** `ppc_billing_summary` surfaces what the Ads API exposes:
  payments accounts, billing status, start and end dates. It says outright that detailed invoice and
  spend breakdowns are not in the Ads API. Real next step: the Ads UI Billing section, or the separate
  Cloud Billing API. Do not reconcile a client invoice from `ppc_metrics` and call it billing.
- **Whether a not-yet-live-validated write path did what the client thinks.** For
  `ppc_meta_campaign_update`, `ppc_meta_ad_set_update`, `ppc_meta_campaign_push`,
  `ppc_linkedin_conversions`, `ppc_linkedin_audience_segments`, `ppc_linkedin_abm_segment` and, as of
  2026-08-29, the five `ppc_experiment*` tools, verify by reading the object back through its platform
  read tool and, on the first use per account, in the platform's own UI. Then record in account memory
  that the lane is now validated for this account.

## 6. Never do these unprompted

Not "ask nicely first". These are never the right thing to do on your own initiative, no matter how
strongly the data supports them. Propose, diff, wait.

1. **Enabling a paused campaign.** Paused is a decision someone made. It may be a budget freeze, a
   seasonal stop, a legal hold, or a client who fired the previous agency mid-flight. Enabling is the
   single fastest way to spend money you were not asked to spend, it has NO confirm gate and NO budget
   check on the Google lane, and "it was clearly paused by mistake" is a conclusion you are not in a
   position to reach. Check `memory_list({ domain: "ppc" })` for protected campaigns and
   `ppc_change_history` for who paused it, then ask.
2. **Raising a budget.** Even a well-evidenced raise, even a small one, even inside the guardrail. The
   guardrail's 10,000 ceiling and 2x step cap are the limits of catastrophe, not a mandate. The client's
   monthly ceiling is the real number and it lives in account memory. `ppc_experiment_graduate` is a
   budget raise: its `daily_budget` is exactly this, however good the test result looks.
3. **Applying negatives in bulk.** One at a time against reviewed evidence, or one approval for a list
   the operator actually read. Never a loop over a report. And never on a shared negative list without
   first listing the campaigns that list is attached to.
4. **Changing a bid strategy on a learning campaign.** If the campaign switched strategies inside the
   last 7 days, or launched inside the last 7 days, it is learning. Changing again restarts the clock
   and destroys the only signal that would have told you whether the first change worked. The hub
   skill's rule is one strategy change per campaign per 2 weeks; treat the learning window as a freeze
   on that campaign, not just on its strategy. A campaign experiment counts against the same velocity
   rule: from a confirmed schedule to its end or graduate it is the base campaign's one change for its
   window, so no strategy, budget, geo or shared-negative change on that campaign while it runs, and no
   scheduling an experiment on a campaign still inside a learning phase. Stacking the two makes both
   unreadable.

Four more that belong in the same tier because they are irreversible or invisible:

5. **Archiving anything.** `ppc_meta_archive` and the LinkedIn archive operations are terminal, and
   they are gated for exactly that reason. Pause instead, and let the client decide about archiving.
6. **Deleting a connection.** `ppc_connection_delete` cascades away every campaign, ad group, ad and
   metric row for that connection. That is the account's local history, including the baselines your
   monthly reports compare against.
7. **Deleting a platform audience with `force: true`.** The refusals (`audience_has_active_sync`,
   `audience_attached_to_criteria`) are telling you something is still using it.
8. **Blanket-applying Google recommendations.** Google is a counterparty, and its recommendations
   usually raise your spend on its inventory. `ppc_recommendation_apply` takes one `resource_name` at
   a time; keep it that way. Never loop it over `ppc_recommendations_list` to chase Optimization Score.

## 7. The pre-flight card

Paste this into the PM task comment for each spend change, filled in, before the write. It is the
audit trail and the approval record in one artifact, and it is what the next session reads when it
asks why the account looks different.

```
DATE / SESSION:
ACCOUNT + CONNECTION:   <account>  connection_id <uuid>  platform <google_ads|...>
OBJECT:                 <type + platform id + human name>
READ THAT JUSTIFIES IT: <tool + window + the specific numbers>
FRESHNESS:              last ppc_sync <when>   (mirror-backed reads only)
CHANGE:                 <tool + exact args>
CURRENT -> PROPOSED:    <value> -> <value>
IF WRONG:               <money, and time-to-notice>
SCOPE:                  <every object affected, incl. shared budgets / shared lists>
RAILS IN PLAY:          <guardrail? confirm gate? none - name which>
APPROVED BY / WHEN:     <who said yes to THIS change>
WRITE RESPONSE:         <resource_name / old+new values / applied+skipped counts>
VERIFIED BY:            <the read from section 5.1, and what it showed>
UNDO HANDLE:            <tool + identifier, or "none - irreversible">
```

If any line is blank, the change is still a draft.
