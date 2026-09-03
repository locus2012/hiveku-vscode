# Tool quirks - known-broken tools and misleading blurbs

Load this file when a tool errors, a result contradicts its own description, or before you lean
on one of the tools named here. Every entry was verified against the MCP server and builder
routes on 2026-08-28; the "Repaired" section records the 2026-08-29 sales-controls wave from
its shipped contracts. A tool blurb is marketing until the route agrees with it.

## Broken today (do not call expecting success)

- **`crm_email_batch_cancel` / `crm_email_batch_reschedule` return 400.** They send `batch_id` /
  `fire_at` while the route behind them requires `batch_group_id` (and `start_at`). To stop or
  move a sequence send, pause or unenroll the enrollment (the dispatcher cancels the queued row at
  dispatch time) or shift the step delay; for a stray one-off row, have the operator cancel it in
  the CRM UI - there is no working MCP cancel for it. Full flow: `references/sequence-program.md`.

## Repaired on 2026-08-29 (the old behaviour left debt in the data)

- **`crm_update_deal` silently DROPPED `lost_reason_code`, `lost_reason` and `won_reason` until
  2026-08-29.** Its input schema lacked all three (and its description was a corrupted code
  block), so the proxy stripped them and the write returned 200 with the code unset. Every close
  made through this tool before that date sits in the `uncoded` bucket of
  `crm_report_loss_reasons` regardless of what the rep passed - backfill them through the
  win/loss review's listed, confirmed batch (`references/win-loss-review.md`), never by pattern.
  Repaired: the three reason fields are declared and written; `owner_id` and `assigned_to_id`
  (user UUIDs on this account - `assigned_to_id` defaults to the owner when only owner is given)
  and `unowned: true` (clears both) are accepted, so "hand this deal to Sarah" is a deal write;
  and flipping `status` to won/lost stamps `closed_at` while flipping back to open clears it.
- **`crm_rep_win_leaderboard` returned EMPTY for every account until 2026-08-29.** It filtered
  on a `closed_won` status nothing writes. It no longer does; it dates on `closed_at` (fallback
  updated_at, counted in `dating.fallback_updated_at_rows`) and reports ownerless wins as an
  `unattributed` line. Do not cite a pre-08-29 empty result as "no wins".
- **"Deals have no closed_at / no owner field" is RETIRED.** `crm_deals.closed_at` exists and is
  stamped by every close writer (pre-existing closes were backfilled from close_date, else
  updated_at - the pre-2026-08-29 rows are the residual proxy); `owner_id` / `assigned_to_id`
  always existed on the row and are now exposed through `crm_update_deal`. Attribution in the
  leaderboard and `crm_report_attainment` is `deal.owner_id`, not the contact owner.

## Misleading blurbs (the tool works, its description lies)

- **`crm_email_send_queue_list` drops its `batch_id` and `contact_id` arguments.** The route
  filters on `batch_group_id` (a name the tool never sends) and never reads contact at all - pass
  status/limit and filter the rows yourself. Its status blurb offers `queued`; real statuses are
  `scheduled` | `sending` | `sent` | `failed` | `cancelled`. Sequence sends carry
  `batch_group_id` = the enrollment id.
- **`crm_pause_sequence_enrollment`'s blurb claims in-flight queue rows still dispatch. Stale.**
  Pausing IS a real stop: before every send the dispatcher re-reads the enrollment and cancels the
  queue row when it is no longer `active` (`last_error: "Enrollment is paused - not active at
  dispatch time"`). Only a row already claimed as `sending` cannot be recalled. Do not repeat the
  blurb's claim to the operator.
- **`crm_inbox_recent` is a SEARCH tool and `query` is required** - a bare call fails validation
  despite the "recent" name. Plain recent-N sweeps use `crm_inbox_list({ folder, limit })`.
- **`crm_integration_sync_configure`'s blurb points at `crm_ghl_import_analyze` /
  `crm_hubspot_import_analyze`.** Those tools do not exist on this MCP surface - build the
  `plan_json` from the incumbent pipeline/deal reads and confirm the mapping with the owner
  (`references/crm-migration-hubspot-ghl.md`).
- **`crm_list_lead_status_options`'s blurb says to call it "before crm_update_contact with a
  lead_status value" - but `crm_update_contact`'s own input schema declares NO lead_status
  property** (its writable set is first/last name, email, phone, job_title, lifecycle_stage,
  owner_id, assigned_to_id, unowned). Whether an undeclared arg survives the proxy is not
  verified; treat a lead_status write through `crm_update_contact` as unverified and re-read the
  contact after writing, or set lead_status at creation.

## Not exposed / not a tool (do not invent the call)

- **`crm_create_sequence` is NOT exposed on this MCP surface** (the department agents have it
  internally). Working paths - clone-and-rewrite, or ask the outbound department to create the
  shell: `references/sequence-program.md`.
- **`crm_payment_integrations` is a dashboard settings surface, not a callable tool**, even though
  the server's own `crm_envelope_send` description names it. No MCP tool reads or writes it; the
  from_email preflight it gates is in `references/quote-to-cash.md`.

## Destructive-by-design semantics (correct behavior that bites)

- **`crm_contact_upsert_by_email` destroys lead_source on create.** It has no lead_source argument -
  an existing contact keeps whatever it had, but a contact CREATED that way is stamped
  `lead_source='upsert'`, and no update tool can fix it afterwards. The full attribution rule
  (search-then-create with lead_source set) is in SKILL.md section 2 - it stays loaded for a reason.
- **`crm_delete_sequence` cascades steps AND enrollments** - history and analytics gone. Deactivate
  (`crm_update_sequence({ id, is_active: false })`) unless the user re-confirms the hard delete
  after hearing what cascades.
- **`crm_estimate_convert_to_invoice` cannot be repeated** (409 if already converted) and revokes
  the portal tokens; **`crm_envelope_send` is one-way** (sent envelopes can only be voided). Both
  flows: `references/quote-to-cash.md`.
- **`crm_contact_email_send` has no draft, no recall, no idempotency key.** Two identical calls are
  two emails in the prospect's inbox. Approval binds to the exact subject + body shown; on an
  ambiguous timeout read `crm_contact_emails_list({ contact_id })` back before ANY retry. The
  recipient is ALWAYS the contact's address on file (cc/bcc add alongside; there is no `to`
  argument), and the send SELF-LOGS to the timeline unless `log_activity: false` - writing
  `crm_create_activity` for the same send double-logs it and corrupts the touch analytics.
- **`crm_contact_email_send`'s default-connection fallback is per platform.** With no
  `connection_id` it picks the account's default SENDABLE mailbox - `is_default` is assigned per
  platform, so a default google_calendar row can never be picked, and a mailbox connected with a
  read-only OAuth scope 400s cleanly with the reason instead of sending. A 400 here is a
  connection problem (`crm_list_email_connections` / `email_connect_start`), never a retry case.
