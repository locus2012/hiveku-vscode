---
description: "Phone menus (IVR / auto-attendant) - \"press 1 for sales, 2 for support\", \"set up a phone tree\", \"callers should hear a greeting first\" - design the menu, preview the TTS cost, create it live, walk every digit, point the number at it."
argument-hint: "[the menu - e.g. '1 sales ring group, 2 support, after-hours to voicemail']"
---
Build a phone menu: $ARGUMENTS. Follow the **hiveku-phone-agency** skill - load
`references/pbx-routing.md` first. An IVR create renders paid TTS audio and goes live the moment it
returns, so design and cost come before any write.

1. **Design the tree with the human** - ONE level: each digit to an extension, ring group, voicemail,
   sub-IVR, or the AI receptionist. Write out the greeting text and every option label, and resolve
   every target to a real object first (`voice_extensions_list`, `voice_ring_groups_list`,
   `voice_ivrs_list`). Do not guess wording that callers will hear. A call-tracking pool's
   destination may be an IVR too - tracked calls then hear this menu; point the pool at it from
   `/hiveku:call-tracking` pools, not by re-routing member DIDs one at a time.
2. **Voice and name sanity** - `voice_tts_voices_list` to pick the voice. A ONE-entry result named
   'Default voice' is the OUTAGE shape, not a one-voice catalog - stop and say the TTS catalog is
   unavailable rather than shipping the fallback. Then `voice_default_greetings_get`: its templates
   are seeded from the internal account name, NOT the trading name ('Thanks for calling Psgi.'), so
   check the name against what the business actually calls itself before it gets read aloud.
3. **Cost preview, one sentence, before the confirm** - every save that changes greeting/option TEXT
   or the VOICE re-renders paid TTS (billed per character into the month's usage); unchanged text on
   the same voice is a free cache hit.
4. [CONFIRM] `voice_ivr_create` - echo the greeting text, every digit with its target, the voice, and
   the TTS cost warning; get a yes; act. The extension is auto-assigned from the 6000-6999 pool. Note
   `tts_cost_cents` from the response in the report. A greeting needs BOTH text and a voice id in the
   same call - text without a voice renders nothing, silently.
5. **Walk it** - `voice_ivr_walk` read-back. Check EVERY `resolved.type`: a `{type:'unknown'}` target
   is a broken digit that still answers 200 and looks healthy at a glance. Report each digit as
   "press N -> <resolved thing>", not from the row you sent.
6. **Point the DID** - [CONFIRM] `voice_number_update` routing the number at the IVR, with
   before/after: "next inbound call to <e164> hears this menu". Read the number back.
7. **Business-hours honesty** - if the client wants open/closed behavior, one SHARED time window is
   enforced even when per-day hours differ in the config: the menu cannot do "Fridays until 3".
   Say so instead of promising per-day schedules, and verify the after-hours path in the walk too -
   it resolves (and breaks) the same way the digits do.

**Editing later** (`voice_ivr_update`) - two traps: sending `options` REPLACES the whole menu, so a
digit left out of the array is DELETED (omit `options` entirely to keep the stored menu); and
changing the voice alone invalidates the text+voice hash for the greeting AND every announcement -
one field, the entire menu re-rendered at full price. Preview that cost before confirming.

**Report** in this order: the live menu digit-by-digit from the walk -> the DID pointing at it ->
what the TTS render cost -> hours/after-hours behavior as actually enforced -> anything you could
not verify.

**What NOT to do.** Never create from a one-entry voice catalog. Never send a partial `options` array
on an update. Never change the voice casually - it re-renders everything. Never report a menu as
working without walking it, and never read a digit's health off the create payload instead of
`voice_ivr_walk`. Do not promise per-day business hours.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
