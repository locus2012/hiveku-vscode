/**
 * Task detail webview — opened by clicking a task in the sidebar. Shows the full
 * task (via pm_tasks_get) and offers Complete / Comment / Copy-for-Claude / Open.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import type { AccountRecord } from './accounts';
import type { PmTask } from './hivekuApi';

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;
const panels = new Map<string, vscode.WebviewPanel>();

function unwrap(p: unknown): Record<string, unknown> {
  const d = p && typeof p === 'object' && 'data' in (p as Record<string, unknown>) ? (p as { data: unknown }).data : p;
  return (d && typeof d === 'object' ? (d as Record<string, unknown>) : {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return (v as Record<string, unknown>).name as string ?? (v as Record<string, unknown>).title as string ?? '';
  return String(v);
}

export function openTaskDetail(
  account: AccountRecord,
  task: PmTask,
  clientFor: ClientFor,
  appUrl: () => string,
): void {
  const id = task.id;
  const key = `${account.accountId}:${id}`;
  const existing = panels.get(key);
  if (existing) {
    existing.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'hivekuTask',
    `Task · ${task.title || task.name || id}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panels.set(key, panel);
  panel.onDidDispose(() => panels.delete(key));
  panel.webview.html = html(panel.webview, task);

  async function load(): Promise<void> {
    try {
      const client = await clientFor(account.accountId);
      const raw = await client.callToolJson<unknown>('pm_tasks_get', { id });
      const d = unwrap(raw);
      const fields: Array<{ label: string; value: string }> = [
        { label: 'Status', value: str(d.status) },
        { label: 'Priority', value: str(d.priority) },
        { label: 'Type', value: str(d.task_type) },
        { label: 'Due', value: d.due_date ? new Date(String(d.due_date)).toLocaleString() : '' },
        { label: 'Assigned to', value: str(d.assigned_to) },
        { label: 'Project', value: str(d.project) },
        { label: 'Subtasks', value: d.subtask_count != null ? String(d.subtask_count) : '' },
        { label: 'Created', value: d.created_at ? new Date(String(d.created_at)).toLocaleString() : '' },
      ].filter((f) => f.value);
      // Visual-feedback / annotation screenshots ride along on pm_tasks_get as an
      // `annotations` array — each has a public S3 screenshot_url (+ a status that
      // explains a missing one, since capture is async).
      const annotations = Array.isArray(d.annotations) ? (d.annotations as Array<Record<string, unknown>>) : [];
      const images = annotations.map((a) => ({
        url: typeof a.screenshot_url === 'string' ? a.screenshot_url : '',
        status: str(a.screenshot_status),
        caption: str(a.annotation_text) || str(a.page_title) || str(a.page_url),
        by: str(a.created_by_name) || str(a.created_by_email),
      }));
      panel.webview.postMessage({
        type: 'task',
        title: str(d.title) || task.title || task.name || '(task)',
        description: str(d.description),
        fields,
        images,
      });
    } catch (err) {
      panel.webview.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  function claudePrompt(): string {
    return `In Hiveku, work on PM task ${id} — "${task.title || task.name || ''}". Load it with pm_tasks_get({ id: "${id}" }), do the work, then update it (pm_tasks_comment / pm_tasks_complete).`;
  }

  panel.webview.onDidReceiveMessage(async (msg: { type: string; url?: string }) => {
    try {
      if (msg.type === 'openUrl' && msg.url) {
        await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        return;
      }
      const client = await clientFor(account.accountId);
      if (msg.type === 'load') {
        await load();
      } else if (msg.type === 'copy') {
        await vscode.env.clipboard.writeText(claudePrompt());
        vscode.window.setStatusBarMessage('$(check) Copied for Claude Code — paste into the chat', 2500);
      } else if (msg.type === 'open') {
        await vscode.env.openExternal(vscode.Uri.parse(`${appUrl().replace(/\/+$/, '')}/${account.accountId}/dashboard/pm-projects`));
      } else if (msg.type === 'complete') {
        const ok = await vscode.window.showWarningMessage('Mark this task complete?', { modal: true }, 'Complete');
        if (ok !== 'Complete') return;
        await client.callToolJson('pm_tasks_complete', { id });
        vscode.window.showInformationMessage('Task completed.');
        await load();
      } else if (msg.type === 'comment') {
        const content = await vscode.window.showInputBox({ prompt: 'Comment on this task' });
        if (!content) return;
        await client.callToolJson('pm_tasks_comment', { id, content });
        vscode.window.showInformationMessage('Comment added.');
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Hiveku: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

function html(webview: vscode.Webview, task: PmTask): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const csp = `default-src 'none'; img-src https: ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const initial = JSON.stringify(task.title || task.name || '(task)');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 16px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; padding: 5px 11px; cursor: pointer; font-size: 12px; }
  button.ghost { background: transparent; color: var(--vscode-textLink-foreground); border: 1px solid var(--vscode-panel-border); }
  .row { display: flex; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--vscode-panel-border); font-size: 13px; }
  .row .k { opacity: .6; min-width: 110px; }
  .desc { margin-top: 16px; white-space: pre-wrap; font-size: 13px; line-height: 1.5; }
  .muted { opacity: .6; } .err { color: var(--vscode-errorForeground); }
  .shots { margin-top: 18px; }
  .shots h2 { font-size: 13px; opacity: .7; margin: 0 0 8px; font-weight: 600; }
  .shot { margin-bottom: 14px; }
  .shot img { max-width: 100%; border-radius: 6px; border: 1px solid var(--vscode-panel-border); display: block; cursor: zoom-in; }
  .shot .cap { font-size: 12px; opacity: .7; margin-top: 4px; }
  .shot .pending { font-size: 12px; opacity: .6; padding: 10px; border: 1px dashed var(--vscode-panel-border); border-radius: 6px; }
</style></head><body>
<h1 id="title"></h1>
<div class="acts">
  <button id="copy">Copy for Claude Code</button>
  <button class="ghost" id="complete">Complete</button>
  <button class="ghost" id="comment">Comment</button>
  <button class="ghost" id="open">Open in Hiveku</button>
</div>
<div id="fields"><div class="muted">Loading…</div></div>
<div class="desc" id="desc"></div>
<div class="shots" id="shots"></div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;}
  document.getElementById('title').textContent = ${initial};
  ['copy','complete','comment','open'].forEach(function(id){document.getElementById(id).addEventListener('click',function(){vscode.postMessage({type:id});});});
  window.addEventListener('message',function(ev){
    var m=ev.data, f=document.getElementById('fields');
    if(m.type==='error'){f.textContent='';f.appendChild(el('div','err',m.message));return;}
    if(m.type!=='task')return;
    document.getElementById('title').textContent=m.title;
    f.textContent='';
    (m.fields||[]).forEach(function(x){var r=el('div','row');r.appendChild(el('div','k',x.label));r.appendChild(el('div',null,x.value));f.appendChild(r);});
    document.getElementById('desc').textContent=m.description||'';
    var s=document.getElementById('shots');s.textContent='';
    var imgs=(m.images||[]);
    if(imgs.length){
      s.appendChild(el('h2',null,'Screenshots'));
      imgs.forEach(function(im){
        var box=el('div','shot');
        if(im.url){
          var img=document.createElement('img');img.src=im.url;img.alt=im.caption||'annotation screenshot';
          img.addEventListener('click',function(){vscode.postMessage({type:'openUrl',url:im.url});});
          box.appendChild(img);
        } else {
          var st=im.status==='capturing'?'Screenshot is still being captured — reopen this task shortly.'
            :im.status==='failed'?'Screenshot capture failed for this annotation.'
            :'No screenshot for this annotation.';
          box.appendChild(el('div','pending',st));
        }
        var cap=(im.caption||'')+(im.by?(' — '+im.by):'');
        if(cap.trim())box.appendChild(el('div','cap',cap));
        s.appendChild(box);
      });
    }
  });
  vscode.postMessage({type:'load'});
</script></body></html>`;
}
