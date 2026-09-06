# Lessons

The raw running log. The distilled version lives in `PROJECT.md` §8 — add to
both, and keep this one chronological.

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

---

## Round 2 — attributes, day/night, survivors

### Prefer a recompute pass to mutation

The first upgrade system applied its effect when you bought it. That works
exactly once: on load, reapplying the owned upgrades double-counts everything.
Rebuilding all derived stats from scratch (base → attributes → perks) made
save/load, respawn and any future respec correct by construction, and it is
cheap enough to run on every purchase.

**Rule:** if a value can be derived, derive it. Do not accumulate it.

### A hanging test suite is worse than a failing one

An unbounded `while (attrs.x < n) raiseAttribute(...)` spun the main thread when
the purchase started failing, so requestAnimationFrame never fired and the whole
run wedged for thirty minutes. Every wait in the browser suite now checks an
absolute deadline and throws loudly.

**Rule:** bound every loop in a test, and give the suite a hard time budget.

### Watch for stale object references across a reload

`loadGame()` swaps `G.player` for a fresh object. A `const p = G.player` captured
earlier kept pointing at the old one, so later assertions silently tested a ghost
that nothing was updating. Re-read the reference after anything that rebuilds
state.

## Round 3 — furniture, bunks, survivor jobs

### Cross-type state needs clearing, not just updating

Jobs shared one `runTarget` field but targeted different kinds of object —
containers for scavengers, structures for builders. Switching job left the
previous target in place, so a builder recalled from scavenging tried to
"repair" a bookshelf and poisoned its hp arithmetic with NaN. Reassignment now
clears the field, and both routines type-check what they were handed.

**Rule:** when one field can hold several shapes, clear it on transition and
validate it on read.

### Content references need a test

`crate`, `locker` and `safe` were named by the world generator but had never
been defined as containers, so those picks silently did nothing for the whole
life of the project. A single test walking every furnishing table against the
container registry found all three instantly.

**Rule:** assert that every data reference resolves. Dangling content ids fail
quietly.

### Say which limit is binding

The survivor cap became `min(charisma, bunks)`. Telling the player "no room" was
useless — they cannot tell which of the two to fix. Both the refusal message and
the roster now name the binding limit.

## Round 4 — cars, and a document

### Measure that a mitigation actually mitigates

The scavenger's "prefer containers with line of sight" check passed **0 of 281**
containers, because every container marks its own tile blocked and the ray ran
all the way to the centre. It did not error; it degraded silently into "always
pick the nearest, walls or not" — the exact behaviour it was written to avoid.
After stopping the ray short of the target tile: 123 of 281.

**Rule:** when you add a heuristic, measure it doing something. A no-op
heuristic is indistinguishable from a working one until you count.

### Global averages are not local anchors

Both travelling jobs searched within a radius of `baseCenter()`, which averages
every structure in the world. With two settlements far apart, that midpoint sits
in empty ground and neither settlement falls inside the radius. Anchor local
behaviour on something local — the stash the worker actually delivers to.

### Ordinal ids are not identity

Save files record looted containers by their index in the generated array. Twice
now, changing how many containers a building gets has shifted every subsequent
id and invalidated saves. Both times the fix was a version bump; the real fix is
ids derived from tile position.

**Rule:** if a save references generated content, reference it by something
stable, not by generation order.

### `String.split` takes a limit, not a replacement

`s.split(a, '')` returns `[]`, and joining that gives an empty string. This
silently emptied `README.md`. Restored from git, but the lesson is broader:
prefer the dedicated edit tooling over ad-hoc string surgery on files that
matter, and check the result when you do reach for a script.

### A measuring tool that stops measuring reads as a pass

The raid harness plays the defender itself. After the defender's first death it
respawned across the map, never again found an enemy within its 250px engage
radius, and logged an identical sample every second for the rest of the run.
That flat line looked exactly like a stalled game engine — and it sent a session
hunting a pathfinding bug that was really a harness that had stopped playing.

**Rule:** when a measurement looks broken, check the instrument before the
subject. The harness now walks back to the base after a respawn.

### Reproduce on `main` before blaming the branch

The stalled raid surfaced while verifying the cars PR and looked like its
fallout. A `git worktree` of `main`, a second dev server on another port, and
ten minutes produced identical numbers — which kept an unrelated fix out of that
PR and stopped a review conversation going the wrong way.

**Rule:** a defect found during verification is not automatically a defect of
what you are verifying.

### A new assertion that passes proves nothing until you know why

"A car cannot drive through your own wall" passed on the first run — while the
car was actually being stopped by scenery an earlier test section had built
several tiles short of the wall. The verdict was right and the reasoning was
wrong. The only reason it was caught is that the assertion logged its
measurement (`stopped 80px short`) rather than just pass/fail.

**Rule:** log the number, not the verdict, and read it. An assertion whose
detail string you have never looked at is not yet a test.
