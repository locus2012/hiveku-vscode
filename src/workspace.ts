/**
 * Local workspace helpers: walk the downloaded project, hash files for the
 * server-side diff, detect text-vs-binary for commits, and read/write the
 * `.hiveku/project.json` link file that ties a folder to a Hiveku project.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export const PROJECT_FILE = path.join('.hiveku', 'project.json');

/** Directories we never sync — build output, VCS internals, our own metadata. */
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
    // Hash the utf-8 view to match how the server hashes stored text content.
    manifest.push({ path: rel, sha256: sha256(buf.toString('utf8')) });
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
