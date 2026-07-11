/**
 * Account Console — the sidebar TREE that mirrors the console panel.
 *
 *   Forney Corporation            ← account
 *   ├─ Tasks                      ← opens the console Tasks board
 *   ├─ Automations                ← opens the console Automations tab
 *   ├─ Outbound (BDR)             ← department; expand to datasets
 *   │   ├─ Campaigns      12      ← opens the console focused on this dataset
 *   │   └─ Leads         340
 *   ├─ CRM / Sales …  SEO …  Content …
 *
 * Departments + datasets come from the SAME registry (deptData.ts) that drives
 * the panel and the local export, so the three surfaces never drift. Counts for
 * cheap (non-scoped) datasets are fetched lazily on expand and cached; scoped
 * datasets (which fan out per project/connection) are shown without a count to
 * keep expansion snappy. Clicking any node opens the console panel focused there.
 */

import * as vscode from 'vscode';
import { AccountStore, type AccountRecord } from './accounts';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import { mapLimit, departmentById, fetchDataset } from './deptData';
import { effectiveDepartments, roleById } from './roles';

interface AccountNode { kind: 'account'; record: AccountRecord; }
interface SectionNode { kind: 'section'; record: AccountRecord; tab: 'tasks' | 'automations'; label: string; icon: string; }
interface DeptNode { kind: 'dept'; record: AccountRecord; deptId: string; label: string; }
interface DatasetNode { kind: 'dataset'; record: AccountRecord; deptId: string; datasetId: string; label: string; count?: number; }
interface MessageNode { kind: 'message'; label: string; command?: { command: string; title: string; arguments?: unknown[] }; icon?: string; }

export type ConsoleNode = AccountNode | SectionNode | DeptNode | DatasetNode | MessageNode;

type EntitlementsFor = (accountId: string) => Promise<{ page_access?: Record<string, boolean> } | null>;

export class AccountConsoleProvider implements vscode.TreeDataProvider<ConsoleNode> {
  private readonly _onDidChange = new vscode.EventEmitter<ConsoleNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  /** accountId → page_access map (cached). */
  private readonly entCache = new Map<string, Record<string, boolean> | undefined>();
  /** `${accountId}:${deptId}` → datasetId → count. */
  private readonly countCache = new Map<string, Map<string, number>>();
  private filter = '';
  /** When true, non-role departments are listed too (toggled via hiveku.consoleShowAll). */
  showAll = false;

  setShowAll(value: boolean): void {
    this.showAll = value;
    this._onDidChange.fire();
  }

  constructor(
    private readonly accounts: AccountStore,
    private readonly clientFor: (accountId: string) => Promise<HivekuMcpClient>,
    private readonly entitlementsFor: EntitlementsFor,
  ) {}

  setFilter(filter: string): void {
    this.filter = filter.trim();
    this._onDidChange.fire();
  }

  refresh(): void {
    this.entCache.clear();
    this.countCache.clear();
    this._onDidChange.fire();
  }

  getTreeItem(node: ConsoleNode): vscode.TreeItem {
    switch (node.kind) {
      case 'account': {
        const item = new vscode.TreeItem(node.record.label, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('account');
        item.contextValue = 'hivekuConsoleAccount';
        const role = roleById(this.accounts.getRole(node.record.accountId));
        if (role) item.description = role.label;
        item.tooltip = `Account Console — ${node.record.label}${role ? `\nRole: ${role.label} (change via "Hiveku: Set Role")` : ''}`;
        return item;
      }
      case 'section': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        // Per-tab context so menus can target one section (e.g. New Task on Tasks only).
        item.contextValue = `hivekuConsoleSection.${node.tab}`;
        item.command = { command: 'hiveku.consoleOpen', title: 'Open', arguments: [{ record: node.record, tab: node.tab }] };
        return item;
      }
      case 'dept': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('organization');
        item.contextValue = 'hivekuConsoleDept';
        item.tooltip = `${node.label} — expand for datasets, or click to open`;
        item.command = { command: 'hiveku.consoleOpen', title: 'Open', arguments: [{ record: node.record, tab: node.deptId }] };
        return item;
      }
      case 'dataset': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        if (node.count !== undefined) item.description = String(node.count);
        item.iconPath = new vscode.ThemeIcon('list-flat');
        item.contextValue = 'hivekuConsoleDataset';
        item.command = {
          command: 'hiveku.consoleOpen',
          title: 'Open',
          arguments: [{ record: node.record, tab: node.deptId, focus: node.datasetId }],
        };
        item.tooltip = node.count !== undefined ? `${node.label} — ${node.count} rows` : node.label;
        return item;
      }
      default: {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(node.icon ?? 'info');
        if (node.command) item.command = node.command;
        return item;
      }
    }
  }

  async getChildren(node?: ConsoleNode): Promise<ConsoleNode[]> {
    if (!node) {
      let records = this.accounts.list();
      if (this.filter) {
        const f = this.filter.toLowerCase();
        records = records.filter((r) => r.label.toLowerCase().includes(f) || r.accountId.toLowerCase().includes(f));
      }
      if (records.length === 0) return [{ kind: 'message', label: 'No connected accounts — run "Hiveku: Connect"' }];
      return records.map((record) => ({ kind: 'account', record }));
    }

    if (node.kind === 'account') {
      const sections: ConsoleNode[] = [
        { kind: 'section', record: node.record, tab: 'tasks', label: 'Tasks', icon: 'checklist' },
        { kind: 'section', record: node.record, tab: 'automations', label: 'Automations', icon: 'zap' },
      ];
      let pageAccess: Record<string, boolean> | undefined;
      try {
        if (this.entCache.has(node.record.accountId)) {
          pageAccess = this.entCache.get(node.record.accountId);
        } else {
          const ent = await this.entitlementsFor(node.record.accountId);
          pageAccess = ent?.page_access;
          this.entCache.set(node.record.accountId, pageAccess);
        }
      } catch {
        /* show all departments if entitlements are unavailable */
      }
      // Role-ordered departments: the account's role leads, the rest behind a toggle.
      // Excluded: `workflows` (the Automations section covers cloud workflows) and
      // `pages` (redundant — Code Projects in the tree above carries the sites;
      // page data still ships in the local data export).
      const HIDDEN_DEPTS = new Set(['workflows', 'pages']);
      const { primary, other } = effectiveDepartments(
        this.accounts.getRole(node.record.accountId),
        this.accounts.getDepartments(node.record.accountId),
        pageAccess,
      );
      const toNode = (d: { id: string; label: string }): ConsoleNode => ({
        kind: 'dept',
        record: node.record,
        deptId: d.id,
        label: d.label,
      });
      const primaryNodes = primary.filter((d) => !HIDDEN_DEPTS.has(d.id)).map(toNode);
      const otherDepts = other.filter((d) => !HIDDEN_DEPTS.has(d.id));
      const tail: ConsoleNode[] = [];
      if (otherDepts.length > 0) {
        if (this.showAll) {
          tail.push(...otherDepts.map(toNode));
          tail.push({ kind: 'message', label: 'Show fewer departments', icon: 'fold-up', command: { command: 'hiveku.consoleShowAll', title: 'Toggle' } });
        } else {
          tail.push({
            kind: 'message',
            label: `More departments (${otherDepts.length})`,
            icon: 'ellipsis',
            command: { command: 'hiveku.consoleShowAll', title: 'Show all departments' },
          });
        }
      }
      return [...sections, ...primaryNodes, ...tail];
    }

    if (node.kind === 'dept') {
      const dept = departmentById(node.deptId);
      if (!dept) return [];
      const cacheKey = `${node.record.accountId}:${node.deptId}`;
      let counts = this.countCache.get(cacheKey);
      if (!counts) {
        counts = new Map<string, number>();
        try {
          const client = await this.clientFor(node.record.accountId);
          // Only count cheap (non-scoped) datasets — scoped ones fan out per
          // project/connection and would stall the expand. Capped at 4
          // concurrent and ONE page (a count badge never needs the 40-page
          // pagination walk); 200+ shows as "200".
          await mapLimit(
            dept.datasets.filter((ds) => !ds.scope),
            4,
            async (ds) => {
              try {
                const { rows } = await fetchDataset(client, ds, 200);
                counts!.set(ds.id, rows.length);
              } catch {
                /* leave this dataset countless */
              }
            },
          );
          this.countCache.set(cacheKey, counts);
        } catch {
          /* client/auth failure — fall through with whatever we have */
        }
      }
      const children: ConsoleNode[] = dept.datasets.map(
        (ds): ConsoleNode => ({
          kind: 'dataset',
          record: node.record,
          deptId: node.deptId,
          datasetId: ds.id,
          label: ds.label,
          count: counts!.has(ds.id) ? counts!.get(ds.id) : undefined,
        }),
      );
      // Everything empty + a setup playbook exists → this department probably
      // isn't connected yet. Surface the setup path instead of a wall of zeros.
      const counted = [...counts.values()];
      if (dept.setup && counted.length > 0 && counted.every((n) => n === 0)) {
        children.unshift({
          kind: 'message',
          label: 'Looks not set up — copy the setup prompt for Claude Code',
          icon: 'plug',
          command: { command: 'hiveku.consoleOpen', title: 'Connect', arguments: [{ record: node.record, tab: 'integrations' }] },
        });
      }
      return children;
    }

    return [];
  }
}
