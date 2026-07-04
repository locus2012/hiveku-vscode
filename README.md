# Hiveku for VS Code

Run your whole Hiveku account — and every client account — from VS Code, with
Claude Code scoped per account. Code, departments, operations, and infra in one
place. Version control lives in Hiveku itself (Supabase-backed); **no GitHub
required**.

## Connect
Click the **Hiveku** icon in the Activity Bar → **Connect Hiveku** (a browser
flow where you pick accounts + departments), or **Sign in with a key** (paste an
MCP key from Settings → LLM Connectors). Keys are stored in the OS keychain. Add
several accounts to manage multiple clients.

## What you can do

**Per account, from the sidebar:**
- **Dashboard** — agency rollup across *all* connected clients: open/overdue tasks, workflows + runs, CRM, tickets.
- **Knowledge** — download department memory / skills / rules locally (with sync-drift detection), and **chat** any department (SEO, PPC, Sales, Helpdesk, …) — the server-side agent with full context.
- **Code Projects** — download a project, edit locally with Claude Code, and use the native **Source Control** panel.
- **Media Library** — a searchable thumbnail gallery of the account's media; click or **Copy URL** to put a hosted asset URL on the clipboard, **Open** to view.
- **Tasks** & **Workflows** — open tasks (complete inline) and automations (run / enable / disable).
- **Operate** — a panel per area: **CRM** (deals, contacts, sequences, activity), **Quotes & Invoices** (estimates → invoices → e-sign contracts), **Helpdesk** (reply / status / priority), **Email**, **SEO**, **PPC**, **Social**, **Content**, **Brand & Creative**, **Voice**, **Calendar**, **Integrations**, **Memory & Skills**, **Knowledge Bases**, **Mission Control**. Each lists records, **drills in** (click a row), **filters**, and **acts** (create / update / send / run).
- **Open Account as Workspace** — opens the account folder (with `.mcp.json` + `CLAUDE.md`) in a new window so **Claude Code is scoped to that one account** — every department's tools, not just code.

> Every **downloaded project** also gets the account's `.mcp.json` wired in (gitignored), so Claude Code in a project folder can do cross-department work — *"fix this page, update the deal, and schedule the launch email"* — in one session, not just edit code. It also scaffolds **`/hiveku-*` slash commands** (status / commit / pull / verify / deploy / preview) and a permission allowlist so Claude moves fast with fewer prompts.

**Code & VCS (Supabase-native, no GitHub):**
- Download / pull, native **Source Control**: commit, branch, switch, **merge** (line-level 3-way), compare, **history**, **conflict detection** ("you're behind"), per-file **History** (diff + restore), deploy, and Fly **preview** (open / sync / logs / screenshot).
- **Project Panel** — deploys, checkpoints, database, pages, CMS, crons, domains, redirects, secrets, analytics, Supabase (auth/storage/edge functions/migrations).
- **Site env** — **Pull Env to `.env.local`** (real secret values, gitignored, `_DEV`/`_PROD` resolved like the Fly preview) and **Push `.env.local` to Hiveku**; or add / update / delete individual secrets from the Project Secrets picker.

**Always on:**
- **Notifications** — the Hiveku icon badges overdue tasks + failed runs across all accounts; **What Needs Attention** lists them.

## A few key commands (Cmd/Ctrl+Shift+P → "Hiveku:")
`Connect Hiveku` · `Download Project…` · `Operate Account…` · `Agency Dashboard` ·
`Open Account Console` · `Open Account as Workspace` · `What Needs Attention`

## Develop
```bash
npm install && npm run compile   # or: npm run watch
# F5 to launch an Extension Development Host
```
See `MAINTAINERS.md` for architecture and `AUDIT.md` for the full capability map
and roadmap.
