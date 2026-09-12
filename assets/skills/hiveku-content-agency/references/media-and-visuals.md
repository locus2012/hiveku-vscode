# Media registration, visuals, and video

Load this file before generating, registering, attaching, or deleting any media asset, and
before any video work (clips, Reels, storyboards).

## Article images - `content_images_generate({ content_id, max_images?, model?, quality?, hero?, sections?, plan? })`

The one call that gives a long-form piece its hero and its section images. Run it AFTER the
draft is on its row (the body is read from the stored row, never from your chat) and BEFORE
the Play 3 gate and the publish. Route: `POST /api/olympus/marketing/content/:contentId/images`;
the marketing editor's Generate images action runs the same pipeline.

What it does, in order: plans one hero (when the row has no `featured_image_url`, or `hero:
true`) plus at most one image per H2 that does not already carry an image directly below it -
only where a picture adds information the words do not - from the title, the excerpt, the
row's grounding (avatar, journey stage, target keyword, the before/after transformation) and
the account's brand image profile; renders the hero first at 1600x900, then every section
image with the brand references and the hero as reference images so the set reads as one;
registers each in the Media Library with its alt, prompt and model under the tags
`ai_generated`, `content_image` and `content:<content_id>` (so `media_library_list({ tags })`
lists a post's images); writes each section image directly under its heading (markdown or
HTML, whichever the body is) and sets `featured_image_url` / `featured_image_alt` when a hero
was made. Insertion is idempotent: a heading that already has an image is left alone and named
in `warnings[]`.

Body (all optional): `max_images` 1 to 8, default 4, hero included; `model` one of
`gpt-image-2.5` (the default, GPT Image 2.5), `gpt-image-2.5-sunburst`, `gemini-3.1`,
`gpt-5.4`; `quality` `standard` | `high`, or one of the GPT Image qualities `low` | `medium` |
`high` | `xhigh` | `max` | `auto`; `hero` (boolean; default: a hero when the row has no featured
image); `sections` (boolean, default true); `plan` `{ hero: { alt, prompt } | null, sections:
[{ heading, alt, prompt }] }` to skip the planner - every `heading` must be an H2 without an
image, or the answer is 400 `invalid_plan` naming the offenders.

Response `data`: `content_id`; `plan` (what was planned: `hero` and `sections[]`, each with
`alt` and `prompt`); `images[]` as `{ url, alt, heading, anchor, asset_id, role: 'hero' |
'section' }` (`asset_id` null means the image is hosted and placed but registration failed);
`warnings[]`; `content` (the body after insertion); `content_changed`; `featured_image_url`,
`featured_image_alt`, `featured_image_changed`; `brand_applied`; `brand_reference_ids`;
`allowance` `{ used, limit, remaining }` (`remaining` null on an unlimited plan); `updated_at`.

The money and the honesty:

- **Read the allowance first.** `media_image_quota` before the call, and quote it: each image
  is one slot from the same monthly counter every other image lane debits. The route answers
  402 `quota_exhausted` `{ remaining: 0, used, limit }` before anything is planned when nothing
  is left; a run that hits the allowance part-way answers 200 with the images it made and a
  warning (`Image allowance exhausted: n of m planned images were generated`). Confirm the
  count with the user before spending - the creative skill's rule R8 applies here too.
- **A failed render refunds its slot** and the run moves on: the hero failing costs the
  sections their style reference, not their existence. 503 `brand_unavailable` (the guide
  could not be read), `planner_unavailable` and `planner_bad_response` refuse before any spend.
- **Alt text is mandatory, and it is yours to check.** The plan writes one plain sentence per
  image saying what it shows (no "image of", no keyword list); read `images[].alt` and the
  row's `featured_image_alt` back and fix any that reads like a filename with `content_update`
  before `content_seo_check` runs - `inline_image_alt_missing` and `hero_alt_missing` are
  errors there.
- **Brand honesty.** `brand_applied` false means no active guide: the images went out
  unbranded and the handoff says so. `brand_reference_ids` lists which brand references
  reached the model (the primary logo as `logo_primary`, then the Media Library images tagged
  `brand_reference`); a reference that could not be fetched is a `warnings[]` line, never a
  silent drop.
- **It bills before it answers.** The route runs up to 300 s. On a timeout do NOT call it
  again blind: `media_library_list({ tags: ['content:<content_id>'] })` and `content_get`
  show what landed, and a second run skips the headings that already carry an image.
- One run per piece; a longer post gets a second run with `max_images` raised, not a
  slideshow. Words never go into a generated picture (the plan forbids text and logos in the
  image); a diagram or a captioned graphic is the Creative Studio lane.

## The brand image profile - `brand_image_profile_get({ project_id? })`

What every branded generation now sends, readable so a brief can be checked against it:
`prompt_block` (plain sentences: brand name and industry, personality and visual adjectives,
the full palette with hex codes and gradients, typography for any text the image carries,
photography / illustration / icon style and rules, logo rules, the AI prompt rules),
`avoid_list` (the guide's `ai_forbidden_phrases` plus the don'ts inside the imagery rules and
`brand_is_not`), `reference_images` as `{ id, url, role }` (the primary logo first, role
`logo`, id `logo_primary`; then up to three Media Library images the customer tagged
`brand_reference`, role `brand`, id = the media asset id, newest first) and `reference_tag`
(`brand_reference`). 404 `no_active_brand_guide`; 503 `brand_unavailable`. A customer marks
approved brand imagery by tagging a Media Library image `brand_reference` - `media_update({
asset_id, tags })`, or the dashboard tag editor; only the three newest ride on a generation, so
re-tagging is how a newer image is promoted. Route: `GET
/api/olympus/marketing/brand/image-profile?project_id=`. Doctrine and the generation lanes:
`hiveku-creative-agency/references/brand-and-assets.md`.

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
