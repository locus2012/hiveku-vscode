# Hiveku VS Code Extension — Capability Audit & Roadmap

A full E2E audit of what **Hiveku can do** (≈1,000 MCP tools across ~20 families)
versus what the **extension covers today** (v0.7.0), plus a sequenced roadmap to
full parity. Goal: nothing slips.

**Legend:** ✅ done · 🟡 partial (read-only or a few actions) · ❌ missing · 💬 covered generatively via department chat / Claude only

---

## 1. Where we are (honest summary)

The extension goes **deep in one corner and shallow everywhere else**:

- **Deep ✅** — Code projects + the Supabase-native VCS (commit/branch/merge/compare/history/conflict-detection), file download/sync, deploy, Fly preview, knowledge download + drift detection, department chat, multi-account + browser Connect, per-account Claude workspace, agency dashboard + account console + notifications.
- **Partial 🟡** — PM tasks, workflows, CRM, helpdesk, database, media, secrets (mostly read + a few actions).
- **Missing ❌** — almost all of Marketing (SEO/PPC/Social/Email/Content/Design), most Dev sub-systems (CMS, pages, Supabase, crons, domains, verify, shopify), Revenue closers (estimates/invoices/contracts/e-sign), Foundation panels (memory editor, integrations, analytics, hiveboards, calendar, KB, account health), Voice, and Mission Control.

Rough coverage of the *operable* surface: **~15–20%**, concentrated in Dev/VCS + Knowledge + Chat.

---

## 2. Surface strategy (how we decide what to build)

Not every capability deserves a bespoke VS Code UI. Decide per capability:

| Treatment | When | Examples |
| --- | --- | --- |
| **Bespoke UI** (tree/webview/SCM) | High-frequency operator actions; benefit from being local | tasks board, commit/branch, ticket reply, deal move, campaign send |
| **Read panel** (webview KPIs/lists) | Monitoring / "what's the state" | analytics, SEO rankings, campaign metrics, run logs, account health |
| **Deep-link** (`Open in Hiveku ↗`) | Heavy visual editors not worth rebuilding | design studio, hiveboard editing, page builder, complex campaign builder |
| **Chat / Claude** (💬) | Generative / strategic work | content drafting, SEO strategy, ad copy, persona building |

The win: a **generic panel + action framework** (one webview shell, one "call tool → render list/cards → act" pattern) so each new area is cheap, plus **profile-aware** connections so the right tools load per workspace.

---

## 3. Coverage matrix

### A. Revenue & Communications (CRM / Email / Outbound)
| Capability | Status | Note |
| --- | --- | --- |
| CRM contacts (list) | 🟡 | read in Console; ❌ create/update/merge/dedupe/score |
| CRM deals + pipeline (list/forecast) | 🟡 | read deals + summary; ❌ create/move stage, at-risk/stuck triage |
| CRM activities / touch history | ❌ | log calls/meetings/notes |
| CRM sequences (enroll/analytics) | ❌ | cold-outreach engine |
| Estimates → Invoices | ❌ | create/send/convert/templates |
| Contracts / e-signature envelopes | ❌ | send/sign/void/signers |
| Custom fields / tags / lead status | ❌ | |
| Email templates / signatures / inbox / threads | ❌ | |
| Lead triage (form → contact) | ❌ | high-value |
| GHL / HubSpot sync status | ❌ | |
| Email marketing (campaigns/audiences/sequences/templates/deliverability) | ❌ | entire family |
| Outbound campaigns / leads | ❌ | |
| Gmail / Calendar | ❌ | |

### B. Marketing & Growth (SEO / PPC / Social / Content / Design)
| Capability | Status | Note |
| --- | --- | --- |
| SEO audits / rank tracking / GSC / Bing / local / backlinks / reports | 💬 | chat only; no panels (`seo_*`, `dataforseo_*`, `serp_*`) |
| PPC campaigns / budgets / bids / metrics (Google/Meta/Bing/TikTok/LinkedIn) | 💬 | chat only (`ppc_*`) |
| Social posts / calendar / pillars / analytics | 💬 | chat only (`social_*`) |
| Content create / schedule / library | 💬 | chat only (`content_*`) |
| Brand guide / customer avatar / journey / before-after | 💬 | chat only |
| Design studio + exports | ❌ | deep-link candidate |
| AI image generation (`generate_image*`) | ❌ | |
| Analytics overview / pages / sessions / sources | ❌ | read-panel candidate |

### C. Build & Ship (Dev)
| Capability | Status | Note |
| --- | --- | --- |
| File download / save / snapshot / status / diff / versions / restore | ✅ | SCM + file history |
| Supabase-native VCS (`project_vcs_*`) | ✅ | commit/branch/merge/compare/history |
| Conflict detection ("you're behind") | ✅ | baseline + pre-commit guard |
| Deploy (dev/staging/prod) | ✅ | `deploy_site`; 🟡 no deploy history/status panel |
| Fly preview (open/sync/logs/screenshot) | ✅ | 🟡 no `preview_exec` |
| Secrets (list/set) | ✅ | |
| Database (status/tables) | 🟡 | ❌ query runner / describe |
| Supabase (auth/storage/edge funcs/migrations/policies/types) | ❌ | |
| Headless CMS (collections/entries/fields/scaffold) | ❌ | |
| Pages (CRUD/homepage) | ❌ | |
| Assets / media library (upload/folders/collections) | 🟡 | `assets_list` only |
| Crons / redirects / domains | ❌ | |
| Verify (lint / typecheck / tests) + build errors / test build | ❌ | |
| Checkpoints (list/restore) | ❌ | restore exists via file history only |
| Shopify / redesign | ❌ | |
| GitHub (`github_*`) | ⛔ | intentionally dropped — Hiveku VCS replaces it |

### D. Service & Operations
| Capability | Status | Note |
| --- | --- | --- |
| PM tasks (list/complete/create) | 🟡 | ❌ update/move/subtasks/comments/attachments |
| PM milestones / recurrence | ❌ | |
| Workflows (list/run/enable/disable/recent runs) | 🟡 | ❌ run logs/node debug, triggers, schedules, node/edge edit, templates, versions |
| Helpdesk tickets (counts) | 🟡 | ❌ reply/assign/status/escalate/merge |
| Helpdesk KB / macros / queues / CSAT | ❌ | |
| Mission Control (`mc_*`: tasks/lanes/SLA/intake/decisions) | ❌ | the ops backbone |
| Voice (calls/numbers/IVR/extensions) | ❌ | mostly read |

### E. Foundation & Insight (cross-cutting)
| Capability | Status | Note |
| --- | --- | --- |
| Department chat (`talk_to_department`) | ✅ | ~13 domains |
| Knowledge download (memory/skills/rules) + drift sync | ✅ | read/download |
| Memory CRUD + version history + push-back UI | 🟡 | only via chat/Claude; no editor/versions panel |
| Account context hydration (`account_context_get`) | ❌ | partially baked into CLAUDE.md |
| Account health / audit trail | ❌ | |
| Analytics | ❌ | (also in B) |
| Integrations + BYO OAuth apps (`integration_*`, `oauth_app_*`) | ❌ | connect Google/Bing/DataForSEO |
| Knowledge bases (`kb_*`) search/CRUD | ❌ | |
| Hiveku docs / playbooks search | ❌ | great for Claude |
| Hiveboards (sitemaps/boards) | ❌ | deep-link candidate |
| Calendar / discussions / rooms | ❌ | |

---

## 4. Roadmap (sequenced)

Each phase reuses a shared **panel + action framework** (build once, in Phase 1).

### Phase 0 — Framework (enables everything cheaply)
- Generic **resource webview** shell (tabs, lists, cards, action buttons → MCP tool) and a generic **tree-section** helper.
- **Memory editor** (cross-cutting): edit a local knowledge `.md` → `memory_update`; version history (`memory_list_versions` / `memory_restore_version`); push/pull. This closes the knowledge loop everyone depends on.
- Profile-aware client + `Open in Hiveku ↗` deep-link helper.

### Phase 1 — Deepen Operations (finish what's started)
- **PM**: drag-between-status board, update/subtasks/comments/milestones/recurrence.
- **Workflows**: run logs + per-node debug (`workflow_run_get`), triggers, schedules, enable/disable, run-from-template.
- **CRM operate**: deal create + stage move, contact create/update, activities, sequence enroll + analytics, lead triage, at-risk/stuck queues.
- **Helpdesk operate**: ticket list → reply/assign/status/escalate, KB suggest, queues, overdue/CSAT.
- **Mission Control**: tasks/lanes/SLA/next/intake/decisions surfaced (the ops backbone).

### Phase 2 — Marketing read + act panels
- **Analytics** panel (overview/pages/sessions/sources).
- **SEO** panel (tracked rankings, audits, GSC/Bing, content gaps, reports/deliverables).
- **PPC** panel (campaigns, budgets/bids, metrics, recommendations, anomalies).
- **Email marketing** (campaigns/audiences/sequences/templates/metrics/deliverability).
- **Social** (calendar, posts, publish, analytics).
- **Content** (create/schedule, link PM tasks). Generative bits stay 💬.

### Phase 3 — Dev depth
- **Database query runner** + describe; **Supabase** (auth/storage/edge funcs/migrations/policies/types).
- **CMS** (collections/entries/fields/scaffold), **Pages**.
- **Verify** (lint/typecheck/tests) + build-error surfacing + `project_test_build`.
- **Crons / redirects / domains**, **media library** (upload/folders/collections), **checkpoints** panel, deploy **history/status**, **shopify**, **redesign** (deep-link).

### Phase 4 — Foundation & collaboration
- **Integrations + OAuth** manager (connect/test/initiate).
- **Account health** dashboard (audit trail, drift, decision queue, integration status).
- **KB** search/CRUD; **Hiveku docs/playbooks** inline search (boosts Claude).
- **Hiveboards** (deep-link + minimap), **calendar**, **discussions/rooms**.

### Phase 5 — Revenue closers & creative
- **Estimates → Invoices → Contracts/e-sign** (the quote-to-cash flow).
- **Design studio / image generation** (deep-link + `generate_image` quick action).
- **Voice** (call log + numbers/IVR read; diagnose).

---

## 5. Cross-cutting principles
- **Per-account isolation**: every panel/action runs against the active account's client; the agency dashboard rolls up; "Open Account as Workspace" gives Claude a scoped window.
- **Reuse, don't rebuild**: one webview shell + one action pattern; deep-link the heavy editors; let Claude do generative work.
- **Defensive rendering**: tool response shapes vary — every panel tolerates missing fields and surfaces "unavailable" rather than breaking.
- **Live-validate field mappings**: confirm response shapes against a real account as each panel ships (the known caveat across v0.5–0.7).

---

*Generated from a 5-cluster capability audit of `olympus-tools.ts` / `profiles.ts` / `departments.ts`. Current coverage reflects extension v0.7.0.*
