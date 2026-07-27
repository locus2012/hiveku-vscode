/**
 * The canonical plan-entitlement keys.
 *
 * Mirrors the `PageAccess` interface in the builder
 * (hiveku_builder/src/lib/permissions/check-permissions.ts). Keep in sync — the
 * server is the source of truth; this exists so the compiler can catch a bad
 * gate key here.
 *
 * WHY THIS IS A TYPE AND NOT A COMMENT: the entitlement check is deliberately
 * FAIL-OPEN (`pageAccess[gate] !== false`), so an account that hasn't loaded
 * entitlements yet still sees its UI rather than an empty shell. The cost is
 * that a key which isn't a real PageAccess field is never `false`, so a typo
 * doesn't hide the feature — it LEAKS it to every account regardless of plan.
 * That is exactly what `gate: 'outbound'` did: the real key is
 * `marketing_outbound`, so the Outbound console tab and its datasets showed for
 * everyone, while the Operate entry for the same feature (which used the
 * correct key) hid properly. Typing the field turns that class of bug into a
 * build error.
 */
export type PageAccessKey =
  | 'websites'
  | 'pm_projects'
  | 'workflows'
  | 'crm'
  | 'helpdesk'
  | 'discussions'
  | 'hiveboards'
  | 'commerce'
  | 'communications'
  | 'accounting'
  | 'accounting_ap'
  | 'accounting_ar'
  | 'accounting_payroll'
  | 'accounting_reports'
  | 'project_tasks'
  | 'project_review'
  | 'project_discussion'
  | 'marketing'
  | 'marketing_assets'
  | 'marketing_designer'
  | 'marketing_seo'
  | 'marketing_content'
  | 'marketing_social'
  | 'marketing_ppc'
  | 'marketing_email'
  | 'marketing_outbound'
  | 'marketing_knowledge_base'
  | 'marketing_customer_journey'
  | 'marketing_surveys'
  | 'marketing_reputation'
  | 'marketing_referrals'
  | 'marketing_before_after'
  | 'marketing_branding'
  | 'marketing_customer_avatar'
  | 'marketing_reports'
  | 'visitor_intelligence'
  | 'orchestrator'
  | 'partner_console';
