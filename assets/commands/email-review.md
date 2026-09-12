---
description: Email program review - stats, winners/losers, next test.
---
Email review. Know what the tools can and cannot tell you before you write a word of this -
`email_campaign_metrics` now carries a campaign-level `engagement` block on EVERY campaign (open
and click rate against delivered, at any list size), so the failure mode this play exists to
prevent has moved: it is no longer inventing a rate, it is quoting one before anything delivered
(the block is `null` then) or reporting an unsubscribe figure, which no tool returns.

1. `email_stats` (account-wide send volume: sent_today / sent_week / sent_month, by_status across all
   email_messages, domain_count, api_key_count - NOT per campaign) + `email_campaign_list`, then
   `email_campaign_metrics({ id })` per recent send. Metrics returns
   `{ campaign_id, status, by_status, total, engagement, by_variant? }` - the send rows counted by
   status (queued / sending / sent / failed / skipped_suppressed / skipped_unsubscribed /
   skipped_frequency_cap); `engagement: { delivered, opened, clicked, bounced, complained,
   open_rate, click_rate }` on every campaign - distinct recipients, rates as percentages with one
   decimal against delivered, `null` until anything has delivered; plus, ONLY on campaigns that
   carry variant data (an N-way `variants` test or the legacy ab_test_enabled pair),
   `by_variant: [{ variant, subject, sent, skipped, opened, clicked }]`. Unsubscribe counts are
   still absent from this tool.
2. **Delivery review** (what the tools DO support): per campaign, sent vs the skipped_* buckets. A
   large skipped_frequency_cap means the 7-day per-contact cap ate the send
   (`marketing_frequency_cap_get`); skipped_suppressed / skipped_unsubscribed mean list health.
   Cross-check the account's sending health with `email_service_status` (read `sending_enabled` first
 - a suspension blocks everything) and list hygiene with `email_suppression_list({ type })`.
3. **Engagement.** `engagement` from step 1 is the campaign read: open_rate and click_rate
   against `delivered`, at any list size - name the winner by CLICKS (Apple MPP inflates opens)
   and quote `delivered` as the N. A `null` block means nothing has delivered yet: say so, do not
   write 0%. Variant-carrying campaigns: `by_variant` splits the same figures per variant, with
   each variant's `sent` as its N. Per-message drill-down: `email_logs_list({ campaign_id,
   limit: 500 })` returns that campaign's rows newest first (open_count, click_count,
   delivered_at, bounced_at, complained_at); still capped at 500 rows, so it is a sample on a
   larger send, never the denominator. Never call opens a win on their own - clicks are the signal.
4. ONE next A/B test recommendation with rationale, and cite the per-variant numbers from step 3:
   "variant B out-clicked A 2.1% to 1.4% on 4,000 sends, so next we test the CTA" beats "we should
   test subjects". Running it: `variants` on `email_campaign_create` / `email_campaign_update` -
   2-5 weighted variants, each with its own subject and an optional from_name, assigned
   deterministically per recipient. MUTUALLY EXCLUSIVE with the legacy `ab_test_enabled: true` +
   `ab_subject_b` pair (flat 50/50, subject only) - pass one mechanism, never both. Still no body
   split and no auto-promotion of a winner: the readout is `email_campaign_metrics` `by_variant`,
   and promoting the winner is a human decision. Variants are NOT copied by
   `email_campaign_duplicate` - re-attach the split on any clone. Tell the client all of that when
   you recommend the test.
5. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
