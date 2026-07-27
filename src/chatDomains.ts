/**
 * The domain vocabulary `talk_to_department` actually accepts.
 *
 * There are three separate "department" vocabularies in play and nothing
 * reconciled them:
 *   1. builder memory slugs  (knowledge.ts DEPARTMENTS, 12)
 *   2. console ids           (deptData.ts DEPARTMENTS, 24) — drives the tree,
 *                            the console tabs, Operate, and the chat picker
 *   3. MCP chat domains      (this file, 13) — the only set the server accepts
 *
 * The chat picker was built from (2) and passed the console id straight to the
 * tool, so 19 of the 24 offered departments hard-failed. Worse, the server
 * returns "Unknown domain" as an ordinary non-error result, and the chat client
 * looks for reply/message/response/text/output — none of which are present — so
 * the raw JSON error object was rendered into the chat panel as if it were the
 * agent talking.
 *
 * Keep this list in sync with DOMAIN_LABELS in the MCP server
 * (hiveku-mcp-api-server/src/services/department-chat.service.ts).
 */
export const CHAT_DOMAINS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'marketing', label: 'Marketing' },
  { id: 'seo', label: 'SEO' },
  { id: 'social', label: 'Social' },
  { id: 'content', label: 'Content' },
  { id: 'ppc', label: 'PPC' },
  { id: 'outbound', label: 'Outbound' },
  { id: 'branding', label: 'Branding' },
  { id: 'website_design', label: 'Website Design' },
  { id: 'customer_avatar', label: 'Customer Avatar' },
  { id: 'customer_journey', label: 'Customer Journey' },
  { id: 'before_after_grid', label: 'Before / After Grid' },
  { id: 'knowledge_base', label: 'Knowledge Base' },
  { id: 'workflow', label: 'Automations' },
];

const VALID = new Set(CHAT_DOMAINS.map((d) => d.id));

/**
 * Console ids (and a few legacy ids used by Operate row actions) that map onto
 * a real chat domain. Anything absent here has NO department agent behind it —
 * `sales`, `crm`, `email`, `helpdesk`, `accounting`, `pm`, `mc`, `voice`,
 * `hiveboards`, `media`, `commerce`, `pages`, `analytics`, `cms`, `database`.
 * Those must surface a clear message rather than being sent to the server to
 * fail. (`account_context_get` documents `sales` and `helpdesk` as domains, but
 * `talk_to_department` does not accept them — the two tools disagree.)
 */
const ALIASES: Readonly<Record<string, string>> = {
  workflows: 'workflow',
  knowledge: 'knowledge_base',
  creative: 'branding',
  localseo: 'seo',
  aeo: 'seo',
  // Sales/CRM motion is handled by the outbound agent — the closest real domain.
  sales: 'outbound',
  crm: 'outbound',
  design: 'website_design',
  avatar: 'customer_avatar',
  journey: 'customer_journey',
};

/** Resolve any id to a domain the server accepts, or null if none exists. */
export function toChatDomain(id: string | undefined): string | null {
  if (!id) return null;
  if (VALID.has(id)) return id;
  const mapped = ALIASES[id];
  return mapped && VALID.has(mapped) ? mapped : null;
}

/** Human-readable list for the "no agent for this department" message. */
export function chatDomainListForMessage(): string {
  return CHAT_DOMAINS.map((d) => d.label).join(', ');
}
