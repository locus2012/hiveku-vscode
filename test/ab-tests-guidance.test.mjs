/**
 * What the Website Pages, Ads and SEO departments tell an agent about page A/B tests.
 *
 *   - Website Pages: the second version is changed in the copy's own files (never the
 *     original's), deployed to production, and only then is the test started. While a test runs
 *     or is paused neither page changes: a change mixes two versions into one result, so a page
 *     that must change means ending the test (or ending it and starting a new one) and saying why.
 *   - Ads: list the site's tests before a budget, bid, targeting, audience or final-URL change on
 *     a campaign that lands on a tested page; final URLs stay on the original; a route sends one
 *     platform's clicks to its own page; page tests are not campaign experiments.
 *   - SEO: the test copy is canonical and out of the sitemap on purpose (the canonical travels in
 *     the HTTP headers, and a route's page gets none), the A/B redirect is a temporary 302, and a
 *     running or recently ended test is ruled out first.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';

const { DEPARTMENTS } = loadOut('deptData');
const crud = (id) => DEPARTMENTS.find((d) => d.id === id).crud.replace(/`/g, '').replace(/\s+/g, ' ');

test('Website Pages: edit the copy, deploy, then start; change neither page during a test', () => {
  const pages = crud('pages');
  assert.ok(pages.includes("To change the second version, edit the copy's own files (never the original's), deploy to production, then start the test"));
  assert.ok(pages.includes('While a test runs or is paused, change neither page, the original or the second version: a change mixes two versions into one result.'));
  assert.ok(pages.includes('If a page must change, end the test (or end it and start a new one) and say why.'));
});

test('Ads: list the tests before a spend or URL change, final URLs on the original, routes, not campaign experiments', () => {
  const ppc = crud('ppc');
  assert.ok(ppc.includes('before a budget, bid, targeting, audience or final-URL change on a campaign that lands on a page with a running test or route, list the site\'s tests (project_ab_tests_list'));
  assert.ok(ppc.includes('hold the change or say plainly that it skews the result.'));
  assert.ok(ppc.includes('Keep ad final URLs on the original page: the split happens on the site and keeps gclid and UTM tags.'));
  assert.ok(ppc.includes("A route can send one ad platform's clicks to a page of its own without changing the ad."));
  assert.ok(ppc.includes("Page A/B tests are not the ad platforms' own campaign experiments."));
});

test('SEO: the copy is canonical and out of the sitemap on purpose, the redirect is a 302, rule out a test first', () => {
  const seo = crud('seo');
  assert.ok(seo.includes('a test copy (an address like /pricing-b) is canonical to the original while its test runs and is kept out of the sitemap on purpose'));
  assert.ok(seo.includes('do not index it, link to it, add it to the sitemap or "fix" it as duplicate content.'));
  assert.ok(seo.includes('The A/B redirect is a temporary 302.'));
  // The edge sends the canonical as an HTTP header, and never for a route's page.
  assert.ok(seo.includes("The canonical is sent in the page's HTTP headers, not in its HTML, so an audit that reads only the HTML reports it missing."));
  assert.ok(seo.includes("A route's page gets no canonical."));
  assert.ok(seo.includes('rule out a running or recently ended test or route (project_ab_tests_list'));
});
