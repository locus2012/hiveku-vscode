# Research, proof and case studies

Load this file before the brief of any piece (the research run comes first), before drafting a
consideration or decision piece (the proof pack, one proof element per H2, the decision-stage
source rule), before drafting a case study from a won deal, and before an expert interview
(`/hiveku:sme-interview`). The distribution plan and the scorecard are in
`references/distribution-and-scorecard.md`.

## Availability - the elite content program's incoming tools (2026-09-12)

Seven hands land with round A of the elite content program. Each builder route is live on `main`;
the MCP names below are mapped in the parallel MCP lane and reach `lib/tool-index.json` when that
server deploys (until then `test/pending-tools.mjs` carries them as ELITE-A).

| Tool | Status | Route (Olympus auth, account-scoped) |
|---|---|---|
| `content_research_run` | INCOMING (builder 23bed5d65, bdc4f2f6b) | `POST /api/olympus/marketing/content/:contentId/research` |
| `content_research_get` | INCOMING (builder 23bed5d65) | `GET /api/olympus/marketing/content/:contentId/research` |
| `content_research_topic` | INCOMING (builder 23bed5d65) | `POST /api/olympus/marketing/content/research` |
| `kb_artifacts_list` | INCOMING (builder 23bed5d65, bdc4f2f6b) | `GET /api/olympus/knowledge-bases/artifacts` |
| `kb_artifact_get` | INCOMING (builder 23bed5d65) | `GET /api/olympus/knowledge-bases/artifacts/:artifactId` |
| `content_proof_pack` | INCOMING (builder 4cd5bd7f6, 95ec02834) | `GET /api/olympus/marketing/content/proof-pack` |
| `content_case_study_draft` | INCOMING (builder a1bea92a4, a8125a616) | `POST /api/olympus/marketing/content/case-study` |

A key whose server does not serve a name yet answers unknown-tool: say so, run the tool-free form
of the step (`kb_search` plus the `/hiveku:research` ladder for evidence; `marketing_testimonials_list`,
`before_after_grid_get` and `content_comments_recent` for proof by hand; the case study as an
ordinary Play 3 draft from `crm_get_deal` and a consented testimonial), and never present the gap
as "Hiveku cannot do this".

## Search before you write - the knowledge base is the research layer

1. **`kb_search({ query })` first, for every H2 you plan.** With no `kb_id` the search covers every
   knowledge base in the account (brand guides, service menus, earlier research briefs); rows carry
   `content`, `score`, `knowledgeBaseName` and `metadata` (`url` for an indexed page, `filename`
   for an upload, `artifact_id` and `artifact_type` for a stored brief). Quote the passage and name
   the KB ("per our Service menu KB"). `marketing_knowledge_bases_search` is the same read with
   `top_k`.
2. **Then the stamp.** `content_get({ content_id })` returns `settings.research` when a run has
   happened: `{ version: 1, artifact_id, knowledge_base_id, ran_at, queries[], claims_count,
   stats_count, sources[{ url, title, document_id, page_id }], serp_keyword, gaps[] }`. When the key
   is missing, or `ran_at` is older than 30 days, run `content_research_run` (below); otherwise
   `content_research_get` reads the artifact the stamp points at, no spend.
3. **The Content research KB.** One per account, `context_type: "content_research"`, created by
   the first run (`kb_list({ context_type: "content_research" })` finds it; never create a second
   one and never look it up by name). Every page a run relied on is indexed there with its URL as
   `metadata.url`, and every brief, proof pack or case study artifact is indexed as a document with
   `metadata.artifact_id`, so a later `kb_search` surfaces it.

## The research run - `content_research_run({ content_id, queries?, keyword?, include_web?, include_serp?, max_sources?, location_code?, location_name?, index_sources? })`

What it does, in order: searches every KB in the account, reads the Google SERP for the item's
`target_keyword` (one DataForSEO call against the monthly SEO research cap; a `settings.serp_brief`
captured in the last 30 days is reused instead), searches and fetches up to `max_sources` (1-10,
default 5) web pages, extracts claims and figures each with a quote copied verbatim from its
passage and a source URL, indexes every page it used into the Content research KB (a URL already
there is reused, never indexed twice), writes the artifact (`artifact_type: "content_research"`,
name `Research: <title>`) and stamps `settings.research` on the row LAST. A re-run refreshes the
same artifact. `queries` is at most 5 strings of 200 characters (default: the target keyword, else
the title); `location_code` 2840 | 2826 | 2124 | 2036 | 2372 | 2554, anything else falls back to
the account market with a warning; `location_name` wins when given.

**What it spends, say so before calling:** Firecrawl search credits (one search per query, pages
fetched inline), one DataForSEO SERP call unless the brief is fresh or `include_serp` is false,
OpenAI embeddings per indexed page and for the brief, one model completion for the extraction.
The run is synchronous inside the request (up to 300 s): call with a 240 s or longer client
timeout, and on a client-side timeout read `content_research_get` before running again - the
stamp lands when the run finishes, and a second run is a second spend. The route honours
`Idempotency-Key`.

**Response (201):** `{ data: { artifact_id, knowledge_base_id, artifact_created, content_id,
topic, queries, ran_at, research (the stamp), claims[], stats[], competitor_notes[], gaps[],
sources[], serp, kb_hits, web_hits, extraction: "llm" | "fallback", confidence_score, spent {
serp_requests, search_requests, scrape_requests, documents_indexed, kb_searches }, warnings[] },
result_info }`. `claims[]`: `{ claim, quote, source_url, page_id, document_id, upload_id,
knowledge_base_id, kind: "kb" | "web", score }` - `source_url` is null for a KB passage.
`stats[]`: `{ statement, value, source_url, quote, kind }`. `competitor_notes[]`: `{ url, domain,
position, title, notes }` from the SERP top 10. `sources[]`: `{ url, title, document_id, page_id,
indexed, already_indexed, chars, query, error? }`. A monthly-cap hit answers `serp: null` plus a
gap `{ question: "SERP not read", why: "monthly research cap" }`, never an error; a page over
60,000 characters is skipped and reported as a gap; a quote not found in its passage is dropped and
counted in `warnings`; without a model key `extraction` is `fallback`, the passages themselves are
the claims and `confidence_score` is 0 - say so, and treat those claims as leads to verify.

`content_research_get({ content_id })` returns `{ data: { content_id, research: <stamp> | null,
artifact: <knowledge_artifacts row> | null } }`; 404 outside the account, nothing written.

**A topic with no row yet:** `content_research_topic({ topic, keyword?, avatar_id?, project_id?,
queries?, include_web?, include_serp?, max_sources?, location_code? })` runs the same pass (201,
`research: null`, `content_id: null`); the artifact in the Content research KB is the deliverable.
Nothing is stamped: name the `artifact_id` in the brief and read it back with `kb_artifact_get`.
When the calendar row exists, `content_research_run` on it stamps the row; the pages the topic run
indexed are reused, not fetched twice, so the second pass costs the extraction and the searches.

**Finding stored artifacts:** `kb_artifacts_list({ artifact_type?, kb_id?, content_id?,
is_verified?, page?, limit? })` returns `{ data: [{ id, knowledge_base_id, artifact_type, name,
content_json, content_markdown, source_page_ids, generated_from_kb_ids, confidence_score,
is_verified, created_at, updated_at }], total, page, limit }`, newest first, across every KB in
the account (`artifact_type` values today: `content_research`, `serp_brief`, `positioning`,
`proof_pack`, `case_study`, `data_study`; `content_id` filters on `content_json.content_id`).
`kb_artifact_get({ artifact_id })` is the one-artifact read for the id a stamp carries; 404 when
the artifact's KB is not in the account. A bad `page` is a normal first page, not an error.

## Citing what the run found

- Every number, quote or third-party fact in the draft cites `claims[i].source_url` inline, as a
  link where the claim is made; a `kind: "kb"` claim names the KB instead ("per our <KB name>").
  The `quote` is verbatim by construction - never paraphrase it into a quotation; a paraphrase is
  prose with a citation, not a quote.
- The brief hands the department the claims it may use (claim, quote, source URL) and the gaps
  it may not fill from memory; a gap the run reported is a question for the expert
  (`/hiveku:sme-interview`), not a sentence to invent.
- **Index what you used.** A page you relied on that is not in `sources[]` goes into the Content
  research KB so the next writer finds it: `kb_documents_index_text({ kb_id: <Content research KB
  id>, title, content, source_url })`. Trap: the documents route stores `title`, `content` and a
  `metadata` object today; `source_url` and `tags` are declared on the tool but the route does not
  read them yet, so put the URL on the first line of `content` and in the title until it does
  (the research run's own indexing carries `metadata.url`; a by-hand index does not).
- The header line of the report gains `Sources: <n>` - the count of distinct cited sources in the
  draft, counted from the draft, not from `claims_count`.

## The proof pack - `content_proof_pack({ avatar_id?, journey_stage?, keyword?, since?, limit? })`

The account's proof in one read, for the piece being written: public consented testimonials,
review text, the first inbound message of support tickets (segmented by the avatar's tags; the
newest tickets when none carry them), call summaries, completed-survey free text, measured results
from the active before/after grids (the avatar's grids first) and the objection library with its
best response. Read-only; nothing is stamped on the row.

**Response:** `{ data: { generated_at, filters, avatar: { id, name, tags } | null, entries: [{
source_type, source_id, date, text (at most 600 characters), attribution, consent, citation,
rating?, response? }], counts: { testimonial, review, ticket, call, survey, grid_result,
objection }, phrases: [{ phrase, count }], sources: [{ source_type, count, ok, note? }], notes[]
} }`. Entries are interleaved in the order the stage calls for (decision leads with testimonials
and grid results; awareness with tickets and surveys). `keyword` is a case-insensitive substring
every entry must contain (at most 120 characters); `since` an ISO date; `limit` 1-100, default
40. 404 `avatar_not_found`, 400 on a bad query. A source that cannot be read is reported in
`sources[]` and `notes[]`, never thrown - a pack with `sources[].ok: false` is partial and the
brief says which source was unavailable.

**The consent flag is a rule, not a hint.** `consent: true` (testimonial, review, grid_result)
may be quoted verbatim with its `attribution`. `consent: false` (ticket, call, survey, objection)
is internal voice of customer: paraphrase the pain in the customer's own words, name nobody, never
quote the line. No workaround exists - a ticket line is not "anonymised" by trimming the name.

**Using it in the brief.** For a consideration or decision piece, plan one proof element per H2 -
a figure, a quote, a link or an image - and hand the department the entries it may use with their
`citation` copied unchanged (`[source: testimonial:<id>]`, `[source: review:<id>]`,
`[source: before_after_grid:<id>]`, `[source: call:<id>]`, `[source: survey:<id>]`,
`[source: objection:<id>]`); `content_seo_check` accepts that marker beside a figure and strips it
from the prose before word counts. `phrases[]` is the avatar's own vocabulary for the pain - the
words the gate checks for in step 5. Awareness pieces read the pack too (tickets and surveys are
where the questions come from) but carry no per-section requirement.

## The proof rules in `content_seo_check`

The row's `journey_stage` is classified into awareness | consideration | decision | retention
(`result.stats.journey_stage_kind`; null when unknown). Two findings come from it:

- `proof_per_section` (level `warn`, field `content`): for a consideration or decision piece,
  every H2 section carries one proof element under the heading; `result.stats.h2_count` and
  `result.stats.sections_without_proof` say how many miss. A warn is a decision to state, not a
  block - but a decision piece with three unproven sections is a brief that failed, so it goes
  back to the department.
- `claims_without_source` (level `warn`, and `error` at the decision stage, field `content`): a
  sentence stating a figure with no source link, bare URL or `[source: ...]` citation in the same
  paragraph. At decision it is an error, so `result.ok` is false and the piece is not published
  until every figure has its source - that is the page the reader is deciding on.

## Case studies from a won deal - `content_case_study_draft({ deal_id, testimonial_id?, grid_item_id?, avatar_id? })`

Drafts a case study from a won CRM deal and saves it as a draft content row (`content_type:
"case_study"`, `journey_stage: "Decision"`, tags `["case-study"]`, markdown body in five
sections: The problem, What we did, Results, In their words, What this means for you). It reads the
deal with its contacts and company, the contacts' tickets and call summaries for the problem in
the customer's words, the consented testimonial for the quote (verbatim, never rewritten) and a
before/after grid's measured results for the numbers, asks the content department for the prose,
and writes `settings.case_study { client, problem, solution, results[{ metric, before, after,
source }], quote, sources[], deal_id, drafted_at }`. Every result line carries `[source:
before_after_grid:<id>]` and the quote `[source: reputation_testimonial:<id>]`, so the decision-
stage check passes on the numbers. Numbers never come from the model: results are parsed from the
grid's measurable results ("from X to Y"); the model writes the prose only.

- **Which deals qualify:** a won deal is one whose status the account marks `is_won` in its CRM
  statuses, or the literal `won` / `closed_won`. `crm_list_deals({ status })` and `crm_get_deal({
  deal_id })` find it; a deal that is not won is 409 `deal_not_won` and nothing is written.
- **The consent rule:** `testimonial_id` must be public with consent granted and not revoked;
  omitted, the newest consented testimonial from the deal's contacts is used; none, or one without
  consent, is 409 `no_consent` and nothing is written. A 409 is the answer to relay, never a
  reason to draft the quote by hand from a ticket or a call - `marketing_testimonials_list` shows
  what is approved and public, and the fix is collecting consent, not routing around it.
- **Other errors, all with nothing written:** 400 `invalid_request` | `invalid_reference`, 404
  `deal_not_found` | `testimonial_not_found` | `grid_not_found`, 502 `draft_unavailable` |
  `draft_bad_response`. `grid_item_id` is a grid id or the `item_id` of one transformation
  inside a grid; `avatar_id` defaults to the grid's target avatar.
- **Idempotent, slow:** the draft's model call takes up to three minutes; call with a 240 s or
  longer client timeout. The proxy injects `Idempotency-Key`, so a retry replays the first answer
  instead of saving a second row - on a timeout, `content_list({ content_type: "case_study" })`
  before calling again.
- **After the draft:** it is a Play 3 row like any other - `content_seo_check` (decision stage, so
  an unsourced figure is an error), the grounding read back from the row, and the customer's own
  written approval of the draft through `content_share_link_create` before it publishes: the
  testimonial consent covers the quote, not the story told around it.

## Expert sources on the row - `settings.sources[]` (the `/hiveku:sme-interview` contract)

Quotable lines from a subject-matter expert are stored on the item so the department, the gate and
the next writer find them. The shape, written through `content_update({ content_id, settings: {
sources } })`:

```json
[{ "id": "interview-1", "kind": "interview", "quote": "<verbatim>", "attribution": "Jane Doe, lab director, Acme Testing",
   "supports": "<the claim or H2 the line proves>", "source_ref": "call:<voice_calls.id> | transcript:<date>",
   "captured_at": "2026-09-12T10:00:00.000Z", "on_record": true }]
```

- The settings PATCH merges top-level keys and REPLACES `sources` whole: `content_get` first,
  append to the array it returns, write the whole array back. Ids are `interview-<n>` and never
  reused; a line the expert asked to keep off the record is not stored at all.
- The citation is `[source: interview:<id>]` beside the quote or the figure it supports;
  `content_seo_check` accepts it as a source, so an expert's figure at the decision stage passes
  the `claims_without_source` rule with its attribution visible.
- How the department uses them: the brief you hand `talk_to_department` carries every entry
  (quote, attribution, what it supports), so the draft quotes them verbatim under the H2 they
  support and cites them; a stored quote is a proof element for `proof_per_section` and a source
  for `claims_without_source`. The department never edits a quote - a line that needs shortening
  is quoted in part with an ellipsis, never rewritten.
