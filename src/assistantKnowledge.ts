/**
 * "Website assistant knowledge" in the Helpdesk panel: what the website chat
 * assistant can answer from, so the owner reading VS Code sees the same truth
 * the dashboard's "Where it finds answers" card shows.
 *
 * Read-only. The rows come from the MCP tool helpdesk_assistant_knowledge_status,
 * which maps to GET /api/olympus/helpdesk/assistant/knowledge (Round 3 contract
 * C7; the account comes from the API key). Its answer:
 *
 *   { ok: true, assistant_enabled,
 *     sources: { help_articles: { published }, saved_answers: { usable, waiting_for_placeholders },
 *                reference_info: { entries }, business_info: { enabled, connected, last_synced_at },
 *                website_pages: { enabled, pages, hosts: [{ host, status, reason?, last_read_at? }], next_read_at },
 *                documents: { enabled, knowledge_bases: [{ id, name, pages }] } },
 *     unanswered_last_30_days, advice: string[] }
 *
 * One row per line of that answer, in reading order: the assistant itself,
 * the server's plain-language next steps, then each source, with the website
 * hosts under "Website pages" and the ticked knowledge bases under "Documents
 * you choose". A shape this cannot read throws, so the panel shows a fault
 * instead of an assistant that seems to have nothing to answer from.
 */

export const ASSISTANT_KNOWLEDGE_TOOL = 'helpdesk_assistant_knowledge_status';

/** The website assistant's settings page, below /<accountId>/dashboard/. */
export const ASSISTANT_SETTINGS_SUB = 'helpdesk/ai-agent';

/** "Copy for Claude" on the section: the same question, answered by an AI that can also help fix it. */
export const ASSISTANT_KNOWLEDGE_PROMPT =
  'In Hiveku, call helpdesk_assistant_knowledge_status and tell me in plain words what my website assistant can answer from: ' +
  'which sources are on, what it read from my website and when, what it skipped and why, and what I should do to close any gaps. ' +
  'Change nothing without asking me first.';

export interface KnowledgeRow {
  kind: 'assistant' | 'advice' | 'source' | 'host' | 'knowledge_base';
  title: string;
  /** on / off / read / skipped / not read yet / next step. */
  state?: string;
  /** A count in words: "12 published articles". */
  amount?: string;
  last_read_at?: string;
  last_synced_at?: string;
  next_read_at?: string;
  reason?: string;
  [key: string]: unknown;
}

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const asObj = (value: unknown): Obj => (isObj(value) ? value : {});
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const when = (value: unknown): string | undefined => text(value) || undefined;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const onOff = (value: unknown): string | undefined => (value === true ? 'on' : value === false ? 'off' : undefined);

const HOST_STATE: Record<string, string> = { read: 'read', skipped: 'skipped', never_read: 'not read yet' };

const UNREADABLE =
  "Could not read the website assistant's knowledge status. This is a display fault, not an assistant with nothing to answer from.";

/** Drop the keys whose value is undefined, so the panel's filter sees only what is there. */
function row(fields: KnowledgeRow): KnowledgeRow {
  const out: KnowledgeRow = { kind: fields.kind, title: fields.title };
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) out[key] = value;
  return out;
}

export function assistantKnowledgeRows(raw: unknown): KnowledgeRow[] {
  const top = asObj(raw);
  const data = isObj(top.data) ? top.data : top;
  if (data.ok === false) throw new Error(text(data.error) || text(data.message) || UNREADABLE);
  if (!isObj(data.sources)) throw new Error(UNREADABLE);
  const sources = data.sources;
  const rows: KnowledgeRow[] = [];

  const unanswered = count(data.unanswered_last_30_days);
  rows.push(
    row({
      kind: 'assistant',
      title: 'Website assistant',
      state: onOff(data.assistant_enabled),
      amount:
        unanswered === null
          ? undefined
          : unanswered === 0
            ? 'no unanswered questions in the last 30 days'
            : `${plural(unanswered, 'question')} it could not answer in the last 30 days`,
    }),
  );

  for (const line of Array.isArray(data.advice) ? data.advice : []) {
    const advice = text(line);
    if (advice) rows.push(row({ kind: 'advice', title: advice, state: 'next step' }));
  }

  if (isObj(sources.help_articles)) {
    const published = count(sources.help_articles.published);
    rows.push(
      row({
        kind: 'source',
        title: 'Help articles',
        state: 'always on',
        amount: published === null ? undefined : plural(published, 'published article'),
      }),
    );
  }

  if (isObj(sources.saved_answers)) {
    const usable = count(sources.saved_answers.usable);
    const waiting = count(sources.saved_answers.waiting_for_placeholders);
    const parts = [
      usable === null ? '' : `${usable} ready to use`,
      waiting ? `${waiting} waiting for placeholders to be filled in` : '',
    ].filter(Boolean);
    rows.push(row({ kind: 'source', title: 'Saved answers', state: 'always on', amount: parts.join(', ') || undefined }));
  }

  if (isObj(sources.reference_info)) {
    const entries = count(sources.reference_info.entries);
    rows.push(
      row({ kind: 'source', title: 'Reference info', amount: entries === null ? undefined : plural(entries, 'entry', 'entries') }),
    );
  }

  if (isObj(sources.business_info)) {
    const info = sources.business_info;
    const state = info.enabled === true && info.connected === false ? 'on, but no listing is connected' : onOff(info.enabled);
    rows.push(row({ kind: 'source', title: 'Google Business Profile', state, last_synced_at: when(info.last_synced_at) }));
  }

  if (isObj(sources.website_pages)) {
    const site = sources.website_pages;
    const pages = count(site.pages);
    rows.push(
      row({
        kind: 'source',
        title: 'Website pages',
        state: onOff(site.enabled),
        amount: pages === null ? undefined : `${plural(pages, 'page')} read`,
        next_read_at: when(site.next_read_at),
      }),
    );
    for (const entry of Array.isArray(site.hosts) ? site.hosts : []) {
      const host = asObj(entry);
      const name = text(host.host);
      if (!name) continue;
      const status = text(host.status);
      rows.push(
        row({
          kind: 'host',
          title: `Website: ${name}`,
          state: HOST_STATE[status] ?? (status || undefined),
          last_read_at: when(host.last_read_at),
          reason: text(host.reason) || undefined,
        }),
      );
    }
  }

  if (isObj(sources.documents)) {
    const docs = sources.documents;
    const bases = (Array.isArray(docs.knowledge_bases) ? docs.knowledge_bases : []).filter(isObj);
    rows.push(
      row({
        kind: 'source',
        title: 'Documents you choose',
        state: onOff(docs.enabled),
        amount: docs.enabled === true ? `${plural(bases.length, 'knowledge base')} ticked` : undefined,
      }),
    );
    for (const base of bases) {
      const pages = count(base.pages);
      rows.push(
        row({
          kind: 'knowledge_base',
          title: `Knowledge base: ${text(base.name) || '(unnamed)'}`,
          amount: pages === null ? undefined : plural(pages, 'page'),
          id: text(base.id) || undefined,
        }),
      );
    }
  }

  return rows;
}
