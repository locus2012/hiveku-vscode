/**
 * permissions.ask for the tools that switch ads on, restart them, or switch a
 * workflow on (src/knowledge.ts HIVEKU_ASK).
 *
 * Claude Code 2.1.283+ opens VS Code chats in auto mode, whose classifier
 * blocks an "enable the campaign" MCP call with no prompt at all. An explicit
 * ask rule is resolved before the classifier, so writeClaudeSettings writes one
 * per gated tool into every scaffolded folder's .claude/settings.json: additive,
 * idempotent, never an allow, and never beside a deny of the same name. The
 * gated tools are the part of the Claude Code plugin's forced prompts (a hook
 * the extension never runs) that switches ads on, restarts them, or switches a
 * workflow on. With the plugin checked out beside this repo, the last block
 * checks that the plugin gates every one of them too.
 *
 * "Never beside a deny" means any deny that covers the tool: its exact name,
 * the bare server (`mcp__hiveku`) or a glob (`mcp__hiveku__ppc_*`, `mcp__*`).
 *
 * ensureSpendAskRules adds only these rules to a folder scaffolded before they
 * existed (the extension runs it on activation), and changes nothing else.
 *
 * Also pins the permission gate (scripts/check-permission-rules.mjs) on the
 * ask array: an ask name a deny covers, or a glob, fails it. And the Autonomous
 * copy, which must not promise that nothing asks.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import './helpers/vscode-stub.mjs';
import { loadOut } from './helpers/load.mjs';
import { resolvePluginRoot } from '../scripts/agency-skills-set.mjs';

const knowledge = loadOut('knowledge');

const ACCOUNT = '0b6f1c2e-1111-4a4a-9c9c-222233334444';
const KEY = 'olp_test_key_123';
const BASE = 'https://core.hiveku.com';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The four rules 0.85.7 shipped, in the order it wrote them. */
const FIRST_FOUR = [
  'mcp__hiveku__ppc_enable_resource',
  'mcp__hiveku__ppc_platform_enable_resource',
  'mcp__hiveku__ppc_experiment_schedule',
  'mcp__hiveku__ppc_bing_experiment_create',
];

/**
 * The rules added with plugin 0.26.36 / Codex 0.1.18, which gate the same
 * tools: three that can switch ads on by status (and ask on every call,
 * because they also pause and read), four that can restart or widen delivery
 * without a status change, and the two that switch a workflow on.
 */
const ADDED = [
  'mcp__hiveku__ppc_bulk_edit',
  'mcp__hiveku__ppc_linkedin_creatives',
  'mcp__hiveku__ppc_tiktok_split_tests',
  'mcp__hiveku__ppc_recommendation_apply',
  'mcp__hiveku__ppc_meta_campaign_update',
  'mcp__hiveku__ppc_linkedin_campaign_update',
  'mcp__hiveku__ppc_linkedin_campaign_group_update',
  'mcp__hiveku__workflow_enable',
  'mcp__hiveku__workflow_resume',
  // A batch can carry any of the above as a member, and an ask rule cannot
  // look inside it, so the batch tool itself asks (as in the Codex plugin).
  'mcp__hiveku__hiveku_batch',
];

/** Every ask rule, as the scaffold must write them (the .mcp.json server is "hiveku"). */
/**
 * Version control: a rollback apply always asks (Versions Wave 2), so does settling merge conflicts
 * (2026-10-08), so does joining the merge line, which is the approval to merge (2026-10-09), and so
 * does running a review's checks again, which spends the site's test builds (2026-10-19).
 */
const VERSIONS = [
  'mcp__hiveku__project_vcs_rollback',
  'mcp__hiveku__project_vcs_resolve',
  'mcp__hiveku__project_vcs_queue_add',
  'mcp__hiveku__project_vcs_checks_rerun',
];

/** A site's secrets (2026-10-10, plan B3): writing, deleting, copying into the preview and revealing always ask. */
const SECRETS = [
  'mcp__hiveku__project_secrets_set',
  'mcp__hiveku__project_secrets_delete',
  'mcp__hiveku__project_secrets_apply_to_preview',
  'mcp__hiveku__project_secrets_reveal',
  'mcp__hiveku__project_secrets_replace',
  'mcp__hiveku__project_secrets_mark_sensitive',
];

/** Page A/B tests (2026-10-10): creating (a test copy commits code), re-splitting, every start, pause, resume or end, and a delete always ask. */
const AB_TESTS = [
  'mcp__hiveku__project_ab_test_create',
  'mcp__hiveku__project_ab_test_update',
  'mcp__hiveku__project_ab_test_action',
  'mcp__hiveku__project_ab_test_delete',
];

/**
 * Mobile (Expo) app settings (2026-10-12): the SDK upgrade (rewrites the app in one go), the store identity
 * (permanent once a build is uploaded to a store) and the Apple account the app publishes with always ask.
 */
const MOBILE = [
  'mcp__hiveku__mobile_app_sdk_upgrade',
  'mcp__hiveku__mobile_app_identity_set',
  'mcp__hiveku__mobile_app_apple_account_set',
  'mcp__hiveku__mobile_app_expo_project_choose',
];

/** The PPC change ledger's override (2026-10-13, MCP #211): a person's yes to going over someone else's recent change always asks. */
const PPC_OVERRIDE = ['mcp__hiveku__ppc_recent_change_override'];

/** Who gets a site's lead emails (2026-10-15, HK-255): the owner's choice always asks; its read does not. */
const LEAD_EMAILS = ['mcp__hiveku__marketing_form_notifications_update'];

/** The account's timezone and where the website assistant looks answers up (2026-10-19, plugin 0.27.58): every call asks, in this order. */
const ASSISTANT_TZ = ['mcp__hiveku__account_settings_update', 'mcp__hiveku__account_settings_logo_set', 'mcp__hiveku__account_settings_logo_remove', 'mcp__hiveku__account_timezone_set', 'mcp__hiveku__helpdesk_assistant_knowledge_sources_update'];

/** An account's environment groups (2026-10-17, plan B4, MCP #236): every write asks, in this order; the reads do not. */
const ENV_GROUPS = [
  'mcp__hiveku__env_group_create',
  'mcp__hiveku__env_group_update',
  'mcp__hiveku__env_group_delete',
  'mcp__hiveku__env_group_set',
  'mcp__hiveku__env_group_link',
  'mcp__hiveku__env_group_unlink',
];

/** Opening a sent email (2026-10-20, MCP #255): the answer holds live sign-in and reset links, so every call asks; the other email reads do not. */
const EMAIL_CONTENT = ['mcp__hiveku__email_message_get'];

/** The Email Service setup writes (2026-10-25): two send email, one rewires a live site's email, one adds suppression rows for good. Every call asks, in this order. */
const EMAIL_SETUP = [
  'mcp__hiveku__email_send',
  'mcp__hiveku__email_domain_send_instructions',
  'mcp__hiveku__email_project_connect',
  'mcp__hiveku__email_suppression_import',
];

/** Lead lists (2026-10-27, MCP #307): the '*_list_*' read glob matched every outbound_lead_list_* write, so each asks, in this order. */
const LEAD_LISTS = [
  'mcp__hiveku__outbound_lead_list_create',
  'mcp__hiveku__outbound_lead_list_update',
  'mcp__hiveku__outbound_lead_list_rows_add',
  'mcp__hiveku__outbound_lead_list_workflow_attach',
  'mcp__hiveku__outbound_lead_list_run_start',
  'mcp__hiveku__outbound_lead_list_run_control',
  'mcp__hiveku__outbound_lead_list_runs_stop_all',
];

/** "Ask them to record again" (2026-10-27, MCP #309): emails or texts a real customer, once per testimonial. */
const RERECORD = ['mcp__hiveku__marketing_testimonial_rerecord_send'];
// Formula fill for lead lists (2026-10-28, MCP #315): a write whose name the '*_list_*' read glob would match.
const FORMULA_FILL = ['mcp__hiveku__outbound_lead_list_formula_fill'];
/** Emailing a number transfer's letter of authorization (LOA) for e-signature (2026-10-29, builder #1883): a person approves each send. */
const PORT_LOA = ['mcp__hiveku__voice_port_order_loa_send'];
/** Who gets a client's signed contract (2026-10-30, Agent Feedback wave 73): each can add outside addresses that receive it, so every call asks, in this order. */
const CONTRACT_RECIPIENTS = [
  'mcp__hiveku__crm_envelope_alerts_set',
  'mcp__hiveku__crm_contract_template_create',
  'mcp__hiveku__crm_contract_template_update',
];
/** Starting or editing a contract, or changing its signer (2026-10-30, wave 73 step A2): outside addresses can get the signed contract, or a new signer a signing link, so every call asks, in this order. */
const CONTRACT_SIGNERS = [
  'mcp__hiveku__crm_envelope_create_from_template',
  'mcp__hiveku__crm_envelope_signer_reassign',
  'mcp__hiveku__crm_envelope_create',
  'mcp__hiveku__crm_envelope_update',
];
/** A site's lead inbox delete, the move to another workspace, a test lead email and a scheduled publish (2026-10-30, Website Builder wave B): every call asks, in this order. */
const SITE_WRITES = [
  'mcp__hiveku__marketing_form_inbox_delete',
  'mcp__hiveku__site_transfer',
  'mcp__hiveku__marketing_form_notifications_test',
  'mcp__hiveku__cms_schedule_set',
];
/** Cancelling a contact email that is waiting to send (2026-10-30): it will not go and the cancel cannot be undone, so every call asks. */
const EMAIL_CANCEL = [
  'mcp__hiveku__crm_email_scheduled_cancel',
];
/**
 * The desktop app's Ads area, wave B (2026-10-30, MCP #346): approving what the Ads AI staged, the three go-live
 * switches, the campaign, ad group and ad edits on the platform, the four conversion-upload writes and the
 * connection delete. Every call asks, in this order.
 */
const ADS_WAVE_B = [
  'mcp__hiveku__marketing_approval_approve',
  'mcp__hiveku__marketing_offline_conversions_go_live',
  'mcp__hiveku__ppc_conversion_adjustments_go_live',
  'mcp__hiveku__ppc_meta_lead_quality_enable',
  'mcp__hiveku__ppc_campaign_update',
  'mcp__hiveku__ppc_ad_group_status_set',
  'mcp__hiveku__ppc_ad_status_set',
  'mcp__hiveku__marketing_offline_conversions_set_enabled',
  'mcp__hiveku__marketing_offline_conversions_run',
  'mcp__hiveku__marketing_offline_conversions_requeue',
  'mcp__hiveku__marketing_offline_conversions_designate',
  'mcp__hiveku__ppc_connection_delete',
];
/** The wave B names a `mcp__hiveku__ppc_*` deny does not cover (the marketing_ ones), in the same order. */
const ADS_WAVE_B_NOT_PPC = ADS_WAVE_B.filter((name) => !name.startsWith('mcp__hiveku__ppc_'));
/**
 * Confirm on your phone (2026-10-31, MCP #359): the request pushed to the person's own phone to accept the 911
 * notice, and its cancel. Every call asks, in this order.
 */
const CONFIRM_PHONE = [
  'mcp__hiveku__confirm_on_phone_start',
  'mcp__hiveku__confirm_on_phone_cancel',
];
/**
 * The desktop app's SEO area, waves B and C (2026-10-30 and 31, MCP #362): the writes that publish, spend or delete for
 * good. Every call asks, in this order.
 */
const SEO_AREA = [
  'mcp__hiveku__seo_task_deploy',
  'mcp__hiveku__seo_gbp_post_create',
  'mcp__hiveku__seo_gbp_post_update',
  'mcp__hiveku__seo_gbp_post_delete',
  'mcp__hiveku__seo_rankings_refresh',
  'mcp__hiveku__seo_rankings_bulk_add',
  'mcp__hiveku__seo_rankings_ai_backfill',
  'mcp__hiveku__seo_website_report_create',
  'mcp__hiveku__seo_website_report_delete',
  'mcp__hiveku__seo_website_report_sections_set',
  'mcp__hiveku__seo_rankings_keyword_delete',
  'mcp__hiveku__seo_audit_delete',
  'mcp__hiveku__seo_sheet_rows_delete',
  'mcp__hiveku__seo_sheet_tab_delete',
  'mcp__hiveku__seo_deliverable_save_from_workspace',
  'mcp__hiveku__seo_report_clear',
  'mcp__hiveku__seo_connection_delete',
];
/**
 * The desktop app's Automations editor and Pending AI actions (2026-10-31): one workflow step run for real, and an AI
 * step's staged action approved or rejected. Every call asks, in this order. A deny of mcp__hiveku__workflow_* covers both.
 */
const AUTOMATIONS_DESKTOP = [
  'mcp__hiveku__workflow_node_run',
  'mcp__hiveku__workflow_pending_action_decide',
];
/**
 * The desktop app's Memory page writes (2026-10-31): About your business and its suggestions, an agent's rules, skills
 * and notes, the chief of staff's, a website's memory files, an agent's profile and switch, how the phone agents say
 * names, and a Marketplace install. Every call asks, in this order. A deny of mcp__hiveku__voice_* covers the pronunciations.
 */
const MEMORY_PAGE = [
  'mcp__hiveku__account_memory_save',
  'mcp__hiveku__account_memory_restore',
  'mcp__hiveku__account_memory_suggest',
  'mcp__hiveku__account_memory_suggestion_keep',
  'mcp__hiveku__account_memory_suggestions_remove',
  'mcp__hiveku__account_memory_suggestions_restore',
  'mcp__hiveku__agent_memory_save',
  'mcp__hiveku__agent_memory_remove',
  'mcp__hiveku__agent_memory_create',
  'mcp__hiveku__agent_memory_restore',
  'mcp__hiveku__chief_of_staff_memory_save',
  'mcp__hiveku__chief_of_staff_memory_remove',
  'mcp__hiveku__website_memory_file_save',
  'mcp__hiveku__website_memory_file_restore',
  'mcp__hiveku__agent_profile_save',
  'mcp__hiveku__agent_switch_set',
  'mcp__hiveku__voice_pronunciations_save',
  'mcp__hiveku__marketplace_template_install',
];
/**
 * The desktop app's workflow grid (2026-11-01): list and row deletes, row release, the AI formula writer, imports and
 * auto-run. Every call asks, in this order.
 */
const LEAD_GRID = [
  'mcp__hiveku__outbound_lead_grid_delete',
  'mcp__hiveku__outbound_lead_grid_rows_delete',
  'mcp__hiveku__outbound_lead_grid_rows_hold',
  'mcp__hiveku__outbound_lead_grid_formula_write',
  'mcp__hiveku__outbound_lead_grid_import_start',
  'mcp__hiveku__outbound_lead_grid_import_auto_run',
  'mcp__hiveku__outbound_lead_grid_auto_run_enable',
  'mcp__hiveku__outbound_lead_grid_auto_run_control',
];
/**
 * The desktop app's Mission Control person actions (2026-11-01): a person's claim (or take-over with force), the
 * release of their own claim, and their own decision on a card. Every call asks, in this order.
 */
const MISSION_CONTROL = [
  'mcp__hiveku__mc_task_claim',
  'mcp__hiveku__mc_task_release',
  'mcp__hiveku__mc_task_answer',
];
/**
 * Hiveku Meet and Discussions (2026-11-01): a webinar's invites, cancel and delete (Hiveku Meet decision 2), the
 * meeting and call recording deletes (the Hiveku app's own key alone on the server, asked here as a second guard), and
 * a Discussions channel's share, unshare and delete (the Discussions plan). Every call asks, in this order.
 */
const MEET_DISCUSSIONS = [
  'mcp__hiveku__marketing_webinar_invite',
  'mcp__hiveku__marketing_webinar_cancel',
  'mcp__hiveku__marketing_webinar_delete',
  'mcp__hiveku__meet_recording_delete',
  'mcp__hiveku__discussion_recording_delete',
  'mcp__hiveku__discussion_channel_share',
  'mcp__hiveku__discussion_channel_unshare',
  'mcp__hiveku__discussion_delete',
];
/**
 * A webinar's edit (Abe, 2026-11-01): moving its time emails every registrant, and the whole audience once its invites
 * went out. An ask rule names a tool, not its arguments, so every edit asks. Appended last.
 */
const WEBINAR_EDIT = ['mcp__hiveku__marketing_webinar_update'];
/**
 * An email webhook's delete (2026-11-03, HK-1083): today it switches the webhook off; once Hiveku serves permanent: true,
 * a call with it deletes the webhook and its delivery history for good. An ask rule names a tool, not its arguments, so
 * every call asks, the switch-off too. Appended last.
 */
const EMAIL_WEBHOOK_DELETE = ['mcp__hiveku__email_webhook_delete'];
/**
 * Projects wave 2 (2026-11-03, MCP #387 and #391): taking this workspace out of a project shared with it, a person's own
 * comment delete and reaction, a project's Slack test post, GitHub issues sync, billing client and rate, the import of
 * its logged hours onto Commerce > Usage, where it posts its updates, and a new workflow from a recipe. Every call asks,
 * in this order. Appended last.
 */
const PROJECTS_WAVE_2 = [
  'mcp__hiveku__pm_project_leave',
  'mcp__hiveku__pm_task_comment_delete',
  'mcp__hiveku__pm_task_comment_react',
  'mcp__hiveku__pm_project_slack_test',
  'mcp__hiveku__pm_project_github_sync_run',
  'mcp__hiveku__pm_project_billing_update',
  'mcp__hiveku__pm_project_billing_import',
  'mcp__hiveku__pm_project_integrations_update',
  'mcp__hiveku__pm_project_automation_create',
];
/**
 * A project's share and unshare with another workspace, an archived project's permanent delete and a task's permanent
 * delete (2026-11-03). Every call asks, in this order, right after PROJECTS_WAVE_2.
 */
const PROJECTS_SHARE_DELETE = [
  'mcp__hiveku__pm_project_share',
  'mcp__hiveku__pm_project_unshare',
  'mcp__hiveku__pm_projects_delete',
  'mcp__hiveku__pm_tasks_delete',
];
/**
 * Hiveku Meet's calendar sends (2026-11-03): a booking link emailed or texted to a contact, and a meeting booked for a
 * contact (the Hiveku app's own key alone on the server, asked here as a second guard). Content's SEO plan writes come
 * with them, as in the Claude Code and Codex plugins (SEO wave F). Appended last, in this order.
 */
const MEET_CALENDAR_SEO_PLAN = [
  'mcp__hiveku__crm_contact_booking_link_send',
  'mcp__hiveku__calendar_booking_create',
  'mcp__hiveku__seo_plan_phrase_set',
  'mcp__hiveku__seo_plan_suggest_phrases',
  'mcp__hiveku__seo_plan_suggest_links',
];
/**
 * Brand guides and customer journeys (2026-11-04): the brand guide's narrators, the billed AI fills, the key-stage
 * videos, a published version and a projection on the public page, as in the Claude Code and Codex plugins. Appended
 * last, in this order.
 */
const MARKETING_IDENTITY = [
  'mcp__hiveku__brand_guide_voiceovers_set',
  'mcp__hiveku__customer_journey_create_from_template',
  'mcp__hiveku__customer_journey_repopulate',
  'mcp__hiveku__customer_journey_videos_generate',
  'mcp__hiveku__customer_journey_iteration_publish',
  'mcp__hiveku__customer_journey_simulation_publish',
];
/** Bringing deleted contacts back (2026-11-04): a contact may have been deleted on purpose. Every call asks, last. */
const CONTACT_RESTORE = ['mcp__hiveku__crm_contacts_restore'];

/** The Publish and hosting writes (2026-11-05, wave S2b): each changes what visitors reach or the site's files, and always asks. */
const PUBLISH_AND_HOSTING = [
  'mcp__hiveku__project_publish_state_set',
  'mcp__hiveku__project_hosting_lane_set',
  'mcp__hiveku__project_hosting_lane_move',
  'mcp__hiveku__deploy_restore_files',
];

/**
 * Marketing > Referrals (2026-11-04): the invite, the status, the archive and the settings ask first, as in the Claude
 * Code and Codex plugins. Appended last, in this order.
 */
const REFERRALS = [
  'mcp__hiveku__marketing_referral_invite',
  'mcp__hiveku__marketing_referral_status_set',
  'mcp__hiveku__marketing_referral_archive',
  'mcp__hiveku__marketing_referral_update',
];

/**
 * The desktop app's account home, agency dashboard and Your data pages (2026-11-05): every write asks, as in the Claude
 * Code and Codex plugins. Appended last, in this order.
 */
const DASHBOARD_PAGES = [
  'mcp__hiveku__dashboards_page_create',
  'mcp__hiveku__dashboards_page_home_set',
  'mcp__hiveku__dashboards_page_shared_home_save',
  'mcp__hiveku__dashboards_page_update',
  'mcp__hiveku__dashboards_page_delete',
  'mcp__hiveku__dashboards_page_publish',
  'mcp__hiveku__dashboards_page_restore',
  'mcp__hiveku__dashboards_page_sharing_set',
  'mcp__hiveku__dashboards_page_editor_add',
  'mcp__hiveku__dashboards_page_editor_remove',
  'mcp__hiveku__dashboards_page_version_restore',
  'mcp__hiveku__dashboards_page_copy',
  'mcp__hiveku__dashboards_page_action_run',
  'mcp__hiveku__dashboards_page_workflow_button_run',
  'mcp__hiveku__dashboards_page_widget_describe',
  'mcp__hiveku__dashboards_page_rows_send',
  'mcp__hiveku__dashboards_page_tally_add',
  'mcp__hiveku__workspaces_page_prefs_save',
  'mcp__hiveku__workspaces_page_view_create',
  'mcp__hiveku__workspaces_page_view_from_template',
  'mcp__hiveku__workspaces_page_view_update',
  'mcp__hiveku__workspaces_page_view_delete',
  'mcp__hiveku__workspaces_page_view_grants_set',
  'mcp__hiveku__workspaces_page_pm_project_update',
  'mcp__hiveku__workspaces_page_pm_task_create',
  'mcp__hiveku__workspaces_page_pm_task_update',
  'mcp__hiveku__workspaces_page_mc_lane_create',
  'mcp__hiveku__workspaces_page_mc_lane_update',
  'mcp__hiveku__workspaces_page_mc_lane_delete',
  'mcp__hiveku__workspaces_page_mc_task_update',
  'mcp__hiveku__workspaces_page_mc_task_answer',
  'mcp__hiveku__workspaces_page_mc_task_claim',
  'mcp__hiveku__workspaces_page_mc_task_release',
  'mcp__hiveku__workspaces_page_mc_task_comment',
  'mcp__hiveku__workspaces_page_mc_task_transition',
  'mcp__hiveku__workspaces_page_custom_field_create',
  'mcp__hiveku__workspaces_page_custom_field_value_set',
  'mcp__hiveku__workspaces_page_custom_field_update',
  'mcp__hiveku__workspaces_page_custom_field_delete',
  'mcp__hiveku__workspaces_page_custom_field_grants_set',
  'mcp__hiveku__workspaces_page_dashboard_create',
  'mcp__hiveku__workspaces_page_dashboard_home_set',
  'mcp__hiveku__workspaces_page_dashboard_update',
  'mcp__hiveku__workspaces_page_dashboard_delete',
  'mcp__hiveku__workspaces_page_dashboard_restore',
  'mcp__hiveku__workspaces_page_dashboard_version_restore',
  'mcp__hiveku__workspaces_page_partner_account_create',
  'mcp__hiveku__workspaces_page_partner_branding_save',
  'mcp__hiveku__workspaces_page_partner_payout_details_save',
  'mcp__hiveku__dashboards_page_data_table_create',
  'mcp__hiveku__dashboards_page_data_table_update',
  'mcp__hiveku__dashboards_page_data_table_delete',
  'mcp__hiveku__dashboards_page_data_table_restore',
  'mcp__hiveku__dashboards_page_data_row_update',
  'mcp__hiveku__dashboards_page_data_rows_delete',
  'mcp__hiveku__dashboards_page_data_rows_restore',
  'mcp__hiveku__dashboards_page_data_column_change',
  'mcp__hiveku__dashboards_page_data_column_undo',
  'mcp__hiveku__dashboards_page_data_tally_add_remove',
  'mcp__hiveku__dashboards_page_data_tally_settings_save',
  'mcp__hiveku__dashboards_page_data_tally_start_from_zero',
  'mcp__hiveku__dashboards_page_data_workflow_writer_stop',
];

/**
 * Reads that bill the account (2026-11-05, HK-1155): the '*_summary' read glob approved all six unasked, and the Claude
 * Code plugin asks first. Appended last, in this order.
 */
const PAID_READS = [
  'mcp__hiveku__backlinks_summary',
  'mcp__hiveku__backlinks_bulk_pages_summary',
  'mcp__hiveku__backlinks_domain_pages_summary',
  'mcp__hiveku__backlinks_timeseries_summary',
  'mcp__hiveku__backlinks_timeseries_new_lost_summary',
  'mcp__hiveku__content_analysis_summary',
];

/**
 * The desktop app's Domains, settings and store writes (2026-11-05, waves S3c and S3d): the Claude Code and Codex plugins
 * ask first. Appended last, in this order.
 */
/**
 * Adding leads to a cold campaign (2026-11-05) and an environment's private mode (2026-11-06): the Claude Code and Codex
 * plugins ask first. Appended last, in this order.
 */
const COLD_LEADS_AND_PRIVATE_MODE = [
  'mcp__hiveku__outbound_leads_bulk_create',
  'mcp__hiveku__outbound_create_lead',
  'mcp__hiveku__site_firewall_private_set',
];

const ANALYTICS = [
  'mcp__hiveku__analytics_conversion_create',
  'mcp__hiveku__analytics_conversion_delete',
  'mcp__hiveku__analytics_tracking_settings_update',
];

/**
 * A site's cache clear (2026-11-06, HK-1166): project_cache_clear, and project_cdn_invalidate, the same clear under its
 * older name, ask first, as in the Claude Code and Codex plugins. Appended last, in this order.
 */
const CACHE_CLEAR = [
  'mcp__hiveku__project_cache_clear',
  'mcp__hiveku__project_cdn_invalidate',
];

/**
 * Account settings writes (2026-11-06): the 40 writes that went live on the Hiveku MCP with no ask rule ask first,
 * as in the Claude Code and Codex plugins. Appended last, in this order.
 */
const ACCOUNT_SETTINGS = [
  'mcp__hiveku__account_profile_update',
  'mcp__hiveku__account_profile_avatar_set',
  'mcp__hiveku__account_profile_avatar_remove',
  'mcp__hiveku__account_notifications_update',
  'mcp__hiveku__account_notifications_test_send',
  'mcp__hiveku__account_team_invite_send',
  'mcp__hiveku__account_team_invitation_resend',
  'mcp__hiveku__account_team_invitation_cancel',
  'mcp__hiveku__account_team_member_role_update',
  'mcp__hiveku__account_team_member_remove',
  'mcp__hiveku__account_team_ownership_transfer',
  'mcp__hiveku__account_team_computer_revoke',
  'mcp__hiveku__account_role_create',
  'mcp__hiveku__account_role_update',
  'mcp__hiveku__account_role_delete',
  'mcp__hiveku__account_team_activity_settings_update',
  'mcp__hiveku__account_team_activity_test_email_send',
  'mcp__hiveku__account_team_activity_data_delete',
  'mcp__hiveku__account_domain_register',
  'mcp__hiveku__account_domain_transfer',
  'mcp__hiveku__account_domain_transfer_submit',
  'mcp__hiveku__account_domain_dns_record_create',
  'mcp__hiveku__account_domain_dns_record_delete',
  'mcp__hiveku__account_security_password_update',
  'mcp__hiveku__account_security_2fa_update',
  'mcp__hiveku__account_security_computer_revoke',
  'mcp__hiveku__account_security_session_revoke',
  'mcp__hiveku__account_export_start',
  'mcp__hiveku__account_billing_plan_update',
  'mcp__hiveku__account_billing_credits_update',
  'mcp__hiveku__account_billing_credits_purchase',
  'mcp__hiveku__account_billing_subscription_cancel',
  'mcp__hiveku__account_mcp_key_create',
  'mcp__hiveku__account_mcp_key_revoke',
  'mcp__hiveku__account_byok_set',
  'mcp__hiveku__account_byok_delete',
  'mcp__hiveku__account_app_stores_apple_connect',
  'mcp__hiveku__account_app_stores_apple_share_update',
  'mcp__hiveku__account_app_stores_apple_disconnect',
  'mcp__hiveku__account_app_stores_expo_connect',
  'mcp__hiveku__account_app_stores_expo_disconnect',
];

/**
 * A phone line's password (2026-11-06, HK-1297): voice_sip_credentials_get is a read whose answer is the calling
 * person's SIP password. Every call asks, as in the Claude Code plugin and Codex. Appended last.
 */
const SIP_PASSWORD = ['mcp__hiveku__voice_sip_credentials_get'];

/** Public link switches (2026-11-06, HK-1203): each call asks, as in the Claude Code plugin and Codex. Appended last. */
const PUBLIC_LINKS = [
  'mcp__hiveku__customer_journey_public_link_set',
  'mcp__hiveku__before_after_grid_public_link_set',
  'mcp__hiveku__customer_avatar_public_link_set',
];
/** A Meta ad's URL parameters and booking calendars (2026-11-07, HK-1146, HK-1137). Each call asks. Appended last. */
const BOOKING_CALENDARS = ['mcp__hiveku__calendar_meeting_type_create', 'mcp__hiveku__calendar_meeting_type_update'];
const ADS_AND_CALENDARS = ['mcp__hiveku__ppc_meta_url_tags_set', ...BOOKING_CALENDARS];
/** The Webflow settings writes (2026-11-07, wave S3e). Each call asks. Appended last. */
const WEBFLOW_SETTINGS = [
  'mcp__hiveku__webflow_connection_token_add',
  'mcp__hiveku__webflow_project_site_bind',
  'mcp__hiveku__webflow_connection_disconnect',
  'mcp__hiveku__webflow_webhooks_reregister',
  'mcp__hiveku__webflow_form_routing_set',
  'mcp__hiveku__webflow_form_submissions_backfill',
];

/** The agency dashboard changes (2026-11-07). Each call asks. Appended last. */
const WORKSPACE_DASHBOARDS = [
  'mcp__hiveku__workspace_dashboard_create',
  'mcp__hiveku__workspace_dashboard_update',
  'mcp__hiveku__workspace_dashboard_widget_create',
  'mcp__hiveku__workspace_dashboard_widget_update',
  'mcp__hiveku__workspace_dashboard_widget_delete',
  'mcp__hiveku__workspace_dashboard_layout_update',
  'mcp__hiveku__workspace_dashboard_page_create',
  'mcp__hiveku__workspace_dashboard_page_update',
  'mcp__hiveku__workspace_dashboard_page_delete',
  'mcp__hiveku__workspace_dashboard_restore',
  'mcp__hiveku__workspace_dashboard_delete',
  'mcp__hiveku__workspace_dashboard_version_restore',
];

/** The cookie banner, its trackers and the Review page (2026-11-07, waves S3i and S3f). Each call asks. Appended last. */
const BANNER_AND_REVIEW = [
  'mcp__hiveku__project_cookie_banner_set',
  'mcp__hiveku__project_consent_trackers_add',
  'mcp__hiveku__project_consent_trackers_update',
  'mcp__hiveku__project_consent_trackers_remove',
  'mcp__hiveku__project_annotation_create',
  'mcp__hiveku__project_annotation_delete',
  'mcp__hiveku__project_annotation_comment_update',
  'mcp__hiveku__project_annotation_comment_delete',
  'mcp__hiveku__project_review_notify_set',
  'mcp__hiveku__project_review_notify_test',
  'mcp__hiveku__project_review_session_set',
  'mcp__hiveku__project_review_session_clear',
  'mcp__hiveku__project_review_frame_url',
];

/** The account's own dashboards and Your data tables (2026-11-08, decision 7), then the two Client health writes. Each
 * call asks. Appended last. */
const ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH = [
  'mcp__hiveku__dashboard_create',
  'mcp__hiveku__dashboard_update',
  'mcp__hiveku__dashboard_restore',
  'mcp__hiveku__dashboard_layout_update',
  'mcp__hiveku__dashboard_widget_create',
  'mcp__hiveku__dashboard_widget_update',
  'mcp__hiveku__dashboard_widget_delete',
  'mcp__hiveku__dashboard_page_create',
  'mcp__hiveku__dashboard_page_update',
  'mcp__hiveku__dashboard_page_delete',
  'mcp__hiveku__dashboard_control_create',
  'mcp__hiveku__dashboard_control_update',
  'mcp__hiveku__dashboard_control_delete',
  'mcp__hiveku__dashboard_data_source_create',
  'mcp__hiveku__dashboard_data_source_update',
  'mcp__hiveku__dashboard_data_rows_send',
  'mcp__hiveku__dashboard_data_rows_delete',
  'mcp__hiveku__dashboard_tally_add',
  'mcp__hiveku__dashboard_delete',
  'mcp__hiveku__dashboard_publish',
  'mcp__hiveku__dashboard_share',
  'mcp__hiveku__dashboard_version_restore',
  'mcp__hiveku__dashboard_data_source_delete',
  'mcp__hiveku__dashboard_data_column_change',
  'mcp__hiveku__workspaces_page_attention_item_update',
  'mcp__hiveku__workspaces_page_attention_recheck',
];

/** Analytics and Forms (2026-11-08, wave S5a): ideal customer matching (AI credit), the form capture erase, and a session
 * recording read. Each call asks. Appended last. */
const S5A_ANALYTICS = [
  'mcp__hiveku__analytics_icp_matching_run',
  'mcp__hiveku__marketing_form_capture_purge',
  'mcp__hiveku__analytics_recording_get',
];
/** Client health round 3 (2026-11-08): a client's own lines, its Lead and Backup, and team notes. Each call asks.
 * Appended last. */
const CLIENT_HEALTH_DEPTH = [
  'mcp__hiveku__workspaces_page_attention_lines_set',
  'mcp__hiveku__workspaces_page_attention_fields_set',
  'mcp__hiveku__workspaces_page_attention_note_create',
  'mcp__hiveku__workspaces_page_attention_note_update',
  'mcp__hiveku__workspaces_page_attention_note_delete',
];
/** The gated read among them: its answer is one visitor's whole visit as they saw it on screen. */
const RECORDING_READ = 'mcp__hiveku__analytics_recording_get';

const DOMAINS_AND_SETTINGS = [
  'mcp__hiveku__project_domain_auto_configure',
  'mcp__hiveku__project_domain_transfer',
  'mcp__hiveku__project_secrets_rename',
  'mcp__hiveku__site_convert_to_hosted',
  'mcp__hiveku__shopify_project_settings_set',
];

const EXPECTED_ASK = [...FIRST_FOUR, ...ADDED, ...VERSIONS, ...SECRETS, ...AB_TESTS, ...MOBILE, ...PPC_OVERRIDE, ...LEAD_EMAILS, ...ASSISTANT_TZ, ...ENV_GROUPS, ...EMAIL_CONTENT, ...EMAIL_SETUP, ...LEAD_LISTS, ...RERECORD, ...FORMULA_FILL, ...PORT_LOA, ...CONTRACT_RECIPIENTS, ...CONTRACT_SIGNERS, ...SITE_WRITES, ...EMAIL_CANCEL, ...ADS_WAVE_B, ...CONFIRM_PHONE, ...SEO_AREA, ...AUTOMATIONS_DESKTOP, ...MEMORY_PAGE, ...LEAD_GRID, ...MISSION_CONTROL, ...MEET_DISCUSSIONS, ...WEBINAR_EDIT, ...EMAIL_WEBHOOK_DELETE, ...PROJECTS_WAVE_2, ...PROJECTS_SHARE_DELETE, ...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH];
const without = (...names) => EXPECTED_ASK.filter((name) => !names.includes(name));

const dirs = [];
after(async () => {
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

async function tmp(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const scaffoldAccount = (dir) =>
  knowledge.writeScaffold({ baseDir: dir, accountLabel: 'Acme', apiKey: KEY, baseUrl: BASE, accountId: ACCOUNT });

const scaffoldProject = (dir) =>
  knowledge.writeProjectScaffold({
    baseDir: dir, accountLabel: 'Acme', apiKey: KEY, baseUrl: BASE, accountId: ACCOUNT,
    projectId: '11111111-2222-3333-4444-555555555555', projectName: 'Main site',
  });

const settingsPath = (dir) => path.join(dir, '.claude', 'settings.json');

async function readSettings(dir) {
  return JSON.parse(await fs.readFile(settingsPath(dir), 'utf8'));
}

async function seedSettings(dir, settings) {
  await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
  await fs.writeFile(settingsPath(dir), JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/** Claude Code permission globs: '*' is the only wildcard. */
const globMatches = (glob, name) =>
  new RegExp('^' + glob.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(name);

describe('Scaffolded settings: ask rules for the tools that switch ads or workflows on', () => {
  test('a fresh account folder asks for every one of them, and allows none of them', async () => {
    const dir = await tmp('hk-ask-fresh-');
    await scaffoldAccount(dir);
    const { permissions } = await readSettings(dir);
    assert.deepEqual(permissions.ask, EXPECTED_ASK);
    for (const name of EXPECTED_ASK) {
      assert.ok(!permissions.allow.includes(name), `${name} was written as an allow`);
      assert.ok(!permissions.deny.includes(name), `${name} was written as a deny`);
      // No allow rule may approve it either: ask beats allow, but an allow here
      // would be a scaffold bug the ask only happens to mask. The gated reads
      // (EMAIL_CONTENT, SIP_PASSWORD and RECORDING_READ) are the one exception: the read glob approves every _get on
      // purpose, and these reads ask over it (Claude Code checks deny, then ask, then
      // allow), as the plugin's NEVER_AUTO_APPROVE asks over its read list. The lead
      // list writes (LEAD_LISTS) are the other: their names hold '_list_', which the
      // '*_list_*' read glob matches, and they ask over it the same way. The reads that
      // bill (PAID_READS) ask over '*_summary' the same way.
      const approving = permissions.allow.filter((rule) => globMatches(rule, name));
      const allowed = EMAIL_CONTENT.includes(name) || SIP_PASSWORD.includes(name) || name === RECORDING_READ
        ? approving.filter((rule) => rule !== 'mcp__hiveku__*_get')
        : LEAD_LISTS.includes(name) || FORMULA_FILL.includes(name)
          ? approving.filter((rule) => rule !== 'mcp__hiveku__*_list_*')
          : PAID_READS.includes(name)
            ? approving.filter((rule) => rule !== 'mcp__hiveku__*_summary')
            : approving;
      assert.deepEqual(allowed, [], `${name} is approved by ${allowed.join(', ')}`);
    }
    // The extension's own prefix only: it writes no plugin-prefix rules anywhere.
    assert.ok(permissions.ask.every((rule) => rule.startsWith('mcp__hiveku__')));
  });

  test('a site folder gets the same ask rules', async () => {
    const dir = await tmp('hk-ask-project-');
    await scaffoldProject(dir);
    const { permissions } = await readSettings(dir);
    assert.deepEqual(permissions.ask, EXPECTED_ASK);
  });

  test("the user's ask entries, other rule lists and top-level keys are kept, in order", async () => {
    const dir = await tmp('hk-ask-user-');
    const userAsk = ['Bash(git push:*)', 'mcp__hiveku__deploy_site', 'WebFetch'];
    await seedSettings(dir, {
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] },
      permissions: {
        ask: [...userAsk],
        allow: ['Bash(make:*)'],
        deny: ['Read(./secrets/**)'],
        additionalDirectories: ['../shared'],
      },
    });
    await scaffoldAccount(dir);
    const settings = await readSettings(dir);
    const { permissions } = settings;
    assert.deepEqual(permissions.ask.slice(0, userAsk.length), userAsk, 'user ask entries moved or were dropped');
    assert.deepEqual(permissions.ask.slice(userAsk.length), EXPECTED_ASK);
    assert.equal(permissions.allow[0], 'Bash(make:*)');
    assert.equal(permissions.deny[0], 'Read(./secrets/**)');
    assert.deepEqual(permissions.additionalDirectories, ['../shared']);
    assert.equal(settings.model, 'opus');
    assert.deepEqual(settings.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] });
  });

  test('an entry the user already has keeps its place and is not repeated', async () => {
    const dir = await tmp('hk-ask-have-');
    const userAsk = ['Bash(git push:*)', 'mcp__hiveku__ppc_experiment_schedule', 'WebFetch'];
    await seedSettings(dir, { permissions: { ask: [...userAsk] } });
    await scaffoldAccount(dir);
    const { permissions } = await readSettings(dir);
    assert.deepEqual(permissions.ask.slice(0, userAsk.length), userAsk);
    assert.deepEqual(
      permissions.ask.slice(userAsk.length),
      EXPECTED_ASK.filter((name) => name !== 'mcp__hiveku__ppc_experiment_schedule'),
    );
    assert.equal(permissions.ask.filter((rule) => rule === 'mcp__hiveku__ppc_experiment_schedule').length, 1);
  });

  test('idempotent: re-scaffolding writes the same rules and duplicates nothing', async () => {
    const dir = await tmp('hk-ask-again-');
    await seedSettings(dir, { permissions: { ask: ['Bash(git push:*)'] } });
    await scaffoldAccount(dir);
    const first = (await readSettings(dir)).permissions;
    await scaffoldAccount(dir);
    await scaffoldProject(dir);
    await scaffoldAccount(dir);
    const last = (await readSettings(dir)).permissions;
    assert.deepEqual(last, first);
    assert.equal(new Set(last.ask).size, last.ask.length, 'ask has a duplicate');
    assert.deepEqual(last.ask, ['Bash(git push:*)', ...EXPECTED_ASK]);
  });

  test('a tool the user denied stays denied and is not also asked', async () => {
    const dir = await tmp('hk-ask-denied-');
    await seedSettings(dir, { permissions: { deny: ['mcp__hiveku__ppc_platform_enable_resource'] } });
    await scaffoldAccount(dir);
    const { permissions } = await readSettings(dir);
    assert.ok(permissions.deny.includes('mcp__hiveku__ppc_platform_enable_resource'), 'the user deny was dropped');
    assert.ok(!permissions.ask.includes('mcp__hiveku__ppc_platform_enable_resource'), 'a denied tool was also asked');
    assert.deepEqual(permissions.ask, EXPECTED_ASK.filter((name) => name !== 'mcp__hiveku__ppc_platform_enable_resource'));
    // And nothing the scaffold denies on its own is asked.
    assert.deepEqual(permissions.ask.filter((rule) => permissions.deny.includes(rule)), []);
  });

  test('a server-level or glob deny covers the tools it matches, so they are not asked', async () => {
    const cases = [
      // [deny rules, the ask rules that must still be written]
      [['mcp__hiveku'], []],
      [['mcp__hiveku__*'], []],
      [['mcp__*'], []],
      [['*'], []],
      [['mcp__hiveku__ppc_*'], ['mcp__hiveku__workflow_enable', 'mcp__hiveku__workflow_resume', 'mcp__hiveku__hiveku_batch', ...VERSIONS, ...SECRETS, ...AB_TESTS, ...MOBILE, ...LEAD_EMAILS, ...ASSISTANT_TZ, ...ENV_GROUPS, ...EMAIL_CONTENT, ...EMAIL_SETUP, ...LEAD_LISTS, ...RERECORD, ...FORMULA_FILL, ...PORT_LOA, ...CONTRACT_RECIPIENTS, ...CONTRACT_SIGNERS, ...SITE_WRITES, ...EMAIL_CANCEL, ...ADS_WAVE_B_NOT_PPC, ...CONFIRM_PHONE, ...SEO_AREA, ...AUTOMATIONS_DESKTOP, ...MEMORY_PAGE, ...LEAD_GRID, ...MISSION_CONTROL, ...MEET_DISCUSSIONS, ...WEBINAR_EDIT, ...EMAIL_WEBHOOK_DELETE, ...PROJECTS_WAVE_2, ...PROJECTS_SHARE_DELETE, ...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...BOOKING_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]],
      [['mcp__hiveku__workflow_*'], EXPECTED_ASK.filter((name) => !name.startsWith('mcp__hiveku__workflow_'))],
      [['mcp__hiveku__ppc_*', 'mcp__hiveku__workflow_*'], ['mcp__hiveku__hiveku_batch', ...VERSIONS, ...SECRETS, ...AB_TESTS, ...MOBILE, ...LEAD_EMAILS, ...ASSISTANT_TZ, ...ENV_GROUPS, ...EMAIL_CONTENT, ...EMAIL_SETUP, ...LEAD_LISTS, ...RERECORD, ...FORMULA_FILL, ...PORT_LOA, ...CONTRACT_RECIPIENTS, ...CONTRACT_SIGNERS, ...SITE_WRITES, ...EMAIL_CANCEL, ...ADS_WAVE_B_NOT_PPC, ...CONFIRM_PHONE, ...SEO_AREA, ...MEMORY_PAGE, ...LEAD_GRID, ...MISSION_CONTROL, ...MEET_DISCUSSIONS, ...WEBINAR_EDIT, ...EMAIL_WEBHOOK_DELETE, ...PROJECTS_WAVE_2, ...PROJECTS_SHARE_DELETE, ...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...BOOKING_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]],
      [['mcp__hiveku__ppc_*', 'mcp__hiveku__workflow_*', 'mcp__hiveku__hiveku_batch'], [...VERSIONS, ...SECRETS, ...AB_TESTS, ...MOBILE, ...LEAD_EMAILS, ...ASSISTANT_TZ, ...ENV_GROUPS, ...EMAIL_CONTENT, ...EMAIL_SETUP, ...LEAD_LISTS, ...RERECORD, ...FORMULA_FILL, ...PORT_LOA, ...CONTRACT_RECIPIENTS, ...CONTRACT_SIGNERS, ...SITE_WRITES, ...EMAIL_CANCEL, ...ADS_WAVE_B_NOT_PPC, ...CONFIRM_PHONE, ...SEO_AREA, ...MEMORY_PAGE, ...LEAD_GRID, ...MISSION_CONTROL, ...MEET_DISCUSSIONS, ...WEBINAR_EDIT, ...EMAIL_WEBHOOK_DELETE, ...PROJECTS_WAVE_2, ...PROJECTS_SHARE_DELETE, ...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...BOOKING_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]],
      // A user who keeps every marketing tool from Claude Code: the deny covers the lead-email change, the record-again
      // send, the site inbox delete and test lead email, wave B's approval and conversion-upload writes, and the webinar
      // invites, cancel, delete and edit.
      [['mcp__hiveku__marketing_*'], EXPECTED_ASK.filter((name) => !name.startsWith('mcp__hiveku__marketing_'))],
      // A user who keeps every phone tool from Claude Code: the deny covers the LOA send and the pronunciations save, so
      // they are not also asked, and the phone line password read (SIP_PASSWORD).
      [['mcp__hiveku__voice_*'], without('mcp__hiveku__voice_port_order_loa_send', 'mcp__hiveku__voice_pronunciations_save', ...SIP_PASSWORD)],
      // A user who keeps every CRM tool from Claude Code: the deny covers the contract recipient and signer writes and the email cancel, so they are not also asked.
      [['mcp__hiveku__crm_*'], without(...CONTRACT_RECIPIENTS, ...CONTRACT_SIGNERS, ...EMAIL_CANCEL, 'mcp__hiveku__crm_contact_booking_link_send', ...CONTACT_RESTORE)],
      [['mcp__hiveku__ppc_*enable_resource'], without('mcp__hiveku__ppc_enable_resource', 'mcp__hiveku__ppc_platform_enable_resource')],
      [['mcp__hiveku__*_experiment_*'], without('mcp__hiveku__ppc_experiment_schedule', 'mcp__hiveku__ppc_bing_experiment_create')],
      [['mcp__hiveku__ppc_linkedin_*'], without('mcp__hiveku__ppc_linkedin_creatives', 'mcp__hiveku__ppc_linkedin_campaign_update', 'mcp__hiveku__ppc_linkedin_campaign_group_update')],
      // Not a cover: another server, a name prefix with no glob, a Bash rule.
      [['mcp__hiveku_old', 'mcp__hiveku__ppc', 'mcp__other__*', 'Bash(*)'], EXPECTED_ASK],
    ];
    for (const [deny, expected] of cases) {
      const dir = await tmp('hk-ask-cover-');
      await seedSettings(dir, { permissions: { deny: [...deny] } });
      await scaffoldAccount(dir);
      const { permissions } = await readSettings(dir);
      assert.deepEqual(permissions.ask ?? [], expected, `deny ${JSON.stringify(deny)}`);
      for (const rule of deny) assert.ok(permissions.deny.includes(rule), `the user deny ${rule} was dropped`);
    }
  });

  test('with every one denied and no user ask list, no ask key is written', async () => {
    const dir = await tmp('hk-ask-none-');
    await seedSettings(dir, { permissions: { deny: [...EXPECTED_ASK] } });
    await scaffoldAccount(dir);
    const { permissions } = await readSettings(dir);
    assert.equal(permissions.ask, undefined);
    for (const name of EXPECTED_ASK) assert.ok(permissions.deny.includes(name));
  });
});

describe('ensureSpendAskRules: a folder scaffolded before the ask rules', () => {
  /** The settings.json an older scaffold wrote: allow + deny + mode, no ask. */
  const OLD = {
    model: 'opus',
    permissions: {
      defaultMode: 'acceptEdits',
      allow: ['mcp__hiveku__*_get', 'Bash(make:*)'],
      deny: ['Read(**/.env.local)', 'Write(//tmp/**)'],
    },
    sandbox: { enabled: false },
  };

  test('adds exactly the ask rules and changes nothing else', async () => {
    const dir = await tmp('hk-ensure-old-');
    await seedSettings(dir, OLD);
    const added = await knowledge.ensureSpendAskRules(dir);
    assert.deepEqual(added, EXPECTED_ASK);
    const after = await readSettings(dir);
    assert.deepEqual(after, { ...OLD, permissions: { ...OLD.permissions, ask: EXPECTED_ASK } });
  });

  test("keeps the user's ask entries first, and a second run writes nothing", async () => {
    const dir = await tmp('hk-ensure-again-');
    await seedSettings(dir, { ...OLD, permissions: { ...OLD.permissions, ask: ['WebFetch', 'mcp__hiveku__ppc_enable_resource'] } });
    assert.deepEqual(
      await knowledge.ensureSpendAskRules(dir),
      EXPECTED_ASK.filter((name) => name !== 'mcp__hiveku__ppc_enable_resource'),
    );
    const once = await fs.readFile(settingsPath(dir), 'utf8');
    assert.deepEqual(JSON.parse(once).permissions.ask.slice(0, 2), ['WebFetch', 'mcp__hiveku__ppc_enable_resource']);
    const { mtimeMs } = await fs.stat(settingsPath(dir));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), []);
    assert.equal(await fs.readFile(settingsPath(dir), 'utf8'), once);
    assert.equal((await fs.stat(settingsPath(dir))).mtimeMs, mtimeMs, 'a run with nothing to add rewrote the file');
  });

  test('skips what the deny list covers, by name or glob', async () => {
    const dir = await tmp('hk-ensure-deny-');
    await seedSettings(dir, { permissions: { deny: ['mcp__hiveku__ppc_*enable_resource', 'mcp__hiveku__ppc_experiment_schedule'] } });
    const expected = without('mcp__hiveku__ppc_enable_resource', 'mcp__hiveku__ppc_platform_enable_resource', 'mcp__hiveku__ppc_experiment_schedule');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), expected);
    const { permissions } = await readSettings(dir);
    assert.deepEqual(permissions.ask, expected);
    assert.deepEqual(permissions.deny, ['mcp__hiveku__ppc_*enable_resource', 'mcp__hiveku__ppc_experiment_schedule']);
  });

  test('a folder that holds the four 0.85.7 rules gets exactly the new ones, appended in order', async () => {
    const dir = await tmp('hk-ensure-085-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: ['WebFetch', ...FIRST_FOUR] } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...ADDED, ...VERSIONS, ...SECRETS, ...AB_TESTS, ...MOBILE, ...PPC_OVERRIDE, ...LEAD_EMAILS, ...ASSISTANT_TZ, ...ENV_GROUPS, ...EMAIL_CONTENT, ...EMAIL_SETUP, ...LEAD_LISTS, ...RERECORD, ...FORMULA_FILL, ...PORT_LOA, ...CONTRACT_RECIPIENTS, ...CONTRACT_SIGNERS, ...SITE_WRITES, ...EMAIL_CANCEL, ...ADS_WAVE_B, ...CONFIRM_PHONE, ...SEO_AREA, ...AUTOMATIONS_DESKTOP, ...MEMORY_PAGE, ...LEAD_GRID, ...MISSION_CONTROL, ...MEET_DISCUSSIONS, ...WEBINAR_EDIT, ...EMAIL_WEBHOOK_DELETE, ...PROJECTS_WAVE_2, ...PROJECTS_SHARE_DELETE, ...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    const after = await readSettings(dir);
    assert.deepEqual(after, { ...before, permissions: { ...before.permissions, ask: ['WebFetch', ...FIRST_FOUR, ...ADDED, ...VERSIONS, ...SECRETS, ...AB_TESTS, ...MOBILE, ...PPC_OVERRIDE, ...LEAD_EMAILS, ...ASSISTANT_TZ, ...ENV_GROUPS, ...EMAIL_CONTENT, ...EMAIL_SETUP, ...LEAD_LISTS, ...RERECORD, ...FORMULA_FILL, ...PORT_LOA, ...CONTRACT_RECIPIENTS, ...CONTRACT_SIGNERS, ...SITE_WRITES, ...EMAIL_CANCEL, ...ADS_WAVE_B, ...CONFIRM_PHONE, ...SEO_AREA, ...AUTOMATIONS_DESKTOP, ...MEMORY_PAGE, ...LEAD_GRID, ...MISSION_CONTROL, ...MEET_DISCUSSIONS, ...WEBINAR_EDIT, ...EMAIL_WEBHOOK_DELETE, ...PROJECTS_WAVE_2, ...PROJECTS_SHARE_DELETE, ...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH] } });
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.48 rules gets only the webinar edit, the webhook delete, the Projects asks and the newer rules, appended last, so it asks in a fresh folder\'s order', async () => {
    const dir = await tmp('hk-ensure-09148-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...WEBINAR_EDIT, ...EMAIL_WEBHOOK_DELETE, ...PROJECTS_WAVE_2, ...PROJECTS_SHARE_DELETE, ...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...WEBINAR_EDIT, ...EMAIL_WEBHOOK_DELETE, ...PROJECTS_WAVE_2, ...PROJECTS_SHARE_DELETE, ...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.49 rules gets only the email webhook delete, the Projects asks and the newer rules, appended last, so it asks in a fresh folder\'s order', async () => {
    const dir = await tmp('hk-ensure-09149-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...EMAIL_WEBHOOK_DELETE, ...PROJECTS_WAVE_2, ...PROJECTS_SHARE_DELETE, ...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...EMAIL_WEBHOOK_DELETE, ...PROJECTS_WAVE_2, ...PROJECTS_SHARE_DELETE, ...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.50 rules gets only the Meet calendar sends, the SEO plan writes and the newer rules, appended last', async () => {
    const dir = await tmp('hk-ensure-09150-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...MEET_CALENDAR_SEO_PLAN, ...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.51 rules gets only the brand guide and journey asks, appended last', async () => {
    const dir = await tmp('hk-ensure-09151-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...MARKETING_IDENTITY, ...CONTACT_RESTORE, ...PUBLISH_AND_HOSTING, ...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.57 rules gets only the Referrals asks, appended last', async () => {
    const dir = await tmp('hk-ensure-09157-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...REFERRALS, ...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.58 rules gets only the account home, agency dashboard and Your data asks, appended last', async () => {
    const dir = await tmp('hk-ensure-09158-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...DASHBOARD_PAGES, ...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.59 rules gets the reads that bill the account and what came after them, appended last', async () => {
    const dir = await tmp('hk-ensure-09159-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...PAID_READS, ...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.60 rules gets only the Domains, settings and store writes and what came after, appended last', async () => {
    const dir = await tmp('hk-ensure-09160-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...DOMAINS_AND_SETTINGS, ...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.61 rules gets only the cold lead adds, private mode and what came after, appended last', async () => {
    const dir = await tmp('hk-ensure-09161-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...COLD_LEADS_AND_PRIVATE_MODE, ...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.62 rules gets only the Analytics writes and the cache clear asks, appended last', async () => {
    const dir = await tmp('hk-ensure-09162-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...ANALYTICS, ...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.63 rules gets only the cache clear, account settings, phone line password and public link asks, appended last', async () => {
    const dir = await tmp('hk-ensure-09163-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...CACHE_CLEAR, ...ACCOUNT_SETTINGS, ...SIP_PASSWORD, ...PUBLIC_LINKS, ...ADS_AND_CALENDARS, ...WEBFLOW_SETTINGS, ...WORKSPACE_DASHBOARDS, ...BANNER_AND_REVIEW, ...ACCOUNT_DASHBOARDS_AND_CLIENT_HEALTH, ...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.69 rules gets only the S5a analytics asks, appended last', async () => {
    const dir = await tmp('hk-ensure-09169-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [...S5A_ANALYTICS, ...CLIENT_HEALTH_DEPTH]);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('a folder that holds the 0.91.72 rules gets only the Client health round 3 asks, appended last', async () => {
    const dir = await tmp('hk-ensure-09172-');
    const before = { ...OLD, permissions: { ...OLD.permissions, ask: without(...CLIENT_HEALTH_DEPTH) } };
    await seedSettings(dir, before);
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), CLIENT_HEALTH_DEPTH);
    assert.deepEqual((await readSettings(dir)).permissions.ask, EXPECTED_ASK, 'an updated folder asks in the order a fresh one does');
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], 'a second run added something');
  });

  test('leaves a missing, unparseable or oddly shaped file alone', async () => {
    const missing = await tmp('hk-ensure-missing-');
    assert.deepEqual(await knowledge.ensureSpendAskRules(missing), []);
    await assert.rejects(fs.access(settingsPath(missing)), 'a folder with no settings got one');

    const shapes = ['{ "permissions": { "allow": [ ', '[]', '{"permissions": "x"}', '{"permissions": {"ask": "WebFetch"}}'];
    for (const text of shapes) {
      const dir = await tmp('hk-ensure-odd-');
      await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
      await fs.writeFile(settingsPath(dir), text, 'utf8');
      assert.deepEqual(await knowledge.ensureSpendAskRules(dir), [], text);
      assert.equal(await fs.readFile(settingsPath(dir), 'utf8'), text, `rewrote ${text}`);
    }
  });

  test('a settings.json with no permissions block gets one holding only the ask rules', async () => {
    const dir = await tmp('hk-ensure-noperms-');
    await seedSettings(dir, { model: 'opus' });
    assert.deepEqual(await knowledge.ensureSpendAskRules(dir), EXPECTED_ASK);
    assert.deepEqual(await readSettings(dir), { model: 'opus', permissions: { ask: EXPECTED_ASK } });
  });
});

describe('Permission gate: the ask array', () => {
  const gate = path.join(ROOT, 'scripts', 'check-permission-rules.mjs');

  /** Run the gate against a copy of knowledge.ts with `mutate` applied, from a scratch tree. */
  async function runGateOn(mutate) {
    const dir = await tmp('hk-ask-gate-');
    await fs.mkdir(path.join(dir, 'scripts'));
    await fs.mkdir(path.join(dir, 'src'));
    await fs.copyFile(gate, path.join(dir, 'scripts', 'check-permission-rules.mjs'));
    const src = await fs.readFile(path.join(ROOT, 'src', 'knowledge.ts'), 'utf8');
    const changed = mutate(src);
    assert.notEqual(changed, src, 'the mutation did not apply: the negative control would pass for the wrong reason');
    await fs.writeFile(path.join(dir, 'src', 'knowledge.ts'), changed, 'utf8');
    return spawnSync(process.execPath, [path.join(dir, 'scripts', 'check-permission-rules.mjs')], { encoding: 'utf8' });
  }

  test('the real source passes and counts the ask rules apart from the denies', () => {
    const run = spawnSync(process.execPath, [gate], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    // With no registry build the gate stops after the syntax pass, so the count
    // line is only asserted when it printed. With one, every ask name must be a
    // real tool: a typo would gate nothing, silently.
    if (/allow rules/.test(run.stdout)) {
      assert.match(run.stdout, new RegExp(`\\b3 denied, ${EXPECTED_ASK.length} ask\\b`));
      assert.doesNotMatch(run.stderr, /naming no tool/);
    }
  });

  test('a read that bills the account and a glob approves fails the gate (plugin beside this repo)', async (t) => {
    const pluginRoot = resolvePluginRoot();
    if (!pluginRoot || !existsSync(path.join(pluginRoot, 'data', 'vendor-tool-classification.json'))) {
      t.skip('hiveku-claude-plugin checkout absent');
      return;
    }
    const src = await fs.readFile(path.join(ROOT, 'src', 'knowledge.ts'), 'utf8');
    const gone = src.replace("  'mcp__hiveku__backlinks_summary',\n", '');
    assert.notEqual(gone, src, 'the mutation did not apply: the negative control would pass for the wrong reason');
    const dir = await tmp('hk-ask-gate-paid-');
    await fs.mkdir(path.join(dir, 'repo', 'scripts'), { recursive: true });
    await fs.mkdir(path.join(dir, 'repo', 'src'));
    await fs.mkdir(path.join(dir, 'hiveku-claude-plugin', 'data'), { recursive: true });
    await fs.copyFile(gate, path.join(dir, 'repo', 'scripts', 'check-permission-rules.mjs'));
    await fs.writeFile(path.join(dir, 'repo', 'src', 'knowledge.ts'), gone, 'utf8');
    await fs.copyFile(
      path.join(pluginRoot, 'data', 'vendor-tool-classification.json'),
      path.join(dir, 'hiveku-claude-plugin', 'data', 'vendor-tool-classification.json'),
    );
    const run = spawnSync(process.execPath, [path.join(dir, 'repo', 'scripts', 'check-permission-rules.mjs')], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /backlinks_summary bills the account and mcp__hiveku__\*_summary approves it unasked/);
    assert.doesNotMatch(run.stderr, /backlinks_bulk_pages_summary bills the account/);
  });

  test('an ask name that is also denied fails the gate', async () => {
    const run = await runGateOn((src) =>
      src.replace("    'Read(**/.env.local)',\n", "    'mcp__hiveku__ppc_enable_resource',\n    'Read(**/.env.local)',\n"),
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ppc_enable_resource is in HIVEKU_ASK and covered by the deny list/);
  });

  test('an ask name a deny glob covers fails the gate', async () => {
    const run = await runGateOn((src) =>
      src.replace("    'Read(**/.env.local)',\n", "    'mcp__hiveku__ppc_*_resource',\n    'Read(**/.env.local)',\n"),
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ppc_enable_resource is in HIVEKU_ASK and covered by the deny list \(mcp__hiveku__ppc_\*_resource\)/);
    assert.match(run.stderr, /ppc_platform_enable_resource is in HIVEKU_ASK and covered/);
    assert.doesNotMatch(run.stderr, /ppc_experiment_schedule is in HIVEKU_ASK/);
  });

  test('a glob in the ask array fails the gate', async () => {
    const run = await runGateOn((src) =>
      src.replace('const HIVEKU_ASK: string[] = [\n', "const HIVEKU_ASK: string[] = [\n  'mcp__hiveku__ppc_*_enable',\n"),
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ppc_\*_enable — an ask rule names one tool exactly/);
  });
});

describe('Autonomous mode copy', () => {
  // Ask rules prompt in every mode, bypassPermissions included, so the copy for
  // it must not promise that nothing asks, and must name both kinds of ask.
  test('the setting and the mode picker say turning ads or workflows on still asks', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const setting = pkg.contributes.configuration.properties['hiveku.claudeCodePermissionMode'];
    const bypass = setting.enumDescriptions[setting.enum.indexOf('bypassPermissions')];
    assert.match(bypass, /turn ads on or restart them and the ones that switch a workflow on, which always ask/);
    assert.doesNotMatch(bypass, /entirely/);
    assert.match(
      setting.markdownDescription,
      /tools that turn ads on or restart them \(and start spend\), and the ones that switch a workflow on, always ask first/,
    );
    const extensionSrc = await fs.readFile(path.join(ROOT, 'src', 'extension.ts'), 'utf8');
    assert.doesNotMatch(extensionSrc, /Skip ALL prompts/);
    assert.match(extensionSrc, /Turning ads or workflows on still asks/);
  });
});

describe('The ask list gates what the plugins gate', () => {
  const bare = (rule) => rule.replace(/^mcp__hiveku__/, '');

  test('adding keywords is left to the owner\'s yes in the skills, as in the plugins', async () => {
    const dir = await tmp('hk-ask-keywords-');
    await scaffoldAccount(dir);
    const { permissions } = await readSettings(dir);
    for (const name of ['ppc_keyword_add', 'ppc_platform_keyword_add', 'ppc_pause_resource', 'ppc_platform_pause_resource', 'workflow_disable', 'workflow_run']) {
      assert.ok(!permissions.ask.includes(`mcp__hiveku__${name}`), `${name} should not be an ask rule`);
    }
  });

  test('every ask rule names a tool the Claude Code plugin forces a prompt for (sibling checkout)', async (t) => {
    const pluginRoot = resolvePluginRoot();
    if (!pluginRoot || !existsSync(path.join(pluginRoot, 'lib', 'tool-safety.mjs'))) {
      t.skip('hiveku-claude-plugin checkout absent');
      return;
    }
    const { LIVE_CHANGE_WRITES, ALWAYS_ASK_WRITES, NEVER_AUTO_APPROVE, decideForPayload } = await import(pathToFileURL(path.join(pluginRoot, 'lib', 'tool-safety.mjs')).href);
    const critical = JSON.parse(await fs.readFile(path.join(pluginRoot, 'data', 'permission-critical-tools.json'), 'utf8'));
    const onAskList = new Set(critical.tools.map((tool) => tool.name));
    // hiveku_batch is the wrapper: the plugin does not list it, its hook asks on
    // any batch that carries one of the gated calls. Check that instead.
    const VERSION_TOOLS = ['project_vcs_rollback', 'project_vcs_resolve'];
    // A gated read (opening a sent email, reading a phone line's password) is asked by the plugin's
    // NEVER_AUTO_APPROVE on every direct call and inside a batch; the plugin's ask list carries writes only.
    // project_review_frame_url is one too: its answer holds a site's saved reviewer login, and the plugin asks for it
    // through NEVER_AUTO_APPROVE (plugin 0.27.207), not its always-ask maps. So is analytics_recording_get, whose answer
    // is one visitor's whole visit as they saw it on screen (plugin 0.27.219).
    const GATED_READS = [...EMAIL_CONTENT, ...SIP_PASSWORD, 'mcp__hiveku__project_review_frame_url', RECORDING_READ].map(bare);
    for (const name of GATED_READS) {
      assert.ok(NEVER_AUTO_APPROVE.has(name), `${name} is not on the plugin's NEVER_AUTO_APPROVE`);
      const direct = decideForPayload({ tool_name: `mcp__plugin_hiveku_hk__${name}`, tool_input: {} });
      assert.equal(direct?.hookSpecificOutput?.permissionDecision, 'ask', `the plugin hook does not ask on ${name}`);
      const batched = decideForPayload({ tool_name: 'mcp__plugin_hiveku_hk__hiveku_batch', tool_input: { calls: [{ tool: name, args: {} }] } });
      assert.equal(batched?.hookSpecificOutput?.permissionDecision, 'ask', `the plugin hook does not ask on a batch carrying ${name}`);
    }
    // Most lead list writes ask here only because the '*_list_*' read glob would approve them. The
    // plugin has no such glob: it leaves a write off its read-only list to the person's settings, as
    // it does crm_create_contact, and forces a prompt only for the runs that spend. So it must not
    // approve the others unasked.
    // The reads that bill ask here because the '*_summary' read glob would approve them. The plugin has no such glob:
    // its hook leaves them off the read list, so it must not approve them unasked. They are no writes, so they are not
    // on its ask list or in the batch checks below.
    const BILLED_READS = PAID_READS.map(bare);
    for (const name of BILLED_READS) {
      const direct = decideForPayload({ tool_name: `mcp__plugin_hiveku_hk__${name}`, tool_input: {} });
      assert.notEqual(direct?.hookSpecificOutput?.permissionDecision, 'allow', `the plugin hook approves ${name} unasked`);
    }
    const SPENDING_RUNS = ['outbound_lead_list_run_start', 'outbound_lead_list_run_control'];
    const GLOB_ONLY = [...LEAD_LISTS, ...FORMULA_FILL].map(bare).filter((name) => !SPENDING_RUNS.includes(name));
    for (const name of GLOB_ONLY) {
      const direct = decideForPayload({ tool_name: `mcp__plugin_hiveku_hk__${name}`, tool_input: {} });
      assert.notEqual(direct?.hookSpecificOutput?.permissionDecision, 'allow', `the plugin hook approves ${name} unasked`);
    }
    // The transfer authorization email goes through the strict checks below with the other forced writes
    // (review of #88). The plugin's ask list is not enough for it: INSTALL.md has each person paste that list
    // into their settings by hand, so an install pasted before the email existed would run it unasked under the
    // plugin's blanket allow. The plugin's hook forces it instead, as it does email_send, and a direct call
    // with real arguments must ask.
    for (const name of PORT_LOA.map(bare)) {
      const direct = decideForPayload({
        tool_name: `mcp__plugin_hiveku_hk__${name}`,
        tool_input: { port_order_id: '00000000-0000-0000-0000-000000000000', signer_email: 'signer@example.com' },
      });
      assert.equal(direct?.hookSpecificOutput?.permissionDecision, 'ask', `the plugin hook does not ask on a direct call to ${name}`);
    }
    // The Projects asks go through the same strict checks (the 0.27.163 review): plugin 0.27.163 had eight of them on
    // its ask list only, which an install pasted before that list never got, so they ran unasked under the plugin's
    // blanket allow. From plugin 0.27.165 its hook forces all thirteen, as it does every other rule checked below.
    const gated = EXPECTED_ASK.map(bare).filter((name) => name !== 'hiveku_batch' && !VERSION_TOOLS.includes(name) && !GATED_READS.includes(name) && !BILLED_READS.includes(name) && !GLOB_ONLY.includes(name));
    // The version tools are judged by the plugin hook's version rules (lib/vcs-tool-rules.mjs),
    // not its always-ask maps: a rollback dry run is allowed and an apply asks (an ask rule here
    // cannot read dry_run, so it asks always), and a conflict resolve always asks.
    const applyDecision = decideForPayload({ tool_name: 'mcp__plugin_hiveku_hk__project_vcs_rollback', tool_input: { project_id: 'p', commit_id: 'c', dry_run: false } });
    assert.equal(applyDecision?.hookSpecificOutput?.permissionDecision, 'ask', 'the plugin hook does not ask on a rollback apply');
    const resolveDecision = decideForPayload({ tool_name: 'mcp__plugin_hiveku_hk__project_vcs_resolve', tool_input: { project_id: 'p', branch: 'b', files: [{ path: 'a', choice: 'parent' }] } });
    assert.equal(resolveDecision?.hookSpecificOutput?.permissionDecision, 'ask', 'the plugin hook does not ask on a conflict resolve');
    for (const name of VERSION_TOOLS) {
      assert.ok(onAskList.has(name), `${name} is not on the plugin's permission-critical ask list`);
    }
    for (const member of gated) {
      const decision = decideForPayload({ tool_name: 'mcp__plugin_hiveku_hk__hiveku_batch', tool_input: { calls: [{ tool: member, args: {} }] } });
      assert.equal(decision?.hookSpecificOutput?.permissionDecision, 'ask', `the plugin hook does not ask on a batch carrying ${member}`);
    }
    const notForced = gated.filter((name) => !LIVE_CHANGE_WRITES.has(name) && !ALWAYS_ASK_WRITES.has(name));
    assert.deepEqual(notForced, [], 'the plugin hook does not force a prompt for these; one side is out of date');
    const notListed = gated.filter((name) => !onAskList.has(name));
    assert.deepEqual(notListed, [], "these are not on the plugin's permission-critical ask list");
    // And the plugins leave the keyword adds unasked, as this list does.
    for (const name of ['ppc_keyword_add', 'ppc_platform_keyword_add']) {
      assert.ok(!LIVE_CHANGE_WRITES.has(name) && !ALWAYS_ASK_WRITES.has(name), `the plugin now forces a prompt for ${name}`);
    }
  });
});
