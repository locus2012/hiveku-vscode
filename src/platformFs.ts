/**
 * `hiveku:` — platform-backed virtual documents. Click a platform entity, get a
 * real editor tab; Cmd+S writes it back through the account's MCP tools. Three
 * document families:
 *
 *   hiveku:/env/<accountId>/<projectId>/<name>.env       project secrets (AWS SM)
 *   hiveku:/cms/<accountId>/<projectId>/<collection>/<slug>.json   CMS entry
 *   hiveku:/memory/<accountId>/<memoryId>/<name>.md      account AI memory entry
 *   hiveku:/account-memory/<accountId>/ACCOUNT_MEMORY.md  About your business (READ-ONLY)
 *   hiveku:/memory-newer/<accountId>/<memoryId>/<name>.md  the newer Hiveku text of a memory
 *        entry that changed while it was open (READ-ONLY; the left side of Compare and merge)
 *   hiveku:/memory-view/<accountId>/<memoryId>/<name>.md   a memory entry VS Code does not change
 *        (shared with every agent, or an `_account:*` row): READ-ONLY, "Open in Memory"
 *   hiveku:/memory-new/<accountId>/<department>/<name>.md  a new rule, skill, shortcut,
 *        specialist or notes for one agent: empty until its FIRST SAVE creates the entry with
 *        that department (audit G7; no placeholder entry is ever created)
 *
 * A memory save also keeps the one owner rule (memoryOwner.ts): a row shared
 * with every agent or an `_account:*` row is refused with "Open in Memory"
 * whichever way it was opened, a `<!-- department: x -->` line an edit dropped
 * is put back, and an edit that would move a rule to another agent is refused.
 *
 * Memory saves check for other writers (memory event log plan 14.3): the
 * provider remembers the version it served, and a save first reads the entry
 * again. If it moved, the person is told who changed it, when and why (from
 * memory_log_list) and picks Compare and merge, Save anyway or Cancel. Every
 * save sends the version it was based on as expected_version, so once the
 * server checks it a change that lands mid-save is a 409 with the same dialog.
 * An optional "What changed?" line rides along as the reason (empty is fine).
 *
 * The account memory is the one family with no save: owners and admins edit it
 * on the Hiveku dashboard and there is no MCP tool that sets it. stat() marks
 * it read-only (the editor will not take typing) and writeFile() refuses with a
 * message naming the dashboard page, so a save can never look like it worked.
 *
 * The provider is deliberately stateless against the platform (every read is a
 * live fetch, every save a live write) — the platform is the source of truth,
 * VS Code is just an editor session. Saving `.env` DIFFS against the live map:
 * changed/new keys are upserted, removed lines are deleted (each delete is
 * confirmed by the save action itself — the user deleted the line).
 */

import * as vscode from 'vscode';
import { HivekuMcpClient } from './mcpClient';
import * as api from './hivekuApi';
import { quote as quoteEnvValue, parseEnvFile } from './env';
import {
  cleanReason,
  listMemoryLog,
  memoryCreateWithContext,
  memoryUpdateWithContext,
  versionConflict,
  versionFromWrite,
  versionOf,
} from './memoryLog';
import {
  checkOwnerOnSave,
  isReadOnlyRow,
  markerDepartment,
  memoryLinkFor,
  memoryPageUrl,
  newEntryOf,
  ownerName,
  placeRow,
  readOnlyReason,
  withDepartmentMarker,
  type OwnerInput,
  type Placement,
} from './memoryOwner';
import {
  CANCELLED_NOTE,
  COMPARE_ACTION,
  COMPARE_NOTE,
  SAVE_ANYWAY_ACTION,
  decideSave,
  describeChange,
  staleMessage,
  type CurrentMemory,
  type OpenedMemory,
} from './memoryStale';
import {
  ACCOUNT_MEMORY_FILE,
  accountMemoryDashboardUrl,
  accountMemoryReadOnlyMessage,
  fetchAccountMemory,
  renderAccountMemoryDocument,
} from './accountMemory';

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;
type AppUrlFor = () => string;
const DEFAULT_APP_URL = 'https://app.hiveku.com';

export const HIVEKU_SCHEME = 'hiveku';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── URI builders (the only sanctioned way to mint hiveku: URIs) ───────────────

export function envUri(accountId: string, projectId: string, projectName: string): vscode.Uri {
  const name = (projectName || 'project').replace(/[^A-Za-z0-9._-]+/g, '-');
  return vscode.Uri.parse(`${HIVEKU_SCHEME}:/env/${accountId}/${projectId}/${name}.env`);
}

export function cmsEntryUri(
  accountId: string,
  projectId: string,
  collectionId: string,
  slug: string,
): vscode.Uri {
  return vscode.Uri.parse(
    `${HIVEKU_SCHEME}:/cms/${accountId}/${projectId}/${encodeURIComponent(collectionId)}/${encodeURIComponent(slug)}.json`,
  );
}

export function memoryUri(accountId: string, memoryId: string, domain: string): vscode.Uri {
  const name = (domain || 'memory').replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/:/g, '__');
  return vscode.Uri.parse(`${HIVEKU_SCHEME}:/memory/${accountId}/${memoryId}/${name}.md`);
}

/** The newer Hiveku text of a memory entry, read-only (Compare and merge's left side). */
export function memoryNewerUri(accountId: string, memoryId: string, domain: string): vscode.Uri {
  const name = (domain || 'memory').replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/:/g, '__');
  return vscode.Uri.parse(`${HIVEKU_SCHEME}:/memory-newer/${accountId}/${memoryId}/${name}.md`);
}

/** The account memory, read-only (see the header). */
export function accountMemoryUri(accountId: string): vscode.Uri {
  return vscode.Uri.parse(`${HIVEKU_SCHEME}:/account-memory/${accountId}/${ACCOUNT_MEMORY_FILE}`);
}

/** A memory entry VS Code shows but does not change (see the header). */
export function memoryViewUri(accountId: string, memoryId: string, domain: string): vscode.Uri {
  const name = (domain || 'memory').replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/:/g, '__');
  return vscode.Uri.parse(`${HIVEKU_SCHEME}:/memory-view/${accountId}/${memoryId}/${name}.md`);
}

/**
 * A new entry for `department`, stored as `domain` on its first save (see the
 * header). `domain` is one "+ New entry" built (memoryOwner.ts newEntryDomain).
 */
export function memoryNewUri(accountId: string, department: string, domain: string): vscode.Uri {
  const name = domain.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/:/g, '__');
  return vscode.Uri.parse(`${HIVEKU_SCHEME}:/memory-new/${accountId}/${department}/${name}.md`);
}

interface ParsedUri {
  kind: 'env' | 'cms' | 'memory' | 'memory-newer' | 'memory-view' | 'memory-new' | 'account-memory';
  accountId: string;
  projectId?: string;
  collectionId?: string;
  slug?: string;
  memoryId?: string;
  /** memory-new: the agent the entry is for, and the name it gets. */
  department?: string;
  domain?: string;
}

function parse(uri: vscode.Uri): ParsedUri {
  const parts = uri.path.replace(/^\/+/, '').split('/');
  const kind = parts[0];
  if (kind === 'env' && parts.length >= 4) {
    return { kind, accountId: parts[1], projectId: parts[2] };
  }
  if (kind === 'cms' && parts.length >= 5) {
    // NOTE: vscode.Uri.parse() has already percent-decoded .path once — the
    // segments arrive decoded. Decoding again throws URIError on literal '%'.
    return {
      kind,
      accountId: parts[1],
      projectId: parts[2],
      collectionId: parts[3],
      slug: parts[4].replace(/\.json$/, ''),
    };
  }
  if ((kind === 'memory' || kind === 'memory-newer' || kind === 'memory-view') && parts.length >= 4) {
    return { kind, accountId: parts[1], memoryId: parts[2] };
  }
  if (kind === 'memory-new' && parts.length >= 4 && parts[2]) {
    return { kind, accountId: parts[1], department: parts[2], domain: parts[3].replace(/\.md$/, '').replace(/__/g, ':') };
  }
  if (kind === 'account-memory' && parts.length >= 3 && parts[1]) {
    return { kind, accountId: parts[1] };
  }
  throw vscode.FileSystemError.FileNotFound(uri);
}

// ── .env serialization ────────────────────────────────────────────────────────

const ENV_HEADER = [
  '# Hiveku project secrets — saving this file pushes changes to the platform.',
  '# Edit or add KEY=value lines; DELETING a line deletes that secret on save.',
  '# Values sync to deployed environments and restart the live preview (~11s).',
  '',
].join('\n');

function serializeEnv(map: Record<string, string>): string {
  // quoteEnvValue guarantees one physical line per secret (escapes newlines,
  // quotes, #) so the parse side round-trips PEM keys and JSON creds intact.
  const keys = Object.keys(map).sort();
  const body = keys.map((k) => `${k}=${quoteEnvValue(map[k])}`).join('\n');
  return `${ENV_HEADER}${body}${body ? '\n' : ''}`;
}

const parseEnv = parseEnvFile;

// ── The provider ──────────────────────────────────────────────────────────────

export class HivekuFileSystem implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;
  /** uri → size of last-served content, so stat() stays consistent with readFile(). */
  private readonly sizes = new Map<string, number>();
  /** uri → last read/write time; stat() must NOT invent a new mtime per call. */
  private readonly mtimes = new Map<string, number>();
  /** memory uri → the version this editor was given, and when (the stale-edit check). */
  private readonly opened = new Map<string, OpenedMemory>();
  /**
   * memory uri → the last "What changed?" answer, offered again on the next
   * save while that document stays open. Cleared when it closes (forget), so
   * a later, unrelated edit is asked again instead of reusing an old reason.
   */
  private readonly reasons = new Map<string, string>();
  /** `${accountId}/${memoryId}` → the newer Hiveku text shown by Compare and merge. */
  private readonly newer = new Map<string, string>();
  /**
   * memory-new uri → the id of the entry its first save created. Later saves of
   * the same tab update that entry (with the stale-edit check), never create
   * a second one. Kept while the tab is open (forget drops it).
   */
  private readonly created = new Map<string, string>();
  /** memory-view uri → where the entry sits, from its read (the refusal names it without a request). */
  private readonly viewed = new Map<string, { domain: string; placement: Placement }>();

  constructor(
    private readonly clientFor: ClientFor,
    private readonly appUrlFor: AppUrlFor = () => DEFAULT_APP_URL,
  ) {}

  private dashboardUrl(accountId: string): string {
    return accountMemoryDashboardUrl(this.appUrlFor(), accountId);
  }

  /**
   * A document on this scheme closed: drop what was kept for it while it was
   * open (its "What changed?" answer and the version it was given). The next
   * open reads the entry again and the next save asks for a reason again.
   */
  forget(uri: vscode.Uri): void {
    const key = uri.toString();
    this.reasons.delete(key);
    this.opened.delete(key);
    this.created.delete(key);
    this.viewed.delete(key);
  }

  /** The Memory page at a placed row (the "Open in Memory" button of every refusal). */
  private memoryUrl(accountId: string, placement: Placement | null, domain: string): string {
    return memoryPageUrl(this.appUrlFor(), accountId, placement ? memoryLinkFor(placement, domain) : {});
  }

  /**
   * Refuse a save with `message` and an "Open in Memory" button, and stop the
   * save without the generic failure message (SaveRefused).
   */
  private refuse(message: string, url: string): never {
    void vscode.window.showErrorMessage(message, OPEN_IN_MEMORY).then((pick) => {
      if (pick === OPEN_IN_MEMORY) void vscode.env.openExternal(vscode.Uri.parse(url));
    });
    throw new SaveRefused(message, true);
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const p = parse(uri); // validates the shape (throws FileNotFound on garbage)
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: this.mtimes.get(uri.toString()) ?? 0,
      size: this.sizes.get(uri.toString()) ?? 0,
      // The editor opens it locked ("Cannot edit in read-only editor").
      ...(p.kind === 'account-memory' || p.kind === 'memory-newer' || p.kind === 'memory-view'
        ? { permissions: vscode.FilePermission.Readonly }
        : {}),
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {
    /* directories are implicit in the path scheme */
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const p = parse(uri);
    const client = await this.clientFor(p.accountId);
    let text: string;
    if (p.kind === 'env') {
      const { values, sensitiveKeys } = await api.secretsMapWithSensitive(client, p.projectId!);
      // Hidden variables are listed as comments rather than dropped. If they simply
      // vanished from this buffer, saving it would look like the user deleted them,
      // and writeEnv's delete-diff would be computed against an incomplete picture.
      // As comments they are visible, and parseEnv ignores them, so the diff below
      // never proposes deleting a key the server refused to show.
      text = serializeEnv(values);
      if (sensitiveKeys.length > 0) {
        const notes = sensitiveKeys
          .slice()
          .sort()
          .map((key) => `# ${key}= (sensitive: write only, hidden by Hiveku)`)
          .join('\n');
        text = `${text}${text.endsWith('\n') || text === '' ? '' : '\n'}\n# The following are set but cannot be shown. Assign a value to replace one.\n${notes}\n`;
      }
    } else if (p.kind === 'cms') {
      text = await this.readCmsEntry(client, p);
    } else if (p.kind === 'account-memory') {
      const mem = await fetchAccountMemory(client);
      text = renderAccountMemoryDocument(mem, {
        accountId: p.accountId,
        fetchedAt: new Date().toISOString(),
        appUrl: this.appUrlFor(),
      });
    } else if (p.kind === 'memory-newer') {
      const cached = this.newer.get(`${p.accountId}/${p.memoryId}`);
      if (cached !== undefined) {
        text = cached;
      } else {
        const entry = await api.memoryGet(client, p.memoryId!);
        if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
        text = entry.content ?? '';
      }
    } else if (p.kind === 'memory-view') {
      const entry = await api.memoryGet(client, p.memoryId!);
      if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
      text = entry.content ?? '';
      const row: OwnerInput = { ...entry, domain: entry.domain ?? memoryDocName(uri) };
      this.viewed.set(uri.toString(), { domain: String(row.domain), placement: placeRow(row) });
    } else if (p.kind === 'memory-new') {
      const createdId = this.created.get(uri.toString());
      if (createdId) {
        // Saved once already: the tab shows the entry as Hiveku now has it.
        const entry = await api.memoryGet(client, createdId);
        if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
        text = entry.content ?? '';
        this.opened.set(uri.toString(), { version: versionOf(entry.version), readAt: new Date().toISOString() });
      } else {
        // Nothing exists yet: an empty editor. The first save creates the entry.
        text = '';
      }
    } else {
      const entry = await api.memoryGet(client, p.memoryId!);
      if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
      text = entry.content ?? '';
      // What this editor was given: a later save compares against it.
      this.opened.set(uri.toString(), { version: versionOf(entry.version), readAt: new Date().toISOString() });
    }
    const bytes = enc.encode(text);
    this.sizes.set(uri.toString(), bytes.byteLength);
    this.mtimes.set(uri.toString(), Date.now());
    return bytes;
  }

  private async readCmsEntry(client: HivekuMcpClient, p: ParsedUri): Promise<string> {
    let entry: Record<string, unknown> | undefined;
    try {
      entry = await api.cmsReadEntry(client, p.projectId!, p.collectionId!, p.slug!);
    } catch {
      entry = undefined; // brand-new slug — serve the template below
    }
    if (!entry) {
      return JSON.stringify({ status: 'draft', fields: {} }, null, 2) + '\n';
    }
    // Normalize to the editable shape { status, publish_at?, fields }. Servers
    // return either { fields: {...}, status } or the fields inline — tolerate both.
    const fields =
      entry.fields && typeof entry.fields === 'object'
        ? (entry.fields as Record<string, unknown>)
        : Object.fromEntries(
            Object.entries(entry).filter(([k]) => !['status', 'publish_at', 'slug', 'id', 'updated_at', 'created_at', 'versions'].includes(k)),
          );
    const doc: Record<string, unknown> = { status: entry.status ?? 'draft' };
    if (entry.publish_at) doc.publish_at = entry.publish_at;
    doc.fields = fields;
    return JSON.stringify(doc, null, 2) + '\n';
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const p = parse(uri);
    if (p.kind === 'memory-newer') {
      throw vscode.FileSystemError.NoPermissions(
        'This is the newer text from Hiveku, for comparing. Copy what you want into your own tab and save that.',
      );
    }
    if (p.kind === 'account-memory') {
      // Refused BEFORE any client or tool call: there is nothing to save it with,
      // and a save that returned quietly would look like it had worked.
      const url = this.dashboardUrl(p.accountId);
      const message = accountMemoryReadOnlyMessage(url);
      void vscode.window.showErrorMessage(message, OPEN_IN_MEMORY).then((pick) => {
        if (pick === OPEN_IN_MEMORY) void vscode.env.openExternal(vscode.Uri.parse(url));
      });
      throw vscode.FileSystemError.NoPermissions(message);
    }
    if (p.kind === 'memory-view') {
      // Refused before any request too: this tab was opened read-only because
      // the entry is changed on the Memory page (its read said where it sits).
      const seen = this.viewed.get(uri.toString());
      const name = memoryDocName(uri);
      const message =
        `"${name}" is read-only here, so nothing was saved. ` +
        `${seen ? readOnlyReason(seen.placement) : 'It is changed on the Memory page.'}`;
      void vscode.window.showErrorMessage(message, OPEN_IN_MEMORY).then((pick) => {
        if (pick === OPEN_IN_MEMORY) {
          void vscode.env.openExternal(vscode.Uri.parse(this.memoryUrl(p.accountId, seen?.placement ?? null, seen?.domain ?? name)));
        }
      });
      throw vscode.FileSystemError.NoPermissions(message);
    }
    const client = await this.clientFor(p.accountId);
    const text = dec.decode(content);
    try {
      if (p.kind === 'memory-new') {
        const note = await this.writeNewMemory(client, uri, p, text);
        vscode.window.showInformationMessage(note);
      } else if (p.kind === 'env') {
        await this.writeEnv(client, p.projectId!, text);
      } else if (p.kind === 'cms') {
        let doc: { status?: string; publish_at?: string; fields?: Record<string, unknown> };
        try {
          doc = JSON.parse(text) as typeof doc;
        } catch (err) {
          throw new Error(`Not valid JSON — fix the syntax and save again (${err instanceof Error ? err.message : String(err)})`);
        }
        await api.cmsWriteEntry(client, p.projectId!, p.collectionId!, p.slug!, doc.fields ?? {}, {
          ...(doc.status ? { status: doc.status } : {}),
          ...(doc.publish_at ? { publish_at: doc.publish_at } : {}),
        });
        vscode.window.showInformationMessage(`Saved CMS entry "${p.slug}" to Hiveku.`);
      } else {
        const kept = await this.writeMemory(client, uri, p, text);
        vscode.window.showInformationMessage(
          `Memory entry saved (prior version snapshotted).${kept ? ` ${keptMarkerNote(kept)}` : ''}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A save the person stopped (Cancel, or Compare and merge) is not a failure.
      if (err instanceof SaveNotApplied) {
        vscode.window.showInformationMessage(msg);
        throw vscode.FileSystemError.Unavailable(msg);
      }
      // A refusal is not a failure to reach Hiveku: it says why, once (with an
      // "Open in Memory" button when the Memory page is where it is changed).
      if (err instanceof SaveRefused) {
        if (!err.shown) vscode.window.showErrorMessage(msg);
        throw vscode.FileSystemError.NoPermissions(msg);
      }
      vscode.window.showErrorMessage(`Hiveku save failed: ${msg}`);
      throw err instanceof vscode.FileSystemError ? err : vscode.FileSystemError.Unavailable(msg);
    }
    this.sizes.set(uri.toString(), content.byteLength);
    this.mtimes.set(uri.toString(), Date.now());
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  /**
   * Save a memory entry without silently overwriting someone else's change
   * (see the header). Throws SaveNotApplied when the person stops the save,
   * and SaveRefused when the entry is not changed from VS Code (shared with
   * every agent, an `_account:*` row) or the edit would move it to another
   * agent. Returns the department whose marker line it put back, if any.
   */
  private async writeMemory(client: HivekuMcpClient, uri: vscode.Uri, p: ParsedUri, edited: string): Promise<string | null> {
    const key = uri.toString();
    const memoryId = p.memoryId!;
    const name = memoryDocName(uri);
    const opened = this.opened.get(key);
    const entry = await api.memoryGet(client, memoryId);
    if (!entry) {
      throw new Error('this memory entry no longer exists on Hiveku (it may have been deleted). Copy your text before closing the tab.');
    }
    // The one owner rule, on the entry as Hiveku has it now (an answer without
    // a domain is named by the tab, as it was opened).
    const row: OwnerInput = { ...entry, domain: entry.domain ?? name };
    const domain = String(row.domain);
    const placement = placeRow(row);
    if (isReadOnlyRow(row, placement)) {
      this.refuse(`"${name}" cannot be changed from VS Code, so nothing was saved. ${readOnlyReason(placement)}`, this.memoryUrl(p.accountId, placement, domain));
    }
    const owner = checkOwnerOnSave(row, edited);
    if (!owner.ok) {
      this.refuse(
        `"${name}" belongs to ${ownerName(owner.from)}. The line <!-- department: ${owner.to} --> would have the agents ` +
          `that read it follow it as ${ownerName(owner.to)}'s instead, so nothing was saved. Remove that line, or move ` +
          'the entry to another agent on the Memory page.',
        this.memoryUrl(p.accountId, placement, domain),
      );
    }
    const text = owner.text;
    const decision = decideSave(opened, { version: versionOf(entry.version), content: entry.content ?? '' });
    let expectedVersion: number | undefined;
    if (decision.kind === 'stale') {
      expectedVersion = await this.resolveStale(client, uri, p, name, opened, decision.current, 'check');
    } else {
      expectedVersion = decision.expectedVersion;
    }

    const reason = await this.askReason(key);
    let res: unknown;
    try {
      res = await memoryUpdateWithContext(client, memoryId, text, { reason, expectedVersion });
    } catch (err) {
      const conflict = versionConflict(err);
      if (!conflict) throw err;
      // The server refused a write based on an older version (builder E2b).
      const retryVersion = await this.resolveStale(
        client,
        uri,
        p,
        name,
        { version: expectedVersion, readAt: opened?.readAt ?? new Date().toISOString() },
        { version: conflict.version, content: conflict.content },
        'conflict',
      );
      res = await memoryUpdateWithContext(client, memoryId, text, { reason, expectedVersion: retryVersion });
    }
    // The saved text is now what this editor has seen.
    const saved = versionFromWrite(res);
    this.opened.set(key, { version: saved, readAt: new Date().toISOString() });
    return owner.kept;
  }

  /**
   * The first save of a memory-new tab creates the entry, with its department
   * (audit G7): a rule, skill, shortcut or specialist also carries the
   * `<!-- department: x -->` line the agents that read only the text follow.
   * Every later save of the same tab updates that entry. Returns the message
   * to show.
   */
  private async writeNewMemory(client: HivekuMcpClient, uri: vscode.Uri, p: ParsedUri, text: string): Promise<string> {
    const key = uri.toString();
    const department = p.department ?? '';
    const createdId = this.created.get(key);
    if (createdId) {
      const kept = await this.writeMemory(client, uri, { ...p, kind: 'memory', memoryId: createdId }, text);
      return `Memory entry saved (prior version snapshotted).${kept ? ` ${keptMarkerNote(kept)}` : ''}`;
    }
    const target = newEntryOf(p.domain ?? '', department);
    if (!target) throw new Error('this is not a new entry VS Code can create, so nothing was saved. Start it again from "+ New entry".');
    if (!text.trim()) throw new SaveNotApplied('Not created yet: write the entry first, then save. An empty entry is never created.');
    let body = text;
    if (target.kind !== 'memory') {
      const named = markerDepartment(text);
      if (named && named !== department) {
        throw new SaveRefused(
          `The line <!-- department: ${named} --> says this is ${ownerName(named)}'s, but it is a new entry for ` +
            `${ownerName(department)}, so nothing was created. Remove that line, or start the entry for ${ownerName(named)} instead.`,
        );
      }
      if (!named) body = withDepartmentMarker(text, department);
    }
    const reason = await this.askReason(key, 'Why are you adding it? (optional)');
    let created: { id?: string; domain?: string; version?: unknown } | undefined;
    try {
      created = await memoryCreateWithContext(client, { type: target.kind, name: target.name, content: body, department }, { reason });
    } catch (err) {
      if (isStatus(err, 409)) {
        throw new Error(
          `an entry named "${p.domain}" already exists on Hiveku, so nothing was created. Your text is still in this tab: ` +
            'open that entry from the Knowledge tab and add it there, or start a new entry with another name.',
        );
      }
      throw err;
    }
    const id = created?.id ? String(created.id) : '';
    if (!id) throw new Error('Hiveku did not say which entry it created. Check the Knowledge tab before saving again.');
    this.created.set(key, id);
    this.opened.set(key, { version: versionOf(created?.version), readAt: new Date().toISOString() });
    const kind = target.kind === 'memory' ? 'notes' : NEW_KIND_WORDS[target.kind];
    return `Created ${kind} "${target.name}" for ${ownerName(department)}. Saving this tab again updates it.`;
  }

  /**
   * The entry moved: say who changed it and let the person choose. Returns the
   * version to save over (Save anyway), or throws SaveNotApplied (Compare and
   * merge opens the diff; Cancel keeps the tab as it is).
   */
  private async resolveStale(
    client: HivekuMcpClient,
    uri: vscode.Uri,
    p: ParsedUri,
    name: string,
    opened: OpenedMemory | undefined,
    current: CurrentMemory,
    origin: 'check' | 'conflict',
  ): Promise<number | undefined> {
    let lines: Awaited<ReturnType<typeof listMemoryLog>>['lines'] = [];
    try {
      lines = (
        await listMemoryLog(client, { memory_id: p.memoryId!, ...(opened?.readAt ? { since: opened.readAt } : {}), limit: 20 })
      ).lines;
    } catch {
      // The log is not on this account yet (or not reachable): the dialog falls back to versions.
    }
    const message = staleMessage(name, describeChange(lines, opened?.version), { opened: opened?.version, current: current.version }, origin);
    const pick = await vscode.window.showWarningMessage(message, { modal: true }, COMPARE_ACTION, SAVE_ANYWAY_ACTION);
    if (pick === SAVE_ANYWAY_ACTION) return current.version;
    if (pick === COMPARE_ACTION) {
      this.newer.set(`${p.accountId}/${p.memoryId}`, current.content);
      // The person is now looking at the newer version: their next save builds on it.
      this.opened.set(uri.toString(), { version: current.version, readAt: new Date().toISOString() });
      const left = memoryNewerUri(p.accountId, p.memoryId!, name);
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri: left }]);
      await vscode.commands.executeCommand('vscode.diff', left, uri, `${name}: on Hiveku now (left) and your edit (right)`);
      throw new SaveNotApplied(COMPARE_NOTE);
    }
    throw new SaveNotApplied(CANCELLED_NOTE);
  }

  /**
   * "What changed? (optional)". Empty, or Escape, means no reason, never a
   * cancelled save. With auto save on, ask once per open document (a prompt
   * every few seconds would be unusable) and reuse the answer until that
   * document closes (forget).
   */
  private async askReason(key: string, title = 'What changed? (optional)'): Promise<string | undefined> {
    const previous = this.reasons.get(key);
    const autoSave = vscode.workspace.getConfiguration('files').get<string>('autoSave', 'off');
    if (autoSave && autoSave !== 'off' && this.reasons.has(key)) return previous || undefined;
    const input = await vscode.window.showInputBox({
      title,
      prompt: 'One line on why, shown to your team in the memory Activity view. Leave it empty to save without one.',
      placeHolder: 'For example: Clarified the refund wording',
      value: previous ?? '',
    });
    const reason = cleanReason(input);
    this.reasons.set(key, reason ?? '');
    return reason;
  }

  private async writeEnv(client: HivekuMcpClient, projectId: string, text: string): Promise<void> {
    const desired = parseEnv(text);
    const live = await api.secretsMap(client, projectId);
    const changed: Record<string, string> = {};
    for (const [k, v] of Object.entries(desired)) {
      if (live[k] !== v) changed[k] = v;
    }
    const removed = Object.keys(live).filter((k) => !(k in desired));
    // Delete guard: every delete is confirmed BY NAME. This catches accidental
    // select-all-deletes AND stale buffers (a key added on the platform after
    // this doc was opened is absent from the buffer — without the prompt, this
    // save would silently delete it).
    if (removed.length > 0) {
      const label = removed.length === 1 ? `secret ${removed[0]}` : `${removed.length} secrets: ${removed.join(', ').slice(0, 200)}`;
      const ok = await vscode.window.showWarningMessage(
        `This save deletes ${label}. Continue?`,
        { modal: true },
        'Save and delete',
      );
      if (ok !== 'Save and delete') {
        throw new Error('Save cancelled — no secrets were changed.');
      }
    }
    if (Object.keys(changed).length === 0 && removed.length === 0) {
      vscode.window.showInformationMessage('Secrets: no changes to push.');
      return;
    }
    if (Object.keys(changed).length > 0) await api.secretSet(client, projectId, changed);
    for (const key of removed) await api.secretDelete(client, projectId, key);
    const bits: string[] = [];
    if (Object.keys(changed).length) bits.push(`${Object.keys(changed).length} set`);
    if (removed.length) bits.push(`${removed.length} deleted`);
    vscode.window.showInformationMessage(
      `Secrets pushed (${bits.join(', ')}) — deployed envs sync and the live preview restarts (~11s).`,
    );
  }

  async delete(): Promise<void> {
    throw vscode.FileSystemError.NoPermissions('Delete platform entities from their tree/console actions, not the editor.');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Renaming platform documents is not supported.');
  }
}

/** The person stopped a memory save (Cancel, or Compare and merge): not a failure. */
export class SaveNotApplied extends Error {}

/**
 * A memory save VS Code does not make: the entry is changed on the Memory page,
 * or the edit would move it to another agent. `shown`: the message (with its
 * "Open in Memory" button) is already on screen.
 */
export class SaveRefused extends Error {
  constructor(
    message: string,
    readonly shown = false,
  ) {
    super(message);
  }
}

/** The button every read-only refusal offers. */
export const OPEN_IN_MEMORY = 'Open in Memory';

/** What "+ New entry" calls each kind in its messages. */
const NEW_KIND_WORDS: Record<'rule' | 'skill' | 'command' | 'agent', string> = {
  rule: 'rule',
  skill: 'skill',
  command: 'shortcut',
  agent: 'specialist',
};

/** Said after a save that put back the entry's `<!-- department: x -->` line. */
function keptMarkerNote(department: string): string {
  return `Kept its <!-- department: ${department} --> line, which files it under ${ownerName(department)} for the agents.`;
}

/** True when a tool call failed with this HTTP status (the MCP client's McpToolError payload). */
function isStatus(err: unknown, status: number): boolean {
  const payload = err && typeof err === 'object' ? (err as { payload?: unknown }).payload : undefined;
  return !!payload && typeof payload === 'object' && Number((payload as { status?: unknown }).status) === status;
}

/** The entry's name as its tab shows it ("_rule__pricing.md" → "_rule:pricing"). */
function memoryDocName(uri: vscode.Uri): string {
  const file = uri.path.split('/').pop() ?? 'memory';
  return file.replace(/\.md$/, '').replace(/__/g, ':');
}

/** Register the provider once at activation. */
export function registerHivekuFs(
  context: vscode.ExtensionContext,
  clientFor: ClientFor,
  appUrlFor: AppUrlFor = () => DEFAULT_APP_URL,
): void {
  const provider = new HivekuFileSystem(clientFor, appUrlFor);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(HIVEKU_SCHEME, provider, {
      isCaseSensitive: true,
    }),
    // "Ask once per open document": what was kept for a document goes when it closes.
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === HIVEKU_SCHEME) provider.forget(doc.uri);
    }),
  );
}
