/**
 * What a site folder's CLAUDE.md says about the CDN cache (HK-1166).
 *
 * A publish that finishes asks for a full clear of that environment at its end: in hiveku_builder,
 * tenant-deploy.ts invalidates `/*` on the tier's tenant, and the per-site lanes call invalidateCache
 * (cloudfront-lambda-hosting.ts, cloudfront-s3-hosting.ts). The guide used to say "deploying does NOT
 * invalidate", the same wrong sentence the MCP took out of project_cdn_invalidate, so an agent cleared
 * after every deploy. Each clear now asks the person, is billed past the free allowance, spends a limit
 * of 6 an hour per environment and 40 a day per account, and is refused while a deploy of that
 * environment runs. Pinned:
 *   1. the guide never says a deploy leaves the cache as it was;
 *   2. it says what a publish asks for, and when a clear is the next step;
 *   3. it sends an agent to project_cache_clear, with project_cdn_invalidate as the same clear under its
 *      older name for as long as the MCP does not offer the new one, after asking the person, within
 *      the limits, never in a loop;
 *   4. a running deploy and a used-up limit are waited out, never published past;
 *   5. the passage names no hosting vendor and no cache policy.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const knowledge = loadOut('knowledge');

const dirs = [];
after(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

/** A scaffolded site folder's CLAUDE.md, whitespace folded. */
async function siteGuide() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hk-cache-guide-'));
  dirs.push(dir);
  await knowledge.writeProjectScaffold({
    baseDir: dir,
    accountLabel: 'Acme',
    apiKey: 'olp_test_key_123',
    baseUrl: 'https://core.hiveku.com',
    accountId: '0b6f1c2e-1111-4a4a-9c9c-222233334444',
    projectId: '11111111-2222-3333-4444-555555555555',
    projectName: 'Main site',
  });
  return (await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).replace(/\s+/g, ' ');
}

const HEADING = '- **Deployed but the live site still shows the OLD version?**';

/** The bullet that answers a stale live site, up to the next bullet. */
function staleSiteBullet(guide) {
  const start = guide.indexOf(HEADING);
  assert.ok(start >= 0, 'the guide has the stale live site bullet');
  const next = guide.indexOf(' - **', start + HEADING.length);
  return guide.slice(start, next < 0 ? undefined : next);
}

describe("a site folder's CLAUDE.md on the CDN cache", () => {
  test('never says a deploy leaves the cache as it was', async () => {
    const guide = await siteGuide();
    assert.doesNotMatch(guide, /does not invalidate|deploy(?:ing)? does not (?:clear|invalidate)/i);
  });

  test('says what a publish asks for, and when a clear is the next step', async () => {
    const bullet = staleSiteBullet(await siteGuide());
    assert.match(bullet, /A publish that finishes asks for a full clear of that environment's CDN cache at its end/);
    assert.match(bullet, /do not clear right after a publish/);
    assert.match(bullet, /Clear only for a file that is still old a few minutes after the publish finished, or for a change made WITHOUT a publish/);
  });

  test('names the clear and its older name, asks the person first, within the limits, never in a loop', async () => {
    const bullet = staleSiteBullet(await siteGuide());
    assert.ok(bullet.includes('`project_cache_clear({ project_id, environment })`'), bullet);
    assert.match(bullet, /`project_cdn_invalidate\(\{ project_id, environment, action: "invalidate" \}\)` is the same clear under its older name/);
    assert.match(bullet, /ASK THE PERSON FIRST: each clear costs money and is limited to 6 an hour per environment and 40 a day per account/);
    assert.match(bullet, /never call it in a loop/);
    assert.ok(bullet.includes('`project_cache_clear_status`'), bullet);
    assert.match(bullet, /`pages_kept_at_edge` says whether pages outside the asset folders are kept \(when it is false, never tell the person those pages were cleared\)/);
  });

  test('waits out a running deploy and a used-up limit, and never publishes past either', async () => {
    const bullet = staleSiteBullet(await siteGuide());
    assert.match(bullet, /refused \(`deploy_in_progress`\): wait, since that deploy asks for a full clear when it finishes/);
    assert.match(bullet, /On `429 rate_limited`, wait `retry_after_seconds` and never publish instead/);
  });

  test('names no hosting vendor and no cache policy', async () => {
    const bullet = staleSiteBullet(await siteGuide());
    assert.doesNotMatch(bullet, /CloudFront|Managed-Caching|CachingOptimized|AWS|\bS3\b|\bTTL\b/);
    assert.doesNotMatch(bullet, /—|–/, 'no em or en dash');
  });
});
