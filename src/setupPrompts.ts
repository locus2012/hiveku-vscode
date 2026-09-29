/**
 * Ready-to-paste Claude Code prompts that drive an integration setup end-to-end.
 * Each button in the Account Console (or the "Copy Setup Prompt" command) copies
 * one of these to the clipboard; the user pastes it into a Claude Code session
 * (which has the hiveku MCP wired) and Claude walks them through the connection.
 *
 * The flows are the verified ones from each department's SETUP.md (traced against
 * the builder's integration/oauth code): a connect link, then poll + bind + test +
 * sync.
 *
 * Hiveku's Google policy (2026-09-27): every Google product except Gmail runs on
 * Hiveku's own Google app, and Google Ads on Hiveku's developer token. So the
 * Google prompts never collect a developer token, a client id or a secret and
 * never register an OAuth app of the account's own; the builder refuses both
 * (400 google_own_app_not_allowed, 400 developer_token_not_allowed). A Google
 * connection still on the account's own app is moved onto Hiveku's app with a
 * reconnect link that names oauth_app_id 'platform'. Microsoft Ads may still use
 * the account's own Azure app.
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

/**
 * Step 1 of the Google prompts (Google Ads, Search Console, Business Profile).
 * Checks the connector and says what the policy forbids; there is no Google
 * Cloud step, because these products run on Hiveku's own Google app.
 */
const GOOGLE_HIVEKU_APP = (connector: string, label: string, moveNote = '') =>
  `1. Check readiness with integration_connectors_list. ${label} runs on Hiveku's own Google app (Hiveku's policy: every Google product except Gmail does), so never ask me for a developer token, a client id, a client secret or a refresh token, never call oauth_app_create or pass an oauth_app_id of our own, and never send me into a Google Cloud project of my own: the server refuses an own app (400 google_own_app_not_allowed) and a Google Ads developer token (400 developer_token_not_allowed).
   - If '${connector}' is not ready, Hiveku's ${label} app is not configured on this environment: report it with hiveku_report_issue and stop.
   - If a ${label} connection already exists with client_source 'byok' (it still runs on our own app), step 2 MOVES it instead of creating one: pass its id as target_connection_id together with oauth_app_id: 'platform'. Before you send that link, tell me it moves onto Hiveku's Google app and keeps its settings and history${moveNote}.`;

const CONNECT_LINK = (connector: string, extra = '') =>
  `Call integration_connect_link_create({ connector: '${connector}', source: 'vscode'${extra} }) and give me the returned url on its own line (it is a Hiveku page valid for 24 hours that sends me to the provider's consent screen when I press Continue). Tell me which account to pick. If a connection already exists and is dead or missing a scope, pass target_connection_id (its id from integration_connectors_list) to re-authenticate it in place instead of creating a second one.`;

const CONNECT_STATUS =
  `When I say I am through, call integration_connect_link_status({ link_id, wait_seconds: 8 }) until status is 'completed' (connection_id is the connection row; needs_binding lists anything still to choose) or 'failed' (read me the error; the same link can be retried).`;

export const SETUP_PROMPTS: SetupPrompt[] = [
  {
    id: 'google_ads',
    label: 'Google Ads',
    blurb: "OAuth on Hiveku's Google app, driven from Claude Code",
    build: (a) =>
      `${head(a, 'Google Ads')}

${GOOGLE_HIVEKU_APP('google_ads', 'Google Ads', ", and that the connection's own developer token is dropped (Hiveku's is used)")}
2. ${CONNECT_LINK('google_ads')} Nothing is needed up front: if I already know the client ad account's customer_id (its 10-digit id) and, when it sits under an MCC, the manager_id, you may pass them; otherwise they are picked after consent. Before I open the link, tell me that on the Google Ads consent Google first shows an 'unverified app' screen (Advanced, then continue), and that if Google says 'Access blocked' instead, my Google Workspace admin blocks unverified apps and nothing connects until the admin allows Hiveku's app.
3. ${CONNECT_STATUS}
4. ppc_connection_test({ id: connection_id }) to verify OAuth + permissions.
5. ppc_sync({ connection_id }) to pull campaigns + metrics (use ppc_sync_async + job_status_get for a full 5-year backfill).
6. Confirm it worked: ppc_account_settings_get({ connection_id }), ppc_campaign_list, and ppc_conversion_tracking_status({ connection_id }).

If the status reports needs_binding: ['customer_id'] (or I don't know the customer_id): ppc_ads_discover_customers({ id: connection_id }) to list my accessible accounts (pass manager_customer_id to list the client accounts under an MCC; never bind an MCC as the customer_id), then ppc_connection_update({ id: connection_id, customer_id, manager_id (if any) }). A 412 developer_token_missing there means Hiveku's developer token is not configured on this environment: report it with hiveku_report_issue, and never ask me for a developer token.`,
  },
  {
    id: 'microsoft_ads',
    label: 'Microsoft / Bing Ads',
    blurb: 'Azure app + dashboard consent, then sync',
    build: (a) =>
      `${head(a, 'Microsoft (Bing) Ads')}

1. Check readiness with integration_connectors_list. If 'microsoft_ads' is ready, skip to step 2. Only if it is NOT ready, help me register an Azure AD app (App registrations → New; Redirect URI = Web → https://app.hiveku.com/api/oauth/microsoft/callback; copy the Application/client ID + a client secret), then oauth_app_create({ provider: 'microsoft', name: 'Microsoft Ads app', client_id, client_secret, products: ['microsoft_ads'] }).
2. ${CONNECT_LINK('microsoft_ads')} (No developer token is needed for Microsoft Ads.)
3. ${CONNECT_STATUS}
4. If needs_binding lists the ad account: ppc_microsoft_discover_accounts / ppc_connection_update as the status hint says. Then ppc_sync({ connection_id }) to pull data, and confirm with ppc_campaign_list. All the ppc_* read/CRUD tools then work the same as Google Ads.`,
  },
  {
    id: 'google_search_console',
    label: 'Google Search Console',
    blurb: 'OAuth + pick verified site',
    build: (a) =>
      `${head(a, 'Google Search Console')}

${GOOGLE_HIVEKU_APP('google_search_console', 'Search Console')}
2. ${CONNECT_LINK('google_search_console')}
3. ${CONNECT_STATUS}
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

${GOOGLE_HIVEKU_APP('google_business_profile', 'Business Profile')}
2. ${CONNECT_LINK('google_business_profile')}
3. ${CONNECT_STATUS}
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
