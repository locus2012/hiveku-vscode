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
 * Every other list that stops at a fixed number says so too (HK-1257): at the limit
 * it asks for or, asking for none, at its route's default page.
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
const CRM = MODULES.find((m) => m.id === 'crm');
const PM = MODULES.find((m) => m.id === 'pm');
const ACCOUNTING = MODULES.find((m) => m.id === 'accounting');

/** Where each list stops, read off its builder route: the limit it asks for, else the route's default page. */
const STOPS = {
  crm: { deals: 50, contacts: 50, companies: 50, activities: 40 },
  revenue: { estimates: 50, envelopes: 50 },
  helpdesk: { tickets: 50, overdue: 100, macros: 50 },
  pm: { tasks: 80, milestones: 50 },
  workflows: { workflows: 50, runs: 50 },
  email: { campaigns: 50, audiences: 50, sequences: 50, templates: 50 },
  seo: { projects: 20, keywords: 50 },
  ppc: { campaigns: 50 },
  social: { posts: 30, approvals: 100, calendar: 100, comments: 100 },
  content: { library: 20, templates: 20 },
  creative: { brand: 20, avatars: 20, journeys: 20, designs: 50 },
  voice: { calls: 10, numbers: 50, extensions: 50, ringgroups: 50, ivrs: 50 },
  outbound: { campaigns: 30, leads: 30 },
  calendar: { events: 100 },
  collab: { discussions: 20, boards: 50 },
  integrations: { connected: 50 },
  knowledge: { kbs: 50 },
  mc: { tasks: 50, sla: 100 },
  accounting: { bills: 50, invoices: 50, payroll: 50 },
  commerce: { products: 20, estimates: 50, contracts: 50 },
};

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

describe('every list that stops at a fixed number (HK-1257)', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, title: `Row ${i + 1}`, content: `Row ${i + 1}` }));
  const says = (n) => `Showing the first ${n}. The list stops there, so there may be more.`;

  test('names where it stops, and no other list does', () => {
    const named = {};
    for (const module of MODULES) {
      for (const list of module.sections) {
        if (list.stopsAt !== undefined) (named[module.id] ??= {})[list.id] = list.stopsAt;
      }
    }
    assert.deepEqual(named, STOPS);
  });

  test('a list that asks for a number of rows stops at that number', () => {
    for (const module of MODULES) {
      for (const list of module.sections) {
        const args = typeof list.args === 'function' ? list.args() : (list.args ?? {});
        const asked = args.limit ?? args.max_results;
        if (asked !== undefined) assert.equal(list.stopsAt, asked, `${module.id} ${list.id}`);
      }
    }
  });

  test('a stop is one the panel can say: above 100 rows it says the list is capped instead', () => {
    for (const module of MODULES) {
      for (const list of module.sections) {
        if (list.stopsAt !== undefined) assert.ok(list.stopsAt <= 100, `${module.id} ${list.id}`);
      }
    }
  });

  test('comments needing a reply and the approval queue say so at 100, and nothing at 99', async () => {
    const page = (n) => ({ data: rows(n), pagination: { page: 1, limit: 100, total: 140, total_pages: 2 } });
    assert.equal((await open(SOCIAL, 'comments', { social_comments_list: page(100) })).cutShort, says(100));
    assert.equal((await open(SOCIAL, 'comments', { social_comments_list: page(99) })).cutShort, undefined);
    assert.equal((await open(SOCIAL, 'approvals', { social_list_posts: page(100) })).cutShort, says(100));
    assert.equal((await open(SOCIAL, 'approvals', { social_list_posts: page(99) })).cutShort, undefined);
  });

  test('sections asking for 50, 40 and 80 rows say so when they come back full', async () => {
    const full = async (module, id, tool, n) => (await open(module, id, { [tool]: { data: rows(n), total: 500 } })).cutShort;
    assert.equal(await full(CRM, 'deals', 'crm_list_deals', 50), says(50));
    assert.equal(await full(CRM, 'deals', 'crm_list_deals', 49), undefined);
    assert.equal(await full(CRM, 'activities', 'crm_list_activities', 40), says(40));
    assert.equal(await full(CRM, 'activities', 'crm_list_activities', 39), undefined);
    assert.equal(await full(PM, 'tasks', 'pm_tasks_list', 80), says(80));
    assert.equal(await full(PM, 'tasks', 'pm_tasks_list', 79), undefined);
  });

  test('a list that asks for no number says so at its route\'s default page', async () => {
    const answer = { accounting_bill_list: { data: rows(50) } };
    assert.equal((await open(ACCOUNTING, 'bills', answer)).cutShort, says(50));
  });
});
