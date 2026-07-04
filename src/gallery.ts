/**
 * Account Media Library — a searchable thumbnail gallery over the account-wide
 * media library (`media_library_list`). Click a tile (or "Copy URL") to put its
 * hosted URL on the clipboard; "Open" views it in the browser. Search + media-type
 * filter run server-side so it scales to large libraries.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import type { AccountRecord } from './accounts';

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;

const panels = new Map<string, vscode.WebviewPanel>();

export function openMediaGallery(account: AccountRecord, clientFor: ClientFor): void {
  const key = account.accountId;
  const existing = panels.get(key);
  if (existing) {
    existing.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'hivekuMedia',
    `Hiveku Media — ${account.label}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panels.set(key, panel);
  panel.onDidDispose(() => panels.delete(key));
  panel.webview.html = galleryHtml(panel.webview);

  async function load(search: string, mediaType: string): Promise<void> {
    try {
      const client = await clientFor(account.accountId);
      const assets = await api.mediaLibraryList(client, {
        search: search || undefined,
        media_type: mediaType || undefined,
        limit: 300,
      });
      const items = assets
        .map((a) => ({
          url: a.file_url || a.external_url || '',
          name: a.title || a.original_filename || a.filename || '(asset)',
          mime: a.mime_type || '',
          kind: a.media_type || '',
          dims: a.width && a.height ? `${a.width}×${a.height}` : '',
          size: fmtSize(a.file_size),
        }))
        .filter((x) => x.url);
      panel.webview.postMessage({ type: 'assets', items });
    } catch (err) {
      panel.webview.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  panel.webview.onDidReceiveMessage(
    async (msg: { type: string; search?: string; mediaType?: string; url?: string }) => {
      if (msg.type === 'load') {
        await load(msg.search ?? '', msg.mediaType ?? '');
      } else if (msg.type === 'copy' && msg.url) {
        await vscode.env.clipboard.writeText(msg.url);
        vscode.window.setStatusBarMessage('$(check) Copied media URL', 2000);
      } else if (msg.type === 'open' && msg.url) {
        await vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
    },
  );
}

function fmtSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

function galleryHtml(webview: vscode.Webview): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  // Remote thumbnails need https/data image sources.
  const csp =
    `default-src 'none'; img-src ${webview.cspSource} https: data:; ` +
    `style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; }
  .bar { display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 1; }
  .bar input, .bar select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 5px; padding: 4px 8px; font-size: 12px; }
  .bar input { flex: 1; }
  .bar button { background: transparent; color: var(--vscode-textLink-foreground); border: none; cursor: pointer; font-size: 12px; }
  #count { font-size: 11px; opacity: .6; }
  #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; padding: 14px; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 8px; overflow: hidden; background: var(--vscode-editorWidget-background); display: flex; flex-direction: column; }
  .thumb { height: 120px; background: var(--vscode-input-background); display: flex; align-items: center; justify-content: center; cursor: pointer; overflow: hidden; }
  .thumb img { max-width: 100%; max-height: 100%; object-fit: cover; width: 100%; height: 100%; }
  .thumb .ext { font-size: 11px; opacity: .6; text-transform: uppercase; letter-spacing: .04em; }
  .meta { padding: 7px 8px; font-size: 11px; min-width: 0; }
  .meta .name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta .sub { opacity: .55; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .acts { display: flex; gap: 6px; padding: 0 8px 8px; }
  .acts button { flex: 1; background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-textLink-foreground)); border: 1px solid var(--vscode-panel-border); border-radius: 5px; padding: 3px 6px; cursor: pointer; font-size: 11px; }
  .muted { padding: 24px 14px; opacity: .6; }
  .err { padding: 24px 14px; color: var(--vscode-errorForeground); }
</style></head><body>
<div class="bar">
  <input id="search" type="text" placeholder="Search media (name / filename / alt)…" />
  <select id="type">
    <option value="">All types</option>
    <option value="image">Images</option>
    <option value="video">Video</option>
    <option value="audio">Audio</option>
    <option value="document">Documents</option>
  </select>
  <button id="refresh">↻ Refresh</button>
  <span id="count"></span>
</div>
<div id="grid"><div class="muted">Loading…</div></div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var grid = document.getElementById('grid');
  var searchEl = document.getElementById('search');
  var typeEl = document.getElementById('type');
  var countEl = document.getElementById('count');
  var timer = null;
  function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;}
  function clear(n){while(n.firstChild)n.removeChild(n.firstChild);}
  function load(){grid.textContent='';grid.appendChild(el('div','muted','Loading…'));vscode.postMessage({type:'load',search:searchEl.value,mediaType:typeEl.value});}
  function debounced(){if(timer)clearTimeout(timer);timer=setTimeout(load,350);}
  searchEl.addEventListener('input',debounced);
  searchEl.addEventListener('keydown',function(e){if(e.key==='Enter'){if(timer)clearTimeout(timer);load();}});
  typeEl.addEventListener('change',load);
  document.getElementById('refresh').addEventListener('click',load);

  function ext(item){var m=item.mime||'';var i=m.indexOf('/');var e=i>=0?m.slice(i+1):(item.kind||'file');return (e||'file').slice(0,5);}
  function isImg(item){return (item.kind==='image')||/^image\\//.test(item.mime||'');}

  function card(item){
    var c=el('div','card');
    var thumb=el('div','thumb');
    if(isImg(item)){
      // NB: no loading="lazy" — in a VS Code webview iframe the viewport detection
      // is unreliable, so lazy images below the fold never load. Eager + decode async.
      var img=document.createElement('img');img.src=item.url;img.alt=item.name;img.decoding='async';img.referrerPolicy='no-referrer';
      img.addEventListener('error',function(){if(img.parentNode){img.parentNode.removeChild(img);}thumb.appendChild(el('div','ext',ext(item)));});
      thumb.appendChild(img);
    }
    else{thumb.appendChild(el('div','ext',ext(item)));}
    thumb.title='Click to copy URL';
    thumb.addEventListener('click',function(){vscode.postMessage({type:'copy',url:item.url});});
    c.appendChild(thumb);
    var meta=el('div','meta');
    meta.appendChild(el('div','name',item.name));
    var sub=[item.mime,item.dims,item.size].filter(Boolean).join(' · ');
    meta.appendChild(el('div','sub',sub));
    c.appendChild(meta);
    var acts=el('div','acts');
    var copy=el('button',null,'Copy URL');copy.addEventListener('click',function(){vscode.postMessage({type:'copy',url:item.url});});
    var open=el('button',null,'Open');open.addEventListener('click',function(){vscode.postMessage({type:'open',url:item.url});});
    acts.appendChild(copy);acts.appendChild(open);
    c.appendChild(acts);
    return c;
  }

  window.addEventListener('message',function(ev){
    var m=ev.data;
    if(m.type==='error'){clear(grid);grid.appendChild(el('div','err',m.message));countEl.textContent='';return;}
    if(m.type!=='assets')return;
    clear(grid);
    var items=m.items||[];
    countEl.textContent=items.length?(items.length+' item'+(items.length===1?'':'s')):'';
    if(!items.length){grid.appendChild(el('div','muted',(searchEl.value||typeEl.value)?'No media match your search.':'No media in this account library yet.'));return;}
    items.forEach(function(it){grid.appendChild(card(it));});
  });
  load();
</script></body></html>`;
}
