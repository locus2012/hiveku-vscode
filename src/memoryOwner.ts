/**
 * Who a memory entry belongs to, and where the Memory page puts it (memory
 * surfaces audit 2026-09-27, G9, G14 and G7; the unified Memory page's "one
 * row, one place", proposal E3).
 *
 * THE ONE OWNER RULE. The builder is the source of truth, so every surface
 * must agree with it:
 *   - When a row carries the builder's resolved `owner`, that is the answer
 *     (null: shared with every agent). The Memory page's own routes return it;
 *     older ones return only the raw `department` column, and the rule below
 *     decides.
 *   - A typed row (`_rule:`, `_skill:`, `_command:`, `_agent:`) is owned by:
 *       (a) the `department` column when it is set and is not 'marketing';
 *       (b) when the column is empty or 'marketing' and the text carries a
 *           canonical Marketing-family marker (`<!-- department: x -->`), that
 *           topic. These are the 1,174 seeded starter rows (column 'marketing'
 *           plus a topic marker);
 *       (c) column 'marketing' with no family marker: the Marketing lead;
 *       (d) column empty and no family marker: another agent's canonical
 *           marker, then the front matter, else no owner (shared with every
 *           agent).
 *   - A profile (`_identity:*`) is owned by its slug when that is a
 *     department, else by the department its front matter declares.
 *   - Anything else (the notes an agent keeps, `_account:*`): the column, then
 *     the declaration in the text, then a domain that is itself a department.
 * The Marketing family includes 'analytics' (audit decision 6).
 *
 * WHERE IT GOES. `placeRow` is the Memory page's placement (hiveku_builder
 * src/components/memory/tree/tree-model.ts), with one difference: a row the
 * page does not show under an agent (a note filed under another name, a rule
 * filed for the chief of staff, or an owner no agent has) stays visible here
 * as `other`, so nothing the Knowledge tab listed before goes missing.
 *
 * WHAT IS READ-ONLY HERE. Rows shared with every agent and `_account:*` rows
 * (the chief of staff's own memory, Voice and pronunciation) are changed only
 * on the Memory page, by owners and admins. VS Code shows them with "Open in
 * Memory" and refuses a save.
 *
 * No `vscode` import, so node --test drives it.
 */

import { accountMemoryDashboardUrl, isAccountMemoryDomain } from './accountMemory';

// ─── Departments and names ──────────────────────────────────────────

/**
 * The Marketing team: its lead (`marketing`) and its topics, each a peer with
 * its own chat (builder memory-types.ts MARKETING_FAMILY_DEPARTMENTS, with
 * `analytics` since audit decision 6).
 */
export const MARKETING_FAMILY: readonly string[] = [
  'marketing',
  'content',
  'seo',
  'social',
  'ppc',
  'outbound',
  'branding',
  'customer_avatar',
  'customer_journey',
  'website_design',
  'knowledge_base',
  'workflow',
  'before_after_grid',
  'email',
  'analytics',
];

/** The agents that run their own servers. */
export const SERVER_AGENTS: readonly string[] = ['sales', 'helpdesk', 'production', 'accounting', 'comms', 'coder', 'orchestrator'];

/** Every department a memory entry can belong to. */
export const MEMORY_DEPARTMENTS: readonly string[] = [...MARKETING_FAMILY, ...SERVER_AGENTS];

const DEPARTMENT_SET: ReadonlySet<string> = new Set(MEMORY_DEPARTMENTS);
const FAMILY_SET: ReadonlySet<string> = new Set(MARKETING_FAMILY);

export function isMemoryDepartment(value: unknown): value is string {
  return typeof value === 'string' && DEPARTMENT_SET.has(value);
}

export function isMarketingTopic(value: unknown): value is string {
  return typeof value === 'string' && FAMILY_SET.has(value);
}

/** Every agent with a row of its own on the Memory page, in the page's order. */
export const TEAM_AGENTS = ['orchestrator', 'sales', 'helpdesk', 'marketing', 'production', 'accounting', 'coder', 'comms'] as const;
export type TeamAgent = (typeof TEAM_AGENTS)[number];

export function isTeamAgent(value: unknown): value is TeamAgent {
  return typeof value === 'string' && (TEAM_AGENTS as readonly string[]).includes(value);
}

/** Each agent's job, in the Memory page's words (memory-categories.ts AGENT_JOBS). */
export const AGENT_NAMES: Readonly<Record<TeamAgent, string>> = {
  orchestrator: 'Chief of staff',
  sales: 'Sales',
  helpdesk: 'Support',
  marketing: 'Marketing',
  production: 'Production',
  accounting: 'Accounting',
  coder: 'Website',
  comms: 'Communications',
};

/** The Marketing team's topics, in owner words (memory-categories.ts MARKETING_TOPIC_NAMES). */
export const TOPIC_NAMES: Readonly<Record<string, string>> = {
  marketing: 'Marketing strategy',
  seo: 'SEO',
  content: 'Content',
  social: 'Social',
  ppc: 'Paid ads',
  email: 'Email',
  branding: 'Branding',
  customer_journey: 'Customer journey',
  knowledge_base: 'Knowledge base',
  outbound: 'Outbound',
  workflow: 'Workflow',
  before_after_grid: 'Before and after',
  website_design: 'Website design',
  customer_avatar: 'Ideal customers',
  analytics: 'Analytics',
};

/** The Marketing topic whose profiles and notes are documents about buyers, not an agent (decision 4). */
export const IDEAL_CUSTOMERS = 'customer_avatar';

export const SHARED_NAME = 'Shared with every agent';
export const BUSINESS_NAME = 'About your business';

/**
 * An owner key in words: "Sales", "Chief of staff", "SEO", "Shared with every
 * agent" for no owner, else the key with its underscores as spaces.
 */
export function ownerName(key: string | null | undefined): string {
  if (!key) return SHARED_NAME;
  if (isTeamAgent(key)) return AGENT_NAMES[key];
  return TOPIC_NAMES[key] ?? key.replace(/_/g, ' ');
}

// ─── What the text declares ─────────────────────────────────────────

/** The owner rule's marker (builder memory-department.ts): the FIRST one in the text. */
const MARKER_RE = /<!--\s*department:\s*(\w+)\s*-->/i;
/** The one marker line `parseIdentity` skips above front matter (builder LEADING_DEPARTMENT_MARKER). */
const LEADING_MARKER_RE = /^[ \t\n\r\f\v]*<!--[ \t\n\r\f\v]*department:[ \t\n\r\f\v]*[A-Za-z0-9_]+[ \t\n\r\f\v]*-->[ \t\n\r\f\v]*\n/i;
const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function normalize(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return v ? v : null;
}

/**
 * The front matter at the top of an entry (one leading marker line skipped, as
 * the builder's `parseIdentity` does), or null when there is none.
 */
export function frontMatterOf(content: unknown): string | null {
  const raw = typeof content === 'string' ? content : '';
  return raw.replace(LEADING_MARKER_RE, '').match(FRONT_MATTER_RE)?.[1] ?? null;
}

function decodeQuoted(inner: string): string {
  try {
    const decoded: unknown = JSON.parse(`"${inner}"`);
    return typeof decoded === 'string' ? decoded : inner;
  } catch {
    return inner;
  }
}

/** One front matter field, read exactly as the builder's `parseIdentity` reads it. */
function readField(header: string, key: string): string {
  const m = header.match(new RegExp(`^${key}:\\s*"((?:[^"\\\\\\n]|\\\\.)*)"|^${key}:\\s*(\\S.*)$`, 'mi'));
  if (!m) return '';
  const value = m[1] !== undefined ? decodeQuoted(m[1]) : (m[2] ?? '');
  return value.replace(/^\s+/, '');
}

/** The `department:` the front matter declares, as written (lowercased), or null. */
export function frontMatterDepartment(content: unknown): string | null {
  const header = frontMatterOf(content);
  return header === null ? null : normalize(readField(header, 'department'));
}

/**
 * The department the text's marker names: the FIRST `<!-- department: x -->`,
 * and only when x is a department. Another word is no signal at all.
 */
export function markerDepartment(content: unknown): string | null {
  const v = normalize((typeof content === 'string' ? content : '').match(MARKER_RE)?.[1]);
  return v && DEPARTMENT_SET.has(v) ? v : null;
}

/** The front matter's department when it is a department (the declaration a non-profile row may carry). */
function declaredDepartment(content: unknown): string | null {
  const v = frontMatterDepartment(content);
  return v && DEPARTMENT_SET.has(v) ? v : null;
}

// ─── The one owner rule ─────────────────────────────────────────────

/** A memory row as memory_list / memory_get return it (the fields the rule reads). */
export interface OwnerInput {
  domain?: unknown;
  /** The `department` column. */
  department?: unknown;
  content?: unknown;
  /** The builder's resolved owner, when the route sends one (null: shared with every agent). */
  owner?: unknown;
  /** The builder's "shared with every agent" flag, when the route sends one. */
  shared?: unknown;
  project_id?: unknown;
}

const TYPED_PREFIXES = ['_rule:', '_skill:', '_command:', '_agent:'];
const IDENTITY_PREFIX = '_identity:';

/** True for `_rule:`, `_skill:`, `_command:` and `_agent:` rows. */
export function isTypedDomain(domain: unknown): boolean {
  const d = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
  return TYPED_PREFIXES.some((prefix) => d.startsWith(prefix));
}

/**
 * The department that owns a row, or null when no agent does (shared with
 * every agent). 'account' for the two About your business rows.
 */
export function ownerOf(row: OwnerInput): string | null {
  if (row && Object.prototype.hasOwnProperty.call(row, 'owner')) {
    if (row.owner === null) return null;
    const given = normalize(row.owner);
    if (given) return given;
    // Any other shape is not an answer: the rule below decides.
  }
  if (row?.shared === true) return null;
  return ownerByRule(row ?? {});
}

/** THE ONE OWNER RULE on the row's own fields (see the header). */
export function ownerByRule(row: OwnerInput): string | null {
  // The stored name exactly as stored: only that is a department name (the
  // builder compares it untrimmed). The prefix checks read it trimmed and lowercased.
  const raw = typeof row.domain === 'string' ? row.domain : '';
  const domain = raw.trim().toLowerCase();
  if (isAccountMemoryDomain(domain)) return 'account';
  const content = typeof row.content === 'string' ? row.content : '';
  const column = normalize(row.department);

  if (domain.startsWith(IDENTITY_PREFIX)) {
    // A profile: the slug when it names a department, else what the front
    // matter declares, as written (hydration selects a profile by that exact
    // string). The column and markers are no signal here.
    const slug = domain.slice(IDENTITY_PREFIX.length).trim();
    return DEPARTMENT_SET.has(slug) ? slug : frontMatterDepartment(content);
  }

  const marker = markerDepartment(content);
  if (TYPED_PREFIXES.some((prefix) => domain.startsWith(prefix))) {
    if (column && column !== 'marketing') return column; // (a)
    if (marker && FAMILY_SET.has(marker)) return marker; // (b)
    if (column === 'marketing') return 'marketing'; // (c)
    return marker ?? declaredDepartment(content); // (d)
  }

  // Notes and every other row: column, then the text's declaration, then a
  // domain that is itself a department (builder deriveDepartmentFromDomain).
  return column ?? marker ?? declaredDepartment(content) ?? (DEPARTMENT_SET.has(raw) ? raw : null);
}

// ─── Where the Memory page puts a row ───────────────────────────────

export type RowKind = 'rule' | 'skill' | 'shortcut' | 'specialist' | 'profile' | 'note';

const KIND_PREFIXES: ReadonlyArray<[string, RowKind]> = [
  ['_rule:', 'rule'],
  ['_skill:', 'skill'],
  ['_command:', 'shortcut'],
  ['_agent:', 'specialist'],
  ['_identity:', 'profile'],
];

/** What kind of item a domain holds, or null for an internal shape no page draws. */
export function rowKind(domain: string): RowKind | null {
  const d = domain.trim().toLowerCase();
  for (const [prefix, kind] of KIND_PREFIXES) if (d.startsWith(prefix)) return kind;
  if (/^_[a-z_]+:/.test(d)) return null;
  return 'note';
}

/** The group an agent shows a kind under. */
const KIND_GROUP: Record<RowKind, string> = {
  profile: 'profile',
  rule: 'rules',
  skill: 'skills',
  note: 'notes',
  shortcut: 'shortcuts',
  specialist: 'specialists',
};

/** The groups in the order the Memory page draws them. */
export const GROUP_ORDER: readonly string[] = [
  'profile',
  'how-it-works',
  'background',
  'voice',
  'rules',
  'skills',
  'notes',
  'moved',
  'ideal-customers',
  'shortcuts',
  'specialists',
];
/** Each group's name on the Memory page. */
export const GROUP_NAMES: Readonly<Record<string, string>> = {
  profile: 'Profile',
  'how-it-works': 'How it works',
  background: 'Background',
  voice: 'Voice and pronunciation',
  rules: 'Rules',
  skills: 'Skills',
  notes: 'Notes',
  moved: 'Moved to About your business',
  'ideal-customers': 'Documents',
  shortcuts: 'Shortcuts',
  specialists: 'Specialists',
};

/** Never shown on the Memory page (E3 rule 7). */
export const SYSTEM_PREFIXES: readonly string[] = ['_workspace:', '_digest:', '_custom_field:'];

/** The five business topics the chief of staff used to keep, now in About your business. */
const MOVED_TOPICS: ReadonlySet<string> = new Set([
  '_account:memory:about-this-business',
  '_account:memory:team-and-roles',
  '_account:memory:current-quarter-goals',
  '_account:memory:active-initiatives',
  '_account:memory:user-preferences',
]);

const VOICE_DOMAINS: ReadonlySet<string> = new Set(['_account:pronunciations', '_account:voice_settings']);

/** The heading of the security preamble hydration injects (builder memory-sanitize.ts). */
const SECURITY_MARKER = '# Security context — read this BEFORE every action';
const PREAMBLE_TERMINATOR_RE = /^─{4,}\s*$/m;
const TOP_HEADING_RE = /^# /m;

/** The text without the injected security preamble(s) (builder stripAgentPreamble). */
function stripAgentPreamble(content: string): string {
  let out = content;
  for (;;) {
    const i = out.indexOf(SECURITY_MARKER);
    if (i < 0) return out;
    const rest = out.slice(i);
    const terminator = rest.match(PREAMBLE_TERMINATOR_RE);
    let end: number;
    if (terminator) {
      end = (terminator.index ?? 0) + terminator[0].length;
    } else {
      const next = rest.slice(SECURITY_MARKER.length).match(TOP_HEADING_RE);
      end = next ? SECURITY_MARKER.length + (next.index ?? 0) : rest.length;
    }
    out = (out.slice(0, i) + rest.slice(end)).replace(/^\n+/, '');
  }
}

function isPreambleOnly(content: unknown): boolean {
  return typeof content === 'string' && content.includes(SECURITY_MARKER) && stripAgentPreamble(content).trim() === '';
}

export type Placement =
  /** Under About your business (Voice and pronunciation). */
  | { place: 'business'; group: 'voice' }
  /** Shared with every agent. */
  | { place: 'shared'; group: string }
  /** Under an agent; for the Marketing team, under one topic. */
  | { place: 'agent'; agent: TeamAgent; topic: string | null; group: string }
  /** Filed for an owner the Memory page does not show it under (see the header). */
  | { place: 'other'; owner: string; group: string }
  /** Never drawn: internal state, an old shape, or the About your business rows themselves. */
  | { place: 'hidden'; reason: 'system' | 'legacy' | 'account' };

/** The departments whose own memory route returns one notes document, named for the agent. */
const ONE_NOTES_NAME: ReadonlySet<string> = new Set(['sales', 'helpdesk', 'comms', 'production', 'accounting', 'coder']);

function agentPlace(agent: TeamAgent, group: string, topic: string | null = null): Placement {
  return { place: 'agent', agent, topic, group };
}

/** The `_account:*` rows: Voice and pronunciation, or the chief of staff's own memory. */
function placeAccountRow(domain: string): Placement {
  if (VOICE_DOMAINS.has(domain)) return { place: 'business', group: 'voice' };
  if (domain === '_account:soul') return agentPlace('orchestrator', 'how-it-works');
  if (domain === '_account:claude') return agentPlace('orchestrator', 'background');
  if (domain.startsWith('_account:_skill:')) return agentPlace('orchestrator', 'skills');
  if (domain.startsWith('_account:_rule:')) return agentPlace('orchestrator', 'rules');
  if (domain.startsWith('_account:memory:')) return agentPlace('orchestrator', MOVED_TOPICS.has(domain) ? 'moved' : 'notes');
  return { place: 'hidden', reason: 'legacy' };
}

/** Where one row goes. Every row gets exactly one answer. */
export function placeRow(row: OwnerInput): Placement {
  const domain = typeof row.domain === 'string' ? row.domain.trim().toLowerCase() : '';
  if (isAccountMemoryDomain(domain)) return { place: 'hidden', reason: 'account' };
  if (!domain || SYSTEM_PREFIXES.some((prefix) => domain.startsWith(prefix))) return { place: 'hidden', reason: 'system' };
  if (isPreambleOnly(row.content)) return { place: 'hidden', reason: 'system' };
  if (domain.startsWith('_account:')) return placeAccountRow(domain);
  const kind = rowKind(domain);
  if (!kind) return { place: 'hidden', reason: 'system' };
  const group = KIND_GROUP[kind];
  // A website's own rows belong to the website agent, whatever they say.
  if (typeof row.project_id === 'string' && row.project_id) return agentPlace('coder', group);
  const owner = ownerOf(row);
  if (owner === null) return { place: 'shared', group };
  if (owner === 'account') return { place: 'hidden', reason: 'account' };
  // The chief of staff reads her `_account:*` rows and her profile only.
  if (owner === 'orchestrator' && kind !== 'profile') return { place: 'other', owner, group };
  if (isTeamAgent(owner) && owner !== 'marketing') {
    // The agent's own route lists one notes document, its own name.
    if (kind === 'note' && ONE_NOTES_NAME.has(owner) && domain !== owner) return { place: 'other', owner, group };
    return agentPlace(owner, group);
  }
  if (isMarketingTopic(owner)) {
    const documents = owner === IDEAL_CUSTOMERS && (kind === 'profile' || kind === 'note');
    return agentPlace('marketing', documents ? 'ideal-customers' : group, owner);
  }
  return { place: 'other', owner, group };
}

/**
 * True when VS Code must not change the row: shared with every agent, an
 * `_account:*` row, or anything the page never draws. Those are changed on the
 * Memory page (owners and admins), or not by hand at all.
 */
export function isReadOnlyRow(row: OwnerInput, placement: Placement = placeRow(row)): boolean {
  const domain = typeof row.domain === 'string' ? row.domain.trim().toLowerCase() : '';
  if (domain.startsWith('_account:')) return true;
  return placement.place === 'shared' || placement.place === 'business' || placement.place === 'hidden';
}

/** Why a row is read-only here, in one line (a save refusal and the tab both say it). */
export function readOnlyReason(placement: Placement): string {
  if (placement.place === 'shared') {
    return `It is ${SHARED_NAME.toLowerCase()}, so owners and admins change it on the Memory page.`;
  }
  if (placement.place === 'business') return `It is part of ${BUSINESS_NAME}, which owners and admins change on the Memory page.`;
  if (placement.place === 'agent' && placement.agent === 'orchestrator') {
    return "It is the chief of staff's own memory, which is changed on the Memory page.";
  }
  if (placement.place === 'hidden') return "It is internal to Hiveku's agents and is not changed by hand.";
  return 'It is changed on the Memory page.';
}

// ─── The Memory page's address ──────────────────────────────────────

export interface MemoryPageLink {
  /** A team key or a Marketing topic (`?agent=`). */
  agent?: string | null;
  /** One item of that agent, by its stored name (`&item=`). */
  item?: string | null;
  /** An About your business part (`?open=voice`). */
  open?: 'voice' | 'suggestions' | null;
}

/**
 * `https://app.hiveku.com/<account>/dashboard/memory[?agent=..&item=..|?open=..]`:
 * the one Memory page, account-scoped for a real account id (see
 * accountMemoryDashboardUrl), opened at an agent, an item or a part.
 */
export function memoryPageUrl(appUrl: string | undefined, accountId: string, link: MemoryPageLink = {}): string {
  const base = accountMemoryDashboardUrl(appUrl, accountId);
  const query = new URLSearchParams();
  const agent = link.agent?.trim().toLowerCase();
  if (agent && (isTeamAgent(agent) || isMarketingTopic(agent))) {
    query.set('agent', agent);
    const item = link.item?.trim();
    if (item) query.set('item', item);
  } else if (link.open) {
    query.set('open', link.open);
  }
  const qs = query.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Where "Open in Memory" goes for a placed row. */
export function memoryLinkFor(placement: Placement, domain: string): MemoryPageLink {
  switch (placement.place) {
    case 'business':
      return { open: 'voice' };
    case 'agent':
      return { agent: placement.agent === 'marketing' ? placement.topic ?? 'marketing' : placement.agent, item: domain };
    case 'other':
      return isTeamAgent(placement.owner) || isMarketingTopic(placement.owner) ? { agent: placement.owner } : {};
    default:
      // Shared with every agent sits under About your business, where the page opens.
      return {};
  }
}

// ─── New entries (audit G7) ─────────────────────────────────────────

/**
 * Departments the builder knows that the agent servers do not follow yet
 * (builder memory-types.ts DEPARTMENTS_NOT_ON_AGENT_SERVERS). Nothing new is
 * filed under them from here until the servers ship them.
 */
export const NOT_YET_ON_AGENT_SERVERS: readonly string[] = ['analytics'];

export interface NewEntryAgent {
  key: string;
  label: string;
  /** A Marketing topic (or the Marketing lead), grouped under the Marketing team in the picker. */
  marketing: boolean;
}

/**
 * Who a new rule, skill, shortcut, specialist or notes document can be for, in
 * the Memory page's order and words. Not the chief of staff: she reads only her
 * own `_account:*` memory, which is changed on the Memory page, so a rule filed
 * for her here would be one she never reads. Not "shared with every agent":
 * owners and admins add those on the Memory page.
 */
export function newEntryAgents(): NewEntryAgent[] {
  const team: NewEntryAgent[] = (['sales', 'helpdesk', 'comms', 'production', 'accounting', 'coder'] as TeamAgent[]).map((key) => ({
    key,
    label: AGENT_NAMES[key],
    marketing: false,
  }));
  const topics: NewEntryAgent[] = MARKETING_FAMILY.filter((key) => !NOT_YET_ON_AGENT_SERVERS.includes(key)).map((key) => ({
    key,
    label: TOPIC_NAMES[key] ?? key,
    marketing: true,
  }));
  return [...team, ...topics];
}

export function isNewEntryDepartment(value: unknown): value is string {
  return typeof value === 'string' && newEntryAgents().some((a) => a.key === value);
}

export type NewEntryKind = 'rule' | 'skill' | 'command' | 'agent' | 'memory';

/** The kinds "+ New entry" makes, with the Memory page's names for them. */
export const NEW_ENTRY_KINDS: ReadonlyArray<{ kind: NewEntryKind; label: string; detail: string }> = [
  { kind: 'rule', label: 'Rule', detail: 'Always or never' },
  { kind: 'skill', label: 'Skill', detail: 'Step by step, like a playbook' },
  { kind: 'command', label: 'Shortcut', detail: 'A /command the agent runs' },
  { kind: 'agent', label: 'Specialist', detail: 'A persona the agent hands work to' },
  { kind: 'memory', label: 'Notes', detail: 'The notes the agent keeps (one document)' },
];

const TYPE_PREFIX: Record<Exclude<NewEntryKind, 'memory'>, string> = {
  rule: '_rule:',
  skill: '_skill:',
  command: '_command:',
  agent: '_agent:',
};

/** `account_ai_memory.domain` is varchar(50) (builder MEMORY_DOMAIN_MAX). */
export const MEMORY_DOMAIN_MAX = 50;
/** A typed entry's name: kebab-case, starts and ends with a letter or digit (builder SLUG_RE). */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

/** Why `name` cannot name a new entry of this kind, or undefined when it can. */
export function newEntryNameError(kind: Exclude<NewEntryKind, 'memory'>, name: string): string | undefined {
  const max = MEMORY_DOMAIN_MAX - TYPE_PREFIX[kind].length;
  if (!SLUG_RE.test(name)) return 'Lowercase letters, digits and dashes, 2 or more characters, starting and ending with a letter or digit.';
  if (name.length > max) return `At most ${max} characters for this kind.`;
  return undefined;
}

/** The stored name (domain) a new entry gets. Notes are named for their agent. */
export function newEntryDomain(kind: NewEntryKind, department: string, name: string): string {
  return kind === 'memory' ? department : `${TYPE_PREFIX[kind]}${name}`;
}

/**
 * The kind and name of a new entry's domain, or null when it is not one
 * "+ New entry" makes for `department` (notes are named for their agent).
 */
export function newEntryOf(domain: string, department: string): { kind: NewEntryKind; name: string } | null {
  if (!isNewEntryDepartment(department)) return null;
  for (const [kind, prefix] of Object.entries(TYPE_PREFIX) as Array<[Exclude<NewEntryKind, 'memory'>, string]>) {
    if (!domain.startsWith(prefix)) continue;
    const name = domain.slice(prefix.length);
    return newEntryNameError(kind, name) ? null : { kind, name };
  }
  return domain === department ? { kind: 'memory', name: department } : null;
}

// ─── The marker on save ─────────────────────────────────────────────

/**
 * `text` with a `<!-- department: x -->` line: after the front matter when the
 * text starts with one (a slash command or skill keeps its front matter
 * first), else on the first line.
 */
export function withDepartmentMarker(text: string, department: string): string {
  const line = `<!-- department: ${department} -->`;
  const fm = text.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
  if (fm) return `${fm[0].endsWith('\n') ? fm[0] : `${fm[0]}\n`}${line}\n${text.slice(fm[0].length)}`;
  return `${line}\n${text}`;
}

export type OwnerSaveCheck =
  /** Save `text`. `kept`: the department whose marker was put back after the edit dropped it. */
  | { ok: true; text: string; kept: string | null }
  /** The edit would move the entry to another agent: refused. */
  | { ok: false; from: string | null; to: string };

/**
 * An edit to a rule, skill, shortcut or specialist may not quietly move it.
 * The agents that read only the text follow its marker, so:
 *   - a marker line the edit dropped is put back;
 *   - a marker the edit changed to another agent is refused, unless it now
 *     names the agent that owns the entry. Moving an entry to another agent
 *     is done on the Memory page.
 * Profiles and notes are left as they are.
 */
export function checkOwnerOnSave(stored: OwnerInput, text: string): OwnerSaveCheck {
  if (!isTypedDomain(stored.domain)) return { ok: true, text, kept: null };
  const owner = ownerOf(stored);
  const had = markerDepartment(stored.content);
  const next = markerDepartment(text);
  if (next) {
    if (next === had || next === owner) return { ok: true, text, kept: null };
    return { ok: false, from: owner, to: next };
  }
  if (had) return { ok: true, text: withDepartmentMarker(text, had), kept: had };
  return { ok: true, text, kept: null };
}
