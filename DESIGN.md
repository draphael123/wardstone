# WARDSTONE — design log

## The question this slice was built to answer

Dungeon Defenders is a tower defence you stand inside. The interesting risk is
not technical — 120 pathing enemies is cheap once you copy DD's actual trick
(fixed lane polylines, blockades are *attacked* not routed around). The risk is
that the two halves don't need each other. Past a certain point the towers do
everything and the player is a spectator holding a repair hammer. DD itself
drifted there.

So the slice was scoped to prove or disprove exactly one thing:

> **Does the body have a job that the wards structurally cannot do?**

Everything else — art, audio, mobile, six waves — is in service of being able
to answer that honestly.

## What was measured, in order

### 1. The naive build: towers do everything

First playable balance, full ward set, player stood in a corner doing nothing
for the entire game: **won, losing only 320 of 3000 stone HP.** The premise was
broken and no amount of art would have hidden it. The suite caught this; a
screenshot never would have.

Root cause: nothing capped how much board the wards could cover. Wisps all
converge on one point (the stone), so a cluster of anti-air near the stone
answers *all* of the air threat. "You can't cover everything" simply wasn't true.

### 2. The fix was a mechanic, not a number

Adding **defence units** — a hard cap on total ward coverage, separate from mana
— is the mechanic real DD has and I had left out. It is what forces "which lane
do I abandon?" to be a real question.

With units in, the same idle-body test loses at wave 3 with 3000 damage taken
from wisps alone.

### 3. Then it was over-corrected

With the brazier still weak, wisps became **85% of all damage the stone took on
every seed**, and the ground game was decorative — the mirror image of the same
failure. Fix: the brazier had to be genuinely worth its 4 units (15 → 26 dps),
and the air had to thin slightly (43 → 33 wisps).

### 4. The budget was swept, not guessed

| units | idle build wins? | body wins /7 | median stone |
|---|---|---|---|
| 26 | no | 2/7 | 0 |
| 28 | no | 5/7 | 212 |
| 30 | no | 5/7 | 212 |
| **32** | **no** | **7/7** | **1556** |
| 34 | no | 7/7 | 1556 |
| 36 | **yes** | 7/7 | 2670 |
| 42 | yes | 7/7 | 2670 |

A clean window at 32–34 and a cliff at 36. Chose 32 for margin.

### 5. Where it landed

Full game, seed 7, bot playing both halves:

- **won at wave 6/6**, stone 1426/3000 — a real fight, not a walkover
- player did **53%** of damage to wisps+breakers, **30%** to husks+runners
- 16 wards destroyed, player died twice
- wards-alone and body-alone both lose on **7/7 seeds**

## Two bugs the suite found that play-testing would have hidden

**The bot was hoarding, not the game starving.** Early runs lost at wave 4 with
the economy dead — 7 motes banked out of 98 kills. The bot only walked toward
threats, never detoured for mana. That measured the bot, not the game. Fixing
the policy (collect opportunistically; sweep the field between waves, when motes
don't rot) took banked motes from 7 to 195 and the run flipped to a win. The
game-side change this justified is real though: **motes stop decaying during the
build phase**, which gives the build phase a second job instead of being a menu
you stand still in.

**A one-way shopping list is not a defence.** The bot ended wave 6 sitting on
1100 mana and free units with ten holes in its line, because its build list was
a monotonic pointer and it never rebuilt anything. Real players rebuild walls.

## Things deliberately not built

- **Co-op.** The cliff. Single-player only, and the encounters are tuned for
  one body — which is why the DU budget is as tight as it is.
- **Loot and gear.** DD's actual RPG hook (gear stats buff your towers) is a
  cross-product of build × gear × wave that needs its own harness. Not until
  the core loop is proven fun by a human.
- **Downloaded character models.** Everything is procedural geometry. 148 foes
  render in 0.44 ms across 33 draw calls; the whole game is under 4 MB.

## Next steps, in the order I would do them

### 1. Daniel plays it — before anything else
Every number here is defended by a bot with a hand-written policy. A bot cannot
tell me whether the *scramble* when six wisps arrive while a breaker is eating
the north wall feels thrilling or just noisy. That is the one thing left that
measurement cannot answer, and it gates everything below.

Specifically worth watching for:
- Does the courier job (walking over motes) feel like pressure or like chores?
- Is 40s of build time too long once you know the map?
- Does the wardstone dimming as it takes damage actually read, or does the HUD
  bar do all the work?

### 2. A second map, to prove the design generalises
One arena with three lanes is one data point. The real test of "wards hold
lanes, you hold the rest" is a map where the lanes are *asymmetric* — one long
approach and two short ones, so the DU budget forces a genuinely different
allocation. If the same 32 units work unchanged on a second map, the economy is
sound. If they don't, the budget is fitted to this arena and needs to scale off
lane count or total lane length.

### 3. Ward upgrades, not more ward types
Four behaviours already cover the whole DD tower set. What is missing is
*depth*: a ward you can pay to upgrade in place is a much better mana sink than
a fifth ward type, and it makes the DU budget bite harder (units stay fixed,
power goes up). This is the cheapest large increase in decision-making.

### 4. Then loot
Gear that buffs ward stats is DD's real hook and the reason to replay. It
should not be attempted until (2) confirms the economy generalises, and it needs
the harness extended to sweep build × gear so a dominant item can't hide.

### 5. Presentation debts
- The breaker needs a distinct approach cue — audio and a floor shadow — because
  right now it can arrive off-screen.
- A minimap. Three lanes 68 m apart and a chase camera means you cannot see the
  lane you are not on. This is the largest readability gap remaining.
- Foe HP bars, or at least a damage-state tint on the breaker.
