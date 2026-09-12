# Structure and conversion - authors, markup, the SERP brief, positioning, titles, offers and CTAs

Load this file before the brief of any piece (the author on the row, the SERP brief before the
draft, the thesis and the hook), before the title step (five candidates, one pick), before a
consideration or decision piece asks the reader for anything (the offer, the lead magnet, the CTA
plan and its shortcodes), and before a publish (the answer block and FAQ the markup is built from,
the keys the publish response gained). Clusters, page roles, the keyword map, bottom-funnel pages
and the decision loop are in `references/site-architecture-and-decay.md`; research and proof in
`references/research-and-proof.md`; the five grounding columns and the pre-publish check's older
rules in `references/site-publishing.md`.

## Availability - the elite content program's round B hands (contracted 2026-09-12)

Round B of the elite content program shipped its builder routes on `main`. The MCP names below
are the parallel MCP lane's declarations and reach `lib/tool-index.json` when that server deploys;
they are live on the server and in `lib/tool-index.json` since 2026-09-12 (the ELITE-B pending batch is retired). The changed live tools answer the new
shape on every key today; their descriptions and the new params catch up with the same deploy.

| Tool | Status | Route (Olympus auth, account-scoped) |
|---|---|---|
| `content_authors_list` | LIVE (build 3) | `GET /api/olympus/marketing/content-authors` |
| `content_authors_create` | LIVE (build 3) | `POST /api/olympus/marketing/content-authors` |
| `content_authors_get` | LIVE (build 3) | `GET /api/olympus/marketing/content-authors/:authorId` |
| `content_authors_update` | LIVE (build 3) | `PATCH /api/olympus/marketing/content-authors/:authorId` |
| `content_authors_delete` | LIVE (build 3) | `DELETE /api/olympus/marketing/content-authors/:authorId` |
| `content_brief_build` | LIVE (build 4) | `POST /api/olympus/marketing/content/:contentId/brief` |
| `content_brief_get` | LIVE (build 4) | `GET /api/olympus/marketing/content/:contentId/brief` |
| `content_brief_topic` | LIVE (build 4) | `POST /api/olympus/marketing/content/brief` |
| `brand_positioning_get` | LIVE (build 5) | `GET /api/olympus/marketing/brand/positioning` |
| `brand_positioning_set` | LIVE (build 5) | `PUT /api/olympus/marketing/brand/positioning` |
| `content_titles_generate` | LIVE (build 5) | `POST /api/olympus/marketing/content/:contentId/titles` |
| `content_titles_get` | LIVE (build 5) | `GET /api/olympus/marketing/content/:contentId/titles` |
| `content_titles_pick` | LIVE (build 5) | `POST /api/olympus/marketing/content/:contentId/titles/pick` |
| `brand_offers_get` | LIVE (build 10) | `GET /api/olympus/marketing/brand/offers` |
| `brand_offers_set` | LIVE (build 10) | `PUT /api/olympus/marketing/brand/offers` |
| `content_conversion_plan` | LIVE (build 10) | `POST /api/olympus/marketing/content/:contentId/conversion` |
| `content_conversion_plan_get` | LIVE (build 10) | `GET /api/olympus/marketing/content/:contentId/conversion` |
| `content_create` | LIVE, changed (eleven new fields) | `POST /api/olympus/marketing/content` |
| `content_update` | LIVE, changed (eleven new fields) | `PATCH /api/olympus/marketing/content/:contentId` |
| `content_publish_to_site` | LIVE, changed (author, markup, llms.txt) | `POST /api/olympus/marketing/content/:contentId/publish-to-site` |
| `content_seo_check` | LIVE, changed (the eleven elite rules) | `GET /api/olympus/marketing/content/:contentId/seo-check` |

A key whose server does not serve a name yet answers unknown-tool: say so, run the tool-free form
of the step (the byline typed into the brief and `settings.cms_fields` for the collection's author
field; the SERP read through `seo_serp_get` or `seo_research({ action: "serp" })` and
`on_page_content_parsing` on the top three, the way `/hiveku:seo-brief` worked before build 4;
the thesis from `brand_guide_get` and the strategy memory; five titles through
`talk_to_department` with the sixteen patterns named; the offer from the guide's primary CTA), and
never present the gap as "Hiveku cannot do this". The proxy forwards only DECLARED params: on a
key whose server predates the deploy, `author_id`, `faq`, `answer_block`, `search_intent`,
`page_type`, `review_disposition`, `topic_cluster_id`, `cluster_role`, `page_role`, `lead_magnet`
and `offer_id` are dropped silently by `content_create` and `content_update` and the row comes
back with them null - the echo, not the call, is the proof the write landed.

## The elite fields on the row - `content_create` / `content_update` / `content_get` / `content_list`

Eleven columns joined the five grounding columns on 2026-09-12. Writable on create and update,
returned on every get and list row (every key present, null when unset); the same validation the
dashboard editor and the workflow content node go through:

| Field | Accepts | Comes back as | List filter |
|---|---|---|---|
| `author_id` | a `content_authors_list` id in this account, or null | `author_id` + `author { id, name }` or null | `author_id` |
| `faq` | `[{ question, answer }]`, both non-empty strings, at most 20; null or `[]` clears | `faq` (always an array) | - |
| `answer_block` | the 40-60 word direct answer that sits under the H1; null clears | `answer_block` | - |
| `search_intent` | `informational`, `commercial`, `transactional`, `navigational`, null | `search_intent` | `search_intent` |
| `page_type` | a string up to 100 chars (guide, listicle, comparison, landing, tool, news, how_to) | `page_type` | - |
| `review_disposition` | `double_down`, `refresh`, `rewrite`, `consolidate`, `prune`, null | `review_disposition` | `review_disposition` |
| `topic_cluster_id` | a `seo_topic_clusters` id in this account, or null | `topic_cluster_id` + `topic_cluster { id, pillar_keyword }` | `topic_cluster_id` |
| `cluster_role` | `pillar`, `spoke`, null | `cluster_role` | `cluster_role` |
| `page_role` | `money`, `pillar`, `support`, `utility`, null | `page_role` | `page_role` |
| `lead_magnet` | `{ kind: download \| checklist \| template \| guide \| other, title (<= 200), asset_id?, content_item_id?, form_id?, delivery_sequence_id? }` or null; exactly those keys are stored | `lead_magnet` | - |
| `offer_id` | the `id` of an entry in the active brand guide's offers (`brand_offers_get`), or null | `offer_id` | - |

- Every id is looked up in the key's account before anything is written: a foreign id, a malformed
  one or an unknown offer is a 400 `invalid_reference` naming the field (a lead magnet id names
  `lead_magnet.<field>`), a value outside a vocabulary is a 400 naming the list, and NOTHING on
  that call is written. Re-read the list the message names and send the real id; never strip the
  id to make the call pass.
- **Six columns are read-only here** and answer 400 `read_only_field` naming their writer:
  `serp_brief` and its capture stamp (`content_brief_build` writes them), `decay_status`,
  `refresh_priority` and `top_declining_keywords` (the Sunday decay run), `refreshed_at` (the
  publish path). A value equal to what the row already holds is an echo and is ignored, so a whole
  `content_get` response PATCHed back is safe; a changed value is refused. Never work around the
  400: the brief and the decay columns have their own writers, and `review_disposition` is the one
  decision column a session writes.
- **The keyword collision warning never blocks.** When `target_keyword` is sent and another live
  item in the account (status not archived) already targets it, case-insensitively, the row is
  still written and the response carries `warnings: ["keyword_already_targeted: ..."]` naming the
  other item plus `keyword_conflicts: [{ code, content_item_id, title, slug, status,
  target_keyword }]`. Relay the line, and offer to consolidate the two or aim this piece at a
  different keyword; never retry around it, and never treat a 201 with a warning as a clean brief.
  The keyword map (`references/site-architecture-and-decay.md`) shows the collision before the
  write; the warning is the safety net after it.

## Author first - `content_authors_list`, the byline every piece publishes under

No piece ships without a named practitioner behind it: the byline is what the Article markup, the
scaffold's authors collection and the reader's trust are built from. `content_authors_list`
returns `{ data: [{ id, account_id, name, role, bio, headshot_url, credentials, same_as[],
voice_notes, is_default, content_count, created_at, updated_at }], total }`, the default first.

- **Every draft header carries `By: <name>, <role>`**, read back from the row's `author { id,
  name }`, else the account default (`is_default: true`). An account with no authors is a brief
  that cannot ship: say so and offer `content_authors_create({ name, role, bio?, headshot_url?,
  credentials?, same_as?, voice_notes?, is_default? })` before drafting - a real person the owner
  names, never an invented byline, never a brand name standing in for a person. `same_as` is the
  list of profile URLs (LinkedIn, a personal site) the Person markup points at; `voice_notes` is
  how that person writes, which the department reads beside the brand voice.
- The first author created becomes the default; `is_default: true` on another author swaps the
  default in one transaction. Three refusals, relayed as they are: 409 `duplicate_name` (names are
  unique per account), 409 `default_required` (`is_default: false` on the current default - make
  another author the default instead), 409 `default_in_use` (deleting the default while others
  exist). `content_authors_delete` unlinks the author's items (`items_unlinked` in the response,
  `author_id` null on each) and removes the row; the last author can be deleted.
  `content_authors_update` takes the same keys as create, all optional, null clearing a text
  field; `content_authors_get` is the one-author read.
- Set `author_id` on the calendar row (`content_create`) or with the grounding
  (`content_update`); the gate's `author_missing` rule is an ERROR when the row has no author
  and the account has no default, so a piece is not published under nobody.
- **On publish** (`content_publish_to_site`) the resolved author is mapped onto the collection's
  author reference and the authors entry is created in the scaffold when missing; a slug already
  typed into `settings.cms_fields` for that field wins; a required author field with nothing to
  map is 422 `{ field, code: "author_missing" }` (no author on the item and no account
  default), and 422 `author_entry_failed` when the item HAS an author but its entry in the
  authors collection could not be written (the collection missing from the CMS manifest, a
  required field the profile cannot satisfy, a provider refusal): relay its `details.warnings[]`
  and fix the profile or the collection - never ask the user to pick a different author. The
  response carries `author { id, name, entry_slug, entry_created } | null` - `null` on a
  collection that has an author field means the byline did not reach the site, say so.

## The brief before the draft - `content_brief_build({ content_id, keyword?, avatar_id?, project_id?, location_code? | location_name?, parse_top? })`

A brief without SERP evidence is a guess with good grammar, so the brief is built by the route
that reads the SERP, not typed from recall. It runs on the calendar row (a draft row is free; the
brief is stamped on it), reads ONE live Google SERP for the row's `target_keyword` (or `keyword`;
neither is 400 `keyword_required`), parses the top `parse_top` organic pages (0-5, default 3),
decides the intent and the page type by rule (a model tie-break only when the rules cannot), and
writes it all back: the `search_intent` and `page_type` columns, the full brief in the read-only
`serp_brief` column with its capture stamp, `settings.serp_brief` (the snapshot the research run
reuses for 30 days instead of paying for a second SERP read), and a `serp_brief` artifact named
`SERP brief: <keyword>` in the Content research knowledge base. A re-build refreshes the same
artifact and stamp.

**What it spends, say so before calling:** one DataForSEO SERP read plus one on-page parse per
top result (default three) against the monthly SEO research cap, and at most one model completion.
A spent cap is a 402 with NOTHING written; a vendor failure is 502 `serp_read_failed`; a parse
that fails is `parse_error` on that result plus a warning, never a failed brief. The route honours
`Idempotency-Key`; call with a 240 s or longer client timeout.

**Response (201):** `{ data: { content_id, topic, brief, artifact_id, knowledge_base_id,
artifact_created, stamped, serp_analysis { project_id, written, note }, spent { serp_requests,
page_parses, model_calls }, warnings[] }, result_info { intent, page_type, spent, warnings } }`.
`brief`: `{ version: 1, keyword, location_name, location_code, captured_at, intent,
intent_signals[], intent_decided_by: rules | model | default, page_type, page_type_signals[],
page_type_decided_by, result_types { <type>: count }, features[], paa[] (at most 12),
related_searches[], featured_snippet { url, title, domain, description } | null, top_10[{
position, url, title, domain }], top_results[{ position, url, title, domain, word_count, h1,
outline[h2...], parse_error? }], word_count_band { min, max, median, target, label, sample_size }
| null, what_the_top_3_all_say[], artifact_id, knowledge_base_id }`.
`content_brief_get({ content_id })` reads it back without spending: `{ data: { content_id,
search_intent, page_type, serp_brief, artifact | null } }` (404 outside the account, nothing
written); `content_brief_topic({ topic, keyword?, avatar_id?, project_id?, location_code? })` runs
the same build for a topic with no row yet (`content_id` null, `stamped` false; the artifact is
the deliverable, read it back with `kb_artifact_get({ artifact_id })`). `location_name` wins over
`location_code`; a code outside 2840 | 2826 | 2124 | 2036 | 2372 | 2554 falls back to the account
market with a warning.

**How the brief is used, in this order:**
- **`Intent:` and `Type:` are header lines** on every draft, read back from the row's
  `search_intent` and `page_type`. A row with no stored brief is not briefed: build one before
  the department drafts ("no SERP brief, no draft"), or state that the key cannot and that the
  brief was assembled by hand from `seo_serp_get`.
- `page_type` sets the skeleton: a guide is headed like the guides that rank, a listicle counts,
  a comparison carries the table (`references/site-architecture-and-decay.md`), a landing page
  converts. Writing a guide for a SERP full of comparison pages is the mistake the brief exists
  to catch - re-scope the piece, never override the verdict from taste.
- `top_results[].outline` is the benchmark: the draft covers every subtopic two of the three
  cover, in the shape the SERP rewards; `word_count_band` is a BAND, never a target (`target` is
  the median rounded, `label` says thin or long).
- `paa[]` is answered on the page, one question per block, and the three to six that are real go
  into `faq` (below); `what_the_top_3_all_say[]` is what the piece must cover AND the thing the
  thesis disagrees with (next section): a draft that only repeats the consensus is not a draft.
- The research run (`references/research-and-proof.md`) reuses `settings.serp_brief` for 30 days,
  so build the brief first and the run spends one SERP read less.

## Thesis and hook - `brand_positioning_get({ project_id?, guide_id? })` / `brand_positioning_set({ thesis, beliefs, we_are_against, category_name, proof_points, project_id?, guide_id? })`

Positioning lives on the ACTIVE brand guide as one typed object, not as a memory note: `{
thesis: string | null, beliefs: string[], we_are_against: string[], category_name: string |
null, proof_points: [{ claim, source }] }` (thesis 500 chars, category 120, each belief or
against 300, 12 per list, 12 proof points; a proof point needs claim AND source). `brand_positioning_get`
returns `{ data: { guide_id, guide_name, positioning, is_empty, updated_at } }` (404
`no_active_brand_guide`); the project's own guide wins when `project_id` is given, else the
account-level guide, else any active one. `brand_positioning_set` REPLACES the whole object -
send every key each time; a key left out is cleared - and mirrors a verified `positioning`
knowledge artifact (`kb_artifacts_list({ artifact_type: "positioning", is_verified: true, limit:
1 })`) so `kb_search` and the department find it; a 400 names the field; `warnings[]` after a
save is a muted note (the mirror failed, the save did not).

- **Drafting the positioning is agency work, approved by the owner.** When `is_empty` is true,
  draft it through `talk_to_department({ domain: "content" })` from the mission statement, the
  guide's brand-is / brand-is-not lists, the avatars' objections and the measured results in the
  before/after grids, present it, and call `brand_positioning_set` only on the owner's yes - the
  thesis is a sentence the company will be quoted on.
- **`Thesis:` is a REQUIRED header line on every draft:** the one sentence the piece argues, from
  `positioning.thesis` or one of the `beliefs`, else the piece's own claim. A draft without one is
  an outline, not a draft. **`Hook:` names the opener's pattern** - one of the sixteen slugs
  (`specific-number`, `contrarian`, `mistake`, `before-after`, `unanswerable-question`,
  `persona-callout`, `curiosity-gap`, `objection-first`, `in-medias-res`, `hot-take`,
  `list-promise`, `myth-truth`, `customer-quote`, `timely`, `proof-teaser`,
  `definition-reframe`; the same list the social skill's `references/hooks-and-formats.md`
  carries, so a rename lands in both) - and is persisted as `settings.hook_pattern` through
  `content_update` (the settings PATCH merges top-level keys).
- **The rubric axis: "a competitor would not publish this sentence."** The piece passes when its
  body carries at least one belief from the positioning or a stated disagreement with
  `what_the_top_3_all_say[]` from the SERP brief. A draft any competitor could have signed goes
  back to the department with the consensus line it should argue against named.

## Five titles, one pick - `content_titles_generate({ content_id, count? })`, `content_titles_get({ content_id })`, `content_titles_pick({ content_id, index, apply_to?, change_summary? })`

Titles are claims, not labels. After the row exists, `content_titles_generate` (count 1-10,
default 5; a metered department call, up to 120 s, so use a 180 s client timeout) asks the content
department for candidates argued from the positioning, each tagged with one of the sixteen
patterns filtered to the row's `journey_stage` (a Schwartz stage name such as "Problem Aware"
maps exactly; a funnel name goes through the stage classifier; `curiosity-gap` is open at every
stage; an unknown stage opens all sixteen), and stores them as `settings.title_candidates`
(replacing the previous set). Response: `{ data: { content_id, title, meta_title, journey_stage,
hook_pattern, candidates: [{ title, pattern, rationale }], current_index, picked, results,
patterns_for_stage, generated_at, patterns_offered, dropped[], positioning_used } }`. `dropped[]`
says why a line was refused - a pattern not open at the stage, an exclamation mark, a duplicate,
the current title, too short - so show it as a muted note; 502 `titles_unavailable` when the
department does not answer, 502 `titles_bad_response` when nothing usable came back. Nothing on
the item changes until a pick.

- **Present all five with their pattern and rationale, then pick one:** `content_titles_pick({
  content_id, index })` - `index` is the 0-BASED position in `title_candidates`, everywhere
  (tags, links, results) - writes `title` and `meta_title` (`apply_to: "title" | "meta_title"`
  narrows it), sets `settings.hook_pattern` when the H1 changes, stamps `settings.title_picked {
  index, picked_at, picked_by, applied_to }` and records a `content_versions` row, so the change
  is reversible and the weekly test measures search CTR from that moment. Default: the candidate
  whose pattern the department used for the opener. 400 `invalid_index` when there are no
  candidates or the index is outside them. A pick on a piece that is already live changes the
  row, not the page: the new `meta_title` reaches the site on the next `content_publish_to_site`
  (call it after a pick on a published piece, on the owner's yes), and Search Console keeps
  measuring the old title until then - say "meta title changed; republish to apply".
- **Never write `settings.title_candidates`, `title_picked` or `title_results` by hand:** the
  builder validates the slugs and refuses exclamation marks; a hand-written set is a set the
  test loop cannot attribute. `hook_pattern` is the one key a session writes.
- **The off-site test loop.** A social derivative that tests candidate n carries
  `linked_content_id` = the item AND the tag `title:<n>` (or a `link_url` with
  `utm_term=title-<n>`), with that candidate as its first line; an email or digest link carries
  `utm_content=<slug>` (the digest convention) AND `utm_term=title-<n>`. Each derivative of a
  piece that has candidates carries a DIFFERENT candidate. Every Monday the title-results run
  pools Search Console CTR on the live title (the baseline; an account with no Search Console
  archive is skipped with a note) with the social and email click rates per candidate, writes
  `settings.title_results { version, computed_at, window, by_candidate[{ index, impressions,
  clicks, ctr, source: gsc | social | email }], current_index, baseline, winner { index, ...,
  lift, relative_lift } | null, notes[] }`, and writes a winner to `meta_title` only (the H1 stays;
  a person applies it to both through the pick) when it beats the live title on at least 500
  impressions and 10 clicks by 20 percent relative and 0.5 points absolute. The pool is
  deliberate: a candidate can win on social and email clicks alone against a search baseline,
  so name `winner.sources` when you report it, and the winner too reaches the live page only on
  the next publish. `content_titles_get` returns the same view plus `results`.
- **In the post-mortem** read `settings.title_results.winner` and `notes[]` (they are sentences:
  "No Search Console archive for this account" means no baseline, not no result), and record
  `Winning titles: <pattern> x<n>` in the content memory the way the social skill records
  winning formats. The `title_generic` rule (below) is the floor: a title with no number, no
  name, no claim and no contrast never reaches the test.

## The answer block and the FAQ - `answer_block`, `faq[]`, and the markup a publish emits

Answer engines and featured snippets lift the first direct answer on the page; the row carries
it as a column so the markup, the department and the check agree on it.

- **`answer_block`**: 40-60 words directly under the H1 (or the first H2) that restate the query
  and give the direct answer. Write it into `answer_block` on the row AND as the lead paragraph
  of the body - the two are the same words. The check's `answer_block_missing` is a warn when
  the column is empty and no 40-60 word paragraph leads the body; it checks the word band, not
  the restatement, so the restatement is your call. `result.stats.answer_block_words` says the
  count.
- **`faq`**: three to six REAL questions the research and the proof pack surfaced - People Also
  Ask from the SERP brief (`paa[]`), the first message of support tickets, call summaries - each
  answered in one to three sentences, written into `faq` on the row (`[{ question, answer }]`, at
  most 20) AND as an FAQ section in the body (a heading matching FAQ / frequently asked / common
  questions / people also ask, or two headings ending in "?"). Never pad with invented questions.
  The check's `faq_schema_mismatch` (warn) fires when the row has entries and the body has no
  FAQ section, or the reverse.
- **What the publish emits from them.** `content_publish_to_site` builds the page's JSON-LD
  graph on every publish (never on an unpublish): WebSite, Organization, WebPage, then Article
  (the author as a Person with `name`, `jobTitle`, `sameAs` and `image`, `datePublished`,
  `dateModified`, the hero image, keywords from the tags), BreadcrumbList, and FAQPage only when
  `faq` holds at least one real pair. It is stored as `settings.json_ld` (never edit it) and
  written into the collection's JSON-LD field when one exists (`json_ld_target: "field"`; a
  string, html or object field named jsonLd, schemaMarkup, structuredData or customCode); `"row"`
  means the graph is on the item only - also when a value typed into `settings.cms_fields` for
  that field is published unchanged, which `publish_warnings[]` names. The site's llms.txt is
  regenerated on every native write
  (`llms_txt_regenerated: true`; never for Webflow). Static and static-export deploys stamp the
  same nodes into the HTML; an SSR Next.js post relies on the collection field and the
  template's head - a Webflow collection with no custom-code field gets a `publish_warnings[]`
  line saying the graph did not reach the site.
- **Relay the publish response's new keys** one line each, the way `warnings[]` is relayed:
  every `publish_warnings[]` line; "Refreshed on the same URL" when `refreshed` is true (a live
  piece republished on the same entry slug; `refreshed_at` is stamped, which the decay loop
  reads); "llms.txt regenerated" when `llms_txt_regenerated` is true; and the author line above.

## Conversion inside the piece - `brand_offers_get({ project_id? })`, `brand_offers_set({ offers, project_id?, expected_lock_version? })`, `content_conversion_plan({ content_id, ensure_checkpoint? })`

The three-bucket rule (awareness subscribes, consideration downloads, decision buys) is retired.
A piece converts on the rung of awareness its reader is standing on, with an ask that fits the
rung, an offer the brand stands behind, and copy the plan supplies - so a changed offer reaches
every published piece without a rewrite.

**Offers on the guide.** `brand_offers_get` returns `{ data: { guide_id, guide_name,
cta_primary, lock_version, offers: [{ id, name, promise, guarantee, bonuses[], cta_label,
cta_url, stages[] }] } }` from the account's active guide (the project's own guide wins). Each
offer is the promise the reader accepts, the guarantee that removes the risk, the bonuses, the
button label and the ONE link, and the journey stage NAMES it fits (matched case-insensitively
to a row's `journey_stage`; an offer with no stages fits every stage). `brand_offers_set` is a
FULL REPLACEMENT: read first, edit, send the whole list back with `expected_lock_version` from
the read; ids are minted by the server and an incoming id survives only when it names an existing
entry, so content rows stay pointed at it. Limits: 20 offers, unique names of 120 chars, promise
and guarantee 400, 8 bonuses, `cta_label` 60, `cta_url` http(s) or a root path, 10 stage names.
Errors: 400 `invalid_offers` naming the entry and field, 404 `no_active_brand_guide`, 409
`offers_conflict` with the current `lock_version` (reload and resend), 503 `brand_unavailable`.
An offer is owner-approved copy: draft it, show it, write it on the yes.

**The plan per piece.** `content_conversion_plan_get({ content_id })` reads the plan without touching anything (use it to inspect before you draft); `content_conversion_plan({ content_id })` (a write: it also ensures the
journey checkpoint, below; `ensure_checkpoint: false` for a pure read) returns `{ data: {
content_id, generated_at, plan, shortcodes { inline, end, upgrade } (counts in the body), journey,
guide, checkpoint, delivery } }` where `plan` is:
- `stage { stage_name, stage_id, rung, source, job, allowed_hooks[], proof_type, cta_verb,
  destination, fallbacks[] }` - the row of the FIVE-STAGE TABLE this piece converts on, keyed to
  the account's OWN journey stage name (`table[]` holds every row; the five Schwartz rungs
  `unaware`, `problem_aware`, `solution_aware`, `product_aware`, `most_aware` are the fallback
  when the journey has none, plus `retention` after the sale). Read the row, never recall it:
  the piece opens with one of `allowed_hooks`, carries the `proof_type` (data | story |
  case_study | testimonial | guarantee) beside the ask, and its end CTA uses `cta_verb` toward
  `destination` (`newsletter` | `lead_magnet` | `comparison` | `offer`; each rung falls back
  down its list when the first cannot be resolved).
- `offer`, `offer_source: item | stage | first | null`, `cta_primary` - the offer the piece asks
  with: the row's `offer_id`, else the offer whose `stages[]` names the piece's stage, else the
  first; `lead_magnet` with everything it references resolved (`asset`, `content_item`, `form`,
  `sequence`, `download_url`, `missing[]`); `blocks { inline, end, upgrade }` - the copy the
  shortcodes render to (`{ variant, verb, destination, headline, supporting_line, label, url,
  form { form_key, form_id, fields[], submit_label, success_message } | null, proof_type,
  proof_line }`; the upgrade block `{ kind, title, description, benefits[], download_url, form }`);
  `warnings[{ code, message }]`: `lead_magnet_missing`, `lead_magnet_reference_missing`,
  `offer_missing`, `offer_stage_mismatch`, `comparison_page_missing`, `form_missing`,
  `delivery_sequence_missing`, `journey_stage_missing`. Each is a brief item, not noise: an
  `offer_missing` on a decision piece means asking the owner for an offer through
  `brand_offers_set` before it publishes; an `offer_stage_mismatch` means changing `offer_id` or
  adding the stage to the offer's `stages[]`.
- `checkpoint { status: exists | created | missing | skipped, reason?, journey_id, stage_id,
  checkpoint_id?, is_exit? }`: when the piece has a lead magnet with a form and sits on a journey
  stage, the POST gives that stage a form-submit checkpoint for the form (once), so enrollment
  and the scorecard measure the conversion; `skipped` with reason `no_form` means the lead magnet
  has no form yet. `delivery { status: sequence_linked | sequence_inactive | sequence_missing |
  no_form | no_lead_magnet, sequence_id, note }` says whether anything sends the download: a
  `sequence_missing` is honest - the hosted form's submissions land in the ledger and the CRM,
  and the delivery email is a `/hiveku:sequence` job (`email_sequence_list` shows what exists),
  not a reason to skip the magnet.

**The lead magnet on the row.** `lead_magnet { kind, title, asset_id?, content_item_id?,
form_id?, delivery_sequence_id? }` (the field table above; every id looked up in the account -
the asset from `media_library_list`, the gated piece from `content_list`, the form from the
linked site's forms, the sequence from `email_sequence_list`). The upgrade EXTENDS the promise:
its title names the thing the reader takes away from THIS piece - the checklist from the
checklist post, the template from the how-to - not a generic newsletter. When the plan warns
`lead_magnet_missing` on a long-form piece, propose one in the brief (kind, title, what it
delivers) and set it through `content_update({ content_id, lead_magnet })` before the draft.

**The shortcodes - the department writes placements, never the CTA copy.** Every long-form piece
carries exactly one `::cta{variant=inline}` (after the second section, once the reader has
committed) and one `::cta{variant=end}` after the last section, then `::upgrade` when the piece
has a lead magnet. The renderer's grammar is strict: two colons, on a line of its own
(`::cta{variant=end}`); an html body uses the twins `<!-- hiveku:cta variant=end -->` and
`<!-- hiveku:upgrade -->`. A `:::cta` or a mid-sentence `::cta` passes the check but prints as
literal text on the site. The site renders the blocks from the plan (a Hiveku starter through
its post body component, a Webflow or html body as plain HTML blocks at publish; a body with no
shortcodes is untouched), so the copy is the offer's and the lead magnet's - a changed offer
reaches every published piece. Optional attributes the check reads: `label` (or `verb`) and
`url` (or `href`) to say what the ask is, `stage=<rung>` to state the rung outright; a
`::cta{url=/pricing}` counts as a link to the money page for the linking rules.

**`settings.cta_stage_table`** (optional, written at brief time): `[{ stage: <rung>, verbs?,
destinations?, journey_stages? }]` merges into the built-in five-stage table by rung, and
`journey_stages` names the account's own stage names that map onto a rung ("Ready to Book" ->
`most_aware`), so the check keys the piece to the account's vocabulary. The built-in verbs and
destinations, for reading a draft by eye: unaware - read, save, share, subscribe, learn more;
problem aware - download, get the guide, get the checklist, find out, join (`/download`,
`/newsletter`, `/webinar`); solution aware - compare, see pricing, calculate, explore, try, see how
it works (`/compare`, `/pricing`, `/calculator`, `/demo`); product aware - see the case study, watch
the demo, start a free trial, book a demo, request a quote, talk to (`/case-studies`, `/demo`,
`/trial`, `/quote`); most aware - book, schedule, buy, get started, sign up, order, call, contact,
claim, apply, hire, checkout, purchase, register (`/book`, `/schedule`, `/checkout`, `/contact`,
`/signup`, `/get-started`); retention - refer, renew, review, upgrade, invite. Funnel position ->
allowed rungs: awareness -> unaware, problem aware; consideration -> problem aware, solution aware,
product aware; decision -> product aware, most aware; retention -> retention, most aware. "Learn
more" is not a decision: a decision piece ends on one named decision toward the offer.

## The eleven elite rules in `content_seo_check`

The same `content_seo_check({ content_id })` read (`references/site-publishing.md` for the
response shape and the older rules); the score formula is unchanged (100 minus 15 per error and 5
per warning) and `result.ok` is still the gate. `context` now echoes what the check was given
(`content_type`, `author`, `answer_block`, `faq`, `money_page_urls`, `cluster`,
`keyword_collision`, `comparison_table`, `offer`, `cta_stage_table`), and `result.stats` adds
`answer_block_words`, `faq_count`, `faq_in_body`, `title_generic`, `cta_count`,
`money_link_count`, `pillar_linked`, `table_count`, `table_rows_unsourced`. `field` gained
`author_id`, `answer_block` and `faq`. Shortcode lines are stripped before words and claims are
counted, so a `::cta{label="Save 20% today"}` never raises `claims_without_source`.

| id | level | field | fires when | fix |
|---|---|---|---|---|
| `author_missing` | error | `author_id` | the row has no author and the account has no default author | set `author_id`, or create the author (above) |
| `answer_block_missing` | warn | `answer_block` | the column is empty and no 40-60 word paragraph leads the body (under the H1 or the first H2) | write the answer block into both places |
| `faq_schema_mismatch` | warn | `faq` | `faq` has entries and the body has no FAQ section, or the reverse | write the same questions into both places |
| `title_generic` | warn | `title` | no number, no name, no claim word and no contrast in the title ("A guide to X") | pick a candidate from `content_titles_generate` |
| `money_link_missing` | error | `content` | a consideration or decision piece links no money page (skipped when the account has marked none: a note says "set page roles") | link a money page from `content_site_links` with `content_id` |
| `pillar_link_missing` | error | `content` | a spoke (`cluster_role: "spoke"`) with a pillar URL does not link it (warn when the cluster has no pillar yet) | link the pillar the site-links read names |
| `keyword_already_targeted` | warn | `target_keyword` | another non-archived item in the account targets the same keyword | consolidate, or aim at a different keyword |
| `comparison_table_missing` | error | `content` | a comparison or alternatives page has no table in the body and no `settings.comparison_table` rows | fill the table (`references/site-architecture-and-decay.md`) |
| `competitor_claim_unsourced` | error | `content` | a table row about a rival with no `source` or no `checked_at` (a body table row with no link and no date) | read the rival page, cite it, date it |
| `cta_missing` | warn | `content` | no `::cta` / `::upgrade` shortcode, no form, no CTA-verb link, no link to the offer's `cta_url` and no money-page link anywhere | add the placements above |
| `cta_stage_mismatch` | warn | `content` | every CTA the check can place asks for a rung the piece's stage does not allow (a decision piece whose only ask is "Subscribe"; an awareness piece linking `/pricing`) | change the ask, or map the stage name through `settings.cta_stage_table` |

`title_generic` and `cta_stage_mismatch` are the two a writer fixes by hand - a better title, a
fitting ask; the other nine name a field or a link. The rules that read the site (money pages,
the pillar) and the bottom-funnel rules are explained where their data lives, in
`references/site-architecture-and-decay.md`.
