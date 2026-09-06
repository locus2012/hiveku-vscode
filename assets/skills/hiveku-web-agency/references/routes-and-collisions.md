# Routes, Collisions, and Reserved Paths

The manual behind the routing bullet in the `hiveku-web-agency` skill. That skill tells you to run `project_files_validate_orphan_routes` after every page move; this file tells you what it is actually catching, why a clean build proves nothing, and which URLs on a Hiveku site were never yours to claim in the first place. Load it before you create, move, rename, or delete any page file; before you convert a static site to Next.js; before you write middleware; before you tell a customer a redirect is broken; and any time a page that exists in the code does not appear on the live site. Every incident quoted here happened to a paying customer's site.

---

## The rules

Thirty-one rules. The mechanism behind each is in the sections below, so you can reason about the cases these do not name.

**Reserved CDN prefixes**
1. DO NOT create a page route whose first URL segment is one of the 14 reserved CDN asset prefixes: `assets/ extracted-assets/ images/ img/ icons/ documents/ fonts/ videos/ audio/ media/ screenshots/ brand/ brand-images/ imported/`.
2. DO NOT assume a route group hides you from rule 1. `(marketing)/videos/` collides exactly like `videos/` does, because group segments vanish from the URL.
3. DO NOT treat the 2026-08-17 auto-suppression as permission to use these prefixes. It only rescues a route when zero assets back that prefix. A page route plus real assets on the same prefix is still a live 403.
4. DO treat every offloaded `public/` subdirectory as a per-project reserved prefix, and re-check them whenever a project's framework changes.
5. DO NOT read a green post-deploy smoke test as proof that a route under a reserved prefix works. Those routes are excluded from the smoke check by design.

**The static-vs-dynamic sibling trap**
6. DO NOT let two files be able to produce the same pathname. One concrete page plus one sibling dynamic route that generates the same slug is the single most damaging routing defect on this platform.
7. DO NOT trust a green build as evidence that routing is healthy. An App Router collision builds clean: exit 0, no error, no warning.
8. DO read `route_collisions` every time, not just the orphan count. `orphans: 0` does NOT mean routing is healthy.
9. DO remove a slug from the dynamic route's data source in the SAME change set in which you add a concrete page for it.
10. DO NOT put a dynamic segment in the first position of the route tree. `app/[year]/[month]` matches any two-segment URL on the site.
11. DO fix a collision by giving each URL exactly one owner, then re-verify with `project_route_owner`.

**Next.js structural reservations**
12. DO NOT create a `page.tsx` sibling to a reserved metadata file (`sitemap.ts`, `robots.ts`, `manifest.ts`, `opengraph-image.tsx`, `twitter-image.tsx`, `icon.tsx`, `apple-icon.tsx`, `favicon.ico`). Unlike the sibling trap, this one is fatal at build time. A human-readable sitemap page goes at `app/html-sitemap/page.tsx`.
13. DO detect the router directory before creating ANY page, route, or layout. Detect, never assume. Your local Bash cannot see a Hiveku project's files - use `project_files_list` on the saved tree, or hand `ls app src/app` to `preview_exec` with the project_id and cmd (cwd defaults to `/app`) to ask the container.
14. DO NOT put routes in both `app/` and `src/app/`. A project uses one or the other as its router.
15. DO default-ALLOW `/api/*` in middleware. Use the canonical matcher `export const config = { matcher: ['/((?!api|_next|.*\\..*).*)'] };`.
16. DO NOT default-deny or blanket-redirect `/api/*`, `/api/portal/*`, or `/api/admin/*`.
17. DO delete or move the old path when you rename a file. Writing the new file and leaving the old one is not a rename.

**Platform-claimed paths**
18. DO pre-flight the Shopify storefront scaffold with `shopify_scaffold_compat` or `{"dryRun": true}` before it writes into the user's `app/`. `compatible: false` means refuse, not proceed carefully.
19. DO NOT build pages at portal, review-funnel, or payment-page reserved paths on a site served through the portal edge.
20. DO expect a bare 404, not a redirect, from a blocked platform path, and do not diagnose that 404 as a broken redirect.
21. DO NOT use the reserved SaaS-zone subdomain labels: `cdn www api admin mail ns1 ns2 edge static assets`.
22. DO NOT use a reserved payment-page slug: `new edit admin api assets static thanks thank-you success cancel checkout pay portal login signin sign-in health robots.txt favicon.ico`.

**Redirects**
23. DO call `project_redirects_list` before telling a user a redirect does not exist.
24. DO run `project_redirects_deploy({ project_id, tier })` after saving platform rules. Saved is not live, and the tier matters: `development` | `staging` | `production`, default production. Deploying to one tier and then checking another is its own silent no-op.
25. DO NOT test a platform redirect in the live preview. It always "fails" there, and that is expected.
26. DO NOT write a `/foo -> /foo/` rule. Hosting handles both forms for every rule; such a rule is a no-op at best and a self-loop at worst.
27. DO prefer 302 while experimenting. Browsers cache 301s hard.
28. DO identify which redirect system is responsible before editing anything. `curl -sI <URL>` showing `x-cache: FunctionGeneratedResponse from cloudfront` means the platform edge produced it, not your code.
29. DO read the literal error the user typed. `ERR_TOO_MANY_REDIRECTS`, a 404, and a blank page are three different failures with three different causes.
30. DO NOT suggest HashRouter.

**Conventions and timing**
31. DO expect a preview 404 for a route you created THIS turn, and DO NOT restart the preview over it.

---

## 1. The 14 reserved CDN asset prefixes

CloudFront routes these top-level path prefixes straight to the S3 Assets-Origin with no edge function in between:

```
assets/  extracted-assets/  images/  img/  icons/  documents/
fonts/   videos/  audio/  media/  screenshots/  brand/
brand-images/  imported/
```

Because there is no edge function on that behavior, "a PAGE route under one of these prefixes never reaches the app - `/videos/` and every child path return 403 AccessDenied from S3."

The static clean-URL transform makes this worse rather than better: `videos.html` deploys as `videos/index.html`, which is exactly the shadowed form. So a plain HTML page named after a reserved prefix walks into the trap without ever having a directory of that name in the source.

### What collides and what does not

Collides:
- `videos.html` at the project root
- `videos/index.html`
- `app/videos/page.tsx` and every child route beneath it
- `(marketing)/videos/...` and any other route group wrapper, because group segments do not appear in the URL
- `pages/videos.tsx`

Does not collide:
- Assets stored under those prefixes. That is what the prefixes are for.
- Non-exact segments. `/media-kit` is fine; `/media/kit` is not. The reservation is on the first segment as a whole.
- `pages/api/**` and `app/api/**`.

### The 2026-08-17 fix, and the hazard it did not remove

As of 2026-08-17: if a page route collides AND zero assets back that prefix, the deploy auto-suppresses the CloudFront behavior and the route serves normally. This is a real rescue and it means an older warning about, say, `/media` on an asset-free project may no longer be a live problem.

It is not permission. The hazard remains in full whenever a page route AND assets share the prefix. That is the common case on any site with an `images/` folder, and it is the case you are most likely to create by accident: add one image under a prefix that a page route already occupies and the behavior stops being suppressible, and the page starts 403ing on the next deploy. Nothing about your page code changed.

The warning code is `reserved_cdn_prefix_page_collision`. It is emitted by `deploy_site`, `deploy_diff`, `project_deploy_preflight`, and `project_files_bulk_save`, so you get it at save time and again at deploy time. Read it; do not scroll past it.

### Per-project dynamic prefixes

The 14 are the fleet-wide set. Every project also generates its own: any offloaded `public/` subdirectory becomes a `dir/*` CloudFront behavior for that project. This is why framework conversions are dangerous.

> "acquiremarketplace.com's /learn/*, /services/* and /blog/* routes went down after a Vite -> Next.js conversion (2026-08-05): dirs that were legitimate static output under Vite became routes under Next."

Nothing was wrong with the new Next.js pages. Those directories had earned CloudFront behaviors while they were static build output, and the behaviors outlived the framework that justified them. Before converting a project, enumerate its offloaded `public/` subdirectories and treat each one as a reserved prefix for the new route tree.

There are tools for exactly this, and the plugin's Play 11 (framework conversion and CDN repair) is the full sequence. In short: `project_cdn_behaviors_list({ project_id, environment })` marks every behavior `protected` or `stale` and names what keeps a non-stale one alive in `backed_by` (`asset_rows` -> `assets_delete`; `asset_bucket_objects` -> `project_assets_orphan_sweep`; `site_bucket_objects` -> not sweepable by any tool). Clear the backing, DEPLOY, then `project_cdn_behaviors_prune` (dry-run by default). **Pruning before deploying is undone by the deploy**, which rebuilds behaviors from whatever backing remains. Also run `site_reanalyze({ project_id })` after the conversion and clean everything it reports in `leftovers[]`.

The neighbouring signature has its own tool: every page route 404s while `/_next/*` chunks load fine means a static-era viewer-request function is rewriting paths against a Lambda origin. Confirm with `project_cdn_config_get`, then `project_cdn_repair({ project_id, environment, action: 'clear_viewer_function' })`, then redeploy so the tier re-attaches the correct function.

### Diagnosis

- Symptom: one section of the site returns 403 AccessDenied while the rest of the site is fine. Meaning: reserved prefix, not an auth problem, not a build problem. Check: is the first URL segment one of the 14, or an offloaded `public/` subdirectory for this project?
- Symptom: a deploy reported success but the customer says a page is dead. Meaning: post-deploy smoke deliberately excludes page routes under reserved CDN prefixes because they 403 by design, so the pipeline will not flag them. Check the prefix list yourself.

---

## 2. The static-vs-dynamic sibling trap

This is the silent killer. Read this section slowly, because the failure has no error message anywhere in the chain.

### The mechanism

When a concrete page (`app/industries/healthcare/page.tsx`) and a sibling dynamic route (`app/industries/[slug]/page.tsx`) can both produce the same pathname, only ONE of them is ever rendered.

Next.js builds an export map keyed by pathname. `defaultMap` is a plain object, so the second writer silently replaces the first and THE LOSER IS NEVER RENDERED AT ALL. There is no merge, no diagnostic, no "duplicate key" anything. One key, one value, last write wins.

Two consequences follow, and the second is the one that ruins weeks:

**The winner is not stable across builds.** Insertion order is the completion order of a parallel worker pool. Which file finishes writing its entry first depends on scheduling, not on your source. In practice the dynamic route tends to win, because it has to execute `generateStaticParams()` first and therefore finishes later, but "tends to" is the entire problem. The same source tree can resolve the collision differently on two consecutive builds.

**The build stays green.** Next.js HAS a fatal guard for exactly this case, `detectConflictingPaths`, but its call site passes only Pages Router data. So an App Router collision builds clean: exit 0, no error, no warning. Verified against Next 15.5.7 and 15.1.0. Your typecheck passes. Your lint passes. `project_test_build` passes. The site deploys. Everything you have been trained to treat as a gate reports success.

### The 3rd Degree Screening incident

> "3rd Degree Screening, 2026-08-19: app/industries/healthcare/page.tsx and app/industries/restaurant/page.tsx were added while lib/page-content.ts still listed both slugs, so app/industries/[slug]/page.tsx kept generating them too. Nothing failed. The live site kept serving a pre-collision artifact for weeks. Then an unrelated rebuild was the first to resolve the collision the other way, and TWO PAGES SILENTLY REVERTED TO AN OLDER TEMPLATE with no deploy and no edit by the owner."

Sit with the shape of that. The defect was introduced weeks before it became visible. The trigger was unrelated to the two pages. No human deployed anything. No one edited anything. From the owner's seat, two pages on their live site spontaneously turned back into an old template, and every log they could reach says the site is healthy.

If a customer ever reports "this page changed back on its own" or "my old content is showing again and I did not do anything," this is your first hypothesis, not your last.

### Rebuild triggers that detonate it

A collision sits dormant until something rebuilds. The triggers are mostly things neither you nor the customer thinks of as a deploy:

- CMS scheduled publishes
- chat auto-deploy
- GitHub pushes
- build reconcile

A scheduled blog post going live at 6am can flip which version of an unrelated services page the site serves. That is why a collision is never "cosmetic, we will fix it later."

### Dynamic route semantics you need to reason with

- `[x]` matches exactly one segment.
- `[...x]` matches one or more segments.
- `[[...x]]` matches zero or more segments.
- Catch-alls are always terminal. Nothing routes below them.
- A dynamic route with NO `generateStaticParams` cannot steal a URL. It has no entry to write into the export map. This is a useful narrowing question: does the sibling actually generate this slug?

Segments stripped from the URL, and therefore invisible when you eyeball the tree:

- `(group)` route groups
- `@parallel` slots
- `_private` folders, where a `_` ancestor makes the entire branch non-routable

Two of these cut opposite ways. A route group is invisible in the URL, so it provides no isolation from a reserved prefix or a sibling collision. A `_` ancestor is invisible in the URL because the branch does not route at all, so a page under one is a dead file no matter how correct it looks.

### Greedy first-position routes

A dynamic segment in the FIRST position is a site-wide hazard rather than a section-local one. The real example is a surviving Webflow date archive: `app/[year]/[month]` "matches ANY two-segment URL on the site, so it can swallow /locations/x and /work/y alike."

An inherited site is exactly where this lurks. When you take over a converted or imported project, list the first-level entries of the router directory and look for brackets before you do anything else.

### How to detect it

- `project_files_validate_orphan_routes` returns `route_collisions[]`. This is the array that matters.
- `project_route_owner` answers a per-URL question: `served_by` plus `shadowed[]`. Use it to confirm a fix and to answer "which file is actually producing this page."
- A post-build prerender-manifest check.

**The critical caveat, stated plainly: `orphans: 0` does NOT mean routing is healthy.** The orphan scan only asks whether a link resolves to a page. A `[slug]` route matches any single segment, so a URL owned by TWO files still resolves, and still counts as zero orphans. The scan that is most likely to be quoted in a status update is structurally incapable of seeing the worst defect it runs alongside. Always read `route_collisions` too, and quote that, not the orphan count.

Save-time warnings you will see in `project_files_bulk_save` results:

- `route_collision_edit_not_visible`, whose text is "Your changes are saved but will not appear on the site." That warning means the file you just edited is the loser. Your edit is real, stored, committed, and unreachable.
- `route_collision_new_dynamic_shadows`, meaning the dynamic route you just added now shadows existing concrete pages.

### Why it is not fatal, and what that obliges you to do

Making collisions fatal "would convert a silent cosmetic bug into 'this site can no longer deploy' for every already-affected project." That is a deliberate platform choice: existing customers keep shipping. The cost of that choice lands on you. The build will never stop you, so the check has to be a habit rather than a gate.

### How to fix it

Give each URL exactly one owner. In practice that is one of:

- Delete the concrete page and let the dynamic route serve it, if the content can live in the data source.
- Keep the concrete page and remove that slug from the dynamic route's data source, so `generateStaticParams()` stops emitting it. In the 3rd Degree Screening case this meant editing `lib/page-content.ts`, a file that contains no routes and would not appear in any route-focused search.
- Narrow the dynamic route so it cannot produce the pathname at all.

Then re-run `project_files_validate_orphan_routes` and confirm with `project_route_owner` that `shadowed[]` is empty for the URLs involved. If the fix removes a URL rather than reassigning it, consider a redirect for it (section 7) so inbound links do not die.

---

## 3. Next.js reserved metadata filenames

These compile to a Route Handler at the same URL segment:

`app/sitemap.ts` (serves /sitemap.xml), `app/robots.ts` (/robots.txt), `app/manifest.ts`, `app/opengraph-image.tsx`, `app/twitter-image.tsx`, `app/icon.tsx`, `app/apple-icon.tsx`, `app/favicon.ico`.

Creating a sibling `page.tsx` kills the build with "Conflicting page and metadata at /X".

Note the contrast with section 2, and use it: this collision is loud and immediate, the sibling-route collision is silent and delayed. If a build dies with that message, you have a naming problem and a one-line fix. If a build is green, you have learned nothing about your other collisions.

The practical case is the visual sitemap. "If you want a human-readable visual sitemap page, name it `app/html-sitemap/page.tsx` - never `app/sitemap/page.tsx`."

---

## 4. `app/` versus `src/app/`

A project uses EITHER a root `app/` directory OR `src/app/` as its router, not both. Many projects keep all routes in root `app/` and use `src/` ONLY for components, lib, and hooks, which is exactly the layout that tempts you to guess wrong.

Before you create ANY page, route, or layout, find out which one this project uses. Your own Bash tool is on your machine, not on the project - the two instruments that can answer are `project_files_list({ project_id })` (the SAVED tree, which is what deploys) and `preview_exec` with `cmd: 'ls app src/app'` (the CONTAINER tree, which is what the dev server sees). When they disagree you have learned something: that is the stale-oracle case in `build-and-deploy.md` section 5.

PUTTING A ROUTE UNDER THE WRONG APP DIR CREATES A DEAD FILE NEXT.JS SILENTLY IGNORES.

Symptom: you added a page, everything verified green, and the URL 404s after the deploy. Meaning: either the wrong app dir or a `_private` ancestor. Check the router directory first, because it is the cheapest to rule out. Note the scope: the same-turn sync delay in section 10 explains a 404 in the LIVE PREVIEW only. A deploy reads the saved project, not the preview container, so it is never the explanation for a deployed URL.

---

## 5. Middleware must default-ALLOW `/api/*`

API route handlers in this project authenticate themselves. They read cookies, verify magic-link tokens, and check sessions inside the handler. A BLANKET MIDDLEWARE REDIRECT ON `/api/*` PRE-EMPTS THOSE HANDLERS and breaks every `/api/portal/me`-style route.

Canonical matcher:

```js
export const config = { matcher: ['/((?!api|_next|.*\\..*).*)'] };
```

NEVER default-deny `/api/*`. The same applies to custom namespaces: `/api/portal/*`, `/api/admin/*`. The instinct that a namespace called `admin` deserves a middleware gate is exactly the instinct that breaks it, because the handler behind it already has one.

Symptom: an authenticated fetch that used to work now returns a redirect or HTML instead of JSON, immediately after middleware was added or edited. Meaning: the matcher is catching `/api/*`. Check the matcher before you touch the handler.

---

## 6. Renames are delete-old plus create-new

When you move a file to a new path, you MUST rm the old path, or mv it. Do NOT just write the new file and leave the old one. The old file lingers in the DB AND on the preview, causing duplicate routes, orphans, and Next.js conflicts.

A half-done rename is how a sibling collision gets created by someone who believed they were only reorganizing. `app/services/[slug]/page.tsx` moved to `app/solutions/[slug]/page.tsx` without deleting the original leaves two dynamic routes, two data reads, and two owners for a set of URLs.

Note the asymmetry with binary assets: `rm` works for a code file, but binary deletes are deliberately not inferred and need the asset delete tool. A rename that moves an image is not finished by `rm`.

---

## 7. Routes claimed by Hiveku scaffolds

The Shopify storefront scaffold writes into the user's `app/`. It claims:

```
app/api/shopify-products     app/api/revalidate     app/api/cart
app/cart                     app/products           app/products/[handle]
app/sitemap.ts               app/account/page       app/account/login
app/account/logout           app/account/auth/callback
app/account/orders           app/account/write-review
app/account/subscriptions    app/account/subscriptions/[id]
app/api/subscriptions/[id]/[action]
```

Two of those are direct hazards from earlier sections. `app/sitemap.ts` collides fatally with any existing `app/sitemap/page.tsx`. `app/products/[handle]` is a dynamic route that will shadow any concrete product page the site already has.

Pre-flight with `shopify_scaffold_compat` or `{"dryRun": true}`. `compatible: false` means refuse. Do not scaffold and then repair. `needsLayoutWrapper: true` means `app/layout.tsx` must wrap children in `<CartProvider>{children}<CartDrawer /></CartProvider>`.

---

## 8. Platform host and path reservations

These run on separate hostnames via the portal edge worker rather than the site's own domain. They matter to you whenever a site is served through that edge.

**Reserved SaaS-zone labels:** `cdn www api admin mail ns1 ns2 edge static assets`.

**Portal sections:** `dashboard`, `invoices/<id>`, `estimates/<id>`, `contracts/<id>`, `subscriptions`, `payment-methods`, `payments`, `statements`, `members`, `help`, `auth/<token>`.

**Portal passthrough prefixes:** `/portal`, `/api/portal`, `/pay`, `/estimate`, `/sign`, `/activate`, `/sms-setup`, `/pay-to`, `/api/public/billing`, `/api/public/sign`, `/api/public/activation`, `/api/public/payment-pages`, `/api/public/avatar`, `/_next`, `/api/health`, `/monitoring`, `/favicon.ico`, `/robots.txt`.

**Review-host sections:** `/rate/<token>`, `/s/<token>`, `/t/<token>`, `/tell/<token>`, `/f/<slug>`.

**Payment-page reserved slugs:** `new edit admin api assets static thanks thank-you success cancel checkout pay portal login signin sign-in health robots.txt favicon.ico`. Note `thanks` and `thank-you` in particular: the obvious name for a conversion confirmation page is reserved, and a thank-you URL is the one URL a conversion goal depends on.

### Why a blocked path 404s instead of redirecting

"Anything not explicitly allowed is BLOCKED with a bare 404 - not redirected to app.hiveku.com. A redirect would leak the platform host to an agency's clients and hand us an open-redirect surface."

Both halves of that reason are load-bearing. An agency reselling Hiveku under its own brand must never have a client bounced to a host with our name on it, and an edge that redirects arbitrary unmatched paths to a configured target is an open-redirect primitive waiting to be abused.

The consequence for your diagnosis: a bare 404 from one of these paths is the system working correctly. Do not "fix" it with a redirect rule, do not report it as a broken route, and do not conclude the path is unclaimed because nothing redirected you somewhere informative. Silence is the design.

---

## 9. The two redirect systems

There are two, they are independent, and neither is visible from the other's console.

**1. Platform redirects.** Dashboard under Hosting > Redirects, or the `project_redirects_list` / `project_redirect_create` / `project_redirect_update` / `project_redirect_delete` / `project_redirects_deploy` tools. Stored on the project. Applied at Hiveku's edge on DEPLOYED environments only, NEVER in the live preview.

**2. Code redirects.** `next.config.js` `redirects()`. Run in preview AND deploys, and are invisible to the dashboard.

Rules that follow:

- "ALWAYS call `project_redirects_list` before telling the user a redirect doesn't exist." A redirect you cannot see in the code may exist at the edge, and vice versa.
- "Saved platform rules do NOT take effect until `project_redirects_deploy` runs." Saving is not shipping. Pass the `tier` you actually want live (`development` | `staging` | `production`, default production). The same call also deploys the DOMAIN redirects derived from attached domains (every non-primary domain 301s to the primary), and those are production-tier only.
- "Testing a platform rule in the preview iframe always 'fails' - that is expected." Do not debug a rule that is behaving exactly as designed.
- "Hiveku's hosting layer auto-handles both /foo and /foo/ for every rule - you do NOT need a rule like /foo -> /foo/. Such a rule is a no-op at best and a SELF-LOOP at worst." A self-loop presents as `ERR_TOO_MANY_REDIRECTS` and is trivially self-inflicted.
- Prefer 302 while experimenting, because browsers cache 301s hard. A wrong 301 that a customer has already loaded persists in their browser after you fix it, and they will tell you your fix did not work.
- Do NOT suggest HashRouter. Ever.
- Never conflate `ERR_TOO_MANY_REDIRECTS`, a 404, and a blank page. "Read the literal error the user typed." They point at three different systems: a loop points at rule logic, a 404 points at ownership or a platform block, a blank page points at the app.

**The diagnostic that settles which system is responsible:** a headers-only request to the DEPLOYED URL. `x-cache: FunctionGeneratedResponse from cloudfront` means the redirect comes from the platform, not your code. Run it before editing either system, because editing the wrong one produces a change with no observable effect, which then reads as "the fix did not work" and invites a second wrong edit.

The URL is public, so a local `curl -sI <URL>` or a WebFetch from your own machine is the right instrument here. Do NOT reach for `preview_http_get` for this one: it issues the request against localhost INSIDE the preview container, which is upstream of CloudFront and therefore structurally incapable of showing you an `x-cache` header. `preview_http_get` is for the other job in this file - reading a 500 page's embedded error when the dev server swallows the stack, or checking an API route without leaving the container.

---

## 10. Conventions, and the 404 that is not a bug

**URL conventions:** one file per page at `app/<slug>/page.tsx`; no hash-anchor SPAs; kebab-case slugs; no query strings for navigation; every route SSR'd. In architect mode: max 2 levels deep, every page reachable in 3 clicks or fewer, max 7 top-level nav items.

The one-file-per-page rule is not stylistic. It is the operational form of "exactly one owner per URL" from section 2. Every deviation from it, and every clever piece of routing that produces a URL from more than one place, is where the sibling trap gets in.

**Same-turn route 404s are EXPECTED. Do not restart the preview.**

"Files you create or edit THIS TURN reach the live preview only at END of turn. A preview 404 for a route you just created is NORMAL... a mid-turn restart cannot deliver files that have not synced yet, and restarts can wedge the preview machine (orphaned dev-server holding the port -> the whole site times out)."

The restart cannot help, because the files it would serve have not arrived. It can hurt, because a wedged dev server holding the port takes the entire site's preview down, which is a far worse state than one route 404ing for the rest of a turn.

---

## 11. Diagnosis table

| Symptom | What it actually means | What to check |
|---|---|---|
| 403 AccessDenied on one section, rest of the site fine | Page route under a reserved CDN prefix, served straight from S3 | Is the first segment one of the 14, or an offloaded `public/` subdir for this project? Look for `reserved_cdn_prefix_page_collision` |
| Whole sections died right after a framework conversion | Old static output directories became CloudFront behaviors and now shadow real routes | `project_cdn_behaviors_list` for the tier and read `backed_by`; `site_reanalyze` for `leftovers[]`; then clear backing -> deploy -> `project_cdn_behaviors_prune` (acquiremarketplace pattern) |
| Every route 404s but `/_next/*` chunks load fine | A static-era viewer-request function is rewriting paths against a Lambda/SSR origin | `project_cdn_config_get` to confirm, then `project_cdn_repair({ action: 'clear_viewer_function' })`, then redeploy |
| "A page changed back on its own", old template returned, no deploy, no edit | Sibling collision resolved the other way on an unrelated rebuild | `project_route_owner` on that URL: read `served_by` and `shadowed[]`. Then find the dynamic sibling's data source |
| Your edit saved but does not appear on the site | Your file is the loser of a collision | The `route_collision_edit_not_visible` warning; `route_collisions[]`, not the orphan count |
| Validator says `orphans: 0`, routing still broken | The orphan scan cannot see collisions; a `[slug]` route resolves any single segment | `route_collisions[]` in the same result |
| A newly added page 404s after deploy | Wrong app dir, a `_` ancestor, a shadowing sibling, or a same-turn preview sync | `project_files_list` (or `ls app src/app` via `preview_exec`); check for `_private` ancestors; `project_route_owner`; if this turn, wait |
| Build dies: "Conflicting page and metadata at /X" | A `page.tsx` sibling to a reserved metadata file | Rename the page (for example to `html-sitemap`), not the metadata file |
| Authenticated `/api/...` call started returning a redirect or HTML | Middleware is matching `/api/*` and pre-empting a self-authenticating handler | The middleware matcher, before the handler |
| Bare 404 on a portal, review, or payment path | The platform edge blocked it on purpose; a redirect would leak the platform host | The reservation lists in section 8. Do not add a redirect rule |
| Redirect works in preview but not live, or vice versa | Two systems: code redirects run in preview and deploys, platform redirects only on deployed environments | Local `curl -sI` against the deployed host for `x-cache: FunctionGeneratedResponse from cloudfront` (not `preview_http_get` - it is inside the container); `project_redirects_list`; did `project_redirects_deploy` run, and on WHICH tier? |
| `ERR_TOO_MANY_REDIRECTS` after adding a rule | Likely a trailing-slash rule that hosting already handles, now self-looping | Delete any `/foo -> /foo/` rule |
| Fix deployed, customer says nothing changed | Possibly a cached 301, possibly you edited the redirect system that was not responsible | Which system produced it; whether the rule was 301 |

---

## 12. Pre-flight before any routing change

Run this before you save, not after the customer calls.

1. Know which directory is the router: `project_files_list({ project_id })`, or `ls app src/app` through `preview_exec`. Never assume from memory of another project.
2. List the router's first-level entries. Any bracketed segment in first position is a greedy route and a site-wide hazard.
3. For every URL you are about to create: is its first segment one of the 14 reserved prefixes, an offloaded `public/` subdir, a portal or review or payment reservation, or the URL of a reserved metadata file? Remember that `(groups)` do not protect you and `_private` ancestors kill the branch entirely.
4. For every URL you are about to create: does a sibling dynamic route generate this slug? Find its `generateStaticParams` and read its data source, which is often a plain lib module with no routes in it.
5. If you are moving a file, delete or `mv` the old path in the same change set, and consider a redirect for any URL that stops existing.
6. Save the whole change set in one `project_files_bulk_save` call and read its warnings, especially `reserved_cdn_prefix_page_collision`, `route_collision_edit_not_visible`, and `route_collision_new_dynamic_shadows`.
7. Run `project_files_validate_orphan_routes` and read `route_collisions[]`. Not the orphan count.
8. Confirm ownership on the specific URLs you touched with `project_route_owner`: `shadowed[]` must be empty.
9. If a redirect is involved, `project_redirects_list` first, then `project_redirect_create`, then `project_redirects_deploy({ project_id, tier })` for the tier you are about to check, then verify the response headers against the DEPLOYED host (a local `curl -sI`, or WebFetch). `preview_http_get` cannot do this check: it hits localhost inside the preview container, so it never sees a CloudFront header.
10. Do not restart the preview because a route you just created 404s.

Green build, green typecheck, and `orphans: 0` are together compatible with two pages that will silently revert to an older template on the next scheduled CMS publish. Section 2 is not optional reading.
