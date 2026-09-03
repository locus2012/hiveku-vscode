# Forecasting, diagnostics, rep coaching, and the monthly report

Load this file before quoting any number to the owner. Two disciplines govern everything here:
every figure traces to a tool call in this session (a number with no tool behind it does not get
reported), and unavailable is never zero.

## Weekly forecast

- `crm_forecast_weighted({ pipeline_id })` - SUM(value x stage_probability/100), per-stage breakdown +
  grand total. Sanity-check it: strip deals with past-due close dates or no activity in 21+ days before
  quoting a number to the owner - call out what you excluded and why.
- Track week-over-week delta. The delta and its cause (deals advanced, slipped, died, created) IS the
  forecast story.
- **Sample transparency on every aggregate.** Disclose N, the window, how rows were selected, and
  what was excluded. The format: "Forecast $84k (12 open deals, next 90 days; excluded 3
  past-due-close deals worth $22k, listed below)." A number without its exclusions is a number the
  owner cannot audit.

## Diagnostics - where deals die

- `crm_report_pipeline_summary({ pipeline_id })` - open deal counts and weighted/total $ per stage.
  CURRENT STATE ONLY: it takes no date range and returns no created/won/lost breakdown (it largely
  duplicates `crm_pipeline_stage_summary`). Never present it as period activity.
- `crm_report_conversion_funnel({ pipeline_id })` - stage-to-stage conversion rates; compare against
  the benchmarks below to find the broken stage. No date range either - it is the funnel as
  it stands.
- `crm_report_stage_transitions({ pipeline_id, date_from, date_to })` - raw stage-movement events in
  a date range. All three arguments are optional; omit pipeline_id to span every pipeline. This is
  the ONLY period-scoped movement source, so it is what verifies a bottleneck hypothesis (lots of
  entries into Proposal, few exits) and what you cite for load-bearing claims.
- `crm_report_loss_reasons` - closed-lost deals over a window bucketed by `lost_reason_code`:
  `rows` of { code, count, total_value } sorted count-desc, an `uncoded` bucket with its own
  count and total_value, totals, and `lost_statuses_counted` (the account's is_lost-flagged
  statuses plus the literal 'lost' / 'closed_lost' slugs - the echo tells you exactly what was
  counted). This is where no-decision death becomes visible in AGGREGATE: one ghosted deal is
  an anecdote; "no_decision + ghosted is 40% of lost dollars this quarter" is a coaching
  agenda, and usually a bigger one than any competitor. Two honesty rules. First, the
  `uncoded` bucket is MIGRATION DEBT - deals closed before the code existed, or closed
  sloppily since - so report it as its own line ("N lost deals / $X carry no code"), never
  fold it into 'other' and never omit it; a shrinking uncoded bucket is itself a
  close-out-discipline metric worth tracking month over month. Second, dating: the window
  filters on `closed_at` (the actual close timestamp, stamped by every close writer and cleared
  on reopen); rows still carrying no closed_at fall back to updated_at, and the response counts
  them in `dating.fallback_updated_at_rows` - quote that count next to the number. Deals closed
  before 2026-08-29 carry a backfilled proxy (close_date, else updated_at) rather than a true
  close timestamp, so a window that reaches before that date is approximate there;
  stage_history remains the audit trail for exact stage dates.
- **Measurement artifacts before narratives.** Before any causal story (rep slump, market
  softening, ICP drift), rule out the instrument: unlogged activities make a worked pipeline read
  as a dead one (principle 3 discipline gap, not a market signal); `crm_rep_win_leaderboard` dates
  wins by closed_at, but pre-2026-08-29 closes carry a backfilled proxy and null rows fall back to
  updated_at (`dating.fallback_updated_at_rows` - read it before trusting a period cut), and an
  ownerless win sits on the `unattributed` line rather than under a rep; `crm_contacts_top_scored`
  hides never-scored contacts; and a current-state funnel misread as period activity manufactures
  trends out of snapshots. The data being fine and the interpretation wrong is the default failure
  mode - check the instrument, then talk about the market.

## Rep coaching signals

- `crm_report_activity_summary({ date_from, date_to })` - activity volume by type over the range
  (defaults to the last 7 days).
- `crm_activity_leaderboard({ days })` - activity by rep, rolling window (default 30, max 365). Low
  activity + low pipeline = effort problem; high activity + low wins = quality/skill problem.
  Different coaching, so diagnose before advising.
- `crm_rep_win_leaderboard({ days })` - closed-won count and value by rep (default 90, max 365).
  It dates wins on `closed_at` (rows still null fall back to updated_at; the count is reported as
  `dating.fallback_updated_at_rows` - quote it), attributes on `deal.owner_id`, and reports
  ownerless wins on an `unattributed` line - never dropped, so report that line and fix the
  owners (`crm_update_deal({ deal_id, owner_id })`, listed and confirmed) rather than letting
  credit vanish. Until 2026-08-29 it filtered on a `closed_won` status nothing writes and
  returned EMPTY for every account - a historical empty result was that dead filter, not zero
  wins. Confirm load-bearing claims against `crm_report_stage_transitions`. Pair with the
  activity leaderboard to separate hustle from conversion skill. Frame findings as coaching
  points, not blame.
- Before you call it a skill problem, read two or three call transcripts from the rep in question:
  `crm_calls_list({ contact_id, has_transcript: true })` (also filterable by deal_id or free-text
  `search`). Coach the specific questioning gap, not the aggregate.

## Quota and attainment (`crm_quota_*` records + `crm_report_attainment`)

Quotas are real records: a revenue target per period, for the team or for one rep. When the owner
asks "are we on pace?", the answer is one read - after the quota row exists.

- **Set or update**: `crm_quota_set({ user_id?, period_start, period_end, amount_cents, currency?,
  label?, notes? })`. `user_id` omitted (or null) = the TEAM quota; a user UUID from
  `crm_list_users` = that rep's quota. Dates are YYYY-MM-DD inclusive; `amount_cents` is a
  non-negative integer in CENTS ($150,000 = 15000000). It UPSERTS by (scope, period): the same
  scope + period is updated, never duplicated (`action: 'created' | 'updated'`), and the row comes
  back with `scope: 'team' | 'user'`. 400 on bad dates/amount or a user not on this account. To
  change an amount, call it again with the same scope + period. It is an internal record, not a
  send-gated write - but read the period and amount back to the owner before writing it, and
  never back into a target from past performance and save that as the quota.
- **List**: `crm_quotas_list({ user_id?, active_on?, page?, limit? })` - `user_id: 'team'` lists
  only team quotas, a UUID only that rep's; `active_on` (YYYY-MM-DD) keeps quotas whose period
  contains that day. Newest period first; limit default 50, max 200. No row for the period = ask
  the owner for the number and set it before reporting attainment.
- **Delete**: `crm_quota_delete({ quota_id })` - 404 when not on this account. Only for a wrong
  row the owner names; an amount change is a `crm_quota_set` upsert, not delete-and-recreate.
- **Migration note.** Quotas set before this wave lived in sales department memory as a
  structured `QUOTA ...` line. When `memory_list({ domain: "sales" })` shows one, migrate it with
  `crm_quota_set` (confirm the period and amount with the owner), then remove the memory line in
  the same read-merge-write so the two sources cannot disagree.

**Attainment and pacing** = `crm_report_attainment({ period_start?, period_end?, user_id?,
pipeline_id? })`. Default window = the current calendar quarter. It returns `window`
{period_start, period_end, days}, `won_statuses_counted`, `dating` {basis: 'closed_at',
fallback_updated_at_rows}, `quotas` {team, by_user[]} (each with `period_match: 'exact' |
'overlap'` and `prorated_amount_cents`), `won` {total_cents, deal_count, by_user[], unattributed},
`attainment` {team: {quota_cents, quota_basis, won_cents, attainment_pct, gap_cents,
projected_pct} | null, by_user[]}, and `pacing` {days_elapsed, days_total, expected_share_pct,
on_pace, weighted_open_forecast_cents, open_deals_due_in_window, note}. Attach the three caveats
EVERY time attainment is quoted:
  1. Won = deals in a won status (the account's is_won slugs plus the 'won' and 'closed_won'
     slugs - the `won_statuses_counted` echo says exactly what was counted) dated by `closed_at`;
     rows with no closed_at fall back to updated_at and are COUNTED in
     `dating.fallback_updated_at_rows` - report that count alongside the dollars.
  2. Attribution = `deal.owner_id`. Ownerless wins land on the `unattributed` line, never dropped:
     report it, and fix it with `crm_update_deal({ deal_id, owner_id })` (listed, confirmed)
     rather than leaving credit on the floor.
  3. Closes before 2026-08-29 carry a backfilled proxy (close_date, else updated_at) rather than a
     true close timestamp, so a window that reaches before that date is approximate there.
- `projected_pct` adds the open weighted forecast (value x stage probability) for open deals whose
  close_date falls in the window - the sanity-stripping rule at the top of this file applies:
  stale close dates inflate the projection, so fix them before quoting it. A quota that only
  overlaps the window is prorated by days and labeled `'overlap'` - say so when you quote it.
- Say the mechanism out loud in the report ("quota from crm_quotas_list, exact period; won dollars by
  closed_at, N rows on the updated_at fallback; unattributed $X") - the reader deserves to know
  what was counted.

## Monthly report (deliverable)

Structure, in markdown, saved to reports/ in the workspace AND persisted with `memory_create`
(domain sales) so next month's report can cite the trend:
1. Headline: pipeline created / advanced / won / lost this month (dollars and count), and lost
   dollars get their WHY: `crm_report_loss_reasons` by code, with the uncoded bucket as its own
   line (closed_at-dated; quote `dating.fallback_updated_at_rows`). **Say which call produced
   each number.** Advanced comes from `crm_report_stage_transitions({ date_from, date_to })` -
   the only period-scoped movement read. Won comes from `crm_report_attainment({ period_start,
   period_end })` - `won.total_cents` and `won.deal_count` for the window, closed_at-dated, with
   `won.by_user[]` and the `unattributed` line. Lost totals come from `crm_report_loss_reasons`
   over the same window. Created still has no period-filtered endpoint: pull
   `crm_list_deals({ status, pipeline_id, limit })` and bucket the rows by their own created_at
   yourself (there is no date parameter on that tool). If a number cannot be derived that way,
   print "not available from the CRM tools" - never substitute an open-pipeline figure from
   `crm_report_pipeline_summary` for period activity.
2. Conversion funnel by stage vs last month, with the one broken stage named. The funnel tool is
   current-state, so the month-over-month comparison only exists if you saved last month's figures
   to memory - cite the stored snapshot or say the comparison is unavailable.
3. Activity health: touches by type and rep, leaderboards, logging-discipline note.
4. Forecast: weighted number, what was excluded and why, delta vs last month.
5. Focus list: top 5 deals to win next month, each with its concrete next step and owner.
6. Sequence program: enrollments and open/click rates per step from `crm_sequence_analytics`,
   reply and booking rates per sequence from `crm_sequences_compare` (analytics has neither); what
   gets rewritten or cloned.

### Report honesty rules (closed vocabulary)

- Every metric in the report is one of: **reported** (with its tool call named), **not available**
  (the tools cannot produce it), or **not applicable** (the account does not run that motion).
  not-available and not-applicable NEVER convert to zero, to a pass, or to a flat trend - "no
  funnel snapshot from last month" is "comparison unavailable", not "unchanged".
- A failed or disconnected source makes the report **partial, not smaller**: say in the headline
  which section is missing and why, exclude that source from any denominator, and never average a
  gap away. Do not hide partial status in the summary the owner actually reads.
- Surface contradictions instead of reconciling them silently: if the win leaderboard and the
  stage-transition read disagree, show both with their definitions (closed_at dating with its
  fallback count vs movement events) and say which one you trust for this claim and why.

## Benchmarks + decision rules

Stage conversion norms (B2B services baseline - recalibrate from `crm_report_conversion_funnel` after
one quarter of clean data):
- New lead → Qualified: 25-40%. Below 20% = targeting/ICP problem, revisit lead sources.
- Qualified → Proposal: 40-60%. Below 35% = discovery quality problem (coach questioning).
- Proposal → Negotiation/Verbal: 30-50%. Below 25% = pricing/packaging or proposal quality problem.
- Negotiation → Won: 60-80%. Below 50% = closing-stage discipline problem (unqualified "negotiations").
- Overall lead → win of 5-15% is normal; the fix always targets the single worst stage, not "everything".

Comparison ladder: this account's own prior period beats every benchmark; the norms above are
broad-market and directional only. Never present "we are below the 25-40% band" as a measured
decline - a decline is two of the account's own periods, compared.

Follow-up cadence: 3-5 touches over 2 weeks on an active thread (mix email/call/value-add), then move
to nurture - do not keep hammering. Every touch adds something (insight, case study, specific question);
never send a bare "bumping this".

Response SLAs: hot inbound draft within 1 business hour; all inbound same business day; sequence
replies within 4 business hours during the work week.

(Sequence floors - reply/open-rate thresholds and the A/B racing rules - live in
`references/sequence-program.md`, next to the tools that measure them.)

## Reporting pitfalls (restated at the surface)

- **Velocity numbers are best-effort** (derived from stage_history). Treat `crm_pipeline_velocity` as
  directional; trust `crm_report_stage_transitions({ pipeline_id, date_from, date_to })` for
  load-bearing claims - its arguments are date_from/date_to, not from/to.
- **`crm_report_pipeline_summary` and `crm_report_conversion_funnel` have no date range.** They are
  current-state reads. Period totals come from the dated reports - won from
  `crm_report_attainment`, lost from `crm_report_loss_reasons`, both on closed_at - and created
  still has no period endpoint (derive it per the report recipe above and say so). Never present
  a snapshot as period activity.
