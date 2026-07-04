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
1. \`seo_run_audit({ project_id, audit_type: 'technical' })\` (also: 'content', 'mobile') → audit_id.
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

export const SOCIAL_SETUP = `# Social first-run: accounts, pillars, first draft — verified

Check current state FIRST: \`social_list_accounts\` — connected platform accounts with \`is_active\`.
If accounts exist and pillars exist (\`social_pillar_list\`), skip to the verify step.

## STEP 1 — connect the social accounts (dashboard)
Platform OAuth (Instagram / Facebook / LinkedIn / X / TikTok / YouTube) is **dashboard-initiated** — there is
no MCP tool that starts a social consent flow. The user connects each account in the **Hiveku dashboard**
(Marketing → Social → connect account). Back here, \`social_list_accounts\` shows each new row; treat
\`is_active: "true"\` as connected. Account IDs from this list are what posts target.

## STEP 2 — content pillars (the recurring themes posts hang off)
1. \`social_pillar_list\` — see what already exists before creating.
2. \`social_pillar_create({ name, description?, cadence?, platforms? })\` — e.g.
   cadence "2x/week", platforms ["instagram", "linkedin"]. Create 3-5 pillars covering the brand's themes.

## Verify with a DRAFT post (never publish during setup)
1. \`social_create_post({ title, content, target_platforms, target_accounts?, pillar_id? })\` — omit
   \`scheduled_at\` and do NOT call \`social_publish_post\`; the post stays an unpublished draft.
2. Confirm it exists (\`social_get_post\` / \`social_list_posts\`), then clean up: \`social_delete_post\`.
3. \`social_analytics_summary({ from_date?, to_date? })\` — returns totals across platforms; zeros are fine on
   a fresh account, an error means the account connection is broken.

After connecting, re-run "Download Department Data → Social" to refresh \`hiveku-data/social/*.json\`.
`;

export const OUTBOUND_SETUP = `# Outbound (cold email / LinkedIn) first-run: Smartlead + HeyReach — verified

Check current state FIRST: \`integration_list\` (account-level integrations) + \`outbound_list_campaigns\`
(cold-email campaigns; each row carries the \`integration_id\` of its provider connection).

## STEP 1 — connect Smartlead / HeyReach (dashboard)
\`integration_providers_list\` shows valid slugs + \`can_create_from_cli\` — but \`integration_create\` only
accepts API-key providers **bing_webmaster** and **dataforseo**; everything else 422s with a dashboard URL.
Cold-email providers (Smartlead, HeyReach) are connected in the **Hiveku dashboard** (dashboard —
Marketing → Outbound → settings), which writes the provider row the outbound tools read.
After connecting, \`outbound_list_campaigns\` rows expose the \`integration_id\` to pass to create calls.
For account integrations created here, \`integration_test({ integration_id })\` live-checks credentials.

## STEP 2 — local reply-triage worker keys (workspace, not Hiveku)
Put \`SMARTLEAD_API_KEY\` and \`HEYREACH_API_KEY\` into \`automations/.env\` (gitignored) so the local
reply-triage automation can poll the providers directly. The framework is scaffolded by the
"Hiveku: Scaffold Local Automations" command and documented in \`.claude/AUTOMATION.md\`; schedule with
\`node automations/manage.mjs create --id reply-triage --cron "17 9-17 * * 1-5" --worker reply-triage\`.

## STEP 3 — the first campaign + leads
1. \`outbound_create_campaign({ name, integration_id, sequences? })\` — creates the campaign upstream too.
   SmartLead is the only provider with a create path today; other providers return **412 unsupported_provider**.
2. \`outbound_create_lead({ campaign_id, email, first_name?, company_name?, linkedin_url?, ... })\` per lead.
   Update later with \`outbound_update_lead\`.

## Reply events — webhook or polling
There is no Hiveku tool that subscribes to Smartlead/HeyReach reply events directly. Two options:
- \`workflow_provision_webhook({ name })\` → \`{ webhook_url, trigger_id }\` in one shot; paste \`webhook_url\`
  into the provider's own webhook settings (dashboard — on the Smartlead side) to push replies into a workflow.
- Otherwise rely on polling via the local reply-triage automation worker (STEP 2).
(\`email_webhook_create\` covers Hiveku's OWN email send events, not provider replies — don't use it for this.)

## Verify
\`outbound_list_leads({ campaign_id })\` returns the test leads, and the worker dry-runs clean:
\`node automations/manage.mjs run --id reply-triage\`. Then re-run "Download Department Data → Outbound".
`;

export const ACCOUNTING_SETUP = `# Accounting first-run: vendors, payroll members, first bill cycle — verified

Check current state FIRST: \`accounting_vendor_list\` + \`accounting_member_list\`. Existing vendors/members
mean the account is partially set up — only fill the gaps.

## Vendors (accounts payable)
\`accounting_vendor_create({ name, email?, target_currency, default_payment_terms?, tax_id?, is_1099? })\` —
\`target_currency\` is the Wise payout currency (e.g. USD, PHP); \`is_1099\` flags year-end 1099 reporting
(pair it with \`tax_id\`).

## Payroll members
\`accounting_member_create({ name, email, pay_rate, pay_rate_type, pay_period, target_currency })\` —
\`pay_rate\` is in **DOLLARS** (per hour when pay_rate_type='hourly', per period when 'fixed');
\`pay_period\`: weekly | bi_weekly | semi_monthly | monthly. Runs come later via \`accounting_payroll_run_create\`.

## Expense categories (chart of accounts)
\`accounting_expense_category_list\` — first call **auto-seeds** industry defaults for the account. Use these
category ids on bill line items so the P&L groups correctly. There is NO create tool — adding custom
categories beyond the seeded set is (dashboard).

## Payment processors (dashboard)
Charging customers (Hiveku Payments / BYO Stripe / Authorize.net) is configured in the **Hiveku dashboard**
(dashboard — Commerce/Billing settings); no MCP tool registers a processor.

## Verify with a draft bill cycle (safe — void before any payment)
1. \`accounting_bill_create({ vendor_id, line_items: [{ description, quantity, unit_cents, category_id? }],
   due_date? })\` — creates a DRAFT bill; \`unit_cents\` is cents, \`tax_bps\` is basis points (875 = 8.75%),
   bill_number auto-generates.
2. \`accounting_bill_void({ bill_id, reason? })\` — voids it so it never hits expenses or A/P. (Void is refused
   once a bill has payments — a fresh draft always voids cleanly.)
3. \`accounting_ap_aging\` — the voided bill must NOT appear in any bucket.
4. \`accounting_pnl_summary({ period_start?, period_end? })\` — returns revenue/expenses/profit in cents.

Then re-run "Download Department Data → Accounting" to refresh \`hiveku-data/accounting/*.json\`.
`;
