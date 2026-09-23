---
description: "First-time phone setup - \"we need phones\", \"set up our phone system\", \"get us a number and put everyone on it\" - the full onboarding ladder: E911 address, buy the number, a seat per person, a ring group, route the main line (or forward it), caller-ID name, an offline source number if one is printed anywhere, then texting registration."
argument-hint: "[team + area code + who answers - e.g. '3 reps, 214 area code, main line rings everyone']"
---
Stand up voice from zero for the bound account: $ARGUMENTS. Follow the **hiveku-phone-agency**
skill - load `references/voice-playbooks.md` first (recipe 1 is this exact ladder). Every money or
irreversible step below is a [CONFIRM]: one object per confirmation - echo exactly what will happen,
get a yes, act, read the result back. A name that does not resolve is a profile question first
(the helpdesk and communications keys carry the whole `voice_` family; a PPC or sales key does
not) - say "not visible to this key" and file that rung with `pm_tasks_create` - and only then a
plugin-version question (`/hiveku:update`, then retry).

1. **Where are we starting?** `voice_diagnose_setup` - no arguments. `tenant_provisioned: false`
   means the Voice add-on / tenant is not enabled yet: that is a dashboard + billing step, stop and
   hand it back. Existing DIDs, extensions or E911 addresses mean this is a top-up, not a greenfield -
   skip the rungs already done.
2. **E911 address first** - a local number should not go live without the address 911 dispatches to.
   `voice_e911_addresses_list` for anything already verified; otherwise [CONFIRM]
   `voice_e911_address_create` - echo the exact street address and say plainly: this is where
   emergency services will be sent for 911 calls from these phones. Pending verification is not yet
   registered; note it in the report.
3. **The number** - `voice_numbers_search` with the requested area code / locality (one carrier-billed
   search, no looping; shortlist with `monthly_cost_cents` and `setup_cost_cents` shown as dollars).
   Then [CONFIRM] `voice_number_purchase` - echo the exact `e164`, the monthly cents and any setup
   cents, and that this is a recurring carrier charge. A 202 is a PENDING ORDER, not a live number:
   watch `voice_number_orders_list` until it completes before promising anything.
4. **A seat per person** - for each rep, [CONFIRM] `voice_extension_create` (extension number,
   display name, endpoint type). The SIP password is never returned here: the device itself is set up
   from the dashboard - say so in the report. An `external_number` seat (forward to a cell) requires
   `external_target_e164` in the same call.
5. **The ring group** - pick a free 7xxx extension BY HAND: check `voice_ring_groups_list`,
   `voice_extensions_list`, `voice_ivrs_list` and `voice_queues_list` first, because NOTHING
   cross-checks the number you supply. Then [CONFIRM] `voice_ring_group_create` with the member
   extensions and strategy. Read back with `voice_ring_group_get` - a null `fusionpbx_group_uuid`
   means it never reached the phone system and cannot ring anyone.
6. **Route the main line** - [CONFIRM] `voice_number_update` pointing the purchased DID at the ring
   group (or an IVR, a seat, or a bare PSTN forward via `forward_to_e164` to a cell or the old
   office line - a forward bills PSTN minutes for every inbound call, say so before the yes; it
   also overrides any target on the number, so a later re-route must send `forward_to_e164: null`
   in the same call). Echo
   before/after: "next inbound call to <e164> rings <group>". The PBX push is best-effort behind a
   200, so read the number back with `voice_number_get`.
7. **Caller-ID name (CNAM)** - offer it: an unregistered number shows bare digits and is likelier to
   be labeled Potential Spam. [CONFIRM] `voice_number_cnam_set` (15 chars, letters/numbers/spaces
   only; 12-72h to propagate; not applicable to toll-free).
8. **Offline source numbers (optional)** - a number printed on a billboard, a truck, a radio spot or
   the GBP listing is a tagged STATIC number, not a pool: [CONFIRM] `voice_number_update` on that DID
   with `tracking_source` (max 80 chars) and `campaign_name` (max 120 chars, the label in the call
   logs), and every call to it credits that source in the calls-by-source reporting. State the
   ceiling in the same breath: no web session, so no click id, so those calls can never upload to
   an ad platform - source-level reporting is the limit. Website traffic wants a pool instead:
   `/hiveku:call-tracking`.
9. **Texting** - the number cannot text customers until messaging registration is done. Kick that off
   with `/hiveku:sms-register`; do not start it silently from here.

**Report** in this order: what is LIVE right now (number, who rings or where it forwards, E911
status, any source label) -> what is PENDING (number order, E911 verification, CNAM propagation,
SMS registration) -> what the client must do themselves (enable the add-on if unprovisioned,
register devices from the dashboard, answer the registration questions).

**What NOT to do.** No purchase, E911 create, extension create, ring-group create, DID re-route or
PSTN forward without its own explicit yes - never batch the confirmations into one. Do not invent
a ring-group extension without checking all four pools. Do not tell the client a 202 order or a
pending E911 address is live. Do not promise texting before registration. Do not promise click-level
attribution from a static source number.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
