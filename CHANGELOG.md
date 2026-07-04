# Changelog

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
