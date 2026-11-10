/**
 * One string inside a JSON file changed in the file's own text, every other
 * byte as it was.
 *
 * Reading a file with JSON.parse and writing it back with JSON.stringify also
 * redoes its spacing and line endings, rounds numbers such as 1.0, and turns
 * escapes into raw characters. In a .mcp.json the rest of the file is the
 * person's own servers, written their own way, so a change to one header must
 * leave all of that alone.
 *
 * Only for text JSON.parse has accepted: the walk below trusts its quotes and
 * brackets. replaceJsonString checks its own result by parsing it again and
 * answers null rather than return anything else.
 */

interface Span {
  start: number;
  end: number;
}

const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

function skipSpace(text: string, at: number): number {
  let i = at;
  while (isSpace(text[i])) i += 1;
  return i;
}

/** Just past the string whose opening quote is at `at`. */
function stringEnd(text: string, at: number): number {
  let i = at + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

/** Just past the value that starts at `at`. */
function valueEnd(text: string, at: number): number {
  const first = text[at];
  if (first === '"') return stringEnd(text, at);
  let i = at;
  if (first !== '{' && first !== '[') {
    // A number, true, false or null: up to the next space, comma or closing bracket.
    while (i < text.length && !isSpace(text[i]) && !',]}'.includes(text[i])) i += 1;
    return i;
  }
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = stringEnd(text, i);
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return i;
}

/**
 * Where the value of the member `name` sits in the object whose `{` is at
 * `open`, or null. JSON.parse keeps the last of a name written twice, and so
 * does this.
 */
function memberValue(text: string, open: number, name: string): Span | null {
  let found: Span | null = null;
  let i = skipSpace(text, open + 1);
  while (text[i] === '"') {
    const nameEnd = stringEnd(text, i);
    const member = JSON.parse(text.slice(i, nameEnd)) as string;
    // Past the colon to the value.
    const start = skipSpace(text, skipSpace(text, nameEnd) + 1);
    const end = valueEnd(text, start);
    if (member === name) found = { start, end };
    i = skipSpace(text, end);
    if (text[i] === ',') i = skipSpace(text, i + 1);
  }
  return found;
}

/** Where the value at `path` sits in `text`, or null when a step of the path is missing or not an object. */
function valueSpan(text: string, path: readonly string[]): Span | null {
  const start = skipSpace(text, 0);
  let span: Span | null = { start, end: valueEnd(text, start) };
  for (const name of path) {
    if (text[span.start] !== '{') return null;
    span = memberValue(text, span.start, name);
    if (!span) return null;
  }
  return span;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** `parsed` with the value at `path` set to `value`, or null when a step of the path is not an object holding it. */
function withValue(parsed: unknown, path: readonly string[], value: string): unknown {
  if (path.length === 0) return value;
  if (!isRecord(parsed) || !Object.prototype.hasOwnProperty.call(parsed, path[0])) return null;
  const inner = withValue(parsed[path[0]], path.slice(1), value);
  if (inner === null) return null;
  parsed[path[0]] = inner;
  return parsed;
}

/**
 * `text` with the string at `path` replaced by `value`, every other byte as it
 * was. Null when there is no string there, or when the result would not parse
 * to exactly what `text` holds with that one string changed.
 */
export function replaceJsonString(text: string, path: readonly string[], value: string): string | null {
  let expected: unknown;
  try {
    expected = withValue(JSON.parse(text), path, value);
  } catch {
    return null;
  }
  const span = valueSpan(text, path);
  if (expected === null || !span || text[span.start] !== '"') return null;
  const next = `${text.slice(0, span.start)}${JSON.stringify(value)}${text.slice(span.end)}`;
  try {
    return JSON.stringify(JSON.parse(next)) === JSON.stringify(expected) ? next : null;
  } catch {
    return null;
  }
}
