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
(filled in at the end)
