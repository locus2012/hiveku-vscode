/**
 * The Account Console's Knowledge tab, grouped like the Memory page (memory
 * surfaces audit 2026-09-27, G14/G15 and G7):
 *
 *   - About your business, then each agent (the Marketing team by topic),
 *     then Shared with every agent; internal rows are not shown;
 *   - rows shared with every agent and `_account:*` rows are read-only, with
 *     "Open in Memory" (the account's Memory page, at the agent and item);
 *   - Delete sends the version the list showed (expected_version);
 *   - "+ New entry" asks who it is for first, then opens an empty editor;
 *   - "Train" tells Claude which agent a new rule is for.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

// The console writes a diagnostics line to ~/.hiveku-console-debug.log when it
// opens: keep it in a temp home, set before the module is loaded.
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-console-home-'));

const { calls, config, resetCalls, vscodeStub } = await import('./helpers/vscode-stub.mjs');
const { loadOut, fakeClient } = await import('./helpers/load.mjs');
const consolePanel = loadOut('console');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const APP = 'https://app.hiveku.com';
const PAGE = `${APP}/${ACCOUNT}/dashboard/memory`;
const account = { accountId: ACCOUNT, label: 'Western Stairlifts' };
const marker = (d) => `<!-- department: ${d} -->`;

/** One of each place the Memory page has, plus rows it never draws. */
const ROWS = [
  { id: 'r-sales', domain: '_rule:no-discounts', name: 'no-discounts', department: 'sales', version: 3, content: 'Never discount.' },
  { id: 'n-sales', domain: 'sales', name: 'sales', department: 'sales', version: 9, content: 'Pipeline notes.' },
  { id: 's-seo', domain: '_skill:seo-audit', name: 'seo-audit', department: 'marketing', version: 1, content: `${marker('seo')}\nRun it.` },
  { id: 'r-hub', domain: '_rule:cite-sources', name: 'cite-sources', department: 'marketing', version: 2, content: 'Cite.' },
  { id: 'i-avatar', domain: '_identity:patrick-smith', name: 'patrick-smith', version: 1, content: '---\nname: Patrick Smith\ndepartment: customer_avatar\n---\n' },
  { id: 'r-shared', domain: '_rule:no-em-dashes', name: 'no-em-dashes', department: null, version: 4, content: 'Never use em dashes.' },
  { id: 'soul', domain: '_account:soul', name: '_account:soul', version: 5, content: 'How I work.' },
  { id: 'voice', domain: '_account:pronunciations', name: '_account:pronunciations', version: 1, content: '{}' },
  { id: 'r-iris', domain: '_rule:brief-iris', name: 'brief-iris', department: 'orchestrator', version: 1, content: 'x' },
  { id: 'ws', domain: '_workspace:state', name: '_workspace:state', version: 1, content: '{}' },
  { id: 'acct', domain: 'account', name: 'account', version: 12, content: 'Owners text.' },
];

function knowledgeClient(rows = ROWS, extra = {}) {
  return fakeClient({
    memory_list: { data: rows },
    kb_list: { data: [] },
    memory_log_list: { data: [], next_cursor: null },
    ...extra,
  });
}

beforeEach(() => {
  resetCalls();
  config.clear();
  vscodeStub.window.showInputBox = (...a) => { calls.inputs.push(a); return Promise.resolve(undefined); };
  vscodeStub.window.showQuickPick = (...a) => { calls.picks.push(a); return Promise.resolve(undefined); };
  vscodeStub.window.showWarningMessage = (...a) => { calls.warnings.push(a); return Promise.resolve(undefined); };
  vscodeStub.window.showInformationMessage = (...a) => { calls.infos.push(a); return Promise.resolve(undefined); };
});

describe('the Knowledge tab data', () => {
  test('each row says where the Memory page puts it; internal rows and About your business are not rows', async () => {
    const tab = await consolePanel.loadKnowledgeTab(knowledgeClient(), { accountId: ACCOUNT, appUrl: APP });
    const byId = Object.fromEntries(tab.memories.map((m) => [m.id, m]));
    assert.deepEqual(Object.keys(byId).sort(), ['i-avatar', 'n-sales', 'r-hub', 'r-iris', 'r-sales', 'r-shared', 's-seo', 'soul', 'voice']);
    assert.equal(tab.hidden, 1, 'the _workspace: row is counted, not shown');

    const pick = (m) => [m.place, m.agent, m.topic, m.group, m.readOnly];
    assert.deepEqual(pick(byId['r-sales']), ['agent', 'sales', '', 'rules', false]);
    assert.deepEqual(pick(byId['n-sales']), ['agent', 'sales', '', 'notes', false]);
    assert.deepEqual(pick(byId['s-seo']), ['agent', 'marketing', 'seo', 'skills', false]);
    assert.deepEqual(pick(byId['r-hub']), ['agent', 'marketing', 'marketing', 'rules', false]);
    assert.deepEqual(pick(byId['i-avatar']), ['agent', 'marketing', 'customer_avatar', 'ideal-customers', false]);
    assert.deepEqual(pick(byId['r-shared']), ['shared', '', '', 'rules', true]);
    assert.deepEqual(pick(byId.soul), ['agent', 'orchestrator', '', 'how-it-works', true]);
    assert.deepEqual(pick(byId.voice), ['business', '', '', 'voice', true]);
    assert.deepEqual(pick(byId['r-iris']), ['other', 'orchestrator', '', 'rules', false]);

    // Names in the Memory page's words.
    assert.equal(byId['s-seo'].topicName, 'SEO');
    assert.equal(byId['i-avatar'].groupName, 'Documents');
    assert.equal(byId.soul.agentName, 'Chief of staff');
    assert.match(byId['r-shared'].readOnlyWhy, /shared with every agent/);

    // Open in Memory: the account's page, at the agent and item.
    assert.equal(byId['r-sales'].memoryUrl, `${PAGE}?agent=sales&item=_rule%3Ano-discounts`);
    assert.equal(byId['s-seo'].memoryUrl, `${PAGE}?agent=seo&item=_skill%3Aseo-audit`);
    assert.equal(byId.soul.memoryUrl, `${PAGE}?agent=orchestrator&item=_account%3Asoul`);
    assert.equal(byId.voice.memoryUrl, `${PAGE}?open=voice`);
    assert.equal(byId['r-shared'].memoryUrl, PAGE);
    assert.equal(tab.memoryUrl, PAGE);

    // The page's order for the groups the tab draws.
    assert.deepEqual(tab.team.map((a) => a.key), ['orchestrator', 'sales', 'helpdesk', 'marketing', 'production', 'accounting', 'coder', 'comms']);
    assert.ok(tab.topics.some((t) => t.key === 'analytics' && t.name === 'Analytics'));
    // Plain strings only reach the webview.
    for (const row of tab.memories) for (const v of Object.values(row)) assert.ok(['string', 'number', 'boolean'].includes(typeof v), JSON.stringify(v));
  });

  test("the builder's owner field decides when a row carries it", async () => {
    const rows = [{ id: 'x', domain: '_rule:x', department: 'sales', owner: null, version: 1, content: 'x' }];
    const tab = await consolePanel.loadKnowledgeTab(knowledgeClient(rows), { accountId: ACCOUNT, appUrl: APP });
    assert.equal(tab.memories[0].place, 'shared');
    assert.equal(tab.memories[0].readOnly, true);
  });
});

/** A tiny DOM: enough of document for the Knowledge tab's render functions. */
function fakeDom() {
  const make = (tag) => {
    const node = {
      tagName: tag.toUpperCase(), className: '', textContent: '', children: [], listeners: {}, style: {}, dataset: {},
      type: '', placeholder: '', value: '', disabled: false,
      appendChild(child) { node.children.push(child); child.parent = node; return child; },
      removeChild(child) { node.children = node.children.filter((c) => c !== child); return child; },
      get firstChild() { return node.children[0] ?? null; },
      addEventListener(type, fn) { (node.listeners[type] ??= []).push(fn); },
      closest(sel) { return sel === 'button' && node.tagName === 'BUTTON' ? node : null; },
    };
    return node;
  };
  return { createElement: make, createTextNode: (text) => ({ tagName: '#text', textContent: text, children: [] }) };
}
const texts = (node) => [node.textContent, ...node.children.flatMap(texts)].filter(Boolean);
const buttons = (node) => [...(node.tagName === 'BUTTON' ? [node] : []), ...node.children.flatMap(buttons)];

describe('the Knowledge tab in the webview', () => {
  const html = consolePanel.consoleHtml({ cspSource: 'vscode-resource:' }, 'Western Stairlifts');
  const script = html.slice(html.indexOf('<script nonce='), html.lastIndexOf('</script>')).replace(/^<script[^>]*>/, '');

  function render(payload) {
    const document = fakeDom();
    const posted = [];
    const content = document.createElement('div');
    const context = {
      document,
      console,
      vscode: { postMessage: (m) => posted.push(m) },
      content,
    };
    // The render functions, run on their own (not the panel bootstrap).
    const start = script.indexOf('function el(t,c,x)');
    const helpers = script.slice(start, script.indexOf('\n', script.indexOf('function btn(')) + 1);
    const activity = script.slice(script.indexOf('var ACT={'), script.indexOf('var KNOW={'));
    const know = script.slice(script.indexOf('var KNOW={'), script.indexOf('function renderDept(d)'));
    const stubs = "function smartTable(){return el('div');}\nfunction rawLink(){return el('a');}\n";
    vm.runInNewContext(`${helpers}\n${stubs}${activity}\n${know}\nrenderKnowDash(PAYLOAD);`, { ...context, PAYLOAD: payload });
    return { content, posted };
  }

  test('draws About your business, each agent, then Shared with every agent, in the page order', async () => {
    const tab = await consolePanel.loadKnowledgeTab(knowledgeClient(), { accountId: ACCOUNT, appUrl: APP });
    const { content } = render(tab);
    const all = texts(content);
    const at = (s) => all.indexOf(s);
    for (const heading of ['About your business', 'Chief of staff', 'Sales', 'Marketing', 'Shared with every agent', 'Not on the Memory page']) {
      assert.ok(at(heading) >= 0, `${heading} is drawn`);
    }
    assert.ok(at('About your business') < at('Chief of staff'));
    assert.ok(at('Chief of staff') < at('Sales'));
    assert.ok(at('Sales') < at('Marketing'));
    assert.ok(at('Marketing') < at('Shared with every agent'));
    // Marketing by topic, with the page's names.
    assert.ok(all.includes('SEO (1)') && all.includes('Marketing strategy (1)') && all.includes('Ideal customers (1)'));
    // Nothing internal, and About your business is a row with its own actions, not an entry.
    assert.ok(!all.some((t) => String(t).includes('_workspace')));
    assert.ok(!all.includes('Owners text.'));
  });

  test('read-only rows offer View and Open in Memory; an agent row offers Edit, Train, History and Delete with its version', async () => {
    const tab = await consolePanel.loadKnowledgeTab(knowledgeClient(), { accountId: ACCOUNT, appUrl: APP });
    const { content, posted } = render(tab);
    const all = buttons(content);
    const labels = all.map((b) => b.textContent);
    assert.ok(labels.includes('View') && labels.includes('Open in Memory'));
    // Click every Delete: none belongs to a read-only row, and each carries its version.
    for (const b of all.filter((x) => x.textContent === 'Delete')) b.listeners.click[0]();
    const deletes = posted.filter((m) => m.type === 'memdel');
    const readOnlyIds = new Set(tab.memories.filter((m) => m.readOnly).map((m) => m.id));
    assert.ok(deletes.length >= 3);
    for (const d of deletes) assert.ok(!readOnlyIds.has(d.id), `no Delete for read-only ${d.id}`);
    // (Spread: the message was made inside the webview's own realm.)
    assert.deepEqual({ ...deletes.find((d) => d.id === 'r-sales') }, { type: 'memdel', id: 'r-sales', domain: '_rule:no-discounts', version: 3 });
    // Open in Memory sends the row's own address.
    posted.length = 0;
    for (const b of all.filter((x) => x.textContent === 'Open in Memory')) b.listeners.click[0]();
    assert.ok(posted.some((m) => m.type === 'memopen' && m.url === `${PAGE}?agent=orchestrator&item=_account%3Asoul`));
  });

  test('negative control: the render helpers really run (a broken payload throws)', () => {
    assert.throws(() => render(null));
  });
});

describe('+ New entry: who it is for first (G7)', () => {
  function answer(picks, input) {
    let i = 0;
    vscodeStub.window.showQuickPick = (items, opts) => {
      calls.picks.push([items, opts]);
      const want = picks[i++];
      return Promise.resolve(want === undefined ? undefined : items.find((it) => it.label === want));
    };
    vscodeStub.window.showInputBox = (opts) => {
      calls.inputs.push([opts]);
      return Promise.resolve(input);
    };
  }

  test('the first question is the agent; the editor opens empty for that agent, with no entry created', async () => {
    answer(['Support', 'Rule'], 'refund-policy');
    const client = fakeClient({ memory_list: { data: [] } });
    const start = await consolePanel.startNewMemoryEntry(client, account, APP);
    const [firstItems, firstOpts] = calls.picks[0];
    assert.match(firstOpts.placeHolder, /Who is it for/);
    const offered = firstItems.filter((it) => it.kind !== vscodeStub.QuickPickItemKind.Separator).map((it) => it.label);
    assert.deepEqual(offered.slice(0, 6), ['Sales', 'Support', 'Communications', 'Production', 'Accounting', 'Website']);
    assert.ok(offered.includes('Paid ads') && offered.includes('Ideal customers'));
    assert.ok(!offered.includes('Analytics'), 'not filed until the agent servers follow it');
    assert.equal(start.open, 'editor');
    assert.equal(start.uri.path, `/memory-new/${ACCOUNT}/helpdesk/_rule__refund-policy.md`);
    assert.deepEqual([start.department, start.domain, start.kind], ['helpdesk', '_rule:refund-policy', 'rule']);
    assert.deepEqual(client.seen, [{ name: 'memory_list', args: { domain: '_rule:refund-policy' } }], 'only a check; nothing created');
    // The name is checked as the builder checks it.
    assert.ok(calls.inputs[0][0].validateInput('Refund_Policy'));
    assert.equal(calls.inputs[0][0].validateInput('refund-policy'), undefined);
  });

  test('notes are named for the agent; an entry that exists opens instead', async () => {
    answer(['SEO', 'Notes']);
    const existing = { id: 'n-seo', domain: 'seo', department: null, version: 3, content: 'x' };
    const start = await consolePanel.startNewMemoryEntry(fakeClient({ memory_list: { data: [existing] } }), account, APP);
    assert.deepEqual(start, { open: 'existing', id: 'n-seo', domain: 'seo', readOnly: false });
    assert.equal(calls.inputs.length, 0, 'notes need no name');
  });

  test('shared with every agent and the chief of staff open the Memory page', async () => {
    answer(['Shared with every agent']);
    assert.deepEqual(await consolePanel.startNewMemoryEntry(fakeClient({}), account, APP), { open: 'page', url: PAGE });
    answer(['Chief of staff']);
    assert.deepEqual(await consolePanel.startNewMemoryEntry(fakeClient({}), account, APP), { open: 'page', url: `${PAGE}?agent=orchestrator` });
  });

  test('Escape at any question stops, with nothing opened or created', async () => {
    for (const picks of [[], ['Sales'], ['Sales', 'Rule']]) {
      answer(picks, undefined);
      const client = fakeClient({});
      assert.equal(await consolePanel.startNewMemoryEntry(client, account, APP), undefined);
      assert.equal(client.seen.length, 0);
    }
  });
});

describe('Train with Claude/Codex (G7)', () => {
  test('step 6 creates with the department of the agent the entry belongs to', () => {
    const prompt = consolePanel.trainPrompt(account, { domain: '_rule:no-discounts', owner: 'sales' });
    const step6 = prompt.split('\n').find((l) => l.startsWith('6.'));
    assert.match(step6, /memory_create\(\{ type, name, content, reason, department \}\)/);
    assert.match(step6, /"sales" \(Sales\), the agent this entry belongs to/);
    assert.match(step6, /Without a department EVERY agent follows it/);
    assert.match(step6, /helpdesk \(Support\)/);
    assert.ok(!/orchestrator|analytics/.test(step6), 'only agents a new entry can be for');
    assert.match(prompt, /Keep any `<!-- department: \.\.\. -->` line exactly as it is/);
  });

  test('without an entry it asks which agent', () => {
    const step6 = consolePanel.trainPrompt(account).split('\n').find((l) => l.startsWith('6.'));
    assert.match(step6, /department is the agent it is for: ask me which one/);
  });
});

describe('the console handlers', () => {
  let open = null;
  function openConsole(client) {
    // One console per account: close the last test's first.
    open?.dispose();
    consolePanel.openAccountConsole(account, async () => client, () => APP);
    open = calls.panels.at(-1);
    assert.ok(open?.handler, 'the console listens to its webview');
    return open;
  }

  test('Delete sends the version the list showed as expected_version', async () => {
    const client = knowledgeClient(ROWS, { memory_delete: { data: { ok: true } } });
    const panel = openConsole(client);
    await panel.handler({ type: 'load', tab: 'knowledge' });
    vscodeStub.window.showWarningMessage = (...a) => { calls.warnings.push(a); return Promise.resolve('Delete'); };
    vscodeStub.window.showInputBox = () => Promise.resolve('Replaced by the refund rule');
    await panel.handler({ type: 'memdel', id: 'r-sales', domain: '_rule:no-discounts', version: 3 });
    const del = client.seen.find((c) => c.name === 'memory_delete');
    assert.deepEqual(del.args, { memory_id: 'r-sales', reason: 'Replaced by the refund rule', expected_version: 3 });
  });

  test('a delete refused as stale says so and reloads, and is not reported as a failure', async () => {
    const conflict = new Error('Tool memory_delete failed (409)');
    conflict.payload = { error: 'conflict', status: 409, details: { error: 'version_conflict', content: 'newer', version: 4 } };
    const client = knowledgeClient(ROWS, { memory_delete: conflict });
    const panel = openConsole(client);
    await panel.handler({ type: 'load', tab: 'knowledge' });
    let asked = 0;
    vscodeStub.window.showWarningMessage = (...a) => { calls.warnings.push(a); return Promise.resolve(asked++ === 0 ? 'Delete' : undefined); };
    const listsBefore = client.seen.filter((c) => c.name === 'memory_list').length;
    await panel.handler({ type: 'memdel', id: 'r-sales', domain: '_rule:no-discounts', version: 3 });
    assert.match(calls.warnings.at(-1)[0], /changed on Hiveku after this list loaded, so it was not deleted/);
    assert.equal(client.seen.filter((c) => c.name === 'memory_list').length, listsBefore + 1, 'reloaded');
    assert.equal(calls.errors.length, 0);
  });

  test('a read-only row is never deleted, and opens read-only from any list', async () => {
    const client = knowledgeClient(ROWS, { memory_delete: { data: { ok: true } } });
    const panel = openConsole(client);
    await panel.handler({ type: 'load', tab: 'knowledge' });
    vscodeStub.window.showWarningMessage = (...a) => { calls.warnings.push(a); return Promise.resolve('Delete'); };
    await panel.handler({ type: 'memdel', id: 'r-shared', domain: '_rule:no-em-dashes', version: 4 });
    assert.ok(!client.seen.some((c) => c.name === 'memory_delete'), 'nothing deleted');
    assert.match(calls.infos.at(-1)[0], /is not changed from VS Code/);
    // An Activity click on the same row (memedit) opens the read-only view.
    await panel.handler({ type: 'memedit', id: 'r-shared', domain: '_rule:no-em-dashes' });
    assert.equal(calls.opened.at(-1).path, `/memory-view/${ACCOUNT}/r-shared/_rule__no-em-dashes.md`);
    // Negative control: an agent's own row opens editable.
    await panel.handler({ type: 'memedit', id: 'r-sales', domain: '_rule:no-discounts' });
    assert.equal(calls.opened.at(-1).path, `/memory/${ACCOUNT}/r-sales/_rule__no-discounts.md`);
  });

  test('Open in Memory opens only this account\'s Memory page', async () => {
    const panel = openConsole(knowledgeClient());
    await panel.handler({ type: 'memopen', url: `${PAGE}?agent=sales` });
    await panel.handler({ type: 'memopen', url: 'https://evil.example/phish' });
    assert.deepEqual(calls.openExternal.map((u) => u.raw), [`${PAGE}?agent=sales`, PAGE], 'another address opens the page itself');
  });
});
