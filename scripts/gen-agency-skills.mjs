/**
 * Vendor the agency skills and social commands from the Claude Code plugin into
 * `assets/`, byte-for-byte.
 *
 *   source : ../hiveku-claude-plugin/skills/<name>/**   and   commands/<name>.md
 *   output : assets/skills/<name>/**                     and   assets/commands/<name>.md
 *   gate   : scripts/check-agency-skills-drift.mjs (runs in vscode:prepublish)
 *
 * WHY ASSETS AND NOT TYPESCRIPT LITERALS. Until 2026-09-03 the extension carried
 * its six agency skills as template literals in src/agencySkillsContent.ts -
 * 1,859 lines hand-pasted from the plugin's SKILL.md files, with no references/
 * directories and no drift check of any kind. By the time anyone looked, every
 * one of the six was older than the plugin's copy: the content skill lacked the
 * plugin's risky-request clause, the creative skill had the previous
 * description, and the social role had no social skill at all because nobody
 * had pasted one. A literal cannot be compared to its source without a human
 * reading both, so nothing ever was.
 *
 * Files can be. This script copies the plugin's files verbatim into assets/
 * (packaged by .vscodeignore, which ships everything except src/** and *.ts);
 * the compiled loader in src/agencySkills.ts reads them at runtime from
 * path.join(__dirname, '..', 'assets', ...) because out/*.js runs from out/.
 * The drift check then compares bytes, so a stale copy fails the publish
 * instead of shipping.
 *
 * The plugin is the SOURCE. Never edit assets/ by hand - edit the plugin and
 * re-run `npm run gen:skills`. The set of names lives in agency-skills-set.mjs.
 *
 * No `generated_at` stamp is emitted, for the same reason gen-dept-manifest.mjs
 * omits one: a timestamp makes every re-run a diff and defeats a byte-level
 * drift check.
 *
 * Exit codes: 0 done (even when some set members do not exist yet - those are
 * printed as NOTE and picked up on the next run); 2 when the plugin checkout is
 * absent, with nothing written. Override the checkout with HIVEKU_PLUGIN_PATH.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ASSETS_COMMANDS_DIR,
  ASSETS_DIR,
  ASSETS_SKILLS_DIR,
  VENDORED_SKILLS,
  actualFiles,
  describePluginLocation,
  expectedFiles,
  resolvePluginRoot,
} from './agency-skills-set.mjs';

const pluginRoot = resolvePluginRoot();
if (!pluginRoot) {
  console.error(
    `FAIL: plugin checkout not found at ${describePluginLocation()}.\n` +
      `  Nothing was written. Clone hiveku-claude-plugin beside this repo or set\n` +
      `  HIVEKU_PLUGIN_PATH to its checkout root, then re-run 'npm run gen:skills'.`,
  );
  process.exit(2);
}

const { files: expected, notes } = expectedFiles(pluginRoot);

// 1. Prune. assets/skills and assets/commands are owned by this generator; a
//    file the plugin no longer has (a renamed reference, a deleted command) must
//    leave the mirror too, or the drift check reports it forever. Only files
//    under those two directories are ever removed.
const pruned = [];
for (const rel of actualFiles()) {
  if (expected.has(rel)) continue;
  rmSync(join(ASSETS_DIR, rel), { force: true });
  pruned.push(rel);
}
// Drop directories the prune emptied (deepest first), so a removed skill does
// not leave an empty assets/skills/<name>/ behind for the loader to find.
const removeEmptyDirs = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const child = join(dir, name);
    if (statSync(child).isDirectory()) removeEmptyDirs(child);
  }
  if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
};
removeEmptyDirs(ASSETS_SKILLS_DIR);
removeEmptyDirs(ASSETS_COMMANDS_DIR);

// 2. Copy. Write only when the bytes differ so an unchanged re-run touches no
//    mtimes (and prints "unchanged", the same signal gen-dept-manifest.mjs gives).
let wrote = 0;
let unchanged = 0;
for (const [rel, src] of expected) {
  const dest = join(ASSETS_DIR, rel);
  const bytes = readFileSync(src);
  if (existsSync(dest) && readFileSync(dest).equals(bytes)) {
    unchanged++;
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  wrote++;
}

// 3. Report cross-skill links that leave the vendored set. A reference such as
//    hiveku-commerce-agency/references/shopify-connection.md resolves inside the
//    plugin but not inside a workspace that only received the vendored skills.
//    Report only: the fix is a plugin decision (widen the set, or reword the
//    link), not something a copier should make silently.
const LINK = /hiveku-[a-z-]+\/references\/[a-z0-9-]+\.md/g;
const outsideSet = [];
const broken = [];
for (const [rel, src] of expected) {
  const lines = readFileSync(src, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(LINK)) {
      const target = m[0];
      const skill = target.split('/')[0];
      const where = `${rel}:${i + 1} -> ${target}`;
      if (!VENDORED_SKILLS.includes(skill)) outsideSet.push(where);
      else if (!existsSync(join(pluginRoot, 'skills', target))) broken.push(where);
    }
  });
}

// 4. Summary.
const skillsVendored = VENDORED_SKILLS.filter((n) => existsSync(join(ASSETS_SKILLS_DIR, n, 'SKILL.md')));
const commandsVendored = [...expected.keys()].filter((r) => r.startsWith('commands/')).length;
console.log(
  `${wrote ? 'wrote' : 'unchanged'} ${ASSETS_DIR}\n` +
    `  source   : ${pluginRoot}\n` +
    `  skills   : ${skillsVendored.length}/${VENDORED_SKILLS.length} (${skillsVendored.join(', ')})\n` +
    `  commands : ${commandsVendored}\n` +
    `  files    : ${expected.size} (${wrote} written, ${unchanged} unchanged, ${pruned.length} pruned)`,
);
for (const rel of pruned) console.log(`  pruned   : ${rel}`);
for (const note of notes) console.log(`  NOTE: ${note}`);
if (outsideSet.length) {
  console.log(
    `\n  ${outsideSet.length} cross-skill link(s) leave the vendored set (report only - these\n` +
      `  resolve in the plugin but not in a workspace that received only these skills):`,
  );
  for (const w of [...new Set(outsideSet)]) console.log(`    - ${w}`);
}
if (broken.length) {
  console.log(`\n  ${broken.length} link(s) point at a reference the plugin does not have (report only):`);
  for (const w of [...new Set(broken)]) console.log(`    - ${w}`);
}
