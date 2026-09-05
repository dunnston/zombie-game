# Lessons

Patterns worth remembering, written down as they were learned.

## Test the thing, not the model of the thing

Four of the most serious bugs in this project were invisible in code review and
obvious within seconds of actually running the game:

- **Bullets collided with the player's own structures.** The comment in
  `combat.js` even said they shouldn't — the code just never did it. A walled
  base could not shoot out, which silently broke turrets, the raid loop and the
  entire point of building walls. Found by watching a raid and noticing kills
  stayed at zero.
- **Threat decay ran before the raid check** in the same frame, so the meter
  could never actually reach its threshold. Raids were unreachable.
- **Raids stalled forever** when a single raider got wedged on terrain, which
  permanently blocked progression.
- **Death backpacks lost interaction priority** to a nearby workbench, so dying
  at your own base made your gear unrecoverable.

**Rule:** for anything with a runtime loop, write a harness that drives the real
system and asserts on outcomes (`killed > 0`, `raid completes`), not on
intermediate state. Assertions about *outcomes* catch whole classes of bug that
assertions about *calls* never will.

## Distinguish test-setup failures from product failures

Several early failures were the harness's fault, not the game's: placing
structures on tree tiles, standing just outside interact range, flooding XP so
the level-up panel paused the world. Before changing product code, confirm the
failure reproduces under conditions a real user would hit.

But don't dismiss them either — two of those "test bugs" pointed at real issues
worth fixing anyway (interact range was genuinely tight; trees blocking turret
fire with no way to clear them was a genuine design gap, which became the tree
chopping mechanic).

## Put every tunable number in one file

`config.js` holding all weapons, enemies, structures, recipes, loot tables,
upgrades and raid specs made three separate balance passes cheap, and let the
unit tests assert relationships (`brute.hp > runner.hp * 3`, wall tiers
ordered, tier-2 recipes gated) instead of just checking values exist.

## Break import cycles with a dedicated module

Player, enemies, combat and building all needed to damage each other. Routing
every hit through a single `damage.js` kept the graph acyclic instead of relying
on ESM cycle semantics to happen to work.

## Readability beats fidelity in a top-down game

The first playable build had the player nearly indistinguishable from the
zombies in a crowd. The fix was not better art — it was a two-tone ground ring
(dark under light, so it reads on both grass and pale shop floors), a brighter
palette for the survivor than for anything hostile, and a forward-pointing cap
brim. Ask "can I find myself in a crowd at a glance?" before adding detail.

## Handle devicePixelRatio explicitly

Drawing the HUD in device pixels made 12px text render at 6 CSS pixels on a 2x
display. Author UI in CSS pixels, scale the context by DPR, and divide mouse
coordinates by DPR for hit testing. Test at DPR 1 *and* 2.
