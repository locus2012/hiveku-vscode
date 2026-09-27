/**
 * Plain-language names for versions: a PORT of the builder's naming module.
 *
 * Source of truth: hiveku_builder src/lib/vcs/version-naming.ts (with
 * src/lib/deployment/file-to-route.ts, src/lib/vcs/customer-visible-path.ts and
 * src/lib/builder/server-managed-files.ts folded in, since this extension has
 * no shared copy of them). The builder's fixture table is copied to
 * scripts/fixtures/version-naming-cases.json and scripts/check-vcs-helpers.mjs
 * runs EVERY row against this file: a rule changed there must be re-ported
 * here and the fixture re-copied in the same change.
 *
 * Why the extension needs its own copy: a version saved from VS Code carries
 * source `vscode`, and the server keeps a `vscode` name EXACTLY as sent (it
 * only rewrites agent and API names). So a name that reaches the server with
 * a file path, a file extension, a "fix:" prefix or an "AI:" byline stays in
 * the owner's History for good. VS Code checks names itself (isPlainVersionName
 * on everything a person types) and suggests names from what changed
 * (describeChanges), which by construction never emit a path or extension.
 *
 * Pure: no imports, no vscode, no fs. Erasable TypeScript only (no enums, no
 * parameter properties), so scripts/check-vcs-helpers.mjs can load it with
 * Node's type stripping.
 *
 * Rules (describePath, describeChanges, isPlainVersionName,
 * stripLegacyVersionPrefix) are documented in full in the builder file's
 * header; they are not repeated here so the two cannot drift in prose.
 */

export const MAX_VERSION_NAME_LENGTH = 80;
/** Page and part names are cut to this many characters (29 + "…"). */
export const MAX_THING_NAME_LENGTH = 30;

export type PathKind =
  | 'page'
  | 'part'
  | 'styles'
  | 'layout'
  | 'images'
  | 'logic'
  | 'settings'
  | 'content'
  | 'notes'
  | 'other';

export interface PathDescription {
  kind: PathKind;
  /** Display label, never a path: "Home", "Header", "Site styles", … */
  name: string;
  /** Pages only: the route the page serves ("/", "/contact", "/blog/[slug]"). */
  route?: string;
}

export type ChangeStatus = 'added' | 'modified' | 'removed';

export interface ChangeLists {
  added?: readonly string[];
  modified?: readonly string[];
  removed?: readonly string[];
}

// ── Customer-visible paths (customer-visible-path.ts + server-managed-files.ts) ──

const WRITABLE_MEMORY_FILES: readonly string[] = ['CLAUDE.md', 'CLAUDE.local.md', '.ai/memory.md'];
const COMMANDS_PREFIX = '.claude/commands/';
const NOTES_FILE_NAMES: readonly string[] = ['CLAUDE.md', 'CLAUDE.local.md'];
const NOTES_DIR_NAMES: readonly string[] = ['.ai', '.claude', '.hiveku'];
const SERVER_MANAGED_PATHS: readonly string[] = [
  'soul.md',
  'connected_tools.md',
  '.mcp.json',
  '.claude/settings.json',
  '.claude/commands/generate-image.md',
  '.claude/commands/scrape.md',
  '.claude/commands/search.md',
];
const SERVER_MANAGED_PREFIXES: readonly string[] = ['.claude/skills/', '.claude/rules/', 'data/marketing/'];

/** Strip `./` and leading slashes so `/CLAUDE.md` and `./.ai/x` classify like `CLAUDE.md` and `.ai/x`. */
export function normalizeVersionPath(path: string): string {
  let p = String(path ?? '').trim();
  for (;;) {
    if (p.startsWith('./')) p = p.slice(2);
    else if (p.startsWith('/')) p = p.slice(1);
    else break;
  }
  return p;
}

function isServerManagedFile(filePath: string): boolean {
  if (SERVER_MANAGED_PATHS.includes(filePath)) return true;
  return SERVER_MANAGED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

/** The assistant's notes (`.ai/*`, `CLAUDE.md`, `.claude/**`, `.hiveku/*` at any depth): versioned, never shown. */
export function isAssistantNotesPath(path: string): boolean {
  const p = normalizeVersionPath(path);
  if (!p) return false;
  if (WRITABLE_MEMORY_FILES.includes(p)) return true;
  if (p.startsWith(COMMANDS_PREFIX)) return true;
  const segments = p.split('/').filter((segment) => segment.length > 0);
  const base = segments[segments.length - 1] ?? '';
  if (NOTES_FILE_NAMES.includes(base)) return true;
  return segments.slice(0, -1).some((segment) => NOTES_DIR_NAMES.includes(segment));
}

/** Should a person see this path in a version name or change list? */
export function isCustomerVisiblePath(path: string): boolean {
  const p = normalizeVersionPath(path);
  if (!p) return false;
  if (isAssistantNotesPath(p)) return false;
  if (isServerManagedFile(p)) return false;
  return true;
}

// ── Routes (file-to-route.ts) ─────────────────────────────────────────────────

type RouteKind = 'page' | 'api' | 'layout' | 'middleware';

const ROUTE_FILE_RE = /(^|\/)(page|route|layout|template|loading|error|not-found|default)\.(tsx?|jsx?|mdx?)$/;

function fileToRoute(filePath: string): { route: string; kind: RouteKind } | null {
  const clean = filePath.replace(/^\//, '');
  if (clean === 'src/middleware.ts' || clean === 'middleware.ts') {
    return { route: '(middleware)', kind: 'middleware' };
  }
  let m = clean.match(/^(?:src\/)?app\/(.*)$/);
  if (m) {
    const rest = m[1];
    if (!ROUTE_FILE_RE.test('/' + rest)) return null;
    const fileBase = rest.split('/').pop() || '';
    const kind: RouteKind = fileBase.startsWith('route.')
      ? 'api'
      : fileBase.startsWith('layout.') || fileBase.startsWith('template.')
        ? 'layout'
        : 'page';
    const segs = rest
      .split('/')
      .slice(0, -1)
      .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
      .filter((s) => !s.startsWith('@'));
    const route = '/' + segs.join('/');
    return { route: route === '/' ? '/' : route.replace(/\/$/, ''), kind };
  }
  m = clean.match(/^(?:src\/)?pages\/(.*)\.(tsx?|jsx?|mdx?)$/);
  if (m) {
    let p = m[1];
    if (p === 'index' || p.endsWith('/index')) p = p.replace(/\/?index$/, '');
    if (p.startsWith('api/')) return { route: '/' + p, kind: 'api' };
    return { route: '/' + p || '/', kind: 'page' };
  }
  return null;
}

// ── Rule tables (version-naming.ts) ───────────────────────────────────────────

type FixedKind = Exclude<PathKind, 'page' | 'part'>;

const LABEL: Record<FixedKind, string> = {
  styles: 'Site styles',
  layout: 'Site layout',
  images: 'Images',
  logic: 'Forms and site logic',
  settings: 'Site settings',
  content: 'Blog content',
  notes: "Assistant's notes",
  other: 'Other files',
};

const PHRASE: Record<FixedKind, string> = {
  styles: 'site styles',
  layout: 'the site layout',
  images: 'images',
  logic: 'forms and site logic',
  settings: 'site settings',
  content: 'blog content',
  notes: "the assistant's notes",
  other: 'other files',
};

const KIND_ORDER: readonly PathKind[] = [
  'page',
  'part',
  'layout',
  'styles',
  'content',
  'images',
  'logic',
  'settings',
  'other',
  'notes',
];

const SETTINGS_FILE_RE =
  /^(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|pnpm-workspace\.yaml|bun\.lockb?|tsconfig([.-][\w.-]+)?\.json|jsconfig\.json|next\.config\.[cm]?[jt]s|next-env\.d\.ts|vercel\.json|netlify\.toml|components\.json|hiveku\.cms\.json|instrumentation\.[jt]s|\.env(\..*)?|\.gitignore|\.npmrc|\.nvmrc|\.node-version|\.eslintrc(\..*)?|eslint\.config\.[cm]?[jt]s|\.prettierrc(\..*)?|prettier\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|astro\.config\.[cm]?[jt]s)$/;
const SITE_FILE_RE =
  /^(robots\.(txt|ts|js)|sitemap([-_.][\w-]+)?\.(xml|ts|js)|manifest\.(json|ts|js|webmanifest)|site\.webmanifest|ads\.txt|llms\.txt)$/;
const STYLE_CONFIG_RE = /^(tailwind|postcss)\.config\.[cm]?[jt]s$/;
const APP_IMAGE_RE = /^(opengraph-image|twitter-image|icon|apple-icon)(\.alt)?\.(tsx?|jsx?|txt)$/;
const SPA_SHELL_RE = /^(App|main)\.(tsx|jsx|vue|svelte)$/;
const TEST_FILE_RE = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;

const STYLE_EXTS: readonly string[] = ['css', 'scss', 'sass', 'less', 'styl'];
const FONT_EXTS: readonly string[] = ['woff', 'woff2', 'ttf', 'otf', 'eot'];
const MEDIA_EXTS: readonly string[] = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff', 'heic', 'heif',
  'mp4', 'webm', 'mov', 'm4v', 'mp3', 'wav', 'ogg', 'm4a',
];
const HTML_EXTS: readonly string[] = ['html', 'htm'];
const MARKDOWN_EXTS: readonly string[] = ['md', 'mdx', 'markdown'];
const APP_CODE_EXTS: readonly string[] = ['ts', 'tsx', 'js', 'jsx', 'mdx', 'md'];
const COMPONENT_EXTS: readonly string[] = ['tsx', 'jsx', 'vue', 'svelte', 'astro'];
const SCRIPT_EXTS: readonly string[] = ['ts', 'js', 'mjs', 'cjs'];
const LOGIC_EXTS: readonly string[] = ['sql', 'prisma'];

const STYLE_DIRS: readonly string[] = ['styles', 'theme'];
const CONTENT_DIRS: readonly string[] = ['content', 'posts', '_posts'];
const PART_DIRS: readonly string[] = ['components', '_components', 'sections', '_sections'];
const LOGIC_DIRS: readonly string[] = [
  'lib', 'utils', 'hooks', 'services', 'server', 'actions', 'api', 'store', 'stores', 'context',
  'contexts', 'providers', 'helpers', 'types', 'db', 'prisma', 'supabase', 'functions', 'netlify',
  'middleware',
];
const APP_CUT_DIRS: readonly string[] = [
  'components', 'lib', 'utils', 'hooks', 'sections', 'ui', 'styles', 'types', 'data', 'helpers',
  'actions', 'constants', 'content', 'assets', 'icons', 'images',
];
const ROUTE_STATE_STEMS: readonly string[] = ['error', 'loading', 'default', 'template'];

const DYNAMIC_SEGMENT_RE = /^\[.*\]$/;
const LOCALE_SEGMENT_RE = /^\[(locale|lang|lng|language)\]$/;
/** A Map (own entries only), as in the builder: as a plain object, a folder named "constructor" read Object.prototype.constructor. */
const ACRONYMS: ReadonlyMap<string, string> = new Map([
  ['faq', 'FAQ'],
  ['faqs', 'FAQs'],
  ['seo', 'SEO'],
  ['cta', 'CTA'],
  ['ai', 'AI'],
]);

// ── Classification ───────────────────────────────────────────────────────────

interface Classified {
  kind: PathKind;
  name: string;
  phrase: string;
  route?: string;
  dynamic?: boolean;
  pageFile?: boolean;
}

function fixed(kind: FixedKind): Classified {
  return { kind, name: LABEL[kind], phrase: PHRASE[kind] };
}

function clampName(name: string): string {
  if (name.length <= MAX_THING_NAME_LENGTH) return name;
  return name.slice(0, MAX_THING_NAME_LENGTH - 1).trimEnd() + '…';
}

function isAllCapsWord(word: string): boolean {
  return word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
}

/** "old-offer" → "Old offer", "PricingTable" → "Pricing table", "FAQSection" → "FAQ section". */
export function humanizeSegment(segment: string): string {
  const spaced = segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_.\s]+/g, ' ')
    .trim();
  if (!spaced) return '';
  return spaced
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word, index) => {
      const lower = word.toLowerCase();
      const acronym = ACRONYMS.get(lower);
      if (acronym) return acronym;
      if (isAllCapsWord(word)) return word;
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

function lowerFirst(name: string): string {
  const firstWord = name.split(' ')[0] ?? '';
  if (isAllCapsWord(firstWord)) return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function pageFromRoute(rawRoute: string, pageFile: boolean): Classified {
  let segments = rawRoute.split('/').filter((segment) => segment.length > 0);
  if (segments.length > 0 && LOCALE_SEGMENT_RE.test(segments[0])) segments = segments.slice(1);
  const route = '/' + segments.join('/');
  if (segments.length === 0) {
    return { kind: 'page', name: 'Home', phrase: 'the Home page', route: '/', dynamic: false, pageFile };
  }
  const last = segments[segments.length - 1];
  if (DYNAMIC_SEGMENT_RE.test(last)) {
    let parent: string | null = null;
    for (let i = segments.length - 2; i >= 0; i--) {
      if (!DYNAMIC_SEGMENT_RE.test(segments[i])) {
        parent = segments[i];
        break;
      }
    }
    const parentName = parent === null ? '' : clampName(humanizeSegment(parent));
    if (!parentName) {
      return { kind: 'page', name: 'All pages', phrase: 'every page', route, dynamic: true, pageFile };
    }
    const name = parent !== null && parent.toLowerCase() === 'blog' ? 'Blog posts' : `${parentName} pages`;
    return { kind: 'page', name, phrase: `each page under ${parentName}`, route, dynamic: true, pageFile };
  }
  const name = clampName(humanizeSegment(last)) || 'Untitled';
  return { kind: 'page', name, phrase: `the ${name} page`, route, dynamic: false, pageFile };
}

function partFrom(rel: readonly string[], stem: string): Classified {
  const source = stem.toLowerCase() === 'index' && rel.length >= 2 ? rel[rel.length - 2] : stem;
  const words = humanizeSegment(source);
  const bare = /^The .+/.test(words) ? words.slice(4) : words;
  const name = clampName(bare.charAt(0).toUpperCase() + bare.slice(1)) || 'Site section';
  return { kind: 'part', name, phrase: `the ${lowerFirst(name)}` };
}

function inPartFolder(rel: readonly string[]): boolean {
  return rel.slice(0, -1).some((segment) => PART_DIRS.includes(segment));
}

function classifyApp(path: string, rel: readonly string[], stem: string, ext: string): Classified {
  const codeFile = APP_CODE_EXTS.includes(ext);
  if (codeFile && stem === 'not-found') return pageFromRoute('/404', true);
  if (codeFile && stem === 'global-error') return fixed('layout');

  const route = fileToRoute(path);
  if (route) {
    if (route.kind === 'api' || route.kind === 'middleware') return fixed('logic');
    const page = pageFromRoute(route.route, false);
    if (route.kind === 'layout' || ROUTE_STATE_STEMS.includes(stem)) {
      return page.route === '/' ? fixed('layout') : page;
    }
    return { ...page, pageFile: stem === 'page' };
  }

  const kept: string[] = [];
  for (const segment of rel.slice(1, -1)) {
    if (segment.startsWith('_') || APP_CUT_DIRS.includes(segment)) break;
    if (segment.startsWith('(') && segment.endsWith(')')) continue;
    if (segment.startsWith('@')) continue;
    kept.push(segment);
  }
  if (kept[0] === 'api') return fixed('logic');
  const routeSegments = kept.length > 0 && LOCALE_SEGMENT_RE.test(kept[0]) ? kept.slice(1) : kept;
  if (routeSegments.length === 0) {
    if (COMPONENT_EXTS.includes(ext)) return partFrom(rel, stem);
    if (!inPartFolder(rel) && SCRIPT_EXTS.includes(ext)) return fixed('logic');
    return fixed('other');
  }
  return pageFromRoute('/' + kept.join('/'), false);
}

function classifyPagesRouter(path: string): Classified {
  const route = fileToRoute(path);
  if (!route) return fixed('other');
  if (route.kind === 'api' || route.kind === 'middleware') return fixed('logic');
  const last = route.route.split('/').filter((segment) => segment.length > 0).pop() ?? '';
  if (last === '_app' || last === '_document' || last === '_error') return fixed('layout');
  return pageFromRoute(route.route, true);
}

function classify(input: string): Classified {
  const path = normalizeVersionPath(input);
  if (!path || !isCustomerVisiblePath(path)) return fixed('notes');

  const segments = path.split('/').filter((segment) => segment.length > 0);
  const rel = segments.length > 1 && segments[0] === 'src' ? segments.slice(1) : segments;
  const base = rel[rel.length - 1] ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const first = rel[0] ?? '';
  const atRoot = rel.length === 1;

  if (rel.includes('__tests__') || TEST_FILE_RE.test(base)) return fixed('other');
  if (atRoot && SETTINGS_FILE_RE.test(base)) return fixed('settings');
  if ((atRoot || first === 'app' || first === 'public') && SITE_FILE_RE.test(base)) return fixed('settings');
  if (atRoot && /^middleware\.[cm]?[jt]s$/.test(base)) return fixed('logic');
  if (
    STYLE_EXTS.includes(ext) ||
    FONT_EXTS.includes(ext) ||
    (atRoot && STYLE_CONFIG_RE.test(base)) ||
    (!atRoot && STYLE_DIRS.includes(first))
  ) {
    return fixed('styles');
  }
  if (MEDIA_EXTS.includes(ext)) return fixed('images');
  if (first === 'app' && APP_IMAGE_RE.test(base)) return fixed('images');
  if (HTML_EXTS.includes(ext)) {
    const routeSegments = first === 'public' ? rel.slice(1) : rel.slice();
    routeSegments[routeSegments.length - 1] = stem;
    if (stem.toLowerCase() === 'index') routeSegments.pop();
    return pageFromRoute('/' + routeSegments.join('/'), true);
  }
  if (first === 'public') return fixed('other');
  if (CONTENT_DIRS.includes(first) && !atRoot && MARKDOWN_EXTS.includes(ext)) return fixed('content');
  if (first === 'app' && !atRoot) return classifyApp(path, rel, stem, ext);
  if (first === 'pages' && !atRoot) return classifyPagesRouter(path);
  if (atRoot && SPA_SHELL_RE.test(base)) return fixed('layout');
  if (inPartFolder(rel)) return COMPONENT_EXTS.includes(ext) ? partFrom(rel, stem) : fixed('other');
  if ((!atRoot && LOGIC_DIRS.includes(first)) || LOGIC_EXTS.includes(ext)) return fixed('logic');
  return fixed('other');
}

/** What a file is to the customer. Never returns a path or extension in `name`. */
export function describePath(path: string): PathDescription {
  const classified = classify(path);
  return classified.route !== undefined
    ? { kind: classified.kind, name: classified.name, route: classified.route }
    : { kind: classified.kind, name: classified.name };
}

// ── Sentences ────────────────────────────────────────────────────────────────

function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Plain character-code order (never locale order), the same as the builder and the Python port. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface PageSubject {
  name: string;
  phrase: string;
  route: string;
  dynamic: boolean;
  pageFileStatuses: Set<ChangeStatus>;
}

interface ThingSubject {
  kind: PathKind;
  name: string;
  phrase: string;
  statuses: Set<ChangeStatus>;
}

const PAGE_VERB: Record<ChangeStatus, string> = { added: 'Added', modified: 'Edited', removed: 'Removed' };
const THING_VERBS: readonly string[] = ['Added', 'Changed', 'Removed'];
const STATUS_ORDER: readonly ChangeStatus[] = ['added', 'modified', 'removed'];

function pageStatus(page: PageSubject): ChangeStatus {
  return page.pageFileStatuses.size === 1 ? [...page.pageFileStatuses][0] : 'modified';
}

function thingVerb(thing: ThingSubject): string {
  if (thing.kind === 'part' || thing.kind === 'images' || thing.kind === 'content') {
    if (thing.statuses.size === 1 && thing.statuses.has('added')) return 'Added';
    if (thing.statuses.size === 1 && thing.statuses.has('removed')) return 'Removed';
  }
  return 'Changed';
}

function pageList(pages: readonly PageSubject[], first: boolean, countForm: boolean): string {
  const count = pages.length;
  if (!first) return count === 1 && !countForm ? pages[0].phrase : plural(count, 'other', 'others');
  if (countForm || count >= 4) return plural(count, 'page', 'pages');
  if (pages.every((page) => !page.dynamic)) {
    return `the ${joinList(pages.map((page) => page.name))} ${count === 1 ? 'page' : 'pages'}`;
  }
  return joinList(pages.map((page) => page.phrase));
}

function thingList(things: readonly ThingSubject[]): string {
  if (things.length >= 4) return plural(things.length, 'part of the site', 'parts of the site');
  const parts = things.filter((thing) => thing.kind === 'part');
  const items: string[] = [];
  let partsWritten = false;
  for (const thing of things) {
    if (thing.kind === 'part' && parts.length >= 3) {
      if (!partsWritten) items.push(plural(parts.length, 'site section', 'site sections'));
      partsWritten = true;
      continue;
    }
    items.push(thing.phrase);
  }
  return joinList(items);
}

function sentence(clauses: readonly string[]): string {
  const lowered = clauses.map((clause, index) => (index === 0 ? clause : clause.charAt(0).toLowerCase() + clause.slice(1)));
  return joinList(lowered);
}

function filesSentence(counts: Record<ChangeStatus, number>): string {
  const total = counts.added + counts.modified + counts.removed;
  const verb = counts.added === total ? 'Added' : counts.removed === total ? 'Removed' : 'Edited';
  return `${verb} ${plural(total, 'file', 'files')}`;
}

/**
 * A plain version name for a set of changed paths (at most 80 characters,
 * never a path or file extension). Same rules and output as the builder.
 */
export function describeChanges(changes: ChangeLists): string {
  const seen = new Set<string>();
  const pages = new Map<string, PageSubject>();
  const things = new Map<string, ThingSubject>();
  const otherCounts: Record<ChangeStatus, number> = { added: 0, modified: 0, removed: 0 };
  let total = 0;
  let visible = 0;

  for (const status of STATUS_ORDER) {
    for (const raw of changes[status] ?? []) {
      const path = normalizeVersionPath(raw);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      total++;
      const classified = classify(path);
      if (classified.kind === 'notes') continue;
      visible++;
      if (classified.kind === 'other') {
        otherCounts[status]++;
        continue;
      }
      if (classified.kind === 'page') {
        const key = `${classified.dynamic ? 'dynamic' : 'static'}:${classified.name}`;
        const route = classified.route ?? '/';
        let page = pages.get(key);
        if (!page) {
          page = { name: classified.name, phrase: classified.phrase, route, dynamic: classified.dynamic === true, pageFileStatuses: new Set() };
          pages.set(key, page);
        } else if (compareText(route, page.route) < 0) {
          page.route = route;
        }
        if (classified.pageFile) page.pageFileStatuses.add(status);
        continue;
      }
      const key = `${classified.kind}:${classified.name}`;
      let thing = things.get(key);
      if (!thing) {
        thing = { kind: classified.kind, name: classified.name, phrase: classified.phrase, statuses: new Set() };
        things.set(key, thing);
      }
      thing.statuses.add(status);
    }
  }

  if (total === 0) return 'No changes';
  if (visible === 0) return "Updated the assistant's notes";
  if (pages.size === 0 && things.size === 0) return filesSentence(otherCounts);

  const pageGroups: Array<{ status: ChangeStatus; pages: PageSubject[] }> = [];
  for (const status of STATUS_ORDER) {
    const group = [...pages.values()]
      .filter((page) => pageStatus(page) === status)
      .sort((a, b) => compareText(a.route, b.route) || compareText(a.name, b.name));
    if (group.length > 0) pageGroups.push({ status, pages: group });
  }

  const sortedThings = [...things.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compareText(a.name, b.name),
  );
  const thingGroups: Array<{ verb: string; things: ThingSubject[] }> = [];
  for (const verb of THING_VERBS) {
    const group = sortedThings.filter((thing) => thingVerb(thing) === verb);
    if (group.length > 0) thingGroups.push({ verb, things: group });
  }

  const pageClauses = (countForm: boolean): string[] =>
    pageGroups.map((group, index) => `${PAGE_VERB[group.status]} ${pageList(group.pages, index === 0, countForm)}`);
  const thingClauses = thingGroups.map((group) => `${group.verb} ${thingList(group.things)}`);

  const oneThingClause = things.size > 0 ? [`Changed ${plural(things.size, 'part of the site', 'parts of the site')}`] : [];
  const candidates: string[] = [
    sentence([...pageClauses(false), ...thingClauses]),
    sentence([...pageClauses(false), ...oneThingClause]),
    sentence([...pageClauses(true), ...thingClauses]),
    sentence([...pageClauses(true), ...oneThingClause]),
  ];
  for (const candidate of candidates) {
    if (candidate.length <= MAX_VERSION_NAME_LENGTH) return candidate;
  }
  return `Edited ${plural(visible, 'file', 'files')}`;
}

// ── Checking a name someone else wrote ───────────────────────────────────────

const COMMIT_PREFIX_RE = /^(fix|feat|chore|refactor|docs|style|test|perf|build|ci|revert)(\([^)]*\))?!?:/i;
/** The exact legacy agent bylines ("Hiveku AI:", "AI:"), this case, at the start. */
const LEGACY_AGENT_BYLINE_RE = /^(?:Hiveku AI|AI):/;
/** A file extension a site's files actually use, right after a dot (a closed list, so "e.g." stays plain). */
const FILE_EXTENSION_RE =
  /\.(tsx?|jsx?|[cm]js|s?css|sass|less|html?|json|mdx?|markdown|ya?ml|toml|xml|txt|svg|png|jpe?g|gif|webp|avif|ico|pdf|mp4|webm|woff2?|vue|svelte|astro|py|sql|prisma|sh|env|lock)\b/i;

/** Does `name` start with the exact legacy agent byline ("Hiveku AI:", "AI:")? */
export function hasLegacyVersionPrefix(name: string): boolean {
  return LEGACY_AGENT_BYLINE_RE.test(String(name ?? '').trim());
}

/** `name` trimmed, with the exact legacy agent byline taken off the front once. */
export function stripLegacyVersionPrefix(name: string): string {
  const trimmed = String(name ?? '').trim();
  return LEGACY_AGENT_BYLINE_RE.test(trimmed) ? trimmed.replace(LEGACY_AGENT_BYLINE_RE, '').trim() : trimmed;
}

/**
 * True when `name` reads as a plain version name: non-empty, at most 80
 * characters, no path separator, no file extension, no "fix:"-style prefix
 * and no legacy agent byline.
 */
export function isPlainVersionName(name: string): boolean {
  const trimmed = String(name ?? '').trim();
  if (!trimmed || trimmed.length > MAX_VERSION_NAME_LENGTH) return false;
  if (/[\\/]/.test(trimmed)) return false;
  if (FILE_EXTENSION_RE.test(trimmed)) return false;
  if (COMMIT_PREFIX_RE.test(trimmed)) return false;
  if (LEGACY_AGENT_BYLINE_RE.test(trimmed)) return false;
  return true;
}

// ── Extension-only helpers (not in the builder module) ───────────────────────

/**
 * Why a name is not a plain version name, in words for the person typing it,
 * or undefined when it is plain. Returns undefined exactly when
 * isPlainVersionName(name) is true (check-vcs-helpers.mjs pins that over the
 * fixture), so an input box that validates with this can never accept a name
 * the rule refuses, or refuse one it accepts.
 */
export function versionNameProblem(name: string): string | undefined {
  if (isPlainVersionName(name)) return undefined;
  const trimmed = String(name ?? '').trim();
  const example = "for example 'Updated the pricing section on the Home page'";
  if (!trimmed) return `Give this version a name that says what changed, ${example}.`;
  if (trimmed.length > MAX_VERSION_NAME_LENGTH) {
    return `Keep the name to ${MAX_VERSION_NAME_LENGTH} characters or fewer (this one has ${trimmed.length}).`;
  }
  if (LEGACY_AGENT_BYLINE_RE.test(trimmed)) {
    return "Leave out 'AI:' at the start. History already shows who made each version.";
  }
  if (COMMIT_PREFIX_RE.test(trimmed)) {
    return `Leave out prefixes like 'fix:' and say what changed in plain words, ${example}.`;
  }
  return `Say what changed in plain words, without file names, folders or file types, ${example}.`;
}

/**
 * The design's name for describeChanges over one list of paths (every path
 * counted as edited). Prefer describeChanges with real added/removed lists
 * when they are known: "Added the Pricing page" beats "Edited the Pricing page".
 */
export function describeChange(paths: readonly string[]): string {
  return describeChanges({ modified: paths });
}
