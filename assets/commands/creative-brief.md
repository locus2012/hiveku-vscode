---
description: "\"Get the designer to make the graphic for this post\" - hand a creative task to the designer: the brief shape, the PM-task carrier with the CREATIVE: naming convention, and the pickup from the media library when it lands."
argument-hint: "[post id or a one-line description of the asset]"
---
Creative brief ($ARGUMENTS). Follow the **hiveku-social-agency** skill (Play 11): load its
`references/creative-handoff.md` first and run it as written, with
`references/audience-grounding.md` for the header the brief carries,
`references/hooks-and-formats.md` for the formats that need a designed card (`quote-card`,
`data-point`, a carousel with copy on the slides, a `before-after` composite, a reel cover) and
the alt text rules, and `references/anti-fluff.md` for every word that will render on the canvas.
Context: `account_context_get({ domain: "social" })` - keep `brand` (the active guide row) and
the persona summaries. The rule: `talk_to_department` has fifteen domains and none of them is
`creative` (`website_design` is the Graphic Design persona for a live opinion, `branding` the
visual system; neither is a render), the deliverable is a Media Library row with an id, and the
PM task is not done until that row is attached to the post. This command renders nothing. The
lanes that render are `/hiveku:design` and `/hiveku:media` on a full-profile or
`marketing-design` key; on the social key the design surface is read-and-publish only.
1. Read the source, then the foundation, then the library. A post id: `social_get_post({
   post_id })` for `content` (the first line is the `hook_line`), `title`, `tags` (`persona:`,
   `stage:`, `hook:`, `format:`), `avatar_id`, `before_after_grid_id`, the pillar, the target
   platforms, the `media_asset_ids` already on the row, and the status - a post at `publishing`
   or `published` is edit-locked, so its asset will land on a `social_post_duplicate` copy in
   step 5. A one-line description: the brief stands in for the post, and it still needs a
   persona and a stage - `customer_avatar_list`, pick one with the user, never invent one.
   Persona: `customer_avatar_get({ id })` for the full row - the name, `pain_points`,
   `typical_quote`, the one objection in `buying_behavior`, and
   `online_behavior.social_platforms` (a platform the persona does not use gets no card aimed
   at them there). Brand: `brand_guide_get({ id })` on the active guide (the id from the context
   call's `brand`, or `brand_guide_list({ is_active: "true" })`) - `color_primary`,
   `color_secondary`, `color_accent`, `font_heading_family`, `font_body_family`, `copy_dos`,
   `copy_donts`, `brand_is`, `brand_is_not`, `ai_forbidden_phrases`. Quote them into the brief
   by field; an empty palette or type slot is a finding for the designer (the templates
   substitute from the guide), never a value you fill in. Library first: `media_library_list({
   search })` (title and filename only, not alt text), `media_library_list({ tags:
   "creative-studio", limit: 20 })` for designed assets newest first, `media_folders_list` for
   where the account files designed work, then `media_library_get({ asset_id })` on any
   candidate for `file_url`, `width`, `height`, `alt_text`, `tags`, `usage_count`. An existing
   asset that fits the header and the platform size beats a new one: take it straight to step
   5. A visual with no words on the canvas (a photo) is not a brief; it is the DIY generate lane
   in `/hiveku:social-post` step 4. Write the header now, exactly: `For: <avatar> | Stage:
   <Schwartz stage> | Pillar: <pillar> | Hook: <pattern> | Format: <format> | CTA: <verb>`, from
   the post's tags and foundation fields (or filled with the user for a description-only ask).
   A header you cannot fill stops the brief: a designer who does not know the persona and the
   stage designs for the brand, and the card reads like an ad.
2. Write the brief, one per asset, in exactly this shape: `{ title, brief, job, key_message,
   channel, cta, format, owner: "creative", platform, size, persona, stage, hook_line,
   copy_on_image, media_role, deliver_to: "media_library", tag: "social:<slug>" }`. `brief` is
   creative direction in prose - what is on the canvas, what is not, the mood in two words; "a
   nice quote graphic" is a failed brief. `copy_on_image` is every word that renders, verbatim
   and final, checked against the banned list and `ai_forbidden_phrases` before it is written
   down: text is a canvas layer, never generated pixels, the designer types exactly this, and
   exactly this goes into the alt text in step 5. `media_role` is one of `hero` (one image on
   one post), `carousel` (N sibling slides, order named in `brief`), `quote-card`, `reel-cover`.
   `size` per platform, naming the `design_templates_list` preset when one exists (the presets
   come back already substituted with the active guide): Instagram feed 1080x1080
   (`instagram_post`) or 1080x1350 portrait (not a preset - write the dimensions and say so),
   Stories and the reel cover 1080x1920 (`instagram_story`), Facebook 1200x630
   (`facebook_post`), LinkedIn feed 1200x1200 (`linkedin_post`), X 1600x900 (`twitter_post`);
   a LinkedIn page banner is 1584x396 and a template, never a post asset. `persona` and `stage`
   carry the header values with the avatar id, so the designer opens the same
   `customer_avatar_get` row you did. A grid item goes in `brief` by grid id and item title;
   its real photos are the only before and after that may appear, never a generated before.
   `channel` and `platform` are the six publisher slugs (`linkedin`, `twitter`, `facebook`,
   `instagram`, `tiktok`, `google_business_profile`). `tag` is unique per brief and goes in the
   PM title too; it is how the asset is found again. One post that needs two sizes is two
   briefs. Show the header and the brief before anything is filed.
3. Optional, read-only, before filing: dispatch the `hiveku-creative-analyst` sub-agent with
   the brief for the questions a brief should not guess at - which library assets already fit
   (it pages `media_library_list`), whether the active guide is complete enough to substitute
   into a template, whether an earlier design for the same slug is stalled on unresolved client
   comments (`design_comments_list`, filtering `isResolved` itself). It renders, registers,
   files and deletes nothing; you file. For a live design opinion (which of two directions
   fits, whether a card is legible at feed size, what slide 1 should carry)
   `talk_to_department({ domain: "website_design", message })` runs the Graphic Design persona
   over its own hydrated workspace; `branding` answers for palette and type. Never a `creative`,
   `design` or `media` domain - the call is a schema rejection before any agent runs. Neither
   call is delivery: a chat turn may leave nothing behind, and a claim that a card "was made"
   without a library id is a claim, not an asset. Rendering happens in `/hiveku:design` (an
   editable, layered design) or `/hiveku:media` (images, designs, video) on a full-profile or
   `marketing-design` key; from the social key the surface is `design_list`, `design_get`,
   `design_state_get`, `design_templates_list` and `design_publish_to_library`, no canvas write.
4. STOP - show the header, the fenced brief, the task title and the exact create call, and get
   a yes: the board is read by the client's team and the Graphic Design persona hydrates from
   it. Then `pm_projects_list` (no name filter, and `project_type` is dropped by the proxy, so
   filter the returned `name`, `description` and `project_type` yourself) and file into the
   project the account's marketing tasks already live in; `pm_projects_create({ name,
   project_type: "marketing" })` only when none exists. `pm_tasks_create({ project_id, title:
   "CREATIVE: <platform> <format> - <post title>", description: <the brief as a fenced json
   block, plus the post id when one exists>, task_type: "design", priority: "high", due_date })`
   - the field is `title`, not `name`, and `priority` defaults to medium if you omit it. The
   `CREATIVE:` prefix is a convention, not a code path: it is what a human recognises on the
   board and what a later session filters `pm_tasks_list({ project_id })` by (no title filter
   there either; match the prefix yourself). Then `pm_tasks_comment({ id, content })` with the
   post id and the header line, so the designer reads the same post and the same avatar row.
   The post stays a text-only draft; the task stays open. Record slug, task id and post id in
   the deliverable, because step 5 may run in another session.
5. Pickup, when the designer is done: `pm_tasks_get({ id })` for status and the designer's
   comments. The asset arrives through one of two doors, both ending in a `media_assets` row.
   (a) `design_list` (most-recently-edited first, with `featuredImageUrl` and tags; no tag
   filter, match the title or the slug yourself), then `design_get({ id })` or
   `design_state_get({ id, page_id })` to read the work (a multi-page carousel describes page
   one unless `page_id` is passed). When the designer left it unpublished: STOP - one paid
   render, one permanent S3 object, one row, nothing dedupes - then, once,
   `design_publish_to_library({ id, set_as_featured: true, title })` with `set_as_featured` a
   JSON boolean and `title` carrying the `social:<slug>` marker (the route takes `page_id`,
   `title` and `set_as_featured` only, no tags); read `mediaAssetId`, `fileUrl`, `width`,
   `height`. A 504 after 90s carries no job handle while the render may still land: never retry
   or loop it - check the library first. (b) `media_library_list({ tags: "creative-studio",
   limit: 20 })` newest first; match the `social:<slug>` tag or the title. An export is not a
   pickup: `design_export_image` returns a URL and no library id, so a URL you are handed is
   `media_library_register_external_url({ file_url, title, tags, alt_text, width, height })`
   first, then attach by the returned id, never pasted into `media_urls`. Then, in order:
   `media_library_get({ asset_id })` and check `width` and `height` against the brief's `size`;
   `social_post_validate({ content, target_platforms, target_accounts, media_asset_ids })` for
   the media fit per platform (Instagram requires media; GBP exactly one photo and no video; X
   four images or one video, never mixed; LinkedIn one media category; TikTok ignores images) -
   it writes nothing, and its `errors` are the work list; STOP - the client sees drafts in the
   dashboard - then attach: `social_update_post({ post_id, media_asset_ids, media_alt_texts })`
   (the ids REPLACE the post's media list, so send the full list in carousel order; a
   `publishing` or `published` post is a 400, so `social_post_duplicate({ post_id })` first and
   attach to the copy), or `social_create_post({ content, title, target_platforms,
   target_accounts, media_asset_ids, media_alt_texts, tags, pillar_id, avatar_id })` as a DRAFT
   with no `scheduled_at` when the post did not exist yet. `media_alt_texts` is one entry per
   item in order, 125 characters or fewer, `copy_on_image` inside it verbatim, stored for the
   dashboard (no publisher sends it to a platform today). Then `media_update({ asset_id,
   alt_text, tags })` with the asset's existing tags plus `social:<slug>` - `tags` REPLACES the
   array, and the slug alone wipes `creative-studio`. `social_post_preview({ post_id })` shows
   the media composition per platform; fix a wrong count now. A revision is `pm_tasks_comment`
   naming what changes and the rubric axis the card fails; a re-published design is a second
   library row, picked up the same way. Close the loop: `pm_tasks_comment({ id, content })`
   with the asset id and the post id, then `pm_tasks_complete({ id, summary })` - done means
   attached, never brief time or chat time. Deliverable: the header, the slug, the task id, the
   asset id with its dimensions, the post id, and what remains (the schedule is
   `/hiveku:social-plan` step 4, one post, one confirm).
6. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
