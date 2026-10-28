/**
 * Files that hold the Hiveku key or one computer's secrets never leave the
 * folder: walkFiles (the change set, the manifest, every push) skips them by
 * name at any depth. Hiveku refuses them too (the builder's
 * protected-project-paths.ts); skipping them here means a push never sends
 * them. Example files and the site's code still go.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadOut } from './helpers/load.mjs';

const { walkFiles, isIgnoredPath } = loadOut('workspace');

test('isIgnoredPath: a skipped name anywhere in the path, the file name included', () => {
  for (const p of ['.env', '.envrc', 'apps/web/.env.local', '.codex/config.toml', 'dist/app.js', '.claude/settings.local.json']) {
    assert.equal(isIgnoredPath(p), true, p);
  }
  for (const p of ['src/app/page.tsx', '.env.example', 'docs/env.md', 'public/.well-known/x.txt']) {
    assert.equal(isIgnoredPath(p), false, p);
  }
});

test("walkFiles skips key files and one computer's secret files at any depth", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hiveku-local-only-'));
  const files = [
    'src/app/page.tsx',
    '.env.example',
    '.mcp.json',
    '.codex/config.toml',
    'apps/web/.codex/config.toml',
    '.claude/settings.local.json',
    '.env.local',
    '.env.development.local',
    'apps/web/.env.production.local',
    '.env.test.local',
    '.env.hiveku',
    '.envrc',
    '.dev.vars',
    '.dev.vars.local',
  ];
  try {
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), 'x');
    }
    assert.deepEqual((await walkFiles(root)).sort(), ['.env.example', 'src/app/page.tsx']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
