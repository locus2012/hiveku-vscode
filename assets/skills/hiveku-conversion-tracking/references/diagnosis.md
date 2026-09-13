# Reference: DIAGNOSIS - the conversion tool ladder

The complete tool ladder for "why isn't this converting?" For each read-only tool: what it answers,
what to read, what each verdict means, what it CANNOT see, and what to do next. Load this when a
client reports missing or unbelievable conversion numbers, when a platform number and the CRM
disagree, before changing a conversion action / tag / bidding strategy, and before touching the
offline-upload lane. Diagnosis is read-only; every fix it points at is a separate confirmed write,
and the offline-upload lane is two-step by design.

Order: `ppc_digest` FIRST for freshness - **over 25 hours since last sync is stale**, so every
platform number below it is a snapshot of an unknown yesterday and "conversions dropped to zero
Tuesday" from a connection that last synced Monday is a sync finding, not a tracking finding. Then
`analytics_channel_scorecard` (which channel, how short), `analytics_diagnose_tracking` (the cause
in code) and `analytics_probe_page` (one URL), the per-platform rungs, the form and call gap audits,
then the saved-container check. Rungs 1 and 2 resolve their project the same way: a 400 fires only
when `project_id` is OMITTED and the account has no live project carrying a custom domain (a setup
finding, not a tracking finding). Pass an explicit `project_id` and a domainless project still
returns 200 - source-scan findings only, `browser_checked: false`, and no `tag-not-deployed`,
because that finding needs a served page to compare against.

---

## 1. `analytics_channel_scorecard` - the headline answer

Why Google Ads / Meta / Microsoft is not recording conversions. **Slow - call it ONCE, never in a
loop, never once per channel.** `days` 1-90, default 30.

`verdict` ∈ `tracking | partially_tracking | not_tracking | unknown`: `tracking` = a conversion-role
signal was observed; `partially_tracking` = something fires but the platform is short of
`hiveku_recorded`, the most valuable verdict because the gap is measurable; `not_tracking` = nothing
conversion-grade observed, go to rung 2. **`unknown` is not `not_tracking`** - never call tracking
broken on an `unknown`.

Also read: `headline`, which you **relay VERBATIM** because it carries the number that makes the
problem undeniable; `hiveku_recorded` vs `platform_recorded` with the delta in `missing`;
`how_we_know`, the evidence that ends the argument with the client; `how_to_fix` and `agent_task`
(the same fix written for a coding agent); `how_deeply_we_can_see`, where **`depth: 'none'` is not
healthy** but means the verdict is provisional; plus `in_the_ad_account`, `conversion_actions[]`.

Two star traps:
1. **`conversion_actions_window_days` is FIXED AT 30 and does NOT follow `days`**, so with `days: 7`
   the channel numbers cover 7 days while action numbers still cover 30 - never compare them, never
   label action counts with the `days` you passed.
2. **`conversions_last_30_days: null` means WE COULD NOT READ IT, never zero**; reporting a null as
   "recorded nothing" invents a dead tag and sends someone to fix a healthy one. Say "unreadable".

Web conversion events counted Hiveku-side: `form_submit`, `cta_click`, `outbound_click`,
`file_download`. If the client's real conversion is something else, `hiveku_recorded` is not
measuring what they think.

Call reconciliation causes (why observed calls did not become platform conversions):

`upload_disabled` (setting off) needs the account opt-in, confirmed with the client first;
`no_click_id_captured` (no gclid/msclkid on pool sessions) goes to rung 8 plus
`voice_diagnose_setup`; `outbox_stuck` (queued, not draining) is infrastructure - read
`voice_call_tracking_outbox` first (filter `status: 'failed'`) so the escalation, a
`pm_tasks_create` with the row counts and error codes, quantifies the stuck rows instead of
guessing; `action_missing` needs an action designated for that source; `action_disabled`
needs enabling in the ad account; `action_not_counted` means it fires but sits outside the
Conversions column, which is fine if deliberate; `no_upload_lane` means no (connection, source)
mapping row exists; `platform_unreadable` is not a failure, recheck the connection.

Cannot see the code: it says a channel is not tracking, never which line is at fault.

---

## 2. `analytics_diagnose_tracking` - the cause in the code

Input `{ project_id? }`. Scans project source AND loads deployed pages in a browser.

**Read `browser_checked` and `caveats` FIRST, because if no probe succeeded the runtime findings
emit NOTHING** - deliberately, since an unreachable site would otherwise report "your conversion
never fires" for every channel at once. An empty runtime section means either all-clear or we never
got in, and `browser_checked` is the only way to tell.

Findings carry `what_is_wrong` / `how_we_know` / `how_to_fix` / `agent_task`, plus a
`coding_agent_brief` to hand straight to a coding agent.

Source findings:
- `dead-guard:*` - a conversion gated on a value NO route passes (it resolves every value any call
  site passes and flags when the literal is never among them); it has never fired, so fix the guard.
- near-duplicate conversion labels - **Google accepts the request and silently records nothing**;
  correct the label against the ad account.
- `send-to-unconfigured` (a `send_to` for an account never configured or loaded),
  `thankyou-no-conversion` (a thank-you route with no conversion on it) and `spa-history-trigger`
  (SPA route changes not wired to a history trigger) each name their own fix.
- **`tag-not-deployed`** - in the code, not in the served HTML; **committing is not deploying**, THE
  most common reason a tag "that is definitely installed" records nothing. Fix: `deploy_site`.
- `consent-no-url-passthrough` - Consent Mode without `url_passthrough`; click ids lost on navigation.
- **`duplicate-conversion-paths`** - hardcoded snippet PLUS GTM, so every conversion double counts,
  reading as performance improving while corrupting every downstream CPA and ROAS. Remove one.

Runtime findings (nothing emitted if no probe succeeded):
- **`conversion-never-fires:<channel>` CRITICAL** - "this is why every conversion action sits on
  Awaiting conversions: there is nothing to await." Its `agent_task` orders the checks: published
  container vs draft workspace, then History Change vs Page View trigger, then a snippet rendered
  under a condition the live route never satisfies. Work them in that order.
- `channel-tag-absent` - the tag was not present at runtime at all.
- **`conversion-fires-denied` CRITICAL** - it left the browser consent-denied, so it is delivered
  but unattributable, and **this is the one that looks completely fine in a network trace**.
- `spa-no-history-change-observed` - route changes never produced a trigger.
- `consent-default-after-container` - GTM boots before Consent Mode defaults are set.
- **`consent-changes-outcome` CRITICAL** - the channel records only when the banner was already
  accepted, and most visitors never touch the banner, so this is a direct multiplier, not an edge
  case.

Channels held to account: connections with status `connected` OR `error` (`error` on purpose - a
connection that broke last week is still being spent on); `pending` excluded. Cannot see the ad
account's configuration (rungs 4-6) or leads captured but not counted (rung 7).

---

## 3. `analytics_probe_page` - one URL, both consent states

Loads the URL TWICE, returning `as_first_time_visitor` and `as_visitor_who_accepted`, and
**comparing their `observed` arrays is the entire point**. Signal in both: fine on this axis. Only
in `as_visitor_who_accepted`: `consent-changes-outcome` in the concrete, and the client is losing
every visitor who ignores the banner. In neither: it does not fire here at all, so do not blame
consent.

**Star: only a `conversion`-role signal makes a channel "tracking"** - container, tag-present and
pageview do NOT count, so seeing `gtm` or a pixel in `observed` and reporting "tracking works" is
the easiest way to tell a client the wrong thing.

`blindSpots` is on EVERY result (the tool reads resource timing, not protocol-level interception).
It refuses URLs on domains the account does not own and sees nothing beyond the one URL.

---

## 4. Google - `ppc_conversion_tracking_status`, `ppc_conversion_actions_list`

Both **GOOGLE ONLY**: pointed at another platform's connection they return a wrong-platform error,
not an empty result, so an empty-looking result is never "Microsoft has no actions."

**`ppc_conversion_tracking_status`** - read `action_count`, `enabled_count`, `silent_count`, the
per-action list, `warnings[]`.

The most misread pair in the product: **`conversions` = only actions in the Conversions column that
Smart Bidding optimises on; `all_conversions` = everything the account records; SILENCE IS JUDGED ON
`all_conversions`.** So `conversions: 0, all_conversions: 50` is **NOT** a dead tag - it is a healthy
action excluded from the Conversions column (`include_in_conversions_optimization: false` on
`ppc_google_conversion_actions`). Read the pair backwards and you "fix" working tracking, and
flipping that action into the Conversions column silently changes what Smart Bidding optimises
against on a live budget.

Second star: a date-segmented query returns NO ROW for an action with zero conversions, so the old
single query omitted exactly the actions worth reporting - **a higher `enabled_count` /
`silent_count` than the client remembers is the fix working, not a regression.** A truly silent
action (zero `all_conversions`) goes to rung 2, or rung 9 if a container is involved.

**`ppc_conversion_actions_list`** - id, name, `status` (ENABLED/REMOVED/HIDDEN), category, counting
type (ONE_PER_CLICK/MANY_PER_CLICK), attribution model, lookback windows, value settings, type,
origin, `primary_for_goal`.
- `REMOVED`/`HIDDEN` on an action believed live explains everything.
- **Counting type is the #1 cause of a platform number ABOVE the CRM**: MANY_PER_CLICK counts every
  submission from one click while the CRM dedupes to one contact, so three submissions = 3 platform
  conversions and 1 CRM lead, nothing broken.
- A 90-day lookback credits conversions to clicks from before the reporting window opened.
- `always_use_default_value: true` **flattens every conversion to one number and destroys
  transaction-level revenue reporting**: tROAS bids against a constant and revenue never reconciles.
- For calls, `phone_call_duration_seconds` means shorter calls record NOTHING.

Neither tool sees whether the tag fires; configuration only.

---

## 5. Microsoft - `ppc_bing_conversion_tracking_status`, `ppc_bing_uet_tag_list`

**`ppc_bing_conversion_tracking_status`** - UET tags plus install state, goals plus recording state,
`ready_for_conversion_bidding`, plain-language verdict. **Star: run this BEFORE switching any
campaign to `max_conversions` / `target_cpa` / `target_roas`**, because
`ppc_platform_bidding_strategy_update` does **not** refuse an unbacked strategy (the refusal was
removed on 2026-08-24) - it reports `conversion_signal` and applies the switch anyway, including
`check_failed`, which means the goal read itself failed and the switch went in **unverified**. The
platform is not your safety net here; this call is.

**`ready_for_conversion_bidding` is TRI-STATE, not a boolean.** `true` only when a complete goal list
backs it and at least one goal has recorded. `false` means proven not ready. `null` means the goal
list was incomplete or never read, so nothing in the response authorizes a conversion strategy either
way. Null is falsy in every language you will write the check in, so gate on `=== true`, never on
`if (!ready)` and never on truthiness. Read `ready_for_conversion_bidding_confidence` (`verified`
only when the flag is a real boolean), `goal_list_coverage` and `goal_read_error` alongside it, and
remember the counts (`conversion_goal_count`, `recording_goal_count`, ...) are `null`, never `0`,
when the goal read did not happen: a null count is not "no goals exist".

**`ppc_bing_uet_tag_list`** - recording state per tag. **A tag not "recording" means the site snippet
is missing or broken, and that is the #1 reason a Bing account reports zero conversions** - almost
never the goals. Not recording: rung 2 (`tag-not-deployed`) and rung 9. Recording but no goal
conversions: `ppc_bing_conversion_goal_list` to enumerate goals, and a URL goal on a single-page
thank-you page needs `uet_auto_spa_tracking` or it **silently never fires**. Creating either is
`ppc_bing_uet_tag_create` / `ppc_bing_conversion_goal_create`, both writes, confirm first. Cannot see
the browser: "recording" means hits arrive, not that they arrive consent-granted or on right pages.

---

## 6. Meta - `ppc_meta_custom_conversions`, `ppc_meta_conversion_volume`

A deliberate pair, deliberately NOT merged. `ppc_meta_custom_conversions` gives definitions plus
`last_fired_time` **per conversion**, and that grain is the point because one pixel serves every
conversion, so a pixel-grain check cannot tell a dead LEAD from a live PURCHASE.
`ppc_meta_conversion_volume` gives `attributed_conversions`.

- Stale `last_fired_time`: a tracking failure. Rung 2.
- Recent `last_fired_time` with zero or low `attributed_conversions`: **a MEDIA finding, not a
  tracking failure** - it fires and the ads are not driving it, so "your tracking is broken" here
  sends an engineer after a media problem.

**Empty-list trap:** an empty list means **no CUSTOM conversions are defined**, not a failed read; a
failed read returns `readability` / `coverage_gap` and **never** an empty list. Cannot see standard
events that are not custom conversions, or why Meta attribution differs - its offline lane sends
only `fbc` and refuses enhanced match mode (`policy_no_pii`), so matching is structurally weaker.
To see the PIXEL layer beneath the conversions - which pixels the ad account actually has, and
which pages - `ppc_meta_pages_pixels` with `operation: 'list-pixels'` (or `'list-pages'`)
enumerates them; use it when the question is "which pixel is installed vs connected" before
debugging a custom conversion built on the wrong one.
Other platforms: `ppc_linkedin_conversions`; for TikTok, `ppc_tiktok_conversions` reads configured
conversions and `ppc_tiktok_pixels` manages the pixels themselves (`operation: 'list' | 'get' |
'create' | 'event-stats'`, event-stats capped at 10 pixel ids and a 30-day range).
GA4 is a conversion surface of its own - consent suppression skips google/microsoft/meta but NOT
GA4, and a misconfigured key event skews every GA4-sourced comparison. `seo_ga4_conversion_audit`
and `seo_ga4_key_events_list` (plus the `seo_ga4_key_event_create/update/delete` writes,
confirm-first) exist for exactly that; they carry no registered description beyond their method, so
read their output conservatively, and note they are `seo_`-prefixed - invisible on a
`marketing-ads` key.

---

## 7. `marketing_form_conversion_audit` - where the leads went

**The discrepancy buckets SUM TO THE TOTAL**, which makes this an explanation, not an estimate:
`deleted | duplicate | spam | archived | workflow_failed | no_attribution | unpaid_attribution |
counted`.
- `spam` includes leads filed by the hostname/reCAPTCHA check: a production site fronted by a proxy
  on a hostname not registered on the project scores 0 and is filed to spam with nobody told
  (remedy: register the domain).
- `no_attribution` = no click id at all; `unpaid_attribution` = attributed to a non-paid channel,
  where a real Google Ads click that read as Organic ends up; `counted` = actually credited.

Filters: `form_key`, `has_click_id`, `click_id_type`, `channel`, `attribution_window_days`, `bucket`.
Also read `click_window.click_dated`, `clicks_before_range`, `boundary_risk`, and per row
`attribution.first_touch_at` plus `click_time_is_exact`.

**Star trap: if `click_dated` is 0, then `clicks_before_range: 0` means NOT MEASURABLE, not zero**,
so reporting "no clicks fell before the range" off an unmeasurable window is a fabricated all-clear.

**`click_time_is_exact`** is the only thing that dates a click, and only when first-touch provenance
is the captured click instant; otherwise the timestamp merely BOUNDS it. A wrong timestamp is worse
than none: it is the difference between a clean offline upload and a `conversion_precedes_click`
refusal. Other form-side reads: `analytics_events_list` (`event_name=form_submit`),
`analytics_overview`, `analytics_sessions`, `analytics_traffic_sources`, `analytics_pages`,
`analytics_visitors`.

---

## 8. Calls

**`marketing_call_attribution_breakdown`** - groups by source/medium/campaign and by day **in the ad
account timezone**, so it lines up with the platform rather than the client's clock, and it reports
call QUALITY the platform structurally cannot: duration distribution against THIS account's
configured threshold, disposition mix, voicemail/missed/abandoned counts. That matters because
**Google counts a call as a conversion once it passes a minimum duration - a 12-second wrong number
is a conversion.** Returns NO call rows and NO transcripts.

**`marketing_call_attribution_list`** - the breakdown plus individual calls: source/medium/campaign,
the tracking DID that rang, the crediting pool session, duration bucket, whether the call meets the
account's conversion policy, `has_transcript`, `has_summary` (`include_summaries` inlines the AI
summaries). **Percentages cover up to 5000 scanned calls - check `totals.truncated` first.**

**`marketing_call_transcript_get({ call_id })`** - ONE call's verbatim unredacted transcript plus AI
summary. Pass the `id` from the list as `call_id`; that is the only property the schema declares and
it is required, so `{ id }` fails validation. A deliberately separate costlier step (S3 round trip), so never fetch in
bulk to browse. **When absent, `transcript_state` says WHICH of five: `never_recorded | pending |
failed | purged | unreadable`, and NONE of them means "empty"** - a retention deletion (`purged`)
misread as a transcription failure sends someone chasing a bug that does not exist.

Supporting reads: `voice_diagnose_setup` (`blocking_issues[]`) is the fastest check when calls are
not attributed at all; also `voice_recent_calls`, `voice_calls_list`, `voice_numbers_list`, and
`crm_calls_list` for per-contact history (filters `contact_id`, `company_id`, `deal_id`,
`has_recording`, `has_transcript`) - **`crm_get_contact` does NOT include calls**.

Swap health: `voice_pools_list` reads the pool inventory (answers `pool_empty` / `pool_exhausted`),
and `voice_call_tracking_live_probe` proves the swap end to end - it holds a real tracking DID for
the sticky window, so confirm fixes with it, never schedule it. `analytics_probe_page` covers the
snippet half without burning a pool session. The dashboard monitor's codes
(`site_unreachable | snippet_missing | pool_empty | pool_exhausted`) still only appear in the
dashboard - name the tool you ran instead of quoting them - and
**"attribution quietly stopped after a redeploy" is almost always `snippet_missing`** - the DNI
loader tag dropped off the page and nobody asks on the day it happens.

**The call doctor.** `voice_call_tracking_diagnose` returns seven checks
(`ok | warn | fail | unknown` each) plus an ORDERED `fix_first` list - read `fix_first`, and an
`unknown` (including one produced by `skip_google` / `skip_site_fetch`) is NOT a pass. Pass
`project_id` explicitly on multi-site accounts. `voice_call_tracking_outbox` shows the upload rows
one at a time (filter `status: 'failed'` first); `voice_call_tracking_setup` wires the lane end to
end (idempotent; `did_count` is the only field that spends money - `dry_run: true` first).
`analytics_channel_scorecard`'s call reconciliation causes name the same failures at channel level.
Full detail in the calls reference, section 9.

---

## 9. The saved-container check

**`seo_gtm_install_status`** findings that cost money: WRONG CONTAINER; **DUPLICATE INSTALL** (double
counts every conversion, reading as performance improving while corrupting every downstream
CPA/ROAS); TIER DRIFT (verified on staging, never installed on production - the "but we tested it"
story); head-only install; disabled row.

**Two star scope limits:** it reads **SAVED custom code ONLY**, so a container hardcoded in the
site's own source is INVISIBLE to it (use `analytics_diagnose_tracking`), and it reports the **SAVED
state, never the LIVE one.**

`seo_gtm_status` gives container-level status. `project_custom_code_get` returns `{ run_in_preview,
entries: [{ id, tier, page_path, head_code, body_code, enabled }] }`, where `page_path === ""` is
that tier's SITE-WIDE row. **Everything in GTM is a WORKSPACE DRAFT and nothing serves until
`seo_gtm_version_create` then `seo_gtm_publish`** - an unpublished tag is indistinguishable from a
broken tag in every platform report, and it is what `conversion-never-fires` says to check first.

Writes are writes: `project_custom_code_set_tier` **REPLACES a whole tier, so pages omitted from
`pages` are DELETED** (max 20000 chars/snippet) and must never be called without reading
`project_custom_code_get` first and confirming the full set. `project_custom_code_preview_toggle`
gates whether tracking fires while editing; `seo_gtm_install` installs a container.

---

## SYMPTOM TO CAUSE

**Deploy and propagation modes**
- *"Definitely in the code" but records nothing* - `tag-not-deployed`; committing is not deploying,
  and *verified on staging, dead on production* is tier drift (`seo_gtm_install_status`).
- *Custom code saved, nothing changed* - **custom-code edits save INSTANTLY but take effect on the
  NEXT DEPLOY of that tier. Saved is not live.**
- *Tracking worker "was deployed", behaviour unchanged* - **three separate deploy artifacts: the
  ingest worker, the queue CONSUMER, and the EMBED.** `wrangler deploy` ships only the ingest worker
  AND REPORTS SUCCESS ANYWAY; the consumer needs its own deploy; the embed lives in R2 and needs an
  object put PLUS a Cloudflare cache purge, and the edge cache strips query strings so `?cb=` does
  NOT bust it. Escalate as infrastructure; do not conclude the tag is broken.
- *An old client site behaves like an old embed* - **sites hard-cache the embed, so MOST EMBEDS IN
  THE FIELD ARE STALE**, which is why every server-side path reconstructs what an old embed did not
  send. Not an incident by itself.

**Consent modes**
- *Conversions uniformly 60-80 percent below sessions* - `consent-changes-outcome`; confirm with
  `analytics_probe_page`. *Fires in the network trace, absent on the platform* -
  `conversion-fires-denied`. *Click ids lost across navigation* - `consent-no-url-passthrough` or
  `consent-default-after-container`.
- *"Consent is suppressing everything fleet-wide"* - unlikely by design, because **consent FAILS
  OPEN: only an EXPLICIT denial suppresses**, and absent or unknown reads as not-denied precisely so
  a vendor field rename cannot silently kill tracking fleet-wide. If real, it is a bug; escalate.
- *Offline uploads skipped for a subset of contacts* - ad consent is **tri-state**: false = opted
  out, true = granted, **null = NO signal**. Only the form-lead collector sets it, because only a
  form submission happens in the browser where the signal exists, so a won deal or Shopify order
  leaves it undefined BY DESIGN. Suppression skips google/microsoft/meta but NOT GA4. Confirm via
  `ad_consent_denied` refusals in the dry-run preview.

**Attribution modes**
- *A real Google Ads click recorded as Organic or Direct* - click ids are read from `utm_params`
  ONLY, which is empty whenever localStorage is unavailable (private mode, ITP, a consent gate, an
  older cached embed) while the click id still sits in the LANDING URL; read-time recovery runs
  `utm_params -> landing_page -> page_path` and surfaces the origin so you can see exactly this.
  Confirm via the `unpaid_attribution` bucket.
- *A returning visitor's 40-day-old click dated today* - session start written as first touch
  without the landing-URL gate. Check per-row `click_time_is_exact`.
- *Client swears a LATER ad click drove the lead, we credit an older source* - **FIRST TOUCH WINS
  PERMANENTLY**: if the store is non-empty the embed returns it and NEVER re-writes, so a later
  click is not added, does not move the capture timestamp, and is recoverable only from the landing
  URL server-side. This explains most "wrong attribution" reports, and `source_history[]` on the
  contact is the ONLY place that knows WHEN a click happened.
- *Platform count ABOVE the CRM* - MANY_PER_CLICK counting, duplicate install, or short calls
  clearing the duration bar. *CRM count ABOVE the platform* - `no_attribution` /
  `unpaid_attribution` leads, consent-denied conversions, or the offline lane never enabled.
- *Calls attributed to the wrong visitor* - pool DID reassignment; session matching is anchored to
  `call.started_at` so a late sweep cannot credit whoever holds the DID now. Read the crediting pool
  session in `marketing_call_attribution_list`.

---

## Worked triage: "Google Ads shows 40 conversions, our CRM shows 12"

Do not start fixing. Find out which number is wrong - both can be right at once.

**1. `ppc_digest`.** Over 25h stale means the 40 is stale; continue, flagging figures as provisional.

**2. `analytics_channel_scorecard`** (once, `days: 30`). Read google_ads `verdict`, `headline`
verbatim, `hiveku_recorded`, `platform_recorded`, `missing`, `how_deeply_we_can_see`. 40 vs ~12 =
the platform counts things the CRM does not, take the inflation path (step 3). Both near 40 = the
CRM is losing leads Hiveku saw, take the loss path (step 5). `depth: 'none'` or
`conversions_last_30_days: null` = **stop quoting the 40 as fact** and fix visibility first.

**3. `ppc_conversion_actions_list`.** Counting type, attribution model, lookback, `status`. A
MANY_PER_CLICK action alone routinely explains a 40-vs-12 spread; a 90-day lookback means you are
comparing different periods; `phone_call_duration_seconds` means short calls count.

**4. `ppc_conversion_tracking_status`.** Read `silent_count`, `warnings[]`, and per action
**`all_conversions`, not `conversions`**: `conversions: 0, all_conversions: 50` is healthy and
merely outside the Conversions column, so do not "fix" it and do not add its 50 to the 40.

**5. `marketing_form_conversion_audit`** over the same window (`attribution_window_days` = the
lookback from step 3, `channel` = Google). The buckets sum to the total, so they name the missing
leads. **If `click_dated` is 0, `clicks_before_range: 0` means not measurable**; check
`boundary_risk` too.

**6. `marketing_call_attribution_breakdown`** for the same range if any of the 40 are calls: read
duration distribution against the account threshold plus voicemail/missed/abandoned. Google counted
a 12-second wrong number, the CRM created no lead, and both behaved correctly.

**7. Only if a genuine tracking failure remains:** `analytics_diagnose_tracking` (`browser_checked`
and `caveats` FIRST), `analytics_probe_page` on the top conversion URL comparing the two `observed`
arrays, then `seo_gtm_install_status` for DUPLICATE INSTALL, which shows up as roughly double.

Reconcile in writing:
> Platform 40 = X duplicate submissions from one click (MANY_PER_CLICK) + Y short calls past the
> duration bar + Z conversions credited to clicks outside the CRM window.
> CRM 12 = platform-counted leads minus A spam-filed, B duplicates merged, C with no paid
> attribution. Genuine tracking loss: D. Here is the fix for D.

X, Y, Z, A, B, C and D each come from a named call above. If you cannot source a number, write "not
measurable" - never fill the gap with a plausible figure.

Then the fixes, all writes, all confirmed. Deals, form leads and Shopify orders the platform never
received go up through the declared `marketing_offline_conversions_*` lane (google / microsoft /
meta; `status` first, `preview` before `run`, validate-only until a human flips live in the
dashboard - the offline-conversions reference, section 13). Rows you assembled yourself, with dated
click ids, go up via `ppc_offline_conversion_upload`: **GOOGLE ONLY** (another platform's connection
returns a wrong-platform error, not an empty result) and **strictly two-step - the first call with
no `confirm` returns a dry-run preview with `requires_confirm: true` and uploads NOTHING.** Read
every refusal reason there, show it to the client, then repeat the IDENTICAL call with
`confirm: true`; never skip the preview, never bulk-upload silently, and the same two-step governs
`ppc_customer_match_upload`. Uploads also refuse unless the conversion action exists AND is set to
source **Upload** in the Ads UI (Conversions, New conversion, Import); creating one is
`ppc_google_conversion_actions` with `type_` (TRAILING UNDERSCORE) `UPLOAD_CLICKS` or
`UPLOAD_CALLS`, confirmed first.

