/**
 * A minimal stand-in for the `vscode` module so the compiled extension (out/)
 * can be loaded by `node --test`. Only what the tested modules touch is real;
 * every call that shows UI is recorded on `calls` for assertions.
 *
 * Import this BEFORE requiring anything from out/.
 */
import Module from 'node:module';
import { rm } from 'node:fs/promises';

export const calls = { errors: [], infos: [], warnings: [], inputs: [], picks: [], openExternal: [], executeCommand: [], trashed: [], opened: [], shown: [], clipboard: [], panels: [] };
export const config = new Map();

class EventEmitter {
  constructor() { this.listeners = []; this.fired = []; }
  get event() { return (fn) => { this.listeners.push(fn); return { dispose() {} }; }; }
  fire(value) { this.fired.push(value); for (const fn of this.listeners) fn(value); }
  dispose() {}
}

class Uri {
  constructor(scheme, path) { this.scheme = scheme; this.path = path; }
  static parse(value) {
    const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(value);
    if (!m) return new Uri('file', value);
    let rest = m[2];
    if (rest.startsWith('//')) {
      const slash = rest.indexOf('/', 2);
      rest = slash === -1 ? '/' : rest.slice(slash);
    }
    const uri = new Uri(m[1], decodeURIComponent(rest.split(/[?#]/)[0]));
    // The whole address as given, for tests that check a query or a host.
    uri.raw = value;
    return uri;
  }
  // A file URI carries fsPath, as HivekuScm and versionFlows read it.
  static file(p) { const u = new Uri('file', p); u.fsPath = p; return u; }
  toString() { return `${this.scheme}:${this.path}`; }
}

class FileSystemError extends Error {
  constructor(message, code) { super(typeof message === 'string' ? message : String(message)); this.code = code; }
  static NoPermissions(m) { return new FileSystemError(m, 'NoPermissions'); }
  static FileNotFound(m) { return new FileSystemError(String(m ?? 'not found'), 'FileNotFound'); }
  static Unavailable(m) { return new FileSystemError(m, 'Unavailable'); }
}

class TreeItem {
  constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; }
}
class ThemeIcon { constructor(id) { this.id = id; } }
class Disposable { constructor(fn) { this.fn = fn; } dispose() { this.fn?.(); } }
class RelativePattern { constructor(base, pattern) { this.base = base; this.pattern = pattern; } }

/** A Source Control the tests can read: the input box, the count and the Changes list. */
function createSourceControl(id, label, rootUri) {
  return {
    id, label, rootUri, count: 0, acceptInputCommand: undefined,
    inputBox: { value: '', placeholder: '' },
    createResourceGroup: (gid, glabel) => ({ id: gid, label: glabel, resourceStates: [], dispose() {} }),
    dispose() {},
  };
}

const thenable = (value) => Promise.resolve(value);

export const vscodeStub = {
  EventEmitter,
  Uri,
  FileSystemError,
  TreeItem,
  ThemeIcon,
  Disposable,
  RelativePattern,
  scm: { createSourceControl },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  ViewColumn: { Active: -1, Beside: -2, One: 1 },
  extensions: { getExtension: () => undefined },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  FilePermission: { Readonly: 1 },
  FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: {
    showErrorMessage: (...a) => { calls.errors.push(a); return thenable(undefined); },
    showInformationMessage: (...a) => { calls.infos.push(a); return thenable(undefined); },
    showWarningMessage: (...a) => { calls.warnings.push(a); return thenable(undefined); },
    // Escape, by default: a test that wants an answer replaces this.
    showInputBox: (...a) => { calls.inputs.push(a); return thenable(undefined); },
    // Escape, by default, like showInputBox.
    showQuickPick: (...a) => { calls.picks.push(a); return thenable(undefined); },
    // Runs the task at once with a progress that reports nowhere.
    withProgress: (_opts, task) => task({ report() {} }, { isCancellationRequested: false, onCancellationRequested() { return { dispose() {} }; } }),
    showTextDocument: (...a) => { calls.shown.push(a); return thenable(undefined); },
    // A webview panel a test can talk to: `handler` is what the extension
    // registered with onDidReceiveMessage, `posted` what it sent the webview.
    createWebviewPanel: (viewType, title) => {
      const panel = {
        viewType, title, handler: null, posted: [],
        webview: {
          html: '', cspSource: 'vscode-resource:',
          onDidReceiveMessage(fn) { panel.handler = fn; return { dispose() {} }; },
          postMessage(m) { panel.posted.push(m); return thenable(true); },
        },
        disposers: [],
        onDidDispose(fn) { panel.disposers.push(fn); return { dispose() {} }; },
        dispose() { for (const fn of panel.disposers) fn(); },
        reveal() {},
      };
      calls.panels.push(panel);
      return panel;
    },
  },
  env: {
    openExternal: (u) => { calls.openExternal.push(u); return thenable(true); },
    clipboard: { writeText: (t) => { calls.clipboard.push(t); return thenable(undefined); } },
  },
  commands: { executeCommand: (...a) => { calls.executeCommand.push(a); return thenable(undefined); } },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (config.has(k) ? config.get(k) : d) }),
    openTextDocument: (uri) => { calls.opened.push(uri); return thenable({ uri }); },
    createFileSystemWatcher: () => ({ onDidCreate() {}, onDidChange() {}, onDidDelete() {}, dispose() {} }),
    // Moving to the OS trash is recorded; the file then leaves the folder.
    fs: {
      delete: async (uri, opts) => { calls.trashed.push({ path: uri.fsPath ?? uri.path, useTrash: opts?.useTrash === true }); await rm(uri.fsPath ?? uri.path, { force: true }); },
    },
  },
};

const origLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return origLoad.call(this, request, parent, isMain);
};

export function resetCalls() {
  for (const k of Object.keys(calls)) calls[k].length = 0;
}
