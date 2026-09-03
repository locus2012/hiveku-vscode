# Client arriving from HubSpot or GoHighLevel

First-week work on most agency clients. Read the incumbent before you design anything in Hiveku -
the pipeline you build should mirror how they actually sell, not a generic template.

1. Connection health: `crm_hubspot_status` (portal id, timezone, currency) / `crm_ghl_status`
   (location id + name). Either returns `{ connected: false }` when the account is not linked - that
   is the answer to "can we see their old CRM", not an error to work around. And it is a hard
   reporting boundary: with no connection there is NO report on the incumbent's pipeline - never
   reconstruct it from the client's recollection or your priors; say the connection is missing and
   what connecting takes.
2. Read the incumbent's shape before designing the Hiveku pipeline:
   `crm_hubspot_pipelines_list` / `crm_ghl_pipelines_list` (pipelines + stages),
   `crm_hubspot_deals_search({ q, limit })` / `crm_ghl_opportunities_search({ pipeline_id,
   pipeline_stage_id, contact_id, limit })`, `crm_hubspot_lists_list` for their audience segments.
3. Build the Hiveku pipeline with `crm_create_pipeline` (creates a new CRM pipeline with optional
   stages in the same call). Mirror the incumbent's stage names and order where they reflect how
   the client actually sells; fix what does not - a "stage" like "DO NOT CONTACT" or "Parked" is a
   flag or a status, not a stage. Confirm the stage set with the owner before loading a single deal:
   every stage needs exit criteria (SKILL.md section 1), and a stage nobody can define gets cut.
4. Load the data - preflight first, then bulk writers, in dependency order:
   - `crm_import_preflight` on EVERY payload before the real call: a dry-run that writes nothing
     and returns invalid rows + reasons, intra-batch duplicates, cross-DB duplicates, and unknown
     custom-field keys (would_fail_on_unknown_fields=true if auto_create_fields is false). It
     surfaces problems at row 0 instead of row 3,000.
   - `crm_companies_bulk_create` - up to 5,000 rows; dedup precedence external_id (if provided),
     then lowercase(name) within the account.
   - `crm_contacts_bulk_create` - up to 5,000 rows; emails normalized to lowercase, and the
     (account_id, email) unique index blocks duplicates at the DB level. on_duplicate: 'skip'
     (default - colliding rows are dropped and counted in results.skipped_duplicates) or 'error'
     (the whole batch fails with 409 so you can correct the source before retrying).
   - `crm_deals_bulk_create` - up to 5,000 rows; dedup by external_id ONLY (deals have no natural
     uniqueness key - re-running a load without external_ids duplicates every deal). Pipeline +
     stage are required per-row OR via default_pipeline_id / default_stage_id (both batch-validated
     against the account before any insert; a mismatch fails the whole batch fast). Optional
     contact_id / company_id per row create the deal↔contact / deal↔company join rows.
   - All three support inline per-row `custom_fields: {key: value}`; with `auto_create_fields:
     true` unknown field_keys auto-create the definition with type inferred from the first value.
     It defaults to false so typos do not pollute the schema - keep it false and fix the keys the
     preflight flags instead.
   - Load order: companies → contacts → deals, so the join ids exist when the later batches
     reference them. Carry the incumbent's source field into `lead_source` at create time (bulk
     create is create time - the one chance to set it; see the attribution rule in SKILL.md
     section 2), using slugs that exist in `crm_list_lead_source_options` and adding genuinely new
     channels with `crm_add_lead_source_option` BEFORE the load, not free-hand per row.
5. Prospect claims prior contact that the Hiveku record does not show? The history is still in the
   old system: `crm_hubspot_contact_history({ contact_id })` (notes + associated engagements) /
   `crm_ghl_contact_history({ contact_id })` (notes + tasks + conversations). Search first with
   `crm_hubspot_contacts_search({ q })` / `crm_ghl_contacts_search({ q })`, then
   `crm_hubspot_contact_get` / `crm_ghl_contact_get` for full properties, source, tags and owner.
6. Keep the two in step during the overlap: `crm_integration_sync_configure({ source:
   "hubspot" | "ghl", object: "contacts", enabled: true, frequency_seconds })` - frequency is clamped
   to 900-86400 seconds, default 3600. `crm_integration_sync_list` to see what is configured,
   `crm_integration_sync_run_now({ source, object })` to make the next cron tick pick it up
   immediately, `crm_integration_sync_disable({ source, object })` to stop it (the row stays for
   audit; re-enable through _configure).
7. These are READ surfaces on the incumbent. Writes go to Hiveku, not back to HubSpot/GHL - do not
   promise a two-way sync. The sync tool's own description points at `crm_ghl_import_analyze` /
   `crm_hubspot_import_analyze`; those tools do not exist on this MCP surface, so build the
   `plan_json` from what the pipelines/deals reads show you and confirm the mapping with the owner.

## The comparability gate during the overlap

Never sum incumbent and Hiveku pipeline into one number while both systems are live. The two
systems' stage definitions, dedupe rules and currencies differ, and the sync window means the same
deal can exist in both. Report the two side by side, each labeled with its system and stage
definitions, until cutover is complete - then the Hiveku number is THE number and the incumbent
read is history. The same gate applies to contact counts and win rates: different dedupe rules
make them different metrics that happen to share a name.
