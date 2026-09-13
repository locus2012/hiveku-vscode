---
name: hiveku-conversion-tracking
description: Operator manual for conversion tracking and attribution on a Hiveku account. Use for ANY report that conversions, leads, or attribution are wrong or missing - "conversion tracking is broken", "not recording conversions", "Google Ads shows zero", "the numbers don't match", "our leads aren't showing in Google Ads", "Awaiting conversions", form submissions missing or duplicated, spam leads, form tracking, call tracking, DNI, call attribution, GTM tags and containers, UET and Bing goals, Meta pixel and CAPI, offline conversions and deal-won uploads, gclid / msclkid / fbclid, consent mode, tag not firing, double counting, "why does this paid lead read as Organic". ALSO the voice operations surface - phone system health, "the phones aren't ringing", "is my phone system set up", IVR, ring group, extension, voicemail, call queues, "outbound calls rejected" / can't dial out, toll-fraud cap, E911 addresses. ALSO load FIRST for any risky ask on this territory, because the refusal rules live here - "release that phone number", "delete the ring group / IVR / extension", "raise the toll-fraud cap so we can keep dialing", "skip the dry run / just confirm the upload", "upload every conversion now", "buy more tracking numbers", "clear localStorage to fix attribution", "mark all the voicemails read".
---

# Hiveku Conversion Tracking

Real ad money rides on these verdicts: diagnose in order, quote the tool that proved it,
never conclude from an absent number. Before any causal story ("the campaign fatigued",
"the algorithm changed", "tracking broke on Tuesday") rule out the measurement artifact
first - a stale connection, a window mismatch, a tag that fell off on a deploy - because
in this discipline the artifact IS the usual cause.

Tool claims in this skill and its references were verified against the live registry on
2026-08-28. The registry grows; when a reference says a tool does not exist and the date
above is old, re-check before repeating the claim.

## The chain, click to platform

A visitor arrives with a click id (`gclid`, `gbraid`, `wbraid`, `msclkid`, `fbclid`,
`ttclid`, `twclid`, `li_fat_id`) plus any `utm_*`. The `hiveku-analytics.js` embed (R2, via
`track.hiveku.com`) captures them unconditionally into localStorage `hiveku_utm_params` for
90 days, mints `hiveku_visitor_id` and a 30-minute session, and records the landing page.
Events POST to `track.hiveku.com/v1/visitor-tracking/ga4-event` (**204** = accepted; a
non-2xx is a rejection, never "processed"), queue, then fan out to ClickHouse and the
builder's `visitor-upsert` / `form-lead` endpoints. A form submission writes its
ledger row FIRST, then upserts the CRM contact, stamping click ids in four places: `gclid` /
`click_ids` (current touch), `original_gclid` / `original_click_ids` (write-once first
touch), and `source_history[]`, the only one that knows WHEN a click happened. The DNI
snippet adopts the same visitor id, so calls share that identity. A won deal or qualifying
call then uploads back to the platform as an offline conversion, which needs that click
dated from `source_history`. Every link fails silently, into a smaller plausible number.

## THE TRIAGE LADDER

Run this order for ANY "tracking is broken" report; do not skip to the interesting step.

**0.** `account_context_get({ domain })` before any strategy or client-facing writeup.

**1. Are the numbers trustworthy?** `ppc_digest` first, always: it flags stale connections
across platforms (over 25h since sync), and a stale connection makes every number below it
a lie. Fix the connection before diagnosing anything else.

**2. One scorecard call.** `analytics_channel_scorecard({ days })`. Slow: call it ONCE,
never in a loop or per channel. Per channel read `verdict`
(`tracking | partially_tracking | not_tracking | unknown`), `headline` (relay VERBATIM, it
carries the number that makes the problem undeniable), `hiveku_recorded` vs
`platform_recorded`, `missing`, `how_we_know`, `how_to_fix`, `how_deeply_we_can_see` and
`conversion_actions[]`, whose window is FIXED at 30 days and does NOT follow `days`.

**3. Branch on the verdict.**

| Symptom | Do | Reference |
|---|---|---|
| `not_tracking`, or a tag "definitely installed" | `analytics_diagnose_tracking({ project_id })`, then `analytics_probe_page` on the money URL | diagnosis, site-instr. |
| Google numbers wrong, actions look dead | `ppc_conversion_tracking_status` (judge silence on `all_conversions`, never `conversions`), then `ppc_conversion_actions_list`. Both GOOGLE ONLY: elsewhere they error, they do not return empty | diagnosis |
| Bing reports zero | `ppc_bing_conversion_tracking_status`, then `ppc_bing_uet_tag_list` | diagnosis |
| Meta looks quiet | `ppc_meta_custom_conversions` + `ppc_meta_conversion_volume` | diagnosis |
| Forms missing, duplicated, or spammy; leads the platform never got | `marketing_form_conversion_audit` | forms |
| Calls unattributed, or "stopped after a redeploy" | `voice_call_tracking_diagnose` (the call doctor - read its ordered `fix_first`), then `marketing_call_attribution_breakdown`, `marketing_call_attribution_list`, `voice_diagnose_setup` | calls |
| Real leads the platform cannot optimise on; "push CRM sales back to Google / Meta", "close the loop on click to sale" | `marketing_offline_conversions_status` FIRST, then the declared lane (google / microsoft / meta; opt-in lands in validate-only, go-live is a human dashboard flip); rows you assembled yourself go by the two-step `ppc_offline_conversion_upload` (Google only) | offline-conversions |
| GTM or a pasted tag involved | `seo_gtm_install_status` / `seo_gtm_status`, `project_custom_code_get` | site-instrumentation |
| The PHONE SYSTEM itself: not ringing, wrong IVR, extension unreachable, outbound rejected, E911 | `voice_diagnose_setup` (no args) FIRST, then the **hiveku-phone-agency** skill (`hiveku-phone-agency/references/pbx-routing.md`) or `/hiveku:phone-check`. Not an attribution question - do not start at the scorecard | phone-agency |

**4. Name the broken link out loud** ("the click id never reached the CRM", "the tag is in
the code but not in the served HTML"). A verdict without a named link is a guess. Then
write, per the discipline below, recording durable conclusions with `memory_create` and
work items with `pm_tasks_create`.

Reporting discipline for the writeup:
- Closed vocabulary. `unknown` and not-applicable never become passes; a source you could
  not read makes the report PARTIAL, never zero. Say "unreadable", exclude it from the
  denominator, and never hide a partial status in the summary line.
- Sample transparency. Any verdict resting on a sample (transcripts pulled, rows drilled)
  names N, how the sample was chosen, and what was excluded.
- Comparability gate. Never sum or difference Hiveku and platform numbers until they share
  the same conversion definition, attribution window, and timezone (breakdown days run in
  the AD ACCOUNT timezone). Until then, report them side by side with their definitions.
- Escalation has one channel. "Escalate as infrastructure" (a stuck outbox after reading
  it, the three-artifact tracking-worker deploy, `transcript_state: unreadable`) means
  `pm_tasks_create` carrying the tool evidence verbatim - never a vague "raised it".

Recurring cadence: `/hiveku:tracking-check` is this ladder as a standing per-channel
verdict - run it weekly rather than re-deriving. Daily offline-upload batching (Meta's
7-day window demands it) is a workflow job, not a habit: build it with the `workflow_`
tools or `/hiveku:automate`, dry-run first.

## The traps that make a diagnosis WRONG

1. **Null is not zero, and silence can mean the check never ran.**
   `conversions_last_30_days: null` in `analytics_channel_scorecard` means WE COULD NOT
   READ IT; `depth: 'none'` is not healthy; an empty `ppc_meta_custom_conversions` list
   means none are defined, since a failed read returns `readability` / `coverage_gap`
   instead. With no probe `analytics_diagnose_tracking` emits NO runtime findings at all, so
   read `caveats` and `browser_checked`. Its 400 fires only when you OMIT `project_id` and
   the account has no live project with a custom domain; an explicit `project_id` on a
   domainless project returns 200 with source-scan findings only (`browser_checked: false`,
   and no `tag-not-deployed`, since that finding needs a served page to compare against).
   The scorecard resolves its project the same way. Reading any of it as zero declares a
   client's campaigns dead when the fault is a broken connection.

2. **`click_dated: 0` means NOT MEASURABLE.** In `marketing_form_conversion_audit`, if
   `click_window.click_dated` is 0 then `clicks_before_range: 0` proves nothing. Only
   `first_touch_from === 'captured_at'` DATES a click; the others merely BOUND it (the click
   happened at or before `first_touch_at`). A wrong timestamp is worse than none.

3. **Saved is not live, committing is not deploying.** Custom-code edits save instantly and
   apply only on the NEXT DEPLOY of that tier; GTM edits are workspace DRAFTS until
   `seo_gtm_version_create` then `seo_gtm_publish`; `seo_gtm_install_status` reports SAVED
   state, blind to a container hardcoded in the site's source. `tag-not-deployed` from
   `analytics_diagnose_tracking` ("in the code but not in the served HTML") is THE most
   common reason a tag that is definitely installed records nothing.

4. **Most embeds in the field are STALE.** Ingest worker, queue consumer and embed are three
   separate deploy artifacts and sites hard-cache the embed, so never explain a gap with
   "the embed does X now". Server-side paths exist to reconstruct what an old embed did not
   send, recovering attribution as `utm_params -> landing_page -> page_path`.

5. **First touch wins PERMANENTLY.** Once `hiveku_utm_params` is non-empty the embed returns
   it and never rewrites it: a LATER ad click is not added, does not move `capturedAt`, and
   survives only in the landing URL. Hence most "wrong attribution" reports, and its twin: a
   real Google Ads click reads as Organic whenever localStorage was unavailable (private
   mode, ITP, consent gate, stale embed) while the gclid sat in the landing URL.

6. **Spam still writes a row.** Spam is filed, not discarded, so a third-party beacon
   inflates the Forms tab (Meta's pixel posting `website_context.location` minted about 89 a
   day). And the reCAPTCHA hostname list is the ONLY domain gate: a token minted on a host
   missing from the project's registered hostnames scores 0 and that lead is SILENTLY filed
   to spam. Check hostnames (`project_domains_list`) before believing "leads stopped coming
   in"; the remedy is `project_domains_add` - forms reference, section 4.

## Write discipline

- CONFIRM every write. Nothing client-visible (a published GTM version, a deploy, an
  upload) without an explicit yes, and never bulk-apply. `project_custom_code_set_tier`
  REPLACES a whole tier, DELETING pages omitted from `pages`: read
  `project_custom_code_get` first and echo back what survives.
- `ppc_offline_conversion_upload` (Google Ads only) and `ppc_customer_match_upload` are
  TWO-STEP by design: the first call returns a dry-run preview with
  `requires_confirm: true` and uploads NOTHING; you repeat the IDENTICAL call with
  `confirm: true`. Show the preview and its refusal reasons first; never shortcut this lane.
  Workaround closures: do not batch several uploads behind one yes, do not confirm a preview
  the human never saw, do not re-preview with refused rows silently dropped and call it the
  same batch, and never work around a refusal reason by substituting `updated_at` as a click
  date or `null` consent as granted - the refusals are the safety model, not friction.
- The declared `marketing_offline_conversions_*` lane (deals, form leads, Shopify orders to
  google / microsoft / meta) is safe by construction until a human decides otherwise: `opt_in`
  ALWAYS lands in validate-only (payloads proven, NOTHING recorded), the go-live flip is a 403 for
  agents and a dashboard action for an owner, `validate_only` only ever moves toward safe, and on
  a LIVE account `run` records conversions that reach Smart Bidding and cannot be un-sent -
  `status` first, `preview` before `run`, run once, read the tallies, never loop. Hiveku never
  creates a conversion action; `designate` points at an existing one. Reference:
  offline-conversions, section 13.
- The call-conversion doctor IS a tool family now: `voice_call_tracking_diagnose` (seven
  checks, each `ok | warn | fail | unknown`, plus an ORDERED `fix_first` list - read
  `fix_first`, and an `unknown` is NOT a pass), `voice_call_tracking_outbox` (row-level
  upload outbox - read it BEFORE escalating `outbox_stuck`), `voice_call_tracking_live_probe`
  (proves number swapping end to end, but HOLDS a real tracking DID for the sticky window -
  run it to confirm a fix, never on a schedule), and `voice_call_tracking_setup` (idempotent
  end-to-end wiring whose `did_count` field is the ONLY thing that SPENDS MONEY - omit it or
  send 0 and nothing is bought; always `dry_run: true` first). The Google Ads "Import"
  conversion source setting still lives in the Ads UI.
- DNI pool inventory is `voice_pools_list` (every pool with member DIDs and routing; treat
  its whisper/greeting/attribution-model block with suspicion - it comes from a second read
  that can silently fail). Whether the snippet is live is `voice_call_tracking_live_probe`,
  or `analytics_probe_page` + `analytics_diagnose_tracking`'s `tag-not-deployed` when you
  must not burn a pool session.
- The `voice_*` family now carries a WRITE surface: ring group / IVR / extension CRUD,
  `voice_settings_update` (including `daily_outbound_cap_cents`, the toll-fraud ceiling),
  `voice_number_release`, blocked-number edits, SMS sends. These are LIVE phone-system
  changes, not drafts - an IVR create spends TTS money and answers real callers on return.
  Confirm each one individually with named ids; never bulk-apply. E911 registration
  (`voice_e911_address_create`) and direct DID purchase (`voice_number_purchase`) are tooled
  now too - both ask-gated money/safety writes owned by the **hiveku-phone-agency** skill;
  inside a TRACKING-pool context prefer `voice_call_tracking_setup`'s `did_count` (capped at
  5 per run, E911-gated), which stays the one purchase path this skill itself reaches for.
- HARD STOP, a response contract: "The phones are quiet anyway - release the unused numbers
  and delete the old ring groups so the bill drops." Refuse the bulk form outright.
  `voice_number_release` PERMANENTLY returns the DID to the carrier - it can be resold to a
  stranger, and every printed instance (signage, GBP listing, ad call extensions) breaks;
  deletion targets are never derived by pattern ("unused", "old"), only from explicit ids
  the operator named. Offer the reversible path: the inventory (`voice_numbers_list`,
  `voice_pools_list`, `voice_ring_groups_list`), what routes where, then one confirmed
  release at a time, by digits. The same contract covers "raise the toll-fraud cap and keep
  dialing" (the cap is a spend guard that did its job - report what burned it first),
  "skip the preview, just upload everything", and "flip offline conversions live so the numbers
  move" (no tool can; the flip is the owner's, in the dashboard, after reviewing a validate-only
  run).

## Which key can run which rung

The ladder assumes a FULL-profile key. Scoped keys see prefixes, and a tool outside your
profile is INVISIBLE - the call fails as an unknown tool, which mid-ladder reads exactly
like a product gap. It is not; check the key before filing one.

- `marketing-ads` (the natural conversion-tracking key): `ppc_`, `analytics_`,
  `marketing_`, `workflow_` - steps 1-3 of the ladder run. NOT `voice_` (the whole call and
  phone surface), NOT `seo_` (all `seo_gtm_*` and `seo_ga4_*`), NOT `project_` (custom
  code, domains) or `sites_list` or `deploy_site`, NOT `crm_calls_list`. Its
  `get_project` / `list_projects` return PM projects - the wrong id space for site tools.
- `marketing` (catch-all): adds `seo_` (GTM and GA4 rungs work) but still no `voice_`,
  `project_`, or `crm_calls_list`.
- `helpdesk` and `communications`: `voice_` (the section 13 phone ladder runs; helpdesk
  also gets full `crm_`) but no `analytics_` / `ppc_` / `marketing_`, so the attribution
  ladder dies at step 1.

On a scoped key, a fix whose tool you cannot see ships as `pm_tasks_create` with the exact
tool name for whoever holds the wider key - e.g. `tag-not-deployed`'s fix is `deploy_site`,
invisible to every marketing profile.

## Reference map

| File | Load when |
|---|---|
| `references/the-chain.md` | Storage keys, ingest payloads, click-id fields, `first_touch_at`. |
| `references/diagnosis.md` | Any live investigation: finding codes, per-platform status tools. |
| `references/forms.md` | Missing, duplicate, or spam leads: `form_key`, sources, reCAPTCHA. |
| `references/calls.md` | Call tracking and DNI: pools, matchers, the call doctor, transcripts. §13 is voice operations: phone system health, routing, queues, voicemail, toll fraud, E911 - reads plus a live-PBX write surface with its refusal rules. |
| `references/offline-conversions.md` | "Push CRM sales back to Google / Meta", "offline conversions", "close the loop on click to sale": the declared `marketing_offline_conversions_*` lane and its validate-only doctrine, the hand-upload tool, gates, dating, consent, refusals. |
| `references/site-instrumentation.md` | Getting tags onto the page: code tiers, consent, GTM CRUD. |
