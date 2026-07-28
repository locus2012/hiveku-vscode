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
    // pre-selects them instead of showing a fresh "0 of X".
    //
    // Capped by ENCODED LENGTH, not by count. The old slice(0, 400) let 350
    // accounts produce a ~13.8KB request line — past the 8KB limit nginx and
    // most CDNs enforce — so the consent page failed to load before the user
    // could pick anything. This is supplementary data: the page independently
    // marks accounts connected from the user's own active mcp_api_keys and
    // merely unions this list, so dropping it on a large roster costs nothing
    // but a little pre-selection.
    const MAX_CONNECTED_PARAM_CHARS = 1500;
    const ids: string[] = [];
    let budget = MAX_CONNECTED_PARAM_CHARS;
    for (const a of this.accounts.list()) {
      const cost = a.accountId.length + 3; // id + encoded comma
      if (cost > budget) break;
      budget -= cost;
      ids.push(a.accountId);
    }
    const url =
      `${this.appUrl().replace(/\/+$/, '')}/connect/vscode` +
      `?state=${encodeURIComponent(state)}&redirect=${encodeURIComponent(redirect)}` +
      (ids.length ? `&connected=${encodeURIComponent(ids.join(','))}` : '');
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
      // One index write and one departments write for the whole batch. Doing
      // this per account was O(n^2) on the index and, for a SaaS owner
      // connecting hundreds of accounts, meant well over a thousand awaited
      // writes — the connect appeared to hang and could fail outright.
      const incoming = (data.accounts ?? []).map((a) => ({
        accountId: a.account_id,
        label: a.account_name || a.account_id,
        key: a.api_key,
      }));
      const newIds = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Storing Hiveku account keys…' },
        (progress) =>
          this.accounts.addAccounts(incoming, data.connected_as, data.departments ?? [], (done, total) =>
            progress.report({ message: `${done} of ${total}` }),
          ),
      );
      // Offer the next step rather than ending on a bare toast. Connecting
      // creates no folder and downloads nothing, so a user who stops here has
      // accounts in a sidebar and no way to act on them — the most common place
      // first-run stalled.
      const refreshed = (data.accounts?.length ?? 0) - newIds.length;
      const msg = newIds.length
        ? `Connected ${newIds.length} new Hiveku account(s)${refreshed > 0 ? ` (keys refreshed for ${refreshed} existing)` : ''}.`
        : `Keys refreshed for ${data.accounts?.length ?? 0} already-connected account(s).`;
      const NEXT = 'Set up an account';
      void vscode.window
        .showInformationMessage(
          newIds.length ? `${msg} Next: download an account's data so Claude Code can work on it.` : msg,
          ...(newIds.length ? [NEXT] : []),
        )
        .then((choice) => {
          if (choice === NEXT) void vscode.commands.executeCommand('hiveku.downloadEverything');
        });
      this.onConnected(newIds);
    } catch (err) {
      vscode.window.showErrorMessage(`Hiveku connect failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
