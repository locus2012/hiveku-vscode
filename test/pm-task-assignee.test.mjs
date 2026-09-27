/**
 * "New task" in the Account Console, after projects and sections gained a
 * default assignee (builder PR #205).
 *
 * pm_tasks_create now tells three answers apart by the assigned_to_id KEY:
 *   - key absent  -> the section's default assignee, then the project's;
 *   - null / ''   -> the task is created unassigned;
 *   - an id       -> that person.
 * Before this change the "(unassigned)" pick sent no key at all, so a project
 * with a default assigned the task to someone while the picker said
 * "(unassigned)". Driven through the real createTaskFlow with a stub
 * showQuickPick, asserting the exact arguments that reach the tool.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetCalls, vscodeStub } from './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

const { createTaskFlow } = loadOut('console');
const api = loadOut('hivekuApi');
const knowledge = loadOut('knowledge');

const PROJECT_ID = '5d1c9a3e-2b4f-4e6a-9c8d-7f0a1b2c3d4e';
const ANA_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ASSIGN_PLACEHOLDER = 'Assign to';

let assignPick = null;
let assignItems = [];

function answersFor({ users = [{ id: ANA_ID, first_name: 'Ana', last_name: 'Diaz', email: 'ana@acme.test' }] } = {}) {
  return {
    pm_projects_list: { data: [{ id: PROJECT_ID, name: 'Launch' }] },
    crm_list_users: { users },
    pm_tasks_create: { data: { id: 'task-1' } },
  };
}

beforeEach(() => {
  resetCalls();
  assignPick = null;
  assignItems = [];
  vscodeStub.window.showInputBox = async (opts) => (opts?.prompt === 'Task title' ? 'Write the launch post' : '');
  vscodeStub.window.showQuickPick = async (items, opts) => {
    const list = await items;
    if (opts?.placeHolder === 'Project for the new task') return list[0];
    if (opts?.placeHolder === 'Priority') return '(default)';
    if (opts?.placeHolder === ASSIGN_PLACEHOLDER) {
      assignItems = list;
      return typeof assignPick === 'function' ? assignPick(list) : list.find((item) => item.label === assignPick);
    }
    throw new Error(`unexpected quick pick: ${opts?.placeHolder}`);
  };
});

const createCall = (client) => {
  const calls = client.seen.filter((c) => c.name === 'pm_tasks_create');
  assert.equal(calls.length, 1, 'exactly one pm_tasks_create call');
  return calls[0].args;
};

describe('New task: the assignee pick decides the assigned_to_id key', () => {
  test('"(unassigned)" sends an explicit null, so no default is applied', async () => {
    assignPick = '(unassigned)';
    const client = fakeClient(answersFor());
    assert.equal(await createTaskFlow(client), true);
    const args = createCall(client);
    assert.ok(Object.prototype.hasOwnProperty.call(args, 'assigned_to_id'), 'the key is present');
    assert.equal(args.assigned_to_id, null);
    assert.equal(args.project_id, PROJECT_ID);
    assert.equal(args.title, 'Write the launch post');
  });

  test('"(project default)" leaves the key out so the project default applies', async () => {
    assignPick = '(project default)';
    const client = fakeClient(answersFor());
    assert.equal(await createTaskFlow(client), true);
    const args = createCall(client);
    assert.equal(Object.prototype.hasOwnProperty.call(args, 'assigned_to_id'), false);
  });

  test('picking a person sends that id', async () => {
    assignPick = (list) => list.find((item) => item.id === ANA_ID);
    const client = fakeClient(answersFor());
    assert.equal(await createTaskFlow(client), true);
    assert.equal(createCall(client).assigned_to_id, ANA_ID);
  });

  test('the picker offers the project default first, then unassigned, then the people', async () => {
    assignPick = '(project default)';
    await createTaskFlow(fakeClient(answersFor()));
    assert.deepEqual(assignItems.map((item) => item.label), ['(project default)', '(unassigned)', 'Ana Diaz']);
  });

  test('escaping the picker creates nothing', async () => {
    assignPick = () => undefined;
    const client = fakeClient(answersFor());
    assert.equal(await createTaskFlow(client), false);
    assert.equal(client.seen.some((c) => c.name === 'pm_tasks_create'), false);
  });

  test('with no roster there is no picker and the key is left out', async () => {
    const client = fakeClient(answersFor({ users: [] }));
    assert.equal(await createTaskFlow(client), true);
    assert.deepEqual(assignItems, [], 'the assignee picker was not shown');
    assert.equal(Object.prototype.hasOwnProperty.call(createCall(client), 'assigned_to_id'), false);
  });
});

describe('pmTaskCreate carries null but still drops undefined and empty strings', () => {
  test('null reaches the tool; undefined and "" do not', async () => {
    const client = fakeClient({ pm_tasks_create: { data: { id: 'task-2' } } });
    await api.pmTaskCreate(client, 'T', PROJECT_ID, { assigned_to_id: null, description: '', priority: undefined });
    const args = client.seen[0].args;
    assert.deepEqual(args, { title: 'T', project_id: PROJECT_ID, assigned_to_id: null });
  });
});

/**
 * What the scaffolded CLAUDE.md / AGENTS.md and the department registry teach
 * about PM assignment. The old text said "Create tasks unassigned (omit
 * `assigned_to_id`)", which now hands the task to the default assignee, and
 * pointed only at crm_list_users, which lists one account on a shared project.
 */
describe('scaffolded instructions teach default assignees and the project roster', () => {
  const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
  const KEY = 'olp_test_key_123';
  const BASE = 'https://core.hiveku.com';

  async function scaffoldBoth() {
    knowledge.setCodexSupport(true);
    const account = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-pm-acct-'));
    await knowledge.writeScaffold({ baseDir: account, accountLabel: 'Acme', apiKey: KEY, baseUrl: BASE, accountId: ACCOUNT });
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-pm-proj-'));
    await knowledge.writeProjectScaffold({
      baseDir: project, accountLabel: 'Acme', apiKey: KEY, baseUrl: BASE, accountId: ACCOUNT,
      projectId: '11111111-2222-3333-4444-555555555555', projectName: 'Main site',
    });
    return { account, project };
  }

  test('every CLAUDE.md and AGENTS.md: null for unassigned, pm_project_team for ids, defaults settable', async () => {
    const { account, project } = await scaffoldBoth();
    let checked = 0;
    for (const dir of [account, project]) {
      for (const top of ['CLAUDE.md', 'AGENTS.md']) {
        const text = await fs.readFile(path.join(dir, top), 'utf8');
        const where = `${path.basename(dir)}/${top}`;
        assert.doesNotMatch(text, /unassigned \(omit `assigned_to_id`\)/, `${where} still says omit = unassigned`);
        assert.doesNotMatch(text, /Omit `assigned_to_id` only when/, `${where} still says omit when there is no USER_ID`);
        assert.match(text, /`assigned_to_id: null`/, `${where} names the explicit null`);
        assert.match(text, /`pm_project_team\(\{ project_id \}\)`/, `${where} names the project roster`);
        assert.match(text, /`crm_list_users` is this account's own team only/, `${where} scopes crm_list_users`);
        assert.match(text, /`pm_projects_update\(\{ id, default_assignee_id \}\)`/, `${where} sets a project default`);
        assert.match(text, /`pm_sections_update\(\{ project_id, section_id, default_assignee_id \}\)`/, `${where} sets a section default`);
        assert.match(text, /Moving\s+an unassigned task into a section with a default assigns it/, `${where} names the move rule`);
        assert.match(text, /review_assignee_id/, `${where} names the review assignee`);
        // review2 C2: the id comes with the setting, not from crm_list_users.
        assert.match(text, /take the id from `project_annotation_settings_get`'s `review_assignee\.people`/, `${where} names where the review assignee id comes from`);
        checked += 1;
      }
    }
    assert.equal(checked, 4);
  });

  test('pm_project_team is pre-approved as a read in the scaffolded settings', async () => {
    const { account } = await scaffoldBoth();
    const settings = JSON.parse(await fs.readFile(path.join(account, '.claude', 'settings.json'), 'utf8'));
    assert.ok(settings.permissions.allow.includes('mcp__hiveku__pm_project_team'));
  });

  test('the department registry: sections can be updated and deleted, defaults and the roster are named', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('../src/dept-manifest.json', import.meta.url), 'utf8'));
    const pm = manifest.departments.find((d) => d.id === 'pm');
    assert.doesNotMatch(pm.crud, /create-only/);
    assert.match(pm.crud, /`pm_sections_create` \(project_id \+ name \[\+ sort_order, default_assignee_id\]\) \/ `_update`/);
    assert.match(pm.crud, /\/ `_delete`\. Assignees: take ids from `pm_project_team`/);
    assert.match(pm.crud, /omit `assigned_to_id` to let the section's default assignee, then the project's, apply/);
    assert.match(pm.crud, /pass null \(or ''\) to create the task unassigned/);
    const review = manifest.departments.find((d) => d.id === 'review');
    assert.match(review.crud, /`review_assignee_id`: read it with `project_annotation_settings_get`, set it with `project_annotation_settings_set`/);
    assert.match(review.crud, /take the id from `project_annotation_settings_get`'s `review_assignee\.people`, which lists the team even before a PM project is linked/);
    assert.doesNotMatch(review.crud, /listed by `pm_project_team`\), else to the PM project's default assignee/);
    // One primary linked PM project (2026-09-27): the oldest that is not
    // archived, never an arbitrary one, and how to move it: unlink first,
    // archive only a finished project (archiving hides its open tasks).
    assert.match(review.crud, /Review feedback lands in the site's oldest linked PM project that is not archived \(`review_assignee\.pm_project`, even when `review_assignee\.linked_project_count` is above 1\)\./);
    // Round 8: EACH older one. With three or more linked projects, unlinking
    // only the oldest hands feedback to the next-oldest.
    assert.match(review.crud, /To move feedback, unlink each older one \(`pm_projects_update` with `website_project_id: null`\); archive it only when its work is finished, because archiving hides it and its open tasks from every list\./);
    assert.match(review.crud, /The review assignee must be on that project's team; `review_assignee\.stale` is true when the saved person is not \(they left, or they are only on another linked project's team\)\./);
    assert.match(review.crud, /When no linked project is left the next writer creates one, so read `review_assignee\.pm_project` rather than assuming a name\./);
    assert.doesNotMatch(review.crud, /archive or unlink/i);
    assert.doesNotMatch(review.crud, /arbitrar/i);
    for (const d of manifest.departments) {
      assert.doesNotMatch(`${d.crud ?? ''} ${d.setup ?? ''}`, /picks? one (of them )?arbitrarily/i, `${d.id}: still says a linked PM project is picked arbitrarily`);
      assert.doesNotMatch(`${d.crud ?? ''} ${d.setup ?? ''}`, /unlink the older (project|one)\b/i, `${d.id}: still says to unlink only the older project`);
    }
    assert.match(pm.crud, /take the id from `project_annotation_settings_get`'s `review_assignee\.people`/);
  });

  test('the vendored skills in assets/skills do not teach the retired linked-project rules', async () => {
    // assets/skills is the plugin's skills copied byte for byte by `npm run
    // gen:skills` and shipped in the extension. check:skills compares it with
    // the sibling plugin checkout, which can itself be stale, so the retired
    // sentences are scanned here too: a linked project "picked arbitrarily",
    // and archiving offered as the first way to move feedback.
    const root = fileURLToPath(new URL('../assets/skills/', import.meta.url));
    const files = [];
    const walk = async (dir) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(child);
        else if (entry.name.endsWith('.md')) files.push(child);
      }
    };
    await walk(root);
    assert.ok(files.some((f) => f.endsWith(path.join('hiveku-orient', 'SKILL.md'))), 'the vendored orient skill is missing');
    const offenders = [];
    for (const file of files) {
      const text = (await fs.readFile(file, 'utf8')).replace(/\s+/g, ' ');
      const rel = path.relative(root, file);
      if (/picks? one (of them )?arbitrarily/i.test(text)) offenders.push(`${rel}: a linked PM project picked arbitrarily`);
      if (/archive or unlink the old project/i.test(text)) offenders.push(`${rel}: archiving offered first`);
      // Round 7: only dashboard-created sites have "PM - <site>" from birth.
      // Sites made with site_create, site_create_external or site_clone start
      // with none, so a new link there becomes where feedback lands.
      if (/Linking a newer project does not move it\./.test(text)) offenders.push(`${rel}: a new link never moves feedback`);
      if (/"PM - <site>"[^.]*from (creation|the start)/i.test(text)) offenders.push(`${rel}: every site has "PM - <site>" from creation`);
      if (/no PM project yet/i.test(text)) offenders.push(`${rel}: "no PM project yet"`);
      // Round 8: a site cloned on the dashboard starts with none too; unlinking
      // only the oldest of three hands feedback to the next-oldest; and linking
      // an older existing project does move feedback (creation-date order).
      if (/created from the dashboard have[^.]*from birth/i.test(text)) offenders.push(`${rel}: a dashboard clone counted as born with "PM - <site>"`);
      if (/unlink the older (project|one)\b/i.test(text)) offenders.push(`${rel}: unlink only the older project`);
      if (/(a new link|linking a new one) does not move (it|feedback)/i.test(text)) offenders.push(`${rel}: a new link never moves feedback`);
    }
    assert.deepEqual(offenders, []);
    const orient = (await fs.readFile(path.join(root, 'hiveku-orient', 'SKILL.md'), 'utf8')).replace(/\s+/g, ' ');
    assert.ok(
      orient.includes(
        "Linking a project created after the site's current one does not move it, but linking an older one does: the rule goes by the project's creation date, not the link date. A cloned site (`site_clone` or the dashboard's Clone Project) or a site made with `site_create` or `site_create_external` has no linked PM project until the editor, the tasks page, a discussion convert or the first review comment creates one, and on a site with no linked project that is not archived the project you link becomes where feedback lands, so call `project_annotation_settings_get` before linking.",
      ),
      'the vendored orient skill does not say which sites start with no linked PM project, or that linking an older project moves feedback',
    );
    assert.ok(
      orient.includes('To move it, unlink each older one (`pm_projects_update` with `website_project_id: null`)'),
      'the vendored orient skill does not say to unlink each older project',
    );
  });
});
