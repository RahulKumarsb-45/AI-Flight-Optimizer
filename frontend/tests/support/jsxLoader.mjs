/**
 * Test-only ESM loader hook. Extends aliasLoader.mjs with two things a
 * plain `node` process needs (that Next.js/webpack normally provide) to
 * load component files under test:
 *
 *  1. JSX transform: .jsx files are compiled to plain JS with esbuild
 *     (dev-only dependency, no config file, no babel) before Node parses
 *     them. Production behavior is untouched — this only affects how the
 *     TEST RUNNER loads .jsx source, not how Next.js builds the app.
 *  2. "@/" alias resolution — see aliasLoader.mjs for details, merged in
 *     here so a single --import registers both.
 */
import { readFile } from 'node:fs/promises';
import esbuild from 'esbuild';

const FRONTEND_ROOT = new URL('../../', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    // Split off any "?query" (and "#hash") BEFORE inspecting/appending an
    // extension. Tests cache-bust component imports with e.g.
    // "@/components/Foo.jsx?case=3" to force a fresh module instance per
    // test; without stripping the query first, the extension regex below
    // sees "...jsx?case=3" (fails the extension check) and the loop would
    // append another extension after the query string, producing a bogus
    // path. The query/hash is reattached to the resolved URL afterward so
    // each call still gets a distinct URL (cache-busting is preserved) and
    // load()'s pathname check still finds the real ".jsx" file extension.
    let rest = specifier.slice(2);
    let suffix = '';
    const suffixIndex = rest.search(/[?#]/);
    if (suffixIndex !== -1) {
      suffix = rest.slice(suffixIndex);
      rest = rest.slice(0, suffixIndex);
    }
    if (!/\.[a-zA-Z]+$/.test(rest)) {
      // Extensionless "@/" specifier: try the extensions Next.js itself
      // resolves, in the same order, since the actual file may be either
      // plain JS or JSX (e.g. components/ui/Tabs.jsx).
      for (const ext of ['.js', '.jsx', '.ts', '.tsx']) {
        try {
          return await nextResolve(new URL(rest + ext + suffix, FRONTEND_ROOT).href, context);
        } catch (err) {
          if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
        }
      }
      // None resolved: fall through to the original ".js" attempt so the
      // error message still points at the expected default path.
      rest += '.js';
    }
    return nextResolve(new URL(rest + suffix, FRONTEND_ROOT).href, context);
  }
  // Extensionless relative imports (e.g. "./OptimizerLoadingState", used
  // throughout the real component source, and by `t.mock.module(...)`
  // calls in tests mocking those same sibling modules). Webpack/Next
  // resolve these at build time; plain Node ESM requires an explicit
  // extension, so — same strategy as the "@/" case above — try each
  // extension Next would, relative to the importing module.
  //
  // Module-cache identity: when the IMPORTING module itself was loaded
  // with a cache-busting "?case=N" query (tests do this on the top-level
  // component, e.g. "@/components/results/ResultsContent.jsx?case=3", to
  // force a fresh instance per test), propagate that same query onto its
  // relative sibling imports (e.g. "./NearbyPlacesCard"). Those siblings
  // are real, un-busted production components that themselves import a
  // MOCKED "@/" dependency (e.g. "@/services/placesService"); ES modules
  // only resolve/link imports once, so without this propagation the
  // sibling's module instance — and its binding to that mocked
  // dependency — would stay cached (and stale) from whichever test first
  // loaded it, permanently pinned to that test's now-torn-down mock
  // instead of re-resolving against the CURRENT test's mock. Propagating
  // the parent's cache-bust query forces a fresh sibling instance (and
  // thus a fresh, correctly-mocked import) alongside the parent. The
  // aliased "@/" specifier being mocked is deliberately NOT given this
  // treatment (see the "@/" branch above) — it must resolve to its
  // plain, un-busted URL so `t.mock.module('@/services/placesService', ...)`
  // (registered against that same plain specifier) still matches it.
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    let rest = specifier;
    let suffix = '';
    const suffixIndex = rest.search(/[?#]/);
    if (suffixIndex !== -1) {
      suffix = rest.slice(suffixIndex);
      rest = rest.slice(0, suffixIndex);
    }
    if (!suffix) {
      const parentSuffixIndex = context.parentURL.search(/[?#]/);
      if (parentSuffixIndex !== -1) suffix = context.parentURL.slice(parentSuffixIndex);
    }
    if (!/\.[a-zA-Z]+$/.test(rest)) {
      for (const ext of ['.js', '.jsx', '.ts', '.tsx']) {
        try {
          return await nextResolve(rest + ext + suffix, context);
        } catch (err) {
          if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
        }
      }
      // None resolved: fall through to the original specifier so the
      // error message still points at the expected default path.
    } else if (suffix) {
      return nextResolve(rest + suffix, context);
    }
  }
  // next/image needs Next's own build/runtime context, which isn't present
  // outside `next build`/`next dev`. Swap in a plain-<img> stub for tests
  // only — see nextImageStub.jsx for why.
  if (specifier === 'next/image') {
    return nextResolve(new URL('./nextImageStub.jsx', import.meta.url).href, context);
  }
  // Other "next/*" subpath imports (e.g. next/navigation): the "next"
  // package ships these as plain .js files but has no "exports" map, so
  // Node's ESM resolver — unlike its CJS/webpack resolver — won't append
  // the extension for a bare extensionless subpath and throws
  // ERR_MODULE_NOT_FOUND. Node mocks (t.mock.module) still need this to
  // resolve to get a real URL to intercept, so append .js ourselves.
  if (specifier.startsWith('next/') && !/\.[a-zA-Z]+$/.test(specifier)) {
    try {
      return await nextResolve(specifier + '.js', context);
    } catch (err) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  // Compare the pathname, not the raw url — cache-busting query strings
  // (used by tests to force a fresh module instance) would otherwise hide
  // the .jsx extension from a plain endsWith check.
  if (new URL(url).pathname.endsWith('.jsx')) {
    const rawSource = await readFile(new URL(url), 'utf8');
    const { code } = esbuild.transformSync(rawSource, {
      loader: 'jsx',
      format: 'esm',
      jsx: 'automatic',
      sourcemap: 'inline',
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
