# Key profiles - exact tool visibility per scoped MCP key

The MCP server scopes keys by profile (`/mcp` endpoint or X-Mcp-Profile header; defaults to
`full`). The profiles that carry `outbound_` are **sales**, **marketing**, **marketing-email**,
and **full**. An unknown-tool error on a scoped key is KEY SCOPE, never an outage - check here
before reporting a tool as broken.

## Always available on EVERY profile

`talk_to_department`, `list_departments`, `web_search`, `fetch_url`, `audit_query`, and
`account_context_get` (context loading works on every profile - the context-first rule has no
scoped-key exception anymore). And `get_account_info` is name-listed on all the
outbound-carrying profiles.

## sales (the BDR persona)

Prefixes: `crm_` (ALL of it - DNC, reminders, sequences, deals, reports, imports, activities,
and the 1:1 email pair `crm_contact_emails_list` / `crm_contact_email_send`), `gmail_`,
`calendar_`, `outbound_` (all 32 - the 27 prior tools plus the five sales-controls tools
`outbound_campaign_status_set`, `outbound_campaign_sequences_get`,
`outbound_campaign_sequences_save`, `outbound_campaign_analytics_get`,
`outbound_reply_draft_send`, which ride the prefix grant like the rest), `memory_`, `kb_`,
`brand_`, `avatar_`, `discussion_`; plus task and project names (create_task, list_tasks,
get_account_info, ...); plus `voice_call_transcript_get` by NAME (call prep/capture are sales
plays - the rest of `voice_*` stays invisible).

NOT visible: `email_*` (suppression add/list/remove, domains, deliverability check, stats),
`seo_` and all DataForSEO modules (includeDataForSEO false - `backlinks_*` included),
`analytics_`, `workflow_`, `customer_avatar_*` (the `avatar_` grant does NOT match the
`customer_` prefix), `integration_`, `voice_*` beyond the one transcript name.

## marketing (catch-all) and marketing-email

Both carry: `email_`, `outbound_` (the full 32 by prefix, the five new controls / send tools
included - no per-name exclusion is recorded for them; not verified against the profile
source), `avatar_`, `brand_`, plus the marketing shared prefixes -
`memory_`, `workflow_`, `analytics_`, `kb_`, `knowledge_`, `content_`, `pm_`, `survey_`,
`media_`, and more - plus ONLY seven crm contact tools by name: crm_list_contacts,
crm_get_contact, crm_search_contacts, crm_create_contact, crm_update_contact,
crm_contact_upsert_by_email, crm_contacts_bulk_create. The profile source says outright that
the DNC tools are deliberately excluded from that list.

NOT visible on either: `crm_set_dnc` / `crm_get_dnc_status` / `crm_remove_dnc`,
`crm_create_activity`, `crm_reminder_*`, the CRM sequences rail, `crm_list_deals` /
`crm_create_deal` / crm reports, `crm_import_preflight`, `crm_list_email_suppressions`,
`crm_thread_for_contact` / `crm_email_thread_search`, `crm_lead_triage`,
`crm_contacts_gone_cold`, `calendar_`, `gmail_`, `integration_`.

marketing additionally has `customer_` (so `customer_avatar_*` works), `seo_`, and DataForSEO
(includeDataForSEO true - the `backlinks_*` modules). marketing-email has NONE of those three.

## What this does to the plays

- **Compliance pair:** `crm_set_dnc` + `email_suppression_add` spans crm_ and email_ - only a
  FULL key runs both. sales runs `crm_set_dnc` (atomic - it already suppresses email globally);
  marketing keys run `email_suppression_add` but cannot flip lifecycle or exit sequences.
- **Pre-enrollment sweep:** email_suppression_list (marketing/full) + crm_get_dnc_status,
  crm_list_email_suppressions, thread checks (sales/full). Only full sees every source; on any
  other key name the sources you could not read and mark the sweep partial.
- **ICP -> enrollment -> booking in one session:** needs customer_avatar_* (marketing),
  outbound_ (any outbound-carrying profile: sales, marketing, marketing-email), calendar_
  (sales) - full only.
- **Campaign controls and the reply send:** `outbound_campaign_status_set`,
  `outbound_campaign_sequences_save`, `outbound_reply_draft_send` ride the `outbound_` prefix,
  so every outbound-carrying profile can call them. Key scope is not the approval gate: the
  preview -> shown to the operator -> yes -> `confirm: true` sequence applies on every key
  (`references/tool-traps.md`), and the three sit on the plugin's permission ask-list.
- **Backlink outreach target pull:** DataForSEO + seo_ - marketing or full.
- **Warm visitors:** `analytics_` - marketing profiles, not sales.
- **Out-of-band reply sweep:** `gmail_inbox_lead_replies` - sales or full.
- **Escalation:** `create_task` / task names are on ALL the outbound-carrying profiles.

When a requested play spans halves the current key cannot see, do the visible half, name the
invisible half explicitly (tool + profile that has it), and never report the gap as a product
outage.
