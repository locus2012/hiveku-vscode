/**
 * Pull / push a project's environment values between Hiveku and a local
 * `.env.local`, so a downloaded project runs locally with the development
 * values the Fly preview and the development Lambda use.
 *
 * PULL goes through project_secrets_reveal (plan B3), never through the
 * values of project_secrets_list: the list stops returning values at the
 * cutover, and the reveal is the one path that hands out non-sensitive values,
 * recorded, after a person approves. The server resolves the tier
 * (FOO_DEV over FOO), so nothing is resolved here. The extension's own client
 * does not declare itself, so a pull opens the approval page, then repeats the
 * same call with the token every 5 seconds for up to 10 minutes. The file is
 * written only when a value came back (an empty answer never replaces an
 * existing file), mode 0600 even over an existing file, with the withheld
 * names as comments. Values are written so the dotenv loaders Next.js, Vite
 * and Expo use read them back exactly (encodeEnvValue).
 *
 * PUSH saves `.env.local` as DEVELOPMENT values (tier 'development', stored
 * as KEY_DEV): a bare key would reach every tier, production included, so a
 * push never writes one. Keys suffixed for staging or production are left out.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import { HivekuScm } from './scm';

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;
const ENV_FILE = '.env.local';
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** U+2028 and U+2029, which end a line in many readers. */
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g');

/** How the pull waits for a person: a test may make it instant. */
export const envTiming = {
  pollMs: 5_000,
  waitMs: 10 * 60_000,
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  now: (): number => Date.now(),
};

/**
 * A value in the form the dotenv loaders read back exactly (dotenv parse plus
 * dotenv-expand, as Next.js 15, Vite and Expo load .env files), or null when
 * no form does:
 *   - nothing to quote or expand: written bare;
 *   - otherwise in single quotes, which dotenv keeps literally (line breaks
 *     included), with every `$` written `\$` so it is not expanded;
 *   - a value with a single quote goes in backticks the same way;
 *   - null for a value with both, with a carriage return or NUL, or ending in
 *     a backslash (dotenv reads `\'` as a quote inside the value).
 * The same rules as the Claude Code plugin's env pull and hiveku-sync.
 */
export function encodeEnvValue(value: string): string | null {
  const v = String(value);
  if (v === '') return '';
  if (/[\r\0]/.test(v) || v.endsWith('\\')) return null;
  if (/^[A-Za-z0-9_\-.,:/@+%~^=]+$/.test(v)) return v;
  const escaped = v.replace(/\$/g, '\\$');
  if (!v.includes("'")) return `'${escaped}'`;
  if (!v.includes('`')) return `\`${escaped}\``;
  return null;
}

/** dotenv's LINE pattern: a key, then a single-quoted, double-quoted, backticked or bare value. */
const ENV_LINE = /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\n]+)?\s*(?:#.*)?$/gm;

/**
 * Parse .env text the way dotenv does: single-quoted and backticked values
 * literally, across lines; double-quoted values with \n and \r turned into
 * line breaks; bare values up to a `#` comment. A `\$` is read as `$`, as
 * dotenv-expand does (encodeEnvValue writes every `$` that way); other
 * `$NAME` references are kept as text.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const src = text.replace(/\r\n?/g, '\n');
  for (const match of src.matchAll(ENV_LINE)) {
    const key = match[1];
    let value = (match[2] || '').trim();
    const quote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/, '$2');
    if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    value = value.replace(/\\\$/g, '$');
    if (KEY_RE.test(key)) out[key] = value;
  }
  return out;
}

/** One line of server text for a comment: no line breaks or control characters. */
function oneLine(text: unknown, max = 300): string {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(LINE_SEPARATORS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * The .env.local text: the values, sorted, then what was not included and
 * why, as comments. Returns the names written and the names left out.
 */
export function renderEnvFile(input: {
  values: Record<string, string>;
  withheld?: api.WithheldSecret[];
  notApproved?: string[];
}): { text: string; written: string[]; notes: Array<{ key: string; why: string }> } {
  const written: string[] = [];
  const unwritable: Array<{ key: string; why: string }> = [];
  const lines = [
    "# Pulled from Hiveku: this site's development values, revealed with a person's approval.",
    `# ${ENV_FILE} holds real values: it is gitignored; never commit it or paste it anywhere.`,
  ];
  for (const key of Object.keys(input.values).sort()) {
    if (!KEY_RE.test(key)) {
      unwritable.push({ key: oneLine(key, 80), why: 'not a variable name a .env file can hold' });
      continue;
    }
    const encoded = encodeEnvValue(input.values[key]);
    if (encoded === null) {
      unwritable.push({ key, why: 'its value cannot be written to a .env file exactly (set it by hand)' });
      continue;
    }
    lines.push(`${key}=${encoded}`);
    written.push(key);
  }
  const notes = [
    ...(input.withheld ?? []).map((w) => ({ key: oneLine(w.key, 80), why: oneLine(w.why || w.reason || 'withheld') })),
    ...(input.notApproved ?? []).map((key) => ({ key: oneLine(key, 80), why: 'added after the person approved; pull again to include it' })),
    ...unwritable,
  ];
  if (notes.length) {
    lines.push('', '# Not included (their values are never shown; set them by hand if local dev needs them):');
    for (const note of notes) lines.push(`# ${note.key}: ${note.why}`);
  }
  lines.push('');
  return { text: lines.join('\n'), written, notes };
}

/**
 * Write `text` to `target` with mode 0600, also over an existing file: a new
 * file created 0600 beside it is renamed over it, so the mode is the new
 * file's (writeFile's mode applies only when it creates the file).
 */
export async function writeEnvFileSecure(target: string, text: string): Promise<void> {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temp, target);
  } catch (err) {
    await fs.unlink(temp).catch(() => undefined);
    throw err;
  }
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

/** A refusal in one sentence. */
function refusalText(answer: { code: string; message: string }): string {
  const byCode: Record<string, string> = {
    approval_declined: 'A person declined the request, so nothing was written.',
    approval_used: 'That approval was already used. Pull again to ask once more.',
    approval_unknown: 'The approval ran out (10 minutes). Pull again to ask once more.',
    approval_timeout: 'Nobody approved within 10 minutes, so nothing was written. Pull again to ask once more.',
    reveal_rate_limited: "This site's values were revealed 20 times in the last hour, the most allowed. Try again later.",
    reveal_requests_rate_limited: '20 approvals were asked for this site in the last hour, the most allowed. Try again later.',
    key_creator_lacks_access: "Your role can't see this site's variables, so they can't be pulled.",
  };
  return byCode[answer.code] ?? `${answer.message} (${answer.code})`;
}

type Revealed = Extract<api.RevealAnswer, { kind: 'values' }>;
type Refused = Extract<api.RevealAnswer, { kind: 'refused' }>;

/** Repeat the reveal with the token until it answers, the time runs out, or the person cancels. */
async function waitForApproval(
  client: HivekuMcpClient,
  projectId: string,
  token: string,
  cancel: vscode.CancellationToken,
): Promise<Revealed | Refused> {
  const deadline = envTiming.now() + envTiming.waitMs;
  let failures = 0;
  for (;;) {
    if (cancel.isCancellationRequested) return { kind: 'refused', code: 'cancelled', message: 'Cancelled.' };
    if (envTiming.now() >= deadline) return { kind: 'refused', code: 'approval_timeout', message: 'Nobody approved within 10 minutes.' };
    await envTiming.sleep(envTiming.pollMs);
    if (cancel.isCancellationRequested) return { kind: 'refused', code: 'cancelled', message: 'Cancelled.' };
    let next: api.RevealAnswer;
    try {
      next = await api.secretsReveal(client, projectId, 'development', token);
      failures = 0;
    } catch (err) {
      // A blip while waiting does not end the wait; three in a row do.
      failures += 1;
      if (failures >= 3) throw err;
      continue;
    }
    if (next.kind === 'values' || next.kind === 'refused') return next;
    if (next.kind === 'approval_required') return { kind: 'refused', code: 'unexpected_answer', message: 'Hiveku asked for a new approval in the middle of the wait.' };
  }
}

/**
 * The development values, asking a person first when Hiveku says so. Returns
 * undefined when the person cancelled, nobody approved in time, or Hiveku
 * refused (each said in a message).
 */
export async function revealDevelopmentValues(client: HivekuMcpClient, projectId: string, projectName: string): Promise<Revealed | undefined> {
  const first = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Hiveku: asking for the development values…' },
    () => api.secretsReveal(client, projectId, 'development'),
  );
  let answer: api.RevealAnswer = first;
  if (first.kind === 'approval_required') {
    const choice = await vscode.window.showInformationMessage(
      `A person must approve revealing ${projectName}'s development values before ${ENV_FILE} is written. ` +
        "Anyone in the account who can see the site's variables can approve it, you included. " +
        'Hiveku waits up to 10 minutes after you open the approval page.',
      { modal: true },
      'Open approval page',
      'Copy link',
    );
    if (choice === 'Open approval page') await vscode.env.openExternal(vscode.Uri.parse(first.approveUrl));
    else if (choice === 'Copy link') await vscode.env.clipboard.writeText(first.approveUrl);
    else return undefined;
    answer = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Hiveku: waiting for the approval (up to 10 minutes)…', cancellable: true },
      (_progress, cancel) => waitForApproval(client, projectId, first.token, cancel),
    );
  }
  if (answer.kind === 'values') return answer;
  if (answer.kind === 'refused') {
    if (answer.code !== 'cancelled') vscode.window.showWarningMessage(`Hiveku: ${refusalText(answer)}`);
    return undefined;
  }
  vscode.window.showWarningMessage('Hiveku: the reveal did not finish. Nothing was written.');
  return undefined;
}

export async function pullEnv(scm: HivekuScm, clientFor: ClientFor): Promise<void> {
  const client = await clientFor(scm.link.account_id);
  const name = scm.link.project_name || 'this site';
  const answer = await revealDevelopmentValues(client, scm.link.project_id, name);
  if (!answer) return;
  const { text, written, notes } = renderEnvFile(answer);
  if (written.length === 0) {
    // Never an empty file over a real one.
    vscode.window.showInformationMessage(
      `No development value could be revealed for ${name}, so ${ENV_FILE} was left as it was.` +
        (notes.length ? ` Not included: ${notes.map((n) => n.key).join(', ')}.` : ''),
    );
    return;
  }
  // Values touch disk only after the user sees WHICH keys (names only, never values).
  const preview = written.slice(0, 12).join(', ') + (written.length > 12 ? ` … +${written.length - 12} more` : '');
  const okGo = await vscode.window.showWarningMessage(
    `Write ${written.length} development value(s) to ${ENV_FILE}? Keys: ${preview}

The file is gitignored + never pushed to Hiveku, and Claude Code is denied from reading .env files — but the values WILL be on this disk.${
      notes.length > 0
        ? `

NOT included (${notes.length}, listed in the file as comments with the reason): ${notes
            .slice(0, 8)
            .map((n) => n.key)
            .join(', ')}${notes.length > 8 ? ` … +${notes.length - 8} more` : ''}. Set these by hand if your local build needs them.`
        : ''
    }`,
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
      `${ENV_FILE} already exists — overwrite it with ${written.length} value(s) from Hiveku?`,
      { modal: true },
      'Overwrite',
    );
    if (ok !== 'Overwrite') return;
  }

  await writeEnvFileSecure(target, text);
  await ensureGitignored(scm.root);
  const choice = await vscode.window.showInformationMessage(
    `Wrote ${written.length} development value(s) to ${ENV_FILE} (gitignored, readable by you only).`,
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
  const parsed = parseEnvFile(text);
  // Development values only: a key suffixed for another tier is not pushed from a local dev file.
  const otherTier = Object.keys(parsed).filter((k) => /_(PROD|PRODUCTION|STAGING)$/.test(k));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) if (!otherTier.includes(k)) env[k] = v;
  const keys = Object.keys(env);
  if (keys.length === 0) {
    vscode.window.showWarningMessage(
      otherTier.length
        ? `${ENV_FILE} holds only staging or production keys (${otherTier.join(', ')}); Push Env saves development values only.`
        : `${ENV_FILE} has no KEY=value lines.`,
    );
    return;
  }
  const preview = keys.slice(0, 6).join(', ') + (keys.length > 6 ? '…' : '');
  const ok = await vscode.window.showWarningMessage(
    `Push ${keys.length} value(s) from ${ENV_FILE} to Hiveku as DEVELOPMENT values (${preview})? ` +
      'They are saved for development only (KEY_DEV): staging and production are not changed. The live preview restarts.' +
      (otherTier.length ? ` Left out (staging or production keys): ${otherTier.join(', ')}.` : ''),
    { modal: true },
    'Push to Hiveku',
  );
  if (ok !== 'Push to Hiveku') return;

  const client = await clientFor(scm.link.account_id);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Hiveku: pushing development values…' },
    () => api.secretSet(client, scm.link.project_id, env, true, 'development'),
  );
  vscode.window.showInformationMessage(`Pushed ${keys.length} development value(s) to Hiveku.`);
}
