/**
 * The Calendar page lists what is coming, not a calendar's oldest events
 * (HK-1124).
 *
 * calendar_list_events was called with no window. The builder's route then asks
 * Google for the calendar in start order from its very first event and stops at
 * 50, so on a calendar with years behind it this week's meetings were never
 * reached. The page now asks for today through the next 60 days, the way the
 * social calendar section rolls its window, evaluated on every load.
 *
 * The Hiveku desktop app vendors this registry, so its CRM > Calendar runs this
 * same section until its native page replaces it.
 *
 * Driven through the real panel engine (openModulePanel) with a stub webview, so
 * the assertions are on the rows a person sees. The fake client answers as the
 * route and Google do: oldest first, from time_min if there is one, 50 by
 * default.
 */
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { resetCalls, vscodeStub } from './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

let messageHandler = null;
const posted = [];
vscodeStub.ViewColumn = { Active: -1 };
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

const { MODULES } = loadOut('modules');
const { openModulePanel } = loadOut('panel');

const CALENDAR = MODULES.find((m) => m.id === 'calendar');
const EVENTS = CALENDAR.sections.find((s) => s.id === 'events');
const ACCOUNT = { accountId: '0c7d3f7e-1b2a-4c5d-8e9f-a0b1c2d3e4f5', label: 'Northwind Coffee Roasters' };
const DAY = 24 * 60 * 60 * 1000;
// The page's clock in these tests: mid-afternoon, local, so nothing here turns on the day it runs.
const NOW = new Date(2026, 10, 5, 15, 30);

/** A noon meeting every day for the three years before NOW and the 90 days after it. */
function yearsOfMeetings() {
  const noon = new Date(2026, 10, 5, 12, 0).getTime();
  const events = [];
  for (let day = -3 * 365; day <= 90; day += 1) {
    const start = new Date(noon + day * DAY);
    events.push({
      id: `event-${day}`,
      summary: day < 0 ? `Past meeting ${-day} days ago` : `Meeting in ${day} days`,
      start: start.toISOString(),
      end: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
    });
  }
  return events;
}

/** The route and Google: start order, ended events out, stopped at max_results (default 50). */
function answerAsGoogle(events) {
  return ({ time_min: timeMin, time_max: timeMax, max_results: maxResults = 50 }) => {
    const inWindow = events.filter((event) => (
      (!timeMin || new Date(event.end) > new Date(timeMin))
      && (!timeMax || new Date(event.start) < new Date(timeMax))
    ));
    const data = inWindow.slice(0, Math.min(100, maxResults));
    return { data, total: data.length };
  };
}

let panelSeq = 0;
async function openCalendar(answer) {
  const client = fakeClient({ calendar_list_events: answer });
  messageHandler = null;
  openModulePanel(ACCOUNT, CALENDAR, async () => client, () => 'https://app.hiveku.com', {}, `calendar-${panelSeq++}`);
  assert.ok(messageHandler, 'the panel registered its message handler');
  await messageHandler({ type: 'load', section: 'events' });
  return client;
}

const rowsPosted = () => [...posted].reverse().find((m) => m.type === 'rows' && m.section === 'events');

beforeEach(() => {
  resetCalls();
  posted.length = 0;
  mock.timers.enable({ apis: ['Date'], now: NOW.getTime() });
});

afterEach(() => mock.timers.reset());

describe('the calendar window', () => {
  test('a calendar with years behind it opens on today, soonest first', async () => {
    await openCalendar(answerAsGoogle(yearsOfMeetings()));

    const { rows } = rowsPosted();
    assert.equal(rows[0].title, 'Meeting in 0 days');
    assert.equal(rows[1].title, 'Meeting in 1 days');
    assert.equal(rows.some((row) => row.title.startsWith('Past meeting')), false);
    // The last of them is inside the 60 days, and a later one never came back.
    assert.equal(rows.length, 60);
    assert.equal(rows.at(-1).title, 'Meeting in 59 days');
  });

  test('the tool is asked for today through the next 60 days, as much as it gives', async () => {
    const client = await openCalendar(answerAsGoogle([]));

    const [{ name, args }] = client.seen;
    assert.equal(name, 'calendar_list_events');
    assert.equal(args.time_min, new Date(2026, 10, 5).toISOString());
    assert.equal(new Date(args.time_max) - new Date(args.time_min), 60 * DAY);
    assert.equal(args.max_results, 100);
  });

  test('the window rolls with the clock: each load counts from that day', () => {
    assert.equal(typeof EVENTS.args, 'function', 'a fixed window would stop at the day the panel was built');
    assert.equal(EVENTS.args().time_min, new Date(2026, 10, 5).toISOString());
    mock.timers.setTime(new Date(2026, 10, 6, 0, 10).getTime());
    assert.equal(EVENTS.args().time_min, new Date(2026, 10, 6).toISOString());
  });

  test('the page says which window it shows, with events and without', async () => {
    assert.equal(EVENTS.label, 'Events (next 60 days)');
    await openCalendar(answerAsGoogle([]));
    assert.equal(rowsPosted().empty, 'No events in the next 60 days.');
    assert.deepEqual(rowsPosted().rows, []);
  });
});
