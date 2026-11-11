/**
 * appendJsonStrings (src/jsonText.ts): strings added to the end of an array in
 * a JSON file's own text, every other byte as it was. ensureSpendAskRules adds
 * the ask rules to a person's .claude/settings.json this way, so their spacing,
 * line endings, escapes and numbers stay as they wrote them.
 *
 * Each expected text below is written out in full: the rest of the file must
 * come back byte for byte, and the new strings must sit where a person
 * formatting the file by hand would put them.
 *
 * Runs against the compiled extension (npm test compiles first).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadOut } from './helpers/load.mjs';

const { appendJsonStrings } = loadOut('jsonText');
const PATH = ['permissions', 'ask'];
const NEW = ['mcp__hiveku__x', 'mcp__hiveku__y'];

describe('appendJsonStrings: the new strings go in, every other byte stays', () => {
  test('an array written one string a line: each new string on its own line, indented like the last', () => {
    const text = [
      '{',
      '  "permissions": {',
      '    "allow": ["Bash(make:*)"],',
      '    "ask": [',
      '      "WebFetch",',
      '      "Bash(rm:*)"',
      '    ]',
      '  },',
      '  "timeout": 1.0, "label": "caf\\u00e9"',
      '}',
      '',
    ].join('\n');
    assert.equal(
      appendJsonStrings(text, PATH, NEW),
      text.replace('      "Bash(rm:*)"\n', '      "Bash(rm:*)",\n      "mcp__hiveku__x",\n      "mcp__hiveku__y"\n'),
    );
  });

  test('CRLF and a four-space indent: the new member uses both, the rest of the file is untouched', () => {
    const text = '{\r\n    "model": "opus",\r\n    "env": { "GREETING": "caf\\u00e9", "N": 1e0 }\r\n}';
    const expected =
      '{\r\n    "model": "opus",\r\n    "env": { "GREETING": "caf\\u00e9", "N": 1e0 },\r\n' +
      '    "permissions": {\r\n        "ask": [\r\n            "mcp__hiveku__x",\r\n            "mcp__hiveku__y"\r\n        ]\r\n    }\r\n}';
    assert.equal(appendJsonStrings(text, PATH, NEW), expected);
  });

  test('tabs: a missing ask goes in as the last member of permissions, indented with tabs', () => {
    const text = '{\n\t"model": "opus",\n\t"permissions": {\n\t\t"allow": ["Bash(make:*)"]\n\t}\n}\n';
    const expected =
      '{\n\t"model": "opus",\n\t"permissions": {\n\t\t"allow": ["Bash(make:*)"],\n\t\t"ask": [\n\t\t\t"mcp__hiveku__x",\n\t\t\t"mcp__hiveku__y"\n\t\t]\n\t}\n}\n';
    assert.equal(appendJsonStrings(text, PATH, NEW), expected);
  });

  test('an array or object written on one line stays on one line, with its own separator', () => {
    assert.equal(
      appendJsonStrings('{ "permissions": { "ask": ["WebFetch", "Bash(rm:*)"] } }\n', PATH, NEW),
      '{ "permissions": { "ask": ["WebFetch", "Bash(rm:*)", "mcp__hiveku__x", "mcp__hiveku__y"] } }\n',
    );
    assert.equal(
      appendJsonStrings('{"model":"opus","permissions":{"ask":["a","b"]}}', PATH, NEW),
      '{"model":"opus","permissions":{"ask":["a","b","mcp__hiveku__x","mcp__hiveku__y"]}}',
    );
    assert.equal(
      appendJsonStrings('{"model":"opus","effort":"high"}', PATH, NEW),
      '{"model":"opus","effort":"high","permissions":{"ask":["mcp__hiveku__x","mcp__hiveku__y"]}}',
    );
  });

  test('an empty array or object opens up onto lines, a level in from the line it starts on', () => {
    const lines = (...rows) => rows.join('\n');
    const opened = lines('{', '  "permissions": {', '    "ask": [', '      "mcp__hiveku__x",', '      "mcp__hiveku__y"', '    ]', '  }', '}');
    assert.equal(appendJsonStrings(lines('{', '  "permissions": {', '    "ask": []', '  }', '}', ''), PATH, NEW), `${opened}\n`);
    assert.equal(appendJsonStrings(lines('{', '  "permissions": {', '    "ask": [ ]', '  }', '}'), PATH, NEW), opened);
    assert.equal(appendJsonStrings(lines('{', '  "permissions": {}', '}', ''), PATH, NEW), `${opened}\n`);
    assert.equal(appendJsonStrings('{}', PATH, NEW), opened);
    assert.equal(appendJsonStrings('{}\n', PATH, NEW), `${opened}\n`);
  });

  test('a name written twice: JSON.parse keeps the last, and the strings go into that one', () => {
    const text = '{\n  "permissions": { "ask": ["first"] },\n  "permissions": { "ask": ["last"] }\n}\n';
    const out = appendJsonStrings(text, PATH, NEW);
    assert.equal(out, '{\n  "permissions": { "ask": ["first"] },\n  "permissions": { "ask": ["last", "mcp__hiveku__x", "mcp__hiveku__y"] }\n}\n');
    assert.deepEqual(JSON.parse(out).permissions.ask, ['last', ...NEW]);
  });

  test('strings, brackets and escapes elsewhere in the file do not throw the walk off', () => {
    const text = '{\n  "x": "a ] } , \\" [ {",\n  "permissions": {\n    "deny": ["Read(**/.env)"],\n    "ask": [\n      "q\\"uote"\n    ]\n  }\n}\n';
    assert.equal(appendJsonStrings(text, PATH, NEW), text.replace('      "q\\"uote"\n', '      "q\\"uote",\n      "mcp__hiveku__x",\n      "mcp__hiveku__y"\n'));
  });

  test('a string that needs escaping is written escaped', () => {
    const out = appendJsonStrings('{"permissions":{"ask":[]}}', PATH, ['Bash(echo "hi")']);
    assert.deepEqual(JSON.parse(out).permissions.ask, ['Bash(echo "hi")']);
    assert.ok(out.includes('"Bash(echo \\"hi\\")"'));
  });

  test('nothing to add: the text comes back as it is', () => {
    const text = '{ "model": "opus" }';
    assert.equal(appendJsonStrings(text, PATH, []), text);
  });

  test('null when a step is not an object, the end is not an array, or the text does not parse', () => {
    for (const text of [
      '{"permissions": "x"}',
      '{"permissions": []}',
      '{"permissions": null}',
      '{"permissions": {"ask": "WebFetch"}}',
      '{"permissions": {"ask": {"a": 1}}}',
      '[]',
      '"text"',
      '{ "permissions": { "ask": [ ',
      '',
    ]) {
      assert.equal(appendJsonStrings(text, PATH, NEW), null, text);
    }
  });
});
