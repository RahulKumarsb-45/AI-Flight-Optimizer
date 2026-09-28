/**
 * Registers jsxLoader.mjs (alias resolution + JSX transform) for the test
 * process. Load via `node --import`. Used for component-level tests only
 * (services/util tests keep using register.mjs, the lighter alias-only
 * loader, since they don't need a JSX transform).
 */
import { register } from 'node:module';

register('./jsxLoader.mjs', import.meta.url);
