/**
 * Minimal MCP JSON-RPC client over Streamable HTTP — the exact protocol the
 * `hiveku-sync` CLI uses, ported to TypeScript. Speaks just enough to
 * initialize + call tools against the Hiveku MCP server (core.hiveku.com/mcp).
 *
 * Auth is the customer's MCP key as a Bearer token; the server validates it
 * against mcp_api_keys, resolves the one account it's pinned to, and proxies to
 * the Olympus backend with the service key. The extension never sees the
 * service key and never talks to the Olympus routes directly.
 */

const PROTOCOL_VERSION = '2024-11-05';

/**
 * Global request gate shared by every client instance. The extension shares
 * its rate-limit bucket per account key (the server also gives the
 * X-Hiveku-Client class its own bucket) — but an uncapped burst (dashboard
 * over N accounts, dept expands) can still trip 429s. Cap concurrent
 * in-flight MCP requests extension-wide and retry ONCE on a rate-limit
 * rejection after the server-advertised delay.
 */
const MAX_CONCURRENT = 6;

/**
 * Per-tool request budgets, for the handful of tools that do real server-side
 * work rather than answering a query.
 *
 * The 60s default is right for interactive reads — a stalled one must not hang
 * a surface forever. It is wrong for these: project_files_snapshot tars,
 * compresses and uploads an entire project, and its builder route declares
 * `maxDuration = 180`. The client was therefore abandoning the request at a
 * third of the time the server was still allowed to spend, and reporting it as
 * a timeout, so a download that was progressing normally looked like a fault.
 *
 * Keep these AT the server's own limit, not above it: past that the route is
 * dead anyway and a longer client wait just delays the same failure. Measured
 * on the largest real project (617 MB, mostly inline JPEG) compression is not
 * the cost — gzip level 6 vs 1 differs by 0.3s on 300 MB, since JPEG does not
 * compress — the time goes to reading content out of Postgres and pushing the
 * archive to S3.
 */
/**
 * The edge in front of Hiveku closes an idle connection at ~120-125s, so
 * waiting longer than this buys nothing but a longer stare at a spinner.
 */
const EDGE_TIMEOUT_CEILING_MS = 135_000;

/**
 * ★ The DEFAULT, and the point of this whole block.
 *
 * It used to be 60s. Expanding the plugin's generated tool index: 262 tools
 * declare a server-side budget above 60s and 259 of them are absent from the
 * hand-maintained table below — ppc_sync (120s, wired to the "Sync from
 * platform" button), talk_to_department (the chat panel; the server budgets it
 * 110s), checkpoint_restore, cms_bulk_patch, cms_bulk_delete,
 * history_restore_to_time, project_files_bulk_delete (290s each),
 * ppc_experiment_create (200s). Several of those are WRITES, and the comment
 * on project_vcs_stash below already spells out what that costs: "a slow apply
 * aborts CLIENT-side while the server keeps going ... the operator would be
 * told it failed after it succeeded."
 *
 * A hand-maintained list cannot track ~2,000 tools; the plugin hit this exact
 * wall and stopped hand-listing (lib/upstream.mjs). Defaulting to the edge
 * ceiling instead of 60s makes the rule "the client never gives up before the
 * network in front of the server does", which needs no table to stay true.
 * The table below survives only as explicit documentation of known-slow calls.
 */
const DEFAULT_TOOL_TIMEOUT_MS = EDGE_TIMEOUT_CEILING_MS;

/**
 * ★ A Map, not an object literal: a tool named `constructor`, `toString` or
 * `valueOf` would otherwise resolve off Object.prototype and hand a FUNCTION
 * to setTimeout. The plugin uses a Map for this reason.
 *
 * Every entry is clamped to EDGE_TIMEOUT_CEILING_MS on read — the numbers
 * below record what the SERVER route allows, which is the useful thing to
 * document, but the client cannot outlast the edge no matter what they say.
 */
const SLOW_TOOL_TIMEOUT_MS = new Map<string, number>(Object.entries({
  // Matches maxDuration = 180 on the files-snapshot route.
  project_files_snapshot: 180_000,
  // The stash route is maxDuration = 180 and its apply path verifies branch
  // content against S3 before committing. At the 60s default a slow apply
  // aborts CLIENT-side while the server keeps going and rewrites main — the
  // operator would be told it failed after it succeeded.
  project_vcs_stash: 300_000,
  // Strict PR merge reads both trees and commits; same reasoning, smaller job.
  project_vcs_pr_merge: 180_000,
  project_vcs_merge: 180_000,
  // A board render drives a headless browser: ~5-15s warm, and the route is
  // maxDuration = 180. At the 60s default the extension would abort a capture
  // that is still running and will still be billed, and report a failure for a
  // render that then succeeds.
  hiveboard_render: 180_000,
  // Even with wait_for_ready: false the route stops the machine, waits for
  // stopped, starts (or destroy+recreates), and runs the post-start sync
  // before responding - routinely past 60s. The MCP proxy budgets this exact
  // call 240s; at the 60s default the client aborts a rebuild that is still
  // running and a retry lands 409 preview_lifecycle_busy.
  preview_force_recompile: 240_000,
  // The server mapping budgets this exact call 290s (up to 500 files through
  // saveProjectFile plus the checkpoint and preview fan-out). At the 60s
  // default the extension aborted a batch the server went on to finish, then
  // re-sent it on retry. Since 2026-09-04 the route itself stops applying
  // files at 85s and answers partial:true + remaining_paths (scm.ts continues
  // from them), so this ceiling is only ever reached by the pre-loop work.
  project_files_bulk_save: 290_000,
  // A full branch tree read out of S3/Postgres; maxDuration = 180 on the route.
  project_vcs_checkout: 180_000,
  // Spawns an isolated Fly app and syncs the branch tree into it before
  // answering; route maxDuration = 180. Aborting client-side leaves the app
  // running with no previewSessionId to poll or tear down.
  project_vcs_branch_preview: 180_000,
}));

/** The budget for one tool call: its declared override, or the default, capped at the edge. */
function toolTimeoutMs(name: string): number {
  const declared = SLOW_TOOL_TIMEOUT_MS.get(name) ?? DEFAULT_TOOL_TIMEOUT_MS;
  return Math.min(declared, EDGE_TIMEOUT_CEILING_MS);
}
let inFlight = 0;
const waiters: Array<() => void> = [];
async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}
function releaseSlot(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

/** Parse the retry delay from a rate-limit rejection (error.data or prose). */
function rateLimitRetrySeconds(message: string): number | null {
  if (!/rate limit/i.test(message)) return null;
  const m = message.match(/retry[_ ]after[_ :]*(\d+)/i);
  const n = m ? Number(m[1]) : 15;
  return Math.min(Math.max(n, 1), 30);
}

export interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  /** Server registry stamp — rides every response; used for drift detection. */
  _meta?: { hiveku?: { registry_version?: string; tool_count?: number } };
}

// ── Registry-drift detection (NO polling — piggybacks on responses) ─────────
// The server stamps every tools/call result with a hash of the tool registry.
// The first stamp a window sees becomes the baseline; a later differing stamp
// means the server shipped new/changed tools since this window's clients
// connected. One callback fire per window — the banner, not a nag.
let registryBaseline: string | null = null;
let driftNotified = false;
let driftCallback: ((info: { toolCount?: number }) => void) | undefined;

export function onRegistryDrift(cb: (info: { toolCount?: number }) => void): void {
  driftCallback = cb;
}

/** After a reconnect: adopt the next stamp as the new baseline. */
export function resetRegistryDrift(): void {
  registryBaseline = null;
  driftNotified = false;
}

function noteRegistryStamp(meta: McpToolResult['_meta']): void {
  const version = meta?.hiveku?.registry_version;
  if (typeof version !== 'string' || !version) return;
  if (registryBaseline === null) {
    registryBaseline = version;
    return;
  }
  if (version !== registryBaseline && !driftNotified) {
    driftNotified = true;
    driftCallback?.({ toolCount: meta?.hiveku?.tool_count });
  }
}

export class HivekuMcpClient {
  private baseUrl: string;
  private apiKey: string;
  private profile: string;
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;
  private initializing: Promise<void> | undefined;

  constructor(opts: { baseUrl: string; apiKey: string; profile?: string }) {
    if (!opts.baseUrl) throw new Error('baseUrl required');
    if (!opts.apiKey) throw new Error('apiKey required');
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.profile = opts.profile ?? 'full';
  }

  private get endpoint(): string {
    const url = new URL(`${this.baseUrl}/mcp`);
    if (this.profile && this.profile !== 'full') {
      url.searchParams.set('profile', this.profile);
    }
    return url.toString();
  }

  private async request<T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    await acquireSlot();
    try {
      return await this.requestOnce<T>(method, params, timeoutMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const retryAfter = rateLimitRetrySeconds(msg);
      if (retryAfter === null) throw err;
      // One polite retry after the advertised window — background UI surfaces
      // should self-heal a 429 instead of surfacing red toasts.
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return await this.requestOnce<T>(method, params, timeoutMs);
    } finally {
      releaseSlot();
    }
  }

  private async requestOnce<T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    const id = this.nextId++;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Server buckets extension traffic separately from agent sessions.
      'X-Hiveku-Client': 'vscode-extension',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    // Hard timeout: a single stalled request must never hang a surface forever
    // (seen live: the Account Console stuck on "Loading…" behind one dead await).
    //
    // A tool call waits as long as the server may legitimately take — see
    // DEFAULT_TOOL_TIMEOUT_MS. Giving up early does not stop the work; it only
    // makes the extension report a failure for something that then succeeds.
    const budget = timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), budget);
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (ctrl.signal.aborted) {
        throw new Error(`MCP request timed out after ${Math.round(budget / 1000)}s (${method})`);
      }
      throw err;
    }
    // ★ The timer stays armed until the BODY is read, not just the headers.
    // `fetch` resolves on headers; a server that answers 200 and then stalls
    // mid-body left the read with no deadline at all, so the one thing the
    // budget exists to bound — how long the extension can hang — was unbounded
    // on exactly the slow responses it was written for.

    const sessionHeader = res.headers.get('mcp-session-id');
    if (sessionHeader) this.sessionId = sessionHeader;

    if (!res.ok) {
      const text = await res.text().catch(() => '').finally(() => clearTimeout(timer));
      throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    if (res.status === 204) return null as T;

    let body: { error?: { code: number; message: string }; result?: T };
    try {
      body = (await res.json()) as { error?: { code: number; message: string }; result?: T };
    } catch (err) {
      if (ctrl.signal.aborted) {
        throw new Error(
          `MCP response stalled after ${Math.round(budget / 1000)}s while reading the body (${method})`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (body.error) {
      throw new Error(`MCP error ${body.error.code}: ${body.error.message}`);
    }
    return body.result as T;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    // Memoize the in-flight handshake, not just the finished one. The old guard
    // only checked the resolved flag, which is set AFTER both awaits — so
    // concurrent callTools each ran their own initialize + notifications pair.
    // A 7-way Promise.allSettled did seven handshakes, all queued behind the
    // same 6-slot gate, for one logical read.
    if (!this.initializing) {
      this.initializing = (async () => {
        await this.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'hiveku-vscode', version: '0.1.0' },
        });
        await this.request('notifications/initialized', {}).catch(() => undefined);
        this.initialized = true;
      })().finally(() => {
        this.initializing = undefined;
      });
    }
    await this.initializing;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    await this.initialize();
    const result = await this.request<McpToolResult>(
      'tools/call',
      { name, arguments: args },
      toolTimeoutMs(name),
    );
    noteRegistryStamp(result?._meta);
    if (result?.isError) {
      const text = result.content?.[0]?.text ?? 'unknown tool error';
      throw new Error(`Tool ${name} errored: ${text}`);
    }
    return result;
  }

  /** Call a tool that returns a single JSON-serialized text block. */
  async callToolJson<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.callTool(name, args);
    const text = result?.content?.[0]?.text;
    if (typeof text !== 'string') {
      throw new Error(`Tool ${name} returned no text content`);
    }
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      throw new Error(`Tool ${name} returned non-JSON content: ${text.slice(0, 200)}`);
    }
    // The Olympus proxy returns backend failures as a NORMAL tool result whose
    // payload is `{error: string, status: number, ...}` (isError is never set).
    // Without this check every 4xx/5xx flows into callers as "data" — writes
    // report success, lists render empty. Sniff that exact shape and throw.
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;
      if (typeof p.error === 'string' && typeof p.status === 'number' && p.status >= 400) {
        // A deploy refusal (422 engines_unsatisfied / lockfile_out_of_sync)
        // carries the FIX in `hint` and the exact versions in `mismatches`
        // ([{package, declared, locked}]). The error alone names the
        // disagreement; without these the user sees the verdict but not the
        // fix, so both ride along in the one message the command surfaces.
        // The MCP proxy nests the route body under `details` ({error, status, details: {error, code, hint, mismatches}});
        // a direct route body carries them at the top level. Read whichever is present.
        const d = (p.details && typeof p.details === 'object' ? (p.details as Record<string, unknown>) : p);
        const mismatchLines = Array.isArray(d.mismatches)
          ? (d.mismatches as Array<{ package?: unknown; declared?: unknown; locked?: unknown } | null>)
              .filter((m): m is { package: string; declared?: unknown; locked?: unknown } => !!m && typeof m.package === 'string')
              .map((m) => `${m.package}: declared ${String(m.declared ?? '?')} vs locked ${String(m.locked ?? '?')}`)
          : [];
        const hint = typeof d.hint === 'string' && d.hint.trim() ? ` Fix: ${d.hint.trim()}` : '';
        throw new Error(
          `Tool ${name} failed (${p.status}): ${p.error}` +
            `${mismatchLines.length ? ` (${mismatchLines.join('; ')})` : ''}` +
            `${p.details ? ` — ${JSON.stringify(p.details).slice(0, 200)}` : ''}` +
            hint,
        );
      }
    }
    return parsed;
  }
}
