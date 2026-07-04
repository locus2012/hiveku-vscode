/**
 * Project "command center" surfaces beyond code: the Fly preview, project
 * secrets (AWS Secrets Manager), the database, and media/assets (S3). Each
 * operates on the active downloaded project via its HivekuScm link.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import { HivekuScm } from './scm';
import { pullEnv, pushEnv } from './env';

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;

function busy<T>(title: string, fn: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, fn);
}

/** Environment identifier for the site-links + logs surfaces. */
export type EnvKind = 'preview' | api.EnvId;

const ENV_LABEL: Record<EnvKind, string> = {
  preview: 'Live Preview',
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
};

/**
 * Show a project environment's logs in an OutputChannel AND (when a local project
 * folder is known) write the same text to `.hiveku/logs/<env>.log` so Claude Code
 * reads exactly what the user sees. Preview = Fly runtime logs; deployed tiers =
 * the deployment's build_logs, with the extracted real error prepended on failure.
 */
export async function showEnvLogs(
  opts: { accountId: string; projectId: string; projectName?: string; env: EnvKind; folder?: string },
  clientFor: ClientFor,
  output: vscode.OutputChannel,
): Promise<void> {
  const client = await clientFor(opts.accountId);
  const name = opts.projectName ?? opts.projectId;
  const lines: string[] = [];

  if (opts.env === 'preview') {
    const logs = await busy('Hiveku: fetching preview logs…', () => api.previewLogs(client, opts.projectId, 300));
    lines.push(`# ${ENV_LABEL.preview} (Fly) runtime logs — ${name}`, '', logs || '(no logs)');
  } else {
    const env = opts.env;
    const status = await busy(`Hiveku: fetching ${env} deployment…`, () => api.deployStatus(client, opts.projectId, env));
    let dep = status.most_recent;
    if (!dep) {
      // Legacy deployments store other environment tokens (e.g. "cloudfront" for
      // older production deploys) — the filtered query misses them. Fall back to
      // the unfiltered latest so a site that deploys weekly never reads "none".
      const any = await api.deployStatus(client, opts.projectId, undefined);
      dep = any.most_recent;
    }
    if (!dep) {
      lines.push(`# ${ENV_LABEL[env]} — no deployments yet for ${name}`);
    } else {
      let record = dep;
      const depId = dep.deployment_id || dep.id;
      if (depId && !dep.build_logs) {
        try {
          record = await busy(`Hiveku: fetching ${env} build logs…`, () => api.deployGet(client, opts.projectId, depId));
        } catch {
          /* keep the status record if the single-deployment fetch fails */
        }
      }
      lines.push(
        `# ${ENV_LABEL[env]} deployment — ${name}`,
        `deployment: ${record.deployment_id || record.id || '?'}`,
        `status: ${record.status || '?'}`,
      );
      if (record.url) lines.push(`url: ${record.url}`);
      lines.push('');
      const failed = /fail|error/i.test(record.status || '') || !!record.error;
      if (failed) {
        const be = await api.projectBuildErrorGet(client, opts.projectId);
        if (be && (be.error_summary || be.last_log_lines?.length)) {
          lines.push('── error ───────────────────────────────────────────────');
          if (be.error_summary) lines.push(be.error_summary);
          if (be.last_log_lines?.length) lines.push('', ...be.last_log_lines);
          lines.push('── full build log ──────────────────────────────────────');
        }
      }
      lines.push(record.build_logs || record.error || '(no build logs)');
    }
  }

  const text = lines.join('\n');
  output.clear();
  output.appendLine(text);
  output.show(true);

  // Shared surface for Claude Code — same content on disk (gitignored .hiveku/).
  if (opts.folder) {
    try {
      const dir = path.join(opts.folder, '.hiveku', 'logs');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${opts.env}.log`), text + '\n', 'utf8');
    } catch {
      /* best-effort local mirror */
    }
  }
}

export async function openPreview(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  const ov = await busy('Hiveku: starting live preview…', () => api.previewOverview(client, scm.link.project_id));
  if (ov.preview_url) {
    await vscode.env.openExternal(vscode.Uri.parse(ov.preview_url));
  } else {
    vscode.window.showInformationMessage(`Preview ${ov.status ?? 'unavailable'} — try "Sync to Preview" first.`);
  }
}

export async function syncPreview(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  await busy('Hiveku: syncing to preview…', () => api.previewSync(client, scm.link.project_id));
  vscode.window.showInformationMessage('Synced the project to its live Fly preview.');
}

export async function previewLogs(scm: HivekuScm, clientFor: ClientFor, output: vscode.OutputChannel): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  const logs = await busy('Hiveku: fetching preview logs…', () => api.previewLogs(client, scm.link.project_id, 300));
  output.clear();
  output.appendLine(`# Fly preview logs — ${scm.link.project_name}\n`);
  output.appendLine(logs);
  output.show(true);
}

export async function previewScreenshot(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const pathInside = await vscode.window.showInputBox({
    prompt: 'Page path to screenshot',
    value: '/',
  });
  if (pathInside === undefined) return;
  const client = await clientFor(scm.link.account_id);
  const url = await busy('Hiveku: capturing screenshot…', () =>
    api.previewScreenshot(client, scm.link.project_id, pathInside || '/'),
  );
  if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
  else vscode.window.showWarningMessage('No screenshot URL returned.');
}

interface SecretPick extends vscode.QuickPickItem {
  action: 'add' | 'pull' | 'push' | 'key';
  key?: string;
}

export async function manageSecrets(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  const secrets = await busy('Hiveku: loading secrets…', () => api.secretsList(client, scm.link.project_id));

  const items: SecretPick[] = [
    { label: '$(add) Add / update a secret', action: 'add' },
    { label: '$(cloud-download) Pull all to .env.local', action: 'pull' },
    { label: '$(cloud-upload) Push .env.local to Hiveku', action: 'push' },
    ...secrets.map<SecretPick>((s) => ({ label: `$(key) ${s.key}`, description: s.preview, action: 'key', key: s.key })),
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `${secrets.length} secret(s) — ${scm.link.project_name}`,
  });
  if (!pick) return;

  if (pick.action === 'pull') return pullEnv(scm, clientFor);
  if (pick.action === 'push') return pushEnv(scm, clientFor);

  if (pick.action === 'add') {
    const key = await vscode.window.showInputBox({ prompt: 'Secret key (e.g. STRIPE_SECRET_KEY)' });
    if (!key) return;
    const value = await vscode.window.showInputBox({ prompt: `Value for ${key}`, password: true });
    if (value === undefined) return;
    await busy('Hiveku: saving secret…', () => api.secretSet(client, scm.link.project_id, { [key]: value }));
    vscode.window.showInformationMessage(`Saved secret ${key} to Hiveku.`);
    return;
  }

  // Existing key → update or delete.
  const keyName = pick.key!;
  const op = await vscode.window.showQuickPick(['Update value', 'Delete'], { placeHolder: keyName });
  if (op === 'Update value') {
    const value = await vscode.window.showInputBox({ prompt: `New value for ${keyName}`, password: true });
    if (value === undefined) return;
    await busy('Hiveku: saving…', () => api.secretSet(client, scm.link.project_id, { [keyName]: value }));
    vscode.window.showInformationMessage(`Updated ${keyName}.`);
  } else if (op === 'Delete') {
    const ok = await vscode.window.showWarningMessage(`Delete secret ${keyName} from Hiveku?`, { modal: true }, 'Delete');
    if (ok !== 'Delete') return;
    await busy('Hiveku: deleting…', () => api.secretDelete(client, scm.link.project_id, keyName));
    vscode.window.showInformationMessage(`Deleted ${keyName}.`);
  }
}

export async function showDatabase(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  const [status, tables] = await busy('Hiveku: loading database…', async () => {
    const s = await api.databaseStatus(client, scm.link.project_id);
    let t: string[] = [];
    try {
      t = await api.databaseTables(client, scm.link.project_id);
    } catch {
      /* not provisioned */
    }
    return [s, t] as const;
  });
  const provisioned = status.provisioned ?? status.connected ?? status.status;
  if (!tables.length) {
    vscode.window.showInformationMessage(
      `Database: ${provisioned ? String(provisioned) : 'not provisioned'} — no tables.`,
    );
    return;
  }
  await vscode.window.showQuickPick(tables.map((t) => `$(table) ${t}`), {
    placeHolder: `${tables.length} table(s) — ${scm.link.project_name}`,
  });
}

export async function showMedia(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  const items = await busy('Hiveku: loading media…', () => api.mediaList(client, scm.link.project_id));
  if (!items.length) {
    vscode.window.showInformationMessage('No media/assets for this project.');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    items.map((m) => ({
      label: `$(file-media) ${m.name || m.file_path || '(asset)'}`,
      description: m.mime_type ?? '',
      url: m.cdn_url || m.url,
    })),
    { placeHolder: `${items.length} asset(s) — open in browser`, matchOnDescription: true },
  );
  if (pick?.url) await vscode.env.openExternal(vscode.Uri.parse(pick.url));
}
