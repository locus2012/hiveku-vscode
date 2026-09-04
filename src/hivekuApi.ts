/**
 * High-level Hiveku operations, each a thin wrapper over one MCP tool. Keeping
 * the tool names + response-shape quirks in one place means the rest of the
 * extension deals in plain typed objects.
 */

import { HivekuMcpClient } from './mcpClient';
import type { CommitFile, ManifestEntry } from './workspace';

export interface ProjectSummary {
  id: string;
  name: string;
  slug?: string;
  project_type?: string;
}

export interface StatusResult {
  changed: Array<{ path: string }>;
  only_local: Array<{ path: string }>;
  only_remote: Array<{ path: string }>;
  same_count: number;
}

export interface CommitSummary {
  id: string;
  branch_name: string;
  message: string;
  checkpoint_hash: string | null;
  files_committed: number;
  files_deleted: number;
  created_at: string;
  /** True when a branch commit with NO files promoted the branch's working
   *  tree (edits made through the branch-aware file tools) into this commit. */
  promoted?: boolean;
  /** 'commit' | 'merge' | 'revert' on newer servers. */
  kind?: string;
  revertable?: boolean;
}

export interface BranchRef {
  branch_name: string;
  head_commit_id: string | null;
  is_default: boolean;
  ahead?: number | null;
  behind?: number | null;
  /** The branch's WORKING TREE has edits not yet promoted into a commit. */
  uncommitted?: boolean;
  /** Short fingerprint of the working tree; null when unknown. Record it at
   *  pull, compare it before push: a change means someone else saved here. */
  working_tree_etag?: string | null;
}

export interface CheckoutTree {
  branch_name: string;
  files: Array<{ path: string; content: string; encoding: 'utf-8' | 'base64' }>;
  head_commit_id?: string | null;
  working_tree_etag?: string | null;
  uncommitted?: boolean;
}

export interface MergeResult {
  merged_branch: string;
  /** The branch the merge landed ON (`main` unless `into` was passed). */
  merged_into: string;
  applied: string[];
  auto_merged: string[];
  deleted: string[];
  conflicts: string[];
  conflict_details: Record<string, string>;
  commit: CommitSummary | null;
}

export interface CompareEntry {
  path: string;
  status: 'added' | 'removed' | 'modified';
}

export interface CompareResult {
  from: string;
  to: string;
  added: number;
  removed: number;
  modified: number;
  entries: CompareEntry[];
}

export interface PruneResult {
  scanned: number;
  referenced: number;
  orphaned: string[];
  deleted: number;
  dry_run: boolean;
}

export interface BranchPreviewResult {
  previewUrl: string | null;
  machineId: string | null;
  status: string;
  filesSynced: number;
  filesFailed: number;
  /** Handle for project_vcs_branch_preview_status / _teardown. Keep it: calling
   *  project_vcs_branch_preview again while one is starting spawns a second app. */
  previewSessionId?: string | null;
  error?: string;
}

export interface BranchPreviewStatus {
  status: string;
  ready: boolean;
  previewUrl: string | null;
  branch?: string;
}

function unwrap<T>(payload: unknown): T {
  // Most Olympus tools wrap their result in { data: ... }.
  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

/** `{ branch }` for a non-main branch, `{}` for main/empty. Every branch-aware
 *  tool treats an omitted branch as main, so main is never sent explicitly and
 *  the wire bytes for main callers stay byte-identical to before. */
export function branchArg(branch?: string | null): { branch?: string } {
  const b = (branch ?? '').trim();
  return b && b !== 'main' ? { branch: b } : {};
}

/**
 * `promoted` from a project_vcs_commit response. The route puts it on the
 * commit inside `data`; older servers omit it, and a future envelope could hoist
 * it beside `data` (unwrap would then drop it). Read both, never fabricate: an
 * absent flag is false, not "unknown".
 */
export function readPromoted(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const root = raw as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : undefined;
  return data?.promoted === true || root.promoted === true;
}

/** A sibling of `data` (e.g. `preview_effect`, `working_tree_etag`) that
 *  unwrap() drops; checked inside `data` first, then at the root. */
export function readSibling<T>(raw: unknown, key: string): T | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const root = raw as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : undefined;
  if (data && key in data) return data[key] as T;
  if (key in root) return root[key] as T;
  return undefined;
}

/** PM (project-management) projects — tasks/owners, NOT buildable sites. */
export async function listProjects(client: HivekuMcpClient): Promise<ProjectSummary[]> {
  const res = await client.callToolJson<unknown>('list_projects', {});
  const list = unwrap<ProjectSummary[]>(res);
  return Array.isArray(list) ? list : [];
}

/** A buildable website project from sites_list — id is the WEBSITE project id
 *  (what snapshots/commits/deploys expect), with env URLs resolved server-side. */
export interface SiteSummary extends ProjectSummary {
  subdomain?: string;
  custom_domain?: string | null;
  live_preview?: { url?: string; container_status?: string };
  environments?: {
    development?: { url?: string | null };
    staging?: { enabled?: boolean; url?: string | null };
    production?: { url?: string | null; status?: string | null };
  };
}

/**
 * The account's WEBSITE projects (code you can download/commit/deploy) — this,
 * not list_projects (PM records), must feed every code-project surface. One
 * call also carries the Fly preview URL + container status and all deployed
 * environment URLs, so no per-project fan-out is needed.
 */
export async function sitesList(client: HivekuMcpClient): Promise<SiteSummary[]> {
  const res = await client.callToolJson<unknown>('sites_list', { limit: 100 });
  const list = unwrap<SiteSummary[]>(res);
  return Array.isArray(list) ? list : [];
}

/** Environment link descriptors straight from a sites_list row (no extra calls). */
export function envDescriptorsFromSite(site: SiteSummary): EnvDescriptor[] {
  const envs: EnvDescriptor[] = [
    {
      env: 'preview',
      label: 'Live Preview',
      url: site.live_preview?.url || flyPreviewUrl(site.id),
      status: site.live_preview?.container_status || undefined,
    },
    {
      env: 'development',
      label: 'Development',
      url: site.environments?.development?.url || undefined,
      status: site.environments?.development?.url ? undefined : 'not deployed',
    },
  ];
  if (site.environments?.staging?.enabled) {
    envs.push({
      env: 'staging',
      label: 'Staging',
      url: site.environments.staging.url || undefined,
      status: site.environments.staging.url ? undefined : 'not deployed',
    });
  }
  envs.push({
    env: 'production',
    label: 'Production',
    url: site.environments?.production?.url || (site.custom_domain ? `https://${site.custom_domain}` : undefined),
    status: site.environments?.production?.status || (site.environments?.production?.url ? undefined : 'not deployed'),
  });
  return envs;
}

export interface SnapshotResult {
  download_url: string;
  file_count: number;
  compression: 'gzip' | 'none';
}

interface JobStatus {
  status: string;
  terminal?: boolean;
  progress?: number;
  progress_message?: string;
  result?: unknown;
  error?: string;
}

/**
 * Returns a short-lived signed URL for the project's tarball.
 *
 * Runs as a BACKGROUND JOB and long-polls for the result, rather than holding
 * one request open. The synchronous tool cannot serve a large project at all:
 * Cloudflare closes the connection at 120 seconds regardless of what the server
 * allows or what timeout this client uses, surfacing as an edge HTTP 524. A
 * project with hundreds of MB of inline binaries is well past that line, so no
 * timeout value makes the sync path work — the build has to outlive the request.
 *
 * job_status_get long-polls server-side (wait_seconds), so this is one call per
 * ~20s of build time, not a sleep-and-poll loop.
 */
export async function snapshotUrl(
  client: HivekuMcpClient,
  projectId: string,
  includeAssets: boolean,
  onProgress?: (note: string) => void,
): Promise<SnapshotResult> {
  // Idempotency key, bucketed by time.
  //
  // Jobs run as a fire-and-forget Promise INSIDE the builder's web process —
  // "async" moves the HTTP response off the critical path, it does not move the
  // work off the shared dyno. So without a key, every retry (an impatient
  // second click, a reconnect, a failed poll) starts ANOTHER multi-hundred-MB
  // tar on the same box, and they stack. That is the inline-heavy-work shape
  // behind the 2026-07-31 outage.
  //
  // The bucket matters because enqueueJob reuses ANY job with a matching key,
  // including finished ones: a constant key would pin the caller to one stale
  // snapshot forever. Ten minutes dedupes retries while staying well inside the
  // signed URL's 1-hour lifetime, so a reused job's download_url is still good.
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
  const started = await client.callToolJson<unknown>('project_files_snapshot_async', {
    project_id: projectId,
    include_assets: includeAssets,
    compress: 'gzip',
    idempotency_key: `vscode-download:${projectId}:${includeAssets ? 'assets' : 'code'}:${bucket}`,
  });
  const { job_id: jobId } = unwrap<{ job_id?: string }>(started);
  if (!jobId) throw new Error('Snapshot job did not return a job_id');

  // Generous overall bound. The server has its own limits; this only stops a
  // wedged job from hanging the download UI forever.
  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error('Snapshot timed out after 15 minutes — the project may be too large to package.');
    }
    const raw = await client.callToolJson<unknown>('job_status_get', {
      job_id: jobId,
      wait_seconds: 20,
    });
    const job = unwrap<JobStatus>(raw);

    if (job.terminal || ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(job.status)) {
      if (job.status !== 'succeeded') {
        throw new Error(`Snapshot ${job.status}${job.error ? `: ${job.error}` : ''}`);
      }
      // The job's result is the same body the sync tool returned.
      const result = job.result as { data?: SnapshotResult } | SnapshotResult | undefined;
      const snap = (result as { data?: SnapshotResult })?.data ?? (result as SnapshotResult);
      if (!snap?.download_url) throw new Error('Snapshot succeeded but returned no download_url');
      return snap;
    }

    if (onProgress) {
      const pct = typeof job.progress === 'number' ? ` ${job.progress}%` : '';
      onProgress(`building snapshot${pct}${job.progress_message ? ` — ${job.progress_message}` : ''}`);
    }
  }
}

export async function filesStatus(
  client: HivekuMcpClient,
  projectId: string,
  local: ManifestEntry[],
): Promise<StatusResult> {
  const res = await client.callToolJson<unknown>('project_files_status', {
    project_id: projectId,
    local,
  });
  const data = unwrap<Partial<StatusResult>>(res);
  return {
    changed: data.changed ?? [],
    only_local: data.only_local ?? [],
    only_remote: data.only_remote ?? [],
    same_count: data.same_count ?? 0,
  };
}

/**
 * Hiveku-native commit. On `main`, `files`/`deletedFiles` are the commit. On a
 * BRANCH with NO files and NO deletions this is a PROMOTE: the branch's working
 * tree (edits made through the branch-aware file tools, e.g. a push from this
 * extension or an agent's project_files_bulk_save({branch})) becomes a commit
 * without re-uploading bytes; the result carries `promoted: true`. A clean
 * branch answers 409 nothing_to_commit (thrown here). On main an empty commit
 * is refused up front rather than sent.
 */
export async function vcsCommit(
  client: HivekuMcpClient,
  projectId: string,
  message: string,
  files: CommitFile[],
  deletedFiles: string[],
  branch?: string,
): Promise<CommitSummary> {
  const onBranch = 'branch' in branchArg(branch);
  if (!onBranch && files.length === 0 && deletedFiles.length === 0) {
    throw new Error('Nothing to commit on main (a commit with no files only promotes a branch working tree).');
  }
  const res = await client.callToolJson<unknown>('project_vcs_commit', {
    project_id: projectId,
    message,
    files,
    deletedFiles,
    ...branchArg(branch),
  });
  const commit = unwrap<CommitSummary>(res);
  return { ...commit, promoted: readPromoted(res) };
}

export interface BulkSaveSummary {
  total: number;
  succeeded: number;
  failed: number;
  created: number;
  updated: number;
  soft_deleted: number;
  duplicates_dropped: number;
}
export interface BulkSaveResult {
  summary: BulkSaveSummary;
  results: Array<{ path: string; ok: boolean; error?: string; version?: number }>;
  /** Branch saves only: the working-tree fingerprint after this batch. */
  working_tree_etag?: string | null;
  /** Branch saves only: whether a live branch preview was synced, or a hint to start one. */
  preview_effect?: unknown;
  /**
   * The route stops applying files at its wall budget (85s, under the edge's
   * ~100-120s 524) and answers 207 with the paths it did NOT attempt. Files in
   * results[] are written; the caller re-sends only remaining_paths. Before
   * 2026-09-04 a long batch simply died at the edge with an ambiguous 524.
   */
  partial: boolean;
  remaining_paths: string[];
}

/**
 * Write a batch of files to the project's CURRENT files (builder_code_versions,
 * is_current) — the layer the build, preview, and deploy actually read. Unlike
 * project_vcs_commit this has NO GitHub hand-off, so it's the right primitive
 * for a DB-canonical mirror. The server caps a single call at 500 files / 20MB;
 * keep batches well under that for reliability over the MCP transport. Verify a
 * batch landed via the returned summary/results — do NOT rely on
 * project_files_status for binary (that diff is text-only).
 */
export async function filesBulkSave(
  client: HivekuMcpClient,
  projectId: string,
  files: CommitFile[],
  message?: string,
  /**
   * Non-main branch: the batch lands in that branch's WORKING TREE (not a
   * commit, never main, never builder_code_versions.is_current). Promote it
   * with vcsCommit(..., [], [], branch). Omitted/main = the live project.
   */
  branch?: string,
): Promise<BulkSaveResult> {
  const res = await client.callToolJson<unknown>('project_files_bulk_save', {
    project_id: projectId,
    files: files.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding })),
    ...(message ? { commit_message: message } : {}),
    ...branchArg(branch),
  });
  const data = unwrap<Partial<BulkSaveResult>>(res);
  const s = (data.summary ?? {}) as Partial<BulkSaveSummary>;
  return {
    summary: {
      total: s.total ?? files.length,
      succeeded: s.succeeded ?? 0,
      failed: s.failed ?? 0,
      created: s.created ?? 0,
      updated: s.updated ?? 0,
      soft_deleted: s.soft_deleted ?? 0,
      duplicates_dropped: s.duplicates_dropped ?? 0,
    },
    results: Array.isArray(data.results) ? data.results : [],
    working_tree_etag: readSibling<string | null>(res, 'working_tree_etag'),
    preview_effect: readSibling<unknown>(res, 'preview_effect'),
    partial: readSibling<boolean>(res, 'partial') === true,
    remaining_paths: (() => {
      const raw = readSibling<unknown>(res, 'remaining_paths');
      return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
    })(),
  };
}

/** Soft-delete a single file (tombstone — is_current flipped to false). On a
 *  non-main branch, removes the path from that branch's working tree instead
 *  (main untouched; not a commit until promoted). */
export async function fileDelete(
  client: HivekuMcpClient,
  projectId: string,
  filePath: string,
  branch?: string,
): Promise<void> {
  await client.callToolJson<unknown>('project_file_delete', {
    project_id: projectId,
    file_path: filePath,
    ...branchArg(branch),
  });
}

/**
 * Upload one binary asset to the project's S3-backed asset store
 * (builder_project_assets + CDN) via assets_upload. This is the lane the DEPLOY
 * actually serves public/ images from — unlike filesBulkSave, which writes
 * builder_code_versions (shows in the Fly preview but is dropped from the deploy
 * bundle by asset-build-bypass, so images pushed there go missing on deploy).
 * Server cap: 25MB after base64-decode per file.
 */
export async function assetsUpload(
  client: HivekuMcpClient,
  projectId: string,
  filePath: string,
  base64Content: string,
  mimeType?: string,
): Promise<void> {
  await client.callToolJson<unknown>('assets_upload', {
    project_id: projectId,
    file_path: filePath,
    content: base64Content,
    ...(mimeType ? { mime_type: mimeType } : {}),
    source_type: 'vscode_push',
  });
}

export async function vcsBranchCreate(
  client: HivekuMcpClient,
  projectId: string,
  name: string,
  from?: string,
): Promise<BranchRef> {
  const res = await client.callToolJson<unknown>('project_vcs_branch_create', {
    project_id: projectId,
    name,
    ...(from ? { from } : {}),
  });
  return unwrap<BranchRef>(res);
}

export async function vcsCheckout(
  client: HivekuMcpClient,
  projectId: string,
  branch: string,
): Promise<CheckoutTree> {
  const res = await client.callToolJson<unknown>('project_vcs_checkout', {
    project_id: projectId,
    branch,
  });
  return unwrap<CheckoutTree>(res);
}

export async function vcsMerge(
  client: HivekuMcpClient,
  projectId: string,
  branch: string,
  message?: string,
  /** Merge target. Omitted means `main` — which changes the LIVE project. */
  into?: string,
): Promise<MergeResult> {
  const res = await client.callToolJson<unknown>('project_vcs_merge', {
    project_id: projectId,
    branch,
    ...(message ? { message } : {}),
    ...(into ? { into } : {}),
  });
  return unwrap<MergeResult>(res);
}

export async function vcsBranchPreview(
  client: HivekuMcpClient,
  projectId: string,
  branch: string,
): Promise<BranchPreviewResult> {
  const res = await client.callToolJson<unknown>('project_vcs_branch_preview', {
    project_id: projectId,
    branch,
  });
  return unwrap<BranchPreviewResult>(res);
}

/** Poll a branch preview started by vcsBranchPreview instead of starting another
 *  (a repeat start spawns a SECOND app). Re-probes the container each call. */
export async function vcsBranchPreviewStatus(
  client: HivekuMcpClient,
  projectId: string,
  sessionId: string,
): Promise<BranchPreviewStatus> {
  const res = await client.callToolJson<unknown>('project_vcs_branch_preview_status', {
    project_id: projectId,
    session_id: sessionId,
  });
  const d = unwrap<Partial<BranchPreviewStatus>>(res) ?? {};
  return {
    status: typeof d.status === 'string' ? d.status : 'unknown',
    ready: d.ready === true,
    previewUrl: typeof d.previewUrl === 'string' ? d.previewUrl : null,
    branch: typeof d.branch === 'string' ? d.branch : undefined,
  };
}

/** Destroy a branch preview and its isolated app now. Irreversible. */
export async function vcsBranchPreviewTeardown(
  client: HivekuMcpClient,
  projectId: string,
  sessionId: string,
): Promise<void> {
  await client.callToolJson<unknown>('project_vcs_branch_preview_teardown', {
    project_id: projectId,
    session_id: sessionId,
  });
}

/** One side of a per-file branch diff. `tooLarge` replaces content over 1 MB. */
export interface DiffFileSide {
  content?: string;
  encoding?: 'utf-8' | 'base64';
  hash?: string;
  tooLarge?: boolean;
}

export interface DiffFileResult {
  from: string;
  to: string;
  path: string;
  /** The compare route's vocabulary; `unchanged`/`missing` come back when neither side differs or both are absent. */
  status: 'added' | 'removed' | 'modified' | 'unchanged' | 'missing' | 'same';
  /** The file on `from` (a PR's TARGET branch); null when absent there. */
  base: DiffFileSide | null;
  /** The file on `to` (a PR's SOURCE branch); null when absent there. */
  head: DiffFileSide | null;
}

/**
 * Both sides of ONE file across two branches' working trees — the per-file
 * drill-down for vcsCompare / a PR diff (from = target, to = source).
 * Uncommitted working-tree edits on either side are included.
 */
export async function vcsDiffFile(
  client: HivekuMcpClient,
  projectId: string,
  from: string,
  to: string,
  filePath: string,
): Promise<DiffFileResult> {
  const res = await client.callToolJson<unknown>('project_vcs_diff_file', {
    project_id: projectId,
    from,
    to,
    path: filePath,
  });
  const d = unwrap<Partial<DiffFileResult>>(res) ?? {};
  return {
    from: d.from ?? from,
    to: d.to ?? to,
    path: d.path ?? filePath,
    status: d.status ?? 'same',
    base: d.base ?? null,
    head: d.head ?? null,
  };
}

/**
 * Text to show for one side of a vcsDiffFile result. Binary and oversized
 * sides get a placeholder rather than garbage; an absent side is empty (so an
 * added/removed file diffs against nothing, as git does).
 */
export function diffSideText(side: DiffFileSide | null): string {
  if (!side) return '';
  if (side.tooLarge) return '(file over 1 MB — too large to show)';
  if (side.encoding === 'base64') return '(binary file — no text diff)';
  return typeof side.content === 'string' ? side.content : '';
}

export async function vcsCompare(
  client: HivekuMcpClient,
  projectId: string,
  from: string,
  to: string,
): Promise<CompareResult> {
  const res = await client.callToolJson<unknown>('project_vcs_compare', {
    project_id: projectId,
    from,
    to,
  });
  return unwrap<CompareResult>(res);
}

export async function vcsPrune(
  client: HivekuMcpClient,
  projectId: string,
  dryRun = true,
): Promise<PruneResult> {
  const res = await client.callToolJson<unknown>('project_vcs_prune', {
    project_id: projectId,
    dry_run: dryRun,
  });
  return unwrap<PruneResult>(res);
}

/**
 * Move a BRANCH back to one of its own earlier commits: writes a new 'revert'
 * commit whose tree is the target's and discards the branch's uncommitted
 * working-tree edits. Refused for main (use checkpointRestore there) and for a
 * commit from another branch. Pass `expectedHeadCommitId` (the head you showed
 * the user) so a concurrent save answers 409 branch_changed instead of being
 * thrown away silently.
 */
export async function vcsRevert(
  client: HivekuMcpClient,
  projectId: string,
  branch: string,
  commitId: string,
  expectedHeadCommitId?: string | null,
  message?: string,
): Promise<CommitSummary> {
  const res = await client.callToolJson<unknown>('project_vcs_revert', {
    project_id: projectId,
    branch,
    commit_id: commitId,
    ...(expectedHeadCommitId ? { expected_head_commit_id: expectedHeadCommitId } : {}),
    ...(message ? { message } : {}),
  });
  return unwrap<CommitSummary>(res);
}

export async function vcsHistory(
  client: HivekuMcpClient,
  projectId: string,
  limit = 100,
  /**
   * Scope to one branch. Callers that act on a commit MUST pass this: an
   * unscoped history mixes branches. Main commits revert via checkpointRestore
   * (checkpoint_hash); branch commits via vcsRevert (no checkpoint, by design).
   */
  branch?: string,
): Promise<CommitSummary[]> {
  const res = await client.callToolJson<unknown>('project_vcs_history', {
    project_id: projectId,
    limit,
    ...(branch ? { branch } : {}),
  });
  const list = unwrap<CommitSummary[]>(res);
  return Array.isArray(list) ? list : [];
}

/** Also lazily initializes the project's VCS (`main` ref + initial commit). */
export async function vcsBranches(client: HivekuMcpClient, projectId: string): Promise<BranchRef[]> {
  const res = await client.callToolJson<unknown>('project_vcs_branches', { project_id: projectId });
  const list = unwrap<BranchRef[]>(res);
  return Array.isArray(list) ? list : [];
}

// ── Native pull requests, environment bindings, stash ────────────────────────
// All Hiveku-native (project_pull_requests / vcs_*_branch bindings) — they work
// on every project, GitHub or not. Unrelated to the github_* PR surface.

export interface PullRequest {
  id: string;
  /** Per-project number — how every other PR call addresses it. */
  number: number;
  status: 'open' | 'merged' | 'closed';
  source_branch: string;
  target_branch: string;
  title: string;
  description: string | null;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

/** pr_get returns the PR NESTED under `pr`, alongside a diff recomputed on
 *  every read (null when the source branch is gone). */
export interface PullRequestDetail {
  pr: PullRequest;
  diff: CompareResult | null;
  diff_error?: string | null;
}

export interface EnvBinding {
  branch: string;
  bound: boolean;
  /** production only: `main` IS production and can never be rebound. */
  locked?: boolean;
}

export interface EnvBindings {
  development: EnvBinding;
  staging: EnvBinding;
  production: EnvBinding;
}

/** One shape for both stash lanes; the branch lane adds boundBranch/added/deleted,
 *  the main lane adds pendingAdds/pendingDeletes. Read via stashCounts(). */
export interface StashResult {
  status: 'clean' | 'stashed' | 'skipped' | 'failed';
  reason?: string;
  branch?: string;
  boundBranch?: string | null;
  fileCount?: number;
  modified?: number;
  added?: number;
  deleted?: number;
  pendingAdds?: number;
  pendingDeletes?: number;
  dryRun?: boolean;
}

/** The stash route is the ONE vcs route with no `{data}` envelope. */
export interface StashResponse {
  kind: 'main' | 'branch';
  result: StashResult;
}

/** Normalizes the two lanes' differently-named add/delete counts. */
export function stashCounts(r: StashResult): { modified: number; added: number; deleted: number; total: number } {
  const modified = r.modified ?? 0;
  const added = r.added ?? r.pendingAdds ?? 0;
  const deleted = r.deleted ?? r.pendingDeletes ?? 0;
  return { modified, added, deleted, total: r.fileCount ?? modified + added + deleted };
}

export async function vcsPrList(
  client: HivekuMcpClient,
  projectId: string,
  status?: 'open' | 'merged' | 'closed',
): Promise<PullRequest[]> {
  const res = await client.callToolJson<unknown>('project_vcs_pr_list', {
    project_id: projectId,
    ...(status ? { status } : {}),
  });
  const list = unwrap<PullRequest[]>(res);
  return Array.isArray(list) ? list : [];
}

export async function vcsPrGet(
  client: HivekuMcpClient,
  projectId: string,
  num: number,
): Promise<PullRequestDetail> {
  const res = await client.callToolJson<unknown>('project_vcs_pr_get', {
    project_id: projectId,
    number: num,
  });
  return unwrap<PullRequestDetail>(res);
}

export async function vcsPrCreate(
  client: HivekuMcpClient,
  projectId: string,
  sourceBranch: string,
  title: string,
  targetBranch?: string,
  description?: string,
): Promise<PullRequest> {
  const res = await client.callToolJson<unknown>('project_vcs_pr_create', {
    project_id: projectId,
    source_branch: sourceBranch,
    title,
    ...(targetBranch ? { target_branch: targetBranch } : {}),
    ...(description ? { description } : {}),
  });
  return unwrap<PullRequest>(res);
}

/**
 * STRICT: any conflict refuses the whole merge (thrown, with conflicts in the
 * message). NOTE the envelope differs from vcsMerge: this route returns
 * `{data: {pr, merge}}`, so the MergeResult is one level deeper. Casting the
 * whole body to MergeResult made `applied` undefined and turned a SUCCESSFUL
 * merge into a TypeError the operator read as failure.
 */
export interface PrMergeResult {
  pr: PullRequest;
  merge: MergeResult;
  /** The merge LANDED but the PR's open->merged relabel lost a status race
   *  (the server retries it). `pr` may still read `open`; a branch delete
   *  right now is refused as "open pull request", so callers must not offer
   *  one until the label settles. Absent (never false) on a clean merge. */
  relabel_failed?: true;
}

export async function vcsPrMerge(
  client: HivekuMcpClient,
  projectId: string,
  num: number,
  message?: string,
): Promise<PrMergeResult> {
  const res = await client.callToolJson<unknown>('project_vcs_pr_merge', {
    project_id: projectId,
    number: num,
    ...(message ? { message } : {}),
  });
  const out = unwrap<PrMergeResult>(res);
  return readSibling<boolean>(res, 'relabel_failed') === true ? { ...out, relabel_failed: true } : out;
}

export async function vcsPrClose(
  client: HivekuMcpClient,
  projectId: string,
  num: number,
): Promise<PullRequest> {
  const res = await client.callToolJson<unknown>('project_vcs_pr_close', {
    project_id: projectId,
    number: num,
  });
  return unwrap<PullRequest>(res);
}

/** Reopen a CLOSED PR (merged ones are terminal). 409 if not closed, or if
 *  another PR for the same source→target pair is now open. */
export async function vcsPrReopen(
  client: HivekuMcpClient,
  projectId: string,
  num: number,
): Promise<PullRequest> {
  const res = await client.callToolJson<unknown>('project_vcs_pr_reopen', {
    project_id: projectId,
    number: num,
  });
  return unwrap<PullRequest>(res);
}

/**
 * Picker label for a deploy tier: which tree its next deploy ships. The
 * bindings decide, never the caller — production is always main.
 */
export function bindingLabel(env: 'development' | 'staging' | 'production', bindings?: EnvBindings | null): string {
  if (env === 'production') return 'production - always main';
  const b = bindings?.[env];
  if (!b) return `${env} - binding unknown`;
  return b.bound && b.branch && b.branch !== 'main' ? `${env} - serves branch ${b.branch}` : `${env} - serves main`;
}

/** The tiers currently bound to `branch` (never production). */
export function tiersBoundTo(bindings: EnvBindings | null | undefined, branch: string): Array<'development' | 'staging'> {
  const out: Array<'development' | 'staging'> = [];
  for (const env of ['development', 'staging'] as const) {
    const b = bindings?.[env];
    if (b?.bound && b.branch === branch) out.push(env);
  }
  return out;
}

export async function vcsEnvBindings(client: HivekuMcpClient, projectId: string): Promise<EnvBindings> {
  const res = await client.callToolJson<unknown>('project_vcs_env_bindings', { project_id: projectId });
  return unwrap<EnvBindings>(res);
}

/** The bindings after a bind, plus the route's consequence warning. The
 *  route returns `{ data: bindings, warning?, warning_code? }` — the warning
 *  is a SIBLING of `data` (unwrap drops it), so it is read from the raw
 *  payload like readPromoted. `cms_writes_to_main` means every CMS write
 *  still goes to main and will not show on the tier now serving a branch. */
export interface EnvBindResult extends EnvBindings {
  warning?: string;
  warning_code?: string;
}

/** `branch` of 'main' (or '') clears the binding. production is refused server-side. */
export async function vcsEnvBind(
  client: HivekuMcpClient,
  projectId: string,
  environment: 'development' | 'staging',
  branch: string,
): Promise<EnvBindResult> {
  const res = await client.callToolJson<unknown>('project_vcs_env_bind', {
    project_id: projectId,
    environment,
    branch,
  });
  const bindings = unwrap<EnvBindings>(res);
  const warning = readSibling<unknown>(res, 'warning');
  const warningCode = readSibling<unknown>(res, 'warning_code');
  return {
    ...bindings,
    ...(typeof warning === 'string' && warning.trim() ? { warning: warning.trim() } : {}),
    ...(typeof warningCode === 'string' && warningCode ? { warning_code: warningCode } : {}),
  };
}

/**
 * Scoop pending work onto a branch. dryRun defaults TRUE and writes NOTHING —
 * only an explicit false moves anything. No `{data}` envelope on this route.
 */
export async function vcsStash(
  client: HivekuMcpClient,
  projectId: string,
  environment: 'production' | 'development' | 'staging',
  dryRun = true,
  branchName?: string,
): Promise<StashResponse> {
  const res = await client.callToolJson<unknown>('project_vcs_stash', {
    project_id: projectId,
    environment,
    dry_run: dryRun,
    ...(branchName ? { branch_name: branchName } : {}),
  });
  return unwrap<StashResponse>(res);
}

/** Irreversible for the ref. Refused for main, env-bound branches, and open-PR branches. */
export async function vcsBranchDelete(
  client: HivekuMcpClient,
  projectId: string,
  branch: string,
  force = false,
): Promise<{ deleted: string }> {
  const res = await client.callToolJson<unknown>('project_vcs_branch_delete', {
    project_id: projectId,
    branch,
    confirm: true,
    ...(force ? { force: true } : {}),
  });
  return unwrap<{ deleted: string }>(res);
}

export interface DeployStart {
  /** Normalized: the olympus deploy route returns `deploy_id`; older
   *  envelopes used `deployment_id`. Whichever arrived is copied here. */
  deployment_id?: string;
  deploy_id?: string;
  status?: string;
  /** The branch that actually ships (a bound tier's branch, else main). */
  branch?: string;
  vcs_commit_id?: string | null;
  promoted_commit_id?: string | null;
  /** Present when the bound branch had uncommitted edits that were promoted
   *  into a commit for this deploy — say it, the operator did not ask for a commit. */
  note?: string;
}

/** `deploy_id ?? deployment_id` from a deploy_site body — never fabricated. */
export function readDeployId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const id = typeof b.deploy_id === 'string' && b.deploy_id ? b.deploy_id : typeof b.deployment_id === 'string' && b.deployment_id ? b.deployment_id : undefined;
  return id;
}

export async function deploySite(
  client: HivekuMcpClient,
  projectId: string,
  environment: 'development' | 'staging' | 'production',
): Promise<DeployStart> {
  const res = await client.callToolJson<unknown>('deploy_site', {
    project_id: projectId,
    environment,
    agent_codename: 'vscode-ext',
  });
  const body = (unwrap<DeployStart>(res) as DeployStart | null | undefined) ?? {};
  const id = readDeployId(body);
  return id ? { ...body, deployment_id: id } : body;
}

// ── Environments (deployed tiers) — URLs + per-env build/deploy logs ──────────

export type EnvId = 'development' | 'staging' | 'production';

export interface ProjectTier {
  url?: string;
  enabled?: boolean;
  status?: string;
  latest_deployment?: Record<string, unknown>;
}
export interface ProjectDetail {
  id?: string;
  name?: string;
  tiers?: { development?: ProjectTier; staging?: ProjectTier; production?: ProjectTier };
  [k: string]: unknown;
}

/** Full project record — carries per-tier deploy URLs + enabled flags in `tiers`. */
export async function projectGet(client: HivekuMcpClient, projectId: string): Promise<ProjectDetail> {
  const res = await client.callToolJson<unknown>('project_get', { project_id: projectId });
  return (unwrap<ProjectDetail>(res) as ProjectDetail) ?? {};
}

export interface DeployRecord {
  deployment_id?: string;
  id?: string;
  environment?: string;
  status?: string;
  url?: string;
  error?: string;
  build_logs?: string;
  created_at?: string;
}

/** Latest deployment for a tier. Defensive against `{data:{...}}` vs `{most_recent,data:[]}`. */
export async function deployStatus(
  client: HivekuMcpClient,
  projectId: string,
  environment: EnvId | undefined,
): Promise<{ most_recent?: DeployRecord; history: DeployRecord[] }> {
  const res = await client.callToolJson<unknown>(
    'deploy_status',
    environment ? { project_id: projectId, environment } : { project_id: projectId },
  );
  const root = (res && typeof res === 'object' ? (res as Record<string, unknown>) : {}) as Record<string, unknown>;
  const body =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;
  const history = Array.isArray(body.data)
    ? (body.data as DeployRecord[])
    : Array.isArray(body.deployments)
      ? (body.deployments as DeployRecord[])
      : Array.isArray(root.data)
        ? (root.data as DeployRecord[])
        : [];
  const most_recent = (body.most_recent as DeployRecord) || history[0];
  return { most_recent, history };
}

/** A single deployment, including its full `build_logs` (DB-backed, not S3). */
export async function deployGet(
  client: HivekuMcpClient,
  projectId: string,
  deploymentId: string,
): Promise<DeployRecord> {
  const res = await client.callToolJson<unknown>('deploy_get', { project_id: projectId, deployment_id: deploymentId });
  return (unwrap<DeployRecord>(res) as DeployRecord) ?? {};
}

export interface BuildError {
  error_summary?: string;
  last_log_lines?: string[];
  full_logs?: string;
}

/** The extracted real error region for the latest failed build (best-effort). */
export async function projectBuildErrorGet(
  client: HivekuMcpClient,
  projectId: string,
): Promise<BuildError | undefined> {
  try {
    const res = await client.callToolJson<unknown>('project_build_error_get', { project_id: projectId });
    return unwrap<BuildError>(res);
  } catch {
    return undefined;
  }
}

export type EnvSlot = 'preview' | EnvId;
export interface EnvDescriptor {
  env: EnvSlot;
  label: string;
  /** Resolved URL, or undefined when not deployed/enabled. */
  url?: string;
  status?: string;
}

/** Fly live-preview URL synthesized from a project UUID (fallback when preview_overview has none). */
export function flyPreviewUrl(projectId: string): string {
  const hex = projectId.replace(/-/g, '').slice(0, 12).toLowerCase();
  return `https://hvk-${hex}.preview.hiveku.com`;
}

/** The four environment descriptors for a project — Live Preview (Fly) + dev/staging/prod tiers. */
export async function resolveEnvironments(client: HivekuMcpClient, projectId: string): Promise<EnvDescriptor[]> {
  const [detail, preview] = await Promise.allSettled([projectGet(client, projectId), previewOverview(client, projectId)]);
  const tiers = detail.status === 'fulfilled' ? detail.value.tiers : undefined;
  const prev = preview.status === 'fulfilled' ? preview.value : undefined;
  const tier = (env: EnvId, label: string, t?: ProjectTier): EnvDescriptor => {
    const url = t && t.enabled !== false ? t.url : undefined;
    const status = !t ? 'not deployed' : t.enabled === false ? 'not enabled' : t.url ? undefined : 'not deployed';
    return { env, label, url, status };
  };
  const envs: EnvDescriptor[] = [
    { env: 'preview', label: 'Live Preview', url: prev?.preview_url || flyPreviewUrl(projectId), status: prev?.status },
    tier('development', 'Development', tiers?.development),
  ];
  // Staging is per-project (disabled by default) — only surface it when THIS project has it enabled,
  // so projects without staging don't show a dead link.
  if (tiers?.staging && tiers.staging.enabled !== false) envs.push(tier('staging', 'Staging', tiers.staging));
  envs.push(tier('production', 'Production', tiers?.production));
  return envs;
}

export async function checkpointRestore(
  client: HivekuMcpClient,
  projectId: string,
  checkpointHash: string,
): Promise<unknown> {
  return client.callToolJson<unknown>('project_checkpoint_restore', {
    project_id: projectId,
    checkpoint_hash: checkpointHash,
  });
}

export interface FileVersion {
  version_number: number;
  is_current?: boolean;
  commit_message?: string;
  git_branch?: string;
  created_at: string;
  file_size?: number;
}

export async function fileVersions(
  client: HivekuMcpClient,
  projectId: string,
  filePath: string,
  limit = 100,
): Promise<FileVersion[]> {
  const res = await client.callToolJson<unknown>('project_file_versions', {
    project_id: projectId,
    file_path: filePath,
    limit,
  });
  const list = unwrap<FileVersion[]>(res);
  return Array.isArray(list) ? list : [];
}

/**
 * Current remote content of one file. Used as the left-hand side when diffing
 * the working tree against Hiveku — fileDiff returns a unified diff string, not
 * content, so it cannot serve that role.
 */
export async function fileContent(
  client: HivekuMcpClient,
  projectId: string,
  filePath: string,
  /** Non-main branch: that branch's working-tree copy (uncommitted edits included). */
  branch?: string,
): Promise<string> {
  const res = await client.callToolJson<unknown>('project_file_get', {
    project_id: projectId,
    file_path: filePath,
    ...branchArg(branch),
  });
  const data = unwrap<Record<string, unknown>>(res) as Record<string, unknown> | undefined;
  // The route's field is file_content; `content` was an alias older servers sent.
  const content = typeof data?.file_content === 'string' ? data.file_content : data?.content;
  if (typeof content !== 'string') return '';
  // Binary files come back base64-tagged; there is nothing useful to diff.
  return data?.encoding === 'base64' ? '(binary file — no text diff)' : content;
}

/** Unified diff of a past version vs the current version. */
export async function fileDiff(
  client: HivekuMcpClient,
  projectId: string,
  filePath: string,
  fromVersion: number,
): Promise<string> {
  const result = await client.callTool('project_file_diff', {
    project_id: projectId,
    file_path: filePath,
    from: fromVersion,
    format: 'unified',
  });
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string') return '(no diff)';
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const data = (parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed) as Record<string, unknown>;
    if (typeof data.diff === 'string') return data.diff;
    if (typeof data.unified === 'string') return data.unified;
    return text;
  } catch {
    return text;
  }
}

export async function fileRestore(
  client: HivekuMcpClient,
  projectId: string,
  filePath: string,
  versionNumber: number,
): Promise<unknown> {
  return client.callToolJson<unknown>('project_file_restore', {
    project_id: projectId,
    file_path: filePath,
    version_number: versionNumber,
  });
}

// ── Account operations: PM tasks, workflows, CRM, helpdesk (account-level) ────

export interface PmTask {
  id: string;
  title?: string;
  name?: string;
  status?: string;
  due_date?: string;
  priority?: string;
  task_number?: number;
  task_type?: string;
  created_at?: string;
  /** List rows join the assignee in ({ id, name, email }); null when unassigned. */
  assigned_to?: { id?: string; name?: string | null; email?: string | null } | null;
  /**
   * The PM project the task lives in. `website_project_id` (nullable) is the only
   * surface linking a task to a code project — it matches sites_list ids for
   * annotation-feedback projects; manually created PM projects carry null (the
   * Olympus project routes drop the field on create and never return it).
   */
  project?: { id?: string; name?: string; website_project_id?: string | null } | null;
  /** Legacy flat fields from older server shapes — prefer `project`. */
  project_id?: string;
  project_name?: string;
}
export async function pmTasksList(client: HivekuMcpClient, limit = 200): Promise<PmTask[]> {
  const res = await client.callToolJson<unknown>('pm_tasks_list', { limit });
  const list = unwrap<PmTask[]>(res);
  return Array.isArray(list) ? list : [];
}
/**
 * The tasks route hard-caps at 200 rows newest-first with NO pagination, so on
 * busy accounts the oldest OPEN tasks fall off behind completed noise. Merge the
 * newest 200 of everything with up to 200 open-status rows (status filter is a
 * comma list the route honors) so open work is never silently hidden. Custom
 * statuses outside the canonical set still surface via the unfiltered fetch.
 */
const OPEN_STATUSES = 'todo,queued,in_progress,qa,ready_for_review,blocked';
export async function pmTasksAll(client: HivekuMcpClient): Promise<PmTask[]> {
  const [recent, open] = await Promise.all([
    pmTasksList(client),
    client
      .callToolJson<unknown>('pm_tasks_list', { limit: 200, status: OPEN_STATUSES })
      .then((res) => {
        const list = unwrap<PmTask[]>(res);
        return Array.isArray(list) ? list : [];
      })
      .catch(() => [] as PmTask[]),
  ]);
  const seen = new Set(recent.map((t) => t.id));
  return [...recent, ...open.filter((t) => !seen.has(t.id))];
}
export async function pmTaskComplete(client: HivekuMcpClient, id: string, summary?: string): Promise<unknown> {
  return client.callToolJson<unknown>('pm_tasks_complete', { id, ...(summary ? { summary } : {}) });
}
export interface PmProject {
  id: string;
  name?: string;
  status?: string;
}
export async function pmProjectsList(client: HivekuMcpClient): Promise<PmProject[]> {
  const res = await client.callToolJson<unknown>('pm_projects_list', {});
  const list = unwrap<PmProject[]>(res);
  return Array.isArray(list) ? list : [];
}
export async function pmTaskCreate(
  client: HivekuMcpClient,
  title: string,
  projectId: string,
  extras: { description?: string; priority?: string; due_date?: string; assigned_to_id?: string } = {},
): Promise<unknown> {
  const args: Record<string, unknown> = { title, project_id: projectId };
  for (const [k, v] of Object.entries(extras)) if (v !== undefined && v !== '') args[k] = v;
  return client.callToolJson<unknown>('pm_tasks_create', args);
}

/** PATCH one PM task. Allow-listed fields only (status/priority/assignee/due/title/description…). */
export async function pmTaskUpdate(
  client: HivekuMcpClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<unknown> {
  return client.callToolJson<unknown>('pm_tasks_update', { id, ...patch });
}

export async function pmTaskDelete(client: HivekuMcpClient, id: string): Promise<unknown> {
  return client.callToolJson<unknown>('pm_tasks_delete', { id });
}

export interface PmTaskComment {
  id?: string;
  content?: string;
  created_at?: string;
  /** Agent-authored comments carry a codename; humans carry author_name/user_id. */
  agent_codename?: string | null;
  author_name?: string | null;
  author_email?: string | null;
  user_id?: string | null;
  parent_comment_id?: string | null;
  attachments?: Array<{ name?: string; url?: string; type?: string }>;
}

/** The task's comment thread, oldest first. */
export async function pmTaskComments(client: HivekuMcpClient, id: string): Promise<PmTaskComment[]> {
  const res = await client.callToolJson<unknown>('pm_task_comments_list', { id });
  const list = unwrap<PmTaskComment[]>(res);
  return Array.isArray(list) ? list : [];
}

export async function pmTaskComment(client: HivekuMcpClient, id: string, content: string): Promise<unknown> {
  return client.callToolJson<unknown>('pm_tasks_comment', { id, content, author_codename: 'vscode' });
}

/** Subtasks of one parent task (tolerant — older servers lack the tool). */
export async function pmTaskSubtasks(client: HivekuMcpClient, parentTaskId: string): Promise<PmTask[]> {
  try {
    const res = await client.callToolJson<unknown>('pm_tasks_subtasks', { parent_task_id: parentTaskId, limit: 100 });
    const list = unwrap<PmTask[]>(res);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export interface AccountUser {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
}

/** Account users (assignee ids for tasks). Tolerant — returns [] when CRM is unavailable. */
export async function accountUsers(client: HivekuMcpClient): Promise<AccountUser[]> {
  try {
    const res = await client.callToolJson<Record<string, unknown>>('crm_list_users', {});
    // This route wraps in {users:[...]}, not {data:[...]}.
    const d = unwrap<Record<string, unknown>>(res) ?? {};
    const list = Array.isArray(d) ? d : d.users;
    return Array.isArray(list) ? (list as AccountUser[]) : [];
  } catch {
    return [];
  }
}

export interface Workflow {
  id: string;
  name?: string;
  /** Canonical field is `is_enabled`; `enabled` kept as a tolerant fallback. */
  is_enabled?: boolean;
  enabled?: boolean;
  run_count?: number;
  description?: string;
}

/** Workflow-run status vocab: queued|pending|running|completed|failed|cancelled. */
export function isFailedRunStatus(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase();
  return s === 'failed' || s === 'error';
}
export function isWorkflowEnabled(w: { is_enabled?: boolean; enabled?: boolean }): boolean {
  return w.is_enabled ?? w.enabled ?? false;
}
export async function workflowList(client: HivekuMcpClient): Promise<Workflow[]> {
  const res = await client.callToolJson<unknown>('workflow_list', {});
  const list = unwrap<Workflow[]>(res);
  return Array.isArray(list) ? list : [];
}
export async function workflowRun(client: HivekuMcpClient, id: string): Promise<unknown> {
  return client.callToolJson<unknown>('workflow_run', { id });
}
export async function workflowSetEnabled(client: HivekuMcpClient, id: string, enabled: boolean): Promise<unknown> {
  return client.callToolJson<unknown>(enabled ? 'workflow_enable' : 'workflow_disable', { id });
}
export interface WorkflowRun {
  workflow_id?: string;
  workflow_name?: string;
  status?: string;
  started_at?: string;
  created_at?: string;
}
export async function workflowRunsRecent(client: HivekuMcpClient): Promise<WorkflowRun[]> {
  const res = await client.callToolJson<unknown>('workflow_runs_recent', {});
  const list = unwrap<WorkflowRun[]>(res);
  return Array.isArray(list) ? list : [];
}

export interface CrmDeal {
  id?: string;
  name?: string;
  title?: string;
  value?: number;
  amount?: number;
  stage_name?: string;
  status?: string;
}
export async function crmListDeals(
  client: HivekuMcpClient,
  opts: { pipeline_id?: string; status?: string; limit?: number } = {},
): Promise<CrmDeal[]> {
  const res = await client.callToolJson<unknown>('crm_list_deals', { limit: opts.limit ?? 25, ...opts });
  const list = unwrap<CrmDeal[]>(res);
  return Array.isArray(list) ? list : [];
}
export interface CrmContact {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  lifecycle_stage?: string;
}
export async function crmListContacts(client: HivekuMcpClient, limit = 25): Promise<CrmContact[]> {
  const res = await client.callToolJson<unknown>('crm_list_contacts', { limit });
  const list = unwrap<CrmContact[]>(res);
  return Array.isArray(list) ? list : [];
}
export async function crmListPipelines(client: HivekuMcpClient): Promise<Array<{ id?: string; name?: string }>> {
  const res = await client.callToolJson<unknown>('crm_list_pipelines', {});
  const list = unwrap<Array<{ id?: string; name?: string }>>(res);
  return Array.isArray(list) ? list : [];
}

export async function crmAccountSummary(client: HivekuMcpClient): Promise<Record<string, unknown>> {
  const res = await client.callToolJson<unknown>('crm_account_summary', {});
  return unwrap<Record<string, unknown>>(res) ?? {};
}

// ── Account entitlements (plan + per-page access) — gates what the extension shows ──
export interface AccountEntitlements {
  plan: string;
  page_access: Record<string, boolean>;
  entitled_features: string[];
}

/**
 * The account's plan + per-page access map (plan ∩ release-tier), via the
 * `account_entitlements` tool. Returns undefined if the tool isn't available
 * (older server) — callers should then show everything (graceful fallback).
 */
export async function accountEntitlements(client: HivekuMcpClient): Promise<AccountEntitlements | undefined> {
  try {
    const res = await client.callToolJson<unknown>('account_entitlements', {});
    const d = unwrap<Record<string, unknown>>(res) ?? {};
    const pa = (d.page_access && typeof d.page_access === 'object' ? d.page_access : null) as Record<string, boolean> | null;
    if (!pa) return undefined;
    return {
      plan: String(d.plan ?? ''),
      page_access: pa,
      entitled_features: Array.isArray(d.entitled_features) ? (d.entitled_features as string[]) : [],
    };
  } catch {
    return undefined;
  }
}
export async function helpdeskTickets(client: HivekuMcpClient, status?: string): Promise<Array<Record<string, unknown>>> {
  const res = await client.callToolJson<unknown>('helpdesk_ticket_list', status ? { status } : {});
  const list = unwrap<Array<Record<string, unknown>>>(res);
  return Array.isArray(list) ? list : [];
}
export async function helpdeskOverdue(client: HivekuMcpClient): Promise<Array<Record<string, unknown>>> {
  const res = await client.callToolJson<unknown>('helpdesk_tickets_overdue', {});
  const list = unwrap<Array<Record<string, unknown>>>(res);
  return Array.isArray(list) ? list : [];
}

// ── Project resources (command center): preview / secrets / database / media ──

export async function previewOverview(
  client: HivekuMcpClient,
  projectId: string,
): Promise<{ preview_url?: string; status?: string }> {
  const res = await client.callToolJson<unknown>('preview_overview', { project_id: projectId });
  const d = unwrap<Record<string, unknown>>(res) ?? {};
  return {
    preview_url: (d.preview_url as string) || (d.url as string) || undefined,
    status: (d.status as string) || undefined,
  };
}

export async function previewSync(client: HivekuMcpClient, projectId: string): Promise<unknown> {
  return client.callToolJson<unknown>('preview_sync', { project_id: projectId });
}

export async function previewForceRecompile(
  client: HivekuMcpClient,
  projectId: string,
  refreshImage = false,
): Promise<{ success?: boolean; warning?: string }> {
  const res = await client.callToolJson<unknown>('preview_force_recompile', {
    project_id: projectId,
    refresh_image: refreshImage,
    wait_for_ready: false,
  });
  const d = unwrap<Record<string, unknown>>(res) ?? {};
  return {
    success: typeof d.success === 'boolean' ? d.success : undefined,
    warning: typeof d.warning === 'string' ? d.warning : undefined,
  };
}

/**
 * Boot-phase probe for the preview machine, via the `preview_health` tool.
 * Returns undefined if the tool isn't available (older server) or the call
 * fails — callers should treat that as "unknown", not as unhealthy.
 */
export async function previewHealth(
  client: HivekuMcpClient,
  projectId: string,
): Promise<{ ready?: boolean; phase?: string } | undefined> {
  try {
    const res = await client.callToolJson<unknown>('preview_health', { project_id: projectId });
    const d = unwrap<Record<string, unknown>>(res) ?? {};
    return {
      ready: typeof d.ready === 'boolean' ? d.ready : undefined,
      phase: typeof d.phase === 'string' ? d.phase : undefined,
    };
  } catch {
    return undefined;
  }
}

export async function previewLogs(client: HivekuMcpClient, projectId: string, limit = 200): Promise<string> {
  const res = await client.callToolJson<unknown>('preview_logs', { project_id: projectId, limit });
  const d = unwrap<Record<string, unknown>>(res) ?? {};
  if (Array.isArray(d.logs)) return (d.logs as unknown[]).join('\n');
  if (Array.isArray(d.lines)) return (d.lines as unknown[]).join('\n');
  if (typeof d.logs === 'string') return d.logs;
  return JSON.stringify(d, null, 2);
}

export async function previewScreenshot(
  client: HivekuMcpClient,
  projectId: string,
  pathInside = '/',
): Promise<string | undefined> {
  const res = await client.callToolJson<unknown>('preview_screenshot', { project_id: projectId, path: pathInside });
  const d = unwrap<Record<string, unknown>>(res) ?? {};
  return (d.image_url as string) || (d.url as string) || undefined;
}

export interface SecretEntry {
  key: string;
  preview: string;
}

/** Mask a secret value for display — never render plaintext in the UI. */
export function maskSecret(v: string): string {
  if (!v) return '(empty)';
  return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
}

/**
 * Raw KEY→value map from project_secrets_list. The tool returns
 * `{ secrets: { KEY: value }, metadata }` (values are real, from AWS Secrets
 * Manager) — NOT an array, so we read the `secrets` object directly.
 */
export async function secretsMap(client: HivekuMcpClient, projectId: string): Promise<Record<string, string>> {
  return (await secretsMapWithSensitive(client, projectId)).values;
}

/**
 * Values plus the names of variables that are write-only on the platform.
 *
 * Sensitive keys are OMITTED from `secrets` server-side, never blanked, so they
 * simply do not appear in `values`. Without carrying `sensitiveKeys` alongside, a
 * hidden variable would be indistinguishable from one that was never set, and the
 * user would go debugging a phantom.
 */
export async function secretsMapWithSensitive(
  client: HivekuMcpClient,
  projectId: string,
): Promise<{ values: Record<string, string>; sensitiveKeys: string[] }> {
  const res = await client.callToolJson<unknown>('project_secrets_list', { project_id: projectId });
  const d = unwrap<Record<string, unknown>>(res) ?? {};
  const secrets = (d.secrets && typeof d.secrets === 'object' ? d.secrets : {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(secrets)) values[k] = v == null ? '' : String(v);
  const sensitiveKeys = Array.isArray(d.sensitive_keys)
    ? (d.sensitive_keys as unknown[]).map((k) => String(k))
    : [];
  return { values, sensitiveKeys };
}

/** Display list: keys with masked values, sorted. */
export async function secretsList(client: HivekuMcpClient, projectId: string): Promise<SecretEntry[]> {
  const map = await secretsMap(client, projectId);
  return Object.keys(map)
    .sort()
    .map((key) => ({ key, preview: maskSecret(map[key]) }));
}

/** Upsert one or more secrets. The tool requires a `{ secrets: {KEY:value} }` map. */
export async function secretSet(
  client: HivekuMcpClient,
  projectId: string,
  secrets: Record<string, string>,
  applyToPreview = true,
): Promise<unknown> {
  return client.callToolJson<unknown>('project_secrets_set', {
    project_id: projectId,
    secrets,
    apply_to_preview: applyToPreview,
  });
}

export async function secretDelete(client: HivekuMcpClient, projectId: string, key: string): Promise<unknown> {
  return client.callToolJson<unknown>('project_secrets_delete', { project_id: projectId, key });
}

/** Secret KEY COUNT without pulling values (metadata_only). Tolerant — undefined on failure. */
export async function secretsCount(client: HivekuMcpClient, projectId: string): Promise<number | undefined> {
  try {
    const res = await client.callToolJson<unknown>('project_secrets_list', { project_id: projectId, metadata_only: true });
    const d = unwrap<Record<string, unknown>>(res) ?? {};
    if (typeof d.count === 'number') return d.count;
    if (Array.isArray(d.keys)) return d.keys.length;
    return undefined;
  } catch {
    return undefined;
  }
}

export async function databaseStatus(client: HivekuMcpClient, projectId: string): Promise<Record<string, unknown>> {
  const res = await client.callToolJson<unknown>('database_status', { project_id: projectId });
  return unwrap<Record<string, unknown>>(res) ?? {};
}
export interface DbColumn {
  column_name?: string;
  data_type?: string;
  is_nullable?: string;
  column_default?: string | null;
}
export async function databaseDescribe(client: HivekuMcpClient, projectId: string, table: string): Promise<DbColumn[]> {
  const res = await client.callToolJson<unknown>('database_describe', { project_id: projectId, table });
  const d = unwrap<Record<string, unknown>>(res) ?? {};
  return Array.isArray(d.columns) ? (d.columns as DbColumn[]) : [];
}

export async function databaseQuery(
  client: HivekuMcpClient,
  projectId: string,
  sql: string,
): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }> {
  const res = await client.callToolJson<unknown>('database_query', { project_id: projectId, sql });
  const d = unwrap<Record<string, unknown>>(res) ?? {};
  return {
    rows: Array.isArray(d.rows) ? (d.rows as Array<Record<string, unknown>>) : [],
    rowCount: typeof d.row_count === 'number' ? d.row_count : Array.isArray(d.rows) ? d.rows.length : 0,
  };
}

export async function databaseProvision(client: HivekuMcpClient, projectId: string): Promise<unknown> {
  return client.callToolJson<unknown>('database_provision', { project_id: projectId });
}

/** True when an error means "this project simply has no database yet". */
export function isNoDatabaseError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /no_connection|no database connection/i.test(m);
}

export async function databaseTables(client: HivekuMcpClient, projectId: string): Promise<string[]> {
  const res = await client.callToolJson<unknown>('database_tables', { project_id: projectId });
  const d = unwrap<unknown>(res);
  // The route nests once more: {data: {tables: rows[], count}} — accept both shapes.
  const list = Array.isArray(d)
    ? d
    : d && typeof d === 'object' && Array.isArray((d as Record<string, unknown>).tables)
      ? ((d as Record<string, unknown>).tables as unknown[])
      : [];
  return list
    .map((t) => (typeof t === 'string' ? t : ((t as Record<string, unknown>).table_name as string) || ((t as Record<string, unknown>).name as string)))
    .filter(Boolean);
}

export interface MediaItem {
  file_path?: string;
  name?: string;
  url?: string;
  cdn_url?: string;
  mime_type?: string;
  file_size_bytes?: number;
}
export async function mediaList(client: HivekuMcpClient, projectId: string): Promise<MediaItem[]> {
  // assets_list is the project-scoped media listing.
  const res = await client.callToolJson<unknown>('assets_list', { project_id: projectId });
  const list = unwrap<MediaItem[]>(res);
  return Array.isArray(list) ? list : [];
}

/** One row of the account-wide media library (media_assets). */
export interface MediaAsset {
  id?: string;
  title?: string;
  original_filename?: string;
  filename?: string;
  file_url?: string;
  external_url?: string;
  file_path?: string;
  mime_type?: string;
  media_type?: string;
  file_size?: number;
  width?: number;
  height?: number;
  source_type?: string;
  created_at?: string;
}

/** The account-wide media library (shared across all projects), with server-side search. */
export async function mediaLibraryList(
  client: HivekuMcpClient,
  opts: { search?: string; media_type?: string; limit?: number } = {},
): Promise<MediaAsset[]> {
  // The route caps a page at 100 regardless of `limit` — page until satisfied.
  const want = opts.limit ?? 300;
  const out: MediaAsset[] = [];
  for (let page = 1; out.length < want && page <= Math.ceil(want / 100); page++) {
    const args: Record<string, unknown> = { limit: 100, page };
    if (opts.search) args.search = opts.search;
    if (opts.media_type) args.media_type = opts.media_type;
    const res = await client.callToolJson<unknown>('media_library_list', args);
    const list = unwrap<MediaAsset[]>(res);
    const rows = Array.isArray(list) ? list : [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

/** Update asset metadata (title/alt/tags/folder) — the file itself is immutable. */
export async function mediaUpdate(
  client: HivekuMcpClient,
  assetId: string,
  patch: { title?: string; alt_text?: string; tags?: string[]; folder_id?: string },
): Promise<unknown> {
  return client.callToolJson<unknown>('media_update', { asset_id: assetId, ...patch });
}

/** Hard-delete an asset (S3 purge). 409 in_use unless force. */
export async function mediaDelete(client: HivekuMcpClient, assetId: string, force = false): Promise<unknown> {
  return client.callToolJson<unknown>('media_delete', { asset_id: assetId, ...(force ? { force: true } : {}) });
}

/** Upload bytes into the account media library (base64, 50MB cap server-side). */
export async function mediaUpload(
  client: HivekuMcpClient,
  fileName: string,
  contentBase64: string,
  opts: { mime_type?: string; title?: string; folder_id?: string } = {},
): Promise<unknown> {
  return client.callToolJson<unknown>('media_upload', { file_name: fileName, content: contentBase64, ...opts });
}

export interface MediaFolder {
  id?: string;
  name?: string;
  asset_count?: number;
}
export async function mediaFolders(client: HivekuMcpClient): Promise<MediaFolder[]> {
  try {
    const res = await client.callToolJson<unknown>('media_folders_list', {});
    const list = unwrap<MediaFolder[]>(res);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// ── CMS (per website project): collections + entries ─────────────────────────

export interface CmsCollection {
  id?: string;
  name?: string;
  format?: string;
  field_count?: number;
  route_pattern?: string;
}
export async function cmsCollections(client: HivekuMcpClient, projectId: string): Promise<CmsCollection[]> {
  const res = await client.callToolJson<unknown>('cms_list_collections', { project_id: projectId });
  const d = unwrap<unknown>(res);
  if (Array.isArray(d)) return d as CmsCollection[];
  const list = (d as Record<string, unknown>)?.collections;
  return Array.isArray(list) ? (list as CmsCollection[]) : [];
}

export interface CmsEntry {
  slug?: string;
  id?: string;
  title?: string;
  name?: string;
  status?: string;
  /** The entries route emits camelCase. */
  updatedAt?: string;
  displayDate?: string;
}
export async function cmsEntries(
  client: HivekuMcpClient,
  projectId: string,
  collectionId: string,
  limit = 200,
): Promise<CmsEntry[]> {
  const res = await client.callToolJson<unknown>('cms_list_entries', {
    project_id: projectId,
    collection_id: collectionId,
    limit,
  });
  const d = unwrap<unknown>(res);
  if (Array.isArray(d)) return d as CmsEntry[];
  const list = (d as Record<string, unknown>)?.entries;
  return Array.isArray(list) ? (list as CmsEntry[]) : [];
}

export async function cmsReadEntry(
  client: HivekuMcpClient,
  projectId: string,
  collectionId: string,
  slug: string,
): Promise<Record<string, unknown> | undefined> {
  const res = await client.callToolJson<unknown>('cms_read_entry', {
    project_id: projectId,
    collection_id: collectionId,
    slug,
  });
  const d = unwrap<Record<string, unknown>>(res);
  // The route wraps the entry once more: {entry: {...}, updatedAt, variant}.
  if (d && typeof d.entry === 'object' && d.entry !== null) return d.entry as Record<string, unknown>;
  return d;
}

/** Upsert an entry by slug. `status` draft|published|scheduled (+publish_at ISO for scheduled). */
export async function cmsWriteEntry(
  client: HivekuMcpClient,
  projectId: string,
  collectionId: string,
  slug: string,
  fields: Record<string, unknown>,
  opts: { status?: string; publish_at?: string } = {},
): Promise<unknown> {
  return client.callToolJson<unknown>('cms_write_entry', {
    project_id: projectId,
    collection_id: collectionId,
    slug,
    fields,
    ...opts,
  });
}

export async function cmsDeleteEntry(
  client: HivekuMcpClient,
  projectId: string,
  collectionId: string,
  slug: string,
): Promise<unknown> {
  return client.callToolJson<unknown>('cms_delete_entry', { project_id: projectId, collection_id: collectionId, slug });
}

export async function cmsPromoteDraft(
  client: HivekuMcpClient,
  projectId: string,
  collectionId: string,
  slug: string,
): Promise<unknown> {
  return client.callToolJson<unknown>('cms_promote_draft', { project_id: projectId, collection_id: collectionId, slug });
}

export async function cmsCreateCollection(
  client: HivekuMcpClient,
  projectId: string,
  // path/slugFrom/fields are REQUIRED by the tool schema AND the manifest Zod
  // schema — omitting any of them 422s.
  spec: { id: string; name: string; format: string; path: string; slugFrom: 'filename'; fields: unknown[] },
): Promise<unknown> {
  return client.callToolJson<unknown>('cms_create_collection', { project_id: projectId, ...spec });
}

export async function cmsDeleteCollection(
  client: HivekuMcpClient,
  projectId: string,
  collectionId: string,
): Promise<unknown> {
  return client.callToolJson<unknown>('cms_delete_collection', { project_id: projectId, collection_id: collectionId });
}

// ── Memory / knowledge-base CRUD (account AI brain) ───────────────────────────

export interface MemoryEntry {
  id?: string;
  name?: string;
  domain?: string;
  content?: string;
  project_id?: string;
  version?: number | string;
  updated_at?: string;
  type?: string;
}

/** List account knowledge entries of one type (memory|rule|skill|command|agent|identity). */
export async function listMemory(client: HivekuMcpClient, type: string): Promise<MemoryEntry[]> {
  const res = await client.callToolJson<unknown>('memory_list', { type });
  const list = unwrap<MemoryEntry[]>(res);
  return Array.isArray(list) ? list : [];
}

/** Every memory row regardless of type, tagged with its type (domain-prefix decode). */
export async function listMemoryAll(client: HivekuMcpClient): Promise<MemoryEntry[]> {
  const res = await client.callToolJson<unknown>('memory_list', {});
  const list = unwrap<MemoryEntry[]>(res);
  if (!Array.isArray(list)) return [];
  return list.map((m) => ({
    ...m,
    type:
      m.type ??
      (String(m.domain ?? '').startsWith('_')
        ? String(m.domain).slice(1).split(':')[0]
        : 'memory'),
  }));
}

export async function memoryGet(client: HivekuMcpClient, memoryId: string): Promise<MemoryEntry | undefined> {
  const res = await client.callToolJson<unknown>('memory_get', { memory_id: memoryId });
  return unwrap<MemoryEntry>(res);
}

export async function memoryCreate(
  client: HivekuMcpClient,
  spec: { type?: string; name?: string; domain?: string; content: string; project_id?: string },
): Promise<MemoryEntry | undefined> {
  const res = await client.callToolJson<unknown>('memory_create', spec);
  return unwrap<MemoryEntry>(res);
}

export async function memoryUpdate(client: HivekuMcpClient, memoryId: string, content: string): Promise<unknown> {
  return client.callToolJson<unknown>('memory_update', { memory_id: memoryId, content });
}

export async function memoryDelete(client: HivekuMcpClient, memoryId: string): Promise<unknown> {
  return client.callToolJson<unknown>('memory_delete', { memory_id: memoryId });
}

export interface MemoryVersion {
  /** Snapshot UUID (the route names it version_id; there is no `id` field). */
  version_id?: string;
  version?: number;
  created_at?: string;
  changed_by?: string;
}
export async function memoryVersions(client: HivekuMcpClient, memoryId: string): Promise<MemoryVersion[]> {
  const res = await client.callToolJson<unknown>('memory_list_versions', { memory_id: memoryId });
  const d = unwrap<unknown>(res);
  if (Array.isArray(d)) return d as MemoryVersion[];
  const list = (d as Record<string, unknown>)?.versions;
  return Array.isArray(list) ? (list as MemoryVersion[]) : [];
}

export async function memoryRestoreVersion(client: HivekuMcpClient, versionId: string): Promise<unknown> {
  return client.callToolJson<unknown>('memory_restore_version', { version_id: versionId });
}

export interface KnowledgeBase {
  id?: string;
  name?: string;
  description?: string;
  context_type?: string;
  is_default?: boolean;
  tags?: string[];
  /** Prisma include — the route never returns a flat document_count. */
  _count?: { knowledge_documents?: number; knowledge_sources?: number };
}
export async function kbList(client: HivekuMcpClient): Promise<KnowledgeBase[]> {
  const res = await client.callToolJson<unknown>('kb_list', {});
  const d = unwrap<unknown>(res);
  if (Array.isArray(d)) return d as KnowledgeBase[];
  const list = (d as Record<string, unknown>)?.knowledge_bases ?? (d as Record<string, unknown>)?.kbs;
  return Array.isArray(list) ? (list as KnowledgeBase[]) : [];
}
export async function kbCreate(
  client: HivekuMcpClient,
  spec: { name: string; description?: string; context_type?: string },
): Promise<unknown> {
  return client.callToolJson<unknown>('kb_create', spec);
}
export async function kbDelete(client: HivekuMcpClient, kbId: string): Promise<unknown> {
  return client.callToolJson<unknown>('kb_delete', { kb_id: kbId });
}

export interface DepartmentReply {
  reply: string;
  /** Pass back on the next turn to continue the same conversation. */
  sessionId: string | null;
  /** True when the server refused outright (unknown domain, no access). */
  isError: boolean;
  /**
   * Set when the server returned a reply AND an error together. That happens
   * on the partial-streamError path, where a real but TRUNCATED answer carries
   * the stream fault alongside it — so it must not render as a complete answer.
   * (The mid-stream-stall path returns an empty response, so it lands in the
   * refusal branch above rather than here.)
   */
  warning: string | null;
}

/** Send a message to a department agent. Returns its reply plus session state. */
export async function talkToDepartment(
  client: HivekuMcpClient,
  domain: string,
  message: string,
  sessionId?: string | null,
): Promise<DepartmentReply> {
  // talk_to_department returns brand-aligned content; surface its text. We read
  // the raw tool result so we can fall back to the first text block if the
  // payload isn't a tidy { data } envelope.
  //
  // sessionId is what makes this a conversation. The tool has always accepted
  // it and returns one on every reply, but the client never sent it, so each
  // message opened a fresh session and the panel behaved as a series of
  // one-shots while looking like a chat.
  const args: Record<string, unknown> = { domain, message };
  if (sessionId) args.session_id = sessionId;
  const result = await client.callTool('talk_to_department', args);
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string') return { reply: '(no response)', sessionId: sessionId ?? null, isError: true, warning: null };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const data = (parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed) as Record<string, unknown>;
    const reply =
      (typeof data.reply === 'string' && data.reply) ||
      (typeof data.message === 'string' && data.message) ||
      (typeof data.response === 'string' && data.response) ||
      (typeof data.text === 'string' && data.text) ||
      (typeof data.output === 'string' && data.output);
    // The server reports a refusal as an ordinary result carrying `error`, with
    // none of the reply keys set. Without this the raw JSON error object was
    // rendered into the panel as though the agent had said it.
    const err = typeof data.error === 'string' ? data.error : null;
    const nextSession = typeof data.session_id === 'string' ? data.session_id : null;
    // Any empty reply is a failure, whether or not the server named an error.
    // `error` is spread CONDITIONALLY server-side, so a turn that produced only
    // tool calls and no content event comes back as
    // { response: "", tool_calls: [...] } with no error key at all. Testing
    // `!reply && err` let that fall through to `reply || text` and posted the
    // raw JSON blob into the panel as though the agent had said it — the exact
    // thing this was meant to stop.
    if (!reply) {
      return {
        reply: err ?? 'The department returned no answer (it may have run tools without replying). Try rephrasing.',
        sessionId: nextSession ?? sessionId ?? null,
        isError: true,
        warning: null,
      };
    }
    // reply AND error together = a real but truncated answer (agent stalled or
    // the stream errored part-way). Surfacing only the reply would present a
    // half-answer as complete, which is worse than showing nothing.
    return {
      reply: reply || text,
      sessionId: nextSession ?? sessionId ?? null,
      isError: false,
      warning: reply && err ? err : null,
    };
  } catch {
    return { reply: text, sessionId: sessionId ?? null, isError: false, warning: null }; // already plain text
  }
}
