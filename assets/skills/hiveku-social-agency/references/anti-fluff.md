# Anti-fluff - the banned list, the recycled-AI tells, the rubric, and the variance rule

Load this before persisting ANY draft (a caption, a first comment, a platform override, a
carousel slide, alt text), before scoring a post in an audit, and whenever a client says
"our posts sound like AI": the 45 banned phrases plus the account's own, the recycled-AI
tells, the 7-axis rubric and its 11/14 gate, the competitor-swap test, the variance rule
against the last 20 posts, and the one-rewrite-pass rule. Who the post is for is
references/audience-grounding.md (read it first); the 16 hook patterns, 17 formats and CTA
ladder this file scores are references/hooks-and-formats.md; the create and update
mechanics it gates are references/publishing-approval-mechanics.md. This file runs last,
and it runs on every draft, including copy that came back from
`talk_to_department({ domain: 'social', message })`.

## 1. Why a gate, and where it runs

Rule: nothing on the server scores copy. `social_post_validate` checks caps, media fit, the
schedule and the X quota; the draft 201 from `social_create_post` echoes
`validation.warnings` about the same things; neither reads a sentence. The gate is this
file, applied by you, before the write. A draft that fails is not written to the account,
not even as a draft: the dashboard shows drafts to the client, and a client who reads
"unlock your potential" in the approval queue has already seen the agency's floor.

The order: ground (audience-grounding.md), write (hooks-and-formats.md), score here, then
`social_create_post` with no `scheduled_at`. The department agent runs the same gate (its
banned list is this list, word for word) and returns a `rubric` object per draft in its
`social_drafts.v1` block, keyed `specificity, one_idea, proof, voice, native, hook, cta,
total`. Re-score anyway: the agent grades its own work, and you are the second reader.

## 2. The banned list

Any one of these in `content`, `first_comment`, a `platform_overrides` variant, a carousel
slide, alt text or a hashtag (#GameChanger counts) is a hard fail. Matching is
case-insensitive and covers inflections: "elevating", "unlocks" and "leveraged" fail too.

elevate, unlock, unleash, seamless, game-changer, game-changing, cutting-edge,
best-in-class, world-class, in today's fast-paced world, in today's digital age,
ever-evolving, navigate the landscape, delve, dive in, let's dive in, leverage, empower,
supercharge, revolutionize, robust, holistic, synergy, at the end of the day, excited to
announce, thrilled to share, we're proud to, your journey, it's not just X it's Y (the
shape, in any spelling), here's the thing, ready to level up, pro tip, discover how,
comment below, thoughts?, agree?, tag someone who, double tap if, secret sauce, take it to
the next level, unlock your potential, transform your business, look no further, in
conclusion.

Plus the account's own. `account_context_get({ domain: 'social' })` returns the active
brand guide as `brand` (the full row, loaded by default): `brand.ai_forbidden_phrases` joins
this list verbatim; `brand.copy_donts` and `brand.brand_is_not` are voice rules and score on
the voice axis (section 4) rather than hard-failing. `brand_guide_get({ guide_id })` reads
the same row outside the context call. When the client bans a phrase in conversation
("never say 'family owned' again") it goes on the guide, not in a memory note: read the
current array, append, and write the whole list back with
`brand_guide_update({ guide_id, brand_guide_data: { ai_forbidden_phrases: [...] } })`. The
column is replaced, not merged, so a write carrying one phrase erases the rest; and the tool
forwards only the `brand_guide_data` / `brand_data` wrapper, so a flat
`ai_forbidden_phrases` argument is dropped without an error.

Trap: the list is not a thesaurus exercise. "Level up" swapped for "step up" is the same
sentence with the same nothing in it. Replace the claim the phrase stood in for with a
specific, not the phrase with a synonym.

## 3. The recycled-AI tells

No single tell is banned; each costs a point on the axis it belongs to, and two or more in
one draft is a rewrite before scoring.

| Tell | What it looks like | Axis it costs |
|---|---|---|
| Symmetric triads | three adjectives, three parallel clauses, a tricolon closing every paragraph | voice |
| Every paragraph one sentence | the whole post as single-line paragraphs, for a rhythm nobody asked for | native |
| A closing question that is not a question | "Ready to rethink your Q4?" - no answer is expected | cta |
| A hook that restates the topic | "Let's talk about payroll." The reader knows the topic; the hook is the specific | hook |
| No proper noun, number or date | not one name, figure or day in the whole post | specificity |
| Emoji bullets | a list where every line opens with a different emoji | native (unless `brand_is` leads with them) |
| Hashtags as sentences | "#Grateful #Blessed #Hustle" as the closing line, or a tag inside the hook | native |
| Same structure as the previous post | hook, three bullets, question - again | variance (section 6) |
| Claims any company could make | "we care about quality", "customer-first", "trusted partner" | specificity, and the competitor test |

Two more that recur: a rhetorical question the writer answers in the next line, and a
closing line that summarises the post the reader just finished. Both cost one-idea.

## 4. The 7-axis rubric

Score every draft on seven axes, 0, 1 or 2 each, total out of 14. The gate is a total of 11
or more AND zero hard fails. Write it into the deliverable, under the header line, exactly:

`Rubric: 12/14 (specificity 2, one-idea 2, proof 1, voice 2, native 2, hook 2, cta 1)`

and on the next line the reason for every 1 or 0 ("proof 1: the 40-remodels figure has no
grid item or KB passage behind it; cta 1: save and book are two asks"). `/hiveku:social-audit`
reads the `Rubric: N/14` line back, so it is written exactly, not paraphrased. It never goes
in `content` or `title`; the deliverable is the audit trail, the row carries the tags.

| Axis | 0 | 1 | 2 |
|---|---|---|---|
| specificity | nothing only this account could write | one specific, but round or unsourced | a number, name, place or date inside the hook line, traceable |
| one-idea | two or more ideas, or two CTAs | one idea with a tangent | one idea, every sentence serves it |
| proof | a claim with no source | a source exists but is not cited | cites a grid item, a testimonial id, a `kb_search` passage or a metric call by id |
| voice | reads like any brand, or a `brand_is_not` word is present | on-brand register, generic word choice | `brand_is` words present, `brand_is_not` absent, the persona's `typical_quote` register |
| native | ignores the fold, the cap or the media rule of the platform | fits the cap but reads like a cross-post | written for this platform: hook above the fold, link where the platform allows it, a format the platform rewards |
| hook | restates the topic or warms up | a taxonomy pattern, but the specific is in sentence three | a named pattern with the specific inside the first line, aimed at the stage |
| cta | none, two, or a non-question ("Thoughts?") | on the ladder but generic | one verb from the pillar's rung, and the reader can do it now |

A metric quoted in a post follows the report rule: it names the call it came from and its
`synced_at` (the freshness lines in references/connection-health-and-syncs.md). "Our
most-saved post" with no `social_post_analytics` behind it is proof 0.

Hard fails (any one blocks the write, whatever the total):
1. A banned phrase (section 2), including the account's own.
2. No persona-and-stage header. The header is `For: | Stage: | Pillar: | Hook: | Format: |
   CTA:` per references/audience-grounding.md; "general audience" is a missing header.
3. The competitor-swap test fails (section 5).
4. A variance breach (section 6).

The department agent applies three more, each already a rule elsewhere in this skill: a
number, quote or result no data file or tool result backs (audience-grounding.md section
5); alt text over 125 characters (hooks-and-formats.md section 6); a platform the persona's
`online_behavior.social_platforms` does not list (audience-grounding.md section 2). Check
them anyway on copy you did not ground yourself.

The native axis has two tools behind it: `social_post_validate` before the write (caps,
media fit per platform, the X rule that every URL counts 23) and
`social_post_preview({ post_id })` after it, the effective copy above each platform's fold
once `platform_overrides` apply. A LinkedIn hook whose specific lands at character 230 is
native 1 however well it reads in the deliverable.

## 5. The competitor-swap test

Rule: replace the brand name with a competitor's and read the post again. If it still reads
true, the post says nothing about this account: a hard fail, and specificity is 0 whatever
else the post does. The fix is never an adjective; it is a detail only this account owns:
the count in `measurable_results` on a grid row (`before_after_grid_get`), the customer's
words from an `is_public` row of `marketing_testimonials_list`, the passage `kb_search`
returned, the date on the account's own calendar, the street the shop is on.

Run it on the hook line alone as well as on the whole post. "Most HVAC shops miss calls"
survives the swap; "Kestrel HVAC missed 31 percent of its calls in March" does not. The
test is also what turns a proof 1 into a proof 2: a post that fails the swap usually has
its source sitting in the grid or the KB, uncited.

## 6. The variance rule

Rule: a post is judged against the last 20 the audience saw on that platform, never on its
own. Before drafting for a platform:

1. `social_list_posts({ platform, status: 'published', limit: 20 })`. Rows carry `content`,
   `tags`, `target_platforms`, `published_at` and `created_at`, newest created first. Read
   the `hook:<pattern>` and `format:<slug>` tags; on rows from before the tagging
   convention, classify the hook from the first line yourself and say in the deliverable
   that you did.
2. Three checks, all against that platform's list:
   - max 2 of the last 10 with the same hook pattern (the 16 slugs in
     references/hooks-and-formats.md section 1);
   - never the same opening six words as any of the last 20;
   - never the same format three in a row (the 17 slugs in section 3 of the same file).
   Run the same three across the drafts in the current batch, in their planned order, so a
   week does not breach against itself.
3. `social_analytics_by_dimension({ group_by: 'hook' })` for the histogram with numbers
   attached: engagement, impressions and rate per pattern, N per group, and the window.
   `group_by: 'format'` does the same for formats. A pattern with N of 2 has no verdict yet;
   a pattern the account has never used is a gap to fill, not a risk. Rotation is not the
   goal: a hook that earns twice the rate is used up to its two-in-ten, and the histogram
   is what says which one that is.

A breach is a hard fail, fixed by re-hooking the draft or by moving it later in the batch.

Traps:
- The list is ordered and date-filtered by `created_at`, not `published_at`. A post drafted
  three weeks ago and published yesterday sorts by its draft date; sort the 20 by
  `published_at` yourself before counting "the last 10".
- `platform` is a contains-filter on `target_platforms`, so a post aimed at three platforms
  appears in each platform's list. That is right: the audience on each of them saw it.
- `status: 'published'` is the audience's view; drafts, scheduled and held posts are not in
  it. Twenty is the floor: an account with fewer than 20 published posts on a platform has
  no variance history, and the deliverable says so instead of asserting a clean check.

## 7. The one-rewrite-pass rule

Score, rewrite once, re-score. The rewrite addresses the named axes and tells, not the
whole post; a second full draft is a new post, not a fix. If the rewrite still totals under
11 or still carries a hard fail, stop: say exactly what fails and why, put the draft in the
deliverable's alternatives (the agent's `alternatives` array does the same), and do not
persist it. Never lower the bar to ship, never round 10 up, never persist under the gate
"as a draft to fix later": the client reads drafts.

The rewrite may change the hook pattern (re-hooking is the usual fix for specificity and
variance), the CTA verb, and the platform variant in `platform_overrides`. It may not
change the persona and stage: a post that cannot pass for the persona in the header is the
wrong post for that persona, and the finding is "no post for Priya this week from this
source", not a vaguer header. A draft already on the row is revised with
`social_update_post` while it is editable; a publishing or published post is edit-locked
(references/publishing-approval-mechanics.md).

## 8. What this file does not ban

Emojis, humour, exclamation marks, first person, slang, sentence fragments, a strong
opinion, a hard sell on a Promotion post. Those are the brand guide's call: `brand.brand_is`,
`brand.brand_is_not`, `brand.brand_voice`, `brand.voice_tone` and `brand.copy_dos` from
`account_context_get`, plus the persona's `typical_quote` register. A brand whose `brand_is`
says "playful, emoji-first" writes an emoji-led hook and scores voice 2 for it; a brand
whose `brand_is_not` says "jokey" loses the point for the same line. This file bans the
language that makes a post interchangeable, not the language that makes it a person's. The
plugin's no-emoji rule is for shipped UI and doctrine, not for a client's caption. A
question is a fine CTA when the reader can answer it ("Which of the five did you skip?");
the banned one is the question with no answer expected.

## 9. Two worked examples (invented accounts)

**Example 1 - LinkedIn. Fernbrook Bookkeeping. Persona "Dana Okafor, owner of a 12-person
plumbing company", Problem Aware, Educate pillar.**

Before:

> In today's fast-paced world, small business owners need to leverage every tool at their
> disposal. At Fernbrook, we're proud to help our clients unlock their potential with
> seamless, best-in-class bookkeeping. It's not just numbers, it's peace of mind. Ready to
> level up? Comment below!

Score: hard fails on eight banned phrases and on the header (none). Competitor swap: "At
Summit Books, we're proud to help our clients" reads identically. Rubric 2/14 (specificity
0, one-idea 1, proof 0, voice 0, native 1, hook 0, cta 0; "Comment below" is banned, not a
CTA). A draft this far under is written again from the grounding, not from the copy.

After:

`For: Dana Okafor | Stage: Problem Aware | Pillar: Educate | Hook: mistake | Format:
checklist | CTA: save`

> We closed the books late for 9 of our 31 trades clients last year. Every one had the
> same cause: the owner's personal card on the truck fuel account.
>
> The five lines we now check in the first week of every month:
> 1. Fuel and tolls on a personal card
> 2. Subcontractor deposits booked as revenue
> 3. Job-site materials returned but never credited
> 4. Sales tax collected on out-of-state jobs
> 5. Owner draws labelled "payroll"
>
> Number 4 is the one that costs the most in a state audit.
>
> Save this for your first Monday of the month.

`Rubric: 13/14 (specificity 2, one-idea 2, proof 2, voice 2, native 2, hook 2, cta 1)`
cta 1: "save" is the Educate rung, but the close gives no reason to save over
screenshotting; a stronger line names the reuse ("Save this; it is your month-end
checklist until it stops finding things").

Sources: `kb_search({ query: 'month end review checklist' })` returned the five-line
procedure from the "Client onboarding" knowledge base; the 9-of-31 count is
`measurable_results` on the grid "Trades clients 2025". Variance: one `mistake` in the last
10 on `linkedin`, no matching opening, previous formats `data-point` and `story`. Persisted
with `tags: ['persona:dana', 'stage:problem-aware', 'hook:mistake', 'format:checklist']`,
`avatar_id`, `before_after_grid_id`, `pillar_id`, no `scheduled_at`.

**Example 2 - Instagram. Sable Creek Plumbing. Persona "Marisol Vega, first-time owner of a
1960s house", Product Aware, Authority pillar, grid item "Cast iron to PVC, Elm Street".**

Before:

> Another amazing transformation by our incredible team! We take pride in delivering
> world-class results for every customer on their journey. Swipe to see the magic. Tag
> someone who needs this! #plumbing #transformation #blessed #hustle #smallbusiness

Score: hard fails on "world-class", "their journey" and "tag someone who"; the hashtags are
the closing sentence; "amazing", "incredible" and "magic" are three adjectives with no noun
under them; "our team" swaps for any plumber in the county. No header. Rubric 1/14.

First grounded draft: `Hook: before-after`, opening "1961 cast iron in March, 2026 PVC in
April. Same 40 feet under the same Elm Street kitchen." It scored 13/14 and failed anyway:
`social_list_posts({ platform: 'instagram', status: 'published', limit: 20 })` showed two
`hook:before-after` tags in the last 10, and a third is a variance breach. The one rewrite
pass re-hooked it; the format stays, since the two previous formats were
`behind-the-scenes` and `quote-card`.

`For: Marisol Vega | Stage: Product Aware | Pillar: Authority | Hook: specific-number |
Format: before-after | CTA: share`

> 2 days, one wall opened, zero jackhammer inside the house. Elm Street, 1961 cast iron to
> PVC, all 40 feet.
>
> Slide 1 is what the camera found in March: two cracks and a root the width of a garden
> hose. Slide 2 is the trench. Slide 3 is the new line. Slide 4 is the kitchen floor back
> down, two days after we started.
>
> Send this to the friend who just bought the 1960s ranch.

`Rubric: 12/14 (specificity 2, one-idea 2, proof 2, voice 1, native 2, hook 2, cta 1)`
voice 1: `brand_is` says "neighbourly, plain" and "all 40 feet" is a spec-sheet phrase; cta
1: the caption asks for the share but slide 4 has no CTA card, and the carousel rule is
that the last slide carries the CTA (hooks-and-formats.md section 3); brief the card or
accept the 1.

Sources: the four slides are the grid item's own `before.images` and `after.images`; the
40 feet and the two days are its `transformation_details`; nothing was generated. Alt text
one per slide, each under 125 characters ("Sewer camera view of a cracked cast iron drain
pipe with a tree root growing through it"). Persisted with `tags: ['persona:marisol',
'stage:product-aware', 'hook:specific-number', 'format:before-after']`, `avatar_id`,
`before_after_grid_id`, `media_asset_ids`, `media_alt_texts`, no `scheduled_at`.
`social_post_preview` after the write confirmed the 75-character hook line sits whole
above Instagram's fold.
