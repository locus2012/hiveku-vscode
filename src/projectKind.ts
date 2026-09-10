/**
 * Project-kind predicates for the rows `sites_list` and `project_get` return.
 *
 * Mirrors hiveku_builder/src/lib/projects/project-kind-pure.ts (the builder is
 * the source; keep the two in step). Every predicate is a function over a
 * structural row and imports nothing, so it is safe anywhere in the extension.
 *
 * `external_platform` and `cms_provider` are optional on the wire: before the
 * builder's platform columns exist the keys are present and null, and older
 * servers omit them. Every predicate treats a missing value as null.
 */

/** Which platform an `external` project lives on. `url` is the plain tracked
 *  site (the only value that exists before the platform columns land). */
export type ExternalPlatform =
  | 'url'
  | 'webflow'
  | 'wordpress'
  | 'squarespace'
  | 'wix'
  | 'shopify';

/** Where the project's CMS content lives. */
export type CmsProviderKind = 'native' | 'webflow';

export interface ProjectKindRow {
  project_type?: string | null;
  external_platform?: string | null;
  cms_provider?: string | null;
}

/**
 * Project types with no code tree for the editor, VCS and deploy pipeline:
 * tracked external sites and python-lambda API projects. Mirrors the builder's
 * NO_LOCAL_CODE_TYPES. The six sites that used to compare `project_type` with
 * the literal 'external' use isExternalProject, not hasLocalCode: folding
 * python-lambda into "no code here" is a separate decision (hiveku-sync ships
 * a run hint for it), so hasLocalCode is exported for the day that lands.
 */
export const NO_LOCAL_CODE_TYPES: ReadonlySet<string> = new Set(['external', 'python-lambda']);

/**
 * The accepted `external_platform` values, in the builder's canonical order:
 * the plain tracked site first, then the named platforms. A value this build
 * does not know reads as `url`, so an extension that shipped before a platform
 * was added still renders those rows rather than dropping them.
 */
export const EXTERNAL_PLATFORM_VALUES: readonly ExternalPlatform[] = [
  'url',
  'webflow',
  'wordpress',
  'squarespace',
  'wix',
  'shopify',
];

const EXTERNAL_PLATFORMS: ReadonlySet<string> = new Set<ExternalPlatform>(EXTERNAL_PLATFORM_VALUES);

/**
 * What each platform is called on a project row — the builder's `kindLabel`
 * column ("what this project IS", the slot that otherwise reads 'nextjs' or
 * 'static-html'). `url` is the plain tracked site, which has no platform name
 * of its own.
 *
 * The builder's PLATFORM_META carries four more columns — the chooser word
 * `label` ('Other website' for `url`), a one-line description, a "Coming soon"
 * badge and `hasApiConnection` — for its platform chooser and project cards.
 * The tree has no chooser and renders neither a sentence nor a chip, so those
 * stay in the builder; Webflow, the one platform with an API connection today,
 * is named directly by the two surfaces that open its workspace.
 */
export const PLATFORM_KIND_LABELS: Record<ExternalPlatform, string> = {
  url: 'External site',
  webflow: 'Webflow',
  wordpress: 'WordPress',
  squarespace: 'Squarespace',
  wix: 'Wix',
  shopify: 'Shopify',
};

function normalizedType(row: ProjectKindRow): string {
  return (row.project_type ?? '').trim().toLowerCase();
}

/** True for `project_type = 'external'` (case-insensitive). */
export function isExternalProject(row: ProjectKindRow): boolean {
  return normalizedType(row) === 'external';
}

/** True when the project has a code tree to download, commit and deploy. A null
 *  or unknown `project_type` counts as having code, like the builder. */
export function hasLocalCode(row: ProjectKindRow): boolean {
  return !NO_LOCAL_CODE_TYPES.has(normalizedType(row));
}

/**
 * The platform of an external project, or null for anything that is not
 * external. An external row with no (or an unrecognised) `external_platform`
 * is the plain tracked URL site.
 */
export function externalPlatform(row: ProjectKindRow): ExternalPlatform | null {
  if (!isExternalProject(row)) return null;
  const raw = (row.external_platform ?? '').trim().toLowerCase();
  return EXTERNAL_PLATFORMS.has(raw) ? (raw as ExternalPlatform) : 'url';
}

/** The CMS provider a project's content is read from. Anything other than an
 *  explicit `webflow` is the native file-based CMS. */
export function cmsProvider(row: ProjectKindRow): CmsProviderKind {
  return (row.cms_provider ?? '').trim().toLowerCase() === 'webflow' ? 'webflow' : 'native';
}

/**
 * The fields that locate a tracked external site. `custom_domain` and
 * `subdomain` exist on SiteSummary only, so every field is optional: the
 * ProjectSummary the tree's globe action receives qualifies as-is.
 */
export interface ExternalSiteRow {
  external_website_url?: string | null;
  custom_domain?: string | null;
  subdomain?: string | null;
}

/**
 * Where a tracked external site opens: the URL the customer recorded
 * (`https://` added when it was typed bare, as the builder's getProjectLiveUrl
 * in lib/projects/site-url.ts does), else the custom domain. Undefined when
 * the row records neither, so the caller renders an inert row rather than a
 * dead link. One resolver for every platform: before 0.80.1 the Webflow branch
 * read `external_website_url` while the other five platforms read only
 * `custom_domain`, which the builder never sets on an external row, so a
 * Squarespace, Wix, Shopify, WordPress or plain-URL site had nothing to open.
 */
export function externalSiteUrl(row: ExternalSiteRow): string | undefined {
  const recorded = (row.external_website_url ?? '').trim();
  if (recorded) return /^https?:\/\//i.test(recorded) ? recorded : `https://${recorded}`;
  const domain = (row.custom_domain ?? '').trim();
  return domain ? `https://${domain}` : undefined;
}

/**
 * What the tree prints as a tracked site's host: the hostname of its live URL.
 * The builder gives every external row a synthetic `ext-<slug>-<hex>` subdomain
 * (an internal id with no DNS behind it), so the subdomain is the last resort,
 * shown only when the row records no URL and no custom domain at all.
 */
export function externalSiteHost(row: ExternalSiteRow): string {
  const url = externalSiteUrl(row);
  if (url) {
    try {
      return new URL(url).hostname;
    } catch {
      // A recorded URL that does not parse: fall through to the raw fields.
    }
  }
  return row.custom_domain || row.subdomain || '';
}
