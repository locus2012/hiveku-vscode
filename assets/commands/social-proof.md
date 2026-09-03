---
description: "\"Post about our results\" / \"use the testimonials\" - transformation and proof posts from the before/after grids, testimonials and knowledge base: one post per labelled grid dimension, sourced and scored, drafts only."
argument-hint: "[optional persona, grid id, or 'testimonials']"
---
Proof posts ($ARGUMENTS). Follow the **hiveku-social-agency** skill (Play 3, the proof lane; R4 is
the rule this command exists for) and load four of its references before the first line of copy:
`references/audience-grounding.md` (section 4, grids -> the four transformation posts, and section
5, the proof sources), `references/anti-fluff.md` (the banned list, the 7-axis rubric, the
competitor-swap test), `references/hooks-and-formats.md` (the hook and format slugs the header
carries) and `references/creative-handoff.md` (the quote card and the composite are designed, not
generated). Context: `account_context_get({ domain: "social", include: "grids" })` - keep
`brand.ai_forbidden_phrases`, `brand.brand_is`, `brand.brand_is_not` and `brand.cta_primary`, and
read `has.grids` before concluding the account has no proof. The rule of this command: every post
cites a source the deliverable names by id (a grid item, an `is_public` testimonial, a `kb_search`
passage), the Proof axis scores 2 on every post or the post leaves the set, and the set lands as
DRAFTS. Nothing is scheduled and nothing is published here.
1. Ground it and label the proof. The persona first: an argument names one
   (`customer_avatar_list({ search })`, then `customer_avatar_get({ id })` for the FULL row -
   `buying_behavior.objections` and `online_behavior.social_platforms` are not in the context
   summary, and a platform the persona does not list gets no post, however connected); a grid id
   goes straight to `before_after_grid_get({ id })` and its `target_avatar_id` names the persona; no
   argument means `customer_avatar_list` and the account's active grids from the context call,
   and you say which pairing you chose. Then `before_after_grid_list({ target_avatar_id })` (ids
   only; the rows carry every image URL) and `before_after_grid_get({ id })` for the one grid:
   `grid_items[]` (`before.title`, `before.description`, `before.pain_points`, `before.images`,
   `after.title`, `after.description`, `after.benefits`, `after.images`,
   `transformation_details`), `transformation_story`, `key_benefits`, `measurable_results`. A grid
   with `target_avatar_id` null aims at nobody and a grid built for another persona is not proof
   for this one: both are findings that stop the set, never a header made vaguer. Label every item
   with the ladder dimension it best expresses - **Have** (what they own, owe or count),
   **Feel** (the emotional state), **Average Day** (the hours), **Status** (how others treat
   them) - one label per item (an item that carries two gets the stronger, and you say so), and a
   dimension no item expresses is reported as a gap in the grid, not padded. Then the two other
   sources: `kb_search({ query })` for the fact each post rests on (returns `data: [{ content,
   score, knowledgeBaseName }]`; quote the passage and name the knowledge base; an empty `data`
   means no passage, a 404 means no KB yet) and `marketing_testimonials_list({ status: "approved"
   })` - a row may be republished ONLY when `is_public` is true (`approved` alone is consent not
   yet granted), `author.name` is the only name that may appear, `body`, `transcript` and
   `headline` come back for pending rows too and are unreviewed third-party speech you read and
   never quote; stop paging on an empty array, not on `next_before`. Cite the testimonial `id`.
   With 'testimonials' as the argument the set is one quote-card per `is_public` row, and each
   still needs a persona: match `author.role` and `author.company` to an avatar, and a
   testimonial that fits no avatar is a finding, not a post for "everyone". The journey, when one
   exists: `customer_journey_list` then `customer_journey_get({ id })` for the stage NAME that
   `journey_stage` must carry (Product Aware in the header, the journey's own word on the row).
   The pillar: `social_pillar_list` - proof posts are Authority (CTA share or follow), at most one
   Promotion post in the set (the brand's `cta_primary` verbatim). The roster:
   `social_list_accounts` - a target is a row with `is_active: true`, `can_post: true`,
   `token_state: "ok"` and `connection_status: "connected"`; a `pending_selection` row is a
   picker nobody has ticked. History: `social_list_posts({ before_after_grid_id })` - a grid with
   posts already behind it is a second pass, named as one, with the earlier post ids and the items
   they used first, so the same item is not posted twice. Variance: `social_list_posts({ platform,
   status: "published", limit: 20 })` per target platform, sorted by `published_at` yourself -
   the patterns used twice in the last 10, every opening six words, the last two formats; fewer
   than 20 rows is no variance history and the deliverable says so.
2. Draft the set through `talk_to_department({ domain: "social", message })`. One post per
   labelled item, in the shape the dimension earns: **Have** -> `Hook: specific-number`,
   `Format: case-study-3-lines` (situation / what changed / the number, three lines each under 140
   characters, the number from `measurable_results` or a count in `before.description` and
   `after.description`; the row's `transformation_story` and `key_benefits` supply the first two
   lines when the item does not); **Feel** -> `Hook: customer-quote`, `Format: quote-card` (the
   words are `after.description` in the customer's own words or an `is_public` testimonial, quoted
   verbatim, never paraphrased); **Average Day** -> `Hook: before-after`, `Format: before-after`
   (two short scenes, the same hour, then and now); **Status** -> `Hook: proof-teaser`, `Format:
   before-after` (what changed in how the board, the boss, the neighbours or the inspector treat
   them). Plus one `Hook: objection-first`, `Format: objection-handler` when
   `buying_behavior.objections` holds an objection the grid, a testimonial or a KB passage
   answers - one objection per post, answered with the source, never with an adjective. Stage:
   Product Aware for all of them (Most Aware only on the Promotion post). The agent sees the
   avatars, grids and brand files on its side but not your choices, so the message carries: the
   persona name and id with `pain_points`, `typical_quote` and the one objection; the grid id and,
   per post, the item title, its label and the exact figures, quotes and image URLs it may use;
   the testimonial id and `author.name`, or the KB passage and its knowledge base; the pillar and
   its CTA verb; the hook and format per post; each platform the persona lists that has a
   healthy row, with its fold (Instagram and Facebook about 125 characters, LinkedIn about 210,
   GBP 100 - X and TikTok get no post from this set, since no format in it lists them); and the
   variance facts from step 1 as patterns, openings and formats to avoid. Ask for one variant per
   platform (not a trim), a first comment for the LinkedIn and Facebook variants, alt text under
   125 characters per image, two alternative hooks per post, and the fenced `social_drafts.v1`
   block that ends its reply (`drafts[]` with `platform, content, first_comment, link_url,
   hook_type, format, cta, alt_text, media_brief, rubric` and `alternatives[]`). Every post in the
   deliverable opens with the header line, exactly: `For: <avatar> | Stage: <Schwartz stage> |
   Pillar: <pillar> | Hook: <pattern> | Format: <format> | CTA: <verb>`, and the line under it
   names the source, exactly: `Source: grid <grid_id> item <n> "<title>" (<Have|Feel|Average
   Day|Status>)`, or `Source: testimonial <id>`, or `Source: kb "<knowledgeBaseName>"`. A number,
   quote or result the message did not hand the agent is invented; strike it.
3. Gate every variant yourself; the agent grades its own work and you are the second reader.
   Score the 7-axis rubric (specificity, one-idea, proof, voice, native, hook, cta; 0, 1 or 2
   each) and write the line under the Source line exactly: `Rubric: 13/14 (specificity 2, one-idea
   2, proof 2, voice 2, native 2, hook 2, cta 1)` with one reason per 1 or 0. The gate here is
   three conditions, not one: 11/14 or better, zero hard fails, AND `proof 2` - a source named by
   id in the Source line and quoted or counted in the copy. Hard fails: a banned phrase from
   `references/anti-fluff.md` or `brand.ai_forbidden_phrases` anywhere in `content`, a first
   comment, alt text or a hashtag (inflections count); a header you cannot fill; the
   competitor-swap test (swap the brand name for a competitor's and read the hook line alone, then
   the whole post - a proof post that still reads true has its number or quote uncited, and the
   fix is the citation, never an adjective); a variance breach (a third use of a hook in the last
   10, a repeated opening, the same format three in a row - checked across this set in its
   planned order too, so two `before-after` formats never run back to back with a third). One
   rewrite pass: re-hook when that is the fix (the persona, the stage and the source do not
   change), then re-score. A post that still fails, or whose source cannot be named, is not
   re-hooked as an opinion post here: it goes to the alternatives with the reason, and nothing
   under the gate is persisted - the client reads drafts. Then `social_post_validate({ content,
   target_platforms, target_accounts, media_asset_ids, platform_overrides })` per post with the
   healthy ids from step 1; it writes nothing and returns `{ ok, validation: { errors, warnings },
   media: { resolved, missing, fit }, x_quota }`: the cap per platform, Instagram's media
   requirement, GBP's one photo and no video, library ids it could not resolve. Errors are the
   work list, not a footnote.
4. The pictures. The before and the after are photographs of the customer's situation, and the
   only ones that exist are the ones the account already holds: `before.images[]` and
   `after.images[]` on the grid item (`{ url, prompt }`; an entry with a non-empty `prompt` was
   rendered by the populate flow and is an illustration, never captioned as the customer's photo),
   or the client's own uploads in the library (`media_library_list({ source_type: "upload" })`,
   `media_library_list({ search })` on the customer or job name - `search` matches title and
   filename, not alt text). Read each candidate with `media_library_get({ asset_id })` for
   `file_url`, `width` and `height`; a grid image the library does not hold is registered ONCE with
   `media_library_register_external_url({ file_url, title, alt_text, tags, width, height })` and
   attached by the returned id (a `source_type: "url"` asset is a pointer, and the create warns
   about it; say so). NEVER generate a before: not with `generate_image`, not with a stock photo
   dressed as one; a fabricated before is a false claim about a customer's situation and the
   account carries it. An item with no photographs runs as copy, or its gap goes to the designer.
   Text on a canvas is designed, not generated: the `quote-card`, and the single composite
   before-and-after GBP takes (one photo, no carousel), are one brief each per
   `references/creative-handoff.md` (`{ title, brief, job, key_message, channel, cta, format,
   owner, platform, size, persona, stage, hook_line, copy_on_image, media_role, deliver_to, tag:
   "social:<slug>" }`; the quote in `copy_on_image` verbatim with `author.name`; the grid id and
   item title in `brief`). STOP and show the brief, then `pm_projects_list` (filter the returned
   list yourself) and `pm_tasks_create({ project_id, title: "CREATIVE: <platform> <format> -
   <title>", description: <the fenced brief plus the draft post id once one exists>, task_type:
   "design", priority: "high" })`; hold that post as a text-only draft and leave the task open
   until the asset is attached (`/hiveku:creative-brief` does the pickup:
   `social_update_post({ post_id, media_asset_ids, media_alt_texts })`, then `pm_tasks_complete`).
   Alt text on every item, 125 characters or fewer, the subject first, any text rendered on the
   card verbatim; on the post in `media_alt_texts` and on the asset with `media_update({ asset_id,
   alt_text, tags })` (`tags` REPLACES the array: send the existing tags plus `social:<slug>`).
   It reaches the dashboard, not the platforms, and the deliverable says so.
5. STOP - show every header, Source and Rubric line, the copy per platform with its first
   comment, the photos by asset id and their alt text, the briefs filed, the validation result and
   the exact create call, and get a yes: the dashboard shows drafts to the client. Then persist as
   DRAFTS. One `social_create_post` per platform when the set is small, or ONE
   `social_posts_bulk_create({ posts: [...], batch_id })` for the set (up to 25 rows in one
   transaction, all-or-nothing with every row's validation echoed - one foreign id or one bad
   override key and nothing is written; the server adds the tag `batch:<id>` and writes
   `settings.batch_id`). Each row: `title` `"<persona> / <label> / <format> / <platform>"` (a
   label, clamped to 255; the header lives in the deliverable), `content` as that platform's
   version, `target_platforms` with ONE slug (exactly `linkedin`, `facebook`, `instagram`,
   `google_business_profile`) and the matching `target_accounts` (optional to the tool, mandatory
   in practice: a post without them is a 400 at publish time, after the client approved it),
   `pillar_id`, `before_after_grid_id`, `avatar_id`, `journey_id` + `journey_stage` (the journey's
   own stage NAME; a name not on the journey is a 400 listing the real ones), `tags:
   ["proof:<grid_id>", "persona:<slug>", "stage:<slug>", "hook:<pattern>", "format:<format>"]`
   (`stage:` is `product-aware` or `most-aware` here; `proof:` is the provenance a human reads
   beside `before_after_grid_id`, and `proof:testimonial-<id>` on a testimonial post),
   `media_asset_ids` + `media_alt_texts` in the same order, and the link where the platform lets
   it go: `first_comment` on LinkedIn and on Facebook posts with media, `link_url` on GBP (it
   becomes the Learn more button), nothing clickable on Instagram. NO `scheduled_at`, NO
   `scheduled_at_local`, no `proposed_date` and no `calendar_event`: a create with a schedule is
   a publish on a timer, and the day is `/hiveku:social-plan` step 4, one post, one confirm. Read
   the 201's `validation.warnings` and fix anything under `errors` with `social_update_post({
   post_id, ... })` while it is a draft; then `social_post_preview({ post_id })` on one post per
   platform - the effective copy above the fold, the character count against the cap, where the
   link landed, `media_composition` - and `social_list_posts({ before_after_grid_id })` for the
   whole set. A hook whose number sits below the fold is native 1; fix it now, not after approval.
   Never `social_publish_post` from here: on an unapproved post it returns 200 with
   `pending_approval: true` and stages the post into the approval queue. The memory line - grid id
   and name, the item labels you settled (Have / Feel / Average Day / Status by item title), the
   `batch_id`, the post ids by label and platform, the testimonial and KB sources, the persona,
   the date - goes in through step 6's read-merge-write, so the next session does not relabel the
   grid from scratch.
6. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
