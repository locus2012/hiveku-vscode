/**
 * Local visual review — annotate a captured preview screenshot with boxes/pins +
 * comments, hit-test each against the captured DOM map (dom.json) to attach the
 * real element (selector + text + classes + data-hiveku-source file/line), and
 * save to .hiveku/review/<slug>/annotations.json for Claude Code (/hiveku-review)
 * to fix. No app chat, no annotation server — everything is local + gitignored.
 *
 * Capture (screenshot.png + dom.json + capture.json) is produced by Claude Code
 * via Playwright (the extension can't drive a browser); this module only reads
 * those, provides the annotate UI, and writes annotations.json + index.json.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

interface CaptureMeta {
  viewport?: { width: number; height: number };
  scrollY?: number;
  fullPage?: boolean;
  fullPageHeight?: number;
  pageUrl?: string;
}
interface DomFile {
  pageMetrics?: Record<string, unknown>;
  elements?: unknown[];
}
interface IndexFile {
  version?: number;
  projectId?: string;
  projectName?: string;
  pages?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const panels = new Map<string, vscode.WebviewPanel>();

/** List captured page slugs under .hiveku/review (folders that have a screenshot). */
export async function listReviewPages(root: string): Promise<string[]> {
  const dir = path.join(root, '.hiveku', 'review');
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const slugs: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        // Only list pages that are fully annotatable (all three capture artifacts),
        // so the picker never dead-ends on a partial capture.
        await fs.access(path.join(dir, e.name, 'screenshot.png'));
        await fs.access(path.join(dir, e.name, 'dom.json'));
        await fs.access(path.join(dir, e.name, 'capture.json'));
        slugs.push(e.name);
      } catch {
        /* incomplete capture — skip */
      }
    }
    return slugs.sort();
  } catch {
    return [];
  }
}

export async function openReviewAnnotator(root: string, projectName: string, slugArg?: string): Promise<void> {
  const reviewDir = path.join(root, '.hiveku', 'review');
  let slug = slugArg;
  if (!slug) {
    const slugs = await listReviewPages(root);
    if (slugs.length === 0) {
      vscode.window.showWarningMessage(
        'No captured pages yet. In Claude Code, run /hiveku-review and ask it to capture a page first (it screenshots the preview + records the DOM).',
      );
      return;
    }
    slug = slugs.length === 1 ? slugs[0] : await vscode.window.showQuickPick(slugs, { placeHolder: 'Which captured page do you want to annotate?' });
    if (!slug) return;
  }

  const pageDir = path.join(reviewDir, slug);
  const capture = await readJson<CaptureMeta>(path.join(pageDir, 'capture.json'));
  const dom = await readJson<DomFile>(path.join(pageDir, 'dom.json'));
  if (!capture || !dom) {
    vscode.window.showWarningMessage(
      `No capture data for "${slug}". Re-run the capture step in Claude Code (/hiveku-review) so screenshot.png + dom.json + capture.json exist.`,
    );
    return;
  }
  const existing = await readJson<{ annotations?: unknown[] }>(path.join(pageDir, 'annotations.json'));

  const key = `${root}::${slug}`;
  const open = panels.get(key);
  if (open) {
    open.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'hivekuReview',
    `Review — ${slug} · ${projectName}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.file(reviewDir)] },
  );
  panels.set(key, panel);
  panel.onDidDispose(() => panels.delete(key));

  const imgUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(pageDir, 'screenshot.png'))).toString();
  panel.webview.html = reviewHtml(panel.webview);

  panel.webview.onDidReceiveMessage(async (msg: { type?: string; annotations?: unknown[] }) => {
    if (msg.type === 'ready') {
      panel.webview.postMessage({
        type: 'init',
        imgUri,
        capture,
        elements: Array.isArray(dom.elements) ? dom.elements : [],
        annotations: Array.isArray(existing?.annotations) ? existing!.annotations : [],
        pageUrl: capture.pageUrl ?? '',
        slug,
      });
    } else if (msg.type === 'save' && Array.isArray(msg.annotations)) {
      try {
        await saveAnnotations(reviewDir, slug!, capture, msg.annotations);
        vscode.window.showInformationMessage(
          `Saved ${msg.annotations.length} annotation(s) to .hiveku/review/${slug} — run /hiveku-review in Claude Code to fix them.`,
        );
        panel.dispose();
      } catch (e) {
        vscode.window.showErrorMessage(`Could not save annotations: ${(e as Error).message}`);
      }
    }
  });
}

async function saveAnnotations(reviewDir: string, slug: string, capture: CaptureMeta, annotations: unknown[]): Promise<void> {
  const savedAt = new Date().toISOString();
  await writeJson(path.join(reviewDir, slug, 'annotations.json'), {
    version: 1,
    page: { slug, pageUrl: capture.pageUrl ?? '', screenshot: 'screenshot.png', dom: 'dom.json' },
    savedAt,
    annotations,
  });

  // Recompute this page's row in index.json (counts drive any future tree/badges).
  const idxFile = path.join(reviewDir, 'index.json');
  const idx = (await readJson<IndexFile>(idxFile)) ?? { version: 1, pages: [] };
  const pages = Array.isArray(idx.pages) ? idx.pages : [];
  let open = 0;
  let resolved = 0;
  for (const a of annotations) ((a as { status?: string })?.status === 'resolved' ? resolved++ : open++);
  const at = pages.findIndex((p) => p && p.slug === slug);
  // Preserve the ORIGINAL capture timestamp (set by the capture step); only the
  // annotate-save time changes on re-save.
  const prior = at >= 0 ? pages[at] : undefined;
  const capturedAt = prior && typeof prior.capturedAt === 'string' ? prior.capturedAt : savedAt;
  const row = {
    slug,
    pageUrl: capture.pageUrl ?? '',
    capturedAt,
    savedAt,
    annotationCount: annotations.length,
    openCount: open,
    resolvedCount: resolved,
  };
  if (at >= 0) pages[at] = { ...pages[at], ...row };
  else pages.push(row);
  await writeJson(idxFile, { ...idx, version: 1, pages });
}

function reviewHtml(webview: vscode.Webview): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  // Local PNG only — served via asWebviewUri, so img-src needs cspSource (no https/data).
  const csp =
    `default-src 'none'; img-src ${webview.cspSource}; ` +
    `style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; background: var(--vscode-editor-background); }
  .bar { display: flex; gap: 10px; align-items: center; padding: 8px 14px; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 5; flex-wrap: wrap; }
  .bar .seg { display: flex; gap: 4px; align-items: center; }
  .bar label { font-size: 12px; opacity: .8; }
  .bar select, .bar button { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 5px; padding: 4px 8px; font-size: 12px; cursor: pointer; }
  .bar button.mode.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
  .bar button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
  .bar .hint { font-size: 11px; opacity: .6; }
  #count { font-size: 11px; opacity: .7; margin-left: auto; }
  #wrap { display: flex; align-items: flex-start; }
  #stage { position: relative; flex: 1; overflow: auto; padding: 14px; }
  #container { position: relative; display: inline-block; box-shadow: 0 0 0 1px var(--vscode-panel-border); }
  #image { display: block; max-width: 100%; height: auto; }
  #overlay { position: absolute; left: 0; top: 0; cursor: crosshair; }
  #side { width: 300px; flex: 0 0 300px; border-left: 1px solid var(--vscode-panel-border); max-height: 100vh; overflow: auto; padding: 10px 12px; }
  #side h3 { font-size: 12px; margin: 4px 0 8px; opacity: .8; }
  .anno { border: 1px solid var(--vscode-panel-border); border-radius: 7px; padding: 8px; margin-bottom: 8px; background: var(--vscode-editorWidget-background); }
  .anno .n { display: inline-flex; width: 18px; height: 18px; border-radius: 50%; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 11px; align-items: center; justify-content: center; margin-right: 6px; }
  .anno .cm { font-size: 12px; margin: 4px 0; white-space: pre-wrap; }
  .anno .el { font-size: 11px; opacity: .7; word-break: break-all; }
  .anno .el.no { color: var(--vscode-descriptionForeground); font-style: italic; }
  .anno .rm { float: right; background: transparent; border: none; color: var(--vscode-errorForeground); cursor: pointer; font-size: 11px; }
  .editor { position: absolute; z-index: 10; width: 260px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-focusBorder); border-radius: 8px; padding: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
  .editor textarea { width: 100%; box-sizing: border-box; min-height: 54px; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 5px; font-family: var(--vscode-font-family); font-size: 12px; padding: 6px; }
  .editor .row { display: flex; gap: 6px; margin-top: 6px; }
  .editor select { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 5px; font-size: 11px; padding: 3px; }
  .editor .el { font-size: 11px; opacity: .7; margin-top: 6px; word-break: break-all; }
  .editor .btns { display: flex; gap: 6px; margin-top: 8px; }
  .editor button { flex: 1; border-radius: 5px; padding: 4px; font-size: 12px; cursor: pointer; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
  .editor button.ok { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
  #empty { padding: 24px; opacity: .6; }
</style></head><body>
<div class="bar">
  <div class="seg">
    <button id="mRect" class="mode active">Box</button>
    <button id="mPin" class="mode">Pin</button>
  </div>
  <span class="hint">Drag a box or drop a pin on the screenshot, then type a comment.</span>
  <button id="save" class="primary">Save annotations</button>
  <span id="count"></span>
</div>
<div id="wrap">
  <div id="stage">
    <div id="empty">Loading capture…</div>
    <div id="container" style="display:none">
      <img id="image" />
      <canvas id="overlay"></canvas>
    </div>
  </div>
  <div id="side"><h3>Annotations</h3><div id="list"></div></div>
</div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var MODE = 'rect';
  var elements = [];   // dom.json element map (PAGE coords)
  var capture = {};    // capture.json
  var annos = [];      // {id,type,region,comment,priority,annotationType,status,resolvedAt,element}
  var img = document.getElementById('image');
  var overlay = document.getElementById('overlay');
  var ctx = overlay.getContext('2d');
  var container = document.getElementById('container');
  var listEl = document.getElementById('list');
  var countEl = document.getElementById('count');
  var editorEl = null;
  var drag = null; // {x0,y0,x1,y1} in canvas px while dragging a box

  function uuid(){ if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); return 'a'+Math.floor(Math.random()*1e9).toString(16)+Date.now().toString(16); }
  function dpr(){ return capture.devicePixelRatio || 1; }
  // Fallbacks divide the (device-px) natural dims by dpr so they stay in CSS px,
  // matching the dom.json rects. In practice capture.viewport is always written.
  function pageW(){ return (capture.viewport && capture.viewport.width) || (img.naturalWidth ? img.naturalWidth / dpr() : 1920); }
  function vpH(){ return (capture.viewport && capture.viewport.height) || (img.naturalHeight ? img.naturalHeight / dpr() : 1080); }
  function isFull(){ return capture.fullPage !== false && (!capture.scrollY || capture.scrollY === 0); }
  // Logical page height derived from the PNG's OWN proportions — this keeps X and
  // Y on one scale (dpr-independent, always consistent with the pixels the user
  // clicks). We deliberately do NOT trust a hand-written capture.fullPageHeight
  // for hit-testing; it can disagree with the actual image and mislocate pins.
  function pageHeightCss(){ return (img.naturalWidth && img.naturalHeight) ? (pageW() * img.naturalHeight / img.naturalWidth) : (capture.fullPageHeight || vpH()); }

  function sizeCanvas(){ overlay.width = img.clientWidth; overlay.height = img.clientHeight; overlay.style.width = img.clientWidth+'px'; overlay.style.height = img.clientHeight+'px'; redraw(); }

  // Convert a screenshot-percent point to PAGE coords (dpr-independent: use logical dims).
  function pageXY(xPct, yPct){
    var px = xPct * pageW();
    var py = isFull() ? (yPct * pageHeightCss()) : (yPct * vpH() + (capture.scrollY || 0));
    return { x: px, y: py };
  }
  // Deepest (smallest-area) element whose page-coord rect covers the point.
  function hitTest(xPct, yPct){
    var p = pageXY(xPct, yPct); var best = null; var bestArea = Infinity;
    for (var i=0;i<elements.length;i++){
      var e = elements[i]; var r = e && e.rect; if (!r) continue;
      if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height){
        var area = r.width * r.height;
        if (area < bestArea){ bestArea = area; best = e; }
      }
    }
    if (!best) return { matched: false };
    return {
      matched: true,
      selector: best.selector || '', tag: best.tag || '', classes: best.classes || [],
      text: best.text || '', hivekuId: best.hivekuId || null, hivekuSource: best.hivekuSource || null,
      outerHTMLHead: best.outerHTMLHead || '', ariaLabel: best.ariaLabel || null
    };
  }

  function color(a){ var p = a.priority; return p==='high' ? '#f14c4c' : p==='low' ? '#3794ff' : '#e2c08d'; }
  function redraw(){
    ctx.clearRect(0,0,overlay.width,overlay.height);
    var W = overlay.width, H = overlay.height;
    for (var i=0;i<annos.length;i++){
      var a = annos[i]; var r = a.region; var c = a.status==='resolved' ? '#89d185' : color(a);
      ctx.lineWidth = 2; ctx.strokeStyle = c; ctx.fillStyle = c;
      if (a.type==='rect'){
        var x = r.xPct*W, y = r.yPct*H, w = (r.wPct||0)*W, h = (r.hPct||0)*H;
        ctx.globalAlpha = 0.12; ctx.fillRect(x,y,w,h); ctx.globalAlpha = 1; ctx.strokeRect(x,y,w,h);
        badge(i+1, x+3, y+3, c);
      } else {
        var px = r.xPct*W, py = r.yPct*H;
        ctx.beginPath(); ctx.arc(px,py,7,0,Math.PI*2); ctx.fill();
        badge(i+1, px+9, py-9, c);
      }
    }
    if (drag){ ctx.strokeStyle = '#e2c08d'; ctx.lineWidth = 2; ctx.setLineDash([5,4]); ctx.strokeRect(Math.min(drag.x0,drag.x1),Math.min(drag.y0,drag.y1),Math.abs(drag.x1-drag.x0),Math.abs(drag.y1-drag.y0)); ctx.setLineDash([]); }
  }
  function badge(n,x,y,c){ ctx.save(); ctx.fillStyle=c; ctx.font='bold 12px sans-serif'; var t=String(n); var w=ctx.measureText(t).width+8; ctx.globalAlpha=0.9; ctx.fillRect(x,y,w,16); ctx.globalAlpha=1; ctx.fillStyle='#000'; ctx.fillText(t,x+4,y+12); ctx.restore(); }

  function renderList(){
    countEl.textContent = annos.length ? (annos.length + ' annotation' + (annos.length===1?'':'s')) : 'No annotations yet';
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    if (!annos.length){ var m=document.createElement('div'); m.style.cssText='padding:12px;opacity:.6;font-size:12px'; m.textContent='Draw a box or drop a pin to add one.'; listEl.appendChild(m); return; }
    for (var i=0;i<annos.length;i++){ (function(idx){
      var a = annos[idx]; var d = document.createElement('div'); d.className='anno';
      var rm = document.createElement('button'); rm.className='rm'; rm.textContent='remove'; rm.onclick=function(){ annos.splice(idx,1); renderList(); redraw(); }; d.appendChild(rm);
      var h = document.createElement('div'); var n=document.createElement('span'); n.className='n'; n.textContent=String(idx+1); h.appendChild(n); h.appendChild(document.createTextNode((a.priority||'medium')+' · '+(a.annotationType||'general')+(a.status==='resolved'?' · resolved':''))); d.appendChild(h);
      var cm = document.createElement('div'); cm.className='cm'; cm.textContent=a.comment||'(no comment)'; d.appendChild(cm);
      var el = document.createElement('div');
      if (a.element && a.element.matched){ el.className='el'; el.textContent='→ '+(a.element.hivekuSource ? (a.element.hivekuSource.file+':'+a.element.hivekuSource.line) : (a.element.selector||a.element.tag||'element')); }
      else { el.className='el no'; el.textContent='no element matched (comment-only)'; }
      d.appendChild(el); listEl.appendChild(d);
    })(i); }
  }

  function closeEditor(){ if (editorEl && editorEl.parentNode){ editorEl.parentNode.removeChild(editorEl); } editorEl = null; }

  function toPct(px, py){ return { xPct: px/overlay.width, yPct: py/overlay.height }; }
  function evtXY(e){ var b = overlay.getBoundingClientRect(); return { x: e.clientX-b.left, y: e.clientY-b.top }; }

  overlay.addEventListener('mousedown', function(e){ if (editorEl) return; var p = evtXY(e); if (MODE==='rect'){ drag = { x0:p.x, y0:p.y, x1:p.x, y1:p.y }; } });
  overlay.addEventListener('mousemove', function(e){ if (!drag) return; var p = evtXY(e); drag.x1=p.x; drag.y1=p.y; redraw(); });
  overlay.addEventListener('mouseup', function(e){
    var p = evtXY(e);
    if (MODE==='pin'){ var pc = toPct(p.x,p.y); openEditorWith({ xPct: pc.xPct, yPct: pc.yPct }, 'pin', p.x, p.y, hitTest(pc.xPct, pc.yPct)); return; }
    if (!drag) return; var x=Math.min(drag.x0,drag.x1), y=Math.min(drag.y0,drag.y1), w=Math.abs(drag.x1-drag.x0), h=Math.abs(drag.y1-drag.y0); drag=null; redraw();
    if (w<5 || h<5){ return; }
    // region = top-left + size (percent of the displayed image); hit-test at the box center.
    var region = { xPct: x/overlay.width, yPct: y/overlay.height, wPct: w/overlay.width, hPct: h/overlay.height };
    var cx = (x+w/2)/overlay.width, cy = (y+h/2)/overlay.height;
    openEditorWith(region, 'rect', x+w+2, y, hitTest(cx, cy));
  });

  function openEditorWith(region, type, pxX, pxY, element){
    closeEditor();
    var ed = document.createElement('div'); ed.className='editor'; ed.style.left = Math.min(pxX, container.clientWidth-270)+'px'; ed.style.top = pxY+'px';
    var ta = document.createElement('textarea'); ta.placeholder='What should change here?'; ed.appendChild(ta);
    var row = document.createElement('div'); row.className='row';
    var pr = document.createElement('select'); ['medium','high','low'].forEach(function(v){ var o=document.createElement('option'); o.value=v; o.textContent=v; pr.appendChild(o); }); row.appendChild(pr);
    var ty = document.createElement('select'); ['general','design','content','bug'].forEach(function(v){ var o=document.createElement('option'); o.value=v; o.textContent=v; ty.appendChild(o); }); row.appendChild(ty);
    ed.appendChild(row);
    var elInfo = document.createElement('div'); elInfo.className='el'; elInfo.textContent = element.matched ? ('Element: '+(element.hivekuSource ? (element.hivekuSource.file+':'+element.hivekuSource.line+'  ') : '')+(element.selector||element.tag)) : 'No element under this box — comment-only.'; ed.appendChild(elInfo);
    var btns = document.createElement('div'); btns.className='btns';
    var ok = document.createElement('button'); ok.className='ok'; ok.textContent='Add'; var cancel = document.createElement('button'); cancel.textContent='Cancel';
    btns.appendChild(cancel); btns.appendChild(ok); ed.appendChild(btns); container.appendChild(ed); editorEl = ed; ta.focus();
    function commit(){ var text = ta.value.trim(); if (!text){ ta.focus(); return; } annos.push({ id: uuid(), type: type, region: region, comment: text, priority: pr.value, annotationType: ty.value, status:'open', resolvedAt:null, element: element }); closeEditor(); renderList(); redraw(); }
    ok.onclick = commit; cancel.onclick = closeEditor;
    ta.addEventListener('keydown', function(e){ if (e.key==='Enter' && (e.metaKey||e.ctrlKey)) commit(); if (e.key==='Escape') closeEditor(); });
  }

  document.getElementById('mRect').addEventListener('click', function(){ MODE='rect'; this.classList.add('active'); document.getElementById('mPin').classList.remove('active'); });
  document.getElementById('mPin').addEventListener('click', function(){ MODE='pin'; this.classList.add('active'); document.getElementById('mRect').classList.remove('active'); });
  document.getElementById('save').addEventListener('click', function(){ closeEditor(); vscode.postMessage({ type:'save', annotations: annos }); });
  window.addEventListener('resize', function(){ closeEditor(); sizeCanvas(); });

  window.addEventListener('message', function(ev){
    var m = ev.data; if (m.type !== 'init') return;
    capture = m.capture || {}; elements = m.elements || []; annos = Array.isArray(m.annotations) ? m.annotations : [];
    var emptyEl = document.getElementById('empty');
    if (!m.imgUri){ emptyEl.textContent = 'This capture has no screenshot — re-run /hiveku-review to recapture the page.'; return; }
    emptyEl.style.display = 'none';
    container.style.display = 'inline-block';
    img.onload = function(){ sizeCanvas(); renderList(); };
    img.onerror = function(){ emptyEl.textContent = 'Could not load the screenshot. Re-run /hiveku-review to recapture.'; emptyEl.style.display = ''; container.style.display = 'none'; };
    img.src = m.imgUri;
    if (img.complete && img.naturalWidth) { sizeCanvas(); renderList(); }
  });

  vscode.postMessage({ type: 'ready' });
</script></body></html>`;
}
