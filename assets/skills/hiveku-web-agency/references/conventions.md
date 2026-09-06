# The Stack and the Standards

This is the build manual for page-level work on a Hiveku client site: the default stack and what is already installed, where the server/client boundary goes, how images work on a platform with no runtime image optimizer, the technical standards every page must meet before it ships, and the voice rules for anything a paying client will read. Load it whenever you are about to write or edit a page, a section, a layout, a metadata export, or an image reference. The `hiveku-web-agency` skill is the map (which tool, which play, which order); this is the manual it points to for what the code itself must look like. Two sibling manuals own territory this one deliberately does not: forms and capture, and routes and deploys. Their incidents bound your work even when you are only writing a section, so hold them in mind: one site reached **eighty-four form records for three actual forms** because form identity fell back to a CSS class; one agency site sent **54 duplicate emails in a month** from two hidden inputs; and on 2026-08-19 a route collision that built clean meant **two pages silently reverted to an older template with no deploy and no edit by the owner**. A few rules here do fail loudly, and this manual flags them: a wildcard image hostname and a literal `&` in JSX both crash the build. Most of the rest do not throw at all, which is the pattern worth internalizing: the expensive mistakes on this platform are usually silent.

---

## Part 1. The rules that prevent damage

Read these first. The mechanism behind each is in the parts that follow, so you can reason about the cases the rules do not name.

**Do not:**

- **R1.** Do not re-add a package the project's `package.json` already declares (Part 2). The manifest is the only source of truth; re-adding declared packages is churn for zero gain.
- **Lockfile.** Judge a project's versions from `package.json` only. A lockfile (`pnpm-lock.yaml` / `yarn.lock` / `package-lock.json`) is evidence of a PAST install and is routinely stale on this platform, because manifests are edited without a local npm; `preview_logs` prints `LOCKFILE OUT OF SYNC` when the container reconciles an install to `package.json` over it, and the build log prints `LOCKFILE NOT HONORED` when a strict install from the lockfile fails and the build falls back to `package.json`. A deploy refused with `lockfile_out_of_sync` is fixed in the project (update `package.json` to the intended versions, or delete the lockfile), never by hand-editing the lockfile or downgrading `package.json` to match it. Full doctrine: `references/build-and-deploy.md` Rule 66.
- **R8.** Do not modify `next.config.*` to fix a build. The deployment system patches the config for production builds; your edit conflicts with the patch and breaks the preview *and* the build.
- **R21/R22.** Do not create a root-level `images/` folder, and never save into `public/src/`.
- **R23.** Do not reference `imported/images/...` as a URL. It is source storage, not a served path.
- **R24.** Do not put a raw `hiveku-project-assets.s3...amazonaws.com` URL in code. That bucket is private and 403s in the browser.
- **R27/R30.** Do not write `srcset`, do not hand-roll image conversion, and do not create a parallel converted-image directory. - **R32.** Do not change *which* picture a section shows without explicit confirmation.
- **R36.** Do not export `openGraph` without an `images` key.
- **R41.** Do not put `/_next/` in a robots disallow list. - **R47.** Do not hardcode a Tailwind color (`bg-blue-500`, `text-white`, `border-gray-200`). - **R51/R52/R53.** Do not name an infrastructure provider, recommend a competitor, or invent platform folklore in anything the client reads.
- **R56.** Do not fabricate a logo. Not an SVG you drew, not a generated one, not a placeholder icon.

**Do:**

- **R11/R12.** Default to Server Components. Put `"use client"` at interactive leaves as a small `*-island.tsx` sibling.
- **R15.** Make `error.tsx` a Client Component. It is the one file that must be.
- **R17.** Detect the project's existing image pattern before adding an image, and never mix patterns.
- **R28/R31.** Store roughly 2560px for full-bleed heroes. A blurry image needs a larger source, not another optimization pass.
- **R39.** Set `metadataBase` in `layout.tsx`.
- **R47.** Define every color as a semantic CSS variable in `globals.css` `:root{}`, in HSL without the `hsl()` wrapper.
- **R48.** Check the page at 375px before you call it done.
- **R50.** Detect the router directory (`project_files_list`, or `ls app src/app` through `preview_exec`) before creating any route, layout, or metadata file.
- **R61.** Run the esbuild parse check after any structural JSX/TSX edit. It catches tag-balance errors `tsc` lets through.

---

## Part 2. The stack, and what the project declares

Next.js 16 App Router, React 19, TypeScript 5, Tailwind 3.4 with shadcn/ui CSS variables, Framer Motion, Lucide icons, `cn()` from `lib/utils.ts`, path alias `@/*` pointing at the project root.

**The project's `package.json` is the ONLY source of truth for dependencies (updated 2026-09-02).**
A new project's manifest already declares the starter stack — `next`, `react`, `react-dom`,
`framer-motion`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss`,
`postcss`, `autoprefixer`, `tailwindcss-animate`, `@tailwindcss/typography`, the `@radix-ui`
primitives — which is why you rarely add those (R1: re-adding one that is already declared is churn
for zero gain). There is no "pre-installed" set beyond the manifest: preview AND deploy install
exactly what `package.json` declares, nothing more.

**R2.** For anything genuinely new, update `package.json` *before* you write the import. The preview container auto-runs `npm install` when `package.json` changes, but only if you actually change it. An import of a package that is not in `package.json` fails on preview and on deploy — declaring it is the fix, not recreating the preview.

**R3.** Class merging is `cn()` from `lib/utils.ts`. Do not re-implement it or reach for a second merge helper; `clsx` and `tailwind-merge` are already wired through it.

**R4.** Motion goes through `components/motion.tsx`, not a direct `framer-motion` import scattered across files. One wrapper means one place to change the animation policy, and it keeps motion code from silently pulling whole sections client-side.

**R5.** Icons come from `lucide-react`. No second icon library, no inline SVG icon sets copied in.

**R6.** Fonts are Manrope for body and Space Grotesk for display. Do not fall back to Inter-like defaults unless a brand specifically requires it. Defaulting to a system-neutral sans is the single fastest way to make a paid build look like a template.

**R7.** shadcn/ui CSS variables are **HSL channel values without the `hsl()` wrapper**: `--primary: 258 90% 66%`. Writing `--primary: hsl(258 90% 66%)` or a hex value breaks every `hsl(var(--primary) / <alpha>)` consumer in the theme, usually rendering as transparent or black rather than erroring.

**R8. Never edit `next.config.*` to fix a build.** The deployment system automatically patches the config for production (adding `output: 'standalone'`, `turbopack.root`, `typescript.ignoreBuildErrors`). Your change may conflict with those patches and break both the preview and the build. Do not add `eslint`, `turbopack`, or `experimental` keys. Only touch `next.config` for **user-facing features**: `images.domains`, redirects, rewrites, env vars. If a build error mentions `turbopack.root` or "workspace root", that is an infrastructure issue, not a code issue: say so and stop.

**R9.** Never `hostname: "**"` in `images.remotePatterns`. It crashes the build. **R10.** Never a literal `&` in JSX text: write `Licensed &amp; Insured`. An unescaped `&` crashes React builds. Avoid smart/curly quotes pasted in from a doc. The build auto-fixes wildcard hostnames and unescaped `&` and retries once, but correct code skips the delay.

---

## Part 3. Server and client components

**R11. Default to Server Components.** Static, content-driven sections render on the server so the content is crawlable and the page ships minimal JavaScript. A Hiveku client is paying for a site that ranks; a section that only exists after hydration is a section Google may never weigh.

**R12. `"use client"` goes at the interactive leaf, not the section.** Do not mark a whole section as a Client Component because one sub-element is interactive. Create a small `*-island.tsx` sibling and import it into the server section.

The mechanism: `"use client"` is a boundary, not a file-local flag. Everything imported below it joins the client bundle. Put it on `services-section.tsx` and you have just shipped the copy, the headings, the card content, and every icon in that section to the browser as JavaScript, and removed them from the initial HTML. Put it on `services-filter-island.tsx` and you ship the filter.

```
components/sections/services-section.tsx        <- server: headings, copy, cards, JSON-LD
components/sections/services-filter-island.tsx  <- "use client": the one interactive control
```

**R13. What must exist in the initial server-rendered HTML:** main content, headings, navigation, FAQ answers, product details, contact information, testimonials, and pricing. If a crawler or a JS-disabled reader would not see it, it is not shipped.

**R14. Dropdown and mega-menu content stays in the server tree.** The island controls *visibility only*. This is the case people get wrong most often, because the natural instinct is to build the whole menu inside the client component that opens it. The result is a site whose entire internal link graph is invisible in the served HTML: every nav link becomes a client-rendered link, and the site's internal linking, the thing that distributes ranking across the pages you just built, evaporates. Render the menu markup on the server; let the island toggle a class or an attribute.

**R15. `error.tsx` MUST be a Client Component.** Next.js requires it; an `error.tsx` without `"use client"` fails the build. This is the one file where the client directive is not a smell.

**R16.** Media slots in reusable components use `next/image`. Raw `<img>` is disallowed for reusable components because it hurts LCP and bypasses optimization. Note the interaction with Part 4: no runtime optimizer runs on deployed Hiveku sites, so `next/image` here is buying you layout stability, lazy behavior, and a single consistent component API, not a resize pipeline. Do not assume it will rescue an oversized file.

**Diagnosis.** Symptom: content is present in the browser but missing from view-source or from an SEO crawl. That means it is below a client boundary. Check for a `"use client"` at the top of the section file or of any ancestor, and check what that ancestor imports. Symptom: a page's JavaScript bundle is large for a page with no real interactivity. Same cause, same check.

---

## Part 4. Images

### Detect first, then place

**R17. Detect the project's existing pattern and never mix.** Look at how the project already references images before you add one. A site with half its images imported from `src/assets` and half at `/images/` is a site where the next person guesses wrong.

- **R18. Next.js / static:** files at `public/images/`, referenced as `/images/name.jpg`.
- **R19. Vite / CRA:** files at `src/assets/`, referenced through an `import`.
- **R20. Documents:** `public/documents/` for **every** framework.
- **R21.** Never create a root-level `images/` folder. **R22.** Never save to `public/src/`.
- **R25.** Filenames lowercase, hyphens, no special characters. Spaces and apostrophes in filenames cause avoidable URL-encoding problems, so keep to the rule rather than testing where it breaks.

**R23. `imported/images/` is SOURCE STORAGE, NOT a served URL path.** This is the trap that looks most like it works: the file is right there, the path is obvious, and the reference produces a broken image with no error anywhere in the build. Copy the file into `public/images/` and reference the copy. (`imported/` is also one of the reserved CDN asset prefixes, which is the other half of why a page path under it never behaves.)

**R24. Never put a raw `hiveku-project-assets.s3...amazonaws.com` URL in code.** That bucket is private. The URL resolves in a tool result or a log and 403s in a visitor's browser. If you found an image through a tool that handed you an S3 URL, that is a source location, not a `src`.

**R26. Attached images are auto-promoted and live. Videos and documents are not.** They sit in `_staging/` and must be moved with a promote call, **one attempt only**. Do not loop on a failed promote; report it.

**R33. Code lane vs asset lane.** A CDN-servable binary stored in the code lane **renders in the live preview but is excluded from Lambda deploys**. Upload binaries through the presign asset lane or the asset upload tool instead. Two real incidents:

> **Noah's Ark, 2026-06-25:** the agent wrote AI-generated decoration PNGs into the code lane at the same paths as the client's real uploads; the site regressed to AI images on every machine recreate for **eleven days**.

> **2026-07-28:** an agent hand-rolled a webp "optimization" through this writeback path: 111 code-lane image blobs under a self-invented `public/images-webp/`, with **19 sport heroes collapsed to one duplicated image**, a client-visible incident.

**R34.** Deleting a code file: `rm` works. Deleting a **binary asset**: `rm` is not enough. Binary deletes are deliberately not inferred; use the asset delete tool.

### There is no runtime image optimizer

**R27.** Deployed Hiveku sites do **not** run a runtime image optimizer and emit **no `srcset`**. Whatever resolution you store is the only one every screen gets. A full-res PNG hero ships as-is, and a single 1.8MB PNG is a multi-second mobile load.

Everything else in this section follows from that one fact:

- **R28.** Target roughly **2560px** for full-bleed heroes. Do **not** downscale to 1920: that is below 1x on a wide monitor and the image will look soft.
- **R29.** **Do not chase a compression ratio.** The optimizer picks quality per image by measuring the result against the original and refusing anything that lost visible detail. A file that barely compressed did not fail; it was protected.
- **R30.** **Never hand-roll image conversion, and never create a parallel converted-image directory.** That is exactly the `public/images-webp/` incident above. You cannot beat the platform pipeline from inside a page edit, and the failure mode is not a slow image, it is the wrong image on 19 pages.
- **R31.** **A blurry image needs a larger source (>= 2560px), not another pass.** Re-encoding a small source cannot add detail. If the only available source is small, say so and ask for a better one; do not upscale and ship it.
- **R32.** **Never change which picture a section shows without explicit confirmation.** Swapping a client's photo for a better-looking stock image is not an improvement, it is a surprise on their homepage.

**Diagnosis.** Symptom: image is fine in the preview, broken live. Check the lane (code vs asset) and the path (`imported/`, a private S3 URL, a subdirectory of `public/`). Symptom: image looks soft on a large monitor. Check the stored pixel width; if it is 1920 or less, the source is the problem. Symptom: mobile page is slow with no obvious cause. Check the byte size of the hero, because no srcset means mobile downloaded the desktop file.

---

## Part 5. The standards every page must meet

### Metadata

**R35.** `title` <= 60 characters, unique per page. `description` <= 160 characters, unique per page.

**R36. Never export `openGraph` without an `images` key.** An images-less export **replaces the site default with nothing** and the share card dies. This is a subtraction disguised as an addition: the page had a working share image from the site-wide default until you exported a partial `openGraph` on it. Shape:

```ts
openGraph: {
  title, description,
  images: [{ url: "/og-image.png", width: 1200, height: 630 }],
},
twitter: { card: "summary_large_image" },   // R37
alternates: { canonical: "/services/roof-repair" },  // R38
```

**R39. `layout.tsx` MUST set `metadataBase`:**

```ts
metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")
```

Without `metadataBase`, relative `og:image` URLs never become absolute and social scrapers render no card. Deploy auto-injects `NEXT_PUBLIC_SITE_URL` with the real domain, so the fallback is only for local work.

**R40. The site-wide share image.** Prefer `app/opengraph-image.tsx` (ImageResponse), because it lives in the code lane and therefore always enters the build. If you use a static file instead, it must live at **`public/og-image.png`, the root of `public/`, never a subdirectory**. Subdirectory `public/` files are stripped out of the build and served from the CDN asset lane; if that lane lacks the file, the image 404s. `public/images/og-image.png` looks tidier and is exactly the version that breaks.

**R49.** Next.js reserved metadata filenames compile to a Route Handler at the same URL segment, so a sibling `page.tsx` kills the build with "Conflicting page and metadata at /X": `app/sitemap.ts`, `app/robots.ts`, `app/manifest.ts`, `app/opengraph-image.tsx`, `app/twitter-image.tsx`, `app/icon.tsx`, `app/apple-icon.tsx`, `app/favicon.ico`. If the client wants a human-readable visual sitemap page, name it `app/html-sitemap/page.tsx`, never `app/sitemap/page.tsx`.

**R50. Detect `app/` vs `src/app/`, never assume.** A project uses **either** a root `app/` directory **or** `src/app/` as its router, not both. Many projects keep routes in root `app/` and use `src/` only for components, lib, and hooks. Find out which before you create any page, route, layout, or metadata file. Your own Bash tool runs on your machine and cannot see a Hiveku project, so use `project_files_list({ project_id })` for the SAVED tree (what deploys) or hand `ls app src/app` to `preview_exec` with the project_id and cmd for the CONTAINER tree (what the dev server sees; cwd defaults to `/app`). **Putting a route under the wrong app dir creates a dead file Next.js silently ignores**, which reads exactly like "my change did not appear".

### robots.ts

**R41. NEVER add `/_next/` to a disallow list.** It is a prefix match that blocks Googlebot from every JS chunk, stylesheet, and font under `/_next/static/`. Google then renders the page unstyled and half-broken and ranks it accordingly. Do **not** copy the generic SaaS robots recipe (`disallow: ['/api/', '/_next/', '/dashboard/']`): these sites have no `/dashboard/` or `/admin/`, and robots.txt is not access control anyway. To fix an existing one, add `allow: ["/", "/_next/static/", "/_next/image"]` (longest match wins).

### JSON-LD

**R42.** One appropriate block per page type: homepage gets **Organization + WebSite**; service pages **Service**; product pages **Product**; blog posts **Article**; a local business **LocalBusiness**. Build it server-side, and never inject user-supplied strings unsanitized into the JSON-LD script.

### Semantics and accessibility

**R43.** Exactly **one `<h1>` per page**, and real landmark elements (`header`, `nav`, `main`, `section`, `footer`) instead of div soup. **R44.** Descriptive `alt` on every image; decorative images get `alt=""`, not a filename. **R45.** `loading="lazy"` below the fold. **R46.** No "click here" link text; `role="contentinfo"` on the footer; network-specific `aria-label`s on social links ("Follow us on Instagram", not "Social").

### Design tokens

**R47. NEVER hardcode a color.** Every color is a semantic CSS variable in `globals.css` `:root{}`, in HSL channel form. Use `bg-primary`, `text-foreground`, `border-border`, `bg-muted`. Never `bg-blue-500`, `text-white`, `border-gray-200`.

The mechanism is why this is load-bearing rather than stylistic: the token layer is what lets a brand change, a dark mode, or a client's rebrand propagate through the whole site from one file. Every hardcoded `text-white` is a pixel that will not follow. And it fails quietly: the page looks correct the day you write it, and wrong six months later on exactly the sections you touched. `text-white` on a hero is the most common instance, and it is the one that turns invisible the day the hero image is replaced with a light one.

### Mobile

**R48. Verify at 375px.** Every section readable, no horizontal scroll. Check the real page, not a mental model: 375px is where a nav that fits at 1440 becomes a two-line overlap, where a table pushes the body wider than the viewport, and where a hero headline breaks into six lines.

Include the forms in that pass. A real customer submitted this, with a phone field containing only `(208) `:

> "I am interested in information for my parents. please contact me with details YOUR FORM SUCKS!!! I CAN'T PUT MY INFO IN. FORGET IT!"

That was a lost sale, on a form that passed every test we could run against it. The forms manual owns the field rules (mandatory autocomplete tokens, never mask or reformat a phone field while typing, never a `maxLength` on a phone field); your job in the 375px pass is to actually type into every field on a narrow viewport before you say the page is done.

### Verification

**R61.** Run the typecheck after any non-trivial TS edit, and the esbuild parse check after **any** structural JSX/TSX edit: esbuild is much stricter than `tsc` about tag balance and catches mismatched `</div>` / `</section>` / `</Link>` pairs that `tsc` lets through. Skip self-checks only for pure content edits and trivial typo fixes.

**R62.** If the user says they cannot see a change you made, **screenshot the exact page they are looking at before replying**. Never tell a user they are mistaken without screenshot evidence in hand. Two of the failure modes in this manual (a route under the wrong app dir, a client-boundary swallowing content) present exactly as "the change did not appear", and both are your bug, not their browser.

---

## Part 6. Diagnosis quick table

| Symptom | What it usually means | What to check |
|---|---|---|
| Content visible in browser, absent from view-source | A `"use client"` boundary above it | The section file and every ancestor import (R12, R13) |
| Nav links missing from served HTML | Menu markup built inside the client island | Move markup to the server tree; island toggles visibility (R14) |
| Image fine in preview, broken live | Code lane vs asset lane, or a source-only path | `imported/`, private S3 URL, `public/<subdir>/` (R23, R24, R33, R40) |
| Hero soft on a large display | Source below 2560px | Stored pixel width; get a larger source, do not re-encode (R28, R31) |
| Share card blank after a "metadata improvement" | `openGraph` exported without `images` | The page's metadata export (R36); then `metadataBase` (R39) |
| Site looks unstyled in Google's rendered view | `/_next/` disallowed in robots | `app/robots.ts` (R41) |
| Build fails "Conflicting page and metadata at /X" | A `page.tsx` sibling to a reserved metadata file | R49 |
| New route 404s and the file looks correct | Route created under the wrong app dir | `project_files_list`, or `ls app src/app` via `preview_exec` (R50) |
| Build error names `turbopack.root` or "workspace root" | Infrastructure, not your code | Report it; do not edit `next.config` (R8) |

One caution that governs all of the above: the build and preview oracles can lag behind what you just wrote. If a red result cites a file:line that does not match your edit, read the cited file. If the quoted text is gone, that is a stale oracle, not a bug, and editing further means "fixing" code that is already correct. Never edit twice on the same symptom without the oracle changing.

---

## Part 7. Client-facing voice

Everything in this part applies to chat with the client, to commit and report language, and to any copy written into their site.

**R51. Never name infrastructure providers.** Say "Live Preview", not Fly.io. "Production deployment", not AWS Lambda. "Your project database", not Supabase. Omit Render, ECS, S3, CloudFront, and Cloudflare entirely; say "hosting", "assets", "CDN".

**R52. Never recommend a competitor.** Not Vercel, Netlify, Cloudflare Pages, Render, Heroku, Railway, GitHub Pages, or AWS directly. Hiveku is the product they bought. "You could host this on X" is a sentence that ends a retainer.

**R53. Never invent platform folklore.** "This is a known issue", "known platform session issue", "this happens sometimes" are **forbidden** unless an error message you actually received says so. Folklore is worse than "I do not know" because it forecloses the investigation and teaches the client to distrust the next diagnosis.

**R54. No emojis anywhere.** Not in chat, not in anything written into the user's site. **R55. No em dashes in client-facing copy.**

**R56. Never invent a logo.** Do not fall back to drawing an SVG, AI-generating one, or otherwise fabricating a placeholder. That produces the "that's not my logo" round-trip every time. The ladder, in order: look in `public/`, `public/brand/`, and `imported/images/` first; then extract from the real source URL; then a clean text wordmark. **Never a made-up icon.**

**R57.** A logo rendered invisibly (a dark mark on a dark header, white on white) is a failure, not a placement detail. Check it against the actual header background at both breakpoints.

**R58. The image sourcing ladder, never skip a rung:** the user's library, then the workspace, then stock search, then generate. **R59.** Never generate a product, team, location, or logo image when a real one exists. Generated imagery standing in for a real business's real premises or real staff is the fastest way to lose trust. (The eleven-day Noah's Ark regression was a different failure, a code-lane write colliding with the client's real uploads, but the client-visible symptom was the same: AI images where their own photographs belonged.)

**R60. Anti-slop. Do not produce these unless asked:**

- "Trusted by..." logo strips
- a default 3-column feature grid
- two CTAs in the hero
- generic icons used as decoration
- fade-in on every element
- glassmorphism
- gradient blobs
- "Get started" / "Learn more" as CTA text
- oversized faded decorative text behind headings
- dot-grid backgrounds
- badge pills above every section title
- 4-link-column footers
- gradient hero headings

Each of these is a tell. A client who has seen four AI-built sites recognizes the set instantly, and the recognition costs more than any one of them gains. Write the CTA that names the action ("Get a roof inspection"), and let the layout follow the content instead of the template.

---

## Ship checklist

Before you call a page done: server-rendered content present (R13); islands are leaves (R12); `error.tsx` is client (R15); images follow the project's one pattern, live in the right lane, and are stored at the resolution you want served (R17, R27, R33); title and description unique and within limits (R35); `openGraph` includes `images` (R36); `metadataBase` set (R39); the site-wide share image is at the root of `public/` or generated in code (R40); `robots.ts` does not disallow `/_next/` (R41); JSON-LD matches the page type (R42); one `h1`, real landmarks, alt text everywhere (R43 to R46); zero hardcoded colors (R47); 375px verified by looking, including typing into the form (R48); esbuild parse clean after structural edits (R61). Then commit. Commit is not deploy, and deploy needs an explicit yes.
