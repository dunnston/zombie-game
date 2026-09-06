# DEADLINE — Project Document

**This is the living source of truth for this project.** It is meant to be read
at the start of a session and updated at the end of one. If something here
contradicts the code, the code is right and this file needs fixing — say so.

- **Last updated:** 2026-09-06, title screen / save slots / key bindings in review
- **Repo:** https://github.com/dunnston/zombie-game
- **Owner:** dunnston

| Where things live | |
| --- | --- |
| `PROJECT.md` | This file. Vision, state, decisions, roadmap, lessons. |
| `CLAUDE.md` | Auto-loaded by Claude Code each session. Points here; holds the invariants. |
| `README.md` | Player- and developer-facing docs. How to run, controls, systems. |
| `tasks/todo.md` | Per-round working plan and its review notes. |
| `tasks/lessons.md` | Raw running log of lessons. This file holds the distilled version. |

---

## 1. What we are making

A top-down survival, scavenging and base-defence game that runs in a browser.

> You wake up on the roadside outside a dead town with a steel pipe and nothing
> else. Loot houses, chop trees, build a workbench, craft a gun, wall in a patch
> of ground you like, and hold it when the horde comes — because it comes for
> you *because* of what you built.

Influences: Project Zomboid, 7 Days to Die, ARK, They Are Billions. It is not a
clone of any of them, and it is explicitly **not a realism simulator**.

### The loop

**Explore → Scavenge → Fight → Build → Defend → push somewhere worse.**

The player should almost always be doing one of those, or making a decision
about which to do next.

---

## 2. Design pillars

These settle arguments. When a decision is close, the pillar wins.

1. **Survival without survival-game chores.** No thirst bars, no hunger
   micromanagement, no sleep, no long crafting timers. Upkeep, where it exists,
   lives at the base (survivor Rations) rather than on a bar above the player.
2. **Danger is the only gate.** Nothing is level-locked. You can walk into the
   military checkpoint at minute one and die there. The map shades districts by
   danger so you can *see* where you want to go before you can survive it.
3. **Fun over realism.** Bullets pass over your own walls because a base you
   cannot shoot out of is a base that punishes you for building it.
4. **Readability over fidelity.** If a thing cannot be identified at a glance in
   a crowd, fix that before adding detail.
5. **Every system has to be finished.** A smaller game where everything works
   beats a larger one with twenty half-wired systems. Cut breadth, not quality.
6. **The player's power should raise the stakes.** Threat is driven by what you
   *do* — building, shooting, running a generator, driving fast. Getting
   stronger should make the world more dangerous, not less.
7. **Build anywhere.** There is no designated home plot. Your base is wherever
   your structures are, and raids, survivors and respawns all follow it.

---

## 3. Where we are right now

**Status: a genuinely playable game, well past MVP, now being made
multiplayer.** Seven rounds merged; the menu-and-saves round is in review.

| | |
| --- | --- |
| Source | 36 modules, ~13,600 lines, no dependencies but Vite |
| Assets | Zero. Every sprite is drawn in code at boot; every sound is WebAudio. |
| Tests | 69 Node assertions; browser suite 340 |
| Save format | **v7** payload, in **slots** (index v1) |
| Performance | ~60fps with 90 active enemies |

### Multiplayer — where it stands

The owner asked for it on 2026-09-06 and reversed the "deliberately not
building" entry below. Agreed shape: **online co-op for up to four, one player
hosts.** The host's browser runs the authoritative sim exactly as it does
today; guests send input and render what the host tells them. A ~120-line
signalling broker swaps WebRTC connection details for a six-character room
code and then gets out of the way — game traffic never touches a server. One
shared base and stash, separate inventories and progression, no friendly fire,
revive a downed teammate, guests remembered in the host's save. Two PRs:

| PR | State | What |
| --- | --- | --- |
| A — foundation | [#9](https://github.com/dunnston/zombie-game/pull/9) | `G.players[]`, intent split from simulation, actor parameters everywhere, downed/revive. No visible change in solo. |
| A2 — menu and saves | **in review** | Title screen on boot (Continue / New Game / Load / Multiplayer / Controls), any number of save slots with delete, rebindable keys. Asked for by the owner while A was in review. |
| B — online co-op | next | Broker, WebRTC transport, host/client sessions, the Host/Join buttons the Multiplayer screen already has, save v8. |

The full plan is in `tasks/todo.md`.

### Shipped

| PR | What |
| --- | --- |
| [#1](https://github.com/dunnston/zombie-game/pull/1) | The MVP: world, combat, scavenging, building, threat, raids, progression, save |
| [#2](https://github.com/dunnston/zombie-game/pull/2) | SPECIAL attribute trees, day/night cycle, survivor NPCs |
| [#3](https://github.com/dunnston/zombie-game/pull/3) | Searchable furniture, bunks gating the roster, survivor jobs |
| [#4](https://github.com/dunnston/zombie-game/pull/4) | Drivable cars with keys, lockpicks and hotwiring. Save → v6. |
| [#6](https://github.com/dunnston/zombie-game/pull/6) | Raids break off instead of stranding the player |
| [#7](https://github.com/dunnston/zombie-game/pull/7) | The quiet field; steeper XP curve |
| [#8](https://github.com/dunnston/zombie-game/pull/8) | Slot inventory, equipment slots, hotbar. Save → v7. |
| [#9](https://github.com/dunnston/zombie-game/pull/9) | Multiplayer foundation: players array, intent split, downed and revive |

### What the first playtest said

The owner played on 2026-09-06. The headline: **they could not do anything but
fight.** They could not get their bearings, could not establish a base, and
never found the crafting system — which exists, is bound to `C`, and is taught
by the tutorial.

That produced the current round of work:

| Finding | Response |
| --- | --- |
| Zombies never stop coming | Quiet field — clearing ground earns a lull (PR #7) |
| Level 7 in about ten minutes | Steeper XP curve (PR #7) |
| No inventory, equipment slots or hotbar | Slot inventory with five equipment slots, hotbar, drag and drop (PR #8) |
| Crafting "missing" | Still on `C`; folding it into the inventory screen is next |
| Wants hunger and thirst | Light version, against pillar 1 but explicitly reaffirmed (planned) |
| Wants tiered storage | Crate / Stash / Locker aggregating into one view (planned) |

Everything not yet marked shipped is still guesswork about feel. Another play
session after PR #7 outranks the rest of the roadmap.

---

## 4. What is built

**World.** One authored 160×160-tile town (5120px square) from a fixed seed, so
the player can learn its geography. Nine districts across four danger tiers:
Roadside Camp and Pine Hollow Suburbs (▲), East Terraces, Market Row and Fuel
Stop (▲▲), Precinct 12, St. Martha Hospital and Dock Yard (▲▲▲), Checkpoint
Delta (▲▲▲▲).

**Combat.** Eight weapons across melee (pipe → machete → sledgehammer) and
firearms (pistol, SMG, shotgun, rifle, carbine), with three ammo types, real
magazines and reloads. Four enemy tiers: walker, runner, brute, behemoth.
Walkers and runners threaten *you*; brutes are what breach a wall.

**Scavenging.** ~24 kinds of searchable fitting, placed by building type, each
with loot that reads true to it. Weight-capped pack, shared stash, death drops a
recoverable backpack.

**Inventory and equipment.** A 30-slot pack grid with stacking, a six-slot
hotbar that decides what you are holding, and five equipment slots — head,
body, hands, legs, feet — with fifteen pieces of gear across three tiers.
Everything moves by dragging. Capacity is weight, not slot count, and the
weight bar counts the pack and the hotbar together.

**Building.** Walls in four tiers, gate, spike trap, workbench (2 tiers), stash,
bedroll, bunk, watchtower, generator, turret, floodlight, plus repair and
salvage. Anywhere on the map.

**Threat and raids.** A meter driven by player activity, not a calendar. Five
authored raid tiers then endless scaling, in waves, targeting the perimeter. A
raid with no progress for 25 seconds breaks off rather than stranding the
player, and pays out by the share of the horde killed.

**Ambient pressure.** The spawner keeps a standing population near the player,
but `pressure.js` holds a coarse "quiet" field: kills quieten the ground they
happen on, structures quieten their surroundings a little, and it all decays
over ~4.5 minutes. Clearing a site buys a real window to build in. Raids ignore
it entirely.

**Progression.** Six attributes (STR/PER/CON/CHA/INT/LCK) ranked 1–10, each with
a perk tree gated on that attribute's rank. 27 perks. Levels grant skill points
and never interrupt play.

**Day and night.** ~9-minute days on a smooth light ramp. Night nearly doubles
enemy density, sharpens their senses, and nearly doubles Threat gain.

**Survivors.** Recruited from the world, housed in bunks, capped by Charisma.
Four jobs: Guard, Sniper (on a watchtower), Scavenger, Builder. They level up,
eat Rations, and die permanently.

**Cars.** ~30 in town, most locked. Three ways in: a key hidden near the car, a
craftable lockpick (odds scale with Perception), or the Hotwire perk. A
400-unit boot, headlights, roadkill, and fuel/noise/bodywork as costs.

**Title screen, save slots, controls** *(in review)*. The game boots to a menu:
CONTINUE (the most recently played game), NEW GAME (name it; it gets its own
slot), LOAD GAME (every slot with its day, level, kills, play time and last
played; LOAD or DELETE-with-confirm per row), MULTIPLAYER (the screen the
networking will fill in), CONTROLS. Saves are **slots**: an index under
`deadline.slots` and one payload per slot, so two solo runs and a co-op world
sit side by side; the old single save is migrated into slot 1 on first boot.
Every key is rebindable from the controls screen (also on the pause menu):
click a row, press a key; conflicts are shown, not refused; RESET TO DEFAULTS.
Mouse buttons, the wheel and `Esc` are fixed. Bindings live in the browser,
not in a save. The pause menu gained CONTROLS and QUIT TO TITLE (saves first).

**Players.** The world holds a list of players, and
`G.player` is an alias for the one at this keyboard. Each player has an
`intent` — what they want to do this step, as data — and the simulation reads
only that; the keyboard is read in exactly one place. Enemies go for the
nearest player and spawn around each of them; loot pulls toward whoever is
closest; kill XP goes to the killer, and turret, trap and survivor kills pay
everyone present. Base-wide numbers (turret reach, wall strength, upkeep, the
roster cap) are the host's. With a teammate on their feet somewhere, running
out of health leaves you **downed** for 30 seconds instead of dead: they hold
E beside you to bring you up at 40% health. Alone, death is what it always was.
No friendly fire; players walk through each other.

---

## 5. Architecture

```
src/
  main.js            boot (migrate the legacy save, land on the title), the
                     fixed-timestep loop, debug hooks (window.DEADLINE)
  core/              util, input, audio, sprites, particles — no game rules
    bindings.js      actions → keys; act()/actTap() are what the game asks.
                     Stored in the browser. Esc, mouse and wheel are fixed.
  game/
    config.js        ALL tunables and content data. One file to balance.
    state.js         the mutable G object + shared low-level accessors;
                     G.players[] and the G.player alias for the local one
    intent.js        what a player wants this step, as data — the ONLY place
                     the simulation's input is read from the keyboard
    world.js         map generation, tile collision, danger field
    player.js  enemies.js  combat.js  damage.js
    loot.js  building.js  crafting.js  threat.js  raid.js
    perks.js         attributes, perk trees, the stat recompute pass
    progression.js   XP, levels, spending points
    daynight.js  survivors.js  vehicles.js
    pressure.js      the quiet field — why cleared ground stays cleared
    items.js         one registry for everything, and the slot-container ops
    equipment.js     equipping, and the moves the inventory screen makes
  ui/inventory.js    the inventory screen: grid, gear slots, hotbar, drag/drop
    save.js          the save FORMAT: serialiseGame() and applySaveData()
    saves.js         WHERE saves live: slots, the index, legacy migration
    game.js          update order, interactions, tutorial, camera, toTitle()
  render/renderer.js world drawing, y-sorted draw list, night pass
  ui/kit.js          the immediate-mode UI kit: palette, panel, button, cursor
  ui/hud.js          HUD, panels, map, pause menu (on canvas)
  ui/menu.js         the title screen and its sub-screens; the controls panel
```

### Invariants — break these and something subtle goes wrong

1. **All static collision is tile-based**, in one `Uint8Array` (`world.blocked`).
   Player structures live in a *separate* destructible map. Collision, bullets,
   build validation and AI steering all read the same two sources so they can
   never disagree.
2. **Bullets use terrain-only collision** (`terrainBlocksPx`), so they pass over
   player-built structures. This is deliberate — see pillar 3.
3. **`damage.js` exists only to break an import cycle** between player, enemies,
   combat and building. Route damage through it.
4. **`recomputeStats()` in `perks.js` is the only source of player modifiers.**
   Base → attributes → perks, rebuilt from scratch. Never mutate a stat on
   purchase; the old model double-applied on load.
5. **Edge input must be consumed by exactly one simulation step.** A frame that
   runs no fixed update holds the tap for the next one. Both halves of this have
   caused real bugs.
6. **The UI is authored in CSS pixels** and scaled by `devicePixelRatio`. Mouse
   hit-testing divides by DPR.
7. **Container identity in saves is the ordinal index.** Changing how many
   containers the generator produces invalidates every save. **This has bitten
   twice** — see the decision log.
8. **There is no pathfinding.** Any behaviour that walks toward a target needs
   give-up logic, or it will press against a wall forever.
9. **The simulation never reads the keyboard.** `gatherLocalIntent()` in
   `intent.js` fills the local player's `intent` once per step; everything in
   `updatePlayer` and the interaction code acts on intent alone. A second
   player's intent arriving over a wire must drive identical code. UI-only keys
   (panels, build mode, pause) may still read `Input` — they are not simulation.
10. **Simulation code takes the acting player as a parameter.** `G.player` is
    the *local* player and belongs to the camera, the HUD and the renderer. A
    system that means "whoever did this" — damage, XP, threat, cost, loot —
    takes `p`. Base-wide multipliers read `baseOwner()`, never `G.player`.

---

## 6. Decision log

The *why*, so a future session does not undo something on purpose-built reasoning.

| Decision | Why |
| --- | --- |
| Vanilla JS + Canvas2D, no engine | One dependency, instant startup, total control of the render loop. Nothing here needs a framework. |
| All art generated in code | No asset pipeline, no binary files in git, and the whole look stays consistent because one file draws everything. |
| Fixed 60Hz sim with an accumulator | A stalled tab must not fast-forward the world. |
| Threat meter instead of a day-N raid timer | Ties danger to player behaviour, which is pillar 6. A calendar would make power free. |
| Bullets ignore player structures | Pillar 3. Tested the alternative; a walled base could not defend itself. |
| Enemy `structMul` split from `dmg` | Lets walkers threaten the player while brutes threaten walls. This is what makes raid 3 feel like a different game. |
| Raiders target the *nearest* structure | So hordes break on the perimeter. Targeting the most valuable made them walk past the walls you built. |
| Levelling grants points, no forced draft | The 1-of-3 draft paused the world mid-fight. Points let you spend when safe. |
| Stats via pure recompute | Makes save/load, respawn and any future respec correct by construction. |
| Survivor upkeep is Rations, not thirst | Pillar 1. The owner asked for a thirst-reducing perk; this delivers the fantasy at base level instead of as a personal bar. |
| The stash is the pantry *and* the armoury | Survivors eat and shoot from the stash, never the player's pack. One consistent rule, and it keeps "run home and drop the haul" a real beat. |
| Scavengers/builders prefer targets with line of sight | No pathfinding. They work the accessible stuff, the player clears buildings. |
| Cars cost fuel, bodywork and noise | All three are existing systems. No new resource invented for them. |
| No shooting while driving | Two hands on the wheel. Avoids a whole second aiming model. **Revisit if it feels bad to play.** |
| A raid ends when nothing is happening, not only when every raider is dead | Without pathfinding, the last few raiders can always become unreachable, and "kill them all" is then unsatisfiable. Watching progress — kills, structure damage, player damage — ends the raid in every stuck case rather than only the ones anyone predicted. |
| A raid the player did not finish pays out by share killed | Otherwise hiding until the horde gave up beat defending, and the 300s backstop handed out full salvage for a flattened base. |
| Killing buys local, temporary quiet | The spawner keeps a standing population near the player and refills it every 0.6s, so there was no lull anywhere, ever — the first playtest could not get a base up. Quiet is earned by clearing and decays in ~4.5 minutes, so the world is still hostile (pillar 6); it is just no longer uniformly hostile everywhere at once. Raid spawning ignores it and raid kills do not earn it, so raids stay exactly as dangerous. |
| One slot model behind the existing resource API | `addRes`/`takeRes`/`countRes` kept their signatures and learned to tell a slot container from a plain id->count map. That is what let the pack become a drag-and-drop grid while building, crafting, survivor upkeep, car boots and raid rewards went untouched. |
| The stash, car boots and survivor cargo stay plain maps | Nothing addresses an individual slot in them, so a grid would be cost without benefit. Revisit when tiered storage containers land. |
| Loot entry ids have exactly one encoder and one decoder | The prefixed grammar (`weapon:`/`item:`/`gear:`) was decoded by three hand-written if-chains. Adding `gear:` updated one of them, and the other two turned a scavenged helmet into a pickup nothing could read, which was then deleted on contact. `entryToPickup`/`pickupEntryId` in loot.js are now the only pair. |
| Anything that will not fit lands on the ground | A full inventory is a normal state, and "make room and come back" only works if the item is still there. No loot path may destroy something for want of a slot. |
| Nothing equips itself any more | `bestArmor()` silently wore whatever had the highest damage reduction, so the player could neither choose nor even see what they had on. Gear now goes to the pack and waits. |
| `carryCap` is a budget for the pack *and* the hotbar | The weight bar counts both, so the capacity check has to as well — otherwise loot keeps fitting after the bar reads 100%. `packAllowance()` is the single place that nets it off. |
| The quiet field is sampled bilinearly | Reading the containing cell made the payoff depend on where inside a 256px square you stood: measured, the same six kills bought 40 seconds of calm or none. |
| Multiplayer is host-authoritative, not lockstep | `Math.random()` is in ~40 places and Map iteration order leaks into the sim; deterministic lockstep would need all of it replaced, and a single desync silently forks the world with no error. One browser owning the truth has no desync class of bug at all. |
| A broker, not a relay | The room-code server only swaps WebRTC connection details, then game traffic runs browser to browser. It can go down mid-game with no effect, it holds no world and no password, and it costs nothing to leave running. |
| `G.player` stays, as an alias | About a hundred references genuinely mean "the local player, for the camera and HUD". Renaming them all would be churn with no benefit; making `G.player` a getter over `G.players[localIdx]` left them correct and made the twenty that meant "whoever did this" stand out. |
| Intent is data; the sim never touches `Input` | The only way one code path can serve a keyboard and a wire. It also put the two UI rules that were scattered through `updatePlayer` (a panel swallows input; build mode owns the mouse) in one place. |
| The host's stats govern the base | Turret reach, trap damage, wall strength, upkeep and the roster cap read `baseOwner()` — `G.players[0]`. Stable, predictable, and it does not shift when a guest leaves. In solo it is the same rule as before. |
| Kill XP to the killer; automated kills to everyone present | A player who lands the kill earns it. A turret, trap or survivor kill pays every present player, because the base is everyone's. Both rules collapse to the old one in solo. |
| Downed, not dead, when a teammate is up | Death in co-op with no revive is a walk back from a random spawn while your friend fights alone. Thirty seconds down, revive by holding E, 40% health back. Alone — or when nobody comes — the old death path runs unchanged. Enemies ignore the downed. |
| No friendly fire, no player collision | Bullets already ignore your own walls (pillar 3); a teammate is not a better reason to make you flinch. And a player who can block a doorway is a griefing tool nobody asked for. |
| Cull enemies far from *every* player, spawn around *each* | One player's ring would starve the other's district of a crowd, or cull the horde their teammate was fighting. Each living player is the centre of their own ring; the quiet field is read where each of them stands. |
| A remote player's edge intents are consumed after one step | The local intent is rebuilt from the keys every step, so its edges last one step by construction. A remote intent is a packet that stays put until the next one — held as data, "E was pressed" toggled a gate 17 times in 300ms. `consumeEdges()` runs at the end of every update for everyone but the local player; held states (movement, fire, E still down) are left alone. Found by the first Codex review of PR #9. |
| One seat per car; a leaver parks; a roadkill is the driver's | Two players could hold the same `drivingId`, the second stranded with movement disabled and nobody reading their controls. A guest leaving at the wheel left the car engine-on with its collision tiles released forever. Roadkills paid everyone. All three from the same review, all reproduced before fixing. |
| A slot's address and a save's format are separate things | `saves.js` owns the index and the per-slot keys; `save.js` owns what a payload contains. v8 (guests remembered) changes the payload and touches nothing in the slot machinery. |
| The legacy save is migrated, not retired | Wrapping the one pre-slot save into slot 1 is a one-line copy, unlike the v6→v7 change where the belongings had no sensible home. Nobody loses a run to a menu. |
| Bindings live in the browser, not the save | Controls are the person's, not the world's; two saves should not have two keyboards. `deadline.binds`, per browser. |
| Mouse, wheel and Esc are not rebindable | Esc has to reach the menu whatever state the bindings are in, and a controls screen that can lock you out of the controls screen is a bug report waiting to happen. |
| The Multiplayer screen ships disabled, with a reason | A dead button is a broken promise; a hidden one makes the menu look unfinished when it is not. The screen explains what is coming and where it will live, and PR B only has to enable two buttons. |
| The UI kit is its own module | `menu.js` needed the HUD's panels and buttons, and the HUD needed the menu's controls panel — an import cycle. Moving the kit to `kit.js` made both a leaf's clients instead of each other's. |
| A game started through `newGame()` has no slot until it saves | The tests start dozens of games; giving each a slot on creation would litter the browser. The first save creates one, autosave only runs for a game that has one, and the pause menu says so. |
| The controls panel opened from the pause menu sits *over* the pause | The first version unpaused to show it, so the world ran while the player's input was captured by the panel — enemies could act on someone who could not answer. Now the world stays stopped and BACK returns to the pause menu. Found by the Codex review of PR #10. |
| CONTINUE follows the slot last *chosen*, then the one last *written* | Loading a slot marks it current before it saves. Picking purely by `updated` meant a refresh straight after LOAD reopened whichever game happened to save last. Same review. |
| Every on-screen key hint goes through `primaryLabel()` | Fourteen strings said "press E", "WASD", "(TAB)", "F: take ammo" by hand; after a rebind they lied. Hints are built from the bindings at draw time, and the tutorial's texts became functions for that reason. Same review. |
| Buttons behind a modal are disabled, not just covered | The immediate-mode `clicked()` is non-consuming, so a click on KEEP could also land on a LOAD underneath. Anything under the delete confirmation is drawn disabled while it is up. Same review. |

---

## 7. Roadmap

### Next up (highest value first)

1. **Multiplayer PR B — online co-op.** The signalling broker, the WebRTC
   transport, host and client sessions, the lobby behind the Multiplayer
   screen's Host/Join buttons, save v8 with guests remembered (a hosted world
   is a `coop` slot). Then two browsers on one world through the broker on
   localhost, and a measured wire rate recorded in §9. Follow-ups already
   known: a TURN/relay fallback for symmetric NAT, binary snapshots if the
   measured rate warrants it.
2. **Finish the playtest response.** Crafting folded into the inventory screen
   (the owner never found it on `C`), tiered storage containers, and light
   hunger and thirst. See `tasks/todo.md` for the working plan.
2. **Decide what to do with `GameAssets/`.** Seven 1448x1086 art boards arrived
   mid-session. They are presentation sheets, not sprite atlases: labelled,
   captioned, and with **no alpha channel**. Using them means cropping and
   keying out soft-shadowed art by hand. See §7 note below.
2. **The owner plays it again**, after the pacing fix. The remaining feel
   questions — is the shotgun punchy, is kiting a runner tense or annoying —
   are still unanswered.
3. **A flow field for raids.** One Dijkstra map toward the base, recomputed when
   a wall changes. Kills the entire stuck-AI class of problem, makes funnelling
   into a kill corridor a real readable tactic, and lets survivors path indoors.
   This is the single biggest quality upgrade available.
3. **Stable container IDs.** Replace ordinal indices with something derived from
   tile position, so content changes stop invalidating saves.

### Wanted, not yet scheduled

- Survivors assignable to a specific post (this wall, not the base centre)
- Survivors equipping weapons from the stash instead of a fixed rifle
- Enemies preferring weak walls, so base *design* matters as much as base cost
- Deeper base identity: ammo benches, wall skins that show tier, repair-all
- Timed world events (supply drop, wandering horde) so exploration is pulled by
  opportunity rather than only pushed by shopping lists

### Deliberately not building

Thirst, detailed hunger, temperature, illness, sleep, reading books, long
crafting timers, many ammo calibres, farming, NPC factions, dialogue, quests,
huge procedural worlds, realistic electrical or plumbing systems. From the
original brief, and still right. **Multiplayer was on this list** until the
owner asked for it on 2026-09-06; PvP, dedicated servers and persistent shared
worlds remain off it.

---

## 8. Lessons

Distilled. The running log is in `tasks/lessons.md`.

**Test the thing, not the model of the thing.** Every serious bug in this
project was invisible in review and obvious within seconds of running the game.
Assertions about *outcomes* (`killed > 0`, `raid completes`) catch classes of bug
that assertions about *calls* never will.

**Silent no-ops are the worst failure mode.** The scavenger's "prefer reachable
containers" check passed 0 of 281 containers because every container blocks its
own tile. It degraded quietly into "always pick the nearest" rather than
breaking. Measure a mitigation actually mitigating.

**Distinguish test-setup failures from product failures.** Several early
failures were the harness's fault. But two of those "test bugs" pointed at real
gaps worth fixing anyway — tree chopping exists because turrets were firing into
treelines with no way to clear a firing line.

**A hanging suite is worse than a failing one.** One infinite loop cost 30
minutes. Every wait now checks an absolute deadline.

**Put every tunable in one file.** `config.js` made three balance passes cheap
and lets the tests assert *relationships* rather than values.

**Readability beats fidelity.** The fix for "I can't find myself in a crowd" was
a two-tone ground ring and a brighter palette, not better art.

**Handle devicePixelRatio explicitly.** Test at DPR 1 *and* 2.

**Automated review earns its keep.** Codex has caught 17 real defects across
four PRs, several of them silent no-ops. Reproduce each finding against the
running game before fixing, and say so in the reply.

**A test tool that stops measuring looks like a passing test.** The raid harness
quietly stopped playing after the defender's first death — it respawned across
the map, never found a target, and logged a flat line for the rest of the run.
The flat line read as an engine stall. Before believing a bad measurement, check
the instrument is still measuring.

**Reproduce against `main` before blaming the branch.** The stalled raid looked
like fallout from the cars work. Ten minutes in a `git worktree` of `main`
showed identical numbers, which kept an unrelated fix out of that PR.

**A new assertion that passes proves nothing until you know why.** The first
version of "a car cannot drive through your own wall" passed while the car was
actually stopping on scenery left behind by an earlier test. The detail string
(`stopped 80px short`) is what gave it away — always log the measurement, not
just the verdict.

**A hidden page does not run `requestAnimationFrame` at all.** The in-app
browser pane, when it is not on screen, fires no frames — so the game loop
never steps, and the smoke suite neither passes nor fails: it waits forever,
because its deadline was only checked from inside the frame wait. Its `fps`
read 60 the whole time — the initial value, never updated. Every frame wait
now races a plain timer and says "rAF has not fired" instead of hanging. Run
the suite in Playwright with the page fronted.

**Vite reloads the page when a file outside the module graph changes.** Saving
a test file or a doc while the game is running restarted it — which killed a
smoke run, and would kill a playtest. `vite.config.js` now ignores `tasks/`,
`*.md` and `.claude/`. **Not `tests/`:** the same watcher invalidates Vite's
transform cache, so ignoring the test files meant an edited suite was served
*stale*, and a run reported 298 passes against a file that had 301. A reload is
loud; a stale file is silent. Do not edit tests while a run is in flight.

**Check the suite has a case where the player does the thing.** The smoke
suite's combat section proved a swing damages and a shot spends ammo — and
every actual kill in it was made by a turret, a survivor or the debug API. So
when a bullet's owner changed from a string to the player object, and
`creditSurvivorKill` called `startsWith` on it, 298 assertions passed while
every player kill threw. The raid harness, where the player actually fights,
caught it in a minute. It has a case now.

**Split a refactor into a PR with no visible change.** The multiplayer
foundation touched 19 files and every system. Landing it first, gated on "solo
plays byte-identically and every suite is green", means the networking PR can
be reviewed for networking rather than for whether the game still works.

---

## 9. How to verify

**The gate is zero failures, not a particular count** — the suites grow every
round. Current expected totals:

| Suite | Expected |
| --- | --- |
| `npm test` (Node, pure logic) | 69 |
| `tests/browser-smoke.js` | 340 |

**Run the browser suite with the page visible and focused.** Its waits are
counted in animation frames. A backgrounded tab throttles
`requestAnimationFrame` to about 1fps — the same suite then takes two hours
instead of four minutes — and a *hidden* page (the in-app browser pane when it
is not on screen) fires no frames at all. In Playwright, call
`page.bringToFront()` before running. If frames stop for five seconds the
suite now fails saying so; if the budget guard trips it reports the frame rate
it saw.

A Playwright tab that has been open for many runs can also be throttled by
Chromium to a frame or two a second while still reporting itself visible and
focused; the budget guard then fires "at 1.0fps". Open a fresh tab for each run
and measure `requestAnimationFrame` for a second before starting.

The suite runs about six minutes. Kick it off asynchronously and poll:

```js
window.__r = null;
window.runDeadlineSmoke(360000).then((r) => { window.__r = r; });
// later: window.__r.failed, window.__r.failures, window.DEADLINE.errors
```

**The suite drives the menu with real clicks.** Every menu button records its
rectangle in `G.menu.rects` under its label (`'NEW GAME'`, `'LOAD:<slotId>'`,
`'ROW:moveRight'`…), exposed as `window.DEADLINE.menu.rects()`. Section
*0. title screen* clicks them through `mouseMove`/`mouseDown`/`mouseUp`, types
into the real name field through `DEADLINE.menu.setText()`, and at the end
deletes every slot the run created and restores the bindings it found — the
suite must leave the player's own saves alone.

**Verifying the multiplayer foundation.** The smoke suite's section
*11i. a second survivor* joins a second player with `api.joinPlayer()`, drives
them by writing to `p2.intent`, and asserts the co-op rules: enemies pick the
nearer player and ignore a downed one, a swing and a magazine into a teammate
do nothing, players pass through each other, and the downed → revive → real
death → respawn cycle. It leaves through `api.leavePlayer()`, and the solo
sections before it are unchanged.

```bash
npm test
```

The browser suite is injected into the running dev server:

```bash
npm run dev
```

Then in the page: fetch and eval `tests/browser-smoke.js` and call
`window.runDeadlineSmoke()`. Check `window.DEADLINE.errors` is empty too.

`tests/raid-harness.js` builds a standard compound and plays a raid of a given
tier. **The number you pass is `G.raidsDone`, a zero-based index, not the raid's
ordinal** — `buildTestBase(2)` is the third raid, `HEAVY HORDE`. Reading it as
"raid 3" makes the table below look like a balance collapse when nothing has
moved; it cost a session an hour. The compound it builds is fixed at roughly
first-raid strength whatever index you pass, so high indices are *meant* to
flatten it.

**Current reference figures — a change that moves these needs a reason:**

| Index | Spec | Duration | Structures lost | Walls dropped to |
| --- | --- | --- | --- | --- |
| 1 | RUNNING HORDE | ~70s | 0 | ~90% |
| 2 | HEAVY HORDE | ~80s | 0–2 | ~12–34% |
| 3 | SIEGE | ~150–260s | the whole base | 0% |
| 5 | BEHEMOTH SIEGE +1 | overwhelming | the whole base | 0% |

**These are single runs of a stochastic harness — treat them as ranges, not
figures.** Index 3 has been measured at 154s, 177s and 261s on identical code.
What matters is that no raid reaches the 300s backstop, not the exact number.

The harness plays the defender itself, and after a death it now walks back to
the base on foot. Without that it respawned across the map, never found another
target, and every later sample was a flat line that read as a stalled raid.

`window.DEADLINE` exposes `newGame`, `teleport`, `god`, `giveAll`, synthetic
input (`key`, `tap`, `mouseDown`, `aimAt`) and the whole `api` surface.

---

## 10. Session protocol

**Starting a session**

1. Read this file. It is loaded for you via `CLAUDE.md`.
2. `git log --oneline | head -5` and `gh pr list` — know what landed and what is
   in flight.
3. If a PR is open, check for review comments before starting new work.

**Finishing a session**

1. Both suites green; raid figures still in range.
2. Update **§3 Where we are**, **§7 Roadmap**, and the changelog below.
3. Add anything learned to **§8 Lessons** and `tasks/lessons.md`.
4. Add a row to **§6 Decision log** for any choice a future session might undo
   without knowing why.
5. Commit, PR, address review, merge.

---

## 11. Changelog

Newest first. One line per meaningful change.

- **2026-09-06** — Title screen, save slots, key bindings (PR A2). The game
  boots to a menu; saves are slots (any number, delete with confirm, the old
  single save migrated into slot 1); every key rebindable from a controls
  screen on the title and the pause menu. `save.js` split into format
  (`serialiseGame`/`applySaveData`) and address (`saves.js`); the UI kit moved
  to `kit.js`. Asked for by the owner while PR #9 was in review.
- **2026-09-06** — Multiplayer foundation (PR A): `G.players[]` with
  `G.player` as the local alias, the intent/simulation split, actor parameters
  through damage, XP, threat, cost, building, crafting, vehicles and survivors,
  per-player enemy spawning and targeting, downed/revive. Twenty-six new smoke
  assertions; solo unchanged. The raid harness caught a TypeError on every
  player kill that the smoke suite had no case for; the Codex review found
  four more (remote edge intents repeating at 60Hz, two drivers in one car, a
  leaver's car left running, roadkills paid to everyone), each reproduced
  against the running game before the fix. The owner reversed "no
  multiplayer".
- **2026-09-06** — Slot inventory: a 30-slot pack grid, six-slot hotbar, five
  equipment slots (head/body/hands/legs/feet) with fifteen gear pieces, drag
  and drop throughout, and capacity by weight. Save → v7. Asked for three
  times before it got built.
- **2026-09-06** — First playtest. Ambient spawning now relents where the player
  has cleared: a decaying quiet field means killing a group buys ~30s with
  nothing new arriving, measured. XP curve steepened — level 7 costs 2.5× what
  it did, level 10 nearly 5×.
- **2026-09-06** — Raids can no longer strand: a raid with no progress for 25s
  breaks off instead of running to the 300s backstop, and a raid the player did
  not finish pays out by share of the horde killed. Found while verifying PR #4,
  reproduced on `main`, fixed separately.
- **2026-09-06** — PR #4 merged: drivable cars, keys/lockpicks/hotwiring, boot
  storage, headlights. Save → v6. Five review findings, three P1, including a
  soft-lock when the car you were driving was wrecked.
- **2026-09-06** — Added this document and a root `CLAUDE.md` so sessions start
  oriented.
- **2026-09-05** — PR #3 merged: ~24 searchable furniture types, bunks gating
  the roster, four survivor jobs. Save → v5. Three review rounds, 14 defects.
- **2026-09-05** — PR #2 merged: SPECIAL attribute trees replacing the upgrade
  draft, day/night cycle with a lighting pass, survivor NPCs. Save → v4.
- **2026-09-05** — PR #1 merged: the playable MVP.
