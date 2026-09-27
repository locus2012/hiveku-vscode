/**
 * Every workflow is created switched off, and only workflow_enable turns one on.
 *
 * The MCP server creates every workflow off (workflow_create, workflow_clone,
 * workflow_duplicate, workflow_create_from_template, workflow_provision_webhook
 * and workflow_bulk_provision_for_project), refuses is_enabled: true on the
 * create tools, and refuses it on workflow_update too (workflow_enable_required).
 * Before that, the template and webhook tools created the workflow switched ON
 * by default, and the department registry said so: "A create that starts
 * enabled (`workflow_create_from_template` by default) is never refused".
 *
 * Prose that still says so is worse than stale. An agent that believes a new
 * webhook is live pastes its URL into SmartLead and walks away; while the
 * workflow is off the URL answers 200 and runs nothing, so every reply sent to
 * it is dropped and SmartLead never sends it again.
 *
 * What the assistant reads here comes from two places: the department registry
 * (src/deptData.ts and src/setupPlaybooks.ts, emitted as src/dept-manifest.json
 * and mirrored byte for byte by the Claude Code plugin), and the skills and
 * commands vendored from the plugin into assets/. These pins keep:
 *   - no registry text or vendored file saying a template, webhook or
 *     provisioned workflow is on or live when created;
 *   - no text presenting workflow_update({ is_enabled: true }) as a way on;
 *   - every registry entry and vendored file that teaches a creating tool also
 *     naming workflow_enable;
 *   - the registry's two sites (the workflows crud and the outbound first run)
 *     saying the workflow starts off, and the SmartLead one saying to switch it
 *     on before the URL goes into the provider.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
/** Collapse whitespace and drop backticks and bold marks so a pinned phrase may wrap and carry markup. */
const flat = (s) => s.replace(/`|\*\*/g, '').replace(/\s+/g, ' ');

function walk(dir, out = []) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

const manifest = JSON.parse(read('src/dept-manifest.json'));
/** Each department's crud and setup text, as its own source: a rule taught in one department does not cover another. */
const registryTexts = () =>
  manifest.departments.flatMap((d) =>
    ['crud', 'setup'].filter((f) => typeof d[f] === 'string').map((f) => [`dept-manifest ${d.id}.${f}`, d[f]]),
  );
const VENDORED = walk('assets');
const sources = () => [...VENDORED.map((rel) => [rel, read(rel)]), ...registryTexts()];

const CREATING_TOOLS = /workflow_create_from_template|workflow_provision_webhook|workflow_bulk_provision_for_project/g;

/** Said within reach of a creating tool, these claim the new workflow is on. */
const LIVE_ON_CREATE = [
  /live (?:immediately|the moment|at once)/i,
  /goes live on its own/i,
  /defaults? (?:to )?(?:is_enabled:? )?(?:to )?(?:true|enabled)\b/i,
  /is_enabled:? ?(?:true )?(?:is the default|defaults to true)/i,
  /enabled by default/i,
  /^[^.]{0,40}by default\)/i,
];

/** Said anywhere, these claim a create starts on, or teach workflow_update as a way on. */
const STALE_ANYWHERE = [
  /a create that starts enabled/i,
  /workflow_update\(\{[^}]*is_enabled: ?true/,
  /\(and workflow_update with is_enabled: ?true\)/,
  /workflow_update with is_enabled: ?true\) refuses/,
];

function staleClaims(text) {
  const f = flat(text);
  const found = [];
  for (const m of f.matchAll(CREATING_TOOLS)) {
    const window = f.slice(m.index + m[0].length, m.index + m[0].length + 320);
    for (const re of LIVE_ON_CREATE) {
      const hit = window.match(re);
      if (hit) found.push(`${m[0]} ... ${hit[0]}`);
    }
  }
  for (const re of STALE_ANYWHERE) {
    const hit = f.match(re);
    if (hit) found.push(hit[0]);
  }
  return found;
}

test('no registry text or vendored file says a new workflow is on, or that workflow_update switches one on', () => {
  assert.ok(VENDORED.length > 100, `the assets walk found only ${VENDORED.length} files`);
  const offenders = [];
  for (const [rel, text] of sources()) {
    for (const claim of staleClaims(text)) offenders.push(`${rel}: ${claim}`);
  }
  assert.deepEqual(offenders, [], `still says a new workflow is on:\n  ${offenders.join('\n  ')}`);
});

test('every registry entry and vendored file that teaches a creating tool also names workflow_enable', () => {
  const missing = [];
  let teaching = 0;
  for (const [rel, text] of sources()) {
    CREATING_TOOLS.lastIndex = 0;
    if (!CREATING_TOOLS.test(text)) continue;
    teaching += 1;
    if (!text.includes('workflow_enable')) missing.push(rel);
  }
  CREATING_TOOLS.lastIndex = 0;
  assert.ok(teaching >= 10, `found ${teaching} sources teaching a creating tool, so this test proves little`);
  assert.deepEqual(missing, [], `these teach a creating tool and never say how the workflow is switched on:\n  ${missing.join('\n  ')}`);
});

test('the registry says every create starts off and names workflow_enable as the one way on', () => {
  const byId = Object.fromEntries(manifest.departments.map((d) => [d.id, d]));
  const pins = {
    'workflows.crud': [
      byId.workflows?.crud,
      [
        'Every create path makes the workflow switched off, and workflow_enable is the only call that switches one on',
        'workflow_update refuses is_enabled:true with workflow_enable_required',
        'workflow_create_from_template({ slug, overrides, is_enabled: false }) (created switched off; workflow_enable switches it on after the user says yes)',
        'provisions a submit-handler workflow per form, each created switched off (workflow_enable each after the user says yes)',
        'the workflow is created switched off, so its URL runs nothing until workflow_enable',
      ],
    ],
    'outbound.setup': [
      byId.outbound?.setup,
      [
        'workflow_provision_webhook({ name, is_enabled: false })',
        'The workflow is created switched off, and while it is off its URL answers SmartLead with a 200 but runs nothing',
        'switch it on with workflow_enable once the user says yes, and only then paste webhook_url into SmartLead',
      ],
    ],
  };
  const missing = [];
  for (const [where, [text, phrases]] of Object.entries(pins)) {
    assert.equal(typeof text, 'string', `${where} is missing from the registry`);
    for (const phrase of phrases) if (!flat(text).includes(phrase)) missing.push(`${where}: ${phrase}`);
  }
  assert.deepEqual(missing, [], `missing:\n  ${missing.join('\n  ')}`);
});

test('the checks fail on the old wording (negative control)', () => {
  const oldCrud =
    "Enable/disable: `workflow_enable`/`workflow_disable` (enabling a disabled workflow is refused with 422). A create that starts enabled (`workflow_create_from_template` by default) is never refused: when its response carries `validation_warning`, fix the listed nodes or disable it.";
  assert.notDeepEqual(staleClaims(oldCrud), [], 'the old workflows crud should be caught');
  const oldForms =
    'is `workflow_provision_webhook({ name })`, which returns `{ workflow_id, webhook_url, trigger_id }` in one shot. It defaults `is_enabled: true`, so the URL is live the moment it returns';
  assert.notDeepEqual(staleClaims(oldForms), [], 'the old forms wording should be caught');
  assert.notDeepEqual(staleClaims('`workflow_update({ is_enabled: true })` goes through the same gate.'), []);
  // The old SmartLead first run named the webhook tool and never workflow_enable.
  const oldOutbound =
    "To push provider events into a workflow, call `workflow_provision_webhook({ name })`, which returns `{ workflow_id, webhook_url, trigger_id }` in one shot, and paste `webhook_url` into SmartLead's own webhook settings.";
  assert.ok(!oldOutbound.includes('workflow_enable'));
  // The new wording passes, including a history note that names the old default.
  assert.deepEqual(
    staleClaims(
      '`workflow_provision_webhook` (created switched off, so its URL answers but runs nothing until `workflow_enable`. Until late September 2026 this tool created the workflow switched ON by default)',
    ),
    [],
  );
  assert.deepEqual(staleClaims('`workflow_update({ is_enabled: false })` switches it off while you fix it.'), []);
  assert.deepEqual(staleClaims(manifest.departments.find((d) => d.id === 'workflows').crud), []);
});
