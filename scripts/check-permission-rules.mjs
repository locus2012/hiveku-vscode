#!/usr/bin/env node
/**
 * Guard: the scaffolded Claude Code permission allow-list must be (a) valid
 * glob syntax and (b) reads only.
 *
 * Two separate defects motivated this, both shipped for months:
 *
 *   1. Every rule was written REGEX-shaped — `mcp__hiveku__.*_get`. Claude Code
 *      permission rules are GLOBS: `*` is the only wildcard and `.` is literal,
 *      so those matched nothing. The block that exists to stop prompting on
 *      reads stopped none of it, silently. Two separate passes over this file
 *      each missed a subset, because a grep for `.*` right after the prefix
 *      does not catch `get_.*`.
 *
 *   2. Fixing the syntax naively opens a hole in the other direction. Glob `*`
 *      spans underscores, so `*_status` also matches `helpdesk_ticket_set_status`
 *      — a PATCH against a customer-facing ticket — which the list's own header
 *      promises is excluded.
 *
 * So syntax alone is not enough: this expands every rule against the REAL tool
 * registry and fails if any PATCH/PUT/DELETE tool would be auto-approved.
 *
 * Usage: node scripts/check-permission-rules.mjs   (exit 1 on any violation)
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const SRC = new URL('../src/knowledge.ts', import.meta.url).pathname;
const REGISTRY = new URL(
  '../../hiveku-mcp-api-server/dist/tools/olympus-tools.js',
  import.meta.url,
).pathname;

const src = readFileSync(SRC, 'utf8');
const rules = [...src.matchAll(/'(mcp__hiveku__[^']+)'/g)].map((m) => m[1]);

if (rules.length === 0) {
  console.error('✖ no mcp__hiveku__ permission rules found — did the allow-list move?');
  process.exit(1);
}

const problems = [];

// ── (a) syntax ────────────────────────────────────────────────────────────
// A '.' is literal in a glob, so any '.' inside a rule is a regex leftover.
for (const rule of rules) {
  const tail = rule.replace('mcp__hiveku__', '');
  if (tail.includes('.')) {
    problems.push(`${rule} — regex syntax; globs use '*' only ('.' is a literal dot, so this matches nothing)`);
  }
}

// ── (b) reads only ────────────────────────────────────────────────────────
if (!existsSync(REGISTRY)) {
  console.warn(
    '⚠ tool registry not built (../hiveku-mcp-api-server/dist) — syntax checked, ' +
      'read-only NOT verified. Run `npm run build` there to enable the full check.',
  );
} else {
  const require_ = createRequire(import.meta.url);
  const { olympusTools, hivekuMetaTools } = require_(REGISTRY);
  const all = [...olympusTools, ...hivekuMetaTools];
  const toRe = (glob) =>
    new RegExp(
      '^' +
        glob
          .split('*')
          .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*') +
        '$',
    );
  const approved = new Set();
  for (const rule of rules) {
    const re = toRe(rule.replace('mcp__hiveku__', ''));
    for (const t of all) if (re.test(t.name)) approved.add(t.name);
  }
  const mutating = all.filter(
    (t) => approved.has(t.name) && t.mapping && ['PATCH', 'PUT', 'DELETE'].includes(t.mapping.method),
  );
  for (const t of mutating) {
    problems.push(`${t.name} (${t.mapping.method}) is AUTO-APPROVED — the allow-list is documented as reads only`);
  }
  if (problems.length === 0) {
    console.log(`✓ ${rules.length} permission rules — ${approved.size} read tools auto-approved, 0 mutations`);
  }
}

if (problems.length) {
  console.error(`\n✖ ${problems.length} permission-rule problem(s) in src/knowledge.ts:\n`);
  for (const p of problems) console.error('   ' + p);
  console.error(
    '\n   Fix: use glob syntax (mcp__hiveku__*_get), and never let a glob span a\n' +
      '   mutating tool — enumerate the safe names instead (see the _status block).\n',
  );
  process.exit(1);
}
