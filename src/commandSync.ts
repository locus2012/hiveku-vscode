/**
 * Sync ACCOUNT-DEFINED commands, skills + agents into Claude Code's own directories.
 *
 * Accounts define custom slash commands (`_command:<slug>`), skills
 * (`_skill:<slug>`, what an owner calls a playbook) and agent personas
 * (`_agent:<slug>`) in Hiveku (account_ai_memory). The knowledge sync already
 * downloads them into commands/<dept>/, skills/<dept>/ + agents/<dept>/ — but
 * Claude Code only discovers .claude/commands/, .claude/skills/ and
 * .claude/agents/. This module bridges that:
 *
 *   _command:<slug> → .claude/commands/hiveku-<dept>-<slug>.md
 *   _skill:<slug>   → .claude/skills/hiveku-<dept>-<slug>/SKILL.md
 *   _agent:<slug>   → .claude/agents/hiveku-<slug>.md
 *
 * <dept> is the agent that owns the entry (knowledge.ts departmentOf, the one
 * owner rule), or `shared` for an entry every agent follows. Skills were left
 * out until memory surfaces audit G13: a playbook kept in Hiveku never reached
 * Claude Code as a skill it could load.
 *
 * Ownership manifest (.hiveku/synced-commands.json) makes the sync safe:
 *   - only files listed there are ever touched or deleted,
 *   - remote deletion removes the local file (and a skill's emptied directory),
 *   - a locally-edited owned file is SKIPPED and reported (Hiveku is the source
 *     of truth — edit via memory_update, not the file),
 *   - identical-content local files (e.g. authored via /hiveku-new-command) are
 *     adopted into the manifest,
 *   - an owned path that differs from a remote path only in case is, on a
 *     case-insensitive disk, the same file: it keeps its ownership and is never
 *     deleted as gone upstream.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { type KnowledgeEntry, type KnowledgeIndex, departmentLabel, isInsideRoot, safeFileStem, selectEntries, SHARED_FOLDER } from './knowledge';
import { VENDORED_SKILL_NAMES } from './agencySkills';

const MANIFEST = path.join('.hiveku', 'synced-commands.json');

/**
 * A file under .claude/<dir>/. The "hiveku-" prefix already keeps every stem
 * off the Windows device names; safeFileStem is the backstop for any future
 * name shape, and a no-op for today's, so no synced path changes.
 */
function claudeFile(dir: 'commands' | 'agents', stem: string): string {
  return path.join('.claude', dir, `${safeFileStem(stem)}.md`);
}

/** A skill's SKILL.md under .claude/skills/<name>/. */
function claudeSkillFile(name: string): string {
  return path.join('.claude', 'skills', safeFileStem(name), 'SKILL.md');
}

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

/**
 * True when both paths exist and name the same file. On a case-insensitive
 * disk (the macOS and Windows default) two spellings that differ only in case
 * are one file; on a case-sensitive disk they are two.
 */
async function isSameFile(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([fs.lstat(a, { bigint: true }), fs.lstat(b, { bigint: true })]);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

function slugFromDomain(entry: KnowledgeEntry, prefix: '_command:' | '_agent:' | '_skill:'): string {
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

/**
 * The `<!-- department: x -->` line the agent servers put at the very top of
 * an entry. Above front matter it hides it: a file that does not start with
 * `---` has no front matter to Claude Code.
 */
const LEADING_MARKER_LINE = /^[ \t]*<!--[ \t]*department:[ \t]*[A-Za-z0-9_]+[ \t]*-->[ \t]*\r?\n/i;
const FRONT_MATTER_BLOCK = /^---\n[\s\S]*?\n---(?:\n|$)/;

/**
 * The entry with its front matter first when one leading marker line sits
 * above it (the marker then follows the front matter), or null when there is
 * no such line and front matter.
 */
function frontMatterFirst(content: string): string | null {
  const lead = content.match(LEADING_MARKER_LINE);
  if (!lead) return null;
  const rest = content.slice(lead[0].length);
  const fm = rest.match(FRONT_MATTER_BLOCK);
  if (!fm) return null;
  const head = fm[0].endsWith('\n') ? fm[0] : `${fm[0]}\n`;
  return `${head}${lead[0].trim()}\n${rest.slice(fm[0].length)}`.trimEnd();
}

/** Render a command entry: pass through existing frontmatter, else synthesize a description. */
function renderCommand(entry: KnowledgeEntry): string {
  const content = (entry.content || '').trim();
  if (content.startsWith('---')) return content + '\n';
  const reordered = frontMatterFirst(content);
  if (reordered) return reordered + '\n';
  const desc = String(entry.name || 'Account command').replace(/"/g, '\\"');
  return `---\ndescription: "${desc}"\n---\n${content}\n`;
}

/** Render an agent entry in Claude Code agent format (frontmatter + system prompt body). */
function renderAgent(entry: KnowledgeEntry, slug: string): string {
  const content = (entry.content || '').trim();
  if (content.startsWith('---')) return content + '\n';
  const reordered = frontMatterFirst(content);
  if (reordered) return reordered + '\n';
  const desc = String(entry.name || slug).replace(/"/g, '\\"');
  return `---\nname: hiveku-${slug}\ndescription: "${desc}"\n---\n${content}\n`;
}

/** Claude Code skill names: lowercase letters, digits and hyphens, at most 64 characters. */
const SKILL_NAME_MAX = 64;

/**
 * The skill directory (and `name`) for an account skill: hiveku-<dept>-<slug>,
 * hyphens only. A name longer than Claude Code allows, or one a vendored
 * methodology skill already uses, gets a short hash of the domain instead of
 * its tail, so two entries never share a directory.
 */
function skillName(dept: string, slug: string, domain: string): string {
  const base = `hiveku-${dept}-${slug}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/-+$/g, '');
  if (base.length <= SKILL_NAME_MAX && !VENDORED_SKILL_NAMES.includes(base)) return base;
  const hash = sha(domain).slice(0, 6);
  return `${base.slice(0, SKILL_NAME_MAX - hash.length - 1).replace(/-+$/g, '')}-${hash}`;
}

/** One line of text for a description: no line breaks, capped. */
function oneLine(text: string, max = 200): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** A one-line front matter value as written, quotes taken off ('' for a block scalar). */
function headerValue(header: string, key: string): string {
  const m = header.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'mi'));
  const value = m ? m[1].trim() : '';
  if (/^[>|][-+]?$/.test(value)) return '';
  return value.replace(/^(["'])(.*)\1$/, '$2').trim();
}

/**
 * Render a skill entry as Claude Code's SKILL.md: `name` (the directory) and a
 * `description` Claude Code decides from, naming the agent it belongs to. The
 * entry's other front matter keys are kept; its own `name` and `description`
 * lines (and their continuation lines) are replaced.
 */
function renderSkill(entry: KnowledgeEntry, name: string, dept: string, slug: string): string {
  const content = (entry.content || '').trim();
  const lead = content.match(LEADING_MARKER_LINE);
  const rest = lead ? content.slice(lead[0].length) : content;
  const fm = rest.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const header = fm ? fm[1] : '';
  const body = (fm ? rest.slice(fm[0].length) : rest).replace(/^\n+/, '');

  const kept: string[] = [];
  let skipping = false;
  for (const line of header.split('\n')) {
    if (/^(name|description)\s*:/i.test(line)) {
      skipping = true;
      continue;
    }
    // A continuation line (indented) belongs to the key above it.
    if (skipping && /^\s+\S/.test(line)) continue;
    skipping = false;
    if (line.trim()) kept.push(line);
  }

  const heading = body.match(/^#{1,6}\s+(.+)$/m)?.[1];
  const firstLine = body.split('\n').find((l) => l.trim() && !l.trim().startsWith('<!--'));
  const what = oneLine(headerValue(header, 'description') || heading || firstLine || entry.name || slug);
  const whose = dept === SHARED_FOLDER ? 'a skill every agent follows' : `${departmentLabel(dept)} skill`;
  const description = `${what} (${whose}, from Hiveku)`;

  const lines = ['---', `name: ${name}`, `description: ${JSON.stringify(description)}`, ...kept, '---'];
  if (lead) lines.push(lead[0].trim());
  lines.push(body);
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Sync account-defined commands/skills/agents from a fetched knowledge index
 * into .claude/ under baseDir. Never touches files it doesn't own (manifest).
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
    let rel = claudeFile('commands', `hiveku-${dept}-${slug}`);
    // Slug collision after normalization: suffix by domain hash.
    if (remote.has(rel)) rel = claudeFile('commands', `hiveku-${dept}-${slug}-${sha(entry.domain || slug).slice(0, 6)}`);
    remote.set(rel, { domain: entry.domain || `_command:${slug}`, body: renderCommand(entry) });
  }
  for (const entry of selectEntries(index, { type: 'skill' })) {
    const slug = slugFromDomain(entry, '_skill:');
    const dept = entry.department || 'general';
    const domain = entry.domain || `_skill:${slug}`;
    let name = skillName(dept, slug, domain);
    let rel = claudeSkillFile(name);
    if (remote.has(rel)) {
      name = skillName(dept, `${slug}-${sha(domain).slice(0, 6)}`, `${domain}#2`);
      rel = claudeSkillFile(name);
    }
    remote.set(rel, { domain, body: renderSkill(entry, name, dept, slug) });
  }
  for (const entry of selectEntries(index, { type: 'agent' })) {
    const slug = slugFromDomain(entry, '_agent:');
    let rel = claudeFile('agents', `hiveku-${slug}`);
    if (remote.has(rel)) rel = claudeFile('agents', `hiveku-${slug}-${sha(entry.domain || slug).slice(0, 6)}`);
    remote.set(rel, { domain: entry.domain || `_agent:${slug}`, body: renderAgent(entry, slug) });
  }

  // Remote paths by lowercase spelling, for the two case checks below.
  const remoteByFold = new Map<string, string>();
  for (const rel of remote.keys()) remoteByFold.set(rel.toLowerCase(), rel);

  // 0) Older builds kept a department tag's case, so an owned command can be
  // listed under a spelling that differs from its remote path only in case. On
  // a case-insensitive disk that is the same file: move its row to the remote
  // path, so step 1 updates it (or reports a local edit) as an owned file.
  for (const rel of Object.keys(manifest.files)) {
    if (remote.has(rel)) continue;
    const twin = remoteByFold.get(rel.toLowerCase());
    if (!twin || manifest.files[twin]) continue;
    if (await isSameFile(path.join(baseDir, rel), path.join(baseDir, twin))) {
      manifest.files[twin] = manifest.files[rel];
      delete manifest.files[rel];
    }
  }

  // 1) Write/update remote entries. The department in a file name is shaped by
  // departmentOf; the containment check is the backstop.
  for (const [rel, { domain, body }] of remote) {
    const abs = path.join(baseDir, rel);
    if (!isInsideRoot(baseDir, abs)) continue;
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
    // The manifest is a file in the folder (cloned, synced, or written by an
    // older build): it never directs a delete outside baseDir. Drop the row.
    if (!isInsideRoot(baseDir, abs)) {
      delete manifest.files[rel];
      continue;
    }
    // On a case-insensitive disk a spelling that differs from a remote path only
    // in case IS that remote file, which step 1 just wrote or kept. Deleting it
    // would remove a live command until the next sync. Drop the row only.
    const twin = remoteByFold.get(rel.toLowerCase());
    if (twin && (await isSameFile(abs, path.join(baseDir, twin)))) {
      delete manifest.files[rel];
      continue;
    }
    try {
      const current = await fs.readFile(abs, 'utf8');
      if (sha(current) === manifest.files[rel].content_sha) {
        await fs.rm(abs);
        result.removed.push(rel);
        // A skill is a directory: remove it too once its SKILL.md is gone and
        // nothing else is in it (rmdir refuses a directory that is not empty).
        if (path.basename(rel) === 'SKILL.md') await fs.rmdir(path.dirname(abs)).catch(() => undefined);
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
