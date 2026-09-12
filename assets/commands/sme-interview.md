---
description: "\"Get the lab director on record for the pricing post\" / \"here's the transcript from the call with our engineer\" / \"we need real quotes, not marketing copy\" - the expert interview: questions generated from the brief and the proof pack, a pasted transcript or a voice call id, quotable lines pulled verbatim with attribution and stored on the item as the sources the draft cites. Nothing publishes; the sources are the deliverable."
argument-hint: "<content id> [a pasted transcript, or call:<voice call id>]"
---
Expert interview for $ARGUMENTS. Follow the **hiveku-content-agency** skill; load
`references/research-and-proof.md` (the research stamp, the proof pack, the `settings.sources[]`
contract). Context: `account_context_get({ domain: "content" })`. The rule: an expert's words reach
the page verbatim, with a name and a role the expert agreed to, or not at all.
1. **The row and what it already has.** `content_get({ content_id })`: the brief on the row
   (`title`, `target_keyword`, `customer_avatar`, `journey_stage`, `before_after_grid`), the body
   or outline as it stands, `settings.research` (the run's `gaps[]` and `claims_count`; when the
   stamp is missing or older than 30 days, run `content_research_run({ content_id })` first - the
   interview should fill what the web could not, not repeat it) and any `settings.sources[]`
   already stored (ids taken, lines already on record). A row with no `avatar_id` or no
   `journey_stage` is not briefed yet: send it back to Play 2 before spending an expert's hour.
2. **What the piece still needs.** `content_proof_pack({ avatar_id, journey_stage, keyword:
   <target keyword> })` - the `phrases[]` are the customer's own words for the pain, the
   `objection` entries are what the expert must answer, and an H2 with no `consent: true` entry
   behind it is a section the interview has to prove. List, per planned H2: the claim the draft
   wants to make, whether the research run sourced it (`claims[].source_url`), and whether the
   pack proves it. The unsourced, unproven claims are the interview.
3. **The questions, through the department.** `talk_to_department({ domain: "content", message })`
   carrying the brief, the gap list from step 2 and the objections, asking for 8 to 12 questions,
   each naming the claim or H2 its answer would source, in the avatar's vocabulary, open-ended
   ("walk me through what happens when...") and never leading ("would you say it saves 40 percent?").
   No question whose answer is already sourced; one question that invites a number the expert
   can stand behind, with its baseline; one that invites a story. Read the list back against the
   gap list yourself: a question that sources nothing is cut.
4. **STOP: hand the questions over.** The operator runs the interview (or forwards the questions
   to the expert); nothing else happens until the answers arrive as a pasted transcript or a
   `call:<id>`.
5. **Reading a call.** `voice_call_get({ id })` for `has_transcript` (and `peer_name`,
   `started_at`, `duration_seconds` for the attribution and the date); then
   `voice_call_transcript_get({ id })`, which returns the whole transcript inline as one string,
   verbatim and unredacted - names, addresses, card numbers, health and financial detail all
   appear, and the handler applies no consent or retention check of its own. So: the expert's
   words about the subject are what you read; a customer's or a third party's details are never
   lifted; a call the expert did not know was being recorded is not a source until they say it is
   (ask before extracting). 404 `no_transcript` means the post-process has not written one yet:
   say so, offer the pasted transcript, never summarise from `ai_summary` as if it were speech.
6. **Extract the quotable lines.** For each line worth keeping: the `quote` verbatim (an
   ellipsis for an omitted clause, never a rewrite; a filler word may be dropped only where it
   changes no meaning, and the operator sees the raw line beside it), what it `supports` (the claim
   or H2 from step 2), and the attribution as it will appear (`Jane Doe, lab director, Acme
   Testing`). A figure the expert states is a claim with the expert as its source and the
   `[source: interview:<id>]` citation beside it. A line that contradicts a research claim is a
   finding for the operator, not a choice you make. A line the expert asked to keep off the record
   is not extracted at all. Six to twelve lines is a good interview; forty is a transcript.
7. **STOP: present the lines.** Each with its attribution, what it supports and the raw line
   beside any trimmed one. The expert's name and role are shipped copy: get the yes on exactly how
   they appear and on every line before anything is written.
8. **Store them on the row.** `content_get` first (the settings PATCH merges top-level keys but
   REPLACES `sources` whole), append to the array it returns with ids `interview-<n>` that
   continue the sequence, then `content_update({ content_id, settings: { sources } })` with the
   whole array: `{ id, kind: "interview", quote, attribution, supports, source_ref: "call:<id>" |
   "transcript:<date>", captured_at, on_record: true }` per line. Read the echo's `settings.sources`
   back and count the entries; an echo without them means the write did not land - say so.
9. **How the department uses them.** The Play 3 brief you hand `talk_to_department` carries every
   entry (quote, attribution, what it supports), so the draft quotes each verbatim under the H2 it
   supports and cites it `[source: interview:<id>]`; `content_seo_check` accepts that citation, so
   an expert's figure passes the decision-stage `claims_without_source` rule with its attribution
   visible, and a quoted section counts for `proof_per_section`. The department never edits a
   quote; a line that needs shortening is quoted in part. Say what is next: the draft (Play 3 step
   2) with the sources in the brief, then the gate.
10. The memory line: `memory_list({ domain: "content" })`, append who was interviewed, for which
    piece and on what date to the standing note, `memory_update({ memory_id, content })` with the
    WHOLE merged document (sending only the new note destroys everything else); `memory_create`
    only when no content note exists. Hiveku, not this chat, is the source of truth.
