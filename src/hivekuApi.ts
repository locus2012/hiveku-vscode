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
}

export interface BranchRef {
  branch_name: string;
  head_commit_id: string | null;
  is_default: boolean;
}

export interface CheckoutTree {
  branch_name: string;
  files: Array<{ path: string; content: string; encoding: 'utf-8' | 'base64' }>;
}

export interface MergeResult {
  merged_branch: string;
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
  error?: string;
}

function unwrap<T>(payload: unknown): T {
  // Most Olympus tools wrap their result in { data: ... }.
  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
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

/** Returns a short-lived signed S3 URL for the project's tarball. */
export async function snapshotUrl(
  client: HivekuMcpClient,
  projectId: string,
  includeAssets: boolean,
): Promise<{ download_url: string; file_count: number; compression: 'gzip' | 'none' }> {
  const res = await client.callToolJson<unknown>('project_files_snapshot', {
    project_id: projectId,
    include_assets: includeAssets,
    compress: 'gzip',
  });
  return unwrap(res);
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

export async function vcsCommit(
  client: HivekuMcpClient,
  projectId: string,
  message: string,
  files: CommitFile[],
  deletedFiles: string[],
  branch?: string,
): Promise<CommitSummary> {
  const res = await client.callToolJson<unknown>('project_vcs_commit', {
    project_id: projectId,
    message,
    files,
    deletedFiles,
    ...(branch && branch !== 'main' ? { branch } : {}),
  });
  return unwrap<CommitSummary>(res);
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
): Promise<BulkSaveResult> {
  const res = await client.callToolJson<unknown>('project_files_bulk_save', {
    project_id: projectId,
    files: files.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding })),
    ...(message ? { commit_message: message } : {}),
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
  };
}

/** Soft-delete a single file (tombstone — is_current flipped to false). */
export async function fileDelete(client: HivekuMcpClient, projectId: string, filePath: string): Promise<void> {
  await client.callToolJson<unknown>('project_file_delete', { project_id: projectId, file_path: filePath });
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
): Promise<MergeResult> {
  const res = await client.callToolJson<unknown>('project_vcs_merge', {
    project_id: projectId,
    branch,
    ...(message ? { message } : {}),
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

export async function vcsHistory(
  client: HivekuMcpClient,
  projectId: string,
  limit = 100,
): Promise<CommitSummary[]> {
  const res = await client.callToolJson<unknown>('project_vcs_history', {
    project_id: projectId,
    limit,
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

export async function deploySite(
  client: HivekuMcpClient,
  projectId: string,
  environment: 'development' | 'staging' | 'production',
): Promise<{ deployment_id?: string; status?: string }> {
  const res = await client.callToolJson<unknown>('deploy_site', {
    project_id: projectId,
    environment,
    agent_codename: 'vscode-ext',
  });
  return unwrap(res);
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
  const res = await client.callToolJson<unknown>('project_secrets_list', { project_id: projectId });
  const d = unwrap<Record<string, unknown>>(res) ?? {};
  const secrets = (d.secrets && typeof d.secrets === 'object' ? d.secrets : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(secrets)) out[k] = v == null ? '' : String(v);
  return out;
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

/** Send a message to a department agent and return its reply text. */
export async function talkToDepartment(
  client: HivekuMcpClient,
  domain: string,
  message: string,
): Promise<string> {
  // talk_to_department returns brand-aligned content; surface its text. We read
  // the raw tool result so we can fall back to the first text block if the
  // payload isn't a tidy { data } envelope.
  const result = await client.callTool('talk_to_department', { domain, message });
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string') return '(no response)';
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const data = (parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed) as Record<string, unknown>;
    const reply =
      (typeof data.reply === 'string' && data.reply) ||
      (typeof data.message === 'string' && data.message) ||
      (typeof data.response === 'string' && data.response) ||
      (typeof data.text === 'string' && data.text) ||
      (typeof data.output === 'string' && data.output);
    return reply || text;
  } catch {
    return text; // already plain text
  }
}
