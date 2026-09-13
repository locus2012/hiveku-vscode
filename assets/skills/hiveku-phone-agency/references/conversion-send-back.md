# Reference: Conversion send-back - attributed calls to the ad platforms

This file owns the CALL lane of offline conversions: how an attributed phone call becomes a
conversion on Google Ads, GA4, Microsoft Ads or Meta, how to enable it, how to read the upload
outbox, and the call report a PPC client actually wants. Load it for "turn on call conversions",
"are our calls reaching Google Ads?", "the uploads are failing", "what's our cost per qualified
call?", or any change to the account's call-conversion policy.

Boundaries, held strictly:

- The CRM/commerce lane (deals, form leads, Shopify orders -> the ad platform) is a DIFFERENT
  pipeline with different tools and gates: the ten `marketing_offline_conversions_*` tools and the
  hand-upload `ppc_offline_conversion_upload` live in
  `hiveku-conversion-tracking/references/offline-conversions.md`. Do not mix the two - the call
  lane's opt-in, outbox and policies below touch NOTHING in that lane, and vice versa.
- Whether a call was ATTRIBUTED correctly in the first place (matchers, sweep, first-touch
  semantics) is `hiveku-conversion-tracking/references/calls.md`. This file starts where a call
  already carries attribution.
- Pool/DNI setup and health is `call-tracking-dni.md` next door - no click id gets captured
  without a working swap.

Read `account_context_get` before client-facing output. Every enable here changes what a live
bidding system optimizes on: confirm first, one change per confirmation.

## Availability

| Tool | Status | Note |
|---|---|---|
| `voice_settings_get` | LIVE | On the marketing-ads (PPC) profile by name |
| `voice_settings_update` | LIVE | NOT on the marketing-ads profile (it also writes the toll-fraud cap and recording retention) - needs a communications-scope or full key, or the dashboard (Communications -> Settings) |
| `voice_call_tracking_setup` | LIVE | On the marketing-ads profile by name; wires the tenant upload policy as one of its steps |
| `voice_call_tracking_diagnose` | LIVE | On the marketing-ads profile by name |
| `voice_call_tracking_outbox` | LIVE | On the marketing-ads profile by name |
| `voice_call_tracking_live_probe` | LIVE | On the marketing-ads profile by name; holds a real DID - run once, never scheduled |
| `marketing_call_attribution_breakdown` | LIVE | - |
| `marketing_call_attribution_list` | LIVE | - |
| `ppc_connection_list` / `ppc_connection_test` | LIVE | - |
| `ppc_conversion_actions_list` / `ppc_conversion_tracking_status` | LIVE | Google only |
| validateOnly upload smoke | NO TOOL | Dashboard/route only: POST `/api/marketing/ppc/connections/[id]/conversion-upload-test` - file a task or have the operator click it |

The **marketing-ads (PPC) profile sees the call-tracking tools BY NAME** (doctor, probe, outbox,
setup, plus the reads beside them) precisely so "are the ads' calls counted?" is answerable on a
paid-media key. The one write it deliberately lacks is `voice_settings_update` - on that key, the
enable path is `voice_call_tracking_setup` (which sets the same tenant policy, E911-gated and
capped) or the dashboard.

## 1. The four call lanes, and the lane this file is not

Every attributed inbound call is evaluated for FOUR independent send-back lanes. One outbox row
per (call, platform); each lane has its own identifier, its own window, and its own way of dying:

| Lane | Needs on the session | Window | What is sent | Dies as |
|---|---|---|---|---|
| `google_ads` | gclid (or gbraid/wbraid) | 90d click | ClickConversion against the "Hiveku - Phone Call" conversion action (UPLOAD_CLICKS, one-per-click) | `CLICK_NOT_FOUND` permanent; `stale_conversion` |
| `ga4` | `ga_client_id` | **72 hours** | a `phone_call` event over the Measurement Protocol to the connected GA4 property | `ga4_stale` terminal |
| `microsoft_ads` | msclkid | 90d click | REST offline conversion against a per-ACCOUNT goal | goal-name mismatch permanent; `ms_stale` |
| `meta_ads` | fbclid | **7 days** | one CAPI event, `fbc` only, `action_source: phone_call`, `event_id` = the call uuid | `meta_stale` terminal |

Lane facts that decide real diagnoses:

- **google_ads** - the conversion action is created by `voice_call_tracking_setup` as "Hiveku -
  Phone Call" (Upload-source, one per click, 90-day window). **The validateOnly smoke**: the
  connection-level test uploads a FABRICATED gclid with validateOnly on, and the platform
  answering `CLICK_NOT_FOUND` is the PASS signal - it proves auth, the customer id and the
  conversion action wiring end to end without recording anything. There is no MCP tool for the
  smoke; it is the dashboard's connection test (route above). Do not read `CLICK_NOT_FOUND` in
  the smoke's context as a failure; in the live outbox it IS a permanent failure (section 3).
- **ga4** - the snippet reads the first-party `_ga` cookie at swap time (re-read per fetch,
  because GA often initializes after the snippet boots), so `ga_client_id` presence depends on
  GA4 actually running on the page. **The 72h stale gate is a fuse, not a window to argue with**:
  the Measurement Protocol silently drops events older than ~72h AND returns 2xx for invalid
  credentials, so anything older is skipped terminally (`ga4_stale`) instead of "sent" into a
  void. MP has no dedupe - a re-send is a double count, which is one more reason rows are never
  blind-retried. GA4 is also EXEMPT from the ad-consent suppression (first-party analytics).
- **microsoft_ads** - REST only. Goal names are unique per MANAGER but visible per ACCOUNT, so the
  platform provisions a per-account goal named "Hiveku - Phone Call (<account digits>)"; a bare
  shared name would wedge agency accounts. Consequence: a rename of that goal in the Microsoft UI
  breaks the lane permanently until re-provisioned - a goal-name mismatch error code is a config
  finding, not a retry candidate. Goal propagation after creation can take ~3 hours; early
  failures in that window defer rather than burn attempts.
- **meta_ads** - CAPI, **fbc only** (built from the fbclid + the session's assignment time),
  `action_source: phone_call`, `event_id` = the call uuid, one event per request. **NO PII ever**
  - no hashed email or phone leaves this lane, by policy, so never promise Meta match rates that
  need enhanced matching. The 7-day event window means Meta is the lane that dies of slow
  cadence; it is checked before any credential work.

**The lane this file is not:** deals, form leads and Shopify orders go up through the declared
`marketing_offline_conversions_*` pipeline with its own opt-in, validate-only mode and go-live
flip - `hiveku-conversion-tracking/references/offline-conversions.md`, entirely. The call lane
has no validate-only mode: once enabled it uploads for real on the next tick. That asymmetry is
why the enable below is a confirmed, deliberate decision and never a side effect of "fixing
tracking".

## 2. Enabling the lane: `voice_settings_update` (and its traps)

The tenant policy lives on the single voice settings row. `voice_settings_get` FIRST, always - a
`settings: null` on a 200 means the voice tenant was never provisioned, and a write against that
account fails ugly (bare 500), so never PATCH into a null.

The keys:

- **`conversion_upload_enabled`** - the master switch for the google_ads / microsoft_ads /
  meta_ads call lanes. Once true, attributed qualifying calls start uploading on the ~5-minute
  tick and reach the client's Smart Bidding. Not a drill.
- **`conversion_upload_disposition`** - which calls count: `all` | `answered` | `qualified`.
  `answered` = disposition answered or ai_handled. **`qualified` = answered OR at least
  `conversion_upload_min_duration_sec` long** - an OR, not an AND: a long unanswered call (a
  voicemail past the bar) qualifies. An absent or unknown value behaves as `answered`. State the
  chosen definition in every report that uses the word "qualified" (section 5).
- **`conversion_upload_min_duration_sec`** (0-3600) - the duration bar feeding `qualified`.
- **`conversion_upload_value` / `conversion_upload_currency`** - the per-call value. `null` value
  = upload with no value and the Google conversion action's own defaultValue applies. Reading it
  back, the value arrives as a QUOTED STRING ("12.50"), not a JSON number - a Decimal
  serialization fact, not a corruption.
- **`ga4_upload_enabled`** - the GA4 lane's separate switch, same disposition policy.

The three traps, each verified in the route:

1. **The route accepts the flags with NOTHING connected.** The dashboard disables these controls
   until an ads connection exists, but the API checks for no connection at all: enabling with no
   google_ads `ppc_connection` answers 200 and uploads nothing, forever, silently. **Verify the
   connection FIRST**: `ppc_connection_list` for a google_ads connection on this account,
   `ppc_connection_test` if its health is in doubt, and `ppc_digest` for sync freshness. Same for
   GA4: a usable google_analytics connection must exist before `ga4_upload_enabled` means
   anything.
2. **The PATCH response omits `ga4_upload_enabled`** even though it was written. A successful GA4
   flip is simply absent from the reply - do not read that as a dropped write; **confirm with
   `voice_settings_get`**, which is also the polite read-back for everything else you changed.
3. **No audit row survives an API-key write** on this route (the audit helper's anonymous path
   persists nothing). A policy change made here is invisible on the communications audit page -
   tell a human exactly what you changed, in the session and in the task/memory record.

Profile note: on a marketing-ads key `voice_settings_update` does not resolve (see Availability).
The by-name alternative that IS granted, `voice_call_tracking_setup`, wires
`conversion_upload_enabled` + disposition + duration + value/currency as one of its idempotent
steps and additionally verifies the Google connection and conversion action while doing it -
which makes it the better enable path on ANY key for a first-time setup. Reserve raw
`voice_settings_update` for adjusting an already-live policy.

Disposition-policy advice worth giving: `all` uploads 12-second wrong numbers and teaches Smart
Bidding to buy more of them; `answered` is the sane default; `qualified` with a threshold agreed
with the client (what does a real inquiry last?) is the goal state. Changing the policy changes
FUTURE uploads only - history on the platform does not move.

## 3. The outbox: `voice_call_tracking_outbox`

The row-level truth of the lane (`voice_conversion_uploads`): every enqueued call conversion,
**unique per (call, platform)** - one call can have up to four rows, one per lane - with the
originating call joined on and each `error_code` translated. Filters: `status` and `error_code`
(comma list or repeated; an unknown status is a 400 naming the valid set, never a silent empty
page), `platform` (comma list of `google_ads` | `ga4` | `microsoft_ads` | `meta_ads`; an unknown
value is a 400 naming the set, and the response echoes what was applied under `filters`),
`from`/`to` on created_at, `limit` 1-200 (default 50), `order` created_desc | created_asc |
oldest_queued. When the doctor says one lane is failing (its outbox check names the platform,
`details.by_platform`), filter to that `platform` before reading rows - a Meta token expiry
buried in a page of Google successes is how a lane stays dead for a month.

**An empty result is ambiguous**: nothing was ever enqueued (a tracking problem - ask
`voice_call_tracking_diagnose`, and check the enable + attribution upstream) or everything
uploaded cleanly. **Filter `status: 'failed'` first**, then widen. Escalations about stuck
uploads carry row counts and error codes from here, never a guess.

The four row statuses, read plainly: `queued` = waiting for the dispatch tick (or deferred by a
retry backoff - the joined `error_code` and timestamps say which); `uploaded` = the platform
accepted it, done; `failed` = attempted and refused (the codes below say whether it will ever go);
`skipped` = never attempted, terminally, for a named reason (the sentinel codes). Unlike the CRM
lane there is no `validated` state here - the call lane has no validate-only mode.

Two columns to read the way the route means them:

- **`outcome`, not `status`, is the verdict.** `uploaded` = the platform accepted it.
  `uploaded_duplicate` = status `uploaded` WITH an `error_code`, because the platform already
  had that conversion - that is ALSO success and never a retry (the (call, platform) key did its
  job). Otherwise `outcome` equals `status` (`queued` | `failed` | `skipped`).
- **`click_id` is MASKED.** Every surface hides the raw ad token; `click_id_type` says which
  platform the row belongs to, and that is all a report needs. Never go looking for the raw
  gclid to "verify" a row - the platform's own click record is what `CLICK_NOT_FOUND` is about.
  `conversion_value` comes back as a STRING; parse it before summing.

One more framing fact: **this lane runs itself.** Discovery and dispatch ride a ~5-minute tick;
there is no batch for you to run, no cadence workflow to build (the CRM lane's daily-batch advice
in `hiveku-conversion-tracking/references/offline-conversions.md` does NOT transfer here). Your
job is monitoring and classification - which is exactly why every "make it upload now" impulse is
wrong: there is nothing to push, only causes to clear.

### The retry taxonomy

Read the `error_code`, then decide - most codes mean STOP, not retry:

| Code | Class | What it actually means |
|---|---|---|
| `CLICK_NOT_FOUND` | permanent | Google has no record of that gclid. In the connection SMOKE this is the pass signal (fabricated gclid - section 1); on a real row it is dead: the click was mistyped upstream, evicted, or from a different ad account. Never retried |
| `TOO_RECENT_*` | deferred, +6h | Platform ingestion lag - the conversion is younger than the 6-hour floor. Re-attempted automatically WITHOUT burning an attempt. This morning's call showing this code is normal, not broken |
| `stale_conversion` | terminal | Past the platform's import horizon by the time it could upload. A cadence/backlog finding, not a row to rescue |
| `ga4_stale` / `ms_stale` / `meta_stale` | terminal | The per-lane windows from section 1 (72h / 90d / 7d). Same verdict: unrecoverable row, fix the cadence or the upstream delay |
| `ad_consent_denied` | terminal sentinel | The visitor signalled an advertising opt-out at swap time. Suppression normally happens at ENQUEUE (no row is created at all); rows stamped by the discovery sweep exist so the same call is not re-evaluated every tick. Do NOT override, ever |
| `skip_no_click_id` | terminal sentinel | Sweep retirement of a call whose session has no click id for this platform - the swap minted without one (consent-delayed boot, private mode, direct visit). Permanent for that call; the fix is upstream capture, not the outbox |
| goal-name / action mismatch codes | permanent, config | The Microsoft goal was renamed, or the Google action was removed/changed platform-side. Fix the config (re-provision / re-check `ppc_conversion_actions_list`), then only NEW rows flow. Microsoft's numeric codes follow the same split: goal-name mismatches are permanent config findings, a just-created goal defers (propagation, ~3h) rather than burning attempts |
| transient (network, 5xx, auth blip) | retried | Exponential backoff (minutes to hours, capped at 24h between attempts, bounded total attempts). A connection failing continuously for days is failed terminally as connection-dead rather than retried forever |

Doctrine: **never blanket-retry the outbox, and never re-send a row by hand.** The unique
(call, platform) key is the only dedupe some of these platforms get (GA4 has none at all); the
tick already retries everything retryable on the right schedule. Your job with a failed page is
classification - which codes, how many, since when - and the one config fix or upstream capture
fix the codes point at. `voice_call_tracking_diagnose`'s `fix_first` usually names it already.

## 4. Enrichment: keyword and ad group on a call

Attributed Google Ads calls are enriched gclid -> campaign / ad group / keyword / ad via Google's
click_view - so the call report can say WHICH keyword made the phone ring, which the ad platform's
own call reporting cannot tie to your PBX. Facts that shape expectations:

- **Performance Max clicks carry no keyword.** A PMax-heavy account will show campaign-level
  attribution with empty keyword fields; that is the platform's data model, not a Hiveku gap. Say
  so in the report footnote rather than letting "keyword: -" read as breakage.
- click_view lookups are day-scoped against the session's assignment date (call date as
  fallback) with roughly a 90-day lookback; older calls stay un-enriched.
- Repeat-caller (breadcrumb) attributions inherit the original call's enrichment rather than
  re-querying; and when the attribution sweep is working a large backlog, enrichment is skipped
  for that batch to protect the cron budget - those calls attribute fine but may lack keyword
  detail. Sparse keywords on a burst day is that, not a failure.

Where it surfaces: `marketing_call_attribution_list` rows (source/medium/campaign per call), the
CRM call cards, and the analytics Calls view's keyword/ad-group rollups.

## 5. The paid-ads call report - what a PPC client is actually paying for

`marketing_call_attribution_breakdown` is the report tool: groups this account's calls by
source/medium/campaign and by day, the way a PPC platform aggregates, PLUS the call quality the
platform structurally cannot see - the **duration distribution against THIS account's configured
threshold** and the **disposition mix** (answered / ai_handled / voicemail / missed / abandoned).
Google counts any call past its minimum duration as a conversion forever; Hiveku holds the actual
durations. That gap is the report.

Mechanics that make the numbers defensible:

- **Timezone: pass the AD ACCOUNT's IANA zone** (`timezone: 'America/Chicago'`), default is UTC.
  Day bucketing in any other zone disagrees with the platform's daily numbers at BOTH boundaries,
  and the discrepancy you then "find" is your own clock.
- **`to` is EXCLUSIVE**, `from` inclusive. "August" is `from: '2026-08-01...'`,
  `to: '2026-09-01...'` - an inclusive-minded `to: '2026-08-31'` drops the last day.
- `disposition` filters are an ARRAY (`['missed']`); `days` (1-365, default 30) is ignored when
  from/to are given.
- On `marketing_call_attribution_list` (same params + rows), **percentages cover up to 5000
  scanned calls - check `totals.truncated`**; if true, narrow the window and re-run rather than
  reporting a truncated percentage (`totals.calls_matching` is the uncapped count).
- ALWAYS read the response caveats before reporting a discrepancy: this is OUR record, and it
  legitimately differs from the platform's (view-through conversions have no click and can never
  appear here; cross-device joins are invisible; the platform dates by CLICK, we date by the
  event).

**CPL, done honestly**: cost per qualified call = platform spend for the period / calls meeting
the account's conversion policy - **with the definition of "qualified" STATED in the report**
("answered, or 90+ seconds", whatever `conversion_upload_disposition` +
`conversion_upload_min_duration_sec` say - read them from `voice_settings_get`, do not assume).
Spend comes from the PPC side (`ppc_digest` / the PPC skill's reporting lane); qualified calls
from the breakdown. A CPL with an unstated denominator definition is a number the client cannot
compare to anything.

**NEVER sum platform-reported conversions and Hiveku-recorded calls.** When the send-back is
enabled, the platform's call-conversion count IS (mostly) Hiveku's uploads - adding them counts
every call twice and reports a performance the campaign never had. The two columns exist to be
compared, not added; their legitimate differences are the caveats above plus the outbox's failed
and suppressed rows.

**The three-sentence client answer** (the shape every call question should collapse into):

> Your ads drove 84 tracked calls in August; 61 met your qualified bar (answered, or 90+
> seconds), so cost per qualified call was $38 against $2,318 spend. Google's own count says 71
> call conversions - the gap is 7 calls with no click id (consent-gated visits) and 3 still
> inside the 6-hour upload floor. The one thing to fix: 14 qualified calls went to voicemail
> during business hours - that is staffing, not ads.

Every number traceable to a named call; the definition stated; the platform delta explained, not
averaged away; one action. That is the substance.

**Report the suppressed share too.** Calls suppressed by an advertising opt-out
(`ad_consent_denied`) and calls with no click id are part of the platform delta and part of the
compliance story - a client asking "why does Google show fewer calls than you do" deserves "N of
your callers opted out of ad tracking and we honored it" as a line item, not a shrug. The counts
come from `voice_call_tracking_outbox` (sentinel rows) plus the attribution list's
click-id-carrying share.

### The weekly monitoring pass (five minutes, on any key that sees the by-name grants)

1. `voice_call_tracking_outbox({ status: 'failed', order: 'created_desc' })` - new codes since
   last week? Classify per the taxonomy; only config codes and infrastructure need action.
2. `voice_call_tracking_diagnose` - `fix_first` should be empty; anything new outranks your own
   guesses. (Never "upgrade" this to `voice_call_tracking_live_probe` on a schedule - it holds a
   real DID; `call-tracking-dni.md` section 4.)
3. `ppc_digest` - a stale connection this week is next week's connection-dead terminal failures.
4. Spot-check the platform: `ppc_conversion_tracking_status` on the Google action, judged on
   `all_conversions` (a zero `conversions` column with live `all_conversions` is a
   Conversions-column choice, not a dead lane).

## 6. Plays

### "Google shows 60 call conversions - are they real?"

**The verdict methodology is `hiveku-conversion-tracking/references/calls.md` section 10** - the
threshold split, the suspect band, sampled transcripts, the honest report shape. Run it there.
What this file adds when the send-back is live:

1. Establish WHOSE conversions the 60 are: `ppc_conversion_actions_list` - is the counting
   action "Hiveku - Phone Call" (our uploads), a Google call asset/forwarding action (Google's own
   counting), or both firing at once? Both = double counting at the platform, and the fix is
   deciding which action sits in the Conversions column, not disputing the calls.
2. If they are our uploads: `voice_call_tracking_outbox` for the period - uploaded count vs the
   60, failures by code. The platform can only be as real as what we sent it, and the disposition
   policy (`voice_settings_get`) says what we send: with `all`, the 60 includes wrong numbers by
   policy, and the recommendation is a policy change (section 2), which changes future uploads
   only.
3. Deliver through the section 5 report shape, never as a raw "yes/no they're real".

### "Turn on call conversions for a client", end to end

Assumes tracking itself is live (`call-tracking-dni.md` section 7's from-zero play otherwise).

1. `account_context_get({ domain: 'ppc' })` - any account rule about what counts as a qualified
   call; agree the disposition + duration policy with the operator BEFORE enabling.
2. Preflight the connection: `ppc_connection_list` (a google_ads connection exists, status
   healthy), `ppc_connection_test` if in doubt, `ppc_digest` for staleness. No connection = stop;
   enabling would 200 into the void (section 2, trap 1).
3. `voice_settings_get` - current policy, and confirm `settings` is not null.
4. Wire it: `voice_call_tracking_setup({ project_id, dry_run: true })`, read the steps (it will
   report the conversion action it would create and the policy it would set), then the confirmed
   real run with `conversion_upload_disposition`, `conversion_upload_min_duration_sec`,
   `conversion_value`/`currency_code` and `ppc_connection_id`. On a non-PPC key,
   `voice_settings_update` with the same fields is the direct alternative - remember the read-back
   (`voice_settings_get`) and that no audit row records your change.
5. Smoke it: the validateOnly connection test (dashboard, or file the task) - **`CLICK_NOT_FOUND`
   is the pass**. Also confirm in the Ads UI (or `ppc_conversion_actions_list`) that "Hiveku -
   Phone Call" exists and is where the client wants it counted (`primary_for_goal` /
   Conversions-column status - the Smart Bidding implications are
   `hiveku-conversion-tracking/references/diagnosis.md` rung 4's territory).
6. GA4 too? Confirm a google_analytics connection, then `ga4_upload_enabled: true` via
   `voice_settings_update` - and read it back with `voice_settings_get`, because the PATCH reply
   will not show it (section 2, trap 2).
7. Next-day verification, not same-hour: the 6-hour floor plus the 5-minute tick means the first
   uploads land hours later. `voice_call_tracking_outbox` (any `uploaded` rows? failures by
   code?), `voice_call_tracking_diagnose` (`fix_first` empty?), and on the platform side
   `ppc_conversion_tracking_status` judged on `all_conversions`.
8. Record the decision (policy, action, who confirmed) in memory + a `pm_tasks_create` for
   anything left with a human (the dashboard smoke, the Conversions-column choice).

### "Meta (or GA4) shows nothing while Google works"

The lanes are independent - one lane dark while another flows is a per-lane identifier or window
problem, not a broken pipeline:

1. Which identifier does the dark lane need? Meta needs an fbclid ON THE POOL SESSION, GA4 needs
   a `ga_client_id`. A Google-Search-heavy account structurally has few fbclids - a quiet Meta
   lane on it is arithmetic, not breakage. Read the click-id mix off
   `marketing_call_attribution_list` sessions for the window.
2. `voice_call_tracking_outbox` filtered to the lane's codes: rows dying `meta_stale` = a cadence
   or outage gap ate the 7-day window; `ga4_stale` = calls attributed more than ~72h after the
   fact (a sweep backlog upstream); no rows at all = the identifier was never captured, or the
   lane's switch is off.
3. The switch: for GA4, `voice_settings_get` (`ga4_upload_enabled` - trap 2 means only the GET
   tells the truth). Meta rides the master `conversion_upload_enabled` plus a healthy meta_ads
   connection whose paste-in token has not expired (~60 days, no refresh) - an expired Meta token
   surfaces as connection-shaped failures in the outbox and a reconnect task for the operator.
4. Set expectations in the answer: Meta matching is fbc-only by policy (weaker than
   PII-enhanced matching, deliberately), and GA4's events land as `phone_call` events on the
   property, not as ad-platform conversions - they will never appear in a Meta Ads or Google Ads
   conversion column.

## 7. Pitfalls

- **Enabling before checking the connection.** 200, no error, zero uploads forever. Connection
  first, always (section 2, trap 1).
- **Reading the PATCH reply as the truth.** `ga4_upload_enabled` is missing from it by
  construction. `voice_settings_get` is the read-back.
- **Retrying the outbox.** `CLICK_NOT_FOUND`, the `*_stale` family, `ad_consent_denied` and
  `skip_no_click_id` are terminal by design; `TOO_RECENT_*` retries itself. A manual re-send is a
  double count on GA4 and wasted attempts elsewhere.
- **Reading `CLICK_NOT_FOUND` uniformly.** In the validateOnly smoke it is the PASS; in the live
  outbox it is a permanent failure. Context decides.
- **"Just wait" on a Meta backlog.** Meta's window is 7 days; a week of outage or disabled
  uploads means those calls are `meta_stale`, gone. Cadence and uptime ARE the Meta lane.
- **Promising Meta enhanced matching.** The lane is fbc-only, no PII, by policy. Never offered.
- **Summing platform + Hiveku numbers.** One uploaded the other. Compare, explain the delta,
  never add (section 5).
- **A CPL with an unstated "qualified".** Read the policy from `voice_settings_get` and print the
  definition next to the number.
- **Reporting day totals in the wrong timezone.** Pass the ad account's IANA zone or both
  boundary days disagree with the platform and the "discrepancy" is fictional.
- **Blaming the lane for missing click ids.** `skip_no_click_id` rows are an upstream capture
  finding - consent gate, private mode, snippet health - which is `call-tracking-dni.md` sections
  4-5 and `hiveku-conversion-tracking/references/calls.md` section 2. The outbox just tells you
  honestly.
- **Confusing the lanes.** `marketing_offline_conversions_status` saying "not opted in" says
  NOTHING about the call lane, and `conversion_upload_enabled` says nothing about deals. Two
  pipelines, two switches.

## 8. Diagnosis table

| Symptom | First move | Likely verdict |
|---|---|---|
| "Google shows zero call conversions" | `voice_call_tracking_diagnose`, read `fix_first` | Uploads never enabled, no connection, action missing, or nothing attributed upstream - the doctor orders it for you |
| Uploads enabled, outbox EMPTY | `voice_call_tracking_diagnose` + `marketing_call_attribution_list` for the window | Nothing enqueued: no attributed qualifying calls (policy too strict? attribution broken upstream? `call-tracking-dni.md`) - or genuinely no calls |
| Outbox rows all `queued`, aging | `voice_call_tracking_outbox` order `oldest_queued`; check ages against the 6h floor | Under 6h old = normal (`TOO_RECENT` territory). Hours past it and still queued = the dispatch tick is stuck: infrastructure, `pm_tasks_create` with row counts and ages |
| Rows failing `CLICK_NOT_FOUND` | Check whether the gclids are real (a few via `marketing_call_attribution_list` sessions) | Wrong ad account on the connection, or captured click ids are mangled upstream. Config, not retry |
| Rows failing goal/action mismatch | `ppc_conversion_actions_list` (Google) / re-check the Microsoft goal name | Someone renamed or deleted the platform object. Re-provision; only new rows flow after |
| Many `skip_no_click_id` | `marketing_call_attribution_breakdown` - what share of calls carry click ids at all | Capture problem: consent gate, snippet health, direct traffic. Upstream fix; those rows stay dead |
| Many `ad_consent_denied` | Count them; do NOT touch them | Working as designed. Report the suppressed share so the platform delta is explained |
| Platform count far ABOVE our uploads | `ppc_conversion_actions_list` for other call actions firing | Google's own call assets or a duplicate action counting alongside ours - a Conversions-column decision, per `hiveku-conversion-tracking/references/diagnosis.md` |
| GA4 shows no phone_call events | `voice_settings_get` (`ga4_upload_enabled` true? - the PATCH reply lies by omission), then the GA4 connection | Toggle never actually on, no ga_client_id captured (GA not on the page), or events older than 72h died `ga4_stale` |
| "It worked last month, stopped this month" | `voice_call_tracking_outbox` `from`/`to` around the cliff, failures by code; `ppc_digest` | A connection death (transient codes then connection-dead), a platform-side rename, or the snippet died on a redeploy (`call-tracking-dni.md` section 7) |

Everything platform-configuration-deep (conversion action counting types, Conversions-column
membership, `always_use_default_value`) is `hiveku-conversion-tracking/references/diagnosis.md`
rung 4; everything about whether the attribution itself is trustworthy is
`hiveku-conversion-tracking/references/calls.md`. This file's lane ends where the row leaves the
outbox.
