/**
 * Pull / push a project's environment secrets between Hiveku (AWS Secrets
 * Manager) and a local `.env.local`, so a downloaded project can run locally
 * against the same configuration the Fly preview + deployed Lambdas use.
 *
 * Resolution mirrors the server (`project_secrets_set` preview rule): for local
 * dev we skip `_PROD` / `_PRODUCTION` / `_STAGING` keys and let a `_DEV`-suffixed
 * key override its base name. Real values touch disk only in `.env.local`, which
 * we keep gitignored.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import { HivekuScm } from './scm';

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;
const ENV_FILE = '.env.local';

/** Map Hiveku secrets to the env a LOCAL dev server should see. */
export function resolveLocalEnv(secrets: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(secrets)) {
    if (/_(PROD|PRODUCTION|STAGING)$/.test(k)) continue; // deployed-env only
    if (k.endsWith('_DEV')) continue; // applied as an override below
    out[k] = v;
  }
  for (const [k, v] of Object.entries(secrets)) {
    if (k.endsWith('_DEV')) out[k.slice(0, -4)] = v; // dev value wins for local
  }
  return out;
}

export function quote(v: string): string {
  if (v === '') return '';
  if (/[\s#"'`$\\]/.test(v) || /[\r\n]/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, '\\n')}"`;
  }
  return v;
}

function toEnvFile(env: Record<string, string>): string {
  const header = '# Pulled from Hiveku project secrets. Gitignored — do not commit.\n';
  const body = Object.keys(env)
    .sort()
    .map((k) => `${k}=${quote(env[k])}`)
    .join('\n');
  return `${header}${body}\n`;
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = val;
  }
  return out;
}

async function ensureGitignored(root: string): Promise<void> {
  const gi = path.join(root, '.gitignore');
  let text = '';
  try {
    text = await fs.readFile(gi, 'utf8');
  } catch {
    /* no .gitignore yet */
  }
  // Already covered by `.env.local`, `.env*`, or a bare `.env` rule.
  if (/^\s*\.env(\.local|\*)?\s*$/m.test(text)) return;
  const prefix = text && !text.endsWith('\n') ? '\n' : '';
  await fs.writeFile(gi, `${text}${prefix}.env.local\n`, 'utf8');
}

export async function pullEnv(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  const secrets = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Hiveku: pulling project secrets…' },
    () => api.secretsMap(client, scm.link.project_id),
  );
  if (Object.keys(secrets).length === 0) {
    vscode.window.showInformationMessage('No secrets are set on this Hiveku project.');
    return;
  }
  const env = resolveLocalEnv(secrets);
  const count = Object.keys(env).length;
  if (count === 0) {
    vscode.window.showInformationMessage('All secrets are _PROD/_STAGING only — nothing to write for local dev.');
    return;
  }
  // Values touch disk only after the user sees WHICH keys (names only, never values).
  const names = Object.keys(env).sort();
  const preview = names.slice(0, 12).join(', ') + (names.length > 12 ? ` … +${names.length - 12} more` : '');
  const okGo = await vscode.window.showWarningMessage(
    `Write ${count} secret(s) to ${ENV_FILE}? Keys: ${preview}

The file is gitignored + never pushed to Hiveku, and Claude Code is denied from reading .env files — but the values WILL be on this disk.`,
    { modal: true },
    'Write .env.local',
  );
  if (okGo !== 'Write .env.local') {
    return;
  }

  const target = path.join(scm.root, ENV_FILE);
  let exists = false;
  try {
    await fs.access(target);
    exists = true;
  } catch {
    /* new file */
  }
  if (exists) {
    const ok = await vscode.window.showWarningMessage(
      `${ENV_FILE} already exists — overwrite it with ${count} value(s) from Hiveku?`,
      { modal: true },
      'Overwrite',
    );
    if (ok !== 'Overwrite') return;
  }

  await fs.writeFile(target, toEnvFile(env), 'utf8');
  await ensureGitignored(scm.root);
  const choice = await vscode.window.showInformationMessage(
    `Wrote ${count} secret(s) to ${ENV_FILE} (gitignored).`,
    'Open',
  );
  if (choice === 'Open') await vscode.window.showTextDocument(vscode.Uri.file(target));
}

export async function pushEnv(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const target = path.join(scm.root, ENV_FILE);
  let text: string;
  try {
    text = await fs.readFile(target, 'utf8');
  } catch {
    vscode.window.showWarningMessage(`No ${ENV_FILE} in this project to push. Run "Pull Env" first or create one.`);
    return;
  }
  const env = parseEnvFile(text);
  const keys = Object.keys(env);
  if (keys.length === 0) {
    vscode.window.showWarningMessage(`${ENV_FILE} has no KEY=value lines.`);
    return;
  }
  const preview = keys.slice(0, 6).join(', ') + (keys.length > 6 ? '…' : '');
  const ok = await vscode.window.showWarningMessage(
    `Push ${keys.length} secret(s) from ${ENV_FILE} to Hiveku? This updates the project's stored secrets and the live preview (${preview}).`,
    { modal: true },
    'Push to Hiveku',
  );
  if (ok !== 'Push to Hiveku') return;

  const client = await clientFor(scm.link.account_id);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Hiveku: pushing secrets…' },
    () => api.secretSet(client, scm.link.project_id, env, true),
  );
  vscode.window.showInformationMessage(`Pushed ${keys.length} secret(s) to Hiveku.`);
}
