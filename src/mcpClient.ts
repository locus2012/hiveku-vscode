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

import { promisify } from 'util';
import { gzip } from 'zlib';
import { hivekuUserAgent } from './hivekuUserAgent';

const PROTOCOL_VERSION = '2024-11-05';

const gzipAsync = promisify(gzip);

/**
 * ★ EVERY BODY TO CORE GOES GZIP-COMPRESSED (HK-847): Content-Encoding gzip,
 * the Content-Type unchanged, and the JSON inside byte for byte what it was.
 *
 * The web edge in front of core.hiveku.com reads plain request bodies against
 * content rules nobody at Hiveku can see or change. On 2026-10-28 it answered a
 * pm_tasks_create from the Claude Code plugin with an HTML "Blocked" page
 * because of a file path in the task's text (HK-838), and the same body sent
 * gzip-compressed passed. The plugin sends every body this way since 0.27.111
 * (lib/upstream.mjs gzipBody). This client does the same, and so do the two
 * scripts this extension writes onto a machine (dataRunner.ts and
 * localAutomations.ts, through coreEdgeScript.ts).
 *
 * WHERE THE SERVER INFLATES IT (hiveku-mcp-api-server, checked 2026-10-29):
 * src/middleware/json-body.ts is its one JSON body parser, mounted app-wide in
 * src/index-unified-http.ts before every route. It inflates gzip and deflate
 * (body-parser's default) and counts its 30 MB limit after inflating, so a
 * compressed body has the ceiling a plain one had.
 *
 * Off the extension host's thread (zlib's own pool), so a large save does not
 * stall the window while it compresses.
 *
 * Only core: the extension's two posts to app.hiveku.com (connect.ts's code
 * exchange, extension.ts's key self-revoke) stay plain. The builder's routes
 * read request.json(), which does not inflate, and neither body carries
 * customer text for the edge to read.
 */
export function gzipJsonBody(message: unknown): Promise<Buffer> {
  return gzipAsync(Buffer.from(JSON.stringify(message), 'utf8'));
}

/**
 * ★ WHO REFUSED: HIVEKU, OR THE WEB EDGE IN FRONT OF IT (HK-847).
 *
 * 401, 403 and 429 come from both. Hiveku's MCP server sends each one as a
 * JSON-RPC error object: mcp-auth.ts for a revoked key (401) or a key used for
 * another account (403), rate-limiter.ts for its 429. The edge sends a page of
 * its own instead, and the request never reached Hiveku. So the BODY decides,
 * never the status alone:
 *  - Hiveku's own JSON-RPC error keeps the path it always had: `MCP HTTP 401:
 *    <body>` still reads as a dead key (tree.ts, console.ts), and a 429 still
 *    waits the server's Retry-After and is sent once more (request()).
 *  - Anything else on those statuses (an HTML page, a "Blocked" title, plain
 *    text, an empty body, JSON that is not a JSON-RPC error) is the edge
 *    refusing THIS request: McpEdgeRefusalError. It is never re-sent, never
 *    read as a key problem, and nothing is kept from it, so the next request
 *    goes out as usual. Erring that way costs one refused request; erring the
 *    other way tells the person a working key is dead.
 * 503 is not one of them: the proxy in front of Hiveku also answers 503 when a
 * deploy cuts a call it had already delivered, so a write behind it may have
 * landed (the plugin's REFUSAL_STATUSES says more). It keeps the generic path.
 */
const EDGE_REFUSAL_STATUSES = new Set([401, 403, 429]);

/** True for Hiveku's own error answer: JSON-RPC 2.0 whose `error` has a whole-number code and a string message. */
export function isHivekuErrorAnswer(text: string): boolean {
  if (!text.trim()) return false;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return false;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const { jsonrpc, error } = body as { jsonrpc?: unknown; error?: unknown };
  if (jsonrpc !== '2.0' || !error || typeof error !== 'object' || Array.isArray(error)) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return Number.isInteger(code) && typeof message === 'string';
}

/** A ray id is an id: only an id-shaped value is passed on. */
const RAY_HEADER_RE = /^[0-9a-f]{16}(?:-[a-z]{3,4})?$/i;
/** "Ray ID: <strong>8f1c...</strong>" in a block page, or "ray_id":"8f1c..." in a JSON one. */
const RAY_IN_PAGE_RE = /ray[\s_-]*id[\s\S]{0,80}?(?<![0-9a-z])([0-9a-f]{16})(?![0-9a-z])/i;

/**
 * The ray id the edge gave its refusal: the cf-ray header first (the id the
 * edge logs the request under), else one named in the page. null when neither
 * holds one.
 */
export function edgeRayId(headers: { get(name: string): string | null } | undefined, text: string): string | null {
  const header = String(headers?.get('cf-ray') ?? '').trim();
  if (RAY_HEADER_RE.test(header)) return header;
  const found = text.slice(0, 64 * 1024).match(RAY_IN_PAGE_RE);
  return found ? found[1] : null;
}

/**
 * Every refusal message below holds this phrase, so a reader that has only
 * the text (a dataset's error string, an error rethrown around this one) can
 * still tell it apart from Hiveku's own refusal. See isEdgeRefusal.
 */
export const EDGE_REFUSAL_MARK = 'the web edge in front of Hiveku';

/**
 * The words for a refusal from the web edge in front of Hiveku. They claim only
 * what this client knows: the edge refused this request, so it never reached
 * Hiveku, and Hiveku did not refuse the key. Not why: a rule on a request's text
 * is the usual cause (HK-838), but a rule on where requests come from answers
 * every request the same way, so a 401 or 403 says what to do then. The ray id
 * comes first, so a message cut short in a notification or a status file
 * still carries it. Plain words for the person who reads them: no vendor names.
 * hiveku-sync (src/mcp.mjs edgeRefusalMessage) says exactly this; the plugin
 * (lib/upstream.mjs edgeRefusalError) says the same facts to a model, with the
 * next steps a model has.
 */
export function coreEdgeRefusalMessage(status: number, rayId: string | null): string {
  const byText = status === 401 || status === 403;
  const label = rayId ? `HTTP ${status}, ray id ${rayId}` : `HTTP ${status}`;
  const give = rayId ? `ray id ${rayId}` : 'the time it happened';
  const what = byText
    ? `The web edge in front of Hiveku refused this one request (${label}), most often because of something in its text.`
    : `The web edge in front of Hiveku turned this one request away (${label}). It does that when it is busy, and also ` +
      "because of something in a request's text.";
  const next = byText
    ? 'Try it again with the text shortened or rephrased: code and file paths are the usual cause. If every request ' +
      'is refused this way, even a plain one, the block is on where the requests come from, not on their text: tell ' +
      `Hiveku support and give them ${give}.`
    : 'Wait a minute and try it once more. If it is turned away again, shorten or rephrase the text: code and file ' +
      `paths are the usual cause. If it keeps happening, tell Hiveku support and give them ${give}.`;
  return (
    `${what} It never reached Hiveku and nothing was saved. Hiveku did not refuse your key, so there is no need to ` +
    `reconnect: the next request is sent as usual. ${next}`
  );
}

/** The words for a 401, 403 or 429 whose answer could not be read, so who refused it is not known. */
export function coreRefusalUnreadMessage(status: number): string {
  return (
    `The answer to this request (HTTP ${status}) could not be read, so it is not known whether Hiveku or ` +
    `${EDGE_REFUSAL_MARK} refused it. It is not taken as a sign that your key stopped working: the next request ` +
    'is sent as usual. Try it once more.'
  );
}

/**
 * A 401, 403 or 429 that was not Hiveku's own JSON-RPC error. `edge_blocked`:
 * the edge's own page, so the request never reached Hiveku. `unreadable`: the
 * answer could not be read, so who refused it is not known. Neither is a key
 * problem, neither is re-sent, and nothing is kept from either.
 */
export class McpEdgeRefusalError extends Error {
  readonly kind: 'edge_blocked' | 'unreadable';
  readonly httpStatus: number;
  readonly rayId: string | null;
  constructor(kind: 'edge_blocked' | 'unreadable', httpStatus: number, rayId: string | null = null) {
    super(kind === 'edge_blocked' ? coreEdgeRefusalMessage(httpStatus, rayId) : coreRefusalUnreadMessage(httpStatus));
    this.name = 'McpEdgeRefusalError';
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.rayId = kind === 'edge_blocked' ? rayId : null;
  }
}

/**
 * True for a refusal that must never be read as a dead key or a reason to
 * reconnect: an McpEdgeRefusalError, or text that carries one's message (a
 * dataset's error string, an error rethrown with the message inside it). Every
 * reader that turns "401" into "your key expired" asks this first.
 */
export function isEdgeRefusal(err: unknown): boolean {
  if (err instanceof McpEdgeRefusalError) return true;
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return text.toLowerCase().includes(EDGE_REFUSAL_MARK.toLowerCase());
}

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
  // Rollback reads the target's files and writes a new version; the route is
  // maxDuration = 300. Like every entry here it is still capped at
  // EDGE_TIMEOUT_CEILING_MS (the edge closes the connection first), so a slow
  // apply can time out here while the server finishes it: versionFlows.ts
  // treats that as "not known", asks the dry run again, and never says
  // "nothing was changed" for it.
  project_vcs_rollback: 300_000,
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

/**
 * ★ The ceiling on a rate-limit sleep, and why it is a full minute.
 *
 * The server's limiter is a FIXED 60-second window and its 429 advertises the
 * true remaining time — `retryAfterMs = windowMs - (now - entry.windowStart)`
 * in hiveku-mcp-api-server/src/middleware/rate-limiter.ts — so the wait it asks
 * for is anything up to 60s. The old ceiling was 30s, which meant a burst
 * landing early in a window ALWAYS woke while the window was still shut, spent
 * its one retry on a second 429, and reported a failure the server had already
 * told us how to avoid. Sleeping less than the server asked for is not caution;
 * it is a retry timed to fail.
 */
const RATE_LIMIT_MAX_RETRY_SECONDS = 60;

/** At least a second, never past a full window, always a whole number. */
function clampRetrySeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 15;
  return Math.min(Math.max(Math.ceil(seconds), 1), RATE_LIMIT_MAX_RETRY_SECONDS);
}

/**
 * A 429 carrying the delay the SERVER asked for, rather than one parsed back
 * out of the sentence it wrote. requestOnce throws this; request() sleeps it.
 */
class McpRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'McpRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Fallback for a rate-limit rejection that did NOT arrive as a 429 with a
 * `Retry-After` header — a proxy that strips the header, or a limiter that
 * answers 200 with a JSON-RPC error body. Reads the delay out of the prose.
 */
function rateLimitRetrySeconds(message: string): number | null {
  if (!/rate limit/i.test(message)) return null;
  const m = message.match(/retry[_ ]after[_ :]*(\d+)/i);
  return clampRetrySeconds(m ? Number(m[1]) : 15);
}

/**
 * A tool call the server answered with a failure. `message` (and `name`) are
 * exactly what a plain Error carried before, so every existing catch reads the
 * same text; `payload` is the parsed failure body ({error, status, details, ...}
 * from the Olympus proxy) for the few callers that act on a specific refusal,
 * such as workflow_enable's 422 workflow_invalid. undefined when the body was
 * not JSON.
 */
export class McpToolError extends Error {
  readonly tool: string;
  readonly payload: unknown;
  constructor(message: string, tool: string, payload: unknown) {
    super(message);
    this.tool = tool;
    this.payload = payload;
  }
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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
      // The edge refusing this one request is not Hiveku's rate limit: it is
      // never slept on and sent again (EDGE_REFUSAL_STATUSES).
      if (err instanceof McpEdgeRefusalError) throw err;
      // A typed 429 already carries the server's own figure; anything else has
      // to be read out of the message, which is strictly the weaker source.
      const retryAfter = err instanceof McpRateLimitError
        ? err.retryAfterSeconds
        : rateLimitRetrySeconds(err instanceof Error ? err.message : String(err));
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
      // The body is gzip, so the edge's content rules never read it (gzipJsonBody).
      'Content-Encoding': 'gzip',
      Accept: 'application/json',
      // Server buckets extension traffic separately from agent sessions.
      'X-Hiveku-Client': 'vscode-extension',
      // Every Hiveku client identifies itself; X-Hiveku-Client is a header the
      // edge firewall does not read (see hivekuUserAgent.ts).
      'User-Agent': hivekuUserAgent(),
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    // Hard timeout: a single stalled request must never hang a surface forever
    // (seen live: the Account Console stuck on "Loading…" behind one dead await).
    //
    // A tool call waits as long as the server may legitimately take — see
    // DEFAULT_TOOL_TIMEOUT_MS. Giving up early does not stop the work; it only
    // makes the extension report a failure for something that then succeeds.
    const budget = timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const gzipped = await gzipJsonBody({ jsonrpc: '2.0', id, method, params });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), budget);
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: gzipped,
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
      let read: string | null;
      try {
        read = await res.text();
      } catch {
        read = null;
      } finally {
        clearTimeout(timer);
      }
      // ★ A 401, 403 or 429 is classified by its body before anything reads it
      // as a dead key or a rate limit (EDGE_REFUSAL_STATUSES).
      if (EDGE_REFUSAL_STATUSES.has(res.status)) {
        if (read === null) throw new McpEdgeRefusalError('unreadable', res.status);
        if (!isHivekuErrorAnswer(read)) throw new McpEdgeRefusalError('edge_blocked', res.status, edgeRayId(res.headers, read));
      }
      const text = read ?? '';
      const detail = `MCP HTTP ${res.status}: ${text.slice(0, 500)}`;
      if (res.status === 429) {
        // `Retry-After` is the limiter's own remaining-window figure in whole
        // seconds. Take it over the prose, which is the same number rendered
        // into a sentence and can be reworded at any time.
        const header = Number(res.headers.get('retry-after'));
        const seconds = header > 0 ? clampRetrySeconds(header) : (rateLimitRetrySeconds(text) ?? 15);
        throw new McpRateLimitError(detail, seconds);
      }
      throw new Error(detail);
    }
    if (res.status === 204) {
      // Nothing to read, so nothing for the timer to bound: without this it
      // stayed armed for the whole budget after every handshake.
      clearTimeout(timer);
      return null as T;
    }

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
      throw new McpToolError(`Tool ${name} errored: ${text}`, name, parseJsonOrUndefined(text));
    }
    return result;
  }

  /**
   * The names of the tools this key may call (tools/list, filtered server-side
   * to the key's scope and profile). One request that returns the whole
   * registry, so callers cache it: versions.ts serverCaps() asks once per
   * client, and a reconnect makes a new client, which asks again.
   */
  async listToolNames(): Promise<string[]> {
    await this.initialize();
    const result = await this.request<{ tools?: Array<{ name?: unknown }>; _meta?: McpToolResult['_meta'] }>(
      'tools/list',
      {},
      EDGE_TIMEOUT_CEILING_MS,
    );
    noteRegistryStamp(result?._meta);
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools.map((t) => t?.name).filter((n): n is string => typeof n === 'string' && n.length > 0);
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
        throw new McpToolError(
          `Tool ${name} failed (${p.status}): ${p.error}` +
            `${mismatchLines.length ? ` (${mismatchLines.join('; ')})` : ''}` +
            `${p.details ? ` — ${JSON.stringify(p.details).slice(0, 200)}` : ''}` +
            hint,
          name,
          parsed,
        );
      }
    }
    return parsed;
  }
}
