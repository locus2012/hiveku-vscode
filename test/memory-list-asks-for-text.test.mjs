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
 *     and never taken by another entry: an entry with its text that wants
 *     that name gets its hashed name, so it is never left without a copy;
 *   - the words say what was not updated, that nothing in Hiveku changed, and
 *     are true with or without a copy here.
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

  test('a skill sent without its text keeps the plain name it holds, and the skill that had the hashed name keeps it and is updated', async () => {
    const dir = await tmp();
    const other = { id: 's2', name: 'Discovery Call', domain: '_skill:Discovery Call', department: 'sales', content: '# Another\n\nSteps.', version: 1 };
    // Both reduce to hiveku-sales-discovery-call: the one listed first takes it, the other its hashed name.
    await commandSync.syncAccountCommands(await knowledge.fetchKnowledge(listing({ skill: [PLAYBOOK, other] })), dir);
    const plain = path.join('.claude', 'skills', 'hiveku-sales-discovery-call', 'SKILL.md');
    const owned = JSON.parse(await read(dir, path.join('.hiveku', 'synced-commands.json')));
    const hashed = Object.keys(owned.files).find((rel) => owned.files[rel].domain === other.domain);
    assert.equal(owned.files[plain].domain, PLAYBOOK.domain, 'the first skill has the plain name');
    assert.match(hashed, /hiveku-sales-discovery-call-[0-9a-f]{6}/, 'the other has its hashed name');
    const plainBefore = await read(dir, plain);

    // The first now files under SEO and comes without its text; the other changed upstream.
    const index = await knowledge.fetchKnowledge(
      listing({ skill: [withoutText({ ...PLAYBOOK, department: 'seo' }), { ...other, content: '# Another\n\nNew steps.', version: 2 }] }),
    );
    const result = await commandSync.syncAccountCommands(index, dir);
    assert.equal(await read(dir, plain), plainBefore, 'the held copy is as it was');
    assert.match(await read(dir, hashed), /New steps\.\n$/, 'the other skill keeps its copy, brought up to date');
    assert.deepEqual(result.written, [hashed]);
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.leftWithoutText, [plain]);
    const after = JSON.parse(await read(dir, path.join('.hiveku', 'synced-commands.json')));
    assert.deepEqual(after.files[plain], owned.files[plain], 'the held copy is still owned, as it was');
    assert.equal(after.files[hashed].domain, other.domain);
  });

  test('an entry whose copy at its new name cannot be written keeps its earlier copy until it can', async () => {
    const dir = await tmp();
    const oldCopy = path.join('.claude', 'skills', 'hiveku-sales-discovery-call', 'SKILL.md');
    const newCopy = path.join('.claude', 'skills', 'hiveku-seo-discovery-call', 'SKILL.md');
    await commandSync.syncAccountCommands(await knowledge.fetchKnowledge(listing({ skill: [PLAYBOOK] })), dir);
    const before = await read(dir, oldCopy);
    // A file this sync did not write is where the moved skill's copy would go.
    await fs.mkdir(path.join(dir, path.dirname(newCopy)), { recursive: true });
    await fs.writeFile(path.join(dir, newCopy), 'Written by hand.\n', 'utf8');

    const moved = await knowledge.fetchKnowledge(listing({ skill: [{ ...PLAYBOOK, department: 'seo', version: 3 }] }));
    const result = await commandSync.syncAccountCommands(moved, dir);
    assert.deepEqual(result.skippedLocalEdits, [newCopy]);
    assert.deepEqual(result.removed, [], 'the only copy it has is not removed');
    assert.equal(await read(dir, oldCopy), before);
    assert.equal(await read(dir, newCopy), 'Written by hand.\n', 'a file this sync did not write is never touched');

    // Once the new name is free, the copy is written there and the earlier one goes.
    await fs.rm(path.join(dir, newCopy));
    const again = await commandSync.syncAccountCommands(moved, dir);
    assert.deepEqual(again.written, [newCopy]);
    assert.deepEqual(again.removed, [oldCopy]);
  });
});

describe('the words for entries Hiveku sent without their text', () => {
  test('the knowledge download: by name in the output, by count in the notification', () => {
    assert.equal(knowledge.notUpdatedLine([]), '');
    assert.equal(
      knowledge.notUpdatedLine(['tone']),
      'Did not update "tone": Hiveku sent it without its text. Nothing in Hiveku changed, and any copy here is as it was. Pull again to get it.',
    );
    assert.equal(
      knowledge.notUpdatedLine(['tone', 'sales', 'seo']),
      'Did not update 3 entries: Hiveku sent them without their text ("tone", "sales", "seo"). Nothing in Hiveku changed, and any copies here are as they were. Pull again to get them.',
    );
    assert.equal(
      knowledge.notUpdatedLine(['tone'], 'named in the Hiveku output'),
      'Did not update 1 entry: Hiveku sent it without its text (named in the Hiveku output). Nothing in Hiveku changed, and any copy here is as it was. Pull again to get it.',
    );
    assert.equal(
      knowledge.notUpdatedLine(['a', 'b'], 'named in the Hiveku output'),
      'Did not update 2 entries: Hiveku sent them without their text (named in the Hiveku output). Nothing in Hiveku changed, and any copies here are as they were. Pull again to get them.',
    );
    const many = Array.from({ length: 12 }, (_, i) => `r${i + 1}`);
    assert.match(knowledge.notUpdatedLine(many), /^Did not update 12 entries: .*\("r1", .*, "r10" and 2 more\)\. Nothing in Hiveku changed/);
  });

  test('command sync: the Claude Code copies it did not update', () => {
    const rel = path.join('.claude', 'skills', 'hiveku-sales-x', 'SKILL.md');
    assert.equal(commandSync.copiesNotUpdatedLine([]), '');
    assert.equal(
      commandSync.copiesNotUpdatedLine([rel]),
      `Did not update ${rel}: Hiveku sent its entry without its text. Nothing in Hiveku changed, and any copy here is as it was. Pull again to get it.`,
    );
    assert.equal(
      commandSync.copiesNotUpdatedLine([rel, rel], 'named in the Hiveku output'),
      'Did not update 2 Claude Code copies: Hiveku sent their entries without their text (named in the Hiveku output). Nothing in Hiveku changed, and any copies here are as they were. Pull again to get them.',
    );
  });
});
