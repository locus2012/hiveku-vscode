/**
 * The Calendar page's leftovers from HK-1124 (HK-1231): an all-day event shows on its
 * own day in a US time zone, and a list that stops at the most its tool answers says
 * it may have been cut short.
 *
 * An all-day event starts on a plain day ("2026-11-10"). fmt parsed it as UTC midnight
 * and wrote it in the viewer's zone, which is the evening before anywhere west of
 * Greenwich, so the event showed a day early across the US. A timed event keeps the
 * viewer's own day. Run in Chicago's zone, set by the first import before anything loads.
 *
 * calendar_list_events stops at max_results (at most 100) and answers no total, and
 * social_calendar_list caps limit at 100, so 100 back may be the first 100 of more:
 * the panel says so (SectionSpec.stopsAt), and says nothing when fewer came back.
 *
 * Driven through the real panel engine (openModulePanel) with a stub webview, as
 * calendar-window.test.mjs is, so the assertions are on what a person sees.
 */
import './helpers/chicago-time-zone.mjs';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetCalls, vscodeStub } from './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

let messageHandler = null;
const posted = [];
let html = '';
vscodeStub.ViewColumn = { Active: -1 };
vscodeStub.window.createWebviewPanel = () => {
  const webview = {
    cspSource: 'vscode-resource:',
    postMessage: (message) => { posted.push(message); return Promise.resolve(true); },
    onDidReceiveMessage: (fn) => { messageHandler = fn; return { dispose() {} }; },
  };
  Object.defineProperty(webview, 'html', { get: () => html, set: (value) => { html = value; } });
  return { webview, onDidDispose: () => ({ dispose() {} }), reveal() {} };
};

const { MODULES } = loadOut('modules');
const { openModulePanel } = loadOut('panel');
const { fmt, cutShortWords } = loadOut('panelSpec');

const ACCOUNT = { accountId: '0c7d3f7e-1b2a-4c5d-8e9f-a0b1c2d3e4f5', label: 'Northwind Coffee Roasters' };
const section = (moduleId, sectionId) =>
  MODULES.find((m) => m.id === moduleId).sections.find((s) => s.id === sectionId);
const CALENDAR = MODULES.find((m) => m.id === 'calendar');
const SOCIAL = MODULES.find((m) => m.id === 'social');

let panelSeq = 0;
async function open(module, sectionId, answers) {
  messageHandler = null;
  openModulePanel(ACCOUNT, module, async () => fakeClient(answers), () => 'https://app.hiveku.com', {}, `cut-short-${panelSeq++}`);
  assert.ok(messageHandler, 'the panel registered its message handler');
  await messageHandler({ type: 'load', section: sectionId });
  return [...posted].reverse().find((m) => m.type === 'rows' && m.section === sectionId);
}

/** n Google events, a day apart from Nov 6 2026, as the route answers them (no total beyond the page). */
function events(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `event-${i}`,
    summary: `Meeting ${i + 1}`,
    start: new Date(Date.UTC(2026, 10, 6 + i, 18)).toISOString(),
    end: new Date(Date.UTC(2026, 10, 6 + i, 19)).toISOString(),
  }));
}

beforeEach(() => {
  resetCalls();
  posted.length = 0;
});

describe('an all-day event in a US time zone', () => {
  test('shows on its own day, and a timed event late in the evening on the viewer\'s day', async () => {
    const rows = await open(CALENDAR, 'events', {
      calendar_list_events: {
        data: [
          { id: 'all-day', summary: 'Team offsite', start: '2026-11-10', end: '2026-11-11', allDay: true },
          // 8 PM in Chicago, which is already Nov 11 in UTC.
          { id: 'evening', summary: 'Late call', start: '2026-11-10T20:00:00-06:00', end: '2026-11-10T21:00:00-06:00' },
        ],
        total: 2,
      },
    });
    const tenth = new Date(2026, 10, 10).toLocaleDateString();
    assert.deepEqual(rows.rows.map((row) => [row.title, row.fields[0].value]), [
      ['Team offsite', tenth],
      ['Late call', tenth],
    ]);
  });

  test('fmt writes any plain day as that day, and leaves a moment in the viewer\'s zone', () => {
    const tenth = new Date(2026, 10, 10).toLocaleDateString();
    assert.equal(fmt('2026-11-10', { keys: ['due'], date: true }), tenth);
    assert.equal(fmt('2026-11-10', { keys: ['due'], dateOnly: true }), tenth);
    assert.equal(fmt('2026-11-11T02:00:00.000Z', { keys: ['at'], date: true }), tenth);
    assert.equal(fmt('not a date', { keys: ['at'], date: true }), 'not a date');
  });
});

describe('a list that stops at the most its tool answers', () => {
  test('the calendar says 100 back may be the first of more, and nothing more when fewer came back', async () => {
    assert.equal(section('calendar', 'events').stopsAt, 100);
    const full = await open(CALENDAR, 'events', { calendar_list_events: { data: events(100), total: 100 } });
    assert.equal(full.rows.length, 100);
    assert.equal(full.capped, undefined);
    assert.equal(full.cutShort, 'Showing the first 100. The list stops there, so there may be more.');
    assert.match(html, /lastCutShort=m\.cutShort/);
    assert.match(html, /lastCutShort\+' Use the dashboard for the full set\.'/);

    const fewer = await open(CALENDAR, 'events', { calendar_list_events: { data: events(99), total: 99 } });
    assert.equal(fewer.rows.length, 99);
    assert.equal(fewer.cutShort, undefined);
  });

  test('the social calendar, which the route caps at 100, says so too', async () => {
    assert.equal(section('social', 'calendar').stopsAt, 100);
    const full = Array.from({ length: 100 }, (_, i) => ({ id: `plan-${i}`, title: `Plan ${i + 1}`, start_date: '2026-11-10' }));
    const rows = await open(SOCIAL, 'calendar', {
      social_calendar_list: { data: full, pagination: { page: 1, limit: 100, total: 140, total_pages: 2 } },
    });
    assert.equal(rows.cutShort, 'Showing the first 100. The list stops there, so there may be more.');
  });

  test('a section with no such limit never says it, and a longer list keeps its exact count', () => {
    assert.equal(cutShortWords({}, 100), null);
    assert.equal(cutShortWords({ stopsAt: 100 }, 40), null);
    assert.equal(cutShortWords({ stopsAt: 50 }, 50), 'Showing the first 50. The list stops there, so there may be more.');
  });
});
