/**
 * Removing an account from this computer when its person lost access to it
 * (offboarding O8a, notes/desktop-offboarding-o8a-2026-11-08.md). keyStanding.ts
 * decides WHEN (two definite answers from the website, minutes apart); this file
 * decides WHAT, and does it.
 *
 * WHAT GOES: only folders this extension made for that account. A folder goes
 * only when ALL of these hold, checked when the removal is planned and again
 * right before its delete (checkRemovable):
 *   - its .hiveku/account.json is a plain file that names the account and says
 *     bound_by "hiveku-vscode" (accountBinding.ts: written only into a folder the
 *     extension has just made);
 *   - it lies strictly inside the extension's Hiveku root, by its real path, and
 *     is not the root; neither it nor any folder between the root and it is a link;
 *   - it is not the home folder, an ancestor of it, or the disk's root;
 *   - it is not, does not lie inside and does not hold another account's folder
 *     the extension knows of;
 *   - no folder inside it (8 levels, node_modules and .git aside) is bound to
 *     another account or holds another account's site, and it could be read
 *     through to tell.
 * Everything inside such a folder goes with it: its downloaded sites, its data,
 * its .env and .mcp.json. A link inside it is unlinked and what it points at
 * stays: the delete never follows one.
 *
 * WHAT STAYS, and the person is told why: a folder with no binding (made before
 * this version, so the extension cannot tell it made it: the desktop app and
 * hiveku-sync use such folders too), one the Hiveku app or another Hiveku tool
 * bound (each removes its own), one bound to another account, a link, anything
 * outside the root, anything that fails a check above.
 *
 * WHERE IT LOOKS: the folder the extension recorded for the account, the folder
 * the account's name gives under the root, and folders directly under the root
 * whose binding names the account. Nothing else on the computer.
 *
 * IN ORDER: plan (reads only); journal the removal; the key leaves SecretStorage
 * and the account leaves the extension's lists; each folder is checked again,
 * moved whole into the extension's own storage folder and deleted there for good
 * (never the Trash: the plan's call, the Trash is a copy); the person is told.
 * A crash halfway is finished at the next start (finishPendingRemovals), and
 * never for an account that has been connected again since.
 *
 * Nothing here runs anything from a folder, and nothing reads the home folder
 * by itself: every root, the home folder and the storage folder are passed in.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EXTENSION_BINDER, DESKTOP_BINDER, readFolderBinding, type FolderBinding } from './accountBinding';
import type { RemovalReason } from './keyStanding';

export type KeptWhy =
  | 'no_mark'
  | 'desktop'
  | 'other_tool'
  | 'other_account'
  | 'unreadable_mark'
  | 'link'
  | 'outside_root'
  | 'no_root'
  | 'is_root'
  | 'home'
  | 'other_account_folder'
  | 'holds_other_account'
  | 'not_read_through'
  | 'failed';

export interface KeptFolder {
  path: string;
  why: KeptWhy;
}

export interface RemovalContext {
  accountId: string;
  label: string;
  reason: RemovalReason;
  /** The extension's Hiveku root folder (hiveku.rootFolder), or undefined when none is set. */
  root: string | undefined;
  /** The folder the extension recorded for this account, if any. */
  recordedFolder?: string;
  /** The folder this account's name gives under the root (slugForAccount), if a root is set. */
  canonicalFolder?: string;
  /** Every folder the extension knows for its other accounts: recorded ones and the ones their names give. */
  otherAccountFolders: string[];
  /** The person's home folder. */
  home: string;
}

export interface RemovalPlan {
  /** The folders that go, as the extension knows their paths (each is checked again before its delete). */
  remove: string[];
  kept: KeptFolder[];
}

export interface RemovalResult {
  accountId: string;
  label: string;
  reason: RemovalReason;
  removed: string[];
  kept: KeptFolder[];
  keyRemoved: boolean;
}

export interface PendingRemoval {
  accountId: string;
  label: string;
  reason: RemovalReason;
  folders: string[];
  at: string;
}

export interface RemovalDeps {
  /** The key out of SecretStorage, and the account out of the extension's lists and maps. */
  forgetAccount: (accountId: string) => Promise<void>;
  journal: { add(entry: PendingRemoval): Promise<void>; remove(accountId: string): Promise<void> };
  /** The extension's own folder deleted folders are moved into first. */
  tombstoneDir: string;
  log: (line: string) => void;
}

// ── Paths ────────────────────────────────────────────────────────────────────

/** Paths compare without letter case where the disk ignores it (macOS, Windows). */
const FOLD_CASE = process.platform === 'darwin' || process.platform === 'win32';
const keyOf = (p: string): string => (FOLD_CASE ? path.resolve(p).toLowerCase() : path.resolve(p));

export function samePath(a: string, b: string): boolean {
  return keyOf(a) === keyOf(b);
}

/** Whether `p` lies inside `folder`, and is not `folder` itself. */
export function isStrictlyInside(p: string, folder: string): boolean {
  const rest = path.relative(keyOf(folder), keyOf(p));
  return rest !== '' && rest !== '..' && !rest.startsWith(`..${path.sep}`) && !path.isAbsolute(rest);
}

export function isInsideOrSame(p: string, folder: string): boolean {
  return samePath(p, folder) || isStrictlyInside(p, folder);
}

function code(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

async function realOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

// ── What a folder holds ──────────────────────────────────────────────────────

/** No account's binding or site link lives in these, and they are most of a site folder's size. */
const NEVER_BOUND: ReadonlySet<string> = new Set(['node_modules', '.git']);
/** How deep a binding is looked for: sites/<site>/apps/<app> is four levels. */
const MOST_DEPTH = 8;
/** A folder with more folders than this is not looked through whole, and so is not deleted. */
const MOST_FOLDERS = 200_000;

/** The account a site folder's .hiveku/project.json names, 'unreadable', or null for none. */
async function siteAccountAt(dir: string): Promise<string | null | 'unreadable'> {
  const file = path.join(dir, '.hiveku', 'project.json');
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (err) {
    return code(err) === 'ENOENT' ? null : 'unreadable';
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 256 * 1024) return 'unreadable';
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { account_id?: unknown };
    return typeof parsed?.account_id === 'string' && parsed.account_id.trim() ? parsed.account_id.trim().toLowerCase() : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/**
 * Whether a folder holds anything of another account: a binding below it naming
 * another account (or one that cannot be read, or sits behind a link), or a site
 * linked to another account. Reads only; never follows a link.
 */
export async function otherAccountInside(
  folder: string,
  accountId: string,
): Promise<'clear' | 'holds_other_account' | 'not_read_through'> {
  const mine = accountId.toLowerCase();
  let visited = 0;
  let level = [folder];
  for (let depth = 0; depth <= MOST_DEPTH && level.length > 0; depth += 1) {
    const below: string[] = [];
    for (const dir of level) {
      visited += 1;
      if (visited > MOST_FOLDERS) return 'not_read_through';
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (code(err) === 'ENOENT') continue;
        return 'not_read_through';
      }
      for (const entry of entries) {
        if (entry.name === '.hiveku') {
          if (depth > 0) {
            const binding: FolderBinding = await readFolderBinding(dir);
            if (binding.kind === 'link' || binding.kind === 'unreadable') return 'holds_other_account';
            if (binding.kind === 'bound' && binding.accountId !== mine) return 'holds_other_account';
          }
          const site = await siteAccountAt(dir);
          if (site === 'unreadable') return 'not_read_through';
          if (site !== null && site !== mine) return 'holds_other_account';
        } else if (entry.isDirectory() && !NEVER_BOUND.has(entry.name)) {
          below.push(path.join(dir, entry.name));
        }
      }
    }
    level = below;
  }
  return 'clear';
}

// ── The check every delete goes through ──────────────────────────────────────

export type RemovableVerdict = { ok: true; real: string } | { ok: true; gone: true } | { ok: false; why: KeptWhy };

function bindingWhy(binding: FolderBinding, accountId: string): KeptWhy | null {
  if (binding.kind === 'none') return 'no_mark';
  if (binding.kind === 'link') return 'link';
  if (binding.kind === 'unreadable') return 'unreadable_mark';
  if (binding.accountId !== accountId.toLowerCase()) return 'other_account';
  if (binding.boundBy === EXTENSION_BINDER) return null;
  return binding.boundBy === DESKTOP_BINDER ? 'desktop' : 'other_tool';
}

/** Whether `folder` may be deleted for this account now (see the header). Reads only. */
export async function checkRemovable(
  folder: string,
  ctx: Pick<RemovalContext, 'accountId' | 'root' | 'otherAccountFolders' | 'home'>,
): Promise<RemovableVerdict> {
  if (!path.isAbsolute(folder) || path.resolve(folder) !== folder) return { ok: false, why: 'outside_root' };
  if (!ctx.root) return { ok: false, why: 'no_root' };
  const root = path.resolve(ctx.root);
  if (samePath(folder, root)) return { ok: false, why: 'is_root' };
  if (!isStrictlyInside(folder, root)) return { ok: false, why: 'outside_root' };

  let stat;
  try {
    stat = await fs.lstat(folder);
  } catch (err) {
    return code(err) === 'ENOENT' ? { ok: true, gone: true } : { ok: false, why: 'not_read_through' };
  }
  if (stat.isSymbolicLink()) return { ok: false, why: 'link' };
  if (!stat.isDirectory()) return { ok: false, why: 'not_read_through' };
  for (let up = path.dirname(folder); isStrictlyInside(up, root); up = path.dirname(up)) {
    const between = await fs.lstat(up).catch(() => null);
    if (!between || between.isSymbolicLink()) return { ok: false, why: 'link' };
  }

  // By the real paths too: a link that appeared between the checks above and here still never leads out.
  const realRoot = await realOrNull(root);
  const real = await realOrNull(folder);
  if (!realRoot || !real) return { ok: false, why: 'not_read_through' };
  if (!isStrictlyInside(real, realRoot)) return { ok: false, why: 'outside_root' };
  // Never the home folder or a folder holding it.
  const realHome = (await realOrNull(ctx.home)) ?? path.resolve(ctx.home);
  if (isInsideOrSame(realHome, real)) return { ok: false, why: 'home' };

  for (const other of ctx.otherAccountFolders) {
    if (!other) continue;
    const lexical = path.resolve(other);
    const realOther = (await realOrNull(lexical)) ?? lexical;
    if (isInsideOrSame(lexical, folder) || isStrictlyInside(folder, lexical) || isInsideOrSame(realOther, real) || isStrictlyInside(real, realOther)) {
      return { ok: false, why: 'other_account_folder' };
    }
  }

  const why = bindingWhy(await readFolderBinding(real), ctx.accountId);
  if (why) return { ok: false, why };

  const inside = await otherAccountInside(real, ctx.accountId);
  if (inside !== 'clear') return { ok: false, why: inside };
  return { ok: true, real };
}

// ── Planning ─────────────────────────────────────────────────────────────────

/** Folders directly under the root (never through a link) whose binding names the account. */
async function boundUnderRoot(root: string, accountId: string): Promise<string[]> {
  const rootStat = await fs.lstat(root).catch(() => null);
  if (!rootStat) return [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const binding = await readFolderBinding(dir);
    if (binding.kind === 'bound' && binding.accountId === accountId.toLowerCase()) found.push(dir);
  }
  return found;
}

/** What goes and what stays for this account. Reads only. */
export async function planAccountRemoval(ctx: RemovalContext): Promise<RemovalPlan> {
  const candidates: string[] = [];
  const add = (p: string | undefined) => {
    if (!p) return;
    const resolved = path.resolve(p);
    if (!candidates.some((c) => samePath(c, resolved))) candidates.push(resolved);
  };
  add(ctx.recordedFolder);
  add(ctx.canonicalFolder);
  if (ctx.root) for (const dir of await boundUnderRoot(path.resolve(ctx.root), ctx.accountId)) add(dir);

  const plan: RemovalPlan = { remove: [], kept: [] };
  for (const candidate of candidates) {
    const stat = await fs.lstat(candidate).catch(() => null);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      plan.kept.push({ path: candidate, why: 'link' });
      continue;
    }
    if (!stat.isDirectory()) continue;
    const why = bindingWhy(await readFolderBinding(candidate), ctx.accountId);
    if (why) {
      plan.kept.push({ path: candidate, why });
      continue;
    }
    const verdict = await checkRemovable(candidate, ctx);
    if (!verdict.ok) plan.kept.push({ path: candidate, why: verdict.why });
    // The path as the extension knows it: the delete checks it again, lexically and by its real path.
    else if ('real' in verdict && !plan.remove.some((r) => samePath(r, candidate))) plan.remove.push(candidate);
  }
  return plan;
}

// ── Deleting ─────────────────────────────────────────────────────────────────

const RM_OPTIONS = { recursive: true, force: true, maxRetries: 3 } as const;

/** A fresh name inside the extension's own storage folder, or null when that folder is not a plain folder. */
async function tombstoneFor(tombstoneDir: string): Promise<string | null> {
  try {
    await fs.mkdir(tombstoneDir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(tombstoneDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
  } catch {
    return null;
  }
  return path.join(tombstoneDir, `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`);
}

export type DeleteOutcome = { outcome: 'removed' | 'gone' | 'failed' } | { outcome: 'refused'; why: KeptWhy };

/**
 * Deletes one planned folder for good, after checking it again: moved whole into
 * the extension's own storage folder first (one rename, so the account's path is
 * gone at once), then deleted there. A folder that cannot be moved (another disk)
 * is deleted where it is. Never the Trash. Never throws.
 */
export async function deleteFolderForGood(
  folder: string,
  ctx: Pick<RemovalContext, 'accountId' | 'root' | 'otherAccountFolders' | 'home'>,
  tombstoneDir: string,
): Promise<DeleteOutcome> {
  const verdict = await checkRemovable(folder, ctx);
  if (!verdict.ok) return { outcome: 'refused', why: verdict.why };
  if (!('real' in verdict)) return { outcome: 'gone' };
  let target = verdict.real;
  const tomb = await tombstoneFor(tombstoneDir);
  if (tomb && !isInsideOrSame(tomb, verdict.real)) {
    try {
      await fs.rename(verdict.real, tomb);
      target = tomb;
    } catch {
      // Another disk, or held open: deleted where it is.
    }
  }
  try {
    await fs.rm(target, RM_OPTIONS);
    return { outcome: 'removed' };
  } catch {
    return { outcome: 'failed' };
  }
}

/** Deletes what an earlier removal left in the extension's own storage folder. Returns how many it cleared. */
export async function clearTombstones(tombstoneDir: string): Promise<number> {
  const stat = await fs.lstat(tombstoneDir).catch(() => null);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return 0;
  let cleared = 0;
  for (const entry of await fs.readdir(tombstoneDir, { withFileTypes: true }).catch(() => [])) {
    const left = path.join(tombstoneDir, entry.name);
    try {
      if (entry.isSymbolicLink() || !entry.isDirectory()) await fs.unlink(left);
      else await fs.rm(left, RM_OPTIONS);
      cleared += 1;
    } catch {
      // Tried again at the next start.
    }
  }
  return cleared;
}

// ── The whole removal ────────────────────────────────────────────────────────

/** Remove the account from this computer: plan, journal, key first, then the folders. Never throws. */
export async function runAccountRemoval(ctx: RemovalContext, deps: RemovalDeps): Promise<RemovalResult> {
  const plan = await planAccountRemoval(ctx);
  const result: RemovalResult = { accountId: ctx.accountId, label: ctx.label, reason: ctx.reason, removed: [], kept: [...plan.kept], keyRemoved: false };
  try {
    await deps.journal.add({ accountId: ctx.accountId, label: ctx.label, reason: ctx.reason, folders: plan.remove, at: new Date().toISOString() });
  } catch (err) {
    deps.log(`[offboarding] Could not note the removal before starting (${code(err) ?? 'error'}); going on.`);
  }
  try {
    await deps.forgetAccount(ctx.accountId);
    result.keyRemoved = true;
  } catch (err) {
    deps.log(`[offboarding] Could not delete the saved key (${code(err) ?? 'error'}).`);
  }
  let failed = false;
  for (const folder of plan.remove) {
    const done = await deleteFolderForGood(folder, ctx, deps.tombstoneDir);
    if (done.outcome === 'removed' || done.outcome === 'gone') result.removed.push(folder);
    else if (done.outcome === 'refused') result.kept.push({ path: folder, why: done.why });
    else {
      failed = true;
      result.kept.push({ path: folder, why: 'failed' });
    }
  }
  if (!failed) await deps.journal.remove(ctx.accountId).catch(() => undefined);
  return result;
}

/**
 * Finish removals a crash or a closed window left halfway: each journaled folder
 * is checked again and deleted, and what an earlier removal moved into the
 * storage folder is deleted. An account connected again since keeps everything.
 */
export async function finishPendingRemovals(
  entries: readonly PendingRemoval[],
  deps: RemovalDeps & {
    /** The account is in the extension's lists again (connected since): its journal entry is dropped, nothing deleted. */
    accountIsBack: (accountId: string) => boolean;
    contextFor: (entry: PendingRemoval) => Pick<RemovalContext, 'accountId' | 'root' | 'otherAccountFolders' | 'home'>;
  },
): Promise<RemovalResult[]> {
  const results: RemovalResult[] = [];
  for (const entry of entries) {
    if (deps.accountIsBack(entry.accountId)) {
      deps.log('[offboarding] An account whose removal was left halfway is connected again; its files stay.');
      await deps.journal.remove(entry.accountId).catch(() => undefined);
      continue;
    }
    const ctx = deps.contextFor(entry);
    const result: RemovalResult = { accountId: entry.accountId, label: entry.label, reason: entry.reason, removed: [], kept: [], keyRemoved: true };
    let failed = false;
    for (const folder of entry.folders) {
      const done = await deleteFolderForGood(folder, ctx, deps.tombstoneDir);
      if (done.outcome === 'removed') result.removed.push(folder);
      else if (done.outcome === 'refused') result.kept.push({ path: folder, why: done.why });
      else if (done.outcome === 'failed') {
        failed = true;
        result.kept.push({ path: folder, why: 'failed' });
      }
    }
    if (!failed) await deps.journal.remove(entry.accountId).catch(() => undefined);
    results.push(result);
  }
  await clearTombstones(deps.tombstoneDir);
  return results;
}

// ── What the person is told ──────────────────────────────────────────────────

const KEPT_WORDS: Record<KeptWhy, string> = {
  no_mark: 'it was made before this version of the extension, so it cannot tell it made it; delete it yourself if you no longer need it',
  desktop: 'the Hiveku app made it and removes it itself',
  other_tool: 'another Hiveku tool made it and removes it itself',
  other_account: 'it belongs to another account',
  unreadable_mark: 'its Hiveku file could not be read',
  link: 'it is a link, and links are never followed',
  outside_root: 'it is outside your Hiveku root folder',
  no_root: 'no Hiveku root folder is set',
  is_root: 'it is your Hiveku root folder',
  home: 'it is your home folder',
  other_account_folder: 'it is part of another account\'s folder',
  holds_other_account: 'it holds a folder of another account',
  not_read_through: 'it could not be read through to make sure it holds nothing of another account',
  failed: 'it could not be deleted completely; the extension tries again the next time VS Code starts',
};

/** A path as the person knows it: the home folder written as ~. */
export function shownPath(p: string, home: string): string {
  return isInsideOrSame(p, home) ? path.join('~', path.relative(path.resolve(home), path.resolve(p))) : p;
}

const REASON_WORDS: Record<RemovalReason, string> = {
  removed_from_team: 'you were removed from its team',
  account_closed: 'the account was closed',
};

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The notice, in plain words: why, what went, what stayed. At most three kept folders are named; the log has all. */
export function removalNotice(r: RemovalResult, home: string): string {
  const name = r.label || 'this account';
  const went: string[] = [];
  if (r.removed.length === 1) went.push(`its folder ${shownPath(r.removed[0], home)} (with its downloaded sites, data, .env and .mcp.json)`);
  else if (r.removed.length > 1) went.push(`its folders ${list(r.removed.map((f) => shownPath(f, home)))} (with their downloaded sites, data, .env and .mcp.json)`);
  if (r.keyRemoved) went.push('its saved key');
  const parts = [`You no longer have access to ${name}: ${REASON_WORDS[r.reason]}.`];
  parts.push(went.length ? `Removed from this computer: ${list(went)}.` : 'Nothing of it was removed from this computer.');
  if (r.kept.length) {
    const shown = r.kept.slice(0, 3).map((k) => `${shownPath(k.path, home)} (${KEPT_WORDS[k.why]})`);
    const more = r.kept.length > 3 ? `, and ${r.kept.length - 3} more listed in the Hiveku output` : '';
    parts.push(`Left in place: ${shown.join('; ')}${more}.`);
  }
  return parts.join(' ');
}

/**
 * For a key that did not come from Connect Hiveku (pasted with "Sign in with a
 * key"): it stopped working, nothing was removed, and how to go on. No reason is
 * given: the website's answer is about whoever made the key, who may be someone
 * else.
 */
export function keyStoppedNotice(label: string): string {
  const name = label || 'this account';
  return (
    `Hiveku no longer accepts the key saved for ${name}. Nothing was removed from this computer: its files and its saved key stay. ` +
    `If you still have access to ${name}, connect again with "Hiveku: Connect Hiveku" to get a key of your own.`
  );
}

/** One line per folder for the output channel: every full path, and why each stayed. */
export function removalLogLines(r: RemovalResult): string[] {
  return [
    `[offboarding] ${r.label} (${r.accountId}): ${r.reason}. Saved key ${r.keyRemoved ? 'deleted' : 'NOT deleted'}.`,
    ...r.removed.map((p) => `[offboarding]   deleted: ${p}`),
    ...r.kept.map((k) => `[offboarding]   left in place: ${k.path} (${KEPT_WORDS[k.why]})`),
  ];
}
