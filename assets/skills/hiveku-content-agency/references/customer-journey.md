# The customer journey map: how to build one that is worth having

Load this before creating, restructuring, or auditing a customer journey, and before
proposing assets against one.

A journey map that lists five stage names and a sentence each is a diagram. It costs an
hour and changes nothing. A journey map worth having answers four questions the account
cannot otherwise answer: who is moving through it, what belief has to change at each step,
what asset changes that belief, and whether any of it is working. Everything below is in
service of those four.

---

## 1. The spine: five stages of awareness, not five stages of funnel

Default to Eugene Schwartz's ladder from *Breakthrough Advertising*, because it names the
thing that actually has to change:

| Stage | What the person knows | What must change |
|---|---|---|
| Unaware | Does not know they have the problem | Name the problem in their words |
| Problem Aware | Feels the problem, no vocabulary for a fix | Show a category of solution exists |
| Solution Aware | Knows the category, not the players | Show why this approach beats the others |
| Product Aware | Knows this provider, not convinced | Remove the specific risk holding them |
| Most Aware | Convinced, has not acted | Make acting easy and give a reason for now |

"Awareness / Consideration / Decision" describes what the *business* sees. The awareness
ladder describes what the *person* believes, and a belief is what an asset can move. Use
the business vocabulary when the client insists, but write the stage descriptions against
the belief.

**Every transition is the unit of work, not every stage.** A five-stage journey has four
transitions, and a transition is where money is lost. When you report, report transitions.

## 2. Who: link the ICPs first

`customer_journey_avatar_link({ journey_id, avatar_id, is_primary })`. A journey with no
linked persona is a journey for nobody, and it reads like one.

Two relationships exist and they are not the same. `customer_journey_avatars` is the real
many-to-many; `customer_journey_maps.target_avatar_id` is a deprecated single pointer kept
as a mirror of the primary link. `customer_journey_avatar_list` is **not a pure read** - it
backfills the legacy column into the link table on the way past.

Multiple personas move through the same journey differently. If two personas need
materially different assets at the same stage, that is two journeys, not one map with
hedged copy.

## 3. What: TRAFFIC, HOOK, CONVERT for every transition

Every transition needs all three legs. Missing one is why a stage stalls:

- **TRAFFIC** - how they arrive at this transition at all. A written social hook, a paid
  audience plus its hook, an SEO query plus the title that would rank for it.
- **HOOK** - what earns the next step. A lead magnet with a title, a format, and a
  three-bullet outline. Early on the ladder it names the problem; mid-ladder it compares;
  late it reverses risk.
- **CONVERT** - what closes it. A landing headline written out, or a new page proposed.

**Write the hook, do not describe it.** "A case study about results" is a failed proposal.
The brief is rendered to prospects on the public journey page, so it has to read like
something a person would click. If you cannot write the hook, you do not yet understand the
transition well enough to propose against it.

**Harvest, do not invent.** For a leg you do not own, ping the department that does -
social or ppc for TRAFFIC, content or email for HOOK, content or website for CONVERT -
with the full brief, and propose THEIR idea attributed. An agent inventing creative solo
produces the generic middle. `talk_to_department({ domain: 'customer_journey' })` reaches
the journey specialist; note that a tool-only turn now returns `response: null` with a
`note` and a `data_updates` list rather than an empty string, so silence means silence.

## 4. The assets: brief AND link, which is the coverage map

`customer_journey_stage_assets_list` returns both kinds of row, and the distinction is the
whole point:

- `asset_id` set - a **link** to content that already exists. This is coverage.
- `asset_id` NULL, `status: 'proposed'` - a **written brief** for content that does not.
  This is a named gap.
- A stage with neither is a gap nobody has even named. That is the worst state and the
  easiest to miss, because an empty stage looks tidy.

Work it in that order, per stage:

1. **Search before you brief.** Look for existing content that already serves this
   transition (`content_list`, `social_list_posts`, the campaign lists). Attach it with
   `customer_journey_stage_asset_attach`. Reusing what exists is worth more than proposing
   what does not, and only linked assets with `enabled` true carry attributed revenue into
   ROI.
2. **Brief the gaps** with `customer_journey_stage_asset_propose`. Put the real substance
   in `proposal.brief`: the job this asset does at THIS stage, the key message, the format
   and length. Batch a whole stage or a whole journey in one call via `proposals: [...]`.
3. **Materialize** with `customer_journey_stage_asset_materialize` once the real thing
   exists. It refuses to overwrite a row that already references an asset, so it can never
   silently re-point a live attachment.
4. **Dismiss, do not delete**, a brief you have decided against - `status: 'dismissed'`
   keeps the decision visible.

These tools MENTION AND WRITE assets. They do not produce them. Production is a separate,
confirmed act through the owning department.

## 5. Measurement: checkpoints are what make ROI real

Without checkpoints a journey's funnel is an **attribution proxy** - `funnel_mode:
'estimated'`. With them it is a **measured funnel** off real signals. The difference is not
cosmetic; an estimated funnel cannot tell you where people actually stop.

Set them with `customer_journey_stage_update({ checkpoints: [...] })`. Each is
`{name, is_exit, signal:{type, ...}}`, where type is one of `page_visit` (path, match,
project_id), `form_submit` (form_id), `email_click` / `email_open` (campaign_id), `call`
(voice_number_id, direction), `deal_stage` (pipeline_id, stage_id), `deal_won`, or
`asset_touch`.

Two rules the engine enforces and you should design around:

- **At most one `is_exit` per stage.** It is the graduation criterion. Two would leave the
  engine with no single definition of "moved on".
- **A journey becomes measurable only when stage 1 has a checkpoint AND some stage has an
  exit.** Entry and progression both have to be defined. A stage with no exit BLOCKS
  progression rather than being silently proxied, which is deliberate: a wrong number is
  worse than a missing one.

Scope every signal you can. A `page_visit` on `/pricing` without a `project_id` fires on
any site the account owns.

## 6. ROI: read it before you propose, and quote it honestly

`customer_journey_roi_get` is where the operating loop STARTS, not where it ends. Aim the
next assets at the weakest transition, not at the stage that is easiest to write for.

Read these fields as they are meant:

- `funnel_mode` - `measured` or `estimated`. Say which one you are quoting. Every number
  from an estimated funnel is an attribution proxy and must be labelled as such.
- `contacts_any` vs `contacts_furthest` - participation versus the highest stage reached.
  They answer different questions; do not mix them in one sentence.
- `content_sessions_unavailable` - ClickHouse was unreachable. It means **unknown**, NOT
  zero sessions. Never report it as zero.
- `drift: true` on `published_state` - the live stages differ from the latest published
  iteration, so the numbers describe a version that no longer exists. Say so, and publish
  before claiming a result.
- A null is a null. Content production cost is recorded nowhere in this platform, so any
  true cost-per-asset or full-program ROI is unavailable and must be stated as unavailable
  rather than computed from spend alone.

`customer_journey_roi_summary` is the cross-journey triage; `customer_journey_stage_contacts`
is who is stuck right now and is the input to a retargeting or nurture play.

## 7. Imagery and video: generate it in place

Do not generate an image and then hand-assemble a blob entry. Use
`marketing_generate_entity_image({ journey_id, stage_id, prompt })`, which files it onto the
stage and carries **actor anchoring** - stage two onward reuses the person established
earlier, so one recognisable customer walks the whole journey instead of a different face
per stage. That continuity is most of the perceived quality of a journey map, and it is
free.

For grids, the same tool takes `grid_id` plus `image_type` (`before` / `after` with a
`grid_item_index`, or `story_before` / `story_after`).

Images and video bill against different meters: images against the account's
image-generation allowance (429 when exhausted), video against a Premium plan gate plus a
20-clip month (402). Check with a dry run before promising a client a video.

## 8. Before you rewrite anything

`customer_journey_version_create` first. Journey snapshots capture name, description,
stages and metadata.

And know what a restore does: restoring `stages` restores its **stage_id values**, so any
stage whose id differs from the live one loses the assets and checkpoints keyed to the live
id, and any stage added since the snapshot disappears with everything attached to it. Read
`customer_journey_version_get` before restoring, and confirm with the human first - the
first call performs the restore, there is no confirm parameter.

Prefer `customer_journey_stage_update` over a whole-blob `customer_journey_update`. Editing
one stage should touch one stage.

## 9. The audit, in order

Run this when you inherit a journey or are asked whether one is any good:

1. `customer_journey_stage_list` - do all stages have a `stage_id`? A null one is invisible
   to every tool that addresses stages by id and must be repaired first.
2. `customer_journey_avatar_list` - is a persona linked, and is it the right one?
3. `customer_journey_stage_assets_list` - the coverage map. Which stages have links, which
   have only briefs, which have nothing.
4. `customer_journey_roi_get` - `funnel_mode`, the weakest transition, and whether `drift`
   is set.
5. Name the single weakest transition and propose TRAFFIC, HOOK and CONVERT for it. One
   transition done properly beats five stages of tidy description.

Report the gaps as findings, not as failures. On a new account a thin journey IS the
finding, and saying so plainly is the most useful thing in the report.
