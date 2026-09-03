/**
 * Department setup playbooks (first-run connect guides) — exported as `setup`
 * strings on deptData departments; written to hiveku-data/<dept>/SETUP.md on
 * export and shown in the console Connect flows. Tool names verified against
 * the MCP server (see each header). Style mirrors PPC_SETUP in deptData.ts.
 */

export const SEO_SETUP = `# Connecting SEO sources (GSC, Bing Webmaster) + first project — verified

Check current state FIRST: \`seo_connections_list\` (connected data sources) + \`seo_list_projects\`
(existing SEO projects). Only run the steps below for whatever is missing.

## STEP 0 (once per account) — the Google OAuth app (BYOK)
\`oauth_app_list({ provider: 'google' })\`; if none covers \`google_search_console\`, the user first sets up
Google Cloud Console (project → enable the **Search Console API** → OAuth consent screen → Web-app client →
Authorized redirect URI must include \`https://app.hiveku.com/api/oauth/google/callback\`), then:
\`oauth_app_create({ provider: 'google', name, client_id, client_secret, products: ['google_search_console'] })\`.
Missing app → \`integration_oauth_initiate\` returns **412 integration_not_configured**.

## Google Search Console
1. \`integration_oauth_initiate({ provider_slug: 'google_search_console' })\` → \`{ setup_url, setup_token, connection_id }\`.
   Hand \`setup_url\` to the user (their browser, their consent).
2. Poll \`integration_oauth_check({ setup_token })\` every ~5s until \`status: 'completed'\` (expires in 15 min).
3. \`seo_gsc_discover_sites({ id: connection_id })\` → the verified properties; \`seo_gsc_list_sites\` also lists them.
   Pick one (use \`sc-domain:<domain>\` if 0 URL-prefix sites are listed).
4. \`seo_connection_update({ id: connection_id, site_url })\` → status flips to **connected**.

## Bing Webmaster (API key — fully connectable from here, no OAuth, no dashboard)
Bing Webmaster is an SEO CONNECTION (same system as GSC/GBP), NOT a generic integration — the live
provider registry rejects \`integration_create({ provider_slug: 'bing_webmaster' })\` with "Unknown
provider_slug". Use:
\`seo_connection_create({ platform: 'bing_webmaster', site_url: 'https://example.com/', api_key })\`
— the user's key from bing.com/webmasters → Settings → API access (if the site isn't in Bing yet, they
click "Import from Google Search Console" there first — one click once GSC is connected). Then
\`seo_sync\` and \`seo_bing_stats\` to verify data flows. (Full organic suite once connected:
\`seo_bing_query_stats\` / \`seo_bing_pages\` / \`seo_bing_crawl_stats\` / \`seo_bing_backlinks\` /
\`seo_bing_submit_sitemap\` / \`seo_bing_submit_url\`.)

## The SEO project + keywords
1. \`seo_create_project({ domain, name, target_country?, target_language? })\` → project_id.
2. Track the initial keyword set — one call per keyword:
   \`seo_track_keyword({ keyword, target_domain })\` (goal_id auto-derives from the domain so they group;
   \`location_code\` defaults 2840/US, \`search_engine\` defaults google).

## First audit + data pull
1. \`seo_run_audit({ project_id })\` → audit_id (there is ONE crawl type; the route ignores any audit_type).
2. \`seo_audit_get({ audit_id })\` → issues + crawl summary once it completes.
3. \`seo_sync({ project_id })\` — full pull of metrics + rankings from all configured connections
   (DataForSEO / GSC / Bing).

## Verify
\`seo_list_rankings({ project_id })\` returns rows, or \`seo_gsc_search_analytics\` returns query data for the
connected site. Then re-run "Download Department Data → SEO" to refresh \`hiveku-data/seo/*.json\`.
`;

export const CRM_SETUP = `# CRM first-run: pipeline, import, inbox, external sync — verified

Check current state FIRST: \`crm_list_pipelines\` + \`crm_list_contacts({ limit: 1 })\`. A default pipeline and
existing contacts mean parts of this are already done — only fill the gaps.

## Pipeline + lead taxonomy
1. \`crm_create_pipeline({ name, stages: [{ name, ... }], is_default? })\` — create the sales pipeline with its stages.
2. Custom lead statuses/sources (system slugs are reserved; slug = lowercase alphanumeric+dash+underscore, ≤40 chars):
   \`crm_add_lead_status_option({ value, label?, color? })\` and \`crm_add_lead_source_option({ value, label?, color? })\`.

## Importing contacts / companies (migrations)
1. **ALWAYS dry-run first**: \`crm_import_preflight({ entity: 'contacts'|'companies'|'deals', rows })\` — returns
   invalid rows + reasons, intra-batch dupes, cross-DB dupes, unknown custom-field keys. Fix at row 0, not row 3,000.
2. \`crm_contacts_bulk_create({ rows, on_duplicate?, auto_create_fields? })\` / \`crm_companies_bulk_create\` —
   **max 5,000 rows per call**; emails normalize to lowercase and (account, email) is unique.
   \`on_duplicate\`: 'skip' (default — dupes dropped, counted in skipped_duplicates) or 'error' (whole batch 409s).
   \`auto_create_fields\` defaults false so typos don't pollute the custom-field schema.

## Email inbox (Gmail / Outlook)
1. \`email_connect_start({ platform: 'gmail'|'outlook' })\` → \`setup_url\` you HAND TO THE USER (valid 5 min;
   they must authorize in their own browser). Prereq: a Google OAuth app with product 'crm_email_calendar' —
   on \`no_oauth_app\`, the owner registers one at /dashboard/settings/oauth-apps (dashboard).
2. Verify: \`crm_inbox_connections\` shows the inbox with \`is_active: true\`.

## Optional — sync from GoHighLevel / HubSpot
1. Check link state: \`crm_ghl_status\` / \`crm_hubspot_status\` → \`{ connected: false }\` means the OAuth link
   is done in the **dashboard** (dashboard), not from here.
2. Once connected: \`crm_integration_sync_configure({ source: 'ghl'|'hubspot', object?, enabled: true,
   frequency_seconds })\` — frequency clamps to [900, 86400], default 3600.

## Verify
\`crm_create_contact\` a throwaway test contact, confirm it appears via \`crm_list_contacts\`, then
\`crm_delete_contact\` it. Then re-run "Download Department Data → CRM" to refresh \`hiveku-data/crm/*.json\`.
`;

export const EMAIL_SETUP = `# Email marketing first-run: sender domain, mailboxes, audiences — verified

Check current state FIRST: \`email_domain_list\` (verified sender domains) + \`email_service_status\`
(providers, send capacity, reputation). A verified default domain means STEP 1 is already done.

## STEP 1 — the sending domain (the gate for everything else)
1. \`email_domain_add({ domain })\` (e.g. "mail.example.com") → returns the DNS records the user must add
   (DKIM / SPF / MAIL FROM / DMARC). Idempotent.
2. The user adds those records **at their DNS host** (dashboard/external — Cloudflare, Route53, registrar; not doable from here).
3. \`email_domain_verify({ id })\` — re-checks SES; repeat until verification + DKIM pass (DNS can take minutes to hours).
4. \`email_domain_set_default({ id })\` — mark it the account's default sender.

## Mailbox identities (Gmail / Outlook for 1:1 send/reply)
1. \`email_connect_start({ platform: 'gmail'|'outlook' })\` → \`setup_url\` for the user (valid 5 min; needs the
   'crm_email_calendar' OAuth app — on \`no_oauth_app\` the owner registers one at /dashboard/settings/oauth-apps).
2. Poll \`email_connections_list\` until the row shows \`connection_status: 'connected'\`.

## First audience
1. \`email_audience_create({ name, kind })\` — 'dynamic' (default) re-evaluates \`filter_json\`
   ({ include_tags?, lifecycle_stages?, lead_sources?, ... }) at send time; 'static' is manually maintained.
2. Static only: \`email_audience_members_add({ id, contact_ids })\`.

## Deliverability event webhooks (optional but recommended)
1. \`email_webhook_create({ name, url, events })\` — response includes \`signing_secret\` **ONCE**; record it
   (HMAC-SHA256 over the raw body verifies X-Hiveku-Signature).
2. \`email_webhook_test({ id })\` — sends a synthetic signed event to prove the receiver works.

## Test send
\`email_send_test({ to, subject?, body?, from?, dry_run? })\` — \`dry_run: true\` validates without sending;
a real send 502s with a hint if the \`from\` domain isn't verified (that's your domain check failing).

## Verify
\`email_stats\` shows the test send in today's counts and \`email_domain_list\` shows the domain verified +
default. Then re-run "Download Department Data → Email" to refresh \`hiveku-data/email/*.json\`.
`;

export const SOCIAL_SETUP = `# Social first-run: accounts, pillars, slots, first draft - verified

Check current state FIRST: \`account_context_get({ domain: 'social', include: 'identity,brand,memory,rules,social' })\`
(the \`social\` section carries the scheduling timezone, pillars, connected accounts and schedule slots; read
\`sections_included\` before calling anything empty), then \`social_list_accounts\` with no filter so picker rows
come back beside the connections. If publishable accounts exist and \`social_pillar_list\` returns pillars, skip
to the verify step.

## STEP 1 - connect the social accounts (dashboard)
Platform OAuth is **dashboard-initiated** - no MCP tool starts a social consent flow, and no tool activates or
disconnects a row (by design). The user connects each account in the Hiveku dashboard (Marketing -> Social ->
connect account). The six publisher slugs, which are both the \`platform\` value on a row and the entries of a
post's \`target_platforms\`: \`linkedin\`, \`twitter\`, \`facebook\`, \`instagram\`, \`tiktok\`,
\`google_business_profile\`. There is no YouTube publisher.

Back here, \`social_list_accounts\` shows each row. Presence is not health - classify every row:
- publishable: \`is_active\` true AND \`connection_status: 'connected'\` AND \`can_post\` true. Only these ids go
  in \`target_accounts\`.
- picker: \`pending_selection: true\` - the login administers several Pages or organizations and a human still
  has to pick one in the dashboard. List it by name; never target it.
- broken: anything else. Read \`last_error\` and \`last_sync_at\`; \`social_account_get({ social_account_id })\`
  shows the granted scopes. \`token_state\` \`expired\` or \`expiring_soon\` (under 7 days) means reconnect before
  scheduling; \`unknown\` is normal for Meta page tokens and GBP (no expiry is recorded, so it cannot be predicted).
A platform the client wants that has no row: \`social_provider_list\` - \`hiveku_native: false\` means the client
registers their own OAuth app (BYOK). When an X row exists the response carries \`quota.x\` (60 published X posts
per Hiveku account per calendar month on the required plan; a soft cap that fails open, so \`remaining\` is
advisory).

## STEP 2 - content pillars (the recurring themes posts hang off)
1. \`social_pillar_list\` - see what already exists; refine what is there rather than create a rival set.
2. \`social_pillar_create({ name, description?, color?, icon?, target_posts_per_week?, target_percentage?,
   auto_tags?, example_topics?, hashtags?, content_guidelines? })\` - only \`name\` is required;
   \`target_posts_per_week\` defaults to 1 and \`target_percentage\` (share of all content) to 20, so set both
   explicitly for 4-6 pillars whose percentages sum to 100. There is no \`cadence\` or \`platforms\` field: the
   proxy sends only the declared fields, so anything else is dropped with no error.

## STEP 3 - schedule slots (when the account wants to post)
\`social_schedule_slot_list\`, then \`social_schedule_slot_create({ weekday, minute_of_day, timezone, label?,
social_account_id? })\` - weekday 0-6 (0 = Sunday), minute_of_day 0-1439 local to the IANA timezone (9:30am is
570); \`social_account_id\` null applies to every connection. Slots describe WHEN; they schedule nothing.
\`social_schedule_slot_next_open\` later offers these times to a plan.

## Verify with a DRAFT post (never publish or schedule during setup)
1. \`social_post_validate({ content, target_platforms: [<one slug>], target_accounts: [<publishable id>] })\` -
   a dry run: writes nothing and reports every platform problem in one round trip. Run it before ANY post is
   ever scheduled, not only here.
2. \`social_create_post({ title, content, target_platforms: [<one slug>], target_accounts: [<publishable id>],
   pillar_id? })\` - pass \`target_accounts\`, OMIT \`scheduled_at\`. Setting \`scheduled_at\` IS the publish: the
   every-minute cron ships the post on the first tick after that instant with no further confirmation. Do NOT
   call \`social_publish_post\` either - it does not publish an unapproved post, it stages it into the dashboard
   approval queue (\`pending_approval\`), and there is deliberately no approve tool.
3. Confirm it exists (\`social_get_post\` / \`social_list_posts({ status: 'draft' })\`), then clean up:
   \`social_delete_post\`.
4. \`social_analytics_summary\` - the tool advertises \`from_date\` / \`to_date\`, but the route reads only a
   \`period\` the proxy never sends, so the answer is ALWAYS the last 7 days of published posts (with the previous
   7 days for comparison) plus the active accounts. Zeros are fine on a fresh account; an error means the
   account connection is broken. For a real window use \`social_posts_analytics_list\` (per post) or
   \`social_analytics_by_dimension({ from_date })\`.

After connecting, re-run "Download Department Data -> Social" to refresh \`hiveku-data/social/*.json\`
(accounts, posts, pillars, calendar, comments, hashtags, slots, analytics-summary).
`;

export const OUTBOUND_SETUP = `# Outbound cold email: first run

Cold email runs on SmartLead. The dashboard connect form posts a hardcoded \`provider: 'smartlead'\` and does not let the user pick a provider, and \`cold_email_integrations\` is unique on (account_id, provider). Campaign creation, lead creation and \`outbound_campaign_status_set\` all refuse a non-SmartLead integration with 412 \`unsupported_provider\`. There is no HeyReach or LinkedIn outreach connector in the product today: no route, no tool, no schema column, and the only mention anywhere is one code comment. Log LinkedIn and other out-of-band touches into the CRM instead, with \`crm_contact_upsert_by_email\` (requires \`email\`) and \`crm_create_activity\`.

## Step 0. Read current state
Call \`connections_status\` (no arguments). It returns a one-shot integration inventory including cold email, each row carrying provider, \`is_active\`, \`sync_status\`, \`last_synced_at\`. It does not return the integration UUID. Do not use \`integration_list\` for this check: it reads the separate \`account_integrations\` table, while the outbound tools read \`cold_email_integrations\`.

## Step 1. Connect SmartLead in the dashboard
\`integration_create\` accepts only the API-key providers \`bing_webmaster\` and \`dataforseo\`; every other provider gets a 422 carrying a \`dashboard_url\`. So connect SmartLead by hand at Marketing -> Outbound -> Cold Email -> Settings. The form collects an API key only. When no integration exists yet the Cold Email page opens on the Settings view.

## Step 2. Obtain integration_id
\`outbound_create_campaign\` requires \`name\` and \`integration_id\`. Read it from \`outbound_list_integrations\` (id, provider, is_active per its registry description; arguments not verified here), which works on an account with zero campaigns. Existing \`outbound_list_campaigns\` rows also carry it; reuse the value for later calls.

## Step 3. Connect sending mailboxes on the SmartLead side
With no healthy inbox, \`outbound_health_status\` pushes the blocker "No connected email accounts. Add and verify at least one inbox." and subtracts 40 from \`readinessScore\`. No MCP tool adds or configures cold-email mailboxes: mailbox settings, warmup control and sending schedules stay in SmartLead. Agent-visible views: the \`inboxHealth\` array from \`outbound_health_status\` (email, status, warmupScore, dailySent, dailyLimit) and the per-mailbox \`outbound_list_email_accounts\` inventory (read-only).

## Step 4. Seed sales assets
\`outbound_add_sales_asset\` requires \`asset_type\` and \`name\`, and also accepts \`description\`, \`url\`, \`content\`, \`use_cases\`, \`persona_tags\`. \`asset_type\` is documented as pricing | calendar | case_study | one_pager | demo | other; the route does not enforce that list, so pass those exact values. Read assets back with \`outbound_list_sales_assets({ is_active: 'true' })\`, because with no \`is_active\` filter the list includes retired assets.

## Step 5. First campaign and leads
1. \`outbound_create_campaign({ name, integration_id })\` sends the NAME ONLY upstream. The schema also accepts \`sequences\`, but those are written to the local row only and the upstream SmartLead campaign comes back empty; a 201 with your sequences on the local row puts no steps on the provider. Write the steps by tool: \`outbound_campaign_sequences_save({ campaign_id, sequences })\` first returns a preview (\`replacing\`, \`with\`, \`merge_tags_used\`, \`warnings\`) - show it, get the yes, re-call with \`confirm: true\`. It is a FULL REPLACE of the provider's steps, bodies are plain text, and on confirm it re-reads the provider and refreshes the local mirror. Verify with \`outbound_campaign_sequences_get({ campaign_id })\` (\`source: 'provider'\`, \`steps_with_content\`). Activation is \`outbound_campaign_status_set({ campaign_id, status: 'START' })\` - preview first, then \`confirm: true\`; it refuses 409 \`no_sequence_steps\` until the provider holds a step with content. Refusals on create: 404 (integration not found, inactive, or not owned), 412 \`unsupported_provider\`, 412 \`integration_missing_key\`, 502 \`upstream_failed\`.
2. \`outbound_create_lead({ campaign_id, email })\` adds one lead per call; the bulk path is \`outbound_leads_bulk_create\` (up to 100 leads per call per its registry description; arguments not verified here). Optional fields include \`first_name\`, \`last_name\`, \`company_name\`, \`job_title\`, \`phone\`, \`linkedin_url\`, \`website\`, \`location\`, \`custom_fields\`. A 409 \`upstream_rejected\` means the address is a duplicate or on the global block list; skip it rather than retrying. On success the row lands as \`status: 'pending_sync'\` with \`external_id\` set to \`pending-<timestamp>\` until the next sync reconciles it. That is normal. While \`external_id\` still starts with \`pending-\`, \`outbound_update_lead\` applies local fields only and returns a warning saying so.

## Replies
The \`/api/cron/sync-smartlead-inbox\` route pulls replies for each active integration, classifies each into sentiment, classification, and priority, and writes the threads that \`outbound_list_inbox\` reads. No Hiveku tool subscribes to SmartLead reply events directly. Answer a reply by saving a draft with \`outbound_save_reply_draft({ thread_id, body_text })\` (saving never sends), showing it, and on the operator's yes calling \`outbound_reply_draft_send({ draft_id, confirm: true })\`; without \`confirm: true\` it previews the draft, recipient and in-reply-to message and sends nothing. To push provider events into a workflow, call \`workflow_provision_webhook({ name })\`, which returns \`{ workflow_id, webhook_url, trigger_id }\` in one shot, and paste \`webhook_url\` into SmartLead's own webhook settings. Do not use \`email_webhook_create\` here: it writes Hiveku's own \`email_webhooks\` table, which covers Hiveku's own email sends.

## Verify
\`outbound_health_status\` returns a \`readinessScore\` with an empty \`blockers\` array, \`outbound_campaign_sequences_get({ campaign_id })\` shows \`steps_with_content\` above 0 before any START, \`outbound_list_leads({ campaign_id })\` returns the test leads, and \`outbound_list_inbox({ thread_status: 'needs_reply' })\` responds.`;

export const ACCOUNTING_SETUP = `# Accounting first run: settings, categories, vendors, payroll roster, one test bill

One transport rule before anything else: the MCP proxy sends only the arguments a tool's own inputSchema declares (or its \`bodyParams\` allowlist, where one exists). Anything else is dropped before the request leaves, so a real-sounding but undeclared field returns a success response with that field unset and no error. Pass only the parameters named below.

## 1. Read current state
\`accounting_vendor_list\`, \`accounting_member_list\`, \`accounting_expense_category_list\`. Rows already present mean the account is partly set up, so fill gaps only. \`accounting_expense_category_list\` auto-seeds industry preset categories on its FIRST call, so call it before anything else reads categories.

## 2. Settings (before the first bill)
\`accounting_settings_get\`, then \`accounting_settings_update({ bill_prefix?, default_currency?, default_payment_terms? })\`. All three are optional and they are the only fields the tool declares. No dashboard page reads or writes them, so this is the surface for them.

\`bill_prefix\` is baked into every generated bill number as \`{prefix}-{YYYY}-{padded6}\`, and existing bills are not renumbered, so set it before creating anything. \`next_bill_number\` is not writable through this tool.

\`default_currency\` and \`default_payment_terms\` are stored labels with no consumer in the builder. Bill creation applies its own \`USD\` default for currency and never copies terms from settings. Set a bill's \`currency\` and \`terms\` on \`accounting_bill_create\` itself.

## 3. Expense categories
Custom categories: \`accounting_expense_category_create({ name, code?, sort_order? })\`. \`name\` is required and is unique per account; the constraint counts archived rows, so a reused name returns 409 and creates nothing.

\`sort_order\` defaults to 0 and the list orders \`sort_order\` asc then \`name\` asc. The seeded presets are written at ascending \`sort_order\` in preset order (0, 1, 2, ...), so a new category left at 0 sorts to the TOP, ahead of every preset at 1 or higher. Pass a high \`sort_order\` to file it after the presets.

## 4. Vendors (accounts payable)
\`accounting_vendor_create({ name, email?, phone?, default_payment_terms?, tax_id?, is_1099?, notes? })\`. \`name\` is the only required field, and those are all the fields the create tool declares.

- The create tool also advertises \`target_currency\`, but \`accounting_vendors\` has no such column and the route drops it. Payout currency is a payroll MEMBER field, not a vendor field.
- \`tax_id\` and \`is_1099\` are stored and rendered in the vendors table. No 1099 generator, report or export reads them, so do not tell a user that 1099 filing is handled.
- \`default_expense_category_id\` is NOT a create parameter. Set it afterwards with \`accounting_vendor_update({ vendor_id, default_expense_category_id })\`. A category id owned by another account 400s that whole call with \`Unknown default expense category\`.
- To retire a vendor, prefer \`accounting_vendor_update({ vendor_id, is_archived: true })\`. That hides it from \`accounting_vendor_list\` and is reversible with \`is_archived: false\` as long as you kept the id. \`accounting_vendor_delete({ vendor_id })\` reads no body, takes no confirm field, does not check for open bills, and no Olympus tool undoes it.

## 5. Payroll members
\`accounting_member_create({ name, email?, pay_rate?, pay_rate_type?, pay_period?, target_currency? })\`. Only \`name\` is required and everything else defaults (\`pay_rate\` 0, \`pay_rate_type\` hourly, \`pay_period\` bi_weekly, \`target_currency\` USD), so pass them explicitly or you seed a roster of zero-rate members.

\`pay_rate\` is in DOLLARS, not cents: per hour when \`pay_rate_type\` is \`hourly\`, per period when \`fixed\`. The route multiplies by 100, and read surfaces report it back as \`pay_rate_cents\`. \`pay_rate_type\`: hourly | fixed. \`pay_period\`: weekly | bi_weekly | semi_monthly | monthly.

\`source_currency\` is not a parameter of \`accounting_member_create\`. It is declared on \`accounting_member_update({ member_id, ... })\` and on \`accounting_payroll_run_create\`. \`bill_rate\` is also on \`accounting_member_update\` only, and it is DOLLARS as well.

To take someone off payroll, use \`accounting_member_update({ member_id, status: 'inactive' })\`. Payroll run creation selects members on \`status: 'active'\` and never reads \`is_archived\`, so archiving alone leaves them being paid.

Runs come later: \`accounting_payroll_run_create({ period_start, period_end })\`, both YYYY-MM-DD and both required.

## 6. Payment processors are not configured here
Charging customers (Hiveku Payments, your own Stripe, Authorize.Net) is configured in the Hiveku dashboard under Commerce settings. No MCP tool registers a processor. On the A/P side, \`accounting_bill_record_payment\` records a payment in the books and does not transfer funds.

## 7. Verify with one test bill, and clear it before any payment
1. \`accounting_bill_create({ vendor_id, line_items: [{ description, quantity, unit_cents }] })\`. Both \`vendor_id\` and \`line_items\` are required. The bill is created as \`draft\` and its \`bill_number\` is generated for it. \`unit_cents\` is cents. \`tax_bps\`, if you pass it, is document tax in basis points (875 = 8.75%).
2. \`accounting_bill_submit({ bill_id })\` moves draft to submitted. It has three refusals: 404 for an unknown or cross-account id, 409 \`Cannot submit a bill in status "..."\` for anything not draft (which is what a retry after a success hits), and 400 \`Add at least one line item before submitting\` when the total is 0 or less.
3. \`accounting_ap_aging\` returns six scalar sums and nothing else (\`current_cents\`, \`d1_30_cents\`, \`d31_60_cents\`, \`d61_90_cents\`, \`d90_plus_cents\`, \`total_cents\`), so do not look for this bill in the response. Watch \`total_cents\` move, and only on an account quiet enough for the delta to mean something. It buckets bills in status submitted, approved, open and partially_paid, so a draft bill is not in it and reading aging before step 2 proves nothing.
4. \`accounting_bill_void({ bill_id, reason? })\`, then \`accounting_ap_aging\` again and expect \`total_cents\` back where it started.
5. \`accounting_pnl_summary({ period_start?, period_end? })\` returns \`revenue_cents\`, \`expenses_cents\`, \`profit_cents\` and \`margin_bps\`. It is cash basis and counts recorded bill PAYMENTS as expenses, not open bills, so an unpaid test bill should not move it in either direction.

Do not record a payment against the test bill. Once \`amount_paid_cents\` is above 0, \`accounting_bill_void\` returns 409 with \`This bill has payments recorded and cannot be voided. Reverse the payments first.\`, and \`accounting_bill_delete\` refuses on the same condition. The tool registry has no payment reversal, refund or payment-delete tool, so that advice cannot be followed from MCP and the bill stays in the books.

Then re-run "Download Department Data -> Accounting" to refresh \`hiveku-data/accounting/*.json\`.`;

export const CREATIVE_SETUP = `# Brand & Creative first-run: brand guide, logo, fonts, voice, avatars - verified

Check current state FIRST: \`brand_guide_list\` + \`customer_avatar_list\` + \`media_library_list({ limit: 1 })\`.
Existing rows mean the account is partly set up - fill the gaps only. The brand guide comes before ANY
visual work: it is what \`account_context_get({ domain: "branding" })\` and every brand-aware image, design
and video call reads (there is no "creative" chat domain - \`branding\` is the visual-system domain).

## STEP 1 - the brand guide (the foundation everything else reads)
Two ladders - pick by what exists:
1. **Scrape-grounded** (preferred when the business has a live site): \`web_scrape({ url,
   formats: ["branding", "markdown"] })\` on the homepage and /about - the \`branding\` format extracts the
   site's colors, fonts and logo candidates; the markdown carries the voice. Then
   \`brand_guide_create({ name, color_primary, color_secondary?, color_accent?, brand_voice?,
   brand_personality?, font_heading_family?, font_body_family?, tagline?, industry?, is_default: true })\` -
   \`name\` and \`color_primary\` (hex \`#rrggbb\`) are the two required fields.
2. **Manual interview** (no site, or a rebrand): ask for the primary + supporting colors, heading/body
   fonts, three personality words and a one-line voice note, then the same \`brand_guide_create\`.
Refine anytime with \`brand_guide_update({ guide_id, ... })\`. Delete is SOFT (\`brand_guide_delete\` flips
is_active=false, restorable via \`brand_guide_update\`), then \`brand_guide_purge\` for hard - never purge a
guide that existing designs reference.

## STEP 2 - the logo (nothing DRAWS a logo)
Upload the user's real logo files: \`media_upload({ file_name, content: <base64>, mime_type })\` per variant
(primary, icon, dark/light) → \`brand_guide_set_logo({ guide_id, logo_primary_url, logo_icon_url?,
logo_dark_url?, logo_light_url? })\` with the returned URLs. No tool draws a logo and \`generate_image\` must
not be used for one - a missing logo is a design project first (the designer lane's \`design_create\`,
approved by the human in the dashboard), then upload the exported file here.

## STEP 3 - fonts + voice
Standard families: \`brand_guide_update({ guide_id, font_heading_family, font_body_family })\`. Self-hosted
fonts: \`brand_guide_font_create({ guide_id, font_family, display_name, weight?, style?, css_font_face })\` -
\`css_font_face\` is the ONLY field the generated brand CSS emits; file URLs alone register a font no page
ever loads. Uploaded fonts render in server exports (\`design_export_image\` / \`design_export_mp4\` /
\`design_publish_to_library\` / the storyboard final render): a font that fails to load degrades to the
fallback stack with a line in the export's \`warnings\`, never a failed render, so prove a new font with one
export and read \`warnings\`. \`css_font_face\` is screened at the worker: only \`@font-face\` blocks with
http(s) or \`data:\` font URLs survive. Written voice: \`brand_guide_update({ guide_id, brand_voice,
brand_personality })\`. Approved video narrators are read-only here:
\`brand_guide_voiceovers_get({ brand_id? })\`.

## STEP 4 - customer avatars, grounded
Per avatar: \`customer_avatar_create({ name, description? })\` → \`customer_avatar_populate({ entity_id,
urls_to_scrape: [homepage, /about, service pages], search_queries?, agent_notes: <interview notes> })\` -
populate refuses without grounding, which is why research comes first. 2-3 avatars cover most accounts.

## Verify
1. \`brand_guide_get({ guide_id })\` shows the colors, fonts and \`logo_primary_url\`.
2. \`media_image_quota\` first (no arguments; a null \`remaining\` is unlimited or a failed read, never
   zero), then ONE test asset: \`generate_image({ prompt })\` - brand-aware by default; the response's
   \`brand_applied\` says whether the guide landed, and \`brand_skipped_reason: "no_active_brand_guide"\`
   means STEP 1 is not active yet - it auto-registers a media_asset, so confirm the row appears via
   \`media_library_list({ source_type: "ai_generated", limit: 5 })\`.
Then re-run "Download Department Data → Brand & Creative" to refresh \`hiveku-data/creative/*.json\`.
`;
