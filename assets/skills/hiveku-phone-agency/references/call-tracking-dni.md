# Reference: Call tracking and dynamic number insertion (DNI) - pools, setup, operation

This file owns the SETUP and OPERATION of Hiveku's call-tracking layer: what a tracking-DID pool
is, how a visitor gets a swapped number, how to build and size a pool, per-project phone-tracking
config, the consent gates, the swap tester, and the CallRail migration play. Load it when the ask
is "set up call tracking", "is our number swapping working?", "add numbers to the pool", "the
tracking numbers ran out", "move call tracking off CallRail", or any change to whisper, greeting,
caller ID on tracking calls, or which visitors get a tracking number.

What this file does NOT own: the attribution VERDICT (was this call credited correctly, are the
platform's call-conversion counts real) and the reconciliation chain live in
`hiveku-conversion-tracking/references/calls.md`; channel-level "why isn't this converting" lives
in `hiveku-conversion-tracking/references/diagnosis.md`. The upload of attributed calls back to the
ad platforms is this skill's `conversion-send-back.md`. Cross-reference those; do not re-derive
them here.

Read `account_context_get` before any client-facing output. Confirm every write, one object per
confirmation.

## Availability

Every tool in this table resolves on this server today. A name
that does not resolve on your key is a profile question first: check the key's profile (section
below), then the hiveku-communications reachability ladder, then hand off with a precise
dashboard step filed via `pm_tasks_create`. Never say Hiveku cannot do the thing, and never
invent a name.

| Tool | Status | Note |
|---|---|---|
| `voice_pools_list` | LIVE | - |
| `voice_call_tracking_setup` | LIVE | - |
| `voice_call_tracking_diagnose` | LIVE | - |
| `voice_call_tracking_live_probe` | LIVE | - |
| `voice_call_tracking_outbox` | LIVE | - |
| `voice_numbers_list` | LIVE | - |
| `voice_settings_get` | LIVE | - |
| `voice_pool_create` | LIVE | Creates a live pool; a destination declared here is inherited by every member added later |
| `voice_pool_get` | LIVE | Single-pool read; carries weight, is_active and the occupancy block |
| `voice_pool_sessions_list` | LIVE | The non-minting occupancy read: who holds each DID right now; safe to repeat |
| `voice_pool_update` | LIVE | PARTIAL patch, except `destination`, which bulk-rewrites every member DID's routing |
| `voice_pool_delete` | LIVE | Cascades sessions and members; prefer `is_active: false` and drain |
| `voice_pool_numbers_list` | LIVE | Members with `weight` and `member_id` (what remove takes) |
| `voice_pool_numbers_add` | LIVE | Flips the DID's purpose to `did_pool` and inherits the pool destination |
| `voice_pool_numbers_remove` | LIVE | Removes one member by `member_id`; the DID keeps its routing and is not released |
| `voice_pool_e911_apply` | LIVE | One carrier call per local member; changes where 911 dispatches |
| `voice_phone_tracking_config_get` | LIVE | Per project per environment, with `siblings` |
| `voice_phone_tracking_config_set` | LIVE | FULL REPLACE; read first and resend every field |
| `voice_phone_tracking_config_delete` | LIVE | Turns tracking off for that environment |
| `voice_swap_test` | LIVE | Holds a DID for the sticky window; run once |

Profile visibility: the **marketing-ads (PPC) profile sees the call-tracking family BY NAME** -
`voice_call_tracking_diagnose`, `voice_call_tracking_live_probe`, `voice_call_tracking_outbox`,
`voice_call_tracking_setup`, `voice_pools_list`, `voice_pool_get`, `voice_pool_sessions_list`,
`voice_phone_tracking_config_get`, `voice_numbers_list`, `voice_e911_addresses_list`,
`voice_settings_get`, `voice_calls_list`, `voice_call_get` - because "are the ads' calls counted?"
is ads work, and "is the pool exhausted?" needs the occupancy reads. The rest of the `voice_`
prefix (sends, routing, purchases, porting, `voice_settings_update`) is deliberately NOT on a
paid-media key; pool CRUD, membership and config writes need a communications-scope or full key.
On a PPC key a pool or config write is invisible and fails exactly like a missing feature - say
"not visible to this key", file the write with `pm_tasks_create` naming the exact tool, never
"does not exist".

## 1. The model: one pool, many visitors, one number each

A **pool** (`voice_did_pools`) is a set of interchangeable tracking DIDs. When a visitor loads a
page on a project with tracking enabled, the DNI snippet asks the server for a number; the server
**mints a per-visitor session** (`voice_pool_sessions`) that binds one pool DID to that visitor
and carries the attribution captured at that moment (UTMs, gclid/gbraid/wbraid, fbclid, msclkid,
ttclid, referrer, landing URL, ga_client_id, ad_consent, environment). The snippet swaps every
`tel:` link and visible number text to the assigned DID. When that DID rings, the call is matched
back to the session that held it at `started_at` - that chain and its two matchers are
`hiveku-conversion-tracking/references/calls.md` territory; here we care about keeping the pool
healthy enough that a session exists to match.

The lifecycle rules, each load-bearing:

- **Sticky 30 minutes** (`sticky_minutes`, default 30, range 1-1440). The same visitor returning
  to the same pool on the same environment inside the window gets the SAME number back - that is
  what makes a callback from a just-browsed page attribute correctly. The sticky window is also
  the unit of pool occupancy: one concurrent visitor holds one DID for up to 30 minutes.
- **Conversion hold 2 days** (`conversion_sticky_days`, default 2, range 1-365). Once a session's
  DID takes a call, the DID is held for that visitor for 2 more days so a "call you back tomorrow"
  still lands on the right session. The default used to be 30 days and it STARVED real pools -
  converted DIDs sat out of rotation for a month. Do not raise this "to be safe"; late repeat
  callers are covered by the breadcrumb below.
- **Least-recently-converted rotation.** Among eligible DIDs the picker prefers numbers with no
  conversion in the last 14 days (weighted random within that tier - `voice_pool_members.weight`
  biases it; `voice_pools_list` drops weight, `voice_pool_get` and `voice_pool_numbers_list` show
  it); only when every DID converted recently does it fall to the oldest-converted. This spreads
  inventory and keeps one hot number from serving several concurrent visitors. Minting runs under
  a per-pool advisory lock: one assignment decision per pool at a time.
- **The repeat-caller breadcrumb.** A caller with no live session (they dialed a saved number
  weeks later, or called from a different phone than the browser) inherits the attribution of
  their most recent attributed inbound call - same account, same caller number, SAME POOL, within
  90 days - stamped `repeat_caller: true` with a pointer to the original call. This is why the
  2-day hold is enough: identity outlives the hold. One consent nuance: the breadcrumb never
  inherits a consent GRANT (a phone call has no browser), only an explicit opt-OUT sticks.
- **Bots are deliberately never swapped.** Googlebot, AdsBot, Ahrefs and friends get a silent
  204 before any database work: no session, no held DID, no budget burn. Crawlers MUST see the
  site's real number - a swapped pool DID in Google's index is NAP damage, and before this guard
  existed crawlers were starving live pools. A crawl test showing the original number is the
  system working, not a broken swap.

### The MAIN DID fallback - the CTCA incident

When a pool is exhausted (`exhaustion_policy: 'swap_fallback'`, the default) or a visitor is
excluded (consent not yet granted, source-gated out, rate-limited), the page shows a fallback
number instead of a pool DID. **That fallback must be a Hiveku number on the account** (a main
DID). If the site's hardcoded number is NOT a Hiveku number, every non-consenting, excluded, or
fallback caller is **invisible to the platform entirely** - no `voice_calls` row, no recording, no
CRM activity, not merely unattributed. This happened in production: an account owned only its 7
pool DIDs, the site's own number belonged to a third party, and every gated visitor's call
vanished from Hiveku's view. Before enabling tracking on any project, confirm with
`voice_numbers_list` that the number printed on the site is (or forwards through) an active Hiveku
DID; if not, porting it in or standing up a Hiveku main line that forwards to it comes FIRST.

### Pool destination - inherited by every member

A pool carries an optional destination (extension, ring group, queue, IVR, AI receptionist,
voicemail, or a PSTN forward). **Every member inherits it**: a DID added to the pool is routed to
the pool's destination on join, and updating the destination via `voice_pool_update` bulk-applies
to all current members (per-member routing failures are collected in the response, never fatal -
read `destination_apply_failures` and finish the stragglers). Setting the destination to null
clears the pool default without touching members' current routing. The reason this exists: pool
DIDs bought without routing dead-ended in voicemail on a live tenant. A pool whose members show
`routing.target_name: null` in `voice_pools_list` has members pointing at a deleted target - fix
the destination before anything else.

### Whisper, greeting, caller ID

Per-pool call handling (also per-DID - a DID-level whisper/greeting always beats the pool's):

- **Whisper** (`whisper_enabled` + `whisper_template`, max 200 chars) plays to whoever ANSWERS,
  before the bridge: "Call from `[source]`". The `[source]` token resolves at RING time from the
  live session: click ids first (Google Ads, Microsoft Ads...), then `utm_source`, then the
  referrer host, then "your website". A source with no pre-rendered audio variant is spoken via
  TTS fallback with the REAL label rather than a canned generic. Whisper TTS render is platform
  cost, not billed to the tenant.
- **Greeting** (`greeting_text`, max 300 chars) plays to the CALLER before ringing anyone.
  Greeting TTS is billable to the tenant. Both prompts render asynchronously after the save -
  right after a pool save the call may use the plain TTS fallback until the audio lands.
- **`caller_id_mode`**: `caller` (default - the answering phone shows the caller's real number) or
  `tracking_number` (shows the pool DID that was dialed, so staff know it's a tracked
  marketing call before they pick up). Pick per client workflow; confirm before flipping - it
  changes what every answered call looks like on the desk phones.
- **`attribution_model`**: `first_touch` (default - protects the click that paid for the visitor)
  or `last_touch` (a return through a different campaign re-credits) for returns inside the
  sticky window.

### Tracking sources - who gets a number minted

`tracking_source_mode` gates which visitors get a NEW session minted, CallRail-style, seven modes:
`all` (default), `google_ads`, `ppc_search`, `landing_or_param`, `referring`,
`all_except_direct`, `all_except_direct_organic`. `tracking_source_rules` (max 20) adds
include/exclude rules on `utm_source` / `utm_medium` / `utm_campaign` / `referrer` /
`landing_url` with `contains` / `equals`.

Two facts that decide how you use it:

- **Gates NEW MINTS ONLY.** A visitor already inside a sticky window keeps their number no matter
  what you change - tightening the rules never yanks a number mid-session. Expect a change to take
  a full sticky window (plus conversion holds) to fully apply.
- **An excluded visitor is fully excluded**: no session, no mint-budget burn, no starvation
  alert, and NO fallback swap - the page keeps whatever number it already renders. So on a
  source-gated pool, "the number didn't swap for me" is often the gate working (direct visit,
  organic visit under `google_ads` mode). The swap tester names this as `source_excluded`.

Note `ppc_search` means paid SEARCH: a search click id or paid medium plus a search-engine
source/referrer. Facebook/cpc does NOT count as `ppc_search` (it did once, wrongly; it was fixed).

### What the snippet actually does (why the failure modes look the way they do)

Operator-relevant behaviors of the browser side, each explaining a symptom you will be asked
about:

- It swaps `tel:` hrefs AND visible number text, format-preserving ("Call 888-965-6287" becomes
  "Call 469-856-7070", not a raw E.164), and the text swap is a text-node walker: digits inside
  styled markup (icon spans, pill layouts) are replaced without flattening the markup, and digit
  runs that are not phone numbers ("24/7") survive.
- It re-runs on a MutationObserver, so single-page apps that render the header late still get
  swapped - and it watches attribute changes too, which is what lets it re-take a link a foreign
  script rewrites (section 6's coexistence defense).
- The session refresh is VISIBILITY-GATED: a background tab does not re-POST past `expires_at`,
  so parked tabs do not each hold a DID forever. A visitor who tabs back after an hour gets a
  fresh assignment on the next visible refresh - possibly a different number, which is correct.
- `?hkswaptest=<nonce>` on any page URL is test mode: an on-page verdict banner, inert for real
  traffic. The dashboard's "Watch it swap" button is this.
- It prefers the analytics embed's persisted first-touch store over the current page URL when
  stamping attribution - the why (consent-delayed boots, return visits) and the consequences are
  `hiveku-conversion-tracking/references/calls.md` section 2; do not re-derive them here.

### Static source numbers - tracking without a pool

Not every tracked number needs DNI. A DID outside any pool can carry a source label directly on
the number: `voice_number_update` sets `tracking_source` (max 80 chars, e.g.
'google_ads_invisalign' - though for web traffic the pool does this better) and `campaign_name`
(max 120 chars, the label shown in call logs). This is the CallRail "source number" model for
OFFLINE media: print a dedicated number on the billboard, the truck, the radio spot, the GBP
listing, and every call to it is credited to that source in the call logs and the calls-by-source
reporting. `voice_number_get` reads both back (along with `tracking_campaign_id`), and per its
registration `purpose: 'pool'` on an old row is the legacy spelling of `did_pool`.

The honest limit, stated up front to any client who asks: **click-level conversion send-back is
impossible for a static number.** There is no web session behind a billboard call, so no click id
is ever captured - those calls attribute to the source label, never to a gclid, and they can never
upload to an ad platform. Source-level reporting is the ceiling for offline media; that is
physics, not a Hiveku gap.

One trap from `voice_number_get`'s registration that bites pooled DIDs too: a per-number
whisper/greeting/routing value silently BEATS the pool's (the router lets the per-number value
win), so a pool page can claim settings a member does not actually use. When one pool number
behaves differently from its siblings, read that number with `voice_number_get` before touching
the pool.

## 2. The tools

### `voice_pools_list` (LIVE) - the pool inventory

Every pool with sticky/hold/exhaustion knobs, `is_active`, `member_count`, `members[]` with
per-member routing, and the call-handling block. Read its registered description's warnings as
law:

- **The call-handling block can be FICTION.** `whisper_enabled`, `whisper_template`,
  `greeting_text`, `caller_id_mode`, `attribution_model`, voice ids, `tracking_source_mode` and
  `tracking_source_rules` come from a second read that swallows column-missing errors: on a
  deployment where those columns are not pushed, every pool silently reports identical hardcoded
  defaults and NOTHING in the payload says the read failed. Never report those fields as a
  tenant's configured settings without corroborating - `voice_pool_get` rides the same second
  read, so when both report bare defaults on a pool someone says they configured, the dashboard
  pool dialog is the tie-breaker.
- The POOL-level destination comes back as a bare type string + bare UUID, un-resolved; only the
  per-member `routing` block carries names. `routing.type: null` returns the literal synthesized
  string "Account default routing" - a label the route invents, not a real target.
  A non-null type with `target_name: null` means the target was deleted or is another account's
  (the queue branch resolves names too, so a queue target with a null name is the same signal).
- Each pool carries an `occupancy` block, and the RESPONSE carries one top-level
  `occupancy_measured_at` for all of them (`pool.occupancy_measured_at` is undefined on a list
  row; only `voice_pool_get` stamps it on the pool itself). It is the same block
  `voice_pool_get` returns (next section). `null` means the read failed; it is never fabricated
  zeros, so never report `null` as "nothing held".
- `member_count` counts raw membership rows; `members[]` skips rows whose DID was deleted -
  `member_count > members.length` is a dangling membership, not truncation.
- Member rows DROP `weight`, so you cannot see rotation bias here.
- PII: live E.164 tracking numbers, and a seat extension with a blank display name can surface a
  staff member's raw EMAIL ADDRESS in `routing.target_name`. Do not paste the response verbatim
  into a client-facing report.
- No pagination, no filters - inactive pools come back too; filter `is_active` yourself.

### `voice_pool_get` (LIVE) - the single pool and its occupancy block

One pool by id with members hydrated: the full knob set, `member_count`, and `members[]` with
`member_id`, `weight`, `voice_number_id` and `number: { id, e164, label, is_active } | null`.
This shape DOES carry `weight` and `is_active`, which the fleet list drops; `number: null` is a
membership row whose DID was deleted or is another account's, still occupying the
one-pool-per-DID slot until removed. The call-handling block rides the same second read as the
list (the fiction caveat above applies here too), and the destination is still a bare type +
UUID.

The part that answers "is the pool exhausted?" without touching the pool: **`occupancy`**,
measured at `occupancy_measured_at`:

- `members_active` - member DIDs whose number is active (an inactive member quietly shrinks
  capacity).
- `dids_held` - distinct active DIDs with an unexpired session right now.
- `dids_available` - `members_active - dids_held`, floored at 0: what a NEW visitor can still get.
- `converted_holds` - active DIDs parked by `conversion_sticky_days` (a converted session).
- `sessions_active` - unexpired session rows on active members (can exceed `dids_held` when one
  DID served several sticky visitors).
- `exhausted` - `members_active > 0` and `dids_available === 0`: the live starvation signal.

Three batched reads, no lock, no mint - point-in-time, so two calls a minute apart can
legitimately differ. **`occupancy: null` means the read failed** (the pool still comes back); it
is never fabricated zeros, so never report `null` as "nothing held". The rows behind the numbers
are `voice_pool_sessions_list`. 404 `not_found` is also the cross-tenant answer; 402
`voice_not_enabled` without the add-on. PII: live E.164 tracking numbers.

### `voice_pool_sessions_list` - the non-minting occupancy read

Reads the `voice_pool_sessions` rows for one pool (`pool_id`; filters `environment` and
`voice_number_id`; `page` / `limit` 1-200) and **never asks the pool for a number** - unlike
`voice_call_tracking_live_probe` and `voice_swap_test` it holds nothing, so it is the ONE
occupancy check that is safe to repeat. Returns `{ pool, measured_at, occupancy, sessions[],
pagination }`; each session carries `visitor_hash`, the tenant DID it was shown (`e164`,
`label`, `voice_number_id`), `project_id` / `environment`, `assigned_at` / `expires_at` /
`converted_at`, `is_converted_hold`, `seconds_remaining`, `source { utm_source, utm_medium,
utm_campaign, click_id_type }`, `geo_region` / `geo_country`, `ad_consent`.

What to read it for:

- **Who is holding the DIDs right now** - every row is one held DID for `seconds_remaining` more
  seconds; rows with `is_converted_hold: true` are the conversion pile-up (section 4).
- **The probe-loop signature**: many sessions minted seconds apart, one `visitor_hash` (or a run
  of fresh hashes from one `source` / `environment` with no conversions), on the same DIDs. That
  is a monitor somebody built on `voice_swap_test`, the live probe, or the snippet's mint
  endpoint - kill it before buying inventory.
- **Whether traffic matches the story**: a `google_ads`-mode pool whose sessions all carry
  `click_id_type: null` is minting for visitors the gate should exclude - a config question, not
  a sizing one.

PII posture: `visitor_hash` is a tenant-salted, truncated hash - correlate rows with it, never
treat it as an identity; the click id itself is never returned (only its TYPE), nor is the
visitor's user agent, referrer, landing URL or GA client id. Each row is still a real person's
visit - do not paste the response into anything client-facing. 404 `not_found` is also the
cross-tenant answer; 402 `voice_not_enabled`.

### Pool CRUD (LIVE): `voice_pool_create`, `voice_pool_get`, `voice_pool_update`, `voice_pool_delete`

Everything in section 1 is settable at create and patchable after. Behaviors carried from the
session route these twin:

- Create defaults: `sticky_minutes` 30, `conversion_sticky_days` 2, `exhaustion_policy`
  `swap_fallback`. A destination can be declared at create so the first numbers added inherit it.
- Update with a destination bulk-applies to every current member (read
  `destination_apply_failures` back); `destination: null` clears the pool default only.
- **`voice_pool_delete` cascades sessions and members** and orphans pending inbound calls on
  those DIDs - a caller redialing a number they saved gets whatever the DID's own routing says,
  with no session to attribute against. Confirm by pool name AND member count, and prefer
  `is_active: false` via `voice_pool_update` (stops new mints, existing sessions drain) unless the
  pool is truly dead. The DIDs themselves are NOT released by a pool delete - they remain owned,
  billing monthly.
- A DID lives in at most ONE pool (409 `already_in_pool` on a second add, naming whether it is
  this pool or another).

### Membership (LIVE): `voice_pool_numbers_list`, `voice_pool_numbers_add`, `voice_pool_numbers_remove`

- Add takes `voice_number_id` (must be an active number the account owns) and optional `weight`
  (1-100, default 1 - higher = served more often). On add, the number's `purpose` flips to
  `did_pool` and it inherits the pool destination; on remove (`member_id` as a query param) it
  flips back to `tracking` and KEEPS its routing.
- `voice_pool_numbers_list` and `voice_pool_get` are the only reads that show `weight`;
  `member_id` (NOT `voice_number_id`) is what `voice_pool_numbers_remove` takes.
- Removing a member does not release the DID or end its live sessions; a visitor holding it keeps
  it until expiry, and calls to it still land wherever it routes.

### `voice_pool_e911_apply` (LIVE) - the office-move play

Applies ONE carrier-validated E911 address to every LOCAL member of a pool in a single call. Pool
DIDs are interchangeable, so their dispatchable address is a pool-wide fact: when the client moves
office, all of them must change together, and doing it one number at a time is how a pool ends up
with three numbers pointing 911 at the old suite. Contract details:

- **Toll-free members are SKIPPED, not failed** (TF is not E911-capable at the carrier); a mixed
  pool applies to its local half and reports `skipped_toll_free`.
- The address must already be registered AND carrier-validated on the account (422
  `e911_address_invalid` otherwise - register on the E911 page / `voice_e911_address_create`
  first).
- Carrier is updated first, the row only after, per number - so a number can never read
  "validated" against an address the carrier does not hold. Per-number failures are collected in
  `failed[]`; the batch never aborts. Re-run after fixing; already-correct numbers are skipped.
- Read the result back: `updated` + `skipped_toll_free` + `failed.length` should equal the local
  member count you expected. Report the actual numbers that failed, not a count.

### Per-project tracking config (LIVE): `voice_phone_tracking_config_get`, `voice_phone_tracking_config_set`, `voice_phone_tracking_config_delete`

Config is **per project, per environment** (`development` | `staging` | `production`; preview is
deliberately excluded - the live-preview container is ephemeral). Production can be live while dev
stays disabled or points at a scratch pool, so dev traffic never pollutes real attribution. GET
returns the selected environment's config plus `siblings` - the other environments' enabled/pool
state - so "tracking was never set up" and "it's off HERE but live on production" stop looking
identical.

**`voice_phone_tracking_config_set` (PUT) is a FULL REPLACE**, per the route: every field you omit
resets to its default - `swap_selector`, `swap_text_regex`, `widget_*` all reset, and **omitting
`swap_source_numbers` CLEARS the stored list**. Always `voice_phone_tracking_config_get` first and
send the complete intended state. The ONE exception: `consent_mode` omitted = unchanged (a partial
save must not silently reset a tenant's privacy posture). Environment goes in the BODY on the set
call (the proxy cannot send query params on PUT); GET and DELETE take `env` as a query param.

Fields that matter:

- `pool_id` (required) + `enabled`.
- **`swap_source_numbers`** (max 5): the "numbers to look for" - plain-text phone numbers the
  snippet swaps even when the page has no `tel:` link. Accepts human formats ("(469) 856-7070"),
  stored as E.164; an unparseable entry rejects the WHOLE write with a 422 naming the exact bad
  entries. This is the **CallRail cutover lever** - see section 6.
- `swap_selector` / `swap_text_regex`: extra CSS/text targets for sites with odd markup.
- `widget_enabled` / `widget_position` / `widget_fallback_e164`: the floating "Call us" widget,
  independent of pool swap (renders the fallback when no DID matched).
- **`consent_mode`**: `immediate` (default - swap runs without waiting for the cookie banner) or
  `analytics` (swap waits for analytics consent). Section 5 has the whole story; the headline is:
  **the consent gate is BAKED INTO THE DEPLOYED SITE HTML at deploy time**, so changing
  `consent_mode` requires a SITE REDEPLOY of that project - a config save alone changes nothing on
  the live page. Say so every time you change it, and never mass-redeploy the fleet to roll a
  consent change out (a rebuild publishes whatever is in each project's source, including someone's
  unpublished work-in-progress - redeploy one site deliberately, with its owner's yes).

`voice_phone_tracking_config_delete` disables tracking for that environment (the config row is
removed). The snippet reference in the site HTML survives until the next deploy but assigns
nothing.

### `voice_swap_test` (LIVE) - the swap tester

CallRail-style end-to-end verification for one project + environment: loads the config, resolves
the deployed URL the way the hosting surfaces do, fetches the live page, checks that the snippet
is referenced and the configured numbers actually appear in the page, then **runs a REAL pool
assignment exactly the way a visitor's browser does**. Returns a failure-isolated checklist -
`site_reachable`, `snippet_detected`, `tel_links`, `text_numbers_found` / `numbers_missing`,
`assignment` (`assigned` / `fallback` / `reason` - `source_excluded` means the tracking-source
gate refused the mint, in English), `pool` `{total, available}` - plus warnings; a dead site or a
broken pool downgrades to warnings, never a 500.

**That real assignment HOLDS a tracking DID for the pool's sticky window.** Run it ONCE to confirm
a setup or a fix, never on a schedule, never in a loop - section 4's starvation rule applies to
this tool exactly as it does to `voice_call_tracking_live_probe`. For a visual check without any
tool, `?hkswaptest=<nonce>` on any page URL is the snippet's test mode (an on-page verdict banner,
inert for real traffic; the dashboard's "Watch it swap" button drives it).

### `voice_call_tracking_setup` (LIVE) - the idempotent orchestrator

One operation that wires the whole lane for a project: number pool, tracking DIDs, per-project
phone-tracking config, the tenant conversion-upload policy, and the Google "Hiveku - Phone Call"
conversion action. Per-step results plus an overall state - success is never inferred from a bare
200 - and re-runs report `already_configured` per step instead of duplicating.

- **`did_count` is THE money field** - the ONLY input that spends. Omit it or send 0 and nothing
  is bought. When set it buys only the shortfall between the pool's current active size and the
  target, at most 5 per run, and only after the E911 address checks out (a missing or unvalidated
  address comes back as a `blocked` step naming the human action - it never half-buys). Pass
  `e911_address_id` to choose which validated address the purchased DIDs register against; an
  unvalidated or foreign id is refused before anything is bought. Numbers bill monthly until
  released.
- **Always `dry_run: true` first** on any account where you are not certain what exists, then
  confirm with the operator before any run naming a nonzero `did_count`.
- **`did_search` is an OBJECT**: `{ area_code?, locality?, state? }`, at least one set. Flat
  top-level `area_code` / `locality` / `state` are NOT read by the route - a flat param silently
  buys from anywhere. Use the client's local area code, or one object per market across several
  runs when building a geo spread (section 3).
- Also accepts the upload policy (`conversion_upload_disposition`,
  `conversion_upload_min_duration_sec`, `conversion_value`, `currency_code`, `ppc_connection_id`)
  so a from-zero setup lands with a sane policy in one confirmed pass - the policy semantics live
  in `conversion-send-back.md`.
- `environment` defaults to `production`; `pool_id` reuses an existing pool instead of creating
  `pool_name`.

### `voice_call_tracking_diagnose` vs `voice_call_tracking_live_probe` (both LIVE)

The doctor: seven checks (`ok | warn | fail | unknown`) plus an ORDERED `fix_first` list - read
`fix_first`, not the check array. Read-only but not free (outbound Google Ads reads plus one HTTP
GET of the deployed page; `skip_google` / `skip_site_fetch` stay in the database and the skipped
checks report `unknown`, which is NOT a pass). Pass `project_id` explicitly on multi-site accounts
or the doctor picks the most recently updated project. Two verdicts to know by name:
`number_tracking` reports `fail` with `details.pool_exhausted: true` when every active DID is held
and no live probe ran (section 4), and the outbox check names the platform whose connection is
failing (`details.by_platform`) - a Meta token expiry is reported as Meta, not Google.

**`voice_call_tracking_live_probe` is the doctor PLUS a real pool assignment** - the only way to
PROVE swapping works end to end, and it HOLDS a tracking DID for the sticky window just like
`voice_swap_test`. Send `live_probe: true` or it is just the doctor with an extra round trip. Run
it to confirm a fix; never schedule it; never loop it. When the question is only "is the snippet
in the served HTML", the analytics-side reads (`analytics_probe_page`,
`analytics_diagnose_tracking` - covered in `hiveku-conversion-tracking/references/calls.md`
section 7) answer without burning a pool session.

## 3. Local swap - geo-local number display

Local Swap shows a visitor a tracking number LOCAL to them: the swap request rides the edge
(track.hiveku.com), which stamps the visitor's geo onto the mint, and assignment prefers a DID
whose area code matches the visitor's region (country gate first - a Brazilian "PR" region never
matches Puerto Rico DIDs; strict NANP handling so foreign numbers never false-match).

What that means operationally:

- **The pool needs an area-code SPREAD to do anything.** A pool that is all one market
  (five 214s and a 469) trivially satisfies the local tier for Dallas visitors and has nothing
  local to offer anyone else - they just get normal rotation. For a client serving several
  markets, buy the spread deliberately: one `voice_call_tracking_setup` run per market with
  `did_search: { area_code }` (dry_run, confirm, at most 5 per run), or add pre-bought DIDs with
  `voice_pool_numbers_add`.
- Local swap is display preference only - sticky, holds, rotation, source gates and consent all
  apply unchanged. A visitor who got a non-local number is a pool-composition fact, not a bug.
- The edge hop is infrastructure (a shared key between the worker and the builder). If geo
  stamping stops (sessions minting with no geo), that is an ops escalation, not a config you can
  fix from here - `pm_tasks_create` it with the session evidence.

## 4. Sizing and starvation

**Sizing rule: busiest-hour concurrent visitors divided by 4, minimum 4 DIDs.** One concurrent
visitor holds one DID for up to a sticky window; conversions hold theirs for 2 days more. Two DIDs
on a modestly-trafficked site exhausted within the first hour of the very first production
rollout - undersizing is the default failure, not the exception. Size against the busiest hour,
not the average, and re-check after every traffic change (a new campaign is a traffic change).

What exhaustion looks like: `exhaustion_policy: 'swap_fallback'` (default) shows the tenant's main
DID unswapped and flags the call (section 1's MAIN DID requirement is what keeps those callers
visible at all); `'reject'` keeps whatever number the page already rendered. Either way concurrent
visitors beyond capacity share static numbers and attribute only by breadcrumb or not at all.

Three operational facts:

- **The mint cap: 5 mints per IP per pool per sticky window.** It is an anti-abuse occupancy cap
  on a public endpoint. **An office of 6+ people behind one NAT IP trips it: the 6th visitor gets
  `{rejected, reason: 'rate_limited'}` and sees the unswapped number. Expected, not a bug** - do
  not "fix" the pool for it, and recognize it when the client's own staff report "the number
  doesn't change for me" from the office.
- **NEVER poll a live pool with fresh visitor ids.** A verification loop minting a new visitor
  every few minutes is 10+ held DIDs per sticky window - it starved a real 6-DID production pool
  and paged the tenant. Any repeated check must reuse ONE visitor id (sticky path, no mint) or
  mint at most once per sticky window. This is also why `voice_call_tracking_live_probe` and
  `voice_swap_test` are run-once tools.
- **The starvation email exists.** The attribution sweep runs live occupancy math; when every
  active DID is held, account admins get a branded email + bell (24h per-pool cooldown) and the
  account gets an ops-inbox item (below). If the client forwards one: first question is whether a
  test loop (yours or anyone's) caused it; second is real growth - size up via
  `voice_call_tracking_setup` `did_count` (dry_run, confirm).
- **Read occupancy BEFORE the arithmetic.** `voice_pool_get` (or `voice_pools_list`) carries
  `occupancy` - `dids_available`, `converted_holds`, `exhausted` - measured without minting. Size
  from the busiest hour, but say what is held right now and by what (visitor sessions vs
  conversion holds) before proposing a number of DIDs; `occupancy: null` is a failed read, not a
  free pool.
- **The doctor calls it.** `voice_call_tracking_diagnose` reports `number_tracking` as a `fail`
  with `details.pool_exhausted: true` when every active DID is held and no live probe ran (probe
  evidence outranks a stale reading); the copy names conversion holds when they are the reason,
  and `next_action` carries the sizing rule. The fix it names is inventory, not a shorter hold.
- **Starvation and swap-health history is on the ops inbox.** Every starvation notice and every
  swap-health issue also lands as an inbox item, so "has this pool been starving?" has an answer
  even on an account with no email recipients: `agent_inbox_list({ category:
  'voice.pool_starvation', status: 'new,seen,snoozed,actioned,dismissed,expired' })`, and the same
  call with `category: 'voice.swap_health'`. `category` is an exact match, and the default
  `status` is the open queue only - pass the full list to read history.

## 5. Consent, and the ad_consent tri-state

Two separate consent mechanisms touch this lane. Keep them apart.

**1. `consent_mode` gates the SWAP** (per project per environment, on the tracking config):

- `analytics`: the DNI loader is wrapped in a consent gate in the site's HTML - the script never
  runs until the visitor grants analytics consent. No consent = no swap = the visitor sees the
  hardcoded number (and if that is not a Hiveku number, their call is invisible - section 1).
- `immediate` (default): the swap runs without waiting for the banner. The banner still shows;
  showing a banner and gating DNI are separate decisions.
- **The gate is baked into the deployed page HTML at deploy time. A `consent_mode` change takes
  effect on the NEXT DEPLOY of that site** - saving the config is not enough, and this is the
  single most confusing "I changed it and nothing happened" in the lane.
- The gate FAILS STRICT: an unknown or unreadable mode keeps gating. "Can't read the config" is
  never treated as "tenant chose loose".
- Regime nuance for expectations: under the opt-out regimes (US), analytics is auto-granted and
  the swap runs even in `analytics` mode; EU and unknown-country visitors stay gated until they
  accept. A side-by-side against a tracker loaded OUTSIDE the consent runtime (CallRail via GTM)
  is apples-to-oranges while a gate is on - it captures visitors we deliberately skip.

**2. `ad_consent` gates the UPLOAD, not the swap.** Captured at SWAP TIME onto the pool session as
a tri-state: `false` = explicit advertising opt-out (GPC or the banner's advertisement category),
`true` = granted, `null` = no signal. **Only an explicit `false` suppresses** the send-back to
google / microsoft / meta; `null` is not a denial. **GA4 is exempt** (first-party analytics,
granted by the analytics category). The snippet re-POSTs when the visitor's consent decision
actually changes mid-visit (sticky, no mint), so a "Do Not Sell" click after landing is honored.
The breadcrumb inherits an opt-out, never a grant. Suppression detail and the outbox codes are in
`conversion-send-back.md`; the CRM-lane tri-state doctrine is
`hiveku-conversion-tracking/references/offline-conversions.md` section 7.

## 6. The CallRail migration, in order

The order matters; every incident in this play came from re-ordering it.

1. **Point our snippet at CallRail's numbers: `swap_source_numbers`.** List the numbers CallRail
   is currently DISPLAYING on the site (their tracking numbers, up to 5) in the project's tracking
   config. The snippet swaps those out immediately - plain text included, no `tel:` link needed -
   so Hiveku takes over the visible numbers while CallRail's script is still installed. Remember
   the PUT is full-replace: send the whole config.
2. **Verify the swap won the page: `voice_swap_test`** (once), or the `?hkswaptest` banner in a
   real browser. Coexistence is DEFENDED: the snippet re-takes a link CallRail rewrites (attribute
   observation + late sweeps), with a re-take budget of ~40 per page load before conceding so two
   observers can never burn CPU trading writes forever. Defended is not the same as measured-with:
   see the warning below.
3. **Port the CallRail numbers in** (the porting reference owns the mechanics -
   `voice_portability_check` -> `voice_port_order_create` ...). Porting is what makes the numbers
   printed on trucks, ads and directories ring through Hiveku; until then those legacy numbers
   still terminate at CallRail. After FOC, add the ported DIDs to the pool
   (`voice_pool_numbers_add`) or keep them as static tracking numbers, apply E911
   (`voice_pool_e911_apply` for the pool's locals), and confirm routing.
4. **Remove the CallRail script LAST** - only after the port completes and the swap is verified.
   If the client cannot remove it immediately (a GTM container they don't control), the defense in
   step 2 keeps Hiveku's numbers on the page in the interim.

**Never run both trackers for real measurement.** Coexistence is a migration posture, not an
operating mode: whichever script loses the DOM records nothing for those visitors, so running both
means at least one tool's numbers are garbage regardless of who wins - and while a consent gate is
on, the two see different visitor populations anyway (section 5). Any "CallRail vs Hiveku"
comparison during the overlap gets that caveat in writing.

## 7. Plays

### Paid-ads call tracking from zero

The end-to-end for "set up call tracking for this client's ads", on an account with a deployed
site and a connected Google Ads account:

1. `account_context_get`, then `voice_settings_get` (a `settings: null` means the voice tenant
   was never provisioned - stop, that is a provisioning task, not a tracking task) and
   `voice_numbers_list` (does a Hiveku main DID exist for the fallback? Section 1. If not, fix
   that first).
2. `voice_call_tracking_setup({ project_id, dry_run: true })` - read every step: what exists, what
   would be created, what is blocked (E911 is the usual blocker, and it names the human action).
3. Confirm with the operator, then run it for real with `did_count` sized per section 4,
   `did_search: { area_code }` for the client's market, and the conversion policy fields agreed
   with the client (`conversion_upload_disposition`, `conversion_upload_min_duration_sec` -
   definitions in `conversion-send-back.md`). One confirmed call; numbers bill monthly.
4. `voice_pool_update` for call handling: destination first -
   where do these calls RING - then whisper/greeting/caller_id_mode per the client's front-desk
   workflow, and `tracking_source_mode` only if they explicitly want paid-only tracking (default
   `all` is right for most: every channel's calls get attributed, uploads are gated separately).
5. Verify: `voice_swap_test` once (or `voice_call_tracking_live_probe` with `live_probe: true` -
   one of them, not both; each holds a DID). Then `voice_call_tracking_diagnose` and work
   `fix_first` until the verdict is clean.
6. The send-back half (enable uploads, validate, first-week checks) continues in
   `conversion-send-back.md`.

### "Attribution stopped after a redeploy"

The most common quiet death, and it is almost never the pool. The DNI loader tag did not survive a
site redeploy: real numbers render, phones ring, and every call from that moment is unattributed.
Prove the served HTML first - `analytics_probe_page` on the money URL, or one
`voice_call_tracking_live_probe` - and if the drop starts on a deploy date, stop analyzing
campaigns; redeploy with the snippet restored. The full interpretation ladder (including
`snippet_missing` vs `tag-not-deployed`) is `hiveku-conversion-tracking/references/calls.md`
section 7 - defer to it for the verdict; this file's job is the fix side: after restoring, one
`voice_swap_test` to confirm, and remember a `consent_mode` change someone made "while it was
broken" also only lands on this redeploy (section 5).

### "The pool is exhausted"

1. `voice_pool_get` for the pool: `is_active`, the members' `is_active`, whether routing is
   intact, and the `occupancy` block - `dids_available`, `dids_held`, `converted_holds`,
   `exhausted`. If `occupancy` is `null` the read failed; say so rather than reading it as a free
   pool. Then the arithmetic: busiest-hour concurrent visitors / 4 vs `members_active` (section
   4).
2. Rule out self-inflicted starvation BEFORE buying anything: `voice_pool_sessions_list`, and
   look for the probe-loop signature (section 2) - sessions minted seconds apart, one visitor
   hash or a run of fresh ones, no conversions. Has anyone (including you, including a monitor
   someone built) been probing with fresh visitor ids? Kill the loop first; the pool recovers
   within a sticky window. This read holds nothing - repeat it after the kill and watch the
   sessions expire.
3. Rule out hold pile-up: `converted_holds` counts DIDs parked by `conversion_sticky_days`, and
   the session rows with `is_converted_hold: true` say which. A promo spike converts the whole
   pool into held DIDs - that is success, and the fix is still more inventory, not a shorter hold
   (the hold protects callbacks).
4. Add inventory: `voice_call_tracking_setup` with `did_count` = new target (dry_run -> confirm ->
   run; it buys only the shortfall, max 5/run), or `voice_pool_numbers_add` for DIDs already
   owned. Verify with `voice_pool_get` (`members_active` went up, `exhausted` is false) and one
   `voice_swap_test`.
5. If the client declines to buy: say plainly what `swap_fallback` means - visitors beyond
   capacity share the main number and attribute only by breadcrumb - and record the decision.

### "Only track visitors from the ads"

A client (or their privacy counsel) wants tracking numbers shown only to paid visitors:

1. Read the pool first (`voice_pools_list`, with its call-handling-fiction caveat) and say what
   the change does NOT do: source gating controls which visitors get a number MINTED - it does not
   stop attribution of calls to the main line, and it does not gate uploads (that is `ad_consent`
   and the upload policy, section 5 / `conversion-send-back.md`).
2. `voice_pool_update` with `tracking_source_mode: 'google_ads'` (or `ppc_search` /
   `landing_or_param` for "any tagged click"), plus `tracking_source_rules` for anything finer -
   one confirmed change, echoing before and after.
3. Warn about the transition: sticky visitors keep their numbers for up to a sticky window plus
   any conversion holds, so the pool does not instantly go quiet for organic visitors.
4. Expect the side effects and pre-empt the tickets: direct and organic visitors now see the
   site's own number ("the number stopped changing for me" = correct), excluded visitors never
   trigger the starvation alert, and total attributed-call volume DROPS because organic calls now
   attribute only via the main line and breadcrumb. Put that expected drop in writing before the
   change, or it comes back as "tracking broke".
5. Verify with `voice_swap_test` once: a direct-visit-shaped probe should come back
   `source_excluded`, which is the pass condition here, not a failure.

## 8. Pitfalls

- **Reporting `voice_pools_list`'s call-handling block as configured truth.** It can be silent
  defaults on a deployment where the columns lag. Corroborate before telling a client "whisper is
  off".
- **Treating the pool table as the swap.** A healthy pool with the snippet missing from the served
  page tracks nothing; a starved pool with a perfect snippet swaps nothing. Always check both
  sides (`voice_pools_list` + one live-page proof).
- **`voice_phone_tracking_config_set` without a prior GET.** PUT is full-replace: you just cleared
  `swap_source_numbers` mid-CallRail-migration and their numbers stopped being swapped out.
- **Changing `consent_mode` and declaring it done.** It is baked into the site HTML; without a
  site redeploy nothing changed. And never mass-redeploy the fleet to push it - one site at a
  time, deliberately.
- **Scheduling the probe.** `voice_call_tracking_live_probe` and `voice_swap_test` each hold a
  real DID for the sticky window. A monitor built on either one starves the pool it monitors. The
  scheduled monitoring that IS safe already exists platform-side (swap-health cron, starvation
  email, both also written to the ops inbox).
- **Polling occupancy with a probe.** `voice_pool_get` answers "is it exhausted" and
  `voice_pool_sessions_list` answers "who holds what" without minting; a probe run "to check the
  pool" IS the loop that starves it.
- **"Fix" the mint cap for the client's office.** 6+ people behind one NAT IP hitting the cap is
  the guard working. Explain it; do not raise anything.
- **Deleting a pool to "reset" it.** Cascades sessions, orphans pending calls, and the members'
  history stops matching. Deactivate (`is_active: false`) and drain instead.
- **Buying without `did_search` as an object.** Flat `area_code` is ignored; you just bought
  numbers from anywhere. `{ area_code: '469' }`, inside `did_search`.
- **Assuming the fallback caller is merely unattributed.** With no Hiveku main DID they are
  INVISIBLE - no call row at all. Check `voice_numbers_list` against the number the site actually
  prints before trusting any call-volume trend.
- **Running CallRail and Hiveku side by side "to compare".** One of them is recording garbage by
  construction, and under a consent gate they see different visitors. Migrate in section 6's
  order instead.
- **Blaming the market for a redeploy.** Attribution cliffs that start on a deploy date are
  `snippet_missing` until proven otherwise.

## 9. Diagnosis table

The four swap-health issue codes (the dashboard monitor's vocabulary - name the tool YOU ran when
reporting, not the dashboard) and the tool-side first moves. Interpretation beyond the first move
is `hiveku-conversion-tracking/references/calls.md` section 7's job.

| Issue | Meaning | Tool-side first move |
|---|---|---|
| `site_unreachable` | The deployed page would not load at all | `voice_swap_test` once (its `site_reachable` + `deployed_url` say what was fetched); a wrong/missing custom domain or a dead deploy is a hosting problem - fix that before reading anything else |
| `snippet_missing` | Page loads, DNI loader not in the served HTML | `analytics_probe_page` on the money URL (no pool session burned). Redeploy-shaped: check the deploy date against the drop. On a GTM-injected loader a server-side fetch can miss it - a `voice_swap_test` `assignment.assigned: true` with `snippet_detected: false` is that false alarm |
| `pool_empty` | No DIDs provisioned in the pool | `voice_pools_list` (member_count 0?) then `voice_call_tracking_setup` with `did_count` - dry_run first, confirm, it spends money |
| `pool_exhausted` | Every active DID currently held | `voice_pool_get` occupancy first (`dids_held` vs `converted_holds`), then `voice_pool_sessions_list` to prove or rule out a probe loop, then the play in section 7 to size up. Meanwhile `swap_fallback` is showing the main DID - calls still land, attribution degrades to breadcrumb |

Two more first moves that are not dashboard codes:

| Symptom | Tool-side first move |
|---|---|
| "The number doesn't swap for me" (client staff) | Ask where they are: office NAT + mint cap (section 4) or a source-gated pool (`tracking_source_mode` - direct visits excluded) or consent not yet granted in `analytics` mode. All three are the system working |
| Whisper says "your website" for an ads caller | Audio variant not rendered yet for that source (renders lag the pool save) - re-check after a few minutes; persistent = the session had no source (check the session on the call via `marketing_call_attribution_list`) |
| "Has this pool been starving?" / "how often?" | `agent_inbox_list({ category: 'voice.pool_starvation', status: 'new,seen,snoozed,actioned,dismissed,expired' })` - one OPEN item per pool, urgent, linking to the pools page (a notice while the previous item is still new/seen/snoozed files nothing, a fresh row appears only after the last one was actioned, dismissed or expired, and the sweep refiles at most once per 24h), so the row count is episodes, not notices - read each row's `created_at` / `expires_at` and `metadata` for cadence; the default `status` shows only the open queue, so pass the full list for history |
| "Has the swap been unhealthy?" (history, not a live check) | `agent_inbox_list({ category: 'voice.swap_health', status: 'new,seen,snoozed,actioned,dismissed,expired' })` - one item per project per issue code; corroborate a live claim with `voice_swap_test` ONCE, never a loop |

For everything downstream of a healthy swap - matchers, sweep timing, transcript states, "are
these conversions real" - go to `hiveku-conversion-tracking/references/calls.md`. For pushing the
attributed calls back to the ad platforms, `conversion-send-back.md` next door.
