/**
 * The department registry is consumed by TWO clients and must not diverge.
 *
 *   source : hiveku-vscode/src/deptData.ts  (DEPARTMENTS)
 *   emitted: hiveku-vscode/src/dept-manifest.json  (gen-dept-manifest.mjs)
 *   mirror : hiveku-claude-plugin/lib/dept-manifest.json
 *
 * WHY. The plugin's copy was hand-made once on 2026-08-25 and drifted within two
 * days: it gained five outbound datasets the extension had never heard of, so an
 * extension user pulling that department silently got a half-empty result. Worse,
 * three departments' setup guidance diverged in ways that made the EXTENSION's
 * copy factually wrong — it told users to connect HeyReach for outbound when the
 * integration is SmartLead-only, and to pass `target_currency` to
 * accounting_vendor_create, which that endpoint rejects.
 *
 * Nothing detected either. That is what this exists to prevent.
 *
 * Compares SEMANTICALLY (key order and JSON formatting are irrelevant) and
 * reports the exact path of every difference, because "the manifests differ" is
 * not an actionable message when the file is 77KB.
 *
 * Usage:  node scripts/check-dept-manifest-drift.mjs
 * Override the mirror with HIVEKU_PLUGIN_PATH.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, '..', 'src', 'dept-manifest.json');
const MIRROR =
  process.env.HIVEKU_PLUGIN_PATH ||
  join(here, '..', '..', 'hiveku-claude-plugin', 'lib', 'dept-manifest.json');

if (!existsSync(MIRROR)) {
  // A missing sibling checkout is not a failure — this has to pass in CI for a
  // repo cloned on its own.
  console.log(`SKIP: plugin manifest not found at ${MIRROR} (sibling checkout absent)`);
  process.exit(0);
}

const src = JSON.parse(readFileSync(SOURCE, 'utf8'));
const mir = JSON.parse(readFileSync(MIRROR, 'utf8'));

const norm = (v) =>
  Array.isArray(v) ? v.map(norm)
  : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]))
    : v;

const byId = (arr) => Object.fromEntries((arr || []).map((d) => [d.id, d]));
const S = byId(src.departments);
const M = byId(mir.departments);
const diffs = [];

for (const id of [...new Set([...Object.keys(S), ...Object.keys(M)])].sort()) {
  if (!S[id]) { diffs.push(`department ${id}: in PLUGIN only`); continue; }
  if (!M[id]) { diffs.push(`department ${id}: in EXTENSION only`); continue; }
  for (const f of ['label', 'read_only', 'crud', 'setup', 'references']) {
    const a = JSON.stringify(norm(S[id][f]));
    const b = JSON.stringify(norm(M[id][f]));
    if (a !== b) {
      const which = (a?.length ?? 0) < (b?.length ?? 0) ? 'plugin is LONGER' : 'extension is LONGER';
      diffs.push(`${id}.${f}: differs (${which} — check which is factually current)`);
    }
  }
  const s = byId(S[id].datasets), m = byId(M[id].datasets);
  for (const d of [...new Set([...Object.keys(s), ...Object.keys(m)])].sort()) {
    if (!s[d]) diffs.push(`${id}/${d}: dataset in PLUGIN only — extension users lose this data`);
    else if (!m[d]) diffs.push(`${id}/${d}: dataset in EXTENSION only — plugin users lose this data`);
    else if (JSON.stringify(norm(s[d])) !== JSON.stringify(norm(m[d]))) {
      diffs.push(`${id}/${d}: dataset content differs`);
    }
  }
}

if (diffs.length === 0) {
  const n = src.departments.reduce((a, d) => a + (d.datasets?.length ?? 0), 0);
  console.log(`OK: department registry identical across both clients (${src.departments.length} departments, ${n} datasets)`);
  process.exit(0);
}

console.error(`FAIL: the department registry has drifted between the extension and the plugin.\n`);
for (const d of diffs) console.error(`  - ${d}`);
console.error(
  `\n  ${diffs.length} difference(s).\n` +
  `  source : ${SOURCE}\n  mirror : ${MIRROR}\n\n` +
  `  Fix: reconcile the content, run 'node scripts/gen-dept-manifest.mjs' here,\n` +
  `  and copy src/dept-manifest.json to the plugin's lib/dept-manifest.json.\n` +
  `  Do NOT just copy one over the other without reading the diff — each side has\n` +
  `  been the correct one at least once.`,
);
process.exit(1);
