---
description: "\"Which ads made the phone ring?\" / \"how many calls did the campaign drive?\" / \"what's our cost per call?\" - the paid-ads call report: attribution breakdown in the ad account's timezone, the suspect-band drill-down with transcripts, outbox health, and a CPL with its definition stated."
argument-hint: "[period - e.g. 'last month' or 'the last 14 days']"
---
Paid-ads call report for: $ARGUMENTS. Follow the **hiveku-phone-agency** skill - load
`references/conversion-send-back.md` first; the four call lanes, the outbox retry taxonomy, and
the report doctrine live there.

1. `marketing_call_attribution_breakdown` for the period - pass the AD ACCOUNT'S IANA timezone
   (not the office's, not UTC), or the day boundaries will not match the platform's own report and
   every comparison below turns into an argument. If `totals.truncated` is true, SAY SO in the
   report - the totals are a floor, not the number.
2. `marketing_call_attribution_list` for the suspect band - the campaign, day range, or source
   whose numbers look wrong - and pull `marketing_call_transcript_get` (it takes the `id` from those
   attribution rows and resolves on the PPC key) on individual calls where qualification is
   disputed ("was that a real lead or a robocall?"). Quote only the lines that settle the dispute
   (the caller's ask and the qualifying exchange), never the whole transcript - it is verbatim and
   unredacted and can carry card numbers, dates of birth and health details - and do not
   characterize what you did not quote.
   A missing transcript is one of five named `transcript_state` values, never an empty call -
   report the state, not "no transcript".
3. `voice_call_tracking_outbox` - `status: 'failed'` first. Failed uploads mean the platform is
   MISSING conversions Hiveku recorded; that gap is a finding in its own right, and it explains
   "Google shows fewer calls than we got" without anyone's math being wrong. Google call uploads go
   through Google's Data Manager API: a row with `error_code` `needs_reconnect` is HELD, not failed -
   mint the link with `integration_connect_link_create({ connector: 'google_ads',
   target_connection_id: <the row's connection_id>, source: 'agent' })` and hand it to whoever
   manages the ads (never the dashboard; held rows restart after the reconnect; on a marketing-ads key
   that tool is not visible, so a full-key session runs `/hiveku:connect-integration`), then prove the path
   with `ppc_google_upload_validate` (`lane: 'call'`). `needs_setup` is not a reconnect.
   Google's OWN call count is a different lane: `ppc_google_call_performance_report` counts only
   calls Google routed itself (call assets, Google forwarding numbers), so zero there beside real
   calls in Hiveku usually means the calls came through the site's or a Hiveku number. Report the
   two side by side, labeled.
4. A period of ZERO recorded calls is a pipe question before it is a market answer:
   `voice_call_tracking_trace({ connection_id })` first (read-only, never dials: every number
   serving on the ads, where each rings right now, and recent outcomes - `recent_calls_refused`
   means calls are dying before anyone can answer), then `/hiveku:call-tracking` health
   (`voice_call_tracking_diagnose`, reading its ordered `fix_first` list) before writing "the ads
   drove no calls" into anything a client will see. A dead pool, a number routed nowhere and a dead
   campaign produce the same zero.
5. CPL - and STATE the definition of a qualified call in the same sentence as the number (minimum
   duration, disposition, first-time caller, whatever this account's config actually says). A CPL
   without its definition is unfalsifiable and will be quoted out of context.
6. The three-sentence client answer, in this shape: what the ads drove (Hiveku-recorded, with the
   qualification definition), what it cost per qualified call, and the one thing to change or
   watch next period.

**Report** in this order: the breakdown by source and campaign in the ad account's timezone
(truncation stated) → the suspect-band findings with transcript evidence → outbox health and what
the platform is missing → CPL with its definition → the three-sentence client answer.

**What NOT to do.** NEVER sum platform-reported and Hiveku-recorded conversions - they share
neither definition, attribution window, nor timezone; report them side by side, each labeled.
Never present a truncated total as complete. Never compute a CPL without stating the
qualified-call definition. Never paraphrase a transcript into a stronger claim than the words
support.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
