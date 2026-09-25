/**
 * Module registry — each entry declares how to operate one Hiveku area from the
 * generic panel engine (panel.ts). Sections list rows from an MCP tool; actions
 * call tools (with optional input prompts / confirms), deep-link, or open chat.
 *
 * Field/tool names are best-effort from the capability audit; the engine
 * tolerates missing fields and a section that errors just shows "unavailable",
 * so this is safe to ship broad and tighten against a live account.
 */

import type { ActionSpec, ActionUi, ModuleSpec } from './panel';
import {
  formCapturePreview,
  formCapturePurge,
  formCapturePurgeDryRun,
  formCaptureRefusal,
  formCaptureSettingsGet,
  formCaptureSettingsUpdate,
  maskSecret,
  workflowEnable,
} from './hivekuApi';
import type {
  FormCapturePatch,
  FormCapturePreviewChange,
  FormCapturePurgeOutcome,
  FormCapturePurgePlan,
  FormCaptureRuleAction,
  WorkflowValidationIssue,
} from './hivekuApi';
import type { HivekuMcpClient } from './mcpClient';
import {
  ASSISTANT_KNOWLEDGE_PROMPT,
  ASSISTANT_KNOWLEDGE_TOOL,
  ASSISTANT_SETTINGS_SUB,
  assistantKnowledgeRows,
} from './assistantKnowledge';
import {
  TICKET_SUBJECT_FENCE_SOURCE,
  UNTRUSTED_PROMPT_NOTE,
  displayUntrusted,
  fencedForAgent,
} from './untrustedText';

const open = (label = 'Open in Hiveku', sub?: string) =>
  ({ id: 'open', label, kind: 'open' as const, ...(sub ? { sub } : {}) });
const chat = (department: string, label = 'Ask agent') =>
  ({ id: 'chat', label, kind: 'chat' as const, department });

// ============================================================
// Social publishing is a GOVERNANCE GATE, not a button.
//
// social_publish_post on a post no person has approved does NOT publish: the
// route moves the post into the dashboard approval queue and returns
// { pending_approval: true }. It publishes immediately only when
// approval_status is already 'approved' and there is no live future schedule
// (a scheduled + approved post is the cron's; the route answers 409 and this
// surface has no override). The label, confirm text, guards and completion
// message below say exactly that. There is deliberately NO approve action in
// this panel: the MCP server exposes none, because a tool that approves would
// let the same agent, in the same turn, release what it just staged. Releasing
// a held post is a human act in the dashboard (Marketing > Social > Approvals).
// social_post_reject only ever moves a post backwards, to draft.
//
// Values come from the social_posts columns: status is draft | scheduled |
// pending_approval | publishing | published | failed | archived, approval_status
// is not_required | pending | approved | rejected.
// ============================================================

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

// ============================================================
// Enabling a workflow is VALIDATED, not a toggle.
//
// workflow_enable on a DISABLED workflow runs workflow_validate first. Any error
// (a node missing a required field, no trigger, a dangling edge) comes back as
// 422 { error: 'workflow_invalid', issues } and nothing changes. The problems
// are listed and the operator decides: "Enable anyway" re-sends with
// allow_incomplete:true, which is exactly the explicit yes the override exists
// for. Runs can then fail until the problems are fixed.
//
// An MCP server that predates allow_incomplete drops the argument, so the
// second call is refused the same way; that case lists the problems without
// offering the override again. Re-enabling an already-enabled workflow is
// never refused.
// ============================================================

const MAX_LISTED_ISSUES = 12;
function issueList(issues: WorkflowValidationIssue[]): string {
  if (issues.length === 0) return 'Run workflow_validate to see the problems.';
  const lines = issues
    .slice(0, MAX_LISTED_ISSUES)
    .map((issue) => `- ${issue.message || issue.code || 'Unnamed problem'}`);
  if (issues.length > MAX_LISTED_ISSUES) lines.push(`- and ${issues.length - MAX_LISTED_ISSUES} more`);
  return lines.join('\n');
}

/** The Enable flow, shared by the Automations panel row action and the console toggle. */
export const enableWorkflow: NonNullable<ActionSpec['run']> = async (client, args, ui) => {
  const id = asString(args.id);
  const first = await ui.progress('Enable…', () => workflowEnable(client, id));
  if (first.enabled) return { result: first.result };

  const count = first.refusal.issues.length;
  const heading = `${ui.subject || 'This workflow'} has ${count || 'some'} problem${count === 1 ? '' : 's'} to fix before it can be enabled.`;
  if (first.refusal.overrideUnavailable) {
    await ui.warn(`Not enabled. ${heading}`, issueList(first.refusal.issues));
    return null;
  }
  const enableAnyway = await ui.confirm(
    heading,
    `${issueList(first.refusal.issues)}\n\nEnable anyway only if you accept that runs can fail until these are fixed.`,
    'Enable anyway',
  );
  if (!enableAnyway) return null;

  const second = await ui.progress('Enable anyway…', () => workflowEnable(client, id, true));
  if (second.enabled) return { result: second.result };
  await ui.warn(
    'Not enabled. This Hiveku server does not accept "Enable anyway" yet: fix the problems below, or enable it from the workflow editor in the Hiveku dashboard.',
    issueList(second.refusal.issues),
  );
  return null;
};

/** Non-null when an override enabled a workflow that still has errors (the 200 carries `validation.errors`). */
export function enabledAnywayNote(result: unknown): string | null {
  const data = result && typeof result === 'object' ? (result as { data?: unknown }).data : undefined;
  const validation = data && typeof data === 'object' ? (data as { validation?: unknown }).validation : undefined;
  const errors = validation && typeof validation === 'object' ? (validation as { errors?: unknown }).errors : undefined;
  if (typeof errors === 'number' && errors > 0) {
    return errors === 1
      ? 'Enabled anyway - 1 problem remains; runs can fail until it is fixed.'
      : `Enabled anyway - ${errors} problems remain; runs can fail until they are fixed.`;
  }
  return null;
}
const enableDone = (result: unknown): string => enabledAnywayNote(result) ?? 'Enable - done.';

const isFutureDate = (value: unknown): boolean => {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const parsed = Date.parse(String(value));
  return !Number.isNaN(parsed) && parsed > Date.now();
};

/** The route returns { pending_approval: true } bare; read it under `data` too in case a proxy wraps it. */
const isPendingApproval = (result: unknown): boolean => {
  if (!result || typeof result !== 'object') return false;
  const top = result as Record<string, unknown>;
  if (top.pending_approval === true) return true;
  const data = top.data;
  return !!data && typeof data === 'object' && (data as Record<string, unknown>).pending_approval === true;
};

/** publishPost returns { success, errors[] } under `data`; a partial failure must not read as "Published". */
const publishErrors = (result: unknown): string[] => {
  if (!result || typeof result !== 'object') return [];
  const top = result as Record<string, unknown>;
  const data = top.data && typeof top.data === 'object' ? (top.data as Record<string, unknown>) : top;
  return Array.isArray(data.errors) ? data.errors.filter((e): e is string => typeof e === 'string') : [];
};

/** YYYY-MM-DD from the local calendar, for the calendar's DATE-typed start_date filter. */
const localDateOnly = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const APPROVALS_PATH = 'Marketing > Social > Approvals';

const SOCIAL_SEND_TO_APPROVAL: ActionSpec = {
  id: 'send_to_approval',
  label: 'Send to approval queue',
  kind: 'tool',
  tool: 'social_publish_post',
  args: (r) => ({ post_id: r.id }),
  guard: (r) => {
    const status = asString(r.status);
    const approval = asString(r.approval_status);
    if (status === 'published' || status === 'publishing') return 'Already published.';
    // Mirrors the route's isScheduledInFuture (status scheduled AND a future
    // scheduled_at): a past-due scheduled post is not the cron's any more and
    // the route publishes it, so the guard must not claim otherwise.
    if (approval === 'approved' && status === 'scheduled' && isFutureDate(r.scheduled_at)) {
      return 'This post is scheduled and approved; the cron publishes it at its slot.';
    }
    if (status === 'pending_approval' || approval === 'pending') {
      return `Already in the approval queue. A person approves it in the dashboard (${APPROVALS_PATH}).`;
    }
    return null;
  },
  confirm:
    `Send this post to the Hiveku approval queue? Nothing publishes from here: a person approves it in the dashboard (${APPROVALS_PATH}). ` +
    'If it is ALREADY approved and has no future schedule, it publishes NOW to every target account.',
  done: (result) => {
    if (isPendingApproval(result)) return 'Moved to the approval queue. Nothing was published.';
    const errors = publishErrors(result);
    if (errors.length) {
      return `Publish ran but ${errors.length} target(s) failed: ${errors.join('; ').slice(0, 300)}. Check the post in the dashboard before retrying.`;
    }
    return "Published to the post's target accounts.";
  },
};

const SOCIAL_REJECT: ActionSpec = {
  id: 'reject',
  label: 'Reject (back to draft)',
  kind: 'tool',
  tool: 'social_post_reject',
  args: (r) => ({ post_id: r.id }),
  guard: (r) =>
    asString(r.status) === 'pending_approval' || asString(r.approval_status) === 'pending'
      ? null
      : 'Only a post waiting in the approval queue can be rejected.',
  inputs: [{ key: 'reason', label: 'Reason for rejecting (stored on the post; the author sees it)' }],
  done: () => 'Rejected. The post is back in draft with the reason recorded; nothing was published.',
};

const SOCIAL_POST_TITLE_KEYS = ['title', 'content', 'caption'];

// ============================================================
// An email campaign send is a THREE-STEP ladder, not a button.
//
// email_campaign_send_now without dry_run on a draft IS the send, and the
// server does not enforce that a preview happened. So this surface does:
// 'Preview recipients' calls the same tool with dry_run: true (the list is
// materialized and counted, nothing sends, status is untouched) and remembers
// the counts per campaign; 'Test send' puts real mail in the operator's own
// inbox; 'Send now' is refused until a preview exists and then asks the user
// to TYPE the queued count from that preview before the tool is called.
// Pause holds an in-flight send (queued rows wait); Resume continues it
// without re-materializing anything.
// ============================================================

type SendPreview = { totalQueued: number; totalSkipped: number; noOptInCount: number | null; takenAt: number };

/** A preview older than this no longer describes the audience (dynamic audiences re-evaluate at send time). */
const SEND_PREVIEW_MAX_AGE_MS = 15 * 60 * 1000;

/** Last dry-run counts per campaign id, for the typed confirmation on Send now. Panel-lifetime only. */
const lastSendPreview = new Map<string, SendPreview>();

/** The campaign the in-flight preview is for; `done` receives only the tool result, not the row. */
let previewingCampaignId = '';

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * sendCampaign answers { ok, dryRun, campaignId, materialization: { totalQueued,
 * totalSkipped, skippedBreakdown, noOptInCount }, noOptInCount, ... } - read it
 * under `data` too in case a proxy wraps it.
 */
const readSendPreview = (result: unknown): { campaignId: string; preview: SendPreview } | null => {
  if (!result || typeof result !== 'object') return null;
  const top = result as Record<string, unknown>;
  const data = top.data && typeof top.data === 'object' ? (top.data as Record<string, unknown>) : top;
  const materialization =
    data.materialization && typeof data.materialization === 'object'
      ? (data.materialization as Record<string, unknown>)
      : null;
  if (!materialization) return null;
  const totalQueued = asFiniteNumber(materialization.totalQueued);
  const totalSkipped = asFiniteNumber(materialization.totalSkipped);
  if (totalQueued === null || totalSkipped === null) return null;
  const campaignId = asString(data.campaignId) || previewingCampaignId;
  const noOptInCount = asFiniteNumber(materialization.noOptInCount) ?? asFiniteNumber(data.noOptInCount);
  return { campaignId, preview: { totalQueued, totalSkipped, noOptInCount, takenAt: Date.now() } };
};

const EMAIL_PREVIEW_RECIPIENTS: ActionSpec = {
  id: 'preview',
  label: 'Preview recipients',
  kind: 'tool',
  tool: 'email_campaign_send_now',
  args: (r) => {
    previewingCampaignId = asString(r.id);
    return { id: r.id, dry_run: true };
  },
  successReload: false,
  done: (result) => {
    const read = readSendPreview(result);
    if (!read) return 'Preview ran but returned no recipient counts; nothing was sent. Read the response in the dashboard before sending.';
    if (read.campaignId) lastSendPreview.set(read.campaignId, read.preview);
    const { totalQueued, totalSkipped, noOptInCount } = read.preview;
    const optIn = noOptInCount === null ? '' : `, ${noOptInCount} with no opt-in record`;
    return `Preview only, nothing sent: ${totalQueued} would receive it, ${totalSkipped} skipped${optIn}. The 7-day frequency cap is applied at dispatch, so ${totalQueued} is an upper bound.`;
  },
};

const EMAIL_TEST_SEND: ActionSpec = {
  id: 'test',
  label: 'Test send',
  kind: 'tool',
  tool: 'email_campaign_test_send',
  args: (r) => ({ id: r.id }),
  inputs: [
    {
      key: 'to',
      label: 'Test recipients, up to 5, comma-separated. Real mailboxes only: a reserved test domain (example.com, test.com) is refused; success@simulator.amazonses.com is the no-inbox check',
      csv: true,
    },
  ],
  successReload: false,
  done: () => 'Test send accepted. Confirm the render in the inbox before a real send.',
};

/**
 * sendCampaign reports what it actually did in `transitionedTo` ('sending' or
 * 'scheduled'); a campaign with a future scheduled_for is armed, not sent, and
 * materializes nothing, so the completion message must not claim a send.
 */
const readSendOutcome = (result: unknown): { campaignId: string; transitionedTo: string; scheduledFor: string } => {
  if (!result || typeof result !== 'object') return { campaignId: previewingCampaignId, transitionedTo: '', scheduledFor: '' };
  const top = result as Record<string, unknown>;
  const data = top.data && typeof top.data === 'object' ? (top.data as Record<string, unknown>) : top;
  return {
    campaignId: asString(data.campaignId) || previewingCampaignId,
    transitionedTo: asString(data.transitionedTo),
    scheduledFor: asString(data.scheduledFor) || asString(data.scheduled_for),
  };
};

const EMAIL_SEND_NOW: ActionSpec = {
  id: 'send',
  label: 'Send now',
  kind: 'tool',
  tool: 'email_campaign_send_now',
  args: (r) => ({ id: r.id }),
  guard: (r) => {
    const preview = lastSendPreview.get(asString(r.id));
    if (!preview) return 'Run Preview recipients first: the send confirmation names the recipient count from that preview.';
    if (preview.totalQueued === 0) return 'The last preview queued 0 recipients; the server would refuse this send. Fix the audience and preview again.';
    if (Date.now() - preview.takenAt > SEND_PREVIEW_MAX_AGE_MS) return 'The last preview is more than 15 minutes old and may no longer describe the audience. Run Preview recipients again.';
    return null;
  },
  confirm: 'Send this campaign now to real recipients? Dispatch starts on the next cron tick and cannot be recalled once rows are sent.',
  confirmTyped: (r) => {
    const preview = lastSendPreview.get(asString(r.id));
    if (!preview) return null;
    return {
      prompt: `Type ${preview.totalQueued} (the recipient count from the last preview) to send`,
      expected: String(preview.totalQueued),
    };
  },
  done: (result) => {
    const outcome = readSendOutcome(result);
    if (outcome.campaignId) lastSendPreview.delete(outcome.campaignId);
    if (outcome.transitionedTo === 'scheduled') {
      const when = outcome.scheduledFor ? ` until ${outcome.scheduledFor}` : ' until its scheduled time';
      return `Scheduled, not sent: this campaign has a future send time, so nothing was materialized and nothing goes out${when}. To send immediately, clear the schedule first.`;
    }
    const read = readSendPreview(result);
    if (read) {
      return `Send started: ${read.preview.totalQueued} queued, ${read.preview.totalSkipped} skipped. Dispatch runs on a ~60s tick; verify with email_campaign_metrics (status sent and by_status.sent > 0).`;
    }
    return 'Send accepted. Dispatch runs on a ~60s tick; verify with email_campaign_metrics (status sent and by_status.sent > 0).';
  },
};

// ============================================================
// Ticket subjects arrive FENCED. Since 2026-09-24 the Olympus API wraps every
// helpdesk subject in <untrusted_external_content source="helpdesk_ticket_subject">
// because a stranger wrote it (an email subject line, a chat visitor's first
// message) and AI agents read the same answer.
//
// A person reading the list sees the words: each row gets display_title with
// the fence stripped, and that is the title the panel lists, filters on and
// names in its modals. The raw subject stays on the row untouched, and "Copy
// for Claude" builds its prompt from it with the fence kept (or added, if an
// older server sent it bare) plus one line saying what the fence means. The
// stripped text never goes to an AI. See untrustedText.ts.
// ============================================================

const isRow = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** First array property whose elements are objects (preferred), else the first array: the panel engine's rule. */
function firstObjectArray(obj: Record<string, unknown>): unknown[] | undefined {
  let fallback: unknown[] | undefined;
  for (const value of Object.values(obj)) {
    if (!Array.isArray(value)) continue;
    if (value.length && typeof value[0] === 'object' && value[0] !== null) return value;
    fallback ??= value;
  }
  return fallback;
}

/**
 * The row array from a list tool's answer, found the way the panel engine
 * finds it ([...], { data: [...] }, { data: { tickets: [...] } }). A shape it
 * cannot read throws: zero rows from it would render as a quiet inbox.
 */
function listToolRows(raw: unknown, tool: string): unknown[] {
  const inner = isRow(raw) && 'data' in raw ? raw.data : raw;
  if (Array.isArray(inner)) return inner;
  const nested = (isRow(inner) && firstObjectArray(inner)) || (isRow(raw) && firstObjectArray(raw));
  if (nested) return nested;
  if (inner === null || inner === undefined || (isRow(inner) && Object.keys(inner).length === 0)) return [];
  throw new Error(`Could not read the response from ${tool}. This is a display fault, not an empty list: the tickets may exist.`);
}

/** Ticket rows with display_title: the subject (or title) as a person reads it. Everything else is untouched. */
export const helpdeskTicketRows =
  (tool: string) =>
  (raw: unknown): Array<Record<string, unknown>> =>
    listToolRows(raw, tool)
      .filter(isRow)
      .map((ticket) => ({ ...ticket, display_title: displayUntrusted(ticket.subject) || displayUntrusted(ticket.title) }));

const TICKET_TITLE_KEYS = ['display_title', 'subject', 'title'];

/** "Copy for Claude" on a ticket: the subject stays fenced, and the prompt says what the fence means. */
export function ticketCopyPrompt(row: Record<string, unknown>): string {
  const id = String(row.id ?? row.ticket_id ?? '');
  const subject = fencedForAgent(asString(row.subject) || asString(row.title), TICKET_SUBJECT_FENCE_SOURCE);
  return [
    subject ? `In Hiveku, handle helpdesk ticket ${id}. Its subject:` : `In Hiveku, handle helpdesk ticket ${id}.`,
    ...(subject ? [subject] : []),
    UNTRUSTED_PROMPT_NOTE,
    `Load it with helpdesk_ticket_get({ id: "${id}", include: "messages" }), then draft a reply (send via helpdesk_ticket_send_reply once I approve).`,
  ].join('\n');
}

export const MODULES: ModuleSpec[] = [
  {
    id: 'crm',
    label: 'CRM / Sales',
    icon: 'organization',
    sections: [
      {
        id: 'deals',
        label: 'Deals',
        tool: 'crm_list_deals',
        args: { limit: 50 },
        titleKeys: ['name'],
        fields: [
          { keys: ['value'], money: true },
          { keys: ['stage.name'], label: 'stage' },
          { keys: ['status'], label: 'status' },
          { keys: ['close_date'], label: 'close', date: true },
        ],
        rowActions: [
          { id: 'status', label: 'Set status', kind: 'tool', tool: 'crm_update_deal', args: (r) => ({ deal_id: r.id }), inputs: [{ key: 'status', label: 'Deal status', options: ['open', 'won', 'lost', 'abandoned'] }] },
          open('Open', 'crm'),
          chat('sales'),
        ],
        detail: { tool: 'crm_get_deal', idKeys: ['id', 'deal_id'], idArg: 'deal_id' },
        empty: 'No deals.',
      },
      {
        id: 'contacts',
        label: 'Contacts',
        tool: 'crm_list_contacts',
        args: { limit: 50 },
        titleKeys: ['first_name', 'last_name', 'email'],
        fields: [
          { keys: ['email'] },
          { keys: ['lifecycle_stage'], label: 'stage' },
          { keys: ['lead_score'], label: 'score' },
        ],
        headerActions: [
          { id: 'new', label: '+ Contact', kind: 'tool', tool: 'crm_create_contact', inputs: [
            { key: 'first_name', label: 'First name' },
            { key: 'email', label: 'Email' },
          ] },
        ],
        rowActions: [
          { id: 'logactivity', label: 'Log activity', kind: 'tool', tool: 'crm_create_activity', args: (r) => ({ contact_id: r.id }), inputs: [{ key: 'type', label: 'Type', options: ['call', 'email', 'meeting', 'note'] }, { key: 'subject', label: 'Subject / notes' }] },
          { id: 'dnc', label: 'Mark DNC', kind: 'tool', tool: 'crm_set_dnc', args: (r) => ({ contact_id: r.id }), confirm: 'Mark this contact Do-Not-Contact?', inputs: [{ key: 'reason', label: 'Reason (use their words, e.g. "asked to unsubscribe")' }] },
          open('Open', 'crm'),
        ],
        detail: { tool: 'crm_get_contact', idKeys: ['id', 'contact_id'], idArg: 'contact_id' },
        empty: 'No contacts.',
      },
      {
        id: 'companies',
        label: 'Companies',
        tool: 'crm_list_companies',
        args: { limit: 50 },
        titleKeys: ['name'],
        fields: [{ keys: ['domain', 'website'], label: 'domain' }, { keys: ['industry'] }, { keys: ['city'] }],
        headerActions: [
          { id: 'new', label: '+ Company', kind: 'tool', tool: 'crm_create_company', inputs: [{ key: 'name', label: 'Company name' }, { key: 'domain', label: 'Domain (optional)' }] },
        ],
        rowActions: [open('Open', 'crm')],
        detail: { tool: 'crm_get_company', idKeys: ['id', 'company_id'], idArg: 'company_id' },
        empty: 'No companies.',
      },
      { id: 'pipelines', label: 'Pipelines', tool: 'crm_list_pipelines', titleKeys: ['name'], rowActions: [open('Open', 'crm')], empty: 'No pipelines.' },
      { id: 'sequences', label: 'Sequences', tool: 'crm_list_sequences', titleKeys: ['name'], fields: [{ keys: ['is_active'], label: 'active' }, { keys: ['active_enrollments'], label: 'enrolled' }], rowActions: [open('Open', 'crm')], empty: 'No sequences.' },
      { id: 'activities', label: 'Activity', tool: 'crm_list_activities', args: { limit: 40 }, titleKeys: ['subject', 'type', 'title'], fields: [{ keys: ['created_at'], date: true }], empty: 'No activity.' },
    ],
  },
  {
    id: 'revenue',
    label: 'Quotes & Invoices',
    icon: 'credit-card',
    sections: [
      {
        id: 'estimates',
        label: 'Estimates',
        tool: 'crm_estimate_list',
        titleKeys: ['estimate_number'],
        fields: [{ keys: ['status'] }, { keys: ['total_cents'], label: 'total', money: true, cents: true }, { keys: ['expires_at'], label: 'expires', date: true }],
        rowActions: [
          { id: 'send', label: 'Send', kind: 'tool', tool: 'crm_estimate_send', args: (r) => ({ estimate_id: r.id }), inputs: [{ key: 'channel', label: 'Send via', options: ['email', 'sms', 'both'] }], confirm: 'Send this estimate?' },
          { id: 'accept', label: 'Mark accepted', kind: 'tool', tool: 'crm_estimate_mark_accepted', args: (r) => ({ estimate_id: r.id }), inputs: [{ key: 'signer_name', label: 'Who agreed (name)' }] },
          { id: 'convert', label: 'Convert to invoice', kind: 'tool', tool: 'crm_estimate_convert_to_invoice', args: (r) => ({ estimate_id: r.id }), confirm: 'Convert this estimate to a draft invoice?' },
        ],
        empty: 'No estimates.',
      },
      {
        id: 'envelopes',
        label: 'Contracts (e-sign)',
        tool: 'crm_envelope_list',
        titleKeys: ['title'],
        fields: [{ keys: ['status'] }, { keys: ['subject_type'], label: 'type' }, { keys: ['expires_at'], label: 'expires', date: true }],
        rowActions: [
          { id: 'send', label: 'Send', kind: 'tool', tool: 'crm_envelope_send', args: (r) => ({ envelope_id: r.id }), confirm: 'Send this contract for signature?' },
          { id: 'void', label: 'Void', kind: 'tool', tool: 'crm_envelope_void', args: (r) => ({ envelope_id: r.id }), inputs: [{ key: 'reason', label: 'Void reason' }], confirm: 'Void this envelope?' },
        ],
        empty: 'No contracts.',
      },
      { id: 'esttpl', label: 'Estimate templates', tool: 'crm_estimate_template_list', titleKeys: ['name'], empty: 'No templates.' },
      { id: 'invtpl', label: 'Invoice templates', tool: 'crm_invoice_template_list', titleKeys: ['name'], empty: 'No templates.' },
    ],
  },
  {
    id: 'helpdesk',
    label: 'Helpdesk',
    icon: 'comment-discussion',
    sections: [
      {
        id: 'tickets',
        label: 'Open tickets',
        tool: 'helpdesk_ticket_list',
        args: { status: 'open' },
        transform: helpdeskTicketRows('helpdesk_ticket_list'),
        titleKeys: TICKET_TITLE_KEYS,
        fields: [
          { keys: ['status'] },
          { keys: ['priority'] },
          { keys: ['channel'] },
          { keys: ['last_activity_at'], label: 'activity', date: true },
        ],
        rowActions: [
          { id: 'reply', label: 'Reply', kind: 'tool', tool: 'helpdesk_ticket_send_reply', args: (r) => ({ id: r.id ?? r.ticket_id }), inputs: [{ key: 'body', label: 'Reply message' }] },
          { id: 'status', label: 'Status', kind: 'tool', tool: 'helpdesk_ticket_set_status', args: (r) => ({ id: r.id ?? r.ticket_id }), inputs: [{ key: 'status', label: 'New status', options: ['open', 'pending', 'resolved', 'closed'] }] },
          { id: 'priority', label: 'Priority', kind: 'tool', tool: 'helpdesk_ticket_set_priority', args: (r) => ({ id: r.id ?? r.ticket_id }), inputs: [{ key: 'priority', label: 'Priority', options: ['low', 'normal', 'high', 'urgent'] }] },
          { id: 'claude', label: 'Copy for Claude', kind: 'copy', copyTemplate: ticketCopyPrompt },
          chat('knowledge_base', 'Draft reply'),
        ],
        detail: { tool: 'helpdesk_ticket_get', idKeys: ['id', 'ticket_id'], idArg: 'id' },
        empty: 'No open tickets.',
      },
      {
        id: 'overdue',
        label: 'Overdue',
        tool: 'helpdesk_tickets_overdue',
        transform: helpdeskTicketRows('helpdesk_tickets_overdue'),
        titleKeys: TICKET_TITLE_KEYS,
        fields: [{ keys: ['priority'] }],
        empty: 'Nothing overdue.',
      },
      { id: 'queues', label: 'Queues', tool: 'helpdesk_queues_list', titleKeys: ['name'], empty: 'No queues.' },
      { id: 'macros', label: 'Macros', tool: 'helpdesk_macros_list', titleKeys: ['name', 'title'], empty: 'No macros.' },
      {
        // Read-only: what the website chat assistant can answer from. See assistantKnowledge.ts.
        id: 'assistant',
        label: 'Website assistant knowledge',
        tool: ASSISTANT_KNOWLEDGE_TOOL,
        transform: assistantKnowledgeRows,
        titleKeys: ['title'],
        fields: [
          { keys: ['state'] },
          { keys: ['amount'] },
          { keys: ['last_read_at'], label: 'last read', date: true },
          { keys: ['last_synced_at'], label: 'last synced', date: true },
          { keys: ['next_read_at'], label: 'next read', date: true },
          { keys: ['reason'], label: 'why' },
        ],
        headerActions: [
          open('Open assistant settings', ASSISTANT_SETTINGS_SUB),
          { id: 'claude', label: 'Copy for Claude', kind: 'copy', copyTemplate: () => ASSISTANT_KNOWLEDGE_PROMPT },
        ],
        empty: 'The website assistant knowledge status came back empty.',
      },
    ],
  },
  {
    id: 'pm',
    label: 'Projects & Tasks',
    icon: 'checklist',
    sections: [
      {
        id: 'tasks',
        label: 'Tasks',
        tool: 'pm_tasks_list',
        args: { limit: 80 },
        titleKeys: ['title', 'name'],
        fields: [
          { keys: ['status'] },
          { keys: ['priority'] },
          { keys: ['due_date'], label: 'due', date: true },
        ],
        rowActions: [
          { id: 'done', label: 'Complete', kind: 'tool', tool: 'pm_tasks_complete', args: (r) => ({ id: r.id }) },
          { id: 'comment', label: 'Comment', kind: 'tool', tool: 'pm_tasks_comment', args: (r) => ({ id: r.id }), inputs: [{ key: 'content', label: 'Comment' }] },
          { id: 'claude', label: 'Copy for Claude', kind: 'copy', copyTemplate: (r) => `In Hiveku, work on PM task ${r.id} — "${r.title || r.name || ''}". Load it first with pm_tasks_get({ id: "${r.id}" }), do the work, then update it (pm_tasks_comment / pm_tasks_complete).` },
        ],
        detail: { tool: 'pm_tasks_get', idKeys: ['id'] },
        empty: 'No tasks.',
      },
      { id: 'projects', label: 'Projects', tool: 'pm_projects_list', titleKeys: ['name'], fields: [{ keys: ['status'] }, { keys: ['task_count'], label: 'tasks' }], empty: 'No projects.' },
      { id: 'milestones', label: 'Milestones', tool: 'pm_milestones_list', titleKeys: ['name', 'title'], fields: [{ keys: ['due_date'], date: true }], empty: 'No milestones.' },
    ],
  },
  {
    id: 'workflows',
    label: 'Automations',
    icon: 'zap',
    sections: [
      {
        id: 'workflows',
        label: 'Workflows',
        tool: 'workflow_list',
        titleKeys: ['name'],
        fields: [{ keys: ['is_enabled'], label: 'enabled' }, { keys: ['run_count'], label: 'runs' }, { keys: ['description'] }],
        rowActions: [
          { id: 'run', label: 'Run', kind: 'tool', tool: 'workflow_run', args: (r) => ({ id: r.id }), successReload: false },
          { id: 'enable', label: 'Enable', kind: 'tool', tool: 'workflow_enable', args: (r) => ({ id: r.id }), run: enableWorkflow, done: enableDone },
          { id: 'disable', label: 'Disable', kind: 'tool', tool: 'workflow_disable', args: (r) => ({ id: r.id }) },
        ],
        detail: { tool: 'workflow_get', idKeys: ['id'] },
        empty: 'No workflows.',
      },
      { id: 'runs', label: 'Recent runs', tool: 'workflow_runs_recent', titleKeys: ['workflow_name', 'workflow_id'], fields: [{ keys: ['status'] }, { keys: ['started_at', 'created_at'], date: true }], detail: { tool: 'workflow_run_get', argMap: { workflow_id: ['workflow_id'], run_id: ['id', 'run_id'] } }, empty: 'No recent runs.' },
    ],
  },
  {
    id: 'email',
    label: 'Email Marketing',
    icon: 'mail',
    sections: [
      {
        id: 'campaigns',
        label: 'Campaigns',
        tool: 'email_campaign_list',
        titleKeys: ['name', 'subject'],
        fields: [{ keys: ['status'] }],
        headerActions: [
          { id: 'new', label: '+ Campaign', kind: 'tool', tool: 'email_campaign_create', inputs: [
            { key: 'name', label: 'Campaign name' },
            { key: 'subject', label: 'Subject line' },
            { key: 'from_email', label: 'From email (a verified sender)' },
            { key: 'audience_id', label: 'Audience', optionsTool: { tool: 'email_audience_list', labelKeys: ['name'], valueKeys: ['id'] } },
          ] },
        ],
        rowActions: [
          EMAIL_PREVIEW_RECIPIENTS,
          EMAIL_TEST_SEND,
          EMAIL_SEND_NOW,
          { id: 'pause', label: 'Pause', kind: 'tool', tool: 'email_campaign_pause', args: (r) => ({ id: r.id }), confirm: 'Pause this in-flight send? Queued rows wait until you resume.', successReload: true },
          { id: 'resume', label: 'Resume', kind: 'tool', tool: 'email_campaign_resume', args: (r) => ({ id: r.id }), confirm: 'Resume this paused send? The queued rows are picked up on the next tick; nothing is re-materialized.', successReload: true },
          open('Open'),
        ],
        empty: 'No campaigns.',
      },
      { id: 'audiences', label: 'Audiences', tool: 'email_audience_list', titleKeys: ['name'], fields: [{ keys: ['kind'] }, { keys: ['estimated_size'], label: 'size' }], headerActions: [{ id: 'new', label: '+ Audience', kind: 'tool', tool: 'email_audience_create', inputs: [{ key: 'name', label: 'Audience name' }] }], empty: 'No audiences.' },
      { id: 'sequences', label: 'Sequences', tool: 'email_sequence_list', titleKeys: ['name'], fields: [{ keys: ['is_active'], label: 'active' }, { keys: ['total_enrolled'], label: 'enrolled' }], empty: 'No sequences.' },
      { id: 'templates', label: 'Templates', tool: 'email_template_list', titleKeys: ['name', 'subject'], empty: 'No templates.' },
    ],
  },
  {
    id: 'seo',
    label: 'SEO',
    icon: 'search',
    sections: [
      // Account-level SEO surface. Audits/keywords are per-SEO-project (the tools
      // server-enforce project_id), so they live under each project via the picker
      // below rather than as account-wide tabs that would hard-error.
      { id: 'projects', label: 'SEO projects', tool: 'seo_list_projects', titleKeys: ['name', 'domain', 'website_url'], fields: [{ keys: ['domain', 'website_url'] }], rowActions: [chat('seo')], detail: { tool: 'seo_project_get', idKeys: ['id', 'project_id'], idArg: 'project_id' }, empty: 'No SEO projects.' },
      { id: 'keywords', label: 'Tracked keywords', tool: 'seo_tracked_keywords_list', titleKeys: ['keyword', 'name'], fields: [{ keys: ['position', 'rank'] }],
        headerActions: [
          { id: 'track', label: '+ Track keyword', kind: 'tool', tool: 'seo_track_keyword', inputs: [{ key: 'keyword', label: 'Keyword phrase' }, { key: 'target_domain', label: 'Domain to track (e.g. example.com)' }], successReload: true },
        ],
        empty: 'No tracked keywords (these are per SEO project).' },
    ],
  },
  {
    id: 'ppc',
    label: 'Ads (PPC)',
    icon: 'megaphone',
    sections: [
      { id: 'connections', label: 'Ad accounts', tool: 'ppc_connection_list', titleKeys: ['display_name', 'platform'], fields: [{ keys: ['platform'] }, { keys: ['connection_status'], label: 'status' }, { keys: ['campaign_count'], label: 'campaigns' }],
        rowActions: [
          { id: 'sync', label: 'Sync from platform', kind: 'tool', tool: 'ppc_sync', args: (r) => ({ connection_id: r.id }), confirm: 'Pull campaigns, ad groups, ads and metrics from the ad platform now? (takes up to a minute; ad groups/ads land a moment later)', successReload: true },
          chat('ppc'),
        ],
        empty: 'No ad connections.' },
      { id: 'campaigns', label: 'Campaigns', tool: 'ppc_campaign_list', titleKeys: ['name', 'platform'], fields: [{ keys: ['status'] }, { keys: ['campaign_type'], label: 'type' }, { keys: ['objective'] }],
        rowActions: [
          { id: 'pause', label: 'Pause', kind: 'tool', tool: 'ppc_pause_resource', args: (r) => ({ connection_id: r.connection_id, resource_type: 'campaign', resource_id: r.id }), confirm: 'Pause this campaign? (spend stops until re-enabled)', successReload: true },
          { id: 'enable', label: 'Enable', kind: 'tool', tool: 'ppc_enable_resource', args: (r) => ({ connection_id: r.connection_id, resource_type: 'campaign', resource_id: r.id }), confirm: 'Enable this campaign? (spend resumes)', successReload: true },
          { id: 'budget', label: 'Set budget', kind: 'tool', tool: 'ppc_budget_update', args: (r) => ({ connection_id: r.connection_id, campaign_id: r.id }), inputs: [{ key: 'daily_budget', label: 'New daily budget (account currency, number)' }] },
        ],
        empty: 'Pick an ad account (campaigns are per-connection).' },
    ],
  },
  {
    id: 'social',
    label: 'Social',
    icon: 'broadcast',
    sections: [
      { id: 'accounts', label: 'Accounts', tool: 'social_list_accounts', titleKeys: ['name', 'username', 'platform'], fields: [{ keys: ['platform'] }], rowActions: [chat('social')], empty: 'No social accounts.' },
      {
        id: 'posts',
        label: 'Posts',
        tool: 'social_list_posts',
        titleKeys: SOCIAL_POST_TITLE_KEYS,
        fields: [
          { keys: ['status'] },
          { keys: ['approval_status'], label: 'approval' },
          { keys: ['scheduled_at', 'created_at'], date: true },
        ],
        // The deprecated `platforms` input is gone: the route ignores it and
        // publishes to every configured target account regardless.
        rowActions: [SOCIAL_SEND_TO_APPROVAL, SOCIAL_REJECT],
        empty: 'No posts.',
      },
      { id: 'pillars', label: 'Pillars', tool: 'social_pillar_list', titleKeys: ['name', 'title'], empty: 'No content pillars.' },
      {
        id: 'approvals',
        label: 'Approval queue',
        tool: 'social_list_posts',
        args: { status: 'pending_approval', limit: 100 },
        titleKeys: SOCIAL_POST_TITLE_KEYS,
        fields: [
          { keys: ['approval_status'], label: 'approval' },
          { keys: ['scheduled_at'], label: 'scheduled', date: true },
          { keys: ['created_at'], label: 'created', date: true },
        ],
        // Reject and chat only. Approving is a human act in the dashboard.
        rowActions: [SOCIAL_REJECT, chat('social')],
        empty: `Nothing is waiting for approval. Approving happens in the dashboard (${APPROVALS_PATH}), never from here.`,
      },
      {
        id: 'calendar',
        label: 'Calendar (next 60 days)',
        tool: 'social_calendar_list',
        // Evaluated on every load so the window rolls with the clock. The route
        // caps limit at 100 (and the panel shows at most 100 rows).
        args: () => {
          const from = new Date();
          const to = new Date(from.getTime() + 60 * 24 * 60 * 60 * 1000);
          return { from_date: localDateOnly(from), to_date: localDateOnly(to), limit: 100 };
        },
        titleKeys: ['title'],
        fields: [
          { keys: ['event_type'], label: 'type' },
          { keys: ['start_date'], label: 'start', dateOnly: true },
          { keys: ['status'] },
          { keys: ['linked_post.title'], label: 'post' },
        ],
        rowActions: [chat('social')],
        detail: { tool: 'social_calendar_get', idKeys: ['id'], idArg: 'event_id' },
        empty: 'Nothing on the calendar for the next 60 days. A calendar event is a plan, not a post: nothing here publishes.',
      },
      {
        id: 'comments',
        label: 'Comments needing a reply',
        tool: 'social_comments_list',
        args: { requires_response: 'true', limit: 100 },
        titleKeys: ['content'],
        fields: [
          { keys: ['author_name', 'author_username'], label: 'from' },
          { keys: ['post_version.platform'], label: 'platform' },
          { keys: ['sentiment'] },
          { keys: ['post_version.post.title'], label: 'on' },
          { keys: ['platform_created_at', 'created_at'], date: true },
        ],
        // Chat only: a public reply is outward-facing with no undo, so it stays
        // a confirmed act in department chat or the CLI, never a row button.
        rowActions: [chat('social', 'Draft a reply (chat)')],
        empty: 'No comments are waiting for a reply.',
      },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    icon: 'edit',
    sections: [
      {
        id: 'library',
        label: 'Content',
        tool: 'content_list',
        titleKeys: ['title', 'slug'],
        fields: [{ keys: ['status'] }, { keys: ['content_type'], label: 'type' }, { keys: ['scheduled_publish_at', 'published_at', 'created_at'], label: 'when', date: true }],
        rowActions: [
          { id: 'schedule', label: 'Schedule', kind: 'tool', tool: 'content_schedule', args: (r) => ({ content_id: r.id }), inputs: [{ key: 'action_type', label: 'Action', options: ['publish', 'unpublish'] }, { key: 'scheduled_at', label: 'When (ISO date/time, e.g. 2026-07-01T09:00:00Z)' }] },
          chat('content'),
        ],
        empty: 'No content.',
      },
      { id: 'templates', label: 'Templates', tool: 'marketing_content_templates', titleKeys: ['name', 'title'], empty: 'No templates.' },
    ],
  },
  {
    id: 'creative',
    label: 'Brand & Creative',
    icon: 'paintcan',
    sections: [
      { id: 'brand', label: 'Brand guides', tool: 'brand_guide_list', gate: 'marketing_branding', titleKeys: ['name', 'title'], rowActions: [chat('branding')], empty: 'No brand guides.' },
      { id: 'avatars', label: 'Customer avatars', tool: 'customer_avatar_list', gate: 'marketing_customer_avatar', titleKeys: ['name', 'title'], rowActions: [chat('customer_avatar')], empty: 'No avatars.' },
      { id: 'journeys', label: 'Customer journeys', tool: 'customer_journey_list', gate: 'marketing_customer_journey', titleKeys: ['name', 'title'], rowActions: [chat('customer_journey')], empty: 'No journeys.' },
      { id: 'designs', label: 'Designs', tool: 'design_list', gate: 'marketing_designer', titleKeys: ['title'], fields: [{ keys: ['designType'], label: 'type' }, { keys: ['status'] }, { keys: ['updatedAt'], label: 'updated', date: true }], empty: 'No designs.' },
    ],
  },
  {
    id: 'voice',
    label: 'Communications (Voice)',
    icon: 'call-outgoing',
    sections: [
      { id: 'calls', label: 'Recent calls', tool: 'voice_recent_calls', titleKeys: ['from_e164', 'to_e164', 'call_uuid'], fields: [{ keys: ['direction'] }, { keys: ['to_e164'], label: 'to' }, { keys: ['disposition'] }, { keys: ['started_at'], label: 'started', date: true }], empty: 'No recent calls.' },
      { id: 'numbers', label: 'Numbers', tool: 'voice_numbers_list', titleKeys: ['e164'], fields: [{ keys: ['is_active'], label: 'active' }, { keys: ['provider'] }], empty: 'No numbers.' },
      { id: 'extensions', label: 'Extensions', tool: 'voice_extensions_list', titleKeys: ['extension', 'display_name'], fields: [{ keys: ['display_name'], label: 'name' }, { keys: ['endpoint_type'], label: 'type' }, { keys: ['presence_state'], label: 'presence' }], empty: 'No extensions.' },
      { id: 'ringgroups', label: 'Ring groups', tool: 'voice_ring_groups_list', titleKeys: ['name', 'extension'], fields: [{ keys: ['strategy'] }, { keys: ['member_count'], label: 'members' }], empty: 'No ring groups.' },
      { id: 'ivrs', label: 'IVRs', tool: 'voice_ivrs_list', titleKeys: ['name', 'extension'], fields: [{ keys: ['greeting'] }], empty: 'No IVRs.' },
    ],
  },
  {
    id: 'outbound',
    label: 'Outbound',
    icon: 'megaphone',
    group: 'Marketing',
    gate: 'marketing_outbound',
    sections: [
      { id: 'campaigns', label: 'Campaigns', tool: 'outbound_list_campaigns', titleKeys: ['name', 'title'], fields: [{ keys: ['status'] }, { keys: ['channel'] }, { keys: ['created_at'], label: 'created', date: true }], rowActions: [chat('sales')], empty: 'No outbound campaigns.' },
      { id: 'leads', label: 'Leads', tool: 'outbound_list_leads', titleKeys: ['name', 'email', 'company'], fields: [{ keys: ['status'] }, { keys: ['email'] }], empty: 'No outbound leads.' },
    ],
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: 'calendar',
    sections: [
      { id: 'events', label: 'Events', tool: 'calendar_list_events', titleKeys: ['title', 'summary', 'name'], fields: [{ keys: ['start', 'start_time', 'starts_at'], date: true }], empty: 'No events.' },
    ],
  },
  {
    id: 'collab',
    label: 'Collaboration',
    icon: 'comment',
    sections: [
      { id: 'discussions', label: 'Discussions', tool: 'discussion_list', gate: 'discussions', titleKeys: ['title', 'project_name'], fields: [{ keys: ['status'] }, { keys: ['priority'] }, { keys: ['last_activity_at'], label: 'activity', date: true }], empty: 'No discussions.' },
      { id: 'boards', label: 'Hiveboards', tool: 'hiveboard_list', gate: 'hiveboards', titleKeys: ['name'], fields: [{ keys: ['element_count'], label: 'elements' }, { keys: ['last_edited_at'], label: 'edited', date: true }], rowActions: [open('Open in Hiveku')], empty: 'No boards.' },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: 'plug',
    sections: [
      { id: 'connected', label: 'Connected', tool: 'integration_list', titleKeys: ['provider_name', 'provider_account_identifier'], fields: [{ keys: ['provider_slug'], label: 'provider' }, { keys: ['is_active'], label: 'active' }, { keys: ['last_synced_at'], label: 'synced', date: true }], rowActions: [
        { id: 'test', label: 'Test', kind: 'tool', tool: 'integration_test', args: (r) => ({ id: r.id }), successReload: false },
        { id: 'del', label: 'Delete', kind: 'tool', tool: 'integration_delete', args: (r) => ({ id: r.id }), confirm: 'Delete this integration?' },
      ], empty: 'No integrations.' },
      { id: 'providers', label: 'Available', tool: 'integration_providers_list', titleKeys: ['name', 'provider', 'id'], empty: 'No providers.' },
    ],
  },
  {
    id: 'memory',
    label: 'Memory & Skills',
    icon: 'library',
    sections: [
      { id: 'memory', label: 'Memory', tool: 'memory_list', args: { type: 'memory' }, titleKeys: ['name', 'domain'], fields: [{ keys: ['domain'], label: 'dept' }, { keys: ['updated_at'], label: 'updated', date: true }], rowActions: [{ id: 'del', label: 'Delete', kind: 'tool', tool: 'memory_delete', args: (r) => ({ memory_id: r.id }), confirm: 'Delete this memory entry?' }], empty: 'No memory.' },
      { id: 'skills', label: 'Skills', tool: 'memory_list', args: { type: 'skill' }, titleKeys: ['name', 'domain'], fields: [{ keys: ['domain'], label: 'dept' }, { keys: ['updated_at'], label: 'updated', date: true }], empty: 'No skills.' },
      { id: 'rules', label: 'Rules', tool: 'memory_list', args: { type: 'rule' }, titleKeys: ['name', 'domain'], fields: [{ keys: ['domain'], label: 'dept' }, { keys: ['updated_at'], label: 'updated', date: true }], empty: 'No rules.' },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge Bases',
    icon: 'book',
    sections: [
      { id: 'kbs', label: 'Knowledge bases', tool: 'kb_list', titleKeys: ['name'], fields: [{ keys: ['context_type'], label: 'type' }, { keys: ['updated_at'], label: 'updated', date: true }], rowActions: [chat('knowledge_base')], empty: 'No knowledge bases.' },
    ],
  },
  {
    id: 'mc',
    label: 'Mission Control',
    icon: 'dashboard',
    sections: [
      {
        id: 'tasks', label: 'Tasks', tool: 'mc_tasks_list', titleKeys: ['title'], fields: [{ keys: ['status'] }, { keys: ['priority'] }, { keys: ['assignee'] }],
        rowActions: [{ id: 'transition', label: 'Move', kind: 'tool', tool: 'mc_task_transition', args: (r) => ({ id: r.id }), inputs: [{ key: 'to_status', label: 'Move to', options: ['open', 'in_progress', 'awaiting_human', 'awaiting_agent', 'done', 'archived'] }] }],
        detail: { tool: 'mc_task_get', idKeys: ['id'] },
        empty: 'No tasks.',
      },
      { id: 'lanes', label: 'Lanes', tool: 'mc_lanes_list', titleKeys: ['name'], fields: [{ keys: ['display_order'], label: 'order' }], empty: 'No lanes.' },
      { id: 'sla', label: 'SLA breached', tool: 'mc_sla_breached', titleKeys: ['title'], fields: [{ keys: ['priority'] }, { keys: ['over_by_hours'], label: 'over SLA (h)' }], empty: 'No SLA breaches.' },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting & Finance',
    icon: 'briefcase',
    group: 'Finance',
    gate: 'accounting',
    sections: [
      {
        id: 'bills', label: 'Bills (AP)', tool: 'accounting_bill_list', gate: 'accounting_ap',
        titleKeys: ['bill_number', 'vendor.name', 'vendor_name', 'id'],
        fields: [{ keys: ['vendor.name', 'vendor_name'], label: 'vendor' }, { keys: ['status'] }, { keys: ['total_cents', 'amount_cents'], label: 'total', money: true, cents: true }, { keys: ['due_date'], label: 'due', date: true }],
        rowActions: [
          { id: 'approve', label: 'Approve', kind: 'tool', tool: 'accounting_bill_approve', args: (r) => ({ bill_id: r.id }), confirm: 'Approve this bill? (moves to open, ready to pay)', successReload: true },
          { id: 'recordpay', label: 'Record payment', kind: 'tool', tool: 'accounting_bill_record_payment', args: (r) => ({ bill_id: r.id }), inputs: [{ key: 'amount_cents', label: 'Amount in CENTS (e.g. 12550 = $125.50)' }, { key: 'method', label: 'Method', options: ['check', 'ach', 'wire', 'card', 'cash', 'credit', 'other'] }, { key: 'reference', label: 'Reference (check #, trace) - optional' }], confirm: 'Record this payment in the books? (does NOT move money)', successReload: true },
        ],
        detail: { tool: 'accounting_bill_get', idKeys: ['id', 'bill_id'], idArg: 'bill_id' },
        empty: 'No bills.',
      },
      {
        id: 'invoices', label: 'Invoices (AR)', tool: 'accounting_invoice_list', gate: 'accounting_ar',
        titleKeys: ['invoice_number', 'id'],
        fields: [{ keys: ['status'] }, { keys: ['total_cents'], label: 'total', money: true, cents: true }, { keys: ['due_date'], label: 'due', date: true }],
        empty: 'No invoices.',
      },
      {
        id: 'payroll', label: 'Payroll', tool: 'accounting_payroll_run_list', gate: 'accounting_payroll',
        titleKeys: ['period', 'pay_period', 'id'], fields: [{ keys: ['status'] }, { keys: ['pay_date', 'created_at'], label: 'date', date: true }],
        empty: 'No payroll runs.',
      },
      { id: 'vendors', label: 'Vendors', tool: 'accounting_vendor_list', titleKeys: ['name'], fields: [{ keys: ['email'] }], empty: 'No vendors.' },
      { id: 'members', label: 'Members', tool: 'accounting_member_list', titleKeys: ['name', 'email'], fields: [{ keys: ['email'] }], empty: 'No members.' },
      { id: 'apaging', label: 'AP aging', tool: 'accounting_ap_aging', gate: 'accounting_reports', titleKeys: ['bucket', 'vendor_name', 'label'], fields: [{ keys: ['total_cents', 'amount_cents'], money: true, cents: true }], empty: 'No AP aging.' },
      { id: 'araging', label: 'AR aging', tool: 'accounting_ar_aging', gate: 'accounting_reports', titleKeys: ['bucket', 'label'], fields: [{ keys: ['total_cents', 'amount_cents'], money: true, cents: true }], empty: 'No AR aging.' },
    ],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    icon: 'package',
    group: 'Commerce',
    gate: 'commerce',
    sections: [
      { id: 'products', label: 'Products', tool: 'shopify_catalog_list', titleKeys: ['title', 'name'], fields: [{ keys: ['status'] }, { keys: ['price', 'price_cents'], label: 'price', money: true }], empty: 'No products / Shopify not connected.' },
      { id: 'estimates', label: 'Estimates', tool: 'crm_estimate_list', titleKeys: ['estimate_number'], fields: [{ keys: ['status'] }, { keys: ['total_cents'], label: 'total', money: true, cents: true }], rowActions: [{ id: 'send', label: 'Send', kind: 'tool', tool: 'crm_estimate_send', args: (r) => ({ estimate_id: r.id }), inputs: [{ key: 'channel', label: 'Send via', options: ['email', 'sms', 'both'] }], confirm: 'Send this estimate?' }], empty: 'No estimates.' },
      { id: 'contracts', label: 'Contracts (e-sign)', tool: 'crm_envelope_list', titleKeys: ['title'], fields: [{ keys: ['status'] }, { keys: ['subject_type'], label: 'type' }], empty: 'No contracts.' },
      { id: 'shopify', label: 'Shopify status', tool: 'shopify_status', titleKeys: ['shop', 'domain', 'status'], fields: [{ keys: ['connection_status', 'status'] }], empty: 'Shopify not connected.' },
    ],
  },
];

export function moduleById(id: string): ModuleSpec | undefined {
  return MODULES.find((m) => m.id === id);
}

/** Department grouping + pageAccess gate per module, for the Operate menu. */
export const MODULE_META: Record<string, { group: string; gate?: string }> = {
  crm: { group: 'CRM', gate: 'crm' },
  calendar: { group: 'CRM', gate: 'crm' },
  revenue: { group: 'Commerce', gate: 'commerce' },
  commerce: { group: 'Commerce', gate: 'commerce' },
  helpdesk: { group: 'Support', gate: 'helpdesk' },
  pm: { group: 'Projects', gate: 'pm_projects' },
  workflows: { group: 'Automation', gate: 'workflows' },
  email: { group: 'Marketing', gate: 'marketing_email' },
  seo: { group: 'Marketing', gate: 'marketing_seo' },
  ppc: { group: 'Marketing', gate: 'marketing_ppc' },
  social: { group: 'Marketing', gate: 'marketing_social' },
  content: { group: 'Marketing', gate: 'marketing_content' },
  // Multi-feature module — gate by the umbrella; each section self-gates by its own key.
  creative: { group: 'Marketing', gate: 'marketing' },
  voice: { group: 'Communications', gate: 'communications' },
  accounting: { group: 'Finance', gate: 'accounting' },
  // No module gate — discussions and hiveboards are entitled independently;
  // gating the whole module by one would hide the other. Sections self-gate below.
  collab: { group: 'Collaboration' },
  mc: { group: 'Mission Control', gate: 'orchestrator' },
  integrations: { group: 'Settings' },
  memory: { group: 'Knowledge' },
  knowledge: { group: 'Knowledge' },
};

/** Resolve a module's group + gate (inline spec wins, else the meta map). */
export function moduleGroupGate(m: ModuleSpec): { group: string; gate?: string } {
  const meta = MODULE_META[m.id];
  return { group: m.group ?? meta?.group ?? 'Other', gate: m.gate ?? meta?.gate };
}

// ============================================================
// Form capture is PER SITE: which forms Hiveku records automatically (the
// built-in capture script, the analytics embed and its replay) and turns into
// a CRM contact, a lead notification and possibly an ad conversion. On a web
// app that made sign-ins, admin screens and end-user data entry into "leads".
//
// Rows are the forms marketing_form_capture_list has seen, with whether each
// is captured now and why. Always capture / Never capture / Default set the
// form's own rule (a form_rules merge; "remove" deletes it). The header works
// on the site: the switch, the site type (mode "all" = Marketing site,
// "allowlist" = Web app) and path rules. Each of those is PREVIEWED first
// (marketing_form_capture_preview saves nothing) and the confirmation lists
// the forms it would move, so a real lead form is never excluded unseen.
//
// Erase excluded... is PERMANENT: a dry run shows one batch in a modal, and
// only "Erase permanently" sends the erase, bound to that review by its
// confirm_token. Until erasing through agent keys is switched on, the server
// refuses it (403 agent_execute_disabled) and the panel sends the operator to
// the dashboard. One batch per click: when more remain it says so, and the
// operator runs it again, so nothing loops unseen.
// ============================================================

const CAPTURE_UPDATE_TOOL = 'marketing_form_capture_settings_update';
/** The list's window, pinned in the section args so the field label is true. */
const CAPTURE_WINDOW_DAYS = 90;
const MAX_LISTED_FORMS = 10;
const ERASE_LABEL = 'Erase excluded...';
const CAPTURE_DASHBOARD_PATH = 'Analytics > Forms > Capture';
/** The project's Analytics tab, Forms view, which holds Capture. */
const captureDashboardSub = (projectId: string): string => `${projectId}/analytics?tab=analytics&view=forms`;

// Pick-list labels. The engine passes the chosen label through as the value,
// so each run maps it back, and anything else stops the action.
const CAPTURE_ON = 'Capture on';
const CAPTURE_OFF = 'Capture off';
const SITE_MARKETING = 'Marketing site: capture every form except the ones excluded';
const SITE_WEB_APP = 'Web app: capture only the forms you include';
const PATH_EXCLUDE = 'Exclude: do not capture forms on these pages';
const PATH_INCLUDE = 'Include: capture forms on these pages';
const PATH_REMOVE = 'Remove the rule for this path';

type CaptureRun = NonNullable<ActionSpec['run']>;
type CaptureOutcome = { result: unknown } | null;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
/** A tool answer's `data`, or the answer itself when it is not wrapped. */
const dataOf = (result: unknown): Record<string, unknown> => {
  const top = asRecord(result);
  return 'data' in top ? asRecord(top.data) : top;
};
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const CAPTURE_STATUS_TEXT: Record<string, string> = { captured: 'captured', not_captured: 'not captured', mixed: 'partly captured' };
const statusText = (value: unknown): string => CAPTURE_STATUS_TEXT[asString(value)] ?? (asString(value) || 'unknown');
const formLabel = (form: Record<string, unknown>): string => asString(form.name) || asString(form.form_key) || '(unnamed form)';

/** marketing_form_capture_list answers { settings, forms, totals, ... } under data; one row per form. */
function captureFormRows(raw: unknown): Array<Record<string, unknown>> {
  const forms = dataOf(raw).forms;
  // Zero rows from a shape we cannot read would render as a quiet site.
  if (!Array.isArray(forms)) {
    throw new Error('Could not read the form list from marketing_form_capture_list. This is a display fault, not a site with no forms.');
  }
  return forms
    .filter((form) => !!form && typeof form === 'object' && !Array.isArray(form))
    .map(asRecord)
    .map((form) => {
      const reason = asString(form.reason_text);
      const skipped = asFiniteNumber(form.skipped_30d) ?? 0;
      const erasable = asFiniteNumber(form.recorded_now_excluded) ?? 0;
      return {
        ...form,
        capture: form.status === 'mixed' ? `Partly captured; latest: ${reason || 'unknown'}` : reason || statusText(form.status),
        rule_label: form.rule === 'include' ? 'Always capture' : form.rule === 'exclude' ? 'Never capture' : '',
        skipped: skipped > 0 ? skipped : undefined,
        erasable: erasable > 0 ? erasable : undefined,
      };
    });
}

/** What a saved change did, from the update's answer: the forms it moved and the conversions held back. */
function captureSavedNote(result: unknown): string {
  const data = dataOf(result);
  const impact = asRecord(data.impact);
  const forms = Array.isArray(impact.by_form) ? impact.by_form.map(asRecord) : [];
  const parts = ['Saved.'];
  if (forms.length) {
    const named = forms.slice(0, 3).map((f) => `${formLabel(f)} (now ${statusText(f.after)})`).join(', ');
    parts.push(`${plural(forms.length, 'form')} changed: ${named}${forms.length > 3 ? ` and ${forms.length - 3} more` : ''}.`);
  } else if (Array.isArray(impact.by_form)) {
    // Only a reported empty list means nothing moved; a missing one says nothing.
    parts.push(`No form with recorded submissions in the last ${asFiniteNumber(impact.window_days) ?? CAPTURE_WINDOW_DAYS} days changed.`);
  }
  const held = asFiniteNumber(data.conversions_held) ?? 0;
  if (held > 0) parts.push(`${plural(held, 'queued ad conversion')} held back.`);
  if ((asFiniteNumber(impact.newly_excluded) ?? 0) > 0) {
    parts.push(`Submissions already recorded from newly excluded forms stay until you run ${ERASE_LABEL}`);
  }
  return parts.join(' ');
}

/** The forms a candidate policy would move, from a preview's `impact` (it lists only forms whose status changes). */
function captureImpactText(rawImpact: unknown): string {
  const impact = asRecord(rawImpact);
  // Never turn a preview we cannot read into "nothing would change".
  if (!Array.isArray(impact.by_form)) return 'The preview did not say which forms this changes.';
  const days = asFiniteNumber(impact.window_days) ?? CAPTURE_WINDOW_DAYS;
  const forms = impact.by_form.map(asRecord);
  const capped = impact.truncated === true
    ? '\n(This site has more distinct forms than one check covers, so these counts may be low.)'
    : '';
  if (!forms.length) return `No form with recorded submissions in the last ${days} days would change.${capped}`;
  const lines = forms
    .slice(0, MAX_LISTED_FORMS)
    .map((f) => `- ${formLabel(f)}: ${statusText(f.before)} -> ${statusText(f.after)} (${plural(asFiniteNumber(f.submissions) ?? 0, 'submission')})`);
  if (forms.length > MAX_LISTED_FORMS) lines.push(`- and ${forms.length - MAX_LISTED_FORMS} more`);
  const stop = asFiniteNumber(impact.newly_excluded) ?? 0;
  const start = asFiniteNumber(impact.newly_included) ?? 0;
  const head = `Of the last ${days} days of recorded submissions, ${stop} would no longer be captured and ${start} would start being captured:`;
  return [head, ...lines].join('\n') + capped;
}

/** Run a capture flow; a 4xx (nothing changed) shows the route's own sentence instead of raw JSON. */
async function captureRefusalsAsWarnings(ui: ActionUi, heading: string, flow: () => Promise<CaptureOutcome>): Promise<CaptureOutcome> {
  try {
    return await flow();
  } catch (err) {
    const refusal = formCaptureRefusal(err);
    if (!refusal) throw err;
    await ui.warn(heading, refusal.message);
    return null;
  }
}

/** Refuse a form-rule click that would change nothing. */
function captureRuleGuard(row: Record<string, unknown>, action: FormCaptureRuleAction): string | null {
  if (!asString(row.form_key)) return 'This form has no key, so it cannot have a rule of its own.';
  const rule = asString(row.rule);
  if (action === 'include' && rule === 'include') return 'This form is already set to Always capture.';
  if (action === 'exclude' && rule === 'exclude') return 'This form is already set to Never capture.';
  if (action === 'remove' && !rule) return "This form has no rule of its own: it already follows the site's capture settings.";
  return null;
}

/** Always capture / Never capture / Default: the form's own rule, merged into form_rules. */
function captureFormRule(id: string, label: string, action: FormCaptureRuleAction, confirm?: string): ActionSpec {
  return {
    id,
    label,
    kind: 'tool',
    tool: CAPTURE_UPDATE_TOOL,
    args: (r) => ({ form_rules: { [asString(r.form_key)]: action } }),
    guard: (r) => captureRuleGuard(r, action),
    ...(confirm ? { confirm } : {}),
    run: (client, args, ui) =>
      captureRefusalsAsWarnings(ui, 'Not saved.', async () => ({
        result: await ui.progress(`${label}…`, () =>
          formCaptureSettingsUpdate(client, asString(args.project_id), {
            form_rules: args.form_rules as Record<string, FormCaptureRuleAction>,
          }),
        ),
      })),
    done: captureSavedNote,
    successReload: true,
  };
}

interface CaptureChange {
  patch: FormCapturePatch;
  preview: FormCapturePreviewChange;
  question: (site: string) => string;
  explain: string;
  button: string;
}

/** Preview a site change, confirm it with the forms it would move, then save it. */
async function previewConfirmSave(
  client: HivekuMcpClient,
  projectId: string,
  ui: ActionUi,
  change: CaptureChange,
): Promise<CaptureOutcome> {
  const preview = await ui.progress('Checking which forms this changes…', () => formCapturePreview(client, projectId, change.preview));
  const site = asString(asRecord(preview.candidate).project_name) || 'this site';
  const ok = await ui.confirm(change.question(site), `${change.explain}\n\n${captureImpactText(preview.impact)}`, change.button);
  if (!ok) return null;
  return { result: await ui.progress('Saving…', () => formCaptureSettingsUpdate(client, projectId, change.patch)) };
}

const captureSwitch: CaptureRun = (client, args, ui) =>
  captureRefusalsAsWarnings(ui, 'Not saved.', async () => {
    const choice = asString(args.capture);
    if (choice !== CAPTURE_ON && choice !== CAPTURE_OFF) return null;
    const enabled = choice === CAPTURE_ON;
    return previewConfirmSave(client, asString(args.project_id), ui, {
      patch: { enabled },
      preview: { enabled },
      question: (site) => `Turn automatic form capture ${enabled ? 'on' : 'off'} for ${site}?`,
      explain: enabled
        ? 'Forms on this site are captured again, following the site type, the sign-in default and the path and form rules. Each captured submission creates a contact, a lead notification and possibly an ad conversion.'
        : 'No form on this site is captured automatically, whatever the other rules say: new submissions stop creating contacts, lead notifications and ad conversions. Hosted Hiveku forms and wired webhooks are not affected. Submissions already recorded stay until erased.',
      button: enabled ? 'Turn capture on' : 'Turn capture off',
    });
  });

const captureSiteType: CaptureRun = (client, args, ui) =>
  captureRefusalsAsWarnings(ui, 'Not saved.', async () => {
    const choice = asString(args.site_type);
    if (choice !== SITE_MARKETING && choice !== SITE_WEB_APP) return null;
    const webApp = choice === SITE_WEB_APP;
    const mode = webApp ? 'allowlist' : 'all';
    return previewConfirmSave(client, asString(args.project_id), ui, {
      patch: { mode },
      preview: { mode },
      question: (site) => `Treat ${site} as a ${webApp ? 'Web app' : 'Marketing site'}?`,
      explain: webApp
        ? 'Only forms something includes are captured: a form set to Always capture, an included path, or data-hiveku-capture="on" in the site code. Sign-ins, admin screens and end-user data entry stop becoming leads. If a real lead form is in the list below, set it to Always capture first.'
        : 'Every form is captured except the ones a rule excludes, and credential-only sign-in forms while the sign-in default is on.',
      button: webApp ? 'Make it a Web app' : 'Make it a Marketing site',
    });
  });

/** A path rule's key as the server stores it (parseGlob): trimmed, lower case, no doubled or trailing slash. */
const pathRuleKey = (value: string): string => {
  const glob = value.trim().toLowerCase().replace(/\/{2,}/g, '/');
  return glob.length > 1 ? glob.replace(/\/+$/, '') : glob;
};

/** Removing has no preview (the what-if only adds rules), so it reads the rules and confirms the one it removes. */
async function removePathRule(client: HivekuMcpClient, projectId: string, typed: string, ui: ActionUi): Promise<CaptureOutcome> {
  const settings = await ui.progress('Reading the path rules…', () => formCaptureSettingsGet(client, projectId));
  const site = asString(settings.project_name) || 'this site';
  const rules = (Array.isArray(settings.path_rules) ? settings.path_rules : []).map(asRecord);
  const rule = rules.find((r) => pathRuleKey(asString(r.path)) === pathRuleKey(typed));
  if (!rule) {
    const current = rules.map((r) => `${asString(r.path)} (${asString(r.action)})`).join(', ');
    await ui.inform(`${site} has no path rule for ${typed}. ${current ? `Its path rules: ${current}.` : 'It has no path rules.'}`);
    return null;
  }
  const path = asString(rule.path);
  const ok = await ui.confirm(
    `Remove the path rule ${path} (${asString(rule.action)}) from ${site}?`,
    'Forms on matching pages go back to the other rules: their own form rules, the sign-in default, other path rules and the site type.',
    'Remove rule',
  );
  if (!ok) return null;
  return { result: await ui.progress('Saving…', () => formCaptureSettingsUpdate(client, projectId, { path_rules: { [path]: 'remove' } })) };
}

const capturePathRule: CaptureRun = (client, args, ui) =>
  captureRefusalsAsWarnings(ui, 'Not saved.', async () => {
    const projectId = asString(args.project_id);
    const path = asString(args.path).trim();
    const choice = asString(args.rule);
    if (!path) {
      await ui.inform('No path given. A path rule names the pages it covers, starting with /: for example /login or /portal/*.');
      return null;
    }
    // The what-if takes comma-separated lists, so a comma would preview two rules and save one.
    if (path.includes(',')) {
      await ui.inform('One path per rule: leave out commas.');
      return null;
    }
    if (choice === PATH_REMOVE) return removePathRule(client, projectId, path, ui);
    if (choice !== PATH_EXCLUDE && choice !== PATH_INCLUDE) return null;
    const exclude = choice === PATH_EXCLUDE;
    return previewConfirmSave(client, projectId, ui, {
      patch: { path_rules: { [path]: exclude ? 'exclude' : 'include' } },
      preview: exclude ? { exclude_paths: path } : { include_paths: path },
      question: (site) => (exclude ? `Stop capturing forms on ${path} for ${site}?` : `Capture forms on ${path} for ${site}?`),
      explain: exclude
        ? 'Forms on matching pages stop creating contacts, lead notifications and ad conversions, unless something more specific says otherwise (the form\'s own rule, or data-hiveku-capture="on" in the site code). Check the list below: no real lead form should be in it.'
        : "Forms on matching pages are captured, even on a Web app site, unless something more specific says otherwise (the form's own rule, its markup, the sign-in default, or a more specific excluded path).",
      button: exclude ? 'Exclude path' : 'Include path',
    });
  });

/** The erase review: what one batch removes, what it keeps, and what it cannot reach. */
function purgeReviewText(plan: FormCapturePurgePlan): string {
  const b = plan.batch;
  const lines = [
    "These are submissions Hiveku captured automatically that the site's capture rules now exclude. There is no undo.",
    '',
    'By form:',
    ...b.by_form
      .slice(0, MAX_LISTED_FORMS)
      .map((f) => `- ${f.name || f.form_key || '(unnamed form)'}: ${plural(f.submissions, 'submission')}${f.reason_text ? ` (${f.reason_text})` : ''}`),
  ];
  if (b.by_form.length > MAX_LISTED_FORMS) lines.push(`- and ${b.by_form.length - MAX_LISTED_FORMS} more forms`);
  const keptWhy = Object.entries(b.contacts_kept_by_reason)
    .map(([why, n]) => `${why.replace(/_/g, ' ')}: ${n}`)
    .join(', ');
  lines.push(
    '',
    `Contacts: ${b.contacts_erasable} erased (they exist only because of these submissions)` +
      (b.contacts_kept ? `, ${b.contacts_kept} kept because they have other history${keptWhy ? ` (${keptWhy})` : ''}` : '') +
      '.',
  );
  const also: string[] = [];
  if (b.offline_conversions.pending) also.push(`${plural(b.offline_conversions.pending, 'queued ad conversion')} removed before upload`);
  const uploaded = Object.entries(b.offline_conversions.already_uploaded).map(([platform, n]) => `${n} on ${platform}`);
  if (uploaded.length) also.push(`conversions already uploaded stay on the ad platform (${uploaded.join(', ')})`);
  if (b.workflow_runs_to_redact) also.push(`${plural(b.workflow_runs_to_redact, 'automation run')} cleared of these submissions`);
  if (b.mixed_groups_left_alone) {
    also.push(`${plural(b.mixed_groups_left_alone, 'submission')} that also came in through a hosted form or a webhook left alone`);
  }
  if (also.length) lines.push(`Also: ${also.join('; ')}.`);
  if (plan.cannot_undo.length) lines.push('', 'Not undone by this erase:', ...plan.cannot_undo.map((line) => `- ${line}`));
  if (plan.more_available) {
    lines.push(
      '',
      `This is one batch: ${b.submissions} of the ${plan.total_excluded_submissions} excluded submissions. Afterwards, run ${ERASE_LABEL} again to review the next batch.`,
    );
  }
  return lines.join('\n');
}

/** The erase's completion message, from its execute answer. */
function purgeDoneNote(result: unknown): string {
  const data = dataOf(result);
  if (data.erased === null) return 'Nothing was left to erase: it may have been erased from the dashboard since the review.';
  if (!data.erased || typeof data.erased !== 'object') {
    return `The erase ran, but its answer did not say how much it erased. Run ${ERASE_LABEL} again: its review counts what is left.`;
  }
  const erased = asRecord(data.erased);
  const kept = asFiniteNumber(data.contacts_kept) ?? 0;
  const parts = [
    `Erased ${plural(asFiniteNumber(erased.submissions) ?? 0, 'submission')} and ${plural(asFiniteNumber(erased.contacts) ?? 0, 'contact')}` +
      (kept ? `; ${plural(kept, 'contact')} kept because they have other history.` : '.'),
  ];
  if (data.more_available === true) parts.push(`More excluded submissions remain: run ${ERASE_LABEL} again to review the next batch.`);
  return parts.join(' ');
}

/** Erase excluded...: dry run, a modal review, then one confirmed batch. */
const eraseExcludedSubmissions: CaptureRun = async (client, args, ui) => {
  const projectId = asString(args.project_id);
  let plan: FormCapturePurgePlan;
  let site = 'this site';
  try {
    const [dryRun, settings] = await ui.progress('Reviewing what would be erased…', () =>
      Promise.all([
        formCapturePurgeDryRun(client, projectId),
        // Only for the site's name in the modal; the review does not depend on it.
        formCaptureSettingsGet(client, projectId).catch((): Record<string, unknown> => ({})),
      ]),
    );
    plan = dryRun;
    site = asString(settings.project_name) || site;
  } catch (err) {
    const refusal = formCaptureRefusal(err);
    if (!refusal) throw err;
    await ui.warn('Could not review the erase. Nothing was erased.', refusal.message);
    return null;
  }
  const token = plan.confirm_token;
  if (!token || plan.batch.submissions === 0) {
    await ui.inform(
      `Nothing to erase on ${site}: its capture rules exclude no recorded submission. Exclude forms first (Never capture, a path rule, Web app, or capture off), then erase.`,
    );
    return null;
  }
  const erase = await ui.confirm(
    `Permanently erase ${plural(plan.batch.submissions, 'captured submission')} from ${site}?`,
    purgeReviewText(plan),
    'Erase permanently',
  );
  if (!erase) return null;
  let outcome: FormCapturePurgeOutcome;
  try {
    outcome = await ui.progress('Erasing…', () => formCapturePurge(client, projectId, token));
  } catch (err) {
    // Sent once and never re-sent: after a 5xx or a dropped connection it may or may not have run.
    await ui.warn(
      'The erase did not answer cleanly, so it may or may not have run.',
      `${err instanceof Error ? err.message : String(err)}\n\nIt is never sent twice. Run ${ERASE_LABEL} again: its review counts what is still there.`,
    );
    return null;
  }
  if (outcome.executed) return { result: outcome.result };
  const { refusal } = outcome;
  if (refusal.code === 'agent_execute_disabled') {
    const open = await ui.inform(
      `Nothing was erased. Erasing from VS Code is not switched on yet: erase from the Hiveku dashboard instead (${CAPTURE_DASHBOARD_PATH} > Erase).`,
      'Open dashboard',
    );
    if (open) await ui.openDashboard(captureDashboardSub(projectId));
    return null;
  }
  if (refusal.code === 'stale_plan') {
    await ui.warn(
      'Nothing was erased: the set changed since the review.',
      `New submissions arrived, a capture rule changed, or some were erased elsewhere after the review. Run ${ERASE_LABEL} again to review the current set.`,
    );
    return null;
  }
  if (refusal.code === 'expired') {
    await ui.warn('Nothing was erased: the review expired.', `A review is good for 15 minutes. Run ${ERASE_LABEL} again.`);
    return null;
  }
  await ui.warn('Nothing was erased.', refusal.message);
  return null;
};

/**
 * Project-scoped module — every section's tool gets { project_id } merged in by
 * the engine (opened with a project context). Covers the dev/infra surface
 * beyond files + VCS.
 */
export const PROJECT_MODULE: ModuleSpec = {
  id: 'project',
  label: 'Project',
  icon: 'server-environment',
  sections: [
    {
      id: 'deploys', label: 'Deploys', tool: 'deploy_history', titleKeys: ['environment', 'status'], fields: [{ keys: ['status'] }, { keys: ['triggered_by'], label: 'by' }, { keys: ['completed_at', 'created_at'], label: 'when', date: true }],
      headerActions: [{ id: 'deploy', label: 'Deploy', kind: 'tool', tool: 'deploy_site', inputs: [{ key: 'environment', label: 'Environment', options: ['development', 'staging', 'production'] }], confirm: 'Start a deploy?' }],
      empty: 'No deploys.',
    },
    { id: 'checkpoints', label: 'Checkpoints', tool: 'project_checkpoint_list', titleKeys: ['message', 'checkpoint_hash'], fields: [{ keys: ['trigger'] }, { keys: ['created_at'], label: 'when', date: true }], empty: 'No checkpoints.' },
    { id: 'tables', label: 'Database', tool: 'database_tables', titleKeys: ['table_name', 'name'], empty: 'No tables / not provisioned.' },
    {
      id: 'pages', label: 'Pages', tool: 'pages_list', titleKeys: ['name', 'slug'], fields: [{ keys: ['slug'] }, { keys: ['page_type'], label: 'type' }, { keys: ['is_published'], label: 'published' }],
      headerActions: [{ id: 'new', label: '+ Page', kind: 'tool', tool: 'pages_create', inputs: [{ key: 'name', label: 'Page title' }, { key: 'slug', label: 'Slug (e.g. about — no leading slash)' }, { key: 'page_type', label: 'Type', options: ['page', 'blog_post', 'landing_page', 'contact', 'about', 'privacy', 'terms', 'custom'] }] }],
      empty: 'No pages.',
    },
    {
      // Collection creation needs a full field schema (id/path/format/fields…), so it
      // is not a one-input quick action — create via Claude/chat, list/inspect here.
      id: 'cms', label: 'CMS collections', tool: 'cms_list_collections', titleKeys: ['name', 'id'], fields: [{ keys: ['path'] }, { keys: ['format'] }, { keys: ['field_count'], label: 'fields' }],
      empty: 'No collections.',
    },
    { id: 'crons', label: 'Crons', tool: 'project_crons_list', titleKeys: ['function_path', 'function_name'], fields: [{ keys: ['schedule_expression'], label: 'schedule' }, { keys: ['environment'] }, { keys: ['enabled'] }], empty: 'No crons.' },
    { id: 'domains', label: 'Domains', tool: 'project_domains_list', titleKeys: ['domain'], fields: [{ keys: ['tier'] }, { keys: ['domain_status'], label: 'status' }, { keys: ['ssl_status'], label: 'ssl' }], empty: 'No domains.' },
    { id: 'redirects', label: 'Redirects', tool: 'project_redirects_list', titleKeys: ['from_path'], fields: [{ keys: ['to_path'], label: '→' }, { keys: ['status_code'], label: 'code' }, { keys: ['is_active'], label: 'active' }], empty: 'No redirects.' },
    {
      id: 'secrets', label: 'Secrets', tool: 'project_secrets_list', titleKeys: ['key'],
      fields: [{ keys: ['preview'], label: 'value' }],
      // project_secrets_list returns { secrets: { KEY: value } } (an object map),
      // not a row array — flatten it to masked rows.
      transform: (raw) => {
        const d = raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>) ? (raw as { data: unknown }).data : raw;
        const secrets = (d && typeof d === 'object' ? (d as Record<string, unknown>).secrets : null) as Record<string, unknown> | null;
        if (!secrets || typeof secrets !== 'object') return [];
        return Object.keys(secrets).sort().map((key) => ({ key, preview: maskSecret(String(secrets[key] ?? '')) }));
      },
      empty: 'No secrets.',
    },
    { id: 'apages', label: 'Top pages', tool: 'analytics_pages', titleKeys: ['page_path'], fields: [{ keys: ['views'], label: 'views' }, { keys: ['entries'], label: 'entries' }], empty: 'No analytics yet.' },
    { id: 'asources', label: 'Traffic sources', tool: 'analytics_traffic_sources', titleKeys: ['source_type', 'source', 'medium', 'campaign'], fields: [{ keys: ['total_sessions'], label: 'sessions' }, { keys: ['total_users'], label: 'users' }], empty: 'No analytics yet.' },
    {
      // See "Form capture is PER SITE" above. Header changes are previewed in
      // their own confirmation (after the pick), so none carries a static confirm.
      id: 'formcapture',
      label: 'Form capture',
      tool: 'marketing_form_capture_list',
      args: { days: CAPTURE_WINDOW_DAYS },
      transform: captureFormRows,
      titleKeys: ['name', 'form_key'],
      fields: [
        { keys: ['page_path'], label: 'page' },
        { keys: ['capture'] },
        { keys: ['submissions'], label: `submissions (${CAPTURE_WINDOW_DAYS}d)` },
        { keys: ['skipped'], label: 'skipped (30d)' },
        { keys: ['rule_label'], label: 'rule' },
        { keys: ['erasable'], label: 'recorded, now excluded' },
      ],
      rowActions: [
        captureFormRule('always', 'Always capture', 'include'),
        captureFormRule(
          'never',
          'Never capture',
          'exclude',
          'Stop capturing this form? New submissions from it will not create contacts, notifications or conversions.',
        ),
        captureFormRule('default', 'Default', 'remove'),
      ],
      headerActions: [
        {
          id: 'capture',
          label: 'Capture on/off',
          kind: 'tool',
          tool: CAPTURE_UPDATE_TOOL,
          inputs: [{ key: 'capture', label: 'Automatic form capture for this site', options: [CAPTURE_ON, CAPTURE_OFF] }],
          run: captureSwitch,
          done: captureSavedNote,
          successReload: true,
        },
        {
          id: 'sitetype',
          label: 'Site type',
          kind: 'tool',
          tool: CAPTURE_UPDATE_TOOL,
          inputs: [{ key: 'site_type', label: 'What kind of site is this?', options: [SITE_MARKETING, SITE_WEB_APP] }],
          run: captureSiteType,
          done: captureSavedNote,
          successReload: true,
        },
        {
          id: 'pathrule',
          label: '+ Path rule',
          kind: 'tool',
          tool: CAPTURE_UPDATE_TOOL,
          inputs: [
            { key: 'path', label: 'Pages, starting with /: /login is that page only, /portal/* is /portal and everything below it, a * inside the path is one segment' },
            { key: 'rule', label: 'Forms on those pages', options: [PATH_EXCLUDE, PATH_INCLUDE, PATH_REMOVE] },
          ],
          run: capturePathRule,
          done: captureSavedNote,
          successReload: true,
        },
        {
          id: 'erase',
          label: ERASE_LABEL,
          kind: 'tool',
          tool: 'marketing_form_capture_purge',
          run: eraseExcludedSubmissions,
          done: purgeDoneNote,
          successReload: true,
        },
      ],
      empty: `No form on this site was captured automatically in the last ${CAPTURE_WINDOW_DAYS} days. The switch, the site type and path rules still apply to new submissions.`,
    },
    { id: 'sbusers', label: 'Auth users', tool: 'supabase_auth_users_list', titleKeys: ['email', 'id'], fields: [{ keys: ['created_at'], date: true }], empty: 'No users / no DB.' },
    { id: 'sbstorage', label: 'Storage buckets', tool: 'supabase_storage_list', titleKeys: ['name', 'id'], empty: 'No buckets.' },
    { id: 'sbfns', label: 'Edge functions', tool: 'supabase_edge_functions_list', titleKeys: ['name', 'slug'], empty: 'No functions.' },
    { id: 'sbmig', label: 'Migrations', tool: 'supabase_migrations_list', titleKeys: ['name', 'version'], fields: [{ keys: ['created_at'], date: true }], empty: 'No migrations.' },
  ],
};
