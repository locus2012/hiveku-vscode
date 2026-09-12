# Changelog

## Unreleased
- **The content skill runs the elite content round.** `hiveku-content-agency` is re-vendored from the plugin: every brief searches the knowledge bases first and runs `content_research_run` when the row's research stamp is missing or older than 30 days, citing each claim's source; consideration and decision pieces read `content_proof_pack` before the draft and carry one proof element per H2, with an unsourced figure an error at the decision stage; every calendar row is written with its distribution plan (owned email first, paid winner-only) and the publish event's repurpose and weekly-digest templates are offered staged; the next brief is chosen from the scorecard's leads per piece and `marketing_campaign_roi`, not views; case studies come from a won deal through `content_case_study_draft` with the consent rule. Two new references (`research-and-proof.md`, `distribution-and-scorecard.md`) carry the contracts.
- **The Marketer role receives `/hiveku-sme-interview`.** The vendored content skill sends a research gap to the expert interview, and the command is now the plugin's own file, byte-checked like the email plays: questions from the brief and the proof pack, a pasted transcript or a voice call id, quotable lines pulled verbatim with attribution and stored on the item as the sources the draft cites.
- **`/hiveku-repurpose` names the link shape that credits the piece** (`utm_medium=content` and `utm_content=<slug>`, as `social_repurpose_source` now returns them).
- **Sending an email campaign from Operate is a three-step ladder.** The single Send now button (one modal click on a tool whose un-flagged call IS the send) is replaced by Preview recipients (`email_campaign_send_now` with `dry_run: true`; the completion message reports queued, skipped and no-opt-in counts and nothing goes out), Test send (`email_campaign_test_send` to up to five real mailboxes, never a reserved test domain), and Send now, which is refused until a preview exists and then requires typing the queued count from that preview. Pause and Resume name what they do to queued rows. The typed confirmation is a new `confirmTyped` primitive on `ActionSpec`.
- **The email department has an agent.** `email` joins the chat-domain list, so the chat picker and Operate row actions reach `talk_to_department({ domain: 'email' })` instead of reporting that no agent exists.
- **The email setup playbook teaches the real gates.** `marketing_setup_status` first, `email_domain_check_dns` over `email_domain_verify`, the CAN-SPAM mailing address before any campaign, a consent attestation on every audience (visitor-derived audiences are refused on opt-in accounts), `email_audience_preview`, the dry run, the test send, then schedule or send; and a warning that `email_template_*` is the transactional store while campaigns use `marketing_template_list`. `src/dept-manifest.json` and the plugin's `lib/dept-manifest.json` are regenerated from it.
- **Campaign exports show real dates.** The Campaigns table carries `scheduled_for` and `sent_finished_at`; the `sent` column, which read a `recipients_count` / `sent_count` field the list tool never returned, is gone.
- **`/hiveku-email` and `/hiveku-email-review` are vendored, not retyped.** The marketer role's inline copies (stale: `email_domain_verify` over check_dns, a `total_sent` field the tool does not return, the marketing context instead of the email department's) are deleted; the plugin's own files are written through the same generator and byte gate as the social and dev commands. `hiveku-communications` (email infrastructure, the send ladder, inbox, sequences) is vendored and given to the marketer role.

## 0.80.1
- **The content skill is current.** `hiveku-content-agency` is re-vendored from the plugin: every draft is grounded on the account's customer avatar, journey stage and before/after grid and records that grounding on the content row through `content_create` / `content_update`; the pre-publish gate calls `content_seo_check` and fixes every error before `content_publish_to_site`; internal links come from `content_site_links`, never invented; a department turn that outruns the MCP window is resumed with `department_turn_get`.
- **Every tracked external site opens the same way.** 0.80.0 widened `external_platform` to the builder's six values (`url`, `webflow`, `wordpress`, `squarespace`, `wix`, `shopify`) and labelled each row as itself, but only the Webflow row resolved its click-to-open URL from `external_website_url` with `custom_domain` as the fallback; the other five read `custom_domain` alone, which the builder never sets on an external row, so a Squarespace, Wix, Shopify, WordPress or plain-URL site rendered an inert row with no URL in its tooltip. One resolver (`externalSiteUrl`) now serves the tree row's click, the globe action and every platform, adding `https://` when the recorded URL was typed bare. The row's host is the hostname of that URL rather than the builder's internal `ext-<slug>-<hex>` subdomain, which has no DNS behind it.
- **The Dev role receives `/hiveku-webflow` and `/hiveku-cms`.** The vendored web-agency skill sends a Webflow-hosted site to `/hiveku:webflow`, but the extension vendored the doctrine without the command, so the reference dangled in every Dev workspace. Both are the plugin's own files, byte-checked by `npm run check:skills` like the social commands. In a downloaded project folder the project-scoped `/hiveku-cms` (project id baked in) keeps precedence: the role scaffold neither overwrites it nor removes it on a role switch.
- **The Webflow reference is current.** `hiveku-web-agency/references/webflow-sites.md` is refreshed from the plugin: 111 actions, every row live (the nine beta SEO tools and the content-source switch included), with the 32 confirm gates, 15 OAuth-only calls, 14 Enterprise-only calls and 3 secondary-locale-only DOM writes marked per row.
- **A failed refresh is reported as a failure.** A tool failure in the department pull, the console probes and the detail dumps used to become data and then be reported as success: "Saved 0 rows across 5 departments" on a revoked key, a live Google Ads connection shown as not connected after a timeout, dead fetches counted as full files. Failures are now counted, written into the dataset JSON and STATUS.json, and named in the department README; the generated `.hiveku/pull-data.mjs` and automations client get the request budget and bounded body read the extension's own client already had; the 429 retry honours Retry-After; Sales is routed to its own agent server instead of Outbound.
- Correction to 0.78.0: "a shared `hasLocalCode` predicate replaces the six scattered checks" overstated it. The six call sites use `isExternalProject`; `hasLocalCode` is the shared predicate exported beside it, available to them for the day python-lambda projects are folded into "no code here".

## 0.80.0
- **A department that acts without writing a reply now says what it did.** The server returns `response: null` for a tool-only turn — the normal shape for customer journey, avatar and before/after grid work, which is tool-heavy and often writes no prose — and carries the substance in `note`, `tool_calls` and `data_updates`. The panel missed it (`typeof null === 'object'`), fell through to a generic "returned no answer (it may have run tools without replying)", and threw all three away: you were told nothing happened while records had been rewritten. Those turns now render as an activity bubble naming what ran and what changed, with ids. This matters more than it did a week ago — the MCP server's SSE parser split frames on `\n\n` while the agent servers emit `\r\n\r\n`, so `talk_to_department` returned nothing for *every* department; with the framing fixed, this shape becomes the common case rather than an unreachable branch.
- **A whitespace-only reply is treated as no reply**, so a stalled turn no longer renders a blank agent bubble and discards the tool calls that did land. The stream-timeout case now names them: a half-finished write you do not know about is worse than a blunt error.
- **The extension stops giving up before the server does.** `callTool` budgeted 60s for anything outside a hand-maintained nine-name table, while 262 tools declare a server-side budget above 60s and 259 of them were missing from it — including `ppc_sync` (wired to "Sync from platform"), `talk_to_department`, and the bulk CMS and restore operations. Several are writes, so the operator was told the call failed after it had succeeded. The default is now the edge ceiling rather than 60s, which stays true without anyone maintaining a table across ~2,000 tools. The known-slow overrides remain as documentation, clamped on read.
- **Three live Microsoft Ads writes were auto-approved in every scaffolded folder.** The `*_list_*` glob spans underscores, so alongside the 47 GET readers it exists for it also matched `ppc_bing_shared_negative_list_create`, `_items_add` and `_associate` — tools whose own descriptions say every associated campaign starts blocking those terms immediately. The glob is kept (dropping it would prompt on every CRM and SEO read); the three writes are denied by name, which beats an allow and beats the permission mode. The `check-permission-rules` gate that waved this through while reporting "0 mutations" now scrapes the allow array rather than the whole file, subtracts denials, and treats POST-dispatched reads by name — so the next leak fails the publish instead of shipping.
- **Squarespace, Wix and Shopify sites are labelled as themselves.** The extension's platform union was three behind the builder's, so those resolved to `url` and their tree row read "external". The union and its labels are mirrored from the builder rather than kept as a third copy, and the new-site command teaches the full enum.

## 0.79.0
- **Webflow automations in the department data.** The workflow surface a Hiveku site can drive now includes Webflow: thirteen triggers covering site publishes, the CMS item lifecycle, page creation, deletion and metadata changes, new comments and form submissions, plus an action node for every operation in the Webflow registry. Ask the AI for "when a CMS item is published, draft a social post" and the nodes it needs are in the catalog it reads.
- **Webflow sites keep the treatment they got in 0.78.0**: recognised through `external_platform`, opened at their Hiveku workspace rather than an empty file tree, and skipped by every code lane that has nothing to pull or deploy.

## 0.78.0
- **Webflow sites are first-class external projects.** A project whose site lives on Webflow is recognised through the new `external_platform` and `cms_provider` fields that Hiveku now returns on every site, and its tree node opens the Webflow workspace in the dashboard instead of an empty file tree. A shared `hasLocalCode` predicate replaces the six scattered "not external" checks, so every code lane (pull, push, branches, console) treats Webflow and tracked-URL sites the same way: nothing to pull, nothing to deploy.
- **The site commands teach the real enum.** `site_create` offers `nextjs`, `vite`, `static-html` and `internal`, and `site_create_external` takes `external_platform` (`url`, `webflow`, `wordpress`).
- **The Dev role vendors the web agency skill**, including its new Webflow sites reference: what the Webflow API can and cannot change, the stage-then-publish discipline, and the availability table for the `webflow_*` tools.
- **Partial bulk saves resume from `remaining_paths`** instead of re-sending the whole batch.

## 0.77.0
- **The Social Manager role gets the real social department.** `hiveku-social-agency` (with its thirteen references: hooks and formats, audience grounding, the anti-fluff rubric, repurpose, creative handoff, connection health and syncs, and the rest) and all ten social plays (`/hiveku-social-onboard`, `social-post`, `repurpose`, `social-calendar`, `social-audit`, `social-proof`, `creative-brief`, plus `social-plan`, `social-report`, `engage`) are scaffolded byte-identical to the Claude Code plugin. Every role now also receives `hiveku-orient`.
- **Skills and commands are vendored, not retyped.** `assets/skills` and `assets/commands` are generated from the sibling plugin checkout by `npm run gen:skills` and byte-checked by `npm run check:skills`, which runs in `vscode:prepublish`; the 2,000-line `agencySkillsContent.ts` copy that had drifted from the plugin is gone.
- **Operate > Social tells the truth about publishing.** The old "Publish" button, which queued a post for approval while promising to publish it, is replaced by "Send to approval queue" with guards (a scheduled and approved post is the cron's; a published post is not re-sent) and a completion message read from the response; a "Reject (back to draft)" action records the reason the author sees; the ignored platforms input is gone. New sections: Approval queue, Calendar (next 60 days), Comments needing a reply. There is still no approve action anywhere: approving is a human act in the dashboard.
- **`/hiveku-social-plan` no longer schedules.** The scaffolded command used to tell Claude to set `scheduled_at` on drafts, which the every-minute cron publishes; the vendored plugin command omits it and confirms each schedule separately.
- **hiveku-data/social grows.** The pull now carries calendar events, comments, hashtags, schedule slots and the trailing-7-day analytics summary next to accounts, posts and pillars; accounts carry their health columns (connection status, can_post, last_error, token state); SETUP.md drops YouTube (no publisher exists) and names `social_post_validate` before any schedule.
- **Four consent checkboxes that pulled nothing now pull.** Customer avatars, customer journeys and before/after grids map to the creative department's datasets; graphic design maps to the site's pages.

## 0.75.0
- **Push on a branch now writes the branch.** "Push Local Changes" from a checked-out branch used to save code into `main` (the live project) while the progress title named the branch. The code lane and deletions now target the branch's working tree; binary assets are still uploaded to the project's shared asset store (logged as such).
- **Pull, diff and discard are branch-aware.** "Pull Latest" on a branch materializes that branch's tree (code only; the main-only snapshot tarball is no longer used there). Clicking a changed file diffs against the branch's copy, and "Discard Changes" restores the branch's copy instead of main's.
- **"You're behind" guard on branches.** Before a commit or push off main, the extension compares the working-tree fingerprint recorded at your last pull/switch with the live one; if someone else saved on the branch since, you get the same Pull first / continue prompt main has. A folder checked out on a branch before this version has no recorded fingerprint yet, so the guard stays quiet there until your next Pull Latest or Switch Branch.
- **Commit with nothing local promotes.** On a branch with no local changes but uncommitted edits in its working tree (an agent's push, for example), Commit offers to promote those edits into a commit.
- **Pull requests: Review files, Reopen, Delete branch.** A PR now lists its changed files and opens a side-by-side diff per file (target vs source, working trees included; binary and oversized files are labelled). Closed PRs can be reopened. After a merge you can delete the source branch in one step, with any development/staging binding cleared first.
- **Deploy shows what each tier ships.** The environment picker reads the branch bindings first: "development - serves branch feat/x", "production - always main", and warns when the tier you picked does not serve the branch you are on.
- **Branch previews are tracked.** "Preview Branch on Fly" keeps the session, polls its status (up to ~4 minutes) instead of spawning a second app, and a new "Hiveku: Stop Branch Preview" command tears it down.
- **Revert on a branch.** "Revert to a Commit" now works off main: it moves the branch back to one of its own commits (a new revert commit; nothing is deleted) and refuses if the branch moved since you looked.
- **Branch in the status bar.** A second status-bar item shows the checked-out branch; clicking it opens Switch Branch. It refreshes on every switch, including the ones triggered from Create Branch and Merge.
- **Deploy production asks first.** The post-merge "Deploy production" button confirms in a modal before anything ships; a click on a passing notification can no longer go live on its own.
- **Post-merge "Delete branch" puts bindings back when the delete is refused.** The extension clears a development/staging binding before deleting the branch; if the delete is then refused (a stash branch that needs force, a pull request still labelled open) or fails, the cleared tiers are rebound to the branch and the message names which tiers came back and which could not.
- **Environments relays the CMS warning.** When a tier is pointed at a branch on a project with a CMS, the server's warning (CMS edits keep writing to main and will not show on that tier) is now shown with the confirmation instead of being dropped.
- **Deploy reports its id and the promotion note.** The deploy id was logged as "(no id)" on every deploy (the route calls it `deploy_id`); it now shows, and a bound-tier deploy that committed uncommitted branch edits says so.
- **Merge reports a late label.** When a merge lands but the pull request's label is still settling, the message says so and the "Delete branch" offer is withheld until the label is settled (the delete would be refused as an open pull request).
- Longer timeouts for large pushes, branch checkouts and branch previews, so a batch the server finishes is no longer reported as a timeout.
- Claude Code scaffold: `/hiveku-commit`, `/hiveku-pull`, `/hiveku-push` and `/hiveku-deploy` now describe the branch flow (the link's branch, promote-with-no-files, bindings before deploy), and new `/hiveku-branch` and `/hiveku-pr` commands cover branches, bindings and pull requests. The scaffold's read-only permission list covers the new per-file diff and preview-status reads.

### Creative designer
- **The creative skill teaches what the platform now does.** `hiveku-creative-agency` (designer, marketer, social, owner scaffolds) carries the image quota pre-flight (`media_image_quota`: `remaining` is null, never 0, when the read failed or the plan is unlimited), brand-aware generation by default with `brand_applied` / `brand_skipped_reason` on the response and a 503 `brand_unavailable` refusal before any slot is spent, `generate_image_set` batch defaults (`use_brand`, `target_width` / `target_height`, per-prompt override replaces), the three media operations (`media_import_url` copies bytes, `media_transform` crops and resizes for free, `media_upscale` costs a slot plus fal dollars under a 32 output-megapixel cap; every operation is a new asset and `media_update` refuses the physical columns), video duration honesty (`duration_requested` / `duration_effective` / `duration_note` and the per-lane snap table), the inline-thumbnail screen (`featured_image_inline`), custom brand fonts rendering in server exports with degrade lines in `warnings`, the design inbox ears (`design.comment`, `design.video_completed`, `design.video_failed` through the `agent_inbox_*` tools), the attach-to-post handoff (`social_update_post` `media_urls` + `media_types`, index-aligned), the six wide-format templates, and the current proxy budgets on the four long design tools.
- **Designer loops and cadence.** `/hiveku-design-brief` opens on the inbox ears and the quota read, and finds boards with `marketing_video_pipeline_list` instead of the memory ledger alone; `/hiveku-design-produce` reads the meter before any batch, uses the free transform before a regeneration, upscales only under a confirmed cap, saves canvases with `expectedSectionsVersion`, publishes with `set_as_featured`, and hands finished creative to a post through `social_update_post`. `/hiveku-weekly` and `/hiveku-report` for the designer cover the inbox, the render and pipeline lists and the image spend.
- `/hiveku-media` names the import, transform and upscale lanes and attaches media to posts with `media_urls` + `media_types` (the post routes never took `media_asset_ids`). The Brand & Creative setup playbook says uploaded fonts render in exports and reads the quota before its one proof generation. The scaffolded CLAUDE.md creative block carries the quota pre-flight and the new-row rule.
## 0.25.0
- **Account search/filter** in the sidebar title bar — type to filter the account list by name or ID (essential for agencies / SaaS owners with many accounts). A clear-filter button appears while a filter is active.

## 0.24.0
- **Shows who's connected.** Each account in the sidebar now displays **"Connected as &lt;email&gt;"** (captured from the Connect flow). Populates after reconnecting once the server-side per-user key change is live.

## 0.23.0
- **Task details on click.** Clicking a task in the sidebar now opens a detail view (status, priority, due, assignee, project, description) with **Complete**, **Comment**, **Open in Hiveku**, and **Copy for Claude Code**. (Tasks were previously non-clickable.)
- **Helpdesk is now first-class.** A **Helpdesk** entry under each account (+ `Hiveku: Helpdesk` command and account menu) opens the tickets panel — reply, set status/priority, drill into a ticket, or hand it to Claude.
- **"Copy for Claude Code"** on tasks and tickets (sidebar + Operate panels) — copies a ready-to-paste prompt that references the item by id so Claude Code can pick it up with the MCP tools.
- Fixed the sidebar workflow on/off indicator (was reading `enabled`; now `is_enabled`).

## 0.22.0
- **Account-workspace accelerators** (symmetric with projects). "Open Account as Workspace" now also scaffolds the `.claude/settings.json` allowlist plus account-level slash commands: **`/hiveku-brief`** (load brand context first), **`/hiveku-chat <dept> <msg>`** (run a department agent), **`/hiveku-find <task>`** (locate the right tool among ~1,000), **`/hiveku-sync`** (knowledge drift check).
- **Merge-conflict guidance** added to the project `CLAUDE.md` — the `<<<<<<< / ======= / >>>>>>>` marker format and how to resolve + commit.

## 0.21.0
- **Claude Code accelerators in every project.** Downloads now scaffold `.claude/settings.json` (acceptEdits + an allowlist of Hiveku read tools and safe bash, so Claude stops prompting on nearly every call) and `/hiveku-*` slash commands — **`/hiveku-status`, `/hiveku-commit`, `/hiveku-pull`, `/hiveku-verify`, `/hiveku-deploy`, `/hiveku-preview`** — each with the project id baked in and the correct tool order encoded (deploy runs verify + preflight first). CLAUDE.md lists them.
- **Commit-baseline auto-sync.** After a commit made out-of-band (Claude via `project_vcs_commit`), the SCM "you're behind" anchor self-heals the moment local == remote, so the panel stays accurate.
- **Security fix.** `.mcp.json` (which holds the inlined MCP key), `.env.local` / `.env.hiveku` (pulled secrets), and `.claude/` are now excluded from the Hiveku change set, so they can never appear as changes or be committed into the project's Hiveku files. If you committed `.mcp.json`/`.env.local` to a project on 0.18–0.20, delete them from the project and re-mint the account's MCP key.

## 0.20.0
- **Push/pull instructions for Claude Code.** Every downloaded project's `CLAUDE.md` now spells out the exact Hiveku workflow: edits are a local mirror until you commit; **push** with `project_vcs_commit` (or the Source Control "Commit to Hiveku" button), branch/preview/merge for side work, and `deploy_site` to go live (commit ≠ live); **pull/check drift** with `project_files_status` and `project_vcs_checkout`, with explicit "don't clobber remote work" guidance. The section refreshes on every Pull (and preserves any of your own `CLAUDE.md` content above it).

## 0.19.0
- **Media Library gallery** — a searchable thumbnail grid over the account-wide media library (`media_library_list`). Click a tile (or **Copy URL**) to put its hosted URL on the clipboard, **Open** to view it; search + media-type filter run server-side so it scales. From the sidebar (account → Media Library) or the Command Palette.
- **Guided Setup** — a first-run onboarding that asks single-account vs agency and where to keep your files, then connects you. Available anytime via **Hiveku: Guided Setup** and the sidebar welcome.
- **`hiveku.workspaceRoot` setting** — set a root folder and downloads nest cleanly as `<root>/<account>/<project>` with no per-download folder prompt (each account gets its own subfolder — the agency-friendly layout).

## 0.18.0
- **Claude Code now has the whole account in every downloaded project.** Downloading a project wires a gitignored `.mcp.json` (the `hiveku` MCP server) into the folder, so Claude Code there can operate **every department** — CRM, SEO, email, helpdesk, social, ads, content, workflows, PM, voice — alongside editing the site's code, in one session. Adds a `CLAUDE.md` section explaining the toolset and that live data has no local files (use the tools). Merges into any existing `.mcp.json` / `.gitignore` / `CLAUDE.md` non-destructively, and backfills on the next **Pull**.
- **Fixed account-workspace MCP auth.** The scaffolded `.mcp.json` used `Bearer ${OLYMPUS_API_KEY}`, but Claude Code only expands `${VAR}` from the shell environment (it does **not** auto-load `.env`), so the key never resolved and "Open Account as Workspace" couldn't reach the tools. The key is now inlined and `.mcp.json` is gitignored.

## 0.17.0
- **Site env / secrets:** new **Pull Env to `.env.local`** and **Push `.env.local` to Hiveku** commands (Command Palette + Source Control menu). Pull writes the project's real secret values to a gitignored `.env.local` so local `npm run dev` matches the deployed env, applying the same rule as the Fly preview (skip `_PROD`/`_STAGING`, let `_DEV` override its base key). Push reads `.env.local` and upserts the values back (with a confirm — it updates the deployed env + live preview).
- **Fixed the Project Secrets panel + picker** — they read an array but `project_secrets_list` returns a `{ secrets: { KEY: value } }` map, so they showed nothing. Now lists keys with **masked** values, and the picker can update / delete a key or pull/push the whole set. `project_secrets_set` now uses the required `{ secrets: {…} }` map shape (was sending `{key, value}`, which the tool rejects).
- Engine: sections can declare a `transform` to map non-array tool responses into rows.

## 0.16.0
- **Account Console parity fixes** (same shape bugs as the dashboard): workflow on/off badge + enable/disable now read `is_enabled` (was `enabled`, always "off" + disable never worked); run badge marks `failed` runs red (was only `error`); deal rows show the nested `stage.name` and format Decimal-string `value` as money.

## 0.15.0
- **Agency Dashboard fixes:** "workflows enabled" read `enabled` (real field is `is_enabled`) so it always showed 0/N; failed-run count matched `error` (real status is `failed`) so it always showed 0. Both corrected via shared `isWorkflowEnabled` / `isFailedRunStatus` helpers.
- **Workflow toggle fix:** the sidebar enable/disable computed the next state off `.enabled` (undefined) so it could only ever enable; now reads `is_enabled`. Same `failed`-vs-`error` fix applied to the "What Needs Attention" badge.
- Verified the last 11 tool shapes (email/pm/ppc/analytics): email audiences (`estimated_size`), email sequences (`is_active`/`total_enrolled`), PPC connections (`display_name`/`connection_status`/`campaign_count`) and campaigns (`campaign_type`), analytics pages (`page_path`/`views`) and traffic sources (`source_type`/`total_sessions`) now show real values. Workflow run drill-in confirmed (`workflow_id`+`id` both present).

## 0.14.0
- **Verified every panel's display fields against the real route handlers** (traced 58 tools to their Olympus routes). Fixed panels that would have rendered empty or blank: `design_list` (`{projects}` wrapper), `voice_recent_calls` (`{data:{calls}}`), `project_domains_list` / `project_crons_list` (nested/oddly-wrapped arrays) now render; deal **stage** (`stage.name`), workflow **enabled** (`is_enabled`), estimate **total** (`total_cents`, was 100× off), voice rows (`e164` / `display_name` / `from_e164`), content **schedule** (`scheduled_publish_at`), memory **dept** (`domain`), checkpoints (`message`), pages (`name`/`slug`), redirects (`from_path`/`to_path`), and more now show the right values.
- Engine: **robust row extraction** (handles `{data}`, `{projects}`, `{data:{calls}}`, `{functions}`, …), **dot-path fields** (`stage.name`, `_count.deals`), **cents money** + Decimal-string money, boolean (`yes/no`) and plain-string rows.
- VCS: `buildManifest` now skips binary files so assets no longer show as phantom "added" changes on a clean pull (the server's status diff is text-only). Verified commit / status-hashing / checkout / branch / merge alignment against the live route handlers end-to-end.

## 0.13.0
- **Verified every write action against ground-truth tool schemas.** Fixed params that would have silently failed: DNC now sends the required `reason`; estimate send/accept ask for channel + signer; estimate/envelope actions use `estimate_id`/`envelope_id`; helpdesk reply/status/priority use `id` + `body` (status enum corrected to resolved); PM comment uses `content`; MC move uses `to_status` (real enum); email campaign asks for `from_email`; content schedule uses `content_id`/`action_type`/`scheduled_at`; social publish uses `post_id` + `platforms`; memory delete uses `memory_id`; page create uses `name`/`slug`/`page_type`.
- Engine: **multi-arg drill-in** (e.g. workflow run debug now passes `workflow_id` + `run_id`) and **comma-separated list inputs** (social platforms).
- SEO panel scoped correctly — audits are per-project (server-enforced), so the account view no longer hard-errors; removed the CMS "+ Collection" quick action that needed a full field schema.

## 0.12.0
- Panels: **filter box + Refresh** on every Operate / Project panel.
- Workflow **run debug** (click a run → node step states via `workflow_run_get`).
- Mission Control task **Move** (transition) action.

## 0.11.0
- Engine: **row drill-in** — click a row title to view the full record (deals, contacts, tickets, tasks, workflows).
- Write flows: CRM log-activity + DNC, email **+ Campaign** (audience picker), project **+ Page / + Collection / Deploy**, task **Comment**.

## 0.10.0
- Engine: **select inputs** (static + tool-backed pickers) for safer writes.
- New modules: Content, Brand & Creative, Voice, Calendar, Collaboration.
- Project panel: Analytics + Supabase sections; helpdesk status/priority as selects.

## 0.9.0
- **Quotes & Invoices** module (estimates → invoices → e-sign contracts).
- **Project Panel** (deploys, DB, CMS, pages, crons, domains, redirects, secrets) via a project-scoped engine context.

## 0.8.0
- **Config-driven module engine** + **Operate** command. 12 areas: CRM, Helpdesk, PM, Workflows, Email, SEO, PPC, Social, Integrations, Memory, Knowledge, Mission Control.

## 0.7.0
- **Open Account as Workspace** (Claude per account), **Account Console** (Tasks board + CRM + Automations), proactive **notifications** badge + "What Needs Attention".

## 0.6.0
- **Agency Dashboard** (cross-client KPI rollup); sidebar **Tasks** + **Workflows** sections.

## 0.5.0
- **Conflict detection** ("you're behind" + pre-commit guard), Fly **preview** / secrets / database / media commands, new bee logo.

## 0.4.0
- Knowledge **sync awareness** (manifest + drift), richer per-department `CLAUDE.md`, **File History** (versions + diff + restore).

## 0.3.0
- **Connect Hiveku** browser OAuth flow (cherry-pick accounts + departments).

## 0.2.0
- Activity-bar **sidebar** (accounts → departments + projects), welcome view.

## 0.1.0
- Initial: multi-account, full project download, Supabase-native VCS (commit / branch / merge / compare / history), deploy.
