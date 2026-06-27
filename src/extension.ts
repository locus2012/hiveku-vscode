/**
 * Hiveku VS Code extension — Phase 1.
 *
 * Lets a developer (or Claude Code) connect one or more Hiveku accounts, do a
 * full download of a site project into a local folder, and commit/deploy back
 * to Hiveku. Commits live entirely in Supabase (no GitHub). The native Source
 * Control panel shows local-vs-Hiveku changes; the project's `main` branch is
 * bootstrapped lazily on first download.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { AccountStore } from './accounts';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import { downloadAndExtract } from './download';
import { HivekuScm } from './scm';
import { writeProjectLink, type ProjectLink } from './workspace';

let accounts: AccountStore;
let log: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;
const scms = new Map<string, HivekuScm>();

function baseUrl(): string {
  return vscode.workspace.getConfiguration('hiveku').get<string>('baseUrl', 'https://core.hiveku.com');
}

function clientForAccount(accountId: string): Promise<HivekuMcpClient> {
  return accounts.getClient(accountId, baseUrl());
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  accounts = new AccountStore(context);
  log = vscode.window.createOutputChannel('Hiveku');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'hiveku.switchAccount';
  context.subscriptions.push(log, statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('hiveku.signIn', () => signIn()),
    vscode.commands.registerCommand('hiveku.switchAccount', () => switchAccount()),
    vscode.commands.registerCommand('hiveku.signOut', () => signOut()),
    vscode.commands.registerCommand('hiveku.cloneProject', () => cloneProject()),
    vscode.commands.registerCommand('hiveku.refresh', () => withScm((s) => s.refresh())),
    vscode.commands.registerCommand('hiveku.commit', () => withScm((s) => s.commit())),
    vscode.commands.registerCommand('hiveku.showHistory', () => withScm((s) => showHistory(s))),
    vscode.commands.registerCommand('hiveku.revert', () => withScm((s) => revert(s))),
    vscode.commands.registerCommand('hiveku.deploy', () => withScm((s) => deploy(s))),
    vscode.commands.registerCommand('hiveku.pull', () => withScm((s) => pull(s))),
    vscode.commands.registerCommand('hiveku.createBranch', () => withScm((s) => createBranch(s))),
    vscode.commands.registerCommand('hiveku.switchBranch', () => withScm((s) => switchBranch(s))),
    vscode.commands.registerCommand('hiveku.merge', () => withScm((s) => merge(s))),
    vscode.commands.registerCommand('hiveku.previewBranch', () => withScm((s) => previewBranch(s))),
    vscode.commands.registerCommand('hiveku.compare', () => withScm((s) => compare(s))),
    vscode.commands.registerCommand('hiveku.prune', () => withScm((s) => prune(s))),
    vscode.workspace.onDidChangeWorkspaceFolders(() => loadWorkspaceScms()),
  );

  await loadWorkspaceScms();
  refreshStatusBar();
}

export function deactivate(): void {
  for (const s of scms.values()) s.dispose();
  scms.clear();
}

async function loadWorkspaceScms(): Promise<void> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const key = folder.uri.fsPath;
    if (scms.has(key)) continue;
    const scm = await HivekuScm.tryLoad(folder.uri, clientForAccount, log);
    if (scm) {
      scms.set(key, scm);
      scm.refresh().catch((e) => log.appendLine(`[refresh] ${String(e)}`));
    }
  }
  refreshStatusBar();
}

function refreshStatusBar(): void {
  const list = accounts.list();
  if (scms.size === 1) {
    const scm = [...scms.values()][0];
    statusBar.text = `$(cloud) Hiveku: ${scm.link.project_name} $(git-branch) ${scm.branch}`;
    statusBar.tooltip = `Account: ${scm.link.account_label}\nBranch: ${scm.branch}`;
    statusBar.show();
  } else if (list.length > 0) {
    statusBar.text = `$(cloud) Hiveku (${list.length} account${list.length === 1 ? '' : 's'})`;
    statusBar.tooltip = 'Hiveku — click to switch account';
    statusBar.show();
  } else {
    statusBar.hide();
  }
}

async function getActiveScm(): Promise<HivekuScm | undefined> {
  if (scms.size === 0) return undefined;
  if (scms.size === 1) return [...scms.values()][0];
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const folder = vscode.workspace.getWorkspaceFolder(active);
    if (folder && scms.has(folder.uri.fsPath)) return scms.get(folder.uri.fsPath);
  }
  const pick = await vscode.window.showQuickPick(
    [...scms.values()].map((s) => ({ label: s.link.project_name, scm: s })),
    { placeHolder: 'Which Hiveku project?' },
  );
  return pick?.scm;
}

async function withScm(fn: (scm: HivekuScm) => Promise<void>): Promise<void> {
  const scm = await getActiveScm();
  if (!scm) {
    vscode.window.showWarningMessage('No Hiveku project in this workspace. Run "Hiveku: Download Project…".');
    return;
  }
  try {
    await fn(scm);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.appendLine(`[error] ${msg}`);
    vscode.window.showErrorMessage(`Hiveku: ${msg}`);
  }
}

async function signIn(): Promise<void> {
  const key = await vscode.window.showInputBox({
    prompt: 'Paste your Hiveku MCP API key (from Settings → LLM Connectors)',
    password: true,
    ignoreFocusOut: true,
  });
  if (!key) return;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Validating Hiveku key…' },
    async () => {
      const record = await accounts.signIn(key, baseUrl());
      vscode.window.showInformationMessage(`Connected Hiveku account: ${record.label}`);
    },
  );
  refreshStatusBar();
}

async function switchAccount(): Promise<void> {
  if (accounts.list().length === 0) {
    const choice = await vscode.window.showInformationMessage('No Hiveku accounts connected.', 'Sign In');
    if (choice === 'Sign In') await signIn();
    return;
  }
  const record = await accounts.pick('Switch active Hiveku account');
  if (record) vscode.window.showInformationMessage(`Active account: ${record.label}`);
}

async function signOut(): Promise<void> {
  const record = await accounts.pick('Remove which Hiveku account?');
  if (!record) return;
  await accounts.signOut(record.accountId);
  vscode.window.showInformationMessage(`Removed Hiveku account: ${record.label}`);
  refreshStatusBar();
}

async function cloneProject(): Promise<void> {
  let account = await accounts.pick('Download from which account?');
  if (!account) {
    const choice = await vscode.window.showInformationMessage(
      'Connect a Hiveku account first.',
      'Sign In',
    );
    if (choice !== 'Sign In') return;
    await signIn();
    account = await accounts.pick('Download from which account?');
    if (!account) return;
  }

  const client = await clientForAccount(account.accountId);
  const projects = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Loading Hiveku projects…' },
    () => api.listProjects(client),
  );
  if (projects.length === 0) {
    vscode.window.showInformationMessage('No projects on this account.');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    projects.map((p) => ({
      label: p.name || p.slug || p.id,
      description: p.project_type ?? '',
      detail: p.id,
      project: p,
    })),
    { placeHolder: 'Select a project to download', matchOnDetail: true },
  );
  if (!picked) return;

  const parent = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Download here',
    title: 'Choose a folder to download the project into',
  });
  if (!parent || parent.length === 0) return;

  const folderName = sanitize(picked.project.slug || picked.project.name || picked.project.id);
  const destRoot = path.join(parent[0].fsPath, folderName);
  const includeAssets = vscode.workspace
    .getConfiguration('hiveku')
    .get<boolean>('includeAssetsOnDownload', true);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Downloading ${picked.label}…` },
    async (progress) => {
      progress.report({ message: 'preparing snapshot' });
      const snap = await api.snapshotUrl(client, picked.project.id, includeAssets);
      progress.report({ message: `extracting ${snap.file_count} files` });
      await downloadAndExtract(snap.download_url, destRoot);

      progress.report({ message: 'initializing version control' });
      // Lazily bootstrap the project's `main` branch + initial commit.
      const branches = await api.vcsBranches(client, picked.project.id).catch(() => []);
      const defaultBranch = branches.find((b) => b.is_default)?.branch_name ?? 'main';

      const link: ProjectLink = {
        project_id: picked.project.id,
        account_id: account!.accountId,
        account_label: account!.label,
        project_name: picked.project.name || picked.project.slug || picked.project.id,
        branch: defaultBranch,
        base_url: baseUrl(),
        last_pull_at: new Date().toISOString(),
      };
      await writeProjectLink(destRoot, link);
    },
  );

  const open = await vscode.window.showInformationMessage(
    `Downloaded ${picked.label}. Open it now?`,
    'Open in New Window',
    'Open Here',
  );
  if (open === 'Open in New Window') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(destRoot), true);
  } else if (open === 'Open Here') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(destRoot), false);
  }
}

async function showHistory(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const history = await api.vcsHistory(client, scm.link.project_id, 100);
  if (history.length === 0) {
    vscode.window.showInformationMessage('No commits yet.');
    return;
  }
  await vscode.window.showQuickPick(
    history.map((c) => ({
      label: c.message,
      description: new Date(c.created_at).toLocaleString(),
      detail: `${c.files_committed} changed, ${c.files_deleted} deleted${c.checkpoint_hash ? ` · ${c.checkpoint_hash}` : ''}`,
    })),
    { placeHolder: `History — ${scm.link.project_name}` },
  );
}

async function revert(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const history = await api.vcsHistory(client, scm.link.project_id, 100);
  const restorable = history.filter((c) => c.checkpoint_hash);
  if (restorable.length === 0) {
    vscode.window.showInformationMessage('No restorable commits found.');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    restorable.map((c) => ({
      label: c.message,
      description: new Date(c.created_at).toLocaleString(),
      detail: c.checkpoint_hash!,
      commit: c,
    })),
    { placeHolder: 'Revert the project to which commit? (restores its snapshot)' },
  );
  if (!pick) return;
  const confirm = await vscode.window.showWarningMessage(
    `Revert "${scm.link.project_name}" to "${pick.commit.message}"? This restores that snapshot on Hiveku, then re-downloads it locally.`,
    { modal: true },
    'Revert',
  );
  if (confirm !== 'Revert') return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Reverting…' },
    async () => {
      await api.checkpointRestore(client, scm.link.project_id, pick.commit.checkpoint_hash!);
      await pullInto(scm, client);
    },
  );
  await scm.refresh();
  vscode.window.showInformationMessage(`Reverted to "${pick.commit.message}".`);
}

async function createBranch(scm: HivekuScm): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: `Create a branch off "${scm.branch}"`,
    placeHolder: 'e.g. wip, feature-x',
    validateInput: (v) =>
      /^[A-Za-z0-9._/-]+$/.test(v.trim()) ? undefined : 'letters, numbers, and . _ / - only',
  });
  if (!name) return;
  const client = await clientForAccount(scm.link.account_id);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating branch ${name.trim()}…` },
    () => api.vcsBranchCreate(client, scm.link.project_id, name.trim(), scm.branch),
  );
  const choice = await vscode.window.showInformationMessage(`Created branch "${name.trim()}".`, 'Switch to it');
  if (choice === 'Switch to it') await scm.switchBranch(name.trim());
}

async function switchBranch(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const branches = await api.vcsBranches(client, scm.link.project_id);
  const pick = await vscode.window.showQuickPick(
    branches.map((b) => ({
      label: b.branch_name,
      description: b.is_default ? 'default' : b.branch_name === scm.branch ? 'current' : '',
    })),
    { placeHolder: `Current: ${scm.branch} — switch to…` },
  );
  if (!pick || pick.label === scm.branch) return;
  await scm.switchBranch(pick.label);
  refreshStatusBar();
}

async function merge(scm: HivekuScm): Promise<void> {
  if (scm.branch === 'main') {
    vscode.window.showInformationMessage('Switch to a branch first to merge it into main.');
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Merge "${scm.branch}" into main? Non-conflicting changes apply to the live project; conflicts are flagged, not overwritten.`,
    { modal: true },
    'Merge',
  );
  if (confirm !== 'Merge') return;
  const client = await clientForAccount(scm.link.account_id);
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Merging ${scm.branch} into main…` },
    () => api.vcsMerge(client, scm.link.project_id, scm.branch),
  );
  log.appendLine(
    `[merge] ${scm.branch}→main applied=${result.applied.length} (auto-merged=${result.auto_merged.length}) deleted=${result.deleted.length} conflicts=${result.conflicts.length}`,
  );
  const autoNote = result.auto_merged.length ? `, ${result.auto_merged.length} auto-merged line-by-line` : '';
  if (result.conflicts.length > 0) {
    log.appendLine(`[merge] conflicts: ${result.conflicts.join(', ')}`);
    const choice = await vscode.window.showWarningMessage(
      `Merged ${result.applied.length} file(s)${autoNote}, but ${result.conflicts.length} need manual resolution: ` +
        `${result.conflicts.slice(0, 4).join(', ')}${result.conflicts.length > 4 ? '…' : ''}.`,
      'Resolve on main',
    );
    if (choice === 'Resolve on main') {
      // Switch the workspace to main, drop the conflict-marked merges in, and open them.
      await scm.switchBranch('main');
      const details = result.conflict_details ?? {};
      await scm.writeFiles(details);
      await scm.refresh();
      const first = Object.keys(details)[0];
      if (first) {
        await vscode.window.showTextDocument(vscode.Uri.file(`${scm.root}/${first}`));
      }
      vscode.window.showInformationMessage(
        'Conflict markers written on main. Resolve <<<<<<< ======= >>>>>>> markers, then commit.',
      );
    }
  } else {
    vscode.window.showInformationMessage(
      `Merged "${scm.branch}" into main — ${result.applied.length} file(s) applied${autoNote}.`,
    );
  }
}

async function compare(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const branches = await api.vcsBranches(client, scm.link.project_id);
  const others = branches.filter((b) => b.branch_name !== scm.branch);
  if (others.length === 0) {
    vscode.window.showInformationMessage('No other branch to compare against.');
    return;
  }
  const base = await vscode.window.showQuickPick(
    others.map((b) => ({ label: b.branch_name, description: b.is_default ? 'default' : '' })),
    { placeHolder: `Compare ${scm.branch} against…` },
  );
  if (!base) return;
  const res = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Comparing ${base.label} → ${scm.branch}…` },
    () => api.vcsCompare(client, scm.link.project_id, base.label, scm.branch),
  );
  if (res.entries.length === 0) {
    vscode.window.showInformationMessage(`No differences between ${base.label} and ${scm.branch}.`);
    return;
  }
  await vscode.window.showQuickPick(
    res.entries.map((e) => ({
      label: `${e.status === 'added' ? '$(diff-added)' : e.status === 'removed' ? '$(diff-removed)' : '$(diff-modified)'} ${e.path}`,
      description: e.status,
    })),
    { placeHolder: `${base.label} → ${scm.branch}:  +${res.added}  -${res.removed}  ~${res.modified}` },
  );
}

async function prune(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const dry = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning branch storage…' },
    () => api.vcsPrune(client, scm.link.project_id, true),
  );
  if (dry.orphaned.length === 0) {
    vscode.window.showInformationMessage(
      `Nothing to prune — ${dry.scanned} tree object(s), all in use.`,
    );
    return;
  }
  const ok = await vscode.window.showWarningMessage(
    `Delete ${dry.orphaned.length} orphaned branch-tree object(s)? (${dry.scanned} scanned, ${dry.referenced} in use.)`,
    { modal: true },
    'Delete',
  );
  if (ok !== 'Delete') return;
  const res = await api.vcsPrune(client, scm.link.project_id, false);
  vscode.window.showInformationMessage(`Pruned ${res.deleted} orphaned branch-tree object(s).`);
}

async function previewBranch(scm: HivekuScm): Promise<void> {
  if (scm.branch === 'main') {
    vscode.window.showInformationMessage('This previews a branch. For main, use the project\'s normal preview.');
    return;
  }
  const client = await clientForAccount(scm.link.account_id);
  const res = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Starting Fly preview for ${scm.branch}…` },
    () => api.vcsBranchPreview(client, scm.link.project_id, scm.branch),
  );
  if (res.previewUrl) {
    const open = await vscode.window.showInformationMessage(
      `Branch preview ${res.status} — ${res.filesSynced} file(s) synced${res.filesFailed ? `, ${res.filesFailed} failed` : ''}.`,
      'Open Preview',
    );
    if (open === 'Open Preview') await vscode.env.openExternal(vscode.Uri.parse(res.previewUrl));
  } else {
    vscode.window.showErrorMessage(`Branch preview failed: ${res.error ?? res.status}`);
  }
}

async function deploy(scm: HivekuScm): Promise<void> {
  const env = await vscode.window.showQuickPick(
    [
      { label: 'development', description: 'Safe default — fast turnaround' },
      { label: 'staging', description: 'Must be enabled per project' },
      { label: 'production', description: 'Go live' },
    ],
    { placeHolder: 'Deploy to which environment?' },
  );
  if (!env) return;
  const client = await clientForAccount(scm.link.account_id);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Deploying to ${env.label}…` },
    async () => {
      const res = await api.deploySite(
        client,
        scm.link.project_id,
        env.label as 'development' | 'staging' | 'production',
      );
      log.appendLine(`[deploy] ${env.label} → ${res.deployment_id ?? '(no id)'} ${res.status ?? ''}`);
      vscode.window.showInformationMessage(
        `Deploy to ${env.label} started${res.deployment_id ? ` (${res.deployment_id})` : ''}.`,
      );
    },
  );
}

async function pull(scm: HivekuScm): Promise<void> {
  if ((scm.sc.count ?? 0) > 0) {
    const choice = await vscode.window.showWarningMessage(
      'You have uncommitted local changes. Pulling overwrites tracked files with Hiveku\'s current state. Continue?',
      { modal: true },
      'Pull anyway',
    );
    if (choice !== 'Pull anyway') return;
  }
  const client = await clientForAccount(scm.link.account_id);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Pulling latest from Hiveku…' },
    () => pullInto(scm, client),
  );
  await scm.refresh();
  vscode.window.showInformationMessage('Pulled latest from Hiveku.');
}

async function pullInto(scm: HivekuScm, client: HivekuMcpClient): Promise<void> {
  const includeAssets = vscode.workspace
    .getConfiguration('hiveku')
    .get<boolean>('includeAssetsOnDownload', true);
  const snap = await api.snapshotUrl(client, scm.link.project_id, includeAssets);
  await downloadAndExtract(snap.download_url, scm.root);
  scm.link = { ...scm.link, last_pull_at: new Date().toISOString() };
  await writeProjectLink(scm.root, scm.link);
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'hiveku-project';
}
