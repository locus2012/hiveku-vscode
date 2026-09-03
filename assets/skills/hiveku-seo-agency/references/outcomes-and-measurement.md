# Outcomes and Measurement - GA4, GTM, and Data-Source Connections

## What this covers / when to load this

The layer that proves SEO traffic DID something: GA4 conversion definitions (key events),
the URL rules that feed them, the GTM container that carries tags, the one tool that
returns GA4 numbers, and the data-source connections everything runs on. Load it when
standing up a client's conversion measurement in Month 1, when writing the monthly
report's Outcomes section, when GA4 tools 403, when "did organic convert" is the question,
or when a connection needs creating, testing or removing. Every GA4/GTM tool here runs on
the google_analytics connection from `seo_connections_list`. Deep tag work (conversion
tags, values, triggers, the per-channel verdict) is the `hiveku-conversion-tracking`
skill's discipline; this file covers what the SEO operator needs to verify measurement,
stand up a basic conversion, and read the outcome numbers, not to run a tagging program.
Forecast bands and seasonality are `forecasting-and-seasonality.md`; the report assembly
is `reporting-and-delivery.md`.

## Availability

| Tool | Status | Cost | Note |
|---|---|---|---|
| `seo_ga4_conversion_audit` | LIVE | A (GA4 API) | `connection_id`, `days` 1-365; START HERE |
| `seo_ga4_key_events_list`, `seo_ga4_data_streams_list`, `seo_ga4_event_create_rules_list`, `seo_ga4_admin_scopes` | LIVE | A | Admin API reads |
| `seo_ga4_event_create_rule_create` | LIVE | A | URL to event; CONTAINS default, source event pinned |
| `seo_ga4_event_create_rule_update` | LIVE | A | two-step confirm; conditions list REPLACED on patch |
| `seo_ga4_event_create_rule_delete` | LIVE | A | two-step confirm; destructive |
| `seo_ga4_key_event_create` | LIVE | A | needs analytics.edit; value and currency together |
| `seo_ga4_key_event_update` | LIVE | A | two-step confirm; propagates into Ads |
| `seo_ga4_key_event_delete` | LIVE | A | two-step confirm (strict boolean); irreversible |
| `seo_ga4_report` | LIVE | A, GA4 hourly token quota | the ONLY numbers tool; property from the connection row; 429 = quota, do not retry |
| `seo_gtm_status`, `seo_gtm_install_status` | LIVE | A | read before any tag work |
| `seo_gtm_install`, `seo_gtm_publish` | LIVE | A | strict two-step confirm; publish changes the live site |
| `seo_gtm_version_create` | LIVE | A | consumes the workspace; still not live |
| `seo_gtm_tag_create`, `seo_gtm_tag_get`, `seo_gtm_tag_update`, `seo_gtm_tag_delete`, `seo_gtm_tag_revert` | LIVE | A | workspace drafts; delete and revert two-step |
| `seo_gtm_trigger_get`, `seo_gtm_trigger_update`, `seo_gtm_trigger_delete`, `seo_gtm_trigger_revert` | LIVE | A | no standalone trigger-create tool: triggers are created through `create_trigger` on `seo_gtm_tag_create` |
| `seo_gtm_variable_create`, `seo_gtm_variable_get`, `seo_gtm_variable_update`, `seo_gtm_variable_delete`, `seo_gtm_variable_revert` | LIVE | A | the conversion-value rail |
| `seo_connection_create`, `seo_connection_update`, `seo_connection_delete`, `seo_connections_list`, `seo_sync` | LIVE | A | BYOK shapes below; delete is a soft-delete |
| `seo_connection_get` | LIVE | A | one connection row by id; `seo_connections_list` remains the bulk read |
| `seo_connection_test` | LIVE | A | ask-gated; WRITES connection_status: a transient failure pauses the 6h cron until a passing test, so never sweep it across connections |
| `seo_connections_health` | LIVE | A | the one-call roll-up; `seo_connections_list` still shows connection_status and last sync per row |
| `seo_analytics_discover_properties` | LIVE | A | lists the GA4 properties a connection can reach; re-point the row with `seo_connection_update` (`ga_property_id`) |
| `seo_organic_leads` | LIVE | A | `from`, `to`, `project_id`; cross-check against `marketing_form_conversion_audit` with `channel: 'Organic Search'` plus GA4 key events from `seo_ga4_report`, side by side |

Creating a google_analytics connection: `seo_connection_create` documents BYOK shapes for
Bing Webmaster, Google Search Console and Google Business Profile; the GA4 connection is
made through the dashboard's Google OAuth (GTM rides the same row). Unverified whether
`seo_connection_create` accepts platform google_analytics; check its schema before trying.

## Ground truth

### Connections (create, verify, remove)

`seo_connection_create` is BYOK, per platform:
- bing_webmaster is the simplest: `{ platform: 'bing_webmaster', site_url, api_key }` (the
  key from bing.com/webmasters -> Settings -> API access; no OAuth). For a site not yet in
  Bing, the user can one-click "Import from Google Search Console" at bing.com/webmasters.
- google_search_console: `{ platform, site_url, client_id, client_secret, refresh_token }`
  with scope `https://www.googleapis.com/auth/webmasters` - the FULL scope, not `.readonly`,
  or sitemap submit/delete will 403.
- google_business_profile: `{ platform, client_id, client_secret, refresh_token }`, then set
  gbp_account_id / gbp_location_id via `seo_connection_update`.

After create, verify with `seo_sync`. `seo_connection_update` flips connection_status from
pending to connected when the final identifier lands (site_url for GSC; both GBP ids), and
resets it to pending when credentials change. `seo_connection_delete` soft-deletes (sets
`is_active=false`, keeps the row for audit history) - use it to clean up a phantom or stuck
pending row from a failed OAuth, and expect downstream tools that filter on is_active to
stop finding it. The department SETUP.md, when present, is at `hiveku-data/seo/SETUP.md`
(written by `/hiveku:pull` only where an integration needs connecting - absent is normal).
Verify with `seo_connection_test` (ask-gated; it WRITES connection_status) or the
`seo_connections_health` roll-up; `seo_sync` plus `seo_connections_list` still cross-checks.

### What each measurement ledger is

GA4 sessions, GSC clicks, the tracker, Bing and vendor estimates are five ledgers with
five definitions (GA4: property timezone, after consent and blocking; GSC: Pacific days,
three-day lag). Side by side, never summed; the size of the gap is a finding when it moves.

## Decision frameworks

### GA4: verify before you claim, create before you report

- `seo_ga4_conversion_audit({ connection_id, days })` - START HERE. Which key events
  (conversions) exist, which URL rules feed them, and which recorded NOTHING in the window.
  A key event with zero events is a Google Ads conversion action (origin GOOGLE_ANALYTICS)
  reporting zero with no error shown anywhere - this is where an "Ads conversion stopped
  recording" investigation starts.
- `seo_ga4_key_events_list` - key events with countingMethod and defaultValue, the two
  settings that make an imported Google Ads conversion wrong.
- `seo_ga4_data_streams_list` - the property's streams (name, type, defaultUri,
  measurementId). Event create rules hang off a STREAM, not the property, so this lookup
  precedes every rule action.
- `seo_ga4_event_create_rules_list` - the URL-driven rules that turn a thank-you-page URL
  into a distinct event. v1alpha resource: it can change without notice.
- `seo_ga4_admin_scopes` - does the token carry analytics.edit? Read-only preflight: call
  it before a write wave to learn the customer must reconnect, instead of discovering it
  from a 403 halfway through. (This is the GA4 parallel of the GSC 412 triage in
  `rankings-and-search-console.md` section 6.)

### `seo_ga4_report` - the only tool that returns numbers

Every other `seo_ga4_*` tool is Admin API configuration. `seo_ga4_report` is one Data API
runReport and the only place sessions, landing pages and revenue come from.

- The GA4 PROPERTY ALWAYS COMES FROM THE CONNECTION ROW. There is no property input; a
  connection whose property is not the one you want cannot be redirected from here.
- Presets, one parameter each: `channel_sessions` (sessionDefaultChannelGroup x sessions,
  engagedSessions, keyEvents), `landing_pages` (landingPage x sessions, keyEvents,
  engagementRate), `ecommerce_revenue` (date x purchaseRevenue, transactions).
- Override semantics: explicit `dimensions` or `metrics` replace the matching HALF of a
  preset. `ecommerce_revenue` plus `dimensions: ['itemName']` is revenue by product, and
  then `metrics: ['itemRevenue', 'itemsPurchased']` because purchaseRevenue is
  order-scoped. Without a preset, `dimensions` (0-9) and `metrics` (1-10) are required.
  Names are case-sensitive GA4 Data API names, checked against a shape regex and an
  allowlist before anything reaches Google; an unknown name is a 400 naming it, with
  `allowed_dimensions` / `allowed_metrics` in the response. Custom definitions use the
  `customEvent:`, `customUser:`, `customItem:` prefixes. `keyEvents` is the current name
  for what GA4 called conversions (both accepted).
- `dimension_filter` is a GA4 FilterExpression: a leaf `{ filter: { fieldName,
  stringFilter | inListFilter | numericFilter | betweenFilter } }` or an `andGroup`,
  `orGroup`, `notExpression`, rebuilt from known keys only (an unknown key is refused,
  never dropped; max depth 5, 20 leaves). Google's Data API honors a filter only on a
  dimension the report requests, so add the filtered dimension to `dimensions` when the
  preset lacks it (`landing_pages` and `ecommerce_revenue` lack sessionDefaultChannelGroup).
  Unverified whether the tool enforces that for you; unfiltered totals are the symptom.
- Dates default to the last 30 COMPLETE days ending yesterday (`date_to` of today warns
  about the partial day). `limit` 1-1,000, default 100; `total_row_count` is Google's count
  before the limit and totals cover every matched row. `order_bys` max 10.
- 429 is the property's hourly Data API token quota, returned verbatim with the parsed
  `google_error`; it is NOT retried, and retrying inside the hour burns the rest.
  `property_quota` on every success shows tokens consumed and remaining; budget the
  monthly report's calls against it.
- Warnings flag thresholding (rows withheld for privacy, so rows do not sum to totals),
  `(other)` row folding, sampling, and zero rows (a property that never sent purchase
  events returns zero rows, not an error). Metrics are numbers; engagementRate is a 0-1
  ratio. Quote the warnings in the report; a thresholded table is partial, not wrong.

## The plays

### Standing up a conversion from a URL (the Month-1 gap on most new clients)

GA4 cannot mark "a page_view whose URL contains /thank-you" as a conversion - only a whole
event name - so the chain is:
1. `seo_ga4_event_create_rule_create` - creates a distinct event from the URL. It defaults
   to CONTAINS matching because the URL lives in page_location, the FULL url including host
   and any ?utm_ query string, so EQUALS never matches a bare path; and it pins the source
   event automatically (a rule with no event_name condition would fire on nearly every
   event GA4 collects).
2. `seo_ga4_key_event_create` - marks the event as a key event. GA4 ACCEPTS A KEY EVENT FOR
   AN EVENT NAME IT HAS NEVER RECEIVED and then records nothing forever with no error -
   confirm the event actually arrives with `seo_ga4_conversion_audit`. counting_method:
   ONCE_PER_SESSION for lead forms (a reloaded thank-you page counts once), ONCE_PER_EVENT
   for purchases. default_value and default_currency must be sent together.
3. Google Ads imports it. GA4 never backfills - a new rule starts at zero.

### The GA4 writes that bite

- `seo_ga4_key_event_update` changes counting method / default value. eventName is
  IMMUTABLE - renaming means create + delete, two confirmed writes, not a shortcut. Both
  changes propagate AUTOMATICALLY into Google Ads conversions imported from the event,
  shifting reported volume or value without anyone touching Ads. Two-step confirm, because
  unlike GTM a GA4 change is LIVE ON RETURN.
- `seo_ga4_event_create_rule_update` is the same shape: two-step, live on return, and
  `conditions` is a repeated field that a patch REPLACES, so send every condition you want
  to keep; renaming the destination event leaves any key event on the old name receiving
  nothing.
- `seo_ga4_key_event_delete` is DESTRUCTIVE AND IRREVERSIBLE: any imported Ads conversion
  flatlines immediately and silently, and if it sits in a bidding goal Smart Bidding loses
  the signal. Two-step confirm (strict boolean; the string 'true' only previews). Same for
  `seo_ga4_event_create_rule_delete` - GA4 stops creating the destination event entirely.
  Named targets only, never derived by pattern.

### GTM: status, install truth, and the draft-until-published model

- `seo_gtm_status({ connection_id })` - without container_path lists the containers the
  connection's Google user can see; with it, the publish preview: pending workspace changes,
  the draft-vs-live tag split (draft_only tags are NOT serving), triggers and variables
  with ids, and a loud warning when the container has NEVER been published. Read it before
  any tag work. Container pinning: the first container used successfully is claimed onto
  the connection and a later call naming a different one is refused with a 403; clear the
  pin only deliberately via `seo_connection_update({ gtm_container_path: null })`.
- `seo_gtm_install_status` - is the container actually ON the site, per tier, head and body
  separately. ALWAYS check before and after tag or publish work: a published container that
  is not installed fires on nobody while every tag call still reports success. The findings
  that cost money: wrong container, duplicate install, half install. It reads the SAVED
  custom-code state, never the live page; a container hardcoded in the site's source is
  invisible to it (`analytics_diagnose_tracking` sees that).
- `seo_gtm_install` - writes the snippet (head script + body noscript; GTM needs BOTH) into
  one tier's site-wide custom code. Strict two-step confirm; never duplicates, does repair.
  Saved is not live: it takes effect on the next deploy of that tier.
- Tag writes (`seo_gtm_tag_create`, `seo_gtm_tag_update`, `seo_gtm_tag_delete`), trigger
  writes (`seo_gtm_trigger_update`, `seo_gtm_trigger_delete`; a trigger is created inline
  through the `create_trigger` argument of `seo_gtm_tag_create`, there is no standalone
  trigger-create tool) and variable writes (`seo_gtm_variable_create`,
  `seo_gtm_variable_update`, `seo_gtm_variable_delete`) are WORKSPACE DRAFTS serving
  nothing until `seo_gtm_version_create` (which CONSUMES the workspace) then
  `seo_gtm_publish` - publish changes the client's live site and is two-step confirmed.
  Read the entity first (`seo_gtm_tag_get`, `seo_gtm_trigger_get`, `seo_gtm_variable_get`
  return every field plus `referenced_by`): updates are a replace-not-patch the tool merges
  for you, an empty string clears a field, a 409 means re-read and retry. Deletes are
  two-step and refused while anything references the entity; prefer `paused: true` through
  `seo_gtm_tag_update`, which is reversible.
- The rollback rail is `seo_gtm_tag_revert`, `seo_gtm_trigger_revert` and
  `seo_gtm_variable_revert`: each restores a workspace entity to the live published
  version (an entity ADDED in the workspace has nothing to restore to, so reverting it
  deletes it - the tool resolves that before writing), un-deletes a workspace delete that
  has not been published, and refuses when the workspace holds no change. Revert is not an
  unpublish: a bad tag already serving needs a corrected version published.

### Did organic convert - the three-call recipe

The question the retainer pays to answer. Three calls, then one reconciliation, and the
answer is a table, never a total.

1. `seo_ga4_conversion_audit({ connection_id, days: 30 })` - which key events exist and
   which fired. A key event that recorded nothing is a measurement gap; it goes in the
   report as a gap, and no organic number is claimed for it.
2. `seo_ga4_report({ connection_id, preset: 'channel_sessions', dimension_filter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Organic Search' } } } })`
   - organic sessions, engaged sessions and key events for the window (the preset already
   carries the filtered dimension). Add `dimensions: ['sessionDefaultChannelGroup', 'eventName']`
   and `metrics: ['keyEvents']` for key events by name when the audit shows more than one.
3. `seo_ga4_report({ connection_id, preset: 'landing_pages', dimensions: ['landingPage', 'sessionDefaultChannelGroup'], dimension_filter: <the same organic filter> })`
   - which organic landing pages produced the key events (the preset does not carry the
   filtered dimension, so it is added). Sort by keyEvents; the top ten are the money pages
   the on-page and internal-linking work protects.
4. Reconcile against `seo_gsc_time_series({ site_url, start, end })` for the same window,
   side by side: GSC clicks next to GA4 organic sessions, never summed and never
   reconciled into one figure. A gap of 10-30 percent is normal (definitions, consent,
   timezone, redirects); a gap that widened this month is a finding to chase in
   `rankings-and-search-console.md`'s artifact ladder.

### Organic leads

`seo_organic_leads({ from, to, project_id })` is the organic-leads reader. Beside it, organic
leads are cross-checked from two ledgers, side by side: `marketing_form_conversion_audit({ channel: 'Organic Search', from, to, timezone })`
gives form submissions with their attribution and named discrepancy buckets that sum to
the total (`buckets.counted` is our number; spam, duplicate, deleted and no_attribution
explain the rest; read `click_window` before quoting any click timing), and the GA4 key
events from the recipe above give what GA4 counted. Where the two disagree, the buckets are
the explanation, and the report shows both figures with their source. Phone leads from
organic are the call-tracking discipline in `hiveku-conversion-tracking`, not this file.

## Thresholds and benchmarks

| Item | Value | Label |
|---|---|---|
| GSC clicks versus GA4 organic sessions | 10-30 percent apart is normal; a widening gap is a finding | house rule |
| key event with zero events in 30 days | a measurement gap, reported as such | tool semantics |
| GA4 report window | last 30 complete days ending yesterday by default | Google |
| GA4 Data API quota | per property per hour; `property_quota` in every success | Google |
| thresholded report | partial, never zero; disclose it | Google privacy thresholding |
| CVR benchmarks when the client has none | `keyword-research.md` Play 6 | benchmarks, never the client's numbers |

## Diagnosis: when the data looks wrong

| Symptom | Cause, in check order | Action |
|---|---|---|
| every `seo_ga4_*` write 403s | token lacks analytics.edit | `seo_ga4_admin_scopes`; the customer reconnects |
| `seo_gtm_version_create` or `seo_gtm_publish` says reconnect | connection authorized before the publish scopes were requested (2026-08-23) | reconnect Google Analytics; nothing else fixes it |
| `seo_ga4_report` 429 | hourly token quota | stop for the hour; do not retry |
| filtered report returns unfiltered totals | the filtered dimension is not in `dimensions` | add it |
| rows do not sum to totals | thresholding or `(other)` folding | quote the warning; the totals are right, the rows are partial |
| zero rows on `ecommerce_revenue` | the property never sent purchase events | a tracking finding for the commerce or tracking skill, never zero revenue |
| GA4 organic sessions far below GSC clicks | consent blocking, a redirect chain on landing pages, the GTM container not installed on production | `seo_gtm_install_status` per tier, then the redirect check in `technical-seo.md` |
| tag calls succeed, conversions stay zero | container never published, or not installed | `seo_gtm_status` warning; `seo_gtm_install_status` |
| key event exists, records nothing | the event name never arrives | `seo_ga4_conversion_audit`; the rule or the site push is missing |

## Edge cases and failure modes

- No google_analytics connection: the Outcomes section reads "not measurable yet" with the
  setup task attached; never a number inferred from traffic.
- Never delete a key event or a rule by pattern; named targets only, two-step, and say
  what flatlines in Ads before the second call.
- Never publish a GTM version without reading `seo_gtm_status` pending changes and
  `seo_gtm_install_status` on production first; a version can carry someone else's draft.
- Never sweep `seo_connection_test` across every connection: a
  transient failure pauses that connection's sync until a passing test.
- Multi-property clients: the connection row decides the property; name it in the report.
- Do not sum GA4 key events with form audit counts, GSC clicks or CRM leads. Side by side.

## Persistence and reporting

### The monthly report's Outcomes section

From `seo_ga4_conversion_audit`: key events fired in the window, each tied to the organic
traffic story where the data supports it; zero-recording key events flagged as the
measurement gaps they are (a gap is a finding, not an embarrassment to hide). No
google_analytics connection = the section reads "not measurable yet" with the setup task
attached - never a silent omission, and never a number inferred from traffic. Honesty
vocabulary applies: unknown and not_applicable are valid outputs and never become passes;
a failed GA4 read makes the section partial, not zero.

The GA4 numbers block, from the three-call recipe:
- Organic sessions and engaged sessions (GA4, property timezone, window in days, property
  id named).
- Key events from organic by event name, with the counting method beside each (a
  once-per-session lead form and a once-per-event purchase are not the same unit).
- Top ten organic landing pages by key events, with sessions and engagement rate.
- Organic purchase revenue and transactions where the client sells online
  (`ecommerce_revenue` with the organic filter; see `ecommerce-seo.md` for the product
  split), labeled order-scoped.
- The GSC clicks figure for the same window beside the GA4 sessions figure, with the gap
  stated, never reconciled.
- Organic form leads from `seo_organic_leads`, with `marketing_form_conversion_audit`'s
  bucket breakdown beside it.
- Every warning the report returned (thresholding, sampling, partial day).
- The same-month-last-year figures where memory holds them (`forecasting-and-seasonality.md`
  F3), and the forecast band reconciliation row.

Persist: `memory_create` the month's figures and the key-event inventory (or
`memory_update` resending the whole seo note); a dated tab
(`seo_sheet_create_tab` named `"2026-08 Outcomes (GA4)"`, rows via `seo_sheet_add_rows`)
holding the landing-page table; `pm_tasks_create` for every measurement gap the audit
found, so next month's section has fewer of them.
