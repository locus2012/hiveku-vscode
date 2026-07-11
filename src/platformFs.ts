/**
 * `hiveku:` — platform-backed virtual documents. Click a platform entity, get a
 * real editor tab; Cmd+S writes it back through the account's MCP tools. Three
 * document families:
 *
 *   hiveku:/env/<accountId>/<projectId>/<name>.env       project secrets (AWS SM)
 *   hiveku:/cms/<accountId>/<projectId>/<collection>/<slug>.json   CMS entry
 *   hiveku:/memory/<accountId>/<memoryId>/<name>.md      account AI memory entry
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

type ClientFor = (accountId: string) => Promise<HivekuMcpClient>;

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

interface ParsedUri {
  kind: 'env' | 'cms' | 'memory';
  accountId: string;
  projectId?: string;
  collectionId?: string;
  slug?: string;
  memoryId?: string;
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
  if (kind === 'memory' && parts.length >= 4) {
    return { kind, accountId: parts[1], memoryId: parts[2] };
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

  constructor(private readonly clientFor: ClientFor) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    parse(uri); // validates the shape (throws FileNotFound on garbage)
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: this.mtimes.get(uri.toString()) ?? 0,
      size: this.sizes.get(uri.toString()) ?? 0,
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
      const map = await api.secretsMap(client, p.projectId!);
      text = serializeEnv(map);
    } else if (p.kind === 'cms') {
      text = await this.readCmsEntry(client, p);
    } else {
      const entry = await api.memoryGet(client, p.memoryId!);
      if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
      text = entry.content ?? '';
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
    const client = await this.clientFor(p.accountId);
    const text = dec.decode(content);
    try {
      if (p.kind === 'env') {
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
        await api.memoryUpdate(client, p.memoryId!, text);
        vscode.window.showInformationMessage('Memory entry saved (prior version snapshotted).');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Hiveku save failed: ${msg}`);
      throw err instanceof vscode.FileSystemError ? err : vscode.FileSystemError.Unavailable(msg);
    }
    this.sizes.set(uri.toString(), content.byteLength);
    this.mtimes.set(uri.toString(), Date.now());
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
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

/** Register the provider once at activation. */
export function registerHivekuFs(context: vscode.ExtensionContext, clientFor: ClientFor): void {
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(HIVEKU_SCHEME, new HivekuFileSystem(clientFor), {
      isCaseSensitive: true,
    }),
  );
}
