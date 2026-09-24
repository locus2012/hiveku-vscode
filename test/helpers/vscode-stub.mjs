/**
 * A minimal stand-in for the `vscode` module so the compiled extension (out/)
 * can be loaded by `node --test`. Only what the tested modules touch is real;
 * every call that shows UI is recorded on `calls` for assertions.
 *
 * Import this BEFORE requiring anything from out/.
 */
import Module from 'node:module';

export const calls = { errors: [], infos: [], warnings: [], openExternal: [], executeCommand: [] };
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
    return new Uri(m[1], decodeURIComponent(rest.split(/[?#]/)[0]));
  }
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

const thenable = (value) => Promise.resolve(value);

export const vscodeStub = {
  EventEmitter,
  Uri,
  FileSystemError,
  TreeItem,
  ThemeIcon,
  Disposable,
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  FilePermission: { Readonly: 1 },
  FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ProgressLocation: { Notification: 15 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: {
    showErrorMessage: (...a) => { calls.errors.push(a); return thenable(undefined); },
    showInformationMessage: (...a) => { calls.infos.push(a); return thenable(undefined); },
    showWarningMessage: (...a) => { calls.warnings.push(a); return thenable(undefined); },
  },
  env: { openExternal: (u) => { calls.openExternal.push(u); return thenable(true); } },
  commands: { executeCommand: (...a) => { calls.executeCommand.push(a); return thenable(undefined); } },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (config.has(k) ? config.get(k) : d) }),
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
