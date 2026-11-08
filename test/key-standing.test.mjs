// Why a refused key stopped working, and when that removes an account
// (offboarding O8a, src/keyStanding.ts, src/mcpClient.ts). Every server here
// listens on 127.0.0.1 only: no request reaches a Hiveku host, and every key is
// made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { loadOut } from './helpers/load.mjs';
import { coreAuthRefusal, REVOKED_KEY_MESSAGE, BLOCK_PAGE, startStub, rejection } from './helpers/core-stub.mjs';

const ks = loadOut('keyStanding');
const { HivekuMcpClient } = loadOut('mcpClient');

const A = '7f6bb2cf-a04e-4efa-afd0-db6dd3aafd79';
const madeUpKey = () => `hvk_${randomBytes(32).toString('hex')}`;

/* ── a stand-in for the website's route ─────────────────────────────────── */

async function startRoute(answer) {
  const seen = [];
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
    seen.push(request);
    const reply = answer(request, seen.length);
    if (typeof reply === 'function') return reply(res);
    res.writeHead(reply.status, reply.headers ?? { 'content-type': 'application/json' });
    res.end(reply.body ?? '');
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    appUrl: `http://127.0.0.1:${server.address().port}`,
    seen,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('askKeyStanding reads each of the four answers, and sends the key only as the bearer', async (t) => {
  for (const standing of ks.KEY_STANDINGS) {
    const route = await startRoute(() => json(200, { standing }));
    t.after(() => route.close());
    const key = madeUpKey();
    assert.deepEqual(await ks.askKeyStanding({ appUrl: route.appUrl, key, accountId: A }), { kind: 'answer', standing });
    const [req] = route.seen;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/account/mcp-keys/standing');
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    assert.deepEqual(JSON.parse(req.body), { account_id: A });
    assert.equal(req.url.includes(key) || req.body.includes(key), false);
  }
});

test('askKeyStanding: anything but exactly one of the four answers is no answer', async (t) => {
  const cases = [
    ['an HTML page', { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><title>Sign in</title></html>' }, 'unreadable'],
    ['an unknown answer', json(200, { standing: 'remove' }), 'unreadable'],
    ['an answer with more in it', json(200, { standing: 'removed_from_team', account: A }), 'unreadable'],
    ['a list', json(200, [{ standing: 'removed_from_team' }]), 'unreadable'],
    ['an empty body', { status: 200, body: '' }, 'unreadable'],
    ['a body far too large', json(200, { standing: 'removed_from_team', pad: 'x'.repeat(8000) }), 'unreadable'],
    ['500', json(500, { error: 'boom' }), 'unavailable'],
    ['502', { status: 502, headers: { 'content-type': 'text/html' }, body: 'Bad gateway' }, 'unavailable'],
    ['503', json(503, { error: 'unavailable' }), 'unavailable'],
    ['401', json(401, { error: 'nope' }), 'refused'],
    ['400', json(400, { error: 'invalid_request' }), 'refused'],
    ['404', json(404, { error: 'not found' }), 'refused'],
    ['a redirect, never followed', { status: 302, headers: { location: '/api/account/mcp-keys/standing-elsewhere' }, body: '' }, 'refused'],
  ];
  for (const [name, reply, why] of cases) {
    const route = await startRoute((req) => (req.url.endsWith('-elsewhere') ? json(200, { standing: 'removed_from_team' }) : reply));
    t.after(() => route.close());
    const got = await ks.askKeyStanding({ appUrl: route.appUrl, key: madeUpKey(), accountId: A });
    assert.deepEqual(got, { kind: 'no_answer', why }, name);
    assert.equal(route.seen.length, 1, `${name}: asked once, nothing followed`);
  }
});

test('askKeyStanding: a 429 carries its Retry-After; a hung answer is a timeout; a closed port is a network failure', async (t) => {
  const busy = await startRoute(() => json(429, { error: 'too_many_requests' }, { 'retry-after': '120' }));
  t.after(() => busy.close());
  assert.deepEqual(await ks.askKeyStanding({ appUrl: busy.appUrl, key: madeUpKey(), accountId: A }), { kind: 'no_answer', why: 'busy', retryAfterSeconds: 120 });

  const hung = await startRoute(() => () => {});
  t.after(() => hung.close());
  assert.deepEqual(await ks.askKeyStanding({ appUrl: hung.appUrl, key: madeUpKey(), accountId: A, timeoutMs: 150 }), { kind: 'no_answer', why: 'timeout' });

  const halfway = await startRoute(() => (res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"standing":');
  });
  t.after(() => halfway.close());
  assert.deepEqual(await ks.askKeyStanding({ appUrl: halfway.appUrl, key: madeUpKey(), accountId: A, timeoutMs: 150 }), { kind: 'no_answer', why: 'timeout' });

  const gone = await startRoute(() => json(200, { standing: 'removed_from_team' }));
  const appUrl = gone.appUrl;
  await gone.close();
  assert.deepEqual(await ks.askKeyStanding({ appUrl, key: madeUpKey(), accountId: A }), { kind: 'no_answer', why: 'network' });
});

/* ── the client tells the store about Hiveku's own refusals only ────────── */

test("the client's listener hears Hiveku's own 401, and never the edge's page, a 403 or a working call", async (t) => {
  const cases = [
    ['Hiveku refuses the key', (rpc) => (rpc?.method === 'tools/call' ? coreAuthRefusal(401, rpc.id, REVOKED_KEY_MESSAGE) : undefined), 1],
    ["the edge's page on 401", (rpc) => (rpc?.method === 'tools/call' ? { ...BLOCK_PAGE, status: 401 } : undefined), 0],
    ['a key used for another account (403)', (rpc) => (rpc?.method === 'tools/call' ? coreAuthRefusal(403, rpc.id, 'API key does not belong to the specified account') : undefined), 0],
    ['a working call', () => undefined, 0],
  ];
  for (const [name, answer, expected] of cases) {
    const stub = await startStub(answer);
    t.after(() => stub.close());
    let heard = 0;
    const client = new HivekuMcpClient({ baseUrl: stub.base, apiKey: madeUpKey(), onKeyRefused: () => { heard += 1; } });
    if (expected > 0) await rejection(client.callTool('get_account_info', {}));
    else await client.callTool('get_account_info', {}).catch(() => undefined);
    assert.equal(heard, expected, name);
  }
});

test('a listener that throws never changes what the call reports', async (t) => {
  const stub = await startStub((rpc) => (rpc?.method === 'tools/call' ? coreAuthRefusal(401, rpc.id, REVOKED_KEY_MESSAGE) : undefined));
  t.after(() => stub.close());
  const client = new HivekuMcpClient({ baseUrl: stub.base, apiKey: madeUpKey(), onKeyRefused: () => { throw new Error('listener broke'); } });
  const err = await rejection(client.callTool('get_account_info', {}));
  assert.match(String(err.message), /^MCP HTTP 401:/);
});

/* ── the watcher: two sightings, minutes apart ──────────────────────────── */

function fakeClock() {
  let now = Date.parse('2026-11-08T12:00:00Z');
  const timers = [];
  return {
    now: () => now,
    schedule: (fn, ms) => {
      const timer = { at: now + ms, fn, cancelled: false };
      timers.push(timer);
      return { cancel: () => { timer.cancelled = true; } };
    },
    /** Move the clock on, running each timer that comes due. */
    async advance(ms, watcher) {
      const until = now + ms;
      for (;;) {
        const due = timers.filter((x) => !x.cancelled && !x.ran && x.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        due.ran = true;
        due.fn();
        await watcher.settled();
      }
      now = until;
    },
    pending: () => timers.filter((x) => !x.cancelled && !x.ran),
  };
}

/** A watcher whose website answers from `answers` in turn (the last one repeats). */
function makeWatcher(answers, opts = {}) {
  const clock = fakeClock();
  const key = opts.key ?? madeUpKey();
  const stored = { key };
  const asked = [];
  const removed = [];
  const logs = [];
  const watcher = new ks.KeyRefusalWatcher({
    appUrl: () => 'http://127.0.0.1:9',
    storedKey: async () => stored.key,
    ask: async (q) => {
      asked.push(q);
      const a = answers[Math.min(asked.length - 1, answers.length - 1)];
      if (a instanceof Error) throw a;
      return typeof a === 'string' ? { kind: 'answer', standing: a } : a;
    },
    remove: async (accountId, reason) => { removed.push({ accountId, reason }); },
    log: (line) => logs.push(line),
    now: clock.now,
    schedule: clock.schedule,
  });
  return { watcher, clock, key, stored, asked, removed, logs };
}

test('one removal answer removes nothing; the second, two minutes later, removes the account once', async () => {
  const w = makeWatcher(['removed_from_team', 'removed_from_team']);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  assert.equal(w.asked.length, 1);
  assert.deepEqual(w.removed, []);
  assert.equal(w.clock.pending().length, 1);
  assert.ok(w.clock.pending()[0].at - w.clock.now() >= 2 * 60 * 1000);
  await w.clock.advance(ks.CONFIRM_AFTER_MS, w.watcher);
  assert.equal(w.asked.length, 2);
  assert.deepEqual(w.removed, [{ accountId: A, reason: 'removed_from_team' }]);
  // Nothing more is asked or removed after that.
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  assert.equal(w.asked.length, 2);
  assert.equal(w.removed.length, 1);
});

test('account_closed twice is a removal too, with that reason', async () => {
  const w = makeWatcher(['account_closed']);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  await w.clock.advance(ks.CONFIRM_AFTER_MS, w.watcher);
  assert.deepEqual(w.removed, [{ accountId: A, reason: 'account_closed' }]);
});

test('a removal answer followed by anything that removes nothing removes nothing', async () => {
  for (const second of ['key_switched_off', 'active']) {
    const w = makeWatcher(['removed_from_team', second, 'removed_from_team']);
    w.watcher.onRefused(A, w.key);
    await w.watcher.settled();
    await w.clock.advance(ks.CONFIRM_AFTER_MS, w.watcher);
    assert.deepEqual(w.removed, [], second);
    // The sighting is gone: the next removal answer starts again from one.
    await w.clock.advance(ks.QUIET_AFTER_SWITCHED_OFF_MS, w.watcher);
    w.watcher.onRefused(A, w.key);
    await w.watcher.settled();
    assert.deepEqual(w.removed, [], `${second}: a new first sighting only`);
  }
});

test('an error, a timeout, a 5xx, a 429 or an unreadable answer never removes anything, however often', async () => {
  const noAnswers = [
    new Error('socket hang up'),
    { kind: 'no_answer', why: 'timeout' },
    { kind: 'no_answer', why: 'unavailable' },
    { kind: 'no_answer', why: 'busy', retryAfterSeconds: 60 },
    { kind: 'no_answer', why: 'unreadable' },
    { kind: 'no_answer', why: 'refused' },
    { kind: 'no_answer', why: 'network' },
  ];
  for (const a of noAnswers) {
    const w = makeWatcher([a]);
    for (let i = 0; i < 12; i++) {
      w.watcher.onRefused(A, w.key);
      await w.watcher.settled();
      await w.clock.advance(ks.QUIET_AFTER_NO_ANSWER_MS + 1000, w.watcher);
    }
    assert.ok(w.asked.length >= 6, 'it keeps asking now and then');
    assert.deepEqual(w.removed, [], JSON.stringify(a));
  }
});

test('two definite removal answers minutes apart remove, even with no answer between them', async () => {
  const w = makeWatcher(['removed_from_team', { kind: 'no_answer', why: 'unavailable' }, 'removed_from_team']);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  await w.clock.advance(ks.CONFIRM_AFTER_MS, w.watcher); // the confirming question gets no answer
  assert.deepEqual(w.removed, []);
  await w.clock.advance(ks.QUIET_AFTER_NO_ANSWER_MS, w.watcher);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  assert.deepEqual(w.removed, [{ accountId: A, reason: 'removed_from_team' }]);
});

test('a first sighting older than 30 minutes is forgotten: the next answer is a first sighting again', async () => {
  const w = makeWatcher(['removed_from_team', { kind: 'no_answer', why: 'unavailable' }, { kind: 'no_answer', why: 'unavailable' }, 'removed_from_team']);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  await w.clock.advance(ks.CONFIRM_AFTER_MS, w.watcher);
  await w.clock.advance(ks.QUIET_AFTER_NO_ANSWER_MS, w.watcher);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  await w.clock.advance(ks.SIGHTING_TTL_MS, w.watcher);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  assert.deepEqual(w.removed, []);
  assert.equal(w.clock.pending().length, 1, 'a new confirming question is set');
});

test('the key changed between the two sightings (a reconnect): nothing is removed', async () => {
  const w = makeWatcher(['removed_from_team', 'removed_from_team']);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  w.stored.key = madeUpKey();
  await w.clock.advance(ks.CONFIRM_AFTER_MS, w.watcher);
  assert.deepEqual(w.removed, []);
  assert.equal(w.asked.length, 1, 'the new key is not asked about on the old sighting');

  // The key changed during the second question itself.
  const v = makeWatcher(['removed_from_team', 'removed_from_team']);
  v.watcher.onRefused(A, v.key);
  await v.watcher.settled();
  const ask = v.watcher.deps.ask;
  v.watcher.deps.ask = async (q) => {
    v.stored.key = madeUpKey();
    return ask(q);
  };
  await v.clock.advance(ks.CONFIRM_AFTER_MS, v.watcher);
  assert.deepEqual(v.removed, []);
});

test('two removal answers about two different keys are not two sightings', async () => {
  const w = makeWatcher(['removed_from_team', 'removed_from_team']);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  const other = madeUpKey();
  w.stored.key = other;
  await w.clock.advance(ks.CONFIRM_AFTER_MS + 1000, w.watcher);
  w.watcher.onRefused(A, other);
  await w.watcher.settled();
  assert.deepEqual(w.removed, []);
});

test('a burst of refusals asks one question', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const w = makeWatcher(['key_switched_off']);
  const ask = w.watcher.deps.ask;
  w.watcher.deps.ask = async (q) => { await gate; return ask(q); };
  for (let i = 0; i < 30; i++) w.watcher.onRefused(A, w.key);
  release();
  await w.watcher.settled();
  for (let i = 0; i < 30; i++) w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  assert.equal(w.asked.length, 1);
});

test('after key_switched_off the key is not asked about again for six hours', async () => {
  const w = makeWatcher(['key_switched_off']);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  await w.clock.advance(ks.QUIET_AFTER_SWITCHED_OFF_MS - 1000, w.watcher);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  assert.equal(w.asked.length, 1);
  await w.clock.advance(2000, w.watcher);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  assert.equal(w.asked.length, 2);
  assert.deepEqual(w.removed, []);
});

test('an account id that is not an account id, or a key that is not a Hiveku key, is never asked about', async () => {
  const w = makeWatcher(['removed_from_team']);
  for (const id of ['key-1a2b3c', A.toUpperCase(), '', 'acme']) w.watcher.onRefused(id, w.key);
  for (const key of ['${HIVEKU_TOKEN}', 'sk_live_x', '']) w.watcher.onRefused(A, key);
  await w.watcher.settled();
  assert.equal(w.asked.length, 0);
});

test('dispose cancels the confirming question', async () => {
  const w = makeWatcher(['removed_from_team', 'removed_from_team']);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  w.watcher.dispose();
  await w.clock.advance(ks.CONFIRM_AFTER_MS, w.watcher);
  assert.equal(w.asked.length, 1);
  assert.deepEqual(w.removed, []);
});

test('the watcher never logs a key', async () => {
  const w = makeWatcher(['removed_from_team', 'key_switched_off']);
  w.watcher.onRefused(A, w.key);
  await w.watcher.settled();
  await w.clock.advance(ks.CONFIRM_AFTER_MS, w.watcher);
  assert.ok(w.logs.length >= 2);
  for (const line of w.logs) assert.equal(line.includes(w.key), false);
});
