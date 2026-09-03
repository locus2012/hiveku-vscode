# Reporting and Delivery

## What this covers / when to load this

This is the manual for the moment SEO work stops being analysis and becomes something a client sees or a machine executes: building the monthly report, curating sheet appendices, saving and versioning deliverables, aligning with the scheduled/automated reports that email themselves, and running the SEO task queue including the implement-with-AI rail that turns an audit finding into deployed code. Load it when you are assembling a report or deliverable, when you are about to write into the Sheet Canvas, when a client asks "what did you actually do", or when you are deciding whether a finding becomes a ticket, a recommendation, or a shipped change. The main SKILL.md tells you the arc (baseline, strategy, weekly cadence, monthly report) and the analysis plays that produce numbers. This file assumes the numbers already exist and is about what happens to them. It does not re-teach GSC pulls, rank reads or backlink analysis; get those from `references/rankings-and-search-console.md`, `references/technical-seo.md` and `references/link-building-and-competitors.md`, then come back here to publish. The monthly-report recipe end to end is Recipe 4 in `references/seo-playbooks.md`; the mutation gate every shipped change clears first is `references/seo-change-discipline.md`.

## Availability

Cost classes: A = free DB read; write = free, confirm-gated; paid = spends a paid agent turn or sends real mail. Nothing in this file spends DataForSEO credits.

| Tool | Status | Cost class | Note |
|---|---|---|---|
| `seo_deliverable_list`, `seo_deliverable_get`, `seo_deliverable_save`, `seo_deliverable_update`, `seo_deliverable_delete` | LIVE | A / write | save is idempotent on slug (`existed`); delete is permanent |
| `seo_sheet_create_tab`, `seo_sheet_add_rows`, `seo_report_add_section`, `seo_report_update_section` | LIVE | write | ONE workspace per account; `deliverable_slug` is a no-op |
| `seo_report_clear` | LIVE | write | wipes EVERY section in the account; prose warning only, no confirm rail |
| `seo_automated_reports` | LIVE | A | lists the scheduled reports; ignores `project_id`, filter by domain |
| `marketing_report_create`, `marketing_report_update`, `marketing_report_regenerate`, `marketing_report_share_link`, `marketing_report_pdf` | LIVE | write / A | the scheduled-report write rail; create is PUBLIC by default |
| `marketing_report_send` | LIVE | paid (real mail) | two-step confirm, strict boolean |
| `seo_task_list`, `seo_task_get` | LIVE | A | the SEO task queue |
| `seo_task_implement`, `seo_task_implement_status` | LIVE | paid (agent turn) / A | two-step; status is safe to poll |
| `agent_approval_list`, `agent_approval_get`, `agent_approval_approve`, `agent_approval_reject`, `agent_inbox_list`, `agent_inbox_get`, `agent_inbox_resolve` | LIVE | A / write | approve EXECUTES a production deploy, two-step confirmed |
| `pm_tasks_create`, `pm_tasks_update`, `pm_tasks_complete` | LIVE | write | the work record |
| `seo_project_get`, `seo_project_update` | LIVE | A / write | WEBSITE project SEO settings (Play G); `robots_txt_content` is a deploy-time fallback, the code file wins |
| `fetch_url`, `web_scrape`, `web_extract` | LIVE | free | live-URL verification before any "shipped" claim |
| `seo_task_changes` | LIVE | A | the file list, diff and preview URL an approver reads before `agent_approval_approve`, by `task_id`; still open the staged preview URL too |
| `seo_automated_report_get`, `seo_automated_report_update`, `seo_automated_report_delete` | LIVE | A / write | one scheduled report by `report_id`; delete is ask-gated; `marketing_report_update` still writes cadence, recipients and `is_active` on the same rows |

---

## 1. The four delivery surfaces (know which one you are writing into)

These are four different stores with four different lifetimes. Confusing them is the single most common way to destroy a client's work.

**1. `seo_deliverables` rows.** Durable, per-account, addressed by `slug`, unique on (account, slug). One row per artifact: a baseline audit, a strategy doc, a competitor teardown, a monthly report shell. Tools: `seo_deliverable_list`, `seo_deliverable_get`, `seo_deliverable_save`, `seo_deliverable_update`, `seo_deliverable_delete`. This is the permanent record.

**2. The Sheet Canvas + Report Preview workspace.** THERE IS EXACTLY ONE PER ACCOUNT. `seo_sheet_create_tab`, `seo_sheet_add_rows`, `seo_report_add_section`, `seo_report_update_section` and `seo_report_clear` all take `deliverable_slug`, a legacy no-op that selects nothing and is only echoed back. Every call reads and rewrites the same account-level blob (`{ sheets, reports }`) the dashboard's Sheet tab renders: this month's sections land in the same list as last month's, and `seo_report_clear` wipes every section in the account whatever slug you pass.

**3. `seo_automated_reports` rows.** The scheduled client reports that generate and email themselves on a weekly or monthly cadence, with public share links. Read the list with `seo_automated_reports` and one report with `seo_automated_report_get`; edit with `seo_automated_report_update`, delete (ask-gated) with `seo_automated_report_delete`. The `marketing_report_*` family writes the same rows: `marketing_report_create` (schedule `weekly | monthly | none`; PUBLIC BY DEFAULT, so create mints the share token and stamps `next_scheduled_at`), `marketing_report_update` (rename, cadence, section list, recipients via `delivery_config`, `is_active`, `is_public`; a schedule change re-stamps `next_scheduled_at`; `is_public: false` REVOKES the link), `marketing_report_regenerate` (rebuilds the stored numbers NOW; page and email render that stored blob verbatim, so regenerate is the only way the numbers change; emails nobody, never advances the schedule, can take minutes), `marketing_report_send` (REAL MAIL; two-step confirm, section 6), `marketing_report_share_link` (read the public URL, never mints) and `marketing_report_pdf` (marketing reports only, STORED numbers, 409 until generated once).

**4. PM tasks.** The work record. `pm_tasks_create`, `pm_tasks_update`, `pm_tasks_complete`, and the SEO-scoped read/execute rail: `seo_task_list`, `seo_task_get`, `seo_task_implement`, `seo_task_implement_status`.

Before any of this, orient locally. `hiveku-data/seo/*.json` (`projects.json`, `keywords.json`, `rankings.json`, `backlinks.json`, `audits.json`, `competitors.json`) is a snapshot with a `fetched_at` stamp. Read it to learn the shape of the account for free. Note that there is no local snapshot of deliverables, the workspace, or automated reports, so those always require a live read. Run `account_context_get({ domain: 'seo' })` before you write any client-facing prose: brand voice, persona and account rules change what the executive summary is allowed to claim, and its `instructions` field can carry account-specific reporting constraints.

---

## 2. Decision frameworks

### 2.1 What earns a deliverable, and of what type

A deliverable is a thing the client can be handed and that a future session can find. Create one when the artifact has a name, a date and an audience. Do not create one for an interim analysis; that belongs in a sheet tab or in memory. `deliverable_type` is a free-text VarChar(50) but treat it as a controlled vocabulary or filtering breaks: `audit`, `strategy`, `monthly_report`, `competitor_analysis`, `content_brief`. Check what the account already uses with `seo_deliverable_list({ deliverable_type: 'monthly_report', limit: 50 })` and match it exactly rather than inventing a synonym. `status` is `draft` until the client has seen it, `published` when it has been delivered, `archived` when superseded.

Slug discipline is the whole game, because slug is the identity. Use date-sortable slugs: `seo-monthly-2026-08`, `seo-baseline-2026-08`, `competitor-teardown-2026-q3`. Never put a slug in the title only. Never reuse a slug across months.

### 2.2 Narrative or sheet

Narrative sections (`seo_report_add_section`) answer "so what". Sheets (`seo_sheet_create_tab` / `seo_sheet_add_rows`) answer "prove it". The rule: if a table has more than about 12 rows or more than 5 columns, it is an appendix tab, and the narrative gets the top 3 to 5 rows plus a pointer. A monthly report whose Rankings section is a 200-row markdown table is unread. A report with no appendix is unverifiable. You want both.

### 2.3 The reconciliation rule

Every number in narrative prose must be reproducible from a named tool call you could re-run. Derived figures (percentage change, blended CTR opportunity) carry their arithmetic in the appendix tab. No nameable source, no number: client reports get forwarded to people who re-derive them in Looker or GA4, and a figure you cannot defend costs the retainer.

### 2.4 Finding to ticket to shipped: who does the work

Three routes for any accepted recommendation, chosen by blast radius:

- **Recommendation only.** Goes into the deliverable's narrative and `recommendations` array. Use when the fix is outside our control (client's ecommerce platform, a third-party template) or needs a decision we do not own.
- **PM task, human or department executes.** `pm_tasks_create`. Use for anything requiring judgment, new copy, or coordination. This is the default.
- **PM task, implement rail executes.** `seo_task_implement`, only for narrow, mechanical, page-scoped code changes on a Hiveku-hosted site (title/meta, heading structure, schema blocks, internal links, canonical fixes). Its end state is code on the client's live site, so the bar is "I could describe the exact diff in one sentence"; if you cannot, it is a human task.

### 2.5 Sequencing the month

Build the report in this order, which is not the order it is read in:

1. Pull and stage the data into appendix tabs first (Play B). Tabs are cheap and idempotent to review.
2. Write the evidence sections against those tabs (Rankings, Traffic, Authority, Work completed).
3. Write Next Month from the roadmap and the open task queue.
4. Write the Executive Summary last, from the sections you just wrote. Place it first.
5. Confirm the whole thing with the user before flipping the deliverable to `published`.

---

## 3. The plays

### Play A: Build the monthly report

**Chain.**

1. `account_context_get({ domain: 'seo' })`. Read brand voice and any reporting rules.
2. `seo_deliverable_list({ deliverable_type: 'monthly_report', limit: 12 })`. Read out: last month's slug and `summary`. You need continuity ("last month we said X would happen") and you need to not collide on slug.
3. `seo_automated_reports({ project_id })` (ignores `project_id`, returns the account's rows: filter by domain). Read `report_type` (`marketing` or `social`), `schedule`, `next_scheduled_at`, `is_active`, recipients. If an active monthly marketing report already emails this client, complement it, do not duplicate it: ship before `next_scheduled_at` and reference its share link (`marketing_report_share_link({ report_id })`) rather than restating its sections.
4. `seo_deliverable_save({ title: 'SEO Monthly Report - August 2026', slug: 'seo-monthly-2026-08', deliverable_type: 'monthly_report', status: 'draft', target_domain, target_keywords, summary })`. **Read out `existed`.** The route is idempotent on slug: if the slug is taken it returns the EXISTING row with `existed: true` and changes nothing. A re-run therefore silently no-ops. If `existed` is true, switch to `seo_deliverable_update({ id, ... })` using the returned `id`.
5. Appendix tabs (Play B), then sections.
6. Sections, in report order, each via `seo_report_add_section({ deliverable_slug, title, content })`. Prefix every title with the report period so it stays findable in the shared workspace list: `"2026-08 Executive Summary"`, `"2026-08 Rankings Movement"`, and so on. This prefix is not cosmetic; see the failure modes.
7. `seo_deliverable_update({ id, summary, recommendations, status: 'published' })` once the user confirms. `recommendations` is an array; put the next-month commitments there in structured form so the next session can read them back without parsing prose.

**Section set, in report order (the hub keeps only a pointer to this list).**

- Executive summary: five bullets maximum. Headline metric with its direction, the biggest win, the biggest risk, what we did, what is next. Written last, placed first; if any section below is partial, the summary says so, never hides it.
- Rankings movement: `seo_rankings_list` (one row per keyword, `group_by_keyword: true`) plus `seo_gsc_period_comparison` MoM: climbers, droppers, striking distance for next month. Positions are lower-is-better and period deltas are signed accordingly; do not flip signs to make a chart look nicer. Blank AI lanes are "not tracked", never "not cited".
- Organic traffic: `seo_gsc_time_series` month over month AND year over year, top pages and queries, annotated with ship dates. YoY is what stops a seasonal dip from becoming an apology.
- Outcomes: `seo_ga4_conversion_audit` and `seo_ga4_report` (`references/outcomes-and-measurement.md`): did the traffic convert? Zero-recording key events are flagged as measurement gaps. No GA4 connection means the section reads "not measurable yet" with the setup task attached, never a silent omission.
- Authority: `backlinks_summary` delta, notable new and lost links, outreach status (links won, not emails sent).
- AI visibility (AEO clients): citation rate and answer-layer coverage from `seo_aeo_audit_get`, the tracked AI lanes, brand-audit average with per-provider overalls beside it (`references/aeo.md` section 6).
- Work completed: sourced from completed PM tasks, with a live URL for every shipped item.
- Next month: the roadmap slice with an expected-impact and expected-timeframe note per item.
- Local section, only for clients with locations (`references/local-seo.md` section 7).

**Reconciliation rules the whole report obeys.** Verdicts use a closed vocabulary (pass / fail / unknown / not_applicable) and unknown or not_applicable never becomes a pass; a failed source makes its section partial, never zero; every aggregate discloses N, how chosen and what was excluded; GSC, Bing, the rank tracker, vendor estimates and GA4 define their numbers differently, so they sit side by side, each labelled, never summed. The report synthesizes (impact, cross-source reconciliation); it never restates tool output the appendix already carries.

**Closing write.** `memory_update` (or `memory_create` if none exists) the report record: slug, period, headline metrics, what was promised for next month. Then `pm_tasks_complete` the "produce monthly report" task.

### Play B: Appendix tabs

**Chain.** For each appendix:

1. `seo_sheet_create_tab({ deliverable_slug: '<report slug>', name: '2026-08 Rankings', columns: [{ id: 'keyword', name: 'Keyword', type: 'text', width: 220 }, { id: 'pos', name: 'Position', type: 'number' }, { id: 'prev', name: 'Prev', type: 'number' }, { id: 'delta', name: 'Change', type: 'number' }, { id: 'url', name: 'URL', type: 'url' }] })`. Column `type` is one of `text | number | metric | url | tag | status | date`. Column `id` is what row keys must match; if you omit `id` it is derived from `name` lowercased with spaces turned into underscores, which is a silent way to end up with keys you did not expect. Always set `id` explicitly.
2. `seo_sheet_add_rows({ deliverable_slug, tab_name: '2026-08 Rankings', rows: [...] })` for the body. Rows are flat objects keyed by column id (`{ keyword: 'roof repair dallas', pos: 6, prev: 11, delta: -5, url: 'https://...' }`); they are normalised into the canvas row shape for you.

**Critical mechanics.**

- `seo_sheet_create_tab` is replace-by-name: a tab whose name exists loses its rows and columns to yours, so a re-run wipes last time's content. Date-prefix every tab name so month N never collides with month N-1.
- `seo_sheet_add_rows` is NOT idempotent and AUTO-CREATES the tab when `tab_name` does not match (columns inferred from the first row): a typo spawns a junk tab, a retry appends duplicates. To retry, re-run `seo_sheet_create_tab` with the full row set instead.
- Batch: one `seo_sheet_add_rows` call with 300 rows, not 300 calls. Every call rewrites the whole workspace blob, so chatty writes are slow and widen the window for a concurrent writer to clobber you.

### Play C: Revise a report without destroying the archive

`seo_report_add_section` always APPENDS. It does not dedupe by title. Calling it twice with the same title leaves two sections with identical titles, and `seo_report_update_section` then matches only the first one by exact string, so your edits appear to be ignored while a stale duplicate sits below.

**Chain to revise.** `seo_report_update_section({ deliverable_slug, section_title: '2026-08 Rankings Movement', content: '<new markdown>' })`. Read out: a 404 means no section carries that exact title. Do not respond to a 404 by calling `seo_report_add_section`; first confirm what titles exist (the dashboard workspace Report tab lists them, and it is the only reliable enumeration available from here). `title` is an optional second argument that renames the section while updating it.

**Never call `seo_report_clear` to "start a fresh report".** It empties every report section in the account. If a client has months of sections in the workspace, that is months of work gone in one call. The store snapshots before mutating so the data is recoverable by an engineer from version history, but there is no tool here that restores it, and the client-visible dashboard will show empty in the meantime. Use `seo_report_clear` only when the user has explicitly asked to reset the entire workspace report list and has been told, in that turn, that it is account-wide and not scoped to the slug. Confirm it in words before calling it.

The emptying guard (a write leaving BOTH zero tabs and zero sections is refused unless destruction was requested) does NOT catch `seo_report_clear` on an account that still has sheet tabs. It is not a safety net.

### Play D: Baseline, audit and strategy deliverables

Same skeleton as Play A with different types and a different content contract.

1. `seo_deliverable_save({ title, slug: 'seo-baseline-2026-08', deliverable_type: 'audit', status: 'draft', target_domain, target_keywords: [...], summary, content: {...}, recommendations: [...], tags: ['baseline'] })`. `content` is free-form JSON: the machine-readable snapshot (metric values, source tool names, `captured_at`) a later session diffs against without re-paying. `recommendations` is an array with a stable entry shape (`{ id, area, finding, action, effort, impact, status }`).
2. Long tables go to tabs (Play B), not into `content`.
3. `seo_deliverable_get({ id })` to read one back in full including `content` and `recommendations`. `seo_deliverable_list` returns the same fields but paginated, so for a single artifact prefer `seo_deliverable_get`.

Strategy documents are the one place to reach for `talk_to_department({ domain: 'seo', message })`: hand it the cluster matrix, the competitor set, the constraints from `account_context_get`, and ask for the roadmap narrative. Then persist what comes back with `seo_deliverable_save`. Do not let the department agent's prose enter a client report without you reconciling every number in it against a tool call.

### Play E: Triage the SEO task queue

**Chain.**

1. `seo_task_list({ status: 'todo', task_type: 'seo', limit: 100 })`, then repeat with `task_type: 'content'`. `task_type: 'all'` exists but mixing the two families makes triage worse, not better.
2. Read out per row: `status`, `priority`, `page_url`, `pm_project`, `website_project_id`, `implementable`, and the `implement` summary (`dispatched_at`, `approved_at`, `deployment_id`). `implementable` is true only when the status is open (`todo | queued | blocked | need_info`) AND the task's PM project is linked to a website project. A false `implementable` on a task you expected to ship is almost always the missing project link, not the task.
3. `seo_task_get({ task_id })` on anything you intend to act on. Read out `description`, `ai_instructions` and the resolved `page_url`. If `ai_instructions` is thin, the rail will produce a thin change.
4. Decide per task using 2.4. Update statuses honestly with `pm_tasks_update({ id, status, priority })`. A queue where everything is `todo` for six weeks is a queue nobody reads.

**Creating tasks that the rail can see.** `pm_tasks_create({ project_id, title, description, task_type: 'seo', priority, due_date })`. Three traps:

- `task_type` must be `seo` or `content` or `seo_task_list` will never return it under its defaults.
- Do NOT pass `parent_task_id` on a task you want in the SEO queue. The PM create path forces `task_type` to `subtask` whenever a parent is present, which removes the task from the SEO task views entirely. Tasks have been buried three levels deep and invisible for weeks this way. Keep implementable SEO tasks flat.
- No argument on `pm_tasks_create` or `pm_tasks_update` sets the page anchor; `page_url` resolves from custom fields or the related URL, neither writable from here. Fallback: the absolute target URL as the first line of `description` and again in the title, and tell the user the anchor is set in the dashboard's SEO workspace Tasks tab.

### Play F: The implement-with-AI rail

This ends with code on the client's live site. Treat every step as a money action.

**Chain.**

1. `seo_task_get({ task_id })`. Confirm `implementable: true`, a sane `page_url`, and that the change is inside the mechanical bar from 2.4.
2. `seo_task_implement({ task_id })` with NO `confirm`. This dispatches nothing. It returns `{ requires_confirm: true, preview }` carrying the task title and description, the target website project name and domain, and the resolved page anchor.
3. Show that preview to the user verbatim and get a yes. Verify the target domain in the preview is the client you think you are working on. A wrong `website_project_id` here means editing someone else's site.
4. `seo_task_implement({ task_id, confirm: true })`. Strict boolean, identical call otherwise. Read out `session_id`. Expect these refusals and do not retry through them: 409 when a session is already running (never double-dispatch, the first one is still burning a paid turn), 409 when the task is already deployed, 409 when the status is not open, 402 when the AI budget or the daily free build limit is exhausted.
5. Poll `seo_task_implement_status({ task_id })`. Phases: `idle`, `running`, `awaiting_approval`, `deploying`, `completed`, `failed`. It performs the same status-sync writes as the dashboard, so it is safe to poll; poll at 30 to 60 second intervals, not tighter.
6. At `awaiting_approval` a production deploy is staged behind the approval rail and the response carries its token, summary and expiry. The rail is finishable from here (`agent_approval_` and `agent_inbox_` are granted to the marketing-seo profile so a key that can START it can FINISH it): `agent_approval_list` shows staged actions (the deploy appears as `action: 'deploy_project'`; match it via the `session_id` from `seo_task_implement`; `status: 'all'` adds handled and expired rows), `agent_approval_get({ token })` inspects one non-destructively (consumed / expired / approvable flags), `agent_approval_reject` discards the token without executing (no confirm gate). The same request lands in the agent-ops inbox: `agent_inbox_list` / `agent_inbox_get` find it, and `agent_inbox_resolve` closes the queue row AFTER the action is handled (resolving executes nothing). The dashboard's SEO workspace shows the same staged action as the fallback.
6a. **What the approver reads before saying yes.** The staged action itself shows the approver one line of prose; `seo_task_changes({ task_id })` (live since 2026-08-30) returns the task's file list, the diff and the preview URL. Read it before every approve and carry its file list into the approval note, and still open the staged preview (the `deployment_url` on the status response, or the dashboard's approval rail) to look at the rendered page. Never approve on one line of prose, and never approve a diff nobody has looked at: if neither a diff nor a preview is available, reject and route the task to a human.
6b. `agent_approval_approve` EXECUTES THE STAGED ACTION FOR REAL: `deploy_project` deploys code to the client's live production site. Two-step confirm: the first call (without `confirm`) executes nothing and returns `{ requires_confirm: true, preview }`; show it, get the human's yes, then repeat the IDENTICAL call with `confirm: true` (strict boolean). Tokens are single-use: already-handled 409, expired 410; execution resumes a paid agent turn (402 when billing-gated) and can take minutes. The human's yes is mandatory: never approve on your own judgment, never treat "the user asked for the implement" as pre-approval of the deploy, never re-dispatch to route around a rejection, and never describe an unapproved staged deploy as shipped.
7. At `completed` read `deployed_at` and `deployment_url`. The task auto-completes stamped with the deploy time, so do not also `pm_tasks_complete` it. Verify on the live URL (`fetch_url` or `web_scrape`, confirm the element changed) before it enters Work Completed.
8. At `failed` read `stage` (`agent` or `deploy`) and the error, then decide: fix the task description and re-dispatch, or reroute to a human task. Do not re-dispatch the identical instructions that just failed.

Close the loop: `memory_create` a line recording what shipped, on what URL, on what date, so the next report's before/after has a real anchor date.

### Play G: Project scope and the two "project" tools that are not the same thing

This trips people constantly. `seo_create_project({ domain, name, description, target_country, target_language })` creates an SEO TRACKING project (a tracked domain, the `project_id` that the rest of the SEO tools consume, listed by `seo_list_projects`). `seo_project_get({ project_id })` and `seo_project_update({ project_id, seo_settings, robots_txt_content, sitemap_settings, seo_monitoring })` operate on a WEBSITE project's site-level SEO configuration, a different id space entirely. Passing an SEO tracking project id to `seo_project_update` does not edit your tracking project; at best it fails, at worst it targets nothing you meant. Confirm which id you are holding before you write. `seo_project_update` is a site-config write and therefore always needs explicit confirmation, quoting the exact new value back to the user first. And `robots_txt_content` is a deploy-time fallback, not a live setting: from the next `deploy_site` it is emitted as the site's `/robots.txt`, but only on a project whose code ships no robots source of its own, and never on the Fly preview, the dev tier or a GitHub-connected project. The file in the code always wins, and the stored write on its own changes nothing on the live site. The code lane stays the recommendation because it works on every project shape: a robots change ships as `public/robots.txt` through `project_files_bulk_save`, `project_vcs_commit` and `deploy_site`, and is confirmed with `fetch_url` on `https://<domain>/robots.txt` before anyone claims it; a report line that says "robots.txt updated" on the strength of `seo_project_update` alone is false. The tracking project's own get, update and delete are live and owned by `references/rankings-and-search-console.md`.

### Play H: Retire and archive

`seo_deliverable_update({ id, status: 'archived' })` is the correct end-of-life for a superseded artifact. `seo_deliverable_delete({ id })` is permanent and there is no undo tool. Use it only for a genuine mistake created in this session (a typo slug you just made), never to tidy history, and never on anything with a `published` status. Say what you are deleting and get a yes.

---

## 4. Thresholds and benchmarks that trigger action

**Report construction**

- Executive summary: 5 bullets maximum, each under 25 words.
- Narrative table: 12 rows maximum, 5 columns maximum. Over that, it is an appendix tab.
- Report sections per monthly report: 6 to 8. More than 10 and the client skims none of them.
- Appendix tabs per report: 3 to 6. One per evidence family.
- Rows per `seo_sheet_add_rows` call: batch to 200 to 500. Above roughly 2,000 rows in a single tab, sample and state the sampling rule in the tab's first column.
- Outcomes section: ships only when `seo_ga4_conversion_audit` shows at least one key event that recorded a nonzero count in the window; a key event at zero is reported as a measurement gap with its task, and no GA4 connection reads "not measurable yet". Never a conversion number from memory or a prior month.
- AI-visibility section: ships only from a persisted `seo_aeo_audit_get` run inside the report window (same keyword list as the baseline) and from tracked AI lanes that exist; an untracked lane is omitted, not zeroed, and a brand-audit average is always shown with its per-provider overalls and provider count.

**Workspace health**

- Over ~150 report sections or ~25 sheet tabs: stop appending and raise archiving. Accounts have reached 1,400+ sections and a 14 MB blob, where every read and autosave moves the whole thing and the dashboard becomes unusable. No archive tool exists; pruning happens in the dashboard workspace.

**Task queue**

- Any `implementable` task open more than 30 days: escalate or close. It is not a plan, it is debt.
- More than 20 open `todo` SEO tasks: the queue is not being worked; stop creating and start triaging.
- Implement-rail dispatches per session: keep to 1 to 3. Each is a paid coder turn plus a live deploy, and batching them means several unreviewed diffs land on the site at once.
- `awaiting_approval` older than its stated expiry: the staged deploy is dead. Re-dispatch, do not wait.

**Reporting cadence**

- Monthly report ships within 5 business days of month end. Later than that and the data is stale before it is read.
- Anything the client will read must be confirmed by the user before `status: 'published'`. No exceptions, including "it is just a draft they asked for".

---

## 5. Diagnosis: when the data or the surface looks wrong

**"My report sections do not appear in the client's workspace."** `deliverable_slug` is a no-op; sections went into the single account workspace the dashboard Sheet/Report tab shows. Nothing at all there means a different account than your key is bound to: `get_account_info`.

**"`seo_report_update_section` returns 404 on a section I definitely created."** Title match is exact string equality, including the date prefix and any trailing whitespace. Re-read the title from the dashboard and paste it. Also check for the duplicate-title case: if two sections share a title, only the first is ever updated.

**"`seo_deliverable_save` returned but nothing changed."** Read `existed`. A `true` there means the slug already existed and the call was a read, not a write. Switch to `seo_deliverable_update` with the returned `id`.

**"The write 500'd with no obvious reason."** Column length limits: `title` 500 characters, `slug` 200, `deliverable_type` 50, `status` 20. A generated title carrying a long query string overflows; truncate first.

**"A tab I built last month is empty."** Someone (possibly you, on a re-run) called `seo_sheet_create_tab` with the same `name`. It is replace-by-name. Date-prefix tab names.

**"A tab exists that nobody created."** `seo_sheet_add_rows` auto-creates on an unmatched `tab_name`, and several research tools auto-file tabs. Do not delete uncurated tabs without asking; some are the client's own.

**"`seo_task_list` returns nothing but I know tasks exist."** In order: they carry `task_type: 'subtask'` (created with a `parent_task_id`) so the `seo` default excludes them; your status filter excludes them; they live in a PM project you are not scoping. Retry with `task_type: 'all'` and no status filter first.

**"`implementable` is false."** The PM project has no linked website project. That link is not settable from any tool in this set; it is a dashboard action on the PM project. Tell the user exactly that rather than working around it.

**"The implement rail reported success but nothing shipped."** Distrust a bare success: the authoritative signals are `deployed_at` and `deployment_url` from `seo_task_implement_status` at `completed`, plus your own check of the live page. No session id, or `running` for more than about 30 minutes, is a dead turn: report it as failed, never as in progress, and do not silently re-dispatch.

**"`seo_automated_reports` returns rows for other domains."** It filters by account, not by the `project_id` you pass. Filter client-side on the row's domain.

**"An automated report is configured but never arrives."** Read `is_active`, `next_scheduled_at` (null or past means it will not fire; `marketing_report_update({ report_id, is_active: true, schedule })` re-stamps it) and `delivery_config.recipients` (zero recipients also "never arrives"). Needed today: regenerate, then `marketing_report_send` through its confirm gate.

**Local data looks stale.** `hiveku-data/` files carry `fetched_at`. If it predates recent work, treat it as orientation only and go live. Do not report a number out of a stale snapshot.

---

## 6. Edge cases and failure modes

- **Do not bulk-apply anything.** No loop over `seo_task_implement` across a filtered list, no loop publishing deliverables; each write is confirmed individually or it does not happen.
- **Do not send or publish silently.** `status: 'published'` and anything that reaches a scheduled report's recipients are client-facing acts. Confirm in the same turn you act.
- **Creating a scheduled report is a public act; sending it is a client-facing send.** A marketing report is PUBLIC BY DEFAULT: `marketing_report_create` mints a share token anyone holding the URL can open, so confirm its existence and section list before creating, then `marketing_report_regenerate` before anyone sees the page. "Set it up and email it to the client now" is TWO approvals: create and regenerate, then STOP; call `marketing_report_send({ report_id })` WITHOUT `confirm`, show the returned preview (title, the exact recipient list, the public URL to be mailed), get a yes on that exact list, then repeat the identical call with `confirm: true` (strict boolean). No "test send" to a real address, and no `recipients` replacement at confirm time the user never saw: `recipients` persists to `delivery_config` and the mail is real. No preview shown, no send.
- **Do not add a top-level key to the workspace blob.** The round-trip rebuilds `{ sheets, reports }` literally, so an invented top-level key is stripped on the next write by anyone; extra fields inside a section or row survive.
- **Do not address workspace content by id.** Multiple id formats coexist and clients re-mint ids that never match the stored row. Address tabs by `name` and sections by `title`, always.
- **Concurrent writers.** The dashboard autosaves the same blob; with the Sheet tab open while you write, one of you loses. Ask the user to close it first, and write in one batched call rather than twenty.
- **Protected and brand assets.** Client-facing copy, brand claims and anything naming a competitor go through `account_context_get` rules first; where it sets an approval threshold or names protected pages, the implement rail is off-limits for those pages however mechanical the change.
- **The report is not the work.** An audit with no tickets is a PDF, not a service: every accepted finding gets an entry in `recommendations` AND a PM task, or an explicit note saying why not.
- **Do not paste department-agent prose into a client report unchecked.** `talk_to_department` output is a draft. It will confidently state numbers it did not read.
- **Year-over-year matters.** A MoM-only report in a seasonal vertical eventually requires an apology YoY would have prevented.

---

## 7. Persistence and how the work reaches the client

**Memory.** After each report ships: `memory_list({ domain: "seo" })` for the existing SEO reporting record, then `memory_update({ memory_id, content })` with that record's returned `content` plus your addition (the call REPLACES the document; `memory_create` on first run): report slug, period, three to five headline metrics, what was promised for next month, any client reaction. Also persist durable decisions: the agreed section set, the client's cadence, which metrics they care about and which they asked you to drop, so the next session does not re-litigate the format or re-derive the baseline. `hiveku_docs_search` / `hiveku_docs_get` before asking the user how a platform surface works.

**PM tasks.** The report itself is a recurring task; `pm_tasks_complete` it when published. Each next-month roadmap item becomes a `pm_tasks_create` with a due date inside the month, so Work Completed writes itself next time. Statuses are updated as reality changes, not at report time.

**Client delivery.** The narrative lives in the workspace Report Preview and the durable artifact as a `seo_deliverable_save` row; both show in the client's dashboard. If a scheduled report exists (`seo_automated_reports`), the client also gets an emailed report with a public share link, and your job is to make the two agree: if they disagree, the client believes the email. `marketing_report_regenerate({ report_id, days: 30 })` rebuilds its stored numbers (minutes; it includes live Google Ads pulls); `marketing_report_pdf({ report_id })` exports those exact numbers (409 until generated once; social reports share their public link instead).

**Verification before you claim anything.** Anything reported as shipped must have a live URL you have checked (`web_scrape` or `web_extract` on the page, confirming the specific element). Anything reported as a ranking or traffic change must trace to a named tool call. Anything reported as deployed must have a `deployment_url` from `seo_task_implement_status`. Those three rules are what separate a report the client pays for from a report the client audits.
