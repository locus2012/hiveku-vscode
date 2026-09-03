# Digital PR and Brand Mentions - monitoring, reclamation, sentiment, angles, assets

## What this covers / when to load this

Brand-mention monitoring (who is writing about the client, how often, where), unlinked-mention
reclamation (mentions that never became links), sentiment on the open web, PR-angle
generation from the client's own assets, linkable-asset discovery from what already earns
links in the niche, and newsjacking off a rising topic. Load it when the ask is "who is
talking about us", "turn mentions into links", "is the sentiment shifting", "what could we
pitch", or when Lane 4 of the link program (net new, digital PR) needs a plan.

It does not cover outreach sending, loading or sequencing: that is Outbound's, in
`hiveku-outbound-agency/references/backlink-outreach.md`, and nothing sends from here. It
does not cover the opportunity queue, R-A-P-D scoring, the four lanes or lost-link recovery
(`link-building-and-competitors.md`); Google reviews and GBP reputation (`local-seo.md`, the
only place a reply is ever published); or how the brand appears inside AI answers
(`aeo.md`). The tool rows themselves are catalogued in `metered-research-suite.md`.

## Availability

| Tool | Status | Cost | Note |
|---|---|---|---|
| `content_analysis_search` | LIVE | per request (treat as class B) | pages citing a keyword; `keyword`, `search_mode: 'as_is'` for a brand, `page_type`, `limit` to 1,000 |
| `content_analysis_summary` | LIVE | per request (treat as B) | citation overview with sentiment connotations, top domains, countries |
| `content_analysis_phrase_trends` | LIVE | per request (treat as B) | citations over a date range grouped by period |
| `seo_research({ action: 'sentiment-analysis' })` | LIVE | per request | sentiment around a brand or term; `keyword` |
| `seo_research({ action: 'content-mention-search' })` | LIVE | per request | wraps `content_analysis_search` with `as_is` matching and the same page types |
| `seo_research({ action: 'content-summary' })` | LIVE | per request | wraps `content_analysis_summary` |
| `backlinks_backlinks` | LIVE | D | our live links; the reclamation diff's second input |
| `backlinks_bulk_ranks`, `backlinks_bulk_spam_score` | LIVE | D, 1,000 targets | qualify a mention list in one call each |
| `backlinks_domain_pages_summary`, `backlinks_domain_pages` | LIVE | D | a rival's most-linked pages: the linkable-asset read |
| `talk_to_department({ domain: 'seo' })` | LIVE | agent turn | angle generation with evidence |
| `talk_to_department({ domain: 'outbound' })` | LIVE | agent turn | the handoff, never the send |
| `web_search`, `web_scrape`, `web_extract`, `web_map` | LIVE | Firecrawl credits | verify a mention is live and unlinked; find the author |
| `account_context_get({ domain: 'seo' })` | LIVE | A | brand voice, protected terms, the assets the client actually has |
| `pm_tasks_create`, `memory_create`, `memory_update`, `memory_list` | LIVE | A | persistence |
| `seo_sheet_create_tab`, `seo_sheet_add_rows` | LIVE | A | the dated mention and prospect tabs |

No monitoring or alerting tool exists: mention data is a snapshot each time you ask. No
tool submits a story, contacts a journalist or places a link. No tool reads social
mentions; `content_analysis_*` covers blogs, news, reviews and main pages in DataForSEO's
citation index.

## Ground truth

- A "citation" in the `content_analysis_*` family is a page in DataForSEO's index whose
  text contains the keyword. It is not the whole web, it is not social, and it lags
  publication by days. A brand with zero citations in it may still be discussed; a brand
  with 400 may have 380 syndicated duplicates.
- Mentions and links are different ledgers. The reclamation list is the set difference:
  domains that mention us (citations) minus domains that link to us (`backlinks_backlinks`
  source domains). Both must be pulled for the same domain, the same week.
- Sentiment is scored per snippet by the vendor's model and rolled up as connotation
  counts. It is directional. One trade-press piece scored negative because it quoted a
  competitor's complaint is not a reputation event.
- `search_mode: 'as_is'` matters for brands. The default matching can return pages
  containing the words separately; a two-word brand name without `as_is` returns the
  dictionary.
- The reputation boundary: Google reviews are read and answered in `local-seo.md`
  (`seo_gbp_reviews`, `seo_gbp_review_reply`, two-step, public). Yelp, Trustpilot and
  Tripadvisor are read through `seo_research` review actions and answered nowhere. AI
  answers are `aeo.md`. This file watches the open web and never replies to anything.

## Decision frameworks

**Is a mention worth chasing?** In order: the page is live and the mention is still there
(`web_scrape`); it does not already link to us (the diff, then the scrape confirms); the
domain has a rank worth having (`backlinks_bulk_ranks`) and a spam score under the
link-building threshold (`backlinks_bulk_spam_score`); the context is editorial, not a
scraper or a syndication copy; an author or editor is findable. Five yes answers is a
prospect. A high-rank domain with a syndicated copy is not.

**Which angle deserves a campaign?** The client has to own one of four things: original
data (their own numbers, surveyed or logged), a tool or calculator, expertise a journalist
can quote, or a contrarian position backed by evidence. `account_context_get` says which
exist. An angle built on none of them is a press release, and press releases do not earn
editorial links.

**Which asset to build?** The one whose format already earns links in this niche
(`backlinks_domain_pages_summary` on rivals), that the client can produce credibly, and
that has a search demand of its own so the asset ranks after the campaign ends. A study
nobody searches for earns links once; a calculator people search for earns them yearly.

## The plays

### P1. Mention baseline (month 1, then monthly)

1. `account_context_get({ domain: 'seo' })` for the brand name variants, product names and
   protected terms; `memory_list` for a prior baseline and the agreed name regex.
2. `content_analysis_summary({ keyword: '<brand>' })` for counts, sentiment connotations,
   top domains and countries. Repeat for the product names that are searched as their own
   thing.
3. `content_analysis_search({ keyword: '<brand>', search_mode: 'as_is', limit: 1000 })`
   (or `seo_research({ action: 'content-mention-search', keyword })`) for the page list.
   Read out domain, URL, page type, date, sentiment, and whether the snippet is our copy
   syndicated.
4. Persist: a dated tab `"2026-08-30 Mentions (brand)"` with the page list, and
   `memory_create` with the counts, sentiment split, top ten domains and the regex.

**Decision:** whether the brand has a footprint to reclaim (P2) or a footprint to build
(P4, P5). Under 20 editorial mentions is the second case.

### P2. Unlinked-mention reclamation (the highest close rate in link work)

1. The mention list from P1, filtered to editorial page types and de-duplicated by domain.
2. `backlinks_backlinks({ target: '<our domain>', limit: 1000 })`, paged with `offset` if
   needed, reduced to the set of linking source domains.
3. The difference: mention domains not in the linking set. That is the raw reclamation list.
4. Qualify in bulk: `backlinks_bulk_ranks({ targets: [...] })` and
   `backlinks_bulk_spam_score({ targets: [...] })` in one call each (up to 1,000 targets);
   drop by the thresholds below.
5. Verify each survivor: `web_scrape({ url })` confirms the mention is live and unlinked;
   `web_map({ url: '<domain>' })` then `web_extract` finds the author or editor path.
   Never load a contact that was not verified.
6. Persist the prospect batch: a dated tab `"2026-08-30 Reclamation prospects"` and one
   `pm_tasks_create` per batch (not per prospect) titled with the count and the lane.
7. Handoff: `talk_to_department({ domain: 'outbound', message })` with the batch, the
   exact mention URL per prospect and the one-line ask ("link the existing mention to
   <URL>"). Outbound loads, sequences and sends per
   `hiveku-outbound-agency/references/backlink-outreach.md`. Confirm the batch with the
   human before the handoff: segment count, five sample prospects with why each qualifies,
   the ask copy. Get a yes.

**Closes the loop:** placements are verified with `backlinks_backlinks` on the next monthly
pull, and the PM task carries the count won. Never report emails sent as links won.

### P3. Sentiment watch, and the reputation boundary

1. Monthly, on the P1 pull: `content_analysis_summary` connotation split versus last
   month's memory note; `seo_research({ action: 'sentiment-analysis', keyword })` for the
   snippet-level view when the split moved.
2. Read the negatives by domain and page type. Reviews aggregators, a competitor's
   comparison page and a genuine news story are three different findings.
3. Boundary: a Google review goes to `local-seo.md`; a Yelp or Trustpilot pattern is a
   report plus `pm_tasks_create` (no reply tool exists off Google); a news story is an
   escalation to the account owner with the URL and the quote, never a public response
   drafted here; an AI-answer misstatement is `aeo.md`.
4. Persist the monthly split and any escalation in memory.

### P4. PR-angle generation from the client's assets

1. `account_context_get` and `memory_list`: what the client owns (data, tools, expertise,
   case studies), brand voice, what is off limits.
2. Evidence, not a request, into `talk_to_department({ domain: 'seo', message })`: the
   assets, the niche's most-linked formats from P5, three rival campaigns that earned links
   (URL and referring-domain count from `backlinks_domain_pages_summary`), the audience
   from the avatars. Ask for three to five angles, each with the asset it needs, the
   publications it fits and the hook in one sentence.
3. Kill any angle that needs an asset the client does not have or cannot produce in the
   quarter. Confirm the survivors with the human.
4. `pm_tasks_create` per chosen angle with owner, asset, deadline; `memory_create` the
   angles and the rejected ones with reasons, so the next quarter does not re-pitch them.

### P5. Linkable-asset discovery

1. The competitor set from memory (four to eight domains, agreed).
2. `backlinks_domain_pages_summary({ target: '<rival>', limit: 50 })` per rival, sorted by
   referring domains; `backlinks_domain_pages` for per-page detail when a row needs it.
3. Classify the top ten per rival by format: data study, tool or calculator, glossary or
   definition, template, ranking or list, original research, free resource, news hook.
4. `web_scrape` the top three across the set to read what the linking pages actually cite
   (a chart, a number, a definition, a download).
5. The same call on our own domain: which of our pages already earn links, and whether the
   next asset extends one of them instead of starting cold.
6. Output: one recommended asset with the format evidence (N rival pages, referring-domain
   counts, the citation pattern), a search-demand check from the metered suite so it ranks
   on its own, and a `pm_tasks_create` for production through the content lane.

### P6. Newsjacking with phrase trends

1. `content_analysis_phrase_trends({ keyword: '<topic>', date_from, date_to, date_group: 'week' })`
   on the three topics the client can speak to with authority; read the weekly citation
   counts.
2. A week that doubles the trailing average is a window. Windows close in days.
3. Inside the window: `web_search` the topic for the pieces being written, `web_scrape`
   two to read the frame, one expert-comment angle through
   `talk_to_department({ domain: 'seo' })` with the data the client can add.
4. The comment or short piece ships through the content lane; the pitch goes to Outbound.
   Nothing here publishes or sends.

## Thresholds and benchmarks

| Item | Value | Label |
|---|---|---|
| reclamation prospect: spam score | drop over 30; drop over 15 with low relevance | `link-building-and-competitors.md` section 3 |
| reclamation prospect: rank | `backlinks_bulk_ranks` above 0 and a live page; rank alone never qualifies | house rule |
| reclamation batch size | 20-40 live prospects per month for a single-site retainer | `link-building-and-competitors.md` section 3 |
| expected reclamation close rate | 30-60 percent | `link-building-and-competitors.md` section 3, sanity check only |
| mention footprint worth reclaiming | 20+ editorial mentions | house rule |
| sentiment escalation | negative share over 20 percent for two consecutive months, or any negative news domain with rank above the client's own | house rule |
| phrase-trend window | a week at 2x the trailing eight-week average | house rule |
| PR campaign prospect list | 10-30 publications per angle, each with a named editor | house rule; Outbound's cadence rules apply after handoff |
| outreach benchmarks after handoff | reply 5-15 percent, placement 1-5 percent | `hiveku-outbound-agency/references/backlink-outreach.md` |

## Diagnosis: when the data looks wrong

| Symptom | Cause, in check order | Action |
|---|---|---|
| zero citations for a real brand | name too generic or too rare for the index; `search_mode` not `as_is`; the brand is discussed on social only | try the product name; add `as_is`; say the index does not cover social |
| hundreds of citations, all the same text | syndicated press release or a scraper network | de-duplicate by snippet; report editorial mentions only, with N and the exclusion |
| mention list includes our own site and partners | the keyword matched our copy | filter our domain and known partners before the diff |
| `backlinks_backlinks` shows fewer links than GSC's Links report | different index, different crawl date | expected; the diff uses the vendor index for both sides so it stays consistent |
| a "won" link is not in next month's pull | the vendor has not crawled the page yet, or the link is nofollow and filtered | `web_scrape` the page; report it as verified-by-scrape, and count it when the index catches up |
| sentiment swung with no news | a reviews aggregator re-indexed, or a competitor comparison page | read by domain before escalating |
| `phrase_trends` flat on a topic in the news | the keyword is not how the index phrases it | search the summary for the phrasing the citations use |

## Edge cases and failure modes

- **Never send from here.** Not through Outbound tools, not through a survey, a GBP reply,
  or a social post. Drafting and handoff are this file's job; sending is Outbound's, on a
  human's explicit yes.
- **Never buy a placement, propose a sponsored-link network, or run a PBN**, whatever a
  rival's link profile shows. Digital PR and reclamation are the answer to "they have more
  links".
- **Never reply to a negative mention or review from this file.** Escalate with the URL.
- **Generic brand names** (a common word) make every mention count noisy. Use the product
  names and the founder's name as the tracked keywords and say the brand term is
  unmeasurable.
- **Rebrands and multiple brands.** Track old and new names separately; the old name's
  mentions are the first reclamation list after a rebrand, since every one of them links
  (if at all) to a URL that now redirects.
- **Multi-site accounts.** Filter the mention list and the backlink list by the same
  domain before the diff; a prospect for one client is a leak for another.
- **Do not quote a commenter or a reviewer by name in a deliverable.** Aggregate.
- **Do not track a competitor's brand mentions without approval.** It spends credits and
  shows up in reports.

## Persistence and reporting

- Dated tabs, replace-by-name: `"2026-08-30 Mentions (brand)"`,
  `"2026-08-30 Reclamation prospects"`, `"2026-08 Linkable assets (rivals)"` via
  `seo_sheet_create_tab` then `seo_sheet_add_rows`.
- `pm_tasks_create` per prospect batch, per chosen angle, per asset; `pm_tasks_complete`
  only when a link is live and verified, never when the pitch went out.
- `memory_create` for decisions: the brand-name regex and product names tracked, the
  monthly mention and sentiment split, chosen and rejected angles with reasons, vetoed
  publications, the reputation escalation contact. `memory_update` resends the whole note.
- The report's Authority section (assembled per `reporting-and-delivery.md`): mentions
  this month with N and exclusions, reclamation links won by source domain, sentiment split
  with the same-month-last-year figure when memory holds it, campaign status by angle. A
  mention count is not a link count and a pitch is not a placement; the section says which
  is which.
