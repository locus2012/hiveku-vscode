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
  error?: string;
  detailDir?: string;
  detailCount?: number;
  reference?: boolean;
}
export interface DeptResult {
  id: string;
  label: string;
  datasets: DatasetResult[];
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
    // A failed refresh must never clobber a good snapshot (mirrors the runner).
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
      rows,
    });
    const result: DatasetResult = { id: ds.id, label: ds.label, tool: ds.tool, count: rows.length, error };

    // Rich-document dump: one full-object file per row (workflow graphs, avatars, …).
    if (ds.detail && rows.length) {
      const det = ds.detail;
      const subdir = path.join(dir, det.dir ?? ds.id);
      const written = await mapLimit(rows, 2, async (r): Promise<boolean> => {
        const id = r[det.idKey ?? 'id'];
        if (id == null) return false;
        const { data, error: derr } = await fetchReference(client, det.detailTool, { [det.argKey ?? 'id']: id });
        if (derr) return false;
        const name = String(r[det.nameKey ?? 'name'] ?? id);
        await writeJson(path.join(subdir, `${slugify(name)}-${String(id).slice(0, 8)}.json`), data);
        return true;
      });
      result.detailDir = det.dir ?? ds.id;
      result.detailCount = written.filter(Boolean).length;
    }
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
  return { id: dept.id, label: dept.label, datasets: [...results, ...refs] };
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
  return out;
}

function deptReadme(dept: Department, results: DatasetResult[], refs: DatasetResult[], fetchedAt: string): string {
  const lines = results.map((r) => {
    const status = r.error ? `error: ${r.error}` : `${r.count} rows`;
    const detail = r.detailCount ? ` + \`${r.detailDir}/\` (${r.detailCount} full-object files)` : '';
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
