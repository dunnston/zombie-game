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

### A frame-counted wait is a wall-clock trap in a background tab

The smoke suite's `seconds(n)` is `frames(n * 60)`. Chrome throttles
`requestAnimationFrame` to about 1fps in a backgrounded tab, so the same suite
that runs in three minutes with focus takes over two hours without it — and the
only symptom was the budget guard firing with "likely a stuck loop". A good
half hour went into hunting a stall in freshly written spawn code that was
working correctly the whole time.

**Rule:** drive the browser suite with the page fronted
(`page.bringToFront()`), and when a time budget trips, report the observed
frame rate in the error. The guard now says whether it saw a throttled tab or a
real stall.

### Calibrate a threshold by measuring it, not by picking a round number

The quiet field started with a suppression threshold of "75% of the ceiling",
which sounded principled and was arbitrary. Measured, the same six kills read
back anywhere from 3.97 to 5.89 depending on where in a 256px cell the player
happened to stand — straddling that threshold, so clearing your base site
worked or did not by luck. Two fixes fell out: sample the field bilinearly, and
set the threshold from the measured distributions (three kills top out at 2.84,
five kills bottom out at 2.91, so 2.9 separates them cleanly).

**Rule:** for any coarse spatial field, check that the same action gives the
same result wherever the player is standing. And a constant that separates two
outcomes should be derived from the measured spread of both.

### Keep the API, change what is behind it

The inventory rewrite turned the player's pack from an id->count map into a
grid of slots. It touched ~40 call sites across building, crafting, combat,
loot, survivors and vehicles — except it did not, because `addRes`, `takeRes`
and `countRes` kept their exact signatures and learned to recognise the new
container shape. Every one of those call sites compiled and passed unchanged.

**Rule:** when changing a representation, look for the narrow API in front of
it first. If there isn't one, consider building it before making the change.

### A partially-applied patch that writes nothing still needs reading

The scripted edit helper applies a whole spec in memory and exits on the first
miss, writing nothing. That is the right behaviour — but it means one bad entry
silently discards the good ones alongside it. A `stowInTrunk` fix was lost that
way and only surfaced later as `NaN in the boot`, well downstream of the cause.

**Rule:** read the output of every scripted edit, not just the exit code, and
re-check that the change you thought you made is in the file.

### Two systems measuring the same thing will disagree

Carry capacity was checked against the weight of the pack; the weight bar drew
the pack *plus* the hotbar. Loot kept fitting after the bar passed 100%. Both
halves were individually reasonable, which is why it survived review and only
fell out of an assertion comparing the two numbers.

**Rule:** when a quantity is displayed in one place and enforced in another,
make both call the same function. `packAllowance()` is now the only answer to
"how much more will fit".

### A hand-written prefix list is a deletion waiting to happen

Loot entries are prefixed ids (`weapon:rifle`, `item:bandage`, `gear:milVest`).
Three separate places decoded that grammar with their own if-chain, and adding
`gear:` updated only one of them. The other two classified a helmet as a
resource, spawned a pickup with the id `gear:riotHelm`, failed to look it up,
and deleted it on contact — rare gear destroyed silently, with no error.

**Rule:** a string grammar needs exactly one encoder and one decoder, exported
and shared. `entryToPickup` / `pickupEntryId` are now that pair, and the two
survivor cargo paths call them instead of re-deriving the rules.

### Never spend the cost before checking the destination that will actually be used

`craftStatus` checked "is there a free slot in the pack *or* the hotbar", then
`craft` put armour in the pack unconditionally. A full pack with one free
hotbar slot passed the check, spent the materials, and dropped the vest into
nothing. Consumables had no space check at all.

**Rule:** the precondition must name the same container the action writes to.
And behind it, make the failure non-destructive anyway — anything that will not
fit now lands at the player's feet rather than ceasing to exist.

### "No room" is not a reason to destroy something

Four of five findings in one review were the same bug wearing different hats: an
item with nowhere to go was dropped from existence instead of left on the floor.
A full inventory is a normal state, and the player's remedy — make room, come
back — only works if the thing is still there.

**Rule:** for anything the player could have kept, the failure mode is "on the
ground", never "gone".

## Round 5 — the multiplayer foundation

### A hidden page runs no frames, and a suite that waits on frames waits forever

The in-app browser pane was hidden, so Chromium never fired
`requestAnimationFrame`. The game loop never stepped — `G.time` stayed at 0
for five minutes — but `G.fps` read 60 the whole time, because 60 is the value
it is initialised to and nothing ever ran to change it. The smoke suite neither
passed nor failed: its deadline guard lived inside the frame wait, and the
frame wait never returned. Two things fixed it. The frame wait now races a
plain `setTimeout` and fails with "rAF has not fired for 5s — the page is
hidden" instead of hanging. And the suite is run under Playwright, whose page
actually renders.

**Rule:** a guard that only runs when the thing it guards is making progress is
not a guard. Put the watchdog on a clock the failure cannot stop. And when a
number has not changed in a while, ask whether it is being measured at all.

### Vite reloads the page for files that are not in the bundle

Saving `tests/browser-smoke.js` mid-run reloaded the game and silently killed a
three-minute suite; the only symptom was `__smokeStart` coming back undefined.
Vite does a full reload for any change under the project root that is not in
the module graph. `server.watch.ignored` now covers `tasks/`, `*.md` and `.claude/` — so editing
the docs during a playtest no longer restarts the game. It does *not* cover
`tests/`: the same watcher invalidates Vite's transform cache, and ignoring the
test files meant an edited suite was served stale. A run reported 298 passes
against a file that had 301, silently. A reload is loud; stale is silent.

**Rule:** do not edit files while a browser run is in flight, and make the dev
server ignore everything that is not source.

### Make the local alias a getter, then hunt the exceptions

`G.player` had 122 references. Around 100 of them meant "me, for the camera
and the HUD" and were correct as written; ~20 meant "whoever did this" and
were the bug in waiting. Turning `G.player` into a getter over
`G.players[localIdx]` left the hundred alone and made the twenty stand out as
the places that had to grow a parameter. Renaming everything would have been
a week of churn hiding the same twenty decisions.

**Rule:** when a singleton becomes a collection, keep the old name as an alias
for the common meaning and change only the sites that meant something else.

### Read the input in exactly one place

`updatePlayer` read the keyboard directly, with UI rules ("a panel swallows
input", "build mode owns the mouse") mixed into the movement and combat code.
Moving all of it into `gatherLocalIntent()` — one function that turns keys into
an intent struct — meant the sim could be driven by a struct from anywhere,
and the smoke test drives a second player by writing to `p2.intent`. The UI
rules got simpler too, because they now live where the input is read.

**Rule:** the simulation acts on data. Anything that reads a device is a
boundary, and a boundary should be one function.

### The suite that "covers combat" had never let the player land a kill

After the refactor, a bullet's owner became the player object instead of the
string `'player'`. `creditSurvivorKill` did `ownerTag.startsWith(...)` on it
and threw — on every kill the player made — and each throw aborted the rest of
that simulation step. The smoke suite passed 298/298: its combat section
checks that a swing *damages* and a shot *consumes ammo*, and every actual kill
in the suite is made by a turret, a survivor or the debug API. The raid harness
found it in the first minute, because there the player actually fights.

**Rule:** when a value changes type, grep for every consumer, and check the
suite has a case where the *player* does the thing — not just a proxy for it.
The smoke suite now has one.

## Round 6 — title screen, save slots, key bindings

### A test suite that writes to the browser must leave it as it found it

Every `api.saveGame()` in the smoke suite now lands in a save slot, and the
suite saves a dozen times from games it started itself. Without cleanup, one
run would leave the player's LOAD GAME screen full of "Game 7", "Game 8"…
and reset their key bindings. The suite records the slots and bindings it
finds at the start and restores both at the end — and asserts that it did.

**Rule:** if a test touches persistent state a person can see, the last thing
it does is put that state back, and it checks.

### When two modules need each other's helpers, neither should own them

The title screen needed the HUD's panels and buttons; the HUD needed the
menu's controls panel for the pause menu. Importing across both ways is a
cycle that works until it does not. Moving the kit into `ui/kit.js` made it a
leaf both can import, and the HUD file got shorter for it.

### The keyboard is read in one place, so rebinding was a lookup table

Because PR #9 had already put every simulation key read behind
`gatherLocalIntent()`, making the keys rebindable meant replacing
`key('KeyW')` with `act('moveUp')` in one file plus the handful of UI keys in
`game.js`. The boundary paid for itself one round after it was drawn.

### Assert the rule, not the prop

The roadkill check planted one walker in the road and asserted that *that
walker* died. The driver got exactly one walker's XP and the local player got
none — the rule held — but the car had met an ambient walker first, so the
planted one survived and the test failed. The assertion now reads: a kill
happened, it paid the driver, it paid nobody else. Two walkers in the road for
good measure.

**Rule:** when a test sets up a prop to provoke behaviour, assert the
behaviour. The prop is scaffolding; the world is allowed to supply its own.
