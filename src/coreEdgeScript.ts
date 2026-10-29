/**
 * The core-edge rules of mcpClient.ts (HK-847) as JavaScript SOURCE, for the
 * two scripts this extension writes onto a machine: automations/lib.mjs
 * (localAutomations.ts) and .hiveku/pull-data.mjs (dataRunner.ts). They run
 * outside the extension host with nothing installed, so they cannot import
 * mcpClient.ts; this text is pasted into both instead.
 * test/core-edge-gzip.test.mjs runs it beside mcpClient.ts's own functions on
 * the same answers, so the scripts and the extension say the same thing.
 *
 * A script that pastes it must import gzipSync from 'node:zlib'. String.raw
 * keeps every backslash as written, and the source holds no backtick and no
 * dollar-brace, so pasting it into a template literal changes nothing.
 */
export const CORE_EDGE_SCRIPT = String.raw`// ── Gzip bodies, and refusals from the web edge in front of Hiveku (HK-847) ──
// Written by the Hiveku VS Code extension (src/coreEdgeScript.ts), the same
// rules as its src/mcpClient.ts. Every body to Hiveku goes gzip-compressed: the
// web edge in front of core.hiveku.com reads plain bodies against content rules
// nobody at Hiveku can see, and Hiveku inflates the body before it reads it.
// A 401, 403 or 429 that is not Hiveku's own JSON-RPC error is that edge
// refusing this one request: it never reached Hiveku, it is never sent again,
// and it says nothing about the key.
function hivekuGzipBody(message) {
  return gzipSync(Buffer.from(JSON.stringify(message), 'utf8'));
}
// Hiveku's own error answer: JSON-RPC 2.0 whose error has a whole-number code and a string message.
function hivekuErrorAnswer(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  var body;
  try { body = JSON.parse(text); } catch (e) { return false; }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0') return false;
  var error = body.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  return Number.isInteger(error.code) && typeof error.message === 'string';
}
// The ray id the edge gave its refusal: the cf-ray header first, else one named in the page.
function hivekuEdgeRayId(headers, text) {
  var header = String((headers && typeof headers.get === 'function' && headers.get('cf-ray')) || '').trim();
  if (/^[0-9a-f]{16}(?:-[a-z]{3,4})?$/i.test(header)) return header;
  var found = String(text || '').slice(0, 65536).match(/ray[\s_-]*id[\s\S]{0,80}?(?<![0-9a-z])([0-9a-f]{16})(?![0-9a-z])/i);
  return found ? found[1] : null;
}
function hivekuEdgeRefusalText(status, rayId) {
  var byText = status === 401 || status === 403;
  var label = rayId ? 'HTTP ' + status + ', ray id ' + rayId : 'HTTP ' + status;
  var give = rayId ? 'ray id ' + rayId : 'the time it happened';
  var what = byText
    ? 'The web edge in front of Hiveku refused this one request (' + label + '), most often because of something in its text.'
    : 'The web edge in front of Hiveku turned this one request away (' + label + '). It does that when it is busy, and also ' +
      "because of something in a request's text.";
  var next = byText
    ? 'Try it again with the text shortened or rephrased: code and file paths are the usual cause. If every request ' +
      'is refused this way, even a plain one, the block is on where the requests come from, not on their text: tell ' +
      'Hiveku support and give them ' + give + '.'
    : 'Wait a minute and try it once more. If it is turned away again, shorten or rephrase the text: code and file ' +
      'paths are the usual cause. If it keeps happening, tell Hiveku support and give them ' + give + '.';
  return what + ' It never reached Hiveku and nothing was saved. Hiveku did not refuse your key, so there is no need to ' +
    'reconnect: the next request is sent as usual. ' + next;
}
function hivekuRefusalUnreadText(status) {
  return 'The answer to this request (HTTP ' + status + ') could not be read, so it is not known whether Hiveku or ' +
    'the web edge in front of Hiveku refused it. It is not taken as a sign that your key stopped working: the next ' +
    'request is sent as usual. Try it once more.';
}
// The Error for a 401, 403 or 429 that Hiveku did not answer itself, or null when Hiveku did (or for any other
// status). text is null when the answer could not be read: who refused is then not known, and it is still no key problem.
function hivekuEdgeRefusal(res, text) {
  if (res.status !== 401 && res.status !== 403 && res.status !== 429) return null;
  if (text !== null && hivekuErrorAnswer(text)) return null;
  var err = new Error(text === null ? hivekuRefusalUnreadText(res.status) : hivekuEdgeRefusalText(res.status, hivekuEdgeRayId(res.headers, text)));
  err.edgeRefusal = true;
  return err;
}
`;
