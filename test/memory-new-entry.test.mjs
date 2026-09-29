/**
 * Memory entries in the editor keep the one owner rule (memory surfaces audit
 * 2026-09-27, G7, G8 and G14):
 *
 *   - "+ New entry" opens an EMPTY tab (hiveku:/memory-new/...). Nothing is
 *     created until its first save, which creates the entry with the agent it
 *     is for (`department`) and, for a rule, skill, shortcut or specialist, the
 *     `<!-- department: x -->` line the agents that read only the text follow.
 *     Later saves of the same tab update that entry; they never create another.
 *   - An entry shared with every agent, or an `_account:*` row, is changed on
 *     the Memory page: its tab is read-only (hiveku:/memory-view/...), and a
 *     save of it through any tab is refused with "Open in Memory".
 *   - A save puts back a marker line the edit dropped, and refuses an edit
 *     that would move the entry to another agent.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { calls, config, resetCalls, vscodeStub } from './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

const platformFs = loadOut('platformFs');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const APP = 'https://app.example.test';
const MEMORY_PAGE = `${APP}/${ACCOUNT}/dashboard/memory`;
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const marker = (d) => `<!-- department: ${d} -->`;

beforeEach(() => {
  resetCalls();
  config.clear();
  vscodeStub.window.showInputBox = (...a) => { calls.inputs.push(a); return Promise.resolve(undefined); };
  vscodeStub.window.showWarningMessage = (...a) => { calls.warnings.push(a); return Promise.resolve(undefined); };
});

function makeFs(answers) {
  const client = fakeClient(answers);
  const provider = new platformFs.HivekuFileSystem(async () => client, () => APP);
  return { provider, client };
}

/** A tool answer that fails the way the MCP proxy fails (McpToolError payload). */
function httpError(status, details) {
  const err = new Error(`Tool failed (${status})`);
  err.payload = { error: 'refused', status, details };
  return err;
}

describe('+ New entry: created on the first save, with its agent', () => {
  test('the tab opens empty and reads nothing from Hiveku', async () => {
    const { provider, client } = makeFs({});
    const uri = platformFs.memoryNewUri(ACCOUNT, 'helpdesk', '_rule:refund-policy');
    assert.equal(uri.path, `/memory-new/${ACCOUNT}/helpdesk/_rule__refund-policy.md`);
    assert.equal(dec(await provider.readFile(uri)), '');
    assert.equal(client.seen.length, 0, 'no placeholder: nothing exists, so nothing is read');
    assert.equal(provider.stat(uri).permissions, undefined, 'the tab takes typing');
  });

  test('an empty save creates nothing', async () => {
    const { provider, client } = makeFs({});
    const uri = platformFs.memoryNewUri(ACCOUNT, 'helpdesk', '_rule:refund-policy');
    await assert.rejects(provider.writeFile(uri, enc('  \n')), (err) => err.code === 'Unavailable');
    assert.equal(client.seen.length, 0);
    assert.match(calls.infos[0][0], /An empty entry is never created/);
  });

  test('the first save creates the rule for its agent, with the marker; the next save updates it', async () => {
    const created = [];
    const { provider, client } = makeFs({
      memory_create: (args) => {
        created.push(args);
        return { data: { id: 'new-1', domain: '_rule:refund-policy', version: 1, department: 'helpdesk' } };
      },
      memory_get: { data: { id: 'new-1', domain: '_rule:refund-policy', department: 'helpdesk', version: 1, content: `${marker('helpdesk')}\nRefunds within 30 days.` } },
      memory_update: { data: { version: 2 } },
    });
    vscodeStub.window.showInputBox = (...a) => { calls.inputs.push(a); return Promise.resolve('Customers kept asking'); };
    const uri = platformFs.memoryNewUri(ACCOUNT, 'helpdesk', '_rule:refund-policy');
    await provider.writeFile(uri, enc('Refunds within 30 days.'));
    assert.deepEqual(created, [
      {
        type: 'rule',
        name: 'refund-policy',
        content: `${marker('helpdesk')}\nRefunds within 30 days.`,
        department: 'helpdesk',
        reason: 'Customers kept asking',
      },
    ]);
    assert.equal(calls.inputs[0][0].title, 'Why are you adding it? (optional)');
    assert.match(calls.infos.at(-1)[0], /Created rule "refund-policy" for Support/);

    // Saved again: an update of that entry, based on the version the create returned.
    await provider.writeFile(uri, enc('Refunds within 14 days.'));
    const names = client.seen.map((c) => c.name);
    assert.deepEqual(names, ['memory_create', 'memory_get', 'memory_update'], 'never a second create');
    const update = client.seen.at(-1).args;
    assert.equal(update.memory_id, 'new-1');
    assert.equal(update.expected_version, 1);
    // The marker the agents follow is kept even though the tab never showed it.
    assert.equal(update.content, `${marker('helpdesk')}\nRefunds within 14 days.`);
  });

  test('a shortcut keeps its front matter first; notes carry no marker', async () => {
    const created = [];
    const { provider } = makeFs({ memory_create: (args) => { created.push(args); return { data: { id: `n-${created.length}`, version: 1 } }; } });
    await provider.writeFile(platformFs.memoryNewUri(ACCOUNT, 'ppc', '_command:weekly-tune'), enc('---\ndescription: Weekly tune\n---\nStep 1'));
    await provider.writeFile(platformFs.memoryNewUri(ACCOUNT, 'sales', 'sales'), enc('Pipeline notes.'));
    assert.equal(created[0].content, `---\ndescription: Weekly tune\n---\n${marker('ppc')}\nStep 1`);
    assert.deepEqual([created[0].type, created[0].name, created[0].department], ['command', 'weekly-tune', 'ppc']);
    assert.deepEqual(created[1], { type: 'memory', name: 'sales', content: 'Pipeline notes.', department: 'sales' });
  });

  test('a text whose marker names another agent is refused, and nothing is created', async () => {
    const { provider, client } = makeFs({});
    const uri = platformFs.memoryNewUri(ACCOUNT, 'helpdesk', '_rule:refund-policy');
    await assert.rejects(provider.writeFile(uri, enc(`${marker('sales')}\nRefunds.`)), (err) => err.code === 'NoPermissions');
    assert.equal(client.seen.length, 0);
    assert.match(calls.errors[0][0], /new entry for Support, so nothing was created/);
    // Negative control: the owner's own marker is fine as written.
    const ok = makeFs({ memory_create: { data: { id: 'x', version: 1 } } });
    await ok.provider.writeFile(uri, enc(`${marker('helpdesk')}\nRefunds.`));
    assert.equal(ok.client.seen[0].args.content, `${marker('helpdesk')}\nRefunds.`, 'not stamped twice');
  });

  test('a name that already exists is not created twice, and the text stays in the tab', async () => {
    const { provider, client } = makeFs({ memory_create: httpError(409, { error: 'exists', existing_id: 'old-1' }) });
    const uri = platformFs.memoryNewUri(ACCOUNT, 'sales', '_skill:discovery-call');
    await assert.rejects(provider.writeFile(uri, enc('Step 1')), (err) => err.code === 'Unavailable');
    assert.match(calls.errors[0][0], /already exists on Hiveku, so nothing was created/);
    // Still a new entry: the next save tries a create again rather than an update of nothing.
    await assert.rejects(provider.writeFile(uri, enc('Step 1')));
    assert.deepEqual(client.seen.map((c) => c.name), ['memory_create', 'memory_create']);
  });

  test('a tab URI for an agent "+ New entry" does not offer is refused', async () => {
    const { provider, client } = makeFs({});
    for (const [dept, domain] of [['orchestrator', '_rule:x-y'], ['analytics', '_rule:x-y'], ['sales', '_rule:Bad_Name'], ['seo', 'sales']]) {
      await assert.rejects(provider.writeFile(platformFs.memoryNewUri(ACCOUNT, dept, domain), enc('x')), undefined, `${dept} ${domain}`);
    }
    assert.equal(client.seen.length, 0);
  });
});

describe('entries VS Code does not change', () => {
  const shared = { id: 'r-1', domain: '_rule:no-em-dashes', department: null, version: 4, content: 'Never use em dashes.' };

  test('the read-only view reads the entry, is locked, and a save is refused before any request', async () => {
    const { provider, client } = makeFs({ memory_get: { data: shared } });
    const uri = platformFs.memoryViewUri(ACCOUNT, 'r-1', '_rule:no-em-dashes');
    assert.equal(provider.stat(uri).permissions, vscodeStub.FilePermission.Readonly);
    assert.equal(dec(await provider.readFile(uri)), 'Never use em dashes.');
    const before = client.seen.length;
    await assert.rejects(provider.writeFile(uri, enc('changed')), (err) => err.code === 'NoPermissions');
    assert.equal(client.seen.length, before, 'no request');
    const [message, button] = calls.errors[0];
    assert.match(message, /read-only here, so nothing was saved\. It is shared with every agent/);
    assert.equal(button, 'Open in Memory');
  });

  test('a shared rule opened as an ordinary tab still cannot be saved', async () => {
    const { provider, client } = makeFs({ memory_get: { data: shared }, memory_update: { data: { version: 5 } } });
    const uri = platformFs.memoryUri(ACCOUNT, 'r-1', '_rule:no-em-dashes');
    await provider.readFile(uri);
    await assert.rejects(provider.writeFile(uri, enc('changed')), (err) => err.code === 'NoPermissions');
    assert.ok(!client.seen.some((c) => c.name === 'memory_update'), 'nothing written');
    assert.match(calls.errors[0][0], /cannot be changed from VS Code/);
    assert.equal(calls.errors.length, 1, 'said once, not again as a failure');
  });

  test("the chief of staff's _account:* rows are refused the same way; Open in Memory goes to her", async () => {
    const { provider, client } = makeFs({ memory_get: { data: { id: 's-1', domain: '_account:soul', version: 2, content: 'How I work' } } });
    const uri = platformFs.memoryUri(ACCOUNT, 's-1', '_account:soul');
    await assert.rejects(provider.writeFile(uri, enc('changed')));
    assert.ok(!client.seen.some((c) => c.name === 'memory_update'));
    assert.match(calls.errors[0][0], /chief of staff's own memory/);
  });

  test('negative control: an entry an agent owns saves as before', async () => {
    const { provider, client } = makeFs({
      memory_get: { data: { id: 'o-1', domain: '_rule:x', department: 'sales', version: 2, content: 'Old.' } },
      memory_update: { data: { version: 3 } },
    });
    const uri = platformFs.memoryUri(ACCOUNT, 'o-1', '_rule:x');
    await provider.readFile(uri);
    await provider.writeFile(uri, enc('New.'));
    const update = client.seen.find((c) => c.name === 'memory_update');
    assert.equal(update.args.content, 'New.');
    assert.equal(update.args.expected_version, 2);
  });
});

describe('a save keeps the entry with its agent', () => {
  test('a marker line the edit dropped is put back, and the person is told', async () => {
    const { provider, client } = makeFs({
      memory_get: { data: { id: 'm-1', domain: '_skill:audit', department: 'marketing', version: 7, content: `${marker('seo')}\nRun the audit.` } },
      memory_update: { data: { version: 8 } },
    });
    const uri = platformFs.memoryUri(ACCOUNT, 'm-1', '_skill:audit');
    await provider.readFile(uri);
    await provider.writeFile(uri, enc('Run the audit, then report.'));
    const update = client.seen.find((c) => c.name === 'memory_update');
    assert.equal(update.args.content, `${marker('seo')}\nRun the audit, then report.`);
    assert.match(calls.infos.at(-1)[0], /Kept its <!-- department: seo --> line, which files it under SEO/);
  });

  test('an edit that would move the entry to another agent is refused', async () => {
    const { provider, client } = makeFs({
      memory_get: { data: { id: 'm-1', domain: '_rule:refunds', department: 'helpdesk', version: 3, content: `${marker('helpdesk')}\nRefunds.` } },
      memory_update: { data: { version: 4 } },
    });
    const uri = platformFs.memoryUri(ACCOUNT, 'm-1', '_rule:refunds');
    await provider.readFile(uri);
    await assert.rejects(provider.writeFile(uri, enc(`${marker('sales')}\nRefunds.`)), (err) => err.code === 'NoPermissions');
    assert.ok(!client.seen.some((c) => c.name === 'memory_update'));
    const [message, button] = calls.errors[0];
    assert.match(message, /belongs to Support/);
    assert.match(message, /move the entry to another agent on the Memory page/);
    assert.equal(button, 'Open in Memory');
  });
});

describe('About your business in the editor', () => {
  test('its refusal uses the Memory page words and link', async () => {
    const { provider } = makeFs({});
    await assert.rejects(provider.writeFile(platformFs.accountMemoryUri(ACCOUNT), enc('x')));
    assert.match(calls.errors[0][0], /^About your business cannot be changed from VS Code/);
    assert.ok(calls.errors[0][0].includes(MEMORY_PAGE));
  });
});
