---
description: Plan a week of posts from pillars + analytics - every post names its persona, stage, hook and format, passes the anti-fluff gate, and lands as a draft; the schedule is its own confirmed step.
---
Social week plan. Follow the **hiveku-social-agency** skill - its weekly cadence and its roughly 80/20
value-to-promotion pillar ratio (about Educate 40, Authority 25, Connection 20, Promotion 15) are the
frame this plan fills. Load its `references/connection-health-and-syncs.md` before reading the roster
and `references/audience-grounding.md`, `references/hooks-and-formats.md` and
`references/anti-fluff.md` before drafting. Context: `account_context_get({ domain: "social" })` for
the brand, memory, rules and the persona summaries, then `account_context_get({ domain: "social",
include: "grids,social" })` for the transformation grids and the `social` section (pillars with
targets, accounts with `token_state`, schedule slots, the scheduling `timezone` - null means no zone
is set and every schedule must carry `timezone` explicitly).
1. Roster, budget and the last window. `social_list_accounts` - per row read `connection_status`,
   `is_active`, `can_post`, `last_error` (a connected-but-erroring row fails silently at the cron),
   `token_state` (`ok`, `expiring_soon` under 7 days, `expired`, `unknown` - `unknown` is how Meta page
   tokens read and means unpredictable, not fine) and `pending_selection` (a picker row nobody has
   activated; never a target). Only rows with `is_active` and `can_post` true and no `last_error` get
   a draft; `social_account_get({ social_account_id })` on every other row for the cause, and a broken
   platform is a task pointing at `/hiveku:connect-integration`, not a post. The response's top-level
   `quota.x` block (present when an X row exists: `{ plan, eligible, used, limit, remaining }`) is the
   X budget: plan at most `remaining` X drafts (60 published X posts per account per calendar month on
   Premium; over the cap only the X version fails, silently, at cron time), and `eligible: false`
   means no X post this week and a plan conversation with the client. Quote `used`/`limit` in the
   plan. Then `social_analytics_summary` (what worked; it always returns the trailing 7 days - the
   route ignores any date args), `social_pillar_list` (pillars with `target_percentage` and
   `target_posts_per_week`), and `social_list_posts({ status: "published", pillar_id, from_date,
   to_date, limit: 100 })` per pillar for the last window's actual mix (`pagination.total`; the dates
   filter `created_at`, so say which window you counted). An over-target pillar is held to its
   `target_posts_per_week` floor, never cut to zero; the underweight one gets the tilt.
2. Ground, then draft. Per slot pick ONE persona and ONE stage: `customer_avatar_get({ id })` for the
   full row (the context summary omits `buying_behavior.objections` and
   `online_behavior.social_platforms`; a persona whose platforms do not list a slug gets no post
   there), `before_after_grid_list({ target_avatar_id })` for its grids (real before/after photos are
   the proof; never generate a "before"), `customer_journey_get({ id })` for the stage vocabulary when
   a journey exists. Variance: `social_list_posts({ platform, status: "published", limit: 20 })` per
   platform - at most 2 of the last 10 with the same hook pattern, never the same opening six words,
   never the same format three in a row, and the same three checks across this week's drafts in slot
   order. Draft via `talk_to_department({ domain: "social", message })`: put the persona (name and id),
   the stage, the pillar, the grid item and the proof source for every slot IN the message (the agent
   sees the foundation files but not your choice), ask for one variant per platform slot, and ask for
   the fenced ```json social_drafts.v1``` block that ends its reply: `{ version, persona, stage,
   pillar_id, source, drafts: [{ platform, content, first_comment, link_url, hook_type, format, cta,
   hashtags, alt_text, media_brief, rubric, post_id }], alternatives }`, `rubric` keyed `specificity,
   one_idea, proof, voice, native, hook, cta, total`. The agent grades its own work; re-score every
   draft yourself against `references/anti-fluff.md`: the banned list plus `brand.ai_forbidden_phrases`
   from the context call, the competitor-swap test, the variance checks, and the 7-axis rubric. The
   gate is `Rubric: N/14 (specificity n, one-idea n, proof n, voice n, native n, hook n, cta n)` with
   N >= 11 and zero hard fails, written in the deliverable under the header line `For: <avatar> |
   Stage: <Schwartz stage> | Pillar: <pillar> | Hook: <pattern> | Format: <format> | CTA: <verb>` -
   never in `content` or `title`. One rewrite pass; a draft still under the gate goes to the
   alternatives, not to the account (the client reads drafts in the dashboard). A post MAY carry
   `platform_overrides` (`{ [platform]: { content, firstComment } }`, the only two keys the publisher
   reads) when its targets share one instant and one media set; this plan does not use it, because
   each platform gets its own row (step 3) and its own time (step 4).
3. Persist as TRUE DRAFTS, one row per platform slot. Dry run first: `social_post_validate` with the
   exact body the create will carry (`content`, `target_platforms`, the real `target_accounts`,
   `media_asset_ids` or `media_urls` + `media_types`, `first_comment`, `link_url`, no schedule). It
   writes nothing and returns `{ ok, validation: { errors, warnings }, schedule, media: { resolved,
   missing, warnings }, x_quota }`; the errors are the work list (an Instagram row with no media, an X
   row over 280 with every URL counted as 23, an asset id the account does not own). Then one
   `social_create_post({ title, content, target_platforms: ["<one slug>"], target_accounts: ["<one
   healthy account id>"], pillar_id, tags: ["persona:<slug>", "stage:<slug>", "hook:<pattern>",
   "format:<format>"], avatar_id, journey_id, journey_stage, before_after_grid_id, first_comment,
   link_url, media_asset_ids, media_alt_texts })` per slot, and **omit `scheduled_at` and
   `scheduled_at_local`**. Setting a schedule is not a proposal - it writes status 'scheduled' and the
   every-minute cron publishes it, since the default `approval_status: 'not_required'` passes the
   cron's filter. Tags: `stage:` is one of `unaware`, `problem-aware`, `solution-aware`,
   `product-aware`, `most-aware`; `hook:` and `format:` are the slugs from
   `references/hooks-and-formats.md` (the confession hook is `mistake`, not `mistake-confession`);
   `persona:` is a stable slug you keep in memory; the pillar is `pillar_id`, never a tag. Foundation
   ids are checked against the account (a foreign id is a 400 naming the field) and `journey_stage`
   with `journey_id` must be a stage NAME on that journey (the 400 lists the real names). The link goes
   where the platform lets it: LinkedIn and Facebook posts with media carry it in `first_comment`
   (one line of context plus the link, `utm_medium=social`); a text-only Facebook post and GBP use
   `link_url` (GBP's Learn more button); X carries it in the body; Instagram gets `first_comment` plus
   "link in bio"; TikTok gets none from this rail. `media_alt_texts` is one entry per media item in
   order, 125 characters or fewer, stored on the row and shown in the dashboard but sent to no
   platform today. A draft 201 echoes `validation.errors` and `validation.warnings` - read them: a 201
   is not a clean post, and the same errors are a 400 the moment it is scheduled, so fix them with
   `social_update_post` while it is a draft. `target_accounts` is optional to the tool but mandatory in
   practice: without it the post 400s at publish time. Slugs are exactly `linkedin`, `twitter`,
   `facebook`, `instagram`, `tiktok`, `google_business_profile`. Bind each post to its slot with
   `social_calendar_create({ title, event_type: "planned_post", start_date, start_time, timezone,
   target_platforms, linked_post_id })` - `title`, `event_type` and `start_date` are required,
   `start_date` is stored as a DATE (a time on it is dropped; the slot time is `start_time` read in
   `timezone`), and `linked_post_id` is checked against the account.
4. Present the week - header, rubric line and copy per post, the slot, the X count, the excluded
   accounts with reasons - and STOP for a yes: scheduling is publishing on a timer, and nothing below
   runs without an explicit yes on the exact posts and times. Pick the times with two tools, in this
   order: `social_schedule_slot_next_open` (the next open occurrences of the account's defined slots
   over a 14-day horizon - call it BEFORE picking any time so you never double-book a slot; an empty
   list means no slots are defined, not an error - schedule by hand) and `social_analytics_best_times`
   (zero params; concrete FUTURE ISO timestamps computed from this account's own engagement history,
   usable directly as `scheduled_at`; an empty list means too few samples, not an error - schedule by
   the calendar instead). Before EACH scheduling update: `social_post_validate` with the draft's body
   plus the intended `scheduled_at_local` + `timezone` (or `scheduled_at` with a zone designator) - it
   resolves the instant the same way the update will, says whether it is already past, and returns
   `x_quota` when `twitter` is among the platforms; an update that leaves the post scheduled and
   invalid is a 400 "Post fails platform validation" with nothing written, so the dry run is where the
   errors get fixed, never by dropping the schedule to get past the check. `social_post_preview({
   post_id })` shows, per target platform, the effective copy above the fold (Instagram and Facebook
   about 125 characters, LinkedIn about 210, X the whole 280, GBP 100), the character count against
   the cap, the hashtag count and where the link lands; a hook whose specific sits below the fold is
   rewritten with `social_update_post({ post_id, content })` before it gets a time. Only then
   `social_update_post({ post_id, scheduled_at })` (ISO 8601 with `Z` or an offset; no designator is a
   400, a past instant is a 400) or `social_update_post({ post_id, scheduled_at_local, timezone })`
   (both forms in one call is a 400; no `timezone` and no account zone is a 400 - ask the client for
   the zone, never guess). `scheduled_at: null` on update unschedules. Do NOT call
   `social_publish_post` on a scheduled post: on an unapproved post it returns 200 with
   `pending_approval: true` and moves it OUT of status 'scheduled' into the dashboard approval queue,
   so it stops shipping until a human approves it.
5. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
