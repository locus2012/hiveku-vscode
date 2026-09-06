# Forms on a Hiveku Site: Capture, Notify, Attribute

This is the manual behind the web-agency skill's one-line advice about forms. Load it before you write, edit, move, or debug any `<form>` on a customer's Hiveku site, and before you touch a workflow a form feeds. Lead capture is the reason these sites exist, and almost every way to lose a lead here is silent: nothing errors, the visitor sees a success message, and the only symptom is that the owner's phone stops ringing. Rules first, then the mechanism behind each so you can reason about cases the rules do not name, then diagnosis.

## Part 1: The non-negotiables

Every item is enforced by real platform behavior and has an incident behind it.

**Identity**

- **F1. Every `<form>` gets a real `id` AND `data-hiveku-form-key="<job>"`**, e.g. `id="contact-form" data-hiveku-form-key="contact"`.
- **F2. The SAME key on every page rendering the same form.**
- **F3. Never name a field `name`.** Use `full_name`, `first_name`, `contact_name`.
- **F4. `data-hiveku-form-name="<label>"`** overrides the display name. Cosmetic only.

**Wiring**

- **F5. Never wire a form to an endpoint.** No Formspree, Netlify Forms, `mailto:` action, API route, or custom POST handler for lead capture. A plain `<form>` with real fields IS the working contact form.
- **F6. Never put `<input type="hidden">` on a lead form.** To record page or plan, use a VISIBLE readonly field, or leave it out: the page path is already recorded.
- **F7. Never add your own captcha.** And if the site you inherited ALREADY has one, leave it exactly where it is: do not remove it, do not add Hiveku's on top.
- **F8. Never hand-roll a pixel or widget that POSTs through a form element.**

**Fields**

- **F9. Every input needs a real native `name` attribute** present in the markup.
- **F10. Never rename a `name` on a live form.** Adding attributes (`id`, `data-hiveku-form-key`, `autocomplete`) is always safe. Changing `name` is not.
- **F11. Autocomplete tokens are mandatory**, not polish: `given-name`, `family-name`, `email` (`type="email" inputMode="email"`), `tel` (`type="tel" inputMode="tel"`), `postal-code` (`inputMode="numeric"`), `organization`, `autoComplete="off"` on the message field.
- **F12. Never mask or reformat a phone field while typing.** No onChange that rewrites the value, no mask library, no `maxLength`, no regex that rejects a keystroke. Normalize at SUBMIT.
- **F13. Never build your own masking or redaction.** Redaction is automatic and name-driven.

**Honeypot and opt-out**

- **F14. Include a honeypot, and it must NOT be `type="hidden"`.** A real `type="text"` input named `hvk_contact_pref`, hidden with CSS, `tabIndex={-1}`, `autoComplete="off"`, in an `aria-hidden` wrapper, `absolute h-px w-px overflow-hidden` at `left:-9999px`; parent `<form>` needs `relative`. Canonical component: `components/ui/form-honeypot.tsx`. Absence is never treated as suspicion, so a legacy form without one is not broken.
- **F15. `data-hiveku-capture="off"` on every `<form>` that is not a lead form.** Search boxes, filters, newsletters the owner does not want recorded.

**Workflows behind the form**

- **F16. A public lead form's workflow trigger must be `authentication: 'none'`.** A 401 on a form POST is config, not code.
- **F17. Only reference fields the form actually sends** in workflow expressions.
- **F18. Prefer parallel to series.** Notification and CRM write as siblings off the trigger; set `on_error` deliberately.
- **F19. Never provision a database, or reach for an external service, to store a lead.** Native CRM nodes exist for exactly this.

**File uploads**

- **F20. File inputs need only a name; never wire an uploader.** `<input type="file" name="resume">` inside a captured form is the whole feature: Hiveku uploads the file in the background, holds the submit until it is ready, and attaches it to the lead. Never write an upload handler, an S3 client, a presigned-URL route, or Supabase storage for a form. Opt one input or one form out with `data-hiveku-uploads="off"`.

## Part 2: The mechanism

### Identity resolution, and why F1 and F2 matter

The capture module resolves a form's identity in this order:

```
data-hiveku-form-key  ->  id  ->  name  ->  FIRST CSS CLASS  ->  "unnamed"
```

The key it builds is `<identity>@<normalized pathname>`. The server strips the `@path` for a REAL identity, so one shared component on twelve pages collapses to ONE record, but KEEPS the path for a JUNK identity, which is not trustworthy enough to merge across pages.

That branch is the whole story. Give the form a real key and you get one clean record for the site. Omit it and identity falls to the first CSS class, on a Tailwind site something like `space-y-4`, which is junk, which keeps path-scoping on, which is one record per page per form.

Junk identities: `''`, `unnamed`, `unknown`, `xhr`, `null`, `undefined`, anything starting `[object`, anything matching `/^[a-z-]+-\d+/` (`gap-4`, `mt-8`, `space-y-1.5`), and a 40-plus entry Tailwind prefix list (`space-y-`, `gap-`, `flex`, `grid`, `w-`, `p-`, `text-`, `bg-`, `border`, `rounded`, `items-`, `absolute`, `relative`, `container`, `form`, and more).

The incidents: form records named **"Space Y 4 Form"** and **"Flex Form"** in customers' Forms tabs; **"ONE SITE REACHED EIGHTY-FOUR RECORDS FOR THREE ACTUAL FORMS"**; **"nineteen records for a handful of forms"** from path-scoping `space-y-4`; mazcnc.com carrying `contact-form@/contact` AND `contact-form@/contact/`, **split on a trailing slash**; and **"37 form records in production"** carrying the literal identity `[object HTMLInputElement]`.

That last one is F3. `form.name` is a real property of `HTMLFormElement`, and the DOM's named-element access overwrites it with the input element when a child is named `name`. Stringify that and you get `[object HTMLInputElement]`, which starts with `[object`, which is junk, which path-scopes, which is how three forms became thirty-seven records. The trailing-slash split generalizes too: a real key discards the path entirely.

### Why never wire an endpoint (F5)

Every `<form>` on a deployed Hiveku site is captured automatically by an inline module injected at build time. Submissions land in the Forms tab, upsert a CRM contact, notify the owner, and fire any automation the owner built. Capture is ALWAYS on, ungated by consent or analytics settings.

So a second writer does not add a second path. It creates a SECOND RECORD of the same submission, and the customer gets two of everything. If the user asks for "a working contact form," say plainly that a plain `<form>` with real fields IS one.

### The fingerprint, and why hidden inputs are the most expensive mistake in this playbook (F6)

Duplicate suppression works on a fingerprint: form identity plus a digest of the submitted VALUES. Two things are deliberately excluded: field NAMES, because writers disagree about them (`firstName` versus `first_name`), and writer-generated ISO timestamps. **Never change this function's output.** Its job is to let two independent observations of one submit collapse into one row.

Hidden inputs break it. The capture module DROPS hidden inputs before it serializes. The site's own webhook, if someone gave it one, receives them as ordinary JSON keys with no type to drop on. The two writers now see DIFFERENT field sets for the same submit, their fingerprints disagree, the rows never link, and the owner gets TWO "new submission" emails per lead.

**"ONE AGENCY SITE SENT 54 DUPLICATE EMAILS IN A MONTH from two hidden `package` fields."**

The same mechanism, one field earlier: **"mazcnc.com: the site's own handler posts `createdAt`... That single extra value changed the content digest, the two captures of one submission failed to match, and the customer received two emails for one lead."**

F5 and F6 compound: that month required both a second writer and a field one of them could not see.

Input types skipped entirely by capture: `password`, `hidden`, `submit`, `button`, `reset`, `image`. Never rely on them to carry data. A `file` input is different: its bytes never travel in the capture beacon, but the upload helper stores the file in Hiveku's private attachment store first and capture then carries a reference, so the submission arrives with the file bound to it and the field shows as `name (size)` in the Forms tab (F20).

### Field naming (F9, F10)

A value's label resolves through `name -> id -> aria-label -> placeholder`. Controlled React forms often set none of these, because state lives in `useState` and the DOM node is decorative. That pattern "silently captured nothing from a whole class of real forms." A React form still needs native `name` attributes, even when React never reads them.

F10 exists because the field name is a contract with systems outside Hiveku: "They are mapped into whatever the customer runs on their side, HubSpot Collected Forms, a CRM import, a Zapier step, by that exact string. Renaming `firstName` to `first_name` silently breaks the customer's pipeline, and nothing in Hiveku will report it." A tidy-up refactor that normalizes casing across a form is therefore a destructive change disguised as housekeeping.

### Honeypot (F14)

A honeypot as `type="hidden"` is pure decoration: capture skips hidden inputs before the trap is ever evaluated. It has to be a real text input hidden with CSS.

The name `hvk_contact_pref` is chosen, not arbitrary: it avoids the automatic redaction list (so the value survives to be judged) and the lead classifier's form-ish name list (so a filled trap is not mistaken for a real contact field). Invent your own name and you are gambling against both lists. Use the canonical component.

### Captcha (F7)

Hiveku injects Google reCAPTCHA at build time when the owner switches on Form spam protection under Hosting, Site Features. Sensitivity (Lenient, Balanced, Strict) is a card in the UI, so do not write code for it, and a second loader conflicts with it. Cloudflare Turnstile is common on inherited sites. Leave it. **"TWO CHALLENGES ON ONE FORM BLOCKS REAL PEOPLE."**

Worth telling a nervous owner, because it is true: reCAPTCHA v3 here is lazy (nothing loads until a field is focused), mints its token in advance, and FAILS OPEN. Nothing is ever deleted: spam goes to the Forms spam tab, one click from restore.

### Mobile autocomplete and the phone field (F11, F12)

A real customer submitted this:

> "I am interested in information for my parents. please contact me with details YOUR FORM SUCKS!!! I CAN'T PUT MY INFO IN. FORGET IT!"

The phone field in that record contained only `(208) `. A masking script had eaten the rest of the number on a mobile keyboard. **"That was a lost sale, on a form that passed every test we could run against it."**

That last clause is the point. Typecheck passes, build passes, the form submits, capture works, the record lands. Nothing in the stack can tell you the field is unusable, because the only failure is a human giving up. Accept `(208) 555-1234`, `208.555.1234` and `+1 208 555 1234` exactly as typed. Normalize at submit, not per keystroke. A submission with no email still lands, so phone-only forms are fine and there is never a reason to make a field strict to "protect" the record.

### What capture transmits, and its guarantees

Every send carries `projectId`, `token`, `formKey`, `formName`, `pagePath`, `pageUrl`, `fields[]`, `utmParams`, `visitorId`, `ad_consent`, `recaptchaToken`, `tts` (time-to-submit) and `submittedAt`.

Transport and behavior:

- POSTs `text/plain` via `sendBeacon`, CORS-safelisted, no preflight. A JSON content type is not, "which is what killed fleet-wide form capture once already."
- Listens in the CAPTURE phase, so a handler calling `preventDefault()` plus `stopPropagation()` cannot hide the submit from it. Your React `onSubmit` can do whatever it likes.
- Also patches `HTMLFormElement.prototype.submit`, because per spec that method dispatches no submit event at all.
- ONE send per form per page load.
- Storage-free by contract: zero cookie, localStorage, and sessionStorage access, for ePrivacy Art 5(3). That is why capture ships ungated on every site while analytics cannot, and why it deliberately does NOT emit `form_start` or `form_abandon`. A "just one" storage read belongs in the analytics embed instead.
- Limits: max 120 fields, values capped at 2000 characters, labels and names at 200, an 8000-character inline size budget.
- Automatic redaction when a field name contains `password`, `passwd`, `ssn`, `social`, `credit`, `cardnumber`, `cvv`, `cvc`, `pin`, `iban`, `routing`, `account_number`, `passport`, `taxid`, `dob`, `otp`, `secret`, `token`, or autocomplete is `cc-number`, `cc-csc`, `cc-exp*`, `current-password`, `new-password`, `one-time-code`.
- The owner sees every submission even if a workflow fails. Capture and automation are independent.

Escape hatch for a genuinely formless interaction: `window.hivekuCaptureForm(fields, name)`. Only when there is no form element to annotate, never to add a second writer to a form that has one.

### Opting out (F15)

"Without it, every site search creates a submission record." A search box, a filter bar, a sort control and a currency switcher are all forms to the DOM, and each produces lead records and owner notifications if left capturing.

### Things that POST but are not leads (F8)

Meta's pixel builds a hidden `<form>` and calls `HTMLFormElement.prototype.submit()`, exactly the method the module patches. Those beacons were landing in customers' Forms tabs **AT 89 A DAY on one site**. Chat widgets posting `chatWidgetId`, `conversationId` and `message` were emailed to owners as new leads. Both are now discarded platform-side, so you need not defend against them. What you must not do is create a new one: **"do not hand-roll a pixel that POSTs through a form."**

### Notifications and routing

The platform notifies on EVERY submission, and a user-built notification workflow is ADDITIVE, so a site with a working notify workflow sends two emails per lead. That is an accepted trade-off, not duplicate capture: do not "fix" it by deleting the workflow without asking.

- `website_projects.form_notify_email` is the per-project routing control.
- Recipients resolve ONLY server-side. There is no client-side recipient in markup, so never put an email address in a form attribute expecting it to route anything.
- Cap is 60 emails per account per hour, then a rollup.
- Sender is `Hiveku Forms <no-reply@notifications.hiveku.com>`. The apex `hiveku.com` is NOT verified and silently rejects, so never tell an owner to expect mail from the apex.

## Part 3: Workflows behind a form

This part covers the form-facing slice. For building an automation from scratch, event triggers, cron schedules, version rollback, and the full run-debug ladder, load the `hiveku-automation-agency` skill.

### The 401, verbatim (F16)

> "When a website form silently fails, the visitor sees a fake success but no email arrives and no CRM contact is created, or a test POST returns 401 'Unauthorized: Missing Bearer token', this is almost never a code bug. It is the workflow trigger's auth config: the `workflow_triggers` row has `require_auth_token = true` while the form is a PUBLIC lead form that posts with no credential. PUBLIC FORMS MUST BE `authentication: 'none'`. Do NOT rewrite the form component, add a proxy route, or tell the user the webhook endpoint is broken. The workflow-level `authRequired` flag is MISLEADING, the trigger row's `require_auth_token` is what gates the webhook."

Fix with `workflow_trigger_update`, config `{ authentication: 'none' }`. Webhook URL format is `https://app.hiveku.com/api/webhooks/trigger/{path}`.

`authRequired` can read false while the trigger row still gates the webhook, so reading the workflow and concluding auth is off is how this becomes an afternoon of rewriting a correct component.

### Binding a form to a workflow

`workflow_bind_form({ workflow_id, project_id, form_file_path, dry_run? })` is regex-based, not AST-based, so it only finds a form that follows the convention: file at `components/sections/*-form-island.tsx`, a literal `process.env.NEXT_PUBLIC_<PAGE>_<FORM>_WEBHOOK_URL` reference, native HTML `name="..."` on inputs (hidden, submit and button skipped), `"use client"`, and a client-side `fetch` POST with `FormData`. Its warnings name the deviation ("React Hook Form register() detected, field detection is incomplete", "useState-style field storage detected with no HTML name attributes", "No process.env.NEXT_PUBLIC_*_WEBHOOK_URL reference found"). `dry_run=true` previews.

**For a whole site, do not run that dance N times.** `workflow_bulk_provision_for_project({ project_id, template_slug?, overrides?, file_paths?, dry_run? })` scans the project for form components and, per form, instantiates the canonical template (`template_slug` defaults to `contact-form-canonical`), looks up the freshly provisioned webhook URL, and sets that form's `NEXT_PUBLIC_*_WEBHOOK_URL` project secret, which auto-rebuilds the preview. It returns per-form `{ workflow_id, webhook_url, env_var, warnings }` plus `skipped` (no env var found, not a form) and `errored` lists, and takes a site from roughly 15 MCP calls to 1.

Two things to hold when you use it. **Run `dry_run: true` first and read `skipped`**: a skipped form is a form whose leads go nowhere, and it is silent. And **`overrides` apply to EVERY form in the batch**, so a site where sales@ takes the contact form and service@ takes the booking form cannot be done in one call: use `workflow_create_from_template` + `workflow_bind_form` per form, or fix it afterwards with `workflow_set_recipient({ workflow_id, recipient })` on the individual workflow.

A bare "webhook in, action out" with no project form attached is `workflow_provision_webhook({ name })`, which returns `{ workflow_id, webhook_url, trigger_id }` in one shot. It defaults `is_enabled: true`, so the URL is live the moment it returns, and if you pass `authentication: 'bearer'` the one-time `bearer_token` in the response is never shown again.

### Node config, expressions, and the literal-string trap (F17)

Config shape differs per node: hand-built editor panels (`sendEmail`, `delay`, `conditional`, `apiCall`, `transformData`) read fields FLAT off `node.data`; the generic schema panel reads `node.data.config.<key>`.

Every text and recipient field is a `{"mode":"expression","value":"..."}` OBJECT, not a plain string, which shows up BLANK in the node panel. Only `label` stays plain. Reference trigger data as `{{trigger.output.payload.<field>}}`. `sendEmail`'s body field is `body`, plain text, no `htmlBody`, and it is zero-setup, so never block a form workflow on sender-domain verification.

Three tools exist so you never have to guess at any of this, and they have names:

- **`workflow_node_types_list`** before you add a node. It is the only way to know which `type` strings the engine accepts: 260+ types with category, label, description, and per-type `fields[]` where the required ones are marked `required: true`. The exact set moves per deploy, so read the catalog rather than a type string from memory.
- **`workflow_templating_syntax`** before you write any `{{...}}` value. It returns what the executor resolves at run time, what `trigger.output.payload` / `headers` / `query` contain, how to reference an upstream node's output, and the `{mode, value}` field modes `sendEmail` uses.
- **`workflow_validate({ workflow_id })`** after every batch of edits, before `workflow_test` or `workflow_enable`. It returns `{ ok, issues[], summary: { nodes, edges, triggers, errors, warnings } }` and catches unknown node types, missing required fields, dangling edges, duplicate ids and no trigger as errors, plus orphan nodes, multiple triggers (**only the first fires**), self-loops and invalid source handles as warnings.

Then re-get the node after a create or update to confirm the fields actually landed. That read-back is the only thing that catches a field that did not stick.

Then F17, the one that pollutes the CRM:

> "Only reference fields the form actually sends. An unresolved `{{...}}` is written through as the LITERAL string, not an error, so `{{body.email}}` on a form with no email field stores the text `{{body.email}}` as somebody's email address. That client has 8 junk contacts from exactly this."

Read the form's real field names before writing the expression; never infer them from the design.

### Dry-run before you enable, always

`workflow_test({ workflow_id, input_data })` runs the graph with every side-effecting node short-circuited: no outbound email, SMS, Slack or Discord, no CRM writes, no external `apiCall`, no helpdesk tickets, no PM writes, no `dbInsert`/`dbUpdate`/`dbDelete`, no deploys or file saves. Transforms, array ops, template resolution and flow control still run, so the shape of the run is real. Run quota is not debited and no run row persists.

Then `workflow_run_get({ workflow_id, run_id })` and read each short-circuited node's `step_states` entry: it carries `__dry_run: true` and `would_have: { ...the args it would have sent }`. **That `would_have` payload is where you catch F17**: the recipient that resolved to a literal `{{body.email}}`, the empty subject, the CRM contact with no name, all before a customer ever sees it. Enabling a new form workflow and letting a real submission be the test is how a client's first lead becomes the bug report.

One caveat to state when you report a passing test: a downstream node referencing `{{nodeId.output.X}}` sees the `would_have` payload or a synthetic field (a fake `messageId` from `sendEmail`), so structural correctness is proven and delivery is not. Never use `workflow_run` as a test. It sends for real.

### on_error and the circuit breaker (F18)

`on_error` defaults to `"fail"` and stops the whole downstream path.

> "a client had every form on their site returning 500 for six days because a CRM write sat in series ahead of the notification email with the default."

For a workflow you are BUILDING: wire the notification and the CRM write as SIBLINGS off the trigger. A failing CRM write must never swallow the owner's lead email.

For a workflow you are REPAIRING that is 500ing right now, re-architecting a live graph under traffic is the risky move, and `on_error` is a settable field rather than a fixed default. One patch is safer:

```
workflow_node_update({ workflow_id, node_id, data: { on_error: 'continue' } })
```

on the non-critical leg. The engine reads the mode from `node.data.config.on_error` or `node.data.on_error`, values `'continue' | 'fail'`, and the run then completes with degraded steps instead of blasting a 5xx back at the form. The soft-failed step is recorded in `step_states` as `status: 'completed'` with `degraded: true`, `original_error`, and `on_error_mode: 'continue'`, and `workflow_run_logs` carries a `warn` line naming it, so it stays visible rather than silent. Downstream nodes see that node's output as `{ __error, __degraded: true }` instead of crashing. Do not set it on a node whose failure actually matters: it converts a loud failure into a quiet one.

Note `data` is SHALLOW-merged into the node's existing data, so this patches one key without resending the node, and setting a key to `null` clears it. Since every text field is a `{mode, value}` object (above), a shallow merge is what you want here.

Five consecutive failures auto-pause a workflow.

> "its webhook still ACCEPTS deliveries (the payload is stored) but nothing runs them... Nothing un-pauses it automatically, even after the bug is fixed. ONE CLIENT'S FORMS WERE DOWN SIX DAYS that way, and the cause had been fixed on day two."

Recovery order is strict, and every step has a guard:

1. `workflow_run_get({ workflow_id, run_id })` on the failing run for per-node `step_states`. If you do not know which workflow tripped, `workflow_runs_recent({ status: 'failed', since })` is account-wide and names it.
2. Fix it (`workflow_node_update`), then `workflow_validate({ workflow_id })`, then `workflow_test`. Resuming a workflow that is still broken just re-trips the breaker.
3. `workflow_stranded_list({ workflow_id })` is READ-ONLY. It returns the pause window, the count, and one row per submission carrying its payload KEYS only (the field names, never the values, because a stranded payload can hold personal data). You can tell the client how many leads are waiting and when they arrived; you cannot read them the contents.
4. **Show the operator the submissions, not a count, and get approval.**
5. `workflow_resume({ workflow_id })` clears the pause and resets the failure counter. It runs nothing by itself, and replay is rejected while the workflow is still paused, so this must come first.
6. `workflow_stranded_replay({ workflow_id, confirm: true })`.

That last call SENDS REAL NOTIFICATIONS through the workflow's CURRENT definition. Three things to hold before you make it:

- **`confirm: true` is required.** The route returns 400 without it, so a first call that omits it fails outright.
- **It is capped at 25 per call**, silently clamped. A 60-submission backlog takes three calls; re-run `workflow_stranded_list` to confirm it actually drained rather than assuming one call did it. Pass `trigger_run_ids` to replay a chosen subset instead.
- **These submissions can be days old.** On the six-day outage above, an unannounced replay emails a week of people about a form they filled in last Tuesday. Say that in those words before you send, and offer to replay only the recent ones.

### Never a database for leads (F19)

`crmCreateContact`, `crmUpsertContact`, `crmCreateDeal` and `crmCreateCompany` write to Hiveku's built-in CRM with no database and no setup. Never use `dbCreateRow`, and never provision or suggest a project database, to store a contact, lead, or form submission: `dbCreateRow` is only for a user's own custom app tables. The canonical shape of "contact form, save the lead, notify us" is `webhookTrigger -> crmCreateContact` and `sendEmail` as siblings. No database, ever.

### File uploads (F20)

A file input inside a captured form is handled by the platform. The visitor picks a file, a small helper uploads it to Hiveku in the background with a plain status line, the submit button waits until every upload is ready, and the form then submits exactly as it would without the file. The site needs no route, no client library, no storage, and no environment variable. Limits are per project (a default of 5 files and 25 MB per file, adjustable up to 100 MB, a fixed extension list, and a retention window of 30 to 365 days; files over 10 MB upload in parts automatically) and the owner sets them under Analytics > Forms > Notifications. The uploaded files land on the submission in the Forms tab, on the notification email as real attachments, and on the CRM contact's Attachments section; a workflow reads them as `{{trigger.attachments}}`.

**Reading what visitors uploaded.** `marketing_form_attachments_list` lists attachment metadata by `submission_id`, `contact_id`, or `project_id` (file name, size, mime, state, `scan_status`; never a link). Every file is malware-scanned after upload: a link is minted only once `scan_status` is `clean` (or `unsupported` / `failed`, meaning the scanner could not read it), `pending` answers 409 and means try again in a few minutes, and `infected` is quarantined for good. `marketing_form_attachment_download_url` mints a short-lived signed link for ONE attachment id, only when the operator explicitly asks for that file, and the link must never be pasted into a document, a task, a note, or a report. `marketing_form_upload_settings_get` reads a project's upload policy and quota usage, which is the first call when a client says an upload was refused. `marketing_form_upload_settings_update` narrows that policy (disable, allowed extensions, size, count, retention) and is a confirmed write: shortening retention purges files on the next sweep. `marketing_form_conversion_audit` accepts `include_attachments` to show the metadata inline per submission.

## Part 4: Diagnosis

| Symptom the user reports | What it actually means | What to check |
|---|---|---|
| Form "silently fails": visitor sees success, nothing arrives. | Almost never code. `require_auth_token = true` on a public form's trigger. | The `workflow_triggers` row, not the workflow's `authRequired`. Set `{ authentication: 'none' }`. Do not rewrite the component or add a proxy route. |
| Test POST returns 401 "Unauthorized: Missing Bearer token". | Same cause, definitive signature. | Same fix. Never tell the user the webhook endpoint is broken. |
| "Two emails for every lead." | Two writers whose fingerprints disagree: a second endpoint (F5) plus a hidden input or extra timestamp value (F6). | Grep for a fetch/action/POST handler and for `type="hidden"`. Remove the second writer first. |
| Two emails, and the site has a notify workflow. | Not a duplicate. Platform notification plus an additive user workflow. | Count records in the Forms tab. One record, two emails is the accepted trade-off. Ask before deleting their workflow. |
| Dozens of records named "Space Y 4 Form", "Flex Form". | No form key, identity fell to the first CSS class, junk identity kept path-scoping. | Add F1 and F2, then check the Forms tab to see how existing records behave before promising the customer a cleanup. |
| A record named `[object HTMLInputElement]`. | A field named `name` clobbered `form.name`. | Rename to `full_name`, but per F10 flag the rename to the owner rather than doing it quietly. |
| One form appears twice, split on a trailing slash. | Path-scoped junk identity, `@/contact` vs `@/contact/`. | F1. The key discards path entirely. |
| Records from the search box, filter bar, or newsletter. | Those are `<form>` elements and capture is ungated. | Add `data-hiveku-capture="off"`. |
| Records with `chatWidgetId` / `conversationId`, or a beacon flood. | A chat widget or Meta pixel POSTing through `HTMLFormElement.prototype.submit`. | Both discarded platform-side now. If you still see them, check custom code for a hand-rolled pixel. |
| A CRM contact whose email is literally `{{body.email}}`. | Unresolved workflow expression written through as a string. | Read the form's real field names, fix the expression, clean the junk contacts. |
| "Forms stopped working days ago" and nothing changed. | Circuit breaker: 5 consecutive failures paused it. The webhook still accepts and stores deliveries, nothing runs them. | `workflow_run_get` the failing run, fix, `workflow_validate`, `workflow_stranded_list`, get approval, `workflow_resume`, `workflow_stranded_replay({ confirm: true })`. In that order, and the replay is capped at 25. |
| "Every form on the site returns 500." | `on_error: "fail"` default with a failing node in series ahead of the rest. | Building: re-wire notification and CRM write as siblings off the trigger. Repairing live: `workflow_node_update({ data: { on_error: 'continue' } })` on the non-critical leg. |
| A lead never arrived and the form records look fine. | The workflow tripped, not the capture. Capture and automation are independent. | `workflow_runs_recent({ status: 'failed', since })` is account-wide, so you find WHICH workflow without iterating. Then `workflow_run_get` for `step_states`, `workflow_run_logs` for the timeline. Filtering on `queued` or `succeeded` returns nothing and looks healthy; the vocabulary is `pending \| waiting \| running \| completed \| failed \| cancelled` plus `stopped_*`. |
| A scheduled workflow (weekly report, nightly sync) never ran. | Usually the workflow itself is disabled, and the schedule will not fire if it is. Or there is no `scheduledTrigger` node at all. | `workflow_get_schedule({ workflow_id })`: `null` means no schedule node exists, and it also reports whether the workflow is enabled plus `next_run_at`. Check `timezone`, which defaults to UTC. |
| A React form captures nothing. | Controlled inputs with no native `name`, `id`, `aria-label`, or `placeholder`. | Add native `name` attributes. React need not use them. |
| A customer cannot enter their phone number. | A mask, a `maxLength`, or a validating onChange. | Strip all of it. Any format in, normalize at submit. |

**"The platform says 40 conversions, the CRM shows 22 - where did the other 18 go?"** is a
tool call, not archaeology: `marketing_form_conversion_audit` returns form submissions with
their source attribution (UTMs, click ids, channel, landing page), aggregated the way a
platform aggregates, plus named discrepancy buckets that SUM TO THE TOTAL - deleted,
duplicate, spam, archived, workflow_failed, no_attribution, unpaid_attribution, counted.
Use `buckets.counted` as OUR number and explain the gap with the rest; unlike the dashboard
Forms tab it INCLUDES spam, deleted and duplicate rows and labels them, because they ARE
the answer. ALWAYS read the caveats in the response before reporting a discrepancy (this is
our record, not the platform's: view-through conversions can never appear here, the
platform dates by CLICK while we date by the event), and read `click_window` before quoting
click timing - if `click_dated` is 0, then `clicks_before_range: 0` means NOT MEASURABLE,
not zero. It is `marketing_`-prefixed (invisible to a `dev`-scoped key; plugin sessions see
it). Deeper attribution disputes belong to the conversion-tracking skill.

Three more, briefly. Spam getting through is not yours to code: point the owner at Form spam protection under Hosting, Site Features, and check for a second captcha. "I can't see the change I made" is usually that files edited this turn reach the preview only at END of turn: do not restart the preview, and screenshot the exact page they are on before replying. And an empty client-errors result is not proof the page is clean, so check `capture_installed`.

### The two silences to fear

Most form bugs here produce no error at all. Two categories deserve permanent suspicion.

**Identity silence.** Everything works and the record lands, but under a junk name in a new bucket. Nobody notices until the Forms tab has 84 records. Detectable only by reading the markup for F1 and F2, or by seeing form names that are obviously Tailwind classes.

**Human silence.** The phone field ate the number and the customer left. Storage-free capture emits no `form_start` or `form_abandon`, so there is no funnel and no record of the person who did not submit. The only defense is F11 and F12, applied preemptively on every form you touch, including ones you are only editing for copy.

Nineteen rules, F1 through F19. Two (F5, F6) compound into the duplicate-email failure; two (F11, F12) defend against a failure mode that leaves no trace in any log.
