# On-page optimization

## What this covers / when to load this

Per-page and per-template optimization on a site Hiveku hosts or audits: the SERP-driven rewrite
of one URL's title, meta, H1 and heading map, its answer blocks, entity and topic coverage,
internal links, JSON-LD, images, hreflang, video, Core Web Vitals at page level, and the CTA, plus
the four write paths that ship any of it and the read that proves it landed. Load it for "optimize
this page", "why does this page not rank for X", "fix the titles the audit flagged", "add schema",
"set up hreflang", or any per-URL brief.

It does not cover keyword selection (which query the page should target is
`references/keyword-research.md`), the technical crawl and index layer (canonical graphs,
robots, sitemaps, redirects: `references/technical-seo.md` and
`references/technical-seo-blind-spots.md`), content decay, cannibalization and the refresh
program (`references/content-strategy.md`), or the gate a write must clear
(`references/seo-change-discipline.md`, load it before the first write). Argument shapes are the
declared ones as of 2026-08-30; where a shape is not stated, describe the capability and check the
tool's schema rather than guessing an argument name.

## Availability

Cost classes: A = free DB read; free = platform key, no per-account spend; write = free,
confirm-gated per seo-change-discipline.md; B = Labs per request; C = live SERP per request per
location; E = on_page instant per URL; F = crawl per page. Every metered call returns 402 when the
DataForSEO balance is negative and 503 `dataforseo_unconfigured` with no credentials; neither
means clean or empty.

| Tool | Status | Cost | Note |
|---|---|---|---|
| `pages_list`, `pages_get` | LIVE | A | pages-model rows; `pages_get` returns `meta_title`, `meta_description`, `meta_keywords`, `focus_keywords`, `slug`, `is_published`, `show_in_sitemap`, `sitemap_frequency`, `sitemap_priority`, `file_path`, `content_structure`; no canonical, robots or schema |
| `pages_update` | LIVE | write | fields `meta_title`, `meta_description`, `meta_keywords`, `focus_keywords`, `slug`, `show_in_sitemap`, `sitemap_frequency`, `sitemap_priority` (also `name`, `is_published`, `custom_css`, `custom_js`); only the fields you pass change; no confirm |
| `cms_list_collections`, `cms_read_entry`, `cms_write_entry` | LIVE | write | CMS-driven pages; `draft: true` writes the draft shadow; not visible to a marketing-seo key |
| `project_files_search`, `project_files_bulk_get`, `project_files_bulk_save`, `project_vcs_commit`, `deploy_site` | LIVE | write | the code lane for templates; not visible to a marketing-seo key |
| `verify_typecheck`, `project_test_build` | LIVE | free | the build gate before `deploy_site` |
| `seo_task_implement` | LIVE | paid agent turn, two-step | the implement rail for mechanical page-scoped fixes; ends in a staged production deploy a human approves |
| `seo_schema_markup` | LIVE | A | read only: detected vs suggested per page, sweep-refreshed |
| `seo_gsc_inspect_url` | LIVE | free | indexed snapshot only: coverage, selected canonical, `lastCrawlTime`, rich-result detection |
| `seo_gsc_search_analytics`, `seo_gsc_search_queries` | LIVE | free | the page's real query set; `search_type: 'video'` or `'image'` on the second |
| `seo_core_web_vitals` | LIVE | free | `url` or `origin`, `strategy`, `include` ('field', 'lab'); any URL incl. competitors |
| `seo_cro_audit` | LIVE | free | five-section audit of one URL, `quick_wins[]`; any public URL |
| `seo_entity_check` | LIVE | free | Knowledge Graph: `kg_id`, canonical name, types, `resultScore` |
| `on_page_instant_pages`, `on_page_content_parsing` | LIVE | E | one URL each; the second returns headings, links and text; `enable_javascript` for JS-rendered pages; needs includeDataForSEO |
| `seo_research` | LIVE | E / F / C | `instant-page` and `lighthouse` take `url`; `keyword-density` takes `target` = a `seo_audit_start` task_id (live-tested 2026-08-30); `serp` takes `keyword` |
| `seo_internal_links` | LIVE | A | Hiveku-hosted published projects only; Sunday static scan; orphans, depth, inbound counts; the suggested-link fields are not computed |
| `seo_featured_snippets`, `seo_serp_features` | LIVE | A | written only by AEO audit runs (`references/aeo.md`); empty means no audit yet |
| `seo_serp_get` | LIVE | A | stored SERP analysis rows, no writer today; a LIVE SERP is `seo_research({ action: 'serp' })` or `serp_organic_live_advanced` (C) |
| `serp_youtube_organic_live_advanced`, `serp_youtube_video_info_live_advanced`, `serp_youtube_video_subtitles_live_advanced`, `serp_youtube_video_comments_live_advanced` | LIVE | C | YouTube SERP and per-video teardown; needs includeDataForSEO; check each schema for the keyword, location and video id arguments |
| `fetch_url` | LIVE | free, every profile | raw HTML of any public URL; `data.url` is the landing URL after redirects, `data.body` capped at 200KB |
| `seo_deliverable_save`, `content_create`, `pm_tasks_create`, `pm_tasks_comment` | LIVE | write | persistence, section 11 |
| `seo_page_seo_get` | LIVE | A | merged DB-plus-file view of one page's SEO fields with validation scoring, `project_id` + `page_id`; `pages_get` plus `fetch_url` remains the raw cross-check |
| `seo_page_seo_set` | LIVE | write | `project_id`, `page_slug`, `meta_title`, `meta_description`, `keywords`, `canonical_url`, `og`, `twitter`; a versioned file write for filesystem-detected pages, live after `deploy_site`; the code lane still works |
| `seo_page_schema_get`, `seo_page_schema_set`, `seo_page_schema_delete` | LIVE | A / write | the page's `structured_data` block by `page_id`, validated for `@context` and `@type`, optional `sync_to_file`; delete is ask-gated; template JSON-LD stays a code-lane change |
| `seo_page_schema_generate` | LIVE | free | PROPOSAL ONLY, writes nothing: builds a deploy-parity JSON-LD `@graph` (WebSite, Organization - upgraded to LocalBusiness when GBP NAP is cached or business overrides are passed - WebPage, BreadcrumbList off the slug, Article on blog posts) with validation and a per-decision `rationale`; review the proposal, then apply it with `seo_page_schema_set` |

The six names above are owned here: elsewhere "the per-page SEO writer" and "the page schema
writer" point at this file's Availability table.

---

## 1. Ground truth: page vs template, and the four write paths

### 1.1 What each read returns

- **A pages-model page** is a `website_pages` row. `pages_list({ project_id })` lists the
  nav-tracked pages with ids; `pages_get({ project_id, page_id })` returns the fields in the
  Availability table. Read `file_path`: when it is set, a code file renders the page and the row's
  `meta_title` reaches the browser only if that file reads it. `content_structure` is the block
  tree, not the served HTML.
- **A template** is a file. `project_files_search({ project_id, query: '<title' })` or a query
  for `generateMetadata`, `metadata`, `canonical`, `application/ld+json` tells you which file
  emits the tag, with line numbers; `project_files_bulk_get({ project_id })` pulls the tree.
- **The served page** is `fetch_url({ url })`: `data.body` is the HTML the visitor gets, `data.url`
  the URL after redirects, `data.status` the code. This is the only read that settles "what is
  live". `web_scrape` with `formats: ['html']` is the alternative on keys that carry it.
- **The engine's copy** is `seo_gsc_inspect_url({ site_url, inspection_url })`: indexed snapshot,
  selected canonical, `lastCrawlTime`, detected rich results. It lags the live page by days.
- **The page's demand** is `seo_gsc_search_analytics` with a page filter, section 2 step 4.

### 1.2 The four write paths

| Situation | Write path | Visible to | Live when |
|---|---|---|---|
| Pages-model page, meta or sitemap fields | `pages_update({ project_id, page_id, meta_title, meta_description, ... })` | full, marketing, marketing-seo | on the next render of a page that reads the row; verify with `fetch_url`, and `deploy_site` if a Lambda tier is stale |
| CMS-driven content (blog, locations, products) | `cms_list_collections` -> `cms_read_entry({ project_id, collection_id, slug })` -> `cms_write_entry({ project_id, collection_id, slug, fields })` | full, marketing (not marketing-seo today) | the entry is a file in the project; whether the live tier picks it up without a deploy depends on the project, so the live URL is the arbiter |
| Template or code-level (title pattern, canonical, robots meta, JSON-LD, hreflang, image markup) | `project_files_bulk_save` in ONE call -> `verify_typecheck` -> `project_test_build({ project_id, use_db_state: true })` -> `project_vcs_commit({ project_id, message, files })` -> `deploy_site({ project_id, environment })` development first, production on approval | full, marketing (not marketing-seo today) | after the production deploy; commit is not live; `project_files_bulk_save` updates the Fly preview instantly for a `preview_screenshot` |
| Mechanical page-scoped fix on a Hiveku-hosted site (one title, one schema block, one canonical) | `seo_task_implement({ task_id })` preview -> `confirm: true` -> `seo_task_implement_status` -> human `agent_approval_approve` | full, marketing, marketing-seo (the rail is finishable on marketing-seo) | at `completed` with `deployment_url`; never before |

Choose by blast radius, then by profile. A pattern shared by 300 pages is a template change, one
review, one deploy; never 300 `pages_update` calls. On a marketing-seo key the code lane is not
visible: page fields go through `pages_update`, everything else through the implement rail or a
full-profile key, and you say which. Every path ends the same way: `fetch_url` on the live URL,
then `seo_gsc_inspect_url` only after `lastCrawlTime` passes the ship date.

### 1.3 External (non-Hiveku-hosted) sites

Every read above except `pages_*`, `cms_*`, `project_*` and `seo_internal_links` works on any
URL. No write does. Findings become one `pm_tasks_create` per page carrying the exact copy blocks,
the JSON-LD, and the verification call; their team ships; you verify with `fetch_url` after.

---

## 2. The per-page protocol

Twelve steps, one URL. Run them in order; each later step reads the earlier ones.

1. **Frame.** `account_context_get({ domain: 'seo' })` for protected pages and voice. Name the
   page's job (money, support, hub) and its target query from keyword-research.md. Collect ids:
   website project from `sites_list`, `page_id` from `pages_list`, the GSC `site_url` from
   `seo_connections_list`. Read `pages_get` and `fetch_url` and note every difference between the
   stored fields and the served tags: that gap is your first finding.
2. **SERP teardown.** `seo_serp_get({ keyword, location_code: 2840, device: 'mobile' })` first, a
   free stored read that may be empty because nothing writes it today; then the live SERP,
   `seo_research({ action: 'serp', keyword, location_code: 2840 })` or
   `serp_organic_live_advanced` (class C, one call), and `seo_serp_features({ keyword })` for the
   feature history. Record who holds positions 1 to 5, each result's content type (guide,
   category, service page, tool, video), and which features are present (AI Overview, PAA, video,
   local pack, shopping). All national brands in 1 to 5 means re-scope the query, not the page.
3. **Intent decision.** The page must be the same type as the majority of 1 to 5. A service page
   against five guides is a rewrite (content-strategy.md 1.2), not an on-page tune; stop here and
   say so.
4. **The page's real query set.** `seo_gsc_search_analytics({ site_url, start, end,
   dimensions: ['query'], filters: [{ dimension: 'page', operator: 'equals', expression: '<full
   canonical URL>' }], row_limit: 500 })` over 28 days ending 3 days ago (GSC lag, Pacific
   dates). Bucket: the head term; striking-distance queries at position 4 to 15 with impressions;
   question queries (answer-block material); off-intent queries that belong to another page. Never
   add these rows to a query-only pull: different signature, different totals.
5. **Title, H1, meta.** Section 3, written against steps 2 and 4.
6. **Entity and topic coverage.** `on_page_content_parsing({ url })` on each of the top 3 (class
   E, three calls) for their heading maps and text; diff their H2 sets against yours. Term
   frequency: `seo_research({ action: 'keyword-density', target: <task_id> })` needs a crawl from
   `seo_audit_start` (class F); without one, count terms in the parsed content yourself.
   `seo_entity_check({ query: '<brand>' })` for the brand's `kg_id` and canonical name, and once
   per topic entity you name on the page, so the copy uses the entity's canonical name.
7. **Answer blocks.** `seo_featured_snippets({ project_id })` rows for the keyword (empty until an
   AEO audit has run, aeo.md): `snippet_type`, `required_format`, `target_word_count`,
   `question_to_answer`. Paragraph snippets take a 40 to 60 word answer directly under an H2 that
   restates the question; list snippets 5 to 8 parallel items; table snippets a real table. The
   block sits at the top of its section, never in a summary.
8. **Internal links.** `seo_internal_links({ domain })` for the page's inbound count, click depth
   and orphan status (Hiveku-hosted only; the Sunday scan; suggestions are not computed). Donors:
   pages already ranking 4 to 15 for related queries, from a `['page','query']` pull or step 4 run
   per candidate. Plan 3 to 8 named donors with varied anchors and ship each through the donor's
   own write path. Never a footer block of 60 links.
9. **JSON-LD.** Section 4: pick the types the page can honestly claim, one graph, `@id` links.
10. **Images.** Section 5.
11. **Core Web Vitals at page level.** `seo_core_web_vitals({ url, strategy: 'mobile', include:
    'field' })` first (fast); a 404 on field data means thin traffic, so retry with `{ origin,
    include: 'field' }` and label the result site-level; then `include: 'lab'` for the ranked
    opportunities. Page-level fixes are the hero image (size, dimensions, not lazy-loaded above
    the fold) and embeds; anything template-wide goes to technical-seo.md Play T3.
12. **CTA and ship.** `seo_cro_audit({ url })` for the five scores and `quick_wins[]`; fold the
    clarity and cta findings into the rewrite. Then the pre-flight card from
    seo-change-discipline.md section 7, the right write path from 1.2, `fetch_url` on the live URL
    for every changed element, and `seo_gsc_inspect_url` only after `lastCrawlTime` passes the ship
    date. Measure at 28 days with `seo_gsc_time_series` and the same page filter.

---

## 3. Title, meta and H1 rules

**Title.** 50 to 60 characters and roughly 600 pixels (industry benchmark; Google truncates by
width, not count). Primary term front-loaded in the first 30 characters; one modifier the SERP
rewards (city, year, "cost", "vs"); brand suffix after a separator unless the brand is the query.
Unique site-wide: the crawl's duplicate-title issue is a template problem wearing a page-count
costume, fix the pattern. Google rewrites titles it considers poor, so a title that does not match
the H1 and the page's real queries is rewritten for you, badly.

**Meta description.** 150 to 160 characters, unique, one claim the page proves and one CTA verb.
Not a ranking factor, a CTR factor; Google replaces it when it does not match the query, which is
why it should quote the head term and a striking-distance phrase from step 4.

**H1.** Exactly one, the promise of the page in the visitor's words, containing the head term
naturally. Not the title repeated verbatim: the title sells the click, the H1 confirms the
arrival.

**H2 map.** One H2 per intent sub-question, in the order the top 3 answer them, plus the ones
they miss that step 4 shows people ask. Each H2 that maps to a question gets its answer block
(step 7) first, elaboration second.

**Focus keywords.** `focus_keywords` and `meta_keywords` on `pages_update` are Hiveku fields for
tracking and internal search, not signals Google reads; fill `focus_keywords` with the head term
and two striking-distance queries so the next session sees the intent, and never stuff
`meta_keywords`.

**The rewrite template.** One block per element, in the PM task before the write:

```
ELEMENT:  title | meta | H1 | H2 map
CURRENT:  <served value from fetch_url> (stored value from pages_get if different)
PROPOSED: <exact string> (<n> chars)
WHY:      <SERP evidence from step 2, query evidence from step 4, the rule it satisfies>
```

---

## 4. JSON-LD templates

Eligibility below is Google's documented rich-result policy as of 2025; re-check Google's
structured data gallery before promising a client a rich result. Every type: markup describes what
is visible on the page, never adds claims to it. Placement rules follow the templates.

### Organization (home page and about page)

```json
{ "@type": "Organization", "@id": "https://example.com/#org", "name": "Acme Roofing",
  "url": "https://example.com/", "logo": "https://example.com/logo.png",
  "sameAs": ["https://www.facebook.com/acme", "https://www.linkedin.com/company/acme"],
  "identifier": { "@type": "PropertyValue", "propertyID": "kg_id", "value": "<kg_id from seo_entity_check>" } }
```

Required: `name`, `url`. Recommended: `logo`, `sameAs` (the official profile URLs that
`seo_entity_check` and `web_search` confirm), `contactPoint`. Carrying the `kg_id` as an
`identifier` is a convention, not a Google requirement. Self-serving `aggregateRating` or `review`
on Organization is ineligible for review snippets.

### LocalBusiness (each location page)

```json
{ "@type": "LocalBusiness", "@id": "https://example.com/locations/dallas#business",
  "name": "<title from seo_gbp_location>", "telephone": "<primaryPhone from seo_gbp_location>",
  "address": { "@type": "PostalAddress", "streetAddress": "", "addressLocality": "", "addressRegion": "", "postalCode": "", "addressCountry": "US" },
  "openingHoursSpecification": [ { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday"], "opens": "08:00", "closes": "17:00" } ],
  "geo": { "@type": "GeoCoordinates", "latitude": 0, "longitude": 0 },
  "url": "https://example.com/locations/dallas", "parentOrganization": { "@id": "https://example.com/#org" } }
```

Required: `name`, `address`. Recommended: `telephone`, `openingHoursSpecification`, `geo`,
`image`, `priceRange`. NAP character for character equal to the GBP listing, read from one
`seo_gbp_location({ connection_id })` call, never retyped. Use the specific subtype
(`RoofingContractor`, `Dentist`) when one exists. Self-serving reviews ineligible, as above.

### Service (no rich result)

```json
{ "@type": "Service", "serviceType": "Roof repair", "provider": { "@id": "https://example.com/#org" },
  "areaServed": { "@type": "City", "name": "Dallas" }, "url": "https://example.com/services/roof-repair" }
```

Entity value only: it names what the business does for the Knowledge Graph and answer engines.
Never sell it as a rich result. `hasOfferCatalog` when the page lists priced options.

### Article (posts and guides)

```json
{ "@type": "Article", "headline": "<H1>", "datePublished": "2026-03-04", "dateModified": "2026-08-30",
  "author": { "@type": "Person", "name": "", "url": "https://example.com/authors/jane", "sameAs": [] },
  "publisher": { "@id": "https://example.com/#org" }, "image": ["https://example.com/img/hero.jpg"],
  "mainEntityOfPage": { "@id": "https://example.com/blog/post#webpage" } }
```

Required: `headline`, `image`, `datePublished`, `author`. Recommended: `dateModified` (truthful,
it is what E-E-A-T scoring and freshness read), `author.url`, `publisher`. A credentialed
`Person` author with a profile URL moves three E-E-A-T signals at once (content-strategy.md
Play C6). `BlogPosting` and `NewsArticle` are the subtypes.

### BreadcrumbList (every page deeper than one level)

```json
{ "@type": "BreadcrumbList", "itemListElement": [
  { "@type": "ListItem", "position": 1, "name": "Services", "item": "https://example.com/services/" },
  { "@type": "ListItem", "position": 2, "name": "Roof repair", "item": "https://example.com/services/roof-repair" } ] }
```

Required: `itemListElement` with `position`, `name`, `item` (omit `item` on the last element or
give it the page URL). It must mirror the visible breadcrumb. A template job, once.

### Product (ecommerce; needs Offer)

```json
{ "@type": "Product", "name": "", "image": [], "description": "", "sku": "", "brand": { "@type": "Brand", "name": "" },
  "offers": { "@type": "Offer", "price": "129.00", "priceCurrency": "USD", "availability": "https://schema.org/InStock", "url": "" },
  "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.6", "reviewCount": "112" } }
```

Required for the merchant listing and product snippet: `name`, `image`, and an `offers` block with
`price`, `priceCurrency`, `availability`. `aggregateRating` and `review` only from real collected
reviews on that product; invented ratings are a policy violation. Keep it consistent with Merchant
Center (`references/ecommerce-seo.md`).

### FAQPage (restricted)

```json
{ "@type": "FAQPage", "mainEntity": [ { "@type": "Question", "name": "How much does roof repair cost?",
  "acceptedAnswer": { "@type": "Answer", "text": "<the 40 to 60 word answer visible on the page>" } } ] }
```

Since August 2023 FAQ rich results show only for well-known authoritative government and health
sites. Everyone else gets entity and answer-engine value, which is real, and no rich result. Mark
up only questions and answers that are visible on the page in that form.

### HowTo (retired)

HowTo rich results were retired in September 2023. The markup still describes the steps for
answer engines; add it only when the page is genuinely a procedure with visible steps, and never
list it as a rich-result win.

### VideoObject (pages with an embedded or hosted video)

```json
{ "@type": "VideoObject", "name": "", "description": "", "thumbnailUrl": ["https://example.com/img/thumb.jpg"],
  "uploadDate": "2026-08-01", "duration": "PT4M12S", "contentUrl": "", "embedUrl": "https://www.youtube.com/embed/<id>",
  "hasPart": [ { "@type": "Clip", "name": "Inspect the flashing", "startOffset": 30, "endOffset": 95, "url": "https://example.com/guide#t=30" } ] }
```

Required: `name`, `thumbnailUrl`, `uploadDate`. Recommended: `description`, `duration`,
`contentUrl` or `embedUrl`, and `hasPart` Clips (key moments) or a `SeekToAction`. The video must
be visible on the page. Section 7.

### Validation and placement

- One `@graph` per page holding every node, `@context` `https://schema.org`, and `@id`
  cross-references: the page's `WebPage` node names `isPartOf` the `WebSite`, the `Article`
  names `publisher` the `Organization`, the `LocalBusiness` names `parentOrganization`. Two
  competing blocks for the same type is the most common self-inflicted error.
- Server-rendered in the `<head>` or top of `<body>`. JSON-LD injected by JavaScript after render
  is the first thing to suspect when `seo_gsc_inspect_url` detects nothing (technical-seo.md
  section 5).
- Validate before shipping by parsing the block yourself from `fetch_url` output (a syntax error
  invalidates the whole block silently); after recrawl, read the rich-result detection in
  `seo_gsc_inspect_url`. Google's Rich Results Test is UI-only: hand the URL to the user.
- Ship template blocks through the code lane, page blocks through the page schema writer once it
  lands (Availability), and never through `seo_schema_markup`, which only reads.

---

## 5. Image SEO

- **Alt text formula:** what the image shows, in the words a visitor would use, with the page's
  subject only where it is naturally true. "Crew replacing shingles on a Dallas roof", not "roof
  repair Dallas roof repair". Decorative images get an empty `alt=""`; an image that is the
  content (a chart, a diagram) gets the takeaway. The crawl's missing-alt issue and
  `seo_cro_audit`'s clarity section (alt coverage) are the same finding.
- **Filenames:** descriptive, hyphenated, lowercase, before upload: `roof-repair-dallas-crew.webp`.
  Renaming after publication changes the URL; keep the old name or redirect it.
- **Dimensions:** explicit `width` and `height` (or CSS aspect-ratio) on every image so the layout
  reserves space; unsized images are the usual CLS cause.
- **Formats and weight:** WebP or AVIF with a JPEG fallback for photos; SVG for logos and icons;
  the hero preloaded and never lazy-loaded above the fold; everything below the fold lazy-loaded.
  The lab run in `seo_core_web_vitals` ranks the specific savings.
- **Context:** a caption where a human would want one, the image near the text it supports,
  and `ImageObject` inside the graph only when the image is the page's subject.
- **Measure:** `seo_gsc_search_queries({ site_url, search_type: 'image' })` shows whether image
  search sends anything; product and how-to pages usually earn it, service pages rarely do.

---

## 6. Hreflang manual recipe

No hreflang builder exists in this surface. Two ways to declare alternates, both hand-built.

**Option A, in the template head (code lane).** Keep one locale map in the project (which URL is
which language-region) and emit, on every page in the set, one line per alternate including the
page itself and an `x-default`:

```html
<link rel="alternate" hreflang="en-us" href="https://example.com/en-us/services/" />
<link rel="alternate" hreflang="en-gb" href="https://example.com/en-gb/services/" />
<link rel="alternate" hreflang="x-default" href="https://example.com/services/" />
```

Ship with `project_files_bulk_save` -> `project_vcs_commit` -> `deploy_site`.

**Option B, in the sitemap.** `xhtml:link rel="alternate"` elements under each `<url>`.
`seo_generate_sitemap` emits `loc`, `lastmod`, `changefreq` and `priority` only (verified by route
read), so a sitemap with alternates is hand-maintained in `public/sitemap.xml` through the code
lane, and a later regeneration overwrites it. Pick A unless the page count makes head tags
impractical.

**Rules that decide whether it works.** Every page in a set lists every other page and itself
(return links; a one-way declaration is ignored). Codes are ISO 639-1 language plus optional ISO
3166-1 alpha-2 region: `en-gb`, never `en-uk`; `es` alone for all Spanish. `x-default` names the
fallback for unmatched visitors. Absolute URLs, each self-canonical; never point hreflang at a
noindexed or redirected URL, and never hreflang to an untranslated page. Parameter locales
(`?lang=`) are fragile; prefer paths or subdomains.

**Verify.** `fetch_url` on each locale URL and count the `hreflang` link elements in `data.body`;
they must match across the set. `seo_gsc_inspect_url` does not report hreflang; the Search
Console international report is UI-only, so ask the user to check it after recrawl.

**Edge cases.** One language across many regions still needs one line per region plus the bare
language. A partially translated site declares alternates only for pages that exist in both. A
CMS locale field that renders the wrong region code is a template bug, not a content bug.

---

## 7. Video and YouTube SEO

- **What ranks in video.** `serp_youtube_organic_live_advanced` for the keyword shows the YouTube
  SERP: titles, channels, view counts, lengths (class C). The Google SERP from step 2 tells you
  whether a video carousel is present at all; without one, video is support, not the play.
- **Competitor video teardown.** `serp_youtube_video_info_live_advanced` (metadata, chapters,
  stats), `serp_youtube_video_subtitles_live_advanced` (the transcript, which is the outline
  the video actually covers) and `serp_youtube_video_comments_live_advanced` (the questions
  viewers still had, answer-block material) on the top 2 videos: metered, one call per video per
  tool, check each schema for the video id argument.
- **Your own video demand.** `seo_gsc_search_queries({ site_url, search_type: 'video' })` shows
  the queries where Google already surfaces the site in video mode.
- **On the page.** The video embedded above the fold or under the H2 it answers, with a visible
  transcript or the answer in text beside it (the text ranks; the video earns the thumbnail).
  `VideoObject` JSON-LD from section 4 with `hasPart` Clips whose `startOffset` and `name` match
  the visible chapters, or a `SeekToAction` for auto key moments.
- **On YouTube.** Head term in the first 60 characters of the title, the answer in the first two
  lines of the description, timestamped chapters (these become key moments), a link to the page,
  and the same thumbnail used on the page.

---

## 8. Thresholds and benchmarks

All industry benchmarks unless a tool is named; state them as such in reports.

| Signal | Benchmark | Source |
|---|---|---|
| Title length | 50 to 60 chars, about 600 px | industry |
| Meta description | 150 to 160 chars | industry |
| H1 per page | exactly 1 | crawl issue |
| Paragraph snippet | 40 to 60 words under an H2 | `seo_featured_snippets` format |
| List snippet | 5 to 8 items | same |
| LCP p75 mobile | Good at or under 2.5 s | `seo_core_web_vitals` field |
| INP p75 mobile | Good at or under 200 ms | same |
| CLS p75 mobile | Good at or under 0.1 | same |
| Striking distance | position 4 to 15 with impressions | `seo_gsc_search_analytics` |
| Internal links to a money page | at least 10 from related pages | `seo_internal_links` |
| Click depth, money page | 3 or fewer | same |
| Alt coverage on content images | 100 percent | crawl issue, `seo_cro_audit` |
| Hero image weight | under about 200 KB, sized, preloaded | industry |
| Word count | whatever the top 3 do, from `on_page_content_parsing`; never a fixed number | SERP-derived |
| Time to signal | title and meta 1 to 4 weeks after recrawl; CWV field 28 days; content 3 to 6 months | industry |

---

## 9. Diagnosis: when the data looks wrong

- **The page filter returns nothing.** `site_url` must be the exact property string; `expression`
  must be the exact canonical URL including trailing slash and scheme (or use `contains` with the
  path); the window must end 3 or more days ago. Then check the URL is indexed at all with
  `seo_gsc_inspect_url`.
- **`seo_serp_get` is empty.** Expected: no writer today. Use the live SERP call.
- **`seo_featured_snippets` or `seo_serp_features` is empty.** No AEO audit has run for this
  domain (aeo.md). Not "no opportunities".
- **`seo_internal_links` is empty with a note.** The project is not Hiveku-hosted or not published;
  dynamic links are invisible to the static scan. Never read empty as no issues.
- **`seo_core_web_vitals` field data 404s.** Thin traffic on the exact URL; retry with `origin`
  and label it site-level.
- **`pages_update` returned 200 and the live title did not change.** In order: the page has a
  `file_path` and the template hardcodes the title (search it); a Lambda tier has not been
  deployed since; an edge cache (compare `fetch_url` twice a minute apart); the field you changed
  is not the one the template reads.
- **Google shows a different title than the page.** Google rewrites titles; `fetch_url` proves the
  page is right; check the H1 and the queries agree with the title, then wait for the recrawl.
- **`seo_gsc_inspect_url` shows the old values.** It is the indexed snapshot; compare
  `lastCrawlTime` with the ship date.
- **`keyword-density` errors.** It needs `target` = a task_id from `seo_audit_start`; the handler
  is live-tested (2026-08-30); when it errors, record the error and take the count from
  `on_page_content_parsing` instead.
- **`on_page_content_parsing` returns almost no text.** A JS-rendered page: retry with
  `enable_javascript`, or the site blocks the crawler (compare with `fetch_url`).
- **`fetch_url` shows `truncated: true`.** The 200KB cap; the head and the title are at the top
  and survive, deep body checks may not.
- **Schema present in the file, not detected.** Injected after render, a syntax error, or no
  recrawl yet: parse the block from `fetch_url`, then wait.

---

## 10. Edge cases and failure modes

- **Pages model versus code project.** A row without `file_path` renders from the builder and
  honors `pages_update`; a row with one is code, and the file decides. When unsure, change the
  row, `fetch_url`, and believe the HTML.
- **Scoped key.** On marketing-seo, `pages_update` and the implement rail are your only writes;
  say "the template change needs a full-profile key or the implement rail", never "Hiveku cannot".
- **Competitor page audit.** `seo_cro_audit`, `seo_core_web_vitals`, `on_page_instant_pages`,
  `on_page_content_parsing` and `fetch_url` all work on any URL; nothing here writes to one, and
  a competitor's markup is evidence, not a template to copy.
- **External site.** Section 1.3: tasks with exact blocks, no writes, verify after their deploy.
- **Protected pages.** Pricing, legal, checkout and anything `account_context_get` marks protected
  get no edits without itemized approval, however mechanical the fix.
- **A stable top-3 page.** Do not retitle it because a rule says the title is 64 characters.
  Optimization programs lose more from over-tuned winners than they gain from mild fixes.
- **One page, one intent.** A second page for the same query manufactures cannibalization
  (content-strategy.md Play C3); expand the existing page instead.
- **Slug changes.** `pages_update({ slug })` changes the URL with no redirect; the 301 through
  `project_redirect_create` is part of the same change or the change does not happen.
- **Markup that claims what the page does not show.** Ratings without reviews, FAQs not on the
  page, an author who did not write it: a manual action risk that outlives the fix.

---

## 11. Persistence and reporting

- **The brief.** `seo_deliverable_save({ title, slug: 'onpage-<slug>-<yyyy-mm>',
  deliverable_type: 'content_brief', status: 'draft', target_domain, target_keywords, content,
  recommendations })` with the SERP teardown, the query buckets, the rewrite blocks and the
  JSON-LD in `content`; or `content_create` for copy that will be edited, after
  `account_context_get` so the voice applies. `talk_to_department({ domain: 'seo', message })`
  drafts the copy; its numbers are never evidence.
- **The work.** One `pm_tasks_create({ project_id, title, description, task_type: 'seo',
  priority })` per page, flat (never `parent_task_id`), the absolute URL as the first line of the
  description, the rewrite blocks and the verification call in the body. The pre-flight card and
  the write response go into `pm_tasks_comment`; `pm_tasks_complete` only with the live URL, the
  ship date and the `fetch_url` proof.
- **Memory.** `memory_list({ domain: 'seo', include_project_scoped: true })`, then
  `memory_update` with the merged document (it replaces): the title pattern per template, the
  schema policy (which types on which templates, the Organization `@id`), the hreflang map,
  protected pages, and the pages deliberately left alone.
- **The report.** One line per page in the client's language: what changed, when, the query it
  targets, and the date the number becomes readable; the 28-day `seo_gsc_time_series` page filter
  is the after. Assemble through `references/reporting-and-delivery.md`.
