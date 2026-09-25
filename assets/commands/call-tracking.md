---
description: "\"Set up call tracking\" / \"which ads make the phone ring?\" / \"get us off CallRail\" / \"is the number swap working?\" / \"the tracking numbers ran out\" - DNI call tracking: setup with a dry run before any purchase, the pools and their call handling, the per-project swap config, the one-shot swap test, pool health with live occupancy, the exhausted-pool play, and the CallRail cutover in the only safe order."
argument-hint: "[setup | test | pools | config | callrail-cutover | health | exhausted]"
---
Call tracking: $ARGUMENTS. Follow the **hiveku-phone-agency** skill - load
`references/call-tracking-dni.md` first; the pool model, sizing, consent rules, and the migration
order live there.

**Profile note, before the first call.** Pool and config WRITES (`voice_pool_create`,
`voice_pool_update`, `voice_pool_numbers_add`, `voice_pool_numbers_remove`,
`voice_phone_tracking_config_set`, `voice_phone_tracking_config_delete`, `voice_swap_test`) need a
communications-scope or full key. On a PPC (marketing-ads) key only the call-tracking set
resolves - the reads (`voice_pools_list`, `voice_pool_get`, `voice_pool_sessions_list`,
`voice_phone_tracking_config_get`, `voice_call_tracking_diagnose`, `voice_call_tracking_trace`,
`voice_call_tracking_outbox`) plus `voice_call_tracking_setup` and `voice_call_tracking_live_probe`. A name that does not
resolve is therefore a profile question first (say "not visible to this key" and file the write
with `pm_tasks_create`, naming the tool) and a plugin-version question second (`/hiveku:update`,
then retry). Never say Hiveku cannot do it.

**setup**:
1. Current state before anything: `voice_pools_list`, `voice_phone_tracking_config_get` (with
   `env`) for the project, and `voice_pool_get` on any pool that already exists - setup is
   idempotent, but the dry run is still how you learn what this run would touch. Confirm with
   `voice_numbers_list` that the account has an active `purpose: 'main'` DID: under
   `swap_fallback` (the default) beyond-capacity visitors are swapped to that number
   (`fallback_e164`), and with none the mint answers `fallback_e164: null` and the page keeps
   whatever it printed - a third-party number in that seat makes every fallback caller
   invisible. `reject` keeps the printed number by design.
2. `voice_call_tracking_setup` with `dry_run: true` FIRST, every time. Read the per-step results;
   a `blocked` step names the human action (usually E911: a validated address from
   `voice_e911_addresses_list`, passed as `e911_address_id` so the purchase registers against it -
   an unvalidated or foreign id is refused before anything is bought).
3. [CONFIRM] the real run - `did_count` is the money field: it buys the shortfall up to that
   target, at most 5 DIDs per run, and every number bought bills monthly until released. Show the
   human the dry-run output, the exact `did_count`, and the area-code choice before the yes.
4. Call handling is the **pools** lane below: destination first (where do tracked calls RING),
   then whisper, greeting, caller ID and the source gate - one [CONFIRM] `voice_pool_update`.
5. `voice_swap_test` ONCE - it verifies the number swap on the live page and HOLDS a tracking DID
   for the sticky window while it does; never loop it. On a PPC key the one-shot proof is
   `voice_call_tracking_live_probe` with `live_probe: true` instead - one of the two, never both.
6. Offer the send-back: calls flowing back to the ad platforms as conversions is
   `references/conversion-send-back.md`, and the report lane is `/hiveku:call-report`.

**pools** - inventory, call handling, membership:
1. `voice_pools_list` for the fleet, then `voice_pool_get` for the pool you are touching: it is
   the read that carries member `weight`, per-DID `is_active`, and the `occupancy` block
   (`members_active`, `dids_held`, `dids_available`, `converted_holds`, `sessions_active`,
   `exhausted`; `null` means the read failed, never zero). Its call-handling block can be
   deployment-window fiction (hardcoded defaults with nothing in the payload saying so) -
   corroborate before reporting a whisper or a source gate as configured.
2. [CONFIRM] `voice_pool_create` for a new pool - born EMPTY: no spend, and nothing swaps until
   numbers join AND a project opts in through the **config** lane. [CONFIRM] `voice_pool_update`
   for an existing one - PARTIAL, only the fields you send change. Echo before/after per field:
   - `destination` (extension, ring group, queue, IVR, AI receptionist, voicemail, or a PSTN
     forward via `forward_to_e164`): where tracked calls RING. Sending it BULK-APPLIES to every
     current member DID - each member's routing is rewritten and its PBX route re-synced - so say
     that before the yes. A response carrying `destination_apply_failures` is a PARTIAL success:
     those members keep their old routing until re-saved. A `forward_to_e164` destination bills
     PSTN minutes for every tracked call, and it is stamped onto each member number's own
     `forward_to_e164`, which stays there if the number later leaves the pool: clear it on the
     number with `voice_number_update` (`forward_to_e164: null`). Fix the destination FIRST when `voice_pools_list` shows
     members with `routing.target_name: null` (a deleted target).
   - `whisper_enabled` + `whisper_template` (max 200 chars; `[source]` resolves at ring time to
     the ad platform, the UTM source, the referrer host, or "your website"): plays to whoever
     ANSWERS. `greeting_text` (max 300 chars): plays to the CALLER, billed TTS. Both render after
     the save, so the next few calls may hear the plain TTS fallback.
   - `caller_id_mode`: `caller` (default) or `tracking_number` - it changes what every answered
     call looks like on the desk phones; confirm it as its own line.
   - `tracking_source_mode` for "only track the ads": `google_ads`, `ppc_search` or
     `landing_or_param` (plus `tracking_source_rules` for anything finer). It gates NEW mints
     only, excluded visitors keep the site's own number, and attributed-call volume DROPS - put
     that expected drop in writing before the change or it comes back as "tracking broke".
   - `is_active: false` drains a pool (stops new mints; sessions run out on their own). Prefer it
     to `voice_pool_delete`, which cascades live sessions and releases nothing.
3. Membership: `voice_pool_numbers_list` (the read that shows `weight` and the `member_id`), then
   [CONFIRM] `voice_pool_numbers_add` - an EXISTING owned DID, it buys nothing; the DID's purpose
   flips to `did_pool` and it inherits the destination best-effort, so re-read routing after -
   or [CONFIRM] `voice_pool_numbers_remove` by `member_id` (never the `voice_number_id`, never
   the E.164). Removal stops NEW assignments only: sessions already on that DID keep attributing
   until they expire, and nothing is released to the carrier. One DID lives in exactly one pool
   (409 `already_in_pool` says which).
4. Office move: [CONFIRM] `voice_pool_e911_apply` registers the pool's local members against one
   validated address - a carrier call per number, and it changes 911 dispatch.
5. A per-number whisper, greeting or routing value silently BEATS the pool's. When one member
   behaves differently from its siblings, `voice_number_get` on that DID before touching the pool.

**config** - the per-project, per-environment swap config:
1. `voice_phone_tracking_config_get` with `env` FIRST, every time. `config: null` beside a
   production sibling means "off here, live there", not "never set up".
2. [CONFIRM] `voice_phone_tracking_config_set` is a FULL REPLACE, not a merge: every field you omit
   resets to its default, and omitting `swap_source_numbers` CLEARS the stored list. Resend every
   field from the GET plus your change; `environment` travels in the body. `swap_source_numbers`
   holds max 5 entries (human formats accepted, stored as E.164; one unparseable entry rejects the
   whole write and names it). The one exception: `consent_mode` omitted means unchanged.
3. A `consent_mode` change, and turning tracking ON, do NOTHING on the live site until that
   environment is REDEPLOYED - the consent gate and the snippet are baked into the site HTML at
   deploy time. Turning it OFF (`enabled: false`, like `voice_phone_tracking_config_delete`)
   stops new assignments on the next page load; only the tag lingers until the next deploy. Say
   so every time, name the deploy (`/hiveku:deploy`, one site, with its owner's yes), and never
   mass-redeploy the fleet to roll a consent change out.
4. [CONFIRM] `voice_phone_tracking_config_delete` turns tracking off for that environment; the
   snippet in the deployed HTML survives until the next deploy but assigns nothing.

**test**: `voice_swap_test` once (on a PPC key, `voice_call_tracking_live_probe` with
`live_probe: true` - one of them, never both; each holds a DID for the sticky window), then
`voice_call_tracking_diagnose` on whatever it surfaced. That proves the SWAP; where a swapped
number's call would RING is proven without any test call by `voice_call_tracking_trace` (there is
no live test-call tool). `assignment.reason: 'source_excluded'` is
the source gate working, not a failure.

**health**: `voice_call_tracking_trace` first - the read-only routing trace per number (it never
dials, holds no DID and is safe to repeat): `route.first_stop`, whether anyone `can_ring_now`,
`recent_calls` (`refused_fast` calls died within 3 s), and fail codes such as
`pbx_inbound_rule_missing`, `forward_not_dialable`, `ring_group_empty` and `recent_calls_refused`,
each with its fix. With `connection_id` it traces every number serving on that ad account's call
assets and extensions and lists `untracked_on_ads` (numbers Hiveku does not own, e.g. a typo).
"Answered" on a forward means the far end picked up, which can be its voicemail. Unknown is not
pass. Then `voice_call_tracking_diagnose` - read the ORDERED `fix_first` list, not the raw check
array; a `number_tracking` check at `fail` with `details.pool_exhausted: true` is the live
starvation signal, and the fix it names is inventory, not a shorter hold. Then `voice_pool_get`
per pool for the `occupancy` block - `dids_available` is what a new visitor can still get right
now; read it BEFORE any sizing arithmetic. Then `voice_call_tracking_outbox` with
`status: 'failed'` first (`platform` narrows to one lane; `outcome: 'uploaded_duplicate'` is
success, never a retry) - an empty outbox is ambiguous (nothing was ever enqueued, or everything
uploaded cleanly); disambiguate before concluding anything from it. History lives on the ops
inbox: `agent_inbox_list` with `category: 'voice.pool_starvation'` and again with
`category: 'voice.swap_health'`, passing `status: 'new,seen,snoozed,actioned,dismissed,expired'`
(the default is the open queue only) - a pool that starved last month is a sizing finding even
when it is fine right now.

**exhausted** ("the tracking numbers ran out", a starvation email, `pool_exhausted` from the
doctor) - in this order, and nothing is bought before step 4:
1. `voice_pool_get`: the `occupancy` block. `exhausted: true` with `dids_available: 0` is the live
   fact; `members_active` below `member_count` means inactive or stale members are quietly
   shrinking capacity - fix those before buying.
2. `voice_pool_sessions_list` - THE NON-MINTING READ: it lists the sessions holding the DIDs right
   now and never asks the pool for a number, so it holds nothing and is safe to call repeatedly
   (unlike `voice_call_tracking_live_probe` and `voice_swap_test`). Rule out a probe loop BEFORE
   buying: many sessions minted seconds apart from one `visitor_hash`, or a pile from the
   `development` environment, is a monitor someone built - kill the loop first; the pool recovers
   within a sticky window. Rows are real visitors' sessions (masked hash, UTMs, the click-id TYPE,
   the DID shown) - quote counts, not rows, in anything a client sees.
3. Rule out hold pile-up: `occupancy.converted_holds` counts DIDs parked by
   `conversion_sticky_days` after a call. A promo spike that converts the whole pool is SUCCESS;
   the fix is still inventory, never a shorter hold (the hold protects callbacks).
4. The arithmetic: busiest-hour concurrent visitors divided by 4, never fewer than 4 DIDs, against
   `members_active`. Then `voice_call_tracking_setup` with `did_count` = the new target -
   `dry_run: true` first, [CONFIRM] the real run (it buys only the shortfall, max 5 per run, every
   number bills monthly) - or [CONFIRM] `voice_pool_numbers_add` for DIDs already owned. Verify
   with `voice_pool_get` occupancy and ONE `voice_swap_test`.
5. If the client declines to buy: say plainly what `swap_fallback` means - visitors beyond
   capacity see the main number and attribute only by breadcrumb - and record the decision.
6. `agent_inbox_list` with `category: 'voice.pool_starvation'` and the full status list: a pool
   that has starved before is a sizing problem, not an incident.

**callrail-cutover** - the order is load-bearing:
1. Point our snippet at CallRail's numbers through the **config** lane:
   `voice_phone_tracking_config_get` first, then [CONFIRM] `voice_phone_tracking_config_set` with
   the FULL config plus the numbers CallRail currently displays on the site in
   `swap_source_numbers` (up to 5), so Hiveku swaps THEIR numbers out while their script is still
   installed.
2. Verify the swap won the page: `voice_swap_test`, once.
3. Port the numbers - `/hiveku:port-numbers`. After FOC, [CONFIRM] `voice_pool_numbers_add` for
   the ported DIDs that should rotate, or tag the ones printed on trucks and listings as static
   source numbers (below), then the office-move step in **pools** for E911.
4. Remove the CallRail script LAST, only after Hiveku is proven to be measuring. Never leave both
   scripts measuring the same site beyond the verification window - double-counted calls poison
   the ads data in both systems.

**Not everything tracked is a pool.** A billboard, truck, radio or GBP listing number is a tagged
STATIC number - `voice_number_update` with `tracking_source` / `campaign_name`, the optional step
in `/hiveku:phone-setup` - not a pool: it attributes to the source label and, with no web session
behind it, can never upload a click-level conversion.

**Report** in this order: what exists now (pools, occupancy, config per environment) → what the
dry run says would change → money spent or about to be spent (`did_count`, monthly billing, PSTN
forwards) → swap-test result → diagnose `fix_first` → outbox failures → what needs a REDEPLOY →
the next human action.

**What NOT to do.** NEVER run `voice_call_tracking_live_probe` or `voice_swap_test` on a schedule
or in a loop - each writes a pool session and holds a DID for the sticky window; on a small pool it
starves real visitors of swap numbers (`voice_pool_sessions_list` and `voice_call_tracking_trace`
are the loop-safe reads). Never
`voice_phone_tracking_config_set` without the GET in the same session - it is a FULL REPLACE and
you just cleared `swap_source_numbers` mid-cutover. Never report a `consent_mode` change, or
tracking turned ON, as live before the redeploy (turning it OFF is live on the next page load;
only the tag lingers). Never `voice_pool_delete` a pool with live sessions - drain it
with `is_active: false`. Never send `voice_pool_update` a `destination` without saying it rewrites
every member's routing. Never run the real setup without a dry run in the same session. Never
leave CallRail and Hiveku both measuring. Never sum platform-reported and Hiveku-recorded call
conversions.

Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
