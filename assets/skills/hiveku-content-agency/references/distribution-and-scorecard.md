# Distribution and the scorecard

Load this file before the brief of any piece (the distribution plan is written at brief time),
before a publish (the no-plan warning), before wiring the publish-event automations (the repurpose
and weekly-digest templates), and before any per-piece performance read or the next brief (leads,
not views). Research, proof and case studies are in `references/research-and-proof.md`.

## Availability - what changed on 2026-09-12

| Tool | Status | Route (Olympus auth, account-scoped) |
|---|---|---|
| `marketing_campaign_roi` | LIVE (builder e47ab5f70) | `GET /api/olympus/marketing/reports/campaign-roi` |
| `content_analytics_get` | LIVE, changed (builder 5d58d7d8b) | `GET /api/olympus/marketing/content/:contentId/analytics` |
| `content_page_views_get` | LIVE, changed (builder 5d58d7d8b) | `POST /api/olympus/marketing/content/views` |
| `social_repurpose_source` | LIVE, changed (builder c8e8e48dc, 913138c57) | `GET /api/olympus/social/repurpose/source` |
| `content_list` | LIVE, changed (builder a43033c3c) | `GET /api/olympus/marketing/content` |

The three changed reads answer the new shape on every key today; their MCP descriptions, the
`window` knob on `content_analytics_get` and the `published_since` / `sort` params on
`content_list` catch up with the same MCP deploy that delivers `marketing_campaign_roi`. The proxy
forwards only DECLARED params: on a key whose server predates the deploy an undeclared param is
dropped silently and the route answers its default (the 30-day window; the list sorted by
`updated_at`), so read the response for the window it reports rather than the one you asked for.

## The plan on the row - `settings.distribution_plan`

Distribution is part of the asset: a piece is briefed with its channels, not handed to social after
the fact. The plan lives on the item and both settings writers (`content_create`, `content_update`,
the dashboard) merge top-level keys, so writing `settings: { distribution_plan: <plan> }` keeps every
sibling key. The plan itself is replaced whole: `content_get` first, edit, write the whole plan.

```json
{ "owned_first": true,
  "channels": [
    { "channel": "email_digest", "format": "digest feature", "status": "planned" },
    { "channel": "social", "format": "thread and three posts over four weeks", "status": "planned" },
    { "channel": "community", "format": "answer where the question is asked, linking the piece", "status": "planned" },
    { "channel": "outreach", "format": "cited sources and people named in the piece", "status": "planned" },
    { "channel": "paid", "format": "retargeting amplification", "status": "planned", "note": "Winner only: nothing is amplified until the scorecard says the piece earned it" }
  ],
  "written_at": "2026-09-12T10:00:00.000Z" }
```

- `channel` is one of `email_digest`, `social`, `community`, `partner`, `outreach`, `paid`;
  `status` one of `planned`, `drafted`, `scheduled`, `done`, `skipped`; `format` a non-empty
  string; optional `scheduled_for` (ISO), `link` (the derivative: `social_post:<uuid>`,
  `campaign:<uuid>`, `task:<uuid>` or a URL) and `note`; at most 12 rows; `owned_first` is always
  true and `written_at` an ISO instant. A plan that breaks any of those reads as NO plan
  everywhere (the panel, the department's header, the publish warning) - it fails closed, so
  validate before writing and read the echo back.
- **Owned email first.** The `email_digest` row is the first channel: the owned list is the one
  surface no platform throttles. `paid` stays winner-only until the scorecard says otherwise
  (leads, not views - below). Edit the default to the brief: a retention piece skips `paid`; a
  piece with no community where the question is asked marks that row `skipped` with the reason
  in `note`, never deleted.
- **Written at brief time**, in the same `content_create` / `content_update` call that records the
  grounding (Play 2 step 6, Play 3 step 1). A row whose plan is missing at publish is the finding
  "no distribution plan: the piece will get one post and stop", said to the user before the publish
  is treated as done - never a block.
- **Marked as the derivatives land:** after `social_posts_bulk_create` persists the set, the
  `social` row becomes `drafted` with `link: "social_post:<id of the first post>"`; after the digest
  campaign exists, `email_digest` becomes `drafted` with `link: "campaign:<id>"`, `scheduled` when
  the send is scheduled, `done` when it went out. The dashboard's Distribution panel renders the
  same rows and lets the customer edit them.
- The department's grounding header carries a `Channels:` line read from the same key
  (`Channels: none planned` when absent); an agent that plans a piece writes the plan in the same
  call as the row.

## The publish event and the two templates

`content.published` fires ONCE per native publish of a content item - the editor's Publish,
`content_publish_to_site`, and the scheduled-publish cron - at the entry write, with `visibility`
`live` | `deploy_required` | `publish_required` in the payload. It does not fire again from the
deploy, and a status flip to `published` on a row with no site binding fires nothing (no page,
nothing to distribute). `workflow_event_trigger_types_list` carries the entry (node type
`contentPublishedTrigger`, domain content) with a `sample_output`; the payload keys are
`content_id, account_id, title, slug, url, excerpt, featured_image_url, content_type, avatar_id,
journey_stage, target_keyword, project_id, provider, published_at, visibility, is_first_publish,
publish_key, timestamp`; node filters (fail closed) `project_id`, `content_types` (array or comma
string), `first_publish_only`. A workflow that must act only on a live page filters on
`visibility: "live"`.

Two templates use it, listed by `workflow_templates_list` and installed with
`workflow_create_from_template({ slug, overrides, is_enabled: false })` - staged, because the
create goes live the moment it returns otherwise - then `workflow_test`, then `workflow_enable` on
the operator's yes:

- `content-published-repurpose` (variables `PLATFORMS`, `RECIPIENT_EMAIL`, `PROJECT_ID`): first
  publish only; the social agent reads `social_repurpose_source` and writes three posts; three
  `socialCreatePost` DRAFT slots carrying `linked_content_id`, `link_url` and `first_comment`; an
  email to `RECIPIENT_EMAIL` that drafts are waiting. Nothing publishes from it: the drafts go
  through the social approval queue.
- `content-digest-weekly` (variables `AUDIENCE_ID`, `FROM_EMAIL`, `APPROVER_EMAIL`, `DIGEST_NAME`,
  `TIMEZONE`): Tuesday 9 AM in `TIMEZONE`; a `marketingListContent` node (`status: published`,
  `published_within_days: 7`, `sort: published`) inside the run (over MCP the same read is
  `content_list({ status: "published", published_since: "<7 days ago, ISO>", sort: "published" })`;
  the route takes an instant, not a day count); on an empty week it emails
  "nothing published" and creates no campaign; otherwise the email agent writes the digest and
  calls `email_newsletter_create` as a DRAFT, `APPROVER_EMAIL` approves, then the send. The
  campaign is the `email_digest` derivative: mark the plan row with `campaign:<id>`.

**The links.** `social_repurpose_source` now returns `utm_links` per platform as
`utm_source=<platform>&utm_medium=content&utm_campaign=<slug>&utm_content=<slug>` plus top-level
`utm_medium` ("content") and `utm_content`; the digest links are
`utm_source=newsletter&utm_medium=content&utm_campaign=content-digest&utm_content=<slug>`. The
content attribution resolver credits a piece from `utm_medium` in `content` | `blog` | `organic`
plus `utm_content` equal to the item's slug; a hand-written link in the old shape
(`utm_medium=social`, no `utm_content`) credits nothing. Use the returned links unchanged; never
compose `utm_content` from a page URL - the resolver keys on the row's `slug`, and the page can
serve at `slug-2` after a collision.

## The scorecard - leads per piece

Since 2026-09-12 a nightly writer (`/api/cron/content-scorecard`) stores one row per published
piece per closed UTC day and every reader answers from the same module, so the content list's
Leads column, the editor's Performance panel and the department cannot disagree.

- **`content_analytics_get({ content_id })`** returns `scorecard` computed now for `window`
  (`7d` | `30d` | `90d` | `all`, default `30d`): `views`, `visitors`, `form_submits` (ClickHouse;
  `null` when the piece has no site page or ClickHouse was unreachable - read
  `degraded.clickhouse`), `leads` and `contacts` (forms-ledger rows on the page and the CRM contacts
  they resolved to; spam, duplicates and deleted rows excluded), `attributed_contacts` (the
  attribution engine's credits to the piece), `deals { created, won, pipeline_value_cents,
  won_value_cents }` or `null` when no contact rolled up, `rank { best_position, keywords[] }`,
  `social { posts, published, engagement, impressions, likes, comments, shares, clicks }` (posts
  with `linked_content_id`), `lead_rate` (leads / views, `null` when views is null or zero),
  `window`, `computed_at`; plus `data` (the stored daily rows, newest first, `external_analytics`
  carrying that night's rolling 30-day scorecard) and `last_stored` (`null` before the first
  nightly run - "not yet computed", not zero). The sentence "nothing writes content_analytics" was
  true until 2026-09-12 and is not any more; a session that still refuses the read is reporting
  a collector that exists as absent.
- **`content_page_views_get({ items: [{ projectId, path }] })`** (up to 200 pairs) now answers per
  key `views, views30d, visitors, form_submits, form_submits30d, leads, leads30d, contacts`.
  `form_submits` is what the embed saw in the browser; `leads` is what reached the forms ledger -
  read `leads` for "how many people this page converted", `form_submits` beside `views` for
  on-page behaviour. Every earlier trap holds: `{ stats: {}, degraded: true }` at HTTP 200 is an
  outage, an absent key is "no rows" and never zero, paths are case sensitive and normalised.
- **`marketing_campaign_roi({ from?, to?, attribution?, confidence?, asset_types? })`** is the
  revenue view: `{ window, attribution, confidence, asset_types, truncated, spend_data_through,
  assets: [{ asset_type, asset_id, name, status, platform, spend_cents, sends, impressions, clicks,
  contacts, deals_created, deals_won, pipeline_value_cents, won_value_cents,
  payments_applied_cents, shopify_revenue_cents, revenue_cents, roas }], summary { mode,
  spend_cents, contacts, deals_created, deals_won, ..., revenue_cents, roas }, mixed_currency }`.
  `asset_types: "content_item"` restricts to pieces (`email_campaign` shows the digest);
  `attribution` `first` | `last` (default) | `any` (participation: per-asset rows overlap and the
  summary is computed once); `confidence: "solid"` keeps exact-id and alias credits only. Money is
  integer cents in each source's own currency; `mixed_currency: true` means the sums span more
  than one, so report them per currency. `truncated: true` means more than 200 assets were cut.

**The rule: the next brief comes from leads per piece, not views.** Rank pieces by `leads`,
`contacts` and `deals.won` (the scorecard) and by `revenue_cents` (the ROI report). A piece with
views and no leads has a hook or CTA problem - refresh it in place (Play 5 step 6); a piece with
leads and few views has a distribution gap - flip its `paid` row from winner-only to planned and
run the social set; a topic whose pieces convert earns the next cluster. Before any of that, rule
out the instruments: `degraded.clickhouse`, `views: null` (no page), `last_stored: null` (the
first nightly run has not happened), a form with no ledger rows because the page has no form. A
zero with a live collector is a finding; a zero with a dead one is unknown, and the report says
which.
