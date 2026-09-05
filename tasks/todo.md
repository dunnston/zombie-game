# DEADLINE — Survival / Base-Building MVP

## Plan

### Phase 0 — Scaffolding
- [ ] Vite + vanilla JS (ESM) project, Canvas2D renderer
- [ ] Git repo, push to github.com/dunnston/zombie-game

### Phase 1 — Core
- [ ] Fixed-timestep game loop, camera, input
- [ ] Procedural sprite atlas (no external assets)
- [ ] Player movement, sprint, stamina, mouse aim
- [ ] Melee + ranged combat, ammo, reload, hit feedback

### Phase 2 — World
- [ ] 160x160 tile semi-procedural map with handcrafted locations
- [ ] Danger tiers by location (suburbs -> commercial -> police/hospital -> military)
- [ ] Loot containers with location-appropriate loot tables
- [ ] Cars, trees, roads, rubble

### Phase 3 — Enemies
- [ ] Walker / Runner / Brute tiers + raid-only Behemoth
- [ ] Detection, pursuit, attack, obstacle steering, structure attacking

### Phase 4 — Survival systems
- [ ] Inventory (weight-capped resources + 4 weapon slots + consumables)
- [ ] Death -> drop backpack, respawn (random until bedroll placed)
- [ ] Crafting (workbench T1/T2), immediate, resource-cost only
- [ ] Building (walls, gate, spikes, turret, generator, stash, workbench, bedroll)
- [ ] Base anywhere; stash storage; repair

### Phase 5 — Threat & raids
- [ ] Threat meter driven by player activity, decay when quiet
- [ ] 3+ escalating raid tiers, waves, enemies attack structures
- [ ] Raid rewards

### Phase 6 — Progression
- [ ] XP from combat/loot/craft/build/raids/exploration
- [ ] Level-up: choose 1 of 3 upgrades from a 14-upgrade pool

### Phase 7 — Polish
- [ ] WebAudio SFX, screen shake, particles, damage numbers, muzzle flash
- [ ] HUD, minimap, full map, tutorial prompts, notifications
- [ ] LocalStorage save/load

### Phase 8 — Testing
- [ ] node --test unit tests over pure logic
- [ ] Playwright/browser smoke test of real gameplay
- [ ] Fix all console errors, balance pass

### Phase 9 — Delivery
- [ ] README (start, controls, architecture, systems, limitations, future)
- [ ] PR -> wait for Codex review -> address -> merge

## Review

All phases complete. `npm install && npm run dev` runs the game.

### Verification
- `npm test` — 31/31 Node assertions (world gen, loot integrity, balance
  invariants, progression curves, raid escalation).
- `tests/browser-smoke.js` — 66/66 assertions against the live game via
  synthetic input, covering every system in the brief.
- `tests/raid-harness.js` — raid 1 completes in 44s with no losses; raid 3
  costs 3 structures and drops walls to 12%; raid 5 overwhelms an
  un-upgraded base. Escalation confirmed.
- Zero console errors across all runs; 58+ fps with 90 active enemies.

### Real bugs found by playing, not by reading
1. Bullets collided with the player's own structures — a walled base could
   not shoot out, which silently disabled turrets and broke the raid loop.
2. Threat decay ran before the raid check each frame, so the meter could
   never reach 100 and raids were unreachable.
3. Raids stalled permanently when one raider got wedged on terrain,
   blocking all progression. Added relocation + a hard time ceiling.
4. Death backpacks lost interact priority to a nearby workbench, making
   gear unrecoverable if you died at your own base.
5. `bagLoad` counted raw item counts while the capacity check used weight.
6. HUD was drawn in device pixels, halving text size on HiDPI displays.

### Design changes made in response to testing
- Trees are choppable for wood. Came directly from discovering turrets were
  firing into trees with no way for the player to clear a firing line.
- Enemy `structMul` split so walkers/runners threaten the player while
  brutes threaten walls — this is what makes raid 3 feel like a step change.
- Raiders target the *nearest* structure rather than the most valuable, so
  hordes break on the perimeter instead of beelining past it.
- Player given a two-tone ground ring and a brighter palette after the first
  playtest showed they were indistinguishable from zombies in a crowd.

### Deliberately not built
Hunger, thirst, temperature, sleep, farming, vehicles, NPCs, quests,
procedural world generation, large skill trees. Per the brief, breadth was
cut to keep every shipped system fully working.
