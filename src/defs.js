// WARDSTONE — the numbers.
//
// Everything tunable lives here so the harness reads the same values the game
// runs on. No imports, no logic: if a rule needs a branch it belongs in sim.js,
// and if it needs a mesh it belongs in render.js.
//
// The premise this file has to serve: YOUR WARDS HOLD THE LANES, YOU HOLD WHAT
// THE LANES DON'T COVER. Two numbers carry that and must not drift:
//
//   * BREAKER dps against a blockade (59) EXCEEDS the player's repair rate (45).
//     A breaker cannot be out-repaired, so it cannot be walled — it has to be
//     killed. Raise repair above 59 and the player becomes a spectator again.
//   * Only the BRAZIER can hit a flier, and it is the weakest ward in the set.
//     Wisps are the player's problem by construction, not by tuning. Give any
//     other ward `targets: 'all'` and that gap closes.
//   * ECON.duBudget caps how much board the wards may cover AT ALL. Without it
//     both gaps above close by sheer volume — see the note on it below.

export const PLAYER = {
  hp: 100,
  speed: 9.0,          // m/s — DD is fast; slower and the courier job drags
  radius: 0.6,
  respawn: 5.0,        // s, back at the wardstone

  // Two weapons, swapped freely. This is what makes "you hold what the lanes
  // don't cover" a moment-to-moment decision instead of a standing fact: the
  // sword is far stronger but cannot reach a wisp and puts you inside the
  // brawl, where things hit back.
  //
  // The crossbow's dps is deliberately IDENTICAL to the old single weapon
  // (62), so the air fight — the load-bearing gap — is mathematically
  // unchanged and the whole balance sweep stays valid. Only the ground
  // option is new.
  weapons: {
    crossbow: {
      name: 'Crossbow', kind: 'ranged', targets: 'all',
      damage: 34, cooldown: 0.55,      // 62 dps
      speed: 62, radius: 0.9, range: 34,
    },
    sword: {
      name: 'Sword', kind: 'melee', targets: 'ground',
      damage: 36, cooldown: 0.36,      // 100 dps, but only within 2.8m
      range: 2.8, arc: 1.9,            // radians, total sweep
    },
  },
  swapTime: 0.22,      // brief lockout so swapping mid-brawl is a real choice
  aimCone: 0.978,      // cos(12deg) — assist snaps to a foe inside this cone

  // A dodge on a plain cooldown. No stamina: the cost is the cooldown and the
  // fact that it commits you to a direction for a fifth of a second.
  dodge: {
    speed: 27,         // m/s during the roll
    time: 0.20,        // how long the roll lasts
    cooldown: 1.15,
    iframes: 0.24,     // slightly longer than the roll, so it covers the recovery
  },

  repairRate: 45,      // hp/s  (deliberately BELOW BREAKER_DPS, see above)
  repairCostPerHp: 0.12,
  repairRange: 3.4,

  pickupRange: 6.0,    // motes must be walked over — this IS the courier job.
                       // Wide enough that walking a lane sweeps it; narrow
                       // enough that you cannot sweep three lanes at once.
  vacuumSpeed: 14,
};

export const WARDSTONE = {
  hp: 3000,
  radius: 3.4,         // plinth footprint; nothing may be built inside it
  guardRadius: 0.6,    // clearance BEYOND the plinth before striking
};

export const ECON = {
  // THE most load-bearing number in the game. Mana is a flow; DU is a HARD CAP
  // on how much board you may cover at once, and it is the reason the body has
  // a job at all. With no cap, a full ward build wins with the player stood
  // still in a corner — the documented way this genre dies.
  //
  // Swept, both arms, 7 seeds (.dbg/sweep.mjs):
  //     du   idle build wins?   body wins   median stone
  //     26   no                 2/7         0        <- too swingy
  //     30   no                 5/7         212
  //     32   NO                 7/7         1556     <- chosen
  //     34   no                 7/7         1556
  //     36   YES (balanced)     7/7         2670     <- premise breaks here
  // The usable window is 32-34. 32 sits two steps clear of the cliff at 36.
  duBudget: 32,
  startMana: 260,
  buildPhase: 40,      // s before wave 1
  interPhase: 30,      // s between waves
  manaCap: 1200,
};

// ---------------------------------------------------------------------------
// Wards. Four behaviours cover the whole set:
//   blockade   — no damage, pure HP, stops the lane
//   projectile — single target, travels, ground only
//   aura       — persistent field, no targeting, hits EVERYTHING incl. fliers
//   trap       — proximity trigger, one big AoE, then recharges, ground only
// ---------------------------------------------------------------------------
export const WARDS = [
  {
    id: 'palisade', name: 'Palisade', key: '1', kind: 'blockade',
    cost: 35, du: 1, hp: 2200, radius: 0.95, targets: 'none',
    blurb: 'Holds a lane. Deals nothing. Foes stop and hit it.',
  },
  {
    id: 'ballista', name: 'Ballista', key: '2', kind: 'projectile',
    cost: 70, du: 4, hp: 300, radius: 0.8, targets: 'ground',
    range: 22, damage: 42, cooldown: 1.1, projSpeed: 46, projRadius: 0.7,
    blurb: 'Long reach, heavy bolt. Cannot elevate — ground only.',
  },
  {
    id: 'brazier', name: 'Brazier', key: '3', kind: 'aura',
    cost: 60, du: 4, hp: 260, radius: 0.8, targets: 'all',
    range: 8.5, dps: 26,
    blurb: 'The only ward that reaches a flier. Short leash.',
  },
  {
    id: 'snare', name: 'Snare', key: '4', kind: 'trap',
    cost: 45, du: 3, hp: 200, radius: 0.9, targets: 'ground',
    range: 4.5, damage: 90, cooldown: 6.0,
    blurb: 'Buried. Detonates once, then rebuilds its charge.',
  },
];

export const WARD_BY_ID = Object.fromEntries(WARDS.map(w => [w.id, w]));

// ---------------------------------------------------------------------------
// Foes. Each exists to attack a different assumption:
// `damage` is SIEGE damage (wards and the stone). `playerDamage` is what it
// does to a body. They are separate because a breaker has to threaten a wall
// far harder than it threatens you — one number for both either makes the
// breaker unable to break anything, or makes it one-shot the player.
//
//   husk    — the baseline the lanes are built for
//   runner  — volume; punishes a lane held by one thin ward
//   wisp    — ignores lanes AND blockades entirely      (the player's job)
//   breaker — out-damages repair, so a wall only buys time (the player's job)
// ---------------------------------------------------------------------------
export const FOES = [
  {
    id: 'husk', name: 'Husk',
    hp: 120, speed: 3.0, radius: 0.55, bounty: 8,
    damage: 22, playerDamage: 12, attackCd: 1.2, flying: false, height: 1.7,
  },
  {
    id: 'runner', name: 'Runner',
    hp: 55, speed: 6.2, radius: 0.45, bounty: 5,
    damage: 10, playerDamage: 7, attackCd: 0.7, flying: false, height: 1.4,
  },
  {
    id: 'wisp', name: 'Wisp',
    hp: 52, speed: 4.4, radius: 0.5, bounty: 12,
    damage: 10, playerDamage: 9, attackCd: 1.0, flying: true, height: 1.1, flyHeight: 4.2,
  },
  {
    id: 'breaker', name: 'Breaker',
    hp: 1200, speed: 1.9, radius: 1.15, bounty: 40,
    damage: 320, playerDamage: 26, attackCd: 2.2, flying: false, height: 3.0,
  },
];

export const FOE_BY_ID = Object.fromEntries(FOES.map(f => [f.id, f]));

// The number PLAYER.repairRate must stay under. Asserted in the harness.
export const BREAKER_DPS = FOE_BY_ID.breaker.damage / FOE_BY_ID.breaker.attackCd;

// ---------------------------------------------------------------------------
// Waves. `at` is seconds from the start of the wave, so a group can trail
// another down the same lane. Six waves, each introducing exactly one idea.
// ---------------------------------------------------------------------------
export const WAVES = [
  { // 1 — two lanes, one foe. Learn: lanes, palisade, ballista.
    name: 'The First Knock',
    groups: [
      { lane: 'north', foe: 'husk', count: 6, at: 0.0, gap: 1.4 },
      { lane: 'east',  foe: 'husk', count: 6, at: 3.0, gap: 1.4 },
    ],
  },
  { // 2 — all three lanes open; runners add volume.
    name: 'Three Doors',
    groups: [
      { lane: 'north', foe: 'husk',   count: 8,  at: 0.0, gap: 1.2 },
      { lane: 'east',  foe: 'runner', count: 10, at: 2.0, gap: 0.7 },
      { lane: 'west',  foe: 'husk',   count: 8,  at: 1.0, gap: 1.2 },
    ],
  },
  { // 3 — WISPS. For part of this wave the lanes stop meaning anything.
    name: 'Nothing Walks',
    groups: [
      { lane: 'north', foe: 'husk',   count: 8,  at: 0.0, gap: 1.1 },
      { lane: 'west',  foe: 'runner', count: 12, at: 1.5, gap: 0.6 },
      { lane: 'north', foe: 'wisp',   count: 5,  at: 6.0, gap: 1.8 },
      { lane: 'east',  foe: 'wisp',   count: 5,  at: 10.0, gap: 1.8 },
    ],
  },
  { // 4 — the first BREAKER. A wall stops buying safety and starts buying time.
    name: 'Something Heavy',
    groups: [
      { lane: 'east',  foe: 'husk',    count: 10, at: 0.0,  gap: 1.0 },
      { lane: 'west',  foe: 'runner',  count: 12, at: 1.0,  gap: 0.6 },
      { lane: 'north', foe: 'breaker', count: 1,  at: 4.0,  gap: 0 },
      { lane: 'north', foe: 'husk',    count: 8,  at: 5.0,  gap: 1.1 },
      { lane: 'east',  foe: 'wisp',    count: 5,  at: 12.0, gap: 1.5 },
    ],
  },
  { // 5 — two pressures at once, on lanes deliberately far apart.
    name: 'Both Hands Full',
    groups: [
      { lane: 'north', foe: 'runner',  count: 16, at: 0.0,  gap: 0.5 },
      { lane: 'west',  foe: 'breaker', count: 1,  at: 2.0,  gap: 0 },
      { lane: 'east',  foe: 'husk',    count: 12, at: 3.0,  gap: 0.9 },
      { lane: 'west',  foe: 'husk',    count: 10, at: 6.0,  gap: 1.0 },
      { lane: 'north', foe: 'wisp',    count: 6,  at: 10.0, gap: 1.4 },
    ],
  },
  { // 6 — everything, on every lane.
    name: 'The Long Dark',
    groups: [
      { lane: 'north', foe: 'runner',  count: 18, at: 0.0,  gap: 0.45 },
      { lane: 'east',  foe: 'runner',  count: 18, at: 0.5,  gap: 0.45 },
      { lane: 'west',  foe: 'breaker', count: 1,  at: 2.0,  gap: 0 },
      { lane: 'north', foe: 'breaker', count: 1,  at: 8.0,  gap: 0 },
      { lane: 'east',  foe: 'husk',    count: 14, at: 5.0,  gap: 0.8 },
      { lane: 'west',  foe: 'husk',    count: 14, at: 6.0,  gap: 0.8 },
      { lane: 'west',  foe: 'wisp',    count: 4,  at: 12.0, gap: 1.5 },
      { lane: 'north', foe: 'wisp',    count: 4,  at: 17.0, gap: 1.5 },
      { lane: 'east',  foe: 'wisp',    count: 4,  at: 22.0, gap: 1.5 },
    ],
  },
];

export function waveFoeCount(w) {
  return w.groups.reduce((n, g) => n + g.count, 0);
}
