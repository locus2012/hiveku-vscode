# Reference: Caller ID and number reputation

This file covers what the called party SEES - which number a rep's outbound call presents, which
number a text goes out from, what name shows on the handset, and what to do when it says
"Spam Likely" instead. Load it when a client says "the wrong number shows when we call out",
"this isn't my assigned number", "we show up as Spam Likely", "customers say the call looks like
spam", "withhold my number", or "set every rep's caller ID".

The stakes, first:

- **Caller ID is carrier-facing and public.** A caller-ID change alters what every future callee
  sees from that seat, immediately. A CNAM change alters how the business is identified in the
  national databases for 12-72 hours per write, and is not instantly reversible.
- **Presenting a number the account does not own fails STIR/SHAKEN attestation and the carrier
  REJECTS the call.** The platform refuses unowned DIDs before the carrier has to.
- **A toll-free number as caller ID is refused** (`422 toll_free_caller_id`): a 911 call from
  that seat would present a number with no dispatchable address.
- **`voice_call_originate` places a real call and bills real minutes** on both legs, counting
  toward the account's daily toll-fraud cap.

## Availability

Every tool below resolves on this server today. A name that does not resolve on your key is a
profile question first: check the key's profile, then the hiveku-communications reachability
ladder, then hand off with a precise dashboard step filed via `pm_tasks_create`. Never tell the
user the capability does not exist, and never invent a name.

| Tool | Status |
|---|---|
| `voice_extensions_list` | LIVE |
| `voice_extension_update` | LIVE |
| `voice_extension_get` | LIVE (but omits the caller-ID columns - see section 2) |
| `voice_numbers_list` | LIVE |
| `voice_number_cnam_set` | LIVE |
| `voice_calls_list` | LIVE |
| `voice_toll_fraud_state` | LIVE |
| `voice_call_originate` | LIVE |

---

## 1. The mental model: three deciders, one setting

The per-seat setting is two columns on the extension row:
`outbound_caller_id_number_id` (which owned DID this seat presents) and
`outbound_caller_id_anonymous` (CLIR - present "Blocked" instead). THREE separate code paths read
them, and history says every caller-ID bug came from one path honoring the setting while another
did not:

1. **The softphone/desk-phone path** - a SIP call through the PBX dialplan reads the
   per-extension directory value; an unset value falls back to the tenant default.
2. **Click-to-call (`voice_call_originate`)** - the app reads the extension's assignment
   directly and picks the caller ID per call.
3. **SMS** - a text composed by a person resolves the SENDER's assigned DID first (section 4).

**The account default**, presented by every seat with no assignment: the oldest active
`purpose: 'main'` DID. Two traps inside that sentence: an account with more than one `main` row
resolves to the OLDEST, which can be somebody's personal line (the classic incident: eight
unassigned reps all presenting the owner's number); and nothing in the UI names the default -
it honestly says "your account's default number". When only a few DIDs serve many reps, the real
decision is WHICH number unassigned users present - a main company number, never a personal DID.

### Ground truth: what was actually presented

Never argue caller ID from configuration alone. For an outbound call, `from_e164` in
`voice_calls_list` records what was REALLY presented on the wire - it is the arbiter when the
client's report and the settings disagree. The diagnostic pattern: pull the rep's recent
outbound calls and read `from_e164` per call. One number throughout that matches the assignment:
working. One number throughout that does not: the assignment never reached that path. TWO
numbers interleaved for the same user in the same period: the two call paths disagree
(one honors the assignment, one is serving a stale value) - that is a platform-side sync issue
to hand a human WITH the call-log evidence, not something a re-save loop fixes.

The same honesty applies to CLIR: before promising a client their number is withheld, place a
test call from the anonymous-set seat and confirm what a real handset shows. Withholding that
silently fails is worse than not offering it.

### Choosing the account default (what unassigned seats present)

The default is not directly settable - it is DERIVED: the oldest active `purpose: 'main'` DID.
So the way to control it is to control the `purpose` rows via `voice_number_update`:

- Exactly ONE number should carry `purpose: 'main'` per presented identity. Two `main` rows
  make the default the OLDER one by creation date, which is how an owner's personal first-bought
  number ends up presented by every unassigned rep.
- Flipping a company number to `main` is refused with `422 number_in_pool` while it still
  rotates between website visitors - remove it from the pool first (see `call-tracking-dni.md`).
- After changing `purpose` rows, re-verify with a test call from an unassigned seat: the default
  is baked into the phone system out-of-band, and the call log (`from_e164`) is the proof it
  moved.

## 2. The tools

### Reading: `voice_extensions_list` is the only full read

`voice_extensions_list` returns whole extension rows and is **the only read of the caller-ID
columns**. `voice_extension_get` is a narrow select that OMITS both `outbound_caller_id_number_id`
and `outbound_caller_id_anonymous` (and the forward target and voicemail state) - it can never
tell you what a seat presents. Audit with the list, always.

### Writing: `voice_extension_update`

The caller-ID fields, with the traps its registered description documents:

- `outbound_caller_id_number_id` must be a DID owned by this account and active, else
  `422 invalid_caller_id`. A toll-free DID is `422 toll_free_caller_id` (the check recognizes
  NANP +1 8xx only, so a non-US toll-free is not caught - do not set one). `null` means fall
  back to the account default.
- `outbound_caller_id_anonymous: true` presents CLIR ("Blocked") and WINS over the number id.
  Trap: it also SKIPS the ownership check entirely, so a number id sent alongside it is written
  unchecked (another tenant's id is stored on the row; a nonexistent id dies as an unhandled 500
  with nothing saved). Never send both.
- **ALWAYS READ `warning`.** The row saves locally first; every PBX push is best-effort. A 200
  with a warning means the database and the phone system now disagree; re-saving is the retry.
- **The silent no-op**: the caller-ID push only happens when the row already has a PBX uuid, and
  that path adds NO warning - a caller-ID-only save on a never-provisioned extension returns
  clean and changes nothing on the phone system. Verify a seat is provisioned
  (`voice_extension_status` reads registration state) before trusting the write.
- Changes are carrier-facing on EVERY future outbound call from that seat, and this surface
  writes with the API key as the only gate. One extension per confirmation.

Verify after: re-read `voice_extensions_list` (the update response does echo the caller-ID
columns, but the list is the audit view), and ideally one test call checked against
`voice_calls_list` `from_e164` - the softphone path can lag the click-to-call path.

### The name: `voice_number_cnam_set`

The caller-ID NAME lever, covered in full in `numbers-and-e911.md` section 7. The facts that
matter here: 15 characters, letters/numbers/spaces; accepted is not live (12-24h typical, up to
72); toll-free refused; a ported row with no `provider_number_id` answers `422 not_provisioned`
with a literally false message. An unregistered number shows bare digits AND is far likelier to
be labeled spam - which makes CNAM step one of the reputation ladder (section 5).

### Placing a call: `voice_call_originate`

Click-to-call: **rings the rep's extension FIRST, and only bridges to the destination once the
rep answers** - the customer's phone never rings for an unanswered originate. `from_extension_id`
is REQUIRED in the body (an API key has no person behind it, so the tool cannot infer whose
extension rings). It bills real minutes on both legs and counts toward the daily toll-fraud cap
(`voice_toll_fraud_state` shows today's spend against it; an over-cap tenant has outbound killed
by design).

Guardrails carried from its session twin:

- **Browser softphone extensions are refused** (`409`) - the originate-then-bridge flow is for
  desk phones and mobile softphones; a browser user dials directly from the dock. So are
  `external_number` forward shells (no SIP registration; an originate against one rings nothing).
- The outbound BLOCKLIST is enforced: dialing a blocked number is a 403 with the block's reason.
- **An anonymous-set extension is refused** (`409`) rather than silently disclosing a real
  number: this path cannot express CLIR, and falling through would present a number for someone
  who explicitly chose to be withheld.
- Caller-ID pick order: an explicit override (must be an active, owned DID) -> the extension's
  own assignment -> a local-presence match (an owned DID sharing the destination's NANP area
  code, tracking and pool numbers excluded) -> the oldest `main` -> any active DID -> `409` with
  no number to present. Tracking DIDs are never presented: a callback to one lands unrouted and
  pollutes attribution.

## 3. What the callee sees: the full chain

Number (caller ID) -> name (CNAM) -> label (carrier analytics). The platform controls the first
two. The third - "Spam Likely", "Potential Spam", "Scam Likely" - is applied by carrier analytics
vendors at Verizon/T-Mobile/AT&T, and the platform can only influence it (section 5). STIR/SHAKEN
attestation (the cryptographic "this caller owns this number" signature) is carrier-side;
presenting only owned DIDs is the platform's half of it, attestation level is the carrier's.

## 4. SMS sender resolution (which number a text goes from)

A different resolver from calls, with its own rules - verified against the send path:

- **A send composed by a person resolves the SENDER's assigned DID first**: the oldest of their
  extensions carrying an assignment. The assignment is re-validated on every send (still owned,
  still active, and a toll-free DID must be VERIFIED); any failure silently degrades to the
  account pick rather than blocking the rep.
- **A service-key or automation send has no person behind it**: it uses the account pick -
  `purpose: 'main'` first, then the oldest active DID, local plus verified toll-free only,
  fail-closed - unless an explicit `from_e164` is passed. So the same wording sent by a rep and
  by an automation can leave from two different numbers, correctly.
- **An explicit `from_e164` is never overridden** - and note `voice_sms_send_to_contact` checks
  it for ownership but NOT toll-free verification, so an unverified TF sender clears the 403 and
  dies inside the send as a 502. Omitting `from_e164` is safer.
- **Existing threads NEVER move to a new DID, and that is correct.** A conversation stays on the
  number the customer has been talking to - switching mid-thread reads as a different person and
  starts a second thread on their handset. Do not "fix" a thread's sender; the customer texts
  the number they have.
- `outbound_caller_id_anonymous` is IGNORED for SMS - there is no CLIR for texting; a text must
  carry a real sender.

The practical consequence: assigning a rep's caller ID (section 2) also moves their future NEW
text threads onto their number - old threads stay put by design.

## 5. The reputation ladder ("we show up as Spam Likely")

**"Spam Likely" is usually an UNREGISTERED number, not earned behavior.** Carrier analytics
label unregistered numbers by default. The documented case: a number with 46 outbound calls over
three months, 11 distinct destinations, and a 78% answer rate - model behavior - labeled
"Potential Spam" purely because no CNAM was ever registered. Check the behavior data first
(`voice_calls_list`: volume, answer rate, destinations) so you can tell the client which case
they are in, then climb:

1. **CNAM registration - the in-platform lever.** `voice_number_cnam_set` per local DID. This is
   the single highest-leverage tool call: registered name plus registered identity drops the
   default-spam labeling on the major analytics vendors. Allow 12-72h, and remember accepted is
   not live.
2. **The Free Caller Registry - the highest-impact EXTERNAL step.** One submission at
   freecallerregistry.com covers the analytics vendors behind Verizon, T-Mobile, and AT&T. It is
   a human-filed web form (business identity, numbers, use case) - no tool files it. File a
   `pm_tasks_create` naming the numbers and the form, assigned to a human.
3. **STIR/SHAKEN attestation - carrier-side.** The platform's part (presenting only owned DIDs)
   is already enforced. Full A-attestation is between the platform and its carrier; if a client
   pushes past steps 1-2, that is a support conversation, not a tool call.
4. **Behavior, last.** Only after registration does behavior dominate: sustained high-volume
   short-duration outbound with low answer rates earns labels honestly. If the data in step 0
   showed genuine spam-pattern calling, no registry fixes that - the calling pattern does.

Re-check with the client a few days after steps 1-2; labels lift asynchronously and there is no
read-back API for carrier analytics.

## 6. Plays

### Play: "set every rep's caller ID"

1. `voice_extensions_list` - the full roster with both caller-ID columns. `voice_numbers_list`
   for the assignable DIDs (active, local; never tracking/pool numbers, never unverified TF).
2. Build the map: rep -> DID. Fewer DIDs than reps is the NORMAL case - most seats will share,
   so the plan must also name what UNASSIGNED seats present (the account default = the oldest
   `main`; if that resolves to someone's personal line, fix the `purpose` rows first via
   `voice_number_update` - see `numbers-and-e911.md`).
3. Show the human the complete before/after table - every extension, current value, proposed
   value. Get an explicit yes on THAT table.
4. One `voice_extension_update` per extension, `outbound_caller_id_number_id` only, reading
   `warning` on every response. Never batch; a mid-run failure with a warning is a stop-and-report.
5. Verify: re-read `voice_extensions_list`; then one test call from an updated seat, checked
   against `voice_calls_list` `from_e164`. If the click-to-call number is right and the
   softphone's is wrong (or vice versa), report the divergence - two paths, one stale, is a
   platform-side sync issue a human must chase, not a re-save loop.
6. Note the SMS side effect out loud: these reps' NEW text threads now start from their assigned
   numbers; existing threads stay on the old number by design.

### Play: the Spam-Likely response ladder

1. Identify the labeled number(s) by digits, and which carrier's handsets show the label (it is
   per-analytics-vendor - Verizon-only labeling is common).
2. Pull the behavior data: `voice_calls_list` for that number - outbound volume, answer rate,
   distinct destinations. Tell the client whether this looks default (unregistered) or earned.
3. Read the current registration: `voice_number_get` for the CNAM mirror (`cnam_name`,
   `cnam_enabled`). Unregistered is the expected finding.
4. Register: `voice_number_cnam_set` with the business name (15 chars, plain), one number per
   confirmation. State the 12-72h propagation and that accepted is not live.
5. File the Free Caller Registry submission as a `pm_tasks_create` for a human, listing every
   affected number.
6. If the number was recently purchased, say so: recycled inventory carries the prior owner's
   baggage, and registration is still the fix.
7. Set expectations in writing: labels lift over days, there is no status API, and the check is
   a real handset on the affected carrier. If labels persist past two weeks with clean behavior
   data, escalate to a human for the carrier-support (STIR/SHAKEN) conversation.

### Play: "withhold my number" (CLIR / anonymous)

1. Confirm the intent with the human first: anonymous outbound calls get answered less, some
   carriers and callees auto-reject them, and it applies to EVERY future call from that seat,
   not one call. Often the real ask is "stop showing my personal number", which the assignment
   play solves better.
2. `voice_extension_update` with `outbound_caller_id_anonymous: true` and NOTHING else in the
   body - never alongside `outbound_caller_id_number_id` (the anonymous flag wins AND skips the
   ownership check on the number id, so the pair writes an unvalidated id or dies as a 500).
3. Read `warning`; re-read `voice_extensions_list`.
4. Set expectations on the paths: the softphone/desk-phone path is where CLIR applies;
   click-to-call REFUSES an anonymous seat (`409`) rather than disclosing a number - the rep
   places withheld calls from their phone, not from the CRM button. SMS ignores the flag
   entirely - a text always carries a real sender.
5. Verify with a test call to a real handset before telling the rep they are withheld - a
   silently failed withhold is a privacy incident, not a cosmetic bug.
6. To undo: `voice_extension_update` with `outbound_caller_id_anonymous: false` (and the number
   assignment, in a SEPARATE call).

## 7. Pitfalls

- **Auditing caller ID with `voice_extension_get`.** It omits both columns. Only
  `voice_extensions_list` shows them.
- **Sending `outbound_caller_id_anonymous: true` together with a number id.** Anonymous wins,
  and the number id is written UNCHECKED - or the call dies as a 500.
- **Trusting a clean 200 on a caller-ID save.** Best-effort push, and the never-provisioned
  extension case adds no warning at all. Verify by list read plus a test call.
- **Setting a toll-free DID as caller ID.** Refused for 911 reasons; and the check only knows
  NANP 8xx, so a non-US TF slips through - do not do it manually either.
- **Assigning a tracking or pool DID.** Callbacks land unrouted and attribution corrupts. The
  originate path refuses to auto-pick them; do not hand-pick one.
- **"Fixing" an old SMS thread onto the rep's new number.** Threads are sticky by design; the
  customer texts the number they have.
- **Promising Spam-Likely removal on a date.** Registration is the lever; propagation and label
  removal are asynchronous and unobservable by API.
- **Treating "Spam Likely" as proof of bad behavior.** Usually it is an unregistered number.
  Check the answer-rate data before lecturing a client about calling patterns.
- **Using `voice_call_originate` for a browser-softphone-only user.** Refused by design - the
  browser dock dials directly.

## 8. Diagnosis quick reference

| Symptom | First move |
|---|---|
| "The wrong number shows when I call out" | `voice_extensions_list` for the seat's assignment; unset = account default (oldest `main`). Then `voice_calls_list` `from_e164` to see what was actually presented |
| Same rep presents two different numbers | Two paths disagree (softphone vs click-to-call). Report the divergence with the call-log evidence - platform-side sync, human chase |
| Assignment saved but the phone still presents the old number | Read the update's `warning`; no warning + never-provisioned extension = the silent no-op. Check registration via `voice_extension_status`, re-save |
| `422 invalid_caller_id` | The DID is not owned by this account or not active - `voice_numbers_list` |
| `422 toll_free_caller_id` | By design. Pick a local DID |
| Callee sees "Blocked" unexpectedly | `outbound_caller_id_anonymous` is set and wins over the number id - `voice_extensions_list` |
| "Spam Likely" on client's number | The ladder: behavior data -> CNAM mirror -> `voice_number_cnam_set` -> Free Caller Registry task |
| Callers see digits, no business name | CNAM never registered, or still propagating (12-72h) - `voice_number_get` mirror first |
| Texts go out from the owner's number | Sender resolution: rep has no assigned DID (or it failed re-validation) so the account pick fired. Assign via `voice_extension_update` |
| A thread keeps using the old number after reassignment | By design - existing threads never move. Only NEW threads use the new sender |
| Click-to-call refuses to dial | Blocklist 403 (reason attached), anonymous 409, browser-softphone 409, or no presentable DID 409 - each error names its fix |
| "Why are outbound calls rejected?" | `voice_toll_fraud_state` - the daily cap is a guard working, not an outage |
