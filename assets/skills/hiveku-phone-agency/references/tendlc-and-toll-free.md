# 10DLC and Toll-Free Registration: The Operator Playbook

Load this before touching any SMS registration object, before quoting a fee, before telling a
client why their texts do not deliver, and before ANY filing. Registration is the one part of
the phone system where a wrong call costs real money (brand vetting fees, ~$15 per fresh
campaign submit), files legal identity data (an EIN) with third parties irreversibly, or takes
a working number OFF THE AIR for weeks. Money and legal first, always.

Every tool below resolves on this server today. A name that does not resolve on your key is a
profile question first: check the key's profile, then the hiveku-communications reachability
ladder, then hand off with a precise dashboard step filed via `pm_tasks_create` - never conclude
the capability does not exist, and never invent a name. The client can also file through the
share-link page (Part 9) when they are the one holding the EIN.

## Availability

| Tool | Status | One line |
|---|---|---|
| `voice_sms_registration_get` | LIVE | Brand + campaigns + the `can_send` verdict. Read this first, always |
| `voice_sms_brand_feedback_get` | LIVE | Stored carrier feedback on a FAILED brand |
| `voice_sms_brand_submit` | LIVE | Files the brand with the carriers. Irreversible, fee-bearing |
| `voice_sms_campaign_draft` | LIVE | AI-drafts campaign text. Files nothing |
| `voice_sms_cta_preflight` | LIVE | No-JS check of the opt-in page. Free. Run before every fee |
| `voice_sms_campaign_carriers_get` | LIVE | Per-carrier (MNO) verdict for one campaign |
| `voice_sms_number_assign_campaign` | LIVE | Registers a DID to a campaign. Carrier paperwork |
| `voice_sms_campaign_resubmit` | LIVE | Re-files a row that never reached the carrier (~$15) |
| `voice_sms_toll_free_verification_get` | LIVE | Per-number toll-free verification state |
| `voice_sms_campaign_submit` | LIVE | The fresh campaign filing (~$15 vet). Ask-gated |
| `voice_sms_campaign_get` | LIVE | One campaign row by id |
| `voice_sms_campaign_appeal` | LIVE | Appeal note on a FAILED/SUSPENDED campaign |
| `voice_sms_campaign_delete` | LIVE | Remove a dead campaign row (guarded) |
| `voice_sms_toll_free_verification_submit` | LIVE | Files toll-free verification. Overwrite trap in Part 8 |
| `voice_sms_registration_share_link_create` | LIVE | Mints the client-facing registration link. The URL is a credential |
| `voice_sms_registration_share_links_list` | LIVE | Lists minted links |
| `voice_sms_registration_share_link_revoke` | LIVE | Revokes one link, or all of them |
| `voice_sms_messaging_profile_attach` | LIVE | Manual profile attach when auto-provision has not run |

LIVE = resolves on this server today. Every tool here is described from its own registered
description; trust that over any older copy of this file.

---

## Part 1: The model - three links in a chain, and a parallel lane

US carriers require A2P (application-to-person) traffic to be registered. There are two
independent ways an account becomes sendable, and they do not mix per number:

**The 10DLC chain (local numbers).** Three links, each necessary, none sufficient alone:

1. **Brand** - the legal entity (legal name, EIN, address). ONE per account. Must reach
   canonical status `VERIFIED`.
2. **Campaign** - the messaging program (use case, description, message flow, samples). Must
   reach canonical status `ACTIVE` AND carry a messaging profile
   (`telnyx_messaging_profile_id`).
3. **Number assignment** - each sending DID must be ASSIGNED to the campaign at the registry.
   **Attaching a messaging profile alone is NOT assignment.** A profile attach links the DID
   for routing only; a number that is attached but not assigned gets carrier error **40010
   "sending number is not 10DLC-registered"** on every send, while the API call itself looks
   successful. This exact gap is why an account can have a VERIFIED brand, an ACTIVE campaign,
   and still deliver nothing.

With a single campaign the platform auto-assigns: the status poll attaches the profile and
files the number assignment when the campaign finalizes. `voice_sms_number_assign_campaign`
exists for the multi-campaign account, where you must choose which campaign a number sends
under, and for repair when auto-provision has not run.

**The toll-free lane (parallel, per number).** A toll-free DID does not use the brand/campaign
chain at all. Each toll-free number passes its OWN verification: a filing with the business
identity (EIN), use case, volume, and opt-in evidence, reviewed vendor-side over roughly one to
two weeks. Carriers hard-block unverified toll-free senders, and the platform's sending-number
auto-picker never selects one. An account whose only sendable numbers are verified toll-free is
fully operational with no brand at all - do not tell it it needs 10DLC.

### The can_send truth table

`voice_sms_registration_get` computes the single verdict. Key on `can_send` and
`blocking_reason` instead of re-deriving the rule:

| Brand | Campaign | Toll-free | `can_send` | `blocking_reason` |
|---|---|---|---|---|
| none | - | none verified | false | `no_brand` |
| PENDING or FAILED | - | none verified | false | `brand_unverified` |
| VERIFIED | none submitted | none verified | false | `no_active_campaign` |
| VERIFIED | submitted, in review | none verified | false | `campaign_pending` |
| VERIFIED | ACTIVE, no messaging profile | none verified | false | `no_messaging_profile` |
| VERIFIED | ACTIVE + profile | any | **true** | null |
| any (even none) | any | at least one verified TF DID | **true** | null |

`no_messaging_profile` means an ACTIVE campaign was never provisioned; the status cron's repair
phase fills it in, so re-read before repairing by hand. Note what the table does NOT cover:
number assignment. `can_send: true` says the account is registered; a specific number can still
be unassigned and 40010 (Part 7).

---

## Part 2: Reading state honestly

Four read tools, each with a way to lie to you if read naively.

### `voice_sms_registration_get` - the canonical verdict

Returns `{ brand, can_send, has_toll_free_numbers, toll_free, blocking_reason }`. Traps from
its registered description:

- **`TCR_ACCEPTED` is not sendable.** Raw vendor statuses `TCR_ACCEPTED` and `TELNYX_ACCEPTED`
  both normalize to canonical `PENDING` on purpose, because a campaign has been observed going
  `TCR_ACCEPTED` and then `TELNYX_FAILED`. Reading a raw "accepted" as approval reports
  something that does not exist. Only canonical `ACTIVE` counts.
- **The authoritative sendability signal is `campaignStatus` plus `isTMobileRegistered`**, not
  any single raw field. The vendor keeps a top-level lifecycle `status` of `ACTIVE` even on a
  campaign whose `campaignStatus` is `TELNYX_FAILED`, and a campaign is not truly usable until
  the T-Mobile registration bit flips - which itself requires the number assignment to succeed.
  The platform's canonical status already encodes this; trust canonical over raw.
- **`operationStatus` all-APPROVED is NOT content approval.** That layer is
  connectivity/qualification ("Qualify: Yes, MNO Review: No"), and every carrier can show
  APPROVED there while the campaign has never reached actual MNO content review. This exact
  misreading produced a week of wrongly telling a client "the carriers approved you".
- **The brand row is PII.** It is returned in full: `ein` (a US tax ID),
  `legal_company_name`, contact email and phone, street address, and each campaign's
  description, message flow and samples verbatim. Never paste this response into
  customer-facing copy, a ticket, or a report.
- The `toll_free` block is computed fail-closed: empty `numbers` and `verified_count` 0 can
  mean a deploy window rather than "nothing exists" - never evidence of data loss.
- Campaigns come back newest first, all of them, no pagination.

### `voice_sms_campaign_carriers_get` - the per-carrier breakdown

The live per-MNO verdict for ONE campaign, fetched from the vendor on every call. Answers
"T-Mobile is filtering us but AT&T is fine" and "what throughput did each carrier grant".

- **ID TRAP: it takes the HIVEKU campaign UUID** (`brand.campaigns[].id` from
  `voice_sms_registration_get`), NOT the registry/Telnyx id. Passing the vendor id - the id
  printed all over the carrier report - returns 404 `campaign_not_found`.
- Three responses that look alike: `registered: false` with `carriers: []` on a 200 means "not
  submitted", not "every carrier refused"; `registered: true` with `carriers: []` means the
  vendor has published no carrier metadata yet; and a vendor failure is a deliberate fail-soft
  HTTP 502 (`carrier_status_unavailable`). On the 502, report "carrier breakdown unavailable"
  and keep the canonical verdict from `voice_sms_registration_get` - do not tell anyone their
  campaign broke.
- `campaignStatus`/`tcrStatus` here are RAW vendor strings. Never test them the way `can_send`
  tests canonical `ACTIVE`.
- It reads a carrier API key on the builder service; a rotated key 502s every call while the
  campaign is perfectly healthy.

### `voice_sms_brand_feedback_get` - why the brand failed

Returns the stored `brand_feedback_json` snapshot captured when the brand went FAILED, whose
categories (TAX_ID, ADDRESS, ...) name the EXACT fields the carriers refused, so a correction
can be targeted instead of guessed. Two traps: **`feedback: null` means no failure snapshot is
stored, NOT that the brand is healthy** - read the brand's status for that; and it is a stored
snapshot, never a fresh fetch. No brand at all is a 404 `no_brand`. Read this FIRST before any
re-file: fixing the named fields and calling `voice_sms_brand_submit` again is a fresh,
fee-bearing filing, not an edit.

### `voice_sms_toll_free_verification_get` - the toll-free lane's state

Returns `{ numbers, requests, verified_count, total_count }`: one entry per ACTIVE toll-free
DID with status `pending | in_review | action_needed | verified | rejected` or null, plus the
newest 50 submissions. Traps:

- **Every read fails closed.** A missing table or column during a deploy degrades to empty
  numbers and `verified_count` 0, and one fallback path returns all numbers with status null.
  An empty or all-null answer means "cannot prove anything is verified", never "nothing
  exists" and never data loss.
- Toll-free is decided by NPA: 800, 833, 844, 855, 866, 877, 888. **822 is
  reserved-but-unassigned and deliberately excluded**, so a +1822 DID is invisible here.
- `requests` is hard-capped at the newest 50 with no cursor; a long history silently truncates.

---

## Part 3: The use case MUST match the website - the Locus lesson

This is the section that saves clients weeks and hundreds of dollars, learned by registering a
real SEO/marketing agency (Locus Digital) through SEVEN rejections before approval. Every rule
below was paid for.

**The core mechanism:** the vendor's CSP (campaign service provider) reviewer READS THE LIVE
WEBSITE and compares it to the declared use case. An SEO/marketing/lead-gen site reads as LEAD
GENERATION to that reviewer - a banned category - regardless of what the campaign declares.
Locus declared CUSTOMER_CARE and was rejected for "website advertises SEO = lead generation";
it declared MIXED carrying a MARKETING sub-use-case (the "honest, matches the site" theory)
and was rejected for the same thing. The website, not the form, is what gets scanned.

**The lessons, in the order they were paid for:**

1. **SEO on the website = lead-gen to the CSP reviewer.** The first CUSTOMER_CARE campaign
   failed on "website advertises SEO services" with a lead-gen code, plus a message flow that
   listed multiple opt-in methods.
2. **A quote/marketing form used as the SMS opt-in IS the lead-gen intake.** Reframing the
   campaign but keeping the /free-quote form as the consent source failed again: collecting
   SMS consent on a form whose purpose is prospect capture is, to the reviewer, an SMS
   lead-gen funnel.
3. **Forced opt-in kills a campaign.** The reviewer renders the page in a browser: a consent
   checkbox pre-checked by JavaScript is "forced" even if the HTML default is unchecked. The
   checkbox must be UNCHECKED and OPTIONAL (phone may be required; consent may not be), and
   the page must say consent is not a condition of purchase.
4. **Consent text must enumerate EVERY registered message type.** A campaign selecting
   MARKETING while the page's consent covers only "account notifications" fails. Later, a
   CUSTOMER_CARE campaign failed because one SAMPLE was a support-request acknowledgment and
   the consent text did not list support updates. Samples must stay inside consent scope, and
   the consent must name every type the campaign registers - including "marketing and
   promotional offers" when marketing is selected.
5. **Body copy counts, not just the consent block.** A page whose checkbox consent was
   perfectly scoped still failed because an INTRO PARAGRAPH said "along with occasional
   marketing offers" on a customer-care-only program. The reviewer reads the whole page.
6. **The page must be verifiable WITHOUT JavaScript** (Part 4). One rejection cycle (carrier
   code 806) was caused purely by a client-rendered page: compliant in a browser, empty to the
   scanner.
7. **The escalation that actually cleared it:** with the campaign clean, the client-only
   opt-in page live, and SMS consent REMOVED from every marketing and quote form, the vendor's
   CSP review STILL kept failing on "SEO = lead-gen". Abe escalated to the vendor's HUMAN
   support, who submitted the campaign for MNO (carrier) review anyway, with a "they may flag
   it" caveat. **The carriers approved it, SEO website and all.** The lead-gen objection was
   the CSP reviewer's stance, not a carrier rule.

**The winning combination for a marketing/SEO business:** CUSTOMER_CARE use case, transactional
messages to existing clients only, a DEDICATED client-only opt-in page as the SOLE SMS opt-in,
SMS consent stripped from every marketing/quote/contact form, and - when the CSP reviewer
keeps refusing while the carrier qualification layer looks fine - escalation to human support
with a request to submit for MNO review anyway.

**Rules that fall out of this:**

- **Never tell a client to gut their website.** Removing SEO/marketing services from the site
  was on the table for weeks and was never needed. The fix is scoping the OPT-IN, not the
  business.
- **MIXED and LOW_VOLUME require `sub_usecases`** (MIXED needs 2 to 5, LOW_VOLUME 1 to 5, from
  the registry's own enum). A MIXED submission without them fails; the submit guard refuses
  with `use_case_needs_subtypes` rather than letting you pay for the rejection. Prefer a
  single use case; MIXED is not a shortcut around the match-the-website rule - Locus's MIXED
  attempts failed on the same grounds.
- The use cases `voice_sms_campaign_submit` accepts (its enum, nothing else files): CUSTOMER_CARE,
  ACCOUNT_NOTIFICATION, MARKETING, 2FA, DELIVERY_NOTIFICATION, HIGHER_EDUCATION,
  PUBLIC_SERVICE_ANNOUNCEMENT, plus MIXED and LOW_VOLUME (sub-use-case sets required), plus
  the special classes CHARITY, POLITICAL and EMERGENCY, which draw extra vetting - do not
  offer those casually. Anything outside that list (FRAUD_ALERT, SECURITY_ALERT,
  POLLING_VOTING, SOLE_PROPRIETOR) is a 422 invalid_body here, not a registry option.
- **An agency texting its clients' CUSTOMERS is a different animal**: each client registers
  its OWN brand, and the agency acts as an ISV. One agency brand cannot cover traffic sent on
  behalf of client businesses.
- Content rules the reviewers enforce: samples at or under 160 characters (GSM-7; smart quotes
  silently flip a message to 70-char UCS-2 segments), a SINGLE opt-in method described in the
  message flow, no public link shorteners (bit.ly and shared shorteners are flagged), embedded
  links/phone numbers in samples consistent with the campaign's declared attributes, and the
  SHAFT list plus cannabis/CBD (banned regardless of state law), high-risk finance, gambling,
  and lead generation.

---

## Part 4: The CTA page - eight elements, server-rendered, preflighted

The opt-in page (the "call to action" page) is what the carrier's scanner fetches and what the
CSP reviewer reads. It must contain ALL EIGHT elements, in the page's raw HTML:

1. **The opt-in mechanism itself** - the form or checkbox collecting the number, with the
   consent checkbox UNCHECKED and OPTIONAL, and wording that consent is not a condition of
   purchase.
2. **Consent language enumerating EVERY registered message type** - account updates,
   appointment reminders, support updates, marketing offers... whatever the campaign
   registers, named on the page.
3. **HELP instructions** ("Text HELP for help").
4. **STOP instructions** ("Reply STOP to unsubscribe").
5. **Message frequency disclosure** ("message frequency varies" or a number).
6. **"Message and data rates may apply."**
7. **A link to the privacy policy.**
8. **The no-sharing sentence, ON the page, in or next to the consent block:** "We will not
   share your mobile information with third parties for marketing purposes." A page whose
   linked privacy policy says it is NOT enough - this is a confirmed carrier requirement
   learned from a live rejection, and the preflight checks for it on the page itself. (The
   privacy policy separately needs explicit "will not be sold" language for opt-in data.)

**The page MUST be server-rendered.** The carrier's CTA scanner runs NO JavaScript. A React
page whose form sits behind `useSearchParams` + `Suspense` prerenders to HTML with no form at
all: it passes every check in a browser and fails invisibly at the carrier, producing an 806
rejection ("unable to verify CTA") that reads like a copy problem and is actually a rendering
problem. This failure mode is systemic for statically-exported sites; it cost Locus a full
rejection cycle. The diagnostic: fetch the URL with no JS -
`curl -sS -A 'Hiveku-Session/1.0 (+https://hiveku.com)' '<url>'` - and grep the raw HTML for the
consent text, "message and data rates", "message frequency", "Reply STOP", "Text HELP", the
privacy link, and the no-sharing sentence. Present in a browser but absent from raw HTML IS
the rejection. One trap: on a Hiveku-hosted page a 202 with an empty body (header
`x-amzn-waf-action: challenge`) or a 403 with `x-hiveku-firewall: blocked` is the edge firewall
refusing an unidentified client, not a missing form - add the `-A` above and re-run before
concluding. A 403 without that header comes from the site itself. `voice_sms_cta_preflight` fetches
from Hiveku's own servers and is exempt.

**`voice_sms_cta_preflight` - FIRST, ALWAYS, before any fee.** It fetches each opt-in URL the
message flow names with no JavaScript, exactly as the reviewer's crawler does, and reports
which required elements are present in the returned HTML, including a client-rendered-page
signal. It files nothing, writes nothing, costs nothing - a missing disclosure costs a
re-check here instead of a rejection fee and roughly a week of review. Mechanics: URLs pass
through an SSRF guard; `message_flow` caps at 4096 characters; a missing or empty flow is a
422 naming the field. The server enforces the same check at submit time (Part 5): EVERY
declared non-policy URL must pass, because a campaign with one good page and one broken page
gets reviewed on the broken one; privacy/terms/legal paths are checked for reachability only.
An unreachable page is a warning, not a block - the platform never blocks on its own network
trouble.

---

## Part 5: The filing order, with fees

Money attaches at two points: the brand vet and each fresh campaign submit (~$15 at the
registry, non-refundable, per submission - three rejections is three fees unless you use the
free lanes in Part 6). Get each step right before paying for the next.

**1. `voice_sms_brand_submit` - the brand. IRREVERSIBLE AND FEE-BEARING.** It files the legal
entity (legal name, EIN, entity type, address, contact email and phone) with the vendor, the
registry, and the carriers for paid vetting. Not a draft; it cannot be withdrawn, and a later
correction is a RE-VET with another fee, never a deletion. **Get the EIN and legal name right
the first time** - the EIN entry should match the IRS CP-575 letter verbatim; a mismatch
typically returns as a FAILED brand. This is a filing about a real company and wants the
human's explicit confirmation of the exact values, not an agent's inference. One brand per
account: calling again updates and re-vets rather than duplicating. **Response trap:
`submission_error` non-null on a 200 means the row SAVED LOCALLY but the carriers never saw
it** - reading only the status code would tell you it worked. Fix the cause and retry. A clean
EIN match can auto-verify within minutes; otherwise expect days.

**2. `voice_sms_campaign_draft` - free text.** Drafts a carrier-compliant campaign from the
account's own business context: name, use case, description, message flow, samples, keyword
sets. No row is created, nothing is filed. Requires the brand VERIFIED first (the same
precondition submit enforces). The drafter writes a plausible flow; only the preflight proves
the opt-in page it names actually complies.

**3. `voice_sms_cta_preflight`** on the draft's message flow. Part 4. Do not skip it because
the draft "looks right" - the page, not the draft, is what gets scanned.

**4. `voice_sms_campaign_submit` - the filing. ~$15 per fresh submit, no
withdrawal.** Takes the full campaign payload (name, use case, description, message flow,
sample messages, keyword sets and auto-replies; `sub_usecases` when MIXED/LOW_VOLUME). The CTA
preflight is enforced server-side at submit - a page that fails hard-blocks the filing (the
tool's own `acknowledge_cta_warnings: true` is the informed override for WARNING-level findings
such as an unreachable page; provable failures still refuse; the
dashboard has an acknowledge-warnings override; the public share-link page has none). Same
response trap as the brand: **`submission_error` non-null on a 200 = the row persisted but
never reached the carrier** - that row is exactly what `voice_sms_campaign_resubmit` re-files;
do NOT create a second campaign for it. The client share link (Part 9) files the same campaign
when the client is the one holding the details.

**5. Poll.** `voice_sms_campaign_get` for the row, or `voice_sms_registration_get`
for the whole picture. Review runs registry -> vendor CSP review -> MNO review, typically days.
The status cron polls and notifies on changes; you do not need to poll aggressively. Remember
Part 2: raw "accepted" statuses are still canonical PENDING.

**6. `voice_sms_number_assign_campaign` - after ACTIVE, if needed.** Registers one DID to the
approved campaign. **ID TRAP, inverted from the carriers tool: this one takes
`telnyx_campaign_id`, the REGISTRY id, read from `voice_sms_registration_get`** - not the
Hiveku row uuid. With a single campaign the auto-provision poll does this for you; verify
before filing by hand. Carrier paperwork, not a local preference: moving a number later is
another filing, and assigning a number to the wrong campaign misrepresents its sending
identity, which gets traffic filtered rather than merely rejected.

**7. `voice_sms_messaging_profile_attach` - only when auto-provision has not.**
Attaches the campaign's messaging profile to a DID for routing. **Attach is not assignment**:
a DID can be attached and still 40010 until step 6 lands. The auto-provision poll normally
does both; reach for the manual tools only when a specific number is misbehaving after the
campaign is ACTIVE.

---

## Part 6: When rejected

First, read the reason: `voice_sms_brand_feedback_get` for a FAILED brand;
`voice_sms_registration_get` carries each campaign's stored rejection reason;
`voice_sms_campaign_carriers_get` tells you whether the failure is vendor-side (CSP) or
carrier-side. A stale failure reason lingers on the vendor object after a re-queue until the
new verdict lands - do not re-diagnose from a reason older than your last action. Then pick a
lane. There are exactly three, plus the escalation:

**`voice_sms_campaign_appeal` - a note, nothing else.** It attaches your
`appeal_reason` (20 to 2000 chars) and re-queues review. **THE CONTENT IS UNCHANGED. If the
content is why it failed, the appeal fails again** - Locus proved this with a byte-identical
re-rejection. Appeal ONLY when the campaign and page are already right and the reviewer's
stated reason is wrong or already fixed on the page side. Works only while the campaign is
canonical FAILED or SUSPENDED (422 `not_appealable` otherwise); on success the status flips to
PENDING (raw APPEAL_PENDING). Free.

**`voice_sms_campaign_resubmit` (~$15) - only for a row that never reached the carrier.** The
submit path persists locally even when the vendor call fails, leaving `telnyx_campaign_id`
null; resubmit re-files THAT row. Body is optional: nothing re-files exactly as stored; a body
must be the COMPLETE payload, not a patch - **omitting a field you previously set CLEARS it.**
Run the preflight before retrying; resubmitting a rejected flow unchanged buys another
rejection.

**`voice_sms_campaign_delete` - cleanup only.** Hard-deletes the local row; the
guard allows only FAILED/EXPIRED/never-submitted and refuses anything live or in flight. Any
vendor-side record is left orphaned. Use it to clear dead rows so the attach logic and the
humans see one live campaign, never as a rejection-recovery move by itself.

**There is NO free content-edit re-review path on this surface yet.** Say so plainly. A
rejected campaign whose CONTENT needs to change - the message flow, the description, a sample
- cannot be edited-and-re-queued through any tool today; a campaign content-update tool does
not exist at any layer, so do not go looking for a name. The choices are: fix the PAGE
(content on the website is yours to change freely) and appeal; or delete the row and file
fresh (~$15). A raw content update at the vendor does re-queue review free of charge, but
no update tool exists (unbuilt at every layer), so the ~$15 delete-and-refile is the honest
quote for a content fix, and pretending otherwise strands the client.

**When to escalate to a human at the vendor - the move that actually cleared Locus.** The
pattern: the campaign and page are demonstrably compliant, the qualification layer shows every
carrier fine, and CSP review keeps failing on the same judgment call (typically "this website
is lead-gen"). Stop paying for resubmits into a fixed stance. Have the account owner open a
support ticket making the first-party argument (markets its OWN services, sells no leads) and
ask support to SUBMIT FOR MNO REVIEW anyway. The carriers are often more lenient than the
vendor's own reviewer. Support also names concrete gaps a rejection notice truncates (Locus's
ticket surfaced a missing no-sharing sentence and two over-length samples that no rejection
text had mentioned).

---

## Part 7: After approval - the 24-72 hour trap

Approval is not delivery. Two things remain between an ACTIVE campaign and texts that arrive:

**Number assignment must actually complete.** The auto-provision poll attaches the profile and
files assignments when the campaign finalizes; a number attached but not assigned is 40010
(Part 1). An assignment filed too early fails with vendor code 10036 "campaign is still
pending" and retries harmlessly until the campaign truly finalizes - that wait is
vendor-side and genuine, not a bug to fix.

**Then carriers take 24 to 72 HOURS to propagate the number-to-campaign assignment.** During
that window a message can return a DELIVERED receipt and still be silently filtered - the
handset never shows it, and nothing in any API says so. This is standard onboarding, not a
misconfiguration. Locus's first post-approval test "delivered" seven minutes after approval
and never arrived; expected.

**How to prove real delivery:** wait out the window, then send ONE test to a handset you
control (the account owner's own phone), and confirm ON THE HANDSET. Read the message row with
`voice_sms_thread_messages_list` for the receipt, but treat the handset as the truth -
`delivered` in the API plus nothing on the phone during the window is the propagation trap,
not a defect. Never run this proof against a customer's number.

---

## Part 8: Toll-free verification

**LEAD WITH THE OVERWRITE TRAP: resubmitting a number that is already VERIFIED OVERWRITES its
vendor-side approval, and that number STOPS SENDING until the fresh review completes - one to
two weeks off the air.** `voice_sms_toll_free_verification_submit` guards this with
a 409 `verified_number_resubmission` listing the `verified_e164s`; overriding it requires
`confirm_overwrite_verified: true`, and that flag is a HUMAN decision every time - never set
it to make an error go away. The legitimate reason to overwrite is a material change to the
business or use case that the existing verification no longer covers, accepted knowingly with
the downtime.

Mechanics: every number in the filing must be toll-free and active on THIS account; the filing
prefills from the brand where one exists; missing business identity fields are a 422
`missing_business_fields`; the row persists first, then submits (the same
saved-locally-vs-filed distinction as Part 5). One use case per number. `message_volume` is
the vendor's own enum string - pass it as given, and do not invent values.

**Evidence checklist before filing** (this is what the reviewer wants):

- Business identity: legal name, EIN, address, website - consistent with the site itself.
- A PUBLIC, HTTPS opt-in page or opt-in evidence images the reviewer can fetch - the Part 4
  page standards apply here too (all eight elements, server-rendered).
- A use case description and sample messages that match the opt-in language.
- Realistic volume. Verification review is vendor-side and typically takes 1 to 2 weeks;
  status lands in `voice_sms_toll_free_verification_get` (`pending`, `in_review`,
  `action_needed`, `verified`, `rejected`).

`action_needed` means the reviewer wants something specific - read the request's `last_error`
and `status_history` rather than refiling blind. Remember the read tool fails closed (Part 2):
an all-null status sweep during a deploy is not a lost verification.

---

## Part 9: The client handoff - the share link is a credential

Most agency clients cannot and should not be walked through EIN entry over chat.
`voice_sms_registration_share_link_create` mints a public registration page where
the person who actually holds the EIN fills the brand (and, once the brand verifies, the
campaign) in plain language, with the preflight enforced and no override button.

**The URL IS a credential: a logged-out third party holding it files the account's legal
identity (EIN included) and fee-bearing campaigns.** It is shown ONCE at mint time. Handle it
like a password: deliver it directly to the named recipient, never paste it into a shared
channel or a ticket, and never store it in notes. `voice_sms_registration_share_links_list`
shows what is outstanding; `voice_sms_registration_share_link_revoke` kills one token, or every
token when called without one. Revoke links that are no longer needed - an unused live link is
standing risk.

---

## Part 10: Plays

### Play 1: An SEO-agency client needs texting, from zero

1. `voice_sms_registration_get` - confirm `no_brand` and read what exists. Check
   `voice_sms_toll_free_verification_get` too: if they own a verified toll-free number, they
   can send TODAY while 10DLC proceeds.
2. Decide the lane per Part 3 BEFORE any filing: for a marketing/SEO site, CUSTOMER_CARE to
   existing clients, with a dedicated client-only opt-in page. Confirm SMS consent appears on
   NO marketing/quote/contact form.
3. Get the opt-in page built server-rendered with all eight elements (Part 4). Run
   `voice_sms_cta_preflight` until clean.
4. Brand: collect legal name + EIN (CP-575 verbatim) from the human, confirm the exact values
   back, then `voice_sms_brand_submit` - or hand the whole filing to the client via the share
   link (Part 9). Check `submission_error` on the response.
5. On VERIFIED: `voice_sms_campaign_draft`, tighten it (samples <=160 chars, inside consent
   scope, no SEO wording in samples), preflight again, then `voice_sms_campaign_submit` (~$15
   - name the fee to the owner before filing).
6. Poll canonical status. On ACTIVE, verify auto-provision attached and assigned the DIDs;
   repair with `voice_sms_messaging_profile_attach` + `voice_sms_number_assign_campaign`
   (registry id) only if not.
7. Wait the 24-72h window, prove delivery to the owner's own handset (Part 7), then hand off.

### Play 2: "T-Mobile is filtering us"

1. `voice_sms_registration_get` - if `can_send` is false, this is not filtering, it is
   registration; work the `blocking_reason`.
2. `voice_sms_campaign_carriers_get` with the HIVEKU uuid - read T-Mobile's row: status,
   granted throughput (tpm), and the daily cap. A LOW brand tier carries a 2,000/day T-Mobile
   cap; volume above the granted cap is filtered by design, and the fix is brand vetting, not
   a support ticket.
3. If the campaign was approved within 72 hours, it is the propagation window (Part 7); wait
   and re-prove.
4. Check the specific sending number is ASSIGNED to the campaign, not just profile-attached -
   a 40010 in the message row's error text is the giveaway.
5. Only after all four: suspect content (link shorteners, SHAFT-adjacent wording) and volume
   patterns, and consider the vendor ticket.

### Play 3: "Our campaign got rejected again"

1. Read the stored rejection reason and classify it: PAGE (CTA elements, forced opt-in,
   client-rendered, consent scope), CONTENT (use case mismatch, samples, description), or
   BRAND-LEVEL (website read as lead-gen).
2. PAGE: fix the page (Part 4), verify with `voice_sms_cta_preflight` AND a raw no-JS fetch,
   then `voice_sms_campaign_appeal` - the content is unchanged and now the page is right, so
   an appeal is the correct free lane.
3. CONTENT: no free edit path exists (Part 6). Quote the honest choice: delete + fresh submit
   (~$15) with the content fixed, or wait for the content-update tool.
4. BRAND-LEVEL, repeatedly, with carriers qualifying: stop paying. Escalate to the vendor's
   human support with the first-party argument and ask them to submit for MNO review anyway
   (Part 3, lesson 7).
5. Never resubmit unchanged, and never burn a fee to "see if it passes this time".

---

## Part 11: Pitfalls and diagnosis

Standing pitfalls, beyond the per-tool traps above:

- Filing anything without the owner's explicit confirmation of the EIN and the fee. Both
  brand submit and campaign submit are ask-gated for exactly this reason.
- Reading a raw vendor status instead of the canonical one. TCR_ACCEPTED, TELNYX_ACCEPTED,
  and a top-level ACTIVE are all still PENDING until the platform says ACTIVE.
- Trusting a browser view of the opt-in page. The reviewer's crawler runs no JS; only the raw
  HTML counts.
- Quoting "approved" from the qualification layer. `operationStatus` all-APPROVED has fooled
  this platform's own operators; only canonical ACTIVE (+ the propagation window) is approval.
- Pasting `voice_sms_registration_get` output anywhere client-visible: the EIN rides in it.
- Telling a toll-free-only account it needs 10DLC, or a 10DLC account its toll-free numbers
  are covered by the campaign. The lanes are parallel and per-number.

| Symptom | Likely cause |
|---|---|
| Sends accepted, row says `sent`, nothing arrives, campaign ACTIVE | Number not ASSIGNED to the campaign (40010), or the 24-72h propagation window |
| `can_send: false`, brand VERIFIED, campaign shows raw TCR_ACCEPTED | Canonical PENDING - review not finished. Not a bug |
| `blocking_reason: no_messaging_profile` on an ACTIVE campaign | Provisioning gap; the status cron's repair phase fills it - re-read before manual repair |
| `voice_sms_campaign_carriers_get` returns 404 | You passed the registry/Telnyx id. It takes the Hiveku uuid |
| `voice_sms_number_assign_campaign` fails | You passed the row uuid. It takes `telnyx_campaign_id`, the registry id |
| Carriers tool: 200, `registered: false`, empty carriers | Campaign never reached the vendor - resubmit lane, not a carrier refusal |
| Carriers tool: 502 `carrier_status_unavailable` | Fail-soft vendor error (possibly a rotated API key). Campaign may be healthy - report "breakdown unavailable" |
| Rejection cites CTA elements that ARE on the page | Page is client-rendered; the scanner saw empty HTML. Raw no-JS fetch proves it |
| Rejected again after an appeal, identical reason | Appeal changed nothing - the content was the problem. Wrong lane |
| Brand FAILED, `voice_sms_brand_feedback_get` returns null | No snapshot stored - not healthy, not clean; read the brand status and the vendor notice |
| 200 from brand/campaign submit but nothing progressing | `submission_error` non-null: saved locally, never filed. Resubmit lane |
| Verified toll-free number suddenly stopped sending | Someone resubmitted its verification - the overwrite trap. Expect the 1-2 week re-review |
| Toll-free tool shows every number null/unverified after a deploy | Fail-closed read. Cannot prove, not data loss - re-read later |
| A +1822 number missing from the toll-free report | 822 is excluded by design (reserved NPA) |
| Delivered receipt, handset shows nothing, approval was yesterday | Propagation window. Wait, then re-prove on a controlled handset |
| Campaign stuck PENDING for days, assignment retries logging 10036 | Genuine vendor-side finalization wait. The retry is idempotent and self-heals |

Related references: `sms-operations.md` for sending against a registered account,
`numbers-and-e911.md` for buying the numbers, `caller-id-and-reputation.md` for the spam-label
ladder once you are delivering.
