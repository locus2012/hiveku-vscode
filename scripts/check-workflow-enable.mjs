/**
 * Pin the Enable flow for workflows (Automations panel row action and the
 * console toggle).
 *
 * WHY. workflow_enable on a DISABLED workflow runs workflow_validate first and
 * answers 422 { error: 'workflow_invalid', issues } while errors remain. The
 * MCP proxy delivers that as an isError tool result whose text nests the route
 * body under `details`. The flow must read that body, list the issues, and on
 * the operator's yes re-send with allow_incomplete:true. An MCP server that
 * predates allow_incomplete drops the argument and refuses again; the flow must
 * then stop with the issues, not offer the override forever. Every other
 * failure (unbound_project_nodes, a 500) must still throw with the same message
 * text as before McpToolError existed. None of this needs VS Code: the real
 * client's parsing runs here with a scripted transport and a fake UI.
 *
 * Run: node --import ./scripts/register-ts.mjs scripts/check-workflow-enable.mjs
 */
import assert from 'node:assert/strict';

const { HivekuMcpClient, McpToolError } = await import('../src/mcpClient.ts');
const { workflowEnable } = await import('../src/hivekuApi.ts');
const { enableWorkflow, enabledAnywayNote } = await import('../src/modules.ts');

let n = 0;
const check = async (name, fn) => {
  await fn();
  n++;
  console.log(`  ok  ${name}`);
};

/** A real client whose tools/call answers are scripted, in order. */
function scripted(answers) {
  const client = new HivekuMcpClient({ baseUrl: 'http://scripted.invalid', apiKey: 'k' });
  const calls = [];
  client.initialize = async () => {};
  client.request = async (_method, params) => {
    calls.push(params.arguments);
    const answer = answers.shift();
    if (!answer) throw new Error('no scripted answer left');
    return answer;
  };
  return { client, calls };
}
const okResult = (body) => ({ content: [{ type: 'text', text: JSON.stringify(body) }] });
/** The olympus-proxy failure shape: isError, route body under `details`. */
const proxyError = (status, body, extra = {}) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: body.error, status, details: body, attempts: 1, ...extra }) }],
});
const INVALID = {
  error: 'workflow_invalid',
  message: '1 problem(s) must be fixed before this workflow can be enabled: ...',
  issues: [
    {
      severity: 'error',
      code: 'missing_required_field',
      message: 'Node "slack_1" (Slack Notification) is missing required field "webhookUrl" (Webhook URL; or webhook_url).',
      nodeId: 'slack_1',
      field: 'webhookUrl',
      anyOf: ['webhookUrl', 'webhook_url'],
    },
  ],
  summary: { nodes: 2, edges: 1, triggers: 1, errors: 1, warnings: 0 },
};
function fakeUi(answer) {
  const log = [];
  return {
    log,
    ui: {
      subject: 'Lead alert',
      progress: (_title, task) => task(),
      confirm: async (message, detail, button) => {
        log.push({ kind: 'confirm', message, detail, button });
        return answer;
      },
      warn: async (message, detail) => {
        log.push({ kind: 'warn', message, detail });
      },
    },
  };
}

await check('a clean enable is one call with no override and no prompt', async () => {
  const { client, calls } = scripted([okResult({ data: { id: 'w', is_enabled: true } })]);
  const { ui, log } = fakeUi(true);
  const outcome = await enableWorkflow(client, { id: 'w' }, ui);
  assert.deepEqual(outcome, { result: { data: { id: 'w', is_enabled: true } } });
  assert.deepEqual(calls, [{ id: 'w' }]);
  assert.equal(log.length, 0);
  assert.equal(enabledAnywayNote(outcome.result), null);
});

await check('422 workflow_invalid lists the issues; "Enable anyway" re-sends allow_incomplete:true', async () => {
  const { client, calls } = scripted([
    proxyError(422, INVALID),
    okResult({ data: { id: 'w', is_enabled: true, validation: { ok: false, errors: 1, warnings: 0, issues: INVALID.issues } } }),
  ]);
  const { ui, log } = fakeUi(true);
  const outcome = await enableWorkflow(client, { id: 'w' }, ui);
  assert.deepEqual(calls, [{ id: 'w' }, { id: 'w', allow_incomplete: true }]);
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, 'confirm');
  assert.equal(log[0].button, 'Enable anyway');
  assert.match(log[0].message, /^Lead alert has 1 problem to fix/);
  assert.match(log[0].detail, /missing required field "webhookUrl"/);
  assert.match(enabledAnywayNote(outcome.result), /^Enabled anyway - 1 problem remains/);
});

await check('declining the override stops after one call', async () => {
  const { client, calls } = scripted([proxyError(422, INVALID)]);
  const { ui } = fakeUi(false);
  assert.equal(await enableWorkflow(client, { id: 'w' }, ui), null);
  assert.equal(calls.length, 1);
});

await check('an MCP server that drops allow_incomplete ends in a warning, not a loop', async () => {
  const { client, calls } = scripted([
    proxyError(422, INVALID),
    proxyError(422, INVALID, { dropped_params: ['allow_incomplete'], expected_params: ['id', 'workflow_id'] }),
  ]);
  const { ui, log } = fakeUi(true);
  assert.equal(await enableWorkflow(client, { id: 'w' }, ui), null);
  assert.equal(calls.length, 2);
  assert.deepEqual(log.map((entry) => entry.kind), ['confirm', 'warn']);
  assert.match(log[1].message, /does not accept "Enable anyway" yet/);
  assert.match(log[1].detail, /webhookUrl/);
});

await check('a refusal already marked dropped_params offers no override', async () => {
  const { client } = scripted([proxyError(422, INVALID, { dropped_params: ['allow_incomplete'] })]);
  const outcome = await workflowEnable(client, 'w', false);
  assert.equal(outcome.enabled, false);
  assert.equal(outcome.refusal.overrideUnavailable, true);
});

await check('other refusals still throw, with the message and name a plain Error had', async () => {
  const { client } = scripted([proxyError(422, { error: 'unbound_project_nodes', message: 'bind a project', nodes: [] })]);
  const { ui } = fakeUi(true);
  await assert.rejects(enableWorkflow(client, { id: 'w' }, ui), (err) => {
    assert.ok(err instanceof McpToolError);
    assert.equal(err.name, 'Error');
    assert.match(err.message, /^Tool workflow_enable errored: \{"error":"unbound_project_nodes"/);
    return true;
  });
});

await check('the non-isError {error, status, details} payload is read the same way', async () => {
  const { client } = scripted([okResult({ error: 'workflow_invalid', status: 422, details: INVALID })]);
  const outcome = await workflowEnable(client, 'w');
  assert.equal(outcome.enabled, false);
  assert.equal(outcome.refusal.issues.length, 1);
  assert.equal(outcome.refusal.overrideUnavailable, false);
});

await check('a refusal without an issues array still reads as a sentence', async () => {
  const { client } = scripted([proxyError(422, { error: 'workflow_invalid' })]);
  const { ui, log } = fakeUi(false);
  assert.equal(await enableWorkflow(client, { id: 'w' }, ui), null);
  assert.match(log[0].message, /has some problems to fix/);
  assert.match(log[0].detail, /Run workflow_validate/);
});

console.log(`✓ ${n} workflow enable checks passed`);
