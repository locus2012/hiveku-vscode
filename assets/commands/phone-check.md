---
description: "Phones acting up? Diagnose the phone system - \"phones aren't ringing\", \"customers can't get through\", can't dial out - plus provisioning, routing, outbound cap, the phone numbers you own (DID inventory), and emergency-address (E911) registration. Names the cause, then offers the fixing write one confirmation at a time."
argument-hint: "[optional symptom - e.g. 'phones not ringing' or 'extension 1003' or 'outbound rejected']"
---
Diagnose the phone system for the account this directory is bound to$ARGUMENTS. This is TELEPHONY,
not attribution: "our call conversions look wrong" is the conversion-tracking skill, not this command.
Follow the **hiveku-phone-agency** skill; load `references/pbx-routing.md` first.

**Do not try to answer this from `hiveku-data/voice/`.** `/hiveku:pull voice` snapshots the list
datasets, not the diagnostics - `blocking_issues[]` and PBX state are never in local data. Step 1 is
always a live call, and it is a cheap one.

1. **`voice_diagnose_setup`** - no arguments. `tenant_provisioned: false` is the whole answer: stop.
   Non-empty `blocking_issues[]` outranks everything below - report those VERBATIM, then stop digging.
   Before reporting `dids_without_e911`, subtract the toll-free DIDs: toll-free numbers take no E911
   registration and inflate that count.
2. **`voice_tenant_healthcheck`** - the only tool that can see the FusionPBX side (a DID perfect in
   the dashboard with no inbound dialplan rule, a ring-group DID with no no-answer fallback). A
   ONE-element `checks` result is a short-circuit, not a clean bill: report the healthcheck as
   **inconclusive**, never as "20 checks healthy".
3. **Outbound complaints** ("can't dial out", "calls rejected the moment we dial") -
   `voice_toll_fraud_state`: daily outbound billable seconds vs the cap. A cap hit is a spend guard
   working, not a bug. Name what burned it: `voice_calls_list({ direction: 'outbound', hours_back: 24 })`.
4. **Do the calls exist at all?** `voice_recent_calls({ limit, hours_back })` for the quick window,
   `voice_calls_list` for a wider one. `voice_calls_list({ disposition: 'missed' })` WORKS - the
   stored vocabulary is `answered | voicemail | missed | ai_handled | abandoned`; filtering on
   `no_answer`, `busy` or `failed` returns a silent zero that reads as "no such calls".
5. **Routing** - `voice_ring_groups_list` then `voice_ring_group_get` for the group in question (a
   null `fusionpbx_group_uuid` cannot ring anyone). `voice_ivrs_list` then `voice_ivr_walk` per IVR -
   a `resolved` target of `{type:'unknown'}` IS the finding: that digit answers and goes nowhere.
   `voice_queues_list` - a null `fusionpbx_queue_uuid` or a null `extension` means the queue does not
   work, and neither is reported as an error. `voice_extensions_list` for the seat roster, then
   `voice_extension_status({ q })` for every complained seat AND every seat the roster shows as
   unregistered or offline - "she can't dial out" is almost always an endpoint that is not registered.
   `voice_presence_get` for live lamp state - `{ extensions: [], channels_ok: false }` means the
   check FAILED, not "nobody is registered"; never read an empty list as an idle office.
6. **DID inventory** - `voice_numbers_list({ is_active: 'true' })`. `is_active` is the STRING
   `'true'` / `'false'`, not a boolean. A number the client publishes that is not here is not ours to ring.
7. **E911** (always, even when the complaint was something else) - `voice_e911_addresses_list`, joined
   against the active DIDs from step 6. Pending verification is NOT registered: count pending
   separately, and report the ACTUAL numbers with no verified address, not a count. This is Kari's
   Law / RAY BAUM'S Act exposure for the client.
8. **When the account runs call tracking** - `voice_pools_list` for the pools and where each member
   DID routes, plus `voice_call_tracking_diagnose` for the structured verdict. NEVER
   `voice_call_tracking_live_probe` from this command - it writes a session row and HOLDS a tracking
   DID for the sticky window, starving live traffic.

**Report** in this order: blocking issues -> the answer to the symptom the operator asked about ->
E911 risk -> anything you could not check (and why).

**The fix.** Voice writes are live now: name the exact write that would fix the finding
(`voice_number_update` for a mis-routed DID, `voice_ring_group_update` for a wrong roster,
`voice_ivr_update` for a dead digit, `voice_extension_update` for a seat) and offer it ONE
confirmation at a time - echo what will change, get a yes, act, read back. Anything that needs the
dashboard or a human decision instead becomes `pm_tasks_create`.

**What NOT to do.** Do not filter `voice_calls_list` on `no_answer` / `busy` / `failed` - silent
zeros. Do not mark anything read while diagnosing (no `voice_voicemail_mark_read`, no `mark_read`
flags on thread reads). Do not mint audio URLs (`voice_recording_url_get` is ask-gated; leave
voicemail `audio_urls` off). Do not compare a `voice_calls_list` total against a
`marketing_call_attribution_list` total - the first excludes internal calls, the second includes them.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
