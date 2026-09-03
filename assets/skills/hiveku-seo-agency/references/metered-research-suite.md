# Metered Research Suite - the DataForSEO vendor families and `seo_research`

## What this covers / when to load this

The per-call-billed research surface: the ten DataForSEO vendor families proxied into the
catalogue (`dataforseo_labs_*`, `keywords_data_*`, `serp_*`, `on_page_*`, `backlinks_*`,
`content_analysis_*`, `domain_analytics_*`, `business_data_*`, `ai_optimization_*`, the bare
`crawl`) and the `seo_research` multi-tool that wraps most of the same endpoints behind one
`action` argument. Load it when you are about to spend research credits and need to know
which tool answers the question, what it requires, how many inputs fit in one call, what
it costs, and where it lies. Everything here is a catalogue, not a method.

Not covered, and where it lives: choosing, clustering and prioritizing keywords
(`keyword-research.md`); link lanes, R-A-P-D scoring and the outreach handoff
(`link-building-and-competitors.md`, section 7 keeps the outreach program); tracker and
Search Console reads (`rankings-and-search-console.md`); brand mentions and sentiment
(`digital-pr-and-brand-mentions.md`); forecasting (`forecasting-and-seasonality.md`); the
crawl-based audit method (`technical-seo.md`).

## Availability

Every vendor tool below is LIVE, proxied from the vendor MCP service with no builder route
(the catalogue shows `method: null`; that is the proxy, not a gap).

| Tool family | Status | Cost | Note |
|---|---|---|---|
| `dataforseo_labs_*` (20), `keywords_data_*` (6) | LIVE | B, per request, batch to 1,000 | Labs is country-level only; Trends returns relative interest |
| `serp_*` (7) | LIVE | C, per request per location | city or region accepted |
| `on_page_*` (2) | LIVE | E, per URL | works on rival URLs |
| `backlinks_*` (20) | LIVE | D, per request; `backlinks_bulk_*` for lists | any domain |
| `content_analysis_*` (3), `domain_analytics_*` (4), `ai_optimization_*` (2) | LIVE | per request, unclassed in the contract; treat as B | citation index, whois filter query, modeled AI estimate |
| `business_data_business_listings_search` | LIVE | the class I search; no cooldown on the raw tool | what `seo_citations_audit` spends |
| `crawl` | LIVE | Firecrawl credits by page count | grouped with the vendor families for profiles (contract 2026-08-30); unverified which flag gates it |
| `seo_research` (about 60 actions) | LIVE | the wrapped endpoint's class | no `project_id`; persists nothing except `aeo-audit` |

Profiles: the vendor families need `includeDataForSEO` (full, marketing, marketing-seo,
marketing-ads); `seo_research` is an `seo_` tool (full, marketing, marketing-seo). A
rejection on any other key is "not visible to this key", never "does not exist".

Discovery caveat: tool search keys on the first token of a name, so `department: 'seo'` or
a directory focus of `seo` never returns a vendor tool today. Search with no `department`,
or focus `seo,backlinks,dataforseo,serp,on,keywords,content,domain,business,ai` (an alias
is planned); once you know the name, `ToolSearch` `select:<name>`.

## Ground truth

### 1. Cost classes A-I, and what a rank check costs

Every metered call bills the account's DataForSEO balance with no confirm step. Name the
class before you spend; batch to the documented maximum.

| Class | What | Unit | Members |
|---|---|---|---|
| A | free DB reads | nothing | project-scoped `seo_*` reads, `seo_local_*`, cached `seo_gbp_*` reads, `seo_citations_get`, `seo_aeo_audit_get`, `seo_serp_get` (stored rows), `seo_core_web_vitals`, `seo_entity_check`, `seo_aeo_readiness`, `seo_cro_audit` |
| B | Labs and keywords_data | per request; up to 1,000 keywords on the bulk endpoints | `dataforseo_labs_*`, `keywords_data_*`, `seo_research` keyword and domain actions |
| C | live SERP | per request per location | `serp_organic_live_advanced`, `serp_youtube_*`, `seo_research` actions `serp`, `bing-serp`, `maps-serp`, `local-finder-serp` |
| D | backlinks | per request; `backlinks_bulk_*` take 1,000 targets | `backlinks_*`, `seo_research` backlinks actions |
| E | on-page instant | per URL | `on_page_instant_pages`, `on_page_content_parsing`, `seo_research` actions `instant-page`, `lighthouse` |
| F | crawl | per page; `max_crawl_pages` default 50, clamped to 500 | `seo_audit_start`, `seo_run_audit` |
| G | LLM mentions | about $0.10 per keyword per engine | `seo_aeo_rankings_sync`, the AI rank lanes |
| H | LLM-scored, budget-gated | per page or per day | `seo_eeat_scores` sweep, `seo_aeo_brand_audit` (one per-UTC-day budget) |
| I | citations | one Business Listings search, 24h cooldown | `seo_citations_audit` (429 returns the stored audit) |

Rank checks sit outside the letters: a scheduled organic check is about $0.003 per keyword;
an AI-engine lane about $0.10 per keyword per engine per check (class G).
`seo_aeo_audit_run` spends one SERP call per keyword; cap near 25. A tracked keyword can
carry up to nine lanes, so "sync every keyword on every engine" is up to five class-G
charges per keyword per check day. Refuse it; scope it.

### 2. The 402 and 503 symptoms

- The DataForSEO balance can go NEGATIVE. Every metered call then returns 402 with no
  per-tool warning and no balance pre-check anywhere. A 402 is a billing event: the
  research section becomes `insufficient_evidence`, the report says so, the human tops up.
  Never read 402 as "no results".
- 503 `dataforseo_unconfigured` means no credentials on the account. Not clean, not empty,
  not measured.
- Two unrelated families: vendor rate limits (429, retry after the window) and
  `gbp_quota_exceeded` / `gbp_quota_not_approved` (Google Business Profile quota on live
  `seo_gbp_*` reads). A 429 from `seo_citations_audit` is the 24h cooldown with the stored
  audit attached; a 429 from `seo_ga4_report` is GA4's hourly quota.
- The third failure shape is 200 with an empty `items[]`: DataForSEO returns empty, not
  an error, for unrecognized parameters and location or language mismatches. Empty means
  "check the arguments", never "nothing ranks".

### 3. The location vocabulary trap

- SERP tools (`serp_organic_live_advanced`, `serp_youtube_organic_live_advanced`,
  `seo_serp_get`, `seo_research` actions `serp`, `bing-serp`, `maps-serp`,
  `local-finder-serp`) accept a city or region (`location_name` "Austin, Texas, United
  States" or its code). Codes from `serp_locations` (Google) and `serp_youtube_locations`
  (YouTube), both utility calls.
- Labs tools accept COUNTRY only: `location_name: "United States"` on raw tools,
  `location_code: 2840` on `seo_research`. A city on a Labs call returns empty with a 200.
  The `seo_research` route retries a failed Labs call with the US code and returns a
  `location_note`; read it before reporting a US number as the client's market.
- `ai_optimization_keyword_data_locations_and_languages` is the lookup for the
  `ai_optimization_*` pair; never reuse a SERP code there unchecked.
- Language is a NAME on `seo_research` (`language: "English"`) and a CODE on raw tools
  (`language_code: "en"`). The `serp` action hard-codes `en`; a non-English SERP needs the
  raw `serp_organic_live_advanced`.
- `seo_aeo_audit_run` takes `location_code` as a number, `seo_aeo_rankings_sync` as a
  string. A type mismatch is dropped by the proxy and the call runs at 2840.

## Decision frameworks - batching rules and the funnel

The funnel is "qualify in bulk, deep-dive finalists". Every family has a bulk endpoint and
a per-item endpoint; the bulk one is always first.

| Family | Qualify in bulk | Deep-dive finalists | Batch rule |
|---|---|---|---|
| keywords | `dataforseo_labs_google_keyword_ideas` (200 seeds), `dataforseo_labs_bulk_keyword_difficulty` and `dataforseo_labs_search_intent` (1,000), `keywords_data_google_ads_search_volume` | `dataforseo_labs_google_keyword_overview` (per keyword), `dataforseo_labs_google_historical_keyword_data` | one call with 25 seeds, never 25 calls; dedupe the union first |
| domains | `dataforseo_labs_bulk_traffic_estimation`, `backlinks_bulk_ranks`, `backlinks_bulk_referring_domains`, `backlinks_bulk_spam_score` (1,000 each) | `dataforseo_labs_google_domain_rank_overview`, `backlinks_summary`, `backlinks_backlinks` | size the whole set in one call, open the two that matter |
| SERPs | none; each SERP is one request | `serp_organic_live_advanced` per keyword, location, device | cluster head plus two members; weekly per keyword at most |
| pages | `backlinks_bulk_pages_summary` (1,000), `dataforseo_labs_google_page_intersection` | `on_page_instant_pages`, `on_page_content_parsing` per URL | pick URLs from GSC or the tracker; never instant-page a crawl list |
| links | `backlinks_bulk_new_lost_backlinks`, `backlinks_bulk_new_lost_referring_domains` (1,000) | `backlinks_backlinks` with filters, `backlinks_anchors` | monthly in bulk; per-link detail only for a loss you will chase |

Three standing rules. Set `limit` explicitly on every Labs call: several default to 10
(`dataforseo_labs_google_keyword_ideas` does) and a default reads as a thin niche. Filter
and sort server-side (`filters`, `order_by`; vocabulary from
`dataforseo_labs_available_filters` and `backlinks_available_filters`) instead of paying for
1,000 rows to keep 50. Never re-pull unchanged data: volume and difficulty move monthly at
most, backlink summaries weekly, SERPs daily.

## The catalogue by family

Columns: Tool | What it answers | Required args | Batch/limit | Class | Trap. "Check the
schema" means the argument names are not in this repo (proxied from the vendor MCP
service): read the tool definition, never guess.

### `dataforseo_labs_*` (20)

| Tool | What it answers | Required args | Batch/limit | Class | Trap |
|---|---|---|---|---|---|
| `dataforseo_labs_google_keyword_ideas` | category-relevant ideas with volume, trend, CPC | `keywords[]`, `location_name` (country), `language_code` | 200 seeds; `limit` 1-1,000, default 10 | B | the default 10 makes every niche look thin |
| `dataforseo_labs_google_keyword_suggestions` | long-tail phrases containing the seed | `keyword`, `location_name`, `language_code` | `limit` 1,000 | B | one seed per call |
| `dataforseo_labs_google_related_keywords` | the "searches related to" graph | `keyword`, `location_name`, `language_code`, `depth` | to 4,680 rows by depth; `limit` 1,000 | B | depth multiplies cost; start at 1 |
| `dataforseo_labs_google_keywords_for_site` | keywords relevant to a domain | `target`, `location_name`, `language_code` | `limit` 1,000; `include_subdomains` | B | "relevant to" is not "ranks for" |
| `dataforseo_labs_google_keyword_overview` | volume, CPC, competition, intent, monthly searches | `keywords[]`, `location_name`, `language_code` | multi-keyword | B | billed per keyword; finalists only |
| `dataforseo_labs_bulk_keyword_difficulty` | KD 0-100 (log scale, chance of top 10) | `keywords[]`, `location_name`, `language_code` | 1,000 | B | relative to the top 10, not to the client |
| `dataforseo_labs_search_intent` | intent with probability, plus secondaries | `keywords[]`, `language_code` | 1,000 | B | no location argument |
| `dataforseo_labs_google_historical_keyword_data` | monthly searches, CPC, trend since 2021-08 | `keywords[]` plus location and language (check the schema) | multi-keyword | B | starts 2021-08; older seasonality needs Trends |
| `dataforseo_labs_google_top_searches` | the largest keywords in a location | `location_name`, `language_code`, `filters` | `limit` 1,000 | B | meaningless without filters |
| `dataforseo_labs_google_competitors_domain` | domains overlapping ours in SERPs | `target`, `location_name`, `language_code` | `limit` 1,000; `exclude_top_domains` | B | exclude the giants or it is Amazon and Wikipedia |
| `dataforseo_labs_google_serp_competitors` | who owns the SERPs for a keyword set | `keywords[]`, `location_name`, `language_code` | `limit` 1,000 | B | a priority cluster, not the universe |
| `dataforseo_labs_google_domain_intersection` | keywords two domains both rank for, each side's element and traffic | the two domains through the `intersections` parameter (check the schema); `location_name`, `language_code` | `limit` 1,000 | B | pairwise; the wrapper `keyword-gap` takes `domain` + `competitors[]` and merges up to 4 pairs |
| `dataforseo_labs_google_page_intersection` | keywords a set of PAGES share; with `exclude_pages`, a page-level gap | `pages` (object), `location_name`, `language_code` | `limit` 1,000 | B | without `exclude_pages` it is an intersection, not a gap |
| `dataforseo_labs_google_ranked_keywords` | every keyword a domain or page ranks for | `target`, `location_name`, `language_code` | `limit` 1,000; `include_subdomains`, `include_serp_info` | B | sort by traffic for money pages |
| `dataforseo_labs_google_domain_rank_overview` | ranking distribution, estimated organic and paid traffic | `target`, `location_name`, `language_code` | one domain | B | an estimate; never add to GSC clicks |
| `dataforseo_labs_google_historical_rank_overview` | the same over time | `target`, `location_name`, `language_code` | one domain | B | trajectory, not cause |
| `dataforseo_labs_bulk_traffic_estimation` | estimated traffic for many targets, split organic, paid, snippet, local | `targets[]`, `location_name`, `language_code` | 1,000 | B | the first call for sizing a competitor set |
| `dataforseo_labs_google_subdomains` | subdomains with ranking distribution and traffic | `target`, `location_name`, `language_code` | `limit` 1,000; `item_types` | B | finds the rival subdomain that carries the traffic |
| `dataforseo_labs_google_historical_serp` | the SERPs collected for a keyword over a time frame, features per date | `keyword`, `location_name`, `language_code` (dates: check the schema) | one keyword | B | algorithm-update forensics: who held what on the day of the drop |
| `dataforseo_labs_available_filters` | filter and sort vocabulary per Labs endpoint | `tool` | utility | negligible | read once, keep in memory |

### `keywords_data_*` (6)

| Tool | What it answers | Required args | Batch/limit | Class | Trap |
|---|---|---|---|---|---|
| `keywords_data_google_ads_search_volume` | Google Ads volume, CPC, competition | `keywords[]`, `location_name` | multi-keyword (cap not in the schema) | B | Ads and Labs volumes differ; name which one the report uses |
| `keywords_data_google_trends_explore` | Trends interest over time for Search, News, Images, Shopping, YouTube | check the schema | a handful of terms per query | B | relative 0-100, never a volume |
| `keywords_data_google_trends_categories` | the Trends category list | check the schema | utility | negligible | scopes an explore call |
| `keywords_data_dataforseo_trends_explore` | DataForSEO's own popularity index | check the schema | multi-keyword | B | never on one chart with Google Trends |
| `keywords_data_dataforseo_trends_demography` | age and gender split | check the schema | multi-keyword | B | directional; never a persona fact |
| `keywords_data_dataforseo_trends_subregion_interests` | popularity by subregion | check the schema | multi-keyword | B | the geo-share input for a forecast |

### `serp_*` (7)

| Tool | What it answers | Required args | Batch/limit | Class | Trap |
|---|---|---|---|---|---|
| `serp_organic_live_advanced` | the live organic SERP with every element | `keyword`, `location_name` (city OK), `language_code`, `device`, `depth` | one keyword; `max_crawl_pages` to 7 | C | each extra page is more spend |
| `serp_locations` | Google SERP location codes | `search_engine`, `country_code` | utility | negligible | look up once per client |
| `serp_youtube_locations` | locations for the four YouTube tools | check the schema | utility | negligible | a separate vocabulary |
| `serp_youtube_organic_live_advanced` | top 20 blocks of YouTube results | check the schema | one keyword | C | the SERP read behind the video section of `on-page-optimization.md` |
| `serp_youtube_video_info_live_advanced` | one video's data | check the schema | one video | C | pair with the organic call |
| `serp_youtube_video_comments_live_advanced` | a video's comments | check the schema | one video | C | audience language; never quote a commenter |
| `serp_youtube_video_subtitles_live_advanced` | a video's subtitles | check the schema | one video | C | the cheapest read of a rival's video outline |

### `on_page_*` (2)

| Tool | What it answers | Required args | Batch/limit | Class | Trap |
|---|---|---|---|---|---|
| `on_page_instant_pages` | one page's on-page audit: title, meta, headings, checks, load metrics | `url`; `enable_javascript`, `custom_user_agent`, `accept_language` | one URL | E | a JS-built page reads empty without `enable_javascript: true` |
| `on_page_content_parsing` | structured content: headings, text, links, anchors | `url` | one URL | E | outline benchmarking on rivals; not a crawl |

### `backlinks_*` (20)

| Tool | What it answers | Required args | Batch/limit | Class | Trap |
|---|---|---|---|---|---|
| `backlinks_summary` | topline links, referring domains, rank | `target`; `include_subdomains`, `exclude_internal_backlinks` | one target | D | report referring domains, never total backlinks |
| `backlinks_backlinks` | the individual links | `target`; `mode`, `filters`, `order_by` | `limit` 1,000 | D | the reclamation diff input |
| `backlinks_referring_domains` | domain-level rollup | `target` | `limit` 1,000 | D | the authority number that matters |
| `backlinks_referring_networks` | referring networks by IP or subnet | `target`, `network_address_type` | `limit` 1,000 | D | one network with a large share is a PBN or a host footprint |
| `backlinks_anchors` | anchor distribution | `target` | `limit` 1,000 | D | exact-match commercial over 10 percent is a hygiene item |
| `backlinks_domain_pages` | the target's pages with backlink data | `target` | `limit` 1,000 | D | which rival pages earn links |
| `backlinks_domain_pages_summary` | per-page summary across the target (one page if the target is a URL) | `target` | `limit` 1,000 | D | sort by referring domains: the formats that win links |
| `backlinks_competitors` | domains sharing the link profile | `target`; `main_domain`, `exclude_large_domains` | `limit` 1,000 | D | set `exclude_large_domains` |
| `backlinks_domain_intersection` | domains linking to the targets | `targets[]` | `limit` 1,000 | D | 2+ rivals and not us is the warmest list |
| `backlinks_page_intersection` | the same at page level | `targets[]` (URLs) | `limit` 1,000 | D | the link gap for one SERP |
| `backlinks_timeseries_summary` | metrics between two dates by day, week, month, year | `target`, `date_from`, `date_to` | one target | D | profile size, not new/lost |
| `backlinks_timeseries_new_lost_summary` | new and lost links and domains over time | `target`, `date_from`, `date_to` | one target | D | the DataForSEO new/lost; `seo_new_lost_backlinks` is the MANUAL tracker |
| `backlinks_bulk_ranks` | rank 0-1,000 (0-100 with `rank_scale`) | `targets[]` | 1,000 | D | a prospect qualifier, not a Google metric |
| `backlinks_bulk_backlinks` | live backlink counts | `targets[]` | 1,000 | D | a domain target means root plus subdomains |
| `backlinks_bulk_referring_domains` | live referring-domain counts | `targets[]` | 1,000 | D | same root rule |
| `backlinks_bulk_new_lost_backlinks` | new and lost backlink counts | `targets[]` | 1,000 | D | the catalogue text was copied from the referring-domains tool; the job is new/lost counts (vendor docs) |
| `backlinks_bulk_new_lost_referring_domains` | new and lost referring-domain counts | `targets[]` | 1,000 | D | the monthly competitor-velocity read |
| `backlinks_bulk_spam_score` | spam score 0-100 | `targets[]` | 1,000 | D | over 30 drops a prospect; never justifies a disavow |
| `backlinks_bulk_pages_summary` | backlink summary for many pages or domains | `targets[]`; `include_subdomains` | 1,000 | D | "which of these 200 URLs have links" |
| `backlinks_available_filters` | filter vocabulary per endpoint | `tool` | utility | negligible | filters bind to an object in the result |

### `content_analysis_*` (3)

| Tool | What it answers | Required args | Batch/limit | Class | Trap |
|---|---|---|---|---|---|
| `content_analysis_search` | pages citing a keyword | `keyword`; `keyword_fields`, `page_type`, `search_mode`, `order_by` | `limit` 1,000 | per request (B) | `search_mode: 'as_is'` for a brand |
| `content_analysis_summary` | citation overview: counts, sentiment connotations, top domains | `keyword`; `page_type`, connotation thresholds | `internal_list_limit` 20 | per request (B) | the monthly sentiment read |
| `content_analysis_phrase_trends` | citations over a date range by period | `keyword`, `date_from`, `date_to`, `date_group` | `internal_list_limit` 20 | per request (B) | a rising week is a closing window |

### `domain_analytics_*` (4)

| Tool | What it answers | Required args | Batch/limit | Class | Trap |
|---|---|---|---|---|---|
| `domain_analytics_technologies_domain_technologies` | the technologies a domain runs | `target` | one domain | per request (B) | tech-stack recon for migrations and teardowns |
| `domain_analytics_technologies_available_filters` | filter vocabulary | `tool` | utility | negligible | |
| `domain_analytics_whois_overview` | WHOIS enriched with backlink, ranking and traffic stats | `filters` (`[['domain', '=', 'example.com']]`) | `limit` 1,000 | per request (B) | a filter query: no filter returns arbitrary domains |
| `domain_analytics_whois_available_filters` | filter vocabulary | `tool` | utility | negligible | |

### `business_data_business_listings_search` (1)

| Tool | What it answers | Required args | Batch/limit | Class | Trap |
|---|---|---|---|---|---|
| `business_data_business_listings_search` | Google Maps entities by category, title, description or coordinate, with address, contacts, rating, hours | one of `title`, `description`, `categories`, `location_coordinate`; `filters`, `is_claimed` | `limit` 1,000 | I (the underlying search) | `seo_citations_audit` spends this under a 24h cooldown; the raw tool has none, so never loop it |

### `ai_optimization_*` (2)

| Tool | What it answers | Required args | Batch/limit | Class | Trap |
|---|---|---|---|---|---|
| `ai_optimization_keyword_data_search_volume` | an estimate of a keyword's usage in AI LLMs | `keywords[]`, `location_name`, `language_code` | multi-keyword | per request (B) | a modeled aggregate: no per-engine AI volume exists, so it never means "ChatGPT demand"; the `ai-keyword-volume` wrapper is plain Google volume |
| `ai_optimization_keyword_data_locations_and_languages` | its location and language vocabulary | none of note | utility | negligible | check before reusing a SERP code |

### `crawl` (1)

| Tool | What it answers | Required args | Batch/limit | Class | Trap |
|---|---|---|---|---|---|
| `crawl` | a Firecrawl-backed multi-URL crawl from a start URL, with content | `url`; `limit`, `maxDepth` | credits by page count | Firecrawl, not a DataForSEO class | `web_crawl` is the richer form (`sitemap`, `crawlEntireDomain`, `webhook`, `scrapeOptions`, `wait: false`); prefer it when visible. Neither is the SEO crawl: `seo_audit_start` (class F) is what the deep-dive actions read |

## The `seo_research` action catalogue

`seo_research({ action, ... })` POSTs to one builder route that picks a DataForSEO endpoint
by `action` and returns the vendor's result unwrapped. Defaults: `location_code` 2840,
`language` "English", `limit` 50. No `project_id` (the proxy drops undeclared arguments);
nothing persists except `aeo-audit`. Groups follow the server description. Where the Wraps column names an endpoint rather
than a catalogue tool, no raw tool exists and the wrapper is the only surface. Rule for
the last column: wrapper for country-level defaults and one argument shape; raw for
`filters`, `order_by`, `offset` paging, non-English, a city-level SERP, or a limit the
wrapper hard-codes.

### Domain intelligence (needs `domain`)

| Action | Required args | Wraps | Prefer the wrapper when / prefer raw when |
|---|---|---|---|
| `domain-overview` (default when only `domain` is given) | `domain` | `dataforseo_labs_google_domain_rank_overview` | wrapper for standing; raw across countries |
| `domain-backlinks` | `domain` | `backlinks_summary`, subdomains included | wrapper always |
| `top-pages` | `domain` | the Labs relevant_pages endpoint | wrapper only |
| `competitors` | `domain` | `dataforseo_labs_google_competitors_domain` | raw for `exclude_top_domains` |
| `ranked-keywords` | `domain` | `dataforseo_labs_google_ranked_keywords` | raw for filters, traffic sort, subdomains, paging |
| `referring-domains` | `domain` | `backlinks_referring_domains`, subdomains included | raw for filters and paging |
| `subdomains` | `domain` or `target` | `dataforseo_labs_google_subdomains` | wrapper is fine |
| `whois-overview` | `domain` | `domain_analytics_whois_overview` with the domain filter built | wrapper always |

### Keyword research (needs `keyword` or `keywords[]`)

| Action | Required args | Wraps | Prefer the wrapper when / prefer raw when |
|---|---|---|---|
| `keyword-overview` | `keywords[]` | `dataforseo_labs_google_keyword_overview` | wrapper for finalists; same per-keyword billing |
| `keyword-ideas` | `keywords[]` | `dataforseo_labs_google_keyword_ideas` | raw for filters |
| `keyword-trends` | `keywords[]` | `dataforseo_labs_google_keyword_overview` with SERP info; the "trend bands" are its monthly-searches array, NOT Google Trends | raw `keywords_data_google_trends_explore` when you mean Trends |
| `related-keywords` | `keyword` | `dataforseo_labs_google_related_keywords` | raw for `depth` and filters |
| `historical-search-volume` | `keywords[]` | the Labs historical_search_volume endpoint; nearest raw is `dataforseo_labs_google_historical_keyword_data` | wrapper for a forecast's monthly series |
| `keyword-difficulty` | `keyword` or `keywords[]` | `dataforseo_labs_bulk_keyword_difficulty` | wrapper; takes a single keyword |
| `bulk-keyword-difficulty` | `keywords[]` | same endpoint | either |
| `bulk-traffic-estimation` | `targets[]` | `dataforseo_labs_bulk_traffic_estimation` | wrapper is fine |
| `top-searches` | `location_name` or `location_code` | `dataforseo_labs_google_top_searches` | raw for filters |
| `serp` | `keyword` | `serp_organic_live_advanced`, `depth` = `limit`, language forced to `en`, `device` optional | raw for non-English, city-level location, deeper pages |
| `bing-serp` | `keyword` | Bing organic live | wrapper only; Bing is the control group in an update read |
| `bing-keyword-volume` | `keywords[]` | Bing search volume | wrapper only |
| `google-ads-search-volume` | `keywords[]` | `keywords_data_google_ads_search_volume`, partners off | wrapper is fine |
| `google-trends-explore` | `keywords[]`; `date_from` and `date_to` together or neither | `keywords_data_google_trends_explore`, web | raw for News, Images, Shopping, YouTube |

### Gaps and comparisons

| Action | Required args | Wraps | Prefer the wrapper when / prefer raw when |
|---|---|---|---|
| `keyword-gap` | `domain`, `competitors[]` (max 4) | one `dataforseo_labs_google_domain_intersection` per competitor, merged, deduped, volume-sorted, cut at `limit`; rows carry the competitors matched | wrapper for the gap list (it handles the pairwise shape); raw for the second domain's element or filters |
| `link-gap` | `domain`, `competitors[]` (max 4) | `backlinks_domain_intersection`, targets `[domain, ...competitors]`, limit hard-coded 50, rank desc | raw for more than 50 rows or filters |
| `page-intersection` | `targets[]` of 2-20 URLs | `dataforseo_labs_google_page_intersection`, URLs as `pages`, no `exclude_pages` | an INTERSECTION (keywords all pages share); for the gap use the raw tool with `exclude_pages` |

### Local SEO and reviews (Tranche A)

| Action | Required args | Wraps | Prefer the wrapper when / prefer raw when |
|---|---|---|---|
| `gbp-info` | `domain` or `target` (name plus city); `location_name` | Business Data my-business-info | wrapper only; one snapshot per business |
| `gbp-locations` | `query`; `location_name` | Business Data locations | wrapper only; pack holders and prospects by category |
| `gbp-questions` | `domain` or `target` | Business Data Q&A | read only; the Q&A write API is dead |
| `gbp-reviews` | `domain` or `target` | Business Data reviews, newest first, depth = `limit` | rivals; the client's own with reply state is `seo_gbp_reviews` (free) |
| `yelp-reviews` | `domain` or `target`; `location_name` defaults United States | Yelp reviews | wrapper only |
| `trustpilot-reviews` | `domain` | Trustpilot reviews | wrapper only |
| `tripadvisor-reviews` | `domain` or `target`; `location_name` | Tripadvisor reviews | wrapper only |
| `maps-serp` | `keyword` or `query`; `location_code` (city OK); `device` | Google Maps live SERP | a point-in-time pack read; the tracker's local lane is the ongoing one |
| `local-finder-serp` | `keyword` or `query`; `location_code` | Labs local-finder SERPs | wrapper only |

### Site audit deep dive (Tranche C) - `target` = the `seo_audit_start` task_id

Handlers live-tested 2026-08-30 on a 25-page crawl: a finished crawl reports `crawl_progress`
`finished` with `crawl_status { pages_crawled }`, and an empty items list on a finished crawl is a real
"none found"; `duplicate-content` REQUIRES `url` (the page to compare) or it returns an empty results array.

| Action | Required args | Wraps | Prefer the wrapper when / prefer raw when |
|---|---|---|---|
| `instant-page` | `url`; `device: 'mobile'` sets an iPhone user agent | `on_page_instant_pages` with JavaScript, browser rendering, resources on | wrapper for a rendered check; raw for a custom user agent or accept-language |
| `broken-links` | `target` | On-Page links, filtered to `is_broken` or `page_to_status_code >= 400` | the crawl's broken edges, for broken-link building and for fixing your own; same source as `internal-links`, so the crawl is the only spend (class F, already paid) and this read is free; returns link_from / link_to / text / page_to_status_code / type, capped at `limit`; empty means none of the RESOLVED links were broken - a link the crawl never fetched has a null status and counts neither way, so read `total_items_count` from `internal-links` before calling a site clean |
| `duplicate-content` | `target`; pass `url` too (the endpoint looks for duplicates of a page) | On-Page duplicate_content | wrapper only |
| `duplicate-tags` | `target` | On-Page duplicate_tags, type fixed to title | titles only, never meta descriptions |
| `redirect-chains` | `target` | On-Page redirect_chains | wrapper only |
| `non-indexable` | `target` | On-Page non_indexable | wrapper only |
| `internal-links` | `target`; `filters` passthrough | On-Page links | the crawl's link graph; `seo_internal_links` is the hosted-project static scan |
| `keyword-density` | `target` | On-Page keyword_density, phrase length fixed to 2 | two-word phrases only |

`lighthouse` and `instant-page` need `url`, not a task_id. `seo_audit_start` queues the
crawl (`max_crawl_pages` default 50, clamped 500; `audit_type` is ignored, one crawl type)
and returns the task_id plus an audit_id that `seo_audit_get` polls and persists (live
since 2026-08-30): an empty audit list means no crawl has run, never a clean site.

### Backlinks deep dive (Tranche D) - needs `target` or `domain`

| Action | Required args | Wraps | Prefer the wrapper when / prefer raw when |
|---|---|---|---|
| `backlinks-timeseries` | `domain` or `target`; `date_from`, `date_to` | `backlinks_timeseries_summary` by month | profile size over time; new/lost is the raw `backlinks_timeseries_new_lost_summary` |
| `backlinks-anchors` | `domain` or `target`; `order_by` | `backlinks_anchors`, live links | raw for filters |
| `backlinks-competitors` | `domain` or `target` | `backlinks_competitors`, self excluded | raw to exclude large domains |
| `backlinks-history` | `domain` or `target`; `date_from`, `date_to` | Backlinks history | wrapper only |
| `bulk-page-summary` | `targets[]` | `backlinks_bulk_pages_summary` | wrapper is fine |

### Reputation and content analysis (Tranche F)

| Action | Required args | Wraps | Prefer the wrapper when / prefer raw when |
|---|---|---|---|
| `sentiment-analysis` | `keyword` or `query` | Content Analysis sentiment over blogs, news, reviews, main pages | wrapper only |
| `content-mention-search` | `keyword` or `query`; `order_by` | `content_analysis_search`, `as_is`, same page types | raw for `keyword_fields` or `offset` |
| `content-summary` | `keyword` or `query` | `content_analysis_summary` | raw for connotation thresholds |

### Merchant and app data (Tranche G)

| Action | Required args | Wraps | Prefer the wrapper when / prefer raw when |
|---|---|---|---|
| `amazon-products` | `query` or `keyword`; `location_code` | Merchant Amazon products, amazon.com fixed | wrapper only (`ecommerce-seo.md`) |
| `google-shopping-products` | `query` or `keyword`; `location_code` | Merchant Google Shopping products | wrapper only |
| `amazon-reviews` | `target` = ASIN | Merchant Amazon reviews, recent first | wrapper only |
| `google-app-info` | `app_id` = Play package name | App Data Google | wrapper only |
| `apple-app-info` | `app_id` = numeric App Store id | App Data Apple | wrapper only |

### AEO / GEO

| Action | Required args | Wraps | Prefer the wrapper when / prefer raw when |
|---|---|---|---|
| `aeo-audit` | `keywords[]`; `domain` for our presence | the shared AEO library; PERSISTS to the SERP-feature tables; capped at 10 keywords here | prefer `seo_aeo_audit_run` (more knobs, clearer shape); history free via `seo_aeo_audit_get` |
| `ai-keyword-volume` | `keywords[]` (first 100) | `dataforseo_labs_google_keyword_overview` (Google volume) | a proxy; the raw `ai_optimization_keyword_data_search_volume` is the modeled AI estimate; neither is per engine |

### Lighthouse

| Action | Required args | Wraps | Prefer the wrapper when / prefer raw when |
|---|---|---|---|
| `lighthouse` | `url` | On-Page Lighthouse live JSON, mobile | almost never: `seo_core_web_vitals({ url })` is free and returns CrUX field p75 plus the PSI lab run; use this only for the full Lighthouse JSON |

## Thresholds and benchmarks - the shared tables

Industry benchmarks for opportunity sizing, never measurements of this client's SERPs and
never promises. Moved here from SKILL.md; `keyword-research.md` (feature haircuts) and
`forecasting-and-seasonality.md` (the band) multiply against them.

CTR by position (blended organic averages):

| Position | 1 | 2 | 3 | 4 | 5 | 6-10 | page 2 |
|---|---|---|---|---|---|---|---|
| CTR | about 28 percent | 15 | 10 | 7 | 5 | 2-4 | under 1 |

Opportunity = volume x CTR(target position) - current clicks, after the feature haircut in
`keyword-research.md` section 3.2.

Attackable difficulty by authority tier (KD from `dataforseo_labs_bulk_keyword_difficulty`;
authority from `backlinks_summary` rank and referring domains):

| Authority tier | Attackable KD | Note |
|---|---|---|
| new or weak (under 20 referring domains) | 0-20, long-tail only | harvest and local until authority moves |
| mid (20-100 referring domains) | up to about 40 | one funded siege per quarter |
| strong | up to about 60 | |
| any tier, KD 60+ | a dedicated content plus link campaign and a quarter of patience | |

Tie-break: read who holds positions 1-5 on the live SERP (`seo_research({ action: 'serp' })`
or `serp_organic_live_advanced`). Three or more national brands, marketplaces or Wikipedia
means re-scope whatever the KD says.

## Diagnosis: when the data looks wrong

| Symptom | Cause, in check order | Action |
|---|---|---|
| 402 on every metered call | negative balance | stop; `insufficient_evidence`; tell the human; never retry into it |
| 503 `dataforseo_unconfigured` | no credentials | same; a setup task, not a finding |
| 200 with empty `items[]` | city on a Labs call; a dropped argument name; language mismatch; a filter on a field this endpoint lacks | one broad seed at 2840 with no filters; rows there means the arguments were wrong |
| `page-intersection` returns shared keywords, not a gap | no `exclude_pages` in the wrapper | raw tool with `exclude_pages` |
| a deep-dive action errors on `target` | unfinished crawl, or a task_id from another project | wait; re-read the task_id from `seo_audit_start`; record the error and date |
| `seo_serp_get` empty | it reads STORED rows nothing writes today | live SERP is `seo_research({ action: 'serp' })` or `serp_organic_live_advanced` |

## Edge cases and failure modes

- Numbers come from these tools or they do not go in a deliverable; a model-remembered
  volume runs 2-4x off. Unreachable suite means `insufficient_evidence`, not a filled gap.
- Vendor estimates are their own ledger: never summed with GSC, Bing, the tracker or GA4;
  a rival is compared only against the same source's number for us.
- Non-US clients at the default 2840 get plausible, wrong numbers with no error. Set the
  country first and record the code in memory.
- The AI-volume pair is a modeled aggregate. "ChatGPT searches per month" is a fabricated
  metric.
- The crawl deep-dive actions were live-tested on 2026-08-30 (25-page crawl; `duplicate-content` needs `url`). Say so.

## Persistence and reporting

A pull that is not persisted is paid for again next session. Land every universe, gap
list, competitor sizing and backlink summary the same session:

- `seo_sheet_create_tab({ deliverable_slug, name, columns })` once per pull with the pull
  date in the name (`"2026-08-30 Keyword universe (US, en)"`), then
  `seo_sheet_add_rows({ deliverable_slug, tab_name, rows })`. Set column `id` explicitly.
  `seo_sheet_create_tab` is replace-by-name (the date protects last quarter's tab);
  `seo_sheet_add_rows` is not idempotent and auto-creates a tab on a typo, so retry by
  re-creating the tab with the full row set. `deliverable_slug` selects nothing (one
  workspace per account).
- `memory_create`, or `memory_update` resending the whole seo note, for the decisions:
  location and language codes, seed set, competitor set, the tab name holding the data,
  the pull date.
- Never re-pull unchanged data: volumes and difficulty quarterly, backlink summaries and
  bulk new/lost monthly, live SERPs only for a tracked priority keyword whose position
  moved this week or whose cluster is being planned. Read the dated tab first; a re-pull
  that shows no change is a line in the report, not a new tab.
