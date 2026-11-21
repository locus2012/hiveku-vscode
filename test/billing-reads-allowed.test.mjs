/**
 * The two billing reads of MCP #625 (2026-11-21) are pre-approved and named in the department registry.
 *
 * accounting_payment_gaps (a GET) matches no read glob, so HIVEKU_ALLOW names it, beside accounting_ap_aging and
 * accounting_ar_aging. crm_record_billing_summary (a GET) already matches '*_summary', so it has no entry of its own.
 * The accounting department pulls the gaps report whole as a reference; the CRM department names the billing read in
 * its prose, since it takes one contact or company and is not a list to pull.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const knowledge = loadOut('knowledge');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const dirs = [];
after(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

/** Claude Code permission globs: '*' is the only wildcard. */
const globMatches = (glob, name) =>
  new RegExp('^' + glob.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(name);

test('a fresh folder pre-approves the payment gaps report by name and the billing summary by the *_summary glob', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-billing-reads-allow-'));
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
    permissions.allow.filter((rule) => globMatches(rule, 'mcp__hiveku__accounting_payment_gaps')),
    ['mcp__hiveku__accounting_payment_gaps'],
    'the gaps report is a read: pre-approved by its exact name, and by no glob',
  );
  assert.deepEqual(
    permissions.allow.filter((rule) => globMatches(rule, 'mcp__hiveku__crm_record_billing_summary')),
    ['mcp__hiveku__*_summary'],
    'the billing summary is a read: pre-approved by the *_summary glob alone',
  );
});

test('the department registry names both reads', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'dept-manifest.json'), 'utf8'));
  const departments = manifest.departments ?? manifest;
  const byId = (id) => departments.find((d) => d.id === id);
  const gaps = (byId('accounting').references ?? []).find((r) => r.id === 'payment-gaps');
  assert.equal(gaps?.tool, 'accounting_payment_gaps', 'accounting pulls the gaps report as a reference');
  assert.match(byId('crm').crud, /`crm_record_billing_summary`/, 'the CRM prose names the billing read');
});
