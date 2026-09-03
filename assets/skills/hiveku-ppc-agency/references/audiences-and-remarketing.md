# Audiences and Remarketing: first-party data, customer match, list architecture, activation

## What this covers / when to load this

WHO sees the ads, rather than what they say or what they cost: remarketing and RLSA, observation and
targeting layers, exclusions and suppression, Customer Match and CRM activation, custom segments, list
sizing and membership windows, match-rate diagnosis, and the privacy rules over all of it. Load for "can we
retarget X," "upload our customer list," "our remarketing isn't working," "who should we exclude," and any
CRM-to-Ads activation. Bids and modifiers are in `bidding-budgets-pacing.md`, the conversion signal in
`measurement-and-conversions.md`, non-Google audience surfaces in `paid-social-and-bing.md`, campaign-type
mechanics in `account-structure.md` and `google-ads-advanced.md`. SKILL.md section 0 holds throughout, and
this reference carries a weight the others do not: audience work moves real people's personal data into an
ad platform, irreversibly.

---

## 1. Gates

Five. A failed gate stops the work there.

1. **Context.** `account_context_get({ domain: "ppc" })` for persona, avatars and rules, then `memory_list`
   for the audience facts: which lists exist and who owns them, the consent posture, whether PII may leave
   the CRM at all, protected campaigns, the approval threshold, prior decisions. `get_account_info` names
   the account in reports. No recorded consent posture means no mandate for a Customer Match upload.
2. **Local data first.** Read `hiveku-data/ppc/` before any live call: `campaigns.json` and
   `ad_groups.json` for where an audience could attach, `metrics_daily.json` for the campaign baseline,
   `hiveku-data/STATUS.json` for freshness. `truncated: true` makes `count` a floor, and an `error` with
   empty rows means NOT RETRIEVED.
3. **Conversion signal.** A duplicate tag double-firing on the pages returning visitors land on makes any
   list look brilliant. Verify per `measurement-and-conversions.md` first.
4. **Collection health.** A list flat for weeks is not small, it is dead. Play 1 checks this first.
5. **Volume.** Observation segments are thin slices of an already-thin campaign. Below the section 8
   minimums the answer is "keep observing," and saying so is the senior move.

**Queue for a new account, by value at stake:** (a) exclusions and suppression, the only audience move that
saves money in week one; (b) collection health; (c) first-party activation from the CRM; (d) observation
layers; (e) custom segments and prospecting; (f) modifier tuning. Most agencies start at (f) because it
feels like optimization. It is the least valuable item on the list.

---

## 2. Framework A: the value ladder

Rank audiences by intent density and by how much of the definition you control. Owned and high-intent at
the top, rented and inferred at the bottom.

**Tiers 1 to 3, owned and known:** converters and existing customers from the CRM, Customer Match CRM
segments, cart and form abandoners from tag rules. **Tiers 4 to 6, owned and behavioural:** deep visitors
on pricing / demo / product pages, shallow home and blog visitors, video and engagement audiences. **Tiers
7 to 9, inferred:** custom segments from competitor URLs and intent keywords, Google's in-market and
affinity segments, demographics. Tiers 1 to 3 deserve more engineering effort than tiers 7 to 9 deserve
media budget, and no tier-7-to-9 targeting layer gets built before the tier-1 exclusion layer exists:
prospecting that re-buys your own customers is the commonest silent waste in a mature account.

---

## 3. Framework B: observation, targeting, exclusion

The most damaging audience mistake available, because targeting silently collapses reach and the symptom
(impressions fell) looks like a bid or budget problem.

- **Observation** adds a reporting dimension and a modifier surface, reach unchanged. Cost of being wrong:
  none. This is the default.
- **Targeting** restricts serving to members. On Search this is RLSA proper and can cut eligible
  impressions by 90 percent overnight. Cost of being wrong: the campaign stops.
- **Exclusion** removes members from serving. Cost of being wrong: you suppress a converting segment and it
  is invisible, because excluded traffic generates no rows.

Sequence. (1) 30 days of observation data on this audience in this campaign? No, observe. (2) Large enough
to sustain the campaign alone at its budget (section 8)? No, observe with a modifier. (3) Is the audience
the campaign's entire premise (dedicated remarketing, winback, RLSA-only twin)? Yes, target. (4) Intent is
"these people must never see this ad"? That is exclusion, not a negative modifier.

---

## 4. Framework C: where audiences actually pay

- **Search non-brand:** a modifier lever, not a targeting lever. Realistic lift from a tuned RLSA
  observation layer is single-digit to low-double-digit percent CPA improvement.
- **Search brand and Shopping:** leave brand alone except for customer exclusion, often material on
  subscription businesses. Shopping behaves like Search.
- **Display and Video:** audiences ARE the campaign. Targeting is normal, list quality decides everything.
- **Performance Max and Demand Gen:** what you attach is a SIGNAL, not a restriction, so never tell a
  client "we are targeting your customer list" in PMax. If `ppc_audience_attach` rejects an asset group
  that is surface coverage, not a bug: fall back to `google-ads-advanced.md` or the Ads UI.
- **Under smart bidding:** an audience bid modifier is generally ignored for ranking, exactly as a keyword
  bid is (`bidding-budgets-pacing.md`). The layer still earns its place as a reporting dimension and a
  model signal, but never promise CPA improvement from a modifier the strategy will not read: on
  target-CPA campaigns the real lever is exclusion.

---

## 5. Framework D: index, not absolute

An observation audience's metrics are a subset of the campaign's, and remarketing audiences are
pre-selected for interest, so a site-visitor list nearly always shows a CPA far below target. That does not
mean the list is good, it means the people were already interested. Bidding it up against the account
target is how accounts pay a premium to re-buy traffic they already had.

```
CPA index   = audience CPA / campaign CPA        (lower better; < 0.80 is a real signal)
CVR index   = audience CVR / campaign CVR        (higher better; > 1.25 is a real signal)
Value index = audience (conv value / cost) / campaign (conv value / cost)
```

Baseline from `metrics_daily.json`, or campaign-level rows in `ppc_audience_performance`. Act only when the
index clears the section 8 band AND the segment clears the volume minimum: an index of 0.95 on 40 clicks is
noise. **Incrementality caveat, stated to the client every time:** none of these tools measure whether the
audience CAUSED the conversion. A holdout or geo-split is the only honest answer. A campaign experiment
(`google-ads-advanced.md` section 11: `ppc_experiment_create` then `ppc_experiment_schedule`, new as of
2026-08-29 and not yet live-validated) splits traffic between a control and a treatment; a geo holdout is
an Ads UI setup. There is no raw-API drafts path on this surface. Label the reported figures correlational
until one of those has run.

---

## 6. Framework E: the privacy gate

1. **Consent basis.** The client must have a lawful basis for advertising use and be able to state it.
   "They bought from us" is not automatically consent to upload under GDPR. Record the written answer in
   memory before the first upload.
2. **Never transmit raw PII.** Hash before it leaves your process. If a plaintext email is about to become
   a tool argument, stop.
3. **Never persist PII in the workspace:** not in `hiveku-data/`, a PM comment, memory, a scratch CSV or a
   report. Persist counts, the segment DEFINITION, the upload timestamp and the list id. Nothing else.
4. **Sensitive categories.** Personalized advertising is restricted or prohibited for housing, employment,
   credit and health, so Customer Match and remarketing are often unavailable to those advertisers. A
   policy rejection for a healthcare or lending client is the system working.
5. **Eligibility.** Customer Match availability is gated on account standing and compliance history. An
   ineligibility error is a client conversation with Google, not an integration bug.
6. **Consent signalling.** The upload carries consent fields for user data and personalization. Confirm
   names and enums with `hiveku_docs_search({ query: "ppc_customer_match_upload consent" })` then
   `hiveku_docs_get`. A MISSING consent field on an EEA list is a compliance failure, not a bad request.

---

## 7. The plays

`ppc_audience_ops` is the umbrella CRUD tool for audiences and user lists, and which operations it exposes
(list, create, update, remove, exclude) lives in its schema, not here. Before the first call in a session
run `hiveku_docs_search({ query: "ppc_audience_ops" })` and `hiveku_docs_get`. Never guess an operation
string. Where one is absent the fallback is the Ads UI Audience Manager or the raw API path in
`google-ads-advanced.md`, and you name which you used in the report.

### Play 1: Inventory and collection health (first, always)

1. `ppc_google_user_lists({ connection_id })`. Read per list: name, type (remarketing rule, customer match,
   custom), Search size, Display size, membership duration, eligibility or status flags.
2. `ppc_audience_ops` in its list operation for the criteria actually attached, so you know what is in use
   and not merely what exists. Cross-reference `campaigns.json` and `ad_groups.json`.
3. Classify. **Useful:** above the surface minimum, growing, attached. **Orphaned:** healthy size, attached
   nowhere, the highest-value finding in the inventory. **Dead:** flat or falling, section 9. **Junk:**
   duplicates and undefinable old tests, Play 8.
4. **The health test that catches the silent failure:** call `ppc_google_user_lists` again in 24 to 72
   hours and diff the sizes. A remarketing list on a trafficked site that does not grow is broken, and a
   single reading cannot tell you that.
5. Close by persisting names, types, sizes, states and the date into the `ppc` memory via read-merge-write
   (`memory_list` -> merge -> `memory_update`; bare `memory_create` only if the account has no `ppc`
   document yet), plus a `pm_tasks_create` holding the inventory table.

### Play 2: Exclusions and suppression (the money play)

The only audience action that reliably cuts waste in week one. Before any prospecting work.

1. Define who must never see acquisition ads: converters inside the repurchase window, current customers
   and subscribers, opportunities sales is already working, employees and job seekers, existing installs.
2. Source it. Converter lists usually exist from the tag (Play 1); customer lists come from the CRM. CRM
   read tools are NOT on this surface: pull the segment through the CRM skill's tools or a dashboard
   export, then bring back only the hashed result. There is no sales department agent -
   `talk_to_department({ domain: "sales" })` is refused with `Unknown domain 'sales'`. If you need the
   sales side's judgment on which segment to suppress, load `agent_identity_get({ domain: "sales" })`
   and reason it out yourself, or ask the operator. (Profile note: `agent_identity_get` is invisible on
   a marketing-ads-scoped key - the `agent_` prefix is not granted in profiles.ts - so on that key the
   operator is the fallback.)
3. Apply with `ppc_audience_ops` in its exclusion operation, campaign level for "never on this offer," ad
   group level for surgical cases. Confirm each individually, naming the campaign and the traffic effect.
4. Verify next day with `ppc_audience_performance({ connection_id, days: 7 })` plus impressions in
   `metrics_daily.json`. Expect impressions down, CPA down. If impressions fell and CPA ROSE you excluded a
   converting segment: reverse immediately.
5. Report the freed spend and where it was redeployed. Converter suppression commonly frees 5 to 15 percent
   of non-brand spend on mature accounts.

**Repurchase-window rule.** Use the real repurchase cycle, not a round number: consumables 30 days,
considered B2C 90 to 180, B2B annual contracts 300 plus. Excluding a 30-day-cycle customer for 540 days
destroys the best repeat revenue in the account. Get the cycle from the client or CRM deal data.

### Play 3: The observation layer

1. Highest-spend non-brand Search first, then Shopping. Skip brand, skip anything memory marks protected.
2. `ppc_audience_attach({ connection_id, ad_group_id, ... })`, or campaign level where the schema allows,
   in OBSERVATION mode. The argument controlling observation versus targeting is the most consequential on
   this tool: confirm its name and values via `hiveku_docs_search` and `hiveku_docs_get` before the first
   attach of a session, then re-read the response to verify the mode set. A silent default to targeting is
   a campaign outage.
3. Attach tiers, not everything: four to six lists per campaign (converters for exclusion evidence, deep
   visitors, shallow visitors, one Customer Match tier, one or two in-market segments with a thesis).
4. Modifier stays neutral: that write is `target_type: "audience"` on the bid-modifier tool in
   `bidding-budgets-pacing.md`, not on this surface.
5. Leave it 30 days, with the read date in the `pm_tasks_create` task so nobody reads early.

### Play 4: Customer Match, the first-party pipeline

1. **Define tiers before touching data:** `CM - All customers` (suppression and seed), `CM - High value`
   (top decile by revenue or LTV, the seed that matters), `CM - Lapsed <window>` (winback), plus
   `CM - Leads not closed` where the sales cycle justifies it. One undifferentiated list is worth a
   fraction of the same records split three ways.
2. **The container list must already exist.** `ppc_customer_match_upload` uploads members INTO a list, it
   does not create one. Get the id from `ppc_google_user_lists`; if the tier does not exist, create it via
   the matching `ppc_audience_ops` operation where the schema supports it, else in the Ads UI Audience
   Manager, and say which path you used.
3. **Extract the segment** through CRM tooling (Play 2 step 2), with the filter written down verbatim.
4. **Normalize, THEN hash. This is the step people get wrong.**
 - Email: strip leading and trailing whitespace, lowercase, then SHA-256, hex, lowercase.
 - Phone: E.164 with country code (`+15551234567`), no spaces, dashes or parentheses, then SHA-256 hex
     lowercase. A phone without a country code matches nothing.
 - First and last name: trim, lowercase, strip punctuation, then SHA-256 hex lowercase.
 - Country and postal code: NOT hashed, sent in the clear beside the hashed name fields.
   Send email AND phone AND name-plus-address where you have them, as separate identifier sets on the same
   record: multi-field records match materially better. Drop rows with no usable identifier, since blanks
   depress the match rate you later use as a diagnostic.
5. **Confirm before upload, with numbers:** list name and id, tier definition, record count, identifier
   fields and their fill rates, the consent basis, and that upload is not trivially reversible. One
   confirmation per list, never multiple tiers on one approval.
6. `ppc_customer_match_upload({ connection_id, user_list_id, members })` with hashed members and the
   consent fields from Framework E.6. Read the response for partial failures: the API accepts a batch and
   rejects rows, so a 200 is not success. Report accepted versus submitted.
7. **Verify at 24 to 48 hours**, not immediately: a zero right after upload means nothing. Re-run
   `ppc_google_user_lists({ connection_id })`, read the sizes, compute the implied match rate.
8. **Refresh** weekly for lapsed and lead tiers, monthly minimum for customers: a six-month-old list
   suppresses people who churned and misses people who bought.
9. Close with `memory_update`: tier names, list ids, record counts, match rates, upload dates. No PII.

### Play 5: Reading audience performance and acting

1. `ppc_audience_performance({ connection_id, days: 30 })`. Read per row: audience or list name, level
   attached, mode, impressions, clicks, cost, conversions, conversion value.
2. Compute the Framework D indices against the parent campaign. Do not rank by absolute CPA.
3. Apply the section 8 bands. Index below 0.80 with volume: modifier increase (via
   `bidding-budgets-pacing.md`, one confirmation per campaign) or a targeted twin. Index above 1.50 with
   volume: demote. Cost above two times target CPA with zero conversions: exclude, not merely demote.
   Below the volume minimum: no action, keep observing, and say so rather than invent a conclusion.
4. Detach what has proven useless: `ppc_audience_detach({ connection_id, ad_group_id, ... })`. This removes
   the criterion, not the list, so the list keeps collecting and can be re-attached, but that criterion's
   history is gone. Detach because it is worthless, never to tidy up.

### Play 6: Custom segments from competitive and intent research

1. Build the input set with research tools, not from memory: `web_search` for category competitors,
   `web_map` on a competitor domain for high-intent URLs (pricing, alternatives, comparison, integrations),
   `web_scrape` or `web_extract` on those pages for the vocabulary real buyers use, `web_crawl` for a full
   category map. Feed in the avatars from `account_context_get`.
2. `ppc_custom_audience_create({ connection_id, ... })` with the URL set and the intent keyword set. Name it
   so the thesis is legible in six months: `Custom - competitor pricing viewers - 2026Q3`.
3. Populating takes hours to days. Do not attach and judge on day one.
4. Attach in OBSERVATION mode on a prospecting campaign, or targeting mode on Display or Video where that
   is the norm (Framework C). Confirm the mode explicitly.
5. Judge at 30 days on index. Prospecting segments should show a CPA index of 1.0 to 1.5 and are judged on
   qualified new traffic volume, not on beating remarketing CPA.
6. **Similar audiences no longer exist** on Google (sunset 2023 for automated expansion inside smart
   bidding and PMax), so there is no tool because there is nothing to call. For Google lookalikes the
   answer is Customer Match as a signal; the real lookalike surface is Meta, in `paid-social-and-bing.md`.

### Play 7: RLSA and the targeted twin

1. Precondition: 30 days of observation, CPA index below 0.80, list clears the Search minimum with margin.
2. Do NOT flip the existing campaign (Framework B). Build a twin per `account-structure.md`, attach in
   TARGETING mode with `ppc_audience_attach`, give it its own budget and a more aggressive posture, and
   exclude that audience from the original so the two do not compete for the same user.
3. The twin is a new campaign and starts paused by design. Review, then enable with confirmation.
4. Read both at 14 and 30 days with `ppc_audience_performance` plus campaign metrics. Success is combined
   CPA at or below the original with more conversions. If the twin cannibalizes, fold it back.
5. Broad match plus RLSA is the legitimate advanced use, but only once the weekly search-terms discipline
   in `keywords-search-terms-negatives.md` is actually running.

### Play 8: Decommission (quarterly)

From the Play 1 inventory propose a set: duplicates, expired tests, sub-minimum lists with no growth path,
superseded tiers. `ppc_audience_detach` everywhere they are attached, verify nothing broke for a week, then
remove via `ppc_audience_ops`. One confirmation per list, never as a batch.

---

## 8. Thresholds and benchmarks

Account memory overrides these.

| Surface | Minimum active members to serve (Google) |
|---|---|
| Search / Shopping (RLSA) | 1,000 in the membership window |
| Display | 100 |
| YouTube / Video | 1,000 |
| Gmail | 1,000 |
| Customer Match (any surface) | 1,000 MATCHED, so upload well above that |

Submit at least 5,000 records to clear the Customer Match matched minimum reliably, 10,000 plus for a list
you will build strategy on: 1,200 records at a 45 percent match rate yields roughly 540 matched members,
which will not serve.

**Match rate** (matched size / records submitted). 50 to 70 percent healthy consumer, 30 to 50 percent
normal for B2B or an older list, below 30 percent investigate (section 9), above 85 percent also
investigate (usually a small recent list, but verify the size excludes a rule-based source).

**Membership windows.** Google's maximum is 540 days. Default architecture: 1 to 3 days (abandoners,
highest modifier), 7, 30 (the workhorse), 90, 180, 540 (broad reach, Display only). A 1-to-3-day abandoner
list typically converts at several times the rate of the same visitors at 30 days.

| Condition (Framework D index) | Action |
|---|---|
| CPA index <= 0.70 | Strong promote: modifier +20 to +30 percent, or build the targeted twin |
| CPA index 0.70 to 0.85 | Promote: modifier +10 to +20 percent |
| CPA index 0.85 to 1.20 | No action. Noise dressed as a finding |
| CPA index 1.20 to 1.50 | Watchlist, re-read in 30 days |
| CPA index >= 1.50 | Demote: modifier -10 to -30 percent |
| Cost >= 2x target CPA, zero conversions | Exclude the segment, not a modifier change |

**Volume minimum for any of those:** 30 days elapsed AND at least 100 clicks in the segment AND at least 5
conversions, or 30 conversions before a target-CPA-grade judgement. First modifier move capped at plus or
minus 30 percent. Customer Match sizes update in 24 to 48 hours so anything read sooner is not evidence;
custom segments take hours to days. Realistic RLSA lift on Search is 5 to 15 percent CPA improvement.
Inventory review monthly, decommission quarterly.

---

## 9. Diagnosis

**A list is flat or shrinking.** In order: (1) is the site getting traffic at all; (2) is the remarketing
tag firing (no tag-inspection tool here, so the fallback is Ads UI tag status plus loading the page and
watching the network); (3) did consent mode or a cookie banner change cut collection, which shows as a step
change on a date rather than a decay; (4) did the membership duration shorten, making unchanged inflow look
like shrinkage; (5) did a site migration break the URL pattern the rule matches. Number 5 catches teams out
after a relaunch: no error, it just stops matching.

**Match rate below 30 percent.** In order: (1) normalization, especially phones missing the country code
and emails not lowercased before hashing; (2) hash format, SHA-256 hex lowercase, not base64, not SHA-1;
(3) hashing applied to the RAW rather than the NORMALIZED value, the classic silent bug, since an
untrimmed string hashes to a valid-looking value that matches nothing; (4) list age and B2B work emails,
both of which structurally match worse; (5) records that are purchased or scraped rather than the client's
own, a policy problem as well as a match problem. To isolate 1 to 3, upload a control set of 100 records
you know are Google account holders and read that rate alone.

**No rows in `ppc_audience_performance` for an audience you attached.** The attach did not take (re-read
the response and the criteria via `ppc_audience_ops`), the campaign had no impressions, or the window is
too short: try 90 days before concluding it is broken.

**Impressions collapsed after an audience change.** First hypothesis, always: an attach landed in targeting
mode rather than observation (Framework B). Second: an exclusion applied at campaign level when ad group
was intended. Third: the audience is below the surface minimum so the campaign serves nobody. Reverse with
`ppc_audience_detach` and re-attach correctly rather than debug live.

**Upload succeeded but the list never grows.** Expected for 48 hours. After that: a partial-failure block
you skipped in the response; a `user_list_id` pointing at a same-named duplicate; a list type that does not
accept uploaded members (rule-based remarketing lists do not); Customer Match eligibility (Framework E.5).

**"Our remarketing isn't working."** Nine times in ten: the lists are dead (Play 1); Display budget is a
rounding error so frequency is invisible; the audience sits under smart bidding where the modifier does
nothing (Framework C); or the conversions are real but not incremental (Framework D). A failing connection
also errors in ways that look like audience problems, so verify it per SKILL.md first.

---

## 10. Edge cases and failure modes

- Never upload a customer list without written, recorded consent confirmation. This is the one item in the
  PPC skill that produces a regulatory problem rather than a wasted budget.
- Never put raw PII into any argument, file, comment, memory entry or log.
- Never flip a live campaign from observation to targeting. Build the twin (Play 7).
- Never report an attached remarketing audience's CPA as a win. It is selection, not causation.
- Never guess a `ppc_audience_ops` operation name or an attach-mode enum. Read the schema with
  `hiveku_docs_search` and `hiveku_docs_get`: a wrong enum wastes a round trip, a wrong mode is an outage.
- Never remove a list to tidy the account. Removal is irreversible; detaching is not.
- Never assume Google concepts transfer. Meta lookalikes, TikTok audiences, LinkedIn matched audiences and
  Microsoft audience criteria have separate tools, minimums and behaviour, all in
  `paid-social-and-bing.md`. Copying a Google plan across produces silent underperformance.
- Never re-upload to "fix" a policy rejection. Understand the policy first (Framework E).
- An audience layer on a protected or brand campaign counts as touching it: flag, do not execute. An
  audience change that materially moves spend crosses the same approval threshold as any budget change,
  and every promotion or demotion gets its own confirmation: batch the ANALYSIS, never the CONSENT.

---

## 11. Persistence and reporting

**Memory** (`memory_create({ type: "memory", name: "ppc", content })` first run, then
`memory_update({ memory_id, content })` after: it takes no `type`/`name` and REPLACES the document,
so read it with `memory_list({ domain: "ppc" })` and resend the merged body). Carry the
list inventory with ids, types, sizes and states; each tier's DEFINITION in words; upload dates, record
counts and match rates; the repurchase and exclusion windows agreed with the client; the consent basis on
file; which campaigns carry observation layers and since when; the index readings behind each modifier;
and any list the client declared off limits. Never PII.

**PM tasks.** The inventory is one task holding the table. Each Customer Match tier is its own task with
the definition, the confirmation exchange, submitted and matched counts, and the refresh cadence. The
observation layer is a task with a FUTURE read date; each exclusion a task with before-and-after
impressions and CPA. `pm_tasks_create`, `pm_tasks_update` as evidence arrives, `pm_tasks_complete` only
after the verification read, not when the write returned 200.

**Client reporting.** In the monthly report (SKILL.md section 8) audiences appear in three places: under
what changed, with exclusions applied and the spend they freed; under tests concluded, with any targeted
twin and its index result labelled correlational; and under next month's plan, with refresh cadence and new
tiers proposed. Report first-party work as the asset being built, not the tactic: "your customer file is
now live across three tiers, refreshed weekly, and suppresses existing customers from acquisition spend."
Always name the match rate: it is the honest measure of the data quality they own, and a low one is a
business finding worth more than any bid change. Generative work (segment naming, winback angles) goes
through `talk_to_department({ domain: "ppc", message })` for brand hydration, then persists above.
