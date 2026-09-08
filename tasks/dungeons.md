# Instanced dungeons — design note

**Status: design only. Nothing is built, nothing is scheduled.** This is the
record of a thinking session on 2026-09-08 so the decisions in it are not
re-derived from scratch later. The owner asked for the idea to be thought
through, not implemented.

Read `PROJECT.md` first. This note assumes it.

---

## 1. The idea

Big buildings — hospital, school, prison, mall — become **instances that load**
rather than interiors you walk into. Each is a self-contained run with a
phase-based boss at the end. They are hard enough that you need to level and
gear up first, and they drop a resource that unlocks a crafting tier.

The reference points the owner named for the boss fights are Terraria, WoW and
Core Keeper: telegraphed patterns, and the pattern changing when the boss's
health crosses a threshold.

---

## 2. Settled — the owner has decided these

| Decision | Reasoning |
| --- | --- |
| Not level-locked. Difficulty is the gate | Pillar 2. The door has no check on it: you can walk into the prison at level 4 and die. The gate lives in the boss's damage numbers |
| They are loaded instances, not walk-in buildings | A separate world, not a footprint carved into the 320-tile map |
| The reward is a resource and a crafting tier | Not a stat, not a level, not a quest flag |
| Bosses have phases, changing at health thresholds | With mechanics to deal with, not a bigger health bar |
| **Building is disabled completely inside** | Explicit exception to pillar 7 — see §5 |
| Die inside → your pack drops at the **entrance**, in the overworld | You keep what you came in with. The walk back is the cost |
| Loot found inside **stays** inside unless you kill the boss | The boss is the exit valve for value |
| New systems are fine | The design is not constrained to what already exists |

## 3. Open — needs a call before anything is built

1. **Does walking out voluntarily also lose the haul?** The rule as stated says
   yes: *only* the boss releases loot. That makes the boss mandatory and means
   there is no such thing as a partial run. Taken as the working assumption
   below, because it is what the sentence says and it is the stronger design —
   but it is the single most consequential open item, because of §6.
2. **Does the player get a dash?** See §8. It decides what a fair telegraph
   window is, so it has to be answered before a single boss pattern is authored.
3. **How much does the haul pouch hold?** See §6.
4. **Which four, and in what order?** A proposal is in §10.

---

## 4. Why this does not break pillar 2

Pillar 2 is *danger is the only gate; nothing is level-locked*, and quests are
on the deliberately-not-building list. "Needed for progression" could easily
become a level lock wearing a different hat. It does not here, because of what
is gated and how.

**The gate is a material.** `crafting.js` gates on one integer —
`r.bench <= benchTier`, currently 0/1/2. A dungeon-unlocked tier is `bench: 3`,
needing a new bench structure whose cost includes a material found only inside
a dungeon. The resource is the gate, and the resource is behind danger. No new
unlock system, no flags, no quest state: one number and one recipe.

**Nothing checks your level, ever.** Not the entrance, not the boss, not the
recipe. You are stopped by dying, which is the only gate this game has.

That also gives repeat runs a point: deeper tiers drop more of the material, so
re-running is how you afford the tier rather than how you grind a level.

---

## 5. Building disabled — what it buys and what it costs

The owner's call, and it closes an exploit that would otherwise eat every boss
ever designed for this game.

**The exploit.** Pillar 7 is build-anywhere; invariant 2 is that bullets pass
over player structures. So the first thing any player does to a boss is box it
in with six Stone Walls (430hp, costs only stone and sticks) and shoot it
through them. There is no pathfinding, so the boss genuinely just stands there.
Every phase, every telegraph, every mechanic bypassed for thirty seconds of
gathering. Disabling building kills it outright.

**The non-obvious payoff: pathfinding gets cheap inside.** The expensive part of
a flow field is recomputing it when a wall changes — which is why the roadmap
entry for the overworld is a big job. Inside a dungeon with building disabled
**nothing ever changes**: no player walls, no destructible structures, no
repair. The field is computed once at instance generation and never touched
again. No invalidation, no incremental update, no mid-raid budget.

So dungeon AI can be genuinely good — enemies flanking through side rooms, adds
reaching you around a pillar — for a fraction of what the same quality costs
outside. **This inverts the obvious sequencing: the dungeon is the cheapest
place to build and prove the flow field, and the overworld version is the
harder follow-on that inherits tested code.**

It also deletes a lot from the instance update loop. Turrets, traps, repair,
salvage, generators, raids and bedroll respawn simply do not run inside. That is
real headroom for a boss arena thick with adds and projectiles.

**What it costs.** It is an explicit exception to pillar 7 and needs saying out
loud, or a future session will read the pillar and "fix" it back into the
exploit above. It also removes the game's strategic layer — see §6.

---

## 6. Death, extraction and the haul

The owner's rule: **die inside and your pack drops at the entrance; loot found
inside is lost; to get dungeon loot out you must kill the boss.**

This is a strong rule. It turns the boss from a loot piñata into the exit valve
— every container in the dungeon becomes deferred reward that only pays on the
kill — and it kills the suicide-extract exploit that ruins most games in this
space. There is no reason to run in, grab, and die on purpose.

Four things follow from it.

### 6.1 All-or-nothing extraction caps how long a dungeon can be

If only the boss releases loot, there is no partial run: you win or you get
nothing. A 25-minute dungeon lost at the last fight is brutal enough to stop
people playing. **8–12 minutes** is where the same rule reads as tense rather
than punishing — you lose an episode, not an evening.

That is a hard budget on room count, enemy density and boss length, and it must
be written down before the first layout, because a dungeon is very hard to
shorten after it is authored.

### 6.2 The loot-weight trap, and the haul pouch

`carryCap` is one budget covering pack *and* hotbar (`packAllowance()` nets it
off). Naively, that means the better your looting run, the heavier you are going
into the hardest fight in the game — so players will rationally **not loot until
after the boss**, which makes the entire dungeon before the boss pointless.

The fix is two independent budgets:

- **What you fight with** — pack and hotbar, `carryCap`, exactly as now.
- **What you carry out** — a separate **haul pouch** with its own capacity, not
  counted against `carryCap`.

You still decide how much to try to extract, and everything in the pouch is
still at risk. Filling it just does not degrade your combat. The rule survives
intact; the perverse incentive does not.

### 6.3 Provenance is a ledger, not a per-item flag

The awkward case: you bring 40 rounds of 9mm and find 20 inside. They stack.
Which twenty do you lose?

Do not flag items. Keep a per-run tally of what was gained:

```js
run.gained = { ammoP: 20, med: 3 }
```

On death, subtract `min(gained, held)` per id. On a boss kill, clear it and cash
out the pouch. That handles stacking, consumption and partial use for free.

It also enables something good: **found consumables are usable inside but not
extractable.** The medkit you find halfway through is a real resource for the
run — you just cannot take it home. That makes mid-dungeon supply caches
meaningful instead of loot you are afraid to touch.

### 6.4 The failure mode to design against

Because everything funnels through one fight, the worst outcome is *twelve good
minutes, wiped at 15% boss health, nothing to show*. That will be the first
complaint the first time it is played.

Two guards:

- A supply cache in the antechamber before the boss door. Costs some loadout
  tension; means "I ran dry clearing the dungeon" is not an automatic zero.
- **Do not make the boss a damage check.** If the fight is about surviving
  patterns rather than out-DPSing a health bar, arriving low on ammo makes it
  longer and scarier rather than mathematically impossible.

### 6.5 The entrance pack needs no new machinery

Checked against the code. `dropBackpack()` already sweeps bag, hotbar *and*
equipped gear into one pack and clears equipment (keeping the starting weapon so
a respawn is never toothless). `collectBackpack()` already handles recovering
only what fits and leaving the rest. Packs persist in the save and do not expire.

So dying inside strips you to a pack at a fixed, memorable overworld spot, and
the walk back with nothing but a pipe is a proportionate cost on code that
already works. It is one coordinate substitution: drop at the entrance rather
than where you fell.

The punishment for a failed run is a *walk* — exactly the kind of cost this game
already knows how to charge.

### 6.6 What replaces the strategic layer

Outside, the strategy is *what you build*. With building gone, the dungeon's
verbs are move, sprint, shoot, melee, heal, interact — thin for a ten-minute run.

The replacement is **what you bring**: a pre-entry loadout screen, no stash
access inside, weight that actually bites, and an ammo economy that can run out.
The strategic decision moves from "what do I construct" to "shotgun and less
ammo, or carbine and no medkits", and it is made once, before committing — which
suits a run you cannot leave and re-enter.

That makes the existing weight system suddenly load-bearing in a way it is not
today.

---

## 7. Instances: authored overworld, procedural interiors

Because the interior is a loaded instance, it does not have to be authored into
the 320-tile map and does not have to be the same twice. That gives a clean
split which normally cannot coexist:

> **The overworld is authored and learnable. The instances are procedural and
> re-runnable.**

They do not fight because they are separate `world` objects.

**It also sidesteps the worst save hazard in the project.** Invariant 7: container
identity is the ordinal index into `world.containers`, so content changes
invalidate every save — this has bitten twice. If instance containers never
enter `world.containers` and a run is never saved, **dungeon generation can
change forever without touching the save version.** That matters enormously for
a system that will want heavy iteration.

What persists across a run is one small field — `G.cleared = { school: 2 }` —
which is version-safe.

**The coupling is thinner than expected.** `G.world` is read in 64 places but only
~17 are simulation; most systems (`isBlockedPx`, `dangerAtPx`, `propAtTile`,
`initPressure`) already take `world` as a parameter, and `createWorld(seed)` is
already a pure function returning a self-contained object. Camera clamping and
the minimap read `world.w * TILE`, so they generalise for free.

**Rules that fall out:**

- Quitting inside puts you back at the entrance on load. A run is never saved.
- The ambient spawner is **off** inside. A finite authored population is what
  makes a dungeon clearable; the standing-population spawner is what makes the
  overworld never quiet and would defeat the whole thing.
- No raid may fire while every player is inside. Coming back to a base flattened
  by a raid nobody saw is the worst feel-bad the feature can produce. Bank the
  threat and land it shortly after they step out.

---

## 8. Bosses

### 8.1 What the code already gives

`enemies.js` already has the telegraph primitive:

```js
if (e.windup > 0) {
  e.windup -= dt;
  if (e.windup <= 0) { /* land the blow */ }
  continue;                     // committed to the swing
}
```

A winding-up enemy is frozen and committed. That is what a telegraphed boss
attack is — a longer windup with a visible tell. `FX.ring` (already fired on
boss hits), `shake()`, `G.slowmo`, `G.flash` and `FX.text` all exist.
`spawnEnemy` gives adds. `damagePlayer(p, dmg, x, y, sourceName)` is the hook
every attack lands through. `behemoth` already carries `boss: true`, and
`loot.js` already branches on it for a boss drop.

### 8.2 What is genuinely new

**Hostile projectiles.** `updateBullets` only ever queries the *enemy* spatial
hash — bullets can hit enemies and nothing else. Every ranged attack in the game
today is player-or-turret-to-zombie. A boss that throws anything needs a
`hostile` branch checking players and survivors instead. Small (with ≤4 players
a plain loop beats a hash), but real.

Worth knowing: that one branch also gives **ranged zombies** for the whole game
— spitters, a shooter at Checkpoint Delta. Arguably a bigger deal than the
bosses, and cheap to feel-test on its own.

**A boss script layer.** Every enemy shares one behaviour loop. A phase boss
needs a state machine, and per the project's own lesson (*put every tunable in
one file*) it should be data in `config.js` driving a small `boss.js`:

```js
phases: [
  { at: 1.00, moves: ['charge','summon'],        cd: [2.4, 3.6] },
  { at: 0.66, moves: ['charge','slam','summon'], cd: [2.0, 3.0], onEnter: 'killTheLights' },
  { at: 0.33, moves: ['slam','spray'],           cd: [1.6, 2.4], speedMul: 1.3 },
]
```

Pick a move off cooldown → telegraph → execute → recover. The health-threshold
transition the owner described is `hp/maxHp` crossing `at`. Roughly 250–350
lines including the moves.

### 8.3 The mechanic vocabulary this game can support

**There is no dash.** The player has sprint at `sprintMul` 1.62 on a stamina bar
(`stamDrain` 26/s, `stamRegen` 20/s, 0.65s delay) and no i-frames outside
respawn/revive grace. So today **stamina is the dodge**, and the Marathon perk
quietly becomes a boss-fight perk.

That is a blunt instrument for telegraphed patterns. Every game in the owner's
reference set gives the player a fast committed movement option with
invulnerability in it, and the whole phase-boss vocabulary is built on that
assumption. **A dash is open question 2**, and it should be treated as a combat
decision rather than a dungeon feature — it changes how every existing fight
feels, including kiting a runner and breaking from a brute. `p.invuln` exists
and is honoured by the damage path, so the i-frames have somewhere to live; the
work is all in the feel.

**Families that work here:**

| Family | Notes |
| --- | --- |
| Slam | Growing ring telegraph, radius damage. Cheap |
| Charge | Windup, straight line, contact damage. Cheap |
| Adds | `spawnEnemy` at arena points. Free |
| Ranged / spray | Needs hostile projectiles (§8.2) |
| **Use the arena** | Generators to power, a light to relight, a valve to hold |

The last one matters most. It is what stops the fight collapsing into kiting in
a circle — the failure mode of every top-down boss without a dash — and it is
what makes a mechanic feel like a mechanic rather than incoming damage.

### 8.4 Two things that decide whether phases read

**The transition needs an unmistakable beat.** A phase change that is not obvious
reads as inconsistent AI, not a fight. Shake, a roar, adds despawning, a colour
shift, a half-second where it is invulnerable and doing nothing.

**The arena must fit the telegraph.** `G.camera.zoom` is a field and sits at 1. A
slam ring whose edge is off-screen is not a mechanic. A boss arena probably
wants a zoom-out on entry — cheap, but it constrains arena size, so decide early.

---

## 9. Pacing, without building

With building gone the space itself has to carry the pacing: doors needing a key
or a lever, a room that seals behind you, a wing you have to power before the
lift works. A small new system — an instance objective state plus a door entity
— and it is what makes a run read as a dungeon rather than one large room with a
boss in it.

It also gives arena mechanics somewhere to come from: a phase-2 transition that
kills the lights *and* locks the doors is one system doing three things.

---

## 10. Co-op

Host-authoritative, one shared sim. If one player enters and another does not,
the host must run two worlds and filter snapshots by world as well as distance.

**Make it a design rule instead: the door requires every living player, and
everyone transitions together.** A dungeon is a party commitment. This is better
than the compromise it replaces, and it falls out cleanly — `updateSpawning`
already iterates `G.players` and culls enemies beyond 2400px of *every* player,
so with nobody in the overworld there is nothing out there to simulate.

- **Extraction is a party event.** If the boss dies, everyone who came in
  extracts — including someone down or dead that run. Otherwise "my friend died
  at 90% and lost their whole haul" is friendship-testing, and it pushes people
  away from reviving.
- **A full wipe ejects everyone**, each to their own entrance pack.
- Downed-and-revive works inside unchanged.

---

## 11. The four, and an order

Hospital and mall exist as districts (St. Martha, Galleria). **Prison and school
do not** — Precinct 12 is a police station. Both are new district work for the
overworld entrance, even though the interiors are instanced.

A ladder matching the existing west→east danger gradient:

| Dungeon | Tier | Role | Suggested unlock |
| --- | --- | --- | --- |
| School | ▲▲ | The teaching dungeon. Short, one boss, learns you the rules | The bench-3 material, in small amounts |
| Hospital | ▲▲▲ | The dark one. Corridors, the flashlight, close quarters | Medical tier |
| Mall | ▲▲▲ | The open one. Atrium, crowds, sightlines | Storage / gear tier |
| Prison | ▲▲▲▲ | The hard one. Cell blocks, funnels | The top of the tier |

**Depth tiers**: three authored, then stop. Precedent exists — five authored raid
tiers then scaling. Endless scaling is balance nobody can feel-test.

**A refinement worth taking:** if the boss kill releases *everything*, the boss
does not also need to be the sole source of the tier-3 material. Put the
material in the dungeon's regular containers. Then the whole run holds value
rather than just the last ninety seconds, depth tiers scale naturally (deeper =
more rooms = bigger haul), and the boss stays what the extraction rule made it —
the lock on the door. It can still drop something unique on top.

---

## 12. Honest inventory of the work

| Piece | New? | Rough size |
| --- | --- | --- |
| Dash + i-frames | New | Small code, large tuning. Affects the whole game |
| Hostile projectile path | New | ~40 lines + a `hostile` branch in `updateBullets` |
| Boss script layer (`boss.js` + `config.js` data) | New | 250–350 lines |
| Instance machinery (world swap, entry/exit, ledger, pouch) | New | The largest single piece |
| Flow field | New | Cheapest inside (§5); the overworld version is the follow-on |
| Doors / keys / objective state | New | Small |
| Loadout screen | New | Small; reuses the inventory UI |
| Entrance pack on death | Existing | One coordinate substitution |
| Camera zoom per arena | Existing | A field |
| Adds, telegraph windup, boss loot branch, lighting | Existing | — |

Comparable in total to the multiplayer work. Three or four PRs.

---

## 13. Suggested build order

1. **Dash** — decide it, build it, feel-test it in the overworld. It sets the
   telegraph budget for everything after, so nothing else should start first.
2. **Hostile projectiles** — playable on its own as ranged zombies. Feel-test
   cheaply before any instance work exists.
3. **Instance machinery + flow field**, together, since the instance is where
   the field is cheapest and safest to prove.
4. **Boss script layer** — data-driven phases.
5. **One dungeon, authored end to end.** Pillar 5: cut breadth, not quality.
   Four shallow dungeons is the failure mode here.

Steps 1 and 2 are both playable in the existing world, so the two riskiest
pieces get feel feedback before anything is committed to the instance system.

**A cheaper de-risk than all of it:** build the boss script layer and hostile
projectiles, and put one phase boss in the overworld — a behemoth variant at
Checkpoint Delta. That answers "do phased fights feel good in this engine" with
no instance machinery, no save questions and no co-op transition problem. If
they feel good, the instance is then just where they live.

---

## 14. Risks

- **The dash decision is load-bearing and easy to defer.** Authoring boss
  patterns before it is answered means re-tuning all of them afterwards.
- **All-or-nothing extraction is spicy.** It is the right stance for tension but
  it makes dungeon length a balance problem rather than a content problem, and
  it is only discoverable by playing.
- **Two roadmap items are still unplayed.** The owner has not walked the
  expanded map and has not played co-op between two houses. Both outrank this,
  and §8 of `PROJECT.md` is emphatic that feel questions are only answered by
  playing.
- **This is the biggest system since multiplayer.** It should not start while
  the two questions above are open.
