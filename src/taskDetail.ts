/**
 * Task detail webview — opened by clicking a task in the sidebar or console.
 * Mirrors the Hiveku dashboard's task page: full fields, subtasks, annotation
 * screenshots, and the COMMENT THREAD (pm_task_comments_list) with an inline
 * composer. Edit actions (status/priority/assignee/due) run through native
 * pickers and pm_tasks_update.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import type { AccountRecord } from './accounts';
import * as api from './hivekuApi';
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

const TASK_STATUSES = ['todo', 'queued', 'in_progress', 'qa', 'ready_for_review', 'blocked', 'done'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

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

  let currentStatus = task.status ?? '';

  async function load(): Promise<void> {
    try {
      const client = await clientFor(account.accountId);
      const [raw, comments, subtasks] = await Promise.all([
        client.callToolJson<unknown>('pm_tasks_get', { id }),
        api.pmTaskComments(client, id).catch(() => [] as api.PmTaskComment[]),
        api.pmTaskSubtasks(client, id),
      ]);
      const d = unwrap(raw);
      currentStatus = str(d.status) || currentStatus;
      const fields: Array<{ label: string; value: string }> = [
        { label: 'Status', value: str(d.status) },
        { label: 'Priority', value: str(d.priority) },
        { label: 'Type', value: str(d.task_type) },
        { label: 'Due', value: d.due_date ? new Date(String(d.due_date)).toLocaleDateString() : '' },
        { label: 'Assigned to', value: str(d.assigned_to) },
        { label: 'Project', value: str(d.project) },
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
        subtasks: subtasks.map((s) => ({
          id: s.id,
          title: s.title || s.name || '(subtask)',
          status: s.status ?? '',
          done: ['done', 'completed', 'archived'].includes(String(s.status ?? '').toLowerCase()),
        })),
        comments: comments.map((c) => ({
          author: c.author_name || (c.agent_codename ? `${c.agent_codename} (agent)` : c.author_email || 'user'),
          content: c.content ?? '',
          when: c.created_at ? new Date(c.created_at).toLocaleString() : '',
          agent: !!c.agent_codename,
        })),
      });
    } catch (err) {
      panel.webview.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  function claudePrompt(): string {
    return `In Hiveku, work on PM task ${id} — "${task.title || task.name || ''}". Load it with pm_tasks_get({ id: "${id}" }) and the thread with pm_task_comments_list({ id: "${id}" }), do the work, then update it (pm_tasks_comment / pm_tasks_complete).`;
  }

  panel.webview.onDidReceiveMessage(async (msg: { type: string; url?: string; text?: string; id?: string }) => {
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
        await vscode.env.openExternal(vscode.Uri.parse(`${appUrl().replace(/\/+$/, '')}/${account.accountId}/dashboard/pm-projects?task=${id}`));
      } else if (msg.type === 'complete') {
        const ok = await vscode.window.showWarningMessage('Mark this task complete?', { modal: true }, 'Complete');
        if (ok !== 'Complete') return;
        await client.callToolJson('pm_tasks_complete', { id });
        vscode.window.showInformationMessage('Task completed.');
        await load();
        void vscode.commands.executeCommand('hiveku.refreshTree');
      } else if (msg.type === 'comment') {
        // Composer text arrives from the webview; fall back to a dialog when empty
        // (e.g. keyboard-shortcut invocations).
        const content = msg.text?.trim() || (await vscode.window.showInputBox({ prompt: 'Comment on this task' }));
        if (!content) {
          panel.webview.postMessage({ type: 'commentfail' });
          return;
        }
        try {
          await api.pmTaskComment(client, id, content);
        } catch (err) {
          panel.webview.postMessage({ type: 'commentfail' });
          throw err;
        }
        await load();
      } else if (msg.type === 'status') {
        const status = await vscode.window.showQuickPick(TASK_STATUSES, { placeHolder: `Status (now: ${currentStatus || '?'})` });
        if (!status) return;
        const wasDone = ['done', 'completed', 'archived'].includes(currentStatus.toLowerCase());
        if (status === 'done') await client.callToolJson('pm_tasks_complete', { id });
        else if (wasDone) await client.callToolJson('pm_tasks_uncomplete', { id, status });
        else await api.pmTaskUpdate(client, id, { status });
        await load();
        void vscode.commands.executeCommand('hiveku.refreshTree');
      } else if (msg.type === 'priority') {
        const priority = await vscode.window.showQuickPick(TASK_PRIORITIES, { placeHolder: 'Priority' });
        if (!priority) return;
        await api.pmTaskUpdate(client, id, { priority });
        await load();
      } else if (msg.type === 'assign') {
        const users = await api.accountUsers(client);
        if (users.length === 0) {
          vscode.window.showInformationMessage('No account users available to assign.');
          return;
        }
        const pick = await vscode.window.showQuickPick(
          [
            { label: '(unassign)', id: null as string | null },
            ...users.map((u) => ({
              label: [u.first_name ?? u.name, u.last_name].filter(Boolean).join(' ') || u.email || u.id || '?',
              description: u.email ?? '',
              id: (u.id ?? '') as string | null,
            })),
          ],
          { placeHolder: 'Assign to' },
        );
        if (pick === undefined) return;
        await api.pmTaskUpdate(client, id, { assigned_to_id: pick.id });
        await load();
      } else if (msg.type === 'due') {
        const due = await vscode.window.showInputBox({ prompt: 'Due date (YYYY-MM-DD, empty clears)', placeHolder: '2026-07-18' });
        if (due === undefined) return;
        await api.pmTaskUpdate(client, id, { due_date: due || null });
        await load();
      } else if (msg.type === 'opensub' && msg.id) {
        openTaskDetail(account, { id: msg.id }, clientFor, appUrl);
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
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; padding: 16px; max-width: 860px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 16px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; padding: 5px 11px; cursor: pointer; font-size: 12px; }
  button.ghost { background: transparent; color: var(--vscode-textLink-foreground); border: 1px solid var(--vscode-panel-border); }
  .row { display: flex; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--vscode-panel-border); font-size: 13px; }
  .row .k { opacity: .6; min-width: 110px; }
  .desc { margin-top: 16px; white-space: pre-wrap; font-size: 13px; line-height: 1.5; }
  .muted { opacity: .6; } .err { color: var(--vscode-errorForeground); }
  h2 { font-size: 13px; opacity: .7; margin: 20px 0 8px; font-weight: 600; }
  .sub { display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: 13px; cursor: pointer; }
  .sub:hover { color: var(--vscode-textLink-foreground); }
  .sub .st { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--vscode-input-background); }
  .sub.done { opacity: .55; text-decoration: line-through; }
  /* comment thread — mirrors the dashboard's card style */
  .comment { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; }
  .comment .who { font-size: 11px; opacity: .7; margin-bottom: 4px; display: flex; gap: 8px; }
  .comment .who .agentbadge { font-size: 9px; padding: 0 5px; border-radius: 6px; background: rgba(100,150,240,.2); }
  .comment .body { font-size: 13px; white-space: pre-wrap; line-height: 1.45; }
  .composer { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .composer textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 8px; font-size: 13px; font-family: var(--vscode-font-family); min-height: 64px; resize: vertical; }
  .composer .hint { font-size: 11px; opacity: .55; }
  .shots { margin-top: 18px; }
  .shot { margin-bottom: 14px; }
  .shot img { max-width: 100%; border-radius: 6px; border: 1px solid var(--vscode-panel-border); display: block; cursor: zoom-in; }
  .shot .cap { font-size: 12px; opacity: .7; margin-top: 4px; }
  .shot .pending { font-size: 12px; opacity: .6; padding: 10px; border: 1px dashed var(--vscode-panel-border); border-radius: 6px; }
</style></head><body>
<h1 id="title"></h1>
<div class="acts">
  <button id="copy">Copy for Claude Code</button>
  <button class="ghost" id="complete">Complete</button>
  <button class="ghost" id="status">Status</button>
  <button class="ghost" id="priority">Priority</button>
  <button class="ghost" id="assign">Assign</button>
  <button class="ghost" id="due">Due date</button>
  <button class="ghost" id="open">Open in Hiveku</button>
</div>
<div id="fields"><div class="muted">Loading…</div></div>
<div class="desc" id="desc"></div>
<div id="subs"></div>
<div id="thread"></div>
<div class="shots" id="shots"></div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;}
  document.getElementById('title').textContent = ${initial};
  ['copy','complete','status','priority','assign','due','open'].forEach(function(id){document.getElementById(id).addEventListener('click',function(){vscode.postMessage({type:id});});});
  window.addEventListener('message',function(ev){
    var m=ev.data, f=document.getElementById('fields');
    if(m.type==='error'){f.textContent='';f.appendChild(el('div','err',m.message));return;}
    if(m.type==='commentfail'){if(window.__send){window.__send.disabled=false;window.__send.textContent='Comment';}return;}
    if(m.type!=='task')return;
    document.getElementById('title').textContent=m.title;
    f.textContent='';
    (m.fields||[]).forEach(function(x){var r=el('div','row');r.appendChild(el('div','k',x.label));r.appendChild(el('div',null,x.value));f.appendChild(r);});
    document.getElementById('desc').textContent=m.description||'';
    var sb=document.getElementById('subs');sb.textContent='';
    var subs=(m.subtasks||[]);
    if(subs.length){
      sb.appendChild(el('h2',null,'Subtasks ('+subs.length+')'));
      subs.forEach(function(s){
        var r=el('div','sub'+(s.done?' done':''));
        r.appendChild(el('span','st',String(s.status||'').replace(/_/g,' ')));
        r.appendChild(el('span',null,s.title));
        r.addEventListener('click',function(){vscode.postMessage({type:'opensub',id:s.id});});
        sb.appendChild(r);
      });
    }
    var th=document.getElementById('thread');th.textContent='';
    var comments=(m.comments||[]);
    th.appendChild(el('h2',null,'Comments ('+comments.length+')'));
    if(!comments.length)th.appendChild(el('div','muted','No comments yet.'));
    comments.forEach(function(c){
      var box=el('div','comment');
      var who=el('div','who');
      who.appendChild(el('span',null,c.author));
      if(c.agent)who.appendChild(el('span','agentbadge','agent'));
      if(c.when)who.appendChild(el('span',null,c.when));
      box.appendChild(who);
      box.appendChild(el('div','body',c.content));
      th.appendChild(box);
    });
    var comp=el('div','composer');
    var ta=document.createElement('textarea');ta.placeholder='Write a comment…';
    var send=el('button',null,'Comment');
    window.__send=send;
    send.addEventListener('click',function(){
      var text=ta.value.trim();
      if(!text)return;
      send.disabled=true;send.textContent='Posting…';
      vscode.postMessage({type:'comment',text:text});
    });
    ta.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){send.click();}});
    comp.appendChild(ta);
    var rowb=el('div');rowb.style.display='flex';rowb.style.gap='8px';rowb.style.alignItems='center';
    rowb.appendChild(send);rowb.appendChild(el('span','hint','Cmd/Ctrl+Enter to post'));
    comp.appendChild(rowb);
    th.appendChild(comp);
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
