/**
 * Account Console — one panel to RUN and READ a whole account from VS Code.
 *   • Tasks       — PM tasks grouped by status (board), complete inline
 *   • Automations — workflows (run / enable / disable) + recent runs
 *   • One tab per ENTITLED department (SEO, Ads, CRM, Social, Content, Email)
 *     rendering that department's data (rankings, backlinks, deals, …) as tables,
 *     from the shared registry (deptData.ts) that also drives the local export.
 * A header "Download data" button writes the same data to hiveku-data/ for Claude
 * Code. Tabs are gated to the account's plan/role; tools are tolerant of failure.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import type { AccountRecord } from './accounts';
import { departmentById, extractRows, fetchDataset, mapLimit, type Column, type Row } from './deptData';
import { moduleById } from './modules';
import { openModulePanel } from './panel';
import { openTaskDetail } from './taskDetail';
import { effectiveDepartments } from './roles';
import { SETUP_PROMPTS, setupPromptById } from './setupPrompts';

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;

const panels = new Map<string, vscode.WebviewPanel>();

// ── Console lifecycle diagnostics (persisted to a file so support can read it) ──
import * as os from 'os';
import * as fsp from 'fs/promises';
const DIAG = path.join(os.homedir(), '.hiveku-console-debug.log');
function diag(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`;
  void fsp.appendFile(DIAG, line).catch(() => undefined);
}

/** Console dept tab -> the Operate module with the write actions for it. */
const DEPT_TO_MODULE: Record<string, string> = {
  crm: 'crm', seo: 'seo', localseo: 'seo', aeo: 'seo', ppc: 'ppc', email: 'email',
  social: 'social', content: 'content', creative: 'creative', accounting: 'accounting',
  helpdesk: 'helpdesk', pm: 'pm', workflows: 'workflows', voice: 'voice',
  outbound: 'outbound', knowledge: 'knowledge', commerce: 'commerce', hiveboards: 'collab', mc: 'mc',
};

// ── value helpers (dot-path pick + money/date format), shared with the webview shape ──
function pick(row: Row, key: string | string[]): unknown {
  const keys = Array.isArray(key) ? key : [key];
  for (const k of keys) {
    const v = k.includes('.') ? k.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Row)[p] : undefined), row) : row[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}
function fmt(v: unknown, c: Column): string {
  if (v === undefined || v === null) return '';
  if (c.money) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isNaN(n)) {
      const x = c.cents ? n / 100 : n;
      const a = Math.abs(x);
      if (a >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
      if (a >= 1e3) return `$${(x / 1e3).toFixed(1)}k`;
      return `$${Number.isInteger(x) ? x : x.toFixed(2)}`;
    }
  }
  if (c.date) {
    const t = Date.parse(String(v));
    if (!Number.isNaN(t)) return new Date(t).toLocaleDateString();
  }
  if (typeof v === 'object') return (v as Row).name as string ?? (v as Row).title as string ?? JSON.stringify(v);
  return String(v);
}


// ── Real dashboards for PPC + SEO (KPIs, deltas, drill-down) ─────────────────
// Raw dataset tables are what Claude Code needs; a MANAGER needs spend/clicks/
// conversions with period deltas and campaign drill-down. Metric field names
// are DB-verified (ppc_campaign_metrics) / GSC-standard.

interface MetricSum { cost: number; clicks: number; impressions: number; conversions: number; value: number; }
const zeroSum = (): MetricSum => ({ cost: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 });
function addRow(sum: MetricSum, r: Row): void {
  sum.cost += Number(r.cost ?? 0) || 0;
  sum.clicks += Number(r.clicks ?? 0) || 0;
  sum.impressions += Number(r.impressions ?? 0) || 0;
  sum.conversions += Number(r.conversions ?? 0) || 0;
  sum.value += Number(r.conversion_value ?? 0) || 0;
}
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

async function loadPpcDashboard(client: HivekuMcpClient): Promise<Record<string, unknown>> {
  const [campaignsRaw, disapprovals] = await Promise.all([
    client.callToolJson<unknown>('ppc_campaign_list', { limit: 200 }).catch((e) => ({ error: String(e) })),
    client.callToolJson<unknown>('ppc_disapprovals_list', { limit: 500 }).catch(() => ({})),
  ]);
  const campaigns = extractRows(campaignsRaw);
  if (campaigns.length === 0) {
    const err = (campaignsRaw as { error?: string })?.error;
    return { kind: 'ppcdash', empty: true, error: err, days: 28 };
  }
  const since = isoDaysAgo(56);
  const cutoff = isoDaysAgo(28);
  const rows = await mapLimit(campaigns.slice(0, 60), 5, async (c) => {
    const cur = zeroSum();
    const prev = zeroSum();
    try {
      const daily = extractRows(await client.callToolJson<unknown>('ppc_metrics', { campaign_id: c.id, since, limit: 200 }));
      for (const d of daily) addRow(String(d.date ?? '') >= cutoff ? cur : prev, d);
    } catch {
      /* campaign without metrics — show zeros */
    }
    return {
      id: c.id,
      name: c.name ?? '(campaign)',
      platform: c.platform ?? '',
      status: c.status ?? '',
      budget: Number(c.budget_amount ?? c.daily_budget ?? 0) || undefined,
      connection_id: c.connection_id,
      cur,
      prev,
    };
  });
  rows.sort((a, b) => b.cur.cost - a.cur.cost);
  const totals = { cur: zeroSum(), prev: zeroSum() };
  for (const r of rows) {
    for (const k of Object.keys(totals.cur) as Array<keyof MetricSum>) {
      totals.cur[k] += r.cur[k];
      totals.prev[k] += r.prev[k];
    }
  }
  const alerts: string[] = [];
  const disCount = extractRows(disapprovals).length;
  if (disCount > 0) alerts.push(`${disCount} disapproved ad(s) — fix in Operate`);
  const spendNoConv = rows.filter((r) => r.cur.cost > 0 && r.cur.conversions === 0).length;
  if (spendNoConv > 0) alerts.push(`${spendNoConv} campaign(s) spending with 0 conversions (28d)`);
  // Stale detector: campaigns exist but zero metrics anywhere = the local mirror
  // hasn't synced from the ad platform (campaign statuses are stale too).
  const stale = rows.length > 0 && totals.cur.cost === 0 && totals.cur.clicks === 0 && totals.cur.impressions === 0 && totals.prev.cost === 0 && totals.prev.impressions === 0;
  return { kind: 'ppcdash', days: 28, totals, campaigns: rows, alerts, stale };
}

async function ppcDrill(client: HivekuMcpClient, campaignId: string): Promise<Record<string, unknown>> {
  const [dailyRaw, groupsRaw] = await Promise.all([
    client.callToolJson<unknown>('ppc_metrics', { campaign_id: campaignId, since: isoDaysAgo(14), limit: 30 }).catch(() => ({})),
    client.callToolJson<unknown>('ppc_ad_group_list', { limit: 500 }).catch(() => ({})),
  ]);
  const daily = extractRows(dailyRaw)
    .map((d) => ({ date: String(d.date ?? '').slice(0, 10), cost: Number(d.cost ?? 0), clicks: Number(d.clicks ?? 0), conversions: Number(d.conversions ?? 0), ctr: Number(d.ctr ?? 0) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const adGroups = extractRows(groupsRaw)
    .filter((g) => g.campaign_id === campaignId)
    .map((g) => ({ id: String(g.id ?? ''), name: g.name ?? '(ad group)', status: g.status ?? '' }));
  return { daily, adGroups };
}

async function loadSeoDashboard(client: HivekuMcpClient): Promise<Record<string, unknown>> {
  const start28 = isoDaysAgo(28);
  const start56 = isoDaysAgo(56);
  const [curR, prevR, pagesR, trackedR, auditsR] = await Promise.allSettled([
    client.callToolJson<unknown>('seo_gsc_search_analytics', { dimensions: ['query'], start: start28, row_limit: 500 }),
    client.callToolJson<unknown>('seo_gsc_search_analytics', { dimensions: ['query'], start: start56, end: start28, row_limit: 500 }),
    client.callToolJson<unknown>('seo_gsc_search_analytics', { dimensions: ['page'], start: start28, row_limit: 100 }),
    client.callToolJson<unknown>('seo_tracked_keywords_list', {}),
    client.callToolJson<unknown>('seo_list_audits', {}),
  ]);
  const gscError = curR.status === 'rejected' ? String(curR.reason instanceof Error ? curR.reason.message : curR.reason) : undefined;
  const norm = (r: Row) => ({
    key: String(Array.isArray(r.keys) ? (r.keys as unknown[])[0] : (r.query ?? r.page ?? '?')),
    clicks: Number(r.clicks ?? 0),
    impressions: Number(r.impressions ?? 0),
    ctr: Number(r.ctr ?? 0),
    position: Number(r.position ?? 0),
  });
  const cur = curR.status === 'fulfilled' ? extractRows(curR.value).map(norm) : [];
  const prev = prevR.status === 'fulfilled' ? extractRows(prevR.value).map(norm) : [];
  const pages = pagesR.status === 'fulfilled' ? extractRows(pagesR.value).map(norm) : [];
  const sumSide = (list: ReturnType<typeof norm>[]) => {
    const t = { clicks: 0, impressions: 0, wpos: 0 };
    for (const q of list) {
      t.clicks += q.clicks;
      t.impressions += q.impressions;
      t.wpos += q.position * q.impressions;
    }
    return { clicks: t.clicks, impressions: t.impressions, ctr: t.impressions ? t.clicks / t.impressions : 0, position: t.impressions ? t.wpos / t.impressions : 0 };
  };
  const prevByKey = new Map(prev.map((q) => [q.key, q]));
  const topQueries = cur.slice(0, 40).map((q) => {
    const p = prevByKey.get(q.key);
    return { ...q, dClicks: q.clicks - (p?.clicks ?? 0), dPos: p ? Math.round((p.position - q.position) * 10) / 10 : undefined };
  });
  const tracked = trackedR.status === 'fulfilled' ? extractRows(trackedR.value) : [];
  const positions = tracked.map((k) => Number(k.position ?? k.rank ?? 0)).filter((n) => n > 0);
  const bucket = (lo: number, hi: number) => positions.filter((p) => p >= lo && p <= hi).length;
  const audits = auditsR.status === 'fulfilled' ? extractRows(auditsR.value) : [];
  const latestAudit = audits[0];
  return {
    kind: 'seodash',
    days: 28,
    gscError,
    totals: { cur: sumSide(cur), prev: sumSide(prev) },
    topQueries,
    topPages: pages.slice(0, 20),
    tracked: { count: tracked.length, top3: bucket(1, 3), top10: bucket(1, 10), top50: bucket(1, 50) },
    audit: latestAudit ? { status: latestAudit.status, score: latestAudit.score ?? latestAudit.health_score, when: latestAudit.created_at } : undefined,
  };
}


/**
 * Live integration status for the Connect tab: what is CONNECTED (with state)
 * per area, so the user can finally see which of SEO / Local SEO / PPC / email /
 * social is wired and which needs setup. All reads, all tolerant.
 */
async function loadIntegrations(client: HivekuMcpClient): Promise<Record<string, unknown>> {
  const [ppc, seoConn, domains, social, integ, inbox] = await Promise.allSettled([
    client.callToolJson<unknown>('ppc_connection_list', {}),
    client.callToolJson<unknown>('seo_connections_list', {}),
    client.callToolJson<unknown>('email_domain_list', {}),
    client.callToolJson<unknown>('social_list_accounts', {}),
    client.callToolJson<unknown>('integration_list', {}),
    client.callToolJson<unknown>('crm_inbox_connections', {}),
  ]);
  const rows = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' ? extractRows(r.value) : []);
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  const connected: Array<{ area: string; label: string; status: string; detail: string }> = [];
  for (const c of rows(ppc)) {
    connected.push({ area: 'Ads (PPC)', label: str(c.display_name || c.name || c.platform), status: str(c.connection_status || c.status || 'connected'), detail: [str(c.platform), c.customer_id ? `customer ${str(c.customer_id)}` : '', c.campaign_count !== undefined ? `${str(c.campaign_count)} campaigns` : ''].filter(Boolean).join(' · ') });
  }
  for (const c of rows(seoConn)) {
    // connection_status can say "connected" while last_error carries a dead
    // token (seen live: GSC "connected" + "Token refresh failed") — the error wins.
    const err = str(c.last_error);
    connected.push({
      area: 'SEO / Local SEO',
      label: str(c.display_name || c.platform || c.provider || 'connection'),
      status: err ? 'error' : str(c.connection_status || c.status || 'connected'),
      detail: [str(c.site_url || c.property || ''), err ? err.split('|')[0].trim().slice(0, 90) : ''].filter(Boolean).join(' · '),
    });
  }
  for (const c of rows(domains)) {
    connected.push({ area: 'Email', label: str(c.domain || c.name), status: str(c.status || (c.verified ? 'verified' : 'pending')), detail: c.is_default ? 'default sending domain' : '' });
  }
  for (const c of rows(inbox)) {
    connected.push({ area: 'Email', label: str(c.email || c.address || c.provider || 'inbox'), status: str(c.status || 'connected'), detail: 'sending inbox' });
  }
  for (const c of rows(social)) {
    connected.push({ area: 'Social', label: str(c.display_name || c.name || c.username), status: str(c.status || 'connected'), detail: str(c.platform) });
  }
  for (const c of rows(integ)) {
    connected.push({ area: 'Integrations', label: str(c.provider_slug || c.provider || c.name), status: str(c.status || (c.is_active === false ? 'inactive' : 'active')), detail: str(c.name && c.provider_slug ? c.name : '') });
  }
  return { kind: 'connect', connected };
}


/**
 * Analytics + Visitor Intelligence dashboard. Traffic KPIs across the account's
 * sites (28d vs prior, ClickHouse-backed overview route) + the SDR/BDR chase
 * list: ICP-matched + recently-identified visitors (analytics_visitors).
 */
async function loadAnalyticsDashboard(client: HivekuMcpClient): Promise<Record<string, unknown>> {
  const start28 = isoDaysAgo(28);
  const start56 = isoDaysAgo(56);
  const sitesRaw = await client.callToolJson<unknown>('sites_list', { limit: 50 }).catch(() => ({}));
  const sites = extractRows(sitesRaw).filter((x) => x.project_type !== 'external').slice(0, 10);
  interface Ov { total_sessions: number; unique_visitors: number; total_page_views: number; bounce_rate: number; }
  const zero: Ov = { total_sessions: 0, unique_visitors: 0, total_page_views: 0, bounce_rate: 0 };
  const readOv = (raw: unknown): { m: Ov; landing: Array<{ page: string; count: number }>; sources?: unknown } => {
    const d = ((raw as Record<string, unknown>)?.data ?? raw ?? {}) as Record<string, unknown>;
    const m = (d.metrics ?? {}) as Record<string, unknown>;
    return {
      m: {
        total_sessions: Number(m.total_sessions ?? 0),
        unique_visitors: Number(m.unique_visitors ?? 0),
        total_page_views: Number(m.total_page_views ?? 0),
        bounce_rate: Number(m.bounce_rate ?? 0),
      },
      landing: Array.isArray(d.top_landing_pages) ? (d.top_landing_pages as Array<{ page: string; count: number }>) : [],
    };
  };
  const perSite = await mapLimit(sites, 4, async (site) => {
    const [curR, prevR] = await Promise.allSettled([
      client.callToolJson<unknown>('analytics_overview', { project_id: site.id, from_date: start28 }),
      client.callToolJson<unknown>('analytics_overview', { project_id: site.id, from_date: start56, to_date: start28 }),
    ]);
    const cur = curR.status === 'fulfilled' ? readOv(curR.value) : { m: zero, landing: [] };
    const prev = prevR.status === 'fulfilled' ? readOv(prevR.value) : { m: zero, landing: [] };
    return { id: site.id, name: String(site.name ?? ''), cur: cur.m, prev: prev.m, landing: cur.landing };
  });
  const totals = { cur: { ...zero }, prev: { ...zero } };
  for (const r of perSite) {
    for (const k of ['total_sessions', 'unique_visitors', 'total_page_views'] as const) {
      totals.cur[k] += r.cur[k];
      totals.prev[k] += r.prev[k];
    }
  }
  // Visitor intelligence (account-level). Tolerate the tool not existing yet
  // (the MCP-server deploy adding analytics_visitors may still be rolling out).
  let hot: Row[] = [];
  let recent: Row[] = [];
  let visitorsError: string | undefined;
  try {
    const [hotR, recentR] = await Promise.all([
      client.callToolJson<unknown>('analytics_visitors', { has_icp_match: 'true', sort_by: 'icp_confidence', limit: 25 }),
      client.callToolJson<unknown>('analytics_visitors', { sort_by: 'last_seen', min_events: 2, limit: 25 }),
    ]);
    hot = extractRows(hotR);
    recent = extractRows(recentR).filter((v) => v.email || v.identified_data);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    visitorsError = /unknown tool|not found|-32601/i.test(m)
      ? 'Visitor intelligence is deploying (new analytics_visitors tool) — check back in a few minutes.'
      : m;
  }
  const vRow = (v: Row) => ({
    name: String(v.name || v.email || 'anonymous'),
    email: String(v.email || ''),
    fit: v.icp_match_confidence !== undefined && v.icp_match_confidence !== null ? Number(v.icp_match_confidence) : undefined,
    events: Number(v.event_count ?? 0),
    lastSeen: String(v.last_seen_at ?? ''),
    id: String(v.id ?? ''),
  });
  return {
    kind: 'analyticsdash',
    days: 28,
    totals,
    sites: perSite.sort((a, b) => b.cur.total_sessions - a.cur.total_sessions),
    hot: hot.map(vRow),
    recent: recent.map(vRow),
    visitorsError,
  };
}

/** Claude Code prompt to chase one warm visitor — copied to the clipboard. */
function chasePrompt(v: { name?: string; email?: string; fit?: number; events?: number; lastSeen?: string }): string {
  return [
    `Chase this warm website visitor for me (from Hiveku visitor intelligence):`,
    `- Who: ${v.name || 'unknown name'}${v.email ? ` <${v.email}>` : ' (not yet identified by email)'}`,
    `- ICP fit: ${v.fit !== undefined ? `${v.fit}%` : 'unmatched'} · ${v.events ?? 0} events on our site · last seen ${v.lastSeen || '?'}`,
    ``,
    `1. Pull their full picture: analytics_visitors({ search: "${v.email || v.name || ''}" }) and, if identified, crm_get_contact / crm_contact_upsert_by_email({ email: "${v.email || ''}" }).`,
    `2. Load context: account_context_get({ domain: "outbound" }).`,
    `3. Draft a personalized same-day first touch via talk_to_department({ domain: "outbound", message }) — reference the topics/pages they engaged with, NEVER that they were tracked.`,
    `4. On my approval: log the touch (crm_create_activity), create the lead (outbound_create_lead), and set a follow-up (crm_reminder_schedule).`,
  ].join('\n');
}


/**
 * Email marketing dashboard — full lifecycle management. Every action maps to a
 * verb the campaigns route actually implements (schedule / send_now / pause /
 * resume / cancel / duplicate / test_send / resend_non_openers / metrics).
 * Email marketing is ALPHA in Hiveku: failures are surfaced verbatim.
 */
async function loadEmailDashboard(client: HivekuMcpClient): Promise<Record<string, unknown>> {
  const [statsR, campaignsR, audiencesR, templatesR] = await Promise.allSettled([
    client.callToolJson<unknown>('email_stats', {}),
    client.callToolJson<unknown>('email_campaign_list', { limit: 50 }),
    client.callToolJson<unknown>('email_audience_list', {}),
    client.callToolJson<unknown>('email_template_list', {}),
  ]);
  const stats = statsR.status === 'fulfilled' ? (((statsR.value as Record<string, unknown>)?.data ?? statsR.value) as Record<string, unknown>) : {};
  const campaigns = campaignsR.status === 'fulfilled' ? extractRows(campaignsR.value) : [];
  const audiences = audiencesR.status === 'fulfilled' ? extractRows(audiencesR.value) : [];
  const templates = templatesR.status === 'fulfilled' ? extractRows(templatesR.value) : [];
  const error = campaignsR.status === 'rejected' ? String(campaignsR.reason instanceof Error ? campaignsR.reason.message : campaignsR.reason) : undefined;

  // Aggregate engagement from the 12 most recent campaigns' metrics.
  const recent = campaigns.slice(0, 12);
  const agg = { delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 };
  const metricsById = new Map<string, Record<string, number>>();
  await mapLimit(recent, 4, async (c) => {
    try {
      const raw = await client.callToolJson<unknown>('email_campaign_metrics', { id: c.id });
      const m = (((raw as Record<string, unknown>)?.data ?? raw) as Record<string, unknown>) || {};
      const rec: Record<string, number> = {};
      for (const k of ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed']) rec[k] = Number(m[k] ?? 0);
      metricsById.set(String(c.id), rec);
      agg.delivered += rec.delivered;
      agg.opened += rec.opened;
      agg.clicked += rec.clicked;
      agg.bounced += rec.bounced;
      agg.unsubscribed += rec.unsubscribed;
    } catch {
      /* per-campaign metrics best-effort */
    }
  });
  return {
    kind: 'emaildash',
    error,
    stats: {
      today: Number(stats.sent_today ?? 0),
      week: Number(stats.sent_week ?? 0),
      month: Number(stats.sent_month ?? 0),
      openRate: agg.delivered ? (agg.opened / agg.delivered) * 100 : undefined,
      clickRate: agg.delivered ? (agg.clicked / agg.delivered) * 100 : undefined,
    },
    campaigns: campaigns.map((c) => ({
      id: String(c.id),
      name: String(c.name ?? '(campaign)'),
      subject: String(c.subject ?? ''),
      status: String(c.status ?? 'draft'),
      scheduled: String(c.scheduled_for ?? c.scheduled_at ?? ''),
      m: metricsById.get(String(c.id)),
    })),
    audiences: audiences.map((a) => ({ name: String(a.name ?? ''), kind: String(a.kind ?? ''), size: Number(a.estimated_size ?? a.member_count ?? 0) })),
    templates: templates.map((t) => ({ name: String(t.name ?? t.subject ?? '(template)') })),
  };
}

/** Lifecycle actions the email dashboard exposes, gated by campaign status. */
const EMAIL_ACTIONS: Record<string, { tool: string; confirm?: string; needsEmails?: boolean; needsWhen?: boolean }> = {
  test: { tool: 'email_campaign_test_send', needsEmails: true },
  send_now: { tool: 'email_campaign_send_now', confirm: 'Send this campaign to its FULL audience now?' },
  schedule: { tool: 'email_campaign_schedule', needsWhen: true },
  pause: { tool: 'email_campaign_pause', confirm: 'Pause this campaign? (queued sends stop)' },
  resume: { tool: 'email_campaign_resume', confirm: 'Resume sending this campaign?' },
  cancel: { tool: 'email_campaign_cancel', confirm: 'Cancel this campaign? (cannot be un-cancelled)' },
  duplicate: { tool: 'email_campaign_duplicate' },
  resend: { tool: 'email_campaign_resend_non_openers', confirm: 'Clone this campaign as a new draft targeting only NON-openers?' },
};

async function runEmailAction(client: HivekuMcpClient, action: string, id: string): Promise<string | undefined> {
  const spec = EMAIL_ACTIONS[action];
  if (!spec) return 'unknown action';
  const args: Record<string, unknown> = { id };
  if (spec.needsEmails) {
    const to = await vscode.window.showInputBox({ prompt: 'Test recipients (comma-separated emails)', placeHolder: 'you@agency.com' });
    if (!to) return undefined;
    args.to = to.split(',').map((x) => x.trim()).filter(Boolean);
  }
  if (spec.needsWhen) {
    const when = await vscode.window.showInputBox({ prompt: 'Send at (ISO time, e.g. 2026-07-04T09:00:00Z)', value: new Date(Date.now() + 3600_000).toISOString().slice(0, 16) + ':00Z' });
    if (!when) return undefined;
    args.scheduled_for = when;
  }
  if (spec.confirm) {
    const ok = await vscode.window.showWarningMessage(spec.confirm, { modal: true }, 'Yes');
    if (ok !== 'Yes') return undefined;
  }
  await client.callToolJson<unknown>(spec.tool, args);
  return 'done';
}

export function openAccountConsole(
  account: AccountRecord,
  clientFor: ClientFor,
  appUrl: () => string,
  initial?: { tab: string; focus?: string },
  rolePrefs?: { role?: string; departments: string[] },
): void {
  const existing = panels.get(account.accountId);
  if (existing) {
    existing.reveal();
    if (initial) existing.webview.postMessage({ type: 'goto', tab: initial.tab, focus: initial.focus });
    return;
  }
  diag(`open account=${account.label} existing=${panels.has(account.accountId)} version=${vscode.extensions.getExtension('hiveku.hiveku-vscode')?.packageJSON?.version ?? '?'}`);
  const panel = vscode.window.createWebviewPanel(
    'hivekuConsole',
    `Hiveku — ${account.label}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panels.set(account.accountId, panel);
  panel.onDidDispose(() => panels.delete(account.accountId));
  panel.webview.html = consoleHtml(panel.webview, account.label);

  const dashBase = `${appUrl().replace(/\/+$/, '')}/${account.accountId}/dashboard`;

  // Build the tab list once: Tasks + Automations + entitled department tabs.
  let lastPageAccess: Record<string, boolean> | undefined;
  const buildTabs = (pageAccess: Record<string, boolean> | undefined) => {
    const { primary, other } = effectiveDepartments(rolePrefs?.role, rolePrefs?.departments ?? [], pageAccess);
    const hasRole = !!rolePrefs?.role && other.length > 0;
    return [
      { id: 'tasks', label: 'Tasks', group: 'Run' },
      { id: 'automations', label: 'Automations', group: 'Run' },
      { id: 'integrations', label: 'Connect', group: 'Run' },
      ...primary.filter((d) => d.id !== 'workflows').map((d) => ({ id: d.id, label: d.label, group: hasRole ? 'Your departments' : 'Departments' })),
      ...other.filter((d) => d.id !== 'workflows').map((d) => ({ id: d.id, label: d.label, group: 'Other' })),
    ];
  };
  const initTabs = async () => {
    diag(`initTabs account=${account.label}`);
    // Post init IMMEDIATELY — the rail must never wait on the network. The
    // entitlements probe (slow/hanging for some accounts) refines it after.
    const integrations = SETUP_PROMPTS.map((p) => ({ id: p.id, label: p.label, blurb: p.blurb }));
    const tabsNow = buildTabs(lastPageAccess);
    diag(`init posting tabs=${tabsNow.length}`);
    void panel.webview.postMessage({ type: 'init', tabs: tabsNow, integrations, initial, operable: Object.keys(DEPT_TO_MODULE) }).then(
      (ok) => diag(`init postMessage delivered=${ok}`),
      (e) => diag(`init postMessage FAILED ${e}`),
    );
    void (async () => {
      try {
        const ent = await api.accountEntitlements(await clientFor(account.accountId));
        if (ent?.page_access) {
          lastPageAccess = ent.page_access;
          panel.webview.postMessage({ type: 'tabs', tabs: buildTabs(lastPageAccess) });
        }
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        if (/\b401\b|invalid or inactive|no stored key|unauthor/i.test(m)) {
          panel.webview.postMessage({ type: 'banner', text: `This account's key looks dead (${m.slice(0, 120)}). Run "Hiveku: Connect Hiveku" to mint a fresh one.` });
        }
      }
    })();
  };

  const load = async (tab: string, raw = false) => {
    const client = await clientFor(account.accountId);
    let data: unknown = {};
    try {
      if (tab === 'integrations') {
        data = await loadIntegrations(client);
        panel.webview.postMessage({ type: 'tab', tab, data });
        return;
      }
      if (!raw && tab === 'email') {
        data = await loadEmailDashboard(client);
        panel.webview.postMessage({ type: 'tab', tab, data });
        return;
      }
      if (!raw && tab === 'analytics') {
        data = await loadAnalyticsDashboard(client);
        panel.webview.postMessage({ type: 'tab', tab, data });
        return;
      }
      if (!raw && tab === 'ppc') {
        data = await loadPpcDashboard(client);
        panel.webview.postMessage({ type: 'tab', tab, data });
        return;
      }
      if (!raw && tab === 'seo') {
        data = await loadSeoDashboard(client);
        panel.webview.postMessage({ type: 'tab', tab, data });
        return;
      }
      if (tab === 'tasks') {
        data = { tasks: await api.pmTasksAll(client) };
      } else if (tab === 'automations') {
        const [workflows, runs] = await Promise.allSettled([api.workflowList(client), api.workflowRunsRecent(client)]);
        data = {
          workflows: workflows.status === 'fulfilled' ? workflows.value : [],
          runs: runs.status === 'fulfilled' ? runs.value : [],
        };
      } else {
        const dept = departmentById(tab);
        if (dept) {
          const datasets = await Promise.all(
            dept.datasets.map(async (ds) => {
              // The table only renders a 250-row slice — cap pagination to match
              // instead of fanning out up to 40 pages per dataset on tab open.
              const { rows, error } = await fetchDataset(client, ds, 250);
              return {
                id: ds.id,
                label: ds.label,
                columns: ds.columns.map((c) => ({ label: c.label ?? (Array.isArray(c.key) ? c.key[0] : c.key) })),
                rows: rows.slice(0, 250).map((r) => ds.columns.map((c) => fmt(pick(r, c.key), c))),
                count: rows.length,
                tool: ds.tool,
                error,
              };
            }),
          );
          data = { datasets };
        }
      }
    } catch (err) {
      data = { error: err instanceof Error ? err.message : String(err) };
    }
    panel.webview.postMessage({ type: 'tab', tab, data });
  };

  panel.webview.onDidReceiveMessage(
    async (msg: { type: string; tab?: string; id?: string; enabled?: boolean; sub?: string }) => {
      try {
        diag(`msg type=${msg.type} tab=${msg.tab ?? ''}`);
        // NOTE: no eager clientFor here — a dead/missing key must never block
        // 'ready' (that left the panel stuck on "Loading…" with no error).
        if (msg.type === 'ready') {
          await initTabs();
        } else if (msg.type === 'load' && msg.tab) {
          await load(msg.tab);
        } else if (msg.type === 'jserror') {
          diag(`WEBVIEW JS ERROR: ${msg.tab}`);
        } else if (msg.type === 'loadraw' && msg.tab) {
          await load(msg.tab, true);
        } else if (msg.type === 'emailact' && msg.id) {
          try {
            const done = await runEmailAction(await clientFor(account.accountId), (msg as unknown as { action: string }).action, msg.id);
            if (done === 'done') {
              vscode.window.showInformationMessage('Email action completed.');
              await load('email');
            } else if (done) {
              vscode.window.showErrorMessage(`Email action failed: ${done}`);
            }
          } catch (err) {
            vscode.window.showErrorMessage(`Email action failed (alpha): ${err instanceof Error ? err.message : String(err)}`);
          }
        } else if (msg.type === 'chase' && (msg as unknown as { visitor?: Record<string, unknown> }).visitor) {
          const v = (msg as unknown as { visitor: Record<string, unknown> }).visitor;
          await vscode.env.clipboard.writeText(chasePrompt(v as { name?: string; email?: string; fit?: number; events?: number; lastSeen?: string }));
          vscode.window.showInformationMessage('Chase prompt copied — paste it into Claude Code in this account\'s workspace.');
        } else if (msg.type === 'ppcdrill' && msg.id) {
          const drill = await ppcDrill(await clientFor(account.accountId), msg.id);
          panel.webview.postMessage({ type: 'ppcdrill', id: msg.id, drill });
        } else if (msg.type === 'ppcads' && msg.id) {
          const adsRaw = await clientFor(account.accountId).then((c) => c.callToolJson<unknown>('ppc_ad_list', { ad_group_id: msg.id, limit: 200 })).catch(() => ({}));
          const ads = extractRows(adsRaw).map((a) => ({ name: String(a.name ?? a.headline ?? a.id ?? '(ad)'), status: String(a.status ?? ''), type: String(a.ad_type ?? a.type ?? ''), approval: String(a.approval_status ?? '') }));
          panel.webview.postMessage({ type: 'ppcads', id: msg.id, ads });
        } else if (msg.type === 'ppcsync') {
          vscode.window.showInformationMessage('Syncing from the ad platform — campaigns + metrics now; ad groups + ads land a minute later.');
          try {
            await (await clientFor(account.accountId)).callToolJson<unknown>('ppc_sync', {});
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            if (!/timed out/i.test(m)) vscode.window.showErrorMessage(`PPC sync: ${m}`);
          }
          await load('ppc');
        } else if (msg.type === 'download') {
          await vscode.commands.executeCommand('hiveku.downloadData', { record: account });
        } else if (msg.type === 'copyPrompt' && msg.id) {
          const sp = setupPromptById(msg.id);
          if (sp) {
            await vscode.env.clipboard.writeText(sp.build(account));
            vscode.window.showInformationMessage(`Copied the ${sp.label} setup prompt — paste it into Claude Code.`);
          }
        } else if (msg.type === 'complete' && msg.id) {
          await api.pmTaskComplete(await clientFor(account.accountId), msg.id);
          await load('tasks');
          // Keep the sidebar's open/Completed split in step with the console.
          void vscode.commands.executeCommand('hiveku.refreshTree');
        } else if (msg.type === 'opentask' && msg.id) {
          const title = (msg as unknown as { title?: string }).title;
          openTaskDetail(account, { id: msg.id, title }, clientFor, appUrl);
        } else if (msg.type === 'runwf' && msg.id) {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Running workflow…' },
            async () => api.workflowRun(await clientFor(account.accountId), msg.id as string),
          );
          await load('automations');
        } else if (msg.type === 'togglewf' && msg.id) {
          await api.workflowSetEnabled(await clientFor(account.accountId), msg.id, !!msg.enabled);
          await load('automations');
        } else if (msg.type === 'operate' && msg.tab) {
          const mod = moduleById(DEPT_TO_MODULE[msg.tab]);
          if (mod) openModulePanel(account, mod, clientFor, appUrl, {}, undefined, lastPageAccess);
        } else if (msg.type === 'open') {
          await vscode.env.openExternal(vscode.Uri.parse(msg.sub ? `${dashBase}/${msg.sub}` : dashBase));
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Hiveku: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}

function consoleHtml(webview: vscode.Webview, label: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <style>
    html,body { height: 100%; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; padding: 0; display: flex; height: 100vh; }
    /* ── left rail ─────────────────────────────────────────── */
    .rail { flex: 0 0 208px; width: 208px; display: flex; flex-direction: column; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background)); }
    .railhead { padding: 12px 14px 6px; }
    .railhead h1 { font-size: 12px; margin: 0; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nav { flex: 1; overflow-y: auto; padding-bottom: 8px; }
    .grp { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; opacity: .5; padding: 12px 14px 4px; }
    .navitem { padding: 6px 14px; cursor: pointer; font-size: 12px; border-left: 2px solid transparent; opacity: .82; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .navitem:hover { background: var(--vscode-list-hoverBackground); }
    .navitem.active { opacity: 1; font-weight: 600; border-left-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground, rgba(127,127,127,.12)); }
    .railfoot { padding: 8px 10px; border-top: 1px solid var(--vscode-panel-border); }
    .railfoot button { width: 100%; }
    /* ── main pane ─────────────────────────────────────────── */
    .main { flex: 1; min-width: 0; overflow-y: auto; }
    .mainhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 16px; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 1; }
    .mainhead h2 { font-size: 13px; margin: 0; }
    #content { padding: 14px 16px; }
    .cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; align-items: start; }
    .col { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 8px; }
    .col h3 { font-size: 11px; text-transform: uppercase; opacity: 0.7; margin: 4px 4px 8px; }
    .task { background: var(--vscode-input-background); border-radius: 6px; padding: 8px; margin-bottom: 6px; font-size: 12px; }
    .task .meta { opacity: 0.6; font-size: 10px; margin-top: 3px; }
    .task .meta.over { color: var(--vscode-errorForeground); opacity: 0.9; }
    .overdue { color: var(--vscode-errorForeground); }
    .row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; gap: 10px; }
    .row .sub { opacity: 0.6; font-size: 11px; }
    .sec { font-size: 12px; font-weight: 600; margin: 18px 0 6px; opacity: 0.9; display: flex; gap: 8px; align-items: baseline; scroll-margin-top: 56px; }
    .sec.flash { animation: flash 1.4s ease-out; }
    @keyframes flash { 0% { background: var(--vscode-editor-findMatchHighlightBackground, rgba(255,210,80,.35)); } 100% { background: transparent; } }
    .sec .ct { font-size: 11px; opacity: .55; font-weight: 400; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th { text-align: left; font-weight: 600; opacity: .6; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; }
    td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
    tr:hover td { background: var(--vscode-list-hoverBackground); }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 5px; padding: 4px 11px; cursor: pointer; font-size: 11px; }
    button.ghost { background: transparent; color: var(--vscode-textLink-foreground); }
    .badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
    .ok { background: rgba(80,200,120,0.2); } .err { background: rgba(220,80,80,0.25); color: var(--vscode-errorForeground); }
    .muted { opacity: 0.6; } .tablewrap { overflow-x: auto; border: 1px solid var(--vscode-panel-border); border-radius: 8px; }
    a.link { color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 11px; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin: 4px 0 14px; }
    .kpi { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 10px 12px; }
    .kpi .v { font-size: 18px; font-weight: 600; }
    .kpi .l { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; opacity: .6; margin-top: 2px; }
    .kpi .d { font-size: 11px; margin-top: 3px; }
    .up { color: #4fc37f; } .down { color: var(--vscode-errorForeground); } .flat { opacity: .5; }
    .alerts { background: rgba(220,160,60,.12); border: 1px solid rgba(220,160,60,.4); border-radius: 6px; padding: 7px 10px; font-size: 12px; margin-bottom: 12px; }
    tr.rowlink { cursor: pointer; }
    tr.drill td { background: var(--vscode-editorWidget-background); padding: 10px 14px; }
    .drillgrid { display: flex; gap: 24px; flex-wrap: wrap; }
    .drillgrid table { width: auto; }
    .rawlink { display: block; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="rail">
    <div class="railhead"><h1>${label}</h1></div>
    <div class="nav" id="nav"></div>
    <div class="railfoot"><button id="dl" title="Pull this account's data into hiveku-data/ for Claude Code">⬇ Download all data</button></div>
  </div>
  <div class="main">
    <div class="mainhead"><h2 id="title">Account Console</h2><button id="operate" style="display:none" title="Open the Operate panel for this department - one-click actions (approve, pause, create)">Operate</button></div>
    <div id="content"><div class="muted">Loading…</div></div>
  </div>
  <script nonce="${nonce}">
    var vscode = acquireVsCodeApi();
    window.onerror=function(m,src,l,c){try{vscode.postMessage({type:'jserror',tab:String(m)+' @'+l+':'+c});}catch(e){}};
    var TABS = [];
    var INTEGRATIONS = [];
    var OPERABLE = [];
    var current = null;
    var pendingFocus = null;
    var navEl = document.getElementById('nav');
    var content = document.getElementById('content');
    var titleEl = document.getElementById('title');

    function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e;}
    function clear(n){while(n.firstChild)n.removeChild(n.firstChild);}
    function btn(label,cls,fn){var b=el('button',cls,label);b.addEventListener('click',fn);return b;}
    function labelFor(id){for(var i=0;i<TABS.length;i++){if(TABS[i].id===id)return TABS[i].label;}return id;}

    document.getElementById('dl').addEventListener('click',function(){vscode.postMessage({type:'download'});});
    var operateBtn=document.getElementById('operate');
    operateBtn.addEventListener('click',function(){if(current)vscode.postMessage({type:'operate',tab:current});});

    function renderNav(){
      clear(navEl);
      var lastGroup=null;
      TABS.forEach(function(t){
        if(t.group&&t.group!==lastGroup){navEl.appendChild(el('div','grp',t.group));lastGroup=t.group;}
        var d=el('div','navitem'+(t.id===current?' active':''),t.label);
        d.addEventListener('click',function(){select(t.id);});
        navEl.appendChild(d);
      });
    }
    function select(tab,focus){current=tab;pendingFocus=focus||null;titleEl.textContent=labelFor(tab);operateBtn.style.display=OPERABLE.indexOf(tab)>=0?'':'none';renderNav();content.textContent='Loading…';vscode.postMessage({type:'load',tab:tab});}

    function renderIntegrations(d){
      clear(content);
      var conns=(d&&d.connected)||[];
      content.appendChild(el('div','sec','Connected'));
      if(!conns.length){content.appendChild(el('div','muted','Nothing connected yet - use the setup prompts below; Claude Code walks through each connection.'));}
      else{
        var wrap=el('div','tablewrap');var table=el('table');
        var thead=el('tr');['area','integration','status','details'].forEach(function(h){thead.appendChild(el('th',null,h));});table.appendChild(thead);
        conns.forEach(function(c){
          var tr=el('tr');
          tr.appendChild(el('td',null,c.area));
          tr.appendChild(el('td',null,c.label));
          var st=el('td');var okish=/connect|active|verified|ok|healthy/i.test(c.status)&&!/dis|in|err|fail|expir|pending/i.test(c.status);
          st.appendChild(el('span','badge '+(okish?'ok':'err'),c.status||'?'));tr.appendChild(st);
          tr.appendChild(el('td',null,c.detail||''));
          table.appendChild(tr);
        });
        wrap.appendChild(table);content.appendChild(wrap);
      }
      var sec=el('div','sec','Connect something new');
      content.appendChild(sec);
      var hint=el('div','muted','Copy a prompt, paste into Claude Code - it walks through the connection step by step (fields, OAuth, verification) using the Hiveku tools.');
      hint.style.margin='0 0 14px';content.appendChild(hint);
      INTEGRATIONS.forEach(function(it){
        var r=el('div','row');
        var left=el('div',null);left.appendChild(el('div',null,it.label));
        if(it.blurb)left.appendChild(el('div','sub',it.blurb));
        r.appendChild(left);
        r.appendChild(btn('Copy setup prompt','',function(){vscode.postMessage({type:'copyPrompt',id:it.id});}));
        content.appendChild(r);
      });
    }

    function renderTasks(d){
      clear(content);
      var tasks=(d.tasks||[]);
      if(!tasks.length){content.appendChild(el('div','muted','No tasks.'));return;}
      var doneStatuses={done:1,completed:1,archived:1};
      var isDone=function(t){return !!doneStatuses[String(t.status||'').toLowerCase()];};
      var n0=new Date();var m0=n0.getMonth()+1;var d0=n0.getDate();
      var todayKey=n0.getFullYear()+'-'+(m0<10?'0':'')+m0+'-'+(d0<10?'0':'')+d0;
      var isLate=function(t){return !isDone(t)&&!!t.due_date&&String(t.due_date).slice(0,10)<todayKey;};
      var who=function(t){return (t.assigned_to&&(t.assigned_to.name||t.assigned_to.email))||'';};
      var proj=function(t){return (t.project&&t.project.name)||t.project_name||'';};
      var openCt=0;tasks.forEach(function(t){if(!isDone(t))openCt++;});
      var sec=el('div','sec');sec.appendChild(el('span',null,'Tasks'));
      sec.appendChild(el('span','ct',openCt+' open · '+(tasks.length-openCt)+' completed'));
      content.appendChild(sec);
      content.appendChild(smartTable({
        rows:tasks,
        sortIdx:7,sortDesc:true,
        facets:[
          {label:'state',get:function(t){return isDone(t)?'completed':'open';},init:'open'},
          {label:'status',get:function(t){return String(t.status||'').replace(/_/g,' ');}},
          {label:'assignee',get:function(t){return who(t)||'unassigned';}},
          {label:'project',get:function(t){return proj(t);}}
        ],
        onRow:function(tr,t){vscode.postMessage({type:'opentask',id:t.id,title:t.title||t.name||''});},
        cols:[
          {h:'#',num:true,get:function(t){return t.task_number||0;}},
          {h:'task',get:function(t){return t.title||t.name||'(task)';}},
          {h:'status',get:function(t){return String(t.status||'').replace(/_/g,' ');}},
          {h:'assignee',get:function(t){return who(t)||'-';}},
          {h:'due',get:function(t){return t.due_date?String(t.due_date).slice(0,10):'';},render:function(t){
            if(!t.due_date)return document.createTextNode('-');
            return el('span',isLate(t)?'overdue':undefined,new Date(t.due_date).toLocaleDateString());
          }},
          {h:'priority',get:function(t){return t.priority||'';}},
          {h:'project',get:function(t){return proj(t)||'-';}},
          {h:'created',get:function(t){return t.created_at?String(t.created_at).slice(0,10):'';}},
          {h:'',get:function(){return '';},render:function(t){
            if(isDone(t))return document.createTextNode('');
            return btn('Done','ghost',function(){vscode.postMessage({type:'complete',id:t.id});});
          }}
        ]
      }));
    }

    function renderAuto(d){
      clear(content);
      var wfs=(d.workflows||[]);
      content.appendChild(el('div','sec','Workflows ('+wfs.length+')'));
      if(!wfs.length)content.appendChild(el('div','muted','No workflows.'));
      wfs.forEach(function(w){
        var r=el('div','row');
        var on=(w.is_enabled!=null?w.is_enabled:w.enabled);
        var left=el('div',null);left.appendChild(document.createTextNode(w.name||'(workflow)'));
        var st=el('span','badge '+(on?'ok':''),on?'on':'off');st.style.marginLeft='8px';left.appendChild(st);
        var actions=el('div');actions.style.display='flex';actions.style.gap='6px';
        actions.appendChild(btn('Run','',function(){vscode.postMessage({type:'runwf',id:w.id});}));
        actions.appendChild(btn(on?'Disable':'Enable','ghost',function(){vscode.postMessage({type:'togglewf',id:w.id,enabled:!on});}));
        r.appendChild(left);r.appendChild(actions);content.appendChild(r);
      });
      content.appendChild(el('div','sec','Recent runs'));
      var runs=(d.runs||[]);
      if(!runs.length)content.appendChild(el('div','muted','No recent runs.'));
      runs.slice(0,15).forEach(function(run){
        var r=el('div','row');
        r.appendChild(el('div',null,run.workflow_name||run.workflow_id||'(run)'));
        var status=(run.status||'').toLowerCase();
        var b=el('span','badge '+((status==='error'||status==='failed')?'err':(status==='completed'?'ok':'')),run.status||'?');
        var when=run.started_at||run.created_at;
        var right=el('div');right.style.display='flex';right.style.gap='8px';right.style.alignItems='center';
        if(when)right.appendChild(el('span','sub',new Date(when).toLocaleString()));
        right.appendChild(b);
        r.appendChild(right);content.appendChild(r);
      });
    }

    /**
     * smartTable: sortable / searchable / filterable table.
     * cfg: { cols:[{h,get,num,render}], rows, facets:[{label,get,init}], search, sortIdx, sortDesc, onRow, max }
     * A facet's optional init preselects that value (e.g. state: open).
     */
    function smartTable(cfg){
      var state={sortIdx:cfg.sortIdx!==undefined?cfg.sortIdx:-1,sortDesc:cfg.sortDesc!==false,q:'',facets:{}};
      var root=el('div');
      var bar=el('div');bar.style.display='flex';bar.style.gap='8px';bar.style.margin='0 0 8px';bar.style.alignItems='center';
      if(cfg.search!==false){
        var inp=document.createElement('input');inp.type='text';inp.placeholder='Search...';
        inp.style.cssText='flex:1;max-width:260px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:5px;padding:4px 8px;font-size:12px;';
        inp.addEventListener('input',function(){state.q=inp.value.toLowerCase();update();});
        bar.appendChild(inp);
      }
      (cfg.facets||[]).forEach(function(f){
        var sel=document.createElement('select');
        sel.style.cssText='background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:5px;padding:4px 6px;font-size:12px;';
        var vals={};cfg.rows.forEach(function(r){var v=String(f.get(r)||'');if(v)vals[v]=1;});
        var o0=document.createElement('option');o0.value='';o0.textContent=f.label+': all';sel.appendChild(o0);
        Object.keys(vals).sort().forEach(function(v){var o=document.createElement('option');o.value=v;o.textContent=v;sel.appendChild(o);});
        if(f.init&&vals[f.init]){sel.value=f.init;state.facets[f.label]=f.init;}
        sel.addEventListener('change',function(){state.facets[f.label]=sel.value;update();});
        bar.appendChild(sel);
      });
      var count=el('span','ct','');bar.appendChild(count);
      root.appendChild(bar);
      var wrap=el('div','tablewrap');var table=el('table');wrap.appendChild(table);root.appendChild(wrap);
      function update(){
        clear(table);
        var thead=el('tr');
        cfg.cols.forEach(function(c,i){
          var th=el('th',null,c.h+(state.sortIdx===i?(state.sortDesc?' v':' ^'):''));
          th.style.cursor='pointer';th.title='Sort by '+c.h;
          th.addEventListener('click',function(){if(state.sortIdx===i){state.sortDesc=!state.sortDesc;}else{state.sortIdx=i;state.sortDesc=!!c.num;}update();});
          thead.appendChild(th);
        });
        table.appendChild(thead);
        var rows=cfg.rows.filter(function(r){
          for(var k in state.facets){
            if(!state.facets[k])continue;
            var fac=(cfg.facets||[]).filter(function(f){return f.label===k;})[0];
            if(fac&&String(fac.get(r)||'')!==state.facets[k])return false;
          }
          if(!state.q)return true;
          return cfg.cols.some(function(c){return String(c.get(r)===undefined||c.get(r)===null?'':c.get(r)).toLowerCase().indexOf(state.q)>=0;});
        });
        if(state.sortIdx>=0){
          var c=cfg.cols[state.sortIdx];
          rows=rows.slice().sort(function(a,b){
            var av=c.get(a),bv=c.get(b);
            if(c.num){av=Number(av)||0;bv=Number(bv)||0;return state.sortDesc?bv-av:av-bv;}
            av=String(av===undefined||av===null?'':av);bv=String(bv===undefined||bv===null?'':bv);
            return state.sortDesc?bv.localeCompare(av):av.localeCompare(bv);
          });
        }
        count.textContent=rows.length+(rows.length===1?' row':' rows');
        rows.slice(0,cfg.max||500).forEach(function(r){
          var tr=el('tr',cfg.onRow?'rowlink':undefined);
          cfg.cols.forEach(function(c){
            var td=el('td');
            if(c.render){var n=c.render(r);if(n)td.appendChild(n);}
            else{var v=c.get(r);td.textContent=String(v===undefined||v===null?'':v);}
            tr.appendChild(td);
          });
          if(cfg.onRow)tr.addEventListener('click',function(ev){var tg=ev.target;if(tg&&tg.closest&&tg.closest('button,select,a'))return;cfg.onRow(tr,r);});
          table.appendChild(tr);
        });
      }
      update();
      return root;
    }

    var money=function(n){n=Number(n)||0;var a=Math.abs(n);if(a>=1e6)return '$'+(n/1e6).toFixed(1)+'M';if(a>=1e3)return '$'+(n/1e3).toFixed(1)+'k';return '$'+(Number.isInteger(n)?n:n.toFixed(2));};
    var numf=function(n){n=Number(n)||0;if(Math.abs(n)>=1e6)return (n/1e6).toFixed(1)+'M';if(Math.abs(n)>=1e3)return (n/1e3).toFixed(1)+'k';return String(Math.round(n*10)/10);};
    function delta(cur,prev,goodUp,fmt){
      if(!prev){return el('div','d flat','no prior data');}
      var pct=prev===0?0:((cur-prev)/prev)*100;
      var cls=Math.abs(pct)<1?'flat':((pct>0)===goodUp?'up':'down');
      var sign=pct>0?'+':'';
      return el('div','d '+cls,sign+pct.toFixed(0)+'% vs prior ('+(fmt?fmt(prev):numf(prev))+')');
    }
    function kpi(value,label,d){var t=el('div','kpi');t.appendChild(el('div','v',value));t.appendChild(el('div','l',label));if(d)t.appendChild(d);return t;}
    function rawLink(){var a=el('a','link rawlink','View raw datasets (everything Claude Code sees)');a.addEventListener('click',function(){content.textContent='Loading…';vscode.postMessage({type:'loadraw',tab:current});});return a;}

    function renderPpcDash(d){
      clear(content);
      if(d.empty){
        content.appendChild(el('div','alerts',d.error?('Ads data unavailable: '+d.error):'No ad account connected (or no campaigns yet). Set it up right here:'));
        var acts=el('div');acts.style.display='flex';acts.style.gap='8px';acts.style.margin='10px 0';
        acts.appendChild(btn('Copy Google Ads setup prompt','',function(){vscode.postMessage({type:'copyPrompt',id:'google_ads'});}));
        acts.appendChild(btn('Copy Microsoft Ads setup prompt','',function(){vscode.postMessage({type:'copyPrompt',id:'microsoft_ads'});}));
        acts.appendChild(btn('See all integrations','ghost',function(){select('integrations');}));
        content.appendChild(acts);
        content.appendChild(el('div','muted','Paste the prompt into Claude Code - it walks through the OAuth + account link, then this tab becomes your PPC dashboard.'));
        content.appendChild(rawLink());return;
      }
      var c=d.totals.cur,p=d.totals.prev;
      var kpis=el('div','kpis');
      kpis.appendChild(kpi(money(c.cost),'Spend '+d.days+'d',delta(c.cost,p.cost,false,money)));
      kpis.appendChild(kpi(numf(c.clicks),'Clicks',delta(c.clicks,p.clicks,true)));
      kpis.appendChild(kpi(numf(c.impressions),'Impressions',delta(c.impressions,p.impressions,true)));
      kpis.appendChild(kpi(c.impressions?((c.clicks/c.impressions)*100).toFixed(1)+'%':'-','CTR',delta(c.impressions?c.clicks/c.impressions:0,p.impressions?p.clicks/p.impressions:0,true,function(v){return (v*100).toFixed(1)+'%';})));
      kpis.appendChild(kpi(numf(c.conversions),'Conversions',delta(c.conversions,p.conversions,true)));
      kpis.appendChild(kpi(c.conversions?money(c.cost/c.conversions):'-','Cost / conv',delta(c.conversions?c.cost/c.conversions:0,p.conversions?p.cost/p.conversions:0,false,money)));
      if(c.value>0)kpis.appendChild(kpi((c.cost?(c.value/c.cost).toFixed(1):'-')+'x','ROAS',delta(c.cost?c.value/c.cost:0,p.cost?p.value/p.cost:0,true)));
      content.appendChild(kpis);
      if(d.stale){
        var st=el('div','alerts');
        st.appendChild(document.createTextNode('This data looks stale - campaigns exist but no metrics and statuses may be outdated (last platform sync is old). '));
        var sy=btn('Sync from ad platform now','',function(){content.textContent='Syncing from the ad platform...';vscode.postMessage({type:'ppcsync'});});
        sy.style.marginLeft='8px';st.appendChild(sy);
        content.appendChild(st);
      }
      if(d.alerts&&d.alerts.length){var al=el('div','alerts',d.alerts.join('  ·  '));content.appendChild(al);}
      var sec=el('div','sec');sec.appendChild(el('span',null,'Campaigns ('+d.days+'d)'));sec.appendChild(el('span','ct','click a row to drill down - click headers to sort'));content.appendChild(sec);
      content.appendChild(smartTable({
        rows:d.campaigns,
        search:true,
        facets:[{label:'status',get:function(r){return r.status;}},{label:'platform',get:function(r){return r.platform;}}],
        sortIdx:2,sortDesc:true,
        cols:[
          {h:'campaign',get:function(r){return r.name+(r.platform?' ('+r.platform+')':'');}},
          {h:'status',get:function(r){return r.status;}},
          {h:'spend',num:true,get:function(r){return r.cur.cost;},render:function(r){return document.createTextNode(money(r.cur.cost));}},
          {h:'clicks',num:true,get:function(r){return r.cur.clicks;},render:function(r){return document.createTextNode(numf(r.cur.clicks));}},
          {h:'CTR',num:true,get:function(r){return r.cur.impressions?r.cur.clicks/r.cur.impressions:0;},render:function(r){return document.createTextNode(r.cur.impressions?((r.cur.clicks/r.cur.impressions)*100).toFixed(1)+'%':'-');}},
          {h:'conv',num:true,get:function(r){return r.cur.conversions;},render:function(r){return document.createTextNode(numf(r.cur.conversions));}},
          {h:'cost/conv',num:true,get:function(r){return r.cur.conversions?r.cur.cost/r.cur.conversions:0;},render:function(r){return document.createTextNode(r.cur.conversions?money(r.cur.cost/r.cur.conversions):'-');}},
          {h:'vs prior',num:true,get:function(r){return r.prev.cost?((r.cur.cost-r.prev.cost)/r.prev.cost)*100:0;},render:function(r){var dv=r.prev.cost?(((r.cur.cost-r.prev.cost)/r.prev.cost)*100):null;var sp=el('span',dv===null?'flat':(Math.abs(dv)<1?'flat':(dv>0?'down':'up')),dv===null?'-':(dv>0?'+':'')+dv.toFixed(0)+'% spend');return sp;}},
        ],
        onRow:function(tr,r){toggleDrill(tr,r.id,tr.parentNode);},
      }));
      content.appendChild(rawLink());
    }
    var openDrill=null;
    function toggleDrill(tr,campaignId,table){
      if(openDrill){openDrill.remove();if(openDrill.dataset.cid===campaignId){openDrill=null;return;}openDrill=null;}
      var dtr=document.createElement('tr');dtr.className='drill';dtr.dataset.cid=campaignId;
      var td=document.createElement('td');td.colSpan=8;td.textContent='Loading drill-down…';
      dtr.appendChild(td);tr.parentNode.insertBefore(dtr,tr.nextSibling);openDrill=dtr;
      vscode.postMessage({type:'ppcdrill',id:campaignId});
    }
    var adsHost=null;
    function renderDrill(id,drill){
      if(!openDrill||openDrill.dataset.cid!==id)return;
      var td=openDrill.firstChild;clear(td);
      var grid=el('div','drillgrid');
      // Level 2: ad groups (the hierarchy step under the campaign) - click one for its ads.
      var b2=el('div');b2.appendChild(el('div','sec','Ad groups ('+(drill.adGroups||[]).length+') - click one for its ads'));
      var t2=el('table');var h2=el('tr');['ad group','status'].forEach(function(h){h2.appendChild(el('th',null,h));});t2.appendChild(h2);
      if(!(drill.adGroups||[]).length){var r0=el('tr');var c0=el('td',null,'No ad groups synced yet - run "Sync from ad platform" above.');c0.colSpan=2;r0.appendChild(c0);t2.appendChild(r0);}
      (drill.adGroups||[]).slice(0,50).forEach(function(g){
        var r=el('tr','rowlink');[g.name,g.status].forEach(function(x){r.appendChild(el('td',null,String(x)));});
        r.addEventListener('click',function(ev){ev.stopPropagation();loadAds(g,b2);});
        t2.appendChild(r);
      });
      b2.appendChild(t2);
      adsHost=el('div');b2.appendChild(adsHost);
      grid.appendChild(b2);
      // Side block: 14-day trend for the campaign.
      var b1=el('div');b1.appendChild(el('div','sec','Campaign - last 14 days'));
      var t1=el('table');var h1=el('tr');['date','spend','clicks','conv'].forEach(function(h){h1.appendChild(el('th',null,h));});t1.appendChild(h1);
      (drill.daily||[]).slice(0,14).forEach(function(dd){var r=el('tr');[dd.date,money(dd.cost),dd.clicks,dd.conversions].forEach(function(x){r.appendChild(el('td',null,String(x)));});t1.appendChild(r);});
      b1.appendChild(t1);grid.appendChild(b1);
      var hint=el('div','muted','Pause / budget changes: the Operate button above. Deeper work: /hiveku-ppc-optimize in Claude Code.');
      td.appendChild(grid);td.appendChild(hint);
    }
    function loadAds(group,host){
      if(!adsHost)return;
      clear(adsHost);
      adsHost.appendChild(el('div','sec','Ads in "'+group.name+'"'));
      adsHost.appendChild(el('div','muted','Loading ads...'));
      vscode.postMessage({type:'ppcads',id:group.id});
      adsHost.dataset.gid=group.id;
    }
    function renderAds(id,ads){
      if(!adsHost||adsHost.dataset.gid!==id)return;
      var title=adsHost.firstChild?adsHost.firstChild.textContent:'Ads';
      clear(adsHost);
      adsHost.appendChild(el('div','sec',title+' ('+ads.length+')'));
      if(!ads.length){adsHost.appendChild(el('div','muted','No ads synced for this ad group yet.'));return;}
      var t=el('table');var h=el('tr');['ad','type','status','approval'].forEach(function(x){h.appendChild(el('th',null,x));});t.appendChild(h);
      ads.slice(0,50).forEach(function(a){var r=el('tr');[a.name,a.type,a.status,a.approval].forEach(function(x){r.appendChild(el('td',null,String(x)));});t.appendChild(r);});
      adsHost.appendChild(t);
    }

    function renderSeoDash(d){
      clear(content);
      if(d.gscError){
        var al=el('div','alerts','Google Search Console is not connected (or its token expired): '+d.gscError);
        content.appendChild(al);
        var acts=el('div');acts.style.display='flex';acts.style.gap='8px';acts.style.margin='10px 0';
        acts.appendChild(btn('Copy GSC setup prompt','',function(){vscode.postMessage({type:'copyPrompt',id:'google_search_console'});}));
        acts.appendChild(btn('Copy GBP setup prompt (Local SEO)','',function(){vscode.postMessage({type:'copyPrompt',id:'google_business_profile'});}));
        acts.appendChild(btn('See all integrations','ghost',function(){select('integrations');}));
        content.appendChild(acts);
        content.appendChild(el('div','muted','Paste into Claude Code to fix the connection - the traffic KPIs and query tables light up once GSC responds.'));
      } else {
        var c=d.totals.cur,p=d.totals.prev;
        var kpis=el('div','kpis');
        kpis.appendChild(kpi(numf(c.clicks),'GSC clicks '+d.days+'d',delta(c.clicks,p.clicks,true)));
        kpis.appendChild(kpi(numf(c.impressions),'Impressions',delta(c.impressions,p.impressions,true)));
        kpis.appendChild(kpi((c.ctr*100).toFixed(1)+'%','CTR',delta(c.ctr,p.ctr,true,function(v){return (v*100).toFixed(1)+'%';})));
        kpis.appendChild(kpi(c.position?c.position.toFixed(1):'-','Avg position',delta(-c.position,-p.position,true,function(v){return (-v).toFixed(1);})));
        content.appendChild(kpis);
      }
      var trkpis=el('div','kpis');
      trkpis.appendChild(kpi(String(d.tracked.count),'Tracked keywords'));
      trkpis.appendChild(kpi(String(d.tracked.top3),'In top 3'));
      trkpis.appendChild(kpi(String(d.tracked.top10),'In top 10'));
      if(d.audit)trkpis.appendChild(kpi(String(d.audit.score!=null?d.audit.score:d.audit.status||'-'),'Audit score'));
      content.appendChild(trkpis);
      if(!d.gscError&&d.topQueries&&d.topQueries.length){
        var sec=el('div','sec');sec.appendChild(el('span',null,'Top queries ('+d.days+'d)'));sec.appendChild(el('span','ct','position delta = green when improving - click headers to sort'));content.appendChild(sec);
        content.appendChild(smartTable({
          rows:d.topQueries,
          search:true,
          sortIdx:1,sortDesc:true,
          cols:[
            {h:'query',get:function(q){return q.key;}},
            {h:'clicks',num:true,get:function(q){return q.clicks;}},
            {h:'impr',num:true,get:function(q){return q.impressions;},render:function(q){return document.createTextNode(numf(q.impressions));}},
            {h:'CTR',num:true,get:function(q){return q.ctr;},render:function(q){return document.createTextNode((q.ctr*100).toFixed(1)+'%');}},
            {h:'pos',num:true,get:function(q){return q.position;},render:function(q){return document.createTextNode(q.position.toFixed(1));}},
            {h:'pos delta',num:true,get:function(q){return q.dPos===undefined?0:q.dPos;},render:function(q){var sp=el('span',q.dPos===undefined?'flat':(Math.abs(q.dPos)<0.3?'flat':(q.dPos>0?'up':'down')),q.dPos===undefined?'new':(q.dPos>0?'+':'')+q.dPos);return sp;}},
          ],
        }));
      }
      if(!d.gscError&&d.topPages&&d.topPages.length){
        var sec2=el('div','sec');sec2.appendChild(el('span',null,'Top pages'));content.appendChild(sec2);
        content.appendChild(smartTable({
          rows:d.topPages,
          search:true,
          sortIdx:1,sortDesc:true,
          cols:[
            {h:'page',get:function(q){return q.key.indexOf('://')>0?'/'+q.key.split('/').slice(3).join('/'):q.key;}},
            {h:'clicks',num:true,get:function(q){return q.clicks;}},
            {h:'impr',num:true,get:function(q){return q.impressions;},render:function(q){return document.createTextNode(numf(q.impressions));}},
            {h:'pos',num:true,get:function(q){return q.position;},render:function(q){return document.createTextNode(q.position.toFixed(1));}},
          ],
        }));
      }
      content.appendChild(rawLink());
    }

    var EMAIL_STATUS_ACTIONS={
      draft:['test','send_now','schedule','duplicate'],
      scheduled:['test','send_now','cancel'],
      sending:['pause','cancel'],
      paused:['resume','cancel'],
      sent:['resend','duplicate'],
      cancelled:['duplicate'],
      failed:['duplicate','test']
    };
    var EMAIL_ACTION_LABEL={test:'Test send',send_now:'Send now',schedule:'Schedule',pause:'Pause',resume:'Resume',cancel:'Cancel',duplicate:'Duplicate',resend:'Resend non-openers'};
    function renderEmailDash(d){
      clear(content);
      content.appendChild(el('div','muted','Email marketing is in alpha - every action reports the real server result, so failures are visible, not silent.'));
      var kpis=el('div','kpis');
      kpis.appendChild(kpi(numf(d.stats.today),'Sent today'));
      kpis.appendChild(kpi(numf(d.stats.week),'Sent this week'));
      kpis.appendChild(kpi(numf(d.stats.month),'Sent this month'));
      kpis.appendChild(kpi(d.stats.openRate!==undefined?d.stats.openRate.toFixed(1)+'%':'-','Open rate (recent)'));
      kpis.appendChild(kpi(d.stats.clickRate!==undefined?d.stats.clickRate.toFixed(1)+'%':'-','Click rate (recent)'));
      content.appendChild(kpis);
      if(d.error){content.appendChild(el('div','alerts','Campaigns unavailable: '+d.error));}
      var sec=el('div','sec');sec.appendChild(el('span',null,'Campaigns'));sec.appendChild(el('span','ct','create + full editing via Operate or /hiveku-email in Claude Code'));content.appendChild(sec);
      if(!d.campaigns.length){content.appendChild(el('div','muted','No campaigns yet. Use Operate (+ Campaign) for a quick draft, or /hiveku-email in Claude Code for the full build flow (audience, content, test, schedule).'));}
      else{
        content.appendChild(smartTable({
          rows:d.campaigns,
          search:true,
          facets:[{label:'status',get:function(c){return c.status;}}],
          cols:[
            {h:'campaign',get:function(c){return c.name+(c.subject?' - '+c.subject:'');}},
            {h:'status',get:function(c){return c.status;},render:function(c){var ok=/sent|sending|scheduled/.test(c.status);var bad=/failed|cancel/.test(c.status);return el('span','badge '+(bad?'err':ok?'ok':''),c.status);}},
            {h:'delivered',num:true,get:function(c){return c.m?c.m.delivered:-1;},render:function(c){return document.createTextNode(c.m?String(c.m.delivered):'-');}},
            {h:'opens',num:true,get:function(c){return c.m&&c.m.delivered?c.m.opened/c.m.delivered:-1;},render:function(c){return document.createTextNode(c.m&&c.m.delivered?((c.m.opened/c.m.delivered)*100).toFixed(0)+'%':'-');}},
            {h:'clicks',num:true,get:function(c){return c.m&&c.m.delivered?c.m.clicked/c.m.delivered:-1;},render:function(c){return document.createTextNode(c.m&&c.m.delivered?((c.m.clicked/c.m.delivered)*100).toFixed(0)+'%':'-');}},
            {h:'scheduled',get:function(c){return c.scheduled?new Date(c.scheduled).toLocaleString():'-';}},
            {h:'actions',get:function(){return '';},render:function(c){var act=el('span');(EMAIL_STATUS_ACTIONS[c.status]||['duplicate']).forEach(function(a){var b=btn(EMAIL_ACTION_LABEL[a],'ghost',function(){vscode.postMessage({type:'emailact',action:a,id:c.id});});b.style.marginRight='4px';act.appendChild(b);});return act;}},
          ],
        }));
      }
      var g=el('div','drillgrid');g.style.marginTop='16px';
      var b1=el('div');b1.appendChild(el('div','sec','Audiences ('+d.audiences.length+')'));
      var t1=el('table');var h1=el('tr');['audience','kind','size'].forEach(function(h){h1.appendChild(el('th',null,h));});t1.appendChild(h1);
      d.audiences.slice(0,15).forEach(function(a){var tr=el('tr');[a.name,a.kind,numf(a.size)].forEach(function(x){tr.appendChild(el('td',null,String(x)));});t1.appendChild(tr);});
      b1.appendChild(t1);g.appendChild(b1);
      var b2=el('div');b2.appendChild(el('div','sec','Templates ('+d.templates.length+')'));
      var t2=el('table');var h2=el('tr');['template'].forEach(function(h){h2.appendChild(el('th',null,h));});t2.appendChild(h2);
      d.templates.slice(0,15).forEach(function(t){var tr=el('tr');tr.appendChild(el('td',null,t.name));t2.appendChild(tr);});
      b2.appendChild(t2);g.appendChild(b2);
      content.appendChild(g);
      content.appendChild(rawLink());
    }

    function visitorTable(rows,withFit){
      var cols=[
        {h:'visitor',get:function(v){return v.name;}},
        {h:'email',get:function(v){return v.email||'-';}},
      ];
      if(withFit)cols.push({h:'ICP fit',num:true,get:function(v){return v.fit!==undefined?v.fit:-1;},render:function(v){return document.createTextNode(v.fit!==undefined?v.fit+'%':'-');}});
      cols.push({h:'events',num:true,get:function(v){return v.events;}});
      cols.push({h:'last seen',get:function(v){return v.lastSeen?new Date(v.lastSeen).toLocaleDateString():'-';}});
      cols.push({h:'',get:function(){return '';},render:function(v){return btn('Chase','ghost',function(){vscode.postMessage({type:'chase',visitor:v});});}});
      return smartTable({rows:rows,search:true,sortIdx:withFit?2:3,sortDesc:true,cols:cols});
    }

    function renderAnalyticsDash(d){
      clear(content);
      var c=d.totals.cur,p=d.totals.prev;
      var kpis=el('div','kpis');
      kpis.appendChild(kpi(numf(c.unique_visitors),'Visitors '+d.days+'d',delta(c.unique_visitors,p.unique_visitors,true)));
      kpis.appendChild(kpi(numf(c.total_sessions),'Sessions',delta(c.total_sessions,p.total_sessions,true)));
      kpis.appendChild(kpi(numf(c.total_page_views),'Pageviews',delta(c.total_page_views,p.total_page_views,true)));
      kpis.appendChild(kpi(String(d.hot.length),'Hot ICP visitors'));
      content.appendChild(kpis);

      var sec=el('div','sec');sec.appendChild(el('span',null,'Visitor intelligence - hot ICP matches'));sec.appendChild(el('span','ct','the SDR/BDR chase list'));content.appendChild(sec);
      if(d.visitorsError){content.appendChild(el('div','alerts',d.visitorsError));}
      else if(!d.hot.length){content.appendChild(el('div','muted','No ICP-matched visitors yet. Traffic is tracked; matches appear as ICP rules and identification kick in.'));}
      else{
        content.appendChild(visitorTable(d.hot,true));
      }
      if(d.recent&&d.recent.length){
        var sec2=el('div','sec');sec2.appendChild(el('span',null,'Recently identified visitors'));content.appendChild(sec2);
        content.appendChild(visitorTable(d.recent,false));
      }
      if(d.sites&&d.sites.length){
        var sec3=el('div','sec');sec3.appendChild(el('span',null,'Traffic by site ('+d.days+'d)'));content.appendChild(sec3);
        var w3=el('div','tablewrap');var t3=el('table');
        var h3=el('tr');['site','visitors','sessions','pageviews','bounce','vs prior'].forEach(function(h){h3.appendChild(el('th',null,h));});t3.appendChild(h3);
        d.sites.forEach(function(r){
          var tr=el('tr');
          [r.name,numf(r.cur.unique_visitors),numf(r.cur.total_sessions),numf(r.cur.total_page_views),r.cur.bounce_rate+'%'].forEach(function(x){tr.appendChild(el('td',null,String(x)));});
          var dv=r.prev.total_sessions?(((r.cur.total_sessions-r.prev.total_sessions)/r.prev.total_sessions)*100):null;
          var dtd=el('td',null,dv===null?'-':(dv>0?'+':'')+dv.toFixed(0)+'% sessions');
          if(dv!==null)dtd.className=Math.abs(dv)<1?'flat':(dv>0?'up':'down');
          tr.appendChild(dtd);t3.appendChild(tr);
        });
        w3.appendChild(t3);content.appendChild(w3);
      }
      content.appendChild(rawLink());
    }

    function renderDept(d){
      clear(content);
      var sets=(d.datasets||[]);
      if(!sets.length){content.appendChild(el('div','muted','No data.'));return;}
      sets.forEach(function(ds){
        var sec=el('div','sec');sec.id='ds-'+ds.id;sec.appendChild(el('span',null,ds.label));
        sec.appendChild(el('span','ct',ds.error?('— '+ds.error):(ds.count+' rows')));
        content.appendChild(sec);
        if(ds.error)return;
        if(!ds.rows||!ds.rows.length){content.appendChild(el('div','muted','None.'));return;}
        var wrap=el('div','tablewrap');
        var table=el('table');
        var thead=el('tr');
        (ds.columns||[]).forEach(function(c){thead.appendChild(el('th',null,c.label));});
        table.appendChild(thead);
        ds.rows.forEach(function(row){
          var tr=el('tr');
          row.forEach(function(cell){tr.appendChild(el('td',null,cell));});
          table.appendChild(tr);
        });
        wrap.appendChild(table);content.appendChild(wrap);
        if(ds.count>ds.rows.length)content.appendChild(el('div','muted','Showing '+ds.rows.length+' of '+ds.count+' — download for the full set.'));
      });
      if(pendingFocus){
        var target=document.getElementById('ds-'+pendingFocus);
        if(target){target.scrollIntoView({behavior:'smooth',block:'start'});target.classList.add('flash');}
        pendingFocus=null;
      }
    }

    var initTimer=null;
    function initFailed(){
      clear(content);
      content.appendChild(el('div','err','The console did not initialize (extension error or a dead account key). Check the account key via "Hiveku: Which Account Is This?", then retry.'));
      var retry=btn('Retry','',function(){content.textContent='Loading…';armInitWatchdog();vscode.postMessage({type:'ready'});});
      retry.style.marginTop='10px';content.appendChild(retry);
    }
    function armInitWatchdog(){if(initTimer)clearTimeout(initTimer);initTimer=setTimeout(initFailed,15000);}
    armInitWatchdog();
    window.addEventListener('message',function(ev){
      var m=ev.data;
      if(m.type==='init'){
        clearTimeout(initTimer);
        if(m.initError){var b=el('div','alerts',m.initError);b.style.margin='10px 16px 0';document.querySelector('.main').insertBefore(b,content);}
        TABS=m.tabs||[];INTEGRATIONS=m.integrations||[];OPERABLE=m.operable||[];
        var start=(m.initial&&m.initial.tab)||(TABS.length?TABS[0].id:null);
        renderNav();
        if(start)select(start,m.initial&&m.initial.focus);
        return;
      }
      if(m.type==='tabs'){TABS=m.tabs||TABS;renderNav();return;}
      if(m.type==='banner'){var bb=el('div','alerts',m.text);bb.style.margin='10px 16px 0';document.querySelector('.main').insertBefore(bb,content);return;}
      if(m.type==='goto'){if(m.tab)select(m.tab,m.focus);return;}
      if(m.type==='ppcdrill'){renderDrill(m.id,m.drill||{});return;}
      if(m.type==='ppcads'){renderAds(m.id,m.ads||[]);return;}
      if(m.type!=='tab')return;
      if(m.data&&m.data.error){clear(content);content.appendChild(el('div','err',m.data.error));return;}
      if(m.tab==='tasks')renderTasks(m.data);
      else if(m.tab==='automations')renderAuto(m.data);
      else if(m.data&&m.data.kind==='connect')renderIntegrations(m.data);
      else if(m.data&&m.data.kind==='analyticsdash')renderAnalyticsDash(m.data);
      else if(m.data&&m.data.kind==='emaildash')renderEmailDash(m.data);
      else if(m.data&&m.data.kind==='ppcdash')renderPpcDash(m.data);
      else if(m.data&&m.data.kind==='seodash')renderSeoDash(m.data);
      else renderDept(m.data);
    });

    vscode.postMessage({type:'ready'});
  </script>
</body>
</html>`;
}
