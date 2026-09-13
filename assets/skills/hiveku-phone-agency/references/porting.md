# Reference: Number porting (moving numbers IN from another carrier)

This file covers bringing a client's existing phone numbers into Hiveku from a losing carrier -
CallRail, Twilio, GoHighLevel, or anyone else. Load it when a client says "port our numbers from
CallRail", "we can't lose these numbers - they're on trucks and business cards", "how long until
the numbers move?", "the port says exception", or "the port is stuck".

The stakes, first:

- **Filing, confirming, and cancelling a port are LEGAL ACTS against a losing carrier under a
  signed Letter of Authorization.** Confirm is the point of no casual return: it sends the request
  to the losing carrier. Every write here is one confirmed step at a time.
- **A lost port is a lost business number** - the numbers being ported are the ones printed on
  vehicles, signage, and ads. The single instruction that saves clients:
  **KEEP SERVICE ACTIVE at the losing carrier until the port COMPLETES.** Cancelling the old
  account mid-port kills the port and can kill the number. Say it in every client-facing message
  about an in-flight port.
- **Port-order responses are customer PII and legal paperwork.** Never paste them into chat,
  tickets, tasks, or documents.
- **Drafts are free; the carrier acts on confirm.** A portability check is free. Creating an
  order files carrier drafts. Confirm is what commits.
- This platform handles port-IN only. **Port-OUTs (numbers leaving Hiveku) are unhandled** - a
  losing-carrier port-out request has no tooling and no notifications here; escalate to a human.

## Availability

Every tool below resolves on this server today. A name that does not resolve on your key is a
profile question first: check the key's profile, then the hiveku-communications reachability
ladder, then hand off with a precise dashboard step filed via `pm_tasks_create`. Never tell the
user the capability does not exist, and never invent a name.

| Tool | Status |
|---|---|
| `voice_port_orders_list` | LIVE |
| `voice_port_order_get` | LIVE |
| `voice_port_order_requirements` | LIVE |
| `voice_portability_check` | LIVE |
| `voice_port_order_create` | LIVE |
| `voice_port_order_update` | LIVE |
| `voice_port_order_action` | LIVE |
| `voice_port_order_refresh_status` | LIVE |
| `voice_port_order_share_link_create` | LIVE |
| `voice_port_order_share_links_list` | LIVE |
| `voice_port_order_share_link_revoke` | LIVE |
| `voice_port_order_comments_list` | LIVE |
| `voice_port_order_comment_add` | LIVE |
| `voice_port_order_verification_codes_send` | LIVE |
| `voice_port_order_verification_codes_verify` | LIVE |

---

## 1. The mental model

A port order is a `voice_port_orders` row mirroring a carrier-side order. The row carries the LOA
data (billing name, billing address, authorized signer, the losing carrier's account number and
PIN - both encrypted at rest and masked on every read), the number list, the dates, and three
DIFFERENT status fields that answer three different questions:

- **`status`** - the LOCAL canonical vocabulary: `draft -> submitted -> pending_carrier ->
  (approved / exception) -> foc -> ported`, with `cancelled` and `rejected` terminal. It is
  **RANKED and never regresses**: draft(0) < submitted(1) < pending_carrier = approved =
  exception(2) < foc(3) < terminal(4). A backward write is refused; `exception` is enterable from
  any non-terminal state. An unknown carrier token deliberately does NOT move it (only
  `status_raw` updates), so an order that looks stuck may have advanced at the carrier under a
  token this platform does not know.
- **`status_raw`** - the carrier's verbatim token. This answers "what does the carrier think".
  The vocabularies COLLIDE on the word `submitted`: the local `submitted` means filed with OUR
  carrier and awaiting confirm, while the carrier's raw `submitted` means it reached the LOSING
  carrier and maps to local `pending_carrier`. The local vocabulary deliberately runs one step
  AHEAD of the carrier's echo. And `cancel-pending` collapses into local `cancelled`, so an
  in-flight cancellation reads as finished unless you check `status_raw`.
- **`action_status`** - `draft_only | details_set | submitted | activating | cancelled`. This is
  **the honest answer to "was this actually confirmed"**: a row can sit at local
  `status: 'submitted'` while the carrier order is still a raw, unconfirmed draft
  (`action_status: 'draft_only'` or `'details_set'`). Read it before believing any status.

The rest of the model:

- **Splits.** One submission can become several carrier orders (auto-split by country/type/SPID).
  Siblings are separate rows sharing a `batch_key` (the originating row's `support_key`, a
  `PORT-XXXXXX` human reference). Each sibling mints its OWN `PORT-` key; the batch key groups
  them. Never report "the port" from one sibling.
- **FOC date** - the Firm Order Commitment: the datetime the losing carrier committed to release
  the numbers. `requested_foc_datetime` is a request; the carrier's granted FOC is the one that
  counts.
- **`exception`** means the losing carrier flagged a FIXABLE problem. The carrier's codes land
  verbatim in `exception_details_json` (`ACCOUNT_NUMBER_MISMATCH`, `LOA_ILLEGIBLE` and similar);
  the platform's notification email translates each code into a what/fix pair for the client.
  Exceptions are the normal texture of porting, not a crisis - read, fix, re-confirm.
- **Adoption** - after the port completes, each number must become a usable Hiveku DID.
  `adoption_state_json` is the per-number ledger (`adopted_at`, `provider_number_id`,
  `route_created`, `messaging_attached`); the row's `adopted_at` is set only once EVERY number is
  adopted. `status: 'ported'` with `adopted_at: null` means the transfer finished at the carrier
  while the numbers are not yet usable on the platform. Ported numbers land INACTIVE with a
  parked (unrouted) inbound route - E911 is the activation gate, exactly as for purchased local
  numbers (section 7).

### The vocabulary at a glance

| Local `status` | Rank | What it actually means | What it does NOT mean |
|---|---|---|---|
| `draft` | 0 | Local row exists; carrier may hold an unconfirmed draft | Nothing filed with the losing carrier |
| `submitted` | 1 | Filed with OUR carrier, awaiting confirm | NOT "sent to the losing carrier" - that is the carrier's raw `submitted`, which maps to `pending_carrier` here |
| `pending_carrier` | 2 | The request sits with the LOSING carrier | Not approved yet |
| `approved` | 2 | The losing carrier accepted | No FOC date yet |
| `exception` | 2 | The losing carrier flagged a fixable problem | Not a rejection - fix and re-confirm |
| `foc` | 3 | A Firm Order Commitment date exists | Not completed - numbers still with the loser until that date |
| `ported` | 4 (terminal) | The transfer completed at the carrier | NOT "the numbers work" - check `adopted_at` |
| `cancelled` / `rejected` | 4 (terminal) | Finished, no transfer | `cancelled` can mask a carrier-side `cancel-pending` still in flight - check `status_raw` |

A lower-ranked write is refused, so the local status can only walk forward - which is also why a
stale-looking order needs `status_raw`, not a re-read of `status`.

### Timeline expectations (what to tell the client)

Porting is a multi-day REGULATED process, not a setting: an LOA, a losing-carrier review, and a
firm order commitment date. FastPort-eligible numbers (the `fast_portable` verdict from
`voice_portability_check`) can move in days; anything else is typically weeks, and every
exception round-trip adds days. Never promise a date before the carrier grants FOC; after FOC,
that date is the answer. The honest client-facing summary is always three parts: where each
order sits (per sibling), what is blocking it (exception codes, unmet requirements, an unsigned
LOA), and whose move is next.

## 2. Reading orders: the three LIVE tools

**`voice_port_orders_list`** - the account's orders, newest first, HARD-CAPPED at 100 rows with
no pagination, no cursor, and no filter; the cut is silent. **The response is customer PII**:
exactly two fields are masked (`losing_pin` as bullets; `losing_account_number` as bullets plus
its REAL last four digits, disclosed on purpose), and everything else - the billing street
address, the billing telephone number, the authorized signer, the full number list, document keys
- comes back verbatim. Do not paste rows anywhere.

**`voice_port_order_get`** - one order by id, same masked shape, and the only way past the
100-row window (you need the id; `support_key` is a field on the row, not a lookup key). **This
is the LOCAL MIRROR, not the carrier**: it performs no refresh, so a freshly changed order can
read stale - `voice_port_order_refresh_status` is the live pull. `last_notified_status` and
`last_notified_comment_at` are notification watermarks, not port state; reading them as status
reports the wrong thing.

**`voice_port_order_requirements`** - asks the carrier what the order still needs (an LOA, a
recent bill, a verification code) BEFORE a confirm bounces back as an exception days later. Its
trap is the empty list: an order that never reached the carrier (`telnyx_order_id` null - every
pure draft) short-circuits to `requirements: []` without calling out, so **an empty array means
"nothing was ever asked" exactly as often as "nothing is outstanding"**. Confirm the order has a
`telnyx_order_id` via `voice_port_order_get` first. And `met: true` only means a value was
SUBMITTED, not accepted - an illegible LOA reads `met: true` here and surfaces as an exception
later. This is a live carrier call: real latency, real `carrier_error` failure mode.

## 3. Preflight: `voice_portability_check`

FREE, and read-only on the carrier side - preflight EVERYTHING before a client invests in the
full form. Takes 1-100 numbers per call and returns one verdict each: `portable`,
`fast_portable`, `messaging_capable`, `not_portable_reason`. Any requested number the carrier
does not echo back gets an explicit unknown verdict ("double-check the digits") rather than
being silently dropped - treat those as data-entry errors to resolve, not as unportable.

A number that is not portable, or a batch mixing portable and unportable numbers, is a
conversation with the client BEFORE any order exists. `messaging_capable: false` on a number the
client texts from is its own conversation.

## 4. Filing: `voice_port_order_create`

One call does two things: writes the LOCAL draft row (so the data survives any failure), then
files the CARRIER draft(s). Body: the losing carrier's name, account number, and PIN; the billing
name, billing phone number, and billing address; the authorized signer; the numbers (up to 500 -
the carrier may auto-split them into sibling orders sharing `batch_key`); optionally a requested
FOC datetime, `enable_messaging`, and `customer_type` (`business | person` - inferred from the
billing name when absent).

**`billing_phone_number` (the BTN) matters more than it looks**: a BTN mismatch against the
losing carrier's records is one of the most common port rejection causes. So is an account-number
mismatch. The client's bill is the source of truth for both - which is what the share link
(section 6) exists to collect.

**A 502 `submit_failed` is NOT a no-op. Read it, never blindly re-create.** The local row
already exists (the response carries `port_order_id` and the row). Two sub-cases, distinguished
by the returned row's status:

- `status: 'submitted'` - a carrier draft WAS created but its details did not fully land (the
  orphaned carrier id was recovered). The fix is `voice_port_order_update` to correct the
  details, then `voice_port_order_action` with `confirm` - on THIS order. A re-create would file
  a DUPLICATE carrier order for the same numbers.
- `status: 'draft'` - no carrier order exists; the row holds the LOA data with the failure reason
  in `rejection_reason`. Fix the data and retry from the existing row (the dashboard's detail
  page), not by minting a second order.

A clean success returns the primary row plus `sibling_orders` (splits), possibly with
`warning: 'persist_partial'` - the carrier orders exist even when a local sibling write failed,
and ops reconciles from the audit log. At this point `status` is `submitted` locally while the
carrier still holds a draft: **nothing has been sent to the losing carrier yet.**

## 5. Acting: `voice_port_order_action` (confirm | cancel | activate)

The action rides the URL, one of exactly three:

- **`confirm` - the legal act.** Under the signed LOA, it sends the port request to the losing
  carrier. Requirements first (`voice_port_order_requirements`, with its empty-list trap), LOA
  signed, bill uploaded, then confirm - an unmet requirement round-trips as an exception days
  later. After confirm the local status floors at `pending_carrier` even while the carrier's
  echo lags behind. Never confirm on your own judgment; a human says go.
- **`cancel`** - withdraws the order. `cancel-pending` at the carrier collapses to local
  `cancelled`, so check `status_raw` if "cancelled" needs to be provably final.
- **`activate`** - requests activation. It deliberately does NOT write `status: 'ported'`:
  activation is a request, not evidence of completion. Only `action_status` moves (to
  `activating`); the status flips when the carrier actually finishes, which is also what
  triggers the PORTED notification and number adoption.

A draft with no carrier order answers `409 not_submitted` for every action. An unknown action is
`422 invalid_action`.

## 6. The client handoff: share links

The losing-carrier account number, PIN, bill, and LOA signature belong to the CLIENT.
**Never collect an account number or PIN over chat, email, or a ticket** - mint a share link and
let the client enter their own credentials on the secure page.

- **`voice_port_order_share_link_create`** mints a login-free link to `/port-setup/{token}` where
  the client provides the account number, PIN, and service address, uploads a recent bill, and
  e-signs the LOA. `ttl_days` 1-90 (default 30); pass `recipient_email` (and `recipient_name`)
  to have the platform email it directly. **The URL is shown exactly once, at mint time** - only
  a hash is stored. The public page never echoes secrets back (it reports has-account-number /
  has-PIN booleans only).
- **`voice_port_order_share_links_list`** - the order's active links: id, created, expiry, use
  count, last used. No URLs (hashes only).
- **`voice_port_order_share_link_revoke`** - revoke one link by `token_id`, or ALL of the
  order's links with an empty body. Revocation is immediate; a client mid-form loses access.

A link minted here lets a logged-OUT third party write credentials onto the order and trigger the
LOA - minting and revoking take the same authority as editing the order. Confirm the recipient
before emailing one.

### The LOA signature link (dashboard-side, worth knowing)

The LOA e-signature rides its own signer link, separate from the port-setup share link, with
dashboard-side rules that generate support questions:

- The signer link deliberately has NO expiry - ports take weeks, and an expiring token would die
  mid-port.
- Once the link has been EMAILED to the signer it is never silently rotated; re-issuing a
  signature link is an explicit dashboard action, and any re-mint KILLS every outstanding copy of
  the old link. If the client says "my signing link stopped working", someone re-issued it -
  send the newest one, do not mint yet another.
- A detail correction on the order does NOT regenerate the LOA PDF - the client signs the
  original prefill. If a correction is material to the authorization (numbers added or removed,
  a different signer), flag it to a human rather than assuming the signed LOA covers it.

## 7. Fixing: `voice_port_order_update`, comments, verification codes

**`voice_port_order_update`** - carrier-facing corrections on a FILED order: the exception-fix
path, and pre-confirm adjustments. It re-PATCHes the carrier order AND the local row in one call.
Fields: `losing_account_number`, `losing_pin`, `billing_phone_number`, `authorized_signer`,
`billing_name`, `service_address`, `requested_foc_datetime`, `enable_messaging`. Strict body
(unknown key = 422), `422 empty_update` on an empty body, `409 not_submitted` on a pure draft
(a draft's edits are local-only, dashboard-side), `409 order_terminal` once the order is ported,
cancelled, or rejected. After fixing an exception, the order needs `voice_port_order_action`
`confirm` again - the fix alone does not restart the port.

**`voice_port_order_comments_list` / `voice_port_order_comment_add`** - the dialogue with the
carrier's porting operations team. They ask for corrections and documents here; a timely reply
keeps the port on schedule. **Comments are visible to carrier ops (in the carrier's own portal
too) - NEVER paste a PIN, an account number, or any credential into a comment.** Credentials go
through `voice_port_order_update` or the share-link page, both of which encrypt and mask. A
comment is plain text up to 4000 characters; a draft with no carrier order has no thread (empty
list on read, `409 not_submitted` on write).

**`voice_port_order_verification_codes_send` / `voice_port_order_verification_codes_verify`** -
some losing carriers require per-number possession verification. **SEND actually rings or texts
the CUSTOMER's numbers** (1-100 per call, `verification_method` `sms` or `call`) - real messages
to real handsets, so warn the client before firing it and tell them codes are coming. VERIFY
submits the codes the client collected (`{ phone_number, code }` pairs). Both are
`409 not_submitted` on a draft.

**`voice_port_order_refresh_status`** - pulls the live carrier status and mirrors it onto the
row through the ranked-status guard (backward moves refused, unknown tokens land in `status_raw`
only, terminal states never move). It deliberately sends NO notifications - the status-poll
cron's watermark sweep picks up any transition, so a manual refresh and a webhook produce
identical notification behavior. Safe to call whenever the mirror looks stale.

## 8. Carrier guides (the losing-carrier legwork)

What each common losing carrier actually requires - collected from real ports, verify nothing
has changed with the client's own account:

- **CallRail.** The CSR (customer service record) and port-out PIN come via an ADMIN SUPPORT
  TICKET on the CallRail side - the client's admin files it; the data is not self-serve in the
  UI. Do NOT cancel CallRail service; the numbers must stay active until the port completes. A
  CSR-sourced account number or PIN often arrives AFTER the order is filed - that is the normal
  CallRail flow, and `voice_port_order_update` is the path to add it to a healthy filed order.
- **Twilio.** Needs the LAST 8 characters of the account SID, a port-out PIN (required for
  US-local numbers), and the service address - obtained from Twilio's porting team
  (porting@twilio.com). Keep the Twilio account and numbers active.
- **GoHighLevel / LeadConnector Phone.** LC Phone is MANAGED TWILIO under the hood
  (subaccounts the client cannot see into). Everything - account number, PIN, addresses - goes
  through a GHL support ticket, with a bill or screenshot as evidence. Expect this to be the
  slowest credential-gathering of the three.

In every case: the client's most recent BILL from the losing carrier is the document that
resolves mismatches, and the share-link page is where they upload it.

## 9. After FOC: the adoption checklist

The port completing at the carrier is the midpoint, not the end. Ported numbers land as inactive
rows with a parked (unrouted) inbound route, and each needs adopting into a working DID. Track
per-number progress in `adoption_state_json` on the order (`voice_port_order_get`); the platform
adopter runs automatically, and this checklist is what YOU verify and finish:

1. **E911, then activation.** A ported LOCAL number has no E911 address. Register one
   (`voice_e911_address_create`, or `voice_e911_addresses_list` for an existing one), point the
   number at it and activate via `voice_number_update`. E911 is the activation gate - the number
   does not take calls until this is done. Toll-free ported numbers skip E911 entirely.
2. **Routing.** The parked route rings nothing. Set `inbound_target_type` /
   `inbound_target_id` via `voice_number_update`, then verify with a test call (the PBX push is
   best-effort - see `numbers-and-e911.md`).
3. **CNAM.** `voice_number_cnam_set` - and expect the trap: a ported row whose adoption did not
   backfill `provider_number_id` answers `422 not_provisioned` with a message that is literally
   false (the number IS live at the carrier; Hiveku's row is incomplete). Fix the adoption, not
   the number.
4. **SMS.** If the number texts, re-register its sending identity: 10DLC campaign assignment via
   `voice_sms_number_assign_campaign` for local (the losing carrier's registration does not
   travel), or toll-free verification for TF (`tendlc-and-toll-free.md`).
5. **Tracking numbers.** A ported CallRail tracking number joins its DNI pool or gets its
   `tracking_source` tag - see `call-tracking-dni.md` for the pool lane and the full CallRail
   migration order.

## 10. Plays

### Play: the CallRail cutover port

The order of operations matters - tracking swap FIRST, script removal, THEN the port (the full
migration rationale lives in `call-tracking-dni.md`; this is the porting lane of it).

1. Inventory: get the number list from the client's CallRail export. `voice_portability_check`
   on ALL of them (free, up to 100 per call). Present the verdicts: portable, FastPort-eligible,
   messaging-capable, and the unknowns to re-check.
2. Client legwork, started EARLY because it takes days: the CallRail admin support ticket for
   CSR + PIN (section 8), and the standing instruction in writing: **do not cancel CallRail
   service until we confirm the port completed.**
3. `voice_port_order_create` with the numbers and whatever LOA data is in hand. Read the
   response for splits (`sibling_orders` sharing `batch_key`) - each sibling is its own order to
   watch.
4. `voice_port_order_share_link_create` with the client's email - they enter the account number
   and PIN from the CSR, upload a recent CallRail bill, and e-sign the LOA on the page. Chase
   via the link, never via chat.
5. When the CSR data lands: `voice_port_order_update` if anything needs correcting, then
   `voice_port_order_requirements` (checking the order HAS a `telnyx_order_id` first), then -
   on the human's explicit go - `voice_port_order_action` `confirm`.
6. Watch: `voice_port_order_get` per sibling; `voice_port_order_refresh_status` when the mirror
   looks stale; `voice_port_order_comments_list` for carrier-ops questions (answer them same-day
   via `voice_port_order_comment_add`, no credentials). Exceptions: read
   `exception_details_json`, fix via `voice_port_order_update`, re-confirm.
7. FOC granted: relay the date, remind the client the numbers cut over then and CallRail service
   stays on until AFTER.
8. Ported: run the adoption checklist (section 9) for every number, verify inbound with a test
   call per number, and only THEN tell the client they can close the CallRail account.

### Play: "the port is stuck"

1. `voice_port_order_get`. Read all three statuses together: `status` (local, ranked),
   `status_raw` (the carrier's word), `action_status` (was it actually confirmed?).
2. **`action_status: 'draft_only'` or `'details_set'`** - the order was never confirmed. It is
   not stuck; it is waiting for the LOA/bill/credentials and a confirm. Check the share link's
   use count (`voice_port_order_share_links_list`) - an unused link means the client never
   opened it.
3. **`status` frozen while `status_raw` changed** - an unknown carrier token; the order advanced
   under a word this platform does not map. `voice_port_order_refresh_status`, then read
   `status_raw` and report the carrier's own word.
4. **`exception`** - read `exception_details_json` for the carrier's codes, pair with
   `voice_port_order_requirements` for what is unmet, fix via `voice_port_order_update`,
   re-confirm. An account-number or BTN mismatch means the client's bill has the true values.
5. **Silence from the carrier** - `voice_port_order_comments_list`: carrier ops may have asked a
   question nobody answered. Reply via `voice_port_order_comment_add`.
6. **`ported` but the numbers do not work** - `adopted_at: null` means adoption is unfinished;
   read `adoption_state_json` per number and run the section 9 checklist.
7. Splits: check the SIBLINGS (`voice_port_orders_list`, group by `batch_key`) - "the port" may
   be five orders, four done and one in exception.
8. Escalate to a human with the support key (`PORT-XXXXXX`), the three statuses, and the
   exception codes - not with a pasted row.

## 11. Pitfalls

- **Reading local `submitted` as "sent to the losing carrier".** It means filed with OUR side.
  `action_status` is the honest confirm answer; the carrier's raw `submitted` maps to local
  `pending_carrier`.
- **Re-creating after a 502 `submit_failed`.** The local row exists, and a carrier draft may
  too - a re-create files a duplicate carrier order. Fix and confirm the EXISTING order.
- **Reading an empty `voice_port_order_requirements` as all-clear** on an order with no
  `telnyx_order_id`. Nothing was ever asked.
- **Trusting `met: true`.** Submitted, not accepted. Illegible documents pass here and bounce
  later.
- **Pasting port-order rows anywhere.** PII and legal paperwork; two fields masked, everything
  else verbatim, and the account number's real last four disclosed by design.
- **Credentials in comments.** Carrier-ops-visible, carrier-portal-visible. Update or
  share-link, never comments.
- **Firing `voice_port_order_verification_codes_send` unannounced.** It rings/texts the
  client's customers' actual handsets.
- **Reporting `activate` as "ported".** It moves `action_status` only; status moves on carrier
  evidence.
- **Letting the client cancel losing-carrier service early.** The one instruction that saves
  clients. In writing, every time.
- **Missing siblings.** One submission, several orders. Group by `batch_key` before reporting.
- **The 100-row window.** `voice_port_orders_list` silently cuts at 100; older orders need
  `voice_port_order_get` with a known id.

## 12. Diagnosis quick reference

| Symptom | First move |
|---|---|
| "Was the port actually filed/confirmed?" | `voice_port_order_get`, read `action_status` - `draft_only`/`details_set` = not confirmed |
| Status frozen for days | Compare `status` vs `status_raw`; if raw moved, `voice_port_order_refresh_status` and report the carrier's word |
| Order says `exception` | `exception_details_json` codes + `voice_port_order_requirements`, fix via `voice_port_order_update`, re-confirm |
| Carrier asked something nobody saw | `voice_port_order_comments_list` - answer same-day, no credentials |
| Client never provided account number / PIN | `voice_port_order_share_links_list` for use count; re-send or re-mint via `voice_port_order_share_link_create` |
| "Cancelled" but the client says they cancelled seconds ago | `cancel-pending` collapses to `cancelled` locally - check `status_raw` for finality |
| `ported` but numbers do not ring | `adopted_at` null / `adoption_state_json` incomplete - run the section 9 checklist (E911 -> activate -> route) |
| Ported number cannot set CNAM | `422 not_provisioned` with a false message - NULL `provider_number_id`, an adoption gap, not a carrier problem |
| Ported number cannot text | Registration does not travel: 10DLC re-assign (`voice_sms_number_assign_campaign`) or TF verification (`tendlc-and-toll-free.md`) |
| Some numbers moved, some did not | Splits - `voice_port_orders_list`, group siblings by `batch_key` |
| Order older than the list shows | The 100-row cap - `voice_port_order_get` by id |
| Client wants to port numbers OUT | Unhandled on this platform - human escalation, no tooling |
