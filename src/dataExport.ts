/**
 * Department data export — pulls a department's operational data via MCP and
 * writes it to `hiveku-data/<dept>/<dataset>.json` in the workspace, plus a
 * README per department and a top-level index. The point: give Claude Code
 * LOCAL data to grep/analyze (SEO rankings, backlinks, CRM, ads, …) exactly
 * like it has local project code. Re-run any time to refresh.
 *
 * Not pushed to Hiveku's VCS (gitignored + in the workspace IGNORE_DIRS) — it's
 * a derived local cache of the account's own data, not project source.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { HivekuMcpClient } from './mcpClient';
import { Department, fetchDataset, fetchReference, slugify, mapLimit, type Row } from './deptData';
import { writeDataRunner } from './dataRunner';

export const DATA_DIR = 'hiveku-data';

export interface DatasetResult {
  id: string;
  label: string;
  tool: string;
  count: number;
  /** True when the source tool's row cap was hit — `count` is a floor, not a total. */
  truncated?: boolean;
  /** Server-reported total when it gives one, so a capped count can say so. */
  total?: number;
  error?: string;
  detailDir?: string;
  detailCount?: number;
  /**
   * Detail fetches that produced NO file. `detailCount` counts successes only,
   * so without this a half-written dump reads as a complete one.
   */
  detailFailed?: number;
  /** Distinct reasons behind `detailFailed` (first few) — one dead key repeats itself. */
  detailErrors?: string[];
  reference?: boolean;
}
export interface DeptResult {
  id: string;
  label: string;
  datasets: DatasetResult[];
  /** List datasets attempted (references excluded — those are static docs). */
  datasetCount: number;
  /** How many of those came back with an error. */
  failedCount: number;
  /**
   * Nothing usable came back for this department. Same rule as the generated
   * runner (dataRunner.ts): a department is OK when it has no list datasets
   * (references only) or at least one dataset that came back without an error.
   * Kept identical on purpose so the extension and `node .hiveku/pull-data.mjs`
   * never disagree about whether a refresh worked.
   */
  failed: boolean;
}

/** Every dataset that came back with an error, flattened across departments. */
export function failedDatasets(
  results: DeptResult[],
): Array<{ department: string; dataset: string; label: string; error: string }> {
  return results.flatMap((d) =>
    d.datasets
      .filter((x) => x.error)
      .map((x) => ({ department: d.id, dataset: x.id, label: x.label, error: String(x.error) })),
  );
}

/**
 * True when NO department produced usable data — the signature of a dead account
 * key rather than one flaky endpoint. Mirrors the runner's exit-1 condition.
 */
export function everyDepartmentFailed(results: DeptResult[]): boolean {
  return results.length > 0 && results.every((d) => d.failed);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** Export one department's datasets to hiveku-data/<dept>/. Returns per-dataset counts. */
export async function exportDepartment(
  client: HivekuMcpClient,
  dept: Department,
  baseDir: string,
  fetchedAt: string,
  onProgress?: (msg: string) => void,
): Promise<DeptResult> {
  const dir = path.join(baseDir, DATA_DIR, dept.id);
  const results: DatasetResult[] = [];

  let dsIndex = 0;
  for (const ds of dept.datasets) {
    // Gentle pacing: the background export shares the account's MCP rate
    // budget with live agent sessions — never burst.
    if (dsIndex++ > 0) await new Promise((r) => setTimeout(r, 250));
    onProgress?.(`${dept.label} · ${ds.label}`);
    const { rows, error, parents, total, truncated } = await fetchDataset(client, ds);
    if (truncated) onProgress?.(`${dept.label} · ${ds.label}: TRUNCATED at ${rows.length}${total ? ` of ${total}` : ''} rows`);
    const result: DatasetResult = {
      id: ds.id,
      label: ds.label,
      tool: ds.tool,
      count: rows.length,
      ...(truncated ? { truncated: true } : {}),
      ...(total != null ? { total } : {}),
      error,
    };

    // Rich-document dump: one full-object file per row (workflow graphs, avatars, …).
    // A per-row failure writes no file, so it MUST be counted — otherwise 40 boards
    // with 12 dead detail fetches report "28 full-object files" and read as complete.
    if (ds.detail && rows.length) {
      const det = ds.detail;
      const subdir = path.join(dir, det.dir ?? ds.id);
      const outcomes = await mapLimit(rows, 2, async (r): Promise<string | undefined> => {
        const id = r[det.idKey ?? 'id'];
        if (id == null) return `list row has no \`${det.idKey ?? 'id'}\` to fetch by`;
        const { data, error: derr } = await fetchReference(client, det.detailTool, { [det.argKey ?? 'id']: id });
        if (derr) return derr;
        const name = String(r[det.nameKey ?? 'name'] ?? id);
        try {
          await writeJson(path.join(subdir, `${slugify(name)}-${String(id).slice(0, 8)}.json`), data);
        } catch (err) {
          // A disk-side failure (ENOSPC, EPERM, an unusable slug) is one more
          // counted outcome, not an exception. Letting it escape mapLimit would
          // abort the whole department BEFORE the list snapshot below is
          // written, losing the very file this dump is an annex to.
          return err instanceof Error ? err.message : String(err);
        }
        return undefined;
      });
      const failures = outcomes.filter((o): o is string => o != null);
      result.detailDir = det.dir ?? ds.id;
      result.detailCount = outcomes.length - failures.length;
      if (failures.length) {
        result.detailFailed = failures.length;
        // Distinct reasons only: one revoked key produces the same message N times.
        result.detailErrors = [...new Set(failures)].slice(0, 3);
      }
    }

    // A failed refresh must never clobber a good snapshot (mirrors the runner).
    // Written AFTER the detail dump so the detail failures land in the file too.
    const dsFile = path.join(dir, `${ds.id}.json`);
    const hadSnapshot = error ? await fs.access(dsFile).then(() => true, () => false) : false;
    if (!hadSnapshot) await writeJson(dsFile, {
      dataset: ds.id,
      label: ds.label,
      tool: ds.tool,
      // ASCII separator — keep in sync with the generated runner (dataRunner.ts scoped_by).
      scoped_by: ds.scope ? (Array.isArray(ds.scope) ? ds.scope.map((s) => s.parentTool).join(' -> ') : ds.scope.parentTool) : null,
      parents: parents ?? null,
      count: rows.length,
      ...(total != null ? { total } : {}),
      ...(truncated ? { truncated: true } : {}),
      fetched_at: fetchedAt,
      ...(error ? { error } : {}),
      ...(result.detailDir ? { detail_dir: result.detailDir, detail_written: result.detailCount ?? 0 } : {}),
      ...(result.detailFailed ? { detail_failed: result.detailFailed, detail_errors: result.detailErrors ?? [] } : {}),
      rows,
    });
    results.push(result);
  }

  // Static reference docs (node catalogs, schemas) Claude Code needs to edit.
  const refs: DatasetResult[] = [];
  for (const ref of dept.references ?? []) {
    onProgress?.(`${dept.label} · ${ref.label}`);
    const { data, error } = await fetchReference(client, ref.tool, ref.args);
    await writeJson(path.join(dir, `${ref.id}.json`), data ?? {});
    refs.push({ id: ref.id, label: ref.label, tool: ref.tool, count: 0, error, reference: true });
  }

  if (dept.setup) await fs.writeFile(path.join(dir, 'SETUP.md'), dept.setup, 'utf8');
  await fs.writeFile(path.join(dir, 'README.md'), deptReadme(dept, results, refs, fetchedAt), 'utf8');
  const failedCount = results.filter((r) => r.error).length;
  return {
    id: dept.id,
    label: dept.label,
    datasets: [...results, ...refs],
    datasetCount: results.length,
    failedCount,
    // dataRunner.ts's rule, verbatim: references-only departments are never "failed",
    // and one surviving dataset means the department still produced something.
    failed: results.length > 0 && failedCount === results.length,
  };
}

/** Export several departments + write the top-level index. */
export async function exportDepartments(
  client: HivekuMcpClient,
  depts: Department[],
  baseDir: string,
  accountLabel: string,
  onProgress?: (msg: string) => void,
): Promise<DeptResult[]> {
  const fetchedAt = new Date().toISOString();
  const out: DeptResult[] = [];
  for (const dept of depts) {
    out.push(await exportDepartment(client, dept, baseDir, fetchedAt, onProgress));
  }
  await fs.writeFile(path.join(baseDir, DATA_DIR, 'README.md'), indexReadme(out, accountLabel, fetchedAt), 'utf8');
  // Keep the self-serve runner + manifest fresh so Claude Code can re-pull these
  // departments itself (node .hiveku/pull-data.mjs) without the extension.
  await writeDataRunner(baseDir).catch(() => undefined); // preserves existing role defaults

  // Machine-readable status alongside the human READMEs. An agent reading this
  // export has no other way to tell a FRESH empty dataset from a STALE one, or
  // a real zero from a capped page — both look like a small rows array.
  const datasets = out.flatMap((d) => d.datasets.map((x) => ({ department: d.id, ...x })));
  // MERGE, don't replace. The self-serve runner (.hiveku/pull-data.mjs) writes
  // this same file with per-department blocks keyed by dept id plus
  // updated_at/runner_version. Overwriting it would erase whatever the agent's
  // own last refresh recorded — and leave two incompatible shapes fighting over
  // one filename.
  const statusPath = path.join(baseDir, DATA_DIR, 'STATUS.json');
  let prior: Record<string, unknown> = {};
  try {
    prior = JSON.parse(await fs.readFile(statusPath, 'utf8')) as Record<string, unknown>;
  } catch {
    /* first export */
  }
  await writeJson(statusPath, {
    ...prior,
    account: accountLabel,
    fetched_at: fetchedAt,
    departments: out.map((d) => d.id),
    dataset_count: datasets.length,
    failed: datasets.filter((d) => d.error).map((d) => ({ department: d.department, dataset: d.id, error: d.error })),
    truncated: datasets
      .filter((d) => d.truncated)
      .map((d) => ({ department: d.department, dataset: d.id, returned: d.count, total: d.total ?? null })),
    // Per-row detail dumps fail independently of their list. Without this an
    // agent counts the files in the folder and reads the short count as the truth.
    detail_failed: datasets
      .filter((d) => d.detailFailed)
      .map((d) => ({
        department: d.department,
        dataset: d.id,
        dir: d.detailDir ?? null,
        written: d.detailCount ?? 0,
        failed: d.detailFailed,
        errors: d.detailErrors ?? [],
      })),
    note:
      'Snapshot, not live. `fetched_at` is when it was taken — re-run "Hiveku: Download Department Data" ' +
      '(or node .hiveku/pull-data.mjs) to refresh. Anything under `failed` was NOT fetched: its .json may be ' +
      'absent or a previous snapshot, so do not read an empty result there as "no data". Anything under ' +
      '`truncated` hit the source tool row cap — `returned` is a floor, not a total; call the live MCP tool ' +
      'with paging if the real count matters. Anything under `detail_failed` has FEWER files on disk than its ' +
      'list has rows: the missing objects were not fetched, so do not treat that folder as the complete set.',
    // Mirrors the runner's field so either writer refreshes the same marker.
    updated_at: fetchedAt,
  });
  return out;
}

function deptReadme(dept: Department, results: DatasetResult[], refs: DatasetResult[], fetchedAt: string): string {
  const lines = results.map((r) => {
    const status = r.error ? `error: ${r.error}` : `${r.count} rows`;
    const written = r.detailCount ?? 0;
    const detail = !r.detailDir
      ? ''
      : r.detailFailed
        ? ` + \`${r.detailDir}/\` (${written} of ${written + r.detailFailed} — ${r.detailFailed} failed: ${r.detailErrors?.[0] ?? 'no reason reported'})`
        : written
          ? ` + \`${r.detailDir}/\` (${written} full-object files)`
          : '';
    return `- \`${r.id}.json\` — ${r.label} (${status})${detail}. Tool: \`${r.tool}\`.`;
  });
  const refLines = refs.map((r) => `- \`${r.id}.json\` — ${r.label} (reference). Tool: \`${r.tool}\`.`);
  const setup = dept.setup ? `\n## Setup / connect\nSee \`SETUP.md\` in this folder for the exact steps to connect the integration(s).\n` : '';
  const crud = dept.crud
    ? `\n## CRUD — how to change this data\n${dept.crud}\n${setup}`
    : dept.readOnly
      ? `\n## Read-only\nThis department has no MCP write tools — analyze locally, but changes happen in the Hiveku dashboard.\n`
      : `\nTo act on this data (not just read it), call the live MCP tools (named per dataset above).\n`;
  return `# ${dept.label} — local data

Fetched ${fetchedAt} from Hiveku. List files are \`{ dataset, count, fetched_at, rows: [...] }\`;
detail folders hold one full-object JSON per item (rich documents). This is a SNAPSHOT —
grep/analyze freely; refresh it YOURSELF with \`node .hiveku/pull-data.mjs <dept>\`
(see /hiveku-pull-data), or via the Account Console "Download data".

## Datasets
${lines.join('\n')}
${refLines.length ? `\n## References\n${refLines.join('\n')}\n` : ''}${crud}
Scoped datasets tag each row with \`_parent\` (the project/connection/parent it came from).
`;
}

function indexReadme(results: DeptResult[], accountLabel: string, fetchedAt: string): string {
  const blocks = results.map((d) => {
    const rows = d.datasets.map((x) => `  - ${x.label}: ${x.error ? 'error' : `${x.count} rows`}`).join('\n');
    return `- **${d.label}** (\`${d.id}/\`)\n${rows}`;
  });
  return `# Hiveku account data — ${accountLabel}

Local snapshot of this account's operational data, for Claude Code to analyze like
project code. Fetched ${fetchedAt}. One folder per department; each \`.json\` is
\`{ dataset, count, fetched_at, rows: [...] }\`.

${blocks.join('\n\n')}

## Working with this data
- **Read/analyze** — grep these JSON files directly (e.g. find keywords ranking 4–10
  to target, backlinks below an authority threshold, deals stuck in a stage).
- **Act** — this is a snapshot; to change anything, call the live \`hiveku\` MCP tools
  (the source tool for each dataset is named in its folder's README).
- **Refresh** — re-run "Download data" in the Account Console, or the command
  "Hiveku: Download Department Data". Snapshots can go stale.
`;
}

/** Render rows to compact CSV-ish text isn't needed — JSON is the contract. */
export type { Row };
