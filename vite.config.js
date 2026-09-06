import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
