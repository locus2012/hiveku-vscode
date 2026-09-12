# On-site publishing, versions, categories, and share links

Load this file before publishing content to a Hiveku site, taking a page down, refreshing a live
piece, importing existing CMS entries, minting a client share link, reading or answering client
feedback on a shared draft, or working with categories - before recording who a piece is for on
its row (the five grounding columns), and before the Play 3 quality gate (the pre-publish check
and the site's link targets) or resuming a department turn that timed out.

## Availability - the content program's round 2 tools (live since 2026-09-12)

Three hands landed with the content-engine round 2. Each builder route is live on `main` and the
MCP names below are in `lib/tool-index.json` (the CONTENT-1 batch in `test/pending-tools.mjs`
is retired). The elite content program's round B changed two of them - `content_site_links`
gained `content_id`, roles and suggested anchors, `content_seo_check` gained eleven rules - and
those contracts live in `references/site-architecture-and-decay.md` and
`references/structure-and-conversion.md`.

| Tool | Status | Route (Olympus auth, account-scoped) |
|---|---|---|
| `content_seo_check` | LIVE (builder 5387b132b, ebceb8cf9; MCP b0e0d4d) | `GET /api/olympus/marketing/content/:contentId/seo-check` |
| `content_site_links` | LIVE (builder 467fb70e2; MCP b0e0d4d) | `GET /api/olympus/marketing/content/site-links?project_id=` |
| `department_turn_get` | LIVE (builder 1b4b833e0; MCP a675885) | `GET /api/olympus/marketing/ai/turns/:turnId` |

A key whose server does not serve a name yet answers unknown-tool: say so, run the tool-free
form of the step (the checklist in SKILL.md Play 3 step 5; `content_list` + `cms_list_entries`
for URLs; the operator looks a turn up in the dashboard's AI turn log), and never present the
gap as "Hiveku cannot do this".

The five grounding params and the four list filters of the next section are not tools but
declarations on `content_create`, `content_update` and `content_list`: the builder routes read
them on `main` (295f68240; the dashboard routes 8f6d4c3ba) and the MCP declarations land with
the same round. The proxy forwards only DECLARED params, so on a key whose server predates them
the arg is dropped silently and the row comes back with `avatar_id: null` - the echo, not the
call, is the proof.

## The grounding on the row - `content_create` / `content_update` ({ avatar_id, journey_id, journey_stage, before_after_grid_id, target_keyword })

Who a piece is for lives on the row as five typed columns (schema d7b67cba9), the same columns
the marketing editor's "Who this is for" sidebar panel and the New Content modal write, the
workflow content node forwards, and the department's `data/content_items.json` carries with the
names behind the ids. One contract, every writer:

- `avatar_id`, `journey_id`, `before_after_grid_id` - UUIDs of a customer avatar
  (`customer_avatar_list`), a customer journey map (`customer_journey_list`) and a before/after
  grid (`before_after_grid_list`) IN THIS ACCOUNT, or null to clear. Each id is looked up with
  the key's account before anything is written: an id from another account, or a malformed one,
  is a 400 with `code: "invalid_reference"` naming the field, and NOTHING on that call is
  written - not the body, not the other ids. Re-read the list and send the real id; never strip
  the id to make the call pass.
- `journey_stage` - the stage NAME as the journey map spells it (free text, max 255; the
  `social_posts` convention), or null. It is not checked against the journey's stages, so copy it
  from `customer_journey_get`, never paraphrase it ("Awareness" is not "Problem Aware").
- `target_keyword` - max 255; null or "" clears. The `target_keyword` column is canonical and is
  mirrored into `settings.target_keyword` for the readers still moving over; a row written
  before 2026-09-12 carries the keyword only in `settings`, and every reader (`content_get`,
  `content_seo_check`, rank tracking at publish) falls back to it. When the param and a
  `settings.target_keyword` arrive on the same call the param wins.

What comes back, on every `content_list` row and every `content_get` / `content_create` /
`content_update` response: the five columns (every key present, null when unset;
`target_keyword` with the settings fallback applied) plus `customer_avatar`, `customer_journey`
and `before_after_grid` as `{ id, name }` or null - the names resolved inside the account. A
writer needs one read to say who a piece is for, and the report's header line
(`For: | Stage: | Grid: | Keyword: | Links:`) is read from `customer_avatar.name`,
`journey_stage`, `before_after_grid.name` and `target_keyword`, never re-typed from the brief.

Filters: `content_list({ avatar_id, journey_id, before_after_grid_id, journey_stage })` - the
three ids exact (a malformed id is a 400, not an empty page), `journey_stage` a case-insensitive
exact match on the stage name. "Content for avatar X at stage Y" is one call, and the avatar x
stage coverage matrix of Play 1 is one call per cell.

Two honesty rules. Read the echo: when the row that comes back lacks what was sent, the
grounding did not land - say so rather than reporting the piece as grounded. And
`settings.linkedAvatars` / `settings.targetJourneyStage` / `settings.linkedBeforeAfterGrids`
and `persona:` / `stage:` tags are NOT the contract: nothing reads them any more, so a piece
grounded only there is a piece grounded nowhere - move it onto the columns with one
`content_update`.

## Link targets - `content_site_links({ project_id, limit? })`

The list a writer picks internal-link anchors from: every published post and page on ONE
website project, each with its live absolute URL. `project_id` is the WEBSITE project UUID from
`sites_list` (400 `project_id_required` without it, 404 `project_not_found` outside the
account); `limit` defaults to and caps at 500.

Response: `{ data: [{ id, title, url, type: "post" | "page", published_at, slug, source }],
total, capped, project: { id, name, host }, posts: { listed, without_url }, pages: { listed },
notes: [] }`. `id` is the content item UUID for a post and `page:<route>` or `crawl:<url>` for
a page; `source` says where the row came from (`content_item`, the project's `page_list`, or a
`crawl` of a site Hiveku does not host - the Webflow and external cases); `published_at` is
null for pages. Every URL is DERIVED, never guessed: a published row whose route cannot be
resolved is counted in `posts.without_url` and explained in `notes` instead of being listed
with an invented path, and a project with no production host (never deployed, no domain)
answers an empty list and says why. An empty list means there is nothing to link yet; the
brief says so and the piece ships without internal links rather than with fabricated ones.
Hand the department 3-8 anchors (title + url) in the brief; the Play 3 gate then requires at
least two of them in the body by URL. Since the elite content program's build 8 the read takes
`content_id` (the item being written) and orders the rows for architecture - money pages first,
then the item's pillar, then the other pillars - with `role`, `suggested_anchor` and
`is_pillar_for_item` on every row; the money page and the pillar are the two links the gate
checks first. Contract in `references/site-architecture-and-decay.md`.

## The pre-publish check - `content_seo_check({ content_id })`

The mechanical half of the Play 3 quality gate, run on the STORED row (persist the draft
first). Deterministic and free - no network, no quota - so re-run it after every revision. The
row is read in the key's account; another account's id is a 404.

Response: `{ data: { content_id, checked_at, result, context } }` where
- `result.ok` is true only when there is no `error` - THIS is the gate; `result.score` (100
  minus 15 per error and 5 per warning) is information for the report;
- `result.checks[]` is errors first, then warnings, each `{ id, level: "error" | "warn",
  message, field }` - `field` is the `content_items` column (or settings key) to fix;
- `result.stats` is `{ word_count, h1_count, heading_count, image_count, images_missing_alt,
  internal_link_count, external_link_count, format }`;
- `context` is what the check was given: `target_keyword` (the `target_keyword` column, else
  `settings.target_keyword` for a row written before 2026-09-12), `banned_phrases` (the active brand guide's `ai_forbidden_phrases`), `site_host` (the linked
  project's production host, so absolute links back to it count as internal),
  `content_format`, and `linked` (bound to a project and collection; false means bind with
  `content_link_to_cms` before publishing).

What is an ERROR (must be fixed): an empty title; an exclamation mark in the title or meta
title; a missing meta title; a missing meta description; a placeholder slug
(`untitled-content`, `untitled`); an empty body; more than one H1 in the body (the title is
the H1); no `featured_image_alt` while `featured_image_url` is set; an inline image with no
alt; a banned phrase anywhere in the title, meta title, meta description or body. What is a
WARNING (state it and decide): a meta title over 60 or a meta description over 160
characters; no slug yet; under 300 words; no target keyword set (placement is then
unchecked); the keyword absent from the title, the slug, the H1 or the first 100 words; a
skipped heading level; fewer than two internal links; a sentence with a figure and no source
link in the same paragraph.

Eleven elite rules joined these on 2026-09-12 - `author_missing`, `answer_block_missing`,
`faq_schema_mismatch`, `title_generic`, `money_link_missing`, `pillar_link_missing`,
`keyword_already_targeted`, `comparison_table_missing`, `competitor_claim_unsourced`,
`cta_missing`, `cta_stage_mismatch` - with their levels, fields and fixes tabled in
`references/structure-and-conversion.md`; `field` gained `author_id`, `answer_block` and `faq`,
and `context` echoes the author, the money pages, the cluster, the offer and the CTA stage table
the check was given.

The fix loop: `content_update` the named field (`featured_image_alt`, `meta_description`,
`slug`, `content`, `meta_title`, ...), re-run, repeat until `ok`; the keyword itself is set
with `content_update({ target_keyword })`. Never publish while an error stands:
`content_publish_to_site` re-runs this check and hands the findings back as `warnings[]` for
the human's benefit, but it never blocks - the gate is the session, not the route. After the
deploy, `/hiveku:seo-onpage <url>` re-checks the live page.

## The content -> CMS bridge (the canonical publish lane)

The `content_*` tools carry a first-class publish lane that every marketing profile can see.
It replaces hand-rolling `cms_write_entry` - which the `marketing`, `marketing-seo` and `dev`
profiles can all call (see the profile note in SKILL.md), but which writes the entry without
touching the content row, so the row and the live entry drift apart.

1. **Bind the item to its destination: `content_link_to_cms`.** Sets `website_project_id`,
   `cms_collection_id`, `cms_entry_slug` on the row - the binding `content_publish_to_site`
   needs; without it the item "has a body and no destination". `content_update` reaches the same
   three columns since round 1, but only this tool refuses an entry another item already owns -
   bind here. Pass `null` to unbind. Traps: `website_project_id` is a WEBSITE project
   UUID, not a PM project (a cross-account project is a 404, not a silent no-op).
   `cms_collection_id` is the collection SLUG string like `'blog'`, not a UUID. Binding to an
   entry another content item already owns is a 409 naming the fix. The three fields are
   independent - sending only `cms_entry_slug` re-points within the existing project/collection.
   Visibility: the project-id sources (`sites_list`, `project_get`) ARE on the `marketing` and
   `marketing-seo` profiles (granted by name in the MCP server's profiles.ts, next to
   `deploy_site`) - read the project id yourself. Only a narrower sub-profile that lacks them
   (`marketing-email`, `marketing-ads`) has to ask the user for it.
2. **Publish: `content_publish_to_site`.** The same canonical path the editor's Publish button
   uses. The route reads NO body - there is no confirm flag and no dry run, so calling it IS the
   commit; confirm with the human first. It forces the entry live and writes
   `<collection path>/<slug>.mdx|json` into the project's WORKING TREE as a new version -
   **NOT on the internet yet: the page goes live only after a separate deploy of the project.**
   Read back from the response: `slug`/`route` (slug collisions auto-suffix to `slug-2`..`slug-49`
   and REWRITE `cms_entry_slug`, so the live URL can differ from the slug you set) and `unmapped`
   (content fields with no home in the collection are silently dropped, with a 200). A brief-born
   item carrying `target_keyword` (the column, else the settings mirror on a row older than
   2026-09-12) auto-enrolls that keyword in rank tracking;
   `trackingStarted: false` only means skipped-or-already-tracked. The path takes NO advisory
   lock - a concurrent builder CMS write to the same slug is last-writer-wins (snapshot first,
   below). The response also carries the pre-publish check: `warnings[]` (one line each,
   "Error (field): ..." / "Warning (field): ...") and `seo_check` (the same object
   `content_seo_check` returns); the route NEVER blocks on them and the note counts them.
   Relay every line to the user; an error line means the gate above was skipped - fix the
   field and publish again (same file, new version) rather than leaving the entry as it is.
   Errors: 400 no `website_project_id`/`cms_collection_id` (bind first), 404 unknown
   item/manifest/collection, 422 validation with the field named.
3. **Take-down: `content_unpublish_from_site`.** The unpublish direction of the same endpoint;
   it can only ever draft an entry, never publish one. **Do NOT reach for
   `content_update status='draft'` instead: the site's visibility contract reads the ENTRY FILE,
   never `content_items.status` - that flips the row and leaves the live page exactly where it
   was.** It deletes nothing; it rewrites the same entry file with the live signal flipped.
   **THE PAGE IS STILL UP when this returns 200** - nothing leaves the internet until the project
   is deployed; do not report a takedown off this response alone. The slug-collision suffix loop
   runs in this direction too (read `slug`/`filePath` back), the rank-tracking auto-enroll is not
   gated on direction, and `last_published_to_cms_at` is stamped even though nothing published.
4. **Import existing entries: `content_create_from_cms_entry`.** Materializes an existing
   project CMS entry into a `content_items` row plus a version-1 snapshot; returns
   `{id, created}`. THE TRAP: find-or-create, NOT a re-sync - a second call for the same target
   returns the first import's id with `created:false` and re-reads nothing, so CMS edits after
   the first import never reach the content item. Pull later changes with `cms_read_entry` +
   `content_update` instead (`cms_read_entry` is dev-profile - flag it on scoped keys). An entry
   with a missing/unrecognized status materializes as 'published'; `featured_image_url` is stored
   raw and site-relative; a slug race surfaces as a 500 - retry, do not treat as permanent.

## Resuming a department turn - `department_turn_get({ turn_id })`

`talk_to_department` waits about 110 s at the bridge while a department turn may run up to
1200 s, so a long draft times out at the client with the department still writing. The
timeout error STILL carries `turn_id` (from the first frame) and `session_id` (null on a fresh
conversation until the department mints it at the end of the turn), plus whatever `response`,
`tool_calls` and `data_updates` had arrived. Do not re-send the ask - a retry duplicates every
write the first turn is still making; resume with the turn id instead. The read is
account-scoped: another account's turn, or a non-UUID, is a 404.

Response: `{ turn_id, session_id, status, domain, user_message, started_at, finished_at,
last_event_at, stale, error_message, stop_reason, num_turns, response, tool_calls: [{ seq,
tool_call_id, name, input_summary, ok, result_preview }], data_updates: [{ seq, entity, action,
id }], since_seq, last_seq, event_count, events_available, events_truncated }`.
- `status` is `running | completed | errored | cancelled`. Call again while `running`;
  `stale: true` (no event for five minutes on a running turn) is a dead worker, not a slow
  one - report it, re-read the records `data_updates` names, and only then send the ask again.
- `response` is the folded assistant text of the whole turn (the draft, once `completed`);
  `tool_calls[].ok` is null while a call is still running and false when it failed - a false
  here means a confident paragraph in `response` may sit on a write that did not land.
- `session_id` becomes non-null once the turn finishes; a later
  `talk_to_department({ domain, session_id, message })` resumes that conversation with its
  transcript, which is how revisions go back to the same department session.
- Events are a 30-day replay buffer: a finished turn older than that answers with status and
  timestamps but `response: ""` and `events_available: false` - the transcript is the chat
  session, not this read. The route also takes `since_seq` (events after a sequence number,
  for a delta poll) and `events=1` (the raw `{ seq, event_type, event_data }` rows).

## Versions - the only undo for in-place refreshes

- **`content_version_create({ content_id })` BEFORE every in-place refresh of a live winner.**
  Send `content_id` alone to capture the item exactly as it stands - that is the intended use.
  It does NOT write `content_items` (passing edited values returns 201 while the live item is
  untouched, storing a state the item never had - use `content_update` to change the item).
  There is NO restore endpoint: anything captured can be read back with `content_versions_list`
  but can only be rolled back by a human in the editor - which is still infinitely better than
  no snapshot when a publish collides last-writer-wins.
- `content_versions_list` returns the FULL body of every version - a long article history is
  enormous; keep `limit` small (clamped 1..100, default 20). `created_by` is null on every
  version made through this API; only dashboard saves stamp an author - null is not corruption.
- `content_get` embeds only the latest 10 versions as metadata, plus categories, media, and
  linked tasks - the cheap single-item read-back.

## Scheduling truth - content_schedule is recorded intent, nothing more

`content_schedule` (POST) and `content_schedule_list` (GET) operate on
`content_publishing_schedule` - and per the tools' own registered contract, **NOTHING EXECUTES
THESE ROWS**. No cron or worker reads that table; the scheduler that actually runs is a different
table (`cms_scheduled_actions`, driven by the cms-scheduled-publish cron) which these tools
cannot see. A row still 'pending' long past its `scheduled_at` has not failed - it was never
picked up, and `executed_at` stays null forever. Use `content_schedule` rows as the recorded
editorial calendar; report them as intent, NEVER as "it will publish". The publish itself is a
session action: `content_publish_to_site` + deploy at the planned time.

## Categories

- `content_categories_list`: `parent_id` takes the LITERAL string `'none'` for top-level only;
  `is_active` must be exactly `'true'`/`'false'` (anything else is silently ignored and inactive
  rows come back mixed in); limit caps at 100; counts are direct membership only - children are
  not rolled up.
- `content_category_create`: `slug` is NOT an input - the route derives it from `name` and
  de-duplicates with a suffix, so read the returned row to learn the real slug. `parent_id` is
  neither existence- nor account-checked: a cross-account UUID is accepted and the category then
  never renders in the dashboard tree. Racing duplicate names can 500 - re-list before retrying.

## Content templates

- `marketing_content_templates` (the listing) has no paging; `content_template_get` by id is the
  only way to reach a template it never shows - hold onto ids. The three bottom-funnel templates
  (`default_settings.template_slug` brand-vs-rival, rival-alternatives,
  best-category-for-segment) appear as account rows after the first `content_bofu_plan`
  (`references/site-architecture-and-decay.md`).
- `content_template_create`: `name` + `template_content` required (blank = 400); `content_type`
  outside article, blog_post, page, social_post, email, press_release, case_study, tutorial,
  faq, landing_page, comparison, alternatives, research, custom is a generic 500, not a 400; `is_global`/`usage_count`/`created_by`
  you send are silently dropped. Nothing applies a template for you - `content_create` takes no
  template_id and `usage_count` never moves.
- `content_template_update`: global templates are READ-ONLY - a PATCH returns 404,
  indistinguishable from a missing id, so `content_template_get` first and check `is_global`.
  `template_fields` and `default_settings` are REPLACED wholesale, never merged - send the
  complete object. `is_active: false` is the nearest thing to archiving.

## Client share links (the sign-off artifact)

`content_share_link_create` mints a PUBLIC, no-login URL for one content item - the artifact to
send a client for draft review before scheduling. The token IS the authorization: anyone holding
or forwarding it reads the FULL body with no account and no audit trail, so never mint one on a
draft that is not meant to leave the building, and tell the user what the link exposes.
Traps: IDEMPOTENT BY DEFAULT - if any non-revoked, non-expired link exists it returns with
`reused:true`, nothing is created, and your `label`/`allow_comments`/`expiry_days` are SILENTLY
IGNORED; call `content_share_links_list` first. `rotate:true` mints a fresh token but the
previous token STAYS LIVE until you revoke it. `content_share_link_revoke` kills one link by its
SHARE-LINK id (not the content id); a 404 means nothing was revoked - re-read the listing.
Expired links are still listed (the filter is revoked-only) - check `expires_at` yourself before
telling anyone a link works.

## The review thread (feedback comes back through the share link)

A reviewer holding the share link can leave comments; they land on the item's review thread and
close the loop the sign-off artifact opens.

- **`content_comments_recent`** - the cross-item digest read ("what feedback landed since I
  last looked"): every comment across ALL of the account's marketing content items, newest
  first, each row carrying its joined `content_item` (id, title, content_type) so a digest can
  say WHICH draft got the comment. `since` filters `created_at` with a STRICT greater-than -
  passing the created_at of the last comment you processed will not return it again (the
  resume cursor); an unparseable `since` is a 400, never silently ignored. `source` is derived
  ONLY from `share_link_id`: `'share-link'` = a public share-link reviewer (the client-feedback
  path), `'in-app'` = a team member OR an API-key agent - `user_name` is the only signal which.
  `user_email` is OMITTED from the object entirely when absent (not null) - read it
  defensively. An unknown or other-tenant `content_item_id` filter matches zero rows and
  answers 200 with an empty array, NOT a 404. `content_comments_list` is the one-item thread
  read, oldest first.
- **`content_comment_create`** appends one comment to an item's thread. The byline is the fixed
  literal 'Olympus Agent' and cannot be supplied (a caller-chosen byline on a client-visible
  thread is an impersonation primitive); comment_text is trimmed, required, max 4000 chars;
  every row is created 'open', and there is NO edit, resolve, or delete verb - a comment cannot
  be corrected or withdrawn, so draft it like the client copy it is.
- **Notification truth: commenting itself notifies NOBODY.** After the row is written, a
  `content.comment_created` workflow trigger fires fire-and-forget
  (`contentCommentCreatedTrigger` nodes, filterable by source) - an account with an enabled
  workflow on that trigger is notified however that workflow says, and an account WITHOUT one
  is notified of nothing: the comment sits until a human next opens the Collaboration panel on
  that item. Never report that a comment alerted anyone unless such a workflow is known to
  exist - and offer `/hiveku:automate` to wire one, so client feedback stops being a silent
  letterbox.
- **THE THREAD IS CLIENT-VISIBLE.** Every row renders to anyone holding a live share link on
  the item - nothing here is an internal note. Internal production notes go to PM tasks or
  memory, never into the thread.
