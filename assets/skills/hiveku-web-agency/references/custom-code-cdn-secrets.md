# Custom Code, CDN, Crons, and Secrets

The full mechanism behind Play 10. Load this before touching injected scripts, CDN
invalidation or configuration, scheduled functions, or project secrets.

## Custom code (tags, chat widgets, verification meta)

- READ FIRST with `project_custom_code_get` - it returns `run_in_preview` plus every
  tier's entries, where the row with `page_path: ""` is that tier's site-wide code and
  every other row is a per-page override that APPENDS after it.
- `project_custom_code_set_tier({ project_id, tier, head_code, body_code, pages })` is the
  full writer, and it REPLACES that tier in full: **any per-page override missing from
  `pages` is DELETED**. Always read-then-merge, never write `pages` from memory. It
  validates server-side and fails with details on an unclosed script/style/comment.
  Snippets cap at 20,000 chars each. Tier enum is preview | development | staging |
  production.
- `project_custom_code_page_set` upserts ONE page override without touching the rest of
  the tier - prefer it for a single-page change. `project_custom_code_delete({ entry_id })`
  removes one row.
- **Saved is not live.** Custom code is saved instantly but takes effect on the NEXT
  DEPLOY of that tier. That is the whole of the "I added the GTM tag and it is not on my
  site" ticket - tell the client the deploy is required. The preview tier additionally
  runs nothing until `project_custom_code_preview_toggle({ run_in_preview: true })`, which
  is off by default so tracking snippets do not fire while editing.
- Prefer a prebuilt integration over raw third-party script when one exists.

## CDN inspection and invalidation

- `project_cdn_config_get` to inspect the deployed distribution's actual configuration
  for a tier (origins, attached viewer functions, policies) when a site serves wrong and you
  need facts rather than a verdict. `project_cdn_invalidate` after a deploy that changed a
  cached asset behind an unchanged URL. If a deploy "did not take" visually, suspect the CDN
  cache before the build. Invalidation rules, because it bills the ACCOUNT:
- Send `/*`. It counts as ONE path and covers the whole site; enumerating paths is how an
  agency running many client projects bills itself.
- The free quota is 1,000 invalidation paths per month per ACCOUNT, shared across every
  client project on it. Paths cap at 25 per call and each must start with `/`.
- Never call it in a retry loop - propagation is usually under a minute.
- Skip it entirely for `_next/static` hashed bundles. They get a new URL every build.
  Invalidation is only for files replaced in place at the same path: images, fonts,
  documents.

## Scheduled functions (crons) - the full lifecycle

Scheduled jobs the site needs (nightly rebuilds, data refresh):
- `project_crons_list` to see them, `project_cron_create` to add one (confirm schedule and
  target with the user before creating).
- `project_cron_update` - edits a scheduled function; the allow-listed fields are
  `enabled`, `schedule_expression`, `timezone`, `description`. Changes to
  `schedule_expression` or `enabled` automatically re-sync the EventBridge rule.
- `project_cron_toggle` - the PROJECT-LEVEL switch: enables/disables the cron feature and
  chooses which environments execute schedules (`{ enabled, environments?: ["production",...] }`).
  When disabled, ALL schedules pause regardless of their individual enabled flag - check it
  before diagnosing "my cron never fired" one schedule at a time.
- `project_cron_run` - manually invoke a scheduled function NOW, one-shot and off-schedule,
  returning the synchronous Lambda response. The "trigger this once to backfill" tool -
  no cron-expression edit needed. Optional `environment` defaults to production. It runs
  the real function against the real tier: confirm before firing anything with side effects.
- `project_cron_logs` - recent execution rows (timestamp, status success|failure|timeout,
  duration_ms, error message; limit defaults to 50). The oracle for "why isn't this cron
  running cleanly" - read it before touching the schedule.
- `project_cron_delete` - deletes the scheduled function row AND tears down its EventBridge
  rule. Destructive; confirm, and prefer `project_cron_update({ enabled: false })` when the
  client may want it back.

## Secrets

- `project_secrets_list({ metadata_only: true })` for names only (never echo values; keys
  marked sensitive are write-only and cannot be read by anyone, so a key in
  `sensitive_keys` IS set, not missing) and `project_secrets_set` for keys the site's server
  code needs. Config only; never hardcode a feature flag as an env var, and never put a
  secret value in a commit, log, or report.
- **A secrets write BOUNCES the live preview machine** (stop -> updateMachine -> start,
  about 11s of downtime) so the dev server sees the new values. Setting five secrets in a
  loop restarts the client's preview five times. Batch them: pass
  `apply_to_preview: false` on every call but the last. Confirm propagation by reading
  `preview_env_applied` + `preview_env_apply_reason` (`no_preview_machine`,
  `only_non_dev_keys_set`, or a Fly error) on the response.
- Key resolution for the preview: `_DEV`-suffixed keys are stripped to the base name;
  `_PROD` / `_PRODUCTION` / `_STAGING` keys are SKIPPED for the preview and go only to the
  deployed Lambdas. Any `NEXT_PUBLIC_` key auto-triggers a `preview_sync` afterwards
  because it is inlined at compile time - check `preview_synced` in the response.
