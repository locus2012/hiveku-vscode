# Platform playbooks - cadence, copy norms, hashtags, and platform limits

Load this when setting or reviewing per-platform cadence, writing platform-native
copy, building or pruning hashtag sets, planning X volume against its cap, posting to
GBP, or answering "can we post to <platform>".

## Slugs and connections (the ground rules)

- The only platform slugs the publisher accepts are `linkedin`, `twitter`, `facebook`,
  `instagram`, `tiktok`, and `google_business_profile`. X is `twitter`, and Google
  Business Profile is `google_business_profile` - not `x`, not `gbp`,
  not `google_my_business`. A slug outside that set resolves to no publisher.
- A platform absent from `social_list_accounts` is not connected - you cannot post to
  it. But presence is not health either: check `connection_status`, `is_active`,
  `can_post`, and `last_error` (per row, or `social_account_get` for one connection's
  full picture including granted scopes). A connected-but-erroring account fails at
  the cron with nothing in your view. Do not draft into a void; raise the connection
  as a task and note it in the report so the client knows why a channel is quiet.
- Activation picker rows (`pending_selection`), `token_state` and what it cannot see,
  BYOK, the X quota count and the five background syncs:
  references/connection-health-and-syncs.md.
- Make the connect task actionable with `social_provider_list`: every platform Hiveku
  can connect, each with its required scopes, setup guide, and `hiveku_native` telling
  you whether a Hiveku app is configured on this deployment (false means the customer
  must register their own app). Read it before telling someone a platform is
  unsupported: usually the platform is fine and only the native app is unconfigured.

## Cadence per platform (record it as a decision)

- LinkedIn and Instagram feed: three to five posts per week is a strong retainer cadence.
- X (slug `twitter`): higher volume tolerated, five to fifteen posts per week, more
  conversational. HARD LIMIT: X is the one platform whose API bills Hiveku per post, so
  it is gated to the Premium plan and capped at 60 successfully-published posts per
  account per calendar month (resets on the 1st, UTC). Over the cap or off Premium, the
  X version of the post lands 'failed' with the reason on the version row while the
  other platforms on the same post still publish. Fifteen a week IS the cap - plan
  around 12-14 and check `social_get_post` versions for X failures. Read the count
  instead of estimating it: `social_list_accounts` returns a top-level `quota.x`
  (`{ plan, required_plan, eligible, used, limit, remaining, month_start_utc }`)
  whenever an X row exists, and `social_post_validate` returns `x_quota` whenever
  `twitter` is among the platforms. Budget the week from `remaining`; `eligible: false`
  is a plan conversation, not a content one.
- TikTok and Reels: two to four per week; consistency beats volume, but the algorithm
  rewards frequency more than the feed platforms do.
- Facebook: three to five per week, often the same asset as Instagram with copy tuned.
- Google Business Profile posts: one to two per week keeps the listing fresh and is a
  local-SEO signal - short, offer-or-update oriented, always with a call to action.
  There is NO direct GBP-post tool in the SEO lane. GBP What's New / offer / event posts
  are published through this lane: `social_create_post` with
  `target_platforms: ['google_business_profile']` and the GBP connected-account id in
  `target_accounts`. They run the same approval gate as everything else.

Encode the agreed cadence as recurring slots (`social_schedule_slot_create` - see
references/publishing-approval-mechanics.md) so "when we post" is data the scheduler
can check, not a memory note. Persist the reasoning with `memory_create`
(type 'strategy') so cadence and ratio are not re-litigated every month.

## Platform-native copy norms

The register per platform, in one line each:
- LinkedIn wants a strong first line and a professional register - long-form
  storytelling works.
- X wants a tight hook and a punchline; write the X version as its own post, never a
  trimmed LinkedIn post.
- Instagram wants a scroll-stopping first line and line breaks - scannable.
- TikTok wants a spoken hook in the first two seconds; the caption is secondary.
- GBP wants a short update with an explicit action; the action is the button.

Hooks, the fold per platform, the 17 formats, the CTA ladder, the first-comment link
strategy and alt text: references/hooks-and-formats.md. Whether the draft is good
enough to persist: references/anti-fluff.md.

Never cross-post one identical caption to every platform - it underperforms everywhere
and reads as automated. One post CAN carry per-platform copy: `platform_overrides`
(`{ [platform]: { content, firstComment } }`) on `social_create_post` and
`social_update_post` replaces the body and the first comment for that platform, and
those two keys are the only ones the publisher reads (any other key is a 400 naming
it). Read the effective copy per platform back with `social_post_preview({ post_id })`
before the client does. What one post cannot carry is two schedules or two media
sets: a post fires at one instant for every target, so platforms that need different
times, or a different asset, remain separate posts pointed at the same calendar event
via `linked_post_id`. The full row for every field: the contract table in
references/publishing-approval-mechanics.md.

## Hashtag strategy

Hashtags widen reach on Instagram and TikTok, help discovery on LinkedIn, and matter
little on X or Facebook. Treat them as a curated, per-platform inventory grouped by
pillar, not as an afterthought typed at publish time. The tracked-hashtag records are
inventory and performance history only: nothing attaches them to a post automatically.
The tags that actually publish are the ones you write into the post's `content` string
(or the platform's `platform_overrides` content), after the CTA, never in the hook line.

- The registry has no "set" object. `social_hashtags_create({ hashtag, platform,
  category, is_branded, is_favorite })` registers ONE hashtag on ONE platform, and both
  `hashtag` and `platform` are required. Build a set with `social_hashtags_bulk_upsert`
  (up to 100 `{ hashtag, platform, category, is_branded, is_favorite }` rows in one
  call, per-row results) or by looping the single create, using `category` as the
  pillar or campaign grouping - it is the only set-like field. Two behaviors worth
  relying on: both UPSERT on hashtag+platform (a re-run updates category and flags
  instead of duplicating, so re-running a set is safe), and a leading "#" is added
  automatically ('tag' and '#tag' are the same row).
- Audit before you prune, do not guess. `social_hashtags_list({ sort_by: 'engagement',
  limit: 100 })` ranks the account's tag inventory by earned engagement and returns
  times used, avg engagement, and avg reach per tag. Keep the top tier plus everything
  `is_branded`; delete the high-used / low-engagement tail with
  `social_hashtags_delete({ hashtag_id })`. Other sorts: `used`, `reach`, `trending`.
  Filters `is_trending` / `is_branded` / `is_favorite` take the STRING "true".
  `social_hashtag_get({ hashtag_id })` reads one tag's stored usage and performance
  counters - what has been recorded for it, not live platform volume.
- Reclassify without churn: `social_hashtag_update({ hashtag_id, category, is_branded,
  is_favorite, is_trending })` changes a tracked tag's classification flags in place -
  the route accepts exactly those four fields and silently ignores anything else, so
  the tag TEXT cannot be edited here: delete the row and create it again (the upsert
  makes the recreate safe).
- Research the tags with `talk_to_department({ domain: 'social', message })` - ask for a
  laddered mix per pillar: a few large-reach tags, several mid-size niche tags, and a few
  small/branded tags. All-huge tags bury the post instantly; all-tiny tags reach no one.
  The niche-tier tags are where a smaller account actually gets found.
- Platform application: Instagram tolerates a fuller set placed in the caption or first
  comment; TikTok wants three to five sharp, relevant tags; LinkedIn wants three to five;
  X and Facebook want one or two at most, and only when they add meaning. Never paste the
  Instagram set onto LinkedIn - the full ladder pasted onto LinkedIn or X looks amateur
  and can suppress reach. `social_post_preview` counts the hashtags per platform against
  these norms.
- Include a branded hashtag on every post to build a searchable body of content over
  time. Its structural home is `social_hashtags_create({ hashtag, platform,
  is_branded: true })` per platform, not a memory note - that way
  `social_hashtags_list({ is_branded: 'true' })` answers "what is our branded tag" for
  every future session. Record the reasoning in memory as well if it is contested.

## Format preferences (re-check monthly)

Format follows the platform's current preference: video and carousels are earning
outsized reach on the feed platforms; short vertical video carries TikTok and Reels.
Weight the calendar toward what the account's own numbers show is working now -
`social_analytics_by_dimension({ group_by: 'format' })` ranks the formats this account
has actually run (references/analytics-and-reporting.md) - and re-check monthly; the
platforms shift. Any claim about "what the algorithm rewards this quarter" is a dated
claim: ground it in the account's own numbers, not a remembered trend piece.
