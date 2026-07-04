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

async function readConfig(): Promise<ClaudeConfig> {
  try {
    const raw = await fs.readFile(claudeConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ClaudeConfig) : {};
  } catch {
    return {};
  }
}

/** Is there a local-scoped `hiveku` server for this folder (would shadow a .mcp.json)? */
export async function hasLocalHivekuServer(folderPath: string): Promise<boolean> {
  const cfg = await readConfig();
  return Boolean(cfg.projects?.[folderPath]?.mcpServers?.hiveku);
}

/** Is there a user-scoped (global) `hiveku` server? (Lowest precedence, but worth noting.) */
export async function hasUserHivekuServer(): Promise<boolean> {
  const cfg = await readConfig();
  return Boolean(cfg.mcpServers?.hiveku);
}

/**
 * Write the `hiveku` server at LOCAL scope for `folderPath` (in ~/.claude.json),
 * which beats any project `.mcp.json`. Read-modify-write — touches only
 * projects[folderPath].mcpServers.hiveku, preserving everything else.
 * Returns true if the file was written.
 */
export async function setLocalHivekuServer(folderPath: string, server: McpServerConfig): Promise<void> {
  const cfg = await readConfig();
  if (!cfg.projects || typeof cfg.projects !== 'object') cfg.projects = {};
  if (!cfg.projects[folderPath] || typeof cfg.projects[folderPath] !== 'object') cfg.projects[folderPath] = {};
  const entry = cfg.projects[folderPath];
  if (!entry.mcpServers || typeof entry.mcpServers !== 'object') entry.mcpServers = {};
  entry.mcpServers.hiveku = server;
  await writeAtomic(claudeConfigPath(), JSON.stringify(cfg, null, 2) + '\n');
}

/** Remove the local-scoped `hiveku` server for a folder (so a project .mcp.json wins). */
export async function removeLocalHivekuServer(folderPath: string): Promise<boolean> {
  const cfg = await readConfig();
  const servers = cfg.projects?.[folderPath]?.mcpServers;
  if (!servers || !servers.hiveku) return false;
  delete servers.hiveku;
  await writeAtomic(claudeConfigPath(), JSON.stringify(cfg, null, 2) + '\n');
  return true;
}
