# Technical SEO Blind Spots - Operator Manual

## What this covers / when to load this

The technical checks that are easy to miss and expensive to miss: X-Robots-Tag headers, canonical
validity across the whole URL set rather than per page, redirect chain depth, near-duplicate
templated pages, thin pages, and the gap between what a site claims is indexed and what Google
says. For each one this file says which Hiveku tool reaches it, what that tool's coverage really is,
and what is left for a manual pass - verified against `hiveku-mcp-api-server/src/tools/*.ts` and the
builder routes on 2026-08-26, with the crawl actions live-tested on 2026-08-30 (25-page crawl).

Load it before running a site audit you will report on, before shipping a Next.js site, when a site
has hundreds of pages and no rankings, or any time you are about to write "the audit found no
issues".

`references/technical-seo.md` is the main manual (audit rail, CIRR ladder, plays, thresholds); this
is the adversarial companion, because the defect that keeps shipping in SEO tooling is **something
reporting success while silently doing less than it claims.** The main manual's section 1.4 points
here for production response headers (section 2) and redirect chain depth (section 4).

## Availability

Every tool named below is LIVE. A name that does not resolve on your key is "not visible to this
key", never "does not exist": `web_crawl`, `project_files_search`, `preview_http_get` and the
redirect tools are not visible to a marketing-seo key today.

| Tool | Status | Cost | Note |
|---|---|---|---|
| `seo_audit_start` | LIVE | F, crawl per page | `max_crawl_pages` default 50, clamp 500; returns `audit_id` + `task_id`; `seo_audit_get` polls and persists (live since 2026-08-30). |
| `seo_research` crawl actions | LIVE, live-tested 2026-08-30 | E, per request | `target` = task_id for `redirect-chains`, `non-indexable`, `duplicate-tags`, `duplicate-content` (also REQUIRES `url`), `internal-links`, `keyword-density`; `url` for `instant-page`. 50 rows per page. |
| `seo_audit_get`, `seo_list_audits` | LIVE | A, free | Read the persisted `seo_site_audits` rows (written since 2026-08-30). An empty list means no crawl has run, never a clean site. |
| `seo_gsc_index_coverage`, `seo_gsc_inspect_url`, `seo_gsc_list_sitemaps`, `seo_gsc_get_sitemap`, `seo_gsc_top_pages` | LIVE | free | 50 URLs per call; indexed snapshot only; `feedpath` = full sitemap URL. |
| `preview_http_get` | LIVE | free | The only header reader; preview container only. |
| `project_files_search`, `project_redirects_list`, `project_redirects_deploy`, `pages_list` | LIVE | free | Hiveku-hosted projects only. |
| `fetch_url`, `web_map`, `web_crawl`, `web_scrape`, `web_extract`, `web_actions` | LIVE | free; crawl credits | None returns response headers (section 1.1). |
| `seo_internal_links`, `seo_cannibalization`, `seo_content_decay`, `seo_eeat_scores` | LIVE | free | Sunday cron; empty = not computed, never no-issues. |
| `analytics_pages`, `seo_backlinks_list`, `memory_create`, `memory_update`, `seo_task_implement`, `seo_deliverable_save` | LIVE | free | Reconciliation and close-out. |

---

## 0. The output contract: state your coverage or the audit is worthless

The single most damaging audit failure is not a wrong answer. It is an unstated one. An audit that
examined 4 URLs out of roughly 40 and never said so is worse than no audit, because the client now
believes the other 36 were checked.

**Every technical finding you report carries its denominator.** Not as a footnote, in the finding.

Before the findings, always emit a coverage block in this shape:

```
COVERAGE
  URL set:        847 URLs discovered (web_map, sitemap + link following)
  Examined:       50 URLs (seo_gsc_index_coverage, batch 1 of 17) + 100 pages (web_crawl)
  Selection:      home, 6 money pages, 1 per template family (9 families), then top traffic
  Templates hit:  9 of 9 known families
  NOT examined:   the /blog archive (612 URLs, sampled 4), /legacy (89 URLs, 0)
  Header checks:  production headers NOT read - no Hiveku tool reads them (section 2)
  Confidence:     template-level findings HIGH; site-wide counts are ESTIMATES from a 6 pct sample
```

Rules that make this real rather than decorative:

1. **A sample is a sample.** "Duplicate titles on 12 pages" from a 50-page crawl of an 847-page
   site is "12 of the 50 pages examined", never "12 pages on the site".
2. **A cap is a coverage limit.** `seo_gsc_index_coverage` stops at 50 URLs per call. If you ran
   one batch, you audited 50 URLs. Say the batch number and how many remain.
3. **Empty is not clean.** Several Hiveku SEO tools return empty when their weekly cron has not run
   or a source is not connected. Empty means "no data", and you report it as no data. This is
   explicit in the tool descriptions for `seo_internal_links`, `seo_cannibalization`,
   `seo_content_decay`, and `seo_eeat_scores`: "never read empty as no-issues".
4. **A check you could not run is a finding.** "Response headers were not verified" belongs in the
   report at the same weight as any issue. Silence reads as a pass.
5. **Template families, not URL counts, are the unit of confidence.** One good sample of each of 9
   template families beats 200 random URLs, and it is honest to say so. What is not honest is
   sampling 4 families and reporting on 9.

---

## 1. Ground truth: what Hiveku can actually read

### 1.1 Response headers - the verified table

Verified by reading each tool definition in `hiveku-mcp-api-server/src/tools/` and the builder route
behind it, 2026-08-26.

| Tool | Reads response headers? | What you actually get back |
| --- | --- | --- |
| `fetch_url` | **No.** One header only. | `{ url, status, content_type, body, truncated, byte_count }`; its `headers` INPUT forwards REQUEST headers, a genuine trap. |
| `web_scrape` | **No.** | markdown / html / rawHtml / links / branding / summary / images / screenshot, plus `metadata` carrying `statusCode`. No header field anywhere. |
| `web_extract`, `web_crawl`, `web_map`, `web_actions` | **No.** | LLM extraction; per-page scrape output; `data.links`; browser actions then a scrape (its `executeJavaScript` could read headers same-origin, unverified - validate against a `curl` before relying on it). |
| `seo_gsc_inspect_url`, `seo_gsc_index_coverage` | Indirectly, the useful one. | Google reports the effect of the header, not its text; section 2. The crawl tools (section 1.2) do not read headers either. |
| `preview_http_get` | **Yes.** The only one. | `headers_only: true` returns `data.headers` (16 KB cap); `include_headers: true` returns headers with the body (8 KB cap). Runs `curl -i` against localhost INSIDE the running preview container (port 3001). |

**`preview_http_get` is preview-tier only.** It hits the dev server inside the container, not
production. A header set by CloudFront, by a production-only code branch, or by anything in front of
the app will not appear. It is the right pre-deploy gate and the wrong post-deploy proof.

### 1.2 The site audit: the rail, its caps, and how to reach what the crawl computes

`seo_audit_start({ project_id, target_url, max_crawl_pages })` queues one DataForSEO OnPage crawl.
Verified behavior (route read and live call, 2026-08-30):

- **`max_crawl_pages` defaults to 50 and is hard-clamped to 500.** Omit it and you crawled 50 pages,
  whatever the site's size - the coverage trap of section 0 living inside Hiveku's own tool. Always
  pass it, compare it to the URL count from `web_map`, and report both. `seo_run_audit` cannot pass
  it (it declares only `project_id` and an `audit_type` the route echoes and ignores), so it is
  always a 50-page crawl of the project domain; there is ONE crawl type.
- It returns `202` with `{ audit_id, task_id, target, project_id, max_crawl_pages, status: 'queued' }` and
  does not wait; a 25-page crawl finished in about 4 minutes. Keep the `task_id`.
- `503 dataforseo_unconfigured` = no credentials; `402` = the metered budget is exhausted or the
  DataForSEO balance went negative. Neither is "the site is clean".

**The persisted lane round-trips (live since 2026-08-30).** `seo_run_audit` and `seo_audit_start`
return `{ audit_id, task_id }`; `seo_audit_get({ audit_id })` polls and persists the result into
the `seo_site_audits` table that `seo_list_audits` reads. **An empty audit list still means no
crawl has run, never a clean site.** For everything past the persisted summary, read the crawl
through `seo_research`.

**What the crawl computes IS reachable, through the `seo_research` crawl actions.** The crawl client
carries filter mappings for 84 checks, including every one this file is about (`canonical_chain`,
`canonical_to_redirect`, `canonical_to_broken`, `recursive_canonical`, `redirect_chain`,
`duplicate_content`, `low_word_count`), while the persisted summary only ever asks for 12 basic ones
(status codes, title and description presence and duplication, H1, page size, load time, image alt)
and saturates its affected-page counts at 100 (exactly 100 means "100 or more"). The route to the
rest, `target` = task_id, live-tested:

| Action | Argument | What comes back (live) |
| --- | --- | --- |
| `redirect-chains` | `target` | `results[0]` with `crawl_status` (`max_crawl_pages`, `pages_in_queue`, `pages_crawled`) and `items`, one per chain, hop by hop |
| `non-indexable` | `target` | same shape; one item per page the crawler could not index, with a reason |
| `duplicate-tags` | `target` | duplicate titles only; `results: []` = no duplicate titles in the crawled set |
| `duplicate-content` | `target` + `url` (REQUIRED) | `crawl_status` + items similar to `url` with a similarity score. Without `url` the response is `results: []`, which reads as "no duplicates" and means "no page given" |
| `internal-links` | `target`, optional `filters` | the link rows the crawl recorded, 50 per page with a `search_after_token` (790 rows on a 25-page site) |
| `keyword-density` | `target` | two-word phrase frequency, 50 per page with `total_items_count` (5,833 on a 25-page site) |
| `instant-page` | `url`, optional `device: 'mobile'` | one URL rendered with JavaScript: checks, meta, timing, content metrics |

Two reads that make these honest. **Zero items is a real "none found" only when `crawl_progress`
reads `finished`**; anything else means the crawl is not ready, and a not-ready crawl is never
clean. **Coverage of every action is `max_crawl_pages`**: a chain starting at a URL the crawl never
reached is not in `redirect-chains`, and an empty `duplicate-tags` covers the crawled titles only.
State the sample every time. When an action errors, record the error and the date, use the section's
manual escalation, and report the check as not run.

---

## 2. X-Robots-Tag headers

### What it is

`X-Robots-Tag: noindex` is an HTTP response header. Per Google's own documentation the header and
the `<meta name="robots">` tag **have the same effect**. A noindex header deindexes a page exactly
as the meta tag would, and it is completely invisible to anything that reads only the HTML.

### Why it gets missed

Every convenient tool reads HTML: `web_scrape`, `web_crawl`, `fetch_url` and view-source all show a
clean `<head>` while the whole site is out of the index. This is the classic Next.js footgun, and
**Hiveku builds and deploys Next.js sites**: a middleware matcher or a `headers()` entry in
`next.config` broader than the author believed, or a staging guard that ships to production because
the tier check reads an env var set everywhere. Nothing errors; traffic decays over weeks; the
deploy that caused it is 40 commits back.

### How to check it with Hiveku tools

**The one that works on a live site: `seo_gsc_index_coverage`.** Google reports the effect rather
than the header text, which is better evidence anyway. Per URL it returns `indexing_state`,
`coverage_state`, `verdict`, `last_crawl_time`, `google_canonical`, `user_canonical`,
`page_fetch_state` and `robots_txt_state`, verbatim from URL Inspection. The `indexingState` enum
distinguishes `BLOCKED_BY_META_TAG`, `BLOCKED_BY_HTTP_HEADER` and `BLOCKED_BY_ROBOTS_TXT`:
**`BLOCKED_BY_HTTP_HEADER` is the X-Robots-Tag signal, the only one Hiveku sees on production.**
Confirm the literal enum string the first time you see one.

Three limits to state whenever you use it: it inspects **the indexed snapshot, not the live page**,
so a header added yesterday may not show; it needs a connected GSC property, so it cannot audit a
competitor or a pre-launch site; and it caps at **50 URLs per call**.
The crawl's `non-indexable` action is a second read on the crawled set: its per-page reason
separates a header block from a meta or robots block - confirm the reason strings on the first call.

**Before a deploy, on a Hiveku-hosted project: `preview_http_get({ project_id, path, headers_only:
true })`**, the only tool that returns the header text. Run it on `/` plus one path per template
family. Preview tier only, so it proves the application code is clean, not that production is.

**In the source, on a Hiveku-hosted project: `project_files_search`** for `X-Robots-Tag` and
`noindex` with `case_insensitive: true`, then `robots` with `glob: 'next.config.*'` and `glob:
'**/middleware.*'`, and read every match for a **matcher wider than the intent**: a `middleware.ts`
matcher of `/:path*` with a noindex behind a tier check is one bad env read from deindexing the
site. Note the 500-match cap; narrow the glob rather than concluding.

### Manual escalation

For **production headers on a live domain there is no Hiveku tool.** Say so in the report rather
than implying the check ran, then close it with one shell line per URL, home page plus one per
template family, against both `www` and apex if both resolve:
`curl -sS -D - -o /dev/null -A 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' '<url>'`
and grep for `x-robots-tag` (GET, not HEAD; the Googlebot agent because some stacks vary the header
by user agent). The Search Console UI's live test is the client-facing version of the same evidence.
If you cannot run either, the finding is: "X-Robots-Tag was not verified on production; no Hiveku
tool reads live response headers, and this is the check most likely to explain a sitewide loss."

---

## 3. Canonical validity across the URL set

### What it is

A canonical tag is only meaningful in relation to the rest of the site. The failures that matter are
relational: canonical to a redirect (`/a` -> `/b`, `/b` 301s to `/c`, Google has to guess); to a
noindex page (contradictory, so Google ignores you); to a 404 or 5xx; chains and loops; to another
domain (a staging or CDN host left in a template, handing your equity away); protocol and host drift
(half the set canonicals to `https://www.`, half to `https://`).

### Why it gets missed

Because the per-page check passes: every tag is well-formed and absolute, the graph is incoherent,
and "does this page have a canonical" is the checklist most audits run.

### How to check it with Hiveku tools

**Crawl first.** `seo_research({ action: 'non-indexable', target: task_id })` lists every crawled
page the crawler would not index with its reason - a canonical pointing elsewhere is one of the
reasons, so the canonical-shaped rows are your candidate edges (confirm the reason strings on the
first call). `seo_research({ action: 'redirect-chains', target: task_id })`: a canonical target that
is itself a redirect appears as a chain start, the canonical-to-redirect case. Then `seo_research({
action: 'instant-page', url })` on one URL per template family for the declared canonical and the
page's own checks. The crawl computes `canonical_chain`, `canonical_to_redirect`,
`canonical_to_broken` and `recursive_canonical` as named checks and no action filters on them today;
the `internal-links` action's `filters` pass-through is the advanced route - check the tool's schema
and the DataForSEO filter syntax first. Coverage = `max_crawl_pages`.

**`seo_gsc_index_coverage` is the strongest signal on production, because it gives you both
sides.** Each result carries `user_canonical` (what your tag says) and `google_canonical` (what
Google chose): a mismatch means Google rejected your canonical and `coverage_state` says why
("Duplicate without user-selected canonical", "Duplicate, Google chose different canonical"); a
`google_canonical` off-property means you are consolidating into someone else's URL. Batch by
business value: home, money pages, one per template family, then top traffic from
`seo_gsc_top_pages`. 50 per call. Report the batch number.

**Build the graph yourself for what the crawl did not reach.** `web_map({ url })` for the URL
universe, then `web_crawl` with `scrapeOptions: { formats: ['rawHtml'], onlyMainContent: false }`
(`false`, or you may lose the `<head>`), or `web_extract({ urls, prompt })` for the canonical href,
robots meta and status per URL. Build the edge list `page -> canonical target` and check: is each
target a 200 in the set, does it declare a different canonical (chain), does following the edges
revisit a node (loop), does its robots meta say noindex, do hosts and protocols agree ("812 of 847
use `https://www.`, 35 use `https://`"). On a Hiveku-hosted project, `project_files_search({
project_id, query: 'canonical' })` finds the 3 to 5 templates that emit one.

### Manual escalation

Above about 1000 URLs, or when the client needs the complete graph rather than a crawl-capped one, a
desktop crawler (Screaming Frog, Sitebulb) validates canonicals across the set natively, and it is
honest to say so. Never report canonical health as clean on the strength of a 50-page crawl.

---

## 4. Redirect chain depth

### What it is

One hop is normal. Three or more is a crawl-budget tax and an equity leak, and chains accumulate
from history: a URL migration, then a trailing-slash normalization, then an http-to-https sweep,
each layered onto the last. Watch for the chain that ends in a 404 (a broken link wearing a 301) and
the chain that loops (a browser reports "too many redirects"; a crawler reports nothing at all).

### Why it gets missed

Every hop returns a healthy 301. Every crawler that follows redirects by default reports the final
200 and moves on. The chain is only visible if you ask for it specifically.

### How to check it with Hiveku tools

**Crawl first.** `seo_research({ action: 'redirect-chains', target: task_id })` returns every chain
the crawl followed, hop by hop - exactly the instrument the main manual's ">= 2 hops fix, >= 3 hops
urgent" threshold needs. Its coverage is the crawl: a chain only appears if the crawl reached its
first hop, so old URLs nothing links to any more (the ones that still carry backlinks) are not in it;
feed those separately, below. Zero items with `crawl_progress: 'finished'` is a real none-found on
the crawled set; state the sample.

**`project_redirects_list({ project_id })` gives you the rule table, and you compute chains from it
yourself.** Treat each active rule (`from_path`, `to_path`, `status_code`, `match_type`,
`is_active`) as a directed edge and walk it. **Depth**: follow `to_path` into any rule whose
`from_path` matches it and count; two or more edges is a chain to flatten - rewrite every rule so
its `to_path` is the final destination. **Loops**: a node revisited during the walk. **Terminal
validity**: does the final `to_path` correspond to a real page - `pages_list({ project_id })` for a
Hiveku-hosted site, or `fetch_url` on the absolute URL and read `status`. **Match type matters**: a
`prefix` or `regex` rule can feed a chain no pair of `exact` rules reveals, so expand prefix rules
against your real URL list first. **`is_active: false` rules are noise**; exclude them.

Two limits to state. `project_redirect_create` validates loops and chains to depth 10 **only at
create time**, so an imported or older rule set was never checked. And this list is only Hiveku's
CloudFront layer: redirects from `next.config`, middleware or the CMS are not in it. Nothing changes
on the live site until `project_redirects_deploy` runs.

**On a live URL, `fetch_url` gives a partial answer.** `data.url` is the final URL, so a changed
`data.url` proves a redirect happened, but the hop count is not reported; only past 5 hops does it
fail with `too_many_redirects` and a `visited` array - a detector for catastrophic chains, no help
for the 3-hop case.

### Manual escalation

For the URLs the crawl did not reach - every `from_path` from `project_redirects_list`, every URL
that still has backlinks (`seo_backlinks_list`), the old URL set from any migration in memory - one
shell line per URL reports the hop count and the final URL:
`curl -sS -o /dev/null -L -w '%{num_redirects} hops -> %{url_effective} (%{http_code})\n' '<url>'`
(add `-D -` and grep `^(HTTP/|location:)` for the full chain). Above a few hundred rules a desktop
crawler reports the whole chain graph natively.

---

## 5. Near-duplicate content on templated pages

### What it is

Fifty location pages from one template where the only difference is the city name. Each passes
every individual check (unique title, H1, meta, 600 words, valid schema); as a set they are one page
with a variable in it. **This is acute for Hiveku specifically**, because Hiveku generates location
and service pages from templates: it is the most common cause of a site with hundreds of pages and
no rankings, and the one clients least expect, because the deliverable looked substantial.

### Why it gets missed

`duplicate_title` and `duplicate_description` are exact-match checks, and templated pages pass them
by construction - the city name is interpolated into both. The persisted summary's 12 issue types
(section 1.2) contain no similarity measure. Any check that operates on one page at a time is
structurally incapable of seeing this: the defect exists only in the relationship between pages.

### How to check it with Hiveku tools

**Crawl first.** `seo_research({ action: 'duplicate-content', target: task_id, url: '<one member of
the family>' })` returns the crawled pages similar to that seed URL with a similarity score - run it
once per template family with a representative member as the seed, and read the score the way the
Jaccard bands below read. **`url` is required**: without it the response is `results: []`, which
looks like "no duplicates" and means "no page given". `seo_research({ action: 'duplicate-tags',
target: task_id })` adds the exact-title duplicates (`results: []` = none among the crawled titles).
Coverage = `max_crawl_pages`, so a 214-URL family inside a 50-page crawl is sampled, not measured.

1. **Enumerate the family.** `web_map({ url, search: '/locations/' })` or `pages_list({ project_id })`
   for a Hiveku-hosted site. Report the size: "the /locations family has 214 URLs".
2. **Pull the bodies** the crawl did not reach: `web_crawl({ url, limit: 40, includePaths:
   ['/locations/.*'], scrapeOptions: { formats: ['markdown'], onlyMainContent: true } })` - main
   content only, since the chrome is identical by design.
3. **Run the substitution test first - it is the cheapest and usually decisive.** Take two pages
   from the family, replace the varying token (city, service, phone number) with a placeholder, and
   diff what remains. **If the two bodies are identical after substitution, they are one page.**
4. **If they differ, quantify how much.** Shingle each body into overlapping 5-word sequences and
   compute Jaccard overlap between pairs: **above 0.90** one page with a word swapped - consolidate
   behind a location selector or make each page genuinely different; **0.70 to 0.90** thin variants
   - each needs real local substance (named projects, staff, local pricing, real photographs) or a
   merge; **below 0.50** genuinely distinct.
5. **Report unique share, not just overlap.** "Each location page carries 47 unique words out of
   612, about 8 percent" is a sentence a client acts on. "Jaccard 0.92" is not.
6. **Confirm with Google.** `seo_gsc_index_coverage` on 50 members of the family: the duplicate
   coverage states and large counts of "Crawled - currently not indexed" are Google saying the same
   thing in its own words.
7. **Go to the template, not the pages.** `project_files_search({ project_id, query: '<the shared
   phrase>' })` finds the generator. A 214-page problem usually has a 1-file fix.

`seo_cannibalization` corroborates: queries where 2 or more pages each drew 50+ impressions (200+
combined) over the last 28 archived days, Sunday cron. **Empty until GSC is connected and the first
weekly run completes** - "not computed yet", never "no cannibalization".

### Manual escalation

For the members the crawl and the `web_crawl` sample did not reach, the substitution test on two
pages per template family takes minutes and is the highest-value finding on most templated sites; a
desktop crawler's near-duplicate report covers a whole family above a few hundred pages. Never
report a templated family as unique on the strength of exact-match title checks.

---

## 6. Thin pages

### What it is

A page of 250 to 500 words will not rank for a competitive commercial term - not because word count
is a ranking factor, but because it does not answer the query as completely as the ten pages that
already rank. A thin template multiplied 200 times is how a site acquires hundreds of pages that do
nothing.

### Why it gets missed

The persisted summary's 12 issue types contain no word-count check. The crawler computes
`low_character_count`, a plain-text word count, and a `low_word_count` filter at under 300 words,
and the summary never asks for them (section 1.2). Meanwhile the naive check - count the text in the
HTML - reports a 250-word page with a large nav and a 900-word footer as a 1400-word page.

### How to check it with Hiveku tools

**Crawl first.** `seo_research({ action: 'instant-page', url })` on one URL per template family
returns the rendered page's content metrics, including its plain-text word count and text-to-HTML
rate, alongside its checks - one URL per call, so it is the depth read, not the sweep (confirm the
field names on the first call). `seo_research({ action: 'keyword-density', target: task_id })` gives
the two-word phrase profile across the crawl (50 per page, `total_items_count` for the size), which
exposes a family whose "content" is the same six phrases repeated. State the URLs you chose plus
`max_crawl_pages`.

**Sweep with a crawl of your own.** `web_crawl({ url, limit: 100, scrapeOptions: { formats:
['markdown'], onlyMainContent: true } })` and count words in each page's markdown (main content
only, so you count what the page says). Bucket rather than list: under 300 words on a commercial
term is thin (expand, merge or remove); 300 to 600 is thin for competitive terms, adequate for
long-tail support pages; 600 to 1200 is normal for a service page; a whole template family in one
bucket is the finding, not the pages.

**Then reconcile against demand.** `seo_gsc_top_pages({ site_url, start, end, row_limit })` for
impressions and clicks per page, `analytics_pages({ project_id, from_date, to_date, limit })` for
sessions. Work is justified by **impressions present, clicks near zero, word count under 400**; thin
but converting (a contact or booking page) is left alone.

**`seo_eeat_scores` is a spot check, not a sweep**: 10 pages per account, re-scored monthly,
LLM-scored with a static fallback (check `*_signals.method` before quoting a row).
**`seo_content_decay`** flags pages losing traffic (last 28 archived days versus the prior 28);
decaying and thin is the strongest refresh candidate. Both are empty until GSC is connected and the
Sunday sweep has run.

### Manual escalation

State the sample: "word counts computed for 100 of 847 URLs, covering all 9 template families, plus
rendered counts for 9 representative URLs". For a full-site count above a few hundred pages, a
desktop crawler exports word count for every URL in one pass and is the right tool.

---

## 7. Index coverage truth

### What it is

Three populations routinely treated as one: **what the site claims exists** (sitemap plus internally
linked URLs), **what Google knows about** (discovered), and **what Google actually indexes**. The
gaps are the diagnosis: submitted but not indexed is a quality or crawl problem; indexed but not
submitted is a sitemap that does not describe the site, or an unwanted URL space (parameters,
facets, staging paths) leaking in; indexed under a different canonical is a consolidation problem.

### Why it gets missed

Because "the sitemap has 847 URLs" gets reported as "the site has 847 indexed pages". They are not
the same number and the difference is the entire finding.

### How to check it with Hiveku tools

**Build all three populations, then subtract.**

The site's claim: `seo_gsc_list_sitemaps({ site_url })` for the sitemaps GSC has and their state;
`seo_gsc_get_sitemap({ site_url, feedpath })` for `lastSubmitted`, `lastDownloaded`, `isPending`,
`errors[]`, `warnings[]`, `contents[]` - counts by type, **not the URL list**, so `fetch_url` on the
sitemap XML gives the actual URLs (200 KB body cap, one fetch per child of an index);
`web_map({ url, limit })` for discovery, which finds the URLs the sitemap omits;
`seo_generate_sitemap({ project_id, base_url })` on a Hiveku-hosted project for what the sitemap
*should* contain - diffing that against the live sitemap.xml catches a stale committed file.

Google's answer: `seo_gsc_index_coverage({ site_url, urls })`, **capped at 50 URLs per call** -
Google's public API has no bulk coverage endpoint, so this tool fans out URL Inspection per URL and
buckets by `coverage_state`, returning `buckets` and `total` alongside per-URL results; passing more
than 50 is a 400 error, not a silent truncation. `seo_gsc_inspect_url({ site_url, inspection_url })`
for one URL in depth: **indexed snapshot only, Google's API has no live test**, and manual actions
and security issues are not in the response (Search Console UI only).

**The cap is a coverage statement, and this is where the defect this file is about actually bites.**
A 50-URL batch on an 847-URL site is 6 percent. That is a legitimate, useful sample if you select it
deliberately and report it as a sample:

```
Batch 1 of 17 (50 of 847 URLs): home, 6 money pages, 1 per template family (9), top 34 by clicks.
  Submitted and indexed ................ 31
  Crawled - currently not indexed ....... 9
  Discovered - currently not indexed .... 6
  Duplicate, Google chose different canonical .... 4

These are counts over 50 examined URLs. Site-wide figures are extrapolations from a 6 pct
non-random sample weighted toward high-value pages, so the true site-wide indexed share is
LOWER than 62 pct, not equal to it.
```

That last sentence is the difference between an analyst and a spreadsheet: a value-weighted sample
overstates health, and naming the direction of your bias is most of the value. Run more batches
when the answer matters; if you stop at one, say so. `robots_txt_state` and `page_fetch_state` in
the same results separate "Google will not index this" from "Google could not fetch this".

### When no tool covers it

**There is no bulk index coverage export.** This is Google's limitation, not Hiveku's - the public
API has no coverage endpoint, which is why the tool fans out inspection calls. The full Index
Coverage report with its URL lists exists only in the Search Console UI, the right escalation when
the client needs the census rather than the sample. Server log analysis, the definitive answer for
what Googlebot fetched, has no tool at all - no log-file analyzer here - and needs a log export from
the client's host.

---

## 8. The checklist

Run in order. Steps marked EXTERNAL have no Hiveku tool: run them elsewhere, or report them as not
checked. **Omitting the EXTERNAL rows from your report recreates the exact defect this file documents.**

| # | Step | Tool | Hiveku today |
| --- | --- | --- | --- |
| 1 | Context, prior decisions, last task_id and page cap | `account_context_get({ domain: 'seo' })`, `memory_list` | YES |
| 2 | Project, sources, GSC connected (without it this is a crawl opinion) | `seo_list_projects`, `seo_project_get`, `sites_list`, `seo_gsc_list_sitemaps` | YES |
| 3 | URL universe, live sitemap count, template families, the section 0 coverage block | `web_map({ url, limit })`, `fetch_url` on sitemap.xml (200 KB cap), your own pass | YES (grouping is manual) |
| 4 | Crawl with `max_crawl_pages` set against step 3; keep the task_id | `seo_audit_start({ project_id, target_url, max_crawl_pages })` | YES (default 50, max 500) |
| 5 | Did the persisted lane deliver; empty = no crawl ran, not clean | `seo_list_audits`, `seo_audit_get` | YES, live since 2026-08-30 (section 1.2) |
| 6 | Once `crawl_progress` is finished: non-indexable pages with reasons, chains hop by hop, duplicate titles | `seo_research` `non-indexable`, `redirect-chains`, `duplicate-tags` (`target` = task_id) | YES; coverage = the cap |
| 7 | Index coverage batch 1, value-ordered: `indexing_state` (`BLOCKED_BY_HTTP_HEADER`, `BLOCKED_BY_META_TAG`) and `user_canonical` vs `google_canonical` on every result | `seo_gsc_index_coverage({ site_url, urls })` | YES, 50 URLs per call |
| 8 | Deep-dive any single URL that looks wrong | `seo_gsc_inspect_url` | YES (indexed snapshot only) |
| 9 | PRODUCTION response headers, home plus one per template family | the curl line in section 2, or the Search Console live test | **EXTERNAL** |
| 10 | Preview headers before deploy; grep the source for noindex emitters and wide matchers | `preview_http_get({ project_id, path, headers_only: true })`, `project_files_search` | YES (preview tier; hosted projects) |
| 11 | Canonical candidates from the crawl, declared canonical per template | `seo_research` `non-indexable` (target), `instant-page` (url) | YES |
| 12 | Canonicals across the rest of the set; validate the graph (to-redirect, to-noindex, to-404, chains, loops, cross-domain, host drift) | `web_crawl` rawHtml or `web_extract`, then your own pass | you build the graph; desktop crawler above ~1000 URLs |
| 13 | Redirect rules: depth and loops, `is_active: false` excluded, prefix and regex rules expanded | `project_redirects_list({ project_id })` + your own pass | YES (CloudFront rules only) |
| 14 | Hop count on live URLs the crawl missed (rule sources, backlinked URLs, migration sets) | the curl line in section 4 | **EXTERNAL** (`fetch_url` only sees chains over 5 hops) |
| 15 | Redirect fixes deployed, not just saved | `project_redirects_deploy({ project_id, tier })` | YES |
| 16 | Near-duplicates inside the crawl, one seed per template family (`url` required) | `seo_research` `duplicate-content` (target + url) | YES; coverage = the cap |
| 17 | Rendered word count per template family; phrase profile across the crawl | `seo_research` `instant-page` (url), `keyword-density` (target) | YES |
| 18 | Bodies for the sweep; word count bucketed; substitution test per family; similarity where inconclusive | `web_crawl` markdown with `onlyMainContent: true`, then your own pass | manual beyond steps 16 and 17 |
| 19 | Corroborate with Google; cannibalization, decay, E-E-A-T depth (empty = not computed); reconcile thin pages against demand | `seo_gsc_index_coverage`, `seo_cannibalization`, `seo_content_decay`, `seo_eeat_scores` (10 pages), `seo_gsc_top_pages`, `analytics_pages` | YES (cron tools need GSC and a Sunday run) |
| 20 | Orphans, click depth, link counts (static weekly scan; CMS links invisible), plus the crawler's rendered link rows | `seo_internal_links`, `seo_research` `internal-links` (target, paged by `search_after_token`) | YES (hosted projects) |
| 21 | Server logs (what Googlebot actually fetched) and the full Index Coverage census with URL lists | - | **EXTERNAL**: client log export (no log-file analyzer here) and the Search Console UI export |
| 22 | Reconcile the coverage block against every finding's denominator; list every EXTERNAL row and errored crawl action as findings | - | YES |
| 23 | Persist decisions, accepted exclusions, task_id and page cap; turn accepted findings into work | `memory_create`, `memory_update`, `seo_task_implement`, `seo_deliverable_save` | YES |

---

## 9. Reporting the gaps

A correct report often contains sentences like "this was not checked". Write them anyway, and write
them where they will be read: a "Not checked" section belongs immediately after the findings.

```
NOT CHECKED IN THIS AUDIT
  Production response headers (X-Robots-Tag): no Hiveku tool reads them on a live domain. GSC
    index coverage on 50 URLs showed no BLOCKED_BY_HTTP_HEADER, covering those 50 only.
  Redirect chains beyond the 200 crawled URLs: redirect-chains found 2 chains of 2 hops
    (flattened below); the 41 Hiveku rules add none; backlinked legacy URLs were not measured.
  Word count and similarity beyond the 100 crawled URLs (12 pct): all 9 template families are
    represented; the /blog archive is sampled at 4 of 612.
```

Three habits keep this honest: **never let a tool's silence become your conclusion** (an empty audit
list, an empty Sunday-cron table, a `results: []` from `duplicate-content` called without `url`, a
402 from a crawl action - each is "not computed", with the reason); **name the direction of your
bias** (a value-weighted sample overstates health; a count of exactly 100 means 100 or more); **log
the accepted exclusions** with `memory_create` ("the /legacy tree is intentionally noindexed") so
the next session does not rediscover them as findings.

A client can act on "I checked 50 of 847 URLs and here is what I found". A client cannot act on an
audit that quietly checked 4 pages and said "the site looks healthy". The first is a professional
answer. The second is the bug.
