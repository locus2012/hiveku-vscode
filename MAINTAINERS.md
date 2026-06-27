# Hiveku VS Code Extension + Supabase-native VCS — How it works & how to ship updates

This document explains the whole system behind the **Hiveku** VS Code extension
(`hiveku.hiveku-vscode` on the Marketplace) and how to maintain/publish it.

- Marketplace: https://marketplace.visualstudio.com/items?itemName=hiveku.hiveku-vscode
- Manage hub: https://marketplace.visualstudio.com/manage/publishers/hiveku/extensions/hiveku-vscode/hub

---

## 1. What it is

A VS Code extension that lets a developer (or a coding agent like Claude Code)
work on a Hiveku site project **locally**: full download into a real folder,
native Source Control panel, commit/branch/merge back into Hiveku, deploy, and
Fly branch previews. **Commits and branches live entirely in Hiveku (Supabase +
S3) — there is no GitHub anywhere in the flow.**

It serves two personas off the same project:
- **Web users** keep editing in the Hiveku web builder, untouched.
- **Developers** clone locally and use git-like commit/branch/merge via the extension.

---

## 2. Architecture & data flow

```
VS Code extension (this repo)
        │  MCP JSON-RPC over HTTPS, Bearer = customer MCP key
        ▼
Hiveku MCP server  (hiveku-mcp-api-server)        core.hiveku.com/mcp
        │  validates key -> resolves ONE account -> proxies with service key + X-Account-Id
        ▼
Hiveku builder (hiveku_builder)  Olympus routes:  /api/olympus/builder/projects/[id]/vcs/*
        │
        ├─ Supabase Postgres   builder_code_versions (main state) + project_commits + branch_refs
        ├─ S3 (hiveku-backups) branch trees + checkpoint snapshots
        └─ Fly.io              branch preview machines
```

Key points:
- The extension **never** talks to the Olympus routes directly and never sees the
  service key. It calls MCP tools; the MCP server does the privileged proxying.
- Auth = the customer's **MCP API key** (Settings -> LLM Connectors in the Hiveku
  dashboard). One key = one account. "Multiple accounts" = multiple keys. Keys are
  stored in VS Code **SecretStorage** (OS keychain), never in plaintext.

---

## 3. The Supabase-native VCS model

- **`main` is not a copy.** It mirrors a project's live `builder_code_versions`
  (`is_current`) files — exactly what the web builder edits. A commit on `main`
  saves the changed files via the normal versioned path, snapshots a checkpoint
  (the commit's content), and advances the `main` ref.
- **Branches live off to the side.** A branch's content is stored as a gzipped
  **S3 "tree"** (`{ files: { path: { content, encoding, hash } } }`), NOT in
  `builder_code_versions`. So `main` and the web builder are never disturbed by
  branch work. Branch content is materialized into a Fly preview on demand, and
  into `builder_code_versions` only at **merge**.
- **Merge is a real line-level 3-way merge** (diff3). Edits to different parts of
  a file auto-merge; only truly overlapping line regions conflict. Conflicts are
  returned as marked-up text (`<<<<<<< / ======= / >>>>>>>`) for the user to
  resolve — they are NOT written into the live site (that would break the build).
- **Lazy bootstrap / adaptive rollout.** The first time a project is used, its
  `main` branch ref + initial commit are created automatically. Projects never
  touched by the extension have zero VCS rows and behave exactly as before.
- **Safety.** The only write-back into live files is an explicit commit/merge,
  which goes through the existing versioned, auto-checkpointed, revertable path.

---

## 4. Code map (where everything lives)

### Extension (this repo, `hiveku-vscode/`)
| File | Responsibility |
|------|----------------|
| `src/extension.ts` | Activation, commands, SCM lifecycle, status bar |
| `src/scm.ts` | `HivekuScm` Source Control provider (branch-aware diff, commit, switch) |
| `src/hivekuApi.ts` | Thin wrappers over each MCP tool |
| `src/mcpClient.ts` | Minimal MCP JSON-RPC client (Bearer key) |
| `src/accounts.ts` | Multi-account credential store (SecretStorage) |
| `src/workspace.ts` | File walking, hashing, tree materialization, `.hiveku/project.json` |
| `src/download.ts` | Tarball download + extract |

A downloaded project carries a `.hiveku/project.json` linking the folder to a
Hiveku project + account + active branch.

### Backend VCS lib (`hiveku_builder/src/lib/vcs/`)
| File | Responsibility |
|------|----------------|
| `index.ts` | `ensureMainBranch`, `commit`/`commitOnMain`/`commitOnBranch`, `createBranch`, `getBranchTree`, `mergeBranchToMain`, `listHistory`, `listBranches`, `compareBranches`, `pruneBranchTrees` |
| `trees.ts` | S3 tree store: `putTree`/`getTree`/`readMainTree`/`applyOverlay`/`listTreeKeys`/`deleteTreeObjects` |
| `merge3.ts` | Pure diff3 line-level 3-way merge (unit-tested) |
| `branch-preview.ts` | Fly branch preview (materializes a branch tree into a machine) |

### Olympus routes (`hiveku_builder/src/app/api/olympus/builder/projects/[projectId]/vcs/`)
`commit`, `history`, `branches` (GET list / POST create), `checkout`, `merge`,
`preview`, `compare`, `prune`.

### MCP tools (`hiveku-mcp-api-server/src/tools/olympus-tools.ts`)
`project_vcs_commit` (optional `branch`), `project_vcs_history`,
`project_vcs_branches`, `project_vcs_branch_create`, `project_vcs_checkout`,
`project_vcs_merge`, `project_vcs_branch_preview`, `project_vcs_compare`,
`project_vcs_prune`.

### Schema (`hiveku_builder/prisma/schema.prisma`)
Two additive, self-contained tables: `project_commits` and `branch_refs`
(no relations to existing tables — `prisma db push` only creates these two).

---

## 5. Local development

```bash
cd hiveku-vscode
npm install
npm run compile      # one-off build  (or: npm run watch)
```

To run/debug: open the `hiveku-vscode` folder in VS Code and press **F5** — this
opens an "Extension Development Host" window with the extension loaded. With
`npm run watch` running, edits recompile automatically; reload the host window to
pick them up.

Commands appear in the Command Palette under `Hiveku:` (Sign In, Download
Project, Commit, Create/Switch Branch, Merge, Preview Branch, Compare, History,
Revert, Deploy, Pull, Prune).

---

## 6. IMPORTANT: backend must be deployed for VCS features to work

The extension installs and signs in against `core.hiveku.com/mcp` immediately,
but **commit/branch/merge/preview/compare/prune call the new `project_vcs_*`
tools**, which only exist once the backend is shipped:

1. In `hiveku_builder`: run `prisma db push` (creates `project_commits` +
   `branch_refs`). Confirm the preview only creates those two tables.
2. Deploy `hiveku_builder` (the `vcs/*` routes) and `hiveku-mcp-api-server`
   (the `project_vcs_*` tools).

Until then, Sign In + Download work, but VCS actions return "tool not found".

The Fly branch-preview push (`branch-preview.ts` `syncTreeToMachine`) is marked as
a LIVE-VALIDATION SEAM — verify it against real Fly on first run.

---

## 7. How to ship an update (the part you'll do most)

### Prerequisites (one-time)
- Publisher **`hiveku`** already exists on the Marketplace (ID must equal
  `"publisher"` in `package.json`).
- A Personal Access Token (PAT) from Azure DevOps:
  - https://dev.azure.com -> avatar -> **User settings -> Personal access tokens -> New Token**
  - **Organization: All accessible organizations** (required)
  - **Scopes: Show all scopes -> Marketplace -> Manage**
  - Copy the token (shown once). PATs expire (max 1 year) — when it lapses,
    publishing 401s; just mint a new one.

### Publish a new version
```bash
cd hiveku-vscode

# first time on a new machine / after PAT rotation:
npx @vscode/vsce login hiveku        # paste the PAT

# bump version + build + publish in one step:
npx @vscode/vsce publish patch       # 0.1.0 -> 0.1.1  (also: minor / major)
```

Or, to publish an exact prebuilt package without bumping:
```bash
npx @vscode/vsce package -o hiveku-vscode-<version>.vsix
npx @vscode/vsce publish --packagePath hiveku-vscode-<version>.vsix
```

The listing updates within a few minutes (an automated scan runs in the
background). There is no manual review queue.

> Tip: ALWAYS run these from inside the `hiveku-vscode/` folder. Running from the
> repo root fails with "Extension manifest not found" / "no such file" because the
> `package.json` and `.vsix` live in the subfolder.

> Do NOT use the Marketplace website's "Upload" button — it throws a cryptic
> `Value cannot be null. Parameter name: v1` error for many extensions. The
> `vsce publish` CLI is the supported path and gives real error messages.

### Optional: Open VSX (for Cursor / VSCodium users)
The Microsoft Marketplace doesn't serve those editors. To reach them:
```bash
# one-time: create a namespace + token at https://open-vsx.org
npx ovsx publish hiveku-vscode-<version>.vsix -p <openvsx-token>
```

---

## 8. Branding / the icon

`icon.png` (256x256) is referenced by `"icon"` in `package.json`. It was drawn
programmatically; the generator script lives outside the repo. To change colors
or art, regenerate a 256x256 PNG, overwrite `icon.png`, and `vsce publish patch`.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|--------|-------------|
| Website upload: `Value cannot be null. Parameter name: v1` | Web uploader bug — use `vsce publish` CLI instead. |
| `Extension manifest not found` / `ENOENT ...vsix` | You're in the wrong directory — `cd hiveku-vscode` first. |
| `401`/`403` on publish | PAT scope must be **Marketplace: Manage** AND **All accessible organizations**. Re-mint, `vsce login` again. |
| `publisher does not exist` / mismatch | `"publisher"` in `package.json` must equal the publisher **ID** (`hiveku`). |
| Marketplace "Repository" link 404s | `repository.url` in `package.json` points at a repo that doesn't exist — see below. |
| Extension installs but commit/branch fails | Backend not deployed — see section 6. |

### The Repository 404
`package.json` currently sets `repository.url` to
`https://github.com/locus2012/hiveku-vscode.git`, which does not exist, so the
Marketplace shows a broken link. Fix by EITHER:
- creating that GitHub repo and pushing this folder to it, OR
- editing `repository.url` (and `bugs.url`) to the real location, OR
- removing the `repository` + `bugs` fields entirely (vsce just prints a harmless
  warning).

Then `npx @vscode/vsce publish patch` to update the live listing.

---

## 10. MCP tool reference (what the extension calls)

| Tool | Purpose |
|------|---------|
| `project_files_snapshot` | Full download (tarball) — also used by `hiveku-sync` |
| `project_files_status` | Server-side diff (main) |
| `project_vcs_branches` | List branches (lazily bootstraps `main`) |
| `project_vcs_branch_create` | Create a branch off `from` (default main) |
| `project_vcs_checkout` | Get a branch's full tree (switch branches) |
| `project_vcs_commit` | Commit to `main` or a `branch` |
| `project_vcs_history` | Commit history |
| `project_vcs_merge` | 3-way merge a branch into main (conflict-flagging) |
| `project_vcs_branch_preview` | Fly preview of a branch at its own URL |
| `project_vcs_compare` | File-level diff between two branches |
| `project_vcs_prune` | Reclaim orphaned branch-tree storage (dry-run default) |
| `deploy_site` | Deploy main to development/staging/production |
| `project_checkpoint_restore` | Revert (used by the extension's Revert) |
