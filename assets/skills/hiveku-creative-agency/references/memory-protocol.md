# Creative memory protocol: read-merge-write on the branding document

## What this covers / when to load this

The protocol for persisting creative state into Hiveku account memory without destroying it. Load it
before ANY `memory_create` / `memory_update` call in a creative session - the end-of-session persist,
the brand-system baseline after onboarding (brand-and-assets reference, Part 4 step 8), the
storyboard-id record at submit time, the paid-clip and voiceover spend log, the monthly audit. SKILL.md
carries the short rule; this file carries the mechanics, the recovery path, and what belongs in the
document.

## The domain is `branding`

There is NO `creative` memory domain. Department memory for visual work hydrates from
`account_context_get({ domain: 'branding' })`, so the creative department's persistent document lives at
domain `branding` (`website_design` also exists, for site-visual work). A document written to an
invented `creative` domain is one no agent ever reads back.

## The protocol

There is ONE `branding` memory document and `memory_update` REPLACES its content, so every write is
read-merge-write: `memory_list({ domain: 'branding' })`, take the `content` of the row it returns, merge
your additions in, then `memory_update({ memory_id, content })` with the whole merged body. A bare note
sent as the new content wipes the account's creative history - approved voices, spend ledger, storyboard
ledger, all of it. `memory_create({ type: 'memory', name: 'branding', content })` is correct exactly
ONCE per account, on the first run; a 409 means the document already exists and you were about to orphan
it - switch to the read-merge-write. `memory_update` takes only `memory_id` and `content`.

One catch on the read: `memory_list({ domain: 'branding' })` returns ACCOUNT-level rows only. A
project-scoped document needs `memory_list({ domain: 'branding', project_id })` or
`include_project_scoped: true`. Skip that and the account looks empty, you `memory_create` a second
document, and the history splits in two.

Recovery: every `memory_update` and `memory_delete` snapshots the prior content first, so a clobbered
document comes back via `memory_list_versions({ memory_id })` then
`memory_restore_version({ version_id })` - and versions persist after a delete, so this recovers deleted
entries too.

Local mirrors are SNAPSHOTS, not write paths: /hiveku:knowledge lands account memory, rules, and skills
under `memory/<dept>/`, `rules/<dept>/`, `skills/<dept>/`, and /hiveku:pull lands department data under
`hiveku-data/creative/*.json` and `hiveku-data/media/*.json`. Read them freely; write through the live
memory tools, then re-sync.

## What belongs in the document (5-10 dated lines per session, appended)

- **Brand decisions with dates:** palette hexes and roles, the type pairing, logo rules, and WHY - the
  reasoning outlives the session that made it.
- **Approved narrator voice_ids** with their usage notes (mirrored from `brand_guide_voiceovers_get`),
  plus any deliberately outside-the-set voice a human signed off.
- **The storyboard-id ledger, written at submit time:** board id, what it is for, price at create, date
  submitted, status when last checked. `marketing_video_pipeline_list` finds boards but not WHY they
  exist - the ledger is the intent record the weekly sweep works from.
- **The monthly spend ledger:** clips used and remaining against the 20-clip cap (with the
  `duration_effective` each rendered at), voiceover seconds consumed against the plan allowance, image
  generations as `media_image_quota` reports them (`used` of `limit` and `period.resets_at`; a null
  `remaining` is written as UNKNOWN, never as 0), and every `media_upscale` with its output megapixels
  (each is a slot plus real dollars). The caps are managed from this ledger, not from whoever last
  remembered.
- **Signed-off conventions:** animation style (which entrances, which easing, the one-loop rule),
  aspect ratios per channel, export sizes.
- **Open approvals:** boards awaiting the human, designs with unresolved comment threads, anything
  submitted and stopped at the gate.

No PII, ever: no customer names, emails, or phone numbers, and no testimonial subjects' personal
details. Ids and titles are enough.
