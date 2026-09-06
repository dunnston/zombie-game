# tasks/todo.md

## Current round — playtest response (pacing, inventory, survival)

Owner played for the first time. Could only fight; could not establish a base
or find crafting. Plan approved covering three PRs.

### PR 1 — Pacing  (done, PR #7)

- [x] `src/game/pressure.js` — quiet field, 256px cells, decay over ~4-5 min
- [x] Kills add quiet to their cell and neighbours
- [x] Player structures add standing quiet within ~400px
- [x] `updateSpawning` scales density by quiet and refuses quiet cells
- [x] Tier-1 density 5 -> 4
- [x] XP curve: 55 + 45*(L-1)^2.35
- [x] Persist the quiet field through save/load
- [x] Tests: unit (curve steepening), browser (suppression + decay)
- [x] Measured pacing check: time-to-level and longest quiet gap near base

### PR 2 — Slot inventory, equipment, hotbar  (done, PR #8)

Done. 30-slot pack grid, 6-slot hotbar, five equipment slots (head/body/hands/
legs/feet), 15 gear pieces across three tiers, drag and drop everywhere,
capacity by weight. Save -> v7.

- [x] Slot model behind the existing addRes/takeRes/countRes API
- [x] Five equipment slots, gear DR summed by recomputeStats
- [x] Hotbar decides what you are holding; keys 1-6
- [x] Drag to move, equip, unequip; right click to wear or shuttle
- [x] Weight bar counts pack + hotbar; packAllowance() is the one check
- [x] Save v7 round-trips slots, hotbar and worn gear
- [ ] Crafting folded in as a tab (owner never found it on C)

### PR 3 — Storage tiers, hunger and thirst  (not started)

Crate / Supply Stash / Steel Locker aggregating into one stash view.
Light hunger and thirst: soft debuffs, no health damage.

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
