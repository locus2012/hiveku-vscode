# Self-review: render it, look at it, judge it, then hand it off

## What this covers / when to load this

The see-and-judge protocol. You are multimodal: a rendered PNG is something you can actually look at,
and `design_export_image` exists precisely so the result is SEEN before it ships. Nothing leaves a
creative session unseen - not a design, not a motion export, not a generated clip's frames. Load this
before handing back any visual deliverable, and run it after every canvas write that matters.

## The loop, one pass

1. **Write** with `design_update({ id, canvasData, expectedSectionsVersion })` (the CAS protocol in the
   design-canvas reference, Part 4). Keep two things from this step: the returned `sectionsVersion` for
   your next write, and the canvas object you sent - it is the `canvas_json` for the next step.
2. **Render** with `design_export_image({ id, canvas_json, width, height, frame: 0 })`. All four named
   arguments are required - the tool does not render a stored design from its id alone. `canvas_json` is
   the canvas you just wrote (or `design_get`'s `canvasData`; for a pages-shaped design, one page's
   inner canvas); `width` and `height` are the artboard's. It returns `imageUrl` (an S3 PNG) plus
   `jobId`, typically in 5-15s, and optionally `warnings`. Read `warnings` BEFORE you look: a custom
   brand font that could not load degraded to the fallback stack, and no amount of looking at the PNG
   tells you which family you meant. A font warning is fixed on the font row (`brand_guide_font_update`
   with a valid `css_font_face`; brand-and-assets Part 3), then re-exported - never by changing the
   canvas to match the fallback.
3. **Look.** Download the PNG and view it: the Read tool renders an image file, so
   `curl -sSL -o <scratchpad>/review.png "<imageUrl>"` then Read that file, or fetch the URL directly
   when no shell is available. Judging from the Fabric JSON is not review - the JSON already looked
   right when you wrote the bug.
4. **Judge against the checklist below**, line by line, with a verdict per line. Name what failed and
   why, in writing, before touching the canvas again.
5. **Iterate.** Fix only what failed (one `design_update` carrying the CAS token), re-export, re-look.
   HARD CAP: two to three passes. Past that you are polishing noise - stop and hand off.
6. **Hand off, naming the residual judgment calls.** Some checks are taste a human must settle: photo
   crop, copy tone, whether it feels like the brand. Say which ones you could not settle and what you
   would pick. A handoff that hides open questions is a revision cycle scheduled for later.
7. **Finish.** For a finished static design, `design_publish_to_library({ id, set_as_featured: true })` -
   once, never retried blind (it never dedupes, and it publishes the SETTLED frame, after enter
   animations finish). `set_as_featured` is the thumbnail path: without it an agent-created design shows
   no gallery thumbnail. A `featured_image_error` on the success payload means the PNG and library row
   are real and only the thumbnail write failed - report it, do not re-publish. A later read answering
   `featuredImageUrl` null with `featured_image_inline: true` is the editor's inline snapshot, not a
   missing thumbnail; this same publish is what replaces it. Hand back the `dashboardUrl` and the
   `fileUrl`.

## The checklist

Judge the downloaded PNG, not your intentions:

- **Hierarchy: exactly three levels.** Hook, support, action. Where does the eye land first? If two
  elements fight for first read, demote one - do not enlarge the other.
- **Contrast:** 4.5:1 for body text, 3:1 for large text (roughly 24px+ bold or 30px+ regular), measured
  against the region directly behind the text - the darkest-to-lightest range of a photo, never its
  average. A palette swap silently breaks at least one pairing; re-check after every one.
- **Margins:** 6 to 8 percent of the artboard's short edge, nothing outside them except deliberate
  full-bleed, and every gap a multiple of one spacing unit.
- **Brand tokens vs `brand_guide_get`:** fills match the palette hexes (roughly 60/30/10, accent used
  once), `fontFamily` matches the guide's pairing, and the logo slot holds the GUIDE'S asset - not
  redrawn, not stretched (`scaleX` equals `scaleY`), not sitting on a background that swallows it.
- **Thumbnail legibility at 25 percent.** Every design is met in a feed first. Downscale the PNG
  (`sips -Z 270` on macOS, ImageMagick `-resize 25%` elsewhere) and Read the small file: if the hook is
  not readable there, the design does not work, whatever the full-size render looks like.
- **Platform safe areas** (design-canvas reference, Part 5): on 9:16, nothing that matters in the top
  250px, the bottom ~450px, or the right ~200px.
- **Text integrity:** no overflow past a textbox, no orphaned single word on its own line, no clipped
  descenders, no template placeholder or `{slot}` braces left behind.
- **Render fidelity:** letterforms that do not match the family you set mean the worker fell back to
  another font. The export's `warnings` names the dropped family and why (an oversized or clipped
  `@font-face`, a blocked URL, a failed brand-kit read); fix that row, or swap to a template-proven or
  Google-served guide font, rather than shipping the fallback.

## Motion designs: three frames before any MP4

A single frame cannot prove a timeline. Before `design_export_mp4`, export three:

- **frame 0** - the rest state (before animations apply; matches the editor's still view).
- **mid-timeline** - `frame = (duration_ms / 2 / 1000) * fps`: the stagger in flight. Check that nothing
  important is occluded mid-entrance and the reveal order follows the layer stack.
- **last frame** - `frame = (duration_ms / 1000) * fps - 1`: the held end state. Every entrance
  finished, every exit done, the CTA readable. Pass `fps` and `duration_frames` on these calls so the
  export timeline matches the root `_animation`.

View all three. Only then render the MP4 - and after it completes, read the render job's `warnings`
(`design_render_job_get` returns them; the poll ADVANCES the job and may prompt for permission, and a
skipped poll loses nothing). You cannot view an MP4 directly: if `ffmpeg` is available locally, pull a
frame (`ffmpeg -ss 2 -i clip.mp4 -frames:v 1 out.png`) and Read it; otherwise say plainly that the
frames were reviewed and the final MP4 was not.

## Generated video: judge what the pipeline exposes

- **Lane 2 (storyboard):** as scenes complete, `marketing_video_pipeline_status` carries each completed
  scene's `url`. Review scenes as they land (frame-pull as above when possible) so one bad scene is
  caught before the composite; the final asset appears on `result` once compositing finishes.
- **Lane 3 (one clip):** the clip auto-registers; read the render job's `warnings`, and view a pulled
  frame when you can. A clip you could not view ships only with that caveat attached. Report the
  length from `duration_effective` (null means unmeasured, never 0) and quote `duration_note` when the
  lane snapped the hint.
- **Generated stills:** `brand_applied` on the response is part of the judgment. `false` with
  `brand_skipped_reason: 'no_active_brand_guide'` means the image is unbranded however good it looks,
  and the handoff says so.

## What you cannot judge - say so instead of guessing

Color shifts between the PNG and a client's screen, how a platform recompresses the upload, copy
ACCURACY against the client's real prices, dates, and claims, and the licensing of any imported element.
These go into the handoff as named caveats, not silent hopes.

---

# Tool index for this reference

`design_update` (CAS write via `expectedSectionsVersion`), `design_get`, `design_state_get`,
`design_export_image` (`{ id, canvas_json, width, height, frame?, fps?, duration_frames? }` returns
`imageUrl` + `jobId` + `warnings?`), `design_export_mp4` (`warnings?` too), `design_render_job_get` (the
poll ADVANCES the job), `design_render_jobs_list`, `design_publish_to_library` (`set_as_featured`;
settled frame; never dedupes), `brand_guide_font_update` (the fix for a font warning),
`marketing_video_pipeline_status`, `brand_guide_get`, `media_library_list`, `pm_tasks_create`.
