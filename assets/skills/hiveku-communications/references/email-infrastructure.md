# Email Infrastructure: Templates, Campaigns, Sequences, Domains, Deliverability

The manual behind Play 7. Load it before creating a template, before scheduling a campaign,
before building a drip, and before answering "why is our email not arriving".

This is the one part of communications that is almost entirely rung 1. There are direct MCP tools
for the whole lifecycle. The difficulty is not reachability, it is that **several parallel
systems share the word "email"** and picking the wrong one wastes an hour and produces a template
nothing can use.

Profile note: every `email_*` tool here is in the communications profile. The
`marketing_template_*` family and everything `crm_*`-prefixed (the CRM templates, the sales
sequences, `crm_email_send_queue_list` and the batch tools, `crm_list_email_suppressions`,
`crm_set_dnc`) resolve only under a broader profile such as `full` - if one fails to resolve,
that is the reason.

## Part 1: The three template families

Read this before creating any template. The families are not interchangeable and the mistake is
not obvious until a campaign refuses the template.

| Family | Tools | Backing store | Consumed by |
|---|---|---|---|
| Transactional | `email_template_create`, `_list`, `_get`, `_update`, `_delete` | `email_templates` | The `/api/v1` transactional send API |
| Marketing | `marketing_template_create`, `_list`, `_get`, `_update`, `_archive` | marketing templates | Marketing campaigns. `email_campaign_create`'s `template_id` points HERE |
| CRM / sales | `crm_create_email_template`, `crm_list_email_templates`, `crm_get_email_template`, `crm_update_email_template`, `crm_delete_email_template` | CRM templates | Sales sequences and one-to-one CRM sending |

**A marketing campaign CANNOT use an `email_template_*` template.** The transactional tools carry
an explicit warning in their own descriptions because people kept trying:
`marketing_campaign.template_id` references a different table entirely. If you build a beautiful
campaign template with `email_template_create` you will not be able to attach it to a campaign,
and nothing tells you until you try.

Rules of thumb:

- Building a broadcast or newsletter the account sends to an audience: **marketing**.
- Building a receipt, password reset, or notification the app fires per event: **transactional**.
- Building a sales touch a rep or sequence sends to one prospect: **CRM**.

### Transactional template shape

`email_template_create({ name, subject, html_content?, text_content?, description?, variables?,
default_from_email?, default_from_name?, default_reply_to? })`. Only `name` and `subject` are
required, and `name` is unique per account - a duplicate is a 409. The body fields are
`html_content` and `text_content`, NOT `html`/`text`, and the From defaults are
`default_from_email`/`default_from_name`, not `from_email`/`from_name`. The route's `bodyParams`
allowlist silently drops any key it does not declare, so the old spellings used to store an
EMPTY-body template on a 201 (and return 200 having changed nothing on update) - if a template
renders blank, this is why. There is no `category` field on this table at all.

`email_template_update` is a partial update: only the fields you pass change. It has no `status`
and no `category` field either; `is_active` is the enable/disable switch, and editing the subject
or either body bumps the template's version.

### CRM template shape

`crm_create_email_template` supports two authoring features worth knowing:

- **Merge tags with fallbacks**: `{{first_name|there}}` renders the contact's first name or
  "there" when it is missing. Always give a fallback on a name tag. A merge tag that misses on a
  live send is the classic "Hi ," email.
- **Spintax for per-recipient variation**: `{Hi|Hey|Hello}` picks one per recipient, which helps
  with deliverability on volume sending by reducing identical-body fingerprints.

Templates created over MCP default to `is_shared: true`, visible account-wide, because a
service-key caller has no human user to own them.

## Part 2: Campaigns

### Finding

`email_campaign_list` lists campaigns, filterable by
`status=draft|scheduled|sending|sent|paused|cancelled|failed` and by `audience_id`.
`email_campaign_get` fetches one, including its inline HTML/text bodies. Resolve the campaign
this way before pausing, cancelling, duplicating or reporting on anything - never operate on a
guessed id, and when asked "what is scheduled to go out", answer from
`email_campaign_list({ status: 'scheduled' })`, not from memory.

### Creating

`email_campaign_create({ name, subject, from_email, audience_id, ... })`. Those four are required.
The rest:

| Argument | Notes |
|---|---|
| `preheader` | The inbox preview snippet. Worth setting; it is the second line a recipient reads |
| `from_name` | Display name |
| `reply_to` | An ARRAY of addresses |
| `domain_id` | A verified `email_domains.id`. See Part 4 |
| `template_id` | Optional `marketing_template.id`, not a transactional one |
| `inline_html` / `inline_text` | Raw body instead of a template |
| `scheduled_for` | ISO timestamp. Omit for a draft |
| `ab_test_enabled` + `ab_subject_b` | Subject-line split test. `ab_subject_b` requires the flag |
| `send_in_recipient_tz` | Deliver at the scheduled LOCAL time per recipient |

Omit `scheduled_for` and you get a draft, which is the safe default while you review.

### Reviewing and sending

The order that avoids embarrassment:

1. `email_audience_preview` to size the audience. Do this before every send, not just the first.
   An audience built on a filter changes as contacts change.
2. `email_campaign_test_send` to yourself or the client. Read the rendered result, especially
   merge tags and the preheader.
3. `email_campaign_schedule`, or `email_campaign_send_now` after explicit confirmation.

**`email_campaign_send_now` must be called with `dry_run: true` first.** The dry run materializes
the recipient list and reports `totalQueued` / `totalCandidates` / `totalSkipped` plus a
`skippedBreakdown`, and sends NOTHING. Only after reading those numbers do you call it again
without `dry_run` to send for real. The send also runs a full pre-flight of its own (marketing
enabled, SES tenant, verified sending domain, CAN-SPAM footer, plan cap, non-empty audience,
template snapshot) and REFUSES rather than silently sending to nobody. Actual dispatch is handled
by a cron tick within about 60 seconds. Confirm the audience size and the from-address out loud
before the real call.

### Managing in flight and after

- `email_campaign_pause` and `email_campaign_resume` for a send in progress.
- `email_campaign_cancel` for a scheduled, draft, or paused campaign. It does NOT take a campaign
  that is already sending: `email_campaign_pause` is the in-flight control.
- `email_campaign_metrics` returns `{ campaign_id, status, by_status, total, engagement,
  by_variant? }`. `by_status` groups the send rows into queued / sending / sent / failed /
  skipped_suppressed / skipped_unsubscribed / skipped_frequency_cap. `engagement` is on EVERY
  campaign: `{ delivered, opened, clicked, bounced, complained, open_rate, click_rate }`,
  distinct recipients, the rates percentages with one decimal against `delivered`, and the block
  is `null` until anything has delivered - report "not yet delivered", never 0%. A campaign
  carrying variants (or the legacy A/B pair) ALSO returns `by_variant` - per-variant sent/skipped
  plus opens and clicks. **Unsubscribe counts are absent either way.** Per-message `open_count`,
  `click_count`, `delivered_at` and `bounced_at` live on `email_logs_list`, which now takes
  `campaign_id` (UUID; malformed = 400, another account's campaign = empty list) and still caps
  at 500 rows, newest first - a sample on a large send, so the rate comes from `engagement`.
- `email_campaign_resend_non_openers` CLONES a sent campaign as a new DRAFT scoped to the contacts
  who did not open the original. The call itself dispatches nothing: you adjust subject and body,
  then schedule it. Weigh the deliverability cost at that scheduling step, because what you are
  about to schedule is a second send to people who already ignored one.
- `email_campaign_duplicate` to clone a proven campaign rather than rebuilding it.
- `email_campaign_update` and `email_campaign_delete` for the rest.

### Stopping queued CRM email: the send queue

The CRM side queues one-to-one and batch sends separately from campaigns, and it has its own
recovery lane (full-profile key - all three are `crm_`-prefixed):

- **`crm_email_send_queue_list`** lists scheduled / sent / cancelled send-queue rows,
  filterable by `status`, `batch_id` or `contact_id`. This is how you see what is about to go
  out and find the batch id.
- **`crm_email_batch_cancel`** cancels all still-queued rows in a batch - **already-sent rows
  are untouched**, so after cancelling, report both numbers: what was stopped and what had
  already left.
- **`crm_email_batch_reschedule`** shifts the fire time of every still-queued row in the batch.

When someone says "stop that email before it sends", speed beats ceremony: identify the batch,
cancel, THEN report what was and was not caught. A campaign is stopped with
`email_campaign_cancel` / `email_campaign_pause` instead; this lane is for the CRM queue.

### The `emailMarketingSendCampaign` node

Firing a campaign from a workflow triggers audience materialization and dispatch via the marketing
cron. Worth knowing because it means the send is not instantaneous at node-execution time; the
cron picks it up.

## Part 3: Sequences, both of them

There are TWO sequence engines and they are separate systems with separate enrollment. Mixing
them up produces "I enrolled the contact and nothing happened".

### Marketing drip: `email_sequence_*`

`email_sequence_create({ name, description?, trigger_kind?, trigger_config? })` where
`trigger_kind` is `manual` (enroll via API), `tag_added`, `form_submit` or `workflow`.

`email_sequence_add_step({ id, kind, delay_seconds?, ... })` where `kind` is:

| kind | Extra arguments |
|---|---|
| `send_email` | `template_id`, or `subject` plus `inline_html` / `inline_text` |
| `wait` | `delay_seconds` |
| `branch_on_engagement` | `branch_condition_json: { check: 'opened' \| 'clicked', within_hours: number }` |
| `tag_action` | - |

`delay_seconds` is the wait BEFORE this step fires, so 0 means immediate. `step_order` is
auto-assigned to max+1, so add steps in the order you want them.

**`email_sequence_activate` is a required, separate step. Nothing fires until it is called.**
A sequence built and enrolled but never activated looks completely correct and sends nothing.
This is the most common silent failure in this part of the surface.

Then `email_sequence_enroll` to add contacts, and `email_sequence_enrollments` to see who is in
flight. `email_sequence_exit` removes someone. `email_sequence_update_step` and
`email_sequence_delete_step` edit the ladder; `email_sequence_archive` sets `is_active: false` and
`is_archived: true`.

**`email_sequence_pause` is DESTRUCTIVE and effectively one-way. It is NOT a temporary hold.**
Confirm with the operator before calling it. It sets `is_active: false`, and existing enrollments
do not survive: as each one next comes due, the sequence tick EXITS it permanently (status
`exited`, `exit_reason` `sequence_inactive`, `next_fire_at` cleared). `email_sequence_activate`
does not bring those contacts back, and `email_sequence_enroll` cannot either, because
`marketing_sequence_enrollment` is unique on `(sequence_id, contact_id)` and the enroll insert
skips duplicates, so re-enrolling an exited contact is a no-op reported as `alreadyEnrolled`. Use
it only to retire a sequence for good.

The `emailMarketingAddToSequence` node enrolls from a workflow and is **idempotent**, so
re-enrolling the same contact is a no-op rather than a double send.
`emailMarketingRemoveFromSequence` exits them with `exit_reason=workflow_removed`.

### Sales sequences: `crm_*`

A different engine: `crm_list_sequences`, `crm_get_sequence`, `crm_enroll_sequence`,
`crm_unenroll_sequence`, `crm_list_sequence_enrollments`, `crm_pause_sequence_enrollment`,
`crm_resume_sequence_enrollment`, `crm_update_sequence`, `crm_update_sequence_step`,
`crm_sequence_clone`, `crm_sequence_status`, `crm_sequence_analytics`, `crm_sequences_compare`,
`crm_delete_sequence`.

These send through a rep's connected Gmail or Outlook rather than the marketing lane, which is why
they live next to `crm_list_email_connections` and why a broken mailbox connection breaks them.

**Run `crm_sequence_spam_check` before activating a sales sequence.** It is cheap and it catches
the copy that gets a sending domain into trouble.

`crm_sequence_clone` copies settings and all steps as a new INACTIVE sequence, optionally
deactivating the source. Cloning is the right way to iterate on a running sequence.

Deeper coverage of sales sequences belongs to the `hiveku-sales-agency` and
`hiveku-outbound-agency` skills. This reference owns the infrastructure they sit on.

## Part 4: Audiences, domains, and sending identity

### Audiences

`email_audience_create`, `email_audience_list`, `email_audience_get`, `email_audience_update`,
`email_audience_archive`. Membership: `email_audience_members_add`,
`email_audience_members_list`, `email_audience_members_remove`.

**`email_audience_create`'s `filter_json` does NOT validate key names.** An unknown key is not
rejected: it is stored, a 201 comes back, and then it narrows NOTHING, so the campaign reaches
everyone the remaining keys allow, including the people the operator meant to exclude. Invented
names like `min_score`, `deal_stages`, `opened_campaign_ids` or `shopify_min_spend` fail exactly
this way, silently. Type the keys exactly and read `filter_json` back before attaching the
audience to a campaign. The whole vocabulary the engine honours:

`has_email`, `include_tags`, `any_tags`, `exclude_tags`, `lifecycle_stages`, `lead_sources`,
`utm_campaigns`, `lead_statuses`, `min_lead_score`, `max_lead_score`, `created_after`,
`created_before`, `has_deal`, `deal_status`, `deal_pipeline_id`, `deal_stage_ids`,
`custom_fields`, `icp_matched_ids`, `min_icp_confidence`, `visited_pages`,
`last_seen_within_days`, `in_journey_stage`, `engaged_campaign_ids`,
`not_engaged_campaign_ids`, `has_shopify_order`, `min_shopify_total_spent_cents`,
`max_shopify_total_spent_cents`, `min_shopify_order_count`, `shopify_last_order_after`,
`shopify_last_order_before`.

Every predicate AND-intersects; there is no OR. `kind: 'dynamic'` (the default) re-evaluates the
filter at send time, `'static'` is a manually maintained list. The only refusal is a 400 with a
`contradictions[]` body when the filter is one no contact can satisfy, such as a tag both required
and excluded or an inverted score range. `email_audience_update` REPLACES `filter_json` wholesale,
so send the complete filter rather than a patch.

**`email_audience_preview` before every send.** It is a SIZING call, not a roster: it returns
`total_candidates`, how many of those are actually deliverable, and WHY the rest are skipped
(unsubscribed, suppressed, no email). It does not list the individual recipients. A campaign whose
audience resolves to 0 deliverable contacts is refused by the send pre-flight, and this tells you
so in one cheap call.

`audienceAddMember` is the workflow node, adding a CRM contact by id or email. Idempotent.

### Sending domains

Order matters and skipping a step produces mail that silently lands in spam:

1. `email_domain_add`
2. `email_domain_check_dns` to see the records and their state
3. Set the records at the registrar, then `email_domain_verify`
4. `email_domain_set_default` if it should be the account default

`email_domain_list` shows current state, `email_domain_get` one domain, `email_domain_delete`
removes one.

**Sending from an unverified domain is a deliverability problem you create for yourself.** DNS
propagation is not instant, so a verify that fails minutes after the records are set usually means
"not yet" rather than "wrong". Re-check before re-editing records.

Dedicated IPs: `email_dedicated_ip_request`, `_list`, `_release`. A dedicated IP needs warming and
is the wrong answer for low volume; do not request one to fix a deliverability problem that is
really a content or list-quality problem.

### API keys and webhooks

`email_api_key_create`, `_list`, `_delete` for the transactional send API. **Never echo a key
value into a report, a log or a commit.**

`email_webhook_create`, `_list`, `_delete`, `_test`, `_rotate_secret` for delivery events. If
delivery events are not arriving, `email_webhook_test` before assuming the send path is broken:
they are different failures with the same symptom.

## Part 5: Deliverability and diagnosis

### The ladder, in order

**1. Can the account send at all?** `email_service_status`. **Read `sending_enabled` FIRST.**
When it is false, a `suspension` block carries the reason and timestamp, and ALL sending is
blocked: SMTP 450s at DATA and the send API refuses, regardless of the healthy-looking reputation
numbers printed below it. Domain reputation reflects history, not current sendability, so reading
reputation first is exactly how people conclude a suspended account is fine.
**Suspensions are lifted by Hiveku staff, not by any tool.** On a suspension, escalate; do not
look for a workaround.

**2. Does the full path work?** `email_deliverability_check({ wait_seconds? })` runs the whole
ladder server-side: suspension state, active API key, verified domain, a real send through the
account's production lane, then waits for the SES delivery event, because **queued is not
delivered**. `wait_seconds` is 5 to 45, default 30. Rate-limited to 3 checks per 10 minutes.
Use this FIRST when signups or notifications stop sending, before any SMTP probing.

**The recipient is ALWAYS the AWS mailbox simulator (`success@simulator.amazonses.com`): the full
pipeline is exercised with zero reputation impact and no human recipient. NEVER invent your own
test address.** On 2026-08-07 two transient bounces from synthetic example.com test sends, on an
account with 20 sends, read to Hiveku's own reputation monitor as a 10 percent bounce rate; it
auto-suspended a blameless tenant, and the suspension path disabled the shared SES configuration
set, stopping every tenant's email for about 5.5 hours. AWS suspended nothing. Test sends to
reserved or test domains are now refused with `reserved_test_address` (`email_campaign_test_send`
names the addresses and the simulator in its response), and `email_campaign_send_now` accepts
`dry_run: true` to materialize and count recipients without sending.

A verdict of `sent_but_no_delivery_event` means the send path works and the event webhook pipeline
is broken. That is a different fix and it makes every downstream metric look wrong.

**3. What happened to specific messages?** `email_logs_list({ limit?, status?, campaign_id? })`
where status is `queued | sent | delivered | bounced | complained` and `campaign_id` (a UUID;
malformed = 400, another account's campaign = empty list) narrows to one campaign's rows, newest
first. Default limit 50, max 500. `email_stats` for the aggregate view.

Read the statuses as a funnel. `queued` and `sent` are not `delivered`. When a user says mail is
not arriving, look for the absence of a `delivered` event rather than the presence of a `sent`
one.

**4. Is the recipient suppressed?** A `bounced` or `complained` address gets suppressed, and every
later send to it is refused rather than attempted, which reads as "the email just never sends for
this one customer". Check `email_suppression_list` and `crm_list_email_suppressions`, and
`crm_get_dnc_status` for the contact.

### Suppression is a feature

`email_suppression_add`, `email_suppression_list`, `email_suppression_remove` manage the marketing
suppression list. `crm_list_email_suppressions` is the CRM-side read.

**To ADD suppression for a person, prefer `crm_set_dnc`**, which is atomic across tables: it
suppresses email globally, suppresses SMS when a phone is present, flips lifecycle to
unsubscribed, and exits active sequence enrollments in one write. Adding a raw suppression row
leaves the contact enrolled in sequences.

`email_suppression_remove` **REFUSES on sticky suppressions, meaning bounces and complaints**,
which are the two cases anyone is ever tempted to clear. Removing one to "fix" a non-delivery is
not merely inadvisable there, the call is rejected outright. That is deliberate: a hard bounce
means the address does not exist and a complaint means someone marked you as spam, and re-sending
to either damages the sending domain for everyone else on it. Removal is for manual and
list-hygiene suppressions, not for a bounce or a complaint.

### The Resend gotcha

Worth carrying because it has burned this codebase: **the Resend SDK does not throw on failure.**
`send()` resolves with `{ data: null, error }`. Any code path that assumes an exception on failure
reports success on a failed send. If you are ever reading builder code in this area, check that
the `error` field is inspected rather than trusting a resolved promise.

## Part 6: Marketing automation nodes (rung 2)

- `emailMarketingSendCampaign` fires a draft or scheduled campaign; audience materialization and
  dispatch go through the marketing cron.
- `emailMarketingAddToSequence` and `emailMarketingRemoveFromSequence`, both idempotent.
- `audienceAddMember`, idempotent.
- `sendEmail` and `emailNotification` (Resend) are the generic send nodes.
- Triggers: `emailMarketingContactSubscribedTrigger`, `emailMarketingLinkClickedTrigger` (filter
  by campaign or by URL fragment), `emailMarketingCampaignFinishedTrigger` (the anchor for
  post-send reporting).
- `crmEmailReceivedTrigger` fires when an inbound email is linked to a CRM contact.

`emailMarketingCampaignFinishedTrigger` is the right hook for automated post-send reporting,
because it fires once the campaign has actually finished sending rather than when it was
scheduled.

## Part 7: Diagnosis quick reference

| Symptom | First move |
|---|---|
| "Stop that email before it sends" | Campaign: `email_campaign_cancel` / `_pause`. CRM batch: `crm_email_send_queue_list` then `crm_email_batch_cancel`. Report what had already left |
| Campaign refuses the template | Wrong family. Campaigns need `marketing_template_*` |
| "Hi ," in a live send | Merge tag with no fallback. Use `{{first_name\|there}}` |
| Sequence enrolled, nothing sends | `email_sequence_activate` was never called |
| Enrolled in the wrong system | Two engines: `email_sequence_*` vs `crm_*_sequence` |
| Nothing sends at all | `email_service_status`, read `sending_enabled` first |
| Signups stopped sending | `email_deliverability_check` before any SMTP probing |
| Metrics all zero but mail arrives | `sent_but_no_delivery_event`: the webhook pipeline |
| One customer never receives | Suppressed by bounce or complaint, or DNC |
| Mail lands in spam | Domain verified? `email_domain_check_dns` then `email_domain_verify` |
| Verify fails right after DNS edit | Propagation. Re-check rather than re-editing |
| Audience bigger or smaller than expected | `email_audience_preview` before the send |
| Audience filter saved fine but excludes nobody | Unknown `filter_json` key: stored, ignored, never rejected |
| Asked for a campaign open or click rate | `email_campaign_metrics` `engagement` (`null` until anything delivered). Per-message rows: `email_logs_list({ campaign_id })`. Unsubscribe counts: no tool |
| Suppression will not clear | Bounces and complaints are sticky. `email_suppression_remove` refuses |
| Paused a sequence, enrollments gone | `email_sequence_pause` exits them permanently. It is not a hold |
| A send succeeded but nothing happened | `queued` and `sent` are not `delivered` |
