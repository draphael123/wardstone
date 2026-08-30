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
