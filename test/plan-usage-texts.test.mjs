/**
 * What the scaffolded folders teach an agent about the account's plan and its limits
 * (agent plan and usage, notes/plans-update-2026-10-09/agent-plan-usage-plan.md, sections
 * 5, 6 and 8).
 *
 * The words are written once in the builder (hiveku_builder
 * src/lib/platform-guide/plan-usage.ts, builder #1332, served with no key at
 * /api/public/platform-guide/plan-usage) and copied here byte for byte. The pins below are
 * the builder's sha256s, so a copy reworded here, or a builder change not copied here, fails:
 *   - PLAN_USAGE_PROSE (the builder's PLAN_USAGE_RULES) is the account CLAUDE.md's
 *     "Your plan and its limits" section;
 *   - PLAN_LIMIT_PROSE (PLAN_LIMIT_LINE) comes right after the memory_write_refused
 *     sentence in the "Hiveku itself in your way?" lists of the account CLAUDE.md and the
 *     Codex AGENTS.md, so a tool refused at the plan's number is told to the person, never
 *     retried or reported as a Hiveku problem;
 *   - the pre-flight rule names account_usage_get, and the daily brief may read it and puts
 *     one line in the brief for a limit_kind answer instead of skipping the tool;
 *   - the extension's own texts lose the stale words: X posting "Premium-gated",
 *     voice_not_enabled read as an add-on that is off, and Outbound with no price.
 *     (The vendored plugin files under assets/ are re-vendored from the plugin's release.)
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const log = loadOut('memoryLog');
const knowledge = loadOut('knowledge');
const codex = loadOut('codex');
const roleCommands = loadOut('roleCommands');
const setup = loadOut('setupPlaybooks');
const { ROLES } = loadOut('roles');

/** The builder's pins (src/lib/platform-guide/plan-usage.ts, PLAN_USAGE_RULES_SHA256 and PLAN_LIMIT_LINE_SHA256). */
const PLAN_USAGE_RULES_SHA256 = '47c67705703688cccb9517b4487f80cc83f113a3f5ab621ee243d1feb3161460';
const PLAN_LIMIT_LINE_SHA256 = '4060de89cfddad4ff37857bd24c7776e23a32c565fdf9b14ca63dbaf401aad1b';

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const KEY = 'olp_test_key_123';
const BASE = 'https://core.hiveku.com';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
const tmp = (prefix) => fs.mkdtemp(path.join(os.tmpdir(), prefix));

/** The refused-write sentence, then the limit line on the next line of the same list item. */
const REFUSED_THEN_LIMIT = `${log.MEMORY_WRITE_REFUSED_PROSE}\n  ${log.PLAN_LIMIT_PROSE}\n`;

/** The "Hiveku itself in your way?" item carries the limit line, word for word, right after the refused-write sentence. */
function assertLimitLine(text, where) {
  assert.ok(text.includes(REFUSED_THEN_LIMIT), `${where}: the limit line right after the refused-write sentence`);
  const item = text.indexOf('**Hiveku itself in your way?**');
  const line = text.indexOf(log.PLAN_LIMIT_PROSE);
  const next = text.indexOf('**Tell the user only if it changes what they get:**');
  assert.ok(item !== -1 && item < line && line < next, `${where}: inside the "Hiveku itself in your way?" item`);
  assert.equal(text.split(log.PLAN_LIMIT_PROSE).length, 2, `${where}: once`);
}

/** The account CLAUDE.md's own section carries the whole block, byte for byte. */
function assertRulesSection(text, where) {
  assert.ok(text.includes(`\n### Your plan and its limits\n${log.PLAN_USAGE_PROSE}\n\n`), `${where}: the rules block as its own section`);
  assert.equal(text.split(log.PLAN_USAGE_PROSE).length, 2, `${where}: once`);
}

async function accountClaudeMd(role) {
  const dir = await tmp('hk-plan-acct-');
  await knowledge.writeScaffold({ baseDir: dir, accountLabel: 'Western Stairlifts', apiKey: KEY, baseUrl: BASE, role, accountId: ACCOUNT });
  return fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
}

describe('the plan texts are the builder\'s, byte for byte', () => {
  test('PLAN_USAGE_PROSE and PLAN_LIMIT_PROSE match the builder\'s sha256 pins', () => {
    assert.equal(sha256(log.PLAN_USAGE_PROSE), PLAN_USAGE_RULES_SHA256);
    assert.equal(sha256(log.PLAN_LIMIT_PROSE), PLAN_LIMIT_LINE_SHA256);
    assert.ok(log.PLAN_USAGE_PROSE.startsWith("Hiveku rules: the account's plan and its limits\n- "));
    assert.equal(log.PLAN_USAGE_PROSE.split('\n').length, 8, 'a title line and seven rules');
    assert.ok(!log.PLAN_LIMIT_PROSE.includes('\n'), 'the limit line is one line');
  });

  test('negative control: one character changed, or the old wording, fails the pins', () => {
    assert.notEqual(sha256(log.PLAN_LIMIT_PROSE.replace('billing_url', 'billing url')), PLAN_LIMIT_LINE_SHA256);
    assert.notEqual(sha256(`${log.PLAN_USAGE_PROSE}\n`), PLAN_USAGE_RULES_SHA256);
    const draft =
      'A tool answer with limit_kind (a plan\'s number reached, AI credits used up, billing that needs attention, an ' +
      'add-on or phones not set up) is not a fault: nothing was done.';
    assert.notEqual(sha256(draft), PLAN_LIMIT_LINE_SHA256);
  });
});

describe('the account CLAUDE.md', () => {
  for (const role of [undefined, ...ROLES.map((r) => r.id)]) {
    test(`role ${role ?? '(none)'}: the rules section, and the limit line in the "Hiveku itself in your way?" item`, async () => {
      const claude = await accountClaudeMd(role);
      assertRulesSection(claude, 'account CLAUDE.md');
      assertLimitLine(claude, 'account CLAUDE.md');
    });
  }

  test('the pre-flight rule names account_usage_get for work the plan counts', async () => {
    const claude = await accountClaudeMd(undefined);
    const start = claude.indexOf('**Pre-flight rule:');
    const rule = flat(claude.slice(start, claude.indexOf('If a platform the work needs', start)));
    assert.ok(start !== -1);
    assert.match(rule, /`email_connections_list`\), and, when the work adds something the plan counts \(an ad campaign, a social profile, a marketing send\), where the plan stands \(`account_usage_get`\)\./);
  });

  test('negative control: a CLAUDE.md without the line or the block fails the checks', async () => {
    const claude = await accountClaudeMd(undefined);
    assert.throws(() => assertLimitLine(claude.replace(`\n  ${log.PLAN_LIMIT_PROSE}`, ''), 'without the line'));
    assert.throws(() => assertRulesSection(claude.replace(log.PLAN_USAGE_PROSE, flat(log.PLAN_USAGE_PROSE)), 'the block folded'));
  });
});

describe('the Codex AGENTS.md region', () => {
  for (const kind of ['account', 'project']) {
    test(`${kind} folder: the limit line right after the refused-write sentence, inside its budget`, async () => {
      const dir = await tmp('hk-plan-codex-');
      await codex.writeCodexScaffold({
        baseDir: dir, apiKey: KEY, baseUrl: BASE, accountLabel: 'Western Stairlifts', accountId: ACCOUNT, kind,
        projectName: 'Main site',
      });
      const agents = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
      assertLimitLine(agents, 'AGENTS.md');
      // Codex reads at most 32 KiB of instructions; the region leaves most of it to the user's own text.
      assert.ok(Buffer.byteLength(agents, 'utf8') < 8 * 1024, `AGENTS.md is ${Buffer.byteLength(agents, 'utf8')} bytes`);
    });
  }
});

describe('the daily brief', () => {
  for (const role of [undefined, ...ROLES.map((r) => r.id)]) {
    test(`role ${role ?? '(none)'}: may read account_usage_get, and puts a limit_kind answer in the brief`, async () => {
      const dir = await tmp('hk-plan-daily-');
      const written = await roleCommands.writeRoleSlashCommands(dir, role);
      assert.ok(written.includes('hiveku-daily'), 'every role, and no role, gets the daily brief');
      const daily = await fs.readFile(path.join(dir, '.claude', 'commands', 'hiveku-daily.md'), 'utf8');
      const allowed = daily.match(/^allowed-tools: (.*)$/m);
      assert.ok(allowed && allowed[1].split(', ').includes('mcp__hiveku__account_usage_get'), 'account_usage_get is a read tool of the brief');
      assert.doesNotMatch(daily, /entitlement\/plan message/);
      assert.match(
        flat(daily),
        /A tool that answers with `limit_kind` did nothing and is not a fault: never retry it; put one line in the brief for it, what waits \(its `message`\) and, for plan_limit, not_on_plan or ai_credits, the next plan and its number \(`account_usage_get`\)/,
      );
    });
  }
});

describe('the stale words are gone from the extension\'s own texts', () => {
  test('/hiveku-media: X posting is on every paid plan, by number, and a post past it moves to the 1st', async () => {
    const dir = await tmp('hk-plan-media-');
    await roleCommands.writeRoleSlashCommands(dir, undefined);
    const media = flat(await fs.readFile(path.join(dir, '.claude', 'commands', 'hiveku-media.md'), 'utf8'));
    assert.doesNotMatch(media, /Premium-gated/);
    assert.match(media, /X posting is on every paid plan, 5, 30 or 60 posts a month on Starter, Standard and Premium, and a scheduled X post past the number moves to the 1st of next month/);
  });

  test('the phone setup: voice_not_enabled means phones are not set up yet, never an add-on', () => {
    const voice = flat(setup.VOICE_SETUP);
    assert.doesNotMatch(voice, /add-on/i);
    assert.match(voice, /A 402 `voice_not_enabled` \(limit_kind setup\) means phones are not set up on the account yet, not an empty account: they come with every paid plan, and an owner or admin sets them up in Communications\./);
  });

  test('the Outbound first run says what the add-on costs and what its refusal means', () => {
    const outbound = flat(setup.OUTBOUND_SETUP);
    assert.match(outbound, /Outbound is a paid add-on at \$125 a month, by request \(hello@hiveku\.com\), and no plan includes it\./);
    assert.match(outbound, /outbound tools answer 402 `outbound_not_enabled` \(limit_kind add_on\): nothing was done/);
  });
});
