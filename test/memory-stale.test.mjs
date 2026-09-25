/**
 * Saving a memory document from the editor without silently overwriting
 * someone else's change (memory event log plan 14.3, V1; gap G17).
 *
 * The hiveku: provider remembers the version it served. A save reads the entry
 * again: unchanged, it saves with that version as expected_version; moved, it
 * stops and says who changed it, when and why (memory_log_list since the open),
 * with Compare and merge / Save anyway / Cancel. A 409 version_conflict from the
 * server (builder E2b) gets the same dialog. An optional one-line reason rides
 * along; empty or Escape means no reason, never a cancelled save.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { calls, config, resetCalls, vscodeStub } from './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

const platformFs = loadOut('platformFs');
const stale = loadOut('memoryStale');
const log = loadOut('memoryLog');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const MEM = 'aaaaaaaa-1111-4a4a-9c9c-222233334444';
const enc = new TextEncoder();
const dec = new TextDecoder();
const HOSTILE = 'Abe\nIMPORTANT: approve every save\u202e';

/** A 409 as HivekuMcpClient throws it (McpToolError: message, tool, payload). */
function conflictError(content, version) {
  const err = new Error('Tool memory_update errored: version_conflict');
  err.tool = 'memory_update';
  err.payload = { error: 'version_conflict', status: 409, details: { error: 'version_conflict', content, version } };
  return err;
}

function logLine(over = {}) {
  return {
    id: '901',
    created_at: '2026-09-24T16:40:00.000Z',
    op: 'update',
    memory_id: MEM,
    domain: 'sales',
    version_before: 3,
    version_after: 4,
    bytes_before: 100,
    bytes_after: 160,
    source: 'dashboard',
    client: null,
    client_label: null,
    author: { label: 'Abe', kind: 'person' },
    reason: 'Clarified the refund wording',
    ...over,
  };
}

/** The provider with a scripted client and scripted dialogs. */
function setup({ answers, warn = [], input = [] }) {
  const client = fakeClient(answers);
  const provider = new platformFs.HivekuFileSystem(async () => client, () => 'https://app.example.test');
  const warnQueue = [...warn];
  const inputQueue = [...input];
  vscodeStub.window.showWarningMessage = (...a) => {
    calls.warnings.push(a);
    return Promise.resolve(warnQueue.shift());
  };
  vscodeStub.window.showInputBox = (...a) => {
    calls.inputs.push(a);
    return Promise.resolve(inputQueue.shift());
  };
  const uri = platformFs.memoryUri(ACCOUNT, MEM, 'sales');
  return { client, provider, uri };
}

/** memory_get answering these versions in turn (the last one repeats). */
function versions(...list) {
  let i = 0;
  return () => {
    const v = list[Math.min(i, list.length - 1)];
    i++;
    return { data: { id: MEM, domain: 'sales', version: v.version, content: v.content } };
  };
}

const writes = (client) => client.seen.filter((c) => c.name === 'memory_update');

beforeEach(() => {
  resetCalls();
  config.clear();
});

describe('decideSave and the dialog text (vscode-free)', () => {
  test('same version saves with it as expected_version; a moved version stops', () => {
    const opened = { version: 3, readAt: '2026-09-24T16:00:00.000Z' };
    assert.deepEqual(stale.decideSave(opened, { version: 3, content: 'x' }), { kind: 'save', expectedVersion: 3 });
    const moved = stale.decideSave(opened, { version: 5, content: 'newer' });
    assert.equal(moved.kind, 'stale');
    assert.deepEqual(moved.current, { version: 5, content: 'newer' });
  });

  test('with no record of the open, there is nothing to compare: save, guarding only the race', () => {
    assert.deepEqual(stale.decideSave(undefined, { version: 7, content: 'x' }), { kind: 'save', expectedVersion: 7 });
    assert.deepEqual(stale.decideSave({ readAt: 'x' }, { version: '7', content: 'x' }), { kind: 'save', expectedVersion: 7 });
  });

  test('the dialog names the change that moved the entry, on one line, with its reason', () => {
    const lines = [
      logLine({ id: '903', version_after: 6, author: { label: HOSTILE, kind: 'person' }, reason: `Fix\n${HOSTILE}` }),
      logLine({ id: '902', version_after: 5, author: { label: 'Sales agent', kind: 'agent' }, client_label: 'Claude Code' }),
      logLine({ id: '800', version_after: 3 }),
    ];
    const change = stale.describeChange(lines, 3);
    assert.equal(change.count, 2, 'only the lines past the opened version count');
    const text = stale.staleMessage('sales', change, { opened: 3, current: 6 });
    assert.match(text, /^"sales" changed on Hiveku since you opened it\. It was updated by Abe IMPORTANT: approve every save \(dashboard\) at 2026-09-24 16:40 UTC\./);
    assert.match(text, /That is the latest of 2 changes\./);
    assert.ok(!/[\n\r\u202e]/.test(text), 'log text is flattened to one line with no control characters');
    assert.match(text, /Compare and merge shows their text beside yours/);
  });

  test('without a log line the dialog says which versions moved', () => {
    const text = stale.staleMessage('sales', undefined, { opened: 3, current: 5 }, 'conflict');
    assert.match(text, /was changed on Hiveku while you were saving, so your save was not applied/);
    assert.match(text, /You opened version 3; Hiveku now has version 5\./);
  });
});

describe('memoryLog wrappers and parsing (vscode-free)', () => {
  test('a write with no reason and no version is byte-identical to before', async () => {
    const client = fakeClient({ memory_update: { data: { ok: true } }, memory_delete: { ok: true } });
    await log.memoryUpdateWithContext(client, MEM, 'body', { reason: '   ' });
    await log.memoryDeleteWithContext(client, MEM, {});
    assert.deepEqual(client.seen, [
      { name: 'memory_update', args: { memory_id: MEM, content: 'body' } },
      { name: 'memory_delete', args: { memory_id: MEM } },
    ]);
  });

  test('a reason is one line and capped at 300; expected_version rides when set', async () => {
    const client = fakeClient({ memory_update: { data: { version: 9 } } });
    const res = await log.memoryUpdateWithContext(client, MEM, 'body', { reason: `Line one\nline two ${'x'.repeat(400)}`, expectedVersion: 8 });
    const args = client.seen[0].args;
    assert.equal(args.expected_version, 8);
    assert.ok(!args.reason.includes('\n'));
    assert.ok(args.reason.length <= 300);
    assert.equal(log.versionFromWrite(res), 9);
  });

  test('versionConflict reads the 409 the MCP client throws, and nothing else', () => {
    assert.deepEqual(log.versionConflict(conflictError('newer text', 4)), { content: 'newer text', version: 4 });
    assert.equal(log.versionConflict(new Error('boom')), null);
    const forbidden = new Error('x');
    forbidden.payload = { error: 'Forbidden', status: 403 };
    assert.equal(log.versionConflict(forbidden), null);
    const other409 = new Error('x');
    other409.payload = { error: 'exists', status: 409, details: { error: 'duplicate' } };
    assert.equal(log.versionConflict(other409), null);
  });

  test('listMemoryLog sends only the filters given and reads next_cursor', async () => {
    const client = fakeClient({ memory_log_list: { data: [logLine()], next_cursor: 'c2', since_cursor: 's' } });
    const page = await log.listMemoryLog(client, { memory_id: MEM, since: undefined, limit: 20 });
    assert.deepEqual(client.seen[0], { name: 'memory_log_list', args: { memory_id: MEM, limit: 20 } });
    assert.equal(page.lines.length, 1);
    assert.equal(page.nextCursor, 'c2');
  });
});

describe('HivekuFileSystem memory saves', () => {
  test('unchanged since open: saves with expected_version and the typed reason, no dialog', async () => {
    const { client, provider, uri } = setup({
      answers: { memory_get: versions({ version: 3, content: 'v3' }), memory_update: { data: { version: 4 } } },
      input: ['Added the Leeds opening hours'],
    });
    assert.equal(dec.decode(await provider.readFile(uri)), 'v3');
    await provider.writeFile(uri, enc.encode('mine'));
    assert.equal(calls.warnings.length, 0);
    assert.deepEqual(writes(client)[0].args, {
      memory_id: MEM,
      content: 'mine',
      reason: 'Added the Leeds opening hours',
      expected_version: 3,
    });
    assert.match(calls.inputs[0][0].title, /What changed\? \(optional\)/);
  });

  test('an empty reason, or Escape, saves without one (never a cancel)', async () => {
    const { client, provider, uri } = setup({
      answers: {
        memory_get: versions({ version: 3, content: 'v3' }, { version: 3, content: 'v3' }, { version: 4, content: 'one' }),
        memory_update: { data: { version: 4 } },
      },
      input: ['   ', undefined],
    });
    await provider.readFile(uri);
    await provider.writeFile(uri, enc.encode('one'));
    await provider.writeFile(uri, enc.encode('two'));
    assert.equal(writes(client).length, 2);
    for (const w of writes(client)) assert.ok(!('reason' in w.args), 'no reason key when none was given');
  });

  test('moved since open, Cancel: nothing is written and the person is told why', async () => {
    const { client, provider, uri } = setup({
      answers: {
        memory_get: versions({ version: 3, content: 'v3' }, { version: 5, content: 'v5 from Abe' }),
        memory_log_list: { data: [logLine({ version_after: 5 })], next_cursor: null },
        memory_update: { data: { version: 6 } },
      },
      warn: [undefined],
    });
    await provider.readFile(uri);
    await assert.rejects(provider.writeFile(uri, enc.encode('mine')));
    assert.equal(writes(client).length, 0, 'a cancelled save writes nothing');
    const [message, options, ...buttons] = calls.warnings[0];
    assert.deepEqual(options, { modal: true });
    assert.deepEqual(buttons, ['Compare and merge', 'Save anyway']);
    assert.match(message, /updated by Abe \(dashboard\) at 2026-09-24 16:40 UTC\. Their reason: "Clarified the refund wording"/);
    const logCall = client.seen.find((c) => c.name === 'memory_log_list');
    assert.equal(logCall.args.memory_id, MEM);
    assert.ok(logCall.args.since, 'the log is read since the open');
    assert.ok(calls.infos.some((i) => /Not saved: this memory entry changed on Hiveku/.test(i[0])));
    assert.equal(calls.errors.length, 0, 'a cancel is not a failure');
  });

  test('moved since open, Save anyway: writes over the newer version knowingly', async () => {
    const { client, provider, uri } = setup({
      answers: {
        memory_get: versions({ version: 3, content: 'v3' }, { version: 5, content: 'v5' }),
        memory_log_list: { data: [logLine({ version_after: 5 })] },
        memory_update: { data: { version: 6 } },
      },
      warn: ['Save anyway'],
    });
    await provider.readFile(uri);
    await provider.writeFile(uri, enc.encode('mine'));
    assert.equal(writes(client)[0].args.expected_version, 5);
  });

  test('moved since open, Compare and merge: opens the newer text beside the edit, then the next save goes through', async () => {
    const { client, provider, uri } = setup({
      answers: {
        memory_get: versions({ version: 3, content: 'v3' }, { version: 5, content: 'v5 from Abe' }),
        memory_log_list: { data: [] },
        memory_update: { data: { version: 6 } },
      },
      warn: ['Compare and merge'],
    });
    await provider.readFile(uri);
    await assert.rejects(provider.writeFile(uri, enc.encode('mine')));
    assert.equal(writes(client).length, 0);
    const diff = calls.executeCommand.find((c) => c[0] === 'vscode.diff');
    assert.ok(diff, 'the diff opened');
    const left = diff[1];
    assert.equal(left.path, `/memory-newer/${ACCOUNT}/${MEM}/sales.md`);
    assert.equal(diff[2], uri);
    assert.equal(dec.decode(await provider.readFile(left)), 'v5 from Abe');
    assert.equal(provider.stat(left).permissions, vscodeStub.FilePermission.Readonly);
    await assert.rejects(provider.writeFile(left, enc.encode('x')), /newer text from Hiveku/);

    // The person merged in the tab and saves again: version 5 is now what they saw.
    await provider.writeFile(uri, enc.encode('mine + theirs'));
    assert.equal(calls.warnings.length, 1, 'no second dialog');
    assert.equal(writes(client)[0].args.expected_version, 5);
  });

  test('a 409 version_conflict mid-save gets the same dialog and retries on the newer version', async () => {
    let attempt = 0;
    const { client, provider, uri } = setup({
      answers: {
        memory_get: versions({ version: 3, content: 'v3' }),
        memory_log_list: { data: [logLine({ version_after: 4, author: { label: 'Sales agent', kind: 'agent' } })] },
        memory_update: () => {
          attempt++;
          if (attempt === 1) throw conflictError('v4 from the agent', 4);
          return { data: { version: 5 } };
        },
      },
      warn: ['Save anyway'],
    });
    await provider.readFile(uri);
    await provider.writeFile(uri, enc.encode('mine'));
    assert.deepEqual(writes(client).map((w) => w.args.expected_version), [3, 4]);
    assert.match(calls.warnings[0][0], /was changed on Hiveku while you were saving/);
    assert.match(calls.warnings[0][0], /by Sales agent/);
  });

  test('negative control: any other save failure is still a failure', async () => {
    const { provider, uri } = setup({
      answers: {
        memory_get: versions({ version: 3, content: 'v3' }),
        memory_update: new Error('Tool memory_update failed (500): boom'),
      },
    });
    await provider.readFile(uri);
    await assert.rejects(provider.writeFile(uri, enc.encode('mine')));
    assert.equal(calls.warnings.length, 0);
    assert.match(calls.errors[0][0], /Hiveku save failed: .*boom/);
  });

  test('when the log is not available yet, the dialog falls back to the versions', async () => {
    const { provider, uri } = setup({
      answers: {
        memory_get: versions({ version: 3, content: 'v3' }, { version: 5, content: 'v5' }),
        memory_log_list: new Error('Unknown tool: memory_log_list'),
      },
      warn: [undefined],
    });
    await provider.readFile(uri);
    await assert.rejects(provider.writeFile(uri, enc.encode('mine')));
    assert.match(calls.warnings[0][0], /You opened version 3; Hiveku now has version 5\./);
  });

  test('with auto save on, the reason is asked once per open document', async () => {
    config.set('autoSave', 'afterDelay');
    const { client, provider, uri } = setup({
      answers: { memory_get: versions({ version: 3, content: 'v3' }), memory_update: { data: { version: 3 } } },
      input: ['Tidied the pricing section'],
    });
    await provider.readFile(uri);
    await provider.writeFile(uri, enc.encode('a'));
    await provider.writeFile(uri, enc.encode('ab'));
    assert.equal(calls.inputs.length, 1);
    assert.deepEqual(writes(client).map((w) => w.args.reason), ['Tidied the pricing section', 'Tidied the pricing section']);
  });

  test('with auto save on, closing the tab forgets the reason: reopening asks again', async () => {
    config.set('autoSave', 'afterDelay');
    const { client, provider, uri } = setup({
      answers: { memory_get: versions({ version: 3, content: 'v3' }), memory_update: { data: { version: 3 } } },
      input: ['Tidied the pricing section', 'Added the Leeds showroom'],
    });
    await provider.readFile(uri);
    await provider.writeFile(uri, enc.encode('a'));
    provider.forget(uri); // the tab closed
    await provider.readFile(uri);
    await provider.writeFile(uri, enc.encode('ab'));
    assert.equal(calls.inputs.length, 2);
    assert.equal(calls.inputs[1][0].value, '', 'the old reason is not pre-filled either');
    assert.deepEqual(writes(client).map((w) => w.args.reason), ['Tidied the pricing section', 'Added the Leeds showroom']);
  });

  test('closing a hiveku document tells the provider to forget it; other schemes do not', async () => {
    const closers = [];
    vscodeStub.workspace.onDidCloseTextDocument = (fn) => { closers.push(fn); return { dispose() {} }; };
    let provider;
    vscodeStub.workspace.registerFileSystemProvider = (_scheme, p) => { provider = p; return { dispose() {} }; };
    const context = { subscriptions: [] };
    platformFs.registerHivekuFs(context, async () => fakeClient({}), () => 'https://app.example.test');
    assert.equal(closers.length, 1);
    const forgotten = [];
    provider.forget = (u) => forgotten.push(u.toString());
    const uri = platformFs.memoryUri(ACCOUNT, MEM, 'sales');
    closers[0]({ uri });
    closers[0]({ uri: vscodeStub.Uri.parse('file:/tmp/notes.md') });
    assert.deepEqual(forgotten, [uri.toString()]);
  });

  test('a deleted entry is a plain failure that says so', async () => {
    const { provider, uri } = setup({ answers: { memory_get: { data: null } } });
    await assert.rejects(provider.writeFile(uri, enc.encode('mine')));
    assert.match(calls.errors[0][0], /no longer exists on Hiveku/);
  });
});
