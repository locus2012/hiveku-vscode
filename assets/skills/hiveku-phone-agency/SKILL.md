---
name: hiveku-phone-agency
description: "The phone department - the PBX, the numbers, the texting, the tracking. People say: \"buy us a local number\", \"we need an 800 number\", \"set up an IVR\", \"make the main line ring everyone\", \"add a phone for the new rep\", \"port our numbers from CallRail / Twilio / GoHighLevel\", \"register us for texting\", \"our texts aren't delivering\", \"we show up as Spam Likely\", \"the wrong number shows when we call out\", \"is our call tracking working?\", \"the phones aren't ringing\", \"can't dial out\", \"how many calls did the ads bring in?\". Use for ANY phone-system or SMS work - buying and configuring phone numbers, E911 addresses, extensions, IVRs, ring groups, call queues, presence, voicemail, call history, recordings and transcripts, 10DLC and toll-free SMS registration, sending and reading texts, SMS templates and scheduled and bulk sends, STOP and opt-out compliance, porting numbers in from another carrier, caller ID / CNAM / spam-label reputation, DNI call-tracking pools and the local-swap snippet, and reporting phone-call conversions back to the ad platforms. ALSO load before risky phone asks - \"release the old numbers\", \"delete the ring group / IVR / extension\", \"raise the toll-fraud cap\", \"undo their STOP\", \"text every contact\", \"clear the blocklist\", \"just resubmit the campaign\" - the refusal rules and the safe alternatives live here."
---

# Hiveku Phone Agency Operating System

Every write on this surface reconfigures a phone system real customers are calling, spends
carrier money, or files legal paperwork about a real company. The reads are cheap; the writes
are live. This file is the map and the rules; the reference manuals carry the mechanisms.

## What this skill owns

The entire `voice_` tool prefix: numbers and E911, the PBX (extensions, IVRs, ring groups,
queues, presence, tenant settings), calls / voicemail / recordings / transcripts, every SMS
ability including 10DLC and toll-free registration, porting, caller ID and reputation, DNI
call-tracking pools, and the call-conversion send-back to the ad platforms.

**Profile visibility** (which key sees which names):

- The **helpdesk** and **communications** profiles carry the whole `voice_` prefix.
- The **sales** profile gets three voice tools by name: `voice_call_transcript_get`,
  `voice_calls_list`, `voice_call_get`. That is the path from a CRM call to its transcript:
  `crm_calls_list` rows carry `external_id` (the call UUID), never the `voice_calls.id` the
  transcript tool takes, and `voice_calls_list` maps one to the other.
- The **marketing-ads (PPC)** profile carries the call-tracking surface BY NAME:
  `voice_call_tracking_diagnose`, `voice_call_tracking_live_probe`,
  `voice_call_tracking_outbox`, `voice_call_tracking_setup`, `voice_pools_list`,
  `voice_pool_get`, `voice_pool_sessions_list`, `voice_phone_tracking_config_get`,
  `voice_numbers_list`, `voice_e911_addresses_list`, `voice_settings_get`,
  `voice_calls_list`, `voice_call_get` - and nothing else `voice_`. Pool, membership and
  config WRITES are not on it: on a PPC key they are invisible, not missing.
- A tool outside your key's profile is INVISIBLE, and the failed call reads exactly like a
  missing feature. Say "not visible to this key", never "does not exist", and ship the fix as
  a `pm_tasks_create` naming the exact tool for whoever holds the wider key.

## The availability rule

Each reference opens with an Availability table. Every `voice_` name in those tables resolves
on this server today except the two rows marked INCOMING (one in
`references/call-tracking-dni.md`, one in `references/sms-operations.md`): INCOMING means the
MCP server declares the tool but this plugin's tool index has not been regenerated to carry it
yet, and the row flips to LIVE at release. Each tool is described from its own registered
description - trust that over any older copy of a reference.

**A name that does not resolve is a profile question first.** (1) Check the key's profile - the
list above says which names each key sees, and an invisible tool fails exactly like a missing
one; (2) work the hiveku-communications reachability ladder (direct tool, then a workflow node,
then the dashboard); (3) hand off with a precise single dashboard step and file it with
`pm_tasks_create` so it does not evaporate. Never tell a user Hiveku cannot do the thing, and
never invent a name to fill the gap.

## Operating principles

- **Read current state before every write.** Every mutation here edits a live object; read it
  first (`voice_number_get`, `voice_ring_group_get`, `voice_ivr_walk`, `voice_settings_get`),
  show the exact before/after, and get a yes on THAT diff.
- **One object per confirmation.** Never batch voice writes behind one approval. Echo the
  before/after, write once, then READ THE STATE BACK with the matching read tool - several
  routes here answer 200 without the phone system having agreed (a `warning` field, a null
  `fusionpbx_group_uuid`), so the read-back is the verification, not the status code.
- **Name the money field out loud.** Some tools are free except for one argument:
  `voice_call_tracking_setup`'s `did_count` is the only thing in it that buys numbers;
  an IVR save renders paid TTS; a toll-free DID bills a monthly surcharge. Before any call
  that can spend, say which field spends and what the number is.
- **Olympus voice writes leave NO audit row.** The audit helper skips the row for a key
  actor, so nothing you do here appears in `voice_audit_export_csv` or on the dashboard's
  audit page. You are the audit trail: tell the human exactly what changed, with ids and
  before/after values, every time.
- **PII classes on this surface, each with a handling rule:** presigned recording and
  voicemail URLs (unauthenticated 5-minute downloads - never paste one anywhere); verbatim
  transcripts (quote the minimum, prefer the AI summary); port-order paperwork (billing
  address, signer, account-number last-four - never client-visible); the 10DLC brand row
  (a real company's EIN); presence `other_party` (who is on the phone right now).
- **The SMS send contract: no draft shown, no send.** Exact recipient, exact body, explicit
  yes, send once, confirm from a read-back - never from the 200. An approval binds to the
  exact draft it covered and goes stale; re-check opt-out state if time has passed.

## Hard stops - response contracts, not suggestions

- **"Release the unused numbers" (any by-pattern release).** Refuse the pattern. Release is
  permanent: the DID returns to carrier inventory, cannot be re-bought, can be resold to a
  stranger while still printed on signage and the Google listing. Offer: inventory + routing
  review, then one confirmed release at a time, by digits, from the account owner.
- **"Delete the old IVR / ring group / extension."** Never delete a routing object without
  walking everything that targets it first - every DID's inbound target, every IVR digit and
  after-hours target, every ring-group fallback, every queue overflow, every pool
  destination. The delete guards catch most of this (409 naming blockers) but not all of it,
  and the queue delete removes the row even when PBX teardown fails.
- **"Raise the toll-fraud cap so we can keep dialing."** Refuse as a first move. The cap is a
  spend guard that did its job - read `voice_toll_fraud_state` and report what burned the
  budget first. Raising `daily_outbound_cap_cents` is a money decision for a human.
- **"They texted STOP by mistake - undo it."** Refuse. Only the customer's own START or YES
  re-subscribes them; no tool deletes an opt-out row, by design. Offer another consented
  channel.
- **"Skip the preflight, just file the campaign."** Refuse. `voice_sms_cta_preflight` is free
  and files nothing; skipping it risks a rejection fee and a week of carrier review. It runs
  before EVERY filing, including resubmits.
- **"Resubmit the toll-free number to fix the label."** A verified toll-free number that is
  resubmitted has its approval OVERWRITTEN and STOPS SENDING for one to two weeks of
  re-review. Refuse unless the human confirms knowing exactly that.
- **"Buy 20 numbers."** Refuse the bulk. Purchases are one at a time, each confirmed, each
  a recurring monthly charge; a pool sizing question goes through the sizing math in
  `references/call-tracking-dni.md`, not through a round number.
- **"Schedule the tracking probe" (`voice_call_tracking_live_probe` or `voice_swap_test` on
  a cron).** Refuse. Both HOLD a real tracking DID for the sticky window per run; scheduled,
  they starve the pool for live visitors. Run once to confirm a fix, never on a schedule.
- **"Text every contact about the promo."** Refuse the loop. No suppression preview, no
  single approval covers it, and per-number caps will half-send it. Offer the audience +
  preview + counted, approved batch path in `references/sms-operations.md`.
- **"Delete the old 10DLC campaign."** The campaign is the number's sending identity at the
  registry; deleting it can silence every number assigned to it. Read
  `references/tendlc-and-toll-free.md` first, and only delete a row that never reached the
  carrier or is terminally FAILED/EXPIRED - with the human naming it.
- **"Clear the blocklist" / "unblock this caller".** A block silenced a harasser or a number
  staff must not dial; API-added rows have no author, so the context is invisible. Account
  owner confirms per number; never sweep.
- **Never paste a recording or voicemail URL anywhere.** It is an unauthenticated, shareable,
  non-revocable 5-minute download of a real conversation. Pasting it into a ticket, log or
  transcript republishes the recording.

## Cheat sheets

**The extension number plan** (what a 4-digit number tells you):

| Range | What it is |
|---|---|
| 1001 and up | User extensions (seats, softphones, PSTN forwards) |
| 5000-5999 | ACD call queues |
| 6000-6999 | IVR auto-attendants |
| 7xxx | Ring groups (convention, NOT enforced - nothing cross-checks a collision) |
| 8001-8999 | Auto-created personal ring groups |

**The five stored dispositions.** `voice_calls.disposition` only ever holds `answered`,
`voicemail`, `missed`, `ai_handled`, `abandoned`. `voice_calls_list`'s own parameter
documentation still advertises `no_answer`, `busy` and `failed` - those are NEVER stored, and
because the filter is a raw equality match they return silent zeros, not errors. Count missed
calls with `missed`. The `no_answer` / `busy` / `connected` family is the separate MANUAL
vocabulary a rep picks in the CRM (`voice_call_disposition_set`), stored on the activity,
never on the call row.

**Toll-free NPAs.** The NANP toll-free set is 800, 833, 844, 855, 866, 877, 888 (822 is
reserved but not in service - it is not part of the set). Toll-free is exempt from E911 end
to end, cannot carry a geographic search filter, and 800 itself is unpurchasable through
Hiveku (premium carrier pricing; the search tool will not even take the prefix).

**The NANP normalization trap.** `voice_blocked_numbers_add` rewrites any input with exactly
10 digits to `+1` plus those digits EVEN IF you sent a leading `+`, so a 10-digit non-US
number gets filed as a US number and you block a stranger. Always pass full E.164 with
country code and read back the stored `e164`.

## Dispatch table - play, first tools, then load the reference

| The ask | First tools | Reference |
|---|---|---|
| "Buy us a local number" / "we need an 800 number" / E911 | `voice_numbers_search`, then `voice_number_purchase` | `references/numbers-and-e911.md` |
| "Phones aren't ringing" / IVR, extension, ring group, queue, settings, blocklist | `voice_diagnose_setup`, `voice_tenant_healthcheck` | `references/pbx-routing.md` |
| "Who called at 4:15?" / voicemail, recordings, transcripts, call history | `voice_calls_list`, `voice_voicemails_list` | `references/calls-voicemail-transcripts.md` |
| "Register us for texting" / "our texts aren't delivering" / 10DLC, toll-free verification | `voice_sms_registration_get`, `voice_sms_cta_preflight` | `references/tendlc-and-toll-free.md` |
| "Text her back" / threads, templates, bulk, scheduled, STOP | `voice_sms_threads_list`, `voice_sms_thread_reply` | `references/sms-operations.md` |
| "Is call tracking working?" / DNI pools, number swap, local swap, "the tracking numbers ran out" | `voice_call_tracking_diagnose`, `voice_pool_get` | `references/call-tracking-dni.md` |
| "How many calls did the ads bring in?" / conversions back to Google | `voice_call_tracking_outbox`, `marketing_call_attribution_breakdown` | `references/conversion-send-back.md` |
| "Port our numbers from CallRail / Twilio / GHL" | `voice_portability_check`, `voice_port_orders_list` | `references/porting.md` |
| "We show up as Spam Likely" / "wrong number when we call out" | `voice_number_cnam_set`, `voice_settings_get` | `references/caller-id-and-reputation.md` |
| An end-to-end job: new office, new rep, after-hours, text-back, tracking from zero, the CallRail cutover, quarterly hygiene | the recipe's own ordered list | `references/voice-playbooks.md` |

## Voice in workflows (rung 2)

The automation rail has six load-bearing node types: `voiceMissedCallTrigger` (the
speed-to-lead hook - a missed or abandoned call with no voicemail), `voiceVoicemailTrigger`
(caller and message length, NEVER the transcript), `voiceCallCompletedTrigger` (fires after
every call, human or AI), `smsReceivedTrigger` (a bare STOP/CANCEL keyword never reaches it),
the `sms` action node, and `phoneCall`. Build with `test_mode: true` and read the
`would_have` payload before anything fires for real. Node field shapes, trigger payloads and
the authoring traps live in the automation skill:
`hiveku-automation-agency/references/node-rail.md`.

## Boundaries

- **`talk_to_department` has NO voice, phone, sms or communications domain.** Its enum does
  not include them, and an unlisted value is rejected server-side. Generative work routes
  through the domains that exist: `account_context_get({ domain: 'helpdesk' })` for
  customer-facing copy (IVR greetings, autoresponder texts, voicemail prompts), then draft
  yourself and persist with the direct tool.
- **hiveku-conversion-tracking owns the attribution VERDICT** - "is tracking broken", the
  scorecard, the triage ladder, the platform-vs-Hiveku reconciliation. This skill owns the
  phone-side plumbing (pools, swap, the upload outbox). When the question is "are the
  numbers right", load that skill; when it is "make the phone side work", stay here.
- **hiveku-communications owns email and the shared inbox** - Gmail/Outlook, campaigns,
  sequences, deliverability. Texting, calls and everything with a dial tone lives here.
- Inbound texts and calls are also projected into helpdesk (`helpdesk_ticket_list` with the
  channel filter); replying to those tickets is this skill's rail, not the helpdesk reply
  tool - see `references/sms-operations.md`.

## Pitfalls

- Reporting a missing tool name as a missing capability - check profile, then the ladder.
- Filtering dispositions with `no_answer`, `busy` or `failed` - never stored; silent zero.
- Trusting a 200 on a routing write without reading state back - `warning` fields and null
  PBX uuids mean the database and the phone system disagree.
- Reading `voice_call_get`'s `recording_url` (hardcoded null) or `recording_transcript`
  (the AI summary, not the transcript) at face value.
- Passing `mark_read: 'true'` on a background SMS-thread read (it clears the badge a human triages from; omit it and the read is side-effect-free), or a voicemail sweep without
  `audio_urls: 'false'` - you clear a human's badge or mint presigned audio you don't need.
- Pasting a presigned recording or voicemail URL anywhere, ever.
- Treating 402 `voice_not_enabled` as an empty inbox - it is a plan refusal.
- Believing `voice_diagnose_setup`'s `dids_without_e911` before subtracting toll-free
  numbers - toll-free is E911-exempt and inflates the count.
- Releasing, deleting or unblocking by pattern instead of by a human-named id.
- Retrying a 502 SMS send blind - the failed row is committed; a retry can double-send.
- Reporting `sent` as delivered - `sent` means the carrier accepted; null `delivery_status`
  means never reconciled.
- Scheduling `voice_call_tracking_live_probe` or `voice_swap_test` - each run holds a DID.
  `voice_pool_get`'s occupancy block answers "is the pool exhausted" without minting.
- Re-verifying a verified toll-free number casually - it stops sending for 1-2 weeks.
- Filing a 10DLC campaign whose use case does not match the website, or whose opt-in page
  renders the CTA in client-side JavaScript - the crawler sees neither; both are rejections.
- Assigning a DID to a campaign with the wrong id space - one tool takes the Hiveku UUID,
  another takes the registry id; read `references/tendlc-and-toll-free.md`.
- Trusting either pool read's whisper/greeting block - both `voice_pools_list` and
  `voice_pool_get` ride a second read that can silently fail to defaults; when a pool someone
  says they configured reports bare defaults on both, the dashboard pool dialog is the
  tie-breaker (`references/call-tracking-dni.md` section 2).
- Trusting `voice_usage_get`'s minute counters - only TTS spend is actually written there.
- Expecting your own writes in `voice_audit_export_csv` - key-actor writes are skipped.
- Using `users.account_id` to decide who on the team gets notified - it is the HOME account,
  not membership.
- Concluding "nobody is on a call" from empty presence - `channels_ok: false` means the
  lamp state was unavailable, not idle.

## Reference map - load the one that matches the work

| Reference | Load it when |
|---|---|
| `references/numbers-and-e911.md` | Buying, configuring, or retiring a DID; number search traps; E911 registration and the pending-vs-registered gap; CNAM at purchase; usage and pricing; the release hard stop. |
| `references/pbx-routing.md` | Anything about who rings: the diagnose ladder, extensions and device types, ring groups and strategies, IVRs and TTS cost, queues (NOT production-ready - prefer a ring group), tenant settings and their consumers, the blocklist, toll fraud. |
| `references/calls-voicemail-transcripts.md` | Call history and dispositions, the voicemail queue, recordings, transcripts and `transcript_state`, the CSV export, wrap-ups, who-called-when questions, the helpdesk crossing. |
| `references/tendlc-and-toll-free.md` | SMS registration end to end: brand, campaign, number assignment, the `can_send` truth table, CTA preflight and the opt-in page, rejections and appeals, toll-free verification and its overwrite trap, the client share-link handoff. |
| `references/sms-operations.md` | Sending and reading texts: the send tools and their refusals, threads, templates, bulk and scheduled sends, STOP/opt-out compliance, DNC, caps, the helpdesk projection, delivery-status truth. |
| `references/call-tracking-dni.md` | DNI pools: the session model, sticky windows, pool sizing and starvation, local swap, consent, per-project tracking config, the swap test, the CallRail migration order. |
| `references/conversion-send-back.md` | Phone-call conversions to the ad platforms: the four lanes, enablement, the outbox and retry taxonomy, enrichment, the paid-ads call report. |
| `references/porting.md` | Moving numbers in: portability checks, filing and confirming a port order, FOC dates and exceptions, carrier-specific guides (CallRail / Twilio / GHL), adoption after the port. |
| `references/caller-id-and-reputation.md` | What shows on the far handset: both caller-ID paths, SMS sender resolution, CNAM, spam-label remediation, STIR/SHAKEN, click-to-call. |
| `references/voice-playbooks.md` | Any end-to-end job: new-office setup, add a rep, after-hours, missed-call text-back, call tracking from zero, the CallRail cutover, client texting from zero, quarterly hygiene. |
