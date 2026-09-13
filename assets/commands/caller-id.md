---
description: "\"Clients see the wrong number when we call\" / \"our calls show as Spam Likely\" / \"set the name that shows when we call\" - outbound caller identity: the per-extension audit, setting a presented number, CNAM display names, and the spam-label ladder."
argument-hint: "[audit | set <ext> <e164> | cnam <e164> <NAME> | spam]"
---
Caller ID: $ARGUMENTS. Follow the **hiveku-phone-agency** skill - load
`references/caller-id-and-reputation.md` first; both caller-ID paths, STIR/SHAKEN, and the
spam-label ladder live there.

**audit**:
1. `voice_extensions_list` - read the caller-ID columns for every extension: which number each seat
   presents on outbound.
2. `voice_numbers_list({ is_active: 'true' })` (the STRING `'true'`, not a boolean) for the DIDs
   this account actually owns and has active.
3. Reconcile: every presented number must be an owned, active DID. Note which extensions carry no
   explicit caller ID and therefore present the ACCOUNT DEFAULT - that is a fact to report, not a
   defect, but the human should know exactly which number that default is.
4. Report per extension: presented number, owned or not, explicit or default.

**set <ext> <e164>**: [CONFIRM] `voice_extension_update` with the extension and the number. Two
refusals are built in and final: a toll-free number is refused as a presented caller ID, and so is
any number this account does not own. Do not look for a workaround; there is not one.

**cnam <e164> <NAME>**: [CONFIRM] `voice_number_cnam_set`. The name is at most 15 characters - show
the human the exact truncation before the yes. Propagation is 12-72h through the carrier CNAM
databases, and ACCEPTED IS NOT LIVE: the carrier taking the update is not the name showing on
handsets. Say both in the report.

**spam** ("we show as Spam Likely"): run the ladder from the reference in order - it starts with
the checks on our side (consistent presented numbers, CNAM set, attestation) and moves through
remediation, and it ENDS at the Free Caller Registry, which is a human-only web submission: file it
with `pm_tasks_create`, carrying the affected numbers and the registry URL, for a human to
complete. Never present the ladder as something this session can finish alone.

**Report** in this order: the per-extension audit table → changes made this session, each with its
propagation caveat → spam-label state and where in the ladder this account stands → the human
actions filed.

**What NOT to do.** Never set a toll-free or unowned number as a caller ID - relay the refusal,
do not retry around it. Never promise a CNAM change is visible before 12-72h, and never call
"accepted" live. Never mark the Free Caller Registry step done because the task was created.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
