# Outbound health + metrics - field semantics, thresholds, and honest reporting windows

Load this before quoting any outbound number to a client, interpreting `outbound_health_status`,
or writing the monthly report.

## `outbound_health_status` - what one call returns

One no-argument call returns the whole picture: `blockers[]`, `warnings[]`, `readinessScore`
(0-100), `healthStatus` (healthy | warning | critical), `replyCoverage` (24h reply SLA),
per-mailbox `inboxHealth[]` (email, status, warmupScore, dailySent, dailyLimit), and `metrics`
(activeCampaigns, draftCampaigns, totalInboxes, healthyInboxes, warmingInboxes, totalSent,
bounceRate, unsubRate, pendingReplies, positiveReplies, overdueReplies). Bounce rate, unsub rate,
and warmup state live on campaign/mailbox counters and CANNOT be reconstructed from lead rows -
do not try.

**Know what `totalSent`, `bounceRate` and `unsubRate` actually are before you quote them:**
they are summed over campaigns with `status: 'ACTIVE'` ONLY, with NO date filter. They are
lifetime totals for the currently-active campaigns - every paused, completed and draft
campaign is excluded, so pausing a campaign makes historical volume disappear from them. They
are a live-risk gauge, never a period figure. Label them "lifetime, active campaigns only"
whenever they leave this session.

## The server's own thresholds (so your advice matches the score it reports)

- Bounce rate > 10% -> **blocker** (readiness -30). > 5% -> warning (-15). > 2% -> warning (-5).
- Unsubscribe rate > 2% -> warning (-10).
- No connected inboxes -> **blocker** (-40). Fewer than 3 -> warning (-10). No inbox warming ->
  warning (-5). Mailboxes with warmup reputation < 50 or > 90% of daily limit -> warning (-10).
- More than 5 unhandled positive replies -> **blocker** ("revenue at risk"). 1-5 -> warning.
- More than 5 replies over 24h old -> warning (SLA at risk).

The score DECOMPOSES into those named checks - report the failing checks, never the bare number.
A high readinessScore with an unresolved warning underneath it is not "healthy"; a client can
have a clean score and still be one bounce spike from a burned domain.

Agency standards are TIGHTER than the server's blocker line - hold to them regardless of score:

- Bounce rate > 3% on any campaign -> PAUSE the campaign with
  `outbound_campaign_status_set({ campaign_id, status: "PAUSED" })` (executes immediately, no
  confirm - it is the emergency brake), re-verify the remaining list, investigate, and resume
  only with `outbound_campaign_status_set({ campaign_id, status: "START" })` after its preview
  and an explicit yes (`confirm: true` on the second call).
- Spam complaint rate > 0.1% -> PAUSE the same way and rework the copy/targeting. Complaints
  compound. (Complaint rate is NOT in `metrics` and NOT in `outbound_campaign_analytics_get`
  either - read it from SmartLead's own dashboard analytics.)
- Reply rate collapsing on a previously-working campaign -> suspect inbox placement, not copy;
  rotate mailboxes and cut volume 50% while testing placement.

An agent-driven pause causes the artifact described above: the moment the campaign leaves
ACTIVE, its lifetime volume drops out of `totalSent` / `bounceRate` / `unsubRate` retroactively.
Say so in the same message as the pause, and source any period figure from
`outbound_campaign_analytics_get({ campaign_id, start_date, end_date })` - the one date-windowed
sending read - never from the health metrics.

## Measurement-artifact-first triage

Before any causal story ("copy fatigue", "deliverability collapse", "the list went bad"), rule
out measurement artifacts - the data pipeline moves more often than the audience does:

- `totalSent`/`bounceRate` dropped -> was a campaign paused, in the dashboard or by this
  session's own `outbound_campaign_status_set`? (ACTIVE-only summing makes history vanish.)
  Check `outbound_list_campaigns` statuses first, and `audit_query({ tool_contains:
  "outbound_campaign_status_set" })` for a tool-driven pause.
- Reply counts flat -> is the inbox sync running and are replies landing out-of-band in the
  connected mailbox instead? (`gmail_inbox_lead_replies` on a sales-profile key.)
- Open rate moved -> did open tracking get toggled, or a tracking domain change? Pixel-based
  opens are an unstable instrument (see below), not a behavior metric.
- A wall of `pending_sync` leads -> a healthy fresh load, not a failure.

Only after artifacts are excluded do you reason about audience, copy, or placement. Do not alert
on percentage changes with trivial denominators (3 replies -> 6 replies is not "+100%") or across
incomparable windows.

## Open-rate honesty

Open tracking pixels themselves hurt deliverability and inflate/deflate numbers. Prefer reply
rate as the north-star metric; if open tracking is on, treat 40-60% as healthy and anything
under ~30% as a placement problem.

## Reporting windows - the monthly report's accounting rules

**Exactly one outbound MCP tool returns a date-windowed sending figure:
`outbound_campaign_analytics_get` with BOTH `start_date` and `end_date`. Every other outbound
number is lifetime-to-date - do not present one as monthly.**

- `outbound_health_status` metrics are lifetime totals over ACTIVE campaigns only - wrong on both
  axes for a month, and they shrink retroactively when a campaign is paused (including a pause
  this session made with `outbound_campaign_status_set`). Never source a monthly number from
  them.
- `outbound_list_campaigns` counters (`sent_count`, `reply_count`, `positive_reply_count`,
  `bounce_count`, `unsubscribe_count`, `total_leads`) cover EVERY status, which fixes the
  active-only bias, but they are still lifetime-to-date per campaign, not a month. Hiveku's
  mirrored counters stay lifetime totals - the new analytics read does not change that.
- `outbound_campaign_analytics_get({ campaign_id, start_date?, end_date?, timezone? })` - the
  provider's own numbers, read-only. `lifetime` (`sent_count`, `unique_sent_count`,
  `open_count`, `unique_open_count`, `click_count`, `unique_click_count`, `reply_count`,
  `bounce_count`, `unsubscribe_count`, `total_lead_count`) is still lifetime;
  `window.sequence_analytics`, returned only when both YYYY-MM-DD dates are given, is the
  per-step breakdown inside those dates. It is per campaign - a month across campaigns is one
  call per campaign, and the results are summed only after the comparability gate below.
  Complaint rate is not in it.
- Two honest ways to report a month: (a) pull `window.sequence_analytics` per campaign for the
  month's dates and label it provider-sourced, per step, per campaign; or (b) take the
  `outbound_list_campaigns` counters across all statuses and diff them against the same counters
  saved in last month's `reports/outbound-YYYY-MM.md` - state plainly that it is a month-over-month
  delta of cumulative counters. If neither is available, report the lifetime figure and LABEL it
  lifetime. Do not silently retitle a lifetime number as this month's.
- NOT from `email_stats`: it covers Hiveku's own transactional/marketing email and has zero
  visibility into cold sending. Never sum the two channels.

## The comparability gate

Do not aggregate numbers across sources (Hiveku counters, `outbound_campaign_analytics_get`,
SmartLead dashboard analytics, HeyReach exports, CRM reports) until they share the same window,
the same event definition (a "reply" that excludes out-of-office vs one that counts it), and the
same population. Until then, report the values side by side, each labeled with its source and
window - do not compute a total. The same rule inside one source: never sum ACTIVE-only health
metrics with all-status campaign counters, and never sum the analytics read's `lifetime` block
with its `window` block.

## Honest verdicts (closed vocabulary)

When the weekly review or monthly report emits a verdict per check or per channel, use
pass | fail | unknown | not_applicable. Unknown and not_applicable are valid outputs and must
never be converted into passes. A source that failed to return (SmartLead API down, HeyReach
export missing) makes the report **partial**, not zero for that channel - exclude it from any
denominator, label the report partial, and say which channel is missing. Never hide partial
status in the executive summary, and surface contradictions between sources instead of averaging
them away.

## Sample transparency

Any aggregate the report carries must disclose N, how the sample was selected, and what was
excluded: "reply rate 4.2% (N=612 sends across 2 active campaigns; excludes the paused
March campaign and 38 pending_sync leads never contacted)". An A/B verdict discloses sends per
variant; below ~100-150 sends per variant it is labeled "insufficient volume", not called.

## Downstream pipeline numbers

For the client-facing pipeline story, pair `crm_list_deals` / `crm_report_pipeline_summary` with:

- `crm_report_activity_summary` - calls / emails / meetings / tasks counts over a date range
  (defaults: last 7 days) - the one genuinely date-windowed activity read.
- `crm_pipeline_velocity` - approximate mean dwell time per stage in days, computed from
  stage_history JSON on each deal. Best-effort: it depends on stage-change paths populating that
  array, so label it approximate.
- `crm_report_conversion_funnel` for the stage-to-stage picture.

All are `crm_`-prefixed: visible on a sales-profile or full key, NOT on marketing/marketing-email
keys (which see only the seven contact tools).

If a number is not in one of the sources named above, say where it came from or leave it out - a
fabricated metric in a client report is worse than a gap, and a mislabeled window is worse than
both. Every number in the report must trace to a tool call in this session; a channel with no
data connection gets a "no data connection" line, never an estimate.
