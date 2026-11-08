/**
 * A folder the Hiveku desktop app manages holds no key (desktop offboarding O4): its .mcp.json names the key's variable,
 * Bearer ${HIVEKU_TOKEN}, which the app fills in for the chats and terminals it starts. The generated data runner must
 * read that variable as Claude Code does, and refuse with plain words when it is not set; the local automations'
 * scaffold must not copy the placeholder into automations/.env as if it were a key.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadOut } from './helpers/load.mjs';
import { readRequestText } from './helpers/request-body.mjs';

const dr = loadOut('dataRunner');
const la = loadOut('localAutomations');
const PLACEHOLDER = 'Bearer ${HIVEKU_TOKEN}';

let auths = [];
const server = createServer(async (req, res) => {
  auths.push(req.headers.authorization ?? null);
  const msg = JSON.parse(await readRequestText(req));
  res.writeHead(200, { 'content-type': 'application/json' });
  const result = msg.method === 'tools/call' ? { content: [{ type: 'text', text: JSON.stringify({ data: [] }) }] } : {};
  res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
});
let endpoint;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
});
after(() => server.close());

async function keylessFolder() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-keyless-'));
  await dr.writeDataRunner(dir);
  await fs.writeFile(
    path.join(dir, '.mcp.json'),
    JSON.stringify({ mcpServers: { hiveku: { url: endpoint, headers: { Authorization: PLACEHOLDER } } } }),
  );
  return dir;
}

function run(dir, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dir, '.hiveku', 'pull-data.mjs'), 'account'], { env });
    let stderr = '';
    child.stderr.on('data', (b) => (stderr += b));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

const withoutKey = () => {
  const env = { ...process.env };
  delete env.HIVEKU_TOKEN;
  return env;
};

describe('a folder that names its key instead of holding it', () => {
  test('the runner sends the key the environment holds', async () => {
    const dir = await keylessFolder();
    auths = [];
    await run(dir, { ...withoutKey(), HIVEKU_TOKEN: 'hvk_from_the_app' });
    assert.ok(auths.length > 0, 'the runner sent nothing');
    assert.deepEqual([...new Set(auths)], ['Bearer hvk_from_the_app']);
  });

  test('with no key in the environment the runner says where to run it, and sends nothing', async () => {
    const dir = await keylessFolder();
    auths = [];
    const { code, stderr } = await run(dir, withoutKey());
    assert.equal(code, 1);
    assert.match(stderr, /holds no Hiveku key/);
    assert.match(stderr, /opened in the Hiveku app/);
    assert.deepEqual(auths, []);
  });

  test('the automations scaffold copies no placeholder into its .env, and still copies a real key', async () => {
    const keyless = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-keyless-auto-'));
    await fs.writeFile(
      path.join(keyless, '.mcp.json'),
      JSON.stringify({ mcpServers: { hiveku: { url: endpoint, headers: { Authorization: PLACEHOLDER } } } }),
    );
    await la.scaffoldLocalAutomations(keyless);
    const keylessEnv = await fs.readFile(path.join(keyless, 'automations', '.env'), 'utf8');
    assert.match(keylessEnv, /^HIVEKU_MCP_KEY=$/m);
    assert.doesNotMatch(keylessEnv, /HIVEKU_TOKEN/);

    const keyed = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-keyed-auto-'));
    await fs.writeFile(
      path.join(keyed, '.mcp.json'),
      JSON.stringify({ mcpServers: { hiveku: { url: endpoint, headers: { Authorization: 'Bearer hvk_written_here' } } } }),
    );
    await la.scaffoldLocalAutomations(keyed);
    assert.match(await fs.readFile(path.join(keyed, 'automations', '.env'), 'utf8'), /^HIVEKU_MCP_KEY=hvk_written_here$/m);
  });

  test("an automation with no key of its own sends the one a Hiveku terminal gives it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hvk-keyless-lib-'));
    await fs.writeFile(path.join(dir, 'lib.mjs'), la.automationFiles()['automations/lib.mjs']);
    const lib = await import(pathToFileURL(path.join(dir, 'lib.mjs')).href);
    const saved = { url: process.env.HIVEKU_MCP_URL, key: process.env.HIVEKU_MCP_KEY, token: process.env.HIVEKU_TOKEN };
    process.env.HIVEKU_MCP_URL = endpoint;
    process.env.HIVEKU_MCP_KEY = '';
    process.env.HIVEKU_TOKEN = 'hvk_from_the_terminal';
    auths = [];
    try {
      await lib.hiveku('pm_tasks_list', {});
      assert.deepEqual([...new Set(auths)], ['Bearer hvk_from_the_terminal']);
    } finally {
      for (const [name, value] of [['HIVEKU_MCP_URL', saved.url], ['HIVEKU_MCP_KEY', saved.key], ['HIVEKU_TOKEN', saved.token]]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
