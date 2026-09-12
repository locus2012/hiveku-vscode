---
description: Build, test and launch an email campaign end-to-end - setup gates, audience, template, dry run, test send, schedule/send.
argument-hint: "[what the campaign is about]"
---
Build and launch an email campaign: $ARGUMENTS.

Sends are GATED. Skipping a step doesn't fail loudly at that step - it means the campaign silently
cannot send later. After every write, read it back (get/list) before proceeding. Report failures
verbatim; never claim something sent without checking.

0. **If email is not going out at all, start here.** `email_deliverability_check({ wait_seconds: 30 })`
   BEFORE any other probing. One call runs the whole ladder server-side: suspension state, active API
   key, verified domain, a REAL send through the account's production SES lane, then a wait for the
   actual SES delivery event (queued is not delivered). The recipient is ALWAYS the AWS mailbox
   simulator (success@simulator.amazonses.com) - full pipeline exercised, zero reputation impact, no
   human recipient. NEVER invent your own test recipient address. What happened on 2026-08-07: two
   transient bounces from synthetic example.com test sends, on an account that had sent 20 emails,
   were counted by Hiveku's own reputation monitor as a 10 percent bounce rate; it auto-suspended a
   blameless tenant, and the suspension path disabled the SHARED SES configuration set, which stopped
   every tenant's email for about 5.5 hours. AWS suspended nothing - the outage was ours. Test sends
   to reserved or test domains (example.com/.org/.net, test.com, localhost, .invalid) are now refused
   with `reserved_test_address`; the simulator is the only no-inbox recipient. Verdict
   `sent_but_no_delivery_event` means the send path works and the event webhook pipeline is broken.
   Rate-limited to 3 checks per 10 minutes (429 after that, and the previous result has not changed).
1. **Setup gates first:** `marketing_setup_status`. It checks exactly five conditions -
   marketing_enabled, not_paused, ses_provisioned, verified_sending_domain, mailing_address - each
   with the fix, plus a sixth: account-level suspension, evaluated with the same predicate the
   dispatcher itself calls. Do not build until `ready_to_send: true`. A passing check no longer
   carries fix text, so any `fix` you see is a real instruction rather than leftover prose.
 - `email_service_status.sending_enabled` is NOT the same flag and is not a second opinion on this
     one. `ready_to_send` covers the MARKETING CAMPAIGN lane (campaigns and sequences through the
     account's SES tenant); `sending_enabled` covers the TRANSACTIONAL lane (hk_ API keys,
     smtp.hiveku.com, /api/v1/email/send). An account whose marketing was never provisioned reads
     false on the first and true on the second, and both are correct. Do not read one as
     contradicting the other.
 - Suspension is the ONE gate they share, so when either reports it the `suspension` block carries
     the reason and ALL sending is blocked regardless of how healthy the reputation numbers look.
     Suspensions are lifted by Hiveku staff, not by any tool. Stop and tell the user.
 - a VERIFIED sending domain: `email_domain_add({ domain })` returns the DNS records - surface them
     VERBATIM. Then `email_domain_check_dns({ id })`, NOT `email_domain_verify`. check_dns resolves
     each DKIM CNAME, the SPF TXT and the DMARC TXT against live DNS and returns `action_items[]`
     naming exactly what is still missing or wrong; `email_domain_verify` only echoes SES's yes/no
     and never reports SPF or DMARC at all. Once `all_valid` is true, `email_domain_set_default`.
     The campaign's from_email must be on that verified domain or the send is refused with
     `domain_unverified`.
 - the CAN-SPAM mailing address (`marketing_mailing_address_set` - all of address, city, state,
     zip_code, country) - footer validation FAILS without a physical address, so NOTHING can send.
2. **Audience:** `email_audience_list` - pick or create. `email_audience_create({ name, kind,
   filter_json })`: `kind: "dynamic"` (default) re-evaluates filter_json at send time, `"static"` is a
   hand-maintained list you fill with `email_audience_members_add({ id, contact_ids })`. Members are
   CRM CONTACTS: get ids via `crm_search_contacts` / `crm_contact_upsert_by_email`.
 - The WHOLE filter_json vocabulary the engine honours, verbatim - the send and the preview run the
     same resolver, so this one list covers both: has_email, include_tags, any_tags, exclude_tags,
     lifecycle_stages, lead_sources, utm_campaigns, lead_statuses, min_lead_score, max_lead_score,
     created_after, created_before, has_deal, deal_status, deal_pipeline_id, deal_stage_ids,
     custom_fields, icp_matched_ids, min_icp_confidence, visited_pages, last_seen_within_days,
     in_journey_stage, engaged_campaign_ids, not_engaged_campaign_ids, has_shopify_order,
     min_shopify_total_spent_cents, max_shopify_total_spent_cents, min_shopify_order_count,
     shopify_last_order_after, shopify_last_order_before.
 - **An unknown key is NOT rejected - it is stored and then ignored.** Neither write path validates
     key names, so `min_score`, `max_score`, `icp_tiers`, `company_ids`, `owner_ids`, `deal_stages`,
     `has_open_deal`, `opened_campaign_ids`, `clicked_campaign_ids`, `shopify_min_orders`,
     `shopify_min_spend`, `shopify_ordered_after`, `unsubscribed`, `suppressed`, `groups`,
     `filter_version` and every other invented name save with a 201 and then narrow NOTHING - the
     campaign goes to everyone the remaining keys allow, including the people the operator meant to
     exclude. Older builds of the tool description advertise several of those names; they are stale,
     and the list above is the authority. Type those names exactly, then read filter_json back
     (`email_audience_list`) and confirm the preview count moved the way you expected before you
     attach the audience to a campaign.
 - The ONLY filter refusal is the contradiction check (400, with a `contradictions[]` body naming
     the colliding keys): a tag both required and excluded, every any_tags value also excluded, an
     inverted lead-score / Shopify-spend / created / last-order range, has_shopify_order:false
     alongside min_shopify_order_count >= 1, the same campaign id in both engaged_campaign_ids and
     not_engaged_campaign_ids, and conflicting custom_fields predicates. It fires on create, on
     update, and when you flip a static audience to dynamic (that hands the stored filter control of
     who gets mailed). Every predicate AND-intersects - there is no OR.
 - Score bounds are min_lead_score / max_lead_score, 0-100, and a contact with a NULL lead_score
     never matches either. has_deal is exactly 'any' | 'open' | 'won' | 'none'; deal_status is an
     exact deal-status slug that combines with 'any'/'none' and is ignored under 'open'/'won'.
 - visited_pages and last_seen_within_days resolve against ClickHouse, and `email_audience_preview`
     DOES size them - same resolver as the send. If ClickHouse is unreachable the resolver throws
     and the preview route answers `Audience not found`, so a 404 on an audience carrying those two
     keys means the analytics backend, not a missing audience.
 - lead_sources and utm_campaigns each match the CURRENT or the FIRST-TOUCH column (lead_source OR
     original_lead_source, utm_campaign OR original_utm_campaign), so a contact attributed to that
     source or campaign at any point qualifies. Exact, case-sensitive equality on the raw stored
     string: "Spring_Promo" does not match "spring_promo".
   Then `email_audience_preview({ id })` - it returns audience_id, total_candidates, deliverable,
   skipped and skipped_breakdown (no_email / suppressed_bounce / suppressed_complaint /
   suppressed_manual / globally_unsubscribed). Report the DELIVERABLE count, not total_candidates,
   and why the rest are skipped. Zero deliverable = the send will be refused, and the response says
   so in a `warning` field. The preview resolves at most 10000 contacts, so an exact 10000 is a
   CEILING, not a count - on a list that big, say the audience is 10000 or more rather than quoting
   it as the size.
3. **Content:** `account_context_get({ domain: "email" })` FIRST (the email department's own
   persona, brand voice, memory and rules; `talk_to_department({ domain: "email", message })` runs
   that agent when you want it to draft or plan for you), then draft via
   `talk_to_department({ domain: "content", message })` - subject (<50 chars) + preview text + HTML +
   plain text. Save it with `marketing_template_create` (layout_json block tree, or raw compiled_html).
   NOT `email_template_create` - that's the transactional store; a campaign cannot use it.
   **Every body you author MUST contain `{{unsubscribe_link}}` (substituted per-recipient) AND the
   account's physical mailing address.** The validator checks the HTML body and the plain-text body
   SEPARATELY, so an inline_text you supply needs both of its own; it wants at least 2 of the address
   components (street / city / state / zip / country) present in the body text, and it warns when the
   account name is missing from the HTML. This runs on the TEST send too, not just the real one - a
   missing token returns `validation_failed` and nothing goes out. Prefer
   `marketing_template_create({ layout_json })` with a `footer` block: it gets this right for free and
   stays editable in the visual builder, which pasted `compiled_html` does not.
4. **Draft:** `email_campaign_create({ name, subject, from_email, audience_id, ... })` - those four
   are required - then read back with `email_campaign_get`.
 - Split test - offer it on any send with a real hypothesis. Two mechanisms, MUTUALLY EXCLUSIVE:
     pass one, never both on the same campaign.
     - `variants` (v2 - prefer it): 2-5 weighted variants on create or update, each with its own
       subject and an optional from_name, assigned deterministically per recipient. Results are
       tool-readable now: `email_campaign_metrics` returns `by_variant` for variant-carrying
       campaigns (step 8) - per-variant opens and clicks CAN be reported.
     - Legacy `ab_test_enabled: true` + `ab_subject_b`: flat 50/50 at materialization, SUBJECT
       ONLY. It also gets `by_variant` in metrics.
     Neither does a body split or auto-promotes a winner - promotion is a decision you bring back
     to the user. And variants are NOT copied by `email_campaign_duplicate`: a cloned winner needs
     its split re-attached (or deliberately dropped) before it goes back through the ladder.
 - `send_in_recipient_tz: true` delivers at the scheduled wall-clock time in each recipient's own
     timezone (contacts with no timezone on file fall back to the campaign's scheduled_for). Offer it
     on any send where local time-of-day matters.
5. **DRY RUN - never skip:** `email_campaign_send_now({ id, dry_run: true })`. It materializes the
   recipient list and reports materialization.totalCandidates / totalQueued / totalSkipped /
   skippedBreakdown WITHOUT sending. Two things a clean dry run does NOT prove:
 - The plan-cap and empty-audience checks only run on the REAL call. A campaign over the monthly
     email cap dry-runs green and then fails 402 on the real send.
 - totalQueued is NOT the number who will receive it. The 7-day per-contact frequency cap is applied
     at DISPATCH by the cron tick, not at materialization, and skippedBreakdown only ever contains
     no_email / suppressed_bounce / suppressed_complaint / suppressed_manual / globally_unsubscribed.
     Run `marketing_frequency_cap_get` HERE, not after the send. If cap > 0, tell the user totalQueued
     is an upper bound.
6. **TEST SEND - never skip:** `email_campaign_test_send({ id, to: [the user's email] })`. Real mail,
   max 5 recipients (more returns a 400), same CAN-SPAM validation as a production send. A reserved
   or test domain in `to` is refused with `reserved_test_address` (the response names the addresses
   and the simulator); a suspended account is refused with `email_service_suspended`. Use the user's
   real mailbox, or success@simulator.amazonses.com for a no-inbox pipeline check.
   Ask the user to confirm the render before ANY real send.
7. **Launch only on explicit approval:** `email_campaign_schedule({ id, scheduled_for })` (future ISO
   timestamp; it runs the same full pre-flight as a real send) or `email_campaign_send_now({ id })`.
   Confirm which, naming the totalQueued count from the dry run. Refusals to relay verbatim:
   `email_service_suspended` (403 - nothing on the account sends until staff lift it; do not retry),
   `audience_not_opted_in` (the account requires opt-in and the audience is visitor-derived, built
   from Visitor Intelligence rather than opted-in contacts - pick or build an opted-in audience),
   `tenant_identity_not_attached` (the verified domain is not attached to the account's SES tenant;
   staff reconcile it), plus empty_audience / plan_cap / domain_unverified / validation_failed.
   An in-flight send can be held with `email_campaign_pause({ id })` (queued rows wait) and
   continued with `email_campaign_resume({ id })`; nothing is re-materialized on resume.
   Dispatch runs on a ~60s cron tick, so it is not instant. `email_campaign_get`
   returns status but NOT total_sent - that field is not in the response, do not look for it. Verify
   the send landed with `email_campaign_metrics({ id })`: status must be 'sent' AND `by_status.sent`
   must be > 0. A 'sent' campaign with `by_status.sent: 0` reached NOBODY.
8. **After:** `email_campaign_metrics({ id })` returns `{ campaign_id, status, by_status, total,
   engagement, by_variant? }` - by_status counts the send rows per status (queued / sending / sent /
   failed / skipped_suppressed / skipped_unsubscribed / skipped_frequency_cap). `engagement` is
   on EVERY campaign, not only variant ones: `{ delivered, opened, clicked, bounced, complained,
   open_rate, click_rate }` - distinct recipients, the rates percentages with one decimal against
   `delivered`, and the whole block `null` until anything has delivered (null is "nothing
   delivered yet", never zero). Campaigns that carry variant data (an N-way `variants` test, or
   the legacy ab_test_enabled pair) ALSO return `by_variant: [{ variant, subject, sent, skipped,
   opened, clicked }]`, so a per-variant rate splits the campaign figure. The limits that remain:
   unsubscribe counts are absent from metrics entirely, and by_variant appears only on
   variant-carrying campaigns.
 - Under-delivered? The skipped_* buckets are the answer. A large skipped_frequency_cap means the
     7-day cap ate the difference (`marketing_frequency_cap_get`); skipped_suppressed /
     skipped_unsubscribed mean the list, not the send, is the problem.
 - Engagement: `engagement` above IS the campaign open and click rate - report open_rate and
     click_rate against `delivered` at any list size, and judge by clicks (Apple MPP inflates
     opens); on a variant-carrying campaign `by_variant` splits it per variant. Per-message
     detail: `email_logs_list({ campaign_id, limit: 500 })` returns that campaign's rows newest
     first with open_count, click_count, delivered_at, bounced_at, complained_at. `campaign_id` is
     a UUID (malformed = 400; another account's campaign = empty list) and the 500-row cap still
     applies, so on a larger send the log is a sample of the newest rows, not the denominator -
     the rate comes from `engagement`, never from counting log rows.
 - Why one specific person didn't get it: `email_suppression_list({ type })` names the individual
     addresses (bounce | complaint | manual | unsubscribe). `email_suppression_remove` REFUSES on
     sticky suppressions (hard bounces and spam complaints) - deliberate, and there is no way around
     it: the address must re-opt-in through a form, it cannot be re-added. `email_subscription_list`
     shows the preference-center lists that appear on unsubscribe pages.
 - `email_campaign_resend_non_openers({ id })` builds a NEW static audience of
     delivered-but-never-opened contacts and clones the campaign against it, landing as a DRAFT. It
     sends nothing - the clone goes back through steps 5-7.
9. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
