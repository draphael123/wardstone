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

---

# Measured against Dungeon Defenders' first level (The Deeper Well)

What DD1's opening map actually does, and where WARDSTONE stands against it.
Ordered by how much the gap costs us, not by how hard it is to close.

## What we already match or beat

| | DD1 Deeper Well | WARDSTONE |
|---|---|---|
| One objective, several fixed spawns | yes | yes (3 tracks) |
| Build phase / combat phase loop | yes | yes |
| Defence Unit budget | yes | yes, and **swept** — we know the cliff is at 36 on two maps |
| Blockades attacked, not routed around | yes | yes |
| Fliers that ignore blockades | wyverns | will-o-wisps |
| A heavy that out-damages repair | ogres | trolls |
| Upgrade towers in place with mana | yes (5 levels) | yes (3 levels) |
| Repair towers | yes | yes |
| Guided tutorial | a text popup | 10 checked steps |
| Weapon switching | no — one weapon + abilities | sword / crossbow |

## The five gaps that matter, in order

### 1. No overhead build camera — the biggest one
DD's "overlord" view lifts you to a top-down camera to place and upgrade
anywhere on the map without walking there. Ours is a 3rd-person camera plus a
build grid, which means repositioning a far lane costs a walk across the
clearing every time. This is the single largest quality-of-life gap and it is
entirely additive: a toggle that lifts the camera, freezes the player and lets
the pointer place at range.

### 2. Nothing to do during the muster except spend
DD scatters **breakable mana chests** around the map. That does three jobs at
once: it gives the build phase an activity, it teaches you the layout before
anything is chasing you, and it means starting mana is *earned* rather than
granted. Our muster is "place things, press R". Cheap to add and it makes the
map worth walking.

### 3. No bomber
Every foe we have walks up and hits something. DD's **kobolds** run at your
defences and explode, which is the one archetype that punishes stacking
everything into a single wall and forces you to kill things BEFORE contact.
It is the only genuinely missing *threat shape* in our set — and it is exactly
the kind of foe our own "design enemies to fill gaps" rule asks for, because
the defensive verb it demands (intercept early) is one nothing currently needs.

### 4. No difficulty selection
DD scales wave count and enemy stats across Easy/Medium/Hard/Insane. We ship
one curve. This is cheap — a multiplier on foe hp/count and a wave-count
change — and it is the standard answer to "too hard or too easy", which is
otherwise a coin flip per player.

### 5. No loot, and no reason to replay a cleared map
DD's hook is that gear buffs your TOWERS, so replaying a map you have beaten
still advances you. We deliberately deferred this and it remains the right
call until the core is proven fun by a human — but it is the reason DD1 has
legs and we currently do not.

## Smaller gaps worth noting

- **In-world spawn markers.** We show per-door counts on the minimap; DD shows
  the portal itself and you can see what is queued. A floating count over each
  track's gate would cost nothing.
- **Repair has no progress feedback** — no ring, no number, so holding E feels
  like nothing is happening until the ward visibly grows.
- **No between-wave summary.** What died, what it earned, what is coming.
- **Range preview on EXISTING wards**, not only while placing.
- **One objective.** Later DD maps have several crystals, which turns the DU
  budget from "which lane" into "which crystal", a genuinely different problem.

## What NOT to copy

- DD1's hero stat sheet (Hero Damage / Tower Damage / Ability Power / …) is a
  wall of numbers that mostly obscures the decision. If we do gear, it should
  move a handful of legible things.
- DD1's mana is both currency AND ammunition for abilities, which makes the
  economy hard to reason about. Ours does two jobs (build, mend) and that is
  already the ceiling.

---

# Second pass against The Deeper Well (after the autonomous sessions)

## Closed since the first comparison

| Gap | How |
|---|---|
| **Overhead build camera** | Tab. Blended, pannable, works mid-wave. Was ranked the single biggest gap; it is gone. |
| **Nothing to do in the muster** | Seven breakable caches scatter every muster, off-road and away from the fire. |
| **No bomber** | *still open — see below* |
| **No difficulty selection** | *still open* |
| **No loot** | *still deferred, deliberately* |
| Repair had no feedback | Ward health bars in their own colour while mending, plus a visible stream. |
| No in-world spawn markers | Count + foe-type pips + track name floating over each gate during muster. |
| No between-wave summary | What died, wards lost, fire remaining, what is coming next. |
| No range preview on existing wards | Stand next to one, or point at it in the build view. |

## Where we now go beyond DD1's first level

- **The balance is measured, not asserted.** 30 assertions, 11 fuzz invariants,
  a swept unit budget on two maps, and a test that proves the player's anti-air
  work is load-bearing by taking it away and showing the same bot lose.
- **A guided tutorial with real checks**, not a text popup.
- **Weapon switching, block, roll and an ability** — DD1's opening hero has one
  weapon and class towers.
- **A slow ward.** DD1's starting classes have no pure area-denial tower;
  caltrops give the set a fourth VERB rather than a fourth damage type.
- **Wards arrive with the problem they answer**, rather than all at once.

## Still missing, in order of what it costs

### 1. A bomber — the last missing threat SHAPE
Every foe we have walks up and hits something. DD's kobolds run at your
defences and explode. It is the only archetype that punishes stacking one
line and the only one that rewards killing BEFORE contact — a defensive verb
nothing in our set currently demands. This is the highest-value single addition
left, and it needs the suite re-run because it changes what walls are worth.

### 2. Difficulty levels
We ship one curve, tuned so a near-optimal bot wins 7–9 of 10 with the fire
around a fifth to a third remaining. A human's first run is a different game.
Cheap to add, and it is the standard answer to "too hard / too easy".

### 3. A reason to replay a cleared map
DD1's hook is gear that buffs your TOWERS, so replaying advances you. We have
upgrades within a run and nothing across runs. Still correctly deferred until
a human confirms the core is fun, but it is why DD1 has legs.

### 4. Things noticed only now that the rest exists
- **No pause, and no restart without reloading.** Esc opens settings mid-fight
  and the game keeps running underneath.
- **No volume control** — music and sound are on/off only.
- **No save or resume.** A six-wave run is ~10 minutes; losing it to a closed
  tab will sting.
- **Sell has no confirmation and no refund feedback** beyond the mana counter.
- **The tutorial only covers the glade.** The gauntlet has no introduction.
- **One objective.** Later DD maps have several crystals, which turns the unit
  budget from "which lane" into "which objective" — a genuinely different
  problem, and the natural shape for level 3 or 4.

## The honest headline

**Nobody has played this to the end.** Every number in the suite is defended by
a bot that plays near-optimally, never panics, and now upgrades. It cannot tell
us whether wave 6 is thrilling or exhausting, whether the caches are a nice
ritual or a chore, or whether the fire dimming as it dies actually lands. That
remains the only question measurement cannot answer, and it still gates
everything above.
