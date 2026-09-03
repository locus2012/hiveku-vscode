# Publishing, scheduling, and approval mechanics

Load this before any create/update/validate/schedule/publish/reject call, before a bulk
draft, a duplicate or a retry, before touching the calendar or the recurring slots, and
before answering "why didn't my post go out". Every state transition and failure mode
in this rail is documented here, and the contract table below is the ONE place the
plugin spells every parameter `social_create_post` and `social_update_post` carry
(other files call it the availability table; every row is SHIPPED). The craft that
fills the fields is in references/hooks-and-formats.md and
references/audience-grounding.md; connection health and the X count are in
references/connection-health-and-syncs.md.

## The calendar (events, not a container)

There is no calendar OBJECT to create and fill. The calendar IS its events: one
`social_calendar_create` call per planned slot. Required: `title`, `event_type`, and
`start_date` - miss any one and the call is a 400 "title, event_type, and start_date
are required". Full shape:
`social_calendar_create({ title, event_type, start_date, end_date, description,
target_platforms, tags, linked_post_id, color, icon, timezone, start_time, end_time,
is_recurring, recurrence_rule })`.
- `event_type` is free text (no server-side enum). Pick one convention up front and
  keep it - `planned_post`, `campaign`, `holiday`, `series` and `repurpose` are the
  values the skill uses. Nothing validates it, so a typo silently creates a second
  category.
- `start_date` is stored as a DATE; a time component on it is dropped. The slot time
  is `start_time` / `end_time` read in `timezone` (an IANA name such as
  America/Chicago); the same three fields are on `social_calendar_update`. Two
  spellings, by tool: 'HH:mm' on create (the create route parses `HH:mm`, `HH:mm:ss` or
  an ISO datetime and keeps the time part); on update send an ISO datetime whose time
  part is the slot, `1970-01-01T09:00:00Z` for 09:00 - the parser is on the create
  route today, and the update route writes `start_time` as sent into a time-of-day
  column, so a bare `HH:mm` there is a failed update, not a slot. The ISO form is
  accepted by both. An event with no `start_time` is a day, not a slot.
- Recurrence: `is_recurring: true` plus `recurrence_rule`, on create or on
  `social_calendar_update`. A series (a named recurring format on a fixed weekday) is
  one recurring event with `event_type: 'series'` and a matching slot
  (`social_schedule_slot_create`, below): the event says what runs, the slot says when
  the scheduler may offer the time. Three series per account is the ceiling the skill
  teaches.
- `linked_post_id` is what makes the calendar operational: it binds the event to the
  actual `social_posts` row, and it is checked against the account (a foreign or
  unknown post id is a 400). Create the post, then create (or update) the event with
  its id. An unlinked event is a sticky note.

Read with `social_calendar_list({ from_date, to_date, event_type, status,
linked_post_id, page, limit })` - limit max 100, default 50, ordered by start date.
Each row carries `linked_post` (`{ id, title, status, scheduled_at, target_platforms,
content_pillar }`), so the list already says whether a slot holds a draft, a scheduled
post, a held post, or nothing; the pillar is the linked post's pillar (events have no
pillar column). `social_calendar_get` returns one event with the same linked post.
Adjust with `social_calendar_update({ event_id, ... })`; remove a slot with
`social_calendar_delete({ event_id })`. Deleting an event does not touch the linked
post; deleting a post leaves its event behind with `linked_post_id` set to null. Keep
the two in sync yourself.

`social_calendar_gaps({ from_date, to_date })` (default: the next 14 days) is the
integrity read that replaces five list calls. Per platform per day it names what the
day holds - a slot, a scheduled post, a held post, an unlinked event, or a dark day
(nothing planned on that platform) - counts the window's posts per pillar against each
pillar's `target_percentage`, and lists series events missing their weekday. It writes
nothing. Run it before a week is scheduled and in the weekly cadence, and turn every
finding into a draft, a link (`linked_post_id`), or a task - never into a schedule
from here; a held post it surfaces is the client's action, not yours.

## The recurring slot calendar (the cadence as data)

The agreed posting cadence belongs in first-class fields the same way pillar ratios
live in `target_percentage` - not in a memory note. The slot tools encode it:

- `social_schedule_slot_create({ weekday, minute_of_day, timezone })` - creating a
  slot schedules NO posts; it only defines a time that `social_schedule_slot_next_open`
  will offer. `weekday` is 0-6 with 0 = Sunday, `minute_of_day` is 0-1439 local to the
  given timezone (so 9:30am is 570). `timezone` must be a valid IANA name such as
  America/Chicago. Optional: `social_account_id` restricts the slot to one connection
  (omit or null for all accounts), `label` (trimmed to 100 chars), `is_active`.
- `social_schedule_slot_list` - the account's slots. A slot with `social_account_id`
  null applies to every connection; one with it set applies only to that connection.
  Slots describe WHEN the account wants to post; they do not schedule anything.
- `social_schedule_slot_next_open({ count, social_account_ids })` - the next OPEN slot
  occurrences over a 14-day horizon: defined slots with no post already scheduled into
  them. Call this before scheduling instead of picking a time and hoping it is free.
  An empty list when no slots are defined is not an error - it means schedule by hand.
  `count` is 1-100, default 5; `social_account_ids` is a comma-separated string of
  connection UUIDs.
- `social_schedule_slot_update({ slot_id, ... })` - only supplied fields change;
  setting `social_account_id` to null widens the slot back to every connection.
  `social_schedule_slot_delete({ slot_id })` - posts already scheduled at that time
  KEEP their `scheduled_at` and still publish; deleting a slot only stops it being
  offered in future. To stop a post, unschedule the post.

Seed the slot times from `social_analytics_best_times` - suggested posting times
computed from THIS account's own engagement history, returned as concrete future
timestamps ready to pass as `scheduled_at`. An empty list on a new account or one with
too few samples is the honest answer, not a failure, and means schedule by the
calendar instead. Never substitute a generic best-times chart for the account's own
history.

## The contract table (every parameter on social_create_post and social_update_post)

Both tools carry an explicit allowlist of exactly these names; anything else is dropped
and named in `_dropped_params` on the response. Every row is SHIPPED. Rule, then trap.

| Param | Tool | Status | What it does | Trap |
|---|---|---|---|---|
| `content` | create, update | SHIPPED | the copy every target gets unless `platform_overrides` replaces it for that platform; required on create | validated per platform against the caps in references/hooks-and-formats.md section 2: on a draft the errors are echoed, on a scheduled post they are a 400 |
| `title` | create, update | SHIPPED | a label for the dashboard and the calendar | clamped to 255 characters silently; the header line lives in the deliverable, not here |
| `content_type` | create, update | SHIPPED | a label: text (default), image, video, article, document or carousel | it changes nothing about what publishes; the media arrays do |
| `target_platforms` | create, update | SHIPPED | the platform slugs (references/platform-playbooks.md); required on create | validation runs on the union of these and the platforms of `target_accounts`, so an Instagram account listed in `target_accounts` is validated for Instagram even when the slug is missing |
| `target_accounts` | create, update | SHIPPED | the connected-account row ids from `social_list_accounts` that will publish | not required by the tool, and a post with none is a 400 at publish time, after approval; every id must belong to the account (400 otherwise); pass only rows with `is_active` and `can_post` true |
| `media_urls` | create, update | SHIPPED | public https URLs, in carousel order | every publisher fetches over https only; Meta and GBP pull the URL themselves at publish, so it must stay reachable until then; on update the list you send REPLACES the media on the row |
| `media_types` | create, update | SHIPPED | 'image', 'video' or 'document' per `media_urls` index; a MIME type is accepted and normalized | omitted, the type is inferred from the URL extension, else 'image' - an extensionless video URL becomes an image; always send it with `media_urls` |
| `media_alt_texts` | create, update | SHIPPED | one description per media item, same order (rules in references/hooks-and-formats.md section 6) | stored and shown in the dashboard; no publisher sends it to any platform today |
| `media_asset_ids` | create, update | SHIPPED | Media Library ids, resolved server-side into URL, type, alt text and dimensions; appended AFTER `media_urls` in the order given; kept in `settings.media_asset_ids` and read back as `media_asset_ids` | a missing, foreign or non-https asset is a 400 (never a silent post without the asset you chose); 20 ids max and no platform takes more than 10; a duplicate id is attached once with a warning; a `source_type: 'url'` asset is a pointer, not a hosted file (warning); on update the resolved list REPLACES the media on the row |
| `link_url` | create, update | SHIPPED | the link the platform consumes: GBP's Learn more button, Facebook's link preview on a text-only post, LinkedIn's article share when the post has no media | Instagram ignores it; Facebook drops it when the post has media; the placement table is references/hooks-and-formats.md section 5 |
| `link_title`, `link_description`, `link_image_url` | create, update | SHIPPED | the link card as the dashboard previews it | no publisher sends them; the platform builds its own card from the URL |
| `first_comment` | create, update | SHIPPED | posted as the first comment after the post is live where a comment API exists (LinkedIn, Facebook, Instagram) | the outcome lands on each version row (`first_comment_status` posted / failed / unsupported, `first_comment_error`) and a failed comment never fails the post; X, TikTok and GBP are unsupported |
| `platform_overrides` | create, update | SHIPPED | `{ [platform]: { content, firstComment } }`: per-platform copy and comment on ONE post; the override is what that platform publishes and what validation checks for it | only those two keys are read at publish; any other key, or an unknown platform slug, is a 400 naming it (`first_comment` is accepted as an alias for `firstComment`); `null` clears every override; the schedule is still one instant for every platform |
| `tags` | create, update | SHIPPED | free strings; the analytics dimensions live here: `hook:<pattern>`, `format:<slug>`, `persona:<slug>`, `stage:<slug>`, `repurpose:<content_id>`, `batch:<id>` | nothing validates them; a misspelled slug is a group of one in `social_analytics_by_dimension` |
| `category` | create, update | SHIPPED | a free grouping label | clamped to 100 characters silently |
| `pillar_id` | create, update | SHIPPED | the content pillar from `social_pillar_list` | the pillar is a column, never a tag; the monthly ratio check reads it |
| `scheduled_at` | create, update | SHIPPED | the publish instant as ISO 8601 WITH a zone designator (`2026-09-10T15:00:00Z` or `...+02:00`); on update `null` unschedules | no designator is a 400 (the server refuses to guess a zone); a past instant is a 400 on create and, on update, only when the time is MOVED; setting it is publishing on a timer (Path A) |
| `scheduled_at_local` + `timezone` | create, update | SHIPPED | the wall clock (`YYYY-MM-DDTHH:mm`) in an IANA zone; `timezone` omitted falls back to the account scheduling timezone | together with `scheduled_at` in one call is a 400; no `timezone` and no account zone is a 400 (ask the client for the zone, references/connection-health-and-syncs.md); the response's `schedule.timezone_used` says which zone was applied |
| `linkedin_visibility` | create, update | SHIPPED | PUBLIC (default), CONNECTIONS or LOGGED_IN on the LinkedIn version | LinkedIn only; every other platform ignores it |
| `avatar_id`, `journey_id`, `journey_stage`, `before_after_grid_id`, `linked_content_id` | create, update | SHIPPED | the foundation links: which persona, journey and stage, transformation grid and repurposed content item the post serves; they are the `social_list_posts` filters and the `social_analytics_by_dimension` groups | each id is checked against the account and a foreign or unknown id is a 400 naming the field; `journey_stage` with `journey_id` must be a stage NAME on that journey (the 400 lists the real names); the header rule is references/audience-grounding.md section 6 |
| `linkedin_commentary` | create, update | SHIPPED | a stored LinkedIn note on the row | the publish path does not read it; LinkedIn copy goes in `platform_overrides.linkedin.content` |
| `ai_generated`, `ai_prompt` | create | SHIPPED | provenance; an Olympus create defaults to `ai_generated: true` | pass `ai_generated: false` only for copy a human wrote; the update tool does not carry either |
| `settings` | create | SHIPPED | a free JSON bag on the row; the server writes `media_asset_ids` and `batch_id` into it | nothing the publisher reads belongs here; never put copy, links or times in it |

### What the write returns (draft warnings vs the scheduled 400)

- A create returns 201 `{ data, validation: { errors, warnings }, schedule: {
  scheduled_at, timezone_used } }`. The validation object is the same one
  `social_post_validate` returns, so a validated plan and its create agree.
- A DRAFT (no schedule) is written even when a platform reports errors; the errors and
  warnings are echoed so the draft can be fixed before it is scheduled. Read them: a
  201 is not a clean post, and the same errors are a 400 the moment the post is
  scheduled.
- A SCHEDULED create, or an update that leaves the post at status 'scheduled', is a
  400 "Post fails platform validation" when any platform has an error (an Instagram
  post with no media, an X post over 280, five images on X). Nothing is written. Fix
  the error or drop the platform; never drop the schedule to get past the check and
  then schedule anyway.
- An update returns 200 with the validation object for the MERGED post (the row as it
  will be after the patch), so an update that only changes `tags` still tells you the
  copy is over LinkedIn's cap.
- `_dropped_params` on a 2xx names anything the mapping refused to forward. With the
  allowlist above it is empty; when it is not, a name is misspelled.

### The timezone rule

One post, one instant. Send EITHER `scheduled_at` (an ISO 8601 instant with `Z` or an
offset) OR `scheduled_at_local` (`YYYY-MM-DDTHH:mm`) with `timezone` (IANA). The
server refuses an instant with no zone designator rather than reading it in the
server's zone, and refuses both forms in one call rather than picking one. `timezone`
omitted falls back to the account's scheduling timezone
(`account_context_get({ domain: 'social', include: 'social' })` returns it as
`timezone`); when that is null too, the call is a 400 and the fix is a client
conversation, not a guess. Prefer the wall-clock form when the client said "3 PM
Sydney": it is what they said, and the response echoes the resolved instant in
`schedule`. Check it with `social_post_validate` first; it resolves the schedule the
same way and also says whether the instant is already past.

## Creating a post (the order of operations)

1. Ground it (references/audience-grounding.md), draft it
   (references/hooks-and-formats.md), score it (references/anti-fluff.md). Confirm
   client-facing copy with the user before the write.
2. `social_post_validate` with the same body a create would carry: `content`,
   `target_platforms`, the real `target_accounts`, `media_urls` + `media_types`,
   `media_asset_ids`, `platform_overrides`, and the intended schedule in either form.
   It writes nothing and returns `{ ok, validation: { errors, warnings }, schedule,
   media: { resolved, missing, warnings }, x_quota }`. A missing asset is REPORTED here
   where the write would 400 on it; `x_quota` appears whenever `twitter` is among the
   platforms, and a plan with more X drafts than `x_quota.remaining` fails on the last
   ones at cron time. Errors are the work list, not a footnote.
3. `social_create_post` as a DRAFT: no `scheduled_at`, no `scheduled_at_local`. A
   create with a schedule is not a proposal, it is a scheduled publish (Path A). Pass
   `target_accounts` every time. Persist the header on the row: `avatar_id`,
   `journey_id` + `journey_stage`, `before_after_grid_id`, `pillar_id`, the
   `hook:`/`format:`/`persona:`/`stage:` tags, and `platform_overrides` when one post
   serves several platforms.
4. Read the echoed `validation` and fix anything under `errors` with
   `social_update_post` while it is a draft.
5. The schedule is its own confirmed step (Path A). Never batch it across drafts.
6. Attach the calendar: `social_calendar_create` (or `social_calendar_update`) with
   `linked_post_id`.

Longer-form pieces that live in the content library first: `content_create`, then the
social post with `linked_content_id` pointing at it (the repurpose loop is
references/repurpose.md). `content_schedule` is the content workflow's own timing; it
does not schedule the social post.

### Many drafts at once: social_posts_bulk_create

`social_posts_bulk_create` writes up to 25 DRAFTS in one transaction. Each row is a
`social_create_post` body (the contract table applies row by row) plus, optionally, a
calendar day in either form: `calendar_event: true` with `proposed_date` (`YYYY-MM-DD`;
the server writes one all-day `planned_post` event on that day - today in the account's
scheduling timezone when `proposed_date` is omitted - titled from the post and tagged
`batch:<id>`), or `calendar_event: { title, event_type, start_date, all_day }` when the
event needs its own title and type (`start_date` decides the day and overrides
`proposed_date`; every key is optional and falls back to the boolean form's defaults).
Top-level `calendar: true` is the boolean form for every row. Either way the server
creates the event with `linked_post_id` already set. Rules:
- Drafts only. A row carrying `scheduled_at` or `scheduled_at_local` is a 400 for the
  whole batch. Scheduling stays one confirm per post afterwards.
- All or nothing. One invalid row (a missing asset id, a foreign avatar, a bad
  override key, more than 25 rows) refuses the batch and writes nothing; the per-row
  validation is echoed so the one row can be fixed and the batch resent.
- A `batch_id` is written to every post's `settings.batch_id` and as the tag
  `batch:<id>`, so a repurpose week can be reviewed or unwound as a unit. Keep the
  returned post ids in memory: `social_list_posts` has no tag filter.
- Platform errors on a draft are echoed, not fatal, exactly as on a single create.

## Revising a post

Review and revise with `social_get_post` and `social_update_post` while the post is a
draft, held, or scheduled. `social_update_post({ post_id, ... })` carries every row of
the contract table except `ai_generated`, `ai_prompt` and `settings`, and only the
fields you send change. The rules that bite:
- Media is replaced, not appended. Sending `media_urls` (with `media_types`) or
  `media_asset_ids` replaces the whole media list with what you sent; to add a slide,
  send the full list. Send `media_alt_texts` in the same call, same order.
- `scheduled_at: null` unschedules: the post returns to draft, unless it is held for
  approval, in which case it stays held with no time (Path A explains why an edit
  never releases a held post).
- `target_accounts` and `target_platforms` can be corrected here; every account id is
  checked against the account. Fix them while the post is a draft - a held post's
  targets are editable too, but the approver has already read the post.
- `social_update_post` CANNOT change status or approval state, and `status` /
  `approval_status` are not on its schema - they were removed rather than implemented,
  because a caller setting `approval_status: 'approved'` was once told it worked while
  the post stayed held. Passing either is an undeclared arg the proxy drops and names
  in `_dropped_params`. Never use them to approve a post or to force a state; approval
  is dashboard-only (see the approval queue below).
- A post at status 'publishing' or 'published' is EDIT-LOCKED: any update is a 400
  "Cannot modify a published post" / "Cannot modify a publishing post". It has already
  been handed to the platform. To revise, `social_post_duplicate({ post_id })`
  (below), edit the copy, and schedule the copy as its own confirmed step.
- `social_get_post` reads everything back: top-level `first_comment`,
  `platform_overrides`, `media_alt_texts`, `media_asset_ids` and the foundation ids;
  per version `status`, `error_message`, `first_comment_status`, `first_comment_error`,
  `retry_count` and the platform URL. `social_post_preview({ post_id })` shows the
  effective copy per platform after overrides, what sits above the fold, the character
  and hashtag counts against the platform's cap and norm, where the link goes, and the
  media composition; read it before the client does. Neither writes.

### Duplicating: social_post_duplicate

`social_post_duplicate({ post_id, title, target_accounts })` (both optional) clones
content, title (" (copy)" appended, still within 255), content type, media (URLs,
types, alt texts and library asset ids), `platform_overrides`, `first_comment`, the
link card, pillar, tags, category, targets and the foundation ids plus
`linked_content_id` into a NEW draft. It never copies `scheduled_at` (the copy is
unscheduled), approval state (the copy is `not_required`), publish state, versions, or
the rest of `settings`. Source targets that no longer exist on the account are dropped
and named in `dropped_target_accounts`; a `target_accounts` override must be owned by
the account or the call is a 400. It is the "revise a published post" path and the
series path (`hooks-and-formats` rotate the specific, not the frame). It writes a
draft, so it needs no confirm; the schedule that follows does.

### Re-driving a failure: social_post_retry (ask-gated)

A post can read `published` at the route level with one `failed` version (an expired
token, the X cap, a media URL that stopped resolving). Read the version rows on
`social_get_post` first and fix the cause: a token error is a connection job
(references/connection-health-and-syncs.md), the X cap is a budget job, "Publishing
not implemented" is a slug job. Then `social_post_retry({ post_id })` re-drives ONLY
the failed versions and skips every target that already published. It publishes, so it
is on the ask list and gets its own confirm, one post at a time. It refuses a held or
rejected post and a post with nothing failed (state answers, not glitches - read the
state, do not retry the retry). A retry of an X version still spends the X cap.

## Path A - the schedule (the one that actually ships content)

This path needs no approval anywhere:
- Set the time with `social_update_post({ post_id, scheduled_at })`. A clean draft moves
  to status 'scheduled'. Two posts do NOT, and both are silent:
  - A post already HELD for approval (status 'pending_approval' OR
    `approval_status: 'pending'`) keeps its status. The timestamp updates so the approver
    sees the new slot, but the post is still held and the cron will not touch it. Setting
    a time does not release it.
  - A REJECTED post (`approval_status: 'rejected'`) is sent straight back through
    approval: the service writes status 'pending_approval' and `approval_status:
    'pending'`. Re-scheduling a rejected post re-stages it into the queue, it does not
    schedule it. Say that, do not report it as scheduled.
  The publish cron runs every minute and takes every post with
  status 'scheduled' and `scheduled_at <= now` whose `approval_status` is not 'pending'
  or 'rejected'. The column defaults to 'not_required', which passes. So a schedule IS
  an unattended publish - treat setting `scheduled_at` with the same confirm you would
  give a publish, and never batch it across a week of drafts in one action.
- `scheduled_at` must be in the FUTURE on create: a past timestamp is a 400
  ("scheduledAt must be in the future"). On update the check only runs when you MOVE the
  schedule, so an already-overdue post can be edited and left overdue. Schedule in the
  account's own timezone; a timezone slip is a rejected create at best and a same-minute
  publish at worst.
- Before picking a time, check `social_schedule_slot_next_open` so two posts do not
  collide in one slot, and prefer a slot over a hand-picked timestamp.
- Scheduling is reversible until it fires - you can still edit the post or move the
  time. After it fires the post is edit-locked.

## Path B - `social_publish_post` (a governance gate, not a publish button)

- `social_publish_post({ post_id })` has three outcomes, and you must read the response
  body to know which one you got:
  - `approval_status` is 'approved' -> it publishes to the post's configured target
    accounts. This is the only outcome that puts a post live.
  - `approval_status` is 'not_required' (the default on everything you create) -> it
    does NOT publish. It writes `{ approval_status: 'pending', status: 'pending_approval' }`
    and returns HTTP 200 with `{ pending_approval: true, message: 'Post moved to the
    approval queue...' }`. Report that as "queued for approval in the dashboard". Never
    report it as published.
  - `approval_status` is 'pending' -> 400 "Post requires approval before publishing".
    'rejected' -> 400 "Post was rejected and cannot be published".
- NEVER call `social_publish_post` on a post that already has a `scheduled_at`. If it is
  unapproved, staging it moves it out of status 'scheduled' and the cron can no longer
  ship it - the post silently loses its slot until a human acts. If it IS approved and
  the schedule is still in the future, the call is refused with a 409 saying the post
  will publish automatically at that time. Either way the call only does harm.
- You cannot publish to a subset. The `platforms` arg is deprecated and ignored; the
  route always publishes to ALL of the post's `target_accounts`, and a post with none is
  a 400 "Post has no target accounts configured". Fix that BEFORE staging:
  `social_update_post({ post_id, target_accounts })` while the post is a draft, then
  `social_post_validate`. Get `target_accounts` right at create time anyway.
- Confirm the exact post and account(s) before every publish, and never loop
  `social_publish_post` over a batch of drafts.
- Retry discipline: retry ONE transient failure (timeout, 5xx). Never retry a 400/409 -
  those are state answers, not glitches, and the fix is reading the state. After an
  ambiguous timeout on a publish, `social_get_post` and read `status`, `published_at`,
  and the version rows BEFORE any second call - the first may have landed.

## Deleting - `social_delete_post` is NOT a takedown

It deletes the Hiveku row and its versions and does nothing to Instagram, LinkedIn,
Facebook, X, TikTok, or GBP - the post stays live publicly, and the record that held
the platform post id and url is now gone, so the pointer you would need to find and
remove it is destroyed along with the analytics history. To take a published post down,
remove it in the native platform app (or the dashboard) FIRST, then decide whether the
Hiveku record should go too. Use `social_delete_post` only on explicit instruction,
never as cleanup - and never on targets derived by pattern or age ("everything older
than a year"); only on explicit post ids the client named, one confirm each.

## The approval queue (the highest-frequency real workflow)

Draft -> client approves in the dashboard -> it goes out. Posts stall in that middle
step constantly, and nothing chases them on its own.

- Find the queue: `social_list_posts({ status: 'pending_approval', limit: 100 })`. Also
  sweep the legacy shape - posts left at status 'draft' or 'scheduled' with
  `approval_status: 'pending'` are held too and will not publish.
- Report the queue to the client by name, platform, and intended slot, and say plainly
  that the approval action lives in the dashboard SocialApprovalQueue and is theirs to take.
- **Approval IS reachable from this surface, and you must not use it.** There is no
  direct `social_approve_post` tool - deliberately, so the same agent cannot stage a
  post and approve it in the same turn - but the workflow node rail has a
  `socialApprovePost` node, so a workflow built and run from here can approve on the
  client's behalf. Treat that as off-limits: approving is the client's decision and the
  one step in this pipeline that is theirs alone. Build or run that node ONLY on a
  written client instruction naming the specific post, never to clear a stalled queue,
  and never as a convenience because approval is slow.
  Read the reason as a live risk rather than a rule: a post with no `scheduled_at`
  publishes THE MOMENT it is approved (see the next bullet), so an approval taken on the
  client's behalf is a publish taken on the client's behalf, with no window to undo it.
- Know what approval does, because it differs by post and it can go live instantly:
  - The post HAS a `scheduled_at` -> approving releases it back to status 'scheduled'
    and the cron ships it at that time. If the slot has already passed, it publishes on
    the next cron tick.
  - The post has NO `scheduled_at` -> approving PUBLISHES IT IMMEDIATELY. Tell the
    client that before they click.
  - Rejecting returns the post to status 'draft' with `approval_status: 'rejected'`.
    `social_publish_post` on it is a 400. Setting `scheduled_at` on it does NOT schedule
    it either - the service re-stages it into the approval queue at status
    'pending_approval' (Path A above). A rejected post only goes out by being revised
    and approved again by a human.
- After approval, verify rather than assume: `social_get_post({ post_id })` and read
  `status`, `published_at`, and each version's `status` / `error_message`. A post can
  report success at the route level and still have a failed version (an expired token,
  the X plan cap).
- Staging a post into the queue does NOT wipe its `scheduled_at` - the publish route
  writes only `approval_status` and `status`, and the approve route restores status from
  the timestamp. Do not "helpfully" re-set the time on a held post: it stays held either
  way, and you have only moved the slot the client was going to approve.

## Rejecting from the operator's side - `social_post_reject`

The one direction the operator CAN move a held post is backwards. When a factual error,
a wrong asset, or an off-brand claim is found in a post sitting in the approval queue,
do not just chase the client - a post with no `scheduled_at` is one client click from
an instant publish. Pull it:
- `social_post_reject({ post_id, reason })` rejects a post that is HELD for approval:
  it returns the post to draft with `approval_status: 'rejected'` and records the
  reason, which is stored and shown to the author. Safe and reversible - the post can
  be edited and staged again.
- It fails with 404 if the post is not currently awaiting approval, and 409 if someone
  approved it first. A 409 means the post may already be live or scheduled - go
  straight to `social_get_post` and check, then handle it as a takedown conversation if
  it shipped.
- There is deliberately no matching approve tool: releasing a held post is a human
  decision, made in the dashboard approval queue. Reject moves posts backwards only.
- Always write a real `reason` - it is the note the author reads - and tell the client
  what you pulled and why.

## The emergency brake (crisis hold)

When a client says "stop everything" (a PR incident, a death, a breaking story that
makes the queue tone-deaf), there is no single pause switch. The procedure:
1. Get the instruction in writing (who authorized the hold, and until when), and record
   it with `memory_create` plus a `pm_tasks_create` to lift the hold later.
2. List what will fire: `social_list_posts({ status: 'scheduled', limit: 100 })`. These
   are the live risk - the cron ships them minute by minute.
3. Per post, unschedule it with `social_update_post({ post_id, scheduled_at: null })`
   (the post returns to draft; a held post stays held) or move `scheduled_at` to a
   far-future timestamp - one post at a time, confirmed. Unscheduling is the cleaner
   brake because a draft cannot fire; a far-future time is a hold somebody must
   remember to revisit, so record either choice in the task from step 1.
4. Posts at 'pending_approval' are already inert, but tell the client NOT to approve
   during the hold - approval of an unscheduled post publishes instantly.
5. Slots need no touching - slots schedule nothing themselves.
6. A post at 'publishing' or 'published' is already out; that is a platform-side
   takedown conversation, not a hold.

## Pitfalls specific to this rail

- Setting `scheduled_at` IS publishing. The every-minute cron ships any post at status
  'scheduled' whose `approval_status` is not 'pending' or 'rejected', and the default
  'not_required' passes. There is no "propose a time" state. Confirm a schedule with the
  same seriousness as a publish, and never batch one across a week of drafts.
- `social_publish_post` on an unapproved post does NOT publish. It returns HTTP 200 with
  `pending_approval: true` and stages the post into the dashboard approval queue. Read
  the response body and report "queued for approval", never "published".
- No tool here can APPROVE a post; `social_post_reject` can only move a held post back
  to draft. Approval is a human action in the dashboard SocialApprovalQueue.
- A post at status 'publishing' or 'published' cannot be edited at all -
  `social_update_post` is a 400. `social_post_duplicate` makes the editable copy, and
  the copy is never scheduled until you schedule it.
- A post created with `target_platforms` but no `target_accounts` cannot publish - 400
  "Post has no target accounts configured", discovered only at publish time, after the
  client approved it. Always pass both, and run `social_post_validate` with the real
  accounts first.
- `scheduled_at` without a zone designator, or together with `scheduled_at_local`, is a
  400. The fix is the timezone rule above, not a retry.
- A draft 201 can carry `validation.errors`. Read them: the same errors are a 400 the
  moment the post is scheduled, and a client can approve a draft that will then fail.
