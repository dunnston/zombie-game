# DEADLINE — Project Document

**This is the living source of truth for this project.** It is meant to be read
at the start of a session and updated at the end of one. If something here
contradicts the code, the code is right and this file needs fixing — say so.

- **Last updated:** 2026-09-06, after PR #4 (drivable cars) went to review
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

**Status: a genuinely playable game, well past MVP.** Four rounds of work
merged or in review. Never yet played by a human — everything below is verified
mechanically, not for feel.

| | |
| --- | --- |
| Source | 27 modules, ~10,500 lines, no dependencies but Vite |
| Assets | Zero. Every sprite is drawn in code at boot; every sound is WebAudio. |
| Tests | 52 Node assertions, 211 browser assertions |
| Save format | **v6** (on the cars branch); v5 on `main` |
| Performance | ~57fps with 90 active enemies |

### Shipped

| PR | What |
| --- | --- |
| [#1](https://github.com/dunnston/zombie-game/pull/1) | The MVP: world, combat, scavenging, building, threat, raids, progression, save |
| [#2](https://github.com/dunnston/zombie-game/pull/2) | SPECIAL attribute trees, day/night cycle, survivor NPCs |
| [#3](https://github.com/dunnston/zombie-game/pull/3) | Searchable furniture, bunks gating the roster, survivor jobs |
| [#4](https://github.com/dunnston/zombie-game/pull/4) | **In review** — drivable cars with keys, lockpicks and hotwiring |

### The single most important outstanding thing

**The owner has not played it yet.** Every balance number below was tuned
against an automated harness that plays a fairly static defender. Feel — whether
the shotgun is punchy, whether kiting a runner is tense or annoying, whether
raid 3 lands as a spike or a chore — is unverified. A single play session should
outrank anything on the roadmap.

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

**Building.** Walls in four tiers, gate, spike trap, workbench (2 tiers), stash,
bedroll, bunk, watchtower, generator, turret, floodlight, plus repair and
salvage. Anywhere on the map.

**Threat and raids.** A meter driven by player activity, not a calendar. Five
authored raid tiers then endless scaling, in waves, targeting the perimeter.

**Progression.** Six attributes (STR/PER/CON/CHA/INT/LCK) ranked 1–10, each with
a perk tree gated on that attribute's rank. 27 perks. Levels grant skill points
and never interrupt play.

**Day and night.** ~9-minute days on a smooth light ramp. Night nearly doubles
enemy density, sharpens their senses, and nearly doubles Threat gain.

**Survivors.** Recruited from the world, housed in bunks, capped by Charisma.
Four jobs: Guard, Sniper (on a watchtower), Scavenger, Builder. They level up,
eat Rations, and die permanently.

**Cars** *(in review)*. ~30 in town, most locked. Three ways in: a key hidden
near the car, a craftable lockpick (odds scale with Perception), or the Hotwire
perk. A 400-unit boot, headlights, roadkill, and fuel/noise/bodywork as costs.

---

## 5. Architecture

```
src/
  main.js            boot, fixed-timestep loop, debug hooks (window.DEADLINE)
  core/              util, input, audio, sprites, particles — no game rules
  game/
    config.js        ALL tunables and content data. One file to balance.
    state.js         the mutable G object + shared low-level accessors
    world.js         map generation, tile collision, danger field
    player.js  enemies.js  combat.js  damage.js
    loot.js  building.js  crafting.js  threat.js  raid.js
    perks.js         attributes, perk trees, the stat recompute pass
    progression.js   XP, levels, spending points
    daynight.js  survivors.js  vehicles.js
    save.js          LocalStorage serialisation
    game.js          update order, interactions, tutorial, camera
  render/renderer.js world drawing, y-sorted draw list, night pass
  ui/hud.js          HUD, panels, map, menus (immediate-mode, on canvas)
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

---

## 7. Roadmap

### Next up (highest value first)

1. **The owner plays it.** Everything else is guessing until then.
2. **A flow field for raids.** One Dijkstra map toward the base, recomputed when
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
crafting timers, many ammo calibres, farming, multiplayer, NPC factions,
dialogue, quests, huge procedural worlds, realistic electrical or plumbing
systems. From the original brief, and still right.

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

---

## 9. How to verify

```bash
npm test
```

52 Node assertions over pure logic. Must be 52/52.

The browser suite is injected into the running dev server:

```bash
npm run dev
```

Then in the page: fetch and eval `tests/browser-smoke.js`, call
`window.runDeadlineSmoke()`. Must be 211/211 with zero `window.DEADLINE.errors`.

`tests/raid-harness.js` builds a standard compound and plays a raid of a given
tier. **Current reference figures — a change that moves these needs a reason:**

| Raid | Duration | Structures lost | Walls dropped to |
| --- | --- | --- | --- |
| 1 | ~40s | 0 | ~100% |
| 3 | ~70s | 0–2 | ~12–28% |
| 5 | overwhelming | the whole base | 0% |

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

- **2026-09-06** — Added this document and a root `CLAUDE.md` so sessions start
  oriented.
- **2026-09-06** — PR #4 opened: drivable cars, keys/lockpicks/hotwiring, boot
  storage, headlights. Save → v6.
- **2026-09-05** — PR #3 merged: ~24 searchable furniture types, bunks gating
  the roster, four survivor jobs. Save → v5. Three review rounds, 14 defects.
- **2026-09-05** — PR #2 merged: SPECIAL attribute trees replacing the upgrade
  draft, day/night cycle with a lighting pass, survivor NPCs. Save → v4.
- **2026-09-05** — PR #1 merged: the playable MVP.
