# AEO - Answer Engine Optimization (operator manual)

## What this covers / when to load this

The deep manual behind the SEO skill's AEO lane. Load it for work on how the brand shows up inside
answers rather than blue links: Google AI Overviews, featured snippets and PAA, citation in ChatGPT /
Perplexity / Gemini / Claude answers, brand recognition and sentiment inside LLMs, entity resolution
in the Google Knowledge Graph, and the readiness layer (AI crawler access, JSON-LD, llms.txt) that
gates all of it. Not for the on-page work the findings turn into (references/on-page-optimization.md
and content-strategy.md), organic rank reporting (rankings-and-search-console.md) or report assembly
(reporting-and-delivery.md). SKILL.md is the overview; this is the manual it points to. Anything
outside the Availability table is a handoff, named as such.

## Availability

Cost classes: A = free DB read; write = free, confirm-gated; C = live SERP per keyword; G = LLM
Mentions, about $0.10 per keyword per engine; H = LLM-scored against a shared per-UTC-day budget.
A negative DataForSEO balance turns every metered call into a 402 with no per-tool warning.

| Tool | Status | Cost class | Note |
|---|---|---|---|
| `seo_aeo_readiness` | LIVE | free | homepage-only fetch; checks degrade to fail on a network error |
| `seo_entity_check` | LIVE | free | Knowledge Graph lookup, `query` required |
| `seo_aeo_audit_get` | LIVE | A | stored SERP-side results; `since` for incremental re-reads |
| `seo_aeo_audit_run` | LIVE | C | one SERP call per keyword, cap 25; `location_code` is a NUMBER |
| `seo_aeo_rankings_sync` | LIVE | G | one LLM Mentions call per keyword x engine; `location_code` is a STRING; `skip_sync: true` creates rows without spending |
| `seo_rankings_list` (= `seo_list_rankings`) | LIVE | A | reads the synced AI lanes back: `search_engine` `ai_overview`, `chatgpt`, `perplexity`, `claude`, `gemini`; `group_by_keyword: true` |
| `seo_aeo_brand_profile_get`, `seo_aeo_brand_profile_upsert` | LIVE | A / write | upsert is a FULL REPLACE (5.1) |
| `seo_aeo_brand_audit` | LIVE | H | 15-20 OpenRouter calls; refuses when the day's budget is spent |
| `seo_aeo_brand_audit_history` | LIVE | A | up to 100 prior runs, populated by the weekly sweep |
| `seo_schema_markup`, `seo_featured_snippets`, `seo_serp_features` | LIVE | A | detected vs suggested markup; winnable snippets; feature history |
| `seo_project_update` (`robots_txt_content`) | LIVE | write | a deploy-time fallback the code file beats; a real robots.txt ships through the code lane |
| `project_files_bulk_save`, `project_vcs_commit`, `deploy_site`, `pages_update` | LIVE | write | the code lane and the pages-model write; not all visible to a marketing-seo key |
| `fetch_url` | LIVE | free | verifies the live robots.txt, llms.txt and JSON-LD after a deploy |
| `seo_deliverable_save` | LIVE | write | persists the AEO baseline and monthly deliverable |
| `seo_llms_txt_generate` | LIVE | write | takes the WEBSITE project id, not the tracking project id; the code lane (`project_files_bulk_save` `public/llms.txt`, `project_vcs_commit`, `deploy_site`, `fetch_url`) remains the hand-written path |
| `seo_ai_visibility` | LIVE | A | one read for citation presence across engines and Google's answer surfaces; `seo_aeo_audit_get` plus `seo_rankings_list` on the AI lanes is the assembled cross-check |

## 0. Doctrine for this lane

- `account_context_get({ domain: 'seo' })` before any strategy, brand-profile edit, or answer copy.
  The brand profile you write must match the positioning in account context, not your paraphrase.
  Re-read its instructions field before every `talk_to_department` call.
- Read local first (`hiveku-data/aeo/*.json`, `hiveku-data/seo/*.json`), then the free reads
  (`seo_aeo_audit_get`, `seo_aeo_readiness`, `seo_aeo_brand_audit_history`, `seo_entity_check`,
  `seo_schema_markup`, `seo_featured_snippets`), then pay. Only three spend money:
  `seo_aeo_audit_run` (one DataForSEO SERP call per keyword), `seo_aeo_rankings_sync` (one LLM
  Mentions call per keyword x engine), `seo_aeo_brand_audit` (15-20 OpenRouter calls against a
  shared per-UTC-day budget).
- Confirm every write and paid run: state keyword count, engines, estimated calls and what gets
  persisted, then wait for a yes. `seo_aeo_brand_profile_upsert` is destructive (5.1), so never
  bundle a profile change and an audit run into one confirmation.

## 1. Decision frameworks

### 1.1 The four gates (diagnose in order, never skip upward)

1. **Access.** Can AI crawlers fetch the site? `seo_aeo_readiness`. With GPTBot / ClaudeBot /
   PerplexityBot / Google-Extended blocked, a citation audit measures a site the engines cannot read.
2. **Entity.** Does the brand resolve to a thing rather than a string? `seo_entity_check`. No
   Knowledge Graph entity means it cannot be disambiguated or kept accurate, and that absence is
   itself the headline finding.
3. **Evidence.** Content shaped like an answer, with structured data around it? `seo_schema_markup`,
   `seo_featured_snippets`, Play E.
4. **Presence.** Is the brand cited? `seo_aeo_audit_run` / `seo_aeo_audit_get` for Google's answer
   surfaces, `seo_aeo_brand_audit` for what LLMs say unprompted, `seo_aeo_rankings_sync` for tracked
   AI positions.

Never schedule gate-4 work while gate 1 fails: a client paying for AI Overview citations while
robots.txt blocks GPTBot is billed for nothing.

### 1.2 Two scoreboards, two questions

SERP-side (`seo_aeo_audit_run` / `seo_aeo_audit_get` / `seo_featured_snippets`): for queries typed
into Google, is this domain cited in the AI Overview, snippet, or PAA? Moves with content and schema
on specific URLs, in weeks. Brand-side (`seo_aeo_brand_audit` / `seo_aeo_brand_audit_history`): asked
about the brand or its category, what does an LLM say and is the brand named at all? Moves with the
whole web's corpus, in quarters. Conflating them is the most common way an AEO update becomes
fiction.

### 1.3 Citation opportunity scoring

Score each keyword row from `seo_aeo_audit_get`. The cheapest citations sit where the page already
ranks and the answer box already exists.

```
tier 1  has_ai_overview true, domain_in_ai_overview false,
        domain_organic_position 1-10
        -> already trusted for the query and passed over. Format problem,
           not authority problem. Fix this sprint.
tier 2  same, domain_organic_position 11-20
        -> answer-block rewrite plus internal links. Fix this month.
tier 3  has_featured_snippet true, domain_in_featured_snippet false,
        domain_organic_position 1-10 -> snippet capture, format to type.
tier 4  domain_in_people_also_ask false, people_also_ask_count >= 3
        -> Q&A block covering the PAA questions verbatim.
tier 5  has_ai_overview true, no organic position -> content and authority
        project. Route to content-strategy and link-building, NOT an AEO fix.
```

Break ties with `ai_overview_reference_count`: 3-5 is a shallow, contestable overview; 15+ is
entrenched consensus, a quarter of work rather than a sprint.

### 1.4 Where the brand-audit points live

`seo_aeo_brand_audit` scores each provider 0-100 on a fixed rubric: `brand_recognition` 0-20 (knows
the brand, with depth and no hallucination), `market_score` 0-10 (placed in its category when asked
directly), `presence_quality` 0-20 (right domain, right offerings, current facts), `brand_sentiment`
0-40 (tone and framing), `share_of_voice` 0-10 (unaided category answers naming the brand). Sentiment
is 40 percent of the score, so correcting negative or lopsided framing is the biggest lever. But
recognition gates everything: when `evidence.knows_brand` is false, sentiment and quality are noise
and the only real work is getting the brand into the corpus.

## 2. The plays

### Play A - Readiness gate (free; new engagement, month-1, any deploy, any unexplained drop)

**Chain:** `account_context_get({ domain: 'seo' })` -> `seo_aeo_readiness({ domain: 'acme.com' })`.
**Read out:** `score` 0-100; `checks[]` (id, status pass/warn/fail, message); `crawlers[]` per-bot
status allowed / blocked / unspecified plus `via` (bot group, wildcard, none); `jsonLd`
`{ count, types }`. Weights, pass full / warn half / fail zero: `ai_crawlers` 25, `json_ld` 20,
`llms_txt` 15, `sitemap` 15, `title_meta` 15, `h1` 10, which is also the priority order.
**Decision:** thresholds in section 3. **Closing write:** one `pm_tasks_create` per failing check,
naming the file (robots.txt, llms.txt, homepage template) and the directive to add. Where each fix
ships: **llms.txt** is generated with `seo_llms_txt_generate` (Availability; WEBSITE project id),
or hand-drafted from the sitemap and the top pages, `project_files_bulk_save` as `public/llms.txt`,
`project_vcs_commit`, `deploy_site` after approval. **robots.txt**: `seo_project_update({
robots_txt_content })` only fills in at the next deploy, and only where the code ships no robots
source, so a crawler directive ships as
`public/robots.txt` through the same code lane and is proven with `fetch_url` on the live URL
(a client stays billed for AI visibility while GPTBot is still blocked otherwise). **JSON-LD,
title/meta, H1** ship through the code lane or `pages_update` per references/on-page-optimization.md
section 1. Never change crawler access without the client's decision (5.4).

### Play B - Entity resolution

**Trigger:** month-1; rename, merger, new market; brand-audit recognition under 10.
**Chain:** `seo_entity_check({ query: '<Brand Name>', types: 'Organization,LocalBusiness',
limit: 10 })`, repeated for the founder if the brand leans on a person, and for each competitor.
**Read out:** per match `kg_id`, canonical name, `types`, description, `resultScore`. No match, or a
match that is clearly a different company, is the finding.
**Decision:** no entity means the brand is a string, not a citable source. Remedy is machine-readable
identity: Organization schema with `sameAs` pointing at profiles the Knowledge Graph already trusts,
`mainEntityOfPage` on the about page, and third-party coverage repeating one name-plus-domain pair.
`resultScore` versus competitors is a blunt relative signal, never a grade. Wrong company returned?
Narrow with `types: 'Organization'`; two close scores is real ambiguity, fixed by one consistent name
plus location plus domain everywhere, not by more content.
**Closing write:** `memory_create` the kg_id, canonical name and date; `pm_tasks_create` the schema
work.

### Play C - AI Overview citation audit

**Trigger:** month-1, then monthly on the priority set.
**Chain:**
1. `seo_aeo_audit_get({ domain, limit: 100 })` first. If `summary.checked_at` is inside the refresh
   window, stop and use it. Later re-reads are free too: add `since: '<ISO date>'`.
2. Pick the set: priority commercial and category terms, capped at 25. Every keyword is one paid
   SERP call. Confirm domain, list, count and location before spending.
3. `seo_aeo_audit_run({ domain: 'acme.com', keywords: [...], max_keywords: 25, location_code: 2840,
   language_code: 'en' })`. `location_code` is a **number** here (2840 US, 2826 UK, 2124 Canada).
   Leave `persist` at its default true so history accumulates; `persist: false` is a dry run.

**Read out:** `summary` = `keywords_analyzed`, `keywords_with_ai_overview`,
`keywords_with_featured_snippet`, `domain_in_ai_overviews`, `domain_in_featured_snippets`,
`aeo_readiness_pct`, `checked_at`. Per keyword: `has_ai_overview`, `has_featured_snippet`,
`people_also_ask_count`, `domain_in_ai_overview`, `domain_in_featured_snippet`,
`domain_in_people_also_ask`, `ai_overview_snippet`, `ai_overview_references`,
`ai_overview_reference_count`, `domain_organic_position`.
**Decision:** run the 1.3 tiering. Two headline client numbers: answer-layer coverage
(`keywords_with_ai_overview / keywords_analyzed`) and citation rate (`domain_in_ai_overviews /
keywords_with_ai_overview`). The gap that pays: `has_ai_overview` true and `domain_in_ai_overview`
false on a page that already ranks, fixed with schema plus an answer-first restructuring (Play E)
shipped through content-strategy.md. About one SERP call per keyword, so monthly on the priority
set only, never the whole tracked list.
**Closing write:** `pm_tasks_create` per tier-1 and tier-2 keyword naming the URL, current organic
position and required format; `memory_update` the baseline record.

### Play D - Displacement analysis (who is cited instead)

**Trigger:** every keyword with `has_ai_overview` true and `domain_in_ai_overview` false.
**Chain:** `seo_aeo_audit_get({ domain })`, free. Read `ai_overview_references` per gap keyword: up
to 20 entries of `{ source, domain, url, title }`, `ai_overview_reference_count` the uncapped total.
Tally cited domains across the gap set; anything on 3+ keywords is a citation incumbent. Then
`web_scrape` or `web_extract` two or three cited URLs for the format that earned the citation, and
`seo_entity_check` any incumbent brand you have not profiled.
**Decision:** publisher and directory incumbents mean placement plus a better on-site answer;
direct-competitor incumbents mean a displacement project on a quarterly horizon.
**Closing write:** `memory_create` the incumbent set with the date, as the baseline you show movement
against. Add competitor names to the brand profile only after confirming (5.1).

### Play E - Answer-block engineering

**Trigger:** tier-1 to tier-4 keywords from Play C.
**Chain:** `account_context_get({ domain: 'seo' })` for voice and claims policy;
`seo_featured_snippets({ project_id })` for the winnable-snippet list already computed for the
project scope SKILL.md established; `seo_aeo_audit_get` for `ai_overview_snippet`, the answer Google
considers correct today. Then `talk_to_department({ domain: 'seo', message })` carrying the query,
that snippet, the Play D sources and formats, the target URL and its organic position, and the output
shape. Human review, then the copy ships via the content-strategy and technical-seo lanes. No AEO
tool publishes a page.

**Format rules that earn citations:**
- Lead with a 40-60 word direct answer to the exact question, first paragraph under the H2, before
  any preamble, with the question verbatim as the H2 when the query is a question.
- Match the SERP's answer shape: a process query wants 4-8 ordered steps at 8-20 words each, a
  comparison wants a table, a definition wants one sentence plus one qualifier.
- Put every factual claim next to its source, date and a number. Answer engines quote specific,
  attributable, current statements over hedged prose.
- One question per block, a block answering three gets cited for none, and each `people_also_ask`
  question gets its own H3 on the same page.

**Closing write:** `pm_tasks_update` at brief, `pm_tasks_complete` only when the URL is live, and
`memory_update` the ship date so the next audit can attribute movement.

### Play F - Structured data pass

**Trigger:** `json_ld` failing or warning in Play A; a tier-1 gap; a new template.
**Chain:** `seo_schema_markup({ project_id })` for detected versus suggested markup, cross-checked
against `jsonLd.types` from `seo_aeo_readiness`, with `seo_entity_check` sourcing `kg_id` and the
official URL for `sameAs`.
**Decision:** priority order is Organization and WebSite on the homepage (the identity anchor), then
FAQPage or QAPage on the Play E blocks, then Article with a real author and dateModified, then
Product / Service / LocalBusiness on money pages, then BreadcrumbList. Never mark up an FAQ that is
not visible on the page. `seo_schema_markup` is a read; JSON-LD ships through the code lane
(`project_files_bulk_save`, `project_vcs_commit`, `deploy_site`) or `pages_update` per
references/on-page-optimization.md section 1, which also carries the templates and 2025
eligibility rules, so this playbook produces the spec and one `pm_tasks_create` per template,
never per page, and verifies with `fetch_url` after the deploy. When the two disagree, mind the
scope: `seo_aeo_readiness` reads only homepage HTML, and client-side-injected markup is invisible
to a plain fetch, which is itself a finding.

### Play G - Brand interrogation baseline

**Trigger:** month-1, and any material change to positioning, category or competitor set.
**Chain:**
1. `seo_aeo_brand_profile_get({})`. `{ profile: null }` means `seo_aeo_brand_audit` will 400 and the
   weekly sweep cron has been skipping the account, so no history exists to trend. That null is a
   finding in its own right.
2. `account_context_get({ domain: 'seo' })` for brand name, category phrasing and competitor set, and
   read the draft back verbatim before writing. `category` is the most consequential field: it is the
   phrase the engines are interrogated with, and "emergency plumber in Austin" versus "plumbing
   services" produces completely different share-of-voice numbers.
3. `seo_aeo_brand_profile_upsert({ brand_name, domain, category, industry, region, competitors })`.
   Full-replace: the first three are required every call, so carry forward what you are not changing.
   Max 10 competitors, each `{ name, domain? }`. Omit them on the first write, let the audit seed
   them, then curate.
4. Confirm the spend, then `seo_aeo_brand_audit({})`.

**Read out:** `overallAvg` (mean of provider overalls) and per provider (`openai`, `perplexity`,
`gemini`, `claude`) the `overall`, five `dimensions`, and `evidence`: `knows_brand`, `brand_summary`,
`sentiment_label`, `category_queries_run`, `category_mentions`, `competitors_mentioned`,
`inaccuracies`. A failed provider carries `error` and zeros, and drops out of `overallAvg`.
**Decision:** read `evidence.inaccuracies` first; a wrong claim about pricing, ownership, service
area or safety is a live business problem and outranks score work. Then use 1.4 to pick the lever,
then read `competitors_mentioned` against the profile list: names that are not in the profile are the
competitive set as the models see it, often not the set the client believes in.
**Closing write:** `memory_create` the baseline (date, overallAvg, per-provider overalls, provider
count, exact category string); `pm_tasks_create` one ticket per inaccuracy.
**Trending it, free:** `seo_aeo_brand_audit_history({ history: 12 })` returns the latest audit plus
up to 12 prior runs (default 12, max 100), populated by the weekly sweep cron. Read `overall_avg`
movement, per-provider `provider_scores` drift, `competitors_mentioned` churn, and whether ticketed
`inaccuracies` disappeared. Pay for a fresh audit only when the history is stale relative to
something you shipped.

### Play H - AI engine rank tracking

**Trigger:** a defined priority set worth tracking, usually 10-25 keywords.
**Chain:** create rows without spending via `seo_aeo_rankings_sync({ target_domain: 'acme.com',
keywords: [...], search_engines: ['ai_overview'], skip_sync: true })`, then confirm the spend and run
again without `skip_sync`. The tool's schema lists `ai_overview`, `chatgpt` and `perplexity`; the
tracker itself carries five AI lanes (`claude` and `gemini` too, created through `seo_track_keyword`
with that `search_engine`), so check the schema before passing an engine the sync does not list.
Argument that bites: `location_code` here is a **string** ("US") with a human-readable
`location_name` ("United States"), unlike `seo_aeo_audit_run` where it is the numeric code.
`device_type` is 'desktop' or 'mobile'.

**AI-lane tracking cost.** Every AI lane is about $0.10 per keyword per engine per check (class
G), against $0.003 for a scheduled organic check. 20 keywords across 3 engines is 60 paid calls
per sync, and a lane created with a recurring `check_frequency` keeps paying weekly. Confirm the
keyword count, the engine list and the resulting call count out loud before every sync, and
refuse "sync every keyword on every engine": a 200-keyword list on five engines is 1,000 calls.

**Read out:** per row, citation position, `ai_mentioned`, `mentions_count`, `ai_search_volume`.
**Read-back:** the synced rows are ordinary tracker lanes.
`seo_rankings_list({ search_engine: 'ai_overview' | 'chatgpt' | 'perplexity' | 'claude' | 'gemini',
group_by_keyword: true })` reads them; `pagination.total_groups` is the honest keyword count
(`total` counts lanes). Keywords created before the AI engines existed have NO AI lanes, so a blank
AI column means "not tracked", never "not ranking"; `previous_rank` only advances on a new check
day. Citation presence on Google's answer surfaces still comes from `seo_aeo_audit_get`; the single
cross-engine visibility read is `seo_ai_visibility` (Availability), with those two calls as the
assembled cross-check.
**Decision:** track only what you report on; 20 keywords monthly beats 200 once.

## 3. Thresholds and benchmarks

**Readiness (`seo_aeo_readiness`)**
- Under 50, or any `ai_crawlers` fail: blocker, no paid AEO work until fixed. 50-74: proceed,
  remediate same sprint. 75+: foundation acceptable.
- Any bot `blocked` is a same-day ticket; all bots blocked is a P1, since the site cannot appear in
  AI answers at all. `jsonLd.count` 0 on the homepage is always a ticket, worth 20 points.

**Citation (`seo_aeo_audit_get` summary)**
- Answer-layer coverage under 20 percent: thin answer layer, so AEO is a watch item and not a budget
  line, and you say so rather than sell into it. Above 60 percent: the answer layer is the category.
- Citation rate under 10 percent is a standing start; 10-30 percent is normal for a mid-authority
  site after one quarter; above 50 percent is strong.
- `aeo_readiness_pct` hits 100 only if the domain is cited in BOTH the AI Overview and the featured
  snippet for every keyword: the denominator is keywords x 2, so a brand cited in every AI Overview
  but holding no snippets scores 50. Never present it without that context.

**Brand audit (`seo_aeo_brand_audit`)**
- `overallAvg` under 30: invisible to LLMs, so the plan is entity plus third-party corpus on a
  two-to-three-quarter horizon. 30-55: known but thin, accuracy work pays. 55-75: solid, the
  remaining points are sentiment and share of voice. 75+: leading, defend.
- `brand_recognition` under 10 of 20: recognition gate failing, ignore sentiment strategy.
- `share_of_voice` under 3 of 10 while recognition is above 15: the models know the brand but never
  volunteer it in category answers. Category and comparison content problem.
- `sentiment_label` 'negative' or 'mixed' on two or more providers: escalate to the account owner
  before it reaches a report. That is a reputation conversation, not an SEO one.

**Movement windows,** stated in the plan up front: readiness fixes same day; schema and
answer-block rewrites on already-ranking pages 2-6 weeks; new answer content with no existing rank
3-6 months; brand-side movement one to three quarters, and only if the off-site corpus changes. Model
version changes can move brand-side numbers more than your work does, in either direction.

**Cadence:** `seo_aeo_audit_get` and the `seo_rankings_list` AI lanes weekly (both free);
`seo_aeo_readiness` (also after every deploy) and `seo_aeo_brand_audit_history` monthly;
`seo_aeo_audit_run` and `seo_aeo_rankings_sync` monthly; `seo_aeo_brand_audit` and
`seo_entity_check` quarterly.

## 4. Diagnosis

**4.1 Readiness 0, or every check failed.** Almost never real: checks degrade to `fail` on network
failure with a 5 second timeout, so "could not be fetched" means the fetch failed, not that the file
is missing. Confirm with `web_scrape` on `https://<domain>/robots.txt`; a WAF or bot wall does this
too, and the fix is an allowlist.

**4.2 `seo_aeo_audit_get` returns nothing.** In order: the domain string does not match what was
persisted (omit `domain` for the account-wide snapshot to see which strings exist); the only prior
run used `persist: false`; `since` is past the last `checked_at`; no audit ever ran. Only the last
justifies a paid run.

**4.3 `overall_avg` jumped and nothing shipped.** Failed providers score zero and are excluded from
`overallAvg`, so three providers averaging 60 becomes four averaging 48 the moment a fourth returns
from failure at 12. The average moved, the brand did not: always report per-provider overalls beside
it. Second cause: a provider-side model version change, which you footnote.

**4.4 Citation rate dropped with no content change.** `seo_aeo_readiness` first (a deploy may have
shipped a robots.txt or dropped JSON-LD), then per-keyword `seo_aeo_audit_get` to see whether
`has_ai_overview` itself flipped off (Google removing the overview is not a loss), then
`ai_overview_references` to see who replaced the brand. Only then is it content. Overviews are also
personalized and volatile, so never overturn stored data with one browser check.

## 5. Edge cases and failure modes

**5.1 `seo_aeo_brand_profile_upsert` is a full replace, not a patch.** The most dangerous write here:
`brand_name`, `domain` and `category` are required every call, and omitted optional fields (industry,
region, competitors) are replaced, not preserved. Always `seo_aeo_brand_profile_get` first, echo the
merged object, then write. Never loop it, and never change `category` without telling the client the
trend baseline resets. A silently rewritten category is the usual cause of an unexplained
share-of-voice collapse: check it against the baseline memory record before diagnosing.

**5.2 Do not present `perplexity` rankings-sync data as Perplexity.** That engine key currently
routes through Google, not a native Perplexity platform, so "Perplexity visibility" in a paid
deliverable is a false claim. Omit the engine or footnote the method.

**5.3 Do not rotate the audit keyword list.** Comparability needs the same keywords, `location_code`
and `language_code`; changing the list changes the denominator and every summary percentage. If it
must change, start a second baseline and report both series for one cycle. Likewise never exceed the
25-keyword cap to save a call (price a bigger set and split it), and never re-run a paid audit the
same day to "check" a result: it resamples a volatile surface, so a difference proves nothing.
Verify from the persisted row with `seo_aeo_audit_get`.

**5.4 Do not block or unblock AI crawlers on the client's behalf.** Allowing GPTBot and friends is a
business decision with licensing implications, and publishers block deliberately. Surface it, state
the tradeoff (blocking removes the brand from AI answers entirely), let them decide.

**5.5 Do not manufacture answer content that contradicts the brand.** Answer blocks are quoted
verbatim and stripped of context, so a hedge-free claim about pricing, results, guarantees or safety
becomes a liability when an LLM repeats it as fact. Check every block against the claims rules in
`account_context_get`; in regulated verticals human sign-off is mandatory.

**5.6 Do not audit a competitor by hijacking the profile.** One profile per account, so rewriting it
to a competitor destroys the client's config and trend. Use `competitors_mentioned` and
`share_of_voice` in the client's own audit, plus `seo_entity_check` and `web_search` / `web_scrape`.
There is no per-competitor brand-audit tool; say so rather than improvise.

**5.7 Budget refusals are a real response, not an error.** `seo_aeo_brand_audit` shares the
per-UTC-day budget the dashboard enforces and refuses when the day is spent. Note the UTC boundary
and retry tomorrow. Never retry in a loop, never report a refusal as a zero score.

## 6. Persistence and reporting

**Memory.** `memory_create` the durable facts: the AEO baseline (date, domain, keyword list,
`location_code`, full `summary`); the brand profile as written, especially the exact `category`
string and the date set; the brand-audit baseline (overallAvg, per-provider overalls, provider
count); the Knowledge Graph `kg_id` and `resultScore`; the Play D citation incumbents; and every
client decision on crawler access and licensing. `memory_update({ memory_id, content })` monthly numbers
so the record stays one entry, and `memory_list({ domain: "seo" })` first so you do not re-litigate a
settled category and so you have the body to resend: `memory_update` REPLACES the document, so sending
this month's numbers alone erases every earlier baseline.

**Tasks.** Every accepted finding becomes a `pm_tasks_create` naming the URL or template, the change,
and the movement window from section 3. `pm_tasks_update` at brief, `pm_tasks_complete` only when
the change is live and verified. An audit without tickets is a PDF, not a service. When unsure how a
surface is wired, `hiveku_docs_search` then `hiveku_docs_get`.

**Reporting.** Report tooling lives in the reporting-and-delivery reference; this playbook supplies
the content. Five parts: readiness score and trend with any failing check named; answer-layer
coverage, which frames everything below it; citation rate plus keywords gained and lost, each with
`domain_organic_position` so a format win reads differently from an authority win; brand-side
`overallAvg` with per-provider overalls beside it, the dimension that moved, and the inaccuracy list
with status; then what shipped and what is next. Every number must trace to a named tool call in this
file, a browser check or `web_search` figure is labelled a sample, and an integration that was down
or a provider that errored is stated rather than left for the average to carry.

## Tool index

AEO: `seo_aeo_readiness`, `seo_aeo_audit_run`, `seo_aeo_audit_get`, `seo_aeo_rankings_sync`,
`seo_aeo_brand_profile_get`, `seo_aeo_brand_profile_upsert`, `seo_aeo_brand_audit`,
`seo_aeo_brand_audit_history`, `seo_entity_check`, `seo_schema_markup`, `seo_featured_snippets`.
Cross-cutting: `account_context_get`, `talk_to_department`, `memory_list`, `memory_create`,
`memory_update`, `pm_tasks_create`, `pm_tasks_update`, `pm_tasks_complete`, `hiveku_docs_search`,
`hiveku_docs_get`, `web_search`, `web_scrape`, `web_extract`. Local: `hiveku-data/aeo|seo/*.json`.

Where each capability this lane needs actually lives, so the handoff is named and never implied:
**llms.txt** is `seo_llms_txt_generate` (Availability), with the code lane as the hand path
(`project_files_bulk_save` of `public/llms.txt`, `project_vcs_commit`, `deploy_site`, then
`fetch_url` to prove it serves).
**robots.txt**: `seo_project_update({ robots_txt_content })` is a deploy-time fallback the code
file beats; ship `public/robots.txt` through the code lane and verify with `fetch_url`. **JSON-LD and pages**: the
code lane or `pages_update`, per references/on-page-optimization.md section 1. **Deliverables**:
`seo_deliverable_save` (mechanics in reporting-and-delivery.md). **Synced AI ranking rows**:
`seo_rankings_list` on the AI-engine lanes (Play H). **Per-competitor brand audits**: none (5.6).
A tool outside the key's profile fails like a missing feature: say "not visible to this key".
