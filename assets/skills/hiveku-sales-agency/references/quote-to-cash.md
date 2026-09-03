# Quote-to-cash — estimates, contracts, signature envelopes

Load this file before creating or sending any estimate or envelope, and for the weekly
accepted-but-unpaid aging sweep. Sends here reach a customer and touch legal documents:
the SKILL.md approval rule applies to every send, with the exact document and roster shown.

## Estimates

- Templates first: `crm_estimate_template_list` / `crm_estimate_template_get`; codify recurring offers
  with `crm_estimate_template_create` / `crm_estimate_template_update`.
- `crm_estimate_create` - requires contact_id OR company_id; link deal_id. line_items are
  { description, quantity, unit_cents, ... } - ALL MONEY IN CENTS. estimate_number auto-generates.
  For a company-level deal, create and link the company FIRST (SKILL.md section 2, Companies) so
  the estimate hangs off the right object.
- `crm_estimate_send({ estimate_id, channel })` - email | sms | both (SMS needs the voice add-on);
  mints a 30-day portal token; pass idempotency_key to dedupe re-sends. Get approval before sending.
  After an ambiguous timeout on a send, READ before re-sending: `crm_estimate_get` (status flips to
  sent) - and if you must retry, pass the SAME idempotency_key so the dedupe can catch it, never a
  fresh one.
- On acceptance: `crm_estimate_mark_accepted({ estimate_id, signer_name })` (signer_name is required
 - the name the customer agreed under) → `crm_estimate_convert_to_invoice({ estimate_id })`, which
  revokes the portal tokens and cannot be repeated (409 if already converted). The chain no longer
  ends there: proof the draft invoice with `accounting_invoice_get` (the only read returning its
  line items) and send it with `accounting_invoice_send` - preview without `confirm: true` first
  (it sends NOTHING and returns the resolved recipient/from/subject/channel legs), show the user,
  explicit yes, then the SAME call with `confirm: true`. Then advance the linked deal stage - and
  when that move IS the close, record the why: `won_reason` via `crm_update_deal` on a win
  (`crm_deal_move_stage` takes `lost_reason_code` on a move whose destination is a closing stage) - and
  log the milestone with `crm_create_activity`.

## Finding and aging estimates and envelopes

- `crm_estimate_list` - filter by status (draft/sent/viewed/accepted/declined/expired/converted/all),
  contact_id, company_id, deal_id, free-text q (matches estimate_number/notes/contact name/email/
  company name), order (created_desc/created_asc/expires_asc/expires_desc/total_desc/total_asc),
  limit/offset. Each row includes the linked contact, company, and deal (id, name, value, stage) -
  the CRM context arrives in the same read.
- `crm_estimate_get` - one estimate by UUID with line_items, contact, company, and deal.
- `crm_envelope_list` - filter by status (draft/sent/viewed/completed/declined/voided/all),
  contact_id, company_id, deal_id, or subject_type (estimate/contract/invoice/custom); limit
  defaults to 50, max 200. Rows include signers plus the linked contact, company, and deal.

### The accepted-but-unpaid sweep (weekly - this is what fires the SKILL.md escalation trigger)

1. `crm_estimate_list({ status: "accepted" })` - any row accepted 7+ days ago that has not been
   converted is the escalation: name the estimate, its total, its age, and the linked deal. For
   rows already converted, follow the `converted_invoice_id` into `accounting_invoice_get` -
   an invoice still in `draft` means the bill never went out, the same escalation with a
   different fix (send it via `accounting_invoice_send`, preview first, confirmed yes).
2. `crm_envelope_list({ status: "sent" })` - envelopes sent 7+ days ago with pending signers.
   Before nudging anyone, `crm_envelope_list_signers` to see whose turn it actually is - on a
   sequential envelope only the current signer has been invited, and nudging the wrong person
   reads as chaos.
3. Sweep `status: "viewed"` on both as well - viewed-but-not-actioned is the warmest nudge list
   you have.

Without this sweep the "estimate accepted but unpaid/unsigned after 7 days" trigger can only
fire by luck.

## Contracts (e-sign envelopes)

- Templates: `crm_contract_template_list` / `crm_contract_template_get` /
  `crm_contract_template_create`.
- **`crm_contract_template_update({ template_id, ... })` edits ONLY name, description and
  is_archived.** The document body is immutable by design - sent envelopes reference the template id
  for audit. Passing layout_json to it returns success and changes nothing, on a legal document. To
  change terms, `crm_contract_template_create` a new version and `crm_contract_template_delete` the
  old one (that archives, sets is_archived=true; templates are never hard-deleted).
- `crm_envelope_create({ title, signers })` - both required. Body is EITHER layout_json (block-based,
  compiled server-side) OR `source_pdf_s3_key` + `fields[]` (legacy PDF + coordinate fields); there
  is no `source_pdf` argument. signers[] is 1-10; signing_order = parallel | sequential (default
  parallel). Link it with contact_id / company_id / deal_id.
- Signer tokens: `crm_envelope_send` mints fresh per-signer plaintext tokens itself on first send,
  so the normal flow needs nothing from you. Capture the create-time tokens (and the one
  `crm_envelope_add_signer` returns) only when you are hand-delivering a signing link outside the
  invite email - they are not derivable from the stored hash afterwards. The `signer_tokens`
  argument on send is legacy; omit it.
- **Pre-flight: the from_email on the account's payment-integrations settings page is a BRANDING
  choice, not a blocker.** (The server's own `crm_envelope_send` description names that setting
  `crm_payment_integrations` - it is a settings surface, NOT a callable tool; do not attempt the
  call.) Verified against the send route: with the setting UNSET, invites send from the platform
  sender `agreements@notifications.hiveku.com` via Resend; SET and domain-verified, they send from
  the client's own domain. The send does not fail either way. No MCP tool reads or writes it, so
  the pre-flight is one sentence to the owner on a new account: "signature invites will carry the
  Hiveku sender until from_email is set in the dashboard - fine to proceed?"
- **Signer order matters.** For sequential envelopes put the EXTERNAL counterparty first and your
  team's countersigner last. `crm_envelope_add_signer` appends at order max+1 and only works on drafts
  (409 otherwise) - add signers in the order you want them to sign.
- `crm_envelope_send({ envelope_id })` - this EMAILS the counterparty and flips the envelope
  draft → sent, which is one-way: a sent envelope can only be voided, never edited
  (`crm_envelope_update` refuses with 409 off draft). Show the user the rendered document, the exact
  signer roster and the order, get an explicit yes, then send. On a SEQUENTIAL envelope only the
  FIRST pending signer is emailed; later signers are invited automatically as prior signers
  complete. Do not "fix" a quiet signer 2 by resending - check `crm_envelope_list_signers` to see
  whose turn it actually is.
- Track with `crm_envelope_get` / `crm_envelope_list_signers`; `crm_envelope_void` to kill a bad send
  (then recreate - envelopes are immutable after sending).

## Pitfalls (restated at the surface)

- **Sequential envelopes email only signer 1.** Downstream signers are invited on prior completion.
  Wrong signer order on a sequential envelope silently strands the deal - order external signers
  first, and diagnose with `crm_envelope_list_signers`, never a blind resend.
- **`crm_contract_template_update` cannot change the document body.** Name, description and
  is_archived only; a layout_json passed to it succeeds and does nothing. New terms = new template.
- **Money is in cents** on estimates/invoices (unit_cents). A $1,500 line item is 150000.
- **Envelope from_email is branding, not a gate.** Unset, invites carry the platform sender
  (`agreements@notifications.hiveku.com` via Resend) - the send succeeds either way. Flag the
  sender identity to the owner before the first envelope on a new account; never report an unset
  from_email as a send blocker.
