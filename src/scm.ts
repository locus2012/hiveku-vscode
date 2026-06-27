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
  materializeTree,
  readFileForCommit,
  readProjectLink,
  storedHashOf,
  treeFileHash,
  walkFiles,
  writeProjectLink,
  type CommitFile,
  type ProjectLink,
} from './workspace';

type ChangeKind = 'modified' | 'added' | 'deleted';

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
  }

  /** Switch the working tree to another branch (materializes its content). */
  async switchBranch(branchName: string): Promise<void> {
    if ((this.sc.count ?? 0) > 0) {
      const ok = await vscode.window.showWarningMessage(
        `Switch to "${branchName}"? This overwrites local files with that branch's content; uncommitted changes will be lost.`,
        { modal: true },
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
