/**
 * Codex (OpenAI) support — scaffold the Codex-native equivalents of the Claude
 * Code artifacts so an account/project folder works identically from the Codex
 * CLI, the Codex VS Code extension (openai.chatgpt), and the ChatGPT desktop
 * app (all three read the same files). Opt-in via the `hiveku.codexSupport`
 * setting or the "Hiveku: Set Up Codex Support" command.
 *
 * Mapping (verified against the mid-2026 Codex docs):
 *   CLAUDE.md                 → AGENTS.md (lean pointer + load-bearing rules;
 *                               Codex concatenates AGENTS.md files with a 32KiB
 *                               cap, so the full guide stays in CLAUDE.md and
 *                               AGENTS.md instructs reading it)
 *   .mcp.json (per-folder key) → <folder>/.codex/config.toml [mcp_servers.*]
 *                               (project-scoped since 2026; TRUST-GATED — the
 *                               user must accept Codex's "trust this project?"
 *                               prompt once, or we pre-trust with consent)
 *   .claude/commands/*.md      → .agents/skills/<name>/SKILL.md (repo-scoped;
 *                               Codex prompts are global-only + deprecated)
 *   .claude/settings.json      → NO per-project equivalent (Codex ignores
 *   permissions                  approval/sandbox keys in repo config — a repo
 *                               can't grant itself permissions). The essentials
 *                               are stated as INSTRUCTIONS in AGENTS.md instead.
 *
 * Everything here is merge-safe: existing user content is preserved; our
 * regions are delimited by markers and only those regions are rewritten.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/** Marker pair for the Hiveku-managed region inside AGENTS.md. */
const AGENTS_BEGIN = '<!-- hiveku:begin -->';
const AGENTS_END = '<!-- hiveku:end -->';
/** Marker pair for the Hiveku-managed region inside .codex/config.toml. */
const TOML_BEGIN = '# hiveku:begin (managed by the Hiveku VS Code extension — do not edit inside)';
const TOML_END = '# hiveku:end';

export interface CodexScaffoldOptions {
  baseDir: string;
  apiKey: string;
  baseUrl: string;
  accountLabel: string;
  accountId: string;
  /** 'account' = an account workspace folder; 'project' = a downloaded site project. */
  kind: 'account' | 'project';
  projectName?: string;
}

/** Replace (or append) the marked region inside existing content. */
function upsertMarkedRegion(existing: string, begin: string, end: string, region: string): string {
  const b = existing.indexOf(begin);
  const e = existing.indexOf(end);
  if (b !== -1 && e !== -1 && e > b) {
    return existing.slice(0, b) + region + existing.slice(e + end.length);
  }
  const sep = existing.length && !existing.endsWith('\n\n') ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
  return existing + sep + region + '\n';
}

/**
 * AGENTS.md — lean on purpose (Codex caps the concatenated instruction chain at
 * ~32KiB): identity + the non-negotiable rules + "read CLAUDE.md". The full
 * account guide lives in CLAUDE.md, which Codex reads on instruction.
 */
function agentsMdRegion(opts: CodexScaffoldOptions): string {
  const scope = opts.kind === 'project' ? `the "${opts.projectName ?? 'site'}" project of ` : '';
  return `${AGENTS_BEGIN}
# Hiveku — ${opts.accountLabel}

This folder is ${scope}ONE Hiveku account (${opts.accountLabel}). Its MCP server \`hiveku\`
(configured in \`.codex/config.toml\`) carries this folder's account API key — never operate a
different account from here.

**FIRST ACTION every session: read \`CLAUDE.md\` in this folder.** It is the full operating guide
(written for Claude Code, applies to you identically): account tools, department data, site
push/deploy flows, integration connect links, media generation, and the work-tracking rules.
Ignore only its Claude-specific file paths (\`.claude/*\`) — your equivalents are
\`.agents/skills/*\` (same commands, invoked as \`$hiveku-...\` skills) and this file.

Non-negotiables (also in CLAUDE.md, restated because they are load-bearing):
- Verify identity before ANY write: \`get_account_info\` must return THIS account.
- **You are NOT the only writer.** Other agents and people push to these same projects while you work.
  Check what is current BEFORE you start (\`project_version_log\`) and AGAIN before you push
  (\`project_files_status\` — \`changed\` = they edited it, \`only_remote\` = they added files you lack).
  Before any tree-replace (\`delete_missing: true\`), \`dry_run\` first and read the would-delete list: a
  file you did not send may be someone else's NEW work, not a leftover. Never blind-overwrite.
- **Keep ALL scratch work in \`.hiveku/tmp/\`.** This machine runs many account folders at once, so
  \`/tmp\` is shared ground — two accounts writing \`/tmp/site.tar.gz\` overwrite each other and leak
  across sessions. Never write temp files to \`/tmp\`, your home dir, or the repo root; never touch
  another account's folder.
- **Never ingest local agent config into a project.** \`.codex/config.toml\` and \`.mcp.json\` carry THIS
  account's API key inlined, and \`.env*\` carry secrets — exclude them from every tar/push (the server
  refuses them too). Secrets belong in \`project_secrets_*\`, never in project code.
- **PM tasks are required** — create one when you start work, comment as you go, complete it when
  done, all attributed to the authenticated user (resolve via \`crm_list_users\`).
- **Every completed task ends with an "Owner update"** — 2–4 calm, plain-language sentences a busy
  owner can skim: benefit first, no alarm vocabulary, no self-blaming narration, accurate.
- Never read or print \`.env.local\` / \`.env.*.local\` contents.
- Video generation is paid + capped — \`marketing_generate_video\` with \`dry_run: true\` first.
${AGENTS_END}`;
}

/** The [mcp_servers.*] region for <folder>/.codex/config.toml. */
function codexTomlRegion(opts: CodexScaffoldOptions): string {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/mcp`;
  return `${TOML_BEGIN}
[mcp_servers.hiveku]
url = "${url}"
http_headers = { "Authorization" = "Bearer ${opts.apiKey}" }

[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest"]
${TOML_END}`;
}

/** Write/refresh AGENTS.md + .codex/config.toml for one folder. */
export async function writeCodexScaffold(opts: CodexScaffoldOptions): Promise<void> {
  // AGENTS.md (marker-managed; user content outside the markers is preserved)
  const agentsPath = path.join(opts.baseDir, 'AGENTS.md');
  let agents = '';
  try {
    agents = await fs.readFile(agentsPath, 'utf8');
  } catch {
    /* new file */
  }
  await fs.writeFile(agentsPath, upsertMarkedRegion(agents, AGENTS_BEGIN, AGENTS_END, agentsMdRegion(opts)), 'utf8');

  // .codex/config.toml (marker-managed region; the rest of the user's project
  // config is untouched). NOTE: repo-level approval/sandbox keys are IGNORED by
  // Codex — only MCP/hooks/instructions can ship in the repo.
  const tomlPath = path.join(opts.baseDir, '.codex', 'config.toml');
  let toml = '';
  try {
    toml = await fs.readFile(tomlPath, 'utf8');
  } catch {
    /* new file */
  }
  await fs.mkdir(path.dirname(tomlPath), { recursive: true });
  await fs.writeFile(tomlPath, upsertMarkedRegion(toml, TOML_BEGIN, TOML_END, codexTomlRegion(opts)), 'utf8');

  // Keep the key out of git the same way .mcp.json is handled.
  await appendGitignoreLines(opts.baseDir, ['.codex/config.toml']);

  // Mirror slash commands → repo-scoped Codex skills.
  await mirrorCommandsToSkills(opts.baseDir);
}

/** Add lines to .gitignore when missing (non-destructive). */
async function appendGitignoreLines(baseDir: string, lines: string[]): Promise<void> {
  const giPath = path.join(baseDir, '.gitignore');
  let gi = '';
  try {
    gi = await fs.readFile(giPath, 'utf8');
  } catch {
    /* new file */
  }
  const have = new Set(gi.split('\n').map((l) => l.trim()));
  const missing = lines.filter((l) => !have.has(l));
  if (missing.length === 0) return;
  const sep = gi.length && !gi.endsWith('\n') ? '\n' : '';
  await fs.writeFile(giPath, gi + sep + missing.join('\n') + '\n', 'utf8');
}

/**
 * Mirror every .claude/commands/*.md slash command into a repo-scoped Codex
 * skill at .agents/skills/<name>/SKILL.md. Codex discovers these in all three
 * surfaces and invokes them as `$<name>` (or implicitly by description).
 * Idempotent: skills we wrote are refreshed; a skill dir without our stamp is
 * left alone (user-authored).
 */
export async function mirrorCommandsToSkills(baseDir: string): Promise<number> {
  const commandsDir = path.join(baseDir, '.claude', 'commands');
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(commandsDir)).filter((f) => f.endsWith('.md'));
  } catch {
    return 0; // no commands scaffolded yet
  }
  const STAMP = '<!-- generated-by: hiveku-vscode (mirrored from .claude/commands) -->';
  let written = 0;
  for (const file of entries) {
    const name = file.replace(/\.md$/, '');
    const src = await fs.readFile(path.join(commandsDir, file), 'utf8');

    // Pull description out of the command's YAML frontmatter; strip
    // Claude-specific keys (allowed-tools/argument-hint) from the body.
    let description = `Hiveku ${name} command`;
    let body = src;
    const fm = src.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fm) {
      const d = fm[1].match(/^description:\s*(.+)$/m);
      if (d) description = d[1].trim().replace(/^["']|["']$/g, '');
      body = src.slice(fm[0].length);
    }
    // Codex skills take free-text arguments after `$<name>`; translate the
    // Claude $ARGUMENTS placeholder.
    body = body.replace(/\$ARGUMENTS/g, '(the arguments the user gave after the skill name)');

    const skillDir = path.join(baseDir, '.agents', 'skills', name);
    const skillPath = path.join(skillDir, 'SKILL.md');
    try {
      const existing = await fs.readFile(skillPath, 'utf8');
      if (!existing.includes(STAMP)) continue; // user-authored skill — never clobber
    } catch {
      /* new skill */
    }
    await fs.mkdir(skillDir, { recursive: true });
    const skill = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n${STAMP}\n\n${body.trimStart()}`;
    await fs.writeFile(skillPath, skill, 'utf8');
    written += 1;
  }
  return written;
}

/**
 * Pre-trust a folder in the USER-GLOBAL ~/.codex/config.toml so its repo-level
 * .codex/config.toml (which carries the MCP server + key) loads without Codex's
 * first-run trust prompt. This crosses a security boundary, so callers MUST get
 * explicit user consent first (the setup command does).
 */
export async function preTrustFolder(baseDir: string): Promise<'added' | 'already'> {
  const cfgPath = path.join(os.homedir(), '.codex', 'config.toml');
  let cfg = '';
  try {
    cfg = await fs.readFile(cfgPath, 'utf8');
  } catch {
    /* no global config yet */
  }
  const abs = path.resolve(baseDir);
  const header = `[projects."${abs}"]`;
  if (cfg.includes(header)) return 'already';
  await fs.mkdir(path.dirname(cfgPath), { recursive: true });
  const sep = cfg.length && !cfg.endsWith('\n') ? '\n' : '';
  await fs.writeFile(cfgPath, `${cfg}${sep}\n${header}\ntrust_level = "trusted"\n`, 'utf8');
  return 'added';
}
