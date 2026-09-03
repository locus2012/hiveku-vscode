# Integrations: What Is Connected, and How to Get It Connected

The cross-cutting manual for every "is X connected?" and "X is not connected" moment on a Hiveku
account. Several skills point here. Read it before you report that a tool failed for lack of a
connection, and before you tell a user to go do something in a dashboard.

Every tool name below was extracted from the MCP server source
(`hiveku-mcp-api-server/src/tools/*.ts`) and every behaviour was read from the tool's own
description or the builder route behind it. Where a tool's description and its route disagree,
this file says so and the route wins.

Profile visibility: `connections_status` and every `integration_*` / `oauth_*` tool in this file
are full-key surface - no scoped profile grants those prefixes. The per-department readers
(`seo_connections_list`, `ppc_connection_list`, `email_connections_list`, `social_list_accounts`,
`shopify_connection_status`, `voice_diagnose_setup`) do reach their departments' scoped keys. On a
scoped key, diagnose with the department reader and say plainly that the disabled-connection check
in Part 2 needs a full key - a soft-deleted connection is invisible to the department readers.

---

## 1. The rule

**When a tool fails because an integration is missing or dead, running the diagnosis and handing
over a working setup link is part of answering. Reporting the failure is half a job.**

The sequence is always the same:

1. Run `connections_status`. One call, the whole inventory.
2. Identify which of the three layers is actually wrong (Part 3). The three failure modes look
   different and need different fixes.
3. Either fix it with a tool, or hand the user a real `setup_url` plus what they will see when
   they open it (Part 5).
4. Say what you will do once they confirm, and then do it.

"Google Ads is not connected" is not an answer. "Google Ads has no connection on this account.
Here is a link that connects it: <setup_url>. It opens Google's consent screen, you approve, and
it expires in 15 minutes. Tell me when you are through and I will bind the customer id and run
the first sync" is an answer.

Two things a session can never do, and should say plainly rather than pretending to attempt:

- **Open the consent page.** The user has to be signed into their own Google, Meta or Shopify
  session in their own browser. You generate the URL; they click it.
- **Anything in the Google Cloud Console.** Creating a project, enabling an API, editing the OAuth
  consent screen, adding a redirect URI, adding a test user, publishing the app. All of it needs
  console access you do not have.

---

## 2. The inventory

### `connections_status` is the one-shot read

No arguments. Call it first, before any SEO, Paid Ads, email or LLM work, instead of calling five
department readers one at a time. It returns five arrays under `data`:

| Key | Covers | Per-row fields |
|---|---|---|
| `seo` | GSC, Bing Webmaster, GBP, Google Analytics | `platform`, `display_name`, `site_url`, `site_url_bing`, `gbp_account_id`, `connection_status`, `is_active`, `last_synced_at` |
| `ppc` | Google, Meta, Microsoft/Bing, LinkedIn, TikTok, Amazon | `platform`, `display_name`, `customer_id`, `ad_account_id`, `connection_status`, `is_active`, `last_synced_at` |
| `email` | Gmail and Outlook mailboxes | `platform`, `email_address`, `connection_status`, `is_active`, `push_enabled`, `last_synced_at` |
| `cold_email` | Cold-email sequencers | `provider`, `is_active`, `sync_status`, `last_synced_at` |
| `llm` | BYOK model keys | `provider`, `is_active`, `last_used_at` |

**What it does NOT cover: social publishing accounts.** Meta/Instagram, LinkedIn, X, TikTok and
GBP-as-a-posting-destination live in `social_accounts` and are read with `social_list_accounts`
(filters: `platform`, `is_active`, `connection_status`). Its own description says so. Reporting
"nothing social is connected" off `connections_status` is wrong every time.

Two more absences: **Shopify** is not in it (`shopify_connection_status`) and **voice** is not in
it (`voice_diagnose_setup`).

### `connections_status` is the only reader that shows a disabled connection

This is the single most useful thing about it and it is easy to miss. The per-department readers
all hard-filter `is_active: true` at the route, with no parameter to turn that off:

- `seo_connections_list` filters `is_active: true`
- `ppc_connection_list` filters `is_active: true`
- `email_connections_list` filters `is_active: true`

`connections_status` applies **no** `is_active` filter and returns the flag on every row. So a
connection that was soft-deleted (`integration_delete` and `seo_connection_delete` are both
soft deletes that set `is_active = false`) or deactivated is **invisible** in its own
department's list and **visible** in `connections_status` as `is_active: false`.

Practical consequence: "there is no Google Ads connection" from `ppc_connection_list` and "there
is a deactivated Google Ads connection" from `connections_status` are different diagnoses with
different fixes. Reactivating beats recreating, because recreating loses the bindings.

### The per-department readers, and what each one adds

| Tool | Table | Adds over `connections_status` |
|---|---|---|
| `seo_connections_list` | `seo_connections` | The row `id` (needed by every SEO/GTM/GA4 tool), `last_error`, and `has_client_id` / `has_client_secret` / `has_refresh_token` / `has_api_key` booleans |
| `ppc_connection_list` | `ppc_connections` | The row `id`, `manager_id`, `business_id`, `campaign_count`, `last_error`, and `has_developer_token` / `has_refresh_token` / `has_access_token` booleans. Optional `platform` filter |
| `ppc_connection_get` | `ppc_connections` | One row by UUID |
| `email_connections_list` | `email_connections` | The row `id`, **`scopes`**, `last_error`, `is_default`, `display_name` |
| `crm_inbox_connections` | `email_connections` | Identity only. Does NOT carry health |
| `crm_list_email_connections` | `email_connections` | Identity plus which Hiveku user owns the mailbox |
| `integration_list` | `account_integrations` | The generic OAuth/API-key table. `provider_slug` and `is_active` filters, `credentials_preview` (masked), `last_synced_at` |
| `integration_get` | `account_integrations` | One row by id (accepts `integration_id` or `id`) |
| `oauth_app_list` | `oauth_apps` | The OAuth CLIENT registrations. This is layer (a) and nothing else reads it |
| `oauth_app_get` | `oauth_apps` | One client by `oauth_app_id` |
| `integration_providers_list` | `integration_providers` | Valid `provider_slug` values, `auth_type`, `can_create_from_cli` |
| `shopify_connection_status` | Shopify connections | Optional `shop_domain` filter. Sanitized rows, never tokens |
| `marketing_setup_status` | Email-marketing send readiness | `ready_to_send` plus `blockers[]` with a fix per blocker |
| `voice_diagnose_setup` | Voice provisioning | `tenant_provisioned`, DIDs, DIDs missing E911, counts, `blocking_issues[]` |
| `social_list_accounts` | `social_accounts` | Social publishing accounts |
| `analytics_diagnose_tracking` | Deployed site | Not a connection reader. Diagnoses tracking IN the site's code and deployed pages |

Two live-test tools, and note which surface each one covers:

- `integration_test({ integration_id })` tests an **`account_integrations`** row. For a Google
  provider it runs a real token refresh, so success proves the refresh token is still good. It
  updates `last_synced_at` on success.
- `ppc_connection_test({ id })` tests a **`ppc_connections`** row with a live API call, which
  verifies OAuth and permissions.
- **There is no `seo_connection_test`.** Do not reach for it. To verify an SEO connection, run
  `seo_sync`, or call the capability you actually want and read the error.

### Beware `integration_providers_list` on a young account

It reads the `integration_providers` table, and rows in that table are **auto-created lazily** the
first time an account completes an OAuth connection for a provider that has no row yet. It is not
a static catalogue of everything Hiveku supports. On a fresh account it can be nearly empty, and
that emptiness means nothing about what is connectable. Use it to confirm a slug and to read
`can_create_from_cli`; do not use it to conclude a provider is unsupported.

`auth_type` and `can_create_from_cli` are derived, not stored: exactly two slugs are treated as
API-key providers creatable from here, `bing_webmaster` and `dataforseo`. Everything else reports
`auth_type: "oauth"` and `can_create_from_cli: false`.

---

## 3. The three layers

**This is the part that makes the difference between diagnosing in one call and reverse-engineering
for twenty minutes.** A Google integration can fail at three independent levels. All three must be
true for a tool to work, and each one fails with a different symptom.

### Layer (a): the OAuth CLIENT, registered for that PRODUCT

Two kinds of client can front a consent. An account may bring its own `client_id` and
`client_secret`, registered as an `oauth_apps` row whose `products` array says which Hiveku products
it may drive (BYOK). And for Google Analytics, Search Console, Business Profile, Google Ads,
Calendar and Microsoft Ads, Hiveku runs its own platform apps - the dashboard's Quick connect uses
them, and so does `integration_connect_link_create` whenever the account has no tagged app. A
connection made that way has `oauth_app_id: null`; that is normal, not broken, and it must be
re-authenticated under the SAME platform app (a connect link with `target_connection_id` does
this). Gmail and Outlook are BYOK only. `integration_connectors_list` says, per connector, which
client would be used on this account (`client.would_use`) and what is missing when neither exists.

**A client registered for `google_search_console` and `google_ads` cannot serve `google_analytics`.**
The product match is exact. This is the layer people miss, because from the outside "we already
have a Google app" sounds like it should cover Google.

- **Reveals it:** `oauth_app_list` (per app: `id`, `provider`, `name`, `client_id`,
  `client_id_preview`, `products`, `created_at`). The `client_secret` is never returned by any read
  endpoint.
- **Symptom:** `integration_connect_link_create` returns HTTP **412** `code: 'no_oauth_client'`
  with the exact prerequisite in `hint` (only when neither a tagged app nor a Hiveku platform app
  exists). `integration_oauth_initiate` returns 412 `no_oauth_app_for_product` /
  `integration_not_configured`; `email_connect_start` and `shopify_connect_start` return
  `code: 'no_oauth_app'`. No amount of retrying changes any of them.
- **Fix without losing what exists:** `oauth_app_update({ oauth_app_id, add_products: [...] })`.
  `add_products` MERGES into the existing array. `products` REPLACES it, and replacing is how you
  silently break the products the app was already serving. Use `add_products` unless you mean to
  replace.
- **Fix from nothing:** `oauth_app_create({ provider, name, client_id, client_secret, products })`,
  all five required, plus optional `notes`. The `name` must be unique per (account, provider).
  This needs credentials the user fetches from their console, and the console work itself is theirs
  (Part 4).

The product slugs, exactly: `crm_email_calendar`, `google_calendar_meet`, `google_ads`,
`google_search_console`, `google_business_profile`, `google_analytics`, `microsoft_ads`,
`meta_ads`, `shopify_storefront`, `social_meta`, `social_linkedin`, `social_x`, `social_tiktok`.

One schema caveat worth knowing: `oauth_app_list` and `oauth_app_create` declare
`provider` as an enum of `google | microsoft | meta`, while the route accepts
`google | microsoft | meta | shopify | linkedin | x | tiktok`. The MCP server itself does not
validate arguments against the declared schema, but your client may. **Call `oauth_app_list()`
with no `provider` filter and filter the result yourself.** That works regardless.

`oauth_app_delete` is a HARD delete. Every `email_connections` / `ppc_connections` /
`seo_connections` row that referenced it gets `oauth_app_id` set to null and loses its refresh
path, so each of those connections then needs a fresh OAuth run. Prefer `oauth_app_update` for
rotations.

### Layer (b): the CONNECTION row, existing and active

The client is the credential. The connection is the authorization plus the binding. They live in
different tables and one does not imply the other.

- **Reveals it:** `connections_status` for the sweep including disabled rows, then
  `seo_connections_list` / `ppc_connection_list` / `email_connections_list` / `integration_list`
  for the row `id` and `last_error`.
- **`connection_status` vocabulary is `pending | connected | error`** on both `seo_connections`
  and `ppc_connections`.
- **`is_active` is the enabled flag, not health.** A row can read `is_active: true` and
  `connection_status: 'error'` at the same time. Diagnose on `connection_status` and `last_error`.
- **`pending` means authorized but unbound.** GSC has no `site_url` picked yet; Google Ads has no
  `customer_id`; GBP has no `gbp_account_id` + `gbp_location_id`. The credentials are fine. The
  fix is a binding call, not a reconnect: `seo_gsc_discover_sites` then `seo_connection_update`,
  or `ppc_ads_discover_customers` then `ppc_connection_update`, or `seo_gbp_discover_locations`
  then `seo_connection_update`. Status auto-promotes to `connected` the moment the final
  identifier lands.
- **Symptom of a missing row:** a 412 or 404 from the department tool saying no connection is
  configured, on an account whose OAuth is provably alive.

**The mirror gap, which produces exactly that symptom.** `integration_oauth_initiate` writes to
`account_integrations`. The department tools read `seo_connections` and `ppc_connections`. Two
mechanisms bridge that: the OAuth callback mirrors on completion, and `seo_connections_list` /
`ppc_connection_list` run an idempotent backfill from `account_integrations` on every read. Both
mechanisms cover exactly three slugs: **`google_search_console`, `google_business_profile`,
`google_ads`**. Neither covers `google_analytics`. See Part 6.

### Layer (c): the granted SCOPES

The consent screen grants a scope set. A connection can be freshly authorized, active, bound and
syncing, and still hold a token that cannot reach the API you need, because the scope was never
requested or was requested before Hiveku added it.

- **Reveals it, when it can be revealed at all:**

  | Surface | Scope reader |
  |---|---|
  | `email_connections` (Gmail/Outlook) | `email_connections_list` returns a `scopes` field |
  | `account_integrations` | `integration_list` returns `credentials_preview`, and `scope` is on the unmasked-metadata allowlist, so the granted scope string comes back in the clear |
  | `seo_connections` platform `google_analytics` | `seo_ga4_admin_scopes({ connection_id })` returns `granted_scopes` (the full array from Google), plus `has_analytics_edit` and `can_write` |
  | `seo_connections` platform GSC / GBP, and all of `ppc_connections` | **Nothing reads the scopes.** Those tables have no `scopes` column |

- **Consequence for GSC, GBP and every ad platform: you cannot preflight the scope. You discover
  the shortfall from the 403.** Read the error rather than retrying; the good ones name the fix.
- `seo_ga4_admin_scopes` has a precondition worth knowing before you rely on it: it returns
  **400** if the connection has no `ga_property_id` picked. It is a GA4-property-scoped route, so
  it can only report scopes once a property has been selected.
- **Symptom:** HTTP 403 with Google's "insufficient authentication scopes". For GTM specifically
  the route translates that into a message naming the two publish scopes and telling you to
  reconnect.
- **Fix:** re-run the consent flow for that provider so a new token is minted with the current
  scope set. Adding a scope to Hiveku's request list does nothing for tokens already issued.

### Why three layers matter

They fail independently, so the diagnosis is not a ladder you can short-circuit:

- Layer (a) wrong, (b) and (c) irrelevant: you cannot even generate a `setup_url`. 412.
- Layer (a) right, (b) missing: the connect flow succeeds, the dashboard looks healthy, and the
  department tool says no connection is configured. 404 or 412 from the department tool.
- Layers (a) and (b) right, (c) short: everything reads healthy, the sync runs, and one specific
  capability 403s.

---

## 4. Connecting, by provider

### Google Ads, Search Console, Business Profile, Analytics: `integration_oauth_initiate`

`provider_slug` is required and its enum is exactly
`google_ads | google_search_console | google_business_profile | google_analytics`.

**Returns:** `setup_token`, `setup_url`, `provider_slug`, `provider_display_name`, `scopes`,
`oauth_app_id`, `connection_id`, `expires_in_seconds` (**900, fifteen minutes**), a `polling`
block, and an `instructions` string. HTTP 201.

**`connection_id` is the domain-table row id (`ppc_connections` or `seo_connections`), and it is
`null` unless the route created or targeted such a row.** It is not the same id
`integration_oauth_check` later returns. See the trap at the end of this section.

Three paths through the same tool:

1. **First-time setup with bindings.** Collect the platform fields from the user in conversation
   and pass them; the route pre-creates the domain row with them populated, so when OAuth
   completes the status promotes straight to `connected` with no second call.
   - `google_ads`: `customer_id` (10 digits, no dashes), `manager_id` (the MCC id, required
     whenever the client account sits under an MCC, because Google needs it as
     login-customer-id on every call), `developer_token` (BYOK, from the MCC's API Center).
   - `google_search_console`: `site_url`, either `sc-domain:example.com` or `https://example.com/`.
   - `google_business_profile`: `gbp_account_id` (`accounts/<id>`) and `gbp_location_id`
     (`locations/<id>`).
   - For GSC and GBP those bindings are normally discovered AFTER consent
     (`seo_gsc_discover_sites`, `seo_gbp_discover_locations`), so omitting them is the usual case.
2. **Re-auth of a dead refresh token.** Pass `target_connection_id` pointing at the existing
   `ppc_connections` or `seo_connections` row. Credentials are replaced in place, **bindings are
   preserved**, and status promotes back to `connected`. This is the right move whenever
   `integration_test` reports the account was deleted, or a sync starts failing with OAuth errors.
   Prefer it over deleting and recreating, which throws away the bindings.
   `target_connection_id` is valid for `google_ads` (a `ppc_connections` row) and for
   `google_search_console`, `google_business_profile` and `google_analytics` (all
   `seo_connections` rows — a GA4 connection IS one, and `seo_connections_list` shows it).
   `google_gmail` / `google_calendar` have no domain-specific table: call initiate without
   a target and `account_integrations` is updated in place.
3. **Bare initiate.** No bindings, no target. Use it for a FIRST connect, and for
   `google_gmail` / `google_calendar`, which have no domain-specific row to target. It returns
   `connection_id: null`. (It used to be the only shape available for `google_analytics`; GA4
   re-auth now takes its `seo_connections` id like the other Google surfaces.)

**`integration_oauth_initiate` is explicitly NOT for Gmail or Calendar.** Passing `google_gmail`
or `google_calendar` returns 400 `code: 'wrong_tool_for_provider'`, because this route writes to
`account_integrations` and the CRM inbox, calendar and triage tools read `email_connections`.

**OAuth app resolution:** explicit `oauth_app_id` if you pass one (validated for account ownership
AND product match), otherwise the first per-account `oauth_apps` row matching
(provider `google`, product for that slug). Neither resolving is the 412 in layer (a).

**Poll with `integration_oauth_check({ setup_token })`.** Statuses: `pending`, `completed`,
`failed` (read `error`), `expired` (15 minutes, call initiate again). Recommended interval 5
seconds; give up after about 15 minutes.

**The id trap on completion.** On `completed`, `integration_oauth_check` returns
`integration_id`, and that is an **`account_integrations`** row id. Passing it to
`ppc_connection_test`, `seo_connection_update` or any other department tool gets you a 404 for a
connection that exists. The domain-table id is the `connection_id` from the **initiate** response,
or whatever `seo_connections_list` / `ppc_connection_list` returns after the backfill runs.

### Gmail, Calendar and Meet: `email_connect_start`, never `integration_oauth_initiate`

- `platform`: `gmail` (default) or `outlook`.
- `scope_label`: default `modify_with_calendar` (Gmail read/send/modify plus Google Calendar plus
  Meet read-only). Alternatives `readonly`, `send`, `modify`.
- `user_email` or `user_id`: which Hiveku user OWNS the connection. Optional on a solo account,
  **required on a multi-user account**.
- `consumers`: `['crm']` by default; `['helpdesk']` routes inbound mail to `helpdesk_tickets`.
- Optional `oauth_app_id` and `display_name`.
- Returns a `setup_url` **valid for 5 minutes** (`expires_in_seconds: 300`). That is a third of
  the `integration_oauth_initiate` window. Send it when the user is ready to click.
- Prereq is a Google OAuth client with product `crm_email_calendar`. Missing it returns
  `code: 'no_oauth_app'`, which is a handoff to the account owner, not a transient failure.
- Verify by polling `email_connections_list` for `connection_status: 'connected'`.

### Bing Webmaster and other BYOK SEO sources: `seo_connection_create`

The route's `platform` enum is exactly `bing_webmaster | google_search_console |
google_business_profile`. **`google_analytics` is not accepted here.**

- **Bing Webmaster is the easy one and needs no OAuth at all:**
  `seo_connection_create({ platform: 'bing_webmaster', site_url, api_key })`. The key comes from
  bing.com/webmasters, Settings, API access.
- **GSC as BYOK:** `client_id`, `client_secret`, `refresh_token`, `site_url`. The refresh token
  must carry `https://www.googleapis.com/auth/webmasters`, the FULL scope. The `.readonly` variant
  makes sitemap submit and delete 403.
- **GBP as BYOK:** `client_id`, `client_secret`, `refresh_token`, then bind
  `gbp_account_id` + `gbp_location_id` with `seo_connection_update`.
- Idempotent on (account, platform, site_url): re-running returns the existing row with
  `existed: true` rather than a P2002.
- Rows land `connection_status: 'pending'`. Verify with `seo_sync`, since there is no
  `seo_connection_test`.

`seo_connection_update` accepts `site_url`, `gbp_account_id`, `gbp_location_id`, `display_name`,
`is_active` and `gtm_container_path`. **It does NOT accept `ga_property_id`**, which matters in
Part 6. `gtm_container_path` is clear-only: send `null` or `''` to clear the pin; passing a value
is refused with 400, deliberately, because a settable pin would let one request bind a connection
to a stranger's container.

`integration_create` is the other BYOK door, into `account_integrations`. Only API-key providers
can be created from here (`bing_webmaster`, `dataforseo`); OAuth providers return 422 with a
dashboard URL. It is idempotent on provider and returns `existed: true`.

### Ad platforms as BYOK: `ppc_connection_create`

`platform` enum: `google_ads | meta_ads | microsoft_ads | tiktok_ads | linkedin_ads |
chatgpt_ads | vibe_ctv | amazon_ads`. Required credentials differ per platform:

- `google_ads`: `developer_token` + `client_id` + `client_secret` + `refresh_token` + `customer_id`
- `microsoft_ads`: `client_id` + `client_secret` + `refresh_token` + `customer_id`, plus
  `manager_id` (the PARENT Bing customer id) for campaign calls
- `meta_ads` / `tiktok_ads` / `linkedin_ads`: `access_token` + `ad_account_id`

Idempotent on (account, platform, customer_id), returning `existed: true`. A 400 carries a
per-platform setup guide worth surfacing verbatim. After creating: `ppc_connection_test`, then
`ppc_sync`.

For Google Ads, prefer `integration_oauth_initiate` over BYOK whenever the user can click a
consent screen. BYOK means they have to mint a refresh token themselves.

**Do not bind an MCC as `customer_id`.** Campaigns never live on a manager account.
`ppc_ads_discover_customers({ id })` with no `manager_customer_id` lists what the OAuth user can
log in as, each marked `is_manager`; pass `manager_customer_id` to list the enabled client
accounts under that MCC. Then bind
`ppc_connection_update({ customer_id: '<client>', manager_id: '<mcc>' })`.

### Shopify: `shopify_connect_start`

Required: `oauth_app_id`, `shop_domain` (`*.myshopify.com`), `intent_type`
(`shopify_account_connect` | `shopify_project_connect` | `shopify_reconnect`).
`shopify_project_connect` also needs `project_id`; `shopify_reconnect` also needs `connection_id`.

Returns `setup_url` (hand it over) and `callback_url`, which **must already be listed in the
Shopify app's Allowed redirection URLs** or the merchant's approval bounces. TTL is 900 seconds.
Prereq is a bring-your-own Shopify app from the customer's Partners dashboard, registered with
`oauth_app_create({ provider: 'shopify', products: ['shopify_storefront'], client_id,
client_secret })`; missing it is 412 `code: 'no_oauth_app'`. Poll `shopify_connection_status`
until a row appears with `disconnected_at: null`.

### Social publishing: the dashboard

There is no MCP tool that starts a social OAuth flow. `social_list_accounts` reads; connecting
happens at `/<accountId>/dashboard/marketing/social/accounts`. Meta and Amazon ad connections
likewise connect at `/<accountId>/dashboard/marketing/ppc`.

### The dashboard destinations, verified

| Need | Path |
|---|---|
| Register or edit an OAuth client | `/<accountId>/dashboard/settings/oauth-apps` |
| SEO connections, including the Google Analytics connect card | `/<accountId>/dashboard/marketing/seo` |
| Ad platform connections | `/<accountId>/dashboard/marketing/ppc` |
| Social publishing accounts | `/<accountId>/dashboard/marketing/social/accounts` |
| Shopify | `/<accountId>/dashboard/commerce/settings/shopify` |
| Connector overview | `/<accountId>/dashboard/settings/connectors` |

---

## 5. Handing over a link, done properly

**The link to hand over is a Hiveku connect link**, minted with
`integration_connect_link_create({ connector, target_connection_id? })` - see the
`/hiveku:connect-integration` command for the full flow. It is one tool for every connector
(Google Analytics, Search Console, Business Profile, Google Ads, Gmail, Calendar, Outlook,
Microsoft Ads, and the social / commerce providers as they are ported), it returns
`https://app.hiveku.com/connect/oauth/<token>` valid for hours (default 24) rather than a raw
provider URL that dies in 5 minutes, it resolves the account + connector + OAuth client
server-side when the human presses Continue (the account's own app if tagged, else Hiveku's
platform app - so a missing `oauth_apps` row is no longer a dead end), and it has one status tool.
`integration_connectors_list` first tells you which connectors are `ready` on the account and the
ids of the existing connections a reconnect targets.

A link dropped into a message with no framing is a link the user does not trust and does not
click. Five things, every time (the `handoff` block in the create response carries all of them):

1. **The URL itself**, on its own line, unmangled, at the END of the message.
2. **What they will see.** A Hiveku page explaining the connection with a Continue button, then
   "Google's account chooser and consent screen", "your Shopify admin asking to approve the app",
   "Microsoft's sign-in". Users abandon links whose destination they cannot predict.
3. **What to click, and any choice they have to make.** Which account to pick on the chooser
   (`handoff.pick_hint`); why an alarming-sounding permission is needed (`handoff.permissions`).
4. **The TTL, stated plainly.** The link is valid until `expires_at`; the provider's own consent
   window is five minutes once they press Continue, so they click when they are ready.
5. **What you will do next.** "Once you tell me you are through, I will confirm the connection,
   bind the Ads customer id, and run the first sync." Then actually do that.

The link can be forwarded to whoever owns the provider account (a client, a colleague); they land
on a Hiveku "Connected" page, every admin on the account gets a bell notification, and the status
below flips.

**The polling pattern.**

```
integration_connectors_list                       -> ready? existing connection ids?
integration_connect_link_create({ connector, target_connection_id?, source: 'plugin' })
  -> keep link_id; hand url over with the handoff block
  -> integration_connect_link_status({ link_id, wait_seconds: 8 }) when they say they are through
       pending / opened : not finished - ask, poll again when they answer
       completed        : connection_id is the DOMAIN row (`table`); needs_binding[] says what
                          is still to be chosen
       failed           : read `error`; consent denied / wrong account -> the SAME link retries;
                          an OAuth-client error -> fix it, mint a fresh link
       expired / revoked: mint a fresh link
  -> bind if needs_binding: seo_analytics_discover_properties / seo_gsc_discover_sites /
             seo_gbp_discover_locations / ppc_ads_discover_customers, then
             seo_connection_update / ppc_connection_update
  -> verify: ppc_connection_test / seo_sync / crm_list_email_connections / social_list_accounts
  -> populate: seo_sync / ppc_sync
```

Do not poll in a tight loop while the user is mid-consent, and do not poll silently. Ask them to
say when they are through, and poll then.

**The legacy lanes still exist.** `integration_oauth_initiate` (four Google products, needs the
account's own app or answers with `connect_link: true` and a `link_id` when Hiveku's app fronts
the consent), `email_connect_start` (raw Google/Microsoft URL, 5 minutes, no status tool - poll
`crm_list_email_connections`) and `shopify_connect_start` (poll `shopify_connection_status`).
Use them only when a caller already drives those loops.

---

## 6. Worked example: Google Tag Manager

Confirmed live. This is the shape of a three-layer failure and the reason this file exists: a real
session answered a GTM question by calling `integration_list`, reading consent scopes by hand,
calling `oauth_app_list`, and diffing which products the client was registered for, before
concluding that three separate things were missing.

**GTM rides the `google_analytics` connection.** One Google authorization covers GA4 and Tag
Manager both. There is no separate GTM connection, no GTM credential, and no GTM row.
`seo_gtm_status` takes a `connection_id` that is a `seo_connections` UUID with platform
`google_analytics`, from `seo_connections_list`.

Three independent things must all be true. Each failure looks different.

### (a) The OAuth CLIENT must be registered for the `google_analytics` product

A shared Google client registered for `google_search_console` and `google_ads` **cannot serve
Google Analytics.** Check with `oauth_app_list` and read the `products` array. Extend with
`oauth_app_update({ oauth_app_id, add_products: ['google_analytics'] })`, which merges. Do not
pass `products`, which replaces and would drop GSC and Ads.

Beyond registering the product in Hiveku, the customer's Google Cloud project must have the **Tag
Manager API enabled** and the tagmanager scopes declared on its **OAuth consent screen**. Both are
Google Cloud Console work. Neither can be done from a session. Say so and name the steps.

### (b) A `google_analytics` connection row must exist and be active

An account can have perfectly healthy `google_search_console` and `google_business_profile`
connections and **no `google_analytics` row at all**. That is a hard 404 from `seo_gtm_status`.

The route's 404 message is written to be actionable rather than merely accurate: it explains that
GTM rides the analytics connection, lists the four scopes, and names the remediation. Read it
rather than paraphrasing from memory.

**The gap you must know before you follow that hint.** The 404 suggests
`integration_oauth_initiate({ provider_slug: 'google_analytics' })`, and that call does start a
valid consent flow. But on this specific slug it writes only to `account_integrations`:

- The OAuth callback mirrors CLI connections into the domain tables for
  `google_search_console`, `google_business_profile` and `google_ads`. **Not
  `google_analytics`.**
- The read-path backfill that `seo_connections_list` and `ppc_connection_list` run covers the same
  three slugs. **Not `google_analytics`.**
- `seo_connection_create` rejects `google_analytics` outright; its enum is
  `bing_webmaster | google_search_console | google_business_profile`.
- `seo_connection_update` has no `ga_property_id` parameter, so even the property cannot be bound
  from MCP.

So there is **no MCP path that creates a `google_analytics` row in `seo_connections`.** That row
is written by the dashboard connect card on the SEO connections page. When the account has no
analytics connection, the honest handoff is: send the user to
`/<accountId>/dashboard/marketing/seo`, have them use the Google Analytics connect card, and pick
the GA4 property when the selector appears. Then re-read `seo_connections_list` and carry on.

If a row exists but every one is `is_active: false`, that is the second branch of the 404 message
and the fix is a reconnect, not a create.

### (c) The token must carry the Tag Manager scopes

Consenting to Analytics alone is not enough. Tag Manager work needs all four:

```
https://www.googleapis.com/auth/tagmanager.readonly
https://www.googleapis.com/auth/tagmanager.edit.containers
https://www.googleapis.com/auth/tagmanager.edit.containerversions
https://www.googleapis.com/auth/tagmanager.publish
```

`edit.containers` alone can only edit DRAFTS. The version-create and publish scopes were added to
Hiveku's request list on 2026-08-23, so **any connection authorized before that date holds a token
that can build a tag and cannot publish it** - and an unpublished container serves nothing however
complete it looks in GTM. The route translates that 403 into a message naming both missing scopes
and telling you to reconnect Google Analytics. A reconnect is the only fix; the scopes on an
already-issued token never widen.

Preflight it when you can: `seo_ga4_admin_scopes({ connection_id })` returns `granted_scopes`, the
full array from Google, so you can look for the four above before starting a change wave rather
than discovering the shortfall halfway through. Its one precondition: it returns 400 if the
connection has no GA4 property selected. `seo_gtm_status` itself does not require a property, so
GTM can work on a connection where `seo_ga4_admin_scopes` still 400s.

### Two GTM-specific traps that are not connection problems

- **The container pin.** The first time a container is used successfully on a connection, that
  container path is claimed from Google's own answer and stored on the row. A later call naming a
  DIFFERENT container is refused with a 403 naming both. This is deliberate: an agency Google
  login can legitimately reach containers belonging to other tenants, and the pin is what stops one
  account editing another's. Retrying will not help. Either use the pinned container, or clear the
  pin on purpose with `seo_connection_update({ id, gtm_container_path: null })` and let the next
  successful call re-claim it.
- **Published is not installed.** `seo_gtm_install_status({ project_id })` answers whether the
  container is actually on the site, per tier, head and body separately. A published container that
  is not installed fires on nobody, and every tag call still reports success. Call it before and
  after `seo_gtm_tag_create` and `seo_gtm_publish`. `seo_gtm_install({ project_id, tier,
  container_id })` installs the snippet, with a strict two-step confirm.

### The whole diagnosis, in order

```
1. seo_connections_list                  -> is there a platform 'google_analytics' row, is it active?
     none / all inactive                 -> layer (b). Dashboard handoff (see above), or reconnect.
2. oauth_app_list                        -> does a google app list 'google_analytics' in products?
     no                                  -> layer (a). oauth_app_update add_products, plus the
                                            Google Cloud Console work the user must do.
3. seo_ga4_admin_scopes({ connection_id }) -> do granted_scopes hold all four tagmanager scopes?
     no (or 400: no property picked)     -> layer (c). Reconnect Google Analytics.
4. seo_gtm_status({ connection_id })     -> containers, or the workspace/draft-vs-live split.
5. seo_gtm_install_status({ project_id }) -> is the container actually on the site?
```

---

## 7. Symptom table

| Symptom or error | Layer | Confirm with | Hand the user |
|---|---|---|---|
| 412 `integration_not_configured` from `integration_oauth_initiate` | (a) | `oauth_app_list`, read `products` | Either you run `oauth_app_update({ add_products })`, or they register a client at `/<accountId>/dashboard/settings/oauth-apps` |
| `code: 'no_oauth_app'` from `email_connect_start` or `shopify_connect_start` | (a) | `oauth_app_list` | The account OWNER registers a client (`crm_email_calendar`, or `shopify_storefront`) at the oauth-apps page. Do not retry the connect call |
| A department tool says no connection is configured, but `integration_test` refreshes cleanly | (b), mirror gap | `integration_list` vs `seo_connections_list` / `ppc_connection_list` | Re-read the department list once, which runs the backfill. If the slug is `google_analytics`, the backfill does not cover it: dashboard handoff |
| `seo_gtm_status` returns 404 | (b) | `seo_connections_list` for platform `google_analytics` | Connect Google Analytics at `/<accountId>/dashboard/marketing/seo`, then pick the GA4 property |
| `connection_status: 'pending'` and a tool returns nothing | (b), unbound | `seo_connections_list` / `ppc_connection_list` for the null binding field | Nothing. This is yours: run the discover tool, then `seo_connection_update` / `ppc_connection_update` |
| Row absent from the department list, present in `connections_status` with `is_active: false` | (b), soft-deleted | `connections_status` | Nothing yet. Reactivate rather than recreate, so the bindings survive |
| `connection_status: 'error'` while `is_active: true` | (b) | `seo_connections_list` / `ppc_connection_list` / `email_connections_list` for `last_error` | Depends on `last_error`. An OAuth error means re-auth with `target_connection_id` |
| `integration_test` says the account has been deleted, or a sync starts failing with OAuth errors | (b), dead refresh token | `integration_test`, `ppc_connection_test` | Re-auth: `integration_oauth_initiate({ provider_slug, target_connection_id })`, which preserves the bindings |
| HTTP 403, "insufficient authentication scopes" | (c) | `seo_ga4_admin_scopes` for GA/GTM; nothing for GSC/GBP/PPC | A reconnect link for that provider. Say which capability the missing scope unlocks |
| GTM 403 naming `tagmanager.edit.containerversions` and `tagmanager.publish` | (c) | The error text itself | Reconnect Google Analytics. The token predates 2026-08-23, when those scopes were added |
| GTM 403 naming two container ids | Neither. Container pin | `seo_gtm_status` | Nothing. Use the pinned container, or clear the pin deliberately with `seo_connection_update({ gtm_container_path: null })` |
| GTM tags publish fine, conversions stay at zero | Neither. Not installed | `seo_gtm_install_status({ project_id })` | Nothing. `seo_gtm_install`, or fix the wrong or duplicate container it reports |
| "No active Gmail connection found" from any CRM email, inbox or calendar tool | (b) or (c) | `email_connections_list` for `connection_status`, `last_error`, `scopes` | `email_connect_start` setup_url. **5 minute TTL.** Say which Hiveku user it will belong to |
| Social account missing from `connections_status` | Not a bug | `social_list_accounts` | Social is never in `connections_status`. Connect at `/<accountId>/dashboard/marketing/social/accounts` |
| Campaign built, cannot send | Not a connection | `marketing_setup_status`, read `blockers[]` | Whatever each blocker names. Its `ready_to_send` is the verdict |
| "Is my phone system set up?" | Not a connection | `voice_diagnose_setup`, read `blocking_issues[]` | Each blocking issue, verbatim |
| Provider missing from `integration_providers_list` | Not a bug | Nothing | The table is populated lazily on first connection. Absence proves nothing |

---

## Pitfalls

- **Reporting the failure and stopping.** Run `connections_status`, name the layer, hand over a
  link. That is the whole point of this file.
- **Diagnosing from a department list and concluding nothing exists.** All three department
  readers hard-filter `is_active: true`. `connections_status` is the only one that shows a
  disabled row, and "deactivated" and "never existed" have different fixes.
- **Reading `is_active` as health.** It is the enabled flag. `connection_status` and `last_error`
  carry health, and a row can be active and erroring at once.
- **Treating "we have a Google app" as sufficient.** The `products` array is an exact match per
  product. A GSC-and-Ads client cannot serve Analytics.
- **Passing `products` to `oauth_app_update` when you meant `add_products`.** `products` replaces
  the array and silently strips the products the app was already serving.
- **Deleting an OAuth app to fix a credential.** `oauth_app_delete` is a hard delete that nulls
  `oauth_app_id` on every connection referencing it, and each of those then needs a fresh OAuth
  run. Rotate with `oauth_app_update`.
- **Using `integration_oauth_initiate` for Gmail or Calendar.** 400
  `wrong_tool_for_provider`. Use `email_connect_start`, which writes the table the CRM reads.
- **Reaching for `integration_oauth_initiate` when a human has to click.** Mint a connect link
  instead (`integration_connect_link_create`). The initiate lane still hands out Google's raw URL,
  covers four products, and 412s when the account has no tagged app unless Hiveku's platform app
  can take over (then it answers with `connect_link: true` - poll by `link_id`). Its
  `google_analytics` consent now does refresh the `seo_connections` row the GA4/GTM tools read (it
  used to write `account_integrations` only).
- **Passing the `integration_id` from `integration_oauth_check` to a department tool.** That is an
  `account_integrations` id. The domain-table id is `connection_id` from the initiate response.
- **Deleting and recreating a connection to fix a dead token.** Re-auth with
  `target_connection_id` and keep the bindings. Recreating throws away `site_url`, `customer_id`,
  `manager_id`, the GBP location and the GTM pin.
- **Binding an MCC as `customer_id`.** Campaigns never live on a manager account. Use
  `ppc_ads_discover_customers` and bind `customer_id` plus `manager_id`.
- **Retrying a 412 or a `no_oauth_app`.** Both are structural. Nothing changes until a client is
  registered.
- **Letting a raw `setup_url` expire in a long message.** 5 minutes for `email_connect_start`, 15
  for `integration_oauth_initiate` and `shopify_connect_start`. A connect link lasts until its
  `expires_at` (hours), which is the reason to prefer it. Put the link last either way.
- **Opening the consent URL yourself, or offering to.** It requires the user's own browser session.
- **Reaching for `seo_connection_test`.** It does not exist. Use `seo_sync`, or call the capability
  and read the error.
- **Calling `oauth_app_list({ provider: 'shopify' })` and treating a client-side schema rejection
  as proof Shopify apps are unsupported.** The declared enum is narrower than the route. Omit the
  filter.
- **Concluding a provider is unsupported because `integration_providers_list` does not list it.**
  That table fills in lazily on first connection.
- **Inventing a tool name to close a gap.** If a name does not resolve, it does not exist. Check
  `hiveku_docs_search` / `hiveku_docs_get`, then say the capability is dashboard-only and name the
  page.
