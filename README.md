# WARDSTONE

A Dungeon Defenders–shaped game: build a defence, then fight inside it.

**Premise: your wards hold the lanes — you hold what the lanes don't cover.**

Three doors open onto a crypt with one light in the middle. You place wards to
hold the ground routes, and you personally deal with everything the wards
structurally cannot: the things that fly over walls, and the things that ruin
walls faster than you can mend them.

- Port **5835** (`python serve.py 5835`), no build step, no dependencies
- three.js r170, vendored. Everything else is original.
- `npm test` runs the balance suite headlessly in ~1.2s

## Running it

```bash
python serve.py 5835
```

Then open <http://localhost:5835>. The dev server sets `Cache-Control: no-store`
on everything — without it the browser serves a cached copy of a module you
just edited and you debug code that is no longer running.

## Controls

| | Desktop | Touch |
|---|---|---|
| Move | `WASD` | left stick |
| Turn camera | right-drag | drag, or the **Turn** pad |
| Loose a bolt | left click / `F` | **Loose** |
| Mend a ward | hold `E` | hold **Mend** |
| Pick a ward | `1`–`4` | tap the ward |
| Place it | left click the ground | tap the ground |
| Sell | `X` over a ward | — |
| Start the wave | `R` / `Space` | **Ready** |

## The three rules that make it a game

1. **A wall stops a lane.** Ground foes walk a fixed route from their door to
   the stone. A ward in the way is not routed around — it is attacked. There is
   no pathfinding to outsmart, which is exactly why the genre is cheap to build
   and why walls feel solid.
2. **Wisps do not walk.** They fly over every wall you own, straight for the
   stone. Exactly one ward in four can reach a flier and it is the weakest one.
3. **Breakers out-damage your hammer.** A breaker does 145 dps to a wall; you
   mend at 45 hp/s. A wall buys you about twenty seconds against one, and
   nothing more. It has to be killed.

Rules 2 and 3 are the job description for the body. Rule 1 is the job
description for the wards. Neither half wins alone — that is asserted, not
hoped for (see below).

## Architecture

```
src/defs.js     every tunable number. No logic, no imports.
src/arena.js    the map: three lane polylines, the build grid.
src/sim.js      all the rules. No DOM, no three.js, no timers.
src/render.js   all the visuals. Reads the world, changes nothing.
src/audio.js    cue mapping + music crossfade.
src/main.js     the loop, input, HUD. The only file that knows about both.
src/harness.js  the bot and the balance suite.
```

The hard split is `sim.js`: it has no browser dependency at all, which is what
lets the whole game be played 60 times a second headlessly under node. If a
rule needs a mesh it is in the wrong file.

## The balance suite

```bash
npm test
```

25 assertions, ~1.2 seconds. Most of them exist to defend one claim, because
this genre has a well-known way of dying: the towers grow past the point where
the player matters and you end up a spectator with a repair hammer. Dungeon
Defenders itself drifted there.

So the load-bearing assertions are a three-way comparison, all on the same
seeds and the same bot:

| arm | must | why |
|---|---|---|
| wards alone | **lose** | proves the body has a job |
| body alone | **lose** | proves the wards have a job |
| both | **win** | proves it is a hybrid, not either half |

`T11b`/`T11d` are the versions that cannot pass for the wrong reason: they hand
the wards an unlimited purse and run three *different* build strategies
(balanced, air-heavy, ground-heavy) with the player stood in a corner. All three
must fail to win. Before the defence-unit budget existed, a full ward build won
with the player doing nothing at all for the entire game — the suite caught it,
the screenshots never would have.

`T14` asserts *specialisation* rather than monopoly: the player's share of
damage to wisps and breakers must be far higher than its share to husks and
runners. It currently sits at 53% versus 30%.

## The number everything hangs on

`ECON.duBudget` — a hard cap on how much board the wards may cover at once.
Mana is a flow; defence units are the ceiling. It was swept, both arms, 7 seeds:

| units | idle build wins? | body wins | median stone |
|---|---|---|---|
| 26 | no | 2/7 | 0 |
| 30 | no | 5/7 | 212 |
| **32** | **no** | **7/7** | **1556** |
| 34 | no | 7/7 | 1556 |
| 36 | **yes** | 7/7 | 2670 |

The usable window is 32–34; 36 breaks the premise outright. 32 is chosen for
margin. Re-run `.dbg/sweep.mjs` after touching any ward or foe number.

## Debug handles

`window.WARDSTONE` in the console:

```js
WARDSTONE.give(1000)   // mana
WARDSTONE.skip()       // end the build phase now
WARDSTONE.step(600)    // advance 10s of simulation synchronously
WARDSTONE.world        // the live World
```

## Traps specific to this codebase

- **`sim.js` must stay DOM-free.** The moment it imports three.js the balance
  suite stops running under node and the premise becomes unfalsifiable.
- **Foes carry two damage numbers.** `damage` is siege (wards and the stone),
  `playerDamage` is what it does to a body. One number for both either makes
  the breaker unable to break anything or makes it one-shot the player.
- **Never rely on a CSS transition to remove an overlay.** Transitions stall
  when the tab loses focus and the overlay sticks at whatever opacity it had
  reached. Overlays here fade *and* get `display:none` on a timer.
- **`instanceColor` is diffuse-only.** Per-instance hit flashes go through the
  custom `aFlash` attribute patched into the material, or they are invisible
  under this scene's dark key light.
- **The blocking test is in the travel frame,** not a distance-and-cone test. A
  cone says a ward beside you is not in the way; a body that wide physically is.
  That is the difference between three palisades sealing a lane and foes
  squeezing past the edges.

## Credits

All third-party assets are CC0. See [CREDITS.md](CREDITS.md).
