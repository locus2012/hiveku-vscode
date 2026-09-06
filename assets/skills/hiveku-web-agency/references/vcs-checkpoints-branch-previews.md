# VCS, Checkpoints, Branch Previews, and Restore

The full mechanism behind Play 6, plus the GitHub source-of-truth axis from Play 7.
Load this before branch previews, merges, checkpoint work, ANY restore (checkpoint,
point-in-time, or single-file), or touching the GitHub connection.

## Branching: the working-branch model

Two invariants first. (1) **Bindings decide which tree a tier ships**, never the deploy call.
(2) **Production is `main`, and branch work reaches it only through a PR merge.**

- Working tree vs commits. Every branch, `main` included, has a WORKING TREE (the current
  files) and a commit history. `main`'s working tree IS the live project
  (`builder_code_versions`); a branch's working tree lives off to the side in S3 and never
  enters the live project until it is merged. A branch's working tree may run AHEAD of its
  last commit - that is `uncommitted: true` on `project_vcs_branches`.
- There is no switch. `project_vcs_checkout({ project_id, branch })` is a READ: it returns the
  branch's full tree (`{ files: [{path, content, encoding}] }` plus `head_commit_id`,
  `working_tree_etag`, `uncommitted`) so you can materialize it locally, and it changes
  nothing server-side - not the editor, not any tier, and no tool does. The working branch is
  the `branch` parameter you pass on every file tool: `project_files_bulk_get` /
  `project_file_get` read a branch's working tree; `project_file_save` /
  `project_files_bulk_save` / `project_file_delete` write it; `project_files_status({
  target: "branch:<name>" })` diffs a local copy against it (basis `branch`, confidence
  `exact`); `project_test_build({ use_db_state: true, branch })` builds it; `preview_screenshot`
  / `preview_http_get` with `branch` look at its branch preview; `project_vcs_history({ branch })`
  lists its commits. Omit `branch` (or pass `"main"`) and each of those is the live project,
  byte-identical to before. A write with `branch` never touches `main`.
- Branch for real work: `project_vcs_branch_create({ project_id, name, from? })` (`feature/`,
  `fix/`, `task-<id>/`; short names - preview machines cap them). Branching off a branch with
  uncommitted edits promotes them first. `project_vcs_branches` lists every branch with
  `ahead` / `behind` (null on `main` and on a branch with no base: "does not apply", not "in
  sync"), `uncommitted`, and `working_tree_etag`.
- Promote. Writes with `branch` update the working tree only (`uncommitted: true`,
  `working_tree_etag`, `checkpoint_hash: null` with a `note`). `project_vcs_commit({
  project_id, branch, message })` with NO `files` / `deletedFiles` PROMOTES the working tree
  into a commit - no bytes re-uploaded, the tree pointer becomes the commit, `data.promoted`
  true. With `files` it saves and commits in one call (omit `branch` and it commits to
  `main`, which changes the live project). 409 `nothing_to_commit` = the branch is clean, not
  a retry; 409 `branch_changed` = the head moved mid-call, re-read `project_vcs_branches` and
  retry; 409 `branch_busy` = another writer holds the lock, retry shortly. Envelope `{ data:
  <commit>, preview_effect }`. Promotion also happens server-side, without you: a deploy of a
  bound tier promotes the branch's unsaved edits before pinning (`deploy_site` says so in its
  response `note`), a merge promotes its source, a delete promotes first ("Snapshot before delete").
- The etag is the concurrency rail. You are not the only writer on a branch either.
  `project_files_bulk_get({ branch })` returns `basis: { kind: "branch", working_tree_etag }`
  - RECORD it at pull; before a push, COMPARE it with the branch's row in
  `project_vcs_branches`: a changed etag means someone saved or committed on the branch since
  your pull, so re-pull and reconcile instead of overwriting. Per file, `project_file_save({
  branch, expected_hash })` refuses with 409 `content_conflict` ({ path, expected, actual })
  when the stored content moved (on `main` too). `project_version_log` and the chat-history
  tools are `main` signals; on a branch the etag and `project_files_status` are the truth.
- Diff one file: `project_vcs_diff_file({ project_id, from, to, path })` (both sides of ONE
  file; `from` defaults to `main`; `to` and `path` required) returns `{ data: { from, to,
  path, status, base, head } }` - `base` is the file on `from`, `head` on `to`, null where the
  path does not exist, `status` `added` / `removed` / `modified` / `same`, sides over 1 MB
  come back `tooLarge`. `project_vcs_compare({ from, to })` lists the paths and statuses
  first; both include uncommitted working-tree edits.
- Revert a branch: `project_vcs_revert({ project_id, branch, commit_id,
  expected_head_commit_id, message? })` writes a NEW commit (kind `revert`) whose tree is the
  target commit's and moves the head there - linear history, nothing deleted, and the
  branch's uncommitted edits are DISCARDED as part of the move. `commit_id` must be on this
  branch (400 `not_revertable`); `main` is refused (400 `main_not_allowed` - `main` rolls back
  through `project_checkpoint_restore` with a commit's `checkpoint_hash`); always pass
  `expected_head_commit_id` so a concurrent save answers 409 `branch_changed` instead of
  being thrown away. A live branch preview is not resynced - restart it.
- Tools without a `branch` parameter are `main`-only and REFUSE `branch` rather than silently
  writing `main` (`branch_unsupported_for_tool`): the tarball import lane,
  `project_file_move`, `project_file_restore`, `project_files_bulk_delete`,
  `project_folder_delete`, `project_checkpoint_restore`, `project_file_save_async`. Express a
  move on a branch as a save plus `project_file_delete({ branch })`.
- Merge back with `project_vcs_merge({ project_id, branch, into?, message? })` once the
  branch builds and is reviewed. `into` defaults to `main` and may be ANY branch - merging
  into main is what changes the live project; merging into another branch just updates it.
  It applies the non-conflicting changes and returns `{ merged_into, applied, deleted,
  conflicts, commit }`. Files changed on BOTH sides are returned in `conflicts` and are NOT
  overwritten - resolve them yourself and merge again. The branch is not deleted, so a
  partial merge is recoverable. A `main` merge commit carries a `checkpoint_hash`, so the
  whole branch's work can be undone in one restore. Reviewed work takes the PR lane below.
- Delete a finished branch with `project_vcs_branch_delete({ project_id, branch, confirm:
  true })` - `confirm` is a query parameter and required (400 `confirm_required`). Refused for
  `main` (400), while bound to an environment (409 - clear the binding first), with an open
  PR (409 - merge or close it first), and for stash branches `pending/*` / `stash/*` (409;
  `force: true` only when the user explicitly discards scooped work). Destructive: a later
  `project_vcs_prune` (storage GC, `dry_run` default true) destroys the orphaned tree bytes.

## Shared across branches: the database, assets and CMS

- A branch versions FILES. One physical database per project (the DB tools' `branch` is a
  TIER, not a VCS branch), one secret set, one media library, one CMS. A branch preview runs
  the branch's code against that shared data. CMS writes land on `main` with no branch
  awareness: an entry edited while a tier serves a branch will not appear on that tier, and
  a scheduled publish is HELD while the tier is bound. Per-branch databases are a follow-up.

## Native pull requests (reviewable, atomic merges)

- `project_vcs_pr_create({ project_id, source_branch, title, target_branch?, description? })`
  records merge INTENT (target defaults to `main`). `project_vcs_pr_list` (read
  `source_branch_recreated`: `true` = the name was deleted and reused after the PR, `null` =
  not checked, never an assurance) and `project_vcs_pr_get` (`{ data: { pr, diff, diff_error }
  }` - the path-level diff is live on every read; a non-null `diff_error` is not "no
  changes") review it; read each changed path with `project_vcs_diff_file({ from:
  <target_branch>, to: <source_branch>, path })`. `project_vcs_pr_merge({ project_id, number,
  message? })` merges STRICT and atomic - if ANY file conflicts NOTHING is merged, the PR
  stays open, and the call answers 409 `merge_conflicts` with the list at
  `details.conflicts` (also `details.conflict_details` / `details.conflict_count`, and still
  under `details.data.conflicts` for older callers - look in both before reporting a
  conflict-free failure). Success is `{ data: { pr, merge, relabel_failed? } }`;
  `relabel_failed` means the merge is real but the PR label could not be updated - do not
  retry. Uncommitted edits on the source are promoted server-side as part of the merge. The
  source branch is NOT deleted. `project_vcs_pr_close` / `project_vcs_pr_reopen` manage the
  queue; merged is terminal. These are Hiveku-native (project_pull_requests) - the
  `github_pr_*` family is the separate GitHub surface and 400s without a connected repo.

## Environment branches (development/staging serve a branch)

- `main` IS production, permanently - production can never be rebound. development and
  staging can each SERVE a branch: `project_vcs_env_bindings({ project_id })` reads the
  bindings; `project_vcs_env_bind({ project_id, environment, branch })` sets one (`branch`
  is required; `"main"` or `""` clears it back to tracking main; `production` answers 400
  `production_immutable`). RELAY the response `warning` verbatim when present - it is the CMS
  trap above. Binding does NOT deploy - the tier's next deploy ships the branch's PINNED tree,
  promoting unsaved edits first. On `deploy_site`, `branch` is an ASSERTION, not a selector:
  a mismatch is refused - 409 `branch_not_bound` (dev/staging bound elsewhere or unbound), 400
  `production_immutable` (non-main on production), 409 `binding_source_conflict` (a bound
  tier refuses a GitHub-source deploy). Omit it to ship whatever the binding says. A delete is
  refused while a binding points at the branch. Do not confuse with `project_env_matrix`
  (environment VARIABLES) or the GitHub branch-deployments mapping.

## Stash: scoop pending work onto a branch

- `project_vcs_stash({ project_id, environment })` DRY-RUNS by default: it reports what
  differs from what is PROVABLY live on that environment ({ status, fileCount, modified,
  ... }) with zero writes. With `dry_run: false` it moves that pending work to a new branch
  and resets the environment's source to exactly what is live (production: aligns `main`;
  a bound dev/staging tier: resets its branch to the deployed pin). Nothing is deleted -
  merge the branch back later (production stash -> into main; branch stash -> into ITS
  bound branch, never main). It refuses when what-is-live cannot be proven; an unbound
  tier answers 409 tier_tracks_main (its pending work IS main's - stash production).

## Branch previews (show the client before it merges)

- Show the client the branch BEFORE it merges, without touching the shared main preview:
  `project_vcs_branch_preview({ project_id, branch })` spins the branch's WORKING TREE
  (uncommitted edits included) up at its own URL in its own isolated app (the project's main
  preview is untouched and the branch tree never enters the project's files). It returns
  `{ previewUrl, status, previewSessionId }`. On `status: 'starting'` do NOT call it again -
  that spawns a second app; poll `project_vcs_branch_preview_status({ project_id, session_id })`
  instead, usually another 30-90s. While it runs, `project_files_bulk_save({ branch })` syncs
  it (`preview_effect` says so); `preview_screenshot({ branch })` and `preview_http_get({
  branch })` target the session (`port` ignored) and answer 409 `branch_preview_not_running`
  when none is live - start one, poll to ready, retry. It serves the branch's code against the
  project's SHARED database, secrets and assets. Send `previewUrl` for sign-off, then merge,
  then `project_vcs_branch_preview_teardown({ project_id, session_id })` (irreversible - start
  a fresh preview to look again; they are also reaped automatically). Without `branch` the
  `preview_*` tools are the MAIN container and never show branch edits.

## Checkpoints

- Snapshot BEFORE risky work: `checkpoint_create({ project_id, description })` captures
  every current file, every asset, and (when configured) a DB backup, and returns a
  `checkpoint_hash` - record it in your reply. Take one before any bulk refactor,
  `delete_missing` tree replace, dependency bump, or DB migration - and immediately before
  any `production` deploy, so the rollback plan points at a checkpoint minutes old.
  `project_files_bulk_save({ delete_missing: true })` already takes one automatically and
  aborts with `code: 'checkpoint_failed'` before touching anything if it cannot. Clean up
  with `checkpoint_delete`.
- Note the two prefixes: the create/delete half is `checkpoint_create` / `checkpoint_delete`
  (bare prefix). There is no `project_checkpoint_create` - do not guess it. The bare
  `checkpoint_*` half is invisible to a `dev`-scoped MCP key (only the `project_checkpoint_*`
  half matches its prefixes); plugin sessions run the full profile and see both.
- Checkpoints are the safety net for restores: `project_checkpoint_list` (or
  `checkpoint_list`, which also carries trigger/size metadata) to find a known good point,
  `project_checkpoint_get` to inspect it, and `project_checkpoint_restore_dry_run` BEFORE
  `project_checkpoint_restore` - always dry-run a restore first so you see exactly what it
  will change. Restore is ADDITIVE: it overwrites current files from the snapshot but never
  removes a file that exists now and was not in the checkpoint. Never re-run a restore as
  verification; verify by reading files and building.

## Point-in-time restore (a regression with no nearby checkpoint)

The `history_*` / `project_state_at` rail restores to an ARBITRARY timestamp, not just to a
snapshot somebody remembered to take. (`history_*` is invisible to a `dev`-scoped key;
`project_state_at` is visible everywhere `project_` is.)

- `project_state_at` reconstructs the project's state at a timestamp WITHOUT touching
  anything - a read-only dry run of the point-in-time machinery. It returns the file list
  (paths, sizes, version ids), the asset list with resolved S3 versions, and the set of
  paths that were tombstoned by that time. Use it to preview what "restore to time X" would
  produce, to extract a single file as of time X (`include_content: true`, pick the path),
  or to inspect drift between now and then. Cheaper than `project_checkpoint_list` when you
  already know the timestamp you care about.
- `history_restore_to_time` restores the project to its state at that timestamp. Unlike
  `project_checkpoint_restore` it works even when no snapshot exists at the target time -
  it reconstructs from per-row created_at trails and the matching S3 object versions. Same
  ADDITIVE semantics as the checkpoint restore: files that exist now but did not exist at
  the target time are NOT removed. For a strict point-in-time recreation, follow with
  `project_files_bulk_save` + `delete_missing: true` using the snapshot from
  `project_state_at` - and that delete_missing pass takes its own checkpoint, keep it.
- Dry-run doctrine applies here exactly as it does to checkpoints: `project_state_at` (or a
  preview session, below) BEFORE `history_restore_to_time`, never straight to the write.

## Preview a restore before committing it

- `history_preview_restore` spawns an ISOLATED ephemeral preview app for a checkpoint or a
  point-in-time snapshot - the canonical project container is never touched, so a broken
  snapshot cannot break the working dev environment. Returns
  `{ preview_session_id, preview_url }` to hand the user. Spawn takes 30-90s (snapshot
  upload + app create + machine boot + health poll); on a health-check failure the route
  auto-destroys the half-spawned app and returns 504 with `code: 'preview_unhealthy'`.
- Committing the previewed state is a SEPARATE call - `history_restore_to_time` or
  `project_checkpoint_restore` - and does not require tearing the preview down first.
- `history_cancel_preview_restore({ preview_session_id })` destroys the isolated app.
  Idempotent - an already-torn-down session returns `ok: true` + `already_torn_down: true`.
  Cleanup is best-effort: per-step failures are reported in the response's `errors` field
  and an orphan-sweeper cron retries partial teardowns after 1h.
- `history_list_preview_sessions` lists sessions (active by default;
  `include_finished: 'true'` for history) - use it to find a `preview_session_id` before
  teardown, audit abandoned sessions, or hand a still-running `preview_url` back mid-conversation.

## Single-file history and rollback

One bad file does not need a whole-tree restore:
- `project_file_versions` lists a single file's version history - version_number,
  is_current, size, commit message, branch, created_at - newest first, no content. Read it
  first so you know which version_number to roll back to.
- `project_file_diff` diffs two versions (defaults: previous vs current; pass `from` / `to`
  as version_number ints). `format: 'unified'` returns a unified-diff string,
  `format: 'json'` returns hunks; binary files are flagged `binary: true` and not diffed.
- `project_file_restore` restores one file to an earlier version by writing the prior
  content as a NEW version - history stays linear, no destructive rewrites. Pass
  `commit: true` to also push the restored content to GitHub (recommended on a
  GitHub-connected project so the rollback shows in commit history with a clear message).

## Source of truth: the GitHub axis (from Play 7)

Source of truth (GitHub or not) is a separate axis from the deploy tier.
`project_deployment_mode_get` returns `{ mode: 'github_sync' | 'local_codebase' }`.
`local_codebase` means saves go straight to `builder_code_versions` with no GitHub
roundtrip - the normal Hiveku-native case. `github_sync` means the repo is the source of
truth and commits replicate in, so a `project_file_save` without a `project_commit` gets
overwritten by the next sync. `project_deployment_mode_set` FLIPS that plumbing and needs
an explicit confirm; enabling `github_sync` requires an already-connected repo or it
returns 412 `github_not_connected`. Never call it to "pick a tier".

Inspecting and configuring the connection the mode depends on:
- `github_status` - is the app installed, which repo, the default branch, the last synced
  SHA. Run it before diagnosing any sync surprise or offering `github_sync`.
- `project_github_configure` - updates per-tier auto-deploy toggles and the branch mapped
  to each tier (only the fields you pass change). It CANNOT install the Hiveku GitHub App,
  connect a different repo, or disconnect GitHub - those are human dashboard actions
  (`/settings/github`). Pair with `project_deploy_preflight` to verify the new
  configuration before relying on it.
- `github_commits` - recent commits on a branch (default: the project's default branch),
  for confirming what actually replicated in.
