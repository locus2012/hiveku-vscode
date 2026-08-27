/**
 * Prove every department the connect consent page offers actually exists.
 *
 * WHY THIS EXISTS. The consent page's department checkboxes are the FIRST
 * permission decision a user ever makes in Hiveku — it is where an agency
 * operator says which parts of an account to bring down. Those checkboxes are
 * builder slugs (src/lib/departments.ts in hiveku_builder). What they actually
 * control is the local data pull, whose departments are a DIFFERENT registry
 * with different ids (src/deptData.ts here). BUILDER_TO_CONSOLE in src/roles.ts
 * is the bridge, and an unmapped slug falls through to itself.
 *
 * So a slug with no mapping and no matching department id is a checkbox that
 * does nothing. It ticks, it saves, it pulls nothing, and there is no error
 * anywhere — the user believes they selected a department and simply never
 * receives that data.
 *
 * Four such checkboxes exist today (see KNOWN_DEAD). This check does not fix
 * them, because what they SHOULD map to is a product decision, not a rename.
 * It stops a fifth from appearing silently, which is the failure mode that
 * produced these four.
 *
 * It also REPORTS (without failing) the departments that exist but can never be
 * selected at consent time. That list includes `commerce`, and it is the reason
 * granular permissions cannot be built on this surface as it stands: you cannot
 * grant or withhold what the consent page cannot express.
 *
 * Run: node scripts/check-connect-departments.mjs
 * Skips cleanly when the hiveku_builder checkout is absent.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const BUILDER =
  process.env.HIVEKU_BUILDER_PATH || join(here, '..', '..', 'hiveku_builder');
const BUILDER_DEPTS = join(BUILDER, 'src', 'lib', 'departments.ts');

if (!existsSync(BUILDER_DEPTS)) {
  console.log(`hiveku_builder checkout not present at ${BUILDER_DEPTS} — skipping`);
  process.exit(0);
}

/**
 * Consent slugs that resolve to nothing. Each is a checkbox a user can tick
 * that pulls no data. Listed rather than fixed because the right target is a
 * product call — `website_design` plausibly means `pages`, but the three brand
 * artifacts have no data department at all and inventing a mapping would make
 * the checkbox lie in a new way instead of an old one.
 *
 * A BASELINE, not an allowlist. Adding to it is a deliberate act with a review
 * attached; the check fails if an entry here starts resolving (stale baseline)
 * or stops existing (renamed out from under us), so the list cannot rot into
 * permanent cover for a growing problem.
 */
const KNOWN_DEAD = new Set([
  'before_after_grid',
  'customer_avatar',
  'customer_journey',
  'website_design',
]);

// ── the three registries ────────────────────────────────────────────────────

const { DEPARTMENTS: DATA_DEPTS } = await import('../src/deptData.ts');
const dataIds = new Set(DATA_DEPTS.map((d) => d.id));

/**
 * Parsed rather than imported: src/roles.ts imports './deptData' without a file
 * extension, which Node's ESM resolver refuses. The parse is validated below —
 * a format change fails loudly instead of quietly checking nothing.
 */
function parseBuilderToConsole() {
  const src = readFileSync(join(here, '..', 'src', 'roles.ts'), 'utf8');
  const start = src.indexOf('const BUILDER_TO_CONSOLE');
  if (start === -1) throw new Error('BUILDER_TO_CONSOLE not found in src/roles.ts');
  const open = src.indexOf('{', start);
  const close = src.indexOf('};', open);
  if (open === -1 || close === -1) throw new Error('could not bound the BUILDER_TO_CONSOLE literal');
  const body = src.slice(open + 1, close);
  const out = {};
  for (const m of body.matchAll(/^\s*([a-z_0-9]+)\s*:\s*\[([^\]]*)\]/gm)) {
    out[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return out;
}

const builderToConsole = parseBuilderToConsole();

/** Consent slugs, from the builder's registry. */
function parseBuilderSlugs() {
  const src = readFileSync(BUILDER_DEPTS, 'utf8');
  return [...new Set([...src.matchAll(/slug:\s*'([a-z_0-9-]+)'/g)].map((m) => m[1]))];
}

const slugs = parseBuilderSlugs();

// ── vacuity guards: a check that silently examines nothing is worse than none ─

const problems = [];
if (dataIds.size < 20) problems.push(`only ${dataIds.size} data departments parsed — expected ~25`);
if (slugs.length < 10) problems.push(`only ${slugs.length} consent slugs parsed — expected ~17`);
if (Object.keys(builderToConsole).length < 8) {
  problems.push(`only ${Object.keys(builderToConsole).length} BUILDER_TO_CONSOLE entries parsed — expected ~12`);
}
if (builderToConsole.seo?.[0] !== 'seo') {
  problems.push('BUILDER_TO_CONSOLE parse looks wrong: expected seo -> [seo, ...]');
}
if (problems.length) {
  console.error('FAIL: this check could not read its inputs, so it proved nothing.\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nFix the parser (or the registry format) before trusting a green run.');
  process.exit(2);
}

// ── the actual check ────────────────────────────────────────────────────────

const resolve = (slug) => builderToConsole[slug] ?? [slug];
const dead = slugs.filter((s) => !resolve(s).some((id) => dataIds.has(id)));

const newlyDead = dead.filter((s) => !KNOWN_DEAD.has(s));
const revived = [...KNOWN_DEAD].filter((s) => slugs.includes(s) && !dead.includes(s));
const vanished = [...KNOWN_DEAD].filter((s) => !slugs.includes(s));

const reachable = new Set(slugs.flatMap(resolve).filter((id) => dataIds.has(id)));
const unreachable = [...dataIds].filter((id) => !reachable.has(id)).sort();

console.log(`consent slugs: ${slugs.length}   data departments: ${dataIds.size}`);
console.log(`selectable at consent: ${reachable.size}/${dataIds.size}`);
if (unreachable.length) {
  console.log('');
  console.log(`NOT SELECTABLE at consent time (${unreachable.length}) — reachable only via a role:`);
  console.log(`  ${unreachable.join(' ')}`);
  console.log('  Informational, not a failure. This is the gap granular permissions');
  console.log('  will have to close: a consent page cannot grant or withhold what it');
  console.log('  cannot express.');
}

let failed = false;

if (newlyDead.length) {
  failed = true;
  console.error('');
  console.error(`FAIL: ${newlyDead.length} consent checkbox(es) resolve to no department:`);
  for (const s of newlyDead) console.error(`  ${s} -> [${resolve(s).join(', ')}] (none exist)`);
  console.error('');
  console.error('A user can tick these and receive nothing, with no error shown.');
  console.error('Add a mapping in src/roles.ts BUILDER_TO_CONSOLE, or remove the');
  console.error('department from the consent page in hiveku_builder.');
}

if (revived.length) {
  failed = true;
  console.error('');
  console.error(`FAIL: ${revived.length} entr(ies) in KNOWN_DEAD now resolve: ${revived.join(', ')}`);
  console.error('Good news — remove them from KNOWN_DEAD so the baseline stays honest.');
}

if (vanished.length) {
  failed = true;
  console.error('');
  console.error(`FAIL: ${vanished.length} KNOWN_DEAD entr(ies) no longer exist: ${vanished.join(', ')}`);
  console.error('The slug was renamed or removed. Drop it from KNOWN_DEAD.');
}

if (failed) process.exit(1);

console.log('');
console.log(
  dead.length
    ? `OK: no new dead checkboxes. ${dead.length} known: ${dead.join(', ')}`
    : 'OK: every consent checkbox resolves to a real department.',
);
