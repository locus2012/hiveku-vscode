# Reference: Numbers and E911 (the DID inventory, buying, configuring, retiring)

This file covers the account's phone numbers (DIDs): what a number row actually is, searching
carrier inventory, registering the emergency address, buying, configuring, naming (CNAM), and the
one irreversible act on this surface - giving a number back to the carrier. Load it when a client
says "buy us a local number", "we need an 800 number", "why is this number inactive?", "get rid of
that old number", "the wrong name shows when we call people", or when a diagnostic reports DIDs
missing E911.

Money and irreversibility first, because both live here:

- **`voice_number_release` is the only permanently destructive tool in the whole voice surface.**
  No undo, no grace period, no confirmation argument. The number can be resold to a stranger.
  Treat it like deleting a production database.
- **Buying a number is recurring money** (a monthly carrier charge plus the tenant's platform
  billing), and a purchase that answers 202 is COMMITTED at the carrier even though nothing looks
  finished. Never re-buy on an ambiguous answer.
- **`voice_e911_address_create` decides where an ambulance goes.** A wrong suite number on the
  registered address is a public-safety failure, not a data-quality nit.
- **Every `voice_numbers_search` call is a billed carrier API request.** Do not loop it.

## Availability

Every tool below resolves on this server today. A name that does not resolve on your key is a
profile question first: check the key's profile, then the hiveku-communications reachability
ladder, then hand off with a precise dashboard step filed via `pm_tasks_create`. Never tell the
user the capability does not exist, and never invent a name.

| Tool | Status |
|---|---|
| `voice_numbers_list` | LIVE |
| `voice_number_get` | LIVE |
| `voice_numbers_search` | LIVE |
| `voice_number_update` | LIVE |
| `voice_number_cnam_set` | LIVE |
| `voice_number_release` | LIVE |
| `voice_number_lookup` | LIVE |
| `voice_e911_addresses_list` | LIVE |
| `voice_usage_get` | LIVE |
| `voice_diagnose_setup` | LIVE |
| `voice_e911_address_create` | LIVE |
| `voice_number_purchase` | LIVE |
| `voice_number_orders_list` | LIVE |

---

## 1. The mental model: what a number row is

One `voice_numbers` row per DID the account owns. The fields that drive everything else:

- **`e164`** - the number itself, and the join key for call logs, SMS threads, and DNI sessions.
- **The routing target** - `inbound_target_type` (`extension | ring_group | queue | ivr | ai_agent
  | voicemail`) plus `inbound_target_id`. This pair is what the PBX side is built from, and the PBX
  push is best-effort: the row can describe a route FreeSWITCH never received. `is_active: true`
  does NOT mean calls arrive.
- **The E911 pointer** - `e911_address_id`, referencing a row in the account's E911 address list.
  A LOCAL number cannot activate without one (RAY BAUM's Act, enforced server-side on both create
  and update). Toll-free numbers never carry one - not E911-capable at the carrier.
- **`purpose`** - `main | tracking | did_pool`. `main` is the business line and the account-default
  caller ID and SMS sender; `tracking` and `did_pool` are attribution numbers that must never be
  presented as caller ID or handed out as the business's number. Old rows may carry the legacy
  spelling `pool` for `did_pool`.
- **`provider_number_id`** - the carrier's own id for the number. NULL on a half-provisioned row
  and on some ported-in rows whose adoption has not completed (or that predate the porting-v1
  adopter). A NULL here blocks `voice_number_cnam_set` with a misleading error (section 7).
- **Pool membership is NOT on this row.** A pooled DID's routing, whisper and greeting are also
  configured on its pool, and a per-number value can silently beat the pool page that claims to
  own it. Check `voice_pools_list` before reasoning about a tracking number's behavior.

`voice_numbers_list` is the inventory read (filter by `is_active` - note soft-released rows still
appear until you filter). `voice_number_get` returns the ENTIRE unprojected row when you need the
detail: routing, E911, CNAM mirror, greeting/whisper state, toll-free verification status.

## 2. Local vs toll-free: two different products

| | Local DID | Toll-free DID (+1 833/844/855/866/877/888) |
|---|---|---|
| E911 | HARD GATE - cannot activate without a registered address | Not E911-capable. The gate is SKIPPED, not failed - a TF number with no E911 address is fully compliant |
| CNAM caller-ID name | `voice_number_cnam_set` works | Refused - `422 cnam_not_applicable_toll_free`. CNAM is a geographic-number registry |
| Caller ID for calls | Allowed | Refused on extensions (`422 toll_free_caller_id`) - a 911 call would present a number with no dispatchable address |
| Inbound voice cost | Baseline | Roughly 4.7x the carrier cost. Platform pricing: 500 cents/month per TF DID plus a 3 cents/minute inbound surcharge from minute one |
| SMS | Needs 10DLC registration (see `tendlc-and-toll-free.md`) | Needs TOLL-FREE VERIFICATION - carriers hard-block unverified TF senders industry-wide, and the platform's send paths refuse or skip unverified TF numbers |
| 800 prefix | n/a | UNPURCHASABLE platform-wide, at every layer (premium carrier pricing, deliberately blocked). Do not promise a 1-800 number |
| 822 prefix | n/a | Reserved-but-unassigned NPA, excluded from the platform's toll-free set on purpose - a +1822 DID is invisible to the TF tooling |

The toll-free NPA set everywhere on this platform is exactly: 800, 833, 844, 855, 866, 877, 888.

### The `dids_without_e911` count is inflated by toll-free

`voice_diagnose_setup` reports `dids_without_e911` and a matching `blocking_issues` string with NO
toll-free filter. Every compliant toll-free number inflates the count and reads like a live
compliance problem. Before reporting DIDs missing E911 as a blocker, cross-check with
`voice_numbers_list` and subtract the +18xx set. If every number in the count is toll-free, there
is no blocker - say so, and say the count is a known gap in the diagnostic. Report it only for the
LOCAL numbers that remain.

---

## 3. Searching inventory: `voice_numbers_search`

Search only. It places no order, RESERVES NOTHING, and spends no money - a listed number is still
on the open market and another buyer can take it between this call and any purchase. Each call is
one outbound billed carrier API request, so never loop it to page through inventory: there is NO
cursor and NO pagination, and `limit` (1-50, default 20) is the entire result set you can ever get.

Result shape: `{ results: [{ e164, locality, state, monthly_cost_cents, setup_cost_cents,
features, number_type }] }`. `locality`, `state`, and both cost fields can each be null.
`monthly_cost_cents` is a RECURRING carrier charge and `setup_cost_cents` a one-time one (nonzero
on premium prefixes) - a shortlist handed to a human carries real cost. A result without `sms` in
`features` cannot text; check before shortlisting a number the client wants for texting.

Refusals, all deliberate:

- `422 missing_filter` - a LOCAL search must name at least one of `area_code` (exactly three
  digits, no +1), `locality`, or `state` (two letters; the route uppercases for you).
- `422 invalid_body` - `number_type: 'toll_free'` combined with any geographic filter (toll-free
  inventory is non-geographic), or `toll_free_prefix` under local mode.
- **800 cannot be searched at all** - deliberately missing from the prefix enum.

**The trap that is not a client error:** `503 voice_server_update_pending` on a toll-free search
whose results are not all toll-free. That is a deploy-window guard: a voice server predating
toll-free support would run a LOCAL search and hand back geographic numbers, and buying one of
those as toll-free lands a local DID with NO E911. The builder auto-deploys in about 35 minutes
while the voice server is a manual deploy, so this window is real. Retry later; never fall back to
a local search and call it toll-free.

An empty `results` array on a 200 means no matching inventory, not a failure.

## 4. E911 addresses

**`voice_e911_addresses_list`** lists the account's E911 addresses - registered AND pending
verification, in one list. Pending is not registered: only a row that carries a carrier
registration can gate a number's activation (`voice_number_update` refuses an address with no
carrier registration as `422 e911_address_invalid`). Read the rows, not just the count.

**`voice_e911_address_create`** registers a new dispatchable address with the carrier.
What its session-route twin enforces, carried to the tool:

- The address is CASS-validated SYNCHRONOUSLY at the carrier during the call, and the two
  failure shapes mean different things: `422 e911_validation_failed` is the carrier REJECTING
  THE ADDRESS (its message says why - fix the address, never resubmit it verbatim), while
  `502 e911_validation_failed` is any other carrier failure and says nothing about the address
  (the carrier may simply be down - the one case that is safe to retry unchanged). Nothing is
  persisted on either.
- On success the row is written with the carrier's address id and is immediately usable as an
  `e911_address_id` on purchases and updates.
- Body: `label`, `street`, optional `street2`, `city`, `state` (2 letters), `postal_code`,
  `country` (default US).
- **This is where 911 dispatches.** The registered address is the street address emergency
  services are sent to when anyone dials 911 from a number pointing at it. Suite and floor go in
  the address, and they must be RIGHT. Confirm the exact address with a human before registering;
  read back what you registered afterward.
- **No dedupe.** Every call creates a new row. Re-running a create because the response was slow
  mints duplicate addresses. Check `voice_e911_addresses_list` first, and after any ambiguous
  outcome, before retrying.

One address can serve many numbers - an office's DIDs all point at the same row. A number's
address changes via `voice_number_update` (`e911_address_id`), which is itself a carrier write
(section 6).

## 5. Buying: `voice_number_purchase` and `voice_number_orders_list`

**Buy by `e164`, never by `search`.** The tool accepts a `search` object, but when you send it
the route pins the carrier search to ONE result and BUYS THE FIRST MATCH sight unseen - you
never see candidates and cannot echo the exact number to the human first. Shortlist with
`voice_numbers_search`, get the yes on a specific e164 and its costs, then pass that `e164`.

**`voice_number_purchase`** searches-and-orders or orders an explicit `e164` in one
call. Money moves here. What the session twin enforces, in the order it enforces it:

**The E911 hard gate, before anything else.** A local purchase without `e911_address_id` is
`422` at the schema. The address must belong to this account and carry a carrier registration
(`422 e911_address_invalid` otherwise). Toll-free is the mirror image: providing an
`e911_address_id` on a TF purchase is an honest `422 e911_not_applicable_toll_free`, never a
silent ignore. So the working order is always: `voice_e911_addresses_list`, create the address if
missing, THEN buy.

Other refusals, all before money moves:

- `+1800...` as an explicit `e164`, or `800` as a prefix: refused at every layer
  (`premium_800_not_purchasable`).
- Toll-free search combined with geo filters: `422`. `sms_campaign_id` on a TF purchase:
  `422 toll_free_not_10dlc` (TF texting is toll-free verification, not 10DLC).
- `pool_id` not owned by this account: `404 pool_not_found`. A `pool_id` forces
  `purpose: 'did_pool'` and makes the server own the pool join.
- An explicit `e164` with history on ANOTHER workspace: `409 number_unavailable` - before the
  carrier is touched.
- An `inbound_target_type`/`inbound_target_id` naming a missing or unprovisioned target:
  `422 target_not_found`. A `voicemail` inbound target is `501` (not wired yet).

**The 202 trap - the one that costs money when misread.** A purchase can answer
`202 number_order_pending`. Because the proxy delivers 2xx bodies as success results, **this
arrives as a SUCCESS payload that carries an `error` key** (`error: 'number_order_pending'`,
usually with an `order_id`). It is NOT a failure and NOT a no-op: **the order is COMMITTED at the
carrier** - routine for non-quickship toll-free, which can take up to two business days to
activate. A `voice_number_orders` row is parked and a poll cron finishes the adoption when the
carrier activates the number. The correct response to a 202 is: report the order as pending, watch
it with `voice_number_orders_list`, and **never re-buy** - a second purchase is a second committed
carrier order for a second number.

**`voice_number_orders_list`** reads those parked orders: `status` runs
`pending -> complete | failed | expired`. `complete` is stamped only AFTER the adoption write
succeeds - never before - so a `pending` order with a live number at the carrier just has not been
swept yet. `expired` means the poll gave up after days of attempts (it polls the carrier one last
time before expiring); an expired order with money spent is an ops escalation, not a retry.

**Not idempotent, one at a time.** There is no idempotency key anywhere in the purchase path. Two
identical calls are two numbers and two recurring charges. Buy exactly one number per confirmed
human decision; "buy 20 numbers" is a hard stop in SKILL.md.

**Recycled numbers carry baggage.** Carrier inventory is recycled: a freshly bought DID can carry
the prior owner's reputation - spam labels on carrier analytics, recipients who blocked it, and
people who texted STOP to its previous owner. Within Hiveku, a number with history on another
workspace is refused outright (`409 number_unavailable`); at the carrier there is no such check.
If a client's brand-new number shows "Spam Likely" on day one, this is why - go straight to the
reputation ladder in `caller-id-and-reputation.md`.

**What a purchase costs.** The carrier's charges are what `voice_numbers_search` showed
(`monthly_cost_cents` recurring, `setup_cost_cents` one-time). The tenant's platform bill is
per-DID monthly (toll-free at 500 cents/month plus the 3 cents/minute inbound surcharge). State
the recurring cost before asking for the confirmation.

## 6. Configuring: `voice_number_update`

CHANGES A LIVE PHONE LINE. Editing `inbound_target_type`, `inbound_target_id`,
`inbound_ai_department` or `forward_to_e164` rewrites the PBX inbound route - the very next
inbound call rings somewhere else. Editing `e911_address_id` calls the carrier and changes where
emergency services dispatch. Editing `greeting_message` or `whisper_message` with a voice id
renders new audio, which costs money per render (hash-compared, so unrelated edits do not
re-render).

The traps its registered description documents, the ones that actually bite:

- **The PBX push is best-effort and its failure is SILENT.** A failed push is console-logged and
  the route still answers 200 with the new row - Hiveku shows one route while FreeSWITCH rings the
  old target. The same clean 200 comes back when the account has no voice tenant row at all. A TTS
  failure is swallowed the same way (callers hear a robotic fallback). After a routing change,
  verify by behavior (a test call) or hand verification to a human; the 200 is not proof.
- **The response is captured BEFORE the audio render and BEFORE the PBX push** - audio-cache
  fields in the reply are stale on any call that rendered. Re-read with `voice_number_get`.
- **Clearing E911 silently no-ops**: a null `e911_address_id` is coerced to "no change" and
  answers 200 having ignored the key.
- **Half-applied patch**: if the carrier rejects an `e911_address_id` change you get
  `502 e911_carrier_sync_failed` and ONLY that column rolls back - every other field in the same
  call is already committed. Another reason to make one-field changes.
- Refusals that protect you, all before any write: `422 e911_required` (activating a local DID
  with no address), `422 e911_not_applicable_toll_free`, `422 e911_address_invalid`,
  `422 inbound_target_unroutable` (the target is missing, foreign, or has no dial extension -
  without this the route would be silently released), `409 managed_by_pool` (the pool actually
  manages those fields - listed in the error), `422 number_in_pool` (setting `purpose: 'main'` on
  a number still rotating between website visitors).
- `is_active: false` is the REVERSIBLE way to take a number out of service (section 8). On an
  active number it FIRST takes the DID off every extension presenting it as caller ID, on the PBX
  as well as in Hiveku (each falls back to the account's default caller ID; one set to hide its
  caller ID stays hidden). It is fail-closed and runs after the refusals above: if the phone
  system does not accept the change for any extension, the call is `409 caller_id_clear_failed`
  and NOTHING in the patch is written, every other field sent with it included - the number
  stays active. What to do with that 409 is in section 8.
- The body is strict: `cnam_name`/`cnam_enabled` are NOT settable here (`voice_number_cnam_set`
  is), and an unknown key is a 422 that writes nothing.
- **No audit row.** A routing change made through this tool leaves no entry on the voice audit
  page. Tell the human exactly what you changed.

## 7. Naming: `voice_number_cnam_set`

Writes the caller-ID NAME to the carrier's national CNAM databases - every person this tenant
calls sees it on their handset once it propagates. It costs no per-use money but changes how the
business is identified to the public, and it is not instantly reversible (clearing is a second
carrier write with the same delay).

- **Format**: max 15 characters, letters/numbers/spaces only (no ampersand, no punctuation, no
  accents). `enabled: true` with a blank name is `422`. The carrier routinely returns the stored
  name UPPERCASED - the stored value differing in case from what you sent is normal.
- **Accepted is not live.** `cnam_updated_at` stamps carrier ACCEPT, not handset visibility.
  Propagation is typically 12-24 hours, up to 72. Never report the name as live off that
  timestamp.
- **Toll-free is refused**: `422 cnam_not_applicable_toll_free`.
- **`422 not_provisioned` with a false message**: a row with no `provider_number_id` cannot
  register CNAM. On a PORTED number this error's wording is literally false - the number IS live
  at the carrier; it is Hiveku's row that is incomplete (adoption not finished, or a legacy
  ported row). Point the human at the port-order adoption state (see `porting.md`), do not tell
  them their live number is unprovisioned.
- **A 502 is not proven a no-op**: `502 cnam_failed` usually means carrier-rejected with nothing
  persisted, but the same 502 covers a landed write whose response was lost. Verify with
  `voice_number_get` before retrying.
- **No audit row** (service-key writes have no builder profile), and worth doing anyway:
  an unregistered number shows bare digits, and carrier analytics are far likelier to label it
  "Potential Spam". CNAM is one of the few reputation levers a tenant controls - the full ladder
  is in `caller-id-and-reputation.md`.

## 8. Retiring: `voice_number_release` - the hard stop

PERMANENTLY GIVES THE NUMBER BACK TO THE CARRIER. Irreversible: no undo, no grace period, no
confirmation argument in the API. The DID returns to carrier inventory, CANNOT be re-bought, can
be sold to a stranger, and every place it is printed stops working - vehicle wraps, business
cards, signage, the Google Business listing, ad call extensions, email signatures. **Only ever
call it after a human has explicitly confirmed this exact number, by digits.** "Get rid of the
old numbers" (a pattern, a plural) is a refusal per SKILL.md's hard stops - enumerate, confirm
each by digits.

What its registered description warns about, verbatim where it matters:

- **`released: false` on a 200 is a real failure state**: the flag is echoed straight from the
  voice server and the local row is deleted REGARDLESS of its value. A 200 carrying
  `released: false` means Hiveku has forgotten a number the carrier may still own and still bill
  for, with no local row left to retry from. Check `released` on every response.
- **Caller ID first, fail-closed.** Before anything else - on a row with no `provider_number_id`
  too - the handler takes the DID off every extension presenting it as caller ID, on the PBX and
  in Hiveku. If the phone system does not accept that for any extension, the answer is
  `409 caller_id_clear_failed` and NOTHING else runs: no route release, no pool change, no
  carrier call, the row untouched, the number still taking calls. Handling is below.
- **Partial teardown after that, none rolled back**: BEFORE the carrier call, the handler releases
  the PBX inbound route and deletes the number's DNI pool membership. A `502 release_failed`
  leaves the local row intact but the number is already out of its pool, off every caller ID, and
  NOT taking inbound calls. Retrying is the only way forward.
- **No dependency guard.** The only 409 is `caller_id_clear_failed`, and that is about the phone
  system accepting the caller-ID change, not about what depends on the number. Nothing checks
  whether this is the account's only DID, its `main` business line, a tracking campaign's
  destination, a pool's last member, or a workflow dependency. YOU do those checks (the retire
  play, below).
- **`soft` is NOT a dry run**: the carrier release happens either way; `soft` only keeps the row
  for audit (`is_active: false`, provider id nulled). And it must be the exact STRING `'1'` - a
  boolean `true` serializes as `'true'` and silently takes the HARD DELETE path.
- A row with no `provider_number_id` releases locally only (`released: false`, nothing sent to
  the carrier).
- **No audit row.** A permanent release leaves no entry on the voice audit page.

**When the answer is `409 caller_id_clear_failed`** (from a release, or from `voice_number_update`
with `is_active: false`):

- Nothing was released or deactivated. Say so plainly; it is not a partial success.
- The route's body arrives under `details`. `message` is a plain sentence naming the stuck
  extensions - show it to the human as it is. `failed_extensions` is `[{ extension, reason }]`.
  The extensions in `cleared_extensions` already stopped presenting the number and stay that way.
- A reason of `not attempted: the phone system is unreachable` means the PBX was down and the
  remaining extensions were not tried. `voice_tenant_healthcheck` goes through the same phone
  system, so a normal answer from it is the signal to retry.
- Retry the same call once the phone system is reachable. Only the stuck extensions are tried
  again.
- **Never work around it** by pointing those extensions at another number with
  `voice_extension_update` while the PBX is down. That save records the new number in Hiveku before
  its PBX push and only warns when the push fails, so the next release no longer finds the
  extension and goes through while the PBX still presents the number. That extension then shows a
  number the account no longer owns: its calls fail STIR/SHAKEN attestation, and once the carrier
  re-sells the number the tenant is spoofing a stranger.
- **Known limit**: the check finds extensions by Hiveku's record of which number each one
  presents, not by what the PBX holds. An extension whose caller ID was changed while the PBX was
  unreachable can still present this number without being found. That is why the retire play runs
  `voice_tenant_healthcheck` while the number is still active, before the deactivate: its
  `extension_caller_id_matches_builder` check is what shows an extension presenting a different
  number on the PBX than in Hiveku, and it stops looking once the account has no active number.

**The reversible alternative, and the default recommendation:** `voice_number_update` with
`is_active: false`. The DID stays owned, inbound stops, caller-ID references are cleared, and the
decision can be unwound. Prefer it, and wait a billing cycle before the real release - the calls
that were still arriving at the "dead" number show up in that window. If a release may follow,
run the retire play's caller-ID check (step 3) before deactivating, while the number is still
active.

## 9. Who is this number: `voice_number_lookup`

Resolves a raw phone number to a CRM contact for an in-call contact card:
`{ contact: { id, name } | null, last_call_at }`. It is a phone-number-to-identity oracle scoped
to the account - treat the result as PII. What its registered description warns:

- Matching is last-7-digits contains, deliberately looser than the screen-pop matcher: two
  numbers sharing their final seven digits resolve to the same contact, duplicates resolve to
  whichever is seen first, and soft-deleted contacts never resolve - an archived customer reads
  as no match.
- Malformed input is indistinguishable from a miss: fewer than 7 digits answers a clean 200 with
  nulls, never a 400. A stored number with an extension suffix ("555-1234 x99") can match the
  filter and still resolve to `contact: null`.
- `last_call_at` is the newest call touching that 7-digit tail, either direction, ANY
  disposition - an unanswered outbound attempt sets it, and it can come from a different number
  sharing the tail. It is not evidence of a conversation.
- Only `id` and `name` come back; anything richer needs a CRM tool.

## 10. What `voice_usage_get` honestly tells you

A usage snapshot for the CURRENT UTC month with counters that are not what they look like. In
this build the only writer of the usage row is TTS billing: **`tts_cents` is live and is the one
number that tracks real spend.** `minutes_used` 0 beside hours of real calls is the norm;
`period: null` does not mean zero calls (it means no TTS render created the row this month);
`minutes_included` 0 records a create-time constant, never the plan. Use `voice_recent_calls` or
`voice_calls_list` for real call volume. And `limits.voice_daily_outbound_cap_cents` here is a
DIFFERENT column from the cap the toll-fraud guard enforces - quote `voice_settings_get` or
`voice_toll_fraud_state` for the enforced ceiling, never this field.

---

## 11. Plays

### Play: buy a local number for an office

1. `voice_e911_addresses_list` - does a registered address for this office exist? If not, confirm
   the EXACT street address, suite included, with the human ("this is where 911 will send help"),
   then `voice_e911_address_create` and read back the created row.
2. `voice_numbers_search` with the office's `area_code` (or `locality`/`state`) - once, with a
   sensible `limit`. Shortlist 3-5, with `monthly_cost_cents`/`setup_cost_cents` stated and
   `features` checked against what the client needs (`sms` if they will text).
3. Human picks one, by digits. State the recurring cost and get the explicit yes on THAT number.
4. `voice_number_purchase` with the explicit `e164`, the `e911_address_id`, a `label`, `purpose`
   (`main` for a business line), and the routing target if it already exists (a missing target is
   a clean 422, not a silent misroute).
5. Read the response. A 200 with the number row: verify with `voice_number_get`, then place or ask
   for a test call - the PBX push is best-effort. A 202 `number_order_pending`: the order is
   committed; report it, watch `voice_number_orders_list`, and do NOT buy again.
6. If the number will text: 10DLC campaign assignment (`tendlc-and-toll-free.md`).

### Play: buy a toll-free number and get it texting

1. No E911 in this play - omitting the address is correct, providing one is a 422. Skip straight
   to `voice_numbers_search` with `number_type: 'toll_free'` and NO geo filters. Prefix via
   `toll_free_prefix` (833-888; 800 does not exist here and cannot be promised).
2. Watch for `503 voice_server_update_pending` - the deploy-window guard. Retry later; never
   substitute a local search.
3. State the pricing BEFORE the confirmation: 500 cents/month for the DID plus 3 cents/minute on
   every inbound minute from minute one - a national client at serious inbound volume is real
   money.
4. `voice_number_purchase` with the chosen `e164`. No `e911_address_id`, no `sms_campaign_id`
   (both are 422s on TF). Expect 202 more often than on local - non-quickship TF activation takes
   up to two business days; watch `voice_number_orders_list`.
5. **The number cannot text yet.** Carriers hard-block unverified toll-free senders industry-wide,
   the platform's send paths refuse or skip unverified TF numbers, and verification is a
   per-number carrier application (EIN, opt-in evidence, typically 1-2 weeks). The whole lane -
   submission, status, the overwrite trap on resubmission - lives in `tendlc-and-toll-free.md`.
   Check state any time with `voice_sms_toll_free_verification_get`.
6. Do not set a TF number as anyone's caller ID (`422 toll_free_caller_id`) and do not try to
   CNAM it (`422 cnam_not_applicable_toll_free`). Both are by design.

### Play: retire a number safely

1. Enumerate what depends on it. `voice_number_get` for routing and purpose; `voice_pools_list`
   for pool membership; `voice_extensions_list` for extensions presenting it as caller ID;
   `voice_sms_threads_list` for live texting conversations on it; and ask the human where the
   number is PRINTED (signage, GBP listing, ads) - no tool can see a vehicle wrap.
2. If it is the account's only DID, its only `main`, a pool's last member, or an SMS campaign's
   sender: stop and say so. The release tool will not.
3. While the number is still active, run `voice_tenant_healthcheck` and read
   `extension_caller_id_matches_builder`. It is the only check that sees what the PBX presents,
   and it is how you find an extension the release cannot see (section 8, known limit). Go on only
   when it is ok and its detail does not start with `skipped`:
   - Each drifted extension reads
     `ext 101: builder=<what Hiveku shows> pbx=<what calls present>`. Re-save that extension's
     caller ID with `voice_extension_update` while the phone system answers (re-saving re-pushes
     it), then run the check again.
   - The detail names only the first five drifted extensions. Keep going until the check is ok,
     not just until the named ones are fixed.
   - `skipped: tenant has no active DID` is NOT a pass: the check looked at nothing. It skips
     whenever no number on the account is active. If this is the last active one, a check run
     after the deactivate below comes back green even while an extension still presents these
     digits, and the nightly repair skips such an account too, so nothing fixes it during the
     wait. If this number was already deactivated and it was the last active one, nothing can see
     the PBX side for it: say so to the human before asking for the release.
4. Deactivate, do not release yet: `voice_number_update` with `is_active: false`. Reversible. A
   `409 caller_id_clear_failed` means nothing was deactivated - handle it as section 8 says
   before going on. On success, confirm caller-ID references were cleared
   (`voice_extensions_list`).
5. Wait a billing cycle. Check `voice_calls_list` and the SMS threads for traffic that arrived at
   the "dead" number - each one is a reason to keep it.
6. Only then, with a human's explicit confirmation of the exact digits:
   `voice_number_release`. Read `released` in the response; `released: false` is a carrier-side
   follow-up, not a success. If audit history matters, pass `soft: '1'` - the exact string.

---

## 12. Pitfalls

- **Reporting a search result as a reserved or ordered number.** `voice_numbers_search` reserves
  nothing. The number can be gone by purchase time.
- **Re-buying after a 202.** The order is committed at the carrier. A "retry" is a second number.
- **Reading the 202 as an error.** It arrives as a SUCCESS payload with an `error` key - a proxy
  artifact. Route on the key, not the transport.
- **Reporting `dids_without_e911` verbatim.** Subtract the toll-free set first.
- **Treating `voice_e911_addresses_list` rows as all-registered.** Pending verification rows are
  in the same list.
- **Trusting a `voice_number_update` 200.** The PBX push and the TTS render both fail silently.
  Verify by behavior.
- **Reporting a CNAM name as live off `cnam_updated_at`.** That is carrier-accept time. 12-72h.
- **Calling `voice_number_release` with `soft: true`.** Boolean serializes to `'true'`, which is
  not `'1'`, which is the hard-delete path.
- **Assuming a release failed cleanly on 502.** The pool membership, caller-ID references, and
  inbound route are already torn down.
- **Getting past a `409 caller_id_clear_failed` by reassigning caller ID.** The save lands in
  Hiveku, the PBX push only warns, and the next release goes through while the PBX still presents
  the number. Wait for the phone system and retry the same call.
- **Checking caller ID after the deactivate.** Once the account has no active number,
  `extension_caller_id_matches_builder` answers ok with `skipped: tenant has no active DID`, having
  compared nothing. Run the healthcheck while the number is still active.
- **Quoting `voice_usage_get` minutes as call volume.** Nothing increments them in this build.
- **Promising an 800 number.** Unpurchasable platform-wide, and unsearchable.

## 13. Diagnosis quick reference

| Symptom | First move |
|---|---|
| "Is my phone system set up?" | `voice_diagnose_setup`, then read `blocking_issues` - but E911 counts need the toll-free subtraction |
| "DIDs missing E911" reported | `voice_numbers_list`, subtract +1 800/833/844/855/866/877/888; report only the local remainder |
| Number bought but not active | Local: no registered E911 address (`422 e911_required` on activation). TF: check `voice_number_orders_list` - a 202 order may still be activating |
| Toll-free search returns local-looking numbers, or 503 | `voice_server_update_pending` deploy-window guard. Retry later; never buy the local results as TF |
| "That number is taken" on purchase | `409 number_unavailable` - history with another workspace, refused before money moves. Pick another number |
| Purchase answered success-with-error | The 202 lane. Order committed; watch `voice_number_orders_list`; never re-buy |
| Routing changed in Hiveku but the old target still rings | Best-effort PBX push failed silently. Re-save, then verify with a test call |
| CNAM set but callers still see digits | Propagation is 12-72h from carrier accept. Check `voice_number_get` for the mirror, then wait |
| CNAM returns `not_provisioned` on a working number | Ported/half-provisioned row with NULL `provider_number_id`. Fix the row's adoption (`porting.md`), not the number |
| CNAM on an 8xx number | `cnam_not_applicable_toll_free` - by design, not a failure |
| Release answered 200 but the client is still billed | `released: false` was in that response. Carrier-side follow-up required - and the local row is gone |
| "Take the number out of service" | `voice_number_update` `is_active: false` - reversible. If a release may follow, run the retire play's caller-ID check (step 3) first, while the number is still active. Release only after the retire play, digits confirmed |
| Release or deactivate answered `409 caller_id_clear_failed` | Not released or deactivated (any `cleared_extensions` stay cleared). Show `details.message`; retry the same call once `voice_tenant_healthcheck` answers normally (only the stuck extensions are retried). Never reassign their caller ID to get past it |
| Usage says zero minutes despite real calls | Normal - `voice_usage_get` counters are not live except `tts_cents`. Use `voice_calls_list` |
