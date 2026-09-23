# Reference: PBX routing (extensions, ring groups, IVRs, queues, settings, blocklist)

This file is the routing layer: what happens between a DID receiving a call and a human (or the AI
receptionist, or a mailbox) answering it. Load it before creating or editing an extension, ring
group, IVR menu or queue, before touching tenant settings or the call blocklist, and for "the
phones aren't ringing", "callers land in the wrong menu", "make the main line ring everyone",
"add a phone for the new rep", "set up an after-hours greeting", or any diagnosis that starts at
the phone system rather than at a specific call. Buying, porting and E911 live in
`numbers-and-e911.md`; call history, voicemail and transcripts in
`calls-voicemail-transcripts.md`; DNI pools in `call-tracking-dni.md`; full end-to-end recipes in
`voice-playbooks.md`.

Two facts govern everything below. First, every write here reconfigures a phone system real
customers are calling RIGHT NOW - there are no drafts, no staging, and several deletes are
irreversible. Second, several of these tools spend real money (Cartesia TTS renders, PSTN forward
minutes) on calls that look like plain config saves. Money and irreversibility are called out
first for every tool, every time.

## Availability

Every routing tool below resolves on this server today. A name that does not resolve on your key
is a profile question first: check the key's profile, then the hiveku-communications reachability
ladder, then hand off with a precise dashboard step filed via `pm_tasks_create`. Never say the
capability does not exist, and never invent a name.

| Area | LIVE now | INCOMING | No tool - dashboard only |
|---|---|---|---|
| Diagnostics | `voice_diagnose_setup`, `voice_tenant_healthcheck`, `voice_presence_get`, `voice_extension_status`, `voice_audit_export_csv`, `voice_tenant_repair` | - | - |
| Extensions | `voice_extensions_list`, `voice_extension_get`, `voice_extension_create`, `voice_extension_update`, `voice_extension_delete` | - | device/handset provisioning (the SIP password exists exactly once, dashboard-side) |
| Ring groups | `voice_ring_groups_list`, `voice_ring_group_get`, `voice_ring_group_create`, `voice_ring_group_update`, `voice_ring_group_delete` | - | - |
| IVRs | `voice_ivrs_list`, `voice_ivr_walk`, `voice_ivr_create`, `voice_ivr_update`, `voice_ivr_delete`, `voice_default_greetings_get`, `voice_tts_voices_list`, `voice_ivrs_reprovision`, `voice_tts_preview` | - | - |
| Queues | `voice_queues_list`, `voice_queue_get`, `voice_queue_create`, `voice_queue_update`, `voice_queue_delete` | - | queue-agent state reset (no path anywhere - see section 6) |
| AI receptionist | `voice_ai_agent_config_get`, `voice_ai_agent_config_update` (and as a routing target) | - | flipping `ai_agent_enabled` (no API path at all) |
| Settings | `voice_settings_get`, `voice_settings_update` | - | `hipaa_mode` (accepted then silently dropped for every API key) |
| Blocklist / caps | `voice_blocked_numbers_list`, `voice_blocked_numbers_add`, `voice_blocked_numbers_remove`, `voice_toll_fraud_state` | - | - |
| DID routing | `voice_number_update` | - | - |
| Webhooks | `voice_webhooks_list`, `voice_webhook_create`, `voice_webhook_update`, `voice_webhook_delete` | - | - |

Legend: LIVE now = resolves on this server today. INCOMING = declared by the MCP server but not
yet in this plugin's tool index - the column is empty because nothing in this file is INCOMING
today; a name that appears there later flips to LIVE at release. Dashboard only = no tool at any
layer.

One profile note that applies to every write in this file: the Olympus twins deliberately do NOT
enforce the dashboard's per-user voice permissions - the API key is the only gate. And because a
service key has no builder profile, most of these writes leave NO row on the voice audit page
(section 2 covers what `voice_audit_export_csv` can and cannot prove). Tell a human exactly what
you changed, every time, because the system will not record that you changed it.

---

## 1. The mental model

**A DID points at one inbound target, and a forward beats it.** `voice_numbers.inbound_target_type` +
`inbound_target_id` name the target: `extension`, `ring_group`, `ivr`, `queue`, `ai_agent` or
`voicemail`. A PSTN forward (`forward_to_e164`) is a SEPARATE column that can be set at the same
time, and when it is set the call router forwards every call and never looks at the target, the
geo rules or the pool's routing. So re-pointing a forwarded number means clearing the forward in
the same save: `voice_number_update` with `forward_to_e164: null` plus the new target. Setting a
target alone leaves the number forwarding. `voice_number_update` is the tool that re-points it,
and every routing path in this system - a DID, an IVR menu digit, a ring-group fallback -
ultimately resolves its target down to a numeric extension string. An object with no dial
extension is unreachable no matter how configured it looks.

**Two systems, one truth split between them.** The builder (Postgres) holds the rows;
`voice_server` runs FreeSWITCH/FusionPBX on a shared EC2 box and holds the dialplan that actually
routes calls. Almost every write here saves the row and then pushes to the PBX (or the reverse),
and the push can fail independently, so the recurring failure shape in this file is a clean 200
whose row and dialplan now disagree. `voice_tenant_healthcheck` is the only tool that can see
both sides at once.

**Dialplan rules live in the database; rendered audio lives on box disk.** IVR and ring-group
dialplan rules are rows in the FusionPBX database and survive a box rebuild. The MP3s Cartesia
rendered for greetings and announcements are files on the box filesystem and do NOT survive one,
and no automatic S3-to-disk restore path exists - a rebuilt box serves menus whose rules fire
perfectly into silence. The `ivr_audio_files_exist_on_disk` healthcheck exists precisely because
this happened in production: rules green, audio gone, callers heard nothing.

**The extension pools - and nothing cross-checks the one number you pick yourself:**

| Range | What lives there | Who allocates |
|---|---|---|
| 1001 and up | user extensions (seats, softphones, external-number forwards) | you pick; unique per account, 2-6 digits |
| 5000-5999 | ACD queues | auto-allocated by `voice_queue_create` |
| 6000-6999 | IVR menus | auto-allocated by `voice_ivr_create` |
| 7xxx | ring groups, BY CONVENTION ONLY | you pick, and NOTHING validates it |
| 8001-8999 | auto-managed personal ring groups | the system |

`voice_ring_group_create`'s own description is blunt about the 7xxx row: the extension "is not
allocated and it is not compared against the IVR 6000-6999 pool, the queue 5000-5999 pool, user
extensions from 1001 up, or the 8001-8999 personal ring-group pool. Two dialplan rules matching
the same digits are resolved by order, silently, which is how a live misroute happens." Always
sweep `voice_extensions_list`, `voice_ring_groups_list`, `voice_ivrs_list` and
`voice_queues_list` for the number before picking one.

**Personal ring groups are real and invisible.** Any user with two or more registering endpoints
gets an auto-managed personal ring group in the 8001-8999 pool so all their phones ring together.
The dashboard's ring-group editor deliberately hides them; `voice_ring_group_get` and
`voice_ring_groups_list` show them (`is_personal` / `personal_user_id`). They are reconciled
best-effort whenever an extension is created, re-owned or deleted - and "best-effort" means a
failed reconcile is invisible in the response. They also block extension deletes (section 3).

**Time conditions exist in exactly one place: IVR `business_hours`.** No ring group, queue or DID
carries a schedule. And even the IVR's schedule over-promises: the builder stores per-day
open/close windows, but the provisioner emits ONE FreeSWITCH time-of-day window shared across
every open day, silently keeping the first open day's window when they differ. Per-day hours that
differ are narrated by the tools and NOT enforced on the phone. Every save that submits differing
windows returns a `warning` naming the day whose window now applies to all of them - read it.

**The audit hole.** Voice mutations log through a helper that skips the row entirely when the
actor has no builder profile - which is every API key. So creates, edits and deletes made through
these tools leave no entry on the voice audit page and no attributable actor. This is why the
confirmation discipline is strict: the human's explicit yes in the conversation is the only
record that the change was authorized.

---

## 2. The diagnose ladder

Run these in order when the complaint is system-shaped ("phones aren't ringing", "is it set up?").
Each rung sees something the previous one cannot.

**Rung 1 - `voice_diagnose_setup`.** Counts Hiveku rows only: `tenant_provisioned`, active DIDs,
DIDs missing E911, extension / ring group / IVR / verified-E911 counts, plus a `blocking_issues`
array of human-readable problems. Surface `blocking_issues` close to verbatim - EXCEPT the E911
string: `dids_without_e911` has no toll-free filter, so compliant toll-free numbers inflate it
(the full correction lives in `numbers-and-e911.md`). This tool cannot see FusionPBX at all, so a
green result here proves only that the rows exist.

**Rung 2 - `voice_tenant_healthcheck`.** The per-tenant consistency battery, comparing Hiveku's
rows against what is actually in FusionPBX - the only tool that can see the PBX side. Twenty-one
named checks (`dids_have_resolvable_targets`, `ring_groups_have_dialplan_rule`,
`ivr_audio_files_exist_on_disk`, `did_ring_groups_have_fallback`, `routed_dids_have_inbound_rules`
and more), each with a human-readable `detail` naming the offending numbers or extensions. DB-only
by contract: safe to poll, places no call, spends nothing - and REPAIRS NOTHING; a red row stays
red until a human acts (or `voice_tenant_repair`, below, once it resolves).

THE ONE-ELEMENT SHORT-CIRCUIT, read before reporting: if either database pool is closed you get
ONLY `db_pools_open` with `ok: false`; if the account has no `voice_tenant_config` row you get
ONLY `tenant_config_present` with `ok: false`. A one-element `checks` array means NOTHING ELSE
WAS INSPECTED - never "one problem out of twenty-one", and never "the other twenty are healthy".
Also: a 503 `voice_server_error` means the diagnostic service is down, which is NOT evidence the
tenant is broken.

**Rung 3 - `voice_presence_get`.** Live BLF lamp state: who is registered, who is on a call, with
which far party. Treat the payload as PII. THE SILENT FAILURE SHAPE:
`{ extensions: [], channels_ok: false }` is returned when the tenant was never provisioned, when
the voice_server call threw and was swallowed, AND when a genuinely idle account has channel
state down - the route emits no 5xx, so an empty list must NEVER be read as "nobody is on a
call". When `channels_ok` is false but the list is non-empty, every lamp degrades to
registered/offline and `ringing` / `in_call` / `hold` can never appear no matter what is really
happening. Two more legitimate absences: this twin unconditionally filters out extensions owned
by a `saas_owner` or `saas_user`, and PBX registrations with no matching `voice_extensions` row
are dropped silently - so an extension `voice_extensions_list` shows can be absent here without
anything being wrong.

**Rung 4 - one extension: `voice_extension_status` vs `voice_extension_get`.** Prefer
`voice_extension_status` for lookups: it has NO plan gate, accepts the dial number (`'1003'`) as
well as the UUID, answers `200 { data: { found: false } }` instead of 404, and DOES return
`external_target_e164`. Use `voice_extension_get` only when you specifically need
`e911_address_id` (which `voice_extension_status` omits) or a hard 404 to confirm an id. Neither
returns SIP credentials, ever.

**The last rung - `voice_audit_export_csv` - proves less than it looks like.** It exports every
`voice.`-prefixed audit row as inline CSV (10,000 cap, newest first, so the OLDEST events vanish
quietly). But work done through these tools is largely ABSENT: API-key writes skip the audit row,
and several twins never call the helper at all. What you get is essentially the dashboard's human
actions. Traps its description spells out: `action` REPLACES the prefix filter with an exact
match, so a partial suffix returns the bare header, indistinguishable from an empty trail; `to`
is NOT bumped to end of day (pass a full timestamp or lose the whole last day); a non-UUID
`actor` or unparsable date 500s rather than returning empty; system-actor rows come back with
both `actor_name` and `actor_id` empty. It discloses staff PII - do not paste it into anything
client-visible.

**`voice_tenant_repair` - LAST RESORT, after `voice_tenant_healthcheck` names the
problem.** This is the tenant-level big hammer. It collapses duplicate FusionPBX domain rows,
repairs extensions missing their user context, REWRITES the tenant's outbound dialplan rule with
one DID baked in as the tenant-wide fallback caller ID (the `main`-purpose DID, else the oldest
active one), and RETARGETS EVERY active DID's inbound route to this tenant. Refusals: 409
`not_provisioned` with no tenant; 409 `no_caller_id_did` when the account has no active DID -
outbound would fail at the carrier anyway, so it refuses rather than half-repairing. It is
idempotent and it does fix the classic red rows (duplicate domains, missing outbound rule), but
it is a wholesale rewrite of live routing: run `voice_tenant_healthcheck` first, name the red
rows to the human, and get an explicit yes before firing it. Never run it speculatively, and
never as step one of a diagnosis.

---

## 3. Extensions

An extension is a REAL SIP endpoint: a seat phone, a softphone, or a PSTN forward
(`endpoint_type` `external_number`). Everything here is live from the moment it returns.

### `voice_extension_create` - the order can orphan

Provisions the endpoint ON THE PBX FIRST and then writes the row. No carrier order, no money -
but a failed insert leaves a live SIP endpoint with no builder row and an UNRECOVERABLE password
(the phone system returns the SIP password exactly once, it is encrypted before the insert, and
it appears nowhere in the response - device setup is dashboard-only, always).

**The 409 can name the wrong constraint.** The table carries three unique constraints, and the
handler returns `extension_taken` for any collision whose reported target contains the substring
`'extension'` - which the per-account `sip_username` constraint and the one-endpoint-per
(user, endpoint_type, device) constraint BOTH do. So a second `softphone_mobile` for the same
person surfaces either as "Extension 1005 is already in use on this account" or as a bare 500
`internal_error`. Its own description's verdict: "Neither message is the truth, and both leave
the PBX endpoint behind. Check voice_extensions_list before retrying." Do exactly that - never
blind-retry a failed create.

**Silent 200s to expect, each verified in the description:**

- `endpoint_type: 'external_number'` with no `external_target_e164` is ACCEPTED on create and
  builds a black hole: the call router finds no target and the caller hears nothing. The update
  twin refuses that combination (`422 forward_target_required`); the create does not. ALWAYS send
  both in the same save.
- `external_target_e164` is silently discarded unless `endpoint_type` is exactly
  `'external_number'`.
- `e911_address_id` on an extension is a LABEL. It is stored with no ownership or verification
  check, no carrier call is made, and nothing in the phone system reads an extension's
  `e911_address_id` - every emergency path keys on the DID's `e911_address_id`, where the hard
  gate lives (`numbers-and-e911.md`). Never present it as an emergency registration.
- The personal-ring-group reconcile (what makes the owner's other phones ring the new endpoint)
  is best-effort and the create response has NO warning field, so a failed reconcile is
  invisible. Confirm with `voice_ring_groups_list`.

`phone_model` and `mac_address` are deliberately not settable here (or on update, which answers
`422 use_phone_route`): the route would persist them without ever pushing them to the phone
system, badging a desk phone as provisioned while the handset's boot request is served nothing.
Refusal vocabulary worth knowing: 409 `not_provisioned` means voice was never enabled for this
tenant (not a server fault); 403 `not_a_member` when `user_id` is not a member of THIS account;
402 carries either `voice_not_enabled` or `account_past_due` - read the error key, not the
status.

### `voice_extension_update` - ALWAYS read `warning`

The row is saved locally FIRST and every push to the phone system afterwards is best-effort. A
200 carrying a `warning` means the database and the PBX now disagree - about the display name,
ring timeout, voicemail toggle or PIN, caller ID, greeting audio, or which phones ring.
Re-saving is the retry.

**It spends money and reaches callers.** Once the row has `voicemail_greeting_source: 'tts'` plus
greeting text plus a voice id - from this patch or already stored - the audio renders through
Cartesia, billed per character into the tenant's TTS ledger, and callers hear it as soon as it
lands. An unchanged text hash is a cache hit and costs nothing.

**Caller ID is carrier-facing** - it changes what the called party sees on EVERY future outbound
call from this seat. `outbound_caller_id_number_id` must be an active DID owned by this account
(`422 invalid_caller_id`); a toll-free DID is refused (`422 toll_free_caller_id`) because a 911
call would present a number with no dispatchable address - but that test only recognizes NANP +1
8xx, so a non-US toll-free is not caught. `outbound_caller_id_anonymous: true` presents Blocked,
WINS over the number id, and - the sharp edge - SKIPS the ownership branch entirely: a number id
sent alongside it is written with no account check (another tenant's DID id lands on your row),
and an id matching no row trips the foreign key in an uncaught update, dying as a 500 with
nothing saved. Never send both together.

**The six silent no-ops, every one a clean 200** (from its registered description):

1. A caller-ID-only save on a never-provisioned extension (no FusionPBX uuid) returns clean,
   pushes nothing, and adds NO warning.
2. `ring_timeout_seconds: null` and `voicemail_pin: null` are written to the database but
   excluded from the push - FreeSWITCH keeps the old timeout, the mailbox keeps its old PIN.
3. Clearing `voicemail_greeting_source` to null nulls the pointers but deliberately does NOT
   delete the rendered greeting from FreeSWITCH - callers keep hearing a greeting the UI now
   reports as gone.
4. `'tts'` mode without BOTH text and voice, or `'upload'` with no key ever uploaded, renders
   nothing (warning only).
5. `voicemail_transcribe`, `voicemail_email_on_receipt`, `voicemail_email_to` are database-only
   here, read later by the voicemail ingest, never by the PBX.
6. `e911_address_id` - same label-not-registration rule as create.

The response is a narrow select that never echoes `external_target_e164`, ring timeout, any
voicemail field or the greeting state, so you CANNOT confirm those from the reply - read them
back with `voice_extensions_list`, which returns the whole row. Changing `endpoint_type` or
`user_id` rewrites the personal ring group for the old AND new owner (literally which phones
ring), and a failure there is only a warning. Switching AWAY from `external_number` clears the
stored forward target on purpose, so a stale number cannot go live later.

### `voice_extension_get` vs `voice_extensions_list` - the narrow select trap

`voice_extension_get` returns a NARROW row: no `external_target_e164`, no ring timeout, no
voicemail fields, no outbound caller-ID columns, no `fusionpbx_extension_uuid`. It can never tell
you where a PSTN-forward extension rings, whether voicemail is on, what callers hear, or what
number the seat presents - and an extension that was never provisioned to the phone system (and
so cannot register at all) looks IDENTICAL to a healthy one here. `presence_state` is the stored
column, not a live probe: `offline` may just be stale. `voice_extensions_list` returns the whole
row and is the read for all of those. Rule of thumb: `voice_extension_status` to look up,
`voice_extensions_list` to verify a write, `voice_extension_get` only for `e911_address_id` or a
hard 404.

### `voice_extension_delete` - irreversible; walk the trees first

This takes a phone offline permanently. The stored SIP password dies with the row, so the device
can NEVER register again - recovery means a new extension plus dashboard re-provisioning of the
handset, which no tool can do. Confirm with a human, by extension number and owner name, before
calling.

**The guard is narrower than it looks.** It refuses with `409 extension_in_use`, naming the
blockers, while any NUMBER routes to the extension (or its voicemail) or any RING GROUP lists it
as a member. It does NOT check IVR menu digits, ring-group no-answer fallbacks, or queues - a
phone-tree digit pointing here is silently orphaned, and `voice_ivr_walk` will afterwards show
that option as `resolved.type: 'unknown'` while the menu still answers 200. So BEFORE deleting:
run `voice_ivr_walk` on every IVR (menu digits AND `after_hours`), check every ring group's
timeout target with `voice_ring_group_get`, and check queue rosters with `voice_queues_list`.

**The 409 you will most likely hit is invisible in the dashboard:** the owner's auto-managed
PERSONAL ring group (hidden by the editor) lists this extension as a member and blocks the
delete. It appears in the message as `<Person> (personal) (8001)`. Thin or re-point it first.

**Partial teardown on failure:** the AI receptionist's transfer config is pruned FIRST - this
extension is removed from `transfer_directory` and `human_transfer_extension` - and that prune is
NEVER rolled back. If the PBX then refuses (502 or 422 `delete_failed`), the extension still
exists and still rings, but the AI can no longer transfer callers to it, and nothing in the
response says so. Re-run the delete, or re-add the transfer target. Voicemail gets no
preservation: a DID pointed straight at this extension's voicemail blocks the delete rather than
being re-pointed - re-point that DID yourself first with `voice_number_update`.
`upstream_cleaned: false` in the success response means the row had never reached the PBX (local
delete only); `true` means the phone system confirmed teardown. A 404 means it was already gone -
not retryable.

---

## 4. Ring groups

A ring group makes a set of extensions ring for one call. It is the dependable "make the main
line ring everyone" object, and - because queues are not production-ready (section 6) - the
default answer for team ringing.

**Reading them.** `voice_ring_groups_list` is the sweep; `voice_ring_group_get` is the only read
that returns member rows (with `extension_id` UUIDs, not dial numbers - join against
`voice_extensions_list` to say who actually rings). READ THE TWO NULLS on every get:
`fusionpbx_group_uuid` null means the group exists only in Postgres and CANNOT ring anyone no
matter how correct the row looks - and an edit to it will report a clean 200 while changing
nothing; `extension` null means nothing can dial or transfer to it, and it is disqualified from
being another group's fallback. `rr_cursor` is the persistent round-robin pointer only the voice
server increments. On strategy generally: treat simultaneous ring as the dependable choice; the
queue implementation's own notes warn that ring-group `round_robin` and weighted orderings
quietly degrade (queues are where mod_callcenter natively implements each strategy - and queues
are not ready). Per-member `timeout_seconds` is stored and displayed but NEVER reaches
FreeSWITCH from these tools - every push sends each leg the group-level `ring_seconds`; only
`delay_seconds` survives per member.

### `voice_ring_group_create` - the extension is yours to pick, and the guard fires too late

No TTS, no carrier spend on the call itself - with one money edge: `timeout_target_type`
`'external_number'` forwards every unanswered call out to the PSTN through the carrier, billing
real minutes on each one, subject to the toll-fraud cap (section 9). It provisions the PBX FIRST,
then writes the rows: on success, dialling the group's extension immediately rings real phones.

The `extension` (2-6 digits, 7xxx by convention) is yours to supply and NOTHING cross-checks it
against the other pools (section 1). The only real guard is the unique index on
(account, extension), and it fires AFTER the PBX provision: a duplicate is NOT a 409 - it falls
through as a 500 `internal_error` with the FusionPBX group ALREADY CREATED and no Hiveku row to
manage it. Pick a free number with `voice_extensions_list` and `voice_ring_groups_list` first,
and if you do hit that 500, tell a human a PBX-side orphan now exists (the dashboard repair or
`voice_tenant_repair` territory - do not create again at the same number).

The fallback is hard-validated ON PURPOSE: `422 timeout_target_id_required`,
`timeout_target_not_found` (also the answer for a non-UUID id, and for a target row with a NULL
extension), `timeout_target_external_e164_required`. A group saved with a fallback type and no
resolvable target would render as configured while FreeSWITCH has no post-bridge action - callers
who ring out would hear silence and get hung up on. `422 members_not_found` names extension ids
not on this account. The schema is STRICT: an unknown or renamed key is rejected, never dropped.

### `voice_ring_group_update` - two wholesale exceptions and three quiet 200s

Commits the rows first, then pushes; the phones that ring for real calls change immediately.
Partial by design - omitted fields are left alone - with TWO WHOLESALE EXCEPTIONS:

- **`member_extension_ids` REPLACES the entire membership.** An empty array is accepted and drops
  every member, leaving a live group that RINGS NOBODY. Adding one person means sending the FULL
  list: read `voice_ring_group_get` first, append, send everyone.
- **`ring_seconds` alone re-pushes every member** and overwrites each member row's
  `timeout_seconds`, because the live dialstring is built from those rows.

Two ways this answers 200 having changed no phone: a group with no `fusionpbx_group_uuid` updates
Postgres, SKIPS FreeSWITCH entirely, and returns clean with NO warning at all (check that field
with `voice_ring_group_get` before trusting a save); a voice_server failure is a SOFT warning on
a 200 - the DB committed, the dialplan is one edit behind, and `warning` says so. And the third
thing nothing tells you: per-member `timeout_seconds` is persisted, displayed, and never sent
(above).

The fallback validates from EFFECTIVE values (sent field, else stored) whenever ANY of the three
timeout fields is present - so `timeout_target_id` alone is fully validated - while a name-only
save deliberately does not re-validate stored timeout state (a legacy broken target cannot block
a rename). `timeout_target_type: null` clears the fallback. `422 timeout_target_self` exists
because a group falling back to itself ring-loops until the caller or the carrier gives up.

### `voice_ring_group_delete` - the safest-ordered of the three routing deletes

Still PERMANENT: the FusionPBX group, member destinations and dialplan rule are torn down, the
row is deleted, members cascade, the freed extension can be claimed by something else. But the
ORDER is right: teardown runs FIRST and a failure returns `502 ring_group_teardown_failed` having
deleted NOTHING - a failed call here is safe to retry. (The IVR and queue deletes behave
differently and delete the row anyway - sections 5 and 6.) It also REFUSES rather than orphaning:
`409 ring_group_in_use` while a number routes to it, another group falls back to it, an IVR digit
or after-hours target points at it, or a queue overflows to it - the message names each blocker.

What it does NOT check, verbatim from its description: only `voice_numbers`,
`voice_ring_groups`, `voice_ivrs` and `voice_queues` are queried. A call-tracking DID pool whose
`inbound_target_id` is this group, and a pending carrier order that will adopt into it, both pass
the guard and are silently orphaned - including every number that joins that pool later. Check
`voice_pools_list` (see `call-tracking-dni.md`) and pending orders before any routing delete.

---

## 5. IVRs

An IVR is the auto-attendant: greeting, digit menu, optional business hours with an after-hours
branch. It is also the ONE object family here where an ordinary save SPENDS MONEY: every create
or update that changes prompt text or voice renders audio through Cartesia, a paid TTS vendor,
billed per render into the tenant's TTS ledger. Unchanged text+voice is a hash cache hit and
free. Say the cost out loud before any IVR write.

### `voice_ivr_walk` - the read that makes tree surgery safe

Reads one IVR with every menu target pre-resolved ONE level deep: extensions carry number and
display name, ring groups carry strategy plus the full member roster in ring order, sub-IVRs are
a stub (it does NOT recurse), `ai_agent` carries only the account-wide `ai_agent_enabled` flag,
and `after_hours` runs through the same resolver. Read it before deleting anything an IVR might
point at, and before narrating "the menu works".

Its honesty limits, each from its own description:

- **A deleted or missing target does NOT error** - it becomes `{ type: 'unknown', reason }`, so a
  tree whose every option points at a deleted extension still answers 200 and looks healthy at a
  glance. Read every `resolved.type` before reporting the menu healthy. An unsupported
  `target_type` also comes back `unknown` - that means the walk cannot name it, not that the menu
  is broken.
- **Nothing in the response reports `fusionpbx_ivr_uuid`**, so a tree that reads perfectly here
  may never have been loaded onto the PBX and may route ZERO live calls. Confirm provisioning
  with `voice_diagnose_setup` and the `provisioned_ivrs_have_dialplan_rule` /
  `ivr_audio_files_exist_on_disk` healthchecks.
- **Business hours are the softest field.** `business_hours` reads non-null for ANY object in the
  column, but only the canonical `{timezone, schedule}` shape is actually parsed - a row stored
  in another shape reports `timezone: null`, `schedule: {}` and still looks configured.
  `is_open_now: null` means UNKNOWN, never closed. And even a well-formed schedule over-promises:
  one shared window on the phone, differing per-day hours narrated but not enforced (section 1).
- Only single-character `[0-9*#]` keys survive - a stored `default` fallback key or
  multi-character key is absent from `options` entirely, so that branch is invisible here.
- `greeting.voice_id` NEVER comes back null (hardcoded Cartesia default fallback), so a non-null
  voice is not evidence anyone chose one; `greeting.rendered: false` means the text was never
  synthesized. A voicemail option with a null target is the synthesized literal
  "Default voicemail", not a real mailbox lookup.

### `voice_ivr_create` - money, a pool, and four silent failures

Reserves a free 6000-6999 extension, inserts the row, then provisions: Cartesia renders the
greeting and every option announcement (real money, returned as `tts_cost_cents` and `renders`),
MP3s go to S3 AND the box filesystem, and live dialplan rules are installed. Any DID already
pointed at this IVR plays it to real callers from the moment it returns. Pool refusals: 409
`no_extension_available` (6000-6999 exhausted), 409 `extension_race` (concurrent create;
retryable - it re-scans).

The silent failures, none of which error:

- `greeting_tts_text` with no `greeting_voice_id` renders NOTHING - the menu answers callers with
  SILENCE and the save reports success. Same for every option's `announcement_tts_text`, which
  uses the IVR-level voice and never one of its own. Always send text and voice together.
- An option `target_id` that does not resolve in this account is NOT refused: it resolves to null
  and that digit is provisioned with no destination.
- The after-hours target is dropped the same way - leaving NO after-hours route at all - and the
  create sends NO department with it, so an after-hours `ai_agent` always lands on the generic
  receptionist even when the menu's daytime options route to a specialist.
- Differing per-day `business_hours` collapse to one shared window with a `warning` naming the
  winning day.

If FreeSWITCH provisioning fails you get 500/502 `ivr_provision_failed` WITH the saved row: the
IVR exists, the extension stays reserved, nothing answers. Fix it with `voice_ivr_update` - never
by creating a second one.

### `voice_ivr_update` - the expensive mistake, and `options` replaces

Re-provisions end to end on EVERY call, even a rename. The render hash is over TEXT PLUS VOICE,
so **changing `greeting_voice_id` alone invalidates the greeting AND every option announcement -
a one-field save re-renders the entire menu at full price.** Do not reshuffle voices casually
(`voice_tts_voices_list` below, and preview with `voice_tts_preview` once it resolves).

Partial by design, with the menu exception: omitting `options` keeps the stored menu; SENDING
`options` REPLACES the whole menu, so a digit you leave out of the array is DELETED. Read
`voice_ivr_walk` first, edit the full array, send it all. One deliberate refusal worth quoting:
`409 menu_option_unresolvable` fires on a save that OMITS `options` while a stored option's
target type is broken - it changes nothing and returns `invalid_digits`, and it exists because
"guessing 'disconnect' for a broken option once made it permanently a hang-up as a side effect of
renaming the IVR". Repair those digits by sending one full `options` array. The same
text-without-voice, unresolvable-target, dropped-after-hours and collapsed-hours silences as
create apply here; a voice_server failure returns the ALREADY-UPDATED row plus a warning, and
Postgres stays ahead of FreeSWITCH until a later save succeeds.

### `voice_ivr_delete` - the S3 audio dies too

PERMANENT, and not database-only: the dialplan rules are dropped AND the S3 audio objects are
DELETED - the greeting plus every announcement. Recreating the menu means paying Cartesia to
render every prompt again. The 6xxx extension returns to the pool.

It refuses rather than orphans - `409 ivr_in_use` names numbers, ring-group fallbacks, queue
overflows and OTHER IVRs pointing here (a self-referencing "press 9 to repeat" does not block its
own deletion) - with the same two blind spots as every routing delete: DID pools and pending
number orders are invisible to the guard and silently orphaned. THE WARNING IS A PARTIAL DELETE:
if voice_server does not confirm teardown, the Hiveku row is STILL deleted, so the dialplan rule
and audio can survive on the PBX for a menu Hiveku has forgotten. A 200 with a warning is not a
clean delete - report it, and expect the orphan to self-heal only if something re-provisions the
same extension.

### `voice_ivrs_reprovision` - push the stored config back onto the box

Rewrites LIVE dialplans: it re-runs the same provision path the edit routes use, against the rows
already in the database, changing no stored configuration - idempotent, and normally $0 in TTS
because unchanged text hash-matches. It exists because dialplan XML is only ever rewritten on an
edit, so a fixed provisioning bug leaves every already-installed IVR running the old, wrong XML
until someone presses Save. The concrete case: a weekday-numbering bug (builder stores 0=Sunday,
voice_server expected 0=Monday) shifted every pre-fix IVR's open days by one - Monday callers got
the after-hours branch. Scope: `ivr_ids` for an explicit list, or `scope: 'business_hours'`
(default - only the IVRs the weekday bug can affect) vs `'all'`. Non-destructive by
construction: it never invents a destination (an IVR with a non-canonical stored target type is
refused per-IVR, no provision call, not a byte written - the old dialplan keeps running), and
the write-back touches only the audio pointers on digits actually rendered. **The response is
207, not 200, the moment ANY IVR fails**, with a per-IVR `results` array and total
`tts_cost_cents` - read the failures individually; a 207 is a partial success, never "done". A
malformed JSON body is a hard 422, deliberately NOT collapsed into "reprovision everything".

### The two catalog reads

**`voice_default_greetings_get` returns SUGGESTIONS, not configuration.** Four pre-canned
greeting templates filled with the account's name. Nothing here reads what callers actually hear
today, and it returns the identical four strings whether or not any greeting exists. The trap:
the name is seeded from `accounts.name`, the internal workspace label, NOT `company_name` - an
account signed up as 'Psgi' produces "Thanks for calling Psgi." And when the name is empty,
`account_name` comes back `''` while the templates substitute "us" - read both fields. Check the
real trading name before writing any of these strings into a greeting, because they are read
ALOUD to callers once saved.

**`voice_tts_voices_list` - the one-entry outage shape.** The curated English Cartesia catalog.
Reading it is free; choosing a DIFFERENT voice for existing audio forces paid re-renders (the
update trap above). THE FAILURE THAT MATTERS: a ONE-ENTRY response named 'Default voice' is the
OUTAGE shape, not a one-voice catalog - voice_server returns exactly that when its Cartesia key
is unset or the call failed, as a normal 200, cached for five minutes with NO warning field.
Check the length and the description text before telling anyone the account has one voice. Two
independent caches (5 min per builder process, 1 hour on voice_server) mean consecutive calls can
disagree and a new voice takes about an hour to appear; the catalog is truncated at 100 and
filtered to English, so a voice seen at Cartesia may sit past the cap rather than be missing.

**`voice_tts_preview` - hear it before callers do.** Renders up to 500 chars in a
chosen voice and returns an `audio_url`. Money: a fresh render is a real Cartesia call (it
deliberately never lands on the tenant's TTS ledger - a UX feature, not a customer asset), and
identical text+voice re-previews are cached and free - so preview once, not in a loop. Handling:
`audio_url` is an UNAUTHENTICATED 5-minute presigned link; treat it like a recording URL - hand
it to the human to listen to, never paste it into a ticket, task, memory or log.

---

## 6. Queues - NOT production-ready. Say so first.

Lead with this whenever someone asks for a call queue: **the queue subsystem is not
production-ready, and the deepest defect has no reset path.** Agents drift to an On Break state
after three unanswered rings and NOTHING puts them back - no tool, no dashboard control, no cron.
A queue quietly loses its staff one no-answer at a time until nobody is rung and every caller
waits out `max_wait_sec`. On top of that: `sla_answer_seconds` and `callback_enabled` are
persisted and never sent to the phone system (decorative - no SLA is enforced, no callback is
offered), a member's `skills` never reach mod_callcenter, deleting an extension can orphan its
PBX-side agent rows, and provisioning failures have historically been swallowed behind 200s.
**Prefer a ring group** for team ringing; offer a queue only when the client explicitly needs
hold positions and accepts the caveats in writing.

**`voice_queues_list` - two nulls mean the queue does not work, and neither is an error.**
Everything comes back in one response (no pagination, no cap). `fusionpbx_queue_uuid: null`
means the queue was never loaded into FreeSWITCH and answers NOTHING (the dashboard shows a
'not provisioned' banner for exactly this state; the API shows only a null). `extension: null`
means no 5xxx dial number was allocated, and since every routing path resolves down to a numeric
extension, the queue is unreachable even when provisioned. Check BOTH before telling anyone
their queue is live. Member rows carry `extension_id` UUIDs with no dial number and no name -
join against `voice_extensions_list`. `moh_local_path: null` means callers hear the DEFAULT hold
music no matter what `moh_s3_key` says - a set key is not proof the branded clip plays; the
local path, written only from what the PBX reported placing, is the only proof.
`voice_queue_get` is the single-queue read with the same row plus members.

**`voice_queue_create`.** Auto-allocates from the 5000-5999 pool (409
`no_extension_available` when exhausted) and provisions BEFORE the local write - the correct
order, so a create that returns wrote what the PBX actually did. Queue strategies ARE the honest
mod_callcenter set (`longest_idle`, `round_robin`, `top_down`, `agent_with_least_talk_time`,
`random`, `ring_all`). Every member `extension_id` is ownership-checked (`422 invalid_member`).
Hold music: only an allowlisted, account-scoped S3 key is forwarded to the PBX; anything else -
an https URL included - is STORED but never sent, reported via `warning` as not live. Greeting
text without a voice is `422 greeting_voice_required`. Read the `warning` on every create: the
queue can be live while the clip the customer picked is not.

**`voice_queue_update` - wholesale replace, and the abandon target is not hard-validated.**
voice_server is called BEFORE the write and REPLACES the mod_callcenter queue, tiers and dialplan
rule wholesale on every save, including a pure rename; waiting callers are re-routed immediately.
A 200 does not mean the phone system agreed - a provisioning failure still saves the edit with
only a `warning`. Null rules differ per field: the abandon target, hold music and greeting fields
are read by KEY PRESENCE (null clears, omit keeps); other scalars fall back to stored. `members`
REPLACES the roster wholesale ([] leaves the queue with no agents). UNLIKE a ring-group fallback,
the abandon target is NOT hard-validated: a target not in this account, or one with a NULL
extension, resolves to nothing and the queue is provisioned with NO timeout action while the row
happily stores the target - the dashboard shows an overflow destination and callers who exhaust
`max_wait_sec` are DROPPED. Verify the target resolves before relying on it. Only `voicemail`,
`extension`, `ring_group`, `ivr` are accepted here. And one warning that can never clear no
matter how many times you retry: the entry-greeting "did not land ... Re-save to retry" - no
path in the product writes the greeting key the provisioner needs, so stop retrying and say so.

**`voice_queue_delete` - the warning is a partial delete, not a note.** PERMANENT; the 5xxx
extension returns to the pool. Teardown runs first but a failure is only REPORTED, never
aborted: the row is deleted regardless, and a live queue plus dialplan rule can survive on the
phone system for a queue Hiveku has forgotten - callers can still land in an unmanaged queue.
The warning says to run a tenant repair if calls still reach it, and that is literal. (Compare
`voice_ring_group_delete`, which aborts and deletes nothing.) It refuses with `409 queue_in_use`
only while a NUMBER routes here - the only dependency it queries, and the only pointer the
routing schema models for a queue - with the standard two blind spots: DID pools and pending
orders are silently orphaned.

---

## 7. The AI receptionist as a routing target

`ai_agent` is a first-class inbound target: a DID (`voice_number_update`), an IVR digit, or an
IVR after-hours branch can send callers to it. What routing tools can and cannot see:

- `voice_ivr_walk` resolves an `ai_agent` option to ONLY the account-wide `ai_agent_enabled`
  flag - routing to a disabled agent is visible there, but nothing about the agent's actual
  configuration is.
- **No tool flips `ai_agent_enabled`.** It is readable via `voice_settings_get` and deliberately
  absent from `voice_settings_update`'s write schema. Turning the receptionist on or off is a
  human dashboard action - file the task, never claim to have done it.
- **The after-hours department gap:** an IVR's after-hours `ai_agent` target is sent with NO
  department, so it always lands on the GENERIC receptionist, even when the daytime menu routes
  to a specialist. Set expectations accordingly.
- **Deleting an extension prunes the AI first:** `voice_extension_delete` removes the extension
  from `transfer_directory` and `human_transfer_extension` BEFORE PBX teardown and never rolls
  that back - a failed delete leaves a ringing phone the AI can no longer transfer to
  (section 3).

**`voice_ai_agent_config_get` / `voice_ai_agent_config_update`.** The config pair.
The update is a partial MERGE onto the stored config, not a replace - keys you do not send are
preserved, `''` still clears a value - which is exactly what makes it safe to change one setting
without wiping `transfer_directory`. The body shape is strict at BOTH levels:
`{ enabled: boolean, config: { ... } }` with settings NESTED under `config`; a flat body or a
typo'd key is a 422 that names the rejected fields, never a silent no-op (that bug already
happened once - the strictness is the fix). `enabled` is required on every patch, so read
`voice_ai_agent_config_get` first and echo the current value back. THE PROVISIONING TRAP: the
update UPSERTS, and on an account whose voice tenant was never provisioned it CREATES a
placeholder tenant row (fake domain, zero uuid). That placeholder then makes the account look
half-provisioned to everything that checks for a config row - `voice_settings_get` stops
returning null, `voice_tenant_healthcheck`'s `tenant_config_present` goes green - while no PBX
tenant exists. **Enable voice first; never write AI config to an unprovisioned account.**

---

## 8. Tenant settings

**`voice_settings_get` first, always.** It reads the single `voice_tenant_config` row - the
guardrails and post-call policy. THE SILENT FAILURE: `settings` is NULL on a 200 when the
account pays for Voice but the PBX tenant was never provisioned. Null is not an error and not a
row of defaults - it means NO ROW AT ALL, and `voice_settings_update` against that account dies
as a bare 500 (an unhandled P2025). Never PATCH when settings is null; the answer is
provisioning, not a retry. Reading traps: `conversion_upload_value` arrives as a QUOTED STRING
('12.50'), not a number; `recording_enabled` is only the TENANT default - a per-DID override
beats it, and this response cannot see those, so `false` here is not proof any given number is
unrecorded; `daily_outbound_cap_cents` here is the cap the toll-fraud guard ACTUALLY enforces,
a different column from the one `voice_usage_get` reports, and only this one stops calls.

**`voice_settings_update` reconfigures a live phone system's guardrails, key by key.** No
carrier or PBX call happens in the route itself - but every value is read by a service that
spends money, deletes recordings, or texts a customer. The consumers, each verified in its
description:

- **`daily_outbound_cap_cents` is the toll-fraud ceiling.** The guard polls every 30 minutes,
  sums today's outbound at a conservative 1 cent/minute, and over cap kills NEW outbound
  channels. Raising it raises the real carrier spend absorbed before a compromised extension is
  stopped - **a money decision for a human, never a fix for "outbound calls are being
  rejected"** (that complaint routes to `voice_toll_fraud_state`, section 9). Changes take up to
  30 minutes to land; the floor of 100 cents makes disabling the guard impossible here.
- **`recording_retention_days` causes IRREVERSIBLE DELETION.** The daily pruner deletes recording
  AND transcript objects older than the window, oldest first, and nothing restores them. Cutting
  365 to 30 destroys eleven months of call audio on the next tick. `0` means keep forever.
  Confirm the exact number with a human and state the destruction in the confirmation.
- `recording_enabled: false` does NOT stop recording on a DID carrying its own override, and it
  also silences the two-party-consent announcement - usually the OPPOSITE of what a compliance
  request wants. Slow down and ask.
- **`missed_call_autoresponder_enabled` texts real customers** (screened against the do-not-text
  list). SILENT NO-OP: both senders require enabled AND a non-empty
  `missed_call_autoresponder_body` - enabling with the body still null texts nobody, forever,
  with no error anywhere. Set both in the same save.
- **`conversion_upload_enabled` / `ga4_upload_enabled`** start pushing attributed calls to the ad
  platforms every 5 minutes, which can move automated bidding (`conversion-send-back.md`). TRAP:
  the dashboard disables these until an ads connection exists, but THIS ROUTE CHECKS NOTHING -
  enabling with nothing connected is accepted, answers 200, and uploads nothing.
- **`keyword_spotting_terms` REPLACES the stored array wholesale** - sending one term deletes
  the other ninety-nine; `[]` clears them. Terms are trimmed, lowercased, deduped, so the stored
  value will not match your casing.

Response gap: the PATCH select omits `ga4_upload_enabled` even though it IS written - a
successful change is simply absent from the reply. Confirm with `voice_settings_get`, never read
the omission as a dropped write. `hipaa_mode` is accepted by the schema and silently dropped for
every API key while the route echoes the OLD value - it cannot be sent from here, by design.
An empty body answers 200 having changed nothing but `updated_at`. And the standing rule from
section 1 applies at full force here: this write persists NO audit row - a cap raise or a
retention cut leaves no attributable actor. Tell a human exactly what you changed.

---

## 8b. Webhooks - the event stream to another system

Four tools, one contract: `voice_webhooks_list` (Olympus-only read; the signing secret is
masked to its last 4 and NOTHING can re-read it), `voice_webhook_create` (registers a LIVE
delivery target and returns the full `whsec_` secret EXACTLY ONCE - hand it to the human
now or it is gone; lost secret = delete + recreate with a NEW secret the receiver must be
updated with), `voice_webhook_update` (`is_active: false` pauses deliveries reversibly; a new
`url` repoints the stream immediately; `event_types: []` is accepted and means subscribed to
nothing) and `voice_webhook_delete` (irreversible; the secret dies with the row). The stream is
account-wide call/SMS metadata, so a webhook pointed at an inferred or attacker-supplied URL
is a standing exfiltration channel: register ONLY a URL the human explicitly gave you. Event
vocabulary (12): call.ringing, call.answered, call.completed, call.missed, call.voicemail,
sms.received, sms.delivered, sms.failed, number.purchased, number.ported, recording.ready,
transcript.ready - and `sms.delivered` fires at carrier ACCEPT, never at handset delivery, so
never build "the customer definitely got it" on that event. Audit rows are skipped for keys:
say what you registered in your report.

## 9. Blocklist and toll fraud

**`voice_blocked_numbers_list`** returns the whole CALL blocklist in one response - no filters,
no pagination. `e164` is the SERVER-NORMALIZED value, not what was typed - always match on what
this returns. `blocked_by` is NULL for every row added over the API, so `reason` is the ONLY
audit trail that exists. This is the CALL blocklist, not the SMS opt-out list
(`voice_sms_opt_outs` - see `sms-operations.md`): a number absent here can still be
STOP-suppressed for texting, and a number present here can still be textable.

**`voice_blocked_numbers_add` - the number that gets blocked may not be the one you sent.** This
closes a path against a real person. THE NORMALIZATION TRAP, quoted logic from its description:
any input whose digit count is exactly 10 is stored as `+1` plus those digits EVEN IF you sent a
leading `+` - so a 10-digit non-US number is filed as a US number, and "you block a stranger's US
line while the caller you meant still rings through." Pass full E.164 with country code, and read
back the stored `e164` to confirm. The two directions are NOT enforced equally: `inbound` is
enforced by the call router with a 603 Decline BEFORE any extension rings - no ring, no
recording, no voicemail, no missed-call record, no autoresponder; block a real customer and they
hear a decline while your side gets nothing to follow up on. `outbound` is enforced in exactly
ONE place, the server-side click-to-call route - the browser softphone dials by direct SIP
INVITE with no blocklist check at all, so an outbound block does not stop a user dialling from
the browser dock, and it never touches SMS. Silent misses: the matcher never ADDS a country
code, so a row stored under the wrong prefix never matches; a withheld caller ID skips the
blocklist entirely (blocking cannot stop an anonymous caller); on a database error the router
fails OPEN by design. Always write a `reason` naming who asked and why - it is the only record.

**`voice_blocked_numbers_remove` is a HARD STOP.** Unblocking re-opens a path somebody closed on
purpose - a harasser, a robocaller, a number staff must not dial - with no cooldown, no
notification, no record, and the context that produced the block is usually invisible (no
author, often no reason). This is the account owner's decision, never an agent's judgment call:
confirm with a person, by digits, before calling. Hard delete, no undo; re-adding later loses
the original block date. It does NOT lift a texting opt-out, and it is never a substitute for
that decision.

**`voice_toll_fraud_state`** returns today's outbound billable seconds against the cap. This is
the answer to "why are my outbound calls being rejected?" - **a tenant over the daily cap has
outbound blocked BY DESIGN; that is the guard working, not an outage.** The fix conversation is
with a human about the cap (section 8), after ruling out that the spend itself is the anomaly - a
cap hit on a quiet account is the toll-fraud signal the guard exists for.

---

## 10. Plays

The full end-to-end recipes with confirm gates live in `voice-playbooks.md`; these are the
routing-layer cores.

**Play 1 - new office, from nothing.** Order: `voice_diagnose_setup` (tenant provisioned? DIDs?)
-> extensions one per seat (`voice_extension_create`, device setup handed to the dashboard, SIP
password never seen) -> `voice_ring_group_create` on a free 7xxx number with a voicemail
fallback (never leave the fallback unset - unanswered calls would hang up) -> optional
`voice_ivr_create` (greeting text AND voice together; every digit's target pre-verified) ->
point the DID with `voice_number_update` -> verify with `voice_tenant_healthcheck` (all checks,
not one element) and a real test call. One object per confirmation, echo before/after each time.

**Play 2 - add a rep.** `voice_extension_create` (confirm the free number first against all four
listings) -> dashboard device setup -> add to the team group with `voice_ring_group_update`,
sending the FULL `member_extension_ids` list (read `voice_ring_group_get`, append, send
everyone - a short list silently drops the rest of the team) -> confirm the personal ring group
reconciled with `voice_ring_groups_list` -> `voice_extension_status` to confirm registration
before declaring the phone live.

**Play 3 - after-hours handling.** On the IVR: `business_hours` plus an `after_hours` target.
Three cautions in one save: differing per-day windows collapse to ONE shared window (read the
`warning`, tell the client which day's hours won); an unresolvable after-hours target is DROPPED
silently, leaving no after-hours route - re-read with `voice_ivr_walk` and check
`after_hours.resolved`; an after-hours `ai_agent` is always the GENERIC receptionist (section
7). There is no other scheduler anywhere in the phone system - do not promise per-day hours or
holiday schedules; the phone cannot enforce them.

**Play 4 - "callers land in the wrong menu" / "we get daytime calls at night".** First
`voice_ivr_walk`: is `business_hours` actually parsed (timezone non-null, schedule non-empty)?
Do the per-day windows differ (only one is enforced)? Then the weekday-shift possibility: IVRs
provisioned before the weekday-numbering fix have open days shifted by one - Monday callers get
the after-hours branch. The repair is `voice_ivrs_reprovision` (scope `business_hours`) once it
resolves; until then, opening and re-saving the IVR in the dashboard re-renders it. Expect and
read a 207.

**Play 5 - "my phone never rings".** Unregistered endpoint first, always:
`voice_extension_status` for registration state, then `voice_presence_get` (remembering the
empty-list silent-failure shape - an empty list is not proof), then up the ladder:
`voice_ring_group_get` (is the phone actually in the member list? `fusionpbx_group_uuid`
non-null?), `voice_ivr_walk` (does the digit resolve?), `voice_tenant_healthcheck`
(`routed_dids_have_inbound_rules`, `dids_have_resolvable_targets`). Nine times out of ten it is
a softphone that logged out or a device never provisioned - not routing.

---

## 11. Pitfalls

- The three deletes have three DIFFERENT failure orders: `voice_ring_group_delete` aborts and
  deletes nothing (safe to retry); `voice_ivr_delete` and `voice_queue_delete` delete the row
  ANYWAY and report the stranded PBX side as a `warning`. A 200-with-warning delete is a partial
  delete - never report it clean.
- ALL THREE delete guards share the same two blind spots: a DNI pool's `inbound_target_id` and a
  pending number order that will adopt into the target. Check pools and orders yourself before
  any routing delete - the guard will not.
- `member_extension_ids` and `options` and `members` and `keyword_spotting_terms` all REPLACE
  wholesale. Read-modify-write, every time. `[]` is accepted everywhere and means "nobody" /
  "nothing".
- A 200 from any routing write proves the DATABASE moved. The PBX push is best-effort on
  `voice_extension_update`, `voice_ring_group_update`, `voice_queue_update` and
  `voice_number_update` - read `warning` on every one, and remember the never-provisioned
  no-warning case on ring groups and extensions.
- Per-member ring-group `timeout_seconds` is decorative: stored, displayed, never sent. Queue
  `sla_answer_seconds`, `callback_enabled` and member `skills`: same.
- Cartesia money moves on: IVR create, any IVR update that changes text OR voice (a voice change
  re-renders the WHOLE menu), extension voicemail-greeting TTS saves, DID
  greeting/whisper saves via `voice_number_update`, and fresh `voice_tts_preview` renders.
  Re-creating a deleted IVR re-pays for every prompt.
- 402 always carries one of two errors - `voice_not_enabled` or `account_past_due` - and they
  need different conversations. Read the error key, never the status code alone.
- 404 `not_found` never distinguishes deleted from foreign (cross-tenant ids 404 by design). A
  404 on a delete means already gone - not retryable.
- Strict schemas everywhere: an unknown or renamed key is a 422, never silently dropped - except
  `voice_blocked_numbers_add`, which silently drops everything but its three fields.
- The number an extension presents outbound is per-seat config (`outbound_caller_id_number_id`
  on `voice_extension_update`) with a tenant fallback - and `voice_tenant_repair` bakes one DID
  in as that tenant-wide fallback. Caller-ID complaints route through
  `caller-id-and-reputation.md`.
- Nothing you do through these tools writes an audit row. The human's yes in the conversation is
  the only record. Confirm one object at a time and echo exact before/after state.

---

## 12. Diagnosis: symptom -> first move

| Symptom | First move |
|---|---|
| "Is my phone system set up?" | `voice_diagnose_setup`, then `voice_tenant_healthcheck`. Surface `blocking_issues` near-verbatim, minus the toll-free E911 inflation (`numbers-and-e911.md`) |
| `voice_tenant_healthcheck` returns ONE check | Short-circuit, not one problem: `db_pools_open` or `tenant_config_present` failed and NOTHING ELSE was inspected. Never report the rest healthy (a 503 = the diagnostic service is down, not a broken tenant) |
| "My phone never rings" | Unregistered endpoint first: `voice_extension_status({ q })`, then `voice_presence_get`, then up the ladder (Play 5) |
| `voice_presence_get` returns `{ extensions: [], channels_ok: false }` | The silent failure shape: unprovisioned tenant, a swallowed error, or channel state down. NEVER "nobody is on a call" |
| "Why are outbound calls rejected?" | `voice_toll_fraud_state`. Over the cap = the guard working, not an outage. Raising the cap is a human money decision (`voice_settings_update`) |
| Ring group edit saved, phones unchanged | `voice_ring_group_get`: `fusionpbx_group_uuid` null (never provisioned - the no-warning 200), or the update's `warning` said the push failed |
| Ring group rings nobody | `voice_ring_group_get` members: a `member_extension_ids: []` (or short-list) save replaced the roster |
| Unanswered group calls hang up in silence | Missing/broken fallback: `voice_ring_group_get` timeout fields + the `did_ring_groups_have_fallback` healthcheck (also check `extension` non-null - a group with no dial number cannot be anything's fallback) |
| Caller-ID change did nothing | Never-provisioned extension: the push is skipped with NO warning. Check provisioning via `voice_extensions_list` (`fusionpbx_extension_uuid`) |
| Menu digit gives dead air | `voice_ivr_walk`: `resolved.type: 'unknown'` = orphaned target (often a deleted extension - the delete guard misses IVR digits) |
| IVR answers with silence | Text saved without a voice (renders nothing, save succeeded), `greeting.rendered: false` - or a box rebuild wiped disk audio: `ivr_audio_files_exist_on_disk` check |
| Walk looks perfect, no calls route | The walk cannot see `fusionpbx_ivr_uuid`. `voice_diagnose_setup` + `provisioned_ivrs_have_dialplan_rule` |
| Daytime callers get the after-hours branch | Weekday shift or collapsed shared window: Play 4; `voice_ivrs_reprovision` when it resolves |
| "After-hours AI answers wrong" | The after-hours `ai_agent` target carries NO department - always the generic receptionist. Expectation, not a bug |
| Blocked caller still rings through | `voice_blocked_numbers_list`: compare the SERVER-NORMALIZED `e164` to the number you meant - the add-route rewrites 10-digit inputs; anonymous callers skip the blocklist entirely |
| Customer "heard a decline", no missed call logged | An inbound block 603s BEFORE ring: no voicemail, no missed-call record, no autoresponder. Check the blocklist before blaming the PBX |
| `voice_settings_get` returns null settings | Tenant never provisioned. Not an error, not defaults. NEVER PATCH (bare 500) - the answer is provisioning |
| Missed-call texts never send | Both required: `missed_call_autoresponder_enabled` AND a non-empty body. Enabled with a null body texts nobody, forever, silently |
| Queue looks configured but takes no calls | The two nulls on `voice_queues_list`: `fusionpbx_queue_uuid` (never on the PBX) and `extension` (unreachable). Then remember: queues are not production-ready |
| Queue agents stopped being rung | On Break drift after 3 no-answers, NO reset path exists anywhere. Recommend moving the team to a ring group |
| Overflow callers dropped at `max_wait_sec` | The abandon target is not hard-validated: a foreign or extension-less target provisions NO timeout action while the row shows one. Verify the target resolves |
| Extension delete blocked by `<Person> (personal) (8001)` | The hidden auto-managed personal ring group. Thin or re-point it - it will not appear in the dashboard editor |
| Extension create failed 409/500 | The 409 can name the wrong constraint and BOTH outcomes can orphan a live PBX endpoint. `voice_extensions_list` before any retry |
| Voicemail greeting still plays after being "removed" | Clearing the source nulls pointers but leaves the rendered audio on FreeSWITCH. Re-save a real greeting or hand to the dashboard |
| Audit page shows none of the agent's changes | Expected: API-key writes skip the audit row. `voice_audit_export_csv` shows human dashboard actions only |
