# Forecasting and Seasonality - one method for the roadmap and the monthly report

## What this covers / when to load this

One forecasting method, used twice: the impact column on the strategy roadmap (what a
cluster is worth if the plan ships) and the seasonal framing in the monthly report (why
this month's number moved and what the same month last year says). Load it when a client
asks "what will this get us", when the roadmap needs an expected-value ordering, when a
monthly drop needs a YoY read, or when a forecast made months ago has to be reconciled
against what happened.

It does not cover keyword selection, clustering or priority scoring
(`keyword-research.md`, whose section 3.2 holds the SERP-feature haircut this file
multiplies by); separating a real ranking move from noise or an algorithm update
(`rankings-and-search-console.md`); or the CTR-by-position table, which lives in
`metered-research-suite.md` next to the tools that produce its inputs and is only
cross-referenced here.

## Availability

| Tool | Status | Cost | Note |
|---|---|---|---|
| `seo_ranking_predictions` | LIVE | A (free DB read) | args `domain`, `keyword` (contains), `risk_level` (high, medium, low), `max_confidence`, `page`, `limit` (max 100); linear trend extrapolation over rank-check history, computed Sundays; `confidence_score` = R-squared x 100; `backlinks_needed` and `requirements` NOT computed |
| `seo_gsc_time_series` | LIVE | A | `site_url`, `start`, `end`, `filters[]`; daily clicks, impressions, CTR, position; the YoY and seasonal-index source |
| `seo_gsc_period_comparison` | LIVE | A | `site_url`, `period_a`, `period_b` (each `start`, `end`); winners, losers, climbers, droppers |
| `seo_local_compare_periods` | LIVE | A | `days`, `source`; halves the window you pass (180 for a 90-vs-90) |
| `seo_tracked_keywords_list` | LIVE | A | tracking start dates for the history gate |
| `seo_rankings_list` | LIVE | A | `view: 'history'` per keyword; `group_by_keyword: true` for the honest keyword count |
| `keywords_data_google_trends_explore` | LIVE | B | relative 0-100 interest, up to five years; the seasonal-index source when GSC history is short |
| `keywords_data_google_trends_categories` | LIVE | utility | scope a Trends call to a category |
| `keywords_data_dataforseo_trends_explore` | LIVE | B | DataForSEO's own popularity index; a second opinion, never mixed with Google Trends in one chart |
| `keywords_data_dataforseo_trends_demography` | LIVE | B | age and gender split; directional only |
| `keywords_data_dataforseo_trends_subregion_interests` | LIVE | B | subregion popularity; the geo-share input |
| `dataforseo_labs_google_historical_keyword_data` | LIVE | B | monthly searches per keyword since August 2021; the per-keyword seasonal shape |
| `seo_research({ action: 'historical-search-volume' })` | LIVE | B | multi-year monthly volume, `keywords[]` |
| `seo_research({ action: 'keyword-trends' })` | LIVE | B | the keyword overview with its monthly-searches array (not Google Trends) |
| `seo_research({ action: 'google-trends-explore' })` | LIVE | B | Google Trends web interest; `date_from` and `date_to` together or neither |
| `memory_create`, `memory_update`, `memory_list` | LIVE | A | the forecast record |
| `seo_sheet_create_tab`, `seo_sheet_add_rows` | LIVE | A | the forecast tab |

Argument shapes for the Trends tools are not in this repo (they are proxied from the vendor
MCP service); check each tool's schema before the first call rather than guessing.

## Ground truth

- Monthly search volume is a 12-month average. A term doing 40,000 in December and 200 in
  July reports as a steady mid-volume keyword. Every forecast that does not apply a
  seasonal index is wrong twice a year, in opposite directions.
- Google Trends and the DataForSEO Trends tools return RELATIVE interest (0-100 against the
  peak in the window), never volume. They shape a seasonal index; they never enter the
  multiplication as a volume.
- GSC retains about 16 months. A 24-month seasonal index from GSC needs the month-1
  baseline that `rankings-and-search-console.md` tells you to archive in memory; without
  it, GSC gives you one year plus four months, which is not two cycles. Trends gives five
  years and `dataforseo_labs_google_historical_keyword_data` gives monthly searches since
  2021-08, so those carry the index when GSC cannot.
- GSC rows are dated in Pacific time with a roughly three-day final lag. A YoY window is 28
  complete days ending at least three days ago, against the same 28 calendar days a year
  earlier.
- `seo_ranking_predictions` is not a model of the market. It is a straight line through the
  last 120 days of rank checks for organic keywords with five or more checks spanning 21 or
  more days. It knows nothing about the plan, the budget, the SERP or the competitor. Its
  `confidence_score` is the fit of the line, not the probability of the outcome.
- The five ledgers (GSC, Bing, the tracker, vendor estimates, GA4) never sum. A forecast
  is built in one ledger's units (GSC clicks, or vendor volume x CTR) and reconciled
  against that same ledger later.

## Decision frameworks

**Which method.** Method A (tool-based) answers "where are the tracked keywords heading if
nothing changes". Method B (the hand-built band) answers "what is this cluster worth if the
plan ships". The roadmap needs B; the monthly report quotes A only as a trend note. Run both
where both are available; a disagreement over 2x between A's implied clicks and B's band
is a data problem to resolve, never a number to average.

**Method A gates** (house rules; label them as such when you show them):

| Gate | Threshold | If failed |
|---|---|---|
| history | keyword tracked 8+ weeks (`seo_tracked_keywords_list` start date) and the tool's own floor of 5 checks over 21 days | Method B only; say predictions are unavailable |
| fit | `confidence_score` 50 or above | quote as "trend unclear", never as a position |
| plausibility | predicted improvement of 15 or more positions inside 90 days | reject unless a funded plan is already shipping |
| entry | keyword has entered the top 50 at least once | reject; extrapolating from "not ranking" is noise |
| risk | `risk_level: 'high'` rows | list them as at-risk keywords in the report, never as forecasts |

**Method B, the hand-built band** (the one the client sees):

```
expected monthly clicks(m) = MSV x seasonal index(m) x CTR(target position) x feature factor x geo share
expected monthly value(m)  = expected clicks(m) x CVR x value per conversion
```

- MSV from `dataforseo_labs_google_keyword_overview` or
  `keywords_data_google_ads_search_volume` (name which; they differ).
- seasonal index(m) from the next section; 1.0 everywhere for a business with no season,
  and say that it is 1.0.
- CTR from the position table in `metered-research-suite.md` ("Thresholds and benchmarks");
  target position is the one the plan is funded to reach, not position 1 by default.
- feature factor from `keyword-research.md` section 3.2 (floor 0.35 after stacking).
- geo share: the fraction of a national keyword's volume inside the service area, from
  `keywords_data_dataforseo_trends_subregion_interests` or, when that is not defensible,
  the geo-modified keyword's own volume with geo share 1.0.
- CVR and value per conversion from the client's GA4 (`seo_ga4_report`, see
  `outcomes-and-measurement.md`) or the CRM; when the client has none, the benchmarks in
  `keyword-research.md` Play 6, labeled as benchmarks.

Present the result as a band, never a point: plus or minus 30 percent at 90 days, plus or
minus 50 percent at six months (house convention, stated in the deliverable), with the
assumption that the plan ships on time written next to it. Sum the band across the
keywords in a cluster, then across clusters; never sum across ledgers.

## The plays

### F1. Build the seasonal index

Once per client, refreshed yearly. Non-brand only; brand has its own season (edge cases).

1. Source, in preference order: 24+ months of GSC clicks (`seo_gsc_time_series` with the
   month-1 archived baseline, `filters` excluding the brand regex); failing that, five
   years of `keywords_data_google_trends_explore` on the three highest-volume cluster
   heads; failing that, `dataforseo_labs_google_historical_keyword_data` monthly searches
   since 2021-08 for the whole qualified universe, summed by month.
2. Aggregate to calendar months. For each month m, index(m) = mean of that month across
   the years available divided by the mean of all months. Two full cycles minimum; with one
   cycle, do not build the index from GSC, use Trends.
3. Sanity: the twelve indices average to 1.0; a peak month above 2.0 or a trough below 0.4
   is real in tax, education, retail, travel and home services and suspicious elsewhere.
   Check a suspicious one against a Trends read of the head term before using it.
4. Persist the twelve numbers, their source and the years covered (`memory_create`), and a
   dated tab (`seo_sheet_create_tab` named `"2026-08 Seasonal index (nonbrand)"`).

### F2. The roadmap impact column

For each cluster on the roadmap, after `keyword-research.md` has ordered it:

1. Method B per keyword at the funded target position, summed to the cluster, month by
   month over the plan horizon using index(m).
2. Method A where the cluster's keywords are already tracked and pass the gates: note
   agreement or disagreement.
3. Write the column as `6-month clicks band | 6-month value band | confidence` where
   confidence is `A+B agree`, `B only`, or `B only, thin volume` (any keyword whose MSV
   is under 10 contributes zero to the band and a note, never a guess).
4. Every input beside the row: MSV source, target position, feature factor, geo share,
   CVR source, index source. A roadmap row without its inputs cannot be defended in month 4.

### F3. YoY honesty in the monthly report

1. `seo_gsc_period_comparison` with `period_b` = the last 28 complete days and `period_a`
   = the same calendar days a year earlier, non-brand filtered; `seo_gsc_time_series` for
   the trend line across both windows. Bing via `seo_bing_period_comparison` as a second
   ledger, side by side.
2. Report MoM and YoY both, each with its window in days, and lead with YoY in a seasonal
   vertical. A month that is down 20 percent MoM and up 15 percent YoY in a season with
   index 0.7 is a growth month; say that in one sentence.
3. Reconcile last quarter's forecast against the same ledger it was built in: forecast
   band, actual, inside or outside the band, and the input that explains the miss (index,
   CTR, shipped late, SERP feature arrived). Never move the forecast after the fact; add a
   row.
4. When the YoY baseline has rolled off (property younger than 16 months, or no archived
   baseline), say "YoY not measurable yet, first available <month>" rather than
   substituting a vendor estimate.

### F4. The "what will this get us" answer for a single keyword

Method B for one keyword, both methods where tracked, one band, the timing window from
`keyword-research.md` section 3.3 next to it, and the inputs listed. Refuse the point
estimate even when asked for one; give the band and the midpoint labeled midpoint.

## Thresholds and benchmarks

| Item | Value | Label |
|---|---|---|
| band at 90 days | plus or minus 30 percent | house convention |
| band at 6 months | plus or minus 50 percent | house convention |
| A-vs-B disagreement worth stopping for | over 2x | house rule |
| minimum history for Method A | 8 weeks (tool floor: 5 checks over 21 days) | house rule over the tool's floor |
| minimum `confidence_score` to quote | 50 | house rule |
| seasonal index cycles | 2 full years | standard practice |
| YoY window | same 28 complete calendar days a year earlier | standard practice |
| GSC final lag | about 3 days | Google |
| GSC retention | about 16 months | Google |
| CVR benchmarks when the client has none | `keyword-research.md` Play 6 | benchmarks, never the client's numbers |

## Diagnosis: when the data looks wrong

| Symptom | Cause, in check order | Action |
|---|---|---|
| `seo_ranking_predictions` empty with a note | not enough history; only organic keywords qualify (AI lanes never do) | Method B; say when predictions arrive (a full quarter of tracking) |
| a prediction shows 30 positions of gain | linear extrapolation from a few early checks | fails the plausibility gate; do not quote |
| Trends series looks like volume | it is 0-100 relative interest | shape the index from it; never multiply it |
| seasonal index peak in an odd month | brand terms in the series, a one-off event (PR, an outage, a launch), Pacific-day boundary on a month edge | rebuild non-brand; check the event in memory; accept the index only if two cycles agree |
| YoY is down but every ranking is up | demand fell (index), a measurement artifact (property change, filter change), or an intent shift | `rankings-and-search-console.md` artifact ladder first, then the index, then intent |
| forecast band missed by more than 50 percent | plan shipped late, a SERP feature appeared, CTR assumed for position 1 | reconcile in the report row by row; the miss is a finding |
| `seo_local_compare_periods` windows look halved | they are; the tool halves what you pass | pass double |

## Edge cases and failure modes

- **New site, no history.** Method B only, at the target position the authority tier can
  win (the KD table in `metered-research-suite.md`), with the longer timing windows from
  `keyword-research.md` section 3.3; the band widens to plus or minus 50 percent at 90
  days, and say why.
- **No GSC history or no GSC connection.** Trends for the index, the tracker
  (`seo_rankings_list`) for position, vendor volume for MSV; the forecast is in vendor
  units and gets reconciled against GSC once it exists, never against a vendor estimate
  of our own traffic.
- **Brand versus non-brand.** Segment brand out with the regex `rankings-and-search-console.md`
  keeps in memory before building anything. Brand demand follows the client's marketing
  calendar, not the market's season; applying the non-brand index to brand terms produces a
  confident, wrong number. Never propose deprioritizing brand terms.
- **Zero-volume keywords that convert.** Emergency, hyper-local and new-category terms
  report zero MSV; they enter the band as zero with a note and enter the roadmap on
  serviceability and intent (`keyword-research.md`). Do not invent a volume to make the row
  look full.
- **Seasonal business in its off-season.** A forecast made in the trough that ignores the
  index promises the trough forever; one made at the peak promises the peak forever. Show
  twelve months, not one.
- **The client remembers the number.** A point estimate spoken aloud becomes a commitment.
  Band, inputs, date, every time.

## Persistence and reporting

- `memory_create` after any forecast shown to a client: inputs (MSV source, positions,
  feature factors, geo share, CVR source), the twelve index values with their source and
  years, the band, the date, the plan assumption. `memory_list({ domain: 'seo' })` first;
  `memory_update({ memory_id, content })` REPLACES the document, so resend the whole note
  with the addition folded in.
- A dated forecast tab per roadmap or report: `seo_sheet_create_tab` named
  `"2026-08 Forecast (nonbrand, US)"` with columns for cluster, MSV, target position, CTR,
  feature factor, geo share, index months, clicks band low, clicks band high, value band,
  confidence, inputs note; rows via `seo_sheet_add_rows`. Date-prefix the name; the tab is
  replace-by-name.
- `pm_tasks_create` for the reconciliation each quarter, so the month-4 conversation has a
  row waiting instead of a memory.
- In the report: the band, the ledger it is built in, the window, N keywords, what was
  excluded, and the reconciliation row for the last forecast. A forecast without its inputs
  is a promise; with them it is a method.
