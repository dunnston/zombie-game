# tasks/todo.md

## Current round — the map expansion

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
- [ ] The owner walks it

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
