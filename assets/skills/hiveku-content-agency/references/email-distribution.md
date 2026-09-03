# Email distribution mechanics

Load this file before building, sending, cancelling, or reporting on any email campaign or
newsletter. The full step-by-step procedure is `/hiveku:email` - this file carries the traps.

## Send gates, in order (run BEFORE drafting a word)

Sends are GATED, and the gates fail at SEND time, not at build time - a campaign drafted against
a suspended account or an unverified domain is fully built before anything tells you it can never
go out.

1. `marketing_setup_status` - do not build until `ready_to_send: true`. One call listing every
   condition that silently blocks a campaign send (marketing enabled, not paused/suspended, SES
   tenant, VERIFIED sending domain, CAN-SPAM mailing address), each failing check carrying a `fix`.
2. `email_service_status` - read `sending_enabled`. setup_status does not check account-level SES
   suspension, and only Hiveku staff can lift one. `sending_enabled` is a kill switch, not a
   readiness check: true means only "not suspended". The two lanes (campaign vs transactional)
   are provisioned independently - `ready_to_send: false` alongside `sending_enabled: true` is
   normal and both are correct.
3. `email_audience_list` / `email_audience_preview` - size the audience and report the
   DELIVERABLE count, not the raw one (`total_candidates`, deliverable, and WHY the rest are
   skipped: unsubscribed / suppressed / no email).

## CAN-SPAM body requirements

Every body you author needs `{{unsubscribe_link}}` and the account's physical mailing address,
in the HTML body and in the plain-text body separately, or CAN-SPAM validation fails the TEST
send as well as the real one. The address comes from `marketing_mailing_address_get` (also
returns `can_spam_complete`); if unset, `marketing_mailing_address_set` requires ALL of address,
city, state, zip_code, country - confirm the address with the owner first, it appears in the
footer of every marketing email they send.

## The send ladder (no rung skipped, ever)

`email_campaign_create` for a dedicated send, or `email_newsletter_create` for a
newsletter-shaped draft (a convenience wrapper that pre-fills inline_html from body_html and
returns ONE draft campaign - there is no recurring or scheduled-digest behavior in it). Then:

1. `email_campaign_send_now({ id, dry_run: true })` - materializes the recipient list and reports
   totalQueued / totalCandidates / totalSkipped + skippedBreakdown WITHOUT sending anything.
2. `email_campaign_test_send` (max 5 addresses) - test recipients are the user's own team
   addresses, named by the user. A "test send" to a real customer is a send.
3. Only then `email_campaign_schedule` / `email_campaign_send_now`, with explicit confirmation of
   audience + send time. Dispatch is a cron tick within ~60s of a send_now.

Safety valve: `email_campaign_cancel` cancels a scheduled, draft, or paused campaign - if a
schedule was confirmed in error, cancel FIRST, then discuss. `email_campaign_list` (filter by
status/audience) and `email_campaign_get` (includes inline bodies) are how you review what exists
before creating near-duplicates; `email_campaign_duplicate` clones a past winner as a new draft.

## Two template stores - do not cross them

`marketing_template_create` / `marketing_template_list` / `marketing_template_get` /
`marketing_template_update` are the store a CAMPAIGN's `template_id` can reference (and what the
Templates tab shows). Author with `layout_json` (the visual builder's block tree, compiled
server-side, stays editable in the builder) in preference to raw `compiled_html`.
`email_template_list` is the TRANSACTIONAL template store for the /api/v1 send API - a marketing
campaign CANNOT use those rows. The names invite the mix-up; the stores are different tables.

## Metrics - the canonical contract (stated once, here)

`email_campaign_metrics` per send returns `{ campaign_id, status, by_status, total, engagement,
by_variant? }`. by_status is the DELIVERY review - sent vs the skipped_* buckets is why a send
under-delivered. `engagement` is on EVERY campaign, not only variant ones: `{ delivered, opened,
clicked, bounced, complained, open_rate, click_rate }` - distinct recipients, the rates
percentages with one decimal against `delivered`, and the whole block is `null` until anything
has delivered (report "not yet delivered", never 0%). So a campaign open or click rate IS
reportable from this tool at any list size. `by_variant` appears ONLY on campaigns that carry
variant data (an N-way `variants` test, or the legacy ab_test_enabled pair): `[{ variant,
subject, sent, skipped, opened, clicked }]`, per-variant opens/clicks derived from email_events,
splitting the campaign figure per variant. What is STILL absent: unsubscribe counts - no tool
returns them, omit rather than estimate. Per-message detail lives on
`email_logs_list({ campaign_id, limit: 500 })` - open_count / click_count / delivered_at /
bounced_at / complained_at, that campaign's rows newest first (`campaign_id` is a UUID: malformed
= 400, another account's campaign = empty list) - still capped at 500 rows, so on a larger send it
is a sample of the newest rows and never the denominator: the rate comes from `engagement`, never
from counting log rows. Judge by clicks, not opens (Apple MPP inflates opens). And variants are
NOT copied by `email_campaign_duplicate` - re-attach the split on any clone before it re-enters
the ladder.

## Health floors

Click rate 1-3 percent is normal, unsubscribes under 0.3 percent, spam complaints under 0.1
percent. Click rate comes from `email_campaign_metrics` `engagement.click_rate` (and per variant
from by_variant); the complaint side from `engagement.complained` against `delivered`, or per
message from `email_logs_list({ campaign_id })` (complained_at, 500-row cap); the unsubscribe
floor is dashboard-only - no tool returns unsubscribe counts, say so rather than estimate.
Breach the floors -> pause volume, fix segmentation
(`email_audience_list` review, `email_suppression_list` for who is already burned) before
sending more.

## Client report delivery (marketing_report_*)

The monthly deliverable rides this rail:
1. `marketing_report_create` - creates the scheduled client report row, returns it including its
   `public_token` (marketing reports are PUBLIC by DEFAULT - the share link is the point) and
   stamps `next_scheduled_at` so the scheduler cron delivers on cadence. Set
   `delivery_config.recipients` (the addresses `marketing_report_send` emails).
2. `marketing_report_regenerate` - rebuilds the numbers NOW and stores them; the public page and
   the emailed summary render the stored blob verbatim, so regenerate is the only way numbers
   change. Does not email anyone, does not advance the schedule. Can take a while (live ad-data
   pulls). Run after create and before every send/share.
3. `marketing_report_share_link` - the public URL the client opens, no login. Read-only; returns
   `url: null` with a fix-it note when the report is not public (`marketing_report_update` with
   `is_public: true` mints the link; `is_public: false` on a marketing report REVOKES it).
4. `marketing_report_send` - REAL MAIL lands in the client's inbox, so it is confirm-gated:
   first call WITHOUT `confirm` returns a preview (title + exact recipient list + the URL to be
   mailed) - show it to the user; re-call with `confirm: true` (strict boolean) only on their
   yes. Emails the CURRENT stored numbers - regenerate first if stale.

`marketing_report_update` changes name, cadence (re-stamps `next_scheduled_at`), sections,
recipients, active flag, visibility. `marketing_report_pdf` exists for PDF export (no registered
behavioral contract - verify output before promising it). There is NO `marketing_report_list` /
`marketing_report_get` tool - keep the report id from the create response in the standing
strategy memory or you cannot address the report again.

## Sequences

Evergreen pieces can feed a nurture sequence: that has its own ordering rules (activate BEFORE
enrolling) - follow `/hiveku:sequence`.
