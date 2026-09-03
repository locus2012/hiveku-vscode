# Local SEO Operator Manual

## What this covers / when to load this

The deep manual behind the SEO skill's local lane: running Google Business Profile as a managed asset,
diagnosing local visibility, and operating reviews as a service line. Load it when the client has physical
locations or a service area, when the brief mentions GBP, Maps, the local pack, "near me" terms, listing
photos, the service menu, citations or reviews, or when local numbers moved and you must explain why.
Not for geo-keyword research (`keyword-research.md` Play 8), building location pages
(`content-strategy.md`), GBP post copy (the social lane) or report assembly
(`reporting-and-delivery.md`); the new-location launch recipe is in `references/seo-playbooks.md`.
SKILL.md says these tools exist; this file says what to read from each response, which number
triggers which action, what the data does not mean, and what will get a listing suspended.

## Availability

Cost classes: A = free DB read; write = free, two-step confirmed, publishes PUBLICLY; live = a
Google API call under a small per-location quota (once per location, never looped); C = live SERP
per request per location; I = one Business Listings search with a 24h cooldown.

| Tool | Status | Cost class | Note |
|---|---|---|---|
| `seo_gbp_overview`, `seo_gbp_listing`, `seo_gbp_insights`, `seo_gbp_reviews` | LIVE | A | cached snapshot on a 6-hour cron; over 26h old is stale, not fact |
| `seo_gbp_location`, `seo_gbp_attributes`, `seo_gbp_services`, `seo_gbp_media`, `seo_gbp_discover_locations` | LIVE | live | `gbp_quota_exceeded` = wait a minute; `gbp_quota_not_approved` = the Cloud project never passed review, waiting cannot help |
| `seo_gbp_location_update`, `seo_gbp_attributes_update`, `seo_gbp_services_update`, `seo_gbp_media_add`, `seo_gbp_media_delete`, `seo_gbp_review_reply`, `seo_gbp_review_reply_delete` | LIVE | write | all seven: first call previews with `requires_confirm: true`, identical call with `confirm: true` publishes |
| `seo_local_search_performance`, `seo_local_top_queries`, `seo_local_top_pages`, `seo_local_rank_changes`, `seo_local_rank_history`, `seo_local_compare_periods` | LIVE | A | account-scoped; every `days` you pass is HALVED into two windows |
| `seo_citations_get` | LIVE | A | the stored citation audit; `basis: 'no_signal'` = UNVERIFIED |
| `seo_citations_audit` | LIVE | I | 429 inside the cooldown returns the stored audit; no confirm step of its own |
| `business_data_business_listings_search` | LIVE | I-class per search | the engine behind `seo_citations_audit`: Google Maps business entities by category and location, NAP, rating, hours; a competitor's local footprint |
| `seo_research` | LIVE | C | actions `maps-serp` and `local-finder-serp` (one location code, not a grid), `gbp-locations`, `gbp-info`, `gbp-questions`, `gbp-reviews`, `yelp-reviews`, `trustpilot-reviews`, `tripadvisor-reviews` |
| `seo_serp_get` | LIVE | A | stored SERP rows (no writer today); the live SERP is `seo_research({ action: 'serp' })`, class C |
| `social_create_post` | LIVE | write | GBP posts, platform `google_business_profile`, through the social approval queue |
| `seo_track_keyword`, `seo_tracked_keywords_list`, `seo_tracked_keyword_delete` | LIVE | write / A | "keyword + city" and pack tracking; owned by keyword-research.md |
| `seo_connections_list`, `seo_connection_create`, `seo_connection_update` | LIVE | A / write | the GBP connect flow (section 1) |
| `seo_gbp_posts` | LIVE | A | READ of published posts per `connection_id`, `refresh`, `limit`; publishing stays on `social_create_post` |
| `seo_listings_get` | LIVE | A | the stored listings snapshot per `connection_id`; `seo_gbp_listing` remains the Listing Score and duplicate-status read |
| `seo_listings_scan` | LIVE | I | ask-gated; Listing Score plus the Google Maps footprint: duplicates, NAP drift; spends one Business Listings search, 24h cooldown; `seo_citations_audit` runs the same engine and cooldown |

---

## 1. Ground truth about this tool lane

**Two scopes that do not overlap.** `seo_gbp_*` is connection-scoped: `connection_id` is a GBP connection
UUID and one connection equals one Google location. `seo_local_*` is account-scoped: no `project_id`, no
`connection_id`, aggregating every synced Search Console and Bing row on the account, so in a two-brand
account `seo_local_top_queries` blends them with no filter. Only `seo_local_rank_history` accepts
`domain`; only `seo_local_rank_changes` returns `domain` per row.

**DB-only, free, call freely:** `seo_gbp_overview` (insights totals + trend, `days` default 30, plus
review count, average rating, unreplied count and the cached listing snapshot: cheapest single call, start
here), `seo_gbp_listing` (Listing Score + per-field breakdown, NAP block, verification and duplicate
status, `score_history`; omit `connection_id` for one row per connection), `seo_gbp_insights` (daily
`website_clicks`, `call_clicks`, `direction_requests`, `impressions_{desktop,mobile}_{maps,search}`,
`total_impressions`), `seo_gbp_reviews` (`rating`, `comment`, `reply`, `review_time`, `reviewer_name`,
`review_id`; unanswered means `reply` null or empty), `seo_citations_get` (the STORED citation-audit
snapshot: canonical NAP, `directories_found` / `consistent` / `inconsistent` with per-field diffs,
`missing_major` with per-directory `basis`, `audited_at`; omit `connection_id` for one row per active GBP
connection, `audit: null` = never audited), and every `seo_local_*` tool.

**Live Google calls, quota-limited:** `seo_gbp_location` (and it refreshes the cached snapshot, the
supported way to force it fresh), `seo_gbp_attributes`, `seo_gbp_services`, `seo_gbp_media`,
`seo_gbp_discover_locations`, and all **seven** write tools (`seo_gbp_location_update`,
`seo_gbp_attributes_update`, `seo_gbp_services_update`, `seo_gbp_media_add`, `seo_gbp_media_delete`,
`seo_gbp_review_reply`, `seo_gbp_review_reply_delete`). `seo_gbp_services` and `seo_gbp_media` are live
reads with no DB cache behind them, so treat them like the other live calls: once per location, not in a
loop. The cached snapshot refreshes on a six-hour cron: older than **26 hours** means four missed ticks,
stale not fact.

**Spends DataForSEO credits** (metered against the account's monthly SEO research cap, with NO confirm
step of its own, so you are the gate): `seo_citations_audit({ connection_id })`,
`business_data_business_listings_search` (the same engine called directly: business entities on
Google Maps by category, location and name, with NAP, rating, hours and reviews, which is how you
read a COMPETITOR's local footprint or a rival's citation count) and every `seo_research` action
named in this file. Confirm the spend with the human before calling.

**Data sources first.** `seo_connections_list` must show GBP plus GSC connected. If not, the connect
flow is `seo_connection_create` (platform `google_business_profile`, OAuth) then
`seo_gbp_discover_locations({ id })` then `seo_connection_update` with `gbp_account_id` and
`gbp_location_id`, then `seo_sync`. A connection without a bound location is empty, not broken.

**No tool in this lane.** GBP **posts** go through the social lane's approval queue or the dashboard:
publish via `social_create_post` with platform `google_business_profile`, or raise them with
`pm_tasks_create`, copy attached, and never claim you posted; read published posts back with
`seo_gbp_posts` (Availability). **Q&A**: readable via `seo_research({ action: 'gbp-questions' })`; ANSWERING has no
tool (Google retired the write API in November 2025) - raise answers as a dashboard task.
**Directory submission**: no submission tool exists anywhere, by design - `seo_citations_audit`
audits and never writes to a directory. **Geo-GRID rank maps** (a lattice of positions across many
points): none, do not imply otherwise; a single geo-located pack read at ONE location code is
`seo_research({ action: 'maps-serp' })` (Play L5). **Review requests**: none in MCP.
`marketing_testimonial_widget_create` and its siblings collect TESTIMONIALS for the client's own
site, not Google reviews; a review ask goes out on the client's communications rail (email or SMS)
with its own confirm - hand off, draft the ask if wanted, never send it from here.

**Local files first.** `hiveku-data/localseo/*.json` exports exactly these datasets: `connections.json`,
`top_queries.json` (90d, limit 200), `top_pages.json`, `rank_changes.json` (30d, min_drop 3),
`gbp_insights.json` (90 rows), `gbp_reviews.json` (100), plus the Bing sets. Orient there; go live for
anything you write against or the client sees.

**Context before strategy.** `account_context_get({ domain: 'seo' })` first, every time. What changes your
output locally: service area, the real business name (not the marketing name), brand voice for replies,
and any rule about who speaks publicly.

---

## 2. Decision frameworks

**Where the hour goes.** Google ranks local on relevance, distance and prominence, and you cannot move
distance. So: (1) **listing completeness and accuracy**, cheapest and fully under your control; (2)
**reviews**, prominence plus the biggest conversion lever regardless of rank; (3) **local pages and local
organic**, slower but the part that survives a competitor's proximity advantage. If a profile scores under
70 and week one went to city landing pages, the order was wrong.

### 2.1 Reading the Listing Score honestly

`seo_gbp_listing` returns 0-100 completeness over weighted fields. The weights, because you will be asked
to justify the order: primary category 15; address 12; phone 12; hours 12; business name 10; website 10;
description 10; additional categories 8; attributes 6; service area or storefront set 5. Category is the
strongest single local ranking input; missing hours loses every "open now" search outright; phone must
match the site (NAP); description is 750 characters of services plus service area.

Two honesty rules. An item whose data could not be fetched is marked `unknown` and is **renormalized out
of the denominator**, so 92 with attributes unknown is not 92 with attributes confirmed: read `items`,
never the headline alone. And the score measures completeness, not quality: a wrong primary category
scores a full 15 and wrecks the account.

**Bands:** below 70 triage this week and say so in the report. 70-89 close the gaps this sprint. 90+ audit
the *content* of the fields rather than their presence, and move budget to reviews and pages.

### 2.2 Is the drop real? Four gates before you escalate

1. **Data or world?** `seo_local_rank_changes` compares the recent half of the window against the prior
   half, so a three-day half on a keyword bouncing 4 to 8 manufactures a drop every other week. Widen the
   window first.
2. **Apples to apples?** Grouping is on domain and keyword only: `location_code` and `device` are
   **averaged together**, so a real mobile collapse can be half-masked by a flat desktop line and a "drop"
   can be pure mix shift. Read the raw `seo_local_rank_history` rows, which carry both per row.
3. **Two observations?** One weekly run showing 3 positions is a signal; two consecutive runs is a finding.
4. **Listing-side cause?** Check `seo_gbp_listing` for verification state, duplicate status and vanished
   fields first. A suspended or duplicate-merged listing looks exactly like a ranking drop from outside.

### 2.3 Which local keyword earns a tracked slot

Track what you report on: 20-40 terms for one location, not 300. What earns a slot: `service + city`
where the client actually sells that service, the bare service term at city-level location, and the two or
three "near me" variants with real volume. Skip county and state modifiers unless genuinely served, skip
brand-plus-city, and prune anything unmoved and unreported for two months with
`seo_tracked_keyword_delete`.

### 2.4 Multi-location triage

Above three locations, do not audit serially. `seo_gbp_listing({})` with no `connection_id` returns one
row per connection: sort by score ascending, work the bottom quartile, overlay `seo_gbp_overview` for
review and unreplied counts. One location at 62 with eleven unanswered reviews outranks four at 88. Report
per location; averaging hides the outlier losing the money. When a location is onboarded, looks bound to
the wrong branch, or the client counts more locations than the account shows,
`seo_gbp_discover_locations({ id })` (`id` = the connection UUID) lists every account and location that
authorization can see, with `location_id` and `location_title`. Binding is the connect flow in section 1;
discovery is quota-expensive and cached, so call it once.

---

## 3. The plays

### Play L1: Local baseline (pointer)

The first-session chain is `/hiveku:local` (commands/local.md), step for step: context, then the
free DB reads for every location (`seo_gbp_listing({})` with no `connection_id` for one row per
connection, `seo_gbp_overview` at 90 days, `seo_citations_get({})`), then the live reads once per
location (`seo_gbp_attributes`, `seo_gbp_media`, `seo_gbp_services`), then local organic at 90 days
with `seo_local_compare_periods({ days: 180 })` for a true 90-vs-90. It drives a ranked defect list
per location and closes with `memory_create` (connection ids and branches, canonical NAP exactly as
published, categories, service area, baseline Listing Score, review count and average rating with
the date) plus `pm_tasks_create` per accepted fix. Plays L2 to L10 are what each defect turns into.

### Play L2: Listing Score remediation

1. `seo_gbp_listing({ connection_id })`. Take `items` where `present` is false, sorted by `weight`
   descending. That order is the work order.
2. `seo_gbp_location({ connection_id })` for live current values. Never draft from the cached snapshot: it
   can be six hours behind and the client may have edited in the Google app yesterday.
3. Draft replacements. For a description, `talk_to_department({ domain: 'seo', message })` with services,
   service area and brand voice: about 750 characters, primary service and city inside the first 150 (the
   mobile truncation point), no offers or prices, which Google's guidelines forbid there.
4. Show the client the exact before-and-after per field. Written yes for `title`, `storefrontAddress` or
   `categories`.
5. `seo_gbp_location_update({ connection_id, updates })` with only the changed fields (including
   `specialHours` every holiday season: a listing showing open when the doors are locked earns 1-stars).
   The first call without `confirm` returns a preview and `requires_confirm: true` and touches nothing;
   repeat the identical call with `confirm: true` to publish.

**Argument shapes.** `updates` accepts only `title`, `phoneNumbers`, `profile`, `regularHours`,
`specialHours`, `categories`, `websiteUri`, `storefrontAddress`; unknown keys are rejected with a 400
rather than silently dropped, so a 400 means you invented a field name. `phoneNumbers` is `{ primaryPhone,
additionalPhones? }`, `profile` is `{ description }`, `categories` is `{ primaryCategory: { name:
'categories/gcid:...' } }`, `regularHours` is `{ periods: [{ openDay, openTime, closeDay, closeTime }] }`.
Only the keys you send change.

**Closes the loop:** `pm_tasks_complete`, and `memory_update` with the new values, the date, and the
pre-edit score so next month's report shows the `score_history` delta.

### Play L3: Attribute completeness sweep

Unset attributes are invisible to Google's filtered local searches. "Wheelchair accessible", "online
appointments", "veteran-owned": each is a filter chip that removes the business from a result set entirely
when unset. Usually the best visibility-per-effort ratio in the engagement.

1. `seo_gbp_attributes({ connection_id })`. `audit` for the completeness summary, `missing` for the gap
   list, `available` for the exact attribute ids valid for this category.
2. Split `missing` into "known from the site or brief" and "ask the client", and send the second as a
   questionnaire. **Never guess** an accessibility, payment or health-and-safety attribute. That split is
   the entire discipline of the play.
3. `seo_gbp_attributes_update({ connection_id, attributes })` with only the confirmed ones. Each entry is
   `{ name: 'attributes/<id>', values?: [...], repeatedEnumValue?: {...}, uriValues?: [...] }` using ids
   from step 1. Only the named attributes change, so send small. First call without `confirm` previews
   the names and count; repeat identically with `confirm: true`.

Under 50 percent of available attributes set is a report-line finding; above 80, stop chasing the tail.

### Play L4: Review operations

The part of local SEO clients feel. Run it as an SLA.

1. `seo_gbp_reviews({ connection_id, limit: 100 })`, or `seo_gbp_reviews({ connection_id, min_rating: 1,
   max_rating: 3, limit: 50 })` to isolate what needs a human today. Sort by `review_time` descending,
   then rating ascending. Where `reply` is already set, an owner answered: ask before overwriting them.
2. Triage each: **5-star with text** (short warm reply naming the service), **5-star bare** (very short,
   still reply), **3-4 star** (thank, name the gap, offer an offline channel), **1-2 star** (below).
3. Draft through `talk_to_department({ domain: 'seo', message })` in one batch with brand voice, then edit
   every one by hand. Batch drafting is efficient; batch publishing is not allowed.
4. Show the client the full draft set. Per-reply approval for 1 and 2 star.
5. `seo_gbp_review_reply({ connection_id, review_id, reply })` **one review at a time**. `review_id` is
   the bare id from step 1. The first call without `confirm` previews the reply, its length, the review
   and the connection; repeat identically with `confirm: true`. Max 4096 chars, and it **replaces** any
   existing owner reply.

**Negative review protocol.** Never argue, never confirm the reviewer's specifics where that implies a
private relationship (in regulated verticals a compliance breach, not a style choice), never offer
compensation publicly, never dispute facts in public. What works: acknowledge, state the standard the
business holds itself to, name a human and a direct channel. Under 60 words. The audience is the next
prospect, not the reviewer.

**`seo_gbp_review_reply_delete`** has one legitimate use: an owner reply that is factually wrong,
off-brand, or exposes private information. Same two-step confirm, and deletion is visible and effectively
permanent, so it needs client sign-off exactly as publishing does.

Under about 20 lifetime reviews a single 1-star moves the visible average by more than 0.1, so volume is
itself the defense. If the businesses holding the pack carry three to five times the review count, no
on-listing work closes that this quarter and the plan must say so rather than promise a pack position.
Get the pack holders' actual review counts before asserting that: `seo_research({ action: 'gbp-info',
domain })` (or `target` / `place_id`) returns a GBP snapshot - review count, rating, categories - for ANY
business, competitors included, and `seo_research({ action: 'gbp-locations', query, location_name })`
finds the pack holders in the first place. That is the evidence behind the rule; without it the claim is
a guess. Spends research credits.

**Off-Google reputation.** Play L4 is Google-only. Yelp, Trustpilot or Tripadvisor problems are read
with `seo_research({ action: 'yelp-reviews' | 'trustpilot-reviews' | 'tripadvisor-reviews' })`; brand
sentiment across the open web is `references/digital-pr-and-brand-mentions.md`. All READS, all spend
research credits: no reply tool exists for any non-Google platform, so the output is a report plus
`pm_tasks_create`, never a posted response.

**Closes the loop:** `pm_tasks_update` with counts replied and escalated; `memory_create` for standing
decisions (agreed template, escalation contact, topics off limits publicly).

### Play L5: Weekly local rank watch

1. `seo_local_rank_changes({ days: 28, min_drop: 2 })`. Defaults are `days: 7` / `min_drop: 3`; a 28-day
   window (two 14-day halves) is far less noisy and `min_drop: 2` catches pack-boundary movement a
   3-position floor hides. Read `drops[]`: `domain`, `keyword`, `previous`, `current`, `drop`, worst
   first.
2. For each drop clearing the 2.2 gates, `seo_local_rank_history({ keyword, domain, days: 90 })` and read
   raw rows: `location_code`, `device`, `position`, `ranking_url`, `serp_features`, `checked_at`. A changed
   `ranking_url` means Google swapped which page it ranks, a cannibalization or internal-linking problem
   rather than an authority one. A changed `serp_features` means a pack or AI overview appeared above you
   and pushed the organic result down with nothing wrong with the page.
3. If it is real and listing-side causes are ruled out, verify the live SERP via `seo_serp_get`. For a
   geo-located PACK position, `seo_research({ action: 'maps-serp', keyword, location_code, device })`
   returns the Google Maps SERP at that location code (`local-finder-serp` is the local-finder
   variation). It is a point-in-time read at ONE location code, not a grid, and it spends research
   credits - say both in the report. Then `seo_local_compare_periods({ days: 56, source: 'all' })` for
   28-vs-28 context.

**The blind spot to state out loud.** A drop is reported only when both halves have a position greater
than zero, so a keyword that fell out of the result set entirely, the worst outcome available, produces
**no row**. Cross-check `seo_tracked_keywords_list` against the keywords appearing in
`seo_local_rank_history`. Silence is not good news.

### Play L6: Local demand mapped to landing pages

1. `seo_local_top_queries({ days: 90, limit: 200, source: 'all' })` (`query`, `clicks`, `impressions`,
   `ctr`, `position`), then `seo_local_top_pages({ days: 90, limit: 200 })`, same metrics per `page`.
2. Segment queries by geo-modifier: bare service, service plus city, "near me", brand. The
   service-plus-city block is your page inventory requirement.
3. Where a city or service has real impressions and either no matching page or a page averaging worse than
   position 10, raise the page with `pm_tasks_create` and build it through `content-strategy.md`
   (never "generate 50 city pages": one page per place the client actually serves, with real
   substance, or it is thin content and next year's decay row).
4. Track the resulting terms in the keyword-research lane (`seo_track_keyword`). For pack tracking that
   tracker supports a local ranking type with the business name and a city-level location: set the actual
   city, not the national default, or the number you report is not the number customers see.

200+ impressions per 90 days at position 8-20 with CTR under 2 percent is a page-quality or
intent-mismatch problem worth a refresh; the same query with no page is a build. Under ~50 impressions per
90 days, a dedicated city page is not worth the thin-content risk.

### Play L7: GBP conversion audit

Impressions on a listing are not the deliverable. Actions are.

`seo_gbp_insights({ connection_id, since, until, limit: 180 })` for the daily series, or
`seo_gbp_overview({ connection_id, days: 90 })` for totals and trend in one cheap call. Then two numbers:
action rate = `(website_clicks + call_clicks + direction_requests) / total_impressions`, and the discovery
split = Maps impressions (`..._desktop_maps + ..._mobile_maps`) vs Search (`..._desktop_search +
..._mobile_search`).

Action rate under 1 percent with healthy impressions is a listing-content problem: weak or missing photos,
no description, a wrong primary category pulling irrelevant impressions, or missing hours. Maps-heavy means
proximity-driven discovery, so leverage sits in the listing and reviews; Search-heavy with high brand share
means the profile mostly serves people who already know the business and net-new growth must come from the
site. `direction_requests` for a storefront and `call_clicks` for a service business are the closest thing
to a conversion here: report those two, and report `website_clicks` against site analytics rather than as
traffic. Mobile-heavy impressions with low `call_clicks` almost always means the phone number is wrong or
badly routed: verify with `seo_gbp_location` first. When the verdict is "weak or missing photos", Play L8
is where you check and fix it.

### Play L8: GBP media audit

The photo half of the listing-content diagnosis in Play L7. Both tools here are **live** Google calls
with no DB cache, so one pass per location.

1. `seo_gbp_media({ connection_id, limit })` (`limit` 1-500, default 90 - galleries run to hundreds of
   photos). Each item returns `media_id` (the input to `seo_gbp_media_delete`), `category`, `format`,
   `googleUrl`/thumbnail, dimensions and view count, plus `total_media_item_count`.
2. Audit the gallery against the categories Google exposes: COVER, PROFILE, LOGO, EXTERIOR, INTERIOR,
   PRODUCT, AT_WORK, FOOD_AND_DRINK, MENU, COMMON_AREA, ROOMS, TEAMS, ADDITIONAL. Findings worth a report
   line: no COVER, no LOGO, no EXTERIOR (the shot customers use to recognize the building), a gallery
   whose newest item predates the last refit, and view counts concentrated on one stale photo.
3. `seo_gbp_media_add({ connection_id, source_url, category })` publishes a photo to the live public
   gallery. `source_url` must be **https**, resolve to a public host, and stay reachable until Google
   finishes ingesting it - a URL that 404s an hour later can leave the add half-done. **Photos only:
   videos are rejected.**
4. **The trap: COVER, PROFILE and LOGO REPLACE the listing's primary imagery instead of appending to the
   gallery**, and deleting one of those removes the primary imagery. Those three categories need explicit
   written client sign-off, exactly like a `title` edit. Everything else appends.
5. Two-step confirm on both writes. `seo_gbp_media_add` previews category, `source_url`, format and
   whether primary imagery is replaced (URL and category validation run at the preview, so a bad input
   fails before publish); `seo_gbp_media_delete` fetches the live item and previews category, format,
   `googleUrl`/thumbnail, create time and view count (a bad `media_id` fails here too). Repeat the
   identical call with `confirm: true` to apply. Deletion is permanent.

### Play L9: Service menu completeness

The service menu shows publicly on the listing and feeds Google's "services" local-search filters - the
same category of visibility lever as attributes (Play L3), and just as commonly empty.

1. `seo_gbp_services({ connection_id })` FIRST, always. Live Business Information read: `serviceItems`
   (structured and free-form) plus the location's `title`/`categories`, which you need to pick valid
   free-form category ids.
2. **`seo_gbp_services_update` is a FULL REPLACE, not a patch.** Every current service missing from
   `service_items` is REMOVED, and `service_items: []` removes ALL services. So: read the current list,
   echo the MERGED list back to the client, and send the COMPLETE list. A partial list silently deletes
   the rest of the menu.
3. Item shape: each entry carries EXACTLY ONE of `structuredServiceItem` (`{ serviceTypeId, description?
   }`, where `serviceTypeId` is a Google-defined service type for the location's category) or
   `freeFormServiceItem` (`{ category: 'gcid:...', label: { displayName, description?, languageCode? }
   }`), plus optional `price` (`{ currencyCode, units?, nanos? }`).
4. Two-step confirm, and its preview is a live diff: `current_count` / `new_count` / `added` / `removed` /
   `kept`. **Read `removed[]` before confirming** - that array is the whole safety net on this tool.
   Repeat the identical call with `confirm: true` to apply.

### Play L10: Citation and NAP consistency

1. `seo_citations_get({})` FIRST - free, DB-only, one row per active GBP connection. `audit: null` means
   that connection has never been audited. If a stored snapshot is recent enough for the question, stop
   here: it already carries canonical NAP, `directories_found`, `consistent`, `inconsistent` with
   per-field `their_value` vs `expected`, `missing_major`, and `audited_at`.
2. `seo_citations_audit({ connection_id })` only when the snapshot is stale or missing. It pulls canonical
   NAP from the synced GBP listing, runs ONE DataForSEO Business Listings search, diffs every listing
   attributable to the business (phone digits-only, address tokenized, name fuzzy) and checks a fixed
   major-directory list: Google, Yelp, Facebook, Bing Places, Apple Maps, BBB, Yellow Pages, Foursquare,
   and Tripadvisor where category-relevant.
3. **The engine.** That one search is `business_data_business_listings_search`: Google Maps business
   entities matching a name, category and location. So the audit sees what Google Maps aggregates,
   not each directory's own database, which is exactly why `basis` exists. Each `missing_major` entry
   carries `basis`: a value naming an in-app signal means the directory was checked and the listing
   was absent; `basis: 'no_signal'` means the audit had NO signal for that directory and presence is
   **UNVERIFIED**, never "not listed". Report it as unverified or verify by hand
   (`fetch_url` on the directory's search page). Calling the engine directly on a competitor's name
   returns their footprint and rating for the same credit.
4. Two more traps, both real: it **spends DataForSEO credits** against the account's monthly SEO
   research cap with **no confirm step**, so you are the gate; and a **24h server-side cooldown**
   returns 429 with `retry_at` plus the stored audit, which is not a failure - read the stored audit
   and report it as of `audited_at`.
5. It is AUDIT ONLY. It never writes to any directory, and no submission tool exists anywhere in Hiveku
   by design. The deliverable is the fix list plus `pm_tasks_create` per inconsistent listing, worst
   fields first (phone and address outrank a name variant). `seo_listings_scan` (ask-gated,
   Availability) adds the Listing Score plus Maps-footprint scan (duplicates, NAP drift), same
   engine and cooldown.

---

## 4. Thresholds quick reference

| Signal | Watch | Act |
|---|---|---|
| Listing Score | 70-89 | below 70 |
| Attributes set vs available | below 80 percent | below 50 percent |
| Unreplied reviews (SLA 24h for 1-2 star, 72h otherwise) | any | above 20 percent, or a 1-2 star past 24h |
| Average rating | 4.0-4.2 | below 4.0 (4.2-4.6 healthy, 4.7+ an asset) |
| New reviews per month | below 2 | zero for two consecutive months |
| GBP action rate | 1-2 percent | below 1 percent |
| Local rank drop | 2-3 positions, one observation | 3+ across two consecutive runs |
| Listing snapshot age | over 12 hours | over 26 hours, force a refresh |

---

## 5. Diagnosis: when the data looks wrong

- **The half-window trap.** `seo_local_compare_periods({ days: 30 })` compares the last 15 days against
  the 15 before, not 30 against 30, and `seo_local_rank_changes({ days: 7 })` is a 3-to-4-day comparison.
  **Pass double the period you want on both.** This one misreading has produced more wrong
  month-over-month narratives than anything else in this lane.
- **`seo_gbp_insights` returns nothing.** Is the connection bound to a location, or sitting in
  `needs_setup` with no `gbp_location_id`? Has a sync ever run? Insights are synced rows, not a live read,
  so a never-synced connection is empty rather than erroring. Confirm state, bind the location, run
  `seo_sync`, and only then conclude anything about visibility.
- **A live GBP call fails on quota.** Two failures, opposite responses. `gbp_quota_exceeded` means
  Google's small per-minute quota was hit: wait a minute, retry, stop looping live tools.
  `gbp_quota_not_approved` means Google reports a quota of literally zero because the Cloud project behind
  the connection never passed Google's one-time Business Profile API access review; waiting cannot help,
  the fix is reconnecting onto the approved app. Do not retry, and do not report it as an outage.
- **A connection reads as error.** Far more often unconfigured or stale-token than a broken API: check
  state and `last_error` first, and reconnect rather than escalate.
- **Listing Score dropped with no edits.** Check whether an item flipped to `unknown` rather than absent:
  a failed attributes fetch drops it from the denominator and shifts the score with no real-world change.
  Then check freshness: a 26-hour-plus snapshot may be a failed sync, not a changed listing. Force a
  refresh with `seo_gbp_location`.
- **Totals look impossibly large, or a blank query tops the list.** Rows in the synced metrics table carry
  several dimension signatures side by side (date-only, query, page, device, country), and summing across
  them multiplies clicks. The live tools pin one signature; an old export or a hand-rolled sum does not.
  Re-pull.
- **Average position moved but no keyword did.** `avg_position` is impression-weighted, so one
  high-impression page gaining or losing impressions moves the blend with no ranking change anywhere.
  Never report a blended average position without the per-keyword table beside it.
- **Rankings and reviews belong to another branch.** The connection is bound to the wrong
  `gbp_location_id`: run `seo_gbp_discover_locations` and compare `location_title` against expectation.

---

## 6. Edge cases and failure modes

- **Never keyword-stuff `title`.** "Plumber Dallas" appended to a business name is the most common cause
  of a hard suspension, which takes the client's local presence offline for weeks. Refuse and explain.
- **`storefrontAddress`, `title` and `categories` edits can trigger re-verification**, during which the
  listing can lose visibility. Never casual, never batched with cosmetic changes, never without written
  approval. Changing the primary category changes which searches the business appears in at all: evidence
  first (what do the pack holders use?), propose rather than apply.
- **The two-step confirm is not optional, and it covers all SEVEN writes** (Availability). Each
  returns `requires_confirm: true` with a preview first and publishes only on an identical repeat with
  `confirm: true`; there is no unlisted GBP write that publishes immediately. The previews differ and
  the differences are the point (each play above says what its preview shows; `removed[]` on
  `seo_gbp_services_update` and "primary imagery replaced" on `seo_gbp_media_add` are the two that
  save you). Read the preview: it catches a wrong `connection_id`, which on a multi-location account
  means publishing to the wrong branch.
- **Never loop a write tool across reviews, attributes or locations.** One reply, one confirm, one check:
  a batch published in seconds reads as automated to every human who sees it.
- **Do not present local rank tools as pack truth by default.** Ranking rows carry an organic or local
  type set at tracking time; without a local type and business name you are looking at organic positions,
  and calling those pack positions is a factual error. Nor average Listing Scores across locations in a
  report: that hides the failing location, the only one that matters.
- **Do not chase proximity.** If the client sits eight miles out and the pack is businesses two miles from
  centre, no listing work wins that pack. Say so in the plan, aim at service-plus-city organic and the
  packs the client is genuinely near, before the client sets the expectation for you.

---

## 7. Persistence and reporting

**Memory** (`memory_create` on the first run, then `memory_list({ domain: "seo" })` and
`memory_update({ memory_id, content })` with the merged body, because `memory_update` REPLACES the
document): durable facts and decisions only. Per location: connection
id and branch, canonical NAP exactly as published, categories, service area or storefront choice, agreed
review voice and escalation contact, the approval rule for listing edits, and each month's Listing Score
with its date. Record refusals too: a declined keyword-stuffed name should not be re-litigated next
session.

**PM tasks** (`pm_tasks_create`, `pm_tasks_update`, `pm_tasks_complete`): every listing fix, attribute
questionnaire, review escalation and local page to build, plus this lane's recurring items, at minimum a
weekly review sweep, a weekly rank watch, a monthly Listing Score check and an annual holiday-hours pass.
An audit without tickets is a PDF.

**The monthly local section**, built with the reporting-lane tools in
`references/reporting-and-delivery.md`: Listing Score vs last month per location from `score_history` with
the fixed fields named; GBP actions from `seo_gbp_overview` month over month and year over year; review
count, average, reply coverage percent; local organic from `seo_local_compare_periods` (double the `days`
you want per side) plus climbers and droppers from `seo_local_rank_changes`; photo count and gaps from
`seo_gbp_media` and service-menu count from `seo_gbp_services` when either changed this month; citation
consistency from the stored `seo_citations_get` snapshot with its `audited_at` date, reporting
`basis: 'no_signal'` directories as unverified rather than absent; work shipped from completed PM tasks
with URLs linked.

**Client reporting rules.** Lead with actions (calls, directions), not impressions. Show Listing Score as
a trend. State review coverage as a percentage and name the misses. Report ranks with the location and
device they were measured at, label any number that came from somewhere without a tool, and never report a
pack position you did not verify.
