/**
 * Registers aliasLoader.mjs for the test process. Loaded via `node --import`
 * (see package.json's "test" script / README testing notes) rather than the
 * deprecated `--experimental-loader` flag.
 */
import { register } from 'node:module';

register('./aliasLoader.mjs', import.meta.url);
