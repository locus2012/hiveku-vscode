/** Load a compiled module from out/ with the vscode stub in place. */
import './vscode-stub.mjs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const OUT = path.join(here, '..', '..', 'out');

export function loadOut(name) {
  return require(path.join(OUT, `${name}.js`));
}

/** A fake MCP client: answers by tool name, records every call. */
export function fakeClient(answers) {
  const seen = [];
  return {
    seen,
    async callToolJson(name, args = {}) {
      seen.push({ name, args });
      const a = answers[name];
      if (a instanceof Error) throw a;
      if (typeof a === 'function') return a(args);
      if (a === undefined) throw new Error(`unexpected tool ${name}`);
      return a;
    },
  };
}
