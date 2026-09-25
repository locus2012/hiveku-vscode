/**
 * Knowledge download and command sync file entries by DEPARTMENT, and the
 * department comes from the entry's stored domain, which any agent or API
 * caller on the account can write. Only a plain lowercase name may become a
 * directory (or part of a .claude/commands file name); any other domain files
 * under general, and nothing is written, or deleted, outside the account
 * folder.
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
});
