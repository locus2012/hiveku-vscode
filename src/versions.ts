/**
 * Versions you can roll back: the extension's side of the builder contract.
 *
 * "Your site" (main) now saves versions: a no-files project_vcs_commit on main
 * PROMOTES everything live that is not a version yet into one version, a
 * rollback writes a NEW version equal to an old one (append-only, undoable),
 * and a rollback is a dry run unless `dry_run: false` is sent. This module is
 * the pure half of that: capability detection, the new tool wrappers, the
 * paged checkout, and every sentence a person reads about versions. The VS
 * Code dialogs that use it live in versionFlows.ts.
 *
 * Pure on purpose: no `vscode` import, erasable TypeScript only, so
 * scripts/check-vcs-helpers.mjs and test/versions.test.mjs load it directly.
 *
 * Old servers. Every behaviour here is gated on serverCaps(): a server
 * without project_vcs_status / project_vcs_rollback in tools/list gets
 * exactly what the extension did before (no promote on main, checkpoint
 * revert on main, no deploy gate, no dirty indicator).
 *
 * Contract: notes/DESIGN-versions-and-rollback-2026-09-24.md Part 2 section D,
 * as implemented on the builder's feature/versions-core branch.
 */

import * as api from './hivekuApi';
import type { HivekuMcpClient } from './mcpClient';
import type { CommitFile } from './workspace';
import { describeChanges, isPlainVersionName, versionNameProblem, type ChangeLists } from './versionName';

// ── Capabilities ──────────────────────────────────────────────────────────────

export interface VersionCaps {
  /** project_vcs_status exists: main saves versions (promote), the deploy gate and dirty indicator work. */
  status: boolean;
  /** project_vcs_rollback exists (and this key may call it): go back to any version, main included. */
  rollback: boolean;
}

export const NO_VERSION_CAPS: VersionCaps = Object.freeze({ status: false, rollback: false });

/** Caps from a tools/list answer. Exact names only: never a prefix match. */
export function capsFromToolNames(names: Iterable<string>): VersionCaps {
  const have = new Set(names);
  return { status: have.has('project_vcs_status'), rollback: have.has('project_vcs_rollback') };
}

const capsCache = new WeakMap<object, Promise<VersionCaps>>();

/**
 * What this client's server supports, asked once per client (tools/list is the
 * whole registry). A reconnect makes a new client and so asks again. A failed
 * tools/list is not remembered: the answer is "nothing new" for this call and
 * the next call asks again, so a network blip never disables versions for a
 * whole session.
 */
export async function serverCaps(client: HivekuMcpClient): Promise<VersionCaps> {
  const lister = (client as unknown as { listToolNames?: () => Promise<string[]> }).listToolNames;
  if (typeof lister !== 'function') return NO_VERSION_CAPS;
  let pending = capsCache.get(client);
  if (!pending) {
    pending = lister.call(client).then(capsFromToolNames);
    capsCache.set(client, pending);
  }
  try {
    return await pending;
  } catch {
    if (capsCache.get(client) === pending) capsCache.delete(client);
    return NO_VERSION_CAPS;
  }
}

// ── Route errors ──────────────────────────────────────────────────────────────

export interface RouteError {
  status?: number;
  code?: string;
  /** The route's own `error` sentence. */
  message: string;
  /** The route's body ({ error, code, ...extras }). */
  body: Record<string, unknown>;
}

/**
 * The builder route's refusal inside a tool error. The MCP proxy answers a
 * route failure as `{ error, status, details: <route body> }`; a direct body
 * carries `code` at the top. undefined when `err` is not a tool refusal.
 */
export function routeErrorOf(err: unknown): RouteError | undefined {
  const payload = (err as { payload?: unknown } | null | undefined)?.payload;
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const body = p.details && typeof p.details === 'object' && !Array.isArray(p.details)
    ? (p.details as Record<string, unknown>)
    : p;
  const code = typeof body.code === 'string' ? body.code : typeof p.code === 'string' ? p.code : undefined;
  const status = typeof p.status === 'number' ? p.status : typeof body.status === 'number' ? body.status : undefined;
  const message = typeof body.error === 'string' ? body.error : typeof p.error === 'string' ? p.error : String((err as Error)?.message ?? '');
  return { status, code, message, body };
}

/**
 * A failure in words a person can read: the route's own sentence when there is
 * one, never the "Tool x failed (409): …" wrapper or the JSON tail the MCP
 * client appends, and a plain sentence for a timeout.
 */
export function plainErrorMessage(err: unknown): string {
  const route = routeErrorOf(err);
  if (route?.message && !/^Tool \S+ (?:failed|errored)/.test(route.message)) return route.message;
  const raw = err instanceof Error ? err.message : String(err);
  if (/timed out/i.test(raw)) return 'Hiveku did not answer in time.';
  return raw.replace(/^Tool \S+ (?:failed \(\d+\)|errored): /, '').replace(/ — \{.*$/s, '');
}

/**
 * Rollback refusals that mean the route stopped before writing anything. Any
 * other failure of an APPLY (no answer at all, a 5xx, rollback_incomplete, a
 * call still running under the same idempotency key) may have moved Hiveku.
 */
const ROLLBACK_REFUSALS: ReadonlySet<string> = new Set([
  'branch_changed',
  'ai_turn_running',
  'not_in_history',
  'commit_not_found',
  'content_unavailable',
  'branch_busy',
  'expected_head_required',
  'stash_branch_readonly',
  'content_too_large',
  'branch_tree_unavailable',
  'branch_missing',
  'branch_tree_missing',
  'invalid_request',
  'invalid_branch',
]);

/**
 * True when a failed rollback APPLY may still have changed Hiveku, so "nothing
 * was changed" cannot be said: the client gave up waiting (the MCP call is
 * capped at the edge's ~135 s while the route may run 300 s), the network
 * dropped, the server answered 5xx, or it said rollback_incomplete (files WERE
 * written) or idempotency_pending (the same apply is still running).
 */
export function rollbackMayHaveLanded(err: unknown): boolean {
  const route = routeErrorOf(err);
  if (!route) return true;
  if (route.code === 'rollback_incomplete' || route.code === 'idempotency_pending') return true;
  if (route.code && ROLLBACK_REFUSALS.has(route.code)) return false;
  return route.status === undefined || route.status >= 500;
}

// ── Status ────────────────────────────────────────────────────────────────────

export interface LatestChanges {
  state: 'none' | 'editing' | 'pending';
  since: string | null;
  summary: string | null;
  /** Customer-visible files only (so uncommitted:true with files:0 happens). */
  files: number;
}

export interface LiveTier {
  commit_id: string | null;
  commit_name: string | null;
  branch: string | null;
  deployed_at: string | null;
  basis: string;
}

export interface VcsStatus {
  branch: string;
  head_commit_id: string | null;
  /** false also means UNKNOWN when uncommitted_reason is 'unknown'. */
  uncommitted: boolean;
  uncommitted_reason: 'changed' | 'legacy_head' | 'no_version_yet' | 'working_tree' | 'unknown' | null;
  latest_changes: LatestChanges | null;
  working_tree_etag: string | null;
  /** With detail=files only; null = unknown (never [] for unknown). */
  changed_files?: Array<{ path: string; status: 'added' | 'modified' | 'removed' }> | null;
  last_version: { id: string; message: string; source: string | null; created_at: string } | null;
  live?: { production: LiveTier | null; staging: LiveTier | null; development: LiveTier | null };
}

/** GET project_vcs_status. Read-only; never versions anything. */
export async function vcsStatus(
  client: HivekuMcpClient,
  projectId: string,
  branch?: string,
  opts: { files?: boolean } = {},
): Promise<VcsStatus> {
  const res = await client.callToolJson<unknown>('project_vcs_status', {
    project_id: projectId,
    ...api.branchArg(branch),
    ...(opts.files ? { detail: 'files' } : {}),
  });
  const d = (res && typeof res === 'object' && 'data' in (res as object) ? (res as { data: unknown }).data : res) as
    | Partial<VcsStatus>
    | null
    | undefined;
  const data = d ?? {};
  return {
    branch: typeof data.branch === 'string' ? data.branch : (branch || 'main'),
    head_commit_id: typeof data.head_commit_id === 'string' ? data.head_commit_id : null,
    uncommitted: data.uncommitted === true,
    uncommitted_reason: data.uncommitted_reason ?? null,
    latest_changes: data.latest_changes ?? null,
    working_tree_etag: typeof data.working_tree_etag === 'string' ? data.working_tree_etag : null,
    changed_files: Array.isArray(data.changed_files) ? data.changed_files : data.changed_files === undefined ? undefined : null,
    last_version: data.last_version ?? null,
    live: data.live,
  };
}

/**
 * Only the assistant's notes changed since the last version (contract 1.2:
 * uncommitted with files:0 counts customer-visible files only). Nothing a
 * person would recognise changed, so no modal and no dot for it. A legacy head
 * or a site with no version yet still reads as needing one.
 */
export function onlyNotesChanged(status: Pick<VcsStatus, 'uncommitted' | 'uncommitted_reason' | 'latest_changes'>): boolean {
  return status.uncommitted && status.uncommitted_reason === 'changed' && status.latest_changes?.files === 0;
}

/** Hiveku holds changes a person would recognise that are not a version yet. */
export function needsVersion(status: Pick<VcsStatus, 'uncommitted' | 'uncommitted_reason' | 'latest_changes'>): boolean {
  return status.uncommitted && !onlyNotesChanged(status);
}

/** A name to offer for what status reports as not yet a version, or '' when none reads plainly. */
export function suggestedNameFromStatus(status: VcsStatus): string {
  const files = status.changed_files;
  if (Array.isArray(files) && files.length > 0) {
    const lists: { added: string[]; modified: string[]; removed: string[] } = { added: [], modified: [], removed: [] };
    for (const f of files) {
      if (f.status === 'added') lists.added.push(f.path);
      else if (f.status === 'removed') lists.removed.push(f.path);
      else lists.modified.push(f.path);
    }
    const name = describeChanges(lists);
    if (isPlainVersionName(name) && name !== 'No changes') return name;
  }
  const summary = status.latest_changes?.summary?.trim() ?? '';
  return summary && isPlainVersionName(summary) ? summary : '';
}

// ── Saving a version (promote) ─────────────────────────────────────────────────

export type SaveVersionResult =
  | { outcome: 'saved'; commit: api.CommitSummary }
  /** 409 nothing_to_commit: everything is already a version. Not an error. */
  | { outcome: 'nothing'; latestVersion: { id?: string; message?: string; created_at?: string } | null }
  /** main on a server without versions on main: nothing was sent. */
  | { outcome: 'unsupported' };

/**
 * Save everything on `branch` that is not a version yet as ONE version named
 * `name` (a no-files project_vcs_commit). On main this needs caps.status (an
 * old server refuses a no-files commit on main), so without it nothing is sent.
 * A branch promote works on every server. The name must already be plain
 * (versionNameProblem): the server keeps a VS Code name exactly as sent.
 */
export async function saveVersion(
  client: HivekuMcpClient,
  projectId: string,
  name: string,
  branch: string | undefined,
  caps: VersionCaps,
): Promise<SaveVersionResult> {
  const onMain = !('branch' in api.branchArg(branch));
  if (onMain && !caps.status) return { outcome: 'unsupported' };
  return commitVersion(client, projectId, name, [], [], branch, caps);
}

/**
 * project_vcs_commit, with or without files, where 409 nothing_to_commit is a
 * RESULT ("already a version"), not an error (design D1, contract 1.1). With
 * files it happens when every file sent is already the live content and
 * nothing else is pending. The name must be plain: the server keeps a VS Code
 * name exactly as sent.
 */
export async function commitVersion(
  client: HivekuMcpClient,
  projectId: string,
  name: string,
  files: CommitFile[],
  deletedFiles: string[],
  branch: string | undefined,
  caps: VersionCaps,
): Promise<Exclude<SaveVersionResult, { outcome: 'unsupported' }>> {
  const problem = versionNameProblem(name);
  if (problem) throw new Error(problem);
  try {
    const commit = await api.vcsCommit(client, projectId, name.trim(), files, deletedFiles, branch, {
      ...(caps.status ? { source: 'vscode' as const } : {}),
      allowEmptyMain: caps.status,
    });
    return { outcome: 'saved', commit };
  } catch (err) {
    const route = routeErrorOf(err);
    if (route?.code === 'nothing_to_commit') {
      const latest = route.body.latest_version;
      return {
        outcome: 'nothing',
        latestVersion: latest && typeof latest === 'object' ? (latest as { id?: string; message?: string; created_at?: string }) : null,
      };
    }
    throw err;
  }
}

// ── Checkout, paged ───────────────────────────────────────────────────────────

/** Files per checkout page (the route's maximum). A page also stops at 16 MB. */
export const CHECKOUT_PAGE_FILES = 2000;
/** Upper bound on pages in one read, so a server that never ends paging cannot spin forever. */
export const CHECKOUT_MAX_PAGES = 5000;
const CHECKOUT_ATTEMPTS = 3;

/** Your site (or a branch) is too big to send in one answer and the answer could not be paged. */
export class SiteTooLargeError extends Error {
  readonly totalBytes: number | undefined;
  constructor(message: string, totalBytes?: number) {
    super(message);
    this.name = 'SiteTooLargeError';
    this.totalBytes = totalBytes;
  }
}

/**
 * The WHOLE tree of `branch` (Your site for main), read in pages of `limit` +
 * `cursor`. Callers materialize it and delete local files it lacks, so it must
 * be complete:
 * - a branch whose working_tree_etag changes between pages was saved to
 *   mid-read: the read starts over (the etag names the tree each page came from);
 * - Your site is re-listed per page (no snapshot), so a file count that does
 *   not match `total_files` means it changed mid-read: the read starts over,
 *   and after the last attempt the tree is returned as read (an unpaged answer
 *   would have had the same gap), with `onNote` told;
 * - a cursor that does not move is refused (a server that drops `cursor`
 *   would otherwise answer page one forever).
 * A server that does not page (old builder, or an MCP that drops `limit`)
 * answers the whole tree with no next_cursor, which ends the loop after one
 * answer. A site over 150 MB on such a server answers 413 content_too_large:
 * that becomes a SiteTooLargeError with a plain sentence.
 */
export async function checkoutTree(
  client: HivekuMcpClient,
  projectId: string,
  branch: string,
  opts: { pageFiles?: number; onPage?: (filesSoFar: number, totalFiles?: number) => void; onNote?: (note: string) => void } = {},
): Promise<api.CheckoutTree> {
  const limit = opts.pageFiles ?? CHECKOUT_PAGE_FILES;
  const onMain = !branch || branch === 'main';
  let lastRead: api.CheckoutTree | undefined;
  for (let attempt = 1; attempt <= CHECKOUT_ATTEMPTS; attempt++) {
    const files = new Map<string, api.CheckoutTree['files'][number]>();
    let first: api.CheckoutTree | undefined;
    let last: api.CheckoutTree | undefined;
    let cursor: string | null = null;
    const cursors = new Set<string>();
    let restart = false;
    for (let page = 0; ; page++) {
      if (page >= CHECKOUT_MAX_PAGES) throw new Error(`Stopped reading after ${CHECKOUT_MAX_PAGES} pages; the tree never ended.`);
      let answer: api.CheckoutTree;
      try {
        answer = await api.vcsCheckout(client, projectId, branch, { limit, cursor });
      } catch (err) {
        throw tooLargeOr(err, onMain);
      }
      if (!first) first = answer;
      else if (!onMain && (answer.working_tree_etag ?? null) !== (first.working_tree_etag ?? null)) {
        restart = true;
        break;
      }
      for (const f of Array.isArray(answer.files) ? answer.files : []) files.set(f.path, f);
      last = answer;
      opts.onPage?.(files.size, typeof answer.total_files === 'number' ? answer.total_files : undefined);
      const next = typeof answer.next_cursor === 'string' && answer.next_cursor ? answer.next_cursor : null;
      if (!next) break;
      if (next === cursor || cursors.has(next)) {
        throw new Error('The server kept sending the same part of the files; stopped so nothing is lost. Try again later.');
      }
      cursors.add(next);
      cursor = next;
    }
    if (restart || !first || !last) {
      opts.onNote?.(`"${branch}" changed while it was downloading; reading it again.`);
      continue;
    }
    const tree: api.CheckoutTree = {
      branch_name: first.branch_name ?? branch,
      files: [...files.values()],
      head_commit_id: last.head_commit_id ?? first.head_commit_id ?? null,
      working_tree_etag: first.working_tree_etag ?? null,
      uncommitted: first.uncommitted,
    };
    lastRead = tree;
    const expected = last.total_files;
    if (typeof expected === 'number' && expected !== files.size) {
      opts.onNote?.(`Read ${files.size} of ${expected} files of ${onMain ? 'Your site' : `"${branch}"`}; it changed while downloading.`);
      if (attempt < CHECKOUT_ATTEMPTS) continue;
    }
    return tree;
  }
  if (lastRead) return lastRead;
  throw new Error(`"${branch}" kept changing while it was downloading. Nothing was changed here; try again in a moment.`);
}

function tooLargeOr(err: unknown, onMain: boolean): unknown {
  const route = routeErrorOf(err);
  if (route?.code !== 'content_too_large') return err;
  const bytes = typeof route.body.total_bytes === 'number' ? route.body.total_bytes : undefined;
  const mb = bytes ? ` (about ${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB)` : '';
  const what = onMain ? 'Your site' : 'This branch';
  return new SiteTooLargeError(
    `${what} is too big to download in one go${mb}, and this Hiveku server cannot send it in parts yet. ` +
      'Nothing was changed. Reload the window, or use Reconnect Hiveku when it is offered, then try again.',
    bytes,
  );
}

// ── Rollback ──────────────────────────────────────────────────────────────────

export interface VersionRef {
  id: string;
  name: string | null;
  created_at?: string;
}

export interface RollbackDryRun {
  dry_run: true;
  branch: string;
  head_commit_id: string | null;
  /** main only: pass back as expected_live_fingerprint. */
  live_fingerprint: string | null;
  target: VersionRef;
  noop: boolean;
  changes: {
    files: { changed: number; removed: number; added_back: number };
    entries?: Array<{ path: string; status: 'changed' | 'removed' | 'added_back' }>;
    truncated?: boolean;
    pages?: Array<{ label: string; route?: string; kind?: string; status: string; paths: string[] }>;
    hidden?: number;
  };
  auto_version: { will_create: boolean; name: string } | null;
  versions_undone: { count: number; newest: VersionRef[] };
  assets_affected: boolean | null;
  live_includes_undone_work: boolean | null;
  bound_environments?: string[];
  skipped?: { server_managed?: number; shared_assets?: string[] };
  ai_turn_running: boolean;
}

export interface RollbackApplied {
  dry_run: false;
  version: { id: string; name: string; created_at?: string } | null;
  auto_version: { id: string; name: string } | null;
  branch: { name: string; head_commit_id: string | null };
  noop: boolean;
  concurrent_edits?: string[];
  target: VersionRef;
}

export interface RollbackRequest {
  commitId: string;
  branch?: string;
  dryRun: boolean;
  /** REQUIRED to apply on main: the dry run's head_commit_id. */
  expectedHeadCommitId?: string | null;
  /** main, optional: the dry run's live_fingerprint (tolerates automatic saves in between). */
  expectedLiveFingerprint?: string | null;
  /** The new version's name; the server names it "Rolled back to ..." when absent. */
  name?: string;
}

/**
 * POST project_vcs_rollback. `dry_run` is ALWAYS sent explicitly (the route
 * treats anything but a literal false as a dry run, and so does this call's
 * type). Applying on main without the dry run's head is refused HERE, before
 * anything is sent, as the route would refuse it (expected_head_required).
 * Rollback never deploys: updating the live site is a separate deploy call.
 */
export async function vcsRollback(client: HivekuMcpClient, projectId: string, req: RollbackRequest & { dryRun: true }): Promise<RollbackDryRun>;
export async function vcsRollback(client: HivekuMcpClient, projectId: string, req: RollbackRequest & { dryRun: false }): Promise<RollbackApplied>;
export async function vcsRollback(client: HivekuMcpClient, projectId: string, req: RollbackRequest): Promise<RollbackDryRun | RollbackApplied> {
  const onMain = !('branch' in api.branchArg(req.branch));
  if (!req.dryRun && onMain && !req.expectedHeadCommitId) {
    // Shaped like the route's own refusal so rollbackErrorMessage words it
    // (and rollbackMayHaveLanded knows nothing was sent).
    const refused = new Error('Going back needs the preview step first. Nothing was changed.') as Error & { payload: unknown };
    refused.payload = { error: 'Going back needs the preview step first. Nothing was changed.', code: 'expected_head_required' };
    throw refused;
  }
  const res = await client.callToolJson<unknown>('project_vcs_rollback', {
    project_id: projectId,
    commit_id: req.commitId,
    dry_run: req.dryRun === false ? false : true,
    ...api.branchArg(req.branch),
    ...(!req.dryRun && req.expectedHeadCommitId ? { expected_head_commit_id: req.expectedHeadCommitId } : {}),
    ...(!req.dryRun && onMain && req.expectedLiveFingerprint ? { expected_live_fingerprint: req.expectedLiveFingerprint } : {}),
    ...(!req.dryRun && req.name ? { message: req.name } : {}),
  });
  const data = res && typeof res === 'object' && 'data' in (res as object) ? (res as { data: unknown }).data : res;
  return data as RollbackDryRun | RollbackApplied;
}

// ── Words a person reads ──────────────────────────────────────────────────────

/** How a branch is named to a person: main is "Your site (main)". */
export function branchLabel(branch?: string | null): string {
  const b = (branch ?? '').trim();
  return !b || b === 'main' ? 'Your site (main)' : `"${b}"`;
}

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  ai_turn: 'AI request',
  editor_idle: 'Saved automatically',
  deploy: 'Saved when published',
  mcp: 'Agent or API',
  vscode: 'VS Code',
  sync_cli: 'Hiveku sync',
  rollback: 'Went back',
  merge: 'Merge',
  manual: 'Dashboard',
  github: 'GitHub',
};

/** Who saved a version, in words; undefined for an unknown or missing source. */
export function sourceLabel(source: unknown): string | undefined {
  return typeof source === 'string' ? SOURCE_LABELS[source] : undefined;
}

/** A history entry as the builder now sends it (older servers omit the new fields). */
export interface VersionEntry extends api.CommitSummary {
  source?: string | null;
  live_on?: string[];
  rolled_back_to?: { id: string; name: string | null } | null;
  /** false: this version's files cannot be read back (a checkpoint-era version with no manifest); never offered. */
  restorable?: boolean;
  restore_blocked_reason?: string | null;
}

/** Versions per history page for the go-back picker. */
export const HISTORY_PAGE = 100;

/**
 * One page of project_vcs_history for one branch, newest first. `nextBefore`
 * is the cursor for the next (older) page, or null when there is none: the
 * route's meta.truncated also says true on the last page (contract 1.4), so
 * paging stops on an empty page or one shorter than `limit`.
 */
export async function versionHistoryPage(
  client: HivekuMcpClient,
  projectId: string,
  branch: string,
  opts: { limit?: number; before?: string | null } = {},
): Promise<{ entries: VersionEntry[]; nextBefore: string | null }> {
  const limit = opts.limit ?? HISTORY_PAGE;
  const res = await client.callToolJson<unknown>('project_vcs_history', {
    project_id: projectId,
    limit,
    branch,
    ...(opts.before ? { before: opts.before } : {}),
  });
  const body = res && typeof res === 'object' ? (res as { data?: unknown; meta?: { nextBefore?: unknown } }) : {};
  const list = Array.isArray(body.data) ? body.data : Array.isArray(res) ? (res as unknown[]) : [];
  const entries = list.filter((e): e is VersionEntry => !!e && typeof e === 'object' && typeof (e as VersionEntry).id === 'string');
  const cursor = typeof body.meta?.nextBefore === 'string' && body.meta.nextBefore ? body.meta.nextBefore : null;
  const nextBefore = list.length === 0 || list.length < limit || cursor === opts.before ? null : cursor;
  return { entries, nextBefore };
}

/** Versions the go-back picker offers: this branch's, not the current one, and only ones whose files can be read back. */
export function goBackTargets(entries: VersionEntry[], branch: string, head: string | null): VersionEntry[] {
  return entries.filter((c) => c.branch_name === branch && c.id !== head && c.restorable !== false);
}

/** Picker row for a version: `name · who · when`, never a checkpoint hash. */
export function versionPickItem(entry: VersionEntry): { label: string; description: string; detail?: string } {
  const who = sourceLabel(entry.source);
  const when = entry.created_at ? new Date(entry.created_at).toLocaleString() : '';
  const live = Array.isArray(entry.live_on) && entry.live_on.length > 0 ? `Live on ${entry.live_on.join(', ')}` : undefined;
  return {
    label: (entry.message ?? '').trim() || 'Untitled version',
    description: [who, when].filter(Boolean).join(' · '),
    ...(live ? { detail: live } : {}),
  };
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The lines of the "Go back?" modal, built from the dry run. Plain words; never a path. */
export function rollbackPlanLines(dry: RollbackDryRun): string[] {
  const lines: string[] = [];
  const f = dry.changes?.files ?? { changed: 0, removed: 0, added_back: 0 };
  const parts: string[] = [];
  if (f.changed) parts.push(`${count(f.changed, 'file goes', 'files go')} back to how ${f.changed === 1 ? 'it was' : 'they were'}`);
  if (f.removed) parts.push(`${count(f.removed, 'file', 'files')} added since then ${f.removed === 1 ? 'is' : 'are'} removed`);
  if (f.added_back) parts.push(`${count(f.added_back, 'file', 'files')} removed since then ${f.added_back === 1 ? 'comes' : 'come'} back`);
  if (parts.length) lines.push(parts.join('; ') + '.');
  const pages = (dry.changes?.pages ?? []).map((p) => p.label).filter((l) => typeof l === 'string' && l.trim());
  if (pages.length) {
    const shown = pages.slice(0, 5).join(', ');
    lines.push(`Pages: ${shown}${pages.length > 5 ? ` and ${pages.length - 5} more` : ''}.`);
  }
  if (!parts.length && (dry.changes?.hidden ?? 0) > 0) lines.push("Only the assistant's notes change.");
  const undone = dry.versions_undone?.count ?? 0;
  if (undone > 0) {
    const names = (dry.versions_undone.newest ?? []).map((v) => v.name).filter((n): n is string => !!n).map((n) => `"${n}"`);
    lines.push(
      `${count(undone, 'newer version is', 'newer versions are')} undone${names.length ? ` (${names.join(', ')}${undone > names.length ? ', …' : ''})` : ''}. ` +
        'They stay in History, so you can go forward again.',
    );
  }
  if (dry.auto_version?.will_create) {
    lines.push(`Changes that aren't a version yet are saved first as "${dry.auto_version.name}", so nothing is lost.`);
  }
  if (dry.assets_affected || (dry.skipped?.shared_assets?.length ?? 0) > 0) {
    lines.push('Images in the shared image library are not changed.');
  }
  if (dry.live_includes_undone_work) {
    lines.push('The live site still shows the newer work until it is updated.');
  }
  return lines;
}

/** One sentence for a refused rollback (dry run or apply), keyed on the route's code. */
export function rollbackErrorMessage(err: unknown): string {
  const route = routeErrorOf(err);
  switch (route?.code) {
    case 'branch_changed':
      return 'Someone changed this while you were looking. Nothing was changed. Try again to see the latest.';
    case 'ai_turn_running':
      return 'The AI is working on this site right now. Nothing was changed. Try again when it has finished.';
    case 'not_in_history':
      return "That version isn't part of this history, so it can't be gone back to here. Nothing was changed.";
    case 'commit_not_found':
      return "That version wasn't found. Nothing was changed.";
    case 'content_unavailable':
      return "That version's files can't be read any more. Nothing was changed. Project history in the Hiveku dashboard can restore it from its saved copy.";
    case 'rollback_incomplete':
      return 'Some files went back but not all of them. Run Go Back again to finish.';
    case 'branch_tree_unavailable':
      return "Hiveku couldn't read the files just now. Nothing was changed. Try again in a minute.";
    case 'content_too_large':
      return route.message || 'This version is too large to go back to here. Nothing was changed.';
    case 'branch_busy':
      return 'Another change is being saved right now. Nothing was changed. Try again in a moment.';
    case 'stash_branch_readonly':
      return 'Moved-aside work cannot be rolled back. Nothing was changed.';
    case 'expected_head_required':
      return 'Going back needs the preview step first. Nothing was changed. Try again.';
    default:
      return plainErrorMessage(err);
  }
}

/**
 * After "Go back and update live site": what to say about the deploy. Only a
 * deploy that reports shipping the version the rollback made (deploy_site's
 * vcs_commit_id) is "updating"; otherwise its own note is relayed (a pin that
 * failed says the publish is not linked to a version), or a plain caution (a
 * GitHub-connected project ships the GitHub tree, not Your site).
 */
export function liveUpdateSentence(
  res: { note?: string; vcs_commit_id?: string | null },
  expectedVersionId: string | null | undefined,
): string {
  if (expectedVersionId && res.vcs_commit_id === expectedVersionId) return 'The live site is updating.';
  const note = typeof res.note === 'string' ? res.note.trim() : '';
  if (note) return note;
  return 'A deploy started, but Hiveku did not confirm it ships the version you went back to. Check the live site once it finishes.';
}

/**
 * The line after a push that was not saved as a version (Escape, "never", or
 * a save that failed). Only promises that hold today: saving by hand, and on
 * Your site the version a production publish saves first (deploy pin).
 */
export function notVersionedYetSentence(branch: string | undefined): string {
  const onMain = !('branch' in api.branchArg(branch));
  return onMain
    ? 'Save one any time with Hiveku: Save a Version; publishing Your site to production also saves it first.'
    : 'Save one any time with Hiveku: Save a Version.';
}

/**
 * What the Commit button says when this folder has nothing to send.
 * - clean: Hiveku said everything is a version;
 * - notes: only the assistant's notes changed since the last version;
 * - unknown: Hiveku could not say (the status read failed);
 * - unsupported: an older server (no project_vcs_status), which cannot say.
 */
export type NothingToSend = 'clean' | 'notes' | 'unknown' | 'unsupported';

export function nothingToSaveMessage(why: NothingToSend): string {
  switch (why) {
    case 'clean':
      return 'Nothing to save: this folder matches Hiveku and everything is already a version.';
    case 'notes':
      return "Nothing to save: this folder matches Hiveku. Only the assistant's notes changed since the last version.";
    case 'unknown':
      return 'Nothing to save from this folder: it matches Hiveku. Hiveku could not say whether everything is a version yet; try again in a moment.';
    default:
      return 'Nothing to save: this folder matches Hiveku.';
  }
}

/** The tree a deploy of `tier` ships: main for production and unbound tiers, else the bound branch; null when unknown. */
export function treeThatShips(
  tier: 'development' | 'staging' | 'production',
  bindings: api.EnvBindings | null | undefined,
): string | null {
  if (tier === 'production') return 'main';
  const b = bindings?.[tier];
  if (!b) return null;
  return b.bound && b.branch && b.branch !== 'main' ? b.branch : 'main';
}

/** What to tell a person about the version a deploy shipped (deploy_site's version fields). */
export function deployVersionSentence(res: { note?: string; promoted_commit_id?: string | null; vcs_commit_id?: string | null }): string {
  if (res.note && res.note.trim()) return '';
  if (res.promoted_commit_id) return 'Your latest changes were saved as a version before publishing.';
  return '';
}

// ── Push, then version ────────────────────────────────────────────────────────

export type PushVersionMode = 'ask' | 'auto' | 'never';

/** The hiveku.push.saveVersion setting, defaulting to 'ask' for anything unexpected. */
export function readPushVersionMode(raw: unknown): PushVersionMode {
  return raw === 'auto' || raw === 'never' ? raw : 'ask';
}

/**
 * The name for a version after a push: what the person typed in the Source
 * Control box when it reads plainly, else a name made from what changed.
 * `typed` is returned separately so an "ask" prompt can prefill it even when
 * it is not plain yet (the prompt then says why).
 */
export function pushVersionName(changes: ChangeLists, inputValue: string | undefined): { name: string; typed: string } {
  const typed = (inputValue ?? '').trim();
  if (typed && isPlainVersionName(typed)) return { name: typed, typed };
  return { name: describeChanges(changes), typed };
}

// ── Status bar ────────────────────────────────────────────────────────────────

export interface RemoteDirty {
  /** Changes a person would recognise that are not a version yet (needsVersion: notes-only is not dirty). */
  uncommitted: boolean;
  files?: number;
}

/** The branch status bar: text, tooltip and click command for a folder's branch and its dirty state. */
export function branchBarState(
  branch: string,
  localChanges: number,
  remote: RemoteDirty | undefined,
): { text: string; tooltip: string; command: string } {
  const onMain = !branch || branch === 'main';
  const name = onMain ? 'Your site (main)' : branch;
  const remoteDirty = remote?.uncommitted === true;
  const dirty = localChanges > 0 || remoteDirty;
  const text = `$(git-branch) ${name}${dirty ? ' $(circle-filled)' : ''}`;
  if (!dirty) {
    return {
      text,
      tooltip: onMain
        ? 'Hiveku: Your site (main), what the live site is published from. Click to switch branch.'
        : `Hiveku branch: ${branch} (off to the side; Your site is untouched until merged). Click to switch branch.`,
      command: 'hiveku.switchBranch',
    };
  }
  const bits: string[] = [];
  if (localChanges > 0) bits.push(`${count(localChanges, 'local change', 'local changes')}`);
  if (remoteDirty) bits.push('changes on Hiveku not yet a version');
  return { text, tooltip: `${bits.join(' · ')}. Click to save a version.`, command: 'hiveku.commit' };
}
