# Stating Coverage: Say What You Actually Looked At

A cross-cutting convention. It applies to every audit, report, sweep, review, inventory and
"how are we doing on X" answer, in every skill, on every account.

Every tool name below was extracted from the MCP server source
(`hiveku-mcp-api-server/src/tools/*.ts`), which declares tools in two styles in the same
codebase (`name: 'tool_name'` and `"name": "tool_name"`). Every cap was read either from the
tool's own `inputSchema` or from the builder route behind it. Where the schema is silent and the
route sets a default, this file gives the route's number, because that is the one that runs.

---

## 1. The rule

**Any output that could be mistaken for exhaustive must state its scope: how many of how many,
sampled or complete, how the sample was chosen, and what was not looked at.**

"I checked 4 of 41 pages, chosen as the highest-traffic ones, and did not look at the other 37"
is a finding. "Here is your site audit" over the same 4 pages is a misrepresentation, even when
every single sentence in it is true. Nothing in the second version is a lie. The defect is the
missing sentence, not a wrong one.

This came out of a published review of a competing Claude SEO skill. The reviewer ran a full-site
audit and the failure was not a wrong answer, it was an unstated one: the skill examined 4 pages
out of roughly 40 and never said so. The sharpest line in the review was:

> there is no statement of coverage: which templates, how many URLs, was it the full set or a
> sample?

The same review found four things the audit never checked at all: `X-Robots-Tag` response
headers, canonical validity across the URL set, redirect-chain depth, and near-duplicate
detection on templated pages. Section 6 covers what Hiveku can and cannot do about each.

**This is the same defect class as every real production bug found in this codebase this week:
something that reports success while silently doing less than it claims.** A digest reporting
zero active campaigns while the account spent 200 dollars a day. A pacing report summing 51
phantom targets. A helpdesk reply recorded but never sent. An audit that samples 4 pages and
calls itself an audit is that exact shape. It is also the shape users notice, because they are
the ones who eventually count the pages.

---

## 2. Why this binds harder on an agent than on a human consultant

A human consultant who audits 4 pages hands over a document, and the client can see it is four
pages long. The sample is visible in the artifact.

**The user cannot see what this session did.** They see a request go in and a confident summary
come out. They cannot see that `limit` defaulted to 20, that the crawl budget was 50 pages, that
one call returned `truncated: true`, or that a loop stopped after the first page. An unstated
sample is indistinguishable from a full pass, so **silence reads as completeness.** The user has
no way to discount the claim, which means the burden of stating scope sits entirely on the
session.

Two consequences worth internalising:

- A coverage sentence is not a hedge and not an apology. It is load-bearing content, the same as
  the findings. Leaving it out removes information the reader needed.
- "I did not have enough calls to do the whole thing" is a completely acceptable report. "Here is
  the whole thing" over a fifth of it is not. The first costs you nothing.

---

## 3. Where it bites in Hiveku

Across the roughly 1,600-tool surface there are **on the order of 100 tools exposing a `page`,
`offset`, `cursor` or `start_row` parameter**, and **close to 90 whose `limit`-style parameter
carries no description at all**, so the server picks a number and never tells you which. Somewhere
north of 110 do document theirs. Those three figures were parsed before the 2026-08-27 expansion
added roughly 230 tools, so read them as floors. They are approximate on purpose: independent
parses of the same source land a few apart depending on whether `row_limit`, `scan_limit` and
`page_size` count as limits and where you put the boundary between two adjacent tool objects. The
proportion is the point, not the digits. If you call something in that undocumented middle group
and report the result as complete, you are guessing.

### 3a. The one that most resembles the reviewed failure

`seo_audit_start` takes `max_crawl_pages`, and its schema documents no default. The route
(`/api/olympus/seo/audits`) resolves it as `Math.min(500, Math.max(1, Number(body.max_crawl_pages)
|| 50))`. So:

- **Default crawl budget is 50 pages. Hard ceiling is 500.**
- Point it at a 400-page site with no argument and it crawls 50, then reports an audit. That is
  the reviewer's "4 of 40" defect shipped as a default.
- `seo_run_audit` hits the same route but **declares no `bodyParams` at all**, so it cannot carry
  `max_crawl_pages`. Use `seo_audit_start` whenever the crawl budget matters.
- The fix is free: the start response echoes `data.max_crawl_pages`. Read it and put it in your
  summary. Pair it with the site's real page count from `seo_gsc_list_sitemaps` plus
  `seo_gsc_get_sitemap`, and you have "50 of 412" instead of "your audit".
- Reading results back, `seo_audit_list` defaults to `limit` 20 with a cap of 50, and returns
  `pagination: { page, limit, total, total_pages }`. Use `total`, not the length of what you got.

### 3b. Tools that document their cap (believe the description)

| Tool | Cap as declared |
| --- | --- |
| `seo_gsc_index_coverage` | **50 URLs per call.** Fans out URL Inspection per URL; split larger sets into batches |
| `seo_gsc_search_analytics` | Up to **25000 rows** per call; paginate with `start_row` |
| `ppc_search_terms_report` | `days` default **28** (1-365), `limit` default **1000** (1-10000) |
| `ppc_bing_search_terms_report` | `days` default **30** (1-365); `limit` caps returned rows only. `zero_conversions_only` and `min_spend` narrow server-side and combine as AND; with either set, RAISE `limit` |
| `ppc_bing_audience_list` | `limit` default **25**, max **200**, plus `offset`. Filters: `name_contains`, `audience_types` |
| `ppc_bing_ad_extension_list` | `limit` default **200**, ceiling **1000**, plus `offset`. Microsoft's 100-ids-per-call cap is chunked internally, so do NOT page for the 100 |
| `ppc_change_history` | `days` default **7**, **max 30** (a Google API limit, not ours); `limit` default 200, max 10000 |
| `ppc_keyword_list` | `days` default 30, `limit` default **1000** (1-10000) |
| `ppc_period_comparison` | per-period `limit` default **500**, max 10000 |
| `marketing_form_conversion_audit` | `scan_limit` 1-20000, default **5000**; when `totals.truncated` is true **every count is a sample** |
| `marketing_call_attribution_list` | `limit` default 50 / max 200; breakdown percentages cover up to **5000 scanned calls**, `totals.truncated` flags the overflow and `totals.calls_matching` is the uncapped count |
| `crm_list_sequence_enrollments` | `limit` default 50 / max 200, `cursor` is an enrollment UUID |
| `crm_contact_touch_history` | `days` default 90 / max 365, `limit` default 100 / max 500 |
| `project_files_bulk_get` | per-file **1MB** (oversized files marked `truncated`, refetch with `project_file_get`), total payload **20MB**, response carries `partial: true` plus `next_cursor` |
| `project_test_build_log_get` | line cap **10000**, sets `truncated` |
| `web_crawl` | `limit` default **100**, `maxDepth` default **2** |
| `web_search` | `limit` default 10 |

`ppc_bing_search_terms_report` is the Microsoft-side twin of `ppc_search_terms_report`; a Google
`connection_id` on a Bing tool returns a wrong-platform error rather than an empty result, so an
empty report is not evidence of no search terms.

**The Microsoft reads are the family where a short answer most often means a stopped read, so each
one publishes what it covered. Quote those fields, not the row count.**

| Tool | The field that carries the coverage |
| --- | --- |
| `ppc_bing_search_terms_report` | `summary`, `total_rows` and `wasted_spend` always describe the **full** report, never the filtered slice. So `rows: []` on a filtered call is a filter miss (`filter.empty_reason`), never an account with no waste. `truncated` describes `rows[]` only, and is present even on the empty and `report_pending` responses |
| `ppc_bing_audience_list` | `audience_count` is THIS page, `total_count` the rows matching your filters, `total_on_account` every row the account returned before filtering, `truncated` / `next_offset` whether more matched rows remain. Microsoft ships its global in-market catalog to every account, so `total_on_account` near a thousand says nothing about what the client owns. `filter_gaps` names rows excluded from `total_count` because they could not be classified, which is not the same as failing the filter |
| `ppc_bing_ad_extension_list` | `extension_types_read` is the scope, so a zero means none of THOSE types. `truncated` / `next_offset` for more ids, `stopped_reason` when a wall-clock budget ended the chunk loop early, `null_entries` and `partial_errors` for what Microsoft would not return. `extension_count` counts what came back and can be below `ids_requested` |
| `ppc_bing_criterions_list` | `criterion_count` is **null** whenever `partial_read` is true, with `criterion_count_at_least` as the floor and `unreadable_criterion_types` naming the gap. `has_location_targeting` is tri-state: `false` only when both geo types were read cleanly, else `null` with `location_targeting_unknown_reason` |
| `ppc_bing_impression_share_report` | `summary.impression_share_coverage` (`share_measured` / `share_unmeasured` / `budget_unmeasured` / `rank_unmeasured`, plus `unmeasured_campaigns`). An empty `budget_limited` beside `budget_unmeasured > 0` is not a clean bill of health, and `avg_impression_share` is null when nothing was measured |
| `ppc_bing_conversion_goal_list` | `coverage`. When the account had to be enumerated through the UET-tag lane, App-install, offline and in-store goals cannot appear at all, so an empty list is a scoped read and not an empty account |

**One documented cap in this family is wrong, and it is the busiest tool in the set.**
`crm_list_contacts` describes `limit` as "Results per page (default 25)". The route
(`/api/olympus/crm/contacts`) actually runs `Math.min(100, Math.max(1, parseInt(searchParams.get('limit')
|| '50')))`. **The real default is 50 and the ceiling is 100**, so a session that trusts the
description writes "coverage: the first 25 contacts" while holding 50 rows. Use the route's
numbers. This is also the standing reminder that a description is a claim about the route, not the
route itself: when a number actually matters to a coverage sentence, the response is the arbiter,
and `crm_list_contacts` returns `{ data, total, page, limit }` with the `limit` it really applied.

### 3c. Tools that document nothing and default silently

These declare `page`/`limit` as a bare `{ type: 'number' }`. The number below is what the route
actually does. Asking for more than the cap does not error, it just returns the cap.

| Tool | Route default | Hard cap |
| --- | --- | --- |
| `seo_keywords_list` | `limit` 50, `page` 1 | 100 |
| `helpdesk_ticket_list` | `limit` 50, `page` 1 | 200 |
| `media_library_list` | `limit` 20, `page` 1 | 100 |
| `pm_tasks_list` | `limit` 100 | 200 |

Same undocumented shape, not individually route-verified here, on at least:
`seo_tracked_keywords_list`, `seo_backlinks_list`, `seo_backlink_opportunities`,
`seo_audit_list`, `marketing_content_list`, `workflow_runs_list`,
`voice_calls_list`, `kb_documents_list`, `content_list`, `social_list_posts`,
`customer_avatar_list`, `customer_journey_list`, `email_template_list`. Treat every one of them
as "returns a page, size unknown to me" and say so, or read the count off the response.

`seo_gsc_top_pages` belongs to the same undescribed-cap group but spells it differently: its only
size control is `row_limit: { type: 'number' }`, with **no `page` parameter at all**. So there is
no second page to ask for. Whatever one call returns is what you have, and the coverage sentence
has to say "the top N pages GSC returned", never "your pages".

Most of these routes do return an honest count. `seo_keywords_list`, `helpdesk_ticket_list` and
`seo_audit_list` all return `pagination: { page, limit, total, total_pages }`, and
`crm_list_contacts` returns `{ data, total, page, limit }` with `total` from a real
`prisma.count()`. **That is your coverage sentence, already computed. Read it.**

### 3d. `pm_tasks_list` was the trap in this family; it is fixed, and the response proves which one you got

Until 2026-08-26, `pm_tasks_list` declared a `page` parameter the route never read (`take` with no
`skip`), so `page: 2` returned the same first 100 rows as `page: 1`, and it returned
`total: tasks.length` — the length of the page it just built, not a count. A session could
"paginate through" 400 tasks, read the same 100 rows four times, see `total: 100` each time, and
report 400 tasks with confidence. Nothing errored.

Builder commit `f85150587` fixed the route (verified against the route source, 2026-08-28): `page`
is honoured via `skip = (page - 1) * limit`, and `total` comes from a real
`prisma.pm_tasks.count({ where })`, returned alongside `page`, `limit` and `total_pages`. So on a
current deploy, paginate normally and use `total` as your coverage sentence, exactly like the rest
of the family. The schema still documents nothing, so the route numbers in the 3c table (`limit`
default 100, cap 200) remain the ones that run.

The response tells you which route you are talking to, so read it rather than trusting this
paragraph's date: the fixed response carries `page`, `limit` and `total_pages`; the pre-fix
response carried only `data` and `total`. If those three fields are absent, you are on a pre-fix
deploy — do not paginate and do not trust `total`. Take one call at the 200 cap, narrow with
`project_id`, `status`, `section_id` or `milestone_id` and say which filters you used, and count
the ids you actually received, labelled as such.

### 3e. `fetch_url` hides two things you may be about to report on

Read from the route (`/api/olympus/research/fetch-url`), not the description:

- Body ceiling **200KB** (`MAX_BODY_BYTES = 200_000`), timeout **15s**. It does set `truncated`
  in the response, so this one is honest if you look at it.
- It follows redirects with `redirect: 'manual'` and `MAX_REDIRECTS = 5`, and it does build a
  `visited[]` chain. **`visited` is only returned on the error paths** (`network`, `bad_redirect`,
  `invalid_scheme`, `private_host_blocked`, `too_many_redirects`). On success the payload is
  `{ url, status, content_type, body, truncated, byte_count }`. A page reached after four hops
  is indistinguishable from one served directly.
- **Of the response headers, only `content-type` survives.** See section 6.

---

## 4. Copyable phrasing

Lift these. They are deliberately flat and short, and none of them are apologies.

**Stating coverage on a sampled pass:**

> Coverage: 50 of 412 pages, the crawl budget `seo_audit_start` defaults to. The 50 are whatever
> the crawler reached first, not a chosen sample, so template coverage is unknown. Raising it to
> the 500 cap would cover the whole site in one run if you want that.

> Coverage: all 87 open tickets in the account (`helpdesk_ticket_list` returned
> `pagination.total: 87`, and I read every page). Nothing was sampled.

> Coverage: the top 1000 search terms of the last 28 days, which is what
> `ppc_search_terms_report` returns by default. Long-tail waste below that cutoff is not in this
> report.

**Refusing to over-claim, before doing the work:**

> Doing this properly is about 40 calls: 412 URLs at 50 per call for index coverage, plus the
> per-page checks. I can run the whole thing, or check the 50 highest-traffic pages first and
> tell you whether the rest is worth it. Which do you want?

> `pm_tasks_list` came back with `total: 412, total_pages: 3` on the first call. I can read the
> other two pages and answer over the whole board, or answer now over the newest 200 and label it
> a sample. Which do you want?

**Reporting what was skipped, and why:**

> Not checked: `X-Robots-Tag` response headers (no Hiveku tool reads them, see below), canonical
> tags on the 362 pages outside the crawl budget, and redirect-chain depth. The first is a real
> gap, not an oversight, and I have given you the manual check.

> `totals.truncated` came back true on the form audit, so every count in the table above is a
> sample of 5000 scanned rows, not a total. Narrow the window to under 5000 rows if you need the
> counts to be exact.

---

## 5. The anti-pattern

**Quietly reducing scope to fit a limit, then reporting the reduced result as the answer.**

It shows up as any of these:

- Calling a list tool once, getting a page, and writing the summary as if that page were the set.
- Choosing 50 URLs for `seo_gsc_index_coverage` because that is one call, and describing the
  output as "your index coverage".
- Seeing `truncated: true`, `partial: true` or `totals.truncated` in a response and not carrying
  it into the summary. The tool told you. Passing that on is the entire job.
- Deciding a 40-call job is too many calls and doing 8, without saying so.

**If the full job needs 40 calls: say it needs 40 and ask, or do all 40 and say it took 40.**
Both are fine. The third option, doing 8 and presenting it as 40, is the only one that is not.

The tell that you are in the anti-pattern: you are about to write a summary sentence that would
be false if the reader knew your `limit`. Write the coverage sentence first, then the summary.
If the coverage sentence makes the summary embarrassing, the summary was wrong, not the
coverage sentence.

---

## 6. The four gaps the reviewer named, answered honestly for Hiveku

### `X-Robots-Tag` response headers: no tool. This is a real gap.

Verified against Google's own documentation: the `X-Robots-Tag` header and the `robots` meta tag
"have the same effect". **A `noindex` header deindexes a page exactly like the tag does.** An
audit that reads only the meta tag will report a healthy page while the entire site is
deindexed, and it will be confidently wrong.

Hiveku builds and deploys Next.js sites, which is precisely where this footgun lives: a header
set in `middleware.ts` or `next.config` applies to routes with perfectly clean HTML. The builder
itself does this in two places (`src/middleware.ts` and `src/lib/portal/middleware-portal.ts`
both set `X-Robots-Tag: noindex, nofollow`), so it is a pattern the codebase already uses.

**There is no Hiveku tool that reads response headers from a live public URL.** `X-Robots-Tag`
appears nowhere in `hiveku-mcp-api-server/src`, and `fetch_url` discards every response header
except `content-type`. Do not claim you checked it.

Real next steps, in order:

1. **Check the source, which you can do.** Pull the project with `project_files_bulk_get` and
   grep for `X-Robots-Tag`, `noindex`, `robots:` in `middleware.ts`, `next.config.*` and any
   `metadata` exports. This catches the deploy-wide case, which is the dangerous one.
2. **`preview_http_get` with `include_headers: true`** returns the raw headers, but only against
   localhost inside the running preview container. That validates the app's own header logic. It
   does not tell you what CloudFront or the deployed Lambda returns in prod, so do not present it
   as a production check.
3. **Hand the user one command** for the live URL: `curl -sSI https://example.com/page`. Tell
   them what a bad answer looks like (any `x-robots-tag` line containing `noindex`).

### Canonical validity across the URL set: partial, capped at 50 per call.

No tool evaluates canonicals directly. The closest real signal is `seo_gsc_index_coverage`, which
buckets each URL by Google's `coverage_state`, and one of those buckets is
**"Duplicate without user-selected canonical"**. That is Google's own verdict on your canonical
tags, which is better than parsing the HTML yourself. It is capped at 50 URLs per call, so state
your batch count. `seo_gsc_inspect_url` gives the same depth for a single URL.

### Redirect-chain depth: no tool measures it live.

`fetch_url` follows up to 5 hops and, as covered in 3e, hides the chain on success.
`project_redirects_list` shows the redirects **configured** on a Hiveku-deployed project, which
is the config and not the observed chain, and it says nothing about redirects added by a CDN, a
host, or a `middleware.ts` rewrite. If chain depth matters, give the user
`curl -sSIL -w '%{num_redirects}\n' -o /dev/null <url>` and say why you cannot run it yourself.

### Near-duplicate detection on templated pages: no tool.

Nothing in the surface does content similarity. If it matters, `web_crawl` (default `limit` 100,
`maxDepth` 2, so raise both deliberately and state what you set) will pull the bodies and you can
compare them yourself. Say that is what you did, and say how many pages you compared.

---

## 7. The check before you send

One question, asked of your own draft:

**If the user could see every tool call this session made, would any sentence in this summary
embarrass me?**

If yes, the missing sentence is a coverage sentence. Add it and send.
