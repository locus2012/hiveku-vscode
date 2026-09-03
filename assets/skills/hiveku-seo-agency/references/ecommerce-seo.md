# Ecommerce SEO - Shopify and other stores

## What this covers / when to load this

SEO for a store: category (collection) pages as the ranking unit, faceted navigation and the
canonical policy that keeps it from indexing ten thousand filter URLs, Product and Offer and
BreadcrumbList schema kept consistent with the Merchant Center feed, what happens to a
product URL when the product sells out or is discontinued, pagination, revenue attribution
from GA4, and the weekly store SEO check. Load it when the client sells online, when a
Shopify (or WooCommerce, BigCommerce) store is the site, or when "the store's organic
revenue is down" is the ask.

It does not cover catalog writes (titles, descriptions, collections, metafields, tags), which
belong to `hiveku-commerce-agency/references/shopify-catalog-writes.md` and its write gate;
the weekly inventory, orders and dead-stock check (`/hiveku:store`); building a Hiveku
headless storefront (`hiveku-commerce-agency/references/storefront-scaffold.md`); or the
per-page on-page protocol and the JSON-LD templates (`on-page-optimization.md`, section 4
for the Product, Offer and BreadcrumbList templates). Keyword expansion for category terms
is `keyword-research.md` with the tool rows in `metered-research-suite.md`.

## Availability

| Tool | Status | Cost | Note |
|---|---|---|---|
| `seo_research({ action: 'google-shopping-products' })` | LIVE | C-like per request | `query`, `location_code`; the Shopping SERP for a head term |
| `seo_research({ action: 'amazon-products' })` | LIVE | per request | `query`; amazon.com fixed; the marketplace competitor read |
| `seo_research({ action: 'amazon-reviews' })` | LIVE | per request | `target` = ASIN; language mining for product copy |
| `seo_gsc_search_queries` | LIVE | A | `site_url`, `start`, `end`, `row_limit`, `search_type` (web, image, video, discover, googleNews); image search is a real ecommerce channel |
| `seo_gsc_search_analytics` | LIVE | A | page filter `contains /collections/` or `/products/`; the split between category and product traffic |
| `seo_gsc_top_pages` | LIVE | A | top landing pages |
| `seo_gsc_index_coverage` | LIVE | A | 50 URLs per call; sample the facet and pagination URLs |
| `seo_gsc_inspect_url` | LIVE | A | canonical Google chose, rich-result state per URL |
| `seo_gsc_period_comparison` | LIVE | A | the weekly and monthly delta |
| `seo_core_web_vitals` | LIVE | A | `url` or `origin`, `strategy`, `include`; any URL including a rival store |
| `seo_ga4_report` | LIVE | A (GA4 quota) | preset `ecommerce_revenue`; organic filter and `itemName` override (see `outcomes-and-measurement.md`) |
| `seo_cannibalization`, `seo_content_decay` | LIVE | A | Sunday sweeps from the GSC archive |
| `on_page_instant_pages` | LIVE | E | a rendered check of a template URL, ours or a rival's |
| `backlinks_backlinks` | LIVE | D | which product URLs have links before you retire one |
| `pm_tasks_create`, `memory_create`, `memory_update` | LIVE | A | every finding becomes a ticket |
| Commerce reads by pointer: `shopify_status`, `shopify_catalog_list`, `shopify_inventory_get`, `shopify_collection_list`, `shopify_product_get`, `shopify_page_list`, `shopify_theme_file_get` | LIVE | A | connection and catalog truth; traps in the commerce skill |
| Commerce writes by pointer: `shopify_product_update`, `shopify_collection_update`, `shopify_page_update`, `shopify_metafields_set`, `shopify_theme_file_upsert` | LIVE | A | the commerce skill's writes under its gate; from here every change is a ticket |

Not available: a Merchant Center feed reader, a Shopify redirect tool, a robots.txt editor
for a Shopify store, an hreflang builder, a disavow tool. Each of those is a client task.

## Ground truth

- **Shopify is not Hiveku-hosted.** No `pages_*` writes, no code lane
  (`project_files_bulk_save`, `project_vcs_commit`, `deploy_site`), no
  `project_redirect_create`, no `seo_generate_sitemap`, no `seo_task_implement`. Findings
  become the client's Shopify admin tasks through `pm_tasks_create`, each with the exact
  before and after. The one exception is a Hiveku headless storefront built with the
  storefront scaffold: that site IS Hiveku-hosted and the web lane applies to it.
- **robots.txt and sitemap.xml are Shopify-managed.** Shopify serves both; the merchant can
  override robots through a `robots.txt.liquid` theme template (a ticket, never a tool
  call from here), and the sitemap regenerates itself from published products,
  collections, pages and articles. `seo_project_update({ robots_txt_content })` has
  nothing to do with a Shopify store.
- **Shopify's URL shapes and what they mean for canonicals.** `/products/<handle>` is the
  product; `/collections/<handle>/products/<handle>` is the same product reached through a
  collection and canonicalizes to the bare product URL in standard themes; `?variant=` is
  a variant view that canonicalizes to the product; `/collections/<handle>/<tag>` is a tag
  facet with its own URL; `/collections/all` and `/collections/vendors?q=` exist whether
  or not the merchant uses them; `?page=N` is pagination; `/search?q=` is internal
  search. A theme or an app can change any of this, so read the live template with
  `on_page_instant_pages` before assuming.
- **Product SEO fields are not reliably readable through the catalog tools** (the store
  command lists description, SEO fields, channel and collection membership as not
  readable); read the live URL with `web_scrape` or `on_page_instant_pages`.
- **Handle changes move URLs.** Shopify leaves a redirect only when the merchant ticks the
  option (the catalog-writes reference documents `redirect_new_handle` on the update
  tools). A retitled product with a changed handle and no redirect is a 404 with links.
- **GA4 ecommerce is a separate ledger.** `seo_ga4_report` purchase revenue is
  order-scoped in the property's timezone; Shopify orders through `shopify_admin` are the
  store's ledger; GSC is clicks. Report them side by side, never summed, and expect them to
  disagree.

## Decision frameworks

**The ranking unit is the collection, not the product.** Head and mid terms ("women's
trail running shoes") belong to a collection; a product page wins the long tail (brand +
model) and the branded query. A store that puts head-term copy on product pages
cannibalizes itself against its own collections.

**Which facets get indexed.** A facet URL earns indexation only when all three hold: it has
its own search demand (a keyword row with volume in the metered suite), it has enough
inventory to be a real category (five or more products in stock), and its intent is
distinct from the parent. Everything else canonicalizes to the parent collection. Never
both canonical and noindex on the same URL (`technical-seo.md` rule).

**Canonical policy tree for a filter or sort URL:** demand plus inventory plus distinct
intent = its own indexable URL with unique copy; demand without inventory = canonical to
parent and a note to revisit; no demand = canonical to parent; sort and price-range
parameters = canonical to parent always; internal search = noindex.

**Out-of-stock and discontinued:** temporary (restock expected) = keep the URL live, 200,
indexable, Offer availability set to out of stock, restock date if known, related products
shown; permanent with a successor = 301 to the successor product; permanent with no
successor = 301 to the parent collection; permanent, no links, no clicks in 12 months,
no successor = 410 is acceptable. Never 404 a URL that has backlinks or organic clicks.

## The plays

### E1. Category-page keyword mapping

1. `shopify_collection_list` (through the commerce pointer; `project_id` from `sites_list`
   where visible) for the collections that exist; `seo_gsc_search_analytics` with
   dimensions `['page', 'query']` and a `page contains /collections/` filter for what each
   already earns.
2. The head-term universe for the catalog from `keyword-research.md` Play 1, seeded from
   collection titles and the customer's words in the avatars.
3. Map one head term and its cluster to one collection. A collection with two heads is two
   collections; two collections with one head is a merge (a ticket, with the redirect
   named).
4. Gaps: clusters with demand and no collection become proposed collections, each a ticket
   with the products that would populate it (inventory check via `shopify_catalog_list`).
5. `seo_cannibalization` weekly to catch a product page and its collection competing for
   the same query.

**Closes the loop:** a dated tab `"2026-08 Collection keyword map"`, one
`pm_tasks_create` per collection change, `memory_create` the map.

### E2. Faceted navigation and the canonical policy

1. Inventory the facet URL patterns on the live site: `web_map({ url })` for what exists,
   `seo_gsc_search_analytics` with `page contains ?` and `page contains /collections/`
   filters for what Google has already found.
2. `seo_gsc_index_coverage` on a 50-URL sample of facet, tag, sort and pagination URLs;
   read `coverage_state`. "Duplicate without user-selected canonical" and "Crawled -
   currently not indexed" across the sample is the crawl-budget leak.
3. `seo_gsc_inspect_url` on three representatives to read `user_canonical` versus
   `google_canonical`.
4. Apply the canonical tree per pattern, not per URL. Write the policy as a table: pattern,
   decision, mechanism (theme canonical, noindex meta, robots disallow for internal
   search only after the drop), owner.
5. Every mechanism is a theme change in Shopify: a ticket with the exact Liquid target and
   the before and after. Verify after the client ships with `seo_gsc_inspect_url` (only
   after a recrawl) and a fresh `seo_gsc_index_coverage` sample.

### E3. Schema and Merchant Center consistency

1. Read the live product and collection templates with `on_page_instant_pages` for the
   JSON-LD present; `seo_gsc_inspect_url` for rich-result eligibility as Google sees it.
2. Product needs Offer (price, currency, availability, URL) to be eligible; BreadcrumbList
   carries the collection path; Organization on the home page. Templates and 2025
   eligibility rules are in `on-page-optimization.md` section 4. No FAQPage on product
   pages for the rich result (restricted), no HowTo (retired).
3. Consistency is the finding that costs money: price and availability in the schema must
   match the Merchant Center feed and the visible page, or Shopping listings get
   disapproved. No tool reads the feed; the check is the visible page versus the schema
   versus what the client exports from Merchant Center, in a ticket.
4. Variants: one Product with the selected variant's Offer, or ProductGroup where the theme
   supports it; never one Product per variant URL, since those canonicalize away.

### E4. Out-of-stock and discontinued URL policy

1. Weekly, from `shopify_inventory_get` over the top-selling handles in memory and
   `shopify_catalog_list` for status: which products are at zero inventory or archived.
2. Cross with `seo_gsc_top_pages` (clicks) and `backlinks_backlinks` filtered to the
   product URL (links). A product with either is protected: never 404.
3. Apply the decision tree from the frameworks section. Redirects are created in Shopify
   admin (Navigation, URL redirects): a ticket per URL with source, destination and reason.
4. Temporary stockouts keep the page live with availability marked out of stock in the
   Offer; the theme's stock messaging is a ticket if it hides the page or noindexes it.
5. Verify the ticket after the client ships: `fetch_url` the old URL (status and
   `data.url` for the destination), `seo_gsc_inspect_url` after recrawl.

### E5. Pagination

1. `?page=N` pages self-canonicalize; never canonicalize them to page one (removes the
   deep products from the index, `technical-seo.md`). No noindex on page 2+ either.
2. Page 1 links to page 2; the last page is reachable within a few clicks; products per
   page high enough that the deep pages are few.
3. Infinite scroll with no paginated URL orphans every product past the first screen:
   compare `on_page_instant_pages` with and without JavaScript; a ticket if they differ.

### E6. Revenue attribution through GA4

1. `seo_ga4_report({ connection_id, preset: 'ecommerce_revenue', dimensions: ['date', 'sessionDefaultChannelGroup'], dimension_filter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Organic Search' } } } })`
   for organic purchase revenue and transactions by day. The filtered dimension is added
   to `dimensions` because Google's Data API honors a filter only on a requested
   dimension.
2. Revenue by product: the same call with `dimensions: ['itemName', 'sessionDefaultChannelGroup']`
   and `metrics: ['itemRevenue', 'itemsPurchased']` (purchaseRevenue is order-scoped).
3. Landing pages that convert: preset `landing_pages` with the organic filter and
   `sessionDefaultChannelGroup` added to `dimensions`.
4. Read the warnings (thresholding, sampling, `(other)`); zero rows means the property
   never sent purchase events, a setup finding, not zero revenue. 429 is the hourly quota.
5. Side by side with Shopify's order count and GSC clicks for the same window; three
   ledgers, never one total.

### E7. The weekly store SEO check

Ten calls. `/hiveku:store` covers inventory, orders and dead stock; this list is the SEO
layer beside it.

1. `seo_gsc_period_comparison` 7-vs-7 on the same weekdays, non-brand, split
   `/collections/` versus `/products/`.
2. `seo_gsc_search_queries` with `search_type: 'image'` once a month: image traffic is real
   for stores and invisible in the default web report.
3. `seo_gsc_index_coverage` on the 50 newest product URLs from `shopify_catalog_list`
   (most recently updated first): new products not indexed within two weeks is a sitemap
   or internal-linking finding.
4. `seo_core_web_vitals({ url })` on one collection template URL and one product template
   URL, mobile, field data; `origin` if the URL 404s for thin traffic.
5. The stockout cross (E4) on the top twenty organic landing pages.
6. `seo_cannibalization` and `seo_content_decay` reads for store URLs.
7. `seo_research({ action: 'google-shopping-products', query })` on three head terms once
   a month: who holds the Shopping carousel, and whether the client's listings show at
   all (a feed finding if not).
8. Tickets for everything, in the client's Shopify vocabulary.

## Thresholds and benchmarks

| Item | Value | Label |
|---|---|---|
| Core Web Vitals good | LCP 2.5s, INP 200ms, CLS 0.1 at p75 | Google's thresholds |
| new product indexed within | 14 days of publish | house rule |
| indexable facet | demand row with volume, 5+ in-stock products, distinct intent | house rule |
| protected URL (never 404) | any backlink, or any organic click in 12 months | house rule |
| duplicate-canonical share in a facet sample | over 20 percent of the 50-URL sample | house threshold for the E2 ticket |
| products with zero impressions in 90 days | over 30 percent of active catalog | house threshold: a collection-linking or thin-content finding |
| schema errors on templates | zero; one template error is every product | standard practice |
| Shopping carousel on head terms | client absent on 2 of 3 = feed ticket | house rule |
| ecommerce CVR benchmark when GA4 is empty | 1.5-3 percent transactional | `keyword-research.md` Play 6, benchmark only |

## Diagnosis: when the data looks wrong

| Symptom | Cause, in check order | Action |
|---|---|---|
| collection traffic fell after an app install | a filtering or search app rewrote facet URLs or canonicals; a theme update dropped the canonical tag | `seo_gsc_inspect_url` a collection URL; compare `user_canonical` to `google_canonical`; ticket the app setting |
| products indexed at `/collections/x/products/y` | theme canonical missing or pointing at the collection path | template ticket; the bare product URL is canonical |
| "Duplicate without user-selected canonical" spike | facet or `?variant=` URLs without a canonical | E2 policy |
| `seo_ga4_report` ecommerce preset returns zero rows | the property never received purchase events; the tracking is the finding | `outcomes-and-measurement.md` conversion audit; never report zero revenue |
| GA4 organic revenue far from Shopify order value | timezone, refunds, currency, consent, cross-device | expected divergence; three ledgers |
| product page outranks its collection for a head term | product copy carries the head term; collection is thin | move head-term copy to the collection, link the product to it, `seo_cannibalization` next week |
| CWV field data 404s for a product URL | thin traffic on that exact URL | `origin` for the site, or the collection template URL |

## Edge cases and failure modes

- **Headless Hiveku storefront.** The site is Hiveku-hosted: pages, code lane, redirects,
  sitemap, robots and the implement rail all apply, and `invalidate_cache` with its required
  tags follows a catalog change (`hiveku-commerce-agency/references/shopify-connection.md`).
  Everything else in this file still holds.
- **Markets and multi-currency.** hreflang has no builder anywhere; the recipe is manual
  (`on-page-optimization.md`) and on Shopify it is a theme ticket. Currency in the Offer
  must match the market the page is served in.
- **The client is not on Shopify.** WooCommerce (self-hosted: robots and redirects are
  editable by the client, the URL shapes differ, `?filter_` parameters), BigCommerce,
  Magento: the frameworks hold, the URL patterns and the ticket vocabulary change. Read
  the live templates first.
- **Plan-gated Shopify features.** Some collection and theme actions fail on Starter and
  Retail plans (the catalog-writes reference names them).
- **B2B stores with hidden prices.** No Offer price means no Product rich result; say so
  instead of forcing a placeholder price into the schema.
- **Never noindex a collection to "fix" cannibalization.** Merge or re-map; noindex kills
  the head term's only eligible page.
- **Never bulk-redirect or bulk-canonicalize off an audit list.** Per pattern, reviewed,
  with the protected-URL check on every retired product URL.
- **Refuse "delete the out-of-stock products from the site".** Apply the decision tree; the
  ones with links and clicks stay.

## Persistence and reporting

- Dated tabs, replace-by-name: `"2026-08 Collection keyword map"`,
  `"2026-08-30 Facet policy"`, `"2026-08-30 Stockout URL review"` via
  `seo_sheet_create_tab` then `seo_sheet_add_rows`.
- `pm_tasks_create` per ticket in Shopify admin vocabulary (the collection handle, the
  template file, the redirect source and destination, the exact before and after);
  `pm_tasks_complete` only after the live verification (`fetch_url`,
  `seo_gsc_inspect_url` after recrawl).
- `memory_create` for the standing policies: the facet indexation table, the canonical
  policy, the out-of-stock rules, the protected-URL list source, the top-selling handles
  used in the weekly check. `memory_update` resends the whole note.
- Report: organic revenue and transactions from GA4 (property timezone, window,
  thresholding disclosed), collection versus product organic clicks from GSC, share of new
  products indexed within 14 days, stockout URLs handled, facet policy status, Shopping
  presence on head terms. GA4, Shopify and GSC each labeled, never totaled.
