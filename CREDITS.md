# WARDSTONE — credits

All third-party assets below are **CC0 / public domain**. No attribution is
legally required; it is given anyway.

## Music

| File | Title | Author | Source |
|---|---|---|---|
| `assets/music/build.ogg` | Dark Cavern Ambient | Paul Wortmann | [OpenGameArt](https://opengameart.org/content/dark-cavern-ambient) |
| `assets/music/combat.mp3` | Epic March Loop (*The March of Devil's Dome*) | Eldritch Grim | [OpenGameArt](https://opengameart.org/content/epic-march-loop) |

## Sound effects

All from **Kenney** (<https://kenney.nl>), CC0. Curated and renamed from:

- [RPG Audio](https://kenney.nl/assets/rpg-audio) — `bolt`, `mote`, `spawn`
- [Impact Sounds](https://kenney.nl/assets/impact-sounds) — `impact*`, `foeDie*`,
  `build`, `wardDown`, `snare`, `ballista`, `stoneHit`, `hurt`, `foeSwing`
- [UI Audio](https://kenney.nl/assets/ui-audio) — `click`, `hover`, `select`
- [Music Jingles](https://kenney.nl/assets/music-jingles) — `waveStart`,
  `waveClear`, `win`, `lose`

## Code

- [three.js](https://threejs.org) r170, MIT, vendored at `vendor/three.module.js`.

Everything else — all geometry, materials, shaders, the simulation and the
balance suite — is original to this project. There are no downloaded meshes:
every unit, ward and piece of the crypt is generated in `src/render.js`, which
is what keeps the whole game under 4 MB and lets it hold 120 foes on a phone.
