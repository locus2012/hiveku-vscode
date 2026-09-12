---
description: "\"Which comparison and alternatives pages should we write?\" / \"write the [rival] alternatives page\" / \"we need a best-X-for-Y page\" - the bottom-funnel play: the plan from the tracked rivals, the segments and real search volume (two research calls, said first), the candidates with their pricing URLs and proof counts beside the dropped list, drafts seeded only on an explicit yes, then each draft filled from pages read this session with a source and a date on every rival claim. Read-only until the confirmed seed; nothing publishes."
argument-hint: "<website project or site host> [rival hosts, optional]"
---
Bottom-funnel plan for $ARGUMENTS. Follow the **hiveku-content-agency** skill; load
`references/site-architecture-and-decay.md` (the plan, the seed, the comparison table contract)
and `references/structure-and-conversion.md` (the offer the decision CTA points at, the eleven
rules). Context: `account_context_get({ domain: "content" })`. The rule: a rival claim with no
source and no date does not ship, and "learn more" is not a decision.
1. **The site and the rivals.** `sites_list` for the website project (its `id` is `project_id`;
   the host is what the competitor set is matched on). `seo_list_competitors` for what is tracked;
   a rival the owner names that is not tracked rides in `rivals[]` as a host. `brand_positioning_get`
   for `category_name` (the plan's category; an empty positioning falls back to the industry -
   say so) and `customer_avatar_list` for the segments. No avatars or no rivals is a plan with
   `candidates: []` and a note; fix the foundation first (Play 1), never invent a segment.
2. **STOP: say what the plan spends.** Up to two DataForSEO research calls against the monthly
   cap (one keyword overview for every phrase, one keyword-ideas discovery); a spent cap answers
   402 with nothing written. Proceed on the yes.
3. **The plan, read-only.** `content_bofu_plan({ project_id, seed_drafts: false, rivals? })`.
   Present `candidates[]` as a table: type (vs | alternatives | best_for), title, target keyword
   with its variants, volume and difficulty, the rival and its pricing URL
   (`evidence.rival_facts_sources[0]`), the segment, and the own-proof counts
   (`evidence.own_proof`: testimonials, reviews, grid results for that avatar at Decision). Then
   `dropped[]` with each `reason` in plain words: `keyword_collision` names an item already on
   the keyword - that one is a refresh (`/hiveku:refresh`), never a twin; `volume_below_floor`
   and `difficulty_above_cap` are numbers, not opinions. `warnings[]` and `notes[]` verbatim.
4. **STOP: which ones.** The owner names the candidates to seed (or a count). A "vs" page against a
   rival the owner does not want named is skipped here, not written and unpublished later.
5. **Seed the drafts.** `content_bofu_plan({ project_id, seed_drafts: true, max_candidates:
   <the approved count>, rivals? })` - one DRAFT row per candidate from the three bottom-funnel
   templates (`content_type` comparison or alternatives, `page_role` money, Decision stage,
   `search_intent` commercial, the avatar, the keyword, `settings.bofu` with the sources and proof
   counts, an empty `comparison_table` and `decision_cta`). Read `seeded.created[]` back by
   `content_id`; `seeded.skipped[]` is relayed with its reason (a collision that appeared since the
   plan, a write that failed). Idempotency-Key is honoured: a retry does not seed twice.
   `content_bofu_plan_get({ project_id })` reads the stored plan back any time.
6. **Fill each draft, one at a time.** Per row, `content_get({ content_id })`, then in this
   order: (a) rival facts - `seo_competitor_get` for the profile, `seo_competitor_changes` for
   what moved, and `web_scrape` on each URL in `settings.bofu.sources`, the pricing page first;
   every cell about the rival is copied from a page read THIS session, with that URL as `source`
   and today as `checked_at` on the row, values in column order (the brand column first); a fact
   no page states is left blank and named, never recalled; (b) own proof -
   `content_proof_pack({ avatar_id, journey_stage: "Decision" })`, `consent: true` quoted with
   attribution, `consent: false` paraphrased with no name, one proof element per H2; (c) the
   body through `talk_to_department({ domain: "content", message })` carrying the table, the
   proof entries with their citations, the seeded headings and the honest-concession section
   (where the rival is the better choice - required); (d) the decision -
   `brand_offers_get` for the offer, then `settings.decision_cta { decision, label, url, offer_id
   }` naming ONE decision and where it goes, and the `::cta{variant=end}` placement on its own
   line; (e) write it all with `content_update({ content_id, content, settings: {
   comparison_table, decision_cta }, offer_id })` - the settings PATCH merges top-level keys and
   replaces each key whole, so send the complete table. A long draft can outrun the bridge:
   `department_turn_get({ turn_id })` until `completed`; never re-send the brief.
7. **The gate.** `content_seo_check({ content_id })` until `result.ok`: `comparison_table_missing`
   and `competitor_claim_unsourced` (a rival row without `source` and `checked_at`, named by
   criterion) are errors; `cta_missing`, `title_generic` and `answer_block_missing` are warns to
   state with a decision; `author_missing` means the row needs its byline (`content_authors_list`).
   Then the title step (`content_titles_generate` then `content_titles_pick`), the share link for
   the owner's sign-off, and the Play 4 publish on the day - none of it from here. The memory
   note for this session: which rivals were planned, which candidates were seeded, which the
   owner declined; one PM task per seeded draft, tied to its row with `content_link_tasks`.
8. Finish every session of work the same way: persist notable learnings to department memory - read the department's current document with `memory_list({ domain: "<dept>" })`, append your note to the `content` it returns, and send the WHOLE merged document to `memory_update({ memory_id, content })`, which REPLACES it (sending only the new note destroys everything that department had accumulated); use `memory_create({ type: "memory", name: "<dept>", content })` only when no entry exists, and keep `<dept>` to a canonical department name (see hiveku-orient), and reflect the work in Hiveku PM: `pm_projects_list` to find the project (it filters only by `status`; `project_type` is named in its description but is NOT in its schema, so the proxy drops it and you filter the returned list yourself), or `pm_projects_create({ name, project_type })` where project_type is one of seo | ppc | marketing | website | app_dev, then `pm_tasks_create({ project_id, title })` (the field is `title`, not `name`), `pm_tasks_update` as it moves, `pm_tasks_complete({ id, summary })` when the loop is closed. Reopen a task closed too early with `pm_tasks_uncomplete`, never `pm_tasks_update`. A memory_update that destroyed content is recoverable: `memory_list_versions({ memory_id })` lists the snapshots taken before every PUT or DELETE, and `memory_restore_version({ version_id })` restores one (it works for deleted entries too). Hiveku, not this folder, is the source of truth.
