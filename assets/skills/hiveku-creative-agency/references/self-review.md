# Self-review: read it back, check it, then hand the looking to the person

## What this covers / when to load this

The check-and-hand-off protocol. There is no server preview of a design any more, for agents either:
designs are drawn and exported in the Hiveku desktop app, never on Hiveku's servers, and
`design_export_image`, `design_export_mp4`, `design_publish_to_library` and `design_video_rerender`
answer 410 `export_in_desktop_app` every time (never call, retry or loop them). So you check a design
from what its saved numbers say, and the person looks at it in Creative Studio. Nothing leaves a
creative session unchecked. Load this before handing back any visual deliverable, and run it after
every canvas write that matters.

## The loop, one pass

1. **Write** with `design_update({ id, canvasData, expectedSectionsVersion })` (the CAS protocol in the
   design-canvas reference, Part 4), or the one-layer tools. Keep the returned `sectionsVersion` for
   your next write.
2. **Read it back** with `design_state_get({ id, page_id? })`: every element's position, size, style,
   text and animation as saved. Read what was saved, not what you meant to send.
3. **Judge against the checklist below**, line by line, with a verdict per line. Name what failed and
   why, in writing, before touching the canvas again.
4. **Iterate.** Fix only what failed (one write carrying the CAS token), read back, judge again. HARD
   CAP: two to three passes. Past that you are polishing noise - stop and hand off.
5. **Hand off, naming what needs a human eye.** Hand back the `dashboardUrl` and ask the person to look
   at the design in Creative Studio in the Hiveku desktop app. Some checks only a person can settle
   there: how the type really sets, photo crop, copy tone, whether it feels like the brand. Say which
   ones you could not settle and what you would pick. A handoff that hides open questions is a revision
   cycle scheduled for later.
6. **Finish in the desktop.** The person exports it: open the design in Creative Studio in the latest
   desktop app and choose Download (PNG, JPG, WEBP, SVG, PDF or MP4); Save to Media library then keeps
   the file in the library, titled after the design. A picture is tagged `creative-studio` and
   `export` (`design_export_save` is that door): pick it up with
   `media_library_list({ tags: 'export', search: '<design title>' })`. An MP4 carries no tags: use
   `media_library_list({ media_type: 'video', search: '<design title>' })`.
   Creative Studio also keeps the design's list picture (`design_thumbnail_set`); a read answering
   `featuredImageUrl` null with `featured_image_inline: true` is the editor's inline snapshot, not a
   missing thumbnail.

## The checklist

Judge the saved numbers, not your intentions:

- **Hierarchy: exactly three levels.** Hook, support, action, readable in the font sizes and the stack
  order. If two elements fight for first read, demote one - do not enlarge the other.
- **Contrast:** 4.5:1 for body text, 3:1 for large text (roughly 24px+ bold or 30px+ regular), measured
  against the colour directly behind the text. Text over a photo cannot be measured from the numbers:
  give it a scrim or a solid panel, or name it for the person to check. A palette swap silently breaks
  at least one pairing; re-check after every one.
- **Margins:** 6 to 8 percent of the artboard's short edge, nothing outside them except deliberate
  full-bleed, and every gap a multiple of one spacing unit.
- **Brand tokens vs `brand_guide_get`:** fills match the palette hexes (roughly 60/30/10, accent used
  once), `fontFamily` matches the guide's pairing, and the logo slot holds the GUIDE'S asset - not
  redrawn, not stretched (`scaleX` equals `scaleY`), not sitting on a background that swallows it.
- **Thumbnail legibility at 25 percent.** Every design is met in a feed first. Divide the hook's font
  size by four: if it falls under about 12px, the hook will not read in a feed, whatever the full size
  does.
- **Platform safe areas** (design-canvas reference, Part 5): on 9:16, nothing that matters in the top
  250px, the bottom ~450px, or the right ~200px.
- **Text integrity:** no textbox whose text cannot fit its width and height at its size, no orphaned
  single word on its own line where you can tell, no template placeholder or `{slot}` braces left behind.

## Motion designs: check the timeline before the person makes an MP4

A single frame cannot prove a timeline, and there is no server frame to look at. Read the timing from
`design_state_get` (`canvasAnimation` and each layer's `animation`):

- **the rest state** - what shows before any entrance: nothing the design needs should be hidden for long.
- **mid-timeline** - the stagger in flight. Check that the reveal order follows the layer stack and
  nothing important waits behind another entrance.
- **the end** - every entrance finished by about 60% of the root `animation.duration_ms`, every exit
  done, the CTA held long enough to read.

Then ask the person to play it in Creative Studio and to make the MP4 with Download, which draws it on
their computer. Say plainly that you checked the timing and that the person has the only view of the
moving result.

## Generated video: judge what the pipeline exposes

- **Lane 2 (storyboard):** as scenes complete, `marketing_video_pipeline_status` carries each completed
  scene's `url`. Review scenes as they land (pull a frame with `ffmpeg` when it is available) so one bad
  scene is caught before the composite; the final asset appears on `result` once compositing finishes.
- **Lane 3 (one clip):** the clip auto-registers; read the render job's `warnings`, and view a pulled
  frame when you can. A clip you could not view ships only with that caveat attached. Report the
  length from `duration_effective` (null means unmeasured, never 0) and quote `duration_note` when the
  lane snapped the hint.
- **Generated stills:** a generated image is a file at a URL, so fetch and view it. `brand_applied` on
  the response is part of the judgment. `false` with `brand_skipped_reason: 'no_active_brand_guide'`
  means the image is unbranded however good it looks, and the handoff says so.

## What you cannot judge - say so instead of guessing

How the finished design really looks (only the person sees it, in Creative Studio), colour shifts
between their screen and a client's, how a platform recompresses the upload, copy ACCURACY against the
client's real prices, dates, and claims, and the licensing of any imported element. These go into the
handoff as named caveats, not silent hopes.

---

# Tool index for this reference

`design_update` (CAS write via `expectedSectionsVersion`), `design_get`, `design_state_get` (the read
back), `design_render_job_get` (the poll ADVANCES the job), `design_render_jobs_list`,
`marketing_video_pipeline_status`, `brand_guide_get`, `media_library_list` (the pickup of a saved
export), `pm_tasks_create`. Retired on the server: `design_export_image`, `design_export_mp4`,
`design_publish_to_library`, `design_video_rerender` (410 `export_in_desktop_app`).
