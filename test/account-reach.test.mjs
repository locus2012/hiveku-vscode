/**
 * HK-886: an account whose reads all fail shows as unreachable, with the
 * reason, in the attention dialog and the account console's banner.
 *
 * scanAccounts (extension.ts) read four things per account with
 * Promise.allSettled, so a failed read never threw and an account whose every
 * read failed looked quiet; accountEntitlements (hivekuApi.ts) caught its own
 * error, so the console banner never saw it. Pinned on real errors from the
 * local stub (test/helpers/core-stub.mjs): the web edge's block page with its
 * ray id, an answer cut off before it could be read, Hiveku's own JSON 401 and
 * 403, a missing key, and a time-out. No request reaches a live host.
 *   1. readFailure: the kind and a short reason that keeps the status and ray id.
 *   2. unreachableFromReads: the scan's four reads, with the client the scan uses.
 *   3. The attention dialog's row, its warning and buttons, and the badge count.
 *   4. accountEntitlements throws a read that never came back, and still falls
 *      back on Hiveku's own "no such tool"; the console banner says the reason.
 *   5. extension.ts and console.ts use them.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOut } from './helpers/load.mjs';
import { BLOCK_PAGE, OTHER_ACCOUNT_MESSAGE, RAY, REVOKED_KEY_MESSAGE, coreAuthRefusal, cutOff, rejection, startStub } from './helpers/core-stub.mjs';

const mc = loadOut('mcpClient');
const reach = loadOut('accountReach');
const api = loadOut('hivekuApi');
const { deadKeyBanner } = loadOut('console');

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (name) => fs.readFileSync(path.join(here, '..', 'src', name), 'utf8');
const EM_DASH = String.fromCharCode(0x2014);
const clientFor = (stub) => new mc.HivekuMcpClient({ baseUrl: stub.base, apiKey: 'hvk_test_placeholder' });

/** The error one tool call ends with when the stub answers it with `reply`. */
async function errorFrom(reply) {
  const stub = await startStub((rpc) => (rpc?.method === 'tools/call' ? reply(rpc) : undefined));
  try {
    return await rejection(clientFor(stub).callTool('get_account_info', {}));
  } finally {
    await stub.close();
  }
}

/** The four reads scanAccounts makes, with the client it uses, settled as it settles them. */
async function scanReads(reply) {
  const stub = await startStub((rpc) => (rpc?.method === 'tools/call' ? reply(rpc) : undefined));
  try {
    const client = clientFor(stub);
    return await Promise.allSettled([
      api.sitesList(client),
      api.pmTasksList(client),
      api.workflowRunsRecent(client),
      client.callToolJson('get_account_info', {}),
    ]);
  } finally {
    await stub.close();
  }
}

const keyRefusal = (rpc) => coreAuthRefusal(401, rpc.id, REVOKED_KEY_MESSAGE);
const otherAccount = (rpc) => coreAuthRefusal(403, rpc.id, OTHER_ACCOUNT_MESSAGE);
const timedOut = new Error('MCP request timed out after 135s (tools/call)');

/* ── 1. why one read failed ─────────────────────────────────────────────── */

describe('readFailure', () => {
  test("the web edge's refusal: edge, with its status and ray id, and the edge's own words", async () => {
    const err = await errorFrom(() => BLOCK_PAGE);
    const failure = reach.readFailure(err);
    assert.equal(failure.kind, 'edge');
    assert.equal(failure.reason, `the web edge in front of Hiveku refused its reads (HTTP 403, ray id ${RAY})`);
    assert.equal(failure.words, mc.coreEdgeRefusalMessage(403, RAY));
    // Read from the text alone (an error rethrown with the message inside it), the same.
    assert.deepEqual(reach.readFailure(new Error(err.message)), { ...failure, words: err.message });
  });

  test('an answer that could not be read: unreadable, never the key', async () => {
    const failure = reach.readFailure(await errorFrom(() => cutOff(401)));
    assert.equal(failure.kind, 'unreadable');
    assert.equal(failure.reason, 'the answers to its reads could not be read (HTTP 401)');
  });

  test("Hiveku's own JSON 401 and 403, and a missing key: the key", async () => {
    assert.deepEqual(
      [reach.readFailure(await errorFrom(keyRefusal)).reason, reach.readFailure(await errorFrom(otherAccount)).reason],
      ['Hiveku refused its key (HTTP 401)', 'Hiveku refused its key (HTTP 403)'],
    );
    const missing = reach.readFailure(new Error('No stored key for account 3f2504e0. Run "Hiveku: Sign In".'));
    assert.deepEqual([missing.kind, missing.reason], ['key', 'no key is stored for it']);
  });

  test('anything else: other, in its own words', () => {
    assert.deepEqual(reach.readFailure(timedOut), { kind: 'other', reason: timedOut.message, words: timedOut.message });
  });
});

/* ── 2. the scan's four reads ───────────────────────────────────────────── */

describe('unreachableFromReads, on the reads scanAccounts makes', () => {
  test('the web edge refuses every read: unreachable, with the ray id', async () => {
    const results = await scanReads(() => BLOCK_PAGE);
    assert.equal(results.length, 4);
    assert.ok(results.every((r) => r.status === 'rejected'));
    const failure = reach.unreachableFromReads(results);
    assert.equal(failure.kind, 'edge');
    assert.match(failure.reason, new RegExp(`ray id ${RAY}`));
  });

  test('Hiveku refuses the key on one read beside edge refusals: the key decides', async () => {
    const results = await scanReads((rpc) => (rpc.params.name === 'pm_tasks_list' ? keyRefusal(rpc) : BLOCK_PAGE));
    assert.equal(reach.unreachableFromReads(results).kind, 'key');
  });

  test('one read comes back: the account was read, not unreachable', async () => {
    const results = await scanReads((rpc) => (rpc.params.name === 'get_account_info' ? undefined : BLOCK_PAGE));
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(reach.unreachableFromReads(results), null);
  });

  test('every read times out: unreachable, in the error own words; no reads at all: nothing to say', () => {
    const results = [1, 2, 3, 4].map(() => ({ status: 'rejected', reason: timedOut }));
    assert.equal(reach.unreachableFromReads(results).kind, 'other');
    assert.equal(reach.unreachableFromReads([]), null);
  });
});

/* ── 3. the attention dialog ────────────────────────────────────────────── */

describe('the attention dialog', () => {
  test("an edge refusal's row and warning: the ray id, and no Reconnect", async () => {
    const failure = reach.readFailure(await errorFrom(() => BLOCK_PAGE));
    const row = reach.unreachableRow('Acme', failure);
    assert.equal(row.label, '$(warning) Acme could not be read');
    // It never reached Hiveku: Hiveku did not refuse the key, but nothing checked that the key is fine either.
    assert.equal(row.detail, `The web edge in front of Hiveku refused its reads (HTTP 403, ray id ${RAY}). Not checked. Hiveku did not refuse its key: pick it to see what to do.`);
    assert.ok(!/key is fine/.test(row.detail), row.detail);
    assert.equal(row.line, `$(warning) Acme could not be read: the web edge in front of Hiveku refused its reads (HTTP 403, ray id ${RAY})`);
    const warning = reach.unreachableWarning('Acme', failure);
    assert.deepEqual(warning.actions, ['Open anyway']);
    assert.equal(warning.message, `Acme could not be read. ${mc.coreEdgeRefusalMessage(403, RAY)}`);
    for (const words of [row.label, row.detail, row.line, warning.message]) assert.ok(!words.includes(EM_DASH), words);
  });

  test('an answer that could not be read: says nothing of the key, since who refused it is not known; no Reconnect', async () => {
    const failure = reach.readFailure(await errorFrom(() => cutOff(403)));
    const row = reach.unreachableRow('Acme', failure);
    assert.equal(row.detail, 'The answers to its reads could not be read (HTTP 403). Not checked: pick it to see what to do.');
    assert.ok(!/key/i.test(row.detail), row.detail);
    const warning = reach.unreachableWarning('Acme', failure);
    assert.deepEqual(warning.actions, ['Open anyway']);
    assert.equal(warning.message, `Acme could not be read. ${mc.coreRefusalUnreadMessage(403)}`);
  });

  test("a key Hiveku refused: Reconnect, with the key's words", async () => {
    const failure = reach.readFailure(await errorFrom(keyRefusal));
    assert.equal(reach.unreachableRow('Acme', failure).detail, 'Hiveku refused its key (HTTP 401). Not checked: pick it to reconnect.');
    const warning = reach.unreachableWarning('Acme', failure);
    assert.deepEqual(warning.actions, ['Reconnect', 'Open anyway']);
    assert.match(warning.message, /^Acme could not be read: Hiveku refused its key \(HTTP 401\)\. Reconnect to mint a fresh key\./);
  });

  test('anything else keeps the old offer, with its reason', () => {
    const warning = reach.unreachableWarning('Acme', reach.readFailure(timedOut));
    assert.deepEqual(warning.actions, ['Reconnect', 'Open anyway']);
    assert.equal(warning.message, `Acme could not be read: ${timedOut.message}. Its key may have been revoked or the network failed.`);
  });

  test("the badge counts an unreachable account once, never its status or ray id's digits", async () => {
    const edge = reach.unreachableRow('Acme', reach.readFailure(await errorFrom(() => BLOCK_PAGE))).line;
    assert.equal(reach.attentionBadgeCount([edge, 'Beta: 3 overdue task(s)', 'Beta: 2 failed workflow run(s)']), 6);
    assert.equal(reach.attentionBadgeCount([]), 0);
  });
});

/* ── 4. the console banner and accountEntitlements ──────────────────────── */

describe('the account console', () => {
  async function entitlementsWith(reply) {
    const stub = await startStub((rpc) => (rpc?.method === 'tools/call' ? reply(rpc) : undefined));
    try {
      return await api.accountEntitlements(clientFor(stub)).then((value) => ({ value }), (error) => ({ error }));
    } finally {
      await stub.close();
    }
  }

  test("accountEntitlements throws a read that never came back, so the banner says why (the ray id)", async () => {
    const { error } = await entitlementsWith(() => BLOCK_PAGE);
    assert.ok(error instanceof mc.McpEdgeRefusalError, String(error));
    assert.equal(reach.readFailureBanner(error), `This account could not be read. ${mc.coreEdgeRefusalMessage(403, RAY)}`);
    // The old banner said nothing for it.
    assert.equal(deadKeyBanner(error), null);
  });

  test("a key Hiveku refused: thrown, and the banner says to reconnect", async () => {
    const { error } = await entitlementsWith(keyRefusal);
    assert.match(error.message, /^MCP HTTP 401: /);
    assert.equal(reach.readFailureBanner(error), `This account's key looks dead (${error.message.slice(0, 120)}). Run "Hiveku: Connect Hiveku" to mint a fresh one.`);
  });

  test('an answer that could not be read: thrown, and the banner says so, never the key', async () => {
    const { error } = await entitlementsWith(() => cutOff(401));
    assert.match(reach.readFailureBanner(error), /^This account could not be read\. The answer to this request \(HTTP 401\) could not be read/);
  });

  test("Hiveku's own answer that it has no such tool still falls back to showing everything", async () => {
    const toolError = await entitlementsWith((rpc) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { isError: true, content: [{ type: 'text', text: 'Unknown tool: account_entitlements' }] } }),
    }));
    assert.deepEqual(toolError, { value: undefined });
    const rpcError = await entitlementsWith((rpc) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'Unknown tool: account_entitlements' } }),
    }));
    assert.deepEqual(rpcError, { value: undefined });
  });

  test('entitlements that come back: as before', async () => {
    const { value } = await entitlementsWith((rpc) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: rpc.id,
        result: { content: [{ type: 'text', text: JSON.stringify({ data: { plan: 'pro', page_access: { crm: true }, entitled_features: ['crm'] } }) }] },
      }),
    }));
    assert.deepEqual(value, { plan: 'pro', page_access: { crm: true }, entitled_features: ['crm'] });
  });

  test('a time-out gets no banner, as before', () => {
    assert.equal(reach.readFailureBanner(timedOut), null);
  });
});

/* ── 5. where they are used ─────────────────────────────────────────────── */

describe('extension.ts and console.ts read them', () => {
  test('scanAccounts marks an account whose four reads failed unreachable, before its snapshot is touched', () => {
    const ext = src('extension.ts');
    const scan = ext.slice(ext.indexOf('async function scanAccounts('), ext.indexOf('interface AttentionItem'));
    assert.match(scan, /const notRead = unreachableFromReads\(\[projectsR, tasksR, runsR, infoR\]\);\s*if \(notRead\) \{[\s\S]*?continue;/);
    assert.ok(scan.indexOf('unreachableFromReads(') < scan.indexOf('accountSnapshots.set('));
    assert.match(scan, /unreachableRow\(u\.label, u\.failure\)/);
    const attention = ext.slice(ext.indexOf('async function attention('), ext.indexOf('async function newTask('));
    assert.match(attention, /unreachableWarning\(record\.label, pick\.item\.failure\)/);
    assert.match(ext, /const count = attentionBadgeCount\(lines\);/);
  });

  test("the console's banner reads the entitlements error", () => {
    assert.match(src('console.ts'), /const banner = readFailureBanner\(err\) \?\? deadKeyBanner\(err\);/);
  });
});
