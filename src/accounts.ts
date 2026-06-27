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
const SECRET_PREFIX = 'hiveku.key.';

export interface AccountRecord {
  accountId: string;
  label: string;
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

  async getClient(accountId: string, baseUrl: string): Promise<HivekuMcpClient> {
    const key = await this.getKey(accountId);
    if (!key) throw new Error(`No stored key for account ${accountId}. Run "Hiveku: Sign In".`);
    return new HivekuMcpClient({ baseUrl, apiKey: key });
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

  async signOut(accountId: string): Promise<void> {
    await this.ctx.secrets.delete(secretKey(accountId));
    await this.setIndex(this.list().filter((r) => r.accountId !== accountId));
  }

  /** Pick an account interactively; auto-selects when only one exists. */
  async pick(placeHolder = 'Select a Hiveku account'): Promise<AccountRecord | undefined> {
    const records = this.list();
    if (records.length === 0) return undefined;
    if (records.length === 1) return records[0];
    const choice = await vscode.window.showQuickPick(
      records.map((r) => ({ label: r.label, description: r.accountId, record: r })),
      { placeHolder },
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
