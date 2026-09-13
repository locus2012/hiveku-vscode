---
description: "Manage seat phones - \"add a phone for the new rep\", \"the wrong number shows when Sarah calls out\", \"which extensions do we have?\" - add a seat, fix outbound caller ID, audit every seat's presented number, or retire one safely."
argument-hint: "[add <name> | caller-id <ext> <e164> | audit]"
---
Work the account's extensions: $ARGUMENTS. Follow the **hiveku-phone-agency** skill - load
`references/pbx-routing.md` first. Pick the lane from the argument.

**add <name>**
1. `voice_extensions_list` - find a free dial number (user seats run from 1001 up; stay clear of the
   5xxx queue, 6xxx IVR, 7xxx ring-group and 8001-8999 personal pools).
2. [CONFIRM] `voice_extension_create` - echo the extension number, display name and endpoint type
   (`desk_phone` | `softphone_mobile` | `softphone_desktop` | `external_number`), get a yes, act.
   An `external_number` seat (forward to a PSTN cell) REQUIRES `external_target_e164` in the same
   call - there is no second save that adds it.
3. Read back: `voice_extension_status({ q: '<ext>' })` for the row and registration state, and
   `voice_ring_groups_list` to check whether an auto-managed PERSONAL ring group (8001-8999,
   `is_personal`) appeared or should be expected once a second device registers for the same user.
4. Device handoff: the SIP password is returned exactly once to the phone system and NEVER through
   these tools - registering the handset or softphone is a dashboard step. Say so; do not pretend to
   finish it.

**caller-id <ext> <e164>**
1. `voice_numbers_list({ is_active: 'true' })` (STRING flag) - the presented number MUST be an
   active DID this account owns. A toll-free DID is refused (`toll_free_caller_id` - a 911 call would
   present a number with no dispatchable address). An unowned number is refused
   (`invalid_caller_id`) - and would be a STIR/SHAKEN reject at the carriers even if it were not.
2. [CONFIRM] `voice_extension_update` with `outbound_caller_id_number_id` - echo "every future
   outbound call from seat <ext> will present <e164>", get a yes, act. ALWAYS read the `warning`
   field on the 200: a warning means the database and the phone system now disagree, and re-saving is
   the retry.

**audit**
1. `voice_extensions_list` + `voice_numbers_list({ is_active: 'true' })`. For each seat, resolve the
   presented outbound number and compare against the owned active DIDs. Flag: seats presenting a
   released or inactive DID, seats presenting toll-free, seats with no caller ID set (carrier
   default), and `external_number` seats with no target. Report per seat, worst first.

**Retiring a seat** - only on an explicit id, never by guesswork from a name. First walk EVERY IVR
with `voice_ivr_walk`: the delete guard checks numbers and ring groups but NOT IVR digits, so a menu
option pointing at this seat is silently orphaned (it walks as `resolved.type 'unknown'` afterwards).
Then [CONFIRM] `voice_extension_delete` - say plainly: this takes the phone offline and is
irreversible; the SIP password dies with the row, so recovery means a NEW extension plus dashboard
re-provisioning. A 409 `extension_in_use` names what still routes here - fix routing first. The
hidden 409 is the personal ring group: a user with two registering devices has one, and the
ring-group editor deliberately hides it.

**Report** in this order: what changed (created / updated / deleted, read back) -> what the human
must do in the dashboard (device registration) -> audit findings worst-first -> anything you could
not check.

**What NOT to do.** Never create an `external_number` seat without `external_target_e164`. Never set
caller ID to a toll-free or unowned number "to see if it works". Never delete by display name, and
never delete before walking the IVRs. Do not read an empty `voice_presence_get` list as "nobody
registered" - `channels_ok: false` means the check failed.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
