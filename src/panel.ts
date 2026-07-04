/**
 * Generic, config-driven module panel — the engine behind "operate any Hiveku
 * department from VS Code". A ModuleSpec declares tabs (sections); each section
 * lists rows from one MCP tool and offers row/header actions (call a tool,
 * prompt for inputs, deep-link, or open department chat). This lets us cover
 * dozens of areas (CRM, SEO, PPC, Email, Helpdesk, PM, Workflows…) with small
 * declarative specs instead of a bespoke webview per area.
 *
 * Field/response shapes vary across tools, so FieldSpec tries multiple keys and
 * the renderer tolerates anything missing — panels degrade, they don't break.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import { openDepartmentChat } from './chat';
import type { AccountRecord } from './accounts';

type Row = Record<string, unknown>;

export interface FieldSpec {
  /** Row keys to try in order. Supports dot-paths (e.g. "stage.name", "_count.deals"). */
  keys: string[];
  label?: string;
  money?: boolean;
  /** Value is in integer cents (e.g. total_cents) — divide by 100 before formatting. */
  cents?: boolean;
  date?: boolean;
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
}
export interface SectionSpec {
  id: string;
  label: string;
  tool: string;
  args?: Record<string, unknown>;
  /** pageAccess gate key — section hidden when the account's plan/role doesn't entitle it. */
  gate?: string;
  titleKeys: string[];
  /** Custom raw-response → rows mapping, for tools that don't return a row array
   *  (e.g. project_secrets_list returns `{ secrets: { KEY: value } }`). */
  transform?: (raw: unknown) => Array<Record<string, unknown>>;
  fields?: FieldSpec[];
  rowActions?: ActionSpec[];
  headerActions?: ActionSpec[];
  /**
   * Click a row's title to drill in: fetch this tool with the row id and show all fields.
   * Most tools take one id (idArg + idKeys). For tools that need several ids (e.g.
   * workflow_run_get wants workflow_id AND run_id) use argMap: { toolArg: [rowKey…] }.
   */
  detail?: { tool: string; idKeys?: string[]; idArg?: string; argMap?: Record<string, string[]> };
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

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;

const panels = new Map<string, vscode.WebviewPanel>();

function unwrap(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'data' in (payload as Row)) return (payload as { data: unknown }).data;
  return payload;
}

/** First array-valued property whose elements are objects (preferred), else first array. */
function firstObjectArray(obj: Record<string, unknown>): unknown[] | undefined {
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
function extractRows(payload: unknown): Row[] {
  const inner = unwrap(payload);
  if (Array.isArray(inner)) return inner as Row[];
  if (inner && typeof inner === 'object') {
    const a = firstObjectArray(inner as Record<string, unknown>);
    if (a) return a as Row[];
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const a = firstObjectArray(payload as Record<string, unknown>);
    if (a) return a as Row[];
  }
  return [];
}

/** Resolve a possibly-dotted key path (e.g. "stage.name", "_count.deals"). */
function getPath(row: Row, key: string): unknown {
  if (!key.includes('.')) return row[key];
  let cur: unknown = row;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}
function pick(row: Row, keys: string[]): unknown {
  for (const k of keys) {
    const v = getPath(row, k);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}
function fmt(v: unknown, f: FieldSpec): string {
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
  if (f.date && (typeof v === 'string' || typeof v === 'number')) {
    const t = Date.parse(String(v));
    return Number.isNaN(t) ? String(v) : new Date(t).toLocaleDateString();
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

export function openModulePanel(
  account: AccountRecord,
  spec: ModuleSpec,
  clientFor: ClientFor,
  appUrl: () => string,
  /** Merged into every tool call — e.g. { project_id } for project-scoped modules. */
  context: Record<string, unknown> = {},
  /** Disambiguates the panel instance (e.g. per project). */
  instanceKey?: string,
  /** Account entitlements (pageAccess map) — sections gated by an unentitled key are hidden. */
  pageAccess?: Record<string, boolean>,
): void {
  // Drop sections the account's plan/role doesn't entitle. If that leaves
  // nothing, the area isn't in the plan — say so rather than open empty (or,
  // worse, fall back to showing locked sections).
  const gatedSections = spec.sections.filter((s) => isEntitled(pageAccess, s.gate));
  if (gatedSections.length === 0) {
    void vscode.window.showInformationMessage(`${spec.label} isn't included in ${account.label}'s current plan.`);
    return;
  }
  spec = { ...spec, sections: gatedSections };
  const key = `${account.accountId}:${spec.id}:${instanceKey ?? ''}`;
  const existing = panels.get(key);
  if (existing) {
    existing.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'hivekuModule',
    `Hiveku — ${spec.label} · ${account.label}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panels.set(key, panel);
  panel.onDidDispose(() => panels.delete(key));

  const dashBase = `${appUrl().replace(/\/+$/, '')}/${account.accountId}/dashboard`;
  const rowsBySection = new Map<string, Row[]>();

  panel.webview.html = panelHtml(panel.webview, spec);

  async function loadSection(sectionId: string): Promise<void> {
    const section = spec.sections.find((s) => s.id === sectionId);
    if (!section) return;
    try {
      const client = await clientFor(account.accountId);
      const res = await client.callToolJson<unknown>(section.tool, { ...context, ...(section.args ?? {}) });
      const rows: Row[] = section.transform ? section.transform(res) : extractRows(res);
      rowsBySection.set(sectionId, rows);
      panel.webview.postMessage({
        type: 'rows',
        section: sectionId,
        empty: section.empty ?? 'Nothing here.',
        detail: !!section.detail,
        header: (section.headerActions ?? []).map((a) => ({ id: a.id, label: a.label })),
        rows: rows.slice(0, 100).map((row, idx) => ({
          idx,
          title:
            typeof row === 'string' || typeof row === 'number'
              ? String(row)
              : String(pick(row, section.titleKeys) ?? '(item)'),
          fields: (section.fields ?? []).map((f) => ({
            label: f.label ?? '',
            value: fmt(pick(row, f.keys), f),
          })),
          actions: (section.rowActions ?? []).map((a) => ({ id: a.id, label: a.label })),
        })),
      });
    } catch (err) {
      panel.webview.postMessage({ type: 'error', section: sectionId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function runAction(section: SectionSpec, action: ActionSpec, row: Row | undefined): Promise<void> {
    if (action.kind === 'open') {
      const sub = typeof action.sub === 'function' ? action.sub(row ?? {}) : action.sub;
      await vscode.env.openExternal(vscode.Uri.parse(sub ? `${dashBase}/${sub}` : dashBase));
      return;
    }
    if (action.kind === 'chat' && action.department) {
      openDepartmentChat(account, action.department, clientFor);
      return;
    }
    if (action.kind === 'copy' && action.copyTemplate) {
      await vscode.env.clipboard.writeText(action.copyTemplate(row ?? {}));
      vscode.window.setStatusBarMessage('$(check) Copied for Claude Code — paste into the chat', 2500);
      return;
    }
    // tool action
    if (action.confirm) {
      const ok = await vscode.window.showWarningMessage(action.confirm, { modal: true }, 'Confirm');
      if (ok !== 'Confirm') return;
    }
    const client = await clientFor(account.accountId);
    const args: Record<string, unknown> = { ...context, ...(action.args ? action.args(row ?? {}) : {}) };
    for (const input of action.inputs ?? []) {
      if (input.options) {
        const choice = await vscode.window.showQuickPick(input.options, { placeHolder: input.label });
        if (choice === undefined) return;
        args[input.key] = choice;
      } else if (input.optionsTool) {
        const ot = input.optionsTool;
        const res = await client
          .callToolJson<unknown>(ot.tool, { ...context, ...(ot.args ?? {}) })
          .catch(() => [] as unknown);
        const rows = (unwrap(res) as Row[]) ?? [];
        const items = (Array.isArray(rows) ? rows : []).map((o) => ({
          label: String(pick(o, ot.labelKeys) ?? '(item)'),
          value: pick(o, ot.valueKeys),
        }));
        const choice = await vscode.window.showQuickPick(items, { placeHolder: input.label });
        if (choice === undefined) return;
        args[input.key] = choice.value;
      } else {
        const val = await vscode.window.showInputBox({ prompt: input.label, password: input.password });
        if (val === undefined) return;
        args[input.key] = input.csv ? val.split(',').map((s) => s.trim()).filter(Boolean) : val;
      }
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `${action.label}…` },
      () => client.callToolJson(action.tool as string, args),
    );
    vscode.window.showInformationMessage(`${action.label} — done.`);
    if (action.successReload !== false) await loadSection(section.id);
  }

  panel.webview.onDidReceiveMessage(async (msg: { type: string; section?: string; idx?: number; actionId?: string }) => {
    try {
      if (msg.type === 'load' && msg.section) {
        await loadSection(msg.section);
      } else if (msg.type === 'rowaction' && msg.section && msg.actionId !== undefined) {
        const section = spec.sections.find((s) => s.id === msg.section);
        const action = section?.rowActions?.find((a) => a.id === msg.actionId);
        const row = rowsBySection.get(msg.section)?.[msg.idx ?? -1];
        if (section && action) await runAction(section, action, row);
      } else if (msg.type === 'headeraction' && msg.section && msg.actionId) {
        const section = spec.sections.find((s) => s.id === msg.section);
        const action = section?.headerActions?.find((a) => a.id === msg.actionId);
        if (section && action) await runAction(section, action, undefined);
      } else if (msg.type === 'detail' && msg.section && msg.idx !== undefined) {
        const section = spec.sections.find((s) => s.id === msg.section);
        const row = rowsBySection.get(msg.section)?.[msg.idx];
        if (section?.detail && row) {
          const d = section.detail;
          const client = await clientFor(account.accountId);
          const idArgs: Record<string, unknown> = {};
          if (d.argMap) {
            for (const [arg, keys] of Object.entries(d.argMap)) idArgs[arg] = pick(row, keys);
          } else {
            idArgs[d.idArg ?? 'id'] = pick(row, d.idKeys ?? ['id']);
          }
          const res = await client.callToolJson<unknown>(d.tool, { ...context, ...idArgs });
          const obj = unwrap(res);
          const entries = obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.entries(obj as Row) : [];
          panel.webview.postMessage({
            type: 'detail',
            section: msg.section,
            title: String(pick(row, section.titleKeys) ?? 'Detail'),
            fields: entries.slice(0, 60).map(([k, v]) => ({
              label: k,
              value: v !== null && typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v ?? ''),
            })),
          });
        }
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Hiveku: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

function panelHtml(webview: vscode.Webview, spec: ModuleSpec): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const tabs = JSON.stringify(spec.sections.map((s) => [s.id, s.label]));
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; }
  .tabs { display: flex; gap: 2px; padding: 10px 14px 0; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; background: var(--vscode-editor-background); flex-wrap: wrap; }
  .tab { padding: 7px 12px; cursor: pointer; border-bottom: 2px solid transparent; opacity: .7; font-size: 13px; }
  .tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
  .toolbar { display: flex; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--vscode-panel-border); }
  .toolbar input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 5px; padding: 4px 8px; font-size: 12px; }
  #content { padding: 12px 14px; }
  .header { display: flex; justify-content: flex-end; gap: 6px; margin-bottom: 8px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .row .main { min-width: 0; }
  .row .title { font-size: 13px; }
  .row .fields { font-size: 11px; opacity: .65; margin-top: 2px; display: flex; gap: 10px; flex-wrap: wrap; }
  .row .acts { display: flex; gap: 6px; flex-shrink: 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 5px; padding: 3px 9px; cursor: pointer; font-size: 11px; }
  button.ghost { background: transparent; color: var(--vscode-textLink-foreground); }
  .muted { opacity: .6; padding: 10px 0; }
  .err { color: var(--vscode-errorForeground); }
</style></head><body>
<div class="tabs" id="tabs"></div>
<div class="toolbar"><input id="search" type="text" placeholder="Filter…" /><button id="refresh" class="ghost">↻ Refresh</button></div>
<div id="content"><div class="muted">Loading…</div></div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var TABS = ${tabs};
  var current = TABS.length ? TABS[0][0] : null;
  var tabsEl = document.getElementById('tabs');
  var content = document.getElementById('content');
  var searchEl = document.getElementById('search');
  var lastRows = [], lastHeader = [], lastDetail = false, lastEmpty = 'Nothing here.';
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;}
  function clear(n){while(n.firstChild)n.removeChild(n.firstChild);}
  function btn(label,cls,fn){var b=el('button',cls,label);b.addEventListener('click',fn);return b;}
  function renderTabs(){clear(tabsEl);TABS.forEach(function(t){var d=el('div','tab'+(t[0]===current?' active':''),t[1]);d.addEventListener('click',function(){select(t[0]);});tabsEl.appendChild(d);});}
  function select(id){current=id;renderTabs();searchEl.value='';content.textContent='Loading…';vscode.postMessage({type:'load',section:id});}
  searchEl.addEventListener('input',function(){renderRows(searchEl.value);});
  document.getElementById('refresh').addEventListener('click',function(){if(current)select(current);});

  function renderRows(filter){
    clear(content);
    if(lastHeader.length){var h=el('div','header');lastHeader.forEach(function(a){h.appendChild(btn(a.label,'',function(){vscode.postMessage({type:'headeraction',section:current,actionId:a.id});}));});content.appendChild(h);}
    var f=(filter||'').toLowerCase();
    var rows=lastRows.filter(function(r){if(!f)return true;var hay=r.title+' '+(r.fields||[]).map(function(x){return x.value;}).join(' ');return hay.toLowerCase().indexOf(f)>=0;});
    if(!rows.length){content.appendChild(el('div','muted',f?'No matches.':lastEmpty));return;}
    rows.forEach(function(r){
      var row=el('div','row');
      var main=el('div','main');
      var title=el('div','title',r.title);
      if(lastDetail){title.style.cursor='pointer';title.style.color='var(--vscode-textLink-foreground)';title.addEventListener('click',function(){vscode.postMessage({type:'detail',section:current,idx:r.idx});});}
      main.appendChild(title);
      var fields=(r.fields||[]).filter(function(x){return x.value;});
      if(fields.length){var fd=el('div','fields');fields.forEach(function(x){fd.appendChild(el('span',null,(x.label?x.label+': ':'')+x.value));});main.appendChild(fd);}
      row.appendChild(main);
      if(r.actions && r.actions.length){var acts=el('div','acts');r.actions.forEach(function(a){acts.appendChild(btn(a.label,'ghost',function(){vscode.postMessage({type:'rowaction',section:current,idx:r.idx,actionId:a.id});}));});row.appendChild(acts);}
      content.appendChild(row);
    });
  }

  window.addEventListener('message',function(ev){
    var m=ev.data; if(m.section!==current) return;
    if(m.type==='error'){clear(content);content.appendChild(el('div','err',m.message));return;}
    if(m.type==='detail'){
      clear(content);
      content.appendChild(btn('← Back','ghost',function(){renderRows(searchEl.value);}));
      var t=el('div','title',m.title);t.style.margin='6px 0 10px';t.style.fontWeight='600';content.appendChild(t);
      (m.fields||[]).forEach(function(f){if(!f.value)return;var r=el('div','row');r.appendChild(el('div','sub',f.label));var v=el('div',null,f.value);v.style.maxWidth='65%';v.style.textAlign='right';r.appendChild(v);content.appendChild(r);});
      return;
    }
    if(m.type!=='rows')return;
    lastRows=m.rows||[]; lastHeader=m.header||[]; lastDetail=!!m.detail; lastEmpty=m.empty||'Nothing here.';
    renderRows(searchEl.value);
  });
  renderTabs(); if(current) select(current);
</script></body></html>`;
}
