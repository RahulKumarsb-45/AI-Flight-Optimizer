/**
 * Minimal ESM loader hook, used ONLY by the test runner, that resolves the
 * "@/..." path alias the same way frontend/jsconfig.json defines it
 * (baseUrl "." + paths "@/*" -> "./*", i.e. "@/x" === frontend/x).
 *
 * This exists solely so plain `node --test` can load frontend source files
 * that use the "@/" alias (e.g. services/weatherService.js importing
 * "@/lib/apiClient"). It does not change how the app itself resolves the
 * alias (that's handled by Next.js/webpack at build time) and is never
 * loaded outside of test runs.
 */
import { pathToFileURL } from 'node:url';

// frontend/tests/support/ -> frontend/
const FRONTEND_ROOT = new URL('../../', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    let rest = specifier.slice(2);
    if (!/\.[a-zA-Z]+$/.test(rest)) rest += '.js';
    return nextResolve(new URL(rest, FRONTEND_ROOT).href, context);
  }
  return nextResolve(specifier, context);
}
