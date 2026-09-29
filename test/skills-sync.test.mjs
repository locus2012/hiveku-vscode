/**
 * Account skills reach Claude Code, and local copies follow the one owner rule
 * (memory surfaces audit 2026-09-27, G13 and G14):
 *
 *   - `_skill:<slug>` rows sync to .claude/skills/hiveku-<agent>-<slug>/SKILL.md
 *     the way `_command:` and `_agent:` rows already sync, with the ownership
 *     manifest's guarantees (never touch what it does not own, remove what went
 *     away upstream, keep a local edit and report it);
 *   - <agent> is the entry's owner by the one owner rule (shared for an entry
 *     every agent follows), so a seeded SEO skill is an SEO skill;
 *   - an entry whose folder changed leaves no stale copy behind in the old one.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

const knowledge = loadOut('knowledge');
const commandSync = loadOut('commandSync');

const marker = (d) => `<!-- department: ${d} -->`;
const skillRel = (name) => path.join('.claude', 'skills', name, 'SKILL.md');

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'hk-skills-'));
}
async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
/** An index as fetchKnowledge builds it, from rows of one type per call. */
async function indexOf(listing) {
  return knowledge.fetchKnowledge(fakeClient({ memory_list: (args) => ({ data: listing[args.type] || [] }) }));
}

describe('account skills sync to .claude/skills (G13)', () => {
  test('each skill lands where Claude Code finds it, named for the agent that owns it', async () => {
    const dir = await tmp();
    const index = await indexOf({
      skill: [
        { id: 's1', name: 'discovery-call', domain: '_skill:discovery-call', department: 'sales', content: '# Discovery call prep\n\n1. Read the deal.' },
        { id: 's2', name: 'seo-audit', domain: '_skill:seo-audit', department: 'marketing', content: `${marker('seo')}\n# Monthly SEO audit\nRun it.` },
        { id: 's3', name: 'plain-words', domain: '_skill:plain-words', department: null, content: 'Write in plain words.' },
      ],
      command: [{ id: 'c1', name: 'weekly', domain: '_command:weekly', department: 'ppc', content: 'Tune bids.' }],
      agent: [{ id: 'a1', name: 'closer', domain: '_agent:closer', department: 'sales', content: 'You close deals.' }],
    });
    const result = await commandSync.syncAccountCommands(index, dir);
    assert.deepEqual(result.written.sort(), [
      path.join('.claude', 'agents', 'hiveku-closer.md'),
      path.join('.claude', 'commands', 'hiveku-ppc-weekly.md'),
      skillRel('hiveku-sales-discovery-call'),
      skillRel('hiveku-seo-seo-audit'),
      skillRel('hiveku-shared-plain-words'),
    ].sort());

    const sales = await fs.readFile(path.join(dir, skillRel('hiveku-sales-discovery-call')), 'utf8');
    assert.equal(
      sales,
      '---\nname: hiveku-sales-discovery-call\ndescription: "Discovery call prep (Sales skill, from Hiveku)"\n---\n# Discovery call prep\n\n1. Read the deal.\n',
    );
    const seo = await fs.readFile(path.join(dir, skillRel('hiveku-seo-seo-audit')), 'utf8');
    assert.match(seo, /^---\nname: hiveku-seo-seo-audit\ndescription: "Monthly SEO audit \(SEO skill, from Hiveku\)"\n---\n/);
    assert.ok(seo.includes(marker('seo')), 'the marker stays in the body');
    const shared = await fs.readFile(path.join(dir, skillRel('hiveku-shared-plain-words')), 'utf8');
    assert.match(shared, /description: "Write in plain words\. \(a skill every agent follows, from Hiveku\)"/);

    // A second sync with nothing new is quiet.
    const again = await commandSync.syncAccountCommands(index, dir);
    assert.deepEqual([again.written, again.removed, again.skippedLocalEdits], [[], [], []]);
  });

  test("an entry's own front matter keeps its other keys; its name and description are replaced", async () => {
    const dir = await tmp();
    const content = `${marker('sales')}\n---\nname: Old Name\ndescription: >\n  Prepare for a first call\nallowed-tools: Read, Grep\n---\nStep 1.`;
    const index = await indexOf({ skill: [{ id: 's1', name: 'prep', domain: '_skill:prep', content }] });
    await commandSync.syncAccountCommands(index, dir);
    const text = await fs.readFile(path.join(dir, skillRel('hiveku-sales-prep')), 'utf8');
    assert.equal(
      text,
      `---\nname: hiveku-sales-prep\ndescription: "Step 1. (Sales skill, from Hiveku)"\nallowed-tools: Read, Grep\n---\n${marker('sales')}\nStep 1.\n`,
    );
  });

  test('a name Claude Code would refuse is made safe: hyphens only, at most 64 characters, never a vendored skill', async () => {
    const dir = await tmp();
    const long = 'x'.repeat(43);
    const index = await indexOf({
      skill: [
        { id: 's1', name: 'faq', domain: '_skill:faq', department: 'knowledge_base', content: 'FAQ' },
        { id: 's2', name: long, domain: `_skill:${long}`, department: 'before_after_grid', content: 'Long' },
        { id: 's3', name: 'agency', domain: '_skill:agency', department: 'seo', content: 'Ours' },
      ],
    });
    // A vendored methodology skill is already there, and is not ours.
    const vendored = path.join(dir, '.claude', 'skills', 'hiveku-seo-agency', 'SKILL.md');
    await fs.mkdir(path.dirname(vendored), { recursive: true });
    await fs.writeFile(vendored, 'VENDORED', 'utf8');

    const result = await commandSync.syncAccountCommands(index, dir);
    const names = result.written.map((rel) => rel.split(path.sep)[2]);
    assert.ok(names.includes('hiveku-knowledge-base-faq'));
    for (const name of names) {
      assert.match(name, /^[a-z0-9-]+$/, name);
      assert.ok(name.length <= 64, name);
    }
    const agency = names.find((n) => n.startsWith('hiveku-seo-agency'));
    assert.match(agency, /^hiveku-seo-agency-[0-9a-f]{6}$/);
    assert.equal(await fs.readFile(vendored, 'utf8'), 'VENDORED', 'the vendored skill is untouched');
  });

  test('a skill removed upstream goes, directory and all; one edited locally stays and is reported', async () => {
    const dir = await tmp();
    const index = await indexOf({
      skill: [
        { id: 's1', name: 'gone', domain: '_skill:gone', department: 'sales', content: 'Gone soon.' },
        { id: 's2', name: 'mine', domain: '_skill:mine', department: 'sales', content: 'Edited soon.' },
      ],
    });
    await commandSync.syncAccountCommands(index, dir);
    const edited = path.join(dir, skillRel('hiveku-sales-mine'));
    await fs.appendFile(edited, 'My own note.\n', 'utf8');
    const result = await commandSync.syncAccountCommands(await indexOf({ skill: [] }), dir);
    assert.deepEqual(result.removed, [skillRel('hiveku-sales-gone')]);
    assert.equal(await exists(path.join(dir, '.claude', 'skills', 'hiveku-sales-gone')), false, 'the empty directory went too');
    assert.deepEqual(result.skippedLocalEdits, [skillRel('hiveku-sales-mine')]);
    assert.match(await fs.readFile(edited, 'utf8'), /My own note\./);
  });

  test('a command whose marker line sits above its front matter now has its front matter first', async () => {
    const dir = await tmp();
    const index = await indexOf({
      command: [
        { id: 'c1', name: 'tune', domain: '_command:tune', content: `${marker('ppc')}\n---\ndescription: Weekly tune\n---\nStep 1.` },
        // Negative control: front matter already first is written exactly as before.
        { id: 'c2', name: 'plain', domain: '_command:plain', department: 'ppc', content: '---\ndescription: Plain\n---\n\nStep 1.' },
      ],
    });
    await commandSync.syncAccountCommands(index, dir);
    assert.equal(
      await fs.readFile(path.join(dir, '.claude', 'commands', 'hiveku-ppc-tune.md'), 'utf8'),
      `---\ndescription: Weekly tune\n---\n${marker('ppc')}\nStep 1.\n`,
    );
    assert.equal(await fs.readFile(path.join(dir, '.claude', 'commands', 'hiveku-ppc-plain.md'), 'utf8'), '---\ndescription: Plain\n---\n\nStep 1.\n');
  });
});

describe('local copies follow the one owner rule (G14)', () => {
  test('the folder is the owner: the column, the seeded topic marker, shared for no one', async () => {
    const index = await indexOf({
      rule: [
        { id: 'r1', name: 'a', domain: '_rule:a', department: 'sales', content: 'x' },
        { id: 'r2', name: 'b', domain: '_rule:b', department: 'marketing', content: `${marker('email')}\nx` },
        { id: 'r3', name: 'c', domain: '_rule:c', department: 'marketing', content: 'x' },
        { id: 'r4', name: 'd', domain: '_rule:d', content: 'x' },
        { id: 'r5', name: 'e', domain: '_rule:e', owner: 'comms', department: 'sales', content: 'x' },
      ],
    });
    const folderOf = Object.fromEntries(knowledge.selectEntries(index).map((e) => [e.domain, e.department]));
    assert.deepEqual(folderOf, { '_rule:a': 'sales', '_rule:b': 'email', '_rule:c': 'marketing', '_rule:d': 'shared', '_rule:e': 'comms' });
  });

  test("an entry that moved folders leaves no copy behind; an edited copy is kept", async () => {
    const dir = await tmp();
    const entry = (department, content = 'Never discount.') => ({ id: 'r1', name: 'no-discounts', domain: '_rule:no-discounts', content, version: 1, type: 'rule', department });
    await knowledge.writeEntries(dir, [entry('general')]);
    const oldFile = path.join(dir, 'rules', 'general', 'no-discounts.md');
    assert.ok(await exists(oldFile));
    await knowledge.writeEntries(dir, [entry('sales')]);
    assert.ok(await exists(path.join(dir, 'rules', 'sales', 'no-discounts.md')));
    assert.equal(await exists(oldFile), false, 'the old copy is gone');
    assert.equal(await exists(path.dirname(oldFile)), false, 'and its emptied folder');
    const manifest = JSON.parse(await fs.readFile(path.join(dir, '.hiveku', 'knowledge-manifest.json'), 'utf8'));
    assert.equal(manifest.entries['_rule:no-discounts'].file, 'rules/sales/no-discounts.md');

    // Negative control: a copy someone edited is left where it is.
    await knowledge.writeEntries(dir, [entry('shared')]);
    const shared = path.join(dir, 'rules', 'shared', 'no-discounts.md');
    await fs.appendFile(shared, '\nMy note.\n', 'utf8');
    await knowledge.writeEntries(dir, [entry('sales')]);
    assert.match(await fs.readFile(shared, 'utf8'), /My note\./);
  });

  test('a folder that only changed case is the same file on a case-insensitive disk and is not removed', async () => {
    const dir = await tmp();
    const entry = (department) => ({ id: 'r1', name: 'audit', domain: '_rule:audit', content: 'Audit.', version: 1, type: 'rule', department });
    await knowledge.writeEntries(dir, [entry('SEO')]);
    await knowledge.writeEntries(dir, [entry('seo')]);
    assert.match(await fs.readFile(path.join(dir, 'rules', 'seo', 'audit.md'), 'utf8'), /Audit\./);
  });
});
