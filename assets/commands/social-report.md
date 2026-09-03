---
description: Social performance report - by platform, pillar, hook, format and persona, every number with its call and freshness line, and the client's own social report page shared by link.
---
Social report. Follow the **hiveku-social-agency** skill, and load its
`references/analytics-and-reporting.md` (the metric-source map and the honesty states) and
`references/connection-health-and-syncs.md` (the sync contracts and the freshness lines) before
quoting any number. No single tool returns "the period" - assemble it, and name the call behind every
figure:
1. Sync, roster and the window's rows FIRST. `social_analytics_sync` (no args; the whole account, only
   the versions that are due, 50 per run - repeat until it reports zero synced) and
   `social_post_sync_analytics({ post_id })` on any straggler; nothing downstream is current until this
   runs. A post published more than 90 days ago never syncs again (`sync_stopped`) - do not force it
   expecting movement. `social_list_accounts` for the connected-account ids and each row's honesty
   state: `connection_status`, `last_error`, `token_state`, `pending_selection` (a picker row is
   `not_connected`, not a platform), plus the top-level `quota.x` (`eligible`, `used`, `limit`,
   `remaining`) for the X line. A connection that broke mid-window is `partial`: report what was
   captured and the gap, name it, and leave it out of every blended denominator. Then
   `social_list_posts({ status: "published", from_date, to_date, limit: 100 })` for the window's rows
   (id, `tags`, `avatar_id`, `pillar_id`, `target_platforms`; page past 100) - it returns NO metrics,
   and its date filter is on `created_at`, not `published_at`, so say which you used.
2. Account level: `social_account_analytics({ social_account_id, from_date, to_date, limit: 100 })`
   once per connected account - the real per-platform daily series for `followers_count`,
   `total_impressions`, `total_engagements` and `avg_engagement_rate`, and the only source for an
   arbitrary window. These rows carry NO reach column - report impressions at the account level, and
   never present a monthly reach figure. Empty rows are `not_synced`: say so, do not report zeros.
   `social_analytics_followers({ period, social_account_id })` for gained, lost and net growth - it
   reads stored snapshots, so check `last_synced_at` before reading a flat line as a flat audience.
3. Per post, then by dimension. `social_posts_analytics_list({ post_ids, from_date, to_date, limit:
   100 })` with the ids from step 1 - the latest snapshot per version for every post in the window in
   ONE call, each with `synced_at` and `sync_stopped`; the dates filter posts, not snapshots; an
   unsynced version comes back with no numbers, never zeros, and a stopped post is quoted "as of
   <synced_at>", never as current. Fallback for one post, or for the per-platform URL breakdown:
   `social_post_analytics({ post_id })`, one call each (impressions, reach, engagements, likes,
   comments, shares, saves, clicks, video views, engagement rate). Then the creative loop:
   `social_analytics_by_dimension({ group_by: "hook", from_date, to_date })`, and again with
   `"format"`, `"persona"` and `"pillar"` (`"stage"`, `"platform"` and `"asset"` when the question
   calls for them) - engagement, impressions and rate per group, every group with its N and the
   window. Quote N with every group; N under 5 is a hint, not a finding; a group of one with an odd
   name is a tagging slip, not a trend; an N below the posts published in the window means unsynced or
   stopped posts, and the report says so. Its rate and the `avg_engagement_rate` on the account rows
   are computed differently - name the denominator each time. For every top post name its persona
   from the row's `persona:<slug>` tag (or its `avatar_id`, resolved through
   `customer_avatar_get({ id })`); when neither is set write "persona not recorded" - never guess one.
4. Delivery and cadence. Per pillar, `social_list_posts({ status: "published", pillar_id, from_date,
   to_date, limit: 100 })` and compare `pagination.total` against that pillar's `target_percentage`
   from `social_pillar_list` (whose own post count is lifetime, not windowed); per platform against
   `target_posts_per_week` - a week with zero posts on a connected platform is a service failure,
   named. X: `social_list_posts({ platform: "twitter", status: "published", from_date: <1st of the
   month>, limit: 100 })` gives the delivery count and `quota.x.used` the cap count; they differ when
   a post drafted last month shipped this month, so say which you quote. `social_analytics_summary`
   for the closing-week snapshot only - it always returns the trailing 7 days (`from_date`/`to_date`
   are ignored) and its `engagement_rate` is engagements over impressions; never label it as the month.
   `social_analytics_timeseries` returns a fixed trailing 30 days regardless of arguments and can 404
   or come back empty; if it is empty, build the trend from the `social_account_analytics` rows and
   say the blended series was unavailable. Anything still at status `pending_approval` is named with
   how long it has waited - the client's own sign-off is holding it. A failed X version on
   `social_get_post` (the cap, an expired token) is `partial`, excluded from the sample and named.
5. Write it, then deliver it. By platform, pillar, hook, format and persona: what over- and
   under-performed, with N; 3 next bets, each tied to a group with N of 5 or more or labelled a test;
   the measurement-artifact triage before any causal story (did the sync run, is the window what you
   think, did a connection break, did a version fail). Every number names its call and its
   denominator. End with the freshness lines, filled in from the calls above: post metrics "synced
   through <newest synced_at>; posts published before <today minus 90 days> stopped syncing and are
   quoted as of their last sync (N posts)"; account metrics "daily snapshots through <last snapshot
   date> (05:10 UTC)"; comments "LinkedIn and Meta comments through <last sync>; X, TikTok and GBP
   comments are not collected here; posts older than 14 days are not re-read"; connections "N
   connected, N awaiting activation, N broken (<platform>: <last_error>)"; X "<used> of 60 X posts
   used this month, <remaining> remaining" (or "X not eligible on the <plan> plan"). Unknown or unsynced
   never becomes zero. The client artifact is the platform's own social report page, reachable on the
   social key - never a twin built with `content_create` or a second report type. STOP and confirm the
   name, cadence and sections, then `marketing_report_create({ report_name, report_type: "social",
   schedule, include_sections: ["overview", "timeseries", "followers", "top_posts"], is_public: true })`
   (`schedule` is `weekly`, `monthly` or `none`; a social report is private by default, so mint the
   link here), `marketing_report_regenerate({ report_id })` to populate the numbers (the page renders
   the stored snapshot, not live data - say when it was generated), then
   `marketing_report_share_link({ report_id })` for the URL (read-only; `url: null` means not public -
   `marketing_report_update({ report_id, is_public: true })`, then read the link again). Keep the
   returned `report_id` in memory: there is no list or get tool for these rows. `marketing_report_send({
   report_id })` mails the client - the first call without `confirm` returns the preview (title,
   recipients, URL); re-call with `confirm: true` ONLY on an explicit yes from the operator, never as
   part of "finish the report". Your narrative travels with the link; the page carries the numbers.
6. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
