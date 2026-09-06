# Site Scaffolding: Templates, Modes, Pages, and Prebuilt Sections

The full mechanism behind Play 1. Load this before creating a site, cloning one, laying in
pages, or injecting prebuilt sections.

1. `templates_list()` - browse starting points; match to the client's industry and the
   agreed IA. Recommend from `preview_demo_url` (the live rendered demo), not from the
   name. `components_list()` - the prebuilt section library (heroes, feature grids,
   pricing, testimonials, CTA bands, FAQ). Its filters compose with AND (category, intent,
   style, search, template_id) and an unfiltered response paginates 100 at a time - use
   `facets.categories` from the response to narrow before iterating.
2. Scaffold:
 - New Hiveku-hosted site from a template:
     `site_create({ name, creation_mode: 'template', template_id })`. `creation_mode`
     defaults to `'blank'`, and a `template_id` passed WITHOUT `creation_mode: 'template'`
     is ignored - you get a bare scaffold and think the template failed. The other modes
     are `'blank'` (bare Next.js + Tailwind) and `'import'` (empty project for bringing an
     existing app, paired with `project_import_presign` / `project_import_finalize`).
     `project_type` defaults to `nextjs`.
 - Duplicate an existing project to iterate on: `site_clone({ project_id })`. The clone
     does NOT carry the database, custom domain, CloudFront/DNS/cert, or GitHub connection.
 - Register a site that lives elsewhere: `site_create_external`. Re-run analysis on an
     imported/external site, or after any framework conversion, with
     `site_reanalyze({ project_id })` (see `references/framework-conversion-cdn-repair.md`).
3. Lay in pages to match the IA: `pages_create({ project_id, name, slug, ... })` per page -
   required fields are `project_id`, `name`, `slug`; there is no `title` (use `meta_title`
   for the SEO title, and `page_type` from page | blog_post | landing_page | contact |
   about | privacy | terms | custom). `pages_set_homepage({ project_id, page_id })` for the
   front door. Adjust with `pages_update` (read the page first - `pages_get` fetches one
   page by UUID); remove stragglers with `pages_delete` (confirm - a deleted page can
   orphan inbound links; map the 301 first, see `references/domains-dns-redirects.md`).
4. Assemble each page from prebuilt sections. `components_add` does NOT drop a section onto
   a page - it injects the section's files plus their full dependency closure (helper
   components, client-island bundles, and missing npm deps in package.json) into the
   project, and you wire the section into the page yourself in code. The shape is
   `components_add({ project_id, components: ['HeroEditorial', 'PricingToggle'], mode:
   'missing-only', dry_run })`; there is no `page_id` and no `component_id`. Always run
   `dry_run: true` first and read `files_to_write` + `skipped` before the real call. Caps
   are 16 components and 40 explicit `files` per call, and it returns 400
   `unsupported_project_type` on anything that is not a Next.js / internal project. Prefer a
   prebuilt section you customize over hand-writing a layout - it keeps the design
   consistent and the build green.

Profile note: `templates_list`, `components_*`, and every `site_*` tool are invisible to a
`dev`-scoped MCP key. Plugin sessions run the full profile and see them all.
