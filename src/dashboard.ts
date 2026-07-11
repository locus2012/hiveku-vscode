/**
 * Agency Dashboard — a webview that rolls up KPIs across ALL connected Hiveku
 * accounts (one card per client): open/overdue tasks, workflows + recent runs,
 * CRM summary, and open/overdue helpdesk tickets. Built for agencies running
 * many client accounts from one place. All data comes from account-level MCP
 * tools, fetched in parallel and tolerant of any single tool being unavailable.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import { mapLimit } from './deptData';
import type { AccountRecord } from './accounts';

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;

interface AccountKpi {
  accountId: string;
  label: string;
  url: string;
  tasksOpen: number;
  tasksOverdue: number;
  workflowsEnabled: number;
  workflowsTotal: number;
  runsRecent: number;
  runsFailed: number;
  ticketsOpen: number;
  ticketsOverdue: number;
  crm: Array<{ label: string; value: string }>;
  /** Server-computed neglect score (account_audit_health) — higher = needs attention sooner. */
  driftScore?: number;
  driftFlags: string[];
  errors: string[];
}

let panel: vscode.WebviewPanel | undefined;

export function openDashboard(
  accounts: AccountRecord[],
  clientFor: ClientFor,
  appUrl: () => string,
): void {
  if (panel) {
    panel.reveal();
    void refresh(accounts, clientFor, appUrl);
    return;
  }
  panel = vscode.window.createWebviewPanel('hivekuDashboard', 'Hiveku — Agency Dashboard', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.onDidDispose(() => (panel = undefined));
  panel.webview.html = dashboardHtml(panel.webview);
  panel.webview.onDidReceiveMessage(async (msg: { type: string; accountId?: string }) => {
    if (msg.type === 'ready' || msg.type === 'refresh') {
      await refresh(accounts, clientFor, appUrl);
    } else if (msg.type === 'open' && msg.accountId) {
      await vscode.env.openExternal(vscode.Uri.parse(`${appUrl().replace(/\/+$/, '')}/${msg.accountId}/dashboard`));
    }
  });
}

async function refresh(accounts: AccountRecord[], clientFor: ClientFor, appUrl: () => string): Promise<void> {
  if (!panel) return;
  panel.webview.postMessage({ type: 'loading' });
  // 3 accounts at a time (7 concurrent calls each) — an unthrottled map
  // across N accounts was the single worst rate-limit burst in the extension.
  const rows = await mapLimit(accounts, 3, (a) => fetchKpi(a, clientFor, appUrl));
  // Agency triage order: most neglected clients first (server drift score).
  rows.sort((a, b) => (b.driftScore ?? -1) - (a.driftScore ?? -1));
  panel.webview.postMessage({ type: 'data', rows });
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

async function fetchKpi(account: AccountRecord, clientFor: ClientFor, appUrl: () => string): Promise<AccountKpi> {
  const kpi: AccountKpi = {
    accountId: account.accountId,
    label: account.label,
    url: `${appUrl().replace(/\/+$/, '')}/${account.accountId}/dashboard`,
    tasksOpen: 0,
    tasksOverdue: 0,
    workflowsEnabled: 0,
    workflowsTotal: 0,
    runsRecent: 0,
    runsFailed: 0,
    ticketsOpen: 0,
    ticketsOverdue: 0,
    crm: [],
    driftFlags: [],
    errors: [],
  };
  let client: HivekuMcpClient;
  try {
    client = await clientFor(account.accountId);
  } catch (e) {
    kpi.errors.push(`auth: ${e instanceof Error ? e.message : String(e)}`);
    return kpi;
  }

  const now = Date.now();
  const [tasks, workflows, runs, crm, tickets, overdue, health] = await Promise.allSettled([
    api.pmTasksList(client),
    api.workflowList(client),
    api.workflowRunsRecent(client),
    api.crmAccountSummary(client),
    api.helpdeskTickets(client, 'open'),
    api.helpdeskOverdue(client),
    client.callToolJson<{ data?: { drift_score?: number; drift_flags?: string[] } }>('account_audit_health', { account_id: account.accountId }),
  ]);

  if (health.status === 'fulfilled') {
    const h = health.value?.data ?? (health.value as { drift_score?: number; drift_flags?: string[] });
    if (typeof h?.drift_score === 'number') kpi.driftScore = h.drift_score;
    if (Array.isArray(h?.drift_flags)) kpi.driftFlags = h.drift_flags.map(String);
  }

  if (tasks.status === 'fulfilled') {
    const open = tasks.value.filter((t) => !['done', 'completed', 'archived'].includes((t.status ?? '').toLowerCase()));
    kpi.tasksOpen = open.length;
    kpi.tasksOverdue = open.filter((t) => t.due_date && Date.parse(t.due_date) < now).length;
  } else kpi.errors.push('tasks');

  if (workflows.status === 'fulfilled') {
    kpi.workflowsTotal = workflows.value.length;
    kpi.workflowsEnabled = workflows.value.filter((w) => api.isWorkflowEnabled(w)).length;
  } else kpi.errors.push('workflows');

  if (runs.status === 'fulfilled') {
    kpi.runsRecent = runs.value.length;
    kpi.runsFailed = runs.value.filter((r) => api.isFailedRunStatus(r.status)).length;
  } else kpi.errors.push('runs');

  if (crm.status === 'fulfilled') {
    const s = crm.value;
    const candidates: Array<[string, string[]]> = [
      ['Open deals', ['open_deals', 'deals_open', 'active_deals', 'deals']],
      ['Pipeline', ['weighted_value', 'pipeline_value', 'total_value', 'open_value']],
      ['Contacts', ['contacts', 'total_contacts', 'contact_count']],
    ];
    for (const [label, keys] of candidates) {
      for (const k of keys) {
        const v = num(s[k]);
        if (v !== undefined) {
          kpi.crm.push({ label, value: label === 'Pipeline' ? formatMoney(v) : String(v) });
          break;
        }
      }
    }
  } else kpi.errors.push('crm');

  if (tickets.status === 'fulfilled') kpi.ticketsOpen = tickets.value.length;
  else kpi.errors.push('tickets');
  if (overdue.status === 'fulfilled') kpi.ticketsOverdue = overdue.value.length;

  return kpi;
}

function formatMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v}`;
}

function dashboardHtml(webview: vscode.Webview): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  // The script builds all DOM via createElement + textContent (never innerHTML),
  // so account/KPI strings can't inject markup.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; padding: 16px; }
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    h1 { font-size: 18px; margin: 0; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
    #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 14px; background: var(--vscode-editorWidget-background); }
    .card h2 { font-size: 14px; margin: 0 0 10px; display: flex; justify-content: space-between; align-items: center; }
    .card h2 a { color: var(--vscode-textLink-foreground); font-weight: 400; font-size: 11px; cursor: pointer; }
    .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .tile { background: var(--vscode-input-background); border-radius: 8px; padding: 8px; text-align: center; }
    .tile .v { font-size: 18px; font-weight: 600; }
    .tile .l { font-size: 10px; opacity: 0.7; margin-top: 2px; }
    .tile.warn .v { color: var(--vscode-editorWarning-foreground); }
    .tile.bad .v { color: var(--vscode-errorForeground); }
    .crm { display: flex; gap: 12px; margin-top: 10px; font-size: 12px; opacity: 0.9; }
    .crm span b { font-weight: 600; }
    .err { font-size: 10px; color: var(--vscode-errorForeground); opacity: 0.7; margin-top: 8px; }
    #empty { opacity: 0.6; }
  </style>
</head>
<body>
  <div class="head">
    <h1>Agency Dashboard</h1>
    <button id="refresh">Refresh</button>
  </div>
  <div id="status"></div>
  <div id="grid"></div>
  <script nonce="${nonce}">
    var vscode = acquireVsCodeApi();
    var grid = document.getElementById('grid');
    var statusEl = document.getElementById('status');
    document.getElementById('refresh').addEventListener('click', function () { vscode.postMessage({ type: 'refresh' }); });

    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }
    function tile(value, label, cls) {
      var t = el('div', 'tile' + (cls ? ' ' + cls : ''));
      t.appendChild(el('div', 'v', String(value)));
      t.appendChild(el('div', 'l', label));
      return t;
    }
    function card(r) {
      var c = el('div', 'card');
      var h = el('h2');
      h.appendChild(el('span', null, r.label));
      var link = el('a', null, 'Open in Hiveku ↗');
      link.addEventListener('click', function () { vscode.postMessage({ type: 'open', accountId: r.accountId }); });
      h.appendChild(link);
      c.appendChild(h);

      var tiles = el('div', 'tiles');
      tiles.appendChild(tile(r.tasksOpen, 'Open tasks'));
      tiles.appendChild(tile(r.tasksOverdue, 'Overdue', r.tasksOverdue > 0 ? 'bad' : ''));
      tiles.appendChild(tile(r.workflowsEnabled + '/' + r.workflowsTotal, 'Workflows'));
      tiles.appendChild(tile(r.runsRecent, 'Recent runs'));
      tiles.appendChild(tile(r.runsFailed, 'Failed runs', r.runsFailed > 0 ? 'warn' : ''));
      tiles.appendChild(tile(r.ticketsOpen, 'Open tickets', r.ticketsOverdue > 0 ? 'warn' : ''));
      if (r.driftScore !== undefined) tiles.appendChild(tile(r.driftScore, 'Drift', r.driftScore >= 50 ? 'bad' : r.driftScore >= 20 ? 'warn' : ''));
      c.appendChild(tiles);
      if (r.driftFlags && r.driftFlags.length) {
        var df = el('div', 'crm');
        df.appendChild(document.createTextNode('Needs attention: ' + r.driftFlags.join(', ').replace(/_/g, ' ')));
        c.appendChild(df);
      }

      if (r.crm && r.crm.length) {
        var crm = el('div', 'crm');
        r.crm.forEach(function (m) {
          var s = el('span');
          s.appendChild(document.createTextNode(m.label + ': '));
          var b = el('b', null, m.value);
          s.appendChild(b);
          crm.appendChild(s);
        });
        c.appendChild(crm);
      }
      if (r.errors && r.errors.length) c.appendChild(el('div', 'err', 'unavailable: ' + r.errors.join(', ')));
      return c;
    }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

    window.addEventListener('message', function (ev) {
      var m = ev.data;
      if (m.type === 'loading') { statusEl.textContent = 'Loading…'; }
      else if (m.type === 'data') {
        statusEl.textContent = '';
        clear(grid);
        if (!m.rows.length) { grid.appendChild(el('div', null, 'No connected accounts.')); return; }
        m.rows.forEach(function (r) { grid.appendChild(card(r)); });
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
