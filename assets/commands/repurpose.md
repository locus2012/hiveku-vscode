---
description: "\"Turn this blog into posts\" / \"we published a case study, get it out on social\" - one piece of content into a staggered set of per-platform drafts with the link, the first comment, provenance and the hero crops briefed."
argument-hint: "[a URL, a content id, or 'latest']"
---
Repurpose ($ARGUMENTS). Follow the **hiveku-social-agency** skill; load its `references/repurpose.md`
and run it as written, with `references/audience-grounding.md` for who each post is for,
`references/hooks-and-formats.md` for the hook and format slugs, `references/anti-fluff.md` for the
gate and `references/creative-handoff.md` for the designed cards. Context: `account_context_get({
domain: "social", include: "grids,social" })` - the pillars, the accounts with `token_state`, the
scheduling `timezone`, the persona summaries and the active grids in one read. The rule: a post is
repurposed from a piece that is LIVE at an absolute URL the production tier serves, every post records
the piece it came from, the set is persisted as DRAFTS, and no publish time is picked here.
1. **Source it, through the door the key allows.** A content id or a URL goes to
   `social_repurpose_source({ content_id })` or `social_repurpose_source({ project_id, collection_id,
   slug })` (`collection_id` is the collection slug, `blog`, not a UUID; turn a URL into that shape by
   matching its path against `cms_list_entries` `resolvedPath`). It returns the source package:
   `title`, `excerpt`, `headers` in order, `candidate_specifics` (the numbers, names, dates and quoted
   lines in the body - the specific inside every hook), `hero { media_asset_id, file_url, registered }`
   (a hero that existed only as a URL is registered into the Media Library on this read and
   `registered: true` says so - the one side effect), `live_url` or `{ url: null, reason:
   "not_deployed" }`, `utm_links` per platform (`utm_medium=social`, the value the analytics
   classifier maps to Organic Social) and the `linked_content_id` every row will carry. 'latest' or
   "pick one for me": `content_list({ status: "published", content_type: "blog_post", limit: 50 })` -
   rows carry `website_project_id`, `cms_collection_id`, `cms_entry_slug` and
   `last_published_to_cms_at`, and a published row with `website_project_id` null is published nowhere
   the site serves - then `content_get({ content_id })` for the body, `featured_image_url` and
   `settings.published_route`. An empty library on a site whose blog lives in the CMS means the site
   ladder, on the social key: `sites_list` -> `cms_list_collections({ project_id })` ->
   `cms_list_entries({ project_id, collection_id, status: "published" })` (read `derivedStatus` and
   `resolvedPath`) -> `cms_read_entry({ project_id, collection_id, slug })`. Rank candidates with ONE
   `content_page_views_get({ items: [{ projectId, path }] })` (up to 200 pairs, `path` site-absolute;
   `stats` is keyed `<projectId>:<normalizedPath>`, so match on the returned key): `views30d` for
   momentum, `views` for the evergreen set, persona fit above both. Branch on `degraded`: `{ stats: {},
   degraded: true }` is an outage at HTTP 200, so rank by `published_at` and persona fit, say the
   traffic read was unavailable, and never write a zero; a missing key is "no traffic recorded", not
   0. Never `content_analytics_get`: nothing in the product writes the table it reads, so every
   candidate comes back at zero and looks like a finding. A hand-composed URL (doors 2 and 3) takes
   the production host only - `environments.production.url` from `sites_list`, or the `is_primary`
   row of `project_domains_list({ project_id, tier: "production" })` when `ssl_status` is `issued`
   and `dns_status` is `verified` - never `live_preview.url`, never a development or staging tier;
   re-read `cms_entry_slug` after any publish, because a slug collision silently publishes at
   `slug-2` and rewrites it. Then `social_list_posts({ linked_content_id })`: a piece with posts
   already behind it is a second pass, named as one, with the earlier batch and its numbers first.
   REFUSE, with the reason and the lane: a library row whose `status` is not `published`, or an
   entry whose `derivedStatus` is `draft`, `scheduled` or `archived` (the content session publishes,
   and a publish is not a deploy); a `not_deployed` answer or a production tier with no URL (the web
   session deploys; never a preview URL in its place); a piece you did not read this session.
2. **Ground it (references/audience-grounding.md).** `customer_avatar_get({ id })` for THE persona
   the piece was written for - the full row, because `online_behavior.social_platforms` decides which
   of the six slugs get a post at all (a platform the persona does not list gets none, however
   connected) and `buying_behavior.objections` is the `faq` post. `customer_journey_get({ id })` for
   the journey's own `stages[].name` - that string goes in `journey_stage` (a name not on the journey
   is a 400), the Schwartz stage goes in the header and the `stage:` tag. The proof each post rests
   on, by id: the piece itself (its content id is Proof 2 for every post in the set),
   `before_after_grid_list({ target_avatar_id })` for the grid item behind the `case-study-3-lines`,
   `kb_search({ query })` for the fact behind the `faq`, `marketing_testimonials_list({ status:
   "approved" })` with `is_public` true for a customer's words on the `quote-card` (a line lifted
   from the piece itself needs nothing more). `social_pillar_list` for `pillar_id`: the set is
   Educate and Authority, one Promotion post at most, late in the window. `social_list_accounts` for
   `target_accounts` - `is_active` and `can_post` rows only, never a `pending_selection` row - and
   `quota.x.remaining` when X is in the set (more X drafts than remaining fail silently at cron
   time). Variance: `social_list_posts({ platform, status: "published", limit: 20 })` per platform,
   sorted by `published_at` yourself: max 2 of the last 10 with the same hook pattern, never the
   same opening six words, never one format three in a row, checked across the new set in its
   planned order too. Validity is a finding: a boilerplate persona, a grid aimed at no avatar, a
   journey whose stage names are placeholders - say it in the deliverable and walk the ladder in
   `hiveku-orient/references/foundation-first.md`; never invent a persona to unblock the set.
3. **Draft the set.** 6-8 posts, one per FORMAT, over 4-6 weeks - the table in repurpose.md section
   4: `question` (`unanswerable-question`), `data-point` (`specific-number`), `listicle`
   (`list-promise`; the count must be true), `contrarian` (`contrarian`), `case-study-3-lines`
   (`proof-teaser`; only when the piece carries a measured result), `quote-card` (`customer-quote` or
   `hot-take`), `faq` (`objection-first`), `behind-the-scenes` (`in-medias-res`), plus a `carousel`
   of the headers and the one Promotion link post when the set needs them. Open with the `question`
   and the `listicle` (Unaware, Problem Aware), close with the `case-study-3-lines` and the direct
   link (Product Aware, Most Aware). `talk_to_department({ domain: "social", message })` sees the
   account's avatars, grids and brand files but not the piece and not your choices, so the message
   carries the title, `excerpt`, `headers` and `candidate_specifics` (or the body), the persona name
   and id, the stage per post, the formats with their hook patterns, the platforms the persona
   allows, the per-platform `utm_links`, the last 20 per platform, and asks for the fenced
   `social_drafts.v1` block. Score every draft yourself against the 7-axis rubric in
   references/anti-fluff.md (the agent grades its own work; you are the second reader): the header
   `For: <avatar> | Stage: <stage> | Pillar: <pillar> | Hook: <pattern> | Format: <format> | CTA:
   <verb>` over each post, then `Rubric: N/14 (specificity, one-idea, proof, voice, native, hook,
   cta)` with the reason for every 1 or 0; the gate is 11 or more and zero hard fails (a banned
   phrase or one of `brand.ai_forbidden_phrases`, no header, a failed competitor swap, a variance
   breach). One rewrite pass, then say what still fails and leave it out - the client reads drafts.
   Each platform gets its own version, not a trim: X is one line plus one payoff and the URL counts
   23; LinkedIn's fold is about 210 characters, Instagram and Facebook about 125, GBP about 100.
   Then `social_post_validate` on every draft with its real `target_accounts` and `media_asset_ids`:
   it returns `{ ok, validation: { errors, warnings }, schedule, media: { resolved, missing, warnings
   }, x_quota }` and writes nothing; its errors are the work list before the batch.
4. **The hero and the cards.** The hero is `hero.media_asset_id` from door 1, or
   `media_library_list({ search: "<title>" })` (search matches title and filename, not alt text) then
   `media_library_get({ asset_id })` for `file_url`, `width` and `height`; a `featured_image_url` that
   is site-relative or lives outside the library goes through `media_library_register_external_url({
   file_url, title, alt_text })` on the absolute https URL first, because Meta and GBP fetch the URL
   themselves at publish and a relative path fails there while LinkedIn, X and TikTok succeed. Crops
   are `generate_image({ mode: "modify", reference_media_asset_ids: ["<hero id>"], prompt: "<the
   recrop or background instruction>", target_width, target_height })` - both dimensions or neither
   (one side is a 400), the default lane renders then cover-crops to the frame, the fal models refuse
   `modify`, and every success debits the account's monthly image quota. STOP: name the count and the
   sizes (1200x630 Facebook, 1200x1200 LinkedIn, 1080x1080 Instagram, 1600x900 X) and get the yes
   before the first render; after a client-side timeout, `media_library_list({ ai_generated: true })`
   newest first before rendering again, or a timeout is a double spend. Text on an image is designed,
   never generated: the `quote-card`, the `data-point` card and carousel slides are one brief each
   per references/creative-handoff.md - `pm_projects_list` (filter the returned list yourself), then
   `pm_tasks_create({ project_id, title: "CREATIVE: <platform> <format> - <title>", description:
   <the fenced json brief: title, brief, job, key_message, channel, cta, format, owner, platform,
   size, persona with the avatar id, stage, hook_line, copy_on_image verbatim, media_role,
   deliver_to, tag "social:<slug>">, task_type: "design", priority: "high" })`. The card comes back
   as a library row (`design_publish_to_library` by the designer, or `media_library_list({ tags:
   "creative-studio" })` matched on the `social:<slug>` title or tag), read with `media_library_get`,
   attached with `social_update_post({ post_id, media_asset_ids, media_alt_texts })` (the ids REPLACE
   the post's media list), and the task is `pm_tasks_complete` only then, never at brief time. Alt
   text on every item, 125 characters or fewer with any rendered text verbatim, on the post and on
   the asset (`media_update({ asset_id, alt_text })`); it reaches the dashboard, not the platforms,
   and the deliverable says so. Never generate a "before": a grid item's photos are the only before
   there is.
5. **STOP, then persist as ONE batch.** Present the set - every header and `Rubric:` line, the
   per-platform copy, each first comment and link, the crops and the briefs, the day each post lands
   across the 4-6 weeks - and get a yes. Then one `social_posts_bulk_create({ posts: [...], batch_id
   })`: up to 25 DRAFTS in one transaction, all-or-nothing with every row's validation echoed (one
   foreign id, one bad override key, one `scheduled_at`, and nothing is written), the `batch_id`
   written to `settings.batch_id` and the tag `batch:<id>` so the set can be reviewed or unwound as a
   unit. Each row: `title` `"<slug> / <format> / <platform>"` (255 max; the header lives in the
   deliverable), `content` as that platform's version, `target_platforms` with ONE slug and the
   matching `target_accounts`, `pillar_id`, `linked_content_id`, `avatar_id`, `journey_id` +
   `journey_stage`, `before_after_grid_id` when a grid item is the proof, the link where the platform
   allows it (`first_comment` - one line of reason plus the UTM link - on LinkedIn and on Facebook
   posts with media; `link_url` on GBP, where it becomes the Learn more button, and on a text-only
   Facebook post; in the body on X; nothing from this rail on TikTok; on LinkedIn a `link_url` with
   no media publishes as an article share, so set it only when the post IS the link),
   `media_asset_ids` + `media_alt_texts` for the crop, `tags: ["repurpose:<content_id>",
   "persona:<slug>", "stage:<slug>", "hook:<pattern>", "format:<format>"]` (the analytics loop groups
   on the last four; `repurpose:` is the provenance a human reads beside `linked_content_id`), and
   the calendar day in either form the route accepts - `calendar_event: true` with `proposed_date:
   "YYYY-MM-DD"` (one all-day `planned_post` event on that day, titled from the post, tagged
   `batch:<id>`), or `calendar_event: { title, event_type: "repurpose", start_date, all_day: true }`
   when the event needs its own title and type (`start_date` is the day and overrides
   `proposed_date`) - one per post, the DAY staggered over the window; the server creates the
   event with `linked_post_id` already set. Read it back: `social_post_preview({ post_id })` on one
   post per platform (the above-the-fold cut and the link handling as the platform shows them) and
   `social_list_posts({ linked_content_id })` for the whole set. Record the crops on the source
   item, one `content_media_attach({ content_id,
   filename, file_url, alt_text, media_type: "image" })` per crop - the asset manifest
   `content_media_list` reads on the next pass; it reaches no page and does not set the page's hero.
   The memory line - content id and title, the live URL, the `batch_id`, the post ids by format and
   platform, the persona, the date - goes in through step 6's read-merge-write. Nothing is scheduled
   here: the times are `/hiveku:social-plan` step 4 (`social_schedule_slot_next_open`, then
   `social_analytics_best_times`, then `social_update_post({ post_id, scheduled_at })`), one post,
   one confirm each - scheduling is publishing on a timer - and never `social_publish_post` on any of
   them: it stages the post into the approval queue, it does not ship it.
6. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
