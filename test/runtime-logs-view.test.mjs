/**
 * "Show logs" on a deployed tier shows its runtime side, not only the build
 * (plan C3; builder #987 and MCP #185 live 2026-10-09).
 *
 * Pinned:
 *   - the errors come grouped by signature from project_log_errors for that tier, then the newest
 *     runtime lines from project_logs_get (source runtime, the last hour);
 *   - both sections say the text is redacted and untrusted;
 *   - a refusal (no hosting permission, logs unavailable) is one line, and the other section and
 *     the build log still show;
 *   - a deployment error that arrives as an object prints its message, never [object Object].
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetCalls } from './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

const resources = loadOut('resources');
const api = loadOut('hivekuApi');

const PROJECT = '11111111-1111-4111-8111-111111111111';

const ERRORS = {
  data: {
    errors: [
      {
        signature: "TypeError: Cannot read properties of undefined (reading '<id>')",
        level: 'error',
        count: 7,
        first_seen: '2026-10-09T10:00:00Z',
        last_seen: '2026-10-09T22:59:00Z',
        sample: "TypeError: Cannot read properties of undefined (reading 'price')",
        example_request_id: '6a7b8c9d-0000-4000-8000-000000000001',
      },
    ],
    truncated: false,
  },
};
const LINES = {
  data: {
    entries: [
      { time: '2026-10-09T23:01:00Z', level: 'error', request_id: '6a7b8c9d-0000-4000-8000-000000000001', message: 'GET /checkout failed' },
      { time: '2026-10-09T23:00:00Z', level: 'info', request_id: null, message: 'ready' },
    ],
  },
};

beforeEach(() => resetCalls());

describe('the API helpers', () => {
  test('logErrors asks project_log_errors for the tier and maps the groups', async () => {
    const client = fakeClient({ project_log_errors: ERRORS });
    const out = await api.logErrors(client, PROJECT, 'staging');
    assert.deepEqual(client.seen, [{ name: 'project_log_errors', args: { project_id: PROJECT, environment: 'staging' } }]);
    assert.equal(out.errors[0].count, 7);
    assert.equal(out.errors[0].exampleRequestId, '6a7b8c9d-0000-4000-8000-000000000001');
  });

  test('runtimeLogs reads the runtime source of the tier for the last hour', async () => {
    const client = fakeClient({ project_logs_get: LINES });
    const out = await api.runtimeLogs(client, PROJECT, 'production');
    assert.deepEqual(client.seen[0], {
      name: 'project_logs_get',
      args: { project_id: PROJECT, source: 'runtime', environment: 'production', since: '1h', limit: 50 },
    });
    assert.equal(out.length, 2);
    assert.equal(out[1].requestId, null);
  });
});

describe('the runtime section', () => {
  test('errors first, then the newest lines, both labelled untrusted', async () => {
    const client = fakeClient({ project_log_errors: ERRORS, project_logs_get: LINES });
    const lines = await resources.runtimeSection(client, PROJECT, 'production');
    const text = lines.join('\n');
    assert.ok(text.indexOf('runtime errors, last 24 hours') < text.indexOf('newest runtime lines'));
    assert.equal((text.match(/untrusted text/g) || []).length, 2);
    assert.match(text, /7x \[error\] TypeError/);
    assert.match(text, /request 6a7b8c9d-0000-4000-8000-000000000001/);
    assert.match(text, /\[6a7b8c9d\] GET \/checkout failed/);
  });

  test('a refusal is one line and the other section still shows', async () => {
    const client = fakeClient({
      project_log_errors: new Error('403 forbidden: needs websites.hosting read'),
      project_logs_get: LINES,
    });
    const text = (await resources.runtimeSection(client, PROJECT, 'staging')).join('\n');
    assert.match(text, /runtime errors: not available \(403 forbidden: needs websites\.hosting read\)/);
    assert.match(text, /GET \/checkout failed/);
  });
});

describe('show logs on a deployed tier', () => {
  test('the build log, then the runtime side; an error object prints its message', async () => {
    const client = fakeClient({
      deploy_status: { data: { most_recent: { deployment_id: 'dep-1', status: 'ready', build_logs: 'BUILD OK', url: 'https://acme.example' } } },
      project_log_errors: ERRORS,
      project_logs_get: LINES,
    });
    const shown = [];
    const output = { clear() {}, appendLine: (t) => shown.push(t), show() {} };
    await resources.showEnvLogs({ accountId: 'acc', projectId: PROJECT, env: 'production' }, async () => client, output);
    const text = shown.join('\n');
    assert.ok(text.indexOf('BUILD OK') < text.indexOf('runtime errors, last 24 hours'));
    assert.ok(client.seen.some((c) => c.name === 'project_log_errors' && c.args.environment === 'production'));
  });

  test('a failed deployment whose error is an object shows its message', async () => {
    const client = fakeClient({
      deploy_status: { data: { most_recent: { deployment_id: 'dep-2', status: 'failed', error: { message: 'Build step 3 failed' } } } },
      deploy_get: { data: { deployment_id: 'dep-2', status: 'failed', error: { message: 'Build step 3 failed' } } },
      project_build_error_get: { data: {} },
      project_log_errors: ERRORS,
      project_logs_get: LINES,
    });
    const shown = [];
    const output = { clear() {}, appendLine: (t) => shown.push(t), show() {} };
    await resources.showEnvLogs({ accountId: 'acc', projectId: PROJECT, env: 'production' }, async () => client, output);
    const text = shown.join('\n');
    assert.match(text, /Build step 3 failed/);
    assert.doesNotMatch(text, /\[object Object\]/);
  });
});
