/**
 * HK-2244: every memory_list this extension makes where a row's text is read
 * or kept asks for the text by name (include_content: true): the knowledge
 * download's six typed listings, the Knowledge tab's listing with no filter,
 * and the department data download's memory dataset. A list with no filter may
 * one day come without each row's text.
 *
 * And no copy is kept of a row that still came without it (its `content` is
 * not a string; the builder then sends `content_chars`):
 *   - the knowledge download writes no file for it, and the file and manifest
 *     row the last download wrote stay as they were (not changed, not called
 *     deleted);
 *   - the Claude Code copy (.claude/skills, commands, agents) the last sync
 *     wrote stays as it was, owned: never rewritten, never removed as gone,
 *     and never taken by another entry.
 * A row whose text is "" is a real empty entry and is written as before.
 * Nothing here writes a listed row's text back to Hiveku: an edit in VS Code
 * reads its entry again with memory_get first (platformFs.ts).
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './helpers/vscode-stub.mjs';
import { loadOut, fakeClient } from './helpers/load.mjs';

const api = loadOut('hivekuApi');
const knowledge = loadOut('knowledge');
const commandSync = loadOut('commandSync');
const { DEPARTMENTS, fetchDataset } = loadOut('deptData');

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'hk-no-text-'));
const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.access(path.join(dir, rel)).then(() => true, () => false);

/** A row as the builder lists it without its text: no `content`, its length as `content_chars`. */
const withoutText = ({ content, ...row }) => ({ ...row, content_chars: content.length });

const listing = (byType) => fakeClient({ memory_list: (args) => ({ data: byType[args.type ?? 'all'] || [] }) });

const TONE = { id: 'r1', name: 'tone', domain: '_rule:tone', department: 'sales', content: 'Warm, never pushy.', version: 3 };
const PLAYBOOK = { id: 's1', name: 'discovery-call', domain: '_skill:discovery-call', department: 'sales', content: '# Discovery call\n\nRead the deal first.', version: 2 };

describe('every memory_list that reads or keeps text asks for it by name', () => {
  test('the knowledge download, one listing per type', async () => {
    const client = listing({ rule: [TONE] });
    await knowledge.fetchKnowledge(client);
    const lists = client.seen.filter((c) => c.name === 'memory_list');
    assert.equal(lists.length, 6);
    for (const { args } of lists) assert.deepEqual(Object.keys(args).sort(), ['include_content', 'type']);
    for (const { args } of lists) assert.equal(args.include_content, true);
    const one = listing({});
    await api.listMemory(one, 'skill');
    assert.deepEqual(one.seen, [{ name: 'memory_list', args: { type: 'skill', include_content: true } }]);
  });

  test('the Knowledge tab, the one listing with no filter', async () => {
    const client = listing({ all: [TONE] });
    const rows = await api.listMemoryAll(client);
    assert.equal(rows.length, 1);
    assert.deepEqual(client.seen, [{ name: 'memory_list', args: { include_content: true } }]);
  });

  test("the department data download's memory dataset", async () => {
    const ds = DEPARTMENTS.find((d) => d.id === 'knowledge').datasets.find((d) => d.id === 'memory');
    assert.deepEqual(ds.args, { include_content: true });
    const client = listing({ all: [TONE] });
    const result = await fetchDataset(client, ds);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(client.seen[0], { name: 'memory_list', args: { include_content: true } });
    const manifest = JSON.parse(await fs.readFile(new URL('../src/dept-manifest.json', import.meta.url), 'utf8'));
    const shipped = manifest.departments.find((d) => d.id === 'knowledge').datasets.find((d) => d.id === 'memory');
    assert.deepEqual(shipped.args, { include_content: true }, 'the manifest the plugin copies says the same');
  });
});

describe('a row Hiveku sent without its text is never kept', () => {
  test('the knowledge download writes no file for it, keeps what the last download wrote, and says which', async () => {
    const dir = await tmp();
    await knowledge.writeEntries(dir, knowledge.selectEntries(await knowledge.fetchKnowledge(listing({ rule: [TONE] }))));
    const rel = path.join('rules', 'sales', 'tone.md');
    const before = await read(dir, rel);
    const manifestBefore = JSON.parse(await read(dir, path.join('.hiveku', 'knowledge-manifest.json')));

    const blank = { id: 'r2', name: 'blank', domain: '_rule:blank', department: 'sales', content: '', version: 1 };
    const index = await knowledge.fetchKnowledge(listing({ rule: [withoutText(TONE), blank], memory: [withoutText({ id: 'm1', name: 'seo', domain: 'seo', department: 'seo', content: 'Leeds.', version: 1 })] }));
    const failed = [];
    const left = [];
    const n = await knowledge.writeEntries(dir, knowledge.selectEntries(index), failed, left);

    assert.equal(n, 1, 'only the empty entry is written');
    assert.equal(await read(dir, rel), before, 'the earlier copy is as it was');
    assert.equal(await exists(dir, path.join('memory', 'seo', 'seo.md')), false, 'never written, so never an empty copy');
    assert.ok((await read(dir, path.join('rules', 'sales', 'blank.md'))).endsWith('---\n'), 'an empty entry is written');
    assert.deepEqual(left.sort(), ['seo', 'tone']);
    assert.deepEqual(failed, []);
    const manifest = JSON.parse(await read(dir, path.join('.hiveku', 'knowledge-manifest.json')));
    assert.deepEqual(manifest.entries['_rule:tone'], manifestBefore.entries['_rule:tone']);
    assert.equal(manifest.entries.seo, undefined);

    // The drift check sees the kept copy as in sync, not deleted.
    const status = await knowledge.computeSyncStatus(listing({ rule: [withoutText(TONE), blank] }), dir);
    assert.deepEqual(status.deleted_remote, []);
    assert.deepEqual(status.locally_modified, []);
    assert.ok(status.in_sync >= 1);
  });

  test('the Claude Code copy the last sync wrote stays as it was, owned, and no other entry takes it', async () => {
    const dir = await tmp();
    const skill = path.join('.claude', 'skills', 'hiveku-sales-discovery-call', 'SKILL.md');
    await commandSync.syncAccountCommands(await knowledge.fetchKnowledge(listing({ skill: [PLAYBOOK] })), dir);
    const before = await read(dir, skill);
    const owned = JSON.parse(await read(dir, path.join('.hiveku', 'synced-commands.json')));

    // Sent without its text, now filed under SEO; a new Sales skill of the same name wants its old copy.
    const index = await knowledge.fetchKnowledge(
      listing({
        skill: [
          withoutText({ ...PLAYBOOK, department: 'seo' }),
          // Its domain reduces to the same copy name: hiveku-sales-discovery-call.
          { id: 's2', name: 'Discovery Call', domain: '_skill:Discovery Call', department: 'sales', content: '# Another\n\nSteps.', version: 1 },
        ],
      }),
    );
    const result = await commandSync.syncAccountCommands(index, dir);
    assert.equal(await read(dir, skill), before, 'never rewritten');
    assert.deepEqual(result.removed, [], 'never removed as gone upstream');
    assert.ok(result.leftWithoutText.includes(skill), JSON.stringify(result));
    assert.equal(await exists(dir, path.join('.claude', 'skills', 'hiveku-seo-discovery-call', 'SKILL.md')), false);
    const after = JSON.parse(await read(dir, path.join('.hiveku', 'synced-commands.json')));
    assert.deepEqual(after.files[skill], owned.files[skill], 'still owned, as it was');

    // When the text comes back, the copy is brought up to date as usual.
    await commandSync.syncAccountCommands(await knowledge.fetchKnowledge(listing({ skill: [{ ...PLAYBOOK, content: '# Discovery call\n\nRead the deal, then the notes.' }] })), dir);
    assert.match(await read(dir, skill), /then the notes\.\n$/);
  });

  test('a Claude Code copy no listed entry names any more is not removed as gone while its entry came without its text', async () => {
    const dir = await tmp();
    const skill = path.join('.claude', 'skills', 'hiveku-sales-discovery-call', 'SKILL.md');
    await commandSync.syncAccountCommands(await knowledge.fetchKnowledge(listing({ skill: [PLAYBOOK] })), dir);
    const before = await read(dir, skill);
    const owned = JSON.parse(await read(dir, path.join('.hiveku', 'synced-commands.json')));

    // Sent without its text and now filed under SEO, so this sync names a different copy for it and none for the old one.
    const result = await commandSync.syncAccountCommands(await knowledge.fetchKnowledge(listing({ skill: [withoutText({ ...PLAYBOOK, department: 'seo' })] })), dir);
    assert.equal(await read(dir, skill), before, 'the old copy is as it was');
    assert.deepEqual(result.removed, [], 'never removed as gone upstream');
    assert.deepEqual(result.written, []);
    assert.deepEqual(result.leftWithoutText, [skill]);
    assert.equal(await exists(dir, path.join('.claude', 'skills', 'hiveku-seo-discovery-call', 'SKILL.md')), false);
    const after = JSON.parse(await read(dir, path.join('.hiveku', 'synced-commands.json')));
    assert.deepEqual(after.files[skill], owned.files[skill], 'still owned, as it was');

    // An entry that is really gone is still removed as before.
    const gone = await commandSync.syncAccountCommands(await knowledge.fetchKnowledge(listing({})), dir);
    assert.deepEqual(gone.removed, [skill]);
  });
});
