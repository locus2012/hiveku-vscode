/**
 * "Local Automations" scaffold — a free, persistent, CRUD-able automation system
 * that runs on the user's machine with VS Code closed, with NO cloud-routine cost.
 *
 * Design: ONE OS scheduler entry (launchd on macOS / crontab elsewhere) runs
 * `dispatcher.mjs` every minute; the dispatcher reads `registry.json` and runs each
 * due + enabled worker. So Claude Code CRUDs automations by managing the registry
 * via `manage.mjs` (list/create/update/enable/disable/delete/run) — no per-automation
 * OS fiddling. Workers do deterministic work for free (Hiveku MCP over HTTP +
 * Smartlead/HeyReach REST) and shell out to `claude -p` only for judgment steps.
 *
 * Secrets live in `automations/.env` (gitignored). The Hiveku key is pre-filled from
 * the project's `.mcp.json` so it's turnkey.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { availableCadenceCommands } from './roleCommands';

// ── lib.mjs : shared helpers (Hiveku MCP client, cron matcher, claude -p, env, idempotency) ──
const LIB_MJS = `// Shared helpers for Hiveku local automations. ESM, Node 18+ (global fetch).
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

export const ROOT = dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\\r?\\n/)) {
    const m = line.match(/^\\s*([A-Z0-9_]+)\\s*=\\s*(.*)\\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Minimal MCP-over-HTTP client (initialize + tools/call). Free — no Claude turn.
//
// Ported from the extension's src/mcpClient.ts. The timeout is the whole point:
// this client runs under launchd/cron with the editor closed, and Node's global
// fetch has NO default request timeout — so one stalled connection used to hang
// the worker forever with nobody watching. The budget sits just past the edge
// timeout in front of Hiveku (~120-125s), so we never give up while the server
// is still legitimately working, and it stays armed through the body read
// because fetch resolves on headers, not on the body.
const MCP_TIMEOUT_MS = 135000;
const MCP_TIMEOUT_S = Math.round(MCP_TIMEOUT_MS / 1000);
// The server's limiter is a fixed 60s window whose 429 advertises the true
// remaining time, so a retry may legitimately have to wait a whole minute.
const MCP_MAX_RETRY_SECONDS = 60;

let _session = null, _inited = false, _id = 1;

function _clampRetry(n) {
  if (!Number.isFinite(n)) return 15;
  return Math.min(Math.max(Math.ceil(n), 1), MCP_MAX_RETRY_SECONDS);
}
// Fallback only — used when a 429 arrives without a Retry-After header.
function _retryAfterFromProse(message) {
  if (!/rate limit/i.test(message)) return null;
  const m = String(message).match(/retry[_ ]after[_ :]*(\\d+)/i);
  return _clampRetry(m ? Number(m[1]) : 15);
}

async function _rpcOnce(method, params) {
  const url = (process.env.HIVEKU_MCP_URL || 'https://core.hiveku.com/mcp');
  const headers = { Authorization: 'Bearer ' + process.env.HIVEKU_MCP_KEY, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (_session) headers['Mcp-Session-Id'] = _session;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MCP_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: _id++, method, params }), signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    if (ctrl.signal.aborted) throw new Error('MCP request timed out after ' + MCP_TIMEOUT_S + 's (' + method + ')');
    throw err;
  }
  const sid = res.headers.get('mcp-session-id'); if (sid) _session = sid;
  if (!res.ok) {
    let text = '';
    try { text = await res.text(); } catch { text = ''; } finally { clearTimeout(timer); }
    const detail = 'MCP HTTP ' + res.status + ': ' + text.slice(0, 300);
    if (res.status === 429) {
      // Retry-After is the limiter's own remaining-window figure; prefer it.
      const header = Number(res.headers.get('retry-after'));
      const limited = new Error(detail);
      limited.retryAfterSeconds = header > 0 ? _clampRetry(header) : (_retryAfterFromProse(text) || 15);
      throw limited;
    }
    throw new Error(detail);
  }
  if (res.status === 204) { clearTimeout(timer); return null; }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error('MCP response stalled after ' + MCP_TIMEOUT_S + 's while reading the body (' + method + ')');
    throw err;
  } finally { clearTimeout(timer); }
  if (body.error) throw new Error('MCP error ' + body.error.code + ': ' + body.error.message);
  return body.result;
}

// One retry after the delay the SERVER asked for. An unattended worker should
// not lose a whole run to a rate limit it was told exactly how to wait out.
async function rpc(method, params) {
  try {
    return await _rpcOnce(method, params);
  } catch (err) {
    const wait = (err && err.retryAfterSeconds) || _retryAfterFromProse(err && err.message ? err.message : String(err));
    if (!wait) throw err;
    console.log(new Date().toISOString(), 'rate limited by Hiveku - waiting ' + wait + 's, then retrying once (' + method + ')');
    await new Promise((r) => setTimeout(r, wait * 1000));
    return await _rpcOnce(method, params);
  }
}
/** Call a Hiveku tool; returns its JSON result. e.g. await hiveku('crm_list_deals', { limit: 20 }) */
export async function hiveku(tool, args = {}) {
  if (!_inited) { await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'hiveku-automations', version: '1' } }); await rpc('notifications/initialized', {}).catch(() => {}); _inited = true; }
  const r = await rpc('tools/call', { name: tool, arguments: args });
  if (r?.isError) throw new Error('tool ' + tool + ' error: ' + (r.content?.[0]?.text || '?'));
  const text = r?.content?.[0]?.text;
  try { return text ? JSON.parse(text) : r; } catch { return text; }
}

/** Resolve the \`claude\` binary by ABSOLUTE path. Under launchd/cron the PATH is
 *  minimal (no /opt/homebrew/bin), so plain 'claude' would ENOENT. Order: explicit
 *  CLAUDE_BIN override → common install locations → 'claude' on PATH as a last resort. */
function _claudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const cands = [join(homedir(), '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', join(homedir(), '.npm-global', 'bin', 'claude'), join(homedir(), '.local', 'bin', 'claude')];
  for (const c of cands) { try { if (existsSync(c)) return c; } catch {} }
  return 'claude';
}
/** Run a judgment step through Claude Code headlessly. Uses Claude usage ONLY when called. */
export function claudeP(prompt, { cwd = ROOT, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(_claudeBin(), ['-p', prompt], { cwd, timeout: timeoutMs, maxBuffer: 1e8 }, (err, stdout) => err ? reject(err) : resolve(String(stdout).trim()));
  });
}

/** Idempotency: has this automation already processed \`key\`? Mark it after handling. */
function _statePath(id) { const d = join(ROOT, 'state'); if (!existsSync(d)) mkdirSync(d, { recursive: true }); return join(d, id + '.json'); }
export function loadSeen(id) { const p = _statePath(id); return new Set(existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []); }
export function saveSeen(id, set) { writeFileSync(_statePath(id), JSON.stringify([...set].slice(-5000)), 'utf8'); }

/** 5-field cron matcher (minute hour day-of-month month day-of-week), local time. */
export function cronMatches(expr, d = new Date()) {
  const f = expr.trim().split(/\\s+/); if (f.length !== 5) return false;
  const vals = [d.getMinutes(), d.getHours(), d.getDate(), d.getMonth() + 1, d.getDay()];
  const part = (spec, val, min, max) => spec.split(',').some((tok) => {
    let step = 1, range = tok;
    const sm = tok.match(/^(.*)\\/(\\d+)$/); if (sm) { range = sm[1]; step = +sm[2]; }
    let lo = min, hi = max;
    if (range !== '*') { const rm = range.match(/^(\\d+)(?:-(\\d+))?$/); if (!rm) return false; lo = +rm[1]; hi = rm[2] != null ? +rm[2] : (sm ? max : lo); }
    if (val < lo || val > hi) return false;
    return (val - lo) % step === 0;
  });
  // cron: dom (idx2) and dow (idx4) are OR'd when both restricted
  const domR = f[2] !== '*', dowR = f[4] !== '*';
  const base = part(f[0], vals[0], 0, 59) && part(f[1], vals[1], 0, 23) && part(f[3], vals[3], 1, 12);
  if (!base) return false;
  if (domR && dowR) return part(f[2], vals[2], 1, 31) || part(f[4], vals[4] === 0 ? 7 : vals[4], 0, 7) || part(f[4], vals[4], 0, 7);
  return part(f[2], vals[2], 1, 31) && (part(f[4], vals[4], 0, 7) || part(f[4], vals[4] === 0 ? 7 : vals[4], 0, 7));
}

/** Tiny REST helper for Smartlead / HeyReach. */
export async function http(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + String(text).slice(0, 300));
  return json;
}
`;

// ── dispatcher.mjs : run by the OS every minute ──
const DISPATCHER_MJS = `// Run by launchd/cron every minute. Reads registry.json, runs each due + enabled worker.
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, loadEnv, cronMatches } from './lib.mjs';

loadEnv();
const REG = join(ROOT, 'registry.json');
const reg = JSON.parse(readFileSync(REG, 'utf8'));
const now = new Date();
const minuteKey = now.toISOString().slice(0, 16); // dedupe so a job fires once per minute
const logDir = join(ROOT, 'logs'); if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
let changed = false;

// ── Reaping a hung worker ───────────────────────────────────────────────────
// Workers are spawned detached and unref'd, so nothing in this process waits on
// them. Before this, a worker that wedged (a stalled socket, a claude -p that
// never returned) was never noticed, and every following tick started another
// copy beside it. The dispatcher now records each run's pid and start time in
// registry.json and, on a later tick, ends anything past its wall budget before
// starting a replacement - and never starts one while the old run is alive.
//
// 30 minutes is double the longest budget any shipped worker sets (the cadence
// workers cap claude -p at 15 minutes), so a slow-but-healthy run is never cut
// off, while a genuinely stuck one is cleared within a tick of the half hour.
// Raise or lower it per automation with "timeoutMinutes" in registry.json.
const DEFAULT_RUN_BUDGET_MIN = 30;

// The command line behind a pid, or '' if it is gone (or ps is unavailable).
// This doubles as the identity check: a recorded pid can be REUSED by an
// unrelated process after a reboot, and killing a stranger is far worse than
// leaving a dead automation un-reaped, so we only ever signal a process whose
// command line still names this worker file. If ps cannot answer, we treat the
// run as finished - that risks a duplicate run, never a wrong kill.
function processCommand(pid) {
  try {
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    return r.status === 0 ? String(r.stdout || '').trim() : '';
  } catch { return ''; }
}

for (const a of reg.automations || []) {
  if (!a.enabled) continue;
  const worker = join(ROOT, 'workers', a.worker + '.mjs');

  // Account for the previous run before considering a new one.
  let stillRunning = false;
  if (a._pid) {
    if (!processCommand(a._pid).includes(worker)) {
      a._pid = null; a._startedAt = null; a._termAt = null; changed = true; // finished, or the pid is no longer ours
    } else {
      const budgetMin = Number(a.timeoutMinutes) > 0 ? Number(a.timeoutMinutes) : DEFAULT_RUN_BUDGET_MIN;
      const startedMs = Date.parse(a._startedAt || '');
      const ageMs = Number.isFinite(startedMs) ? now.getTime() - startedMs : Infinity;
      if (ageMs > budgetMin * 60000) {
        // SIGTERM first so the worker can flush its log; if it is still there on
        // the next tick, SIGKILL. The pid is only forgotten once the process is
        // actually gone - clearing it while the process lives is exactly how a
        // replacement ends up running beside a hung run.
        const sig = a._termAt ? 'SIGKILL' : 'SIGTERM';
        let sent = true;
        try { process.kill(a._pid, sig); } catch { sent = false; }
        const ageText = !Number.isFinite(ageMs)
          ? 'an unknown time'
          : (ageMs >= 60000 ? Math.round(ageMs / 60000) + ' min' : Math.round(ageMs / 1000) + 's');
        console.error(now.toISOString(), a.id + ': run (pid ' + a._pid + ') has been going ' + ageText + ', past its ' + budgetMin + ' min budget - sent ' + sig + (sent ? '' : ' but the signal failed') + '. Its output is in logs/' + a.id + '.log; raise the budget with "timeoutMinutes" in registry.json if the work really takes this long.');
        a._lastKilled = now.toISOString();
        if (sig === 'SIGKILL' || !sent) { a._pid = null; a._startedAt = null; a._termAt = null; }
        else { a._termAt = now.toISOString(); stillRunning = true; }
        changed = true;
      } else {
        stillRunning = true;
      }
    }
  }

  if (a._lastMinute === minuteKey) continue;
  if (!cronMatches(a.cron, now)) continue;
  if (stillRunning) {
    // Due, but the last run has not finished. Say so - silence here would look
    // exactly like a healthy tick.
    console.error(now.toISOString(), a.id + ': due now, but the run started ' + a._startedAt + ' (pid ' + a._pid + ') has not finished. Not starting a second copy.');
    continue;
  }
  if (!existsSync(worker)) { console.error('missing worker', worker); continue; }
  const out = openSync(join(logDir, a.id + '.log'), 'a');
  const child = spawn(process.execPath, [worker], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], env: { ...process.env, HVK_AUTOMATION_ID: a.id } });
  child.unref();
  // _lastKilled is cleared here too: it records how the PREVIOUS run ended, and
  // leaving it set made manage.mjs list report "last run ENDED by the
  // dispatcher" forever after a single reap, long after healthy runs followed.
  a._pid = child.pid; a._startedAt = now.toISOString(); a._termAt = null; a._lastKilled = null;
  a._lastMinute = minuteKey; a._lastRun = now.toISOString(); changed = true;
  console.log(now.toISOString(), 'started', a.id, 'pid', child.pid);
}
if (changed) writeFileSync(REG, JSON.stringify(reg, null, 2) + '\\n', 'utf8');
`;

// ── manage.mjs : the CRUD CLI Claude Code drives ──
const MANAGE_MJS = `#!/usr/bin/env node
// CRUD for local automations + install/uninstall the single OS scheduler entry.
// Usage:
//   node manage.mjs list
//   node manage.mjs create --id reply-triage --cron "17 9-17 * * 1-5" --worker reply-triage --desc "hourly Smartlead reply triage"
//   node manage.mjs update --id reply-triage --cron "*/30 9-17 * * 1-5"
//   node manage.mjs enable|disable|delete|run --id reply-triage
//   node manage.mjs install | uninstall | status
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { ROOT } from './lib.mjs';

const REG = join(ROOT, 'registry.json');
const read = () => JSON.parse(readFileSync(REG, 'utf8'));
const write = (r) => writeFileSync(REG, JSON.stringify(r, null, 2) + '\\n', 'utf8');
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const tag = 'hiveku-automations';
const plistLabel = 'com.hiveku.automations.' + Buffer.from(ROOT).toString('hex').slice(0, 12);
const plistPath = join(homedir(), 'Library', 'LaunchAgents', plistLabel + '.plist');

function ensureWorker(name) {
  const dir = join(ROOT, 'workers'); if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const dst = join(dir, name + '.mjs');
  if (!existsSync(dst)) {
    const tmpl = join(dir, 'example-reply-triage.mjs');
    if (existsSync(tmpl)) copyFileSync(tmpl, dst); else writeFileSync(dst, "import { loadEnv } from '../lib.mjs';\\nloadEnv();\\nconsole.log('TODO: implement', '" + name + "');\\n", 'utf8');
    console.log('scaffolded workers/' + name + '.mjs — edit it.');
  }
}

function installScheduler() {
  mkdirSync(join(ROOT, 'logs'), { recursive: true });
  if (platform() === 'darwin') {
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    const plist = '<?xml version="1.0" encoding="UTF-8"?>\\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\\n<plist version="1.0"><dict>\\n  <key>Label</key><string>' + plistLabel + '</string>\\n  <key>ProgramArguments</key><array><string>' + process.execPath + '</string><string>' + join(ROOT, 'dispatcher.mjs') + '</string></array>\\n  <key>WorkingDirectory</key><string>' + ROOT + '</string>\\n  <key>StartInterval</key><integer>60</integer>\\n  <key>RunAtLoad</key><true/>\\n  <key>StandardOutPath</key><string>' + join(ROOT, 'logs', 'dispatcher.log') + '</string>\\n  <key>StandardErrorPath</key><string>' + join(ROOT, 'logs', 'dispatcher.log') + '</string>\\n</dict></plist>\\n';
    writeFileSync(plistPath, plist, 'utf8');
    spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
    const r = spawnSync('launchctl', ['load', plistPath], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('launchctl load failed: ' + (r.stderr || ''));
    console.log('Installed launchd agent ' + plistLabel + ' (runs every 60s). Stop: node manage.mjs uninstall');
  } else {
    const line = '* * * * * cd ' + ROOT + ' && ' + process.execPath + ' dispatcher.mjs >> logs/dispatcher.log 2>&1 # ' + tag;
    const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout || '';
    if (cur.includes('# ' + tag)) { console.log('cron entry already installed'); return; }
    const next = (cur.trim() ? cur.trim() + '\\n' : '') + line + '\\n';
    const w = spawnSync('crontab', ['-'], { input: next });
    if (w.status !== 0) throw new Error('crontab write failed');
    console.log('Installed cron entry (every minute). Stop: node manage.mjs uninstall');
  }
}
function uninstallScheduler() {
  if (platform() === 'darwin') { spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' }); if (existsSync(plistPath)) unlinkSync(plistPath); console.log('Removed launchd agent.'); }
  else { const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout || ''; const next = cur.split(/\\r?\\n/).filter((l) => !l.includes('# ' + tag)).join('\\n'); spawnSync('crontab', ['-'], { input: next.trim() + '\\n' }); console.log('Removed cron entry.'); }
}
function schedulerStatus() {
  if (platform() === 'darwin') console.log(existsSync(plistPath) ? 'launchd agent INSTALLED (' + plistLabel + ')' : 'NOT installed — run: node manage.mjs install');
  else { const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout || ''; console.log(cur.includes('# ' + tag) ? 'cron entry INSTALLED' : 'NOT installed — run: node manage.mjs install'); }
}

const reg = existsSync(REG) ? read() : { automations: [] };
reg.automations = reg.automations || [];
const find = (id) => reg.automations.find((a) => a.id === id);

switch (cmd) {
  case 'list': {
    if (!reg.automations.length) console.log('(no automations) — create one: node manage.mjs create --id <id> --cron "<cron>" --worker <name>');
    // 'last=' is when a run STARTED, so on its own it reads like a success.
    // Surface a run still in flight, and one the dispatcher had to end.
    for (const a of reg.automations) {
      const state = a._pid
        ? 'RUNNING since ' + a._startedAt
        : (a._lastKilled ? 'last run ENDED by the dispatcher at ' + a._lastKilled : '');
      console.log([a.enabled ? '●' : '○', a.id.padEnd(22), a.cron.padEnd(18), 'worker=' + a.worker, a._lastRun ? 'last=' + a._lastRun : '', state].join('  '));
    }
    break;
  }
  case 'create': {
    const id = flag('id'); if (!id) throw new Error('--id required');
    if (find(id)) throw new Error('id exists: ' + id);
    const worker = flag('worker') || id;
    ensureWorker(worker);
    reg.automations.push({ id, cron: flag('cron') || '0 9 * * 1-5', worker, desc: flag('desc') || '', enabled: flag('disabled') == null });
    write(reg); console.log('created', id, '— run "node manage.mjs install" once so the OS fires the dispatcher.');
    break;
  }
  case 'update': { const a = find(flag('id')); if (!a) throw new Error('not found'); if (flag('cron')) a.cron = flag('cron'); if (flag('worker')) { a.worker = flag('worker'); ensureWorker(a.worker); } if (flag('desc') != null) a.desc = flag('desc'); write(reg); console.log('updated', a.id); break; }
  case 'enable': { const a = find(flag('id')); if (!a) throw new Error('not found'); a.enabled = true; write(reg); console.log('enabled', a.id); break; }
  case 'disable': { const a = find(flag('id')); if (!a) throw new Error('not found'); a.enabled = false; write(reg); console.log('disabled', a.id); break; }
  case 'delete': { reg.automations = reg.automations.filter((a) => a.id !== flag('id')); write(reg); console.log('deleted', flag('id')); break; }
  case 'run': { const a = find(flag('id')); if (!a) throw new Error('not found'); console.log(execFileSync(process.execPath, [join(ROOT, 'workers', a.worker + '.mjs')], { cwd: ROOT, encoding: 'utf8' })); break; }
  case 'install': installScheduler(); break;
  case 'uninstall': uninstallScheduler(); break;
  case 'status': schedulerStatus(); break;
  default: console.log('commands: list | create | update | enable | disable | delete | run | install | uninstall | status');
}
`;

// ── workers/example-reply-triage.mjs : the template worker ──
const EXAMPLE_WORKER_MJS = `// Example worker: Smartlead reply triage → Hiveku CRM. Copy this as the template for new
// automations. Deterministic API work is FREE; the claudeP() call uses Claude only when run.
import { loadEnv, hiveku, http, claudeP, loadSeen, saveSeen } from '../lib.mjs';
loadEnv();
const ID = process.env.HVK_AUTOMATION_ID || 'reply-triage';

async function main() {
  // 1) Confirm we're on the right Hiveku account (free).
  const acct = await hiveku('get_account_info', {});
  console.log(new Date().toISOString(), 'account', acct?.data?.name || acct?.name);

  // 2) Pull NEW positive replies from Smartlead (REST; fill in your campaign id + endpoint).
  //    Docs: https://api.smartlead.ai  — e.g. GET /api/v1/campaigns/{id}/leads?api_key=...&reply_received=true
  const KEY = process.env.SMARTLEAD_API_KEY;
  if (!KEY) { console.log('set SMARTLEAD_API_KEY in automations/.env'); return; }
  // const replies = await http('https://server.smartlead.ai/api/v1/campaigns/<CAMPAIGN_ID>/leads?api_key=' + KEY + '&reply_received=true');
  const replies = []; // ← replace with the call above

  // 3) Idempotency: only handle replies we haven't seen.
  const seen = loadSeen(ID);
  for (const r of replies) {
    const k = String(r.id ?? r.lead_id ?? r.email);
    if (seen.has(k)) continue;

    // 4) Judgment step — draft a reply with Claude (uses Claude ONLY here, only when there's a new reply).
    const draft = await claudeP('Draft a concise, friendly reply to this prospect message. Return only the reply.\\n\\n' + (r.reply_body || r.message || ''));

    // 5) Persist into Hiveku CRM (free MCP calls).
    await hiveku('crm_contact_upsert_by_email', { email: r.email, first_name: r.first_name, last_name: r.last_name, company: r.company_name });
    await hiveku('crm_create_activity', { type: 'note', subject: 'Smartlead reply', body: (r.reply_body || '') + '\\n\\n--- suggested reply ---\\n' + draft });
    // await hiveku('outbound_update_lead', { lead_id: r.lead_id, is_interested: true });

    seen.add(k);
    console.log('handled reply', k);
  }
  saveSeen(ID, seen);
}
main().catch((e) => { console.error('worker error', e.message); process.exit(1); });
`;

const README_MD = `# Local automations (free · persistent · CRUD-able)

Runs scheduled work on THIS machine — with VS Code closed and across reboots — at **zero cloud cost**.
One OS scheduler entry runs \`dispatcher.mjs\` every minute; it reads \`registry.json\` and runs each due,
enabled worker. Deterministic work (Hiveku MCP over HTTP + Smartlead/HeyReach REST) is free; workers call
\`claude -p\` only for judgment steps, so Claude usage tracks real work, not the clock.

## First-time setup
1. Fill \`automations/.env\` — \`HIVEKU_MCP_KEY\` is pre-filled from this project; add \`SMARTLEAD_API_KEY\`,
   \`HEYREACH_API_KEY\` as needed. (\`.env\` is gitignored — never commit it.)
2. Install the single OS scheduler entry: \`node automations/manage.mjs install\` (launchd on macOS, cron else).

## CRUD (what Claude Code uses)
\`\`\`bash
node automations/manage.mjs list                                  # READ — all automations + last run
node automations/manage.mjs create --id reply-triage --cron "17 9-17 * * 1-5" --worker reply-triage --desc "hourly Smartlead triage"
node automations/manage.mjs update  --id reply-triage --cron "*/30 9-17 * * 1-5"   # change schedule
node automations/manage.mjs enable  --id reply-triage             # / disable
node automations/manage.mjs delete  --id reply-triage
node automations/manage.mjs run     --id reply-triage             # run once now (test)
node automations/manage.mjs status | install | uninstall          # the OS scheduler entry
\`\`\`
\`create\` scaffolds \`workers/<name>.mjs\` from the example if it doesn't exist — edit it to do the work.
Cron is standard 5-field **local time** (\`17 9-17 * * 1-5\` = :17 past 9am–5pm on weekdays). Pick odd minutes.

## Writing a worker
Use the helpers in \`lib.mjs\`: \`hiveku(tool, args)\` (any Hiveku MCP tool, free), \`http(url, opts)\`
(Smartlead/HeyReach REST), \`claudeP(prompt)\` (one-shot Claude for judgment), \`loadSeen/saveSeen(id)\`
(idempotency so a lead is never handled twice). See \`workers/example-reply-triage.mjs\`.

## Run budgets (a worker that hangs)
The dispatcher ends a run that overruns: SIGTERM once it has been going 30 minutes, SIGKILL on the next
tick if it ignores that, with the reason written to \`logs/dispatcher.log\`. While a run is still alive the
dispatcher will NOT start a second copy — it logs that the automation was due and was skipped. If a worker
legitimately takes longer, set \`"timeoutMinutes": <n>\` on that automation in \`registry.json\`.
\`node manage.mjs list\` shows a run still in flight, and the last run the dispatcher had to end.

## Safety
Idempotent (track processed ids), respect Smartlead/HeyReach/LinkedIn rate caps, keep \`.env\` out of git,
and confirm \`get_account_info\` before writing. The key here is pinned to ONE Hiveku account.

## Notes
\`claudeP()\` finds the \`claude\` binary by absolute path (launchd/cron run with a minimal PATH that omits
\`/opt/homebrew/bin\`). If yours lives somewhere unusual, set \`CLAUDE_BIN=/full/path/to/claude\` in \`.env\`.
`;

/** The files written into <workspace>/automations/. Values may be post-processed (e.g. .env). */
export function automationFiles(): Record<string, string> {
  return {
    'automations/lib.mjs': LIB_MJS,
    'automations/dispatcher.mjs': DISPATCHER_MJS,
    'automations/manage.mjs': MANAGE_MJS,
    'automations/workers/example-reply-triage.mjs': EXAMPLE_WORKER_MJS,
    'automations/registry.json': JSON.stringify({ automations: [] }, null, 2) + '\n',
    'automations/README.md': README_MD,
  };
}

// ── Agency cadence pack: scheduled daily brief / weekly pass / monthly report ──

const CADENCE_JOBS: Array<{ id: string; cron: string; command: string; desc: string }> = [
  { id: 'cadence-daily-brief', cron: '0 8 * * 1-5', command: '/hiveku-daily', desc: 'weekday 8am morning brief' },
  { id: 'cadence-weekly-pass', cron: '0 9 * * 1', command: '/hiveku-weekly', desc: 'Monday 9am optimization pass' },
  { id: 'cadence-monthly-report', cron: '0 10 1 * *', command: '/hiveku-report', desc: 'monthly client report, 1st 10am' },
];

/** Worker template: runs a slash command headlessly in the ACCOUNT folder and
 *  saves the output to briefs/<date>-<name>.md. Uses Claude usage per run. */
function cadenceWorker(id: string, command: string): string {
  return `// Scheduled agency cadence: runs \`claude -p "${command}"\` in the account folder
// (so it has the account's .mcp.json + commands) and files the output under briefs/.
// Headless runs auto-approve only the read-tool allowlist — writes are skipped, which
// is correct for an unattended brief. Each run consumes Claude usage.
import { loadEnv, claudeP, ROOT } from '../lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
loadEnv();
const accountDir = dirname(ROOT);
const out = await claudeP(${JSON.stringify(command)}, { cwd: accountDir, timeoutMs: 900000 });
const dir = join(accountDir, 'briefs');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const file = join(dir, stamp + '-${id.replace('cadence-', '')}.md');
writeFileSync(file, out + '\\n', 'utf8');
console.log(new Date().toISOString(), 'wrote', file);
`;
}

/**
 * Install the agency cadence into an account folder: scaffolds the automations
 * framework if needed, writes the three cadence workers, registers them in
 * registry.json (idempotent), and leaves scheduler install to the caller/CLI.
 * Returns the job ids that are now registered.
 */
export async function installAgencyCadence(accountDir: string, roleId?: string): Promise<string[]> {
  await scaffoldLocalAutomations(accountDir);
  const autoDir = path.join(accountDir, 'automations');

  // Only schedule cadence jobs whose slash command will actually exist for this
  // role. /hiveku-weekly and /hiveku-report are written only for roles with a
  // cadence spec (seo, ppc, marketer, social, sales, outbound, owner), and
  // /hiveku-daily is not written at all when no role is set — so scheduling all
  // three unconditionally left dev, bookkeeper, pm, helpdesk and role-less
  // accounts with cron jobs invoking command files that were never created.
  const available = availableCadenceCommands(roleId);
  const jobs = CADENCE_JOBS.filter((j) => available.has(j.command.replace(/^\//, '')));
  if (jobs.length === 0) {
    throw new Error(
      'Agency Cadence needs a role that ships scheduled commands. Set a role (SEO, PPC, Marketer, Social, Sales, Outbound, or Owner) with "Hiveku: Set Role", then run this again.',
    );
  }

  for (const job of jobs) {
    await fs.writeFile(path.join(autoDir, 'workers', `${job.id}.mjs`), cadenceWorker(job.id, job.command), 'utf8');
  }
  const regPath = path.join(autoDir, 'registry.json');
  let reg: { automations: Array<Record<string, unknown>> } = { automations: [] };
  try {
    reg = JSON.parse(await fs.readFile(regPath, 'utf8')) as typeof reg;
    if (!Array.isArray(reg.automations)) reg.automations = [];
  } catch {
    /* fresh registry */
  }
  for (const job of jobs) {
    if (reg.automations.some((a) => a.id === job.id)) continue;
    reg.automations.push({ id: job.id, cron: job.cron, worker: job.id, desc: job.desc, enabled: true });
  }
  await fs.writeFile(regPath, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  return jobs.map((j) => j.id);
}

/**
 * Scaffold the automations/ framework into baseDir. Pre-fills .env with the Hiveku
 * MCP key+url read from the project's .mcp.json (turnkey). Returns the file list.
 */
export async function scaffoldLocalAutomations(baseDir: string): Promise<string[]> {
  const files = automationFiles();
  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(baseDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Never clobber a worker/registry the user has edited.
    if ((rel.startsWith('automations/workers/') || rel === 'automations/registry.json')) {
      try {
        await fs.access(abs);
        continue;
      } catch {
        /* not present — write it */
      }
    }
    await fs.writeFile(abs, content, 'utf8');
    written.push(rel);
  }

  // .env (gitignored) — pre-fill the Hiveku key from .mcp.json so it's turnkey.
  const envPath = path.join(baseDir, 'automations', '.env');
  let hivekuUrl = 'https://core.hiveku.com/mcp';
  let hivekuKey = '';
  try {
    const mcp = JSON.parse(await fs.readFile(path.join(baseDir, '.mcp.json'), 'utf8'));
    const h = mcp?.mcpServers?.hiveku;
    if (h?.url) hivekuUrl = h.url;
    const auth = h?.headers?.Authorization as string | undefined;
    if (auth) hivekuKey = auth.replace(/^Bearer\s+/i, '').trim();
  } catch {
    /* no .mcp.json — leave key blank */
  }
  try {
    await fs.access(envPath); // don't overwrite existing secrets
  } catch {
    await fs.writeFile(
      envPath,
      [
        '# Local automation secrets — NEVER commit this file.',
        `HIVEKU_MCP_URL=${hivekuUrl}`,
        `HIVEKU_MCP_KEY=${hivekuKey}`,
        'SMARTLEAD_API_KEY=',
        'HEYREACH_API_KEY=',
        '',
      ].join('\n'),
      'utf8',
    );
    written.push('automations/.env');
  }
  return written;
}
