# SEO change discipline

## What this covers / when to load this

The rules for changing anything on a client's search presence: titles and metas, canonicals,
robots directives, redirects, structured data, sitemaps, tracked keywords, Google Business Profile
fields, GA4 key events, the report workspace, and the implement rail that ends in a production
deploy. It is the safety layer under every play in the hub skill and every other reference here.
Load it before your first write of a session on any account you did not build yourself, and again
whenever the next call is a write on a live site or a live listing.

It does not teach what to change: on-page choices are `references/on-page-optimization.md`,
crawl and index mechanics `references/technical-seo.md`, refresh and consolidation
`references/content-strategy.md`, reports and the implement rail's own steps
`references/reporting-and-delivery.md`, GBP plays `references/local-seo.md`, GA4 and GTM
`references/outcomes-and-measurement.md`. It teaches the sequence: what you must know before a
write, what you must say before a write, what Hiveku refuses on its own, and what you must read
after a write to know it happened.

Every tool named here exists in `lib/tool-index.json`; every enforcement claim in section 4 was
checked against the tool's own description on 2026-08-30, and the redirect, crawl, fetch and
tracked-keyword claims against the builder routes behind them. Where a rail does not exist this
file says so rather than implying one.

## Availability

All writes governed here are LIVE. Cost classes: write = free, confirm rules per section 4; E =
on_page instant per URL; F = crawl per page (`max_crawl_pages` default 50, clamp 500); G = LLM
mentions, about $0.10 per keyword per engine; I = one Business Listings search, 24h cooldown.

| Tool | Status | Cost | Note |
|---|---|---|---|
| `pages_update`, `cms_write_entry` | LIVE | write | page-model fields and CMS upserts; no confirm |
| `project_files_bulk_save`, `project_vcs_commit`, `deploy_site` | LIVE | write | the code lane; commit is not live; no confirm on deploy |
| `project_redirect_create`, `project_redirect_update`, `project_redirect_delete`, `project_redirects_deploy` | LIVE | write | stored until deploy; deploy defaults to production |
| `seo_gsc_submit_sitemap`, `seo_gsc_delete_sitemap`, `seo_bing_submit_sitemap`, `seo_bing_submit_url` | LIVE | write | delete destroys the reporting row, never deindexes |
| `seo_track_keyword`, `seo_tracked_keyword_delete` | LIVE | write, G on AI lanes | delete is partial and irreversible, 2.7 |
| `seo_gbp_location_update`, `seo_gbp_attributes_update`, `seo_gbp_services_update`, `seo_gbp_media_add`, `seo_gbp_media_delete`, `seo_gbp_review_reply`, `seo_gbp_review_reply_delete` | LIVE | write | two-step; public on return |
| `seo_ga4_key_event_update`, `seo_ga4_key_event_delete`, `seo_ga4_event_create_rule_update`, `seo_ga4_event_create_rule_delete`, `seo_gtm_install`, `seo_gtm_publish` | LIVE | write | two-step; live on return |
| `seo_task_implement`, `agent_approval_approve` | LIVE | paid agent turn | two-step each; ends in a production deploy |
| `seo_report_clear`, `seo_deliverable_delete`, `seo_connection_delete`, `seo_project_update` | LIVE | write | no confirm, 4.3 |
| `seo_audit_start`, `seo_research` crawl actions, `seo_aeo_rankings_sync`, `seo_citations_audit` | LIVE | F / E, G, I | metered, no confirm |
| `pm_tasks_comment`, `memory_list_versions`, `memory_restore_version`, `checkpoint_create`, `project_checkpoint_restore`, `audit_query` | LIVE | free | the audit trail and the undo handles |

The diff-and-preview reader for a staged implement is `seo_task_changes`, owned by
`references/reporting-and-delivery.md`: read it before any approve; the staged action itself
shows only one line of prose.

## The governing rule

> No read means no claim, no confirm means no write, no live check means no "shipped".

- **No read means no claim.** "The canonical is probably wrong" is not a finding; `fetch_url`
  returning a `<link rel="canonical">` that points at staging is.
- **No confirm means no write.** Every mutation gets its own approval for its own exact diff. Not
  a batch yes, not "sounds good" from a skimmed plan, not "implement this" read as pre-approval of
  the deploy at the end of the rail.
- **No live check means no "shipped".** A 200 from `pages_update` proves the row changed. The site
  is served from the last deploy and cached at the edge; the engine's copy is older still.

## 0. The gate an SEO mutation must clear

Before any write, all six are true and you can point at what makes each one true:

1. **A tested capability on this key.** `seo_` rides full, marketing and marketing-seo keys;
   `project_` (redirects included), `cms_` and `deploy_site` are not visible to a marketing-seo
   key today. A tool outside the profile fails like a missing feature: say "not visible to this
   key", never "does not exist", and route through `pages_update` or the implement rail.
2. **Explicit ids from a read THIS session, with the id space named.** Website project id from
   `sites_list`; `page_id` from `pages_list`; SEO tracking project id from `seo_list_projects`;
   `connection_id` from `seo_connections_list`; `keyword_id` from `seo_tracked_keywords_list`
   (not the `ranking_id` from `seo_rankings_list`, a different table); redirect `id` from
   `project_redirects_list`; `task_id` from `seo_task_list`; the GSC `site_url` as the exact
   property string. Never an id carried over from another account's conversation.
3. **A before and after a human can read, with blast radius** in pages, templates, rank lanes and
   locations. Section 2.
4. **Owner approval inside the account's own rules.** `account_context_get({ domain: 'seo' })`
   names protected pages and thresholds; `memory_list({ domain: 'seo', include_project_scoped:
   true })` holds the canonical strategy, intentional exclusions and who owns robots.txt. If the
   rule you need is missing, getting it written is the first change you propose.
5. **An audit trail.** `pm_tasks_comment({ task_id, content })` carries the diff you showed, the
   approval you got, and every id the write returned: redirect `id`, `ranking.id`,
   `deployment_id`, `checkpoint_hash`. Undo handles need those strings.
6. **Remote state matches your preconditions.** The value you diffed against is only as fresh as
   its last sync (1.2).

Until all six hold the change is a DRAFT. Write drafts into the PM task, not into the site.

## 1. Read-only by default

### 1.1 The read spine per object class

| Object | The read | What it settles |
|---|---|---|
| Page (pages model) | `pages_list({ project_id })`, `pages_get({ project_id, page_id })`, plus `fetch_url({ url })` | Stored `meta_title`, `meta_description`, `slug`, `show_in_sitemap`, `is_published`, `file_path`; and what the live HTML serves, the only diff that matters |
| Template / code | `project_files_search({ project_id, query })`, then `project_files_bulk_get` | Which file emits the title, canonical, robots meta or JSON-LD, and whether it overrides the page row |
| Redirects | `project_redirects_list({ project_id })` | Every rule's `id`, `from_path`, `to_path`, `status_code`, `match_type`, `is_active`; the chain you are about to lengthen |
| Sitemap | `seo_gsc_list_sitemaps({ site_url })`, `seo_gsc_get_sitemap({ site_url, feedpath })` | Submitted vs indexed, `lastDownloaded`, `errors[]`; the reporting row a delete destroys |
| GBP listing | `seo_gbp_location({ connection_id })` | Live title, phone, address, hours, categories; refreshes the cached snapshot. Quota-limited: once per location, never looped |
| Tracked keywords | `seo_tracked_keywords_list`, `seo_rankings_list({ group_by_keyword: true })` | The `keyword_id` a delete needs; `pagination.total_groups` as the honest count; which AI lanes exist (blank = not tracked, never not ranking) |
| GA4 / GTM | `seo_ga4_key_events_list({ connection_id })`, `seo_gtm_status({ connection_id, container_path })` | Counting method and default value per key event; pending changes, draft-only tags, live version |
| Robots, canonical, noindex | `fetch_url` on the URL and on `/robots.txt` | The served directive. `seo_project_update`'s `robots_txt_content` only fills in at deploy time, where the code ships none |
| Engine's view | `seo_gsc_inspect_url({ site_url, inspection_url })` | The indexed snapshot: coverage, selected canonical, `lastCrawlTime`, rich results. Never a live test |

### 1.2 Freshness is a precondition, not a nicety

- **Project-scoped `seo_*` reads** are as fresh as the last `seo_sync({ project_id })` or cron
  tick. Sync before you diff against a stored value, and after a batch of writes.
- **Audits.** The persisted lane round-trips (live since 2026-08-30): `seo_audit_start` queues a
  crawl, `seo_audit_get` polls and persists it, and the `seo_research` crawl actions with
  `target` = its task_id stay the deep dive. A crawl older than 14 days, or older
  than the last deploy, is history. An empty audit list means no crawl has run, never a clean site.
- **GSC** rows are dated in Pacific time and final about 3 days late; retention rolls at 16 months.
- **GBP** cached reads refresh on a six-hour cron; a snapshot older than 26 hours is stale, not
  fact. Draft listing edits from one fresh `seo_gbp_location`.
- **Sweep-fed reads** (`seo_internal_links`, `seo_schema_markup`, `seo_eeat_scores`,
  `seo_content_decay`) move on the Sunday sweep; a read the day after your change shows the state
  before it. **CWV field data** is a 28-day window.

### 1.3 Reads that are read-only by construction

- `seo_task_implement({ task_id })` without `confirm` dispatches nothing and returns
  `{ requires_confirm: true, preview }` with the target project and page anchor.
- Every `seo_gbp_*` write without `confirm` returns a preview and publishes nothing;
  `seo_gbp_services_update` even returns a live added/removed/kept diff.
- `seo_aeo_rankings_sync({ ..., skip_sync: true })` creates tracking rows and spends nothing.
- `agent_approval_get({ token })` inspects a staged deploy without consuming the token.
- `project_files_bulk_save({ ..., delete_missing: true, dry_run: true })` returns the plan
  without writing or checkpointing.
- `fetch_url` refuses private hosts and stops after 5 redirect hops; safe on any client URL.

## 2. The diff discipline

### 2.1 The three lines

Never apply a change without putting these in front of the operator, in chat and in the PM task:

```
CHANGE:   <tool> on <object, by id and id space>
CURRENT:  <the value you read, the read you got it from, its freshness>
PROPOSED: <the exact value you will send>
IF WRONG: <pages, rankings, money, and time-to-notice>
SCOPE:    <every page, template, lane and location this touches>
UNDO:     <tool + identifier that reverses it, or "none">
```

`IF WRONG` prices the mistake before you make it. `SCOPE` catches the template, the prefix rule
and the whole-menu replace, where the object you named is not the only object that changes.

### 2.2 Title and meta: the obvious case

```
CHANGE:   pages_update, website project <uuid> (sites_list), page <uuid> (pages_list) "/services/roof-repair"
CURRENT:  meta_title "Roof Repair | Acme" (pages_get this session; live <title> matches, fetch_url)
PROPOSED: meta_title "Roof Repair in Dallas - Same-Day Estimates | Acme" (58 chars)
IF WRONG: one page's CTR for two weeks; visible in seo_gsc_search_analytics with a page filter
          after the 3-day lag. Reversible in one call.
SCOPE:    this page. If pages_get shows a file_path, confirm with project_files_search that the
          template reads meta_title, or the write is a no-op that still returns 200.
UNDO:     pages_update back to the CURRENT string
```

### 2.3 Canonical, noindex and robots: the quiet deindexer

There is no canonical or robots field on `pages_update`. Those live in the template (code lane),
in `public/robots.txt` (code lane), or in the per-page SEO writer
(`references/on-page-optimization.md` Availability). Two `pages_update` fields still deindex
quietly: `is_published: false` turns the URL into a 404, and `show_in_sitemap: false` drops it
from the next generated sitemap.

```
CHANGE:   project_files_bulk_save + project_vcs_commit + deploy_site, file src/app/layout.tsx
CURRENT:  <meta name="robots" content="noindex"> in the layout (project_files_search "noindex";
          fetch_url confirms it is SERVED on every page, including /services/*)
PROPOSED: remove the tag from the layout; keep it on /thank-you via that page's own metadata
IF WRONG: the whole site, not a page. A noindex left in a layout removes every URL within days;
          recovery takes weeks after the fix. Time-to-notice is "the client calls".
SCOPE:    every route the layout wraps - name them from pages_list. A staging noindex shipped
          to production is the classic post-deploy regression (technical-seo.md Play T2).
UNDO:     project_checkpoint_restore with the commit's checkpoint_hash, then deploy again
```

The write looks like one line, the effect is the whole index, and the damage is invisible until
the recrawl. Three rules: robots.txt Disallow plus meta noindex on one URL is a contradiction (the
blocked page's noindex is never seen); a canonical is a hint, so pointing it elsewhere and hoping
is not a fix; and `seo_project_update({ robots_txt_content })` only fills in at deploy time on a
project whose code ships no robots source, so a real robots.txt ships as `public/robots.txt` through
the code lane and is proven with `fetch_url`.
Never block crawlers in robots.txt to fix duplication.

### 2.4 Redirects: prefix blast radius and chains

```
CHANGE:   project_redirect_create, website project <uuid>, from "/blog" to "/articles",
          status_code 301, match_type "prefix"; then project_redirects_deploy({ tier })
CURRENT:  no rule on /blog (project_redirects_list); /blog/* serves 200 (fetch_url, 3 samples)
PROPOSED: prefix rule; the edge appends the remainder, so /blog/x -> /articles/x
IF WRONG: a prefix matches every URI that STARTS with from_path: "/blog" also catches
          "/blog-tips" and sends it to "/articles-tips". A 301 is cached by browsers and
          engines; unwinding takes weeks. Write "/blog/" when you mean the directory.
SCOPE:    every URL under the prefix, plus every existing rule whose to_path lands inside it (a
          new chain). project_redirects_deploy also ships the DOMAIN redirects derived from
          attached domains: every non-primary domain 301s to the primary, production only.
UNDO:     project_redirect_delete({ id }) then project_redirects_deploy again - the edge serves
          the old set until the deploy runs
```

The route refuses direct loops, trailing-slash-only rules, duplicate sources and circular chains
traced to 10 hops, at create and update, never at deploy. Chains are not refused: an existing A to
B plus your new B to C is legal and slow, so update A to point at C with
`project_redirect_update({ id, to_path })` instead. `status_code` defaults to 301; 302 or 307 only
for a genuinely temporary move. Rules sit in the DB until `project_redirects_deploy` pushes them
to CloudFront (functions up to 150 rules, Lambda@Edge above), and `tier` defaults to production,
so name the tier in the CHANGE line every time.

### 2.5 Schema

Template JSON-LD is a code change; page-level blocks go through the page schema writer
(`references/on-page-optimization.md` Availability) or the code lane. The diff is the
whole block: markup describing something not visible on the page risks a manual action, a syntax
error silently invalidates the entire block, and a `Product` with invented ratings is a policy
violation that outlives the fix. CURRENT is what `fetch_url` serves and what
`seo_gsc_inspect_url` detected; `seo_schema_markup` is the stored detected-versus-suggested view,
sweep-refreshed, not a live fetch.

### 2.6 Sitemap submit and delete

`seo_gsc_submit_sitemap({ site_url, feedpath })` is idempotent and low-risk, provided the file
holds only canonical, 200, indexable URLs: a dirty sitemap teaches the engine your sitemap is
unreliable. `seo_gsc_delete_sitemap({ site_url, feedpath })` never deindexes; it destroys the
reporting row and the submitted-versus-indexed history you measure index ratio with. Its only
legitimate use is a file that no longer exists at that path. Regenerate first:
`seo_generate_sitemap({ project_id })` returns the content for `public/sitemap.xml`, which ships
through the code lane, deploys, and only then gets submitted.

### 2.7 seo_tracked_keyword_delete - the row history dies, the lanes pause

Contract as of the 2026-08-30 SEO wave: `seo_track_keyword` writes TWO rows, a
`tracked_keywords` row (what `seo_tracked_keywords_list` shows, with its own 30-check history)
and a `website_rankings` lane row the daily worker checks (what `seo_rankings_list` shows, with
`view: 'history'`). `seo_tracked_keyword_delete({ keyword_id })` removes the first and cascades
its `keyword_rank_history` - that part is still irreversible. The lanes no longer keep running:
when no sibling tracked row remains for the same keyword and domain, every lane is set to
`check_frequency 'paused'`, the daily worker skips paused lanes, and checking and billing stop
while the lanes and their rank history survive. Read the response: `data.lanes_paused` says how
many lanes stopped, and the `note` explains a `lanes_paused: 0` (sibling rows kept the lanes
running, or no lanes existed). Resuming takes TWO calls: `seo_track_keyword` re-creates
the config row but does not unpause the lane or queue a check (the lane still exists, so the
response says `ranking.already_tracked: true` and `first_check.queued: false`), then
`seo_tracked_keyword_update({ is_active: true })` writes `check_frequency` back onto every lane
for that keyword and domain, and that is the unpause.
`seo_rankings_platforms_set` does NOT unpause anything - it only adds or removes lanes, and
removing one still deletes that lane's history. The cheaper move is usually not to delete at all:
`seo_tracked_keyword_update({ is_active: false })` parks every lane at `check_frequency:
'paused'`, so checks and billing stop while the config row and its `keyword_rank_history` both
survive, and `{ is_active: true }` resumes them. Delete only when the client wants the keyword
gone from the universe, and price the lost history before you offer it.

```
CHANGE:   seo_tracked_keyword_delete, keyword_id <uuid> (seo_tracked_keywords_list, NOT ranking_id)
CURRENT:  "roof repair dallas", google, desktop, tracked since <date>, 9 lanes (seo_rankings_list)
PROPOSED: delete the tracked row; its lanes pause (read lanes_paused in the response)
IF WRONG: the tracked row's keyword_rank_history is gone; the lanes are paused, not lost
SCOPE:    one keyword; every website_rankings lane for it pauses unless a sibling row remains
UNDO:     none for the row history; re-track, then seo_tracked_keyword_update to unpause the lanes
```

On the add side the trap is the default: `tracking_frequency` defaults to daily on the tool and
sets the worker's `check_frequency` to daily. An organic check is about $0.003; an AI lane is
about $0.10 per keyword per engine per check, and the description warns about none of it. Twenty
keywords on three AI engines daily is roughly $180 a month. Pass `'weekly'` unless the client is
paying for daily, and treat every AI lane as a spend decision.

### 2.8 GBP fields: public immediately

All seven `seo_gbp_*` writes preview first and publish on the identical call with
`confirm: true`, straight onto the live listing. `seo_gbp_location_update` changes only the fields
in `updates`, but a name, address or category edit can trigger Google re-verification, which can
pull the listing from Maps for days. `seo_gbp_services_update` REPLACES the whole menu: an item
missing from `service_items` is removed and an empty array removes everything, so CURRENT is the
full list from `seo_gbp_services`. `seo_gbp_media_add` with category COVER, PROFILE or LOGO
replaces the primary imagery. `seo_gbp_review_reply` replaces any existing owner reply. IF WRONG
here is "customers see it now", and there is no listing history to restore from.

### 2.9 GA4 key events propagate into Ads

`seo_ga4_key_event_update` and `seo_ga4_key_event_delete` are live on return and flow into every
Google Ads conversion imported from the key event: a counting-method change shifts reported
volume, a delete flatlines the Ads conversion silently, and a bidding goal relearns for about a
week. Renaming a rule's destination with `seo_ga4_event_create_rule_update` leaves the old key
event receiving nothing. The read that earns any of these is `seo_ga4_key_events_list` plus
`seo_ga4_conversion_audit`; SCOPE names the Ads conversion actions downstream, and whoever owns
paid (`hiveku-ppc-agency/references/spend-change-discipline.md`) hears first.

### 2.10 seo_report_clear - the workspace is account-wide

One Sheet Canvas and Report Preview workspace per account. `deliverable_slug` is a legacy no-op
on every workspace call, so `seo_report_clear` wipes every report section the account has, every
month's; tabs survive. The tool's own description says none of this. Confirm that blast radius in
words, and prefer `seo_report_update_section` by exact title for a revision.

## 3. One template at a time, never bulk

A single wrong title is recoverable: you hold the old string and one call restores it. Fifty
retitled in a loop are not, because nobody read the fiftieth, and when clicks drop next month the
investigation has to reconstruct which of fifty simultaneous changes did it. Think in templates:
380 duplicate titles sharing a path prefix are ONE template change with 380 pages of blast
radius, reviewed once, shipped once, verified on three sample URLs.

- **Batch the analysis, never the consent.** Classify every finding in one pass, write the whole
  list into the PM task, present it. Then one approval per reviewed template change, and
  page-level edits applied one call at a time so every returned id lands in the log.
- **Two legitimate bulks.** `project_files_bulk_save` writes many files in ONE call because it is
  one atomic reviewed commit: validated upfront (one bad entry rejects the batch), versioned, and
  in tree-replace mode checkpointed before any mutation; follow it with one `project_vcs_commit`.
  And `seo_sheet_add_rows` batches appendix rows because they are evidence, not changes.
- **The implement rail is one task per dispatch.** `seo_task_implement` takes one `task_id`; a
  running session 409s; 1 to 3 dispatches per session so several unreviewed diffs never land at
  once. Never loop it over `seo_task_list`.
- **Never derive a deletion target by pattern.** A reviewed list of ids the user saw, or nothing.

## 4. What Hiveku already enforces

A rail in CODE refuses you; a warning in a DESCRIPTION does not. Only one saves you when you are
wrong.

### 4.1 Code-enforced guardrails

| Rail | Where | What it does |
|---|---|---|
| Redirect loop detection | `project_redirect_create`, `project_redirect_update` | Refuses self-loops, trailing-slash-only rules, duplicate sources, circular chains traced to depth 10. Write time only; chains allowed; nothing re-validates at deploy |
| Crawl size clamp | `seo_audit_start` | `max_crawl_pages` defaults to 50, clamped to 500 |
| Citations cooldown | `seo_citations_audit` | One search per run; a second inside 24h returns 429 with `retry_at` and the stored audit |
| Single-use approval tokens | `agent_approval_approve` | Already-handled 409, expired 410 |
| Memory versions | `memory_list_versions`, `memory_restore_version` | Every memory PUT or DELETE snapshots first; a clobbered SEO document is recoverable, forward-only |
| Coverage cap | `seo_gsc_index_coverage` | 50 URLs per call; report it as a sample |
| Batch validation + checkpoint | `project_files_bulk_save` | Whole batch validated before any write; tree-replace checkpoints first or aborts with `checkpoint_failed` |
| CMS validation gate | `cms_write_entry` | Live writes reject bad select values and dangling references with 422; drafts skip it |
| Deploy smoke check | `deploy_site` | Requests the live URLs after the build; fails the deploy on 403, 404 or 5xx |
| Container pinning | `seo_gtm_publish`, `seo_gtm_status` | The first container used on a connection is pinned; a different one 403s |
| Fetch safety | `fetch_url` | Refuses private hosts, 5 hops maximum, 200KB body cap |

**A third kind, between the two:** the plugin's permission-critical registry
(`data/permission-critical-tools.json`, mirrored in the INSTALL.md ask block) makes Claude Code
prompt the operator before these run, when the ask block is installed: `deploy_site`,
`project_files_bulk_save`, `project_vcs_commit`, `marketing_report_send`, `seo_task_implement`,
`seo_report_clear`, `seo_deliverable_delete`, `seo_connection_delete`, `seo_gsc_delete_sitemap`,
`seo_gtm_install`, `seo_gtm_publish`, `seo_ga4_key_event_delete`,
`seo_ga4_event_create_rule_delete` and all seven `seo_gbp_*` writes. It is a harness prompt, not
a server rail: it does not exist inside a workflow or another host, and `pages_update`,
`cms_write_entry`, `project_redirects_deploy`, `seo_tracked_keyword_delete`,
`seo_project_update`, `seo_track_keyword`, `seo_aeo_rankings_sync`, `seo_citations_audit` and
`agent_approval_approve` are not in it.

### 4.2 Verified two-step confirms

Each previews on the first call and executes only when the IDENTICAL call is repeated with
`confirm: true`. Verified against the tool description on 2026-08-30. Show the preview; never
auto-confirm by re-firing.

| Tool | The preview, and the strictness |
|---|---|
| `seo_gbp_location_update` | Fields and values changing, connection name, cached title |
| `seo_gbp_attributes_update` | Attribute names and count |
| `seo_gbp_services_update` | Live diff: current_count / new_count / added / removed / kept |
| `seo_gbp_media_add` | Category, source URL, format, whether primary imagery is replaced; validation runs at preview |
| `seo_gbp_media_delete` | The live item: category, format, thumbnail, create time, view count |
| `seo_gbp_review_reply` | Reply text and length, the review, the connection |
| `seo_gbp_review_reply_delete` | The existing reply and its review |
| `seo_task_implement` | Task, target project name and domain, page anchor. Strict boolean |
| `agent_approval_approve` | Staged action, summary, project id, expiry. Strict boolean |
| `seo_gtm_install` | The head and body write. Strict: `false`, `"true"`, `1` or omitted all preview |
| `seo_gtm_publish` | Container, the version's tags, what is live, pending changes NOT in this version |
| `seo_ga4_key_event_update` | Each field's current value, new value and consequence |
| `seo_ga4_key_event_delete` | Preview, no write. Strict boolean; the string `'true'` only previews |
| `seo_ga4_event_create_rule_update` | Current value, new value, consequence per field |
| `seo_ga4_event_create_rule_delete` | Preview, no write. Strict boolean |
| `marketing_report_send` | Report title, exact recipient list, public URL. Strict boolean |

The GBP descriptions do not state strictness; pass a boolean anyway. The GTM tag, trigger and
variable delete and revert tools also carry a confirm gate in their descriptions
(pattern-matched, not read line by line); they belong to `hiveku-conversion-tracking`.

### 4.3 Warnings that are prose only (they will NOT stop you)

| Tool | The documented danger, and where |
|---|---|
| `seo_report_clear` | Account-wide wipe; the description says only "(tabs are untouched)". Hub and reporting-and-delivery.md carry it |
| `seo_deliverable_delete` | Permanent, no undo tool; description "Delete a deliverable." Archive with `seo_deliverable_update({ status: 'archived' })` |
| `seo_tracked_keyword_delete` | 2.7; the lanes pause, but the row's `keyword_rank_history` dies with no undo |
| `seo_project_update` | `robots_txt_content` is deploy-time only, not live on save; takes the WEBSITE project id, a wrong id space targets nothing. No warning |
| `seo_gsc_delete_sitemap` | Destroys the reporting row; framed as a migration step |
| `seo_connection_delete` | Soft delete (`is_active=false`); downstream tools stop finding it; reactivation from this surface unverified, check `seo_connection_update`'s schema |
| `pages_update` | `is_published: false` 404s the page; `slug` changes the URL with no redirect. No warning |
| `cms_write_entry` | A live upsert; a wrong `slug` creates a new entry instead of failing |
| `project_redirects_deploy` | The live switch for every stored rule plus domain redirects; `tier` defaults to production |
| `deploy_site` | Production is the live site; "never pick it just to test"; no confirm |
| `seo_track_keyword` | AI lanes spend class G per check with no cost warning; daily default |
| `seo_aeo_rankings_sync`, `seo_citations_audit` | Cost stated, no confirm ("no confirm step" in the citations description) |
| `seo_gsc_submit_sitemap`, `seo_bing_submit_sitemap`, `seo_bing_submit_url` | Low risk, still client-visible; no confirm |

By contrast, the 2026-08-30 batch shipped its risky writes harness-gated (the tool itself asks
first): the tracking-project, competitor, keyword-cluster, topic-cluster, backlink-tracker,
backlink-opportunity, automated-report and page-schema deletes, plus `seo_rankings_platforms_set`,
`seo_listings_scan` and `seo_connection_test`.

### 4.4 The rails that do not exist

- **No confirm on any metered spend.** Classes B through I run on the first call. The DataForSEO
  balance can go NEGATIVE; every metered call then returns 402 with no per-tool warning, and 503
  `dataforseo_unconfigured` means no credentials. Neither means clean or empty.
- **No balance pre-check.** The 402 is the first signal.
- **No undo for a tracked-keyword delete** (2.7).
- **No live robots.txt write.** `seo_project_update` stores a deploy-time fallback; nothing
  serves until the next `deploy_site`, and only where the code ships no robots source.
- **No disavow, no directory submission, no hreflang builder, no GBP Q&A write, no GSC live
  URL test, no Rich Results Test.** Each is a hand-off, named as such.
- **`deploy_site` has no diff preview of its own.** The diff is your `project_vcs_commit` and its
  checkpoint; `deploy_get` reads status, not content.
- **No restore for a GBP edit, a deleted media item or a deleted reply.** Google keeps no
  version history you can reach.
- **No gate on `is_published: false` or a slug change.** A 404 wall is one `pages_update` away.

## 5. Verify after writing

A success response proves the route accepted the request. Between there and what a visitor or an
engine sees sit a template that may ignore the field, a deploy that has not run, an edge cache,
and an index that recrawls on its own schedule.

### 5.1 What confirms what

| Change class | Immediate check | Independent confirmation |
|---|---|---|
| Title, meta, H1 | `fetch_url({ url })`: read the tags out of `data.body` (`web_scrape` with `formats: ['html']` where the key has it) | `seo_gsc_inspect_url` only AFTER the recrawl (`lastCrawlTime` past the ship date), then `seo_gsc_search_analytics` with a page filter after the 3-day lag |
| Redirect | `project_redirects_list` shows the rule; after `project_redirects_deploy`, `fetch_url` on the OLD URL: `data.url` is the landing URL after up to 5 hops, `data.status` its code; `code: 'too_many_redirects'` with `visited[]` is itself a chain finding | `seo_research({ action: 'redirect-chains', target: <task_id> })` after a fresh `seo_audit_start` (live-tested 2026-08-30) |
| Canonical, noindex, robots | `fetch_url` on the URL and `/robots.txt`; `data.truncated` false | `seo_gsc_inspect_url` after recrawl for the selected canonical and indexing allowed; `seo_bing_inspect_url` as the faster second engine |
| Any code-lane change | `verify_typecheck`, `project_test_build({ project_id, use_db_state: true })` before deploy; `deploy_get({ project_id, deployment_id })` after | `fetch_url` on the production URL; `seo_audit_start({ project_id, target_url, max_crawl_pages: 50 })` plus `seo_research({ action: 'instant-page', url })` for one page now (class E) |
| Schema | `fetch_url` and parse the JSON-LD block yourself | `seo_gsc_inspect_url` rich-result detection after recrawl; `seo_schema_markup` after the next Sunday sweep |
| Sitemap | `seo_gsc_get_sitemap({ site_url, feedpath })`: `lastSubmitted`, `lastDownloaded`, `isPending`, `errors[]` | `seo_gsc_list_sitemaps`, `seo_bing_list_sitemaps` a day later for submitted vs indexed |
| GBP field | The `confirm: true` response | One fresh `seo_gbp_location({ connection_id })`; for services or media the matching `seo_gbp_services` or `seo_gbp_media` read, once |
| Tracked keyword | The returned `ranking.id` and `first_check.queued` | `seo_rankings_list({ view: 'history', ranking_id })` within minutes; `seo_tracked_keywords_list` for the row |
| Implement rail | `seo_task_implement_status({ task_id })` phase `completed` with `deployed_at` and `deployment_url` | `fetch_url` on the live URL for the exact element the task named |
| GA4 key event | The confirm response naming the consequence | `seo_ga4_key_events_list`; `seo_ga4_conversion_audit` once events arrive |
| GTM | `seo_gtm_status` live version | `seo_gtm_install_status` per tier, which reports SAVED state, never live |
| Anything from an MCP session | - | `audit_query`: tool, key preview, args summary, status |

### 5.2 The ordering rule

Live URL first, engine second, sweep third. `fetch_url` proves the site serves the change today.
`seo_gsc_inspect_url` the same day reads back the pre-change snapshot and reports a failure that is
not one; wait for `lastCrawlTime` to pass the ship date (3 to 14 days, faster after a sitemap
resubmit). Sweep-fed reads move on Sunday. CWV field data moves over 28 days and is never called
failed before day 28. Put the verification date and the exact verifying call in the PM task so the
next session does not read the lag as a regression.

### 5.3 Where verification is genuinely unavailable

- **A live URL test in Search Console** and **the Rich Results Test** are UI-only. Hand the URL to
  the user; your proxy is `fetch_url` plus a JSON parse of the block.
- **GBP re-verification state** after a name or address edit is visible only in the GBP dashboard.
- **Edge propagation.** `fetch_url` samples one CloudFront edge; say "verified from one edge".
- **Server-side directives on an externally hosted site.** `fetch_url` shows what is served;
  nothing here changes it. Findings become client tasks.

## 6. Never do these unprompted

Not "ask nicely first". Never on your own initiative, however strongly the data supports it.
Propose, diff, wait.

1. **Approve a staged deploy.** `agent_approval_approve` ships code to production. "Implement
   this" is not pre-approval; re-dispatching around a rejection is the same violation.
2. **Delete tracked keywords.** The row's history dies; the lanes pause, not vanish (2.7).
3. **Clear the report workspace.** Account-wide (2.10).
4. **Submit or delete a sitemap.** A dirty submission is a trust loss; a delete destroys history.
5. **Change robots, a canonical or noindex.** The quiet deindexer (2.3).
6. **Reply to a review.** Public, replaces the existing reply, one at a time, never looped.
7. **Publish GBP media or services.** Public on return; services is a whole-menu replace.
8. **Run a citations audit.** Spends a search and locks the connection for 24 hours.
9. **Sync AI lanes.** `seo_aeo_rankings_sync` and AI-engine `seo_track_keyword` rows are class G
   per keyword per engine, with no confirm.
10. **Run a full crawl.** Class F per page; 50 pages is a sample, 500 is a bill.
11. **Create GA4 key events.** A key event on a name GA4 never receives records nothing forever
    with no error, and everything downstream imports it.
12. **Deploy to production.** Development first; production on an explicit yes for that deploy.

## 7. The pre-flight card

Paste this into the PM task comment for each change, filled in, before the write. It is the audit
trail and the approval record in one artifact, and what the next session reads when the site looks
different.

```
DATE / SESSION:
ACCOUNT + IDS + ID SPACE:  <account>  website project <uuid> (sites_list) | seo project <uuid>
                           (seo_list_projects) | connection_id <uuid> | page_id | keyword_id
OBJECT:                    <type + id + human name, e.g. page "/services/roof-repair">
READ THAT JUSTIFIES IT:    <tool + window + the specific values>
FRESHNESS:                 <last seo_sync / crawl date / GSC lag / GBP snapshot age>
CHANGE:                    <tool + exact args>
CURRENT -> PROPOSED:       <value> -> <value>
IF WRONG:                  <pages, rankings, money, and time-to-notice>
SCOPE:                     <every page, template, lane, location affected>
RAILS IN PLAY:             <code guardrail? two-step confirm? harness ask? none - name which>
APPROVED BY / WHEN:        <who said yes to THIS change>
WRITE RESPONSE:            <returned ids: redirect id / ranking.id / deployment_id / checkpoint_hash>
VERIFIED BY:               <the read from 5.1, what it showed, and when>
UNDO HANDLE:               <tool + identifier, or "none - irreversible">
```

If any line is blank, the change is still a draft.
