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

---

# The bomber, and the fourth time the premise broke

## What the bomber is for

Every other foe walks up to a thing and hits it. The Powder Goblin runs at the
nearest **ward**, lights a fuse, and detonates — 520 damage in a 4.2 m circle.
It ignores the player almost entirely.

That makes it the only foe whose answer is *intercept before contact*, and the
only one that punishes the thing every tower-defence player naturally does:
pile everything into one strong point. Measured directly — one bomber into a
clustered line does **884** ward damage; the same bomber into a spread line
does **373**. Clustering is a 2.4× liability, which is exactly the intent.

One real bug found on the way in: a bomber that reached the fire did nothing,
because its contact damage is 0 and the blast only armed on ward contact. An
unopposed bomber was a *free* enemy. It now lights its fuse at the objective
too, for 260.

## Then the premise broke again — for the fourth time

`T21` (no ward build wins with nobody playing) failed on the gauntlet: the
"air-heavy" plan **won at wave 7**, leaking almost nothing.

Three fixes that did NOT work, each abandoned once measured:

| Attempt | Result |
|---|---|
| Overhead dead zone — an archer can't shoot straight up | no change; only excluded the innermost ring |
| Per-map air weighting on the gauntlet (×1.6 wisps) | air-heavy still won, and the *balanced* build fell to 0/10 |
| Much harsher aura stacking falloff, down to `[1, .18, .05, .01]` | air-heavy still won — so stacking was never the mechanism |

The diagnosis only arrived from reading the leak table properly: the winning
build had **8 watchtowers and no walls at all**, and its *husk* leak was 44.
It was never an anti-air build. A levelled, stacked aura sitting on the one
point every lane converges toward is a meat grinder for **everything**, and it
had quietly replaced the entire ground game.

**The fix: upgrades do not scale an aura, on the ground or in the air.**
Upgrades scale wards that pick a target. Area denial is bought with units, and
units are capped. One line in `sim.js`; all six idle plans now lose on both
maps, and the player's win rate did not move (8/10 and 9/10 before and after).

The lesson, which is the same one as the previous three times: when the premise
breaks, the cause is a way of *converting a resource into coverage* that the cap
does not see. It is never the number I reach for first.

---

# Difficulty, pause, volume — and a dial I refused to move

## Three tiers, two dials

Squire / Knight / Warden, picked on the title screen and remembered.

They move **foe hp** and **foe count**. They deliberately do NOT move the
defence-unit budget. DU is the premise dial: 32 is the swept value and 36 is the
measured cliff where a ward build wins with nobody playing. Letting a difficulty
setting touch it would mean an "easy" mode that quietly plays itself — which is
the exact failure this whole project was scoped to disprove. Every tier is 32.

## What the bot can and cannot tell us here

Sweeping the dials produced two results that look like bugs and are not:

| change from Knight | glade | gauntlet |
|---|---|---|
| baseline | 8/10 | 9/10 |
| DU 32 → 30 | **0/10** | 9/10 |
| foe hp +10% | **0/10** | 3/10 |
| foe count +10% | 8/10 | 5/10 |

Two units off the budget takes the glade from 8/10 to nothing. That is not the
game being fragile — the bot builds from a **fixed shopping list** sized for
exactly 32 units, so a smaller budget leaves it with a hole it never re-plans
around. Same for +10% hp: its kill-rate is tuned, and several fights tip past a
threshold at once. And more foes make the glade *easier*, because that bot is
mana-limited and extra kills are extra mana.

All three measure the pilot, not the game
([[sim-cannot-measure-a-strategy-the-bot-cannot-play]]). So the tier numbers are
stated as being **for humans, and not bot-tuned** — and only what survives the
pilot's rigidity is asserted:

- **T24** — no tier lets a ward build win unattended. 18 idle runs, 3 plans × 3
  tiers × 2 maps, all lost.
- **T25** — the tiers are ordered by how much fire survives:
  glade 1640 > 1324 > 0, gauntlet 1770 > 730 > 0.

Warden sits at hp ×1.04 / count ×1.20, where the bot still wins sometimes rather
than never — a bot that cannot re-plan is a floor, not a ceiling.

## A bug the browser found that the suite could not

The difficulty picker **did nothing**. The world is constructed during boot so
the clearing can render behind the title screen — which is before the player has
chosen anything — so the curve was always resolved as Knight. Verified in the
page: picking Warden left `world.diff.id === 'knight'`.

`World.setDifficulty()` now applies the choice when the fire is lit, and refuses
outright once time has passed, a wave has started, or anything has been built —
a run can never change curve underneath itself.

## Pause

Esc pauses; a second Esc resumes; the gear still opens settings, and opening
settings pauses too. Losing window focus pauses as well, which also sidesteps
a throttled background tab.

The sim stops being stepped while the renderer keeps running, so the world sits
there behind the overlay instead of being a frozen image. The fixed-timestep
accumulator is **cleared** on resume — otherwise the first frame back would try
to catch up on the entire pause. Verified in the page: 3 seconds paused advanced
the sim by 0.00s, and resuming ran 0.5s real → 0.5s sim with no burst.

## Volume

Music and sound get real 0–100 sliders rather than on/off. Music also *ducks*
rather than stopping while paused, so a pause reads as a held breath. The sound
slider plays a click as you drag it, because a volume control you cannot hear
while setting is a guess.

---

# Save and resume

A run is six waves and about ten minutes. Losing one to a closed tab was the
single cheapest thing left to fix.

**It only saves at the muster, and that restriction is the whole design.**
Between waves there are no foes in flight, no projectiles, no spawn queue and
no half-finished construction, so a save is just *which wave, what is standing,
and what have I got*. There is no mid-simulation state to reconstruct and get
subtly wrong. The most a crash can cost is the wave you were in.

Wards are stored as **ward id + cell + rotation + level + hit points**, not as
an object graph: `def` is a live reference into `WARDS` and `occupancy` holds
the same objects the array does, so a naive JSON round-trip would produce wards
the world could not see. Restoring replays them through `build()` — the same
path the game uses — so a restored ward cannot differ from a placed one.

Three assertions, because a save that silently drifts is worse than none:

- **T26** — a saved muster restores the *same run*. The whole ward set is
  compared (id, cell, rotation, level, hp), plus units, mana, fire, player
  health and occupancy — not just a count.
- **T27** — the restored world is *live*, not merely equal: the bot resumes it
  at wave 3 and plays it through to a finish.
- **T28** — no save mid-wave, and an unknown save version degrades to "start a
  new run" rather than to a broken world.

Verified in the browser too: the button names what it will restore ("The Glade ·
Warden · before wave 3 of 6 · 4 wards standing"), the run comes back with the
right wave, wards, units, mana and difficulty, the tutorial is correctly skipped
on a resume, and a finished run clears its save so you cannot resume into a game
that is already over.

---

# The clearing, and the front page

## Scenery

The brief was that level one looked empty. The fix is the same one that cured
flat facades: break the symmetry, and give the eye something at **three
distances** — silhouettes on the horizon, mass in the middle, detail at ankle
height where the chase camera actually lives.

Eight groups, each merged into one mesh, none of them ever on a lane or in a
buildable cell (a prop you cannot build behind is a bug dressed as a tree):

- **Distant hill bands** — three receding ridges beyond the treeline, which turn
  "a wall of trees" into "a wood with somewhere behind it"
- **Birches** — the wood was one species and read as wallpaper
- **Ferns, wildflowers, glowing mushroom rings, cairns, roots and mossy logs**
- **Fireflies** — 90 instanced, drifting on a sine and blinking by *scale*
  rather than opacity, because one shared material means fading one would fade
  all ninety

Two things measured rather than guessed. The hills were invisible on the first
attempt: they sat at 96–188 units with the fog far plane at 118, so they were
geometry the fog had already finished with — they now sit at 100–148 with the
forest fog reaching 168, which is what makes them read as *distance* instead of
as a flat grey band. And the mushrooms were three times too big on the first
pass and read as teal boxes floating in the grass.

Cost: **55 draw calls** for the whole scene.

## The front page

Modelled on what Dungeon Defenders' opening actually does, which is not a menu
over a background — it is a **camera in the world with a menu beside it**.

- The clearing is **live** behind the title: a slow orbit of the hearth, close
  in at ~17 units, because a wide shot of the clearing reads as empty grass and
  the fire has to be the biggest warm thing in frame.
- The camera is yawed off its look target so the fire and the knight sit in the
  half of the screen the menu column does not occupy.
- The **knight stands at the fire** while the menu is up. He is placed by the
  menu frame rather than by `update()`, which does not run before the fire is
  lit — without it the one character in the game was absent from its own title
  screen.
- The menu itself is a vertical stack of wide plates with subtitles, left
  aligned, over a left-weighted gradient scrim that clears to nothing on the
  right.
- The three rules moved out of the front page into a **How to play** panel, so
  the opening is a menu rather than an essay.
