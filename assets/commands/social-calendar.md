---
description: "\"Is the next two weeks actually filled?\" - verify and fill the social calendar 14 days out: events vs posts vs slots, unlinked events, dark days per platform, pillar ratio, series rhythm; drafts the gaps, schedules nothing."
argument-hint: "[optional start date]"
---
Social calendar, 14 days out ($ARGUMENTS). Follow the **hiveku-social-agency** skill (Play 2, the
content calendar, with Play 12 for the series check). Load `references/publishing-approval-mechanics.md`
(the calendar section and the contract table) and `references/connection-health-and-syncs.md` before
the first read, then `references/audience-grounding.md`, `references/hooks-and-formats.md` and
`references/anti-fluff.md` before the first line of copy. Context: `account_context_get({ domain:
"social", include: "grids,social" })` - the scheduling `timezone` (null means the grid below is
computed in UTC and every time you write needs an explicit `timezone`), the pillars with
`target_percentage` and `target_posts_per_week`, the accounts with `token_state`, the schedule slots,
the persona summaries and the active grids. Three commands touch this calendar and do different jobs:
`/hiveku:ship-week` is the cross-channel Mon-Sun grid (social, email, content, sequences) with fixes;
`/hiveku:social-plan` drafts one week from analytics and owns the schedule step; this command checks
the calendar OBJECTS 14 days out (events, posts, slots, series), fills the gaps with DRAFTS, and
writes no `scheduled_at` anywhere.
1. **Read the window.** The start date is the argument when one was given (resolve it to YYYY-MM-DD
   in the account zone), else today; the end date is 13 days later. `social_calendar_gaps({
   from_date, to_date })` is the integrity read and it writes nothing. The response names its
   `timezone` and `window`, lists `accounts` (every connected, active row, INCLUDING one with
   `can_post: false` - the grid does not decide who gets drafts, step 2 does), and per day returns
   `cells[]`, one per account: `slots[]` (the recurring slot expanded onto that day; `filled` when a
   live post sits within 15 minutes, with `filled_by_post_id`), the posts bucketed `scheduled`,
   `held` (awaiting approval; the cron never publishes a held post), `rejected`, `published`,
   `failed` and `drafts_with_date` (a draft carrying a `scheduled_at` that nothing will publish),
   and `dark` (no scheduled, held or published post that day). Per day it also lists `events[]` with
   a `linked` flag: an event with `linked: false` is a sticky note, the orphan step 3 binds. Then
   `pillars.rows[]` (`posts`, `share_percent`, `expected_by_percentage`, `gap_vs_weekly_target`,
   plus `posts_counted` and `unpillared`), `series_gaps[]` (a series event whose weekday - RRULE
   BYDAY, else the start date - falls in the window with no live post on its platforms that day:
   `event_id`, `title`, `date`, `weekday`, `target_platforms`), `unassigned_posts` (neither
   `target_accounts` nor `target_platforms`, a 400 at publish time), `unmapped_target_accounts` (a
   post aimed at a row that is no longer connected) and `summary`, where `dark_cells_future`,
   `slots_open`, `held_posts`, `unlinked_events` and `series_gaps` are the headline counts. Only
   days with `is_past: false` are gaps to fill; a past dark day is history for the report. Detail
   behind the grid: `social_calendar_list({ from_date, to_date, limit: 100 })` - each event carries
   `linked_post { id, title, status, scheduled_at, target_platforms, content_pillar }` inline, so an
   event whose post is a `draft` is a slot with copy and no time, an event whose post is
   `pending_approval` is the client's, and `linked_post: null` is the orphan (read
   `pagination.total`; over 100 is a second page). `social_list_posts({ status: "pending_approval",
   limit: 100 })` for the held queue by name, platform and intended slot: a held post with no
   `scheduled_at` publishes the moment the client approves it - say so in the report; the approval
   click is theirs and no tool here takes it. `social_list_posts({ status: "draft", limit: 100 })`
   last: a draft that no event in the list points at is stock, copy that already passed a gate and
   can fill a gap before anything new is written.
2. **The health gate (references/connection-health-and-syncs.md).** `social_list_accounts`: a row
   gets drafts only when `is_active` and `can_post` are true, `connection_status` is `connected`,
   `last_error` is null and `token_state` is `ok` or `unknown`. `unknown` is how Meta page tokens
   read (no expiry is stored; the token dies when the user token behind it does), so it means
   unpredictable, not fine - name it in the report and draft anyway; `expiring_soon`, `expired` and
   any `last_error` mean no drafts. A `pending_selection` row is a picker nobody has ticked and is
   never a target. `social_account_get({ social_account_id })` on every row that fails the gate for
   the cause; a connected-but-erroring account fails silently at the cron, so its dark days become
   one `pm_tasks_create({ project_id, title: "Reconnect <platform>: <last_error>", priority: "high"
   })` (`project_id` from `pm_projects_list`, filtered yourself) pointing at
   `/hiveku:connect-integration`, and its cells drop out of the fill list. The response's top-level
   `quota.x` (present when an X row exists: `{ plan, eligible, used, limit, remaining }`) caps the X
   drafts in this window at `remaining`; `eligible: false` means no X drafts and a plan conversation.
   Quote `used`/`limit` in the report. One more exclusion is the persona's: a platform that
   `online_behavior.social_platforms` on the chosen avatar does not list gets no post aimed at that
   persona there, however healthy the row (R1).
3. **Fill the gaps as DRAFTS.** Build the gap list first, one line per finding on a healthy account:
   date, platform, what the cell holds (dark, open slot, series weekday, orphan event), the pillar
   the fill serves and the persona and stage it is for. The pillar tilt reads `pillars.rows[]`: the
   next gap goes to the pillar with the largest positive `gap_vs_weekly_target`; Promotion is held
   at its `target_percentage` share and never above it; an over-target pillar is held to its
   `target_posts_per_week` floor, never cut to zero. The persona is `customer_avatar_get({ id })`
   for the full row (the objection and `online_behavior.social_platforms` are not in the context
   summary), the stage from `customer_journey_get({ id })` when a journey exists, the proof from
   `before_after_grid_list({ target_avatar_id })` or `kb_search({ query })` by id. Fill order: bind
   stock first (an unbound draft from step 1 goes on the gap's day with the `social_calendar_create`
   call below, no new copy); series occurrences second - `social_post_duplicate({ post_id, title })`
   on the last occurrence gives the frame as a new unscheduled draft, then rotate the specific and
   the opening six words with `social_update_post({ post_id, content, first_comment, tags })` (Play
   12: the format repeats by design, the hook's specific never does); new copy last. Variance before
   drafting: `social_list_posts({ platform, status: "published", limit: 20 })` per platform you are
   filling, sorted by `published_at` yourself - max 2 of the last 10 with the same hook, never the
   same opening six words, never one format three in a row, and the same three checks across the
   new set in date order; under 20 rows is no variance history, and the report says so. Draft
   through `/hiveku:social-post` per gap when there are three or fewer or a gap needs the full
   creative lane; otherwise one batch via `talk_to_department({ domain: "social", message })` with
   every gap IN the message (the agent sees the foundation files but not your choices): per gap the
   date and platform with its fold (Instagram and Facebook about 125 characters, LinkedIn about 210,
   X the whole 280 with every URL counting 23, GBP 100), the pillar and its CTA verb from the ladder,
   the persona name and id with the fields you are writing from, the stage, the proof source by id,
   the hook pattern and the format, and the variance facts as patterns, openings and formats to
   avoid; ask for the fenced `social_drafts.v1` block, one entry per gap (`platform, content,
   first_comment, link_url, hook_type, format, cta, alt_text, media_brief, rubric`). Score every
   draft yourself against the 7-axis rubric in references/anti-fluff.md - the header `For: <avatar>
   | Stage: <Schwartz stage> | Pillar: <pillar> | Hook: <pattern> | Format: <format> | CTA: <verb>`
   over each post, then `Rubric: N/14 (specificity n, one-idea n, proof n, voice n, native n, hook
   n, cta n)` with one reason per 1 or 0; the gate is 11 or more and zero hard fails (a banned
   phrase or one of `brand.ai_forbidden_phrases` anywhere, a header you cannot fill, a failed
   competitor swap, a variance breach). One rewrite pass; a draft still under the gate leaves its
   gap OPEN and named in the report - the client reads drafts in the dashboard, so a failing draft
   is not written. Words on the canvas (a quote card, a data-point card, carousel copy) are a
   designed asset briefed through `/hiveku:creative-brief`; the post is held text-only until the
   asset is attached. Then `social_post_validate({ content, target_platforms, target_accounts,
   media_asset_ids, platform_overrides })` per draft with the healthy ids and NO schedule fields; it
   writes nothing and returns `{ ok, validation: { errors, warnings }, media: { resolved, missing },
   x_quota }`, and its errors are the work list. STOP - show the two-week grid with the draft that
   fills each gap (header, Rubric line, copy, first comment), the stock bindings, the orphan
   bindings, any series change and the exact write calls, and get a yes. Then persist, drafts only.
   ONE `social_posts_bulk_create({ posts: [...], batch_id })` for the new copy: up to 25 rows,
   all-or-nothing with every row's validation echoed (one foreign id or one `scheduled_at` and
   nothing is written). Each row: `title` `"<date> / <platform> / <format>"`, `content`,
   `target_platforms` with ONE slug, `target_accounts` with the one healthy id, `pillar_id`, `tags:
   ["persona:<slug>", "stage:<slug>", "hook:<pattern>", "format:<slug>"]` (`stage:` is one of
   `unaware`, `problem-aware`, `solution-aware`, `product-aware`, `most-aware`), `avatar_id`,
   `journey_id` + `journey_stage` (the journey's own stage NAME), `before_after_grid_id` when a grid
   item is the proof, the link where the platform allows it (`first_comment` on LinkedIn and on
   Facebook with media, `link_url` on GBP and on text-only Facebook, in the body on X, nothing from
   this rail on TikTok), `media_asset_ids` + `media_alt_texts` in the same order, and the two fields
   that put it on its day: `proposed_date: "YYYY-MM-DD"` (the gap's date) and `calendar_event: true`
   - the server writes one `planned_post` event on that date with `linked_post_id` already set (the
   row-level `calendar_event` is a boolean and the day is `proposed_date`, not an event object). No
   `scheduled_at` and no `scheduled_at_local` on any row. The batch lands as `batch:<id>` in `tags`
   and `settings.batch_id`; keep `created[].post_id` and `event_id` for memory, because
   `social_list_posts` has no tag filter. One by one when the fill is a single post:
   `social_create_post` with the same fields and no schedule, then `social_calendar_create({ title,
   event_type: "planned_post", start_date, target_platforms, linked_post_id })` (`title`,
   `event_type` and `start_date` are required; `start_date` is a DATE). Read one post per platform
   back with `social_post_preview({ post_id })` for the fold and the link placement. Orphans:
   `social_calendar_update({ event_id, linked_post_id })` binds an unlinked event to the draft
   written for its day - the update route writes `linked_post_id` through without the ownership
   check the create route has, so only an id from this account's `social_list_posts` or this batch's
   response goes in. Series rhythm, on its own confirmed yes: a series event missing its weekday
   gets an occurrence draft above; a series event that is not yet recurring gets
   `social_calendar_update({ event_id, is_recurring: true, recurrence_rule:
   "FREQ=WEEKLY;BYDAY=<MO..SU>", start_time, timezone })` - `start_time` here is stored as sent, so
   pass an ISO datetime whose time part is the slot (`1970-01-01T09:00:00Z`; the create route also
   parses `HH:mm`, the update route does not), `timezone` is the IANA zone from the context read and
   is mandatory when the account zone is null, and the `BYDAY` is what `social_calendar_gaps` reads
   next time. Check `social_schedule_slot_list` for the matching slot and point at Play 12
   (`social_schedule_slot_create({ weekday, minute_of_day, timezone, label })`) when there is none;
   three series per account is the ceiling. Unassigned posts from step 1 are fixed while they are
   drafts: `social_update_post({ post_id, target_accounts })` with healthy ids.
4. **Report the grid, then hand the timing over.** Rows are the 14 days (date and weekday), columns
   the healthy platforms; each cell reads one of: `scheduled <title> <time>`, `held <title>` (the
   client's click; an unscheduled held post is an instant publish on approval), `draft <title>`
   (bound to its event, no time yet), `open slot <label> <time>`, `dark`. Then the flags, in this
   order: the held queue by name, platform and slot, chased with `pm_tasks_create`, never approved
   from here; `drafts_with_date`, `unassigned_posts` and `unmapped_target_accounts` (each one a
   post that will not publish as it stands); `failed` posts (a connection or X-cap job first, then
   `social_post_retry`, which is ask-gated and belongs to the weekly cadence); the gaps left open
   and why (rubric fail, broken platform, X budget, persona excludes the platform); the pillar table
   (`posts` vs `expected_by_percentage` and `gap_vs_weekly_target` per pillar, plus `unpillared`);
   the series lines (weekday, covered or missing, recurring or not); the accounts excluded with
   their `last_error`; the X line, `used` of `limit` with `remaining`. Every number names its call
   (R12): the grid and the counts from `social_calendar_gaps`, the queue from `social_list_posts`,
   the roster from `social_list_accounts`. Then the handoff, stated plainly: nothing written here
   carries a time. The schedule is `/hiveku:social-plan` step 4 - `social_schedule_slot_next_open`,
   then `social_analytics_best_times`, `social_post_validate` with the intended
   `scheduled_at_local` + `timezone`, then `social_update_post({ post_id, scheduled_at })`, one
   post, one confirm, because setting `scheduled_at` is publishing on a timer. Never
   `social_publish_post` on any of these: on an unapproved post it returns 200 with
   `pending_approval: true` and stages the post into the approval queue. The memory line for step
   5: the window, the `batch_id`, the post and event ids by day and platform, the orphans bound, the
   series changes, the gaps left open and the date.
5. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
