# PPC memory protocol: read-merge-write, or you wipe the account's history

## What this covers / when to load this

The full protocol for persisting PPC state into Hiveku account memory without destroying it. Load it
before ANY `memory_create` / `memory_update` call in a PPC session - end-of-session persists, the
onboarding baseline, the monthly-report summary. SKILL.md carries the three-line rule; this file
carries the mechanics, the recovery path, and what belongs in the document.

## The protocol

There is ONE `ppc` memory document and `memory_update` REPLACES it, so every write below is
read-merge-write: `memory_list({ domain: "ppc" })`, append to the `content` it returns, then
`memory_update({ memory_id, content })` with the whole merged body. A bare note wipes the
account's PPC history - including the protected-campaign list this skill depends on.
`memory_create({ type: "memory", name: "ppc", content })` only on the first run (409 = exists).
Recover a clobbered document with `memory_list_versions({ memory_id })` then
`memory_restore_version({ version_id })`. One catch on the read: `memory_list({ domain: "ppc" })`
returns ACCOUNT-level rows only. A project-scoped document needs
`memory_list({ domain: "ppc", project_id })` or `include_project_scoped: true`. Skip that and the
account looks empty, you `memory_create` a second document, and the PPC history splits in two.

`memory_update` takes only `memory_id` and `content` (no `type`/`name`).

## The two moments people get this wrong

Both of the natural persist moments - end of onboarding ("confirm the client's monthly budget
ceiling and target CPA/ROAS; persist them") and end of the monthly report ("persist the summary so
the next session inherits the state") - tempt a bare `memory_create`. On any account past its first
session that call either 409s or, with a variant name, splits the history in two. At BOTH moments
the write is the read-merge-write above: `memory_list` first, merge, `memory_update`. `memory_create`
is correct exactly once per account, and 409 is its way of telling you the account already has a
history you were about to orphan.

## What belongs in the document

Five to ten lines per session, appended, dated: connection ids with platform and currency; the
client's monthly ceiling and target CPA/ROAS per platform; approval thresholds; protected campaigns
and sacred geos or keywords; conversion action ids trusted for bidding and the id the offline loop
uploads against, with the last uploaded outcome date; audience/list ids uploaded to and current match
rates; tests running and their end dates; open decisions awaiting the client. No PII, ever.
