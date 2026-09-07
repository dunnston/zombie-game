// Which build this checkout is. One definition, imported by vite.config.js and
// run as a command by the shell scripts, so the number a player reads off
// update.sh is by construction the number the handshake compares.
//
//   node scripts/build-id.mjs      ->  c4ade95  |  c4ade95-dirty.1f3a9c02  |  dev

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const git = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

/**
 * The last commit that touched `src/` — not HEAD, so a docs-only commit on one
 * machine does not refuse a friend whose game code is identical.
 *
 * A dirty tree gets a digest of what is actually different, not a bare
 * `-dirty` suffix: two people editing the same commit in different ways must
 * not land on the same id, or the check waves through exactly the mismatch it
 * exists to catch. The same tree still hashes to the same digest, so two
 * browsers on one machine can still play each other.
 */
export function buildId() {
  try {
    const sha = git('git log -1 --format=%h -- src/').trim();
    if (!sha) return 'dev';

    const status = git('git status --porcelain src/');
    if (!status.trim()) return sha;

    // Tracked edits, plus the contents of anything untracked: a new file that
    // changes the game is a different build even though git diff ignores it.
    let material = status + git('git diff HEAD -- src/');
    for (const line of git('git ls-files --others --exclude-standard -- src/').split('\n')) {
      const f = line.trim();
      if (!f) continue;
      try { material += readFileSync(f, 'utf8'); } catch { /* vanished mid-read */ }
    }
    return `${sha}-dirty.${createHash('sha1').update(material).digest('hex').slice(0, 8)}`;
  } catch {
    return 'dev';   // no git: a downloaded copy. Two of those still must agree.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(buildId());
}
