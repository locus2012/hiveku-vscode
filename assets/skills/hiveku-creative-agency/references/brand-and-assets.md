# The Brand System and the Media Library

This is the manual for the two things every piece of creative work depends on before a pixel gets made: the account's brand system (the brand guide, the visual-system context, customer avatars, before/after grids) and the media library (folders, collections, items, and the usage graph that says whether an asset is safe to delete). Load it when you are standing up a new client, about to generate or source imagery, hunting for an asset that may already exist, staring at a template that came back off-brand, or asked to delete something. The design-canvas manual owns the layered editor; the video manual owns storyboards and the pipeline. This one owns what is upstream of both: what makes output on-brand, and where the pixels live.

Two facts shape the rest. `design_templates_list` returns its 58-template library **already brand-substituted with the account's active brand guide**, so the guide is a live input to every template you pull, not documentation - a thin guide does not throw, it hands you a generic template and you ship generic creative. And the media library is the only place an asset gets a stable id you can attach by reference later, while **not everything that produces a pixel puts it there**. Those two silent failures are why this manual exists.

---

## Part 1. The rules that prevent damage

**Do not:**

- **R1.** No `account_context_get({ domain: 'creative' })`. There is no `creative` domain; the visual-system domain is `branding`. An unlisted value is a server-side rejection, not a soft fallback.
- **R2.** Do not generate before checking the library, and do not attach a design export or stock-photo URL by id - neither is in the library until you put it there (R14, Part 8).
- **R3.** Do not call `media_delete` without running `media_usage_get` first, and NEVER pass `force=true` to get past its 409 `in_use` refusal on your own judgment - that refusal is the system telling you live content depends on the asset.
- **R4.** Do not call `brand_guide_purge` without an explicit instruction naming what is being purged. `brand_guide_delete` SOFT-deletes one guide (flips `is_active`); `brand_guide_purge` hard-deletes an already-soft-deleted guide - it refuses 409 `still_active` on a live one and 409 `fk_constraint` while anything (typically custom fonts) still references it. The refusals are guardrails, not obstacles.
- **R4b.** Deletion targets are never derived by pattern. "Delete everything untagged / older than X / unused this quarter" is a refusal with a reversible alternative (`media_bulk_move` to an archive folder, a review list) - deletion takes explicit ids the client named, one `media_usage_get` each.
- **R5.** Do not use `stock_photos_download` to get an image into the Media Library. It cannot; it is the website-project lane only (Part 7).
- **R6.** Do not invent brand values. No accent color, no secondary typeface, no tone rule means ask the client or read it off their site. A guessed hex ships across every template afterwards.
- **R7.** Do not fabricate a logo. Not an SVG you drew, not a generated one, not a placeholder mark. A logo comes from the client.
- **R8.** Do not spend anything billable or take anything irreversible without confirming first: generation, upscales, MP4 renders, deletes, purges. A batch or an upscale is quoted from `media_image_quota` first, and a null `remaining` is UNKNOWN, not a green light.

**Do:**

- **R9.** `account_context_get({ domain: 'branding' })` before any visual work, the way `social` context comes first for a caption. It returns persona, brand voice, avatars, domain memory, skills, and rules.
- **R10.** Read the existing guide with `brand_guide_get` before writing one. Inherit and refine; a rival second guide fragments the system and you will not know which one the templates substitute.
- **R11.** Name and file every asset as you create it. An unnamed file in the root is one nobody finds again, so it gets regenerated.
- **R12.** Send generative and strategic visual questions to `talk_to_department({ domain: 'branding' })`, then persist the chosen output with the matching direct tool.
- **R13.** Hand back the dashboard URL every time. The human's job is to see and edit; a report without a link is a dead end.
- **R14.** Generated images and video clips auto-register. **Design exports and stock-photo URLs do NOT** - register those explicitly before attaching them anywhere.

---

## Part 2. Which domain, and where the visual context comes from

`branding` is the visual-system domain and it is valid for both `account_context_get` and `talk_to_department`. Three adjacent domains are valid for both as well, and visual work leans on them constantly: `customer_avatar` (who the creative speaks to), `before_after_grid` (the transformation it dramatizes), and `website_design` (the site's own visual language, when creative must match it).

`creative` is not valid for either. Neither is `web`, `email`, `pm`, `accounting`, `voice`, or `knowledge`. When you need something the branding agent does not cover, load a valid context domain, draft directly with that hydration, and say plainly that is what you are doing; `agent_identity_get` is the other option, returning a department's full identity bundle so you can act as it without an upstream call - but it takes the SAME 15 domains as `account_context_get`, so it is not a way to reach `creative`, `web`, `email`, `pm`, `voice` or `knowledge`; pass it one of the valid domains or not at all. `list_departments` tells you which departments THIS account has enabled - a domain being in the enum is not entitlement.

**Key-profile caveat.** `account_context_get` and `agent_identity_get` match no prefix or name in the `marketing-design` or `marketing` key profiles - on a department-scoped key both are tool-not-found, full-profile only. On a scoped key, hydrate through `talk_to_department` (always available on every profile) plus `brand_guide_get` and the `memory_` tools, and say which path you used.

Re-read the `instructions` field `account_context_get` returns before every generative call. It is the account's standing orders, and it changes.

---

## Part 3. The brand guide, and what it actually drives

Tools: `brand_guide_list`, `brand_guide_get`, `brand_guide_create`, `brand_guide_update`, `brand_guide_delete`, `brand_guide_purge`, `brand_guide_set_logo`, plus the font family (`brand_guide_font_create` / `_get` / `_list` / `_update` / `_delete`) and the narration read (`brand_guide_voiceovers_get`).

Treat the guide as a live configuration object with three consumers, not a PDF:

1. **Template substitution.** `design_templates_list` returns the 58-template library (14 canvas sizes, including the six wide formats added 2026-09-02: two 1200x600 email headers in the Email Header category, an Open Graph 1200x630 card, a YouTube 1280x720 thumbnail, a LinkedIn 1584x396 banner and an X 1500x500 header) already substituted with the active guide, plus artboard presets by category (Social Media / Presentation / Print / Ads / Email). Each template carries a ready-to-use `canvasData` payload you pipe straight into `design_create`'s `initialCanvasData`, so the guide decides what colors and type land on the canvas before you touch it. A generic-looking template is a symptom: fix the guide, do not repaint layer by layer.
2. **Image generation.** `generate_image` is brand-aware by default (`use_brand: false` opts out) and `generate_image_set` shares one brand context across up to ten prompts. That awareness comes from the account's brand system, not your prompt string: strengthening the guide improves every future generation, stuffing colors into one prompt improves one image. Both say whether it landed: `brand_applied` true, or `brand_skipped_reason: 'no_active_brand_guide'` (no ACTIVE guide - the image generated unbranded and the slot was spent), and a failed guide READ is 503 `brand_unavailable` before any slot is reserved. The thing a fresh account gets first is therefore the guide, not a prompt full of hex codes.
3. **The branding agent.** `talk_to_department({ domain: 'branding' })` runs with the guide hydrated, so a palette rationale or type pairing comes back inside the client's system rather than generic.

**Read before writing.** `brand_guide_list`, then `brand_guide_get` on the one that matters. Do not assume the field shape from this manual - read the tool's own schema and an existing guide's payload. A field the schema does not declare is a silent no-op on mutating calls, not an error.

**The logo is its own call**, because it is an asset reference, not a text field. Get the file into the library first (`media_upload`, or `media_library_register_external_url` for one already at a URL), then `brand_guide_set_logo` - it names the six slots explicitly (`logo_primary_url`, `logo_secondary_url`, `logo_wordmark_url`, `logo_icon_url`, `logo_dark_url` for light backgrounds, `logo_light_url` for dark backgrounds), updates only the fields supplied, and clearing a slot takes an explicit `null`, not an omission. URLs must be http(s) and should point at library assets. R7 stands: the logo comes from the client.

**Custom fonts are toolable, and since 2026-09-02 they RENDER** - every server render (`design_export_image`, `design_export_mp4`, `design_publish_to_library`, the storyboard pipeline's final cut) attaches the account's active `brand_custom_fonts` rows to the job, matched case-insensitively on `font_family` against the families the canvas uses, so a layer set in an uploaded family renders in it instead of falling back to sans-serif. Two things do not: a `design_video_rerender` template clip (the worker's template lane takes no fonts), and any row whose `css_font_face` the worker cannot use. A five-tool family, with the traps worth knowing before the first call:

- `brand_guide_font_create` requires `font_family` and `display_name`. Only `css_font_face` is ever rendered - the generated brand stylesheet copies it verbatim and IGNORES the four `file_*_url` slots completely, so a row created from file URLs alone registers a font no page can load (and `upload_status` reads 'ready' regardless; it is hardcoded server-side). What `css_font_face` MUST contain, because the render worker screens it structurally and drops anything else: nothing but `@font-face { ... }` blocks (no `@import`, no selectors, no nested at-rules), every `src` target an `http(s)` URL with no embedded credentials or a `data:` font URL (`font/...`, `application/font...`, `application/octet-stream`), no CSS escape sequences (`\75 rl(` is refused outright), no empty `url()`, at most 512KB per entry and 40 faces per render. The create and update routes store the string verbatim with no validation, so a bad rule is a 201 that fails silently at every render: a dropped font degrades that layer to the fallback stack and is reported only as a line in the export's `warnings`. Prove every new font with one `design_export_image` and read `warnings`. A numeric-looking `weight` goes through Number(), so "bold" becomes NaN and the create 500s - omit it for the default.
- `brand_guide_font_update` whitelists display_name, the file URLs, css_font_face, is_variable, variable_axes, and upload_status - NOT font_family, weight, or style, and NOT is_active. A rename or weight change returns 200 having changed only `updated_at`; identity changes take a fresh create.
- `brand_guide_font_delete` is a SOFT delete that is one-way from this surface: nothing here accepts `is_active`, so the font cannot be revived, and the tombstone keeps its (family, weight, style) unique slot forever - re-registering the identical font answers 409 while `brand_guide_font_list` (which filters `is_active=true`) shows an empty shelf. `brand_guide_font_get` by id is the only read that sees the tombstone; use it to explain a "mystery" 409. The only way back is a different weight or style.

Font LICENSING is still a human matter: name the typeface in the guide, register the files, and raise licensing as a `pm_tasks_create` task.

**Approved narration voices** live on the guide too: `brand_guide_voiceovers_get` returns the account's approved narrators with per-voice `usage_notes` and a `default_voice`. It is read-only BY DESIGN - approving a narrator is a human brand decision made in the brand UI, so an agent may choose from the set but can never widen it. The full picking-and-pricing flow is in the video reference.

**Activation.** There is no `brand_guide_set_active` tool in the registry. With more than one guide, the empirical check for which is substituting is `design_templates_list`; the durable fix is dashboard-side, and tell the client that is where it lives. Do not guess, and do not create a third guide to route around it.

---

## Part 4. Play: standing up a new client's brand system from scratch

The first hour on a new account. Nothing downstream is worth doing until this is done, because every template, every generation, and every department answer reads from what you build here.

**1 - Establish what exists.** `get_account_info` for the tenant, `list_departments` for what is enabled, `brand_guide_list` (a guide already there makes this a refine job, R10), then `media_library_list` and `media_folders_list` - nine times out of ten the library holds more than the client remembers. Finish with `account_context_get({ domain: 'branding' })` for persona, voice, avatars, memory, and rules; even a barely-onboarded account usually has voice notes and an avatar, and those constrain palette and type more than they look like they will.

**2 - Collect the raw material from the client.** Logo files (all lockups, ideally with transparency), primary and secondary colors as hex, the typefaces, existing photography, and one sentence on how the brand should feel. Ask for it as a list; do not fill the gaps yourself (R6).

**3 - Get assets in and organized before the guide.** Folder skeleton first with `media_folder_create` so nothing lands loose: logos, photography, graphics, video, client-supplied. Then `media_upload` for files the client hands you and `media_library_register_external_url` (or `..._batch`) for anything already hosted - a Drive export, the existing site's images, a photographer's delivery link. Name every item as you go (R11).

**4 - Draft the direction with the department agent.** `talk_to_department({ domain: 'branding', message })` carrying the raw material: colors, type, the feel sentence, the avatars. Ask for a palette with roles (primary, secondary, accent, neutral, surface), a type pairing with weights for display versus body, and a few lines of tone-of-voice-for-visuals. Confirm before persisting - a palette is the most expensive thing to change later, since it is baked into every design already made.

**5 - Persist the guide.** `brand_guide_create` with the agreed values, then `brand_guide_set_logo` pointing at the library asset from step 3. Refine with `brand_guide_update`, never a second guide.

**6 - Prove it substituted.** `design_templates_list`. Client colors and type coming back means the guide is live and every later template pull and generation is on-brand. If not, stop and fix the guide (Part 3, activation) rather than hand-painting canvases forever.

**7 - Build one artifact as proof.** Pipe one substituted template's `canvasData` into `design_create` and hand back the `dashboardUrl`. It is immediately editable there, which is the point: the client sees the system applied and can push on it while it is cheap to change.

**8 - Capture the avatars and the proof grids** (Part 5), then **record the decisions**: palette, type, logo rules, and reasoning into the `branding` memory document via the read-merge-write in `references/memory-protocol.md` (a bare `memory_create` on an account with history 409s, or worse, forks the document); follow-up work (missing lockups, photo shoot, font licensing) as `pm_tasks_create` items, not a line in a chat message.

---

## Part 5. Avatars and before/after grids

**Customer avatars** are who the creative talks to. They arrive in the `account_context_get({ domain: 'branding' })` bundle and have their own domain (`customer_avatar`) for context and department chat. Use them concretely: the avatar decides whether a photo is a person in workwear or in a boardroom, whether the type reads warm or clinical, and which transformation is worth showing. Creative made without one loaded is made for nobody in particular, and it looks it.

They are also directly writable, so a new client's personas get built here, not just read: `customer_avatar_list` / `customer_avatar_get` to read, `customer_avatar_create` (name required; the full ICP spec flat or inside `avatar_data`, including a canonical `buying_behavior` shape the dashboard renders), `customer_avatar_update` to refine, and `customer_avatar_populate` to LLM-enrich a sparse one from GROUNDED context - it refuses with `context_insufficient` when the account has no brand guide and no urls/queries/notes were supplied, which is the honest answer, not an error to route around. Snapshot before a rewrite with `customer_avatar_version_create` (it snapshots the PERSISTED row; `change_message` is the only body field it reads). **`customer_avatar_version_restore` OVERWRITES the live avatar on the first call - no confirm parameter, no body.** It normally auto-snapshots current state first so restoring the returned `auto_snapshot_version` undoes it, but the auto-snapshot can be abandoned under contention while the restore proceeds anyway - treat restore as destructive, confirm with the human, and read `auto_snapshot_version` back before relying on it. `customer_avatar_delete` exists; same deletion doctrine as everything else here.

**Before/after grids** are the transformation proof, and they are first-class objects: `before_after_grid_list`, `before_after_grid_get`, `before_after_grid_create`, `before_after_grid_update`, `before_after_grid_delete`, plus two that do the real work. `before_after_grid_populate` fills a grid instead of making you assemble it item by item. `before_after_grid_link_to_avatar` binds a grid to a customer avatar, so the transformation is attached to the persona it must convince instead of floating free. Read both schemas before the first call - this manual names them and what they are for, not their argument shapes. `talk_to_department({ domain: 'before_after_grid' })` is the agent for which transformations are worth building.

A before/after grid is the highest-converting visual a service business owns and the one an image generator cannot fabricate honestly: both halves are real photographs of real work. Build the grid from the media library, link it to the avatar, then let the design canvas dramatize it. Never generate a "before".

---

## Part 6. The media library model

Three levels, and they are not interchangeable.

**Items** are the assets: `media_library_list` to browse and search, `media_library_get` for one full record, `media_update` for metadata, `media_delete` to remove, `media_usage_get` to find where it is used before you do (Part 9). **Bytes are immutable.** `media_update` changes title, alt text, caption, description, tags and folder only; a body carrying `file_url`, `file_path`, `s3_key`, `file_size`, `mime_type`, `media_type`, `width`, `height`, `duration` or `ai_metadata` is a 400 `immutable_field` naming the offender, with nothing written. Every pixel operation makes a NEW row that points back at its parent through `ai_metadata.parent_media_asset_id`: `media_transform` (crop, resize, re-encode; free), `media_upscale` (fal clarity; paid), and `media_import_url` (bytes from a URL). None of them touches the source, so the old id keeps working everywhere it is used.

**Folders** are storage: one asset lives in one place. `media_folders_list`, `media_folder_create`, `media_folder_update`, `media_folder_delete`. Folders are for filing - logos, photography, graphics, video.

**Collections** are curated sets: one asset can belong to many. `media_collections_list`, `media_collection_create`, `media_collection_get`, `media_collection_update`, `media_collection_delete`, `media_collection_add_item`, `media_collection_remove_item`. Collections are for use - the launch kit, the hero shortlist, the approved headshots.

One item, many collections. People reach for folders to do a collection's job, and then the same photo is uploaded four times to sit in four campaigns.

**A parallel naming exists.** `marketing_media_list`, `marketing_media_get`, `marketing_media_folders`, `marketing_media_register_external_url`, and `marketing_media_upload_base64` are a second surface over the same account-level library (media_assets - NOT the website builder-project `assets_*` files). Both sets are real; which a session sees is a key-profile question (the `marketing-design` profile grants both prefixes), so prefer `media_*` and stay consistent in-session. For bytes you hold locally, `media_upload` takes base64 `content` (up to 50MB) just as `marketing_media_upload_base64` does.

**Moving assets between folders is toolable.** `media_update` accepts `folder_id` for one asset; `media_bulk_move` reassigns the folder of 1 to 200 assets in one call - the library-reorganization chore the monthly audit prescribes. Its contract has teeth: OMITTING `targetFolderId` is a 400 while an explicit `null` moves assets to the library root; nothing is written unless the whole input validates (a non-uuid, an empty array, or >200 ids is a 422); and a 200 can still be a PARTIAL move - ids that do not belong to this account come back in `skipped_asset_ids` while `updatedCount` covers only what moved, so ALWAYS read `skipped_asset_ids` and report a short count as partial, never as done. Never delete and re-upload to "move" - that orphans every reference to the old id.

---

## Part 7. Getting pixels in: five lanes

**Lane 0 - The quota read.** `media_image_quota` before any `generate_image_set` or `media_upscale`: no arguments, always 200, `{ used, limit, unlimited, remaining, stored_used, stored_remaining, period, reason?, message?, note? }`. It reads the same counter the generation reserve debits, so `remaining` is the number of images the next batch can still produce. `limit` 0 means unlimited and `remaining` is then null; `reason: 'read_failed'` means every number is null. Null is UNKNOWN in both cases - never "nothing left", never "go ahead". `period.lapsed` true means the stored counter has not rolled yet and the route reports the post-reset posture the next generation will actually meet, with the raw counter in `stored_used`. One counter, two refusals downstream: the generate tools answer 429 `budget_exceeded` at the cap, `media_upscale` answers 402 `quota_exceeded`.

**Lane 1 - Generate.** `generate_image` for a single visual: brand-aware by default (`use_brand: false` opts out), auto-registers a media asset, returns a `media_asset_id` you can attach immediately. `target_width` / `target_height` produce exact output dimensions - an email header at 1200x600, a LinkedIn banner at 1584x396 - instead of the nearest aspect bucket. `mode: 'modify'` with `reference_media_asset_ids` (1 to 4 Media Library image ids) edits FROM references rather than inventing: restage a real product shot, extend a real background, relight a real photo. References must be library assets, so register an external image first via `media_library_register_external_url`. The `model` list also carries `flux`, `flux-pro` and `recraft`; `seed` and `negative_prompt` work on those lanes only and are an `invalid_request` error elsewhere, never silently dropped. One rule above all of it: generated TEXT AND LOGOS ARE GARBAGE - every word, price, and mark belongs on a canvas layer, and prompts name photographic subjects only. `generate_image_set` runs up to ten prompts on one brand context: a top-level `use_brand` is the batch default (per-prompt overrides it either way) and a top-level `target_width` / `target_height` frames every prompt without its own (a per-prompt pair REPLACES the top-level pair entirely, never half-and-half). Per-prompt failures land in `errors[]` rather than failing the batch - read `errors[]` and report a partial set as partial - and every success carries `brand_applied`, with `brand_skipped_reason: 'no_active_brand_guide'` when the account has no active guide: those images are unbranded and still debited, so the handoff says so. Billable: confirm first (R8), quota read first (Lane 0).

**Lane 2 - Client-supplied files.** `media_upload` for a file you have, `marketing_media_upload_base64` for bytes. Both land in the library with an id.

**Lane 3 - Anything already at a URL.** Two tools, and the difference is whether the pixels are yours. `media_library_register_external_url` for one, `media_library_register_external_url_batch` for a set, store a POINTER at somebody else's URL: fine for a photographer's delivery link you will re-import later, fatal for a thumbnail the day that origin dies. `media_import_url({ url, folder_id?, title?, tags? })` copies the BYTES: SSRF-guarded fetch, 25MB streamed cap, image-only (SVG refused as `unsupported_format`), sniffed for real dimensions, uploaded to the account's own S3 and registered as a new row (`source_type` 'import', the origin kept on `origin_url`). Not a generation: no quota slot, one row against `media_storage_limit_mb`, and nothing dedupes on the origin URL, so importing twice makes two rows. A 500 `register_failed` means the bytes ARE on S3 - check `media_library_list` before re-importing. Never describe an imported or registered clip as generated.

**Lane 5 - Derive from what you own.** `media_transform({ asset_id, resize?, crop?, format?, quality? })` is the free lane: at least one of `resize { width, height, fit: 'cover' | 'contain' }`, `crop { left, top, width, height }` (source pixels, bounds-checked) or `format 'png' | 'jpeg' | 'webp'` (`quality` 1-100 requires `format`), applied crop then resize then encode, output capped at 4096px per side. No quota slot, no model - sharp on bytes you already have - so an exact-slot variant of a real photo is a transform, never a regeneration. `media_upscale({ asset_id, scale? })` is the paid lane: fal clarity at `scale` 1-4 (default 2), refused 400 before submit when source pixels times scale squared exceed 32 output megapixels, and it COSTS TWICE - one image-generation slot (402 `quota_exceeded` when spent) plus $0.03 per output megapixel rounded up, billed against AI credits on every branch after the worker accepts the job, even when the output later fails to upload or register. The source is re-measured from bytes on every call (the stored width and height are never trusted). Use it only when `media_transform` cannot help because the pixels are genuinely not there, one confirmed asset at a time, `media_image_quota` first.

**Lane 4 - Stock, which splits three ways on search and two on destination.** This is the trap.

- `stock_photos_search` searches **Unsplash + Pexels only** and returns `{ url, thumbnail, photographer, source, attribution }`. It **saves nothing**: a URL on someone else's host, no id, no library record, nothing to attach.
- `stock_photos_pixabay_search` is the **only Pixabay source**, and the only one of the three that also carries illustrations and vectors. Each asset carries a `pixabay` block with a ready-to-paste attribution line. SILENT FAILURE: every error path ALSO returns `assets: []` with a populated pagination block, so an empty array is NOT "no photos matched" - branch on the HTTP status or the top-level `error` field, and a 412 `not_configured` means the API key is unset and no retry will clear it. Report a failed source as a FAILED source, never as an empty catalog.
- `media_stock_video_search` is the **only stock FOOTAGE search** (free Pexels + Pixabay video); its provider-prefixed `id` is what a storyboard `stock` scene stores. Read `providerErrors` on every call - a failed provider contributes zero rows on a 200 `success: true`, so half a catalog looks like the whole catalog.
- `stock_photos_download` is the **website-project lane only**. It requires `{ url, project_id, save_path }` and writes into that project's S3 assets, putting **nothing** in the Media Library. Use it when the destination is a page on the client's site. `project_id` here means a WEBSITE project: `sites_list` is the source of those ids - `list_projects` / `get_project` return pm_projects, NOT the buildable code projects, and an id from them is the wrong kind. Flag: the `marketing-design` key profile grants neither `sites_list` nor the website-project reads, so on a scoped key this lane needs a web-side session or a full-profile key - say so instead of guessing an id.
- To get a stock photo into the Media Library, take the `url` from a search and register it with `media_library_register_external_url`. That is the only path.

Carry `photographer`, `source`, and `attribution` into the registered asset's metadata. Some licenses require attribution at point of use, and losing the fields means re-finding the photo to publish it legally.

**The register rule, because it is the one that silently breaks attachments:**

Generated images and video clips auto-register. **Design exports and stock-photo URLs do NOT** - register those explicitly before attaching them anywhere.

A `design_export_image` PNG and a `design_export_mp4` render are outputs, not library assets. If the export will be reused, register it first or the attachment has nothing to point at. For a finished static design, `design_publish_to_library` renders and registers the PNG in one call - but it is CREATE, never sync: nothing dedupes, so a second publish or a retry after its 504 leaves two library entries. Once per finished design, and check `media_library_list` before retrying a timeout.

---

## Part 8. Reuse before generate

Generation is billed per image and video runs roughly a dollar a clip on a metered, capped plan; reuse costs nothing. Credibility settles it harder still: for products, team, premises, vehicles, completed work, anything a customer could verify, real photography beats a render every time. A generated "team photo" of people who do not work there is a trust problem, not a shortcut.

Order of preference:

1. **The library.** `media_library_list`, `media_collections_list`, `media_folders_list` first, every time. Keyword search, then browse the folder you would have filed it in. The most common cause of a duplicate generation is not looking.
2. **The client.** Real-world subject, no shot on file: ask. A photo from the client's phone outperforms a generated one and costs nothing.
3. **Stock**, via `stock_photos_search` plus registration, for generic context - backgrounds, textures, anything with no brand specificity.
4. **Generation**, for concepts, illustrations, and composites that cannot be photographed. That is where `generate_image` earns its cost.

Three more levers before a from-scratch generation: a real photo at the wrong size or format is a free `media_transform` (a new row, the source untouched), a still can be animated rather than re-shot (`marketing_generate_video` takes an existing asset as `reference_media_asset_id`, and the design canvas animates a still per layer at no generation cost at all), and a real photo can be modified rather than replaced (`generate_image` with `mode: 'modify'` and `reference_media_asset_ids` restages or relights the client's actual product instead of inventing a lookalike). `media_upscale` sits after all of these: it is the only derivation that spends.

When generation IS the right rung and the prompt matters, `media_ai_enhance_prompt` turns a rough post idea into one generation-ready prompt - but be honest about its price: it COSTS MONEY ON EVERY CALL (a full tool-enabled agent turn hydrated with the account's memory and brand voice, metered against AI spend, seconds to tens of seconds of latency) and WRITES NOTHING itself - no asset, no post. Use it before a batch or a high-stakes hero image, where one better prompt saves several paid re-generations; never reflexively in front of every `generate_image`.

---

## Part 9. Deleting safely

**`media_usage_get` before `media_delete`. Always.**

An asset here is referenced by id from places the library view does not show you: social posts, design canvases, brand guides, website projects, campaigns. `media_usage_get` tells you where (`{ usage_count, usage: [...] }` from the usage-tracking table). Run it, read the list back, and get an explicit yes before deleting anything with a non-empty usage list. `media_delete` is a HARD delete (row plus S3 purge) with one guardrail: it refuses 409 `in_use` when tracked usage rows exist, and `force=true` overrides that and accepts the orphan. Never pass `force` on your own judgment - only on an explicit instruction that names the asset AND acknowledges what breaks. And do not treat the 409 as the whole safety net: usage tracking covers what it tracks, so a reference it missed still breaks later, in the client's dashboard, as a broken layer in a design they were about to send. Deletion is one asset per call, ids named by the client, never derived by pattern (R4b).

Same for `media_folder_delete` and `media_collection_delete` - a collection is a view, not a container, but confirm that on this account's surface before using either as cleanup. `brand_guide_delete` and especially `brand_guide_purge` top the ladder (R4). Nothing here has an undo tool: the design canvas has version history via `design_version_create` and `design_versions_list`, the media library does not. `audit_query` (always available) is the after-the-fact record - which key deleted what, when - not a restore.

---

## Part 10. What has no tool, and what to do instead

Say each of these plainly rather than routing around it silently.

- **Which brand guide is active.** No `brand_guide_set_active`. Verify through `design_templates_list`; set it in the dashboard.
- **Extracting a palette from a logo file.** No tool. Read the colors from `account_context_get({ domain: 'branding' })`, from the client's site, or ask.
- **Licensing a font.** Registration is toolable now (`brand_guide_font_create`, Part 3) but licensing is not: raise it as a `pm_tasks_create` task.
- **Widening the approved narrator set.** `brand_guide_voiceovers_get` is read-only by design; a new approved voice is a human decision in the brand UI.
- **Bulk delete.** `media_delete` is one asset per call. Given R3 and R4b, that is a feature. (Bulk MOVE exists - `media_bulk_move`, Part 6 - which is the reversible alternative to offer.)
- **A brand-compliance check on finished creative.** Nothing scores a design against the guide. `design_state_get` returns an element-by-element read of position, size, style, text, and animation - compare fills and fonts yourself, report the diff, and mark it as judgment, not a measured score.
- **Approving anything.** No creative approval tool exists in this lane. "**THE AGENT CANNOT APPROVE: after creating, submit for approval and stop.**" That is written about storyboards and it is the rule everywhere here: you build, the human approves, in the dashboard.

---

## Part 11. Pitfalls

Every trap here is silent.

- **`stock_photos_search` saved nothing** - no asset, no id, nothing to attach - and **`stock_photos_download` did not put it in the Media Library** either; it wrote into a website project's S3 at `save_path`. Register the URL, or the design export, or you accomplished nothing, and carry `photographer`, `source`, `attribution` across when you do.
- **Undeclared arguments are dropped on mutating calls** - 200, nothing changed. Read the schema; do not infer field names from this manual or a sibling tool.
- **Two naming surfaces exist for the same library.** `media_*` and `marketing_media_*` are both real, and which a session sees is a KEY-PROFILE question, not an account setting (the `marketing-design` profile grants both prefixes). Prefer `media_library_*` / `media_*`, stay consistent in-session, and treat a missing name as a profile question first.
- **A search that returns empty is not proof of an empty catalog.** All three stock searches fail silently as partial or empty results (Part 7) - branch on status / `providerErrors` / `error`, and report failed sources as failed, not zero.
- **A generic-looking template is a guide problem**, and guide presence is not guide activation.
- **`brand_applied: false` on a generated image is a spent slot and an unbranded picture.** `no_active_brand_guide` is the usual reason on a fresh account; the fix is activating a guide, and the honest handoff names the image as unbranded.
- **`media_image_quota` `remaining: null` is unknown, not zero and not unlimited-go-ahead** (read `unlimited` and `reason`); and the same counter answers 429 `budget_exceeded` on the generate tools but 402 `quota_exceeded` on `media_upscale`.
- **An upscale timeout is usually a paid job.** fal bills once the worker accepts; a client-side timeout or a 503 `provider_unavailable` at stage poll/render/timeout is a check of `media_library_list` (newest, title ending `(upscaled)`) before any second call.
- **A font that could not load did not fail the render.** It fell back and left one line in `warnings`; a 200 with a font warning is a brand-wrong export, and the fix is the font row's `css_font_face`, not the canvas.
- **Confirm before anything billable or irreversible**, say so before a long render starts, and finish by handing back the dashboard URL.

---

# Tool index for this reference

**Brand system:** `brand_guide_list`, `brand_guide_get`, `brand_guide_create`, `brand_guide_update`, `brand_guide_delete` (soft), `brand_guide_purge` (hard, tombstones only), `brand_guide_set_logo`, `brand_guide_font_create` / `_get` / `_list` / `_update` / `_delete` (`css_font_face` renders server-side; @font-face blocks with http(s) or data: font URLs only, screened at the worker, degrades with a `warnings` line), `brand_guide_voiceovers_get`, `before_after_grid_list` / `_get` / `_create` / `_update` / `_delete` / `_populate` / `_link_to_avatar`.

**Avatars:** `customer_avatar_list` / `_get` / `_create` / `_update` / `_delete` / `_populate`, `customer_avatar_version_create` / `_list` / `_get` / `_restore`.

**Context and departments:** `account_context_get`, `agent_identity_get` (both full-profile only - Part 2 caveat), `talk_to_department`, `list_departments` (always available). Valid domains used here: `branding`, `customer_avatar`, `before_after_grid`, `website_design`, `social`; invalid: `creative`, `web`, `email`, `pm`, `accounting`, `voice`, `knowledge`.

**Media library:** `media_library_list`, `media_library_get`, `media_upload`, `media_update` (metadata only; the physical columns are 400 `immutable_field`), `media_delete`, `media_usage_get`, `media_bulk_move`, `media_library_register_external_url`, `media_library_register_external_url_batch` (pointers), `media_import_url` (bytes), `media_transform` (free derivative), `media_upscale` (paid derivative: one slot plus $0.03 per output megapixel; 32MP cap), `media_image_quota` (the pre-flight read), `media_folders_list`, `media_folder_create` / `_update` / `_delete`, `media_collections_list`, `media_collection_create` / `_get` / `_update` / `_delete` / `_add_item` / `_remove_item`; parallel surface `marketing_media_list` / `_get` / `_folders` / `_register_external_url` / `_upload_base64`.

**Images and stock:** `generate_image` (brand-aware by default via `use_brand`, reporting `brand_applied` / `brand_skipped_reason`; `target_width` / `target_height` for exact dims; `mode: 'modify'` + `reference_media_asset_ids`; models incl. `flux` / `flux-pro` / `recraft` with fal-only `seed` / `negative_prompt`), `generate_image_set` (top-level `use_brand` and `target_width` / `target_height`, per-prompt overrides replace), `media_ai_enhance_prompt`, `stock_photos_search` (Unsplash + Pexels), `stock_photos_pixabay_search`, `media_stock_video_search`, `stock_photos_download` (website-project lane; `project_id` from `sites_list`).

**Design canvas, referenced across the boundary:** `design_templates_list`, `design_create`, `design_state_get`, `design_version_create`, `design_versions_list`, `design_export_image` (requires `id, canvas_json, width, height`), `design_export_mp4`, `design_publish_to_library` (`set_as_featured` is the thumbnail path).

**Memory write-back:** `memory_list` -> merge -> `memory_update` (`memory_create` once; 409 = exists), per `references/memory-protocol.md`; recovery via `memory_list_versions` + `memory_restore_version`.

**Named as NOT existing, with the fallback stated:** `brand_guide_set_active` (verify via `design_templates_list`, activate in the dashboard), palette extraction (read the guide or ask), media bulk delete (one `media_delete` per named id), a brand-compliance scorer (diff by hand via `design_state_get`, mark as judgment), and any creative approval tool.
