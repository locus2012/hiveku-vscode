// The account store's side of offboarding O8a (src/accounts.ts): who hears a
// refused key, and what forgetting a removed account takes away. The store runs
// on an in-memory stand-in for VS Code's globalState and SecretStorage; the MCP
// server is a stub on 127.0.0.1. Every key is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadOut } from './helpers/load.mjs';
import { coreAuthRefusal, REVOKED_KEY_MESSAGE, startStub, rejection } from './helpers/core-stub.mjs';

const { AccountStore } = loadOut('accounts');

const A = '7f6bb2cf-a04e-4efa-afd0-db6dd3aafd79';
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
