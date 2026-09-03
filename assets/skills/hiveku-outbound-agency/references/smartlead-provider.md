# SmartLead + sending infrastructure - wiring, warmup, ramp, windows, DNS verification

Load this for first-run setup, deliverability infrastructure work, or anything touching
SmartLead's own REST surface.

## SmartLead = the email sending engine

Mailboxes, warmup, sending schedules, and suppression live there and are configured in the
SmartLead dashboard - no Hiveku tool sets a mailbox, a warmup setting, or a sending schedule.
Campaign sequence steps also live there, but they are now READ and WRITTEN by tool
(`outbound_campaign_sequences_get` / `outbound_campaign_sequences_save`, full replace,
preview-gated); campaign pause / start / stop is `outbound_campaign_status_set`; the provider's
own analytics are `outbound_campaign_analytics_get`; and a saved reply draft is sent through
the provider by `outbound_reply_draft_send`. Signatures, previews, and refusal tables:
`references/tool-traps.md`. REST:
`https://server.smartlead.ai/api/v1/...?api_key=...` - campaigns, leads, sequences,
email-accounts, analytics, webhooks (fire on reply/bounce/unsubscribe). Example documented in
the worker template: `GET /api/v1/campaigns/{id}/leads?api_key=...&reply_received=true`.
Any endpoint beyond these: (verify against current provider docs) - do not invent paths.

**SmartLead is the ONLY Hiveku cold-email provider.** The dashboard connect form hardcodes
`provider: 'smartlead'`, and `cold_email_integrations` is unique on (account, provider) with
SmartLead the only writer. Provider-gate census - which tools 412 `unsupported_provider` on
anything else:

- The CREATE tools: `outbound_create_campaign` and `outbound_create_lead` carry the gate
  (verified); `outbound_leads_bulk_create` is likewise SmartLead-only by design (its 100-lead
  cap IS SmartLead's batch cap), though its exact refusal code on a non-SmartLead campaign is
  unverified.
- The five sales-controls tools, every one of which hits SmartLead:
  `outbound_campaign_status_set` (412 `unsupported_provider` and 412 `integration_missing_key`
  verified, plus 422 `campaign_not_synced` when the campaign has no numeric provider id),
  `outbound_campaign_sequences_get`, `outbound_campaign_sequences_save`,
  `outbound_campaign_analytics_get`, and `outbound_reply_draft_send`. All five answer 412
  `unsupported_provider` on a non-SmartLead campaign and 412 `integration_missing_key` when the
  SmartLead integration is inactive or has no key (one shared loader behind the five routes).
- `outbound_update_lead` has NO provider gate (it applies the local update and returns 200 with
  a `warning`), and the draft SAVE, objections, sales-asset and sequence-learning tools are pure
  Hiveku-side tables with no provider check at all - `outbound_save_reply_draft` writes a row,
  `outbound_reply_draft_send` is the one draft tool that touches the provider.

## First-run wiring (once per account)

1. Check state: `integration_list` + `outbound_list_campaigns` (each campaign row carries the
   `integration_id` of its provider connection). NOTE: `integration_list` / `integration_test`
   are full-profile-only (no scoped profile grants `integration_`) - on a scoped key, read the
   `integration_id` off `outbound_list_campaigns` rows instead, and treat an unknown-tool error
   here as key scope, not an outage.
2. Connect **SmartLead** in the **Hiveku dashboard** (Marketing -> Outbound -> settings). The form
   takes a SmartLead API key; the provider is implicit and not selectable - there is no HeyReach
   option, and there will not be one until the integration is built. Connect is dashboard-ONLY:
   `integration_create` accepts only bing_webmaster and dataforseo; everything else 422s with a
   dashboard URL. `integration_test({ integration_id })` live-checks credentials for integrations
   that support it.
3. Put `SMARTLEAD_API_KEY` into `automations/.env` (gitignored) so local workers can poll the
   provider directly - plus `HEYREACH_API_KEY` only if this account actually runs HeyReach
   out-of-band. Keys go in BOTH places: dashboard connect feeds the Hiveku outbound tools; `.env`
   feeds the local workers. Never in code or commits.
4. Seed the account's sales assets so reply drafting has something real to reference:
   `outbound_add_sales_asset({ asset_type, name, url?, content?, use_cases?, persona_tags? })`
   with `asset_type` one of pricing | calendar | case_study | one_pager | demo | other. The
   calendar link is the minimum - without it every positive reply improvises a booking step.
5. Reply events: `workflow_provision_webhook({ name })` -> `{ webhook_url, trigger_id }`; paste
   `webhook_url` into the provider's own webhook settings to push replies into a Hiveku workflow.
   Otherwise rely on Hiveku's own inbox sync plus the reply-triage worker. (`email_webhook_create`
   covers Hiveku's OWN email send events, NOT provider replies - never use it for this.)

## Infrastructure

Never send cold from the client's primary domain. Use 2-3 lookalike secondary domains, 2-3
mailboxes each, SPF + DKIM + DMARC on every one, and a custom tracking domain per sending domain
(shared tracking domains inherit other senders' reputations).

### Verifying DNS instead of asserting it (Hiveku-side sending domains)

For domains managed as Hiveku sending domains (`email_domain_list`), the go/no-go must rest on a
tool read, not an operator claim:

- `email_domain_check_dns` - live per-record DNS validity for a sending domain: resolves every
  record the user was told to publish (each DKIM CNAME, the SPF TXT, the DMARC TXT) against
  public DNS and reports present / missing / wrong, with a ready-to-relay `action_items[]` list.
  Use this - not `email_domain_verify` - to guide a user through publishing DNS and to confirm
  records are valid.
- `email_domain_verify` - re-checks SES's view of overall verification + DKIM only. It does NOT
  say which record is missing and SES never reports SPF/DMARC; it is the coarse check, not the
  diagnostic.
- `email_deliverability_check` - ONE call answering "can this account actually DELIVER email
  right now": suspension state, active API key, verified domain, then a REAL send through the
  production SES lane, waiting for the delivery event. The recipient is ALWAYS the AWS mailbox
  simulator - full pipeline exercised, zero reputation impact, no human recipient. **NEVER
  invent your own test addresses.** Verdict `sent_but_no_delivery_event` means the send path
  works but the event pipeline is broken. Rate-limited to 3 checks per 10 min.

Scope honesty: these three verify HIVEKU's sending lane. SmartLead cold-email domains are
configured and warmed inside SmartLead - for those, `email_domain_check_dns` can still confirm
the public SPF/DKIM/DMARC records resolve (DNS is DNS), but warmup and placement live in
SmartLead's own dashboard/analytics. Record the check output (all_valid, action_items) as the
evidence artifact for the pre-launch gate; a checkbox with no tool output behind it is an
assertion, not a check. All `email_*` tools are visible on marketing / marketing-email / full
keys, NOT on a sales key.

## Warmup

Every new mailbox warms 2-3 weeks in Smartlead's warmup pool BEFORE any cold send, and warmup
stays ON at reduced volume while sending. Warmup mechanics/settings: (verify against current
provider docs).

## Volume ramp

New domain/mailbox starts at 10-20 cold sends/day/mailbox. Increase 10-20% per week.
Steady-state ceiling ~50/day/mailbox. Total campaign volume = mailboxes x per-box cap; scale by
adding mailboxes/domains, never by cranking per-box volume.

If the client has declared their own caps in account memory, those win when lower. Absent any
declared ceiling, these defaults ARE the ceiling - "no configured cap" never means uncapped.

## Sending windows

Recipient-timezone business hours (roughly 8am-5pm local, Tue-Thu strongest), randomized
intervals between sends - Smartlead handles the humanized spacing; configure the schedule per
campaign in the SmartLead dashboard. Sending schedules stay provider-side: no outbound tool
reads or sets one, and `outbound_campaign_status_set` starts or stops the campaign, it does not
change when it sends.
