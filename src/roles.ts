/**
 * Role presets — how a professional runs an account from VS Code.
 *
 * A role (picked at connect, changeable via "Hiveku: Set Role") tailors:
 *   - which departments lead the Account Console tree/panel (and their order),
 *   - which role-specific slash commands the Claude Code scaffold generates
 *     (see roleCommands.ts) and which brief tools /hiveku-daily chains.
 *
 * Everything is config here — same philosophy as deptData.ts. One function,
 * `effectiveDepartments()`, is the single source all surfaces use:
 *   (role departments ∪ connect-flow selection) ∩ plan entitlements.
 */

import { DEPARTMENTS, type Department } from './deptData';

/** Same semantics as panel.ts isEntitled — duplicated (4 lines) so this module
 *  stays vscode-free and unit-testable outside the extension host. */
function isEntitled(pageAccess: Record<string, boolean> | undefined, gate?: string): boolean {
  if (!gate) return true;
  if (!pageAccess) return true;
  return pageAccess[gate] !== false;
}

export type RoleId =
  | 'seo'
  | 'ppc'
  | 'dev'
  | 'bookkeeper'
  | 'pm'
  | 'marketer'
  | 'sales'
  | 'outbound'
  | 'helpdesk'
  | 'social'
  | 'owner';

export interface Role {
  id: RoleId;
  label: string;
  /** Short line shown in the role QuickPick. */
  blurb: string;
  /** deptData.ts ids, in display order (console tabs, tree, export default). */
  deptIds: string[];
  /** Builder knowledge domains this role talks to (talk_to_department / account_context_get). */
  knowledgeDomains: string[];
  /** The /hiveku-daily signal chain (tool names, optionally with arg hints). */
  briefTools: string[];
}

// Every role includes `pm` — Hiveku PM is the source-of-truth task loop for all work.
export const ROLES: Role[] = [
  {
    id: 'seo',
    label: 'SEO Specialist',
    blurb: 'Rankings, audits, content decay, GSC',
    deptIds: ['seo', 'localseo', 'aeo', 'content', 'analytics', 'pm'],
    knowledgeDomains: ['seo', 'content'],
    briefTools: ['seo_list_audits', 'seo_rankings_list', 'seo_gsc_search_analytics', 'seo_content_decay', 'seo_cannibalization'],
  },
  {
    id: 'ppc',
    label: 'PPC Manager',
    blurb: 'Pacing, anomalies, search terms, disapprovals',
    deptIds: ['ppc', 'analytics', 'creative', 'pm'],
    knowledgeDomains: ['ppc', 'marketing'],
    briefTools: ['ppc_pacing_summary', 'ppc_anomaly_check', 'ppc_metrics', 'ppc_disapprovals_list', 'ppc_period_comparison'],
  },
  {
    id: 'dev',
    label: 'Developer',
    blurb: 'Sites, code, deploys, workflows, data',
    deptIds: ['pages', 'cms', 'database', 'workflows', 'media', 'analytics', 'pm'],
    knowledgeDomains: ['workflow'],
    briefTools: ['account_audit_health', 'workflow_runs_recent', 'pm_tasks_list'],
  },
  {
    id: 'bookkeeper',
    label: 'Bookkeeper',
    blurb: 'AP/AR, bills, invoices, payroll, P&L',
    deptIds: ['accounting', 'pm'],
    knowledgeDomains: ['sales'],
    briefTools: ['accounting_ap_aging', 'accounting_ar_aging', 'accounting_bill_list', 'accounting_pnl_summary', 'accounting_invoice_list'],
  },
  {
    id: 'pm',
    label: 'Project Manager',
    blurb: 'Tasks, milestones, SLA, triage',
    deptIds: ['pm', 'mc', 'workflows', 'hiveboards', 'knowledge'],
    knowledgeDomains: ['workflow'],
    briefTools: ['pm_tasks_list', 'mc_sla_breached', 'mc_tasks_stalled', 'pm_milestones_list'],
  },
  {
    id: 'marketer',
    label: 'Marketer',
    blurb: 'Content, email, social, brand, analytics',
    deptIds: ['content', 'creative', 'social', 'email', 'seo', 'media', 'analytics', 'pm'],
    knowledgeDomains: ['marketing', 'content', 'branding'],
    briefTools: ['email_stats', 'email_campaign_metrics', 'social_analytics_summary', 'analytics_overview', 'analytics_visitors'],
  },
  {
    id: 'sales',
    label: 'Sales',
    blurb: 'Pipeline, deals, follow-ups, activity',
    deptIds: ['crm', 'email', 'voice', 'pm'],
    knowledgeDomains: ['sales'],
    briefTools: ['crm_deals_at_risk', 'crm_deals_stuck', 'crm_pipeline_stage_summary', 'analytics_visitors', 'crm_contacts_gone_cold', 'crm_activity_leaderboard'],
  },
  {
    id: 'outbound',
    label: 'Outbound / BDR',
    blurb: 'Smartlead + HeyReach replies, campaigns, leads',
    deptIds: ['outbound', 'crm', 'email', 'pm'],
    knowledgeDomains: ['outbound', 'sales'],
    briefTools: ['outbound_list_campaigns', 'outbound_list_leads', 'analytics_visitors', 'crm_contacts_gone_cold', 'email_stats'],
  },
  {
    id: 'helpdesk',
    label: 'Helpdesk Agent',
    blurb: 'Tickets, macros, CSAT, knowledge base',
    deptIds: ['helpdesk', 'knowledge', 'voice', 'pm'],
    knowledgeDomains: ['helpdesk', 'knowledge_base'],
    briefTools: ['helpdesk_tickets_overdue', 'helpdesk_csat_stats'],
  },
  {
    id: 'social',
    label: 'Social Manager',
    blurb: 'Posts, pillars, publishing, analytics',
    deptIds: ['social', 'creative', 'content', 'media', 'analytics', 'pm'],
    knowledgeDomains: ['social', 'branding'],
    briefTools: ['social_analytics_summary'],
  },
  {
    id: 'owner',
    label: 'Owner (everything)',
    blurb: 'All departments, cross-account view',
    deptIds: DEPARTMENTS.map((d) => d.id),
    knowledgeDomains: ['marketing', 'sales', 'seo', 'content'],
    briefTools: ['account_audit_health'],
  },
];

export function roleById(id: string | undefined): Role | undefined {
  return ROLES.find((r) => r.id === id);
}

/**
 * Connect-flow department slugs are BUILDER slugs (knowledge.ts DEPARTMENTS),
 * which don't match deptData console ids — translate before combining.
 */
const BUILDER_TO_CONSOLE: Record<string, string[]> = {
  marketing: ['content', 'email', 'creative'],
  content: ['content', 'cms'],
  seo: ['seo', 'localseo', 'aeo'],
  social: ['social'],
  ppc: ['ppc'],
  outbound: ['outbound'],
  branding: ['creative'],
  sales: ['crm', 'outbound'],
  email: ['email'],
  helpdesk: ['helpdesk'],
  knowledge_base: ['knowledge', 'helpdesk'],
  workflow: ['workflows'],
};

/**
 * The departments a user actually works with, in display order:
 * role departments first (role order), then any extra departments from the
 * connect-flow selection, all intersected with plan entitlements.
 * With no role: entitled departments in registry order (today's behavior).
 */
export function effectiveDepartments(
  roleId: string | undefined,
  storedBuilderSlugs: string[],
  pageAccess: Record<string, boolean> | undefined,
): { primary: Department[]; other: Department[] } {
  // Note: the console surfaces additionally exclude the `workflows` dept (their
  // hardcoded Automations tab covers it) — that stays the caller's concern.
  const entitled = DEPARTMENTS.filter((d) => isEntitled(pageAccess, d.gate));
  const role = roleById(roleId);
  if (!role) return { primary: entitled, other: [] };

  const wanted = new Set<string>(role.deptIds);
  for (const slug of storedBuilderSlugs) for (const id of BUILDER_TO_CONSOLE[slug] ?? [slug]) wanted.add(id);

  const byId = new Map(entitled.map((d) => [d.id, d]));
  const primary: Department[] = [];
  // Role order first, then stored extras in registry order.
  for (const id of role.deptIds) {
    const d = byId.get(id);
    if (d) primary.push(d);
  }
  for (const d of entitled) {
    if (wanted.has(d.id) && !primary.includes(d)) primary.push(d);
  }
  const other = entitled.filter((d) => !primary.includes(d));
  return { primary, other };
}
