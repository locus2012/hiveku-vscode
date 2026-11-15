/**
 * The strategy check is pre-approved by its exact name; the strategy write is not (2026-11-14).
 *
 * social_post_strategy_check (a POST with readOnlyHint) only reads: it never blocks a post, costs nothing and calls
 * no AI. Agents run it before every draft, schedule and send for approval, so HIVEKU_ALLOW names it, and the
 * permission gate (scripts/check-permission-rules.mjs) takes it as a read by its readOnlyHint. Its write,
 * social_post_strategy_update, is approved by no rule. test/social-strategy-texts.test.mjs holds the rest: no read
 * glob reaches either name.
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

const dirs = [];
after(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

/** Claude Code permission globs: '*' is the only wildcard. */
const globMatches = (glob, name) =>
  new RegExp('^' + glob.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(name);

test('a fresh folder pre-approves the strategy check by its exact name, and nothing approves the strategy write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-strategy-allow-'));
  dirs.push(dir);
  await knowledge.writeScaffold({
    baseDir: dir,
    accountLabel: 'Acme',
    apiKey: 'olp_test_key_123',
    baseUrl: 'https://core.hiveku.com',
    accountId: '0b6f1c2e-1111-4a4a-9c9c-222233334444',
  });
  const { permissions } = JSON.parse(await fs.readFile(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.ok(permissions.allow.includes('mcp__hiveku__social_post_strategy_check'), 'the check is a read: pre-approved by its exact name');
  assert.deepEqual(
    permissions.allow.filter((rule) => globMatches(rule, 'mcp__hiveku__social_post_strategy_update')),
    [],
    'the strategy write is approved by no rule',
  );
});
