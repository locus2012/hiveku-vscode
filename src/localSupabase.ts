/**
 * "Set up Local Supabase" — pull everything needed to run a project's database
 * locally with the Supabase CLI (`supabase start` + `supabase db reset`).
 *
 * Self-contained: works through Hiveku's MCP (no direct DB network access). It
 * introspects the project's Postgres via `database_query` (read-only) and
 * reconstructs faithful DDL — extensions, enums, tables, constraints (via
 * pg_get_constraintdef), indexes, functions, triggers — then layers RLS policies,
 * edge functions, auth/storage config and generated types into a `supabase/`
 * scaffold the developer (and Claude Code) can spin up offline.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { HivekuMcpClient } from './mcpClient';
import { extractRows, type Row } from './deptData';

type Log = (msg: string) => void;

async function q(client: HivekuMcpClient, projectId: string, sql: string): Promise<Row[]> {
  const raw = await client.callToolJson<unknown>('database_query', { project_id: projectId, sql });
  return extractRows(raw);
}
function unwrap(p: unknown): Record<string, unknown> {
  const d = p && typeof p === 'object' && 'data' in (p as Row) ? (p as { data: unknown }).data : p;
  return (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
}
function qi(name: unknown): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}
function colType(c: Row): string {
  const dt = String(c.data_type ?? '');
  const udt = String(c.udt_name ?? '');
  const len = c.character_maximum_length as number | null;
  if (dt === 'ARRAY') return mapUdt(udt.replace(/^_/, '')) + '[]';
  if (dt === 'USER-DEFINED') return qi(udt); // enum / composite type
  if (dt === 'character varying') return len ? `varchar(${len})` : 'varchar';
  if (dt === 'character') return len ? `char(${len})` : 'char';
  if (dt === 'numeric' && c.numeric_precision) return `numeric(${c.numeric_precision}${c.numeric_scale ? ',' + c.numeric_scale : ''})`;
  return dt; // integer, bigint, boolean, jsonb, text, uuid, date, timestamp with time zone, …
}
function mapUdt(u: string): string {
  const m: Record<string, string> = { int4: 'integer', int8: 'bigint', int2: 'smallint', bool: 'boolean', float8: 'double precision', float4: 'real', timestamptz: 'timestamptz', timestamp: 'timestamp', bpchar: 'char', varchar: 'varchar', text: 'text', uuid: 'uuid', jsonb: 'jsonb', json: 'json', numeric: 'numeric' };
  return m[u] ?? u;
}

const Q = {
  extensions: `SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname`,
  sequences: `SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public' ORDER BY sequence_name`,
  enums: `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY t.typname, e.enumsortorder`,
  columns: `SELECT c.table_name, c.column_name, c.is_nullable, c.column_default, c.data_type, c.udt_name, c.character_maximum_length, c.numeric_precision, c.numeric_scale, c.ordinal_position
    FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
    WHERE c.table_schema='public' ORDER BY c.table_name, c.ordinal_position`,
  constraints: `SELECT conrelid::regclass::text AS tbl, conname, contype::text AS contype, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype IN ('p','u','c','f')
    ORDER BY array_position(ARRAY['p','u','c','f'], contype::text), conrelid::regclass::text`,
  indexes: `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE contype IN ('p','u')) ORDER BY tablename, indexname`,
  functions: `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'`,
  triggers: `SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`,
};

async function buildSchemaSql(client: HivekuMcpClient, projectId: string, log: Log, warnings: string[]): Promise<string> {
  const parts: string[] = ['-- Reconstructed from the live project DB via Hiveku introspection.', '-- Applied by `supabase db reset`. Order: extensions → types → tables → constraints → indexes → functions → triggers.', ''];

  const safe = async (label: string, sql: string): Promise<Row[]> => {
    try {
      return await q(client, projectId, sql);
    } catch (e) {
      warnings.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  };

  log('extensions');
  const exts = await safe('extensions', Q.extensions);
  for (const e of exts) parts.push(`CREATE EXTENSION IF NOT EXISTS ${qi(e.extname)};`);
  if (exts.length) parts.push('');

  log('sequences');
  const seqs = await safe('sequences', Q.sequences);
  for (const s of seqs) parts.push(`CREATE SEQUENCE IF NOT EXISTS "public".${qi(s.sequence_name)};`);
  if (seqs.length) parts.push('');

  log('enums');
  const enums = await safe('enums', Q.enums);
  const byEnum = new Map<string, string[]>();
  for (const r of enums) {
    const k = String(r.typname);
    if (!byEnum.has(k)) byEnum.set(k, []);
    byEnum.get(k)!.push(String(r.enumlabel));
  }
  for (const [name, labels] of byEnum) parts.push(`CREATE TYPE ${qi(name)} AS ENUM (${labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ')});`);
  if (byEnum.size) parts.push('');

  log('tables');
  const cols = await safe('columns', Q.columns);
  const byTable = new Map<string, Row[]>();
  for (const c of cols) {
    const k = String(c.table_name);
    if (!byTable.has(k)) byTable.set(k, []);
    byTable.get(k)!.push(c);
  }
  for (const [table, tcols] of byTable) {
    const lines = tcols.map((c) => {
      let s = `  ${qi(c.column_name)} ${colType(c)}`;
      if (c.is_nullable === 'NO') s += ' NOT NULL';
      if (c.column_default != null && c.column_default !== '') s += ` DEFAULT ${c.column_default}`;
      return s;
    });
    parts.push(`CREATE TABLE IF NOT EXISTS "public".${qi(table)} (\n${lines.join(',\n')}\n);`);
  }
  if (byTable.size) parts.push('');

  log('constraints');
  const cons = await safe('constraints', Q.constraints);
  // PK/UNIQUE/CHECK right after tables; FOREIGN KEYs LAST (after indexes) so any
  // unique-via-index a FK references already exists.
  const fks = cons.filter((c) => c.contype === 'f');
  for (const c of cons.filter((c) => c.contype !== 'f')) parts.push(`ALTER TABLE ${c.tbl} ADD CONSTRAINT ${qi(c.conname)} ${c.def};`);
  if (cons.length) parts.push('');

  log('indexes');
  const idx = await safe('indexes', Q.indexes);
  for (const i of idx) parts.push(`${String(i.indexdef).replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS ').replace(/^CREATE UNIQUE INDEX /, 'CREATE UNIQUE INDEX IF NOT EXISTS ')};`);
  if (idx.length) parts.push('');

  if (fks.length) {
    parts.push('-- Foreign keys (after tables + indexes).');
    for (const c of fks) parts.push(`ALTER TABLE ${c.tbl} ADD CONSTRAINT ${qi(c.conname)} ${c.def};`);
    parts.push('');
  }

  log('functions');
  const fns = await safe('functions', Q.functions);
  for (const f of fns) parts.push(`${String(f.def)};\n`);

  log('triggers');
  const trs = await safe('triggers', Q.triggers);
  for (const t of trs) parts.push(`${String(t.def)};`);

  return parts.join('\n') + '\n';
}

async function buildPoliciesSql(client: HivekuMcpClient, projectId: string, warnings: string[]): Promise<string | null> {
  let rows: Row[] = [];
  try {
    rows = extractRows(await client.callToolJson<unknown>('supabase_policies_list', { project_id: projectId }));
  } catch (e) {
    warnings.push(`policies: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (!rows.length) return null;
  const tablesWithRls = new Set<string>();
  const lines: string[] = ['-- Row-Level Security policies (from pg_policies).', ''];
  for (const p of rows) {
    const tbl = `${qi(p.schemaname)}.${qi(p.tablename)}`;
    tablesWithRls.add(tbl);
    const cmd = String(p.cmd ?? 'ALL').toUpperCase();
    const roles = Array.isArray(p.roles) ? (p.roles as string[]).join(', ') : String(p.roles ?? 'public');
    let s = `CREATE POLICY ${qi(p.policyname)} ON ${tbl} AS ${p.permissive === 'PERMISSIVE' || p.permissive === true ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${cmd} TO ${roles}`;
    if (p.qual != null) s += ` USING (${p.qual})`;
    if (p.with_check != null) s += ` WITH CHECK (${p.with_check})`;
    lines.push(s + ';');
  }
  const enable = [...tablesWithRls].map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
  return ['-- Enable RLS, then policies.', ...enable, '', ...lines].join('\n') + '\n';
}

function configToml(slug: string, auth: Record<string, unknown>): string {
  const siteUrl = (auth.site_url as string) || 'http://localhost:3000';
  return `# Supabase local config — generated by Hiveku. Docs: https://supabase.com/docs/guides/cli/config
project_id = "${slug}"

[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 15

[studio]
enabled = true
port = 54323

[auth]
enabled = true
site_url = "${siteUrl}"
additional_redirect_urls = ["http://localhost:3000"]
jwt_expiry = ${Number(auth.jwt_expiry) || 3600}
enable_signup = ${auth.disable_signup ? 'false' : 'true'}

[auth.email]
enable_signup = ${auth.disable_signup ? 'false' : 'true'}
enable_confirmations = ${auth.mailer_autoconfirm === false ? 'true' : 'false'}

[storage]
enabled = true
file_size_limit = "50MiB"
`;
}

function readme(projectName: string, warnings: string[], counts: Record<string, number>): string {
  return `# Local Supabase for "${projectName}"

A self-contained Supabase scaffold pulled from this project's live database via Hiveku.
Run it locally with the Supabase CLI — no Hiveku connection needed once it's here.

## Run it
\`\`\`bash
# one-time: install the CLI + Docker (https://supabase.com/docs/guides/cli)
supabase start          # boots Postgres + Studio + Auth + Storage in Docker
supabase db reset       # applies migrations/ (schema + RLS) into the local DB
# Studio: http://localhost:54323   API: http://localhost:54321   DB: postgres://postgres:postgres@localhost:54322/postgres
\`\`\`
\`supabase stop\` when done. Edit \`migrations/\`, then \`supabase db reset\` to re-apply.

## What's here
- \`migrations/*_remote_schema.sql\` — ${counts.tables} tables, ${counts.constraints} constraints, ${counts.indexes} indexes, ${counts.functions} functions, ${counts.triggers} triggers, ${counts.enums} enum types.
- \`migrations/*_rls_policies.sql\` — ${counts.policies} Row-Level Security policies.
- \`functions/\` — ${counts.functions_edge} edge function(s).
- \`database.types.ts\` — generated TypeScript types for the schema.
- \`config.toml\` — local config (auth/storage reflect the remote settings).

## Caveats (reconstructed, not pg_dump)
The schema is rebuilt from live introspection, so it's faithful for tables, columns, types,
defaults, constraints (PK/FK/unique/check), indexes, enums, functions and triggers — but may
miss: views, materialized views, grants, seed/row data, and \`auth\`/\`storage\` schema objects
(Supabase creates those itself on \`supabase start\`). Add seed rows in \`seed.sql\` if you need them.
${warnings.length ? `\n## Warnings during pull\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}`;
}

export interface LocalSupabaseResult {
  written: string[];
  warnings: string[];
  hasDb: boolean;
}

export async function setupLocalSupabase(
  client: HivekuMcpClient,
  projectId: string,
  projectName: string,
  projectSlug: string,
  baseDir: string,
  onProgress: Log,
): Promise<LocalSupabaseResult> {
  const warnings: string[] = [];
  const written: string[] = [];

  // 1. Is there a database?
  onProgress('checking database');
  let status: Record<string, unknown> = {};
  try {
    status = unwrap(await client.callToolJson<unknown>('database_status', { project_id: projectId }));
  } catch (e) {
    warnings.push(`database_status: ${e instanceof Error ? e.message : String(e)}`);
  }
  const provisioned = status.provisioned ?? status.connected ?? status.has_database ?? status.provider;
  const tableCheck = await q(client, projectId, `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`).catch(() => []);
  const tableCount = Number((tableCheck[0]?.n as number) ?? 0);
  if (!provisioned && tableCount === 0) {
    return { written, warnings, hasDb: false };
  }

  const dir = path.join(baseDir, 'supabase');
  const migDir = path.join(dir, 'migrations');
  await fs.mkdir(migDir, { recursive: true });

  // 2. Schema
  const schemaSql = await buildSchemaSql(client, projectId, onProgress, warnings);
  await fs.writeFile(path.join(migDir, '20240101000000_remote_schema.sql'), schemaSql, 'utf8');
  written.push('migrations/20240101000000_remote_schema.sql');

  // 3. RLS policies
  onProgress('policies');
  const policies = await buildPoliciesSql(client, projectId, warnings);
  if (policies) {
    await fs.writeFile(path.join(migDir, '20240101000100_rls_policies.sql'), policies, 'utf8');
    written.push('migrations/20240101000100_rls_policies.sql');
  }

  // 4. Edge functions
  onProgress('edge functions');
  let edgeCount = 0;
  try {
    const fns = extractRows(await client.callToolJson<unknown>('supabase_edge_functions_list', { project_id: projectId }));
    for (const f of fns) {
      const slug = String(f.slug ?? f.name ?? '');
      if (!slug) continue;
      try {
        const src = unwrap(await client.callToolJson<unknown>('supabase_edge_functions_get_source', { project_id: projectId, slug }));
        const files = (src.files as Array<{ name: string; content: string }>) || null;
        const fnDir = path.join(dir, 'functions', slug);
        await fs.mkdir(fnDir, { recursive: true });
        if (files && Array.isArray(files)) {
          for (const file of files) await fs.writeFile(path.join(fnDir, file.name), String(file.content ?? ''), 'utf8');
        } else {
          await fs.writeFile(path.join(fnDir, 'index.ts'), String(src.source ?? src.content ?? '// source unavailable'), 'utf8');
        }
        edgeCount++;
      } catch (e) {
        warnings.push(`function ${slug}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (edgeCount) written.push(`functions/ (${edgeCount})`);
  } catch (e) {
    warnings.push(`edge functions: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 5. Auth config → config.toml
  onProgress('config');
  let auth: Record<string, unknown> = {};
  try {
    auth = unwrap(await client.callToolJson<unknown>('supabase_auth_config_get', { project_id: projectId }));
  } catch (e) {
    warnings.push(`auth config: ${e instanceof Error ? e.message : String(e)}`);
  }
  await fs.writeFile(path.join(dir, 'config.toml'), configToml(projectSlug, auth), 'utf8');
  written.push('config.toml');

  // 6. Storage buckets → seed.sql
  try {
    const buckets = extractRows(await client.callToolJson<unknown>('supabase_storage_list', { project_id: projectId }));
    if (buckets.length) {
      const ins = buckets.map((b) => `INSERT INTO storage.buckets (id, name, public) VALUES ('${b.id ?? b.name}', '${b.name ?? b.id}', ${b.public ? 'true' : 'false'}) ON CONFLICT (id) DO NOTHING;`);
      await fs.writeFile(path.join(dir, 'seed.sql'), ['-- Storage buckets (objects/rows not included).', ...ins].join('\n') + '\n', 'utf8');
      written.push('seed.sql');
    }
  } catch (e) {
    warnings.push(`storage: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 7. Generated types
  onProgress('types');
  try {
    const types = unwrap(await client.callToolJson<unknown>('supabase_gen_types', { project_id: projectId }));
    const t = (types.types as string) || '';
    if (t) {
      await fs.writeFile(path.join(dir, 'database.types.ts'), t, 'utf8');
      written.push('database.types.ts');
    }
  } catch (e) {
    warnings.push(`gen types: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 8. README — counts for the body
  const counts = {
    tables: (schemaSql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length,
    constraints: (schemaSql.match(/ADD CONSTRAINT/g) || []).length,
    indexes: (schemaSql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g) || []).length,
    functions: (schemaSql.match(/CREATE OR REPLACE FUNCTION|CREATE FUNCTION/g) || []).length,
    triggers: (schemaSql.match(/CREATE TRIGGER/g) || []).length,
    enums: (schemaSql.match(/CREATE TYPE/g) || []).length,
    policies: policies ? (policies.match(/CREATE POLICY/g) || []).length : 0,
    functions_edge: edgeCount,
  };
  await fs.writeFile(path.join(dir, 'README.md'), readme(projectName, warnings, counts), 'utf8');
  written.push('README.md');

  return { written, warnings, hasDb: true };
}
