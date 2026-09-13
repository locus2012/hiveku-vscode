# SMS Operations: Sending, Reading, Bulk, Templates, Compliance

Load this before you send a text, before you build any inbound-text automation, before you
answer a compliance question, and before you tell a user that anything about SMS is impossible.
This file replaces the old communications `sms.md`; registration (10DLC and toll-free) moved to
`tendlc-and-toll-free.md` in this skill - go there for anything about brands, campaigns,
verification, or "why do carriers filter us".

Every tool below resolves on this server today except the one marked INCOMING (declared by the
MCP server, not yet in this plugin's tool index; the row flips to LIVE at release). A name that
does not resolve on your key is a profile question first: check the key's profile, then the
hiveku-communications reachability ladder, then hand off with a precise dashboard step filed via
`pm_tasks_create` - never conclude the capability does not exist, and never invent a name to fill
a gap.

## Availability

| Tool | Status | One line |
|---|---|---|
| `voice_sms_send` | LIVE | Raw E.164 send; starts/reuses the thread |
| `voice_sms_send_to_contact` | LIVE | Send to a CRM contact; templates + scheduling |
| `voice_sms_thread_reply` | LIVE | Reply inside an existing conversation |
| `voice_sms_threads_list` | LIVE | The SMS inbox |
| `voice_sms_thread_messages_list` | LIVE | One thread's transcript; read-only by default |
| `voice_sms_opt_out_add` | LIVE | Manual do-not-text entry for a bare number |
| `voice_sms_templates_list`, `voice_sms_template_create`, `voice_sms_template_update`, `voice_sms_template_delete` | LIVE | Snippet CRUD |
| `voice_numbers_list` | LIVE | The DIDs you can send from |
| `voice_sms_registration_get` | LIVE | The "can this account send at all" verdict (see tendlc file) |
| `voice_sms_bulk_send` | LIVE | Up to 200 real texts in one call. Ask-gated |
| `voice_sms_scheduled_list` | LIVE | Lists pending scheduled sends |
| `voice_sms_scheduled_cancel` | LIVE | Cancels one scheduled send (hard delete) |
| `voice_sms_opt_outs_list` | INCOMING | Reads the do-not-text list (source auto vs manual) |

Profile note: `voice_*` and `workflow_*` names resolve under this skill's key; the `crm_*`
(DNC), `helpdesk_*` and `survey_*` tools referenced below resolve only under a broader profile
such as `full`. An older copy of this document said no tool lists or cancels a scheduled send
and that bulk was dashboard-only; both claims are retired - the tools above cover them.

---

## Part 1: The rails, and which one to pick

There are four ways a text leaves this platform. Pick by job, not by habit:

| The job | Rail |
|---|---|
| One specific message to one person, now | `voice_sms_send_to_contact` (CRM contact) or `voice_sms_send` (raw E.164) |
| Reply in an existing conversation | `voice_sms_thread_reply` |
| The same message to a list (up to 200) | `voice_sms_bulk_send` - preview and count-approve first |
| Text automatically on an event (form, missed call, schedule, inbound text) | The workflow `sms` node |
| A survey or review ask by text | `survey_send({ channel: 'sms' })`, or the `surveySend` / `reviewRequest` / `reviewFunnelSend` nodes - these mint tokens, apply suppression, and honor quiet hours; never hand-roll them with an `sms` node |

**Two send rails run underneath, and they enforce different things.** The automation rail
(`dispatchAccountSms`: the `sms` node, the dashboard composer, survey/review senders, the
missed-call autoresponder, invoice texter, helpdesk agent) enforces the eight gates below,
including the `sms_not_enabled` registration check and the automation volume caps. The direct
tools call the send funnel directly: they enforce plan gating (402 `voice_not_enabled`), DID
ownership, the opt-out table, and the reputation governor - but (for the SINGLE sends; the bulk tool is the exception below) **NO 10DLC registration check
and NO automation caps**. Unregistered US A2P traffic from a local DID is accepted by the
direct tools and then filtered by carriers while your stored row still reads `sent`.

### The automation rail's gates, in order

The `sms` node surfaces the first tripped gate's reason verbatim in `step_states`; knowing the
order turns "the SMS node failed" into a fix. The first gate that trips returns and nothing is
sent.

1. **Recipient normalizes to E.164** (10 digits gets `+1`; 11 starting with 1 gets `+`; a
   leading `+` keeps its digits) - else `invalid_to`.
2. **Body non-empty after trim** - else `empty_body`. This is what an unresolved `{{template}}`
   produces: an unresolved placeholder collapses to an empty string, so a populated-looking
   config that errors "empty body" or "no recipient" means a template resolved to nothing
   (`workflow_run_get` shows the node's resolved `input`).
3. **Account operational** - else `account_suspended`.
4. **The account can send SMS at all** - else `sms_not_enabled`. The rule is an OR: a VERIFIED
   brand with an ACTIVE, provisioned campaign, OR at least one verified toll-free DID. When
   this trips, `voice_sms_registration_get` is the verdict tool (tendlc file).
5. **Not opted out** - else `opted_out` (Part 6).
6. **Automation volume caps** (below).
7. **A sending number resolves** - else `no_sending_number`; an explicit unverified toll-free
   `from` is refused loudly as `toll_free_unverified`.
8. **Carrier send** - failure returns `send_failed` with the carrier's message.

### The caps, and the governor

**Automation caps** (workflow nodes, agents, crons - any send with no user attached): **100
per hour per account, 400 per day per account, 6 per hour to a single recipient.** Failed
sends count (attempts are read from message rows), and the counting query fails open so a DB
blip never silences legitimate automation. A human in the dashboard composer neither consumes
nor is blocked by this budget. **Do not split a blast across hours, workflows or the direct
tools to dodge the caps** - carrier filtering does not care which rail the volume rode in on,
and a filtered campaign is far more expensive than a capped one. Per-account overrides exist
in account settings and are not writable from this surface.

**The reputation governor** sits inside the shared send funnel and applies to EVERY rail: a
kill switch (`sms_sending_paused`), a carrier-prohibited-content screen, a per-plan UTC DAILY
cap (100 on free and trial, 500 hosting, 5000 premium, 10000 business, 50000 enterprise, 2000
on any unrecognized plan unless `daily_sms_cap_override` raises it), and a per-minute velocity
cap. A governor refusal surfaces as a 502 `send_failed` carrying a human-readable reason: it
is a POLICY refusal and an immediate retry will not help. An hourly abuse monitor can also
auto-pause an account on opt-out or carrier-failure spikes - a sudden universal
`sms_sending_paused` is that, not an outage.

**There are NO quiet hours on the direct tools or the `sms` node.** A `scheduledTrigger` at
03:00 texts at 03:00, and `scheduled_for` is an absolute UTC instant that never reads the
contact's timezone. Quiet hours (09:00-20:00 local, defaulting to US Central) live one layer
up, in the survey/review/referral senders only - which report a throttled or quiet-hours
contact as **skipped, not failed**, and reschedule rather than send. For marketing-shaped
automation, put the time discipline in the trigger: pin the cron to a business hour in the
ACCOUNT's timezone, or gate an event-driven text through a `conditional` on the current hour.
`survey_send` called at 22:00 reschedules - report "scheduled", never "sent".

### Workflow-node facts that keep biting

Kept from the old manual because they still decide outcomes; the automation skill's node rail
covers the rest.

- The node's keys are `to`, `body`, `from` (optional; see sender resolution in Part 2). On a
  form workflow, `{{trigger.form_fields}}` renders every non-empty field as `Label: value`
  lines. On success the node adds `sms.message_id` / `sms.thread_id` - never report a text as
  sent without a `message_id`.
- Prefer `{{trigger.body}}` / `{{<nodeId>.body}}` forms. `{{data.from}}` does NOT resolve
  downstream of `smsReceivedTrigger` (the `data` alias points at a `payload` key the SMS
  trigger does not have).
- **Retries can double-send.** Node defaults are 30s timeout, `maxAttempts: 2`; the rail has
  no idempotency key across attempts, so a carrier-delivered-but-timed-out response retries
  into a second text. If a duplicate is unacceptable, set
  `data.executionConfig = { retryPolicy: { maxAttempts: 1 } }`. Do not set `onError:
  'continue'` on a workflow whose whole purpose is the text.
- Inbound triggering: the graph node IS the subscription - do not call
  `workflow_trigger_create` for SMS (`workflow_event_trigger_types_list` is the discovery
  tool). `keyword_filter` is a case-insensitive SUBSTRING match (`stop` matches "nonstop";
  pick distinctive words like `QUOTE`, `BOOK`); `number_filter` compares last ten digits and
  FAILS CLOSED when the inbound DID cannot be resolved; pass both as strings. Inbound
  trigger fan-out is throttled at 30/account/min and 6/sender/min - "the ticket exists but no
  workflow ran" is that throttle, not a broken workflow. A paused workflow still matches and
  records a replayable stopped run; a disabled one does not.

---

## Part 2: Sending

All direct sends are REAL texts to a real handset within seconds, billed per segment, with no
draft state, no recall, and **no idempotency key anywhere: two identical calls are two
texts.** Send only wording a human has approved. After ANY ambiguous outcome (timeout, 502,
dropped connection), read the thread with `voice_sms_thread_messages_list` BEFORE any second
call - "run it again to make sure" is a second text on the customer's phone.

### `voice_sms_send({ tenant_e164, peer_e164, body, media_urls? })`

Starts or reuses the thread between your DID and the peer, writes the outbound row, and
dispatches. Since the 2026-08-29 program it also **mirrors to the CRM timeline and fires the
outbound webhook at carrier accept** (the fan-out event is named `sms.delivered` but fires at
carrier ACCEPT - a naming lie to plan around). Traps:

- **Returns `{ thread }` ONLY** - no message id, no carrier id - so the response cannot
  confirm the outcome; read it back on the returned thread id.
- Refusals: 402 `voice_not_enabled`; 403 `not_your_number` (tenant_e164 not an active DID
  here); 409 `opted_out` (Part 6); 422 `invalid_body`.
- **A 200 means the carrier gateway ACCEPTED the message**, not that it arrived: the row is
  stamped `sent` and only the later delivery receipt flips it.
- **A 502 `send_failed` is NOT a no-op** - the thread and a `failed` message row are already
  committed; blind retries leave a trail of failed rows and can double-send if the first
  attempt actually reached the carrier.
- No registration check (Part 1); only toll-free senders are gated, and an unverified
  toll-free DID dies as a 502 inside the funnel.
- An API key has no builder profile, so the send shows no sender and writes NO voice audit
  row - true of every tool in this file.

### `voice_sms_send_to_contact({ contact_id, body, ... })`

Sends to a CRM contact - **the recipient comes from `crm_contacts.phone` ONLY, never from
your input.** Extra refusals and traps, all from its registered description:

- 404 `contact_not_found`; 409 `no_contact_phone`; and **403 `opted_out` - a 403 HERE where
  the thread routes return 409 for the same condition, so key on the error string, not the
  status.** Consent is checked ONLY against the opt-out table, never `lifecycle_stage` or a
  CRM column (the CRM DNC route writes into the same opt-out table, which is why one check
  suffices).
- **`from_e164` is how a rep's direct line sends under a key.** The session send path
  resolves the signed-in rep's assigned caller-ID number; an API key has no person behind it,
  so the Olympus path uses the account pick (purpose `main`, then oldest active DID, local
  plus VERIFIED toll-free only, fails closed). To text as Rebecca's line, pass her DID as
  `from_e164` explicitly. It is ownership-checked but NOT toll-free-verification-checked - an
  unverified toll-free `from_e164` clears the 403 and dies as a 502. Omit it when in doubt.
- Phone parsing: `214-555-1212 x5` parses to 11 digits not starting with 1 and refuses as
  `no_contact_phone`; a stored value already starting `+` passes through with NO length
  check.
- Template trap: merge vars render ONLY when your body exactly equals the stored template
  body (trimmed); any edited body still holding `{contact_first_name}` arrives as literal
  braces, and `{sender_first_name}` renders EMPTY under an API key.
- **Raw-body-on-timeline trap: the `crm_activities` mirror and the webhook payload store your
  RAW input body, not the rendered text** - a merge-var send shows the un-rendered template on
  the CRM timeline while the customer got the rendered version. Reconcile against the message
  row, not the activity, when wording matters.
- Success returns `{ message_id, thread_id, from_e164, to_e164 }` - no carrier id, no
  delivery status. The same accepted-not-delivered and 502-wrote-the-row rules apply.
- The scheduled branch is in Part 4.

### `voice_sms_thread_reply({ thread_id, body, media_urls? })`

Appends to an existing conversation. **Both the recipient and the sending DID are read off the
STORED thread - `tenant_e164` is frozen at thread creation, and that is CORRECT**: the
customer has that number saved and replies to it; repointing an existing conversation at a
new rep line would strand their replies. Only NEW conversations pick up a different sender.
Say this out loud when someone ships a caller-ID change and "old threads still use the old
number" - it is the first thing that looks broken and is not.

- Returns `{ message }` with an OPTIMISTIC `delivery_status` of `'sent'` (accepted, never
  delivered).
- 409 `opted_out` is re-checked on EVERY reply, even deep inside an open conversation - a
  STOP still applies in the thread it was sent in.
- Unlike `voice_sms_send`, it does NOT re-verify the DID is still yours or active: a reply on
  a released number is attempted and fails at the carrier instead of being refused here.
- `last_message_at` bumps BEFORE dispatch, so even a failed send jumps the thread to the top
  of the inbox.
- It mirrors to the CRM timeline and fires the webhook (closed 2026-08-27; older copies of
  this document said a thread reply was invisible on the contact timeline - retired).

### A contact owns N threads - one per sending DID

The thread key is (account, your DID, their number). `voice_sms_send_to_contact` picks the
main/rep DID while the missed-call text-back sends from the DID that was CALLED, so the same
person routinely holds two or more threads. **Any "first thread" pick hides half the
conversation.** When reading a contact's SMS history, resolve ALL their threads (by
`contact_id` and by phone), or use `crm_list_activities({ type: 'sms', contact_id })` /
`crm_contact_touch_history` for the merged view (the read-side `type` filter accepts `sms`
even though the description does not list it; `crm_create_activity` REJECTS `type: 'sms'` -
the write side enforces the whitelist).

### MMS

`media_urls` promotes a send to MMS on all three tools: max 10 public HTTPS URLs, fetched by
the carrier gateway itself - a private, signed or expiring URL fails at the carrier, not
here. Body may be empty only when media is present (a caption-less MMS ships a single-space
placeholder and stores an empty body). **The 600KB pass-through cap:** static images
(jpeg/png/webp) are transcoded and can be up to ~5MB, but animated GIF, video, audio and PDF
pass through UNRESIZED - carriers cap MMS around 600KB and STRIP oversize media while STILL
DELIVERING the text. The sender sees `delivered`; the recipient sees a blank message. That is
why photos work and big GIFs arrive empty. Diagnostic for "MMS delivered but blank": check
the media byte size (`curl -sIL` the URL) before suspecting auth or format.

---

## Part 3: Reading

### `voice_sms_threads_list` - the inbox

Paged, newest first by `last_message_at`; each thread carries `tenant_e164`, `peer_e164`,
`unread_count`, `archived`, `contact_id`, and a `preview`. The one tool in the SMS group that
changes nothing. Traps from its description: **a 402 `voice_not_enabled` is a plan refusal,
NOT an empty inbox**; `limit` clamps to 1-100 and a non-numeric limit is not coerced; a bad
or foreign `cursor` is SILENTLY IGNORED and replays page one, so a pager feeding a stale
cursor loops forever; `unread_only` / `archived` compare against the literal strings
`'true'` / `'false'` and any other value applies NO filter; the `q` search scans at most 2000
message rows (`search_truncated: true` = partial, not exhaustive) and returns an EMPTY list
when nothing matches rather than falling back to unfiltered; `preview.body` is cut to 200
characters. Every row is customer PII.

### `voice_sms_thread_messages_list` - the transcript, now read-only by default

One thread's messages, newest first, each carrying `direction`, `body`, `media_urls`,
`delivery_status`, `error_message`, `sent_at` and the carrier message id.

**The default flipped in the 2026-08-29 program: this tool is READ-ONLY BY DEFAULT.** The
thread's unread badge clears ONLY on an explicit `mark_read: 'true'` (the exact string). Pass
it only when you are surfacing the conversation to a human who is actually reading it - never
on a poll, a background sync, or a pagination fetch. An older copy of this document (and an
older registered description) said the reset was the default and taught `mark_read: 'false'`
as the escape hatch; if the description you fetch still says that, it predates the flip -
trust the explicit-opt-in behavior and pass `'true'` only deliberately.

Other traps: the cursor must be a message id from inside THIS thread and an unresolvable one
is a HARD 400 `invalid_cursor` (deliberately unlike the threads list); `limit` clamps 1-200; a
foreign thread id is a plain 404, indistinguishable from a deleted thread; the output is the
full conversation plus MMS URLs - customer PII.

### `delivery_status` lies three ways

Vocabulary: `queued | scheduled | sent | delivered | failed` (every carrier failure collapses
to `failed`; `undelivered` is never written), and null means never reconciled - unknown, NOT
failed. The three lies:

1. **`sent` != `delivered`.** `sent` means the gateway accepted it; a carrier-filtered
   message sits at `sent` forever. Only `delivered` is delivery.
2. **The CRM activity mirror carries NO delivery status at all.** Absent means "unknown",
   never "sent" - do not report delivery from the contact timeline.
3. **`error_message` is never cleared** (the receipt handler coalesces it), so a delivered
   row can still carry old carrier error text. Only read `error_message` when
   `delivery_status` is `failed`.

---

## Part 4: Bulk and scheduled

### `voice_sms_bulk_send` - up to 200 real texts in one call

The blast tool, ask-gated for obvious reasons. Non-negotiable discipline:

- **Audience preview and count approval FIRST.** Resolve the recipient list, show the human
  the exact count and a sample, get an explicit yes on THAT count, then send. Never derive an
  audience and fire in one motion.
- Hard cap 200 recipients per call. Per-recipient opt-out rows are SKIPPED per row, not
  refused for the batch; template bodies render per recipient.
- **A governor refusal mid-batch lands the remainder in `failed[]` - NEVER blindly re-run
  the call.** The messages before the refusal were REAL sends; re-running the batch
  double-texts everyone who succeeded. Read the per-row results, and re-send only the failed
  remainder, deliberately, after understanding why the governor tripped (daily cap and
  velocity are policy, not transient).
- `scheduled_for` defers the whole batch: an absolute UTC instant more than 30 seconds ahead
  (nearer or past sends NOW). **No quiet hours** - a batch scheduled at 03:00 UTC lands at
  03:00 UTC.
- Unlike the single sends, bulk DOES enforce 10DLC readiness up front: `409 sms_not_enabled`
  (no VERIFIED brand + ACTIVE campaign, and no verified toll-free sender) refuses the whole
  batch BEFORE any row is written. Past that gate the governor's plan-daily cap still counts
  every message in the batch.

### Scheduled sends: `scheduled_for` on `voice_sms_send_to_contact` and bulk

The scheduled branch writes a `delivery_status: 'scheduled'` row and returns without calling
the carrier; a cron dispatches later (50 rows per tick platform-wide, opt-out re-checked at
dispatch, the sending DID read off the thread WITHOUT re-verifying it is still active). Known
gaps, from the registered description: the scheduled path writes NO `crm_activities` row,
fires NO webhook, and never bumps template usage - a scheduled send is invisible on the
contact timeline until it dispatches. And it can land at 3am local: absolute UTC, no timezone
awareness. Say both to the user before scheduling.

### `voice_sms_scheduled_list`

Lists pending scheduled messages (filterable by thread, from, to; cursored). **The definition
of "scheduled" is BOTH conditions: `delivery_status === 'scheduled'` AND a `scheduled_for`
value - because `scheduled_for` is never cleared on dispatch.** A row with `scheduled_for`
set and status `sent` already went out; counting on `scheduled_for` alone marks every
formerly-scheduled message as pending forever.

### `voice_sms_scheduled_cancel`

Cancels ONE scheduled send by message id. **It is a HARD DELETE of the row** - no tombstone,
no history - and it refuses anything due within 5 seconds, because the dispatch cron may
already have selected the row; the delete re-asserts both scheduled conditions so a message
that slipped into dispatch cannot be "cancelled" after it went. A 409 `not_scheduled` means
the row fails the two-condition test - it already sent, or was never scheduled - so read the
row before telling the user it was stopped. Cancel-then-reschedule is the edit path; there is
no in-place update of a scheduled message.

The workflow-side substitutes remain valid and more inspectable: a `delay` node or a
`scheduledTrigger`, which you can list and disable.

---

## Part 5: Templates

Four tools over reusable snippets that reach nobody until a send route renders them. The
traps, each from the registered descriptions:

- **`voice_sms_templates_list`** - ORDERING TRAP: sort is `last_used_at DESC` and Postgres
  puts NULLS FIRST on DESC, so every NEVER-USED template leads the list ahead of the one sent
  an hour ago; do not read position 0 as "most used". COUNTER TRAP: `usage_count` /
  `last_used_at` move only when an IMMEDIATE send carried `template_id` and cleared the
  carrier - scheduled sends never bump, failed sends never bump, and an edited-body send
  still bumps (keyed on id alone). The counters both undercount and mislead. No filters, no
  pagination: hundreds of templates return in one payload. Merge vars substitute at send time
  only, matched lowercase-with-underscores only (`{Contact_First_Name}` and `{firstName}`
  never match), and an unknown placeholder is left INTACT - which is how literal braces reach
  a handset.
- **`voice_sms_template_create`** - SHORTCUT TRAP: the shortcut regex ends in `*`, so an
  EMPTY STRING passes validation and is stored as a real value; the unique index is
  (account, shortcut), so the SECOND template created with `''` is a 409 `shortcut_taken`.
  OMIT the field rather than passing `''` (omitted stores NULL, which never collides). No
  dedupe on name or body: calling twice creates two identical templates, and there is no
  merge tool. Nothing validates placeholders - a typo like `{firstName}` is accepted silently
  and later texts literal braces to a customer.
- **`voice_sms_template_update`** - SILENT NO-OP: an empty object answers 200 having changed
  nothing but `updated_at`, and unknown keys are stripped without error. Confirm an edit by
  reading the returned row, never the status code. Pass `category`/`shortcut` as null to
  CLEAR them; `''` does not clear a shortcut, it stores a colliding empty value. It returns
  the FULL row where list/create return an eight-field projection - do not assume the shapes
  match. Editing a body cannot reach anything already sent OR already scheduled: every
  message row stored its own rendered text at creation.
- **`voice_sms_template_delete`** - IRREVERSIBLE: no soft delete, no history, no undo. **NO
  DEPENDENCY GUARD**: nothing checks references, `template_id` on messages has no FK, so
  historical rows point at a dead id and usage reports joining on it silently go blank; a
  `/shortcut` a human types every day just stops expanding, with no warning to them. Read the
  body with the list tool FIRST. It does not unsend anything - sent and scheduled messages
  keep their stored text. A 200 proves the row is absent, not that this call removed it.

---

## Part 6: Inbound, STOP, and the two suppression layers

### The inbound pipeline, end to end

1. The carrier delivers the inbound webhook to the voice server.
2. The ingester persists thread + message, matches a CRM contact by phone, and emits a
   pointer event (never the body) for realtime UIs.
3. **Compliance keywords are detected and acted on HERE**, before the builder is involved.
4. If and only if the message is not a bare compliance keyword, the ingester notifies the
   builder.
5. The builder route does three independent things: opens or threads a helpdesk ticket, fires
   inbound-SMS workflow triggers, and sends the bell plus mobile push.

Step 4 is the gate: anything suppressed at step 3 never reaches workflows, helpdesk or
notifications - though the message row IS persisted and visible in
`voice_sms_thread_messages_list`. The insert is idempotent on the carrier's message id, so a
re-delivery never re-fires the trigger.

### The keyword sets, matched on the FIRST WORD, case-insensitive

- **Opt-out:** `stop`, `unsubscribe`, `cancel`, `end`, `quit`, `stopall`
- **Opt-in:** `start`, `unstop`, `yes`

A first-word opt-out writes the opt-out row; a first-word opt-in DELETES it. Every outbound
path consults that table and refuses an opted-out peer (the automation rail as `opted_out`;
the thread tools as 409; `voice_sms_send_to_contact` as 403). The carrier layer independently
blocks and auto-confirms - double protection, verified live.

### The suppression rule, and what follows

The builder is NOT notified when a compliance keyword was detected AND the keyword is not
`yes` AND **the entire message body is exactly ONE word.** No bell, no push, no ticket, and
**no `smsReceivedTrigger` fire.**

- **A workflow triggered on "STOP" will never fire. It is not partially working; it is
  dead.** The platform already registered the opt-out, already refuses future sends, and the
  carrier already confirmed. Offer the multi-word variant ("STOP texting me" is a human
  talking and DOES notify) if the user wants to catch angry unsubscribes phrased as sentences.
- **`cancel`, `end` and `quit` are OPT-OUTS.** A customer replying a bare "CANCEL" to an
  appointment reminder is opted out of ALL future SMS, and your cancellation workflow never
  sees it. A flow that needs a text-back cancellation must instruct a word not on the list,
  in the outbound message itself.
- **`yes` is deliberately carved out** - it is the word the chat-to-SMS handoff asks for. A
  bare "YES" notifies, fires triggers, and registers as an opt-in.
- You cannot test suppression with `test_mode` - it happens upstream of the workflow engine.
  A real STOP from a real handset writes a real opt-out row; do it deliberately or not at
  all (`start` reverses it).
- **Expect prior-owner baggage on a freshly purchased DID.** STOPs arriving on a number that
  has never sent anything are aimed at its PREVIOUS owner - recycled DIDs arrive with the
  prior owner's threads on strangers' phones. The opt-outs they write are correct; do not
  treat them as an incident. (Bare-keyword inbound no longer pushes to the team for exactly
  this reason.)

### `voice_sms_opt_out_add` - the manual entry, and its semantics

For honouring a stop request made by phone, email or in person, from a number that may not be
a contact. Adds one E.164 to the account's do-not-text list (source `manual`); every outbound
path then refuses it. From its registered description: **SILENT NO-OP - if a row already
exists, NOTHING is written and the answer is still 200 with `already_present: true`; your
note is discarded and the stored reason and date are untouched.** It can never correct or
re-date an existing opt-out. **NOT PERMANENT**: a later inbound whose first word is `start`,
`unstop` or `yes` deletes the row - including an unrelated "yes please". NARROW: SMS only,
this account only, the literal e164 string only - it touches no email suppression, no
sequence suppression, no CRM lifecycle. Two concurrent adds of the same number can collide as
a 500 rather than a clean `already_present`. For a known CRM contact prefer `crm_set_dnc`,
which does all channels in one transaction.

### `voice_sms_opt_outs_list` - reading the list

The read-only view of the same table: every number the outbound paths refuse, with `e164`,
`source`, `reason` and `opted_out_at`, newest first; `page` / `limit` (1-200), and filters
`source` (`auto` | `manual`) and `e164` (exact match, full E.164 - the phone-format trap below
applies to what you pass in). Read it for "is she opted out?" before drafting a text, for the
count behind a bulk audience, and to explain a 403 / 409 refusal by the row that caused it.

`source` is the load-bearing column. **`auto` is the recipient's own STOP** (or `cancel`, `end`,
`quit`, `unsubscribe`, `stopall`), written by the inbound pipeline - removable by NOBODY on our
side; only their own START / UNSTOP / YES clears it. **`manual` was added by an operator** via
`voice_sms_opt_out_add` or `crm_set_dnc`, and `reason` is whatever they typed. The
sending-reputation rate counts `auto` rows only, so a list that is mostly `manual` is a policy
choice, not a reputation problem. A read has no compliance problem - it removes nothing and
re-opens nothing - and there is still no removal tool, by design (next section). PII: the
numbers of people who asked not to be contacted; a count is reportable, the rows are not. 402
`voice_not_enabled` without the add-on.

### Re-subscribe: the removal tool is deliberately absent

**There is no tool that removes an opt-out row by number, and that absence is a compliance
feature, not a gap - do not work around it.** Re-subscription is the customer's OWN texted
START (or the dashboard, where a human owns the decision). Deleting an opt-out to force a
send is a TCPA decision no agent makes. The one tooled path: for a KNOWN CRM contact under a
full-profile key, `crm_remove_dnc({ contact_id, reason })` soft-removes suppression WITH an
audit note - use it sparingly, it does not reset `lifecycle_stage` or `lead_status`, and
undoing a customer's own STOP without their re-consent is a compliance problem in the other
direction. Most requests to undo a DNC are mistakes.

### The two layers, and the phone-format trap

A texted STOP writes a NUMBER-scoped opt-out without touching the CRM contact; `crm_set_dnc`
writes CRM suppression (and the voice opt-out) for a CONTACT. Audit both:
`crm_get_dnc_status({ contact_id })` for the contact, remembering that a bare STOP from a
number the CRM never matched leaves no CRM trace at all.

**The phone-format trap - verify before you report anyone as suppressed.** The send-time
check is an exact string lookup on the E.164-normalized number, but `crm_set_dnc` writes
`contact.phone` AS STORED (trimmed, not normalized), and contacts updated through the update
path keep whatever format was pasted in. So `crm_set_dnc` on a contact stored as
`(555) 123-4567` writes an opt-out row keyed on a string the send path will never look up -
**and `crm_get_dnc_status` reads with the same unnormalized key, so it reports
`sms_suppressed: true` for a row that blocks nothing.** Practical rule: before relying on
`crm_set_dnc` for SMS, read the contact and confirm `phone` is `+1XXXXXXXXXX`; fix it with
`crm_update_contact` first if not. A live mismatch is a compliance incident, not a curiosity.

There is no DNC workflow node; the rail's own `opted_out` refusal is the in-workflow gate.

---

## Part 7: The helpdesk projection

Inbound texts are also projected into helpdesk as tickets (`channel: 'sms'`, subject "SMS
from <name or number>", `source_meta` carrying `sms_thread_id`, `sms_did` and `peer_e164` -
your reply address). Conditions: gated on the account actually using helpdesk
(`helpdesk_ticket_list({ channel: 'sms' })` empty on an account you know receives texts means
the helpdesk flag, not your query - read the thread directly); best-effort (a failed ingest
logs rather than raises); new messages thread into an `open`/`pending` ticket while a
resolved/closed one gets a fresh ticket; auto-acknowledge is deliberately skipped for SMS.

Read with `helpdesk_ticket_list` -> `helpdesk_ticket_get` / `helpdesk_ticket_messages`
(inbound rows carry the voice message and thread ids for correlation), or
`helpdesk_ticket_list_for_contact` for one person. `helpdesk_macros_list` +
`helpdesk_macros_render` for reply text so you never ship raw placeholders.

### `helpdesk_ticket_send_reply` DELIVERS NOTHING for SMS tickets

The worst verified silent failure on this surface. The reply tool writes the outbound message
row, stamps first-response, returns success - and has **no delivery branch for
`channel === 'sms'`**. The ticket looks handled; the customer is still waiting; nothing
errors. The `helpdeskSendReply` workflow node has the same hole.

**To actually text the customer back:** `voice_sms_thread_reply` on the ticket's
`source_meta.sms_thread_id`, THEN log the reply on the ticket (the thread reply writes no
ticket row). In an automation, the idiomatic pair is the `sms` node (delivers) plus the
helpdesk reply (records). Do only the second half and you have written a note to yourself.

The one exception: a CHAT ticket linked to an SMS thread with `sms_link_confirmed: true` (the
customer replied YES) does mirror replies out as texts - to the thread's peer number, never
`contact.phone`, and it consumes the automation volume budget. And `helpdesk_ticket_create`
accepts `channel: 'sms'` but creates a label with no underlying thread - only do it
deliberately. An email ticket can never answer via SMS; the channels are structurally
separate.

---

## Part 8: Diagnosis quick reference

| Symptom | Likely cause |
|---|---|
| Workflow never fires on "STOP" | Bare compliance keywords never reach the builder. Working as designed |
| Customer texted "CANCEL", nothing happened, now they get no texts | `cancel` is an opt-out keyword. They are suppressed |
| Bare "YES" fires but bare "START" does not | `yes` is carved out of suppression; `start` is not |
| Keyword filter matches too much | Substring match. `stop` matches "nonstop" |
| Workflow scoped to one number never fires | `number_filter` fails closed when the inbound DID cannot be resolved |
| Trigger ignores a filter entirely | The filter was saved as a non-string type and read as absent |
| Nothing fires and there is no run at all | Workflow disabled, or the graph has no edges (`workflow_validate`) |
| Ticket exists but no workflow ran | Inbound trigger fan-out throttled (30/account/min, 6/sender/min). Ticket and bell are ungated |
| No ticket for an inbound text | Helpdesk not enabled, or best-effort ingest failed. Read the thread directly (Part 3) |
| Reply recorded but customer got nothing | `helpdesk_ticket_send_reply` does not deliver for SMS. Part 7 |
| Node errors "no recipient"/"empty body" and config looks fine | A template resolved to empty. Read `input` in `step_states` |
| Sends stop partway through a batch | Automation caps (100/hr, 400/day, 6/hr per recipient), or the governor's plan daily cap |
| Bulk call answered with a populated `failed[]` tail | Governor tripped mid-batch. The head SENT - re-send only the tail, never the batch |
| One customer stops receiving, others fine | Per-recipient cap, or an opt-out row for that number |
| Every automation send returns `sms_not_enabled` | `voice_sms_registration_get`: read `blocking_reason` (tendlc file) |
| Direct send 502 with a policy-sounding reason | The reputation governor. Retrying will not help |
| ALL sends suddenly 502 `sms_sending_paused` | The abuse monitor auto-paused the account (opt-out or failure spike). A human unpauses in the dashboard |
| Direct send 200 but the customer got nothing | `sent` = accepted. Carriers filter unregistered or unpropagated traffic silently. Read the row, then the tendlc file |
| `delivery_status` is null | Never reconciled - unknown, NOT failed |
| A delivered row carries an old error message | `error_message` is never cleared. Only read it on `failed` |
| Explicit `from` rejected or 502s as unverified toll-free | That DID has not passed toll-free verification |
| Customer got the same text twice | A timeout retry (`maxAttempts: 1` prevents), an operator re-run, or a blindly re-run bulk batch. Read the thread before ANY retry |
| Text arrived at 3am | No quiet hours anywhere on this surface; `scheduled_for` is absolute UTC |
| Review or survey reports skipped | Throttle or quiet hours. Skipped is not failed |
| `sms_suppressed: true` but texts still land | Opt-out row keyed on a non-E.164 phone. Compliance incident (Part 6) |
| A scheduled send never showed on the timeline | The scheduled branch writes no activity row until dispatch. Part 4 |
| Scheduled list shows a message that already sent | Someone filtered on `scheduled_for` alone. Both conditions define scheduled |
| "Cancelled" a scheduled send but it arrived | It was inside the 5-second floor or already dispatched. The 409 was telling you |
| Unread badge cleared without a human opening the thread | Something passed `mark_read: 'true'` on a poll. The default no longer clears it |
| MMS "delivered" but recipient sees a blank | Media over the ~600KB pass-through cap was stripped in transit. Check byte size first |
| Outbound works, inbound never arrives | Deaf messaging profile (no inbound webhook) on a campaign approved before 2026-08-05; the platform self-heals on next touch - count inbound rows to confirm |
| STOPs arriving on a brand-new number that never sent | Prior-owner baggage on a recycled DID. Not an incident |
| The rep's texts go out as the main company number | New threads use the rep's line only when resolvable; existing threads are frozen to their DID (correct); under a key, pass `from_e164` |

### The order to work a "text never sent" report

1. Direct-tool send: `voice_sms_thread_messages_list` on the thread - `delivery_status` and
   `error_message` (on failed) carry the answer.
2. Workflow: `workflow_runs_recent({ status: 'failed' })` - account-wide, so you need not
   know which workflow tripped.
3. `workflow_run_get` and read the `sms` node's `error` in `step_states` - the rail's reason
   verbatim, mapped against Part 1's gate list.
4. `workflow_run_logs` for template misses and retry attempts.
5. A node skipped as `already_sent` means the send-once guard fired: this run was a replay.
6. A node absent from `step_states` was never reached: `workflow_validate`.
7. Everything green and still nothing on the handset: registration or propagation - the
   tendlc file's diagnosis table takes over.

Related references: `tendlc-and-toll-free.md` (registration, filtering, delivery proof),
`caller-id-and-reputation.md` (which number sends, spam labels), `numbers-and-e911.md`
(buying and retiring the DIDs), `voice-playbooks.md` (the end-to-end recipes).
