import { defineConfig } from 'vite';
import { buildId } from './scripts/build-id.mjs';

/**
 * Stamps the build id in for a production bundle, and — because `define` is
 * frozen at config load — also serves the *current* id over the dev server.
 *
 * Without that second half the check has a hole big enough to drive the whole
 * bug through: start the server on a clean checkout, edit a `src/` module, and
 * HMR happily serves the changed game while the stamped id still says clean.
 * That browser would then agree with an unmodified peer while running
 * different code. `net/protocol.js` asks this endpoint right before the
 * handshake, and falls back to the stamped value when there is no dev server.
 */
function buildIdPlugin() {
  return {
    name: 'deadline-build-id',
    config: () => ({
      // Read through the guard in net/protocol.js, so plain Node (the tests)
      // sees `dev` instead of a ReferenceError.
      define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(process.env.VITE_BUILD_ID || buildId()) },
    }),
    configureServer(server) {
      server.middlewares.use('/__deadline_build', (_req, res) => {
        res.setHeader('content-type', 'text/plain');
        res.setHeader('cache-control', 'no-store');
        res.end(process.env.VITE_BUILD_ID || buildId());   // recomputed per request
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [buildIdPlugin()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    // Vite reloads the page whenever a file outside the module graph changes.
    // The task notes and the project docs are edited while the game is running
    // — a reload mid-playtest is not acceptable, and none of them are ever
    // fetched by the page. `tests/` is deliberately NOT here: Vite's transform
    // cache is invalidated by this same watcher, so ignoring the test files
    // meant an edited suite was served stale — silently. A reload is loud.
    watch: { ignored: ['**/tasks/**', '**/*.md', '**/.claude/**', '**/dist/**'] },
  },
  build: { target: 'es2020', outDir: 'dist' },
});
