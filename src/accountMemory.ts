/**
 * Account memory (memory programme A7): the one plain document per account that
 * every department agent reads, plus the one-line suggestions agents made that
 * no owner has reviewed yet.
 *
 * READ-ONLY EVERYWHERE IN THIS EXTENSION. Owners and admins edit it on the
 * Hiveku dashboard (`/<accountId>/dashboard/memory`). There is no MCP tool that
 * sets it (only `account_memory_get`, and `account_memory_append`, which only
 * suggests a line), so VS Code has nothing to save it with: the editor refuses
 * a save with a message that says where to edit it, and the local copy under
 * hiveku-data/account/ is written read-only and never uploaded.
 *
 * ONE FILE, THREE WRITERS. The Claude Code plugin (`hiveku:pull` /
 * `hiveku:knowledge`, lib/account-memory.mjs), hiveku-sync and this extension
 * all write hiveku-data/account/ACCOUNT_MEMORY.md, so an agent reads the same
 * text whichever tool refreshed it last. The rendering below is a port of the
 * plugin's `renderAccountMemoryFile`; test/account-memory.test.mjs compares the
 * two byte for byte whenever a plugin checkout with that module is beside this
 * repo.
 *
 * No `vscode` import, so this is testable with plain `node --test`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/** The two `account_ai_memory` domains that hold the account memory. */
export const ACCOUNT_MEMORY_DOMAIN = 'account';
export const ACCOUNT_SUGGESTIONS_DOMAIN = 'account-suggestions';
export const ACCOUNT_MEMORY_TOOL = 'account_memory_get';

/**
 * True for the account memory's own rows. They are not a department's memory:
 * filing `account` as a department would list the owner's document as an
 * editable department entry, and the builder refuses every generic write to it.
 * Exact match only: `accounting`, `_account:memory:*` (the orchestrator's own
 * notes) and `account_x` are unrelated.
 */
export function isAccountMemoryDomain(domain: unknown): boolean {
  if (typeof domain !== 'string') return false;
  const d = domain.trim().toLowerCase();
  return d === ACCOUNT_MEMORY_DOMAIN || d === ACCOUNT_SUGGESTIONS_DOMAIN;
}

/** Where the local read-only copy lives inside an account folder. */
export const ACCOUNT_MEMORY_DIR = path.join('hiveku-data', 'account');
export const ACCOUNT_MEMORY_FILE = 'ACCOUNT_MEMORY.md';
/** Glob for `files.readonlyInclude` (VS Code opens matching files read-only). */
export const ACCOUNT_MEMORY_READONLY_GLOB = 'hiveku-data/account/**';

const DEFAULT_APP_URL = 'https://app.hiveku.com';
const DASHBOARD_PATH = 'dashboard/memory';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccountMemorySuggestion {
  id: string;
  /** ISO timestamp the suggestion was made. */
  at: string;
  /** Who suggested it: a readable label from the builder ("Sales agent", "MCP"). */
  source: string;
  text: string;
}

export interface AccountMemory {
  /** The owner's document (markdown). '' when nobody has written it. */
  content: string;
  /** Owner document version; 0 when nothing was written yet. */
  version: number;
  updatedAt: string | null;
  /** Suggestions no owner has reviewed yet, newest first. Never the held ones. */
  suggestions: AccountMemorySuggestion[];
  suggestionsVersion: number;
  /** True when the copy agents read had to be cut. */
  truncated: boolean;
}

/** The minimum of HivekuMcpClient this module needs (so tests can pass a stub). */
export interface ToolCaller {
  callToolJson<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

/**
 * The `account_memory_get` answer, checked. The builder returns
 * `{ data: { content, version, updated_at, bytes, suggestions, suggestions_version,
 * injected, truncated } }`. Anything else is an ERROR, not an empty memory:
 * showing "nothing written yet" over a real document because the shape moved
 * would be a lie.
 */
export function parseAccountMemory(payload: unknown): AccountMemory {
  const inner =
    payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in (payload as Record<string, unknown>)
      ? (payload as { data: unknown }).data
      : payload;
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
    throw new Error(`${ACCOUNT_MEMORY_TOOL} returned an unexpected shape (no object)`);
  }
  const o = inner as Record<string, unknown>;
  if (typeof o.content !== 'string' || !Number.isFinite(Number(o.version))) {
    throw new Error(`${ACCOUNT_MEMORY_TOOL} returned an unexpected shape (no content or version)`);
  }
  const raw = Array.isArray(o.suggestions) ? (o.suggestions as unknown[]) : [];
  return {
    content: o.content,
    version: Number(o.version),
    updatedAt: typeof o.updated_at === 'string' ? o.updated_at : null,
    suggestions: raw
      .filter(
        (s): s is Record<string, unknown> =>
          !!s && typeof s === 'object' && typeof (s as Record<string, unknown>).text === 'string' &&
          ((s as Record<string, unknown>).text as string).trim().length > 0,
      )
      .map((s) => ({
        id: typeof s.id === 'string' ? s.id : '',
        at: typeof s.at === 'string' ? s.at : '',
        source: typeof s.source === 'string' && s.source.trim() ? s.source : 'Unknown',
        text: s.text as string,
      })),
    suggestionsVersion: Number.isFinite(Number(o.suggestions_version)) ? Number(o.suggestions_version) : 0,
    truncated: o.truncated === true,
  };
}

/** Read the account memory through MCP (`account_memory_get`, no arguments). */
export async function fetchAccountMemory(client: ToolCaller): Promise<AccountMemory> {
  return parseAccountMemory(await client.callToolJson<unknown>(ACCOUNT_MEMORY_TOOL, {}));
}

/**
 * The page where owners and admins edit it:
 * `https://app.hiveku.com/<accountId>/dashboard/memory`. Account-scoped when the
 * id is a real UUID (so it opens on the right account for someone in several);
 * the unscoped page otherwise, never a half-built URL.
 */
export function accountMemoryDashboardUrl(appUrl: string | undefined, accountId: string): string {
  const base = String(appUrl || DEFAULT_APP_URL).replace(/\/+$/, '');
  return UUID_RE.test(accountId) ? `${base}/${accountId.toLowerCase()}/${DASHBOARD_PATH}` : `${base}/${DASHBOARD_PATH}`;
}

/** The message every refused save shows. */
export function accountMemoryReadOnlyMessage(dashboardUrl: string): string {
  return (
    'The account memory cannot be changed from VS Code, so nothing was saved. ' +
    `Owners and admins edit it on the Hiveku dashboard: ${dashboardUrl}`
  );
}

/** "2026-09-23 14:02 UTC", or the raw value when it is not a date. */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return 'unknown time';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** One line, no line breaks: a suggestion is one line on the server too. */
export function oneLine(value: string): string {
  return String(value).replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
}

/** "Sales agent · 2026-09-23 14:02 UTC" — who suggested it and when (tree rows). */
export function suggestionByline(s: AccountMemorySuggestion): string {
  return `${oneLine(s.source)} · ${formatWhen(s.at)}`;
}

function yamlString(value: string): string {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The document text: front matter, a header that says it is a read-only copy
 * and where it is edited, the owner's text, then the unreviewed suggestions
 * with who made each and when. Same bytes as the plugin's file for the same
 * input (see the header of this module).
 */
export function renderAccountMemoryDocument(
  memory: AccountMemory,
  opts: { accountId: string; fetchedAt: string; appUrl?: string },
): string {
  const editUrl = accountMemoryDashboardUrl(opts.appUrl, opts.accountId);
  const fm = [
    '---',
    'read_only: true',
    `source_tool: ${ACCOUNT_MEMORY_TOOL}`,
    `version: ${memory.version}`,
    ...(memory.updatedAt ? [`updated_at: ${yamlString(memory.updatedAt)}`] : []),
    `suggestions: ${memory.suggestions.length}`,
    `suggestions_version: ${memory.suggestionsVersion}`,
    `fetched_at: ${yamlString(opts.fetchedAt)}`,
    `edit_url: ${yamlString(editUrl)}`,
    '---',
    '',
  ];
  const lines = [
    '# Account memory',
    '',
    '> This is a read-only copy of the account memory, the facts about the business that every',
    '> Hiveku department agent reads. Owners and admins edit it on the Hiveku dashboard:',
    `> ${editUrl}`,
    '>',
    '> Changes made to this file are not saved to Hiveku. The next pull replaces this file, and',
    '> nothing uploads it. To add a fact, suggest it with account_memory_append (an owner or admin',
    '> reviews it on the dashboard), or ask an owner or admin to change the document there.',
    '> It is internal to the team: do not quote it to customers.',
    '',
  ];
  if (memory.version > 0 && memory.content.trim()) {
    lines.push(`Version ${memory.version}, last changed ${formatWhen(memory.updatedAt)}.`);
    if (memory.truncated) {
      lines.push(
        'Agents see a shortened version: with the suggestions, it is longer than the 8,000 characters they read.',
      );
    }
    lines.push('', '---', '', memory.content.replace(/\s+$/, ''), '', '---', '');
  } else {
    lines.push('Nothing has been written yet. An owner or admin can start it on the dashboard.', '');
  }

  lines.push('# Suggestions from agents, not reviewed yet', '');
  if (memory.suggestions.length) {
    lines.push(
      'These lines are not part of the account memory until an owner or admin keeps them on the dashboard.',
      '',
    );
    for (const s of memory.suggestions) {
      lines.push(`- ${oneLine(s.text)} (suggested by ${oneLine(s.source)}, ${formatWhen(s.at)})`);
    }
  } else {
    lines.push('None waiting.');
  }
  lines.push('');
  return fm.join('\n') + lines.join('\n');
}

/**
 * Replace a file even when an earlier download left it read-only: write a temp
 * beside it, rename over it (a rename needs the FOLDER writable, not the file),
 * then mark the result read-only. Windows refuses a rename onto a read-only
 * file, so on that refusal the old copy is made writable first and the rename
 * retried.
 */
export async function writeReadOnlyFile(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, text, 'utf8');
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'EPERM' && code !== 'EACCES') {
      await fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
    await fs.chmod(file, 0o644);
    await fs.rename(tmp, file);
  }
  await fs.chmod(file, 0o444);
}

/**
 * Write the local read-only copy to `<baseDir>/hiveku-data/account/ACCOUNT_MEMORY.md`.
 * The caller fetches first, so a failed read never clobbers a good copy.
 * Nothing in the extension reads this file back or uploads it. Returns the path.
 */
export async function writeAccountMemoryFile(
  baseDir: string,
  memory: AccountMemory,
  opts: { accountId: string; fetchedAt?: string; appUrl?: string },
): Promise<string> {
  const file = path.join(baseDir, ACCOUNT_MEMORY_DIR, ACCOUNT_MEMORY_FILE);
  const text = renderAccountMemoryDocument(memory, {
    accountId: opts.accountId,
    fetchedAt: opts.fetchedAt ?? new Date().toISOString(),
    appUrl: opts.appUrl,
  });
  await writeReadOnlyFile(file, text);
  return file;
}
