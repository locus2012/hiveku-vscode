# Reference: Calls, Voicemail, Recordings, Transcripts

The manual for reading what the phone system already did: call history and dispositions, the
voicemail queue, recordings and transcripts, the CSV export, wrap-ups, and the crossing into
helpdesk and the CRM. Load it before answering "who called", before pulling a transcript,
and before touching a voicemail's read state. Routing and diagnosis of the system itself is
`references/pbx-routing.md`; attribution verdicts are `references/conversion-send-back.md`.

## Availability

Every tool in this file is LIVE today - nothing here is waiting on a ship.

| Tool | State |
|---|---|
| `voice_calls_list`, `voice_recent_calls`, `voice_call_get`, `voice_calls_export_csv` | LIVE |
| `voice_call_disposition_set`, `voice_number_lookup`, `crm_calls_list` | LIVE |
| `voice_voicemails_list`, `voice_voicemail_mark_read` | LIVE |
| `voice_call_transcript_get`, `voice_recording_url_get`, `voice_audit_export_csv` | LIVE |
| `marketing_call_transcript_get`, `marketing_call_attribution_list`, `marketing_call_attribution_breakdown` (full-profile key) | LIVE |
| `helpdesk_ticket_transfer_to_voice`, `helpdesk_ticket_list` (full-profile key) | LIVE |

## Part 1: The mental model

Everything is a `voice_calls` row. There is no separate voicemail object, no separate
missed-call object, no separate recording object: one row per call, carrying direction,
disposition, duration, the number that rang, attribution, and pointers to a recording and a
transcript in the encrypted recordings bucket. A voicemail is a `voice_calls` row whose
disposition is `voicemail` - `voice_voicemails_list` is a dedicated queue over exactly that
filter, and its own registered description confirms the model.

Voice runs across two systems: the builder holds the data and the API, and the voice server
on an EC2 box runs FreeSWITCH and the call logic. That split matters here for one thing: the
post-processing pipeline that uploads the recording and produces the transcript and AI
summary is ASYNCHRONOUS and lands a beat (sometimes minutes) after hangup. A just-ended call
legitimately has no transcript, no recording URL and even no CDR row yet. "Missing right
after the call" is the normal state, not a failure.

## Part 2: Reading calls

### `voice_calls_list` - the general history, and the disposition truth

`voice_calls_list({ direction?, disposition?, hours_back?, page?, limit? })` lists call
history and returns RAW rows - `from_e164` / `to_e164` plus `billable_seconds`,
`ai_sentiment`, `spotted_keywords`, `attribution_json`, `utm_campaign`, `tracking_source`,
`call_uuid`, `project_id`, `pool_session_id`, `queue_id`, `crm_activity_id` and
`voicemail_read_at`, none of which the single-call read returns.

**The disposition trap produces confidently wrong answers.** The column only ever holds five
values, written by the voice server's CDR writer:

`answered`, `voicemail`, `missed`, `ai_handled`, `abandoned`

A `NO_ANSWER` or `USER_BUSY` hangup is collapsed to `missed`; a caller who hung up while
still ringing is `abandoned`; the AI receptionist is `ai_handled`. The tool's own parameter
documentation still advertises `no_answer`, `busy` and `failed` - those are NEVER stored,
there is no enum on the route, and the filter is a raw equality match, so a stale value
returns ZERO rows on every account, silently. `voice_calls_list({ disposition: 'missed' })`
WORKS and is how you count missed calls; `no_answer` reports zero for an account that had
fifty. The `marketing_call_attribution_list` / `marketing_call_attribution_breakdown` pair
filters the SAME column, documents the vocabulary correctly, and takes it as an ARRAY where
`voice_calls_list` takes a single string.

One more asymmetry worth knowing: `voice_calls_list` carries NO plan gate, so it answers 200
on an account where `voice_call_get` and the voicemail queue answer 402 `voice_not_enabled`.

### `voice_recent_calls` - the diagnostic cut

`voice_recent_calls({ limit?, hours_back? })` is built for "calls aren't coming through" and
"it goes to voicemail too fast": recent calls plus dispositions, for call FLOW rather than
call VOLUME. `limit` defaults 10, caps 50; `hours_back` defaults 24, caps 168.

### `voice_call_get` - one call, three lies

`voice_call_get({ id })` fetches one call by `voice_calls.id`, for a deep link older than
the newest list page. Three traps, each a 200 that tells you nothing true:

1. **`recording_url` is HARDCODED null on every response.** `has_recording` is the real
   signal; playable audio only comes from `voice_recording_url_get`.
2. **`recording_transcript` carries the AI summary, NOT the transcript** (it is
   `voice_calls.ai_summary`, AI-written prose). The actual words come from
   `voice_call_transcript_get`.
3. **`status` is derived**: a call still ringing (no disposition, no `ended_at`) reads
   `'failed'`; an `ai_handled` call reads `'completed'`.

Also: `from_number` / `to_number` coerce a NULL number to `''`, so an anonymous caller reads
as empty string; the projection DROPS most of the row (see the list above - come back to
`voice_calls_list` for attribution fields); `peer_name` / `contact_id` come from a
last-7-digit match against non-deleted CRM contacts, so two numbers sharing a tail attach
the same contact and an archived contact reads as no match; 404 `not_found` is also the
cross-tenant answer.

### `voice_calls_export_csv` - powerful, and every edge is a trap

One row per call, for diffing against a CallRail or ad-platform export. Columns include
`call_uuid`, direction, both numbers, disposition, timestamps, `billable_seconds`,
`tracking_source`, `ai_sentiment`, `ai_summary`, the `utm_*` set, keyword, ad_group,
`click_id_type`, `landing_url`, `repeat_caller`, environment.

- **There is NO file and NO download link.** The raw CSV body comes back inline as the tool
  result, up to 50,000 rows of caller numbers and full AI call summaries straight into the
  conversation. ALWAYS bound it with `from` and `to`.
- **Truncation is silent** at 50,000 rows with no marker: exactly 50,000 data rows means
  assume a cut and narrow the window.
- **An unrecognised `disposition` or `direction` value is DROPPED, not refused** - one typo
  silently exports EVERY call in the period instead of the slice you asked. The UI's Missed
  chip is three dispositions, which is what `missed_any` means (`missed`, `abandoned`,
  `voicemail`).
- `to` is bumped to end of UTC day (the last day is included); an UNPARSABLE `from` or `to`
  is silently ignored rather than refused. `sort` outside the allowlist falls back to
  `started_at`; only the exact string `'asc'` flips the order - under the row cap, desc
  keeps the newest calls and asc keeps the oldest.
- **Blank utm columns do NOT mean direct traffic**: a call whose attribution sweep found
  nothing is stored as an `{unmatched: true}` sentinel rendered exactly like
  never-processed. `keyword` prefers the Google Ads click_view enrichment and falls back to
  `utm_term`. `click_id_type` is the LABEL of the click id (gclid, gbraid, wbraid, fbclid,
  msclkid, ttclid), never the value. `repeat_caller` is `'true'` or empty, never `'false'`.
- `q` searches `ai_summary`, a digits match on BOTH numbers (3+ digits), and up to 50
  non-deleted CRM contacts by name matched against BOTH legs - the voicemail inbox matches
  the caller leg only, so the same `q` can return different sets there.
- Cells are formula-guarded: a value starting with `=` `+` `-` `@` tab or CR arrives with a
  leading apostrophe.
- **Compliance note:** the dashboard export writes an audit row; this tool's export calls
  the audit helper with a null actor, which skips the row - so an export taken here leaves
  NO trace on the voice audit page and will not appear in `voice_audit_export_csv`. Say so
  when a client's compliance posture cares.

### `crm_calls_list` - the contact-centric view

`crm_calls_list({ contact_id?, company_id?, deal_id?, has_recording?, has_transcript?,
search?, page?, limit? })` is the call history behind a contact - `crm_get_contact` does NOT
include it, so this answers "what calls have we had with this person". Full-profile key
(`crm_` prefix).

### `voice_number_lookup` - the identity oracle, handle as PII

Resolves a raw number to `{ contact: { id, name } | null, last_call_at }` for an in-call
card. Matching is last-7-digits contains, deliberately loose: two numbers sharing their
final seven digits resolve to the same contact, duplicates resolve to whichever is seen
first, and soft-deleted contacts never resolve (an archived customer reads as no match).
SILENT FAILURES: an omitted, empty or under-7-digit input answers 200 with nulls - never
400 - so malformed input is indistinguishable from a genuine miss; and because the result
map is keyed on the CONTACT's own last 7 digits, a stored number with a differing tail
(an extension suffix like `555-1234 x99`) matches the filter yet resolves to
`contact: null`. `last_call_at` is the newest call touching that 7-digit tail in EITHER
direction at ANY disposition - an unanswered outbound attempt sets it, and it can come from
a different number sharing the tail. It is not evidence of a conversation.

### `voice_call_disposition_set` - the wrap-up write

Saves an operator wrap-up (an outcome chip plus notes) against a just-ended call. A CRM
write only: it never dials, never ends anything, and does NOT touch
`voice_calls.disposition`, so call lists and the CSV export never reflect what you set here.
Mechanics and traps, all load-bearing:

- **The timestamp field is camelCase: `startedAtIso`** (with `peer`). The handler finds the
  CDR row by the last 7 digits of `peer` within a plus/minus 120-second window around
  `startedAtIso`. Under 7 digits or unparsable time is a 422.
- **Slow on purpose**: the CDR lands a beat after hangup, so a miss retries 3 times with a
  2.5s sleep after EVERY failed attempt - a miss blocks ~7.5 seconds before answering 404
  "call not found yet". That 404 right after hangup means wait, not wrong.
- **The disposition string is NOT validated.** Anything is stored; the CRM picker only has
  labels for `connected`, `left_voicemail`, `no_answer`, `busy`, `wrong_number`,
  `callback_requested`, `not_interested`, `qualified`, `unqualified` - anything else renders
  as a blank, broken-looking chip. (This manual vocabulary is the one that looks like the
  stale `voice_calls_list` filter values. They are different systems.)
- **Pass `direction` on outbound calls.** Omit it and the activity is titled "Inbound call"
  with the contact resolved from the CALLER leg - your own DID - so the wrap-up links to the
  wrong contact or none.
- Overwriting a previous wrap-up is NOT reversible (neither field is versioned), and a
  supplied `notes` REPLACES the old note wholesale. Sending only one of the two leaves the
  other intact. `created: false` in the response means it merged into an existing activity.
- The peer match is newest-first within the window, so two calls with the same person inside
  4 minutes can tag the wrong leg.
- A key actor writes `owner_id` null, so rep-scoped CRM views (leaderboard, My Queue)
  silently skip the activity, and no author or timestamp metadata is stamped. Safe against
  retries: keyed on `call_uuid`, a second identical call merges instead of duplicating.

## Part 3: Voicemail

### `voice_voicemails_list` - the queue, with the `audio_urls: 'false'` discipline

The paged voicemail inbox, newest first. Each row: caller, `contact_id`,
`duration_seconds`, `summary`, `transcript_text`, `read` / `read_at`, `has_audio`,
`audio_url`. Read-only - but it hands back credentials:

**`audio_url` is a 5-MINUTE PRESIGNED S3 LINK to a recording of a real person's voice**,
minted per row; anyone holding it can fetch the audio with no Hiveku login. **Pass
`audio_urls: 'false'` on every sweep where you are not about to play the audio** - only that
exact string skips the presign. `audio_url` null while `has_audio` true means the presign
could not be minted (bucket unconfigured, or the error was swallowed): report "audio exists,
link unavailable", never "no audio".

The rest of the trap list, from its registered description:

- 402 `voice_not_enabled` is a PLAN refusal, not an empty inbox.
- `limit` defaults to 200 (not 50), clamped 1-200; a non-numeric limit falls back to 200.
- `total` is counted BEFORE the cursor narrows: it never shrinks as you page. Stop on
  `next_cursor` null, never on a running count reaching `total`.
- The cursor is honoured ONLY on the default sort (`received_at` desc). Any other
  sort/dir SILENTLY IGNORES it - page one forever - while `next_cursor` is still returned.
  When the cursor branch runs, any `offset` you sent is ignored.
- `unread_only` and `has_audio` act only on the literal string `'true'`; anything else
  applies NO filter, so an unread-only sweep can quietly return the whole inbox.
- `from`/`to` are UTC dates, `to` covers the whole day, and an unparsable date is silently
  skipped - one typo widens the range to everything. `to_e164` is exact equality.
- `q` searches the AI summary, digits on both numbers, and up to 50 contacts by first/last
  name matched against the CALLER leg only. It NEVER reads the stored S3 transcript - words
  spoken on a call whose transcript lives in S3 cannot be found here.
- **`ai_summary` carries one of two different artifacts**: when it begins
  `'Voicemail transcript: '` the row holds a raw Deepgram transcript (`summary` is null,
  `transcript_text` holds the words); otherwise `summary` is an AI-written summary and
  `transcript_text` is null. The legacy `transcript` field falls back to the summary, so
  reading it can hand you a summary labelled as a transcript - read `summary` and
  `transcript_text` instead. `has_stored_transcript` true means the real transcript is in
  S3: fetch it with `voice_call_transcript_get`.
- `peer_name`/`contact_id`: the same loose last-7-digit match as everywhere else.

### `voice_voicemail_mark_read` - never while diagnosing

Stamps or clears `voice_calls.voicemail_read_at`. The real-world effect lands on the humans:
marking read CLEARS THE UNREAD BADGE someone is triaging from and drops the message out of
every unread-only sweep. **Never use it to tidy an inbox you are only reading, and never
during a diagnosis** - flip read state only when a human asked for exactly that.

- `read` must be a real JSON boolean; the string `'true'` is a 422.
- Returns only `{ id, read }` echoed back - a 200 says one row was written, not what the
  timestamp says; read back with `voice_voicemails_list`.
- 404 `not_found` collapses three situations: unknown id, another account's id, and a real
  call on this account that is not a voicemail.
- Reversible by sending the opposite value, with one loss: `read: false` NULLs the column
  and the previous heard-at timestamp is gone for good. Nothing audits this flip.

## Part 4: Transcripts and recordings

### Two transcript paths to the same stored objects

**`voice_call_transcript_get({ id })`** (in-profile on a communications key) returns the
full transcript inline as one string, read server-side out of the KMS recordings bucket - no
speaker array, no timestamps, no pagination, so a long call is one large payload. NO
redaction, NO consent check, NO retention check; the only verification is that the call
belongs to the key's account. Its two 404s mean different things: `no_transcript` when the
transcript key is null - the NORMAL state until post-process lands, and a PERMANENT state
when the extension has transcription off; `transcript_unavailable` when the stored object
cannot be read - which is byte-identical whether the bucket env var is unset, the S3/KMS
read was denied, or the object was swept (the reader swallows every non-NoSuchKey error, and
this route never answers 503). One more quirk: it never returns the AI summary - read that
from `voice_call_get`'s `recording_transcript` field.

**`marketing_call_transcript_get({ call_id })`** (full-profile key) returns the transcript
PLUS the AI summary and the `transcript_state` verdict. Deliberately a separate, costlier
step - the storage round trip a list sweep must never pay implicitly. Call it for calls you
have a specific question about; NEVER map it across a result set.

### `transcript_state` has five values and none of them means "empty"

| State | Meaning | What to tell the user |
|---|---|---|
| `never_recorded` | No recording ever existed | Nothing failed; recording was off or not applicable |
| `pending` | Still processing | Check back - the pipeline is asynchronous |
| `failed` | The retry window has closed | Permanently unavailable; nothing will retry it |
| `purged` | Transcribed, then retention deleted it | **The `ai_summary` is the surviving record** - read that |
| `unreadable` | The stored object is missing or will not read | A storage-side problem, not a transcription one |

Reporting all five as "no transcript available" throws away the answer. Never collapse
`pending` or `unreadable` into "none", and never let `purged` read as a failure.

### `voice_recording_url_get` - ask-gated, non-revocable

Issues a presigned S3 GET for the recorded audio: `{ url, expires_in_seconds: 300 }`.
**Treat this as an ask-gated tool: get an explicit yes from the human before minting one,
every time.** The returned URL is an unauthenticated, shareable download of a real
conversation - anyone who receives it can stream or save the audio with no Hiveku login for
5 minutes, it is NOT revocable once issued, and pasting it into a ticket, chat, log line or
agent transcript republishes the recording to that whole surface. No consent, retention or
redaction check runs; two-party-consent obligations rest entirely with the caller. Prefer
the transcript whenever the question is about what was said.

Silent failures: the `id` is `voice_calls.id`, NOT `call_uuid` (the FreeSWITCH uuid 404s
forever); 404 `no_recording` is the normal answer for minutes after hangup while the
uploader lands the file, and permanent for never-recorded calls; 503 `misconfigured` when
the bucket env var is unset; **a 200 does NOT prove the object exists** - the presign is a
local signature with no S3 round trip, so a swept object still returns a happy URL that
404s when opened. The bucket has no CORS: the URL plays in an audio element or a direct
download, but a browser fetch/XHR against it is blocked.

### Handle transcripts as the most sensitive data on the account

The text is verbatim and unredacted: whatever was said aloud, including card numbers, dates
of birth and health details. Do not put a transcript in a report, a memory document, a
ticket body or a commit. Quote the minimum needed to answer, and prefer the AI summary when
the summary answers the question.

## Part 5: Attribution reads - a pointer

"Which campaign produced which calls", duration-vs-threshold quality, the platform-vs-Hiveku
reconciliation and its caveats block live in `references/conversion-send-back.md` (tools:
`marketing_call_attribution_breakdown`, `marketing_call_attribution_list`, both full-profile
key). The attribution VERDICT discipline - never sum platform and Hiveku numbers, rule out
measurement artifacts first - is owned by the hiveku-conversion-tracking skill. From this
file's rows, the bridge fields are `attribution_json`, `tracking_source`, `utm_campaign` and
`pool_session_id` on `voice_calls_list`, and `click_id_type` in the CSV export.

## Part 6: Crossing into helpdesk, and who gets the recap

**`helpdesk_ticket_transfer_to_voice({ id, target_user_id? })` ANNOTATES the ticket for a
voice transfer; the actual outbound dial is picked up by the voice server.** The tool
succeeding means the annotation was written, not that a phone rang - never report a
completed transfer from the tool's response; the dial happens out of band.

Call-originated tickets carry `channel: 'voice'`, so `helpdesk_ticket_list` with that
channel filter finds them (full-profile key).

**Call recaps** (the post-call email) are platform behavior worth knowing when someone asks
"why did I get / not get the recap":

- A recap fires for EVERY call, human or AI. Whether it is framed as an AI-handled call is
  decided by `disposition === 'ai_handled'` - the disposition is stamped in-band by the call
  router and is the same signal the call lists and the conversion upload use. Do not infer
  "the AI took it" from any other field.
- The recap is delivered to the rep who took the call plus admins, resolved through account
  MEMBERSHIP (the `account_memberships` table) - `users.account_id` is the user's HOME
  account, not their membership, and filtering on it silently drops every invited teammate.
  The same rule applies to any "notify the team" logic you build.
- The recap links to the dashboard call drawer, never to a presigned URL - a presigned URL
  in an email is a forwardable bearer token to a customer call. Follow the same rule in
  anything you draft.

## Part 7: Plays

### "Who called at 4:15?"

`voice_calls_list` bounded to the hour (`hours_back` sized to reach it, or the CSV export
with a tight `from`/`to` when the window is old), match on `started_at`, then
`voice_number_lookup` on the caller to name them - remembering the loose 7-digit match and
that `contact: null` may just be an archived contact. If the row's disposition is
`voicemail`, pull the message context from `voice_voicemails_list` with `q` on the digits
and `audio_urls: 'false'`. Answer with the time, the number, the resolved name (hedged if
the match is loose), the disposition and the duration.

### The missed-call sweep - and the text-back offer

`voice_calls_list({ disposition: 'missed' })` and again with `'abandoned'` for the period
(never `no_answer` - silent zero). Cross-reference the voicemail queue so a caller who
missed AND left a message is not double-counted as unrecovered. Report count, callers,
and time-of-day pattern (after-hours clusters mean a routing fix, not a staffing one -
`references/pbx-routing.md`). Then offer the recovery rail: the missed-call text-back
recipe in `references/voice-playbooks.md` (tenant autoresponder or the
`voiceMissedCallTrigger` workflow). Do not text anyone during the sweep itself.

### "She told us on the phone" - transcript by contact

`crm_calls_list({ contact_id, has_transcript: true })` (or by search) to find the calls,
newest first; pick the plausible call(s) by date and duration; then ONE
`voice_call_transcript_get` (or `marketing_call_transcript_get` for the `transcript_state`
verdict) on the specific call. Read the transcript, answer the specific question, quote the
minimum. If the state is `purged`, the AI summary is the surviving record - read that. If
`pending`, say the call is still processing rather than "no record exists".

## Part 8: Pitfalls

- Filtering on `no_answer`, `busy` or `failed` - never stored, silent zero, wrong report.
- Trusting `voice_call_get`'s `recording_url`, `recording_transcript` or `status`.
- An unbounded `voice_calls_export_csv` - up to 50,000 rows of PII inline, and exactly
  50,000 rows means silent truncation.
- A typo'd disposition filter on the export DROPS the filter and exports everything.
- Reading blank utm columns in the export as "direct traffic".
- Calling `voice_call_disposition_set` without `direction` on an outbound call, or with
  snake_case `started_at_iso` - the field is `startedAtIso`.
- Retrying the wrap-up's fast 404 as an error - it means "CDR not landed yet", wait.
- A voicemail sweep without `audio_urls: 'false'` - minted presigned audio for no reason.
- `voice_voicemail_mark_read` while diagnosing, or with the string `'true'` (422).
- Paging voicemail on a non-default sort - the cursor is silently ignored, page one forever.
- Reading the legacy `transcript` field - it can hand you a summary labelled a transcript.
- Mapping `marketing_call_transcript_get` across a result set.
- Collapsing the five `transcript_state` values into "no transcript".
- Passing `call_uuid` to `voice_recording_url_get` - it wants `voice_calls.id`.
- Trusting a 200 from `voice_recording_url_get` as proof the audio exists.
- Pasting a presigned URL anywhere, or quoting more transcript than the question needs.
- Reporting a completed voice transfer from `helpdesk_ticket_transfer_to_voice`'s response.
- Expecting this surface's reads/writes in `voice_audit_export_csv` - key-actor calls are
  skipped or never audited; say so when compliance asks.

## Part 9: Diagnosis quick reference

| Symptom | First move |
|---|---|
| "Who called at X?" | `voice_calls_list` bounded to the window, then `voice_number_lookup` |
| "How many missed calls?" | `voice_calls_list({ disposition: 'missed' })` plus `'abandoned'` |
| A disposition filter returns zero | Only the five stored values match; `no_answer`/`busy`/`failed` never do |
| "Where are my voicemails?" | `voice_voicemails_list` with `audio_urls: 'false'` |
| `has_audio` true, `audio_url` null | Presign could not be minted - audio exists, link unavailable |
| Voicemail search misses spoken words | `q` never reads the S3 transcript; `has_stored_transcript` rows need `voice_call_transcript_get` |
| No transcript on a fresh call | Normal - the pipeline is asynchronous; `pending` if the marketing pair reports state |
| 404 `no_transcript` persists on one extension's calls | Transcription is off for that extension - permanent, not pending |
| `transcript_unavailable` | Storage-side: bucket unset, access denied, or swept - indistinguishable; escalate with `pm_tasks_create` |
| "Transcript" reads like prose | It is the AI summary (`voice_call_get.recording_transcript`); use `voice_call_transcript_get` |
| Recording URL 404s minutes after a call | The uploader has not landed the file yet - wait, then retry once |
| Recording URL 404s AT S3 after a 200 | The object is gone (swept) - the presign never checked |
| Contact resolves wrong / not at all | Last-7-digit loose match; archived contacts never resolve |
| Export row count is exactly 50,000 | Silent truncation - narrow the window |
| Wrap-up 404 "call not found yet" | The CDR lands late; the handler already waited ~7.5s - try again shortly |
| "Why did the recap call it an AI call?" | `disposition === 'ai_handled'` decides the framing |
| "The rep never got the recap" | Membership resolves recipients; a home-account filter drops invited teammates |
| 402 `voice_not_enabled` mid-ladder | Plan refusal, not empty data - and `voice_calls_list` alone lacks the gate |
