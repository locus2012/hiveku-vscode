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

export async function listProjects(client: HivekuMcpClient): Promise<ProjectSummary[]> {
  const res = await client.callToolJson<unknown>('list_projects', {});
  const list = unwrap<ProjectSummary[]>(res);
  return Array.isArray(list) ? list : [];
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
