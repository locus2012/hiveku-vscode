---
description: "Ring groups - \"make the main line ring everyone\", \"add Mike to the sales line\", \"calls should try Sarah first then the team\" - plan the roster and strategy, create it live, verify it actually reached the phone system, point a number at it."
argument-hint: "[what it's for + who rings - e.g. 'main line: Sarah and Mike simultaneous, voicemail fallback']"
---
Build or change a ring group: $ARGUMENTS. Follow the **hiveku-phone-agency** skill - load
`references/pbx-routing.md` first. A ring group create is LIVE on success - dialing its extension
rings real phones immediately - so the plan comes before any write.

1. **Plan with the human** - who is in it (resolve names to extension UUIDs via
   `voice_extensions_list` - member ids are UUIDs, not dial numbers), the strategy (simultaneous /
   in-order / round-robin), ring seconds, and what happens on no answer. Do not guess a roster.
2. **Pick the extension BY HAND** - a free 7xxx number, checked against ALL FOUR pools:
   `voice_ring_groups_list`, `voice_extensions_list` (1001+ seats), `voice_ivrs_list` (6xxx) and
   `voice_queues_list` (5xxx). NOTHING cross-checks the number you supply - two dialplan rules on the
   same digits resolve by order, silently, and the 8001-8999 range belongs to auto-managed personal
   groups.
3. **The fallback decision** - hard-validate it with the human before the create. Voicemail or
   another group is free; an `external_number` fallback bills PSTN minutes for EVERY unanswered call
   that falls through - say that out loud and get it chosen deliberately.
4. [CONFIRM] `voice_ring_group_create` - echo the extension, the full roster in ring order, the
   strategy, ring seconds and the fallback; get a yes; act. One group per confirmation.
5. **Read back** - `voice_ring_group_get`. `fusionpbx_group_uuid` must be NON-NULL: null means the
   group exists only in the database, cannot ring anyone, and edits to it return clean 200s while
   changing nothing on the phones. A null `extension` means nothing can dial or transfer to it and it
   cannot be another group's fallback.
6. **Point a DID at it** - [CONFIRM] `voice_number_update` with before/after: "next inbound call to
   <e164> rings <group>". Read the number back. A whisper on TRACKED calls ("Call from Google Ads"
   before the bridge) is a pool setting, not a ring-group one - `/hiveku:call-tracking` pools.

**Editing an existing group** (`voice_ring_group_update`) - three traps, every time:
- `member_extension_ids` REPLACES the entire membership. "Add Mike" means send the FULL new roster;
  an empty array `[]` is accepted and leaves a group that rings nobody.
- A 200 can change nothing on the phones: an unprovisioned group (null `fusionpbx_group_uuid`) skips
  the phone system entirely with NO warning, and a push failure comes back as a soft `warning` on a
  200. Read `warning`, and read back with `voice_ring_group_get`.
- Sending `ring_seconds` alone overwrites every member's timeout and re-pushes the roster -
  per-member timings do not survive.

**Report** in this order: what is live (group, roster in order, strategy, fallback, the DID pointing
at it) -> the read-back proof (`fusionpbx_group_uuid` non-null) -> anything deferred to the human ->
anything you could not verify.

**What NOT to do.** Never invent a group extension without checking all four pools. Never send a
partial roster to `voice_ring_group_update`. Never touch the 8001-8999 personal groups. Never choose
an `external_number` fallback silently - it spends money per missed call. Do not trust a 200 with a
`warning`, and do not report a group as ringing off the database row alone.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
