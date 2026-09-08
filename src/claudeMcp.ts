/**
 * Read/write the `hiveku` MCP server in Claude Code's config so Claude Code (in a
 * given workspace folder) talks to the account YOU choose — not whichever `hiveku`
 * server happens to win the scope race.
 *
 * Scope precedence in Claude Code is **local > project (.mcp.json) > user**, and a
 * same-named server is a silent override (no merge, no error). So:
 *   - The extension writes each downloaded project's account into that folder's
 *     `.mcp.json` (project scope). That works UNLESS a local-scoped `hiveku` for the
 *     same folder shadows it.
 *   - The "Set Claude Code Account" switcher writes the chosen account at **local
 *     scope** (in ~/.claude.json under the folder path), which beats any `.mcp.json`
 *     — guaranteeing the active account regardless of what else is configured.
 *
 * We never log or echo the key; it's written into the user's own ~/.claude.json
 * (the same file `claude mcp add -s local` writes), which already holds their creds.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/** Atomic write — temp file + rename — so a crash or a concurrent Claude Code
 *  read never sees a half-written ~/.claude.json. */
async function writeAtomic(file: string, contents: string): Promise<void> {
  const tmp = `${file}.hiveku-${process.pid}.tmp`;
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, file);
}

export interface McpServerConfig {
  type: string;
  url: string;
  headers: Record<string, string>;
}

function claudeConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

type ClaudeConfig = {
  mcpServers?: Record<string, unknown>;
  projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
};

/**
 * Tolerant read, for QUESTIONS about the file.
 *
 * `unreadable` distinguishes "the file says no" from "the file could not be
 * read" — collapsing those was how a corrupt config came to report, with
 * confidence, that no shadowing server existed.
 */
async function readConfigTolerant(): Promise<{ cfg: ClaudeConfig; unreadable: boolean }> {
  try {
    const raw = await fs.readFile(claudeConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { cfg: parsed && typeof parsed === 'object' ? (parsed as ClaudeConfig) : {}, unreadable: false };
  } catch (err) {
    // A missing file is a real, ordinary answer: there is no config yet.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { cfg: {}, unreadable: false };
    return { cfg: {}, unreadable: true };
  }
}

/**
 * Strict read, for MODIFYING the file.
 *
 * ★ Everything here is a read-MODIFY-WRITE over the user's entire
 * ~/.claude.json. The tolerant reader turns any failure into `{}` — a corrupt
 * or truncated file, EACCES, EISDIR — and the writer then atomically renames a
 * one-key object over the real file, destroying every other project's MCP
 * config and every unrelated setting in it. The function's own doc comment
 * promised the opposite ("preserving everything else").
 *
 * Only ENOENT may be swallowed: "no file yet" is the one failure where writing
 * a fresh object is correct. Anything else throws, and the caller reports it
 * rather than overwriting what it could not read.
 */
async function readConfigForWrite(): Promise<ClaudeConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(claudeConfigPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return {};
    throw new Error(
      `Could not read ${claudeConfigPath()} (${(err as Error).message}). Refusing to write it: ` +
      'this is a read-modify-write over your whole Claude Code config, and overwriting a file ' +
      'we could not read would discard every other project in it.',
    );
  }
  let parsed: unknown;
  try {
    // Note: JSON.parse('') throws a SyntaxError with no `.code`, so a
    // zero-byte file lands here rather than being mistaken for ENOENT.
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${claudeConfigPath()} is not valid JSON (${(err as Error).message}). Refusing to overwrite it — ` +
      'fix or move the file and try again; rewriting it here would discard every other project in it.',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `${claudeConfigPath()} does not contain a JSON object. Refusing to overwrite it.`,
    );
  }
  return parsed as ClaudeConfig;
}

/**
 * Is there a local-scoped `hiveku` server for this folder (would shadow a
 * .mcp.json)? `unreadable` means the question could not be answered — callers
 * must not render that as "no".
 */
export async function hasLocalHivekuServer(folderPath: string): Promise<boolean> {
  const { cfg } = await readConfigTolerant();
  return Boolean(cfg.projects?.[folderPath]?.mcpServers?.hiveku);
}

/** Is there a user-scoped (global) `hiveku` server? (Lowest precedence, but worth noting.) */
export async function hasUserHivekuServer(): Promise<boolean> {
  const { cfg } = await readConfigTolerant();
  return Boolean(cfg.mcpServers?.hiveku);
}

/**
 * Whether ~/.claude.json exists but could not be read or parsed. Reported by
 * the "Which Account Is This?" diagnostic, whose whole job is to explain this
 * file — it must say "could not read it", never imply it is empty.
 */
export async function claudeConfigUnreadable(): Promise<boolean> {
  const { unreadable } = await readConfigTolerant();
  return unreadable;
}

/**
 * Write the `hiveku` server at LOCAL scope for `folderPath` (in ~/.claude.json),
 * which beats any project `.mcp.json`. Read-modify-write — touches only
 * projects[folderPath].mcpServers.hiveku, preserving everything else.
 * Returns true if the file was written.
 */
export async function setLocalHivekuServer(folderPath: string, server: McpServerConfig): Promise<void> {
  const cfg = await readConfigForWrite();
  if (!cfg.projects || typeof cfg.projects !== 'object') cfg.projects = {};
  if (!cfg.projects[folderPath] || typeof cfg.projects[folderPath] !== 'object') cfg.projects[folderPath] = {};
  const entry = cfg.projects[folderPath];
  if (!entry.mcpServers || typeof entry.mcpServers !== 'object') entry.mcpServers = {};
  entry.mcpServers.hiveku = server;
  await writeAtomic(claudeConfigPath(), JSON.stringify(cfg, null, 2) + '\n');
}

/** Remove the local-scoped `hiveku` server for a folder (so a project .mcp.json wins). */
export async function removeLocalHivekuServer(folderPath: string): Promise<boolean> {
  const cfg = await readConfigForWrite();
  const servers = cfg.projects?.[folderPath]?.mcpServers;
  if (!servers || !servers.hiveku) return false;
  delete servers.hiveku;
  await writeAtomic(claudeConfigPath(), JSON.stringify(cfg, null, 2) + '\n');
  return true;
}
