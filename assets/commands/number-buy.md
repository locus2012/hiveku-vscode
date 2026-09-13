---
description: "Buy a phone number - \"get us a local number\", \"we need a toll-free number\", \"a 214 number for the new office\" - search carrier inventory, register E911, purchase with an explicit yes, route it, set the caller-ID name."
argument-hint: "[local <area code|city|state> | toll-free <prefix>]"
---
Buy a number for the bound account: $ARGUMENTS. Follow the **hiveku-phone-agency** skill - load
`references/numbers-and-e911.md` first. The purchase tools are newly deployed: if a name does not
resolve, the deploy has not landed - use the dashboard step for that rung.

1. **Search** - `voice_numbers_search`. Each call is a billed carrier request: ONE search, no
   looping. A local search must name at least one of `area_code`, `locality` or `state` (422
   otherwise); toll-free takes `toll_free_prefix` and no geographic filter (422 if combined). Search
   only - nothing is reserved, another buyer can take a listed number at any moment. Present a
   shortlist with `monthly_cost_cents` and `setup_cost_cents` shown as dollars (nonzero setup =
   premium prefix), and flag any result whose `features` lacks `sms` - that number cannot text, ever.
2. **E911 before purchase** (local numbers) - `voice_e911_addresses_list` for an existing VERIFIED
   address to attach; if none, [CONFIRM] `voice_e911_address_create` - echo the exact street address
   and say it is where 911 dispatches. Toll-free SKIPS this rung entirely: toll-free numbers take no
   E911 registration.
3. **Purchase** - [CONFIRM] `voice_number_purchase`: echo the exact `e164`, the monthly cents and
   setup cents as dollars, and that the monthly charge recurs until released. Get the yes, then act.
   Notes to give with the echo: 800-prefix numbers are unpurchasable at EVERY layer of the platform
   (premium pricing with no billing pass-through - not here, not the dashboard); toll-free numbers carry higher
   per-minute pricing; any recycled DID can arrive with baggage (old spam labels, texts and calls for
   the previous owner) - it is not factory-new.
4. **A 202 is not a number** - it is a pending carrier order. Poll `voice_number_orders_list` until
   the order completes; report "ordered, pending" until then, never "live".
5. **Route it** - a purchased number that routes nowhere is dead air. [CONFIRM]
   `voice_number_update` pointing the DID at its inbound target (ring group, extension, IVR, or
   forward). Echo before/after.
6. **Caller-ID name** - offer CNAM: [CONFIRM] `voice_number_cnam_set` (max 15 chars, letters/numbers/
   spaces; propagates in 12-72h, and `cnam_updated_at` only means the carrier accepted it). Refused
   on toll-free (`cnam_not_applicable_toll_free`).
7. **Texting honesty** - a number whose `features` lacked `sms` cannot text. One that has it still
   cannot text customers until messaging registration: local numbers need the 10DLC campaign,
   toll-free needs verification first (`voice_sms_toll_free_verification_get` shows state). Point at
   `/hiveku:sms-register` for either lane.

**Report** in this order: what was bought (e164, exact recurring cost) -> routing and E911 state ->
what is pending (order, verification, CNAM propagation) -> texting status and the registration next step.

**What NOT to do.** Never loop `voice_numbers_search` to browse inventory. Never say a number is
reserved or ordered off a search result. No purchase, E911 create, re-route or CNAM write without its
own explicit yes on that one object. Do not attach a pending E911 address and call the number
911-ready. Do not promise texting on an unregistered number.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
