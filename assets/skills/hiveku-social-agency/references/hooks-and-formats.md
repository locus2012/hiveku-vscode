# Hooks and formats - the hook taxonomy, the format library, CTAs, first comments, alt text

Load this before writing or reviewing ANY caption, hook, carousel, first comment, or alt
text: the 16 hook patterns by awareness stage, the 17-format library and its per-platform
fit, hook-line rules, the CTA ladder by pillar, the first-comment link strategy, alt text
rules. This file is the craft. Who the post is for comes from
references/audience-grounding.md (read it first), whether the draft is good enough to
persist comes from references/anti-fluff.md (run it last), and the create/update field
mechanics live in references/publishing-approval-mechanics.md.

## 1. The hook taxonomy (16 named patterns)

The hook is the first line, and the first line is the post. Every draft names its
pattern in the header line (`Hook: <pattern>`) and carries it as a tag
(`tags: ['hook:<pattern>']`) so `social_analytics_by_dimension({ group_by: 'hook' })`
can later say which patterns earn on this account. The pattern slugs below are the tag
values. Every example is invented; the business names are not real customers.

1. `specific-number` - a real figure from account data leads. "Our average furnace
   tune-up finds $412 in avoidable repairs. Here is what the technician checks first."
   Works at Solution Aware and above; fails when the number is round or unsourced.
2. `contrarian` - reverses a belief the persona holds. "Stop deep-cleaning your gutters
   every fall. Pinewood Roofing sees more damage from ladders than from leaves."
   Problem Aware. Needs a proof line by sentence three or it is just a hot take.
3. `mistake` - a confession or the one error everyone makes. "We priced 40 kitchen
   remodels wrong in 2024. The mistake was in the demo line, not the cabinets."
   Problem Aware. Works because the writer takes the hit first.
4. `before-after` - the transformation snapshot from a grid item. "In March, Marlow
   Dental had 11 no-shows a week. In June, 2. Nothing changed but the reminder timing."
   Product Aware. The before must be the customer's real before; never invent one.
5. `unanswerable-question` - a question the persona cannot answer and wants to.
   "What did your last payroll run actually cost you, in hours?" Unaware. The payoff
   answers it; a question with no answer in the post is bait.
6. `persona-callout` - names the reader by situation, not demographic. "Owner of a
   two-truck HVAC shop, one dispatcher, phone ringing while you are on a roof: this is
   for you." Unaware. Pull the situation from `pain_points` and `typical_quote`.
7. `curiosity-gap` - promises a payoff and names it. "The one line on a Texas property
   tax notice most homeowners never read - and it is the one that sets the bill."
   Any stage. The gap must close inside the post, not behind a link.
8. `objection-first` - opens with the reader's own objection from
   `buying_behavior.objections`. "Yes, physio is $140 a visit. Here is why Fairhaven
   patients average four visits, not twelve." Problem Aware and Product Aware.
9. `in-medias-res` - drops into the middle of a story. "The inspector was already in
   the attic when the buyer's agent called to cancel." Unaware. Two sentences of scene,
   then the point; a story that never lands its point is a diary.
10. `hot-take` - a defensible opinion stated flat. "Most small-business 'branding
    packages' are a logo and a PDF. A brand is what the receptionist says." Solution
    Aware. Authority pillar; invite the argument, do not hedge it.
11. `list-promise` - a count and a payoff. "5 things Ridgeline Tax Advisors asks every
    new S-corp client in the first call (number 4 saves the most)." Solution Aware.
    Five to seven items; the count must be true.
12. `myth-truth` - names a myth and replaces it. "Myth: a new roof always raises the
    sale price. Truth: in Denton County it recovers about 60 percent, and buyers ask
    about the warranty transfer first." Problem Aware.
13. `customer-quote` - the customer's own words, verbatim, with permission. "'I
    stopped checking the bakery's bank balance at 11pm.' - Priya, owner, Bramble and
    Co., 14 months on our books." Product Aware. Source is a testimonial row
    (`marketing_testimonials_list`, `is_public` only) or a grid item quote.
14. `timely` - tied to a date the persona is watching. "Texas franchise tax reports
    are due May 15. Three filings we corrected this week, all the same line." Most
    Aware. Honest urgency only - a real date, a real cap, a real season.
15. `proof-teaser` - the result before the method. "Kestrel HVAC cut missed calls from
    31 percent to 6 percent in eight weeks. The method is boring, which is why it
    works." Product Aware. The number must trace to a metric or a grid item.
16. `definition-reframe` - redefines the thing the persona thinks they are buying. "A
    landscaping contract is not lawn care. It is a promise about what the front of your
    building says at 7:45am." Unaware. Best on LinkedIn and as a carousel slide 1.

### The awareness-stage map (which hooks open which door)

The stage comes from the persona read and the journey (the Schwartz ladder in
hiveku-content-agency/references/customer-journey.md; the social lane owns the TRAFFIC
leg). Social does not move a Most Aware reader with an Unaware hook, or the reverse.

| Stage | Hooks that work | Why |
|---|---|---|
| Unaware | persona-callout, unanswerable-question, in-medias-res, definition-reframe | they do not know they have the problem; name it in their words |
| Problem Aware | mistake, myth-truth, contrarian, objection-first | they feel it; show a category of fix exists |
| Solution Aware | list-promise, specific-number, hot-take | they know the category; show why this approach |
| Product Aware | before-after, customer-quote, proof-teaser, objection-first | they know us; remove the specific risk |
| Most Aware | timely, a direct offer | they are convinced; give a reason for now, honestly |

## 2. Hook-line rules (the fold)

The fold is where the platform cuts the caption until someone taps "more". The hook
lives above it, whole, with its specific inside it.

| Platform (slug) | Fold | Hard cap and what happens over it |
|---|---|---|
| Instagram (`instagram`) | about 125 characters | 2200; over is a publish error |
| Facebook (`facebook`) | about 125 characters | 63206 by the validator; effectively unlimited |
| LinkedIn (`linkedin`) | about 140-210 characters before "see more" | 3000; over is a publish error |
| X (`twitter`) | the whole post is the fold | 280, and every URL counts as 23 no matter its length; over is a publish error |
| TikTok (`tiktok`) | the first two spoken seconds of the video | 2200 for the caption, but the rail cannot attach it (below) |
| Google Business Profile (`google_business_profile`) | about 100 characters in the card | 1500; longer text is truncated at publish, not rejected |

Rules:
- The specific (a number, a name, a place, a date) lives INSIDE the hook line, not in
  sentence three. "Most contractors under-quote" is a topic; "We under-quoted 40
  remodels" is a hook.
- No warm-up. No "Excited to announce", no "We are thrilled", no "Happy Monday", no
  restating the topic as the first line. The banned list is in references/anti-fluff.md.
- No emoji-led first line unless the brand's `brand_is` (from
  `account_context_get({ domain: 'social' })`) says the brand leads with them.
- X: write the X version as its own post. A LinkedIn hook trimmed to 280 is not an X
  hook. The X version is one line plus one payoff, and the link counts 23.
- TikTok: the hook is spoken and shown on screen in the first two seconds; the caption
  is secondary. The rail's TikTok publish is an inbox draft with NO caption attached
  (the endpoint has no caption field), so the `content` you write is the text the
  operator pastes in the TikTok app when finalizing. Say that in the deliverable.
- GBP: the first 100 characters carry the offer or the update; the action is a button
  (section 5), not a sentence.
- Check the cap before the write with `social_post_validate` (per-platform errors and
  warnings, no write) and read the actual above-the-fold cut after the write with
  `social_post_preview({ post_id })`, which shows the effective copy per platform after
  `platform_overrides`.

## 3. The format library (17 formats with per-platform fit)

Name the format in the header (`Format: <slug>`) and tag it (`tags: ['format:<slug>']`)
so `social_analytics_by_dimension({ group_by: 'format' })` can rank formats by earned
engagement on this account. "Earns" names the metric the format is built for; read it
back with `social_post_analytics` (references/analytics-and-reporting.md).

| Format (slug) | Earns | Pillars | Platforms | Media it needs |
|---|---|---|---|---|
| `carousel` | saves, dwell | Educate, Authority | instagram, linkedin, facebook | 5-8 slides; slide 1 is the hook, last slide the CTA |
| `thread-as-one-post` | comments, saves | Educate, Authority | linkedin, facebook, instagram | none; numbered mini-thread inside one caption |
| `listicle` | saves | Educate | linkedin, instagram, facebook | optional card; a carousel if 5+ items |
| `pov` | comments, shares | Authority, Connection | linkedin, twitter | none, or one photo |
| `teardown` | saves, comments | Authority | linkedin, instagram (carousel) | screenshots or slides of the thing torn down |
| `before-after` | shares, clicks | Authority, Promotion | instagram, facebook, linkedin, google_business_profile | the real before and after photos from the grid item |
| `myth-truth` | comments, saves | Educate | all six | optional two-panel card |
| `checklist` | saves | Educate | instagram, linkedin, facebook | one card or a carousel |
| `story` | comments, shares | Connection | linkedin, facebook, instagram | one candid photo |
| `question` | comments | Connection | twitter, linkedin, facebook | none |
| `contrarian` | comments, shares | Authority | linkedin, twitter | none |
| `data-point` | shares, saves | Authority, Educate | linkedin, twitter, instagram | one chart card (design lane) |
| `quote-card` | shares | Connection, Authority | instagram, linkedin, facebook | a designed card (design lane) |
| `behind-the-scenes` | comments | Connection | instagram, facebook, tiktok | a photo or a short vertical video |
| `faq` | saves, clicks | Educate, Promotion | google_business_profile, facebook, linkedin | optional |
| `objection-handler` | comments, clicks | Promotion, Authority | linkedin, facebook, instagram | optional proof card |
| `case-study-3-lines` | clicks, shares | Promotion, Authority | linkedin, facebook, google_business_profile | one result photo or card |

Format notes the table cannot hold:
- `carousel`: `generate_image_set` produces the batch (brand-aware, photographic
  subjects; text on slides is a design-lane job, references/creative-handoff.md). Order
  is the `media_urls` array order - there is no ordering control after create. Caps:
  Instagram 10 images, LinkedIn 9 images (or one PDF document, LinkedIn's native
  carousel), Facebook multiple images, X 4 images. Instagram REQUIRES media on every
  post, so a text format on Instagram always ships with a card.
- `thread-as-one-post`: the rail has NO X threads. `in_reply_to_tweet_id` is never set,
  one post produces exactly one platform post per account, and there is no parent or
  thread column. A "thread" is therefore a numbered mini-thread inside ONE caption on
  LinkedIn, Facebook, or Instagram. On X the same idea is one 280-character post with
  the single strongest line and the link in the body; a first comment is not available
  on X (section 5). Do not promise a client an X thread.
- `before-after`: the material is a `grid_items` entry read at drafting time
  (references/audience-grounding.md labels each item Have, Feel, Average Day, or
  Status). The images on the item are the only before photos that exist. Never generate
  a "before"; a generated before is a fabricated result.
- `quote-card` and `data-point`: the card is designed, not generated -
  `generate_image` cannot render reliable text. Brief it per
  references/creative-handoff.md and pick it up from the library with
  `media_library_list` and `media_library_get`.
- `objection-handler`: one objection from `buying_behavior.objections` per post,
  answered with a grid item, a testimonial, or a `kb_search` fact. Two objections in
  one post is two posts.
- `case-study-3-lines`: situation / what changed / the number. Three lines, in that
  order, each under 140 characters. The number traces to `measurable_results` on the
  grid row or a metric the client supplied.
- `behind-the-scenes` on TikTok is video-only (the adapter rejects a post with no
  video and ignores images) and publishes as an inbox draft the operator finalizes.
- GBP takes exactly one photo and no video; a carousel or a reel does not exist there.
  A GBP `before-after` is a single composite photo plus 1500 characters.
- Video formats (reel, short, motion card) are the creative discipline's;
  references/short-form-and-ugc.md and references/creative-and-video.md carry them.

## 4. The CTA ladder by pillar

One idea per post, one CTA per post, and the CTA verb matches the pillar. Only the
Promotion pillar asks for the sale. The verb goes in the header line (`CTA: <verb>`) and
is what the `cta` axis of the anti-fluff rubric scores.

| Pillar | CTA asks for | Written like |
|---|---|---|
| Educate | save, comment | "Save this for your next inspection." "Which of the five did you skip?" |
| Authority | share, follow, "what would you add" | "Send this to the partner who prices the bids." |
| Connection | reply, tag | "Who taught you this? Tell them." |
| Promotion | click, book, DM, call | the brand's `cta_primary` or `cta_secondary` from `account_context_get`, verbatim |
| GBP (any pillar) | the button | GBP shows a Learn more button built from `link_url`; the text names what the button opens |

- A value post that ends "Book a call" is a Promotion post wearing an Educate hook. It
  breaks the 80/20 ratio the pillar targets encode and reads as bait. Fix the pillar or
  fix the CTA.
- "Thoughts?", "Agree?", "Comment below!" are not CTAs; they are on the banned list. Ask
  a question the reader can actually answer.
- The GBP action type the rail sends is LEARN_MORE. There is no book, call, or order
  button from this rail; if the client needs one, it is a dashboard or native-app job.

## 5. The first-comment link strategy

Links in the body cost reach on the feed platforms, so the link goes where each
platform lets it go. The publisher reads `first_comment` (and
`platform_overrides[platform].firstComment`, which wins for that platform) after the
post is live, posts it as the first comment where the platform has a comment API, and
records the outcome on the post's version row as `first_comment_status`
('posted', 'failed', or 'unsupported') with `first_comment_error`. A failed comment
never fails the post. Read the outcome with `social_get_post` after publish.

| Platform | Where the link goes | Why |
|---|---|---|
| LinkedIn | `first_comment`; body link-free | the publisher posts the comment as the page or profile. Exception: a post with `link_url` and NO media publishes as an ARTICLE share (a link card), so use `link_url` only when the post IS the link |
| Facebook | `first_comment` when the post has an image or video; `link_url` on a text-only post | `link_url` is sent only on the text-only path, as a link preview; with an image the link is dropped, so it rides in the comment |
| Instagram | `first_comment`, plus "link in bio" in the body when it matters | caption links are not clickable; `link_url` does nothing on Instagram |
| X | inside the 280-character body | first comments are unsupported on X (`first_comment_status` 'unsupported'); the URL counts 23 characters |
| TikTok | nowhere from this rail | caption is not attached, comments are unsupported; links are bio-only, native app |
| GBP | `link_url` | it becomes the Learn more button; it is the only link GBP consumes; comments are unsupported |

- `link_title`, `link_description`, and `link_image_url` are accepted and stored for
  the dashboard preview. No publisher sends them; the platform builds its own card
  from the URL. Do not promise a custom card image.
- The first comment is real copy: one line of context plus the link, in the brand
  voice. "Full breakdown here:" is filler; "The 12-point checklist, as a PDF:" is a
  reason to click.
- One link per post. Two links split the click and double the X character cost.
- Every link out of a social post carries `utm_medium=social` (the composition and
  the attribution reason are in references/repurpose.md).
- After a publish, an `first_comment_status` of 'failed' on LinkedIn or Meta means the
  link never posted; the post is live without it. Post the comment from the native app
  or the dashboard, and record the failure in the report.

## 6. Alt text rules

Alt text describes the picture for someone who cannot see it. Write it for every media
item, every time, even though the platforms do not receive it yet (last bullet).

- 125 characters or fewer. One sentence, present tense, the subject first: "Two
  technicians replace a rooftop condenser unit at dusk, Dallas skyline behind them."
- Include any text rendered on the image, verbatim - a stat card that says "31% to 6%"
  needs those figures in the alt text or the point is invisible.
- Never "image of", "photo of", "graphic showing". Never a hashtag, never a keyword
  list, never the caption repeated.
- One entry per `media_urls` item, in the same order, in `media_alt_texts` on
  `social_create_post` or `social_update_post`. A carousel gets one per slide.
- Write it on the asset too: `media_update({ asset_id, alt_text })` so the next post
  that reuses the asset inherits it and the library search finds it. The asset id
  comes from `media_library_list` or `media_library_get`.
- The plain truth: `media_alt_texts` is stored on the post and shown in the dashboard
  composer and approval queue, and NO publisher sends it to any platform today - X,
  Meta, and GBP carry no alt field, and LinkedIn labels every media item "Media N".
  It is a dashboard and future-platform contract, not a live accessibility feature.
  If a client asks about accessibility, say so, and offer the native-app edit after
  publish where the platform supports it.

## 7. Hashtags

Placement, per-platform set sizes, the ladder, and the branded tag are in
references/platform-playbooks.md. The one rule that belongs here: hashtags come AFTER
the CTA, never inside the hook line, and never as the sentence.

## Persisting the craft on the post

The header line (`For: | Stage: | Pillar: | Hook: | Format: | CTA:`, per
references/audience-grounding.md) goes in the deliverable. On the row itself:
`pillar_id`, `avatar_id` and `journey_stage` for the persona, `tags` carrying
`hook:<pattern>` and `format:<slug>`, `first_comment` or `link_url` per section 5,
`media_alt_texts` per section 6, and `platform_overrides` ({ [platform]: { content,
firstComment } }, the only two keys the publisher reads) when one post serves several
platforms with tuned copy. Draft first, no `scheduled_at`; the schedule is its own
confirm (references/publishing-approval-mechanics.md).
