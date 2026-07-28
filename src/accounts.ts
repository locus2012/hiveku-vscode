/**
 * Multi-account credential store.
 *
 * A Hiveku MCP key is pinned to exactly ONE account, so "connect multiple
 * accounts" = store multiple keys, one per account, and switch between them.
 * Keys live in VS Code SecretStorage (OS keychain) — never in settings.json,
 * never in plaintext on disk. A small non-secret index (label + accountId)
 * lives in globalState so we can list accounts without unlocking every secret.
 */

import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';

const INDEX_KEY = 'hiveku.accounts.index';
const ARCHIVED_KEY = 'hiveku.accounts.archived';
const FOLDERS_KEY = 'hiveku.accounts.folders';
const DEPARTMENTS_KEY = 'hiveku.accounts.departments';
const ROLES_KEY = 'hiveku.accounts.roles';
const SECRET_PREFIX = 'hiveku.key.';

export interface AccountRecord {
  accountId: string;
  label: string;
  /** Email of the user who connected this account (from the Connect flow). */
  connectedAs?: string;
}

function secretKey(accountId: string): string {
  return `${SECRET_PREFIX}${accountId}`;
}

export class AccountStore {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  list(): AccountRecord[] {
    return this.ctx.globalState.get<AccountRecord[]>(INDEX_KEY, []);
  }

  private async setIndex(records: AccountRecord[]): Promise<void> {
    await this.ctx.globalState.update(INDEX_KEY, records);
  }

  async getKey(accountId: string): Promise<string | undefined> {
    return this.ctx.secrets.get(secretKey(accountId));
  }

  /**
   * Reuse one client per (account, baseUrl). It used to build a NEW client on
   * every call, and each new client must handshake before its first tool call —
   * so one logical read cost three HTTP round trips plus a keychain read, across
   * 82 call sites. The client holds no per-request state, so sharing is safe.
   */
  private readonly clientCache = new Map<string, HivekuMcpClient>();

  async getClient(accountId: string, baseUrl: string): Promise<HivekuMcpClient> {
    const cacheKey = `${accountId}::${baseUrl}`;
    const cached = this.clientCache.get(cacheKey);
    if (cached) return cached;
    const key = await this.getKey(accountId);
    if (!key) throw new Error(`No stored key for account ${accountId}. Run "Hiveku: Sign In".`);
    const client = new HivekuMcpClient({ baseUrl, apiKey: key });
    this.clientCache.set(cacheKey, client);
    return client;
  }

  /** Drop cached clients for an account whose key changed or was revoked. */
  private invalidateClients(accountId?: string): void {
    if (!accountId) {
      this.clientCache.clear();
      return;
    }
    for (const k of [...this.clientCache.keys()]) {
      if (k.startsWith(`${accountId}::`)) this.clientCache.delete(k);
    }
  }

  /**
   * Validate a pasted key by hitting get_account_info, then persist it. Returns
   * the resolved AccountRecord. Re-signing-in with the same account replaces
   * the stored key (handy for rotation).
   */
  async signIn(rawKey: string, baseUrl: string): Promise<AccountRecord> {
    const key = rawKey.trim();
    if (!key) throw new Error('Empty key');

    const client = new HivekuMcpClient({ baseUrl, apiKey: key });
    let info: Record<string, unknown> = {};
    try {
      info = await client.callToolJson<Record<string, unknown>>('get_account_info', {});
    } catch (err) {
      throw new Error(`Could not validate key against ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const data = (info.data && typeof info.data === 'object' ? info.data : info) as Record<string, unknown>;
    const accountId =
      (typeof data.account_id === 'string' && data.account_id) ||
      (typeof data.id === 'string' && data.id) ||
      `key-${hashShort(key)}`;
    const name =
      (typeof data.name === 'string' && data.name) ||
      (typeof data.account_name === 'string' && data.account_name) ||
      (typeof data.company === 'string' && data.company) ||
      accountId;

    await this.ctx.secrets.store(secretKey(accountId), key);
    const records = this.list().filter((r) => r.accountId !== accountId);
    records.push({ accountId, label: String(name) });
    await this.setIndex(records);
    return { accountId, label: String(name) };
  }

  /**
   * Store an account whose key we ALREADY hold (e.g. from the Connect OAuth
   * flow) without re-validating via get_account_info.
   */
  async addAccount(accountId: string, label: string, key: string, connectedAs?: string): Promise<AccountRecord> {
    await this.ctx.secrets.store(secretKey(accountId), key.trim());
    this.invalidateClients(accountId); // the cached client holds the OLD key
    const records = this.list().filter((r) => r.accountId !== accountId);
    const record: AccountRecord = { accountId, label, ...(connectedAs ? { connectedAs } : {}) };
    records.push(record);
    await this.setIndex(records);
    return record;
  }

  /**
   * Add many accounts in one pass.
   *
   * addAccount() is O(n) per call — it re-reads the index, appends, and writes
   * the WHOLE array back — so connecting N accounts one at a time costs O(n^2)
   * index writes plus a keychain write and a departments write each. At ~350
   * accounts that is over a thousand awaited writes against an ever-growing
   * blob, which is why a large connect appeared to hang or fail outright.
   *
   * This writes the index and the departments map exactly ONCE, and stores the
   * secrets in bounded-concurrency batches (the OS keychain throttles and can
   * reject an unbounded parallel burst).
   *
   * Returns the ids that were NOT already present, so the caller can run
   * first-time setup for just those.
   */
  async addAccounts(
    incoming: Array<{ accountId: string; label: string; key: string }>,
    connectedAs?: string,
    departments?: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<string[]> {
    const existing = this.list();
    const known = new Set(existing.map((r) => r.accountId));
    const newIds = incoming.filter((a) => !known.has(a.accountId)).map((a) => a.accountId);

    // INDEX FIRST, THEN SECRETS — the order matters on failure.
    //
    // An index entry with no key is visible and self-describing: getKey returns
    // undefined and the UI already says "No stored key for X. Re-connect the
    // account first." A key with no index entry is invisible forever — nothing
    // sweeps orphaned secrets, and secrets.delete is only reachable via signOut,
    // which only sees accounts that are IN the index. Storing secrets first
    // would strand up to a full batch of live keys in the OS keychain on any
    // mid-run failure, while adding zero accounts.
    //
    // Rebuild the index once. Incoming wins on label/connectedAs for accounts
    // already present. Unlike addAccount's filter-then-push this preserves the
    // existing account's POSITION instead of moving it to the tail, so a
    // reconnect no longer churns sidebar order.
    const byId = new Map(existing.map((r) => [r.accountId, r]));
    for (const a of incoming) {
      byId.set(a.accountId, {
        accountId: a.accountId,
        label: a.label,
        ...(connectedAs ? { connectedAs } : {}),
      });
    }
    await this.setIndex([...byId.values()]);

    if (departments) {
      const map = this.ctx.globalState.get<Record<string, string[]>>(DEPARTMENTS_KEY, {});
      for (const a of incoming) map[a.accountId] = departments;
      await this.ctx.globalState.update(DEPARTMENTS_KEY, map);
    }

    // Distinct keychain keys, so a bounded burst is safe. Promise.all fails
    // fast, but the index is already committed, so a failure leaves keyless
    // rows the user can fix by reconnecting — not invisible orphans.
    const BATCH = 12;
    for (let i = 0; i < incoming.length; i += BATCH) {
      const slice = incoming.slice(i, i + BATCH);
      await Promise.all(slice.map((a) => this.ctx.secrets.store(secretKey(a.accountId), a.key.trim())));
      for (const a of slice) this.invalidateClients(a.accountId); // keys may have been rotated
      onProgress?.(Math.min(i + BATCH, incoming.length), incoming.length);
    }

    return newIds;
  }

  /** Follow account renames from Hiveku (label is display-only; the id is identity). */
  async updateLabel(accountId: string, label: string): Promise<void> {
    const records = this.list();
    const rec = records.find((r) => r.accountId === accountId);
    if (!rec || rec.label === label) return;
    rec.label = label;
    await this.setIndex(records);
  }

  async signOut(accountId: string): Promise<void> {
    await this.ctx.secrets.delete(secretKey(accountId));
    this.invalidateClients(accountId);
    await this.setIndex(this.list().filter((r) => r.accountId !== accountId));
    // Clean per-account side maps (were previously leaked on removal).
    for (const key of [FOLDERS_KEY, DEPARTMENTS_KEY, ROLES_KEY]) {
      const map = this.ctx.globalState.get<Record<string, unknown>>(key, {});
      if (accountId in map) {
        delete map[accountId];
        await this.ctx.globalState.update(key, map);
      }
    }
  }

  // ── Archive: hide from the active list but keep the key + record for instant restore ──
  listArchived(): AccountRecord[] {
    return this.ctx.globalState.get<AccountRecord[]>(ARCHIVED_KEY, []);
  }
  async archive(accountId: string): Promise<void> {
    const rec = this.list().find((r) => r.accountId === accountId);
    if (!rec) return;
    const archived = this.listArchived().filter((r) => r.accountId !== accountId);
    archived.push(rec);
    await this.ctx.globalState.update(ARCHIVED_KEY, archived);
    await this.setIndex(this.list().filter((r) => r.accountId !== accountId));
  }
  async restore(accountId: string): Promise<void> {
    const rec = this.listArchived().find((r) => r.accountId === accountId);
    if (!rec) return;
    await this.ctx.globalState.update(ARCHIVED_KEY, this.listArchived().filter((r) => r.accountId !== accountId));
    const active = this.list().filter((r) => r.accountId !== accountId);
    active.push(rec);
    await this.setIndex(active);
  }

  // ── Per-account local folder (where downloads land) ──────────────────────
  getFolder(accountId: string): string | undefined {
    const map = this.ctx.globalState.get<Record<string, string>>(FOLDERS_KEY, {});
    return map[accountId];
  }
  async setFolder(accountId: string, folder: string): Promise<void> {
    const map = this.ctx.globalState.get<Record<string, string>>(FOLDERS_KEY, {});
    map[accountId] = folder;
    await this.ctx.globalState.update(FOLDERS_KEY, map);
  }

  /** Set many account folders with a SINGLE map write. */
  async setFolders(entries: Array<{ accountId: string; folder: string }>): Promise<void> {
    if (entries.length === 0) return;
    const map = this.ctx.globalState.get<Record<string, string>>(FOLDERS_KEY, {});
    for (const e of entries) map[e.accountId] = e.folder;
    await this.ctx.globalState.update(FOLDERS_KEY, map);
  }

  // ── Per-account selected departments (from the Connect flow) ──────────────
  getDepartments(accountId: string): string[] {
    const map = this.ctx.globalState.get<Record<string, string[]>>(DEPARTMENTS_KEY, {});
    return map[accountId] ?? [];
  }
  async setDepartments(accountId: string, departments: string[]): Promise<void> {
    const map = this.ctx.globalState.get<Record<string, string[]>>(DEPARTMENTS_KEY, {});
    map[accountId] = departments;
    await this.ctx.globalState.update(DEPARTMENTS_KEY, map);
  }

  /** Set one role across many accounts with a SINGLE map write. */
  async setRoles(accountIds: string[], role: string): Promise<void> {
    const map = this.ctx.globalState.get<Record<string, string>>(ROLES_KEY, {});
    for (const id of accountIds) map[id] = role;
    await this.ctx.globalState.update(ROLES_KEY, map);
  }

  // ── Per-account role (how this user runs the account here) ────────────────
  getRole(accountId: string): string | undefined {
    const map = this.ctx.globalState.get<Record<string, string>>(ROLES_KEY, {});
    return map[accountId];
  }
  async setRole(accountId: string, role: string): Promise<void> {
    const map = this.ctx.globalState.get<Record<string, string>>(ROLES_KEY, {});
    map[accountId] = role;
    await this.ctx.globalState.update(ROLES_KEY, map);
  }

  /** Pick an account interactively; auto-selects when only one exists. */
  async pick(placeHolder = 'Select a Hiveku account'): Promise<AccountRecord | undefined> {
    const records = this.list();
    if (records.length === 0) return undefined;
    if (records.length === 1) return records[0];
    const choice = await vscode.window.showQuickPick(
      records.map((r) => ({ label: r.label, description: r.accountId, record: r })),
      // matchOnDescription: the account id is shown as the description, and
      // VS Code does NOT match typed text against it by default — so pasting an
      // id (the thing you have when debugging a specific account) matched
      // nothing at all on a roster of hundreds.
      { placeHolder, matchOnDescription: true },
    );
    return choice?.record;
  }
}

function hashShort(input: string): string {
  // Tiny non-crypto hash just to derive a stable fallback id from a key when
  // the server doesn't return an account id. Never used as a credential.
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
