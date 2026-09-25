/**
 * Identify this extension to every server it talks to, and recognise the edge
 * firewall's answer when it does not.
 *
 * Hiveku hosting sits behind an edge firewall that refuses automated clients
 * which do not identify themselves. A user agent containing `Hiveku`, and any
 * HEAD request, is never challenged or blocked as an automated client (the
 * per-IP limit, HTTP 429, and the network block below still apply to them).
 * undici's default agent ("node") is exactly the non-browser signal the edge
 * looks for. The firewall's answers:
 *
 * - An automated client the firewall cannot identify gets a 202 challenge
 *   (empty body, `x-amzn-waf-action: challenge`; 405 with the same header is
 *   the captcha) or a 403 with `x-hiveku-firewall: blocked`.
 * - A request from a known bulk-scraper network gets a 403 with
 *   `x-hiveku-firewall: blocked-network`.
 * - A 403 without that header comes from the site itself (an auth route, an
 *   expired signed link, a missing file), never from the firewall.
 *
 * A 202 is `res.ok`, so a fetch that checks only `ok` reads the challenge as
 * an empty page - which is how a firewall answer gets reported as "the site is
 * empty" or "the deploy failed". The 403 is not `ok`, but a caller that shows
 * only "HTTP 403" blames the site for the firewall's refusal. Read the header,
 * never the 403's body text: the body is a short plain-text note meant for
 * people and may change.
 *
 * Convention (notes/edge-firewall-and-identify-yourself-2026-09-18.md):
 * `Hiveku<Component>/<version> (+https://hiveku.com)`. The edge checks only
 * that the string contains `Hiveku`; the rest is for the customer's logs.
 *
 * No `vscode` import here, on purpose. src/deptData.ts pulls src/mcpClient.ts
 * into the build scripts (scripts/register-ts.mjs), which run under plain Node
 * where the vscode module does not exist; and the two script writers
 * (localAutomations.ts, dataRunner.ts) bake the version into files that run
 * outside the extension host altogether. The version therefore comes from the
 * installed package.json, which the VSIX ships beside out/.
 */
import * as fs from 'fs';
import * as path from 'path';

let cachedVersion: string | undefined;

/** The installed extension's version from package.json; "0.0.0" when it cannot be read. */
export function extensionVersion(): string {
  if (cachedVersion) return cachedVersion;
  let version = '0.0.0';
  try {
    // Compiled output runs from out/, so package.json is one level up from
    // __dirname (the same read agencySkills.ts does for assets/). Under an ESM
    // loader __dirname is undefined and the read throws; the fallback keeps
    // the agent well-formed either way.
    const raw = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string' && /^\d+\.\d+\.\d+/.test(parsed.version)) version = parsed.version;
  } catch {
    /* unreadable - keep the fallback */
  }
  cachedVersion = version;
  return version;
}

/**
 * `HivekuVSCode/<version> (+https://hiveku.com)` for the extension host; the
 * generated scripts pass their own component name (HivekuLocalAutomation,
 * HivekuDataRunner) so a customer's logs say which Hiveku client called.
 */
export function hivekuUserAgent(component = 'HivekuVSCode'): string {
  return `${component}/${extensionVersion()} (+https://hiveku.com)`;
}

/** The subset of a fetch Response the firewall checks read (no DOM lib in tsconfig). */
export interface ChallengeCheckable {
  status: number;
  headers: { get(name: string): string | null };
}

/**
 * True when a response is the edge firewall's challenge rather than the page:
 * any response carrying `x-amzn-waf-action`, or a 202 whose body is empty or
 * tiny (a real page is never a 202). Pass `bodyBytes` when the body has been
 * read; without it a bare 202 counts, since nothing this extension fetches
 * legitimately answers 202.
 */
export function isEdgeChallenge(res: ChallengeCheckable, bodyBytes?: number): boolean {
  if (res.headers.get('x-amzn-waf-action')) return true;
  if (res.status !== 202) return false;
  return bodyBytes === undefined || bodyBytes < 1024;
}

/** What a person reads when a request was challenged. Never "empty site", never "deploy failed". */
export const EDGE_CHALLENGE_MESSAGE =
  'the edge firewall challenged this client (HTTP 202 with an empty body, or an x-amzn-waf-action header). ' +
  'Send a user agent containing Hiveku, or use a HEAD request. This is not an empty site and not a failed deploy.';

/** The header the edge firewall sets on its own 403. */
export const FIREWALL_BLOCK_HEADER = 'x-hiveku-firewall';

/**
 * `blocked`: an automated client the firewall cannot identify.
 * `blocked-network`: a request from a known bulk-scraper cloud network.
 */
export type EdgeBlockKind = 'blocked' | 'blocked-network';

/**
 * Which firewall block a response is, or null when it is not one. Only a 403
 * whose `x-hiveku-firewall` header is exactly `blocked` or `blocked-network`
 * (any case) counts. A 403 without that header is the site's own answer and
 * returns null; the body is never read.
 */
export function edgeBlockKind(res: ChallengeCheckable): EdgeBlockKind | null {
  if (res.status !== 403) return null;
  const value = (res.headers.get(FIREWALL_BLOCK_HEADER) ?? '').trim().toLowerCase();
  return value === 'blocked' || value === 'blocked-network' ? value : null;
}

/** True when a response is the edge firewall's 403 block (see edgeBlockKind). */
export function isEdgeBlock(res: ChallengeCheckable): boolean {
  return edgeBlockKind(res) !== null;
}

/** True when the edge firewall refused the request: its challenge or its block. */
export function isEdgeRefusal(res: ChallengeCheckable, bodyBytes?: number): boolean {
  return isEdgeChallenge(res, bodyBytes) || isEdgeBlock(res);
}

/** What a person reads when the firewall blocked an automated client it cannot identify. */
export const EDGE_BLOCK_MESSAGE =
  'the edge firewall blocked this client as an automated client it cannot identify (HTTP 403 with x-hiveku-firewall: blocked). ' +
  'Send a user agent containing Hiveku, or use a HEAD request; a service that is not Hiveku needs the site owner ' +
  "to allow it in the Firewall section of the site's hosting settings. This is not an empty site and not a failed deploy.";

/** What a person reads when the firewall blocked the network the request came from. */
export const EDGE_NETWORK_BLOCK_MESSAGE =
  'the edge firewall blocked this request because it came from a known bulk-scraper network ' +
  '(HTTP 403 with x-hiveku-firewall: blocked-network). A Hiveku user agent and a firewall allowance do not lift ' +
  'this block; send the request from another network. This is not an empty site and not a failed deploy.';

/**
 * The sentence for a firewall refusal, or null when the response is not one
 * (including a 403 without the firewall header, which is the site's own).
 * The block is read first: its header names exactly which refusal it is.
 */
export function edgeRefusalMessage(res: ChallengeCheckable, bodyBytes?: number): string | null {
  const block = edgeBlockKind(res);
  if (block === 'blocked') return EDGE_BLOCK_MESSAGE;
  if (block === 'blocked-network') return EDGE_NETWORK_BLOCK_MESSAGE;
  return isEdgeChallenge(res, bodyBytes) ? EDGE_CHALLENGE_MESSAGE : null;
}
