# Analytics and reporting - the metric-source map and the monthly report

Load this before quoting ANY number: the baseline, the weekly performance check, the
monthly report, the creative performance loop (which hooks, formats and personas earn),
or an answer to "how did that post do". Every metric source here has a window, a
denominator, and a failure mode, and mixing them produces confident nonsense. How old
each number is, and the freshness lines a report ends with, are in
references/connection-health-and-syncs.md.

## Sync before read (the freshness discipline)

Live metrics lag the platform by minutes to hours to days - a number pulled too early
understates the post. Nothing downstream is current until a sync runs:
- `social_analytics_sync` (no args) refreshes post analytics for the whole account from
  the platforms in one call, capped at 50 post versions per run, and returns the run
  report. It only refreshes posts that are DUE, so calling it twice and having the
  second call report zero synced is correct, not a failure. For a month-end sweep, call
  it repeatedly until it reports zero synced - that is the completeness check.
- `social_post_sync_analytics({ post_id })` force-syncs ONE specific post. Use it to
  spot-force a straggler the account-wide sweep did not consider due, or before
  reading a single post's numbers for a same-day answer.

## The metric-source map (what each tool can and cannot give you)

- `social_account_analytics({ social_account_id, from_date, to_date, limit })` - daily
  account-level rows, ONE call per connected account. The required arg is
  `social_account_id` (the connected-account row id from `social_list_accounts`, not
  the Hiveku account id and not the platform's own account id); omitting it is a 400
  `social_account_id is required`. It returns whole daily rows, newest day first, limit
  max 100 / default 30 - so a 90-day baseline needs `limit: 100` or paging. The columns
  are `followers_count`, `followers_gained`, `followers_lost`, `net_followers`,
  `posts_published`, `total_impressions`, `total_engagements`, `total_clicks`,
  `avg_engagement_rate`, `page_views`, `unique_visitors`, `button_clicks`. There is NO
  reach column on this table - the tool's own description says "reach" and is stale.
  Account-level reach is impressions here; say impressions. Empty rows mean the
  account-analytics sync has not run for that account yet; say so rather than reporting
  zeros as a result.
- `social_analytics_followers({ period, social_account_id })` - follower growth per
  connected account over `period` days (1-365, default 30), with a daily series and a
  rolled-up summary of gained, lost and net change. This is the direct answer to "how
  did the audience grow this month/quarter". It reads STORED snapshots, so an account
  whose `last_synced_at` is old reports stale growth rather than an error - check
  `last_synced_at` before reading a flat line as a flat audience.
- `social_analytics_summary` - the blended topline for the trailing 7 DAYS ONLY. The
  route reads a `period` param the tool cannot send, so it ALWAYS returns the trailing
  7 days plus a comparison against the 7 before it. `from_date`/`to_date` on that tool
  are accepted and ignored. Use it for a week; never label its numbers as a month. It
  also hands back `changes` versus the prior week and a `best_post` / `worst_post`,
  and its `accounts` array is a good current follower-count-per-platform read. Its
  `engagement_rate` is engagements over IMPRESSIONS - say which denominator you quote.
- `social_post_analytics({ post_id })` - the only per-post metric source, one post per
  call: impressions, reach, engagements, likes, comments, shares, saves, clicks, video
  views, engagement rate, plus the per-platform version breakdown with each version's
  platform URL.
- `social_list_posts({ status: 'published', from_date, to_date, limit: 100 })` - the
  DELIVERY count only. It returns no metrics at all - id, title, content, platforms,
  accounts, status, approval_status, pillar and so on. Its date filter is on
  `created_at`, NOT `published_at` - close enough for a month you produced in that
  month, wrong for anything drafted long before it shipped. Say which you used.
- `social_analytics_timeseries` is a weak last resort: the tool exposes only `days`,
  the route never reads it (the route reads `from`/`to` params the tool cannot send),
  so it returns a FIXED trailing 30-day window no matter what you pass, and it can 404
  or come back empty until analytics sync is enabled for the account. Do not plan a
  baseline window around it. If it is empty, build the trend from the
  `social_account_analytics` daily rows instead and say the blended series was
  unavailable.
- `social_analytics_best_times` - suggested posting times computed from THIS account's
  own engagement history, returned as concrete future timestamps ready to pass as
  `scheduled_at`. Empty list on thin data = schedule by the calendar; that is the
  honest answer, not a failure.

## Bulk reads (many posts in one call, and the creative performance loop)

- `social_posts_analytics_list({ post_ids, from_date, to_date, limit })` - the latest
  analytics snapshot per version for MANY posts in one call (limit 100), each with
  `synced_at` and a `sync_stopped` flag. It replaces a loop of `social_post_analytics`
  calls for a month's top-content pass and for the freshness lines. Rules: an unsynced
  version comes back with no numbers, never zeros; `sync_stopped: true` means the post
  is past the 90-day sync ladder and its numbers are frozen at `synced_at` - quote them
  "as of <synced_at>", never as current, and do not force-sync a stopped post expecting
  movement. The dates filter the posts, not the snapshots.
- `social_analytics_by_dimension({ group_by, from_date, to_date })` - engagement,
  impressions and engagement rate grouped by `hook`, `format`, `pillar`, `persona`,
  `stage`, `platform` or `asset`: the `hook:` / `format:` / `persona:` / `stage:` tags,
  `pillar_id`, `avatar_id`, the platform, or `settings.media_asset_ids` ("which
  creative earned"). Every group carries N (the posts that contributed) and the
  window; an unsynced post is never counted as zero, so an N below the number you
  published in the window means unsynced or stopped posts, and the report says so.
  Read it before the format bets in the audit and the monthly report. A group with N
  under 5 is a hint, not a finding, and the report says N. A misspelled tag is its own
  group of one, which is the fastest way to find a tagging slip. Its rate and the
  `avg_engagement_rate` on `social_account_analytics` rows are computed differently;
  name the denominator each time (the comparability gate below).
- Where the 90-day stop applies: the per-post ladder (`social-analytics-sync`, every
  30 minutes on day one, then 4-hourly, daily, weekly, and off at day 90) freezes a
  version 90 days after it published, so both reads above go stale per post and say so
  (`sync_stopped`). It does NOT apply to `social_account_analytics` or
  `social_analytics_followers`: the daily account snapshots keep accruing while the
  connection is healthy. Comments have their own 14-day window
  (references/connection-health-and-syncs.md). A comparison that reaches back past 90
  days compares a frozen number with a live one; say so in the line that makes it.

## The real-feed baseline (what Hiveku's tables cannot see)

`social_list_posts` only knows what Hiveku published. A client with a native posting
history looks like a dead account if you baseline from it alone - and you will propose
a strategy built on false history. Before claiming to know the account's voice,
cadence, or format mix, read the ACTUAL feeds:
- `social_meta_post_list({ social_account_id, limit, after })` - the connected Facebook
  Page's or Instagram account's actual feed, read live from the Graph API, including
  posts made in the Meta apps. Facebook returns message, permalink and
  like/comment/share summaries; Instagram returns caption, media_type, permalink,
  like_count and comments_count - Graph exposes no share count for Instagram, so that
  field is simply absent rather than zero. The returned id is the platform post id the
  analytics surfaces take. Page with the returned `paging.after` cursor; limit 1-50,
  default 25.
- `social_linkedin_post_list({ social_account_id, limit, start, sort_by })` - the
  connected page's or profile's actual LinkedIn timeline, read live; the only way to
  see posts made on LinkedIn directly. Returns the post URN, which is what the
  reactions, comments and member-analytics tools take. limit caps at 50 (LinkedIn's
  own maximum); page with `start`.
- X, TikTok, and GBP have no live-feed read on this surface - for those platforms the
  Hiveku-published history is all you have, and the baseline must say so.

## The LinkedIn live analytics rail (org pages vs personal profiles)

These call api.linkedin.com live and answer questions the stored snapshots cannot.
Know which connection type you hold - the org endpoints refuse personal profiles:
- `social_linkedin_share_stats({ social_account_id, from_date, to_date })` - LIVE
  organization share statistics: impressions, unique impressions, clicks, likes,
  comments, shares and engagement for the page as a whole, with organic-only figures
  alongside the totals so paid amplification does not read as organic reach.
  ORGANIZATION CONNECTIONS ONLY - a personal profile returns 400. Supply `from_date`
  and `to_date` TOGETHER for a per-day breakdown; one alone is rejected.
- `social_linkedin_follower_stats({ social_account_id })` - LIVE follower composition:
  organic vs paid, by association type (employee, member) and job function. This is
  WHO follows the page, not a count over time - for the trend use
  `social_analytics_followers`. Breakdown arrays come back null when LinkedIn withholds
  them below its minimum audience size, which is not an error. Org connections only.
- `social_linkedin_page_stats({ social_account_id, from_date, to_date })` - LIVE page
  traffic: page views split by tab (all, overview, careers) and unique visitors. This
  is profile traffic, NOT post reach - someone who saw a post in the feed is not
  counted here. Org connections only; dates travel together.
- `social_linkedin_member_stats({ social_account_id, post_urn })` - LIVE creator
  analytics for a PERSONAL profile: impressions, likes, comments, shares, clicks and
  engagement rate per post, plus follower count. The org endpoints refuse personal
  connections, so this is their only analytics surface. Needs the member analytics
  scopes on the LinkedIn app; an app without them returns 502 however the connection
  was made.
- `social_linkedin_reaction_list({ social_account_id, post_urn })` - LIVE reaction
  counts by type (LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY). The stored
  analytics snapshot flattens all of these into one like count, so this is the only
  way to see that a post got INSIGHTFUL rather than LIKE. An older post whose
  reactions LinkedIn no longer serves returns an empty object, not an error.
- `social_linkedin_organization_list` / `social_linkedin_organization_get` /
  `social_linkedin_profile_get` - live administrative reads: which orgs the connection
  administers (and whether an admin was removed behind our back), one org's public
  detail (`org_id` is the bare numeric id, not a URN; 502 when the connection does not
  administer it), and the member whose token the connection carries.

## Measurement-artifact-first triage

Before ANY causal narrative about a metric move ("the algorithm changed", "content
fatigue", "the audience is tuning out"), rule out measurement artifacts in this order:
1. Did the sync run? (`social_analytics_sync` report, empty `social_account_analytics`
   rows, stale `last_synced_at` on the followers series.)
2. Is the window what you think it is? (`social_analytics_summary` is always 7 days; a
   "monthly" drop that is really one soft week. `social_list_posts` dates filter
   `created_at`, not `published_at`.)
3. Did the connection break mid-window? (`social_account_get`: `connection_status`,
   `last_error`. A disconnected account stops accruing metrics and reads as a crash.)
4. Did a version silently fail? (the X monthly cap, an expired token - check version
   rows on `social_get_post`.)
Only after those are ruled out is the story about content, timing, or the platform.
The data being fine does not make the interpretation fine.

## The comparability gate

- Never mix engagement-rate denominators in one trend line:
  `social_analytics_summary` computes `engagement_rate` as engagements over
  IMPRESSIONS, while `social_account_analytics` rows carry `avg_engagement_rate` from
  the platform's own daily sync. They are not the same number. Name the denominator
  every time.
- Never total stored-snapshot numbers with live LinkedIn endpoint numbers - different
  collection times, different definitions. Report them side by side, each labeled with
  its source and window; do not compute a blended figure.
- There is no monthly REACH figure in this lane: `social_account_analytics` has no
  reach column, and the only reach numbers available are per-post
  (`social_post_analytics`) and a trailing-7-day blended total from
  `social_analytics_summary` that SUMS each post version's reach, so it double-counts
  anyone two posts reached. Report impressions for the month; if you quote reach,
  label it as the top posts' reach or the closing week's, never as the account's
  monthly reach.
- Cross-platform comparison is directional only - each platform defines an impression
  differently. Compare a platform against its own prior period first.

## The monthly report (the artifact the retainer pays for)

Build it from named tool calls only - every number must be reproducible.

1. Gather the month's data, in this order:
   - `social_analytics_sync` repeatedly until it reports zero synced (each run caps at
     50 post versions), then `social_post_sync_analytics({ post_id })` on any straggler
     you need current that the sweep did not consider due. Nothing downstream is
     current until this runs.
   - `social_account_analytics({ social_account_id, from_date, to_date, limit: 100 })`
     once PER connected account - the month's real per-platform daily series.
   - `social_analytics_followers({ period })` for the follower-growth rollup
     (gained/lost/net) per account; check `last_synced_at` before trusting a flat line.
   - `social_posts_analytics_list({ post_ids })` for the month's published posts in one
     call (read `sync_stopped` and `synced_at` per post), then
     `social_post_analytics({ post_id })` on the top few for the per-platform version
     breakdown and the platform URLs.
   - `social_analytics_by_dimension({ group_by: 'hook' })`, then `'format'` and
     `'persona'`, for the creative loop: which patterns earned this month, with N.
   - `social_list_posts({ status: 'published', from_date, to_date, limit: 100 })` for
     the delivery count (dates filter `created_at` - say so).
   - `social_analytics_summary` as the closing-week snapshot, never the month's topline.
2. Report sections, in this order:
   - Executive summary - five bullets max: headline metric (impressions or follower
     growth), the single best post and why, biggest learning, what we shipped, what is
     next. Written last, placed first. Never hide a partial month here - if a platform's
     data is partial, the summary says so.
   - Growth and impressions - followers gained per platform MoM
     (`social_analytics_followers` rollup, cross-checked against the
     `social_account_analytics` daily rows) and the `total_impressions` trend (first
     row of the month versus last). Show the direction, not just a snapshot.
   - Top content - the three to five best posts by engagement
     (`social_post_analytics`), each with the pillar, format, and the reason it worked.
     This is where you prove the strategy, not just the activity.
   - Pillar and cadence delivery - posts published per platform vs the committed
     cadence (`social_list_posts({ status: 'published', platform, from_date, to_date })`,
     read `pagination.total`), and the actual pillar ratio vs target: one
     `social_list_posts({ pillar_id, status: 'published', from_date, to_date })` per
     pillar, compared against that pillar's `target_percentage` and
     `target_posts_per_week` from `social_pillar_list`. Do not use the pillar's own post
     count for this - it is lifetime, not the month. Honesty here builds trust.
   - Approval queue - anything still at status 'pending_approval' at month end, named,
     with how long it has waited. Unshipped approved-pending content is the single most
     common reason a month underdelivers, and it is the client's action, not yours.
   - Engagement and community - comments handled, notable conversations, leads or
     support issues routed to other departments.
   - Next month plan - the calendar theme, any campaign, the format experiments queued.
   - Local clients: a Google Business Profile line - posts published
     (`social_list_posts({ platform: 'google_business_profile', status: 'published',
     from_date, to_date })`). Listing-side signals (views, calls, direction requests)
     come from the SEO lane's GBP tools, not from these; if that connection is not
     available, say the listing engagement was not measured rather than implying zero.
3. Sample transparency: every aggregate discloses N, how it was chosen, and what was
   excluded. "Top content" names how many posts were scored out of how many published,
   and that selection was by engagement from `social_post_analytics`. If unsynced posts
   or failed X versions were excluded, the report says so - a sample that quietly
   excludes the failures is not a report.
4. Per-platform honesty states - every platform line carries exactly one of:
   `measured` (synced data for the window), `not_synced` (rows empty, sync has not
   run), `partial` (connection failed or disconnected mid-window - report what was
   captured and the gap), or `not_connected`. `not_synced` and `unknown` NEVER become
   zeros or passes; a failed platform is `partial`, excluded from blended denominators,
   and named - never silently dropped, and never averaged in.
5. Persist the report as a deliverable so the client can read it: capture it with
   `content_create` (or the account's reporting surface) and log the delivery decision
   with `memory_create`. Reflect completed production against `pm_tasks_complete`.
6. Numbers must reconcile: every figure in the narrative traces to a specific tool
   call. No vibes, no rounding a flat month up into a win. Surface contradictions
   between sources side by side instead of averaging them away.

## Benchmarks and decision rules

- Engagement-rate reality (for orientation, never a promise). Name the denominator
  every time (see the comparability gate). Organic feed engagement in the low single
  digits is normal and healthy; 1 percent-plus on a sizeable Instagram or LinkedIn
  account is solid; anything much higher usually means a small account or a genuinely
  strong post. Judge every account against ITS OWN baseline from month 1, not against
  a global average.
- Growth timeline: organic social compounds slowly. Meaningful follower and reach
  growth shows over three to six months of consistent posting plus engagement, not in
  weeks. Put that window in the plan so the report never has to apologize for a
  patient month.
- Anomaly rule: any post more than 2-3x the account's normal engagement is studied and
  its format banked as a repeatable play; any week with zero posts published on a
  connected platform is a service failure - never let it happen quietly. But run the
  measurement-artifact triage above before crediting or blaming the content.

## Data pitfalls

- Per-post metrics come from `social_post_analytics` (one post, with the per-platform
  breakdown) or `social_posts_analytics_list` (many posts, with `synced_at` and
  `sync_stopped`); the grouped view is `social_analytics_by_dimension`.
  `social_list_posts` returns no metrics at all. `social_analytics_summary` is
  7 days, `social_analytics_timeseries` is a fixed 30 and may be empty. If a number the
  report calls for is not obtainable from one of those, say it is unavailable and why -
  never estimate it into the deliverable.
- A post older than 90 days is frozen (`sync_stopped`). Its number is dated, not
  current, and the freshness line names how many such posts the report includes.
- `hiveku-data/social/` snapshots go stale the moment the account posts or a metric
  updates - read them for orientation and voice recall, but confirm anything
  decision-grade (live status, current followers, today's engagement) with a live tool.
- Empty analytics rows mean the sync has not run - report that, do not report zero.
