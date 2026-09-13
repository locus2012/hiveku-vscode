---
description: "\"Move our numbers from CallRail to Hiveku\" / \"port our office number in\" / \"is the port done yet?\" - number porting end to end: the free portability check, the order, the LOA-backed confirm, status chasing, and the after-FOC adoption checklist."
argument-hint: "[from CallRail|Twilio|GHL|other: <numbers>]"
---
Port numbers in: $ARGUMENTS. Follow the **hiveku-phone-agency** skill - load
`references/porting.md` first; the ranked status model, the per-carrier guides, and the adoption
checklist live there. Most tools here shipped with the 2026-08-29 voice program: a name that does
not resolve means the plugin predates it - `/hiveku:update`, then retry.

1. `voice_portability_check` FIRST - it is free and creates nothing. A number that fails here is a
   conversation with the human, not the start of an order.
2. Summarize the carrier guide for the named source (CallRail, Twilio, GoHighLevel, or other) from
   the reference: where the account number and PIN live, what the losing side calls a port-out, and
   the traps specific to that carrier.
3. [CONFIRM] `voice_port_order_create` - this also files a DRAFT with the carrier, not just a local
   row. Say it out loud before the yes: keep service ACTIVE at the losing carrier until the port
   completes; cancelling early is the classic way to lose the number entirely.
4. Fill in the order, one of two ways. Hand it to the client: [CONFIRM]
   `voice_port_order_share_link_create` - the URL is a credential, shown once; revoke a stale or
   leaked one with `voice_port_order_share_link_revoke`. Or gather the details yourself and write
   them with `voice_port_order_update`. Some carriers verify by text message: [CONFIRM]
   `voice_port_order_verification_codes_send` - the customer's ACTUAL phones ring or buzz, so warn
   them first and never fire it twice while codes are outstanding - then
   `voice_port_order_verification_codes_verify` with the codes they read back.
5. `voice_port_order_requirements` before any confirm - every requirement must read satisfied.
   Questions to and from the carrier ride `voice_port_order_comment_add` and
   `voice_port_order_comments_list`.
6. [CONFIRM] `voice_port_order_action` with `confirm` - THE legal act, executed under the signed
   LOA. The human must state that the LOA is signed and that requirements are clean before the yes.
   (`cancel` and `activate` ride the same tool; each is its own [CONFIRM].)
7. Status cadence: `voice_port_order_refresh_status`, then `voice_port_order_get`. Statuses are
   RANKED - the reference orders them; report where in the ranking the order sits, not a raw
   string. Exceptions carry a what and a fix: relay both verbatim, and file the human piece as a
   task.
8. After FOC, run the adoption checklist and do not call the port done until it is: E911 for each
   ported DID, routing (which extension, ring group, or IVR answers it), CNAM, and re-assigning any
   texting number to its 10DLC campaign with `voice_sms_number_assign_campaign`.

**Report** in this order: portability verdict per number → what was filed and its current state →
exceptions verbatim with their fixes → the FOC date once one exists → adoption checklist state →
the next human action.

**What NOT to do.** Never tell the client to cancel service at the losing carrier before
completion. Never run `voice_port_order_action` confirm without `voice_port_order_requirements`
clean and the human's LOA statement. Never guess or promise a FOC date the carrier has not issued.
Never treat a draft order as a scheduled port.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
