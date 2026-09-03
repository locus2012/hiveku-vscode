# Video: the three lanes, the approval gate, and what actually bills

## What this covers / when to load this

Every way this plugin can put moving pictures into a Hiveku account, and how to pick between them before you
spend a cent or a client's patience. There are exactly three lanes: an animated design canvas rendered to
MP4 (lane 1), a multi-scene storyboard a human approves before anything is produced (lane 2), and a single
AI-generated clip (lane 3). They differ in cost, in whether a human gate stands in front of them, in how
they fail, and in how the result gets registered. Load this whenever the ask is "make me a video", "animate
this", "we need a Reel / TikTok / promo / explainer / testimonial / listing tour", a motion logo or brand
card, a product demo clip, a voiceover or narration, or a video cover for a post - and BEFORE picking a
tool, because the most expensive mistake here is starting in the wrong lane.

Still-image creative, the canvas as a static editor, brand guides, and the media library live in SKILL.md
and its other references. House rules stay in force: `account_context_get` before anything generative,
confirm before anything billable or irreversible, hand back a dashboard URL, never claim something was
generated when it was imported, and register what does not auto-register.

---

## 1. The decision rule (read this before touching a tool)

Ask these in order. Stop at the first yes.

**Q1. Is it type, layout, logo, brand card, price list, quote, stat, or countdown - anything typographic or
geometric, where the value is that the client can edit it later?**
**LANE 1, motion design.** Build it on the design canvas, render with `design_export_mp4`. No generation
cost, and it stays layered and editable. This is the right lane far more often than people expect: most
"social video" a retainer ships is text on brand color with a logo sting, not footage.

**Q2. Does it need more than one shot - a sequence with a hook, a body, and a CTA?**
**LANE 2, storyboard.** `marketing_storyboard_create`, then `marketing_storyboard_submit_for_approval`, then
STOP. The lane for Reels, TikToks, promos, explainers, testimonials, listing tours, event promos. Free to
draft and it prices itself, so a fully costed plan reaches the client at zero risk.

**Q3. Is it exactly one short shot - two to ten seconds - of something that cannot be drawn as vector or
type and does not already exist in the library?**
**LANE 3, one generated clip**, `marketing_generate_video`. PAID, Premium-plan only, metered. Confirm before
you spend.

**Q4. None of the above - real people, real premises, client-supplied video?**
No lane generates that. GENERIC real footage, though, is searchable in-product:
`media_stock_video_search` is the only stock FOOTAGE search here (free Pexels + Pixabay video), and a
storyboard `stock` scene stores its provider-prefixed `id` (e.g. "pexels:13736675") as `stock_video_id`.
Read `providerErrors` ON EVERY CALL: a provider whose key is unset or whose call failed contributes zero
rows while the response is still 200 `success: true`, so half a catalog looks like the whole catalog -
report it as PARTIAL, never as "no footage matched". Client-specific footage is import-only:
`media_library_register_external_url` for a hosted file, `media_upload` for a local one, and say plainly
that the footage is client-supplied.

**The gate in front of all four:** reuse before generating. Run `media_library_list` (or
`marketing_media_list`) and `media_folders_list` first - the account's real photos and prior clips beat AI
for products, team, premises, and location, are already on brand, and cost nothing.

| Lane | Tool that produces the file | Cost | Human approval | Editable after |
|---|---|---|---|---|
| 1. Motion design | `design_export_mp4` | none beyond render time | no (confirm the block) | yes, fully layered |
| 2. Storyboard | approval itself starts the run | priced at create, billed on approval | YES, and the agent cannot give it | scene-level via the board |
| 3. One clip | `marketing_generate_video` | metered, ~$0.10 per second (2-10s, ~$1 at the 10s default) | no, but confirm the spend | no, it is a flat file |

---

## 2. Lane 1: motion design on the canvas

The output is not just an MP4; it is a design project the client can open, retime, recolor, and re-render.

### 2.1 Build the canvas

Start from the library. `design_templates_list` returns the 52-template library already brand-substituted
with the account's active brand guide, plus artboard presets by category (Social Media / Presentation /
Print / Ads / Email). Each template carries a ready-to-use canvasData payload - pipe it into
`design_create`'s `initialCanvasData`. It takes no arguments, so there is no reason to skip it.

`design_create({ title, designType, artboard, initialCanvasData, description, tags })` returns `id` and
`dashboardUrl`. Hand the `dashboardUrl` back every single time; that URL is the deliverable as much as the
MP4 is. The canvas supports shapes, text, images (`type: 'image'` with `src`), groups, layer ordering via
the `objects[]` order, positions, and styling.

Artboards for video: 1080x1920 vertical for Reels, TikTok, Stories; 1080x1080 or 1080x1350 for an Instagram
feed; 1920x1080 for YouTube or LinkedIn. Pick it before you animate - changing it later rescales every
layer's `left`, `top`, `scaleX`, `scaleY`.

### 2.2 Animate per layer

Per layer, on the object: `animation: { enter?, enter_delay_ms?, enter_duration_ms?, enter_distance_px?,
easing?, exit?, exit_at_ms?, exit_duration_ms?, loop? }`. `enter` and `exit` take one of the 15 entrance
values: `fade-in`, `fade-up`, `fade-down`, `fade-left`, `fade-right`, `scale-in`, `pop`, `slide-up`,
`slide-down`, `slide-left`, `slide-right`, `wipe-up`, `wipe-down`, `blur-in`, `rotate-in`. `easing` is
one of `cubic-out`, `quart-out`, `expo-out`, `back-out`, `ease-in-out`, `elastic`. `loop` is one of
`pulse`, `wiggle`, `rotate-slow`, `breathe`, `float`, `shimmer` - a SEPARATE field from `enter`, never an
entrance value. Defaults: `enter_delay_ms` 0, `enter_duration_ms` 800, `enter_distance_px` 60,
`exit_duration_ms` 600. At the root: `_animation: { duration_ms, fps, loop }`. That is the whole
vocabulary - entrances, exits, ambient loops, and a per-layer easing. Still no keyframes and no custom
motion path: if the ask needs one, say so rather than faking it.

The key names are exact and anything unrecognized is IGNORED IN SILENCE. The old shape whose keys were
`preset`, `delay_ms` and `duration_ms` is DEAD: none of those keys is read, so a design saved with it
renders fully static while every tool reports success. Rewrite it on sight; never copy it forward.
Field-by-field guidance, the three families, and the emphasis rule live in the design-canvas reference,
Part 2.

The trap that ruins first attempts: a layer whose `enter_delay_ms + enter_duration_ms` exceeds the root
`duration_ms` never finishes on screen, and the viewer sees a half-played entrance frozen at the cut (and
an `exit_at_ms + exit_duration_ms` past the root duration is an exit that never happens). Stagger
entrances 100 to 200 ms apart and leave 800 ms of hold at the end so the last frame reads.

The reason to stay in this lane is exactness: the worker uses the same animation vocabulary as the editor,
so the output matches the in-browser preview exactly. What the client sees at the `dashboardUrl` is what the
MP4 will be.

### 2.3 Editing an existing design: the round-trip rule (`design_state_get`)

This is the read half of the round-trip: always state_get -> reason -> update. Never author a full canvas
blind over the top of a user's edits.

`design_state_get` returns a human-readable plus structured summary - element by element position, size,
style, text, and animation, plus a one-line summary - so you reason over a compact view instead of raw
Fabric JSON. `design_get` returns the raw `canvasData`, for when you need it.

`design_update` is the primary write path. Passing `canvasData` overwrites the canvas wholesale, and the
dashboard editor reads from the same column, so a blind overwrite silently destroys whatever the human
changed since you last looked. Title, description, status, tags, featuredImageUrl, and artboard update
independently. The body is capped at 10MB, so reference images by URL from the media library rather than
inlining base64. `previewVideoUrl` sets the autoplay thumbnail and ONLY fires when `canvasData` is omitted,
which makes it a second, separate call after the render, never a field tacked onto the canvas save.

Before any large or destructive edit, snapshot with `design_version_create({ id, versionName, changeSummary,
isMilestone })`, using `isMilestone` for named save points such as "client-approved v1". The client can then
roll back from the dashboard's Version History panel; `design_versions_list` shows every snapshot and
`design_version_get` returns one snapshot in full, frozen canvas included. It costs nothing.

### 2.4 Check frames before you render the movie

`design_export_image({ id, canvas_json, width, height, frame })` flattens one frame to PNG through the
same CanvasComposition the MP4 path uses, so `frame=0` matches what the dashboard editor would produce;
set `frame` to capture a moment (at fps 30, `frame: 60` is two seconds in). `canvas_json`, `width` and
`height` are REQUIRED - it does not render a stored design from its id alone, so pass the canvas you just
wrote and the artboard's dimensions. Three single-frame exports - opening, midpoint, last frame - catch a
mistimed entrance, a text overflow, or a layer stuck off-artboard in seconds instead of after a
four-minute block. It is the cheap dry run for lane 1, and the frames are for LOOKING at: download each
`imageUrl` and view it against the checklist in `references/self-review.md`.

### 2.5 The render, what to say while it blocks, and what to do when it dies

`design_export_mp4({ id, canvas_json, width, height, duration_seconds })` renders the design to MP4 (or GIF)
via the Remotion worker. Pass the full canvas snapshot the user has been editing - layered Fabric JSON with
the per-layer `animation` metadata. Three hard behaviors:

- **SYNCHRONOUS, blocks up to 280 seconds** (the route polls 180s, re-arms once for 60s if the worker
  restarted, and stops at 270s; the tool waits 280s). Nothing else happens in the session while it runs.
  No progress percentage mid-call and no cancel tool (`marketing_video_pipeline_status` and
  `marketing_video_pipeline_cancel` are lane 2 only and do nothing here).
- **Refuses early if the canvas has no objects.** Usually a symptom, not the bug: you passed the wrong
  design id, or a `canvas_json` you built in memory and never saved. Run `design_state_get` and confirm the
  canvas holds the layers you think it does.
- **Renders the brand's custom fonts, and confesses when one did not load.** The account's
  `brand_custom_fonts` rows with a `css_font_face` are attached to the job automatically; a font the
  worker cannot use degrades that layer to the fallback stack and is reported as a line in the
  response's `warnings`, never as a failed render. A 200 with a font warning is a brand-wrong video:
  fix the font row (brand-and-assets reference, Part 3) and re-render.
- **Returns `{ success, mp4Url, jobId, warnings? }`, and the job outlives the call.** A 504 or a dropped connection loses
  the RESPONSE, not the render. `design_render_job_get({ job_id })` polls that job and returns `{ status,
  progress, progressMessage, url, assetId, warnings, error, ... }` - and calling it ADVANCES the job (the
  same pollAndAdvance the reconcile cron runs), so the clip can finish and register through the poll
  itself. That makes it a WRITE in read clothing: it is no longer plugin-pre-approved, so the call may
  prompt for permission. A refused or skipped poll loses nothing - the reconcile cron still finishes the
  job on its own; the poll only tells you sooner. Only `completed`, `failed`, and `abandoned` are
  terminal; keep checking in on anything else. Lost the id entirely? `design_render_jobs_list` lists the
  account's render jobs - rows of `{ jobId, kind, status, progress, url, assetId, designProjectId,
  billable, error }`, filterable by status / kind / design_project_id - and it is a plain read that
  advances nothing.

Because it blocks, tell the user before you start, not after. Four things, one short message:

1. What you are rendering and where it lands - design title, its `dashboardUrl`, destination platform and
   aspect ratio.
2. The exact spec: width, height, fps, duration in seconds.
3. That the render is synchronous and can block for close to five minutes, during which the session can
   do nothing else, with no progress readout to report partway.
4. What happens next: register the file, set it as the design's preview, hand back both URLs.

Then get a yes. It is not billable, but four minutes of a dead session earns a confirmation, and it is the
last cheap moment to catch "actually make it square, not vertical".

Keep the render inside the window. Frames are `fps x duration_seconds`; 30 seconds at 30 fps is 900 frames
and is where timeouts start. Past roughly 20 seconds or 1080p, shorten it, drop to 24 fps, or split it into
two designs.

**The failure playbook - do not improvise at minute four.**

1. On a timeout or dropped call, poll `design_render_job_get` with the `jobId` FIRST (no jobId in hand:
   find it with `design_render_jobs_list`). A job still running, or already `completed` with a `url`,
   means re-rendering now would duplicate work; ride the poll out. Read `warnings` on the finished job -
   the worker's post-render notes are the closest thing to a review you get without viewing the file.
2. Only when the job reads `failed` or `abandoned` (or no jobId ever came back) do you get ONE re-render,
   and only after changing something: shorter duration, 24 fps, smaller artboard, or a split.
3. A second failure ends the session's retry budget. Stop, `pm_tasks_create` with the design id, the spec
   attempted, and both failures, and tell the client the render is escalated - not "rendering".

### 2.6 Re-rendering a template clip inside a design

`design_video_rerender({ id, template_id, props })` re-renders a single Remotion-template video clip with
new prop values. It applies when a design contains a video element backed by a Remotion template: someone
edits a slot, this re-runs the render, and the resulting MP4 swaps in place. It blocks up to 240 seconds
(the tool waits 290s), and the same pre-render message and failure playbook apply. It is the one render
that carries NO custom brand fonts - the worker's template lane takes no font manifest - so a template
clip set in an uploaded family comes back in the fallback stack; say so rather than re-rendering.

The trap: canvas position, scale, and rotation are preserved by the caller on update, not by the tool. Read
`left`, `top`, `scaleX`, `scaleY`, and `angle` with `design_state_get` before the rerender and write them
back in the `design_update` afterwards, or the clip returns at default position and size and the layout
reads as broken. Use it for a one-slot change - new headline, new price, swapped product name - rather than
rebuilding a working design.

### 2.7 Voiceover on a design

Narration is a real, billable capability - sell it, but price it first, every time.

1. `brand_guide_voiceovers_get` FIRST: the account's APPROVED narrators, each with human `usage_notes`
   ("warm, use for testimonials") and a `default_voice`. Send the matching `voice_id`, never a guessed
   friendly name - that guess is what once produced a provider 400 retried every 32 seconds for an hour.
   It is read-only BY DESIGN: approving a narrator is a human brand decision made in the brand UI, so you
   may choose from the set but can never widen it. Its parser silently DROPS any stored entry whose
   provider is unknown or whose voice_id is not syntactically valid, so a missing voice is a data problem
   to raise, not an empty account.
2. `design_voices_list` is the wider Design Studio catalog, server-scored shortlist on top, for
   deliberately picking OUTSIDE the approved set - say so when you do. A Cartesia UUID from here is what
   `design_voiceover_create` and a storyboard's `voice` block accept. NOT `voice_tts_voices_list` - that is
   the IVR catalog behind the paid phone-plan gate and 402s for marketing-only accounts. HTTP 503 with
   `voices: []` means the environment is broken (`not_configured` / `voices_unavailable`), never that the
   account has no voices - report it as a failed source, not an empty one.
3. `design_voiceover_estimate` prices the script and spends NOTHING: characters (normalized, 800 max),
   `estimated_seconds` (a flat heuristic, not a measurement), `remaining_seconds`, `billable`,
   `cost_cents`. `included_minutes: 0` means the plan has no voiceover allowance at all. Quote from this,
   never from memory.
4. `design_voiceover_create` SPENDS MONEY: renders through Cartesia, stores the MP3, writes a billing row,
   and registers the clip in the Media Library. `cached: true` means an identical (script, voice) render
   already existed - nothing new was spent. TRAP: `asset_id` can come back null while `url` is real audio
   that has ALREADY been billed (the library row is best-effort) - never treat a null asset_id as a failed
   render and never retry on it; register the `url` yourself instead. A non-UUID voice_id is a 400
   `voice_not_recognised`.

Estimate, confirm the cost and remaining allowance with the client, then create. Log seconds consumed to
the monthly spend ledger (read-merge-write per `references/memory-protocol.md`). Music and licensed
tracks remain import-only - no tool.

---

## 3. Lane 2: the multi-scene storyboard

This lane's whole design is the approval gate, and the gate is a feature. Use it instead of one-off video
generation whenever the ask is "make me a video" rather than "make me one clip".

### 3.1 Draft it, because drafting is free

**Find before you create.** `marketing_video_pipeline_list` lists the account's existing boards as
summaries - rows of `{ pipelineId, status, progress, designProjectId, sceneCount, approvedAt,
resultMediaAssetId }`, never the storyboard document itself, and listing approves nothing. A board for
this ask may already exist, drafted last week and waiting on the human, and a second board for the same
ask splits the approval conversation in two. The list says which boards exist, not WHY - the ledger in
`references/memory-protocol.md` still records what each board was for.

`marketing_storyboard_create` is FREE AND FAST. It validates, prices, and stores. Nothing is reserved,
billed, or enqueued until a human approves. So you can put a complete, costed, scene-by-scene plan in front
of the client at zero risk.

Pass EXACTLY ONE of:

- `template_id` - a server-rendered genre template: `social-short`, `product-promo`, `explainer`,
  `testimonial`, `listing-tour`, `event-promo`. Fill `substitutions` as `{ slot: value }`. Optionally add
  `style_id` (`clean-professional`, `bold-social`, `premium-minimal`, `warm-documentary`), `profile_id`
  (`tiktok`, `instagram_reels`, `youtube_shorts`, `youtube_landscape`, `linkedin_feed`, `linkedin_square`,
  `website_hero`), and `voice_id` (a Cartesia UUID - read `brand_guide_voiceovers_get` first, section 2.7).
- `storyboard` - a full `hiveku.storyboard.v1` document you authored, for anything the templates do not fit.

Both, or neither, is a create-time failure. Decide which before you build the call.

A hand-authored storyboard may carry look fields inline: board-level `style_id`, `transition`
(`none` | `fade` | `slide-left` | `slide-up`), `transition_ms`, `brand`, `captions.style`, and per-scene
`camera`. A `stock` scene stores a `stock_video_id` from `media_stock_video_search` (section 1, Q4). Do not
smuggle look fields into `substitutions`; slots are content, not style.

Write the scenes with the brand loaded. `account_context_get({ domain: 'branding' })` is the visual-system
domain and `talk_to_department({ domain: 'branding' })` is the visual department agent. There is NO
`creative` domain on either tool - passing one is a server-side rejection, not a soft fallback. For script
and on-screen copy, `talk_to_department({ domain: 'content' })` or `{ domain: 'social' }` fits better.

### 3.2 Fix validation failures precisely - and know that every edit voids approval

On validation failure the response carries `validation.errors` naming the exact bad field per scene. Fix
that field with `marketing_storyboard_update`. Do not delete and re-create - you lose the priced structure
and any look already set, and the same error usually comes straight back. `marketing_storyboard_get`
re-reads current state whenever you are unsure what is stored.

Two write tools, split by intent, both PRE-APPROVAL ONLY (a 409 `pipeline_already_started` means the board
is past approval and can no longer be edited):

- `marketing_storyboard_update` REPLACES the document wholesale - whatever the new document omits is gone.
  Use it when the SCENES change: add, remove, reorder, rewrite a prompt or vo_line or duration.
- `marketing_storyboard_set_look` edits appearance BY NAME - style, brand, captions, transition, music
  slot, a scene's camera - so a field you did not restate cannot be silently dropped. Prefer it for any
  appearance change.

Neither is a lighter-weight write where approval is concerned: ANY edit - a one-color change included -
bumps the version, recomputes the checksum, CLEARS EVERY APPROVAL STAMP, and re-prices. That is the gate
working, not a bug to route around; the human must approve again. `submit` defaults true on both (the
revision goes straight back to awaiting_approval); pass `submit: false` only to park a draft you are not
ready to show.

### 3.3 Submit, then stop

**THE AGENT CANNOT APPROVE: after creating, submit for approval and stop.**

`marketing_storyboard_submit_for_approval({ storyboard_id })`, then report and halt. The report the human
needs is short and specific:

- Scene count and the one-line beat of each scene.
- Total runtime.
- The price the create call returned, stated as the amount that will be billed on approval.
- The dashboard URL where they approve.
- A plain sentence that approval is theirs alone and nothing has been charged yet.

Then record the storyboard id to the memory ledger via the read-merge-write in
`references/memory-protocol.md` (or a `pm_tasks_create` item): what the board is for, the price at
create, the date submitted. `marketing_video_pipeline_list` finds boards after the fact, but it returns
status summaries, not intent - a board whose WHY was never written down is a line item nobody can act on.
Then stop. Do not fan out single `marketing_generate_video` clips to assemble the same
video and route around the gate - it costs more, looks worse, and defeats a control the platform put there
deliberately. If the client is impatient, the honest answer is that the board waits on their click.

`marketing_storyboard_delete` destroys a board that never ran and is irreversible - confirm explicitly, and
never use it as tidy-up after a failed validation when `marketing_storyboard_update` fixes the field. Its
refusals are not obstacles: 409 `pipeline_running` means cancel the run first; 409 `pipeline_has_render_jobs`
means the board generated something, its render jobs carry the billing record, and that board is permanent.

### 3.4 After a human approves

- **Approval itself starts the run.** `marketing_video_pipeline_start` does NOT enqueue or approve
  anything: it is a manual re-kick for the rare ALREADY-APPROVED run that went idle (a per-minute reconcile
  cron is the automatic backstop). Against an unapproved board it returns 409 `storyboard_not_approved`,
  which is the correct answer - submit and wait for the human.
- `marketing_video_pipeline_status({ pipeline_id })` snapshots the run - the pipeline id is the storyboard
  id. Per-scene state (static/pending/reserved/generating/completed/failed) with each completed scene's
  `url`, quota pauses (`paused_until` means the run resumes ITSELF - a pause is not a failure), and the
  final media asset once compositing finishes. It returns immediately: check in, do NOT poll in a tight
  loop; a full board takes minutes and the platform drives it on its own. Review the per-scene `url`s as
  they complete (`references/self-review.md`) so one bad scene is caught before the client sees the cut.
- `marketing_video_pipeline_retry_scene` re-generates EXACTLY ONE failed clip scene (0-based index from
  status). Only a scene whose latest attempt FAILED can be retried; completed scenes keep their paid-for
  assets and are never regenerated. A 402 `monthly_cap_reached` means even the single retry clip will not
  fit the remaining allowance. The retry reserves a durable render job - if the call dies, recover it with
  `design_render_job_get`, do not re-retry blind.
- `marketing_video_pipeline_cancel` stops a run. Unsubmitted clips release their monthly-cap slots; a clip
  already generating was already paid for and is left to finalize - paid work is never discarded. Confirm
  first. A finished/failed/canceled run returns 409 `pipeline_already_terminal`.

If a scene keeps failing after a retry, the fix is in the board - but the board is now post-approval, so
`marketing_storyboard_update` will 409. Cancel, fix, re-create, and the human approves again; say the cost
of what already generated.

**The run has ears.** The moment a pipeline reaches `completed` or `failed` the platform files exactly
one agent-ops inbox item: category `design.video_completed` (severity info) or `design.video_failed`
(severity urgent), deduped on pipeline id plus outcome, with `pipeline_id`, `design_project_id`,
`design_title`, `result_media_asset_id` and `dashboard_url` in its metadata (a failure also carries a
clipped `error`). `agent_inbox_list({ category: 'design.video_failed' })` at the start of a session finds
the runs that died unwatched; `agent_inbox_get` reads one in full; `agent_inbox_resolve` closes the row
once the result is registered or the retry is filed, and never does anything else. A canceled run files
nothing (the person who canceled it was there). The item is visible on full and `marketing` keys; the
`marketing-design` profile does not grant `agent_inbox_`, so on that key `marketing_video_pipeline_list`
filtered by status is the equivalent sweep. The final render job's `warnings` (font degrades from the
storyboard's own canvases included) live on `design_render_job_get` for the pipeline's `renderJobId`.

---

## 4. Lane 3: one generated clip

`marketing_generate_video({ prompt, aspect_ratio })` produces one short clip at 720p. `duration_seconds`
(2 to 10) sets the length, and cost scales with it at roughly $0.10 per second - the ten-second default
is where the ~$1-per-clip figure comes from, and a 4-second cutdown is the cheap variant. PAID,
Premium-plan only, capped at 20 clips per account per month.

**Duration is a hint, and the response tells you what you got.** Several lanes snap the hint to the
lengths their provider bills in, and billing follows the RENDERED length: kling-2.5-turbo (what `auto`
resolves to when fal is configured) renders only 5s or 10s (a hint above 7 becomes 10s; omitted is 5s),
the fal Veo lanes (veo-3.1-fast, veo-3.1-lite) render 4s, 6s or 8s (up to 5 is 4s, up to 7 is 6s, else
8s; omitted is 8s), veo-3.1-google forwards the hint and enforces its own 4-8s upstream, omni-flash
honors any 1-10s, and kling-avatar-v2 follows its driving audio. So quote the snapped length in the
confirm ("a 9s ask bills as 10s on Kling"), and read back `duration_requested` (the clamped hint),
`duration_effective` (the worker-MEASURED length; null when unmeasured, NEVER 0 - a 0 from the worker is
its ffprobe failure sentinel, not a zero-length clip, so never regenerate off a null) and
`duration_note` (present whenever the rendered length is not the one requested). `duration_seconds` on
the response is the same measured value, null the same way.

1. **Pre-flight with `design_video_capabilities_get`** - can this account generate a clip at all, right
   now? It answers `{ videoEnabled, plan, used, limit, reason, message }`, and EVERY blocked outcome is
   HTTP 200: read `videoEnabled`, never the status code. Triage the `reason` before narrating a cause:
   `not_configured` and `render_service_unavailable` are environment problems, `plan_upgrade_required` and
   `monthly_cap_reached` are real account limits, and `cap_check_unavailable` is a TRANSIENT database error
   - retryable, and never grounds to tell anyone to upgrade or that they are out of clips.
2. **ALWAYS call `marketing_generate_video` with `dry_run: true` first** and tell the user the remaining
   quota before spending. A client with three clips left this month deserves to know before you use one.
3. Confirm the spend explicitly: prompt, aspect ratio, cost, remaining quota, then a yes. NEVER retry a
   generation that succeeded, and after an ambiguous timeout, check `design_render_job_get` (the call
   reserves a durable render job) or `media_library_list` for the clip BEFORE any second spend.
4. To animate an existing still - a product photo, a headshot, the premises - pass it as
   `reference_media_asset_id`. That is nearly always a better use of a paid clip than an invented scene:
   it is the client's real subject in motion. `aspect_ratio` follows the destination. `reference_mode`
   picks how the reference is used: `'animate'` moves the still itself; `'compose'` first builds a styled
   still FROM the reference and animates that - it spends one image-generation credit before the clip
   (gated by the image quota: 429 `image_generation_limit_reached`), and a failed compose is FATAL (the
   call fails without generating video; the image credit is the loss, never a silent fallback to a
   different look). When the compose succeeded and the VIDEO step then failed, the failure body carries
   `composed_still_asset_id` - a still already paid for and in the library - so the retry animates THAT
   (`reference_media_asset_id` plus `reference_mode: 'animate'`), never a second compose.
5. Iterating on a clip: pass `previous_interaction_id` to continue from an earlier generation - but ONLY
   an `interaction_id` that a previous `marketing_generate_video` response returned to THIS account. It
   is validated: a `fal|` handle and any handle that is not one of this account's own render jobs
   (`design_render_jobs.provider_operation`) is a 400 `invalid_request`, so a guessed or foreign id no
   longer becomes a fresh, separately billed clip. `seed` is honest the same way: `null` and `''` mean
   absent, and anything else that is not a finite number is a 400 rather than a silent seed 0. And pass
   `design_project_id` to link the paid clip to the design project it belongs to, so the spend shows up
   against the deliverable instead of floating free.
6. Log the clip against the monthly spend ledger (read-merge-write per `references/memory-protocol.md`):
   clips used, clips remaining, duration, what each was for. The 20-clip cap is managed from that ledger,
   not from whoever last remembered.

Lane 3 is wrong whenever the content is type or layout, whenever it needs more than one shot, and whenever
the library already has usable footage. There is no trim, crop, concatenate, or transition tool for
arbitrary MP4s anywhere in the registry, so three generated clips cannot be joined. That absence is exactly
why lane 2 exists.

---

## 5. Registering and attaching the finished asset

Generated images and video clips auto-register. **Design exports and stock-photo URLs do NOT** - register
those explicitly before attaching them anywhere.

**Lane 3** output auto-registers and returns a `media_asset_id`; nothing more is needed to make it
attachable. `generate_image` and `generate_image_set` behave the same for stills. So does
`design_voiceover_create` for narration MP3s - except the null-asset_id trap in 2.7.

**Lane 1** output does NOT auto-register. An unregistered `design_export_mp4` file cannot be attached by id,
so it cannot go on a post, into a collection, or into a report. Register it with
`media_library_register_external_url` (or `marketing_media_register_external_url`), then `media_update` for
a real name and tags, `media_folders_list` / `media_folder_create` to file it, and `media_collections_list`
/ `media_collection_create` / `media_collection_add_item` to group a campaign's assets.
`media_library_register_external_url_batch` covers several variants from one session. (A static PNG can
skip the dance: `design_publish_to_library` renders and registers in one call - but it is CREATE, never
sync, so a retry duplicates; see the canvas reference.)

Then close the loop on the design: call `design_update` a second time with `previewVideoUrl` set and
`canvasData` omitted, so the design autoplays in the gallery instead of showing a still. A
`design_export_image` PNG makes a good `featuredImageUrl` and post cover, and needs registering too.

**Lane 2** output comes out of the pipeline as video clips, which the rule above says auto-register - but
verify rather than assume: run `media_library_list` (or `marketing_media_list`) after the pipeline completes
and confirm the asset is there before telling anyone it is. If it is not, register it the same way as
lane 1.

**Imported footage** comes in through `media_library_register_external_url`, `media_upload`, or
`marketing_media_upload_base64`. Import is never a production credit.

Attaching, once registered: social posts via `social_create_post` with `media_urls`, targeting connected
accounts from `social_list_accounts`, or onto a post that already exists or is scheduled via
`social_update_post({ post_id, media_urls, media_types })`. Two rules on both: `media_urls` and
`media_types` are INDEX-ALIGNED (`video/mp4` for a clip, `image/png` for a still) and the publishers
trust the declared type over the URL extension, so always send them together; and on the update the
lists REPLACE the post's media wholesale - send every URL the post should carry, not a delta, and
replacing `media_urls` without `media_types` leaves the old types in place. A published or publishing
post is edit-locked (400). The URL is the asset's `mp4_url` / `file_url` from the library, or a design
export URL. The social lane's rules still apply - setting `scheduled_at` is publishing on a timer, and
no tool can approve a post; cross-channel via `content_create`.
Decisions worth keeping (aspect ratio, the animation style signed off, the storyboard template that worked)
go to the branding memory document (read-merge-write per `references/memory-protocol.md`), production
work items to `pm_tasks_create`. `media_usage_get` says where an asset is
used; `media_delete` refuses 409 `in_use` when tracked usage exists - never force past it (see the
brand-and-assets reference).

Naming caution: `marketing_design_*` runs parallel to `design_*` (list, get, export_image, export_mp4,
read-and-export only) and `marketing_media_*` parallel to `media_library_*`. Which set a session sees is a
KEY-PROFILE question, not an account setting - the `marketing-design` profile grants both prefixes. Prefer
`design_*` and `media_library_*`; a missing name means check the key's profile, and `list_departments` says
which departments the ACCOUNT has enabled.

---

## 6. The testimonial polish play (approved clip -> branded clip, live everywhere)

The one lane-1 play that ships straight to a PUBLIC surface, so it carries the sharpest warning here.

1. `marketing_testimonials_list` - the moderation queue, and the ONLY way to obtain a testimonial id.
   NO MEDIA URL FOR ANYTHING UNAPPROVED, EVER: only approved rows expose playable media.
2. `design_from_testimonial({ testimonial_id })` opens a Creative Studio draft on the APPROVED clip: a
   motion_graphic design whose canvas is one video layer, the recording registered by URL (no bytes
   copied, nothing billed, no render queued). Idempotent - `created: false` means the draft already
   existed and came back untouched. Hand back its `dashboard_url`.
3. Trim, caption, and brand it on the canvas under the normal round-trip rules, then render with
   `design_export_mp4` and keep the `jobId`.
4. Confirm the render finished: `design_render_job_get` must read `completed`. An unfinished job, a still,
   a non-mp4, or another account's job is a 400 `render_job_invalid` at the next step.
5. `marketing_testimonial_media_replace({ testimonial_id, render_job_id })` is **OUTWARD FACING AND
   IRREVERSIBLE**: on success the new video is live on every public surface - widgets, galleries, share
   pages - instantly, with no staging step and no undo. Confirm with the human BEFORE this call, showing
   the rendered clip. If the response carries `quote_needs_re_review: true`, the published quote was
   lifted from an AI snippet of the OLD recording and the trim may have cut the quoted words - raise it
   for human review, do not clear it yourself.

---

## 7. Capability gaps - name the gap and the fallback, never improvise

- **No agent approval of a storyboard.** By design. Fallback: `marketing_storyboard_submit_for_approval`
  and stop, with the scene, runtime, and cost summary.
- **No music or licensed-track tool.** Voiceover IS toolable (section 2.7); a track is a
  produce-outside-and-import job via `media_library_register_external_url` or `media_upload`. Do not tell
  a client the system will score their video.
- **No trim, crop, concatenate, or transition tool for arbitrary MP4s.** Sequencing and transitions exist
  only inside a lane 2 storyboard (`transition`, `transition_ms`, per-scene `camera`). A clip that needs
  recutting is rebuilt as a storyboard or a design, or handed back as a dashboard job.
- **No keyframes and no custom motion paths on the canvas.** The vocabulary is 15 entrance values (also
  usable as exits), 6 ambient loops, and 6 easings, with per-layer delay, duration, distance, and exit
  timing. Rich, but fixed: a bezier path, a bespoke keyframe curve, or a scroll-driven effect still has
  no tool.
- **No cancel and no mid-call progress for `design_export_mp4` or `design_video_rerender`** - but the
  returned `jobId` plus `design_render_job_get` is the after-the-fact status and recovery path (2.5,
  remembering the poll ADVANCES the job and may prompt), and `design_render_jobs_list` finds jobs whose
  ids were lost. Lane 2 has its own `marketing_video_pipeline_status` and
  `marketing_video_pipeline_cancel`.
- **Storyboards are listable only as summaries.** `marketing_video_pipeline_list` returns status rows,
  never the storyboard document, and `marketing_storyboard_get` is by-id only - so the WHY of each board
  still lives in the memory ledger recorded at submit time (3.3, `references/memory-protocol.md`).
- **No burned-in captions outside a storyboard.** `captions.style` is a storyboard field; animating your own
  text layers in a lane 1 design is not the same thing.
- **No custom brand fonts in a template re-render.** `design_export_mp4`, `design_export_image`,
  `design_publish_to_library` and the storyboard's final cut all carry the brand kit;
  `design_video_rerender` submits a template job with no font manifest, so its clip falls back.
- **No `creative` domain.** `branding` is the visual lane on both `account_context_get` and
  `talk_to_department`; `customer_avatar`, `before_after_grid`, and `website_design` are the other valid
  visual-adjacent domains.
- **`stock_photos_search` saves nothing**, and `stock_photos_download` is the website-project lane only
  (`{ url, project_id, save_path }`, writing to that project's S3 assets, NOT the media library). A stock
  still bound for a video must be registered into the library explicitly.

---

# Tool index for this reference

**Lane 1 (motion design):** `design_templates_list`, `design_create`, `design_state_get`, `design_get`,
`design_update` (CAS via `expectedSectionsVersion` - canvas reference, Part 4), `design_version_create`,
`design_export_image` (REQUIRES `id, canvas_json, width, height`), `design_export_mp4`,
`design_video_rerender`, `design_from_testimonial`, `marketing_testimonial_media_replace`
(outward-facing, irreversible).

**Render jobs:** `design_render_job_get` (the poll ADVANCES the job and may prompt; a skipped poll loses
nothing), `design_render_jobs_list` (plain read: `{ jobId, kind, status, progress, url, assetId,
designProjectId, billable, error }`).

**Lane 2 (storyboard):** `marketing_video_pipeline_list` (summaries only; find before create; approves
nothing), `marketing_storyboard_create`, `marketing_storyboard_get`, `marketing_storyboard_update`,
`marketing_storyboard_set_look`, `marketing_storyboard_submit_for_approval` (then STOP),
`marketing_storyboard_delete`, `marketing_video_pipeline_status`, `marketing_video_pipeline_start`,
`marketing_video_pipeline_retry_scene`, `marketing_video_pipeline_cancel`.

**Lane 3 (one clip):** `design_video_capabilities_get`, `marketing_generate_video` (`dry_run` first;
`duration_seconds` 2-10 as a hint the lane snaps, read back as `duration_requested` /
`duration_effective` (null, never 0, when unmeasured) / `duration_note`; `reference_mode` compose|animate
with `composed_still_asset_id` on a post-compose failure; `previous_interaction_id` only from a returned
`interaction_id` and validated against this account; a garbage `seed` is a 400; `design_project_id`
links the spend).

**Ears:** `agent_inbox_list` (categories `design.video_completed` / `design.video_failed`; full and
`marketing` keys), `agent_inbox_get`, `agent_inbox_resolve`.

**Voiceover:** `brand_guide_voiceovers_get`, `design_voices_list`, `design_voiceover_estimate`,
`design_voiceover_create`.

**Sourcing, registration and delivery:** `media_stock_video_search`, `media_library_list`,
`media_folders_list`, `media_library_register_external_url` / `_batch`, `media_upload`, `media_update`,
`design_publish_to_library` (PNG only; settled frame; never dedupes), `social_create_post` and
`social_update_post` (`media_urls` + index-aligned `media_types`; the update replaces the whole list).

**Persist and escalate:** memory write-back per `references/memory-protocol.md` (`memory_list` -> merge
-> `memory_update`), `pm_tasks_create`, `audit_query`.

**Approval:** none, by design. THE AGENT CANNOT APPROVE - a storyboard is approved by a human in the
dashboard, and no tool does it. Never assemble a multi-scene video from single clips to route around the
gate.
