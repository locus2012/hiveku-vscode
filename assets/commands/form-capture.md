---
description: "\"Stop capturing our login form\" / \"sign-ins and portal screens are showing up as leads\" / \"which forms does Hiveku record?\" - form capture controls for one site: read the switch, the site type and the rules, decide with the owner whether it is a marketing site or a web app, preview a change against real submissions, save it only on an explicit yes, verify, and erase what was captured by mistake only after a dry run the owner has seen."
argument-hint: "[optional: a path such as /portal/*, a form name, or erase]"
---
Form capture controls ($ARGUMENTS). By default Hiveku captures every form on a Hiveku-hosted site
(the built-in capture script, the analytics embed, and the replay that fills their gaps), and every
capture becomes a CRM contact, a lead notification, a workflow run and, where ads are connected, a
paid conversion. On a web app that turns sign-ins, password resets, admin screens and the data end
users type into "leads": one events app filed hundreds of registrations into its owner's CRM,
children's names included. This play decides with the owner what the site should capture, changes
it safely, and erases what was captured by mistake. You are operating a customer's account: every
write below waits for the owner's explicit yes. Background: the **hiveku-conversion-tracking**
skill's `references/forms.md` (section 11) and the **hiveku-web-agency** skill's
`references/forms.md` (F15 and "Opting out and in").

**How one submission is decided - the most specific signal wins, like CSS:**
1. The capture switch is off: not captured (`capture_off`). It beats everything, markup included.
2. Markup on the `<form>`: `data-hiveku-capture="off"` skips it (`markup_off`), `="on"` keeps it
   (`markup_on`).
3. A rule for that exact form: exclude (`form_excluded`) or include (`form_included`) - "Never"
   and "Always" in the dashboard.
4. The sign-in default (`skip_sign_in_forms`, on unless switched off): a credential-shaped
   submission - no field that reads as a name (other than a username), a phone, a company or a
   message - on a sign-in or password page, posted to an auth endpoint, or carrying a password
   field is skipped (`sign_in_form`). A signup that asks for a name is never skipped by it.
5. The most specific matching path rule: exclude (`path_excluded`) or include (`path_included`);
   exclude wins a tie.
6. Web app site type (`mode: "allowlist"`): skipped unless something above included it
   (`not_allowlisted`).
7. Otherwise captured (`default`).

Only automatic capture is governed. A hosted Hiveku form, and a form that posts to a wired
workflow webhook, are never affected: excluding a form here does not stop its webhook.

**Path rules** start with `/`; case, a trailing slash and any `?query` are ignored, and a rule
matches the page the form was on, never the form key or the address it posts to. `/login` is that
page only. `/events/*/digital`: a `*` is exactly one segment. `/blog-*`: a star inside a segment. A
TRAILING `/*` is the page AND everything below it: `/portal/*` matches `/portal`, `/portal/x` and
`/portal/x/y`. An exact-length rule beats a trailing-`/*` rule, so `/portal/contact` set to include
survives an excluded `/portal/*`. Refused: a bare `/*` or `*` (that is the switch or the site
type), `**`, full URLs, `?` or `#`, spaces. At most 50 path rules and 200 form rules.

**Markup, for the site's developer.** `<form data-hiveku-capture="off">` is never captured by any
Hiveku script. `<form data-hiveku-capture="on">` is captured even on a Web app site and even when
it looks like a sign-in form; only the switch beats it. `window.hivekuCaptureForm(fields, name)`,
for a form with no `<form>` element, counts as "on". Markup is a code change (/hiveku:code): it
reaches the site's built-in script on the next deploy and the analytics embed within about a day.
A settings change below applies to the next submission, with no redeploy.

**Muting is not the same as not capturing.** Muting a form under Notifications stops the email
only: a muted form still creates contacts, runs workflows and sends ad conversions. When the owner
says "stop that form", ask which of the two they mean.

The play:

1. **Confirm the account and the site.** `get_account_info`, and say the account name back before
   any write. `account_context_get({ domain: "marketing" })`: rules and memory often name the money
   forms and any earlier capture decision. `sites_list` for the website `project_id` (never
   `list_projects` / `get_project`: those are PM projects, a different id space). The five tools
   are `marketing_`-prefixed, and a key that cannot see them is scoped, not broken; a `dev`-profile
   key sees every one except `marketing_form_capture_purge`. Say which part you cannot reach and
   hand the owner the dashboard path for it (Analytics > Forms > Capture).
2. **Read the current state.** `marketing_form_capture_settings_get({ project_id })`: `enabled`,
   `site_type` (`marketing_site` | `web_app`), `skip_sign_in_forms`, `path_rules[]`,
   `form_rules[]`. Then `marketing_form_capture_list({ project_id, days: 90 })`, one row per form:
   `name`, `page_path`, `submissions` (recorded in the window), `status` (`captured` |
   `not_captured` | `mixed` - some of its submissions kept and some skipped, such as a shared form
   that a path rule catches on some pages), `reason_text`, the form's own `rule`,
   `recorded_now_excluded` (recorded in the window and excluded by the current rules: roughly what
   an erase would remove; the erase's dry run gives the exact count), `skipped_30d` (approximate;
   null means unknown, never zero) and `sign_in_page`. Read `totals.sign_in_forms_seen`, and
   `truncated` (true means the counts are a sample - say so). Show the owner a table: form, page,
   submissions, status, reason.
3. **Decide with the owner what this site is.** Never decide alone; put the evidence in front of
   them (rows with `sign_in_page: true`, pages under a portal or dashboard, forms whose fields are
   what users type into an app rather than an enquiry).
   - **Marketing site** (the default, `mode: "all"`): "we record every form except the ones you
     tell us to skip". Keep the sign-in default on and exclude only app-like paths or forms the
     owner names.
   - **Web app** (sign-in, a portal, admin screens, end-user data entry): "we record only the
     forms you pick". `mode: "allowlist"`, and include the real lead forms (contact, quote, demo
     request) in the SAME update, by form rule (live at once) or by `data-hiveku-capture="on"`
     (next deploy), so there is no window in which the contact form goes quiet.
   - **Nothing** (no lead forms at all, or a sensitive capture that must stop now):
     `enabled: false`. It beats every rule and every attribute.
   Leave `skip_sign_in_forms` on unless the owner has a reason; to keep one sign-in-looking form,
   include that form rather than switching the default off for the whole site. Never exclude a
   form that produces real enquiries without the owner's explicit yes to that form by name.
4. **Preview before any exclusion.** `marketing_form_capture_preview({ project_id, exclude_paths:
   "/portal/*,/admin/*", include_paths: "/portal/contact", mode, enabled, skip_sign_in_forms,
   days })` evaluates the current policy plus these changes against recorded submissions and saves
   nothing (`saved: false`); the path lists are comma-separated strings. Read
   `impact.newly_excluded` and `impact.newly_included`, then every row of `impact.by_form`
   (`name`, `submissions`, `before` -> `after`, `reason_text_after`; only forms whose status
   changes, largest first, at most 50). If a form it would stop capturing looks like a real lead
   form, narrow the rule or include that form before saving. The preview takes no form rules: for a
   per-form Never, that form's row in step 2 is the impact. And it only sees forms submitted in the
   window, so ask the owner to name their lead forms rather than trusting absence.
5. **Save only on an explicit yes** to the exact change, said back in plain words ("stop capturing
   everything under /portal, keep /portal/contact"):
   `marketing_form_capture_settings_update({ project_id, enabled, mode, skip_sign_in_forms,
   path_rules, form_rules })`, sending only the fields that change. The rule maps MERGE:
   `path_rules: { "/portal/*": "exclude", "/portal/contact": "include", "/old-page": "remove" }`
   adds or changes the rules it names, `"remove"` deletes one, and every rule not named is kept -
   never resend the whole list expecting a replace. Form rules take the exact `form_key` from the
   list: `form_rules: { "<form_key>": "exclude" }`. An unknown field or an empty change is a 400
   naming the problem, and nothing half-applies. The answer carries the saved settings, `impact`
   (what the change does to the last 90 days of recorded submissions) and `conversions_held`
   (queued ad conversions from newly excluded forms, parked so they never upload); report both.
   Conversions already uploaded stay on the ad platform.
6. **Verify.** `marketing_form_capture_list({ project_id })` again: every form the owner meant
   reads the intended `status` and `reason_text`, and every lead form still reads `captured`. New
   submissions follow the rules at once and the analytics pipeline within about a minute; a markup
   change only after the next deploy (then send one test submission). Record the decision - the
   site type, each exclusion and why - in marketing memory, so the next "leads are down" finds it
   before blaming the market.
7. **Erase what was already captured, only if the owner wants it gone.** A rule stops new
   captures; submissions recorded before it stay until erased, and the erase reaches only
   automatically captured submissions the CURRENT rules exclude - exclude first (steps 4-5), then
   erase.
   - Dry run, the default: `marketing_form_capture_purge({ project_id, since, limit })` (`since` an
     optional ISO date; `limit` 1-500 per batch, default 250). The key needs CRM write as well; a
     403 saying so is the key, not the data.
   - Show the owner before asking anything: `total_excluded_submissions` (all batches);
     `batch.submissions` and `batch.by_form[]` (name, submissions, reason_text);
     `batch.contacts_erasable` against `batch.contacts_kept`, with `batch.contacts_kept_by_reason`
     (a contact with any other history - a deal, an email, another form - is kept);
     `batch.mixed_groups_left_alone` (submissions a hosted form or webhook also recorded, left
     alone); `batch.offline_conversions` (`pending` ones are removed; `already_uploaded` stay on
     the platform, and Meta cannot delete them); `batch.workflow_runs_to_redact`;
     `more_available`; and every line of `cannot_undo`, verbatim. Say plainly that it is
     PERMANENT and that the analytics copies are retained (`analytics_copies: "retained"`).
   - Only on an explicit yes to those numbers: `marketing_form_capture_purge({ project_id,
     confirm: true, confirm_token, since, limit })` with the SAME `since` and `limit`, within 15
     minutes of the dry run. A 409 `stale_plan` means the set changed: dry-run again and show the
     new numbers; never retry the erase blindly.
   - **Until agent execution is switched on, the erase answers 403 `agent_execute_disabled`.**
     Say so in one sentence and send the owner to the dashboard: Analytics > Forms > Capture >
     Erase runs the same dry run, counts and confirm. Do not retry, and do not look for another
     route.
   - One batch per yes. With `more_available: true` the next batch is its own dry run and its own
     yes; never loop batches without the owner seeing the total.
   - Afterwards, `marketing_form_capture_list` again: `recorded_now_excluded` for those forms drops
     by what was erased.
   The case this exists for is an app capturing children's names, health details or account data:
   switch capture off or set Web app mode FIRST, which stops new captures at once, then erase.
8. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
