# The Shared Inbox: Reading, Replying, and Repairing Connections

The manual behind Plays 1 through 4 of the communications skill. Load it before you read a
mailbox, before you send a reply on a customer's behalf, and before you debug a connection.

The shape of this surface, stated up front: **reading is rung 1; replying is rung 1 for an
interactive 1:1 reply to a CRM contact (`crm_contact_email_send`, a `crm_` tool) and rung 2 for
anything automated (the `gmailReply` node).** Every reader is a direct MCP tool. The older claim
that no MCP tool sends from a connected mailbox is retired - it went stale when
`crm_contact_email_send` shipped; the node remains the supported path for triggered or scheduled
replies, and the only path on a key that cannot see `crm_`.

Profile note: the `crm_*` lane in this document (`crm_inbox_*`, `crm_thread_for_contact`,
`crm_email_thread_search`, `crm_lead_triage`, `crm_list_email_connections`) is invisible to a
communications-scoped key and resolves only under a broader profile such as `full`. The
`gmail_*` family and every `email_*` tool here ARE in the communications profile. If a reader
below fails to resolve, that is the reason - say "not visible to this key", not "does not
exist".

## Part 1: The mailbox connection

Everything here runs against rows in `email_connections`. One account can hold several: one per
Hiveku user who connected a mailbox, Gmail and Outlook side by side.

**Three tools read that table and they are not interchangeable.**

| Tool | Returns | Use it for |
|---|---|---|
| `crm_inbox_connections` | id, email, platform, `is_active` | Quick "which mailboxes exist" |
| `crm_list_email_connections` | id, user_id, email_address, display_name, platform, `is_active` | Picking a connection to attribute a send to, including which USER owns it |
| `email_connections_list` | the above plus `connection_status`, `last_error`, `last_synced_at`, `scopes`, `is_default` | Diagnosing a broken connection |

`email_connections_list` describes itself as listing email-marketing platforms such as SES,
Resend and SendGrid. That description is misleading. The route reads `email_connections` and
returns the account's Gmail and Outlook mailboxes, exactly like the other two. Trust the
behaviour.

The practical consequence: **a dead connection still shows `is_active: true`.** `is_active` is
the row's enabled flag, not its health. A mailbox whose OAuth grant was revoked, whose refresh
token expired, or whose scopes were narrowed keeps `is_active: true` while
`connection_status` reads `error` and `last_error` carries the reason. If you diagnose with
`crm_inbox_connections` you will report a healthy connection that cannot read a single message.

### Default-mailbox resolution

**Which readers let you name a mailbox is NOT uniform, and this is the part people get wrong.**

| Reader | Mailbox selector |
|---|---|
| `crm_inbox_list`, `crm_inbox_recent`, `crm_lead_triage` | optional `connection_id` |
| the `gmail_*` family | optional `email`, an address rather than an id |
| `crm_thread_for_contact`, `crm_email_thread_search` | **none at all** |

`crm_thread_for_contact` takes `{ contact_id, limit }` and nothing else, and the Olympus route
forwards only the account id and the limit to the sales-agent. A `connection_id` passed to it is
silently DROPPED, not rejected. `crm_email_thread_search` takes `{ q, contact_id, limit }`; it
reads CRM rows rather than a mailbox, so the question does not arise there.

Where a selector exists and you omit it, the two lanes resolve the default differently:

- The `crm_inbox_*` lane takes explicit `connection_id`, then the calling user's own default, then
  the account default, and reads whatever it lands on **silently**. `crm_thread_for_contact`, with
  no selector to pass, falls through to the CONTACT OWNER's mailbox before the account default,
  which is usually the mailbox you wanted and is worth knowing when it is not.
- The `gmail_*` lane prefers the `is_default: true` row, uses the single row when only one is
  active, and otherwise REFUSES with a 400: `Multiple Gmail connections exist but none is marked
  default. Pass ?email=<address> to select one.` A loud error is the good case.

So the silent wrong-mailbox read lives on the `crm_inbox_*` lane, and on the `gmail_*` lane it can
only happen when some row IS flagged default and it is not the one you meant. On a single-mailbox
account neither matters. **Whenever `crm_inbox_connections` returns more than one row, resolve the
connection explicitly before reading**, and when the reader has no selector, say which mailbox the
answer came from rather than implying it covers the account. If the user has not said whose
mailbox, ask; do not guess from the account name.

## Part 2: Reading

### The name inversion

This trips up nearly everyone, so learn it as a pair:

- **`crm_inbox_list`** is the plain recent-N sweep. No search. Arguments: `folder` (`'inbox'`,
  `'sent'`, `'all'`), `limit` (default 25, max 50), `connection_id`. Nothing is required.
- **`crm_inbox_recent`** is the SEARCH tool and `query` is REQUIRED, despite the name promising
  recency. Same `folder`, `limit` and `connection_id` arguments.

The names read backwards from their behaviour. `crm_inbox_recent` called bare is a validation
failure, not a sweep of recent mail.

### Query syntax

`crm_inbox_recent` takes the provider's NATIVE syntax and passes it through, which means Gmail
query syntax on a Gmail connection and Outlook `$filter` semantics on an Outlook one. The tool's
own examples are Gmail-shaped:

```
from:logan@example.com newer_than:14d
subject:"intro call"
to:me has:attachment
```

Useful Gmail operators in practice: `from:`, `to:`, `cc:`, `subject:`, `has:attachment`,
`is:unread`, `in:inbox`, `in:sent`, `newer_than:7d`, `older_than:30d`, `label:`, and `-` to
negate any of them. Terms combine with implicit AND; `OR` must be uppercase.

A query written for Gmail will not behave the same way against an Outlook connection. When the
account has both, either scope to one `connection_id` or keep the query to bare keywords.

### Reading around a contact

- **`crm_thread_for_contact({ contact_id, limit? })`** fetches the full live Gmail or Outlook
  thread for one CRM contact, across every email address on file for them. This is the correct
  answer to "what have we said to this person", because it follows the contact rather than a
  single address. Those two arguments are the whole schema: there is no `connection_id`, and the
  mailbox it reads is the contact owner's, falling back to the account default. Its message and
  thread ids are what `crm_contact_email_send` takes as `reply_to_message_id` and `thread_id` to
  keep an interactive reply in the thread (Part 4).
- **`crm_email_thread_search({ q, contact_id?, limit? })`** searches CRM-STORED email activities
  by subject or body substring. `limit` defaults to 20 and caps at 100.

**The distinction between those two is load-bearing.** `crm_thread_for_contact` hits the live
mailbox. `crm_email_thread_search` reads the synced copy in the CRM. A message that was never
synced into CRM activities is invisible to the search and present in the live read. When a user
insists an email exists and the search says otherwise, read live before concluding anything.

`crm_email_thread_search` is also distinct from `crm_ghl_contacts_search` and
`crm_hubspot_contacts_search`, which query an external CRM live.

### Lead intake in one call

`crm_lead_triage({ query, limit?, offset?, compact?, connection_id? })` does an inbox sweep,
prospect parse, CRM dedupe and last-outbound lookup in a single call. `query` is required and
selects the lead-intake messages. `limit` defaults to 25 and caps at 50. `compact` defaults to
true and omits raw bodies, which is usually what you want.

It is provider-agnostic: Typeform, JotForm, Webflow, Instantly, Lemlist, Smartlead and Calendly
notification emails all work through the same query. Saved query patterns for an account live in
memory under `domain='lead_intake_query'`, so check there before inventing one.

## Part 3: The `gmail_*` family

Eight tools, Gmail-only, direct against the connected mailbox. Every one takes an optional
`email` argument naming the mailbox and falls back to the account default. The quick
reference:

| Tool | What it does |
|---|---|
| `gmail_search_messages({ q, max_results?, page_token? })` | Gmail query syntax search. Returns ID stubs only, so pair it with the next one |
| `gmail_get_message({ message_id })` | One message parsed: from, to, cc, subject, body, bodyHtml, date, labels, snippet |
| `gmail_get_thread({ thread_id })` | A complete thread with every message parsed |
| `gmail_conversation_history({ contact_email, days?, max? })` | Recent history with one address, each touchpoint tagged inbound or outbound. Built as a duplicate-guard before sending |
| `gmail_inbox_lead_replies({ newer_than?, unseen?, exclude?, auto_label? })` | Inbound prospect replies, pre-filtered |
| `gmail_parse_forward({ message_id })` | Splits a forwarded email into alias info, prospect info, the reply text, and the original cold email |
| `gmail_list_labels()` | Every label, system and user |
| `gmail_modify_labels({ message_id, add?, remove?, create_missing? })` | Add or remove labels. Accepts label IDs or human names |

The rest of this section is the longer version: what each one returns, and where each one
bites.

### The read path

`gmail_search_messages({ q, max_results?, page_token? })` takes Gmail query syntax,
`max_results` defaults to 50 and caps at 100, and `page_token` continues from a prior
`nextPageToken`. **It returns message ID stubs, not content.** That is deliberate and it is the
main thing to plan around: a search returning 50 stubs needs 50 `gmail_get_message` calls to
become readable. Narrow the query rather than fanning out the fetch.

`gmail_get_message({ message_id })` returns one message parsed into from, to, cc, subject, body,
bodyHtml, date, labels and snippet.

`gmail_get_thread({ thread_id })` returns a complete thread with every message parsed. Prefer it
over N message fetches when you have the thread id, which is also what you need for a reply.

`gmail_conversation_history({ contact_email, days?, max? })` returns recent history with one
address, each touchpoint carrying direction (inbound or outbound from the mailbox owner's
perspective), subject and snippet. `days` defaults to 14 and caps at 365; `max` defaults to 50
and caps at 100. It exists as a **duplicate-guard before sending**: call it before any outreach
so you do not send a second first-touch to someone already mid-conversation. Note that
`contact_email` is the OTHER party and `email` is the mailbox to query; passing the same value to
both returns nothing useful.

`gmail_parse_forward({ message_id })` splits a forwarded email into alias info, prospect info,
the prospect's reply text, and the original cold email if present. It splits on Gmail's
`---------- Forwarded message ---------` delimiter, so it only works on Gmail-style forwards.

### The label path

`gmail_list_labels()` returns every label, system and user.

`gmail_modify_labels({ message_id, add?, remove?, create_missing? })` accepts label IDs
(`INBOX`, `Label_42`) OR human names (`ares/pending-review`) in both `add` and `remove`.
`create_missing` defaults to false; set it true to auto-create a name that does not exist yet.
This writes to a real mailbox that a human uses, so treat it as a mutation and confirm.

### `gmail_inbox_lead_replies`, and its two traps

`gmail_inbox_lead_replies({ newer_than?, unseen?, exclude?, auto_label?, email? })` returns
inbound prospect replies with team and noise pre-filtered. `newer_than` uses Gmail relative-time
syntax and defaults to `"1d"`. `unseen` defaults to true. `exclude` takes comma-separated extra
senders or domains.

**Trap one: it writes by default.** `auto_label` defaults to TRUE, so every call applies the
`ares/pending-review` label to every message it returns, creating that label on the mailbox if it
does not exist. A tool that sounds like a query mutates a human's mailbox. Pass
`auto_label: false` unless labelling is genuinely what you want, and tell the user when you do
let it label.

**Trap two: the team filter is real but fragile.** Two exclusion sources are combined:

1. A fixed noise list: `noreply`, `no-reply`, `mailer-daemon`, `calendly.com`, `dmarc-noreply`,
   `postmaster`.
2. The account's OWN team, resolved live from `account_memberships`.

**Do not repeat the claim that this hard-codes Hiveku staff names.** It used to. Three literal
Hiveku addresses sat in that list, which was wrong in both directions on every non-Hiveku
account: the client's own team was NOT excluded so internal chatter polluted the lead list, while
genuine mail from anyone at hiveku.com was silently dropped. That was fixed. The internal-team
filter is now derived per account, which is what "internal" always should have meant on a
multi-tenant surface.

What IS still worth knowing, because it produces the same symptom without any error:

- The membership resolver is **best-effort by design**. If the lookup throws it logs a warning
  and returns an empty list, so the call degrades to noise-only filtering. A slightly noisy lead
  list is recoverable and an erroring one is not, so it fails open. The visible effect is the
  account's own internal email appearing among "prospect replies".
- Team addresses are validated against a token pattern before they are used, and that pattern
  does not allow `+`. A team member whose address carries a plus tag is silently dropped from
  the exclusions and their mail shows up as a lead reply.
- Membership is read from `account_memberships`, not from a user's home account field, so a user
  who belongs to the account through a membership row is correctly covered.

Also note it caps at 50 messages per call and fetches and parses them in batches of ten to stay
within Gmail's rate limits, so a wide `newer_than` window is slow rather than truncated.

## Part 4: Replying (rung 1 interactive, rung 2 automation)

### The interactive path: `crm_contact_email_send`

**One MCP tool sends mail from a connected mailbox: `crm_contact_email_send({ contact_id,
subject, body, reply_to_message_id?, thread_id?, cc?, bcc?, connection_id?, log_activity? })`.**
It sends a REAL email from the account's connected Gmail or Outlook mailbox; the recipient is
always the contact's address on file (cc/bcc add alongside it - there is no arbitrary `to`).
Threading: pass `reply_to_message_id` and `thread_id` taken from `crm_thread_for_contact` and the
reply lands in the customer's thread; omit them and it is a new message. It self-logs to the
contact's timeline unless `log_activity: false` - writing `crm_create_activity` for the same send
double-logs it. With no `connection_id` it uses the account's default SENDABLE mailbox; a
read-only-scope or calendar connection 400s cleanly with the reason (a connection problem -
`crm_list_email_connections` / `email_connect_start` - never a retry case). It has **no draft
state, no recall, and no idempotency key**: two identical calls are two emails. The approval gate
binds to the exact subject and body shown; on an ambiguous timeout read
`crm_contact_emails_list({ contact_id })` back before ANY retry. It is a `crm_` tool - invisible to
a communications-scoped key, where the node below is the path.

Two other MCP tools put mail on the wire and neither is a substitute:
**`email_send_test({ to, subject?, body?, html_body?, from?, dry_run? })`** performs a REAL send of
an arbitrary subject and body to up to 10 recipients, and **`dry_run` defaults to FALSE.** It is a
different lane, the account's transactional and marketing sender covered in Part 5, not an
`email_connections` mailbox. That means it does not thread, does not appear in the customer's Sent
folder, and comes from a verified domain rather than a person. It exists to verify sending config,
so pass `dry_run: true` unless a live send is the point, and never reach for it when a human is
expecting a reply in a thread. The second is `outbound_reply_draft_send` - the cold-email
program's confirm-gated reply sender, which answers a cold-campaign thread through that program's
provider, not a mailbox thread; it belongs to the outbound skill.

### The automation path

When a trigger, schedule or workflow sends the reply - or when your key cannot see
`crm_contact_email_send` - replying is a workflow node.

### The `gmailReply` node

Despite the name it dispatches through a unified email-providers module and works against any
`email_connections` row, Gmail or Outlook. The node was originally Gmail-only and the name was
kept for backwards compatibility.

**The node catalog lies about this node's fields, and this is the highest-value fact in the
reference.** `workflow_node_types_list` serves an authored schema for `gmailReply` whose
node-specific fields are exactly two, `thread_id` and `body`. (A third, `on_error`, appears on
every non-trigger node because the catalog builder appends it universally; it is not a `gmailReply`
field.) The handler reads a different and larger set:

| Handler key | Required | In the catalog? | Failure if wrong |
|---|---|---|---|
| `connectionId` | yes | **no** | `No email connection selected. Pick an account in the node config.` |
| `to` | yes | **no** | `Email send: missing "to" address` |
| `subject` | yes | **no** | `Email send: missing "subject"` |
| `body` | yes | yes | Sends empty |
| `threadId` | for threading | **advertised as `thread_id`** | Sends as a NEW email, silently unthreaded |
| `cc`, `bcc` | no | no | - |
| `replyToMessageId` | no | no | - |

Read that table before you build. A node authored faithfully from the catalog fails three times
in sequence and then, once you have added the three missing keys, still sends an unthreaded
message because `thread_id` is never read.

The `to` and `subject` requirements are enforced on the reply path, not just the send path. That
is counter-intuitive for a reply, where both are notionally implied by the thread. They are not.
Pull them from whichever reader gave you the thread.

`connectionId` is missing from the `gmailSend` catalog entry too, so every email action node has
that problem. Get the value from `crm_list_email_connections`, which also tells you which Hiveku
user owns each mailbox, or from `crm_inbox_connections` when you only need the id.

On success the node outputs `{ action, platform, messageId, threadId, to, subject, sentAt }`, so
downstream nodes can chain off `threadId`.

One more mechanism worth knowing: the handler pulls the account id from `_accountId` on the
execution context, not from a bare `accountId`. That is why this node used to fail with
"Missing account context" on most runs. It is fixed, but if you ever see that error it points at
the context, not your config.

### Carrying the thread id from reader to node

The pattern is the same whichever reader you used (and the same two identifiers feed
`crm_contact_email_send` as `reply_to_message_id` / `thread_id` on the interactive path):

1. Read: `crm_inbox_recent({ query })`, `crm_thread_for_contact({ contact_id })`,
   `gmail_search_messages({ q })` then `gmail_get_thread({ thread_id })`, or
   `emailNewMessageTrigger` firing inside the workflow itself.
2. Take the thread identifier and the participant address out of that result.
3. Feed them to `gmailReply` as `threadId` and `to`, with `connectionId` naming the mailbox the
   reply should appear to come from.

When the trigger is `emailNewMessageTrigger`, template off the trigger output rather than
hard-coding. Call `workflow_event_trigger_types_list` to get `output_shape_keys` for the trigger
so you template real key names instead of guessing.

### The other email nodes

- `gmailSend` composes a new message. Fields `to`, `subject`, `body`, `cc`, `bcc` are advertised
  correctly; `connectionId` is not advertised and is required.
- `gmailSearch` searches a connected inbox from inside a workflow. `query` is required and is read
  under that exact key. **`max_results` has the same catalog-versus-handler bug as `thread_id`
  above:** the catalog advertises `max_results`, the handler reads `maxResults`, and node data keys
  are not case-normalized (only node TYPE strings carry camel and snake aliases). A node authored
  faithfully from the catalog has its value ignored, and the clamp of 1 to 100 always operates on
  the default of 25. Author it as `maxResults`. `connectionId` is required here too and is not
  advertised, because the handler resolves the connection before it branches on the action.
- `gmail` is a generic action node that sends or labels.
- `crmSendContactEmail` sends to a CRM contact through the user's Gmail or Outlook and auto-logs
  a timeline activity. It is the automation twin of `crm_contact_email_send` - same lane, same
  self-logging - for when the send belongs inside a workflow.
- `crmSyncContactEmails` pulls fresh mail for a contact and upserts activities;
  `crmGetContactEmails` reads the synced history.

There are TWO Gmail node families and the overlap is confusing. The read-path family is
`gmailSearchMessages`, `gmailGetMessage`, `gmailGetThread`, `gmailGetConversation` and
`gmailLabelMessage`, mirroring the `gmail_*` MCP tools. The action family is `gmailSend`,
`gmailReply` and `gmailSearch`. Prefer the action family for sending and the read family when a
workflow needs to inspect mail.

Similarly there are three new-mail triggers: `emailNewMessageTrigger` (either platform, with
sender, subject and label filters), `gmailNewEmailTrigger` and `outlookNewEmailTrigger`. Pick ONE,
for clarity rather than for safety. **Wiring several into one workflow does NOT double-fire it.**
The executor selects workflows with a single query whose OR spans all six trigger-type strings, so
a workflow matching several branches comes back once; it then walks that workflow's trigger nodes,
stops at the first node that matches, and enqueues exactly one run per workflow per event.
Platform-specific nodes are skipped outright when the event's platform is not theirs. The redundant
node is dead weight and a maintenance trap, not a duplicate send.

What that also means: a second copy of the same email arriving is not a trigger-wiring problem.
Look at the delivery mechanisms instead, since the Gmail webhook, the Outlook webhook and the
`sync-crm-inboxes` cron all feed the same executor.

### Always dry run

`workflow_run({ id, test_mode: true })` short-circuits the send and returns
`would_have: { to, subject, body, ... }`. `workflow_run_get({ workflow_id, run_id })` shows
`step_states` per node with input, output and error. Read the recipient in `would_have` before
any live run. An email sent to the wrong customer cannot be recalled, and on this surface the
cost of a dry run is nothing.

## Part 5: Repairing a connection

The trigger phrase is **"No active Gmail connection found."** Any `crm_calendar_*`,
`crm_inbox_*` or `crm_lead_triage` tool can emit it.

### The ladder

1. **Diagnose with `email_connections_list`**, the only reader carrying `connection_status` and
   `last_error`. Distinguish three cases: no row at all (never connected), a row with
   `connection_status: 'error'` (grant revoked or token dead, needs reconnect), or a healthy row
   the caller simply did not select (a `connection_id` problem, not a connection problem).

2. **Start the reconnect** with `email_connect_start`:

   | Argument | Notes |
   |---|---|
   | `platform` | `'gmail'` or `'outlook'`. Defaults to gmail |
   | `scope_label` | `readonly` (read only, no calendar), `send` (send only), `modify` (read/send/modify, no calendar), `modify_with_calendar` (default: Gmail plus Google Calendar plus Meet read-only) |
   | `user_email` / `user_id` | Which Hiveku user OWNS the connection. Optional on a solo account, REQUIRED on a multi-user one |
   | `oauth_app_id` | Pins a specific OAuth Client. Defaults to the account's first Google app with the right product |

   Pick the narrowest scope that does the job. `modify_with_calendar` is the default and is right
   when calendar tools are also in play; if the user only wants replies read, `readonly` is a
   smaller ask on the consent screen and a smaller blast radius.

3. **Hand the `setup_url` to the user. Do not open it yourself.** They must be in their own
   browser session to grant Google consent. **It expires after five minutes.** Send it as the
   last thing in a short message, when they are ready to click, not buried in a plan.

4. **The `no_oauth_app` branch.** A response carrying `code: 'no_oauth_app'` means the account has
   no Google OAuth Client registered with `product='crm_email_calendar'`. This is a precondition,
   not a transient failure, and retrying produces the identical error forever. It is a rung 3
   handoff with a specific owner and a specific page: **the account OWNER must register an OAuth
   app at `/dashboard/settings/oauth-apps`**, after which `email_connect_start` works. Say exactly
   that, then stop. Do not loop, and do not offer to do it for them.

5. **Verify** by polling `email_connections_list` for `connection_status: 'connected'`. Once it
   lands the inbox and calendar tools return real data. Confirm with a cheap read such as
   `crm_inbox_list({ limit: 1 })` rather than declaring success on the status alone.

### Mailbox health is not sending health

A connected mailbox says nothing about whether the account can send marketing or transactional
mail, which runs on a different lane entirely.

- **`email_service_status`** is the account's email-service health. **Read `sending_enabled`
  FIRST.** When it is false a `suspension` block carries the reason and timestamp and ALL sending
  is blocked, regardless of the healthy-looking reputation numbers printed below it: SMTP 450s at
  DATA and the send API refuses. Domain reputation reflects history, not current sendability, so
  reading it first is how people conclude a suspended account is fine. **Suspensions are lifted by
  Hiveku staff, not by any tool**, so on a suspension the correct output is an escalation, not a
  workaround.
- **`email_deliverability_check({ wait_seconds? })`** runs the whole ladder server-side:
  suspension state, active API key, verified domain, a real send through the account's production
  lane, then waits for the SES delivery event, because queued is not delivered. `wait_seconds` is
  5 to 45 and defaults to 30. It is rate-limited to 3 checks per 10 minutes. Use it FIRST when
  signups or notifications stop sending, before any SMTP probing.
  **The recipient is always the AWS mailbox simulator (`success@simulator.amazonses.com`).
  NEVER invent your own test address.** Test sends to example.com addresses caused a real account
  suspension. A verdict of `sent_but_no_delivery_event` means the send path works and the event
  webhook pipeline is broken, which is a different fix.

## Part 6: Diagnosis quick reference

| Symptom | First check | Usual cause |
|---|---|---|
| "No active Gmail connection found" | `email_connections_list` | No row, or `connection_status: 'error'` |
| Reads return nothing but the mailbox has mail | `crm_inbox_connections` count | Reading the default mailbox on a multi-inbox account. `crm_thread_for_contact` has no `connection_id` at all |
| "Multiple Gmail connections exist but none is marked default" | A `gmail_*` call with no `email` | Ambiguous account. Pass the address; this lane refuses rather than guessing |
| `gmailSearch` ignores the result cap | The node's `maxResults` key | Catalog says `max_results`; handler reads `maxResults`, so it silently uses 25 |
| `crm_inbox_recent` errors | Did you pass `query`? | It is the search tool; `query` is required |
| A known email is missing from search | Live vs synced | `crm_email_thread_search` reads CRM copies; use `crm_thread_for_contact` for live |
| Reply "sent" but not threaded | The node's `threadId` key | Catalog says `thread_id`; handler reads `threadId` |
| Reply node fails immediately | `connectionId`, `to`, `subject` | All required, none advertised by the catalog |
| `crm_contact_email_send` not in the catalog | Your key's profile | It is a `crm_` tool; a communications-scoped key builds the `gmailReply` node instead |
| `crm_contact_email_send` returns 400 | `crm_list_email_connections` | The default sendable mailbox is a read-only-scope or calendar row - reconnect with a sending scope, do not retry |
| Internal team mail appearing as lead replies | The membership resolver | It failed open to noise-only, or a `+` address was dropped |
| Labels appearing on a customer's mailbox | `auto_label` | Defaults TRUE on `gmail_inbox_lead_replies` |
| Reconnect link does not work | Elapsed time | The `setup_url` is valid for five minutes |
| `no_oauth_app` on every attempt | Not transient | Owner must register an OAuth app in the dashboard |
| Mailbox fine, nothing sends | `email_service_status` | `sending_enabled: false` with a suspension block |
