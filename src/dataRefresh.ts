/**
 * Keep hiveku-data/ fresh automatically. Staleness-triggered: on activation and
 * on a 30-minute tick, any enabled account whose last refresh is older than its
 * interval gets a quiet re-export (status-bar progress, non-blocking). No OS-cron
 * worker on purpose — exportDepartments encodes the scope-chain fan-out and
 * README generation, and duplicating it in a standalone script would drift.
 * When VS Code is closed nothing reads hiveku-data/, and a refresh-on-open
 * covers the gap the moment work resumes.
 */

import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { AccountStore } from './accounts';
import { HivekuMcpClient } from './mcpClient';
import { exportDepartments } from './dataExport';
import { effectiveDepartments } from './roles';

const KEY = 'hiveku.autoRefresh';

interface RefreshPrefs {
  enabled: boolean;
  intervalHours: number;
  lastRun?: string;
}

type PrefsMap = Record<string, RefreshPrefs>;

export class DataRefresher {
  private running = false;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly accounts: AccountStore,
    private readonly clientFor: (accountId: string) => Promise<HivekuMcpClient>,
    private readonly entitlementsFor: (accountId: string) => Promise<{ page_access?: Record<string, boolean> } | null>,
    private readonly onRefreshed: () => void,
  ) {}

  private prefs(): PrefsMap {
    return this.ctx.globalState.get<PrefsMap>(KEY, {});
  }
  private async setPrefs(map: PrefsMap): Promise<void> {
    await this.ctx.globalState.update(KEY, map);
  }

  status(accountId: string): RefreshPrefs | undefined {
    return this.prefs()[accountId];
  }

  /** Toggle command: pick the interval or disable. */
  async configure(accountId: string, label: string): Promise<void> {
    const current = this.prefs()[accountId];
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Every 6 hours', hours: 6 },
        { label: 'Every 12 hours', hours: 12 },
        { label: 'Daily', hours: 24 },
        ...(current?.enabled ? [{ label: 'Turn off auto-refresh', hours: 0 }] : []),
      ],
      { placeHolder: `Keep ${label}'s hiveku-data fresh — refresh how often?` },
    );
    if (!pick) return;
    const map = this.prefs();
    if (pick.hours === 0) {
      delete map[accountId];
      await this.setPrefs(map);
      vscode.window.showInformationMessage(`Auto-refresh off for ${label}.`);
      return;
    }
    map[accountId] = { enabled: true, intervalHours: pick.hours, lastRun: map[accountId]?.lastRun };
    await this.setPrefs(map);
    vscode.window.showInformationMessage(`${label}: hiveku-data refreshes every ${pick.hours}h while VS Code is open (and on open when stale).`);
    void this.tick();
  }

  /** Refresh every enabled, stale account (serialized). Called on activation + interval. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const map = this.prefs();
      for (const [accountId, p] of Object.entries(map)) {
        if (!p.enabled) continue;
        const ageMs = p.lastRun ? Date.now() - Date.parse(p.lastRun) : Number.POSITIVE_INFINITY;
        if (ageMs < p.intervalHours * 3600_000) continue;
        const record = this.accounts.list().find((r) => r.accountId === accountId);
        const folder = this.accounts.getFolder(accountId);
        if (!record || !folder) continue;
        try {
          await fs.access(folder);
        } catch {
          continue; // folder gone — skip silently
        }
        try {
          const [client, ent] = await Promise.all([this.clientFor(accountId), this.entitlementsFor(accountId)]);
          const { primary, other } = effectiveDepartments(
            this.accounts.getRole(accountId),
            this.accounts.getDepartments(accountId),
            ent?.page_access,
          );
          // Role departments only by default — the full export stays a manual action.
          const depts = primary.length ? primary : other;
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Hiveku: refreshing ${record.label} data…` },
            () => exportDepartments(client, depts, folder, record.label, () => undefined),
          );
          map[accountId] = { ...p, lastRun: new Date().toISOString() };
          await this.setPrefs(map);
          this.onRefreshed();
        } catch {
          // Network/auth failure — leave lastRun so we retry next tick, never nag.
        }
      }
    } finally {
      this.running = false;
    }
  }
}
