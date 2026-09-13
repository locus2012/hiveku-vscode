# Reference: Form fills - capture, identity, spam, and the audit

**What this covers.** Everything on the form side of the conversion chain: the five writers that can create a `website_form_submissions` row, how `form_key` is composed and when it is path-scoped, what makes an identity junk, the one instruction that matters for anyone building a form on a Hiveku site, the three-copy spam classification and its value-beats-name rule, the reCAPTCHA hostname trap that files real leads to spam silently, the storage-free inline capture module and its one permanent limitation, the reconcile and sweeper backstops, and `marketing_form_conversion_audit` bucket by bucket including the `click_dated` trap. **Load this when** a client says leads are missing or wrong, when a form count does not reconcile against an inbox or an ad platform, when the Forms tab is full of junk, when notifications fire twice or not at all, or before you build or edit any form on a site you operate. If the question is "why does Google Ads show fewer conversions than Hiveku", start at `analytics_channel_scorecard` instead and come back here for the form half. Every tool named below is a real Hiveku MCP tool; where a capability has no tool, this file says so and names the dashboard fallback.

---

## 0. Before you touch anything

1. `account_context_get({ domain })` first, as always. Rules and memory here often already record which forms are the money forms and which are internal test forms.
2. Identify the project. Form and site tools need a **website_projects** `project_id` from `sites_list` (details for one from `project_get({ project_id })`). Do NOT use `list_projects` / `get_project` here: those return pm_projects rows, a different id space, and a website UUID 404s against them. If the account has one project, still read the id back rather than guessing.
3. `ppc_digest` before you trust any ad-platform number you plan to reconcile against; it warns on stale connections (more than 25h since sync). Reconciling Hiveku against a platform that has not synced since Tuesday produces a fake discrepancy and a wasted hour.

Confirm every write. Nothing in this file justifies a bulk edit, a bulk delete, or an upload without the operator saying yes to a named list.

---

## 1. The five writers

A form fill can become a `website_form_submissions` row through five distinct sources (`FormSubmissionSource`), plus a sixth used only by the backfill:

| Source | Who writes it | When you see it |
|---|---|---|
| `capture` | The storage-free inline capture module shipped on every deployed Hiveku site | The universal floor. Present even when analytics is off, consent is denied, or the embed is stale |
| `form_lead` | The analytics embed's **native submit** path | Ordinary HTML form posts on a site running the embed |
| `form_lead_xhr` | The analytics embed's **fetch/XHR interceptor** | React/Next and other JS forms that submit without a document navigation |
| `webhook` | Server-side webhook post | Third-party form vendors and server-rendered handlers |
| `public_form` | The hosted HivekuForm | Forms Hiveku itself serves |
| `reconcile` | `/api/cron/form-ledger-reconcile` | A row materialised after the fact from ClickHouse because none of the above landed |

### Why `form_lead` and `form_lead_xhr` must stay separate (load-bearing)

Dedupe **refuses to link two rows of the same source**. That rule exists because a same-source repeat is a genuine second submission: a person who fills the contact form twice must produce two leads, not one. The consequence is exact and it is the reason the two embed writers carry different names. Both observe the *same single fill* on a site where a JS form also triggers a native submit path. Different sources, so dedupe is allowed to collapse them into one record. Give them one shared source name and dedupe declines to link them, and every fill produces **two visible leads and two "New lead" emails**. This has happened. If you ever see exact-duplicate leads at a 1:1 ratio with working notifications doubled, this is the shape of the bug, and the fix is never "make dedupe smarter", it is keeping the sources distinct.

Corollary for reading data: two rows with the *same* source and near-identical content are two real fills, not a bug. Do not "clean them up".

---

## 2. `form_key` and the conditional path-scoping rule

**`form_key = <identity>@<pathname>`**, where identity is resolved in this order:

1. `data-hiveku-form-key` attribute
2. `form.id`
3. `form.name`
4. first CSS class
5. `unnamed`

**Path scoping is CONDITIONAL. This is the part people get wrong.**

- A **real** identity is **NOT** path-scoped. One component rendered on many pages resolves to **one record**. Blanket path-scoping produced nineteen separate records for a handful of forms, which means nineteen counts, nineteen mute switches, and a client who cannot tell what their contact form did.
- A **junk** identity **KEEPS** the path, because that is the only signal left to tell two anonymous forms apart.

**Junk identities**: `''`, `unnamed`, `unknown`, `xhr`, `null`, `undefined`, anything matching `[object ...]`, a word plus a numeric suffix (`foo-123`, the shape framework auto-ids take), and a 40-entry CSS utility prefix list (Tailwind and friends, so `flex`, `grid`, `w-full` and similar never become an identity).

**Paths are normalized** before use: query string, hash, and trailing slash are stripped. Before that, `/contact` and `/contact/` were two records with two counts and two independent mute switches, and muting one left the other emailing.

### For anyone BUILDING a form on a Hiveku site

Give every form a stable, human `id`, or a `data-hiveku-form-key` attribute. That single attribute is what keeps **one form = one record with working notifications**. Say this to the client's developer verbatim; it costs them ten seconds and it is the difference between a clean Forms tab and a mess.

What breaks without it, in order of how often it bites:

- The identity falls through to the first CSS class. On a Tailwind site that is junk, so the record is path-scoped, so the same component on `/`, `/contact`, `/services`, and `/locations/austin` becomes **four records**. Four counts, four mute toggles, four notification settings, and the client's "our form got 6 leads" is really 6 across four rows nobody added up.
- A framework auto-id (`form-1`, `contact-3`) is junk by the numeric-suffix rule, and it is also **unstable across builds**. The record identity changes on redeploy, historical continuity breaks, and a form the client had muted starts emailing again.
- Notification config, mute state, and any per-form workflow trigger are attached to the record. New record means a form with no notification configured, so leads land in the Forms tab and nobody is told. This is one of the two ways a lead is "lost" while sitting in the database the whole time.

If you are shipping the fix yourself: `project_files_bulk_get` to load, edit the form component so the `<form>` carries a stable id or `data-hiveku-form-key`, `project_files_bulk_save` in **one** call, `project_vcs_commit`, then `deploy_site` **only after the operator confirms**. Commit is not live. After the deploy, submit one test fill and read it back with `marketing_form_conversion_audit` filtered to the new `form_key` before telling anyone it is fixed. Log the decision with `memory_create` so next month nobody re-derives which key is canonical.

There is **no MCP tool** to rename, merge, or mute a form record. Renaming happens by changing the markup and redeploying; mute and per-form notification settings live in the Forms tab of the dashboard.

---

## 3. Spam and drop classification

The classification exists in **three copies**, and only one of them is authoritative:

1. **The embed** decides whether to send at all.
2. **The tracking worker** implements only `drop`.
3. **The builder's `classifyFormSubmission`** is **AUTHORITATIVE**. It owns lead-vs-spam and it owns **VALUE validation**.

**The rule: a plausible contact VALUE always wins over a matching field NAME.** A field called `company_website` containing `jane@acme.com` is a lead. A field name that looks promotional but carries a real phone number is a lead. Never let a name-based rule outrank a real value. If you are ever asked to add a spam rule, add it on values, not names, or you will be the reason a real lead was filed to spam.

**The Meta pixel case, worth memorising as the pattern:** Meta's pixel POSTs a `website_context.location` payload. `_` is a word boundary, so `website` matched a rule and the beacon was classified `spam`. And **`spam` STILL WRITES A ROW.** The result was Meta's own pixel minting roughly **89 form submissions per day** into a customer's Forms tab. Two lessons: a spam classification does not make a row disappear, it just changes the bucket; and a word-boundary match on a fragment of a machine payload is how junk gets in at scale. If a client says "my Forms tab is full of garbage", check the volume-per-day and the shape of the payload before touching any rule. Consistent daily volume with identical structure is a machine, not spam traffic.

`drop` is the only classification that means "no row". `spam` means "row exists, filed as spam". Keep those distinct in every sentence you write to a client.

---

## 4. The reCAPTCHA hostname trap (the silent lead killer)

The platform reCAPTCHA key pair has **domain verification DISABLED**. That means `projectHostnames(projectId)` is the **only** hostname check in the system.

Consequence: a reCAPTCHA token minted on a host that is not in that project's hostname list **scores 0**, and the spam scorer treats a 0 as decisive. The submission is **SILENTLY FILED TO SPAM**. No error, no bounce, no notification, no signal of any kind to the customer. A real human filled out a real form and the business never hears about it.

Who hits this: any production site fronted by a proxy, a CDN, or a preview/alternate hostname that is not registered on the project. Also a domain migration where the new host was never added, and a staging host the client started sending traffic to.

**How to recognise it in the audit:** the `spam` bucket is disproportionately large, the rows in it look like **real humans** (plausible names, real-looking emails, message text that reads like a person), and they cluster in time from the day a hostname changed. Real spam does not look like that.

**Remedy: register the domain on the project.** The `project_domains_*` family does this. Read what is registered with `project_domains_list` (per entry: domain, tier, `domain_status`, `ssl_status`, `dns_status`, and the `dns_records` the client must add at their DNS provider). Attach the missing host with `project_domains_add` - a WRITE, confirm the exact hostname with the operator first - and SURFACE the returned DNS records to them rather than saying "domain added": the domain sits in `pending` until DNS propagates and the SSL certificate issues. `project_domain_verify` answers "is it actually live" (DNS AND SSL - DNS alone is not servable), and `project_domain_check_dns` re-checks propagation on demand (a negative result soon after a change usually means "not yet", not "wrong"). These are `project_`-prefixed: invisible on a marketing key, so on one the remedy ships as a `pm_tasks_create` naming the tool and the host. Then confirm with a live test fill from that host and read it back through `marketing_form_conversion_audit`. Note the related 400: `analytics_diagnose_tracking` refuses only when `project_id` is OMITTED and no live project carries a custom domain; with an explicit `project_id` a domainless project still returns 200 with source-scan findings (`browser_checked: false`).

The already-filed leads are not recoverable through any tool. They must be reviewed and restored from the Forms tab in the dashboard. Hand the client an explicit list from the audit's `spam` bucket rather than a number.

---

## 5. The storage-free inline capture module

It ships on **every deployed site**, is **never gated on `tracking_enabled`**, and is **never consent-wrapped**. It can do that legitimately because it performs **zero storage operations** and is submit-only. It is the floor under everything: it fires when analytics is off, when the visitor denied consent, when localStorage is blocked, and when the site is running a stale cached embed.

**Load-bearing consequence: because it is storage-free, it can NEVER send `attribution_captured_at`.** By design, not by bug. `attribution_captured_at` is read out of the `hiveku_utm_params` localStorage store, and this module never touches storage.

What that means when you are reading data:

- A `capture`-sourced row will not have `first_touch_from === 'captured_at'`, so its click is **bounded, never dated**.
- Do not open a ticket about "capture rows missing the timestamp". It is the design. Chasing it wastes a day.
- If a client's leads are overwhelmingly `capture`-sourced, that is a signal the analytics embed is not running on the form pages (consent gate, `tracking_enabled` off, missing tracking token, or a stale/blocked embed). That is worth investigating, via `analytics_diagnose_tracking` and `analytics_probe_page`, because you are losing attribution quality even though you are not losing leads.

Related and separate: `attribution_captured_at` is a distinct accessor from the params themselves, specifically so the timestamp can never be written into the CRM as a bogus `utm_*` value. If you ever see a UTM whose value looks like a timestamp, something is bypassing that accessor.

---

## 6. The backstops, and what it actually takes to lose a lead

Three server-side backstops run behind the writers:

- **`/api/cron/form-ledger-reconcile`** - every 15 minutes, materialises missing rows **straight from ClickHouse**. This is why a lead can appear in the Forms tab up to 15 minutes late with source `reconcile`, and why "it wasn't there when I looked" is not proof of loss.
- **`form-submission-sweeper`** - retries the **CRM half** for rows in `needs_attention`. The ledger row already exists; what failed was contact upsert, the activity note, or the notification.
- **`form-attribution-backfill`** - fills `channel` and `first_touch_at` after the fact.

The ordering contract on the `form-lead` path exists for the same reason: **ledger row FIRST** (so a submission with no email address is still recorded), then contact upsert, then patch `website_form_submissions.contact_id`, then a deduped `crm_activities` note, then the notification. The lead is recorded before anything that can fail.

**Therefore: losing a lead outright requires ALL of inline capture + webhook + worker post + reconcile to fail.** That is rare. So when a client says "we lost a lead", the prior should be, in order:

1. It is in the database in a bucket they are not looking at (`spam`, `duplicate`, `archived`, `deleted`).
2. It is in the database and the **notification** failed, so nobody was told (`workflow_failed`, or a form record with no notification configured because the form_key split).
3. It arrived late via `reconcile` and they checked too early.
4. It genuinely never reached any writer, which means the form is not instrumented at all on that page or that host.

Only case 4 is a loss. Cases 1 and 2 are the overwhelming majority, and both are answered by the audit.

None of the three backstops has an MCP tool to trigger it on demand. Reconcile runs on its 15-minute schedule; wait for it rather than promising the client an immediate fix.

---

## 7. `marketing_form_conversion_audit` in depth

This is **the form-side gap explanation**. It is the tool you run the moment a form count does not reconcile. It exists to answer "where did the difference go" with a breakdown that **sums to the total**, so there is no residual for anyone to argue about.

### The buckets (they sum to the total)

`deleted | duplicate | spam | archived | workflow_failed | no_attribution | unpaid_attribution | counted`

| Bucket | What it means | What you do |
|---|---|---|
| `deleted` | A human removed the row in the UI | Ask who and why. If the client's own staff delete test fills, that is your explanation and it is not a bug. Recurring deletes of real leads means someone is treating the Forms tab as a to-do list |
| `duplicate` | Deduped against another row | Expected and healthy. Remember dedupe never links two rows of the **same source**, so anything here was cross-source. A `duplicate` count near the `counted` count is normal on a site running both embed writers |
| `spam` | Classified spam by `classifyFormSubmission`. **The row still exists** | Read the rows, do not read the number. Human-looking rows here means the reCAPTCHA hostname trap or a name-based rule beating a real value. Machine-shaped rows at constant daily volume means a pixel or bot |
| `archived` | Archived in the UI | Same conversation as `deleted`, softer. Often a client workflow you did not know about |
| `workflow_failed` | The row exists; the downstream half failed | **This is the "we never got the email" bucket.** The lead is captured, the business was not told. The sweeper retries the CRM half for `needs_attention`; anything still sitting here is your action item |
| `no_attribution` | No source could be recovered at all | Expect some. A large share means an instrumentation problem, not a lead problem. Attribution is recovered `utm_params -> landing_page -> page_path`, all-or-nothing per source, so this bucket means all three were empty |
| `unpaid_attribution` | Attributed, but to a channel that is not the paid one you are reconciling | **The single most common honest answer to "the ad platform shows fewer".** These are real leads from organic, direct, or referral. They should not be in a paid count |
| `counted` | Made it all the way through | The number the client should be comparing against |

### Filters

`form_key`, `has_click_id`, `click_id_type`, `channel`, `attribution_window_days`, `bucket`.

Practical use:
- `form_key` - isolate one form. Also the fastest way to prove a form_key split: run it unfiltered, look at how many distinct keys appear for what the client calls "the contact form".
- `has_click_id` / `click_id_type` - separate paid from everything else without guessing from `channel` strings.
- `channel` - narrow to the channel under dispute.
- `attribution_window_days` - align to the platform's window before comparing. Google and Microsoft are 90 days, Meta and TikTok are 7, LinkedIn is 90. Comparing a Hiveku 30-day view against Meta's 7-day window is not a discrepancy, it is two different questions.
- `bucket` - drill into one bucket to get its rows once the breakdown tells you where the difference sits.

### The click-window fields, and the trap

The response carries `click_window.click_dated`, `clicks_before_range`, and `boundary_risk`, plus per-row `attribution.first_touch_at` and `click_time_is_exact`.

To use them you need the `first_touch_at` guarantee. `first_touch_at` resolves in this order: (a) `captured_at`, the real click instant, accepted only if plausible (on or after 2020-01-01, at or before the submit, within the 90-day window plus 2 days of slack) **and** the click id came from `utm_params` rather than the landing URL; (b) the start of this visit, gated on a span of 24h or less **and** the landing URL carrying this row's attribution; (c) omitted entirely, never null. The provenance is recorded in `first_touch_from`.

**The guarantee: the click happened AT OR BEFORE `first_touch_at`.** Only `first_touch_from === 'captured_at'` **DATES** a click. Everything else only **BOUNDS** it. That is what `click_time_is_exact` is telling you per row. A wrong timestamp is worse than none, which is why case (c) omits rather than nulls.

**THE TRAP, load-bearing: if `click_dated` is 0, then `clicks_before_range: 0` means NOT MEASURABLE, not zero.**

`clicks_before_range` counts rows whose click landed before the start of your reporting range, which is the explanation for a lead the platform credits to a prior period. But it can only count rows that actually have a dated click. If `click_dated` is 0, nothing was datable, so the counter had nothing to count and reports 0. Reading that as "no clicks fell before the range" is a **false negative** that sends you off hunting a tracking bug that does not exist, when the truth is you cannot see the boundary at all.

**Always read `click_dated` first. If it is 0, say "not measurable" out loud, to yourself and in the report.** Then get datable rows by fixing the upstream cause: `capture`-sourced rows can never be dated (Section 5), and rows whose click id was recovered from the landing URL rather than `utm_params` are deliberately refused for dating, which is the signature of a visitor with localStorage unavailable (private mode, ITP, a consent gate, or an older cached embed).

`boundary_risk` flags rows sitting close enough to the range edge that a small timing difference moves them across. Treat a non-trivial `boundary_risk` as "this comparison has a tolerance", and quote the client a range rather than a number.

### Other form reads

`analytics_events_list` with `event_name=form_submit` is the browser-side view: it tells you whether the **event** fired even when no row exists, which separates "the form is not instrumented" from "the row went somewhere". Supporting context comes from `analytics_overview`, `analytics_sessions`, `analytics_traffic_sources`, `analytics_pages`, and `analytics_visitors`. Note the web conversion events the scorecard counts are `form_submit`, `cta_click`, `outbound_click`, `file_download`.

**Reading what visitors uploaded.** A `file` input inside a captured form is not skipped: the file is uploaded to Hiveku's private attachment store before the submit and bound to the submission, and the field shows as `name (size)` in the row. The site needs no uploader for this (rule F20 in the web-agency forms reference: file inputs need only a name; never wire an uploader). `marketing_form_attachments_list` lists the metadata by `submission_id`, `contact_id`, or `project_id` (file name, size, mime, `bound` or `purged`, and `scan_status`: every upload is malware-scanned and a link is minted only once the verdict allows it), and never a link. `marketing_form_attachment_download_url` mints a short-lived signed link for ONE attachment id, only when the operator explicitly asks for that file; never paste that link into a document, a task, a note, or a report. `marketing_form_upload_settings_get` reads the project's upload policy and quota usage, which is the first call when a client reports a refused upload, and `marketing_form_upload_settings_update` narrows the policy as a confirmed write (shortening retention purges files on the next sweep). `marketing_form_conversion_audit` accepts `include_attachments` to show the same metadata inline per submission.

---

## 8. Worked play: "the client says they got 30 leads but Hiveku shows 22"

**Step 0. Fix the denominator before you fix anything else.** Ask exactly where the 30 came from: their email inbox, a spreadsheet, their CRM, or a feeling. Inbox counts include notification retries and CC'd internal copies. Ask the date range and whether it includes phone calls. Half of these end here.

**Step 1. Get the total.**

```
marketing_form_conversion_audit({ project_id, attribution_window_days: <matched to the client's range> })
```

Read the **total** first, before any bucket. Two branches:

**Branch A: total is 30.** All thirty rows exist. Nothing was lost; something classified them. Read the buckets. A representative result:

- `counted` 22
- `spam` 4
- `duplicate` 2
- `workflow_failed` 1
- `deleted` 1

Now work each one:

- **spam 4.** Drill in: `marketing_form_conversion_audit({ project_id, bucket: 'spam' })`. Look at the rows, not the count. Human-looking names and real message text means Section 4: check whether the site is served from a hostname registered on the project (`project_domains_list`). If it is not, that is the whole answer. Remedy is `project_domains_add` (confirmed, DNS records surfaced - Section 4), then restoring those four from the Forms tab. Confirm with the operator before restoring anything.
- **duplicate 2.** Check the sources. Cross-source pairs are dedupe doing its job and the client counted both because they got the row and the vendor's own email. Same-source pairs are two genuine fills and the client is right. Do not delete either.
- **workflow_failed 1.** The lead exists and nobody was told. This is the one that actually costs the client money. Get the row, hand it to them immediately, and check whether that `form_key` has a notification configured at all. If the form_key split (Section 2), the fix is the stable id, not the notification. Where the right fix is wiring the form to a workflow (a notification, a CRM write), `workflow_bind_form` does it in one call: it parses the form file for the webhook env var and the field names, sets the project secret, and returns what it wired - pass `dry_run: true` first and show the result before the real run.
- **deleted 1.** Ask who deleted it. Usually a staff member clearing a test.

Report the arithmetic, not the adjectives: 22 counted + 4 filed to spam by an unregistered hostname + 2 dedupe pairs + 1 notification failure + 1 manual delete = 30. Buckets sum to the total, so there is nothing left to argue about.

**Branch B: total is 24, not 30.** Six submissions never reached any writer. That is the rare case and it means an instrumentation gap, because losing a row requires inline capture, webhook, worker post, **and** reconcile all to fail.

- `analytics_events_list({ event_name: 'form_submit' })` over the same range. If the events are there and the rows are not, the failure is server-side and you escalate with the event evidence. If the events are absent, the form is not instrumented on that page or that host.
- `analytics_probe_page({ url: <the form page> })` and compare `as_first_time_visitor` against `as_visitor_who_accepted`. Remember only a `conversion`-role signal makes a channel "tracking"; a container, tag, or pageview signal does not. Also read `blindSpots`, which is reported on every result.
- `analytics_diagnose_tracking({ project_id })` for the cause in the code. With an explicit `project_id` it always runs; on a domainless project you get source-scan findings only (`browser_checked: false`, no runtime findings - the 400 fires only when `project_id` is omitted and no live project carries a custom domain). Read `browser_checked` and `caveats` before you trust the absence of a finding, because if no probe succeeded the runtime checks emit **nothing at all** rather than reporting a false crisis. Its `coding_agent_brief` is written to hand straight to a coding agent.
- If the site carries a hand-pasted or GTM-managed form tag, `project_custom_code_get` shows what is saved per tier (`page_path === ""` is that tier's site-wide row). **Custom-code edits are saved instantly but only take effect on the NEXT DEPLOY of that tier. Saved is not live.** And `project_custom_code_set_tier` **REPLACES a whole tier**: any page omitted from `pages` is **DELETED**. Never call it without listing the full current set, and confirm the diff with the operator first.

**Step 2. If the dispute is against an ad platform rather than an inbox**, the honest answer is usually `unpaid_attribution` plus the window mismatch. Set `attribution_window_days` to the platform's own window, filter `channel` or `has_click_id`, and read `click_window` before making any claim about timing. If `click_dated` is 0, `clicks_before_range: 0` is **not measurable**; say so rather than concluding the boundary is clean.

**Step 3. Close it properly.** `pm_tasks_create` for the hostname registration or the form-id fix, `memory_create` for the finding so the next session does not re-derive it, and hand the client the row list for anything recovered. If the conclusion involves an offline conversion upload, `form_lead` is a source of the declared `marketing_offline_conversions_*` lane (google / microsoft / meta; `status` first, `preview` before `run`, validate-only until a human goes live in the dashboard - the offline-conversions reference, section 13); rows you assembled by hand go through `ppc_offline_conversion_upload` and it is **two-step by design**: the first call with no `confirm` returns a dry-run preview with `requires_confirm: true` and uploads **nothing**; you repeat the identical call with `confirm: true` only after the operator approves the previewed rows. It is **Google Ads only** and another platform's connection returns a wrong-platform error, not an empty result.

---

## 9. What NOT to conclude

- **Not in the Forms tab does not mean lost.** Reconcile runs every 15 minutes and files late rows with source `reconcile`.
- **`spam` does not mean no row.** Only `drop` means no row. Quote the client rows, never a spam count.
- **Duplicate leads are not always a bug.** Dedupe deliberately refuses to link two rows of the same source, because a same-source repeat is a real second fill.
- **A `capture`-sourced row missing `attribution_captured_at` is not a defect.** The module is storage-free by design and can never send it.
- **`clicks_before_range: 0` with `click_dated: 0` is not zero, it is unmeasurable.**
- **A missing `first_touch_at` is not a null bug.** Resolution omits rather than writing a value it cannot justify, because a wrong timestamp is worse than none.
- **Multiple records for "one form" is not a data-loss bug**, it is a junk identity being path-scoped. The fix is markup plus a deploy, not a database edit.
- **A big `unpaid_attribution` bucket is not a tracking failure.** It is real leads from channels the client is not paying for, and it belongs in the report as good news.

## 10. Where each fix lives (tool or dashboard - say which)

- Registering a hostname on a project (the reCAPTCHA fix): `project_domains_add`, per Section 4 - a confirmed write whose DNS records you surface to the client. Dashboard only as the fallback on a key that cannot see `project_` tools.
- Restoring a submission out of `spam`, un-archiving, or undeleting: no MCP tool - the Forms tab in the dashboard.
- Muting a form record, or configuring per-form notification recipients: no MCP tool - the Forms tab in the dashboard. Wiring a form to a workflow, though, is `workflow_bind_form` (dry_run first).
- Renaming or merging a form record: change the markup (`project_files_bulk_get` -> `project_files_bulk_save` -> `project_vcs_commit` -> `deploy_site` on approval), then verify with `marketing_form_conversion_audit({ form_key })`.
- Triggering reconcile, the sweeper, or the attribution backfill on demand: no MCP tool. They run on schedule; wait rather than promising.
