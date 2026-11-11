/**
 * Changes to a JSON file made in the file's own text, every other byte as it
 * was: one string replaced (replaceJsonString), or strings added to the end of
 * an array (appendJsonStrings).
 *
 * Reading a file with JSON.parse and writing it back with JSON.stringify also
 * redoes its spacing and line endings, rounds numbers such as 1.0, and turns
 * escapes into raw characters. In a .mcp.json the rest of the file is the
 * person's own servers, and in a .claude/settings.json the person's own
 * settings, written their own way, so a change to one header or one list must
 * leave all of that alone.
 *
 * Only for text JSON.parse has accepted: the walk below trusts its quotes and
 * brackets. Each change checks its own result by parsing it again and answers
 * null rather than return anything else.
 */

interface Span {
  start: number;
  end: number;
}

interface Member {
  name: string;
  /** The member's name, from its opening quote to just past its closing one. */
  nameStart: number;
  nameEnd: number;
  value: Span;
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

/** The members of the object whose `{` is at `open`, in the order they are written. */
function memberSpans(text: string, open: number): Member[] {
  const members: Member[] = [];
  let i = skipSpace(text, open + 1);
  while (text[i] === '"') {
    const nameEnd = stringEnd(text, i);
    // Past the colon to the value.
    const start = skipSpace(text, skipSpace(text, nameEnd) + 1);
    const end = valueEnd(text, start);
    members.push({ name: JSON.parse(text.slice(i, nameEnd)) as string, nameStart: i, nameEnd, value: { start, end } });
    i = skipSpace(text, end);
    if (text[i] === ',') i = skipSpace(text, i + 1);
  }
  return members;
}

/**
 * Where the value of the member `name` sits in the object whose `{` is at
 * `open`, or null. JSON.parse keeps the last of a name written twice, and so
 * does this.
 */
function memberValue(text: string, open: number, name: string): Span | null {
  let found: Span | null = null;
  for (const member of memberSpans(text, open)) if (member.name === name) found = member.value;
  return found;
}

/** The values in the array whose `[` is at `open`, in order. */
function elementSpans(text: string, open: number): Span[] {
  const elements: Span[] = [];
  let i = skipSpace(text, open + 1);
  while (i < text.length && text[i] !== ']') {
    const end = valueEnd(text, i);
    if (end <= i) break;
    elements.push({ start: i, end });
    i = skipSpace(text, end);
    if (text[i] === ',') i = skipSpace(text, i + 1);
  }
  return elements;
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

/** The file's line ending: CRLF when its first line ends so, LF otherwise. */
function lineEnding(text: string): string {
  const at = text.indexOf('\n');
  return at > 0 && text[at - 1] === '\r' ? '\r\n' : '\n';
}

/** What one level of nesting adds in this file: the indent of its first indented line, or two spaces when none is. */
function indentUnit(text: string): string {
  const found = text.match(/\n([ \t]+)[^ \t\r\n]/);
  return found ? found[1] : '  ';
}

/** The spaces and tabs that start the line `at` is on. */
function lineIndent(text: string, at: number): string {
  const start = at > 0 ? text.lastIndexOf('\n', at - 1) + 1 : 0;
  let end = start;
  while (text[end] === ' ' || text[end] === '\t') end += 1;
  return text.slice(start, end);
}

const spansLines = (text: string, span: Span): boolean => text.slice(span.start, span.end).includes('\n');

/** What separates the first two items written on one line: the file's own when it is a comma and spaces, else ", ". */
function separator(text: string, firstEnd: number | undefined, secondStart: number | undefined): string {
  if (firstEnd === undefined || secondStart === undefined) return ', ';
  const between = text.slice(firstEnd, secondStart);
  return /^[ \t]*,[ \t]*$/.test(between) ? between : ', ';
}

/** `value` as JSON, a level of nesting per `unit`, each of its lines after the first starting with `indent`. */
function layout(value: unknown, unit: string, eol: string, indent: string): string {
  return JSON.stringify(value, null, unit).split('\n').join(`${eol}${indent}`);
}

/** `text` with `values` added at the end of the array at `array`. */
function addElements(text: string, array: Span, values: readonly string[], eol: string, unit: string): string {
  const strings = values.map((value) => JSON.stringify(value));
  const elements = elementSpans(text, array.start);
  const last = elements[elements.length - 1];
  if (!last) {
    // An empty array: a string a line, a level in from the line the array opens on.
    const outer = lineIndent(text, array.start);
    const body = strings.map((s) => `${eol}${outer}${unit}${s}`).join(',');
    return `${text.slice(0, array.start)}[${body}${eol}${outer}]${text.slice(array.end)}`;
  }
  let added: string;
  if (spansLines(text, array)) {
    const indent = lineIndent(text, last.start);
    added = strings.map((s) => `,${eol}${indent}${s}`).join('');
  } else {
    const sep = separator(text, elements[0]?.end, elements[1]?.start);
    added = strings.map((s) => `${sep}${s}`).join('');
  }
  return `${text.slice(0, last.end)}${added}${text.slice(last.end)}`;
}

/** `text` with the member `name` (holding `value`) added as the last member of the object at `object`. */
function addMember(text: string, object: Span, name: string, value: unknown, eol: string, unit: string): string {
  const key = JSON.stringify(name);
  const members = memberSpans(text, object.start);
  const last = members[members.length - 1];
  if (!last) {
    // An empty object: the member on a line of its own, a level in from the line the object opens on.
    const outer = lineIndent(text, object.start);
    const inner = `${outer}${unit}`;
    return `${text.slice(0, object.start)}{${eol}${inner}${key}: ${layout(value, unit, eol, inner)}${eol}${outer}}${text.slice(object.end)}`;
  }
  const between = text.slice(last.nameEnd, last.value.start);
  const colon = /^[ \t]*:[ \t]*$/.test(between) ? between : ': ';
  let added: string;
  if (spansLines(text, object)) {
    const indent = lineIndent(text, last.nameStart);
    added = `,${eol}${indent}${key}${colon}${layout(value, unit, eol, indent)}`;
  } else {
    added = `${separator(text, members[0]?.value.end, members[1]?.nameStart)}${key}${colon}${JSON.stringify(value)}`;
  }
  return `${text.slice(0, last.value.end)}${added}${text.slice(last.value.end)}`;
}

/** `values` as an array, inside an object for each name in `path`. */
function nest(path: readonly string[], values: readonly string[]): unknown {
  let value: unknown = [...values];
  for (let i = path.length - 1; i >= 0; i -= 1) value = { [path[i]]: value };
  return value;
}

/** `text` with `values` added at the end of the array at `path`, or null when a step is not an object or the end not an array. */
function insertStrings(text: string, path: readonly string[], values: readonly string[]): string | null {
  const eol = lineEnding(text);
  const unit = indentUnit(text);
  const start = skipSpace(text, 0);
  let span: Span = { start, end: valueEnd(text, start) };
  for (let depth = 0; depth < path.length; depth += 1) {
    if (text[span.start] !== '{') return null;
    const inner = memberValue(text, span.start, path[depth]);
    if (!inner) return addMember(text, span, path[depth], nest(path.slice(depth + 1), values), eol, unit);
    span = inner;
  }
  return text[span.start] === '[' ? addElements(text, span, values, eol, unit) : null;
}

/** `parsed` with `values` at the end of the array at `path`, each missing step added; null when a step is not an object or the end not an array. */
function withAppended(parsed: unknown, path: readonly string[], values: readonly string[]): unknown {
  if (path.length === 0) return Array.isArray(parsed) ? [...(parsed as unknown[]), ...values] : null;
  if (!isRecord(parsed)) return null;
  const [name, ...rest] = path;
  const current = Object.prototype.hasOwnProperty.call(parsed, name) ? parsed[name] : rest.length === 0 ? [] : {};
  const inner = withAppended(current, rest, values);
  if (inner === null) return null;
  parsed[name] = inner;
  return parsed;
}

/**
 * `text` with `values` added at the end of the array at `path`, every other
 * byte as it was. A member missing on the way (the array itself, or an object
 * that would hold it) is added as the last member of its object. Where the
 * array or object is written over several lines, each new string or member
 * goes on a line of its own, indented like the one before it and ended like
 * the file's own lines; where it is written on one line, it stays on that
 * line. Appending nothing returns `text` as it is. Null when a step of the
 * path is there but is not an object, the end of it is there but is not an
 * array, or the result would not parse to exactly what `text` holds with
 * `values` added there.
 */
export function appendJsonStrings(text: string, path: readonly string[], values: readonly string[]): string | null {
  let expected: unknown;
  try {
    expected = withAppended(JSON.parse(text), path, values);
  } catch {
    return null;
  }
  if (expected === null) return null;
  if (values.length === 0) return text;
  const next = insertStrings(text, path, values);
  if (next === null) return null;
  try {
    return JSON.stringify(JSON.parse(next)) === JSON.stringify(expected) ? next : null;
  } catch {
    return null;
  }
}
