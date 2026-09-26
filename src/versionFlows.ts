/**
 * The VS Code side of versions: the dialogs and the status-bar dot.
 *
 * Everything a person clicks through lives here so scm.ts and extension.ts
 * only call in with small, named hooks. The pure parts (capabilities, tool
 * wrappers, sentences) are in versions.ts; names are checked and suggested by
 * versionName.ts.
 *
 * Every flow first asks serverCaps(): a server without the version tools gets
 * exactly the extension's old behaviour. Nothing here ever blocks a push or a
 * deploy that already happened: a version that could not be saved is said
 * plainly, with how to save one later (Hiveku: Save a Version; a production
 * publish of Your site also saves one first).
 *
 * Words: people read "version", never commit/HEAD/revert; main is named
 * "Your site (main)".
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import * as api from './hivekuApi';
import type { HivekuMcpClient } from './mcpClient';
import { versionNameProblem, type ChangeLists } from './versionName';
import { IGNORE_DIRS } from './workspace';
import {
  branchBarState,
  branchLabel,
  goBackTargets,
  liveUpdateSentence,
  needsVersion,
  notVersionedYetSentence,
  onlyNotesChanged,
  plainErrorMessage,
  pushVersionName,
  readPushVersionMode,
  rollbackErrorMessage,
  rollbackMayHaveLanded,
  rollbackPlanLines,
  routeErrorOf,
  saveVersion,
  serverCaps,
  suggestedNameFromStatus,
  versionHistoryPage,
  versionPickItem,
  vcsRollback,
  vcsStatus,
  type NothingToSend,
  type RemoteDirty,
  type RollbackApplied,
  type RollbackDryRun,
  type SaveVersionResult,
  type VersionEntry,
} from './versions';

type Log = { appendLine(line: string): void };

/** Ask for a version name, prefilled, checked with the same rule the fixture pins. undefined = Escape. */
async function askVersionName(title: string, value: string, prompt?: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title,
    prompt: prompt ?? 'Name this version for History: what changed, in plain words.',
    value,
    placeHolder: 'e.g. Updated the pricing section on the Home page',
    validateInput: (v: string) => versionNameProblem(v),
  });
  return name === undefined ? undefined : name.trim();
}

/** plainErrorMessage as a sentence, so text can follow it. */
function said(e: unknown): string {
  const m = plainErrorMessage(e).trim();
  return /[.!?]$/.test(m) ? m : `${m}.`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── D2: push, then version ────────────────────────────────────────────────────

export interface PushVersionContext {
  client: HivekuMcpClient;
  projectId: string;
  branch: string;
  /** The Source Control input box: a name typed there is used, then cleared. */
  inputBox: { value: string };
  log: Log;
  /** What the push changed in the versioned (code) lane. Shared-library images are not versioned. */
  changes: ChangeLists;
}

/**
 * After a push that FULLY landed, save it as one version (hiveku.push.saveVersion:
 * ask by default, auto, or never). A plain name already typed in the Source
 * Control box is used as it is; "ask" prompts only when the box is empty or
 * the name there is not plain. Returns what happened; never throws.
 */
export async function versionAfterPush(ctx: PushVersionContext): Promise<SaveVersionResult | 'skipped' | 'declined' | 'failed'> {
  const later = notVersionedYetSentence(ctx.branch);
  try {
    const caps = await serverCaps(ctx.client);
    if (!caps.status) return 'skipped';
    const visible =
      (ctx.changes.added?.length ?? 0) + (ctx.changes.modified?.length ?? 0) + (ctx.changes.removed?.length ?? 0);
    if (visible === 0) {
      ctx.log.appendLine('[version] push changed only shared-library images; nothing to save as a version');
      return 'skipped';
    }
    const mode = readPushVersionMode(vscode.workspace.getConfiguration('hiveku').get<string>('push.saveVersion', 'ask'));
    if (mode === 'never') {
      ctx.log.appendLine(`[version] not saved after push (hiveku.push.saveVersion is "never"). ${later}`);
      return 'skipped';
    }
    const { name: suggested, typed } = pushVersionName(ctx.changes, ctx.inputBox.value);
    let name: string | undefined = suggested;
    const typedIsTheName = !!typed && suggested === typed;
    if (mode === 'ask' && !typedIsTheName) {
      name = await askVersionName(`Save this push as a version of ${branchLabel(ctx.branch)}`, typed || suggested);
      if (name === undefined) {
        ctx.log.appendLine(`[version] push not saved as a version (dismissed). ${later}`);
        void vscode.window.showInformationMessage(`Pushed, not saved as a version yet. ${later}`);
        return 'declined';
      }
    }
    const result = await saveVersion(ctx.client, ctx.projectId, name, ctx.branch, caps);
    if (result.outcome === 'saved') {
      ctx.log.appendLine(`[version] ${ctx.branch} ${result.commit.id} "${name}" (after push)`);
      if (typed && typed === name) ctx.inputBox.value = '';
      void vscode.window.showInformationMessage(`Saved as a version: "${name}".`);
    } else if (result.outcome === 'nothing') {
      ctx.log.appendLine(`[version] ${ctx.branch}: already a version (nothing_to_commit)`);
      void vscode.window.showInformationMessage('Everything pushed is already saved as a version.');
    }
    return result;
  } catch (e) {
    ctx.log.appendLine(`[version] saving the push as a version failed: ${plainErrorMessage(e)}`);
    void vscode.window.showWarningMessage(`Pushed, but it was not saved as a version: ${said(e)} ${later}`);
    return 'failed';
  }
}

// ── D3: the Commit button on a clean folder, on main ─────────────────────────

/** 'offered': the person was asked (took it or not); anything else says why nothing was offered. */
export type PromoteOutcome = 'offered' | NothingToSend;

/**
 * Local folder == Your site, but Hiveku may still hold changes that are not a
 * version yet (a push, the dashboard, an agent). Offers to save them as one
 * version named `name`. Only a status Hiveku actually reported is 'clean':
 * an older server is 'unsupported', a failed read 'unknown', and a status
 * that says it does not know (uncommitted_reason 'unknown') still offers the
 * save, worded as such (a promote with nothing pending answers "already a
 * version", which is harmless).
 */
export async function promoteMainIfUncommitted(ctx: {
  client: HivekuMcpClient;
  projectId: string;
  name: string;
  log: Log;
  /** Cleared once the version is saved (the name was used). */
  inputBox?: { value: string };
}): Promise<PromoteOutcome> {
  const caps = await serverCaps(ctx.client);
  if (!caps.status) return 'unsupported';
  let status;
  try {
    status = await vcsStatus(ctx.client, ctx.projectId, 'main');
  } catch (e) {
    ctx.log.appendLine(`[version] status unavailable: ${plainErrorMessage(e)}`);
    return 'unknown';
  }
  if (!status.uncommitted && status.uncommitted_reason !== 'unknown') return 'clean';
  if (onlyNotesChanged(status)) return 'notes';
  const known = status.uncommitted;
  const summary = status.latest_changes?.summary?.trim();
  const choice = await vscode.window.showInformationMessage(
    known
      ? `Hiveku has changes on Your site (main) that aren't a version yet (pushed or saved elsewhere). Save them as a version named "${ctx.name}"?`
      : `This folder matches Hiveku, but Hiveku could not say whether everything on Your site (main) is a version yet. Save a version named "${ctx.name}"?`,
    {
      modal: true,
      detail:
        (summary ? `What changed: ${summary}.\n` : '') +
        (known
          ? 'No files are uploaded again. The version includes everything on Your site that is not a version yet, whoever saved it.'
          : 'No files are uploaded again. If everything is already a version, nothing new is saved.'),
    },
    'Save version',
  );
  if (choice !== 'Save version') return 'offered';
  let result: SaveVersionResult;
  try {
    result = await saveVersion(ctx.client, ctx.projectId, ctx.name, 'main', caps);
  } catch (e) {
    ctx.log.appendLine(`[version] saving what was on Hiveku failed: ${plainErrorMessage(e)}`);
    void vscode.window.showWarningMessage(`The version was not saved: ${said(e)}`);
    return 'offered';
  }
  if (result.outcome === 'saved') {
    ctx.log.appendLine(`[version] main ${result.commit.id} "${ctx.name}" (saved what was on Hiveku)`);
    if (ctx.inputBox) ctx.inputBox.value = '';
    void vscode.window.showInformationMessage(`Saved a version of Your site: "${ctx.name}".`);
  } else if (result.outcome === 'nothing') {
    void vscode.window.showInformationMessage('Already saved as a version. Nothing new to save.');
  }
  return 'offered';
}

// ── D4: go back to a version ──────────────────────────────────────────────────

export interface GoBackContext {
  client: HivekuMcpClient;
  projectId: string;
  branch: string;
  log: Log;
  /**
   * The folder. On Your site the re-download is a snapshot extracted over it,
   * which never deletes, so files the rollback removed are moved to the trash
   * here first.
   */
  root: string;
  /** Refresh the Changes list and return how many local changes a re-pull would overwrite. */
  localChanges: () => Promise<number>;
  /** Re-download the tree into the folder after the rollback. */
  pullInto: () => Promise<void>;
  refresh: () => Promise<void>;
  /** The SEPARATE deploy call, only when the person chose to update the live site. */
  deployProduction: () => Promise<api.DeployStart>;
}

export const GO_BACK_AND_UPDATE = 'Go back and update live site';
export const GO_BACK_ONLY = 'Go back only';
export const GO_BACK = 'Go back';
export const FINISH_GOING_BACK = 'Finish going back';
export const RE_DOWNLOAD = 'Re-download';

export type GoBackOutcome = 'applied' | 'cancelled' | 'noop' | 'refused' | 'incomplete' | 'unknown';

/**
 * Local paths to remove after going back on Your site: the dry run's
 * `removed` entries, never a path outside the folder and never the local-only
 * files (.hiveku/, .claude/, .mcp.json, .env*, build output: IGNORE_DIRS at
 * any depth), which a snapshot never carries anyway.
 */
export function removedPathsToDelete(dry: Pick<RollbackDryRun, 'changes'> | undefined): string[] {
  const out: string[] = [];
  for (const e of dry?.changes?.entries ?? []) {
    if (!e || e.status !== 'removed' || typeof e.path !== 'string') continue;
    const rel = e.path.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
    if (!rel || rel.includes('\0') || rel.includes('\\')) continue;
    const segs = rel.split('/');
    if (segs.some((s) => s === '' || s === '.' || s === '..')) continue;
    if (segs.some((s) => IGNORE_DIRS.has(s)) || segs[segs.length - 1].startsWith('.env')) continue;
    out.push(rel);
  }
  return out;
}

/** Move `paths` (relative to `root`) to the OS trash; a file that is not there is skipped. */
async function trashLocalFiles(root: string, paths: string[], log: Log): Promise<{ trashed: number; kept: string[] }> {
  const base = path.resolve(root);
  let trashed = 0;
  const kept: string[] = [];
  for (const rel of new Set(paths)) {
    const abs = path.resolve(base, rel);
    if (!abs.startsWith(base + path.sep)) continue;
    let st;
    try {
      st = await fs.lstat(abs);
    } catch {
      continue;
    }
    if (!st.isFile() && !st.isSymbolicLink()) continue;
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(abs), { recursive: false, useTrash: true });
      trashed++;
    } catch (e) {
      log.appendLine(`[rollback] could not move ${rel} to the trash: ${(e as Error).message}`);
      kept.push(rel);
    }
  }
  return { trashed, kept };
}

/**
 * The version picker: this branch's versions whose files can be read back,
 * newest first, 100 at a time with "Show older versions…" while there are
 * more. undefined = nothing picked.
 */
async function pickVersion(ctx: GoBackContext, branchName: string, head: string | null, where: string): Promise<VersionEntry | undefined> {
  type Item = vscode.QuickPickItem & { entry?: VersionEntry; older?: true; blocked?: true };
  const shown: VersionEntry[] = [];
  let blocked = 0;
  let before: string | null = null;
  let needPage = true;
  let pages = 0;
  const MAX_PAGES = 50;
  for (;;) {
    // A page may hold only versions that cannot be restored: keep reading
    // (bounded) until one can, or history ends.
    while (needPage && pages < MAX_PAGES) {
      const page = await versionHistoryPage(ctx.client, ctx.projectId, branchName, { before });
      pages++;
      const targets = goBackTargets(page.entries, branchName, head);
      blocked += page.entries.filter((c) => c.branch_name === branchName && c.id !== head && c.restorable === false).length;
      shown.push(...targets);
      before = page.nextBefore;
      needPage = !!before && targets.length === 0;
    }
    needPage = false;
    const blockedLine = blocked
      ? `${count(blocked, 'older version', 'older versions')} can only be restored from Project history in the Hiveku dashboard.`
      : '';
    if (shown.length === 0) {
      void vscode.window.showInformationMessage(`No earlier versions of ${where} to go back to here.${blockedLine ? ` ${blockedLine}` : ''}`);
      return undefined;
    }
    const items: Item[] = shown.map((c) => ({ ...versionPickItem(c), entry: c }));
    if (before && pages < MAX_PAGES) items.push({ label: '$(history) Show older versions…', description: '', older: true });
    if (blockedLine) items.push({ label: `$(info) ${blockedLine}`, description: '', blocked: true });
    const pick = await vscode.window.showQuickPick<Item>(items, {
      placeHolder: `Go back to which version of ${where}? Newer versions stay in History.`,
      matchOnDescription: true,
    });
    if (!pick) return undefined;
    if (pick.older) {
      needPage = true;
      continue;
    }
    if (pick.blocked || !pick.entry) continue;
    return pick.entry;
  }
}

/** The modal line about local changes a re-download replaces; on Your site new local files are kept. */
function localChangesLine(local: number, onMain: boolean): string[] {
  if (local <= 0) return [];
  return onMain
    ? [`${count(local, 'local change', 'local changes')} in this folder: edited files are replaced when it re-downloads; files only in this folder are kept. Push first to keep your edits.`]
    : [`${count(local, 'local change', 'local changes')} in this folder will be replaced when it re-downloads (files only in this folder are removed). Push first to keep them.`];
}

/**
 * Pick a version, preview (dry run), confirm, apply with the dry run's head,
 * then (main only, if chosen) deploy production as a second call, re-pull and
 * refresh. Append-only: newer versions stay in History, so this is undoable.
 *
 * An apply that fails WITHOUT a clear refusal (the client stopped waiting, a
 * 5xx, rollback_incomplete) may have moved Hiveku, so it is never reported as
 * "nothing changed": the same preview is asked again, and either it already
 * matches (the folder is then re-downloaded as usual) or "Finish going back"
 * applies with the fresh preview.
 */
export async function goBackToVersion(ctx: GoBackContext): Promise<GoBackOutcome> {
  const onMain = !ctx.branch || ctx.branch === 'main';
  const where = branchLabel(ctx.branch);
  const branchName = onMain ? 'main' : ctx.branch;

  // The current head is not a target (the dry run would answer noop), so it
  // is left out of the picker. Main's head comes from status, a branch's from
  // its ref; unknown just means it stays in the list.
  let head: string | null = null;
  try {
    head = onMain
      ? (await vcsStatus(ctx.client, ctx.projectId, 'main')).head_commit_id
      : ((await api.vcsBranches(ctx.client, ctx.projectId)).find((b) => b.branch_name === ctx.branch)?.head_commit_id ?? null);
  } catch (e) {
    ctx.log.appendLine(`[rollback] head unavailable: ${plainErrorMessage(e)}`);
  }
  const target = await pickVersion(ctx, branchName, head, where);
  if (!target) return 'cancelled';
  const targetName = (target.message ?? '').trim() || 'that version';

  let dry: RollbackDryRun;
  try {
    dry = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Checking what going back to "${targetName}" changes…` },
      () => vcsRollback(ctx.client, ctx.projectId, { commitId: target.id, branch: ctx.branch, dryRun: true }),
    );
  } catch (e) {
    void vscode.window.showErrorMessage(rollbackErrorMessage(e));
    return 'refused';
  }
  if (dry.ai_turn_running) {
    void vscode.window.showWarningMessage(
      'The AI is working on this site right now. Nothing was changed. Try again when it has finished.',
    );
    return 'refused';
  }
  if (dry.noop) return alreadyThere(ctx, where, targetName, onMain);

  const local = await ctx.localChanges().catch(() => 0);
  const detail = [...rollbackPlanLines(dry), ...localChangesLine(local, onMain)].join('\n');
  const buttons = onMain ? [GO_BACK_AND_UPDATE, GO_BACK_ONLY] : [GO_BACK];
  const choice = await vscode.window.showWarningMessage(
    `Go back to "${targetName}"? Newer versions stay in History.`,
    { modal: true, detail },
    ...buttons,
  );
  if (!choice || !buttons.includes(choice)) return 'cancelled';
  const updateLive = choice === GO_BACK_AND_UPDATE;

  const removed = removedPathsToDelete(dry);
  let versionId: string | null | undefined;
  try {
    const applied = await applyRollback(ctx, target, targetName, dry);
    versionId = applied.version?.id ?? applied.branch?.head_commit_id;
  } catch (e) {
    if (!rollbackMayHaveLanded(e)) {
      ctx.log.appendLine(`[rollback] ${ctx.branch} -> ${target.id} refused: ${(e as Error).message}`);
      void vscode.window.showErrorMessage(rollbackErrorMessage(e));
      return 'refused';
    }
    const settled = await settleUncertainApply(ctx, target, targetName, where, e);
    if (settled.outcome !== 'landed') {
      await ctx.refresh().catch(() => undefined);
      return settled.outcome;
    }
    versionId = settled.versionId;
    removed.push(...removedPathsToDelete(settled.dry));
  }

  let liveLine = '';
  if (onMain) {
    if (updateLive) {
      try {
        const res = await ctx.deployProduction();
        ctx.log.appendLine(
          `[rollback] production deploy ${res.deployment_id ?? '(no id)'} ${res.status ?? ''}` +
            `${res.vcs_commit_id ? ` version=${res.vcs_commit_id}` : ''}${res.note ? ` note: ${res.note}` : ''}`,
        );
        liveLine = ` ${liveUpdateSentence(res, versionId)}`;
      } catch (e) {
        ctx.log.appendLine(`[rollback] production deploy did not start: ${(e as Error).message}`);
        void vscode.window.showWarningMessage(
          `Went back, but updating the live site did not start: ${said(e)} Run Hiveku: Deploy… to try again.`,
        );
      }
    } else {
      liveLine = ' The live site was not changed; deploy production when visitors should see it.';
    }
  }

  // Your site re-downloads as a snapshot extracted over the folder, which
  // never deletes: without this, files the rollback removed stay here, show
  // as local additions, and the next Push (and its version) brings them back.
  // Done BEFORE the re-download, so the baseline it records matches Hiveku.
  let leftLine = '';
  if (onMain) {
    const { trashed, kept } = await trashLocalFiles(ctx.root, removed, ctx.log);
    if (trashed) ctx.log.appendLine(`[rollback] moved ${trashed} file(s) the rollback removed to the trash`);
    const unlisted = dry.changes?.truncated ? Math.max(0, (dry.changes.files?.removed ?? 0) - removed.length) : 0;
    if (kept.length) {
      leftLine += ` ${count(kept.length, 'file', 'files')} removed on Hiveku could not be moved to the trash here (${kept.slice(0, 3).join(', ')}${kept.length > 3 ? ', …' : ''}); delete ${kept.length === 1 ? 'it' : 'them'} before you push.`;
    }
    if (unlisted) {
      leftLine += ` Up to ${count(unlisted, 'more file', 'more files')} removed on Hiveku may still be in this folder; delete them, or download a fresh copy, before you push.`;
    }
  }

  try {
    await ctx.pullInto();
  } catch (e) {
    ctx.log.appendLine(`[rollback] re-download failed: ${(e as Error).message}`);
    void vscode.window.showWarningMessage(
      `Went back on Hiveku, but this folder could not re-download: ${said(e)} Run Hiveku: Pull Latest from Hiveku before you push.`,
    );
  }
  await ctx.refresh().catch(() => undefined);
  void vscode.window.showInformationMessage(
    `${where} is back to "${targetName}".${liveLine}${leftLine} To undo it, go back to the version before it (Hiveku: Go Back to a Version…).`,
  );
  return 'applied';
}

/** Apply with the preview's head (and, on Your site, its fingerprint). Throws what the route refused. */
async function applyRollback(ctx: GoBackContext, target: VersionEntry, targetName: string, dry: RollbackDryRun): Promise<RollbackApplied> {
  const applied = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Going back to "${targetName}"…` },
    () =>
      vcsRollback(ctx.client, ctx.projectId, {
        commitId: target.id,
        branch: ctx.branch,
        dryRun: false,
        expectedHeadCommitId: dry.head_commit_id,
        expectedLiveFingerprint: dry.live_fingerprint,
      }),
  );
  ctx.log.appendLine(
    `[rollback] ${ctx.branch} -> ${target.id} as ${applied.version?.id ?? '(no new version)'}` +
      (applied.auto_version ? ` (saved first: ${applied.auto_version.id})` : ''),
  );
  return applied;
}

type Settled =
  | { outcome: 'landed'; versionId: string | null | undefined; dry: RollbackDryRun }
  | { outcome: 'incomplete' | 'unknown' | 'refused' };

/**
 * The apply failed without a clear refusal. Ask the same preview again:
 * noop means Hiveku already matches the version (it landed); otherwise offer
 * to finish with the FRESH preview (its head, its plan), which is a new yes.
 */
async function settleUncertainApply(
  ctx: GoBackContext,
  target: VersionEntry,
  targetName: string,
  where: string,
  err: unknown,
): Promise<Settled> {
  const incomplete = routeErrorOf(err)?.code === 'rollback_incomplete';
  const why = incomplete ? 'some files went back, not all' : plainErrorMessage(err);
  ctx.log.appendLine(`[rollback] ${ctx.branch} -> ${target.id}: no clear answer (${why}); asking Hiveku again`);
  const notSure =
    `Before you push, check Hiveku: Show History and run Hiveku: Pull Latest from Hiveku, so this folder's newer files ` +
    'do not undo it.';
  let check: RollbackDryRun;
  try {
    check = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Checking whether going back to "${targetName}" finished…` },
      () => vcsRollback(ctx.client, ctx.projectId, { commitId: target.id, branch: ctx.branch, dryRun: true }),
    );
  } catch (e) {
    ctx.log.appendLine(`[rollback] could not check: ${plainErrorMessage(e)}`);
    void vscode.window.showWarningMessage(
      `Hiveku did not confirm going back to "${targetName}" (${why}), and could not be asked again. It may have finished. ${notSure}`,
    );
    return { outcome: incomplete ? 'incomplete' : 'unknown' };
  }
  if (check.noop) {
    ctx.log.appendLine(`[rollback] ${ctx.branch} already matches ${target.id}: it landed`);
    return { outcome: 'landed', versionId: check.head_commit_id, dry: check };
  }
  if (check.ai_turn_running) {
    void vscode.window.showWarningMessage(
      `${where} does not match "${targetName}" yet, and the AI is working on this site right now. Go back again when it has finished. ${notSure}`,
    );
    return { outcome: incomplete ? 'incomplete' : 'unknown' };
  }
  const choice = await vscode.window.showWarningMessage(
    incomplete
      ? `Some files went back to "${targetName}", but not all of them. Finish going back?`
      : `Hiveku did not confirm going back to "${targetName}" (${why}), and ${where} does not match it yet. Finish going back?`,
    {
      modal: true,
      detail: [
        ...rollbackPlanLines(check),
        ...(incomplete ? [] : ['If it may still be finishing on Hiveku, close this and go back again in a minute instead.']),
      ].join('\n'),
    },
    FINISH_GOING_BACK,
  );
  if (choice !== FINISH_GOING_BACK) {
    void vscode.window.showWarningMessage(`Not finished. ${notSure}`);
    return { outcome: incomplete ? 'incomplete' : 'unknown' };
  }
  try {
    const applied = await applyRollback(ctx, target, targetName, check);
    return { outcome: 'landed', versionId: applied.version?.id ?? applied.branch?.head_commit_id, dry: check };
  } catch (e) {
    ctx.log.appendLine(`[rollback] finishing ${ctx.branch} -> ${target.id} failed: ${(e as Error).message}`);
    if (rollbackMayHaveLanded(e)) {
      void vscode.window.showWarningMessage(`Hiveku did not confirm going back to "${targetName}". ${notSure}`);
      return { outcome: incomplete ? 'incomplete' : 'unknown' };
    }
    void vscode.window.showErrorMessage(rollbackErrorMessage(e));
    return { outcome: incomplete ? 'incomplete' : 'refused' };
  }
}

/**
 * Hiveku already matches the version. The folder may not (an earlier go-back
 * that timed out, or local edits): offer to re-download it instead of
 * stopping at "nothing to change".
 */
async function alreadyThere(ctx: GoBackContext, where: string, targetName: string, onMain: boolean): Promise<'noop'> {
  const local = await ctx.localChanges().catch(() => 0);
  if (local <= 0) {
    void vscode.window.showInformationMessage(`${where} already matches "${targetName}". Nothing to change.`);
    return 'noop';
  }
  const choice = await vscode.window.showInformationMessage(
    `${where} already matches "${targetName}" on Hiveku, but this folder has ${count(local, 'local change', 'local changes')}. Re-download it?`,
    { modal: true, detail: localChangesLine(local, onMain).join('\n') },
    RE_DOWNLOAD,
  );
  if (choice !== RE_DOWNLOAD) return 'noop';
  try {
    await ctx.pullInto();
  } catch (e) {
    void vscode.window.showWarningMessage(`This folder could not re-download: ${said(e)} Run Hiveku: Pull Latest from Hiveku.`);
  }
  await ctx.refresh().catch(() => undefined);
  return 'noop';
}

// ── D5: the deploy gate ───────────────────────────────────────────────────────

/**
 * Before a deploy: when the tree that ships has changes that are not a version
 * yet, offer to save one first. Returns 'proceed' or 'cancel'. Never blocks on
 * its own failure: a status that cannot be read lets the deploy go ahead. Only
 * the assistant's notes changing is not a reason to ask.
 */
export async function versionBeforeDeploy(ctx: {
  client: HivekuMcpClient;
  projectId: string;
  /** The branch the tier ships (versions.ts treeThatShips). */
  tree: string;
  tier: 'development' | 'staging' | 'production';
  log: Log;
}): Promise<'proceed' | 'cancel'> {
  let caps;
  try {
    caps = await serverCaps(ctx.client);
  } catch {
    return 'proceed';
  }
  if (!caps.status) return 'proceed';
  let status;
  try {
    status = await vcsStatus(ctx.client, ctx.projectId, ctx.tree, { files: true });
  } catch (e) {
    ctx.log.appendLine(`[deploy] version status unavailable, deploying as asked: ${plainErrorMessage(e)}`);
    return 'proceed';
  }
  if (!needsVersion(status)) return 'proceed';
  const summary = status.latest_changes?.summary?.trim();
  const tierName = ctx.tier.charAt(0).toUpperCase() + ctx.tier.slice(1);
  const choice = await vscode.window.showWarningMessage(
    "You have changes that aren't a version yet. Save a version first?",
    {
      modal: true,
      detail:
        `${tierName} ships ${branchLabel(ctx.tree)}.` +
        (summary ? ` What changed: ${summary}.` : '') +
        ' A version lets you go back to exactly what you published.' +
        (ctx.tier === 'production' && ctx.tree === 'main'
          ? ' Deploy anyway still saves them first, under a general name.'
          : ''),
    },
    'Save version & deploy',
    'Deploy anyway',
  );
  if (choice === 'Deploy anyway') return 'proceed';
  if (choice !== 'Save version & deploy') return 'cancel';
  const name = await askVersionName(`Save a version of ${branchLabel(ctx.tree)} before deploying`, suggestedNameFromStatus(status));
  if (name === undefined) return 'cancel';
  try {
    const result = await saveVersion(ctx.client, ctx.projectId, name, ctx.tree, caps);
    if (result.outcome === 'saved') ctx.log.appendLine(`[deploy] saved version ${result.commit.id} "${name}" on ${ctx.tree} before deploying`);
    return 'proceed';
  } catch (e) {
    const again = await vscode.window.showWarningMessage(
      `The version was not saved: ${said(e)} Deploy anyway?`,
      { modal: true },
      'Deploy anyway',
    );
    return again === 'Deploy anyway' ? 'proceed' : 'cancel';
  }
}

// ── D6: the status-bar dot ────────────────────────────────────────────────────

/** The folder the indicator watches; HivekuScm satisfies it. */
export interface IndicatedFolder {
  readonly root: string;
  readonly branch: string;
  readonly link: { project_id: string; account_id: string };
}

const POLL_MS = 60_000;
/** A refresh-driven read (file watcher bursts) at most this often per folder. */
const MIN_FETCH_GAP_MS = 15_000;

/**
 * Knows whether Hiveku holds changes on a folder's branch that are not a
 * version yet (one project_vcs_status GET). Read on each Changes refresh
 * (throttled) and every 60 seconds while the window has focus. The 60-second
 * timer stops as soon as the server turns out to have no status tool; a later
 * read that finds one (after Reconnect Hiveku) starts it again.
 *
 * Until a server has been seen WITH versions, the bar keeps its old behaviour
 * (no dot; a click switches branch), as the compatibility matrix asks.
 */
export class VersionIndicator implements vscode.Disposable {
  private readonly state = new Map<string, RemoteDirty & { at: number; branch: string }>();
  /** Folders whose server has project_vcs_status (from the last read). */
  private readonly supported = new Map<string, boolean>();
  private readonly inFlight = new Set<string>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    private readonly clientFor: (accountId: string) => Promise<HivekuMcpClient>,
    private readonly watched: () => IndicatedFolder | undefined,
    private readonly log: Log,
  ) {
    const onFocus = vscode.window.onDidChangeWindowState?.((s) => {
      if (!s.focused) return;
      const folder = this.watched();
      if (folder) void this.fetch(folder, false);
    });
    if (onFocus) this.subs.push(onFocus);
  }

  /** Last known remote state for the folder's CURRENT branch; undefined when unknown. */
  remote(folder: IndicatedFolder): RemoteDirty | undefined {
    const s = this.state.get(folder.root);
    return s && s.branch === folder.branch ? { uncommitted: s.uncommitted, files: s.files } : undefined;
  }

  /** True once this folder's server has been seen with versions (project_vcs_status). */
  isSupported(folder: IndicatedFolder): boolean {
    return this.supported.get(folder.root) === true;
  }

  /** The status bar for a folder, dot included (only on a server with versions). */
  barState(folder: IndicatedFolder, localChanges: number): { text: string; tooltip: string; command: string } {
    if (!this.isSupported(folder)) return branchBarState(folder.branch, 0, undefined);
    return branchBarState(folder.branch, localChanges, this.remote(folder));
  }

  /** After a Changes refresh: read the remote state unless it was read moments ago. */
  refreshSoon(folder: IndicatedFolder): void {
    void this.fetch(folder, false);
  }

  /** Read now (after a push, a version save, a rollback). */
  refreshNow(folder: IndicatedFolder): Promise<void> {
    return this.fetch(folder, true);
  }

  private async fetch(folder: IndicatedFolder, force: boolean): Promise<void> {
    if (this.inFlight.has(folder.root)) return;
    const prev = this.state.get(folder.root);
    if (!force && prev && prev.branch === folder.branch && Date.now() - prev.at < MIN_FETCH_GAP_MS) return;
    this.inFlight.add(folder.root);
    try {
      const client = await this.clientFor(folder.link.account_id);
      const caps = await serverCaps(client);
      const wasSupported = this.supported.get(folder.root) === true;
      this.supported.set(folder.root, caps.status);
      if (!caps.status) {
        this.stop();
        if (prev) this.state.delete(folder.root);
        if (prev || wasSupported) this.changed.fire();
        return;
      }
      this.ensureTimer();
      const status = await vcsStatus(client, folder.link.project_id, folder.branch);
      // Only the assistant's notes changing is not a change a person would
      // recognise: no dot for it.
      const next = { uncommitted: needsVersion(status), files: status.latest_changes?.files, at: Date.now(), branch: folder.branch };
      this.state.set(folder.root, next);
      if (!wasSupported || !prev || prev.uncommitted !== next.uncommitted || prev.files !== next.files || prev.branch !== next.branch) {
        this.changed.fire();
      }
    } catch (e) {
      // Unknown, not dirty: never show a dot the server did not report.
      this.log.appendLine(`[version] status read failed: ${plainErrorMessage(e)}`);
      if (prev) {
        this.state.delete(folder.root);
        this.changed.fire();
      }
    } finally {
      this.inFlight.delete(folder.root);
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (vscode.window.state && !vscode.window.state.focused) return;
      const folder = this.watched();
      if (folder) void this.fetch(folder, true);
    }, POLL_MS);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** True while the 60-second read is scheduled (exposed for tests). */
  get polling(): boolean {
    return this.timer !== undefined;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const s of this.subs) s.dispose();
    this.changed.dispose();
  }
}
