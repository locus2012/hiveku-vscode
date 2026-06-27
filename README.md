# Hiveku for VS Code

Work on your Hiveku site projects locally — with a real folder, native VS Code
Source Control, and AI coding agents (Claude Code) editing files directly — then
commit and deploy back to Hiveku. Commits and branches live entirely in Hiveku
(Supabase-backed); **no GitHub required**.

## What it does (Phase 1)

- **Connect one or more accounts.** Paste a Hiveku MCP key (Settings → LLM
  Connectors). Each key is one account; add several to switch between them. Keys
  are stored in the OS keychain via VS Code SecretStorage — never in plaintext.
- **Download a project.** `Hiveku: Download Project…` pulls the entire codebase
  as one tarball into a local folder and writes a small `.hiveku/project.json`
  link file. The project's `main` branch is initialized on Hiveku automatically.
- **Edit locally.** Use VS Code, the terminal, ripgrep, your build/test tools,
  and Claude Code — it's just a normal folder now.
- **Commit back.** The Source Control panel shows what changed vs Hiveku's
  current state. Enter a message and commit — files are saved back and a Hiveku
  commit is recorded (a checkpoint snapshot is the revert point).
- **History / Revert.** Browse commits; revert the project to any commit's
  snapshot.
- **Deploy.** `Hiveku: Deploy…` → development / staging / production.

## How it works

The extension talks to the Hiveku MCP server (`core.hiveku.com/mcp`) using your
account key. Downloads use `project_files_snapshot`; the diff uses
`project_files_status`; commits use `project_vcs_commit` (Supabase-backed VCS);
deploys use `deploy_site`. Nothing here touches GitHub.

## Adaptive + non-destructive

Opening a project initializes its `main` branch lazily — projects you never open
are completely untouched, and the web builder keeps working exactly as before.
The only write-back into your live project is an explicit commit, which is
versioned and revertable.

## Develop

```bash
npm install
npm run compile      # or: npm run watch
# Press F5 in VS Code to launch an Extension Development Host.
```
