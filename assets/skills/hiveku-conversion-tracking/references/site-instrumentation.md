# Reference: Getting tracking onto a site

This file covers the four ways measurement code reaches a page in a Hiveku account: a Hiveku-hosted
site (loader injected at deploy time), an external site the client hosts (`site_create_external` plus
a head snippet), hand-managed custom code per deploy tier, and Google Tag Manager (full CRUD through
the `seo_gtm_*` tools), plus consent mode, verification, and two worked plays. Load it when
instrumenting a site for the first time, when told "the tag is definitely installed but nothing
records", when moving a client onto or off GTM, or when auditing an inherited setup. Run
`account_context_get` before strategy, confirm every write, and hold onto the rule governing this
file: saving is not deploying, and deploying is not publishing.

---

## 0. Decide the lane first

1. **Who serves the HTML?** A Hiveku-hosted project (deploy tiers, `project_custom_code_*` applies)
   or a site the client hosts (external lane).
2. **Is there already a container or a hardcoded tag?** Never assume no. Run `seo_gtm_install_status`
   for saved custom code AND `analytics_diagnose_tracking` for the source and served HTML. Install
   status cannot see a container hardcoded into the site's own source, and that blind spot is the
   usual cause of a duplicate install.
3. **Who owns tag changes after you leave?** Client edits tags, use GTM. Hiveku owns the site end to
   end, custom code is fewer moving parts and one less publish step to forget.

| Situation | Loader arrives via |
|---|---|
| Hosted, we own everything | Deploy-time injection, nothing to install |
| Hosted, client wants tag control | Container in custom code, tags in `seo_gtm_*` |
| Client hosts, no GTM | `site_create_external` snippet in their `<head>` |
| Client hosts, GTM already live | Adopt their container, add only what is missing |

---

## 1. Hiveku-hosted sites: what is already there

The analytics loader is **injected at deploy time by each deployment tier**; there is nothing to
paste. Two parts behave differently, and the difference matters constantly:

- **Form capture is ALWAYS injected.** The storage-free inline capture module ships on every deployed
  site, never gated on `tracking_enabled` and never consent-wrapped, because it does zero storage
  operations and acts only on submit.
- **Analytics is gated.** The embed (`hiveku-analytics.js`, from
  `track.hiveku.com/embed/hiveku-analytics.js`) is injected only when `tracking_enabled` is on and a
  tracking token exists; on the consent-gated path, only after Analytics consent is granted.

Consequences:

- **Form leads with no sessions or pageviews is coherent, not a contradiction.** Capture is working
  while analytics is off, gated, or consent-blocked. Do not open a bug.
- **The always-on capture module can never send `attribution_captured_at`** - storage-free by design,
  it has no persisted first-touch store to read, so a lead written only by inline capture carries no
  click-dated first touch. Expected, not data loss.
- Sites hard-cache the embed, so **most embeds in the field are stale**; every server-side path is
  written to reconstruct what an old embed did not send.

**The DNI loader is a separate tag**, served from `/api/embed/phone-tracking.js`, POSTing to
`/api/embed/phone-swap/<projectId>`, re-running on a MutationObserver so SPA routes keep swapping.
**"Call attribution quietly stopped after a redeploy" is almost always this tag dropping off the
page** - the swap health monitor calls it `snippet_missing`, and nobody reports it on the day because
the site looks fine. Re-check `voice_diagnose_setup` (`blocking_issues[]`) after any custom-code change
on a DNI project; `?hkswaptest=<nonce>` forces test mode without burning a session, and one
`voice_call_tracking_live_probe` proves the swap end to end when you need certainty (it holds a real
tracking DID for the sticky window - confirm fixes with it, never schedule it).

---

## 2. Custom code: the tools and the two traps

Where a GTM container or a hand-pasted platform tag lives on a hosted project.

| Tool | Use |
|---|---|
| `project_custom_code_get` | Read state: `{run_in_preview, entries:[{id, tier, page_path, head_code, body_code, enabled}]}` |
| `project_custom_code_set_tier` | Replace an entire tier's set of snippets |
| `project_custom_code_page_set` | Set or update ONE page's snippet on a tier |
| `project_custom_code_delete` | Remove one entry by id |
| `project_custom_code_preview_toggle` | Turn `run_in_preview` on or off |

Reading the response: **`page_path === ""` is that tier's SITE-WIDE row**, where a container lives. Any
other `page_path` is page-scoped, usually a thank-you page conversion tag. `enabled: false` is the
reason an "installed" tag records nothing; check that flag first.

**`project_custom_code_set_tier` REPLACES A WHOLE TIER. Any page omitted from `pages` is DELETED.**
Never call it from memory or a partial picture: `project_custom_code_get` and keep the tier's full
`entries`; build `pages` as *the existing rows, edited*, not as the one row you care about; show a diff
of what stays, changes, and disappears; get a yes; then call it. To change one page use
`project_custom_code_page_set`; to remove one use `project_custom_code_delete` with its id. Snippets
cap at **20000 characters**, and the failure is a refused write, not a truncated one.

**UNIVERSAL TRAP: custom-code edits are SAVED INSTANTLY but take effect on the NEXT DEPLOY of that
tier. Saved is not live.** Every downstream check inherits this - `seo_gtm_install_status` will report
the container installed on production while production still serves pre-edit HTML. Say it in the same
message where you say the tag is in, or the client tests it, sees nothing, and you debug a deploy you
never ran. Deploy the tier (`deploy_site`), then verify against the served page.

`run_in_preview` is **off by default so tracking does not fire while you edit**; if
`project_custom_code_preview_toggle` turns it on to validate a tag, turn it back off afterwards.

---

## 3. Consent: what is handled, and what fails open

Consent Mode v2 defaults are set **synchronously in `<head>`** with everything non-essential DENIED.
GPC is honoured. `url_passthrough` and `ads_data_redaction` are both set. Third-party banners
(OneTrust, Cookiebot, Usercentrics, Didomi, CookieYes) are read through Google Consent Mode state, not
each vendor's private API.

**The banner reading FAILS OPEN.** Only an EXPLICIT denial suppresses; absent or unknown reads as
not-denied. Deliberate: a vendor renaming a field cannot silently switch off tracking fleet-wide. So:

- A "tracking" verdict is not proof the banner integration is wired right. It may only mean nothing
  explicitly denied.
- The expensive finding is the reverse. A channel that records **only** when the banner was already
  accepted is a direct multiplier on every number, since most visitors never touch the banner.
  `analytics_diagnose_tracking` reports it as `consent-changes-outcome` (CRITICAL);
  `analytics_probe_page` shows it by loading one URL twice and returning `as_first_time_visitor` and
  `as_visitor_who_accepted` - compare the two `observed` arrays. Only a `conversion`-role signal
  makes a channel "tracking"; container, tag, and pageview signals prove nothing about conversions.
- Two more findings worth knowing: `conversion-fires-denied` (CRITICAL: delivered carrying consent
  denied, so unattributable while looking fine in a network trace) and `consent-no-url-passthrough`
  (click ids do not survive the gated navigation, so paid clicks land as Direct).

---

## 4. External sites

- `site_create_external` creates a project with `project_type='external'`, mints a **verification token
  and a tracking token**, and returns a **`tracking_snippet`** for the client's `<head>`.
- `verification_status` flips to verified on the **first fire**. Until then assume nothing is
  installed: snippet missing, placed in `<body>` behind a consent script, or stripped by the CMS.

**The external snippet convention looks wrong and is correct.** In it, `accountId = the projectId`
and `projectId = the subdomain`. Two conventions coexist: the external/dashboard snippet sends
`accountId = PROJECT uuid`, while the consent and SSR injectors send `accountId = ACCOUNT uuid` plus
`projectId`; resolution prefers `projectId`. **Do not "fix" a snippet that looks mismatched** - you
will break a working install. Paste `tracking_snippet` verbatim.

Verifying:

- Ingest POSTs to `track.hiveku.com/v1/visitor-tracking/ga4-event` and returns **204** on success. A
  non-2xx means unauthorized or invalid; it never means "processed".
- `analytics_probe_page` on one of their URLs. It refuses domains the account does not own, so register
  the domain on the project first (`project_domains_add`, confirmed - surface the returned DNS records
  to the client; `project_domain_verify` says when it is actually servable) - also the fix for the
  reCAPTCHA hostname trap that silently files real leads as spam.
- First traffic: `analytics_events_list` filtered to `event_name=form_submit`, then
  `analytics_overview` / `analytics_sessions` / `analytics_traffic_sources` for topline.
- `analytics_diagnose_tracking` with an explicit `project_id` always runs, but on a project with no
  custom domain it returns source-scan findings only (`browser_checked: false`, no runtime findings) -
  its 400 fires only when `project_id` is omitted and no live project carries a custom domain. On a
  staging subdomain, no runtime findings is not a clean bill of health.

**No `project_custom_code_*` tool applies to an external site** - the client's CMS or developer owns
the `<head>`. Your leverage is GTM, or a change request with the exact snippet attached.

---

## 5. GTM, in full

### 5.1 The toolset

- Status and install: `seo_gtm_status`, `seo_gtm_install_status`, `seo_gtm_install`.
- Tags: `seo_gtm_tag_create`, `seo_gtm_tag_get`, `seo_gtm_tag_update`, `seo_gtm_tag_delete`,
  `seo_gtm_tag_revert`.
- Triggers: `seo_gtm_trigger_get`, `seo_gtm_trigger_update`, `seo_gtm_trigger_delete`,
  `seo_gtm_trigger_revert`. There is **no trigger-create tool** - triggers are created as part of tag
  creation (the `page_path` doctrine below).
- Variables: `seo_gtm_variable_create`, `seo_gtm_variable_get`, `seo_gtm_variable_update`,
  `seo_gtm_variable_delete`, `seo_gtm_variable_revert`.
- Ship: `seo_gtm_version_create`, then `seo_gtm_publish`.

### 5.2 Tag types

| Type | Emits | Identifiers |
|---|---|---|
| `ga4_event` | GA4 event | measurement id + event name |
| `ads_conversion` | Google Ads conversion | `conversion_id` + `conversion_label` |
| `bing_uet` / `bing_uet_event` | UET base / event, as templated Custom HTML | `uet_tag_id` |
| `meta_pixel` / `meta_event` | Pixel base / event, as templated Custom HTML | pixel id |
| `custom_html` | Anything else | - |

Bing and Meta emit as templated Custom HTML because GTM has no first-party type for them - do not
treat a Custom HTML tag named for Bing as someone's hack. Get identifiers from tools, never by hand:
`ppc_conversion_actions_list` (Google only) and `ppc_google_conversion_actions` (create / get-tag /
update) for `conversion_id` and `conversion_label`; `ppc_bing_uet_tag_list` for `uet_tag_id`,
`ppc_bing_uet_tag_create` if none exists, `ppc_bing_conversion_goal_list` /
`ppc_bing_conversion_goal_create` for the goal; `ppc_meta_custom_conversions` for the pixel.

### 5.3 The SPA trigger doctrine

**A `page_path` trigger defaults to `trigger_type: 'both'` - a pageview trigger AND a historyChange
trigger.** Not padding. Coverage of two disjoint blind spots:

- On a client-routed site, a form submit landing on `/thank-you` is a **client-side route change**. A
  pageview trigger never sees it, so every conversion from a real form fill is lost.
- A visitor landing directly on `/thank-you` - bookmark, back button, email link, refresh - is a
  **document load**. A historyChange trigger never sees it.

Either alone has a silent blind spot, and both look identical from the ad platform: fewer conversions
than expected, with a tag that tests fine in whichever case the tester tried. Leave the default at
`both`. Narrow it only deliberately, and expect the missing half to surface later as
`spa-history-trigger` or `conversion-never-fires:<channel>`.

**`uet_auto_spa_tracking`**: a Bing URL goal on a single-page thank-you page **silently never fires**
without it. No error, no warning in the Bing UI, the goal sits at zero looking like a media problem.
Set it on any SPA. Separate from the trigger doctrine - a GTM trigger firing does not help if UET
never registers the virtual pageview.

### 5.4 The conversion VALUE trap

**Omitting `conversion_value` + `currency_code` + `transaction_id` sends NO VALUE.** The conversion
still records, so nothing looks broken - but every conversion is then worth the same, and value-based
bidding (tROAS above all) optimises against a constant. The account bids identically for a 200 dollar
job and a 20000 dollar job until someone notices.

- Pass all three whenever a value exists, even estimated. A defensible average beats a blank.
- `transaction_id` is the deduplication key when the same conversion can also arrive by another path
  (a server-side upload, a second tag, a platform pixel).
- Platform-side sibling: `always_use_default_value: true` on `ppc_google_conversion_actions`
  FLATTENS every conversion and destroys transaction-level revenue reporting. Never set it to answer a
  "missing value" complaint - that hardcodes the exact problem you were asked to fix.

### 5.5 Container pinning

**The first successful use claims the container onto the connection.** A later call naming a
DIFFERENT container is refused with a 403 that names both. It guards against writing tags into a
container nobody serves, and it fires the first time you work an account set up against a test
container. On that 403: do not retry, do not guess. Read both ids from the error, confirm which
container serves production, and clear the pin deliberately through the **connection update**. Record
the confirmed id with `memory_create` immediately - it is re-derived more often than almost anything
else on an account.

### 5.6 Draft until published

**Every `seo_gtm_*` write is a WORKSPACE DRAFT. Nothing serves to a single real visitor until
`seo_gtm_version_create` and then `seo_gtm_publish`.** Two calls, in that order, every time.

It has a signature: the tag is visible in the GTM UI, GTM Preview fires it perfectly, production
records nothing. The agent task on `analytics_diagnose_tracking`'s `conversion-never-fires:<channel>`
finding orders the checks this way for a reason - **published container versus draft workspace first**,
then History Change versus Page View trigger, then whether the snippet renders under a condition the
live route never satisfies. Confirm a publish the way you would confirm a deploy. Back one entity out
with `seo_gtm_tag_revert`, `seo_gtm_trigger_revert`, or `seo_gtm_variable_revert` rather than
publishing and fixing forward.

### 5.7 `seo_gtm_install_status`: the findings that cost money

Run it before adding a single tag to an account you did not set up.

| Finding | Means | Why it costs money |
|---|---|---|
| **WRONG CONTAINER** | Not the container the connection targets | Every tag you write goes somewhere nobody serves |
| **DUPLICATE INSTALL** | Container is on the page twice | **Double counts every conversion.** Reads as performance IMPROVING and corrupts every downstream CPA and ROAS number |
| **TIER DRIFT** | Verified on staging, never installed on production | The account is measured in the one environment nobody buys from |

Duplicate install is the only finding whose symptom is a happy client: if conversions roughly doubled
with no media change on the date a container was touched, check for it first.

**SCOPE LIMITS - say these out loud whenever you report a clean result.** (1) It reads **saved custom
code ONLY**; a container hardcoded in the site's own source is **invisible to it**, so use
`analytics_diagnose_tracking`, whose `duplicate-conversion-paths` check is exactly that case. (2) It
reports the **SAVED** state, **never the LIVE** one. "Install status is clean" means only "the saved
custom code for that tier names the right container once".

---

## 6. Verify before you call it done

Stop when you have a `conversion`-role signal from a real deployed URL.

1. **Deploy or publish first**: `deploy_site` the tier, or `seo_gtm_version_create` then
   `seo_gtm_publish`. Skip it and everything below correctly reports nothing there.
2. `seo_gtm_install_status` and `seo_gtm_status` (saved state only), then `analytics_diagnose_tracking`
   for the code and the served HTML. Read `browser_checked` and `caveats` FIRST: if no probe
   succeeded the runtime checks emit NOTHING, so no findings on an unprobed site is absence of
   evidence. `tag-not-deployed` is THE most common reason a tag "definitely installed" records
   nothing.
3. `analytics_probe_page` on the conversion URL; compare `as_first_time_visitor` against
   `as_visitor_who_accepted`. Once a conversion has had time to flow, confirm platform-side with
   `analytics_channel_scorecard` (slow, call ONCE) plus `ppc_conversion_tracking_status` (Google only),
   `ppc_bing_conversion_tracking_status`, or `ppc_meta_custom_conversions`.

**Do not conclude** that a clean `seo_gtm_install_status` means live, that no runtime findings on an
unprobed site means healthy, or that a pageview or container signal means the channel is tracking.

---

## 7. Play: instrument a brand new site end to end

Hiveku-hosted site, Google Ads and Bing running, forms plus phone calls.

1. `account_context_get` for the domain. Confirm which channels are actually being spent on.
2. **Before the site ships**: **give every form a stable, human `id` or a `data-hiveku-form-key`
   attribute.** `form_key` is `<identity>@<pathname>`; a real identity is NOT path-scoped, a junk one
   (a Tailwind class, a placeholder) keeps the path. That attribute is the difference between one form
   equalling one record with working notifications and nineteen records for a handful of forms. Ship it
   with `project_files_bulk_save` in ONE call and `project_vcs_commit`.
3. Confirm `tracking_enabled` and a tracking token exist, so the injector ships analytics and not just
   form capture. Register the production domain (and any proxy hostname) with `project_domains_add`
   (read back with `project_domains_list`): an unregistered hostname scores the reCAPTCHA token 0 and
   the lead is **silently filed to spam**.
4. Decide the lane (section 0). If GTM: `seo_gtm_status`, `seo_gtm_install_status`, then
   `seo_gtm_install`. Confirm the container id with the client first; first use pins it.
5. Identifiers: `ppc_google_conversion_actions` (get-tag) for `conversion_id` and `conversion_label`;
   `ppc_bing_uet_tag_list` for `uet_tag_id`, `ppc_bing_uet_tag_create` if absent, then
   `ppc_bing_conversion_goal_create`.
6. `seo_gtm_tag_create`: an `ads_conversion` on the thank-you `page_path`, a `bing_uet` base plus a
   `bing_uet_event`, a `ga4_event` for `form_submit`. **Leave trigger_type at `both`. Set
   `uet_auto_spa_tracking`. Pass `conversion_value`, `currency_code`, and `transaction_id` on every
   conversion tag.**
7. Show the client exactly what goes live, then `seo_gtm_version_create` and `seo_gtm_publish`. For a
   snippet in custom code instead: `project_custom_code_get` first, edit with
   `project_custom_code_page_set` (or a fully reconstructed `project_custom_code_set_tier`), then
   `deploy_site` that tier.
8. Run the section 6 checks, submit a real test form, and confirm it lands
   (`analytics_events_list({ event_name: 'form_submit' })`). Confirm the DNI loader is swapping
   (`voice_diagnose_setup` -> `blocking_issues[]`; `?hkswaptest=<nonce>`), and re-check it after every
   deploy for a week.
9. `memory_create`: container id, conversion action names and labels, UET tag id, which tier holds
   which snippet, and the date measurement went live. Annotate that date on reports for a quarter.

---

## 8. Play: the client already has GTM - wire our conversions in without double counting

Inherited account. There is a container, there may be hardcoded tags, and the client believes it works.

1. **Inventory before writing anything.** `seo_gtm_status` and `seo_gtm_install_status` for which
   container, installed where, how many times, which tier, enabled or not.
   `analytics_diagnose_tracking` for what install status cannot see: a container compiled into the
   source, and `duplicate-conversion-paths` (hardcoded snippet PLUS GTM firing one conversion).
   `project_custom_code_get` for every tier's `page_path === ""` and page-scoped rows.
2. **Resolve pinning before writing.** A 403 naming two containers means stop. Confirm the production
   container with the client and clear the pin through the connection update. Never write into a
   container you have not confirmed serves production.
3. **Hunt the duplicate explicitly.** Is one conversion fired by both a hardcoded snippet and a GTM
   tag, and is the container itself present twice? Either double counts. If it already is, say so
   early and plainly: historical CPA and ROAS for that period are wrong in the flattering direction,
   and the fix will look like a performance drop. Get that agreed in writing first, or you get blamed
   for the drop you caused by telling the truth.
4. **Add only what is missing.** `seo_gtm_tag_get` the existing tags first. If theirs already fires the
   conversion correctly, do not add a second - add the missing value fields with `seo_gtm_tag_update`.
   If you must replace theirs, `seo_gtm_tag_delete` in the same version that creates the replacement so
   the two never publish together. Where a pixel and a server-side path can both report one conversion,
   `transaction_id` is the deduplication key.
5. Confirm the change set, then `seo_gtm_version_create` and `seo_gtm_publish`, and verify with the
   section 6 checks.
6. Hold. Once click windows settle, compare `hiveku_recorded` against `platform_recorded` in
   `analytics_channel_scorecard` and relay its `headline` VERBATIM - it carries the number that makes
   the problem undeniable.
7. `memory_create` the container id, what was removed, and the date the double count ended, so the next
   session does not read the step-down as a regression and "fix" it back.
