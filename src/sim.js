// WARDSTONE — the simulation.
//
// Pure logic. No three.js, no DOM, no timers. main.js drives it with a fixed
// step and render.js reads it; the harness runs it headlessly at 60Hz with no
// renderer at all. Anything that needs a mesh or an element does NOT belong
// in this file — that separation is what makes the balance suite possible.
//
// World.step(dt) is the only mutator of time. Everything else (build, fire,
// repair, ready) is a command the caller issues between steps.

import {
  PLAYER, WARDSTONE, ECON, WARDS, WARD_BY_ID, FOE_BY_ID, WAVES, AGGRO, UPGRADE, ABILITY, HEARTH, CACHE, DIFFICULTY, STAGGER, ENERGY,
  FLANK, KILL_ENERGY,
  BRAZIER, BRAND,
} from './defs.js';
import {
  LANES, LANE_BY_ID, laneAt, cellOf, cellCenter, cellKey,
  isBuildableCell, clampToArena, nearestLane, distToLane, ARENA, currentMap, solidProps,
  HALL, clampToHall, nearestStation, canStep, terraceY,
  widthAt,
} from './arena.js';
import { makeRng } from './rand.js';
import { SLOTS, AFFIXES, LOOT, modsOf, emptyMods } from './loot.js';

// The longest wall one drag may lay. Not a balance number — the unit budget
// is what actually limits walls — just a guard against a stray drag across
// the whole arena emptying your mana in one gesture.
const RUN_MAX = 12;

// How long a foe's weapon takes to come down and recover after the windup.
const STRIKE_TIME = 0.26;

// How high above the player's feet the sword's arc reaches.
const SWORD_TOP = 2.5;

// How far off your aim a foe may be and still be snapped to. cos(75deg) —
// generous forward, and nothing behind you, so it corrects rather than steers.
const MELEE_SNAP_COS = 0.26;

// How long a body stays on the field after dying, so it can fall.
const CORPSE_TIME = 0.75;

// The least a difficulty tier may thin the premise foe.
const CLIMBER_FLOOR = 1.0;

// How fast and how far a lane foe drifts across its own track.
// The hall's furniture, as collision discs. Kept beside the sim rather than in
// the renderer for the same reason the clearing's trees are: what you see and
// what you bump into have to be one list, and last time they were not.
const HALL_SOLIDS = [
  { x: -5.2, z: 388,   r: 1.7 },   // the Glade gate's plinth
  { x: 5.2,  z: 388,   r: 1.7 },   // the Gauntlet gate's plinth
  { x: 0,    z: 404.5, r: 1.2 },   // the muster board
  { x: 8.5,  z: 400,   r: 1.3 },   // the ward rack
  { x: 6.8,  z: 407.6, r: 1.3 },   // the muster stone
  { x: -6.0, z: 393.0, r: 1.5 },   // long table
  { x: 7.2,  z: 393.0, r: 1.2 },   // the hearth
  { x: -12.0, z: 406.0, r: 1.0 },  // barrels
  { x: 11.8, z: 406.5, r: 1.0 },
  { x: -12.6, z: 404.3, r: 1.0 },
  { x: 10.5, z: 391.0, r: 1.1 },   // the keeper's counter
];

// How much further a ward on a terrace can reach.
//
// Lost once already: a later edit replaced the block from HALL_SOLIDS up to
// WANDER_RATE and took this declaration with it. It only throws when a ward
// actually stands on a terrace, so every assertion passed and only the fuzz
// actors — which build in places no sensible plan would — ever hit it.
const HIGH_GROUND = 1.22;

// How far a lock will reach, and how far it will hold before letting go.
const LOCK_RANGE = 16;

const WANDER_RATE = 0.28;
const WANDER_AMT = 0.85;

// How much of the combined body radii ground foes keep between them. At 1.0 two
// bodies do not overlap at all when there is room to avoid it.
//
// This used to be a balance dial and is not any more, because the push is now
// projected off the axis that carries balance information — see _separate.
// Measured across 21 seeds on both maps at 0.6 / 0.85 / 1.0, every value holds
// the premise and 1.0 is the best on every axis: overlapping pairs 10.8% -> 5.3%
// and the deepest overlap 99% of combined radii -> 77%.
//
// Swept over 21 seeds on both maps, and it is a balance dial as much as a
// visual one: at 0.85 the glade became a walkover and the gauntlet fell from
// 16/21 to 10/21, because how tightly a wave bunches decides how much of it a
// ward's area covers at once. 0.3 is the least separation that stops bodies
// occupying the same point, which is all the visual problem ever needed.
const SEPARATION = 1.0;
// Fliers are held much closer than walkers. They converge on ONE point by
// design, and spreading them widely around the standoff ring puts more of
// them inside more watchtower auras — which broke the premise test outright.
// This only has to stop six wisps occupying a single pixel.
const FLIER_SEPARATION = 0.12;

// How close the player has to be before an unoccupied foe takes an interest.
const NOTICE_RADIUS = 4.5;
// How far a foe will reach off its own path to hit something you built.
const ADJACENT_REACH = 0.7;

// How close anything gets to the stone before it stops and strikes. One
// rule for ground and air so a wisp and a husk hit from the same ring.
function stoneStandoff(def) {
  return WARDSTONE.radius + def.radius + WARDSTONE.guardRadius;
}

// --- a uniform grid, rebuilt each step. 120 foes over ~19 cells a side is a
// few hundred inserts; cheaper than the O(n^2) it replaces for auras and bolts.
class Hash {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  clear() { this.m.clear(); }
  _k(x, z) {
    return (Math.floor(x / this.cell) + 512) * 4096 + (Math.floor(z / this.cell) + 512);
  }
  add(o) {
    const k = this._k(o.x, o.z);
    let b = this.m.get(k);
    if (!b) { b = []; this.m.set(k, b); }
    b.push(o);
  }
  query(x, z, r, out) {
    out.length = 0;
    const c = this.cell;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const b = this.m.get((i + 512) * 4096 + (j + 512));
        if (b) for (let n = 0; n < b.length; n++) out.push(b[n]);
      }
    }
    return out;
  }
}

// Default facing for a newly placed ward: square-on to the nearest track. A
// fence panel turned the wrong way looks broken even though it blocks exactly
// the same, so "facing the road" is the useful default and manual rotation is
// the override rather than the norm.
function defaultRot(x, z) {
  const n = nearestLane(x, z);
  if (!n.lane) return 0;
  let best = 0, bd = Infinity;
  for (const sg of n.lane.segs) {
    const px = x - sg.ax, pz = z - sg.az;
    let t = px * sg.dx + pz * sg.dz;
    t = t < 0 ? 0 : (t > sg.len ? sg.len : t);
    const d = Math.hypot(px - sg.dx * t, pz - sg.dz * t);
    if (d < bd) { bd = d; best = Math.atan2(sg.dx, sg.dz); }
  }
  return best;
}

let NEXT_ID = 1;

export class World {
  constructor(opts = {}) {
    this.seed = opts.seed == null ? 12345 : opts.seed;
    this.rng = makeRng(this.seed);
    // Separate stream for scenery and scatter, so adding or changing props
    // can never perturb the combat dice and invalidate a comparison.
    this.propRng = makeRng(this.seed ^ 0x9e3779b9);
    // Sandbox freezes the wave machine so a directed test can spawn exactly
    // one foe and watch exactly one rule. See [[asserts-must-fit-the-thing-tested]].
    this.sandbox = !!opts.sandbox;
    this.t = 0;
    // Seeded, because meleeInput() reads it to advance the charge timer and
    // can be called before the first step() — an undefined dt turns holdT
    // into NaN and the heavy attack can then never fire at all.
    this._dt = 1 / 60;
    this.phase = 'build';        // build | combat | won | lost
    this.waveIndex = 0;          // index of the wave about to run / running
    this.phaseTimer = ECON.buildPhase;
    // Difficulty is resolved ONCE, here, and everything downstream reads
    // this.diff — so a run cannot change curve halfway through and the harness
    // can drive any tier by passing opts.difficulty. It must come BEFORE
    // anything that reads it, which now includes the starting purse.
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.knight;
    this.mana = ECON.startMana * (this.diff.mana || 1);
    this.duBudget = this.diff.du;
    this.du = 0;                 // spent Defence Units, capped at this.duBudget

    this.stone = { hp: WARDSTONE.hp, maxHp: WARDSTONE.hp, x: 0, z: 0 };

    this.player = {
      x: 0, z: 9, y: 0, yaw: Math.PI,
      hp: PLAYER.hp, maxHp: PLAYER.hp,
      alive: true, respawnT: 0,
      atkCd: 0, repairing: null, hurtT: 0,
      weapon: 'crossbow', swapT: 0, swingT: 0,
      dodgeT: 0, dodgeCd: 0, dodgeX: 0, dodgeZ: 0, invuln: 0,
      blocking: false, abilityCd: 0, rallyT: 0, warming: false,
      vy: 0, airT: 0, jumpCd: 0,
      energy: ENERGY.max, energyHold: 0,
      guardT: 0,
      atkPhase: null, atkT: 0, atkMove: null, atkKind: null,
      combo: 0, comboT: 0, holdT: 0,
    };

    this.foes = [];
    this.wards = [];
    this.projectiles = [];
    this.motes = [];
    this.caches = [];
    this.braziers = [];
    // what the run has turned up, and what is worn
    this.drops = [];
    this.locked = null;
    this.kit = {};
    this.mods = emptyMods();
    this.brandT = 0;        // seconds of fire left in the player's hand
    this.occupancy = new Map();  // cellKey -> ward
    this.granted = new Set();    // wards unlocked ahead of their wave
    this.spawnQueue = [];
    this.events = [];

    this.scatterCaches();
    this._placeBraziers();
    this.events.length = 0;      // the opening scatter is not news

    this.foeHash = new Hash(4);
    this.wardHash = new Hash(4);
    this._scratch = [];

    // What the harness reads to decide whether the premise actually holds.
    this.stats = {
      dmgToFoeBy: { player: {}, ward: {} },   // [source][foeId] = hp removed
      kills: {}, leaked: {}, spawned: {},
      wardLosses: 0, playerDeaths: 0, manaEarned: 0, manaSpent: 0,
      wavesCleared: 0,
    };
    // A per-WAVE ledger, reset when each one starts. The totals above answer
    // "how did the run go"; this answers "how did that wave go", which is the
    // question the player is actually asking in the pause after it.
    this.waveLog = this._blankWaveLog();
  }

  _blankWaveLog() {
    return { kills: {}, killed: 0, leaked: 0, mana: 0, wardsLost: 0, deaths: 0,
             items: [], fireStart: 0, fireEnd: 0 };
  }

  // ---------------------------------------------------------------- helpers
  emit(e) {
    this.events.push(e);
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
  }

  wardAtCell(i, j) { return this.occupancy.get(cellKey(i, j)) || null; }

  // A ward is available once its wave has been reached. The tutorial can also
  // grant one early, which is how the ballista arrives during the lesson that
  // teaches it rather than a wave later.
  isUnlocked(id) {
    const def = WARD_BY_ID[id];
    if (!def) return false;
    if (this.granted.has(id)) return true;
    return this.waveIndex >= (def.unlockWave || 0);
  }
  grant(id) { this.granted.add(id); }
  defaultRotAt(x, z) { return defaultRot(x, z); }

  grantAll() { for (const w of WARDS) this.granted.add(w.id); }

  canBuild(wardId, i, j) {
    const def = WARD_BY_ID[wardId];
    if (!def) return { ok: false, why: 'no such ward' };
    if (!this.isUnlocked(wardId)) return { ok: false, why: 'not unlocked yet' };
    if (!isBuildableCell(i, j)) return { ok: false, why: 'not buildable ground' };
    if (this.occupancy.has(cellKey(i, j))) return { ok: false, why: 'occupied' };
    if (this.du + def.du > this.duBudget) return { ok: false, why: 'no defence units' };
    if (this.mana < def.cost) return { ok: false, why: 'not enough mana' };
    return { ok: true, def };
  }

  build(wardId, i, j, rot) {
    const c = this.canBuild(wardId, i, j);
    if (!c.ok) return null;
    const def = c.def;
    const p = cellCenter(i, j);
    const w = {
      id: NEXT_ID++, def, kind: def.kind, i, j,
      x: p.x, z: p.z, rot: rot == null ? defaultRot(p.x, p.z) : rot,
      hp: def.hp, maxHp: def.hp, level: 1, power: 1,
      cd: 0, target: null, retarget: 0, dead: false, buffT: 0,
      // Under construction: solid and attackable from the moment it is placed,
      // but it does not FIRE, and its hit points ramp up as it goes together.
      buildT: this.phase === 'combat' ? (def.buildTime || 0) : 0,
      buildTotal: this.phase === 'combat' ? (def.buildTime || 0) : 0,
      // A trap starts armed; everything else starts ready.
      charge: def.kind === 'trap' ? 1 : 1,
    };
    if (w.buildT > 0) w.hp = w.maxHp * 0.25;
    this.wards.push(w);
    this.occupancy.set(cellKey(i, j), w);
    this.mana -= def.cost;
    this.du += def.du;
    this.stats.manaSpent += def.cost;
    this.emit({ type: 'build', x: p.x, z: p.z, ward: def.id });
    return w;
  }

  // NOTE: sell() and hurtWard() MARK a ward dead; `this.wards` is compacted at
  // the end of step(). Callers must not loop on wards.length expecting it to
  // shrink — it will not until the next step, and that loop will hang.
  // Effective stats for a ward at its current level. A ward may declare `up` to
  // scale reach, rate and pierce with level, not just damage — the ballista
  // does, because its problem was that a LEVEL 1 one already reached across the
  // map. Anything without `up` behaves exactly as before.
  // HIGH GROUND. A gun on a terrace sees further.
  //
  // This is what stops the terraces being purely the body's business. Without
  // it the raised ground is somewhere YOU stand and nothing more, and the
  // player who never walks up there is not making a decision — they are
  // ignoring scenery. A ballista on the lip of a terrace overlooking a lane is
  // a real reason to spend units on the high cells.
  //
  // Range only. Not damage, not rate: height should decide WHAT a gun can see,
  // which is the thing height actually means, and a flat power bonus would just
  // be "build here, it is better".
  // Wear a kit. One object of multipliers, computed here and never walked
  // again, so nothing in the sim reads an inventory during a frame.
  setKit(kit) {
    this.kit = kit || {};
    this.mods = modsOf(this.kit);
    const p = this.player;
    const frac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    p.maxHp = Math.round(PLAYER.hp * this.mods.hp);
    p.hp = Math.min(p.maxHp, Math.max(1, Math.round(p.maxHp * frac)));
    return this.mods;
  }

  wardRange(w) {
    const u = w.def.up;
    const base = u && u.range ? w.def.range * Math.pow(u.range, w.level - 1) : w.def.range;
    return base * (terraceY(w.x, w.z) > 0.9 ? HIGH_GROUND : 1) * this.mods.wrange;
  }

  wardCooldown(w) {
    const u = w.def.up;
    const base = u && u.rate ? w.def.cooldown * Math.pow(u.rate, w.level - 1) : w.def.cooldown;
    return base * this.mods.wrate;
  }

  wardPierce(w) {
    const u = w.def.up;
    const base = w.def.pierce || 1;
    return u && u.pierce ? base + u.pierce * (w.level - 1) : base;
  }

  upgradeCost(w) {
    return Math.round(w.def.cost * UPGRADE.costMul * w.level);
  }

  canUpgrade(w) {
    if (!w || w.dead) return { ok: false, why: 'nothing there' };
    if (w.buildT > 0) return { ok: false, why: 'still building' };
    if (w.level >= UPGRADE.maxLevel) return { ok: false, why: 'already at full strength' };
    if (this.mana < this.upgradeCost(w)) return { ok: false, why: 'not enough mana' };
    return { ok: true };
  }

  // Costs mana, NOT units. That is the whole point: it is somewhere for late
  // mana to go that does not widen how much board you cover.
  upgrade(w) {
    const c = this.canUpgrade(w);
    if (!c.ok) return false;
    const cost = this.upgradeCost(w);
    this.mana -= cost;
    this.stats.manaSpent += cost;
    w.level++;
    // A ward may declare its own damage growth; the ballista's is steeper
    // because it starts far weaker and has to arrive back at useful.
    const pw = (w.def.up && w.def.up.power) || UPGRADE.power;
    w.power = Math.pow(pw, w.level - 1);
    const frac = w.hp / w.maxHp;
    w.maxHp = Math.round(w.def.hp * w.power * this.mods.whp);
    w.hp = Math.round(w.maxHp * Math.max(frac, 0.5));   // a top-up comes with it
    if (this.phase === 'combat') {
      w.buildT = UPGRADE.time;
      w.buildTotal = UPGRADE.time;
    }
    this.emit({ type: 'upgrade', x: w.x, z: w.z, ward: w.def.id, level: w.level });
    return true;
  }

  // The ward the player is standing next to, for upgrading or selling.
  // Rotating something already standing. Free, and allowed at any time — a
  // wall facing the wrong way is a mistake you should be able to correct
  // without paying to tear it down and rebuild it.
  rotateWard(w, step) {
    if (!w || w.dead) return false;
    w.rot = (w.rot + (step == null ? Math.PI / 4 : step)) % (Math.PI * 2);
    return true;
  }

  // A RUN of blockades in one gesture, which is how a wall actually gets built.
  // Deliberately restricted to `blockade`: dragging out eight ballistae is not
  // a wall, it is an accident with your entire mana bar.
  //
  // Walks the line one cell at a time and stops at the first cell it cannot
  // pay for or does not have units for, rather than skipping it and carrying
  // on — a wall with a hole in it is worse than a shorter wall, and silently
  // leaving the gap is exactly the kind of thing a player would not notice
  // until something walked through it.
  planRun(wardId, i0, j0, i1, j1) {
    const def = WARD_BY_ID[wardId];
    const out = { cells: [], cost: 0, du: 0, stoppedBy: null };
    if (!def || def.kind !== 'blockade') {
      if (def) out.cells.push({ i: i1, j: j1 });   // everything else is single
      return out;
    }
    const di = i1 - i0, dj = j1 - j0;
    // snap to whichever axis the drag committed to, so a wall is straight
    const horiz = Math.abs(di) >= Math.abs(dj);
    const n = Math.min(RUN_MAX, (horiz ? Math.abs(di) : Math.abs(dj)) + 1);
    const si = horiz ? Math.sign(di) : 0;
    const sj = horiz ? 0 : Math.sign(dj);

    let mana = this.mana, du = this.du;
    for (let k = 0; k < n; k++) {
      const i = i0 + si * k, j = j0 + sj * k;
      const c = this.canBuild(wardId, i, j);
      if (!c.ok) {
        // an occupied or unbuildable cell just breaks the run there
        out.stoppedBy = c.why;
        break;
      }
      if (mana < def.cost) { out.stoppedBy = 'not enough mana'; break; }
      if (du + def.du > this.duBudget) { out.stoppedBy = 'no defence units'; break; }
      mana -= def.cost; du += def.du;
      out.cells.push({ i, j });
      out.cost += def.cost; out.du += def.du;
    }
    return out;
  }

  buildRun(wardId, i0, j0, i1, j1, rot) {
    const plan = this.planRun(wardId, i0, j0, i1, j1);
    const built = [];
    for (const c of plan.cells) {
      const w = this.build(wardId, c.i, c.j, rot);
      if (w) built.push(w);
    }
    return built;
  }

  wardNear(range) {
    const p = this.player;
    let best = null, bd = range || PLAYER.repairRange;
    for (const w of this.wards) {
      if (w.dead) continue;
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  sell(w) {
    if (!w || w.dead) return 0;
    const back = Math.floor(w.def.cost * 0.6);
    w.dead = true;
    this.du -= w.def.du;
    this.occupancy.delete(cellKey(w.i, w.j));
    this.mana = Math.min(ECON.manaCap, this.mana + back);
    this.emit({ type: 'sell', x: w.x, z: w.z });
    return back;
  }

  // The ward the player is standing next to, damaged, and can afford to mend.
  repairTarget() {
    const p = this.player;
    let best = null, bd = PLAYER.repairRange;
    for (const w of this.wards) {
      if (w.dead || w.hp >= w.maxHp) continue;
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  ready() {
    if (this.phase !== 'build') return false;
    this.phaseTimer = 0;
    return true;
  }

  // Loot rolls on their OWN stream. Sharing the world's rng would re-roll every
  // later draw in the run the moment an item dropped, which is how the braziers
  // cost three wins on a feature the bot never touched.
  lootRng() {
    if (!this._lootRng) this._lootRng = makeRng((this.seed ^ 0x10c7) >>> 0);
    return this._lootRng();
  }

  _rollItem() {
    const r = this.lootRng();
    const slot = SLOTS[Math.floor(this.lootRng() * SLOTS.length) % SLOTS.length];
    const list = AFFIXES[slot.id];
    const aff = list[Math.floor(this.lootRng() * list.length) % list.length];
    const odds = LOOT.tierByWave[Math.min(LOOT.tierByWave.length - 1, this.waveIndex)];
    let acc = 0, tier = 1;
    for (let i = 0; i < odds.length; i++) { acc += odds[i]; if (r <= acc) { tier = i + 1; break; } }
    return { id: NEXT_ID++, slot: slot.id, affix: aff.id, tier };
  }

  _dropItem(x, z) {
    const it = this._rollItem();
    it.x = x; it.z = z;
    this.drops.push(it);
    this.waveLog.items.push(it);
    this.emit({ type: 'drop', x, z, item: it });
    return it;
  }

  // Braziers are laid out ONCE for the whole run, not per muster like caches.
  // They are landmarks: "meet me at the west brazier" only means anything if it
  // is in the same place next wave.
  _placeBraziers() {
    this.braziers.length = 0;
    // Its OWN random stream. Drawing from `this.rng` shifted every later draw in
    // the run — spawn jitter, cache placement, attack cooldowns — and the glade
    // fell three wins on a feature the harness bot cannot even use. Anything
    // added to world setup has to bring its own generator or it silently
    // re-rolls the whole simulation.
    const rng = makeRng((this.seed ^ 0x5b2a) >>> 0);
    let guard = 0;
    while (this.braziers.length < BRAZIER.count && guard++ < 600) {
      const a = rng() * Math.PI * 2;
      const d = BRAZIER.minFromFire + rng() * (BRAZIER.maxFromFire - BRAZIER.minFromFire);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.abs(x) > ARENA.buildInset || Math.abs(z) > ARENA.buildInset) continue;
      // beside a road, not in it — a brazier in a lane would be a blockade you
      // never paid units for
      const n = nearestLane(x, z);
      const gap = n.lane ? distToLane(n.lane, x, z) : 99;
      if (gap < BRAZIER.minLaneDist + 1.5 || gap > 9) continue;
      if (this.braziers.some(b => Math.hypot(b.x - x, b.z - z) < 11)) continue;
      if (solidProps().some(q => Math.hypot(q.x - x, q.z - z) < q.r + 1.4)) continue;
      this.braziers.push({ id: NEXT_ID++, x, z, fuel: 0, lit: false });
    }
  }

  // Take fire from the hearth, or put it into a basket. One key, and which one
  // it means is decided by what you are standing next to.
  useFire() {
    const p = this.player;
    if (!p.alive) return null;
    if (Math.hypot(p.x, p.z) < WARDSTONE.radius + 3.2) {
      if (this.brandT > 0) return null;              // already carrying
      this.brandT = BRAND.life;
      this.emit({ type: 'brand', x: p.x, z: p.z, taken: true });
      return 'took';
    }
    if (this.brandT <= 0) return null;
    const b = this.nearBrazier();
    if (!b || b.lit) return null;
    b.lit = true;
    b.fuel = BRAZIER.burn;
    this.brandT = 0;
    this.emit({ type: 'brazier', x: b.x, z: b.z, lit: true });
    return 'lit';
  }

  nearBrazier() {
    const p = this.player;
    let best = null, bd = BRAZIER.reach;
    for (const b of this.braziers) {
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  _stepFire(dt) {
    if (this.brandT > 0) {
      this.brandT -= dt;
      if (this.brandT <= 0) this.emit({ type: 'brand', x: this.player.x, z: this.player.z, taken: false });
    }
    for (const b of this.braziers) {
      if (!b.lit) continue;
      b.fuel -= dt;
      if (b.fuel <= 0) { b.lit = false; b.fuel = 0; this.emit({ type: 'brazier', x: b.x, z: b.z, lit: false }); continue; }
      // it burns whatever is standing in it. No targeting, no cap: it is a fire.
      const near = this._scratch;
      this.foeHash.query(b.x, b.z, BRAZIER.radius, near);
      for (let i = 0; i < near.length; i++) {
        const f = near[i];
        if (f.dead) continue;
        if (Math.hypot(f.x - b.x, f.z - b.z) > BRAZIER.radius + f.def.radius) continue;
        // credited to the PLAYER: a brazier is something a body walked out and
        // lit, and the damage share tests have to see it that way or lighting
        // fires would read as the wards doing the work.
        this.hurtFoe(f, BRAZIER.dps * dt, 'player');
      }
    }
  }

  // Scatter caches for a muster. Off the roads, away from the fire, so that
  // collecting them is a walk that shows you the ground you are defending.
  scatterCaches() {
    this.caches.length = 0;
    let guard = 0;
    while (this.caches.length < CACHE.count && guard++ < 400) {
      const a = this.propRng() * Math.PI * 2;
      const r = CACHE.minFromFire + this.propRng() * (CACHE.maxFromFire - CACHE.minFromFire);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) > ARENA.buildInset || Math.abs(z) > ARENA.buildInset) continue;
      if (nearestLane(x, z).dist < CACHE.minLaneDist) continue;
      if (this.caches.some(c => Math.hypot(c.x - x, c.z - z) < 6)) continue;
      this.caches.push({
        id: NEXT_ID++, x, z, hp: CACHE.hp, maxHp: CACHE.hp,
        value: CACHE.value, dead: false, hitT: 0, spin: this.propRng() * 3,
      });
    }
    this.emit({ type: 'caches', n: this.caches.length });
  }

  hurtCache(c, amount) {
    if (!c || c.dead) return 0;
    c.hp -= amount;
    c.hitT = 0.12;
    this.emit({ type: 'cacheHit', x: c.x, z: c.z });
    if (c.hp <= 0) {
      c.dead = true;
      // pays out as motes, so it is still a walk rather than a click
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * 2 * (i / 3) + this.propRng();
        this.motes.push({
          id: NEXT_ID++, x: c.x + Math.cos(a) * 0.9, z: c.z + Math.sin(a) * 0.9,
          y: 0.6, value: Math.round(c.value / 3), life: 35, taken: false, vx: 0, vz: 0,
        });
      }
      this.emit({ type: 'cacheBreak', x: c.x, z: c.z, value: c.value });
    }
    return amount;
  }

  // ------------------------------------------------------------------ waves
  _startWave() {
    const wave = WAVES[this.waveIndex];
    if (!wave) { this.phase = 'won'; return; }
    this.waveLog = this._blankWaveLog();
    this.waveLog.fireStart = this.stone.hp;
    this.spawnQueue.length = 0;
    for (const g of wave.groups) {
      // At least one of anything the wave asked for: rounding a group of 1 down
      // to 0 on Squire would silently delete a foe TYPE from the run, which is
      // a different game rather than an easier one.
      // Difficulty scales the Wall Goblin like everything else. Holding it
      // fixed on easier tiers was tried, to protect the premise, and it made
      // SQUIRE HARDER THAN KNIGHT — dying at wave 4 on the gauntlet against
      // wave 6.6 — because the same wall of climbers arrived against a thinner
      // economy. The premise is protected by `wardMul` instead, which is a
      // property of the foe rather than of the tier, and T24 checks every tier
      // directly rather than trusting the exemption.
      // The Wall Goblin follows the tier like everything else, but with a
      // FLOOR of 1.0: a tier may send MORE of them, never fewer.
      //
      // Thinning them made an idle ring survive the gauntlet; not thinning
      // them made Squire harder than Knight. The two pull opposite ways, so
      // neither is the answer — an easier tier is made easier by helping the
      // PLAYER instead, with income. That works precisely because the idle
      // arm runs rich by construction, so mana cannot help it at all.
      const mul = g.foe === 'climber'
        ? Math.max(CLIMBER_FLOOR, this.diff.count)
        : this.diff.count;
      const count = Math.max(1, Math.round(g.count * mul));
      for (let n = 0; n < count; n++) {
        this.spawnQueue.push({ t: this.t + g.at + n * g.gap, lane: g.lane, foe: g.foe });
      }
    }
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this.caches.length = 0;          // the muster is over; no more foraging
    this.phase = 'combat';
    this.emit({ type: 'wave', index: this.waveIndex, name: wave.name });
  }

  // -------------------------------------------------------------------------
  // Save / resume.
  //
  // Only at the MUSTER, and that restriction is what makes this small enough to
  // trust. Between waves there are no foes, no projectiles and no spawn queue in
  // flight, so a save is just "which wave, what is standing, and what have I
  // got" — no mid-flight simulation state to reconstruct and get subtly wrong.
  // A run is six waves; the most a crash can cost is the wave you were in.
  //
  // Wards are stored by ward id + cell, NOT by object graph: `def` is a live
  // reference into WARDS and `occupancy` holds the same objects the array does,
  // so a naive JSON round-trip would produce wards the world could not see.
  // Rebuilding through the same path the game uses means a restored ward cannot
  // differ from a placed one.
  // -------------------------------------------------------------------------
  serialize() {
    if (this.phase !== 'build') return null;
    return {
      v: 1,
      map: currentMap().id,
      difficulty: this.diff.id,
      waveIndex: this.waveIndex,
      phaseTimer: this.phaseTimer,
      t: this.t,
      mana: this.mana,
      stone: this.stone.hp,
      playerHp: this.player.hp,
      granted: [...this.granted],
      wards: this.wards.filter(w => !w.dead).map(w => ({
        id: w.def.id, i: w.i, j: w.j, rot: w.rot,
        hp: w.hp, level: w.level, power: w.power,
      })),
    };
  }

  // Returns false rather than throwing on anything it does not recognise: a
  // stale save from an older build must degrade to "start a new run", never to
  // a broken world.
  restore(data) {
    if (!data || data.v !== 1) return false;
    if (!WAVES[data.waveIndex]) return false;

    this.phase = 'build';
    this.waveIndex = data.waveIndex;
    this.phaseTimer = data.phaseTimer;
    this.t = data.t || 0;
    this.stone.hp = Math.min(this.stone.maxHp, Math.max(1, data.stone));
    this.player.hp = Math.min(this.player.maxHp, Math.max(1, data.playerHp));
    for (const g of data.granted || []) this.granted.add(g);

    // Clear anything the fresh world put down, then rebuild through build().
    for (const w of this.wards) this.occupancy.delete(cellKey(w.i, w.j));
    this.wards.length = 0;
    this.du = 0;

    this.mana = 1e9;             // so build() cannot refuse on cost
    for (const s of data.wards || []) {
      const w = this.build(s.id, s.i, s.j, s.rot);
      if (!w) continue;          // a ward that no longer fits is simply dropped
      w.level = s.level;
      w.power = s.power;
      w.maxHp = Math.round(w.def.hp * w.power);
      w.hp = Math.min(w.maxHp, Math.max(1, s.hp));
    }
    this.mana = data.mana;
    this.events.length = 0;      // rebuilding is not news either
    return true;
  }


  // The world is built during boot so the clearing can render behind the intro
  // — which is BEFORE the player has picked a difficulty. Measured: choosing
  // Warden on the title screen had no effect whatsoever, because the curve had
  // already been resolved. Refused outright once anything has happened, so a
  // run can never change curve underneath itself.
  setDifficulty(id) {
    if (this.t > 0 || this.waveIndex > 0 || this.wards.length) return false;
    this.diff = DIFFICULTY[id] || DIFFICULTY.knight;
    this.duBudget = this.diff.du;
    return true;
  }

  _spawn(laneId, foeId) {
    const lane = LANE_BY_ID[laneId];
    const def = FOE_BY_ID[foeId];
    if (!lane || !def) return;
    const half = widthAt(lane, 0) / 2 - def.radius - 0.2;
    // Same reasoning as the count: the premise foe does not soften on an
    // easier tier, or the easier tier stops being the same game.
    // Same floor as the count: a tier may make the premise foe tougher, never
    // flimsier. Squire was giving them 70% health, which was enough for a
    // ring of guns to cover them and win the gauntlet with nobody playing.
    const hpMul = def.offLane ? Math.max(1, this.diff.hp) : this.diff.hp;
    const hp = Math.round(def.hp * hpMul);
    // An off-lane foe does not come from a DOOR either. It comes over the rim,
    // anywhere. Spawning it at one of the three gates left it perfectly
    // coverable by a ring of guns at the fire — measured, a static defence
    // still won unattended. With no fixed arrival point there is nothing to
    // pre-cover, which is exactly the job the player is there to do.
    let sx = 0, sz = 0;
    if (def.offLane) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = ARENA.wallInset - 1.5;
      sx = Math.cos(a) * r; sz = Math.sin(a) * r;
    }
    const f = {
      id: NEXT_ID++, def, kind: foeId,
      lane, dist: 0, off: this.rng.range(-half, half),
      x: sx, z: sz, y: def.flying ? def.flyHeight : 0,
      hp: hp, maxHp: hp,
      atkCd: this.rng.range(0, 0.4),
      target: null, targetKind: null, dead: false, hitT: 0,
      aggroT: 0, windT: 0, stunT: 0, slowT: 0, slowK: 1, strikeT: 0, swingK: 0,
      stagT: 0, stagCd: 0, stagX: 0, stagZ: 0,
      fuseT: 0, blastTarget: null,
      // fliers cut the corner: they take the straight line to the stone
      fx: 0, fz: 0,
      // its own phase, so a rank drifts as a rabble and not as one body
      wph: this.rng.range(0, 6.283),
      // Which way it is FACING. Only a shield reads it, but it has to be
      // maintained for everything or the shield would flicker on and off as
      // a foe changed what it was doing.
      hx: 0, hz: 1,
    };
    // Lane foes start at their door; an off-lane foe keeps the rim position it
    // was given, or this would put it straight back on the road.
    if (!def.offLane) {
      const p = laneAt(lane, 0, f.off);
      f.x = p.x; f.z = p.z;
    }
    this.foes.push(f);
    this.stats.spawned[foeId] = (this.stats.spawned[foeId] || 0) + 1;
    this.emit({ type: 'spawn', x: f.x, z: f.z, foe: foeId, lane: laneId });
  }

  // ------------------------------------------------------------------ damage
  // Does this foe's shield eat a blow arriving from (fx, fz)?
  //
  // The shield faces the way the foe faces, which for anything walking a lane
  // is straight at the defender — so the front arc is pointed exactly where you
  // are standing. Getting behind it, or to its flank, is the whole answer.
  // Is (fx, fz) inside this foe's front arc of `arc` radians?
  static inFront(f, fx, fz, arc) {
    const dx = fx - f.x, dz = fz - f.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    return (dx / d) * f.hx + (dz / d) * f.hz > Math.cos(arc / 2);
  }

  static shielded(f, fx, fz) {
    const sh = f.def.shield;
    if (!sh) return false;
    return World.inFront(f, fx, fz, sh.arc);
  }

  hurtFoe(f, amount, source, fromX, fromZ) {
    if (f.dead) return 0;
    let flanked = false;
    // A shield eats most of a MELEE blow arriving through the front arc.
    //
    // Player damage only, deliberately. Shielding bolts as well made the Shield
    // Goblin a tower problem instead of a player problem: a ballista shooting
    // one head-on did 30% damage, so the defence quietly stopped working and
    // the answer — flank it, or charge a heavy — was not something a ward could
    // ever do. It is a lock on YOU, and paying for it by thinning the waves
    // broke the premise instead (a ward build started winning unattended on
    // Squire). A ballista's bolt punches through a shield; your sword does not.
    if (source === 'player' && fromX != null &&
        World.shielded(f, fromX, fromZ)) amount *= f.def.shield.reduce;
    // FLANK. The same blow is worth more from outside the front arc, which is
    // what turns a crowd from a wall of hit points into ground you move on.
    if (source === 'player' && fromX != null && !World.inFront(f, fromX, fromZ, FLANK.arc)) {
      amount *= FLANK.mul;
      flanked = true;
    }
    // A foe may be resistant to WARD damage specifically. This is what makes a
    // foe the player's problem rather than a building's.
    if (source === 'ward' && f.def.wardMul != null) amount *= f.def.wardMul;
    const dealt = Math.min(f.hp, amount);
    f.hp -= dealt;
    // Only DISCRETE hits flash. An aura deals dps*dt every step, so refreshing
    // the flash unconditionally left anything standing in a brazier — reliably
    // the breaker, the one foe whose colour matters most — permanently white
    // and unidentifiable. A bolt is 26, an aura tick is 0.4.
    // The flinch clock. It gates a visible reaction, so the threshold has to be
    // "a discrete blow" and not "a big one" — but an aura ticking dps*dt every
    // frame must never latch it on, or the thing standing in a brazier flickers
    // permanently. 4 is above any per-frame tick and below any real hit.
    if (dealt > 4) f.hitT = 0.1;
    if (flanked && dealt > 0) f.flankT = 0.22;   // the renderer marks it
    if (source === 'player' && dealt > 0) {
      f.aggroT = AGGRO.chaseTime;   // it noticed, and it is coming
      // STAGGER. The blow has to interrupt what it was doing, or hitting things
      // reads as swinging at scenery. Gated three ways so it cannot become a
      // stunlock: heavies have poise, a graze does not count, and each foe has
      // a cooldown before it can be rocked again.
      if (!f.def.poise && dealt >= STAGGER.minDamage && f.stagCd <= 0) {
        f.stagT = STAGGER.time;
        f.stagCd = STAGGER.cooldown;
        f.windT = 0;                // its swing is interrupted
        f.strikeT = 0;
        const p = this.player;
        const kx = f.x - p.x, kz = f.z - p.z;
        const kl = Math.hypot(kx, kz) || 1;
        f.stagX = kx / kl; f.stagZ = kz / kl;
        this.emit({ type: 'stagger', x: f.x, y: f.y + f.def.height * 0.6, z: f.z, foe: f.kind });
      }
      this.emit({ type: 'dmg', x: f.x, y: f.y + f.def.height * 0.8, z: f.z, amount: dealt });
    }
    const bucket = this.stats.dmgToFoeBy[source];
    if (bucket) bucket[f.kind] = (bucket[f.kind] || 0) + dealt;
    if (f.hp <= 0) this._killFoe(f, source);
    return dealt;
  }

  _killFoe(f, by) {
    if (f.dead) return;
    if (by === 'player' && !f.def.inert) {
      this.player.energy = Math.min(ENERGY.max, this.player.energy + KILL_ENERGY);
    }
    f.dead = true;
    f.corpseT = CORPSE_TIME;
    this.stats.kills[f.kind] = (this.stats.kills[f.kind] || 0) + 1;
    if (!f.def.inert) {
      this.waveLog.kills[f.kind] = (this.waveLog.kills[f.kind] || 0) + 1;
      this.waveLog.killed++;
    }
    // Elites drop. Not everything, and not a stream — a drop should be an
    // event you look up for, which means the common goblins must never give
    // one or the rare one stops meaning anything.
    if ((f.def.poise || f.kind === 'breaker') && !f.def.inert &&
        this.lootRng() < LOOT.eliteChance) {
      this._dropItem(f.x, f.z);
    }
    // Mana does not teleport into your pocket. It lands where the foe died and
    // has to be walked over — this is the whole reason the player leaves cover.
    this.motes.push({
      id: NEXT_ID++, x: f.x, z: f.z, y: f.def.flying ? f.y : 0.6,
      // Bounty is scaled INVERSELY to how many foes the tier sends, so total
      // income is roughly constant across tiers. Without this, an easier tier
      // is a POORER one: Squire kills 28% fewer things, banks 28% less mana,
      // builds a worse line, and measured HARDER than Knight on both maps —
      // which is the opposite of what the setting says on the tin.
      value: f.def.bounty / (this.diff.count || 1), life: 35, taken: false, vx: 0, vz: 0,
    });
    this.emit({
      type: 'kill', x: f.x, y: f.y, z: f.z, foe: f.kind,
      by: by || 'ward', withWeapon: by === 'player' ? this.player.weapon : null,
    });
  }

  // Kill it before this happens and it costs you nothing at all — that is the
  // whole point of the archetype. It does NOT go off when killed.
  _detonate(f) {
    const b = f.def.blast;
    let hit = 0;
    for (const w of this.wards) {
      if (w.dead) continue;
      const d = Math.hypot(w.x - f.x, w.z - f.z);
      if (d > b.radius) continue;
      // full damage at the centre, falling off to a third at the edge
      const k = 1 - 0.66 * (d / b.radius);
      this.hurtWard(w, b.ward * k);
      hit++;
    }
    const p = this.player;
    if (p.alive) {
      const pd = Math.hypot(p.x - f.x, p.z - f.z);
      if (pd < b.radius) this.hurtPlayer(b.player * (1 - 0.5 * (pd / b.radius)));
    }
    const ds = Math.hypot(f.x, f.z);
    if (ds < b.radius + WARDSTONE.radius) this.hurtStone(b.stone || b.player, f.kind);
    this.emit({ type: 'blast', x: f.x, z: f.z, r: b.radius, hit });
    f.hp = 0;
    this._killFoe(f, 'self');
  }

  hurtWard(w, amount) {
    if (w.dead) return;
    w.hp -= amount;
    if (w.hp <= 0) {
      w.dead = true;
      this.du -= w.def.du;      // a ruined ward frees its units to rebuild
      this.occupancy.delete(cellKey(w.i, w.j));
      this.stats.wardLosses++;
      this.waveLog.wardsLost++;
      this.emit({ type: 'wardDown', x: w.x, z: w.z, ward: w.def.id });
    }
  }

  hurtPlayer(amount) {
    const p = this.player;
    if (!p.alive) return;
    if (p.invuln > 0) return;         // rolling through it
    if (p.blocking && p.weapon === 'sword') {
      // PERFECT GUARD: raised just as the blow arrives. No damage at all, the
      // energy comes back, and whoever swung is thrown off — the skill is in
      // WHEN you press block rather than in a separate parry input.
      if (p.guardT > 0) {
        p.energy = Math.min(ENERGY.max, p.energy + PLAYER.block.perfectRefund);
        p.energyHold = 0;
        this._staggerNear(1.9);
        this.emit({ type: 'perfect', x: p.x, z: p.z });
        return;
      }
      // a Warding guard leaves LESS through, so the multiplier divides
      amount *= PLAYER.block.reduce / this.mods.block;
      this.emit({ type: 'blocked', x: p.x, z: p.z });
    }
    p.hp -= amount;
    p.hurtT = 0.25;
    this.emit({ type: 'playerHurt', amount });
    if (p.hp <= 0) {
      p.alive = false;
      p.hp = 0;
      p.respawnT = PLAYER.respawn;
      this.stats.playerDeaths++;
    this.waveLog.deaths++;
      this.emit({ type: 'playerDown', x: p.x, z: p.z });
    }
  }

  hurtStone(amount, foeId) {
    this.stone.hp -= amount;
    this.stats.leaked[foeId] = (this.stats.leaked[foeId] || 0) + amount;
    this.emit({ type: 'stoneHit', amount });
    if (this.stone.hp <= 0) {
      this.stone.hp = 0;
      this.phase = 'lost';
      this.emit({ type: 'lost' });
    }
  }

  // ------------------------------------------------------------- player acts
  // ---- weapons -----------------------------------------------------------
  weaponDef(p) { return PLAYER.weapons[(p || this.player).weapon]; }

  swapWeapon(id) {
    const p = this.player;
    if (!p.alive || p.swapT > 0) return false;
    if (this.brandT > 0) return false;      // both hands: brand and crossbow
    const next = id || (p.weapon === 'sword' ? 'crossbow' : 'sword');
    if (!PLAYER.weapons[next] || next === p.weapon) return false;
    p.weapon = next;
    p.swapT = PLAYER.swapTime;
    p.atkCd = Math.max(p.atkCd, PLAYER.swapTime);
    this.emit({ type: 'swap', weapon: next });
    return true;
  }

  // One entry point for "the player attacks in this direction"; the weapon
  // decides what that means. Callers never branch on weapon kind.
  attack(dirx, dirz, diry) {
    const p = this.player;
    if (!p.alive || p.swapT > 0 || p.blocking) return null;
    if (this.weaponDef(p).kind !== 'melee') {
      if (p.atkCd > 0) return null;
      return this.fireBolt(dirx, dirz, diry, false);
    }
    // One-shot melee, used by the harness and by anything that wants "swing
    // now" without modelling a held button: press and release in one call.
    if (!this._meleeReady()) return null;
    const wd = PLAYER.weapons.sword;
    const link = wd.chain[Math.min(p.combo, wd.chain.length - 1)];
    return this._beginMelee(link, dirx, dirz, 'light');
  }
  // Energy. Spending stalls the regen briefly, so it reads as a rhythm you
  // manage rather than a tap you hold open.
  spendEnergy(n) {
    const p = this.player;
    if (p.energy < n) return false;
    p.energy -= n;
    p.energyHold = ENERGY.delay;
    return true;
  }

  // Throw off whatever was close enough to have hit you. Used by the perfect
  // guard; obeys poise like everything else, so a Bruiser is deflected but not
  // rocked — you still have to move.
  _staggerNear(r) {
    const p = this.player;
    for (const f of this.foes) {
      if (f.dead || f.def.flying || f.def.poise) continue;
      const dx = f.x - p.x, dz = f.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > r + f.def.radius) continue;
      f.stagT = STAGGER.time;
      f.stagCd = STAGGER.cooldown;
      f.windT = 0; f.strikeT = 0;
      const l = d || 1;
      f.stagX = dx / l; f.stagZ = dz / l;
      this.emit({ type: 'stagger', x: f.x, y: f.y + f.def.height * 0.6, z: f.z, foe: f.kind });
    }
  }

  _stepEnergy(dt) {
    const p = this.player;
    if (p.energyHold > 0) { p.energyHold -= dt; return; }
    p.energy = Math.min(ENERGY.max, p.energy + ENERGY.regen * this.mods.nrg * dt);
  }

  // ------------------------------------------------------------------ melee
  // The sword is a small state machine rather than a cooldown, because the
  // complaint was about TIMING, and a cooldown has none: it gates when you may
  // swing and says nothing about what the swing is doing.
  //
  //   startup -> active -> recover
  //
  // Damage lands once, on entering `active`. Movement is locked for startup and
  // active — that is the commitment — and returns during recover so the recovery
  // reads as regaining your feet rather than as lag.
  //
  // A light attack during `recover`, while the chain window is open, links into
  // the next swing. Miss the window and you start again at the first.
  _stepMelee(dt) {
    const p = this.player;
    if (p.comboT > 0) {
      p.comboT -= dt;
      if (p.comboT <= 0) p.combo = 0;      // window closed; back to the top
    }
    if (!p.atkPhase) return;

    p.atkT -= dt;
    if (p.atkT > 0) return;

    if (p.atkPhase === 'startup') {
      // the blade lands NOW
      this._meleeSweep(p.atkMove);
      p.atkPhase = 'active';
      p.atkT = p.atkMove.active;
    } else if (p.atkPhase === 'active') {
      p.atkPhase = 'recover';
      p.atkT = p.atkMove.recover * this.mods.swift;
      // the chain window opens as recovery begins
      p.comboT = PLAYER.weapons.sword.chainWindow;
    } else {
      p.atkPhase = null;
      p.atkMove = null;
    }
  }

  // Can this input start a swing right now?
  _meleeReady() {
    const p = this.player;
    if (!p.alive || p.swapT > 0 || p.blocking || p.dodgeT > 0) return false;
    // free when idle, or during recovery if the chain window is still open
    return !p.atkPhase || (p.atkPhase === 'recover' && p.comboT > 0);
  }

  // `held` is the attack button's state. The sim owns the charge timer so that
  // keyboard, mouse and touch all get identical timing for free.
  meleeInput(held, dirx, dirz) {
    const p = this.player;
    const wd = PLAYER.weapons.sword;
    // The crossbow gets the same held-button treatment, so one input path
    // drives both weapons and the player learns one rule: tap for the quick
    // one, hold for the committed one.
    if (p.weapon === 'crossbow') {
      const cb = PLAYER.weapons.crossbow;
      if (held) {
        p.holdT += this._dt;
        if (cb.brace && p.holdT >= cb.brace.charge && p.atkCd <= 0 &&
            p.energy >= cb.brace.energy) {
          p.holdT = -999;
          return this.fireBolt(dirx, dirz, 0, true);
        }
        return null;
      }
      const wasHeld = p.holdT;
      p.holdT = 0;
      if (wasHeld <= 0) return null;
      return this.fireBolt(dirx, dirz, 0, false);
    }
    if (p.weapon !== 'sword') return null;

    if (held) {
      p.holdT += this._dt;
      // A charged heavy fires the moment it is ready rather than waiting for
      // release: holding past the point of no return and then being told to let
      // go is a worse feel than the blow simply happening.
      if (p.holdT >= wd.heavy.charge && this._meleeReady()) {
        p.holdT = -999;                    // consumed; will not re-trigger
        // Not enough energy? The charge falls through to a light swing rather
        // than doing nothing, because a held button that produces silence is
        // indistinguishable from a broken one.
        if (!this.spendEnergy(ENERGY.heavy)) {
          const link = wd.chain[Math.min(p.combo, wd.chain.length - 1)];
          return this._beginMelee(link, dirx, dirz, 'light');
        }
        return this._beginMelee(wd.heavy, dirx, dirz, 'heavy');
      }
      return null;
    }

    // released
    const wasHeld = p.holdT;
    p.holdT = 0;
    if (wasHeld <= 0) return null;         // nothing pending, or already spent
    if (!this._meleeReady()) return null;
    const link = wd.chain[Math.min(p.combo, wd.chain.length - 1)];
    return this._beginMelee(link, dirx, dirz, 'light');
  }

  // What this swing should actually point at.
  //
  // The crossbow got screen-space aim assist and the sword never did — it aimed
  // at the GROUND CELL under the pointer, so you swung at a patch of dirt near
  // a goblin and a 1.7-radian arc missed. This snaps the facing to the best
  // target inside the swing's own reach, biased toward whatever is closest to
  // the direction you asked for, so it corrects your aim without overriding it.
  meleeTarget(dirx, dirz, move) {
    const p = this.player;
    // A held lock outranks the snap entirely, which is the whole point of
    // holding one: your third swing lands where your first two did.
    if (this.locked && !this.locked.dead) {
      const lx = this.locked.x - p.x, lz = this.locked.z - p.z;
      const ld = Math.hypot(lx, lz) || 1;
      if (ld <= move.range + this.locked.def.radius + 1.2) {
        return { x: lx / ld, z: lz / ld, foe: this.locked };
      }
    }
    const len = Math.hypot(dirx, dirz) || 1;
    const ux = dirx / len, uz = dirz / len;
    const near = this._scratch;
    const reach = move.range + 1.2;
    this.foeHash.query(p.x, p.z, reach + 1.5, near);
    let best = null, bestScore = -Infinity;
    for (let n = 0; n < near.length; n++) {
      const f = near[n];
      if (f.dead) continue;
      if (f.def.flying) {
        // only snap to something the blade can actually reach right now
        const blade = p.y + SWORD_TOP;
        if (f.y > blade + PLAYER.jump.airReach) continue;
      }
      const dx = f.x - p.x, dz = f.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + f.def.radius || d < 0.001) continue;
      const aim = (dx * ux + dz * uz) / d;          // 1 = dead ahead
      if (aim < MELEE_SNAP_COS) continue;            // behind you: not a target
      // prefer well-aimed and close, in that order
      const score = aim * 2 - d / reach;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    if (!best) return { x: ux, z: uz };
    const dx = best.x - p.x, dz = best.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d, foe: best };
  }

  _beginMelee(move, dirx, dirz, kind) {
    const p = this.player;
    // Commit the facing to the target on the frame the swing starts, so the
    // whole arc travels toward the thing you meant to hit.
    const aim = this.meleeTarget(dirx, dirz, move);
    p.yaw = Math.atan2(aim.x, aim.z);
    p.atkMove = move;
    p.atkKind = kind;
    p.atkPhase = 'startup';
    p.atkT = move.startup;
    p.swingT = move.startup + move.active;   // what the renderer animates
    if (kind === 'light') {
      p.combo = Math.min(p.combo + 1, PLAYER.weapons.sword.chain.length);
      if (p.combo >= PLAYER.weapons.sword.chain.length) p.combo = 0;
      p.comboT = 0;                          // reopened when recovery starts
    } else {
      p.combo = 0;
    }
    this.emit({
      type: 'windupPlayer', x: p.x, z: p.z, kind,
      startup: move.startup, dx: Math.sin(p.yaw), dz: Math.cos(p.yaw),
    });
    return true;
  }

  // The sweep itself. One arc, everything on the ground inside it, plus the
  // step forward that gives the blow its weight.
  _meleeSweep(move) {
    const p = this.player;
    const ux = Math.sin(p.yaw), uz = Math.cos(p.yaw);
    // lunge: committed movement, so it goes through the same collision as a walk
    if (move.lunge) {
      p._lunging = true;
      this.movePlayer(ux * move.lunge * 24, uz * move.lunge * 24, 1 / 24);
      p._lunging = false;
    }

    const near = this._scratch;
    this.foeHash.query(p.x, p.z, move.range + 1.5, near);
    const cosHalf = Math.cos(move.arc / 2);
    let hits = 0;
    for (let n = 0; n < near.length; n++) {
      const f = near[n];
      if (f.dead) continue;
      if (f.def.flying) {
        const blade = p.y + SWORD_TOP;
        if (f.y > blade + PLAYER.jump.airReach) continue;
        if (f.y < blade - PLAYER.jump.airReach - f.def.height) continue;
      }
      const dx = f.x - p.x, dz = f.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > move.range * this.mods.reach + f.def.radius) continue;
      if (d > 0.001 && (dx * ux + dz * uz) / d < cosHalf) continue;
      // A heavy is the only thing that goes through poise, which is what gives
      // the Bruiser and the Breaker an answer other than running away.
      if (move.breaksPoise) f.stagCd = 0;
      const wasPoised = f.def.poise;
      if (move.breaksPoise && wasPoised) {
        f.stagT = STAGGER.time * 1.4;
        f.windT = 0; f.strikeT = 0;
        const kl = Math.hypot(dx, dz) || 1;
        f.stagX = dx / kl; f.stagZ = dz / kl;
        this.emit({ type: 'stagger', x: f.x, y: f.y + f.def.height * 0.6, z: f.z, foe: f.kind });
      }
      // A charged heavy ignores the shield, exactly as it ignores poise —
      // so the Shield Goblin has two answers and the player already owns both.
      const dealt = move.damage * this.mods.dmg;
      if (move.breaksPoise) this.hurtFoe(f, dealt, 'player');
      else this.hurtFoe(f, dealt, 'player', p.x, p.z);
      // Where the blade actually met the body, so the renderer can put the
      // spark THERE. It used to spark at the player's own feet, which is why a
      // hit read as an animation happening near a goblin rather than to one.
      if (f.def.inert) {
        this.pell.combo++;
        this.pell.comboT = 1.6;
      }
      const cl = d || 1;
      this.emit({
        type: 'cleave',
        damage: move.damage,
        x: p.x + (dx / cl) * Math.max(0.4, d - f.def.radius * 0.6),
        y: f.y + f.def.height * 0.55,
        z: p.z + (dz / cl) * Math.max(0.4, d - f.def.radius * 0.6),
        kind: this.player.atkKind, foe: f.kind, killed: f.dead,
      });
      hits++;
    }

    let airborneInReach = false;
    if (!hits) {
      for (let n = 0; n < near.length; n++) {
        const f = near[n];
        if (f.dead || !f.def.flying) continue;
        if (Math.hypot(f.x - p.x, f.z - p.z) <= move.range + 1.4) { airborneInReach = true; break; }
      }
    }
    for (const c of this.caches) {
      if (c.dead) continue;
      const dx = c.x - p.x, dz = c.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > move.range + 0.9) continue;
      if (d > 0.001 && (dx * ux + dz * uz) / d < cosHalf) continue;
      this.hurtCache(c, move.damage * this.mods.dmg);
      hits++;
    }
    this.emit({
      type: 'swing', x: p.x, z: p.z, dx: ux, dz: uz, hits, airborneInReach,
      kind: this.player.atkKind, arc: move.arc, range: move.range,
    });
    return hits;
  }

  // Jump. Grounded only — no double jump, because the whole point of the apex
  // is that it is a WINDOW you have to time against a flier, and a second jump
  // would let you simply stay up there.
  jump() {
    const p = this.player;
    if (!p.alive || p.y > 0.001 || p.jumpCd > 0 || p.dodgeT > 0) return false;
    p.vy = PLAYER.jump.speed;
    p.jumpCd = PLAYER.jump.cooldown;
    this.emit({ type: 'jump', x: p.x, z: p.z });
    return true;
  }

  _stepJump(dt) {
    const p = this.player;
    if (p.jumpCd > 0) p.jumpCd -= dt;
    if (p.y <= 0 && p.vy <= 0) { p.y = 0; p.vy = 0; p.airT = 0; return; }
    p.vy -= PLAYER.jump.gravity * dt;
    p.y += p.vy * dt;
    p.airT += dt;
    if (p.y <= 0) {
      p.y = 0; p.vy = 0; p.airT = 0;
      this.emit({ type: 'land', x: p.x, z: p.z });
    }
  }

  // Blocking is a held state rather than an action, so it costs you movement
  // and your attack for as long as you want the protection.
  setBlocking(on) {
    const p = this.player;
    // A hand full of fire is a hand not on the shield. This is the price of
    // carrying a brand, and it is why walking one across the field during a
    // wave is a decision rather than an errand.
    const want = !!on && p.alive && p.weapon === 'sword' && p.dodgeT <= 0 &&
      !p.atkPhase && p.energy > 0 && this.brandT <= 0;
    if (want !== p.blocking) {
      if (want) p.guardT = PLAYER.block.perfect;   // the window opens now
      this.emit({ type: 'block', on: want });
    }
    p.blocking = want;
    return want;
  }

  canRally() {
    const p = this.player;
    if (!p.alive || p.abilityCd > 0) return false;
    if (p.energy < ENERGY.bash) return false;
    // a shield needs a hand, and both are on the crossbow
    if (ABILITY.needsSword && p.weapon !== 'sword') return false;
    return true;
  }

  // The horn: shoves everything nearby off its feet and puts a burst of speed
  // through the wards behind you. One button, long cooldown, for the moment
  // two things need you at once.
  // Shield bash. Frontal, short, and on a rhythm rather than a timer you hoard.
  rally(dirx, dirz) {
    const p = this.player;
    if (!this.canRally()) return false;
    this.spendEnergy(ENERGY.bash);
    p.abilityCd = ABILITY.cooldown;
    p.rallyT = 0.45;
    // aimed where you face unless told otherwise
    const len = Math.hypot(dirx || 0, dirz || 0);
    const ux = len > 0.01 ? dirx / len : Math.sin(p.yaw);
    const uz = len > 0.01 ? dirz / len : Math.cos(p.yaw);
    p.yaw = Math.atan2(ux, uz);
    const cosHalf = Math.cos(ABILITY.arc / 2);
    let hit = 0;
    for (const f of this.foes) {
      if (f.dead || f.def.flying) continue;
      const dx = f.x - p.x, dz = f.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > ABILITY.range + f.def.radius) continue;
      if (d > 0.001 && (dx * ux + dz * uz) / d < cosHalf) continue;
      // Interrupts and shoves, but does NOT break poise — that is the charged
      // heavy's job, and two abilities doing it would make the heavy pointless.
      if (!f.def.poise) {
        f.stunT = ABILITY.stun;
        f.windT = 0;
        f.strikeT = 0;
      }
      const k = ABILITY.knock * (d > 0.01 ? 1 : 0);
      if (d > 0.01) {
        f.x += (dx / d) * k;
        f.z += (dz / d) * k;
        if (!f.def.flying) f.dist = Math.max(0, f.dist - k);
      }
      // The bash goes through a shield too: it is a shield being driven into
      // one, which is the one moment that ability stops being a panic button.
      this.hurtFoe(f, ABILITY.damage * this.mods.bash, 'player');
      hit++;
    }
    this.emit({ type: 'rally', x: p.x, z: p.z, hit, dx: ux, dz: uz });
    return true;
  }


  dodge(dirx, dirz) {
    const p = this.player;
    if (!p.alive || p.dodgeCd > 0 || p.dodgeT > 0) return false;
    let ux = dirx, uz = dirz;
    const len = Math.hypot(ux, uz);
    if (len < 0.01) { ux = Math.sin(p.yaw); uz = Math.cos(p.yaw); }
    else { ux /= len; uz /= len; }
    p.dodgeX = ux; p.dodgeZ = uz;
    p.dodgeT = PLAYER.dodge.time;
    p.dodgeCd = PLAYER.dodge.cooldown * this.mods.roll;
    p.invuln = PLAYER.dodge.iframes;
    this.emit({ type: 'dodge', x: p.x, z: p.z, dx: ux, dz: uz });
    return true;
  }

  // Touch has no crosshair, so it gets the nearest flier handed to it — the
  // air is the player's job and a thumbstick cannot elevate.
  nearestFlier(range) {
    const p = this.player;
    let best = null, bd = range || 999;
    for (const f of this.foes) {
      if (f.dead || !f.def.flying) continue;
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  // `braced` is a held shot: slower to set up, and it goes through a rank.
  fireBolt(dirx, dirz, diry, braced) {
    const p = this.player;
    const wd = PLAYER.weapons.crossbow;
    if (!p.alive || p.atkCd > 0) return null;
    const br = braced && wd.brace ? wd.brace : null;
    if (br && p.energy < br.energy) return null;
    if (br) this.spendEnergy(br.energy);
    p.atkCd = br ? wd.cooldown * 1.9 : wd.cooldown;

    // A held lock wins here as well, so swapping weapons does not swap targets.
    let best = null, bestD = Infinity;
    if (this.locked && !this.locked.dead &&
        Math.hypot(this.locked.x - p.x, this.locked.z - p.z) <= wd.range) {
      best = this.locked;
    }
    // Aim assist: snap to the nearest foe inside a narrow cone. Without this,
    // hitting a 0.5m wisp at 4m altitude with a mouse is miserable.
    const len = Math.hypot(dirx, dirz, diry || 0) || 1;
    const ux = dirx / len, uz = dirz / len, uy = (diry || 0) / len;
    for (const f of this.foes) {
      if (best === this.locked && best) break;   // the lock already decided
      if (f.dead) continue;
      const vx = f.x - p.x, vy = (f.y + f.def.height * 0.5) - (p.y + 1.2), vz = f.z - p.z;
      const d = Math.hypot(vx, vy, vz);
      if (d > wd.range || d < 0.001) continue;
      const dot = (vx * ux + vy * uy + vz * uz) / d;
      // Fliers get a much wider cone. The narrow one is right for picking one
      // goblin out of a crowd; applied to the sky it created a blind spot that
      // grew as a wisp got CLOSER, which is precisely backwards.
      const cone = f.def.flying ? PLAYER.aimConeAir : PLAYER.aimCone;
      if (dot > cone && d < bestD) { bestD = d; best = f; }
    }

    const b = {
      id: NEXT_ID++, source: 'player',
      x: p.x, y: p.y + 1.2, z: p.z,
      dx: ux, dy: uy, dz: uz,
      speed: br ? br.speed : wd.speed,
      damage: (br ? br.damage : wd.damage) *
        (best && best.def.flying && wd.airMul ? wd.airMul : 1),
      radius: br ? br.radius : wd.radius,
      target: best, life: wd.range / (br ? br.speed : wd.speed),
      dead: false,
      pierce: br ? br.pierce : 0, hit: null,
      knock: br ? br.knock : 0, braced: !!br,
    };
    this.projectiles.push(b);
    this.emit({ type: 'bolt', x: b.x, y: b.y, z: b.z, braced: !!br });
    return b;
  }

  // Returns hp actually mended this step.
  repairStep(dt) {
    const p = this.player;
    if (!p.alive) return 0;
    const w = this.repairTarget();
    p.repairing = w;
    if (!w) return 0;
    const want = Math.min(PLAYER.repairRate * dt, w.maxHp - w.hp);
    const afford = this.mana / PLAYER.repairCostPerHp;
    const hp = Math.min(want, afford);
    if (hp <= 0) return 0;
    w.hp += hp;
    const cost = hp * PLAYER.repairCostPerHp;
    this.mana -= cost;
    this.stats.manaSpent += cost;
    return hp;
  }

  movePlayer(vx, vz, dt) {
    const p = this.player;
    if (!p.alive) return;
    // ATTACKS COMMIT YOU. Your feet are the price of a swing, not your reaction
    // time — which is what makes a heavy weapon read as heavy rather than as
    // laggy. Recovery frames are free again, so getting your feet back is part
    // of the animation instead of a period of unexplained paralysis. The lunge
    // routes through here deliberately, so a committed step still collides.
    if (p.dodgeT <= 0 && !p._lunging &&
        (p.atkPhase === 'startup' || p.atkPhase === 'active')) {
      // A HEAVY still roots you completely — that is what buys it its damage
      // and its poise break. A LIGHT does not.
      //
      // Measured: the light chain rooted you for 49% of the time you spent
      // swinging it, in a game where a mob converges on you from three lanes
      // at once. Committing your feet is right for a wind-up you chose; it is
      // just stickiness on a 0.07s jab. You keep about a third of your speed
      // through a light, so you can hold a line while swinging and still not
      // stroll through a fight untouchable.
      if (p.atkKind === 'heavy') return;
      vx *= PLAYER.attackDrift;
      vz *= PLAYER.attackDrift;
    }
    if (p.blocking && p.dodgeT <= 0) { vx *= PLAYER.block.slow; vz *= PLAYER.block.slow; }
    let nx = p.x + vx * dt, nz = p.z + vz * dt;
    const c = this.hub ? clampToHall(nx, nz, PLAYER.radius)
                       : clampToArena(nx, nz, PLAYER.radius);
    nx = c.x; nz = c.z;
    if (this.hub) {
      // the furniture is solid in here too, or the room is a painted backdrop
      // exactly the way the clearing's trees were
      for (const q of HALL_SOLIDS) {
        const dx = nx - q.x, dz = nz - q.z;
        const d = Math.hypot(dx, dz);
        const want = q.r + PLAYER.radius;
        if (d >= want || d < 1e-4) continue;
        nx = q.x + (dx / d) * want;
        nz = q.z + (dz / d) * want;
      }
      p.x = nx; p.z = nz;
      return;
    }
    // Terraces. You may drop off one anywhere; you may only get up by a ramp.
    { const r = World.slide(p.x, p.z, nx, nz); nx = r.x; nz = r.z; }

    // Solid scenery is solid for the player too. Same push-out as a ward, so a
    // boulder behaves exactly like something you built.
    for (const q of solidProps()) {
      const dx = nx - q.x, dz = nz - q.z;
      const d = Math.hypot(dx, dz);
      const want = q.r + PLAYER.radius;
      if (d >= want || d < 1e-4) continue;
      nx = q.x + (dx / d) * want;
      nz = q.z + (dz / d) * want;
    }

    // Wards are solid. Push out of any we ended up inside — a simple circle
    // resolve is enough because everything is a disc on a 2m grid.
    for (const w of this.wards) {
      if (w.dead || w.def.kind === 'field') continue;       // you walk over these too
      const dx = nx - w.x, dz = nz - w.z;
      const min = PLAYER.radius + w.def.radius;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 0.0001) {
        nx = w.x + (dx / d) * min;
        nz = w.z + (dz / d) * min;
      }
    }
    // The plinth is solid too.
    const ds = Math.hypot(nx, nz);
    const minS = WARDSTONE.radius + PLAYER.radius;
    if (ds < minS && ds > 0.0001) { nx = (nx / ds) * minS; nz = (nz / ds) * minS; }

    p.x = nx; p.z = nz;
  }

  // ------------------------------------------------------------------- step
  // Walk into the hall. The war is not running while you are in here — no
  // wave clock, no foes, no fire burning down — but the KNIGHT is entirely
  // live: the same body, the same moveset, the same energy bar. That is the
  // point of a home room over a title screen. You can hit the pell with the
  // real sword because it is the real sword.
  enterHall() {
    this.hub = true;
    this.phase = 'build';
    this.foes.length = 0;
    this.projectiles.length = 0;
    this.player.x = HALL.door.x;
    this.player.z = HALL.door.z;
    this.player.y = 0;
    this.player.yaw = Math.PI;          // facing into the room
    this.player.hp = this.player.maxHp;
    this.player.energy = ENERGY.max;
    // Sword in hand. You came home to practise, and the pell does not care
    // about bolts — the first thing anyone did in here was swing a crossbow at
    // it and conclude the post was broken.
    this.player.weapon = 'sword';
    this.player.swapT = 0;
    this.pell = { combo: 0, comboT: 0 };
    // Three of them, in an arc where the old single post stood. Three because
    // the thing worth practising is the CHAIN and the arc it sweeps, and one
    // target teaches you nothing about either.
    this.foes.length = 0;
    for (const [dx, dz] of [[-10.2, 401.8], [-8.6, 399.4], [-11.0, 398.4]]) {
      this.foes.push(this._makeDummy(dx, dz));
    }
    this.events.length = 0;
  }

  leaveHall() {
    this.hub = false;
    this.player.x = 0;
    this.player.z = 6;
  }

  _makeDummy(x, z) {
    const def = FOE_BY_ID.dummy;
    return {
      id: NEXT_ID++, kind: 'dummy', def,
      lane: LANES[0], dist: 0, off: 0,
      x, z, y: 0, hp: def.hp, maxHp: def.hp,
      atkCd: 0, target: null, targetKind: null, dead: false, hitT: 0,
      aggroT: 0, windT: 0, stunT: 0, slowT: 0, slowK: 1, strikeT: 0, swingK: 0,
      stagT: 0, stagCd: 0, stagX: 0, stagZ: 0,
      fuseT: 0, blastTarget: null, fx: 0, fz: 0, wph: 0, hx: 0, hz: 1,
    };
  }

  // ------------------------------------------------------------- lock-on
  // Hold a target, and every swing and bolt goes to it until it dies or you
  // let go. The aim snap already picks well from a direction, but it picks
  // AFRESH every swing — so in a crowd the thing you were most of the way
  // through killing is not necessarily the thing your next blow lands on, and
  // a fight becomes chip damage spread over eight bodies.
  //
  // The sim only owns WHICH foe. The camera turning to keep it framed is the
  // renderer's business, and the two must not fight over the yaw.
  lockOn() {
    const p = this.player;
    if (this.locked && !this.locked.dead) { this.locked = null; return null; }
    let best = null, bestScore = -Infinity;
    const ux = Math.sin(p.yaw), uz = Math.cos(p.yaw);
    for (const f of this.foes) {
      if (f.dead || f.def.inert) continue;
      const dx = f.x - p.x, dz = f.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > LOCK_RANGE || d < 0.001) continue;
      // in front of you, and near — aim matters more than distance, the same
      // weighting the melee snap uses, so the pick is never a surprise
      const aim = (dx * ux + dz * uz) / d;
      if (aim < 0.1) continue;
      const score = aim * 2 - d / LOCK_RANGE;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    this.locked = best;
    if (best) this.emit({ type: 'lock', x: best.x, z: best.z, foe: best.kind });
    return best;
  }

  // Dropped the moment it stops being a valid thing to hold: dead, or so far
  // away that holding it would drag your aim off everything nearer.
  _stepLock() {
    const f = this.locked;
    if (!f) return;
    const p = this.player;
    if (f.dead || Math.hypot(f.x - p.x, f.z - p.z) > LOCK_RANGE * 1.4) {
      this.locked = null;
      this.emit({ type: 'lockLost' });
    }
  }

  // What you are standing close enough to use.
  station() {
    return this.hub ? nearestStation(this.player.x, this.player.z) : null;
  }

  step(dt) {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.t += dt;
    if (this.hub) return this._stepHall(dt);

    const p = this.player;
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;
    if (p.swapT > 0) p.swapT -= dt;
    if (p.swingT > 0) p.swingT -= dt;
    if (p.dodgeCd > 0) p.dodgeCd -= dt;
    if (p.abilityCd > 0) p.abilityCd -= dt;
    if (p.rallyT > 0) p.rallyT -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    this._dt = dt;
    // Blocking is paid for out of the build purse. Run it dry and the shield
    // drops on its own, which is a much clearer lesson than a greyed-out button.
    if (p.blocking) {
      p.energy = Math.max(0, p.energy - PLAYER.block.energyPerSec * dt);
      p.energyHold = ENERGY.delay;
      if (p.energy <= 0) this.setBlocking(false);
    }
    this._stepJump(dt);
    if (p.guardT > 0) p.guardT -= dt;
    this._stepEnergy(dt);
    this._stepMelee(dt);
    if (p.dodgeT > 0) {
      p.dodgeT -= dt;
      this.movePlayer(p.dodgeX * PLAYER.dodge.speed, p.dodgeZ * PLAYER.dodge.speed, dt);
    }
    if (!p.alive) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) {
        p.alive = true; p.hp = p.maxHp;
        p.x = 0; p.z = WARDSTONE.radius + 2.5;
        this.emit({ type: 'respawn' });
      }
    }

    // Warming at the fire. Between waves only: it is a reward for coming home,
    // not a fountain you can stand in during a fight.
    p.warming = false;
    if (this.phase === 'build' && p.alive && p.hp < p.maxHp) {
      if (Math.hypot(p.x, p.z) < HEARTH.radius) {
        p.warming = true;
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + HEARTH.heal * dt);
        this.stats.healed = (this.stats.healed || 0) + (p.hp - before);
      }
    }

    // ---- phase
    if (this.phase === 'build' && !this.sandbox) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this._startWave();
    }

    // ---- spawns
    while (this.spawnQueue.length && this.spawnQueue[0].t <= this.t) {
      const s = this.spawnQueue.shift();
      this._spawn(s.lane, s.foe);
    }

    // ---- rebuild hashes
    this.foeHash.clear();
    for (const f of this.foes) if (!f.dead) this.foeHash.add(f);
    this.wardHash.clear();
    for (const w of this.wards) if (!w.dead) this.wardHash.add(w);

    this._stepFoes(dt);
    this._stepWards(dt);
    this._stepProjectiles(dt);
    this._separate(dt);
    this._stepLock();
    this._stepFire(dt);
    this._stepMotes(dt);

    // ---- cull
    // Dead foes linger for a moment so the renderer can drop the body instead
    // of blinking it out mid-animation. Everything in the sim already skips
    // `dead`, so a corpse on the list is inert — it just has not been swept up.
    let sweep = false;
    for (const f of this.foes) {
      if (!f.dead) continue;
      f.corpseT = (f.corpseT == null ? CORPSE_TIME : f.corpseT) - dt;
      if (f.corpseT <= 0) sweep = true;
    }
    if (sweep) this.foes = this.foes.filter(f => !f.dead || f.corpseT > 0);
    if (this.wards.some(w => w.dead)) this.wards = this.wards.filter(w => !w.dead);
    if (this.projectiles.some(b => b.dead)) this.projectiles = this.projectiles.filter(b => !b.dead);
    if (this.caches.some(c => c.dead)) this.caches = this.caches.filter(c => !c.dead);
    if (this.motes.some(m => m.taken || m.life <= 0)) {
      this.motes = this.motes.filter(m => !m.taken && m.life > 0);
    }

    // ---- wave end
    if (!this.sandbox && this.phase === 'combat' && !this.spawnQueue.length && !this.foes.length) {
      this.stats.wavesCleared++;
      // Raised from 52+16i once the roster grew. The session that added the
      // bomber, three goblin types, a chase, a notice radius and adjacent-ward
      // attacks put MORE demand on the player and MORE pressure on the line
      // without adding a penny of income, and the bot fell from ~80% to ~57%.
      // The glade in particular is mana-limited, so income is the honest lever
      // there — swept over 21 seeds on both maps: 52+16i gave 12/21 and 15/21,
      // 72+24i gives 13/21 and 16/21 with roughly triple the fire left standing.
      // Tuned, not guessed. At 60+20i the clear bonus alone funded a full
      // rebuild after every wave regardless of how that wave had gone, which
      // flattened the consequence of a bad one. Swept against the wave curve
      // until the bot wins ~7/10 with roughly a fifth of the fire left.
      const bonus = (72 + 24 * this.waveIndex) * (this.diff.mana || 1);
      this.mana = Math.min(ECON.manaCap, this.mana + bonus);
      this.stats.manaEarned += bonus;
      this.emit({ type: 'waveClear', index: this.waveIndex, bonus });
      this.waveIndex++;
      if (this.waveIndex >= WAVES.length) {
        this.phase = 'won';
        this.emit({ type: 'won' });
      } else {
        this.phase = 'build';
        this.phaseTimer = ECON.interPhase;
        this.scatterCaches();
        this.waveLog.fireEnd = this.stone.hp;
        this.emit({ type: 'waveDone', wave: this.waveIndex, log: this.waveLog });
        // Surviving a late wave is worth something on its own, so a run that
        // ends badly still leaves you holding more than it started with.
        if (this.waveIndex >= LOOT.waveClearWave) this._dropItem(0, WARDSTONE.radius + 3);
      }
    }
  }

  _stepFoes(dt) {
    const p = this.player;
    const near = this._scratch;

    for (const f of this.foes) {
      if (f.dead) continue;
      if (f.hitT > 0) f.hitT -= dt;
      if (f.atkCd > 0) f.atkCd -= dt;

      const def = f.def;
      let blocked = null;
      let sideTarget = null;

      // --- who am I hitting?
      // The player outranks a ward: standing in a lane has to cost something,
      // or the safe play is to park on top of the palisade and hold repair.
      if (f.aggroT > 0) f.aggroT -= dt;
      if (def.inert) continue;                        // a pell: hit it, it stands
      if (f.stunT > 0) { f.stunT -= dt; continue; }   // off its feet
      if (f.stagCd > 0) f.stagCd -= dt;
      if (f.stagT > 0) {
        f.stagT -= dt;
        // Shoved back along the blow while it recovers. Movement and attacks
        // are both suspended, which is the whole point — a hit BUYS you time.
        const k = Math.min(1, dt * 9);
        f.x += f.stagX * STAGGER.knock * k;
        f.z += f.stagZ * STAGGER.knock * k;
        continue;
      }
      if (f.fuseT > 0) {
        f.fuseT -= dt;
        if (f.fuseT <= 0) this._detonate(f);
        continue;                                     // committed; cannot be steered
      }
      // slow decays rather than switching off, so leaving a field reads
      if (f.slowT > 0) { f.slowT -= dt; if (f.slowT <= 0) f.slowK = 1; }
      const spd = def.speed * (f.slowT > 0 ? f.slowK : 1);
      let hitPlayer = false;
      let dPlayer = Infinity;
      if (p.alive) {
        dPlayer = Math.hypot(p.x - f.x, p.z - f.z);
        const dy = Math.abs((p.y + 0.9) - f.y);
        if (dPlayer < def.radius + PLAYER.radius + 1.3 && dy < 3.2) hitPlayer = true;
        // Standing NEAR a lane should be dangerous too, not only standing in
        // one. Reported: "they don't always attack me, they should." A foe with
        // nothing else to do notices the player well before contact and comes
        // for them; one already busy with a wall keeps hitting the wall.
        //
        // NOT `!hitPlayer`. Guarding this on being out of reach set up an exact
        // limit cycle on the reach boundary: a foe closed, came into reach, and
        // by coming into reach stopped having its aggro refreshed — so aggro
        // decayed, `chasing` went false, and it fell through to the lane branch,
        // which snapped it back onto the polyline just outside reach, where its
        // aggro refreshed and it closed again. It sat oscillating between 2.36
        // and 2.47m against a 2.45m reach, winding up 93 times to land 2 blows.
        if (!def.flying && !def.blast && dPlayer < NOTICE_RADIUS) {
          f.aggroT = Math.max(f.aggroT, 0.35);
        }
      }
      // An aggroed ground foe leaves its lane to come at you — but only within
      // a short leash, so a whole wave can never be kited off the map.
      // How far it has been pulled from the lane it left, not how far it is
      // from the player — otherwise backing away from a foe would call it off
      // at exactly the moment it should be committing to you.
      // Squeezed by the pinch. The lane's width varies along it now, so a foe
      // walking from an 8m mouth into a 3.2m throat has to be brought in with
      // it — otherwise the funnel is only painted on the floor and the wave
      // walks straight through the verge of it.
      if (!def.offLane) {
        const lh = World.laneHalf(f);
        if (f.off > lh) f.off = lh; else if (f.off < -lh) f.off = -lh;
      }
      const q = laneAt(f.lane, f.dist, f.off);
      const strayed = Math.hypot(f.x - q.x, f.z - q.z);
      // Which way it is facing: at the player when it has taken an interest,
      // otherwise up its own lane. Only a shield reads this, but it is kept for
      // every foe so the renderer can lean on it later.
      {
        let hx, hz;
        if (p.alive && (f.aggroT > 0 || dPlayer < NOTICE_RADIUS)) {
          hx = p.x - f.x; hz = p.z - f.z;
        } else {
          const ah = laneAt(f.lane, Math.min(f.lane.total, f.dist + 1), f.off);
          hx = ah.x - f.x; hz = ah.z - f.z;
        }
        const hl = Math.hypot(hx, hz);
        if (hl > 1e-4) { f.hx = hx / hl; f.hz = hz / hl; }
      }
      // Reach and CONTACT are deliberately different distances. `hitPlayer` is
      // how far the thing can swing; `planted` is how close it insists on
      // getting first. Making them the same number is why foes stopped a full
      // body-width short and swung at the air in front of you — they satisfied
      // "can strike" and immediately stopped closing.
      const contact = def.radius + PLAYER.radius + 0.45;
      // Only a windup aimed at the PLAYER plants. A foe winding up at a ward is
      // already held still by the blocked branch below, and catching it here
      // instead would skip the line that keeps `f.target` pointed at the wall.
      const planted = (p.alive && dPlayer < contact) ||
        (f.windT > 0 && f.windAt === 'player');
      const chasing = !def.flying && f.aggroT > 0 && p.alive && !planted &&
        strayed < AGGRO.leash;
      // Given up on you: walk back to its lane rather than standing where it
      // stopped, or a peeled foe would simply be deleted from the wave.
      const returning = !def.flying && !chasing && strayed > 1.2 && f.aggroT <= 0;

      if (def.offLane) {
        // Straight for the fire, over the rocks. It never touches a lane, so it
        // never meets anything you built on one — which is the whole point of
        // it, and why the body still has a job with no air in the game.
        const dx = -f.x, dz = -f.z;
        const d = Math.hypot(dx, dz) || 1;
        const stop = stoneStandoff(def);
        if (d > stop) {
          const r = World.slide(f.x, f.z, f.x + (dx / d) * spd * dt, f.z + (dz / d) * spd * dt);
          f.x = r.x; f.z = r.z;
          // Boulders and trunks are solid to it. This is what turns the scenery
          // into CHOKE POINTS: a Wall Goblin walks a straight line to the fire,
          // so a rock in that line funnels it somewhere predictable, and the
          // gaps between them become the places worth standing. Lane foes are
          // unaffected — no prop is ever placed on a lane.
          for (const q of solidProps()) {
            const ox = f.x - q.x, oz = f.z - q.z;
            const od = Math.hypot(ox, oz);
            const want = q.r + f.def.radius;
            if (od >= want || od < 1e-4) continue;
            f.x = q.x + (ox / od) * want;
            f.z = q.z + (oz / od) * want;
          }
          f.targetKind = null;
        } else {
          f.targetKind = 'stone';
        }
      } else if (def.flying) {
        // Fliers ignore lanes and blockades entirely. This is the gap the
        // player exists to fill; do not "fix" it by pathing them.
        const dx = -f.x, dz = -f.z;
        const d = Math.hypot(dx, dz) || 1;
        const stop = stoneStandoff(def);
        // A wisp DIVES to strike the fire rather than hovering at cruising
        // height over it. Two reasons, and the second is the important one:
        // it reads as an attack instead of a hover, and it is what makes the
        // jump a real mechanic. Measured before this: a wisp was inside sword
        // range 2% of the time and the bot took ZERO jumps in a whole game, so
        // "jump to reach the air" existed and never happened.
        //
        // Balance-neutral for wards: auras key on HORIZONTAL distance and the
        // ballista has no anti-air at all, so altitude changes nothing there.
        const diving = Math.hypot(f.x, f.z) <= stop + 1.5;
        const wantY = diving ? def.diveHeight : def.flyHeight;
        f.y += (wantY - f.y) * Math.min(1, dt * 2);
        if (d > stop) {
          f.x += (dx / d) * spd * dt;
          f.z += (dz / d) * spd * dt;
          f.targetKind = null;
        } else {
          f.targetKind = 'stone';
        }
        // face what it is going for, so the strike animation has a direction
        f.faceX = dx / (d || 1); f.faceZ = dz / (d || 1);
      } else {
        // Ground foes ride their lane. A ward in the way is attacked, never
        // routed around. Query is a disc because everything here is a disc.
        this.wardHash.query(f.x, f.z, def.radius + 2.6, near);
        const ahead = laneAt(f.lane, f.dist + 0.5, f.off);
        const fwx = ahead.x - f.x, fwz = ahead.z - f.z;
        const fl = Math.hypot(fwx, fwz) || 1;
        const ux = fwx / fl, uz = fwz / fl;
        let bestAlong = Infinity;
        for (let n = 0; n < near.length; n++) {
          const w = near[n];
          if (w.dead || w.def.kind === 'field') continue;   // walk over, not into
          const dx = w.x - f.x, dz = w.z - f.z;
          // Resolve into travel-frame components rather than testing a raw
          // distance and a cone. A cone test says a ward SIDE-ON is not in the
          // way, but a body that wide physically is — that is the difference
          // between "three palisades seal a lane" and "foes squeeze past".
          const along = dx * ux + dz * uz;
          const side = Math.abs(dx * -uz + dz * ux);
          const span = def.radius + w.def.radius;
          if (side >= span) continue;              // clears it laterally
          if (along < -span * 0.5) continue;       // already behind me
          if (along > span + 0.55) continue;       // not reached yet
          if (along < bestAlong) { bestAlong = along; blocked = w; }
        }

        // Anything within arm's reach as it walks past, even if it is not in
        // the way. Reported: "I'd like them to also hit other structures that
        // aren't technically on the path — if they're right next to the path
        // they should be able to." Before this, a ballista placed one metre
        // off a lane was untouchable by the entire wave walking beside it.
        //
        // Bounded by REACH, not by a search radius, so it only ever picks up
        // wards a foe could genuinely swing at — putting your tower a couple of
        // metres back is still the right answer, it just has to be a couple of
        // metres and not one.
        // CRITICAL: this must not stop the foe. The first version assigned the
        // adjacent ward to `blocked`, which is the variable that halts
        // movement — so every tower beside a lane silently became a BLOCKADE,
        // and the premise test broke immediately: an air-heavy ring around the
        // fire won unattended, because the foes obligingly stopped to chew on
        // the towers instead of walking to the objective. Wards must not gain a
        // blocking function the unit budget does not price.
        //
        // So it swings as it walks PAST. Attack, no stop.
        sideTarget = null;
        if (!blocked) {
          let bd = Infinity;
          for (let n = 0; n < near.length; n++) {
            const w = near[n];
            if (w.dead || w.def.kind === 'field') continue;
            const d = Math.hypot(w.x - f.x, w.z - f.z);
            if (d > def.radius + w.def.radius + ADJACENT_REACH) continue;
            if (d < bd) { bd = d; sideTarget = w; }
          }
        }

        // A bomber ignores the fire and goes for what you BUILT. It leaves
        // the lane once something is in reach, which is what makes clustering
        // your line a liability rather than a strength.
        if (def.blast && f.fuseT <= 0) {
          let tgt = null, td = 15;
          for (const wd of this.wards) {
            if (wd.dead) continue;
            const d = Math.hypot(wd.x - f.x, wd.z - f.z);
            if (d < td) { td = d; tgt = wd; }
          }
          if (tgt) {
            f.blastTarget = tgt;
            const bx = tgt.x - f.x, bz = tgt.z - f.z;
            const bl = Math.hypot(bx, bz) || 1;
            if (bl > def.radius + tgt.def.radius + 0.4) {
              f.x += (bx / bl) * spd * dt;
              f.z += (bz / bl) * spd * dt;
              f.targetKind = null;
            } else {
              f.fuseT = def.blast.fuse;      // lit, and committed
              this.emit({ type: 'fuse', x: f.x, z: f.z });
            }
            continue;                       // never falls through to the lane
          }
        }

        // A SLINGER stops short and shoots. This is the one foe a blockade
        // does not actually stop: the wall halts its advance and the arrows
        // carry on regardless. It picks whatever is nearest and in reach —
        // the wall in its way, the fire, or you.
        if (def.ranged) {
          const shot = this._rangedTarget(f, def.ranged.range);
          if (shot) {
            f.targetKind = shot.kind;
            f.target = shot.ward || null;
            f.standing = true;
            // BACKS AWAY if you close on it. An archer that lets you walk up
            // and kill it is not a back rank, it is a slow melee goblin — the
            // threat is that reaching it costs you the time you are not
            // spending on the screen in front of it.
            const ka = def.ranged.keepAway;
            if (ka && p.alive && dPlayer < ka) {
              const bx = f.x - p.x, bz = f.z - p.z;
              const bl = Math.hypot(bx, bz) || 1;
              f.x += (bx / bl) * spd * 0.85 * dt;
              f.z += (bz / bl) * spd * 0.85 * dt;
            }
          } else {
            f.standing = false;
          }
        }

        const atStone = f.dist >= f.lane.total - stoneStandoff(def);
        if (def.blast && atStone && f.fuseT <= 0) {
          f.fuseT = def.blast.fuse;
          f.blastTarget = null;
          this.emit({ type: 'fuse', x: f.x, z: f.z });
          continue;
        }
        if (returning) {
          const rx = q.x - f.x, rz = q.z - f.z;
          const rl = Math.hypot(rx, rz) || 1;
          f.x += (rx / rl) * spd * dt;
          f.z += (rz / rl) * spd * dt;
          f.targetKind = null;
        } else if (f.standing) {
          // held in place by its own firing line
        } else if (chasing && !blocked) {
          // walk at the player directly, in world space, off the lane
          const cx = p.x - f.x, cz = p.z - f.z;
          const cl = Math.hypot(cx, cz) || 1;
          const r = World.slide(f.x, f.z, f.x + (cx / cl) * spd * dt, f.z + (cz / cl) * spd * dt);
          f.x = r.x; f.z = r.z;
          f.targetKind = null;
        } else if (planted) {
          // PLANTED. In reach of the player, or committed to a windup: stand
          // where you are and land the blow.
          //
          // Without this it fell through to the lane branch below, which does
          // `f.x = q.x; f.z = q.z` — it SNAPS back onto the polyline. So a foe
          // closed on you, came into reach, was teleported back to its lane on
          // that very frame and walked on. `hitPlayer` went false again, it
          // chased, reached you, snapped back... over and over.
          //
          // Reported as "they come at me but don't actually hit me", and that
          // is exactly what it was: 348 windups at the player over 150 seconds
          // produced 15 blows. The windup was real and the animation played;
          // the foe just was not there any more when it finished.
          if (hitPlayer) f.targetKind = null;
        } else if (!blocked && !atStone) {
          f.dist += spd * dt;
          // Drift across the track. A lane foe held ONE lateral offset for its
          // whole life, so a wave came down the road in rigid parallel columns.
          // This is the DERIVATIVE of a sine, integrated onto the offset, so
          // each foe genuinely wanders instead of holding a line — and because
          // it only ever touches the lateral offset, lane progress and arrival
          // timing are untouched.
          const w = Math.cos(this.t * WANDER_RATE * 6.283 + f.wph);
          f.off += w * WANDER_AMT * WANDER_RATE * 6.283 * dt;
          const lh = World.laneHalf(f);
          if (f.off > lh) f.off = lh; else if (f.off < -lh) f.off = -lh;
          const nq = laneAt(f.lane, f.dist, f.off);
          f.x = nq.x; f.z = nq.z;
          f.targetKind = null;
        } else {
          f.targetKind = blocked ? 'ward' : 'stone';
          f.target = blocked;
        }
      }

      // --- strike. A windup runs BEFORE the blow so there is something to
      // read and react to; the damage lands when the windup completes.
      // A ward it is merely walking past is a target of opportunity: only if
      // it has nothing better to do, and it never stops for it.
      if (sideTarget && !hitPlayer && !f.targetKind) {
        f.targetKind = 'ward';
        f.target = sideTarget;
      }
      if (f.atkCd <= 0 && f.windT <= 0 &&
          (hitPlayer || f.targetKind === 'ward' || f.targetKind === 'stone')) {
        f.windT = def.windup || AGGRO.windup;
        f.windAt = hitPlayer ? 'player' : f.targetKind;
        this.emit({ type: 'windup', x: f.x, y: f.y, z: f.z, foe: f.kind, at: f.windAt });
      }
      if (f.strikeT > 0) f.strikeT -= dt;
      f.swingK = World.swingPhase(f);   // published for the renderer
      if (f.windT > 0) {
        f.windT -= dt;
        if (f.windT > 0) continue;         // still winding up
        f.atkCd = 0;                       // the blow lands now
        // The blow itself was instantaneous, so there was nothing to SEE: the
        // windup ended and damage appeared. This is the follow-through the
        // renderer swings the weapon through.
        f.strikeT = STRIKE_TIME;
      }
      if (f.atkCd <= 0 && def.ranged && f.standing) {
        this._fireFoeBolt(f, def);
        f.atkCd = def.attackCd;
        this.emit({ type: 'foeSwing', x: f.x, y: f.y, z: f.z, at: f.targetKind });
      } else if (f.atkCd <= 0) {
        if (hitPlayer) {
          this.hurtPlayer(def.playerDamage);
          f.atkCd = def.attackCd;
          this.emit({ type: 'foeSwing', x: f.x, y: f.y, z: f.z, at: 'player' });
        } else if (f.targetKind === 'ward' && f.target && !f.target.dead) {
          // a maul is built to wreck WALLS, not everything you own
          const mul = (def.siegeMul && f.target.def.kind === 'blockade') ? def.siegeMul : 1;
          this.hurtWard(f.target, def.damage * mul);
          f.atkCd = def.attackCd;
          this.emit({ type: 'foeSwing', x: f.x, y: f.y, z: f.z, at: 'ward' });
        } else if (f.targetKind === 'stone') {
          this.hurtStone(def.damage, f.kind);
          f.atkCd = def.attackCd;
          this.emit({ type: 'foeSwing', x: f.x, y: f.y, z: f.z, at: 'stone' });
        }
      }
    }
  }

  // The hall runs the PLAYER and nothing else. Everything the body owns still
  // ticks — cooldowns, energy, the melee state machine, the jump — because the
  // whole reason to have a room is to be the same character in it.
  _stepHall(dt) {
    const p = this.player;
    this._dt = dt;
    // The sweep and the aim snap both go through the spatial hash, and only
    // step() ever filled it — so in the hall the sword swept an empty index and
    // the pells could not be hit at all. Reported as "targeting the dummies
    // feels off", and it was not the targeting: it was that nothing was there.
    this.foeHash.clear();
    for (const f of this.foes) if (!f.dead) this.foeHash.add(f);
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.swapT > 0) p.swapT -= dt;
    if (p.swingT > 0) p.swingT -= dt;
    if (p.dodgeCd > 0) p.dodgeCd -= dt;
    if (p.abilityCd > 0) p.abilityCd -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    // The ROLL, driven exactly as step() drives it. The hall was decrementing
    // the timer and never moving the body, so a roll played its animation on
    // the spot — reported as "dodge roll doesn't work correctly there". A
    // practice room where a move behaves differently is worse than no practice
    // room, because what you learn in it is wrong.
    if (p.dodgeT > 0) {
      p.dodgeT -= dt;
      this.movePlayer(p.dodgeX * PLAYER.dodge.speed, p.dodgeZ * PLAYER.dodge.speed, dt);
    }
    this._stepMelee(dt);
    this._stepJump(dt);
    this._stepEnergy(dt);
    // the pell's hit flash and the combo readout it exists to teach
    const q = this.pell;
    if (q && q.comboT > 0) { q.comboT -= dt; if (q.comboT <= 0) q.combo = 0; }
    // inert foes still need their hit flash ticked down
    for (const f of this.foes) if (f.hitT > 0) f.hitT -= dt;
  }

  // Move from (x0,z0) toward (nx,nz), refusing to climb.
  //
  // Up is gated by a ramp, down is free. When the straight move is refused it
  // is retried on each axis alone, which makes a body SLIDE along the foot of a
  // terrace instead of standing still against it — and because it keeps
  // pressing toward its goal, sliding walks it round to a ramp. That is the
  // whole reason terraces funnel: they are chokepoints with a view.
  static slide(x0, z0, nx, nz) {
    if (canStep(x0, z0, nx, nz)) return { x: nx, z: nz };
    if (canStep(x0, z0, nx, z0)) return { x: nx, z: z0 };
    if (canStep(x0, z0, x0, nz)) return { x: x0, z: nz };
    return { x: x0, z: z0 };
  }

  // How far off its lane's centre this foe may sit, where it currently is.
  // One place, because the spawn spread, the separation fold and the pinch
  // squeeze all have to agree or a foe pops across the lane between them.
  static laneHalf(f) {
    return Math.max(0, widthAt(f.lane, f.dist) / 2 - f.def.radius - 0.15);
  }

  // The whole swing as a single 0..1 number, so the renderer never has to
  // re-derive it from three timers and get it subtly different.
  //   0.00 - 0.45  winding up (the readable part)
  //   0.45 - 1.00  the blow and its follow-through
  static swingPhase(f) {
    const wu = f.def.windup || AGGRO.windup;
    if (f.windT > 0) return (1 - f.windT / wu) * 0.45;
    if (f.strikeT > 0) return 0.45 + (1 - f.strikeT / STRIKE_TIME) * 0.55;
    return 0;
  }

  // What a ranged foe can shoot from where it stands. Nearest first, and it
  // will happily shoot the wall in front of it — that is the whole point of it.
  // A foe's arrow. Homes gently on what it was aimed at, exactly like a ward's
  // bolt does, so a slinger that loses its target mid-flight simply misses.
  _fireFoeBolt(f, def) {
    const t = f.targetKind === 'ward' ? f.target
      : (f.targetKind === 'player' ? this.player : this.stone);
    if (!t) return;
    const ty = f.targetKind === 'player' ? 1.1 : 1.0;
    const dx = t.x - f.x, dy = ty - (f.y + def.height * 0.6), dz = t.z - f.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    this.projectiles.push({
      id: NEXT_ID++, source: 'foe',
      x: f.x, y: f.y + def.height * 0.6, z: f.z,
      dx: dx / d, dy: dy / d, dz: dz / d,
      speed: def.ranged.speed,
      damage: f.targetKind === 'player' ? def.playerDamage : def.damage,
      radius: def.ranged.radius,
      foeTarget: t, targetKind: f.targetKind,
      life: def.ranged.range / def.ranged.speed + 0.6,
      dead: false, target: null,
    });
    this.emit({ type: 'foeBolt', x: f.x, y: f.y + def.height * 0.6, z: f.z });
  }

  _rangedTarget(f, range) {
    const p = this.player;
    let best = null, bd = range;
    if (p.alive) {
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d < bd) { bd = d; best = { kind: 'player' }; }
    }
    for (const w of this.wards) {
      if (w.dead || w.def.kind === 'field') continue;   // nothing to shoot at
      const d = Math.hypot(w.x - f.x, w.z - f.z);
      if (d < bd) { bd = d; best = { kind: 'ward', ward: w }; }
    }
    const ds = Math.hypot(f.x, f.z);
    if (ds < bd) { bd = ds; best = { kind: 'stone' }; }
    return best;
  }
  // Crowd separation.
  //
  // Ground foes had NONE, so bodies walked straight through one another — a
  // Bruiser is 0.8m across and a Breaker 1.15m, and they overlapped freely.
  // Reported as "they clip a ton", and it was.
  //
  // It was tried before as a plain positional push and backed out, because it
  // measured as a BALANCE dial rather than a visual one: at full strength the
  // glade became a walkover and the gauntlet fell 16/21 -> 10/21, and a crowd
  // pressed against the fire got shoved OFF the objective, which let an
  // air-heavy ring win unattended.
  //
  // The reason was never separation itself — it was that a free push moves a
  // foe ALONG its lane, or away from the thing it is attacking, and both of
  // those are the quantities the balance is made of. So the push is now
  // projected onto the one axis that carries no balance information:
  //
  //   walking a lane  -> push only ACROSS the lane. Lane progress is untouched,
  //                      so arrival timing is bit-for-bit what it was.
  //   engaged         -> push only PERPENDICULAR to the line to its target, so
  //                      a crowd spreads around the fire at constant range
  //                      instead of being pushed off it.
  //
  // Bodies stop overlapping; nothing that decides a fight moves.
  _separate(dt) {
    const near = this._scratch;
    for (const f of this.foes) {
      if (f.dead) continue;
      this.foeHash.query(f.x, f.z, f.def.radius * 2 + 0.6, near);
      let px = 0, pz = 0;
      for (let n = 0; n < near.length; n++) {
        const g = near[n];
        // Fliers separate from fliers and walkers from walkers, never across:
        // a wisp four metres up has no business shoving a goblin.
        if (g === f || g.dead || g.def.flying !== f.def.flying) continue;
        const dx = f.x - g.x, dz = f.z - g.z;
        const d = Math.hypot(dx, dz);
        const want = (f.def.radius + g.def.radius) *
          (f.def.flying ? FLIER_SEPARATION : SEPARATION);
        if (d >= want) continue;
        if (d < 1e-4) {            // exactly coincident: break the tie by id
          px += (f.id % 2 ? 1 : -1) * 0.02;
          pz += (f.id % 3 ? 1 : -1) * 0.02;
          continue;
        }
        const push = (want - d) * 0.5;
        px += (dx / d) * push;
        pz += (dz / d) * push;
      }
      if (px === 0 && pz === 0) continue;
      const cap = f.def.speed * dt * 1.5;          // never out-runs its own walk
      const pl = Math.hypot(px, pz);
      if (pl > cap) { px = px / pl * cap; pz = pz / pl * cap; }

      if (f.def.flying) {
        // Wisps converge on one point by design, so without this an entire
        // flock arrives as a single overlapping blob at the standoff ring —
        // which is also why their additive glows summed to a white smear.
        f.x += px; f.z += pz;
        // Height is where a flock gets its spread, not width. Auras key on
        // HORIZONTAL distance, so stacking wisps vertically separates them to
        // the eye while changing nothing about which towers can reach them.
        const wantY = f.def.flyHeight + ((f.id % 7) - 3) * 0.42;
        f.y += (wantY - f.y) * Math.min(1, dt * 1.5);
        continue;
      }

      // --- ground: strip the component that would change a balance quantity
      // A crowd already on the objective presses and does not spread. Letting
      // it fan out around the fire measurably handed the game to an air-heavy
      // ring on the gauntlet — the spread put more bodies inside more auras for
      // longer. Foes at the fire are also the ones you can least afford to be
      // "tidy" about: they should look like a scrum.
      if (f.targetKind === 'stone') continue;
      const tgt = f.targetKind === 'ward' && f.target && !f.target.dead ? f.target : null;
      let ax, az;                                   // the axis to REMOVE
      if (tgt) {
        ax = tgt.x - f.x; az = tgt.z - f.z;         // keep range to the target
      } else {
        const q = laneAt(f.lane, f.dist, f.off);
        ax = q.dx; az = q.dz;                       // keep progress along the lane
      }
      const al = Math.hypot(ax, az) || 1;
      ax /= al; az /= al;
      const along = px * ax + pz * az;
      px -= ax * along;
      pz -= az * along;

      if (tgt) {
        f.x += px; f.z += pz;                       // slides around it, not off it
      } else {
        // fold the sideways push into the lane offset so it survives the next
        // laneAt, and stays inside the lane it belongs to
        const nx = az, nz = -ax;                    // left normal of the tangent
        const lat = px * nx + pz * nz;
        const half = World.laneHalf(f);
        f.off = Math.max(-half, Math.min(half, f.off + lat));
      }
    }
  }

  _pickTarget(w, near) {
    // "First" policy: the foe furthest along its lane, i.e. nearest to losing
    // us the stone. Fliers have no lane distance, so use proximity to origin.
    let best = null, bestScore = -Infinity;
    for (let n = 0; n < near.length; n++) {
      const f = near[n];
      if (f.dead) continue;
      if (w.def.targets === 'ground' && f.def.flying) continue;
      const d = Math.hypot(f.x - w.x, f.z - w.z);
      if (d > w.def.range) continue;
      const score = f.def.flying
        ? 400 - Math.hypot(f.x, f.z)
        : f.dist;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  // Overlapping AURAS give diminishing returns. Linear stacking meant the
  // dominant strategy was to blanket one point rather than cover ground — and
  // since every wisp converges on the fire, a ring of watchtowers there was a
  // complete answer to the air with no player at all. Coverage is what units
  // are supposed to buy; stacking must not be a way around them.
  static AURA_FALLOFF = [1, 0.34, 0.15, 0.07];

  _stepWards(dt) {
    const near = this._scratch;
    for (let i = 0; i < this.foes.length; i++) this.foes[i]._auraN = 0;
    for (const w of this.wards) {
      if (w.dead) continue;
      const def = w.def;
      if (w.buildT > 0) {
        const was = w.buildT;
        w.buildT -= dt;
        // hit points come up with the frame, from a quarter to full
        const k = 1 - Math.max(0, w.buildT) / w.buildTotal;
        w.hp = Math.min(w.maxHp, Math.max(w.hp, w.maxHp * (0.25 + 0.75 * k)));
        if (was > 0 && w.buildT <= 0) {
          w.buildT = 0;
          this.emit({ type: 'built', x: w.x, z: w.z, ward: def.id });
        }
        continue;                     // no shooting from a half-built ward
      }
      if (def.kind === 'blockade') continue;

      if (def.kind === 'field') {
        // Persistent, no cooldown, almost no damage — its whole output is the
        // slow. Refreshed every step while you stand in it, decays when you
        // leave, so a foe drags out of it rather than snapping back to speed.
        this.foeHash.query(w.x, w.z, def.range, near);
        for (let n = 0; n < near.length; n++) {
          const f = near[n];
          if (f.dead || f.def.flying) continue;
          if (Math.hypot(f.x - w.x, f.z - w.z) > def.range) continue;
          f.slowT = 0.45;
          f.slowK = def.slow;
          if (def.dps) this.hurtFoe(f, def.dps * w.power * dt, 'ward');
        }
        continue;
      }

      if (def.kind === 'aura') {
        // No targeting at all — it just burns whatever is standing in it.
        this.foeHash.query(w.x, w.z, def.range, near);
        for (let n = 0; n < near.length; n++) {
          const f = near[n];
          if (f.dead) continue;
          if (Math.hypot(f.x - w.x, f.z - w.z) > def.range) continue;
          // Upgrades do NOT scale anti-air. This is load-bearing: defence
          // units cap COVERAGE, but upgrades multiply POWER inside it — and
          // for the sky coverage was never the constraint, because every wisp
          // converges on the fire. Measured: with upgrades scaling air, a ring
          // of levelled watchtowers won the whole game with the player stood
          // still, which is the exact failure the unit budget exists to
          // prevent. More arrows do not make hitting a darting light easier.
          // Upgrades do NOT scale an aura, on the ground or in the air.
          // Measured: the "air-heavy" build spends all 32 units on watchtowers
          // ringing the fire, keeps NO walls at all, and still barely leaks
          // ground foes — because a levelled, stacked aura at the one point
          // every foe converges on is a meat grinder for everything, and it
          // won the whole game with nobody playing. Upgrades scale wards that
          // pick a target; area denial is bought with UNITS, which are capped.
          const flying = f.def.flying && def.airMul != null;
          const power = 1;
          const airK = flying ? def.airMul : 1;
          const fo = World.AURA_FALLOFF;
          const stack = fo[Math.min(f._auraN || 0, fo.length - 1)];
          f._auraN = (f._auraN || 0) + 1;
          this.hurtFoe(f, def.dps * power * airK * stack *
            dt, 'ward');
        }
        continue;
      }

      const rate = 1;
      if (w.cd > 0) w.cd -= dt * rate;

      if (def.kind === 'trap') {
        if (w.cd > 0) continue;
        this.foeHash.query(w.x, w.z, def.range, near);
        let any = false;
        for (let n = 0; n < near.length; n++) {
          const f = near[n];
          if (f.dead || f.def.flying) continue;
          if (Math.hypot(f.x - w.x, f.z - w.z) <= def.range) { any = true; break; }
        }
        if (!any) continue;
        for (let n = 0; n < near.length; n++) {
          const f = near[n];
          if (f.dead || f.def.flying) continue;
          if (Math.hypot(f.x - w.x, f.z - w.z) <= def.range) {
            this.hurtFoe(f, def.damage * w.power, 'ward');
          }
        }
        w.cd = def.cooldown;
        this.emit({ type: 'snare', x: w.x, z: w.z, r: def.range });
        continue;
      }

      if (def.kind === 'projectile') {
        // Retarget on a timer, not every frame — 120 foes x N wards every
        // frame is the one place this sim could actually get expensive.
        w.retarget -= dt;
        const wRange = this.wardRange(w);
        if (w.retarget <= 0 || !w.target || w.target.dead ||
            Math.hypot(w.target.x - w.x, w.target.z - w.z) > wRange) {
          this.foeHash.query(w.x, w.z, wRange, near);
          w.target = this._pickTarget(w, near);
          w.retarget = 0.2;
        }
        if (w.cd <= 0 && w.target && !w.target.dead) {
          const t = w.target;
          const dx = t.x - w.x, dz = t.z - w.z, dy = (t.y + 0.7) - 1.4;
          const d = Math.hypot(dx, dy, dz) || 1;
          this.projectiles.push({
            id: NEXT_ID++, source: 'ward',
            x: w.x, y: 1.4, z: w.z,
            // where it was fired FROM, so a shield can tell a bolt coming at
            // its face from one arriving in its back
            ox: w.x, oz: w.z,
            dx: dx / d, dy: dy / d, dz: dz / d,
            speed: def.projSpeed, damage: def.damage * w.power, radius: def.projRadius,
            target: t, life: 3, dead: false,
            // how many bodies this bolt can still punch through
            pierce: this.wardPierce(w), hit: null,
          });
          w.cd = this.wardCooldown(w);
          this.emit({ type: 'shoot', x: w.x, z: w.z, ward: def.id });
        }
      }
    }
  }

  _stepProjectiles(dt) {
    const near = this._scratch;
    for (const b of this.projectiles) {
      if (b.dead) continue;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }

      // Home only if a target was acquired at fire time. A bolt fired at
      // nothing flies straight and misses, which is the point of aim assist
      // being a cone rather than a magnet.
      if (b.source === 'foe' && b.foeTarget) {
        const t = b.foeTarget;
        const alive = b.targetKind === 'player' ? this.player.alive
          : (b.targetKind === 'ward' ? !t.dead : true);
        if (alive) {
          const ty = b.targetKind === 'player' ? 1.1 : 1.0;
          const dx = t.x - b.x, dy = ty - b.y, dz = t.z - b.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          const turn = Math.min(1, dt * 7);
          b.dx += (dx / d - b.dx) * turn;
          b.dy += (dy / d - b.dy) * turn;
          b.dz += (dz / d - b.dz) * turn;
          const l = Math.hypot(b.dx, b.dy, b.dz) || 1;
          b.dx /= l; b.dy /= l; b.dz /= l;
        }
      } else if (b.target && !b.target.dead) {
        const t = b.target;
        const dx = t.x - b.x, dy = (t.y + t.def.height * 0.5) - b.y, dz = t.z - b.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const turn = Math.min(1, dt * 9);
        b.dx += (dx / d - b.dx) * turn;
        b.dy += (dy / d - b.dy) * turn;
        b.dz += (dz / d - b.dz) * turn;
        const l = Math.hypot(b.dx, b.dy, b.dz) || 1;
        b.dx /= l; b.dy /= l; b.dz /= l;
      }

      b.x += b.dx * b.speed * dt;
      b.y += b.dy * b.speed * dt;
      b.z += b.dz * b.speed * dt;
      if (b.y < 0.05) b.y = 0.05;

      if (b.source === 'player' && this.caches.length) {
        let struck = false;
        for (const c of this.caches) {
          if (c.dead) continue;
          if (Math.hypot(c.x - b.x, c.z - b.z) > 1.0 + b.radius) continue;
          if (b.y > 1.9) continue;
          this.hurtCache(c, b.damage);
          b.dead = true;
          this.emit({ type: 'impact', x: b.x, y: b.y, z: b.z, source: b.source });
          struck = true;
          break;
        }
        if (struck) continue;
      }

      if (b.source === 'foe') {
        const t = b.foeTarget;
        if (!t) { b.dead = true; continue; }
        const reach = b.radius + (b.targetKind === 'player' ? 0.7 : 0.9);
        if (Math.hypot(t.x - b.x, t.z - b.z) < reach) {
          if (b.targetKind === 'player') this.hurtPlayer(b.damage);
          else if (b.targetKind === 'ward' && !t.dead) this.hurtWard(t, b.damage);
          else if (b.targetKind === 'stone') this.hurtStone(b.damage, 'archer');
          b.dead = true;
          this.emit({ type: 'impact', x: b.x, y: b.y, z: b.z, source: 'foe' });
        }
        continue;                    // a foe's arrow never hits another foe
      }

      this.foeHash.query(b.x, b.z, b.radius + 1.4, near);
      for (let n = 0; n < near.length; n++) {
        const f = near[n];
        if (f.dead) continue;
        if (b.hit && b.hit.has(f.id)) continue;      // already punched through
        const dy = Math.abs((f.y + f.def.height * 0.5) - b.y);
        if (dy > f.def.height * 0.5 + b.radius) continue;
        if (Math.hypot(f.x - b.x, f.z - b.z) > f.def.radius + b.radius) continue;
        // A piercing bolt keeps going. It records who it has already hit so a
        // single shot cannot chew the same body twice on consecutive steps,
        // and it stops homing once it is through its first target — a bolt
        // that curved onto each new victim would be a seeking missile, not a
        // line through a rank.
        this.hurtFoe(f, b.damage, b.source, b.ox, b.oz);
        // a braced bolt SHOVES. It is the only ranged thing in the game that
        // moves a body, which is most of why it reads as heavier than a tap.
        if (b.knock) { f.x += b.dx * b.knock; f.z += b.dz * b.knock; }
        this.emit({ type: 'impact', x: b.x, y: b.y, z: b.z, source: b.source });
        if (b.pierce && b.pierce > 1) {
          b.pierce--;
          (b.hit || (b.hit = new Set())).add(f.id);
          b.target = null;
        } else {
          b.dead = true;
        }
        break;
      }
    }
  }

  _stepMotes(dt) {
    const p = this.player;
    // Motes only rot while a wave is running. Between waves the field keeps
    // what it dropped, so sweeping it is a real second job for the build phase
    // instead of the build phase being a menu you stand still in.
    const rotting = this.phase === 'combat';
    for (const m of this.motes) {
      if (rotting) m.life -= dt;
      if (m.taken || m.life <= 0) continue;
      if (!p.alive) continue;
      const dx = p.x - m.x, dz = p.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d < PLAYER.pickupRange) {
        const s = PLAYER.vacuumSpeed * dt;
        if (d <= s + 0.4) {
          m.taken = true;
          this.mana = Math.min(ECON.manaCap, this.mana + m.value);
          this.stats.manaEarned += m.value;
          this.emit({ type: 'mote', value: m.value });
        } else {
          m.x += (dx / d) * s;
          m.z += (dz / d) * s;
          m.y += (0.8 - m.y) * Math.min(1, dt * 6);
        }
      }
    }
  }

  // ---------------------------------------------------------------- readouts
  snapshot() {
    return {
      t: this.t, phase: this.phase, wave: this.waveIndex,
      timer: this.phaseTimer, mana: Math.floor(this.mana),
      stone: this.stone.hp, stoneMax: this.stone.maxHp,
      foes: this.foes.length, wards: this.wards.length,
      du: this.du, duMax: this.duBudget,
      hp: this.player.hp, alive: this.player.alive,
    };
  }
}

export { WARDS, WARD_BY_ID, LANES, cellOf, cellCenter, isBuildableCell };
