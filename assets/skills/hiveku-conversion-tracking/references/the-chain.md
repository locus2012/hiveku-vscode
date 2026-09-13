# Reference: THE CHAIN, end to end

This is the mental model every other conversion-tracking reference assumes: how a click on an ad
becomes an attributed conversion inside Hiveku, hop by hop, with the real mechanism at each hop and
the exact thing an operator may and may not conclude from it. Load it whenever a client disputes an
attribution number, whenever a lead or call "shows as Organic" or "shows as Direct", whenever you are
about to date a click for an offline conversion upload, and before any diagnosis reference, because
most wrong-attribution reports are one of four semantics on this page being misread rather than a bug.
Every tool named here is a real Hiveku MCP tool; where a capability has no tool, this file says so and
names the fallback.

Before anything strategic or client-facing: `account_context_get({ domain })`. Before trusting any
platform-side number: `ppc_digest`, which carries cross-platform stale-connection warnings (over 25
hours since sync). A stale connection skews every comparison here the same way, making Hiveku look
right and the platform look empty.

---

## The chain in one screen

```
1  ad click        -> landing URL carries gclid/gbraid/wbraid/fbclid/msclkid/ttclid/twclid/li_fat_id + utm_*
2  embed v3.6      -> localStorage hiveku_utm_params {params, capturedAt}  FIRST TOUCH WINS, PERMANENTLY
3  identity        -> hiveku_visitor_id (localStorage UUIDv4) + hiveku_session (hs_<epoch_ms>_<32hex>)
                      DNI snippet adopts the SAME visitor id, mirrors it to the hiveku_vid cookie
4  ingest          -> POST track.hiveku.com/v1/visitor-tracking/ga4-event -> Cloudflare Queue -> 204
5  queue consumer  -> ClickHouse (events, sessions, visitor_index) + builder
                      (/api/internal/visitor-upsert, /api/internal/form-lead)
6  form-lead -> CRM-> ledger row FIRST, contact upsert, contact_id patch, crm_activities note, notify
7  contact storage -> gclid/click_ids (CURRENT) | original_* (FIRST, write-once)
                      | source_history[] (append-only, DATED) | utm mirrors of both
8  first_touch_at  -> website_form_submissions.visitor_info, with first_touch_from provenance
9  read time       -> recover utm_params -> landing_page -> page_path, all-or-nothing
```

Everything downstream of hop 5 is best-effort, which is why the builder and the analytics numbers can
legitimately disagree and why reconcile backstops exist.

---

## Hops 1 and 2. Click capture, and FIRST TOUCH WINS

The embed is `hiveku-analytics.js`, currently v3.6, served from R2 via
`track.hiveku.com/embed/hiveku-analytics.js`. It captures click ids unconditionally, no per-project
configuration: `gclid, gbraid, wbraid, fbclid, msclkid, ttclid, twclid, li_fat_id`, plus any `utm_*`,
keys lowercased. The result goes to localStorage under `hiveku_utm_params` (mirrored to
sessionStorage) with a 90-day window, shape `{params, capturedAt}`.

**FIRST TOUCH WINS, PERMANENTLY. This is the single most important semantic in the product.** If the
store is already non-empty the embed returns it and never rewrites it. A later ad click is not merged,
not appended, and does not move `capturedAt`. Within the 90-day window, whatever click that browser
landed on first is the only click that browser will ever volunteer.

Consequences you must be able to recite:

- A visitor who arrived organically in March and clicked a Google ad in June has an empty or organic
  store at the moment of the June conversion. **The June gclid exists only in that visit's landing
  URL**, which is why server-side recovery from `landing_page` exists (hop 9). This is the mechanism
  behind most "we know this lead came from the ad and Hiveku says Organic" reports, and it is not a
  bug. Calling it one costs you the next conversation.
- Retargeting is systematically under-credited by design: every browser in a retargeting audience has,
  by definition, a non-empty first-touch store from the earlier visit. The client's platform click
  report will disagree with stored `capturedAt` on exactly these visitors, and Hiveku is not wrong. It
  is answering first touch, not last.

`attribution_captured_at` is a separate accessor from the params, deliberately, so the timestamp can
never be written into the CRM as a bogus `utm_*` value.

**The storage-free inline capture module** ships on every deployed site, is never gated on
`tracking_enabled`, and is never consent-wrapped, because it performs zero storage operations and runs
on submit only. Being storage-free, it can **never** send `attribution_captured_at`. By design, not a
defect, and it decides which provenance you get at hop 8.

---

## Hop 3. Visitor and session identity, and how web and call identity unify

- `hiveku_visitor_id` is a localStorage UUIDv4. Storage blocked (private mode, ITP, an unaccepted
  consent gate, enterprise policy) means null. Events still flow; they are simply unjoinable.
  **Unjoinable is not missing.** The traffic is in ClickHouse, it just cannot be stitched to a person,
  so a low join rate reads as a low conversion rate.
- `hiveku_session` lives in sessionStorage with a 30-minute inactivity timeout. Id format is
  `hs_<epoch_ms>_<32hex>`, and the server parses that epoch back out to date a visit. Not cosmetic: it
  is provenance (c) at hop 8.
- `landingPage` is recorded at session mint. It is what lets the server recover a click id that never
  reached `utm_params`.
- The DNI phone-swap snippet adopts or mints the **same** `hiveku_visitor_id` and mirrors it to the
  `hiveku_vid` cookie. That is what unifies web and call identity: a call on a swapped tracking number
  resolves to the same visitor as the web session, so it inherits the campaign that produced the click.
- The DNI snippet prefers the embed's persisted first-touch store over the current URL, which stops a
  consent-delayed or return-visit boot from minting a pool session with a null gclid that could never
  be conversion-uploaded. It also means the call side inherits first-touch semantics, with all of hop
  2's consequences.

**Operator read:** no `hiveku_visitor_id` means calls and web sessions cannot unify, so you see calls
with no crediting pool session. Check `voice_diagnose_setup` for `blocking_issues[]`,
`voice_pools_list` for the pool inventory, and `voice_call_tracking_live_probe` to prove the swap end
to end (it holds a real tracking DID - confirm fixes with it, never schedule it).
**"Attribution quietly stopped after a redeploy" almost always means `snippet_missing`: the DNI loader
tag dropped off the page.** Nobody reports it on the day it happens, so line the deploy timeline up
against the day attribution went flat.

---

## Hop 4. Browser to ingest, and what a 204 does and does not mean

The browser POSTs to `track.hiveku.com/v1/visitor-tracking/ga4-event` (alias of `/v1/event`). Auth
accepts either a `verification_token` or a `tracking_token`. Ingest enqueues to a Cloudflare Queue and
returns **204**.

- **204 means accepted for processing, never processed.** Nothing downstream has happened yet.
- A non-2xx means unauthorized or invalid, never "processed with a warning". Non-204s in a client's
  network trace mean a wrong token or a malformed payload, and waiting will not produce data.
- **Two payload conventions coexist and both are correct.** The external and dashboard snippet sends
  `accountId = PROJECT uuid`; the consent and SSR injectors send `accountId = ACCOUNT uuid` plus a
  `projectId`, and resolution prefers `projectId`. If a raw payload looks like the account id is in the
  wrong field, check which snippet is installed before filing anything. In the external-site convention
  (`site_create_external`), `accountId = <projectId>` and `projectId = <subdomain>`.

**Deploy topology, before you conclude "the fix did not work":** the ingest worker, the queue consumer,
and the embed are three separate deploy artifacts. `wrangler deploy` ships only the ingest worker and
reports success anyway; the consumer needs its own deploy; the embed lives in R2 and needs an object
put plus a Cloudflare cache purge, and the edge cache strips query strings, so `?cb=` does not bust it.
The consequence for attribution: **most embeds in the field are stale**, so every server-side path is
written to reconstruct what an old embed did not send. Never assume v3.6.

---

## Hop 5. The queue consumer: ClickHouse versus the builder

The consumer fans out to ClickHouse (`events`, `sessions`, `visitor_index`) and to the builder
(`/api/internal/visitor-upsert`, `/api/internal/form-lead`).

**There is no click-id column in ClickHouse.** Click ids ride inside `sessions.landing_page` and the
event's extra JSON. That is why the analytics tools cannot answer "how many gclid-carrying sessions did
we get", and why `marketing_form_conversion_audit` exists to answer the form-side version.

A ClickHouse failure retries the batch; everything after it is best-effort. The analytics tools
(`analytics_overview`, `analytics_sessions`, `analytics_traffic_sources`, `analytics_pages`,
`analytics_visitors`, `analytics_events_list`) read the ClickHouse side; the CRM and Forms tabs read
the builder side. A gap between them is expected under load and is not by itself evidence of loss.
Size it with `analytics_events_list({ event_name: 'form_submit' })` against the Forms count before
escalating; the ledger reconcile runs every 15 minutes and materialises missing rows from ClickHouse.

---

## Hop 6. form-lead into the CRM: the ordering contract

The order tells you what survives a partial failure: **ledger row first**, so a submission with no
email is still recorded; then contact upsert; then patch `website_form_submissions.contact_id`; then a
deduped `crm_activities` note; then the notification. A submission visible in Forms with no linked
contact is therefore a partial failure at step two, not a lost lead, and the form-submission sweeper
retries the CRM half for rows marked `needs_attention`. Losing a lead outright requires inline capture,
webhook, worker post, and reconcile to all fail.

---

## Hop 7. Where click ids live on a contact: all four places

| Field | Semantic |
|---|---|
| `crm_contacts.gclid` + `crm_contacts.click_ids` (JSON map) | CURRENT, most recent touch |
| `crm_contacts.original_gclid` + `crm_contacts.original_click_ids` | Write-once FIRST touch |
| `crm_contacts.source_history[]` | Append-only audit trail, **the only DATED one** |
| UTM columns | Mirror the same current/original split |

Platform key map: `google_ads -> [gclid, gbraid, wbraid]`, `microsoft_ads -> [msclkid]`,
`meta_ads -> [fbclid]`. **The dedicated `gclid` column only ever feeds Google.** A Microsoft click
lives in `click_ids`, never in `gclid`, so a check written against `gclid` alone reports a
Microsoft-sourced book of business as having no click ids at all.

**`source_history` is the only place that knows WHEN a click happened.** The other three tell you
*which* click id, never *when*. That is why the offline-upload lane dates a click from the latest
`source_history` entry carrying that exact value. Read a contact with `crm_get_contact`; it does **not**
include calls, so pair it with `crm_calls_list` (filters `contact_id`, `company_id`, `deal_id`,
`has_recording`, `has_transcript`) for the call history behind the same person.

**Never use `updated_at` as a proxy for click time.** Any unrelated edit moves it; the upload lane
explicitly rejects it, and so should you.

With no dated `source_history` entry for the click id you hold, the fallback is `contact.created_at`,
which is at or before any click on that contact. It over-states the click's age and so refuses more
uploads than it strictly should, never fewer; `dated_by` tells you which you got. Over-refusal is the
safe direction: a wrongly dated conversion gets attributed to the wrong campaign and then bid on.

---

## Hop 8. `first_touch_at`, its three provenances, and the guarantee it makes

`first_touch_at` lives in `website_form_submissions.visitor_info`, with a sibling `first_touch_from`
provenance. Resolution order:

1. **`captured_at`** - the real click instant from the embed's store. Accepted only if plausible: at or
   after 2020-01-01, at or before the submit, within the 90-day window plus 2 days of slack, **and**
   the click id came from `utm_params`, not the landing URL.
2. **`session_started_at`** or **`session_id`** - the start of *this* visit, from the session start
   field or the epoch parsed out of `hs_<epoch_ms>_<32hex>`. Gated on a span of 24 hours or less **and**
   the landing URL carrying this row's attribution.
3. **Omitted entirely.** Never null, never zero, never a placeholder.

**The guarantee: the click happened at or before `first_touch_at`.** That is all it promises, and it
promises it in all three cases.

**Only `first_touch_from === 'captured_at'` DATES a click. The other two only BOUND it.** Say that
before every offline upload and every "when did this lead first hear about us" answer. A
session-derived first touch on a returning visitor bounds the click to the start of the visit in which
they converted; the actual click may be 40 days older. Writing session start as a click date without
the landing-URL gate is exactly how a 40-day-old click gets dated as today, the second classic
attribution failure mode here. A wrong timestamp is worse than none, which is why case 3 omits the
field rather than guessing.

`marketing_form_conversion_audit` surfaces this per row as `attribution.first_touch_at` and
`click_time_is_exact`, the field that tells you whether you are in case 1. In aggregate it carries
`click_window.click_dated`, `clicks_before_range`, and `boundary_risk`.

**Trap, and it is a big one: if `click_dated` is 0, then `clicks_before_range: 0` means NOT MEASURABLE,
not zero.** Reporting "zero clicks fell outside the window" off an undated set is fabricated
reassurance. When `click_dated` is 0 the honest sentence is "we cannot date any click in this range, so
the window analysis is unavailable", followed by the reason: case 2 or case 3 provenance, meaning an
older embed, storage-blocked browsers, or the storage-free inline capture module, which structurally
cannot send `captured_at`.

---

## Hop 9. Read-time recovery, and why a paid lead reads as Organic

At read time, attribution is recovered in a fixed order: **`utm_params` -> `landing_page` ->
`page_path`**, and recovery is **all-or-nothing per source**: a campaign from one observation is never
merged onto a source from another. If the gclid comes from the landing URL, so must the medium and
campaign. Half-merged attribution would be worse than none, because it looks authoritative.

The recovery origin is surfaced, and it is the operator's most useful field on this page: **it lets you
see that a gclid came from the landing URL and was MISSING from `utm_params`**, the most common reason
a genuinely paid lead reads as Direct or Organic in a first-pass report.

Why `utm_params` is empty on a real paid click, roughly in order of frequency: localStorage
unavailable (private mode, ITP eviction, an unaccepted consent gate, enterprise policy); an older
cached embed that never wrote the store in the modern shape; first-touch-wins, so an earlier different
touch occupies the store and the paid click was never written; or the storage-free inline capture
module was the writer and performs zero storage operations. In all four the click id may still be
sitting in the landing URL, which is what `landing_page` recovery is for.

**Conclude:** origin `landing_page` with a gclid present means a paid click and a wrong first-pass
channel label. **Do not conclude:** that no click id in all three sources proves the lead was not paid.
It proves only that no available observation carried one. Size that unknown with
`marketing_form_conversion_audit`'s `no_attribution` bucket; its buckets
(`deleted | duplicate | spam | archived | workflow_failed | no_attribution | unpaid_attribution |
counted`) sum to the total, so the unknown is always quantified rather than hand-waved.

---

## The conclusions table

| You see | You may conclude | You may NOT conclude |
|---|---|---|
| Ingest returned 204 | Accepted for processing | That anything was stored or attributed |
| `hiveku_utm_params` populated | This browser's first touch in 90 days, dated | That it caused this conversion, or is the latest touch |
| `hiveku_utm_params` empty | The browser volunteered nothing | That the visitor was not paid; check `landing_page` |
| `first_touch_from: 'captured_at'` | The click is DATED, exactly | That the 90-day window no longer needs checking |
| `first_touch_from: 'session_started_at'` / `'session_id'` | The click happened at or before that instant | That the click happened *at* that instant |
| `first_touch_at` absent | We refused to guess | That there was no click |
| `click_dated: 0` with `clicks_before_range: 0` | The window analysis is NOT MEASURABLE | That zero clicks fell outside the window |
| Contact has `click_ids` but no `gclid` | Likely a Microsoft or Meta click | That there is no click id |
| `dated_by: created_at` | Age is OVER-stated, so refusals skew conservative | That the refusal is a bug |

---

## Working the chain: three canonical questions

### "The client swears this lead came from Google Ads and Hiveku says Organic."

1. `marketing_form_conversion_audit`, filtered to the form and date range with `has_click_id`,
   `click_id_type`, `channel`, or `attribution_window_days` as needed. Read the per-row
   `attribution.first_touch_at`, `click_time_is_exact`, and the recovery origin. **Decision:** origin
   `landing_page` with a gclid present means the client is right and the label is first-pass only; show
   the origin as evidence. Origin `utm_params` with no click id anywhere means we have no observation
   of a paid click for that row, which is not proof there was none.
2. If the pattern is systemic (many rows recovering from `landing_page`, or `click_dated` near zero),
   the cause is upstream: a stale embed, a consent gate, or the storage-free capture module. Confirm
   with `analytics_diagnose_tracking({ project_id })`, reading `caveats` and `browser_checked` before
   believing any runtime finding. Never call a bug off a single row: first-touch-wins produces exactly
   this symptom on returning visitors, and it is correct behaviour.

### "When did this click happen, so I can upload the conversion?"

1. `crm_get_contact`. Take the click id: CURRENT wins over first-touch, and within Google,
   `gclid > gbraid > wbraid`.
2. Date it from the latest `source_history` entry carrying that exact value; with none, the lane falls
   back to `contact.created_at` and surfaces `dated_by`. Never substitute `updated_at`.
3. Check the platform click window: google 90 days, microsoft 90, meta 7, tiktok 7, linkedin 90.
   Google's import horizon is 63 days. Minimum upload delay 6 hours, sooner returns `TOO_RECENT_*`.
4. `ppc_offline_conversion_upload` **without** `confirm` first. It returns a dry-run preview with
   `requires_confirm: true` and uploads nothing. Relay every refusal reason verbatim (`no_click_id`,
   `stale_click`, `conversion_precedes_click`, `conversion_action_not_owned`, `ad_consent_denied`, and
   the rest) before asking for a yes, then repeat the **identical** call with `confirm: true`. **Never
   skip the dry run, never batch several uploads behind one confirmation, and never read a thin preview
   as permission.** Google Ads only; another platform's connection returns a wrong-platform error, not
   an empty result. `ppc_customer_match_upload` is two-step in the same way.

### "Why did the calls not show up as conversions?"

Web and call identity unify at hop 3, so the whole chain applies; the calls reference owns the detail.
From this page: `marketing_call_attribution_breakdown` for source/medium/campaign plus call quality,
`marketing_call_attribution_list` for individual calls and the crediting pool session (check
`totals.truncated`), `marketing_call_transcript_get({ call_id })` for one call, passing the `id` from that list as
`call_id` (the argument is named `call_id`, not `id`),
`analytics_channel_scorecard` for the reconciliation causes (`upload_disabled | no_click_id_captured |
outbox_stuck | action_missing | action_disabled | action_not_counted | no_upload_lane |
platform_unreadable`), plus `voice_recent_calls`, `voice_calls_list`, `voice_numbers_list`.

The consolidated verdict is `voice_call_tracking_diagnose` - the call doctor: seven checks
(`ok | warn | fail | unknown`) plus an ORDERED `fix_first` list, with `voice_call_tracking_outbox`
for the row-level upload outbox. Read `fix_first` first; an `unknown` is not a pass. The calls
reference, section 9, carries the detail.

---

## Writes on this chain

Everything above is a read except three lanes, all confirm-first. **Offline conversion uploads** are
two-step by design, as above; the dry-run preview is the artifact you show before asking for a yes.

- **Custom code**, where a GTM container or hand-pasted tag lives. `project_custom_code_get` returns
  `{run_in_preview, entries:[{id, tier, page_path, head_code, body_code, enabled}]}`, where
  `page_path === ""` is that tier's site-wide row. `project_custom_code_set_tier` **replaces a whole
  tier: pages omitted from `pages` are DELETED**, so read first, show the diff, get a yes. Also
  `project_custom_code_page_set`, `project_custom_code_delete`, `project_custom_code_preview_toggle`.
  **Universal trap: these edits save instantly but take effect on the NEXT DEPLOY of that tier. Saved
  is not live.** `seo_gtm_status` and `seo_gtm_install_status` likewise report SAVED, never live.
- **External site registration** via `site_create_external`, which mints tokens and returns a
  `tracking_snippet`.

Never bulk-apply, never upload silently, and never let one write's confirmation carry to the next.

---

## The rule that ties it together

**At every hop, ask what the field is allowed to prove.** `capturedAt` dates a click. A session start
bounds one. A `landing_page` recovery proves paid but not when. `created_at` bounds from below and so
refuses conservatively. A 204 proves receipt and nothing else. Attribution disputes are almost never a
missing number; they are a number being asked to prove something it never promised.

