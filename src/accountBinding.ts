/**
 * The mark that says this extension made an account's folder (offboarding O8a,
 * notes/desktop-offboarding-o8a-2026-11-08.md).
 *
 * `.hiveku/account.json` is the binding the Hiveku desktop app and the Claude
 * Code plugin already write into the folders they make, each naming itself in
 * `bound_by`. This extension wrote none until now, so nothing told its folders
 * apart from the ones those tools, hiveku-sync or a person made under the same
 * name. From this version it writes one, `bound_by: "hiveku-vscode"`, into a
 * folder it has just made itself (one that was not there, or held nothing), and
 * only there. The removal on a lost account (offboarding.ts) deletes a folder
 * only when this mark names that account; every other folder stays.
 *
 * The file is untrusted input, as the plugin says of it: it gets copied and
 * synced. So it is read without following a link, it never carries a secret or
 * an address, and it is never written over a file already there.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export const BINDING_DIR = '.hiveku';
export const BINDING_FILE = 'account.json';
/** `bound_by` in the folders this extension makes. */
export const EXTENSION_BINDER = 'hiveku-vscode';
/** `bound_by` in the folders the Hiveku desktop app makes (hiveku-desktop account-folders.ts DESKTOP_BINDER). */
export const DESKTOP_BINDER = 'hiveku-desktop';

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True for an account id the website names accounts by: a lower-case UUID. */
export function isAccountUuid(value: unknown): value is string {
  return typeof value === 'string' && LOWER_UUID.test(value);
}

export type FolderBinding =
  /** No binding file there. */
  | { kind: 'none' }
  /** `.hiveku` or the file is a link: never read through. */
  | { kind: 'link' }
  /** There, but not a plain file, not JSON, or naming no account. */
  | { kind: 'unreadable' }
  | { kind: 'bound'; accountId: string; boundBy: string | null };

function code(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

/** Whose a folder says it is. Reads only, and never through a link. */
export async function readFolderBinding(folder: string): Promise<FolderBinding> {
  const dir = path.join(folder, BINDING_DIR);
  const file = path.join(dir, BINDING_FILE);
  let dirStat;
  try {
    dirStat = await fs.lstat(dir);
  } catch (err) {
    return code(err) === 'ENOENT' || code(err) === 'ENOTDIR' ? { kind: 'none' } : { kind: 'unreadable' };
  }
  if (dirStat.isSymbolicLink()) return { kind: 'link' };
  if (!dirStat.isDirectory()) return { kind: 'none' };
  let fileStat;
  try {
    fileStat = await fs.lstat(file);
  } catch (err) {
    return code(err) === 'ENOENT' ? { kind: 'none' } : { kind: 'unreadable' };
  }
  if (fileStat.isSymbolicLink()) return { kind: 'link' };
  if (!fileStat.isFile() || fileStat.size > 64 * 1024) return { kind: 'unreadable' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return { kind: 'unreadable' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'unreadable' };
  const { account_id: accountId, bound_by: boundBy } = parsed as { account_id?: unknown; bound_by?: unknown };
  if (typeof accountId !== 'string' || !accountId.trim()) return { kind: 'unreadable' };
  return { kind: 'bound', accountId: accountId.trim().toLowerCase(), boundBy: typeof boundBy === 'string' ? boundBy : null };
}

/**
 * True when `folder` is not there, or is a real folder holding nothing (a stray
 * .DS_Store aside): one the extension can call its own once it makes it. False
 * for a link, a file, or a folder with anything in it, which another tool or a
 * person may have made.
 */
export async function folderIsNewOrEmpty(folder: string): Promise<boolean> {
  let stat;
  try {
    stat = await fs.lstat(folder);
  } catch (err) {
    return code(err) === 'ENOENT';
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
  try {
    return (await fs.readdir(folder)).every((name) => name === '.DS_Store');
  } catch {
    return false;
  }
}

/**
 * Writes the extension's mark into a folder it has just made. Never over a file
 * that is there (created exclusively), never through a link, and only for an
 * account id the website names accounts by: the plugin stops at a binding it
 * cannot read, so a malformed one would cut that folder off from it.
 */
export async function markFolderAsExtensions(
  folder: string,
  account: { accountId: string; label: string },
  now: Date = new Date(),
): Promise<'marked' | 'already_bound' | 'not_marked'> {
  if (!isAccountUuid(account.accountId)) return 'not_marked';
  const dir = path.join(folder, BINDING_DIR);
  try {
    const folderStat = await fs.lstat(folder);
    if (folderStat.isSymbolicLink() || !folderStat.isDirectory()) return 'not_marked';
    await fs.mkdir(dir, { recursive: true });
    const dirStat = await fs.lstat(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return 'not_marked';
  } catch {
    return 'not_marked';
  }
  const body = {
    version: 1,
    account_id: account.accountId,
    label: String(account.label || account.accountId).slice(0, 200),
    bound_at: now.toISOString(),
    bound_by: EXTENSION_BINDER,
    note: 'Folder-to-account binding for the Hiveku VS Code extension. Contains no credentials.',
  };
  try {
    await fs.writeFile(path.join(dir, BINDING_FILE), JSON.stringify(body, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    return 'marked';
  } catch (err) {
    return code(err) === 'EEXIST' ? 'already_bound' : 'not_marked';
  }
}
