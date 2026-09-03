/**
 * Agency-methodology SKILLS for Claude Code - the depth layer above slash
 * commands. Each skill is a full engagement methodology for one revenue
 * discipline (research, strategy, execution plays with exact tool chains,
 * weekly cadence, monthly reporting, benchmarks and pitfalls), written to
 * `.claude/skills/<name>/` - SKILL.md plus everything under references/.
 * Claude Code lazy-loads them when relevant, so their size costs nothing until
 * used.
 *
 * The bodies are NOT typed here. They are vendored byte-for-byte from the
 * Claude Code plugin (../hiveku-claude-plugin/skills/<name>/**) into
 * `assets/skills/` by `npm run gen:skills`, and `npm run check:skills` (part of
 * vscode:prepublish) fails when the copy drifts. The previous design - six
 * skill bodies as template literals in src/agencySkillsContent.ts - drifted
 * from the plugin within days and had no check; a generator plus a byte gate is
 * the pattern that has held (see scripts/gen-dept-manifest.mjs for the first).
 *
 * SKILL.md alone is a table of contents; the doctrine lives in references/, so
 * a SKILL.md-only copy is not a copy of the skill. This loader writes the whole
 * directory.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { RoleId } from './roles';

/**
 * The vendored set. SOURCE OF TRUTH: scripts/agency-skills-set.mjs
 * (VENDORED_SKILLS). That ESM file drives the generator and the drift gate; the
 * compiled CommonJS loader cannot import it (it lives outside tsconfig's
 * rootDir, and the extension host's Node cannot require() an ES module), so the
 * eight names are duplicated here. Keep the two lists identical: a name listed
 * here that the generator does not copy is warned about and skipped at write
 * time; a name listed there but missing here is vendored yet never written and
 * never cleaned up on a role switch.
 */
const VENDORED_SKILLS = [
  'hiveku-seo-agency',
  'hiveku-ppc-agency',
  'hiveku-content-agency',
  'hiveku-sales-agency',
  'hiveku-outbound-agency',
  'hiveku-creative-agency',
  'hiveku-social-agency',
  'hiveku-orient',
] as const;

type VendoredSkill = (typeof VENDORED_SKILLS)[number];

/**
 * How to operate a Hiveku account safely from Claude Code - which account you
 * are on, the you-are-not-the-only-writer rule, the approval rails. Every role
 * receives it; it is not a discipline, so it is appended rather than listed.
 */
const ORIENT: VendoredSkill = 'hiveku-orient';

/** Compiled output runs from out/, so assets/ is one level up from __dirname. */
const ASSETS_SKILLS_DIR = path.join(__dirname, '..', 'assets', 'skills');

/**
 * Which agency skills each role receives, BEFORE `hiveku-orient` is appended
 * (skillsForRole adds it for every role). Typed over RoleId so adding a role
 * to roles.ts without deciding its skills is a compile error.
 */
const ROLE_SKILLS: Record<RoleId, VendoredSkill[]> = {
  // SEO carries the outbound skill too: the link-building play hands its target
  // list to an outbound campaign (see "Backlink outreach campaigns").
  seo: ['hiveku-seo-agency', 'hiveku-outbound-agency'],
  ppc: ['hiveku-ppc-agency'],
  dev: [],
  bookkeeper: [],
  pm: [],
  // Marketer carries social too: the content calendar it runs is what the
  // social plays repurpose, and the same person usually owns both.
  marketer: ['hiveku-content-agency', 'hiveku-seo-agency', 'hiveku-creative-agency', 'hiveku-social-agency'],
  sales: ['hiveku-sales-agency'],
  outbound: ['hiveku-outbound-agency', 'hiveku-sales-agency'],
  helpdesk: [],
  // Social keeps content (its references/repurpose.md carries the content-side
  // ladder the social plays start from) and creative (the designer handoff).
  social: ['hiveku-social-agency', 'hiveku-content-agency', 'hiveku-creative-agency'],
  // Designer carries content too: campaign creative briefs, captions, and the
  // editorial calendar the visuals serve live in the content methodology.
  designer: ['hiveku-creative-agency', 'hiveku-content-agency'],
  owner: VENDORED_SKILLS.filter((name) => name !== ORIENT),
};

const isKnownRole = (roleId: string): roleId is RoleId =>
  Object.prototype.hasOwnProperty.call(ROLE_SKILLS, roleId);

/** The skills a role receives, `hiveku-orient` last. Unknown or missing role: none. */
export function skillsForRole(roleId: string | undefined): string[] {
  if (!roleId || !isKnownRole(roleId)) return [];
  return [...ROLE_SKILLS[roleId], ORIENT];
}

type SkillFile = { rel: string; bytes: Buffer };

/**
 * Every regular file under `dir` as [POSIX-relative path, bytes], sorted.
 * Dotfiles and dot-directories are skipped - they are never part of a skill
 * (.DS_Store on the build machine must not reach a workspace).
 */
async function readTree(dir: string, rel = ''): Promise<SkillFile[]> {
  const out: SkillFile[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const childAbs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await readTree(childAbs, childRel)));
    else if (entry.isFile()) out.push({ rel: childRel, bytes: await fs.readFile(childAbs) });
  }
  return out;
}

/**
 * The vendored files of one skill, or null when the asset is missing or has no
 * SKILL.md. Never throws: a broken build must not take the scaffold down with
 * it, and the caller reports only the skills it actually wrote.
 */
async function loadVendoredSkill(name: VendoredSkill): Promise<SkillFile[] | null> {
  const dir = path.join(ASSETS_SKILLS_DIR, name);
  try {
    const files = await readTree(dir);
    if (!files.some((file) => file.rel === 'SKILL.md')) {
      console.warn(`[hiveku] vendored skill ${name} has no SKILL.md under ${dir} - skipped (run npm run gen:skills)`);
      return null;
    }
    return files;
  } catch (err) {
    console.warn(`[hiveku] vendored skill ${name} could not be read from ${dir} - skipped (run npm run gen:skills): ${String(err)}`);
    return null;
  }
}

/**
 * Write the role's agency skills into <baseDir>/.claude/skills/, removing the
 * vendored skills a previous role received and this one does not. Cleanup is
 * exact-name over VENDORED_SKILLS only, so a user-authored skill directory
 * beside them survives every role switch. Returns the names actually written
 * (a skill whose asset is missing is warned about, skipped, and not returned).
 */
export async function writeAgencySkills(baseDir: string, roleId: string | undefined): Promise<string[]> {
  const mine = skillsForRole(roleId);
  const skillsRoot = path.join(baseDir, '.claude', 'skills');
  for (const name of VENDORED_SKILLS) {
    if (mine.includes(name)) continue;
    await fs.rm(path.join(skillsRoot, name), { recursive: true, force: true }).catch(() => undefined);
  }
  const written: string[] = [];
  for (const name of mine) {
    const files = await loadVendoredSkill(name as VendoredSkill);
    if (!files) continue;
    const dir = path.join(skillsRoot, name);
    // Replace the directory whole: a reference file the plugin dropped must not
    // linger from an earlier extension version, or the copy is no longer the
    // plugin's. The files were read into memory first, so a missing asset can
    // never leave the workspace with an emptied skill.
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    for (const file of files) {
      const target = path.join(dir, ...file.rel.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.bytes);
    }
    written.push(name);
  }
  return written;
}
