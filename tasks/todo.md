# tasks/todo.md

## Current round — stamina, light, storage, noise, the bow and manned towers

Owner, 2026-09-07, after a play session. Twelve notes, taken in one PR at their
request. Four decisions were taken with them before any code: one PR rather
than three; fire spreads to zombies and scenery but never to player structures;
ALL storage becomes slot-limited, the Supply Stash included; and the torch goes
in a new off-hand slot.

- [x] **Chopping costs stamina.** 6 a harvest swing, recovery locked for 1.1s,
      2 for a combat swing and never refused. Three trees to a full bar at
      starting stats, then a three-second pause. Measured in the browser.
- [x] **Exhaustion latches.** The first version set `winded` at zero stamina,
      which chopping never reaches (110 is 18 swings of 6, so the bar stops at
      2) — a held button felled trees forever at a sixth speed. It latches on
      the refusal now. The first fix did literally nothing; the browser found it.
- [x] **Stamina is a stat.** CON raises recovery as well as the ceiling; a new
      CON perk, Woodcraft, cuts harvest cost 35% a rank. Both surfaced on the
      character sheet, and the HUD's low-stamina warning is fractional rather
      than the absolute 12 a high-CON character never reached.
- [x] **Litter cut again**, 4,246 → 2,372 pieces. Safe this time because the
      camp is protected directly by a starter cache rather than by hoping the
      global odds land near the spawn — measured, the odds alone left three
      stone inside fifteen tiles against a Hatchet's three.
- [x] **Off-hand slot, Torch, Flashlight, batteries.** `ARMOR_SLOTS` splits out
      so every armour rule still means the five that carry damage reduction.
      A lit player is noticed 90px further out.
- [x] **Storage.** Stash → 48 slots, Chest 16, Locker 32, a two-panel drag
      screen, `stashOrDrop` on every path that used to write to an infinite
      pile, spilling on destruction, and `G.stashItems` deleted.
- [x] **Noise.** One `makeNoise`, aggro that expires so the existing branch is
      reachable at all, `noiseMul` applied everywhere, and turrets, generators,
      building and chopping made audible.
- [x] **Bow and arrows**, bench 0, three arrows to a walker, a seventh of a
      pistol's noise, no muzzle flash. Arrows cost only hand-gathered material.
- [x] **Manned towers.** Four armaments bought once and set per tower; arrows
      free, sniper/fire/cannon bought. Fixed the `posted`/`sniping` split.
- [x] **Fire.** Burning enemies and burning scenery, spread, burn-out that
      removes the prop for good, damage to anyone standing in it, and no path
      at all to a player structure.
- [x] Save → v12, fingerprint `a62c50c2` → `cd427428`. Verified the world
      change is isolated: containers, vehicles, tiles and every non-litter prop
      are byte-identical to `main`.
- [x] Node tests 98 → 126. Browser suite updated for the slot stash (it poked
      `G.stash.wood = 200` in 42 places), the six equipment slots and the new
      container prompt.
- [x] Docs: PROJECT.md §3 §4 §5 §6 §7 §8 §9 §11, README, this file, lessons.
- [x] `npm run smoke` — **395/395**, no runtime errors. Eight failures on the
      first complete run, all fixed: three were the suite assuming infinite
      storage, one was the intended armament change, and four were a fixed
      four-frame wait for a loopback welcome that takes sixteen.
- [x] Raid harness 1–3 — all completed, none near the 300s backstop. Two
      figures moved and PROJECT.md §9 records why.
- [ ] The owner plays it.

### Review

**What was measured rather than guessed.** Every balance number in this round
was taken from the running game: three trees at 2.7s/5.9s/9.1s with the winded
latch at 9.7s and recovery at 12.7s; a torch taking the ground around the
player from 36.7 to 58.5 brightness and a flashlight adding 20.6 at 300px where
a torch adds nothing; eight walkers closing 91px on their own against 250px
after one sound; four arrows into a walker for 19/19/19/34.2; and six seconds
of each tower armament against three walkers — arrows 81 damage for 7 arrows,
fire 98 plus two alight and two scenery fires, sniper 174 and three kills.

**Three things this round found that were already broken.** `alertEnemies` had
never worked, because aggro never expired. `crafting.js` had grown a private
third copy of the loot entry-id encoder the decision log says must be unique.
And `posted` and `sniping` were two different answers to "is this survivor on
their tower", so one walking toward it already had sniper ballistics.

**Both suites run, on request.** `npm test` 126/126, browser **395/395**,
`DEADLINE.errors` empty, raid harness 1–3 all completing.

The browser suite needed real work to run at all. It poked `G.stash.wood = 200`
in 42 places, which a slot container ignores, and it could not report any of
its own failures: one linear function meant a single null dereference threw the
whole run away — no results, no cleanup. Its body is wrapped now, and
`setStash` frees space rather than silently under-delivering.

**The raid figures moved, and the reason is the point of the round.** Index 1's
walls took more damage (90% → 48%) and index 3 resolved in 77s rather than
150–260s. Both because turrets make noise now: the horde is pulled onto the
thing shooting at it rather than wandering or chasing the player, so more of
them reach the walls sooner and far fewer end up as stragglers — which is what
the long tail on index 3 was. Index 2 landed squarely in its old band, and
nothing came near the 300s backstop.

## Previous round — mining balance and the metal tool tier

Owner, 2026-09-07: "There are WAY too many sticks, stones and fiber on the map
right now. Also it is way too easy to mine trees and boulders. We need to make
this take a little longer with the basic axe and pickaxe. This will give a
reason to upgrade later."

Measured before touching anything: **14,847 pieces of ground litter** (~41,000
units of free material), a tree fell in **one** hatchet swing (70hp vs 72 per
swing) and a boulder in **three**. So the complaint is exactly right, and the
tree number is a bug-shaped balance figure rather than a soft one.

Owner chose, when asked: add the metal tier in this round (there is nothing to
upgrade to otherwise), and cut litter to about a quarter.

- [x] Litter down to ~a quarter: grass/dirt 0.30 → 0.08, gravel/sand/field
      0.22 → 0.055, tarmac 0.10 → 0.02. **14,847 → 4,246 pieces**, ~41,000 →
      ~11,800 units of free material
- [x] Tree 70hp → 470: **six** hatchet swings (3.12s) instead of one
- [x] Boulder 150hp → 380: **six** stone-pickaxe swings (3.72s) instead of three
- [x] Thickets and the Scythe left alone — see the note below
- [x] **Fire Axe** and **Steel Pickaxe**, bench 1, from wood/scrap/parts: three
      swings each (1.38s, 1.68s), identical yields — the upgrade buys back time
- [x] Renderer branches for both; Fire Axe on the tool rack at w:3
- [x] Save → v11, fingerprint `df706f76` → `a62c50c2`, moved together
- [x] `chopMultiplier()` exported so the swing-count test calls the real formula
- [x] Node tests: swing counts, the metal tier's shape, a litter budget with a
      **ceiling** as well as a floor
- [x] README and PROJECT.md (§3, §4, §6, §7, §9, §11), `tasks/lessons.md`

### Review notes

`npm test` 98/98 after merging main. The browser suite and the raid harness were **not** run: no
UI, render-loop or shared-helper code changed except two `drawWeapon()` branches
for the new tools, and nothing in combat, raids, structures or enemies moved.

**Not verified by running the game.** The two new tool sprites have never been
drawn on screen, and the two new recipes have never been seen in the craft
panel. That is the one gap in this round, and §8's first lesson is about
exactly this class of miss.

**The camp proxies moved.** `within(6) >= 5` and `within(15) >= 40` now measure
3 and 34, so they came down to 2 and 25. The assertion that actually protects
the opening was tightened instead: **twice** a Hatchet's cost must be reachable
within fifteen tiles on worst-case rolls. It measures 26 sticks / 11 stone / 20
fiber against a cost of 3 / 3 / 4.

**Why thickets are untouched.** Slowing every gated source would need a third
metal tool nobody asked for. Fiber is the material the litter cut hits hardest
and thickets are the rarest big source (194 on the map), so leaving them at two
scythe swings is the pressure valve. A metal scythe is the obvious follow-up.

## Previous round — the map expansion

Owner, 2026-09-06: "I want to make the current map a lot bigger. I want to add
a more rural area, a city area, a forest area, maybe a river and a pond."

- [x] 160 → 320 tiles; the town shifted to (80, 80) with its layout intact
- [x] The Marrow river down the west side, two bridges, sand banks, reeds
- [x] Loon Lake (lodge, boathouse, jetty), a town pond, a farm pond, a stock pond
- [x] Farms and ranch: fields, barns, silos, hay, paddock fences, a feed store
- [x] Forest: pines, a lumber camp with log piles, four hunting cabins, trails
- [x] City: Crown Heights apartments, Downtown towers + bank + plaza + garage,
      Galleria Mall + drugstore + outfitters, streets choked with wrecks
- [x] Junkyard and orchard in the south
- [x] Bullets pass over water and fences (`bulletBlocksPx`)
- [x] New game starts by the Roadside Camp
- [x] Sealed rooms fixed (the old four-room partition and furniture in doorways)
- [x] Save → v9; Node tests for biomes, danger tiers and reachability
- [x] Both suites green; raid harness indices 1–3 in range
- [x] Gathering: sticks, stone, fiber from bushes and rocks; the hand-crafted
      Hatchet gates trees (owner, same day)
- [x] Hand tools: Stone Knife, Stone Pickaxe and Stone Hammer beside the
      Hatchet, all bench-0; knife and pickaxe double their material's yield;
      knife unlocks Cordage (fiber -> cloth); hammer is a bench for simple
      work; stone builds a Stone Wall (owner, same day)
- [x] Boulders (pickaxe-gated) and thickets (scythe-gated): every material has
      a hand source and a big gated source worth ~3x (owner, same day)
- [ ] The owner walks it

## Previous round — structure repair

Owner, 2026-09-07: "I want to add the ability to repair structures that the
zombies damaged." Repair already existed as a build-mode card — one that a
1400px window cut off the end of the bar. The round makes it findable and
finishes it. Verified: npm test 78/78, smoke 384/384, `DEADLINE.errors` empty,
screenshots of the tool and the prompt checked by eye. Raid harness untouched
(it never repairs).

- [x] `E` beside a damaged wall/trap/turret/tower repairs it; the prompt quotes
      the bill. Stash/bench/gate/generator/bedroll prompts say how hurt they are.
- [x] REPAIR tool: bill and health on the card and over the piece, every damaged
      piece in reach outlined, hold LMB to sweep, "Intact"/"Too far" reasons.
- [x] REPAIR ALL button on the build bar: `planRepairAll()` is the label and
      `repairAll()` runs it — worst first, skip what you cannot pay for, 520px.
- [x] Bills drop materials the damage would not have used; main material ≥ 1.
- [x] Raid summary counts pieces left damaged (broadcast to guests, no key names).
- [x] Tutorial step that only speaks once a structure has been hit.
- [x] `act.repairAll` + `repairAll` command for guests; `G.stats.repaired`.
- [x] Build bar cards shrink to fit the window so the tools are always on it,
      and wrap onto more rows once they hit 60px (Codex P2: a 900px window
      still lost three cards; reproduced by screenshot, then fixed).
- [x] Tests: Node (bill scaling, parts-free scratch, plan order/budget); smoke
      (E through the real loop, tool ghost + held sweep, REPAIR ALL plan and
      run, raid notice, guest `repair`/`repairAll` commands).
- [x] Docs: PROJECT.md §3 §4 §6 §7 §8 §9 §11, README, lessons.

## Previous round — online co-op multiplayer

Owner asked for multiplayer on 2026-09-06. Agreed shape after two rounds of
questions: online co-op for up to four, one player hosts and the host's browser
runs the authoritative sim; a tiny signalling broker (not a game server) swaps
WebRTC connection details for a six-character room code; optional password
checked by the host; shared base and stash, separate inventories and
progression, no friendly fire, revive a downed teammate; guests persist in the
host's save (→ v8). Full plan: `~/.claude/plans/compiled-soaring-harp.md`.

Delivered as two PRs off `main`.

### PR A — foundation, no networking  (PR #9, branch `feat/multi-player-foundation`)

Gate: the game plays identically in solo. Both suites green. Raid figures unchanged.
Met: npm test 60/60, smoke 305/305, raid indices 1–3 in range. Codex review found
four defects (remote edge intents repeating, two drivers per car, a leaver's car
left running, roadkill XP shared); each reproduced live, fixed, and given an
assertion.

- [x] `state.js`: `G.players[]`, `G.player` as a getter/setter alias for the local
      player, `addPlayer`/`removePlayer`/`nearestPlayer`/`baseOwner`/`isLocal`
- [x] `intent.js`: per-player intent struct; `gatherLocalIntent(p)` is the only
      place simulation input is read from `Input`
- [x] `player.js`: `updatePlayer(p, dt)` reads only `p.intent`; `movePlayer(p, dt)`
      extracted for client prediction later; `respawnPlayer(p)`
- [x] Actor parameters: `damagePlayer/killPlayer/healPlayer(p, …)`, `addXp(p, …)`,
      `addThreat(amount, reason, actor)`, `canAfford/spend(cost, mul, p)`,
      building/crafting/vehicle/survivor functions take the acting player
- [x] Enemies target the nearest live player; spawning runs per player; cull is
      "far from every player"; `e.id` and pickup `id` sequence numbers
- [x] Base-wide multipliers (turret, trap, structure hp, upkeep, roster) read the
      base owner — `G.players[0]`
- [x] Kill XP goes to the killer; automated kills (turret, trap, survivor) to
      every present player
- [x] Downed/revive: with a teammate present, death becomes `downed` for 30s;
      hold E on them to revive at 40% hp; alone, the old death path
- [x] Renderer draws every player; downed look; HUD death screen knows "down"
- [x] `api.joinPlayer/leavePlayer` for tests; tests in both suites
- [x] Docs: PROJECT.md §3 §5 §6 §7 §11, tasks/lessons.md

### PR A2 — title screen, save slots, key bindings  (PR #10, merged)

Owner, 2026-09-06, while PR A was in verification: "When the player loads
should have a menu. Should include controls and key binds and allow them to
change. Continue, new single player game, multiplayer. I envision being able
to play multiple games at once — maybe I have a multiplayer save and two
different single player saves. I should be able to delete saves as well."

- [x] Boot lands on a title screen, not straight into a game: CONTINUE (most
      recent slot), NEW GAME, MULTIPLAYER (host / join — wired in PR B), CONTROLS
- [x] Save slots: `deadline.slots` index + one entry per slot. Each shows name,
      mode (solo / multiplayer world), day, level, kills, play time, last played.
      Several solo saves side by side; a hosted world is a slot too.
- [x] Delete a slot, behind a confirm. (Rename: `renameSlot()` exists; no UI yet —
      the name is chosen at NEW GAME.)
- [x] Migrate the single `deadline.save.v7` into slot 1 so nobody loses a run.
- [x] Key bindings: `src/core/bindings.js` maps actions → key codes, stored in
      `deadline.binds`; `intent.js` reads actions, never codes. Controls screen
      lists every action, click a row and press a key to rebind, RESET TO DEFAULTS.
      Mouse buttons stay fixed. Conflicts shown, not silently allowed.
- [x] Pause menu: SAVE, CONTROLS, QUIT TO TITLE (saves first)
- [x] Tests: slot round-trip and deletion under Node; smoke drives the title
      screen by synthetic click, rebinds a key and moves with it
- [x] Docs: PROJECT.md §3 §4 §6 §7 §9 §11; README controls section notes rebinding,
      and its Testing section is refreshed (it still says 52 Node / 211 smoke and
      has the Saving heading twice)

### PR B — online co-op  (PR #11, merged)

Verified: npm test 75/75; smoke 361/361 with a loopback guest; real WebRTC
through the broker between two browsers on this machine — join 1.8s, 66 KB/s
per guest, a guest's wall built and echoed, disconnect parks the character.

- [x] `server/signal.js` broker (`ws`, `npm run signal`)
- [x] `src/net/transport.js` WebRTC, two DataChannels
- [x] `src/net/host.js`, `client.js`, `events.js`, `actions.js`, `protocol.js`
- [x] Title/lobby screens, overlay inputs
- [x] Save v8 with per-identity player records; v7 migration
- [x] Teammate readability: colours, name tags, edge markers, minimap
- [x] Tests: Node protocol/save; smoke with a fake in-page guest. (No `net-e2e`
      script: Playwright is not a dependency; the two-browser check was done by
      hand through the broker and is written up in PROJECT.md §9.)
- [x] Docs, measured wire rate in PROJECT.md §9

Codex review, four findings, each reproduced against the running game first:

- [x] P1 guest left in the game scene when the host leaves (pane guest: role
      solo, scene game, playtime advancing) → `hostGone()` tears down through
      `netHooks.toTitle` and lands on JOIN with the reason
- [x] P1 paused guest keeps its last intent on the host (silent "walk right"
      moved 185px) → idle packet every paused step + 400ms expiry on the host
- [x] P2 late packet cleared held fields (fire/interactHeld/sprint all false
      after a stale packet) → `mergeLateIntent` takes edges only
- [x] P2 recruit not replicated (no `rescues` producer) → emitted on recruit
- [x] Assertions for all four in Node (75) and the smoke suite; README
      walkthrough for two developers testing from source

## Previous round — playtest response (pacing, inventory, survival)

PR 1 (pacing, #7) and PR 2 (slot inventory, #8) are merged. Still open from it:

- [ ] Crafting folded into the inventory screen as a tab (owner never found it on `C`)
- [ ] Storage tiers: Crate / Supply Stash / Steel Locker aggregating into one view
- [ ] Light hunger and thirst: soft debuffs, no health damage

## Review

_Filled in as each PR lands._

### PR 1 review notes

Measured, four player positions, 35s each after clearing six walkers:

| | before | after |
| --- | --- | --- |
| New enemies arriving | 5 | **0** |
| Longest unbroken calm | 3.2–18.6s | **33.6–34.0s** |

Two things the first implementation got wrong, both found by measuring rather
than reading:

- The suppression check tested the *spawn point*, ~1000px away, which a burst of
  kills never quietens. It has to test the ground the player is standing on.
- Reading one 256px cell made the payoff depend on where inside it you stood —
  the same six kills bought 40s of calm or none. Fixed by sampling the field
  bilinearly and calibrating the threshold from the measured spread.

---

## Round: co-op launch scripts + a version check that fires (2026-09-07)

Prompted by a real session: the owner got a LAN game working, then hit
"could not reach a signalling server" on the second machine (the guest was
defaulting to ws://localhost:8787, which is its own machine), and then asked
how to find the cloudflared link to share.

- [x] `scripts/lib.sh` — shared preflight, port guards, LAN IP, browser open,
      and process-tree cleanup that works on Git Bash and on mac/linux.
- [x] `scripts/update.sh` — pull, install, print the build id to compare.
- [x] `scripts/play-local.sh` — broker + `vite --host`, prints the friend's URL.
- [x] `scripts/play-online.sh` — host mode starts broker + vite + cloudflared
      with a pinned `--metrics` port, then reads the hostname back from
      `/quicktunnel` and prints the finished share link. Guest mode takes that
      address and starts only vite.
- [x] npm aliases: `update`, `play:local`, `play:online`.
- [x] Build id derived in `vite.config.js` from `git log -1 -- src/`, read
      through the existing `import.meta.env` guard pattern in protocol.js.
- [x] `joinRefusal()` — pure, replaces the bare PROTOCOL compare in host.js.
      A hello with no build field is a refusal, which catches every client
      older than this change for free.
- [x] Tests: logic suite covers all branches of joinRefusal; smoke suite
      asserts a wrong-build hello is rejected and never becomes a player.

### Review

`npm test` 91/91. Browser smoke 386/386, `DEADLINE.errors` empty. Raid harness
was skipped deliberately — this round touches the net handshake, vite config
and shell scripts, and no balance data.

The interesting find was that the version check we already had would not have
caught the case it exists for: `PROTOCOL` never moved during the map expansion.
The only thing that did catch a stale guest was the save-version check inside
`applySaveData`, reached by accident through the welcome message, whose wording
("this version cannot read") reads like file corruption. Both now say the same
actionable sentence.

Also learned, and worth not re-discovering: `package.json` pins vite at
`^5.4.11` but `5.4.21` is installed, and that release blocks foreign `Host`
headers with a 403. It has nothing to do with `--host`. LAN play is unaffected
because IP-literal hosts pass.

### Not done

- `scripts/play-online.sh` host mode has not been run end to end with a live
  tunnel in this round (the mechanism was proven manually earlier in the
  session: `/quicktunnel` returned the hostname, and a ws client reached the
  broker through it and got a room code back). Worth one live run.
- Cleanup on Ctrl+C is implemented per-platform but only the port-guard path
  has been exercised.
