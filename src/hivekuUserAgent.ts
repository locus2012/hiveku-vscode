/**
 * Identify this extension to every server it talks to, and recognise the edge
 * firewall's answer when it does not.
 *
 * Hiveku hosting sits behind an edge firewall that challenges automated
 * clients which do not identify themselves. Any user agent containing
 * `Hiveku` passes, and HEAD requests are never challenged. undici's default
 * agent ("node") is exactly the non-browser signal the edge challenges, and
 * its answer to a client that cannot run JavaScript is HTTP 202 with an EMPTY
 * body and the header `x-amzn-waf-action: challenge` (405 with the same
 * header is the captcha). A 202 is `res.ok`, so a fetch that checks only `ok`
 * reads the challenge as an empty page - which is how a firewall answer gets
 * reported as "the site is empty" or "the deploy failed".
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

/** The subset of a fetch Response the challenge check reads (no DOM lib in tsconfig). */
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
