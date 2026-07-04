/**
 * The automation playbook written into every Hiveku workspace (.claude/AUTOMATION.md)
 * so Claude Code uses scheduling / loops / background work the PROPER way — framed
 * for the dev, marketer, sales, and outbound-BDR roles, including Smartlead + HeyReach.
 * Mechanics verified against the Claude Code docs (scheduled-tasks / routines / loop /
 * tools-reference).
 */
export const AUTOMATION_GUIDE = `# Scheduling, loops & background work — the proper way (Claude Code)

Pick by **what triggers it** and **what it costs**. Default to event-driven + local; reach for cloud
routines only rarely (see "Cost & scale" — they bill against your Claude plan AND a routine cap).

| Trigger | Use | Runs on | Claude usage |
|---|---|---|---|
| **An event happens** (a reply, bounce, form fill, push) — the BEST default | **Webhook → a receiver in your Hiveku project**, then a **persistent Monitor** that wakes Claude only on a new event | receiver = your deployed app (always-on); Monitor = your machine, this session | ~**1 turn per real event** (the poll/shell is free) |
| "Wake me when THIS finishes" (a build, sync, deploy, long query) | **Bash \`run_in_background\`** (or **Monitor** to stream) | your machine, this session | 1 turn on completion |
| "Every N minutes WHILE I'm working" (poll until done) | **\`/loop 15m <prompt>\`** or **\`/loop <prompt>\`** (self-paced) | your machine, this session | 1 turn **per fire** (even when nothing changed) |
| **Unattended + recurring + FREE at scale** (hundreds across clients) | **OS cron / launchd + a worker script** Claude Code writes (\`claude -p\` only when judgment is needed) | your machine — runs with VS Code **closed** and across **reboots** | **0** (unless the script calls \`claude -p\`) |
| "Unattended, but you want it in Anthropic's cloud" — **rarely** | **\`/schedule\`** (cloud routine) | Anthropic cloud (headless) | 1 turn per fire, **+ daily routine cap** |

Rules of thumb:
- **Reacting to events (replies, leads, webhooks)** → webhook + a persistent Monitor wakeup. The Monitor's poll runs in the shell (free); Claude is only invoked when a real event lands, so cost tracks *events*, not *checks*.
- **Watching one thing finish this session** → background task / Monitor.
- **Repeating while you're at the keyboard** → \`/loop\` (minute cadence; dies on window close, restored on \`--resume\`, 7-day expiry). Note it spends a turn on *every* fire.
- **Truly unattended + low frequency** (e.g. one weekly report) → \`/schedule\` — but see the cost note; don't use it for high-volume or per-client cadences.

## Cost & scale — prefer webhooks + local wakeups over cloud routines
\`/schedule\` cloud routines run Claude in Anthropic's cloud: **every fire is real, plan-billed Claude
usage, and recurring routines also count against a daily routine cap.** At any kind of scale (many
clients × many cadences = hundreds of automations) that is expensive and will hit the cap. So:
- **Don't** stand up a cloud routine per client / per campaign for reply-triage or polling.
- **Do** let **webhooks + your deployed Hiveku project** do the always-on, free work (no Claude turn per
  event unless you choose to route one), and use a **persistent Monitor** in an open session to wake
  Claude only for the parts that need judgment (drafting a reply, classifying an ambiguous lead).
- Reserve \`/schedule\` for the occasional genuinely-unattended, low-frequency job — if at all.

## Persistent LOCAL automation, no cloud cost (OS cron / launchd) — the answer for "hundreds, local"
Claude Code's built-ins are either cloud (\`/schedule\` — costs + cap) or session-bound (\`/loop\` and even
durable \`CronCreate\` still need a Claude session open). For unattended, recurring work across MANY
clients with zero cloud cost, have Claude Code set up a **real OS-level scheduler that runs a plain
SCRIPT**, independent of any Claude session:
- **macOS:** a \`launchd\` LaunchAgent (\`~/Library/LaunchAgents/com.<you>.hiveku-<name>.plist\` with
  \`StartCalendarInterval\` / \`StartInterval\`, then \`launchctl load\`).
- **Linux:** a \`crontab\` line or a \`systemd --user\` timer.
- **Windows:** Task Scheduler (\`schtasks /create …\`).

The scheduled script (Node / Python / bash) does the deterministic work directly — call the
Smartlead/HeyReach REST APIs + the **Hiveku Olympus REST API** (key in the script's env) to pull replies,
push leads, write CRM, send a digest. **That spends ZERO Claude usage — it's just code.** When a step
genuinely needs Claude's judgment (draft a nuanced reply, classify an ambiguous lead, summarize), have
the script invoke Claude **headlessly**: \`claude -p "<prompt>"\` (one-shot, non-interactive) — Claude is
used only on that call, only when run. So:
- **Free + persistent**: survives VS Code closing AND reboots; no cloud routine, no per-fire Claude cost.
- **Scales**: hundreds of automations are just cron/launchd entries + small worker scripts.
- Use Claude Code to GENERATE the scheduler entry + the worker script for each automation; the OS runs them.

This is the preferred home for the marketer/sales/BDR cadences below — pair it with webhooks (event
capture) and reserve in-session \`/loop\`/Monitor for when you're actively working.

### The built-in framework (run "Hiveku: New Local Automation", then CRUD via the CLI)
That command scaffolds an \`automations/\` folder: ONE launchd/cron entry runs \`dispatcher.mjs\` every
minute, which reads \`registry.json\` and runs each due + enabled worker. The Hiveku key is pre-filled
from \`.mcp.json\`. **CRUD automations by managing the registry via the CLI — no per-job OS work:**
\`\`\`bash
node automations/manage.mjs install                                  # once: add the single OS scheduler entry
node automations/manage.mjs list                                     # READ every automation + last run
node automations/manage.mjs create --id reply-triage --cron "17 9-17 * * 1-5" --worker reply-triage --desc "…"
node automations/manage.mjs update  --id reply-triage --cron "*/30 9-17 * * 1-5"
node automations/manage.mjs enable|disable|delete|run --id reply-triage
node automations/manage.mjs status | uninstall
\`\`\`
\`create\` scaffolds \`workers/<name>.mjs\` (copy of the example) — edit it to do the work. Helpers in
\`automations/lib.mjs\`: \`hiveku(tool,args)\` (any Hiveku MCP tool, FREE), \`http(url,opts)\` (Smartlead/HeyReach
REST), \`claudeP(prompt)\` (one-shot Claude, used ONLY when called), \`loadSeen/saveSeen(id)\` (idempotency).
Add \`SMARTLEAD_API_KEY\` / \`HEYREACH_API_KEY\` to \`automations/.env\` (gitignored).

## The recommended pattern: webhook → sink → Monitor wakeup (recurring, event-driven, cheap)
1. **Always-on, zero Claude cost:** register the platform's webhook (Smartlead/HeyReach fire on
   reply/bounce/etc.) pointing at an \`/api/webhook\` route in your **deployed Hiveku Next.js project**.
   That route writes the event straight into a **sink** — Hiveku CRM (\`crm_*\` / \`outbound_update_lead\`
   via the Olympus API) or an \`agent_ops_inbox\`/queue table — with deterministic logic (or one cheap
   classify). This runs 24/7 on Hiveku infra and never spends a Claude turn.
2. **Claude only for judgment, only while you're working:** start a **persistent Monitor** whose script
   polls the sink for new *unprocessed* events (e.g. every 30–60s) and emits ONE line per new event.
   The polling is shell/SQL (free); each emitted line wakes Claude (1 turn) to draft a reply for your
   approval, then mark the event processed so it isn't re-emitted.
3. Result: **recurring + event-driven + minimal Claude usage**, all local (no cloud routine, no per-fire
   waste). Caveat: a Monitor is session-bound — it stops when VS Code closes; the webhook receiver keeps
   capturing regardless, so nothing is lost, and Claude catches up next time you open the session.

## Cron quick reference (\`/schedule\` and CronCreate)
5 fields, **local time**: \`minute hour day-of-month month day-of-week\`.
- \`0 9 * * 1-5\` = weekdays 9am · \`*/15 * * * *\` = every 15 min · \`30 14 15 3 *\` = Mar 15 2:30pm once.
- One-off reminder: "schedule tomorrow at 3pm …" (fires once, then auto-disables).
- **\`/schedule\` minimum interval is 1 hour**; for sub-hour cadence use \`/loop\` (in-session).
- **Pick off-minutes** (\`:07\`, \`:23\`) not \`:00\`/\`:30\` — everyone's "9am" lands at the same instant and gets jittered; an odd minute fires on time.

## ⚠️ The Hiveku + headless-routine gotcha (read before scheduling)
A **cloud routine runs a FRESH CLONE, headless, with NO interactive auth** — it only gets the MCP servers/connectors you explicitly add to the routine. This extension **gitignores \`.mcp.json\`** (so your inlined key never gets committed), which means **a routine's clone won't have the \`hiveku\` MCP**. So:
- **In-session** (\`/loop\`, background tasks): the \`hiveku\` tools + your connected account work normally — use these freely.
- **Cloud routine** (\`/schedule\`): either (a) add the **Hiveku connector** to the routine, or (b) have the routine hit the **Hiveku Olympus REST API** + **Smartlead/HeyReach REST APIs** with keys placed in the routine's **env/secrets** (never interactive, never committed in code).
- Routines act on the account your key is pinned to — call \`get_account_info\` first to confirm you're on the right account.

---

## Patterns by role

### Dev
- **Watch a deploy to live**: start a background poll of the deploy status; get pinged when it's terminal (live/failed). Don't sit and re-check.
- **Nightly health**: \`/schedule\` weekdays ~2am → \`verify_typecheck\` + \`verify_lint\` + \`verify_run_tests\` + \`project_test_build\`; alert only on failures.
- **Long migration / build**: \`/loop <prompt>\` (self-paced) until the job reaches a terminal state, then stop.

### Marketer (SEO / AEO / ads / content)
- **Weekly SEO+AEO refresh**: \`/schedule\` Mon ~7am → \`seo_run_audit\` + \`seo_aeo_audit_run\` → summarize ranking movers + AI-Overview gaps.
- **Daily ad guardrails**: \`/schedule\` weekdays ~9am → \`ppc_pacing_summary\` + \`ppc_anomaly_check\` + \`ppc_disapprovals_list\` + \`ppc_conversion_tracking_status\` → alert on overspend / disapprovals / silent conversions.
- **Content calendar**: \`/schedule\` → \`content_list\` (scheduled) → flag gaps; draft via \`talk_to_department({domain:'content'})\` then persist with \`content_create\`.

### Sales
- **Daily pipeline digest**: \`/schedule\` weekdays ~8am → \`crm_pipeline_stage_summary\` + \`crm_deals_at_risk\` + \`crm_deals_stuck\` + \`crm_forecast_weighted\` → one digest.
- **Stale-deal nudges**: \`/schedule\` → \`crm_deals_stuck\` → draft a tailored follow-up per deal (don't auto-send unless told).
- **Inbound lead watch (while working)**: \`/loop 20m\` → \`crm_lead_triage({query})\` to sweep the inbox for new leads → dedupe → \`crm_contact_upsert_by_email\`.

### Outbound BDR — Smartlead (email) + HeyReach (LinkedIn)
Neither has an MCP server, so call their **REST APIs** with a key from project secrets/env (never in code/commits):
- **Smartlead**: \`https://server.smartlead.ai/api/v1/...?api_key=…\` — campaigns, leads, sequences, email-accounts, analytics, **webhooks** (fire on reply/bounce/unsubscribe).
- **HeyReach**: \`https://api.heyreach.io/...\` with an \`X-API-KEY\` header — LinkedIn campaigns, accounts, lists, leads, webhooks.
- A **native two-way Smartlead↔HeyReach sync** exists — prefer it to move leads between email and LinkedIn; use Claude Code for the orchestration, CRM sync, and reporting around it. Always check each platform's live API docs for exact endpoints before calling.

The cadence — run the scheduled pieces as **local cron / launchd worker scripts** (free + persistent;
see the OS-cron section), capture replies via **webhooks**, and mirror everything into Hiveku so it's
tracked + reportable. Call \`claude -p\` from a worker only for the judgment steps.
- **Morning lead push** (cron worker, weekdays ~8:08am) → pull the day's target leads → add to the
  Smartlead campaign + the HeyReach LinkedIn campaign → mirror each into Hiveku (\`outbound_create_lead\`
  + \`crm_contact_upsert_by_email\`) → send yourself a digest. Pure API work — no Claude turn needed.
- **Reply capture (event-driven)** → Smartlead/HeyReach **webhooks** → an \`/api/webhook\` route in your
  deployed Hiveku project writes the reply into CRM / a queue (\`crm_*\`, \`outbound_update_lead\`). Free,
  always-on, no Claude turn per event.
- **Reply triage (judgment)** → a **persistent Monitor** (while you're working) OR a cron worker that
  invokes \`claude -p\` only when a new positive reply lands → classify → \`crm_contact_upsert_by_email\` +
  \`crm_create_deal\` + \`crm_create_activity\` + \`outbound_update_lead({is_interested:true})\`, and draft a
  reply for approval. (Hiveku's \`crm_lead_triage\` also sweeps the connected inbox — Smartlead included.)
- **Weekly report** (cron worker, Mon ~7:03am) → Smartlead + HeyReach analytics → CRM rollups →
  reply-rate / positive-rate / meetings-booked summary (a \`claude -p\` call if you want it written up).
- **List hygiene** (cron worker) → dedupe + sync suppression (\`crm_get_dnc_status\` / \`crm_set_dnc\`) so a
  Do-Not-Contact is never emailed or messaged.

---

## Safety (always)
- **Idempotency**: a scheduled send/push must dedupe — check state (or use an idempotency key) so a lead is never double-enrolled or re-emailed on the next fire.
- **Rate limits**: Smartlead, HeyReach, and LinkedIn enforce strict daily caps — respect them; never blast. LinkedIn especially will restrict an account that over-sends.
- **Secrets are headless-safe**: routines have no interactive login — API keys must live in the routine's env/secrets, never pasted in code or committed.
- **Confirm the account**: \`get_account_info\` before acting; routines hit whatever account the key is pinned to.
- **Don't auto-send the irreversible without sign-off** unless explicitly told — draft, then let a human approve emails/DMs.
- **Cron hygiene**: off-minutes; remember \`/loop\` auto-expires after 7 days while \`/schedule\` routines persist indefinitely.
`;
