# On-site publishing, versions, categories, and share links

Load this file before publishing content to a Hiveku site, taking a page down, refreshing a live
piece, importing existing CMS entries, minting a client share link, reading or answering client
feedback on a shared draft, or working with categories.

## The content -> CMS bridge (the canonical publish lane)

The `content_*` tools carry a first-class publish lane that every marketing profile can see.
It replaces hand-rolling `cms_write_entry` (which only the `dev` profile can call - see the
profile note in SKILL.md).

1. **Bind the item to its destination: `content_link_to_cms`.** Sets `website_project_id`,
   `cms_collection_id`, `cms_entry_slug` on the row - the binding `content_publish_to_site`
   needs; without it the item "has a body and no destination". `content_update` cannot reach
   these three columns. Pass `null` to unbind. Traps: `website_project_id` is a WEBSITE project
   UUID, not a PM project (a cross-account project is a 404, not a silent no-op).
   `cms_collection_id` is the collection SLUG string like `'blog'`, not a UUID. Binding to an
   entry another content item already owns is a 409 naming the fix. The three fields are
   independent - sending only `cms_entry_slug` re-points within the existing project/collection.
   Visibility flag: the project-id sources (`sites_list`, `project_get`) are NOT in the
   `marketing` profile - on a scoped key, ask the user for the project id or use a full key.
2. **Publish: `content_publish_to_site`.** The same canonical path the editor's Publish button
   uses. The route reads NO body - there is no confirm flag and no dry run, so calling it IS the
   commit; confirm with the human first. It forces the entry live and writes
   `<collection path>/<slug>.mdx|json` into the project's WORKING TREE as a new version -
   **NOT on the internet yet: the page goes live only after a separate deploy of the project.**
   Read back from the response: `slug`/`route` (slug collisions auto-suffix to `slug-2`..`slug-49`
   and REWRITE `cms_entry_slug`, so the live URL can differ from the slug you set) and `unmapped`
   (content fields with no home in the collection are silently dropped, with a 200). A brief-born
   item carrying `settings.target_keyword` auto-enrolls that keyword in rank tracking;
   `trackingStarted: false` only means skipped-or-already-tracked. The path takes NO advisory
   lock - a concurrent builder CMS write to the same slug is last-writer-wins (snapshot first,
   below). Errors: 400 no `website_project_id`/`cms_collection_id` (bind first), 404 unknown
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
  only way to reach a template it never shows - hold onto ids.
- `content_template_create`: `name` + `template_content` required (blank = 400); `content_type`
  outside article, blog_post, page, social_post, email, press_release, case_study, tutorial,
  faq, landing_page, custom is a generic 500, not a 400; `is_global`/`usage_count`/`created_by`
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
