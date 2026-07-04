/**
 * "Connect Hiveku" flow (Phase B). Opens the Hiveku consent page in the browser
 * where the (already-logged-in) user cherry-picks accounts + departments; Hiveku
 * redirects back via a vscode:// deep link with a one-time code, which we
 * exchange server-side for the per-account keys. No manual key paste.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { AccountStore } from './accounts';

interface ExchangeResponse {
  accounts: Array<{ account_id: string; account_name: string; api_key: string }>;
  departments: string[];
  connected_as?: string;
}

export class ConnectFlow {
  private pendingState: string | undefined;

  constructor(
    private readonly accounts: AccountStore,
    private readonly appUrl: () => string,
    private readonly onConnected: (newAccountIds: string[]) => void,
  ) {}

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.window.registerUriHandler({ handleUri: (uri) => this.handleUri(uri) }),
    );
  }

  /** Open the consent page in the browser. */
  async start(): Promise<void> {
    const state = crypto.randomBytes(16).toString('hex');
    this.pendingState = state;
    const redirect = `${vscode.env.uriScheme}://hiveku.hiveku-vscode/auth`;
    // Tell the consent page which accounts are ALREADY connected here so it
    // pre-selects them (instead of showing a fresh "0 of X"). Capped to keep the
    // URL sane for SaaS owners with many accounts.
    const connected = this.accounts.list().map((a) => a.accountId).slice(0, 400);
    const url =
      `${this.appUrl().replace(/\/+$/, '')}/connect/vscode` +
      `?state=${encodeURIComponent(state)}&redirect=${encodeURIComponent(redirect)}` +
      (connected.length ? `&connected=${encodeURIComponent(connected.join(','))}` : '');
    await vscode.env.openExternal(vscode.Uri.parse(url));
    vscode.window.showInformationMessage(
      'Continue in your browser to choose accounts + departments, then return to VS Code.',
    );
  }

  private async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== '/auth') return;
    const params = new URLSearchParams(uri.query);
    const code = params.get('code');
    const state = params.get('state');
    if (!code) {
      vscode.window.showErrorMessage('Hiveku connect: missing code.');
      return;
    }
    if (!state || state !== this.pendingState) {
      vscode.window.showErrorMessage('Hiveku connect: state mismatch — start "Connect Hiveku" again.');
      return;
    }
    this.pendingState = undefined;

    try {
      const data = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Finishing Hiveku connection…' },
        async (): Promise<ExchangeResponse> => {
          const res = await fetch(`${this.appUrl().replace(/\/+$/, '')}/api/connect/vscode/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`exchange HTTP ${res.status}: ${text.slice(0, 200)}`);
          }
          return (await res.json()) as ExchangeResponse;
        },
      );

      // The exchange returns EVERY account selected on the consent page —
      // including ones already connected here. Only the genuinely new ones
      // should trigger first-time setup (role prompts etc.).
      const before = new Set(this.accounts.list().map((a) => a.accountId));
      const newIds: string[] = [];
      for (const a of data.accounts ?? []) {
        if (!before.has(a.account_id)) newIds.push(a.account_id);
        await this.accounts.addAccount(a.account_id, a.account_name || a.account_id, a.api_key, data.connected_as);
        await this.accounts.setDepartments(a.account_id, data.departments ?? []);
      }
      vscode.window.showInformationMessage(
        newIds.length
          ? `Connected ${newIds.length} new Hiveku account(s) (keys refreshed for ${(data.accounts?.length ?? 0) - newIds.length} existing).`
          : `Keys refreshed for ${data.accounts?.length ?? 0} already-connected account(s).`,
      );
      this.onConnected(newIds);
    } catch (err) {
      vscode.window.showErrorMessage(`Hiveku connect failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
