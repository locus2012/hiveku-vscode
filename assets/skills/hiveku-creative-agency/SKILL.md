---
name: hiveku-creative-agency
description: "Full creative-studio methodology for operating a Hiveku account's visual output. People say: \"make a graphic for the sale\", \"make our social graphics\", \"I need a video for instagram\", \"whip up a flyer\", \"we need a newsletter header\", \"new site images for the homepage\", \"put together a brand kit\", \"resize this for the story\", \"put our logo on it\", \"make it match our colors\", \"send the monthly creative report\". For account work, prefer this over generic design/canvas skills so assets land brand-aware and registered in the account's Media Library. Trigger on ANY design or creative work - design, graphic, ad creative, social graphic, carousel, thumbnail, banner, poster, flyer, brochure, newsletter header, email header, site images, hero image, OG image, brand kit, motion graphic, animated post, video, Reel, TikTok, promo, explainer, testimonial video, listing tour, storyboard, brand assets, logo, brand guide, image generation, stock photo, media library, before/after grids, monthly creative report, and any request to make, edit, restyle, resize, animate, export, or hand off a visual asset. ALSO load for risky creative asks - \"purge the media library\", deleting a brand guide or in-use asset, \"skip the dry run or estimate\", \"render and post everything tonight\", \"just regenerate until the text is right\" - the refusal rules live here."
---

# Hiveku Creative Agency Operating System

Run this account's creative like a studio on retainer: brand loaded before the first pixel, assets reused
before anything is generated, every deliverable landing as something the client can edit, and every
render looked at by you before a human sees it. Every tool named below is a real Hiveku MCP tool.

## 1. The operating model

**Foundation first.** Avatars and grids must exist, be linked, and be valid before creative work: create
with grounding when missing, flag and fix when invalid, name the persona in every brief. Check and
ladder: `hiveku-orient/references/foundation-first.md`; methodology: `references/brand-and-assets.md`.

**Claude is the worker. The Hiveku dashboard is where the human sees and edits.** A flat PNG in chat is a
dead end; creative lands as an **editable, layered design project** with every layer selectable in the
dashboard editor, and you **hand back the `dashboardUrl`** that `design_create` returns. A response that
ends without a dashboard URL has not delivered anything.

**The canvas is Fabric.js JSON** and its layer model is your vocabulary: shapes, text as real textbox /
i-text layers, images, groups, stacking via `objects[]` order. Per-layer motion is
`animation: { enter?, enter_delay_ms?, enter_duration_ms?, enter_distance_px?, easing?, exit?, exit_at_ms?,
exit_duration_ms?, loop? }`. `enter` and `exit` each take one of the 15 presets `fade-in`, `fade-up`,
`fade-down`, `fade-left`, `fade-right`, `scale-in`, `pop`, `slide-up`, `slide-down`, `slide-left`,
`slide-right`, `wipe-up`, `wipe-down`, `blur-in`, `rotate-in`; `easing` is one of `cubic-out`,
`quart-out`, `expo-out`, `back-out`, `ease-in-out`, `elastic`; `loop` is a SEPARATE field taking `pulse`,
`wiggle`, `rotate-slow`, `breathe`, `float`, `shimmer` - a loop value placed in `enter` produces no
entrance at all. Canvas motion is `_animation: { duration_ms, fps, loop }` on the root. THE KEYS ARE
EXACT and an unknown key is ignored in silence: a design saved with the retired keys `preset` /
`delay_ms` / `duration_ms` renders completely static while every tool reports success (full model:
`references/design-canvas.md`). Text and logos are canvas layers, always.

**You can see your own work.** `design_export_image({ id, canvas_json, width, height })` returns a PNG
URL; download it and look at it before a human does. Self-judging is a rule, not a nicety (section 4).
Every server render (export-image, export-mp4, publish, the storyboard's final cut) now sets the
account's custom brand fonts too; a font that fails to load degrades to the fallback stack and says so
as a line in the response's `warnings`, so a 200 with a font warning is a brand-wrong render, not a pass.

## 2. Context first, and there is no creative domain

`account_context_get({ domain: 'branding' })` before any concept, layout, or prompt - it returns persona,
brand voice, avatars, memory, skills, and rules. **There is NO `creative` domain** on either domain-taking
tool; `branding` is the visual-system domain (`website_design`, `customer_avatar`, `before_after_grid` are
the valid neighbors), and an unlisted value is a server-side rejection, not a soft fallback. Concept and
art direction go to `talk_to_department({ domain: 'branding', message })`. If this tenant has no branding
department (`list_departments` says what it has), load a valid domain, draft directly, and say so.

**Key-profile caveat.** `account_context_get` and `agent_identity_get` match no prefix in the
`marketing-design` or `marketing` key profiles - tool-not-found on a scoped key is a scope fact, not an
outage: hydrate through `talk_to_department` plus `brand_guide_get` and `memory_` tools, and say so.

Read the brand system with `brand_guide_list` / `brand_guide_get` before inventing one; write with
`brand_guide_create` / `brand_guide_update` / `brand_guide_set_logo` once the client agrees.
`brand_guide_delete` soft-deletes (flips `is_active`); `brand_guide_purge` hard-deletes an
already-soft-deleted guide and refuses anything still active. Both are destructive: confirm, never batch.

## 3. The decision ladder

Stop at the first rung that fits; rung 3 where rung 1 fits is paying for imagery the account already owns.

**1. Reuse, import, derive.** `media_library_list`, `media_library_get`, `media_folders_list`,
`media_collections_list`, and `design_list` for a design to restyle. The account's real photos beat AI
every time, and generation costs money. Approved testimonials (`marketing_testimonials_list`) are proof
the account already owns. A client image at a URL comes in as BYTES with `media_import_url` (the file
outlives its origin; `media_library_register_external_url` only stores a pointer that dies with it). An
asset at the wrong size is `media_transform` (crop, resize, re-encode; FREE, no quota slot) before it is
ever a regeneration; too small for its slot is `media_upscale` (fal clarity, 1-4x, a 32 output-megapixel
cap), which COSTS TWICE: one `image_generations` slot plus real dollars per output megapixel, billed once
the worker accepts the job even when the output later fails to land. Every op creates a NEW library row
and never touches the source; bytes are immutable (`media_update` refuses `file_url`, `file_path`,
`width`, `height`, `duration`, `ai_metadata` with a 400 `immutable_field`).

**2. One-off image.** A single visual with no copy, no layout, no future edits: `generate_image` for one,
`generate_image_set` for up to 10 prompts on one brand context (per-prompt failures land in `errors[]` -
read it). `media_image_quota` FIRST before any set or upscale: `{ used, limit, unlimited, remaining,
period }`, always a 200; `remaining` is null when unlimited or when the read failed (`reason:
'read_failed'`), and null means UNKNOWN, never "nothing left"; a lapsed period is reported honestly with
`period.lapsed`. Both generators auto-register a media asset and return its id. Both are brand-aware by
default (`use_brand: false` opts out; the set takes a top-level `use_brand` plus `target_width` /
`target_height` that a per-prompt frame REPLACES, never merges) and both SAY whether the brand landed:
`brand_applied` true, or `brand_skipped_reason: 'no_active_brand_guide'` meaning the image is UNBRANDED
and the slot was still spent - tell the client so. A failed brand READ is 503 `brand_unavailable`
before any slot is reserved, never a silent unbranded render. `generate_image` takes exact
`target_width` / `target_height`, and `mode: 'modify'` with `reference_media_asset_ids` (1 to 4 library
ids) edits an existing still. `seed` and `negative_prompt` apply only to the fal models (`flux`,
`flux-pro`, `recraft`); the default gemini lane rejects them rather than silently dropping them. Prompts
name photographic subjects only - generated text and logos are garbage, so words are a rung 3 layer.
`media_ai_enhance_prompt` COSTS MONEY, writes nothing - batch use only.

**3. Editable design project.** The default for anything the client will ever tweak: social graphics,
carousels, thumbnails, banners, ad creative, newsletter headers, one-pagers. `design_templates_list`
first - 58 templates across 14 sizes, already brand-substituted with the account's brand guide, plus
artboard presets, each carrying a `canvasData` payload you pipe into `design_create`'s
`initialCanvasData`; the wide formats are templates now (two 1200x600 email headers, OG 1200x630,
YouTube 1280x720, LinkedIn banner 1584x396, X header 1500x500), filed under their categories. Then
`design_create({ title, designType, artboard, initialCanvasData, description, tags })` and hand back the
`dashboardUrl`. A carousel is N sibling designs (`design_list` is the grouping read) or one multi-page
design whose `canvasData` is `{ pages: [{ id, name, canvasData }] }`, read per page with
`design_state_get({ id, page_id })`. `design_from_testimonial` opens a free draft on an approved clip.

**4. Motion design.** Branded cards, type, and layout that move: same design project plus the section 1
`animation` and `_animation` fields, rendered with `design_export_mp4` (MP4 or GIF). No generation cost,
output matches the in-editor preview; SYNCHRONOUS, blocks up to 280s, refuses on an empty canvas - say so
first. On a dead call the JOB survives: poll the returned `jobId` with `design_render_job_get` before ever
re-rendering. `design_voiceover_estimate` prices free; `design_voiceover_create` SPENDS MONEY (`references/video.md`).

**5. Multi-scene video.** Reel, TikTok, promo, explainer, testimonial, listing tour - anything with more
than one shot. `marketing_storyboard_create` is FREE AND FAST: it validates, prices, and stores, and
NOTHING is reserved, billed, or enqueued until a human approves. Then
`marketing_storyboard_submit_for_approval` and STOP (Play 6).

**6. Stock.** Only when the account owns nothing usable and generation is wrong for the subject. Three
searches, none saving anything: `stock_photos_search` (Unsplash + Pexels), `stock_photos_pixabay_search`
(the only Pixabay source, the only illustrations/vectors), `media_stock_video_search` (the only stock
FOOTAGE search) - all fail silently as partial catalogs: read `providerErrors` / the HTTP status, report
a failed provider as PARTIAL, never "nothing matched". `stock_photos_download` is the WEBSITE-PROJECT
lane only (into that project's S3, NOT the library); the library path is `media_library_register_external_url`.

No tool covers these, so do not promise them: nothing **draws** a logo (`brand_guide_set_logo` stores one
the client supplied); nothing approves a storyboard or a post; nothing sources music; nothing trims,
crops, or concatenates an arbitrary MP4 (`media_transform` is stills only). Attaching IS covered: a
finished creative goes on a post via `media_urls` plus index-aligned `media_types` on
`social_create_post`, or onto an existing or scheduled post with `social_update_post`, which REPLACES
the post's media list wholesale (send the full list) and 400s on a published post.

**Replacement ad creative has a rung zero: the performance read.** "Our ads are tired" starts at
/hiveku:ad-refresh, which classifies each loser (weak_hook, weak_hold, fatigue, offer_or_lp, structure)
and hands this skill one rebrief per loser naming the angle to retire and the number that condemned it.

## 4. Round-trip discipline and doctrine

The human edits the same canvas you write to. `design_update` with `canvasData` REPLACES the canvas
wholesale and the dashboard editor reads that same column, so a blind full-canvas write over someone's
afternoon of edits destroys it silently. The read half is always `design_state_get` (compact per-element
summary plus `featuredImageUrl` when a preview exists; `design_get` only for raw Fabric JSON) -> reason
-> `design_update` with `expectedSectionsVersion`. The reads screen inline payloads: a `data:` thumbnail
comes back as `featuredImageUrl` null with `featured_image_inline: true` (a thumbnail exists, only
inline; the real URL is `design_publish_to_library` with `set_as_featured`), and `design_state_get`
shows an inline image `src` or pattern fill as `[embedded image]`. Both reads return the token: `design_state_get`
and `design_get` carry `sectionsVersion`, so the read you plan from already holds it. A later
`design_update` response (`sectionsVersion`) or a 409's `serverVersion` refreshes it. A 409
`sections_version_conflict` means someone saved between your read and your write, and its
`serverCanvasData` is the live canvas - re-apply your change to THAT, write again with the 409's
`serverVersion` as the new token, never retry the same body. Snapshot before anything large or destructive with `design_version_create`;
`audit_query` proves who wrote what. Removing a design is a metadata-only
`design_update({ id, status: 'archived' })`; there is no design delete tool, by policy. A parallel
`marketing_design_*` naming exists, read-and-export only; which names a session sees is a KEY-PROFILE
question (the `marketing-design` profile grants both prefixes). Prefer `design_*`.

**Doctrine (the nine rules this discipline runs on):**

1. **Editable beats flat.** If the user will ever tweak it, it is a design project. Hand back the
   `dashboardUrl` every time.
2. **Round-trip, never clobber.** `design_state_get` -> reason -> `design_update` with
   `expectedSectionsVersion` (the read's `sectionsVersion`; a later update response or a 409
   refreshes it). On 409, re-apply onto `serverCanvasData`.
3. **Snapshot before destructive edits** with `design_version_create`.
4. **THE AGENT CANNOT APPROVE: after creating, submit for approval and stop.** That gate is a feature.
   Never assemble scenes from single `marketing_generate_video` clips to route around it.
5. **Self-judge before handoff.** `design_update` -> `design_export_image({ id, canvas_json, width,
   height })` -> download the PNG and LOOK at it (you are multimodal) -> check hierarchy, contrast,
   margins, overflow, brand tokens -> fix -> re-export. Read the response's `warnings` every time: a
   custom brand font that could not load degraded to the fallback stack, and the fix is the font row
   (`brand_guide_font_update` with a valid `css_font_face`), not the canvas. Two or three passes, then
   hand off naming what still needs a human eye. Motion: frames 0, mid, last before any MP4
   (`references/self-review.md`).
6. **The thumbnail is yours to set.** `featuredImageUrl` is NOT auto-set: no gallery thumbnail until
   `design_publish_to_library({ id, set_as_featured: true })` or a metadata-only `design_update`. A read
   that answers null plus `featured_image_inline: true` is an inline editor snapshot, not a missing
   thumbnail; the same publish call is what replaces it with a real URL.
7. **Register what does not auto-register.** Generated images and clips auto-register; design exports and
   stock URLs do NOT. `design_publish_to_library` is the one-call PNG publish and it is CREATE, never
   sync: no dedupe, once per finished design, never a blind retry.
8. **Reuse before generating.** No estimate, no voiceover; no dry run, no clip.
9. **Confirm before anything irreversible or billable**, and say what you are doing before a 280s render.

## 5. Plays

### Play 1: Social creative set

Trigger: "make our social graphics", a campaign batch, a carousel. Rung 3, siblings sharing one system.
1. `account_context_get({ domain: 'branding' })`, `brand_guide_get`, `media_library_list` for real
   photos; `design_templates_list` for a Social Media template and preset (1080x1350 default; 1080x1080
   square feed; 1080x1920 Stories).
2. Confirm the outline first - five slides is hook, three value beats, CTA; copy through
   `talk_to_department({ domain: 'social' })` or `{ domain: 'content' }`.
3. One `design_create` per slide (or one multi-page design), the template `canvasData` as
   `initialCanvasData` with text and imagery swapped; titles carry order, tags identical;
   slide-invariant layers (margin, logo `left` / `top`, `fontSize`, background) stay BYTE-IDENTICAL.
4. Self-judge each slide with `design_export_image({ id, canvas_json, width, height })`; view all five at
   thumbnail size side by side; fix and re-export, at most three passes.
5. `design_publish_to_library({ id, set_as_featured: true })` once per finished slide, in order; keep
   every `mediaAssetId` and `fileUrl`. Resize variants are sibling designs re-laid-out, never stretches.
Benchmarks: three hierarchy levels; margin 6-8% of the short edge; body text 28px+ on 1080; contrast
4.5:1 body / 3:1 large; one accent color per slide, on the thing you want tapped.
Exit: `dashboardUrl` per slide in order, registered asset ids, one memory line. Delivery is the social
lane's call under its own confirm rules: `social_create_post` with the `fileUrl`s as `media_urls` plus
index-aligned `media_types` (`image/png` here), or `social_update_post({ post_id, media_urls,
media_types })` onto a post already drafted or scheduled - it replaces the whole media list, so send
every URL the post should carry, and a published post is edit-locked (400).

### Play 2: Email newsletter header

Trigger: "we need a header for the newsletter". Rung 3, a 1200x600 artboard that renders at HALF width in
most email clients, so nothing on it may be smaller than it would be at 600 wide.
1. Brand load as in Play 1; `design_templates_list`, pick from the Email Header category (two 1200x600
   templates live there: photo-led with a scrim, and typographic), then
   `design_create({ title, designType, artboard: { width: 1200, height: 600 }, initialCanvasData })`.
   One idea, one line of type, one image, the logo as a layer, everything inside a 72-96px margin.
2. Self-judge: `design_export_image({ id, canvas_json, width: 1200, height: 600 })`, then view the PNG at
   half size - if the subhead is not readable there, it is not readable in the inbox.
3. Publish ONCE: `design_publish_to_library({ id, set_as_featured: true })`. `fileUrl` is the permanent
   public URL, `mediaAssetId` the library row. A second publish is a second asset.
4. Hand both to the email lane: a campaign template is `marketing_template_create` with a `layout_json`
   `image` or `hero` block pointing at the `fileUrl` - NOT `email_template_create`, the transactional
   store a campaign cannot use. The campaign itself is /hiveku:email's job, with its own gates.
Benchmarks: 1200x600; 28px body / 72px headline minimums; one CTA at most; alt text via `media_update`.
Exit: `dashboardUrl`, `mediaAssetId`, `fileUrl` handed to the email lane, memory line with the design id.

### Play 3: Site asset pack

Trigger: "new site images" - hero, OG image, blog thumbnails, a LinkedIn banner. Rungs 1 then 2; text
never goes into a generated image, so a hero with a headline is rung 3 exported at the slot size (the
OG 1200x630, YouTube 1280x720, LinkedIn 1584x396 and X 1500x500 templates are the starting canvases).
1. Reuse first: `media_library_list`, `media_collections_list`; the client's real premises and products
   win. Read the page's actual slot dimensions before generating anything. A real photo at the wrong
   size is `media_transform({ asset_id, resize: { width, height, fit: 'cover' } })` - free, a new row -
   not a regeneration; a client photo still on their site is `media_import_url` so the bytes are ours.
2. `media_image_quota` for the batch, then generate at exact dimensions: `generate_image({ prompt,
   use_brand: true, target_width, target_height })` per slot, one photographic subject per prompt, no
   words. Defaults when the page does not say: hero 1920x1080, OG/share 1200x630, blog thumbnail
   1200x800, LinkedIn banner 1584x396. `mode: 'modify'` with `reference_media_asset_ids` when a real
   photo needs a background or an extension rather than an invention. `generate_image_set` for a matched
   batch with the top-level `target_width` / `target_height`; read `errors[]` and every row's
   `brand_applied` - `no_active_brand_guide` means unbranded output, say so.
3. Judge every output like a canvas: fetch and view it, reject rendered text, extra fingers, wrong brand
   mood. File it: `media_folder_create` per site or campaign, `media_update` for title, alt text, tags.
   A keeper that is too small for its slot is one confirmed `media_upscale` (slot plus dollars per
   output megapixel), never a blanket pass over the folder.
4. Store split: the Media Library and a website project's asset store are SEPARATE. A page needs the file
   in the project - download the library URL and `assets_upload({ project_id, file_path:
   'public/images/<name>.jpg', content })`, `project_id` from `sites_list`, NOT from `list_projects`.
   Moving between stores is always download plus re-upload; nothing syncs them.
Benchmarks: exact slot dimensions, never crop-and-hope; subject centered for platform re-cropping; one
generation pass per slot before rebriefing the prompt, not three blind retries.
Exit: asset ids by slot, the project paths written, the web lane told which files landed, a memory line.

### Play 4: Brand refresh or new-brand setup

Trigger: "we rebranded", "set up the brand kit", a new account with no guide. The full first-hour ladder
is `references/brand-and-assets.md` Part 4; this is the shape.
1. `brand_guide_list` then `brand_guide_get`: an existing guide makes this a refine job, never a rival
   second guide. Collect real values from the client or their site; never invent a hex or a typeface.
2. Assets in first: `media_folder_create` skeleton, `media_upload` the logo lockups, then
   `brand_guide_create` or `brand_guide_update` with the agreed palette and type, `brand_guide_set_logo`
   pointing at the library asset. Fonts: `brand_guide_font_create`, and only `css_font_face` is
   rendered - now in server exports too, so it is load-bearing: nothing but `@font-face` blocks, every
   `url()` an http(s) URL without credentials or a `data:` font, no `@import`, no CSS escapes. The
   create route stores it verbatim; the render worker screens it and drops a bad rule with a
   `warnings` line, so prove a new font with one `design_export_image` and read `warnings`.
3. Prove substitution: `design_templates_list`. The client's colors and type coming back on the templates
   is the only proof the guide is live. Generic templates mean fix the guide, not the canvases.
4. Restyle existing designs one at a time: `design_state_get` inventory of every `fill`, `stroke`,
   `fontFamily`; a mapping table (old hex to new, old family to new) the client says yes to;
   `design_version_create({ isMilestone: true })`; mutate color, stroke, font only; recompute the logo
   layer's scale; re-check contrast; `design_update` with `expectedSectionsVersion`; self-judge.
5. One proof artifact from a substituted template, handed back as a `dashboardUrl`.
Benchmarks: 60/30/10 dominant/secondary/accent; every pairing re-checked at 4.5:1 after a palette swap;
one restyle pass per design (re-layout is a second, separately confirmed edit).
Exit: guide id, logo asset ids, restyled design URLs, branding memory updated with palette, type and logo
rules, `pm_tasks_create` for gaps (missing lockups, font licensing, photo shoot).

### Play 5: One-shot video ad

Trigger: "a short clip for the ad", "animate this photo". Lane decision first: type, layout, price, or
logo is rung 4 (`design_export_mp4`, free, editable) and beats a paid clip every time; only a single shot
of something that cannot be drawn earns the paid lane.
1. `design_video_capabilities_get` (free, no arguments): read `videoEnabled`, never the HTTP status -
   every blocked reason is a 200, and `cap_check_unavailable` is transient, not a quota verdict.
2. Reuse: the still to animate is usually already in the library - `media_library_list` first.
3. `marketing_generate_video({ prompt, aspect_ratio, dry_run: true })` for `{ allowed, used, limit }`.
   Tell the client the remaining quota before spending one.
4. Confirm the spend: prompt, aspect ratio, `duration_seconds` (2 to 10, the cost lever at roughly $0.10
   per second; a HINT that lanes snap - the default Kling lane renders only 5s or 10s, the fal Veo lanes
   4/6/8s - and billing follows the rendered length), cost, quota after. Then generate with
   `reference_media_asset_id` plus `reference_mode` (`'animate'` moves the still; `'compose'` first
   builds a branded reference still, spending one image credit and failing fatally rather than
   silently; a failure body then carries `composed_still_asset_id`, already paid for, so retry by
   animating THAT) and `design_project_id` when the clip belongs to a design. `previous_interaction_id`
   only ever carries an `interaction_id` a previous response returned to THIS account; anything else is
   a 400 `invalid_request`, and a garbage `seed` is a 400 too, never a silent seed 0.
5. Blocks 30-90s; the clip auto-registers. Report the length honestly: `duration_effective` is the
   worker-measured length (null when unmeasured, never 0), `duration_requested` echoes the hint, and
   `duration_note` says when the lane snapped it. On a timeout, `design_render_job_get({ job_id })` with
   the returned `render_job_id` BEFORE any second spend (the poll advances the job and can finish the
   registration itself); lost the id, `design_render_jobs_list({ kind, status })` finds it - a plain read
   that advances nothing. NEVER retry a generation that succeeded.
Benchmarks: about $1 per clip, 20 per account per month; one good prompt beats three retries.
Exit: the asset id, the design `dashboardUrl` when linked, and the spend ledger line (clips used, clips
left, what for) appended through section 9.

### Play 6: Multi-scene storyboard video

Trigger: "make me a Reel / promo / explainer / listing tour". Rung 5, and the human gate is the product.
1. `marketing_video_pipeline_list` first: an existing board for this brief means revise it, not draft a
   duplicate. Rows are summaries (`pipelineId`, `status`, `progress`, `designProjectId`, `sceneCount`,
   `approvedAt`, `resultMediaAssetId`); it never ships the storyboard document and approves nothing.
2. Brand and script: `account_context_get({ domain: 'branding' })`, scene copy through
   `talk_to_department`, narrator from `brand_guide_voiceovers_get` (approved only, send the `voice_id`).
3. `marketing_storyboard_create` with EXACTLY ONE of `template_id` plus `substitutions` or a hand-authored
   `storyboard`; `design_project_id` links it to a design. Free: it validates, prices, stores.
4. Fix `validation.errors` field by field with `marketing_storyboard_update` (full replace) or
   `marketing_storyboard_set_look` (by name); never delete and recreate. Every edit clears approval.
5. `marketing_storyboard_submit_for_approval({ storyboard_id })`, then report scenes, runtime, the price
   the create call returned as the amount billed on approval, and the dashboard card. Then STOP. Record
   the storyboard id in the branding memory ledger (section 9) the same turn.
6. After a human approves: `marketing_video_pipeline_status` checks in (no tight loop),
   `marketing_video_pipeline_retry_scene` re-runs exactly one FAILED scene,
   `marketing_video_pipeline_cancel` stops a run. The run has ears: reaching `completed` or `failed`
   files ONE agent-ops inbox item (category `design.video_completed`, or `design.video_failed` at
   severity urgent) carrying `pipeline_id`, `design_project_id` and `result_media_asset_id` in its
   metadata - `agent_inbox_list({ category })` finds it (full or `marketing` key; the `marketing-design`
   profile does not see `agent_inbox_`, so there the check-in read is the ears). Verify in
   `media_library_list` before saying it exists.
Benchmarks: priced at create, billed at approval; one board per brief; voiceover estimate-first.
Exit: storyboard id in the ledger, the approval card URL, a `pm_tasks_create` reminder when the approver
is offline. An unapproved board is a deliverable that is not shipping, and that is the client's call.

## 6. Benchmarks (defaults - account memory overrides)

- Hierarchy: three levels (hook, support, action); demote the competitor, do not enlarge the winner.
- Margin: 6-8% of the artboard's short edge (64-88px on 1080); one spacing unit, every gap a multiple.
- Type on 1080: headline 72-120, subhead 40-56, body 28-36, caption floor 20-24. Email header body 28+.
- Contrast: 4.5:1 body, 3:1 large text, measured against the range behind the text, not the average.
- Motion: entrances staggered 100-200ms; the last `enter_delay_ms + enter_duration_ms` lands by about 60%
  of `_animation.duration_ms` with at least 800ms of hold; two loops on one artboard is already noise.
- Renders: keep `design_export_mp4` at or under 20s, 1080p, 30fps before splitting into two designs.
- Spend: clip about $1, 20 per account per month; storyboard priced at create, billed at approval;
  voiceover estimate before create; images metered per account (`media_image_quota` before a set or an
  upscale; an upscale is a slot plus $0.03 per output megapixel); every generation logged the same
  turn it happens.
- Sweeps state their N: designs checked, comments read, boards found, what was skipped and why. A design
  whose reads failed is UNKNOWN, never clean.

## 7. Weekly cadence and the monthly report

**Weekly sweep (one session, in order).**
1. The ears first: `agent_inbox_list({ category: 'design.comment' })` - a client comment on a design
   files one open item per design and thread (metadata `design_project_id`, `comment_id`,
   `thread_root_id`, `dashboard_url`), and it is never agent-authored. Then `design_list({ status:
   'draft' })` for designs left mid-revision and `design_comments_list` per active design, filtering
   `isResolved` yourself (resolved threads come back too; a 404 is a wrong id, not an empty thread).
   Fix, then `design_comment_resolve` only what is fixed - one way, parent not reply - and
   `agent_inbox_resolve` the item only after the thread is actually handled (it closes the row, nothing
   more). On a `marketing-design` key `agent_inbox_` is tool-not-found: the per-design read is the sweep.
2. `agent_inbox_list({ category: 'design.video_failed' })` and `design.video_completed` for runs that
   finished unwatched, then `marketing_video_pipeline_list` for boards awaiting approval or paused
   mid-run, reconciled against the memory ledger; chase approvals with `pm_tasks_create`, never with a
   workaround.
3. `design_render_jobs_list({ status })` for renders that died between export and registration; a null
   `assetId` on a completed job is an unregistered export.
4. Register the week's unregistered exports and stock URLs, check the spend ledger (clips of 20,
   voiceover seconds, `media_image_quota` for generations used of limit), state the N for every step,
   and log the sweep to the PM task.

**Monthly report** (markdown to reports/creative-YYYY-MM.md, linked in the PM task):
1. Assets shipped by type - designs, exports, generated images, clips, boards - each with its asset id.
2. Designs delivered vs awaiting approval, and the unresolved `design_comments_list` count per design.
3. Spend ledger: clips used of 20, voiceover seconds against the allowance, image generations
   (`media_image_quota` `used` of `limit` plus `period.resets_at`; a null `remaining` is UNKNOWN, so
   the line says so), upscales with their megapixels. Every number traces to a tool call or a ledger
   line, never to a model prior.
4. Library hygiene delta: assets filed vs loose in root, `media_bulk_move` batches, duplicates found
   (proposed for archive, never deleted by pattern).
5. Proof refresh: `before_after_grid_list`, plus the grids populated or avatar-linked this month.
6. Next-month plan: ranked, each item with its lane and its spend needing approval.
State the window, N, and exclusions per section; a failed source makes the report PARTIAL, said in the
summary. Close with the owner update and the section 9 write-back.

## 8. Onboarding arc (first session on any account)

1. `get_account_info`, then `list_departments`: does this tenant have a branding department at all.
2. `brand_guide_list`: a guide present makes this a refine job (Play 4); presence is not activation.
3. `media_library_list` and `media_folders_list`: the library usually holds more than the client recalls.
4. `account_context_get({ domain: 'branding' })` (scoped key: section 2), then the foundation-first check.
5. `design_templates_list`: client colors and type on the templates proves the guide substitutes.
6. One proof artifact: a substituted template into `design_create`, self-judged, published once with
   `set_as_featured`, handed back as a `dashboardUrl`.
7. Initial branding memory document (section 9) and `pm_tasks_create` for every gap: missing lockups, no
   guide, unlinked grids, unregistered footage, fonts without `css_font_face`.
Do not generate, render, or spend in the onboarding session beyond the one proof artifact.

## 9. Memory write-back (the three-line rule)

1. Department memory is the `branding` document: `memory_list({ domain: 'branding' })` -> merge your
   lines into the returned `content` -> `memory_update({ memory_id, content })`. `memory_create({ type:
   'memory', name: 'branding', content })` exactly once per account; 409 means it exists, so update.
2. What goes in, dated, five to ten lines a session: storyboard ids submitted and their state, clips used
   of 20, voiceover seconds, generations, approved narrator `voice_id`s, palette and type decisions,
   design ids delivered, open client decisions. No PII, ever.
3. Local mirrors (`memory/<dept>/` from `/hiveku:knowledge`; `hiveku-data/creative/` and
   `hiveku-data/media/` from `/hiveku:pull`) are read-only snapshots: write through the tools, then
   re-pull. Mechanics, recovery, and the ledger format: `references/memory-protocol.md`.

## 10. Hard stops (response contracts, not suggestions)

- "The client's offline tonight - just approve the storyboard and start the render so it's done by
  morning." -> Refuse: only a signed-in human clicking Approve can, deliberately - approval is the
  billing moment. Offer the approval card link and a `pm_tasks_create` morning reminder. Do not assemble
  the same video from single `marketing_generate_video` clips; that is the same bypass, worse.
- "Clean out the media library - delete anything we haven't used this quarter." -> Refuse pattern-derived
  deletion: targets come only from explicit ids the client named. Offer a review list from
  `media_library_list` with `media_usage_get` per candidate, and `media_bulk_move` to an "archive"
  folder. A 409 `in_use` from `media_delete` is the system working - never pass `force=true` yourself.
- "Skip the dry run, we know we want all 20 clips." -> No. Clips are about $1 on a 20-clip monthly cap;
  `design_video_capabilities_get` and `dry_run: true` cost nothing and are the only honest quota quote.
  The confirm covers prompt, aspect ratio, duration, cost, remaining quota - per spend, not per session.
  Images the same way: `media_image_quota` before a `generate_image_set`, and "just upscale the whole
  folder" is refused - each `media_upscale` is a quota slot plus real dollars, one confirmed asset at
  a time, after `media_transform` (free) has been ruled out.
- "Just regenerate the image until the text is right." -> Refuse the loop: generated text and logos are
  garbage by nature and every pass is a paid roll of the dice. Text and logos are canvas layers - put
  the image on a design project, set the words as textbox layers and the logo as an image layer, export.
- "Delete the old designs so the gallery is clean." -> There is no design delete tool, by policy.
  `design_update({ id, status: 'archived' })` per named design, confirmed, is the removal verb.

## 11. Pitfalls (verified against the tool surface)

- **Dead animation keys render static.** `preset` / `delay_ms` / `duration_ms` are not read by the
  renderer; unknown keys are ignored in silence and the MP4 is a still. Section 1 has the real fields.
- **Exports do not auto-register.** `design_export_image` and `design_export_mp4` output has no asset id
  until `media_library_register_external_url` (or `_batch`); generated images and clips do.
- **`design_publish_to_library` never dedupes**, times out at 90s with no job handle, and each call is a
  permanent S3 object plus a library row. Once per finished design; `media_library_list` before a retry.
- **Blind canvas overwrite.** `design_update` with `canvasData` replaces everything; without
  `expectedSectionsVersion` a concurrent human edit is lost with no error to either side.
- **`previewVideoUrl` only fires when `canvasData` is omitted** - always a second, metadata-only
  `design_update` after a render; sent alongside a canvas it silently does not take.
- **The 10MB body cap.** Base64 image `src` values blow it in three photos; reference library URLs.
- **`design_render_job_get` ADVANCES the job** - it runs the reconcile step and can finish and register
  a paid render, so it is not a read-only poll and may prompt; call it deliberately, never in a loop.
  Lost ids: `design_render_jobs_list` for renders (filter status, kind, `design_project_id`),
  `marketing_video_pipeline_list` for boards - plain reads that spend and approve nothing.
- **`featuredImageUrl` is not auto-set** - no thumbnail until `set_as_featured` on publish or a metadata
  `design_update`; the publish response carries `featured_image_error` when the render succeeded but the
  thumbnail write failed, so read it. And null with `featured_image_inline: true` on `design_list`,
  `design_get` or `design_state_get` is an inline editor snapshot screened out of the response, not a
  missing thumbnail - do not "fix" it with a metadata write; publish with `set_as_featured`.
- **A font warning is a brand-wrong render.** Custom brand fonts render server-side from
  `css_font_face`; a rule the worker cannot use (anything but `@font-face` blocks, a non-http(s) or
  credentialed URL, a CSS escape, an empty `url()`, over 512KB or the 40-face cap) is dropped and the
  layer falls back, reported only as a line in `warnings` on a 200. Read `warnings` on every export and
  publish; fix the font row, then re-export.
- **`media_upscale` bills at submit.** A 503 `provider_unavailable` whose `details.stage` is poll,
  render or timeout, or a client-side timeout, is a job fal has usually already been paid for: check
  `media_library_list` (newest, title ending `(upscaled)`) before calling again. Its quota refusal is
  402 `quota_exceeded`; the generate tools answer 429 `budget_exceeded` on the same counter.
- **`remaining: null` is not zero.** `media_image_quota` answers null when the plan is unlimited or the
  read failed (`reason: 'read_failed'`); neither is "nothing left", and neither is "go ahead".
- **Stock searches save nothing**, `stock_photos_download` writes to a website project, and the
  `marketing-design` key profile sees neither `sites_list` nor the website-project reads - say so
  instead of guessing a `project_id`.
- **`design_*` vs `marketing_design_*` is key-profile**, not account state. Prefer `design_*`.
- **`design_export_image` does not render a stored design from its id alone** - `{ id, canvas_json,
  width, height }` are all required - and a `{ pages: [...] }` design read without `page_id` is not an
  empty canvas: pass `page_id` to `design_state_get` and `design_publish_to_library`.

## 12. Reference map

| Reference | Load it when |
| --- | --- |
| `references/design-canvas.md` | Before creating, editing, restyling, animating, or exporting ANY design: the layer model and every animation field, artboard and safe-area sizes per channel, the 58-template library and the six wide formats, composition, carousels and multi-page, the comment loop and its inbox ears, export with its `warnings` channel and budgets, publish-to-library, versioning, the attach-to-post handoff, and the worked canvas plays. |
| `references/video.md` | Before ANY moving picture: the three lanes and their costs, storyboard shape and the approval gate, voiceover pricing and approved narrators, render-job recovery, the pipeline after approval and its inbox ears, the paid single-clip lane with its dry-run discipline and duration honesty, attaching the finished clip to a post, the testimonial polish play. |
| `references/brand-and-assets.md` | Standing up or refreshing a client's brand system (Part 4 is the full first-hour ladder), custom fonts that render and what `css_font_face` must contain, the Media Library model (folders, collections, bulk moves, registration, immutable bytes, usage checks before deletion), the quota pre-flight, the import / transform / upscale lanes and their costs, brand-applied honesty, avatars, stock sourcing and attribution, before/after grids. |
| `references/memory-protocol.md` | Before ANY `memory_create` / `memory_update`: read-merge-write on the `branding` document, recovery, the storyboard-id and spend ledger format (clips, voiceover seconds, image generations and upscales), approved narrator voice ids. |
| `references/self-review.md` | Before handing off any design or render: the see-and-judge protocol, the written checklist, the download-and-view mechanics, reading `warnings` for font degrades, the pass limit, and the motion frame check (0, mid, last) before an MP4. |
