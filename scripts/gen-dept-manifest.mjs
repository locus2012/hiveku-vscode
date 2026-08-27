/**
 * Generate `dept-manifest.json` from DEPARTMENTS in src/deptData.ts.
 *
 * WHY THIS EXISTS. The department registry — 25 departments, ~120 datasets,
 * each naming an MCP tool — is consumed by TWO clients: this extension, and the
 * Claude Code plugin (hiveku-claude-plugin/lib/dept-manifest.json). It was
 * hand-copied once on 2026-08-25 and immediately began to drift: within two
 * days the plugin had six outbound datasets the extension had never heard of,
 * so an extension user pulling that department silently got less data than a
 * plugin user, with nothing anywhere saying so.
 *
 * The registry is the SOURCE. This emits the projection both clients share.
 * The plugin's copy must be byte-identical — enforced by
 * scripts/check-dept-manifest-drift.sh.
 *
 * `generated_at` is deliberately NOT emitted. A timestamp would make every
 * regeneration a diff, which defeats a byte-level drift check: the file would
 * always differ and nobody would be able to tell a real change from a re-run.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'src', 'dept-manifest.json');

const { DEPARTMENTS } = await import('../src/deptData.ts');

/** Drop undefined so an absent optional never becomes `"x": null`. */
const compact = (o) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

const dataset = (ds) =>
  compact({
    id: ds.id,
    label: ds.label,
    tool: ds.tool,
    args: ds.args,
    // camelCase in TypeScript, snake_case on the wire — the plugin's runner
    // reads dyn_args. Renaming either side silently breaks every rolling window.
    dyn_args: ds.dynArgs,
    // ALWAYS an array on the wire, even for a single step. The TypeScript type
    // is `ScopeStep | ScopeStep[]` for authoring convenience, but a consumer
    // that has to branch on "object or array?" will eventually get it wrong on
    // one side only. Normalising here is what lets the two copies be compared
    // byte-for-byte instead of semantically.
    scope: ds.scope ? (Array.isArray(ds.scope) ? ds.scope : [ds.scope]) : undefined,
    detail: ds.detail,
  });

const department = (d) =>
  compact({
    id: d.id,
    label: d.label,
    read_only: d.readOnly,
    crud: d.crud,
    setup: d.setup,
    references: d.references,
    datasets: (d.datasets ?? []).map(dataset),
  });

const manifest = {
  version: 1,
  default_departments: DEPARTMENTS.map((d) => d.id),
  departments: DEPARTMENTS.map(department),
};

const json = JSON.stringify(manifest, null, 2) + '\n';
let changed = true;
try {
  changed = readFileSync(OUT, 'utf8') !== json;
} catch {}
writeFileSync(OUT, json);

const datasets = manifest.departments.reduce((n, d) => n + (d.datasets?.length ?? 0), 0);
console.log(
  `${changed ? 'wrote' : 'unchanged'} ${OUT}\n` +
    `  departments: ${manifest.departments.length}\n` +
    `  datasets   : ${datasets}`,
);
