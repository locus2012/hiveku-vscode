---
description: "\"Someone commented on our post\" / \"are we replying to comments?\" - work the engagement inbox: sync, triage the queue, brand-voice replies one confirmed send at a time, negatives cleared within one business day."
---
Engagement pass. Follow the **hiveku-social-agency** skill (Play 6). The SLA is the one its
`references/engagement-inbox.md` sets: every comment that enters the negative queue leaves it
(replied, escalated, or explicitly do-not-engage) within 1 business day. Context:
`account_context_get({ domain: "social" })`.
1. `social_post_comments_sync({ post_id })` on each recently published post FIRST - the inbox
   refreshes only every 2 hours on its own, so nothing downstream is current until this runs. It
   covers Facebook, Instagram and LinkedIn; a platform with no comment API returns the stored rows
   with `sync.synced: 0`, and a second call reporting zero new comments is correct behavior, not an
   error. A resync never clobbers reply or triage fields.
2. Read the queue with two calls, not one blind list: `social_comments_list({ requires_response:
   "true", limit: 100 })` (the response queue - every comment in it gets triaged, none skipped) and
   `social_comments_list({ sentiment: "negative", limit: 100 })` (the reputation queue, on the
   1-business-day SLA). The boolean filters are STRINGS ("true"), and `limit` maxes at 100 but
   defaults to 30 - a bare call silently truncates a busy week; page past 100.
3. Load `references/engagement-inbox.md` from the hiveku-social-agency skill BEFORE drafting
   anything. Run each negative comment through its four-lane rubric and record the lane in
   `ai_category`: **service complaint** (empathetic public acknowledgment moving the detail to a
   private channel, plus open the support loop - the reply is the receipt, not the resolution);
   **sales-adjacent objection** (brand-voice reply; a lead hiding in it goes to the CRM lane);
   **reputation risk** (do NOT reply first - escalate same-day with a high-priority
   `pm_tasks_create` naming the thread); **do-not-engage** (legal threats, harassment, spam -
   never reply publicly from a tool; document and escalate to the human owner). Criticism is
   usually answered, not deleted.
4. Draft replies in brand voice via `talk_to_department({ domain: "social", message })` for
   anything nuanced. STOP - present the triage (lane, status, draft) and get a yes before writing
   it with `social_comment_update({ comment_id, status, sentiment, requires_response, ai_category,
   ai_suggested_response })` - triage only, nothing here reaches a platform, and
   `ai_suggested_response` is where a draft waits for human review.
5. Send where a reply path exists from here - Facebook, Instagram and LinkedIn comments on OUR
   OWN posts, via `social_comment_reply({ comment_id, reply_content, ai_generated })`. It publishes
   publicly and immediately: no draft mode, no undo, `reply_content` max 2200 characters. STOP
   before EACH send - quote the exact comment and the exact reply text, one comment per confirm,
   never a batch. `recorded: false` means the reply IS live and only the local write failed:
   re-read with `social_comment_get`, NEVER retry - a retry posts a second public reply. A 409
   `reconnect_required` means the connection lost the reply scope - raise a reconnect task. A
   successful reply flips the comment's status to 'replied' by itself.
6. LinkedIn outbound (someone ELSE's post): `social_linkedin_comment_add({ social_account_id,
   post_urn, text })` and `social_linkedin_reaction_add({ social_account_id, post_urn,
   reaction_type })` - both publish publicly and immediately as the brand, no undo. STOP - confirm
   each one individually. This outbound rail is LinkedIn-only; there is no outbound
   comment/reaction tool for Meta, X, TikTok, or GBP.
7. Platforms with NO reply path from here - X, TikTok and Google Business Profile
   (`social_comment_reply` returns 400 on them): say so plainly - "I cannot send this reply from
   here; a human posts it in the native app." STOP - confirm, then file the drafted reply via
   `pm_tasks_create({ project_id, title })` with the draft text and the comment link in the
   description, for the dashboard operator. Never pretend to send.
8. Pre-scripted honesty line for DM asks: there are NO DM tools on this surface, on any platform.
   "Reply in their DMs" gets a truthful no - offer a public comment reply where a path exists,
   plus a `pm_tasks_create` for the native-app DM.
9. Close the loop: report the queue worked (replied / escalated / do-not-engage / filed as task)
   and name every SLA breach - a negative that sat past 1 business day is reported, not buried.
10. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
