# HeyReach / LinkedIn - the out-of-band channel

Load this for any LinkedIn outreach work. The one structural fact that governs everything here:

**HeyReach = an OUT-OF-BAND LinkedIn engine, not a Hiveku integration.** Hiveku's cold-email
integration is SmartLead-ONLY today: the dashboard connect form hardcodes
`provider: 'smartlead'`, and `cold_email_integrations` is unique on (account, provider) with
SmartLead the only writer. So: run HeyReach entirely through its own REST
(`https://api.heyreach.io/...`, `X-API-KEY` header; endpoint shapes: verify against current
provider docs) plus the local worker. **LinkedIn touches CANNOT be mirrored as outbound leads** -
`outbound_create_lead` rejects any non-SmartLead campaign with 412 `unsupported_provider`.
Mirror them into the CRM instead: `crm_contact_upsert_by_email` + `crm_create_activity`.
(HeyReach's own two-way sync with Smartlead is a feature of those two third-party products; it
does not touch Hiveku.)

HeyReach campaigns are built in HeyReach and stay there - they cannot be mirrored as Hiveku
campaigns or leads.

Profile note: `crm_create_activity` is `crm_`-prefixed and NOT one of the seven contact tools
the marketing profiles carry - so the CRM mirror path needs a sales-profile or full key.
On a marketing/marketing-email key, `crm_contact_upsert_by_email` works but the activity log
does not; say so rather than silently dropping the touch history.

## LinkedIn sequence shape

Connection note (short, no pitch, under ~280 chars) + 2 follow-ups after acceptance (value
message, then soft CTA), 2-3 days apart. LinkedIn is the relationship channel - pitch-slapping
on acceptance is the fastest way to get reported.

## Safety caps (non-negotiable)

Human-like volumes only - roughly 20-30 connection requests and 30-50 messages per seat per day
(verify against current provider docs and current LinkedIn tolerance). LinkedIn automation is a
ToS risk; over-sending gets the client's SEAT restricted, which is a fireable agency offense.
Never exceed HeyReach's own safety caps. Treat these numbers as the ceiling when no
client-declared cap exists - never "as fast as the API allows".

The approval gate applies here with full force: a connection note or LinkedIn message is a send.
Draft it, show it, get the yes, then send it through HeyReach - never batch-fire drafts through
the REST API as a way around the one-at-a-time approval.

## Reporting honesty

Hiveku has ZERO visibility into LinkedIn activity - no tool reads HeyReach. LinkedIn numbers in
any report come from HeyReach's own analytics/exports and are labeled provider-sourced, or the
report says "LinkedIn: no data connection" - never an estimate, never a number recalled from a
prior session. A missing HeyReach export makes the report partial, not LinkedIn-equals-zero.
Benchmarks where data exists: connection accept 20-40%, reply 5-15% of accepted.

## Mirroring cadence

After each HeyReach working session (or from the local worker's poll): upsert the contact, log
one `crm_create_activity` per meaningful touch (connection accepted, reply received, meeting
asked), and route any positive reply into the same daily triage loop as email replies. If the
mirrors drift, reconcile FROM HeyReach INTO Hiveku, never the reverse.
