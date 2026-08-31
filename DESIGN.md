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

---

# Juice, and the settings to turn it down

## What was added

**Shockwaves.** A flat expanding ring on the ground, pooled and reused. A
particle spray says "something broke"; a ring says "something *landed*". They
fire on a troll dying, a ward collapsing, a dodge push-off, a hit on the fire
scaled by how hard it was hit, and — stood up on its edge — on a sword connect,
so the hit reads across the target's body rather than as a puddle under it.

They do not depth-test, because behind a chase camera the contact point is
frequently behind the player's own torso, and a ring you cannot see is a ring
that did not happen ([[impact-fx-must-not-depth-test]]).

First pass was wrong in a way only looking could catch: the ring was 38% of its
own radius thick and read as a *donut*. A shockwave is an edge — 13% now, and
half the opacity.

**The sword's arc trail.** Frame data says where the blade *is*; the ribbon is
the record of where it has *been*, which is the part the eye reads as speed.

This shipped broken and the browser caught it. `pushTrail` added a point per
frame and `_stepTrail` popped one per frame, so the two cancelled and the ribbon
never grew past a single segment — the effect existed, ran, allocated nothing,
and was invisible. Measured at **0 points** during a live swing; **10** after
the tail was made to retire only once the swing is over.

**A low-health edge.** A pulsing red vignette from about a third health down.
Driven every frame rather than by an event, because it is a *state* — being
nearly dead — not a moment. It stays at the edges so the middle of the screen,
where the fighting is, stays readable.

## Settings, from seven to fourteen

Music, sound, music volume, sound volume, damage numbers, enemy health bars,
**screen shake (0–150%)**, **look sensitivity**, **field of view**, **minimap**,
**reduce flashes**, **pause when unfocused**, **show FPS**, low detail, guided
tutorial, camera distance.

Three notes on the ones that are not just toggles:

- **Screen shake became a dial.** The old on/off is now the two ends of the
  same control, and it lands in `addShake()` so no call site knows about it.
- **Field of view** is a preference the aspect rules *offset* rather than
  override — a portrait phone still gets a wider lens, it is just wider than
  whatever you chose instead of a fixed number.
- **Reduce flashes damps rather than deletes.** The flash carries information —
  you were hit, the fire was hit — so removing it outright would cost the player
  a signal rather than sparing them one. Measured: shake at 35%, flashes at 30%.

## A test hook the throttled pane forced

Verifying any of this in the embedded browser kept failing because
`requestAnimationFrame` is throttled to a few frames per second in a pane that
is not focused, and the tab's own auto-pause was firing on top of it — so every
per-frame feature measured as zero and one screenshot was a **stale composite**
of an overlay that was already `display:none`.

`WARDSTONE_CAP.tick(n, dt)` now drives whole frames explicitly — sim, overlays
and renderer — which is what made the trail bug visible at all
([[preview-panel-raf-blackscreen]], [[css-transition-stalls-when-unfocused]]).

---

# The ward panel, and dragging out a wall

## "I still don't see a way to upgrade or rotate"

Both existed from the first build. `F` upgraded the ward you were standing near
(or pointing at in build view); `R` rotated the thing you were holding. Neither
had any on-screen presence, both were context-dependent, and `F` was **also
bound to fire** — so pressing it with a ward selected shot the crossbow instead
of upgrading. A feature can be complete, tested, and effectively absent.

Clicking a built ward now opens a panel: name, level, health bar, units, reach,
and **Upgrade / Rotate / Sell** with live costs and a reason when upgrading is
refused. The keys still work. Nothing is only on a key any more.

`rotateWard()` is new and free at any time — a wall facing the wrong way is a
mistake you should be able to correct without paying to demolish and rebuild.

## Dragging a wall

Press and drag with a Palisade in hand and it lays a straight run in one
gesture, previewing exactly what will be built.

Two decisions worth recording:

**It is restricted to `kind: 'blockade'`.** Dragging out eight ballistae is not
a wall, it is an accident with your entire mana bar. Every other ward keeps
single placement, and `planRun` returns a single cell for them so there is only
one code path.

**The run stops at the first cell it cannot afford — it does not skip and carry
on.** A wall with a hole in it is worse than a shorter wall, and a silently
skipped cell is exactly the sort of thing you would not notice until something
walked through it. The preview draws the true plan, so what you see is what
appears. Capped at 12 cells per gesture, which is a guard against a stray drag
across the arena, not a balance number — the unit budget is what actually limits
walls.

## Two bugs the browser found, again

- **The panel could never hide.** The per-frame sync was guarded on
  `state.inspect` being truthy, so clearing the selection left the panel on
  screen permanently. It now always runs and hides itself.
- **`CAP.tick` did not drive `applyInput`**, so the build ghost and the wall-run
  preview — both of which live there — were never exercised by any test I could
  run in a throttled pane. Measured 0 preview markers; 12 after.

---

# "I can't hit the wisps" — it was not sometimes

## The bug

The player aims by pointing at a **ground cell**, so the aim vector fed to the
crossbow was `ay = 0` — permanently horizontal. Aim assist tested a `cos(12°)`
cone against that vector. A wisp flies at 4.2 m, so at 8 m it sits about 21°
above a flat aim, fails the cone, acquires nothing, and the bolt flies straight
underneath it at 1.2 m.

The blind spot **grew as the wisp got closer** — precisely backwards, because
close is when it is at your fire.

Measured across the ranges a wisp is actually fought at, using the flat aim the
game really produces:

| | 4 m | 6 m | 8 m | 10 m | 12 m | 16 m |
|---|---|---|---|---|---|---|
| acquired, before | no | no | no | no | no | no |
| acquired, after | yes | yes | yes | yes | yes | yes |

And a wisp at 6 m survived **18 bolts** before the fix, with every one passing
under it. After: down in one.

This mattered more than a normal bug. The premise is that the air is the
player's job — and the player could not do it.

## The fix

**Aim assist now runs in screen space**, because that is where a mouse aims.
`foeUnderPointer()` projects every foe and takes the nearest to the crosshair;
fliers get a 35% more generous radius, being small, moving in three axes, and
being the one thing only the player can answer. Once acquired, the shot is aimed
in three dimensions rather than flattened.

The world-space cone survives as a fallback for when there is no pointer at all,
with a separate `aimConeAir` of `cos(52°)`. Touch has no crosshair, so it is
handed the nearest flier outright — a thumbstick cannot elevate.

**T29/T30 lock it in**, and both were verified to FAIL against the old code
(0/6 ranges, wisp alive after 18 bolts) before being kept
— see [[verify-a-fix-against-the-old-code]].

The ward rule is untouched: the ballista still cannot reach the sky, the
Watchtower still barely can, and the unit budget is unchanged.

## Rally

It was a read-only cooldown chip, and the only way to use the knight's one
ability was a key nothing mentioned. It is now a button, it says what it does,
hovering it draws the ten metres it will reach — reusing the ward inspect ring,
because a player who has learned that a ring means "this is what it reaches"
should not have to learn a second visual language — and the tutorial has a step
that spawns three foes and asks you to use it.

---

# Goblins that actually swing

Reported twice: "they kind of just bob up and down", then "the goblins actually
need to swing their weapon to attack". The second report is the useful one,
because it says the previous fix missed.

## Why it was bobbing, exactly

Foes are **instanced**, so they cannot have separate limb meshes — the gait is a
vertex shader driven by one per-instance phase. That gait masks the arms by
HEIGHT:

```
armMask = smoothstep(0.55, 1.05, position.y) * step(0.32, abs(position.x))
```

A goblin carries its blade at about **y = 0.32**. The weapon was below the mask
entirely, so it never moved — the arms counter-swung, the body bobbed, and the
sword hung in the air like a prop. Adding more animation to the arms could never
have fixed it.

The mask is now a **side**, not a height: everything at `position.x > 0.32` is
the weapon side, which takes the arm and whatever it is holding together by
construction.

## The arc

There was also nothing to animate. The sim ran a windup and then applied damage
in a single frame — the blow itself had no duration at all. Foes now carry a
`strikeT` follow-through, and the sim publishes the whole thing as one number:

```
0.00 – 0.45   winding up      (the readable half)
0.45 – 1.00   the blow and its follow-through
```

Windup rocks the weapon **back** slowly, the strike drives it **forward** fast,
and the body leans in behind it. The asymmetry is the point: the slow half is
the half you get to react to.

The phase is published as `f.swingK` by the sim rather than recomputed in the
renderer, because `render.js` deliberately does not import `sim.js` and two
copies of a timing rule drift.

Measured: the arc runs 0 → 0.45 over 26 frames, → 0.98 over 16, back to 0 — and
the value was confirmed arriving in the instanced GPU buffer, not merely in the
sim.

---

# Three more goblins, chosen by the verb they demand

The rule this list is built on: **a new foe must demand a defensive verb that
nothing else demands.** Variety for its own sake makes a longer list, not a
harder game.

| | demands |
|---|---|
| Cutter | the baseline — walks up and hits the nearest thing |
| Runner | intercept early, before the clump arrives |
| Wisp | **your** crossbow. No ward really answers the sky |
| **Maul** | **do not defend with walls alone** — 3.4× damage to blockades only |
| **Slinger** | **go and kill it yourself** — it stops short and shoots |
| Powder | kill before contact, and do not cluster your line |
| **Bruiser** | **interrupt it, or be elsewhere** — a 0.95s windup and a huge blow |
| Breaker | a wall only buys time; you cannot out-mend it |

Verified each does its own job before any of them were tuned:

- **Maul**: 347 damage to a palisade vs **34** to a ballista over the same window
- **Slinger**: 182 damage to a wall it never came within **8 m** of
- **Bruiser**: a 0.93 s windup against the Cutter's 0.40 s

The slinger is the genuinely new *shape*. Everything else has to reach a thing
to hurt it, which is what makes a wall a wall. A slinger stops short and shoots
over it, so a blockade stops its movement and not its damage.

## What the balance pass actually found

Adding them dropped the game from 10/21 wins to 5/10 and broke three
assertions. Three findings, in the order they turned up:

**1. The slinger alone did almost all of it.** Isolated: bruiser-only 8/10,
maul-only 6/10, **slinger-only 3/10**. It never walks into reach and never dies
to a ward on the way in, so it fires at full uptime forever.

**2. Its stand-off range barely mattered; its damage was everything.** 11 m → 6.5 m
moved the glade 3/10 → 4/10. Damage 26 → 20 moved it 4/10 → 6/10. Shipped at
18 damage on a 2.1 s cadence.

**3. Reducing enemy volume made the glade WORSE** — 14/21 → 11 → 9 → 8 as filler
was cut. This is the same non-monotonic effect found while tuning difficulty
tiers: the bot is **mana-limited** on the glade, so removing foes removes income
and it plays worse. Volume is not a usable dial on that map.

Final: **glade 14/21 (67%), gauntlet 15/21 (71%)**, both inside the band.

## Two assertions re-based, and why that is not the same as loosening them

T13 asserted the hybrid wins **on one seed**; T22 used **five**. At a 67% win
rate a single-seed test is a coin flip, and finding (3) above shows this bot's
readings on the glade are noise-dominated at small samples. Both now run 21
seeds and require a clear majority — a **stricter** instrument for the same
claim, not a weaker one. The claim itself is unchanged and the shipped numbers
were not moved to make them pass.

## The placement rule the swing fix leaves behind

Every weapon must sit at `position.x > 0.32`, because that is the side the swing
shader rotates. A weapon anywhere else does not move when the goblin attacks.
That is now a rule for authoring foes rather than an accident of the first one.

---

# Attacking something makes it yours

Reported: "enemies should attack the player when attacked, not just move
forward." They already retaliated — but the leash was **7.5 m**, so a foe you
hit took two steps toward you and went back to the lane. The intent was there
and the number made it invisible.

The leash is now **14 m** with a 4 s pursuit, and — this is the part that was
missing — a foe that gives up **walks back to its lane** rather than standing
where it stopped, which would have quietly deleted it from the wave.

The leash is also measured from **where it left the lane**, not from the player.
Measuring from the player means backing away calls the foe off at exactly the
moment it should be committing to you.

## What the measurement can and cannot say

Chasing costs about **two wins in twenty-one, at any leash between 12 m and
22 m** — the length barely matters, the chasing does.

That number is an **upper bound**, and the reason is worth stating: the harness
bot only ever *suffers* this mechanic. It has no policy for baiting a breaker
off a wall, so it takes the whole downside and never once uses the upside. A
human who peels a heavy away from a lane and kills it on open ground is playing
a mechanic the measurement cannot see
([[sim-cannot-measure-a-strategy-the-bot-cannot-play]]).

So the leash was set at the point where the suite still holds — 14 m, nearly
double the old one — rather than at the point the bot happens to prefer.

---

# The jank pass, and the tool that found it

## A behaviour audit, separate from the fuzzer

The fuzzer asks "can a hostile player break the sim". `src/behaviour.js` asks a
different question: **does every foe, left alone, behave like a creature?**

Jank is usually not a crash. It is a goblin standing inside a wall, or sliding
two metres in one frame, or waiting politely beside a tower it is meant to be
hitting. None of that throws, none of it fails a balance test, and all of it
reads as unfinished. So each foe type is walked through a full minute of life on
a real map with real wards, and five invariants are checked **every step**:
below-ground, outside-arena, teleport, flier-altitude, and doing-nothing-at-all.

It also asks whether each type ever actually did its job — and what that means
depends on the foe. A bomber that never swings is correct; a bomber that never
lights a fuse is not.

`node run-behaviour.mjs` — currently **8/8 clean**.

## Two bugs it found immediately

**1. Everything stood inside the floor.** Foes, the player and the wards were
all drawn at `y = 0`, while the ground you can *see* is the sward at 0.16 and
the worn dirt of a track at 0.285. So every goblin was sunk 16–28 cm into the
terrain — and sank *further* the instant it stepped from grass onto a track,
because the ground changed height under it and the foe did not. That is both
halves of the report: "they fall through the terrain" and "they don't remain
consistent as they move".

Fixed with one shared `groundY(x, z)` in `arena.js`, imported by everything that
stands on the floor, so a foe, the player and a ward can never disagree about
where the floor is. It blends across the verge rather than stepping, because a
12 cm cliff at the edge of every track would stutter every time anything walked
onto one.

**2. Every ground foe teleported 1.0–1.4 m in a single frame.** On every lane,
within the first few seconds, on every type. The lateral offset was measured
against the *current segment's* normal, so the moment a foe's arclength crossed
a bend the perpendicular flipped and the foe snapped sideways by up to twice its
offset. The centreline was always continuous; only the normal was not.

The normal now turns across a **0.4 m** window at each bend — deliberately the
smallest value that removes the jump rather than the smoothest one, because this
shifts where foes actually walk and the gauntlet is sensitive to it: a 2.2 m
blend cost that map **14/21 → 8/21** over 21 seeds, since the bot's ward
placements are sized for the old lane shape. At 0.4 m the audit is clean and the
balance is the best of any value tried.

## Foes notice you, and hit what you build beside the path

Two reports: *"they don't always attack me, they should"* and *"I'd like them to
also hit structures that aren't technically on the path — if they're right next
to the path they should be able to."*

- **Notice radius (4.5 m).** A foe with nothing better to do takes an interest
  in the player well before contact. Standing *near* a lane is now dangerous,
  not just standing in one.
- **Adjacent reach (0.7 m).** A ward within arm's reach as a foe walks past gets
  swung at. Before this, a ballista placed one metre off a lane was untouchable
  by an entire wave walking beside it.

### The adjacency broke the premise on its first attempt

Assigning the adjacent ward to `blocked` — the variable that halts movement —
silently turned **every tower beside a lane into a blockade**. `T24` failed
immediately: an air-heavy ring around the fire won with nobody playing, because
the foes obligingly stopped to chew on the towers instead of walking to the
objective.

That is the same failure mode as the previous four premise breaks: **a way of
converting a resource into coverage that the unit cap cannot see.** Wards must
not gain a blocking function the budget does not price. A foe now swings as it
walks *past* — attack, no stop — and the movement code never sees it.

### And the economy had to move with it

Swept both dials against each other: at 6.5 m / 1.1 m they cost the gauntlet
five wins in twenty-one; at **4.5 m / 0.7 m** they are nearly free (12→12 and
16→15) while still doing the job.

But the session as a whole — bomber, three goblin types, the chase, notice,
adjacency — added demand on the player and pressure on the line without adding a
penny of income, and the bot had drifted from ~80% down to ~57%. The glade is
mana-limited, so **income is the honest lever there**. The wave-clear bonus goes
from `52 + 16i` to `72 + 24i`: **glade 13/21, gauntlet 16/21**, with roughly
triple the fire left standing.

---

# Controls you can see, and controls you can change

## Remapping

Every key the game reads now goes through a binding layer. Nothing compares a
raw key string any more, which is the only way remapping stays honest — one
`k === 'q'` left behind is a control the player cannot rebind and cannot work
out why.

Eighteen actions, listed in Settings, click-a-key-press-a-key. Notes on the
decisions:

- **Clashes are shown, not prevented.** Two actions on one key is sometimes
  exactly what someone wants, and silently refusing a bind is more confusing
  than marking it in red.
- **Escape is reserved**, because a player who binds over it has no way out of
  a menu.
- **Arrow keys always work** for movement regardless of binding: someone who
  rebinds WASD has not thereby asked for the arrows to stop.
- **Saved binds are merged over the defaults**, so a build that adds an action
  does not leave anyone who saved settings with an unbound control.
- Rebinding **captures the keyboard while armed**, so binding "W" to something
  does not also walk you forward while you set it.

Verified in the browser: rebind Swap from Q to G, and afterwards Q does nothing
while G swaps.

## Controls that existed only as keys

- **Block** was Shift and nothing on screen said so. It is now a chip beside
  Roll and Rally, it shows *"Block — sword only"* when the crossbow is out
  (which is why pressing it sometimes did nothing), and it is held like the key.
- **Mend** joins the ward panel. Held rather than clicked, because mending is a
  continuous spend and a single click that quietly drained mana would be worse
  than no button at all.
- **Every chip now carries its own key** — `Roll Space`, `Rally V` — so a rebind
  shows up where the control is rather than only in a settings list nobody
  reopens.

---

# Jump, and letting the sword reach the sky

Asked for explicitly, and chosen over the safer option knowing it hands melee an
answer to the air — which is the one thing the whole design says only the
crossbow does. So the rule that keeps it honest is **geometry**:

- The apex is not a feel number. It is derived: a wisp flies at **4.2 m**, the
  blade tops out about **2.5 m** above the player's feet, so the jump has to
  clear ~1.9 m and no more. `v = sqrt(2gh)` gives 8.7 m/s at g = 18, and the
  measured arc is **2.03 m over 0.95 s**.
- **From the ground the sword still cannot touch a flier.** What jumping buys is
  a *window*, not a capability.
- **No double jump**, because the point of the apex is that it is a window you
  have to time.

`T31` asserts both halves: from the ground it misses, at apex it hits.

## What is measured, and what is not

The **premise is unaffected** and still asserted: wards alone lose, and a player
who ignores the sky still loses (`T14`). The air remains the *body's* job — this
only changes which weapon the body can do it with.

The **difficulty effect is unmeasured**, and I would rather say so than imply
otherwise: the harness bot does not jump, so every balance number in the suite
reflects a player who never uses this. That is the same blind spot as the chase
mechanic — the bot suffers what it cannot exploit
([[sim-cannot-measure-a-strategy-the-bot-cannot-play]]).

## A bug the browser found

The jump was invisible. Two places *assigned* `player.position.y` — the walk bob
and the roll — so whichever ran last overwrote the height set from `p.y`.
Measured: sim apex 2.03 m, mesh apex **0.00 m**. Everything vertical is additive
over one base now: mesh apex 2.19 m (2.03 of jump over 0.16 of sward).

---

# Reading the fight

## Health and mana, in the Dark Souls arrangement

Stacked horizontal slabs at the top-left, health above mana, each with a hard
border and a bevelled inner edge so they read as carved rather than as web
progress bars.

The **ghost bar** is the part that matters: a pale bar that hangs at your
previous health for about 400 ms after a hit and then drains to meet the red
one. You see *how much you just lost*, not only what you have left. It snaps
upward instantly on a heal, so it can never read as a second health bar.

The mana bar is below it, narrower, and mana is now a visible resource rather
than a number in the corner — it buys building today and has somewhere to grow.

### A bug in my own first version

The ghost was driven by a `setTimeout` re-armed inside `syncHud`. `syncHud` runs
every frame, and the condition that armed it — health below the ghost — is true
on *every* frame after a hit. So it cleared and re-armed itself forever and
**could never fire**: the ghost would have hung at full health permanently.
Replaced with a timestamp, which has no such failure mode. Verified: hp 0.55 /
ghost 1.00 immediately after a hit, still held at 200 ms, both 0.55 by 900 ms.

`CAP.tick` also had to start calling `syncHud`, or nothing on the HUD advanced
under the test hook at all.

## Knowing what you will hit

Aim assist snapped to a target silently and the player could not tell which.
There is now a **bracket marker on the foe itself**, drawn in world space and
billboarded to the camera, shown whenever the crossbow is out — not only while
firing, so aiming is deliberate rather than discovered after the shot.

## Being hit

Taking damage was a red tint and nothing else. It now also stops time for a
beat, kicks the camera, and throws a ring off the player. The most important hit
in the game to notice is the one you take.

---

# The bug hunt, and a thing I had to back out of

## World-level invariants over a whole run

The behaviour audit now also plays **three full six-wave games with the real
bot** and checks seven world invariants every step: ward health in range, units
within budget, mana sane, the occupancy map agreeing with the ward list, the
player on the floor and inside the arena, projectiles bounded, and no crowd
collapsing onto a point. This is where the compounding, hard-to-reproduce jank
lives — 20,000 steps a run, roughly 60,000 checks per seed.

## Wisps arrived as one object

The audit found six wisps inside a 0.25 m circle at the fire. They converge on a
single point by design, so a flock landed on top of itself — and it is also why
their additive glows summed into a white smear.

Fixed by spreading them **vertically**, not horizontally. Auras key on
*horizontal* distance, so height separates a flock to the eye while changing
nothing about which towers can reach it. That distinction was not academic:
pushing them apart sideways put more wisps inside more watchtower auras and
**broke the premise test outright** on the gauntlet.

## Ground separation: measured, and backed out

Giving walking foes the same treatment looked obviously right and was not. It is
a **balance dial, not a visual fix** — how tightly a wave bunches decides how
much of it a ward's area covers at once:

| attempt | glade | gauntlet |
|---|---|---|
| none (baseline) | 13/21 | 16/21 |
| separation 0.85 | walkover, 19/21 | 10/21 |
| separation 0.3 | 15/21 | 14/21 |
| engaged foes hold instead | 8/21 | 3/21 |

And letting it act on a crowd already pressed against the fire **shoved them off
the objective**, which alone was enough for an air-heavy ring to win with nobody
playing.

Meanwhile every pileup the audit ever found was a wisp.

So it was backed out, and the visual problem moved to where it belongs: the
**renderer** fans a packed bucket of foes around a small circle, deterministically
by id, where it cannot affect a single hit point. The sim keeps its exact
positions and a crowd is still allowed to press.

The audit's pileup check was rescoped to **free-moving** foes — which is a
statement about what a defect is, not a way of passing. Six runners converging
on one palisade genuinely arrive at one place; free-moving foes collapsing onto
a point means their movement is broken.

## Grounding the bodies

Two changes, both aimed at the same complaint — that foes were hard to pick out
and did not look like they were standing on anything.

**Contact shadows.** A hard little pool directly under every body. Real shadow
maps are on, but at this camera they are soft and easy to lose against dark
grass; a blob reads instantly and the whole field costs one draw call. Fliers
get one too, shrinking and fading with altitude, which is most of what tells you
a wisp is *above* the ground rather than on it. The player's shrinks as they
jump.

They are placed from the same fanned-out positions the bodies use, or a shadow
would sit where the foe is not.

**Goblins moved off the grass, in hue.** Skin was `0x7d9c46` against grass at
`0x4e6b38` and turf at `0x5f7d40` — the same yellow-green family, which is why
they vanished into the ground at chase distance. The whole line is warmer and
brighter now, so separation comes from colour as well as shadow.

Cost: 69 draw calls for the full scene with a wave on the field.

---

# Measuring the two mechanics the bot could not play

Both the chase and the jump were shipped with the same caveat: the harness bot
suffered them and never used them, so every balance number described a player
who owned neither. The fix is not more caveats — it is teaching the bot to play
them, and then reading the number.

## Bait

Taught, measured, and the **first policy was wrong**. Walking 7 m past a heavy
to drag it off a wall measured *worse than not baiting at all* (gauntlet 18/21 →
15/21, median fire 302 → 194): the walk abandoned repair and anti-air duty for
its whole duration.

But no walk is needed. **Hitting the thing already angers it, and an angry foe
comes to you** — so simply refusing to close is enough to peel it, and costs no
position. With that policy: glade median fire 544 → 614, gauntlet 302 → 380, win
rate unchanged. A mild, real positive.

## Jump — the honest answer is "decorative, and now slightly less so"

Measured on the shipped build: **0 jumps taken in a whole game, 0 wisps killed
by sword, and a wisp was inside sword range 2 % of the time.** The mechanic was
asked for, works exactly as specified (`T31`), and never happened. The premise
risk I flagged when it was chosen never materialised — for the worst possible
reason.

The cause is structural: wisps hover at 4.2 m *over the fire* and the whole game
teaches you to answer them at range.

So wisps now **dive to 3.4 m to strike the fire** rather than hovering over it.
It reads as an attack instead of a hover, and it is what creates the window.
Balance-neutral for wards, because auras key on horizontal distance and the
ballista has no anti-air at all.

`airReach` also had to tighten from 1.2 m to 0.5 m: at 1.2 the ground ceiling was
3.7 m, which made a diving wisp hittable **while standing still** and sent the
jump straight back to being decorative.

Result, measured over three full games: **1–2 jumps per game, and the sword takes
about 15 % of the player's wisp kills** (3–5 against 19–26 by bolt).

That is the honest size of it. It is a skill-expression flourish for a wisp
diving on your fire, not an answer to the air — and the crossbow remains the
answer, which is why the premise still holds.

## T25 was measuring noise against zero

It compared **median** fire remaining over **10** seeds. Warden loses most runs
on both maps, so its median is 0 and the comparison degenerated. Re-based on
**win rate over 21 seeds**, which does not saturate: glade 21 > 16 > 2, gauntlet
20 > 14 > 7. Same claim, an instrument that can actually see it.

---

# Training as its own mode

The tutorial was a toggle on starting a new game, which meant it was something
you either caught on your first run or never saw again. It is now **its own menu
entry** — a thing you choose to do, and can come back to, on the first map.

It also **shows** rather than only telling. Each step names a control, and that
control gets a pulsing ring: the Palisade button for "wall a track", the Ballista
for "put something behind it", the weapon chip for the swap, the Roll and Rally
chips for their steps. Telling someone to "press 1 for a Palisade" is not the
same as showing them which thing on screen that is.

Steps that name a control with no on-screen equivalent — movement — point at
nothing rather than at something arbitrary.

## Three bugs found wiring it up

- **`CAP.tick` did not drive `tickTutorial`**, so the tutorial never advanced
  under the test hook and appeared frozen at step 2. Third time this hook has
  been missing something a real frame does; it now drives input, sim, events,
  tutorial and HUD.
- **`offsetParent` is null for `position: fixed` elements**, so the visibility
  guard silently dropped the pointer on half the HUD. Uses `getClientRects()`.
- **`syncHud` assigned `className` wholesale** on the weapon chip every frame,
  which deleted the pointer ring the instant it was added. It now touches only
  the classes it owns.

---

# Two rendering bugs with the same shape

Both were things that looked wrong and had no effect on the simulation at all —
and both came from rotating something about the wrong origin.

**Foes did not face what they were hitting.** Facing was derived purely from the
movement delta: `atan2(f.x - f.px, f.z - f.pz)`. A foe that STOPS to attack has
no delta, so `atan2(0, 0)` returned 0 and it snapped to facing north — chopping
at empty air beside the fire it was supposedly attacking — while sub-pixel
jitter made a stationary foe's facing spin at random. Reported as *"moving
weirdly and not actually attacking the fire properly"*, which is exactly what it
was doing.

A foe now faces its target if it has one, its heading if it is moving, and holds
its last facing otherwise — and turns toward it rather than snapping. Verified
over 40 foes engaged with the fire: worst facing error 0.00000 rad.

**The knight's cape was rotating about his feet.** Its parts sit at chest height
but the mesh's origin was the model root, so every lean swung the whole cloth
out behind him like a detached plank. Reported as *"what is this thing behind
the knight?"* — it was his cape, three feet away from him. It now pivots at the
shoulders.

---

# The ballista rebuild, and what the measurements refused to allow

Two requests: cut the ward set to Palisade + Ballista, and put the ballista at
about 20% of its power with upgrades taking it back to current. Both were built
and measured. **Neither survived contact with the numbers, and the reason is the
same in both cases.**

## Cutting to two wards does not hold — at any ballista strength

With Palisade + Ballista only, at the current wave table:

| configuration | glade | gauntlet |
|---|---|---|
| ballista at 20% base | 0/21 | 0/21 |
| ballista at 20%, **pierce 10** | 0/21 | 0/21 |
| ballista at 20%, **48 defence units** | 0/21 | 0/21 |
| ballista at 20%, **10% of the air** | 0/21 | 1/21 |
| ballista at **100% base** (the old gun) with pierce | 2/21 | 12/21 |
| ballista at 64 dps — *60% stronger than the old one* | 4/21 | 0/21 |

Cutting air did not help: the leak simply moved to the ground and the total
stayed at ~3000. The Watchtower's aura was doing far more work than its four
units suggested — it is the only thing in the set that damages a **crowd**, and
a hundred foes a wave is a crowd problem, not an elite one.

Two wards only becomes playable at roughly **a third of the current wave volume**
(115 foes instead of 316: glade 9/21, gauntlet 12/21) — which is a smaller game,
not the same game with fewer buttons.

## Pierce was still the right idea

It is kept, and it is what makes three wards enough where four were needed.
A ballista's area is a **line**: laid along a lane it cuts a whole file, laid
across one it hits a single goblin. Where you point it is the decision.

Measured at matched volume, pierce is worth roughly **+50%**: 9/21 and 12/21
with it against 6/21 and 5/21 without.

It also exposed a flaw in the *instrument*: the bot placed every ballista 3.5–7 m
**beside** a lane, so pierce never triggered. Guns now go on the lane axis.

## Where it landed

**Three wards — Palisade, Ballista, Watchtower.** Caltrops parked. And the
ballista rebuilt as a curve rather than a flat number:

| | damage | cadence | reach | pierce | single-target |
|---|---|---|---|---|---|
| L1 | 61 | 3.40 s | 20 m | 3 | 18 dps |
| L2 | 85 | 2.99 s | 25 m | 4 | 28 dps |
| L3 | 118 | 2.63 s | 30 m | 5 | 45 dps |
| *old* | *96* | *2.40 s* | *30 m* | *1* | *40 dps* |

The intent behind "20%" is honoured — the first ballista is **under half** the
old gun and reaches two thirds as far, so it is no longer an instant answer and
upgrading is a real decision. 20% itself was measured and does not hold: it is
2/21 even with three wards. **45% is the lowest base that lands in band**, and
it does: glade 16/21, gauntlet 17/21.

## T3 was measuring the wrong thing

It asserted the flier-capable ward had the lowest dps. That stopped meaning
anything once the ballista became a curve whose base is deliberately below
everything — and raw dps never compared an aura to a piercing gun anyway. It now
asserts the claim underneath: **the ward that reaches the sky pays for it**, with
the shortest reach of any damage ward and only 55% of its damage landing upward.

---

# Clipping, and hits that do something

## Ground foes had no collision at all

`_separate()` began with `if (!f.def.flying) continue;`. Bodies walked straight
through one another — a Bruiser is 0.8 m across and a Breaker 1.15 m. Reported
as *"they clip a ton"*, and they did.

It had been tried before and backed out as a **balance dial**: at full strength
the glade became a walkover and the gauntlet fell 16/21 → 10/21, and a crowd
pressed against the fire got shoved *off* the objective, which let an air-heavy
ring win unattended.

The mistake was the push, not the idea. A free push moves a foe **along** its
lane, or **away** from what it is attacking — and those two quantities are what
the balance is made of. So the push is now projected off whichever axis carries
that information:

- **walking a lane** → pushed only *across* it. Lane progress is untouched, so
  arrival timing is bit-for-bit unchanged.
- **attacking a ward** → pushed only *perpendicular to the line to its target*,
  so a crowd spreads around it at constant range.
- **on the objective** → not separated at all. Letting the scrum at the fire
  fan out is exactly what handed the game to the air-heavy ring, and a crowd on
  the fire *should* look like a scrum.

At `SEPARATION = 1.0` — full body radii, no overlap where there is room to avoid
it — overlapping pairs fall from **10.8% to 5.3%** and the deepest overlap from
99% of combined radii (effectively coincident) to 77%. Glade 19/21, gauntlet
14/21, premise intact. It is no longer a balance dial.

## A hit now changes what a foe is doing

Being hit was a 0.1 s flash and nothing else — grepping the whole sim for
knock/stagger/recoil returned one match, and that was Rally. So you could hit a
goblin mid-swing and it would finish the swing anyway. That is what "combat
feels soft" actually was.

Light foes now **stagger**: the windup is cut, they reel back, and they cannot
move or attack for a third of a second.

Gated three ways, because unrestricted hitstun would make mashing beat blocking
and delete the defensive half of the game
([[hyperarmour-stops-mashing]]):

- **Heavies have poise.** A Breaker hit for 200 keeps swinging — verified. You
  dodge a Bruiser, you do not out-damage it.
- **A graze does not stagger** — 12 damage minimum.
- **Per-foe cooldown of 1.15 s**, so a crowd cannot be chain-locked.
- **Only the player staggers.** A ward that staggered would hold a lane for free.

Knockback is deliberately small at 0.2 m: swept over 21 seeds, a 0.55 m shove
costs real ground because the foe has to walk back in and the player follows it.

The reel is visible — the body pitches back and compresses for the duration —
and a stagger gets a ring, sparks and a beat of hitstop, because it is the
moment the player finds out their swing did something.

---

# The knight's sword, rebuilt

All four halves of it were wrong at once: too slow to start, no weight in the
blow, no way to tell it connected, and only ever one move. So it is not a number
change — the sword stopped being a cooldown and became a small state machine.

```
startup -> active -> recover
```

Damage lands once, on entering `active`. A cooldown has no timing to speak of:
it gates *when you may swing* and says nothing about what the swing is doing.

## The moveset

| | startup | damage | arc | notes |
|---|---|---|---|---|
| light 1 | **0.07 s** | 31 | 1.7 | quick diagonal chop |
| light 2 | 0.09 s | 36 | 2.0 | backhand — the return cut |
| light 3 | 0.15 s | 65 | 2.6 | wide finisher, real step into it |
| heavy | 0.34 s charge + 0.22 s | 96 | 2.3 | **the only thing that breaks poise** |

The first link's 0.07 s startup is the entire "too slow to start" complaint. Each
link comes from a different guard and travels a different way — an overhead, a
backhand, a two-handed sweep — because a chain played from one animation reads
as a stutter rather than a combination.

The heavy is what finally gives the **Bruiser and the Breaker an answer other
than running away**: verified, a charged blow strips a Breaker's poise and
staggers it mid-windup, where every light attack bounces off.

Sustained chain damage is pinned at the old single swing's **99 dps against
100** on purpose. The rework is about feel, and letting it also be a damage buff
would have made every balance number in the suite unreadable.

## Attacks commit you

Movement is locked through startup and active, and free again during recovery.
That is what makes a heavy weapon read as *heavy* rather than as *laggy* — the
price of a swing is your feet, not your reaction time, and getting them back is
part of the animation instead of unexplained paralysis. The roll is the way out.

Each link lunges, and the lunge routes through `movePlayer` so a committed step
still collides with walls and wards.

## Blocking costs mana

There is no stamina bar in this game by choice, and inventing a guard meter
would be stamina wearing a hat. Blocking drains **22 mana a second** from the
same purse you build with, and the shield drops on its own when it runs dry.

Turtling now has a price that needs no new UI: hold the shield up all fight and
you cannot afford the wall that would have done the job for you.

## A bug that would have shipped

`meleeInput()` reads `this._dt` to advance the charge timer, and can be called
before the first `step()`. An undefined dt turned `holdT` into **NaN**, after
which the heavy attack could never fire again — for the rest of the run. Caught
because the directed test reported `holdT NaN` rather than a wrong number.

---

# Energy, and scenery you cannot walk through

## Energy

A second resource, separate from mana, and the split is the point. **Mana is
what you build with** and is a flow you collect off the field. **Energy is what
you fight with**: it refills on its own, quickly, and pays for the committed
things — a charged heavy (34), a shield bash (30), holding a guard up (16/s).

Light attacks are free, so there is always something to do when it is empty.

The two halves of the game stop competing for one pool: running your guard down
should cost you the next bash, not the wall you were saving for. Blocking moved
off mana onto energy for exactly that reason — the mana drain was a stopgap from
when there was deliberately no stamina.

Spending stalls the regen for 0.55 s, so it reads as a rhythm rather than a tap
you hold open. A heavy attempted without the energy for it **falls through to a
light swing** rather than doing nothing, because a held button that produces
silence is indistinguishable from a broken one.

The **charge meter overlays the energy bar** instead of being a fourth bar: it
fills across exactly the slice of energy the swing will cost, so one shape shows
both how charged you are and what it will take.

## Shield Bash replaces Rally

Rally was a panic button — a wide stun on a 24 s timer you saved for a bad
moment and otherwise forgot about. An ability should be used *in* a fight, so
the bash is short, frontal, cheap and frequent: 6.5 s, 3.2 m, shoves 2.6 m,
interrupts the swing, sword only.

It deliberately does **not** break poise. That belongs to the charged heavy, and
two things doing the same job would make the heavy pointless.

## Solid scenery

Trees and boulders were pure decoration living in the renderer, so you walked
through them and the clearing read as a painted backdrop.

The collider positions are generated in `arena.js` and the renderer **draws that
same list** — so what looks solid is solid, exactly, rather than collision you
cannot see or scenery you can walk through. Nothing is placed on a lane, in a
buildable cell, or within 12 m of the fire: a prop narrowing a lane would change
the balance, and one on a build square would be a cell you could never use.

The list is built on **first use**, not at module load or in `setMap()` — the
lanes it needs may not be laid at load time, and `setMap()` is never called at
all by the browser build. That combination left the colliders empty in the game
while every headless test saw them populated.

---

# Four things that were making combat feel bad

Diagnosed rather than guessed, and two of them were outright omissions.

## 1. The sword had no target snapping

The crossbow got screen-space aim assist and the sword never did — it aimed at
the **ground cell under the pointer**. So you swung at a patch of dirt near a
goblin, and a 1.7-radian arc missed.

The swing now snaps its facing, on the frame it commits, to the best target
inside its own reach — scored on how close it is to the direction you asked for,
and then on distance. Measured forgiveness: **a hit at 0°, 20°, 40° and 60° off
target, a miss at 80° and 100°.** It corrects your aim; it does not steer for you,
and nothing behind you is ever a target.

## 2. Dying was nine sparks

A goblin blinked out mid-animation. Only the Breaker had a real death.

Bodies now stay on the field for 0.75 s and **fall** — pitched forward, sinking,
fading out by scale. Everything in the sim already skips the dead, so a corpse is
inert; it just has not been swept up yet.

This broke a fuzz invariant that said *"a dead foe is never left in the live
list"*, which was true when corpses were deleted instantly. Restated to the rule
that still matters: **a corpse is on a timer and cannot leak** — anything dead
with no timer left was never swept up. Same defect caught, correct behaviour
allowed.

## 3. You could not see what you swept

A one-shot ground wedge now draws at the **actual arc and range of the link that
fired**. It teaches the weapon without a tutorial: you can see that the finisher
is far wider than the opener, and that a heavy reaches further than either.

## 4. Blocking was a flat damage tax

You chose hold-to-block over parry, so this does not add a parry input. Raising
the guard within **0.22 s** of a blow landing is a **perfect guard**: no damage
at all, the energy comes back, and everything close enough to have hit you is
staggered.

Measured: blocked at 0 and 8 frames → **0 damage**, attacker staggered 0.32 s.
Blocked at 30 frames → 4.4 damage and no stagger, exactly as before.

The skill is in *when* you press block, not in a separate move, and it obeys
poise like everything else — a Bruiser is deflected but not rocked, so you still
have to move.

---

# No air, two wards, and a new premise

The two requests that could not both be satisfied — "get rid of the flying
enemies" and "just the two starting towers" — turn out to be the *same* request,
and doing them together is what made either possible.

Cutting to two wards was measured as impossible before: **0/21 on both maps**,
at every ballista strength up to 60% stronger than the original, at pierce 10,
at 48 defence units, at 10% of the air. The reason was always the air. With no
anti-air ward and fifty-one wisps, no allocation could cover the objective and
the lanes at once. **Remove the wisps and the reason two wards failed goes with
them.**

## But removing the air removed the premise

Wards immediately won unattended with the fire untouched — 3000 stone, every
plan, both maps. The wisp was not just a threat, it was *the thing wards
structurally could not do*, and the design rested on it.

## The Wall Goblin

The wisp's job, brought down to the ground.

It does not use the road. It comes over the rim from a random bearing, straight
for the fire, so it **never meets the palisade you built or the gun behind it** —
every ward you own is placed against a lane, and this thing has no lane. Wards
also do only **15%** damage to it, which is the deliberate mirror of the old
wisp's `airMul`: without that it merely converges on the fire like everything
else, and a gun parked at the fire covers the convergence.

Verified directly: a Wall Goblin walks past a **fully sealed** lane to the fire.

`T14` now asserts the premise on it — a bot forbidden from chasing them **loses
at wave 3 with 3000 damage from Wall Goblins**, while the same bot that fights
them wins.

## What the rebalance cost, and what it taught

Getting here took a long sequence of measurements, and three findings are worth
keeping:

- **The bot needed to be taught to intercept them.** Without a policy — priority
  above even a Giant Goblin, and meeting them 10 m out rather than chasing to the
  rim — it lost while its own guns sat idle. Teaching it moved the same
  configuration from 1/21 to 21/21.
- **Difficulty tiers must not thin the premise foe, but must not freeze it
  either.** Holding Wall Goblins fixed made *Squire harder than Knight* (dying at
  wave 3.9 against 6.6); letting them scale fully let an idle ring survive the
  gauntlet **by 48 hit points out of 3000**. The rule that satisfies both: a tier
  may send more of them, never fewer — and an easier tier is made easier by
  **income**, which works precisely because the idle arm runs rich and cannot
  benefit from it.
- **An easier tier was measurably a poorer one.** Fewer foes means fewer kills
  means less mana. Bounty is now scaled by `1 / count`, so total income holds
  across tiers.

## T25 is asserted on one map, and that is an instrument limit

Squire > Knight is checked on the glade only. On the gauntlet the bot **cannot**
convert an easier tier into a better outcome, because it builds from a fixed
shopping list — demonstrated three ways: raising the unit budget 32 → 44 changed
nothing, and tripling Squire's income changed nothing. Asserting it there would
measure the pilot. `T25b` checks the tier *configuration* instead, which no bot
can confuse.

## Final shape

**Wards:** Palisade, Ballista.
**Foes:** Cutter, Runner, Maul, Slinger, **Wall Goblin**, Powder Goblin, Bruiser,
**Giant Goblin** (formerly Breaker).
**30/30 assertions, 11/11 behaviour audit, fuzz clean, glade 7/10, gauntlet 6/10.**

---

# Wander, choke points, and where the player's work actually is

## Foes stopped marching in files

A lane foe held one lateral offset for its entire life, so a wave came down the
track in rigid parallel columns. Each one now drifts slowly across its own lane
on its own sine — a rabble following a road rather than a column marching down a
line.

It changes the lateral offset **only**. Lane progress is untouched, so arrival
timing is identical and the balance did not move by a single point: 7/10 and
6/10 before and after, same medians.

## The scenery became choke points

Boulders and trunks are now solid to **Wall Goblins**. This is what turns
decoration into terrain: a Wall Goblin walks a straight line to the fire, so a
rock in that line funnels it, and the gaps between rocks become the places worth
standing. Lane foes are unaffected, because no prop is ever placed on a lane.

It cost about three wins in twenty-one — they arrive from less predictable
bearings, which makes interception harder — and that was paid for with a small
reduction in their number rather than by removing the terrain.

## T15 was measuring the wrong foe

It asserted the player did a real share of **Breaker** damage, from when the
heavy was the thing the body had to help with. That is no longer true and it is
deliberate: the ballista was rebuilt as the anti-elite ward, so wards carrying
the Giant Goblin is the design working, not the premise slipping.

Measured share, seed 7:

| foe | player | wards | player share |
|---|---|---|---|
| **Wall Goblin** | 5101 | 351 | **94%** |
| Cutter | 3028 | 10172 | 23% |
| Giant Goblin | 1254 | 5946 | 17% |
| Bruiser | 0 | 1700 | **0%** |

T15 now asserts the player carries the foe the premise rests on — 94%, against a
70% floor — and reports the Giant Goblin share alongside it so the contrast is
visible rather than hidden.

**The Bruiser at 0% is a known instrument gap, not a design one.** It has poise,
so light attacks cannot stagger it, and the charged heavy exists precisely to
answer that — but the harness bot never charges a heavy. A human has a tool here
that the measurement cannot see.

---

# Verticality

The clearing was dead flat, so it read as a floor with things standing on it.
Two separate pieces fix that, and neither can touch the balance.

## The safety argument comes from the import graph, not from a re-run

`sim.js` does not import `groundY`. The simulation's world is flat — only the
RENDERER lifts things onto the ground. So the shape of the clearing cannot move
the balance **by construction**. That is a much stronger claim than "we re-ran
the harness and it looked the same", and it is why this could be a large visual
change with no tuning attached.

Two further invariants are asserted directly against the terrain function:

| | measured |
|---|---|
| worst ground lift under any **lane** point | **0.0000 m** |
| worst rim lift anywhere the **player** can walk | **0.0000 m** |
| worst slope across a **build cell** | 0.245 m (4.9°) |

## 1. Swells — the ground you fight on

Twenty-two broad, low banks in the open ground, generated clear of every lane.
Wide and shallow on purpose: 9–15 m across and 30–62 cm tall, so a swell rises
about 8 cm over the 2 m of a build cell and a ward stands **on** one rather than
tilting off it. 36% of the floor has relief.

**They take the max, not the sum.** Summing the overlaps stacked them into 2.8 m
spikes with cliff faces cutting across build cells — 334 cells over 20 cm.
Taking the highest bank makes two that meet read as one longer ridge, which is
both safe (36 cells over 20 cm, none over 25 cm) and the better shape.

## 2. The rim — the horizon

Ground beyond the arena climbs away into the treeline, so the wood stands on a
rising bank rather than on the same plane you do: a bowl with a lip instead of a
floor with a fence. 7 m of lift by the far treeline.

**Measured on the square metric, not the radius.** The arena is a square, and a
*radial* rim reaches 4.2 m under the corner build cells while leaving the edge
cells alone — exactly backwards. On `max(|x|,|z|)` it starts at 36.5, half a
metre outside the player's own bound, and touches nothing playable at all.

## What had to be lifted with it

Everything drawn at a fixed height was suddenly wrong. The ground mesh is
displaced (0.5 m resolution), and trees, birches, tufts, ferns, flowers,
mushrooms, cairns, roots, logs and fireflies all read the bank height at their
own position.

Three that were easy to miss, because they only break where a bank happens to
be: **mana motes** hovered at a fixed 0.6 m and so sat *inside* a 62 cm bank;
**mana caches** sat at world zero and sank; and worst, the **build grid** was a
flat overlay at 0.34 m, so the cell you were aiming at simply stopped being
drawn on any bank tall enough to swallow it.

Draping the grid over the contour turned out to be the best thing in the pass —
it is now the clearest read of the terrain in the game, better than the grass.

The lane strips needed no change at all, which is the design checking itself: no
bank is ever generated within 3 m of a lane, so `moundY` under every one of the
289 sampled lane points is exactly zero.

---

# "They come at me but don't actually hit me"

A movement bug wearing an attack bug's clothes, which is why it read as *weird
behaviour* rather than as something broken: the windups were real and the
animation played every time.

## The limit cycle

Aggro was refreshed only while the player was **out of reach**:

```js
if (!hitPlayer && dPlayer < NOTICE_RADIUS) f.aggroT = ...
```

So the instant a foe came into reach it stopped being aggroed. `chasing` went
false, and it fell through to the lane branch — which does `f.x = q.x;
f.z = q.z`, snapping it back onto the polyline just outside reach. There its
aggro refreshed, it closed again, and the whole thing repeated.

A single-foe trace shows it oscillating between **2.36 and 2.47 m against a
2.45 m reach**, forever.

| | before | after |
|---|---|---|
| windups aimed at a rooted player, 150 s | 348 | 164 |
| blows that landed | **15** | **163** |
| wasted windups | **96%** | **1%** |
| closest approach | 2.35 m | 1.56 m |

## Two fixes, and they are separate

**Refresh aggro in reach as well.** This is the actual bug — the `!hitPlayer`
guard was the whole limit cycle.

**Plant a foe that is at contact.** Falling through to the lane branch while
next to the player is wrong even with aggro fixed, because that branch teleports
the foe back onto its polyline. A foe at contact now stands and swings.

Reach and contact are deliberately **different numbers**: `hitPlayer` at
`radius + 1.3` is how far it can swing, `planted` at `radius + 0.45` is how
close it insists on getting first. Setting them equal — which was the first
attempt — reintroduced the stand-off, because a foe satisfied "can strike" and
stopped closing on the same frame. Measured: 95% wasted again.

Only a windup aimed at the *player* plants. A foe winding up at a ward is
already held by the blocked branch, and catching it here instead skipped the
line that keeps `f.target` pointed at the wall.

## What it cost

The player is now a **body blockade** — a planted foe stops advancing — which is
a real new power and a genuine difficulty drop. T19 moved from 6/10 to 9/10, top
of the 5–9 band, with the median fire left standing rising 828 → 1200.

The three-way test is untouched: wards alone still lose at wave 1, body alone
still loses at wave 3, both still win 19/21.

## T29 / T30

Asserted as a **conversion rate**, not a damage total, because the rate is what
was wrong — a total could be restored by making foes hit harder while the
swinging-at-air stayed exactly as it was.

Both were checked against the old code first: **584 windups, 0 blows.**

---

# Chokepoints, and a chokepoint that was a trap

Three requests: better level design, better chokepoints, the ballista in wave
one. The middle one turned out to be the interesting one.

## Lanes now pinch

`widths` is one entry **per point** and interpolates along the lane, so a track
narrows and opens instead of being a corridor of constant bore. That is the
whole of it: a 2.8m throat is sealed by three palisades where a 7m stretch needs
six, so *where* you wall a lane is a decision with a price attached.

| lane | throat | wall there | widest | wall there |
|---|---|---|---|---|
| The Stair | 2.8m at 8m | **3 units** | 7.0m at 29m | 6 units |
| The Undercroft | 2.9m at 8m | **4 units** | 7.2m at 28m | 6 units |
| The Sluice | 2.8m at 4m | **3 units** | 7.5m at 27m | 5 units |

The three differ in the *kind* of throat, not its depth: north is one tight gate
that opens right out, east is a long narrow neck, west is a corridor from the
doorstep.

## A V is not a chokepoint

The first attempt saved **one unit out of five**. A palisade fills a 2m cell, so
sealing samples the width across `d±1.2` — and on a V-shaped pinch that picks up
the widening shoulders. The throat measured 3.4m and the wall still had to be
built for 4.6m.

The fix is **collinear points**: extra points on each lane's first segment that
change no geometry at all and exist purely so the width profile can hold a
throat *flat* for a few metres.

## The expensive finding: a deep chokepoint is a trap

The first design put the throats deep — 27 to 29m along. The bot found them,
walled them for two units instead of six, and the glade went from **19/21 to
0/21**.

The pinches were never the problem. The *same* pinches, with the wall left at
the door, still won 19/21. Walling the throat scored 0/21.

**A wall is worth nothing on its own. It is worth what your guns kill while the
queue is stopped at it.** A throat 29m in sits outside a 20m gun's reach, so the
wall stalls the wave somewhere the battery cannot shoot. Anchoring the guns to
the wall was not enough either — it only got the glade to 1/21, because a queue
stalled far from the fire is also a queue that spent the whole approach spread
out and moving instead of bunched and stationary in a kill zone.

So a chokepoint has to be **somewhere you would want to fight anyway**. Then it
makes the natural play cheaper, instead of luring you somewhere your defence
cannot follow. Every throat now sits in the near half of its lane (deepest:
22%), and T32 asserts it.

## The ballista from wave one

It was held to wave 2 from when it was strong enough to trivialise the opening.
At a fifth of that power it is no longer a gift, and gating the only gun in the
game meant the first fight had exactly one verb in it. Measured neutral.

## Two instrument failures, both mine

**The sweep script was lying.** It cache-busted its imports with `?v=`, which
gave it a different `arena` module instance than `sim.js` held — so `setMap()`
had no effect on the world being simulated and every "gauntlet" number was
really the glade, measured twice. Three rounds of conclusions were drawn off it
before a baseline run against a known-good commit caught it. **Always baseline a
new instrument against a known answer before trusting it.**

**The wander was never implemented.** Commit `2b36f1b` added `WANDER_RATE` and
`WANDER_AMT` and never used them. It shipped as two dead constants, and the
reason it could be reported as "the balance did not move by a single point" is
that the feature did nothing. It is now real — and the first working version
deleted the two lines that move a lane foe in world space, so foes advanced
their lane distance while standing at the door, attacking the fire from 40m away
where nothing could reach them.

## T7 broke for a good reason

It parked a wall and a breaker at lane offset -1. The Stair is 2.8m wide at its
throat now, so the pinch squeeze clamps a breaker's offset to about 0.45 — it
walked past a wall a metre off-axis, and the test reported the wall's hp going
*up*. Both are on the centreline now. The squeeze was right; the test's
hard-coded offset was what the pinch invalidated.

---

# Solid scenery, a back rank, and a foe you cannot simply hit

## The trees were never solid, and could never have been

Reported as "we need collision with objects like trees". The player and the
wards had always collided with `solidProps()` — but **the list was empty inside
the arena**. Every candidate was thrown out by a guard refusing any buildable
cell, and buildable cells cover nearly all of it. Measured: **49 colliders, 0 of
them in the clearing.** And the trees you could actually see were scattered
separately by the renderer with a different seed, so they were never the same
objects in the first place.

Props may now take build cells, and `isBuildableCell()` refuses those squares. A
tree standing on ground you cannot wall is the honest version: the scenery takes
ground away from your defence as well as from your feet, which is what makes it
terrain instead of decoration.

They are **clustered**, not scattered — a copse is a landmark you can navigate
by and fight around, where twenty evenly-spread trunks are noise with collision
turned on. 30 colliders in the clearing, 216 build cells taken. Cost 3 wins.

## Goblin Archer — the back rank

The Slinger existed and nobody ever noticed it, because its range was **7m**.
That is barely past sword reach, so it walked to the wall with everything else
and read as a melee goblin that happened to throw something. At 12m it stops
behind the line and shoots over it, and backs away when you close.

Its arrows hurt **you** far more than what you built (8 vs 11). An archer that
melts palisades from 12m is not a back rank, it is a siege engine that happens
to walk, and it deletes the defence from somewhere the defence cannot answer.

## Shield Goblin — and why the shield is melee-only

Its shield eats 70% of a melee blow through a 92-degree front arc, and it faces
the way it walks, so that arc points exactly where a defender stands. Two
answers, both already in the player's hands: **flank it**, or **charge a heavy**,
which goes through a shield the same way it goes through poise.

Shielding *bolts* as well was the first version and it was wrong. It made the
Shield Goblin a **tower** problem rather than a **player** problem — a ballista
shooting one head-on did 30% damage, so the defence quietly stopped working, and
the answer was not something a ward could ever perform. Paying for that by
thinning the waves broke the premise instead: a ward build started winning
unattended on Squire. A ballista's bolt punches through a shield. Your sword
does not.

## Paying for two new enemy types

Adding two types to every wave should add variety, not difficulty. The roster
alone took the glade from 17/21 to 9/21; waves 3-6 at 92% of their counts, plus
a Squire tier thickened from 0.70/0.72 to 0.85/0.88 so the easiest tier still
needs a player, brought it to **13/21 with both new foes fully present** and all
34 assertions green.

## Three instrument failures in one session

1. **The sweep used the wrong seeds.** T22 measures on a fixed Fibonacci-and-
   primes list; my sweep used 1..21. It disagreed with the authoritative test by
   about four wins *every time*, and I tuned against it three separate times
   before noticing. It now uses T22's exact seeds and matches it to the win.
2. **I taught the bot to hunt archers, and it got worse.** Ranking a shooter at
   2200 put it above everything but Wall Goblins and Giants, so the bot
   abandoned the line to chase three or four archers a wave: 17/21 down to 9/21.
   It did not even reduce its deaths. Removed, with the measurement recorded.
3. **The bot's deaths were never the problem.** 2.5 a run with the new roster
   against **3.1 at baseline** — it dies constantly either way and wins anyway.
   The runs were being lost at the fire, not at the player.

---

# The Hall

The home room, in the manner of Dungeon Defenders' tavern. Everything a menu
could have done is a **place you stand** instead: you choose the watch at a
stone, you look at your wards on a rack, you learn the moveset on a pell, and a
run begins by walking through a gate.

## It is in the same scene, 400m away

Not a scene of its own. The hall is a group at `z = 400`, far past the fog, so
neither room is ever visible from the other — and the player rig, the camera,
the controls, the sword, the energy bar and the whole HUD are the *same objects
doing the same job* in both places. A second scene would have meant a second
copy of all of it, and the renderer has no teardown path to swap between two.

This is also why the pell works: you hit it with the real sword, running the
real melee state machine, so it reports the real numbers — **31 / 36 / 65** for
the light chain, and the finisher lands hardest.

The bounded rim from the verticality pass is what makes the address usable: past
120m the ground is flat again, so the hall does not sit 7m up the arena's
earthworks.

## Four things that all had the same shape

Every one of these was something pinned to the arena that had never had a reason
to be anything else:

1. **The camera target is clamped to `ARENA.half - 2.5`.** So it stayed at
   z=35.5 while the player stood at z=412, and the first view of your own home
   was the far side of the treeline, 400m away.
2. **The clamp, once moved to the hall, was too tight.** Pinned to the room's
   interior it sat 1.5m behind the player at the door, which points an 8m-high
   chase camera almost straight down at his own head. The walls are 4.2m and
   there is no roof, so the camera is allowed *outside* them and looks in over
   the top.
3. **A high chase camera and a ceiling cannot both exist.** Roof beams at 5.3m
   put solid timber between the lens and the floor from every angle. The room is
   read from above like a doll's house — which is also how all four stations are
   visible at once.
4. **The near wall is the fourth wall.** At full height it drew a solid black
   band across the bottom third of the screen. It is a 1.2m balustrade instead.

## Two smaller ones

The lane doors kept drawing "THE STAIR" and "THE UNDERCROFT" over an empty room
400m from the lanes they label. And the knight arrived holding the **crossbow**,
so the first thing anyone did was shoot the pell and conclude the post was
broken — `enterHall()` puts the sword in your hand now.

## What it costs the balance

Nothing, and that is checkable rather than measured: the hall runs `_stepHall`,
which ticks the player's own timers and the pell, and touches no foe, no ward
and no wave clock. 34/34, 12/12, fuzz clean, glade 13/21 and gauntlet 17/21 —
identical to before it existed.

---

# Terraces — the raised ground you fight ON

The earlier verticality pass was swells and a rim: relief you could see and
nothing could stand on. This is the thing that was actually asked for. A terrace
is a rectangle of ground about a metre up, and the only way onto it is a **ramp**.

**Up is gated, down is free.** That asymmetry is the whole mechanic:

- you can hold the top of a stair against a crowd, because they arrive in single
  file instead of surrounding you
- you can be flanked, because every terrace has more than one way up
- retreating *upward* costs you the walk to a ramp; retreating *downward* is
  instant and always available — to you and to whatever is chasing you

## Placement was measured, not chosen

The first draft hand-placed three 13×12m terraces and one of them sat on a lane.
A clearance search over every square metre of each pad **and its ramp aprons**,
against each lane's own local width, showed that nothing bigger than **9×8**
fits beside a road on this map. Two of the three sit right beside a lane, close
enough to shoot down onto it; the third is behind the fire where the off-lane
Wall Goblins converge.

Asserted, on both maps: **highest raised ground under any lane point or verge =
0.0000m.** If that ever moves, the wave's route has changed and every balance
number swept before it is void.

## Sliding is what makes them funnel

When a straight move is refused it is retried on each axis alone, so a body
**slides along the foot of a terrace** instead of standing against it. Because it
keeps pressing toward its goal, sliding walks it round to a ramp. A Wall Goblin
walking blind for the fire routes around a terrace and arrives — measured over
40 seconds, **0 frames fully stuck**.

## High ground has to be worth taking for your wards too

A ward on a terrace gets **+22% range**. Without it the raised ground is somewhere
*you* stand and nothing more, and a player who never walks up there is not making
a decision, they are ignoring scenery. Range only — not damage, not rate —
because height should decide what a gun can *see*, which is what height means.

46 build cells sit on terraces.

## Two things that cost real time

**Terraces belong to a MAP, exactly as lanes do.** They were module-level at
first and applied to every map, so the glade's three landed wherever they fell on
the gauntlet — on its lanes, as it turned out, quietly rerouting that map's waves
and taking it from 17/21 to 10/21.

**Terrain should change how a fight is fought, not how hard it is.** Rerouting
every off-lane foe and changing where the body can stand cost one win, so waves
3-6 came down to 94%. Final: 36/36 assertions, glade 16/21, gauntlet 20/21,
T19 6/10.

---

# Braziers, and the brand you carry to them

Three separate complaints — nothing to interact with, nothing changes during a
run, and not enough for the player to DO — turned out to be one feature.

## You cannot light one with mana

You take a **brand** from the hearthfire, carry it out, and touch it to the
basket. One hand is full while you do, so **no shield and no crossbow** — that
is the price, and it is why walking fire across the field mid-wave is a decision
rather than an errand. The brand burns for 22 seconds and lights exactly one
brazier.

This makes the premise safe **by construction rather than by tuning**: an idle
ward build can never light one, because lighting is gated on where the player's
body is, not on a resource. Asserted with 999999 mana and the player 42m away —
six braziers, all cold.

## It is also the thing that changes during a run

Wave one is dark. By wave four the part of the clearing you *chose* to light is
lit, and every basket gutters out again after 34 seconds unless you keep going
back. The last four seconds of a burn visibly die down, so "it is about to go
out" is something you see rather than something you have to remember.

A lit brazier burns whatever stands in it — 26 dps in a 6.8m radius, credited to
the **player**, because a brazier is something a body walked out and lit and the
damage-share tests have to see it that way.

## The bug that cost the most, again

Placing the braziers drew from `this.rng`, which shifted **every later draw in
the run** — spawn jitter, cache placement, attack cooldowns — and the glade fell
from 16/21 to 13/21 on a feature the harness bot cannot even use. Given its own
stream the numbers returned to exactly 16/21 and 20/21.

**Anything added to world setup must bring its own generator or it silently
re-rolls the entire simulation.** This is the third time this class of thing has
cost an hour: a measurement that moved for a reason that was not the change.

`this.seed` did not exist either — only `this.rng` and `this.propRng` — so the
first version put every brazier in the same place on every seed.

## Sparks where the blade lands

The impact pass was already most of the way there — hitstop scaled by light /
finisher / heavy, shake, a shockwave and a flash on a heavy, swing fans at the
real arc and reach. One thing was wrong at the root: the spark burst fired at
the SWING, which is the player's own feet.

A hit now emits a `cleave` per body the blade passed through, at the contact
point between the two, and a kill adds a darker second burst. A cleave through
three goblins reads as three impacts instead of one louder one, and a blow reads
as landing **on** something rather than as an animation happening near it.

---

# Four bugs from one playtest

## Ctrl was closing the tab

"Holding control seems to stop the game." Block was bound to **Control** and
forward is **W** — so holding block and walking forward is `Ctrl+W`, which
closes the browser tab. `Ctrl+R` was rotate/ready (reload), `Ctrl+S` was
move-back (save page), and `Ctrl+1`–`4` were the ward keys (switch tabs).

**A modifier cannot be a game key on the web.** Block moved to `c`, keydown now
ignores any chord carrying ctrl/meta/alt, the rebinder refuses modifiers
outright, and stored settings from before this build have their modifier binds
dropped on load — otherwise the fix would never reach anyone who had already
played.

## The pell was not a foe

"Targeting the dummies feels off." It was a hardcoded position test, so **none**
of the aim snapping, hit flash, stagger, damage numbers or contact sparks
applied to it — hitting it was a coordinate check wearing an animation.

It is a real foe now with an `inert` flag: it never moves, never attacks, never
dies, never belongs to a wave. Everything else in the combat code treats it
exactly like a goblin, because it is one.

**And the sword swept an empty index.** The melee sweep and the aim snap both go
through the spatial hash, which only `step()` ever filled — so in the hall
nothing was in it and the pells could not be hit at all. The complaint was not
about targeting; it was that there was nothing there to target.

## The roll did nothing in the hall

`_stepHall` decremented the dodge timer and never moved the body, so a roll
played its animation on the spot. A practice room where a move behaves
differently from the field is worse than no practice room, because what you
learn in it is wrong.

## The bash had no pose

It was still wearing Rally's presentation: an omnidirectional ring burst, with
the knight standing perfectly still inside it. A bash is a body throwing a
shield at something — the shield arm cocks and drives forward, the shoulder
turns through, the sword arm trails, the whole man leans in. The effect is a
directional wedge at the ability's real arc and reach, and the toast says
*Shield bash* rather than *Rally*.

## And one thing that was my instrument, not the game

`requestAnimationFrame` does not fire at all in the automation pane, so several
"the sim is frozen" readings I took were the harness, not the code. Drive the
world by hand (`world.step`) when measuring in there.

---

# The hall as a hub: gates, a muster, and getting the grey out

## The grey background was the outdoors

The hall borrowed the arena's dusk sky and its 168m blue fog, so above the low
walls sat a flat grey-blue void. Inside, the sky is now a warm near-black and
the fog closes to 34m — the room ends in **darkness a lamp has not reached**
rather than in a colour. The far wall goes up with lit windows in it (the camera
looks that way from above, so height there costs nothing), and there are hanging
lanterns down the aisle, a rug marking the route from door to gates, a keeper
behind a counter, and crates and barrels.

## A gate per road

One portal that silently meant "whatever was selected" is a menu wearing an
arch. There are two now, side by side, in different colours with their own
plaques — and walking to one **is** the choice.

**They reload.** The renderer builds its lane strips, scenery, solid props and
terraces ONCE from whichever map was current at boot, so calling `setMap()`
mid-session gave the Gauntlet's simulation with the Glade's geometry drawn over
it: right minimap, right lanes underneath, wrong everything you could see. The
renderer has no teardown path, and a reload is a smaller and more honest thing
than half of one. The muster is handed forward in `sessionStorage`.

## The muster board

A slate by the door: the road, the watch, and a party of four — you, and three
slots that say **co-op soon**. It is a queue with one player in it, which is not
a placeholder for multiplayer but the shape multiplayer needs. When local and
online arrive they fill slots two to four and nothing else changes.

The note on the board says so plainly rather than implying a matchmaker exists.

## The fuzzer earned its keep

`HIGH_GROUND is not defined` — a later edit replaced the block from
`HALL_SOLIDS` up to `WANDER_RATE` and took that declaration with it. It only
throws when a ward actually stands on a terrace, so all 38 assertions passed and
only the chaos actors, which build in places no sensible plan would, ever hit
it. See [[regex-edits-reach-the-next-function]].

---

# Why combat did not feel good: two measurements

## You were rooted half the time you were swinging

The light chain rooted the player for **0.65s of the 1.33s** it takes to throw
— 49% — in a game where a mob converges from three lanes at once. Committing
your feet is right for a wind-up you chose; it is just stickiness on a 0.07s
jab.

A light now leaves you **34% of your speed**. A heavy still roots you
completely, because that is what buys it its damage and its poise break.

It costs the harness three wins on the glade (16/21 → 13/21), and the sweep is
monotonic with a clean control at zero — the bot walks *toward* its target while
swinging, so extra freedom carries it deeper into the mob. A human uses the same
freedom to step out. All 38 assertions still pass.

## Two thirds of your hits looked like misses

Only **36% of connecting blows produced any visible reaction**. The real stagger
is gated to once per 1.15s per foe, so a three-hit chain landing inside a second
moved the target once; the other two changed its colour for a tenth of a second
and did nothing else.

Every hit now **flinches** the body — rocked back along its own facing, pitched,
and squashed slightly. It is renderer-only, driven off the `hitT` the sim
already sets on any discrete hit, so it cannot touch a hit point: a feel fix
with no balance risk at all.

**36% → 100%.**

# The crossbow had one note

34 damage every 0.55s, forever. Swapping to it was a downgrade in *feel* even
where it was the right tool.

It now has the same grammar as the sword — tap for the quick one, hold for the
committed one:

| | damage | notes |
|---|---|---|
| tap | 34 | as before |
| **braced** (hold 0.42s) | **82** | pierces 2, knocks the first body back 1.4m, 34 energy |

Priced in energy at exactly the sword heavy's cost, so choosing between them
stays a question of range rather than economy. It is the only ranged thing in
the game that moves a body, which is most of why it reads as heavier.

One input path drives both weapons now, so the player learns one rule instead of
two.

---

# The Kit — loot, and why it has a ward slot

A run left nothing behind, so the hall was a well-dressed lobby. This is the
thing every hub feature in Dungeon Defenders is downstream of: the forge, the
shop, the item boxes and the pet all exist because you own things.

## Four slots, and the fourth is load-bearing

| slot | governs |
|---|---|
| Blade | sword damage / reach / recovery |
| Guard | health / block / bash |
| Cloak | speed / energy regen / roll cooldown |
| **Sigil** | **ward range / rate / health** |

Loot that only fed the body would tip a game whose whole claim is that neither
half wins alone. **"Body alone LOSES" is an assertion, and a knight in full gear
is exactly the case most likely to break it.** The sigil slot means gearing up
feeds both halves, so getting stronger moves the hybrid along instead of tilting
it.

An item is one affix at one tier, so it reads in a line — *Keen Blade III, +18%
sword damage* — and the sim reads it in one place: a `mods` object computed when
the kit changes and never walked again during a frame.

## The premise is asserted AT FULL KIT

Every premise assertion in the suite is made by a naked knight, so three new
ones repeat the three-way test at the ceiling — best affix, tier III, all four
slots:

- **T37** a knight in full kit still cannot hold the tracks alone — lost at wave 3
- **T38** nor does a full-kit ward build win with nobody driving it — 0/3 plans
- **T39** and gear is not a downgrade — 7/11 naked vs 7/11 geared

T39 is deliberately a `>=` guard rather than a claim that gear wins runs: +18%
damage does not flip many, and the bot cannot exploit speed or recovery the way
a player does. It exists to catch a sign error, not to prove a feeling.

The ceiling is small on purpose: about +18% on the body and +14% on the wards.
This is a reason to come home, not a second progression system bolted onto a
balance that took a fortnight to find.

## Drops are events, not a stream

Elites only — a Giant Goblin or a Bruiser, at 34% — plus one guaranteed for
clearing any wave from the third on, so a run that ends badly still leaves you
holding more than it started with. Common goblins never drop, or the rare one
stops meaning anything.

Tier odds shift with the wave, so wave six differs from wave one in what it
hands you and not only in what it sends.

Loot rolls on **their own random stream**, for the reason the braziers taught:
sharing the world's `rng` re-rolls every later draw in the run.

## The chest survives the browser closing

Because the whole point of loot is that a run leaves something behind. The
armoury is the old ward rack — you walk up to it, and what you carry is a place
in the room rather than a menu the room went away for.

## And a correction: the wave tally already existed

I built a second one — panel, CSS, the lot — before noticing `#tally` was
already in the page and already better than mine: it names the foe types slain,
shows the fire percentage, wards lost, the bounty, and previews the next wave.
The duplicate `id` meant `getElementById` kept returning the original, which is
the only reason it surfaced at all.

Reverted. The per-wave ledger in the sim earns its place by carrying the one
thing the old tally could not have known about — **what the wave dropped** —
which is now a line in the real tally.

The lesson is the boring one: grep the DOM for the id before building the
feature. "The game has no wave summary" was in my own analysis of what we were
missing against Dungeon Defenders, and it was simply wrong.

---

# The tutorial was teaching a game that no longer exists

The first thing a new player touches, and it was wrong in three separate ways.

## It made three false claims in one paragraph

> "Press **V** to **Rally**. It staggers and shoves back everything within ten
> metres and makes your nearby wards fire faster for a few seconds."

The ability is a **Shield Bash**: 3.2m, a 97° frontal arc, and it does nothing
to wards at all. Every clause of that sentence was false. It now describes what
the ability actually does, including that it costs energy.

## It hardcoded keys the player can rebind

`Press 1`, `Press Q`, `Press Space`, `Press V`, `Hold E`, `press R`. A player
who rebinds anything was taught the wrong key by the one part of the game whose
whole job is to teach — and one of those defaults had already changed underneath
it when block moved off Ctrl.

Step text is written with tokens now — `{roll}`, `{block}`, `{ward1}` — and
substituted at render time with the player's own binding through the same
`keyLabel` the HUD uses. Space renders as "Space" rather than a gap.

## It never mentioned half the game

No block. No energy. No light chain. No heavy. Two steps added, placed where the
dependency order puts them — right after you draw the sword, before you learn to
roll and bash:

- **The sword is a chain** — three swings, the third lands hardest, hold for a
  heavy that is the only thing going through a raised shield
- **Your shield, and what it costs** — block drains the green bar, which the
  heavy and the bash also spend, and running it dry drops the shield

Thirteen steps, in the order the ideas depend on each other.

**The tell was in my own writing.** I had listed "no wave summary" as a gap
against Dungeon Defenders while the game already had one, and I had been editing
combat for days without once opening the file that explains combat to a new
player. Features drift; the thing that teaches them drifts silently.

---

# The camera could not look up or down

The thing I suspected was the real feel problem, and it was there in the code:
the wheel drove `camDist` while `camHeight` was pinned to `2.2 + dist * 0.48`.
So zooming from 7m to 26m moved the pitch between **29 and 38 degrees**, and
there was no way to raise or lower your eye at all. In a game where three lanes
converge on you, that is the difference between fighting a crowd and being
surprised by one.

## It is an orbit now

`camPitch` and `camOrbit` are the authored values; `camDist` and `camHeight` are
derived from them in one place so they can never disagree. Right-drag turns
**and** tilts; the wheel changes distance only, where it used to silently
overwrite the height.

| | pitch | camera |
|---|---|---|
| lowest | 14° | 12.9m back, 3.2m up |
| default | 34° | 11.0m back, 7.5m up — the old view, unchanged |
| highest | 72° | 4.1m back, 12.6m up |

The floor is 14° rather than 0 because at true eye level the knight's own body
fills the screen. The ceiling is 72° rather than 90 because a plan view kills
every silhouette in the game — and the overhead *build* camera already exists,
deliberately tilted, for anyone who wants the board.

**Look-ahead fades with pitch.** Aiming 4m past the player is right for a low
camera and shoves him off the bottom of the frame from a high one, so it scales
to zero as the camera climbs.

Pitch and orbit persist between sessions, and there is an invert-Y toggle,
because a camera you cannot set the way your hands expect is worse than one you
cannot move.

## Known, and left alone for now

At the low end, foreground trees fill the frame — **there is no occluder fade**,
so a trunk between the camera and the knight simply hides him. The player can
raise the camera to solve it, which is exactly the escape hatch that did not
exist before, so this is a smaller problem than the one it replaced. It is the
obvious next thing if the low angle turns out to be where the game wants to
live. See [[fixed-iso-camera-needs-occluder-fade]].
