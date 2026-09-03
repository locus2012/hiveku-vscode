---
description: "\"Our posts sound like AI\" / \"why is engagement flat?\" - content-quality audit of the last 30 published posts against the anti-fluff rubric: hook-pattern histogram, banned phrases, persona coverage, winners and losers by format, and a rewrite list. Read-only."
argument-hint: "[optional platform or window]"
---
Social content audit ($ARGUMENTS). Follow the **hiveku-social-agency** skill (Play 3) and load
three references before scoring a single line: `references/anti-fluff.md` (the 45 banned phrases,
the recycled-AI tells, the 7-axis rubric and its 11/14 gate, the competitor-swap test, the variance
rule), `references/hooks-and-formats.md` (the 16 hook slugs, the 17 format slugs, the fold per
platform, the CTA ladder by pillar) and `hiveku-orient/references/stating-coverage.md` (every count
says how many of how many, and what was not looked at). Context: `account_context_get({ domain:
"social" })` - keep `brand.ai_forbidden_phrases` (it joins the banned list), `brand.brand_is` and
`brand.brand_is_not` (they score the voice axis) and `brand.cta_primary` (the Promotion verb).
Default scope: the 30 most recently published posts across every connected platform; the argument
may narrow it to one platform slug (`linkedin`, `twitter`, `facebook`, `instagram`, `tiktok`,
`google_business_profile`) or a window. This command is READ-ONLY: it grades, ranks and proposes. It
edits no post, deletes nothing, reschedules nothing and runs no `social_post_duplicate`; the one
write it can end with is the memory line in step 6, after a yes in step 5.
1. **Sync, then the set, then its numbers.** `social_analytics_sync` (no args) refreshes only the
   versions that are DUE, 50 per run, and returns the run report; repeat until a run reports zero
   synced and record the result as "N versions synced across M runs" - the zero is the completion
   signal, not a failure. A post in the set the sweep did not consider due can be forced with
   `social_post_sync_analytics({ post_id })`; a post past 90 days (`sync_stopped`) never moves, so
   do not force it. `social_list_accounts` for the roster: a row with `is_active` and `can_post`
   true and `connection_status: "connected"` is a platform the audit expects posts on (none in the
   window is a service failure, named); a `pending_selection` row is a picker, not a platform; a
   row with `last_error` or an `expired` token is `partial` and feeds step 3's triage. Then
   `social_list_posts({ status: "published", limit: 100 })`, and per platform in scope
   `social_list_posts({ platform, status: "published", limit: 100 })` (`platform` is a
   contains-filter on `target_platforms`, so a three-platform post appears in each list). The list
   orders by `created_at`, and `from_date` / `to_date` filter `created_at`, not `published_at`: sort
   by `published_at` yourself, take the newest 30 (or the window asked for), and say which date you
   used. Each row carries `content`, `first_comment`, `platform_overrides`, `media_alt_texts`,
   `tags`, `pillar_id` with `content_pillar.name`, `avatar_id` with `customer_avatar.name`,
   `journey_stage`, `before_after_grid_id`, `target_platforms` and `published_at` - everything the
   rubric reads except the numbers. `pagination.total` is the coverage denominator: the deliverable
   opens with "30 of N published posts, the newest by published_at, on <platforms>". Fewer than 30
   rows is the whole history, said as such; fewer than 20 on a platform means no variance history
   there, and the deliverable says so instead of asserting a clean check. This audit scores what
   Hiveku published: posts made in the native apps are not in these tables
   (`social_meta_post_list` and `social_linkedin_post_list` read those feeds live; X, TikTok and GBP
   have no live read), so name them as not scored. Then `social_posts_analytics_list({ post_ids })`
   - the 30 ids comma-separated, ONE call: per post `totals` (impressions, engagements, clicks,
   saves, shares, `engagement_rate` as a percent) and per version `analytics`, `synced_at`,
   `sync_stopped` and `never_synced`, plus `unsynced` and `not_found` at the top. `analytics: null`
   and `totals: null` mean never synced - UNKNOWN, never zero. `sync_stopped: true` is a post
   published more than 90 days ago whose number is frozen at `synced_at`: quote it "as of
   <synced_at>", never as current. Count both for the coverage sentence.
2. **Score every post, then count the patterns.** Rebuild the header from the row: persona from the
   `persona:<slug>` tag or `avatar_id` (`customer_avatar.name` is on the row; the full row from
   `customer_avatar_get({ id })` adds `online_behavior.social_platforms`), stage from the
   `stage:<slug>` tag or `journey_stage`, pillar from `pillar_id` against `social_pillar_list`, hook
   and format from the `hook:` and `format:` tags, the CTA verb from the copy. A row with none of
   these reads "persona not recorded", "stage not recorded" or "pillar not recorded" - never a
   guess. Rows from before the tagging convention carry no `hook:` or `format:` tag: classify both
   from the first line and the shape yourself, and say in the deliverable that you did. Score each
   post on the seven axes and write the line exactly: `Rubric: N/14 (specificity n, one-idea n,
   proof n, voice n, native n, hook n, cta n)`, with the reason for every 1 or 0 on the next line.
   Hard fails, each named per post: a banned phrase from anti-fluff.md or `brand.ai_forbidden_phrases`
   anywhere in `content`, `first_comment`, a `platform_overrides` variant, `media_alt_texts` or a
   hashtag (inflections count; record the phrase and where it sits); a header you cannot fill; the
   competitor-swap test, run on the hook line alone and on the whole post; a variance breach against
   that platform's own list in published order (a third use of one hook pattern in the last 10, an
   opening six words repeated inside 20, one format three in a row). Count the recycled-AI tells per
   post; two or more is a rewrite candidate whatever the total. The histogram with numbers attached:
   `social_analytics_by_dimension({ group_by: "hook", from_date, to_date })`, then `"format"`, then
   `"persona"`, with `from_date` the oldest `published_at` in the set and `to_date` today (this route
   filters `published_at`). Each row carries `key`, `label`, `posts`, `synced_posts`, `impressions`,
   `engagements` and `engagement_rate`; quote `posts`, `synced_posts` and the `window` with every row.
   `synced_posts` under 5 is a hint, not a finding; a group of one with an odd key is a tagging slip;
   `unassigned` is the number of posts carrying no tag for that dimension, which IS the coverage
   figure; `unsynced.posts` explains an N below the posts published. Set the tag histogram beside
   your own classification of the first lines: where the two differ, the tag is wrong or the hook
   drifted, and the row says which. Persona and stage coverage: n of 30 with a persona recorded, n
   with a stage, the platforms each persona's posts ran on against that persona's
   `online_behavior.social_platforms` (a post on a platform the persona does not list is a finding),
   and the hooks used per stage against the awareness map in hooks-and-formats.md. CTA per pillar:
   the verb against the ladder (Educate save or comment; Authority share, follow, "what would you
   add"; Connection reply or tag; Promotion click, book, DM or call, in the words of `cta_primary`;
   GBP the button) - a value post that closes on a sale ask is a Promotion post wearing an Educate
   hook, two asks or a question nobody can answer is cta 0, and the pillar mix of the 30 is set
   against the roughly 80/20 value-to-promotion ratio. Identical openings: the first six words of
   every post, compared per platform and across platforms, every repeat listed with its post ids.
   Then `social_post_preview({ post_id })` on the three lowest totals to show the fold: per platform
   `above_the_fold { limit, text, truncated }`, `char_count`, `hashtags { count, norm, status }`,
   `link_handling.strategy`, `media_composition.alt_text_missing` and `validation`. A specific that
   lands below the fold is native 1 however well the post reads in full; a hashtag inside the hook
   line, or hashtags as the closing sentence, is a tell.
3. **Winners and losers, after the triage.** Load `references/analytics-and-reporting.md` before
   quoting a number. Rank the scored set by `totals.engagement_rate` from step 1 - engagements over
   IMPRESSIONS, a percent, the latest snapshot of every synced version summed; say so, because
   `social_analytics_summary` and `social_account_analytics` compute their rates differently and
   the three never share a trend line. Top 5 and bottom 5, each labelled with platform, hook
   pattern, format, persona (or "not recorded"), the Rubric total and `synced_at` (a frozen row
   reads "as of <synced_at>"). Unsynced posts cannot be ranked: list them apart, never as zeros.
   Each platform defines an impression differently, so rank inside a platform first when the set
   mixes platforms, or say the ranking mixes them. Before crediting or blaming the copy, run the
   measurement-artifact triage in order: (1) did the sync run - step 1's report and `unsynced`; (2)
   is the window what you think - list dates are `created_at`, the analytics reads are
   `published_at`, and a set spanning more than 90 days compares frozen numbers with live ones; (3)
   did a connection break mid-window - `connection_status` and `last_error` on `social_list_accounts`,
   `social_account_get({ social_account_id })` for the row; (4) did a version silently fail -
   `social_get_post({ post_id })` version rows, where a failed X version or an expired token means
   the post reached fewer audiences than its siblings and is `partial`, not a content verdict. Only
   after those four does a pattern get the credit or the blame. Any post at 2-3x the set's median
   rate is studied and its hook and format banked as a candidate for step 5's bets;
   `social_post_analytics({ post_id })` gives its per-platform version breakdown when the platforms
   split.
4. **Hashtags and series.** `social_hashtags_list({ sort_by: "engagement", limit: 100 })`: rows
   carry `hashtag`, `platform`, `times_used`, `avg_engagement`, `avg_reach`, `best_engagement`,
   `is_branded`, `is_favorite` and `last_used_at`, with `pagination.total` (page past 100). The
   tail to prune: tags used three or more times sitting at the bottom of `avg_engagement`, and tags
   with no `last_used_at` inside the audited window; list each with its numbers. Tracked rows are
   inventory - the tags that publish are inside `content` - so also count the hashtags per post
   against the platform norm the preview reported, and a banned phrase used as a hashtag is the
   hard fail it was in step 2. Pruning is `social_hashtags_delete({ hashtag_id })` and
   reclassifying is `social_hashtag_update`, each its own confirm in a Play 5 session; neither runs
   here. Series: `social_calendar_gaps({ from_date, to_date })` with `from_date` the oldest
   `published_at` in the set as YYYY-MM-DD and `to_date` today; the window is capped at 62 days, so
   a longer set takes two calls, or the deliverable says the series check covered the last 62 days.
   Read `series_gaps` (event, date, weekday, the target platforms with no live post that day),
   `summary.series_gaps`, `pillars.rows` (`posts` and `share_percent` against
   `target_percentage`, `gap_vs_weekly_target`), `summary.unlinked_events` and `summary.dark_cells`.
   Three series per account is the ceiling. A series occurrence repeats its format by design, so it
   is exempt from the format-three-in-a-row check and is judged on its specific and its opening six
   words instead: the same opening twice inside one series is the R7 breach that matters. Nothing
   here is created or fixed; a missing occurrence goes on the rewrite list as its own line, for
   /hiveku:social-calendar.
5. **The deliverable, then STOP.** Open with the coverage sentence from step 1, then, in this order:
   (a) the audit table, one row per post - id, platform(s), `published_at`, persona, stage, pillar,
   hook, format, CTA verb, the `Rubric: N/14` line, hard fails, banned hits, tells, and
   `engagement_rate` or "unsynced" or "as of <synced_at>"; (b) the three histograms with N and
   window, the coverage counts (persona, stage, hook tag, format tag, pillar - each n of 30), the
   CTA mismatches and the repeated openings; (c) the winners and losers with the triage verdict on
   every row; (d) the hashtag tail and the series gaps; (e) the rewrite list - post id, the failing
   axes and hard fails, the fix (the hook pattern to re-hook with, the specific to add and where it
   comes from: a grid item, an `is_public` testimonial, a `kb_search` passage or a metric by call,
   and the CTA verb to change), and the lane: a published post is edit-locked and its record is
   history, so a rewrite ships as `social_post_duplicate({ post_id })` - a NEW unscheduled draft
   that /hiveku:social-post revises with `social_update_post` and re-scores to the 11/14 gate before
   the client sees it, one post, one confirm - never an edit of the published row; the duplicate is
   a draft the client can read in the dashboard, so it does not run from here; (f) three format bets,
   each tied to a by-dimension group with `synced_posts` of 5 or more, or labelled a test with the
   N it needs before it is a finding; (g) the proposed memory update, titled "Winning Formats /
   Do-Not-Post": the hooks and formats that earned, with N and window; the ones to retire; the
   banned phrases found; the openings not to reuse; the audit date and window. Show the exact text
   and STOP for a yes; on a yes it goes in through step 6's read-merge-write into the social
   department document, and on a no nothing is written. A phrase the client bans in this
   conversation belongs on the brand guide, not in memory - `brand_guide_update({ guide_id,
   brand_guide_data: { ai_forbidden_phrases: [...] } })` with the WHOLE array, since the column is
   replaced - and that is a separate confirm the client asks for, not this command's. Nothing is
   edited, deleted or rescheduled from here: no `social_update_post`, no `social_delete_post`, no
   `social_hashtags_delete`, no `scheduled_at` on anything.
6. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
