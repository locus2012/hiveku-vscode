# Reference: External sites hosted on Webflow - the Data API hands, the gates, the publish

This file owns every website project the account tracks that is HOSTED ON WEBFLOW: what
"Webflow hosting" means for a project row, how the `webflow_*` tools reach the site, which
gates refuse a call and what each code means, the two copies every write lands in (staged
and live), the publish that makes a change visible, and the things the Webflow Data API
cannot do at all. Load it when the ask is "fix the SEO titles on the Webflow site", "add a
blog post to their Webflow CMS", "install analytics on the Webflow site", "the redirects on
Webflow", "publish the Webflow site", or whenever `sites_list` shows the project the user
names with `external_platform: "webflow"`.

What this file does NOT own: the native code lane (Plays 1-12 of the hub), which does not
exist for a Webflow project; the SEO doctrine behind a title or a schema decision
(`hiveku-seo-agency/references/on-page-optimization.md`); the content bridge
(`hiveku-content-agency/references/site-publishing.md`); the tracking verdict
(`hiveku-conversion-tracking`). Cross-reference those; do not re-derive them here.

Read `account_context_get` before any client-facing output. Confirm every write, one object
per confirmation. A Webflow project has no code, no build, no deploy tier and no Hiveku
preview: the customer's live site is whatever Webflow last published.

## What Webflow hosting means for a project

- The row: `project_type: "external"`, `external_platform: "webflow"`, `cms_provider:
  "webflow"` on the `sites_list` row (and on `project_get`). Before the platform columns
  exist on a server the two keys are present and `null`; an external row with a null
  platform is a plain tracked URL site, never a Webflow site - do not guess.
- No code tree: `project_files_list` answers nothing, `deploy_site` and every VCS and
  build tool 400 on `project_type = "external"`. There is nothing to pull, commit or deploy.
- One site per project: the connection binds a Webflow site to the Hiveku project, and
  every `webflow_*` tool takes `project_id` and acts on that bound site.
- The budget: Webflow's Data API allows 60 requests per minute per connection by default
  (120 where the plan raises it; `webflow_token_introspect` reports the connection's
  limit). A `429 rate_limited` carries `retry_after_seconds`; wait it out, never retry in
  a tight loop, and prefer the bulk tools over one call per page or item.

## Availability

Every row is LIVE. The builder's Webflow ops registry holds 111 actions, one `webflow_*`
tool each, and the index carries all 111: the nine beta SEO actions (page query, bulk
metadata, page schema, llms.txt) landed 2026-09-06 and the content-source switch
2026-09-08. A name that does not resolve on your key is a server that has not redeployed
yet, never a missing capability: say so and file the gap. The gates, re-derived from the
ops modules on 2026-09-10: `confirm` marks the 32 actions that stage a confirmation
(`412 confirm_required` without `confirm: true`; the plugin ask list carries the same 32
names); `OAuth` marks the 15 calls a site token cannot make; `Enterprise` marks the 14
that Webflow serves only to Enterprise workspaces (`402 not_enterprise_plan_site`
elsewhere); `secondary locale only` marks the 3 DOM writes that refuse the primary
locale.

| Tool | Status | Gate |
|---|---|---|
| `webflow_site_list` | LIVE | - |
| `webflow_site_get` | LIVE | - |
| `webflow_site_domains_list` | LIVE | - |
| `webflow_site_publish` | LIVE | confirm |
| `webflow_token_introspect` | LIVE | - |
| `webflow_token_authorized_by` | LIVE | OAuth |
| `webflow_project_cms_provider_set` | LIVE | confirm |
| `webflow_page_list` | LIVE | - |
| `webflow_page_get` | LIVE | - |
| `webflow_page_metadata_update` | LIVE | - |
| `webflow_page_query` | LIVE | - |
| `webflow_page_metadata_update_bulk` | LIVE | - |
| `webflow_page_dom_get` | LIVE | - |
| `webflow_page_dom_update` | LIVE | secondary locale only |
| `webflow_page_customcode_get` | LIVE | OAuth |
| `webflow_page_customcode_set` | LIVE | OAuth, confirm |
| `webflow_page_customcode_delete` | LIVE | OAuth, confirm |
| `webflow_page_schema_get` | LIVE | - |
| `webflow_page_schema_set` | LIVE | - |
| `webflow_page_schema_query` | LIVE | - |
| `webflow_page_schema_update_bulk` | LIVE | - |
| `webflow_llms_txt_get` | LIVE | Enterprise |
| `webflow_llms_txt_set` | LIVE | Enterprise, confirm |
| `webflow_llms_txt_delete` | LIVE | Enterprise, confirm |
| `webflow_component_list` | LIVE | - |
| `webflow_component_content_get` | LIVE | - |
| `webflow_component_content_update` | LIVE | secondary locale only |
| `webflow_component_properties_get` | LIVE | - |
| `webflow_component_properties_update` | LIVE | secondary locale only |
| `webflow_cms_collection_list` | LIVE | - |
| `webflow_cms_collection_get` | LIVE | - |
| `webflow_cms_collection_create` | LIVE | - |
| `webflow_cms_collection_update` | LIVE | - |
| `webflow_cms_collection_delete` | LIVE | confirm |
| `webflow_cms_field_create` | LIVE | - |
| `webflow_cms_field_update` | LIVE | - |
| `webflow_cms_field_delete` | LIVE | confirm |
| `webflow_cms_item_list` | LIVE | - |
| `webflow_cms_item_live_list` | LIVE | - |
| `webflow_cms_item_get` | LIVE | - |
| `webflow_cms_item_query` | LIVE | - |
| `webflow_cms_item_create` | LIVE | - |
| `webflow_cms_item_create_bulk` | LIVE | - |
| `webflow_cms_item_update` | LIVE | - |
| `webflow_cms_item_update_bulk` | LIVE | - |
| `webflow_cms_item_delete` | LIVE | confirm |
| `webflow_cms_item_delete_bulk` | LIVE | confirm |
| `webflow_cms_item_publish` | LIVE | confirm |
| `webflow_cms_item_unpublish` | LIVE | confirm |
| `webflow_cms_item_unpublish_bulk` | LIVE | confirm |
| `webflow_asset_list` | LIVE | - |
| `webflow_asset_get` | LIVE | - |
| `webflow_asset_upload` | LIVE | - |
| `webflow_asset_update` | LIVE | - |
| `webflow_asset_delete` | LIVE | confirm |
| `webflow_asset_folder_list` | LIVE | - |
| `webflow_asset_folder_create` | LIVE | - |
| `webflow_script_list` | LIVE | OAuth |
| `webflow_script_register_hosted` | LIVE | OAuth |
| `webflow_script_register_inline` | LIVE | OAuth |
| `webflow_site_customcode_get` | LIVE | OAuth |
| `webflow_site_customcode_set` | LIVE | OAuth, confirm |
| `webflow_site_customcode_delete` | LIVE | OAuth, confirm |
| `webflow_customcode_blocks_list` | LIVE | OAuth |
| `webflow_hiveku_snippet_install` | LIVE | OAuth, confirm |
| `webflow_hiveku_snippet_remove` | LIVE | OAuth |
| `webflow_google_tag_list` | LIVE | - |
| `webflow_google_tag_upsert` | LIVE | confirm |
| `webflow_google_tag_delete` | LIVE | confirm |
| `webflow_form_list` | LIVE | - |
| `webflow_form_get` | LIVE | - |
| `webflow_form_submission_list` | LIVE | - |
| `webflow_form_submission_get` | LIVE | - |
| `webflow_form_submission_update` | LIVE | - |
| `webflow_form_submission_delete` | LIVE | confirm |
| `webflow_webhook_list` | LIVE | - |
| `webflow_webhook_get` | LIVE | - |
| `webflow_webhook_create` | LIVE | OAuth, confirm |
| `webflow_webhook_update` | LIVE | OAuth, confirm |
| `webflow_webhook_delete` | LIVE | confirm |
| `webflow_comment_thread_list` | LIVE | - |
| `webflow_comment_thread_get` | LIVE | - |
| `webflow_comment_reply_list` | LIVE | - |
| `webflow_comment_reply_create` | LIVE | - |
| `webflow_comment_thread_resolve` | LIVE | - |
| `webflow_ecommerce_settings_get` | LIVE | - |
| `webflow_product_list` | LIVE | - |
| `webflow_product_get` | LIVE | - |
| `webflow_product_create` | LIVE | - |
| `webflow_product_update` | LIVE | - |
| `webflow_sku_create` | LIVE | - |
| `webflow_sku_update` | LIVE | - |
| `webflow_order_list` | LIVE | - |
| `webflow_order_get` | LIVE | - |
| `webflow_order_update` | LIVE | - |
| `webflow_order_fulfill` | LIVE | confirm |
| `webflow_order_unfulfill` | LIVE | - |
| `webflow_order_refund` | LIVE | confirm |
| `webflow_inventory_get` | LIVE | - |
| `webflow_inventory_update` | LIVE | - |
| `webflow_redirect_list` | LIVE | Enterprise |
| `webflow_redirect_create` | LIVE | Enterprise, confirm |
| `webflow_redirect_update` | LIVE | Enterprise |
| `webflow_redirect_delete` | LIVE | Enterprise, confirm |
| `webflow_robots_get` | LIVE | Enterprise |
| `webflow_robots_replace` | LIVE | Enterprise, confirm |
| `webflow_robots_update` | LIVE | Enterprise, confirm |
| `webflow_robots_delete` | LIVE | Enterprise, confirm |
| `webflow_wellknown_create` | LIVE | Enterprise, confirm |
| `webflow_wellknown_delete` | LIVE | Enterprise, confirm |
| `webflow_activity_log_list` | LIVE | Enterprise |

Webhooks in that table are for FOREIGN URLs only. Hiveku registers its own receiver on
the site's connection (thirteen `webflow*Trigger` workflow nodes fire from it, verified,
deduped and bound to the project), so reacting to a site event is an automation with
`/hiveku:automate`, never a `webflow_webhook_create` pointed at Hiveku or at a
`webhookTrigger` URL: that creates a second, unverified delivery of an event Hiveku
already has.

The 32 that ask, since builder 93327517a (2026-09-09): `webflow_asset_delete`,
`webflow_cms_collection_delete`, `webflow_cms_field_delete`, `webflow_cms_item_delete`,
`webflow_cms_item_delete_bulk`, `webflow_cms_item_publish`, `webflow_cms_item_unpublish`,
`webflow_cms_item_unpublish_bulk`, `webflow_form_submission_delete`,
`webflow_google_tag_delete`, `webflow_google_tag_upsert`,
`webflow_hiveku_snippet_install`, `webflow_llms_txt_delete`, `webflow_llms_txt_set`,
`webflow_order_fulfill`, `webflow_order_refund`, `webflow_page_customcode_delete`,
`webflow_page_customcode_set`, `webflow_project_cms_provider_set`,
`webflow_redirect_create`, `webflow_redirect_delete`, `webflow_robots_delete`,
`webflow_robots_replace`, `webflow_robots_update`, `webflow_site_customcode_delete`,
`webflow_site_customcode_set`, `webflow_site_publish`, `webflow_webhook_create`,
`webflow_webhook_delete`, `webflow_webhook_update`, `webflow_wellknown_create`,
`webflow_wellknown_delete`. In plain terms: item publish and unpublish, the custom code
and Google tag writes, the Hiveku snippet install, the llms.txt, robots, redirect and
well-known writes and the content-source switch now ask before running, alongside every
delete, the site publish and the two money moves that always did. Each answers `412
confirm_required` until `confirm: true` is sent: show what will change, get the yes, then
send it, never first.

## Resolve the project

- `sites_list` is the id space. Every row carries `id` (the website project UUID every
  `webflow_*` tool takes as `project_id`), `project_type`, `external_platform`,
  `cms_provider` and `external_website_url`. Pick the row whose `external_platform` is
  `"webflow"`; read one row with `project_get({ project_id })`.
- Never `list_projects` / `get_project`: those are pm_projects rows, a different id space,
  and a website UUID 404s against them.
- A Webflow site with no Hiveku project yet is registered with `site_create_external({
  name, external_website_url, external_platform: "webflow" })`, then connected in the
  dashboard (below). Registering does not connect, and connecting does not switch the
  project's content source: that is `webflow_project_cms_provider_set` (the CMS section).

## Connection and auth kind

- The connection is made in the dashboard, on the project's Settings page (Webflow
  panel): either a SITE TOKEN pasted from Webflow's site settings, or an OAUTH
  authorization. There is no MCP tool that connects; `integration_connect_link_create`
  does not mint Webflow links, and `connections_status` does not list Webflow. Send the
  user to the panel and say what kind of connection the work needs.
- Test it: `webflow_site_get({ project_id })` answers the bound site or `no_webflow_connection`;
  `webflow_token_introspect({ project_id })` reads the granted scopes, the rate limit and
  the sites the token reaches, which is how a `412 missing_scopes` refusal is explained.
  Department agents (`talk_to_department`) reach the same check through their own
  `webflow_status` tool, which is an agent-side name, not an MCP tool.
- Site token versus OAuth: everything marked `OAuth` in the Availability table is refused
  by Webflow on a site token - the registered-scripts family (custom code, the Hiveku
  analytics snippet, page custom code), webhook registration and
  `webflow_token_authorized_by`. A `412 oauth_required` names it. The fix is a reconnect
  through OAuth in the panel, not a retry.

## The gates, as codes

Every refusal is a code you can act on. Read the code before the message.

| Status | Code | What it means and what to do |
|---|---|---|
| 412 | `missing_scopes` | The connection was granted without the scope the call needs (`required_scopes` in the body). Reconnect with the scope; `webflow_token_introspect` shows what it has. |
| 412 | `confirm_required` | The action stages a confirmation and `confirm: true` was not sent. Show the user what will change, get the yes, send `confirm: true`. Never send it first. |
| 412 | `oauth_required` | A site token was used on an OAuth-only family. Reconnect through OAuth. |
| 412 | `secondary_locale_required` | `webflow_page_dom_update`, `webflow_component_content_update` and `webflow_component_properties_update` write secondary locales only; the primary locale's text lives in the Designer. Pass a secondary `locale_id` or hand the edit to the designer. |
| 402 | `not_enterprise_plan_site` | Redirects, robots.txt, well-known files, llms.txt and the activity log need a Webflow Enterprise workspace. Say so; the customer's Webflow plan is the fix, not a retry. |
| 409 | `write_locked` | Another write on the same page, item or site is in flight (the Hiveku write lock). Wait a few seconds and retry once. |
| 404 | `page_not_found` | The `page_id` is not on the bound site (a foreign id, or a page deleted in the Designer). Re-read `webflow_page_list`. |
| 429 | `rate_limited` | The per-connection Data API budget is spent; `retry_after_seconds` says when. |
| 429 | `publish_cooldown` | Webflow allows one site publish per minute; `retry_after_seconds` says when the next one is accepted. |
| 424 | `snippet_apply_failed` | `webflow_hiveku_snippet_install` registered the script but could not apply it; run it again to finish. |

## The two copies and the publish

Every write lands on the STAGED site first. Visitors see the LIVE copy, which changes only
when something publishes:

- CMS items: `webflow_cms_item_publish({ project_id, collection_id, item_ids, confirm:
  true })` publishes staged items by id (100 per call) without republishing the site. It
  asks before running because the items go in front of visitors immediately, and so do
  `webflow_cms_item_unpublish` and `webflow_cms_item_unpublish_bulk`, which take a live
  copy down just as immediately (the staged item is kept). `webflow_cms_item_list` reads
  the staged copies, `webflow_cms_item_live_list` the live ones; an item present in the
  first and absent from the second is staged and unpublished. Items still `is_draft` are
  skipped by the publish; update them with `is_draft: false` first.
- Everything else (page titles and SEO, DOM text, custom code, redirects, robots, schema,
  llms.txt): `webflow_site_publish({ project_id, confirm: true })` publishes the site to
  its custom domains (or the webflow.io subdomain when it has none). One publish per
  minute per site; the second answers `429 publish_cooldown`.
- Report which copy changed. "Saved" means staged; "live" means published, and only after
  the publish call answered. Never say a page is live because the write succeeded.
- `webflow_site_get` carries `lastPublished` and `lastUpdated`; a `lastUpdated` after
  `lastPublished` means the site has unpublished changes, which is the state to report
  before asking for a publish.

## What the Data API cannot do

Webflow's Data API has no call for these; say so and hand them to the designer:

- Create or delete a page, move a page between folders, change a page's layout or class
  styles. Pages come from the Designer; the API edits their metadata, text nodes, custom
  code and schema.
- Edit CSS, interactions or the primary locale's text through the DOM tools
  (`webflow_page_dom_update` is secondary-locale only).
- Create a component or change its structure (`webflow_component_content_update` writes
  secondary-locale text; `webflow_component_properties_update` writes default property
  text).
- Read code a designer pasted into Site settings or a page's settings by hand:
  `webflow_site_customcode_get` and `webflow_page_customcode_get` see only what this App
  applied.
- Restore a deleted item, field, collection, asset, redirect or well-known file. Every
  delete in the Availability table is permanent on the Webflow side, which is why each one
  stages a confirmation.

## Locales

- Omit `locale_id` and every read and write targets the PRIMARY locale.
- The three DOM and component writes accept only a SECONDARY `locale_id`
  (`412 secondary_locale_required` otherwise). `webflow_site_get` lists `locales.primary`
  and `locales.secondary` with their ids.
- Page metadata and schema writes accept an optional `locale_id` for a localized
  variant; omitted, the primary page changes.

## Page SEO

- Read: `webflow_page_list({ project_id })` for every static and collection-template page
  with id, slug, title and SEO fields; `webflow_page_get` for one. The workspace's SEO
  grid (`/dashboard/<project id>/webflow/seo`) shows the same rows with the on-page checks.
- One page: `webflow_page_metadata_update({ project_id, page_id, title?, slug?, seo?,
  openGraph? })` - only the fields passed change, and the edit is staged until a site
  publish.
- Many pages: `webflow_page_metadata_update_bulk({ project_id, pages: [{ id, title?,
  slug?, seo?, openGraph?, locale_id? }] })`, up to 100 pages per call. `seo` and
  `openGraph` are nested objects, never flat keys (an unknown key is refused with a 422
  naming the entry, not dropped); only the keys passed change; the write is staged until
  a site publish. The SEO grid's Save all is the dashboard equivalent.
- Sorting pages by creation or last change, filtering by a date window, or finding one
  page by slug: `webflow_page_query({ project_id, sort_by?, sort_order?, updated_after?,
  updated_before?, created_after?, created_before?, slug?, offset?, limit? })`, 100 per
  page. The slug lookup is a client-side scan capped at 500 pages or 10 requests: an
  empty list with `slug_scan.capped: true` means the slug was not in the pages scanned,
  not that the page does not exist.
- The doctrine for what a title or description should say is
  `hiveku-seo-agency/references/on-page-optimization.md`; this file only carries the
  write path.

## Schema markup (JSON-LD) and llms.txt

- Schema markup: one JSON-LD object per page. Read one with `webflow_page_schema_get({
  project_id, page_id, locale_id? })` (`json_ld`, `raw_json_ld` when the Designer stored
  several script blocks, `is_inherited`) or up to 100 at once with
  `webflow_page_schema_query({ project_id, page_ids, locale_id? })` (comma-separated ids
  from `webflow_page_list`). Write one with `webflow_page_schema_set({ project_id,
  page_id, json_ld | json_ld_text | clear: true, locale_id? })`, exactly one of the three:
  an object, a raw JSON string or a `<script type="application/ld+json">` block with its
  closing tag, or the clear. Up to 25 at once: `webflow_page_schema_update_bulk({
  project_id, pages: [{ id, json_ld | json_ld_text | clear, locale_id? }] })`. Limits 60
  KB, 32 levels deep and 5000 nodes per page; the page editor's Schema tab in the Webflow
  workspace validates the same way. A page that carries no schema of its own may INHERIT
  the site-wide default, which the read reports as inherited; clearing a page's schema
  returns it to that default. Every write is staged until a site publish.
- llms.txt: the AI-crawler guidance file at the site root, Enterprise workspaces only
  (`402 not_enterprise_plan_site` elsewhere). `webflow_llms_txt_get({ project_id })`
  reads it as `{ content, exists }`; `webflow_llms_txt_set({ project_id, file_data })`
  writes or replaces it (plain text, under 100 kB); `webflow_llms_txt_delete({
  project_id })` removes it. Both writes ask before running: the set replaces the
  guidance every AI crawler reads from the next publish, and the delete leaves none until
  a file is written again. The AEO lane (`seo_aeo_readiness`) is where the file's content
  comes from; the workspace's Redirects page has a section that generates it. Both writes
  are staged until a site publish.

## Custom code and the Hiveku analytics snippet

- Everything here is OAuth-only (`412 oauth_required` on a site token) and lands on the
  next `webflow_site_publish`.
- Registered scripts: `webflow_script_list` reads what is registered to the site;
  `webflow_script_register_hosted` / `webflow_script_register_inline` register one;
  `webflow_site_customcode_set` REPLACES the full list of scripts applied site-wide (read
  `webflow_site_customcode_get` first and merge, never write from memory) and asks before
  running, because a script left out of the list stops on every page;
  `webflow_site_customcode_delete` removes every applied script, the analytics and
  annotation snippets included, and asks as well. Per page: `webflow_page_customcode_get`,
  then `webflow_page_customcode_set` (asks; the same replace semantics on one page) and
  `webflow_page_customcode_delete` (asks).
- The Hiveku analytics snippet: `webflow_hiveku_snippet_install({ project_id, kind:
  "analytics", confirm: true })` registers the HivekuAnalytics loader as an inline script
  and applies it site-wide (header), keeping other applied scripts. It asks before
  running: the loader lands in the header of every page and collects visitor analytics
  from the next publish. `kind: "bridge"` installs the annotation bridge for Review and
  annotate. `webflow_hiveku_snippet_remove` reverses it and does not ask. Then publish.
  `424 snippet_apply_failed` means registered but not applied; run it again.
- Google tags (GA4, Google Ads, GTM) go through Webflow's native integration:
  `webflow_google_tag_list`, then `webflow_google_tag_upsert` (asks: it adds a tag that
  collects visitor data on every page from the next publish) and
  `webflow_google_tag_delete` (asks: tracking through the tag stops on the next publish).
  These are not registered scripts and do not appear in `webflow_script_list`.

### Is Hiveku analytics installed?

The dashboard derives "installed" from two reads; do the same join here, there is no
status field:

1. `webflow_script_list({ project_id })` - find the entry whose `displayName` is
   `HivekuAnalytics`; its `id` is the registered script. No entry means not registered.
2. `webflow_site_customcode_get({ project_id })` - the snippet is APPLIED when that script
   id is in `scripts`.
3. Installed = registered AND applied. Registered but not applied is the `424` state (run
   `webflow_hiveku_snippet_install` again). Neither means run the install, then publish.
4. A site-token connection cannot answer either read (`412 oauth_required`); say that the
   status is unknown from here and that the panel needs an OAuth reconnect before the
   snippet can be installed or checked. `analytics_diagnose_tracking({ project_id })`
   still reports whether events arrive, which is the other half of the verdict.

## CMS on a Webflow project

- The content source: `webflow_project_cms_provider_set({ project_id, cms_provider:
  "webflow" | "native", site_id?, confirm: true })` points the project's CMS at Webflow
  or back at Hiveku's native files; `cms_provider` on the `sites_list` row shows the
  current value. It needs a bound site: `"webflow"` binds the site the call resolves
  (`site_id`, else the project's bound site, else the connection's only one) and refuses
  `site_required` when the connection reaches several sites and none is named; the
  connection also needs `cms:read` so the content routes can read collections through
  it. It asks before running because every later content write for the project lands on
  the customer's live Webflow CMS. Connecting in the panel does not switch the source;
  this call does.
- The generic `cms_*` tools serve a Webflow-backed project through the provider seam:
  `cms_list_collections`, `cms_list_entries`, `cms_read_entry`, `cms_write_entry` and the
  rest read and write Webflow collections, with the collection SLUG as `collection_id`.
  Writes land STAGED; the response's `visibility.kind` is `publish_required` until
  `cms_publish({ project_id, collection_id, slugs })` makes them live (`site: true`
  publishes the whole site as well, subject to the one-per-minute cooldown). A native
  Hiveku-CMS project answers `501 cms_capability_unsupported` to `cms_publish` because its
  content goes live on deploy.
- The raw `webflow_cms_*` tools are the same collections by Webflow id: use them when the
  user names the raw Webflow path, for bulk item work (`webflow_cms_item_create_bulk` up
  to 500, `webflow_cms_item_update_bulk` up to 100) and for collection schema changes
  (`webflow_cms_collection_create`, `webflow_cms_field_create`).
- A content item is published to a Webflow site through `content_publish_to_site` (the
  editor's own Publish path): it maps the fields through the provider, lands staged and
  records the CMS link on the content row. Do not write the same entry a second time
  through `webflow_cms_item_create`.
- Deletes have no restore on Webflow: `cms_delete_entry` unpublishes then deletes the item
  and there is no version history to restore from (the native `cms_list_entry_versions`
  rail does not exist on Webflow); `cms_bulk_delete` likewise, slug by slug. Both are on
  the plugin ask list; confirm every one with the exact slugs, and run
  `cms_back_references` first. `cms_delete_collection` and `cms_remove_field` answer
  `501 cms_capability_unsupported` on a Webflow project: a Webflow collection or field is
  deleted by `webflow_cms_collection_delete` / `webflow_cms_field_delete` (confirm), and
  every staged and live item in a deleted collection goes with it.

## Forms, webhooks, comments, ecommerce, redirects and robots

- Forms: `webflow_form_list` and `webflow_form_get` read the forms; submissions are
  `webflow_form_submission_list` / `webflow_form_submission_get` (visitor data - treat
  it like `crm_list_contacts`), `webflow_form_submission_update` sets hidden fields,
  `webflow_form_submission_delete` (confirm) is irreversible on Webflow. Wire a form to
  the CRM through the automation department, not by polling here: the 13 Webflow
  triggers (site publish, CMS item, page, comment and form submission events, plus a
  catch-all) are registered on connect and workflows consume them as
  `webflow*Trigger` nodes, with `webflowFormSubmissionTrigger` / `formSubmittedTrigger`
  firing per submission through the Forms ledger.
- Webhooks: `webflow_webhook_list`, `webflow_webhook_get`, `webflow_webhook_create`
  (OAuth, confirm: the receiver starts delivering immediately with no publish, and a
  form_submission webhook sends every lead's name, email and phone to the URL named),
  `webflow_webhook_update` (OAuth, confirm: Webflow re-creates the webhook, and a failed
  re-registration leaves none), `webflow_webhook_delete` (confirm).
- Comments: `webflow_comment_thread_list`, `webflow_comment_thread_get`,
  `webflow_comment_reply_list`, `webflow_comment_reply_create` (posts as the authorizing
  user), `webflow_comment_thread_resolve`.
- Ecommerce: settings, products and SKUs, orders (`webflow_order_fulfill` and
  `webflow_order_refund` are money moves and stage a confirmation), inventory. Order rows
  carry buyer data; same care as submissions.
- Redirects, robots.txt and well-known files are Enterprise-only, and every write in the
  three families except `webflow_redirect_update` asks before running:
  `webflow_redirect_create` (a 301 sends real traffic elsewhere after the next publish)
  and `webflow_redirect_delete` (the old URL 404s); `webflow_robots_replace` removes every
  rule not in the request, `webflow_robots_update` merges (a wrong Disallow deindexes the
  site) and `webflow_robots_delete` removes listed rules (a user agent left with none
  becomes unrestricted); `webflow_wellknown_create` creates or REPLACES a file under
  `/.well-known/` (a domain verification another service depends on can be overwritten)
  and `webflow_wellknown_delete` removes listed files. Every one of these lands on the
  next site publish, and `project_redirects_*` / `project_redirects_deploy` do not apply
  to a Webflow project.

## Reporting a Webflow site

Name the copy (staged or live) for every change, the publish call that made it live and
its time, the connection kind (site token or OAuth) when it limited what could be done,
and every gate you hit as its code. A Webflow site has no build log, no deploy history and
no preview; the weekly health read is `webflow_site_get` (last published versus last
updated), `webflow_page_list` for the SEO fields, `webflow_cms_item_live_list` against
`webflow_cms_item_list` for staged content nobody published, and the analytics join above.
