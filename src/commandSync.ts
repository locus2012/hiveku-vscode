/**
 * Sync ACCOUNT-DEFINED commands + agents into Claude Code's own directories.
 *
 * Accounts define custom slash commands (`_command:<slug>`) and agent personas
 * (`_agent:<slug>`) in Hiveku (account_ai_memory). The knowledge sync already
 * downloads them into commands/<dept>/ + agents/<dept>/ — but Claude Code only
 * discovers .claude/commands/ and .claude/agents/. This module bridges that:
 *
 *   _command:<slug> → .claude/commands/hiveku-<dept>-<slug>.md
 *   _agent:<slug>   → .claude/agents/hiveku-<slug>.md
 *
 * Ownership manifest (.hiveku/synced-commands.json) makes the sync safe:
 *   - only files listed there are ever touched or deleted,
 *   - remote deletion removes the local file,
 *   - a locally-edited owned file is SKIPPED and reported (Hiveku is the source
 *     of truth — edit via memory_update, not the file),
 *   - identical-content local files (e.g. authored via /hiveku-new-command) are
 *     adopted into the manifest.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { type KnowledgeEntry, type KnowledgeIndex, selectEntries } from './knowledge';

const MANIFEST = path.join('.hiveku', 'synced-commands.json');

interface ManifestFile {
  files: Record<string, { domain: string; content_sha: string; synced_at: string }>;
}

export interface CommandSyncResult {
  written: string[];
  removed: string[];
  /** Owned files with local edits — left alone, surfaced to the user. */
  skippedLocalEdits: string[];
}

function sha(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function slugFromDomain(entry: KnowledgeEntry, prefix: '_command:' | '_agent:'): string {
  const d = entry.domain || '';
  if (d.startsWith(prefix)) {
    const s = d
      .slice(prefix.length)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (s) return s;
  }
  return (
    String(entry.name || 'unnamed')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'unnamed'
  );
}

/** Render a command entry: pass through existing frontmatter, else synthesize a description. */
function renderCommand(entry: KnowledgeEntry): string {
  const content = (entry.content || '').trim();
  if (content.startsWith('---')) return content + '\n';
  const desc = String(entry.name || 'Account command').replace(/"/g, '\\"');
  return `---\ndescription: "${desc}"\n---\n${content}\n`;
}

/** Render an agent entry in Claude Code agent format (frontmatter + system prompt body). */
function renderAgent(entry: KnowledgeEntry, slug: string): string {
  const content = (entry.content || '').trim();
  if (content.startsWith('---')) return content + '\n';
  const desc = String(entry.name || slug).replace(/"/g, '\\"');
  return `---\nname: hiveku-${slug}\ndescription: "${desc}"\n---\n${content}\n`;
}

/**
 * Sync account-defined commands/agents from a fetched knowledge index into
 * .claude/ under baseDir. Never touches files it doesn't own (manifest).
 */
export async function syncAccountCommands(index: KnowledgeIndex, baseDir: string): Promise<CommandSyncResult> {
  const manifestPath = path.join(baseDir, MANIFEST);
  let manifest: ManifestFile = { files: {} };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ManifestFile;
    if (!manifest.files || typeof manifest.files !== 'object') manifest = { files: {} };
  } catch {
    /* first sync */
  }

  const result: CommandSyncResult = { written: [], removed: [], skippedLocalEdits: [] };
  const now = new Date().toISOString();
  const remote = new Map<string, { domain: string; body: string }>(); // relPath → content

  for (const entry of selectEntries(index, { type: 'command' })) {
    const slug = slugFromDomain(entry, '_command:');
    const dept = entry.department || 'general';
    let rel = path.join('.claude', 'commands', `hiveku-${dept}-${slug}.md`);
    // Slug collision after normalization: suffix by domain hash.
    if (remote.has(rel)) rel = path.join('.claude', 'commands', `hiveku-${dept}-${slug}-${sha(entry.domain || slug).slice(0, 6)}.md`);
    remote.set(rel, { domain: entry.domain || `_command:${slug}`, body: renderCommand(entry) });
  }
  for (const entry of selectEntries(index, { type: 'agent' })) {
    const slug = slugFromDomain(entry, '_agent:');
    let rel = path.join('.claude', 'agents', `hiveku-${slug}.md`);
    if (remote.has(rel)) rel = path.join('.claude', 'agents', `hiveku-${slug}-${sha(entry.domain || slug).slice(0, 6)}.md`);
    remote.set(rel, { domain: entry.domain || `_agent:${slug}`, body: renderAgent(entry, slug) });
  }

  // 1) Write/update remote entries.
  for (const [rel, { domain, body }] of remote) {
    const abs = path.join(baseDir, rel);
    const owned = manifest.files[rel];
    let current: string | undefined;
    try {
      current = await fs.readFile(abs, 'utf8');
    } catch {
      /* not present */
    }
    if (current !== undefined) {
      if (current === body) {
        // In sync (or an identical locally-authored file) — adopt/refresh manifest.
        manifest.files[rel] = { domain, content_sha: sha(body), synced_at: owned?.synced_at ?? now };
        continue;
      }
      if (owned && sha(current) !== owned.content_sha) {
        // User edited an owned file — do not clobber; Hiveku is the source of truth.
        result.skippedLocalEdits.push(rel);
        continue;
      }
      if (!owned) {
        // A file we don't own exists at this path — never touch it.
        result.skippedLocalEdits.push(rel);
        continue;
      }
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
    manifest.files[rel] = { domain, content_sha: sha(body), synced_at: now };
    result.written.push(rel);
  }

  // 2) Remove owned files whose remote entry vanished.
  for (const rel of Object.keys(manifest.files)) {
    if (remote.has(rel)) continue;
    const abs = path.join(baseDir, rel);
    try {
      const current = await fs.readFile(abs, 'utf8');
      if (sha(current) === manifest.files[rel].content_sha) {
        await fs.rm(abs);
        result.removed.push(rel);
      } else {
        result.skippedLocalEdits.push(rel); // edited since sync — leave it, drop ownership
      }
    } catch {
      /* already gone */
    }
    delete manifest.files[rel];
  }

  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return result;
}
