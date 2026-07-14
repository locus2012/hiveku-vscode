/**
 * Hiveku VS Code extension — Phase 1.
 *
 * Lets a developer (or Claude Code) connect one or more Hiveku accounts, do a
 * full download of a site project into a local folder, and commit/deploy back
 * to Hiveku. Commits live entirely in Supabase (no GitHub). The native Source
 * Control panel shows local-vs-Hiveku changes; the project's `main` branch is
 * bootstrapped lazily on first download.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { AccountStore, type AccountRecord } from './accounts';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import { downloadAndExtract } from './download';
import { HivekuScm } from './scm';
import { HivekuTreeProvider } from './tree';
import { AccountConsoleProvider } from './consoleTree';
import { ConnectFlow } from './connect';
import { openDepartmentChat } from './chat';
import { registerFileHistory } from './timeline';
import * as resources from './resources';
import { pullEnv, pushEnv } from './env';
import { openMediaGallery } from './gallery';
import { openReviewAnnotator } from './reviewAnnotator';
import { openDashboard } from './dashboard';
import { openAccountConsole, refreshConsoleTab } from './console';
import { openModulePanel, isEntitled } from './panel';
import { MODULES, PROJECT_MODULE, moduleById, moduleGroupGate } from './modules';
import { openTaskDetail } from './taskDetail';
import {
  writeEntries,
  writeScaffold,
  writeProjectScaffold,
  selectEntries,
  slugForAccount,
  departmentLabel,
  TYPE_LABEL,
  computeSyncStatus,
  hivekuMcpServer,
  setPermissionMode,
  setSandboxWorkspace,
  setConnectedAsMap,
  setCodexSupport,
  type PermissionMode,
} from './knowledge';
import { setLocalHivekuServer, hasLocalHivekuServer, hasUserHivekuServer } from './claudeMcp';
import { syncAccountCommands } from './commandSync';
import { DataRefresher } from './dataRefresh';
import { ROLES, effectiveDepartments } from './roles';
import { departmentById, DEPARTMENTS } from './deptData';
import { exportDepartments, DATA_DIR } from './dataExport';
import { SETUP_PROMPTS, setupPromptById } from './setupPrompts';
import { setupLocalSupabase } from './localSupabase';
import { scaffoldLocalAutomations, installAgencyCadence } from './localAutomations';
import { captureBaseline, writeProjectLink, readProjectLink, type ProjectLink } from './workspace';
import { registerHivekuFs, envUri } from './platformFs';
import { openDatabasePanel } from './databasePanel';

let accounts: AccountStore;
let log: vscode.OutputChannel;
let siteLogs: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;
let permStatusBar: vscode.StatusBarItem;
let tree: HivekuTreeProvider;
let treeView: vscode.TreeView<unknown>;
let consoleTree: AccountConsoleProvider;
let refresher: DataRefresher;
let connect: ConnectFlow;
// Per-account snapshot for change detection (project id→env signature + task
// id→status signature). In-memory: a reload re-baselines (no false "new" spam).
const accountSnapshots = new Map<string, { projects: Map<string, string>; tasks: Map<string, string> }>();
let extensionContext: vscode.ExtensionContext;
const scms = new Map<string, HivekuScm>();

/** Collect "needs attention" items across all accounts (overdue tasks, failed runs). */
/**
 * The 5-minute background scan across connected accounts. Surfaces "needs
 * attention" (overdue tasks, failed runs) AND detects changes since the last scan
 * (new projects, new tasks, updated tasks) by diffing against a per-account
 * snapshot. Returns the badge lines + whether anything changed (→ refresh tree).
 */
async function scanAccounts(): Promise<{ lines: string[]; changed: boolean }> {
  const lines: string[] = [];
  let changed = false;
  for (const acc of accounts.list()) {
    try {
      const client = await clientForAccount(acc.accountId);
      const [projectsR, tasksR, runsR, infoR] = await Promise.allSettled([
        api.sitesList(client), // site projects (what "new project" should mean), not PM records
        api.pmTasksList(client),
        api.workflowRunsRecent(client),
        client.callToolJson<{ data?: { name?: string } }>('get_account_info', {}),
      ]);
      // Follow account renames from Hiveku into the sidebar/console labels.
      if (infoR.status === 'fulfilled') {
        const fresh = infoR.value?.data?.name;
        if (typeof fresh === 'string' && fresh && fresh !== acc.label) {
          await accounts.updateLabel(acc.accountId, fresh);
          changed = true;
        }
      }
      const tasks = tasksR.status === 'fulfilled' ? tasksR.value : [];
      const projects = projectsR.status === 'fulfilled' ? projectsR.value : [];

      // Attention items.
      if (tasksR.status === 'fulfilled') {
        const overdue = tasks.filter(
          (t) =>
            t.due_date &&
            Date.parse(t.due_date) < Date.now() &&
            !['done', 'completed', 'archived'].includes((t.status ?? '').toLowerCase()),
        );
        if (overdue.length) lines.push(`${acc.label}: ${overdue.length} overdue task(s)`);
      }
      if (runsR.status === 'fulfilled') {
        const failed = runsR.value.filter((r) => api.isFailedRunStatus(r.status));
        if (failed.length) lines.push(`${acc.label}: ${failed.length} failed workflow run(s)`);
      }

      // Change detection vs the last snapshot (skip on first scan = baseline).
      // The project signature covers the env fields the sidebar renders — a
      // deploy going live, a domain change or a rename must invalidate the
      // tree's sites cache even though the project ID set is unchanged.
      const projSig = new Map(
        projects.map((p) => [
          String(p.id),
          JSON.stringify([
            p.name ?? null,
            p.environments?.development?.url ?? null,
            p.environments?.staging?.enabled ? p.environments?.staging?.url ?? 'on' : 'off',
            p.environments?.production?.url ?? null,
            p.environments?.production?.status ?? null,
            p.custom_domain ?? null,
            p.live_preview?.url ?? null,
            p.live_preview?.container_status ?? null,
          ]),
        ]),
      );
      // Status is part of the task signature: list rows carry no updated_at, and
      // a dashboard-side completion must move the task into the tree's Completed
      // group on the next scan.
      const taskSig = new Map(
        tasks.map((t) => [String(t.id), `${t.status ?? ''}|${(t as { updated_at?: string }).updated_at ?? ''}`]),
      );
      const prev = accountSnapshots.get(acc.accountId);
      if (prev && (projectsR.status === 'fulfilled' || tasksR.status === 'fulfilled')) {
        const newProj = [...projSig.keys()].filter((id) => !prev.projects.has(id)).length;
        if (
          projectsR.status === 'fulfilled' &&
          [...projSig].some(([id, sig]) => prev.projects.has(id) && prev.projects.get(id) !== sig)
        ) {
          changed = true; // env/name drift on an existing project — refresh silently
        }
        let newTask = 0;
        let updTask = 0;
        for (const [id, sig] of taskSig) {
          if (!prev.tasks.has(id)) newTask++;
          else if (sig && prev.tasks.get(id) !== sig) updTask++;
        }
        const bits: string[] = [];
        if (newProj) bits.push(`${newProj} new project(s)`);
        if (newTask) bits.push(`${newTask} new task(s)`);
        if (updTask) bits.push(`${updTask} updated task(s)`);
        if (bits.length) {
          lines.push(`${acc.label}: ${bits.join(', ')}`);
          changed = true;
        }
      }
      accountSnapshots.set(acc.accountId, { projects: projSig, tasks: taskSig });
    } catch {
      /* skip unreachable accounts */
    }
  }
  return { lines, changed };
}

async function updateNotifications(): Promise<void> {
  if (!treeView) return;
  const { lines, changed } = await scanAccounts();
  // Root-folder setup outranks everything: until it's set, downloads have no home.
  if (!hivekuRoot()) {
    lines.unshift('1 setup step: set your Hiveku root folder (all accounts store under it) - run "Hiveku: Set Root Folder"');
  }
  let count = 0;
  for (const s of lines) {
    const m = s.match(/(\d+)/);
    if (m) count += Number.parseInt(m[1], 10);
  }
  treeView.badge = count > 0 ? { value: count, tooltip: `Hiveku — updates:\n${lines.join('\n')}` } : undefined;
  // New/updated projects or tasks landed on Hiveku → refresh the sidebar so it's current.
  if (changed) tree.refresh();
}

function updateSignedInContext(): void {
  vscode.commands.executeCommand('setContext', 'hiveku.signedIn', accounts.list().length > 0);
}

function baseUrl(): string {
  return vscode.workspace.getConfiguration('hiveku').get<string>('baseUrl', 'https://core.hiveku.com');
}

function appUrl(): string {
  return vscode.workspace.getConfiguration('hiveku').get<string>('appUrl', 'https://app.hiveku.com');
}

function clientForAccount(accountId: string): Promise<HivekuMcpClient> {
  return accounts.getClient(accountId, baseUrl());
}

const PERM_LABELS: Record<PermissionMode, { short: string; icon: string; blurb: string }> = {
  bypassPermissions: { short: 'Autonomous', icon: '$(unlock)', blurb: 'Skip ALL prompts — bash, deploys, tools. .env*.local still blocked.' },
  acceptEdits: { short: 'Auto-edits', icon: '$(check)', blurb: 'Auto-approve file edits; still ask for bash, deploys, network.' },
  default: { short: 'Ask', icon: '$(shield)', blurb: 'Confirm before every edit and command.' },
};

function currentPermMode(): PermissionMode {
  return vscode.workspace.getConfiguration('hiveku').get<PermissionMode>('claudeCodePermissionMode', 'acceptEdits');
}

function refreshPermStatusBar(): void {
  if (!permStatusBar) return;
  const info = PERM_LABELS[currentPermMode()] ?? PERM_LABELS.acceptEdits;
  permStatusBar.text = `${info.icon} Claude: ${info.short}`;
  permStatusBar.tooltip = `Claude Code autonomy in Hiveku workspaces — ${info.blurb}\nClick to change.`;
  permStatusBar.show();
}

function syncPermissionMode(): void {
  setPermissionMode(currentPermMode());
  setSandboxWorkspace(vscode.workspace.getConfiguration('hiveku').get<boolean>('sandboxWorkspace', false));
  refreshPermStatusBar();
}

/** Push accountId -> connected user email into the scaffold layer so it attributes
 *  PM tasks/comments to the authenticated user. Call on activate + account changes. */
function syncConnectedAs(): void {
  setConnectedAsMap(Object.fromEntries(accounts.list().map((a) => [a.accountId, a.connectedAs])));
}

/** UI toggle for Claude Code autonomy — status bar / console button / palette. */
async function choosePermissionMode(): Promise<void> {
  const current = currentPermMode();
  const items: Array<vscode.QuickPickItem & { value: PermissionMode }> = [
    { value: 'bypassPermissions', label: '$(unlock) Autonomous', description: PERM_LABELS.bypassPermissions.blurb },
    { value: 'acceptEdits', label: '$(check) Auto-accept edits', description: PERM_LABELS.acceptEdits.blurb },
    { value: 'default', label: '$(shield) Ask every time', description: PERM_LABELS.default.blurb },
  ];
  for (const it of items) if (it.value === current) it.label += '  ✓ current';
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Hiveku · Claude Code Autonomy (this applies to Hiveku workspaces only)',
    placeHolder: `Currently: ${PERM_LABELS[current].short}`,
  });
  if (!pick || pick.value === current) return;
  // Global so it's your default across all Hiveku folders; the effect is still
  // per-workspace (written into each folder's .vscode/.claude on scaffold/refresh).
  // onDidChangeConfiguration re-syncs + offers Refresh Setup.
  await vscode.workspace
    .getConfiguration('hiveku')
    .update('claudeCodePermissionMode', pick.value, vscode.ConfigurationTarget.Global);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  syncPermissionMode();
  setCodexSupport(vscode.workspace.getConfiguration('hiveku').get<boolean>('codexSupport', false));
  accounts = new AccountStore(context);
  syncConnectedAs();
  log = vscode.window.createOutputChannel('Hiveku');
  siteLogs = vscode.window.createOutputChannel('Hiveku — Site Logs');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'hiveku.switchAccount';
  permStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  permStatusBar.command = 'hiveku.setPermissionMode';
  context.subscriptions.push(log, statusBar, permStatusBar);
  refreshPermStatusBar();

  context.subscriptions.push(
    vscode.commands.registerCommand('hiveku.signIn', () => signIn()),
    vscode.commands.registerCommand('hiveku.setPermissionMode', () => choosePermissionMode()),
    vscode.commands.registerCommand('hiveku.switchAccount', () => switchAccount()),
    vscode.commands.registerCommand('hiveku.setClaudeCodeAccount', () => setClaudeCodeAccount()),
    vscode.commands.registerCommand('hiveku.downloadData', (node) => downloadData(node)),
    vscode.commands.registerCommand('hiveku.copySetupPrompt', (node) => copySetupPrompt(node)),
    vscode.commands.registerCommand('hiveku.newAutomation', () => newAutomation()),
    vscode.commands.registerCommand('hiveku.signOut', (node) => signOut(node)),
    vscode.commands.registerCommand('hiveku.restoreAccount', () => restoreAccount()),
    vscode.commands.registerCommand('hiveku.cloneProject', () => cloneProject()),
    vscode.commands.registerCommand('hiveku.refresh', () => withScm((s) => s.refresh())),
    vscode.commands.registerCommand('hiveku.commit', () => withScm((s) => s.commit())),
    vscode.commands.registerCommand('hiveku.pushLocal', () => withScm((s) => s.push())),
    vscode.commands.registerCommand('hiveku.annotateReview', () => withScm((s) => openReviewAnnotator(s.root, s.link.project_name))),
    vscode.commands.registerCommand('hiveku.showHistory', () => withScm((s) => showHistory(s))),
    vscode.commands.registerCommand('hiveku.revert', () => withScm((s) => revert(s))),
    vscode.commands.registerCommand('hiveku.deploy', () => withScm((s) => deploy(s))),
    vscode.commands.registerCommand('hiveku.pull', () => withScm((s) => pull(s))),
    vscode.commands.registerCommand('hiveku.createBranch', () => withScm((s) => createBranch(s))),
    vscode.commands.registerCommand('hiveku.switchBranch', () => withScm((s) => switchBranch(s))),
    vscode.commands.registerCommand('hiveku.merge', () => withScm((s) => merge(s))),
    vscode.commands.registerCommand('hiveku.previewBranch', () => withScm((s) => previewBranch(s))),
    vscode.commands.registerCommand('hiveku.compare', () => withScm((s) => compare(s))),
    vscode.commands.registerCommand('hiveku.prune', () => withScm((s) => prune(s))),
    vscode.commands.registerCommand('hiveku.refreshTree', () => {
      invalidateEntitlements();
      tree.refresh();
    }),
    vscode.commands.registerCommand('hiveku.refreshTasks', () => tree.refreshTasks(true)),
    vscode.commands.registerCommand('hiveku.filterAccounts', () => filterAccounts()),
    vscode.commands.registerCommand('hiveku.clearAccountFilter', () => tree.setAccountFilter('')),
    vscode.commands.registerCommand('hiveku.cloneProjectItem', (node) => cloneProjectItem(node)),
    vscode.commands.registerCommand('hiveku.connect', () => connect.start()),
    vscode.commands.registerCommand('hiveku.downloadType', (node) => downloadType(node)),
    vscode.commands.registerCommand('hiveku.downloadDepartment', (node) => downloadDepartment(node)),
    vscode.commands.registerCommand('hiveku.downloadEverything', (node) => downloadEverything(node)),
    vscode.commands.registerCommand('hiveku.chatDepartment', (node) => chatDepartment(node)),
    vscode.commands.registerCommand('hiveku.checkSync', (node) => checkSync(node)),
    vscode.commands.registerCommand('hiveku.checkRemote', () => withScm((s) => checkRemote(s))),
    vscode.commands.registerCommand('hiveku.openPreview', () => withScm((s) => resources.openPreview(s, clientForAccount))),
    vscode.commands.registerCommand('hiveku.syncPreview', () => withScm((s) => resources.syncPreview(s, clientForAccount))),
    vscode.commands.registerCommand('hiveku.previewLogs', () => withScm((s) => resources.previewLogs(s, clientForAccount, log))),
    vscode.commands.registerCommand('hiveku.previewScreenshot', () => withScm((s) => resources.previewScreenshot(s, clientForAccount))),
    vscode.commands.registerCommand('hiveku.secrets', () => withScm((s) => resources.manageSecrets(s, clientForAccount))),
    vscode.commands.registerCommand('hiveku.pullEnv', () => withScm((s) => pullEnv(s, clientForAccount))),
    vscode.commands.registerCommand('hiveku.pushEnv', () => withScm((s) => pushEnv(s, clientForAccount))),
    vscode.commands.registerCommand('hiveku.localSupabase', () => withScm((s) => localSupabaseForScm(s))),
    vscode.commands.registerCommand('hiveku.database', () => withScm((s) => resources.showDatabase(s, clientForAccount))),
    vscode.commands.registerCommand('hiveku.media', () => withScm((s) => resources.showMedia(s, clientForAccount))),
    vscode.commands.registerCommand('hiveku.mediaGallery', (node) => mediaGallery(node)),
    vscode.commands.registerCommand('hiveku.setup', () => runSetup()),
    vscode.commands.registerCommand('hiveku.dashboard', () => openDashboard(accounts.list(), clientForAccount, appUrl)),
    vscode.commands.registerCommand('hiveku.openTask', (node) => openTask(node)),
    vscode.commands.registerCommand('hiveku.helpdesk', (node) => openHelpdesk(node)),
    vscode.commands.registerCommand('hiveku.completeTask', (node) => completeTask(node)),
    vscode.commands.registerCommand('hiveku.runWorkflow', (node) => runWorkflow(node)),
    vscode.commands.registerCommand('hiveku.toggleWorkflow', (node) => toggleWorkflow(node)),
    vscode.commands.registerCommand('hiveku.newTask', (node) => newTask(node)),
    vscode.commands.registerCommand('hiveku.console', (node) => openConsole(node)),
    vscode.commands.registerCommand('hiveku.setRootFolder', () => setRootFolder()),
    vscode.commands.registerCommand('hiveku.setRole', (node) => setRole(node)),
    vscode.commands.registerCommand('hiveku.whichAccount', () => whichAccount()),
    vscode.commands.registerCommand('hiveku.autoRefresh', async (node) => {
      const record = node?.record ?? (await accounts.pick('Keep data fresh for which account?'));
      if (record) await refresher.configure(record.accountId, record.label);
    }),
    vscode.commands.registerCommand('hiveku.installCadence', (node) => installCadence(node)),
    vscode.commands.registerCommand('hiveku.consoleShowAll', () => consoleTree.setShowAll(!consoleTree.showAll)),
    vscode.commands.registerCommand('hiveku.syncCommands', (node) => syncCommands(node)),
    vscode.commands.registerCommand('hiveku.openSiteEnv', (arg) => openSiteEnv(arg)),
    vscode.commands.registerCommand('hiveku.openSite', (node) => openSite(node)),
    vscode.commands.registerCommand('hiveku.showEnvLogs', (node) => showEnvLogsForNode(node)),
    vscode.commands.registerCommand('hiveku.envLogs', () => withScm((s) => envLogsForScm(s))),
    vscode.commands.registerCommand('hiveku.consoleOpen', (arg) => openConsoleFocused(arg)),
    vscode.commands.registerCommand('hiveku.openProjectEnv', (node) => openProjectEnv(node)),
    vscode.commands.registerCommand('hiveku.projectDatabase', (node) => openProjectDatabase(node)),
    vscode.commands.registerCommand('hiveku.refreshConsole', () => {
      invalidateEntitlements();
      consoleTree.refresh();
    }),
    vscode.commands.registerCommand('hiveku.consoleDownloadDept', (node) =>
      downloadData(node?.record ? { record: node.record } : undefined, node?.deptId),
    ),
    vscode.commands.registerCommand('hiveku.openWorkspace', (node) => openWorkspace(node)),
    vscode.commands.registerCommand('hiveku.refreshSetup', () => refreshSetup()),
    vscode.commands.registerCommand('hiveku.setupCodex', () => setupCodexSupport()),
    vscode.commands.registerCommand('hiveku.openDeptWindow', (node) => openDepartmentWindow(node)),
    vscode.commands.registerCommand('hiveku.attention', () => attention()),
    vscode.commands.registerCommand('hiveku.operate', (node) => openOperate(node)),
    vscode.commands.registerCommand('hiveku.projectPanel', () => withScm((s) => openProjectPanel(s))),
    vscode.workspace.onDidChangeWorkspaceFolders(() => loadWorkspaceScms()),
  );

  // hiveku: virtual documents (.env secrets, CMS entries, memory) — editor-native CRUD.
  registerHivekuFs(context, clientForAccount);
  // A saved CMS/memory doc should reflect in the open console tab behind it.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme !== 'hiveku') return;
      const seg = doc.uri.path.replace(/^\/+/, '').split('/');
      if (seg[0] === 'cms') refreshConsoleTab(seg[1], 'cms');
      else if (seg[0] === 'memory') refreshConsoleTab(seg[1], 'knowledge');
    }),
  );

  tree = new HivekuTreeProvider(accounts, clientForAccount);
  treeView = vscode.window.createTreeView('hiveku.projects', { treeDataProvider: tree });
  context.subscriptions.push(treeView);

  consoleTree = new AccountConsoleProvider(accounts, clientForAccount, (id) => getEntitlements(id));
  context.subscriptions.push(vscode.window.createTreeView('hiveku.console', { treeDataProvider: consoleTree }));

  refresher = new DataRefresher(context, accounts, clientForAccount, (id) => getEntitlements(id), () => consoleTree.refresh());

  connect = new ConnectFlow(accounts, appUrl, (newAccountIds) => {
    syncConnectedAs(); // new accounts carry connectedAs — refresh before their scaffold runs
    refreshStatusBar();
    updateSignedInContext();
    // A (re)connect can carry a new plan/key — never keep a stale entitlements
    // snapshot that could hide a now-enabled department (e.g. PPC after a bump).
    invalidateEntitlements();
    tree.refresh();
    consoleTree.refresh();
    void updateNotifications();
    void reconcileAccountFolders().catch(() => undefined);
    // Role prompt ONLY for accounts new in THIS exchange — re-connecting to add
    // one account must never re-interrogate the whole roster (existing accounts
    // get asked lazily by the department-session button, or via Set Role).
    void (async () => {
      for (const id of newAccountIds) {
        const rec = accounts.list().find((r) => r.accountId === id);
        if (rec && !accounts.getRole(id)) await pickRole(rec, 'How will you run this account here? (Esc to skip)');
      }
    })();
  });
  connect.register(context);
  registerFileHistory(context, resolveFileProject, clientForAccount);
  updateSignedInContext();

  await loadWorkspaceScms();
  warnIfMixedAccounts();
  await autoFocusWorkspaceAccount();
  await updateRootContext();
  // Re-home accounts whose stored folder predates (or disagrees with) the root.
  void reconcileAccountFolders().catch((err) => log.appendLine(`[folders] reconcile failed: ${errMsg(err)}`));
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('hiveku.rootFolder')) {
        void updateRootContext();
        tree.refresh();
        void updateNotifications();
        void reconcileAccountFolders().catch(() => undefined);
      }
      if (e.affectsConfiguration('hiveku.claudeCodePermissionMode')) {
        syncPermissionMode();
        void vscode.window
          .showInformationMessage(
            'Claude Code autonomy changed. Run "Hiveku: Refresh Setup" in your open Hiveku folders to apply it.',
            'Refresh Setup',
          )
          .then((c) => c === 'Refresh Setup' && vscode.commands.executeCommand('hiveku.refreshSetup'));
      }
      if (e.affectsConfiguration('hiveku.sandboxWorkspace')) {
        setSandboxWorkspace(vscode.workspace.getConfiguration('hiveku').get<boolean>('sandboxWorkspace', false));
        void vscode.window
          .showInformationMessage(
            'Workspace sandbox changed. Run "Hiveku: Refresh Setup" in your Hiveku folders to apply it.',
            'Refresh Setup',
          )
          .then((c) => c === 'Refresh Setup' && vscode.commands.executeCommand('hiveku.refreshSetup'));
      }
      if (e.affectsConfiguration('hiveku.codexSupport')) {
        setCodexSupport(vscode.workspace.getConfiguration('hiveku').get<boolean>('codexSupport', false));
      }
    }),
  );
  if (!hivekuRoot() && accounts.list().length > 0) {
    void vscode.window
      .showWarningMessage('Hiveku: set your root folder - all accounts and their content are stored under it.', 'Choose Root Folder')
      .then((c) => (c === 'Choose Root Folder' ? setRootFolder() : undefined));
  }
  refreshStatusBar();
  void updateNotifications();
  const notifTimer = setInterval(() => void updateNotifications(), 5 * 60 * 1000);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(notifTimer)));
  // Tasks freshness: Claude Code creates tasks/subtasks/comments mid-session, so
  // the tree can't be a fetch-once snapshot. A 60s tick + window-refocus both run
  // the CHEAP staleness check (repaint only when past TTL; refetch only for
  // expanded groups) — see HivekuTreeProvider.refreshTasks.
  const tasksTimer = setInterval(() => tree.refreshTasks(false), 60 * 1000);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(tasksTimer)));
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) tree.refreshTasks(false);
    }),
  );
  void refresher.tick();
  const refreshTimer = setInterval(() => void refresher.tick(), 30 * 60 * 1000);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(refreshTimer)));

  // First run: gently offer the guided setup (no accounts + never onboarded).
  if (accounts.list().length === 0 && !context.globalState.get('hiveku.onboarded')) {
    void (async () => {
      const choice = await vscode.window.showInformationMessage(
        'Welcome to Hiveku. Set up how you want to work — a single account or an agency with multiple clients?',
        'Quick setup',
        'Later',
      );
      if (choice === 'Quick setup') await runSetup();
      else await context.globalState.update('hiveku.onboarded', true);
    })();
  }
}

export function deactivate(): void {
  for (const s of scms.values()) s.dispose();
  scms.clear();
}

async function loadWorkspaceScms(): Promise<void> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const key = folder.uri.fsPath;
    if (scms.has(key)) continue;
    const scm = await HivekuScm.tryLoad(folder.uri, clientForAccount, log);
    if (scm) {
      scms.set(key, scm);
      scm.refresh().catch((e) => log.appendLine(`[refresh] ${String(e)}`));
    }
  }
  refreshStatusBar();
}

function refreshStatusBar(): void {
  const list = accounts.list();
  if (scms.size === 1) {
    const scm = [...scms.values()][0];
    statusBar.text = `$(cloud) Hiveku: ${scm.link.project_name} $(git-branch) ${scm.branch}`;
    statusBar.tooltip = `Account: ${scm.link.account_label}\nBranch: ${scm.branch}`;
    statusBar.show();
  } else if (list.length > 0) {
    statusBar.text = `$(cloud) Hiveku (${list.length} account${list.length === 1 ? '' : 's'})`;
    statusBar.tooltip = 'Hiveku — click to switch account';
    statusBar.show();
  } else {
    statusBar.hide();
  }
}

async function getActiveScm(): Promise<HivekuScm | undefined> {
  if (scms.size === 0) return undefined;
  if (scms.size === 1) return [...scms.values()][0];
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const folder = vscode.workspace.getWorkspaceFolder(active);
    if (folder && scms.has(folder.uri.fsPath)) return scms.get(folder.uri.fsPath);
  }
  const pick = await vscode.window.showQuickPick(
    [...scms.values()].map((s) => ({ label: s.link.project_name, scm: s })),
    { placeHolder: 'Which Hiveku project?' },
  );
  return pick?.scm;
}

async function withScm(fn: (scm: HivekuScm) => Promise<void>): Promise<void> {
  const scm = await getActiveScm();
  if (!scm) {
    vscode.window.showWarningMessage('No Hiveku project in this workspace. Run "Hiveku: Download Project…".');
    return;
  }
  try {
    await fn(scm);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.appendLine(`[error] ${msg}`);
    vscode.window.showErrorMessage(`Hiveku: ${msg}`);
  }
}

async function signIn(): Promise<void> {
  const key = await vscode.window.showInputBox({
    prompt: 'Paste your Hiveku MCP API key (from Settings → LLM Connectors)',
    password: true,
    ignoreFocusOut: true,
  });
  if (!key) return;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Validating Hiveku key…' },
    async () => {
      const record = await accounts.signIn(key, baseUrl());
      syncConnectedAs();
      vscode.window.showInformationMessage(`Connected Hiveku account: ${record.label}`);
    },
  );
  refreshStatusBar();
  updateSignedInContext();
  tree.refresh();
  consoleTree.refresh();
}

async function switchAccount(): Promise<void> {
  if (accounts.list().length === 0) {
    const choice = await vscode.window.showInformationMessage('No Hiveku accounts connected.', 'Sign In');
    if (choice === 'Sign In') await signIn();
    return;
  }
  const record = await accounts.pick('Switch active Hiveku account');
  if (record) vscode.window.showInformationMessage(`Active account: ${record.label}`);
}

/**
 * After scaffolding a downloaded project, a local-scoped `hiveku` server in
 * ~/.claude.json (higher precedence than the project `.mcp.json` we just wrote)
 * would silently send Claude Code to the wrong account. Detect that and offer to
 * repoint the local server at this project's account.
 */
async function warnIfClaudeShadowsProject(folderPath: string, account: AccountRecord, key: string): Promise<void> {
  let shadows = false;
  try {
    shadows = await hasLocalHivekuServer(folderPath);
  } catch {
    return;
  }
  if (!shadows) return;
  const choice = await vscode.window.showWarningMessage(
    `A local-scoped "hiveku" MCP server (in ~/.claude.json) overrides this project's .mcp.json, so Claude Code may talk to the wrong account. Point it at ${account.label}?`,
    'Use this account',
    'Ignore',
  );
  if (choice !== 'Use this account') return;
  try {
    await setLocalHivekuServer(folderPath, hivekuMcpServer(key, baseUrl()));
    vscode.window.showInformationMessage(`Claude Code in this folder now uses ${account.label}. Reload the window to apply.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/**
 * Point Claude Code (in this workspace) at a connected account. Writes the
 * `hiveku` MCP server at LOCAL scope in ~/.claude.json for the chosen folder —
 * local scope beats any project `.mcp.json`, so this reliably wins the account
 * race. Claude Code reads MCP config at startup, so the user must reload.
 */
async function setClaudeCodeAccount(): Promise<void> {
  if (accounts.list().length === 0) {
    const choice = await vscode.window.showInformationMessage('No Hiveku accounts connected.', 'Sign In');
    if (choice === 'Sign In') await signIn();
    return;
  }
  const account = await accounts.pick('Point Claude Code at which account?');
  if (!account) return;

  const key = await accounts.getKey(account.accountId);
  if (!key) {
    vscode.window.showErrorMessage(`No stored key for ${account.label}. Re-connect the account first.`);
    return;
  }

  // Which folder? Default to the workspace root; let the user choose if several.
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage('Open a folder first — Claude Code scopes its MCP servers per workspace folder.');
    return;
  }
  let folderPath = folders[0].uri.fsPath;
  if (folders.length > 1) {
    const pick = await vscode.window.showQuickPick(
      folders.map((f) => ({ label: f.name, description: f.uri.fsPath })),
      { placeHolder: 'Apply to which workspace folder?' },
    );
    if (!pick) return;
    folderPath = pick.description;
  }

  try {
    await setLocalHivekuServer(folderPath, hivekuMcpServer(key, baseUrl()));
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: could not update Claude Code config — ${errMsg(err)}`);
    return;
  }

  const reload = await vscode.window.showInformationMessage(
    `Claude Code in "${path.basename(folderPath)}" is now wired to ${account.label}. Reload the window to apply (Claude Code reads MCP config at startup).`,
    'Reload Window',
  );
  if (reload === 'Reload Window') await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

/** Remove an account — user picks: stop monitoring, archive, or delete locally. */
async function signOut(node?: { record: AccountRecord }): Promise<void> {
  const record = node?.record ?? (await accounts.pick('Remove which Hiveku account?'));
  if (!record) return;
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(debug-pause) Stop monitoring', detail: 'Disconnect + stop its local automations. Keeps downloaded files. Re-connect to resume.', value: 'stop' },
      { label: '$(archive) Archive', detail: 'Hide it but keep the connection, files, and automations. Restore anytime via "Hiveku: Restore Account".', value: 'archive' },
      { label: '$(trash) Delete locally', detail: "Stop monitoring AND delete this account's local folder (downloaded projects + hiveku-data). Hiveku keeps the source of truth.", value: 'delete' },
    ],
    { placeHolder: `"${record.label}" — what should happen?`, ignoreFocusOut: true },
  );
  if (!choice) return;

  if (choice.value === 'archive') {
    await accounts.archive(record.accountId);
    accountSnapshots.delete(record.accountId);
    vscode.window.showInformationMessage(`Archived ${record.label}. Restore via "Hiveku: Restore Account".`);
    refreshStatusBar();
    updateSignedInContext();
    tree.refresh();
    consoleTree.refresh();
    return;
  }

  // stop / delete: tear down this account's local automations first so nothing keeps pinging it.
  const folder = accounts.getFolder(record.accountId);
  await teardownAccountAutomations(folder);

  if (choice.value === 'delete' && folder) {
    const ok = await vscode.window.showWarningMessage(
      `Permanently delete the LOCAL folder for "${record.label}"?\n${folder}\n\nHiveku still has the projects + data — this only removes your local copy.`,
      { modal: true },
      'Delete',
    );
    if (ok !== 'Delete') return;
    await fs.rm(folder, { recursive: true, force: true }).catch((e) => log.appendLine(`[remove] rm ${folder}: ${String(e)}`));
  }

  // Best-effort: revoke the key server-side so removal is a true teardown (must
  // read the key BEFORE we forget it). Falls back to a manual-revoke note.
  const revoked = await revokeAccountKey(record);

  await accounts.signOut(record.accountId);
  syncConnectedAs();
  accountSnapshots.delete(record.accountId);
  const verb = choice.value === 'delete' ? 'Deleted' : 'Stopped monitoring';
  vscode.window.showInformationMessage(
    revoked
      ? `${verb} ${record.label} — and revoked its Hiveku key server-side. Re-connect to mint a fresh one.`
      : `${verb} ${record.label}. Could not auto-revoke the key — revoke it in Hiveku → Settings → LLM Connectors to fully disable it.`,
  );
  refreshStatusBar();
  updateSignedInContext();
  tree.refresh();
  consoleTree.refresh();
}

/** Stop any local automations scaffolded in an account's folder (removes the OS scheduler entry). */
async function teardownAccountAutomations(folder: string | undefined): Promise<void> {
  if (!folder) return;
  const autoDir = path.join(folder, 'automations');
  const manage = path.join(autoDir, 'manage.mjs');
  try {
    await fs.access(manage);
  } catch {
    return; // no automations here
  }
  try {
    cp.execFileSync(process.execPath, [manage, 'uninstall'], { cwd: autoDir, stdio: 'ignore', timeout: 15000 });
    log.appendLine(`[remove] stopped local automations in ${autoDir}`);
  } catch (e) {
    log.appendLine(`[remove] automation teardown failed: ${String(e)}`);
  }
}

/**
 * Best-effort server-side revoke of an account's MCP key, so "Stop monitoring" /
 * "Delete" is a true teardown (the key can't be used again). Authenticates with
 * the key itself against the builder's self-revoke route. Tolerant: a missing
 * route / offline / older builder just returns false and we tell the user to
 * revoke manually.
 */
async function revokeAccountKey(record: AccountRecord): Promise<boolean> {
  try {
    const key = await accounts.getKey(record.accountId);
    if (!key) return false;
    const url = `${appUrl().replace(/\/+$/, '')}/api/account/mcp-keys/revoke-self`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return false;
    const body = (await res.json().catch(() => ({}))) as { revoked?: boolean };
    return body.revoked === true;
  } catch (e) {
    log.appendLine(`[remove] key revoke failed: ${String(e)}`);
    return false;
  }
}

/** Restore an archived account back into the active sidebar. */
async function restoreAccount(): Promise<void> {
  const archived = accounts.listArchived();
  if (archived.length === 0) {
    vscode.window.showInformationMessage('No archived accounts.');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    archived.map((r) => ({ label: r.label, description: r.accountId, id: r.accountId })),
    { placeHolder: 'Restore which archived account?' },
  );
  if (!pick) return;
  await accounts.restore(pick.id);
  vscode.window.showInformationMessage(`Restored ${pick.label}.`);
  refreshStatusBar();
  updateSignedInContext();
  tree.refresh();
  consoleTree.refresh();
}

async function cloneProject(): Promise<void> {
  let account = await accounts.pick('Download from which account?');
  if (!account) {
    const choice = await vscode.window.showInformationMessage(
      'Connect a Hiveku account first.',
      'Sign In',
    );
    if (choice !== 'Sign In') return;
    await signIn();
    account = await accounts.pick('Download from which account?');
    if (!account) return;
  }

  const client = await clientForAccount(account.accountId);
  const sites = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Loading Hiveku site projects…' },
    () => api.sitesList(client),
  );
  const projects = sites.filter((p) => p.project_type !== 'external'); // external sites have no code here
  if (projects.length === 0) {
    vscode.window.showInformationMessage('No downloadable site projects on this account.');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    projects.map((p) => ({
      label: p.name || p.slug || p.id,
      description: [p.project_type, p.custom_domain || p.subdomain].filter(Boolean).join(' · '),
      detail: p.id,
      project: p,
    })),
    { placeHolder: 'Select a site project to download', matchOnDetail: true },
  );
  if (!picked) return;

  await downloadProject(account, picked.project);
}

/** Download a project chosen from the sidebar tree (account + project known). */
async function cloneProjectItem(
  node: { record: AccountRecord; project: api.ProjectSummary } | undefined,
): Promise<void> {
  if (!node?.record || !node.project) return;
  try {
    await downloadProject(node.record, node.project);
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Filter the sidebar account list (SaaS owners can have hundreds). */
async function filterAccounts(): Promise<void> {
  const v = await vscode.window.showInputBox({
    prompt: 'Filter accounts by name or ID',
    value: tree.accountFilterValue,
    placeHolder: 'Type to filter the account list…',
  });
  if (v === undefined) return;
  tree.setAccountFilter(v);
}

/** Configured Hiveku root folder (parent for all account/project folders), if set. */
function workspaceRoot(): string | undefined {
  const v = vscode.workspace.getConfiguration('hiveku').get<string>('workspaceRoot', '');
  return v && v.trim() ? v.trim() : undefined;
}

/** Open the account-wide media library gallery (searchable; copy URL to clipboard). */
async function mediaGallery(node: { record: AccountRecord } | undefined): Promise<void> {
  const account = node?.record ?? (await accounts.pick('Media library for which account?'));
  if (!account) return;
  openMediaGallery(account, clientForAccount);
}

/** Guided first-time setup: single vs multi-account + where to keep folders. */
async function runSetup(): Promise<void> {
  const mode = await vscode.window.showQuickPick(
    [
      { label: '$(account) Just my own account', detail: 'One Hiveku account — one folder, one workspace.', value: 'single' },
      {
        label: '$(organization) Multiple accounts (agency)',
        detail: 'Manage several client accounts. Each gets its own folder + window, with Claude scoped per client.',
        value: 'multi',
      },
    ],
    { placeHolder: 'How do you use Hiveku?', ignoreFocusOut: true },
  );
  if (!mode) return;

  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Use as Hiveku root',
    title: 'Choose a folder where Hiveku keeps your accounts + projects (each account gets a subfolder)',
  });
  if (picked && picked.length) {
    await vscode.workspace
      .getConfiguration('hiveku')
      .update('workspaceRoot', picked[0].fsPath, vscode.ConfigurationTarget.Global);
  }
  if (extensionContext) await extensionContext.globalState.update('hiveku.onboarded', true);

  const next = await vscode.window.showInformationMessage(
    mode.value === 'multi'
      ? 'Set up for an agency. Connect Hiveku and pick every client account you manage — each becomes a sidebar row; open any as its own window for a Claude scoped to that client.'
      : 'Set up for your account. Connect Hiveku to bring it in, then download a project or open the account as a workspace.',
    'Connect Hiveku',
    'Sign in with a key',
  );
  if (next === 'Connect Hiveku') await connect.start();
  else if (next === 'Sign in with a key') await signIn();
}

/** The ONE Hiveku root folder — every account's content lives under it. */
function hivekuRoot(): string | undefined {
  const v = vscode.workspace.getConfiguration('hiveku').get<string>('rootFolder');
  return v && v.trim() ? v.trim() : undefined;
}

async function updateRootContext(): Promise<void> {
  await vscode.commands.executeCommand('setContext', 'hiveku.rootSet', !!hivekuRoot());
}

/** Pick + persist the Hiveku root folder (one-time setup; changeable in Settings). */
async function setRootFolder(): Promise<string | undefined> {
  const pick = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Use as Hiveku root',
    title: 'Choose the Hiveku root folder - all accounts and their content are stored under it',
  });
  if (!pick || pick.length === 0) return undefined;
  let root = pick[0].fsPath;
  // Account folders land DIRECTLY under the root (one per client). Picking a
  // general location like the home folder would scatter them - offer a wrapper.
  const choice = await vscode.window.showQuickPick(
    [
      { label: `Create "Hiveku-Accounts" folder inside ${path.basename(root) || root} (recommended)`, detail: path.join(root, 'Hiveku-Accounts'), wrap: true },
      { label: 'Use this folder as-is', detail: `${root} - account folders are created directly here`, wrap: false },
    ],
    { placeHolder: 'Where should the account folders live?', ignoreFocusOut: true },
  );
  if (!choice) return undefined;
  if (choice.wrap) {
    root = path.join(root, 'Hiveku-Accounts');
    await fs.mkdir(root, { recursive: true });
  }
  await vscode.workspace.getConfiguration('hiveku').update('rootFolder', root, vscode.ConfigurationTarget.Global);
  await updateRootContext();
  tree.refresh();
  void updateNotifications();
  vscode.window.showInformationMessage(`Hiveku root set: ${root}. Each account gets its own folder there - no more per-download prompts.`);
  return root;
}

/**
 * The account's folder under the Hiveku root - created automatically, never
 * prompted per-download. Layout inside: sites/ (downloaded projects),
 * hiveku-data/<dept>/ (operational data), memory|skills|rules/ (knowledge),
 * automations/, briefs/, reports/.
 */
async function ensureAccountFolder(account: AccountRecord): Promise<string | undefined> {
  const existing = accounts.getFolder(account.accountId);
  let root = hivekuRoot();
  if (!root) {
    // No root configured yet — reuse the stored folder if it's real, else force setup.
    if (existing) {
      try {
        await fs.access(existing);
        return existing;
      } catch {
        /* folder was removed - recreate under the root below */
      }
    }
    const choice = await vscode.window.showInformationMessage(
      'Set your Hiveku root folder first - all accounts and their content are stored under it (one-time setup).',
      { modal: true },
      'Choose Root Folder',
    );
    if (choice !== 'Choose Root Folder') return undefined;
    root = await setRootFolder();
    if (!root) return undefined;
  }
  // The root is authoritative: a stored folder from before the root model (or
  // from an old root) must not keep winning — that scattered accounts across
  // whatever workspace the extension happened to run in. Migrate it home.
  const dir = path.join(root, slugForAccount(account.label, account.accountId));
  if (existing && existing !== dir) {
    const existsOnDisk = await fs.access(existing).then(() => true, () => false);
    if (existsOnDisk && !(await migrateAccountFolder(account, existing, dir))) {
      return existing; // couldn't move safely — stay consistent at the old path
    }
  }
  await fs.mkdir(dir, { recursive: true });
  await accounts.setFolder(account.accountId, dir);
  return dir;
}

/**
 * Move a legacy/out-of-root account folder to its canonical home under the
 * Hiveku root. Returns true when the canonical path should now be used.
 */
export async function migrateAccountFolder(account: AccountRecord, from: string, to: string): Promise<boolean> {
  // Never yank a folder out from under an open window.
  const openHere = (vscode.workspace.workspaceFolders ?? []).some(
    (f) => f.uri.fsPath === from || f.uri.fsPath.startsWith(from + path.sep),
  );
  if (openHere) {
    void vscode.window.showWarningMessage(
      `${account.label}'s folder lives outside your Hiveku root and is open in this window. ` +
        `Close this folder, then run any download — it will move to ${to}.`,
    );
    return false;
  }
  const toExists = await fs.access(to).then(() => true, () => false);
  if (toExists) {
    // Both exist — adopt the canonical one, never auto-merge user content.
    void vscode.window.showWarningMessage(
      `${account.label}: now using ${to}. Older content is still at ${from} — merge what you need manually.`,
    );
    return true;
  }
  try {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    if (log) log.appendLine(`[folders] migrated ${account.label}: ${from} -> ${to}`);
    void vscode.window.showInformationMessage(`Moved ${account.label}'s account folder into your Hiveku root: ${to}`);
    return true;
  } catch (err) {
    void vscode.window.showWarningMessage(
      `${account.label}: couldn't move ${from} into the Hiveku root (${errMsg(err)}) — still using the old location.`,
    );
    return false;
  }
}

/**
 * Activation sweep: re-home every account whose stored folder disagrees with
 * the configured root. Fixes surfaces that read the stored mapping directly
 * (data download, env pull, open-workspace) without waiting for a download.
 */
async function reconcileAccountFolders(): Promise<void> {
  const root = hivekuRoot();
  if (!root) return;
  for (const account of accounts.list()) {
    const stored = accounts.getFolder(account.accountId);
    if (!stored) continue;
    const canonical = path.join(root, slugForAccount(account.label, account.accountId));
    if (stored === canonical) continue;
    const existsOnDisk = await fs.access(stored).then(() => true, () => false);
    if (existsOnDisk) {
      if (await migrateAccountFolder(account, stored, canonical)) {
        await accounts.setFolder(account.accountId, canonical);
      }
    } else {
      // Stale mapping to a deleted folder — forget it; next use recreates under the root.
      await accounts.setFolder(account.accountId, canonical);
      await fs.mkdir(canonical, { recursive: true }).catch(() => undefined);
    }
  }
}

async function offerOpenFolder(dir: string, note: string): Promise<void> {
  const open = await vscode.window.showInformationMessage(note, 'Open Folder');
  if (open === 'Open Folder') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), true);
  }
}

/** Download one knowledge type for a department. */
async function downloadType(node: {
  record: AccountRecord;
  department: string;
  type: string;
}): Promise<void> {
  if (!node?.record) return;
  try {
    const dir = await ensureAccountFolder(node.record);
    if (!dir) return;
    const index = await tree.indexFor(node.record.accountId);
    const entries = selectEntries(index, { department: node.department, type: node.type });
    const n = await writeEntries(dir, entries);
    vscode.window.showInformationMessage(
      `Downloaded ${n} ${TYPE_LABEL[node.type] ?? node.type} file(s) for ${departmentLabel(node.department)}.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/** Download all knowledge for a department. */
async function downloadDepartment(node: { record: AccountRecord; department: string }): Promise<void> {
  if (!node?.record) return;
  try {
    const dir = await ensureAccountFolder(node.record);
    if (!dir) return;
    const index = await tree.indexFor(node.record.accountId);
    const entries = selectEntries(index, { department: node.department });
    if (entries.length === 0) {
      vscode.window.showInformationMessage(
        `No downloaded knowledge for ${departmentLabel(node.department)} yet — chat to build it.`,
      );
      return;
    }
    const n = await writeEntries(dir, entries);
    await offerOpenFolder(dir, `Downloaded ${n} ${departmentLabel(node.department)} file(s).`);
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/** Download the full account: scaffold (.mcp.json/CLAUDE.md/.env) + all knowledge. */
async function downloadEverything(node: { record: AccountRecord }): Promise<void> {
  if (!node?.record) return;
  try {
    const dir = await ensureAccountFolder(node.record);
    if (!dir) return;
    let count = 0;
    let siteCount = 0;
    let deptCount = 0;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Downloading ${node.record.label}…` },
      async (progress) => {
        progress.report({ message: 'scaffold' });
        const key = await accounts.getKey(node.record.accountId);
        if (key) {
          await writeScaffold({
            baseDir: dir,
            accountLabel: node.record.label,
            apiKey: key,
            baseUrl: baseUrl(),
            role: accounts.getRole(node.record.accountId),
            accountId: node.record.accountId,
          });
        }
        progress.report({ message: 'knowledge' });
        const index = await tree.indexFor(node.record.accountId);
        count = await writeEntries(dir, selectEntries(index));
        progress.report({ message: 'account commands' });
        const sync = await syncAccountCommands(index, dir);
        if (sync.skippedLocalEdits.length) {
          log.appendLine(`[commands] skipped locally-edited synced files: ${sync.skippedLocalEdits.join(', ')}`);
        }

        // "Everything" means everything: all site projects + department data too
        // (this is the one-button account bootstrap).
        const client = await clientForAccount(node.record.accountId);
        const sites = (await api.sitesList(client).catch(() => [] as api.SiteSummary[])).filter(
          (p) => p.project_type !== 'external',
        );
        for (const p of sites) {
          const label = p.name || p.slug || p.id;
          try {
            await downloadProjectCore(node.record, p, dir, (m) => progress.report({ message: `${label}: ${m}` }));
            siteCount++;
          } catch (err) {
            log.appendLine(`[everything] site ${label}: ${errMsg(err)}`);
          }
        }

        progress.report({ message: 'department data' });
        const ent = await getEntitlements(node.record.accountId).catch(() => undefined);
        const { primary, other } = effectiveDepartments(
          accounts.getRole(node.record.accountId),
          accounts.getDepartments(node.record.accountId),
          ent?.page_access,
        );
        const depts = primary.length ? primary : other;
        const results = await exportDepartments(client, depts, dir, node.record.label, (m) =>
          progress.report({ message: m }),
        ).catch(() => []);
        deptCount = results.length;
        await ensureDataGitignored(dir).catch(() => undefined);
      },
    );
    await offerOpenFolder(
      dir,
      `Downloaded ${node.record.label}: scaffold + ${count} knowledge file(s) + ${siteCount} site project(s) + data for ${deptCount} department(s).`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/** Open a chat panel with a department agent. Falls back to pickers when
 * invoked without a node (palette / account context menu) — the Brand Knowledge
 * tree that used to carry the department nodes was removed 2026-07-11. */
async function chatDepartment(node: { record?: AccountRecord; department?: string } | undefined): Promise<void> {
  const record = node?.record ?? (await accounts.pick('Chat with a department in which account?'));
  if (!record) return;
  let department = node?.department;
  if (!department) {
    const pick = await vscode.window.showQuickPick(
      DEPARTMENTS.map((d) => ({ label: d.label, id: d.id })),
      { placeHolder: 'Which department agent?' },
    );
    if (!pick) return;
    department = pick.id;
  }
  openDepartmentChat(record, department, clientForAccount);
}

async function completeTask(node: { record: AccountRecord; task: api.PmTask }): Promise<void> {
  if (!node?.record || !node.task?.id) return;
  try {
    const client = await clientForAccount(node.record.accountId);
    await api.pmTaskComplete(client, node.task.id);
    vscode.window.showInformationMessage(`Completed: ${node.task.title || node.task.name || 'task'}`);
    tree.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

async function runWorkflow(node: { record: AccountRecord; workflow: api.Workflow }): Promise<void> {
  if (!node?.record || !node.workflow?.id) return;
  try {
    const client = await clientForAccount(node.record.accountId);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Running ${node.workflow.name ?? 'workflow'}…` },
      () => api.workflowRun(client, node.workflow.id),
    );
    vscode.window.showInformationMessage(`Ran workflow: ${node.workflow.name ?? node.workflow.id}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

async function toggleWorkflow(node: { record: AccountRecord; workflow: api.Workflow }): Promise<void> {
  if (!node?.record || !node.workflow?.id) return;
  try {
    const client = await clientForAccount(node.record.accountId);
    const next = !api.isWorkflowEnabled(node.workflow);
    await api.workflowSetEnabled(client, node.workflow.id, next);
    vscode.window.showInformationMessage(`${next ? 'Enabled' : 'Disabled'}: ${node.workflow.name ?? node.workflow.id}`);
    tree.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/** Open the project-scoped panel (deploys, DB, CMS, pages, crons, domains, …) for the active project. */
async function openProjectPanel(scm: HivekuScm): Promise<void> {
  const account: AccountRecord = { accountId: scm.link.account_id, label: scm.link.account_label };
  openModulePanel(
    account,
    PROJECT_MODULE,
    clientForAccount,
    appUrl,
    { project_id: scm.link.project_id },
    scm.link.project_id,
  );
}

/**
 * Per-account entitlements cache (plan ∩ release-tier page-access map).
 * null = the access tool is unavailable (older server) → show everything.
 */
const entitlementsCache = new Map<string, { val: api.AccountEntitlements | null; at: number }>();
// Entitlements change when a plan is upgraded/downgraded — a permanent cache
// meant an enabled-but-cached-off department (e.g. PPC after a plan bump) stayed
// hidden for the whole window session. Refetch after this TTL so it self-heals.
const ENTITLEMENTS_TTL_MS = 5 * 60 * 1000;

/** Drop cached entitlements (all, or one account) so the next read refetches. */
function invalidateEntitlements(accountId?: string): void {
  if (accountId) entitlementsCache.delete(accountId);
  else entitlementsCache.clear();
}

/** Fetch + cache the account's entitlements. null on any failure → callers show all. */
async function getEntitlements(accountId: string, force = false): Promise<api.AccountEntitlements | null> {
  const hit = entitlementsCache.get(accountId);
  if (!force && hit && Date.now() - hit.at < ENTITLEMENTS_TTL_MS) return hit.val;
  let ent: api.AccountEntitlements | undefined;
  try {
    ent = await api.accountEntitlements(await clientForAccount(accountId));
  } catch {
    ent = undefined;
  }
  // A transient fetch failure must NOT overwrite a good cached value with null
  // (that would suddenly show-all, then re-hide on the next success). Keep the
  // last good entitlements until a real refetch succeeds; only cache null if we
  // never had a value.
  if (ent) {
    entitlementsCache.set(accountId, { val: ent, at: Date.now() });
    return ent;
  }
  if (hit) return hit.val; // keep last-known-good
  entitlementsCache.set(accountId, { val: null, at: Date.now() });
  return null;
}

/** Operate any account area (CRM, Marketing, Finance, Helpdesk, …) — gated + grouped by plan. */
async function openOperate(node: { record: AccountRecord } | undefined): Promise<void> {
  const account = node?.record ?? (await accounts.pick('Operate which account?'));
  if (!account) return;
  const ent = await getEntitlements(account.accountId);
  const pageAccess = ent?.page_access;

  // A module shows only if its own gate is entitled AND at least one of its
  // sections is entitled (so a module whose every section is plan-locked — e.g.
  // Collaboration with both discussions+hiveboards off — doesn't appear empty).
  const visible = MODULES.filter(
    (m) => isEntitled(pageAccess, moduleGroupGate(m).gate) && m.sections.some((s) => isEntitled(pageAccess, s.gate)),
  );
  const groups = new Map<string, typeof MODULES>();
  for (const m of visible) {
    const g = moduleGroupGate(m).group;
    const list = groups.get(g) ?? [];
    list.push(m);
    groups.set(g, list);
  }
  const items: Array<vscode.QuickPickItem & { id?: string }> = [];
  for (const [group, mods] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    items.push({ label: group, kind: vscode.QuickPickItemKind.Separator });
    for (const m of mods.sort((a, b) => a.label.localeCompare(b.label))) {
      items.push({ label: m.label, description: group, id: m.id });
    }
  }
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: ent ? `Open which area?  (plan: ${ent.plan})` : 'Open which area?',
    matchOnDescription: true,
  });
  if (!pick || !pick.id) return;
  const mod = MODULES.find((m) => m.id === pick.id);
  if (mod) openModulePanel(account, mod, clientForAccount, appUrl, {}, undefined, pageAccess);
}

/**
 * The open workspace folder that BELONGS to the given account, if any: its
 * .mcp.json hiveku key matches the account's stored key, or its
 * .hiveku/project.json links a project of this account. Used so per-account
 * data only ever lands in that account's own workspace.
 */
async function workspaceFolderForAccount(accountId: string): Promise<string | undefined> {
  const key = await accounts.getKey(accountId);
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = folder.uri.fsPath;
    if (key) {
      try {
        const mcp = JSON.parse(await fs.readFile(path.join(root, '.mcp.json'), 'utf8')) as {
          mcpServers?: { hiveku?: { headers?: { Authorization?: string } } };
        };
        const auth = mcp.mcpServers?.hiveku?.headers?.Authorization?.replace(/^Bearer\s+/i, '').trim();
        if (auth && auth === key) return root;
      } catch {
        /* no .mcp.json here */
      }
    }
    const scm = scms.get(root);
    if (scm && scm.link.account_id === accountId) return root;
  }
  return undefined;
}

/**
 * Download a department's operational data (SEO rankings/backlinks, CRM, ads, …)
 * to `hiveku-data/<dept>/*.json` in the account's own folder, so Claude Code can
 * analyze it locally like project code. Gated to the account's entitled departments.
 */
async function downloadData(node: { record: AccountRecord } | undefined, only?: string): Promise<void> {
  const account = node?.record ?? (await accounts.pick('Download data from which account?'));
  if (!account) return;

  // Write into THIS account's own folder — never into an unrelated open
  // workspace (an agency runs many clients; dumping CTCA's data into whatever
  // window happens to be open mixes tenants). Order:
  //   1. the account's configured folder;
  //   2. an open workspace folder that BELONGS to this account (its .mcp.json
  //      or .hiveku wiring carries this account's key/id);
  //   3. otherwise create the dedicated account folder (parent pick).
  let baseDir: string | undefined;
  const accountFolder = accounts.getFolder(account.accountId);
  if (accountFolder) {
    try {
      await fs.access(accountFolder);
      baseDir = accountFolder;
    } catch {
      /* configured folder gone — fall through */
    }
  }
  if (!baseDir) {
    // ALWAYS the account's own folder under the Hiveku root — never an open
    // workspace (a project checkout carries the same key; data landing inside
    // sites/<project>/ was exactly the scattering the root model exists to end).
    baseDir = await ensureAccountFolder(account);
    if (!baseDir) return;
  }

  // Only departments the account's plan/role entitles.
  const ent = await getEntitlements(account.accountId);
  const available = DEPARTMENTS.filter((d) => isEntitled(ent?.page_access, d.gate));
  if (available.length === 0) {
    vscode.window.showInformationMessage(`No data departments are enabled on ${account.label}'s plan.`);
    return;
  }
  let chosen: typeof available;
  if (only) {
    chosen = available.filter((d) => d.id === only);
    if (chosen.length === 0) {
      vscode.window.showInformationMessage(`That department isn't available on ${account.label}'s plan.`);
      return;
    }
  } else {
    const picks = await vscode.window.showQuickPick(
      available.map((d) => ({ label: d.label, id: d.id, picked: true })),
      { canPickMany: true, placeHolder: `Download which departments for ${account.label}? (all selected)` },
    );
    if (!picks || picks.length === 0) return;
    chosen = available.filter((d) => picks.some((p) => p.id === d.id));
  }

  try {
    const client = await clientForAccount(account.accountId);
    const results = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Downloading ${account.label} data…` },
      (progress) =>
        exportDepartments(client, chosen, baseDir, account.label, (m) => progress.report({ message: m })),
    );
    await ensureDataGitignored(baseDir);
    const total = results.reduce((n, d) => n + d.datasets.reduce((m, x) => m + x.count, 0), 0);
    const open = await vscode.window.showInformationMessage(
      `Saved ${total} rows across ${results.length} departments to ${DATA_DIR}/. Claude Code can now analyze it locally.`,
      'Open index',
    );
    if (open === 'Open index') {
      const doc = await vscode.workspace.openTextDocument(path.join(baseDir, DATA_DIR, 'README.md'));
      await vscode.window.showTextDocument(doc);
    }
    tree.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/**
 * Scaffold a free, persistent, CRUD-able local-automation framework into the
 * workspace (one launchd/cron entry → dispatcher → registry of workers). Claude
 * Code CRUDs automations via `automations/manage.mjs`.
 */
async function newAutomation(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showErrorMessage('Open a folder first — the automation framework is written into the workspace.');
    return;
  }
  let baseDir = folders[0].uri.fsPath;
  if (folders.length > 1) {
    const fp = await vscode.window.showQuickPick(
      folders.map((f) => ({ label: f.name, description: f.uri.fsPath })),
      { placeHolder: 'Scaffold automations/ into which folder?' },
    );
    if (!fp) return;
    baseDir = fp.description;
  }
  try {
    const written = await scaffoldLocalAutomations(baseDir);
    await appendGitignoreLines(baseDir, ['automations/.env', 'automations/state/', 'automations/logs/']);
    const next = await vscode.window.showInformationMessage(
      `Local automations ready (${written.length} files in automations/). Next: fill automations/.env, then run "node automations/manage.mjs install" — or just ask Claude Code to set up an automation.`,
      'Open README',
      'Open .env',
    );
    if (next === 'Open README') {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(baseDir, 'automations', 'README.md')));
    } else if (next === 'Open .env') {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(baseDir, 'automations', '.env')));
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/** Append patterns to .gitignore without clobbering existing rules. */
async function appendGitignoreLines(baseDir: string, patterns: string[]): Promise<void> {
  const gi = path.join(baseDir, '.gitignore');
  try {
    let text = '';
    try {
      text = await fs.readFile(gi, 'utf8');
    } catch {
      /* none */
    }
    const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
    const missing = patterns.filter((p) => !have.has(p));
    if (missing.length === 0) return;
    const prefix = text && !text.endsWith('\n') ? '\n' : '';
    await fs.writeFile(gi, `${text}${prefix}${missing.join('\n')}\n`, 'utf8');
  } catch {
    /* best-effort */
  }
}

/** Keep the derived data snapshot out of git (it's a local cache of account data). */
async function ensureDataGitignored(baseDir: string): Promise<void> {
  const gi = path.join(baseDir, '.gitignore');
  try {
    let text = '';
    try {
      text = await fs.readFile(gi, 'utf8');
    } catch {
      /* none yet */
    }
    if (text.split(/\r?\n/).some((l) => l.trim() === `${DATA_DIR}/` || l.trim() === DATA_DIR)) return;
    const prefix = text && !text.endsWith('\n') ? '\n' : '';
    await fs.writeFile(gi, `${text}${prefix}${DATA_DIR}/\n`, 'utf8');
  } catch {
    /* best-effort */
  }
}

/**
 * Pull a project's database into a runnable local Supabase scaffold (supabase/)
 * — schema, RLS, edge functions, types — so it can run offline via `supabase start`.
 */
async function localSupabaseForScm(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const name = scm.link.project_name || 'project';
  const slug = sanitize(name).toLowerCase() || 'project';
  try {
    const res = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Setting up local Supabase…' },
      (progress) => setupLocalSupabase(client, scm.link.project_id, name, slug, scm.root, (m) => progress.report({ message: m })),
    );
    if (!res.hasDb) {
      vscode.window.showInformationMessage('This project has no database to mirror locally.');
      return;
    }
    if (res.warnings.length) log.appendLine(`[local-supabase] ${res.warnings.length} warning(s):\n${res.warnings.join('\n')}`);
    const open = await vscode.window.showInformationMessage(
      `Local Supabase ready — ${res.written.length} files in supabase/. Run "supabase start" then "supabase db reset".`,
      'Open README',
    );
    if (open === 'Open README') {
      const doc = await vscode.workspace.openTextDocument(path.join(scm.root, 'supabase', 'README.md'));
      await vscode.window.showTextDocument(doc);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/**
 * Copy a ready-to-paste Claude Code prompt that drives an integration setup
 * (Google Ads, GSC, GBP, Microsoft/Bing Ads, Bing Webmaster) for this account.
 */
async function copySetupPrompt(node: { record: AccountRecord } | undefined): Promise<void> {
  const account = node?.record ?? (await accounts.pick('Connect an integration for which account?'));
  if (!account) return;
  const pick = await vscode.window.showQuickPick(
    SETUP_PROMPTS.map((p) => ({ label: p.label, description: p.blurb, id: p.id })),
    { placeHolder: 'Copy a Claude Code setup prompt for…' },
  );
  if (!pick) return;
  const sp = setupPromptById(pick.id);
  if (!sp) return;
  await vscode.env.clipboard.writeText(sp.build(account));
  vscode.window.showInformationMessage(`Copied the ${sp.label} setup prompt — paste it into Claude Code.`);
}

/** Open the Helpdesk panel (tickets: reply / status / priority / hand to Claude). */
async function openHelpdesk(node: { record: AccountRecord } | undefined): Promise<void> {
  const account = node?.record ?? (await accounts.pick('Helpdesk for which account?'));
  if (!account) return;
  const mod = moduleById('helpdesk');
  if (!mod) return;
  const ent = await getEntitlements(account.accountId);
  openModulePanel(account, mod, clientForAccount, appUrl, {}, undefined, ent?.page_access);
}

/** Open a task's detail (from a sidebar task click). */
function openTask(node: { record: AccountRecord; task: api.PmTask } | undefined): void {
  if (!node?.record || !node.task) return;
  openTaskDetail(node.record, node.task, clientForAccount, appUrl);
}

/** The project's secrets as an editable virtual .env (save pushes to Hiveku). */
async function openProjectEnv(node: { record: AccountRecord; project: api.SiteSummary } | undefined): Promise<void> {
  if (!node?.record || !node.project?.id) return;
  try {
    const doc = await vscode.workspace.openTextDocument(
      envUri(node.record.accountId, node.project.id, node.project.name || node.project.slug || 'project'),
    );
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/** The Database tree node → the Project Database panel. Every state is
 * friendly: no database yet renders a skeleton browser with provision +
 * AI-setup instructions instead of an error toast. */
function openProjectDatabase(node: { record: AccountRecord; project: api.SiteSummary } | undefined): void {
  if (!node?.record || !node.project?.id) return;
  openDatabasePanel(node.record, node.project, clientForAccount);
}

/** Open the Account Console (Tasks board + CRM + Automations) for an account. */
async function openConsole(node: { record: AccountRecord } | undefined): Promise<void> {
  const account = node?.record ?? (await accounts.pick('Open the console for which account?'));
  if (account)
    openAccountConsole(account, clientForAccount, appUrl, undefined, {
      role: accounts.getRole(account.accountId),
      departments: accounts.getDepartments(account.accountId),
    });
}

/** Open the console focused on a specific department/dataset (from the sidebar tree). */
function openConsoleFocused(arg: { record: AccountRecord; tab: string; focus?: string } | undefined): void {
  if (!arg?.record) return;
  openAccountConsole(arg.record, clientForAccount, appUrl, { tab: arg.tab, focus: arg.focus }, {
    role: accounts.getRole(arg.record.accountId),
    departments: accounts.getDepartments(arg.record.accountId),
  });
}

/**
 * Install the agency cadence: scheduled daily brief (weekday 8am), weekly pass
 * (Mon 9am), monthly report (1st) — free local cron running `claude -p` in the
 * account folder, briefs filed under briefs/. Each run uses Claude usage.
 */
async function installCadence(node: { record: AccountRecord } | undefined): Promise<void> {
  const record = node?.record ?? (await accounts.pick('Install the agency cadence for which account?'));
  if (!record) return;
  const folder = accounts.getFolder(record.accountId);
  if (!folder) {
    vscode.window.showInformationMessage('No local folder for this account yet - run "Hiveku: Download Everything" first.');
    return;
  }
  const ok = await vscode.window.showInformationMessage(
    `Install the agency cadence for ${record.label}? Daily brief (weekdays 8am), weekly pass (Mon 9am), monthly report (1st) - runs claude -p locally, files results in briefs/. Each run uses Claude usage.`,
    { modal: true },
    'Install',
  );
  if (ok !== 'Install') return;
  try {
    const jobs = await installAgencyCadence(folder);
    const autoDir = path.join(folder, 'automations');
    cp.execFileSync(process.execPath, [path.join(autoDir, 'manage.mjs'), 'install'], { cwd: autoDir, stdio: 'ignore', timeout: 20000 });
    vscode.window.showInformationMessage(
      `Agency cadence installed for ${record.label}: ${jobs.join(', ')}. Briefs land in briefs/. Manage via "node automations/manage.mjs list".`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: cadence install failed - ${errMsg(err)}`);
  }
}

// ── Session identity (agency multi-window safety) ────────────────────────────

/**
 * "Hiveku: Which Account Is This?" — resolves the OPEN WINDOW's identity: which
 * account this folder's .mcp.json key belongs to, the role, and whether a
 * local-scope `hiveku` MCP server is shadowing the folder's key (the classic
 * wrong-tenant footgun when running many accounts in parallel windows).
 */
async function whichAccount(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showInformationMessage('No folder open - open an account or project workspace first.');
    return;
  }
  const lines: string[] = [];
  for (const folder of folders) {
    const fsPath = folder.uri.fsPath;
    let key: string | undefined;
    try {
      const mcp = JSON.parse(await fs.readFile(path.join(fsPath, '.mcp.json'), 'utf8')) as {
        mcpServers?: { hiveku?: { headers?: { Authorization?: string } } };
      };
      key = mcp.mcpServers?.hiveku?.headers?.Authorization?.replace(/^Bearer\s+/i, '').trim();
    } catch {
      /* no .mcp.json */
    }
    if (!key) {
      lines.push(`${folder.name}: no Hiveku wiring (.mcp.json has no hiveku server)`);
      continue;
    }
    let match: AccountRecord | undefined;
    for (const rec of accounts.list()) {
      if ((await accounts.getKey(rec.accountId)) === key) {
        match = rec;
        break;
      }
    }
    if (match) {
      const role = accounts.getRole(match.accountId);
      lines.push(`${folder.name}: ${match.label}${role ? ` (role: ${role})` : ''}`);
    } else {
      lines.push(`${folder.name}: key ${key.slice(0, 10)}... is not one of this machine's connected accounts`);
    }
    const [localShadow, userShadow] = await Promise.all([hasLocalHivekuServer(fsPath), hasUserHivekuServer()]);
    if (localShadow)
      lines.push('  WARNING: a LOCAL-scope hiveku server in ~/.claude.json OVERRIDES this folder\'s key - Claude Code here may talk to a different account. Fix via "Hiveku: Set Claude Code Account" or remove it.');
    else if (userShadow)
      lines.push('  Note: a user-scope hiveku server exists in ~/.claude.json (project .mcp.json takes precedence, but remove it if a session ever hits the wrong account).');
  }
  const ids = new Set([...scms.values()].map((s) => s.link.account_id));
  if (ids.size > 1) lines.push('WARNING: this window mixes projects from DIFFERENT accounts - use one window per account.');
  await vscode.window.showInformationMessage(`Hiveku session identity\n\n${lines.join('\n')}`, { modal: true });
}

/**
 * Dedicated-session focus: when this window IS one account's workspace (its
 * folder is that account's root, or a site project inside it), filter both
 * trees to that account so the sidebar isn't cluttered with every client.
 * The filter is a default, not a cage - "Clear Account Filter" shows all.
 */
async function autoFocusWorkspaceAccount(): Promise<void> {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  if (roots.length === 0) return;
  let focus: AccountRecord | undefined;
  for (const rec of accounts.list()) {
    const folder = accounts.getFolder(rec.accountId);
    if (folder && roots.some((r) => r === folder || r.startsWith(folder + path.sep))) {
      focus = rec;
      break;
    }
  }
  if (!focus) {
    const ids = new Set([...scms.values()].map((x) => x.link.account_id));
    if (ids.size === 1) focus = accounts.list().find((r) => r.accountId === [...ids][0]);
  }
  if (focus) {
    tree.setAccountFilter(focus.accountId);
    consoleTree.setFilter(focus.accountId);
  }
}

/** Warn once when a window mixes Hiveku projects from different accounts. */
function warnIfMixedAccounts(): void {
  const ids = new Set([...scms.values()].map((s) => s.link.account_id));
  if (ids.size > 1) {
    vscode.window.showWarningMessage(
      'This window contains Hiveku projects from DIFFERENT accounts - Claude Code sessions here can write to the wrong tenant. Use one window per account ("Hiveku: Which Account Is This?" to check).',
    );
  }
}

// ── Roles ─────────────────────────────────────────────────────────────────────

/** Role QuickPick for one account; stores it, refreshes surfaces, offers re-scaffold. */
async function pickRole(record: AccountRecord, placeHolder: string): Promise<void> {
  const current = accounts.getRole(record.accountId);
  const pick = await vscode.window.showQuickPick(
    ROLES.map((r) => ({
      label: r.label,
      description: r.id === current ? 'current' : '',
      detail: r.blurb,
      id: r.id,
    })),
    { placeHolder: `${record.label} — ${placeHolder}`, ignoreFocusOut: true },
  );
  if (!pick || pick.id === current) return;
  await accounts.setRole(record.accountId, pick.id);
  tree.refresh();
  consoleTree.refresh();
  // Re-scaffold so the role's slash commands + CLAUDE.md block land in the account folder.
  const folder = accounts.getFolder(record.accountId);
  if (folder) {
    try {
      await fs.access(folder);
      const key = await accounts.getKey(record.accountId);
      if (key) {
        await writeScaffold({ baseDir: folder, accountLabel: record.label, apiKey: key, baseUrl: baseUrl(), role: pick.id, accountId: record.accountId });
        vscode.window.showInformationMessage(
          `${record.label} is now set up for ${pick.label} — /hiveku-daily and the role commands are refreshed in ${path.basename(folder)}.`,
        );
        return;
      }
    } catch {
      /* no folder yet — commands land on first download */
    }
  }
  vscode.window.showInformationMessage(`${record.label}: role set to ${pick.label}. Role commands are written when you download the account workspace.`);
}

async function setRole(node: { record: AccountRecord } | undefined): Promise<void> {
  const record = node?.record ?? (await accounts.pick('Set the role for which account?'));
  if (record) await pickRole(record, 'how do you run this account?');
}

/** Pull account-defined commands/agents (_command:/_agent:) into .claude/ for Claude Code. */
async function syncCommands(node: { record: AccountRecord } | undefined): Promise<void> {
  const record = node?.record ?? (await accounts.pick('Sync account commands for which account?'));
  if (!record) return;
  const folder = accounts.getFolder(record.accountId);
  if (!folder) {
    vscode.window.showInformationMessage('No local folder for this account yet — run "Hiveku: Download Everything" first.');
    return;
  }
  try {
    const index = await tree.indexFor(record.accountId);
    const res = await syncAccountCommands(index, folder);
    const bits = [`${res.written.length} written`, `${res.removed.length} removed`];
    if (res.skippedLocalEdits.length) bits.push(`${res.skippedLocalEdits.length} skipped (local edits — Hiveku entry is the source of truth)`);
    vscode.window.showInformationMessage(`Account commands synced: ${bits.join(', ')}.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

// ── "Hiveku Browser": per-project environment links + build/deploy logs ───────

/** The local folder for a project, if it's an open workspace (for writing .hiveku/logs). */
function folderForProject(projectId: string): string | undefined {
  for (const s of scms.values()) if (s.link.project_id === projectId) return s.root;
  return undefined;
}

/** Open a resolved environment URL in the default browser (from a siteEnv tree node). */
async function openSiteEnv(arg: { url?: string } | undefined): Promise<void> {
  if (arg?.url) await vscode.env.openExternal(vscode.Uri.parse(arg.url));
}

/** Pick an environment for a project (tree node or active workspace) and open it externally. */
async function openSite(node: { record?: AccountRecord; project?: api.ProjectSummary } | undefined): Promise<void> {
  let accountId: string;
  let projectId: string;
  let projectName: string;
  if (node?.record && node?.project) {
    accountId = node.record.accountId;
    projectId = node.project.id;
    projectName = node.project.name;
  } else {
    const scm = await getActiveScm();
    if (!scm) {
      vscode.window.showWarningMessage('No Hiveku project here — open a downloaded project or pick one from the sidebar.');
      return;
    }
    accountId = scm.link.account_id;
    projectId = scm.link.project_id;
    projectName = scm.link.project_name;
  }
  const client = await clientForAccount(accountId);
  const envs = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Hiveku: resolving environments…' },
    () => api.resolveEnvironments(client, projectId),
  );
  const pick = await vscode.window.showQuickPick(
    envs.map((e) => ({
      label: e.label,
      description: e.url ? e.url.replace(/^https?:\/\//, '') : e.status || 'not deployed',
      env: e,
    })),
    { placeHolder: `Open ${projectName} in your browser` },
  );
  if (!pick) return;
  if (!pick.env.url) {
    vscode.window.showInformationMessage(`${pick.env.label}: ${pick.env.status || 'not deployed'}.`);
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(pick.env.url));
}

/** Show an environment's build/deploy logs (inline action on a siteEnv tree node). */
async function showEnvLogsForNode(
  node: { record?: AccountRecord; project?: api.ProjectSummary; env?: resources.EnvKind } | undefined,
): Promise<void> {
  if (!node?.record || !node?.project || !node?.env) return;
  await resources.showEnvLogs(
    {
      accountId: node.record.accountId,
      projectId: node.project.id,
      projectName: node.project.name,
      env: node.env,
      folder: folderForProject(node.project.id),
    },
    clientForAccount,
    siteLogs,
  );
}

/** Pick an environment and show its logs for the active project workspace. */
async function envLogsForScm(scm: HivekuScm): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Live Preview', env: 'preview' as resources.EnvKind },
      { label: 'Development', env: 'development' as resources.EnvKind },
      { label: 'Staging', env: 'staging' as resources.EnvKind },
      { label: 'Production', env: 'production' as resources.EnvKind },
    ],
    { placeHolder: `Show build/deploy logs for ${scm.link.project_name}` },
  );
  if (!pick) return;
  await resources.showEnvLogs(
    {
      accountId: scm.link.account_id,
      projectId: scm.link.project_id,
      projectName: scm.link.project_name,
      env: pick.env,
      folder: scm.root,
    },
    clientForAccount,
    siteLogs,
  );
}

/**
 * Open an account as its own VS Code workspace so Claude Code operates scoped to
 * that account — writes the .mcp.json + CLAUDE.md scaffold, then opens the folder
 * in a new window.
 */
/**
 * Department session, agency-style: ONE window per account, many Claude Code
 * sessions inside it. This opens (or focuses) the account's workspace and puts
 * the department's session starter on the clipboard — start a new Claude Code
 * session in that window and paste.
 */
async function openDepartmentWindow(
  node: { record: AccountRecord; deptId?: string; label?: string } | undefined,
): Promise<void> {
  if (!node?.record || !node.deptId) return;
  const deptLabel = node.label ?? departmentById(node.deptId)?.label ?? node.deptId;
  // No role yet = no /hiveku-daily in the scaffold — ask now (skippable) so the
  // session starter actually exists in the window we are about to open.
  if (!accounts.getRole(node.record.accountId)) {
    await pickRole(node.record, 'how will you run this account? (Esc to skip)');
  }
  const dir = await ensureAccountFolder(node.record);
  if (!dir) return;
  // First open may predate any download — make the folder a working Claude
  // Code workspace (.mcp.json, CLAUDE.md, commands) before the window lands.
  const hasMcp = await fs.access(path.join(dir, '.mcp.json')).then(() => true, () => false);
  if (!hasMcp) {
    const key = await accounts.getKey(node.record.accountId);
    if (key) {
      await writeScaffold({
        baseDir: dir,
        accountLabel: node.record.label,
        apiKey: key,
        baseUrl: baseUrl(),
        role: accounts.getRole(node.record.accountId),
        accountId: node.record.accountId,
      }).catch(() => undefined);
    }
  }
  // Role-less accounts have no /hiveku-daily — fall back to the universal brief.
  const starter = accounts.getRole(node.record.accountId) ? `/hiveku-daily ${node.deptId}` : '/hiveku-brief';
  await vscode.env.clipboard.writeText(starter);
  vscode.window.showInformationMessage(
    `${node.record.label} — ${deptLabel}: start a new Claude Code session in the account window and paste ${starter} (copied).`,
  );
  // Focuses the existing account window when it's already open; opens it otherwise.
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), true);
}

/**
 * Refresh ONLY the Hiveku scaffold (.claude commands + CLAUDE.md + .mcp.json)
 * for the open folders — never downloads code, so uncommitted local edits are
 * safe. This is how you pick up new /hiveku-* commands without re-pulling.
 */
async function refreshSetup(): Promise<void> {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  if (roots.length === 0) {
    vscode.window.showInformationMessage('Open a Hiveku account or project folder first, then run this.');
    return;
  }
  let refreshed = 0;
  const details: string[] = [];
  for (const root of roots) {
    try {
      // A site-project folder? (has a .hiveku/project.json link, or a live SCM)
      const link = scms.get(root)?.link ?? (await readProjectLink(root));
      if (link?.project_id && link.account_id) {
        const key = await accounts.getKey(link.account_id);
        if (!key) continue;
        await writeProjectScaffold({
          baseDir: root,
          accountLabel: link.account_label ?? accounts.list().find((a) => a.accountId === link.account_id)?.label ?? 'Hiveku',
          apiKey: key,
          baseUrl: baseUrl(),
          projectId: link.project_id,
          projectName: link.project_name,
          role: accounts.getRole(link.account_id),
          accountId: link.account_id,
        });
        refreshed++;
        details.push(`${link.project_name} (project)`);
        continue;
      }
      // An account folder? (matches a stored account folder mapping)
      const acc = accounts.list().find((a) => accounts.getFolder(a.accountId) === root);
      if (acc) {
        const key = await accounts.getKey(acc.accountId);
        if (!key) continue;
        await writeScaffold({ baseDir: root, accountLabel: acc.label, apiKey: key, baseUrl: baseUrl(), role: accounts.getRole(acc.accountId), accountId: acc.accountId });
        refreshed++;
        details.push(`${acc.label} (account)`);
      }
    } catch (err) {
      log.appendLine(`[refreshSetup] ${root}: ${errMsg(err)}`);
    }
  }
  if (refreshed) {
    vscode.window.showInformationMessage(
      `Refreshed Hiveku setup for ${details.join(', ')} — new /hiveku-* commands + CLAUDE.md are current. Your code and uncommitted changes were NOT touched.`,
    );
  } else {
    vscode.window.showInformationMessage('No Hiveku project or account folder found in this workspace to refresh.');
  }
}

/**
 * "Hiveku: Set Up Codex Support" — enable the Codex lane (AGENTS.md +
 * .codex/config.toml with this folder's account MCP key + .agents/skills
 * mirrors of the /hiveku-* commands), rewrite the scaffolds in open folders,
 * and (with explicit consent — it crosses Codex's security boundary) pre-trust
 * the account folders in ~/.codex/config.toml so the project-level MCP config
 * loads without Codex's first-run prompt.
 */
async function setupCodexSupport(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('hiveku');
  await cfg.update('codexSupport', true, vscode.ConfigurationTarget.Global);
  setCodexSupport(true);
  await refreshSetup();
  const consent = await vscode.window.showInformationMessage(
    'Codex support is on: AGENTS.md, .codex/config.toml (Hiveku MCP with each folder\'s account key) and .agents/skills were written alongside the Claude Code files. ' +
      'Codex only loads project config for folders you trust — it prompts once per folder. Pre-trust your Hiveku account folders now (adds trust entries to ~/.codex/config.toml)?',
    'Pre-trust Hiveku folders',
    "I'll accept Codex's prompts myself",
  );
  if (consent !== 'Pre-trust Hiveku folders') return;
  const { preTrustFolder } = await import('./codex');
  let added = 0;
  let already = 0;
  for (const rec of accounts.list()) {
    const folder = accounts.getFolder(rec.accountId);
    if (!folder) continue;
    try {
      await fs.access(folder);
      const result = await preTrustFolder(folder);
      if (result === 'added') added++;
      else already++;
    } catch {
      /* folder missing or unreadable — skip */
    }
  }
  vscode.window.showInformationMessage(
    `Codex trust: ${added} folder(s) pre-trusted${already ? `, ${already} already trusted` : ''}. Open any Hiveku folder in Codex (CLI or the OpenAI VS Code extension) and it has the account's tools.`,
  );
}

async function openWorkspace(node: { record: AccountRecord } | undefined): Promise<void> {
  const account = node?.record ?? (await accounts.pick('Open which account as a workspace?'));
  if (!account) return;
  try {
    const dir = await ensureAccountFolder(account);
    if (!dir) return;
    const key = await accounts.getKey(account.accountId);
    if (key) {
      await writeScaffold({ baseDir: dir, accountLabel: account.label, apiKey: key, baseUrl: baseUrl(), role: accounts.getRole(account.accountId), accountId: account.accountId });
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), true);
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/** Show what needs attention + recent changes across all accounts. */
async function attention(): Promise<void> {
  const { lines } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Hiveku: scanning accounts…' },
    () => scanAccounts(),
  );
  if (lines.length === 0) {
    vscode.window.showInformationMessage('Nothing needs attention — all clear across your accounts.');
    return;
  }
  await vscode.window.showQuickPick(lines, { placeHolder: 'Attention + recent changes across your Hiveku accounts' });
}

async function newTask(node: { record: AccountRecord } | undefined): Promise<void> {
  const account = node?.record ?? (await accounts.pick('New task in which account?'));
  if (!account) return;
  try {
    const client = await clientForAccount(account.accountId);
    const projects = await api.pmProjectsList(client);
    if (projects.length === 0) {
      vscode.window.showInformationMessage('No PM projects in this account to add a task to.');
      return;
    }
    const proj = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: p.name || p.id, id: p.id })),
      { placeHolder: 'Project for the new task' },
    );
    if (!proj) return;
    const title = await vscode.window.showInputBox({ prompt: 'Task title' });
    if (!title) return;
    await api.pmTaskCreate(client, title, proj.id);
    vscode.window.showInformationMessage(`Created task: ${title}`);
    tree.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/** Report whether Hiveku has moved ahead of your last pull (GitHub-style). */
async function checkRemote(scm: HivekuScm): Promise<void> {
  const rs = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Hiveku: checking for remote changes…' },
    () => scm.remoteStatus(),
  );
  if (!rs.tracked) {
    vscode.window.showInformationMessage('No baseline yet — pull or re-download to enable behind-detection.');
    return;
  }
  if (rs.behind.length === 0 && rs.conflict.length === 0) {
    vscode.window.showInformationMessage(`Up to date with Hiveku (${rs.yours.length} local change(s)).`);
    return;
  }
  const parts: string[] = [];
  if (rs.behind.length) parts.push(`${rs.behind.length} changed on Hiveku`);
  if (rs.conflict.length) parts.push(`${rs.conflict.length} conflict with your edits`);
  const choice = await vscode.window.showWarningMessage(`You're behind Hiveku — ${parts.join(', ')}.`, 'Pull');
  if (choice === 'Pull') await pull(scm);
}

/** Map a file uri to its downloaded Hiveku project (for the Timeline provider). */
function resolveFileProject(
  uri: vscode.Uri,
): { accountId: string; projectId: string; relPath: string } | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return undefined;
  const scm = scms.get(folder.uri.fsPath);
  if (!scm) return undefined;
  const rel = path.relative(scm.root, uri.fsPath).split(path.sep).join('/');
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return { accountId: scm.link.account_id, projectId: scm.link.project_id, relPath: rel };
}

/** Report whether the account's downloaded knowledge is in sync with Hiveku. */
async function checkSync(node: { record: AccountRecord }): Promise<void> {
  if (!node?.record) return;
  try {
    const dir = accounts.getFolder(node.record.accountId);
    if (!dir) {
      vscode.window.showInformationMessage('Download this account first, then check sync.');
      return;
    }
    const client = await clientForAccount(node.record.accountId);
    const status = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Checking knowledge sync…' },
      () => computeSyncStatus(client, dir),
    );
    if (!status.initialized) {
      vscode.window.showInformationMessage('No knowledge downloaded yet for this account.');
      return;
    }
    const parts: string[] = [];
    if (status.changed_remote.length) parts.push(`${status.changed_remote.length} changed on Hiveku`);
    if (status.new_remote.length) parts.push(`${status.new_remote.length} new on Hiveku`);
    if (status.deleted_remote.length) parts.push(`${status.deleted_remote.length} removed on Hiveku`);
    if (status.locally_modified.length) parts.push(`${status.locally_modified.length} edited locally`);
    const drift = status.changed_remote.length + status.new_remote.length;
    const msg = parts.length
      ? `Out of sync — ${parts.join(', ')} (${status.in_sync} in sync).`
      : `In sync — ${status.in_sync} item(s).`;
    const choice = await vscode.window.showInformationMessage(
      `Hiveku knowledge: ${msg}`,
      ...(drift > 0 ? ['Download Everything'] : []),
    );
    if (choice === 'Download Everything') await downloadEverything({ record: node.record });
  } catch (err) {
    vscode.window.showErrorMessage(`Hiveku: ${errMsg(err)}`);
  }
}

/** Folder-pick + full download + lazy VCS bootstrap + open. */
/** The download itself (snapshot → extract → VCS link → Claude Code scaffold →
 *  baseline) — shared by the single-project flow and Download Everything. */
async function downloadProjectCore(
  account: AccountRecord,
  project: api.ProjectSummary,
  accountDir: string,
  report: (message: string) => void,
): Promise<string> {
  const client = await clientForAccount(account.accountId);
  const label = project.name || project.slug || project.id;
  const destRoot = path.join(accountDir, 'sites', sanitize(project.slug || project.name || project.id));
  const includeAssets = vscode.workspace
    .getConfiguration('hiveku')
    .get<boolean>('includeAssetsOnDownload', true);

  report('preparing snapshot');
  const snap = await api.snapshotUrl(client, project.id, includeAssets);
  report(`extracting ${snap.file_count} files`);
  await downloadAndExtract(snap.download_url, destRoot);

  report('initializing version control');
  // Lazily bootstrap the project's `main` branch + initial commit.
  const branches = await api.vcsBranches(client, project.id).catch(() => []);
  const defaultBranch = branches.find((b) => b.is_default)?.branch_name ?? 'main';

  const link: ProjectLink = {
    project_id: project.id,
    account_id: account.accountId,
    account_label: account.label,
    project_name: label,
    branch: defaultBranch,
    base_url: baseUrl(),
    last_pull_at: new Date().toISOString(),
  };
  await writeProjectLink(destRoot, link);

  // Wire the full account toolset for Claude Code in this project folder.
  report('wiring Hiveku tools for Claude Code');
  const key = await accounts.getKey(account.accountId);
  if (key) {
    await writeProjectScaffold({
      baseDir: destRoot,
      accountLabel: account.label,
      apiKey: key,
      baseUrl: baseUrl(),
      projectId: project.id,
      projectName: label,
      role: accounts.getRole(account.accountId),
      accountId: account.accountId,
    }).catch(() => undefined);
    await warnIfClaudeShadowsProject(destRoot, account, key);
  }
  // Record the downloaded state as the baseline for behind/conflict detection.
  await captureBaseline(destRoot).catch(() => undefined);
  return destRoot;
}

async function downloadProject(account: AccountRecord, project: api.ProjectSummary): Promise<void> {
  const label = project.name || project.slug || project.id;
  // Projects nest under the account folder: <hiveku-root>/<account>/<project>.
  const accountDir = await ensureAccountFolder(account);
  if (!accountDir) return;

  const destRoot = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Downloading ${label}…` },
    (progress) => downloadProjectCore(account, project, accountDir, (message) => progress.report({ message })),
  );

  const open = await vscode.window.showInformationMessage(
    `Downloaded ${label}. Open it now?`,
    'Open in New Window',
    'Open Here',
  );
  if (open === 'Open in New Window') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(destRoot), true);
  } else if (open === 'Open Here') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(destRoot), false);
  }
}

async function showHistory(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const history = await api.vcsHistory(client, scm.link.project_id, 100);
  if (history.length === 0) {
    vscode.window.showInformationMessage('No commits yet.');
    return;
  }
  await vscode.window.showQuickPick(
    history.map((c) => ({
      label: c.message,
      description: new Date(c.created_at).toLocaleString(),
      detail: `${c.files_committed} changed, ${c.files_deleted} deleted${c.checkpoint_hash ? ` · ${c.checkpoint_hash}` : ''}`,
    })),
    { placeHolder: `History — ${scm.link.project_name}` },
  );
}

async function revert(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const history = await api.vcsHistory(client, scm.link.project_id, 100);
  const restorable = history.filter((c) => c.checkpoint_hash);
  if (restorable.length === 0) {
    vscode.window.showInformationMessage('No restorable commits found.');
    return;
  }
  const pick = await vscode.window.showQuickPick(
    restorable.map((c) => ({
      label: c.message,
      description: new Date(c.created_at).toLocaleString(),
      detail: c.checkpoint_hash!,
      commit: c,
    })),
    { placeHolder: 'Revert the project to which commit? (restores its snapshot)' },
  );
  if (!pick) return;
  const confirm = await vscode.window.showWarningMessage(
    `Revert "${scm.link.project_name}" to "${pick.commit.message}"? This restores that snapshot on Hiveku, then re-downloads it locally.`,
    { modal: true },
    'Revert',
  );
  if (confirm !== 'Revert') return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Reverting…' },
    async () => {
      await api.checkpointRestore(client, scm.link.project_id, pick.commit.checkpoint_hash!);
      await pullInto(scm, client);
    },
  );
  await scm.refresh();
  vscode.window.showInformationMessage(`Reverted to "${pick.commit.message}".`);
}

async function createBranch(scm: HivekuScm): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: `Create a branch off "${scm.branch}"`,
    placeHolder: 'e.g. wip, feature-x',
    validateInput: (v) =>
      /^[A-Za-z0-9._/-]+$/.test(v.trim()) ? undefined : 'letters, numbers, and . _ / - only',
  });
  if (!name) return;
  const client = await clientForAccount(scm.link.account_id);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating branch ${name.trim()}…` },
    () => api.vcsBranchCreate(client, scm.link.project_id, name.trim(), scm.branch),
  );
  const choice = await vscode.window.showInformationMessage(`Created branch "${name.trim()}".`, 'Switch to it');
  if (choice === 'Switch to it') await scm.switchBranch(name.trim());
}

async function switchBranch(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const branches = await api.vcsBranches(client, scm.link.project_id);
  const pick = await vscode.window.showQuickPick(
    branches.map((b) => ({
      label: b.branch_name,
      description: b.is_default ? 'default' : b.branch_name === scm.branch ? 'current' : '',
    })),
    { placeHolder: `Current: ${scm.branch} — switch to…` },
  );
  if (!pick || pick.label === scm.branch) return;
  await scm.switchBranch(pick.label);
  refreshStatusBar();
}

async function merge(scm: HivekuScm): Promise<void> {
  if (scm.branch === 'main') {
    vscode.window.showInformationMessage('Switch to a branch first to merge it into main.');
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Merge "${scm.branch}" into main? Non-conflicting changes apply to the live project; conflicts are flagged, not overwritten.`,
    { modal: true },
    'Merge',
  );
  if (confirm !== 'Merge') return;
  const client = await clientForAccount(scm.link.account_id);
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Merging ${scm.branch} into main…` },
    () => api.vcsMerge(client, scm.link.project_id, scm.branch),
  );
  log.appendLine(
    `[merge] ${scm.branch}→main applied=${result.applied.length} (auto-merged=${result.auto_merged.length}) deleted=${result.deleted.length} conflicts=${result.conflicts.length}`,
  );
  const autoNote = result.auto_merged.length ? `, ${result.auto_merged.length} auto-merged line-by-line` : '';
  if (result.conflicts.length > 0) {
    log.appendLine(`[merge] conflicts: ${result.conflicts.join(', ')}`);
    const choice = await vscode.window.showWarningMessage(
      `Merged ${result.applied.length} file(s)${autoNote}, but ${result.conflicts.length} need manual resolution: ` +
        `${result.conflicts.slice(0, 4).join(', ')}${result.conflicts.length > 4 ? '…' : ''}.`,
      'Resolve on main',
    );
    if (choice === 'Resolve on main') {
      // Switch the workspace to main, drop the conflict-marked merges in, and open them.
      await scm.switchBranch('main');
      const details = result.conflict_details ?? {};
      await scm.writeFiles(details);
      await scm.refresh();
      const first = Object.keys(details)[0];
      if (first) {
        await vscode.window.showTextDocument(vscode.Uri.file(`${scm.root}/${first}`));
      }
      vscode.window.showInformationMessage(
        'Conflict markers written on main. Resolve <<<<<<< ======= >>>>>>> markers, then commit.',
      );
    }
  } else {
    vscode.window.showInformationMessage(
      `Merged "${scm.branch}" into main — ${result.applied.length} file(s) applied${autoNote}.`,
    );
  }
}

async function compare(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const branches = await api.vcsBranches(client, scm.link.project_id);
  const others = branches.filter((b) => b.branch_name !== scm.branch);
  if (others.length === 0) {
    vscode.window.showInformationMessage('No other branch to compare against.');
    return;
  }
  const base = await vscode.window.showQuickPick(
    others.map((b) => ({ label: b.branch_name, description: b.is_default ? 'default' : '' })),
    { placeHolder: `Compare ${scm.branch} against…` },
  );
  if (!base) return;
  const res = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Comparing ${base.label} → ${scm.branch}…` },
    () => api.vcsCompare(client, scm.link.project_id, base.label, scm.branch),
  );
  if (res.entries.length === 0) {
    vscode.window.showInformationMessage(`No differences between ${base.label} and ${scm.branch}.`);
    return;
  }
  await vscode.window.showQuickPick(
    res.entries.map((e) => ({
      label: `${e.status === 'added' ? '$(diff-added)' : e.status === 'removed' ? '$(diff-removed)' : '$(diff-modified)'} ${e.path}`,
      description: e.status,
    })),
    { placeHolder: `${base.label} → ${scm.branch}:  +${res.added}  -${res.removed}  ~${res.modified}` },
  );
}

async function prune(scm: HivekuScm): Promise<void> {
  const client = await clientForAccount(scm.link.account_id);
  const dry = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning branch storage…' },
    () => api.vcsPrune(client, scm.link.project_id, true),
  );
  if (dry.orphaned.length === 0) {
    vscode.window.showInformationMessage(
      `Nothing to prune — ${dry.scanned} tree object(s), all in use.`,
    );
    return;
  }
  const ok = await vscode.window.showWarningMessage(
    `Delete ${dry.orphaned.length} orphaned branch-tree object(s)? (${dry.scanned} scanned, ${dry.referenced} in use.)`,
    { modal: true },
    'Delete',
  );
  if (ok !== 'Delete') return;
  const res = await api.vcsPrune(client, scm.link.project_id, false);
  vscode.window.showInformationMessage(`Pruned ${res.deleted} orphaned branch-tree object(s).`);
}

async function previewBranch(scm: HivekuScm): Promise<void> {
  if (scm.branch === 'main') {
    vscode.window.showInformationMessage('This previews a branch. For main, use the project\'s normal preview.');
    return;
  }
  const client = await clientForAccount(scm.link.account_id);
  const res = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Starting Fly preview for ${scm.branch}…` },
    () => api.vcsBranchPreview(client, scm.link.project_id, scm.branch),
  );
  if (res.previewUrl) {
    const open = await vscode.window.showInformationMessage(
      `Branch preview ${res.status} — ${res.filesSynced} file(s) synced${res.filesFailed ? `, ${res.filesFailed} failed` : ''}.`,
      'Open Preview',
    );
    if (open === 'Open Preview') await vscode.env.openExternal(vscode.Uri.parse(res.previewUrl));
  } else {
    vscode.window.showErrorMessage(`Branch preview failed: ${res.error ?? res.status}`);
  }
}

async function deploy(scm: HivekuScm): Promise<void> {
  const env = await vscode.window.showQuickPick(
    [
      { label: 'development', description: 'Safe default — fast turnaround' },
      { label: 'staging', description: 'Must be enabled per project' },
      { label: 'production', description: 'Go live' },
    ],
    { placeHolder: 'Deploy to which environment?' },
  );
  if (!env) return;
  const client = await clientForAccount(scm.link.account_id);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Deploying to ${env.label}…` },
    async () => {
      const res = await api.deploySite(
        client,
        scm.link.project_id,
        env.label as 'development' | 'staging' | 'production',
      );
      log.appendLine(`[deploy] ${env.label} → ${res.deployment_id ?? '(no id)'} ${res.status ?? ''}`);
      vscode.window.showInformationMessage(
        `Deploy to ${env.label} started${res.deployment_id ? ` (${res.deployment_id})` : ''}.`,
      );
    },
  );
}

async function pull(scm: HivekuScm): Promise<void> {
  if ((scm.sc.count ?? 0) > 0) {
    const choice = await vscode.window.showWarningMessage(
      'You have uncommitted local changes. Pulling overwrites tracked files with Hiveku\'s current state. Continue?',
      { modal: true },
      'Pull anyway',
    );
    if (choice !== 'Pull anyway') return;
  }
  const client = await clientForAccount(scm.link.account_id);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Pulling latest from Hiveku…' },
    () => pullInto(scm, client),
  );
  await scm.refresh();
  vscode.window.showInformationMessage('Pulled latest from Hiveku.');
}

async function pullInto(scm: HivekuScm, client: HivekuMcpClient): Promise<void> {
  const includeAssets = vscode.workspace
    .getConfiguration('hiveku')
    .get<boolean>('includeAssetsOnDownload', true);
  const snap = await api.snapshotUrl(client, scm.link.project_id, includeAssets);
  await downloadAndExtract(snap.download_url, scm.root);
  scm.link = { ...scm.link, last_pull_at: new Date().toISOString() };

  // Follow Hiveku renames: the project's display name is edited in Hiveku, so
  // every pull re-syncs it into the local link (status bar, commands, window
  // title all read from there). The folder name itself stays — renaming the
  // open workspace root under VS Code would break the session.
  try {
    const detail = await api.projectGet(client, scm.link.project_id);
    const freshName = typeof detail.name === 'string' && detail.name ? detail.name : undefined;
    if (freshName && freshName !== scm.link.project_name) {
      const oldName = scm.link.project_name;
      scm.link = { ...scm.link, project_name: freshName };
      refreshStatusBar();
      vscode.window.showInformationMessage(
        `Project renamed in Hiveku: "${oldName}" is now "${freshName}". Titles updated — the local folder keeps its name (rename it after closing VS Code if you want them to match).`,
      );
    }
  } catch {
    /* name sync is best-effort */
  }

  await writeProjectLink(scm.root, scm.link);
  // Backfill the Hiveku tool wiring for projects downloaded before this existed.
  const key = await accounts.getKey(scm.link.account_id);
  if (key) {
    await writeProjectScaffold({
      baseDir: scm.root,
      accountLabel: scm.link.account_label,
      apiKey: key,
      baseUrl: scm.link.base_url || baseUrl(),
      projectId: scm.link.project_id,
      projectName: scm.link.project_name,
      role: accounts.getRole(scm.link.account_id),
      accountId: scm.link.account_id,
    }).catch(() => undefined);
  }
  await captureBaseline(scm.root).catch(() => undefined);
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'hiveku-project';
}
