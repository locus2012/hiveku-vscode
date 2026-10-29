/**
 * When an account cannot be read at all, and what to say about it (HK-886).
 *
 * The attention scan (extension.ts scanAccounts) reads four things per account
 * with Promise.allSettled, so a read that failed never threw: an account whose
 * every read failed looked like a quiet one, the attention dialog never listed
 * it as unreachable, and the summary could still say "all clear". The account
 * console's entitlements read (hivekuApi.ts accountEntitlements) caught its
 * own error, so the console's banner never saw it either.
 *
 * Now an account whose reads ALL failed is unreachable, with the reason:
 *   - the web edge in front of Hiveku refused the reads (McpEdgeRefusalError,
 *     HK-847), with its HTTP status and ray id: never a key problem, never a
 *     reason to reconnect;
 *   - the answers could not be read, so who refused them is not known: not a
 *     key problem either;
 *   - Hiveku refused the key (its own JSON 401 or 403), or no key is stored:
 *     reconnecting fixes it;
 *   - anything else (a time-out, a server error), in its own words, as before.
 * A key problem anywhere among the reads outranks the edge, as the data
 * runner's closing line does (dataFailures.ts readAllFailed). Pure, so
 * test/account-reach.test.mjs pins every answer.
 */

import { McpEdgeRefusalError, coreEdgeRefusalKind, isHivekuKeyRefusal } from './mcpClient';

export type ReachFailureKind = 'edge' | 'unreadable' | 'key' | 'other';

export interface ReachFailure {
  kind: ReachFailureKind;
  /** The reason, short enough for a list row: it keeps the HTTP status and the ray id. */
  reason: string;
  /** The error's own words in full (the edge's say what to do and what to tell support). */
  words: string;
}

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);

/** An error on one line, cut to fit a row. */
function clip(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Hiveku itself refused the key: its own JSON 401 (revoked) or 403 (another account's), or none is stored. */
function isKeyProblem(err: unknown): boolean {
  if (coreEdgeRefusalKind(err) !== null) return false;
  if (isHivekuKeyRefusal(err)) return true;
  const text = messageOf(err);
  return /\bMCP HTTP 403:/.test(text) || /no stored key/i.test(text);
}

/** "HTTP 403, ray id 8f1c2d3e4f5a6b7c-SJC" from an edge refusal, or "HTTP 403" without one. */
function edgeLabel(err: unknown): string {
  if (err instanceof McpEdgeRefusalError) {
    return err.rayId ? `HTTP ${err.httpStatus}, ray id ${err.rayId}` : `HTTP ${err.httpStatus}`;
  }
  const found = messageOf(err).match(/\(HTTP (\d{3})(, ray id [0-9A-Za-z-]+)?\)/);
  return found ? `HTTP ${found[1]}${found[2] ?? ''}` : 'no answer';
}

/** Why one read failed. */
export function readFailure(err: unknown): ReachFailure {
  const words = messageOf(err);
  const edge = coreEdgeRefusalKind(err);
  if (edge === 'edge_blocked') {
    return { kind: 'edge', reason: `the web edge in front of Hiveku refused its reads (${edgeLabel(err)})`, words };
  }
  if (edge === 'unreadable') {
    return { kind: 'unreadable', reason: `the answers to its reads could not be read (${edgeLabel(err)})`, words };
  }
  if (isKeyProblem(err)) {
    const status = words.match(/\bMCP HTTP (\d{3}):/);
    const reason = status ? `Hiveku refused its key (HTTP ${status[1]})` : 'no key is stored for it';
    return { kind: 'key', reason, words };
  }
  return { kind: 'other', reason: clip(words), words };
}

/**
 * The account is unreachable when every read failed: why, or null when at least
 * one read came back. Hiveku refusing the key on any read decides; else the edge
 * (or an answer that could not be read); else the first error.
 */
export function unreachableFromReads(results: ReadonlyArray<PromiseSettledResult<unknown>>): ReachFailure | null {
  if (results.length === 0 || results.some((r) => r.status === 'fulfilled')) return null;
  const failures = results.map((r) => readFailure((r as PromiseRejectedResult).reason));
  return (
    failures.find((f) => f.kind === 'key') ??
    failures.find((f) => f.kind === 'edge') ??
    failures.find((f) => f.kind === 'unreadable') ??
    failures[0]
  );
}

/** The attention dialog's row for an unreachable account, and its line in the badge's tooltip. */
export function unreachableRow(label: string, failure: ReachFailure): { label: string; detail: string; line: string } {
  const next =
    failure.kind === 'key'
      ? 'Not checked: pick it to reconnect.'
      : failure.kind === 'other'
        ? 'Not checked: pick it to see why.'
        : 'Not checked, and its key is fine: pick it to see what to do.';
  return {
    label: `$(warning) ${label} could not be read`,
    detail: `${capitalize(failure.reason)}. ${next}`,
    line: `$(warning) ${label} could not be read: ${failure.reason}`,
  };
}

/**
 * What picking an unreachable account says, and its buttons. Reconnect only when
 * the key may be the cause: a refusal from the web edge, or an answer that could
 * not be read, never reached Hiveku, so a new key would change nothing (HK-847).
 */
export function unreachableWarning(label: string, failure: ReachFailure): { message: string; actions: string[] } {
  if (failure.kind === 'key') {
    return {
      message: `${label} could not be read: ${failure.reason}. Reconnect to mint a fresh key. (${clip(failure.words, 200)})`,
      actions: ['Reconnect', 'Open anyway'],
    };
  }
  if (failure.kind === 'edge' || failure.kind === 'unreadable') {
    return { message: `${label} could not be read. ${failure.words}`, actions: ['Open anyway'] };
  }
  return {
    message: `${label} could not be read: ${failure.reason}. Its key may have been revoked or the network failed.`,
    actions: ['Reconnect', 'Open anyway'],
  };
}

/**
 * The account console's banner when its first read for the account failed: a key
 * problem says to reconnect (deadKeyBanner's words), a refusal from the web edge
 * or an answer that could not be read says so with its ray id and what to do, and
 * anything else (a time-out, a server error) gets none, as before.
 */
export function readFailureBanner(err: unknown): string | null {
  const failure = readFailure(err);
  if (failure.kind === 'key') {
    return `This account's key looks dead (${failure.words.slice(0, 120)}). Run "Hiveku: Connect Hiveku" to mint a fresh one.`;
  }
  if (failure.kind === 'edge' || failure.kind === 'unreadable') {
    return `This account could not be read. ${failure.words}`;
  }
  return null;
}

/**
 * The sidebar badge's number: the first number of each attention line ("3
 * overdue task(s)"), and one for each account that could not be read, whose
 * line holds an HTTP status and a ray id, which are not counts (a 403 refusal
 * read as 403 things to look at).
 */
export function attentionBadgeCount(lines: readonly string[]): number {
  let count = 0;
  for (const line of lines) {
    if (line.startsWith('$(warning)')) {
      count += 1;
      continue;
    }
    const m = line.match(/(\d+)/);
    if (m) count += Number.parseInt(m[1], 10);
  }
  return count;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
