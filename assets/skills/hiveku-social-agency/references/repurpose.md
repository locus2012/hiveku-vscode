# Repurpose - one published piece into a staggered set of posts

Load this before turning any blog post, case study, news item or other published page into
social posts, before ranking which piece deserves a week, and before composing a link out of
a post: the three source doors in order, ranking with `content_page_views_get`, the absolute
URL and UTM rules, the 6-10 post set by format, persisting the batch with
`social_posts_bulk_create`, the hero and its crops, and the refusals. The command form is
`/hiveku:repurpose`. Who each post is for comes from references/audience-grounding.md, the
hook and format vocabulary from references/hooks-and-formats.md, the gate from
references/anti-fluff.md, the designed cards from references/creative-handoff.md, and the
create/update field mechanics from references/publishing-approval-mechanics.md.

The rule of this file: a post is repurposed from a piece that is LIVE at an absolute URL the
production tier serves, every post records which piece it came from (`linked_content_id`),
and the set is persisted as drafts. Times are picked later, in `/hiveku:social-plan` step 4,
never here.

## 1. The three source doors (in this order)

**Door 1 - the operator's URL or content id, through `social_repurpose_source`.** Call it
with `{ content_id }` (a `content_items` row) or `{ project_id, collection_id, slug }` (a CMS
entry; `collection_id` is the collection slug, `blog` not a UUID). It returns the source
package: `title`, `excerpt`, `headers` (the H2/H3 list in order), `candidate_specifics` (the
numbers, names, dates and quoted lines in the body - the raw material for the specific inside
every hook), `hero { media_asset_id, file_url, registered }`, `live_url` or
`{ url: null, reason: 'not_deployed' }`, `utm_links` per platform slug, and the
`linked_content_id` to write on every post. It is a read apart from one reported side effect:
when the hero exists only as a URL it is registered into the Media Library
(`media_library_register_external_url` semantics) and `registered: true` says so; the asset id
is what the crops in section 7 reference. Turn an operator URL into the second call shape by
matching its path against `cms_list_entries` `resolvedPath` (door 3). A `url: null` answer is
a refusal (section 8), not a prompt to guess a host.

**Door 2 - the content library.** `content_list({ status: 'published', content_type:
'blog_post', limit: 50 })` (the enum also has `article`, `case_study`, `tutorial`, `faq`,
`press_release`, `landing_page`) now returns the CMS binding on every row -
`website_project_id`, `cms_collection_id`, `cms_entry_slug`, `last_published_to_cms_at` - so
"published pieces on site X" is one call. Then `content_get({ content_id })` for the full
body, `featured_image_url`, `settings.published_route`, the 10 newest versions and the
`content_media` rows (the asset manifest, section 7). Traps: a row with `status: 'published'`
and `website_project_id` null is published nowhere the site serves - the status is the
library's, not the site's; a site whose blog was written straight into the CMS has entries and
NO library rows, so an empty list is a reason to open door 3, not a finding that there is
nothing to repurpose; `content_create_from_cms_entry` is find-or-create and re-reads nothing
on a second call, so never use it as a reader.

**Door 3 - the site ladder, on the social key.** `sites_list` (one row per buildable
project: `environments.production.url` and `status`, `custom_domain`, `live_preview`) ->
`cms_list_collections({ project_id })` (`id`, `path`, `route_pattern`) ->
`cms_list_entries({ project_id, collection_id, status: 'published' })` - each entry carries
`derivedStatus` and, when the collection has a route pattern, `resolvedPath`, the relative URL
with the placeholders filled; `published` also matches `published_with_draft` because the live
file is live either way, and an entry with no status signal derives as `draft` ->
`cms_read_entry({ project_id, collection_id, slug })` for the body and whatever image field
the manifest declares (it reads the live entry; `draft: '1'` reads the working copy, which is
not the source). Traps: `resolvedPath` is relative and case sensitive; a collection with no
`route_pattern` has no `resolvedPath`, and the URL is then whatever the site's own router
does with the file - ask the web session rather than inventing `/blog/<slug>`.

## 2. Ranking candidates (the one traffic read that works)

`content_page_views_get({ items: [{ projectId, path }] })` - up to 200 pairs in one POST,
camelCase fields, `path` site-absolute (`/blog/my-post`), a pure read. It returns
`{ stats: { '<projectId>:<normalizedPath>': { views, views30d, visitors } } }`; keys carry
the normalized path (query and fragment stripped, trailing slash removed), so match on the
returned key, not the string you sent. Rank on `views30d` for momentum and `views` for the
evergreen set, then weigh persona fit (section 4) above either number.

- Branch on `degraded`. When ClickHouse is down the response is `{ stats: {}, degraded: true }`
  at HTTP 200; a caller that reads the status reports a full outage as zero traffic
  everywhere. On `degraded: true`, rank by `published_at` recency and persona fit, say the
  traffic read was unavailable, and never write a zero into the deliverable.
- A missing key is never zero-filled: it means no pageviews, OR the entry was dropped as
  malformed (a non-UUID `projectId`, a `path` without a leading slash), OR the project is not
  this account's. The three are indistinguishable; report "no traffic recorded".
- Never `content_analytics_get`. Nothing in the product writes `content_analytics` and the
  `view_count` / `like_count` / `share_count` columns are never incremented, so it answers
  200 with an empty array and an all-zero summary for effectively every item. A ranking built
  on it puts every candidate at zero and looks like a finding.

## 3. Absolute URL rules

Nothing in the platform joins a host to an entry path except `social_repurpose_source`. When
you compose by hand (doors 2 and 3), the rules are:

1. **Host: the production tier or its custom domain.** `project_domains_list({ project_id,
   tier: 'production' })` - use the row with `is_primary: true` only when `ssl_status` is
   `issued` and `dns_status` is `verified` (`project_get` shows the same domain as
   `custom_domain`). Otherwise `environments.production.url` from `sites_list`. When
   `environments.production.url` is null the tier is not deployed and there is no URL to
   post - section 8. Never `live_preview.url` (a Fly container that sleeps and is not the
   site) and never the `development` or `staging` tier.
2. **Path: `resolvedPath` or `settings.published_route`, re-read after any publish.**
   `content_publish_to_site` writes the entry into the project's WORKING TREE (live only
   after a separate deploy), and when another item in the same project and collection already
   holds the slug it silently publishes at `slug-2` through `slug-49` and REWRITES
   `cms_entry_slug`. A URL captured before the publish, or a week of posts drafted to
   `/blog/my-post`, can point at a 404 while the page sits at `/blog/my-post-2`. Read `slug`
   and `route` back from the publish response, or re-read `cms_entry_slug` with
   `content_get`, before any link is written on a post. Publishing itself is the content
   session's lane (hiveku-content-agency/references/site-publishing.md).
3. **UTM: `utm_source=<platform slug>&utm_medium=social&utm_campaign=repurpose-<slug>`.**
   `utm_medium=social` is what the analytics classifier reads: `classify-source.ts`
   maps a medium of exactly `social` to the Organic Social channel, and `utm_source` of
   `linkedin`, `facebook`, `instagram`, `twitter` or `tiktok` matches its known-source table,
   so the session, the form fill and the lead it becomes are attributed to the platform. A
   bare link is attributed by referrer when one arrives, and in-app browsers often send none,
   so the visit reads as Direct. `social_repurpose_source` returns `utm_links` already
   composed per platform; hand-composed links use the same shape.
   Trap: the classifier's click-id branch outranks the UTM. It reads `fbclid` off the landing
   URL and labels the session Meta Ads / Paid Social, and Facebook appends `fbclid` to
   outbound clicks. A Facebook or Instagram click can therefore read as paid in the sources
   view with a correct UTM on it. Report that as a known attribution limit, not a UTM error.
4. **One link per post, and X counts every URL as 23 characters** regardless of the UTM
   length. Where the link goes per platform (body, `first_comment`, `link_url`) is
   references/hooks-and-formats.md section 5.

## 4. The set from one piece: 6-10 posts over 4-6 weeks

One pillar piece earns 6-10 social posts staggered over 4-6 weeks (the content discipline's
distribution ratio, hiveku-content-agency/SKILL.md Play 4), one post per FORMAT, and the piece
is the proof for every one of them (Proof = 2 in references/anti-fluff.md, cited by content
id). Ground first: the persona the piece was written for (`customer_avatar_get`, the full
row) and the Schwartz stage each post moves; a persona whose
`online_behavior.social_platforms` excludes a platform gets no post there. Every post carries
the header line `For: | Stage: | Pillar: | Hook: | Format: | CTA:`.

| Format (slug) | Hook it takes | What the piece hands it | Platforms |
|---|---|---|---|
| `question` | `unanswerable-question` | the question the piece answers, asked without the answer | twitter, linkedin, facebook |
| `data-point` | `specific-number` | one number from `candidate_specifics`, with its unit and source | linkedin, twitter, instagram (card, designed) |
| `listicle` | `list-promise` | the `headers`, in order, trimmed to one line each; the count must be true | linkedin, instagram, facebook |
| `contrarian` | `contrarian` | the one belief the piece reverses, plus its proof line | linkedin, twitter |
| `case-study-3-lines` | `proof-teaser` | situation / what changed / the number - only when the piece IS a case study or carries a measured result | linkedin, facebook, google_business_profile |
| `quote-card` | `customer-quote` or `hot-take` | one line lifted verbatim from the piece (a customer's words only with a public testimonial or grid item behind them) | instagram, linkedin, facebook (card, designed) |
| `faq` | `objection-first` | the objection the piece handles, answered in two sentences, link for the rest | google_business_profile, facebook, linkedin |
| `behind-the-scenes` | `in-medias-res` | why the piece got written - the call, the job, the mistake that prompted it | instagram, facebook |

Two more when the set needs them: a `carousel` of the headers (5-8 slides, slide 1 the hook,
last slide the link) on Instagram or LinkedIn, and one Promotion-pillar post late in the
window that simply sends the Most Aware reader to the page with the brand's `cta_primary`.
Cover the stages as the persona needs them; most pieces open with the `question` and the
`listicle` (Unaware and Problem Aware) and close with the `case-study-3-lines` and the
direct link (Product Aware and Most Aware). Variance (references/anti-fluff.md) holds inside
the set: no two posts open with the same six words, and one hook pattern at most twice.

## 5. Drafting the set

Draft through `talk_to_department({ domain: 'social', message })`. The agent sees the
account's avatars, grids and brand files, but not the piece and not your choices, so the
message carries: the title, `excerpt`, `headers` and `candidate_specifics` (or the body from
`content_get` / `cms_read_entry`), the persona name and id and the stage per post, the
formats wanted with their hook patterns, the platforms the persona allows, the per-platform
`utm_links`, and the account's last 20 posts on each platform for the variance rule. Ask for
the `social_drafts.v1` block. Score every draft against the 7-axis rubric in
references/anti-fluff.md (>= 11/14, zero hard fails, `Rubric:` written in the deliverable),
rewrite once, then report what still fails rather than shipping it. Run
`social_post_validate` on each draft with its real `target_accounts` and `media_asset_ids`
before the batch: it returns the per-platform errors and warnings, the resolved media and
`x_quota`, and writes nothing. A set with more X drafts than `quota.x.remaining` is a set
whose last posts fail silently at cron time (references/connection-health-and-syncs.md).

## 6. Persisting the batch

`social_posts_bulk_create` writes up to 25 DRAFTS in one transaction. It rejects any
`scheduled_at`, it is all-or-nothing with every row's validation echoed (one bad row, one
foreign id, and nothing is written), it accepts an optional `calendar_event` per row that
creates the linked `social_calendar_events` row, and it writes a `batch_id` into
`settings.batch_id` plus the tag `batch:<id>` so the set can be reviewed or unwound as a unit.
Each row carries:

- `title` `'<slug> / <format> / <platform>'` (clamped to 255; the header lives in the
  deliverable), `content` as the platform's own version, `target_platforms` with ONE slug,
  `target_accounts` with the matching `is_active` row, `pillar_id`.
- `linked_content_id` (the `content_items` id from the source package or door 2; a CMS-only
  entry with no library row has none, say so), `avatar_id`, `journey_id` and
  `journey_stage` (the journey's own stage name, references/audience-grounding.md),
  `before_after_grid_id` when a grid item is the proof.
- The link, per platform: `first_comment` on LinkedIn and on Facebook posts with media (one
  line of reason plus the UTM link), `link_url` on GBP (the Learn more button) and on a
  text-only Facebook post, the link inside the 280 on X, nothing from this rail on TikTok.
  On LinkedIn a `link_url` with no media publishes as an article share, so set it only when
  the post is the link.
- `media_asset_ids` for the crop (section 7) and the per-item alt text array
  (references/hooks-and-formats.md section 6).
- `tags` `['repurpose:<content_id>', 'batch:<id>', 'hook:<pattern>', 'format:<slug>',
  'persona:<slug>', 'stage:<slug>']` - the analytics loop groups on the hook, format,
  persona and stage tags (`social_analytics_by_dimension`); `repurpose:` is the human-readable
  provenance beside the queryable column.
- The calendar day, one event per post, in either form the route accepts: `calendar_event:
  true` with `proposed_date: 'YYYY-MM-DD'` (the server writes one all-day `planned_post`
  event on that day, titled from the post and tagged `batch:<id>`; with no `proposed_date`
  the day is today in the account's scheduling timezone), or `calendar_event: { title,
  event_type: 'repurpose', start_date, all_day: true }` when the event needs its own title
  and type (`start_date` is the day and overrides `proposed_date`; every key is optional
  and falls back to the boolean form's defaults). The DAY is the 4-6 week stagger; the
  server sets `linked_post_id` itself; the calendar shows the plan (`social_calendar_list`
  returns each event's `linked_post`), and the publish time is added later, per post, one
  confirm each, by `/hiveku:social-plan` step 4.

After the write: `social_post_preview({ post_id })` on one post per platform to read the
above-the-fold cut and the link handling as the platform will show them, and
`social_list_posts({ linked_content_id })` to see the whole set - which is also the read to
run BEFORE a repurpose pass ("has this piece been promoted already"); a second pass on a
promoted piece names the earlier batch and its numbers first. Then the memory line, through
the read-merge-write in `/hiveku:social-plan` step 5 (`memory_list`, append, `memory_update`
with the whole document; `memory_create` only when none exists): the content id and title,
the live URL, the `batch_id`, the post ids by format and platform, the persona, and the date.
The batch is drafts; scheduling remains one post, one confirm (SKILL.md invariant 1).

## 7. The hero and the crops

- **The hero.** From door 1, `hero.media_asset_id` (registered on read). From door 2,
  `featured_image_url` - which can be site-relative (`/images/foo.jpg`) when the item was
  imported from the CMS; register the absolute https URL with
  `media_library_register_external_url` first: Meta and GBP fetch the URL themselves at
  publish time, so a relative path or a URL that needs a login fails there even when LinkedIn,
  X and TikTok (which are handed the bytes) succeed. `media_library_list({ search: <title> })`
  finds an asset that already exists (search matches title and filename), `media_library_get`
  reads it.
- **Crops.** `generate_image({ mode: 'modify', reference_media_asset_ids: [<hero id>],
  prompt: <the recrop or background instruction>, target_width, target_height })` on the
  default lane renders, then cover-crops to the exact frame (edges trimmed, never
  letterboxed); the fal models refuse `mode: 'modify'`. Every success debits the monthly
  image quota, so the set of crops is a spend the operator confirms first, with the count and
  the sizes. After a timeout, `media_library_list({ ai_generated: true })` newest first
  before regenerating (the list route filters on `ai_generated`; a `source_type` filter is
  ignored), or every timeout is a double spend. Text on the image (the `quote-card`, the
  `data-point` card, carousel slides) is designed, not generated: brief it per
  references/creative-handoff.md and pick it up from the library (`design_publish_to_library`,
  or `media_library_list` by the `social:<slug>` tag).
- **The asset manifest.** Record each crop on the source item with
  `content_media_attach({ content_id, filename, file_url, alt_text, media_type: 'image' })`
  so the next repurpose pass finds them with `content_media_list` instead of rendering again.
  These rows reach no page and no dashboard screen
  (hiveku-content-agency/references/media-and-visuals.md): they are the manifest of which
  library assets belong to which piece, never the way to set the page's hero (that is
  `content_update` with `featured_image_url`, the content session's call). `media_type` is
  cast unvalidated; anything outside `image | video | audio | document | other` is a 500.
- **Alt text** on the asset (`media_update({ asset_id, alt_text })`) and on the post. Never
  generate a "before": a grid item's photos are the only before that exists
  (references/audience-grounding.md section 4).

## 8. Refusals (say the reason, offer the lane)

- **An unpublished source.** `status` not `published` on the library row, or `derivedStatus`
  `draft`, `scheduled` or `archived` on the entry: no posts. The lane is the content session's
  publish (`content_publish_to_site`, then a deploy), and a publish is not a deploy - the
  page goes live only when the project ships.
- **A page the production tier does not serve.** `environments.production.url` null, or the
  entry's path not in the deployed build (a slug suffixed after the deploy, an entry
  published to the working tree and never shipped): no posts, and never a preview or
  development URL in their place. The fix is a production deploy (`/hiveku:deploy`, the web
  session), then re-read the path.
- **A source you did not read this session.** A piece quoted from memory or from its title
  is a claim, not a proof; open a door first.
- **A missing or invalid persona.** Repurposing for "our audience" is the error
  references/audience-grounding.md exists to stop; the ladder is
  hiveku-orient/references/foundation-first.md.
- **A second pass presented as a first.** `social_list_posts({ linked_content_id })` first;
  name what already ran and what it earned before proposing more.

## 9. Worked example (invented account)

Copperleaf Grounds asks for "the irrigation article on social". `social_repurpose_source({
content_id })` returns the title ("Why HOA landscaping bids change after the walk-through"),
five headers, `candidate_specifics` ["14 complaints in March, 0 in June", "three vendors in
four years", "irrigation zones measured on 1 in 5 walk-throughs"], a registered hero,
`live_url` `https://www.copperleafgrounds.com/blog/why-hoa-bids-change` (the primary
production domain, `ssl_status: issued`), `utm_links` for facebook and linkedin, and the
`linked_content_id`. `content_page_views_get` puts it second of the account's 31 published pieces
on `views30d`. The persona is Priya Raman, HOA board treasurer (`social_platforms` Facebook and
LinkedIn, so no Instagram or X). Eight drafts come back from `talk_to_department`: `question`
(LinkedIn, Unaware), `listicle` of the five headers (Facebook), `data-point` on "1 in 5"
(LinkedIn, card briefed to the designer), `contrarian` "the cheapest bid is the least
measured one" (LinkedIn), `case-study-3-lines` from the Parkside grid row (Facebook,
`before_after_grid_id` set), `quote-card` on Priya's own line (LinkedIn, briefed), `faq` on
the dues objection (Facebook), `behind-the-scenes` on the walk-through that prompted the
article (Facebook, hero crop 1200x630 on a confirmed two-image spend). Each scores 11 or
better; two rewrites for banned openers. `social_post_validate` passes all eight.
`social_posts_bulk_create` writes eight drafts with `linked_content_id`, the `repurpose:` tag,
a Facebook `first_comment` carrying the facebook UTM link, eight all-day calendar events
across five weeks, and one `batch_id`. Two crops go onto the item with `content_media_attach`.
The memory line records the content id, the URL, the batch id and the eight post ids. Nothing
is scheduled; the times are `/hiveku:social-plan` step 4, one confirm each.
