/**
 * The vendored agency skills and commands must be byte-identical to the plugin.
 *
 *   source : hiveku-claude-plugin/skills/<name>/**  and  commands/<name>.md
 *   mirror : hiveku-vscode/assets/skills/**         and  assets/commands/*.md
 *   copier : scripts/gen-agency-skills.mjs
 *
 * WHY. The previous carrier for these skills - template literals in
 * src/agencySkillsContent.ts - had no check, and all six were stale before
 * anyone noticed (see the header of gen-agency-skills.mjs). A vendored copy is
 * only better than a pasted literal if something fails when it goes stale.
 * This is that something, and it runs in vscode:prepublish so a stale copy
 * cannot ship.
 *
 * Compares BYTES, file by file, in both directions, and prints the exact path
 * of every difference: a file that differs, a plugin file missing from assets/,
 * and a file in assets/ the plugin does not have (or that is outside the
 * vendored set). "assets differ" is not actionable across eighty files.
 *
 * Exit codes: 0 clean, 1 drift, 0 with SKIP when the plugin checkout is absent
 * (a repo cloned on its own must still pass CI; the committed assets/ are then
 * what ships). The one thing that fails even without the checkout is an empty
 * assets/skills/ - that means nothing was vendored at all, and publishing
 * would ship an extension whose roles receive no skills.
 *
 * Usage:  node scripts/check-agency-skills-drift.mjs
 * Override the checkout with HIVEKU_PLUGIN_PATH (root or any path inside it).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSETS_DIR,
  ASSETS_SKILLS_DIR,
  VENDORED_SKILLS,
  actualFiles,
  describePluginLocation,
  expectedFiles,
  resolvePluginRoot,
} from './agency-skills-set.mjs';

const vendoredSkills = VENDORED_SKILLS.filter((n) => existsSync(join(ASSETS_SKILLS_DIR, n, 'SKILL.md')));
if (vendoredSkills.length === 0) {
  console.error(
    `FAIL: nothing is vendored - ${ASSETS_SKILLS_DIR} holds none of the ${VENDORED_SKILLS.length} skills.\n` +
      `  Run 'npm run gen:skills' on a machine with the hiveku-claude-plugin checkout and commit assets/.`,
  );
  process.exit(1);
}

const pluginRoot = resolvePluginRoot();
if (!pluginRoot) {
  // A missing sibling checkout is not drift - this has to pass in CI for a repo
  // cloned on its own. The presence check above already ran.
  console.log(`SKIP: plugin checkout not found at ${describePluginLocation()} (sibling checkout absent)`);
  process.exit(0);
}

const { files: expected, notes } = expectedFiles(pluginRoot);
const actual = actualFiles();
const diffs = [];

for (const [rel, src] of expected) {
  const dest = join(ASSETS_DIR, rel);
  if (!existsSync(dest)) {
    diffs.push(`${rel}: MISSING in assets/ (plugin has it)`);
    continue;
  }
  if (!readFileSync(src).equals(readFileSync(dest))) {
    const a = readFileSync(src).length;
    const b = readFileSync(dest).length;
    diffs.push(`${rel}: DIFFERS (plugin ${a} bytes, assets ${b} bytes)`);
  }
}
for (const rel of actual) {
  if (!expected.has(rel)) {
    diffs.push(`${rel}: EXTRA in assets/ (not in the plugin, or outside the vendored set)`);
  }
}

if (diffs.length === 0) {
  const commands = [...expected.keys()].filter((r) => r.startsWith('commands/')).length;
  console.log(
    `OK: vendored agency skills identical to the plugin ` +
      `(${vendoredSkills.length} skills, ${commands} commands, ${expected.size} files)`,
  );
  for (const note of notes) console.log(`  NOTE: ${note}`);
  process.exit(0);
}

console.error(`FAIL: the vendored agency skills have drifted from the plugin.\n`);
for (const d of diffs) console.error(`  - ${d}`);
console.error(
  `\n  ${diffs.length} difference(s).\n` +
    `  source : ${pluginRoot}\n  mirror : ${ASSETS_DIR}\n\n` +
    `  Fix: the plugin is the source. Edit it there if the content is wrong, then run\n` +
    `  'npm run gen:skills' here and commit assets/. Never edit assets/ by hand.`,
);
process.exit(1);
