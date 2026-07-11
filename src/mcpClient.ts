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

export interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export class HivekuMcpClient {
  private baseUrl: string;
  private apiKey: string;
  private profile: string;
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

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

  private async request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    // Hard timeout: a single stalled request must never hang a surface forever
    // (seen live: the Account Console stuck on "Loading…" behind one dead await).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (ctrl.signal.aborted) throw new Error(`MCP request timed out after 60s (${method})`);
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const sessionHeader = res.headers.get('mcp-session-id');
    if (sessionHeader) this.sessionId = sessionHeader;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    if (res.status === 204) return null as T;

    const body = (await res.json()) as { error?: { code: number; message: string }; result?: T };
    if (body.error) {
      throw new Error(`MCP error ${body.error.code}: ${body.error.message}`);
    }
    return body.result as T;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'hiveku-vscode', version: '0.1.0' },
    });
    await this.request('notifications/initialized', {}).catch(() => undefined);
    this.initialized = true;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    await this.initialize();
    const result = await this.request<McpToolResult>('tools/call', { name, arguments: args });
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
        throw new Error(`Tool ${name} failed (${p.status}): ${p.error}${p.details ? ` — ${JSON.stringify(p.details).slice(0, 200)}` : ''}`);
      }
    }
    return parsed;
  }
}
