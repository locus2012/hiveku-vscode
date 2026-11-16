/**
 * The temporary environment wrappers in src/hivekuApi.ts send each project_vcs_temp_env* tool exactly its own
 * arguments (MCP feature/temporary-environments, builder #2247). A temporary environment shows one branch of a site on
 * its own address and Hiveku link for 1, 3 or 7 days, at 50 cents a day.
 *
 * Pinned on the wire, through a fake client:
 *   - the reads send only what was given, and a list answer without its array reads as empty;
 *   - the four that charge send dry_run and accept_cents only when the caller gave them, so a call never accepts a
 *     price on its own;
 *   - the passcode goes as password (the server takes no passcode argument), and null clears it;
 *   - the turn-off always sends confirm: true and the branch;
 *   - every write on one environment sends its branch.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

const api = loadOut('hivekuApi');

const P = '8f14e45f-ceea-467a-9575-2f3b5e6a1c01';
const E = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a';
const B = 'feature/pricing';

/** Calls `run` with a fake client that answers `answer` to `tool`, and returns the one call it saw. */
async function oneCall(tool, run, answer = {}) {
  const client = fakeClient({ [tool]: answer });
  const result = await run(client);
  assert.equal(client.seen.length, 1, `one call to ${tool}`);
  assert.equal(client.seen[0].name, tool);
  return { args: client.seen[0].args, result };
}

test('the reads send only what was given, and an answer without its list reads as empty', async () => {
  let call = await oneCall('project_vcs_temp_envs_list', (c) => api.vcsTempEnvs(c, P), { ready: false });
  assert.deepEqual(call.args, { project_id: P });
  assert.deepEqual(call.result, { environments: [], ready: false });
  call = await oneCall('project_vcs_temp_envs_list', (c) => api.vcsTempEnvs(c, P, B), { environments: [{ id: E }], ready: true });
  assert.deepEqual(call.args, { project_id: P, branch: B });
  assert.deepEqual(call.result, { environments: [{ id: E }], ready: true });

  call = await oneCall('project_vcs_temp_env_get', (c) => api.vcsTempEnvGet(c, P, E));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E });

  call = await oneCall('project_vcs_temp_envs_find', (c) => api.vcsTempEnvsFind(c));
  assert.deepEqual(call.args, {});
  call = await oneCall('project_vcs_temp_envs_find', (c) => api.vcsTempEnvsFind(c, { link: 'https://app.hiveku.com/share/site/k' }));
  assert.deepEqual(call.args, { link: 'https://app.hiveku.com/share/site/k' });
  call = await oneCall('project_vcs_temp_envs_find', (c) => api.vcsTempEnvsFind(c, { status: 'live', limit: 20 }));
  assert.deepEqual(call.args, { status: 'live', limit: 20 });

  call = await oneCall('project_vcs_temp_envs_requests_list', (c) => api.vcsTempEnvRequests(c, P), {});
  assert.deepEqual(call.args, { project_id: P });
  assert.deepEqual(call.result, []);
  call = await oneCall('project_vcs_temp_envs_requests_list', (c) => api.vcsTempEnvRequests(c, P, 'all'), { requests: [{ id: 'r' }] });
  assert.deepEqual(call.args, { project_id: P, status: 'all' });
  assert.deepEqual(call.result, [{ id: 'r' }]);

  call = await oneCall('project_vcs_temp_envs_usage_get', (c) => api.vcsTempEnvUsage(c, P));
  assert.deepEqual(call.args, { project_id: P });
});

test('the four that charge send dry_run and accept_cents only when given', async () => {
  let call = await oneCall('project_vcs_temp_env_create', (c) => api.vcsTempEnvCreate(c, P, B, { days: 3, dryRun: true }));
  assert.deepEqual(call.args, { project_id: P, branch: B, days: 3, dry_run: true });
  call = await oneCall('project_vcs_temp_env_create', (c) =>
    api.vcsTempEnvCreate(c, P, B, { days: 7, password: 'open sesame', allowFeedback: false, label: 'Pricing', requestId: 'r', acceptCents: 350 }),
  );
  assert.deepEqual(call.args, {
    project_id: P, branch: B, days: 7, password: 'open sesame', allow_feedback: false, label: 'Pricing', request_id: 'r', accept_cents: 350,
  });
  call = await oneCall('project_vcs_temp_env_create', (c) => api.vcsTempEnvCreate(c, P, B));
  assert.deepEqual(call.args, { project_id: P, branch: B }, 'no price is accepted unless the caller passes one');

  call = await oneCall('project_vcs_temp_env_extend', (c) => api.vcsTempEnvExtend(c, P, E, B, { dryRun: true }));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B, dry_run: true });
  call = await oneCall('project_vcs_temp_env_extend', (c) => api.vcsTempEnvExtend(c, P, E, B, { days: 1, acceptCents: 50 }));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B, days: 1, accept_cents: 50 });

  call = await oneCall('project_vcs_temp_env_revive', (c) => api.vcsTempEnvRevive(c, P, E, B, 3, { dryRun: true, requestId: 'r' }));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B, days: 3, request_id: 'r', dry_run: true });

  call = await oneCall('project_vcs_temp_env_try_again', (c) => api.vcsTempEnvTryAgain(c, P, E, B, { acceptCents: 150 }));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B, accept_cents: 150 });
});

test('the other writes send the branch, the passcode as password, and the turn-off with confirm', async () => {
  let call = await oneCall('project_vcs_temp_env_update', (c) => api.vcsTempEnvUpdate(c, P, E, B));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B });
  call = await oneCall('project_vcs_temp_env_update', (c) => api.vcsTempEnvUpdate(c, P, E, B, true));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B, rebuild: true });

  call = await oneCall('project_vcs_temp_env_password_set', (c) => api.vcsTempEnvPasswordSet(c, P, E, B, 'open sesame'));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B, password: 'open sesame' });
  call = await oneCall('project_vcs_temp_env_password_set', (c) => api.vcsTempEnvPasswordSet(c, P, E, B, null));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B, password: null }, 'null clears it, and is sent');

  call = await oneCall('project_vcs_temp_env_settings_set', (c) => api.vcsTempEnvSettingsSet(c, P, E, B, { allowFeedback: false, newLink: 'share' }));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B, allow_feedback: false, new_link: 'share' });

  call = await oneCall('project_vcs_temp_env_delete', (c) => api.vcsTempEnvDelete(c, P, E, B));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B, confirm: true });

  call = await oneCall('project_vcs_temp_env_request_dismiss', (c) => api.vcsTempEnvRequestDismiss(c, P, 'r', B));
  assert.deepEqual(call.args, { project_id: P, request_id: 'r', branch: B });

  call = await oneCall('project_vcs_temp_env_open', (c) => api.vcsTempEnvOpen(c, P, E, B, '/pricing'));
  assert.deepEqual(call.args, { project_id: P, temp_env_id: E, branch: B, next: '/pricing' });
});
