# The Layered Design Canvas

This is the manual behind the creative skill's one-line advice about designs. It covers the Fabric.js
object model a Hiveku design is made of, composing an artboard that reads at thumbnail size, the
read-then-write round-trip that keeps a human's edits alive, versioning before destructive work, starting
from the template library, artboard sizing per platform, exporting frames and MP4s, and the failure modes
that make a design silently wrong. Load it before you create, edit, restyle, animate, or export ANY
design, and before you promise a client a carousel, a Reel, or a branded graphic.

Why it needs a manual: this is the one place where Claude and the human write to the SAME object, the
`canvasData` column. A careless write does not error; it silently destroys an hour of someone's work.

## Part 1: The non-negotiables

- **D1. Editable beats flat.** If the user will ever want to tweak it, it belongs in a design project
  (`design_create`), not a one-off PNG from `generate_image`. Hand back the `dashboardUrl` every time.
- **D2. This is the read half of the round-trip: always state_get -> reason -> update. Never author a
  full canvas blind over the top of a user's edits.**
- **D3. Snapshot before destructive edits** with `design_version_create`, so the user can roll back from
  the dashboard's Version History panel. Restyles, re-layouts, deletions, and artboard changes count.
- **D4. Start from `design_templates_list`, not a blank artboard.** Its 58 templates come back
  brand-substituted with the account's active brand guide. A blank artboard means you pick the colors and
  fonts, which means off-brand.
- **D5. Generated images and video clips auto-register. Design exports and stock-photo URLs do NOT -
  register those explicitly before attaching them anywhere.**
- **D6. Confirm before anything billable or blocking.** `design_export_mp4` blocks up to 280s and
  `design_video_rerender` 240s; `generate_image`, `generate_image_set` and `media_upscale` cost money
  (`media_image_quota` is the free quote first).
- **D7. THE AGENT CANNOT APPROVE: after creating, submit for approval and stop.** A multi-scene video is
  `marketing_storyboard_create`, not this lane, and it stops at the human gate.
- **D8. One write path, one token.** `design_update` with `canvasData` REPLACES the canvas wholesale.
  There is no per-layer patch tool in the grounded surface, so the merge happens in your context, not on
  the server - and every canvas write carries `expectedSectionsVersion` (Part 4) so a concurrent human
  save surfaces as a 409 instead of silent loss.
- **D9. Never invent a Fabric property.** Anything outside the Part 2 vocabulary (gradients, shadows, clip
  paths, blend modes) is unverified: copy the shape a template emits, or use a Part 2 fallback.

## Part 2: The object model

A canvas is Fabric.js JSON: `{ version, objects: [...], background }`. `objects` is the layer stack.

**Layer types.** Shapes: `rect`, `circle`, `triangle`, `polygon`, `path`, `line`. Text: `textbox` (wraps)
or `i-text` (one line), with `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `charSpacing`. Images:
`type: 'image'` with `src`. Groups, for elements that move and scale as one unit: a logo lockup, a badge.

**Position and transform.** `left`, `top`, `angle`, `scaleX`, `scaleY`, in artboard pixels, origin
top-left. Scale is a MULTIPLIER on intrinsic size, not a target size: an image 2400px wide sitting
full-bleed on a 1080px artboard needs `scaleX: 0.45, scaleY: 0.45`, not `1080`. Swap an image `src` and
the new file's intrinsic size is almost never the old one's, so recompute the scale or the swap looks
like a rendering bug rather than the authoring mistake it is.

**Styling.** `fill`, `stroke`, `strokeWidth`, `opacity`. That is the whole grounded set: no gradient,
shadow, blur, or mask. Fallbacks inside the vocabulary: a gradient scrim behind text on a photo is two or
three `rect` layers of one `fill` at descending `opacity` (0.55, 0.35, 0.15); a text drop shadow is a
duplicate of the text layer offset 3-5px, dark `fill` at `opacity` 0.35, placed BELOW the real text;
outline text is `stroke` plus `strokeWidth`. For anything else, copy the shape a real payload emits
(`design_templates_list` or `design_get`), or say the effect is a dashboard-editor job.

**Layer ordering is `objects[]` order.** `objects[0]` is the bottom, the last element is on top. There is
no `zIndex`; reordering means moving the element in the array. Canonical stack, bottom to top:

```
background fill/photo -> scrim -> supporting shapes -> imagery -> body text -> headline -> logo/CTA
```

**Per-layer motion.** Any layer may carry an `animation` object. THE KEY NAMES AND ENUM VALUES BELOW ARE
EXACT: the renderer reads them literally and ignores anything unrecognized IN SILENCE, so one misspelled
key or enum value is a silent no-motion - the design renders static while every tool reports success. The
full shape:

```
"animation": {
  "enter": "fade-up",         // one of the 15 entrance values below; omit = visible from t=0
  "enter_delay_ms": 300,      // default 0
  "enter_duration_ms": 600,   // default 800
  "enter_distance_px": 60,    // default 60; used by the directional fades and slides
  "easing": "expo-out",       // one of the 6 easing values below
  "exit": "fade-down",        // same 15-value list as enter; omit = visible to the end
  "exit_at_ms": 4500,
  "exit_duration_ms": 400,    // default 600
  "loop": "breathe"           // one of the 6 loop values below; a SEPARATE field, never an enter value
}
```

Every field is optional. `enter` and `exit` take exactly one of:

```
fade-in, fade-up, fade-down, fade-left, fade-right, scale-in, pop,
slide-up, slide-down, slide-left, slide-right, wipe-up, wipe-down,
blur-in, rotate-in
```

`easing` is exactly one of `cubic-out`, `quart-out`, `expo-out`, `back-out`, `ease-in-out`, `elastic`,
and applies per layer. `loop` is exactly one of `pulse`, `wiggle`, `rotate-slow`, `breathe`, `float`,
`shimmer`.

Three families, three fields. ENTRANCES (`enter`, timed by `enter_delay_ms` and `enter_duration_ms`,
shaped by `easing`) fire once then hold and carry the reveal, so everything a viewer must read gets one
and nothing else. AMBIENT LOOPS (`loop`) run continuously for the whole timeline and belong on a
background, a badge, or one accent - two on an artboard is already noise. EXITS (`exit`, firing at
`exit_at_ms` for `exit_duration_ms`) clear a layer before the cut. `loop` is a SEPARATE field from
`enter`: `pulse`, `wiggle`, `rotate-slow` and `breathe` were once listed among the entrance presets, and
putting one of them in `enter` produces no entrance at all, silently.

**The dead shape.** Older copies of this manual taught an animation object whose keys were `preset`,
`delay_ms` and `duration_ms`. None of those keys is read by the renderer: a design carrying that shape is
completely static, and `design_state_get` echoes the dead object back as if it were motion. When you meet
it on an existing design, flag it and rewrite it into the shape above - never copy it forward.

**Emphasis.** `pulse` is a continuous loop, so a CTA carrying it throbs for the entire runtime. Once-only
emphasis is a LATE ENTRANCE instead: `enter: 'pop'` (or `scale-in` with `easing: 'back-out'`) with an
`enter_delay_ms` that lands after everything else has settled.

**Canvas-level motion** sits on the root: `"_animation": { "duration_ms": 6000, "fps": 30, "loop": true }`.
This is what `design_export_mp4` renders and what `design_export_image`'s `frame` indexes into, via
`frame = seconds * fps`: at `fps: 30`, frame 60 is 2.0s. **Every entrance and exit must land inside
`duration_ms`.** The last-firing layer's `enter_delay_ms + enter_duration_ms` should land by roughly 60
percent of the runtime so the held frame can be read, and any `exit_at_ms + exit_duration_ms` must finish
before the cut. A headline still fading in when the loop restarts is never read.

## Part 3: Composing an artboard that works

Every design here is consumed at thumbnail size on a phone, in a feed, next to competing content.

**Hierarchy: three levels, no more.** Hook, support, action. The eye goes to the highest-CONTRAST element,
not the largest. If two compete for first read the design has no hierarchy, and the fix is to demote one,
not enlarge the other. Whitespace around the hook beats another 20px of `fontSize`.

**Margin and spacing unit.** Set a margin at 6 to 8 percent of the artboard's SHORT edge (64 to 88px on
1080 wide) and put nothing outside it except a deliberate full-bleed image. Every text layer's `left`
starts at the margin; right-aligned elements end at `artboardWidth - margin`. Pick ONE spacing unit (24px
on a 1080 artboard) and make every gap a multiple of it.

**Type scale.** Pick a ratio between 1.25 and 1.5 and derive everything from body size. On 1080 wide:

| Role | fontSize | lineHeight |
|---|---|---|
| Hook / headline | 72-120 | 1.05-1.15, `fontWeight` 700+ |
| Subhead | 40-56 | 1.2 |
| Body | 28-36 | 1.4-1.5 |
| Caption / legal | 20-24 | Floor. Below this nothing is read on a phone |

Tighten `lineHeight` as `fontSize` rises. Small positive `charSpacing` on all-caps labels, never on body.
Two type sizes reads as deliberate; five reads as a document. Take `fontFamily` from a template or the
brand guide. Google-hosted families ride the canvas's `fonts` list, and the account's CUSTOM brand fonts
(`brand_custom_fonts` rows with a `css_font_face`) are attached to every server render automatically,
matched on `font_family`, so an uploaded family renders in exports, MP4s and publishes. A family the
worker cannot load - not on Google, no usable `css_font_face` - falls back to the default stack and is
reported as a line in the export's `warnings`, never as a failed render. Check any new family with
`design_export_image({ id, canvas_json, width, height, frame: 0 })` before shipping, and read
`warnings` on that response: the fix for a font warning is the font row (`brand_guide_font_update`
`css_font_face`, brand-and-assets Part 3), not the canvas.

**Contrast.** 4.5:1 for body text against what is directly behind it; 3:1 for large text (roughly 24px+
bold or 30px+ regular at these scales). Text over a photograph fails by default, because a photo is not
one color: use the stacked-rect scrim and check the darkest-to-lightest range of the region the text
covers, not the average. A palette swap silently breaks contrast, so re-check after one.

**Brand palette.** Pull real values, do not eyeball them: `brand_guide_get` (found via `brand_guide_list`)
for the tokens, `account_context_get({ domain: 'branding' })` for the visual system, persona, and rules.
That is the visual-system domain. **There is no `creative` domain.** For concepting,
`talk_to_department({ domain: 'branding' })` runs the visual department agent with full hydration; persist
the chosen output with `design_create` or `design_update`. Apply roughly 60 percent dominant, 30
secondary, 10 accent, and use the accent ONCE per artboard, on the thing you want clicked. Logos come from
the brand guide's asset, not a redraw. `brand_guide_set_logo` maintains the brand guide, NOT the canvas:
putting a logo on an artboard means setting an image layer's `src`, registered first with
`media_library_register_external_url` or `media_upload` if it is not already in the library.

## Part 4: The round-trip protocol

1. **`design_state_get({ id })`.** A human-readable plus structured summary: element-by-element position,
   size, style, text, and animation, a one-line summary, and `featuredImageUrl` when a preview thumbnail
   exists. Reason over this compact view, not raw Fabric JSON. Inline payloads are elided, never
   shipped: an image `src` or a pattern fill/stroke `source` that is a `data:` URI reads
   `[embedded image]`, and a `data:` thumbnail comes back as `featuredImageUrl` null with
   `featured_image_inline: true` (`design_list` and `design_get` screen the thumbnail the same way, and
   the lists flag an inline `previewVideoUrl` as `preview_video_inline: true`). Null plus the flag means
   a thumbnail exists only inline; the real URL is `design_publish_to_library` with `set_as_featured`.
   `design_get`'s `canvasData` is deliberately unscreened, because it is the blob you PATCH back.
2. **Diff in your head.** Name every layer you will change, every layer you will keep, and every layer a
   HUMAN put there. Those are the ones you risk deleting.
3. **If the compact view cannot faithfully reconstruct a layer,** fall back to `design_get({ id })` for
   the raw `canvasData` and mutate the object in place: `path` layers, grouped lockups, anything carrying
   properties outside the Part 2 vocabulary. `design_get` is the escape hatch, not the default.
4. **`design_version_create({ id, versionName, changeSummary, isMilestone })`** before anything
   destructive. Use `isMilestone: true` for save points a client would return to ("Pre-rebrand",
   "Client-approved v2"). `design_versions_list` reads the index.
5. **`design_update({ id, canvasData, expectedSectionsVersion })`.** The dashboard editor reads from the
   same column, so the user's later edits are preserved on the next save. The hazard is the corollary:
   your write is authoritative over everything in that column right now. `expectedSectionsVersion` is the
   compare-and-swap token that makes the concurrency survivable: every canvas write bumps the design's
   version, and the response returns the new `sectionsVersion` - send that back on your next canvas
   write. If a human (or another agent) saved in between, the write is REFUSED with 409
   `sections_version_conflict` carrying `serverVersion` and `serverCanvasData`: re-apply your change on
   top of `serverCanvasData`, then resend with `expectedSectionsVersion: serverVersion`. Never resend
   your original payload unmodified - that is exactly the overwrite the 409 just prevented. The token
   starts at the read: `design_state_get` and `design_get` both return `sectionsVersion`, so the
   round-trip is read -> reason -> write-with-the-read's-token. A canvas write that omits the token still
   lands and still bumps the counter, so the human's next autosave is warned about you - but nothing
   warns you about them.
6. **Hand back the `dashboardUrl`.** The deliverable is the editable design, not the JSON or the PNG.

**Metadata updates are safe and separate.** `title`, `description`, `status`, `tags`, `featuredImageUrl`,
and `artboard` update independently of the canvas. A `design_update` omitting `canvasData` touches no
layers, so it is how you retitle, retag, or restatus a design a human is actively editing. `status` takes
`draft | published | archived`, and `status: 'archived'` is the removal verb on this surface.

**Be honest about rollback.** `design_version_create` writes the snapshot, `design_versions_list` reads
the index, and `design_version_get` returns one snapshot in full, frozen canvas blob included - but no
tool RESTORES one server-side: restoring is a human action in the dashboard's Version History panel, or
you read the snapshot with `design_version_get` and re-apply it yourself with `design_update` (which is a
new write over the live canvas, so it follows the same round-trip rules). Skip the snapshot and there is
no rollback for anyone. **There is NO design_delete and no DELETE route, deliberately.** The removal verb
is `design_update({ id, status: 'archived' })`; hard removal stays a dashboard action.

**The client's revision requests live in comment threads, not in chat.** `design_comments_list` returns
the review thread pinned to a design - every comment with its canvas `position`, `userId`, `isResolved`,
and nested `replies`, oldest first, no pagination. RESOLVED COMMENTS ARE INCLUDED: the designer's canvas
renders only unresolved pins, so filter on `isResolved` yourself or your count disagrees with the "N
unresolved" badge the human is looking at. A 404 "Design project not found" is a wrong or other-tenant id,
NOT an empty thread. Work the thread into the round-trip: read comments, fix what each one points at, then
`design_comment_resolve` per thread you actually addressed. Resolve is ONE WAY - nothing un-resolves, and
a comment resolved by mistake vanishes from the designer's view - so resolve only what is fixed, never to
tidy a queue. Resolving a REPLY reports success and changes nothing observable: resolve the parent
comment. It is a read-and-resolve surface only - no tool creates a comment, and that is what makes the
ears trustworthy: every new client comment also files ONE open agent-ops inbox item per design and
thread (category `design.comment`, severity suggestion, metadata `design_project_id`, `design_title`,
`comment_id`, `thread_root_id`, `dashboard_url`), so `agent_inbox_list({ category: 'design.comment' })`
is how a session learns which designs have new feedback without reading every thread. Work the thread
through `design_comments_list` as above, then `agent_inbox_resolve` the item - it only closes the row.
Key-profile fact: `agent_inbox_` is not on the `marketing-design` profile (full and `marketing` keys
see it), so on a scoped key the per-design read stays the sweep.

## Part 5: Templates and artboard sizing

`design_templates_list` takes no arguments and returns the 58-template library (14 canvas sizes)
brand-substituted with the account's active brand guide, plus artboard size presets grouped by category
(Social Media, Presentation, Print, Ads, Email). Each template carries a ready-to-use `canvasData`
payload: pipe it into `design_create`'s `initialCanvasData`, then swap text and imagery. It is also the
reference for how the platform structures a group, a path, or a text layer. The six wide formats added
2026-09-02 are templates, not just presets, each with its text as textbox layers: two 1200x600 email
headers (photo-led with a scrim, and typographic; category Email Header), an Open Graph 1200x630 card
(Blog Hero / Open Graph), a YouTube 1280x720 split thumbnail (YouTube Thumbnail), a LinkedIn 1584x396
banner with its content clear of the avatar overlap (LinkedIn Banner) and an X 1500x500 header that
clears the bottom-left avatar (X / Twitter Header). `design_list` reads existing designs; check there
for something to reuse first.

**Prefer the presets that tool returns over the table below,** which is guidance for when none matches:

| Use | Artboard | Notes |
|---|---|---|
| Instagram / Facebook feed square | 1080 x 1080 | Safe everywhere |
| Instagram feed portrait, carousel | 1080 x 1350 | Most feed real estate. Carousel default |
| Reels, TikTok, Stories | 1080 x 1920 | 9:16 |
| LinkedIn feed | 1200 x 627, or 1080 x 1350 | Portrait outperforms in-feed |
| LinkedIn profile / page banner | 1584 x 396 | Template; keep type clear of the avatar overlap |
| X post | 1600 x 900 | |
| X header | 1500 x 500 | Template; clears the bottom-left avatar |
| Open Graph / link preview | 1200 x 630 | Template; one headline, the domain, no small type |
| YouTube thumbnail | 1280 x 720 | Template; reads at 25 percent, three words max |
| Google Business Profile post | 1200 x 900 | Legible text, one clear subject |
| Presentation slide | 1920 x 1080 | |
| Email header | 1200 x 600 | Two templates; assume it renders at half width |

**Safe areas.** Platform chrome covers your artboard; these are approximations that shift with app
versions. On 9:16 (Reels, TikTok, Stories) budget the top 250px for status and header UI, the bottom 400
to 480px for caption, handle, and CTA furniture, and the right 180 to 200px for the action rail, leaving
roughly x 88-880, y 250-1440 on 1080 x 1920 as the trustworthy zone. On feed portrait the grid thumbnail
crops, so keep subject and hook centered. On a carousel, never bleed an image across a slide boundary.
The Part 3 margin is the floor; the safe area sits INSIDE it, never instead of it.

**One artboard, one or many pages.** `design_create` takes a single `artboard`, and a design's
`canvasData` is usually one Fabric canvas - but the column also legally holds a multi-page shape:
`{ pages: [{ id, name, canvasData }] }`, each page carrying its own full Fabric canvas while every page
shares the design's artboard. Read one page with `design_state_get({ id, page_id })` - the response also
carries the `pages` roster and `activePageId`, and an unknown `page_id` is a 400 naming the real pages -
and publish one page with `design_publish_to_library({ id, page_id })`. `design_export_image` renders
whatever `canvas_json` you pass, so for a pages-shaped design pass ONE page's inner `canvasData` (the
object holding `objects[]`), never the pages wrapper. A five-slide carousel is therefore either one
five-page design (slides share the artboard) or five sibling designs (independent version histories) -
and a pages-shaped `canvasData` write follows the same round-trip and CAS rules as any canvas write.

## Part 6: Exporting

`design_export_image({ id, canvas_json, width, height, frame? })` flattens a design to a PNG through the
Remotion worker, using the same CanvasComposition the MP4 path uses, so `frame: 0` matches what
`canvas.toDataURL` produces in the dashboard editor. **`canvas_json`, `width` and `height` are REQUIRED -
it does not render a stored design from its id alone.** Pass the canvas you just wrote (or `design_get`'s
`canvasData`) plus the artboard's dimensions; the `id` is for audit and tenancy. It returns `imageUrl`
(an S3 PNG URL) plus `jobId`, runs ~5-15s with a 90s budget, and refuses early on an empty canvas. For a
motion design, `frame` captures a moment: at `fps: 30`, `frame: 60` is 2s in. **That makes `frame` your
cheap preview:** before an MP4, export two or three frames across the timeline (0, 45, 120) and check
that the stagger reads and nothing is occluded mid-flight. Then LOOK at the PNG - download it, view it,
and judge it against the checklist in `references/self-review.md` before anything ships. The full
response is `{ success, imageUrl, jobId, warnings? }`: `warnings` carries the worker's notes, and since
2026-09-02 that includes every custom brand font that could not load and fell back (brand-and-assets
Part 3). A success with a font warning is a brand-wrong PNG; fix the font row and re-export. Budgets:
the route polls 60s and re-arms once for 25s inside a 95s ceiling, and the tool waits 100s.

`design_export_mp4` renders a motion design to MP4 or GIF. Pass the full `canvas_json` snapshot the user
has been editing, with per-layer `animation` metadata; the worker uses the same animation vocabulary as
the editor, so the output matches the in-browser preview exactly. It is SYNCHRONOUS (the route polls
180s and re-arms once for 60s inside a 270s ceiling; the tool waits 280s) and refuses early if the
canvas has no objects. The social lane's call shape is
`design_export_mp4({ id, canvas_json, width, height, duration_seconds })`. Confirm first and say it can
take close to five minutes. It returns `{ success, mp4Url, jobId, warnings? }` - read `warnings` for
font degrades here too - and the job outlives the call: on a timeout or
dropped connection, poll `design_render_job_get({ job_id })` before re-rendering - the poll itself
ADVANCES the job (a write in read clothing, so it can prompt for permission; a refused poll loses
nothing, the reconcile cron finishes jobs on its own), and only `completed`, `failed`, and `abandoned`
are terminal. A job id you lost is findable with `design_render_jobs_list`, a plain read that advances
nothing (full failure playbook in the video reference).
`design_video_rerender({ id, template_id, props })` re-renders one Remotion-template
clip inside a design and swaps the MP4 in place; it blocks up to 240s (the tool waits 290s), and it is
the one render that does NOT carry custom brand fonts - the worker's template lane takes no font
manifest, so a template clip set in an uploaded family renders in the fallback stack.

**Then register the output.** Generated images and video clips auto-register. Design exports and
stock-photo URLs do NOT - register those explicitly before attaching them anywhere. Use
`media_library_register_external_url` for one file or `media_library_register_external_url_batch` for a
carousel's worth in one call. An unregistered export has no media asset id, cannot be attached by id
downstream, and the URL in your hand is its only handle.

**For a static PNG there is a one-call alternative:** `design_publish_to_library` reads the design's
canvas STRAIGHT FROM THE DB (send no canvas_json), renders THE SETTLED FRAME - after enter animations
finish, which is frame 0 only for a design with no animation - uploads the PNG to the account's S3 media
path, and creates the library row (tagged creative-studio + published), returning `fileUrl` and
`mediaAssetId` in one shot. For a multi-page design, `page_id` picks the page (omitted = first page).
**`set_as_featured: true` is THE thumbnail path:** nothing sets `featuredImageUrl` automatically, so an
agent-created design has NO gallery thumbnail until this flag points it at the published PNG (or a
metadata `design_update` sets one by hand). The render can succeed while that one extra write fails: a
`featured_image_error` on the success payload means the PNG and library row are real and only the
thumbnail write is not - report it, never re-publish for it. TREAT THE TOOL AS CREATE, NEVER AS SYNC:
nothing dedupes, so publishing the same design twice leaves two S3 objects and two library entries, and
a retry after its 504 timeout duplicates the same way (the worker may still finish and orphan a still).
One publish per finished design, and check `media_library_list` before retrying a timeout (the route's
ceiling is 120s and the tool waits 130s). It renders with the brand's custom fonts like the exports do
and reports a degrade the same way, on `warnings`. It does not cover MP4s - a motion render still goes
through export-then-register.

## Part 7: Failure modes

- **The 10MB body cap on `design_update`.** Base64 data URIs in image `src` blow it fast: three full-bleed
  photos will do it. Reference images by URL from the media library, and split heavy concepts.
- **`previewVideoUrl` ONLY fires when `canvasData` is omitted.** Setting the autoplay thumbnail is
  therefore always a SECOND `design_update` carrying `previewVideoUrl` and no canvas. Send both in one
  call and the preview silently does not take, with no error.
- **The dead animation keys `preset` / `delay_ms` / `duration_ms`.** No key of that shape is read; the
  design renders static while every call reports success. Rewrite into the Part 2 shape on sight - and
  remember the whole `animation` object is silent-on-error: an unknown key or enum value is a no-motion,
  not a 400.
- **A `design_export_image` call without `canvas_json`, `width` and `height` is a refusal, not a render.**
  The tool never renders a stored design from its id alone; `design_publish_to_library` is the call that
  reads the DB.
- **`featuredImageUrl` is never set automatically.** An agent-created design shows no gallery thumbnail
  until `design_publish_to_library({ id, set_as_featured: true })` or a metadata `design_update` sets one.
- **Null plus `featured_image_inline: true` is not a missing thumbnail.** The dashboard editor stores a
  multi-MB `data:` snapshot in `featured_image_url`; the reads screen it whole. A metadata `design_update`
  echoing that null back would clear the editor's snapshot - the honest move is the publish with
  `set_as_featured`, which replaces it with a real URL.
- **A font warning on a 200 is a brand-wrong render.** Custom fonts degrade to the fallback stack and
  say so only in `warnings`; nothing about the status changes. Read it on every export and publish.
- **A 409 `sections_version_conflict` is a save, not a failure.** The CAS token did its job: someone else
  wrote first. Merge onto the returned `serverCanvasData` and resend with the returned `serverVersion` -
  resending the original payload is the data loss the 409 prevented.
- **Exports do not auto-register** (Part 6). The most common way a finished asset becomes unattachable.
- **`design_*` versus `marketing_design_*`.** A parallel naming exists (`marketing_design_list`,
  `marketing_design_get`, `marketing_design_export_image`, `marketing_design_export_mp4`, and
  `marketing_media_list` / `_get` / `_folders` / `_register_external_url` / `_upload_base64`). Which set a
  session sees is a KEY-PROFILE question, not an account setting - the `marketing-design` profile grants
  both the `design_` and `marketing_` prefixes, so a missing name means check the key's profile. Prefer
  `design_*`; the parallel design set is read and export only.
- **`stock_photos_download` is the WEBSITE-PROJECT lane only** (`{ url, project_id, save_path }`, into that
  project's S3 assets, NOT the Media Library), so it cannot get a photo onto a canvas. `stock_photos_search`
  SAVES NOTHING. The canvas path is search, `media_library_register_external_url` on the returned `url`,
  reference that in an image layer, and carry the `attribution`.

## Part 8: Worked plays

### Play A: build a 5-slide carousel

1. `account_context_get({ domain: 'branding' })` and `brand_guide_get` for the brand.
2. `design_templates_list`. Take a Social Media template already substituted with this brand, and its
   artboard preset (1080 x 1350 unless the client's feed says otherwise).
3. **Confirm the outline before building anything.** Five slides is hook, three value beats, CTA. Draft
   the copy with `talk_to_department({ domain: 'social' })` or `{ domain: 'content' }`, present the
   outline, get a yes. Five designs off an unapproved outline is five you throw away.
4. Five `design_create` calls, one per slide, each with the template's `canvasData` as
   `initialCanvasData`, text and imagery swapped. Title them so order survives ("Carousel <topic> - slide
   1 of 5") and tag all five identically; `design_list` is your only grouping read.
5. Keep slide-invariant layers byte-identical across all five (same margin, `fontSize`, logo `left`/`top`,
   background): a carousel reads as a set only if the frame does not move. Slide 1 carries the hook alone
   and earns the swipe, slides 2 to 4 one idea each, slide 5 one CTA.
6. `design_export_image({ id, canvas_json, width: 1080, height: 1350, frame: 0 })` per slide, each with
   that slide's own canvas as `canvas_json`, look at all five together at thumbnail size, then
   `media_library_register_external_url_batch` in slide order (or one `design_publish_to_library` per
   finished slide - once each, it never dedupes).
7. Hand back the five `dashboardUrl`s in slide order. Handoff to the social lane is `social_create_post`
   with the published `fileUrl`s as `media_urls` in that order plus an index-aligned `media_types`
   (`image/png` each), under that lane's confirm rules; onto a post that is already drafted or
   scheduled, `social_update_post({ post_id, media_urls, media_types })` - it replaces the post's whole
   media list, so send every URL, and a published post is edit-locked (400).

### Play B: restyle a design to a new brand

1. `brand_guide_get` for the NEW brand, plus `account_context_get({ domain: 'branding' })`, then
   `design_state_get({ id })` to inventory every layer's `fill`, `stroke`, and `fontFamily`.
2. **Build the mapping table and get a yes on it:** old hex to new hex, old family to new family, old logo
   to new logo. It is far cheaper to correct a table than a canvas.
3. `design_version_create({ id, versionName: 'Pre-rebrand', changeSummary, isMilestone: true })`, then
   `design_get({ id })` for raw `canvasData` if any layer is a `path`, a group, or carries properties
   outside the Part 2 vocabulary.
4. Mutate ONLY color, stroke, and font. Do not re-lay-out in the same pass: that is two changes, and when
   it looks wrong you cannot tell which did it. Re-layout is a second, separately confirmed edit.
5. Swap the logo layer's `src` to the new brand's logo, registered with
   `media_library_register_external_url` or `media_upload` first if needed, and recompute `scaleX`/`scaleY`
   for its new intrinsic size.
6. **Re-check contrast.** The new palette will have broken at least one pairing. Fix it, then
   `design_update({ id, canvasData, expectedSectionsVersion })`,
   `design_export_image({ id, canvas_json, width, height, frame: 0 })` with the canvas you just wrote,
   and hand back the `dashboardUrl` with the before and after.

### Play C: animate a static design for a Reel

1. **Fix the artboard first.** A 1080 x 1080 feed graphic is not a Reel. Create a NEW design at 1080 x
   1920 so the feed version survives (preferred), or change `artboard` with a metadata-only
   `design_update` and re-lay-out. Re-check the Part 5 safe area: a CTA that sat at the bottom of a square
   lands under the caption furniture in 9:16.
2. `design_state_get({ id })` for the layer inventory and z-order, then `design_version_create` if this is
   an existing design rather than a fresh one.
3. Add `animation` bottom-up, in `objects[]` order, so the reveal follows the eye:
 - background `{ enter: 'fade-in', enter_duration_ms: 400 }`, or `{ loop: 'breathe' }` for a slow ambient
 - hero image `{ enter: 'scale-in', enter_delay_ms: 200, enter_duration_ms: 600, easing: 'expo-out' }`
 - headline lines `{ enter: 'fade-up', enter_delay_ms: 500 }`, staggered 120 to 180ms apart
 - body `{ enter: 'fade-up' }`, delayed until after the headline lands
 - CTA and logo last: `{ enter: 'pop', easing: 'back-out' }` with a late `enter_delay_ms` for once-only
   emphasis - and at most ONE `loop` ambient on the whole artboard.
4. Root: `_animation: { duration_ms: 6000, fps: 30, loop: true }`. Verify the last layer's
   `enter_delay_ms + enter_duration_ms` lands by about 3.5s so the finished frame holds before the loop
   restarts.
5. Preview cheaply with `design_export_image({ id, canvas_json, width: 1080, height: 1920, frame: 45 })`
   (1.5s at 30fps) and the same call at `frame: 120` (4s), then
   `design_update({ id, canvasData, expectedSectionsVersion })`.
6. **Confirm, then render.** `design_export_mp4({ id, canvas_json, width: 1080, height: 1920,
   duration_seconds: 6 })`. Say it blocks up to 240s before you start.
7. `media_library_register_external_url` on the MP4. It did not auto-register. Optional autoplay
   thumbnail: a SECOND `design_update({ id, previewVideoUrl })` with NO `canvasData`. Hand back the
   `dashboardUrl`.
8. If the client described a multi-shot Reel with voiceover, b-roll, and scene transitions, this is the
   wrong lane: `marketing_storyboard_create` (exactly one of `template_id` plus `substitutions`, or a
   hand-authored `storyboard`), read back with `marketing_storyboard_get`, fixed with
   `marketing_storyboard_update` on `validation.errors`, restyled with `marketing_storyboard_set_look`,
   then `marketing_storyboard_submit_for_approval`.
   THE AGENT CANNOT APPROVE: after creating, submit for approval and stop.

---

# Tool index for this reference

**Canvas round-trip:** `design_state_get` (compact read; `page_id` reads one page of a multi-page
design), `design_get` (raw `canvasData`), `design_update` (canvas via `canvasData` +
`expectedSectionsVersion` CAS token; metadata independently; `status: 'archived'` is the removal verb -
there is no design_delete), `design_create`, `design_list`, `design_templates_list`.

**Versioning and review:** `design_version_create`, `design_versions_list`, `design_version_get`,
`design_comments_list`, `design_comment_resolve`, `agent_inbox_list` (category `design.comment` is the
ears; full and `marketing` keys only), `agent_inbox_resolve` (closes the row, nothing more).

**Export and publish:** `design_export_image` (REQUIRES `id, canvas_json, width, height`; optional
`frame`, `fps`, `duration_frames`; returns `imageUrl` + `jobId` + `warnings?`), `design_export_mp4`
(`mp4Url` + `jobId` + `warnings?`), `design_video_rerender` (no custom fonts), `design_render_job_get`
(polling ADVANCES the job - video reference), `design_render_jobs_list` (plain read of render jobs;
advances nothing), `design_publish_to_library` (`page_id`, `set_as_featured`; settled frame; never
dedupes; `warnings?`).

**Registration, libraries and delivery:** `media_library_register_external_url` / `_batch`,
`media_upload`, `media_import_url`, `media_library_list`, `media_update`, `social_create_post` and
`social_update_post` (`media_urls` + index-aligned `media_types`; update replaces the whole list).

**Brand and context:** `account_context_get({ domain: 'branding' })`, `talk_to_department`,
`brand_guide_list`, `brand_guide_get`, `brand_guide_set_logo`.

**Escalation lane:** `marketing_storyboard_create`, `marketing_storyboard_get`,
`marketing_storyboard_update`, `marketing_storyboard_set_look`,
`marketing_storyboard_submit_for_approval` (then STOP - the agent cannot approve).

**Companion protocols:** the see-and-judge loop is `references/self-review.md`; memory write-back is
`references/memory-protocol.md`.
