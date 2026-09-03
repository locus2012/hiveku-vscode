# Connection health and the background syncs

Load this during onboarding, before scheduling a week, and before quoting any freshness
line in a report: activation picker rows, `token_state` and what it cannot see, the X cap
and `quota.x`, BYOK, the five background syncs and their freshness contracts, and DMs as
helpdesk tickets. Slugs, cadence and provider setup live in
references/platform-playbooks.md; the publish cron and the schedule semantics live in
references/publishing-approval-mechanics.md; the metric-source map and the sync-before-read
rule live in references/analytics-and-reporting.md. This file covers the layer under all
three: whether a connection can publish, read and listen at all, and how old every number is.

## The roster is a picker, not a roster

A multi-entity connect (an agency login that administers many Pages or LinkedIn
organizations) stores EVERY entity the login can reach as its own row, inactive, flagged
`pending_selection`. Those rows are the picker a human ticks in the dashboard. Activation is
the moment somebody asserts "this page is ours and we post from it"; posting is gated on
`is_active`, so an inactive row is not a publishing target. The rules:
- `social_list_accounts` returns picker rows beside real connections. Read `is_active` and
  `pending_selection` per row; a row with `pending_selection: true` is a choice nobody has
  made yet, not a connected platform. Name them in the baseline ("3 Pages awaiting
  activation") and file a `pm_tasks_create` for the client to tick the right ones.
- No tool activates a row, and no tool disconnects one, by design. Disconnecting cascades
  every version, comment and analytics snapshot for that connection with no undo, so the
  Olympus account route is GET-only. Both are dashboard acts; never work around either.
- Pass only rows with `is_active: true` and `can_post: true` in `target_accounts`. A post
  aimed at a picker row is a dead post the client approves before it fails.
- A page that is also active on another Hiveku account is a surfaced conflict, not a block:
  an agency legitimately runs its own workspace beside a client's. Report it; do not decide.

## Health signals per row, and what they cannot see

`social_list_accounts` rows carry `connection_status`, `last_error`, `last_sync_at`,
`can_post`, `can_read_analytics`, `can_manage_comments`, `byok`, `pending_selection` and
`token_state`. `social_account_get({ social_account_id })` returns one row with its granted
scopes. Neither ever returns a token.
- `token_state` is `ok`, `expiring_soon` (under 7 days), `expired`, or `unknown`. `unknown`
  means the row stores no expiry, which is how Meta page tokens work: they do not expire on
  a schedule, they die when the user token that minted them is invalidated (password change,
  permission revoke, an admin removed from the Page). `unknown` is "cannot be predicted", not
  "fine".
- Meta has no refresh path at all. A Facebook or Instagram failure with a token error means
  a full re-consent; nothing self-heals. LinkedIn, X, TikTok and GBP refresh on their own
  and stamp `connection_status` `error` (LinkedIn writes `expired`) plus `last_error` when
  the refresh is refused for good. The account's owners get a high-priority in-app alert
  ("Reconnect your linkedin account"); the agent sees only the stamped row.
- The re-auth path is `/hiveku:connect-integration` (it reads `integration_connectors_list`
  first and says when a provider is dashboard-only); the fallback is the dashboard page
  `/<accountId>/dashboard/marketing/social/accounts`. Wider connection doctrine:
  hiveku-orient/references/integrations.md.
- Check order before a week: `social_list_accounts`, then `social_account_get` on every row
  whose `token_state` is not `ok` or whose `connection_status` is not `connected`, then
  `social_post_validate` on each draft with its real `target_accounts`, `media_asset_ids`
  and the intended `scheduled_at_local` + `timezone`. It returns
  `{ ok, validation: { errors, warnings }, schedule, media: { resolved, missing, warnings },
  x_quota }` and writes nothing. A week that fails validation is not scheduled; the errors
  are the work list.
- After a failed version: `social_get_post` and read each version's `status` and
  `error_message` before touching the copy. A token error is a connection job; the X cap is
  a budget job; "Publishing not implemented" is a slug job. Once the cause is fixed,
  `social_post_retry({ post_id })` re-drives ONLY the failed versions and skips targets that
  already published. It publishes, so it is ask-gated and gets its own confirm; it refuses
  held and rejected posts and posts with nothing failed.
- A healthy-looking row can still die mid-week. The cron stamps the row when it happens;
  nothing tells the agent. The weekly cadence's health step exists for that reason.

## X: Premium only, 60 published posts a month, and where the count lives

X is the one platform whose API bills Hiveku per post, so it is gated to the Premium
effective plan and capped at 60 successfully published X posts per Hiveku account per
calendar month (UTC, resets on the 1st, aggregate across every connected X handle). Only
`status: published` versions count; failed attempts spend nothing. The gate runs inside the
publisher, so over the cap only the X version of a post lands `failed` while the other
platforms on it still publish. The cap is soft and fails open: a count error lets a post
through, and two concurrent publishes near 60 can land a post over. Read it, do not
hard-code around it:
- `social_list_accounts` returns a top-level `quota.x` whenever an X row exists:
  `{ plan, required_plan, eligible, used, limit, remaining, month_start_utc }`. Budget the
  week from `remaining`, and quote `used`/`limit` in the plan and the report.
- `social_post_validate` returns `x_quota` whenever `twitter` is among the platforms. A plan
  with more X drafts than `remaining` is a plan that will fail on the last ones, silently,
  at cron time.
- `eligible: false` is a plan conversation, not a content one: every X version fails with
  `plan_upgrade_required` until the account is on Premium.
- For "how many did we ship to X this month" in a report, `social_list_posts({ platform:
  'twitter', status: 'published', from_date: <1st of month>, limit: 100 })` and
  `pagination.total` is the delivery count; `quota.x.used` is the cap count. They differ when
  a post drafted last month shipped this month (dates filter `created_at`), so say which.

## BYOK: whose app is behind the connection

Every platform connection runs through either a Hiveku-native app or the customer's own
registered app (bring your own key). `byok: true` on a row means the customer's app: its
scopes, its review status and its rate limits are the customer's to manage, and a
permission the app never requested is not a Hiveku bug. `social_provider_list` says, per
platform, whether a Hiveku-native app exists on this deployment (`hiveku_native`), the
scopes the connect needs, the redirect URI to register and the setup guide.
`hiveku_native: false` means BYOK is the only route: that is a connect task with a guide
attached, not an unsupported platform. Never tell a client a platform is unavailable before
reading it.

## The five syncs and their freshness contracts

Every number this department quotes was written by one of these jobs
(`hiveku_cron_worker/src/registry.ts`); the sixth job, the every-minute publisher
`scheduled-social-posts`, is documented in references/publishing-approval-mechanics.md.
Each sync only touches accounts that are `is_active`, `connection_status: connected` and
carry the matching capability flag, so a broken connection stops accruing data silently.
- `social-analytics-sync`, every 30 minutes, per-post metrics for published versions on a
  decay ladder by post age: every 30 minutes in the first day, every 4 hours to day 7,
  daily to day 30, weekly to day 90, then it STOPS (the next-sync column goes null). Eight
  consecutive failures also stop a post for good. Sources: Meta, X and LinkedIn deliver
  per-post metrics; TikTok inbox posts return nothing; GBP has no post-level read.
  Contract: a post older than 90 days never updates again, and its last `synced_at` is
  the number's date. `social_posts_analytics_list({ post_ids, from_date, to_date })`
  returns many posts in one call with `synced_at` and a `sync_stopped` flag; a stopped post
  is quoted as "as of <synced_at>", never as current. Force a due post now with
  `social_analytics_sync` (whole account, only what is due, 50 versions per run) or
  `social_post_sync_analytics({ post_id })` (one post). Gate: `can_read_analytics`.
- `social-account-analytics-sync`, daily at 05:10 UTC, one follower/page snapshot per
  connected account per day (followers gained and lost, impressions, GBP search views,
  clicks and calls) and a refresh of the row's `follower_count`. Contract: "followers today"
  is this morning's snapshot; `social_account_analytics` and `social_analytics_followers`
  read snapshots, so a stale `last_synced_at` is a stale trend, not a flat audience. Gate:
  `can_read_analytics`.
- `social-comments-sync`, a 15-minute tick that re-reads each post every 2 hours for the 14
  days after it published, LinkedIn and Meta only, and never overwrites a `replied` or
  `dismissed` row. Contract: X, TikTok and GBP comments never arrive here (native apps, filed
  as tasks); a post older than 14 days stops syncing, so a late comment on it is invisible
  until someone forces a read; the inbox is up to 2 hours stale on its own. Bring a pass
  current with `social_comments_sync_recent({ days, limit })` (the last N days' posts in
  one call, LinkedIn and Meta, says so per platform) or `social_post_comments_sync({ post_id })`
  for one post. Gate: `can_manage_comments`. Reply contract: references/engagement-inbox.md.
- `social-report-scheduler`, hourly at :20, delivers client report rows with `report_type:
  'social'` whose `next_scheduled_at` has passed: it snapshots the numbers into the report,
  emails `delivery_config.recipients` when configured and advances the schedule. Those rows
  are created with `marketing_report_create({ report_name, report_type: 'social', schedule })`
  (weekly, monthly or none), populated on demand with `marketing_report_regenerate`, and
  shared with `marketing_report_share_link` (a social report is private until you mint one).
  The social key now reaches these five names; there is no separate social report tool and
  no report list tool, so keep the returned id in memory. Contract: the client page shows
  the last scheduled snapshot, not live numbers; say when it was generated.
- `social-dm-sync`, every 2 minutes, polls Messenger and Instagram conversations for
  connected Pages whose app granted `pages_messaging` / `instagram_manage_messages`, and
  files them as HELPDESK tickets: `channel: 'chat'`, one ticket per conversation, message
  dedup on the platform message id, the first poll of a busy Page ingested silently so 20
  workflows do not fire at once. A missing messaging permission stamps the row
  (`dm_disabled_reason`) and polling stops until reconnect. Contract: DMs belong to the
  helpdesk department. There is no DM tool on this surface and the social key cannot see
  `helpdesk_` tools; "someone messaged us on Instagram" is `helpdesk_ticket_list({ channel:
  'chat' })` on a helpdesk or full key, worked per the hiveku-helpdesk-agency skill
  (hiveku-helpdesk-agency/references/tool-mechanics.md). Never claim to have read or answered
  a DM from here.

## The onboarding checklist (the baseline's connection half)

Run in this order on a first session; `/hiveku:social-onboard` is the command form.
1. `account_context_get({ domain: 'social', include: 'social' })`: the `social` section
   returns `timezone`, `pillars`, `accounts` (with `token_state`) and `schedule_slots` in
   one read, and the `has` counts tell you what is missing before you open a tool.
2. Roster and picker: `social_list_accounts`, every row classified as connected / picker
   (`pending_selection`) / broken (`connection_status` not `connected`, or `token_state`
   `expired`). `social_account_get` on every broken row for `last_error` and scopes.
3. Provider gaps: platforms the client wants that have no row, checked against
   `social_provider_list`; `hiveku_native: false` rows become BYOK connect tasks with the
   guide, the others become connect tasks pointing at `/hiveku:connect-integration`.
4. X budget: `quota.x` from step 2 (`eligible`, `used`, `remaining`).
5. Timezone: `timezone` from step 1 is `accounts.settings.timezone`. When it is null the
   account has no scheduling zone, `scheduled_at_local` without an explicit `timezone` is a
   400, and nothing on this surface sets it: ask the client for the zone, have them set it in
   the dashboard, and pass `timezone` explicitly on every schedule until it is set.
6. Structure that exists: `social_pillar_list`, `social_schedule_slot_list`,
   `social_hashtags_list({ sort_by: 'engagement', limit: 100 })`, `social_calendar_list` for
   the next 30 days. Inherit before creating.
7. Foundation: `customer_avatar_list`, `before_after_grid_list`, validity per
   hiveku-orient/references/foundation-first.md; missing or invalid is a finding filed as a
   task, never silently filled. Grounding rules: references/audience-grounding.md.
8. Record it: `memory_create` with the roster, picker rows, broken rows, provider gaps, X
   budget, timezone state and the date. The next session reads this instead of re-deriving.

## The freshness lines every report carries

Every deliverable that quotes a social number ends with these lines, filled in from the
calls above. They are the difference between a report and a guess.
- Post metrics: "synced through <newest synced_at>; posts published before <today minus 90
  days> stopped syncing and are quoted as of their last sync (N posts)". Source:
  `social_posts_analytics_list` `synced_at` and `sync_stopped`.
- Account metrics: "daily snapshots through <last snapshot date> (05:10 UTC)". Source:
  `social_account_analytics` newest row.
- Comments: "LinkedIn and Meta comments through <last sync>; X, TikTok and GBP comments are
  not collected here; posts older than 14 days are not re-read".
- Connections: "N connected, N awaiting activation, N broken (<platform>: <last_error>)".
- X: "<used> of 60 X posts used this month, <remaining> remaining" (or "X not eligible on
  the <plan> plan").
Unknown or unsynced never becomes zero; a broken platform is `partial`, named, and excluded
from blended denominators (references/analytics-and-reporting.md, honesty states).

## Worked example

Harbor and Pine Dental, first session. `social_list_accounts` returns seven rows: one
Facebook Page (`is_active: true`, `token_state: unknown`, `byok: false`), one Instagram
(`is_active: true`), four inactive Pages with `pending_selection: true` (the practice
manager's login also administers her husband's landscaping business and two charities), and
one LinkedIn organization with `connection_status: expired`, `last_error: "Token refresh
failed"`. No X row, so `quota.x` is absent. `social_account_get` on the LinkedIn row shows
the scopes are intact; the refresh token aged out. The baseline says: two connected, four
awaiting activation (named, with a task for the manager to tick only the dental Page if it
is among them), one broken (LinkedIn, re-auth link minted via `/hiveku:connect-integration`,
task filed), X not connected. `account_context_get({ include: 'social' })` returns
`timezone: null`, so the week is drafted with no `scheduled_at` and the client is asked for
the zone before anything is scheduled. The freshness lines read: post metrics synced through
this morning for 11 posts, none older than 90 days; account snapshots through today; comments
Meta only, LinkedIn not collected until reconnected. Nothing is activated, nothing is
disconnected, nothing is scheduled.
