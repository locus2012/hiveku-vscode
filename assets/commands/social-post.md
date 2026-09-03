---
description: "\"Write me a post about X\" - one post from a brief, written to the 11/14 bar: persona and stage named, a named hook pattern, per-platform variants, the creative brief, the first comment, scored against the anti-fluff rubric, persisted as a DRAFT only."
argument-hint: "[brief - topic, offer, or a link; optionally 'for <persona>' and 'on <platform>']"
---
One post from a brief$ARGUMENTS. Follow the **hiveku-social-agency** skill (Play 3) and load
three of its references before the first line of copy: `references/audience-grounding.md`
(who the post is for), `references/hooks-and-formats.md` (the 16 hook patterns, the 17
formats, the CTA ladder, the first-comment rule) and `references/anti-fluff.md` (the banned
list and the 7-axis rubric). Context: `account_context_get({ domain: "social" })` - keep
`brand.ai_forbidden_phrases`, `brand.brand_is`, `brand.brand_is_not` and `brand.cta_primary`
from it; they score the voice axis and write the Promotion CTA. This command leaves ONE
draft (or one draft per platform) in the account. It never schedules and never publishes:
the schedule is `/hiveku:social-plan` step 4, its own confirm, one post at a time.
1. Ground it, in this order, and fill the header before drafting. `social_list_accounts`: a
   publishing target is a row with `is_active: true`, `can_post: true`, `connection_status:
   "connected"`, `last_error` null and `token_state` `ok` or `unknown` - `unknown` is how
   Meta page tokens read (no expiry is stored; the token dies when the user token behind it
   does), so it means unpredictable, not fine: name it in the deliverable and draft anyway.
   No draft, and a reconnect finding, for `expiring_soon`, `expired`, any `last_error`,
   `can_post` false or a non-connected `connection_status`; a `pending_selection` row is a
   picker nobody has ticked and never a target; a platform the brief named with no eligible
   row is a task, not a post. Note `quota.x` when an X row exists.
   `social_pillar_list` for the pillar the brief serves - the CTA verb comes from the
   pillar's rung (Educate save or comment, Authority share or follow, Connection reply or
   tag, Promotion the brand's `cta_primary` verbatim). The persona: `customer_avatar_list`
   when the brief named none, then `customer_avatar_get({ id })` for the FULL row -
   `buying_behavior` (the objection, the trigger) and `online_behavior.social_platforms` are
   not in the context summary, and a platform the persona's list does not include gets no
   post aimed at them there. The journey, when the account has one: `customer_journey_list`
   then `customer_journey_get({ id })` for the stage NAME that `journey_stage` must carry.
   Proof: `before_after_grid_list({ target_avatar_id })` (take ids, then
   `before_after_grid_get({ id })` for the item: its `measurable_results` and its real
   photos are the strongest proof the account owns, and a "before" is never generated),
   `kb_search({ query })` for the fact the post rests on (quote the passage and name the
   knowledge base; an empty `data` means no passage, a 404 means no KB yet),
   `marketing_testimonials_list({ status: "approved" })` where `is_public` is true and
   `author.name` is the only name that may appear. Variance: `social_list_posts({ platform,
   status: "published", limit: 20 })` per target platform - read the `hook:` and `format:`
   tags (classify untagged rows from the first line yourself and say so), sort by
   `published_at`, and record the patterns used twice in the last 10, every opening six
   words, and the last two formats; fewer than 20 rows is no variance history, and the
   deliverable says so instead of asserting a clean check. Write the header line now,
   exactly: `For: <avatar> | Stage: <Schwartz stage> | Pillar: <pillar> | Hook: <pattern> |
   Format: <format> | CTA: <verb>`. Boilerplate in the persona ("[Company]", "your tool")
   or a grid aimed at nobody is a finding that stops the draft; never invent a persona to
   unblock a post, and "general audience" is a header you have not filled.
2. Draft through `talk_to_department({ domain: "social", message })`. The agent sees the
   avatars, grids and brand files on its side but not your choices, so the message carries:
   the brief; the persona name and id with the fields you are writing from (`pain_points`,
   `typical_quote`, the one objection); the stage; the proof source by id (grid item title,
   KB passage, testimonial id); the pillar and its CTA verb; the hook pattern to use; each
   platform with its fold (Instagram and Facebook about 125 characters, LinkedIn about 210,
   X the whole 280 with every URL counting 23, GBP 100); the format; and the variance facts
   from step 1 as patterns, openings and formats to avoid. Ask for one variant per platform
   (the X version written as its own post, not a trim), a first comment for the LinkedIn and
   Facebook variants, alt text under 125 characters per media item, two alternative hooks
   on the same platform, and the fenced `social_drafts.v1` block that ends its reply
   (`drafts[]` with `platform, content, first_comment, link_url, hook_type, format, cta,
   alt_text, media_brief, rubric` and `alternatives[]`). The agent grades its own work; you
   are the second reader.
3. Score every variant yourself against the 7-axis rubric (specificity, one-idea, proof,
   voice, native, hook, cta; 0, 1 or 2 each; the gate is 11/14 AND zero hard fails). Hard
   fails: a banned phrase from `references/anti-fluff.md` or `brand.ai_forbidden_phrases`
   anywhere in `content`, a first comment, an override, alt text or a hashtag (inflections
   count); a header you cannot fill; the competitor-swap test (a competitor's name in place
   of the brand and the post still reads true); a variance breach (a third use of the hook
   in the last 10, a repeated opening, the same format three in a row). Write the line under
   the header exactly: `Rubric: 12/14 (specificity 2, one-idea 2, proof 1, voice 2, native 2,
   hook 2, cta 1)` with one reason per 1 or 0. Rewrite ONCE, re-hooking when that is the fix
   (the persona and the stage do not change); if it still fails, say what fails, keep the
   draft as an alternative, and persist nothing - the client reads drafts. Then
   `social_post_validate({ content, target_platforms, target_accounts, media_asset_ids,
   platform_overrides })` with the healthy ids from step 1. It writes nothing and returns
   `{ ok, validation: { errors, warnings }, media: { resolved, missing }, x_quota }`: the
   cap per platform, media fit (Instagram requires media, GBP takes exactly one photo and no
   video, X takes four images or one video), library ids it could not resolve, and the X
   count whenever `twitter` is a target - `remaining: 0` or `eligible: false` means the X
   version fails at cron time, so drop the platform or say so in the deliverable. Errors
   are the work list, not a footnote.
4. Creative, library first: `media_library_list({ search })` (title and filename only, not
   alt text; `tags: "creative-studio"` for designed assets), then `media_library_get({
   asset_id })` for `file_url`, `width`, `height`, `alt_text` and `tags`. A format that
   carries words on the canvas (`quote-card`, `data-point`, a carousel with copy, a
   composite before-and-after) is a designed asset: `generate_image` cannot render reliable
   text, and there is no `creative` domain on `talk_to_department`. Write the brief per
   `references/creative-handoff.md` (`{ title, brief, job, key_message, channel, cta,
   format, owner, platform, size, persona, stage, hook_line, copy_on_image, media_role,
   deliver_to, tag: "social:<slug>" }`; the persona and stage from the header, ids
   included), STOP and show it, then `pm_tasks_create({ project_id, title: "CREATIVE:
   <platform> <format> - <title>", description: <the fenced brief plus the draft post id
   once one exists>, task_type: "design", priority: "high" })` with the `project_id` from
   `pm_projects_list`, and hold the post as a text-only draft. The pickup (the
   `social:<slug>` tag in `media_library_list({ tags: "creative-studio" })`,
   `social_update_post({ post_id, media_asset_ids })`, `pm_tasks_complete`) is
   `/hiveku:creative-brief`; the task is not done until the asset is attached. A plain
   photographic image is the DIY lane: STOP with the prompt and the cost (every success
   spends one monthly image slot; a fal model bills compute on top), then `generate_image({
   prompt, aspect_ratio })`. Read `brand_applied` (`brand_skipped_reason:
   "no_active_brand_guide"` is an unbranded render that still spent the slot), keep the
   returned `media_asset_id`, then `media_update({ asset_id, alt_text, tags })` with the
   asset's existing tags plus `social:<slug>` (`tags` REPLACES the array). After a
   client-side timeout, `media_library_list({ ai_generated: true })` newest first before
   generating again, or the timeout is a double spend. Never a generated before, never
   text as pixels, never a bare export URL in `media_urls`
   (`media_library_register_external_url` first, then attach by id).
5. STOP - show the header, the Rubric line, every variant with its first comment, the alt
   text, the validation result and the exact create call, and get a yes: the dashboard
   shows drafts to the client. Then persist as a DRAFT. One `social_create_post` per
   platform when the platforms will run at different times; ONE post with
   `platform_overrides: { "<platform>": { content, firstComment } }` when they share a
   schedule (only those two keys are read; an unknown key or slug is a 400 naming it).
   Every call carries `content`, `title` (a label, clamped to 255), `target_platforms`
   (exactly `linkedin`, `twitter`, `facebook`, `instagram`, `tiktok`,
   `google_business_profile`), `target_accounts` (the healthy ids - optional to the tool,
   mandatory in practice: a post without them is a 400 at publish time, after the client
   approved it), `pillar_id`, `tags` `["persona:<slug>", "stage:<slug>", "hook:<pattern>",
   "format:<slug>"]` where `stage:` is one of `unaware`, `problem-aware`, `solution-aware`,
   `product-aware`, `most-aware`, `avatar_id`, `journey_id` + `journey_stage` (the
   journey's own stage NAME; a name not on the journey is a 400 listing the real ones),
   `before_after_grid_id` when a grid item is the proof, `media_asset_ids` +
   `media_alt_texts` in the same order (stored for the dashboard; no publisher sends alt
   text to any platform today), and the link where each platform lets it go:
   `first_comment` on LinkedIn and Facebook (Facebook drops `link_url` when the post has
   media; Instagram accepts the comment but no Instagram link is clickable), the URL inside
   the 280 on X (first comments are unsupported there), `link_url` on GBP (it becomes the
   Learn more button), nothing from this rail on TikTok. NO `scheduled_at` and NO
   `scheduled_at_local`: a create with a schedule is not a proposal, it is a publish on a
   timer. Read the 201's `validation.warnings`, and fix anything under `errors` with
   `social_update_post({ post_id, ... })` while it is a draft. Then `social_post_preview({
   post_id })` and show the fold per platform: the effective copy after overrides, the
   character count against the cap, the hashtag count against the platform norm, where the
   link landed, the media composition. A hook whose specific sits below the fold is native
   1; fix it now, not after approval. Optionally bind the slot: STOP, then
   `social_calendar_create({ title, event_type: "planned_post", start_date,
   target_platforms, linked_post_id })` (`title`, `event_type` and `start_date` are all
   required; `start_date` is a DATE, the time is `start_time` read in `timezone`; the
   event schedules nothing). Never `social_publish_post` from here: on an unapproved post
   it returns 200 with `pending_approval: true` and stages the post into the approval
   queue. Scheduling is `/hiveku:social-plan` step 4 - one post, one confirm.
6. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
