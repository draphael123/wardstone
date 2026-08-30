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
  PLAYER, WARDSTONE, ECON, WARDS, WARD_BY_ID, FOE_BY_ID, WAVES,
} from './defs.js';
import {
  LANES, LANE_BY_ID, laneAt, cellOf, cellCenter, cellKey,
  isBuildableCell, clampToArena,
} from './arena.js';
import { makeRng } from './rand.js';

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

let NEXT_ID = 1;

export class World {
  constructor(opts = {}) {
    this.rng = makeRng(opts.seed == null ? 12345 : opts.seed);
    // Sandbox freezes the wave machine so a directed test can spawn exactly
    // one foe and watch exactly one rule. See [[asserts-must-fit-the-thing-tested]].
    this.sandbox = !!opts.sandbox;
    this.t = 0;
    this.phase = 'build';        // build | combat | won | lost
    this.waveIndex = 0;          // index of the wave about to run / running
    this.phaseTimer = ECON.buildPhase;
    this.mana = ECON.startMana;
    this.du = 0;                 // spent Defence Units, capped at ECON.duBudget

    this.stone = { hp: WARDSTONE.hp, maxHp: WARDSTONE.hp, x: 0, z: 0 };

    this.player = {
      x: 0, z: 9, y: 0, yaw: Math.PI,
      hp: PLAYER.hp, maxHp: PLAYER.hp,
      alive: true, respawnT: 0,
      atkCd: 0, repairing: null, hurtT: 0,
      weapon: 'crossbow', swapT: 0, swingT: 0,
      dodgeT: 0, dodgeCd: 0, dodgeX: 0, dodgeZ: 0, invuln: 0,
    };

    this.foes = [];
    this.wards = [];
    this.projectiles = [];
    this.motes = [];
    this.occupancy = new Map();  // cellKey -> ward
    this.spawnQueue = [];
    this.events = [];

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
  }

  // ---------------------------------------------------------------- helpers
  emit(e) {
    this.events.push(e);
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
  }

  wardAtCell(i, j) { return this.occupancy.get(cellKey(i, j)) || null; }

  canBuild(wardId, i, j) {
    const def = WARD_BY_ID[wardId];
    if (!def) return { ok: false, why: 'no such ward' };
    if (!isBuildableCell(i, j)) return { ok: false, why: 'not buildable ground' };
    if (this.occupancy.has(cellKey(i, j))) return { ok: false, why: 'occupied' };
    if (this.du + def.du > ECON.duBudget) return { ok: false, why: 'no defence units' };
    if (this.mana < def.cost) return { ok: false, why: 'not enough mana' };
    return { ok: true, def };
  }

  build(wardId, i, j) {
    const c = this.canBuild(wardId, i, j);
    if (!c.ok) return null;
    const def = c.def;
    const p = cellCenter(i, j);
    const w = {
      id: NEXT_ID++, def, kind: def.kind, i, j,
      x: p.x, z: p.z,
      hp: def.hp, maxHp: def.hp,
      cd: 0, target: null, retarget: 0, dead: false,
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

  // ------------------------------------------------------------------ waves
  _startWave() {
    const wave = WAVES[this.waveIndex];
    if (!wave) { this.phase = 'won'; return; }
    this.spawnQueue.length = 0;
    for (const g of wave.groups) {
      for (let n = 0; n < g.count; n++) {
        this.spawnQueue.push({ t: this.t + g.at + n * g.gap, lane: g.lane, foe: g.foe });
      }
    }
    this.spawnQueue.sort((a, b) => a.t - b.t);
    this.phase = 'combat';
    this.emit({ type: 'wave', index: this.waveIndex, name: wave.name });
  }

  _spawn(laneId, foeId) {
    const lane = LANE_BY_ID[laneId];
    const def = FOE_BY_ID[foeId];
    if (!lane || !def) return;
    const half = lane.width / 2 - def.radius - 0.2;
    const f = {
      id: NEXT_ID++, def, kind: foeId,
      lane, dist: 0, off: this.rng.range(-half, half),
      x: 0, z: 0, y: def.flying ? def.flyHeight : 0,
      hp: def.hp, maxHp: def.hp,
      atkCd: this.rng.range(0, 0.4),
      target: null, targetKind: null, dead: false, hitT: 0,
      // fliers cut the corner: they take the straight line to the stone
      fx: 0, fz: 0,
    };
    const p = laneAt(lane, 0, f.off);
    f.x = p.x; f.z = p.z;
    this.foes.push(f);
    this.stats.spawned[foeId] = (this.stats.spawned[foeId] || 0) + 1;
    this.emit({ type: 'spawn', x: f.x, z: f.z, foe: foeId, lane: laneId });
  }

  // ------------------------------------------------------------------ damage
  hurtFoe(f, amount, source) {
    if (f.dead) return 0;
    const dealt = Math.min(f.hp, amount);
    f.hp -= dealt;
    // Only DISCRETE hits flash. An aura deals dps*dt every step, so refreshing
    // the flash unconditionally left anything standing in a brazier — reliably
    // the breaker, the one foe whose colour matters most — permanently white
    // and unidentifiable. A bolt is 26, an aura tick is 0.4.
    if (dealt > 4) f.hitT = 0.1;
    if (source === 'player' && dealt > 0) {
      this.emit({ type: 'dmg', x: f.x, y: f.y + f.def.height * 0.8, z: f.z, amount: dealt });
    }
    const bucket = this.stats.dmgToFoeBy[source];
    if (bucket) bucket[f.kind] = (bucket[f.kind] || 0) + dealt;
    if (f.hp <= 0) this._killFoe(f, source);
    return dealt;
  }

  _killFoe(f, by) {
    if (f.dead) return;
    f.dead = true;
    this.stats.kills[f.kind] = (this.stats.kills[f.kind] || 0) + 1;
    // Mana does not teleport into your pocket. It lands where the foe died and
    // has to be walked over — this is the whole reason the player leaves cover.
    this.motes.push({
      id: NEXT_ID++, x: f.x, z: f.z, y: f.def.flying ? f.y : 0.6,
      value: f.def.bounty, life: 35, taken: false, vx: 0, vz: 0,
    });
    this.emit({
      type: 'kill', x: f.x, y: f.y, z: f.z, foe: f.kind,
      by: by || 'ward', withWeapon: by === 'player' ? this.player.weapon : null,
    });
  }

  hurtWard(w, amount) {
    if (w.dead) return;
    w.hp -= amount;
    if (w.hp <= 0) {
      w.dead = true;
      this.du -= w.def.du;      // a ruined ward frees its units to rebuild
      this.occupancy.delete(cellKey(w.i, w.j));
      this.stats.wardLosses++;
      this.emit({ type: 'wardDown', x: w.x, z: w.z, ward: w.def.id });
    }
  }

  hurtPlayer(amount) {
    const p = this.player;
    if (!p.alive) return;
    if (p.invuln > 0) return;         // rolling through it
    p.hp -= amount;
    p.hurtT = 0.25;
    this.emit({ type: 'playerHurt', amount });
    if (p.hp <= 0) {
      p.alive = false;
      p.hp = 0;
      p.respawnT = PLAYER.respawn;
      this.stats.playerDeaths++;
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
    if (!p.alive || p.atkCd > 0 || p.swapT > 0) return null;
    return this.weaponDef(p).kind === 'melee'
      ? this._melee(dirx, dirz)
      : this.fireBolt(dirx, dirz, diry);
  }

  // A sweep, not a projectile: everything on the ground inside the arc is hit
  // at once. That is what makes it worth standing in the brawl.
  _melee(dirx, dirz) {
    const p = this.player;
    const def = PLAYER.weapons.sword;
    const len = Math.hypot(dirx, dirz) || 1;
    const ux = dirx / len, uz = dirz / len;
    p.atkCd = def.cooldown;
    p.swingT = 0.18;
    p.yaw = Math.atan2(ux, uz);

    const near = this._scratch;
    this.foeHash.query(p.x, p.z, def.range + 1.5, near);
    const cosHalf = Math.cos(def.arc / 2);
    let hits = 0;
    for (let n = 0; n < near.length; n++) {
      const f = near[n];
      if (f.dead || f.def.flying) continue;          // cannot reach the air
      const dx = f.x - p.x, dz = f.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > def.range + f.def.radius) continue;
      if (d > 0.001 && (dx * ux + dz * uz) / d < cosHalf) continue;
      this.hurtFoe(f, def.damage, 'player');
      hits++;
    }
    this.emit({ type: 'swing', x: p.x, z: p.z, dx: ux, dz: uz, hits });
    return hits;
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
    p.dodgeCd = PLAYER.dodge.cooldown;
    p.invuln = PLAYER.dodge.iframes;
    this.emit({ type: 'dodge', x: p.x, z: p.z, dx: ux, dz: uz });
    return true;
  }

  fireBolt(dirx, dirz, diry) {
    const p = this.player;
    const wd = PLAYER.weapons.crossbow;
    if (!p.alive || p.atkCd > 0) return null;
    p.atkCd = wd.cooldown;

    // Aim assist: snap to the nearest foe inside a narrow cone. Without this,
    // hitting a 0.5m wisp at 4m altitude with a mouse is miserable.
    let best = null, bestD = Infinity;
    const len = Math.hypot(dirx, dirz, diry || 0) || 1;
    const ux = dirx / len, uz = dirz / len, uy = (diry || 0) / len;
    for (const f of this.foes) {
      if (f.dead) continue;
      const vx = f.x - p.x, vy = (f.y + f.def.height * 0.5) - (p.y + 1.2), vz = f.z - p.z;
      const d = Math.hypot(vx, vy, vz);
      if (d > wd.range || d < 0.001) continue;
      const dot = (vx * ux + vy * uy + vz * uz) / d;
      if (dot > PLAYER.aimCone && d < bestD) { bestD = d; best = f; }
    }

    const b = {
      id: NEXT_ID++, source: 'player',
      x: p.x, y: p.y + 1.2, z: p.z,
      dx: ux, dy: uy, dz: uz,
      speed: wd.speed, damage: wd.damage,
      radius: wd.radius, target: best, life: wd.range / wd.speed,
      dead: false,
    };
    this.projectiles.push(b);
    this.emit({ type: 'bolt', x: b.x, y: b.y, z: b.z });
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
    let nx = p.x + vx * dt, nz = p.z + vz * dt;
    const c = clampToArena(nx, nz, PLAYER.radius);
    nx = c.x; nz = c.z;

    // Wards are solid. Push out of any we ended up inside — a simple circle
    // resolve is enough because everything is a disc on a 2m grid.
    for (const w of this.wards) {
      if (w.dead) continue;
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
  step(dt) {
    if (this.phase === 'won' || this.phase === 'lost') return;
    this.t += dt;

    const p = this.player;
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;
    if (p.swapT > 0) p.swapT -= dt;
    if (p.swingT > 0) p.swingT -= dt;
    if (p.dodgeCd > 0) p.dodgeCd -= dt;
    if (p.invuln > 0) p.invuln -= dt;
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
    this._stepMotes(dt);

    // ---- cull
    if (this.foes.some(f => f.dead)) this.foes = this.foes.filter(f => !f.dead);
    if (this.wards.some(w => w.dead)) this.wards = this.wards.filter(w => !w.dead);
    if (this.projectiles.some(b => b.dead)) this.projectiles = this.projectiles.filter(b => !b.dead);
    if (this.motes.some(m => m.taken || m.life <= 0)) {
      this.motes = this.motes.filter(m => !m.taken && m.life > 0);
    }

    // ---- wave end
    if (!this.sandbox && this.phase === 'combat' && !this.spawnQueue.length && !this.foes.length) {
      this.stats.wavesCleared++;
      const bonus = 60 + 20 * this.waveIndex;
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

      // --- who am I hitting?
      // The player outranks a ward: standing in a lane has to cost something,
      // or the safe play is to park on top of the palisade and hold repair.
      let hitPlayer = false;
      if (p.alive) {
        const d = Math.hypot(p.x - f.x, p.z - f.z);
        const dy = Math.abs((p.y + 0.9) - f.y);
        if (d < def.radius + PLAYER.radius + 1.3 && dy < 3.2) hitPlayer = true;
      }

      if (def.flying) {
        // Fliers ignore lanes and blockades entirely. This is the gap the
        // player exists to fill; do not "fix" it by pathing them.
        const dx = -f.x, dz = -f.z;
        const d = Math.hypot(dx, dz) || 1;
        const stop = stoneStandoff(def);
        f.y += ((def.flyHeight) - f.y) * Math.min(1, dt * 2);
        if (d > stop) {
          f.x += (dx / d) * def.speed * dt;
          f.z += (dz / d) * def.speed * dt;
          f.targetKind = null;
        } else {
          f.targetKind = 'stone';
        }
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
          if (w.dead) continue;
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

        const atStone = f.dist >= f.lane.total - stoneStandoff(def);
        if (!blocked && !atStone) {
          f.dist += def.speed * dt;
          const q = laneAt(f.lane, f.dist, f.off);
          f.x = q.x; f.z = q.z;
          f.targetKind = null;
        } else {
          f.targetKind = blocked ? 'ward' : 'stone';
          f.target = blocked;
        }
      }

      // --- strike
      if (f.atkCd <= 0) {
        if (hitPlayer) {
          this.hurtPlayer(def.playerDamage);
          f.atkCd = def.attackCd;
          this.emit({ type: 'foeSwing', x: f.x, y: f.y, z: f.z, at: 'player' });
        } else if (f.targetKind === 'ward' && f.target && !f.target.dead) {
          this.hurtWard(f.target, def.damage);
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

  _stepWards(dt) {
    const near = this._scratch;
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

      if (def.kind === 'aura') {
        // No targeting at all — it just burns whatever is standing in it.
        this.foeHash.query(w.x, w.z, def.range, near);
        for (let n = 0; n < near.length; n++) {
          const f = near[n];
          if (f.dead) continue;
          if (Math.hypot(f.x - w.x, f.z - w.z) > def.range) continue;
          this.hurtFoe(f, def.dps * dt, 'ward');
        }
        continue;
      }

      if (w.cd > 0) w.cd -= dt;

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
            this.hurtFoe(f, def.damage, 'ward');
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
        if (w.retarget <= 0 || !w.target || w.target.dead ||
            Math.hypot(w.target.x - w.x, w.target.z - w.z) > def.range) {
          this.foeHash.query(w.x, w.z, def.range, near);
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
            dx: dx / d, dy: dy / d, dz: dz / d,
            speed: def.projSpeed, damage: def.damage, radius: def.projRadius,
            target: t, life: 3, dead: false,
          });
          w.cd = def.cooldown;
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
      if (b.target && !b.target.dead) {
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

      this.foeHash.query(b.x, b.z, b.radius + 1.4, near);
      for (let n = 0; n < near.length; n++) {
        const f = near[n];
        if (f.dead) continue;
        const dy = Math.abs((f.y + f.def.height * 0.5) - b.y);
        if (dy > f.def.height * 0.5 + b.radius) continue;
        if (Math.hypot(f.x - b.x, f.z - b.z) > f.def.radius + b.radius) continue;
        this.hurtFoe(f, b.damage, b.source);
        b.dead = true;
        this.emit({ type: 'impact', x: b.x, y: b.y, z: b.z, source: b.source });
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
      du: this.du, duMax: ECON.duBudget,
      hp: this.player.hp, alive: this.player.alive,
    };
  }
}

export { WARDS, WARD_BY_ID, LANES, cellOf, cellCenter, isBuildableCell };
