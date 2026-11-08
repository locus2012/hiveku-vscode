/**
 * HK-1373: each automations folder gets its own background job on a Mac.
 *
 * automations/manage.mjs used to name its launchd job after the first 6 bytes of the
 * folder's path, the same for every path under /Users, so every account on one Mac shared
 * one job: a second account's install replaced the first's, and Stop monitoring or Delete
 * locally on any account stopped them all. Now the whole path names the job, and a job left
 * under the old name is moved or removed only when its own paths are exactly this folder's.
 *
 * The generated manage.mjs really runs here, as a child process, against two stand-ins:
 *   - HOME is a temporary folder, so ~/Library/LaunchAgents is a temporary folder;
 *   - PATH holds only a stub launchctl that records what it was asked to do.
 * The child gets exactly the variables named in sandboxEnv and nothing from this process.
 * The script is refused before anything runs if it finds launchctl or the home folder any
 * other way, and the last test proves the real LaunchAgents folder did not change. All of
 * that lives in this file, not in the script, so a break check on the script cannot take
 * it away.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOut } from './helpers/load.mjs';

const la = loadOut('localAutomations');
const { 'automations/manage.mjs': MANAGE, 'automations/lib.mjs': LIB } = la.automationFiles();

// The stand-ins work only while the script finds launchctl by name on PATH and the home
// folder through homedir(), which reads HOME. A script that goes around them never runs.
assert.match(MANAGE, /spawnSync\('launchctl', \['unload'/, 'launchctl is called by name');
assert.match(MANAGE, /join\(homedir\(\), 'Library', 'LaunchAgents'/, 'the jobs folder comes from homedir()');
assert.doesNotMatch(
  MANAGE,
  /\/(usr\/)?s?bin\/launchctl|userInfo|['"]\/Users\/|['"]\/Library\//,
  'the script must not name a real launchctl or a real folder',
);

// Read only: the real jobs folder of whoever runs this, taken before any test runs.
const REAL_AGENTS = path.join(os.homedir(), 'Library', 'LaunchAgents');
function realAgentJobs() {
  try {
    return fs
      .readdirSync(REAL_AGENTS)
      .filter((name) => name.startsWith('com.hiveku.automations.'))
      .sort()
      .map((name) => `${name} ${fs.statSync(path.join(REAL_AGENTS, name)).mtimeMs}`);
  } catch {
    return [];
  }
}
const REAL_BEFORE = realAgentJobs();

const PREFIX = 'com.hiveku.automations.';
/** The ticket's label: the first 12 hex characters of the whole path's SHA-256. */
const label = (root) => PREFIX + createHash('sha256').update(root.normalize('NFC')).digest('hex').slice(0, 12);
/** The name every job used to get: the hex of the path's first 6 bytes. */
const oldLabel = (root) => PREFIX + Buffer.from(root).toString('hex').slice(0, 12);

/** What the previous manage.mjs wrote, unescaped paths included. */
function oldPlist(root) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n' +
    `  <key>Label</key><string>${oldLabel(root)}</string>\n` +
    `  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/node</string><string>${root}/dispatcher.mjs</string></array>\n` +
    `  <key>WorkingDirectory</key><string>${root}</string>\n` +
    '  <key>StartInterval</key><integer>60</integer>\n  <key>RunAtLoad</key><true/>\n' +
    `  <key>StandardOutPath</key><string>${root}/logs/dispatcher.log</string>\n` +
    `  <key>StandardErrorPath</key><string>${root}/logs/dispatcher.log</string>\n</dict></plist>\n`
  );
}

// process.platform decides the launchd or crontab branch; this keeps the launchd branch
// under test on any machine (it changes nothing on a Mac).
const FORCE_DARWIN = '--import=data:text/javascript,Object.defineProperty(process,%22platform%22,{value:%22darwin%22})';

function makeSandbox() {
  // Realpath: on a Mac the temp folder sits behind a symlink, and the script sees the real path.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hvk-job-label-')));
  const home = path.join(root, 'home');
  const agents = path.join(home, 'Library', 'LaunchAgents');
  const bin = path.join(root, 'bin');
  const callsFile = path.join(root, 'launchctl-calls.log');
  fs.mkdirSync(agents, { recursive: true });
  fs.mkdirSync(bin);
  // Shell builtins only, so it runs with this bare PATH.
  fs.writeFileSync(path.join(bin, 'launchctl'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$LAUNCHCTL_CALLS"\n', { mode: 0o755 });
  fs.writeFileSync(callsFile, '');
  return { root, home, agents, bin, callsFile };
}

function sandboxEnv(s) {
  return { HOME: s.home, PATH: s.bin, LAUNCHCTL_CALLS: s.callsFile, NODE_OPTIONS: FORCE_DARWIN };
}

/** Run the generated manage.mjs in folder autoDir against the stand-ins. */
function runManage(s, autoDir, command, cwd = autoDir) {
  const env = sandboxEnv(s);
  // This child sees these variables and nothing else from this process.
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LAUNCHCTL_CALLS', 'NODE_OPTIONS', 'PATH']);
  assert.ok(env.HOME.startsWith(s.root + path.sep) && env.PATH === s.bin, 'the child must run inside the sandbox');
  const r = spawnSync(process.execPath, [path.join(autoDir, 'manage.mjs'), command], { cwd, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, `manage.mjs ${command} exited ${r.status}: ${r.stderr || r.error}`);
  return r.stdout;
}

/** A real automations folder in the sandbox, as the extension writes one. */
function automationsFolder(s, ...segments) {
  const autoDir = path.join(s.root, 'accounts', ...segments, 'automations');
  fs.mkdirSync(autoDir, { recursive: true });
  fs.writeFileSync(path.join(autoDir, 'lib.mjs'), LIB);
  fs.writeFileSync(path.join(autoDir, 'manage.mjs'), MANAGE);
  return autoDir;
}

/**
 * A folder whose lib.mjs names ROOT outright, for a path that is not on this machine.
 * Used only with status, which writes nothing under ROOT.
 */
function folderNamed(s, root) {
  const dir = fs.mkdtempSync(path.join(s.root, 'named-'));
  fs.writeFileSync(path.join(dir, 'lib.mjs'), `export const ROOT = ${JSON.stringify(root)};\n`);
  fs.writeFileSync(path.join(dir, 'manage.mjs'), MANAGE);
  return dir;
}

const plistFile = (s, name) => path.join(s.agents, name + '.plist');
const jobs = (s) => fs.readdirSync(s.agents).sort();
const calls = (s) => fs.readFileSync(s.callsFile, 'utf8').split('\n').filter(Boolean);
const clearCalls = (s) => fs.writeFileSync(s.callsFile, '');

function sandboxed(name, fn) {
  test(name, async () => {
    const s = makeSandbox();
    try {
      await fn(s);
    } finally {
      fs.rmSync(s.root, { recursive: true, force: true });
    }
  });
}

describe('the job name comes from the whole folder path', () => {
  sandboxed('two folders that share the /Users/ prefix get different labels', (s) => {
    const acme = '/Users/sam/Hiveku Accounts/acme-1234abcd/automations';
    const globex = '/Users/sam/Hiveku Accounts/globex-9876dcba/automations';
    assert.equal(oldLabel(acme), oldLabel(globex), 'the ticket: the old name is the same for both');
    assert.notEqual(label(acme), label(globex));
    const acmeDir = folderNamed(s, acme);
    const globexDir = folderNamed(s, globex);

    assert.match(runManage(s, acmeDir, 'status'), /NOT installed/);
    fs.writeFileSync(plistFile(s, label(acme)), 'acme');
    assert.equal(runManage(s, acmeDir, 'status').trim(), `launchd agent INSTALLED (${label(acme)})`);
    assert.match(runManage(s, globexDir, 'status'), /NOT installed/, "the other account's job is not this one");
    fs.writeFileSync(plistFile(s, label(globex)), 'globex');
    assert.equal(runManage(s, globexDir, 'status').trim(), `launchd agent INSTALLED (${label(globex)})`);
  });

  sandboxed('two real folders with the same first bytes get two jobs, and neither replaces the other', (s) => {
    const acme = automationsFolder(s, 'acme');
    const globex = automationsFolder(s, 'globex');
    assert.equal(oldLabel(acme), oldLabel(globex), 'the fixture is the ticket: the old name is the same');

    runManage(s, acme, 'install');
    runManage(s, globex, 'install');

    assert.deepEqual(jobs(s), [label(acme) + '.plist', label(globex) + '.plist'].sort());
    for (const dir of [acme, globex]) {
      const plist = fs.readFileSync(plistFile(s, label(dir)), 'utf8');
      assert.ok(plist.includes(`<key>WorkingDirectory</key><string>${dir}</string>`), plist);
      assert.ok(plist.includes(`<key>Label</key><string>${label(dir)}</string>`), plist);
      assert.ok(calls(s).includes('load ' + plistFile(s, label(dir))), calls(s).join('\n'));
    }
  });

  sandboxed('the same folder twice gets the same label, from any working directory', (s) => {
    const dir = automationsFolder(s, 'acme');
    runManage(s, dir, 'install');
    runManage(s, dir, 'install', s.root);
    assert.deepEqual(jobs(s), [label(dir) + '.plist']);
    assert.deepEqual(calls(s).filter((line) => line.startsWith('load ')), Array(2).fill('load ' + plistFile(s, label(dir))));
  });

  sandboxed('a folder with spaces and non-ASCII characters keeps its one job', (s) => {
    const dir = automationsFolder(s, 'Acme Café Ñandú', 'Açaí 東京 (north)');
    const old = plistFile(s, oldLabel(dir));
    fs.writeFileSync(old, oldPlist(dir));

    runManage(s, dir, 'install');
    assert.equal(fs.existsSync(old), false, "this folder's old job moves");
    assert.deepEqual(jobs(s), [label(dir) + '.plist']);
    const plist = fs.readFileSync(plistFile(s, label(dir)), 'utf8');
    assert.ok(plist.includes(`<key>WorkingDirectory</key><string>${dir}</string>`), plist);
    assert.ok(plist.includes(`<string>${path.join(dir, 'dispatcher.mjs')}</string>`), plist);
    assert.equal(runManage(s, dir, 'status').trim(), `launchd agent INSTALLED (${label(dir)})`);

    runManage(s, dir, 'uninstall');
    assert.deepEqual(jobs(s), []);
  });

  sandboxed("an accented name's two spellings are one folder and one label", (s) => {
    const composed = '/Users/sam/Café Accounts/automations';
    const decomposed = composed.normalize('NFD');
    assert.notEqual(composed, decomposed);
    fs.writeFileSync(plistFile(s, label(composed)), 'x');
    for (const root of [composed, decomposed]) {
      assert.equal(runManage(s, folderNamed(s, root), 'status').trim(), `launchd agent INSTALLED (${label(composed)})`);
    }
  });
});

describe('a job left under the old shared name', () => {
  sandboxed("this folder's job is unloaded and removed before the new one is installed", (s) => {
    const dir = automationsFolder(s, 'acme');
    const old = plistFile(s, oldLabel(dir));
    fs.writeFileSync(old, oldPlist(dir));

    runManage(s, dir, 'install');

    assert.equal(fs.existsSync(old), false);
    assert.deepEqual(jobs(s), [label(dir) + '.plist']);
    const unloadedOld = calls(s).indexOf('unload ' + old);
    const loadedNew = calls(s).indexOf('load ' + plistFile(s, label(dir)));
    assert.ok(unloadedOld >= 0, calls(s).join('\n'));
    assert.ok(loadedNew > unloadedOld, calls(s).join('\n'));
  });

  sandboxed("another folder's job is left alone by install, stop and status", (s) => {
    const dir = automationsFolder(s, 'acme');
    const other = automationsFolder(s, 'globex');
    const old = plistFile(s, oldLabel(dir));
    assert.equal(oldLabel(dir), oldLabel(other), 'the old name is shared');
    fs.writeFileSync(old, oldPlist(other));

    runManage(s, dir, 'install');
    assert.equal(fs.readFileSync(old, 'utf8'), oldPlist(other));
    runManage(s, dir, 'uninstall');
    assert.equal(fs.readFileSync(old, 'utf8'), oldPlist(other));
    assert.match(runManage(s, dir, 'status'), /NOT installed/);
    assert.deepEqual(jobs(s), [path.basename(old)]);
    assert.deepEqual(calls(s).filter((line) => line.includes(old)), [], "launchctl never touched the other folder's job");
  });

  const lookalikes = [
    ['a sibling whose name starts with this folder', (dir) => dir + '-old'],
    ['a folder inside this one', (dir) => path.join(dir, 'nested', 'automations')],
    ['the folder that holds this one', (dir) => path.dirname(dir)],
  ];
  for (const [what, rootOf] of lookalikes) {
    sandboxed(`the whole path is compared, never a substring: ${what}`, (s) => {
      const dir = automationsFolder(s, 'acme');
      const old = plistFile(s, oldLabel(dir));
      const text = oldPlist(rootOf(dir));
      fs.writeFileSync(old, text);

      runManage(s, dir, 'install');
      runManage(s, dir, 'uninstall');
      assert.match(runManage(s, dir, 'status'), /NOT installed/);

      assert.equal(fs.readFileSync(old, 'utf8'), text);
      assert.deepEqual(calls(s).filter((line) => line.includes(old)), []);
    });
  }

  sandboxed('a plist that names this folder in only one of its paths is not this folder\'s', (s) => {
    const dir = automationsFolder(s, 'acme');
    const other = automationsFolder(s, 'globex');
    const old = plistFile(s, oldLabel(dir));
    const texts = [
      oldPlist(other).replace(`<key>WorkingDirectory</key><string>${other}</string>`, `<key>WorkingDirectory</key><string>${dir}</string>`),
      oldPlist(other).replace(`<string>${other}/dispatcher.mjs</string>`, `<string>${dir}/dispatcher.mjs</string>`),
      oldPlist(other).replace(`<key>StandardOutPath</key><string>${other}/logs/dispatcher.log</string>`, `<key>StandardOutPath</key><string>${dir}</string>`),
      // The right script and a sibling's working folder, and the reverse: each path whole, on its own.
      oldPlist(dir).replace(`<key>WorkingDirectory</key><string>${dir}</string>`, `<key>WorkingDirectory</key><string>${dir}-old</string>`),
      oldPlist(dir).replace(`<string>${dir}/dispatcher.mjs</string>`, `<string>${dir}-old/dispatcher.mjs</string>`),
    ];
    for (const text of texts) {
      assert.notEqual(text, oldPlist(other), 'the fixture must differ');
      fs.writeFileSync(old, text);
      runManage(s, dir, 'uninstall');
      assert.equal(fs.readFileSync(old, 'utf8'), text);
    }
    assert.deepEqual(calls(s).filter((line) => line.includes(old)), []);
  });

  sandboxed('an old plist is read as it was written, with no XML escaping', (s) => {
    const dir = automationsFolder(s, 'R&D <lab>');
    const old = plistFile(s, oldLabel(dir));
    fs.writeFileSync(old, oldPlist(dir));

    runManage(s, dir, 'uninstall');

    assert.equal(fs.existsSync(old), false);
    assert.ok(calls(s).includes('unload ' + old), calls(s).join('\n'));
  });

  for (const [what, folderForm, plistForm] of [
    ['decomposed in the plist, composed on disk', 'NFC', 'NFD'],
    ['composed in the plist, decomposed on disk', 'NFD', 'NFC'],
  ]) {
    sandboxed(`an accented folder's two spellings are one folder: ${what}`, (s) => {
      const dir = automationsFolder(s, 'Caf\u00e9'.normalize(folderForm));
      const old = plistFile(s, oldLabel(dir));
      fs.writeFileSync(old, oldPlist(dir.normalize(plistForm)));

      runManage(s, dir, 'uninstall');

      assert.equal(fs.existsSync(old), false);
      assert.ok(calls(s).includes('unload ' + old), calls(s).join('\n'));
    });
  }

  sandboxed("status reads this folder's old job as installed, so nothing says stopped right after the update", (s) => {
    const dir = automationsFolder(s, 'acme');
    fs.writeFileSync(plistFile(s, oldLabel(dir)), oldPlist(dir));
    assert.equal(runManage(s, dir, 'status').trim(), `launchd agent INSTALLED (${oldLabel(dir)})`);
    assert.deepEqual(calls(s), [], 'status only reads');
  });
});

describe('Stop monitoring and Delete locally', () => {
  sandboxed("uninstall removes this folder's job and no other folder's", (s) => {
    const acme = automationsFolder(s, 'acme');
    const globex = automationsFolder(s, 'globex');
    runManage(s, acme, 'install');
    runManage(s, globex, 'install');
    const globexPlist = fs.readFileSync(plistFile(s, label(globex)), 'utf8');
    clearCalls(s);

    runManage(s, acme, 'uninstall');

    assert.equal(fs.existsSync(plistFile(s, label(acme))), false);
    assert.equal(fs.readFileSync(plistFile(s, label(globex)), 'utf8'), globexPlist);
    assert.deepEqual(calls(s), ['unload ' + plistFile(s, label(acme))]);
    assert.match(runManage(s, acme, 'status'), /NOT installed/);
    assert.equal(runManage(s, globex, 'status').trim(), `launchd agent INSTALLED (${label(globex)})`);
  });

  sandboxed("uninstall also removes this folder's old-name job", (s) => {
    const dir = automationsFolder(s, 'acme');
    const old = plistFile(s, oldLabel(dir));
    fs.writeFileSync(old, oldPlist(dir));

    runManage(s, dir, 'uninstall');

    assert.equal(fs.existsSync(old), false);
    assert.ok(calls(s).includes('unload ' + old), calls(s).join('\n'));
    assert.deepEqual(jobs(s), []);
  });

  sandboxed("an old-script folder is stopped by the current script, which leaves another folder's job", async (s) => {
    const dir = automationsFolder(s, 'acme');
    const other = automationsFolder(s, 'globex');
    const old = plistFile(s, oldLabel(dir));
    fs.writeFileSync(old, oldPlist(other));
    fs.writeFileSync(plistFile(s, label(dir)), 'this folder');
    const marker = path.join(s.root, 'old-script-ran');
    fs.writeFileSync(path.join(dir, 'manage.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\n`);

    const saved = {};
    const env = sandboxEnv(s);
    for (const key of Object.keys(env)) saved[key] = process.env[key];
    try {
      Object.assign(process.env, env);
      await la.stopLocalAutomations(path.dirname(dir));
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    assert.equal(fs.existsSync(marker), false, 'the old script must not be the one that runs');
    assert.equal(fs.readFileSync(path.join(dir, 'manage.mjs'), 'utf8'), MANAGE, 'the current script is on disk');
    assert.equal(fs.existsSync(plistFile(s, label(dir))), false, "this folder's job is gone");
    assert.equal(fs.readFileSync(old, 'utf8'), oldPlist(other), "the other folder's job is untouched");
    assert.deepEqual(calls(s).filter((line) => line.includes(old)), []);
  });

  test('the extension stops a folder through stopLocalAutomations, never a stale script', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'extension.ts'), 'utf8');
    assert.match(src, /await stopLocalAutomations\(folder\);/);
    assert.doesNotMatch(src, /\[manage, 'uninstall'\]/);
  });

  test('Delete locally stops the job only after its confirmation, so cancelling leaves it running', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'extension.ts'), 'utf8');
    const confirmed = src.indexOf("if (ok !== 'Move to Trash') return;");
    assert.ok(confirmed > 0, 'the confirmation is still there');
    assert.ok(src.slice(confirmed).startsWith("if (ok !== 'Move to Trash') return;\n    await teardownAccountAutomations(folder);"));
    assert.match(src, /if \(choice\.value !== 'delete' \|\| !folder\) await teardownAccountAutomations\(folder\);/);
    assert.equal(src.match(/await teardownAccountAutomations\(folder\)/g).length, 2, 'stop, and delete once confirmed');
  });
});

describe('a folder set up before each folder had its own job', () => {
  sandboxed('the same folder reached with other capitals keeps one job', (s) => {
    const dir = automationsFolder(s, 'Acme');
    const otherCapitals = path.join(path.dirname(path.dirname(dir)), 'ACME', 'automations');
    // On a case-sensitive disk these are two folders, and two jobs is right.
    if (!fs.existsSync(otherCapitals)) return;

    runManage(s, dir, 'install');
    runManage(s, otherCapitals, 'install');

    assert.deepEqual(jobs(s), [label(dir) + '.plist']);
  });

  sandboxed('at start-up a stale script is rewritten, and nothing else happens', async (s) => {
    const stale = automationsFolder(s, 'acme');
    const current = automationsFolder(s, 'globex');
    const none = path.join(s.root, 'accounts', 'initech');
    fs.mkdirSync(none, { recursive: true });
    fs.writeFileSync(path.join(stale, 'manage.mjs'), '// a script from an earlier version\n');
    const untouched = fs.statSync(path.join(current, 'manage.mjs')).mtimeMs;

    const refreshed = await la.refreshAutomationScripts([path.dirname(stale), path.dirname(current), none, path.join(s.root, 'gone')]);

    assert.equal(refreshed, 1);
    assert.equal(fs.readFileSync(path.join(stale, 'manage.mjs'), 'utf8'), MANAGE);
    assert.equal(fs.statSync(path.join(current, 'manage.mjs')).mtimeMs, untouched, 'a current script is not written again');
    assert.deepEqual(fs.readdirSync(none), [], 'a folder with no automations gets none');
    assert.deepEqual(calls(s), [], 'launchctl was never called');
  });

  test('the extension brings the scripts up to date when it starts', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'extension.ts'), 'utf8');
    assert.match(src.slice(src.indexOf('export async function activate(')), /void refreshAutomationScripts\(/);
  });
});

test('the real LaunchAgents folder did not change while these tests ran', () => {
  assert.deepEqual(realAgentJobs(), REAL_BEFORE);
});
