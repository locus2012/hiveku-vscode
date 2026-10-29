/**
 * What core's body parser does with a request this extension sends (HK-847):
 * a body sent with Content-Encoding: gzip is inflated, then read as JSON text
 * (hiveku-mcp-api-server src/middleware/json-body.ts). For the fake Hiveku
 * servers in these tests, so they read a request the way core reads it. Not a
 * test file itself.
 */
import { gunzipSync } from 'node:zlib';

export function isGzip(value) {
  return String(value ?? '').trim().toLowerCase() === 'gzip';
}

/** The raw bytes a node:http test server received, and their text once inflated. */
export async function readRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks);
  const text = (isGzip(req.headers['content-encoding']) ? gunzipSync(raw) : raw).toString('utf8');
  return { raw, text };
}

/** The whole text of a request a node:http test server received. */
export async function readRequestText(req) {
  return (await readRequest(req)).text;
}
