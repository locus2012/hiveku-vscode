/**
 * Running a workflow by hand asks first.
 *
 * workflow_run without test_mode is a REAL run: the workflow's emails and texts
 * go out and its record changes are written. Three places could start one with
 * a single click and no question: the Automations panel row action, the
 * console's Automations tab, and the hiveku.runWorkflow command. All three now
 * go through runWorkflowForReal, which raises a VS Code modal in the extension
 * host ("Run this workflow for real now?") and calls workflow_run only when the
 * person picks "Run for real". Escape, Cancel or closing the modal calls
 * nothing.
 *
 * The panel and the console are driven through their real message handlers
 * with a stub webview, so the assertions are on what a person sees (labels,
 * the modal's words) and on what reaches the MCP client. The command's
 * handler lives inside activate(), so it is pinned by reading the source,
 * together with a sweep that no other code calls workflow_run.
 */
import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calls, resetCalls, vscodeStub } from './helpers/vscode-stub.mjs';
import { OUT, loadOut, fakeClient } from './helpers/load.mjs';

// The console appends a diagnostics line to ~/.hiveku-console-debug.log on
// every open and every message, with the path fixed when the module loads.
// Point HOME at a scratch folder first so the test never writes to the real one.
const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hiveku-run-confirm-'));
process.env.HOME = scratchHome;
after(() => fs.rmSync(scratchHome, { recursive: true, force: true }));

// ── What the panels need from vscode beyond the shared stub ─────────────────
let messageHandler = null;
const posted = [];
vscodeStub.ViewColumn = { Active: -1 };
vscodeStub.extensions = { getExtension: () => undefined };
vscodeStub.window.withProgress = (_opts, task) => task();
vscodeStub.window.createWebviewPanel = () => ({
  webview: {
    html: '',
    cspSource: 'vscode-resource:',
    postMessage: (message) => { posted.push(message); return Promise.resolve(true); },
    onDidReceiveMessage: (fn) => { messageHandler = fn; return { dispose() {} }; },
  },
  onDidDispose: () => ({ dispose() {} }),
  reveal() {},
});

/** Answer every warning modal with `answer` (undefined = Escape / Cancel), recording it. */
function answerModalsWith(answer) {
  vscodeStub.window.showWarningMessage = (...args) => {
    calls.warnings.push(args);
    return Promise.resolve(answer);
  };
}

const {
  MODULES,
  PROJECT_MODULE,
  RUN_FOR_REAL_DETAIL,
  RUN_FOR_REAL_LABEL,
  RUN_FOR_REAL_QUESTION,
  runWorkflowForReal,
  workflowRunDone,
} = loadOut('modules');
const { openModulePanel } = loadOut('panel');
const { openAccountConsole, consoleHtml } = loadOut('console');

const ACCOUNT = { accountId: '4d9e2b7a-3c1f-4e8a-9b6d-0f2a1c3e5b7d', label: 'Harbor Dental' };
const APP = 'https://app.hiveku.com';
const WORKFLOW = { id: '7f3a9c2e-1b4d-4e6f-8a0c-2d4e6f8a0b1c', name: 'New lead alert', is_enabled: true, run_count: 12 };
const RAN = { data: { run_id: 'run-1', status: 'completed', mode: 'sync' } };

const workflowRunCalls = (client) => client.seen.filter((c) => c.name === 'workflow_run');

/** A fake ActionUi that answers the confirm with `answer` and logs everything. */
function fakeUi(answer, subject = 'New lead alert') {
  const log = [];
  return {
    log,
    ui: {
      subject,
      progress: (title, task) => { log.push({ kind: 'progress', title }); return task(); },
      confirm: async (message, detail, button) => { log.push({ kind: 'confirm', message, detail, button }); return answer; },
      warn: async (message, detail) => { log.push({ kind: 'warn', message, detail }); },
      inform: async () => false,
      openDashboard: async () => {},
    },
  };
}

beforeEach(() => {
  resetCalls();
  posted.length = 0;
  answerModalsWith(undefined);
});

describe('runWorkflowForReal', () => {
  test('asks first, in plain words, and a no sends nothing', async () => {
    const client = fakeClient({ workflow_run: RAN });
    const { ui, log } = fakeUi(false);
    assert.equal(await runWorkflowForReal(client, { id: WORKFLOW.id }, ui), null);
    assert.deepEqual(client.seen, [], 'no tool was called');
    assert.deepEqual(log, [
      {
        kind: 'confirm',
        message: 'Run this workflow for real now?',
        detail:
          'Its emails, texts and record changes happen. To see what it would do without sending anything, run a test from the workflow editor.',
        button: 'Run for real',
      },
    ]);
    assert.equal(RUN_FOR_REAL_QUESTION, 'Run this workflow for real now?');
    assert.equal(RUN_FOR_REAL_LABEL, 'Run for real');
  });

  test('"Run for real" sends workflow_run once, with only the id and no test flag', async () => {
    const client = fakeClient({ workflow_run: RAN });
    const { ui, log } = fakeUi(true);
    const outcome = await runWorkflowForReal(client, { id: WORKFLOW.id }, ui);
    assert.deepEqual(outcome, { result: RAN });
    assert.deepEqual(client.seen, [{ name: 'workflow_run', args: { id: WORKFLOW.id } }]);
    assert.deepEqual(log.map((entry) => entry.kind), ['confirm', 'progress'], 'the question comes before the call');
    assert.equal(log[1].title, 'Running New lead alert…');
  });

  test('with no workflow id nothing is asked and nothing is sent', async () => {
    const client = fakeClient({ workflow_run: RAN });
    const { ui, log } = fakeUi(true);
    assert.equal(await runWorkflowForReal(client, {}, ui), null);
    assert.equal(await runWorkflowForReal(client, { id: '' }, ui), null);
    assert.deepEqual(client.seen, []);
    assert.deepEqual(log, []);
  });

  test('a failed run still throws, so every caller shows the error', async () => {
    const client = fakeClient({ workflow_run: new Error('Tool workflow_run errored: {"error":"run_quota_exceeded"}') });
    const { ui } = fakeUi(true);
    await assert.rejects(runWorkflowForReal(client, { id: WORKFLOW.id }, ui), /run_quota_exceeded/);
  });

  test('the finished message says whether the run is still waiting', () => {
    assert.equal(workflowRunDone(RAN), 'The workflow ran. Recent runs shows what it did.');
    assert.match(workflowRunDone({ data: { status: 'waiting', run_id: 'r' } }), /^The workflow started and is waiting on a delay or an approval/);
    assert.match(workflowRunDone({ status: 'WAITING' }), /is waiting/);
    assert.equal(workflowRunDone(null), 'The workflow ran. Recent runs shows what it did.');
  });
});

let panelSeq = 0;
/** A fresh Automations panel answering tools from `answers`. */
function openAutomations(answers) {
  const client = fakeClient(answers);
  messageHandler = null;
  const spec = MODULES.find((m) => m.id === 'workflows');
  openModulePanel(ACCOUNT, spec, async () => client, () => APP, {}, `run-confirm-${panelSeq++}`);
  assert.ok(messageHandler, 'the panel registered its message handler');
  return { client, send: (message) => messageHandler(message) };
}

describe('Automations panel', () => {
  test('the row button reads "Run for real", never a bare "Run"', async () => {
    const { send } = openAutomations({ workflow_list: { data: [WORKFLOW] } });
    await send({ type: 'load', section: 'workflows' });
    const rows = [...posted].reverse().find((m) => m.section === 'workflows' && m.type === 'rows');
    assert.ok(rows, 'the workflows section loaded');
    const labels = rows.rows[0].actions.map((a) => a.label);
    assert.ok(labels.includes('Run for real'), `labels: ${labels.join(', ')}`);
    assert.ok(!labels.includes('Run'), 'no bare "Run" button');
  });

  test('cancel asks in a VS Code modal and calls nothing', async () => {
    const { client, send } = openAutomations({ workflow_list: { data: [WORKFLOW] }, workflow_run: RAN });
    await send({ type: 'load', section: 'workflows' });
    await send({ type: 'rowaction', section: 'workflows', idx: 0, actionId: 'run' });

    assert.equal(calls.warnings.length, 1, 'one modal');
    const [message, options, ...buttons] = calls.warnings[0];
    assert.equal(message, RUN_FOR_REAL_QUESTION);
    assert.equal(options.modal, true);
    assert.ok(options.detail.startsWith(RUN_FOR_REAL_DETAIL), options.detail);
    assert.match(options.detail, /Subject: New lead alert/);
    assert.match(options.detail, /Account: Harbor Dental/);
    assert.deepEqual(buttons, ['Run for real']);

    assert.deepEqual(workflowRunCalls(client), [], 'workflow_run was never called');
    assert.deepEqual(calls.infos, [], 'nothing claims a run happened');
    assert.deepEqual(calls.errors, []);
  });

  test('"Run for real" runs it once and says it ran', async () => {
    answerModalsWith('Run for real');
    const { client, send } = openAutomations({ workflow_list: { data: [WORKFLOW] }, workflow_run: RAN });
    await send({ type: 'load', section: 'workflows' });
    await send({ type: 'rowaction', section: 'workflows', idx: 0, actionId: 'run' });

    assert.equal(calls.warnings.length, 1);
    assert.deepEqual(workflowRunCalls(client), [{ name: 'workflow_run', args: { id: WORKFLOW.id } }]);
    assert.deepEqual(calls.infos.map((i) => i[0]), ['The workflow ran. Recent runs shows what it did.']);
    assert.deepEqual(calls.errors, []);
  });

  test('every panel action that calls workflow_run goes through the confirmation', () => {
    const actions = [...MODULES, PROJECT_MODULE]
      .flatMap((m) => m.sections)
      .flatMap((s) => [...(s.rowActions ?? []), ...(s.headerActions ?? [])])
      .filter((a) => a.tool === 'workflow_run');
    assert.ok(actions.length >= 1, 'the Automations Run action exists');
    for (const action of actions) {
      assert.equal(action.run, runWorkflowForReal, `${action.id} must run through runWorkflowForReal`);
      assert.equal(action.label, 'Run for real');
      assert.equal(action.confirm, undefined, 'one question, not two');
    }
  });
});

/** A fresh account console answering tools from `answers`. */
function openConsole(answers) {
  const client = fakeClient(answers);
  messageHandler = null;
  const account = { ...ACCOUNT, accountId: `${ACCOUNT.accountId}-${panelSeq++}` };
  openAccountConsole(account, async () => client, () => APP);
  assert.ok(messageHandler, 'the console registered its message handler');
  return { client, send: (message) => messageHandler(message) };
}

describe('Account console, Automations tab', () => {
  test('the button reads "Run for real" and sends the name for the modal, with no browser popup', () => {
    const html = consoleHtml({ cspSource: 'vscode-resource:' }, 'Harbor Dental');
    assert.ok(
      html.includes("btn('Run for real','',function(){vscode.postMessage({type:'runwf',id:w.id,name:w.name||''});})"),
      'the Run button posts runwf with the workflow name',
    );
    assert.ok(!html.includes("btn('Run',"), 'no bare "Run" button');
    assert.doesNotMatch(html, /\b(window\.)?(confirm|alert|prompt)\(/, 'the webview never raises a browser popup');
  });

  test('cancel asks in the extension host and calls nothing', async () => {
    const { client, send } = openConsole({ workflow_run: RAN, workflow_list: { data: [WORKFLOW] }, workflow_runs_recent: { data: [] } });
    await send({ type: 'runwf', id: WORKFLOW.id, name: WORKFLOW.name });

    assert.equal(calls.warnings.length, 1, 'one modal');
    const [message, options, ...buttons] = calls.warnings[0];
    assert.equal(message, RUN_FOR_REAL_QUESTION);
    assert.equal(options.modal, true);
    assert.ok(options.detail.startsWith(RUN_FOR_REAL_DETAIL), options.detail);
    assert.match(options.detail, /Subject: New lead alert/);
    assert.match(options.detail, /Account: Harbor Dental/);
    assert.deepEqual(buttons, ['Run for real']);

    assert.deepEqual(client.seen, [], 'no tool was called, not even the reload');
    assert.deepEqual(calls.infos, []);
    assert.deepEqual(calls.errors, []);
  });

  test('"Run for real" runs it once, says it ran and reloads the tab', async () => {
    answerModalsWith('Run for real');
    const { client, send } = openConsole({ workflow_run: RAN, workflow_list: { data: [WORKFLOW] }, workflow_runs_recent: { data: [] } });
    await send({ type: 'runwf', id: WORKFLOW.id, name: WORKFLOW.name });

    assert.deepEqual(workflowRunCalls(client), [{ name: 'workflow_run', args: { id: WORKFLOW.id } }]);
    assert.equal(client.seen[0].name, 'workflow_run', 'the run comes first');
    assert.ok(client.seen.some((c) => c.name === 'workflow_list'), 'the Automations tab reloaded');
    assert.deepEqual(calls.infos.map((i) => i[0]), ['The workflow ran. Recent runs shows what it did.']);
    assert.deepEqual(calls.errors, []);
  });
});

describe('no path runs a workflow without asking', () => {
  const SRC = path.join(OUT, '..', 'src');
  const sources = fs
    .readdirSync(SRC)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(SRC, f), 'utf8') }));

  test('the hiveku.runWorkflow command asks through runWorkflowForReal', () => {
    const ext = sources.find((s) => s.file === 'extension.ts').text;
    const start = ext.indexOf('async function runWorkflow(');
    assert.ok(start >= 0, 'runWorkflow exists');
    const body = ext.slice(start, ext.indexOf('\n}\n', start));
    assert.match(body, /runWorkflowForReal\(/);
    assert.match(body, /if \(!outcome\) return;/, 'cancel returns before any message');
    assert.doesNotMatch(body, /\bworkflowRun\(|'workflow_run'/, 'no direct run call');
    assert.match(ext, /registerCommand\('hiveku\.runWorkflow', \(node\) => runWorkflow\(node\)\)/);
  });

  test('workflowRun is called only from runWorkflowForReal', () => {
    const callers = sources.flatMap(({ file, text }) =>
      text
        .split('\n')
        .map((line, i) => ({ file, line: i + 1, text: line }))
        .filter((l) => /\bworkflowRun\(/.test(l.text) && !/export async function workflowRun\(/.test(l.text)),
    );
    assert.equal(callers.length, 1, `callers: ${JSON.stringify(callers)}`);
    assert.equal(callers[0].file, 'modules.ts');
    const modules = sources.find((s) => s.file === 'modules.ts').text;
    const flow = modules.slice(modules.indexOf('export const runWorkflowForReal'), modules.indexOf('export function workflowRunDone'));
    assert.ok(flow.includes('workflowRun(client, id)'), 'the one caller is inside runWorkflowForReal');
    assert.ok(flow.indexOf('ui.confirm(') < flow.indexOf('workflowRun(client, id)'), 'and it asks before it calls');
  });

  test('no other code calls the workflow_run tool directly', () => {
    const direct = sources.filter(({ text }) => /callToolJson[^(]*\(\s*['"]workflow_run['"]/.test(text)).map((s) => s.file);
    assert.deepEqual(direct, ['hivekuApi.ts']);
  });
});
