# Measurement and Conversions: tracking integrity, offline import, metrics, anomalies, reporting

## What this covers / when to load this

The truth layer of the account. Every other PPC play optimizes toward a conversion number, so this reference
decides whether that number deserves to be optimized toward. Load it for the onboarding tracking gate,
conversion-action audits, "conversions dropped to zero," "the platform says 40 leads and the CRM says 12,"
offline conversion import, value calibration for lead gen, anomaly triage, segment and period analysis,
pre/post validation of a change you made, cross-platform blending, sync and freshness, and the numbers half
of the monthly report. Structure, keywords, bids and creative live in `account-structure.md`,
`keywords-search-terms-negatives.md`, `bidding-budgets-pacing.md`, `ads-assets-quality.md`; Microsoft UET
and conversion-goal tooling in `paid-social-and-bing.md`; SKILL.md is the router and holds the
non-negotiables (context first, one confirmation per write, protected campaigns untouchable, nothing
bulk-applied or sent silently). Read this before you believe a number, and before anyone else does.

---

## 1. Gates

Four gates before measurement work is reportable. A failed gate stops the work and becomes the finding.

1. **Context.** `account_context_get({ domain: "ppc" })`, then `memory_list` for the measurement facts:
   which conversion action the client values, target CPA or ROAS, deal value and close rate, sales-cycle
   length, whether an offline loop runs and against which conversion action id, known discrepancy baselines.
   `get_account_info` for the record you cite in the report. If memory does not say what a conversion is
   worth here, you cannot judge a CPA, only compare it to itself.
2. **Local data first.** `hiveku-data/ppc/campaigns.json`, `metrics_daily.json`, `search_terms.json`,
   `hiveku-data/STATUS.json` before any live call. Check `fetched_at`. `truncated: true` means `count` is a
   floor. An `error` with empty rows means NOT RETRIEVED, never "no conversions": reporting "0 conversions"
   off an errored file is the most damaging mistake in this reference.
3. **Freshness.** `ppc_digest` `warnings[]` flags connections stale beyond 25h; clear with
   `ppc_sync({ connection_id })` before quoting a figure.
4. **Signal trust.** Play 1. Until it passes, no bid, budget, bidding-strategy or pause decision may cite a
   conversion count, and you say so out loud rather than proceeding quietly.

**The mandate:** make the platform's optimization signal match the client's real business outcome, then keep
it matched. Everything here verifies that match, repairs it, or reports on it.

---

## 2. Framework A: the trust ladder

Five rungs, in order. A correctly valued action that does not fire is worth nothing.

1. **Firing.** Does the tag fire at all, recently, from the right pages?
2. **Counting.** Does one business event produce exactly one counted conversion?
3. **Scoping.** Is the action driving bidding the action the client cares about?
4. **Valuing.** Does its value reflect real money, or is it 0 or an invented constant?
5. **Closing.** Does downstream reality (booked job, closed deal, refund) flow back to the platform?

Rungs 1 to 3 are Plays 1 and 2, mandatory on every account. Rung 4 is Play 7. Rung 5 is Play 3 and is what
separates a retainer agency from a dashboard. Most inherited accounts are stuck at rung 2.

---

## 3. Framework B: reading a conversion action

`ppc_conversion_actions_list({ connection_id })` for the inventory;
`ppc_google_conversion_actions({ connection_id })` for the deeper Google-side fields. Five fields decide
whether an action is safe to optimize toward.

- **Status and recency.** ENABLED with no recent fires is a broken tag pretending to work, dragging smart
  bidding toward nothing.
- **Primary vs secondary.** Primary drives bidding; secondary is observation only. A phone call marked
  secondary while a newsletter signup is primary means the algorithm is buying newsletter signups with the
  client's money. Common, invisible in the top-line report, expensive.
- **Counting.** ONE_PER_CLICK counts once per ad click; MANY_PER_CLICK counts every occurrence. Lead gen is
  ONE_PER_CLICK, always: MANY_PER_CLICK on a contact form turns one person who submitted three times into
  three leads, deflates CPA by two thirds, and makes a losing campaign look like the winner. Ecommerce is
  MANY_PER_CLICK, because a repeat purchase genuinely is a second conversion.
- **Attribution and window.** Click-through windows commonly 30 days, settable 1 to 90. Longer windows book
  more conversions to a click: correct for long sales cycles, misleading against a shorter-window period. A
  window change is a reporting discontinuity; record the date or every later comparison is wrong.
- **Source and value.** Website tag, imported analytics, call, store visit, upload. Upload-source actions
  are what Play 3 writes into. "No value" or a flat placeholder means ROAS here is fiction; report CPA until
  Play 7 fixes it.

Two structural traps. **Double counting across sources:** an analytics-imported goal and a first-party tag
both measuring the same submit, both primary, produces a clean doubling that looks like a great month.
**Aggregate actions:** distinct events bundled into one goal so a micro-conversion and a real lead are
indistinguishable in bidding.

---

## 4. Framework C: the reconciliation triangle

| Comparison | Expected direction | Normal gap | Investigate above |
|---|---|---|---|
| Platform vs analytics, same event | Platform higher | 5 to 10 percent | 20 percent |
| Platform vs CRM (leads created) | Platform higher | 10 to 25 percent | 35 percent |
| Platform conversion count vs revenue rows | Should match | 0 percent | any mismatch |

Platform legitimately higher: cross-device journeys analytics splits in two, booking to click date not
conversion date, view-through counting, a credit model analytics does not use. Illegitimately higher:
MANY_PER_CLICK on a form, duplicate actions, a tag on page load instead of submit, bots, internal tests.

**Diagnose on direction, not size.** Platform LOWER than CRM has entirely different causes: a missing tag on
one form or landing-page variant, consent-mode denial, phone leads with no call tracking, a redirect
stripping the click id, an ad-blocked tag, leads from a channel the platform never saw. Platform below CRM
is under-measurement, and it starves smart bidding of the campaigns that actually work.

Set the baseline gap once, write it to memory with the date, then report movement in the gap rather than the
gap. A stable 18 percent gap is a constant. An 18 percent gap that became 44 percent Tuesday is an incident.

**The Hiveku side of the triangle now has its own instruments** (visible to marketing keys via the
`marketing_` prefix). `marketing_form_conversion_audit` explains a platform-vs-CRM gap for FORM fills:
submissions with their source attribution, aggregated the way a platform aggregates, plus named
discrepancy buckets that SUM TO THE TOTAL (deleted, duplicate, spam, archived, workflow_failed,
no_attribution, unpaid_attribution, counted) - use `buckets.counted` as our number and explain the gap
with the rest; `has_click_id` isolates paid-click submissions recovered from utm_params OR the
landing-page URL, which catches real paid clicks the CRM recorded as organic.
`marketing_call_attribution_breakdown` does the same for CALLS - by source/medium/campaign and day, plus
the call-quality read the platform structurally cannot give (duration distribution against THIS
account's configured threshold, disposition mix, missed/voicemail/abandoned: Google counts a 12-second
wrong number as a conversion once it passes minimum duration). `marketing_call_attribution_list` adds a
page of individual calls - each with its source, the tracking DID and pool session that credited it (DNI
attributes through both), duration bucket, and whether it meets the account's conversion policy;
breakdown percentages cover up to 5000 scanned calls, `totals.truncated` says when the window is larger,
and it returns NO transcripts (use `marketing_call_transcript_get` for one call). ALWAYS read each
response's caveats before reporting a discrepancy: this is OUR record, not the platform's - view-through
conversions have no click and can never appear here, cross-device joins are invisible, and the platform
dates by CLICK while we date by the event.

---

## 5. Framework D: is this number real yet?

- **Conversion lag.** The last 3 days of any window are structurally incomplete: conversions book back to
  the click date as they arrive. A 30-day window read today and again next week will not match, and the
  newer read is correct. Never call a trend, end a test, or panic on a drop using the trailing 3 days. On
  sales cycles beyond a week, widen the exclusion to 7 days and footnote it.
- **Volume floor.** Below roughly 30 conversions in the period, percentage swings are arithmetic noise. 4
  conversions to 2 is not "down 50 percent," it is a quiet fortnight. State absolutes alongside every
  percentage in client-facing text for exactly this reason.
- **Attribution reshuffling.** Data-driven attribution redistributes credit retroactively. A campaign can
  lose conversions it already reported without anything happening in the auction. Commonest cause of "my
  numbers changed since you sent the report."

**Rule:** inside the lag window, below the volume floor, or explainable by reshuffling means not a finding
yet. Log a watch item with a re-check date. Do not act on it and do not report it.

---

## 6. Play 1: the conversion tracking gate (onboarding, then weekly)

Read-only, so no confirmation needed, but the verdict is a mandatory publish.

1. `ppc_conversion_tracking_status({ connection_id, days: 30 })` on onboarding, `days: 7` weekly. Read
   `silent_count` (enabled actions with zero recent fires), which actions those are, per-action counts, and
   any primary-goal flags surfaced.
2. `ppc_conversion_actions_list` then `ppc_google_conversion_actions`. Build the table: name, status,
   primary or secondary, counting, window, source, value, conversions in 30 days.
3. Cross-check against reality:
   `ppc_segment_report({ connection_id, dimensions: ["conversion_action"], days: 30 })`. A healthy-looking
   action with zero rows here is dead. An action nobody mentioned carrying a third of the volume is a
   discovered dependency.
4. Classify each: **TRUSTED** (fires, counts right, primary status matches business value),
   **MISCONFIGURED** (Play 2), **SILENT** (enabled, no fires, section 15), **NOISE** (micro-conversions or
   duplicates that should be secondary or removed).
5. Publish the verdict in one sentence before anything else happens: "tracking verified, N trusted primary
   actions," or "tracking FAILED: X silent, Y double counts; bid and budget work blocked until repaired."
   Record with `pm_tasks_update` so the block is on the record, not just in chat.
6. Non-Google: compare counts via `ppc_period_comparison` / `ppc_platform_period_comparison` against the
   platform's own goal configuration; route Microsoft UET and conversion-goal verification to
   `paid-social-and-bing.md`. Meta, TikTok and LinkedIn each have callable reads - repeat them, do not
   trust a one-time dashboard glance. Meta: `ppc_meta_custom_conversions` (each Custom Conversion's name,
   URL rule, custom_event_type, owning pixel, first/last_fired_time - per-conversion grain, which a
   pixel-level check cannot give; an empty list means no CUSTOM conversions are defined while standard
   pixel events still record, and a failed read reports readability/coverage_gap instead of an empty
   list) and `ppc_meta_conversion_volume` (per-conversion attributed_conversions/value for the window
   PLUS last_fired_time; attributed counts ONLY ad-attributed conversions while last_fired counts every
   event - a recent fire with zero attributed is recording fine and was not ad-driven, a media finding,
   not broken tracking; failed reads classify permission / token / api_error, never zeros). Also
   `ppc_meta_pages_pixels` operation list-pixels for pixel ids. TikTok: `ppc_tiktok_pixels` event-stats
   (max 10 pixels, 30-day window). LinkedIn: `ppc_linkedin_conversions` conversion-rules-list. Record
   verdicts in the PM task.

**Closes the loop:** tag repairs are website work, not ads work. Every SILENT action becomes a
`pm_tasks_create` task naming the action, the page or event expected to fire it, the date it last fired, and
the decisions blocked while it stays broken. Do not quietly optimize around it.

---

## 7. Play 2: conversion action rationalization

On any MISCONFIGURED or NOISE finding, and once per quarter regardless.

1. Target state: one primary action per genuine business outcome, everything else secondary. Most lead-gen
   accounts end with one to three primaries. Nine primary actions is not an optimization target, it is an
   average.
2. Each change as a row: action, current setting, proposed setting, business reason, expected effect on
   reported volume. State the volume effect explicitly. Fixing a MANY_PER_CLICK form cuts reported
   conversions substantially and that must be predicted before it happens.
3. **What is editable by tool, and what is not.** `ppc_google_conversion_actions` operation
   conversion-action-update edits status (ENABLED | HIDDEN - REMOVED is refused on this lane by design,
   use HIDDEN to retire from reporting), `include_in_conversions_optimization` (in/out of Smart Bidding -
   change deliberately, this changes what bidding optimizes toward), value and `always_use_default_value`
   (CAUTION: true flattens every conversion to the default value and destroys transaction-level revenue
   reporting), and phone_call_duration_seconds. Counting (`count_type`) and the click-through lookback
   window are CREATE-time parameters with no update op: fixing those is still dashboard work in Google
   Ads under Goals, or the Microsoft equivalent in `paid-social-and-bing.md`. Either way: write the
   change as a row, get confirmation on the table, record who applied it and when.
4. After the change: mark the date in memory as a reporting discontinuity, freeze bidding-strategy changes
   on affected campaigns for 14 days while smart bidding relearns, re-baseline target CPA against
   post-change data rather than the old blended figure.
5. Re-verify a week later with `ppc_conversion_tracking_status({ days: 7 })` and
   `ppc_segment_report({ dimensions: ["conversion_action"], days: 7 })`.

---

## 8. Play 3: the offline conversion import loop

The agency edge. It teaches smart bidding the difference between a form fill and a customer.

**Two ways to run it, and they are not interchangeable.** The declared discovery lane -
`marketing_offline_conversions_*` (status, opt_in, designate, preview, run, queue, requeue,
validate_only, remove_mapping, plus `marketing_offline_conversion_actions_list`) - pulls closed-won
deals, form leads and Shopify orders itself and pushes them to google_ads, microsoft_ads or
meta_ads; opting in ALWAYS lands in validate-only (payloads proven, nothing recorded), the go-live
flip is a human dashboard action (403 to agents), and on a live account a run is a money write that
cannot be un-sent - the doctrine lives in
`hiveku-conversion-tracking/references/offline-conversions.md` (section 13) and is not repeated here. The steps below are the
hand-upload path, `ppc_offline_conversion_upload`: rows you assemble yourself, Google Ads only,
two-step confirm. Use the lane where the account runs it; use the hand-upload for a one-off batch
from a client export.

**Preconditions, all four.** An Upload-source conversion action exists in the Ads account (if missing,
create it with `ppc_google_conversion_actions` operation conversion-action-create with
`type_: "UPLOAD_CLICKS"` - note the trailing underscore on `type_` - per `google-ads-advanced.md`
section 8; confirm it first, since a new action changes what the account reports). The site captures
`gclid` on submit and carries it into the CRM record. The client
has a definition of the outcome (closed-won, booked job, qualified lead) and a value for it. Memory records
the conversion action id you upload against: the wrong id silently trains the wrong thing.

1. **Assemble.** Outcomes closed since the last upload, with gclid, outcome timestamp, value. The CRM read
   is outside this reference's tool surface; SKILL.md section 6.1 names it, and the fallbacks are a
   client-supplied export or the dashboard. Never invent values to fill gaps.
2. **Validate every row before sending.** This is where uploads fail, quietly, if you let them.
 - `conversion_date_time` as `YYYY-MM-DD HH:MM:SS+HH:MM` with an explicit UTC offset. Missing offset or a
     bare date is rejected. Use the Ads account's timezone offset, not the client's local one unless they
     match, and record which you used.
 - Conversion time at or after click time. A deal timestamped before its own click is the classic symptom
     of an offset applied backwards.
 - Click old enough to be findable (allow several hours between click and upload) and young enough to be
     in window. Clicks older than the click-through window (commonly 30 days, up to 90) are rejected. A long
     sales cycle against a 30-day window means most closed deals are unuploadable: lengthen the window in
     the dashboard before the first batch.
 - `conversion_value` numeric; `currency_code` a valid ISO code matching the account currency; a stable
     `order_id` where available so re-uploads deduplicate instead of double-counting.
 - Deduplicate against your own upload log. The tool does not know you sent this deal last week; the PM
     task record is the only guard.
3. **Confirm the batch.** Row count, total value, date range, target conversion action, one sample row. One
   explicit confirmation. This write changes what the bidding algorithm optimizes toward, so it is never
   silent and never automatic.
4. **Upload.** `ppc_offline_conversion_upload({ connection_id, conversion_action_id, conversions: [{ gclid | order_id, conversion_date_time, conversion_value, currency_code }] })`.
   Partial failure is on: the call can return 200 with individual rows rejected.
5. **Read `results[]`, not the HTTP status.** Count `ok: false` rows with reasons and classify: unrecognized
   gclid (capture problem or click out of window), invalid timestamp, duplicate, action mismatch.
6. **Score the match rate** (successful over attempted). 70 percent or above is healthy. 50 to 70 means
   gclid capture is leaking somewhere (one form, one landing-page variant, a redirect stripping the
   parameter) and becomes a task. Below 50 means capture is broken and the uploads teach a biased subset of
   reality: pause the loop rather than train on it.
7. **Verify it landed.** After 24 to 48h,
   `ppc_segment_report({ dimensions: ["conversion_action"], days: 7 })` should show the upload action with
   volume and `ppc_conversion_tracking_status` should stop calling it silent.
8. **Close the loop.** `pm_tasks_update` with batch date, rows, value, match rate, failure classes.
   `memory_update` with the conversion action id, the last uploaded outcome date (so the next batch starts
   there), and the current match rate.

**Cadence:** weekly. **Volume gate:** smart bidding needs roughly 30 conversions per 30 days to use a signal
meaningfully. If the offline action produces 4 closed deals a month, do not make it the primary bidding
target; keep it secondary, bid on a qualified-lead action, and let offline import prove the qualified-lead
rate. **`ppc_offline_conversion_upload` is Google-only. Microsoft and Meta offline import run through the
declared `marketing_offline_conversions_*` lane** (Meta on the `fbc` click parameter only - `enhanced`
matching is refused there - and its click window is 7 days, so batch daily); **TikTok and LinkedIn** have
their own conversion-ingest operations in `paid-social-and-bing.md`, or it is dashboard and CAPI
engineering. Say which, rather than implying the Google loop covers everything.

---

## 9. Play 4: the daily anomaly sweep

1. `ppc_digest({ days: 7 })` first: account-wide, no connection_id, local cache, and its `warnings[]` tells
   you whether the rest of the sweep is even valid.
2. `ppc_anomaly_check({ connection_id })` per connection. Default flags swings above 50 percent vs the
   prior-7-day average; pass `threshold_pct: 30` above 500 per day of spend, where 30 percent is already
   thousands.
3. **Triage tree.** Answer in order, stop at the first yes.
 - Inside the lag window or below the volume floor (Framework D)? Not real yet.
 - Delivery broken? Disapproved ads, paused campaign, exhausted budget, billing hold. The disapproval and
     change-history reads live in `ads-assets-quality.md` and `account-structure.md`.
 - A human changed something? Change history reaches 30 days and is the first place to look before blaming
     the algorithm.
 - Tracking? `ppc_conversion_tracking_status({ connection_id, days: 7 })`. A conversion cliff with flat
     clicks and flat spend is a tag failure until proven otherwise.
 - Demand? `ppc_segment_report({ dimensions: ["date"], days: 30 })` for shape, then `["date","device"]` or
     `["date","ad_network_type"]` to localize. Concentrated in one device or network is mechanical; spread
     evenly is market.
4. **Signatures.** Clicks flat, conversions to zero = tracking. Spend up, clicks flat = CPC inflation or a
   new competitor. Impressions collapse = disapproval, budget exhaustion, or a targeting change. Conversions
   up while CRM leads stay flat = double counting, the anomaly nobody reports because it looks like good news.
5. Every investigated flag gets a PM task line even when the verdict is "not real yet," with a re-check
   date. An anomaly dismissed without a record is one you investigate again next week.

---

## 10. Play 5: the weekly measurement read

`ppc_segment_report` is the pivot engine, Google Ads only, up to two dimensions for a 2-D view.

- `["date"]` for trend shape and to confirm a change landed on the day you think it did.
- `["device"]` for the mobile CPA gap. Mobile CPA 30 percent or more above desktop with real volume is a
  bid-modifier or landing-page finding; send it to `bidding-budgets-pacing.md` with the evidence.
- `["hour"]`, `["day_of_week"]` for dayparting, actionable only at 30-plus clicks per bucket.
- `["geo_target_constant"]` for geographies spending without converting.
- `["ad_network_type"]` at least quarterly. Search Partners and Display leak spend silently on campaigns
  nobody thought were running Display. Pays for itself more often than any other single call.
- `["conversion_action"]` weekly, as the ongoing integrity check from Play 1.

Never act on a segment with fewer than 30 clicks or less than one target CPA in cost: below that you are
reading variance and calling it insight. For per-entity daily series on any platform,
`ppc_metrics({ campaign_id | ad_group_id | ad_id, since, until })` reads local cache and is the cheapest way
to see one thing over time, including what a campaign did around the date you changed it.

---

## 11. Play 6: pre and post validation

1. **Before any material change,** capture the baseline: `ppc_metrics` for the affected entity over the
   preceding 28 days, plus the pre-change setting value, both into the PM task before the write. A change
   with no recorded baseline can never be shown to have worked.
2. **Wait out learning.** Strategy and target changes need 7 to 14 days (see `bidding-budgets-pacing.md`).
   Reading day 3 and reacting is how accounts start oscillating.
3. **Compare.** `ppc_period_comparison({ connection_id, period_a, period_b, scope: "campaign" | "ad_group" | "keyword" })`
   with equal-length periods aligned to the same weekdays. 7 days against 10 days is a fabricated result.
   Non-Google uses `ppc_platform_period_comparison`; Microsoft reporting is async, and when the response
   says so, diff cached `ppc_metrics` series instead of waiting on a report that will not arrive.
4. **Read honestly.** Attribute the delta only if direction matches the hypothesis, magnitude clears the
   volume floor, and no other lever moved on that entity. Two levers means "inconclusive, one at a time next
   round."
5. **Decide and record.** Keep, revert, or extend. Verdict and numbers to the PM task via `pm_tasks_update`;
   the durable conclusion to memory. "Mobile modifier at -20 percent held CPA and cost 8 percent of volume,
   tested Aug 2026" is what stops the next session re-running a settled test.

---

## 12. Play 7: value calibration for lead gen

Ecommerce arrives with real revenue. Lead gen arrives with a value of zero, which makes ROAS meaningless and
every lead look equally good to the algorithm.

1. Two inputs, from memory or the client: average closed deal value, lead-to-close rate. If absent,
   record them via the read-merge-write memory protocol (never a bare `memory_create` past first run).
2. Expected lead value = deal value x close rate. Target CPA is the fraction of that which leaves the margin
   the client has named.
3. Where lead types differ materially (demo request vs newsletter signup), give them different values rather
   than one blend, so bidding stops treating them as interchangeable. The default value is editable by
   tool: `ppc_google_conversion_actions` conversion-action-update `params.value` (avoid
   `always_use_default_value: true` unless the client accepts losing transaction-level revenue) - one
   confirmed change per action, with the figures in the PM task.
4. Then run Play 3: offline import replaces the estimate with the actual.
5. Report the derivation, not just the number. A client who understands why a lead is worth 340 argues with
   the assumption rather than with your CPA.

---

## 13. Play 8: cross-platform blending

- **A conversion is not a conversion across platforms.** Different windows, view-through rules, definitions.
  Never sum into a headline figure. Report per platform, blend only spend.
- **Currency.** Per connection. Report per currency, or convert explicitly and state the rate and date.
- `ppc_digest` for the cross-platform snapshot; per-platform detail from `ppc_platform_period_comparison`
  and cached `ppc_metrics`.
- **State the attribution basis** once in the report footer: window, model, any change date. Without it,
  next quarter's comparison is unfalsifiable.
- **Blended CPA is directional.** Never use it to move budget between platforms, because they are not
  measuring the same event.

---

## 14. Play 9: monthly assembly

1. `ppc_sync({ connection_id })` on every connection so the month is complete.
2. `ppc_digest({ days: 30 })` for totals.
3. `ppc_period_comparison({ connection_id, period_a, period_b, scope: "campaign" })` for movement;
   `ppc_platform_period_comparison` for non-Google.
4. `ppc_segment_report({ dimensions: ["conversion_action"], days: 30 })` so the report states which actions
   the numbers came from. Reports that do not name the conversion action are how double counting survives
   for a year.
5. `ppc_segment_report({ dimensions: ["date"], days: 30 })` for trend and to footnote any logged anomaly.
6. Offline import summary from the PM task log: batches, rows, value returned, match-rate trend.
7. Footnote the lag: the final 3 days are incomplete and will rise.
8. Draft with `talk_to_department({ domain: "ppc", message })`, then verify every figure yourself. The
   department writes well; you own the numbers being true. Nothing sends without explicit approval.

---

## 15. Diagnosis: symptom to cause to check

**Conversions to zero, clicks and spend normal.** Tag failure, near certainly.
`ppc_conversion_tracking_status({ days: 7 })` for `silent_count`, then
`ppc_segment_report({ dimensions: ["conversion_action"], days: 14 })` for the day it stopped, then the
change-history read in `account-structure.md` for a site deploy or account edit on that date. Escalate to
the web team with the date and the action name.

**Platform far above CRM.** Framework C, likeliest first: MANY_PER_CLICK on a lead-gen action, duplicate
actions from two sources both primary, tag on page load instead of submit, internal or test submissions, bots.

**Platform below CRM.** Under-measurement: a form or landing-page variant with no tag, consent denial, call
leads with no call tracking, click id stripped by a redirect, leads from a channel the platform never saw.
Bleeds money continuously, because bidding is being starved.

**Upload returns ok but nothing appears.** Confirm you read `results[]` and not the HTTP status. Then: the
action id points at an Upload-source action, timestamps carry a UTC offset, clicks are in window, 24 to 48h
have passed.

**Match rate collapsed between batches.** A site change stopped storing gclid, a new landing page or form
lacks capture, or the sales cycle lengthened past the click-through window.

**Numbers changed after the report went out.** Framework D: lag plus reshuffling. Prevent it by footnoting
lag and snapshotting the exact figures into the PM task on send date.

**Digest disagrees with the platform UI.** Freshness: check `warnings[]`, `ppc_sync`, re-read. Still
disagreeing, check date range and timezone basis, then the attribution window.

**A tool returns empty for a connection that clearly has data.** Confirm the connection is Google before
using Google-only tools; the ops family fails on microsoft, meta, tiktok, linkedin. Confirm `connection_id`
is present: almost everything here requires it, and only `ppc_digest` and the cached reads do not.

**Sync will not complete.** `ppc_sync` is incremental and blocks up to about 120s, where the network
edge ends the call. For a full historical backfill use
`ppc_sync_async` and poll the returned job with the job-status tool named in SKILL.md section 0.3. Do not
loop `ppc_sync` hoping for a different outcome.

---

## 16. Thresholds and benchmarks

| Signal | Threshold | Action |
|---|---|---|
| `silent_count` | above 0 | Optimization blocked; PM task per action |
| Primary actions, lead-gen account | more than 3 | Rationalize, Play 2 |
| Counting on a lead-gen action | MANY_PER_CLICK | Fix; predict the volume drop first |
| Platform vs analytics gap | above 20 percent | Investigate |
| Platform vs CRM gap | above 35 percent, or platform lower at all | Investigate |
| Movement in a known gap | more than 15 points from baseline | Treat as an incident |
| Trailing days in any read | last 3 days (7 on long cycles) | Exclude from conclusions |
| Conversions in a comparison period | fewer than 30 | Absolutes only, do not call a trend |
| Segment volume before acting | 30 clicks or 1x target CPA in cost | Below it, do not act |
| Offline match rate | 70 percent or above healthy | 50 to 70 investigate; below 50 pause the loop |
| Offline click age at upload | inside the click-through window | Older rows get rejected |
| Conversions per campaign for smart bidding | roughly 30 per 30 days | Below it, not the bid target |
| Anomaly threshold | 50 percent default | 30 percent above 500 per day spend |
| Post-change validation wait | 7 to 14 days | Do not read earlier |
| Tracking verification | weekly | Non-negotiable |
| Offline import | weekly | Batch, confirm, log |
| Network-type audit | quarterly | Catches silent Search Partners and Display leakage |

---

## 17. Edge cases and failure modes

- **Do not optimize toward a signal you have not verified this week.** Everything downstream inherits the
  error, with confidence.
- **Do not report a number from an errored or truncated local file.** NOT RETRIEVED is not zero. Say which.
- **Do not fix double counting without predicting the volume drop first.** A client who sees conversions
  halve the week after you touched the account will not remember a warning you never gave.
- **Do not upload against a guessed conversion action id,** and do not re-upload a failed batch without
  deduplicating. The first trains the wrong target invisibly for weeks; the second, absent a stable
  `order_id`, puts successful rows in twice and manufactures revenue.
- **Do not send raw customer data anywhere it does not belong.** The offline payload is click id or order
  id, timestamp, value, currency. Nothing else. Identifiers for audience matching are a different play in
  `audiences-and-remarketing.md` with its own hashing rules.
- **Do not change a window or counting setting mid-month and then present a month-over-month comparison as
  if nothing happened.** Mark the discontinuity in the report and in memory.
- **Do not call a test in week one, and do not move two levers at once on the entity you are measuring.**
  Lag plus volume floor makes week-one results reverse routinely; two levers destroy attribution of your own
  work.
- **Do not blame the algorithm before reading change history.** A human changed something on Tuesday more
  often than the model drifted.
- **Protected and brand campaigns:** measure, report, propose, never write. Client urgency is not a reason
  to skip the batch confirmation on an upload; the confirmation is the record of what was approved.
- **When a capability has no tool, say so and name the fallback.** Count-type and lookback-window edits,
  Meta pixel creation, CAPI engineering, and analytics-side reconciliation are dashboard or web-team
  work. (Conversion-action create/update and Upload-source action creation ARE tools now - Play 2 and
  Play 3 name them; do not send those to the dashboard.) For the account's own documentation,
  `hiveku_docs_search` and `hiveku_docs_get`; for external platform behavior and policy changes,
  `web_search`, `web_scrape`, `web_extract`, `web_map`, `web_crawl`. Never imply a tool exists because
  it would be convenient.

---

## 18. Persistence and reporting

**Memory** is what the next session inherits, and here it is unusually load-bearing because the facts are
invisible in the data itself. After any material finding, `memory_create({ type: "memory", name:
"ppc", content })` on the first run, then `memory_update({ memory_id, content })` after (only
`memory_id` and `content`, and it REPLACES the document, so resend the merged body). Hold: which
conversion actions are trusted and which are primary; counting and
window settings plus the date of any change; reconciliation baseline gaps with the date measured; deal
value, close rate and derived lead value with the derivation; the offline import conversion action id, last
uploaded outcome date and current match rate; known reporting discontinuities; and any measurement decision
already settled so nobody re-litigates it.

**PM tasks** are the client-visible record and the audit trail. `pm_tasks_create` for the tracking audit,
each repair, the offline loop, each anomaly investigation. `pm_tasks_update` with the finding, the evidence
read that produced it, the pre-change value, the confirmation received quoted verbatim, and the re-check
date. `pm_tasks_complete` only when the re-check has happened and the fix is verified in
`ppc_conversion_tracking_status` or `ppc_segment_report`, never when the request was merely sent. Every
capability gap becomes its own task with the dashboard click path written out.

**Client reporting** answers four questions in order: can we trust the numbers (tracking status, the named
conversion actions, any discontinuity), what did they say (volume, CPA or ROAS vs target, absolutes
alongside every percentage), what did we prove (pre and post validation of the changes we made), and what is
still unmeasured (silent actions, gap movement, offline match rate, anything blocked on the web team). A
measurement report that does not name the conversion actions behind its numbers is not a report, it is a
chart. Draft with `talk_to_department({ domain: "ppc", message })`, verify every figure yourself, and get
explicit approval before anything is sent.
