/**
 * The extension's Social texts name the strategy check and the strategy write (2026-11-14).
 *
 * social_post_strategy_check (a POST with readOnlyHint): who a post is for and why, item by item ok, fix, ask or
 * not_set; it never blocks a post, costs nothing and calls no AI. social_post_strategy_update: the ICP, journey,
 * stage, grid, row, pillar and tags of any post, published included, and nothing else.
 *
 * Holds:
 *   1. The Social department's crud text (src/deptData.ts) runs the check before a draft is saved, scheduled or sent
 *      for approval, and before the dry run; a published post's who-and-why goes through the strategy write, on the
 *      person's word. The emitted src/dept-manifest.json carries the same texts (npm run gen:registry ran).
 *   2. The Social first run (src/setupPlaybooks.ts) checks its first draft before it validates and creates it, and
 *      leaves the picks to the person.
 *   3. The permission rules of a fresh folder: no allow rule or read glob approves the strategy write, and no read
 *      glob reaches the check, so any approval of it is by its exact name.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = 'social_post_strategy_check';
const WRITE = 'social_post_strategy_update';
/** Line breaks and their indent folded to one space, so a phrase wrapped across lines still matches. */
const fold = (text) => text.replace(/\s*\n\s*/g, ' ');

const { DEPARTMENTS } = loadOut('deptData');
const { SOCIAL_SETUP } = loadOut('setupPlaybooks');
const knowledge = loadOut('knowledge');
const social = DEPARTMENTS.find((d) => d.id === 'social');

const dirs = [];
after(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

/** Claude Code permission globs: '*' is the only wildcard. */
const globMatches = (glob, name) =>
  new RegExp('^' + glob.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(name);

test("the Social crud text runs the strategy check before the dry run, and sends a published post's who-and-why to the strategy write", () => {
  const crud = social.crud;
  assert.ok(crud.includes(`\`${CHECK}\``), 'the crud text names the check');
  assert.ok(crud.indexOf(CHECK) < crud.indexOf('social_post_validate'), 'the check comes before the dry run');
  assert.match(crud, /Before saving a draft, scheduling or sending a post for approval, run `social_post_strategy_check`/);
  assert.match(crud, /It only reads: it never blocks a post, costs nothing and calls no AI\./);
  assert.match(crud, /ask the person each ask item, never answering one for them/);
  assert.match(crud, /`social_post_strategy_update`, which changes nothing else, on the person's word/);
  assert.doesNotMatch(crud, /Before ANY schedule, dry-run with `social_post_validate`/, 'the old sentence named only the dry run');
});

test('the emitted manifest carries the same Social texts (npm run gen:registry ran)', () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'src', 'dept-manifest.json'), 'utf8'));
  const row = manifest.departments.find((d) => d.id === 'social');
  assert.equal(row.crud, social.crud);
  assert.equal(row.setup, social.setup);
});

test('the Social first run checks its first draft before it validates and creates it, and leaves the picks to the person', () => {
  const verify = SOCIAL_SETUP.slice(SOCIAL_SETUP.indexOf('## Verify with a DRAFT post'));
  assert.ok(verify.length > 0, 'the first run lost its "Verify with a DRAFT post" step');
  const at = (s) => verify.indexOf(s);
  assert.ok(at(`1. \`${CHECK}(`) >= 0, 'step 1 of the first draft is the strategy check');
  assert.ok(at(`1. \`${CHECK}(`) < at('`social_post_validate(') && at('`social_post_validate(') < at('`social_create_post('), 'check, then dry run, then the draft');
  assert.match(fold(verify), /never blocks a post, costs nothing and calls no AI/);
  assert.match(fold(verify), /a pick to make with the person, never one to make for them/);
});

test('in a fresh folder no rule approves the strategy write, and no read glob reaches the check', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-strategy-texts-'));
  dirs.push(dir);
  await knowledge.writeScaffold({
    baseDir: dir,
    accountLabel: 'Acme',
    apiKey: 'olp_test_key_123',
    baseUrl: 'https://core.hiveku.com',
    accountId: '0b6f1c2e-1111-4a4a-9c9c-222233334444',
  });
  const { permissions } = JSON.parse(await fs.readFile(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.ok(permissions.allow.some((rule) => rule.includes('*')), 'the premise changed: the folder holds no read glob');
  assert.deepEqual(permissions.allow.filter((rule) => globMatches(rule, `mcp__hiveku__${WRITE}`)), [], 'the strategy write is approved by no rule');
  assert.deepEqual(
    permissions.allow.filter((rule) => rule.includes('*') && globMatches(rule, `mcp__hiveku__${CHECK}`)),
    [],
    'the check is approved by its exact name or not at all, never by a glob that could reach the write',
  );
});
