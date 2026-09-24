/**
 * Form capture in the project panel: the rows, the form-rule actions, the
 * previewed site changes, and every branch of the permanent erase
 * (marketing_form_capture_purge: dry run, modal review, one execute bound to
 * the confirm token, 403 agent_execute_disabled, 409 stale_plan, an expired
 * review, an answer that never arrives).
 *
 * Runs against the compiled extension (npm test compiles first). The runs are
 * called the way the panel engine calls them: context { project_id } merged
 * into the action's args, then the picked inputs.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { calls, resetCalls, vscodeStub } from './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

const { PROJECT_MODULE } = loadOut('modules');
const { McpToolError } = loadOut('mcpClient');
const { modalActionUi } = loadOut('panel');

const PID = '6f1d7a52-3b1c-4c2e-9a41-5f0e2b7c9d10';
const SITE = "Noah's Ark Events";

const section = PROJECT_MODULE.sections.find((s) => s.id === 'formcapture');
const rowAction = (id) => section.rowActions.find((a) => a.id === id);
const headerAction = (id) => section.headerActions.find((a) => a.id === id);
/** What the engine hands a run: context, then the action's args(row), then the picked inputs. */
const argsFor = (action, row, inputs = {}) => ({ project_id: PID, ...(action.args ? action.args(row ?? {}) : {}), ...inputs });

/** The olympus-proxy failure shape: status, and the route body under `details`. */
const refused = (tool, status, body) =>
  new McpToolError(`Tool ${tool} errored: ${JSON.stringify(body)}`, tool, { error: body.error, status, details: body, attempts: 1 });

function fakeUi({ confirm = true, inform = false } = {}) {
  const log = [];
  return {
    log,
    ui: {
      subject: '',
      progress: (_title, task) => task(),
      confirm: async (message, detail, button) => {
        log.push({ kind: 'confirm', message, detail, button });
        return confirm;
      },
      warn: async (message, detail) => {
        log.push({ kind: 'warn', message, detail });
      },
      inform: async (message, button) => {
        log.push({ kind: 'inform', message, button });
        return button ? inform : false;
      },
      openDashboard: async (sub) => {
        log.push({ kind: 'open', sub });
      },
    },
  };
}

const LIST = {
  success: true,
  data: {
    settings: { project_id: PID, project_name: SITE, enabled: true, mode: 'all', path_rules: [], form_rules: [] },
    window_days: 90,
    truncated: false,
    skip_counts_available: true,
    totals: { forms: 3, submissions: 530, recorded_now_excluded: 404, sign_in_forms_seen: 1 },
    forms: [
      {
        form_key: 'contact@/contact', name: 'Contact us', page_path: '/contact', submissions: 120,
        status: 'captured', reason: 'default', reason_text: 'Captured', rule: null,
        recorded_now_excluded: 0, skipped_30d: 0, sign_in_page: false,
      },
      {
        form_key: 'register@/events/register', name: 'Child registration', page_path: '/events/register', submissions: 404,
        status: 'not_captured', reason: 'path_excluded', reason_text: 'Not captured: the page matches the excluded path /events/*',
        rule: null, recorded_now_excluded: 404, skipped_30d: 37, sign_in_page: false,
      },
      {
        form_key: 'login@/login', name: 'Sign in', page_path: '/login', submissions: 6,
        status: 'mixed', reason: 'sign_in_form', reason_text: 'Not captured: looks like a sign-in or password form',
        rule: 'exclude', recorded_now_excluded: 0, skipped_30d: null, sign_in_page: true,
      },
    ],
  },
};
const rows = section.transform(LIST);

const IMPACT = {
  window_days: 90,
  submissions_considered: 530,
  newly_excluded: 126,
  newly_included: 0,
  truncated: false,
  by_form: [
    { form_key: 'contact@/contact', name: 'Contact us', submissions: 120, before: 'captured', after: 'not_captured' },
    { form_key: 'login@/login', name: 'Sign in', submissions: 6, before: 'mixed', after: 'not_captured' },
  ],
};
const PREVIEW = { success: true, data: { candidate: { project_id: PID, project_name: SITE }, impact: IMPACT, forms: [], saved: false } };
const SAVED = { success: true, data: { project_id: PID, project_name: SITE, impact: IMPACT, conversions_held: 2 } };
const SETTINGS = {
  success: true,
  data: { project_id: PID, project_name: SITE, path_rules: [{ path: '/events/*', action: 'exclude' }], form_rules: [] },
};

describe('the Form capture tab lists the site forms', () => {
  test('rows come from data.forms with the reason, the rule and what an erase would remove', () => {
    assert.equal(section.label, 'Form capture');
    assert.equal(section.tool, 'marketing_form_capture_list');
    assert.deepEqual(section.args, { days: 90 });
    assert.deepEqual(section.titleKeys, ['name', 'form_key']);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].capture, 'Captured');
    assert.equal(rows[0].rule_label, '');
    assert.equal(rows[0].skipped, undefined, 'zero skips are not shown');
    assert.equal(rows[0].erasable, undefined, 'nothing to erase is not shown');
    assert.equal(rows[1].capture, 'Not captured: the page matches the excluded path /events/*');
    assert.equal(rows[1].skipped, 37);
    assert.equal(rows[1].erasable, 404);
    assert.equal(rows[2].capture, 'Partly captured; latest: Not captured: looks like a sign-in or password form');
    assert.equal(rows[2].rule_label, 'Never capture');
  });

  test('an answer without a forms array is a display fault, not a site with no forms', () => {
    assert.throws(() => section.transform({ success: true, data: { settings: {} } }), /display fault/);
  });
});

describe('Always capture / Never capture / Default', () => {
  test('each merges one form rule; only Never carries the confirm, worded as specified', () => {
    assert.deepEqual(rowAction('always').args(rows[0]), { form_rules: { 'contact@/contact': 'include' } });
    assert.deepEqual(rowAction('never').args(rows[0]), { form_rules: { 'contact@/contact': 'exclude' } });
    assert.deepEqual(rowAction('default').args(rows[2]), { form_rules: { 'login@/login': 'remove' } });
    assert.equal(
      rowAction('never').confirm,
      'Stop capturing this form? New submissions from it will not create contacts, notifications or conversions.',
    );
    assert.equal(rowAction('always').confirm, undefined);
    assert.equal(rowAction('default').confirm, undefined);
    for (const id of ['always', 'never', 'default']) assert.equal(rowAction(id).successReload, true);
  });

  test('a click that would change nothing is refused before any call', () => {
    assert.match(rowAction('never').guard(rows[2]), /already set to Never capture/);
    assert.match(rowAction('default').guard(rows[0]), /no rule of its own/);
    assert.match(rowAction('always').guard({}), /no key/);
    assert.equal(rowAction('always').guard(rows[0]), null);
    assert.equal(rowAction('never').guard(rows[0]), null);
    assert.equal(rowAction('default').guard(rows[2]), null);
  });

  test('the save sends project_id and the merge map, and reports the forms it moved', async () => {
    const client = fakeClient({ marketing_form_capture_settings_update: SAVED });
    const { ui, log } = fakeUi();
    const action = rowAction('never');
    const out = await action.run(client, argsFor(action, rows[0]), ui);
    assert.deepEqual(client.seen, [
      { name: 'marketing_form_capture_settings_update', args: { project_id: PID, form_rules: { 'contact@/contact': 'exclude' } } },
    ]);
    assert.equal(log.length, 0, 'the confirm is the engine modal before the run, not a second one');
    const note = action.done(out.result);
    assert.match(note, /^Saved\. 2 forms changed: Contact us \(now not captured\), Sign in \(now not captured\)\./);
    assert.match(note, /2 queued ad conversions held back\./);
    assert.match(note, /stay until you run Erase excluded\.\.\.$/);
  });

  test('a refusal shows the route sentence and saves nothing', async () => {
    const client = fakeClient({
      marketing_form_capture_settings_update: refused('marketing_form_capture_settings_update', 400, {
        error: 'A site can have at most 200 form rules',
      }),
    });
    const { ui, log } = fakeUi();
    const action = rowAction('always');
    assert.equal(await action.run(client, argsFor(action, rows[0]), ui), null);
    assert.deepEqual(log, [{ kind: 'warn', message: 'Not saved.', detail: 'A site can have at most 200 form rules' }]);
  });

  test('a failure that is not a 4xx still throws to the engine', async () => {
    const client = fakeClient({ marketing_form_capture_settings_update: new Error('MCP HTTP 502: bad gateway') });
    const { ui } = fakeUi();
    const action = rowAction('always');
    await assert.rejects(action.run(client, argsFor(action, rows[0]), ui), /502/);
  });
});

describe('site changes are previewed, confirmed with the forms they move, then saved', () => {
  test('Capture off: preview enabled:false, a confirm naming the site and the forms, then only enabled:false is saved', async () => {
    const client = fakeClient({ marketing_form_capture_preview: PREVIEW, marketing_form_capture_settings_update: SAVED });
    const { ui, log } = fakeUi();
    const action = headerAction('capture');
    assert.equal(action.label, 'Capture on/off');
    assert.deepEqual(action.inputs[0].options, ['Capture on', 'Capture off']);
    assert.equal(action.confirm, undefined, 'the confirm comes after the pick, with the preview in it');
    assert.equal(action.successReload, true);
    const out = await action.run(client, argsFor(action, undefined, { capture: 'Capture off' }), ui);
    assert.deepEqual(
      client.seen.map((c) => [c.name, c.args]),
      [
        ['marketing_form_capture_preview', { project_id: PID, enabled: false }],
        ['marketing_form_capture_settings_update', { project_id: PID, enabled: false }],
      ],
    );
    assert.equal(log.length, 1);
    assert.equal(log[0].message, `Turn automatic form capture off for ${SITE}?`);
    assert.equal(log[0].button, 'Turn capture off');
    assert.match(log[0].detail, /126 would no longer be captured and 0 would start being captured/);
    assert.match(log[0].detail, /- Contact us: captured -> not captured \(120 submissions\)/);
    assert.match(log[0].detail, /- Sign in: partly captured -> not captured \(6 submissions\)/);
    assert.match(action.done(out.result), /^Saved\. 2 forms changed/);
  });

  test('declining the confirmation saves nothing', async () => {
    const client = fakeClient({ marketing_form_capture_preview: PREVIEW });
    const { ui } = fakeUi({ confirm: false });
    const action = headerAction('capture');
    assert.equal(await action.run(client, argsFor(action, undefined, { capture: 'Capture on' }), ui), null);
    assert.deepEqual(client.seen, [{ name: 'marketing_form_capture_preview', args: { project_id: PID, enabled: true } }]);
  });

  test('an answer without impact is never read as "nothing changes"', async () => {
    const client = fakeClient({
      marketing_form_capture_preview: { success: true, data: { candidate: { project_name: SITE }, saved: false } },
      marketing_form_capture_settings_update: { success: true, data: { project_id: PID } },
    });
    const { ui, log } = fakeUi();
    const action = headerAction('capture');
    const out = await action.run(client, argsFor(action, undefined, { capture: 'Capture off' }), ui);
    assert.match(log[0].detail, /The preview did not say which forms this changes\./);
    assert.doesNotMatch(log[0].detail, /would change/);
    assert.equal(action.done(out.result), 'Saved.');
  });

  test('an unknown pick stops the action without a call', async () => {
    const client = fakeClient({});
    const { ui, log } = fakeUi();
    const action = headerAction('capture');
    assert.equal(await action.run(client, argsFor(action, undefined, { capture: 'maybe' }), ui), null);
    assert.equal(client.seen.length, 0);
    assert.equal(log.length, 0);
  });

  test('Site type maps Web app to mode allowlist and Marketing site to mode all', async () => {
    const action = headerAction('sitetype');
    const [marketing, webApp] = action.inputs[0].options;
    assert.match(marketing, /^Marketing site/);
    assert.match(webApp, /^Web app/);
    for (const [label, mode, question] of [
      [webApp, 'allowlist', `Treat ${SITE} as a Web app?`],
      [marketing, 'all', `Treat ${SITE} as a Marketing site?`],
    ]) {
      const client = fakeClient({ marketing_form_capture_preview: PREVIEW, marketing_form_capture_settings_update: SAVED });
      const { ui, log } = fakeUi();
      await action.run(client, argsFor(action, undefined, { site_type: label }), ui);
      assert.deepEqual(client.seen.map((c) => c.args), [{ project_id: PID, mode }, { project_id: PID, mode }]);
      assert.equal(log[0].message, question);
    }
  });

  test('+ Path rule exclude previews exclude_paths and saves one path rule; include uses include_paths', async () => {
    const action = headerAction('pathrule');
    const [exclude, include] = action.inputs[1].options;
    for (const [label, previewArg, rule, question] of [
      [exclude, 'exclude_paths', 'exclude', `Stop capturing forms on /events/* for ${SITE}?`],
      [include, 'include_paths', 'include', `Capture forms on /events/* for ${SITE}?`],
    ]) {
      const client = fakeClient({ marketing_form_capture_preview: PREVIEW, marketing_form_capture_settings_update: SAVED });
      const { ui, log } = fakeUi();
      await action.run(client, argsFor(action, undefined, { path: ' /events/* ', rule: label }), ui);
      assert.deepEqual(client.seen.map((c) => c.args), [
        { project_id: PID, [previewArg]: '/events/*' },
        { project_id: PID, path_rules: { '/events/*': rule } },
      ]);
      assert.equal(log[0].message, question);
    }
  });

  test('a path the server refuses is shown as its sentence, and nothing is saved', async () => {
    const client = fakeClient({
      marketing_form_capture_preview: refused('marketing_form_capture_preview', 400, { error: 'Path rules start with "/" (got "portal")' }),
    });
    const { ui, log } = fakeUi();
    const action = headerAction('pathrule');
    assert.equal(await action.run(client, argsFor(action, undefined, { path: 'portal', rule: action.inputs[1].options[0] }), ui), null);
    assert.deepEqual(client.seen.map((c) => c.name), ['marketing_form_capture_preview']);
    assert.deepEqual(log, [{ kind: 'warn', message: 'Not saved.', detail: 'Path rules start with "/" (got "portal")' }]);
  });

  test('an empty path or one with a comma is refused before any call', async () => {
    const action = headerAction('pathrule');
    for (const path of ['', '/a,/b']) {
      const client = fakeClient({});
      const { ui, log } = fakeUi();
      assert.equal(await action.run(client, argsFor(action, undefined, { path, rule: action.inputs[1].options[0] }), ui), null);
      assert.equal(client.seen.length, 0);
      assert.equal(log[0].kind, 'inform');
    }
  });

  test('removing a path rule reads the rules, confirms the stored one, and removes it by its stored key', async () => {
    const client = fakeClient({ marketing_form_capture_settings_get: SETTINGS, marketing_form_capture_settings_update: SAVED });
    const { ui, log } = fakeUi();
    const action = headerAction('pathrule');
    const remove = action.inputs[1].options[2];
    await action.run(client, argsFor(action, undefined, { path: '/Events/*/', rule: remove }), ui);
    assert.deepEqual(client.seen.map((c) => [c.name, c.args]), [
      ['marketing_form_capture_settings_get', { project_id: PID }],
      ['marketing_form_capture_settings_update', { project_id: PID, path_rules: { '/events/*': 'remove' } }],
    ]);
    assert.equal(log[0].message, `Remove the path rule /events/* (exclude) from ${SITE}?`);
    assert.equal(log[0].button, 'Remove rule');
  });

  test('removing a rule that does not exist lists the rules there are and saves nothing', async () => {
    const client = fakeClient({ marketing_form_capture_settings_get: SETTINGS });
    const { ui, log } = fakeUi();
    const action = headerAction('pathrule');
    assert.equal(await action.run(client, argsFor(action, undefined, { path: '/portal/*', rule: action.inputs[1].options[2] }), ui), null);
    assert.deepEqual(client.seen.map((c) => c.name), ['marketing_form_capture_settings_get']);
    assert.equal(log[0].message, `${SITE} has no path rule for /portal/*. Its path rules: /events/* (exclude).`);
  });
});

describe('Erase excluded... is a reviewed, permanent erase', () => {
  const PLAN = {
    success: true,
    data: {
      dry_run: true,
      project_id: PID,
      since: null,
      total_excluded_submissions: 404,
      batch: {
        submissions: 250,
        rows_including_duplicates: 262,
        contacts_erasable: 180,
        contacts_kept: 12,
        by_form: [
          {
            form_key: 'register@/events/register',
            name: 'Child registration',
            submissions: 250,
            reason_text: 'Not captured: the page matches the excluded path /events/*',
          },
        ],
        contacts_kept_by_reason: { existed_before: 9, referenced_by_crm_deals: 3 },
        mixed_groups_left_alone: 1,
        offline_conversions: { pending: 4, already_uploaded: { meta: 2 } },
        workflow_runs_to_redact: 7,
      },
      more_available: true,
      cannot_undo: [
        'Notification emails already sent about these submissions.',
        'Conversions already uploaded to an ad platform (Meta cannot delete them at all).',
      ],
      analytics_copies: 'retained',
      confirm_token: 'tok-1',
      expires_in_seconds: 900,
      next_step: 'To erase this batch permanently, call again with confirm: true and this confirm_token within 15 minutes.',
    },
  };
  const ERASED = {
    success: true,
    data: {
      dry_run: false,
      status: 'ok',
      erased: { submissions: 250, contacts: 180, activity_notes: 250, outbox_rows: 4, workflow_runs_redacted: 7 },
      contacts_kept: 12,
      more_available: true,
      analytics_copies: 'retained',
    },
  };
  /** A purge tool that answers the dry run with `plan` and the execute with `execute` (a value, an Error, or a function). */
  const purgeClient = (execute, plan = PLAN) =>
    fakeClient({
      marketing_form_capture_settings_get: SETTINGS,
      marketing_form_capture_purge: (args) => {
        if (!args.confirm) return plan;
        if (execute instanceof Error) throw execute;
        return execute;
      },
    });
  const purges = (client) => client.seen.filter((c) => c.name === 'marketing_form_capture_purge').map((c) => c.args);
  const action = headerAction('erase');

  test('a dry run, one modal review, then one execute bound to the token; the done message says more remain', async () => {
    assert.equal(action.label, 'Erase excluded...');
    assert.equal(action.successReload, true);
    const client = purgeClient(ERASED);
    const { ui, log } = fakeUi();
    const out = await action.run(client, argsFor(action), ui);
    assert.deepEqual(purges(client), [
      { project_id: PID, dry_run: true },
      { project_id: PID, dry_run: false, confirm: true, confirm_token: 'tok-1' },
    ]);
    assert.equal(log.length, 1);
    const [review] = log;
    assert.equal(review.kind, 'confirm');
    assert.equal(review.button, 'Erase permanently');
    assert.equal(review.message, `Permanently erase 250 captured submissions from ${SITE}?`);
    assert.match(review.detail, /There is no undo\./);
    assert.match(review.detail, /- Child registration: 250 submissions \(Not captured: the page matches the excluded path \/events\/\*\)/);
    assert.match(review.detail, /Contacts: 180 erased \(they exist only because of these submissions\), 12 kept because they have other history \(existed before: 9, referenced by crm deals: 3\)\./);
    assert.match(review.detail, /4 queued ad conversions removed before upload/);
    assert.match(review.detail, /conversions already uploaded stay on the ad platform \(2 on meta\)/);
    assert.match(review.detail, /7 automation runs cleared of these submissions/);
    assert.match(review.detail, /1 submission that also came in through a hosted form or a webhook left alone/);
    assert.match(review.detail, /Not undone by this erase:\n- Notification emails already sent about these submissions\./);
    assert.match(review.detail, /This is one batch: 250 of the 404 excluded submissions\. Afterwards, run Erase excluded\.\.\. again/);
    const note = action.done(out.result);
    assert.equal(
      note,
      'Erased 250 submissions and 180 contacts; 12 contacts kept because they have other history. ' +
        'More excluded submissions remain: run Erase excluded... again to review the next batch.',
    );
  });

  test('dismissing the review erases nothing', async () => {
    const client = purgeClient(ERASED);
    const { ui } = fakeUi({ confirm: false });
    assert.equal(await action.run(client, argsFor(action), ui), null);
    assert.deepEqual(purges(client), [{ project_id: PID, dry_run: true }]);
  });

  test('nothing to erase: no modal and no execute', async () => {
    const empty = {
      success: true,
      data: { ...PLAN.data, total_excluded_submissions: 0, more_available: false, confirm_token: null, batch: { ...PLAN.data.batch, submissions: 0, by_form: [] } },
    };
    const client = purgeClient(ERASED, empty);
    const { ui, log } = fakeUi();
    assert.equal(await action.run(client, argsFor(action), ui), null);
    assert.deepEqual(purges(client), [{ project_id: PID, dry_run: true }]);
    assert.deepEqual(log.map((e) => e.kind), ['inform']);
    assert.match(log[0].message, new RegExp(`^Nothing to erase on ${SITE}`));
  });

  test('403 agent_execute_disabled: nothing erased, the dashboard is offered and opened only on request', async () => {
    const disabled = refused('marketing_form_capture_purge', 403, {
      error: 'Erasing through an agent key is not switched on yet. Erase from the dashboard instead: Analytics > Forms > Capture > Erase. The dry run still works here.',
      code: 'agent_execute_disabled',
    });
    for (const choose of [true, false]) {
      const client = purgeClient(disabled);
      const { ui, log } = fakeUi({ inform: choose });
      assert.equal(await action.run(client, argsFor(action), ui), null);
      assert.equal(purges(client).length, 2, 'one dry run, one execute, no retry');
      assert.deepEqual(log.map((e) => e.kind), choose ? ['confirm', 'inform', 'open'] : ['confirm', 'inform']);
      assert.match(log[1].message, /^Nothing was erased\. Erasing from VS Code is not switched on yet/);
      assert.match(log[1].message, /Analytics > Forms > Capture > Erase/);
      assert.equal(log[1].button, 'Open dashboard');
      if (choose) assert.equal(log[2].sub, `${PID}/analytics?tab=analytics&view=forms`);
    }
  });

  test('409 stale_plan: nothing erased, and it says to review again', async () => {
    const client = purgeClient(
      refused('marketing_form_capture_purge', 409, {
        error: 'The set changed since the dry run (it covered 262 submissions). Run the dry run again and confirm the new plan.',
        code: 'stale_plan',
      }),
    );
    const { ui, log } = fakeUi();
    assert.equal(await action.run(client, argsFor(action), ui), null);
    assert.equal(log[1].kind, 'warn');
    assert.equal(log[1].message, 'Nothing was erased: the set changed since the review.');
    assert.match(log[1].detail, /Run Erase excluded\.\.\. again/);
  });

  test('an expired review erases nothing and says so', async () => {
    const client = purgeClient(
      refused('marketing_form_capture_purge', 400, {
        error: 'confirm_token is not valid for this erase (expired). Run a dry run first.',
        code: 'expired',
      }),
    );
    const { ui, log } = fakeUi();
    assert.equal(await action.run(client, argsFor(action), ui), null);
    assert.equal(log[1].message, 'Nothing was erased: the review expired.');
  });

  test('an answer that never arrives is "may or may not have run", and the erase is not re-sent', async () => {
    const client = purgeClient(new Error('MCP request timed out after 135s (tools/call)'));
    const { ui, log } = fakeUi();
    assert.equal(await action.run(client, argsFor(action), ui), null);
    assert.equal(purges(client).length, 2);
    assert.equal(log[1].kind, 'warn');
    assert.match(log[1].message, /may or may not have run/);
    assert.match(log[1].detail, /timed out after 135s/);
    assert.match(log[1].detail, /never sent twice/);
  });

  test('a dry run refused for permission shows the sentence and erases nothing', async () => {
    const client = fakeClient({
      marketing_form_capture_settings_get: SETTINGS,
      marketing_form_capture_purge: refused('marketing_form_capture_purge', 403, {
        error: 'This erases CRM contacts, so the key needs CRM write permission (olympus:crm:write).',
      }),
    });
    const { ui, log } = fakeUi();
    assert.equal(await action.run(client, argsFor(action), ui), null);
    assert.deepEqual(log, [
      {
        kind: 'warn',
        message: 'Could not review the erase. Nothing was erased.',
        detail: 'This erases CRM contacts, so the key needs CRM write permission (olympus:crm:write).',
      },
    ]);
  });

  test('a dry run this extension cannot read is refused, never shown as zeros', async () => {
    const client = purgeClient(ERASED, { success: true, data: { dry_run: true, batch: {} } });
    const { ui, log } = fakeUi();
    await assert.rejects(action.run(client, argsFor(action), ui), /cannot read\. Nothing was erased\./);
    assert.equal(log.length, 0);
    assert.deepEqual(purges(client), [{ project_id: PID, dry_run: true }]);
  });

  test('the review still works when the site name cannot be read', async () => {
    const client = fakeClient({
      marketing_form_capture_settings_get: new Error('MCP HTTP 502: bad gateway'),
      marketing_form_capture_purge: (args) => (args.confirm ? ERASED : PLAN),
    });
    const { ui, log } = fakeUi({ confirm: false });
    assert.equal(await action.run(client, argsFor(action), ui), null);
    assert.equal(log[0].message, 'Permanently erase 250 captured submissions from this site?');
  });

  test('nothing left by the time of the confirm reads as such', () => {
    assert.match(
      action.done({ success: true, data: { dry_run: false, erased: null, message: 'Nothing left to erase.' } }),
      /^Nothing was left to erase/,
    );
    assert.equal(
      action.done({ success: true, data: { dry_run: false, status: 'ok', erased: { submissions: 1, contacts: 0 }, contacts_kept: 0, more_available: false } }),
      'Erased 1 submission and 0 contacts.',
    );
    assert.match(action.done({ success: true, data: { dry_run: false, status: 'ok' } }), /did not say how much it erased/);
  });
});

describe('the engine UI a custom action may use', () => {
  beforeEach(() => resetCalls());

  test('openDashboard opens <account dashboard>/<sub>, query included', async () => {
    const parsed = [];
    const originalParse = vscodeStub.Uri.parse;
    vscodeStub.Uri.parse = (value) => {
      parsed.push(value);
      return originalParse.call(vscodeStub.Uri, value);
    };
    try {
      const ui = modalActionUi('', 'Locus Digital', 'https://app.hiveku.com/acct-1/dashboard');
      await ui.openDashboard(`${PID}/analytics?tab=analytics&view=forms`);
      assert.deepEqual(parsed, [`https://app.hiveku.com/acct-1/dashboard/${PID}/analytics?tab=analytics&view=forms`]);
      assert.equal(calls.openExternal.length, 1);
    } finally {
      vscodeStub.Uri.parse = originalParse;
    }
  });

  test('inform is a non-modal information message; with a button it returns whether it was chosen', async () => {
    const ui = modalActionUi('', 'Locus Digital', 'https://app.hiveku.com/acct-1/dashboard');
    assert.equal(await ui.inform('Nothing to erase.'), false);
    assert.equal(await ui.inform('Open it?', 'Open dashboard'), false, 'the stub dismisses every message');
    assert.deepEqual(calls.infos, [['Nothing to erase.'], ['Open it?', 'Open dashboard']]);
    assert.equal(calls.warnings.length, 0);
  });
});
