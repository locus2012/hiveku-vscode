# Creative handoff - briefing the designer, picking the asset up, attaching it

Load this before briefing any designed visual (a quote card, a data-point card, carousel
slides that carry text, a reel cover, a composite before-and-after) and before attaching
a designed asset to a post: the fifteen department domains and why none of them is
"creative", the brief shape, the three carriers a brief travels on, the pickup from the
Media Library into `media_asset_ids`, the public-https media rule, and the DIY generate
lane. What the visual is FOR comes from references/audience-grounding.md and
references/hooks-and-formats.md (the formats that need a designed card are marked there);
library and video mechanics are in references/creative-and-video.md; the post fields are
in references/publishing-approval-mechanics.md.

## 1. There is no creative domain

`talk_to_department` accepts exactly fifteen domains: seo, social, content, marketing,
branding, outbound, ppc, analytics, customer_avatar, customer_journey, before_after_grid,
website_design, knowledge_base, workflow, sales. There is no `creative`, `design` or
`media` value; an unlisted domain is a schema rejection before any agent runs. Two of the
fifteen matter to a visual:
- `website_design` is the slug the dashboard labels "Graphic Design". It runs the Graphic
  Design persona over its own hydrated workspace (brand, library index, open PM tasks) and
  is the right call for a LIVE opinion: which of two directions fits the brand, whether a
  card is legible at feed size, what slide 1 of a carousel should carry.
- `branding` is the visual-system domain: palette, type, logo lockups, what the brand
  looks like. Ask it for visual direction; ask the persona for the design itself.
Neither call is the render contract. A chat turn may or may not leave a design behind; the
handoff in this file is a PM task plus a library asset, both of which can be read back.
`talk_to_department` and `account_context_get` are available on every key profile, so
this section holds on the social key exactly as on a full one.

## 2. The brief

One brief per asset, written before a carrier is chosen. The first eight keys are the
journey stage-asset proposal shape, reused verbatim, so a brief written here can be filed
on the journey later with `customer_journey_stage_asset_propose` from a content session
(hiveku-content-agency/references/customer-journey.md, section 4). The rest is what a
designer needs and a journey does not. Example, on the invented account from
references/audience-grounding.md:

```json
{
  "title": "Priya quote card - community page",
  "brief": "Pull quote large, attribution small, one brand color field, no photo. Calm, not triumphant. The relief is the result.",
  "job": "Product Aware proof for HOA treasurers; removes the 'will this change my week' risk",
  "key_message": "the dread stopped",
  "channel": "linkedin",
  "cta": "reply",
  "format": "quote-card",
  "owner": "creative",
  "platform": "linkedin",
  "size": "1200x1200",
  "persona": "Priya Raman (avatar <uuid>)",
  "stage": "Product Aware",
  "hook_line": "'I stopped dreading the community page.'",
  "copy_on_image": ["I stopped dreading the community page.", "HOA treasurer, Parkside Commons, week 11"],
  "media_role": "quote-card",
  "deliver_to": "media_library",
  "tag": "social:priya-quote-community-page"
}
```

Rules for filling it:
- `brief` is creative direction in prose: what is on the canvas, what is not, the mood
  in two words. "A nice quote graphic" is a failed brief; the journey rule "write the
  hook, do not describe it" applies to the image too.
- `copy_on_image` is every word that renders on the canvas, verbatim and final. Text is a
  canvas layer, never generated pixels (section 6), so the designer types exactly this,
  and exactly this goes into the alt text later.
- `media_role` is one of `hero` (one image on one post), `carousel` (N sibling slides,
  order named in the brief), `quote-card`, `reel-cover`. It tells the designer how many
  artboards and which safe areas.
- `size` names a preset from `design_templates_list` when one exists: instagram_post
  1080x1080, instagram_story 1080x1920 (also the reel cover), facebook_post 1200x630,
  twitter_post 1600x900, linkedin_post 1200x1200. Portrait feed 1080x1350 is NOT a
  preset; a design artboard is free-form, so write the dimensions and say so.
- `persona` and `stage` are the header from references/audience-grounding.md, ids
  included, so the designer reads the same `customer_avatar_get` row you did. A grid item
  goes in `brief` by grid id and item title; its real photos are the only before and
  after that may appear.
- `tag` is `social:<slug>`, unique per brief. It is how the asset is found again
  (section 4); put it in the PM task title too.

## 3. Three carriers

(A) The PM task, the default. Humans see it on the board; the Graphic Design persona
sees it in its `data/pm_tasks.json` on its next hydration (the 50 most recently updated
open tasks across the account's Olympus-managed projects; that flag is not in the
`pm_projects_list` response, so file into the project the account's marketing tasks
already live in, and treat the human board as the guaranteed audience). The calls:
1. `pm_projects_list` returns id, name, description, status, project_type, task_count,
   with no name filter: filter the returned list yourself.
2. `pm_tasks_create({ project_id, title: 'CREATIVE: linkedin quote-card - Priya quote
   card', description: <the brief as a fenced json block, plus the draft post id when
   one exists>, task_type: 'design', priority: 'high', due_date })`. The field is
   `title`, not `name`; `priority` defaults to medium. The `CREATIVE: <platform>
   <format> - <title>` prefix is a convention, not a code path: it is what a human
   recognises on the board and what a later session filters `pm_tasks_list` by.
3. Close the loop from the other side: `pm_tasks_get({ id })` for status and comments,
   `pm_tasks_comment({ id, content })` for a revision note, `pm_tasks_complete({ id,
   summary })` once the asset is attached (section 4). Never mark it done before the
   asset exists in the library.

(B) `hiveku-creative-analyst`, the read-only sub-agent. Dispatch it for the questions
before a brief: which library assets already fit (it pages `media_library_list`),
whether the active brand guide is complete enough to substitute into a template, what
size a platform needs, whether an existing design is stalled on client comments. It
renders, registers and deletes nothing, and it does not file the task; you do.

(C) A full-profile or `marketing-design` session runs `/hiveku:design` (an editable,
layered design project) or `/hiveku:media` (images, designs, video): the only lane that
renders today. On the social key the design surface is read-and-publish, not create:
`design_list` (most-recently-edited first, with `featuredImageUrl` and tags),
`design_get` (the full canvas), `design_state_get` (the element summary; pass `page_id`
on a multi-page carousel or you read page one), `design_templates_list`, and
`design_publish_to_library`. No canvas write, no export, no comment write.

## 4. Pickup: from the library into the post

The asset reaches you one of two ways, and both end in a `media_assets` row:
- The designer published it. `design_publish_to_library({ id, set_as_featured: true })`
  renders one settled frame from the saved canvas (send no canvas), uploads the PNG and
  creates a row tagged `creative-studio` + `published`, titled with the design's title
  unless `title` was passed, returning `{ success, fileUrl, mediaAssetId, width, height }`.
  When the design was left unpublished you may call it yourself from the social key,
  once: it is CREATE, never sync, nothing dedupes, and a 504 after 90s carries no job
  handle while the render may still land, so never retry or loop it. `set_as_featured`
  must be a JSON boolean. The route takes `page_id`, `title` and `set_as_featured` only,
  no tags and no task id, so the `social:<slug>` marker arrives in the title (ask for it
  in the brief) or you stamp it after pickup.
- It is already in the library. `media_library_list({ tags: 'creative-studio', limit: 20
  })` returns newest first (`created_at` descending, default 20, max 100); match the
  `social:<slug>` tag or the title. `search` matches title and original filename only,
  not alt text, whatever the tool description says.

Then, in order:
1. `media_library_get({ asset_id })` for `file_url`, `width`, `height`, `alt_text`,
   `tags`, `usage_count`. Check the dimensions against the brief before attaching.
2. `social_post_validate({ content, target_platforms, target_accounts, media_asset_ids })`
   reports media fit per platform (resolved and missing ids, image count against the cap,
   dimensions against the platform profile when known) and writes nothing. Instagram
   requires media; GBP takes exactly one photo and no video; X takes 4 images or one
   video, never mixed; LinkedIn takes one media category per post; TikTok ignores images.
   Composition per format: references/hooks-and-formats.md section 3.
3. Attach with `media_asset_ids` on `social_create_post` (resolved server-side into
   `media_urls`, `media_types`, alt text and dimensions, appended AFTER any `media_urls`
   in the order given; a missing or foreign id is a 400 naming it) or on
   `social_update_post({ post_id, media_asset_ids })`, where the ids REPLACE the post's
   media list. A carousel is the array order. The post must still be editable
   (references/publishing-approval-mechanics.md), and a scheduled post whose new media
   fails platform validation is a 400.
4. Alt text: `media_alt_texts` on the post, one per item, with `copy_on_image` inside it
   verbatim (rules in references/hooks-and-formats.md section 6), and `media_update({
   asset_id, alt_text, tags })` on the asset so the next post inherits it. `tags`
   REPLACES the array: send the existing tags plus `social:<slug>`, never the slug alone.
5. Read it back with `social_post_preview({ post_id })`, which shows the media
   composition per platform after overrides. Then `pm_tasks_comment` with the asset id
   and the post id, and `pm_tasks_complete`.

Exports are not a pickup. `design_export_image` returns an S3 PNG URL and
`design_export_mp4` an MP4 URL; neither returns a library id, so treat the URL as
unregistered: `media_library_register_external_url({ file_url, title, tags, alt_text,
width, height })` first, then attach by the returned id. A bare URL pasted into
`media_urls` publishes once and is invisible to `usage_count`, to the asset dimension of
`social_analytics_by_dimension`, and to the next session looking for it.

## 5. The media rule

Every attached URL is public https. Meta and GBP never receive bytes from Hiveku: the
Graph API is handed `url`, `image_url` or `video_url` and GBP a `sourceUrl`, and each
pulls the file itself, so a URL behind a login, a `data:` URI or an expiring signed link
fails at publish on a post that validated. LinkedIn, X and TikTok download first and
upload the bytes, and that download is the SSRF-guarded fetch: https only, redirects not
followed (a shortener or a CDN that answers 3xx fails), every resolved address vetted
against private ranges, and a streamed byte cap the adapter sets per platform (25 MB
default). The library's `file_url` is a permanent public S3 URL and satisfies all of it,
which is why the pickup goes through the library and not through a URL in a chat message.

## 6. Iterating, and the DIY lane

Iteration runs through the PM task thread. Design comments are read-only from a key:
`design_comments_list` returns the whole thread (resolved rows included; filter
`isResolved` yourself), no tool creates a comment because a comment needs a human user
id, and `design_comment_resolve` is one-way. So a revision is `pm_tasks_comment` naming
what changes and why, quoting the rubric axis from references/anti-fluff.md the card
fails; a re-published design is a second library row, picked up the same way. A variant
of a post that already carries the asset is `social_post_duplicate({ post_id })`, which
clones the media and alt text into a new draft.

The DIY lane is `generate_image` and `generate_image_set` (up to 10 in one call, with a
`role` and aspect per prompt), on the social key by name. Both are brand-aware by default
(the ACTIVE brand guide is appended to the prompt; read `brand_applied` and
`brand_skipped_reason` on the response, since an unbranded render still spends the slot),
both auto-register a row with `source_type: 'ai_generated'` and return `media_asset_id`,
and both are quota-metered. They produce photographic subjects only: text, numbers, logos
and lockups are canvas layers in a design, never generated pixels, so a quote card or a
data-point card is a brief (section 2), not a prompt. After a client-side timeout, check
`media_library_list({ ai_generated: true })` newest first before regenerating (the route
honors `ai_generated`, not `source_type`) or a timeout becomes a double spend.
`media_ai_enhance_prompt` writes the prompt for you at the cost of a full agent turn; use
it for a hero, not a thumbnail. Never generate a "before": the photos on a grid item are
the only before that exists, and a generated or stock one is a fabricated result
(references/audience-grounding.md section 4).

## 7. Traps

- Naming a `creative` domain. The call is rejected; the fifteen are in section 1.
- Treating a chat turn as delivery. The deliverable is a library row with an id.
- Marking the PM task done at brief time, or at chat time. Done means attached.
- Retrying `design_publish_to_library` after a 504. Two renders, two rows.
- Expecting `media_library_list({ tags })` to find the slug when the publish route
  received no tags. Match the title, then stamp the tag with `media_update`.
- `media_update({ tags: ['social:x'] })` wiping `creative-studio`. Send the union.
- Attaching an export URL by pasting it into `media_urls`. Register it, attach by id.
- Reading `media_library_get` dimensions and skipping `social_post_validate`. The cap and
  the required-media rules are per platform; the validator knows them.
- A generated before, a generated logo, generated text on a card.
- Filing the brief without the header. A designer who does not know the persona and the
  stage designs for the brand, and the card reads like an ad.
