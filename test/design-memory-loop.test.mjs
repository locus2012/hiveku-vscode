/**
 * The designer role's design commands never save the agent's own taste to
 * memory, and start from a template of the frame's size (Hiveku's design
 * rules, 2026-11-10).
 *
 * /hiveku-design-produce and /hiveku-design-brief ended with the generic
 * "persist notable learnings to department memory". On design work that meant
 * the agent saving its own drafts, palette and template picks to the branding
 * memory as what works, and later sessions reading those notes as proven and
 * as brand values that could disagree with the brand guide. Both now end the
 * way the Claude Code plugin's /hiveku:design does: only a person's words
 * about a design, quoted, with its id; never the agent's own palette, font or
 * template choices. /hiveku-design-produce also points at Hiveku's design
 * rules in platform_rules and starts from a template of the destination's
 * size, and from an earlier design only when the person names it.
 *
 * The vendored creative skill (assets/skills/hiveku-creative-agency, a byte
 * copy of the plugin's) carries the same rules; scripts/check-agency-skills-
 * drift.mjs keeps the copy identical, and the old sentences are pinned out
 * here too so a stale re-vendor fails even without the plugin checkout.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const roleCommands = loadOut('roleCommands');

const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
const tmp = (prefix) => fs.mkdtemp(path.join(os.tmpdir(), prefix));
const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'skills', 'hiveku-creative-agency');

async function designerCommands() {
  const dir = await tmp('hk-design-loop-');
  const written = await roleCommands.writeRoleSlashCommands(dir, 'designer');
  const read = (name) => fs.readFile(path.join(dir, '.claude', 'commands', `${name}.md`), 'utf8');
  return { written, produce: await read('hiveku-design-produce'), brief: await read('hiveku-design-brief') };
}

test('both designer commands save only the person\'s words about a design, never the agent\'s own choices', async () => {
  const { written, produce, brief } = await designerCommands();
  assert.ok(written.includes('hiveku-design-produce') && written.includes('hiveku-design-brief'), 'the designer role writes both commands');
  for (const [name, text] of [['hiveku-design-produce', produce], ['hiveku-design-brief', brief]]) {
    const body = flat(text);
    assert.doesNotMatch(body, /persist notable learnings/, `${name} still ends with the generic learnings closer`);
    assert.match(body, /If the person said what works or what does not, record their words, quoted, with the design's id and the date, in the `branding` memory document/, name);
    assert.match(body, /Never write your own palette, font or template choices there \(the brand guide holds the brand\), and never your own design as what works: it is a draft until the person says so/, name);
    // The write that remains keeps the log rules (memory-activity.test.mjs pins these for every generated file).
    assert.match(body, /memory_update\(\{ memory_id, content, reason, expected_version \}\)/, name);
    assert.match(body, /memory_log_list/, name);
    assert.match(body, /`reason`/, name);
  }
});

test('/hiveku-design-produce points at Hiveku\'s design rules and starts from a template of the same size', async () => {
  const { produce } = await designerCommands();
  const body = flat(produce);
  assert.match(body, /Hiveku's design rules come first: `account_context_get` returns them in `platform_rules`\. They apply to every account and outrank its memory/);
  assert.ok(body.indexOf("Hiveku's design rules come first") < body.indexOf('1. Reuse first'), 'the pointer comes before the steps');
  assert.match(body, /take one whose artboard is the destination's size, then replace its words and pictures with this business's true story/);
  assert.match(body, /Start from an earlier design \(`design_list`\) only when the person names it/);
});

test('the vendored creative skill carries the same rules', async () => {
  const read = async (rel) => flat(await fs.readFile(path.join(ASSETS, rel), 'utf8'));
  const skill = await read('SKILL.md');
  const protocol = await read('references/memory-protocol.md');
  const brandAndAssets = await read('references/brand-and-assets.md');
  const canvas = await read('references/design-canvas.md');
  for (const [text, old] of [
    [skill, /palette and type decisions/],
    [skill, /branding memory updated with palette, type and logo rules/],
    [skill, /`design_list` for a design to restyle/],
    [protocol, /palette hexes and roles, the type pairing, logo rules, and WHY/],
    [brandAndAssets, /record the decisions\*\*: palette, type, logo rules, and reasoning into the `branding` memory/],
    [canvas, /check there for something to reuse first/],
  ]) {
    assert.doesNotMatch(text, old);
  }
  assert.match(skill, /what the person said works or does not \(their words, quoted, with the design id\)/);
  assert.match(protocol, /\*\*A person's verdicts on designs, quoted:\*\*/);
  assert.match(canvas, /\*\*D4\. Start from a `design_templates_list` template of the frame's size, not a blank artboard\.\*\*/);
});
