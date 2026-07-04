/**
 * Agency-methodology SKILLS for Claude Code — the depth layer above slash
 * commands. Each skill is a full engagement methodology (research → strategy →
 * execution plays with exact tool chains → weekly cadence → monthly reporting →
 * benchmarks/pitfalls) for one revenue discipline. Written to
 * `.claude/skills/<name>/SKILL.md`; Claude Code lazy-loads them when relevant,
 * so their size costs nothing until used.
 *
 * Content lives in agencySkillsContent.ts (generated from verified drafts —
 * every tool name checked against the MCP server).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  SEO_AGENCY_SKILL,
  PPC_AGENCY_SKILL,
  CONTENT_AGENCY_SKILL,
  SALES_AGENCY_SKILL,
  OUTBOUND_AGENCY_SKILL,
} from './agencySkillsContent';

const SKILLS: Record<string, string> = {
  'hiveku-seo-agency': SEO_AGENCY_SKILL,
  'hiveku-ppc-agency': PPC_AGENCY_SKILL,
  'hiveku-content-agency': CONTENT_AGENCY_SKILL,
  'hiveku-sales-agency': SALES_AGENCY_SKILL,
  'hiveku-outbound-agency': OUTBOUND_AGENCY_SKILL,
};

/** Which agency skills each role receives. Roles absent here get none. */
const ROLE_SKILLS: Record<string, string[]> = {
  // SEO carries the outbound skill too: the link-building play hands its target
  // list to an outbound campaign (see "Backlink outreach campaigns").
  seo: ['hiveku-seo-agency', 'hiveku-outbound-agency'],
  ppc: ['hiveku-ppc-agency'],
  marketer: ['hiveku-content-agency', 'hiveku-seo-agency'],
  social: ['hiveku-content-agency'],
  sales: ['hiveku-sales-agency'],
  outbound: ['hiveku-outbound-agency', 'hiveku-sales-agency'],
  owner: Object.keys(SKILLS),
};

export function skillsForRole(roleId: string | undefined): string[] {
  return roleId ? ROLE_SKILLS[roleId] ?? [] : [];
}

/**
 * Write the role's agency skills into <baseDir>/.claude/skills/, removing OTHER
 * hiveku-*-agency skills from a previous role (only the exact known skill dirs
 * are ever touched — user skills are safe).
 */
export async function writeAgencySkills(baseDir: string, roleId: string | undefined): Promise<string[]> {
  const mine = skillsForRole(roleId);
  for (const name of Object.keys(SKILLS)) {
    if (mine.includes(name)) continue;
    await fs.rm(path.join(baseDir, '.claude', 'skills', name), { recursive: true, force: true }).catch(() => undefined);
  }
  for (const name of mine) {
    const dir = path.join(baseDir, '.claude', 'skills', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), SKILLS[name], 'utf8');
  }
  return mine;
}
