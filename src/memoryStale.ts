/**
 * The stale-edit decision for a memory document saved from the editor
 * (memory event log plan 14.3, V1). VS Code-free, so node --test drives it;
 * platformFs.ts owns the dialogs.
 *
 * A memory entry opened in a tab can change on Hiveku while it is open: a
 * person on the dashboard, a department agent, another Claude Code or Codex
 * session. Saving the tab used to overwrite that change without a word. Now:
 *
 *   1. on open, the provider remembers the version it served and when;
 *   2. on save, it reads the entry again. Same version: save, sending that
 *      version as expected_version. Moved: the save stops and the person is
 *      told who changed it, when and why (from memory_log_list since the open),
 *      and chooses Compare and merge, Save anyway, or Cancel;
 *   3. once the server checks expected_version (builder E2b), a change that
 *      lands between that read and the save is a 409 version_conflict carrying
 *      the newer text, and gets the same dialog.
 */
import { oneLine, shortWhen, appName, actionName, versionOf, type MemoryLogLine } from './memoryLog';

/** What the editor was given when the document was opened. */
export interface OpenedMemory {
  version?: number;
  /** ISO time of the read. */
  readAt: string;
}

export interface CurrentMemory {
  version?: number;
  content: string;
}

export type SaveDecision =
  | { kind: 'save'; expectedVersion?: number }
  | { kind: 'stale'; openedVersion?: number; current: CurrentMemory };

/**
 * Save straight away, or stop because the entry moved since it was opened.
 * With no record of the open (the extension restarted with the tab still
 * open), there is nothing to compare: save, guarding only the race from here.
 */
export function decideSave(opened: OpenedMemory | undefined, current: CurrentMemory): SaveDecision {
  const now = versionOf(current.version);
  if (!opened || opened.version === undefined) return { kind: 'save', expectedVersion: now };
  if (now === undefined || now === opened.version) return { kind: 'save', expectedVersion: opened.version };
  return { kind: 'stale', openedVersion: opened.version, current: { version: now, content: current.content } };
}

/** Who changed it, as far as the log says. */
export interface StaleChange {
  who: string;
  app: string;
  when: string;
  action: string;
  reason: string;
  /** How many changes the log shows since the open (0 = the log had none to show). */
  count: number;
}

/**
 * The change to name in the dialog: the newest line that moved the entry past
 * the opened version (or deleted it), else the newest line at all.
 */
export function describeChange(lines: readonly MemoryLogLine[], openedVersion: number | undefined): StaleChange | undefined {
  const moved = lines.filter(
    (l) => l.op === 'delete' || (openedVersion === undefined ? true : (versionOf(l.version_after) ?? -1) > openedVersion),
  );
  const pick = moved[0] ?? lines[0];
  if (!pick) return undefined;
  const author = pick.author && typeof pick.author === 'object' ? pick.author : null;
  return {
    who: oneLine(author?.label, 60) || 'someone',
    app: oneLine(pick.client_label, 40) || appName(pick.client ?? null, pick.source ?? null),
    when: shortWhen(pick.created_at),
    action: actionName(pick.op),
    reason: oneLine(pick.reason, 200),
    count: moved.length || lines.length,
  };
}

/** The dialog text. `name` is the entry's name as the tab shows it. */
export function staleMessage(
  name: string,
  change: StaleChange | undefined,
  versions: { opened?: number; current?: number },
  origin: 'check' | 'conflict' = 'check',
): string {
  const entry = `"${oneLine(name, 60) || 'This memory entry'}"`;
  const head =
    origin === 'conflict'
      ? `${entry} was changed on Hiveku while you were saving, so your save was not applied.`
      : `${entry} changed on Hiveku since you opened it.`;
  let who = '';
  if (change) {
    who = ` It was ${change.action} by ${change.who}${change.app ? ` (${change.app})` : ''}${change.when ? ` at ${change.when}` : ''}.`;
    if (change.count > 1) who += ` That is the latest of ${change.count} changes.`;
    if (change.reason) who += ` Their reason: "${change.reason}".`;
  } else if (versions.opened !== undefined && versions.current !== undefined) {
    who = ` You opened version ${versions.opened}; Hiveku now has version ${versions.current}.`;
  }
  return (
    `${head}${who} Compare and merge shows their text beside yours so you can keep both; ` +
    'Save anyway replaces their change with your text (it stays in version history).'
  );
}

export const COMPARE_ACTION = 'Compare and merge';
export const SAVE_ANYWAY_ACTION = 'Save anyway';

/** Shown when the save stops so the person can compare. The tab keeps their edit. */
export const COMPARE_NOTE =
  'Not saved yet: the newer text from Hiveku is on the left, your edit on the right. Copy what you want to keep into your edit, then save again.';
export const CANCELLED_NOTE = 'Not saved: this memory entry changed on Hiveku since you opened it. Your edit is still in the tab.';
