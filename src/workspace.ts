/**
 * Local workspace helpers: walk the downloaded project, hash files for the
 * server-side diff, detect text-vs-binary for commits, and read/write the
 * `.hiveku/project.json` link file that ties a folder to a Hiveku project.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export const PROJECT_FILE = path.join('.hiveku', 'project.json');

/**
 * Names we never sync to Hiveku — build output, VCS internals, and the local-only
 * files the extension scaffolds. The last group is SECURITY-critical: `.mcp.json`
 * carries the inlined MCP key and `.env.local` the pulled secrets, so they must
 * never appear in the change set or get committed into the project's Hiveku files.
 * (walkFiles tests this against every entry name — files and directories alike.)
 */
export const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  '.expo',
  '.vercel',
  '.fly',
  '.hiveku',
  '.claude',
  '.mcp.json',
  '.env',
  '.env.local',
  '.env.hiveku',
  'hiveku-data',
]);

export interface ProjectLink {
  project_id: string;
  account_id: string;
  account_label: string;
  project_name: string;
  branch: string;
  base_url: string;
  last_pull_at?: string;
  last_commit_id?: string;
}

export interface ManifestEntry {
  path: string;
  sha256: string;
}

export function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Recursively list project-relative POSIX paths under `root`, skipping IGNORE_DIRS. */
export async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await recurse(full);
      } else if (entry.isFile()) {
        out.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }
  await recurse(root);
  return out;
}

/** Build a [{path, sha256}] manifest of the working tree for project_files_status. */
export async function buildManifest(root: string): Promise<ManifestEntry[]> {
  const files = await walkFiles(root);
  const manifest: ManifestEntry[] = [];
  for (const rel of files) {
    const buf = await fs.readFile(path.join(root, rel));
    const asUtf8 = buf.toString('utf8');
    // project_files_status tracks TEXT files only — the server skips binary
    // (__BINARY_BASE64__) rows. If we included binaries here they'd come back as
    // phantom "only_local" changes on every clean pull (assets download by
    // default), so skip them to match the server's text-only diff. Hash the
    // utf-8 view, exactly how the server hashes stored text content.
    if (asUtf8.includes('�')) continue;
    manifest.push({ path: rel, sha256: sha256(asUtf8) });
  }
  return manifest;
}

export interface CommitFile {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}

/**
 * Read a file for committing. Detects binary by attempting a utf-8 round-trip:
 * a U+FFFD replacement char means the bytes weren't valid utf-8, so we send
 * base64 (the same heuristic the hiveku-sync CLI and the builder editor use).
 */
export async function readFileForCommit(root: string, rel: string): Promise<CommitFile> {
  const data = await fs.readFile(path.join(root, rel));
  const asUtf8 = data.toString('utf8');
  if (asUtf8.includes('�')) {
    return { path: rel, content: data.toString('base64'), encoding: 'base64' };
  }
  return { path: rel, content: asUtf8, encoding: 'utf-8' };
}

const BINARY_SENTINEL = '__BINARY_BASE64__';

/**
 * Hash a local file the way the server hashes stored content, so branch diffs
 * line up: text → sha256(utf8); binary → sha256('__BINARY_BASE64__' + base64).
 */
export function storedHashOf(buf: Buffer): { encoding: 'utf-8' | 'base64'; hash: string } {
  const asUtf8 = buf.toString('utf8');
  if (asUtf8.includes('�')) {
    return { encoding: 'base64', hash: sha256(`${BINARY_SENTINEL}${buf.toString('base64')}`) };
  }
  return { encoding: 'utf-8', hash: sha256(asUtf8) };
}

/** Hash a branch-tree file (content+encoding) with the same stored convention. */
export function treeFileHash(content: string, encoding: 'utf-8' | 'base64'): string {
  return sha256(encoding === 'base64' ? `${BINARY_SENTINEL}${content}` : content);
}

/**
 * Mirror of the builder's asset-build-bypass.ts (resolveAssetBuildPath +
 * isCdnServableAsset): a file that resolves into a public/ SUBDIRECTORY is
 * served from the CDN/asset store on every deploy tier and is NOT bundled into
 * the build. So CDN-servable BINARY (image/font/video under public/<subdir>/)
 * belongs in the asset lane (assets_upload → builder_project_assets), NOT
 * builder_code_versions — otherwise it renders in the Fly preview but goes
 * missing on deploy. src/ assets and public/ ROOT files stay code-lane.
 * Keep this identical to the server rule or client/server disagree.
 */
export function isCdnServableAssetPath(filePath: string): boolean {
  const clean = filePath.replace(/^\//, '');
  const resolved =
    clean.startsWith('src/') || clean.startsWith('public/') ? clean : `public/${clean.replace(/^public\//, '')}`;
  return /^public\/[^/]+\//.test(resolved);
}

/**
 * Make the working tree exactly match a branch tree: write every tree file and
 * delete tracked local files that aren't in the tree. Used when switching
 * branches. Caller should guard against clobbering uncommitted work.
 */
export async function materializeTree(
  root: string,
  files: Array<{ path: string; content: string; encoding: 'utf-8' | 'base64' }>,
): Promise<void> {
  const want = new Set(files.map((f) => f.path));
  for (const f of files) {
    const abs = path.join(root, f.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const buf = f.encoding === 'base64' ? Buffer.from(f.content, 'base64') : Buffer.from(f.content, 'utf8');
    await fs.writeFile(abs, buf);
  }
  for (const rel of await walkFiles(root)) {
    if (!want.has(rel)) {
      await fs.rm(path.join(root, rel), { force: true }).catch(() => undefined);
    }
  }
}

// ── Baseline manifest: the remote state at the last pull/commit, used to
// detect when Hiveku has moved ahead of you (GitHub-style "you're behind"). ──
const BASE_MANIFEST = path.join('.hiveku', 'base-manifest.json');

export async function writeBaseManifest(root: string, entries: ManifestEntry[]): Promise<void> {
  await fs.mkdir(path.join(root, '.hiveku'), { recursive: true });
  await fs.writeFile(
    path.join(root, BASE_MANIFEST),
    JSON.stringify({ captured_at: new Date().toISOString(), files: entries }, null, 2),
    'utf8',
  );
}

export async function readBaseManifest(root: string): Promise<ManifestEntry[] | undefined> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, BASE_MANIFEST), 'utf8')) as {
      files?: ManifestEntry[];
    };
    return Array.isArray(raw.files) ? raw.files : undefined;
  } catch {
    return undefined;
  }
}

/** Record the current working tree as the baseline (call after pull/clone/commit). */
export async function captureBaseline(root: string): Promise<void> {
  await writeBaseManifest(root, await buildManifest(root));
}

export async function readProjectLink(root: string): Promise<ProjectLink | undefined> {
  try {
    const raw = await fs.readFile(path.join(root, PROJECT_FILE), 'utf8');
    return JSON.parse(raw) as ProjectLink;
  } catch {
    return undefined;
  }
}

export async function writeProjectLink(root: string, link: ProjectLink): Promise<void> {
  const dir = path.join(root, '.hiveku');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(root, PROJECT_FILE), JSON.stringify(link, null, 2), 'utf8');
}
