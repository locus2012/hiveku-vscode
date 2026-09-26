/**
 * Hiveku Source Control provider — a native VS Code SCM panel backed by
 * Supabase (no git). "Changes" shows files that differ from the project's
 * current `main` state; committing saves them back and records a Hiveku commit.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import {
  buildManifest,
  captureBaseline,
  materializeTree,
  readBaseManifest,
  IGNORE_DIRS,
  isCdnServableAssetPath,
  readFileForCommit,
  readProjectLink,
  storedHashOf,
  treeFileHash,
  walkFiles,
  writeProjectLink,
  type CommitFile,
  type ProjectLink,
} from './workspace';
// Versions (Wave 2): paged checkout, saving versions, naming. New logic lives
// in these modules; the hooks below are small and named.
import { checkoutTree, commitVersion, nothingToSaveMessage, saveVersion, serverCaps } from './versions';
import { versionNameProblem } from './versionName';
import { promoteMainIfUncommitted, versionAfterPush, type PromoteOutcome } from './versionFlows';

export interface RemoteStatus {
  behind: string[]; // changed on Hiveku since you pulled, you didn't touch
  conflict: string[]; // changed on BOTH Hiveku and locally since pull
  yours: string[]; // your local changes (remote unchanged)
  tracked: boolean; // false when no baseline recorded
}

type ChangeKind = 'modified' | 'added' | 'deleted';

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

/** Scheme backing the read-only "what Hiveku currently has" side of a diff. */
export const REMOTE_SCHEME = 'hiveku-remote';

/** Encode the coordinates the content provider needs to fetch one file. A
 *  non-main `branch` makes the provider serve that branch's working-tree copy;
 *  without it the diff's left side was main's file even on a branch. */
export function remoteUri(accountId: string, projectId: string, rel: string, branch?: string): vscode.Uri {
  const b = branch && branch !== 'main' ? `&branch=${encodeURIComponent(branch)}` : '';
  return vscode.Uri.parse(
    `${REMOTE_SCHEME}:/${rel}?account=${encodeURIComponent(accountId)}&project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(rel)}${b}`,
  );
}

/** Result of the off-main "you're behind" check (working-tree etag compare). */
export interface BranchRemoteStatus {
  /** false when no etag was recorded at the last pull/switch (nothing to compare). */
  tracked: boolean;
  /** true when the live etag differs from the recorded one: someone saved here since. */
  moved: boolean;
  remoteEtag: string | null;
  /** The branch's working tree has edits not yet promoted into a commit. */
  uncommitted: boolean;
}

export class HivekuScm implements vscode.Disposable {
  readonly sc: vscode.SourceControl;
  private readonly changes: vscode.SourceControlResourceGroup;
  private readonly disposables: vscode.Disposable[] = [];
  private statuses = new Map<string, ChangeKind>();
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly branchChanged = new vscode.EventEmitter<string>();
  /** Fires with the new branch name after every switch — from the Switch
   *  Branch command, Create Branch's "Switch to it", Merge's "Resolve on",
   *  and Delete Branch's leave-first — so the status bar never goes stale. */
  readonly onDidChangeBranch = this.branchChanged.event;
  /** Fires after every refresh(), so the status bar's change dot stays current. */
  private readonly refreshed = new vscode.EventEmitter<void>();
  readonly onDidRefresh = this.refreshed.event;

  constructor(
    private readonly rootUri: vscode.Uri,
    public link: ProjectLink,
    private readonly clientFactory: () => Promise<HivekuMcpClient>,
    private readonly log: vscode.OutputChannel,
  ) {
    this.sc = vscode.scm.createSourceControl('hiveku', `Hiveku: ${link.project_name}`, rootUri);
    this.sc.inputBox.placeholder = 'Version name, e.g. Updated the Home page (saved to Hiveku)';
    this.sc.acceptInputCommand = { command: 'hiveku.commit', title: 'Save a version to Hiveku' };
    this.changes = this.sc.createResourceGroup('changes', 'Changes');

    // Keep the Changes list live. Without a watcher it only ever reflected the
    // last manual refresh, so a file you or an agent just created did not
    // appear — and, before commit() started refreshing unconditionally, was
    // silently left out of the commit. Debounced because an agent editing a
    // project can produce a burst of writes.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(rootUri, '**/*'),
    );
    const bump = (): void => {
      if (this.watchTimer) clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => {
        this.watchTimer = undefined;
        void this.refresh().catch(() => undefined);
      }, 700);
    };
    watcher.onDidCreate(bump);
    watcher.onDidChange(bump);
    watcher.onDidDelete(bump);
    this.disposables.push(this.sc, this.changes, watcher, this.branchChanged, this.refreshed);
  }

  get root(): string {
    return this.rootUri.fsPath;
  }

  dispose(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    for (const d of this.disposables) d.dispose();
  }

  get branch(): string {
    return this.link.branch || 'main';
  }

  /** Recompute local-vs-Hiveku diff and populate the Changes group. On `main`
   *  we use the server-side diff; on a branch we diff locally against the
   *  branch's S3 tree (which never touches the live project). */
  async refresh(): Promise<void> {
    const client = await this.clientFactory();
    let changed: string[] = [];
    let added: string[] = [];
    let deleted: string[] = [];

    if (this.branch === 'main') {
      const manifest = await buildManifest(this.root);
      const status = await api.filesStatus(client, this.link.project_id, manifest);
      changed = status.changed.map((f) => f.path);
      added = status.only_local.map((f) => f.path);
      deleted = status.only_remote.map((f) => f.path);
    } else {
      // Paged (versions.ts): a whole-tree answer is refused over 150 MB.
      const tree = await checkoutTree(client, this.link.project_id, this.branch);
      const treeMap = new Map(tree.files.map((f) => [f.path, treeFileHash(f.content, f.encoding)]));
      const localMap = new Map<string, string>();
      for (const rel of await walkFiles(this.root)) {
        const buf = await fs.readFile(path.join(this.root, rel));
        localMap.set(rel, storedHashOf(buf).hash);
      }
      for (const [p, h] of localMap) {
        if (!treeMap.has(p)) added.push(p);
        else if (treeMap.get(p) !== h) changed.push(p);
      }
      for (const p of treeMap.keys()) if (!localMap.has(p)) deleted.push(p);
    }

    this.statuses.clear();
    const states: vscode.SourceControlResourceState[] = [];
    for (const p of changed) {
      this.statuses.set(p, 'modified');
      states.push(this.resourceState(p, 'modified'));
    }
    for (const p of added) {
      this.statuses.set(p, 'added');
      states.push(this.resourceState(p, 'added'));
    }
    for (const p of deleted) {
      this.statuses.set(p, 'deleted');
      states.push(this.resourceState(p, 'deleted'));
    }

    this.changes.resourceStates = states;
    this.sc.count = states.length;
    this.sc.inputBox.placeholder =
      this.branch === 'main'
        ? 'Version name for Your site (main), e.g. Updated the Home page'
        : `Version name for ${this.branch}, e.g. Updated the Home page`;

    // When the working tree is fully in sync with remote `main` — which is the
    // state right after a commit made out-of-band (e.g. Claude Code calling
    // project_vcs_commit via MCP) — re-anchor the "you're behind" baseline so it
    // stays accurate. Only fires when local == remote, so it can never mask a
    // genuine behind state (that leaves files in the change set).
    if (this.branch === 'main' && states.length === 0) {
      await captureBaseline(this.root).catch(() => undefined);
    }
    this.refreshed.fire();
  }

  /**
   * Detect whether Hiveku has moved ahead of your last pull (GitHub-style
   * "you're behind"). Compares the recorded baseline (remote state at pull) to
   * (a) current remote via project_files_status and (b) the local working tree.
   */
  async remoteStatus(): Promise<RemoteStatus> {
    const baseline = await readBaseManifest(this.root);
    if (!baseline) return { behind: [], conflict: [], yours: [], tracked: false };

    const client = await this.clientFactory();
    // Diff baseline (sent as "local") against current Hiveku → what remote changed since pull.
    const remote = await api.filesStatus(client, this.link.project_id, baseline);
    const remoteChanged = new Set<string>([
      ...remote.changed.map((f) => f.path),
      ...remote.only_remote.map((f) => f.path), // added on Hiveku
      ...remote.only_local.map((f) => f.path), // deleted on Hiveku
    ]);

    // Local working tree vs baseline → what you changed since pull.
    const baseMap = new Map(baseline.map((e) => [e.path, e.sha256]));
    const localMap = new Map((await buildManifest(this.root)).map((e) => [e.path, e.sha256]));
    const localChanged = new Set<string>();
    for (const [p, h] of localMap) if (baseMap.get(p) !== h) localChanged.add(p);
    for (const p of baseMap.keys()) if (!localMap.has(p)) localChanged.add(p);

    return {
      tracked: true,
      conflict: [...remoteChanged].filter((p) => localChanged.has(p)),
      behind: [...remoteChanged].filter((p) => !localChanged.has(p)),
      yours: [...localChanged].filter((p) => !remoteChanged.has(p)),
    };
  }

  /** Re-record the baseline as the current tree (after pull/clone/commit). */
  async captureBaseline(): Promise<void> {
    await captureBaseline(this.root);
  }

  /**
   * Off-main counterpart of remoteStatus(). main's guard diffs a base manifest
   * against project_files_status; a branch has no such server diff, but its
   * ref carries a working-tree fingerprint (working_tree_etag). The etag we
   * recorded at the last pull/switch/push is compared with the live one — a
   * change means another writer (a person in the builder, an agent's
   * project_files_bulk_save({branch})) saved on this branch since, and a push
   * now would overwrite that work. Without a recorded etag there is nothing to
   * compare, so the guard stays silent rather than crying wolf.
   */
  async branchRemoteStatus(): Promise<BranchRemoteStatus> {
    const client = await this.clientFactory();
    const ref = (await api.vcsBranches(client, this.link.project_id)).find((b) => b.branch_name === this.branch);
    const remoteEtag = ref?.working_tree_etag ?? null;
    const recorded = this.link.last_tree_etag ?? null;
    const tracked = !!recorded && !!remoteEtag;
    return {
      tracked,
      moved: tracked && recorded !== remoteEtag,
      remoteEtag,
      uncommitted: ref?.uncommitted === true,
    };
  }

  /**
   * Record the branch's working-tree etag in the link. Pass the value when a
   * response already carried it (checkout, bulk save); otherwise it is read
   * from project_vcs_branches. Best-effort: a failure here must never fail the
   * operation that just succeeded, it only means the next guard stays silent.
   */
  async recordBranchEtag(etag?: string | null): Promise<void> {
    if (this.branch === 'main') return;
    try {
      let value = etag ?? null;
      if (!value) {
        const client = await this.clientFactory();
        const ref = (await api.vcsBranches(client, this.link.project_id)).find((b) => b.branch_name === this.branch);
        value = ref?.working_tree_etag ?? null;
      }
      this.link = { ...this.link, last_tree_etag: value };
      await writeProjectLink(this.root, this.link);
    } catch (e) {
      this.log.appendLine(`[etag] could not record working_tree_etag for ${this.branch}: ${(e as Error).message}`);
    }
  }

  /** The shared "Hiveku moved" modal for commit/push off main. Returns true to proceed. */
  private async confirmBranchNotMoved(verb: 'Saving a version' | 'Pushing'): Promise<boolean> {
    const rs = await this.branchRemoteStatus();
    if (!rs.tracked || !rs.moved) return true;
    const choice = await vscode.window.showWarningMessage(
      `Branch "${this.branch}" changed on Hiveku since you last pulled it. ${verb} now overwrites those changes.`,
      {
        modal: true,
        detail:
          'Someone else (the builder, or an agent using the branch-aware file tools) saved on this branch ' +
          'after your last pull or switch. Pull first to bring their work in, then re-apply yours.',
      },
      'Pull first',
      verb === 'Saving a version' ? 'Save anyway' : 'Push anyway',
    );
    if (choice === 'Pull first') {
      await vscode.commands.executeCommand('hiveku.pull');
      return false;
    }
    return choice === 'Save anyway' || choice === 'Push anyway';
  }

  /** Switch the working tree to another branch (materializes its content). */
  async switchBranch(branchName: string): Promise<void> {
    // Refresh BEFORE deciding. sc.count is only ever set inside refresh(), and
    // nothing watches the filesystem, so a tree that was clean at the last
    // refresh reports 0 no matter what has been edited or created since — the
    // warning was skipped exactly when it mattered most. materializeTree then
    // rm's every local file not in the target branch, so a file the operator or
    // an agent just created was deleted with no prompt at all.
    await this.refresh();
    if ((this.sc.count ?? 0) > 0) {
      const ok = await vscode.window.showWarningMessage(
        `Switch to "${branchName}"?`,
        {
          modal: true,
          detail:
            `${this.sc.count} local change(s) not pushed or saved as a version will be LOST — the branch's ` +
            `content replaces local files, and anything not in that branch is deleted. ` +
            `Push or save a version first if you want to keep them.`,
        },
        'Switch',
      );
      if (ok !== 'Switch') return;
    }
    const client = await this.clientFactory();
    // Paged: switching to Your site reads its whole tree, refused unpaged over 150 MB.
    const tree = await checkoutTree(client, this.link.project_id, branchName, {
      onNote: (note) => this.log.appendLine(`[switch] ${note}`),
    });
    await materializeTree(this.root, tree.files);
    this.link = {
      ...this.link,
      branch: branchName,
      last_pull_at: new Date().toISOString(),
      // The checkout carries the tree fingerprint on current servers; older
      // ones do not, and recordBranchEtag() below then reads it from the
      // branch list. Cleared for main, whose guard is the base manifest.
      last_tree_etag: branchName === 'main' ? null : (tree.working_tree_etag ?? null),
    };
    await writeProjectLink(this.root, this.link);
    if (branchName !== 'main' && !tree.working_tree_etag) await this.recordBranchEtag();
    this.branchChanged.fire(branchName);
    await this.refresh();
    vscode.window.showInformationMessage(`Switched to branch "${branchName}".`);
  }

  private resourceState(rel: string, kind: ChangeKind): vscode.SourceControlResourceState {
    const resourceUri = vscode.Uri.file(path.join(this.root, rel));
    const letter = kind === 'modified' ? 'M' : kind === 'added' ? 'A' : 'D';
    // Clicking a changed file used to do nothing — no command, no
    // quickDiffProvider, no per-file menu. The only ways to see what changed
    // were a branch-level compare or a version history, neither of which diffs
    // the working tree against Hiveku. For an operator reviewing what an agent
    // did before it reaches a client's site, that was the largest gap in the
    // loop. A modified file now opens a real side-by-side diff; an added file
    // just opens, since there is no remote side to compare against.
    const command: vscode.Command =
      kind === 'modified'
        ? {
            command: 'vscode.diff',
            title: 'Compare with Hiveku',
            arguments: [
              remoteUri(this.link.account_id, this.link.project_id, rel, this.branch),
              resourceUri,
              `${path.basename(rel)} — Hiveku (${this.branch}) ↔ local`,
            ],
          }
        : { command: 'vscode.open', title: 'Open', arguments: [resourceUri] };
    return {
      resourceUri,
      command,
      decorations: {
        strikeThrough: kind === 'deleted',
        tooltip: `${kind} — ${rel}`,
        light: { badge: letter } as vscode.SourceControlResourceDecorations,
        dark: { badge: letter } as vscode.SourceControlResourceDecorations,
      },
    };
  }

  /**
   * Restore ONE file to Hiveku's current content.
   *
   * Until now the only way to undo a single bad local edit was hiveku.pull,
   * which overwrites the entire tree — so reverting one file meant losing every
   * other uncommitted change too.
   */
  async discardFile(rel: string): Promise<void> {
    const kind = this.statuses.get(rel);
    const ok = await vscode.window.showWarningMessage(
      `Discard local changes to ${rel}?`,
      {
        modal: true,
        detail:
          kind === 'added'
            ? 'This file does not exist on Hiveku, so it will be DELETED from this folder.'
            : "This file will be replaced with Hiveku's current content. Local edits are lost.",
      },
      'Discard',
    );
    if (ok !== 'Discard') return;

    const abs = path.join(this.root, rel);
    if (kind === 'added') {
      await fs.rm(abs, { force: true });
    } else {
      const client = await this.clientFactory();
      // The BRANCH's copy. Without the branch this restored main's version
      // of the file onto a branch checkout: data loss dressed as a revert.
      const content = await api.fileContent(client, this.link.project_id, rel, this.branch);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
    }
    await this.refresh();
    vscode.window.showInformationMessage(`Discarded local changes to ${rel}.`);
  }

  /** Overwrite local files with given content (used to drop conflict markers in). */
  async writeFiles(files: Record<string, string>): Promise<void> {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(this.root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
    }
  }

  /** Commit current changes back to Hiveku's active branch. */
  async commit(): Promise<void> {
    let message = this.sc.inputBox.value.trim();
    if (!message) {
      // Asked here rather than refused: the status bar's change dot runs this
      // command too, and the Source Control box is not on screen then.
      const typed = await vscode.window.showInputBox({
        title: `Save a version of ${this.branch === 'main' ? 'Your site (main)' : this.branch}`,
        prompt: 'Name this version for History: what changed, in plain words.',
        placeHolder: 'e.g. Updated the pricing section on the Home page',
        validateInput: (v: string) => versionNameProblem(v),
      });
      if (typed === undefined) return;
      message = typed.trim();
    }
    // The server keeps a VS Code version name exactly as sent, so the plain-
    // language rule (no paths, file types, "fix:" or "AI:") is checked here.
    const nameProblem = versionNameProblem(message);
    if (nameProblem) {
      vscode.window.showWarningMessage(nameProblem);
      return;
    }
    // ALWAYS refresh — never commit from a cached status map.
    //
    // This used to refresh only when statuses was EMPTY, and statuses is
    // populated solely by refresh(). So the common path was: the view refreshed
    // at window open, you or an agent then created three new files, the Changes
    // list still showed the old set, and commit built its file list from that
    // stale map — silently omitting the new files while reporting success.
    // Content of already-tracked files was read fresh at commit time, which
    // made it maximally deceptive: most of the commit was correct.
    await this.refresh();
    if (this.statuses.size === 0) {
      // Versions: "everything is already a version" only when Hiveku said so.
      const outcome = await this.promoteIfUncommitted(message);
      if (outcome !== 'offered') vscode.window.showInformationMessage(nothingToSaveMessage(outcome));
      return;
    }

    // "You're behind" guard. On main: base manifest vs project_files_status.
    // Off main: the recorded working-tree etag vs the live one.
    if (this.branch !== 'main') {
      if (!(await this.confirmBranchNotMoved('Saving a version'))) return;
    }
    if (this.branch === 'main') {
      const rs = await this.remoteStatus();
      if (rs.tracked && (rs.behind.length > 0 || rs.conflict.length > 0)) {
        const detail = rs.conflict.length
          ? `${rs.conflict.length} file(s) you changed also changed on Hiveku (conflict).`
          : `${rs.behind.length} file(s) changed on Hiveku since you pulled.`;
        const choice = await vscode.window.showWarningMessage(
          `Hiveku has moved ahead — ${detail} Saving a version now overwrites those remote changes.`,
          { modal: true },
          'Pull first',
          'Save anyway',
        );
        if (choice === 'Pull first') {
          await vscode.commands.executeCommand('hiveku.pull');
          return;
        }
        if (choice !== 'Save anyway') return;
      }
    }

    const filesToSend = [...this.statuses.entries()].filter(([, k]) => k !== 'deleted').map(([p]) => p);
    const deletedFiles = [...this.statuses.entries()].filter(([, k]) => k === 'deleted').map(([p]) => p);

    const client = await this.clientFactory();
    const files: CommitFile[] = [];
    for (const rel of filesToSend) {
      files.push(await readFileForCommit(this.root, rel));
    }
    // A server with versions records who saved it (source 'vscode').
    const caps = await serverCaps(client);

    // Versions (D1): 409 nothing_to_commit is "already a version", not an error.
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.SourceControl, title: `Saving a version of ${this.branch === 'main' ? 'Your site (main)' : this.branch}…` },
      () => commitVersion(client, this.link.project_id, message, files, deletedFiles, this.branch, caps),
    );
    if (result.outcome === 'nothing') {
      this.log.appendLine(`[commit] ${this.branch}: already a version (nothing_to_commit)`);
      this.sc.inputBox.value = '';
      vscode.window.showInformationMessage('Already saved as a version. Nothing new to save.');
      // The files sent already match Hiveku: re-anchor main's behind-guard. A
      // branch's etag did not move, so the recorded one stays.
      if (this.branch === 'main') await this.captureBaseline().catch(() => undefined);
      await this.refresh();
      return;
    }
    const commit = result.commit;
    this.log.appendLine(
      `[commit] ${this.branch} ${commit.id} "${message}" — ${commit.files_committed} changed, ${commit.files_deleted} deleted`,
    );
    this.link = { ...this.link, last_commit_id: commit.id, last_pull_at: new Date().toISOString() };
    await writeProjectLink(this.root, this.link);
    this.sc.inputBox.value = '';
    vscode.window.showInformationMessage(
      `Saved a version on Hiveku: "${message}" (${commit.files_committed} file(s) saved` +
        (commit.files_deleted ? `, ${commit.files_deleted} deleted` : '') + ').',
    );

    // Local now matches Hiveku — reset the baseline so future behind-detection is accurate.
    if (this.branch === 'main') await this.captureBaseline().catch(() => undefined);
    else await this.recordBranchEtag();
    await this.refresh();
  }

  /**
   * Local tree == branch tree, but the branch's WORKING TREE may still hold
   * edits that never became a commit: a push from this extension, or an
   * agent's project_files_bulk_save({branch}), both write the tree without
   * committing. A commit with NO files promotes them. Returns 'offered' when
   * the user was offered (and took or declined) that path; otherwise why not
   * (versions.ts nothingToSaveMessage words it), so "everything is already a
   * version" is only said when Hiveku said so.
   */
  private async promoteIfUncommitted(message: string): Promise<PromoteOutcome> {
    // Your site (main): versionFlows decides from the server's status whether
    // Hiveku holds changes that are not a version yet (old servers: never).
    if (this.branch === 'main') {
      const client = await this.clientFactory();
      return promoteMainIfUncommitted({
        client,
        projectId: this.link.project_id,
        name: message,
        log: this.log,
        inputBox: this.sc.inputBox,
      });
    }
    let rs: BranchRemoteStatus;
    try {
      rs = await this.branchRemoteStatus();
    } catch {
      return 'unknown';
    }
    if (!rs.uncommitted) return 'clean';
    const choice = await vscode.window.showInformationMessage(
      `No local changes, but branch "${this.branch}" has changes on Hiveku that aren't a version yet (pushed or saved elsewhere). Save them as a version named "${message}"?`,
      { modal: true, detail: 'Saves the branch as it is on Hiveku as a version. No files are uploaded again.' },
      'Save version',
    );
    if (choice !== 'Save version') return 'offered';
    const client = await this.clientFactory();
    const result = await saveVersion(client, this.link.project_id, message, this.branch, await serverCaps(client));
    if (result.outcome === 'saved') {
      this.log.appendLine(`[commit] ${this.branch} ${result.commit.id} "${message}" — promoted working tree`);
      this.link = { ...this.link, last_commit_id: result.commit.id };
      await writeProjectLink(this.root, this.link);
      vscode.window.showInformationMessage(`Saved a version of "${this.branch}": "${message}".`);
    } else {
      vscode.window.showInformationMessage(`"${this.branch}" is already saved as a version.`);
    }
    this.sc.inputBox.value = '';
    // A version does not change a branch's working tree, so its etag is the
    // one read BEFORE the modal (the tree this clean folder matches). A fresh
    // read here could be someone else's save made while the modal was open,
    // and recording it would silence the next "branch changed" warning.
    if (rs.remoteEtag) await this.recordBranchEtag(rs.remoteEtag);
    return 'offered';
  }

  /**
   * Reliable bulk push of ALL local changes to Hiveku, ROUTED BY LANE. This
   * exists because commit() sends everything in ONE project_vcs_commit — fine
   * for a few text edits, but it (a) chokes on hundreds of images / 100MB+
   * (base64 through the MCP transport times out) and (b) puts CDN-servable
   * images in builder_code_versions, which renders in the Fly preview but is
   * dropped from the deploy bundle by asset-build-bypass — so they go missing
   * on deploy. push() instead:
   *   - diffs binary-aware (the main-branch text-only status misses images),
   *   - routes each changed file to the correct lane:
   *       • CDN-servable binary (public/<subdir>/image|font|video) → assets_upload
   *         (builder_project_assets + S3 + CDN — the lane the deploy serves),
   *       • code/text + src/ assets + public/ root → project_files_bulk_save
   *         (builder_code_versions), in small per-batch-verified chunks,
   *   - verifies each batch/upload and reports the exact failed paths.
   */
  async push(): Promise<void> {
    const client = await this.clientFactory();

    // Binary-aware diff — works on main AND branch, and includes images (the
    // main-branch text-only project_files_status would silently drop them).
    // Paged: Your site's whole tree is refused in one answer over 150 MB.
    const tree = await checkoutTree(client, this.link.project_id, this.branch, {
      onNote: (note) => this.log.appendLine(`[push] ${note}`),
    });
    const treeMap = new Map(tree.files.map((f) => [f.path, treeFileHash(f.content, f.encoding)]));
    const localPaths = await walkFiles(this.root);
    const localSet = new Set(localPaths);
    const toSend: string[] = [];
    for (const rel of localPaths) {
      const buf = await fs.readFile(path.join(this.root, rel));
      if (!treeMap.has(rel) || treeMap.get(rel) !== storedHashOf(buf).hash) toSend.push(rel);
    }
    // A remote path missing locally is NOT reliable evidence the user deleted it.
    // walkFiles skips IGNORE_DIRS by NAME at any depth (workspace.ts), so a
    // remote file living under dist/, build/, out/, .cache/ or .claude/ never
    // appears in the local walk and would be classified as a deletion. Never
    // delete those — the local copy simply cannot see them.
    const isUnderIgnoredDir = (rel: string): boolean =>
      rel.split('/').slice(0, -1).some((seg) => IGNORE_DIRS.has(seg));
    const allMissing = [...treeMap.keys()].filter((p) => !localSet.has(p));
    const shielded = allMissing.filter(isUnderIgnoredDir);
    let toDelete = allMissing.filter((p) => !isUnderIgnoredDir(p));
    if (shielded.length > 0) {
      this.log.appendLine(
        `[push] not deleting ${shielded.length} remote path(s) under ignored directories (invisible to the local walk): ${shielded.slice(0, 5).join(', ')}${shielded.length > 5 ? '…' : ''}`,
      );
    }

    if (toSend.length === 0 && toDelete.length === 0) {
      vscode.window.showInformationMessage('Nothing to push — already in sync with Hiveku.');
      return;
    }

    // Same "you're behind" guard as commit(): base manifest on main, the
    // working-tree etag off main.
    if (this.branch !== 'main') {
      if (!(await this.confirmBranchNotMoved('Pushing'))) return;
    }
    if (this.branch === 'main') {
      const rs = await this.remoteStatus();
      if (rs.tracked && (rs.behind.length > 0 || rs.conflict.length > 0)) {
        const detail = rs.conflict.length
          ? `${rs.conflict.length} file(s) you changed also changed on Hiveku (conflict).`
          : `${rs.behind.length} file(s) changed on Hiveku since you pulled.`;
        const choice = await vscode.window.showWarningMessage(
          `Hiveku has moved ahead — ${detail} Pushing now overwrites those remote changes.`,
          { modal: true },
          'Pull first',
          'Push anyway',
        );
        if (choice === 'Pull first') {
          await vscode.commands.executeCommand('hiveku.pull');
          return;
        }
        if (choice !== 'Push anyway') return;
      }
    }

    // Deleting remote files is the one irreversible half of a push, and until
    // now it happened silently: the success toast reported it as an achievement
    // ("Pushed: 12 file(s), 431 deleted"). The "you're behind" guard above only
    // fires when the REMOTE moved — wiping 400 remote assets because the local
    // copy never had them passed straight through. The most common trigger is
    // benign and invisible: hiveku.includeAssetsOnDownload=false means the
    // binaries were never downloaded, so the next push proposes deleting all of
    // them. Name what will go, and require an explicit opt-in.
    if (toDelete.length > 0) {
      const preview = toDelete.slice(0, 10).map((p) => `  • ${p}`).join('\n');
      const more = toDelete.length > 10 ? `\n  …and ${toDelete.length - 10} more` : '';
      const choice = await vscode.window.showWarningMessage(
        `Push will DELETE ${toDelete.length} file(s) from Hiveku.`,
        {
          modal: true,
          detail:
            `These exist on Hiveku but not in this folder:\n${preview}${more}\n\n` +
            `If you downloaded this project without assets, or these live in a folder ` +
            `the extension ignores, they are not really gone — deleting them here removes ` +
            `them from Hiveku for everyone.`,
        },
        'Upload changes only',
        'Upload and delete',
      );
      if (choice === undefined) return;
      if (choice === 'Upload changes only') {
        this.log.appendLine(`[push] user declined ${toDelete.length} deletion(s); uploading changes only`);
        toDelete = [];
      }
      if (toSend.length === 0 && toDelete.length === 0) {
        vscode.window.showInformationMessage('Nothing to push — deletions were skipped.');
        return;
      }
    }

    // Read + lane-classify every changed file up front.
    const ASSET_B64_CAP = 34_000_000; // ~25MB decoded — the assets_upload server cap
    const codeFiles: CommitFile[] = [];
    const assetFiles: CommitFile[] = [];
    const oversized: string[] = [];
    for (const rel of toSend) {
      const cf = await readFileForCommit(this.root, rel);
      if (cf.encoding === 'base64' && isCdnServableAssetPath(rel)) {
        if (cf.content.length > ASSET_B64_CAP) oversized.push(rel);
        else assetFiles.push(cf);
      } else {
        codeFiles.push(cf);
      }
    }

    const BATCH_FILES = 40;
    const BATCH_BYTES = 4_000_000; // well under the server's 20MB cap — sized for MCP-transport reliability
    const failedPaths: string[] = [];
    let saved = 0;
    let deleted = 0;
    // For the version after the push (versionFlows.versionAfterPush): what
    // was deleted, and whether the operator cancelled part of it.
    const deletedPaths: string[] = [];
    let cancelledTotal = 0;
    // Branch pushes report the working-tree fingerprint after each batch; the
    // last one is what the next behind-guard compares against.
    let lastEtag: string | null | undefined;
    if (this.branch !== 'main' && assetFiles.length > 0) {
      // Assets are project-wide: builder_project_assets has no branch axis, so
      // an image pushed from a branch is live for main and every other branch
      // immediately. Say so rather than let the branch title imply isolation.
      this.log.appendLine(
        `[push] assets are shared across branches — ${assetFiles.length} asset(s) upload to the project's asset store, not to "${this.branch}"`,
      );
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Pushing to Hiveku (${this.branch})…`, cancellable: true },
      async (progress, token) => {
        // ── Code lane: batched, per-batch-verified bulk_save ──────────────────
        let batch: CommitFile[] = [];
        let batchBytes = 0;
        let batchNo = 0;
        const flush = async (): Promise<void> => {
          if (batch.length === 0) return;
          batchNo++;
          // A batch can come back PARTIAL: the route stops applying files at its
          // 85s wall budget (under the edge's ~100-120s 524) and names the paths
          // it never attempted. Those are not failures and must not be re-sent
          // as the whole batch (that rewrites every already-saved file and hits
          // the budget again); the loop continues with exactly remaining_paths,
          // bounded so a route that made no progress cannot spin.
          let files = batch;
          let continuations = 0;
          batch = [];
          batchBytes = 0;
          for (let attempt = 1; attempt <= 2; attempt++) {
            let r;
            try {
              // The code lane targets THIS branch's working tree. Before the
              // branch parameter existed this wrote main (the live project)
              // from a branch checkout while the progress title named the
              // branch — silent corruption of the editor working copy.
              r = await api.filesBulkSave(client, this.link.project_id, files, 'vscode: push local changes', this.branch);
            } catch (e) {
              this.log.appendLine(`[push] code batch ${batchNo} attempt ${attempt} threw: ${(e as Error).message}`);
              if (attempt >= 2) failedPaths.push(...files.map((f) => f.path));
              continue;
            }
            saved += r.summary.succeeded;
            if (r.working_tree_etag !== undefined) lastEtag = r.working_tree_etag;
            if (r.partial && r.remaining_paths.length > 0 && r.remaining_paths.length < files.length && continuations < 20) {
              const remaining = new Set(r.remaining_paths);
              this.log.appendLine(
                `[push] code batch ${batchNo}: server stopped at its wall budget after ${r.summary.succeeded}/${files.length}; continuing with ${remaining.size} remaining`,
              );
              files = files.filter((f) => remaining.has(f.path));
              continuations++;
              attempt--; // a continuation is progress, not a retry
              progress.report({ message: `code ${saved}/${codeFiles.length}` });
              continue;
            }
            if (r.summary.succeeded === files.length) return;
            const bad = r.results.filter((x) => !x.ok).map((x) => x.path);
            this.log.appendLine(
              `[push] code batch ${batchNo} attempt ${attempt}: ${r.summary.succeeded}/${files.length} ok; failed: ${bad.join(', ') || '(unknown)'}`,
            );
            if (attempt >= 2) failedPaths.push(...(bad.length ? bad : files.map((f) => f.path)));
          }
        };
        for (const cf of codeFiles) {
          if (batch.length >= BATCH_FILES || (batchBytes > 0 && batchBytes + cf.content.length > BATCH_BYTES)) {
            await flush();
            progress.report({ message: `code ${saved}/${codeFiles.length}` });
          }
          batch.push(cf);
          batchBytes += cf.content.length;
        }
        await flush();

        // ── Asset lane: assets_upload, bounded concurrency, retry once ────────
        let assetDone = 0;
        await runLimited(assetFiles, 5, async (cf) => {
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              await api.assetsUpload(client, this.link.project_id, cf.path, cf.content);
              assetDone++;
              if (assetDone % 10 === 0 || assetDone === assetFiles.length) {
                progress.report({ message: `assets ${assetDone}/${assetFiles.length}` });
              }
              return;
            } catch (e) {
              this.log.appendLine(`[push] asset ${cf.path} attempt ${attempt} failed: ${(e as Error).message}`);
              if (attempt >= 2) failedPaths.push(cf.path);
            }
          }
        });
        saved += assetDone;

        // ── Deletions ─────────────────────────────────────────────────────────
        // Honour cancellation here specifically: this is the irreversible half,
        // and stopping between files leaves a partial but coherent state (the
        // rest simply stay on Hiveku). A cancel button that did nothing would be
        // worse than none, so the token is actually checked each iteration.
        let cancelledDeletes = 0;
        for (const p of toDelete) {
          if (token.isCancellationRequested) {
            cancelledDeletes = toDelete.length - deleted;
            this.log.appendLine(`[push] cancelled — ${cancelledDeletes} deletion(s) not applied`);
            break;
          }
          progress.report({ message: `deleting ${deleted + 1} of ${toDelete.length}…` });
          try {
            await api.fileDelete(client, this.link.project_id, p, this.branch);
            deleted++;
            deletedPaths.push(p);
          } catch (e) {
            this.log.appendLine(`[push] delete failed ${p}: ${(e as Error).message}`);
            failedPaths.push(p);
          }
        }
        cancelledTotal = cancelledDeletes;
        if (cancelledDeletes > 0) {
          void vscode.window.showWarningMessage(
            `Push cancelled — ${deleted} file(s) deleted, ${cancelledDeletes} left on Hiveku. Uploads already sent were kept. Not saved as a version.`,
          );
        }
      },
    );

    if (oversized.length) {
      this.log.appendLine(`[push] SKIPPED oversized assets (>25MB, upload via dashboard): ${oversized.join(', ')}`);
    }
    if (failedPaths.length) {
      this.log.appendLine(`[push] FAILED paths (${failedPaths.length}): ${failedPaths.join(', ')}`);
      vscode.window.showErrorMessage(
        `Push incomplete: ${saved} saved${deleted ? `, ${deleted} deleted` : ''}, ${failedPaths.length} failed${oversized.length ? `, ${oversized.length} too big` : ''}. See the Hiveku output channel, then re-run Push. Not saved as a version until every file is in.`,
      );
    } else {
      vscode.window.showInformationMessage(
        `Pushed to Hiveku: ${saved} file(s)${deleted ? `, ${deleted} deleted` : ''}${oversized.length ? ` (${oversized.length} too big — see output)` : ''}.`,
      );
    }

    if (this.branch === 'main') await this.captureBaseline().catch(() => undefined);
    else if (failedPaths.length === 0) {
      // A push that fully landed makes the local tree the branch's working
      // tree; record its fingerprint so the next guard is against THIS state.
      // A partial push keeps the old etag: the operator is told to re-run
      // Push, and the guard must not silently bless a half-applied tree.
      await this.recordBranchEtag(deleted > 0 ? undefined : lastEtag);
    }

    // Push + version: only a push that FULLY landed becomes a version (a
    // partial or cancelled one says so above and stays unversioned). The name
    // comes from the code lane and the deletions only: shared-library images
    // (assets_upload) are outside versions.
    if (failedPaths.length === 0 && cancelledTotal === 0) {
      // No etag re-read after it: a version moves only the branch's head,
      // never its working tree, so the etag recorded above (what this push's
      // own last save returned) stays right. A re-read could pick up someone
      // else's save made while the name box was open and silence the next
      // "branch changed" warning.
      await versionAfterPush({
        client,
        projectId: this.link.project_id,
        branch: this.branch,
        inputBox: this.sc.inputBox,
        log: this.log,
        changes: {
          added: codeFiles.filter((f) => !treeMap.has(f.path)).map((f) => f.path),
          modified: codeFiles.filter((f) => treeMap.has(f.path)).map((f) => f.path),
          removed: deletedPaths,
        },
      });
    }
    await this.refresh();
  }

  static async tryLoad(
    rootUri: vscode.Uri,
    clientFactory: (accountId: string) => Promise<HivekuMcpClient>,
    log: vscode.OutputChannel,
  ): Promise<HivekuScm | undefined> {
    const link = await readProjectLink(rootUri.fsPath);
    if (!link) return undefined;
    return new HivekuScm(rootUri, link, () => clientFactory(link.account_id), log);
  }
}
