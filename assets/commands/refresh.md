---
description: "\"Which posts are losing traffic?\" / \"what should we refresh, merge or take down?\" / \"the Sunday task says refresh this post\" - the decision loop: the refresh queue by priority and the twelve-month prune list, one of five dispositions per piece (double down, refresh, rewrite, consolidate, prune) recorded on the row, the refresh brief before any rewrite, and a refresh that keeps the URL. A take-down is a confirmed unpublish that deletes nothing and stays live until the deploy."
argument-hint: "[content id, or a site host, or 'queue']"
---
Decision loop for $ARGUMENTS. Follow the **hiveku-content-agency** skill; load
`references/site-architecture-and-decay.md` (the decay columns, the refresh brief, the prune
list, the five dispositions) and `references/structure-and-conversion.md` (the SERP brief, the
read-only rule). Context: `account_context_get({ domain: "content" })`; `memory_list({ domain:
"seo" })` for the money pages and the pages declared protected. The rule: a refresh keeps the
URL, a prune keeps the redirect, and a zero the collector could not measure is not a zero.
1. **Instruments first.** `content_list({ limit: 200 })` and keep the rows whose `decay_status`
   is set and not `recovered` (there is no server-side sort on the decay columns yet: order them
   by `refresh_priority` descending yourself and say so). A list with no decay columns set is
   NOT a healthy library until Search Console is connected and the Sunday runs have happened
   (`seo_content_decay` answers a note, not rows) - report "not yet analysed", never "no decay".
2. **The queue.** One line per decaying piece: title, URL, `refresh_priority` (3xxx severe, 2xxx
   moderate, 1xxx mild; the remainder is clicks lost), the top three of `top_declining_keywords`
   by `clicks_lost`, `review_disposition` as recorded, `refreshed_at`. Then the prune list:
   `content_prune_candidates({ project_id?, min_age_days: 365 })` - `candidates[]` with
   `measured_by`, `suggested_disposition` and `consolidate_into`; `unmeasured[]` on its own line
   with the reason (`no_page`, `clickhouse_unavailable`) and never as a candidate; `warnings[]`
   verbatim when items were measured through the views lookup; `counts.excluded_money_pages`
   named. A money page, a protected page and a page the owner named are never on the prune list
   you present.
3. **The brief per piece.** For each piece under decision, `content_refresh_brief_get({
   content_id })` - spends nothing: what declined (`decay`), the `declining_keywords`, the stored
   `serp_brief` (or none), the `scorecard` (leads, not views - a piece with leads and falling
   views is a distribution problem, not a prune), `keyword_siblings` and `cannibalization`
   (consolidate, never refresh, when another page holds the keyword), `link_donors` (newer pieces
   that should link this one), `suggested_disposition` and the `checklist`. Read the `markdown`
   out loud to the operator; it is the same brief the Sunday run filed as the "Refresh: <title>"
   PM task (`pm_tasks_list` finds it by that title).
4. **STOP: one disposition per piece.** `double_down` (a top performer that is not decaying: a
   new title test, the social set again, links from every newer donor), `refresh` (position 5-20
   with declining clicks: the highest-ROI action there is), `rewrite` (severe decay, current
   traffic a quarter of peak or less, thin or off-intent: the same URL, the body replaced),
   `consolidate` (a sibling holds the keyword: the stronger page absorbs, the loser redirects),
   `prune` (a year old, zero views and zero leads, measured). The operator decides; you propose
   with the brief's evidence beside each. Then record every decision with `content_update({
   content_id, review_disposition })` - the one decay-side column a session writes; `decay_status`,
   `refresh_priority`, `top_declining_keywords` and `refreshed_at` are read-only (400
   `read_only_field`) and never worked around.
5. **The refresh (and the rewrite), on the SAME URL.** `content_version_create({ content_id })`
   FIRST - the only undo. `content_brief_build({ content_id })` when the brief carries no
   `serp_brief` or its outlines are older than the decline [SPENDS: one SERP read plus three
   page parses against the research cap; say so]; cover every declining query on the page; close
   the gaps against the top-3 outlines; update every dated fact from a page read this session;
   rewrite the title against the current SERP (`content_titles_generate` then
   `content_titles_pick` - the old title already lost); add the links FROM the `link_donors`
   (each donor is its own `content_update`, by real URL) and up to the pillar
   (`content_site_links({ project_id, content_id })`); route the body through
   `talk_to_department({ domain: "content", message })`; `content_seo_check` until `result.ok`;
   then the Play 4 bridge on the SAME slug (never a new URL) on the owner's yes. The publish
   response's `refreshed: true` and the row's `refreshed_at` are the proof the refresh shipped -
   quote them.
6. **Consolidate.** The stronger page (`consolidate_into`, or the map's
   `recommended_primary_url` from `content_keyword_map`) absorbs what the loser had that earned
   clicks (a Play 3 revision of THAT row, step 5), then `project_redirect_create` for the loser's
   URL to the winner (a 301, confirmed with both URLs shown) and `content_unpublish_from_site` on
   the loser. Never a take-down without its redirect; never the redirect before the winner covers
   the keyword.
7. **Prune.** Per named id, each confirmed: `content_unpublish_from_site({ content_id })` - it
   drafts the entry and deletes nothing, and NOTHING leaves the internet until the project
   deploys; say both, and `content_delete` is not this step. A pattern ("everything with zero
   views") is a query, not a target list - the candidates are shown with their evidence and the
   operator names ids. The memory note for this session: the dispositions recorded, the pieces
   refreshed with their URLs, what was consolidated into what; the Sunday run's "Refresh: <title>"
   task is closed with `pm_tasks_complete({ id, summary })` when the refresh shipped, and a
   consolidation or rewrite that outlives the session gets its own task.
8. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
