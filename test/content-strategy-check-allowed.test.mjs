/**
 * The content strategy check is pre-approved by its exact name; the content strategy write is not (2026-11-17).
 *
 * content_strategy_check (a POST with readOnlyHint) only reads: it never blocks a piece, costs nothing and calls no
 * AI. Agents run it before they send a draft for review, publish or schedule it, so HIVEKU_ALLOW names it, and the
 * permission gate (scripts/check-permission-rules.mjs) takes it as a read by its readOnlyHint. Its write,
 * content_strategy_update, is approved by no rule, and no read glob reaches either name.
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

test('a fresh folder pre-approves the content check by its exact name, and nothing approves the content write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-content-strategy-allow-'));
  dirs.push(dir);
  await knowledge.writeScaffold({
    baseDir: dir,
    accountLabel: 'Acme',
    apiKey: 'olp_test_key_123',
    baseUrl: 'https://core.hiveku.com',
    accountId: '0b6f1c2e-1111-4a4a-9c9c-222233334444',
  });
  const { permissions } = JSON.parse(await fs.readFile(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(
    permissions.allow.filter((rule) => globMatches(rule, 'mcp__hiveku__content_strategy_check')),
    ['mcp__hiveku__content_strategy_check'],
    'the check is a read: pre-approved by its exact name, and by no glob',
  );
  assert.deepEqual(
    permissions.allow.filter((rule) => globMatches(rule, 'mcp__hiveku__content_strategy_update')),
    [],
    'the content strategy write is approved by no rule',
  );
});
