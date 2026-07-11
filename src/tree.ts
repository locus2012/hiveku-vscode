/**
 * Activity-bar tree — the Hiveku Explorer.
 *
 *   Account
 *   ├─ Knowledge
 *   │   ├─ Sales        (12)   ← department; expand to types
 *   │   │   ├─ Memory   (8)    ← download this type
 *   │   │   ├─ Skills   (3)
 *   │   │   └─ Rules    (1)
 *   │   ├─ SEO …  PPC …  Outbound …  Helpdesk …  Marketing …
 *   └─ Code Projects
 *       └─ acme-site (nextjs)  ← download
 *
 * Departments come from a canonical list (so empty ones still show, ready to
 * chat) merged with any found in the account's knowledge. Knowledge is fetched
 * lazily per account (memory_list × types) and cached.
 */

import * as vscode from 'vscode';
import { AccountStore, type AccountRecord } from './accounts';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import {
  fetchKnowledge,
  selectEntries,
  DEPARTMENTS,
  departmentLabel,
  TYPE_LABEL,
  SUPPORTED_TYPES,
  type KnowledgeIndex,
} from './knowledge';

interface AccountNode { kind: 'account'; record: AccountRecord; }
interface DashboardNode { kind: 'dashboard'; record: AccountRecord; }
interface HelpdeskNode { kind: 'helpdesk'; record: AccountRecord; }
interface GroupNode { kind: 'group'; record: AccountRecord; group: 'knowledge' | 'projects' | 'tasks' | 'workflows'; }
interface DepartmentNode { kind: 'department'; record: AccountRecord; department: string; }
interface KTypeNode { kind: 'ktype'; record: AccountRecord; department: string; type: string; count: number; }
interface ProjectNode { kind: 'project'; record: AccountRecord; project: api.SiteSummary; }
interface SiteEnvNode {
  kind: 'siteEnv';
  record: AccountRecord;
  project: api.SiteSummary;
  env: 'preview' | 'development' | 'staging' | 'production';
  label: string;
  /** Resolved URL, or undefined when the env isn't deployed / enabled. */
  url?: string;
  status?: string;
}
interface TaskNode { kind: 'task'; record: AccountRecord; task: api.PmTask; }
interface TaskProjectNode {
  kind: 'taskproject';
  record: AccountRecord;
  label: string;
  /** Resolved to a code (website) project — repo icon instead of folder. */
  site: boolean;
  /** Rendered as a child of the code-project node itself (label "Tasks"). */
  inline?: boolean;
  open: api.PmTask[];
  done: api.PmTask[];
}
interface TaskDoneNode { kind: 'taskdone'; record: AccountRecord; tasks: api.PmTask[]; }
interface WorkflowNode { kind: 'workflow'; record: AccountRecord; workflow: api.Workflow; }
interface MessageNode {
  kind: 'message';
  label: string;
  /** Optional click action (e.g. reconnect on a 401) + icon override. */
  command?: { command: string; title: string; arguments?: unknown[] };
  icon?: string;
  tooltip?: string;
}

/**
 * Turn a failed group load into a message node. An auth failure (the stored key
 * was revoked/rotated/deactivated — e.g. a retired Connect key) becomes a
 * one-click "reconnect" instead of a cryptic "MCP HTTP 401".
 */
function loadFailureNode(what: string, err: unknown, record: AccountRecord): MessageNode {
  const msg = err instanceof Error ? err.message : String(err);
  const isAuth = /\b401\b/.test(msg) || /invalid or inactive api key|unauthor/i.test(msg);
  if (isAuth) {
    return {
      kind: 'message',
      label: `Key expired for ${record.label} — click to reconnect`,
      icon: 'warning',
      command: { command: 'hiveku.connect', title: 'Reconnect Hiveku', arguments: [record] },
      tooltip: `Hiveku rejected this account's stored key (revoked or rotated). Reconnect to mint a fresh one.\n\n${msg}`,
    };
  }
  return { kind: 'message', label: `${what}: ${msg}` };
}

export type HivekuNode =
  | AccountNode
  | DashboardNode
  | HelpdeskNode
  | GroupNode
  | DepartmentNode
  | KTypeNode
  | ProjectNode
  | SiteEnvNode
  | TaskNode
  | TaskProjectNode
  | TaskDoneNode
  | WorkflowNode
  | MessageNode;

export function isTaskDone(t: api.PmTask): boolean {
  return ['done', 'completed', 'archived'].includes((t.status ?? '').toLowerCase());
}

/** Overdue = the due DAY has fully passed locally — a task due today isn't overdue. */
export function isTaskOverdue(t: api.PmTask): boolean {
  if (!t.due_date || isTaskDone(t)) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return String(t.due_date).slice(0, 10) < today;
}

/** Truncation is never silent: the full list lives in the Account Console. */
function moreTasksNode(hidden: number, record: AccountRecord): MessageNode {
  return {
    kind: 'message',
    label: `+${hidden} more — open the Tasks tab in the Account Console`,
    icon: 'ellipsis',
    command: { command: 'hiveku.consoleOpen', title: 'Open Tasks', arguments: [{ record, tab: 'tasks' }] },
    tooltip: 'The sidebar shows the first 50 per group. The Account Console Tasks tab has the full sortable, filterable list.',
  };
}

function taskMatchesSite(t: api.PmTask, site: api.SiteSummary): boolean {
  // An explicit website_project_id link always wins — never let a name
  // coincidence override it (duplicate site names, PM projects named like a site).
  const wid = t.project?.website_project_id;
  if (wid) return wid === site.id;
  const pmName = t.project?.name ?? t.project_name;
  // Annotation feedback projects are named "Website Feedback: <site>" but carry
  // the id link anyway — the name match covers manually created PM projects.
  return !!pmName && !!site.name && (pmName === site.name || pmName === `Website Feedback: ${site.name}`);
}

/** Open/done tasks belonging to one code project (for the project's Tasks child). */
export function tasksForSite(tasks: api.PmTask[], site: api.SiteSummary): { open: api.PmTask[]; done: api.PmTask[] } {
  const open: api.PmTask[] = [];
  const done: api.PmTask[] = [];
  for (const t of tasks) {
    if (!taskMatchesSite(t, site)) continue;
    (isTaskDone(t) ? done : open).push(t);
  }
  return { open, done };
}

export interface TaskProjectGroup {
  label: string;
  site: boolean;
  open: api.PmTask[];
  done: api.PmTask[];
}

/**
 * Group tasks by the project they belong to, resolving PM projects to code
 * projects wherever possible (task.project.website_project_id → sites_list id,
 * with a name-convention fallback). Sorted most-open-work first.
 */
export function groupTasksByProject(tasks: api.PmTask[], sites: api.SiteSummary[]): TaskProjectGroup[] {
  const groups = new Map<string, TaskProjectGroup>();
  for (const t of tasks) {
    const site = sites.find((s) => taskMatchesSite(t, s));
    const pmName = t.project?.name ?? t.project_name;
    const key = site ? `site:${site.id}` : `pm:${t.project?.id ?? t.project_id ?? pmName ?? 'none'}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        label: site ? site.name || pmName || '(project)' : pmName || 'No project',
        site: !!site,
        open: [],
        done: [],
      };
      groups.set(key, g);
    }
    (isTaskDone(t) ? g.done : g.open).push(t);
  }
  return [...groups.values()].sort((a, b) => b.open.length - a.open.length || a.label.localeCompare(b.label));
}

const GROUP_META: Record<string, { label: string; icon: string; context: string; description?: string; tooltip?: string }> = {
  knowledge: {
    label: 'Brand Knowledge',
    icon: 'library',
    context: 'hivekuKnowledgeGroup',
    description: 'AI memory · skills · rules',
    tooltip:
      "Each department's AI brain — memory, skills and rules (what the agents know about this account). " +
      'This is NOT the operational data (deals, rankings, campaigns) — that lives in the Account Console ' +
      'and "Download Department Data".',
  },
  projects: { label: 'Code Projects', icon: 'repo', context: 'hivekuProjectsGroup' },
  tasks: { label: 'Tasks', icon: 'checklist', context: 'hivekuTasksGroup' },
  workflows: { label: 'Workflows', icon: 'zap', context: 'hivekuWorkflowsGroup' },
};

export class HivekuTreeProvider implements vscode.TreeDataProvider<HivekuNode> {
  private readonly _onDidChange = new vscode.EventEmitter<HivekuNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private readonly knowledgeCache = new Map<string, KnowledgeIndex>();
  /** ALL statuses (open + done) — done-ness is split at render time.
   *  Timestamped so tasks go STALE (Claude Code creates tasks/comments mid-session;
   *  a fetch-once snapshot never showed them until a manual refresh). */
  private readonly tasksCache = new Map<string, { tasks: api.PmTask[]; fetchedAt: number }>();
  private readonly sitesCache = new Map<string, api.SiteSummary[]>();
  private readonly workflowsCache = new Map<string, api.Workflow[]>();
  private accountFilter = '';

  /** Filter the account list (for SaaS owners with many accounts). */
  setAccountFilter(filter: string): void {
    this.accountFilter = filter.trim();
    vscode.commands.executeCommand('setContext', 'hiveku.accountFilterActive', this.accountFilter.length > 0);
    this._onDidChange.fire();
  }
  get accountFilterValue(): string {
    return this.accountFilter;
  }

  constructor(
    private readonly accounts: AccountStore,
    private readonly clientFor: (accountId: string) => Promise<HivekuMcpClient>,
  ) {}

  refresh(): void {
    this.knowledgeCache.clear();
    this.tasksCache.clear();
    this.sitesCache.clear();
    this.workflowsCache.clear();
    this._onDidChange.fire();
  }

  /** Tasks are considered fresh for this long; past it, the next repaint refetches. */
  private static readonly TASKS_TTL_MS = 90_000;

  /**
   * Tasks-only freshness. force=true (the refresh button) drops the cache and
   * repaints immediately. force=false (focus/interval ticks) repaints ONLY when
   * some loaded account's tasks are past TTL — for expanded groups that repaint
   * triggers a refetch via ensureTasks; for collapsed groups it costs nothing.
   */
  refreshTasks(force = false): void {
    if (force) {
      this.tasksCache.clear();
      this._onDidChange.fire();
      return;
    }
    if (this.tasksCache.size === 0) return; // never loaded — nothing to keep fresh
    const now = Date.now();
    for (const entry of this.tasksCache.values()) {
      if (now - entry.fetchedAt > HivekuTreeProvider.TASKS_TTL_MS) {
        this._onDidChange.fire();
        return;
      }
    }
  }

  private async ensureIndex(accountId: string): Promise<KnowledgeIndex> {
    const cached = this.knowledgeCache.get(accountId);
    if (cached) return cached;
    const client = await this.clientFor(accountId);
    const index = await fetchKnowledge(client);
    this.knowledgeCache.set(accountId, index);
    return index;
  }

  private async ensureTasks(accountId: string): Promise<api.PmTask[]> {
    const cached = this.tasksCache.get(accountId);
    if (cached && Date.now() - cached.fetchedAt <= HivekuTreeProvider.TASKS_TTL_MS) {
      return cached.tasks;
    }
    try {
      const client = await this.clientFor(accountId);
      const tasks = await api.pmTasksAll(client);
      this.tasksCache.set(accountId, { tasks, fetchedAt: Date.now() });
      return tasks;
    } catch (err) {
      // Refetch failed (offline, key rotated mid-session) — serve the stale
      // snapshot rather than blanking the tree; next tick retries.
      if (cached) return cached.tasks;
      throw err;
    }
  }

  private async ensureSites(accountId: string): Promise<api.SiteSummary[]> {
    const cached = this.sitesCache.get(accountId);
    if (cached) return cached;
    const client = await this.clientFor(accountId);
    const sites = await api.sitesList(client);
    this.sitesCache.set(accountId, sites);
    return sites;
  }

  getTreeItem(node: HivekuNode): vscode.TreeItem {
    switch (node.kind) {
      case 'account': {
        const item = new vscode.TreeItem(node.record.label, vscode.TreeItemCollapsibleState.Expanded);
        item.iconPath = new vscode.ThemeIcon('account');
        item.contextValue = 'hivekuAccount';
        if (node.record.connectedAs) item.description = node.record.connectedAs;
        item.tooltip = node.record.connectedAs
          ? `Connected as ${node.record.connectedAs} — account ${node.record.accountId}`
          : `Hiveku account ${node.record.accountId}`;
        return item;
      }
      case 'dashboard': {
        const item = new vscode.TreeItem('Dashboard', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('dashboard');
        item.contextValue = 'hivekuDashboardItem';
        item.command = { command: 'hiveku.dashboard', title: 'Open Dashboard' };
        return item;
      }
      case 'helpdesk': {
        const item = new vscode.TreeItem('Helpdesk', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('comment-discussion');
        item.contextValue = 'hivekuHelpdeskItem';
        item.command = { command: 'hiveku.helpdesk', title: 'Open Helpdesk', arguments: [node] };
        item.tooltip = 'Support tickets — reply, set status/priority, hand to Claude';
        return item;
      }
      case 'group': {
        const meta = GROUP_META[node.group];
        const item = new vscode.TreeItem(meta.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon(meta.icon);
        item.contextValue = meta.context;
        if (meta.description) item.description = meta.description;
        if (meta.tooltip) item.tooltip = meta.tooltip;
        return item;
      }
      case 'task': {
        const t = node.task;
        const title = t.title || t.name || '(task)';
        const done = isTaskDone(t);
        const item = new vscode.TreeItem(title, vscode.TreeItemCollapsibleState.None);
        const assignee = t.assigned_to?.name || t.assigned_to?.email || '';
        const bits: string[] = [];
        if (assignee) bits.push(assignee);
        if (t.due_date) bits.push(`due ${new Date(t.due_date).toLocaleDateString()}`);
        if (t.priority && t.priority !== 'medium') bits.push(t.priority);
        item.description = bits.join(' · ');
        const overdue = isTaskOverdue(t);
        item.iconPath = new vscode.ThemeIcon(done ? 'pass-filled' : overdue ? 'warning' : 'circle-large-outline');
        item.contextValue = done ? 'hivekuTaskDone' : 'hivekuTask';
        item.command = { command: 'hiveku.openTask', title: 'Open Task', arguments: [node] };
        const lines = [
          title,
          `status: ${(t.status || 'unknown').replace(/_/g, ' ')}`,
          `assigned: ${assignee || 'unassigned'}`,
          t.due_date ? `due: ${new Date(t.due_date).toLocaleDateString()}${overdue ? ' (overdue)' : ''}` : 'due: not set',
          t.priority ? `priority: ${t.priority}` : '',
          t.project?.name || t.project_name ? `project: ${t.project?.name ?? t.project_name}` : '',
        ].filter(Boolean);
        item.tooltip = `${lines.join('\n')}\n\nClick to open details`;
        return item;
      }
      case 'taskproject': {
        const item = new vscode.TreeItem(
          node.inline ? 'Tasks' : node.label,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        const bits = [`${node.open.length} open`];
        if (node.done.length) bits.push(`${node.done.length} done`);
        item.description = bits.join(' · ');
        item.iconPath = new vscode.ThemeIcon(node.inline ? 'checklist' : node.site ? 'repo' : 'folder');
        item.contextValue = 'hivekuTaskProject';
        item.tooltip = node.site
          ? `Tasks for the ${node.label} code project`
          : `Tasks in the "${node.label}" PM project (not linked to a code project)`;
        return item;
      }
      case 'taskdone': {
        const item = new vscode.TreeItem('Completed', vscode.TreeItemCollapsibleState.Collapsed);
        item.description = String(node.tasks.length);
        item.iconPath = new vscode.ThemeIcon('pass-filled');
        item.contextValue = 'hivekuTaskDoneGroup';
        item.tooltip = `${node.tasks.length} completed task(s)`;
        return item;
      }
      case 'workflow': {
        const w = node.workflow;
        const on = api.isWorkflowEnabled(w);
        const item = new vscode.TreeItem(w.name || '(workflow)', vscode.TreeItemCollapsibleState.None);
        item.description = on ? 'on' : 'off';
        item.iconPath = new vscode.ThemeIcon(on ? 'play-circle' : 'circle-slash');
        item.contextValue = on ? 'hivekuWorkflowEnabled' : 'hivekuWorkflowDisabled';
        item.tooltip = w.description || w.name;
        return item;
      }
      case 'department': {
        const item = new vscode.TreeItem(departmentLabel(node.department), vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('organization');
        item.contextValue = 'hivekuDepartment';
        item.tooltip = `${departmentLabel(node.department)} — download knowledge or chat`;
        return item;
      }
      case 'ktype': {
        const item = new vscode.TreeItem(`${TYPE_LABEL[node.type] ?? node.type}`, vscode.TreeItemCollapsibleState.None);
        item.description = String(node.count);
        item.iconPath = new vscode.ThemeIcon('symbol-file');
        item.contextValue = 'hivekuKnowledgeType';
        item.command = { command: 'hiveku.downloadType', title: 'Download', arguments: [node] };
        item.tooltip = `Download ${node.count} ${TYPE_LABEL[node.type] ?? node.type} file(s)`;
        return item;
      }
      case 'project': {
        const external = node.project.project_type === 'external';
        const item = new vscode.TreeItem(
          node.project.name || node.project.slug || node.project.id,
          external ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
        );
        const host = node.project.custom_domain || node.project.subdomain || '';
        item.description = [node.project.project_type, host].filter(Boolean).join(' · ');
        item.iconPath = new vscode.ThemeIcon(external ? 'link-external' : 'repo');
        item.contextValue = external ? 'hivekuProjectExternal' : 'hivekuProject';
        if (external) {
          const url = node.project.custom_domain ? `https://${node.project.custom_domain}` : undefined;
          if (url) item.command = { command: 'hiveku.openSiteEnv', title: 'Open Site', arguments: [{ url }] };
          item.tooltip = `External site${url ? ` — ${url}` : ''} (tracked in Hiveku; code lives elsewhere)`;
        } else {
          // No label command — the node expands to its environments; Download is
          // the inline cloud-download action (hiveku.cloneProjectItem).
          item.tooltip = 'Expand for site environments · use the download icon to pull the code';
        }
        return item;
      }
      case 'siteEnv': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        const host = node.url ? node.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
        item.description = node.url ? host : node.status || 'not deployed';
        item.iconPath = new vscode.ThemeIcon(node.url ? 'globe' : 'circle-slash');
        item.contextValue = 'hivekuSiteEnv';
        if (node.url) {
          item.command = {
            command: 'hiveku.openSiteEnv',
            title: 'Open Site',
            arguments: [{ url: node.url, label: `${node.project.name} — ${node.label}` }],
          };
          item.tooltip = `Open ${node.label} in your browser\n${node.url}${node.status ? `\nstatus: ${node.status}` : ''}`;
        } else {
          item.tooltip =
            `${node.label}: ${node.status || 'not deployed'}` +
            (node.env === 'staging' ? ' — enable staging in the project settings to deploy it' : '');
        }
        return item;
      }
      default: {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(node.icon ?? 'info');
        if (node.command) item.command = node.command;
        if (node.tooltip) item.tooltip = node.tooltip;
        return item;
      }
    }
  }

  async getChildren(node?: HivekuNode): Promise<HivekuNode[]> {
    if (!node) {
      let records = this.accounts.list();
      if (this.accountFilter) {
        const f = this.accountFilter.toLowerCase();
        records = records.filter((r) => r.label.toLowerCase().includes(f) || r.accountId.toLowerCase().includes(f));
      }
      const nodes: HivekuNode[] = records.map((record) => ({ kind: 'account', record }));
      if (this.accountFilter && nodes.length === 0) {
        return [{ kind: 'message', label: `No accounts match "${this.accountFilter}" — clear the filter` }];
      }
      // Setup gate: until the Hiveku root folder is set, downloads have no home.
      const root = vscode.workspace.getConfiguration('hiveku').get<string>('rootFolder');
      if (!root || !root.trim()) {
        nodes.unshift({
          kind: 'message',
          label: 'Set your Hiveku root folder (one-time setup)',
          icon: 'warning',
          command: { command: 'hiveku.setRootFolder', title: 'Set Root Folder' },
          tooltip: 'All accounts and their content (sites, data, knowledge, briefs) are stored under one root folder you choose. Click to set it.',
        });
      }
      return nodes;
    }
    if (node.kind === 'account') {
      return [
        { kind: 'dashboard', record: node.record },
        { kind: 'helpdesk', record: node.record },
        { kind: 'group', record: node.record, group: 'knowledge' },
        { kind: 'group', record: node.record, group: 'projects' },
        { kind: 'group', record: node.record, group: 'tasks' },
        { kind: 'group', record: node.record, group: 'workflows' },
      ];
    }
    if (node.kind === 'group' && node.group === 'knowledge') {
      let index: KnowledgeIndex;
      try {
        index = await this.ensureIndex(node.record.accountId);
      } catch (err) {
        return [loadFailureNode('Failed to load knowledge', err, node.record)];
      }
      // Canonical departments first, then any extras found in the data.
      const found = new Set(index.keys());
      const ordered = [
        ...DEPARTMENTS.map((d) => d.slug).filter((s) => found.has(s) || true),
        ...[...found].filter((s) => !DEPARTMENTS.some((d) => d.slug === s)),
      ];
      const seen = new Set<string>();
      const departments = ordered.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
      return departments.map((department) => ({ kind: 'department', record: node.record, department }));
    }
    if (node.kind === 'group' && node.group === 'projects') {
      try {
        // sites_list = the account's WEBSITE projects (what the dashboard's All
        // Sites shows). list_projects returns PM records — using it here showed
        // task projects instead of sites and broke every env link.
        const projects = await this.ensureSites(node.record.accountId);
        if (projects.length === 0) return [{ kind: 'message', label: 'No site projects' }];
        return projects.map((project) => ({ kind: 'project', record: node.record, project }));
      } catch (err) {
        return [loadFailureNode('Failed to load', err, node.record)];
      }
    }
    if (node.kind === 'group' && node.group === 'tasks') {
      try {
        const tasks = await this.ensureTasks(node.record.accountId);
        if (tasks.length === 0) return [{ kind: 'message', label: 'No tasks' }];
        // Site names resolve task groups to code projects; tolerate sites being
        // unavailable (tasks still group by PM project name).
        const sites = await this.ensureSites(node.record.accountId).catch(() => [] as api.SiteSummary[]);
        const groups = groupTasksByProject(tasks, sites);
        if (groups.length === 1) {
          // One project — skip the pointless grouping level.
          const g = groups[0];
          const children: HivekuNode[] = g.open.slice(0, 50).map((task) => ({ kind: 'task', record: node.record, task }));
          if (children.length === 0) children.push({ kind: 'message', label: 'No open tasks' });
          if (g.open.length > 50) children.push(moreTasksNode(g.open.length - 50, node.record));
          if (g.done.length) children.push({ kind: 'taskdone', record: node.record, tasks: g.done });
          return children;
        }
        return groups.map((g) => ({
          kind: 'taskproject',
          record: node.record,
          label: g.label,
          site: g.site,
          open: g.open,
          done: g.done,
        }));
      } catch (err) {
        return [loadFailureNode('Tasks unavailable', err, node.record)];
      }
    }
    if (node.kind === 'taskproject') {
      const children: HivekuNode[] = node.open.slice(0, 50).map((task) => ({ kind: 'task', record: node.record, task }));
      if (children.length === 0) children.push({ kind: 'message', label: 'No open tasks' });
      if (node.open.length > 50) children.push(moreTasksNode(node.open.length - 50, node.record));
      if (node.done.length) children.push({ kind: 'taskdone', record: node.record, tasks: node.done });
      return children;
    }
    if (node.kind === 'taskdone') {
      const children: HivekuNode[] = node.tasks.slice(0, 50).map((task) => ({ kind: 'task', record: node.record, task }));
      if (node.tasks.length > 50) children.push(moreTasksNode(node.tasks.length - 50, node.record));
      return children;
    }
    if (node.kind === 'group' && node.group === 'workflows') {
      try {
        let wfs = this.workflowsCache.get(node.record.accountId);
        if (!wfs) {
          const client = await this.clientFor(node.record.accountId);
          wfs = await api.workflowList(client);
          this.workflowsCache.set(node.record.accountId, wfs);
        }
        if (wfs.length === 0) return [{ kind: 'message', label: 'No workflows' }];
        return wfs.map((workflow) => ({ kind: 'workflow', record: node.record, workflow }));
      } catch (err) {
        return [loadFailureNode('Workflows unavailable', err, node.record)];
      }
    }
    if (node.kind === 'department') {
      const index = await this.ensureIndex(node.record.accountId);
      const byType = index.get(node.department);
      const types = SUPPORTED_TYPES
        .map((type) => ({ type, count: byType?.get(type)?.length ?? 0 }))
        .filter((t) => t.count > 0);
      if (types.length === 0) {
        return [{ kind: 'message', label: 'No downloaded knowledge — chat to build it' }];
      }
      return types.map((t) => ({
        kind: 'ktype',
        record: node.record,
        department: node.department,
        type: t.type,
        count: t.count,
      }));
    }
    if (node.kind === 'project') {
      if (node.project.project_type === 'external') return [];
      // sites_list already resolved every environment URL — build links locally.
      const children: HivekuNode[] = api.envDescriptorsFromSite(node.project).map((d) => ({
        kind: 'siteEnv',
        record: node.record,
        project: node.project,
        env: d.env,
        label: d.label,
        url: d.url,
        status: d.status,
      }));
      try {
        // This code project's own tasks (annotation feedback etc.), nested here
        // so the work lives with the project it belongs to.
        const mine = tasksForSite(await this.ensureTasks(node.record.accountId), node.project);
        if (mine.open.length || mine.done.length) {
          children.push({
            kind: 'taskproject',
            record: node.record,
            label: node.project.name || node.project.slug || 'project',
            site: true,
            inline: true,
            open: mine.open,
            done: mine.done,
          });
        }
      } catch {
        // Tasks are supplementary here — env links must always render.
      }
      return children;
    }
    return [];
  }

  /** Read the cached index (loaded once the Knowledge group has been opened). */
  knowledgeFor(accountId: string): KnowledgeIndex | undefined {
    return this.knowledgeCache.get(accountId);
  }

  async indexFor(accountId: string): Promise<KnowledgeIndex> {
    return this.ensureIndex(accountId);
  }
}

// Re-export so extension.ts can build download payloads without re-importing knowledge internals.
export { selectEntries };
