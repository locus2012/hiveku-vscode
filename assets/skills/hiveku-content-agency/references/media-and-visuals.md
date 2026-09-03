# Media registration, visuals, and video

Load this file before generating, registering, attaching, or deleting any media asset, and
before any video work (clips, Reels, storyboards).

## Which registration tool for which asset

`generate_image` / `generate_image_set` for branded originals. Both AUTO-REGISTER
into the media library and return `media_asset_id` - use that id directly; re-uploading produces
duplicate rows. `media_upload` is only for raw bytes the user actually handed you (it requires
`file_name` + base64 `content`, which you do not have after a generation). For a pre-hosted URL -
including a `stock_photos_search` result - register it with `marketing_media_register_external_url({
file_url, source_type, title, alt_text })`, or `media_library_register_external_url_batch` for up
to 100 at once. `stock_photos_download` is the website-project lane and needs `{ url, project_id,
save_path }`; it does not touch the media library. Verify with `media_library_list` and reference
library assets - never hotlink inline external URLs. For text-heavy or branded graphics (quote
cards, carousels, promo tiles) use the Creative Studio lane instead - `design_templates_list` →
`design_create` → `design_export_image` - it has no per-image generation cost. Full media
procedure: `/hiveku:media`.

## Deleting and auditing assets

Media assets belong in the media library, not as inline external URLs - hotlinks rot, break
brand consistency, and are invisible to `media_library_list` audits. The right registration tool
depends on what you are holding: generated images register themselves, a hosted URL goes through
`marketing_media_register_external_url`, and only raw bytes go through `media_upload`. Set
`media_update({ asset_id, alt_text, tags })` on what you file. Before any `media_delete`, run
`media_usage_get({ asset_id })` - it lists every email, page section, and CMS entry that would
break; the delete is a hard delete plus S3 purge, and `force: true` orphans live content.

## Attaching media to a content item - know what it does NOT do

`content_media_attach` registers an already-hosted file URL as a media row ON one content item
(JSON only, no bytes - upload/register the file first, then pass the URL). THE TRAP: it does not
change what the published page shows. The publish path maps only
`content_items.featured_image_url` / `featured_image_alt` into the CMS entry and never reads
content_media; no dashboard screen renders these rows - the only readers are `content_media_list`
and `content_get`. If the goal is the hero image on the page, set `featured_image_url` via
`content_update`. Use attach/list as the item's asset manifest - which library assets belong to
which piece, for audits and repurposing - not as page imagery. These rows and the account media
library (`media_library_list`, a different table) never mirror each other: an empty
`content_media_list` does not mean the item has no image.

## Video repurposing (pillar -> short video)

The video lane is approval-gated and paid - treat it accordingly.

- **Multi-scene video ("make me a Reel/TikTok/promo/explainer"):** `marketing_storyboard_create` -
  FREE and fast; it validates, prices, and parks the board awaiting approval; nothing is
  reserved, billed, or enqueued until a human approves. Pass EXACTLY ONE of `storyboard` (a full
  document you authored) OR `template_id` (social-short, product-promo, explainer, testimonial,
  listing-tour, event-promo) with `substitutions`. Then
  `marketing_storyboard_submit_for_approval` - the hand-off, then STOP: tell the user what was
  built (scenes, runtime, estimated cost), ask them to review and approve, and end the turn.
  THE AGENT CANNOT APPROVE OR START THE RUN - only a signed-in human clicking Approve does.
  Do NOT then generate scenes one at a time to work around the gate.
- **Run status:** `marketing_video_pipeline_status` - snapshot of an approved run (per-scene
  state, quota pauses via `paused_until` - the run resumes itself, not a failure, and the final
  media asset once compositing finishes). Check in; do NOT poll in a tight loop.
  `marketing_video_pipeline_start` only re-kicks an ALREADY-APPROVED run that went idle; against
  an unapproved board it returns 409 storyboard_not_approved - that is the correct answer, not an
  error to route around.
- **Single clip:** `marketing_generate_video` - one ~10s 720p clip from a prompt, optionally
  image-to-video from a Media Library image (pair with `generate_image` for a still -> "animate
  this" flow). The clip auto-registers in the Media Library. COSTS: each generation is PAID
  (~$1/clip), Premium-plan only, capped at 20 clips/account/month. ALWAYS call with
  `dry_run: true` FIRST to check `{allowed, used, limit}` before promising a video, prefer
  reusing existing assets (`marketing_media_list`), and NEVER retry a generation that succeeded.
