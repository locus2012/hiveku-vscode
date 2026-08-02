/**
 * Download a project's tarball (the signed URL from project_files_snapshot)
 * and extract it into a destination folder. The tarball is gzip'd; `tar.x`
 * auto-detects the gzip header.
 */

import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';

export async function downloadAndExtract(downloadUrl: string, destRoot: string): Promise<void> {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    // Read the body before giving up on it. The server sends a JSON error with
    // the actual cause (an expired link, a size refusal, the underlying S3
    // error name) and this used to discard it, leaving "Download failed: HTTP
    // 502" as the entire diagnosis for a bug that took a day to find.
    let detail = '';
    try {
      const body = (await res.text()).trim();
      if (body) {
        try {
          const parsed = JSON.parse(body) as { error?: unknown; details?: unknown; hint?: unknown };
          detail =
            [parsed.error, parsed.details, parsed.hint]
              .filter((v): v is string => typeof v === 'string' && v.length > 0)
              .join(' — ') || body.slice(0, 300);
        } catch {
          detail = body.slice(0, 300);
        }
      }
    } catch {
      /* body unreadable — fall back to the bare status */
    }
    throw new Error(`Download failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
  }
  if (!res.body) throw new Error('Download failed: empty response body');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiveku-snap-'));
  const tarPath = path.join(tmpDir, 'project.tar.gz');
  try {
    // Stream to disk rather than res.arrayBuffer().
    //
    // Buffering held the ENTIRE archive in the extension host's heap before a
    // single byte was written — hundreds of MB for a large project, in the same
    // process as the editor UI, where an allocation failure takes VS Code's
    // extension host down rather than just failing the download. Streaming
    // keeps this flat no matter how big the project is.
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tarPath));

    await fs.mkdir(destRoot, { recursive: true });
    await tar.x({ file: tarPath, cwd: destRoot });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
