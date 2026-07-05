/**
 * Account knowledge: department memory / skills / rules / etc. Mirrors what the
 * `hiveku-sync` CLI pulls (memory_list per type), but organized by DEPARTMENT
 * so the sidebar can show "Sales → Memory/Skills/Rules" and download per dept.
 *
 * Also writes the per-account scaffold (.mcp.json, CLAUDE.md, .env) so the
 * downloaded folder is a ready-to-use Claude Code workspace for that account.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import { AUTOMATION_GUIDE } from './automationGuide';
import { writeRoleSlashCommands, roleClaudeMdBlock, MULTI_SESSION_BLOCK } from './roleCommands';
import { roleById } from './roles';
import { writeDataRunner } from './dataRunner';
import { writeAgencySkills } from './agencySkills';

/** memory `type` → local folder (matches hiveku-sync TYPE_TO_FOLDER). */
export const TYPE_TO_FOLDER: Record<string, string> = {
  memory: 'memory',
  rule: 'rules',
  skill: 'skills',
  command: 'commands',
  agent: 'agents',
  identity: 'identity',
};
export const SUPPORTED_TYPES = Object.keys(TYPE_TO_FOLDER);
export const TYPE_LABEL: Record<string, string> = {
  memory: 'Memory',
  rule: 'Rules',
  skill: 'Skills',
  command: 'Commands',
  agent: 'Agents',
  identity: 'Identity',
};

/** Canonical departments (mirrors hiveku_builder src/lib/departments.ts). */
export const DEPARTMENTS: Array<{ slug: string; label: string }> = [
  { slug: 'marketing', label: 'Marketing' },
  { slug: 'content', label: 'Content' },
  { slug: 'seo', label: 'SEO' },
  { slug: 'social', label: 'Social' },
  { slug: 'ppc', label: 'PPC' },
  { slug: 'outbound', label: 'Outbound' },
  { slug: 'branding', label: 'Branding' },
  { slug: 'sales', label: 'Sales' },
  { slug: 'email', label: 'Email Marketing' },
  { slug: 'helpdesk', label: 'Helpdesk' },
  { slug: 'knowledge_base', label: 'Knowledge Base' },
  { slug: 'workflow', label: 'Workflow' },
];
const GENERAL = 'general';

export function departmentLabel(slug: string): string {
  return DEPARTMENTS.find((d) => d.slug === slug)?.label ?? slug.replace(/_/g, ' ');
}

export interface KnowledgeEntry {
  id?: string;
  name?: string;
  domain?: string;
  content?: string;
  project_id?: string;
  version?: number | string;
  updated_at?: string;
  type: string;
  department: string;
}

/** dept -> type -> entries */
export type KnowledgeIndex = Map<string, Map<string, KnowledgeEntry[]>>;

function extractDepartmentTag(content?: string): string | null {
  if (!content) return null;
  const html = content.match(/<!--\s*department:\s*([a-z0-9_-]+)\s*-->/i);
  if (html) return html[1];
  const yaml = content.match(/^department:\s*["']?([a-z0-9_-]+)["']?\s*$/im);
  if (yaml) return yaml[1];
  return null;
}

function departmentOf(entry: { domain?: string; content?: string }): string {
  if (entry.domain && !entry.domain.startsWith('_')) return entry.domain;
  return extractDepartmentTag(entry.content) ?? GENERAL;
}

function safeSlug(name: string | undefined): string {
  return (
    String(name || 'unnamed')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'unnamed'
  );
}

function toFrontmatter(fields: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    lines.push(`${k}: "${String(v).replace(/"/g, '\\"')}"`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

/** Fetch all knowledge for an account, grouped department → type → entries. */
export async function fetchKnowledge(client: HivekuMcpClient): Promise<KnowledgeIndex> {
  const index: KnowledgeIndex = new Map();
  for (const type of SUPPORTED_TYPES) {
    let entries: api.MemoryEntry[];
    try {
      entries = await api.listMemory(client, type);
    } catch {
      continue; // a type may be unavailable on some profiles
    }
    for (const raw of entries) {
      const department = departmentOf(raw);
      const entry: KnowledgeEntry = { ...raw, type, department };
      if (!index.has(department)) index.set(department, new Map());
      const byType = index.get(department)!;
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(entry);
    }
  }
  return index;
}

function renderEntry(entry: KnowledgeEntry): string {
  const fm = toFrontmatter({
    id: entry.id,
    name: entry.name,
    type: entry.type,
    domain: entry.domain,
    department: entry.department,
    project_id: entry.project_id,
    version: entry.version,
    updated_at: entry.updated_at,
  });
  return `${fm}${entry.content ?? ''}`;
}

async function writeAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents, 'utf8');
}

// ── Sync manifest + drift detection ─────────────────────────────────────────
// So Claude Code (and the user) can tell when the LOCAL copy is out of sync
// with the Hiveku account: changed/new/deleted remotely, or edited locally.

const MANIFEST_PATH = path.join('.hiveku', 'knowledge-manifest.json');
const STATUS_PATH = path.join('.hiveku', 'knowledge-status.json');

interface ManifestRow {
  id?: string;
  type: string;
  department: string;
  domain?: string;
  version?: number | string;
  updated_at?: string;
  file: string; // relative path
  content_sha: string; // sha of the file as written
  synced_at: string;
}
interface Manifest {
  synced_at: string;
  entries: Record<string, ManifestRow>; // keyed by domain
}

async function readManifest(baseDir: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(baseDir, MANIFEST_PATH), 'utf8')) as Manifest;
  } catch {
    return undefined;
  }
}
async function writeManifest(baseDir: string, m: Manifest): Promise<void> {
  await writeAtomic(path.join(baseDir, MANIFEST_PATH), JSON.stringify(m, null, 2));
}

function keyOf(entry: { domain?: string; type: string }): string {
  return entry.domain ?? `${entry.type}:unknown`;
}

/** Write entries to <type-folder>/<department>/<name>.md and update the sync manifest. */
export async function writeEntries(baseDir: string, entries: KnowledgeEntry[]): Promise<number> {
  const manifest = (await readManifest(baseDir)) ?? { synced_at: '', entries: {} };
  const now = new Date().toISOString();
  let written = 0;
  for (const entry of entries) {
    const folder = TYPE_TO_FOLDER[entry.type] ?? entry.type;
    const rel = path.join(folder, entry.department, `${safeSlug(entry.name)}.md`);
    const rendered = renderEntry(entry);
    await writeAtomic(path.join(baseDir, rel), rendered);
    manifest.entries[keyOf(entry)] = {
      id: entry.id,
      type: entry.type,
      department: entry.department,
      domain: entry.domain,
      version: entry.version,
      updated_at: entry.updated_at,
      file: rel.split(path.sep).join('/'),
      content_sha: sha256(rendered),
      synced_at: now,
    };
    written += 1;
  }
  manifest.synced_at = now;
  await writeManifest(baseDir, manifest);
  return written;
}

export interface SyncStatus {
  initialized: boolean;
  checked_at: string;
  in_sync: number;
  changed_remote: string[]; // domains updated on Hiveku since last pull
  new_remote: string[]; // exist on Hiveku, not pulled locally
  deleted_remote: string[]; // pulled locally, gone on Hiveku
  locally_modified: string[]; // local file edited since pull
  missing_local: string[]; // in manifest but file deleted locally
}

/** Compare local knowledge against the current Hiveku account; writes a status file. */
export async function computeSyncStatus(client: HivekuMcpClient, baseDir: string): Promise<SyncStatus> {
  const checked_at = new Date().toISOString();
  const manifest = await readManifest(baseDir);
  if (!manifest) {
    const empty: SyncStatus = {
      initialized: false,
      checked_at,
      in_sync: 0,
      changed_remote: [],
      new_remote: [],
      deleted_remote: [],
      locally_modified: [],
      missing_local: [],
    };
    return empty;
  }

  const index = await fetchKnowledge(client);
  const remote = new Map<string, KnowledgeEntry>();
  for (const entry of selectEntries(index)) remote.set(keyOf(entry), entry);

  const status: SyncStatus = {
    initialized: true,
    checked_at,
    in_sync: 0,
    changed_remote: [],
    new_remote: [],
    deleted_remote: [],
    locally_modified: [],
    missing_local: [],
  };

  // Remote vs manifest.
  for (const [key, entry] of remote) {
    const row = manifest.entries[key];
    if (!row) {
      status.new_remote.push(key);
      continue;
    }
    const versionChanged =
      entry.version !== undefined && row.version !== undefined && String(entry.version) !== String(row.version);
    const timeChanged =
      !!entry.updated_at && !!row.updated_at && entry.updated_at > row.updated_at;
    if (versionChanged || timeChanged) status.changed_remote.push(key);
  }

  // Manifest vs remote + local file state.
  for (const [key, row] of Object.entries(manifest.entries)) {
    if (!remote.has(key)) status.deleted_remote.push(key);
    let localSha: string | undefined;
    try {
      localSha = sha256(await fs.readFile(path.join(baseDir, row.file), 'utf8'));
    } catch {
      status.missing_local.push(key);
      continue;
    }
    if (localSha !== row.content_sha) status.locally_modified.push(key);
    if (remote.has(key) && !status.changed_remote.includes(key) && localSha === row.content_sha) {
      status.in_sync += 1;
    }
  }

  await writeAtomic(path.join(baseDir, STATUS_PATH), JSON.stringify(status, null, 2));
  return status;
}

/** Flatten an index to a list, optionally filtered by department and/or type. */
export function selectEntries(
  index: KnowledgeIndex,
  opts: { department?: string; type?: string } = {},
): KnowledgeEntry[] {
  const out: KnowledgeEntry[] = [];
  for (const [dept, byType] of index) {
    if (opts.department && dept !== opts.department) continue;
    for (const [type, entries] of byType) {
      if (opts.type && type !== opts.type) continue;
      out.push(...entries);
    }
  }
  return out;
}

// ── Scaffold (.mcp.json / CLAUDE.md / .env), mirroring hiveku-sync init ──────

export interface ScaffoldOptions {
  baseDir: string;
  accountLabel: string;
  apiKey: string;
  baseUrl: string;
  /** Project scaffolds only — embedded into the slash commands so they need no lookup. */
  projectId?: string;
  projectName?: string;
  /** The user's role for this account (roles.ts) — drives role slash commands + CLAUDE.md block. */
  role?: string;
  /** Account id — drives the per-window identity (title + deterministic title-bar color). */
  accountId?: string;
  /** Claude Code autonomy in this workspace (hiveku.claudeCodePermissionMode). Default 'acceptEdits'. */
  permissionMode?: PermissionMode;
  /** Email of the user who connected this account — injected so Claude Code attributes PM tasks/comments to them. */
  connectedAs?: string;
}

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

// Workspace autonomy for Claude Code, from the hiveku.claudeCodePermissionMode
// setting. extension.ts pushes it here on activation + on config change, so every
// scaffold (which doesn't carry it per-call) picks up the current choice. Default
// 'acceptEdits' — auto-approve edits, still prompt for bash/deploys/network.
let configuredPermissionMode: PermissionMode = 'acceptEdits';
export function setPermissionMode(mode: PermissionMode): void {
  configuredPermissionMode = mode;
}
export function getPermissionMode(): PermissionMode {
  return configuredPermissionMode;
}

// accountId -> email of the user who connected it (AccountRecord.connectedAs).
// extension.ts pushes this on activation + whenever accounts change, so scaffolds
// can inject "who to attribute PM tasks to" without threading it through every
// call site. A scaffold's opts.connectedAs still wins when explicitly set.
let connectedAsByAccount: Record<string, string | undefined> = {};
export function setConnectedAsMap(map: Record<string, string | undefined>): void {
  connectedAsByAccount = map;
}

// MCP read/inspect + safe-bash rules auto-approved for Claude Code in a project,
// so it stops prompting on every call. Reads only — mutations (commit, save,
// deploy, delete, secrets, supabase) are intentionally absent so they still confirm.
const HIVEKU_ALLOW: string[] = [
  'Bash(node .hiveku/pull-data.mjs)',
  'Bash(node .hiveku/pull-data.mjs:*)',
  'mcp__hiveku__.*_get',
  'mcp__hiveku__get_.*',
  'mcp__hiveku__.*_list',
  'mcp__hiveku__list_.*',
  'mcp__hiveku__.*_list_.*',
  'mcp__hiveku__.*_status',
  'mcp__hiveku__verify_.*',
  'mcp__hiveku__hiveku_docs_.*',
  'mcp__hiveku__account_context_get',
  'mcp__hiveku__project_files_search',
  'mcp__hiveku__project_files_bulk_get',
  'mcp__hiveku__project_deploy_preflight',
  'mcp__hiveku__project_test_build',
  'mcp__hiveku__project_build_error_get',
  'mcp__hiveku__project_vcs_branches',
  'mcp__hiveku__project_vcs_history',
  'mcp__hiveku__project_vcs_compare',
  'mcp__hiveku__project_vcs_checkout',
  // Version history + checkpoints — READ + DRY-RUN only (the actual restores
  // stay behind a confirm; creating a checkpoint is safe/additive).
  'mcp__hiveku__project_version_log',
  'mcp__hiveku__project_file_versions',
  'mcp__hiveku__project_file_diff',
  'mcp__hiveku__project_checkpoint_list',
  'mcp__hiveku__project_checkpoint_get',
  'mcp__hiveku__project_checkpoint_restore_dry_run',
  'mcp__hiveku__checkpoint_list',
  'mcp__hiveku__checkpoint_get',
  'mcp__hiveku__checkpoint_create',
  'mcp__hiveku__project_state_at',
  'mcp__hiveku__project_files_snapshot',
  'mcp__hiveku__history_list_preview_sessions',
  'mcp__hiveku__preview_overview',
  'mcp__hiveku__preview_logs',
  'mcp__hiveku__preview_screenshot',
  'mcp__hiveku__analytics_.*',
  'mcp__hiveku__talk_to_department',
  // Role daily-brief signals (read-only reports the /hiveku-daily commands chain).
  'mcp__hiveku__.*_summary',
  'mcp__hiveku__.*_stats',
  'mcp__hiveku__.*_metrics',
  'mcp__hiveku__accounting_ap_aging',
  'mcp__hiveku__accounting_ar_aging',
  'mcp__hiveku__mc_tasks_next',
  'mcp__hiveku__mc_sla_breached',
  'mcp__hiveku__mc_tasks_stalled',
  'mcp__hiveku__crm_deals_at_risk',
  'mcp__hiveku__crm_deals_stuck',
  'mcp__hiveku__crm_contacts_gone_cold',
  'mcp__hiveku__crm_activity_leaderboard',
  'mcp__hiveku__ppc_anomaly_check',
  'mcp__hiveku__ppc_period_comparison',
  'mcp__hiveku__ppc_search_terms_report',
  'mcp__hiveku__seo_content_decay',
  'mcp__hiveku__seo_cannibalization',
  'mcp__hiveku__account_audit_health',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git branch:*)',
  'Bash(npm install:*)',
  'Bash(npm ci:*)',
  'Bash(npm run:*)',
  'Bash(npm test:*)',
  'Bash(pnpm:*)',
  'Bash(yarn:*)',
  'Bash(npx tsc:*)',
  'Bash(node:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(head:*)',
  'Bash(tail:*)',
  'Bash(grep:*)',
  'Bash(rg:*)',
  'Bash(find:*)',
];

/** Merge our allow rules + acceptEdits default into .claude/settings.json (non-destructive). */
async function writeClaudeSettings(baseDir: string, mode: PermissionMode = configuredPermissionMode): Promise<void> {
  const file = path.join(baseDir, '.claude', 'settings.json');
  let settings: { defaultMode?: string; permissions?: { allow?: string[] } & Record<string, unknown> } & Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (parsed && typeof parsed === 'object') settings = parsed;
  } catch {
    /* none yet */
  }
  if (!settings.permissions || typeof settings.permissions !== 'object') settings.permissions = {};
  // Permission mode lives under permissions.defaultMode. A ROOT-level defaultMode
  // (what older scaffolds wrote) is IGNORED by Claude Code — migrate it away and
  // set the real key. This governs terminal/CLI Claude Code; the VS Code
  // extension GUI reads claudeCode.initialPermissionMode (see writeWindowIdentity).
  delete (settings as Record<string, unknown>).defaultMode;
  (settings.permissions as Record<string, unknown>).defaultMode = mode;
  const allow = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
  const have = new Set(allow);
  for (const rule of HIVEKU_ALLOW) if (!have.has(rule)) allow.push(rule);
  settings.permissions.allow = allow;
  // The scaffold's `.env` / `.mcp.json` hold only the Hiveku account key — which
  // Claude Code already uses — and real app secrets live in Hiveku's secret store
  // (project_secrets_*), never on disk. Reading the account key is fine (Abe's
  // call), so we do NOT deny it; `.gitignore` + the commit-exclude keep it out of
  // commits. We keep ONE guard: `.env*.local`, the conventional place a developer
  // would drop real third-party secrets during local dev on a downloaded site.
  const deny = Array.isArray((settings.permissions as Record<string, unknown>).deny)
    ? ((settings.permissions as Record<string, unknown>).deny as string[])
    : [];
  const haveDeny = new Set(deny);
  // Retire the older broad env/mcp deny rules if a previous scaffold wrote them.
  const RETIRED = new Set(['Read(.env)', 'Read(.env.*)', 'Read(**/.env)', 'Read(**/.env.*)', 'Read(.mcp.json)', 'Read(**/.mcp.json)']);
  let denyList = deny.filter((r) => !RETIRED.has(r));
  for (const rule of ['Read(**/.env.local)', 'Read(**/.env.*.local)']) {
    if (!haveDeny.has(rule) && !denyList.includes(rule)) denyList.push(rule);
  }
  (settings.permissions as Record<string, unknown>).deny = denyList;
  await writeAtomic(file, JSON.stringify(settings, null, 2) + '\n');
}

/** Write the /hiveku-* slash commands (the common loop), with the project id baked in. */
async function writeSlashCommands(baseDir: string, projectId?: string): Promise<void> {
  const pid = projectId || 'the project_id in .hiveku/project.json';
  const idLine = projectId
    ? `This project's id is \`${projectId}\` (also in \`.hiveku/project.json\`).`
    : `This project's id is in \`.hiveku/project.json\` (\`project_id\`).`;

  const commands: Record<string, string> = {
    'hiveku-commit': `---
description: Commit your local file changes to Hiveku (its native VCS). Use after editing files in this project.
argument-hint: "[commit message]"
allowed-tools: mcp__hiveku__project_vcs_commit, mcp__hiveku__project_files_status, Read
---
Commit the current local changes to Hiveku for THIS project.

${idLine}

1. Work out which files changed (the files you edited, or diff with \`project_files_status\`).
2. Call \`project_vcs_commit({ project_id: "${pid}", message: "$ARGUMENTS", files: [{ path, content }], deletedFiles: [...] })\`
   with the CURRENT contents of every changed file (and any deletions). One call = one versioned commit on \`main\`.
3. NEVER include \`.mcp.json\`, \`.env.local\`, \`.env.hiveku\`, \`.hiveku/\`, or \`.claude/\` — those are local-only.
4. If "$ARGUMENTS" is empty, write a concise imperative message describing the change.

For a FEW text edits this is fine. For LOTS of files, or any BINARY ASSETS (images/fonts/video),
use \`/hiveku-push\` instead — a single \`project_vcs_commit\` chokes on large/binary payloads and puts
images in the wrong storage lane (they render in preview but vanish on deploy).

Commit ≠ live — run \`/hiveku-deploy\` to ship it.
`,
    'hiveku-push': `---
description: Reliably push local file changes to Hiveku — routes binary assets and code to the correct storage lane. Use for large changesets or anything with images.
allowed-tools: mcp__hiveku__assets_upload, mcp__hiveku__project_files_bulk_save, mcp__hiveku__project_files_status, mcp__hiveku__project_file_delete, Read
---
Push the current local changes to Hiveku for THIS project, RELIABLY. ${idLine}

Hiveku has TWO storage lanes and using the wrong one is the #1 cause of "images work in
preview but are missing after deploy":
- **CDN-servable binary assets** — images, fonts, video/audio that live under a \`public/\`
  SUBDIRECTORY (e.g. \`public/images/cdn/hero.jpg\`). These MUST go through
  \`assets_upload\` → they land in \`builder_project_assets\` + S3 and are served via the CDN on
  EVERY deploy tier. Do NOT send them with \`project_file_save\`/\`project_files_bulk_save\`/
  \`project_vcs_commit\`: that writes \`builder_code_versions\`, which the Fly preview serves but
  the deploy bundle EXCLUDES — so they go missing on deploy.
- **Code / text / \`src\` assets / \`public/\` ROOT files** (favicon.ico, robots.txt) — these go
  through \`project_files_bulk_save\` (builder_code_versions), the lane the build reads.

Steps:
1. Determine the changed set (files you edited/added, plus deletions). For text drift you can use
   \`project_files_status({ project_id: "${pid}", local: [{ path, sha256 }] })\` — but note it is
   TEXT-ONLY (it does not track binary), so track image changes yourself.
2. ASSET lane — for each changed CDN-servable binary file, call
   \`assets_upload({ project_id: "${pid}", file_path: "public/…", content: <base64> })\`. One file
   per call (25MB/file cap). Do a handful at a time; if one fails, retry it, don't blast all at once.
3. CODE lane — batch the code/text files into SMALL groups (~20-30 files AND under ~4MB of content
   per call) and \`project_files_bulk_save({ project_id: "${pid}", files: [{ path, content, encoding }] })\`.
   Use \`encoding: "base64"\` for any non-CDN binary (e.g. a \`src/\` asset). After EACH call, confirm
   \`data.summary.succeeded\` equals the batch size and check \`data.results[]\` for \`ok:false\`; retry
   failures. NEVER send one giant call — large/base64 payloads time out over the transport.
4. Deletions — \`project_file_delete({ project_id: "${pid}", file_path })\` per removed file.
5. NEVER push \`.mcp.json\`, \`.env*\`, \`.hiveku/\`, or \`.claude/\`.
6. Verify: re-run \`project_files_status\` and confirm \`only_local\` is empty for text; for assets,
   \`assets_list\` should show each one. Then \`/hiveku-deploy\` to ship (push ≠ live).

Tip: in VS Code, the Source Control view's "Push Local Changes" button does all of this for you.
`,
    'hiveku-review': `---
description: Resolve a LOCAL visual review — read the on-disk annotations (boxes/pins + comments on a screenshot), fix the code each points at, mark them resolved. Optionally capture a page first.
allowed-tools: mcp__hiveku__preview_overview, mcp__hiveku__preview_sync, mcp__plugin_playwright_playwright__browser_navigate, mcp__plugin_playwright_playwright__browser_resize, mcp__plugin_playwright_playwright__browser_take_screenshot, mcp__plugin_playwright_playwright__browser_evaluate, mcp__hiveku__project_files_search, mcp__hiveku__verify_typecheck, mcp__hiveku__verify_lint, Read, Write, Edit, Grep, Bash
---
Resolve a LOCAL visual review for THIS project. ${idLine} Everything lives on disk under \`.hiveku/review/\` — no app chat, no annotation server, and it is gitignored so it never leaves the machine.

STEP 0 — CAPTURE (only if the user asks to "capture <path>", or \`.hiveku/review/\` has no screenshots yet):
1. Get the live preview URL: \`preview_overview({ project_id: "${pid}" })\` → \`preview_url\`. If it is not ready, \`preview_sync({ project_id: "${pid}" })\` then re-poll.
2. \`browser_navigate({ url: <preview_url + path> })\`, then \`browser_resize({ width: 1920, height: 1080 })\`.
3. SLUG (use the SAME string for the folder name AND the index.json \`slug\`): trim leading/trailing "/", replace internal "/" with "__", strip anything not [a-z0-9_-], empty → "home". So "/" → home, "/about" → about, "/blog/post" → blog__post.
4. \`browser_take_screenshot({ fullPage: true, type: "png", scale: "css", filename: "hiveku-review.png" })\` — \`scale\` is REQUIRED; \`scale:"css"\` makes the PNG exactly 1920 wide to match the logical-CSS rects. This writes to the Playwright MCP output dir, NOT your project — so then \`mkdir -p .hiveku/review/<slug>\` and Bash \`cp\` the returned file to \`.hiveku/review/<slug>/screenshot.png\`. The PNG MUST physically exist at that exact path (the annotator only lists a page when screenshot.png + dom.json + capture.json are all present).
5. \`browser_evaluate\` a function that returns \`{ pageMetrics, elements }\` where each element is
   \`{ selector, rect:{x,y,width,height} in LOGICAL/CSS PAGE coords (rect.left+scrollX, rect.top+scrollY — NOT device pixels), tag, id, classes, text (≤200 chars), hivekuId (from data-hiveku-id), hivekuSource (JSON.parse of data-hiveku-source, then normalize to {file, line, column: column ?? col} — the column key is "column" on webpack builds and "col" on babel builds; only file+line are guaranteed; else null), outerHTMLHead (outerHTML.slice(0,120)), ariaLabel }\`. Also read \`window.devicePixelRatio\` and \`document.documentElement.scrollHeight\` here so they are accurate.
   Walk the DOM in DOCUMENT ORDER, skip zero-size / display:none / visibility:hidden elements (the annotator resolves a click to the SMALLEST covering rect, i.e. the deepest element). Write it to \`.hiveku/review/<slug>/dom.json\`.
6. Write \`.hiveku/review/<slug>/capture.json\`: \`{ version:1, pageUrl, previewUrl, projectId:"${pid}", viewport:{width:1920,height:1080} (LOGICAL CSS px), devicePixelRatio (from window.devicePixelRatio), scrollY:0, fullPage:true, fullPageHeight: document.documentElement.scrollHeight (LOGICAL CSS px — a sanity value; the annotator derives page height from the PNG itself), capturedAt }\`.
   Then UPSERT this page into \`.hiveku/review/index.json\`, shape \`{ version:1, projectId:"${pid}", projectName, pages: [ { slug, pageUrl, capturedAt, annotationCount:0, openCount:0, resolvedCount:0 } ] }\` (the extension adds \`savedAt\` on annotate) — \`pages\` is an ARRAY; replace the row with the same \`slug\` if present, else append. Read the FULL file first and preserve every other row; never rewrite \`pages\` as an object or you drop other pages.
7. Tell the user to run "Hiveku: Annotate Review Page" in VS Code (the extension command) to mark it up, then re-run \`/hiveku-review\`.

STEP 1 — LOAD: Read \`.hiveku/review/index.json\`. For every page with \`openCount > 0\`, read its \`.hiveku/review/<slug>/annotations.json\`, shape:
\`{ version, page:{slug,pageUrl,screenshot,dom}, savedAt, annotations:[ {id, type:"rect"|"pin", region, comment, priority, annotationType, status:"open"|"resolved", resolvedAt, element:{matched, selector, tag, classes, text, hivekuId, hivekuSource:{file,line,column}, outerHTMLHead}} ] }\`.
Iterate the top-level \`annotations\` ARRAY and process ONLY entries whose \`status !== "resolved"\`. SKIP any already \`"resolved"\` — do not re-edit or re-stamp them (this keeps re-runs idempotent).

STEP 2 — SEE each OPEN annotation (status !== "resolved"): Read \`.hiveku/review/<slug>/screenshot.png\` (you can view PNGs). Use \`annotation.region\` (percent coords) for WHERE and \`annotation.comment\` for WHAT.

STEP 3 — LOCATE the source, in priority order:
  a. \`annotation.element.hivekuSource\` set → open that \`{file, line, column}\` directly.
  b. else \`annotation.element.hivekuId\` set → grep the project for that id / the rendered text.
  c. else structural → grep \`element.text\`, narrow by \`element.classes\` + \`element.tag\` + a token from \`element.outerHTMLHead\`. Confirm the match renders the thing in the screenshot region BEFORE editing.
  Use \`project_files_search\` / Grep over the local working tree (this folder IS the project).

STEP 4 — FIX: make the minimal edit that addresses the comment. One annotation → one located edit. If \`element.matched === false\`, rely on the region + screenshot.

STEP 5 — VERIFY before shipping: \`verify_typecheck\` / \`verify_lint\` (or local tsc/eslint). Do not ship unverified.

STEP 6 — MARK RESOLVED: In that page's \`annotations.json\`, set each FIXED annotation's \`status:"resolved"\` + \`resolvedAt:<ISO>\` and rewrite the file preserving every other field. Then update \`index.json\`: read the FULL file, find the row with the matching \`slug\`, and set \`annotationCount = annotations.length\`, \`openCount = count(status !== "resolved")\`, \`resolvedCount = count(status === "resolved")\`, keeping that row's other fields (slug, pageUrl, capturedAt, savedAt) AND every OTHER page row untouched. \`pages\` stays an ARRAY — never rewrite it as an object or drop sibling rows. Report a summary: per annotation — comment → file changed → status.

STEP 7 — Commit only if asked (branch first, never \`main\` directly), then \`/hiveku-deploy\` on explicit request (commit ≠ live). Use \`trash\` not \`rm\`; no emojis in code/copy.
`,
    'hiveku-pull': `---
description: Pull the latest version of this project from Hiveku into the local files.
allowed-tools: mcp__hiveku__project_vcs_checkout, mcp__hiveku__project_files_status, Read, Write
---
Pull the latest from Hiveku for THIS project. ${idLine}

1. Check drift first: \`project_files_status({ project_id: "${pid}", local: [{ path, sha256 }] })\` —
   note anything in \`only_remote\` / \`changed\` you didn't author.
2. Get latest: \`project_vcs_checkout({ project_id: "${pid}", branch: "main" })\` → write each returned file
   locally (base64-decode entries whose \`encoding\` is "base64").
3. If you have uncommitted local edits, reconcile first — don't overwrite your own work.
`,
    'hiveku-deploy': `---
description: Verify, then deploy this project to a Hiveku environment. Use to ship changes live.
argument-hint: "[development|staging|production]"
allowed-tools: mcp__hiveku__verify_typecheck, mcp__hiveku__verify_lint, mcp__hiveku__project_deploy_preflight, mcp__hiveku__deploy_site, mcp__hiveku__deploy_status, mcp__hiveku__preview_screenshot, mcp__hiveku__project_build_error_get, mcp__hiveku__preview_logs
---
Ship THIS project to **$ARGUMENTS** (default: development). ${idLine}

Do these IN ORDER and STOP on the first failure:
1. Verify: \`verify_typecheck({ project_id: "${pid}" })\` and \`verify_lint({ project_id: "${pid}" })\`. Fix errors before continuing.
2. Preflight: \`project_deploy_preflight({ project_id: "${pid}" })\`. Resolve any blockers.
3. Deploy: \`deploy_site({ project_id: "${pid}", environment: "$ARGUMENTS" })\` (use "development" if "$ARGUMENTS" is empty).
   Production is the slow, real path — only deploy production when explicitly asked.
4. Confirm: poll \`deploy_status\` until terminal, then \`preview_screenshot\` to eyeball the result.

If a build fails, call \`project_build_error_get\` + \`preview_logs\` to diagnose before retrying.
`,
    'hiveku-status': `---
description: Show this project's status — local vs Hiveku, recent deploys, and the live preview.
allowed-tools: mcp__hiveku__project_files_status, mcp__hiveku__deploy_history, mcp__hiveku__preview_overview
---
Report status for THIS project. ${idLine}

1. \`project_files_status({ project_id: "${pid}", local: [{ path, sha256 }] })\` → changed / only_local / only_remote (are you behind?).
2. \`deploy_history({ project_id: "${pid}" })\` → recent deploys + their status.
3. \`preview_overview({ project_id: "${pid}" })\` → the live Fly preview URL + state.

Summarize concisely.
`,
    'hiveku-verify': `---
description: Run Hiveku's checks (typecheck, lint, tests, build) for this project.
allowed-tools: mcp__hiveku__verify_typecheck, mcp__hiveku__verify_lint, mcp__hiveku__verify_run_tests, mcp__hiveku__project_test_build
---
Run all checks for THIS project and report results. ${idLine}

\`verify_typecheck({ project_id: "${pid}" })\`, \`verify_lint({ project_id: "${pid}" })\`,
\`verify_run_tests({ project_id: "${pid}" })\`, then \`project_test_build({ project_id: "${pid}", use_db_state: true })\`.
List every failure with the offending file/line so it can be fixed.
`,
    'hiveku-preview': `---
description: Open/refresh this project's live Fly preview and screenshot it.
argument-hint: "[path, default /]"
allowed-tools: mcp__hiveku__preview_overview, mcp__hiveku__preview_sync, mcp__hiveku__preview_screenshot
---
For THIS project, refresh + view the live preview. ${idLine}

If you just changed files, \`preview_sync({ project_id: "${pid}" })\` first. Then \`preview_overview({ project_id: "${pid}" })\`
for the URL and \`preview_screenshot({ project_id: "${pid}", path: "$ARGUMENTS" })\` (default "/") so we can see it.
`,
    'hiveku-browser': `---
description: Drive this project in a real browser with Playwright — local dev server or a deployed env.
argument-hint: "[path, default /]"
---
Browser-test THIS project via the \`playwright\` MCP. ${idLine}

1. Make sure the dev server is running (e.g. \`npm run dev\`); note the localhost port.
2. Use the playwright tools to navigate \`http://localhost:<port>$ARGUMENTS\` (default "/"),
   \`browser_snapshot\`/\`browser_take_screenshot\`, click through the key flows, and report any
   console or runtime errors. Fix, then re-run.
3. To check a DEPLOYED environment instead, resolve its URL and navigate there:
   \`project_get({ project_id: "${pid}" })\` → \`tiers.{development,staging,production}.url\`, and
   \`preview_overview({ project_id: "${pid}" })\` for the Live Preview (Fly). The same four URLs
   are the "Hiveku Browser" links in the VS Code sidebar (open externally).
`,
    'hiveku-logs': `---
description: Show build/deploy logs for an environment of this project (to debug a failed build).
argument-hint: "[preview|development|staging|production]"
allowed-tools: mcp__hiveku__project_build_error_get, mcp__hiveku__deploy_status, mcp__hiveku__deploy_get, mcp__hiveku__preview_logs, Read
---
Get build/deploy logs for THIS project's **$ARGUMENTS** environment (default development). ${idLine}

1. If \`.hiveku/logs/$ARGUMENTS.log\` exists (written by the VS Code "show logs" action), read it first —
   it's the exact log the user is looking at.
2. Otherwise fetch fresh:
   - Failed build → \`project_build_error_get({ project_id: "${pid}" })\` for the extracted real error.
   - Full tier build log → \`deploy_status({ project_id: "${pid}", environment: "$ARGUMENTS" })\` →
     take \`.most_recent.deployment_id\` → \`deploy_get({ project_id: "${pid}", deployment_id })\` → \`build_logs\`.
     If the filtered query returns no rows, retry WITHOUT \`environment\` — legacy deployments store
     other tokens (e.g. "cloudfront") and the filter misses them.
   - Live Preview (Fly) → \`preview_logs({ project_id: "${pid}" })\` (runtime; no build phase).
3. Summarize the failure and propose a concrete fix.
`,
    'hiveku-env': `---
description: Set up this site's environment secrets for local dev (pull from Hiveku), or add/change one.
argument-hint: "[nothing to set up local dev | a KEY to add/update]"
allowed-tools: mcp__hiveku__project_secrets_list, mcp__hiveku__project_files_search, Read
---
Manage THIS project's environment secrets. ${idLine} Secrets live in Hiveku (AWS Secrets Manager),
NOT in the code — real app keys (AWS, database URLs, Stripe, …) are here, injected into the deployed
Lambdas + Fly preview.

**See which secrets exist (names only — keeps values OUT of your context):**
\`project_secrets_list({ project_id: "${pid}", metadata_only: true })\` → { keys, count }. Do this to
learn what the app expects; do NOT fetch values you don't need.

**Get the site RUNNING locally:** the app reads \`.env.local\`; you don't need to read the values, just
have the file. Tell the user to run **"Hiveku: Pull Env to .env.local"** (Command Palette or the Source
Control menu) — it writes the dev-appropriate secrets to \`.env.local\` (gitignored, skips _PROD/_STAGING,
applies _DEV overrides). Then \`npm install\` + \`npm run dev\` and the app has its config. \`.env.local\` is
READ-DENIED to you on purpose — you can run the server without seeing the secret values.

**Add or change a secret ("$ARGUMENTS"):** either edit \`.env.local\` and have the user run **"Hiveku:
Push Env"**, or call \`project_secrets_set({ project_id: "${pid}", secrets: { KEY: value } })\` (this
CONFIRMS — it updates Hiveku + auto-syncs the deployed Lambdas). Naming: a plain \`KEY\` applies
everywhere; \`KEY_DEV\` overrides for local, \`KEY_PROD\` / \`KEY_STAGING\` scope to those tiers.

NEVER paste a secret value into code, a commit, memory, or a chat reply; never commit \`.env.local\`.
`,
    'hiveku-remember': `---
description: Persist what you learned/did into the right Hiveku department memory (source of truth).
argument-hint: "[department] [what you learned]"
allowed-tools: mcp__hiveku__memory_create, mcp__hiveku__memory_update, mcp__hiveku__memory_list, mcp__hiveku__list_departments
---
Record a learning to Hiveku so every department stays in sync. ${idLine}

1. Pick the right department (e.g. \`dev\`, \`marketing\`, \`sales\`, \`seo\`, \`helpdesk\`). \`list_departments\` if unsure.
2. Check for an existing entry to refine: \`memory_list({ domain: "<department>" })\`.
3. Write it: \`memory_create({ type: "memory", name: "<department>", content })\` — \`content\` is concise markdown:
   what you did, what you learned, why it matters, how to apply next time. On a 409 (already exists) use
   \`memory_update\` instead of duplicating.
The local \`memory/<dept>/\` files are only a mirror — Hiveku is the source of truth, and persisting here is
what brings the other departments + dashboard agents up to speed.
`,
    'hiveku-diagram': `---
description: Draw a Mermaid diagram of a flow/architecture/steps and (optionally) save it.
argument-hint: "[what to diagram]"
---
Explain "$ARGUMENTS" as a **Mermaid** diagram. ${idLine}

1. Pick the fitting type: \`flowchart TD\` (process/steps), \`sequenceDiagram\` (interactions over time),
   \`stateDiagram-v2\` (states), or \`erDiagram\` (data model).
2. Output a single \`\`\`mermaid fenced block that is syntactically valid and readable (short node labels).
3. If it's worth keeping, save it to \`docs/<slug>.md\` (renders on GitHub + Hiveku).
`,
    'hiveku-checkpoint': `---
description: Snapshot this project NOW (files + assets + DB) before a risky edit — one call to roll back to.
argument-hint: "[why — e.g. 'before refactor']"
allowed-tools: mcp__hiveku__checkpoint_create
---
Take a full-project checkpoint of THIS project BEFORE risky work (bulk edits, refactors, template
extraction, dependency bumps). ${idLine}

Call \`checkpoint_create({ project_id: "${pid}", description: "$ARGUMENTS" })\` — it captures every
current file, every asset, and (when configured) a database backup, and returns a \`checkpoint_hash\`.
Record that hash in your reply. To roll back later: \`/hiveku-restore\` (it is DESTRUCTIVE — see there).
This is the cheap insurance to take before anything you might need to undo wholesale.
`,
    'hiveku-history': `---
description: Show this project's version history — timeline, commits, checkpoints, and one file's versions.
argument-hint: "[a file path, to show that file's version history]"
allowed-tools: mcp__hiveku__project_version_log, mcp__hiveku__project_vcs_history, mcp__hiveku__checkpoint_list, mcp__hiveku__project_checkpoint_list, mcp__hiveku__project_file_versions, mcp__hiveku__project_file_diff
---
Show the history for THIS project (all read-only — nothing changes). ${idLine}

- If "$ARGUMENTS" is a FILE PATH: \`project_file_versions({ project_id: "${pid}", file_path: "$ARGUMENTS" })\`
  for that file's version trail (version_number, is_current, commit_message, created_at), then
  \`project_file_diff({ project_id: "${pid}", file_path: "$ARGUMENTS" })\` to see what changed in the latest.
- Otherwise show the PROJECT timeline: \`project_version_log({ project_id: "${pid}" })\` — one combined
  chronological feed of file edits, checkpoints, restores, and deploys ("what happened to this project").
  For just commits use \`project_vcs_history({ project_id: "${pid}" })\` (each has a \`checkpoint_hash\`);
  for snapshots use \`checkpoint_list\` (full checkpoints, incl. DB) and \`project_checkpoint_list\`
  (commit-tied checkpoints). Summarize the recent entries with their ids/hashes + timestamps so the
  user can pick one to restore or diff. Restoring is a separate step — \`/hiveku-restore\`.
`,
    'hiveku-restore': `---
description: Restore this project — one file, a whole checkpoint, or a point in time. Preview first, always.
argument-hint: "[what to restore — a file path, a checkpoint hash, or a time]"
allowed-tools: mcp__hiveku__project_file_versions, mcp__hiveku__project_file_restore, mcp__hiveku__checkpoint_list, mcp__hiveku__project_checkpoint_list, mcp__hiveku__project_checkpoint_restore_dry_run, mcp__hiveku__project_state_at, mcp__hiveku__history_list_preview_sessions, mcp__hiveku__history_preview_restore
---
Restore THIS project — pick the SMALLEST scope that fixes the problem, and PREVIEW before applying.
${idLine} Confirm the exact target with the user before any restore that overwrites files.

**One file (safest — NON-destructive):** \`project_file_versions({ project_id: "${pid}", file_path })\`
to find the version, then \`project_file_restore({ project_id: "${pid}", file_path, version_number })\`.
It writes the old content as a NEW version (history stays linear — nothing is lost). Add \`commit: true\`
to also push the restore. Prefer this whenever only a file or two regressed.

**Whole project to a checkpoint:** first DRY-RUN —
\`project_checkpoint_restore_dry_run({ project_id: "${pid}", checkpoint_hash })\` (from \`/hiveku-history\`)
shows exactly which files would add/update/stay. Then \`project_checkpoint_restore({ project_id: "${pid}",
checkpoint_hash })\` — same endpoint as \`checkpoint_restore\`. It is ADDITIVE about deletions (files
created SINCE the checkpoint are kept), but it OVERWRITES the content of every file in the checkpoint and
restores the database when the checkpoint captured one — so uncommitted edits to those files are lost.
Take \`/hiveku-checkpoint\` FIRST, then confirm the hash with the user.

**A point in time (no snapshot needed):** \`project_state_at({ project_id: "${pid}", as_of: "<ISO time>" })\`
reconstructs the file list read-only (dry run). To actually roll back to that moment use
\`history_restore_to_time({ project_id: "${pid}", as_of })\`.

**Inspect a restore without touching your working project:** \`history_preview_restore(...)\` spins up an
ISOLATED ephemeral preview app (canonical container untouched) and returns a \`preview_url\` to open;
\`history_list_preview_sessions\` lists them, \`history_cancel_preview_restore\` tears one down. Use this to
eyeball a checkpoint/PIT before committing to the real restore. After any restore, re-\`/hiveku-pull\` so
local files match, then \`/hiveku-verify\`.
`,
    'hiveku-redirects': `---
description: Manage this project's URL redirects — list, add, edit, remove, then deploy them.
argument-hint: "[what to do — e.g. 'add /old -> /new' or 'list']"
allowed-tools: mcp__hiveku__project_redirects_list, mcp__hiveku__project_redirect_create, mcp__hiveku__project_redirect_update, mcp__hiveku__project_redirect_delete, mcp__hiveku__project_redirects_deploy
---
Manage URL redirects for THIS project$ARGUMENTS. ${idLine}

1. ALWAYS list first: \`project_redirects_list({ project_id: "${pid}" })\` — show from_path → to_path,
   status_code, match_type, is_active, and each redirect's \`id\`.
2. Change as asked:
   - Add: \`project_redirect_create({ project_id: "${pid}", from_path, to_path, status_code: 301, match_type: "exact"|"prefix"|"regex", is_active: true, notes? })\`
     (301 = permanent, 302 = temporary; from_path is a site-relative path like \`/old-page\`).
   - Edit: \`project_redirect_update({ project_id: "${pid}", redirect_id, ...fields })\` (id from step 1).
   - Remove: \`project_redirect_delete({ project_id: "${pid}", redirect_id })\`.
3. DEPLOY to take effect (redirects are NOT live until deployed):
   \`project_redirects_deploy({ project_id: "${pid}", tier: "development"|"staging"|"production" })\`.
Confirm each create/update/delete with the user, and avoid redirect loops (never point a path at itself
or create A→B→A chains). After deploying to production, spot-check one redirect in a browser.
`,
    'hiveku-cms': `---
description: CRUD this project's CMS — collections, fields, and entries — then publish.
argument-hint: "[what to do — e.g. 'add a blog post' or 'list collections']"
allowed-tools: mcp__hiveku__cms_read_manifest, mcp__hiveku__cms_list_collections, mcp__hiveku__cms_field_types, mcp__hiveku__cms_list_entries, mcp__hiveku__cms_read_entry, mcp__hiveku__cms_search_entries, mcp__hiveku__cms_create_collection, mcp__hiveku__cms_delete_collection, mcp__hiveku__cms_add_field, mcp__hiveku__cms_update_field, mcp__hiveku__cms_remove_field, mcp__hiveku__cms_write_entry, mcp__hiveku__cms_delete_entry, mcp__hiveku__cms_bulk_import, mcp__hiveku__cms_promote_draft, mcp__hiveku__cms_list_entry_versions, mcp__hiveku__cms_restore_entry_version
---
Work on THIS project's CMS$ARGUMENTS. ${idLine} \`collection_id\` is the collection SLUG from the
manifest (e.g. \`blog\`), NOT a UUID.

1. ORIENT first: \`cms_read_manifest({ project_id: "${pid}" })\` (collections + their field schemas) or
   \`cms_list_collections({ project_id: "${pid}" })\`. To see entries:
   \`cms_list_entries({ project_id: "${pid}", collection_id, status? })\`; read one with
   \`cms_read_entry({ project_id: "${pid}", collection_id, slug })\`; find by text with \`cms_search_entries\`.
2. COLLECTIONS (schema): \`cms_create_collection({ project_id: "${pid}", id, name, path, format, fields })\`
   / \`cms_delete_collection\`. Fields: \`cms_add_field\` / \`cms_update_field\` / \`cms_remove_field\`
   (valid types from \`cms_field_types\`). Changing schema affects every entry — confirm first.
3. ENTRIES (content): \`cms_write_entry({ project_id: "${pid}", collection_id, slug, fields, status:
   "draft"|"published"|"scheduled", publish_at? })\` (upsert by slug). Bulk-create in ONE call with
   \`cms_bulk_import({ project_id: "${pid}", collection_id, items: [{ slug?, fields }] })\` — prefer this
   over many single writes. Delete: \`cms_delete_entry({ project_id: "${pid}", collection_id, slug })\`.
4. PUBLISH: a saved draft goes live via \`cms_promote_draft({ project_id: "${pid}", collection_id, slug,
   force? })\` (force overrides the 409 lost-update guard). Versioned — recover with
   \`cms_list_entry_versions\` → \`cms_restore_entry_version\`.
Write brand-aligned copy (read \`account_context_get\` / the account memory first), confirm destructive
changes, and after edits check the page in the browser or the live preview.
`,
    'hiveku-supabase': `---
description: Manage this project's Supabase backend — auth users, storage, edge functions, migrations, RLS, table rows.
argument-hint: "[what to do — e.g. 'list storage buckets' or 'add an auth user']"
allowed-tools: mcp__hiveku__supabase_auth_users_list, mcp__hiveku__supabase_auth_user_get, mcp__hiveku__supabase_auth_user_create, mcp__hiveku__supabase_auth_user_update, mcp__hiveku__supabase_auth_user_delete, mcp__hiveku__supabase_auth_config_get, mcp__hiveku__supabase_storage_list, mcp__hiveku__supabase_storage_objects_list, mcp__hiveku__supabase_storage_object_upload, mcp__hiveku__supabase_storage_object_signed_url, mcp__hiveku__supabase_edge_functions_list, mcp__hiveku__supabase_edge_functions_get_source, mcp__hiveku__supabase_edge_functions_deploy, mcp__hiveku__supabase_edge_functions_invoke, mcp__hiveku__supabase_migrations_list, mcp__hiveku__supabase_migration_apply, mcp__hiveku__supabase_policies_list, mcp__hiveku__supabase_policy_create, mcp__hiveku__supabase_table_rows_list, mcp__hiveku__supabase_table_row_insert, mcp__hiveku__supabase_table_row_update, mcp__hiveku__supabase_gen_types
---
Manage THIS project's Supabase backend$ARGUMENTS. ${idLine} Every call takes \`project_id: "${pid}"\`.
(Only for projects with a provisioned Supabase DB — \`database_status({ project_id })\` confirms.)

- AUTH: \`supabase_auth_users_list\` / \`supabase_auth_user_get\` / \`supabase_auth_user_create({ email, password, email_confirm })\` / \`supabase_auth_user_update\` / \`supabase_auth_user_delete\`; provider config via \`supabase_auth_config_get\` / \`supabase_configure_oauth\` / \`supabase_configure_smtp\`.
- STORAGE: \`supabase_storage_list\` (buckets) → \`supabase_storage_objects_list({ bucket, prefix })\`; upload \`supabase_storage_object_upload({ bucket, path, content, mime_type })\`; share \`supabase_storage_object_signed_url\`.
- EDGE FUNCTIONS: \`supabase_edge_functions_list\` → \`supabase_edge_functions_get_source\`; deploy \`supabase_edge_functions_deploy({ items: [{ slug, source }] })\`; secrets \`supabase_edge_functions_set_secrets\`; test \`supabase_edge_functions_invoke\`.
- SCHEMA/DATA: migrations \`supabase_migrations_list\` → \`supabase_migration_apply({ name, query })\` (DDL — the versioned way to change schema, NOT ad-hoc SQL). RLS \`supabase_policies_list({ schema, table })\` → \`supabase_policy_create({ table, name, command, using, check })\`. Rows \`supabase_table_rows_list\` / \`supabase_table_row_insert\` / \`_update\` / \`_delete\`. Regenerate app types after schema changes: \`supabase_gen_types\`.
CONFIRM every write; migrations + policy + auth changes affect real data — snapshot with /hiveku-checkpoint before anything risky.
`,
    'hiveku-domains': `---
description: Manage this project's custom domains — list, add (with DNS + SSL status), update, remove.
argument-hint: "[e.g. 'add www.example.com to production']"
allowed-tools: mcp__hiveku__project_domains_list, mcp__hiveku__project_domains_add, mcp__hiveku__project_domains_update, mcp__hiveku__project_domains_remove
---
Manage custom domains for THIS project$ARGUMENTS. ${idLine}

1. List first: \`project_domains_list({ project_id: "${pid}", tier? })\` — shows each domain, tier, is_primary, and SSL/verification status.
2. Add: \`project_domains_add({ project_id: "${pid}", domain, tier: "development"|"staging"|"production", is_primary? })\` — the response includes the DNS RECORDS the user must create at their registrar (A/CNAME) and the pending-SSL state. SURFACE those records verbatim so the user can set them; SSL provisions after DNS resolves.
3. \`project_domains_update\` (e.g. flip is_primary) / \`project_domains_remove({ project_id: "${pid}", domain? })\`.
Confirm add/remove; a domain isn't live until its DNS records resolve + SSL provisions. Tell the user to add the returned records, then re-run list to watch status flip to verified.
`,
    'hiveku-github': `---
description: GitHub sync for this project — status, branches, PRs, and per-tier auto-deploy branches.
argument-hint: "[e.g. 'open a PR from feature/x' or 'status']"
allowed-tools: mcp__hiveku__github_status, mcp__hiveku__github_branches_list, mcp__hiveku__github_branches_create, mcp__hiveku__github_commits, mcp__hiveku__github_compare, mcp__hiveku__github_pr_list, mcp__hiveku__github_pr_get, mcp__hiveku__github_pr_create, mcp__hiveku__github_pr_merge, mcp__hiveku__project_deployment_mode_get, mcp__hiveku__project_deployment_mode_set, mcp__hiveku__project_github_configure, mcp__hiveku__project_branch_switch
---
GitHub operations for THIS project$ARGUMENTS. ${idLine}

FIRST check this project is GitHub-connected: \`project_deployment_mode_get({ project_id: "${pid}" })\` (mode must be github_sync) and \`github_status({ project_id: "${pid}" })\`. If it's on Hiveku-native VCS instead, use /hiveku-commit — github_* won't apply.

- Branches: \`github_branches_list\` / \`github_branches_create({ branch_name, from_branch })\`; switch the working branch with \`project_branch_switch({ project_id: "${pid}", branch, commit_pending? })\`.
- Inspect: \`github_commits\`, \`github_compare\`.
- PRs: \`github_pr_list\` / \`github_pr_get\` / \`github_pr_create({ title, head, base, body_text })\` / \`github_pr_merge\` (confirm merges).
- Auto-deploy wiring: \`project_deployment_mode_set\` / \`project_github_configure({ github_dev_branch, github_staging_branch, github_production_branch, github_auto_deploy_* })\` — which branch auto-deploys to which tier.
CONFIRM merges + config changes with the user.
`,
    'hiveku-redesign': `---
description: Run this project's AI redesign pipeline — import an existing site's pages and rebuild them.
argument-hint: "[a source URL to import, optional]"
allowed-tools: mcp__hiveku__redesign_start, mcp__hiveku__redesign_status, mcp__hiveku__redesign_select_pages, mcp__hiveku__redesign_import, mcp__hiveku__redesign_homepage_approve, mcp__hiveku__redesign_promote, mcp__hiveku__redesign_restart, Read
---
Drive the redesign pipeline for THIS project$ARGUMENTS. ${idLine} Follow the ordered flow and check
\`redesign_status({ project_id: "${pid}" })\` between steps.

1. \`redesign_start({ project_id: "${pid}" })\` — begins the import (crawls the source site).
2. \`redesign_select_pages({ project_id: "${pid}" })\` — choose which discovered pages to rebuild.
3. \`redesign_import({ project_id: "${pid}" })\` — imports content/structure; it writes a brief to
   \`.hiveku/redesign/<slug>.json\` for you. READ that file, then rebuild those pages in the project's
   code (edit files, then /hiveku-commit).
4. \`redesign_homepage_approve\` once the homepage looks right, then \`redesign_promote({ project_id: "${pid}" })\` to make the redesign the live version.
\`redesign_restart\` starts over. Show the user progress after each step; this is multi-minute per stage.
`,
  };

  for (const [name, body] of Object.entries(commands)) {
    await writeAtomic(path.join(baseDir, '.claude', 'commands', `${name}.md`), body);
  }
}

/**
 * The `hiveku` MCP server entry for `.mcp.json`. The key is INLINED (not
 * `${OLYMPUS_API_KEY}`): Claude Code only expands `${VAR}` from the shell
 * environment — it does NOT auto-load a `.env` — so a placeholder would never
 * resolve when the user just opens the folder. We gitignore `.mcp.json` instead.
 */
export function hivekuMcpServer(apiKey: string, baseUrl: string): { type: string; url: string; headers: Record<string, string> } {
  return {
    type: 'http',
    url: `${baseUrl.replace(/\/+$/, '')}/mcp`,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

/**
 * The official Playwright MCP server (stdio) so Claude Code can drive a real
 * browser against the LOCAL code it runs (its dev server on localhost). Headless
 * by default; add "--headed" to the args to watch it in a separate OS window.
 * First use downloads @playwright/mcp + installs Chromium via its browser_install.
 */
export function playwrightMcpServer(): { command: string; args: string[] } {
  return { command: 'npx', args: ['-y', '@playwright/mcp@latest'] };
}

/**
 * Per-window identity for agency work: when many VS Code windows are open (one
 * per account), the window TITLE + a deterministic TITLE-BAR COLOR make each
 * account unmistakable at a glance. Merged non-destructively into the folder's
 * .vscode/settings.json — existing user settings win.
 */
export async function writeWindowIdentity(
  baseDir: string,
  accountLabel: string,
  accountId: string,
  projectName?: string,
  mode: PermissionMode = configuredPermissionMode,
): Promise<void> {
  const file = path.join(baseDir, '.vscode', 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    /* none yet */
  }
  // Set the title when absent, and UPDATE it when it's one of ours (starts with
  // "HIVEKU · ") — that's how account/project renames in Hiveku flow into the
  // window title on the next pull/scaffold. A user-customized title is never touched.
  const currentTitle = settings['window.title'];
  if (currentTitle === undefined || String(currentTitle).startsWith('HIVEKU · ')) {
    settings['window.title'] = projectName
      ? `HIVEKU · ${accountLabel} · ${projectName} — \${activeEditorShort}`
      : `HIVEKU · ${accountLabel} — \${activeEditorShort}`;
  }
  const color = accountColorHex(accountId);
  const cc = (settings['workbench.colorCustomizations'] as Record<string, unknown>) ?? {};
  if (cc['titleBar.activeBackground'] === undefined) {
    cc['titleBar.activeBackground'] = color;
    cc['titleBar.activeForeground'] = '#ffffff';
    cc['titleBar.inactiveBackground'] = color;
    cc['titleBar.inactiveForeground'] = '#ffffffb0';
    settings['workbench.colorCustomizations'] = cc;
  }
  // Hiveku folders are NOT git repos. Site projects version through Hiveku's own
  // VCS (the "Hiveku" Source Control panel + /hiveku-commit); account folders are
  // data/knowledge, not code. Turn off VS Code's built-in Git so it stops filling
  // the Source Control view with its "Initialize Repository / Publish to GitHub"
  // empty-state — which is misleading here and, if clicked, would push the whole
  // folder to GitHub. Only set when the user hasn't chosen; a dev who genuinely
  // wants Git can flip it back. The Hiveku SCM provider is unaffected by this.
  if (settings['git.enabled'] === undefined) settings['git.enabled'] = false;
  // Claude Code autonomy — WORKSPACE-SCOPED. The Claude Code VS Code extension
  // reads its OWN settings (not .claude/settings.json), and because these live in
  // THIS folder's .vscode/settings.json they apply only while this Hiveku
  // account/site is open — never the user's global settings. `initialPermissionMode`
  // is the mode new sessions start in; `bypassPermissions` ("skip prompts, incl.
  // bash/deploys") is hidden from the mode cycle unless allowDangerouslySkip is on.
  // `deny` rules in .claude/settings.json (e.g. .env*.local) still hard-block even
  // in bypass. We drive both keys from the hiveku.claudeCodePermissionMode setting.
  settings['claudeCode.initialPermissionMode'] = mode;
  if (mode === 'bypassPermissions') settings['claudeCode.allowDangerouslySkipPermissions'] = true;
  await writeAtomic(file, JSON.stringify(settings, null, 2) + '\n');
}

/** Deterministic title-bar color from the account id — same account = same color everywhere. */
export function accountColorHex(accountId: string): string {
  let h = 0;
  for (let i = 0; i < accountId.length; i++) h = (Math.imul(31, h) + accountId.charCodeAt(i)) | 0;
  const hue = ((h >>> 0) % 360 + 360) % 360;
  return hslToHex(hue, 45, 26); // dark enough that white text always reads
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = lig - sat * Math.min(lig, 1 - lig) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Add patterns to a `.gitignore` without clobbering existing rules. */
async function appendGitignore(baseDir: string, patterns: string[]): Promise<void> {
  const gi = path.join(baseDir, '.gitignore');
  let text = '';
  try {
    text = await fs.readFile(gi, 'utf8');
  } catch {
    /* no .gitignore yet */
  }
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = patterns.filter((p) => !have.has(p));
  if (missing.length === 0) return;
  const prefix = text && !text.endsWith('\n') ? '\n' : '';
  await fs.writeFile(gi, `${text}${prefix}${missing.join('\n')}\n`, 'utf8');
}

const HIVEKU_CLAUDE_MARKER = '<!-- hiveku:account-tools -->';

/** Append (or create) a CLAUDE.md section telling Claude it has the full account
 *  toolset here — non-destructive (preserves the site's own CLAUDE.md) + idempotent. */
async function appendHivekuSection(
  baseDir: string,
  accountLabel: string,
  mcpUrl: string,
  role?: string,
  connectedAs?: string,
): Promise<void> {
  const file = path.join(baseDir, 'CLAUDE.md');
  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    /* none yet */
  }
  const section = `${HIVEKU_CLAUDE_MARKER}
## Hiveku — full account control (via MCP)

This project's code lives in this folder AND you are wired to the Hiveku account
**${accountLabel}** through the \`hiveku\` MCP server (\`${mcpUrl}\`, in \`.mcp.json\`). So you can
operate EVERY department — not just edit code — and combine them in one task.

> **Confirm the account first.** Claude Code MCP scope is local > project > user, so a
> \`hiveku\` server elsewhere (e.g. in \`~/.claude.json\`) can silently shadow this project's
> \`.mcp.json\`. Before any account operation, call \`get_account_info\` once and verify it
> returns **${accountLabel}**. If it doesn't, you're on the wrong account — STOP and tell the
> user to run "Hiveku: Set Claude Code Account" (or remove the conflicting \`hiveku\` server).

- **Live operations:** CRM \`crm_*\`, SEO \`seo_*\`, email \`email_*\`, helpdesk
  \`helpdesk_*\`, social \`social_*\`, ads \`ppc_*\`, content \`content_*\`, automations \`workflow_*\`,
  projects/tasks \`pm_*\`, voice \`voice_*\`, knowledge \`memory_*\`. Read/act via the tools;
  \`hiveku_docs_search\` / \`hiveku_docs_get\` give exact names + args.
- **Local department data (for analysis):** if \`hiveku-data/\` exists, it holds a downloaded
  snapshot of this account's data (SEO rankings/keywords/backlinks, CRM deals/contacts, ads,
  social, content, email) as \`hiveku-data/<dept>/<dataset>.json\` — grep/analyze it like code.
  Each folder's README names the source MCP tool. It's a SNAPSHOT: to change anything, call the
  live tool; to refresh, run "Hiveku: Download Department Data" (or the Account Console). Absent
  until first downloaded.
- **Brand-perfect generative work:** \`talk_to_department({ domain, message })\` runs that
  department's server-side agent (full brand/memory/skills); persist the result with the matching tool.
- **This site's code** is these files. Edit them, then PUSH to Hiveku (below).

### Environment & secrets (how to run this site locally)
The app's real config — AWS keys, database URLs, Stripe, API tokens — lives in Hiveku (AWS Secrets
Manager), NOT in the code, and is injected into the deployed Lambdas + Fly preview. \`/hiveku-env\` wraps this.
- **See what the app expects (no values in your context):**
  \`project_secrets_list({ project_id, metadata_only: true })\` → just the KEY names. Use this to learn
  the shape; only fetch actual values when you truly must.
- **Run it locally:** the app loads \`.env.local\`. Have the user run **"Hiveku: Pull Env to .env.local"**
  — it writes the dev secrets (gitignored, skips _PROD/_STAGING, applies _DEV overrides). Then
  \`npm install\` && \`npm run dev\` and the app is configured. You do NOT need to read \`.env.local\` (it's
  read-denied to you on purpose) — \`npm run dev\` picks it up, so you can run + browser-test the site
  without ever seeing the secret values.
- **Add / change a secret:** \`project_secrets_set({ project_id, secrets: { KEY: value } })\` (confirms;
  auto-syncs deployed Lambdas), or edit \`.env.local\` and run **"Hiveku: Push Env"**. Naming: \`KEY\`
  everywhere, \`KEY_DEV\` local override, \`KEY_PROD\`/\`KEY_STAGING\` per tier.
- **Never** paste a secret value into code, a commit, memory, or a reply; never commit \`.env.local\`.

### Keep Hiveku in sync — it is the source of truth (memory + PM)
Hiveku, NOT your local files, is the system of record. After meaningful work, write back so every
department and the dashboard agents stay current — don't let what you learned or did live only on disk.
- **Department memory:** capture what you learned / did / decided into the RIGHT department's memory:
  \`memory_create({ type: "memory", name: "<department>", content })\` (\`name\` is the department/domain,
  e.g. \`"seo"\`, \`"marketing"\`, \`"dev"\`; \`content\` is markdown — what you did, what you learned, why it
  matters, how to apply next time). It returns 409 if it already exists → \`memory_update\` instead; check
  first with \`memory_list\`. The local \`memory/<dept>/*.md\` files are a MIRROR — persisting to Hiveku is
  what keeps all departments up to speed. \`/hiveku-remember\` wraps this.
### Work tracking — PM tasks are REQUIRED, and attributed to YOU (the authenticated user)
**If the work isn't documented in a PM task, it didn't happen.** This applies to EVERY department
(SEO, PPC, content, CRM, email, social, helpdesk, dev, bookkeeping, voice — everything), not just code.
Hiveku PM — not your head, this chat, or a local file — is the single source of truth for the team.

1. **You act on behalf of the authenticated user${connectedAs ? ` — \`${connectedAs}\`` : ''}.** Resolve them ONCE:
   call \`crm_list_users\`, take the member whose \`email\`${connectedAs ? ` is \`${connectedAs}\`` : ' matches the connected account owner'},
   and keep their \`id\` (USER_ID) and \`name\` (USER_NAME).${connectedAs ? '' : ' If you cannot tell who connected, ask the user before creating tasks.'}
   Tasks and comments are attributed to THEM — never to "olympus".
2. **CREATE a task when you START work:** \`pm_tasks_create({ project_id, title, description, assigned_to_id: USER_ID })\`
   — \`project_id\` from \`pm_projects_list\` (make one with \`pm_projects_create({ name, project_type })\` if the
   work has no home). The assignee MUST be USER_ID — never leave it blank.
3. **COMMENT as you go — comments are essential:** log the plan, decisions, progress, blockers, and the
   outcome with \`pm_tasks_comment({ id: <task_id>, content, author_codename: USER_NAME })\`. A task with no
   comments is NOT documented work; \`author_codename\` MUST be USER_NAME so the trail reads as that person.
4. **COMPLETE it when done:** \`pm_tasks_complete\`. Update status/priority via \`pm_tasks_update\`; list with \`pm_tasks_list\`.

### Diagrams (Mermaid)
When you explain a multi-step process, flow, or architecture, include a **Mermaid** diagram in a
\`\`\`mermaid fenced block (\`flowchart TD\`, \`sequenceDiagram\`, \`stateDiagram-v2\`, \`erDiagram\`) instead of a
wall of text. Save durable ones to \`docs/<slug>.md\` (they render on GitHub + Hiveku). \`/hiveku-diagram\`
scaffolds one.

### Pushing your edits to Hiveku, and pulling
You are editing a LOCAL MIRROR — edits here do NOT reach Hiveku until you commit. The project id
is in \`.hiveku/project.json\` (\`project_id\`).

**Push (save your edits to Hiveku):**
- Commit them: \`project_vcs_commit({ project_id, message, files: [{ path, content }], deletedFiles: [paths] })\`
  — pass the CURRENT contents of every file you changed (and list any deletions). One call = one
  versioned commit on \`main\`. (A human can instead click **Commit to Hiveku** in the Source Control
  panel — same result, and it also keeps the editor's "you're behind" baseline in sync.)
- Work off to the side: \`project_vcs_branch_create({ project_id, name })\`, commit with
  \`project_vcs_commit({ ..., branch: name })\`, preview live via \`project_vcs_branch_preview\`, then
  \`project_vcs_merge({ project_id, branch: name })\` (conflicts are flagged, never clobbered).
  On a conflict, merge returns \`conflicts: [paths]\` + \`conflict_details\` whose file content carries
  \`<<<<<<< / ======= / >>>>>>>\` markers — edit each file to keep the right lines, delete the markers,
  then commit the resolution.
- **Commit ≠ live.** Deploy with \`deploy_site({ project_id, environment: "development" | "staging" | "production" })\`.
  Saving/committing reaches the instant Fly preview, but the Lambda environments update ONLY on \`deploy_site\`.

**Pull (get the latest — do this before editing, and any time it may have changed remotely):**
- Check drift first: \`project_files_status({ project_id, local: [{ path, sha256 }] })\` → returns
  \`changed\` / \`only_local\` / \`only_remote\` (the "Check for Remote Changes" command wraps this).
- Get latest: \`project_vcs_checkout({ project_id, branch: "main" })\` → \`{ files: [{ path, content, encoding }] }\`
  → write them locally. Or a human runs **Pull Latest from Hiveku**. One file: \`project_file_get({ project_id, file_path })\`.
- **Do not clobber:** if status shows remote changes you did not make, PULL before committing —
  committing over them overwrites that work.

### Version history, checkpoints & restore (know this cold — it's your undo)
Hiveku keeps full server-side history for every project; you never lose old versions. There are FOUR
scopes, smallest-blast-radius first — always prefer the smallest that fixes the problem, and PREVIEW
before any restore that overwrites files. \`/hiveku-history\` reads it, \`/hiveku-checkpoint\` snapshots,
\`/hiveku-restore\` rolls back.

- **See what happened:** \`project_version_log({ project_id })\` = one timeline of edits + checkpoints +
  restores + deploys. \`project_vcs_history\` = commits (each with a \`checkpoint_hash\`). \`checkpoint_list\`
  = full snapshots (files+assets+DB); \`project_checkpoint_list\` = commit-tied checkpoints.
- **One file (NON-destructive, safest):** \`project_file_versions({ project_id, file_path })\` →
  \`project_file_diff\` (see the change) → \`project_file_restore({ project_id, file_path, version_number })\`.
  Restore writes the old content as a NEW version — linear history, nothing is destroyed. Use this when
  only a file or two regressed.
- **Snapshot BEFORE risky work:** \`checkpoint_create({ project_id, description })\` captures everything
  (files+assets+DB) and returns a hash. Do this before bulk edits/refactors so you have a one-call undo.
- **Whole project → checkpoint:** dry-run first (\`project_checkpoint_restore_dry_run\`), then
  \`project_checkpoint_restore\` (same endpoint as \`checkpoint_restore\`): it KEEPS files created since the
  checkpoint (additive about deletions) but OVERWRITES every checkpoint-tracked file and restores the DB
  when one was captured — uncommitted edits to those files are lost. \`checkpoint_create\` FIRST.
- **Point in time (no snapshot needed):** \`project_state_at({ project_id, as_of })\` reconstructs the state
  read-only; \`history_restore_to_time({ project_id, as_of })\` actually rolls back to that moment.
- **Inspect a restore safely:** \`history_preview_restore(...)\` spins up an ISOLATED ephemeral preview app
  (your working container is untouched) and returns a URL — eyeball a checkpoint/PIT before committing to it.
- After ANY restore: \`/hiveku-pull\` so local files match the new server state, then \`/hiveku-verify\`.

### Slash commands + verify (use these — they encode the right tool order)
- \`/hiveku-status\` — local-vs-Hiveku drift + recent deploys + preview.
- \`/hiveku-commit "msg"\` — commit your local edits to Hiveku.
- \`/hiveku-pull\` — pull latest into the local files.
- \`/hiveku-verify\` — typecheck + lint + tests + test-build.
- \`/hiveku-deploy [env]\` — verify → preflight → deploy → screenshot (verify is built in).
- \`/hiveku-preview [path]\` — sync + screenshot the live Fly preview.
- \`/hiveku-browser [path]\` — drive the app in a real browser (Playwright) — local dev or a deployed env.
- \`/hiveku-logs [env]\` — build/deploy logs for an environment (to debug a failed build).
- \`/hiveku-history [file?]\` — version timeline / commits / checkpoints (or one file's versions). Read-only.
- \`/hiveku-checkpoint "why"\` — full snapshot (files+assets+DB) BEFORE risky edits — your one-call undo.
- \`/hiveku-restore [target]\` — roll back one file / a checkpoint / a point in time. Previews first.
- \`/hiveku-env [key?]\` — set up this site's secrets for local dev (Pull Env → \`.env.local\`), or add/change one.
- \`/hiveku-redirects [what]\` — list/add/edit/remove URL redirects, then deploy them (301/302, exact/prefix/regex).
- \`/hiveku-cms [what]\` — CRUD the CMS: collections + fields + entries, then publish (drafts, bulk import, versions).
- \`/hiveku-domains [what]\` — list/add/remove custom domains; surfaces the DNS records + SSL status to set.
- \`/hiveku-supabase [what]\` — manage the Supabase backend: auth, storage, edge functions, migrations, RLS, rows.
- \`/hiveku-github [what]\` — GitHub-connected projects: status, branches, PRs, per-tier auto-deploy branches.
- \`/hiveku-redesign [url?]\` — run the AI redesign pipeline (import an existing site's pages and rebuild them).
- \`/hiveku-remember [dept] [learning]\` — persist what you learned into a department's Hiveku memory.
- \`/hiveku-diagram [what]\` — draw a Mermaid diagram of a flow/architecture.
**Always verify before you deploy** (\`verify_typecheck\` / \`verify_lint\` / \`verify_run_tests\` /
\`project_test_build\`); on a failed build read \`project_build_error_get\` + \`preview_logs\` to self-diagnose.

### Browser testing (Playwright)
You have the \`playwright\` MCP server (in \`.mcp.json\`) to drive a REAL browser against the LOCAL
code you're running:
1. Start this project's dev server (e.g. \`npm run dev\`) and note the localhost port.
2. Use the playwright tools (\`browser_navigate\`, \`browser_snapshot\`, \`browser_click\`,
   \`browser_fill_form\`, \`browser_take_screenshot\`) against \`http://localhost:<port>\` to exercise
   pages, verify UI, and catch console/runtime errors — fix, then re-run.
3. To check a DEPLOYED environment instead, get its URL from \`project_get\` (\`tiers.{development,
   staging,production}.url\`) or \`preview_overview\` (Live Preview / Fly) and navigate there.
Headless by default (a human can watch by adding \`--headed\` to the server's args). First run
installs Chromium via the MCP's \`browser_install\`. \`/hiveku-browser\` wraps this.

### Deploy / build logs (per environment)
To debug a failed build/deploy: read \`.hiveku/logs/<env>.log\` if present (written by the VS Code
"show logs" action so you and the user share it), else fetch fresh — \`project_build_error_get({
project_id })\` for the extracted real error, \`deploy_status\`→\`deploy_get\` for a tier's full
\`build_logs\`, or \`preview_logs\` for the running Fly preview. \`/hiveku-logs\` wraps this.

### Scheduling / loops / background work
For any "watch this", "every N minutes", "nightly", or "on a schedule" request, read
\`.claude/AUTOMATION.md\` — it picks the right primitive (\`/schedule\` cloud routine vs \`/loop\` vs a
background task), covers the headless-routine MCP gotcha, and has dev + marketing + sales + outbound
(Smartlead/HeyReach) patterns.

Cross-department in one go is the point — e.g. "fix the pricing page, commit + deploy, then update
the deal in CRM and schedule a launch email." Live tools for data; files + commit for code.
${MULTI_SESSION_BLOCK}${roleClaudeMdBlock(role)}`;
  // Refresh our section in place (keep any of the user's own CLAUDE.md content
  // that precedes it) so the guidance stays current on every pull.
  const idx = existing.indexOf(HIVEKU_CLAUDE_MARKER);
  const base = (idx >= 0 ? existing.slice(0, idx) : existing).replace(/\s+$/, '');
  const body = base ? `${base}\n\n${section}` : `# ${accountLabel} — Hiveku project\n\n${section}`;
  await writeAtomic(file, body);
}

/**
 * Wire a DOWNLOADED PROJECT folder so Claude Code there has the whole account's
 * tools (not just the code). Non-destructive: merges into any existing
 * `.mcp.json` / `.gitignore` / `CLAUDE.md` rather than overwriting the site's files.
 */
export async function writeProjectScaffold(opts: ScaffoldOptions): Promise<void> {
  if (!opts.connectedAs && opts.accountId) opts.connectedAs = connectedAsByAccount[opts.accountId];
  const mcpUrl = `${opts.baseUrl.replace(/\/+$/, '')}/mcp`;

  // 1) .mcp.json — merge the `hiveku` server in, preserving any servers already there.
  const mcpPath = path.join(opts.baseDir, '.mcp.json');
  let config: { mcpServers?: Record<string, unknown> } = {};
  try {
    config = JSON.parse(await fs.readFile(mcpPath, 'utf8')) as typeof config;
  } catch {
    /* no .mcp.json yet */
  }
  if (!config.mcpServers || typeof config.mcpServers !== 'object') config.mcpServers = {};
  config.mcpServers.hiveku = hivekuMcpServer(opts.apiKey, opts.baseUrl);
  // Playwright MCP so Claude Code can drive a real browser against the local dev
  // server. Don't clobber a user-customized entry (e.g. one with --headed).
  if (!config.mcpServers.playwright) config.mcpServers.playwright = playwrightMcpServer();
  await writeAtomic(mcpPath, JSON.stringify(config, null, 2) + '\n');

  // 2) .gitignore — the inlined key + any pulled env must never be committed.
  await appendGitignore(opts.baseDir, ['.mcp.json', '.env.local', '.env.hiveku', '.hiveku/', 'hiveku-data/']);

  // 3) CLAUDE.md — tell Claude it has the full account toolset (+ the user's role loop).
  await appendHivekuSection(opts.baseDir, opts.accountLabel, mcpUrl, opts.role, opts.connectedAs);

  // 4) Claude Code accelerators: a read-tool/safe-bash allowlist (fewer prompts +
  //    acceptEdits) and /hiveku-* slash commands for the common loop.
  await writeClaudeSettings(opts.baseDir, opts.permissionMode).catch(() => undefined);
  await writeSlashCommands(opts.baseDir, opts.projectId).catch(() => undefined);
  await writeRoleSlashCommands(opts.baseDir, opts.role).catch(() => undefined);
  await writeAgencySkills(opts.baseDir, opts.role).catch(() => undefined);
  await writeAutomationGuide(opts.baseDir).catch(() => undefined);
  if (opts.accountId) await writeWindowIdentity(opts.baseDir, opts.accountLabel, opts.accountId, opts.projectName, opts.permissionMode).catch(() => undefined);
}

/** Write the scheduling/loops/background playbook so Claude Code automates the right way. */
async function writeAutomationGuide(baseDir: string): Promise<void> {
  await writeAtomic(path.join(baseDir, '.claude', 'AUTOMATION.md'), AUTOMATION_GUIDE);
}

export async function writeScaffold(opts: ScaffoldOptions): Promise<void> {
  if (!opts.connectedAs && opts.accountId) opts.connectedAs = connectedAsByAccount[opts.accountId];
  const mcpUrl = `${opts.baseUrl.replace(/\/+$/, '')}/mcp`;
  const mcpJson = JSON.stringify({ mcpServers: { hiveku: hivekuMcpServer(opts.apiKey, opts.baseUrl) } }, null, 2) + '\n';

  const env = [
    '# Hiveku account credentials (gitignored). Used by .mcp.json.',
    `OLYMPUS_API_KEY=${opts.apiKey}`,
    `OLYMPUS_BASE_URL=${opts.baseUrl}`,
    '',
  ].join('\n');

  const claudeMd = `# ${opts.accountLabel} — Hiveku Account Workspace

This folder is a LOCAL MIRROR of one Hiveku account, set up for you (Claude Code)
to operate on. The Hiveku MCP server at \`${mcpUrl}\` is wired in \`.mcp.json\`
(key inlined; the file is gitignored), so you have the account's tools alongside
these local files.

## Folder layout (one account = this folder, under the Hiveku root)
\`\`\`
<hiveku-root>/<account>/     this folder
  sites/                     downloaded site projects (open each as its own workspace)
  hiveku-data/<dept>/        operational data snapshots (SEO, CRM, ads, ...) + SETUP.md per dept
  memory/ skills/ rules/     department knowledge (synced with Hiveku)
  automations/               local cron workers (free, run with VS Code closed)
  briefs/ reports/           scheduled briefs + monthly client reports
\`\`\`

## How to work here
- **Local files = context.** \`memory/\`, \`skills/\`, \`rules/\` (and \`commands/\`,
  \`agents/\`, \`identity/\`) are downloaded department knowledge. Read them FIRST —
  they are the authoritative copy as of the last download.
- **Local-first data loop.** Operational data (contacts, campaigns, rankings,
  tickets, ...) lives in \`hiveku-data/<dept>/*.json\` — pull/refresh it YOURSELF with
  \`node .hiveku/pull-data.mjs <dept ...>\` (or \`--stale 12\`, \`--list\`; see
  \`/hiveku-pull-data\`). READ from those files (fast, greppable, no tool calls);
  WRITE via the live MCP tools; after a write, re-pull that one dataset with
  \`--dataset <dept>:<id>\`. Check each file's \`fetched_at\` before trusting it.
- **MCP tools = actions + anything not exported.** Detail lookups, generative
  work (\`talk_to_department\`), and every mutation happen live.
- **Dashboard links are ACCOUNT-SCOPED — never fabricate them.** Every Hiveku dashboard URL is
  \`https://app.hiveku.com/${opts.accountId ?? '<account-id>'}/dashboard/<section>\` — the account id is
  REQUIRED (a bare \`/dashboard/...\` is wrong). Use ONLY these real sections; don't invent
  sub-paths: \`marketing/seo\`, \`marketing/ppc\`, \`marketing\`, \`crm\`, \`crm/connections\`, \`helpdesk\`,
  \`pm-projects\`, \`workflows\`, \`communications/integrations\`, \`settings/connectors\` (integrations live
  HERE, not "settings/integrations"), \`settings/oauth-apps\`, \`settings/team-members\`, \`settings/billing\`.
  If you're unsure a deeper path exists, link the section root and let the user navigate.
- **Chat a department** for strategy/generative work: \`talk_to_department({ domain, message })\`
  runs that department's agent with full memory/brand/skills — or use the Chat
  button in the Hiveku sidebar.

### Connecting integrations (Google Ads, GSC, GA, Bing) — use \`/hiveku-connect\`
Ad/SEO platforms are BYOK OAuth: one agency OAuth client (created once in Google Cloud / Azure) is
reused for EVERY account. \`/hiveku-connect [google-ads|gsc|ga|bing|all]\` runs the whole Hiveku side —
diagnose what is dead, register/reuse the shared OAuth app, mint the consent link, poll, sync, verify,
re-pull. You handle everything except the two things Google/Microsoft reserve for a human: the one-time
cloud app (redirect URI \`https://app.hiveku.com/api/oauth/google/callback\` in *Authorized redirect URIs*,
not JavaScript origins) and one consent click per account.
The shared client lives in \`../.env.locus.wide-access\` (fleet root) or this folder — keys:
GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN (from your agency MCC API
Center, Google Ads only) / MICROSOFT_ADS_CLIENT_ID / MICROSOFT_ADS_CLIENT_SECRET.
A dead connection ("Token refresh failed" / "Account has been deleted") = re-auth in place; it keeps the
campaign/keyword history. #1 stumble is \`redirect_uri_mismatch\` — the redirect URI is not on the exact
client in the setup_url (or landed in JavaScript origins, or was not Saved).

## Work tracking — PM tasks are REQUIRED, attributed to YOU (the authenticated user)
**If the work isn't documented in a PM task, it didn't happen.** This applies to EVERY department you
operate here (SEO, PPC, content, CRM, email, social, helpdesk, PM, voice, bookkeeping — everything).
Hiveku PM is the single source of truth for the whole team; never track work only in your head, this chat, or a file.

1. **You act on behalf of the authenticated user${opts.connectedAs ? ` — \`${opts.connectedAs}\`` : ''}.** Resolve them ONCE per
   session: \`crm_list_users\` → the member whose \`email\`${opts.connectedAs ? ` is \`${opts.connectedAs}\`` : ' matches the connected owner'} → keep their \`id\` (USER_ID) and \`name\`
   (USER_NAME).${opts.connectedAs ? '' : ' If you cannot tell who connected, ask the user before creating tasks.'} Tasks and comments are attributed to THEM, never to "olympus".
2. **CREATE a task when you START work:** \`pm_tasks_create({ project_id, title, description, assigned_to_id: USER_ID })\`
   — \`project_id\` from \`pm_projects_list\` (\`pm_projects_create({ name, project_type })\` if none fits). The
   assignee MUST be USER_ID — never leave it blank.
3. **COMMENT as you go — comments are essential:** log the plan, decisions, progress, blockers, and the
   outcome with \`pm_tasks_comment({ id: <task_id>, content, author_codename: USER_NAME })\`. A task with no
   comments is NOT documented work; \`author_codename\` MUST be USER_NAME so the trail reads as that person.
4. **COMPLETE it when done:** \`pm_tasks_complete\` (\`pm_tasks_update\` for status/priority; \`pm_tasks_list\` to see them).

## ⚠️ Sync awareness (check before trusting local files)
Read \`.hiveku/knowledge-status.json\` (written by "Hiveku: Check Knowledge Sync").
It reports, per knowledge item:
- \`changed_remote\` — updated on Hiveku since you pulled (local is STALE → re-download)
- \`new_remote\` — exists on Hiveku, not pulled yet
- \`deleted_remote\` — gone on Hiveku but still local
- \`locally_modified\` — you edited the local file (push via \`memory_update\` to persist)
If that file is missing or old, re-run the sync check or re-download from the sidebar.
Local memory files are read-only as far as Hiveku is concerned — persist changes with
\`memory_create\` / \`memory_update\` / \`memory_delete\`, then re-download.

## Folder layout
- \`memory/<dept>/\` \`skills/<dept>/\` \`rules/<dept>/\` — department knowledge (.md)
- \`commands/\` \`agents/\` \`identity/\` — other knowledge types
- \`projects/<slug>/\` — coder project source (each its own Hiveku VCS checkout; see below)
- \`.hiveku/knowledge-manifest.json\` / \`knowledge-status.json\` — sync state

## Departments — what's local, what to do live
| Department | Local knowledge | Live MCP tools | Chat domain |
| --- | --- | --- | --- |
| Marketing | memory/marketing | \`marketing_*\` \`brand_*\` \`avatar_*\` \`content_*\` | marketing |
| SEO | memory/seo | \`seo_*\` (audits, keywords, GSC, rankings, reports) | seo |
| PPC | memory/ppc | \`ppc_*\` (Google/Meta/Bing/TikTok campaigns) | ppc |
| Social | memory/social | \`social_*\` (posts, accounts, analytics) | social |
| Email | memory/email | \`email_*\` (campaigns, audiences, sequences) | (use tools) |
| Outbound | memory/outbound | \`outbound_*\`, \`crm_*\` sequences | outbound |
| Content | memory/content | \`content_*\`, \`marketing_content_*\` | content |
| Branding | memory/branding | \`brand_*\` | branding |
| Sales | memory/sales | \`crm_*\` (contacts, deals, pipelines, activities) | (use crm tools) |
| Helpdesk / KB | memory/knowledge_base | \`helpdesk_*\`, \`kb_*\` | knowledge_base |
| Workflow | memory/workflow | \`workflow_*\` | workflow |

Tool families: \`crm_* seo_* ppc_* email_* social_* helpdesk_* kb_* content_*\`
\`marketing_* brand_* avatar_* analytics_* memory_* workflow_* voice_* pm_*\`. Call
\`hiveku_docs_search\` / \`hiveku_docs_get\` to find exact tool names + arg shapes.

## Local department data + connecting integrations
Run "Hiveku: Download Department Data" (or the Account Console "Download data") to pull a
department's data into \`hiveku-data/<dept>/*.json\` (SEO rankings, ads keywords/search-terms, CRM,
workflows graphs, etc.) — grep/analyze it locally, act via the live tools. Each folder's README
names the source + CRUD tools.
**Setting up integrations** (Google Ads, Microsoft/Bing Ads, Google Business Profile, Search Console,
Bing Webmaster): download the **Ads (PPC)** or **Local SEO** department and read its \`SETUP.md\` —
it has the exact step-by-step (Google Ads connects via \`integration_oauth_initiate\` end-to-end;
Microsoft Ads via the dashboard; Bing Webmaster via \`integration_create\`).

## Coder projects — Hiveku VCS (git-like, no GitHub)
Projects under \`projects/<slug>/\` are version-controlled IN HIVEKU (Supabase-backed):
- \`project_vcs_commit\` — commit to \`main\` or a branch
- \`project_vcs_branch_create\` / \`project_vcs_checkout\` — branch + switch
- \`project_vcs_merge\` — line-level 3-way merge back to main (conflicts flagged)
- \`project_vcs_branch_preview\` — live Fly preview of a branch
- \`project_vcs_history\` / \`project_file_versions\` — history; \`deploy_site\` to ship
Or use the VS Code Source Control panel + the file Timeline (Hiveku version history).

## Automating — scheduled work, loops, background tasks
For ANY "do this on a schedule / repeatedly / in the background" request (daily digests, reply
triage, SEO refresh, outbound BDR cadence with Smartlead + HeyReach), read \`.claude/AUTOMATION.md\`
FIRST — it has the proper primitive for each case (\`/schedule\` cloud routine vs \`/loop\` vs a
background task), the Hiveku-headless-routine gotcha, and per-role patterns.

## Tenant scope
The key in \`.env\` is pinned to ONE Hiveku account. One folder = one account.
${MULTI_SESSION_BLOCK}${roleClaudeMdBlock(opts.role)}`;

  const gitignore = ['.mcp.json', '.env', '.env.local', '.hiveku/', 'hiveku-data/', ''].join('\n');

  await writeAtomic(path.join(opts.baseDir, '.mcp.json'), mcpJson);
  await writeAtomic(path.join(opts.baseDir, '.env'), env);
  await writeAtomic(path.join(opts.baseDir, 'CLAUDE.md'), claudeMd);
  await writeAtomic(path.join(opts.baseDir, '.gitignore'), gitignore);

  // Claude Code accelerators for the account workspace: the read-tool/safe-bash
  // allowlist (fewer prompts) + account-level /hiveku-* slash commands + the
  // user's role commands (/hiveku-daily and the role loops).
  await writeClaudeSettings(opts.baseDir, opts.permissionMode).catch(() => undefined);
  await writeAccountSlashCommands(opts.baseDir).catch(() => undefined);
  await writeRoleSlashCommands(opts.baseDir, opts.role).catch(() => undefined);
  await writeAgencySkills(opts.baseDir, opts.role).catch(() => undefined);
  await writeAutomationGuide(opts.baseDir).catch(() => undefined);
  // Local data runner: manifest + .hiveku/pull-data.mjs so Claude Code can pull/
  // refresh hiveku-data/ itself (no extension, no tokens on row data).
  await writeDataRunner(opts.baseDir, roleById(opts.role)?.deptIds).catch(() => undefined);
  if (opts.accountId) await writeWindowIdentity(opts.baseDir, opts.accountLabel, opts.accountId, undefined, opts.permissionMode).catch(() => undefined);
}

/** Account-workspace slash commands — operating departments (no code here). */
async function writeAccountSlashCommands(baseDir: string): Promise<void> {
  const commands: Record<string, string> = {
    'hiveku-automate': `---
description: Set up scheduled / recurring / background automation the proper way (digests, reply triage, outbound BDR cadence).
argument-hint: "<what to automate, e.g. 'hourly Smartlead reply triage into CRM'>"
allowed-tools: Read
---
Read \`.claude/AUTOMATION.md\` first, then help me automate: "$ARGUMENTS".
Pick the RIGHT primitive (\`/schedule\` cloud routine vs \`/loop\` vs a background task) per that guide's
decision table, mind the Hiveku-headless-routine gotcha (cloud routines don't get the gitignored
\`.mcp.json\` — add the Hiveku connector or use API keys in the routine env), pick an off-minute cron,
and make sends idempotent + rate-limit-safe. Propose the exact command to run, then set it up if I confirm.
`,
    'hiveku-brief': `---
description: Load this account's brand/context before any generative work. Run first each session.
argument-hint: "[domain, optional]"
allowed-tools: mcp__hiveku__account_context_get
---
Load account context FIRST (the MCP server requires this before generating copy/plans).
Call \`account_context_get({ domain: "$ARGUMENTS" })\` (omit domain to use the account default) and
summarize: identity/persona, brand voice, customer avatars, and the most relevant domain memory +
skills/rules. Keep this in mind for everything that follows.
`,
    'hiveku-chat': `---
description: Run a department's server-side agent (full brand/memory) for strategy or copy.
argument-hint: "<department> <message>"
allowed-tools: mcp__hiveku__talk_to_department
---
The first word of "$ARGUMENTS" is the department domain (e.g. sales, seo, ppc, social, content,
email, helpdesk, branding, marketing); the rest is the message.
Call \`talk_to_department({ domain: <first word>, message: <the rest> })\` and return its reply.
For generative work prefer this over writing copy yourself — it runs with full brand/memory/skills.
Then persist the result with the matching tool (e.g. content_create) if asked.
`,
    'hiveku-find': `---
description: Find the right Hiveku tool(s) for a task among the ~1,000 available.
argument-hint: "<what you want to do>"
allowed-tools: mcp__hiveku__hiveku_docs_search, mcp__hiveku__hiveku_docs_get
---
Find the exact Hiveku tool(s) for: "$ARGUMENTS".
Call \`hiveku_docs_search({ query: "$ARGUMENTS" })\` and list the top matches with their EXACT tool
names + key arguments, so they can be called directly (load schemas via ToolSearch select:<name>).
`,
    'hiveku-sync': `---
description: Check whether the local knowledge (memory/skills/rules) is stale vs Hiveku.
allowed-tools: Read, mcp__hiveku__memory_list
---
Report knowledge sync status for this account workspace.
First read \`.hiveku/knowledge-status.json\` (written by the "Check Knowledge Sync" command) and
summarize \`changed_remote\` / \`new_remote\` / \`deleted_remote\` / \`locally_modified\`. If it is
missing or stale, tell me to run "Hiveku: Check Knowledge Sync" (or re-download) from the sidebar
before trusting the local \`memory/\`, \`skills/\`, \`rules/\` files.
`,
  };
  for (const [name, body] of Object.entries(commands)) {
    await writeAtomic(path.join(baseDir, '.claude', 'commands', `${name}.md`), body);
  }
}

/**
 * Folder name for an account: `<name-slug>_<account-id>`. Including the account id
 * keeps it unambiguous (two clients can share a name) and visible, so the layout is
 *   <hiveku-root>/<name>_<account-id>/<project-slug>/   (+ hiveku-data/, .claude, …)
 */
export function slugForAccount(label: string, accountId: string): string {
  const name = safeSlug(label);
  // A short id suffix keeps same-named clients unambiguous without the full-UUID
  // eyesore (ctca-7f6bb2cf, not ctca_7f6bb2cf-a04e-4efa-afd0-db6dd3aafd79).
  const id = String(accountId || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  if (!id) return name || 'account';
  return `${name && name !== 'unnamed' ? name : 'account'}-${id}`;
}

export function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
