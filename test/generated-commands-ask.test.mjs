/**
 * No command the extension writes pre-approves a tool the folder's settings ask for.
 *
 * A generated command's allowed-tools approves its tools while the command runs. Claude Code checks ask rules before
 * allow rules, so HIVEKU_ASK still prompts wherever it merged; but in a folder whose ask list did not merge, or for a
 * command copied elsewhere, allowed-tools would run those tools with nobody asked. Until 2026-11-10 /hiveku-supabase
 * approved ten of the database and storage writes HIVEKU_ASK asks for (users, uploads, functions deployed and run,
 * migrations, row security rules, rows), and supabase_storage_object_signed_url, whose answer opens a private file for
 * anyone for up to 7 days. Its allowed-tools now carries only reads, and this test holds every generated command, in a
 * site folder and an account folder, to the folder's own ask list.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const knowledge = loadOut('knowledge');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const PROJECT = '11111111-2222-3333-4444-555555555555';
const COMMON = { accountLabel: 'Western Stairlifts', apiKey: 'olp_test_key_123', baseUrl: 'https://core.hiveku.com', role: 'dev', accountId: ACCOUNT };

const dirs = [];
after(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

async function tmp(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A permission rule as a pattern: '*' matches any run of characters, as in Claude Code's rules. */
const ruleToRegExp = (rule) => new RegExp(`^${rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

/** Every command file's allowed-tools, as { command, tool } pairs. */
async function allowedTools(dir) {
  const cmdDir = path.join(dir, '.claude', 'commands');
  const pairs = [];
  for (const command of (await fs.readdir(cmdDir)).sort()) {
    const text = await fs.readFile(path.join(cmdDir, command), 'utf8');
    const line = (text.match(/^allowed-tools:(.*)$/m) ?? [])[1] ?? '';
    for (const tool of line.split(',').map((name) => name.trim()).filter(Boolean)) pairs.push({ command, tool });
  }
  return pairs;
}

/** The command tools the folder's own ask list names, as 'command: tool'. */
async function preApprovedAsks(dir) {
  const settings = JSON.parse(await fs.readFile(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const ask = (settings.permissions?.ask ?? []).map(ruleToRegExp);
  assert.ok(ask.length > 100, 'the folder carries the ask list');
  const pairs = await allowedTools(dir);
  assert.ok(pairs.length > 0, 'the commands carry allowed-tools to check');
  return pairs.filter(({ tool }) => ask.some((rule) => rule.test(tool))).map(({ command, tool }) => `${command}: ${tool}`);
}

describe('generated commands never pre-approve an ask-listed tool', () => {
  test('in a site folder', async () => {
    const dir = await tmp('hk-cmd-ask-site-');
    await knowledge.writeProjectScaffold({ ...COMMON, baseDir: dir, projectId: PROJECT, projectName: 'Main site' });
    assert.deepEqual(await preApprovedAsks(dir), []);
  });

  test('in an account folder', async () => {
    const dir = await tmp('hk-cmd-ask-account-');
    await knowledge.writeScaffold({ ...COMMON, baseDir: dir });
    assert.deepEqual(await preApprovedAsks(dir), []);
  });

  test('/hiveku-supabase keeps its reads and none of its writes', async () => {
    const dir = await tmp('hk-cmd-ask-supabase-');
    await knowledge.writeProjectScaffold({ ...COMMON, baseDir: dir, projectId: PROJECT, projectName: 'Main site' });
    const tools = (await allowedTools(dir)).filter(({ command }) => command === 'hiveku-supabase.md').map(({ tool }) => tool);
    assert.deepEqual(tools, [
      'mcp__hiveku__supabase_auth_users_list',
      'mcp__hiveku__supabase_auth_user_get',
      'mcp__hiveku__supabase_auth_config_get',
      'mcp__hiveku__supabase_storage_list',
      'mcp__hiveku__supabase_storage_objects_list',
      'mcp__hiveku__supabase_edge_functions_list',
      'mcp__hiveku__supabase_edge_functions_get_source',
      'mcp__hiveku__supabase_migrations_list',
      'mcp__hiveku__supabase_policies_list',
      'mcp__hiveku__supabase_table_rows_list',
      'mcp__hiveku__supabase_gen_types',
    ]);
  });
});
