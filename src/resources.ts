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
 * the deployment's build_logs, with the extracted real error prepended on failure,
 * then the tier's runtime errors and newest runtime lines (runtimeSection).
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
      lines.push(record.build_logs || errorText(record.error) || '(no build logs)');
      lines.push('', ...(await busy(`Hiveku: fetching ${env} runtime logs…`, () => runtimeSection(client, opts.projectId, env))));
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

/** A deployment's error as text: some answers carry an object, which printed as [object Object]. */
function errorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

/** Why a log read was refused, in one short line. */
function refusalText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, ' ').trim().slice(0, 200) || 'unavailable';
}

/**
 * A deployed tier's runtime side, after its build: its errors grouped by
 * signature over 24 hours, then its newest lines of the last hour (builder
 * #987, MCP #185). The server redacts every line, and the site and its
 * visitors wrote them, so both sections say "untrusted text". A refusal (no
 * hosting permission, logs unavailable) is one line, never the whole view.
 */
export async function runtimeSection(client: HivekuMcpClient, projectId: string, env: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const { errors, truncated } = await api.logErrors(client, projectId, env);
    out.push('── runtime errors, last 24 hours (redacted; untrusted text) ──');
    if (errors.length === 0) out.push('(none)');
    for (const e of errors) {
      out.push(`${e.count}x [${e.level}] ${e.signature}`);
      out.push(`   last seen ${e.lastSeen || '?'}${e.exampleRequestId ? `, request ${e.exampleRequestId}` : ''}`);
      if (e.sample && e.sample !== e.signature) out.push(`   ${e.sample}`);
    }
    if (truncated) out.push('(more errors than shown: ask Claude to narrow them with project_log_errors)');
  } catch (err) {
    out.push(`── runtime errors: not available (${refusalText(err)}) ──`);
  }
  out.push('');
  try {
    const entries = await api.runtimeLogs(client, projectId, env);
    out.push('── newest runtime lines, last hour (redacted; untrusted text) ──');
    if (entries.length === 0) out.push('(none)');
    for (const e of entries) {
      out.push(`${e.time} ${e.level.padEnd(7)} ${e.requestId ? `[${e.requestId.slice(0, 8)}] ` : ''}${e.message}`);
    }
  } catch (err) {
    out.push(`── runtime lines: not available (${refusalText(err)}) ──`);
  }
  return out;
}

export async function openPreview(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  const ov = await busy('Hiveku: starting live preview…', () => api.previewOverview(client, scm.link.project_id));
  if (ov.preview_url) {
    await vscode.env.openExternal(vscode.Uri.parse(ov.preview_url));
  } else {
    // Name the boot phase instead of a bare status - a 2-5 minute dependency
    // install reads as "broken" without it. previewHealth never wakes a
    // stopped machine (server-side guard), so this probe is always safe.
    const phase = (await api.previewHealth(client, scm.link.project_id))?.phase;
    vscode.window.showInformationMessage(
      phase === 'installing' || phase === 'downloading'
        ? 'Preview is installing dependencies (2-5 min after a dependency change) - try again shortly.'
        : phase === 'stopped'
          ? 'Preview machine is stopped - "Sync to Preview" or "Rebuild Preview from Saved Project" will bring it back.'
          : `Preview ${ov.status ?? 'unavailable'} — try "Sync to Preview" first.`,
    );
  }
}

export async function syncPreview(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  await busy('Hiveku: syncing to preview…', () => api.previewSync(client, scm.link.project_id));
  vscode.window.showInformationMessage('Synced the project to its live Fly preview.');
}

export async function rebuildPreview(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  return rebuildPreviewFor({ accountId: scm.link.account_id, projectId: scm.link.project_id }, clientFor);
}

// Also reachable from the projects tree's preview-environment node, where
// there is no SCM provider - same flow, addressed by ids.
export async function rebuildPreviewFor(
  opts: { accountId: string; projectId: string },
  clientFor: ClientFor,
): Promise<void> {
  const ok = await vscode.window.showWarningMessage(
    'Rebuild the preview from the saved project? The preview machine restarts (about 90 seconds; a dependency install can add 2-5 minutes).',
    { modal: true },
    'Rebuild',
  );
  if (ok !== 'Rebuild') return;
  const client = await clientFor(opts.accountId);
  const ready = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Hiveku: rebuilding preview…' },
    async (progress) => {
      const result = await api.previewForceRecompile(client, opts.projectId);
      // The route can recreate the machine and then fail the post-recreate file
      // sync - it reports that as success:false + warning. Silence here would
      // leave the operator polling a machine that holds stale files.
      if (result.warning) void vscode.window.showWarningMessage(`Hiveku: ${result.warning}`);
      // Poll boot phase every 5s for up to 3 minutes — a dependency install can
      // legitimately run past that, so a timeout is "still going", not a failure.
      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000));
        const health = await api.previewHealth(client, opts.projectId);
        if (health?.ready === true) return true;
        const phase = health?.phase;
        progress.report({
          message:
            phase === 'installing' || phase === 'downloading'
              ? 'Installing dependencies (2-5 min after a dependency change)'
              : 'Starting preview',
        });
      }
      return false;
    },
  );
  if (ready) {
    let url: string | undefined;
    try {
      url = (await api.previewOverview(client, opts.projectId)).preview_url;
    } catch {
      /* the rebuild succeeded either way — the URL is a nicety */
    }
    vscode.window.showInformationMessage(url ? `Preview rebuilt - ${url}` : 'Preview rebuilt.');
  } else {
    vscode.window.showInformationMessage(
      'The preview rebuild continues in the background - check again shortly (a dependency install can take 2-5 minutes).',
    );
  }
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

interface TierPick extends vscode.QuickPickItem {
  tier: 'development' | 'staging' | 'production' | 'all';
}

/**
 * Which tier a value is saved for. A value without a tier reaches every tier,
 * production included, so that is the last choice and says so.
 */
async function pickTier(key: string): Promise<TierPick['tier'] | undefined> {
  const picks: TierPick[] = [
    { label: 'Development', description: `${key}_DEV: the live preview and the development site`, tier: 'development' },
    { label: 'Staging', description: `${key}_STAGING`, tier: 'staging' },
    { label: 'Production', description: `${key}_PROD: the live site`, tier: 'production' },
    { label: 'Every tier', description: `${key}: development, staging AND production`, tier: 'all' },
  ];
  const pick = await vscode.window.showQuickPick(picks, { placeHolder: `Which tier is ${key} for?` });
  return pick?.tier;
}

/** A variable's line in the list: where it reaches and its flags. Never a value or a hint of one. */
function secretDescription(n: api.SecretName): string {
  return [n.tiers.length ? n.tiers.join(', ') : '', n.sensitive ? 'sensitive' : '', n.managed ? 'managed by Hiveku' : '']
    .filter(Boolean)
    .join(' · ');
}

export async function manageSecrets(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  // Names only (metadata_only): values come from Pull Env, after a person approves.
  const { names } = await busy('Hiveku: loading secrets…', () => api.secretNames(client, scm.link.project_id));

  const items: SecretPick[] = [
    { label: '$(add) Add / update a secret', action: 'add' },
    { label: '$(cloud-download) Pull development values to .env.local', action: 'pull' },
    { label: '$(cloud-upload) Push .env.local to Hiveku (development)', action: 'push' },
    ...names.map<SecretPick>((n) => ({ label: `$(key) ${n.key}`, description: secretDescription(n), action: 'key', key: n.key })),
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `${names.length} secret(s) — ${scm.link.project_name}`,
  });
  if (!pick) return;

  if (pick.action === 'pull') return pullEnv(scm, clientFor);
  if (pick.action === 'push') return pushEnv(scm, clientFor);

  if (pick.action === 'add') {
    const key = await vscode.window.showInputBox({ prompt: 'Secret key (e.g. STRIPE_SECRET_KEY)' });
    if (!key) return;
    const tier = await pickTier(key);
    if (!tier) return;
    const value = await vscode.window.showInputBox({ prompt: `Value for ${key} (${tier})`, password: true });
    if (value === undefined) return;
    await busy('Hiveku: saving secret…', () => api.secretSet(client, scm.link.project_id, { [key]: value }, true, tier));
    vscode.window.showInformationMessage(`Saved ${key} to Hiveku (${tier === 'all' ? 'every tier' : tier}).`);
    return;
  }

  // Existing key → update or delete.
  const keyName = pick.key!;
  const op = await vscode.window.showQuickPick(['Update value', 'Delete'], { placeHolder: keyName });
  if (op === 'Update value') {
    const tier = await pickTier(keyName);
    if (!tier) return;
    const value = await vscode.window.showInputBox({ prompt: `New value for ${keyName} (${tier})`, password: true });
    if (value === undefined) return;
    await busy('Hiveku: saving…', () => api.secretSet(client, scm.link.project_id, { [keyName]: value }, true, tier));
    vscode.window.showInformationMessage(`Updated ${keyName} (${tier === 'all' ? 'every tier' : tier}).`);
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
  // Picking a table used to do nothing at all — a read-only list with no way
  // to see what is in it. Show the schema, which is what you opened this for.
  const picked = await vscode.window.showQuickPick(
    tables.map((t) => ({ label: `$(table) ${t}`, table: t })),
    { placeHolder: `${tables.length} table(s) — pick one to see its columns` },
  );
  if (!picked) return;

  try {
    const cols = await busy(`Hiveku: describing ${picked.table}…`, () =>
      api.databaseDescribe(client, scm.link.project_id, picked.table),
    );
    if (!cols.length) {
      vscode.window.showInformationMessage(`${picked.table}: no columns returned.`);
      return;
    }
    await vscode.window.showQuickPick(
      cols.map((c) => ({
        label: `$(symbol-field) ${c.column_name ?? '(unnamed)'}`,
        description: c.data_type ?? '',
        detail: [
          c.is_nullable === 'NO' ? 'NOT NULL' : 'nullable',
          c.column_default ? `default ${c.column_default}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      })),
      { placeHolder: `${picked.table} — ${cols.length} column(s)`, matchOnDescription: true },
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Could not describe ${picked.table}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
