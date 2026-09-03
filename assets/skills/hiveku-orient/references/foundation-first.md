# Foundation first: the avatars, the journey, the grids

Load this before any persona-dependent work - content, ads, SEO, social, email, outbound,
sales sequences, creative. Persona-dependent means: the output would read differently if the
customer were a different person.

## Why this is not optional

Every piece of downstream work on a Hiveku account is derived from three foundation objects:
the **customer avatars** (who we are talking to), the **customer journey** (what they believe
at each step and what has to change), and the **before/after grids** (the transformation we
can prove). Copy written without them is written for nobody in particular, and it reads like
it. Ads targeted without them are targeted at a guess. An SEO strategy without them ranks for
queries the buyer never types.

This is not a style preference; it is where real accounts have rotted. One production account
ran for months with a template persona still reading "your tool" and "your website" - and
because it existed, the ICP matcher kept assigning real visitors to it, so the pipeline data
was wrong too. The same account's behavior data was invisible in the dashboard the whole time
because it was written under the wrong key names. Nothing errored. Everything downstream was
quietly built on sand.

## The check - thirty seconds, before the work

1. `customer_avatar_list` - do personas exist? More than a name each?
2. `customer_journey_list` - is there a journey, and `customer_journey_avatar_list` - is it
   linked to a persona? A journey with no linked avatar is a map for nobody.
3. `before_after_grid_list` - is there transformation proof, and is `target_avatar_id` set?
4. For the persona your work serves: `customer_avatar_get` - read it, do not just confirm it
   exists.

## Validity - existence is not enough

An invalid foundation is worse than a missing one, because nothing prompts anyone to fix it.
Check for each of these, and treat a hit as a finding to raise, not a detail to skip past:

- **Boilerplate.** Text like "your tool", "your website", "[Company]", or a persona name that
  shipped with a template. A boilerplate avatar absorbs real ICP matches and poisons every
  brief hydrated from it.
- **Non-canonical behavior keys.** The dashboard renders ONLY the canonical keys.
  `buying_behavior`: `{trigger, decision_cycle, stakeholders[], preferred_intake,
  budget_range, objections[]}`. `online_behavior`: `{social_platforms[], device_preference,
  content_habits, information_sources[], daily_hours_online}`. Unknown keys round-trip
  untouched but render as NOTHING, so an avatar can be rich in the database and blank on the
  screen for months.
- **Unlinked.** A journey with no `customer_journey_avatar_link`, a grid with no
  `target_avatar_id`. The object exists; it just aims at nobody.
- **Empty-after-populate.** `populate_status` failed, or populated fields that are still
  null/empty. The populate tools refuse ungrounded input, which is correct - the fix is to
  gather grounding, not to route around the refusal.
- **Stale.** The persona describes a business the account no longer is - old pricing, a
  retired offer, a market they exited. Check `updated_at` against what account memory says
  changed.

## The response ladder

**Missing -> CREATE, with grounding.** Building the foundation is bill-worthy agency work in
itself, not a detour from the "real" task. Gather grounding first - the brand guide, the live
site, agent notes from the human - because `customer_avatar_populate` and its siblings refuse
ungrounded input and are right to: an invented ICP misleads downstream work for months. Order:
`customer_avatar_create` (name + what you know) then `customer_avatar_populate` with
urls/notes; create the journey and LINK it; build the grid from real work and link it. Never
fabricate a persona from nothing to unblock yourself.

**Invalid -> FLAG, then UPDATE with a snapshot.** Say plainly what is wrong and why it
matters, snapshot with `*_version_create`, then fix it - normalize the keys, rewrite the
boilerplate against real grounding, link the unlinked. Retiring an avatar entirely is a
deletion and needs the human's explicit yes, since it detaches journeys and grids and clears
that persona's visitor matches.

**Valid -> REFERENCE it, visibly.** Name the persona and the journey stage the work serves,
in the deliverable itself: "for Marcus (Problem Aware), this piece has to move him to
Solution Aware." Work that cannot say which persona and which stage it serves has not used
the foundation, whatever it read.

## Never

- Never fabricate a foundation object to fill a gap silently.
- Never do persona-dependent work without saying which persona it is for - "general audience"
  is the absence of an answer.
- Never delete or restore a foundation object without the human. Restores overwrite on the
  first call, and a journey restore can orphan stage assets and checkpoints.

## The deep methodology

- Journeys end to end: the `hiveku-content-agency` skill, `references/customer-journey.md` -
  the awareness spine, TRAFFIC/HOOK/CONVERT, stage assets as brief-plus-link, checkpoints,
  honest ROI.
- Avatars and grids: the `hiveku-creative-agency` skill, `references/brand-and-assets.md`.
- Create/populate mechanics and the grounding refusal: the `hiveku-content-agency` skill,
  `references/brand-foundation-api.md`.
