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

export class HivekuScm implements vscode.Disposable {
  readonly sc: vscode.SourceControl;
  private readonly changes: vscode.SourceControlResourceGroup;
  private readonly disposables: vscode.Disposable[] = [];
  private statuses = new Map<string, ChangeKind>();

  constructor(
    private readonly rootUri: vscode.Uri,
    public link: ProjectLink,
    private readonly clientFactory: () => Promise<HivekuMcpClient>,
    private readonly log: vscode.OutputChannel,
  ) {
    this.sc = vscode.scm.createSourceControl('hiveku', `Hiveku: ${link.project_name}`, rootUri);
    this.sc.inputBox.placeholder = 'Commit message (saved to Hiveku)';
    this.sc.acceptInputCommand = { command: 'hiveku.commit', title: 'Commit to Hiveku' };
    this.changes = this.sc.createResourceGroup('changes', 'Changes');
    this.disposables.push(this.sc, this.changes);
  }

  get root(): string {
    return this.rootUri.fsPath;
  }

  dispose(): void {
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
      const tree = await api.vcsCheckout(client, this.link.project_id, this.branch);
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
    this.sc.inputBox.placeholder = `Commit to ${this.branch} (saved to Hiveku)`;

    // When the working tree is fully in sync with remote `main` — which is the
    // state right after a commit made out-of-band (e.g. Claude Code calling
    // project_vcs_commit via MCP) — re-anchor the "you're behind" baseline so it
    // stays accurate. Only fires when local == remote, so it can never mask a
    // genuine behind state (that leaves files in the change set).
    if (this.branch === 'main' && states.length === 0) {
      await captureBaseline(this.root).catch(() => undefined);
    }
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
            `${this.sc.count} uncommitted change(s) in this folder will be LOST — the branch's ` +
            `content replaces local files, and anything not in that branch is deleted. ` +
            `Commit first if you want to keep them.`,
        },
        'Switch',
      );
      if (ok !== 'Switch') return;
    }
    const client = await this.clientFactory();
    const tree = await api.vcsCheckout(client, this.link.project_id, branchName);
    await materializeTree(this.root, tree.files);
    this.link = { ...this.link, branch: branchName, last_pull_at: new Date().toISOString() };
    await writeProjectLink(this.root, this.link);
    await this.refresh();
    vscode.window.showInformationMessage(`Switched to branch "${branchName}".`);
  }

  private resourceState(rel: string, kind: ChangeKind): vscode.SourceControlResourceState {
    const resourceUri = vscode.Uri.file(path.join(this.root, rel));
    const letter = kind === 'modified' ? 'M' : kind === 'added' ? 'A' : 'D';
    return {
      resourceUri,
      decorations: {
        strikeThrough: kind === 'deleted',
        tooltip: `${kind} — ${rel}`,
        light: { badge: letter } as vscode.SourceControlResourceDecorations,
        dark: { badge: letter } as vscode.SourceControlResourceDecorations,
      },
    };
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
    const message = this.sc.inputBox.value.trim();
    if (!message) {
      vscode.window.showWarningMessage('Enter a commit message first.');
      return;
    }
    if (this.statuses.size === 0) {
      await this.refresh();
      if (this.statuses.size === 0) {
        vscode.window.showInformationMessage('Nothing to commit — already in sync with Hiveku.');
        return;
      }
    }

    // "You're behind" guard (main only) — Hiveku may have moved since you pulled.
    if (this.branch === 'main') {
      const rs = await this.remoteStatus();
      if (rs.tracked && (rs.behind.length > 0 || rs.conflict.length > 0)) {
        const detail = rs.conflict.length
          ? `${rs.conflict.length} file(s) you changed also changed on Hiveku (conflict).`
          : `${rs.behind.length} file(s) changed on Hiveku since you pulled.`;
        const choice = await vscode.window.showWarningMessage(
          `Hiveku has moved ahead — ${detail} Committing now overwrites those remote changes.`,
          { modal: true },
          'Pull first',
          'Commit anyway',
        );
        if (choice === 'Pull first') {
          await vscode.commands.executeCommand('hiveku.pull');
          return;
        }
        if (choice !== 'Commit anyway') return;
      }
    }

    const filesToSend = [...this.statuses.entries()].filter(([, k]) => k !== 'deleted').map(([p]) => p);
    const deletedFiles = [...this.statuses.entries()].filter(([, k]) => k === 'deleted').map(([p]) => p);

    const client = await this.clientFactory();
    const files: CommitFile[] = [];
    for (const rel of filesToSend) {
      files.push(await readFileForCommit(this.root, rel));
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.SourceControl, title: `Committing to ${this.branch}…` },
      async () => {
        const commit = await api.vcsCommit(
          client,
          this.link.project_id,
          message,
          files,
          deletedFiles,
          this.branch,
        );
        this.log.appendLine(
          `[commit] ${this.branch} ${commit.id} "${message}" — ${commit.files_committed} changed, ${commit.files_deleted} deleted`,
        );
        this.link = { ...this.link, last_commit_id: commit.id, last_pull_at: new Date().toISOString() };
        await writeProjectLink(this.root, this.link);
        this.sc.inputBox.value = '';
        vscode.window.showInformationMessage(
          `Committed to Hiveku: ${commit.files_committed} file(s) saved` +
            (commit.files_deleted ? `, ${commit.files_deleted} deleted` : ''),
        );
      },
    );

    // Local now matches Hiveku — reset the baseline so future behind-detection is accurate.
    if (this.branch === 'main') await this.captureBaseline().catch(() => undefined);
    await this.refresh();
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
    const tree = await api.vcsCheckout(client, this.link.project_id, this.branch);
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

    // Same "you're behind" guard as commit() (main only).
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
          const files = batch;
          batch = [];
          batchBytes = 0;
          for (let attempt = 1; attempt <= 2; attempt++) {
            let r;
            try {
              r = await api.filesBulkSave(client, this.link.project_id, files, 'vscode: push local changes');
            } catch (e) {
              this.log.appendLine(`[push] code batch ${batchNo} attempt ${attempt} threw: ${(e as Error).message}`);
              if (attempt >= 2) failedPaths.push(...files.map((f) => f.path));
              continue;
            }
            saved += r.summary.succeeded;
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
            await api.fileDelete(client, this.link.project_id, p);
            deleted++;
          } catch (e) {
            this.log.appendLine(`[push] delete failed ${p}: ${(e as Error).message}`);
            failedPaths.push(p);
          }
        }
        if (cancelledDeletes > 0) {
          void vscode.window.showWarningMessage(
            `Push cancelled — ${deleted} file(s) deleted, ${cancelledDeletes} left on Hiveku. Uploads already sent were kept.`,
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
        `Push incomplete: ${saved} saved${deleted ? `, ${deleted} deleted` : ''}, ${failedPaths.length} failed${oversized.length ? `, ${oversized.length} too big` : ''}. See the Hiveku output channel, then re-run Push.`,
      );
    } else {
      vscode.window.showInformationMessage(
        `Pushed to Hiveku: ${saved} file(s)${deleted ? `, ${deleted} deleted` : ''}${oversized.length ? ` (${oversized.length} too big — see output)` : ''}.`,
      );
    }

    if (this.branch === 'main') await this.captureBaseline().catch(() => undefined);
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
