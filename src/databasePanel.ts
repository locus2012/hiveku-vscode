/**
 * Project Database panel — the click target for the Database tree node.
 *
 * Three states, all friendly (an empty project must never toast an error):
 *   unprovisioned → skeleton browser (ghost tables + rows) with a one-click
 *                   "Provision database" button and a copy-paste prompt that
 *                   has Claude Code / Codex provision AND design the schema.
 *   empty         → provisioned but zero tables; same AI prompt, minus provision.
 *   ready         → real read-only browser: table list → columns + first 50 rows.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import type { AccountRecord } from './accounts';
import * as api from './hivekuApi';

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;
const panels = new Map<string, vscode.WebviewPanel>();

function aiSetupPrompt(project: api.SiteSummary): string {
  return [
    `Set up the database for my Hiveku project "${project.name || project.slug || project.id}" (project_id: ${project.id}).`,
    '',
    '1. database_status({ project_id }) — if not provisioned, database_provision({ project_id }) (Hiveku-managed, idempotent).',
    '2. Read the project code (pages, forms, features) and design the MINIMAL schema that serves it — no speculative tables.',
    '3. Create it with database_execute({ project_id, sql }) — one CREATE TABLE per call; uuid pks (gen_random_uuid()), created_at timestamptz DEFAULT now().',
    '4. Seed 2-3 realistic rows per table with supabase_table_row_insert so the UI renders real content.',
    '5. Verify with database_tables + database_describe, then wire the app code to read from it.',
    '',
    'Guardrails: database_execute is NOT sandboxed — never DROP or ALTER anything you did not create in this session. Ask me before destructive changes.',
  ].join('\n');
}

export function openDatabasePanel(
  account: AccountRecord,
  project: api.SiteSummary,
  clientFor: ClientFor,
): void {
  const key = `${account.accountId}:${project.id}`;
  const existing = panels.get(key);
  if (existing) {
    existing.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'hivekuDatabase',
    `Database · ${project.name || project.slug || project.id}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panels.set(key, panel);
  panel.onDidDispose(() => panels.delete(key));
  panel.webview.html = html(panel.webview, project.name || project.slug || 'project');

  async function load(): Promise<void> {
    try {
      const client = await clientFor(account.accountId);
      let tables: string[];
      try {
        tables = await api.databaseTables(client, project.id);
      } catch (err) {
        if (api.isNoDatabaseError(err)) {
          panel.webview.postMessage({ type: 'state', kind: 'unprovisioned' });
          return;
        }
        throw err;
      }
      panel.webview.postMessage({ type: 'state', kind: tables.length === 0 ? 'empty' : 'ready', tables });
    } catch (err) {
      panel.webview.postMessage({
        type: 'state',
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  panel.webview.onDidReceiveMessage(async (msg: { type: string; table?: string }) => {
    try {
      const client = await clientFor(account.accountId);
      if (msg.type === 'ready' || msg.type === 'refresh') {
        await load();
      } else if (msg.type === 'provision') {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Provisioning Hiveku-managed database…' },
          () => api.databaseProvision(client, project.id),
        );
        vscode.window.showInformationMessage('Database provisioned — now let Claude Code or Codex design the schema (Copy AI setup prompt).');
        await load();
        void vscode.commands.executeCommand('hiveku.refreshTree');
      } else if (msg.type === 'copyai') {
        await vscode.env.clipboard.writeText(aiSetupPrompt(project));
        vscode.window.showInformationMessage('Database setup prompt copied — paste it into Claude Code or Codex in this account\'s workspace.');
      } else if (msg.type === 'table' && msg.table) {
        const [columns, result] = await Promise.all([
          api.databaseDescribe(client, project.id, msg.table),
          api.databaseQuery(client, project.id, `SELECT * FROM "${msg.table.replace(/"/g, '""')}" LIMIT 50`),
        ]);
        panel.webview.postMessage({ type: 'table', table: msg.table, columns, rows: result.rows, rowCount: result.rowCount });
      }
    } catch (err) {
      panel.webview.postMessage({
        type: 'tableerror',
        table: msg.table,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function html(webview: vscode.Webview, projectName: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const title = JSON.stringify(projectName);
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  html,body { height: 100%; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; display: flex; flex-direction: column; height: 100vh; }
  .head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border); }
  .head h1 { font-size: 13px; margin: 0; }
  .head .badge { font-size: 10px; padding: 1px 8px; border-radius: 8px; background: var(--vscode-input-background); opacity: .8; }
  .head .spacer { flex: 1; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 5px; padding: 4px 11px; cursor: pointer; font-size: 11px; }
  button.ghost { background: transparent; color: var(--vscode-textLink-foreground); border: 1px solid var(--vscode-panel-border); }
  .wrap { flex: 1; display: flex; min-height: 0; }
  .rail { flex: 0 0 200px; border-right: 1px solid var(--vscode-panel-border); overflow-y: auto; padding: 8px 0; background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background)); }
  .railhead { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; opacity: .5; padding: 2px 14px 6px; }
  .tbl { padding: 5px 14px; font-size: 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-left: 2px solid transparent; }
  .tbl:hover { background: var(--vscode-list-hoverBackground); }
  .tbl.active { border-left-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground, rgba(127,127,127,.12)); font-weight: 600; }
  .main { flex: 1; overflow: auto; padding: 14px 16px; position: relative; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th { text-align: left; font-weight: 600; opacity: .65; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  th .ty { font-weight: 400; opacity: .55; font-size: 10px; margin-left: 4px; }
  td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  .null { opacity: .4; font-style: italic; }
  .muted { opacity: .6; font-size: 12px; }
  .err { color: var(--vscode-errorForeground); font-size: 12px; white-space: pre-wrap; }
  /* ── skeleton (ghost) state ── */
  .ghost { background: var(--vscode-input-background); border-radius: 4px; animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: .5; } 50% { opacity: .9; } }
  .ghost-tbl { height: 14px; margin: 8px 14px; }
  .ghost-cell { height: 12px; }
  .ghost-grid { border-collapse: separate; border-spacing: 8px 10px; width: 100%; }
  /* ── overlay setup card ── */
  .card { position: absolute; top: 22%; left: 50%; transform: translateX(-50%); width: min(480px, 86%); background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 22px 24px; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
  .card h2 { font-size: 14px; margin: 0 0 8px; }
  .card p { font-size: 12px; line-height: 1.55; opacity: .85; margin: 0 0 10px; }
  .card ol { font-size: 12px; line-height: 1.6; opacity: .85; margin: 0 0 14px; padding-left: 18px; }
  .card .acts { display: flex; gap: 8px; flex-wrap: wrap; }
</style></head><body>
<div class="head">
  <h1>Database</h1>
  <span class="badge" id="badge">loading</span>
  <span class="spacer"></span>
  <button id="provision" style="display:none">Provision database</button>
  <button class="ghost" id="copyai">Copy AI setup prompt</button>
  <button class="ghost" id="refresh">Refresh</button>
</div>
<div class="wrap">
  <div class="rail" id="rail"></div>
  <div class="main" id="main"><div class="muted">Loading…</div></div>
</div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var PROJECT = ${title};
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;}
  function clear(n){while(n.firstChild)n.removeChild(n.firstChild);}
  var rail=document.getElementById('rail'), main=document.getElementById('main'), badge=document.getElementById('badge');
  var provisionBtn=document.getElementById('provision');
  var activeTable=null;
  document.getElementById('refresh').addEventListener('click',function(){vscode.postMessage({type:'refresh'});});
  document.getElementById('copyai').addEventListener('click',function(){vscode.postMessage({type:'copyai'});});
  provisionBtn.addEventListener('click',function(){provisionBtn.disabled=true;provisionBtn.textContent='Provisioning…';vscode.postMessage({type:'provision'});});

  function ghostRail(){
    clear(rail);
    rail.appendChild(el('div','railhead','Tables'));
    [90,120,70,110,80].forEach(function(w){var g=el('div','ghost ghost-tbl');g.style.width=w+'px';rail.appendChild(g);});
  }
  function ghostGrid(){
    var t=el('table','ghost-grid');
    for(var r=0;r<7;r++){
      var tr=el('tr');
      for(var c=0;c<5;c++){var td=el('td');var g=el('div','ghost ghost-cell');g.style.width=(40+((r*13+c*29)%60))+'%';td.appendChild(g);tr.appendChild(td);}
      t.appendChild(tr);
    }
    return t;
  }
  function setupCard(kind){
    var card=el('div','card');
    card.appendChild(el('h2',null,kind==='unprovisioned'?'No database yet':'Database ready — no tables yet'));
    card.appendChild(el('p',null,kind==='unprovisioned'
      ?PROJECT+' does not have a database. This is what it will look like once it does. Two ways to get there:'
      :'The database is provisioned but empty. Let your AI pair design the schema from the project\\'s actual needs:'));
    var ol=el('ol');
    if(kind==='unprovisioned'){
      var li1=el('li');li1.appendChild(document.createTextNode('One click: '));var b1=el('b',null,'Provision database');li1.appendChild(b1);li1.appendChild(document.createTextNode(' creates a Hiveku-managed Postgres for this project.'));ol.appendChild(li1);
    }
    var li2=el('li');li2.appendChild(document.createTextNode('Recommended: '));var b2=el('b',null,'Copy AI setup prompt');li2.appendChild(b2);li2.appendChild(document.createTextNode(' and paste it into Claude Code or Codex — it provisions, designs a schema from your pages and forms, creates the tables, and seeds sample rows.'));ol.appendChild(li2);
    card.appendChild(ol);
    var acts=el('div','acts');
    if(kind==='unprovisioned'){
      var pb=el('button',null,'Provision database');
      pb.addEventListener('click',function(){pb.disabled=true;pb.textContent='Provisioning…';vscode.postMessage({type:'provision'});});
      acts.appendChild(pb);
    }
    var cb=el('button',kind==='unprovisioned'?'ghost':null,'Copy AI setup prompt');
    cb.addEventListener('click',function(){vscode.postMessage({type:'copyai'});});
    acts.appendChild(cb);
    card.appendChild(acts);
    return card;
  }
  function renderSkeleton(kind){
    ghostRail();
    clear(main);
    main.appendChild(ghostGrid());
    main.appendChild(setupCard(kind));
  }
  function renderTables(tables){
    clear(rail);
    rail.appendChild(el('div','railhead','Tables ('+tables.length+')'));
    tables.forEach(function(t){
      var d=el('div','tbl'+(t===activeTable?' active':''),t);
      d.addEventListener('click',function(){activeTable=t;renderTables(tables);clear(main);main.appendChild(el('div','muted','Loading '+t+'…'));vscode.postMessage({type:'table',table:t});});
      rail.appendChild(d);
    });
    if(!activeTable){
      clear(main);
      main.appendChild(el('div','muted','Pick a table on the left — first 50 rows render here (read-only; writes go through Claude Code / Codex or your app).'));
    }
  }
  window.addEventListener('message',function(ev){
    var m=ev.data;
    if(m.type==='state'){
      provisionBtn.style.display=m.kind==='unprovisioned'?'':'none';
      provisionBtn.disabled=false;provisionBtn.textContent='Provision database';
      if(m.kind==='unprovisioned'){badge.textContent='not provisioned';activeTable=null;renderSkeleton('unprovisioned');}
      else if(m.kind==='empty'){badge.textContent='0 tables';activeTable=null;renderSkeleton('empty');}
      else if(m.kind==='ready'){badge.textContent=m.tables.length+' tables';if(activeTable&&m.tables.indexOf(activeTable)<0)activeTable=null;renderTables(m.tables);}
      else{badge.textContent='error';clear(main);main.appendChild(el('div','err',m.message||'Failed to load.'));}
      return;
    }
    if(m.type==='table'&&m.table===activeTable){
      clear(main);
      var head=el('div','muted');head.style.marginBottom='8px';
      head.textContent=m.table+' — showing '+m.rows.length+' row'+(m.rows.length===1?'':'s')+(m.rows.length>=50?' (first 50)':'');
      main.appendChild(head);
      var wrap=el('div');wrap.style.overflowX='auto';
      var t=el('table');var tr=el('tr');
      var cols=(m.columns||[]).map(function(c){return c.column_name;}).filter(Boolean);
      if(!cols.length&&m.rows.length)cols=Object.keys(m.rows[0]);
      (m.columns||[]).forEach(function(c){
        var th=el('th',null,c.column_name||'?');
        var ty=el('span','ty',c.data_type||'');th.appendChild(ty);
        tr.appendChild(th);
      });
      if(!(m.columns||[]).length)cols.forEach(function(c){tr.appendChild(el('th',null,c));});
      t.appendChild(tr);
      if(!m.rows.length){
        var r0=el('tr');var c0=el('td','muted','No rows yet.');c0.colSpan=Math.max(cols.length,1);r0.appendChild(c0);t.appendChild(r0);
      }
      m.rows.forEach(function(row){
        var r=el('tr');
        cols.forEach(function(c){
          var v=row[c];
          var td=el('td');
          if(v===null||v===undefined){td.appendChild(el('span','null','null'));}
          else{td.textContent=typeof v==='object'?JSON.stringify(v):String(v);td.title=td.textContent;}
          r.appendChild(td);
        });
        t.appendChild(r);
      });
      wrap.appendChild(t);main.appendChild(wrap);
      return;
    }
    if(m.type==='tableerror'){
      clear(main);
      main.appendChild(el('div','err',(m.table?m.table+': ':'')+(m.message||'Failed.')));
    }
  });
  vscode.postMessage({type:'ready'});
</script></body></html>`;
}
