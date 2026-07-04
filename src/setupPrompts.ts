/**
 * Ready-to-paste Claude Code prompts that drive an integration setup end-to-end.
 * Each button in the Account Console (or the "Copy Setup Prompt" command) copies
 * one of these to the clipboard; the user pastes it into a Claude Code session
 * (which has the hiveku MCP wired) and Claude walks them through the connection.
 *
 * The flows are the verified ones from each department's SETUP.md (traced against
 * the builder's integration/oauth code) — per-account BYOK OAuth app first, then
 * initiate + poll + bind + test + sync.
 */

import type { AccountRecord } from './accounts';

export interface SetupPrompt {
  id: string;
  label: string;
  /** Short blurb for the picker / button subtitle. */
  blurb: string;
  build: (account: AccountRecord) => string;
}

function head(account: AccountRecord, what: string): string {
  return `Connect ${what} for my Hiveku account "${account.label}" (account id ${account.accountId}), using the hiveku MCP tools.

First confirm scope: call get_account_info and verify it returns "${account.label}". If it returns a different account, STOP and tell me to run the VS Code command "Hiveku: Set Claude Code Account" (then reload) before continuing.

Then walk me through this EXACT flow, explaining each step and asking me for whatever you need:`;
}

const GOOGLE_OAUTH_APP = (product: string, apiName: string) =>
  `1. OAuth app (once per account). Call oauth_app_list({ provider: 'google' }). If nothing is enabled for product '${product}', help me create one:
   - In Google Cloud Console: create/pick a project, enable the ${apiName}, configure the OAuth consent screen (External; add me as a test user), then Credentials → Create OAuth client ID → Web application whose Authorized redirect URI INCLUDES https://app.hiveku.com/api/oauth/google/callback.
   - Collect the Client ID + Client Secret from me, then call oauth_app_create({ provider: 'google', name: '${product} app', client_id, client_secret, products: ['${product}'] }).`;

export const SETUP_PROMPTS: SetupPrompt[] = [
  {
    id: 'google_ads',
    label: 'Google Ads',
    blurb: 'OAuth + developer token, driven from Claude Code',
    build: (a) =>
      `${head(a, 'Google Ads')}

${GOOGLE_OAUTH_APP('google_ads', 'Google Ads API')}
2. Ask me for three things: developer_token (from my Google Ads MCC → Tools & Settings → API Center), customer_id (the client ad account — 10 digits, no dashes), and manager_id (the MCC/manager account id — ONLY if the client account sits under an MCC).
3. Call integration_oauth_initiate({ provider_slug: 'google_ads', customer_id, manager_id (if any), developer_token }). Give me the returned setup_url to open in my browser and authorize.
4. Poll integration_oauth_check({ setup_token }) every ~5 seconds until status is 'completed' (re-initiate if it expires after 15 min).
5. ppc_connection_test({ id: connection_id }) to verify OAuth + permissions.
6. ppc_sync({ connection_id }) to pull campaigns + metrics (use ppc_sync_async + job_status_get for a full 5-year backfill).
7. Confirm it worked: ppc_account_settings_get({ connection_id }), ppc_campaign_list, and ppc_conversion_tracking_status({ connection_id }).

If I don't know the customer_id: initiate with just the developer_token, then ppc_ads_discover_customers({ id: connection_id }) to list my accessible accounts, then ppc_connection_update({ id: connection_id, customer_id, manager_id (if any) }).`,
  },
  {
    id: 'microsoft_ads',
    label: 'Microsoft / Bing Ads',
    blurb: 'Azure app + dashboard consent, then sync',
    build: (a) =>
      `${head(a, 'Microsoft (Bing) Ads')}

Note: Microsoft Ads OAuth can't be started from the MCP (integration_oauth_initiate is Google-only), so part of this is done in the Hiveku dashboard.
1. OAuth app (once). Call oauth_app_list({ provider: 'microsoft' }). If none has product 'microsoft_ads', help me register an Azure AD app (App registrations → New; Redirect URI = Web → https://app.hiveku.com/api/oauth/microsoft/callback; copy the Application/client ID + a client secret), then oauth_app_create({ provider: 'microsoft', name: 'Microsoft Ads app', client_id, client_secret, products: ['microsoft_ads'] }).
2. Tell me to connect Microsoft Ads in the Hiveku dashboard (Marketing → Ads → connect Microsoft) and complete the Microsoft consent screen. (No developer token is needed for Microsoft Ads.)
3. Once I confirm, call ppc_connection_list({ platform: 'microsoft' }) to find the new connection (platform microsoft_ads).
4. ppc_sync({ connection_id }) to pull data, then confirm with ppc_campaign_list. All the ppc_* read/CRUD tools then work the same as Google Ads.`,
  },
  {
    id: 'google_search_console',
    label: 'Google Search Console',
    blurb: 'OAuth + pick verified site',
    build: (a) =>
      `${head(a, 'Google Search Console')}

${GOOGLE_OAUTH_APP('google_search_console', 'Search Console API')}
2. Call integration_oauth_initiate({ provider_slug: 'google_search_console' }); give me the setup_url to authorize.
3. Poll integration_oauth_check({ setup_token }) until status is 'completed'.
4. seo_gsc_discover_sites({ id: connection_id }) → show me the verified sites and let me pick one (use sc-domain:<domain> if none are listed).
5. seo_connection_update({ id: connection_id, site_url: '<the one I pick>' }) → this flips status to connected.
6. Confirm with seo_gsc_search_queries and seo_gsc_top_pages.`,
  },
  {
    id: 'google_business_profile',
    label: 'Google Business Profile (GMB)',
    blurb: 'OAuth + pick location, for Local SEO',
    build: (a) =>
      `${head(a, 'Google Business Profile (Google My Business)')}

${GOOGLE_OAUTH_APP('google_business_profile', 'Business Profile API')}
2. Call integration_oauth_initiate({ provider_slug: 'google_business_profile' }); give me the setup_url to authorize.
3. Poll integration_oauth_check({ setup_token }) until status is 'completed'.
4. seo_gbp_discover_locations({ id: connection_id }) → show me the accounts + locations and let me pick the right location.
5. seo_connection_update({ id: connection_id, gbp_account_id, gbp_location_id }) → set BOTH; status flips to connected.
6. Confirm with seo_gbp_insights({ connection_id }) and seo_gbp_reviews({ connection_id }).`,
  },
  {
    id: 'shopify',
    label: 'Shopify (Commerce)',
    blurb: 'Register app (dashboard) → connect → sync',
    build: (a) =>
      `${head(a, 'a Shopify store (Commerce)')}

Hiveku is headless commerce (bring-your-own Shopify app), so part of this is done in the Hiveku dashboard.
1. Tell me to register the Shopify app in the Hiveku dashboard (Commerce → Settings → Shopify) — the connect dialog there takes the client_id + client_secret from my Shopify custom/partner app and registers it per-account.
2. Start the install: shopify_connect_start → give me the Shopify authorize URL to approve on my store.
3. Poll shopify_connection_status({ shop_domain }) until a row has disconnected_at = null (I've approved).
4. Find my website project: sites_list (use the project's id as project_id). Then verify with shopify_status({ project_id }) and shopify_catalog_list({ project_id }).
Explain each step and ask me for what you need (shop domain, etc.).`,
  },
  {
    id: 'bing_webmaster',
    label: 'Bing Webmaster',
    blurb: 'API key — fully from Claude Code',
    build: (a) =>
      `${head(a, 'Bing Webmaster')}

1. Ask me for my Bing Webmaster API key (bing.com/webmasters → Settings → API access).
2. Call integration_create({ provider_slug: 'bing_webmaster', credentials: { api_key: '<my key>' } }).
3. Confirm with seo_connections_list, then seo_bing_stats / seo_bing_keywords / seo_bing_pages to verify data flows. The seo_local_* aggregates will then include source 'bing'.`,
  },
];

export function setupPromptById(id: string): SetupPrompt | undefined {
  return SETUP_PROMPTS.find((p) => p.id === id);
}
