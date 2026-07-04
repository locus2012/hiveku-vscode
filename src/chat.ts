/**
 * Department chat (Phase C). A lightweight webview panel that sends messages to
 * a Hiveku department agent via the `talk_to_department` MCP tool and renders
 * the reply. The intelligence lives server-side (the department agent runs with
 * full memory/brand/skills/rules + specialist tools), so this is just a thin,
 * branded chat client — no client-side model key, no agent loop.
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import { departmentLabel } from './knowledge';

const panels = new Map<string, vscode.WebviewPanel>();

export function openDepartmentChat(
  account: { accountId: string; label: string },
  department: string,
  clientFor: (accountId: string) => Promise<HivekuMcpClient>,
): void {
  const key = `${account.accountId}:${department}`;
  const existing = panels.get(key);
  if (existing) {
    existing.reveal();
    return;
  }

  const title = `${departmentLabel(department)} · ${account.label}`;
  const panel = vscode.window.createWebviewPanel('hivekuChat', title, vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panels.set(key, panel);
  panel.onDidDispose(() => panels.delete(key));
  panel.webview.html = chatHtml(panel.webview, departmentLabel(department), account.label);

  panel.webview.onDidReceiveMessage(async (msg: { type: string; text?: string }) => {
    if (msg.type !== 'send' || !msg.text) return;
    panel.webview.postMessage({ type: 'thinking' });
    try {
      const client = await clientFor(account.accountId);
      const reply = await api.talkToDepartment(client, department, msg.text);
      panel.webview.postMessage({ type: 'reply', text: reply });
    } catch (err) {
      panel.webview.postMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  });
}

function chatHtml(webview: vscode.Webview, deptLabel: string, accountLabel: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  // The webview script renders all message text via textContent only (never
  // innerHTML), so agent/account strings can't inject markup.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; height: 100vh; display: flex; flex-direction: column; }
    header { padding: 10px 14px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; }
    header .sub { font-weight: 400; opacity: 0.7; font-size: 12px; }
    #log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .msg { max-width: 85%; padding: 8px 12px; border-radius: 10px; white-space: pre-wrap; word-wrap: break-word; line-height: 1.45; font-size: 13px; }
    .user { align-self: flex-end; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .agent { align-self: flex-start; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); }
    .err { align-self: flex-start; color: var(--vscode-errorForeground); font-size: 12px; }
    .typing { align-self: flex-start; opacity: 0.6; font-size: 12px; }
    footer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--vscode-panel-border); }
    textarea { flex: 1; resize: none; height: 38px; padding: 8px; font-family: var(--vscode-font-family); font-size: 13px;
      color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 6px; }
    button { padding: 0 14px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
  </style>
</head>
<body>
  <header>${deptLabel}<span class="sub"> — ${accountLabel}</span></header>
  <div id="log"></div>
  <footer>
    <textarea id="input" placeholder="Ask ${deptLabel} anything…"></textarea>
    <button id="send">Send</button>
  </footer>
  <script nonce="${nonce}">
    var vscode = acquireVsCodeApi();
    var log = document.getElementById('log');
    var input = document.getElementById('input');
    var sendBtn = document.getElementById('send');
    var typingEl = null;

    function bubble(text, cls) {
      var el = document.createElement('div');
      el.className = 'msg ' + cls;
      el.textContent = text;
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }
    function setBusy(b) { sendBtn.disabled = b; input.disabled = b; }

    function send() {
      var text = input.value.trim();
      if (!text) return;
      bubble(text, 'user');
      input.value = '';
      setBusy(true);
      vscode.postMessage({ type: 'send', text: text });
    }
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });

    window.addEventListener('message', function (event) {
      var m = event.data;
      if (m.type === 'thinking') {
        typingEl = document.createElement('div');
        typingEl.className = 'typing';
        typingEl.textContent = '${deptLabel} is thinking…';
        log.appendChild(typingEl);
        log.scrollTop = log.scrollHeight;
      } else if (m.type === 'reply') {
        if (typingEl) { typingEl.remove(); typingEl = null; }
        bubble(m.text, 'agent');
        setBusy(false);
      } else if (m.type === 'error') {
        if (typingEl) { typingEl.remove(); typingEl = null; }
        bubble('Error: ' + m.text, 'err');
        setBusy(false);
      }
    });
    input.focus();
  </script>
</body>
</html>`;
}
