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
export type ExternalPlatform = 'url' | 'webflow' | 'wordpress';

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

const EXTERNAL_PLATFORMS: ReadonlySet<string> = new Set<ExternalPlatform>(['url', 'webflow', 'wordpress']);

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
