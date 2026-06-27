/**
 * Download a project's tarball (the signed S3 URL from project_files_snapshot)
 * and extract it into a destination folder. The tarball is gzip'd; `tar.x`
 * auto-detects the gzip header.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar';

export async function downloadAndExtract(downloadUrl: string, destRoot: string): Promise<void> {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hiveku-snap-'));
  const tarPath = path.join(tmpDir, 'project.tar.gz');
  try {
    await fs.writeFile(tarPath, buf);
    await fs.mkdir(destRoot, { recursive: true });
    await tar.x({ file: tarPath, cwd: destRoot });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
