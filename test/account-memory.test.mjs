/**
 * Account memory in VS Code (memory programme A7): a read-only document, an
 * "Account memory" node in the Account Console tree with the unreviewed agent
 * suggestions under it, an "Edit on the dashboard" action, and a save that is
 * refused with a clear message instead of being dropped.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, beforeEach } from 'node:test';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calls, config, resetCalls, vscodeStub } from './helpers/vscode-stub.mjs';
import { loadOut, fakeClient, OUT } from './helpers/load.mjs';

const am = loadOut('accountMemory');
const platformFs = loadOut('platformFs');
const consoleTree = loadOut('consoleTree');
const knowledge = loadOut('knowledge');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const PAYLOAD = {
  data: {
    content: '## About the business\nFamily-run stairlift installer in Leeds.\n',
    version: 12,
    updated_at: '2026-09-23T14:02:11.000Z',
    bytes: 63,
    suggestions: [
      { id: 'a1', at: '2026-09-23T14:02:00Z', source: 'Sales', text: 'Closed on Mondays from November to March.' },
      { id: 'b2', at: '2026-09-22T09:30:00Z', source: 'MCP', text: 'Prefers phone calls\nover email.' },
    ],
    suggestions_version: 3,
    injected: '<account_memory>...</account_memory>',
    truncated: false,
  },
};

beforeEach(() => {
  resetCalls();
  config.clear();
});

describe('accountMemory module', () => {
  test('parses the account_memory_get payload, envelope or bare', () => {
    const mem = am.parseAccountMemory(PAYLOAD);
    assert.equal(mem.version, 12);
    assert.equal(mem.updatedAt, '2026-09-23T14:02:11.000Z');
    assert.equal(mem.suggestions.length, 2);
    assert.equal(mem.suggestionsVersion, 3);
    assert.deepEqual(am.parseAccountMemory(PAYLOAD.data), mem);
    const empty = am.parseAccountMemory({ data: { content: '', version: 0 } });
    assert.equal(empty.content, '');
    assert.equal(empty.version, 0);
    assert.deepEqual(empty.suggestions, []);
  });

  test('a changed shape is an error, never an empty memory', () => {
    for (const bad of [{ data: {} }, { data: { content: 'x' } }, { data: [] }, null, 'text', { data: { version: 3 } }]) {
      assert.throws(() => am.parseAccountMemory(bad), /unexpected shape/, JSON.stringify(bad));
    }
  });

  test('the dashboard link is the account-scoped memory page', () => {
    assert.equal(
      am.accountMemoryDashboardUrl('https://app.hiveku.com/', ACCOUNT),
      `https://app.hiveku.com/${ACCOUNT}/dashboard/memory`,
    );
    assert.equal(
      am.accountMemoryDashboardUrl(undefined, ACCOUNT.toUpperCase()),
      `https://app.hiveku.com/${ACCOUNT}/dashboard/memory`,
    );
    // Not an account id: the unscoped page, never a half-built URL.
    assert.equal(am.accountMemoryDashboardUrl('', 'x/../y'), 'https://app.hiveku.com/dashboard/memory');
  });

  test('the document says it is read-only, where to edit it, and lists suggestions with who and when', () => {
    const url = am.accountMemoryDashboardUrl('https://app.hiveku.com', ACCOUNT);
    const opts = { accountId: ACCOUNT, fetchedAt: '2026-09-24T10:00:00.000Z' };
    const doc = am.renderAccountMemoryDocument(am.parseAccountMemory(PAYLOAD), opts);
    assert.ok(doc.startsWith('---\nread_only: true\n'));
    assert.ok(doc.includes(`edit_url: "${url}"`));
    assert.match(doc, /This is a read-only copy of the account memory/);
    assert.ok(doc.includes(`> ${url}`));
    assert.match(doc, /Changes made to this file are not saved to Hiveku/);
    assert.ok(doc.includes('Family-run stairlift installer in Leeds.'));
    assert.ok(doc.includes('Version 12, last changed 2026-09-23 14:02 UTC.'));
    assert.ok(doc.includes('# Suggestions from agents, not reviewed yet'));
    assert.ok(doc.includes('- Closed on Mondays from November to March. (suggested by Sales, 2026-09-23 14:02 UTC)'));
    assert.ok(doc.includes('- Prefers phone calls over email. (suggested by MCP, 2026-09-22 09:30 UTC)'), 'one line each');
    // The owner text comes before the suggestions.
    assert.ok(doc.indexOf('Family-run') < doc.indexOf('Suggestions from agents'));
    // Same input, same bytes.
    assert.equal(doc, am.renderAccountMemoryDocument(am.parseAccountMemory(PAYLOAD), opts));
  });

  test('an empty memory says so instead of rendering nothing', () => {
    const doc = am.renderAccountMemoryDocument(am.parseAccountMemory({ data: { content: '', version: 0 } }), {
      accountId: ACCOUNT,
      fetchedAt: '2026-09-24T10:00:00.000Z',
    });
    assert.ok(doc.includes('Nothing has been written yet. An owner or admin can start it on the dashboard.'));
    assert.ok(doc.includes('None waiting.'));
  });

  // The plugin, hiveku-sync and this extension write ONE file. When a plugin
  // checkout with lib/account-memory.mjs sits beside this repo (or at
  // HIVEKU_PLUGIN_PATH), the two renderers must agree byte for byte.
  const pluginRoot = process.env.HIVEKU_PLUGIN_PATH || path.join(OUT, '..', '..', 'hiveku-claude-plugin');
  const pluginModule = path.join(pluginRoot, 'lib', 'account-memory.mjs');
  test(
    `same bytes as the plugin's renderer (${pluginModule})`,
    { skip: existsSync(pluginModule) ? false : 'no plugin checkout with lib/account-memory.mjs beside this repo' },
    async () => {
      const plugin = await import(pathToFileURL(pluginModule).href);
      const fetchedAt = '2026-09-24T10:00:00.000Z';
      const cases = [
        PAYLOAD,
        { data: { content: '', version: 0, suggestions: [] } },
        { data: { ...PAYLOAD.data, truncated: true, updated_at: null } },
        { data: { ...PAYLOAD.data, suggestions: [{ id: 'z', at: 'not a date', source: '', text: 'Say "hi"\u2028there' }] } },
      ];
      for (const [i, payload] of cases.entries()) {
        for (const accountId of [ACCOUNT, 'not-a-uuid']) {
          const theirs = plugin.renderAccountMemoryFile({
            memory: plugin.normalizeAccountMemory(payload),
            accountId,
            fetchedAt,
          });
          const ours = am.renderAccountMemoryDocument(am.parseAccountMemory(payload), { accountId, fetchedAt });
          assert.equal(ours, theirs, `case ${i} (${accountId})`);
        }
      }
    },
  );

  test('only the two account memory domains are account memory', () => {
    for (const d of ['account', 'account-suggestions', ' Account ']) assert.equal(am.isAccountMemoryDomain(d), true, d);
    for (const d of ['accounting', '_account:memory:about', 'sales', 'account_x', '', undefined, null]) {
      assert.equal(am.isAccountMemoryDomain(d), false, String(d));
    }
  });

  test('the local copy is written read-only at hiveku-data/account/ACCOUNT_MEMORY.md and can be refreshed', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-am-'));
    const file = await am.writeAccountMemoryFile(dir, am.parseAccountMemory(PAYLOAD), { accountId: ACCOUNT });
    assert.equal(file, path.join(dir, 'hiveku-data', 'account', 'ACCOUNT_MEMORY.md'));
    const st = await fs.stat(file);
    assert.equal(st.mode & 0o222, 0, 'no write bit');
    // A second download replaces it even though it is read-only.
    const next = { data: { ...PAYLOAD.data, content: 'Second version.', suggestions: [] } };
    await am.writeAccountMemoryFile(dir, am.parseAccountMemory(next), { accountId: ACCOUNT });
    const text = await fs.readFile(file, 'utf8');
    assert.ok(text.includes('Second version.'));
    assert.ok(!text.includes('Family-run'));
    assert.equal((await fs.stat(file)).mode & 0o222, 0, 'still read-only after a refresh');
    const left = await fs.readdir(path.dirname(file));
    assert.deepEqual(left, ['ACCOUNT_MEMORY.md'], 'no temp file left behind');
    await fs.chmod(file, 0o644);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('hiveku:/account-memory document', () => {
  const makeFs = (answers) => {
    const client = fakeClient(answers);
    let clientRequests = 0;
    const provider = new platformFs.HivekuFileSystem(
      async () => {
        clientRequests++;
        return client;
      },
      () => 'https://app.example.test',
    );
    return { provider, client, clientRequests: () => clientRequests };
  };

  test('the URI names the account and the file', () => {
    const uri = platformFs.accountMemoryUri(ACCOUNT);
    assert.equal(uri.scheme, 'hiveku');
    assert.equal(uri.path, `/account-memory/${ACCOUNT}/ACCOUNT_MEMORY.md`);
  });

  test('stat marks the account memory read-only, and only it', () => {
    const { provider } = makeFs({});
    const st = provider.stat(platformFs.accountMemoryUri(ACCOUNT));
    assert.equal(st.permissions, vscodeStub.FilePermission.Readonly);
    // Negative control: an ordinary memory entry stays editable.
    const other = provider.stat(platformFs.memoryUri(ACCOUNT, 'mem-1', 'sales'));
    assert.equal(other.permissions, undefined);
  });

  test('reading fetches account_memory_get and renders the document', async () => {
    const { provider, client } = makeFs({ account_memory_get: PAYLOAD });
    const bytes = await provider.readFile(platformFs.accountMemoryUri(ACCOUNT));
    const text = new TextDecoder().decode(bytes);
    assert.deepEqual(client.seen.map((c) => c.name), ['account_memory_get']);
    assert.ok(text.includes('Family-run stairlift installer in Leeds.'));
    assert.ok(text.includes(`https://app.example.test/${ACCOUNT}/dashboard/memory`));
    assert.ok(text.includes('(suggested by Sales, 2026-09-23 14:02 UTC)'));
  });

  test('a changed answer shape fails the read instead of showing an empty document', async () => {
    const { provider } = makeFs({ account_memory_get: { data: { unexpected: true } } });
    await assert.rejects(provider.readFile(platformFs.accountMemoryUri(ACCOUNT)), /unexpected shape/);
  });

  test('saving is refused with a clear message, before any tool is called', async () => {
    const { provider, client, clientRequests } = makeFs({ account_memory_get: PAYLOAD });
    await assert.rejects(
      provider.writeFile(platformFs.accountMemoryUri(ACCOUNT), new TextEncoder().encode('edited')),
      (err) => {
        assert.equal(err.code, 'NoPermissions');
        assert.match(err.message, /cannot be changed from VS Code, so nothing was saved/);
        assert.ok(err.message.includes(`https://app.example.test/${ACCOUNT}/dashboard/memory`));
        return true;
      },
    );
    assert.equal(client.seen.length, 0, 'no tool call: there is no set tool, and nothing may be appended');
    assert.equal(clientRequests(), 0);
    assert.equal(calls.errors.length, 1, 'the person is told, not left with a silent no-op');
    assert.match(calls.errors[0][0], /nothing was saved/);
    assert.equal(calls.errors[0][1], 'Edit on the dashboard');
    assert.equal(calls.infos.length, 0, 'never a success message');
  });

  test('negative control: an ordinary memory entry still saves through memory_update', async () => {
    // Since V1 a save reads the entry first (the stale-edit check), then writes.
    const { provider, client } = makeFs({
      memory_get: { data: { id: 'mem-1', version: 3, content: 'old' } },
      memory_update: { data: { ok: true } },
    });
    await provider.writeFile(platformFs.memoryUri(ACCOUNT, 'mem-1', 'sales'), new TextEncoder().encode('x'));
    assert.deepEqual(client.seen.map((c) => c.name), ['memory_get', 'memory_update']);
  });
});

describe('Account Console tree: Account memory node', () => {
  const record = { accountId: ACCOUNT, label: 'Western Stairlifts' };
  const accounts = {
    list: () => [record],
    getRole: () => undefined,
    getDepartments: () => undefined,
  };
  const makeTree = (answers) => {
    const client = fakeClient(answers);
    const tree = new consoleTree.AccountConsoleProvider(accounts, async () => client, async () => null);
    return { tree, client };
  };

  test('each account shows an Account memory node, without fetching it until expanded', async () => {
    const { tree, client } = makeTree({ account_memory_get: PAYLOAD });
    const [accountNode] = await tree.getChildren();
    const children = await tree.getChildren(accountNode);
    const kinds = children.map((c) => c.kind);
    assert.deepEqual(kinds.slice(0, 3), ['section', 'section', 'accountMemory']);
    assert.equal(client.seen.filter((c) => c.name === 'account_memory_get').length, 0);
    const item = tree.getTreeItem(children[2]);
    assert.equal(item.label, 'Account memory');
    assert.equal(item.contextValue, 'hivekuConsoleAccountMemory');
    assert.equal(item.command.command, 'hiveku.accountMemoryOpen');
    assert.match(String(item.tooltip), /Read-only here: owners and admins edit it on the Hiveku dashboard/);
  });

  test('expanding it lists Edit on the dashboard, then the suggestions with who and when', async () => {
    const { tree, client } = makeTree({ account_memory_get: PAYLOAD });
    const node = { kind: 'accountMemory', record };
    const children = await tree.getChildren(node);
    assert.equal(children.length, 3);
    const edit = tree.getTreeItem(children[0]);
    assert.equal(edit.label, 'Edit on the dashboard');
    assert.equal(edit.command.command, 'hiveku.accountMemoryEditOnDashboard');
    assert.deepEqual(edit.command.arguments, [{ record }]);
    const first = tree.getTreeItem(children[1]);
    assert.equal(first.label, 'Closed on Mondays from November to March.');
    assert.equal(first.description, 'Sales · 2026-09-23 14:02 UTC');
    assert.match(String(first.tooltip), /No owner has reviewed it yet/);
    // Cached: expanding again does not refetch; the node now shows the count.
    await tree.getChildren(node);
    assert.equal(client.seen.length, 1);
    assert.equal(tree.getTreeItem(node).description, 'read-only · 2 suggestions');
  });

  test('no suggestions: says so plainly', async () => {
    const { tree } = makeTree({ account_memory_get: { data: { content: 'x', version: 1, suggestions: [] } } });
    const children = await tree.getChildren({ kind: 'accountMemory', record });
    assert.deepEqual(children.map((c) => c.label ?? c.kind), ['Edit on the dashboard', 'No suggestions from agents are waiting']);
  });

  test('a failed load keeps the dashboard link and names the failure, never throws', async () => {
    const { tree } = makeTree({ account_memory_get: new Error('Tool account_memory_get errored: unknown tool') });
    const children = await tree.getChildren({ kind: 'accountMemory', record });
    assert.equal(children[0].label, 'Edit on the dashboard');
    assert.equal(children[1].label, 'Could not load the account memory');
    assert.match(children[1].tooltip, /unknown tool/);
  });

  test('refresh drops the cached memory', async () => {
    const { tree, client } = makeTree({ account_memory_get: PAYLOAD });
    const node = { kind: 'accountMemory', record };
    await tree.getChildren(node);
    tree.refresh();
    await tree.getChildren(node);
    assert.equal(client.seen.length, 2);
  });
});

describe('knowledge: the account memory is never a department', () => {
  test('fetchKnowledge skips both account memory domains and keeps look-alikes', async () => {
    const rows = [
      { id: '1', domain: 'account', content: 'owner text' },
      { id: '2', domain: 'account-suggestions', content: '{"v":1}' },
      { id: '3', domain: 'sales', content: 's' },
      { id: '4', domain: 'accounting', content: 'a' },
    ];
    const client = fakeClient({ memory_list: (args) => ({ data: args.type === 'memory' ? rows : [] }) });
    const index = await knowledge.fetchKnowledge(client);
    assert.deepEqual([...index.keys()].sort(), ['accounting', 'sales']);
    assert.equal(index.has('account'), false);
    assert.equal(index.has('account-suggestions'), false);
  });

  test('the console Knowledge tab never lists the account memory rows as editable entries', async () => {
    const consolePanel = loadOut('console');
    const client = fakeClient({
      memory_list: {
        data: [
          { id: '1', domain: 'account' },
          { id: '2', domain: 'account-suggestions' },
          { id: '3', domain: 'sales' },
          { id: '4', domain: '_account:memory:about' },
        ],
      },
      kb_list: { data: [] },
    });
    const tab = await consolePanel.loadKnowledgeTab(client);
    assert.deepEqual(tab.memories.map((m) => m.domain), ['sales', '_account:memory:about']);
  });

  test("the account folder opens hiveku-data/account/ read-only, beside the user's own patterns", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-ws-'));
    await fs.mkdir(path.join(dir, '.vscode'));
    const file = path.join(dir, '.vscode', 'settings.json');
    await fs.writeFile(file, JSON.stringify({ 'files.readonlyInclude': { 'vendor/**': true } }));
    await knowledge.writeWindowIdentity(dir, 'Western Stairlifts', ACCOUNT);
    let s = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(s['files.readonlyInclude'], { 'vendor/**': true, 'hiveku-data/account/**': true });
    // A person who explicitly turned it off keeps their choice.
    await fs.writeFile(file, JSON.stringify({ 'files.readonlyInclude': { 'hiveku-data/account/**': false } }));
    await knowledge.writeWindowIdentity(dir, 'Western Stairlifts', ACCOUNT);
    s = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(s['files.readonlyInclude']['hiveku-data/account/**'], false);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('package.json wiring', () => {
  test('both commands are declared and the editor title action matches the document URI', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(OUT, '..', 'package.json'), 'utf8'));
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    assert.ok(ids.has('hiveku.accountMemoryOpen'));
    assert.ok(ids.has('hiveku.accountMemoryEditOnDashboard'));
    const inline = pkg.contributes.menus['view/item/context'].find(
      (m) => m.command === 'hiveku.accountMemoryEditOnDashboard' && m.group === 'inline' && /hivekuConsoleAccountMemory$/.test(m.when),
    );
    assert.ok(inline, 'the node carries an inline Edit on the dashboard action');
    const title = pkg.contributes.menus['editor/title'].find((m) => m.command === 'hiveku.accountMemoryEditOnDashboard');
    const pattern = title.when.match(/resourcePath =~ \/(.*)\/$/)[1];
    const re = new RegExp(pattern);
    assert.ok(re.test(platformFs.accountMemoryUri(ACCOUNT).path));
    assert.ok(!re.test(platformFs.memoryUri(ACCOUNT, 'm', 'sales').path));
  });
});
