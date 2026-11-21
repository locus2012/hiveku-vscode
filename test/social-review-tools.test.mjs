/**
 * Review with AI of a social post asks in every folder; its two reads are pre-approved (2026-11-21).
 *
 * social_post_strategy_review has the Social team score a saved post and spends the account's AI credit in the name
 * of the person behind the key; its description says ASK THE PERSON FIRST. So HIVEKU_ASK names it (asked in every
 * permission mode, as on the Claude Code plugin's ask list and in the Codex plugin) and no allow rule or read glob
 * approves it. Its two reads only read: social_post_strategy_review_get (the stored review, the live run, the last
 * failure) rides the *_get glob, and social_analytics_who_for (posts by ICP and by stage, and the gaps) is on
 * HIVEKU_ALLOW by its exact name, since no glob matches it. The vendored social skill tells an agent to read the
 * stored review before it asks, so that read must not prompt.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const knowledge = loadOut('knowledge');

const REVIEW = 'mcp__hiveku__social_post_strategy_review';
const REVIEW_GET = 'mcp__hiveku__social_post_strategy_review_get';
const WHO_FOR = 'mcp__hiveku__social_analytics_who_for';

const dirs = [];
after(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

/** Claude Code permission globs: '*' is the only wildcard. */
const globMatches = (glob, name) =>
  new RegExp('^' + glob.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(name);

async function freshFolderPermissions() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-social-review-'));
  dirs.push(dir);
  await knowledge.writeScaffold({
    baseDir: dir,
    accountLabel: 'Acme',
    apiKey: 'olp_test_key_123',
    baseUrl: 'https://core.hiveku.com',
    accountId: '0b6f1c2e-1111-4a4a-9c9c-222233334444',
  });
  return JSON.parse(await fs.readFile(path.join(dir, '.claude', 'settings.json'), 'utf8')).permissions;
}

test('a fresh folder asks before Review with AI, and no allow rule approves it', async () => {
  const permissions = await freshFolderPermissions();
  assert.equal(permissions.ask.filter((rule) => rule === REVIEW).length, 1, 'the review asks, once');
  assert.deepEqual(permissions.allow.filter((rule) => globMatches(rule, REVIEW)), [], 'the review is approved by no rule');
  assert.equal((permissions.deny ?? []).some((rule) => globMatches(rule, REVIEW)), false, 'the review is asked, not denied');
});

test('a fresh folder pre-approves the stored review read by *_get and the who-for read by its exact name', async () => {
  const permissions = await freshFolderPermissions();
  assert.ok(permissions.allow.includes('mcp__hiveku__*_get'), 'the premise changed: the folder holds no *_get glob');
  assert.ok(permissions.allow.some((rule) => globMatches(rule, REVIEW_GET)), 'the stored review is a read: pre-approved');
  assert.ok(permissions.allow.includes(WHO_FOR), 'who the posts were for is a read: pre-approved by its exact name');
  for (const read of [REVIEW_GET, WHO_FOR]) {
    assert.equal(permissions.ask.includes(read), false, `${read} is a read and must not ask`);
  }
});
