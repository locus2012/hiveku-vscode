# Reference: Voice Playbooks - eight end-to-end recipes

The jobs clients actually ask for, each as an ordered recipe: the goal, the preconditions,
the tools in order with every confirmation gate marked, what to read back after each step,
what to tell the client, and what to file. Depth on any single step lives in the sibling
references - this file is the choreography.

**How to read a recipe:**

- **[CONFIRM]** marks a gate: show the exact before/after (or the exact draft/spend), get an
  explicit yes on THAT plan, then make the one write. One object per confirmation - a yes
  never covers the next step.
- Every tool named in these recipes resolves on this server today. A name that does not
  resolve on your key is a profile question first (SKILL.md's availability rule): check the
  key's profile, then the reachability ladder, then hand off one precise dashboard step and
  file it with `pm_tasks_create` so it does not evaporate. Never say the capability does not
  exist.
- **Read back after every write.** Several voice routes answer 200 without the phone system
  having agreed. The read-back named in each step is the verification, not the status code.
- Hydrate copy first: any greeting, autoresponder or text a customer will hear or read is
  drafted after `account_context_get({ domain: 'helpdesk' })` and shown verbatim.

## Availability

| Recipe | Fully live today? |
|---|---|
| 1. New-office phone setup | LIVE end to end |
| 2. Add a rep | LIVE end to end |
| 3. After-hours handling | LIVE end to end |
| 4. Missed-call text-back | LIVE end to end |
| 5. Paid-ads call tracking from zero | LIVE end to end |
| 6. The CallRail cutover | LIVE end to end |
| 7. Client texting from zero | LIVE end to end |
| 8. Quarterly phone hygiene | LIVE end to end (read-heavy) |

---

## Recipe 1: New-office phone setup

**Goal:** a main line that rings the team, an auto-attendant, a seat per person, voicemail,
and a compliant E911 address - from an empty tenant.

**Preconditions:** the Voice add-on is on (a 402 `voice_not_enabled` anywhere means stop and
hand the plan question to the owner); `voice_settings_get` returns a non-null `settings` row
(null means the PBX tenant was never provisioned - a dashboard/provisioning handoff, not
something any tool here fixes); `account_context_get({ domain: 'helpdesk' })` loaded before
drafting any greeting.

**Steps:**

1. Baseline: `voice_diagnose_setup` and `voice_settings_get`. Read back
   `tenant_provisioned`, the counts, and `blocking_issues` (verbatim, minus the toll-free
   E911 caveat - `references/numbers-and-e911.md`).
2. E911 BEFORE numbers - a local DID cannot activate without a verified address.
   `voice_e911_addresses_list`; if the office address is missing:
   `voice_e911_address_create` [CONFIRM - this registers the street address emergency
   services will be dispatched to]. Read back
   `voice_e911_addresses_list`: `pending` is not `registered` - wait for verified before
   buying against it.
3. Shortlist: `voice_numbers_search` with the office `area_code`. Present the shortlist with
   both cost fields (real recurring money) and the `features` array - a result without `sms`
   cannot text, and the client will want texting later. Search reserves nothing; a listed
   number can be gone by purchase time.
4. Buy ONE number: `voice_number_purchase` [CONFIRM - name the money out loud: a recurring
   monthly carrier charge until released; local REQUIRES the `e911_address_id`; buying by
   `search` takes the FIRST match, so prefer the exact `e164` from the shortlist]. A 202
   means the order is COMMITTED at the carrier and still provisioning: watch
   `voice_number_orders_list` and NEVER re-buy while an order is pending. Depth:
   `references/numbers-and-e911.md`.
5. Seats: one `voice_extension_create` per person [CONFIRM each - it provisions a live SIP
   endpoint immediately]. Extensions number from 1001 up. Read back `voice_extensions_list`
   after EVERY create - the PBX endpoint is created before the database row, so a failed
   insert orphans a live endpoint. The SIP password exists exactly once, dashboard-side:
   file `pm_tasks_create` "provision device for ext NNNN" per seat.
6. The team ring group: `voice_ring_group_create` [CONFIRM - pick a 7xxx extension and check
   it collides with nothing; NOTHING cross-checks the number ranges for you]. Read back
   `voice_ring_group_get`: a null `fusionpbx_group_uuid` means it exists only in Postgres
   and cannot ring anyone. Strategies and member semantics: `references/pbx-routing.md`.
7. The auto-attendant: draft the greeting from the hydrated brand voice, pick a voice with
   `voice_tts_voices_list`, sanity-check the canned wording with
   `voice_default_greetings_get` (it seeds from the internal workspace label, not the
   company name - read it before letting it be read aloud). Then `voice_ivr_create`
   [CONFIRM - name the money: every greeting and option announcement is a paid TTS render,
   and the menu answers real callers the moment any DID points at it]. Read back
   `voice_ivr_walk` and narrate the tree.
8. Point the main line: `voice_number_update` setting the DID's inbound target to the IVR
   (or straight to the ring group for a no-menu office) [CONFIRM - the very next inbound
   call follows the new route]. Read back `voice_number_get`.
9. Verify: `voice_tenant_healthcheck` - it is the only tool that can see the PBX side and
   catches a DID with no inbound dialplan rule or a ring group with no no-answer fallback.
   Then have the human place one real test call in and one out.

**Tell the client:** the number, what a caller hears, who rings in what order, where
voicemail lands, the E911 address on file, and the monthly recurring cost.

**File:** `pm_tasks_create` per device to provision, plus one per unresolved
`blocking_issues` item or failed healthcheck check.

---

## Recipe 2: Add a rep

**Goal:** the new hire can receive and place calls by end of day, rings with the team, and
shows the right caller ID.

**Preconditions:** the rep exists as a user; you know which team group they join and which
device they will use (desk phone, softphone, or PSTN forward to their cell).

**Steps:**

1. `voice_extensions_list` - pick the next free user extension (1001+) and match the
   account's naming convention for `display_name`.
2. `voice_extension_create` [CONFIRM - a live SIP endpoint, dialable immediately]. For a
   cell-phone forward, the external-number wiring has its own field coupling - read
   `references/pbx-routing.md` before the save rather than guessing.
3. Read back `voice_extensions_list` - the orphan check (create provisions the PBX first).
4. Ring group: `voice_ring_group_get` on the team group FIRST (the member list read), then
   `voice_ring_group_update` adding the rep [CONFIRM - echo the full resulting member
   roster; member updates have replace semantics and an empty list rings NOBODY - depth in
   `references/pbx-routing.md`]. Read back `voice_ring_group_get`: the roster, and the
   `warning` field / `fusionpbx_group_uuid` null trap - a 200 here does not mean the phones
   agreed.
5. Caller ID: decide what the seat presents on outbound calls (`voice_extension_update`
   carries the outbound caller-ID fields) [CONFIRM]. The resolution chain and the SMS
   sender question: `references/caller-id-and-reputation.md`.
6. Presence sanity: `voice_presence_get` after the device registers - remembering that
   `channels_ok: false` degrades every lamp and an empty list is never proof of idle.

**Tell the client:** the rep's extension, what they present when calling out, and that the
device itself is set up from the dashboard (the SIP password is shown exactly once).

**File:** `pm_tasks_create` "provision device for ext NNNN - dashboard only".

---

## Recipe 3: After-hours handling

**Goal:** callers at 8pm hear an after-hours path (voicemail, an emergency forward, or the
AI receptionist) instead of ringing an empty office.

**Preconditions:** business hours confirmed with the client in THEIR timezone;
`account_context_get({ domain: 'helpdesk' })` for the after-hours greeting copy.

**Steps:**

1. Read current state: `voice_ivr_walk` on the main IVR - it resolves `business_hours` and
   `after_hours` through the same resolver, and a `{ type: 'unknown', reason }` target is
   exactly the dangling option to fix. `voice_ring_groups_list` for the no-answer fallbacks.
2. Decide the after-hours target with the client: voicemail, a forward, or the AI agent.
3. Draft the after-hours greeting from the hydrated brand voice; show it verbatim.
4. `voice_ivr_update` setting hours and the after-hours target [CONFIRM - name the money:
   changed text re-renders paid TTS, and changing the VOICE id alone re-renders the entire
   menu at full price; the update is partial by design - OMIT `options` to keep the stored
   menu, because sending it replaces the menu - `references/pbx-routing.md`]. Read back
   `voice_ivr_walk`: the after-hours branch resolves, no `unknown` targets.
5. Ring-group fallback: `voice_ring_group_update` on the timeout target so an unanswered
   in-hours call reaches voicemail rather than dead air [CONFIRM]. Verify with
   `voice_tenant_healthcheck` - it has a dedicated check for DID ring groups without a
   fallback, whose missed calls hang up instead of reaching voicemail.

**Tell the client:** exactly what a caller hears at 2pm and at 8pm, in the greeting's own
words, and what it cost to render.

**File:** nothing usually; `pm_tasks_create` if the client wants recorded human audio
instead of TTS (a dashboard upload).

---

## Recipe 4: Missed-call text-back

**Goal:** a missed or abandoned call gets a text within seconds - the single biggest
recoverable-revenue automation in local services.

**Preconditions:** `voice_sms_registration_get` says `can_send: true` - a text-back from an
unregistered number gets carrier-filtered exactly when it matters (fix path:
`references/tendlc-and-toll-free.md`); the answering DID has `sms` in its features; the
wording is drafted from `account_context_get({ domain: 'helpdesk' })` and approved verbatim
- this text reaches a real customer seconds after they hang up.

**Two lanes - pick one, never both** (both firing doubles the text):

**Lane A - the tenant autoresponder (simplest, one setting):**

1. `voice_settings_get` - read the current `missed_call_autoresponder_enabled` and
   `missed_call_autoresponder_body`.
2. Show the exact body; get the yes.
3. `voice_settings_update` with the two autoresponder keys [CONFIRM - this is a live
   guardrail row; send ONLY the keys you mean to change]. Read back `voice_settings_get` -
   the update's response select omits some written keys, so the read-back is the truth.

**Lane B - the workflow (when you need filters, delays, or CRM writes):**

1. `voiceMissedCallTrigger` into an `sms` node - build it with the `workflow_` tools, with
   filters on direction and ring time so an internal test call does not text a teammate.
   Node shapes and payloads: `hiveku-automation-agency/references/node-rail.md`.
2. Dry run with `test_mode: true` and READ the `would_have` recipient and body before
   enabling [CONFIRM to enable]. A bare STOP reply never reaches `smsReceivedTrigger` - the
   opt-out is handled upstream; do not build a STOP branch.

**Read back / measure:** take the baseline first - `voice_calls_list` with
`disposition: 'missed'` and `'abandoned'` for the prior period (never `no_answer` - silent
zero) - so next month's review can say what the text-back recovered.

**Tell the client:** when the text fires, the exact wording, that STOP is honoured
automatically and is not undoable by us, and that quiet hours do NOT apply to this rail.

**File:** `pm_tasks_create` if registration is the blocker, with the `blocking_reason`
verbatim.

---

## Recipe 5: Paid-ads call tracking from zero

**Goal:** visitors from ads see a tracking number, calls attribute to source/campaign, and
qualifying calls flow back to the ad platform as conversions.

**Preconditions:** a verified E911 address (the setup tool buys DIDs and is E911-gated); a
connected ad platform for the send-back; on a marketing-ads (PPC) key this whole recipe is
visible by name - see SKILL.md's profile table. The attribution VERDICT afterwards belongs
to the hiveku-conversion-tracking skill; this recipe makes the phone side work.

**Steps:**

1. Baseline: `voice_call_tracking_diagnose` - read the ORDERED `fix_first` list, and treat
   every `unknown` as not-a-pass.
2. Preview: `voice_call_tracking_setup` with `dry_run: true`. Read the per-step plan it
   returns - this is the draft the confirmation covers.
3. Wire it: `voice_call_tracking_setup` [CONFIRM - name the money out loud: `did_count` is
   the ONLY field that spends; it buys only the shortfall, at most 5 per run, and omitting
   it or sending 0 buys nothing]. Read back the per-step results - each step reports
   already_configured or done; success is never inferred from a bare 200.
4. Call handling on the pool (whisper, greeting, destination): `voice_pool_update`
   [CONFIRM]. Read back `voice_pool_get` (it also carries the `occupancy` block) - and treat
   the whisper/greeting block on either pool read with suspicion; it comes from a second read
   that can silently fail. Pool mechanics and sizing: `references/call-tracking-dni.md`.
5. Per-project config (which pages swap, consent):
   `voice_phone_tracking_config_get` then `voice_phone_tracking_config_set` [CONFIRM]. Two
   traps from the platform contract: the set is a FULL REPLACE (except consent mode), and the
   consent gate is baked into the site HTML - a consent change needs a site redeploy, not just
   this write.
6. Prove the swap ONCE: `voice_swap_test`, or `voice_call_tracking_live_probe` with
   `live_probe: true` - one of them, not both. Either one HOLDS a real tracking DID for the
   sticky window [CONFIRM before running; NEVER schedule either].
7. Re-run `voice_call_tracking_diagnose` - clean, with `fix_first` empty. After the first
   real calls land, read `voice_call_tracking_outbox` (filter `status: 'failed'` first) and
   follow `references/conversion-send-back.md` for the upload lane and the paid-ads call
   report.

**Tell the client:** tracked visitors see a swapped number while direct visitors and bots
see the printed one; calls now carry source and campaign; and which conversions upload,
under what policy.

**File:** `pm_tasks_create` for any `fix_first` item you cannot clear (a site redeploy, a
Google-side Import setting - both live outside this key).

---

## Recipe 6: The CallRail cutover

**Goal:** move a client off CallRail onto Hiveku call tracking with no attribution blackout
and no dead printed numbers - the swap bridge first, the port second, cancellation last.

**Preconditions:** the client's CallRail number inventory with each number's job (pool
number vs printed/ads number); CallRail account access for the LOA details and the final
export; the client's explicit approval to port. Porting depth and carrier-specific gotchas:
`references/porting.md`.

**Steps:**

1. Portability first, it is free: `voice_portability_check` on every CallRail number.
   Anything non-portable gets its own plan before you promise dates.
2. Stand up the Hiveku side BEFORE touching CallRail: run Recipe 5 so a working pool
   exists. Tracking must never go dark mid-cutover.
3. The bridge - the cutover trick: `voice_phone_tracking_config_get` first, then
   `voice_phone_tracking_config_set` with the FULL config plus `swap_source_numbers` listing
   the CallRail numbers printed in the site HTML (up to 5) [CONFIRM - the set is a
   FULL REPLACE: resend every field from the GET, or the selector, regex and widget fields
   are wiped mid-cutover; Recipe 5 step 5]. The snippet now swaps the OLD CallRail
   numbers out for pool DIDs, so attribution continues while the numbers still belong to
   CallRail. Then remove the CallRail JS from the site through the code lane and deploy -
   two trackers on one page double-swap and fight.
4. File the port: `voice_port_order_create` [CONFIRM - this files legal paperwork with the
   carrier; billing name, address and signer must match the losing account EXACTLY; the PIN
   and account number are write-only]. Tell the
   client: keep CallRail service ACTIVE until the port completes - cancelling early kills
   the port.
5. LOA and bill copy: `voice_port_order_share_link_create` and send the link to the client
   to e-sign and upload. The URL is a CREDENTIAL - deliver it directly to the signer, never
   into a shared surface.
6. Before confirming: `voice_port_order_requirements` - every row `met`. An EMPTY list on a
   draft order means the carrier was never asked, not "nothing needed". Then
   `voice_port_order_action` with `confirm` [CONFIRM - this is the legal act under the LOA].
   Depth on actions and statuses: `references/porting.md`.
7. Track to FOC: `voice_port_orders_list` / `voice_port_order_get` (both LIVE; the response
   is customer PII and porting paperwork - never client-visible verbatim). Exceptions are
   worked through `voice_port_order_comments_list` and `voice_port_order_comment_add`
   [never paste a PIN into a comment; the carrier's porting ops read them].
8. Adoption day (the numbers are now Hiveku DIDs): assign E911 to each local number, set
   routing with `voice_number_update`, re-check CNAM, assign texting numbers to the 10DLC
   campaign with `voice_sms_number_assign_campaign`, and add the ported tracking numbers to
   the pool with `voice_pool_numbers_add`.
   Then retire the bridge: `voice_phone_tracking_config_get`, then
   `voice_phone_tracking_config_set` with the full config and `swap_source_numbers: []` - a
   bare set clears the selector, regex and widget fields too.
9. Verify the books: `voice_calls_export_csv` for the cutover window (bounded `from`/`to`)
   diffed against the final CallRail export. Only after the numbers ring on Hiveku and the
   diff reconciles does the client cancel CallRail.

**Tell the client:** the FOC date drives everything; no downtime is expected on the numbers
themselves; attribution continues through the bridge the whole time; cancel CallRail LAST.

**File:** `pm_tasks_create` per milestone (portability verdict, LOA signed, confirm filed,
FOC date, adoption done, CallRail cancelled) so a multi-week process cannot stall silently.

---

## Recipe 7: SEO-agency client texting from zero

**Goal:** a client account that has never texted becomes compliantly sendable - brand,
campaign, verified number - without the agency ever guessing at the client's legal identity.

**Preconditions:** `voice_sms_registration_get` read first - key on `can_send` and
`blocking_reason` rather than re-deriving the rule; a decision between the 10DLC lane
(local numbers) and the toll-free verification lane; the full saga, fees and truth table:
`references/tendlc-and-toll-free.md`.

**Steps:**

1. Verdict: `voice_sms_registration_get`. If `can_send` is already true, skip to step 7.
2. The brand is the client's LEGAL identity (EIN, legal name, address). Two ways to file:
   - The agency files it: collect the exact values from the client in writing, then
     `voice_sms_brand_submit` [CONFIRM - an irreversible, fee-bearing filing of a real
     company's identity with the carriers; a wrong EIN comes back FAILED and refiling is a
     new fee. This is a human decision, right first time].
   - The client files it themselves: `voice_sms_registration_share_link_create`, and hand
     the link DIRECTLY to the client - the URL is a credential that lets a logged-out party
     file the account's EIN and fee-bearing campaigns. It is shown once.
   On a FAILED brand, `voice_sms_brand_feedback_get` names the exact refused fields -
   `feedback: null` means no failure snapshot, not healthy.
3. Draft the campaign: `voice_sms_campaign_draft` (text only, files nothing; requires the
   brand VERIFIED). Check the use case MATCHES what the website actually shows - a
   customer-care campaign on a site with no support surface is a rejection.
4. Preflight, always, before any filing: `voice_sms_cta_preflight` on the message flow. It
   fetches the opt-in page with NO JavaScript, exactly like the reviewer's crawler - a CTA
   rendered client-side passes in a browser and fails here, the single most common
   rejection. Fix the page first (file the page work to the web team with
   `pm_tasks_create`; the opt-in content requirements are in
   `references/tendlc-and-toll-free.md`).
5. File it: `voice_sms_campaign_submit` [CONFIRM - name the money: roughly $15 per fresh
   submit, no withdrawal]. A response with a non-null submission error means the row SAVED
   but the carriers never saw it - fix and re-file THAT row with `voice_sms_campaign_resubmit`
   (a full replace, not a patch; omitting a field clears it), never a second fresh submit.
6. Monitor: `voice_sms_registration_get` until the campaign is ACTIVE and provisioned;
   `voice_sms_campaign_carriers_get` for the per-carrier verdict (it takes the HIVEKU
   campaign UUID - the Telnyx id 404s). Acceptance at the registry is not sendability, and
   propagation takes 24-72h; do not report "done" at TCR-accepted.
7. Assign the number: `voice_sms_number_assign_campaign` [CONFIRM - carrier paperwork, and
   this one takes the REGISTRY id (`telnyx_campaign_id`), inverted from the previous tool].
   Automatic when the account has exactly one campaign.
8. Prove it: one test text to the CLIENT'S OWN phone [CONFIRM the draft], confirmed from a
   read-back with `voice_sms_thread_messages_list` passing `mark_read: 'false'` - never
   from the send's 200. Then the day-to-day rails: `references/sms-operations.md`.

**Tell the client:** the fees and review windows up front; what STOP does and that it is
not undoable; and which number their customers will see texts from.

**File:** `pm_tasks_create` for the opt-in page fixes and for the go-live announcement to
whoever answers the shared inbox.

---

## Recipe 8: Quarterly phone hygiene

**Goal:** a standing per-quarter sweep that catches rot before a customer does - dangling
routes, unregistered E911, spam-labelled caller ID, silent registration lapses, voicemail
backlog. Read-heavy; every fix it proposes is its own confirmed write.

**Steps:**

1. The two diagnostics, side by side: `voice_diagnose_setup` (Hiveku's rows) and
   `voice_tenant_healthcheck` (the only PBX-side view; mind its one-element short-circuit -
   `references/pbx-routing.md`).
2. E911 audit: `voice_numbers_list` against `voice_e911_addresses_list`, SUBTRACTING
   toll-free numbers (800/833/844/855/866/877/888 - E911-exempt, and they inflate the
   diagnostic's missing-E911 count). Report a blocker only for local numbers.
3. Routing rot: `voice_ivr_walk` per IVR - every `{ type: 'unknown' }` target is a menu
   option sending callers nowhere. `voice_ring_group_get` per group - null
   `fusionpbx_group_uuid` means it cannot ring; empty member list rings nobody.
   `voice_queues_list` - null runtime uuid means the queue does not work; queues are not
   production-ready, so propose a ring group instead (`references/pbx-routing.md`).
4. Number inventory: `voice_numbers_list` for inactive or unrouted DIDs and what each
   costs. Candidates to retire go to the OWNER as a list - release is permanent and
   happens one confirmed number at a time, by digits, never in this sweep.
5. Reputation: `voice_number_get` per outward-facing DID for the CNAM fields; the
   spam-label remediation ladder is `references/caller-id-and-reputation.md`. A quarter is
   about the right cadence to re-check labels.
6. Spend guards: `voice_toll_fraud_state` (how close to the cap the account runs) and
   `voice_settings_get` (cap, recording retention, HIPAA mode - confirm they still match
   the client's intent).
7. Usage honesty: `voice_usage_get` - and report it honestly: in the current build only
   TTS spend is reliably written there; the minute counters are not evidence of call
   volume. Use `voice_calls_list` for real volume.
8. Voicemail backlog: `voice_voicemails_list` with `unread_only: 'true'` and
   `audio_urls: 'false'` - count and age only; NEVER flip read state during a sweep
   (`references/calls-voicemail-transcripts.md`).
9. Missed-call rate: `voice_calls_list` with `disposition: 'missed'` then `'abandoned'`
   for the quarter; an after-hours cluster is a routing fix (Recipe 3), a mid-day cluster
   is staffing.
10. SMS posture: `voice_sms_registration_get` (still `can_send`? campaigns still ACTIVE?),
    `voice_sms_templates_list` for stale wording (mind the NULLS-FIRST ordering trap -
    position 0 is not "most used"), and `voice_blocked_numbers_list` reviewed WITH the
    owner - rows have no author, and unblocking is the owner's call, never the sweep's.
11. Open ports: `voice_port_orders_list` for anything stuck in flight past its FOC date.

**Tell the client:** a short report - what is healthy, what rotted, what it costs monthly,
and the ranked fix list with which fixes need their yes.

**File:** one `pm_tasks_create` per finding with the tool evidence verbatim, and
`memory_create` for durable account facts the next quarter's sweep should start from.
