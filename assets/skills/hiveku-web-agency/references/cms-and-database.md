# The CMS and the Project Database

The manual behind Play 3 and Play 4 of the web-agency skill. Load it before you create a CMS collection, author or migrate entries, refactor a page to read from content, render a collection-backed form, provision a project database, write a table, or wire a form to storage. The skill says which tool to call; this file says what the file-based CMS contract is, why the `isLive` filter is written exactly as it is, the one mistake that makes a collection worthless to the customer, and why a contact form must never touch a database. A star marks a load-bearing rule: it fails silently, and the customer finds it before you do.

---

## Part 0: the rules that prevent damage

**DO**

1. Write CMS entries through the CMS tools, one call at a time, sequentially.
2. Copy the `isLive` filter exactly as written, `publishAt` clause included, with truthy checks.
3. In the same turn you create a collection, refactor the page to render from it and delete the hardcoded data it replaces.
4. Ask before building a collection when the request is a set of three or more similar items.
5. Enable RLS and add a policy on every table you create, in the same operation.
6. Store contacts, leads and form submissions in the built-in CRM through the `crm*` nodes.
7. Report a provisioning error verbatim and stop.

**DO NOT**

1. Do not raw-write to `content/` or `hiveku.cms.json` with file tools.
2. Do not batch CMS writes in a parallel tool call group.
3. Do not put a slash in a slug, and do not encode hierarchy into a hyphenated slug.
4. Do not hand-roll a markdown renderer.
5. Do not send a user to supabase.com, and never write a database URL or key into project files.
6. Do not use `dbCreateRow`, or provision a database, for a lead, contact, or form submission.
7. Do not leave a new table with RLS off, and never reach for a `service_role` or any `rolbypassrls` credential to make a query work.

---

## Part 1: the file-based CMS contract

The CMS is **files, not rows**. There is no content table. That fact explains most of the tools' behavior.

- Manifest: **`hiveku.cms.json` at the project root**, defining collections, their `path`, fields, and `routePattern`.
- Entries: **`{collection.path}/{slug}.mdx`** (frontmatter plus body) or **`{collection.path}/{slug}.json`**.
- A collection `id` is **lowercase-hyphens and STABLE**: "never rename once entries exist... Add a new collection instead and migrate." The id joins the manifest, the directory on disk, and every page that reads it; renaming it renames none of those, it orphans them.
- `slugFrom` supports exactly one value: **`filename`**. There is no "slug from a title field" mode.
- In an MDX collection, **only ONE field may carry `isBody: true`**; every other field is frontmatter.

### Slugs are flat. Hierarchy lives in routePattern.

Lowercase letters, numbers, hyphens. **No slashes.** The anti-pattern is named: "Do NOT encode hierarchy into hyphenated slugs (`utah-south-jordan-stairlifts` is an anti-pattern)."

The slug is a filename; the URL is computed separately from `routePattern`. Bake hierarchy into the filename and you fuse two things that must move independently: when the client reorganizes locations by region, every file is renamed, and every inbound link and slug reference breaks with them.

`routePattern` accepts `{slug}`, `{field:x}`, `{field:x?}` (the optional form), and `{ref:a.b.leaf}` (pulled through a reference chain, **capped at 5 hops**). So `utah/south-jordan/stairlifts` is a `routePattern` over a slug of `stairlifts`, not a filename with the path glued in.

### Field types and the shape that bites

Types: `string, number, boolean, date, image, file, url, color, markdown, html, array, object, select, reference`. **Nested arrays-of-arrays are unsupported**; **object nesting is capped at 2 levels**. If the model wants a third level, the inner thing is its own collection with a `reference` to it.

**The image dual shape.** An `image` field accepts **either a URL string OR `{ url, alt? }`**. Both are valid, both occur, and page code must normalize both:

```tsx
const img = typeof entry.hero === "string" ? { url: entry.hero } : entry.hero;
```

Skip it and the page renders `[object Object]` into a `src`, or crashes reading `.url` of a string, depending on which shape the last author wrote. The shape is per entry, not per collection.

**Repeater vs reference:** "if you'd want a unique URL per item, use collections + references. If items only ever appear on the parent page, use a repeater."

---

## Part 2: the isLive filter

Every page that renders a collection filters entries with **exactly this**:

```ts
const isLive = !fields.archived &&
  (fields.status === 'published' || fields.published === true) &&
  (!fields.publishAt || new Date(fields.publishAt) <= new Date())
```

**1. The publishAt clause is not optional.** "Without it, an entry carrying a FUTURE publishAt renders immediately." The client schedules a launch post for next Tuesday, the CMS reports it as scheduled, and the page publishes it the moment it is saved. That is an embargo break.

**2. Truthy checks, not `=== true`.** `archived: 'yes'` must hide an entry. Entries arrive from bulk imports, migrations and humans typing into a select, and the manifest's field type does not guarantee the value's JS type on disk. `!fields.archived` handles the string; `fields.archived === true` publishes an archived entry live.

**3. `publishAt` can be a number.** A numeric epoch-milliseconds value must still gate the entry: `new Date(1767225600000)` handles it, a string comparison does not.

**4. The unparseable-publishAt trap.** A published entry carrying a **non-empty but unparseable** `publishAt` yields `Invalid Date`, and `NaN <= now` is **false**. Nothing hides it via `archived`, nothing rejects it via `status`, and it never becomes visible: **the site hides the entry FOREVER**. It reports as `scheduled`, never `published`, so the operator sees a date and assumes it is waiting, when no future moment can satisfy the comparison.

**Diagnosis.** Symptom: "this post never went live", or an item stuck on scheduled. Meaning: almost always this third state, not caching and not deploy. Check: read the entry with `cms_read_entry` and inspect the raw `publishAt` (`"soon"`, `"TBD"`, `"March"`, `"2026-13-01"` all give `Invalid Date`); distinguish genuinely empty (safe, the clause short-circuits) from present-and-garbage (fatal); only then look at build and deploy. An entry failing `isLive` fails identically on every rebuild, which is why it reads as a stuck platform rather than bad data. Prevention: on write or import, normalize `publishAt` to ISO or omit it. Absent is safe by construction; present and bad is permanent.

### Status-managed field names must not render as form fields

Managed by the CMS publishing UI, and **filtered out of any form that renders a collection's fields**:

```
status, published, archived, publishAt, workflowState
```

Render them and the user has a second, uncoordinated publish control: they set `status: draft` in your form while the CMS editor says published, or they type a date into your `publishAt` input and hit the trap above. Two controls over one piece of state, with no arbitration, is how an entry ends up in a condition nobody intended and nobody can explain.

Same class as the phone field that rejected a real customer's number. That customer wrote, into the message body of a live lead form: **"I am interested in information for my parents. please contact me with details YOUR FORM SUCKS!!! I CAN'T PUT MY INFO IN. FORGET IT!"** with a phone field containing only `(208) `. "That was a lost sale, on a form that passed every test we could run against it." A form that exposes fields the user should not touch fails the same way.

### Draft shadow files

A staged draft is written beside its entry as **`{slug}.draft.{ext}`**. **Readers must skip any path containing `.draft.`.** A glob of `*.mdx` picks up `about-us.draft.mdx` and publishes an unreviewed draft next to its own live entry, as a duplicate with the same title. Filter on the filename before you parse. Diagnosis: a duplicated entry on the live page with a near-identical title is this, not a double write.

**What creates one, and what does not.** The shadow file is written by `cms_write_entry({ project_id, collection_id, slug, fields, draft: true })`, and only by that. Draft writes skip field validation, so a partial working copy is fine. `cms_promote_draft` copies the shadow over the live entry, deletes the shadow, and fires save webhooks - refusing with 422 if the draft no longer validates against the CURRENT schema or has dangling references (drafts sit while schemas evolve), 409 if a concurrent live edit landed since the draft was saved (`force: true` overwrites, which is a lost update), and 404 if there is no shadow to promote. Two things that look like they make a draft and do not: a top-level `status: "draft"` on `cms_write_entry` is just a field the site reads (see the reserved system-field list above), and `cms_preview_write` paints the Fly preview iframe without writing to the database at all - promote after that alone gets the 404.

---

## Part 3: authoring rules

**Never raw-write** to `content/` or `hiveku.cms.json`: "the tools validate against the manifest and trigger preview sync + GitHub auto-commit; direct writes skip those and may produce entries that fail to parse." A raw write is not a faster path to the same result; it is a different result: unvalidated, unsynced to the preview, uncommitted. The entry you cannot see in the preview and the entry that throws at build time both come from here.

**CMS writes are SEQUENTIAL.** "Do NOT batch CMS write tools in a parallel tool_use group. The builder serializes per-entry writes via an advisory lock; parallel calls queue, and a hung call can wedge the whole turn." This inverts the code-lane rule: code goes out in ONE `project_files_bulk_save`, CMS entries one `cms_write_entry` at a time. For genuine bulk use `cms_bulk_import` with a deduped, validated payload.

**Do not store content in the database.** Blog posts, services, team bios and FAQs are files. Content in the DB costs you the CMS editor, versioning (`cms_list_entry_versions`, `cms_restore_entry_version`), the activity trail (`cms_activity`), and scheduled publishing, all free in the file-based CMS.

**Use a real markdown library.** "do NOT write your own renderMarkdown regex-and-split parser. They reliably ship bugs: bold `**x**` mapped to `<em>` (renders ITALIC), loose lists producing empty `<li>`s, and inline `[text](url)` links left as raw text. Use react-markdown + remark-gfm." Hand-rolled parsers ship *those same three* every time because markdown is not a regex grammar: emphasis is a delimiter-run algorithm with flanking rules, loose/tight lists are decided by blank lines, links need balanced-bracket scanning with escapes. A split-and-replace pass cannot represent any of the three, so it approximates each and gets each wrong.

**Read at build time in a server component** (`fs.readdir` plus `gray-matter`, or `import.meta.glob`), then **sort deterministically**. Directory read order is not guaranteed; an unsorted list reorders between builds and the client reports that the blog shuffled itself.

**Media belongs in the asset lane.** Attach with `cms_attach_image`, or upload via presign (`project_files_presign`, PUT, `project_files_finalize`) or `assets_upload`. Never write image binaries into the code lane to back an entry: the code lane renders in the live preview but is excluded from Lambda deploys. Noah's Ark, 2026-06-25: "the agent wrote AI-generated decoration PNGs into the code lane at the same paths as the client's real uploads; the site regressed to AI images on every machine recreate for **ELEVEN DAYS**." It looked correct in the preview the whole time. That is the trap.

---

## Part 4: a collection is only integrated when the PAGE RENDERS FROM IT

The most important rule in this file.

> "Creating content/&lt;c&gt;/ entries while the page keeps rendering from hardcoded JSX or a static data module is THE WORST OUTCOME: the user edits entries in the CMS editor and NOTHING changes on their site."

Worse than not building it at all, because the customer now has a control panel wired to nothing. They fix a typo in a service description, save, reload, and the typo is still there. They change it again. Then they conclude the CMS is broken, or that you did not do the work.

**Four things, in the same turn:**

1. **Refactor the page to read `content/<id>/` build-safely.** Server component, build-time read, the `isLive` filter, deterministic sort, tolerant of an empty directory (zero entries renders an empty state, it does not throw the build).
2. **REMOVE the now-redundant hardcoded data module.** Never two sources. If both survive, the next editor cannot tell which one the page uses.
3. **Match shapes in BOTH directions.** Every field the page reads exists in the manifest, and every manifest field is rendered or deliberately unused. A field the page reads but the schema does not define renders `undefined` for every entry.
4. **Grep the page to verify the read** with `project_files_search({ project_id, query: "content/<id>/", glob })` - that tool is `grep -rn` over the project's current files (literal by default, `is_regex` for patterns, capped at 500 matches). Your local Bash grep cannot see a Hiveku project. Confirm the page references `content/<id>/` and no longer references the deleted module. This catches a half-applied refactor.

Diagnosis: "I edited it in the CMS and nothing changed on my site" almost never means a stale cache or a missed deploy. `project_files_search` the page for `content/<id>/` before you look anywhere else.

**When to ask.** Ask **before** the work whenever the request is a collection of three or more similar items: gallery, team, products, testimonials, services, FAQs, events, case studies, portfolio, blog posts, pricing plans, locations. Hardcode without asking **only** for genuine one-offs. Twelve hardcoded locations means a ticket for every phone number change; an unasked-for collection is a schema they now maintain.

**A collection changes when the site rebuilds, which is a routing hazard.** Scheduled CMS publishes are a listed rebuild trigger that detonates a latent Next.js route collision. 3rd Degree Screening, 2026-08-19: a concrete `app/industries/healthcare/page.tsx` was added while a sibling `app/industries/[slug]/page.tsx` still generated the same slug. "Nothing failed. The live site kept serving a pre-collision artifact for weeks. Then an unrelated rebuild was the first to resolve the collision the other way, and **TWO PAGES SILENTLY REVERTED TO AN OLDER TEMPLATE** with no deploy and no edit by the owner."

That is your problem the moment a collection has a `routePattern`, because a collection-backed dynamic route is exactly the sibling that steals a concrete page's URL. Run `project_files_validate_orphan_routes` and **read `route_collisions`, not just the orphan count**: "`orphans: 0` does NOT mean routing is healthy... a `[slug]` route matches any single segment, so a URL owned by TWO files still resolves and still counts as zero orphans." `project_route_owner` names the owner of one URL.

---

## Part 5: the managed project database

**Hiveku runs its own managed Supabase.** "users NEVER need to sign up at supabase.com, create accounts, copy API keys, or do ANY manual setup." Provision with `database_provision`; `database_status` says whether one exists. Do not provision a database a static-plus-CMS site does not need.

**If provisioning errors: report the exact error verbatim, STOP, no workarounds.** The anti-pattern is named explicitly, and it is the reflex when a tool call fails:

> "The managed provisioning tool failed. Here's how to set it up yourself: 1. Go to supabase.com..."

"That whole flow defeats the product model." A signup flow converts a transient platform error into a permanent support burden: an unmanaged database Hiveku cannot see or back up, and credentials living in a text file.

**Never write credentials anywhere.** "NEVER write NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, DATABASE_URL, or any Supabase credential into .env files, project code, or instructions for the user to paste." If a user pastes the platform `DATABASE_URL` or an `hk_live_*` key, stop and tell them it is a platform credential. Always use the database tools: code that opens its own connection is both a credential leak and invisible to every check below.

### What is blocked, and why

- **Never DELETE or UPDATE without a WHERE clause.** Blocked.
- **Never DROP anything.** Blocked: `DROP DATABASE`, `DROP SCHEMA`, `DROP TABLE`, `DROP INDEX`, `DROP TRIGGER`, `DROP FUNCTION`, `DROP VIEW`.
- Also blocked: `ALTER TABLE DROP`, `ALTER TABLE RENAME`, `CREATE/DROP/ALTER ROLE`, `GRANT ALL`, `REVOKE`.
- `database_query` is **read-only SELECT, capped at 100 rows**. `database_execute` **DELETE is capped at 50 rows**.

Enforced, not advisory: production data cannot be destroyed by an agent that misread a schema. Past 100 rows, paginate with an `ORDER BY` and a stated reason. The blocked `ALTER TABLE RENAME` is the same two-writer problem as renaming a collection id: the table moves, the code reading it does not, nothing reports the break. Add the new column, migrate, drop nothing.

### RLS is mandatory, and a policy-less RLS table returns zero rows

Every new table **MUST** have RLS enabled **and** a policy. Never leave RLS off. Never grant `anon` or `authenticated`. Never use the `service_role` key or any `rolbypassrls` credential to bypass RLS; grant the right role instead.

The half-done state produces the confusing bug report: **an RLS table with no policy for the app role returns ZERO ROWS.** Not an error, not permission denied. An empty result set, indistinguishable from an empty table.

**Diagnosis.** Symptom: "the query returns nothing but I just inserted a row", or a page rendering an empty list from a table you can see data in. Meaning: RLS is on and no policy admits the reading role. Check `database_describe` for RLS state and policies, and confirm which role is reading, since a row inserted as one role is invisible to a query as another when the policy is scoped. Do not disable RLS and do not reach for a bypass credential; both convert a visibility problem into a security finding. The reverse mistake, RLS simply left off, never fails in testing: it fails when someone else's data is readable and nobody notices for months.

---

## Part 6: the native CRM rule

> "NEVER provision a database (or reach for an external service) when a native node exists: CRM contacts/leads/deals/companies -> `crmCreateContact` / `crmUpsertContact` / `crmCreateDeal` / `crmCreateCompany` write to Hiveku's BUILT-IN CRM with NO database and NO setup. **NEVER use `dbCreateRow`, and NEVER provision or suggest a project database, to store a contact, lead, or form submission** - that's exactly what the crm* nodes are for (`dbCreateRow` is only for a user's OWN custom app tables). A 'contact form -> save the lead + notify us' workflow is `webhookTrigger` -> `crmCreateContact` (+ `sendEmail`) - NO DATABASE, EVER."

**A form submission is already stored.** Every `<form>` on a deployed Hiveku site is captured automatically by an inline module injected at build time: submissions land in the project's Forms tab, upsert a CRM contact, notify the owner, and fire any automation the client built. A plain `<form>` with real fields **is** the working contact form. A leads table is not a safety net; it is a second, worse copy of data that already exists where the customer works.

**Second writers create duplicates, and duplicates reach the customer.** The hidden-input incident is canonical: the capture module drops hidden inputs before serializing while a site's own handler receives them as ordinary JSON keys, so "the two writers see DIFFERENT field sets for the same submit, their fingerprints disagree, the rows never link, and the owner gets TWO 'new submission' emails for every single lead. **ONE AGENCY SITE SENT 54 DUPLICATE EMAILS IN A MONTH** from two hidden `package` fields." The fingerprint is identity plus a digest of submitted **values**, so any extra value one writer adds breaks the match: on mazcnc.com a `createdAt` from the site's own handler "changed the content digest, the two captures of one submission failed to match, and the customer received two emails for one lead." A `dbCreateRow` path is exactly such a second writer.

**Storage you invent fragments the customer's records.** Form identity falls back to the first CSS class when no key is set, producing records named "Space Y 4 Form" and "Flex Form", and **ONE SITE REACHED EIGHTY-FOUR RECORDS FOR THREE ACTUAL FORMS**. If the platform's own identity resolution can fragment three forms into eighty-four records, an ad-hoc table designed in one turn will do worse, and nothing will report it. Meanwhile the CRM is where the client's business runs: deals, companies, notifications, automations, the contact timeline. A lead in a custom table is invisible to all of it.

**The decision, stated once:** contact, lead, quote request, booking enquiry, newsletter signup, form submission of any kind goes to the CRM through the `crm*` nodes. `dbCreateRow` and a provisioned database are for a user's own custom application tables: an inventory the site manages, a booking calendar with its own state machine, gated resource entitlements. If you cannot name the application feature the table serves, you are about to store a lead in the wrong place.

**Two wiring corollaries.** `on_error` defaults to `"fail"` and stops the whole downstream path: "a client had every form on their site returning 500 for six days because a CRM write sat in series ahead of the notification email with the default." Wire notification and CRM write as **siblings off the trigger**. And reference only fields the form actually sends: an unresolved `{{...}}` "is written through as the LITERAL string, not an error", so `{{body.email}}` on a form with no email field stores that text as somebody's address.

---

## Part 7: Supabase extras

Once a project legitimately has a database. To the client this is **"your project database"**; never name the underlying provider.

- **Storage buckets are private by default.** RLS on a bucket means policies on `storage.objects`, not a bucket setting. The zero-rows rule applies: no matching policy returns nothing, and the symptom is broken images rather than an error.
- **Auth redirect URLs sync at provision time**, against the hostnames that existed then. **Re-sync after adding a custom domain**, or flows started from the new hostname bounce to a URL that is not allowlisted. Symptom: login works on the preview and fails on the live domain right after a domain was attached. The re-sync is a tool call: `supabase_sync_redirect_urls` sets the site_url plus the URI allow-list - call it after deploying so OAuth redirects and magic-link emails work.
- **SMTP:** prefer the built-in configuration (an SES proxy, no third-party signup) - `supabase_configure_hiveku_smtp` points Supabase Auth emails at Hiveku Email infra and needs only `sender_email`. It **requires a verified sender domain first**, so verify before configuring and before promising the client that password resets work.
- **Edge Functions are single-file TypeScript only.** Deploy them with `supabase_edge_functions_deploy` (`functions` is an array of `{ slug, source, import_map?, verify_jwt? }`). `jsr:` and `https:` imports work; **no local cross-file imports**, because each file compiles independently, so a shared `./utils.ts` beside your function does not resolve. Inline the helper. Set `verify_jwt=False` for public webhook receivers or the sender gets a 401. **Never set `SUPABASE_SERVICE_ROLE_KEY` in secrets** (auto-injected; a manual copy is a credential you now own). Include the CORS handler inline.

## Part 8: Deletion preflights and bulk purge

`cms_delete_entry` / `cms_delete_collection` are destructive and can break pages that render
the collection. Before any delete, run the preflight the warning implies:

- `cms_back_references({ project_id, collection_id, slug })` BEFORE `cms_delete_entry` - it
  lists every entry across the manifest whose reference / multi-reference fields point at the
  target. Deleting a referenced entry leaves dangling slugs that downstream renderers HIDE,
  so the symptom is content quietly missing, not an error. Offer to repoint or warn the user
  first. Returns `{ references: [{ collection_id, slug, field }] }`.
- `cms_asset_references` BEFORE renaming or deleting an asset - it finds every CMS entry that
  references the asset, and accepts either a relative site path (`/images/foo.jpg`) or an
  absolute S3 URL (both match). Repoint or warn before touching the file.
- After removing a collection a page depends on, check the routes still resolve
  (`project_files_validate_orphan_routes`).

Purging at scale: `cms_bulk_delete` is the ONLY correct way to delete many entries (up to
500 slugs per call) - for example after `cms_delete_collection`. NEVER loop or parallelize
`cms_delete_entry` for a wipe: a parallel per-entry fanout starves the builder's DB pool and
expires its write locks (the 2026-08-20 incident). Server-side it deletes each slug's live
file AND its draft shadow sequentially, cancels pending schedules, and fires delete webhooks
for live entries. Per-slug outcomes come back in the response: `deleted` / `not_found`
(already gone - treat as success; retries are idempotent) / `error`. The slug list is
explicit and reviewed with the user - never pattern-derived.
