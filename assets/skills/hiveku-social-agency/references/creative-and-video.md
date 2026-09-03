# Creative and media - the asset half of the post

Load this before producing, finding, importing, or attaching any visual asset, and
before spending anything on video. A post is copy plus creative; the creative is often
what stops the scroll. The brief that goes to the designer and the pickup that comes
back are in references/creative-handoff.md; which format needs which media is the
table in references/hooks-and-formats.md section 3; every attach parameter's full row
is in the contract table in references/publishing-approval-mechanics.md.

## Which tool names you can actually see (scoped-key visibility)

The creative surface has TWO naming families, and which one a session can see depends
on the key's profile. The social-scoped key profile grants the `media_`, `gallery_`,
`stock_photos_`, `avatar_` prefixes plus `generate_image` / `generate_image_set` by
name, the brand guide by name (`brand_guide_list`, `brand_guide_get`,
`brand_guide_create`, `brand_guide_update` and the logo, font and voiceover reads;
never `brand_guide_delete` or `brand_guide_purge`), and five design tools by name:
`design_list`, `design_get`, `design_state_get`, `design_templates_list`,
`design_publish_to_library`. It does NOT grant the `marketing_` prefix, the rest of
`design_`, or any render. So on a social-scoped key:
- Library reads/writes use the `media_` names: `media_library_list` (filters:
  media_type, tags, folder_id, collection_id, source_type, ai_generated, search),
  `media_folders_list` (hierarchy + asset count per folder), `media_library_get` (one
  asset by UUID with full metadata + usage_count), and
  `media_library_register_external_url` (register a pre-hosted URL as a media_assets
  row without uploading bytes; `media_library_register_external_url_batch` for a list).
  `media_upload` uploads a file directly (base64 `content`, up to 50MB, one file per
  call). `media_update({ asset_id, alt_text })` writes the alt text on the asset so
  every later attach inherits it.
- The `marketing_media_*` twins (`marketing_media_list`, `marketing_media_folders`,
  `marketing_media_get`, `marketing_media_register_external_url`) are the same library
  through the marketing prefix - real tools, but INVISIBLE to a social-scoped key.
  Use whichever family the session's tool list actually shows; on a full-profile key
  both work.
- The design pickup is real and read-only: `design_list` and `design_get` show what the
  designer has made, `design_state_get` its current canvas state,
  `design_templates_list` the template library, and
  `design_publish_to_library({ id, set_as_featured })` lands a finished design as a
  `media_assets` row you can attach. You cannot create, edit, version, or export a
  design from this key.
- The video pipeline (`marketing_storyboard_*`, `marketing_generate_video`,
  `marketing_video_pipeline_status`) and the design exports (`design_export_image`,
  `design_export_mp4`) are NOT reachable from a social-scoped key, by decision:
  exports are paid renders that register nothing in the library, and the designer
  department owns rendering. When a lane below is invisible in this session, that is
  why. The route is the handoff in references/creative-handoff.md: file the brief with
  `pm_tasks_create` (titled `CREATIVE: <platform> <format> - <title>`; the designer
  agent reads it on its next turn and humans see it on the board), ask the read-only
  `hiveku-creative-analyst` sub-agent for an opinion, or have a full-profile or
  marketing-design session run `/hiveku:media` or `/hiveku:design`. There is NO
  creative or design domain on `talk_to_department` (`website_design` is the Graphic
  Design persona for a live opinion on a design, not a brief carrier), so never "ask
  the creative agent" through it, and never improvise a domain name. Say plainly in
  the deliverable that the asset is with the designer and how it comes back.

## Sourcing the asset (in preference order)

- Use existing brand assets first: `media_library_list`, `media_folders_list`, and
  `media_library_get` to find approved photography, logos, and prior graphics.
  Reusing on-brand assets beats generating new ones - it keeps the feed visually
  consistent and respects the brand kit.
- Designed cards (quote cards, data-point cards, carousels with text on the slides)
  are the designer's: `generate_image` cannot render reliable text. Brief them per
  references/creative-handoff.md and pick the result up with
  `design_publish_to_library` or by polling `media_library_list({ tags:
  'creative-studio' })` for the `social:<slug>` tag the brief asked for.
- Stock, when the library has nothing: `stock_photos_search` searches Unsplash +
  Pexels and returns { url, thumbnail, photographer, source, attribution }; pull the
  chosen one in with `stock_photos_download`. Keep the attribution when the license
  asks for it.
- Generate original imagery when nothing fits: `generate_image` for a single visual and
  `generate_image_set` for a carousel or a batch of variations to choose from. Prompt
  with the brand's colors, style, and subject from the account's brand context; generic
  stock imagery reads as generic and underperforms. Both charge against the account's
  image quota and auto-register the output as media_assets rows, so the returned asset
  id goes straight into `media_asset_ids`.
- `media_ai_enhance_prompt` turns a rough social post idea into one image-generation
  prompt ready to pass to `generate_image`/`generate_image_set`. It WRITES NOTHING of
  its own, and it COSTS MONEY ON EVERY CALL - it runs a full social department agent
  turn (seconds to tens of seconds, metered against the account's AI spend) - so use
  it for hero posts, not for every thumbnail. A 200 does not prove its anti-repetition
  pass ran; eyeball the prompt against last week's before spending on the image.
- Bring in externally sourced or client-supplied visuals with
  `media_library_register_external_url` so they live in the media library and can be
  attached to posts like any other asset. A registered URL is a pointer
  (`source_type: 'url'`), not a hosted copy; it must stay publicly reachable until the
  post fires.

## Attaching (both attach points, on both tools)

Two ways to put media on a post, and both work on `social_create_post` AND
`social_update_post`:
- `media_asset_ids`: Media Library ids from `media_library_list` / `media_library_get`
  (or the id `generate_image`, `generate_image_set` and `design_publish_to_library`
  return). The server resolves each id into URL, type, alt text and dimensions and
  keeps the ids on the row (read back as `media_asset_ids` on `social_get_post`).
  Prefer this: the alt text written with `media_update` rides along, the asset's usage
  is recorded when the post publishes, and a wrong id is a 400 instead of a post with a
  missing picture.
- `media_urls` with `media_types` (parallel arrays: 'image', 'video' or 'document' per
  URL; a MIME type is accepted and normalized) and `media_alt_texts`. Always send
  `media_types` with `media_urls`: an untyped URL is inferred from its extension and an
  extensionless video URL is treated as an image.

Rules:
- Order is carousel order: `media_urls` first, then the resolved `media_asset_ids`, in
  the order given. There is no reorder control other than sending the list again.
- On `social_update_post` the media list is REPLACED wholesale by what you send. To add
  a slide, send every item you want to keep; to remove all media, send an empty list.
  Send `media_alt_texts` in the same call, same order.
- Every URL must be public https. Meta and GBP fetch the URL themselves at publish
  time, so a `source_type: 'url'` asset comes back with a warning naming that.
- A missing or foreign asset id, a non-https URL, or more than 20 ids is a 400 and the
  post is not written. A duplicate id is attached once, with a warning.
  `social_post_validate` reports the same problems (`media.missing`, `media.warnings`)
  without writing anything - run it before a week of drafts.
- Platform media caps are platform errors: Instagram requires media on every post and
  takes 10 images; LinkedIn 9 images or one document; X 4 images; GBP exactly one
  image and no video; TikTok video only (images are ignored, no video is an error).
  On a draft the errors are echoed on the 201; on a scheduled post they are a 400
  (references/publishing-approval-mechanics.md).
- A post at 'publishing' or 'published' is edit-locked, media included.
  `social_post_duplicate({ post_id })` gives you the editable copy.

## Format notes worth respecting

Square or 4:5 for Instagram feed, vertical 9:16 for Reels/TikTok/Stories, landscape or
square for LinkedIn, and a clean landscape/square with legible text for GBP. Carousels
earn saves and dwell time - lean on `generate_image_set` for photographic slides and
on the designer for slides that carry text.

## Video - three real lanes. Pick one before spending anything.

(All three lanes live behind `marketing_`/`design_` prefixes - see the visibility
section above for what to do when they are not in this session's tool list. The
social key never sees them; the handoff is references/creative-handoff.md.)
- MULTI-SCENE Reel/TikTok/promo: `marketing_storyboard_create` (pass exactly one of
  `template_id` + `substitutions`, or a hand-authored `storyboard`). It is FREE and
  fast - it validates, prices, and stores; nothing is billed or enqueued until a human
  approves. THE AGENT CANNOT APPROVE: after
  `marketing_storyboard_submit_for_approval({ storyboard_id })`, report scenes,
  runtime, and cost, then STOP. Do not fan out single clips to work around the gate.
  Track an approved run with `marketing_video_pipeline_status({ pipeline_id })` - same
  id as the storyboard. Full procedure with every trap: `/hiveku:media`. Stock footage
  for a `stock` scene comes from `media_stock_video_search` (Pexels + Pixabay; read
  `providerErrors` on every call; the provider-prefixed `id` like "pexels:13736675" is
  what the scene stores). A social key can search that footage but cannot build the
  scene that uses it; put the handles in the brief.
- ONE CLIP: `marketing_generate_video({ prompt, aspect_ratio })` - ~10s, 720p, PAID
  (~$1 each), Premium-plan only, 20 clips per account per month. ALWAYS call with
  `dry_run: true` first and tell the user the remaining quota before spending. Animate
  an existing still by passing it as `reference_media_asset_id`. The clip
  auto-registers, so its asset id attaches through `media_asset_ids`.
- MOTION GRAPHICS (text/layout/branded cards, no generation cost): built in Creative
  Studio and rendered with `design_export_mp4({ id, canvas_json, width, height,
  duration_seconds })` by the designer or a full-profile session. An export registers
  nothing: the social session picks it up only after `design_publish_to_library` or,
  for a raw export URL, `media_library_register_external_url`.

Client-supplied or agency-produced footage still comes in through
`media_library_register_external_url` - that is the import path, not the only video
option. Never claim a clip was generated when it was not.
