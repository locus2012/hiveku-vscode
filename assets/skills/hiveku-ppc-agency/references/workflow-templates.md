# PPC workflow templates: install the recurring plays instead of re-deriving them

## What this covers / when to load this

The shipped workflow templates that automate the weekly PPC plays, and the install mechanics. Load it
when putting a retainer account on the recurring cadence, when asked to "automate" a PPC play, or when
auditing which templates an account already runs. SKILL.md's weekly checklist carries the one-line
pointer; this file carries the roster and the traps.

## The roster

**Install the recurring ones instead of re-deriving them.** These plays ship as workflow templates -
`weekly-search-terms-negatives` and `weekly-bing-wasted-spend` (an AI step classifies up to 3
wasted terms into fixed negative-add slots),
`search-terms-ai-triage` and `bing-search-terms-ai-triage` (the agent classifies every term with
campaign context and stages the whole list as ONE ops-inbox item, `auto_apply` OFF),
`disapproval-triage`, `monthly-impression-share-review`, and `monthly-budget-reallocation-review`
(an emailed brief; nothing is applied, you apply via the guardrailed budget tools).
`workflow_templates_list` → `workflow_create_from_template({ slug, overrides })`
installs one per client, and **every PPC write inside them stages to approval and never auto-applies**.
Do this on a retainer account rather than performing the same steps by hand every Monday. Pass
`is_enabled: false`: the install is created switched off, and `workflow_enable` switches it on after the
operator says yes. Full manual: the `hiveku-automation-agency` skill.

## The traps

- **An install starts switched off, and only `workflow_enable` turns it on.** Pass `is_enabled: false`
  (the only value the tool accepts; until late September 2026 it created the workflow switched ON by
  default, so an older note that says so is out of date). Review and dry-run the install, then call
  `workflow_enable` once the operator says yes - the same one-change-one-confirmation rule that governs
  every other write. The plugin asks before `workflow_enable` too.
- **Staged-approval is the rail, not a decoration.** The templates stage PPC writes to the ops inbox
  for human approval. Never flip `auto_apply` on (or override a template to bypass its staging) to
  "save the client time" - that converts a reviewed play into an unattended mutation loop, which is
  exactly the shape of change this skill exists to prevent.
- **Automate the data collection and the diffing; keep the interpretation on-demand and
  human-checked.** A template that mines terms and stages negatives is right; one that would apply
  budget moves unattended is not, and none of the shipped ones do.
- One template instance per client account. Re-installing on an account that already runs one
  duplicates the cadence; list what is installed before adding.
