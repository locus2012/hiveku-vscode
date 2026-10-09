/**
 * Pull requests (reviews, in the Hiveku dashboard): what a refused merge means,
 * the conflict resolve, and archived branches. The VS Code side of the
 * version-control features that went live on 2026-10-08 (builder #916, #934,
 * #943, #952; MCP #168, #171, #176).
 *
 * WHY THE RESOLVE STEP. The live check of 2026-10-07
 * (notes/vcs-capability-verification-2026-10-07) found that a pull request
 * refused for conflicts could never merge: the advice every client gave,
 * "resolve them on the branch, save a version, then merge again", is a dead
 * end, because the merge compares against where the branch started, so an
 * edited file still conflicts. The way out is project_vcs_resolve, which
 * records the decision for each file. The dashboard's review page offers all
 * three choices (keep the branch's version, use the other side's, or edit the
 * final text) and is the reliable path; here a person can also keep one side
 * per file. Writing the final text is left to the dashboard.
 *
 * Everything a person clicks through lives here so extension.ts only calls in
 * with small hooks (the diff opener, the dashboard address). The pure parts are
 * exported for the tests.
 *
 * Words: "pull request" as the rest of the extension says it, "Your site" for
 * main, "version" for a saved point. Text from the server that is somebody's
 * own words (titles, comments) is shown as data, never acted on.
 */

import * as vscode from 'vscode';
import * as api from './hivekuApi';
import type { HivekuMcpClient } from './mcpClient';
import { plainErrorMessage, routeErrorOf } from './versions';

type Log = { appendLine(line: string): void };
type Client = Pick<HivekuMcpClient, 'callToolJson'>;

export const RESOLVE_IN_DASHBOARD = 'Resolve in the dashboard';
export const RESOLVE_HERE = 'Resolve here';
export const OPEN_IN_DASHBOARD = 'Open in the dashboard';
export const MERGE_AGAIN = 'Merge again';
export const RESTORE_BRANCH = 'Restore branch';
export const OPEN_PULL_REQUEST = 'Open a pull request';

/**
 * The review's page in the dashboard: where people approve, and where every
 * conflict can be resolved. Account-scoped, like every dashboard link the
 * extension opens: a bare /dashboard/... address lands in the account the
 * person last used in the browser, which for an agency is often another
 * client's, so the project would not open there.
 */
export function reviewPageUrl(appUrl: string, accountId: string, projectId: string, number: number): string {
  return (
    `${appUrl.replace(/\/+$/, '')}/${encodeURIComponent(accountId)}/dashboard/${encodeURIComponent(projectId)}` +
    `/v3?tab=branches&review=${number}`
  );
}

/** "Your site" for main, the quoted name otherwise. */
export function branchWords(branch: string): string {
  return branch === 'main' ? 'Your site' : `"${branch}"`;
}

/** The JSON bodies a failed tool call carries: the parsed payload, then any JSON in its message. */
function errorBodies(err: unknown): unknown[] {
  const out: unknown[] = [];
  const payload = (err as { payload?: unknown } | null | undefined)?.payload;
  if (payload && typeof payload === 'object') out.push(payload);
  const text = err instanceof Error ? err.message : String(err);
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      out.push(JSON.parse(match[0]));
    } catch {
      // not JSON: nothing to read
    }
  }
  return out;
}

/**
 * The first value under `key` in a failed call's body, at whatever depth the
 * proxy put it: the MCP proxy nests the route body under `details`, and the PR
 * merge route also keeps an older copy under `data`.
 */
function findInError(err: unknown, key: string, accept: (v: unknown) => boolean): unknown {
  for (const root of errorBodies(err)) {
    const seen = new Set<unknown>();
    const walk = (node: unknown, depth: number): unknown => {
      if (!node || typeof node !== 'object' || depth > 4 || seen.has(node)) return undefined;
      seen.add(node);
      const obj = node as Record<string, unknown>;
      if (key in obj && accept(obj[key])) return obj[key];
      for (const k of ['details', 'data', 'result', 'merge']) {
        const found = walk(obj[k], depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const found = walk(root, 0);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The conflict list inside a refused merge (empty when there is none). */
export function conflictsFromError(err: unknown): string[] {
  const list = findInError(err, 'conflicts', Array.isArray);
  return Array.isArray(list) ? list.map(String) : [];
}

/** Where a refused merge's conflicts are resolved: the branch, and the branch it was started from. */
export interface ResolveTarget {
  branch: string;
  parent: string;
}

function isResolveTarget(v: unknown): v is ResolveTarget {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.branch === 'string' && o.branch !== '' && typeof o.parent === 'string' && o.parent !== '';
}

/** The `resolve` a conflict answer carries; null when neither branch was started from the other. */
export function resolveTargetFromError(err: unknown): ResolveTarget | null {
  const value = findInError(err, 'resolve', isResolveTarget);
  return isResolveTarget(value) ? { branch: value.branch, parent: value.parent } : null;
}

/** Why a pull request merge was refused, when it is one of the refusals people act on. */
export type PrMergeRefusal =
  | { kind: 'conflicts'; paths: string[]; resolve: ResolveTarget | null }
  | { kind: 'approval_required' | 'source_changed' | 'draft'; message: string };

export function prMergeRefusal(err: unknown): PrMergeRefusal | null {
  const route = routeErrorOf(err);
  const code = route?.code;
  const paths = conflictsFromError(err);
  if (code === 'merge_conflicts' || paths.length > 0) {
    return { kind: 'conflicts', paths, resolve: resolveTargetFromError(err) };
  }
  if (!route) return null;
  // The route's own sentences for these three are written for people (who must
  // approve, what moved, what to do with a draft), so they are shown as they come.
  if (code === 'approval_required') return { kind: 'approval_required', message: route.message };
  if (code === 'source_changed') return { kind: 'source_changed', message: route.message };
  if (code === 'pull_request_is_draft') return { kind: 'draft', message: route.message };
  return null;
}

/** The sentence for a pull request refused for conflicts. */
export function conflictRefusalMessage(refusal: { paths: string[]; resolve: ResolveTarget | null }): string {
  const n = refusal.paths.length;
  const list = `${refusal.paths.slice(0, 4).join(', ')}${n > 4 ? ', …' : ''}`;
  const head = n > 0
    ? `Nothing was merged: ${n} file${n === 1 ? '' : 's'} conflict${n === 1 ? 's' : ''} (${list}).`
    : 'Nothing was merged: some files conflict.';
  if (!refusal.resolve) {
    return (
      `${head} Neither branch was started from the other, so the conflicts cannot be resolved between ` +
      'them directly: merge through the branch this one was started from, resolving the conflicts at each step.'
    );
  }
  return (
    `${head} Decide each file: keep the branch's version, use ${branchWords(refusal.resolve.parent)}'s, ` +
    'or edit the final text in the dashboard. Editing the file on the branch and saving a version does not clear a conflict.'
  );
}

/**
 * A direct merge into Your site refused because the site requires an approval
 * (409 pull_request_required). The route's sentence names an API tool, so the
 * person gets this one instead.
 */
export function directMergeRefusal(err: unknown): string | null {
  if (routeErrorOf(err)?.code !== 'pull_request_required') return null;
  return (
    'This site requires an approval before changes go into Your site, so they cannot be merged into it directly. ' +
    'Open a pull request from this branch and ask a person on your team to approve it in the Hiveku dashboard; ' +
    'it can be merged once approved. Nothing was merged.'
  );
}

/** A write refused because its branch was archived when its review merged (409 branch_archived). */
export function archivedBranchOf(err: unknown): { branch: string | null; message: string } | null {
  const route = routeErrorOf(err);
  if (route?.code !== 'branch_archived') return null;
  const fromBody = typeof route.body.branch === 'string' && route.body.branch.trim() ? route.body.branch.trim() : null;
  const fromText = route.message.match(/The branch "([^"]+)" was archived/)?.[1] ?? null;
  return {
    branch: fromBody ?? fromText,
    message: route.message || 'That branch was archived when its pull request merged, so it takes no changes. Nothing was changed.',
  };
}

/** What a merged pull request did with its branch, as a sentence to append ('' when not archived or not said). */
export function archiveSentence(outcome: api.BranchArchiveOutcome | undefined): string {
  if (!outcome || outcome.archived !== true) return '';
  return (
    ` The branch "${outcome.branch}" is archived: it is hidden from the branch list, takes no more changes, ` +
    'and can be restored for 30 days.'
  );
}

/**
 * The files a review reads: the pull request's OWN changes since its merge
 * base (`changes`, builder #955), else the older two-dot `diff`, which also
 * lists what the target changed after the branch started.
 */
export function reviewChanges(detail: Pick<api.PullRequestDetail, 'changes' | 'diff'>): api.CompareResult | null {
  return detail.changes ?? detail.diff ?? null;
}

/** "#3", "#3 and #5", "#3, #5 and #8". */
function numbers(list: number[]): string {
  const tags = list.map((n) => `#${n}`);
  return tags.length <= 1 ? tags.join('') : `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`;
}

/**
 * The detail line of an open pull request in the Pull Requests list, from the
 * list's own fields (the last check; a list never runs one, so nothing is said
 * when it is unknown). Undefined when there is nothing to say.
 */
export function pullRequestListDetail(pr: api.PullRequest): string | undefined {
  const parts: string[] = [];
  if (pr.target_branch === 'main') parts.push('Merging this changes the live project');
  if (pr.mergeable_state === 'conflicts') parts.push(`Conflicts with ${branchWords(pr.target_branch)}`);
  const others = Array.isArray(pr.conflicts_with) ? pr.conflicts_with.filter((n) => Number.isInteger(n)) : [];
  if (others.length > 0) parts.push(`conflicts with ${numbers(others)}`);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * What `mergeable` says before a merge, for the Merge choice (null when there
 * is nothing to warn about). `state` is about the target only; the pull
 * request pairs are advisory.
 */
export function mergeableNote(mergeable: api.Mergeable | null | undefined, target: string): string | null {
  if (!mergeable) return null;
  const files = Array.isArray(mergeable.conflicts_with_target) ? mergeable.conflicts_with_target.length : 0;
  if (mergeable.state === 'conflicts') {
    return files > 0
      ? `${files} file${files === 1 ? '' : 's'} conflict with ${branchWords(target)}: resolve first`
      : `conflicts with ${branchWords(target)}: resolve first`;
  }
  const prs = (mergeable.conflicts_with_prs ?? []).map((c) => c.number).filter((n) => Number.isInteger(n));
  if (prs.length > 0) return `conflicts with ${numbers(prs)} once one of them merges`;
  return null;
}

/**
 * Offer to restore an archived branch when `err` is a branch_archived refusal.
 * Returns true when it handled the error (the caller shows nothing else).
 */
export async function offerRestoreArchivedBranch(ctx: { client: Client; projectId: string; err: unknown; log: Log }): Promise<boolean> {
  const archived = archivedBranchOf(ctx.err);
  if (!archived) return false;
  ctx.log.appendLine(`[branch] refused, archived: ${archived.branch ?? '(unnamed)'}`);
  const branch = archived.branch;
  if (!branch) {
    vscode.window.showWarningMessage(archived.message);
    return true;
  }
  const choice = await vscode.window.showWarningMessage(archived.message, RESTORE_BRANCH);
  if (choice !== RESTORE_BRANCH) return true;
  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Restoring "${branch}"…` },
      () => api.vcsBranchRestore(ctx.client as HivekuMcpClient, ctx.projectId, branch),
    );
    ctx.log.appendLine(`[branch] restore ${branch}: restored=${result?.restored}`);
    vscode.window.showInformationMessage(
      result?.restored === false
        ? `"${branch}" is not archived, so nothing changed. Try again.`
        : `Restored "${branch}". It takes changes again, so try again.`,
    );
  } catch (e) {
    vscode.window.showErrorMessage(`Could not restore "${branch}": ${plainErrorMessage(e)}`);
  }
  return true;
}

// ── Resolving conflicts here ────────────────────────────────────────────────

export interface ResolveHereContext {
  client: Client;
  projectId: string;
  target: ResolveTarget;
  /** Show both sides of one file: the parent's on the left, the branch's on the right. */
  compare(path: string): Promise<void>;
  log: Log;
}

export type ResolveHereOutcome =
  | { kind: 'resolved'; resolved: string[]; remaining: string[] }
  /** No conflict is left: merge again. */
  | { kind: 'none' }
  /** Nothing was sent: the person closed a picker or the confirmation. */
  | { kind: 'cancelled' }
  /** Nothing was sent: every file was left for the dashboard. */
  | { kind: 'left_for_dashboard' }
  /** Hiveku refused and nothing changed. `again`: reading the conflicts again is the fix. */
  | { kind: 'refused'; message: string; again: boolean };

type ChoiceItem = vscode.QuickPickItem & { choice?: 'branch' | 'parent'; action?: 'compare' | 'leave' };

/** The choices for one conflicting file. Exported for the tests. */
export function choicesFor(conflict: api.BranchConflict, parent: string): ChoiceItem[] {
  const items: ChoiceItem[] = [];
  // 'branch' needs the parent's hash; null is a real answer (the parent has no such file).
  if (conflict.parent_hash !== undefined) {
    items.push({
      label: "Keep this branch's version",
      description: conflict.kind === 'delete' ? 'or its deletion' : '',
      choice: 'branch',
    });
  }
  items.push({
    label: `Use ${branchWords(parent)}'s version`,
    description: conflict.kind === 'delete' ? 'or its deletion' : '',
    choice: 'parent',
  });
  if (conflict.kind === 'conflict' || conflict.kind === 'delete') {
    items.push({ label: 'Compare the two versions', description: 'then choose', action: 'compare' });
  }
  items.push({ label: 'Leave it for the dashboard', description: 'to edit the final text there', action: 'leave' });
  return items;
}

/** What one kind of conflict means, for the picker. */
function kindSentence(conflict: api.BranchConflict, parent: string): string {
  const other = branchWords(parent);
  switch (conflict.kind) {
    case 'delete':
      return `One side deleted this file and the other changed it (this branch and ${other}).`;
    case 'binary':
      return `This branch and ${other} both changed this file, and it is not text.`;
    case 'too_large':
      return `This branch and ${other} changed this file too far apart to merge line by line.`;
    default:
      return `This branch and ${other} changed the same lines of this file.`;
  }
}

/**
 * List the conflicts between `target.branch` and the branch it was started
 * from, let the person keep one side per file, and resolve them in one call
 * after a confirmation. Never resolves a file the person did not choose.
 */
export async function resolveConflictsHere(ctx: ResolveHereContext): Promise<ResolveHereOutcome> {
  const { branch, parent } = ctx.target;
  let listed: api.BranchConflicts;
  try {
    listed = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Reading the conflicts on "${branch}"…` },
      () => api.vcsConflicts(ctx.client as HivekuMcpClient, ctx.projectId, branch),
    );
  } catch (e) {
    return { kind: 'refused', message: plainErrorMessage(e), again: false };
  }
  // The answer names the parent it compared with; trust it over the merge's.
  const against = typeof listed.parent === 'string' && listed.parent ? listed.parent : parent;
  if (listed.conflicts.length === 0) return { kind: 'none' };

  const chosen: api.ConflictResolution[] = [];
  const lines: string[] = [];
  const total = listed.conflicts.length;
  for (const [i, conflict] of listed.conflicts.entries()) {
    for (;;) {
      const pick = await vscode.window.showQuickPick(choicesFor(conflict, against), {
        title: `Conflict ${i + 1} of ${total}: ${conflict.path}`,
        placeHolder: kindSentence(conflict, against),
        ignoreFocusOut: true,
      });
      if (!pick) return { kind: 'cancelled' };
      if (pick.action === 'compare') {
        await ctx.compare(conflict.path);
        continue;
      }
      if (pick.choice) {
        chosen.push({ path: conflict.path, choice: pick.choice, parent_hash: conflict.parent_hash ?? null });
        lines.push(
          `${conflict.path}: ${pick.choice === 'branch' ? "keep this branch's version" : `use ${branchWords(against)}'s version`}`,
        );
      }
      break;
    }
  }
  if (chosen.length === 0) return { kind: 'left_for_dashboard' };

  const n = chosen.length;
  const left = total - n;
  const ok = await vscode.window.showWarningMessage(
    `Resolve ${n} conflict${n === 1 ? '' : 's'} on "${branch}"?`,
    {
      modal: true,
      detail:
        `${lines.join('\n')}\n\n` +
        `This saves one version on "${branch}". ${branchWords(against)} changes only when the pull request merges.` +
        (left > 0 ? ` ${left} file${left === 1 ? ' is' : 's are'} left for the dashboard.` : ''),
    },
    'Resolve',
  );
  if (ok !== 'Resolve') return { kind: 'cancelled' };

  try {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Resolving ${n} conflict${n === 1 ? '' : 's'} on "${branch}"…` },
      () => api.vcsResolve(ctx.client as HivekuMcpClient, ctx.projectId, branch, chosen),
    );
    const resolved = Array.isArray(result.resolved) ? result.resolved : chosen.map((c) => c.path);
    ctx.log.appendLine(`[resolve] ${branch} against ${against}: resolved=${resolved.length} remaining=${result.remaining_conflicts.length}`);
    return { kind: 'resolved', resolved, remaining: result.remaining_conflicts };
  } catch (e) {
    const code = routeErrorOf(e)?.code;
    ctx.log.appendLine(`[resolve] ${branch} refused: ${code ?? 'error'}`);
    if (code === 'parent_changed') {
      return {
        kind: 'refused',
        message: `${branchWords(against)} changed a file after you looked at it, so nothing was changed. Read the conflicts again and decide again.`,
        again: true,
      };
    }
    const said = plainErrorMessage(e).trim();
    const sentence = `${said}${/[.!?]$/.test(said) ? '' : '.'}`;
    // Only a refusal the route names wrote nothing. No answer at all (a timeout,
    // a dropped connection, a 5xx) may have saved the resolve: never say otherwise.
    if (!code || !RESOLVE_REFUSALS.has(code)) {
      return {
        kind: 'refused',
        message: `${sentence} The resolve may or may not have been saved: read the conflicts again before merging.`,
        again: true,
      };
    }
    return {
      kind: 'refused',
      message: /nothing (?:was )?changed/i.test(said) ? sentence : `${sentence} Nothing was changed.`,
      again: code === 'not_a_conflict' || code === 'branch_changed' || code === 'branch_busy',
    };
  }
}

/** The resolve's refusals: each one wrote nothing (project_vcs_resolve's description). */
const RESOLVE_REFUSALS: ReadonlySet<string> = new Set([
  'parent_changed',
  'not_a_conflict',
  'resolve_needs_parent',
  'branch_busy',
  'branch_changed',
  'branch_archived',
  'invalid_request',
  'invalid_branch',
]);
