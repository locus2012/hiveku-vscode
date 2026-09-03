# Recipes - the two per-account `_command:` rows, canonical text

Load this before writing the account's _command: recipe rows in /hiveku:social-onboard
(step 4), and whenever a department-agent or dashboard session asks why its `social-post`
or `social-repurpose` recipe differs from the plugin's command. The text below is the
source; the rows are copies of it. The plugin commands the recipes mirror are
`commands/social-post.md` and `commands/repurpose.md`; the craft they compress is
references/audience-grounding.md, references/hooks-and-formats.md, references/anti-fluff.md,
references/repurpose.md and references/creative-handoff.md.

## 1. What a recipe row is

- A `_command:<slug>` row in `account_ai_memory`, written with `memory_create({ type:
  'command', name: '<slug>', content })` (a 409 means it exists: `memory_list({ type:
  'command' })`, read it, compare it to this file, report the difference; replacing it is
  its own STOP with `memory_update({ memory_id, content })`). The reseed does not write
  recipes; the skill and the two rules are seeded, the recipes are written per account.
- The department agent's hydration copies every `_command:` row into `commands/<slug>.md`
  in its workspace and lists it in the agent's CLAUDE.md, so the row is read by the social
  agent on every turn that names the play. The first line MUST be `<!-- department: social
  -->`: hydration reads that tag from the content, a row without it derives department
  NULL and is hydrated into EVERY department's agent (the SEO agent would carry a social
  recipe), and `memory_create` has no `department` parameter to fix it afterwards.
- The vocabulary is the DEPARTMENT AGENT's, not the MCP's. The agent server spells its
  tools `social_post_create` / `social_post_update` / `social_post_list`
  (MCP: `social_create_post` / `social_update_post` / `social_list_posts`),
  `pm_task_create` / `pm_task_comment` / `pm_task_complete` (MCP: `pm_tasks_*`),
  `memory_list(entry_type, domain)` / `memory_create(entry_type, name, content)` /
  `memory_update(domain, content)` (MCP: `memory_update({ memory_id, content })`),
  `media_library_list(limit, offset)` / `media_library_get(asset_id)` (the library is
  also mirrored as `data/media_library.json`), `design_to_post(design_id, content, platforms)`,
  `knowledge_search_query(query)` (MCP: `kb_search`), `content_list` / `content_get`,
  `web_scrape(url)`. It reads the foundation from workspace files (`data/brand.json`,
  `data/customer_avatars.json`, `data/before_after_grids.json`,
  `data/customer_journey_maps.json`, `data/social_accounts.json`,
  `data/content_pillars.json`, `data/social_posts.json`), not from `customer_avatar_get`.
  It has NO `social_post_validate`, `social_repurpose_source`, `social_posts_bulk_create`,
  `social_calendar_*` or `talk_to_department`; a recipe that names one of those sends the
  agent to a tool it cannot call. `social_post_publish` exists there and is GATED: on a
  dashboard chat it stages an approval card, on an MCP turn it is never called.
- Size: each recipe stays under 2,500 characters including the tag line (the hydrated
  file is read on every turn; `wc -c` before the write). ASCII only.
- R-numbers in a recipe (`R3`, `R7`) cite `_rule:social-operating-rules`, which the
  agent's hydration auto-loads as `.claude/rules/social-operating-rules.md`; the recipe
  relies on that rule row existing (social-onboard step 4 writes it when absent).

## 2. `_command:social-post` (canonical text, write verbatim)

```text
<!-- department: social -->
# social-post - one post from a brief

Triggers: "write me a post", "post this on Facebook".

Read:
1. data/brand.json - voice, brand_is / brand_is_not, cta_primary, ai_forbidden_phrases.
2. data/customer_avatars.json - THE persona: pain_points, frustrations, buying_behavior.objections, online_behavior.social_platforms, typical_quote; no post on a platform it does not list; boilerplate is a gap to report, not a draft.
3. data/customer_journey_maps.json - the stage NAME for journey_stage.
4. Proof by id: data/before_after_grids.json (prompt-less images are real photos; never invent a before), knowledge_search_query(query), a public testimonial.
5. data/social_accounts.json - targets: connection_status connected, can_post true, never pending_selection. data/content_pillars.json - pillar_id; the CTA verb from the pillar's rung (R3).
6. Variance (R7): the last 20 posts there (data/social_posts.json) - max 2 of 10 with one hook, no repeated opening six words, no format three running.

Write: header first - For: <avatar> | Stage: <stage> | Pillar: <pillar> | Hook: <pattern> | Format: <format> | CTA: <verb>. The specific inside the hook, one idea, one CTA, one link (first_comment on LinkedIn and Facebook, body on X, link_url on Google Business Profile, none on TikTok). Variants in platform_overrides.<platform>.content; alt text (125 characters max) per item in media_alt_texts.

Gate: zero banned phrases (social-anti-fluff plus ai_forbidden_phrases), the competitor-swap test, Rubric: N/14 under the header, 11 or better, zero hard fails; one rewrite, then name the failing axes and stop.

Media: media_library_list then media_library_get(asset_id); attach by media_asset_ids. Text on the image is a designer brief: pm_task_create(project_id, title="CREATIVE: <platform> <format> - <title>", description=<brief>, task_type="design"); design_to_post(design_id, content, platforms) when a design exists.

On a yes, persist a DRAFT: pm_task_create(project_id, title, task_type="social_media"), then social_post_create with content, platforms, pillar_id, platform_overrides, first_comment or link_url, media_asset_ids, media_alt_texts, avatar_id, journey_id, journey_stage, before_after_grid_id, task_id; pm_task_comment with the post id; social_post_update to fix (platform_overrides replaces whole); close with the social_drafts.v1 block.

Never: scheduled_at (it publishes unattended), social_post_publish on an MCP turn, an invented persona.
```

## 3. `_command:social-repurpose` (canonical text, write verbatim)

```text
<!-- department: social -->
# social-repurpose - one published piece into a post set

Triggers: "turn this blog into posts", a URL or a content id.

Source, or refuse:
1. content_list(status="published", content_type="blog_post"), then content_get(content_id): body, featured_image_url, website_project_id (null = live nowhere the site serves), cms_entry_slug. A URL: web_scrape(url); the URL is the link.
2. Refuse a draft, scheduled or archived source, a page with no production URL (no preview or staging URL), a piece you did not read this turn.
3. social_post_list(limit=100), filtered on linked_content_id: earlier posts make this a second pass; name them.

Ground: data/customer_avatars.json for the persona the piece serves (social_platforms picks the platforms), data/customer_journey_maps.json for stage names, data/content_pillars.json (Educate and Authority; at most one Promotion post, late), data/social_accounts.json for connected can_post rows, the last 20 posts per platform (data/social_posts.json) for variance.

The set: 6-10 posts over 4-6 weeks, one per format, the piece as proof for each: question (unanswerable-question), data-point (specific-number), listicle (the H2s, count true), contrarian, case-study-3-lines (a measured result only), quote-card (a verbatim line), faq (objection-first), behind-the-scenes. Open Unaware and Problem Aware, close Product and Most Aware. Header and Rubric: N/14 (11+) on every post; variance inside the set.

Links: the production URL with utm_source=<platform>&utm_medium=social&utm_campaign=repurpose-<slug>: first_comment on LinkedIn and Facebook-with-media, link_url on Google Business Profile and text-only Facebook, body on X (a URL counts 23), nothing on TikTok. One link per post.

Media: the hero from data/media_library.json, confirmed with media_library_get(asset_id); text cards are designer briefs (pm_task_create, task_type="design", CREATIVE: <platform> <format> - <title>) or design_to_post(design_id, content, platforms).

On a yes, DRAFTS only: pm_task_create(project_id, title, task_type="social_media"), then one social_post_create per post with linked_content_id, avatar_id, journey_id, journey_stage, pillar_id, first_comment or link_url, media_asset_ids, media_alt_texts, platform_overrides, task_id; pm_task_comment with every post id; close with the social_drafts.v1 block.

Never: scheduled_at (scheduling is the operator's confirm), social_post_publish on an MCP turn, a persona you did not read.
```

## 4. Keeping the rows true

- When `commands/social-post.md` or `commands/repurpose.md` changes a rule the agent must
  follow (a new refusal, a renamed field, a changed gate), this file changes in the same
  commit, and the next `/hiveku:social-onboard` step 4 on each account reports the drift
  between the row and the file. The row is never edited from memory of what it said.
- A recipe never contradicts the rules: draft only (R9), no `scheduled_at`, no publish from
  an MCP turn, the header and the Rubric line on every post (R1, R5), proof by id (R4).
- The MCP-side twins of these plays stay in the plugin commands: the operator session runs
  `/hiveku:social-post` and `/hiveku:repurpose` with `social_post_validate`,
  `social_repurpose_source` and `social_posts_bulk_create`; the agent runs the recipe with
  the tools it has. Both persist drafts to the same `social_posts` rows.
