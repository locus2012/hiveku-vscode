/**
 * Module registry — each entry declares how to operate one Hiveku area from the
 * generic panel engine (panel.ts). Sections list rows from an MCP tool; actions
 * call tools (with optional input prompts / confirms), deep-link, or open chat.
 *
 * Field/tool names are best-effort from the capability audit; the engine
 * tolerates missing fields and a section that errors just shows "unavailable",
 * so this is safe to ship broad and tighten against a live account.
 */

import type { ModuleSpec } from './panel';
import { maskSecret } from './hivekuApi';

const open = (label = 'Open in Hiveku', sub?: string) =>
  ({ id: 'open', label, kind: 'open' as const, ...(sub ? { sub } : {}) });
const chat = (department: string, label = 'Ask agent') =>
  ({ id: 'chat', label, kind: 'chat' as const, department });

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
        titleKeys: ['subject', 'title'],
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
          { id: 'claude', label: 'Copy for Claude', kind: 'copy', copyTemplate: (r) => `In Hiveku, handle helpdesk ticket ${r.id ?? r.ticket_id} — "${r.subject || r.title || ''}". Load it with helpdesk_ticket_get({ id: "${r.id ?? r.ticket_id}", include: "messages" }), then draft a reply (send via helpdesk_ticket_send_reply once I approve).` },
          chat('knowledge_base', 'Draft reply'),
        ],
        detail: { tool: 'helpdesk_ticket_get', idKeys: ['id', 'ticket_id'], idArg: 'id' },
        empty: 'No open tickets.',
      },
      { id: 'overdue', label: 'Overdue', tool: 'helpdesk_tickets_overdue', titleKeys: ['subject', 'title'], fields: [{ keys: ['priority'] }], empty: 'Nothing overdue.' },
      { id: 'queues', label: 'Queues', tool: 'helpdesk_queues_list', titleKeys: ['name'], empty: 'No queues.' },
      { id: 'macros', label: 'Macros', tool: 'helpdesk_macros_list', titleKeys: ['name', 'title'], empty: 'No macros.' },
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
          { id: 'enable', label: 'Enable', kind: 'tool', tool: 'workflow_enable', args: (r) => ({ id: r.id }) },
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
          { id: 'send', label: 'Send now', kind: 'tool', tool: 'email_campaign_send_now', args: (r) => ({ id: r.id }), confirm: 'Send this campaign now?' },
          { id: 'pause', label: 'Pause', kind: 'tool', tool: 'email_campaign_pause', args: (r) => ({ id: r.id }), confirm: 'Pause this campaign? (queued sends stop)', successReload: true },
          { id: 'resume', label: 'Resume', kind: 'tool', tool: 'email_campaign_resume', args: (r) => ({ id: r.id }), confirm: 'Resume this campaign? (sending continues)', successReload: true },
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
      { id: 'posts', label: 'Posts', tool: 'social_list_posts', titleKeys: ['title', 'content', 'caption'], fields: [{ keys: ['status'] }, { keys: ['scheduled_at', 'created_at'], date: true }], rowActions: [{ id: 'publish', label: 'Publish', kind: 'tool', tool: 'social_publish_post', args: (r) => ({ post_id: r.id }), inputs: [{ key: 'platforms', label: 'Platforms (comma-separated, e.g. facebook, instagram, linkedin)', csv: true }], confirm: 'Publish this post now?' }], empty: 'No posts.' },
      { id: 'pillars', label: 'Pillars', tool: 'social_pillar_list', titleKeys: ['name', 'title'], empty: 'No content pillars.' },
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
    { id: 'sbusers', label: 'Auth users', tool: 'supabase_auth_users_list', titleKeys: ['email', 'id'], fields: [{ keys: ['created_at'], date: true }], empty: 'No users / no DB.' },
    { id: 'sbstorage', label: 'Storage buckets', tool: 'supabase_storage_list', titleKeys: ['name', 'id'], empty: 'No buckets.' },
    { id: 'sbfns', label: 'Edge functions', tool: 'supabase_edge_functions_list', titleKeys: ['name', 'slug'], empty: 'No functions.' },
    { id: 'sbmig', label: 'Migrations', tool: 'supabase_migrations_list', titleKeys: ['name', 'version'], fields: [{ keys: ['created_at'], date: true }], empty: 'No migrations.' },
  ],
};
