---
description: "First session on a social account (\"we just took over the client's social\") - baseline, connection health, foundation check and the seeded knowledge rows; nothing is drafted or scheduled."
---
Social onboarding baseline (Month 1). Follow the **hiveku-social-agency** skill's Month 1
onboarding baseline, and load its `references/connection-health-and-syncs.md` (the picker rows,
`token_state`, the X cap, the five syncs and the freshness lines) and
`references/analytics-and-reporting.md` (the real-feed baseline and the honesty states) before
the first call; `hiveku-orient/references/foundation-first.md` is step 3's checklist. The rule
of this command: read everything, draft nothing, schedule nothing, activate nothing, disconnect
nothing. Its only writes are the findings filed as PM tasks (step 3) and the knowledge rows
(step 4), each behind its own STOP. The strategy comes after the client reads this baseline; the
first week of posts is `/hiveku:social-plan`, later.
1. Roster and health. `account_context_get({ domain: "social", include:
   "identity,brand,memory,rules,skills,avatars,journeys,grids,social" })` FIRST, and read
   `sections_included` and `has.*` before calling any section empty. The `social` section gives
   `timezone` (null means the account has no scheduling zone; nothing on this surface sets it,
   so the client sets it in the dashboard and every later schedule carries `timezone`
   explicitly), `pillars`, `accounts` with `token_state` and `schedule_slots`; `skills` and
   `rules` show what is seeded today (step 4 reads the rows themselves); `avatars` and
   `journeys` are summaries (step 3 reads the full rows). Then `social_list_accounts` with no
   filter, so the picker rows come back beside the connections. Per row read `platform`,
   `display_name`, `is_active`, `connection_status`, `can_post`, `can_read_analytics`,
   `can_manage_comments`, `last_error`, `last_sync_at`, `token_state` (`ok`, `expiring_soon`
   under 7 days, `expired`, `unknown` - Meta page tokens and GBP store no expiry, so `unknown`
   means "cannot be predicted", not "fine"), `byok` (the client's own app: its scopes, review
   status and rate limits are theirs, and a permission the app never asked for is not a Hiveku
   bug) and `pending_selection` (a picker row the connect flow stored because the login
   administers several Pages or organizations; a human activates the right ones in the
   dashboard - list them by name, count them, never treat one as a publishing target, and no
   tool activates or disconnects a row, by design). Classify every row: connected (`is_active`
   true, `connection_status: "connected"`, `can_post` true), picker (`pending_selection` true),
   broken (anything else). `social_account_get({ social_account_id })` on every broken row and
   every row whose `token_state` is not `ok`: the granted scopes and `last_error` say whether
   it is a full re-consent (Meta has no refresh path; nothing self-heals), a refused refresh
   (LinkedIn writes `expired`, X, TikTok and GBP write `error`, both with `last_error`) or a
   missing scope. When an X row exists the response carries a top-level `quota.x` = `{ plan,
   required_plan, eligible, used, limit, remaining, month_start_utc }`: 60 published X posts per
   Hiveku account per calendar month on Premium, aggregate across every X handle;
   `eligible: false` is a plan conversation before any X post; the cap is soft and fails open,
   so `remaining` is advisory. `social_provider_list` for every platform the client wants that
   has no row: `hiveku_native: false` means the client registers their own app (a BYOK connect
   task carrying the guide, the scopes and the `redirect_uri`); `true` means a connect task
   pointing at `/hiveku:connect-integration`. Never tell a client a platform is unsupported
   before reading it. A Page that is also active on another Hiveku account is a conflict you
   surface, not one you decide.
2. Real history, both feeds. `social_list_posts({ limit: 100 })` (page past 100) is what Hiveku
   drafted, scheduled, held, published or failed, and only that: read `status` per row, and
   name anything at `pending_approval` with how long it has waited - that is inherited work the
   client is holding. Then the ACTUAL feeds, or a client with a year of native posting reads as
   a dead account: `social_meta_post_list({ social_account_id, limit: 50 })` per connected
   Facebook and Instagram row, paging with `paging.after` (Facebook rows carry message,
   permalink and like, comment and share summaries; Instagram rows carry caption, media_type,
   permalink, like_count and comments_count, and no share count exists there, so that field is
   absent, not zero), and `social_linkedin_post_list({ social_account_id, limit: 50, sort_by:
   "CREATED" })` per LinkedIn row, paging with `start`. X, TikTok and GBP have no live-feed read
   on this surface; for those the Hiveku-published rows are all there is, and the baseline says
   so per platform. From the feed dates take the cadence per platform (posts per week over the
   last 8 to 12 weeks) and from the captions the voice and format mix as they stand today.
   Structure that exists, inherited before anything is created: `social_pillar_list` (the
   per-pillar count is lifetime), `social_schedule_slot_list` (`weekday`, `minute_of_day`,
   `timezone`; `social_account_id` null applies to every connection; slots schedule nothing),
   `social_hashtags_list({ sort_by: "engagement", limit: 100 })` (inventory only; the tags that
   publish live in post `content`), and `social_calendar_gaps` with no arguments (today through
   13 days ahead in the account timezone): read `summary` (`scheduled_posts`, `held_posts`,
   `drafts_with_date` - a dated draft nothing will publish, `dark_cells`, `unlinked_events`,
   `series_gaps`) and `pillars.rows` against `target_percentage`. A second pillar set or a
   rival calendar fragments the program; refine what is there. The pattern histogram (the R7
   baseline): `social_list_posts({ platform, status: "published", limit: 20 })` per connected
   platform, sorted by `published_at` yourself (the list orders by `created_at`), reading the
   `hook:` and `format:` tags; a row with neither (history from before the tagging convention,
   and every native post from the feeds) reads as `unclassified` in the histogram - say so and
   say how many; classify from the first line only when the deliverable labels it as your
   reading. Then `social_analytics_by_dimension({ group_by: "hook", from_date })` with
   `from_date` reaching back to the 20th post (the default window is the last 30 days) for
   engagement per pattern with its N (`posts` and `synced_posts`; `unassigned` is the untagged
   count; a row with `posts` 1 is an anecdote), and again with `group_by: "format"`. Fewer than
   20 published posts on a platform means no variance history, and the baseline says that
   instead of asserting a pattern.
3. Foundation. `customer_avatar_list`, then `customer_avatar_get({ id })` for EVERY persona (the
   context summary omits `buying_behavior` and `online_behavior`, the two blobs that decide the
   angles and the platforms); `before_after_grid_list` for the ids (rows carry the full
   `grid_items` blob), then `before_after_grid_get({ id })` per grid; `customer_journey_list`,
   then `customer_journey_get({ id })` per journey for `stages[].name` (the vocabulary every
   later `journey_stage` must use) and `customer_journey_avatar_list({ journey_id })` for the
   linked personas (not a pure read: its first call materialises the legacy `target_avatar_id`
   link, so say when it did). Validity, per foundation-first.md, is a finding and never a
   footnote: boilerplate ("your tool", "your website", "[Company]", a template persona name); a
   `buying_behavior` or `online_behavior` blob under non-canonical keys (the dashboard renders
   only `{ trigger, decision_cycle, stakeholders[], preferred_intake, budget_range, objections[]
   }` and `{ social_platforms[], device_preference, content_habits, information_sources[],
   daily_hours_online }`, so a rich avatar can be blank on screen for months); a grid with
   `target_avatar_id` null or a journey with no linked avatar (an object aimed at nobody);
   empty-after-populate (`populate_status` is stripped from every Olympus read, so this check
   runs only through `account_context_get({ domain: "social", verbose: true })`); stale against
   `updated_at` and what memory says the business changed. Name which persona each connected
   platform serves: each avatar's `online_behavior.social_platforms` is free text ("LinkedIn",
   "IG", "Facebook groups"), so map it to the six publisher slugs (`linkedin`, `twitter`,
   `facebook`, `instagram`, `tiktok`, `google_business_profile`) yourself. A connected platform
   no persona lists is a finding (the persona is incomplete, or the platform has no audience
   here); a platform a persona lists that has no row is a connect task from step 1; a persona
   whose platforms exclude a slug gets no post there, ever. Missing or invalid is filed, never
   silently filled: never invent a persona, never populate one from nothing, and never retire
   or restore a foundation object without the human. STOP - show the whole finding list from
   steps 1 to 3 as tasks (reconnects, picker activations by Page name, BYOK and native connect
   tasks, the timezone ask, each foundation gap with why it matters), one confirmation, then
   `pm_tasks_create({ project_id, title, description, task_type: "general" })` per finding,
   flat, with `project_id` from `pm_projects_list` (it filters only by `status`; find the
   marketing project in the returned list yourself, or `pm_projects_create({ name,
   project_type: "marketing" })` when none exists). Building a missing foundation with grounding
   is agency work for its own session, not a detour inside this one.
4. Knowledge rows. `memory_list({ type: "skill" })`, `memory_list({ type: "rule" })` and
   `memory_list({ type: "command" })`: every row comes back with `id`, `domain` (`_skill:<slug>`,
   `_rule:<slug>`, `_command:<slug>`), `name` and `content`. The social knowledge should be
   `_skill:social-post-craft`, `_rule:social-operating-rules`, `_rule:social-anti-fluff` and
   the two recipes `_command:social-post` and `_command:social-repurpose`. Abe's reseed writes
   the skill and the two rules account-wide and retires the rows they supersede
   (`_skill:social-content-batch`, `_rule:social-brand-consistency`) - but ONLY while the
   legacy row still byte-equals the legacy seed; the recipes are not seeded and are written
   per account here, from `references/recipes.md`. This step reconciles one account when the
   reseed has not run. Four checks, each write behind its own STOP, because a hydrated row
   shapes every post the department agent writes for this client:
   - `_skill:social-post-craft` absent: STOP, show the full text and the exact call, and on a
     yes `memory_create({ type: "skill", name: "social-post-craft", content })` - the text is
     Play 3 and the three craft references in MCP vocabulary, with the context call first, the
     foundation read, the sourcing, the drafting rules, the creative handoff (no 'creative'
     domain exists), persistence as drafts and the close of the loop, naming
     `social_create_post` (the MCP tool) and the department agent's `social_post_create` once
     each. A `_skill:social-content-batch` row present beside it, or instead of it, is the
     retired seed in python-CLI vocabulary (`python /app/tools/...` lines; every draft the
     agent hydrates from it points at tools that do not exist): REPORT it with its first lines
     and NEVER `memory_update` or delete it in place - the reseed retires it only while its
     content still byte-equals the legacy seed, and one changed byte turns that retirement
     into `kept_customized`, leaving the dead recipe hydrated for good. The note says the new
     skill supersedes it and the reseed retires it; until the reseed runs both rows exist, and
     the deliverable names the legacy one as inherited debt, not as something fixed here.
   - `_rule:social-operating-rules` or `_rule:social-anti-fluff` absent: STOP, show the full text
     of each, and on a yes `memory_create({ type: "rule", name: "social-operating-rules", content
     })` and `memory_create({ type: "rule", name: "social-anti-fluff", content })`. The operating
     rules are the twelve craft rules R1 to R12 from the skill, numbered so a review can cite
     them (the persona-and-stage header, hook first with the specific inside it, one idea one
     CTA from the pillar rung, proof by id, zero banned phrases and `Rubric: N/14` at 11 or
     better, the competitor swap, variance over the last 20, platform-native limits and link
     placement, draft only, library assets with alt text, the designer brief shape, every
     number names its call and its freshness). The anti-fluff rule is `references/anti-fluff.md`
     sections 2 to 4: the 45 banned phrases plus `brand.ai_forbidden_phrases`, the recycled-AI
     tells, the 7-axis rubric and the 11/14 gate with its hard fails.
   - `_command:social-post` or `_command:social-repurpose` absent: load
     `references/recipes.md` (the canonical text of both), STOP, show each verbatim, and on a
     yes `memory_create({ type: "command", name: "social-post", content })` and
     `memory_create({ type: "command", name: "social-repurpose", content })`. A recipe is the
     plugin command's steps in the DEPARTMENT AGENT's vocabulary, not the MCP names
     (`social_post_create`, `social_post_update`, `social_post_list`, `media_library_list`,
     `design_to_post`, `pm_task_create`, `memory_update(domain, content)` - the agent has no
     `social_post_validate`, `social_repurpose_source` or `social_posts_bulk_create`): the
     phrases that trigger it, the reads in order, the header and Rubric gate, the write as a
     DRAFT with its confirm, what it never does (no `scheduled_at`, no `social_post_publish`),
     under 2,500 characters, so a dashboard or department-agent session runs the same play
     `/hiveku:social-post` and `/hiveku:repurpose` run here. The file is the source: never
     rewrite a recipe from memory, and a row that already exists is compared to the file with
     the difference reported - replacing it is its own STOP.
   - Every created row's `content` begins `<!-- department: social -->` on its own line:
     `memory_create` has no `department` parameter and a `_skill:`, `_rule:` or `_command:`
     domain derives department NULL, and the department agents' hydration reads that tag line
     from the content - a row without it is treated as GLOBAL and hydrated into every
     department's agent, so an untagged social rule ends up in the SEO agent's context too (the
     seed route writes the same line). A 409 means the row exists: re-list and read it, never
     duplicate. A legacy `_rule:social-brand-consistency` row is reported, not
     edited or deleted here - the reseed retires it when it still byte-equals the old seed, and a
     delete is a human's explicit act. `memory_list({ domain: "social" })` last: when the
     department document is still the seeded template with blank lines, the baseline in step 5
     fills its sections through step 6's read-merge-write instead of appending a second copy.
5. The baseline deliverable, one page the client can read, every number naming its call and its
   freshness, unknown or unsynced never written as zero, a broken platform `partial` and named.
   Connections: per platform connected / picker (awaiting activation, the Pages by name) /
   broken (platform: `last_error`) / not connected (wanted, with the BYOK or native lane), `byok`
   flagged, the scheduling `timezone` or the ask for it. Audience: `social_analytics_followers({
   period: 90 })` per connected account - `current_followers`, `net_change`, `growth_rate`,
   `last_synced_at`; a stale `last_synced_at` is a stale trend, not a flat audience; an account
   with an empty `chart_data` is `not_synced`, never 0; the `summary` totals count only
   `is_active` rows, so a picker row's audience is not in them. Cadence: posts per week per
   platform from the live feeds (step 2) beside Hiveku's own count from `social_list_posts`
   (dates filter `created_at`), with X, TikTok and GBP labelled Hiveku-published only. Pattern
   histogram: hook and format per platform with N and the `unclassified` count, the winners from
   `social_analytics_by_dimension` with `synced_posts` as the denominator, and "no variance
   history" where the platform has under 20 published. Structure: pillars with targets, slots,
   the hashtag inventory size, the 14-day `social_calendar_gaps` summary, the inherited approval
   queue. The inherited inbox: `social_comments_digest({ days: 14 })` for the counts by status,
   sentiment and platform and the negatives past one business day unanswered - a client whose
   last agency left a negative comment open for a week has a same-day task, not a strategy
   note. Foundation state: per persona valid / invalid (why) / missing, each grid and journey
   linked or aimed at nobody, the platform-to-persona map, the tasks filed. X: "<used> of 60 X
   posts used this month, <remaining> remaining" or "X not eligible on the <plan> plan". Then the
   freshness lines from connection-health-and-syncs.md, filled in: post metrics from
   `social_posts_analytics_list({ post_ids, limit: 100 })` (`post_ids` is a comma-separated
   string, up to 100) over the published ids from step 2 ("synced through <newest synced_at>;
   posts published before <today minus 90 days> stopped syncing and are quoted as of their last
   sync (N posts)"); account metrics "daily snapshots through <the last chart_data date> (05:10
   UTC)"; comments "LinkedIn and Meta comments through <last sync>; X, TikTok and GBP comments
   are not collected here; posts older than 14 days are not re-read"; connections "N connected,
   N awaiting activation, N broken (<platform>: <last_error>)". State coverage: how many rows
   and posts were read of how many. Close with the
   first-month recommendation: the cadence per platform at or below what the account has
   sustained, the pillars to inherit or the four to six to build (Play 1), which persona each
   platform serves, the series candidates, the connect, activation and timezone asks in the
   order they unblock work, and the engagement-rate baseline with its denominator named. Nothing
   is drafted or scheduled from this command; the strategy is the client's sign-off and the
   first week is `/hiveku:social-plan`. The baseline facts - the roster with account ids, the
   picker and broken rows, the provider gaps, the X budget, the timezone state, follower counts
   with their dates, the cadence, the histogram, the platform-to-persona map, the foundation
   findings, the task ids and the date - go into the `social` department document through step
   6's read-merge-write, filling the seeded sections rather than adding a second copy.
6. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
