/**
 * The VENDORED SET: which Claude Code plugin skills and commands this extension
 * ships as `assets/`, and where the plugin checkout is.
 *
 * Shared by scripts/gen-agency-skills.mjs (the copier) and
 * scripts/check-agency-skills-drift.mjs (the byte-drift gate) so the two can
 * never disagree about what "the set" is. If they held their own lists, the day
 * one gained a skill the other did not, the gate would either miss the new
 * files or flag them as foreign - and both failure modes look like "the check
 * is flaky" rather than "the lists diverged".
 *
 * Build-time only. Nothing here ships in the extension; the compiled loader in
 * src/ reads assets/ at runtime and carries its own copy of the role mapping.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_ROOT = join(here, '..');
export const ASSETS_DIR = join(EXTENSION_ROOT, 'assets');
export const ASSETS_SKILLS_DIR = join(ASSETS_DIR, 'skills');
export const ASSETS_COMMANDS_DIR = join(ASSETS_DIR, 'commands');

/**
 * Skills copied whole: `skills/<name>/SKILL.md` plus everything under
 * `skills/<name>/references/`. The plugin's doctrine lives in the references
 * (SKILL.md alone is a table of contents), so a SKILL.md-only copy is not a
 * copy of the skill.
 */
export const VENDORED_SKILLS = [
  'hiveku-seo-agency',
  'hiveku-ppc-agency',
  'hiveku-content-agency',
  'hiveku-sales-agency',
  'hiveku-outbound-agency',
  'hiveku-creative-agency',
  'hiveku-social-agency',
  // 2026-09-06: the web agency skill (the code lane and, in
  // references/webflow-sites.md, the Webflow-hosted site doctrine) for the
  // dev role.
  'hiveku-web-agency',
  // 2026-09-12: the communications skill (email infrastructure, the send
  // ladder, inbox, sequences) for the marketer role, alongside its two
  // commands below.
  'hiveku-communications',
  'hiveku-orient',
];

/**
 * Slash commands copied verbatim from `commands/<name>.md`. Several are still
 * being written in the plugin; a name that does not exist yet is skipped with a
 * NOTE and picked up by the next `npm run gen:skills`.
 */
export const VENDORED_COMMANDS = [
  'social-plan',
  'social-report',
  'engage',
  'social-onboard',
  'social-post',
  'repurpose',
  'social-calendar',
  'social-audit',
  'social-proof',
  'creative-brief',
  // 2026-09-10: the dev role's two site plays. webflow.md is the command the
  // vendored web-agency skill names (/hiveku:webflow) for a Webflow-hosted
  // site; cms.md is the account-level CMS play, covering the native CMS and
  // the Webflow provider seam. Written by DEV_COMMANDS in src/roleCommands.ts.
  'webflow',
  'cms',
  // 2026-09-12: the marketer role's email plays, previously carried as inline
  // literals in src/roleCommands.ts and stale within weeks (they named
  // email_domain_verify over check_dns and a total_sent field the tool does
  // not return). Written by MARKETER_COMMANDS in src/roleCommands.ts.
  'email',
  'email-review',
  // 2026-09-12: the expert interview the vendored content skill names
  // (/hiveku:sme-interview) for the marketer role - questions from the brief
  // and the proof pack, a transcript or a voice call into verbatim quotes
  // stored on the item as settings.sources[]. Written by MARKETER_COMMANDS in
  // src/roleCommands.ts.
  'sme-interview',
  // 2026-09-12: the elite content round B plays the vendored content skill
  // names for the marketer role - /hiveku:bofu (the bottom-funnel plan and
  // the sourced, dated comparison pages) and /hiveku:refresh (the decision
  // loop: the refresh queue, one of five dispositions per piece, a refresh
  // that keeps the URL). Written by MARKETER_COMMANDS in src/roleCommands.ts.
  'bofu',
  'refresh',
];

export const DEFAULT_PLUGIN_ROOT = join(EXTENSION_ROOT, '..', 'hiveku-claude-plugin');

const isPluginRoot = (dir) =>
  existsSync(join(dir, 'skills')) && existsSync(join(dir, 'commands'));

/**
 * Locate the plugin checkout. Returns null when it is absent so the caller can
 * decide between "exit 2, write nothing" (generator) and "SKIP" (checker).
 *
 * HIVEKU_PLUGIN_PATH may name the checkout root OR any path inside it -
 * check-dept-manifest-drift.mjs points the same variable at
 * lib/dept-manifest.json, and a value that works for one script must not make
 * the other silently SKIP. Walking up is only done for an explicit override;
 * the default location is checked as-is so a missing sibling never resolves
 * to some unrelated parent that happens to hold skills/ and commands/.
 */
export function resolvePluginRoot() {
  const override = process.env.HIVEKU_PLUGIN_PATH;
  if (!override) return isPluginRoot(DEFAULT_PLUGIN_ROOT) ? DEFAULT_PLUGIN_ROOT : null;
  let dir = resolve(override);
  for (;;) {
    if (isPluginRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const describePluginLocation = () =>
  process.env.HIVEKU_PLUGIN_PATH
    ? `${process.env.HIVEKU_PLUGIN_PATH} (HIVEKU_PLUGIN_PATH)`
    : DEFAULT_PLUGIN_ROOT;

/** Forward slashes on every platform so paths compare and print identically. */
export const toPosix = (p) => p.split(sep).join('/');

/**
 * Every regular file under `dir`, as sorted POSIX-relative paths. Dotfiles and
 * dot-directories (.DS_Store, .git) are skipped: they are never part of a skill
 * and would otherwise show up as drift on whichever side the OS wrote them.
 */
export function listFiles(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs).sort()) {
      if (name.startsWith('.')) continue;
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const st = statSync(childAbs);
      if (st.isDirectory()) walk(childAbs, childRel);
      else if (st.isFile()) out.push(childRel);
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out;
}

/**
 * The files the extension SHOULD hold, computed from the plugin checkout:
 *   Map<assetRelPath, pluginAbsPath>  e.g. 'skills/hiveku-orient/SKILL.md'
 * plus `notes` for set members the plugin does not (yet) have. Both scripts
 * derive their view of the world from this one function, which is what makes
 * "gen then check" a closed loop.
 */
export function expectedFiles(pluginRoot) {
  const files = new Map();
  const notes = [];
  for (const name of VENDORED_SKILLS) {
    const srcDir = join(pluginRoot, 'skills', name);
    if (!existsSync(join(srcDir, 'SKILL.md'))) {
      notes.push(`skill ${name} has no SKILL.md in the plugin - skipped`);
      continue;
    }
    for (const rel of listFiles(srcDir)) {
      files.set(`skills/${name}/${rel}`, join(srcDir, rel));
    }
  }
  for (const name of VENDORED_COMMANDS) {
    const src = join(pluginRoot, 'commands', `${name}.md`);
    if (!existsSync(src)) {
      notes.push(`command ${name}.md does not exist in the plugin yet - skipped`);
      continue;
    }
    files.set(`commands/${name}.md`, src);
  }
  return { files, notes };
}

/** Every file currently vendored, as sorted asset-relative POSIX paths. */
export function actualFiles() {
  return [
    ...listFiles(ASSETS_SKILLS_DIR).map((rel) => `skills/${rel}`),
    ...listFiles(ASSETS_COMMANDS_DIR).map((rel) => `commands/${rel}`),
  ];
}
