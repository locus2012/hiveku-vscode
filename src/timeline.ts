/**
 * Hiveku file history — a publishable alternative to VS Code's proposed-only
 * Timeline API. "Hiveku: File History" lists a project file's Hiveku version
 * history (project_file_versions); you can compare any version with current
 * (a read-only unified-diff doc) or restore it (project_file_restore).
 */

import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';

export interface ResolvedFile {
  accountId: string;
  projectId: string;
  relPath: string;
}
export type FileResolver = (uri: vscode.Uri) => ResolvedFile | undefined;

const DIFF_SCHEME = 'hiveku-version';

export function registerFileHistory(
  context: vscode.ExtensionContext,
  resolve: FileResolver,
  clientFor: (accountId: string) => Promise<HivekuMcpClient>,
): void {
  const diffProvider: vscode.TextDocumentContentProvider = {
    async provideTextDocumentContent(docUri: vscode.Uri): Promise<string> {
      const p = new URLSearchParams(docUri.query);
      try {
        const client = await clientFor(p.get('account') ?? '');
        return await api.fileDiff(client, p.get('project') ?? '', p.get('path') ?? '', Number(p.get('version') ?? '0'));
      } catch (err) {
        return `Failed to load diff: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffProvider),
    vscode.commands.registerCommand('hiveku.fileHistory', () => showHistory(resolve, clientFor)),
    vscode.commands.registerCommand('hiveku.openFileVersionDiff', (arg: ResolvedFile & { version: number }) =>
      openDiff(arg),
    ),
    vscode.commands.registerCommand('hiveku.restoreFileVersion', (arg: ResolvedFile & { version: number }) =>
      restore(arg, clientFor),
    ),
  );
}

async function showHistory(
  resolve: FileResolver,
  clientFor: (accountId: string) => Promise<HivekuMcpClient>,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a file from a downloaded Hiveku project first.');
    return;
  }
  const target = resolve(editor.document.uri);
  if (!target) {
    vscode.window.showInformationMessage('This file is not in a downloaded Hiveku project.');
    return;
  }
  try {
    const client = await clientFor(target.accountId);
    const versions = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Loading Hiveku history…' },
      () => api.fileVersions(client, target.projectId, target.relPath),
    );
    if (versions.length === 0) {
      vscode.window.showInformationMessage('No Hiveku version history for this file.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      versions.map((v) => ({
        label: v.commit_message || `Version ${v.version_number}`,
        description: `v${v.version_number}${v.is_current ? ' · current' : ''} · ${new Date(v.created_at).toLocaleString()}`,
        version: v,
      })),
      { placeHolder: `Hiveku history — ${target.relPath}` },
    );
    if (!pick) return;
    if (pick.version.is_current) {
      vscode.window.showInformationMessage('That is the current version.');
      return;
    }
    const arg = { ...target, version: pick.version.version_number };
    const action = await vscode.window.showQuickPick(
      [
        { label: '$(diff) Compare with current', id: 'diff' },
        { label: '$(discard) Restore this version', id: 'restore' },
      ],
      { placeHolder: `v${pick.version.version_number}` },
    );
    if (!action) return;
    if (action.id === 'diff') await openDiff(arg);
    else await restore(arg, clientFor);
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function openDiff(arg: ResolvedFile & { version: number }): Promise<void> {
  if (!arg) return;
  const uri = vscode.Uri.parse(
    `${DIFF_SCHEME}:${arg.relPath} (v${arg.version} → current).diff` +
      `?account=${encodeURIComponent(arg.accountId)}&project=${encodeURIComponent(arg.projectId)}` +
      `&path=${encodeURIComponent(arg.relPath)}&version=${arg.version}`,
  );
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(doc, 'diff');
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function restore(
  arg: ResolvedFile & { version: number },
  clientFor: (accountId: string) => Promise<HivekuMcpClient>,
): Promise<void> {
  if (!arg) return;
  const ok = await vscode.window.showWarningMessage(
    `Restore "${arg.relPath}" to v${arg.version}? This writes it as a new current version in Hiveku.`,
    { modal: true },
    'Restore',
  );
  if (ok !== 'Restore') return;
  try {
    const client = await clientFor(arg.accountId);
    await api.fileRestore(client, arg.projectId, arg.relPath, arg.version);
    vscode.window.showInformationMessage(
      `Restored ${arg.relPath} to v${arg.version}. Pull the latest from Hiveku to update your local copy.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${err instanceof Error ? err.message : String(err)}`);
  }
}
