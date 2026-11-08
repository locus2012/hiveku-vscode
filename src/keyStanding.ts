/**
 * Why a refused key stopped working, and when that is a reason to remove an
 * account from this computer (offboarding O8a,
 * notes/desktop-offboarding-o8a-2026-11-08.md).
 *
 * The tool server answers every refused key with the same 401: an owner
 * switching one key off, a reconnect replacing it, the person leaving the team
 * and the account closing all read the same. The website tells the key's own
 * holder which it was: POST https://app.hiveku.com/api/account/mcp-keys/standing,
 * with the refused key as the bearer and the account it is for. Its four
 * answers: active, key_switched_off, removed_from_team, account_closed.
 *
 * THE RULE ABOVE EVERYTHING: only removed_from_team and account_closed, from
 * that route, read in full, twice, at least two minutes apart, about the same
 * key still stored for the account, lead to a removal. Everything else (an
 * error, a timeout, a redirect, a 4xx, a 429, a 5xx, a body that is not exactly
 * one of the four answers, active, key_switched_off, a key that changed in
 * between) changes nothing. The two sightings are the desktop app's own rule
 * (offboarding O2a): a passing fault can never delete anyone's work, and a
 * release that keeps saying "remove" is what the website's hourly brake is for.
 *
 * Asked once per refusal: a burst of refused calls asks one question, and an
 * answer that removes nothing quiets the key for hours.
 */

import * as crypto from 'crypto';
import { isAccountUuid } from './accountBinding';

export const KEY_STANDINGS = ['active', 'key_switched_off', 'removed_from_team', 'account_closed'] as const;
export type KeyStanding = (typeof KEY_STANDINGS)[number];
export type RemovalReason = Extract<KeyStanding, 'removed_from_team' | 'account_closed'>;

export const STANDING_PATH = '/api/account/mcp-keys/standing';
/** How long one question may take, the body included. */
export const ASK_TIMEOUT_MS = 10_000;
/** The answer is one short JSON object; anything much larger is not it. */
const MAX_ANSWER_BYTES = 4 * 1024;

/** The second question about a removal answer is asked this long after the first (two minutes, and a little). */
export const CONFIRM_AFTER_MS = 2 * 60 * 1000 + 5 * 1000;
/** A first sighting not confirmed within this long is forgotten. */
export const SIGHTING_TTL_MS = 30 * 60 * 1000;
/** After key_switched_off, no new question about that key for this long. */
export const QUIET_AFTER_SWITCHED_OFF_MS = 6 * 60 * 60 * 1000;
/** After active (the 401 was something passing), no new question for this long. */
export const QUIET_AFTER_ACTIVE_MS = 30 * 60 * 1000;
/** After no answer, no new question for this long, or the route's Retry-After, up to an hour. */
export const QUIET_AFTER_NO_ANSWER_MS = 15 * 60 * 1000;
const MOST_RETRY_AFTER_MS = 60 * 60 * 1000;

export type StandingReply =
  | { kind: 'answer'; standing: KeyStanding }
  | {
      kind: 'no_answer';
      why: 'timeout' | 'network' | 'refused' | 'busy' | 'unavailable' | 'unreadable';
      retryAfterSeconds?: number;
    };

export function isRemovalStanding(value: unknown): value is RemovalReason {
  return value === 'removed_from_team' || value === 'account_closed';
}

/** The one place the route's answer is read. Anything but exactly one of the four answers is no answer. */
export function readStandingAnswer(status: number, text: string): StandingReply {
  if (status !== 200) return { kind: 'no_answer', why: 'unreadable' };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { kind: 'no_answer', why: 'unreadable' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { kind: 'no_answer', why: 'unreadable' };
  const keys = Object.keys(body as Record<string, unknown>);
  const standing = (body as { standing?: unknown }).standing;
  if (keys.length !== 1 || keys[0] !== 'standing') return { kind: 'no_answer', why: 'unreadable' };
  if (typeof standing !== 'string' || !(KEY_STANDINGS as readonly string[]).includes(standing)) {
    return { kind: 'no_answer', why: 'unreadable' };
  }
  return { kind: 'answer', standing: standing as KeyStanding };
}

/**
 * Ask the website why this key stopped working. Never throws. The key goes only
 * in the Authorization header, to the app address the extension is set to use
 * (hiveku.appUrl, machine-scoped so a folder cannot redirect it), and a redirect
 * is never followed.
 */
export async function askKeyStanding(opts: {
  appUrl: string;
  key: string;
  accountId: string;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}): Promise<StandingReply> {
  const url = `${String(opts.appUrl).replace(/\/+$/, '')}${STANDING_PATH}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? ASK_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(opts.userAgent ? { 'User-Agent': opts.userAgent } : {}),
        },
        body: JSON.stringify({ account_id: opts.accountId }),
        redirect: 'manual',
        signal: ctrl.signal,
      });
    } catch {
      return { kind: 'no_answer', why: ctrl.signal.aborted ? 'timeout' : 'network' };
    }
    let text = '';
    try {
      const declared = Number(res.headers.get('content-length') ?? '');
      if (Number.isFinite(declared) && declared > MAX_ANSWER_BYTES) return { kind: 'no_answer', why: 'unreadable' };
      text = await res.text();
    } catch {
      return { kind: 'no_answer', why: ctrl.signal.aborted ? 'timeout' : 'unreadable' };
    }
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after'));
      return { kind: 'no_answer', why: 'busy', ...(Number.isFinite(after) && after > 0 ? { retryAfterSeconds: Math.ceil(after) } : {}) };
    }
    if (res.status >= 500) return { kind: 'no_answer', why: 'unavailable' };
    if (res.status !== 200) return { kind: 'no_answer', why: 'refused' };
    if (Buffer.byteLength(text, 'utf8') > MAX_ANSWER_BYTES) return { kind: 'no_answer', why: 'unreadable' };
    return readStandingAnswer(res.status, text);
  } finally {
    clearTimeout(timer);
  }
}

/** A key, as the watcher remembers it: its hash, in memory only, never the key. */
function fingerprint(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

export interface KeyRefusalWatcherDeps {
  appUrl: () => string;
  /** The key the extension holds for the account now, if any. */
  storedKey: (accountId: string) => Promise<string | undefined>;
  ask: (opts: { appUrl: string; key: string; accountId: string }) => Promise<StandingReply>;
  /** Remove the account from this computer, for this reason. Called only on the second sighting. */
  remove: (accountId: string, reason: RemovalReason) => Promise<void>;
  log: (line: string) => void;
  now?: () => number;
  /** Run `fn` once, `ms` from now; tests pass their own clock. */
  schedule?: (fn: () => void, ms: number) => { cancel(): void };
}

interface AccountWatch {
  inFlight: boolean;
  removing: boolean;
  quietUntil: number;
  sighting?: { at: number; keyFp: string; reason: RemovalReason };
  confirm?: { cancel(): void };
}

function defaultSchedule(fn: () => void, ms: number): { cancel(): void } {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
}

/**
 * Watches the tool server's refusals of stored keys, asks the website why, and
 * removes an account only on the second sighting of a removal answer.
 */
export class KeyRefusalWatcher {
  private readonly watches = new Map<string, AccountWatch>();
  private readonly running = new Set<Promise<void>>();
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => { cancel(): void };
  private disposed = false;

  constructor(private readonly deps: KeyRefusalWatcherDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.schedule = deps.schedule ?? defaultSchedule;
  }

  private watch(accountId: string): AccountWatch {
    let w = this.watches.get(accountId);
    if (!w) {
      w = { inFlight: false, removing: false, quietUntil: 0 };
      this.watches.set(accountId, w);
    }
    return w;
  }

  /** The tool server refused this key for this account. Never throws; asks at most once for a burst. */
  onRefused(accountId: string, key: string): void {
    if (this.disposed || !isAccountUuid(accountId) || typeof key !== 'string' || !key.startsWith('hvk_')) return;
    const w = this.watch(accountId);
    const now = this.now();
    if (w.inFlight || w.removing || now < w.quietUntil) return;
    // The confirming question is already set for this sighting.
    if (w.sighting && now - w.sighting.at < CONFIRM_AFTER_MS) return;
    this.track(this.ask(accountId, key));
  }

  /** Resolves once every question and removal started so far has finished (for tests and shutdown). */
  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.watches.values()) w.confirm?.cancel();
  }

  private track(p: Promise<void>): void {
    const tracked = p.catch(() => undefined).finally(() => this.running.delete(tracked));
    this.running.add(tracked);
  }

  private async ask(accountId: string, key: string): Promise<void> {
    const w = this.watch(accountId);
    w.inFlight = true;
    let reply: StandingReply;
    try {
      reply = await this.deps.ask({ appUrl: this.deps.appUrl(), key, accountId });
    } catch {
      reply = { kind: 'no_answer', why: 'network' };
    } finally {
      w.inFlight = false;
    }
    if (this.disposed) return;
    await this.handle(accountId, key, reply);
  }

  private async handle(accountId: string, key: string, reply: StandingReply): Promise<void> {
    const w = this.watch(accountId);
    const now = this.now();
    if (reply.kind === 'no_answer') {
      // The first sighting, if any, is kept until it expires: a later definite answer may still confirm it.
      const retry = reply.retryAfterSeconds ? Math.min(reply.retryAfterSeconds * 1000, MOST_RETRY_AFTER_MS) : QUIET_AFTER_NO_ANSWER_MS;
      w.quietUntil = now + Math.max(retry, QUIET_AFTER_NO_ANSWER_MS);
      this.deps.log(`[offboarding] Hiveku gave no answer about a refused key (${reply.why}); nothing changes on this computer.`);
      return;
    }
    if (!isRemovalStanding(reply.standing)) {
      this.forgetSighting(w);
      w.quietUntil = now + (reply.standing === 'active' ? QUIET_AFTER_ACTIVE_MS : QUIET_AFTER_SWITCHED_OFF_MS);
      this.deps.log(`[offboarding] Hiveku says the key is ${reply.standing}; nothing changes on this computer.`);
      return;
    }
    const fp = fingerprint(key);
    const s = w.sighting;
    const confirms = s !== undefined && s.keyFp === fp && now - s.at >= CONFIRM_AFTER_MS && now - s.at <= SIGHTING_TTL_MS;
    if (!confirms) {
      this.forgetSighting(w);
      w.sighting = { at: now, keyFp: fp, reason: reply.standing };
      w.confirm = this.schedule(() => this.track(this.confirm(accountId)), CONFIRM_AFTER_MS);
      this.deps.log(`[offboarding] Hiveku says ${reply.standing}; asking once more in two minutes before anything is removed.`);
      return;
    }
    // The second sighting. The key must still be the one stored for the account: a reconnect replaces it.
    this.forgetSighting(w);
    const stored = await this.deps.storedKey(accountId).catch(() => undefined);
    if (!stored || fingerprint(stored) !== fp) {
      this.deps.log('[offboarding] The account has another key now; nothing is removed.');
      return;
    }
    w.removing = true;
    try {
      await this.deps.remove(accountId, reply.standing);
    } catch (err) {
      this.deps.log(`[offboarding] Removing the account from this computer stopped: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      w.removing = false;
      w.quietUntil = this.now() + QUIET_AFTER_SWITCHED_OFF_MS;
    }
  }

  /** The confirming question: about the same key, still stored for the account. */
  private async confirm(accountId: string): Promise<void> {
    const w = this.watch(accountId);
    w.confirm = undefined;
    const s = w.sighting;
    if (this.disposed || !s) return;
    const key = await this.deps.storedKey(accountId).catch(() => undefined);
    if (!key || fingerprint(key) !== s.keyFp) {
      this.forgetSighting(w);
      this.deps.log('[offboarding] The account has another key now; nothing is removed.');
      return;
    }
    if (w.inFlight || w.removing) return;
    await this.ask(accountId, key);
  }

  private forgetSighting(w: AccountWatch): void {
    w.confirm?.cancel();
    w.confirm = undefined;
    w.sighting = undefined;
  }
}
