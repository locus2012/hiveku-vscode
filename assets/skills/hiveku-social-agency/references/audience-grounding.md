# Audience grounding - the persona, the stage, and the proof behind every post

Load this before ideating, drafting or auditing any post: mining avatar fields into
angles, the Schwartz stage -> post-type map for the TRAFFIC leg, grid_items ->
transformation posts with the Have / Feel / Average Day / Status ladder, KB and
testimonial proof, and the name-the-persona-and-stage rule.

A post written for "our audience" is written for nobody. The rule of this file: every
post names the one persona it is for, the awareness stage it moves them from, and the
proof it rests on, and those three are read from the account's foundation objects, not
remembered. The check, the validity criteria and the create-or-fix ladder live in
`hiveku-orient/references/foundation-first.md` - this file is what social does with a
foundation once it has one. Hook patterns, formats and the CTA ladder are in
`references/hooks-and-formats.md`; the scoring gate is `references/anti-fluff.md`; a
visual the persona needs is briefed through `references/creative-handoff.md`.

## 1. The read (in this order, before the first draft)

1. `account_context_get({ domain: 'social' })` - the persona SUMMARY: each avatar comes
   back with only `id, name, summary, description, tags, occupation, primary_goals,
   pain_points, typical_quote, updated_at`, and each journey as stage names. Enough to
   pick the persona and the stage, not enough to write. Add `include=grids` to get the
   account's active transformation grids (up to 10, newest first: `id, name,
   description, target_avatar_id, key_benefits, measurable_results, transformation_story,
   grid_items`) - grids are opt-in because the default load is sized to a 40K budget.
2. `customer_avatar_list` when the summary is ambiguous, then `customer_avatar_get({ id })`
   for THE persona this post serves. Read the full row, because the summary omits the
   two fields that decide most angles: `buying_behavior` `{trigger, decision_cycle,
   stakeholders[], preferred_intake, budget_range, objections[]}` and `online_behavior`
   `{social_platforms[], device_preference, content_habits, information_sources[],
   daily_hours_online}`. The arrays that carry the copy: `pain_points[]`,
   `frustrations[]`, `challenges[]`, `motivations[]`, `primary_goals[]`,
   `content_preferences[]`, `preferred_channels[]`, `values[]`; the scalars
   `typical_quote`, `aspirations`, `lifestyle`, `background_story`. There is no
   `desires`, `objections` or `watering_holes` column - those live inside the two JSON
   blobs, under exactly those canonical keys.
3. `before_after_grid_list({ target_avatar_id })` - the grids built for this persona.
   Rows carry the whole `grid_items` blob including every image URL and prompt, so shape
   the call (`_fields`) or take ids and read one with `before_after_grid_get({ id })`.
   A grid with `target_avatar_id` null aims at nobody; use it only after naming that.
4. `customer_journey_list` then `customer_journey_get({ id })` for the journey the persona
   moves through - both are on the social key. The full row's `stages[]` carry `name,
   description, emotions[], pain_points[], touchpoints[], content_types[],
   opportunities[]` per stage; that per-stage vocabulary is what a stage-aimed post is
   written in. Which personas a journey serves is `customer_journey_avatar_list`, which
   is not a pure read (it backfills a legacy link) - the foundation-first check covers it.

Validity is a finding, never a footnote. Boilerplate text ("your tool", "[Company]"), a
behavior blob under non-canonical keys, a grid or journey linked to no persona, a
persona describing a business the account no longer is: say it in the deliverable and
follow the ladder in `hiveku-orient/references/foundation-first.md`. `populate_status`
is stripped from every Olympus read, so the empty-after-populate check runs only through
`account_context_get({ domain: 'social', verbose: true })`, which returns the raw rows.
Never draft from an invalid persona as if it were fine, and never invent a persona to
unblock a post - a missing foundation is agency work in its own right
(`hiveku-content-agency/references/brand-foundation-api.md`).

`talk_to_department({ domain: 'social', message })` sees the avatars, journeys and grids
as workspace files on its own side, but it does not know which one you chose. Put the
persona name and id, the stage, the grid item and the proof source in the message every
time; never assume the agent picked the same persona you did.

## 2. Field -> angle (where each avatar field becomes copy)

| Avatar field | What it hands the post | Hook patterns and formats it feeds |
|---|---|---|
| `pain_points[]` | the problem in the persona's words | mistake/confession, myth/truth; checklist, teardown |
| `frustrations[]` | what they have already tried and hate | contrarian, objection-first; POV, hot take |
| `challenges[]` | the constraint that makes the problem sticky | unanswerable question, definition reframe |
| `motivations[]`, `primary_goals[]`, `aspirations` | the after state they want | result-first, before/after; case-study-in-3-lines |
| `buying_behavior.objections[]` | the sentence stopping the sale | objection-first; objection-handler, FAQ - ONE objection per post, answered with a grid item or a testimonial, never with an adjective |
| `buying_behavior.trigger` | the moment they start looking | timely, story in medias res |
| `buying_behavior.decision_cycle`, `stakeholders[]` | who else reads the post over their shoulder | write for the stakeholder when the cycle is long; data-point, comparison |
| `buying_behavior.preferred_intake`, `budget_range` | the CTA that fits (call, form, DM, book) and the price register | CTA choice, Promotion posts only |
| `online_behavior.social_platforms[]` | WHICH of the six slugs gets this persona's posts | platform selection, see below |
| `online_behavior.content_habits`, `content_preferences[]` | carousel vs video vs text, long vs short | format choice |
| `online_behavior.information_sources[]` | whose authority they already trust | quote-card, data-point sourcing |
| `typical_quote`, `background_story` | the vocabulary and the register | the hook line itself - write in the persona's words, not the brand's |
| `values[]`, `personality_traits[]` | what would read as off to them | tone and humor limits (with the brand guide) |

Platform selection is a rule, not a preference: a persona whose
`online_behavior.social_platforms` does not include a platform gets no post aimed at
them there. The values are free text ("LinkedIn", "IG", "Facebook groups") - map them to
the six publisher slugs (`linkedin`, `twitter`, `facebook`, `instagram`, `tiktok`,
`google_business_profile`) yourself, and when a wanted platform is not connected, that is
a task, not a post (`references/platform-playbooks.md`).

Write in the persona's vocabulary. If `typical_quote` says "I just need the phone to stop
ringing about the same thing", the hook says that; it does not say "streamline your
support operations". The competitor-swap and voice checks in `references/anti-fluff.md`
catch the drift after the fact - reading the quote first prevents it.

## 3. Stage -> post type (the TRAFFIC leg social owns)

Social owns the TRAFFIC leg of every journey transition - how the persona arrives at the
transition at all (`hiveku-content-agency/references/customer-journey.md`, sections 1
and 3). The awareness ladder is Schwartz's: what the person BELIEVES, not where the
business sees them. One post moves one stage by one step.

| Stage (what they know) | The post's job | Post types that do it |
|---|---|---|
| Unaware | name the problem in their words | problem-naming story, direct persona callout, an unanswerable question, definition reframe |
| Problem Aware | show a category of fix exists | myth/truth, teardown, checklist, mistake/confession |
| Solution Aware | show why this approach beats the others | comparison, data-point, listicle, specific-number hook |
| Product Aware | remove the specific risk holding them | case-study-in-3-lines, before/after (a grid item), quote-card, objection-handler |
| Most Aware | make acting easy, give a reason for now | offer with honest scarcity, behind-the-scenes, FAQ - the only stage that takes the Promotion CTA |

Read the stage's own row before writing to it: `emotions[]` sets the register,
`pain_points[]` at THAT stage is narrower than the avatar's list, `content_types[]` and
`opportunities[]` are the journey author's request to you. A stage with a written brief
(`hiveku-content-agency/references/customer-journey.md`, section 4) is a post already
half-specified - honor it and attribute it, do not fork it. On a full-profile key the
published post can be attached back to the stage with
`customer_journey_stage_asset_attach` as `asset_type: 'social_post'`, which is what makes
its analytics count in journey ROI; on a social key that is a note for the content
session, not something to fake.

Two vocabularies can coexist. The header (section 6) always carries the Schwartz stage.
The post's `journey_stage` column is validated against the journey's own `stages[].name`
when `journey_id` is set - a name not on the journey is a 400 listing the real names -
so when the account's journey says "Vendor Selection", write that in `journey_stage`,
"Solution Aware" in the header and `stage:solution-aware` in the tags, and say which is
which in the deliverable.

## 4. Grids -> four transformation posts

`before_after_grids.grid_items` is a free array of `{ before: { title, description,
pain_points[], images[] }, after: { title, description, benefits[], images[] },
transformation_details }`. It has NO fixed dimensions - the Have / Feel / Average Day /
Status table is doctrine (it exists as a seeded memory template, not as columns), so the
labelling happens at read time, by you:

1. Read every item. Label each with the ladder dimension it best expresses: **Have** (the
   tangible situation - what they own, owe, count), **Feel** (the emotional state),
   **Average Day** (the daily experience, hour by hour), **Status** (how others see or
   treat them). One item can carry two labels; say so and pick the stronger.
2. Write one post per labelled item, in the post type that dimension earns:
   - the **Have post** - numbers. `measurable_results[]` and any count in
     `before.description` / `after.description`. Specific-number or result-first hook.
   - the **Feel post** - the quote. `typical_quote`, an approved testimonial, or the
     `after.description` in the customer's words. Customer-quote hook, quote-card format.
   - the **Average Day post** - then/now. Two short scenes, same hour, before and after.
     Story hook, before/after format.
   - the **Status post** - what changed in how others treat them (the board, the boss,
     the neighbours, the inspector). Before-after snapshot hook.
3. Row-level fields feed the fifth shape: `transformation_story` + `key_benefits[]` +
   `measurable_results[]` are the situation / change / number of a
   case-study-in-3-lines post (Product Aware).

The `images[]` on a grid item are `{ id, url, prompt, createdAt }` entries, and not every
one is a photograph. An entry carrying a non-empty `prompt` is a populate-flow render -
the image the populate step generated for the item, its prompt kept beside the URL - and
it is an illustration of the item, never evidence of a customer's situation. Only
prompt-less entries, the client's own uploads, are the real before and after photographs
of real work, and only those are the asset for these posts, attached from the library.
Read the `prompt` field per entry and say which kind each item holds; a grid whose
befores are all rendered has no photographic before, so the post runs as copy or labels
the image an illustration, never the customer's photo. Never generate a "before" - not
with `generate_image`, not with a stock photo dressed as one, not by attaching a populate
render as one; a fabricated before is a false claim about a customer's situation, and the
account carries it. If the item has no photographs, the post runs as copy, or the gap
goes to the designer as a brief for a typographic card (`references/creative-handoff.md`),
never as a fake.

A grid item is proof only for the persona the grid targets. Reusing a grid built for one
avatar under another's header is the same error as "general audience" - if the
transformation applies to both, the finding is that the grid needs a second linked
persona, not that the header should be vague.

## 5. Proof sources (a claim without a source is fluff with a number in it)

The Proof axis in `references/anti-fluff.md` scores 2 only when the post cites something
by id. The sources, and what reaches a social-scoped key:

- **Grid items** - the strongest proof a service account owns (section 4). Cite the grid
  id and the item title.
- **`kb_search({ query, kb_id })`** - on the social key (`kb_` prefix). Semantic search
  across every knowledge base the account owns unless `kb_id` narrows it; returns
  `data: [{ content, score, knowledgeBaseName, metadata }]`, one hit per document,
  default 5 (max 20), and nothing below the 0.3 similarity floor. Use it for facts,
  process detail, FAQ answers, warranty and pricing language the persona will check.
  Quote the passage and name the knowledge base; an empty `data` means the KB has no
  passage on it, not that the fact is false - and a 404 means the account has no KB yet.
- **`marketing_testimonials_list({ status: 'approved' })`** - on the social key. A row is
  republishable ONLY when `is_public` is true (approved AND consent granted AND not
  revoked); `approved` alone is not enough. `author.name` is already the display-safe
  form ("Sarah K." when the customer hid their name) and is the only name that may
  appear. `body`, `transcript`, `rating` and `headline` come back for pending rows too -
  that is unreviewed third-party speech; read it, never republish it. Cite the
  testimonial id. Stop paging on an empty array, not on `next_before` being null.
- **Google reviews** - `seo_gbp_reviews` reads the synced GBP review cache, but it is
  `seo_`-prefixed and invisible to a social-scoped key. On a social key, ask the
  operator for the review text or have the SEO session pull it; do not paraphrase a
  review from memory. Reviews are public speech and still get quoted, not rewritten.
- **The account's own numbers** - `social_post_analytics` for "our most-saved post",
  `measurable_results[]` on the grid for outcomes. Every number in a post follows the
  same rule as every number in a report: it names the call it came from.

A proof post whose source cannot be named in the deliverable is downgraded to an
opinion post and re-hooked as one - it is not shipped with a borrowed certainty. The
`/hiveku:social-proof` play requires Proof = 2 on every post it writes.

## 6. The rule: name the persona and the stage, then persist them

Every post in a deliverable - a single draft, a week, a repurpose set - opens with one
header line, before the copy:

`For: <avatar name> | Stage: <Schwartz stage> | Pillar: <pillar> | Hook: <pattern> | Format: <format> | CTA: <verb>`

"General audience" is the absence of an answer, and a header you cannot fill is a post
you have not grounded yet. The header is also the audit trail `/hiveku:social-audit`
reads back, so it is written exactly, not paraphrased.

Persist what the header says, on the post, in first-class fields:

- `social_create_post` / `social_update_post` carry `avatar_id`, `journey_id`,
  `journey_stage` (the journey's own stage name, section 3), `before_after_grid_id` and
  `linked_content_id`. Every id is checked against the account; a foreign id is a 400
  naming the field. Set them on create; add or correct them with `social_update_post`
  while the post is still editable (a publishing or published post is edit-locked,
  `references/publishing-approval-mechanics.md`).
- `tags` carry the slugs the analytics loop groups by: `['persona:<slug>',
  'stage:<slug>', 'hook:<pattern>']` - `stage:` is one of `unaware`, `problem-aware`,
  `solution-aware`, `product-aware`, `most-aware`; `hook:` is the pattern name from
  `references/hooks-and-formats.md`, lower-case, hyphenated; `persona:` is the avatar's
  first name or a stable slug you keep in memory. The pillar goes in `pillar_id`, never
  in a tag. `title` is clamped to 255 characters - keep it a label, the header lives in
  the deliverable.
- The persona is then queryable: `social_list_posts({ avatar_id })`, `{ journey_id }`,
  `{ before_after_grid_id }` and `{ linked_content_id }` answer "every post we ran for
  Priya" and "every post that used this grid" without reading tags, and the audit's
  hook histogram reads the `hook:` tag.

Persist the decision, not just the post: when a persona-to-platform mapping or a
grid-to-post labelling is settled, it goes into department memory through the
read-merge-write in `/hiveku:social-plan` step 5, so the next session does not relabel
the grid from scratch.

## 7. Worked example (invented account)

Copperleaf Grounds, a commercial landscaping company. `customer_avatar_get` returns
"Priya Raman, HOA board treasurer": `pain_points` ["residents photograph dead turf and
post it in the community group", "three vendors in four years"], `frustrations` ["quotes
that change after the walk-through"], `buying_behavior.objections` ["a bigger contract
means a dues increase"], `buying_behavior.trigger` "the spring board meeting",
`online_behavior.social_platforms` ["Facebook", "LinkedIn"], `typical_quote` "I do not
want to be the treasurer who raised dues for grass." `before_after_grid_list({
target_avatar_id })` returns one grid, "Parkside Commons turnaround", `measurable_results`
["14 landscaping complaints logged in March, 0 in June", "one vendor since 2024"].

Labelling the three grid items: item 1 (dead turf and a complaint log -> full lawn, empty
log) is **Have**; item 2 (`after.description`: "I stopped dreading the community page")
is **Feel**; item 3 (a Saturday spent fielding calls -> a Saturday off) is **Average
Day**. No item expresses **Status** - that is reported as a gap in the grid, not padded.

The posts, header first, then the first line only:

- `For: Priya Raman | Stage: Problem Aware | Pillar: Educate | Hook: mistake |
  Format: checklist | CTA: save` (Facebook) - "Three vendors in four years is not bad
  luck. It is a walk-through that never measured the irrigation zones."
- `For: Priya Raman | Stage: Product Aware | Pillar: Authority | Hook: specific-number |
  Format: before/after | CTA: share` (Facebook, grid item 1, real photos) - "14
  complaints in March. 0 in June. Same board, same budget, one contract."
- `For: Priya Raman | Stage: Product Aware | Pillar: Connection | Hook: customer-quote |
  Format: quote-card | CTA: reply` (LinkedIn, grid item 2, briefed to the designer) - "'I
  stopped dreading the community page.' A treasurer, eleven weeks in."
- `For: Priya Raman | Stage: Most Aware | Pillar: Promotion | Hook: objection-first |
  Format: objection-handler | CTA: book` (Facebook, timed to the spring meeting) - "A
  better grounds contract does not have to mean a dues increase. Here is the math from
  Parkside Commons."

No Instagram or TikTok post is written for Priya: her `social_platforms` do not list
them. Each post persists with `avatar_id`, `before_after_grid_id` where a grid item is
used, `journey_stage` as the journey names it, and tags
`['persona:priya', 'stage:product-aware', 'hook:specific-number']` (per post). Each is
scored against `references/anti-fluff.md` before `social_create_post`, as a draft.

## 8. Traps that survive the read

- Reading the summary and calling it grounding. `account_context_get` avatars carry no
  `buying_behavior` or `online_behavior`; the objection and the platform list are in the
  full row from `customer_avatar_get`.
- Writing to the brand's persona instead of the account's. The persona is the row, not
  the name of a marketing archetype you recognise.
- One post for two personas. If the header needs "and", it is two posts.
- Fabricating a before. Prompt-less grid images are the proof; a populate render (an
  entry with a `prompt`), a generated or a stock "before" is a claim the customer never
  made.
- Quoting a pending testimonial, a review from memory, or a KB "fact" that
  `kb_search` did not return.
- A `journey_stage` that is not on the journey. The write is a 400 listing the names;
  read the journey first instead of guessing the vocabulary.
- Grounding once and reusing it for a month. Personas change (`updated_at`), grids gain
  items, journeys are republished. Re-read before each drafting session; it is four calls.
