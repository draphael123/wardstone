
// ---------------------------------------------------------------------------
// THE KIT — loot, and why it has a ward slot in it.
//
// A run left nothing behind, so the hall was a well-dressed lobby: no reason to
// linger, nothing to come home to. This is the thing every hub feature in
// Dungeon Defenders is downstream of — the forge, the shop, the item boxes and
// the pet all exist because you own things.
//
// FOUR SLOTS, and the fourth is load-bearing for the premise rather than for
// the fantasy:
//
//   blade   the sword
//   guard   the shield: your health, your block, your bash
//   cloak   your feet: speed, roll, energy
//   sigil   YOUR WARDS
//
// Loot that only fed the body would tip a game whose whole claim is that
// neither half wins alone — "body alone LOSES" is an assertion, and a knight in
// full gear is exactly the case most likely to break it. The sigil slot means
// gearing up feeds both halves, so getting stronger moves the hybrid along
// instead of tilting it.
//
// The power budget is deliberately small. This is a reason to come home, not a
// second progression system bolted onto a balance that took a fortnight to
// find: a full set of the best rolls is about +30% on the body and +18% on the
// wards, and the premise is asserted AT FULL KIT rather than naked.
// ---------------------------------------------------------------------------
export const SLOTS = [
  { id: 'blade', name: 'Blade',  of: 'the sword' },
  { id: 'guard', name: 'Guard',  of: 'your shield and your skin' },
  { id: 'cloak', name: 'Cloak',  of: 'your feet' },
  { id: 'sigil', name: 'Sigil',  of: 'the wards you raise' },
];

// Every affix is a multiplier on one named thing, so an item is readable in one
// line and the sim reads it in one place.
export const AFFIXES = {
  blade: [
    { id: 'dmg',   name: 'Keen',     of: 'sword damage',   per: 0.06 },
    { id: 'reach', name: 'Long',     of: 'sword reach',    per: 0.05 },
    { id: 'swift', name: 'Swift',    of: 'swing recovery', per: -0.05 },
  ],
  guard: [
    { id: 'hp',    name: 'Stout',    of: 'health',         per: 0.07 },
    { id: 'block', name: 'Warding',  of: 'block',          per: 0.06 },
    { id: 'bash',  name: 'Heavy',    of: 'bash damage',    per: 0.10 },
  ],
  cloak: [
    { id: 'speed', name: 'Fleet',    of: 'movement',       per: 0.04 },
    { id: 'nrg',   name: 'Tireless', of: 'energy regen',   per: 0.09 },
    { id: 'roll',  name: 'Deft',     of: 'roll cooldown',  per: -0.07 },
  ],
  sigil: [
    { id: 'wrange', name: 'Farsight', of: 'ward range',    per: 0.045 },
    { id: 'wrate',  name: 'Quickening', of: 'ward rate',   per: -0.04 },
    { id: 'whp',    name: 'Enduring', of: 'ward health',   per: 0.07 },
  ],
};

// Three tiers, and the tier is just how many times the affix is applied. A
// player can read "Keen Blade III" and know exactly what it does, which is more
// than most loot systems manage.
export const TIERS = [
  { n: 1, name: 'I',   roman: 'I' },
  { n: 2, name: 'II',  roman: 'II' },
  { n: 3, name: 'III', roman: 'III' },
];

export const LOOT = {
  // What drops, and from what. Elites only, plus one guaranteed at the end of
  // a run — so a drop is an event rather than a stream, and finishing is worth
  // something even on a bad run.
  eliteChance: 0.34,      // per Giant Goblin or Bruiser killed
  waveClearWave: 3,       // from this wave onward, clearing one drops
  keep: 40,               // how many items the hall will hold
  // Tier odds shift as the run goes on: wave 6 should feel different from
  // wave 1 in what it hands you, not only in what it sends.
  tierByWave: [
    [0.82, 0.18, 0.00],
    [0.74, 0.24, 0.02],
    [0.62, 0.32, 0.06],
    [0.50, 0.38, 0.12],
    [0.38, 0.42, 0.20],
    [0.26, 0.44, 0.30],
  ],
};

// The full multiplier set a kit produces. One object, computed once when the
// kit changes, so nothing in the sim ever walks an inventory during a frame.
export function emptyMods() {
  return {
    dmg: 1, reach: 1, swift: 1,
    hp: 1, block: 1, bash: 1,
    speed: 1, nrg: 1, roll: 1,
    wrange: 1, wrate: 1, whp: 1,
  };
}

export function modsOf(kit) {
  const m = emptyMods();
  if (!kit) return m;
  for (const slot of SLOTS) {
    const it = kit[slot.id];
    if (!it) continue;
    const list = AFFIXES[slot.id] || [];
    const aff = list.find(a => a.id === it.affix);
    if (!aff) continue;
    m[aff.id] = Math.max(0.2, m[aff.id] + aff.per * (it.tier || 1));
  }
  return m;
}

export function itemName(it) {
  const list = AFFIXES[it.slot] || [];
  const aff = list.find(a => a.id === it.affix);
  const slot = SLOTS.find(s => s.id === it.slot);
  const t = TIERS[(it.tier || 1) - 1];
  return `${aff ? aff.name : '?'} ${slot ? slot.name : '?'} ${t ? t.roman : ''}`.trim();
}

export function itemLine(it) {
  const list = AFFIXES[it.slot] || [];
  const aff = list.find(a => a.id === it.affix);
  if (!aff) return '';
  const pct = Math.round(aff.per * (it.tier || 1) * 100);
  const better = aff.per > 0 ? '+' : '';
  return `${better}${pct}% ${aff.of}`;
}
