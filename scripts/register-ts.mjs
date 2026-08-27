/**
 * Let the build scripts import the extension's TypeScript sources directly.
 *
 * WHY. src/deptData.ts is the SOURCE of the department registry that both this
 * extension and the Claude Code plugin consume, and scripts/gen-dept-manifest.mjs
 * exists to project it. But the extension is compiled by tsc, so its imports are
 * extensionless (`from './setupPlaybooks'`) — which Node's ESM resolver refuses
 * outright. Node's type-stripping handles the TYPES fine; it is RESOLUTION that
 * fails.
 *
 * That is how the generator broke without anyone noticing: it ran the day it was
 * written, then deptData.ts grew runtime imports of './mcpClient' and
 * './setupPlaybooks' and stopped running at all. Nothing in CI invoked it, so
 * the drift check went on comparing two files that neither side could
 * regenerate — the registry was pinned to whatever it happened to be that day.
 * npm run check:registry now runs both, so this cannot go quiet again.
 *
 * Appends `.ts` to extensionless relative specifiers and otherwise defers.
 * Build-time only — nothing here ships in the extension.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // Not a .ts file — fall through so Node reports the real error.
      }
    }
    return nextResolve(specifier, context);
  },
});
