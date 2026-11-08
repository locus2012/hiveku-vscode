// The account store's side of offboarding O8a (src/accounts.ts): who hears a
// refused key, and what forgetting a removed account takes away. The store runs
// on an in-memory stand-in for VS Code's globalState and SecretStorage; the MCP
// server is a stub on 127.0.0.1. Every key is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { loadOut } from './helpers/load.mjs';
import { coreAuthRefusal, REVOKED_KEY_MESSAGE, startStub, rejection } from './helpers/core-stub.mjs';

const { AccountStore } = loadOut('accounts');

const A = 'a0a0a0a0-0b0b-4c0c-8d0d-0e0e0e0e0e0e';
const B = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const madeUpKey = () => `hvk_${randomBytes(32).toString('hex')}`;

function fakeContext() {
  const state = new Map();
  const secrets = new Map();
  return {
    state,
    secrets,
    globalState: {
      get: (k, d) => (state.has(k) ? structuredClone(state.get(k)) : d),
      update: async (k, v) => { if (v === undefined) state.delete(k); else state.set(k, structuredClone(v)); },
    },
    secrets: {
      get: async (k) => secrets.get(k),
      store: async (k, v) => { secrets.set(k, v); },
      delete: async (k) => { secrets.delete(k); },
    },
  };
}

const refuseEveryCall = (rpc) => (rpc?.method === 'tools/call' ? coreAuthRefusal(401, rpc.id, REVOKED_KEY_MESSAGE) : undefined);

test("a stored account's refused key is heard, with that account and the key the client held", async (t) => {
  const stub = await startStub(refuseEveryCall);
  t.after(() => stub.close());
  const ctx = fakeContext();
  const store = new AccountStore(ctx);
  const key = madeUpKey();
  await store.addAccount(A, 'Northwind', key);
  const heard = [];
  store.setKeyRefusedListener((accountId, k) => heard.push([accountId, k]));
  const client = await store.getClient(A, stub.base);
  await rejection(client.callTool('get_account_info', {}));
  assert.deepEqual(heard, [[A, key]]);
});

test('a pasted key being checked at sign-in is never heard', async (t) => {
  const stub = await startStub(refuseEveryCall);
  t.after(() => stub.close());
  const store = new AccountStore(fakeContext());
  const heard = [];
  store.setKeyRefusedListener((accountId) => heard.push(accountId));
  await rejection(store.signIn(madeUpKey(), stub.base));
  assert.deepEqual(heard, []);
});

test("forgetting a removed account takes its key, its rows and its maps, and nothing of another account's", async () => {
  const ctx = fakeContext();
  const store = new AccountStore(ctx);
  const keyA = madeUpKey();
  const keyB = madeUpKey();
  await store.addAccount(A, 'Northwind', keyA, 'sam@example.com');
  await store.addAccount(B, 'Acme', keyB);
  await store.setFolder(A, '/made/up/northwind');
  await store.setFolder(B, '/made/up/acme');
  await store.setDepartments(A, ['seo']);
  await store.setRole(A, 'owner');
  await store.setRole(B, 'owner');
  await store.archive(A);
  assert.deepEqual(store.allRecords().map((r) => r.accountId).sort(), [A, B].sort());

  await store.forgetRemovedAccount(A);
  assert.equal(await store.getKey(A), undefined);
  assert.equal(store.allRecords().some((r) => r.accountId === A), false);
  assert.equal(store.listArchived().some((r) => r.accountId === A), false);
  assert.equal(store.getFolder(A), undefined);
  assert.deepEqual(store.getDepartments(A), []);
  assert.equal(store.getRole(A), undefined);
  // The other account is untouched.
  assert.equal(await store.getKey(B), keyB);
  assert.deepEqual(store.list().map((r) => r.accountId), [B]);
  assert.equal(store.getFolder(B), '/made/up/acme');
  assert.equal(store.getRole(B), 'owner');
});

/* ── which keys Connect Hiveku handed over (O8a review) ─────────────────── */
// Only such a key's refusal may remove an account from this computer: the website
// answers about whoever made a key, and a pasted key may be a teammate's.

const accountInfo = (rpc) => {
  if (rpc?.method !== 'tools/call') return undefined;
  const text = JSON.stringify({ data: { account_id: A, name: 'Northwind' } });
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text }] } }) };
};

test("only the key Connect Hiveku handed over counts as Connect's, and only for its account", async () => {
  const ctx = fakeContext();
  const store = new AccountStore(ctx);
  const keyA = madeUpKey();
  const keyB = madeUpKey();
  await store.addAccounts([{ accountId: A, label: 'Northwind', key: keyA, via: 'connect' }, { accountId: B, label: 'Acme', key: keyB }], 'sam@example.com', []);
  assert.equal(store.keyCameFromConnect(A, keyA), true);
  assert.equal(store.keyCameFromConnect(A, ` ${keyA}\n`), true, 'as stored, trimmed');
  assert.equal(store.keyCameFromConnect(A, madeUpKey()), false, 'another key');
  assert.equal(store.keyCameFromConnect(B, keyA), false, "another account's");
  assert.equal(store.keyCameFromConnect(B, keyB), false, 'an entry that does not say via connect');
  for (const nothing of ['', undefined, null]) assert.equal(store.keyCameFromConnect(A, nothing), false);

  const one = new AccountStore(fakeContext());
  const k = madeUpKey();
  await one.addAccount(A, 'Northwind', k, 'sam@example.com');
  assert.equal(one.keyCameFromConnect(A, k), false, 'addAccount without via');
  await one.addAccount(A, 'Northwind', k, 'sam@example.com', 'connect');
  assert.equal(one.keyCameFromConnect(A, k), true, "addAccount with via 'connect'");
});

test("a key pasted with \"Sign in with a key\" never counts as Connect's, even over an account Connect connected", async (t) => {
  const stub = await startStub(accountInfo);
  t.after(() => stub.close());
  const store = new AccountStore(fakeContext());
  const pastedFirst = madeUpKey();
  await store.signIn(pastedFirst, stub.base);
  assert.equal(await store.getKey(A), pastedFirst);
  assert.equal(store.keyCameFromConnect(A, pastedFirst), false);

  const fromConnect = madeUpKey();
  await store.addAccounts([{ accountId: A, label: 'Northwind', key: fromConnect, via: 'connect' }], 'sam@example.com', []);
  assert.equal(store.keyCameFromConnect(A, fromConnect), true);

  const pastedLater = madeUpKey();
  await store.signIn(pastedLater, stub.base);
  assert.equal(await store.getKey(A), pastedLater);
  assert.equal(store.keyCameFromConnect(A, pastedLater), false);
});

test('the store keeps a hash of a Connect key, never the key, and forgets it with the account', async () => {
  const ctx = fakeContext();
  const store = new AccountStore(ctx);
  const keyA = madeUpKey();
  const keyB = madeUpKey();
  await store.addAccounts([{ accountId: A, label: 'Northwind', key: keyA, via: 'connect' }, { accountId: B, label: 'Acme', key: keyB, via: 'connect' }], 'sam@example.com', []);
  const everything = JSON.stringify(ctx.globalState.get('hiveku.accounts.connectKeys', {}));
  for (const key of [keyA, keyB]) {
    assert.equal(everything.includes(key), false);
    assert.equal(everything.includes(key.slice(4, 20)), false);
    assert.equal(everything.includes(createHash('sha256').update(key).digest('hex')), false, "not the website's plain hash either");
  }
  await store.forgetRemovedAccount(A);
  assert.equal(store.keyCameFromConnect(A, keyA), false);
  assert.equal(store.keyCameFromConnect(B, keyB), true, "the other account's stays");
});
