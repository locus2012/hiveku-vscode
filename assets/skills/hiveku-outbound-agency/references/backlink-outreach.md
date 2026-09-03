# Backlink outreach campaigns (run FOR the SEO program)

Purpose: win LINKS, not meetings. Success = a placed link on a relevant domain.

## Sourcing targets

Targets come from the SEO side (the `hiveku-seo-agency` skill, Play 5):
`backlinks_domain_intersection` / `backlinks_page_intersection` /
`seo_backlink_opportunities` - each target arrives with the page and the reason.

Visibility + cost: the `backlinks_*` names are DataForSEO module tools (19 of them, e.g.
`backlinks_backlinks`, `backlinks_referring_domains`, `backlinks_competitors`). They spend
DataForSEO credits and are visible ONLY on profiles with DataForSEO enabled - of the
outbound-carrying profiles that is `marketing` alone (plus `full`); a sales or marketing-email
key cannot call them, and `seo_*` tools additionally need a profile granting `seo_`
(marketing / marketing-seo / full). If the target list cannot be pulled on the current key,
ask the SEO side to hand over the list rather than misreading the unknown-tool error as an
outage. Confirm credit spend with the user before intersection pulls - they bill against the
account's DataForSEO budget with no confirm step of their own.

## Running the play

- Segment by pitch type and write ONE angle per segment via
  `talk_to_department({ domain: "outbound" })`: resource-page addition, guest post,
  broken-link replacement, unlinked mention. Personalization is mandatory - reference
  the exact page and why the asset fits. Generic link begging burns the domain. Source the
  hook the same way as sales personalization: `fetch_url` the target page, quote what is
  actually on it.
- Load: `crm_contacts_bulk_create` tagged link-outreach + an
  `outbound_create_campaign` record; run sends from a Smartlead campaign on a
  SEPARATE domain/mailboxes from sales cold email (editorial reputation != sales reputation).
- Cadence: 2 follow-ups max, 4-6 day gaps (editors hate long sequences); 20-50 deeply
  personalized prospects/week beats 500 generic sends every time.
- Replies run through the daily triage loop; positive -> deliver the asset or draft;
  confirm placement via `backlinks_backlinks` or `seo_new_lost_backlinks` (both are reads;
  the seo_ one needs an seo_-granting profile) ->
  `crm_create_activity` "link placed" + close the PM task.
- Benchmarks: reply 5-15% (relevance is intrinsic, so higher than sales cold),
  placement 1-5% of contacted; report links won + cost-per-link monthly - and disclose N
  contacted and which segments were excluded, like every other outbound report.
