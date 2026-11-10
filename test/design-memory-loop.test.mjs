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
 * The review of that fix found the loop in more places, pinned here too. The
 * designer's /hiveku-daily ("persist notable learnings"), /hiveku-weekly (a
 * "what changed / what's next" note merged into the branding memory) and
 * /hiveku-report ("deliverables shipped", then "Persist the summary to
 * memory") saved the agent's own account of its work, and Agency Cadence runs
 * all three on a timer with no person present. They now give the summary to
 * the person and keep memory for a person's words. /hiveku-media no longer
 * offers a generated "hero + before/after" set, and the vendored video
 * reference and /hiveku-creative-brief carry the plugin's same fixes.
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

const ASSET_COMMANDS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'commands');
const SUMMARY_TO_PERSON =
  /This summary is your own account of your own work: it goes to the person \(your reply, a report file or a PM task\), never into memory, and anything you made is a draft until a person approves it\. Memory keeps only what a person said\. If the person said what works or what does not, record their words, quoted, with the design's id and the date, in the `branding` memory document/;

async function roleFiles(role, names) {
  const dir = await tmp('hk-design-cadence-');
  await roleCommands.writeRoleSlashCommands(dir, role);
  const out = {};
  for (const name of names) out[name] = flat(await fs.readFile(path.join(dir, '.claude', 'commands', `${name}.md`), 'utf8'));
  return out;
}

test('the designer\'s brief, weekly pass and monthly report give the summary to the person, never to memory', async () => {
  // Agency Cadence runs all three with no person present (localAutomations.ts CADENCE_JOBS).
  const cadence = roleCommands.availableCadenceCommands('designer');
  for (const name of ['hiveku-daily', 'hiveku-weekly', 'hiveku-report']) assert.ok(cadence.has(name), `${name} is a cadence command`);
  const files = await roleFiles('designer', ['hiveku-daily', 'hiveku-weekly', 'hiveku-report']);
  const daily = files['hiveku-daily'];
  assert.doesNotMatch(daily, /persist notable learnings/);
  assert.match(daily, /5\. This summary is your own account of your own work/);
  const weekly = files['hiveku-weekly'];
  assert.doesNotMatch(weekly, /"what changed \/ what's next" note merged into the "branding" memory/);
  assert.match(weekly, /4\. Close with a 5-line "what changed \/ what's next" note\. This summary is your own account of your own work/);
  const report = files['hiveku-report'];
  assert.doesNotMatch(report, /deliverables shipped/);
  assert.doesNotMatch(report, /Persist the summary to memory/);
  assert.match(report, /2\. designs created or revised, with dashboard links and each one's status \(a draft until a person approves or publishes it\)/);
  assert.match(report, /4\. Create next month's plan as PM tasks \(on approval\)\. This summary is your own account of your own work/);
  for (const [name, body] of Object.entries(files)) {
    assert.match(body, SUMMARY_TO_PERSON, name);
    assert.match(body, /Never write your own palette, font or template choices there \(the brand guide holds the brand\), and never your own design as what works: it is a draft until the person says so/, name);
    // The one write that remains, a person's words, keeps the log rules.
    assert.match(body, /memory_update\(\{ memory_id, content, reason, expected_version \}\)/, name);
    assert.match(body, /memory_log_list/, name);
    assert.match(body, /`reason`/, name);
  }
});

test('other roles keep their own closers: the designer\'s rule is the designer\'s', async () => {
  const files = await roleFiles('seo', ['hiveku-daily', 'hiveku-weekly', 'hiveku-report']);
  assert.match(files['hiveku-daily'], /persist notable learnings to department memory/);
  assert.match(files['hiveku-weekly'], /4\. Close with a 5-line "what changed \/ what's next" note merged into the "seo" memory/);
  assert.match(files['hiveku-report'], /4\. Persist the summary to memory and create next month's plan as PM tasks \(on approval\)/);
  for (const body of Object.values(files)) assert.doesNotMatch(body, /This summary is your own account of your own work/);
});

test('/hiveku-media never offers a generated before and after', async () => {
  const { 'hiveku-media': media } = await roleFiles(undefined, ['hiveku-media']);
  assert.doesNotMatch(media, /hero \+ before\/after/);
  assert.match(media, /A SET that must look consistent \(ad variations, a carousel's slides\): `generate_image_set`/);
  assert.match(media, /Never a before and after: the business's real photos are the only before and after that may appear, and a generated picture never invents a "before", a result or a customer/);
});

test('the vendored video reference, brand reference, skill and creative brief carry the plugin\'s fixes', async () => {
  const asset = async (rel) => flat(await fs.readFile(path.join(ASSETS, rel), 'utf8'));
  const video = await asset('references/video.md');
  assert.doesNotMatch(video, /the storyboard template that worked/);
  assert.match(video, /Keep only what a person decided, in their words: the aspect ratio they chose or the animation style they signed off goes to the branding memory document quoted, with the design or storyboard id and the date/);
  assert.match(video, /Never your own pick of a template, a style or a storyboard as what worked: a video you made is a draft until a person approves it/);
  const brandAndAssets = await asset('references/brand-and-assets.md');
  assert.doesNotMatch(brandAndAssets, /for generic context - backgrounds, textures/);
  assert.doesNotMatch(brandAndAssets, /\*\*Generation\*\*, for concepts/);
  assert.match(brandAndAssets, /Decoration is never the design: no stock background, texture or mood photo under a big headline/);
  assert.match(brandAndAssets, /A generated picture never invents a customer, a result, a team, a place or a "before"/);
  const skill = await asset('SKILL.md');
  assert.doesNotMatch(skill, /Benchmarks \(defaults - account memory overrides\)/);
  assert.match(skill, /## 6\. Benchmarks \(defaults - the brand guide and the person override\) Memory never overrides the colours, fonts or logos: they come only from the account's default brand guide/);
  const brief = flat(await fs.readFile(path.join(ASSET_COMMANDS, 'creative-brief.md'), 'utf8'));
  assert.doesNotMatch(brief, /persist notable learnings/);
  assert.doesNotMatch(brief, /`brand_guide_get\(\{ id \}\)` on the active guide/);
  assert.match(brief, /6\. Finish with PM, and with memory only for a person's words\./);
  assert.match(brief, /If the person said what works or what does not about a design, record their words, quoted, with the design or asset id and the date, in the `branding` memory document/);
  assert.match(brief, /Never write palette, fonts or your own template choices there: the brand guide holds the brand/);
  // The social role writes it from the vendored copy.
  const dir = await tmp('hk-design-brief-');
  await roleCommands.writeRoleSlashCommands(dir, 'social');
  assert.equal(flat(await fs.readFile(path.join(dir, '.claude', 'commands', 'hiveku-creative-brief.md'), 'utf8')), brief);
});
