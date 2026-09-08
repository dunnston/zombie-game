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

### A wall-clock probe after world generation reads the frame before

Hand probes of the menu fixes gave contradictory answers — "unpaused, but
time frozen", "loaded, but still on the title" — until sampling every 50ms
showed that for about half a second after `newGame()` or a slot load the
frames are slow, and a `sleep(300)` read state before the next frame had
processed the click. The smoke suite never saw this because its waits count
frames. Reproduce with frame-counted waits, or expect to chase ghosts.

**Rule:** in a game loop, "after" means "after the next frame", not "after N
milliseconds". Wait on frames.

### A modal drawn over live buttons is not a modal

The delete confirmation was painted over the slot list, but the immediate-mode
buttons under it were still evaluated first and `clicked()` does not consume
the press, so KEEP and a LOAD underneath could both fire on one click. Codex
caught it in review. The rows are now drawn disabled while the dialog is up.

**Rule:** with immediate-mode UI, a dialog has to disable what it covers, not
just paint over it.

### "Visible and focused" is not "running at 60fps"

A Playwright tab that had hosted six full suite runs dropped to one to three
animation frames a second while `document.visibilityState` said "visible" and
`hasFocus()` said true. CPU was at 5%. A fresh tab in the same browser ran at
60. The budget guard reported it correctly ("451 frames at 1.0fps — a
throttled tab, not a stuck loop"), which is the only reason this cost minutes
rather than an hour.

**Rule:** measure the frame rate for a second before starting a long browser
run, and start each run in a fresh tab.

## Round 7 — online co-op

### Keep the network out of the simulation, and the sim stays testable in Node

`emit()` is a no-op unless hosting, `act.*` is a direct call unless a guest,
and only `game.js` branches on `G.net.role`. Every other module reads and
writes exactly what it did in solo. That is why the whole Node suite still
runs without a browser, and why a host's game is byte-for-byte the solo game
plus a snapshot pass at the end of each step.

**Rule:** the authority runs the unchanged sim; networking is a layer that
reads it afterwards and feeds intent into it beforehand.

### A hidden page still connects

The guest for the browser-to-browser check ran in a pane whose animation
frames never fire. It still reached the broker, completed the WebRTC handshake,
received the world and twenty snapshots a second, and sent a command that
built a wall on the host — everything except stepping its own loop. Frames are
for rendering and prediction; the transport is event-driven and does not care.

**Rule:** know which parts of a system need frames and which do not, and use
the one you have. A hidden page is a perfectly good transport test.

### Markdown with backticks does not survive a shell-quoted script

Twice this session a `node -e "…"` that spliced Markdown into a doc lost its
code spans: bash saw the backticks as command substitutions, ran `F5` and
`renameSlot()` as commands, and pasted the empty results. The script reported
success both times. The second time it dropped a whole README section.

**Rule:** edit prose with the editing tool, not through a shell string. If a
script must write text containing backticks, put the script in a file.

### Drive the button, not the function behind it

START HOSTING crashed for the owner with `notify is not defined` — a missing
import in the menu's start routine. My end-to-end check had proven hosting
worked by calling `startHosting()` from the debug API, which skipped the one
function a real player goes through. The smoke suite clicks HOST and JOIN, but
stops short of START HOSTING because that needs a broker. It now has no excuse
for the layout either: subtitles were drawn at a fixed 29px in a 30px row.

**Rule:** the verification path must be the player's path. If the UI has a
button, the test clicks the button. A scan for calls to undeclared identifiers
(`scratchpad/undeclared.cjs`) now runs over the new modules before a commit.

### Silence is not neutral, and the guest's side has no test unless you build one

Codex's two P1s on the co-op PR were both about a guest *stopping*: a paused
guest sent nothing, so the host kept acting on its last intent (a silent
"walk right" carried the player 185px); a guest whose host vanished was left
in the game scene, simulating a stale copy of someone else's world as solo.
Neither showed in the loopback suite, because that suite drives the host and
only the host — the guest's transitions (pause, host gone) live in code it
never runs.

**Rules:** a protocol that keeps the last received state must also expire it
(the host now clears a guest's held intent after 400ms of silence, and a paused
guest sends "holding nothing" every step rather than nothing). And every
role-transition on the client — join, leave, host gone, pause — needs a hook
the suite can call in one browser; `client.hostGone()` is exposed for exactly
that.

### Render the map before you trust it

The 320-tile generator was checked first under Node: a script that dumps the
tiles to a PNG, floods from the camp, and lists every container without a
walkable neighbour. Before a browser frame was drawn it had found three rooms
in the *old* town that had been sealed since PR #1 (the four-room partition
could put both gaps in the far half), and a two-tile apartment cell that two
wardrobes could close. Screenshots of each district came after, for the look.

**Rule:** for anything spatial, assert reachability as an outcome. "Every
container can be reached from the camp" is now a Node test; it would have
caught the old sealed rooms on day one.

### An arena is the corridor, not the centre tile

Two co-op assertions failed on the bigger map — "enemies go for the nearest
player" measured a walker closing 254 -> 236px when it wanted 20px of progress
minimum. Nothing about enemy targeting had changed. The arena helper checked
that its chosen spot was unblocked at the centre and ±24px, then the section
spawned a walker 420px east and waited for it to walk in; on the old map the
town's clearings happened to be big enough for that to work, and on the new one
they are not. There is no pathfinding, so a single tree ends the run.

**Rule:** when a test spawns something at a distance and waits for it to arrive,
the assertion depends on the whole corridor, not the spot. Check what the test
actually needs to be empty.

## Round 8 — structure repair

### A feature nobody can reach is not shipped

The request was "add the ability to repair structures". Repair had existed
since PR #1: `repairCost()`, `repairStructure()`, a REPAIR card on the build
bar, a Builder survivor job, README and PROJECT.md entries. The card was the
fifteenth of sixteen on a bar drawn at 92px a card — and a 1400px window drew
fourteen of them. The two that fell off the end were REPAIR and DEMOLISH.

No test could have caught it: the suite reaches features through `api.*`.
A screenshot of the build bar found it in seconds.

**Rule:** when a request asks for something that already exists, the bug is
discoverability. Screenshot the path a player would take *before* touching the
logic, and put the feature where the player already is — a damaged wall now
asks for `E` with its bill on the prompt, and the raid summary counts the
damage.

### The camera leads toward the cursor, so a one-shot aimAt() drifts

`DEADLINE.aimAt(wx, wy)` places the cursor from where the camera *is*. The
camera then moves 22% of the way toward the cursor, and the world point under a
fixed screen position slides — enough to miss a 32px tile. Every earlier use
aimed at an enemy for combat, where a 20px miss is still a hit. The repair
tool's first smoke run reported `target null` for a wall the cursor was
"over".

**Rule:** anything in a test that must land on a tile re-aims every frame
until the camera settles (`aimSettled()` in the suite).

### The plan and the action must be the same list

REPAIR ALL prints a count and a bill on its button. If the button computed
that with one loop and the click ran another, the two would drift the first
time somebody tuned either. `planRepairAll()` walks a ledger and returns the
list; `repairAll()` executes that list and nothing else.

**Rule:** a preview that promises an outcome should be produced by the same
function that delivers it.

### A minimum size is a truncation in disguise

The first fix for the cut-off build bar shrank cards to fit, down to a 60px
floor. Codex pointed out that below ~988px the floor wins and the loop's
`if (x + cw > W - 8) break` truncates again — the same cards, the same bug,
just on a smaller window. Reproduced at 900px: thirteen of sixteen drawn.

**Rule:** when you clamp a layout, decide what happens *past* the clamp — wrap,
scroll, or paginate — and screenshot it there. A floor that silently reverts
to the old behaviour is not a fix.

### The suite was never the slow part; the harness around it was

A session lost well over half an hour to the browser suite and concluded it was
"taking 30 minutes". Measured, it takes **214-226 seconds**. The lost time was
three harness failures and the re-runs they caused:

- the dev server had quietly died, so three checks hung on page load with no
  output at all — indistinguishable from a slow test
- one run forgot `page.bringToFront()`, so `requestAnimationFrame` throttled to
  ~1fps; the suite counts its waits in frames, so it does not fail, it just
  never finishes
- the full suite was run four times in a session where once, at the end, was
  the job

**Rules:** measure before believing a runtime complaint — "it is slow" and "it
hung" need opposite fixes. Put the harness in the repo (`npm run smoke`) rather
than rewriting a Playwright script per session, and make it assert its own
preconditions: server reachable, page booted, frames actually running. And
match the check to the change — the four-minute suite belongs once per branch,
not once per edit.

### A prompt that appears is not a mechanic that works

Ground litter shipped with a `harvest` key (`litter_sticks`) that had no
matching `HARVEST` rule. The interact prompt read "Pick up sticks" correctly,
because the label came from a different map — and pressing E did nothing at
all. No error, no message, no resource. The label and the rule were two
sources of truth for one thing, and only one of them existed.

Caught by playing it: six presses, `got: {}` every time. A Node test now walks
every hand-gatherable prop the generator makes and fails if its harvest key has
no rule behind it.

**Rule:** when a label and a behaviour come from different tables, a test has
to tie them together — otherwise the UI cheerfully advertises a no-op.

### The player starts where the map is thinnest

Woodland density was a function of distance from the town's *edge*, which made
the town centre the barest ground on the map. The spawn point is the town
centre. Measured after the first playtest complaint: **zero** bushes and
**zero** rocks within ten tiles of where the player wakes up, when the whole
opening depends on gathering.

**Rule:** whatever the opening loop needs, assert it is present *at the spawn*,
not on average across the map. Averages hide a hole exactly where the player
is standing.

### The local player is the one nobody replicates

A guest could not see its own weapon swing. Every other player's swing worked,
on both machines. The snapshot even carries a swing flag — but the branch that
applies it is the `else` of `if (p === G.player)`, because *your own* player is
supposed to be predicted rather than copied. Prediction covered movement,
death, downed and driving. Nobody had added the swing, so it fell down the gap
between the two: not predicted, and deliberately not applied.

This is the second bug in this shape (the first: a guest's held intent never
expiring). Both live in the seam where "predict it" and "receive it" meet, and
both only affect the person doing the thing — so the host sees it working
perfectly and reports nothing wrong.

**Rule:** for anything a player does to themselves, ask the question twice —
once as "does the other side see it?" and once as "does the *actor* see it?"
The second is the one the tests miss, because the loopback suite drives the
host. It now has a section that makes the page a guest and runs
`updateClient()` for real.

### Changing the generator is changing the save format

Raising a probability in world generation looks like a content tweak. It is
not: saves store a seed, and everything else — which props were felled, where
structures stand — is replayed against a world rebuilt from it. Move the rng
stream and the replay lands on different props. Measured on one such change:
containers and vehicles were identical (generated before the woodland pass),
but 308 props had left their tile and 141 had changed kind, and a tree could
regrow inside a wall the player had built.

The fix is a version bump, which the project has always done for content
changes — but nothing enforced it, so it was missed. A Node test now
fingerprints the generated world (tiles, container ordinals, prop grid,
vehicle count) and fails unless the fingerprint and `G.version` move together.

**Rule:** if the world is rebuilt from a seed at load time, the generator *is*
part of the save format. Pin it with a test, not with discipline.

### Refusing to load is not enough; say why

Bumping the version made two silent paths visible. CONTINUE, on a save it
could not read, quietly started a *brand new world* — which to a player is
"the game deleted my run". LOAD did nothing at all: a dead button. Both had
been that way for as long as save versions have existed, and neither had ever
been hit because nobody had loaded a stale save.

**Rule:** every refusal needs a sentence. "That save is from an older build
(v9, this is v10) — the map changed" costs one line and turns a bug report
into a shrug.

### A version constant you bump by hand is a version check that does not run

Co-op refuses a guest whose `PROTOCOL` differs. `PROTOCOL` has been `1` since
multiplayer shipped — including through the map expansion, which rewrote world
generation, moved the town and bumped the save to v9. The single commit most
likely to break a cross-version session left the guard untouched, because
bumping it was something a person had to remember.

What actually caught a stale guest was an accident: the host ships its world in
the welcome, and `applySaveData` rejects a payload whose `v` differs. That only
works for changes that happen to bump the save version. A retuned loot table or
reworked combat passes both gates and desyncs silently, with no warning at all.

**Rule:** derive the identity of a build from something that changes on its own
(the commit that last touched `src/`), never from a literal someone has to
remember to edit. And make the refusal name the fix — "your game is a different
version" tells a player nothing they can act on; "run ./scripts/update.sh, then
reload" does.

### The installed dependency is not the one in package.json

`package.json` says `vite: ^5.4.11`. The installed version was **5.4.21**, and
somewhere in that range Vite added a `Host`-header check that answers
`403 Blocked request` to any hostname it does not recognise. Tunnelling the dev
server through a `trycloudflare.com` address therefore fails — and the failure
has nothing to do with the `--host` flag, which is what I guessed at first and
told the owner before checking.

Found it by curling the running server with a forged `Host` header rather than
by reading the config. IP literals pass, so LAN play is unaffected; foreign
domains do not.

**Rule:** when a caret range is in play, check what is actually installed
(`npm ls <pkg>`) before reasoning about behaviour, and probe a running server
with the request you are worried about instead of predicting its answer.

## 2026-09-07 — mining balance and the metal tools

### Measure the thing the owner is complaining about, before changing it

"It is way too easy to mine trees and boulders" could have been answered with a
guess. Measuring first turned a feel note into a fact: a tree was 70hp against
a hatchet's 83 damage a swing, so it fell in **one** hit. That is not a balance
number anyone chose — it is what happens when prop hp is set for bare hands and
then a tool with a 2.4x chop multiplier is added beside it and nobody re-checks.
The same pass measured 14,847 pieces of litter carrying ~41,000 units of free
material, which made "WAY too many" a number rather than a mood.

**Rule:** print the current figure before proposing the new one. It takes one
Node one-liner, and it changes what the fix is: this one was arithmetic, not
design.

### A balance test that re-derives the formula is not testing the formula

The first version of the swing-count test copied `chopMul` out of `chopProp()`
by hand. It would have gone on passing while the real multiplier changed under
it — the same silent no-op this project keeps rediscovering. Exporting
`chopMultiplier()` and having both the game and the test call it is two lines
and closes the gap.

**Rule:** if a test asserts a number the game computes, make it call the
function the game calls.

### Balance floors need ceilings

The litter pass had a test asserting *more than 2,000* pieces, added when the
failure was "the player can find nothing". It stayed green all the way to
14,847 and a map that read as a carpet of sticks. A budget with only a floor
only catches half the ways a number goes wrong.

**Rule:** when a test exists to protect a feel, assert the range, not the bound
you happened to be worried about that week.

### Feature order in a config file can be load-bearing

The metal tools carry the same `axe` / `pick` flags as the stone ones, because
that is how the harvest gates are matched. A test that searched `WEAPONS` for
"the tool that opens this gate" would have found the workbench-tier Fire Axe
first and concluded that wood needs a workbench — which needs wood. Defining
the metal tier after the stone one keeps the honest answer first, but the test
was rewritten to assert that *some* bench-0 tool carries the flag rather than
to trust the ordering.

**Rule:** `Object.values(...).find(...)` over a content table is an ordering
dependency. Say what you mean: `.some(...)`, or filter and check.

## A dev server in a worktree can serve you yesterday's code (2026-09-07)

Two browser measurements in the survival round were taken against a build that
did not contain the change being measured. The vite watcher running in
`.claude/worktrees/…` did not pick up edits to `src/`; the page loaded happily,
reported no errors, and served the pre-edit module. The conclusion drawn from
the first one — "the exhaustion fix did nothing" — was perfectly true of the
code being served and false of the code on disk.

Two habits fix it, and both are cheap:

- **Restart the dev server before every browser check.** Do not trust HMR or
  the watcher in a worktree.
- **Put a guard at the top of the check.** `if (D.api.PLAYER.stamWindedRecovery
  === undefined) return { FATAL: 'stale build' }`. A stale build is silent; a
  missing constant is loud, and it costs one line.

The same round then found the exhaustion bug for real — but only because the
second measurement was run against a server that had actually been restarted.

## Measure with a control, and pen the ambient spawner (2026-09-07)

"Eight walkers moved 250px toward the noise" means nothing on its own. They
move 91px in the same five seconds with no noise at all, because they drift
toward the player regardless. The number is only a result once the same setup
has been run both ways.

Three separate measurements in this round were also confounded by the ambient
spawner, which keeps a standing population near the player and kept adding
walkers that were *nearer to the tower* than the ones being measured — so the
tower dutifully shot at those and the planted target sat at full health,
looking exactly like "the tower does not work". Delete anything you did not
plant, every frame, for the length of the trial.

## Write the test that fails for the right reason (2026-09-07)

Two new assertions failed on their first run and both were the test's fault,
in ways worth keeping:

- One asserted that `fire.js` never mentions `G.structures` — and matched the
  comment in `fire.js` explaining that it does not. Strip comments before
  grepping source in a test, or the documentation defeats the assertion.
- One asserted that louder tower armaments hit harder, and failed the cannon,
  which is deliberately *worse* than a sniper rifle one-on-one because it is
  artillery. The fix was to measure the cannon against a crowd, which is what
  it is for. Had it gone the other way, the "fix" would have been to buff the
  cannon into a louder sniper and delete the design.

A test that measures the wrong quantity does not just fail; it argues for the
wrong change.

## Finishing a mechanic beats adding one (2026-09-07)

"Noise attracts zombies" was on the owner's list as a new feature. It was
already written: `alertEnemies` set an aggro flag, an alert timer and a
destination, and every firearm carried a noise radius. It had never once
worked, because `e.aggro` was set on first sight and cleared only when every
player was dead — so the branch that walks toward the remembered sound was
unreachable while anybody was alive. The feature was one expiry condition.

This is the third time on this project (repair, gathering, now noise) that a
request for something "new" was really a request to make something reachable.
Grep for the thing before designing it.

## A control run is only a control if it can tell the two stories apart (2026-09-08)

The noise round shipped with what looked like solid evidence: eight walkers
closed 91px on their own and 250px after a sound. Codex then found that the
mechanic could not work at all — an enemy refreshed its own alert timer from
its own aggro flag, so aggro never expired and the noise branch stayed dead.

Both numbers were real. The measurement was worthless, because the noise had
been placed *between* the group and the player: walking at the player closed
the distance to the noise too. Two completely different behaviours produced the
same reading, and the control run did not separate them — it only showed that
something changed.

Rerun with the noise on the FAR side of the group, so investigating means
walking *away* from the player, and the answer was unambiguous and the opposite
of what had been reported: 304px toward the player, away from the sound.

**Design the layout so the two hypotheses have opposite signs.** If a single
number is consistent with both "it works" and "it does something else that
happens to look similar", it is not evidence. This is the same failure as
asserting on calls rather than outcomes, one level up: the outcome was measured,
but along an axis that could not discriminate.

## Fixing the wrong half of a two-part bug (2026-09-08)

The aggro fix and the noise fix are separate, and either alone does nothing.
Making aggro expire still leaves eight seconds where a sound has aggro'd
everyone onto the player; making the noise not set aggro still leaves aggro
pinned on for ever from an earlier sighting. Both had to change together, and
the browser test that proves it only passes when both are right.

When a mechanic has an ordering ("A outranks B") and a lifetime ("A never
ends"), check both before believing a fix.
