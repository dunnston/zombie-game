import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * Which build this is, for the co-op version check (see net/protocol.js).
 *
 * The last commit that touched `src/` rather than HEAD: a docs-only commit on
 * one machine must not refuse a friend whose game code is identical. `-dirty`
 * when there are uncommitted changes under `src/`, because "same commit" and
 * "same code" are not the same claim while someone is mid-edit.
 *
 * No git (a downloaded tarball) gives `dev`, and two `dev` builds still have to
 * agree with each other — an unknown version is not a wildcard.
 */
function buildId() {
  const git = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    const sha = git('git log -1 --format=%h -- src/');
    if (!sha) return 'dev';
    return git('git status --porcelain src/') ? `${sha}-dirty` : sha;
  } catch { return 'dev'; }
}

export default defineConfig({
  base: './',
  // Read through the guard in net/protocol.js, so plain Node (the tests) sees
  // `dev` instead of a ReferenceError.
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(process.env.VITE_BUILD_ID || buildId()) },
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
