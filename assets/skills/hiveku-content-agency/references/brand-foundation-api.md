# Brand foundation API mechanics (Play 1)

Load this file before CREATING or ENRICHING any foundation artifact - brand guide, avatar,
journey, before/after grid - or before purging brand-guide tombstones. The listing and reading
tools (`*_list` / `*_get`) need none of this.

- **Brand-new account with nothing on file:** draft the whole foundation with the user, then commit
  it in ONE `account_seed_initialize({ brand_guide, avatars[], journeys[], grids[], media[] })` call
  instead of 15-20 individual creates. Each section is independent (avatars alone is fine), a grid
  may set `target_avatar_name` to point at an avatar created in the SAME payload (the server
  substitutes the new avatar's id), and errors are per-row so one bad item does not fail the rest.
  Read back `{brand_guide_id, avatar_ids[], journey_ids[], grid_ids[], media_asset_ids[], summary,
  errors}` and report any per-row failures before moving on.
  **Profile caveat:** `account_seed_initialize` is visible only under the `full` profile (no
  `account_` prefix is granted to any scoped profile). On a scoped `marketing` key, fall back to
  the individual create-then-populate calls below.
- **Otherwise create the row, then enrich it.** The populate tools take an `entity_id` - they
  enrich an EXISTING row, they do not create one. So `customer_avatar_create({ name, ... })` first,
  then `customer_avatar_populate({ entity_id, ... })`. Same for
  `customer_journey_create` → `customer_journey_populate` and `before_after_grid_create` →
  `before_after_grid_populate`; then `customer_journey_link_to_avatar` /
  `before_after_grid_link_to_avatar` to relate them. `entity_populate({ entity_type: 'avatar' |
  'journey' | 'grid', entity_id, ... })` is the same tool with the type passed explicitly.
- **The populate tools REFUSE without grounding.** If the account has no `brand_style_guide` AND you
  supply no `urls_to_scrape` / `search_queries` / `agent_notes` / `related_research`, the call
  returns 400 `code: 'context_insufficient'` and never reaches the LLM. On a fresh account - exactly
  the case that sends you here - you MUST pass grounding: `urls_to_scrape` (max 5; the homepage plus
  /about plus key service pages are highest-signal), `search_queries` (max 3), `agent_notes` (max
  8KB), `related_research` (max 16KB), `additional_instructions` (max 2KB). Expect ~10-60s per call
  when scrapes or searches are requested.
- **Surface `_meta` before treating the output as fact.** Every populate response carries
  `{requires_human_review, fields_with_low_confidence[], sources_used[], notes}`. Show it to the
  user on fresh or sparse accounts. The model is instructed to leave fields null and arrays empty
  when the context does not ground a confident answer - a null field is the tool working correctly,
  not something to fill in yourself.
- **Brand guide.** `brand_guide_create` REQUIRES `name` + `color_primary`, and every color field is
  format-validated as `#rgb` / `#rrggbb` / `#rrggbbaa` - a create without a valid hex primary is a
  400 naming the field. The voice rules the quality gate enforces have machine-readable homes on
  `brand_guide_update`: `ai_forbidden_phrases`, `ai_preferred_phrases`, `copy_dos`, `copy_donts`,
  `brand_personality`, `ai_brand_adjectives`, `brand_is`, `brand_is_not` (all string[]; a bare string
  is auto-wrapped). Put the banned-phrase list THERE, not in a memory note. `mood_board_images` takes
  `{url, prompt?, style?}` objects; bare url strings are auto-wrapped by the route and
  `image_url` / `file_url` / `src` are accepted as `url` synonyms. Send objects anyway: anything
  that reaches the column un-normalized renders zero items in the dashboard editor, which reads
  `img.url` per item, even though the rows persist. Logos go through `brand_guide_set_logo` (slots:
  logo_primary_url, logo_secondary_url, logo_wordmark_url, logo_icon_url, logo_dark_url,
  logo_light_url; pass an explicit `null` to clear one). `brand_guide_delete` only soft-deletes
  (is_active=false), so churn leaves tombstones that inflate the dashboard counts - find them with
  `brand_guide_list({ is_active: 'false' })` and hard-delete with `brand_guide_purge` (409
  still_active if not soft-deleted first, 409 fk_constraint if anything still references it).
  Confirm with the user before purging: purge is irreversible.
