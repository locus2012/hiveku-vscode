/**
 * The module registry's shape and the pure helpers that read tool responses, shared by the VS Code
 * panel (panel.ts) and any other Hiveku client that renders the same registry (modules.ts). No vscode
 * import, so the registry can be used outside VS Code (the Hiveku desktop app vendors it).
 */

import type { HivekuMcpClient } from './mcpClient';

export type Row = Record<string, unknown>;

export interface FieldSpec {
  /** Row keys to try in order. Supports dot-paths (e.g. "stage.name", "_count.deals"). */
  keys: string[];
  label?: string;
  money?: boolean;
  /** Value is in integer cents (e.g. total_cents) — divide by 100 before formatting. */
  cents?: boolean;
  date?: boolean;
  /**
   * A DATE column (no time of day), serialized as UTC midnight. Rendered in the
   * viewer's zone that reads as the day BEFORE for everyone west of Greenwich,
   * so format it in UTC. Implies date.
   */
  dateOnly?: boolean;
}
export interface InputSpec {
  key: string;
  label: string;
  password?: boolean;
  /** Static pick list (e.g. ticket status). */
  options?: string[];
  /** Tool-backed pick list — fetch rows, pick a label, submit a value. */
  optionsTool?: { tool: string; args?: Record<string, unknown>; labelKeys: string[]; valueKeys: string[] };
  /** Split the typed value on commas into a string[] (e.g. social platforms). */
  csv?: boolean;
}
export interface ActionSpec {
  id: string;
  label: string;
  kind: 'tool' | 'open' | 'chat' | 'copy';
  tool?: string;
  args?: (row: Row) => Record<string, unknown>;
  inputs?: InputSpec[];
  confirm?: string;
  sub?: string | ((row: Row) => string);
  department?: string;
  successReload?: boolean;
  /** kind 'copy' — build a Claude-Code-ready prompt from the row, copied to clipboard. */
  copyTemplate?: (row: Row) => string;
  /**
   * kind 'tool' - refuse BEFORE the confirm modal and before any input prompt.
   * Return the reason (shown as a warning; the tool is not called) or null to
   * proceed. Mirrors the server's own refusals so the user reads "This post is
   * scheduled and approved; the cron publishes it at its slot." instead of a
   * raw 409 after already having said Confirm.
   */
  guard?: (row: Row) => string | null;
  /**
   * kind 'tool' - the completion message, built from the tool's response. The
   * default "<label> - done." is wrong for tools whose outcome depends on state:
   * social_publish_post either stages a post into the approval queue or
   * publishes it, and only the response says which.
   */
  done?: (result: unknown) => string;
  /**
   * kind 'tool' - a typed confirmation AFTER the modal, for actions that reach
   * real people. A modal's Confirm button is one click; a send to N recipients
   * should cost typing N. Return null when there is nothing to type, otherwise
   * the prompt and the exact string the user must enter; anything else, or
   * Escape, aborts without calling the tool.
   */
  confirmTyped?: (row: Row) => { prompt: string; expected: string } | null;
  /**
   * kind 'tool' - make the call(s) yourself instead of one callToolJson, for an
   * action whose answer can be a refusal the operator may override
   * (workflow_enable's 422 workflow_invalid). Runs after the guard, confirm
   * and input steps, with the same args. Return { result } when the action went
   * through (`done` and successReload apply as usual), or null when it stopped
   * and `run` has already told the user why.
   */
  run?: (
    client: HivekuMcpClient,
    args: Record<string, unknown>,
    ui: ActionUi,
  ) => Promise<{ result: unknown } | null>;
}
/** What an ActionSpec.run may show, without importing vscode into the registry. */
export interface ActionUi {
  /** The row's title ('' for a header action). */
  subject: string;
  progress<T>(title: string, task: () => Promise<T>): Promise<T>;
  /** Modal warning with one action button; true only when the operator chose it. */
  confirm(message: string, detail: string, button: string): Promise<boolean>;
  /** Modal warning with no choice to make. */
  warn(message: string, detail: string): Promise<void>;
  /** Non-modal information message; with a button, true only when the operator chose it. */
  inform(message: string, button?: string): Promise<boolean>;
  /** Open a page of this account's Hiveku dashboard; `sub` is the path below /<accountId>/dashboard/. */
  openDashboard(sub: string): Promise<void>;
}

export interface SectionSpec {
  id: string;
  label: string;
  tool: string;
  /**
   * Static args, or a function evaluated on EVERY load. A rolling window such as
   * "the next 60 days" must not freeze at the moment the module registry was
   * evaluated, which is extension activation, not the click.
   */
  args?: Record<string, unknown> | (() => Record<string, unknown>);
  /** pageAccess gate key — section hidden when the account's plan/role doesn't entitle it. */
  gate?: string;
  titleKeys: string[];
  /** Custom raw-response → rows mapping, for tools that don't return a row array
   *  (e.g. project_secrets_list with metadata_only returns `{ keys, variables }`). */
  transform?: (raw: unknown) => Array<Record<string, unknown>>;
  fields?: FieldSpec[];
  rowActions?: ActionSpec[];
  headerActions?: ActionSpec[];
  /**
   * Click a row's title to drill in: fetch this tool with the row id and show all fields.
   * Most tools take one id (idArg + idKeys). For tools that need several ids (e.g.
   * workflow_run_get wants workflow_id AND run_id) use argMap: { toolArg: [rowKey…] }.
   * transform reshapes the fetched object before its fields are printed (for
   * display only: the detail pane is read by a person, never sent to an AI).
   */
  detail?: {
    tool: string;
    idKeys?: string[];
    idArg?: string;
    argMap?: Record<string, string[]>;
    transform?: (obj: Record<string, unknown>) => Record<string, unknown>;
  };
  empty?: string;
}
export interface ModuleSpec {
  id: string;
  label: string;
  icon: string;
  /** Department grouping for the Operate menu (e.g. "Marketing", "Finance"). */
  group?: string;
  /** pageAccess gate key — module hidden in Operate when the account isn't entitled. */
  gate?: string;
  sections: SectionSpec[];
}

/** True if a gated key is entitled. No map (undefined) = show everything (ungated fallback). */
export function isEntitled(pageAccess: Record<string, boolean> | undefined, gate?: string): boolean {
  if (!gate) return true;
  if (!pageAccess) return true;
  return pageAccess[gate] !== false;
}

export function unwrap(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'data' in (payload as Row)) return (payload as { data: unknown }).data;
  return payload;
}

/** First array-valued property whose elements are objects (preferred), else first array. */
export function firstObjectArray(obj: Record<string, unknown>): unknown[] | undefined {
  let fallback: unknown[] | undefined;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object' && v[0] !== null) return v;
      if (!fallback) fallback = v;
    }
  }
  return fallback;
}

/**
 * Pull the row array out of a tool response. Tools wrap inconsistently:
 * `[...]`, `{ data: [...] }`, `{ data: { calls: [...] } }`, `{ projects: [...] }`,
 * `{ functions: [...] }`, `{ data: { domains: [...] } }`. We unwrap `data`, then
 * if that isn't an array, dig for the first object-array property (one level in
 * the unwrapped object, then the raw payload) so oddly-wrapped tools still render.
 */
/**
 * Rows from a tool payload, plus whether we actually RECOGNISED the shape.
 *
 * Returning a bare [] conflated two very different outcomes: "the account has
 * no deals" and "the response came back in a shape we do not understand". Both
 * rendered as "No deals." — so a parsing regression looked like a quiet client.
 */
export function extractRows(payload: unknown): { rows: Row[]; recognised: boolean } {
  const inner = unwrap(payload);
  if (Array.isArray(inner)) return { rows: inner as Row[], recognised: true };
  if (inner && typeof inner === 'object') {
    const a = firstObjectArray(inner as Record<string, unknown>);
    if (a) return { rows: a as Row[], recognised: true };
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const a = firstObjectArray(payload as Record<string, unknown>);
    if (a) return { rows: a as Row[], recognised: true };
  }
  // An explicitly empty envelope IS a real empty result — only an unparseable
  // shape is unrecognised.
  const emptyish =
    inner === null ||
    inner === undefined ||
    (inner && typeof inner === 'object' && Object.keys(inner as object).length === 0);
  return { rows: [], recognised: !!emptyish };
}

/** Resolve a possibly-dotted key path (e.g. "stage.name", "_count.deals"). */
export function getPath(row: Row, key: string): unknown {
  if (!key.includes('.')) return row[key];
  let cur: unknown = row;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}
export function pick(row: Row, keys: string[]): unknown {
  for (const k of keys) {
    const v = getPath(row, k);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}
export function fmt(v: unknown, f: FieldSpec): string {
  if (v === undefined || v === null) return '';
  if (f.money) {
    // Decimal columns serialize as strings; *_cents are integer cents.
    const raw = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isNaN(raw)) {
      const n = f.cents ? raw / 100 : raw;
      const a = Math.abs(n);
      if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
      return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
    }
  }
  if ((f.date || f.dateOnly) && (typeof v === 'string' || typeof v === 'number')) {
    const t = Date.parse(String(v));
    if (Number.isNaN(t)) return String(v);
    return f.dateOnly ? new Date(t).toLocaleDateString(undefined, { timeZone: 'UTC' }) : new Date(t).toLocaleDateString();
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}
