---
description: "\"Our old posts don't get traffic anymore\" / \"two of our pages are fighting for the same search\" / \"which content should we refresh, merge or take down?\" - the decay and cannibalization sweep: the money pages from the stored page roles, the Sunday sweep's rows beside the item-side refresh queue and the twelve-month prune list, the cause test on each candidate, the refresh brief before any refresh draft, one of five dispositions per URL recorded on the row, and a consolidation's 301s through project_redirect_create on a confirmed list. Never refreshes a stable top-3 page, never deletes a page without a redirect, never lets a generated draft reach a live site unread."
argument-hint: "[domain or section, optional]"
---
Content decay sweep ($ARGUMENTS). Follow the **hiveku-seo-agency** skill; load
`references/content-strategy.md` (1.2 the five-way disposition, 1.6 the cause test, Plays C2 and C3).
Recipe 11 of `references/seo-playbooks.md` is the monthly sprint this feeds; the marketer's
`/hiveku:refresh` is the same decision loop run from the content side, and both record the decision
on the same column. The rule: a refresh keeps the URL, a take-down keeps its redirect, and a zero the
collector could not measure is not a zero.
1. Context: `account_context_get({ domain: "seo" })` and `memory_list({ domain: "seo" })` for the
   protected pages, the consolidation map already agreed and the intent verdicts. Money pages come
   from the stored roles, not from prose: `site_page_roles_get({ project_id })` (the website project
   UUID from `sites_list`, never a PM project) - `pages[]` with `page_role: "money"` are the pages
   every refresh links and no prune list may carry. `counts.money` of 0 means nothing is marked yet,
   not that there are none: `site_page_roles_set({ project_id, seed: true })` shows the suggestions
   with their `reason`, the owner confirms them, then `apply: true` writes the rows still unset
   [CONFIRM]. Keep writing the `Money pages: /a, /b` line to the SEO memory as well - the seed reads it.
2. Rows: `seo_content_decay({ project_id })` and `seo_cannibalization({ project_id })`. Both are
   account-scoped (the route ignores `project_id`), capped at the worst 30, and forward no filters:
   filter to this domain yourself. A `note` saying no analysis exists means NOT ANALYZED, never clean;
   `last_analyzed_at` older than 8 days means the sweep skipped the account; empty with GSC unconnected
   means "cannot see decay until this is fixed", plus a task. Copy `peak_traffic`, `current_traffic`,
   `traffic_decline_pct` and `top_declining_keywords` into your notes now: resolved rows self-delete
   on the next run. Then the item side of the same findings: `content_list({ status: "published",
   limit: 200 })` and keep the rows whose `decay_status` is set and not `recovered` (nor `resolved`,
   `refreshed`, `ignored`, `dismissed`), ordered by `refresh_priority` descending yourself (there is
   no server-side sort on the decay columns; say so). Those rows carry the `content_id`, `url`,
   `review_disposition` as recorded and `refreshed_at` the steps below need. A decay URL with no item
   is a hosted page: the brief tool cannot read it, so its disposition lives in the task and the
   memory only.
3. The prune lane: `content_prune_candidates({ project_id?, min_age_days: 365 })` - `candidates[]`
   with `measured_by`, `suggested_disposition` and `consolidate_into`; `unmeasured[]` on its own line
   with the reason (`no_page`, `clickhouse_unavailable`) and never as a candidate; `warnings[]`
   verbatim when items were measured through the views lookup; `counts.excluded_money_pages` named.
   A money page, a protected page and a page the owner named are never on the prune list you present.
4. Cannibalization FIRST (refreshing one of two competing pages just moves the split). Per finding,
   `seo_serp_get({ keyword })`: same intent, or two legitimate pages sharing a long-tail query?
   Consolidate onto `recommended_primary_url` only when neither page is stable in the top 5; if one
   clearly wins, leave it and retitle the loser toward its own intent.
5. The refresh brief before any refresh draft: per decay survivor with an item,
   `content_refresh_brief_get({ content_id })` - spends nothing: what declined (`decay`, with
   `peak_avg_position` and `current_avg_position`), the `declining_keywords` worst click loss first,
   the stored `serp_brief` (or none), the `scorecard` (leads, not views - a piece with leads and
   falling views is a distribution problem, not a prune), `keyword_siblings` and `cannibalization`
   (consolidate, never refresh, when another page holds the keyword), `link_donors`,
   `suggested_disposition` beside the `review_disposition` already recorded, and the `checklist`. It
   is the same brief the Sunday run filed as the "Refresh: <title>" PM task (`pm_tasks_list` finds
   it by that title).
6. Cause test per decay survivor: one `seo_serp_get` on the highest `clicks_lost` query (stale stored
   rows: `seo_research({ action: "serp", keyword, location_code, device: "mobile" })` [SPENDS - class
   C, one per page; say the count first]). Read `peak_avg_position` vs `current_avg_position`: flat with
   clicks down hard means the SERP changed around the page (layout shift, route to `/hiveku:aeo`);
   down 3 or more means it was beaten (staleness or displacement, a refresh). A different content type
   in the top 5 is an intent shift (rewrite, not refresh). A redeploy, noindex or vanished link block
   is self-inflicted: `/hiveku:seo-technical`, not copy.
7. Disposition per URL from the five-way table (leave / refresh / rewrite / consolidate / new), tier
   from the depth ladder, and the priority score `recoverable x confidence x business_value / effort`.
   A stable top-3 page is never in the cohort. Present the cohort [CONFIRM which URLs proceed], then
   record every decision on the row with `content_update({ content_id, review_disposition })` - the
   one decay-side column a session writes: `refresh` and `rewrite` as themselves, `consolidate` on
   the losing page, `prune` on a take-down from the prune lane, `double_down` on a stable top
   performer the owner wants more of. A leave that is seasonal or SERP-layout driven records nothing
   (say so), and new is a brief on a new row, never a disposition on the old one. `decay_status`,
   `refresh_priority`, `top_declining_keywords` and `refreshed_at` are read-only (400
   `read_only_field`) and never worked around.
8. Briefs and the refresh, on the SAME URL: `on_page_content_parsing({ url })` on the top 3 for the
   outline benchmark [SPENDS - class E, three per page], then `talk_to_department({ domain: "seo",
   message })` carrying the refresh brief's `markdown`, the declining-keyword table verbatim, peak vs
   current, the benchmark, internal-link targets from `seo_internal_links({ project_id })` and the
   `link_donors`, schema, tier and the voice rules. For a piece with an item: `content_version_create({
   content_id })` FIRST - the only undo - then the new body on the same row, `content_seo_check` until
   `result.ok`, and `content_publish_to_site` on the owner's yes (never a new slug: the publish
   response's `refreshed: true` and the row's `refreshed_at` are the proof the refresh shipped -
   quote them). For a hosted page without an item, persist the brief with `content_create` [CONFIRM].
   The client sees the brief before the draft and the draft before it ships; invented statistics are
   the standard failure, so nothing generated reaches a live page unread.
9. Consolidation: name every source URL, the target and the redirect type, then
   `project_redirect_create({ project_id: <website id>, from_path, to_path, status_code: 301,
   match_type: "exact" })` per losing URL [CONFIRM - each rule], `project_redirects_deploy({ project_id,
   tier })` [CONFIRM - nothing serves until this runs], verify with `fetch_url` (`data.url` equals the
   target in one hop), then `content_unpublish_from_site({ content_id })` on the losing item and
   re-point internal links through the write path `references/on-page-optimization.md` section 1
   assigns. Never delete a page: that throws away its links; never a take-down without its redirect.
   On a key that does not show the redirect tools (the marketing and marketing-seo profiles carry
   them; the ads, email and social sub-profiles do not), file the rules as a task, verbatim.
10. Prune: per named id from step 3, each confirmed: `content_unpublish_from_site({ content_id })` -
    it drafts the entry and deletes nothing, and NOTHING leaves the internet until the project deploys;
    say both, and `content_delete` is not this step. A pattern ("everything with zero views") is a
    query, not a target list: the candidates are shown with their evidence and the operator names ids.
    The redirect rule of step 9 applies to every pruned URL that ever earned a link.
11. Tasks: `pm_tasks_create({ project_id, title, description, task_type: "seo" })` per refresh and per
    consolidation, flat (never `parent_task_id`), with the before-numbers and the disposition in the
    body; the Sunday run's "Refresh: <title>" task is closed with `pm_tasks_complete({ id, summary })`
    when the refresh shipped. Memory: the consolidation map by read-merge-write so a future session
    does not rebuild a page you redirected.
12. Proof at 28 days: `seo_gsc_time_series({ site_url, start, end, filters: [{ dimension: "page",
    operator: "equals", expression: <url> }] })` beside the same call unfiltered (the site moving the
    same amount means you shipped nothing), `refreshed_at` on the row, and the decay row vanishing
    after the next sweep.
13. Honesty rules: a vanished row is not proof (rows also vanish below the 100-impression floor); the
    cohort is 30 rows at most and says so; recovery is quoted as the tier's band, never a promise; a
    failed read makes the sweep partial, never "no decay"; an `unmeasured` piece is never a zero.
14. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
