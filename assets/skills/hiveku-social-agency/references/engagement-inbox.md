# The engagement inbox - comments, replies, and the outbound rail

Load this before ANY engagement pass: reading comments, triaging the queue, drafting
or sending a reply, reacting or commenting from the brand account, or deciding what a
negative comment escalates to. Every write in this file reaches a public platform.

## The comment lifecycle (sync -> triage -> draft -> reply -> close)

The engagement inbox only refreshes every 2 hours on its own. The first hour after
publishing is the highest-leverage reply window - the algorithm reads early engagement
as a quality signal - and that window is unreachable from a stale inbox. So the pass
always starts with a sync:

1. **Sync**: `social_post_comments_sync({ post_id })` pulls a post's comments from its
   platforms RIGHT NOW and returns them, including the ones just ingested. Call it on
   each recently published post before replying or the thread will be stale. Covers
   Facebook, Instagram and LinkedIn; platforms with no comment API return the stored
   rows with `sync.synced` 0 rather than an error. A resync never clobbers reply or
   triage fields.
2. **Read the queue** with two concrete calls, not one blind list:
   - `social_comments_list({ requires_response: 'true', limit: 100 })` - the response
     queue, the thing you actually work.
   - `social_comments_list({ sentiment: 'negative', limit: 100 })` - reputation risk,
     handled same-day.
   `search` does a case-insensitive contains match on comment text when you are chasing
   a specific thread, and `status` filters the triage state. The boolean filters are
   STRINGS ("true"), not booleans - same for `ai_generated` on `social_list_posts` and
   `is_active` on `social_list_accounts`. Limit is max 100 and DEFAULTS TO 30, so a
   bare call silently truncates a busy week; pass `limit: 100` and page.
   `social_comment_get({ comment_id })` returns one comment with its post, the
   connected account it arrived on, our own reply if any, and any threaded replies.
   `reply_content` plus `replied_at` is the record that a reply was actually published;
   a comment with neither is unanswered.
3. **Triage** with `social_comment_update({ comment_id, ... })` - TRIAGE ONLY, nothing
   here reaches the platform. It sets workflow state: `status` (e.g. 'new',
   'reviewed', 'dismissed'), `sentiment`, `requires_response`, `ai_category`, and
   `ai_suggested_response` - a DRAFT reply, stored for a human and never sent. Passing
   `reply_content` here is rejected with 400: it used to be accepted, recorded as
   sent, and posted nowhere. This is how a worked comment leaves the queue - without
   closing status/`requires_response`, the same comments re-surface every weekly pass.
4. **Draft** replies in the brand voice with `talk_to_department({ domain: 'social',
   message })` for anything nuanced (a complaint, a sales-adjacent question, a
   sensitive topic). Straightforward thank-yous can be written directly. Stage a
   nuanced draft into `ai_suggested_response` via `social_comment_update` when a human
   should review it before it goes out.
5. **Reply** - only after an explicit confirm on the exact text and the exact comment.

## The reply contract - `social_comment_reply` (read this before every send)

`social_comment_reply({ comment_id, reply_content, ai_generated })` PUBLISHES A PUBLIC
REPLY to a comment on Facebook, Instagram or LinkedIn, then records it against the
inbox row. Its contract, exactly:
- Outward-facing and immediate: there is no draft mode and no undo. Confirm the exact
  text with the user before every non-trivial public reply.
- The platform call happens first, so a failure means nothing was posted AND nothing
  was recorded.
- A response with `recorded: false` means the reply IS live but the local write
  failed - re-read the comment (`social_comment_get`), NEVER retry, because a retry
  posts a second public reply. This is the one rule that cannot be learned by trying.
- 409 with code `reconnect_required` means the connection lost the reply scope - raise
  a reconnect task; do not hammer the call.
- X, TikTok and Google Business Profile have no reply API and return 400. For those
  platforms, replies happen in the native apps - surface them as tasks.
- `reply_content` max 2200 characters (Instagram is the tightest cap). Set
  `ai_generated: true` when the text came from a model; it is recorded for audit.
- A successful reply sets the comment's status to 'replied' itself - no follow-up
  `social_comment_update` needed for the status flip.

Workaround closures - these are not creativity, they are the failure modes:
- Do not loop `social_comment_reply` over the inbox. One comment, one confirm, one
  send. "Reply to everything" is refused as a bulk action.
- Do not draft-and-send in one step: the confirmed text is the text that ships, and
  approval of a DIFFERENT draft does not carry over to a rewritten one.
- Do not "test" a reply on a real comment. There is no sandbox on this rail.
- Do not treat a timeout as a failure: after an ambiguous outcome, read the comment
  back (`social_comment_get` - `reply_content` + `replied_at` is the proof) before any
  second attempt.

## The LinkedIn outbound rail (engaging beyond our own posts)

Outbound engagement on LinkedIn - commenting and reacting from the brand account on
other people's posts - is a real tool surface, and on most retainers a paid
deliverable. On every other platform outbound engagement is still done in the native
apps.
- `social_linkedin_comment_add({ social_account_id, post_urn, text })` PUBLISHES A
  PUBLIC TOP-LEVEL COMMENT on a LinkedIn post as the connected page or profile,
  immediately. Outward-facing, no draft mode, no undo. This is for commenting on
  someone else's post; to answer a comment on OUR OWN post use `social_comment_reply`,
  which records the reply against the engagement inbox so it is not re-surfaced as
  unanswered. Text max 2200 characters. Confirm every one - it is the brand speaking
  in public on someone else's content.
- `social_linkedin_reaction_add({ social_account_id, post_urn, reaction_type })`
  PUBLISHES A PUBLIC REACTION (LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY;
  default LIKE) as the connected page or profile, immediately, with no undo offered by
  the route. Use it to engage from the brand account on a partner or employee post,
  not on your own content.
- `social_linkedin_comment_list({ social_account_id, post_urn, limit, start })` - the
  LIVE comment thread on ANY LinkedIn post URN the connection can see, including posts
  Hiveku never published. For a post Hiveku did publish, prefer
  `social_post_comments_sync` - it stores what it finds so replies can be tracked.
- Post URNs come from `social_linkedin_post_list` (our own timeline) or from the
  client naming a target post.
- `social_linkedin_comment_delete({ social_account_id, post_urn, comment_urn })`
  PERMANENTLY DELETES A COMMENT FROM LINKEDIN. Destructive, outward-facing and
  irreversible: LinkedIn keeps no copy and offers no restore. It can remove someone
  else's comment from a page you administer, so treat it as moderation and confirm
  with a human first - name the exact comment, quote its text back, and get a written
  yes. Deleting a comment does NOT remove the stored row in the engagement inbox.
  Never delete comments as bulk cleanup, and never delete criticism just because it is
  negative - see the escalation rubric below.

## Negative comments - the escalation rubric

"Negative, handled same-day" needs an operating definition. Triage each negative
comment into one of four lanes, and record the lane in `ai_category`:
1. **Service complaint** (an actual customer with an actual problem) - draft an
   empathetic public acknowledgment that moves the detail to a private channel, AND
   open the support loop (helpdesk lane) so the underlying problem is worked. The
   public reply is not the resolution; it is the receipt.
2. **Sales-adjacent objection** (pricing, comparison, "does it do X") - a brand-voice
   reply drafted via `talk_to_department`, confirmed, sent. A lead hiding in an
   objection goes to the CRM lane.
3. **Reputation risk** (review-bombing, a thread going hot, an influential account
   piling on) - do NOT reply first. Escalate same-day: `pm_tasks_create` at high
   priority naming the thread, and hand to the reputation/owner conversation. A rushed
   public reply is fuel.
4. **Do-not-engage** (legal threats, harassment, spam, anything naming a legal
   dispute) - never reply publicly from a tool. Document (`social_comment_update`
   status 'reviewed', `requires_response: false` only after escalation), escalate to
   the human owner, and let legal/ownership decide. Deleting it is a moderation
   decision for a human, not a reflex.
The weekly cadence checks the SLA: every comment that entered the negative queue
should have left it (replied, escalated, or explicitly do-not-engage) within one
business day - report breaches, do not bury them.

## Routing the signals

A lead in the comments or DMs is a CRM job (hand to the CRM/inbox discipline), a
support question is a helpdesk job, a review mention is a reputation job. Social
listening feeds the other departments - do not let a hot lead die in a comment
thread. DMs and non-LinkedIn outbound engagement remain native-app work: surface them
as tasks; never claim to have handled them from here.

## What is still NOT possible here

- No DM tools, on any platform.
- No reply API for X, TikTok, or GBP comments (`social_comment_reply` returns 400) -
  native apps only.
- No outbound comment/reaction tools for Meta, X, TikTok, or GBP - the outbound rail
  is LinkedIn-only.
- Comment counts in stored analytics flatten LinkedIn reaction types into one like
  count - `social_linkedin_reaction_list` is the only per-type read.
