# Reference: Phone calls (DNI, attribution, transcripts, call quality)

This covers the phone half of conversion tracking: the dynamic number insertion (DNI) swap snippet,
how a tracking number is assigned to a visitor and stays assigned, how a ringing call is matched back
to an ad click, what happens to calls that never produce a recording, how a call becomes a CRM
contact, activity and deal, and how to read the call quality the ad platform structurally cannot
report. Load it when the question involves a phone number on the site, a call that did or did not get
attributed, "our Google Ads call conversions look inflated", a transcript, or a swap-health alert.
It also carries the **voice operations** ladder in section 13: phones not ringing, callers landing in
the wrong IVR menu, an extension nobody can reach, calls stuck in a queue, outbound calls rejected,
voicemail, E911 compliance. That half is pure telephony and has nothing to do with attribution. The
`voice_*` family now carries live-PBX WRITE tools alongside the reads; section 13 names which fixes
you may ship (confirmed, one at a time) and which remain dashboard-only.
For the form half load the forms reference; for "why is this channel not recording conversions at
all" start at `analytics_channel_scorecard` in the diagnosis reference and return here once the
verdict points at calls. Read `account_context_get` before any strategic or client-facing output.
Confirm every write. Nothing uploads to an ad platform without the two-step confirm at the end.

## 1. The chain, end to end

1. Visitor lands. The analytics embed (`hiveku-analytics.js`) has already captured click ids and
   UTMs into `localStorage.hiveku_utm_params` and minted `hiveku_visitor_id`.
2. The DNI snippet (`/api/embed/phone-tracking.js`) boots, adopts that same `hiveku_visitor_id`,
   mirrors it to the `hiveku_vid` cookie, and POSTs to `/api/embed/phone-swap/<projectId>`
   (optionally via `track.hiveku.com` so the server sees a geo signal).
3. The server assigns a tracking DID from the pool and writes a `voice_pool_sessions` row carrying
   the attribution. The snippet swaps every `tel:` href and the visible number text.
4. The visitor calls the DID; it rings through to the real destination.
5. Attribution runs: session matcher first, caller-id breadcrumb second. Google Ads click_view
   enrichment resolves the gclid to campaign, ad group and keyword.
6. The call becomes a CRM contact plus a `crm_activities` row of type call, and optionally uploads
   back to the ad platform through the offline conversion lane.

Every failure customers report lives at one of those steps. Identify the step first.

## 2. The swap snippet, and why it reads the persisted store

The snippet swaps `tel:` hrefs and text nodes, re-runs on a MutationObserver so single-page apps that
render the header late still get swapped, and re-POSTs after the session's `expires_at` but only when
the tab is visible (a background tab does not burn pool inventory). `?hkswaptest=<nonce>` on any page
URL is test mode, for watching a swap without polluting real pool assignment.

**The load-bearing detail: the snippet prefers the analytics embed's persisted first-touch store
over the current page URL.** The reason is arithmetic, not elegance. A pool session minted with a
null gclid can never be conversion-uploaded, ever, because `ppc_offline_conversion_upload` requires a
click id per entry and refuses the row with `no_click_id`. There is no later repair: the call
happened, the DID was assigned, and the assignment carries whatever attribution it was born with.

Two everyday boots would mint that null if the snippet trusted the current URL. **Consent-delayed
boot**: the visitor lands on `/?gclid=...`, the banner gates the analytics embed, the snippet boots
after acceptance on a URL that no longer carries the parameter. **Return visit**: they clicked the ad
Tuesday, came back directly Thursday and called, so the current URL is clean while the persisted
store still holds Tuesday's gclid inside the 90-day window. Reading the store converts both into an
attributed call.

Consequence to internalize: **a call is attributable only if the browser that swapped the number
could see the store.** Private mode, ITP eviction, storage blocked, or a hard consent denial produce
a swapped number with no click id, permanently, not as a reporting delay.

Related trap inherited from the embed: **first touch wins permanently** in `hiveku_utm_params`. A
non-empty store is returned and never rewritten, so a later ad click is not added and does not move
`capturedAt`. A caller can therefore be credited to the campaign that first found them rather than
the one that made them dial. That is the intended semantic and it explains most "wrong campaign"
complaints about calls. Do not "fix" it by clearing storage.

## 3. Pool assignment and the advisory lock

Assignment is **sticky per (visitor, pool, environment)**: the same visitor returning to the same
pool on the same environment gets the same DID back, which is what makes a callback from a saved
number still attribute correctly. Among eligible DIDs the picker is **weighted-random restricted to
numbers with no recent conversion**, spreading inventory and keeping a hot number from serving
several concurrent visitors. Selection and write happen under a **per-pool advisory lock**. Without
it two visitors mint sessions on the same DID in the same instant and the matcher credits the call to
whichever session sorts newest, which is not a rounding error, it is one advertiser's call credited
to another campaign. The lock is the invariant: one assignment decision per pool at a time.

`voice_pool_sessions` carries `utm_*`, `referrer`, `landing_url`, `gclid`, `gbraid`, `wbraid`,
`fbclid`, `msclkid`, `ttclid`, `ga_client_id`, `ad_consent`, `assigned_at`, `expires_at`.
`ad_consent` rides on the session and is tri-state (false = opted out, true = granted, null = no
signal); only an explicit false suppresses an upload to google, microsoft or meta.

## 4. The two matchers, in order, and the idempotency gate

**Matcher 1: session match, anchored to `call.started_at`.** The call matches the pool session that
owned that DID at the moment the phone rang. The anchor is the whole point: if matching used "now",
a sweep running hours later would credit the call to whichever visitor the DID was reassigned to in
the meantime. Anchoring to `started_at` makes a late run and an immediate run give the same answer.

**Matcher 2: caller-id breadcrumb.** With no session match, inherit the attribution of the caller's
most recent attributed call within 90 days. This catches the repeat caller dialing a saved number,
or someone calling from a different device than the one that browsed.

**Idempotency gate: a non-null `attribution_json` means done.** Nothing recomputes an already
attributed call, which is why the two entry points, the post-process worker (off the recording
pipeline) and `/api/cron/voice-call-attribution-sweep`, are safe to race.

Reading the result: matcher 1 gives a click id you can date and upload. Matcher 2 gives a channel
label that is honest for reporting but inherited, not observed on this call, so treat it with more
suspicion before an upload: one gclid uploaded for several calls from one repeat caller inflates the
platform's count against a single click.

## 5. Why the sweep exists (the part everyone misses)

**Missed, abandoned and unrecorded calls have no recording, so the post-process path never runs for
them.** If attribution only happened off the recording pipeline, every call that rang out, every call
abandoned in the IVR, and every call on a number with recording disabled would sit unattributed
forever. `/api/cron/voice-call-attribution-sweep` exists exclusively for that class.

Two consequences. **A missed call is still a conversion signal**: the lead dialed, and a campaign
generating calls nobody answers is a staffing finding worth more than most bid changes, visible only
because the sweep attributes recording-less calls. And **never diagnose "attribution is broken" from
calls that are all missed or abandoned and less than a sweep interval old**; they are waiting, not
broken.

## 6. Call to contact, activity and deal

On attribution the platform does a find-or-create on the CRM contact by caller number, then upserts a
`crm_activities` row of type call carrying the recording pointer, transcript and AI summary. Deal
linkage is `crm_activities.deal_id`. Two things follow that you need constantly:

- **`crm_get_contact` does NOT include calls.** Contact fields are not the call history. Use
  `crm_calls_list` with `contact_id`.
- **The contact carries click ids in four places** meaning different things: `crm_contacts.gclid`
  and `.click_ids` are the CURRENT touch; `.original_gclid` and `.original_click_ids` are the
  write-once FIRST touch; `crm_contacts.source_history[]` is the append-only dated audit trail and
  **is the only place that knows WHEN a click happened**; UTMs mirror the same current/original
  split. To date a call-sourced click for an upload, use `source_history`, never `updated_at` (any
  unrelated edit moves it, which is why it is explicitly rejected as a proxy).

## 7. Swap health, and the redeploy failure

The dashboard's swap-health monitor now has tool-side equivalents. The dashboard view itself still
has no tool, so never report its issue codes as if you read them there - name the tool you ran:

- **`voice_pools_list`** is the pool inventory: every DNI pool with `sticky_minutes`,
  `conversion_sticky_days`, `exhaustion_policy`, `is_active`, `member_count`, and per-member DID
  routing (where each inbound call actually lands). This answers `pool_empty` / `pool_exhausted`
  directly. One caution from its own registration: the call-handling block (whisper, greeting,
  caller_id_mode, attribution_model, tracking_source fields) comes from a SECOND read that can fail
  silently, so do not treat those specific fields as authoritative. Pool sizing against concurrent
  visitors is still your own arithmetic, not a returned field. `voice_numbers_list` (filter
  `is_active: 'true'`) remains the flat DID inventory.
- **`voice_call_tracking_live_probe`** proves the swap end to end: it asks the pool for a DID
  exactly the way a visitor's browser does, which is the only way to PROVE number swapping works.
  It HAS A SIDE EFFECT: the probe writes a `voice_pool_sessions` row and HOLDS that tracking DID
  for the sticky window, so on a small pool repeated probing starves live visitors. Run it to
  confirm a fix, never on a schedule, and send `live_probe: true` or it is just the read-only
  doctor with an extra round trip.
- To check the served HTML without burning a pool session: `analytics_probe_page` on the money URL,
  plus `analytics_diagnose_tracking({ project_id })` and its `tag-not-deployed` finding. Know how
  each one refuses. `analytics_probe_page` returns 403 (not 400) unless the URL's host matches a
  `custom_domain` on one of this account's projects - it only loads sites the account owns.
  `analytics_diagnose_tracking` returns 400 only when you OMIT `project_id` and the account has no
  live project carrying a custom domain; pass an explicit `project_id` and a domainless project
  still returns 200, with source-scan findings only: `browser_checked: false`, and no
  `tag-not-deployed`, because that finding compares source against served HTML and there is no
  domain to fetch. When the project does have a custom domain, `analytics_diagnose_tracking` runs
  the browser probe itself - you do not have to call `analytics_probe_page` first to get runtime
  findings.

The four issues the dashboard monitor reports:

| Issue | Meaning | First move |
|---|---|---|
| `site_unreachable` | The probe could not load the page at all | Confirm the site is up and the domain resolves before reading anything else |
| `snippet_missing` | Page loaded, DNI loader tag not in it | See below. This is the big one |
| `pool_empty` | No DIDs provisioned | `voice_pools_list` for the pool, then `voice_call_tracking_setup` with `did_count` (dry_run first - it spends money) or a task for the dashboard |
| `pool_exhausted` | Every DID currently assigned | Add inventory the same way, or accept that concurrent visitors share static numbers |

**`snippet_missing` after a redeploy is the most common way call attribution dies quietly.** The tag
was on the page, someone redeployed, the loader did not survive the deploy, and the site keeps
working perfectly: real numbers render, phones ring, revenue continues, and every call from that
moment is unattributed. Nobody asks on the day it happens because nothing looks broken. It surfaces
weeks later as "our Google Ads calls fell off a cliff in July".

Operating rule: **after any redeploy, prove the loader is in the served HTML before interpreting a
call attribution trend** - `analytics_probe_page` on the money URL, or one
`voice_call_tracking_live_probe` (it burns one pool session; that is what confirming a fix is for).
If the drop starts on a deploy date you have your answer, so stop
analyzing campaigns. Same
disease on the code side: `analytics_diagnose_tracking`'s `tag-not-deployed` finding exists because
committing is not deploying.

## 8. The tools, in depth

### `marketing_call_attribution_breakdown`
Groups attributed calls by source, medium and campaign, and by day in the **ad account timezone**
(not yours, not UTC; account for it before reconciling day boundaries against a platform export).

The part worth paying for is **call quality reporting the ad platform structurally cannot do**:
**duration distribution against THIS account's configured threshold** (Google counts a call as a
conversion once it passes a minimum duration, so a 12-second wrong number that clears the threshold
is a conversion in Google's column forever, with no way for Google to know better; Hiveku holds the
actual durations), and **disposition mix**, including voicemail, missed and abandoned counts.

Returns **no call rows and no transcripts**. Read: totals, per-campaign counts, duration buckets,
disposition mix. Decide: whether the platform's call conversion count describes real conversations.

### `marketing_call_attribution_list`
Everything the breakdown returns, plus individual calls. Per call: source, medium and campaign, the
tracking DID that rang, the crediting pool session, the duration bucket, whether the call meets the
account's conversion policy, and `has_transcript` / `has_summary`. `include_summaries: true` inlines
the AI summaries so you can triage without a per-call round trip.

**Percentages cover up to 5000 scanned calls. Check `totals.truncated`.** If true, the percentages
describe the scanned slice, not the period: narrow the range and re-run rather than reporting a
truncated percentage to a client.

Read: the crediting pool session (present = session match, inherited = breadcrumb), the DID (which
pool, therefore which campaign group), the conversion-policy flag. Decide: which calls earn a
transcript pull, and which belong in an upload batch.

### `marketing_call_transcript_get`
One call's verbatim, unredacted transcript plus the AI summary. **The argument is `call_id`, and it
is the only property the schema declares (required).** Pass the list row's `id` as `call_id`;
`marketing_call_transcript_get({ id })` fails validation. Deliberately a separate and costlier step
because it makes an S3 round trip. Do not loop it across a day of calls; pull the handful that
matter. The text is verbatim and unredacted, so it can contain card numbers, dates of birth and
health details: treat it as the most sensitive class of customer data and do not paste it anywhere it
would outlive the question.

**When the transcript is absent, `transcript_state` tells you which of five, and NONE of them means
"empty":**

| `transcript_state` | Meaning | What to do |
|---|---|---|
| `never_recorded` | No recording ever made (missed, abandoned, recording off for that DID) | Expected, not a bug. Report the call from disposition and duration only |
| `pending` | Transcription unfinished | Wait and re-pull. Do not report zero |
| `failed` | Transcription attempted and errored | Escalate; the recording may still exist |
| `purged` | Retention policy deleted it | Permanent. **Do not chase this as a failure** |
| `unreadable` | Stored object cannot be read back | Escalate. The one that indicates real breakage |

The trap is `purged` read as `failed`. A retention deletion reported as a transcription bug sends an
engineer chasing a defect that does not exist and tells the client their system is broken when their
own retention setting worked as configured. Always relay the state, never just "no transcript".

A second, voice-side transcript rail exists, keyed by `voice_calls.id` instead of the attribution
list's id: **`voice_call_transcript_get`** returns the entire stored transcript inline as one string
(unredacted, no truncation; 404 `no_transcript` while `transcript_s3_key` is still null, the normal
state until post-processing lands). **`voice_call_get`** deep-links one call - but per its own
registration three fields answer 200 having told you nothing true: `recording_url` is HARDCODED
null (`has_recording` is the real signal), `recording_transcript` carries the AI summary, NOT the
transcript, and `status` is derived, so a call still ringing reads `failed`.
**`voice_recording_url_get`** issues a presigned, UNAUTHENTICATED 5-minute download of the audio
that is not revocable once issued - prefer the transcript, and never paste the URL anywhere that
outlives the question. Use this rail when the call never attributed (so it has no attribution-list
row) and you still need the words.

### `crm_calls_list`
The call history behind a contact. Filters: `contact_id`, `company_id`, `deal_id`, `has_recording`,
`has_transcript`. The lead-centric view, where `marketing_call_attribution_list` is campaign-centric.
Use `deal_id` for "what conversations preceded this win", `has_transcript: true` to skip to callable
evidence. Again: `crm_get_contact` does not include calls, so reaching for it and reporting "no call
history" is a wrong answer, not a missing one.

### Voice diagnostics
The `voice_*` family is no longer read-only - it carries ring-group / IVR / extension CRUD,
`voice_settings_update`, `voice_number_release` and the `voice_call_tracking_*` writes. The
diagnostics below are still all reads. A voice finding may now ship as a confirmed, named fix where
a tool exists (section 13 says which), but never as an unconfirmed one; anything tool-less is still
the named finding plus `pm_tasks_create`.

- **`voice_diagnose_setup`** takes NO arguments and returns `tenant_provisioned`, active DIDs, DIDs
  missing E911, counts of extensions / ring groups / IVRs / verified E911 addresses, and a
  `blocking_issues[]` array of human-readable problems. Cheapest health signal in the registry. Run
  it first when calls are wrong at the telephony layer rather than the attribution layer. Non-empty
  `blocking_issues[]` means stop analyzing attribution and fix the phone system.
- **`voice_recent_calls`** (`limit` default 10 max 50, `hours_back` default 24 max 168) and
  **`voice_calls_list`** are the raw call log, independent of whether attribution ran. This is how
  you prove a call exists at all. "We got a call at 2:15 and it is not in the report": a call present
  here and absent from `marketing_call_attribution_list` is an attribution question; absent from
  both, it never reached the platform.
- **`voice_numbers_list`** for DID inventory (`is_active` is the string `'true'` / `'false'`, not a
  boolean). This is the pool-sizing read.
- **`voice_tenant_healthcheck`** runs the voice server's per-tenant consistency battery and returns
  `{ ok, checks: [{ id, ok, detail }] }` - each check compares Hiveku's rows against what is
  actually in the PBX (outbound rules, DID targets, ring-group dialplan rules, E911 on active DIDs,
  IVR audio on disk). `ok` is true only when every check passed. Run it beside
  `voice_diagnose_setup` when provisioning looks right but calls still misbehave.
- **`voice_extensions_list`** (`endpoint_type` is one of `desk_phone`, `softphone_mobile`,
  `softphone_desktop`, `external_number`), **`voice_extension_status({ q })`** where `q` is the dial
  number like `'1003'` or the extension UUID, **`voice_ring_groups_list`**, **`voice_ivrs_list`** for
  routing: why calls go unanswered, where they land, whether the IVR is where callers abandon.
- **`voice_ivr_walk`** reads ONE IVR tree with every menu target pre-resolved a single level deep -
  options keyed by digit, ring-group targets carrying their full member roster in ring order,
  sub-IVRs as a stub that does NOT recurse. A deleted or missing target does not error: it comes
  back as `{type: 'unknown', reason}`, which is exactly the finding when "callers land in the wrong
  menu". `after_hours` runs through the same resolver.
- **`voice_queues_list`** - the ACD call queues, every queue with every member in one response (no
  pagination). Per its registration, a queue with `fusionpbx_queue_uuid: null` exists in the
  database but was never loaded into the phone system - it does not work and nothing reports that
  as an error, so read the nulls, not just the rows.
- **`voice_voicemails_list`** - the voicemail inbox (a voicemail is a `voice_calls` row with
  `disposition: 'voicemail'`, nothing else appears here), with transcript text and summaries
  inline. `audio_url` is a 5-MINUTE PRESIGNED S3 LINK to a real person's voice that works for
  anyone holding it, no login: never paste it into a ticket, log or report; pass
  `audio_urls: 'false'` to skip the presign. `voice_voicemail_mark_read` is a write that clears
  the unread badge a human may be triaging from - never use it to tidy an inbox you are only
  reading.
- **`voice_toll_fraud_state`** takes no arguments and returns current daily-outbound billable seconds
  against the toll-fraud cap. It is the definitive answer to "why are our outbound calls being
  rejected" - see the play in section 13.
- **`voice_e911_addresses_list`** returns registered plus pending-verification addresses. Compliance
  surface, not attribution - see the play in section 13.

**The two call surfaces use DIFFERENT vocabularies. Translate before comparing.**

| | `voice_calls_list` | `marketing_call_attribution_*` |
|---|---|---|
| `disposition` | a single STRING: `answered \| voicemail \| missed \| ai_handled \| abandoned` (the CDR writer's whole vocabulary; the tool description still advertises `no_answer/busy/failed`, which are NEVER stored) | an ARRAY: `answered \| ai_handled \| voicemail \| missed \| abandoned` |
| `direction` | `inbound \| outbound` only | `inbound \| outbound \| internal` |

Filtering `voice_calls_list` with `missed` WORKS - it is exactly how you count missed calls. The
silent-zero traps run the other way: `no_answer`, `busy` and `failed` are advertised in the tool's
own description and NEVER stored, so filtering on them returns an empty result that reads as "no
problem". On the attribution tools `disposition` must be an array (`['missed']`, not `'missed'`).
And a `voice_calls_list` total silently excludes internal calls, so the two totals legitimately
differ before any attribution gap exists. Never read the raw totals as directly comparable.

### Cross-references
**`analytics_channel_scorecard`** tops the ladder for "why isn't this channel recording conversions",
and its **call reconciliation** causes name why observed calls did not become platform conversions:
`upload_disabled`, `no_click_id_captured`, `outbox_stuck`, `action_missing`, `action_disabled`,
`action_not_counted`, `no_upload_lane`, `platform_unreadable`. Relay its `headline` verbatim; it
carries the number that makes the problem undeniable. Slow, so call it once, never in a loop, and
note `conversions_last_30_days: null` means we could not read it, never zero.
**`marketing_form_conversion_audit`** is the form-side equivalent; "where did our conversions go"
usually needs both halves. **`ppc_digest`** flags stale connections (over 25 hours since sync) before
you trust any platform-side number.

## 9. The call-conversion doctor and its family

The structured call-conversion doctor is a tool: **`voice_call_tracking_diagnose`** (GET). One
structured verdict on whether phone-call conversions are actually reaching Google Ads and what to
fix first: seven checks, each `ok | warn | fail | unknown` with a plain-language explanation and one
concrete next action, plus an overall verdict and an ORDERED `fix_first` list. **Read `fix_first`
rather than the check array - the checks are diagnostic, the order is the answer.** Read-only but
not free: it makes outbound Google Ads read calls and one HTTP GET of the deployed page. Pass
`skip_google` / `skip_site_fetch` to stay inside the database when either is slow or broken; the
skipped checks then report `unknown`, and **an `unknown` is NOT a pass** - never relay it as one.
`project_id` is a selector inside the bound account: omit it and the doctor picks the most recently
updated non-archived project, which on a multi-site account can diagnose the wrong site, so pass it
explicitly.

Its companions:

- **`voice_call_tracking_outbox`** (GET) - the row-level upload outbox (`voice_conversion_uploads`):
  which call conversions were queued, uploaded, failed or skipped, with the originating call joined
  on and each `error_code` translated. Use it once the doctor says uploads are failing and you need
  WHICH ones and why - filter `status: 'failed'` first. An empty result means one of two very
  different things: nothing was ever enqueued (a tracking problem, ask the doctor) or everything
  uploaded cleanly. Read this BEFORE escalating an `outbox_stuck` cause, so the escalation carries
  row counts and error codes instead of a guess.
- **`voice_call_tracking_live_probe`** (POST) - the doctor plus a real pool assignment (section 7's
  cautions apply: it holds a DID; confirm fixes, never schedule it).
- **`voice_call_tracking_setup`** (POST) - one idempotent operation wiring call-conversion tracking
  end to end: number pool, tracking DIDs, per-project phone-tracking config, the tenant
  conversion-upload policy, and the Google "Hiveku - Phone Call" conversion action, with per-step
  results so success is never inferred from a bare 200; re-runs report `already_configured`.
  **`did_count` is the ONLY field that spends money** - omit it or send 0 and nothing is bought;
  when set it buys only the shortfall, at most 5 DIDs per run, and only after the E911 address
  checks out (a missing or unvalidated E911 address comes back as a `blocked` step naming the human
  action). **Always `dry_run: true` first** on any account where you are not certain what exists,
  and confirm with the operator before any run that names a nonzero `did_count` - numbers bill
  monthly until released.

`analytics_channel_scorecard`'s call reconciliation causes still name the same failures at the
channel level (`upload_disabled`, `action_missing`, `outbox_stuck`, `no_click_id_captured`), and
`ppc_conversion_actions_list` / `ppc_conversion_tracking_status` (both **Google only** - another
platform returns a wrong-platform error, not an empty result) remain the deep read on the
conversion action itself.

## 10. Worked play: "are our call conversions real?"

A campaign reports 60 call conversions this month and the client calls it their best. The question is
whether those 60 are conversations.

1. `account_context_get({ domain: 'ppc' })` for voice and any account rule about what counts as a
   qualified call.
2. `marketing_call_attribution_breakdown` for the period. Read the duration distribution against the
   account's configured threshold and the disposition mix. This number does not exist in the ad
   platform.
3. Split three ways. **Below threshold**: not counted by the platform, ignore. **Just over
   threshold** (threshold to roughly threshold plus 15 seconds): the suspect band, because nobody
   books a service in 20 seconds; these are wrong numbers, hangups and people confirming hours.
   **Comfortably over**: plausible conversations.
4. `marketing_call_attribution_list` with `include_summaries: true` over the suspect band. The AI
   summaries classify a few dozen calls without a transcript round trip each.
5. `marketing_call_transcript_get` on five to ten of them to verify the summaries before you put a
   number in front of a client. Never generalize from summaries alone when the conclusion is "a
   third of your conversions are not real".
6. Report as: the platform counts 60; N are under 30 seconds; M of the sampled are wrong numbers or
   hangups; real conversation volume is approximately X. Give the sample size.

**Decision this drives.** A large suspect band is usually fixed at the conversion action, not the
campaign: raising `phone_call_duration_seconds` makes shorter calls record nothing and cleans the
signal Smart Bidding optimizes on. That is a write via `ppc_google_conversion_actions` (update), so
confirm first, stating current value, proposed value, and that history does not change
retroactively. Two adjacent traps there: `include_in_conversions_optimization: false` makes an action
reporting-only and pulls it out of Smart Bidding, and **`always_use_default_value: true` flattens
every conversion and destroys transaction-level revenue reporting**, after which tROAS bids against
a constant.

**What NOT to conclude.** A high missed or voicemail share is a staffing or routing finding, not a
tracking failure: confirm with `voice_ring_groups_list` and `voice_extension_status` before blaming
attribution. And few attributed calls beside many total calls in `voice_calls_list` is an
attribution gap (start at the snippet: `analytics_probe_page` on the money URL), not a weak campaign.
Before you compare those two counts at all, read the vocabulary note in section 8: the totals are not
directly comparable.

## 11. Worked play: reading a lead's call transcript to understand what they wanted

Sales says the leads from a campaign are junk. Nobody has listened to a call.

1. Find the contact, then `crm_calls_list({ contact_id, has_transcript: true })` for calls with
   callable evidence. From a deal instead, filter by `deal_id`; that answers "what conversations
   preceded this outcome".
2. `marketing_call_attribution_list` over the same window for the campaign, the crediting pool
   session, and the `id` the transcript tool needs. Do not look for a transcript id in
   `crm_calls_list`; `marketing_call_transcript_get` is keyed by the attribution list's id. (For a
   call with no attribution row, the voice-side rail in section 8 - `voice_call_transcript_get` on
   the `voice_calls.id` - is the alternative.)
3. `marketing_call_transcript_get({ call_id })`, passing the list row's `id` as `call_id`. The
   parameter is named `call_id` and it is the only one; `{ id }` fails input validation.
   If it returns no transcript, relay `transcript_state` and
   act on it: `pending` means re-pull, `purged` means the evidence is gone by policy and you say so,
   `failed` or `unreadable` means escalate.
4. Read what the caller asked for in their first two sentences against the ad and landing page they
   came through. The mismatch is usually the finding: the ad promises one service and the caller
   wants an adjacent one, or wants a price the client does not compete on. Feed that back as a
   targeting or copy change and log the decision so it is not re-derived.

**What NOT to conclude.** `has_transcript: false` is never "the call was empty"; none of the five
states means empty. Do not generalize a campaign from one transcript. Do not report a `purged`
transcript as a system failure.

## 12. Uploading calls back to the ad platform

Full detail lives in the offline-conversions reference. What a call operator must not get wrong:

**`ppc_offline_conversion_upload` is strictly two-step and Google Ads only.** The first call, with no
`confirm`, returns a dry-run preview with `requires_confirm: true` and uploads nothing. Show the
operator that preview, refusal reasons verbatim, and only then repeat the **identical** call with
`confirm: true`. Never collapse the steps, never upload silently, never bulk-apply. Another
platform's connection returns a wrong-platform error, not an empty result. Per entry: `gclid`
(preferred) or `order_id`; `conversion_date_time` as `'YYYY-MM-DD HH:MM:SS+HH:MM'`;
`conversion_value`; `currency_code`. Partial failures come back per row, so read the response.

Call-specific refusals to expect and explain: `no_click_id` (the swap minted a null, section 2,
permanent for that call), `ad_consent_denied` (a call has no browser to collect a signal, so consent
resolves per contact from their form submissions), `stale_click` (Google 90-day click window, import
max age 63 days), `TOO_RECENT_*` (6-hour minimum upload delay, so this morning's call is not
uploadable yet). And outside our system entirely: the conversion action must exist in the Ads UI
**and be configured with source Upload** (Conversions, New conversion, Import) or the upload succeeds
into nothing. Verify with `ppc_conversion_actions_list` before the first batch.

## 13. Voice operations: the phone system itself, not its attribution

Everything above assumes the phones work. When the complaint is telephony ("the phones aren't
ringing", "callers land in the wrong menu", "nobody can reach extension 1003", "we can't dial out"),
stop doing attribution work and run this ladder. `/hiveku:phone-check` is the same ladder as a
command.

**The ladder.**

1. **`voice_diagnose_setup`** - no arguments. If `tenant_provisioned` is false, that is the whole
   answer: the account has no voice tenant and nothing below will make sense. If `blocking_issues[]`
   is non-empty, report those verbatim and stop; they outrank anything you would find further down.
   When provisioning reads clean but calls still misbehave, **`voice_tenant_healthcheck`** is the
   second health surface: the per-tenant consistency battery comparing Hiveku's rows against the
   actual PBX, `ok` true only when every check passed. `voice_usage_get` adds the plan context
   (minutes, seats, DID count, the daily outbound cap figure) when the question smells like a limit.
2. **If the complaint is OUTBOUND** ("outbound calls rejected", "can't dial out", "calls fail
   immediately when we dial") - **`voice_toll_fraud_state`**, no arguments. It returns current
   daily-outbound billable seconds against the toll-fraud cap. A cap hit is **not a bug and not a
   Hiveku fault**: it is a spend guard that did its job. Report the current seconds, the cap, and
   what burned them (`voice_calls_list({ direction: 'outbound', hours_back: 24 })` shows the volume)
   BEFORE any talk of raising it - the write surface note below governs the raise itself.
3. **Prove calls exist at all** - `voice_recent_calls({ hours_back })` (max 168) or
   `voice_calls_list`. No inbound rows at all in a window where the client swears they were called is
   a carrier or DID-routing problem, not a routing-config problem.
4. **Routing** - `voice_ring_groups_list` and `voice_ivrs_list` for where a call is supposed to land,
   `voice_ivr_walk` on the specific IVR when the complaint is "callers land in the wrong menu" (a
   `{type: 'unknown'}` resolved target IS the finding - the option points at something deleted),
   `voice_queues_list` when the tenant routes through call queues (a `fusionpbx_queue_uuid: null`
   queue was never loaded into the phone system and silently does not work), and
   `voice_extension_status({ q })` with the dial number (`'1003'`) or the extension UUID for whether
   that seat is actually registered. An unregistered endpoint is the usual "my phone never rings":
   the ring group is correct and the device is not connected.
5. **DID inventory** - `voice_numbers_list({ is_active: 'true' })`. A number the client publishes
   that is not in this list is not ours to ring.
6. **Voicemail** - `voice_voicemails_list` when the complaint is "messages are disappearing" or
   "nobody heard the voicemail". A voicemail is a `voice_calls` row with `disposition: 'voicemail'`;
   `read` / `read_at` say whether a human ever opened it. Do not mark anything read while
   diagnosing.

**The write surface, and its rules.** (The full operator manual for everything below now lives in
the **hiveku-phone-agency** skill - `hiveku-phone-agency/references/pbx-routing.md` and its
siblings; this section keeps only what a tracking investigation needs.) The registry now carries
live-PBX writes: ring-group, IVR and
extension create / update / delete, `voice_settings_update`, `voice_number_release`,
blocked-number edits. These are not drafts - a ring-group create rings real desk phones the moment
it returns, an IVR create renders greetings through a paid TTS vendor and answers real callers, and
per its own registration nothing cross-checks a ring-group extension you pick against the other
extension pools, so a collision is yours to prevent. Ship a routing fix only with the operator's
explicit yes to the exact change, one object at a time, echoing before and after. What remains
tool-less or hard-stopped:

- **E911 address registration** is tooled now (`voice_e911_address_create` - this is where 911
  DISPATCHES, an ask-gated write owned by the **hiveku-phone-agency** skill; pending is still not
  registered).
- **Buying a number directly** is tooled now too (`voice_number_purchase` - money monthly until
  released, ask-gated, hiveku-phone-agency's `references/numbers-and-e911.md`). Inside a tracking
  pool, prefer `voice_call_tracking_setup`'s `did_count` (max 5 per run, E911-gated,
  confirm-first) - it joins the pool and wires the config in the same idempotent run.
- **`voice_number_release` is permanent**: the DID returns to the carrier, can be sold to a
  stranger, and every printed instance of it stops working. Only ever after a human confirms that
  exact number, by digits - never a bulk sweep, never a target derived from "unused".
- **The toll-fraud cap** is now writable (`voice_settings_update`, `daily_outbound_cap_cents`), and
  that is precisely why the refusal matters. Hard stop, a response contract: "we hit the cap, raise
  it so we can keep dialing" - do not raise it as the first move. The cap is a spend guard that did
  its job; report the current seconds, the cap, and what burned them
  (`voice_calls_list({ direction: 'outbound', hours_back: 24 })`) first, and raise it only when the
  operator confirms the volume is legitimate business calling, with the new figure named. Do not
  offer "set it very high" or "disable the guard" as a workaround.

For anything on that tool-less list, and for any fix the operator does not confirm, the deliverable
is unchanged: the named cause plus `pm_tasks_create` for the dashboard work, and if it is client
visible, the honest sentence about what is broken and who has to touch it.

### E911 compliance (run at onboarding and in every periodic review)

An active DID with no verified E911 address means a 911 call from that number may not reach the right
PSAP with the right location. For an agency running a client's phone system that is legal exposure
under Kari's Law and RAY BAUM'S Act, not a nice-to-have.

1. `voice_diagnose_setup` - read `DIDs missing E911` and the verified-address count.
2. `voice_e911_addresses_list` - registered plus pending-verification addresses. **Pending is not
   registered.** Count them separately.
3. Cross-reference against `voice_numbers_list({ is_active: 'true' })` to name WHICH active DIDs have
   no verified address. The tool does not do this join for you; you do it, and you report the actual
   numbers, not a count.
4. File it: `pm_tasks_create` with the named DIDs, and raise it to the client as a risk item.

Registration is `voice_e911_address_create` plus `voice_number_update`'s `e911_address_id` (both
confirm-gated; the hiveku-phone-agency skill owns the play). Never report "registered" until the
address row carries `verified_at` and the DID row points at it - pending is not registered.
