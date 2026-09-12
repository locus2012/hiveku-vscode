---
name: hiveku-communications
description: "Operating manual for the account's EMAIL and shared-inbox surface. People say: \"did we get a reply?\", \"answer that customer email\", \"the mailbox stopped syncing\", \"No active Gmail connection found\", \"connect Gmail or Outlook\", \"why is our email not arriving?\", \"cancel the scheduled campaign\". Use for ANY mailbox or email-infrastructure work - reading the shared team inbox, finding and answering a customer email, replying inside an existing thread, repairing a Gmail/Outlook connection, the gmail_* family, campaigns (finding, creating, cancelling a scheduled send), transactional templates, drip sequences, audiences, sending domains, suppression and deliverability. Phone calls, voicemail, recordings, transcripts, TEXT MESSAGING (SMS/MMS), phone numbers, IVRs and call routing moved to the hiveku-phone-agency skill - load that one for anything a phone does, including \"can you text her back?\" and \"did we miss any calls?\". ALSO load before risky email sends - \"email the whole list\", \"just send it, skip the dry run\" - the refusal and the safe alternative live here."
---

# Hiveku Communications Operating System

Communications is the widest department on the account and the least evenly tooled. Some of it
is one MCP call. Some is only reachable by building a small workflow. Some is dashboard-only
and your job is to hand the user a precise next step. Getting that judgement right is most of
the skill, so the ladder comes first.

## The reachability ladder (read before you say "there is no tool for that")

**A missing tool name does NOT mean a missing capability.** An operator once searched for
`sms_send`, found nothing, and reported that Hiveku could not send texts. Two durable lessons.
**Prefixes decide reachability**: the SMS tools are `voice_sms_*`, the survey sender is
`survey_send` - tools are named after the contact, ticket, survey or number, almost never after
the channel. And **negative-existence claims expire**: the registry grew by hundreds of tools
on 2026-08-27, and "there is no X tool" statements written before that date went stale that
day. Verify against the live catalog before repeating one, including the ones in this file.

| Rung | Surface | How you reach it | How you confirm it exists |
|---|---|---|---|
| 1 | A direct MCP tool | Call it | The name resolves in YOUR catalog |
| 2 | A workflow NODE driven from MCP | Build a small workflow, run it | `workflow_node_types_list` lists the `type` |
| 3 | Dashboard only | Hand the user a precise, single next step | Neither of the above has it |

Work the rungs in order and never stop at rung 1. **Worked examples, verified against the
current registry:** sending a text is rung 1 since 2026-08-27 (`voice_sms_send`,
`voice_sms_send_to_contact`). Sending 1:1 from a connected Gmail/Outlook mailbox is rung 1 too,
on a key that can see `crm_` (`crm_contact_email_send` - the interactive path); the `gmailReply`
and `crmSendContactEmail` nodes are the AUTOMATION path (rung 2), and the node is the only path
under a communications-scoped key. Reading the shared inbox is rung 1 (`crm_inbox_list`) on a
key whose profile can see it. Buying a phone number, long the canonical rung-3 example, is
rung 1 now (`voice_number_purchase`, ask-gated, owned by the **hiveku-phone-agency** skill) -
which is itself the durable lesson: negative-existence claims expire, verify before repeating
one.

The corollary: do not invent a tool name to fill a gap. If a name does not resolve, it does not
exist. Check the node catalog before concluding anything, and prefer `hiveku_docs_search` /
`hiveku_docs_get` over guessing at an argument shape.

## The fourth reason a name does not resolve: your key's profile

MCP keys are scoped by profile, and the profile filters which names your catalog contains at
all (`hiveku-mcp-api-server/src/tools/profiles.ts`). The **communications** profile grants the
prefixes `email_`, `gmail_`, `voice_`, `mc_`, `memory_`, `kb_`, `pm_`, `room_`, `discussion_`,
`workflow_`, plus seven named CRM contact tools (list/get/search/create/update/upsert_by_email/
bulk_create), the task and project name lists, and the always-available `list_departments`,
`talk_to_department`, `web_search`, `fetch_url`, `audit_query`.

Several tools this skill teaches are therefore **invisible to a communications-scoped key** and
resolve only under a broader profile such as `full`: the `crm_inbox_*` readers,
`crm_thread_for_contact`, `crm_email_thread_search`, `crm_lead_triage`,
`crm_list_email_connections`, the 1:1 mailbox sender `crm_contact_email_send` (and its history
read `crm_contact_emails_list`), the DNC tools (`crm_get_dnc_status`, `crm_set_dnc`,
`crm_remove_dnc`, `crm_list_email_suppressions`), everything `helpdesk_` and `marketing_`
(including `marketing_call_transcript_get`), `survey_send`, and the CRM sequence/template
tools. `account_context_get` is always available on every profile, communications included.

**If a documented tool is missing from your catalog, check the profile before declaring rung 2
or 3** - say "not visible to this key", not "does not exist". In-profile fallbacks under a
communications key: `voice_sms_opt_out_add` for SMS opt-outs, `email_suppression_add/_list/
_remove` for email, `voice_call_transcript_get` for transcripts, and `talk_to_department` for
hydration where a domain fits.

## Working rung 2: build, dry run, read the steps

1. `workflow_node_types_list` for the catalog; read the chosen type's `fields[]` for the `data`
   keys. For an event-driven trigger, `workflow_event_trigger_types_list`.
2. `workflow_create({ name })` - defaults `is_enabled: false`, which is what you want.
3. `workflow_node_add` per node, then `workflow_edge_add`. Leave `sourceHandle` empty except
   off a `conditional` (`'true'`/`'false'`) or a `switch` (a `handleId` from
   `switchConfig.cases`).
4. `workflow_validate`, then `workflow_run({ id, test_mode: true })`.
5. `workflow_run_get`, read `step_states`. Fix with `workflow_node_update` (shallow-merged),
   re-run.
6. `workflow_enable` only once the dry run is clean and the user has approved.

**`test_mode: true` is the safe dry run - use it every time.** It short-circuits every
side-effecting node: each returns `__dry_run: true` and `would_have: { ...the args it would
have sent }`. Read `would_have` before anything fires for real: a live run reaches a customer's
phone or inbox, and that is not undoable.

A `manualTrigger` plus one action node, run once, is a fine way to spend rung 2. **Run-once
hygiene:** name it legibly (`oneoff-sms-2026-08-28-reschedule-jones`), leave it disabled, and
`workflow_delete` it when its config hard-codes a customer's number. A second run is a second
text, never a verification. Before hand-building, check `workflow_templates_list`.

## Working rung 3: the handoff

A dashboard-only capability is a handoff, not a dead end. Give the user the destination, the
action, and what to tell you when done. `workflow_dashboard_url` gets a real link for workflow
work. When a handoff or escalation (a sending suspension, an OAuth-app registration, a number
purchase) must not evaporate, record it as a Mission Control card or PM task - the profile
carries `mc_` and `pm_` precisely for that.

## Operating principles

- **There is no `communications` department agent.** See the Boundary section for the exact
  enums before routing generative work.
- **Hydrate before drafting.** `account_context_get({ domain: 'helpdesk' })` for
  customer-facing copy, `'sales'` for prospect-facing - when your key can see it. Re-read its
  `instructions` field before each generative call.
- **The send contract. No draft shown, no send. No dry run read, no live run.** Summarize the
  exact recipient and exact body, get a yes, send once. An approval is bound to the exact
  draft it covered - change the body or recipient and it is void - and it goes stale: if time
  has passed, re-read opt-out / DNC / suppression state immediately before dispatch.
- **Compliance is not optional and not a judgement call.** Check suppression before outbound
  (`crm_get_dnc_status` on a full key; `email_suppression_list` plus the send tools' own
  `opted_out` refusal under a communications key). Honor a stop signal immediately -
  `crm_set_dnc` for a contact, `voice_sms_opt_out_add` for a bare number. Never build a
  workflow that re-contacts a suppressed peer, never delete an opt-out row to force a send
  (re-enabling someone who texted STOP happens only by their own START), and never route
  around a refusal by switching tools.
- **Report outcomes in the honest vocabulary.** `sent` means the carrier accepted, not
  delivered; a null `delivery_status` means never reconciled, not failed; a quiet-hours survey
  send is `scheduled`, not sent; a throttled review ask is `skipped`, not failed. Never upgrade
  any of these to a pass, and never report a text as sent without a message id.
- **Transcripts and recordings are the most sensitive data in the account.** Verbatim and
  unredacted. Pull one only for a specific question; do not paste it anywhere that outlives
  the question. A presigned `audio_url` is an unauthenticated five-minute download link -
  never paste one anywhere.

## Hard stops - response contracts, not suggestions

- **"Text every contact in the CRM about the promo."** Refuse the loop - no suppression
  preview, no audience, no single approval covers it. Offer the real path: an audience, a
  preview with counts, approval of the exact body and count, and the campaign or survey rail
  that applies quiet hours and throttles.
- **"Just send it, skip the dry run."** Refuse. The dry run is the only place a wrong
  recipient is caught before a customer sees it. Time pressure is an argument FOR it.
- **"They texted STOP by mistake - remove the opt-out and resend."** Refuse. Only the
  customer's own START or YES re-subscribes them. Offer another consented channel.
- **"Release the old number."** Irreversible - the DID returns to carrier inventory, cannot be
  re-bought, and can be sold to a stranger while still printed on signage and listings. Only
  after a human confirms this exact number, by digits.
- **"Unblock this caller" / "clear the blocklist."** A block silenced a harasser or a number
  staff must not dial; the row usually has no author and no reason, and removal re-opens the
  path instantly with no record. Confirm with the account owner per number; never sweep.

## Play 1 - Read the shared inbox

`crm_inbox_connections` lists the connected mailboxes. Then read - **the two reader names are
inverted**: `crm_inbox_list({ folder, limit, connection_id })` is the plain recent-N sweep;
`crm_inbox_recent({ query, ... })` is the SEARCH tool with `query` REQUIRED (native
Gmail/Outlook syntax) - called bare it is a 400, not a sweep. Omit `connection_id` on a
multi-inbox account and you silently read the default mailbox, which looks exactly like an
empty inbox.

Per-contact and archive: `crm_thread_for_contact` (the full LIVE thread for one contact),
`crm_email_thread_search` (CRM-SYNCED copies - a never-synced message is invisible here and
present in the live read), `crm_lead_triage` (one-shot lead intake sweep). All `crm_`-prefixed,
so full-profile key. Load `references/inbox.md` for the mailbox-selector table and
default-mailbox resolution.

## Play 2 - Reply inside an existing thread (rung 1 interactive, rung 2 automation)

**The interactive path is a direct tool:** `crm_contact_email_send({ contact_id, subject, body,
reply_to_message_id, thread_id })` sends a real email from the account's connected Gmail/Outlook
mailbox to the contact's address on file, threaded when you carry `reply_to_message_id` and
`thread_id` over from `crm_thread_for_contact`. It self-logs to the contact timeline (do not
double-log it with `crm_create_activity`) and has no draft state and no recall - show the exact
subject and body, get the yes, send once; on an ambiguous timeout read
`crm_contact_emails_list({ contact_id })` back before any retry. It is a `crm_` tool, so a
communications-scoped key cannot see it. Full signature and traps: `references/inbox.md` Part 4
and the sales skill's 1:1 email section.

**The automation path is the `gmailReply` node** (despite the name, any connected mailbox,
Gmail or Outlook) - the rail when a trigger or schedule sends the reply, or when your key
cannot see `crm_contact_email_send`. Read with Play 1 or 4, carry the thread id into the node.

**This node has the worst authoring trap in the department.** The catalog advertises two
fields; the handler requires `connectionId`, `to` and `subject` (none advertised) and reads
`threadId` in camelCase where the catalog says `thread_id`. Built faithfully from the catalog
it fails three times and then sends an unthreaded new email. `gmailSend` has the same missing
`connectionId`. The full key table and the reader-to-node pattern are in `references/inbox.md`
Part 4 - load it before building, then dry run and read the `would_have` recipient.

Do not reach for `email_send_test` as a reply substitute: it is a REAL send on the marketing
lane (`dry_run` defaults FALSE), does not thread, and does not come from the person the
customer wrote to.

## Play 3 - Repair a broken connection

The symptom is any CRM email, inbox or calendar tool reporting **"No active Gmail connection
found."** The ladder: (1) diagnose with `email_connections_list` - the ONLY reader carrying
`connection_status` and `last_error`; (2) `email_connect_start({ platform, scope_label,
user_email })` - on a multi-user account you MUST say which user owns it; (3) hand the
`setup_url` over, do not open it - **valid five minutes**; (4) `code: 'no_oauth_app'` is not
transient: the account OWNER must register an OAuth Client at `/dashboard/settings/oauth-apps`
first - say that and stop; (5) verify `connection_status: 'connected'`, then a cheap read.

Mailbox health is not sending health: `email_service_status` (read `sending_enabled` FIRST -
false means a `suspension` block explains why, ALL sending is blocked, and suspensions are
lifted by Hiveku staff, not by any tool) and `email_deliverability_check` (a real send to the
AWS mailbox simulator - NEVER invent your own test address; test sends to example.com caused a
real account suspension). `references/inbox.md` Part 5.

## Play 4 - The `gmail_*` family

Eight rung-1 tools against the connected Gmail mailbox, each with optional `email` to pick a
mailbox: `gmail_search_messages` (ID stubs only - narrow the query rather than fanning
`gmail_get_message`), `gmail_get_message`, `gmail_get_thread`, `gmail_conversation_history`
(the duplicate-guard before outreach), `gmail_inbox_lead_replies`, `gmail_parse_forward`,
`gmail_list_labels`, `gmail_modify_labels`.

Two cautions on `gmail_inbox_lead_replies`: **it writes to the mailbox by default**
(`auto_label` defaults TRUE - pass `auto_label: false` unless labelling is the point), and its
tenant-scoped team filter degrades quietly to noise-only when the membership lookup fails.
Signatures and trap detail: `references/inbox.md` Part 3.

## Play 5 - SMS (the phone skill owns it now)

Texting - sends, replies, bulk, scheduled sends, templates, MMS, opt-outs, caps and the
reputation governor, 10DLC and toll-free registration - is the **hiveku-phone-agency**
skill's territory (`hiveku-phone-agency/references/sms-operations.md` and
`hiveku-phone-agency/references/tendlc-and-toll-free.md`). Load that skill for any SMS work.
Three facts survive here because they cross into THIS skill's lanes:

- **The STOP trap.** A bare compliance keyword (`stop`, `unsubscribe`, `cancel`, `end`,
  `quit`, `stopall`) is handled upstream and suppresses the notification entirely - no bell,
  no ticket, **no `smsReceivedTrigger` fire** - so never build a workflow keyed on "STOP",
  and know a bare "CANCEL" opts the customer out of ALL SMS. `yes` is carved out and fires.
- **Compliance writes.** `crm_set_dnc` / `crm_get_dnc_status` / `crm_remove_dnc` on a full
  key are atomic across email AND SMS (mind the phone-format trap - the phone skill
  documents it); `voice_sms_opt_out_add` is the in-profile, number-scoped stop.
- **The helpdesk projection.** An inbound text becomes a ticket on helpdesk-enabled
  accounts, but `helpdesk_ticket_send_reply` records a reply and DELIVERS NOTHING for
  `channel: 'sms'` - text back with `voice_sms_thread_reply`, then log.

## Play 6 - Telephony (the phone skill owns it now)

Calls, voicemail, recordings and transcripts, numbers and E911, extensions, IVRs, ring
groups, queues, caller ID, porting, call tracking - all of it lives in the
**hiveku-phone-agency** skill, whose references carry the trap manuals
(`hiveku-phone-agency/references/pbx-routing.md`,
`hiveku-phone-agency/references/calls-voicemail-transcripts.md`, and siblings). Load it for
any phone work, any voice WRITE, and `/hiveku:phone-check` for the diagnosis ladder. Two
facts worth keeping in view from this side: the stored call dispositions are exactly
`answered | voicemail | missed | ai_handled | abandoned` (the tool description's
`no_answer/busy/failed` are never stored and return silent zeros), and a presigned
recording/voicemail `audio_url` is an unauthenticated five-minute link - never paste one.
Voice automation nodes (rung 2): `voiceCallCompletedTrigger`, `voiceVoicemailTrigger`,
`voiceMissedCallTrigger`, plus read-only action nodes and `phoneCall`.

## Play 7 - Email infrastructure

**Templates split three ways and are not interchangeable** - the most common wasted hour here:
`email_template_*` feeds the `/api/v1` transactional send API, `marketing_template_*` feeds
campaigns (`email_campaign_create`'s `template_id` references THIS one), `crm_*_email_template`
feeds sales sequences and one-to-one CRM sending. A campaign CANNOT use an `email_template_*`
template.

**Campaigns:** find them with `email_campaign_list` (filter by status and `audience_id`) and
`email_campaign_get` (includes inline bodies) - never guess an id. Create as a draft,
`email_audience_preview` before EVERY send, `email_campaign_test_send`, then schedule or
`email_campaign_send_now` - with `dry_run: true` first, sent for real only after reading the
queued/skipped numbers. `email_campaign_metrics` returns the send-row counts by status plus an
`engagement` block on every campaign (delivered / opened / clicked / bounced / complained and
open_rate / click_rate against delivered, `null` until anything delivered) - report the rate from
that block, never from counting `email_logs_list` rows; unsubscribe counts are absent from it.

**Stopping a scheduled send is the highest-leverage recovery here.** A scheduled campaign:
`email_campaign_cancel` (`_pause` once sending). A queued CRM batch: `crm_email_send_queue_list`
then `crm_email_batch_cancel` (still-queued rows only; report what had already left) or
`crm_email_batch_reschedule` - the `crm_` pair needs a full key. Cancel first, report after.

**Sequences split two ways**: `email_sequence_*` is the marketing drip engine (nothing fires
until `email_sequence_activate`; `email_sequence_pause` is DESTRUCTIVE - it exits enrollments
permanently, not a hold), and `crm_*_sequence` is the separate sales engine
(`crm_sequence_spam_check` before activating). Audiences, domains, suppression, deliverability
and the diagnosis ladder: `references/email-infrastructure.md` - load it before creating a
template, scheduling a campaign, or answering "why is our email not arriving".

## Boundary: the email department has an agent; communications as a whole does not

`talk_to_department`'s domain enum is `seo`, `social`, `content`, `marketing`, `branding`,
`outbound`, `ppc`, `analytics`, `customer_avatar`, `customer_journey`, `before_after_grid`,
`website_design`, `knowledge_base`, `workflow`, `sales`, `email`. Sixteen values, none of them
communications, voice, sms or helpdesk. `sales` joined on 2026-08-29 and runs the sales
department agent (Morgan, the account's `_identity:sales`); its own gated writes come back as
"staged, awaiting approval" through this rail, so use it for drafts and plans and persist with
the direct tools yourself. `email` is the email marketing department: `talk_to_department({
domain: 'email' })` runs its agent with the account's hydration, and `account_context_get({
domain: 'email' })` returns its persona, brand voice, memory and rules - start every campaign
draft there, not at `marketing`. An unlisted value is rejected server-side, not silently
defaulted. `list_departments` reports which domains this tenant has enabled.

`account_context_get`'s enum is `content`, `marketing`, `seo`, `social`, `ppc`, `sales`,
`helpdesk`, `branding`, `customer_avatar`, `customer_journey`, `before_after_grid`,
`website_design`, `knowledge_base`, `workflow`, `outbound`, `email`. (`helpdesk` is valid HERE
and not in `talk_to_department`; `analytics` is the reverse - those asymmetries are the source of
the confusion.)

Send-time refusals the email tools return, relayed verbatim: `email_service_suspended` (403 - the
account's sending is suspended by the reputation monitor or staff; nothing sends until staff lift
it), `audience_not_opted_in` (the account requires opt-in and the audience is visitor-derived -
built from Visitor Intelligence signals, not opted-in contacts), `reserved_test_address` (a test
send aimed at example.com, test.com, localhost or another reserved domain; use
success@simulator.amazonses.com), `tenant_identity_not_attached` (the verified domain is not
attached to the account's SES tenant; staff reconcile it). `email_campaign_send_now({ dry_run:
true })` counts recipients without sending, and an in-flight send can be held and continued with
`email_campaign_pause` / `email_campaign_resume` (queued rows wait; nothing is re-materialized).

Route generative work: customer-facing reply copy via `account_context_get({ domain:
'helpdesk' })` then draft yourself and persist with the direct tool; prospect-facing copy via
`talk_to_department({ domain: 'sales' })` (or `account_context_get({ domain: 'sales' })` and
draft yourself when the sales agent is gated off - 403 `sales_agent_disabled`); campaign
strategy via `talk_to_department({ domain: 'marketing' })`; workflow design via
`{ domain: 'workflow' }`. Neighbouring skills own adjacent ground
(`hiveku-helpdesk-agency`, `hiveku-sales-agency`, `hiveku-outbound-agency`,
`hiveku-automation-agency`); this skill owns the plumbing underneath all of them.

## Pitfalls

- **Reporting a missing tool name as a missing capability.** Work all three rungs, then check
  the key's profile - say "not visible to this key", never "does not exist". Never invent a
  name to fill a gap.
- **Repeating a stale negative-existence claim.** The registry grew ~230 tools on 2026-08-27,
  and "no MCP tool sends from a connected mailbox" went stale when `crm_contact_email_send`
  shipped. Verify "there is no X" against the live catalog first.
- **Calling `crm_inbox_recent` for recent mail.** It is the search tool; `query` is required.
- **Omitting `connection_id` on a multi-inbox account.** You silently read the default mailbox.
- **Building `gmailReply` from the node catalog alone.** `connectionId`, `to`, `subject` are
  required and unadvertised; the handler reads `threadId`, not `thread_id`.
- **Building a STOP keyword workflow.** A bare compliance keyword never reaches the trigger -
  and a bare "CANCEL" is an opt-out, so your cancellation flow never sees it.
- **Replying to an SMS ticket with `helpdesk_ticket_send_reply`.** Records the message,
  delivers nothing. Use `voice_sms_thread_reply` or the `sms` node.
- **Passing `mark_read: 'true'` on a background SMS-thread read**, clearing a human's unread badge (the read is side-effect-free by default now).
- **Reporting `sent` as delivered, or blind-retrying a 502.** `sent` = carrier accepted; null
  `delivery_status` = never reconciled; the failed row is committed, so a retry can
  double-send.
- **Deleting an opt-out row to force a send.** Re-subscribing is the customer's own act.
- **Filtering dispositions with `no_answer`, `busy` or `failed`.** Never stored; silent zero.
- **Pasting a presigned `audio_url` or recording URL anywhere.**
- **Reading "no transcript" as empty.** Five `transcript_state` values; `purged` means the
  summary survives.
- **Pointing a campaign at an `email_template_*` template.** Campaigns need
  `marketing_template_*`.
- **Trusting `email_connections_list`'s description.** It returns Gmail/Outlook connections
  and is the ONLY reader carrying `connection_status`/`last_error`.
- **Retrying `email_connect_start` after `no_oauth_app`**, or letting the five-minute
  `setup_url` expire buried in a long message.
- **Calling `gmail_inbox_lead_replies` as a read.** `auto_label` defaults true; it writes
  labels to a real mailbox.
- **Running a live workflow to see if it works.** `test_mode: true` first, every time.
- **Leaving a run-once send workflow enabled or undeleted** with a customer's number
  hard-coded.
- **Sending anything client-visible without explicit confirmation** - and without re-checking
  suppression if time has passed since the yes.

## Deep references - load the one that matches the work

This file is the map. The manuals below carry the mechanisms, exact field shapes, and the
incidents behind each rule. Load the relevant one BEFORE building, not after a symptom.

| Reference | Load it when |
|---|---|
| `references/inbox.md` | Reading or searching any mailbox; replying in a thread (`crm_contact_email_send` interactively, the `gmailReply` node for automation); `gmail_*` signatures and traps; connecting or repairing a Gmail/Outlook connection; `no_oauth_app`; "no active Gmail connection found". |
| `references/email-infrastructure.md` | Campaigns (finding, creating, cancelling a scheduled send), audiences, the three template families, both sequence engines, the CRM send queue, sending domains, suppression, deliverability, send-log diagnosis. |

Phone and SMS manuals moved: they are the **hiveku-phone-agency** skill's references now
(`hiveku-phone-agency/references/sms-operations.md`,
`hiveku-phone-agency/references/pbx-routing.md`, and siblings). Load that skill, not a file
from here, for anything a phone does.
