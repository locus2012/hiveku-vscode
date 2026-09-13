---
description: "\"Why are our texts blocked?\" / \"get us approved to text customers\" / \"did the carriers approve us yet?\" - A2P sender registration: the 10DLC brand-and-campaign lane, the toll-free verification lane, and the status verdict on whether this account can legally text at all."
argument-hint: "[10dlc | toll-free | status]"
---
SMS sender registration: $ARGUMENTS. Follow the **hiveku-phone-agency** skill - load
`references/tendlc-and-toll-free.md` first; the filing order, the fee table, the 8 CTA elements,
and the rejection playbook live there. Several tools here shipped with the 2026-08-29 voice
program: a name that does not resolve means the plugin predates it - `/hiveku:update`, then retry.

1. **Status first, always**, whatever lane was asked for: `voice_sms_registration_get`. The verdict
   keys on `can_send` and `blocking_reason` - relay `blocking_reason` verbatim. A CAMPAIGN raw
   status of `TCR_ACCEPTED` is NOT approved (it normalizes to canonical PENDING - a filing
   receipt; only canonical ACTIVE gates sending), and the brand's own states are
   PENDING | VERIFIED | FAILED | SUSPENDED. If the ask was just `status`, report which lane this account is in, what
   is blocking, and the exact next step, then stop.

**10DLC lane** (local numbers texting for a business):
2. Brand facts come from the HUMAN: legal entity name, EIN, entity type, address. Never infer them
   from the website or the CRM - a wrong EIN files a false identity with the registry.
3. [CONFIRM] `voice_sms_brand_submit` - an irreversible, fee-bearing filing of a real company's
   identity. Show every field back and get an explicit yes on the exact values.
4. `voice_sms_campaign_draft` - use case, sample messages, opt-in description.
5. `voice_sms_cta_preflight` ALWAYS, before any submit. It checks the opt-in page the campaign
   cites; fix the page first - it must be server-rendered with all 8 CTA elements present,
   including the no-sharing sentence. A page that renders the CTA only in client-side JS fails the
   carrier's review even when it looks fine in a browser.
6. [CONFIRM] `voice_sms_campaign_submit` - roughly a $15 non-refundable vet per submission, and the
   declared use case MUST match what the website visibly does; a mismatch is the classic rejection.
7. Poll `voice_sms_campaign_get` for the CANONICAL verdict (only ACTIVE means sendable), and
   `voice_sms_campaign_carriers_get` to explain a per-carrier holdout - its strings are the
   registry's RAW vocabulary, never to be tested like the canonical status, and an all-approved
   carrier list is still not approval until the canonical status says ACTIVE.
8. `voice_sms_number_assign_campaign` - pass the REGISTRY campaign id, not the local row id.
9. Report with the caveat: carrier propagation is 24-72h after approval; do not promise same-day.

**Rejected?** `voice_sms_brand_feedback_get` for the registry's stated reasons. Then, in order of
cost: [CONFIRM] `voice_sms_campaign_appeal` - an appeal adds a NOTE to the existing record only, it
does not re-vet (FAILED/SUSPENDED only); for a row that NEVER reached the registry
(`telnyx_campaign_id` null) [CONFIRM] `voice_sms_campaign_resubmit` re-files it; for a registered
campaign whose CONTENT was the problem there is no edit lane - [CONFIRM] `voice_sms_campaign_delete`
(FAILED/EXPIRED only) then a fresh `voice_sms_campaign_submit`, which is ANOTHER fee; and when
the stated reasons do not match anything on our side, the move is the human-support escalation in
the reference, not a third paid roll of the dice.

**Toll-free lane**:
10. Evidence checklist before anything is filed: EIN, and publicly reachable https URLs of the
    opt-in images and pages - the verifier will not accept evidence only we can see.
11. [CONFIRM] `voice_sms_toll_free_verification_submit`. REFUSE to resubmit an already-verified
    number until the human has read the overwrite warning: a resubmission replaces the standing
    verification and the number drops back to unverified while the new filing is reviewed.
12. Poll `voice_sms_toll_free_verification_get`.

**Client handoff branch** (the client fills in their own brand facts and evidence): [CONFIRM]
`voice_sms_registration_share_link_create` - the returned URL is a credential, shown ONCE; hand it
to the human immediately and never paste it into logs, memory, or a PM task body. Revoke a stale or
leaked link with `voice_sms_registration_share_link_revoke`.

**Report** in this order: the can_send verdict with blocking_reason verbatim → what was filed today
and its fees → what is now pending and with whom (registry, carrier, verifier) → the 24-72h
propagation caveat wherever something was approved → the exact next human action.

**What NOT to do.** Never infer brand identity fields. Never skip `voice_sms_cta_preflight` because
the page "looks compliant". Never resubmit - campaign or toll-free - without naming the fee or the
overwrite out loud. Never paraphrase `blocking_reason` into something gentler. Never treat
`TCR_ACCEPTED` as permission to send.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
