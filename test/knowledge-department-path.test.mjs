/**
 * Knowledge download and command sync file entries by DEPARTMENT, and the
 * department comes from the entry's stored domain, which any agent or API
 * caller on the account can write. Only a plain lowercase name may become a
 * directory (or part of a .claude/commands file name); any other domain files
 * under general, and nothing is written, or deleted, outside the account
 * folder. The file name comes from the same stored data, so one that names a
 * Windows device is renamed, and a row the disk refuses does not stop the rest.
 *
 * Hostile names are assembled from parts at run time and referred to by
 * placeholder ("a traversal name", "an absolute name").
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadOut, fakeClient } from './helpers/load.mjs';

const knowledge = loadOut('knowledge');
const commandSync = loadOut('commandSync');

const SLASH = String.fromCharCode(47);
const BACKSLASH = String.fromCharCode(92);
const UP = '.'.repeat(2);
/** A relative name that climbs `levels` directories, then names `tail`. */
const climb = (levels, tail, sep = SLASH) => [...Array(levels).fill(UP), tail].join(sep);
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A fresh parent dir holding the account folder, so escapes are observable. */
async function layout() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'hiveku-vsc-dept-path-'));
  const rootDir = path.join(parent, 'account');
  await fs.mkdir(rootDir);
  return { parent, rootDir };
}

async function listFiles(dir) {
  const out = [];
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...(await listFiles(abs)));
    else out.push(abs);
  }
  return out;
}

async function assertNothingOutside(parent, rootDir) {
  for (const file of await listFiles(parent)) {
    assert.ok(knowledge.isInsideRoot(rootDir, file), `wrote outside the folder: ${path.relative(parent, file)}`);
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function listingClient(listing) {
  return fakeClient({ memory_list: (args) => ({ data: listing[args.type] || [] }) });
}

describe('department names', () => {
  test('departmentOf keeps a plain department name', () => {
    for (const name of ['seo', 'sales', 'knowledge_base', 'email', 'ppc', 'content-ops']) {
      assert.equal(knowledge.departmentOf({ domain: name, content: '' }), name);
    }
    assert.equal(knowledge.departmentOf({ domain: '_command:x', content: '<!-- department: ppc -->' }), 'ppc');
    assert.equal(knowledge.departmentOf({ domain: '_identity:x', content: '<!-- department: SEO -->' }), 'seo');
    assert.equal(knowledge.departmentOf({ content: 'nothing' }), 'general');
  });

  test('departmentOf files a traversal name, an absolute name and other off-shape names under general', () => {
    const offShape = [
      climb(3, 'target'),
      climb(2, 'target', BACKSLASH),
      SLASH + ['tmp', 'target'].join(SLASH),
      'C:' + BACKSLASH + 'target',
      UP,
      'seo' + SLASH + 'sub',
      'crm_cf:field:one',
      'Sales',
      '1seo',
      '-seo',
      's'.repeat(51),
      'seo\n',
    ];
    offShape.forEach((domain, i) => {
      assert.equal(knowledge.departmentOf({ domain, content: '' }), 'general', `domain #${i} must file under general`);
    });
    assert.equal(knowledge.departmentOf({ domain: '_identity:x', content: `department: ${'t'.repeat(60)}` }), 'general');
  });

  test('a name Windows keeps for a device files under general; near-names are kept', () => {
    const devices = ['con', 'prn', 'aux', 'nul', 'com0', 'com1', 'com9', 'lpt0', 'lpt1', 'lpt9'];
    for (const domain of devices) {
      assert.equal(knowledge.departmentOf({ domain, content: '' }), 'general', `${domain} must file under general`);
    }
    // A content tag is lowercased first, so an uppercase device name is caught too.
    assert.equal(knowledge.departmentOf({ domain: '_command:x', content: '<!-- department: NUL -->' }), 'general');
    // With an extension it is still a device name on Windows.
    for (const name of ['nul.txt', 'CON', 'com1.md', 'lpt9.x.y']) assert.equal(knowledge.WINDOWS_DEVICE_NAME.test(name), true, name);
    // Negative control: names that only start like one are ordinary departments.
    for (const name of ['console', 'null', 'auxiliary', 'com10', 'lpt', 'connect', 'prn-team']) {
      assert.equal(knowledge.departmentOf({ domain: name, content: '' }), name);
    }
  });

  test('isInsideRoot: inside is true; the root itself, a prefix sibling, a climb and an absolute path are not', () => {
    const root = path.join(os.tmpdir(), 'hiveku-root-check');
    assert.equal(knowledge.isInsideRoot(root, path.join(root, 'memory', 'seo', 'a.md')), true);
    assert.equal(knowledge.isInsideRoot(root, root), false);
    assert.equal(knowledge.isInsideRoot(root, root + '-sibling' + path.sep + 'a.md'), false);
    assert.equal(knowledge.isInsideRoot(root, path.join(root, 'memory', climb(2, 'a.md'))), false);
    assert.equal(knowledge.isInsideRoot(root, path.join(os.tmpdir(), 'elsewhere', 'a.md')), false);
  });
});

describe('knowledge download', () => {
  test('a traversal-name domain is indexed and written under general, and nothing lands outside the folder', async () => {
    const { parent, rootDir } = await layout();
    const traversal = climb(2, 'outside');
    const absolute = path.join(parent, 'absolute-target');
    const client = listingClient({
      memory: [
        { id: 'p1', name: 'Planted note', domain: traversal, content: 'planted', version: 1 },
        { id: 'p2', name: 'Absolute note', domain: absolute, content: 'planted', version: 1 },
        // Negative control: a normal department keeps its own folder.
        { id: 'm1', name: 'Keyword strategy', domain: 'seo', content: 'target long-tail', version: 1 },
      ],
      rule: [{ id: 'r1', name: 'No emojis', domain: 'sales', content: 'never', version: 1 }],
    });

    const index = await knowledge.fetchKnowledge(client);
    assert.deepEqual([...index.keys()].sort(), ['general', 'sales', 'seo']);

    const n = await knowledge.writeEntries(rootDir, knowledge.selectEntries(index));
    assert.equal(n, 4);
    await assertNothingOutside(parent, rootDir);
    assert.equal(await exists(path.join(parent, 'outside')), false);
    assert.equal(await exists(absolute), false);
    assert.match(await fs.readFile(path.join(rootDir, 'memory', 'general', 'planted-note.md'), 'utf8'), /department: "general"/);
    await fs.access(path.join(rootDir, 'memory', 'general', 'absolute-note.md'));
    // Negative control: normal departments are untouched by the guard.
    assert.match(await fs.readFile(path.join(rootDir, 'memory', 'seo', 'keyword-strategy.md'), 'utf8'), /target long-tail/);
    await fs.access(path.join(rootDir, 'rules', 'sales', 'no-emojis.md'));
  });

  test('writeEntries never writes outside the folder, even for an entry whose department is a traversal name', async () => {
    const { parent, rootDir } = await layout();
    const entries = [
      { id: 'p1', name: 'Planted note', domain: 'x', content: 'planted', type: 'memory', department: climb(2, 'outside') },
      { id: 'm1', name: 'Keyword strategy', domain: 'seo', content: 'kept', type: 'memory', department: 'seo' },
    ];
    const n = await knowledge.writeEntries(rootDir, entries);
    await assertNothingOutside(parent, rootDir);
    assert.equal(n, 1);
    assert.equal(await exists(path.join(parent, 'outside')), false);
    await fs.access(path.join(rootDir, 'memory', 'seo', 'keyword-strategy.md'));
    const manifest = JSON.parse(await fs.readFile(path.join(rootDir, '.hiveku', 'knowledge-manifest.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest.entries), ['seo']);
  });

  test('safeFileStem renames a stem that names a Windows device and keeps every other stem', () => {
    assert.equal(knowledge.safeFileStem('com1'), 'com1-entry');
    assert.equal(knowledge.safeFileStem('nul'), 'nul-entry');
    // The part before the first dot decides, so the suffix goes there.
    assert.equal(knowledge.safeFileStem('nul.txt'), 'nul-entry.txt');
    assert.equal(knowledge.safeFileStem('lpt9.x.y'), 'lpt9-entry.x.y');
    for (const stem of ['con', 'prn', 'aux', 'nul', 'com0', 'com9', 'lpt0', 'lpt9', 'nul.txt', 'con.md']) {
      assert.equal(knowledge.WINDOWS_DEVICE_NAME.test(`${knowledge.safeFileStem(stem)}.md`), false, stem);
    }
    // Negative control: near-names and ordinary stems are unchanged.
    for (const stem of ['console', 'null', 'auxiliary', 'com10', 'lpt', 'connect', 'prn-team', 'keyword-strategy', 'unnamed']) {
      assert.equal(knowledge.safeFileStem(stem), stem);
    }
  });

  test('an entry whose file name would be a Windows device is written under a safe name, and later downloads agree', async () => {
    const { rootDir } = await layout();
    const client = listingClient({
      memory: [
        // A plain memory row: the server sets its name to its domain.
        { id: 'd1', name: 'com1', domain: 'com1', content: 'device-named domain', version: 1 },
        // Negative controls: near-names keep their own folder and file name.
        { id: 'n1', name: 'console', domain: 'console', content: 'near-name', version: 1 },
        { id: 'n2', name: 'com10', domain: 'com10', content: 'near-name', version: 1 },
      ],
      skill: [{ id: 'd2', name: 'nul', domain: '_skill:nul', content: 'device-named skill', version: 1 }],
    });

    const failed = [];
    assert.equal(await knowledge.writeEntries(rootDir, knowledge.selectEntries(await knowledge.fetchKnowledge(client)), failed), 4);
    assert.deepEqual(failed, []);
    const deviceFile = path.join(rootDir, 'memory', 'general', 'com1-entry.md');
    const skillFile = path.join(rootDir, 'skills', 'general', 'nul-entry.md');
    assert.match(await fs.readFile(deviceFile, 'utf8'), /device-named domain/);
    assert.match(await fs.readFile(skillFile, 'utf8'), /device-named skill/);
    assert.match(await fs.readFile(path.join(rootDir, 'memory', 'console', 'console.md'), 'utf8'), /near-name/);
    await fs.access(path.join(rootDir, 'memory', 'com10', 'com10.md'));
    const filesAfterFirst = (await listFiles(rootDir)).sort();
    for (const file of filesAfterFirst) {
      assert.equal(knowledge.WINDOWS_DEVICE_NAME.test(path.basename(file)), false, `device-named file: ${path.relative(rootDir, file)}`);
    }
    const manifest = JSON.parse(await fs.readFile(path.join(rootDir, '.hiveku', 'knowledge-manifest.json'), 'utf8'));
    assert.equal(manifest.entries.com1.file, 'memory/general/com1-entry.md');
    assert.equal(manifest.entries['_skill:nul'].file, 'skills/general/nul-entry.md');

    // The next download writes the same files: nothing added beside them.
    assert.equal(await knowledge.writeEntries(rootDir, knowledge.selectEntries(await knowledge.fetchKnowledge(client))), 4);
    assert.deepEqual((await listFiles(rootDir)).sort(), filesAfterFirst);

    // The status check reads the files the manifest names: all four are in sync.
    const status = await knowledge.computeSyncStatus(client, rootDir);
    assert.equal(status.in_sync, 4);
    assert.deepEqual([status.missing_local, status.locally_modified, status.deleted_remote], [[], [], []]);
  });

  test('a row the disk refuses is reported and the rest of the download still lands', async () => {
    const { rootDir } = await layout();
    const row = (id, name, domain, department, content, version, type = 'memory') => ({ id, name, domain, content, version, type, department });
    const seoFile = path.join(rootDir, 'memory', 'seo', 'keyword-strategy.md');
    await knowledge.writeEntries(rootDir, [
      row('m1', 'Keyword strategy', 'seo', 'seo', 'first', 1),
      row('m2', 'Pipeline rules', 'sales', 'sales', 'first', 1),
    ]);
    const manifestPath = path.join(rootDir, '.hiveku', 'knowledge-manifest.json');
    const first = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

    // Two rows this disk cannot take: a department folder that cannot be
    // created (a file is in the way), and an entry file that cannot be written
    // (a folder is in the way). Both come first, so the rest shows the download
    // carried on.
    await fs.writeFile(path.join(rootDir, 'memory', 'ppc'), 'in the way', 'utf8');
    await fs.rename(seoFile, seoFile + '.kept');
    await fs.mkdir(seoFile);
    const failed = [];
    const n = await knowledge.writeEntries(
      rootDir,
      [
        row('m3', 'Bid notes', 'ppc', 'ppc', 'second', 1),
        row('m1', 'Keyword strategy', 'seo', 'seo', 'second', 2),
        row('m2', 'Pipeline rules', 'sales', 'sales', 'second', 2),
        row('r1', 'No emojis', 'email', 'email', 'never', 1, 'rule'),
      ],
      failed,
    );

    assert.equal(n, 2);
    assert.deepEqual(failed, ['ppc', 'seo']);
    assert.match(await fs.readFile(path.join(rootDir, 'memory', 'sales', 'pipeline-rules.md'), 'utf8'), /second/);
    await fs.access(path.join(rootDir, 'rules', 'email', 'no-emojis.md'));
    // A write that failed is not a deletion: the last download's row is kept.
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.deepEqual(manifest.entries.seo, first.entries.seo);
    assert.equal(Object.hasOwn(manifest.entries, 'ppc'), false);
    assert.equal(manifest.entries.sales.version, 2);
  });
});

describe('account command sync', () => {
  const commandIndex = (department, entry) =>
    new Map([[department, new Map([['command', [{ ...entry, type: 'command', department }]]])]]);

  test('a command filed under a traversal-name department is not written outside the folder', async () => {
    const { parent, rootDir } = await layout();
    // "hiveku-" prefixes the first climb, so one more is needed to leave the folder.
    const index = commandIndex(climb(5, 'outside'), { id: 'c1', domain: '_command:deploy', name: 'Deploy', content: 'run it' });
    const normal = commandIndex('seo', { id: 'c2', domain: '_command:audit', name: 'Audit', content: 'check it' });
    for (const [dept, byType] of normal) index.set(dept, byType);

    const result = await commandSync.syncAccountCommands(index, rootDir);
    await assertNothingOutside(parent, rootDir);
    // Negative control: a normal department's command still lands where Claude Code finds it.
    assert.deepEqual(result.written, [path.join('.claude', 'commands', 'hiveku-seo-audit.md')]);
    await fs.access(path.join(rootDir, '.claude', 'commands', 'hiveku-seo-audit.md'));
  });

  test('a command manifest row that points outside the folder never deletes that file', async () => {
    const { parent, rootDir } = await layout();
    const victim = path.join(parent, 'victim.md');
    const victimBody = 'a file that belongs to someone else\n';
    await fs.writeFile(victim, victimBody, 'utf8');
    const ownedRel = path.join('.claude', 'commands', 'hiveku-seo-old.md');
    const ownedBody = 'old command\n';
    await fs.mkdir(path.join(rootDir, '.claude', 'commands'), { recursive: true });
    await fs.writeFile(path.join(rootDir, ownedRel), ownedBody, 'utf8');
    const at = '2026-09-25T00:00:00.000Z';
    await fs.mkdir(path.join(rootDir, '.hiveku'), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, '.hiveku', 'synced-commands.json'),
      JSON.stringify({
        files: {
          [climb(1, 'victim.md')]: { domain: '_command:x', content_sha: sha256(victimBody), synced_at: at },
          [ownedRel]: { domain: '_command:old', content_sha: sha256(ownedBody), synced_at: at },
        },
      }),
      'utf8',
    );

    // Nothing upstream: both rows are "gone remotely".
    const result = await commandSync.syncAccountCommands(new Map(), rootDir);
    assert.equal(await fs.readFile(victim, 'utf8'), victimBody);
    // Negative control: an owned file inside the folder is still removed.
    assert.deepEqual(result.removed, [ownedRel]);
    assert.equal(await exists(path.join(rootDir, ownedRel)), false);
    const manifest = JSON.parse(await fs.readFile(path.join(rootDir, '.hiveku', 'synced-commands.json'), 'utf8'));
    assert.deepEqual(manifest.files, {});
  });

  test('a command or agent whose slug names a Windows device keeps the file name older builds gave it', async () => {
    const { rootDir } = await layout();
    const index = new Map([
      [
        'general',
        new Map([
          ['command', [{ id: 'c1', domain: '_command:nul', name: 'Nul', content: 'run it', type: 'command', department: 'general' }]],
          ['agent', [{ id: 'a1', domain: '_agent:con', name: 'Con', content: 'be it', type: 'agent', department: 'general' }]],
        ]),
      ],
    ]);
    const first = await commandSync.syncAccountCommands(index, rootDir);
    // No file the sync writes is named like a device...
    for (const rel of first.written) {
      assert.equal(knowledge.WINDOWS_DEVICE_NAME.test(path.basename(rel)), false, `device-named file: ${rel}`);
    }
    // ...and the "hiveku-" prefix keeps these names as they were, so a folder
    // synced by an older build keeps its files and slash commands.
    assert.deepEqual(first.written, [
      path.join('.claude', 'commands', 'hiveku-general-nul.md'),
      path.join('.claude', 'agents', 'hiveku-con.md'),
    ]);
    const again = await commandSync.syncAccountCommands(index, rootDir);
    assert.deepEqual([again.written, again.removed, again.skippedLocalEdits], [[], [], []]);
    assert.deepEqual(await fs.readdir(path.join(rootDir, '.claude', 'commands')), ['hiveku-general-nul.md']);
    assert.deepEqual(await fs.readdir(path.join(rootDir, '.claude', 'agents')), ['hiveku-con.md']);
  });
});

/**
 * Older builds kept a department tag's case (hiveku-SEO-audit.md); this one
 * lowercases it (hiveku-seo-audit.md). On a case-insensitive disk, the macOS
 * and Windows default, those two names are one file, and the first sync after
 * the upgrade used to delete it as "gone upstream". Each test holds on both
 * kinds of disk; `insensitive` picks the expectations that differ.
 */
describe('account command sync across a department case change', () => {
  const commandIndex = (department, entry) =>
    new Map([[department, new Map([['command', [{ ...entry, type: 'command', department }]]])]]);
  const audit = (content) => ({ id: 'c1', domain: '_command:audit', name: 'Audit', content });
  const oldRel = path.join('.claude', 'commands', 'hiveku-SEO-audit.md');
  const newRel = path.join('.claude', 'commands', 'hiveku-seo-audit.md');
  const readManifestKeys = async (rootDir) =>
    Object.keys(JSON.parse(await fs.readFile(path.join(rootDir, '.hiveku', 'synced-commands.json'), 'utf8')).files);

  async function caseInsensitive(dir) {
    const probe = path.join(dir, 'Case-Probe');
    await fs.writeFile(probe, '', 'utf8');
    const insensitive = await exists(path.join(dir, 'case-probe'));
    await fs.unlink(probe);
    return insensitive;
  }

  /** A folder synced by an older build that filed the command under "SEO". */
  async function upgradedFolder(content) {
    const { rootDir } = await layout();
    const first = await commandSync.syncAccountCommands(commandIndex('SEO', audit(content)), rootDir);
    assert.deepEqual(first.written, [oldRel]);
    return { rootDir, insensitive: await caseInsensitive(rootDir) };
  }

  test('an unchanged command is still there after the first sync, and the next sync is quiet', async () => {
    const { rootDir, insensitive } = await upgradedFolder('Run the audit.');
    const result = await commandSync.syncAccountCommands(commandIndex('seo', audit('Run the audit.')), rootDir);
    assert.match(await fs.readFile(path.join(rootDir, newRel), 'utf8'), /Run the audit\./);
    assert.deepEqual(result.skippedLocalEdits, []);
    if (insensitive) {
      assert.deepEqual(result.removed, []);
      assert.equal((await fs.readdir(path.join(rootDir, '.claude', 'commands'))).length, 1);
    } else {
      // Two files on this disk: the old spelling is removed, the new one written.
      assert.deepEqual(result.written, [newRel]);
      assert.deepEqual(result.removed, [oldRel]);
    }
    assert.deepEqual(await readManifestKeys(rootDir), [newRel]);

    const again = await commandSync.syncAccountCommands(commandIndex('seo', audit('Run the audit.')), rootDir);
    assert.deepEqual([again.written, again.removed, again.skippedLocalEdits], [[], [], []]);
    await fs.access(path.join(rootDir, newRel));
  });

  test('a command that also changed upstream is updated, not reported as a local edit', async () => {
    const { rootDir, insensitive } = await upgradedFolder('Run the audit.');
    const result = await commandSync.syncAccountCommands(commandIndex('seo', audit('Run the audit, then report.')), rootDir);
    assert.deepEqual(result.skippedLocalEdits, []);
    assert.deepEqual(result.written, [newRel]);
    assert.deepEqual(result.removed, insensitive ? [] : [oldRel]);
    assert.match(await fs.readFile(path.join(rootDir, newRel), 'utf8'), /then report\./);
    assert.deepEqual(await readManifestKeys(rootDir), [newRel]);
  });

  test('a command removed by hand before the upgrade is written again and stays', async () => {
    const { rootDir } = await upgradedFolder('Run the audit.');
    await fs.unlink(path.join(rootDir, oldRel));
    const result = await commandSync.syncAccountCommands(commandIndex('seo', audit('Run the audit.')), rootDir);
    assert.deepEqual(result.written, [newRel]);
    assert.deepEqual(result.removed, []);
    assert.match(await fs.readFile(path.join(rootDir, newRel), 'utf8'), /Run the audit\./);
    assert.deepEqual(await readManifestKeys(rootDir), [newRel]);
  });

  test('a command the user edited is left as edited and reported', async () => {
    const { rootDir } = await upgradedFolder('Run the audit.');
    const edited = (await fs.readFile(path.join(rootDir, oldRel), 'utf8')) + 'My own note.\n';
    await fs.writeFile(path.join(rootDir, oldRel), edited, 'utf8');
    const result = await commandSync.syncAccountCommands(commandIndex('seo', audit('Run the audit, then report.')), rootDir);
    assert.deepEqual(result.removed, []);
    assert.equal(result.skippedLocalEdits.length, 1);
    assert.equal(await fs.readFile(path.join(rootDir, oldRel), 'utf8'), edited);
  });
});
