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
let _session = null, _inited = false, _id = 1;
async function rpc(method, params) {
  const url = (process.env.HIVEKU_MCP_URL || 'https://core.hiveku.com/mcp');
  const headers = { Authorization: 'Bearer ' + process.env.HIVEKU_MCP_KEY, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (_session) headers['Mcp-Session-Id'] = _session;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: _id++, method, params }) });
  const sid = res.headers.get('mcp-session-id'); if (sid) _session = sid;
  if (!res.ok) throw new Error('MCP HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300));
  if (res.status === 204) return null;
  const body = await res.json();
  if (body.error) throw new Error('MCP error ' + body.error.code + ': ' + body.error.message);
  return body.result;
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
import { spawn } from 'node:child_process';
import { ROOT, loadEnv, cronMatches } from './lib.mjs';

loadEnv();
const REG = join(ROOT, 'registry.json');
const reg = JSON.parse(readFileSync(REG, 'utf8'));
const now = new Date();
const minuteKey = now.toISOString().slice(0, 16); // dedupe so a job fires once per minute
const logDir = join(ROOT, 'logs'); if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
let changed = false;

for (const a of reg.automations || []) {
  if (!a.enabled) continue;
  if (a._lastMinute === minuteKey) continue;
  if (!cronMatches(a.cron, now)) continue;
  const worker = join(ROOT, 'workers', a.worker + '.mjs');
  if (!existsSync(worker)) { console.error('missing worker', worker); continue; }
  const out = openSync(join(logDir, a.id + '.log'), 'a');
  const child = spawn(process.execPath, [worker], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], env: { ...process.env, HVK_AUTOMATION_ID: a.id } });
  child.unref();
  a._lastMinute = minuteKey; a._lastRun = now.toISOString(); changed = true;
  console.log(now.toISOString(), 'started', a.id);
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
    for (const a of reg.automations) console.log([a.enabled ? '●' : '○', a.id.padEnd(22), a.cron.padEnd(18), 'worker=' + a.worker, a._lastRun ? 'last=' + a._lastRun : ''].join('  '));
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
export async function installAgencyCadence(accountDir: string): Promise<string[]> {
  await scaffoldLocalAutomations(accountDir);
  const autoDir = path.join(accountDir, 'automations');
  for (const job of CADENCE_JOBS) {
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
  for (const job of CADENCE_JOBS) {
    if (reg.automations.some((a) => a.id === job.id)) continue;
    reg.automations.push({ id: job.id, cron: job.cron, worker: job.id, desc: job.desc, enabled: true });
  }
  await fs.writeFile(regPath, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  return CADENCE_JOBS.map((j) => j.id);
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
