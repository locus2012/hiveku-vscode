---
description: Deep web research for the bound account - competitors, content gaps, prospects.
argument-hint: "[what to research - e.g. 'competitor pricing pages']"
---

Research $ARGUMENTS for the account this directory is bound to. Escalate only as far as you need -
each rung costs more:

1. `web_search({ query, count?, country?, freshness? })` - find candidate URLs / answer a quick question.
2. `web_scrape({ url, formats: ["markdown"] })` - one page's content (the workhorse).
3. `web_map({ url, search? })` - enumerate a whole site's URLs (find every /pricing, /service page).
4. `web_crawl({ url, limit })` - pull many pages of a site at once (competitor content audit).
5. `web_extract({ urls: [...], schema | prompt })` - pull STRUCTURED JSON across many URLs (e.g. {price, plan}
   from every competitor pricing page) - the highest-leverage rung for comparison tables.
6. `web_actions({ url, actions: [...] })` - click/scroll/fill to reach content behind interaction.

First read the account's own positioning with `account_context_get({ domain })` so the research is framed
against this brand, not generic. Persist the conclusion to department memory (`memory_list` first, then
`memory_update` on the standing note; `memory_create` only when none exists) and, for SEO/content, feed
it into content-gap and keyword work. Cite source URLs in your summary; never fabricate a finding.

7. Index what you used - the evidence outlives this chat. The Content research knowledge base
   (`kb_list({ context_type: "content_research" })`; the research run creates it, never create a
   second one) holds the pages behind a finding: `kb_documents_index_text({ kb_id, title, content,
   source_url, tags })` per page you relied on (the route stores `source_url` and `tags` as the
   document's provenance and reuses a document whose URL is already in the KB), then `kb_search`
   to confirm it answers. Memory holds the conclusion, the KB holds the evidence.
   Research FOR a piece of content is not this ladder: `content_research_run({ content_id })` (or
   `content_research_topic({ topic })` before a row exists) does the search, the SERP read, the
   extraction and the indexing in one run, cites every claim and stamps the row - see
   hiveku-content-agency/references/research-and-proof.md.
