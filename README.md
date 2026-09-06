# DEADLINE

A top-down survival, scavenging and base-defence game that runs in a browser.

You wake up on the roadside outside a dead town with a steel pipe and nothing
else. Loot houses for wood and cloth, chop trees, build a workbench, craft a
gun, wall in a patch of ground you like, and hold it when the horde comes for
you — because it comes for you *because* of what you built.

Everything you see is drawn in code. There are no image or audio files in this
repository; every sprite is generated into an offscreen canvas at boot and every
sound is synthesised with WebAudio.

> This README is the player- and developer-facing guide. For project direction —
> what is built, why decisions were made, what is next, and what we have learned
> — see **[PROJECT.md](PROJECT.md)**, which is the living source of truth.

---

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open the URL it prints (http://127.0.0.1:5173/).

Other commands:

```bash
npm test
```

```bash
npm run build
```

`npm test` runs 52 Node assertions over the pure logic (world generation, loot
tables, balance invariants, progression curves, perk trees, the day curve).
`npm run build` produces a static bundle in `dist/` that can be opened from any
static host.

Requires Node 18+. No API keys, no external services, no network access at
runtime.

---

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Aim |
| Left click | Attack / fire / place structure |
| `Shift` | Sprint (drains stamina) |
| `Ctrl` | Crouch — slower, much harder to notice |
| `R` | Reload · refuel a car you are in or standing beside |
| `1`–`6` | Select weapon slot |
| Mouse wheel | Cycle weapons (or build pieces in build mode) |
| `E` | Interact — hold to search containers; get in and out of a car |
| `G` | Stow your pack in a car's boot (`Shift`+`G` takes it back out) |
| Driving | `W`/`S` throttle · `A`/`D` steer · `Space` brake |
| `F` | At a stash: withdraw ammo and supplies |
| `Q` | Use a bandage or medkit |
| `B` | Build mode (right click or `B` again to exit) |
| `C` | Crafting (stand near a workbench for the good recipes) |
| `Tab` | Character sheet — attributes, perks, your people |
| `M` | Town map |
| `Esc` | Close a panel, or open the pause menu |
| `F5` | Save now (the game also autosaves every 25 seconds) |
| `P` | Mute / unmute |

Every key above can be changed: **CONTROLS** on the title screen or the pause
menu lists each action — click a row, press the key you want. Conflicts are
shown rather than refused, and RESET TO DEFAULTS puts everything back. Mouse
buttons, the wheel and `Esc` are fixed. Bindings are kept in the browser, not in
a save.

Melee swings also chop trees and give **Wood** — that's the main early supply,
and felling trees clears firing lines for your turrets.

---

## The loop

**Explore → Scavenge → Fight → Build → Defend → go somewhere worse.**

You spawn at a random spot in the low-danger outskirts. There is no tutorial
wall: a handful of one-line prompts teach movement, attacking, searching and
building, then get out of the way.

Roughly how the first hour goes:

- **0–5 min** — Loot nearby houses for wood, cloth and scrap. Learn that
  swinging at a tree gives wood. Kill your first walkers with the pipe.
- **5–15 min** — Pick a patch of ground you like and put down a **Bedroll**
  (this sets your respawn point) and a **Workbench**. Craft a machete, then a
  pistol and ammo. Wall in the essentials.
- **15–25 min** — Push into Market Row for the hardware store's building
  materials and the pawn shop's electronics. Upgrade the workbench to II.
  Threat is climbing now.
- **First raid** — The meter fills, you get twelve seconds of warning, and a
  scattered horde walks in from every direction. You fight beside your walls.
- **After** — Salvage lands in your stash, you level, and Precinct 12 with its
  gun safes suddenly looks survivable. Then the hospital. Then, eventually,
  Checkpoint Delta.

---

## Systems

### World

One authored 160×160-tile town (5120px square), generated from a fixed seed so
you can learn its geography. Nine districts, each with its own danger tier and
its own loot personality:

| District | Danger | What's there |
| --- | --- | --- |
| Roadside Camp | ▲ | Shacks, a quiet crossroads, an easy first base |
| Pine Hollow Suburbs | ▲ | Houses — wood, cloth, odds and ends |
| East Terraces | ▲▲ | Denser housing, larger groups |
| Market Row | ▲▲ | Convenience store, **hardware store**, pawn shop |
| Fuel Stop | ▲▲ | Fuel pumps, scrap |
| Precinct 12 | ▲▲▲ | **Police lockers, gun safes, armour** |
| St. Martha Hospital | ▲▲▲ | **Medicine, medkits** |
| Dock Yard | ▲▲▲ | **Electronics, weapon parts** |
| Checkpoint Delta | ▲▲▲▲ | **Military parts, rifle ammo, the carbine** |

Nothing is level-gated. You can walk into the military checkpoint at minute one
and you will die there. The map screen shades every district by danger, so you
can see where you want to go long before you can survive it.

### Combat

Eight weapons across two families. Melee (pipe → machete → sledgehammer) swings
in an arc and can hit several enemies at once; the sledge staggers a crowd.
Firearms (pistol, SMG, shotgun, rifle, carbine) use three ammo types, real
magazines, and reloads — the shotgun feeds shell by shell and can be interrupted
by firing. Bullets are simulated projectiles with substepping so nothing tunnels
through a wall.

**Bullets pass over your own structures.** Terrain walls stop them; your
barricades do not. A base you can't shoot out of is a base that punishes you for
building it.

Four enemy tiers:

| | Health | Speed | Wall damage | Notes |
| --- | --- | --- | --- | --- |
| Walker | 58 | slow | ×0.5 | The bulk of every horde |
| Runner | 44 | fast | ×0.4 | Closes the gap, lunges in bursts |
| Brute | 300 | slow | ×2.2 | Resists knockback, **breaks walls** |
| Behemoth | 1100 | slow | ×4.0 | Raid-only. Bring the rifle |

Walkers and runners are a threat to *you*; brutes are what actually breach a
perimeter. That split is why the third raid feels like a different game.

Enemies detect you by sight and by gunfire, steer around obstacles by fanning
out to the nearest clear heading, and attack whatever player-built thing is in
their way. They recover if they get wedged.

### Scavenging and inventory

Buildings furnish themselves according to what they are, from about two dozen
kinds of searchable fitting: bookshelves, dressers, wardrobes, nightstands,
desks, filing cabinets, refrigerators, bathroom vanities, vending machines,
tool racks, display cases, footlockers, lockers, safes, crates and the rest.

Each reads true to itself — a fridge holds food, a wardrobe holds clothes, a
tool rack holds tools and weapon parts, a footlocker holds military kit. So you
learn to read a building from outside and know what is worth going in for, and
a house stops being an empty box with a crate in it.

Searching is a short hold, interrupted if you're hit.

Your pack is a single weight-capped bag (ammo weighs less than lumber). Overflow
loot drops at your feet rather than vanishing. A **Supply Stash** is shared
storage that crafting and building draw from automatically, so "run home and
dump the haul" is a real beat in the loop rather than inventory admin.

### Death

There is no permadeath. When you die you drop a **backpack** containing
everything you carried — resources, consumables, and every weapon except your
starting pipe. It is marked with a beacon on screen, an arrow at the screen edge
with a distance readout, and a gold pin on the map. You keep your level, your
upgrades, your base and your stash.

You respawn at a **random spot in the outskirts** until you place a Bedroll,
after which that becomes your respawn point. Respawns never drop you next to a
crowd.

### Building

Build anywhere in the world — "base" is simply wherever your structures are.
Pick a piece, see a ghost preview with a live validity check, click to place.
Hold to lay a run of walls. No timers.

Walls (barricade → wood → reinforced → steel), gates you can open and close,
spike traps, a workbench, a stash, a bedroll, a fuel-burning generator, an auto
turret that needs generator power within 260px and feeds on 9mm from your stash,
a floodlight that holds back the night, Bunks that house your survivors, and a Watchtower to post a sniper on. Plus repair and salvage tools
(salvage returns 50%).

Build **anywhere**. There is no designated home plot — your base is simply where
your structures are, and raids, survivors and respawns all follow it. The test
suite asserts a full working base can be founded in every one of the nine
districts.

### Crafting

Instant. The resource cost is the whole cost. Bandages are hand-craftable;
Workbench I unlocks the machete, pistol, ammo, medkits and a padded vest;
Workbench II unlocks the sledgehammer, SMG, shotgun, rifle, riot armour and the
military carbine.

### Threat and raids

There is no seven-day timer. A **Threat** meter fills from what you actually do:
building, crafting, looting, firing guns, running the generator, killing things.
It bleeds off slowly when you lie low, so hiding is a genuine option — and the
Low Profile upgrade makes you quieter.

At 40 / 70 / 90 you get escalating warnings. At 100 a raid launches with twelve
seconds of notice. Raiders converge on your base (or on you if you haven't built
one), break on the perimeter, and attack walls, gates and defences. Waves
escalate within a raid. Winning resets Threat to 14 and pays out materials and a
large XP bundle.

Five authored raid tiers, then endless scaling:

1. **Scattered Horde** — walkers only. A scare, not a threat.
2. **Running Horde** — runners force you to actually aim.
3. **Heavy Horde** — first brutes. Your walls will drop below half.
4. **Siege** — a quarter brutes.
5. **Behemoth Siege** — and worse from there.

Raiders that get hung up on terrain are relocated to a fresh approach lane, and
no raid may outlast a hard ceiling — a raid can never become unwinnable and
block your progression.

### Cars

There are around thirty cars in the town and most of them can be driven. A car
is the answer to the two things that most limit a run — how much you can carry
and how far the good districts are.

**Getting in.** Roughly two thirds are locked, and there are three ways past
that:

| | How |
| --- | --- |
| **Keys** | Every locked car's key is hidden in a container near it. Find the house, find the keys. |
| **Lockpick** | Craftable at a workbench. Consumed whether it works or not, and the odds scale with **Perception** — 41% at PER 1, 92% at PER 10. A snapped pick makes noise. |
| **Hotwire** | An **Intelligence** perk. Works on anything, no key needed, but it takes a few seconds standing still and the engine catching is loud. |

**Driving.** Throttle, reverse, and steering that only bites once you are
actually moving. `Space` brakes. You cannot shoot from the driver's seat.

**What it costs.** Fuel, which you already need for generators. Bodywork, from
every wall you clip and every zombie you flatten. And noise — speed feeds
Threat, so a fast trip home has a bill attached.

**What it gives.** A **400-unit boot**, roughly double your best on-foot
capacity, so a run to Checkpoint Delta can come back with everything.
Headlights that carve a real cone out of the night. And the option to drive
through a crowd rather than around it.

Wrecked cars can be stripped for scrap, and a car destroyed with cargo aboard
spills the boot onto the road rather than eating it.

### Day and night

A full day runs about nine minutes. Dawn, day, dusk, night — the light fades on
a smooth ramp rather than snapping, and the HUD carries a day counter, a clock
and a bar showing how much daylight is left.

Night is the pressure valve. The map goes dark and shrinks to whatever your
lights reach; there are nearly twice as many infected abroad; they notice you
sooner; and every gunshot generates far more Threat. You carry a small pool of
light with you, your workbench and generator glow faintly, and a **Floodlight**
(needs generator power) turns a yard into an island you can actually fight in.
No light ever clears the dark completely — a floodlit base still reads as night.

Everything you built during the day decides whether you enjoy the night or dread
it.

### Progression

XP from fighting, scavenging, crafting, building, chopping, surviving raids and
discovering districts.

Levelling grants **skill points** — one per level, two on every fifth — and does
*not* interrupt play. You spend them in the character sheet when you are
somewhere safe enough to think, on either an attribute rank or a perk.

Six attributes, each ranked 1–10, each with its own perk tree:

| | Per rank | Its tree |
| --- | --- | --- |
| **Strength** | +9% melee, +25 carry, +6% chop | Pack Mule, Heavy Hitter, Demolisher, Adrenaline |
| **Perception** | -4% spread, -5% search time | Scrounger, Quick Hands, Eagle Eye, Sixth Sense |
| **Constitution** | +12 health, +10 stamina | Thick Skin, Marathon, Iron Stomach, Second Wind |
| **Charisma** | +1 survivor slot per 2 ranks | Recruiter, Inspiring Presence, Quartermaster, Natural Leader |
| **Intelligence** | +7% XP, -3% build cost | Fast Learner, Engineer, Fortifier, Gunsmith, Fire Control |
| **Luck** | +2% crit, +5% rare loot | Scavenger's Luck, Lucky Strike, Ammo Cache, Low Profile, Fortune Favours |

Perks are gated on the rank of their parent attribute, so investing in an
attribute is what opens its tree. Twenty-six perks, most of them multi-rank.

Stats are rebuilt by a single pure recompute pass — base, then attributes, then
perks — rather than by mutating the player on purchase. There is exactly one
place a modifier can come from, which makes save/load, respawns and any future
respec trivially correct.

### Survivors

You find people out in the town, marked with a green ring, and bring them home.

Two independent limits decide how many you can keep, and the roster tells you
which one is actually in your way:

- **Charisma** — how many people will follow you at all.
- **Bunks** — one bed houses one survivor. No bunk, no recruit.

They get better at the work: ten levels of more health and more damage, earned
from their own kills. They fire 9mm **from your stash**, so arming them is a
real decision, and they eat **Rations**, so feeding them is another. The stash
is the pantry — food in your own pack feeds nobody until you drop it off.

They can also be knocked down, and if you don't reach them in time — a medkit or
two bandages — they die permanently, and their levels die with them. A base is
worth defending because of who is standing in it, not because of what the walls
cost.

#### Jobs

Assign each person from the People tab. The job shows above their head, so you
can read the whole roster off the screen.

| Job | What they do |
| --- | --- |
| **Guard** | Holds the base and shoots what comes at it. |
| **Sniper** | Posted on a **Watchtower**: far more range and damage, but tied to it. One tower, one sniper. |
| **Scavenger** | Walks to nearby containers, works them, and hauls the materials back to the stash. |
| **Builder** | Repairs damaged structures, during a raid and after it, paying out of the stash. |

There is no pathfinding, so scavengers and builders prefer targets they have a
clear line to, and give up on anything they stop making progress toward rather
than leaning on a wall forever. In practice that means **they work the
accessible stuff and you clear the buildings** — which is a fair division of
labour rather than a bug you have to babysit.

### Saving

The game opens on a title screen. **NEW GAME** asks for a name and gives the run
its own save slot; **LOAD GAME** lists every slot with its day, level, kills,
play time and when you last played, and lets you load or delete any of them
(delete asks first). **CONTINUE** reopens the one you played most recently.
Keep as many games as you like — two solo runs and a co-op world side by side.

A game autosaves to its slot every 25 seconds and on demand with `F5`, and
**QUIT TO TITLE** on the pause menu saves first. The world is regenerated from
its seed, so a save only stores the deltas: what you've looted, what you've
chopped, what you've built, and who you are. Saves live in the browser's
LocalStorage. A save from before slots existed is picked up as "Game 1".

---

## Architecture

Vite + vanilla ES modules + a single Canvas 2D context. No framework, no
renderer library, no asset pipeline.

```
src/
  main.js              boot, fixed-timestep loop, debug hooks
  style.css
  core/
    util.js            maths, seeded RNG, hashing — pure, unit-tested
    input.js           keyboard/mouse with edge-triggered "pressed" state
    audio.js           every sound effect, synthesised at runtime
    sprites.js         every sprite, drawn into offscreen canvases at boot
    particles.js       pooled particles, floating text, ground decals
  game/
    config.js          ALL content and balance data. One file to tune.
    world.js           map generation, tile collision, danger field
    state.js           the mutable game state + shared low-level accessors
    player.js          stats, movement, aiming, attacking, death, respawn
    enemies.js         spawning, AI, steering
    combat.js          projectiles, melee, tree chopping, turrets, traps
    damage.js          all damage resolution (player/enemy/structure)
    loot.js            loot rolls, pickups, the death backpack
    building.js        placement validation, power, repair, salvage
    crafting.js        recipes
    threat.js          the Threat meter
    raid.js            raid waves, targeting, anti-stall
    progression.js     XP, levels, the upgrade draft
    save.js            LocalStorage serialisation
    game.js            update order, interactions, tutorial, camera
  render/
    renderer.js        world rendering, y-sorted draw list
  ui/
    hud.js             HUD, panels, map, menus (immediate-mode, canvas)
tests/
  logic.test.js        Node unit tests over the pure logic
  browser-smoke.js     66-assertion end-to-end test against the live game
  raid-harness.js      raid balance harness
```

A few decisions worth knowing about:

**All static collision is tile-based.** Terrain, trees, cars and containers all
write into one `Uint8Array`. Player structures live in a separate destructible
map. Collision, bullet tests, building validation and AI steering all read the
same two sources, so they can never disagree.

**`damage.js` exists to break an import cycle.** Player, enemies, combat and
building all need to deal damage to each other; routing every hit through one
module keeps the dependency graph acyclic.

**`config.js` holds every number.** Weapons, enemies, structures, recipes, loot
tables, upgrades, raid specs and threat rates are all data in one file, which is
what made the balance passes tractable, and what the unit tests assert against.

**Fixed 60Hz simulation** with an accumulator and a step cap, so a stalled tab
can't fast-forward the world. Rendering is decoupled and interpolation-free.

**The UI is drawn in CSS pixels** and scaled by `devicePixelRatio`, so text stays
legible on HiDPI displays while the world renders at full device resolution with
nearest-neighbour filtering.

---

## Testing

```bash
npm test
```

69 Node assertions covering world generation determinism, spawn-point safety,
danger tiers, loot-table integrity and theming, weapon/enemy/wall tier ordering,
recipe gating, the XP curve, raid escalation, threat thresholds, every attribute
and perk actually changing a stat, perk gating by rank and cost, recompute
idempotency, the day/night curve and clock, and survivor scaling.

`tests/browser-smoke.js` is injected into the running dev server and drives the
live game through 330 assertions using synthetic input events — the title
screen, save slots and key rebinding driven by real clicks, movement, aiming,
melee, gunfire, ammo, reloading, enemy pursuit, taking damage, searching
containers, carry-capacity overflow, structure placement and cost, walls
blocking, enemies attacking structures, workbench upgrades, tier-gated crafting,
bedroll respawn, turret power, dying, dropping and recovering a pack, threat
accumulation, raid trigger and completion, raid rewards, levelling and the
upgrade draft, save/load round trips, a second player driven by intent (enemy targeting,
no friendly fire, downed and revive), and a 90-enemy performance check.

`tests/raid-harness.js` builds a standard walled compound, forces a raid of a
given tier and plays it out, reporting duration, structures lost and player
deaths. It is what the raid balance was tuned against:

| Raid | Duration | Structures lost | Walls dropped to |
| --- | --- | --- | --- |
| 1 | 38s | 0 | 98% |
| 3 | 64s | 0 | 12% |
| 5 | overwhelming | the whole base | 0% |

Real bugs came out of this testing and out of automated review rather than out
of writing the code: bullets colliding with the player's own walls (which made a
walled base unable to shoot out), threat decay running before the raid check (so
a raid could never trigger), raids stalling forever on a stuck enemy, death
backpacks losing interaction priority to a nearby workbench, the B key both
opening and closing build mode in the same frame (making the advertised control
a no-op), a part-fuelled generator that could never be switched off, an autosave
during the death countdown restoring a player alive at zero health, and enemies
punching a wall behind you instead of attacking you.

---

## Known limitations

- **No pathfinding.** Enemies use local steering with obstacle probes and a
  stuck-recovery fallback. They handle walls, buildings and your base fine, but
  a sufficiently maze-like structure can still confuse them briefly. The raid
  anti-stall logic exists precisely because of this.
- **Enemies cannot open or break gates selectively** — a closed gate is just a
  wall to them.
- **Interior spaces are sparse.** Buildings have walls, doors, partitions and
  loot, but no furniture beyond containers.
- **No day/night cycle.** The lighting is static.
- **Ambient enemies are culled** beyond 2400px, so a horde you outrun does not
  follow you across town. Raid enemies are exempt.
- **One save slot**, and it silently ignores saves from older versions rather
  than migrating them.
- **Audio is synthesised**, so it is functional rather than atmospheric — no
  music, and impacts are short and dry.
- **The behemoth is under-used.** It only appears from raid 5, so most sessions
  never see one.
- **Balance is tuned for a competent player.** The raid harness plays a fairly
  static defender; a mobile player kiting with a shotgun will find the early
  raids easy.

---

## What I'd build next

1. **A flow field for raids.** Compute one Dijkstra map toward the base each
   time a wall changes and have raiders follow the gradient. Kills the stuck-AI
   class of problem outright and makes funnelling into a kill corridor a real,
   readable tactic.
2. **Enemies that prefer weak walls.** Right now they hit whatever is in front
   of them. Having a horde visibly pick the barricade over the steel wall would
   make base *design* matter as much as base *cost*.
3. **Day/night.** Night raises threat and enemy aggression, gives the generator
   a second job (lighting), and turns "do I push for the hospital or head home?"
   into the central decision of every run.
4. **A vehicle.** One repairable car would make the far districts a real
   expedition — carry capacity and a fast route home in exchange for noise.
5. **Deeper base identity.** Ammo benches that convert scrap into ammo over
   time, wall skins that show tier at a glance, and a repair-all sweep so
   post-raid recovery is one decision instead of twenty clicks.
6. **More reasons to leave.** Timed events — a supply drop, a wandering horde,
   a burning building with good loot — so exploration is pulled by opportunity
   and not only pushed by shopping lists.

---

Built as a single-pass vertical slice. The goal was to prove the loop, not to
ship a content library: one map, eight weapons, four enemy tiers, eleven
structures, seventeen recipes, fifteen upgrades and one raid system that
escalates — all working, rather than twenty systems half-wired.
