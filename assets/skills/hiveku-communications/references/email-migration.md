# Moving an app's email to Hiveku (off Resend, Mailgun or its own SMTP)

Load this when a person says "move our email off Resend", "use Hiveku for the app's emails", "our password
reset emails come from Mailgun", or when a site that moved to Hiveku still carries `RESEND_API_KEY`,
`MAILGUN_API_KEY` or `SMTP_*` variables. `/hiveku:email-migrate` runs it.

The app keeps sending the whole time. Every change is additive until the last step, so the old provider
keeps working until the new path is proven.

## Ground rules

- **Names only, never values.** Inventory the old provider by variable names and code. Never read, print or
  copy the value of an old key, and never ask the person to paste one.
- **An Email Service key enters a site only through `email_project_connect`** (Rule 55,
  `hiveku-web-agency/references/build-and-deploy.md`). It writes the key as a server-only variable. Never put a
  key (`hk_live_`, `hk_test_`, `hvk_email_`) in code, a commit, or a browser-public variable (`NEXT_PUBLIC_`,
  `VITE_`, `REACT_APP_`).
- **Ask the person before each step that changes something they can see:**
  - the site's variables;
  - their DNS;
  - an email that goes to anyone;
  - the suppression list.

  `email_project_connect`, `email_domain_send_instructions`, `email_send` and `email_suppression_import` ask
  on every call anyway.
- **Tests go to the live preview first.** Its key is a test key: every send is recorded as simulated and
  nothing is delivered. A real send goes only to an inbox the person names.
- **Not covered:** inbound mail (Mailgun Routes, Resend inbound) is not something the Email Service receives.
  Say so, and leave it where it is.

## 1. Inventory (reads only)

1. `email_service_status`: `setup_checklist` and `next_step` say what the account still lacks.
2. `email_project_connection_get({ project_id })`: the site's email variables by name, what each holds in
   words (`production_key`, `test_key`, `other_key`, `setting`), which key each place runs with, and
   `connected`.
3. `project_secrets_list({ project_id, metadata_only: true })`: every variable name. Look for:
   - `RESEND_API_KEY`;
   - `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_URL` (an EU account uses `api.eu.mailgun.net`);
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`;
   - Laravel `MAIL_*`, Django `EMAIL_HOST*`;
   - `SENDGRID_API_KEY`, `POSTMARK_SERVER_TOKEN`.
4. `project_files_search({ project_id, query })` for the sending code:
   - `from 'resend'`, `new Resend(`;
   - `mailgun.js`, `mailgun-js`;
   - `nodemailer`, `createTransport`;
   - `@sendgrid/mail`, `postmark`.

   Also note every From address the code uses.
5. Note any route that receives the old provider's events (a `/webhooks/resend` path, a `svix` import, a
   Mailgun signature check): step 7 replaces it.

## 2. Pick the lane

| The app sends with | Lane | What changes |
|---|---|---|
| The Resend SDK or Resend's REST API | `resend` | Variables only. `RESEND_API_KEY` and `RESEND_BASE_URL` point the same SDK at Hiveku (the Node SDK reads `RESEND_BASE_URL`; another client needs its base URL set). |
| Mailgun (`mailgun.js`, `mailgun-js`) | `smtp` | Swap the Mailgun client for nodemailer (below). There is no Mailgun-compatible API. |
| SMTP already (nodemailer, Laravel, Django, Rails) | `smtp` | Variables only. |
| Plain HTTP, or a new integration | `api` | `POST https://app.hiveku.com/api/v1/email/send` with `HIVEKU_EMAIL_API_KEY`. |

The Resend lane serves `POST /emails`, `POST /emails/batch` (no attachments) and `GET /emails/{id}`.
- Attachments go as base64 content. An attachment `path` URL is refused, because Hiveku never fetches a URL
  for the app.
- Hosted templates and `topic_id` are refused rather than ignored.
- Errors keep Resend's shape, `{ statusCode, name, message }`.

The SMTP lane is `smtp.hiveku.com`:
- ports 465 (TLS) or 587 and 2587 (STARTTLS);
- user `apikey`, password the key;
- a key's `allowed_ips` is stored but not checked yet, over SMTP or the API: never tell the person it limits where
  the key works from.

## 3. The sending domain

1. `email_domain_list`. If the domain the app sends from is missing,
   `email_domain_add({ domain, purpose: 'transactional' })` returns the records to publish.
2. **The records sit beside the old provider's:**
   - **DKIM:** Hiveku's CNAMEs use their own names, so they never clash with the old provider's DKIM
     records. Keep the old ones until step 8.
   - **SPF:** a name may hold only one SPF record. Add the include from Hiveku's records to the existing
     `v=spf1 ...` record. Never publish a second one: receivers then fail both.
   - **Bounce domain:** `bounces.<domain>` gets its own MX and TXT. They are new names, so nothing clashes.
   - **DMARC:** keep the existing record.
3. If someone else runs the DNS, `email_domain_send_instructions({ id, to })` emails them the records. It asks
   first. Until Hiveku turns it on, the person opens the domain under Settings > Email Service > Domains and
   clicks **Send to Developer**.
4. `email_domain_check_dns({ id })` until every record is valid, then `email_domain_verify({ id })`. The check
   reads whether the SPF record carries Hiveku's include; it does not count DNS lookups. So look at `found`
   yourself: exactly one record at the name starts `v=spf1`, and the merged record stays under 10 lookups.
5. A domain that should carry only the app's mail: `email_domain_set_purpose({ id, purpose: 'transactional' })`.
   Marketing sends then pick another domain.

## 4. Bring the old suppression list (before any real send)

Export the old provider's bounces, complaints and unsubscribes. Resend, Mailgun, SendGrid and Postmark all
export them from their dashboards.

Run `email_suppression_import({ addresses, dry_run: true })`, show the person the counts, then import. While
Hiveku holds the tool, the dry run answers 403 `agent_changes_not_enabled` too: go straight to the by-hand way
below.
- `addresses` takes plain addresses, or `{ email, type, reason }` to keep each one's type.
- Imported bounces and complaints can never be removed again, so import only what the old provider marked
  that way.
- Until Hiveku turns the import on, add a few with `email_suppression_add`.

## 5. Connect the site

1. `email_project_connect({ project_id, lane, domain, from, dry_run: true })` shows what would be written,
   removed, made and replaced. Show it to the person. While Hiveku holds the tool, the dry run answers 403
   `agent_changes_not_enabled` too: go straight to step 5.
2. Run it again without `dry_run` once they say yes. It writes the test key under the variable's plain name
   (live preview, development and staging simulate every send) and the production key under its `_PROD`
   name (production delivers).
3. Variables that hold something else are refused (409 `variables_exist`) unless `replace: true`. For the
   Resend lane that is the switch itself: `RESEND_API_KEY` stops holding the old key.
4. `names` maps each role to the names the app reads:
   - Laravel: `{ host: "MAIL_HOST", port: "MAIL_PORT", user: "MAIL_USERNAME", key: "MAIL_PASSWORD", from: "MAIL_FROM_ADDRESS" }`;
   - Django: `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`.
5. Until Hiveku turns the tool on (403 `agent_changes_not_enabled`), the person does it by hand:
   - creates a test key and a production key under Settings > API Keys (Create API Key, then Test or
     Production). The dashboard cannot limit a key to one domain;
   - adds them under the site's environment variables: the test key under the plain name, the production key
     as `<NAME>_PROD`.
6. A Mailgun app on the SMTP lane also needs its client swapped. A minimal nodemailer send:

   ```js
   import nodemailer from 'nodemailer';

   const transport = nodemailer.createTransport({
     host: process.env.SMTP_HOST, // smtp.hiveku.com
     port: Number(process.env.SMTP_PORT ?? 587),
     secure: Number(process.env.SMTP_PORT) === 465,
     auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, // user: apikey
   });

   await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject, html, text });
   ```

   Commit the change on a branch and run the site's checks before merging.

## 6. Test in the preview, then cut over

1. In the live preview, make the app send its real emails: sign up, reset a password, place a test order.
2. Read them back:
   - `email_logs_list({ api_key_id })` with the test key's id from `email_project_connection_get`. Each one
     is recorded as simulated, with its From, subject and recipients.
   - `email_message_get({ id })` opens one (it asks, and needs Open sent emails). Check the body renders and
     its links point at the right site.
3. **Cut over:** deploy production (`deploy_site`, or the person's usual deploy). Production now delivers with
   the production key.
4. Make one real email go to an inbox the person owns. `email_logs_list` should show it sent, then delivered.
   The received message's headers should show SPF and DKIM passing.

## 7. Watch the first days

- Daily:
  - `email_logs_list({ status: 'bounced' })`;
  - `email_usage` for the bounce and complaint rates;
  - `email_service_status` for `sending_held` and `volume_check`.
- **Webhooks.** If the app handled the old provider's events, `email_webhook_create({ name, url, events })`
  replaces them. The signing secret is shown once.
  - Events carry the Standard Webhooks headers (also sent as `svix-*`), so a svix-based Resend handler
    verifies with the new secret. Check the payload fields the handler reads.
  - `email_webhook_deliveries_list({ id })` shows what was delivered and why anything failed.

## 8. Remove the old provider (after a clean week)

1. Delete the old variables (`project_secrets_delete`, which asks) and the old client from the code. The
   Resend lane keeps the `resend` package: it is how the app sends to Hiveku.
2. At the DNS host, remove the old provider's DKIM records, its SPF include and its bounce subdomain records
   (Resend's `send.<domain>`). Keep Hiveku's.
3. The person closes the old account.

**Going back before step 8:** put the old variables back and redeploy. The old provider's DNS records are
still there, so its mail authenticates again at once.

## What never to do

- Read or print an old key's value, or put an Email Service key anywhere but `email_project_connect`.
- Publish a second SPF record, or remove the old DKIM before the new path is proven.
- Import addresses as bounces or complaints that never bounced: they stay suppressed for good.
- Send a test to real customers. The preview simulates, and real tests go to the person's own inbox.
