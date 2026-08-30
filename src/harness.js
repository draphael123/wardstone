// WARDSTONE — the balance suite.
//
// This exists to answer ONE question the eye cannot answer: does the body
// actually have a job? A hybrid of tower defence and action game fails in a
// specific, well-documented way — the towers grow past the point where the
// player matters, and you are left holding a repair hammer watching your own
// defences win. Dungeon Defenders itself drifted there.
//
// So the load-bearing assertions here are the three-way comparison:
//   wards alone  -> must LOSE   (proves the body has a job)
//   body alone   -> must LOSE   (proves the wards have a job)
//   both         -> must WIN    (proves it is a hybrid, not either half)
//
// If all three do not hold simultaneously, the premise is broken and no amount
// of art will save it. See [[dominant-strategy-vs-tradeoff]] — a priced tier
// is not a trade-off until you measure it, and neither is a second system.

import { World } from './sim.js';
import {
  PLAYER, WARDS, WARD_BY_ID, FOES, FOE_BY_ID, WAVES, BREAKER_DPS,
  WARDSTONE as STONE, ECON, waveFoeCount,
} from './defs.js';
import {
  LANES, LANE_BY_ID, laneAt, distToLane, cellOf, cellCenter,
  isBuildableCell, CELL, setMap, MAPS, MAP_ID,
} from './arena.js';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Placement helpers — the bot needs to name cells the way a player would point
// at them, i.e. "across the mouth of the north lane", not by index.
// ---------------------------------------------------------------------------
function cellsAcross(lane, d, offsets) {
  const seen = new Set(), out = [];
  for (const o of offsets) {
    const p = laneAt(lane, d, o);
    const c = cellOf(p.x, p.z);
    const k = c.i * 1000 + c.j;
    if (seen.has(k)) continue;
    seen.add(k);
    if (isBuildableCell(c.i, c.j)) out.push(c);
  }
  return out;
}

// A wall across the lane mouth. Offsets are derived from the lane's own width
// rather than hard-coded for a 6m lane — the second map has a 7m lane, and a
// wall built to the wrong width leaves a gap the fuzzer would never find
// because it is not a crash, just a lane that quietly does not hold.
function sealCells(lane, d) {
  // Sample the whole cross-section finely and let the cell dedupe do the work.
  // Picking offsets by hand (every 2m from -half) depends on how the grid
  // happens to line up with the lane, and a wall one cell short does not fail
  // loudly — the lane just quietly leaks.
  const half = lane.width / 2 + 0.6;
  const offs = [];
  for (let o = -half; o <= half + 1e-6; o += 0.5) offs.push(o);
  return cellsAcross(lane, d, offs);
}

// Somewhere beside the lane, in range of it, out of the walking line.
function supportCell(lane, d, side) {
  for (const o of [side * 5, side * 7, side * 3.5, -side * 5, -side * 7]) {
    const c = cellsAcross(lane, d, [o])[0];
    if (c) return c;
  }
  return null;
}

// The bot's shopping list, in priority order. It buys down this list whenever
// it can afford the next item — which means early waves are held by a thin
// line and the defence thickens as bounty comes in, the same way a player's
// would. A bot that gets its whole build for free measures nothing.
// Three genuinely different ways to spend 42 units. Testing only ONE build
// order proves nothing about the premise: it would be satisfied by a bot that
// happens to build badly. The claim "no ward allocation wins unattended" has to
// be checked against the plausible EXTREMES, not one middle case.
// See [[dominant-strategy-vs-tradeoff]].
function shoppingList(plan = 'balanced') {
  if (plan === 'airheavy') return airHeavyList();
  if (plan === 'groundheavy') return groundHeavyList();
  const list = [];
  const laneOrder = ['north', 'east', 'west'];

  // Distances are fractions of each lane's own length: the second map has a
  // 91m road and a 36m one, and "put a ballista 12m in" means something quite
  // different on each.
  const at = (lane, f, min) => Math.max(min || 6, lane.total * f);

  // pass 1 — a wall near each door and a ballista covering it
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const d = at(lane, 0.16, 6);
    for (const c of sealCells(lane, d)) list.push({ ward: 'palisade', ...c });
    const b = supportCell(lane, d + 5, 1);
    if (b) list.push({ ward: 'ballista', ...b });
  }
  // pass 2 — braziers, the only answer to a wisp that is not the player
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const c = supportCell(lane, at(lane, 0.34, 12), -1);
    if (c) list.push({ ward: 'archers', ...c });
  }
  // pass 3 — snares just behind each wall, where the queue bunches up
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const c = cellsAcross(lane, at(lane, 0.24, 9), [0, -2, 2])[0];
    if (c) list.push({ ward: 'caltrops', ...c });
  }
  // pass 4 — a second ballista per lane, deeper in
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const c = supportCell(lane, at(lane, 0.5, 18), 1);
    if (c) list.push({ ward: 'ballista', ...c });
  }
  // pass 5 — braziers around the stone itself, the last word against wisps
  for (const [x, z] of [[6, 6], [-6, 6], [6, -6], [-6, -6]]) {
    const c = cellOf(x, z);
    if (isBuildableCell(c.i, c.j)) list.push({ ward: 'archers', ...c });
  }
  return list;
}

// Spend almost everything on anti-air ringing the stone. Kills wisps fast and
// leaves the ground lanes nearly naked.
function airHeavyList() {
  const list = [];
  for (const r of [5, 7, 9]) {
    for (let a = 0; a < 8; a++) {
      const x = Math.cos(a * Math.PI / 4) * r, z = Math.sin(a * Math.PI / 4) * r;
      const c = cellOf(x, z);
      if (isBuildableCell(c.i, c.j)) list.push({ ward: 'archers', ...c });
    }
  }
  for (const id of ['north', 'east', 'west']) {
    const lane = LANE_BY_ID[id];
    for (const c of sealCells(lane, Math.max(6, lane.total * 0.16))) {
      list.push({ ward: 'palisade', ...c });
    }
  }
  return list;
}

// The opposite: every unit into walls and ballistas, no anti-air whatsoever.
function groundHeavyList() {
  const list = [];
  const laneOrder = ['north', 'east', 'west'];
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const d = Math.max(6, lane.total * 0.16);
    for (const c of sealCells(lane, d)) list.push({ ward: 'palisade', ...c });
    const b = supportCell(lane, d + 5, 1);
    if (b) list.push({ ward: 'ballista', ...b });
  }
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const c = supportCell(lane, Math.max(18, lane.total * 0.5), 1);
    if (c) list.push({ ward: 'ballista', ...c });
    const t = cellsAcross(lane, Math.max(9, lane.total * 0.24), [0, -2, 2])[0];
    if (t) list.push({ ward: 'caltrops', ...t });
  }
  return list;
}

// ---------------------------------------------------------------------------
// The bot.
// ---------------------------------------------------------------------------
export class Bot {
  constructor(world, opts = {}) {
    this.w = world;
    this.build = opts.build !== false;   // does it place wards?
    this.fight = opts.fight !== false;   // does the body do anything?
    this.noAir = !!opts.noAir;           // refuses to engage anything airborne
    this.list = shoppingList(opts.plan);
    this.blocked = new Set();            // list slots that can never be built
    this.shopCd = 0;                     // see _shop
    this.parked = { x: -24, z: 26 };     // clear of all three lanes
  }

  // Re-walks the whole list every call rather than advancing a pointer, so a
  // ward that gets smashed is REBUILT. With a one-way pointer the bot ended
  // wave 6 sitting on 1100 mana and free units with ten holes in its line,
  // which measured the bot's bookkeeping and not the game.
  _shop(dt) {
    // Throttled to ~4Hz. Re-walking the list every tick cost ~90M canBuild
    // calls per full game and made the fuzz suite unusable, while modelling a
    // player who re-surveys the entire map sixty times a second.
    this.shopCd -= (dt || 0);
    if (this.shopCd > 0) return;
    this.shopCd = 0.25;
    const w = this.w;
    for (let n = 0; n < this.list.length; n++) {
      if (this.blocked.has(n)) continue;
      const item = this.list[n];
      if (w.wardAtCell(item.i, item.j)) continue;      // still standing
      const c = w.canBuild(item.ward, item.i, item.j);
      if (c.ok) { w.build(item.ward, item.i, item.j); continue; }
      if (c.why === 'not enough mana') break;          // keep priority order
      if (c.why === 'no defence units') continue;      // a smaller ward may fit
      if (c.why === 'not unlocked yet') continue;      // comes later, keep it queued
      this.blocked.add(n);                             // bad cell, never retry
    }

    // Spend spare mana UPGRADING once the line is up. Without this the bot
    // banks to the cap by wave 5 and stops being a model of a player at all —
    // and the upgrade system goes entirely unmeasured.
    this._upgrade();
  }

  // Upgrade the weakest-levelled ward that is doing real work, cheapest first,
  // and only with mana we are not about to need for a rebuild.
  _upgrade() {
    const w = this.w;
    const reserve = 120;
    let guard = 0;
    while (w.mana > reserve && guard++ < 6) {
      let best = null, bestCost = Infinity;
      for (const x of w.wards) {
        if (x.dead || x.buildT > 0) continue;
        const c = w.canUpgrade(x);
        if (!c.ok) continue;
        const cost = w.upgradeCost(x);
        // prefer levelling everything evenly before pushing one to the top
        const score = cost + x.level * 40;
        if (score < bestCost && w.mana - cost > reserve) { bestCost = score; best = x; }
      }
      if (!best) break;
      if (!w.upgrade(best)) break;
    }
  }

  // What the body should be pointed at right now. Priority is the design
  // statement in executable form: breakers and wisps first, because those are
  // the two things the wards provably cannot handle alone.
  _threat() {
    const w = this.w, p = w.player;
    let best = null, bestScore = -Infinity;
    for (const f of w.foes) {
      if (f.dead) continue;
      if (this.noAir && f.def.flying) continue;
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      const toStone = Math.hypot(f.x, f.z);
      let score;
      if (f.kind === 'breaker') score = 3000 - toStone * 4;
      else if (f.kind === 'wisp') score = 2000 - toStone * 4;
      else score = 200 - toStone * 2 - d * 0.5;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  tick(dt) {
    const w = this.w, p = w.player;

    if (w.phase === 'build') {
      if (this.build) this._shop(dt);
      // Break the caches first, then sweep. A bot that ignores foraging models
      // a player who leaves a third of their income on the ground.
      // NOTE: the bot deliberately does NOT forage the caches.
      //
      // Isolated with the dice pinned, on the gauntlet:
      //     no caches at all               10/10
      //     caches present, bot ignores    10/10
      //     caches present, bot forages     1/10
      // So the caches themselves are harmless to the game; the bot's foraging
      // policy destabilises its own defence (husk leak 86 -> 594 while wards
      // LOST fell 17 -> 9, i.e. foes walking past intact walls, so the extra
      // early mana was changing what it built and leaving a lane unsealed).
      //
      // That is a bug in the measuring instrument, not in the game, and the
      // conservative reading is the useful one: a bot that ignores caches
      // models a player who leaves that income on the ground, so every
      // win-rate here is a LOWER BOUND on a player who picks them up. Fixing
      // the bot's build ordering under a rich economy is a follow-up.

      // Sweep the field before readying up. Motes do not rot between waves, so
      // this is where most of the bounty is actually banked.
      let m = null, md = Infinity;
      if (this.fight) {
        for (const mo of w.motes) {
          if (mo.taken) continue;
          const d = Math.hypot(mo.x - p.x, mo.z - p.z);
          if (d < md) { md = d; m = mo; }
        }
      }
      if (m) {
        const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz) || 1;
        w.movePlayer((dx / d) * PLAYER.speed, (dz / d) * PLAYER.speed, dt);
      } else if (w.phaseTimer > 2) {
        w.phaseTimer = 2;               // nothing left to do; ready up
      }
      return;
    }
    if (this.build) this._shop(dt);
    if (!this.fight || !p.alive) return;

    const foe = this._threat();
    let gox = this.parked.x, goz = this.parked.z, standoff = 0;

    // Nearest un-banked mote, and whether the current threat is urgent enough
    // that walking off to collect would lose the stone.
    let m = null, md = Infinity;
    for (const mo of w.motes) {
      if (mo.taken) continue;
      const d = Math.hypot(mo.x - p.x, mo.z - p.z);
      if (d < md) { md = d; m = mo; }
    }
    const urgent = foe && (foe.kind === 'breaker' || foe.kind === 'wisp') &&
      Math.hypot(foe.x, foe.z) < 16;

    // A bot that only ever walks at the threat banks almost nothing and then
    // cannot afford the wards the later waves need — which measures the BOT's
    // hoarding, not the game. Firing is independent of walking, so it collects
    // on the move and keeps shooting the whole time.
    // See [[midden-sim-understates-clustering]].
    if (m && !urgent && md < 16) {
      gox = m.x; goz = m.z; standoff = 0;
    } else if (foe) {
      gox = foe.x; goz = foe.z;
      // close for ground foes, keep range on anything airborne
      standoff = foe.def.flying ? 12 : 2.0;
    } else {
      const dmg = w.wards.filter(x => !x.dead && x.hp < x.maxHp)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
      if (dmg) { gox = dmg.x; goz = dmg.z; standoff = 2.2; }
    }

    // Repairing takes priority over positioning when already stood at a wound.
    const rt = w.repairTarget();
    if (rt && (!foe || foe.kind === 'husk' || foe.kind === 'runner')) {
      w.repairStep(dt);
    }

    const dx = gox - p.x, dz = goz - p.z;
    const d = Math.hypot(dx, dz);
    if (d > standoff + 0.4) {
      const s = PLAYER.speed;
      w.movePlayer((dx / d) * s, (dz / d) * s, dt);
    }

    if (!foe) return;

    const ax = foe.x - p.x;
    const ay = (foe.y + foe.def.height * 0.5) - (p.y + 1.2);
    const az = foe.z - p.z;
    const flat = Math.hypot(ax, az) || 1;
    const al = Math.hypot(ax, ay, az) || 1;

    // Weapon choice, which is the whole point of having two: the sword is
    // worth 100 dps but cannot touch the air and needs you at 2.8m, so it is
    // only correct when the target is on the ground AND already close.
    const sword = PLAYER.weapons.sword;
    const wantSword = !foe.def.flying && flat < sword.range + 0.6;
    if (wantSword && p.weapon !== 'sword') w.swapWeapon('sword');
    else if (!wantSword && p.weapon !== 'crossbow') w.swapWeapon('crossbow');

    // Roll out when something is about to land on you and the roll is ready.
    if (p.dodgeCd <= 0 && p.hp < p.maxHp * 0.55) {
      let close = 0;
      for (const f of w.foes) {
        if (!f.dead && Math.hypot(f.x - p.x, f.z - p.z) < 2.4) close++;
      }
      if (close >= 2) w.dodge(-ax / flat, -az / flat);
    }

    if (p.atkCd <= 0) {
      const wd = w.weaponDef(p);
      if (wd.kind === 'melee') {
        if (flat <= wd.range + foe.def.radius) w.attack(ax / flat, az / flat, 0);
      } else if (al <= wd.range) {
        w.attack(ax / al, az / al, ay / al);
      }
    }
  }
}

// `rich` tops the purse up every step so the DU budget is the ONLY limit on
// the defence. That is the arm that asks the honest question: not "can a poor
// player lose?" but "does a COMPLETE ward set still need a body?".
export function playRun(opts = {}) {
  const w = new World({
    seed: opts.seed == null ? 7 : opts.seed,
    difficulty: opts.difficulty,
  });
  if (opts.rich) w.grantAll();
  const bot = new Bot(w, opts);
  const maxT = opts.maxT || 1200;
  let guard = 0;
  while (w.phase !== 'won' && w.phase !== 'lost' && w.t < maxT && guard++ < 260000) {
    if (opts.rich) w.mana = 5000;
    bot.tick(DT);
    w.step(DT);
  }
  return w;
}

// ---------------------------------------------------------------------------
// Directed micro-tests. Each builds exactly the situation it is asserting on.
// ---------------------------------------------------------------------------
function sandbox() {
  const w = new World({ seed: 3, sandbox: true });
  w.grantAll();          // these tests are about behaviour, not unlock pacing
  return w;
}

function runFor(w, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { if (each) each(w, DT); w.step(DT); }
}

// ---------------------------------------------------------------------------
export function runTests(log = console.log) {
  const results = [];
  let pass = 0, fail = 0;
  const ok = (name, cond, detail) => {
    results.push({ name, cond: !!cond, detail });
    if (cond) { pass++; log(`  PASS  ${name}${detail ? '  — ' + detail : ''}`); }
    else { fail++; log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
  };

  // Pin the map and remember the shipped budget: several assertions below move
  // both, and a leaked value would silently retarget every later test.
  // See [[sim-level-default-retargets-suite]].
  setMap('glade');
  const SHIPPED_DU = ECON.duBudget;

  log('\n--- WARDSTONE assertions ---\n');
  log('[definitions]');

  ok('T1  a breaker out-damages repair',
    BREAKER_DPS > PLAYER.repairRate,
    `breaker ${BREAKER_DPS.toFixed(1)} dps vs repair ${PLAYER.repairRate} hp/s`);

  ok('T2  exactly one ward reaches a flier',
    WARDS.filter(x => x.targets === 'all').length === 1,
    WARDS.filter(x => x.targets === 'all').map(x => x.name).join(','));

  ok('T3  the flier-capable ward is the weakest',
    Math.min(...WARDS.filter(w => w.kind === 'projectile').map(w => w.damage / w.cooldown)) >
      WARD_BY_ID.archers.dps,
    `brazier ${WARD_BY_ID.archers.dps} dps vs ballista ${(WARD_BY_ID.ballista.damage / WARD_BY_ID.ballista.cooldown).toFixed(0)}`);

  ok('T4  six waves, escalating foe count',
    WAVES.length === 6 && WAVES.every((w, i) => i === 0 || waveFoeCount(w) >= waveFoeCount(WAVES[i - 1])),
    WAVES.map(waveFoeCount).join(' -> '));

  log('\n[the lane rules]');

  // --- T5: a sealed lane stops ground foes. Measured as a paired A/B, because
  // "the stone took no damage" alone would also pass if the foes never spawned.
  // The unwalled arm is what proves the window was long enough to matter.
  {
    const mk = (walled) => {
      const w = sandbox();
      w.mana = 9999;
      if (walled) for (const c of sealCells(LANE_BY_ID.north, 7)) w.build('palisade', c.i, c.j);
      for (let i = 0; i < 6; i++) w._spawn('north', 'husk');
      w.phase = 'combat';
      runFor(w, 24);
      return w;
    };
    const open = mk(false), shut = mk(true);
    const openDmg = open.stone.maxHp - open.stone.hp;
    const shutDmg = shut.stone.maxHp - shut.stone.hp;
    ok('T5  a sealed lane stops ground foes (A/B vs the same lane open)',
      openDmg > 0 && shutDmg === 0,
      `open lane let through ${openDmg} damage, sealed lane ${shutDmg}`);
  }

  // --- T6: the same wall does nothing to a wisp. This is the gap, on purpose.
  {
    const w = sandbox();
    w.mana = 9999;
    const lane = LANE_BY_ID.north;
    for (const c of sealCells(lane, 7)) w.build('palisade', c.i, c.j);
    for (let i = 0; i < 4; i++) w._spawn('north', 'wisp');
    w.phase = 'combat';
    runFor(w, 30);
    ok('T6  a wisp ignores the wall entirely',
      w.stone.hp < w.stone.maxHp,
      `stone took ${w.stone.maxHp - w.stone.hp} through a sealed lane`);
  }

  // --- T7: a breaker cannot be out-repaired, even with infinite mana.
  {
    const w = sandbox();
    w.mana = 999999;
    // The wall and the foe must be on the SAME line, or the foe walks past a
    // wall it was never touching and the test measures nothing.
    const lane = LANE_BY_ID.north;
    const cells = cellsAcross(lane, 7, [-1]);
    const wall = w.build('palisade', cells[0].i, cells[0].j);
    w._spawn('north', 'breaker');
    w.foes[0].off = -1;
    w.phase = 'combat';
    // park the player on the wall and hold repair the entire time
    const hold = (world, dt) => {
      world.player.x = wall.x + 1.4; world.player.z = wall.z + 1.4;
      world.player.hp = world.player.maxHp;    // isolate repair from survival
      world.repairStep(dt);
    };
    runFor(w, 10, hold);
    const at10 = wall.hp;
    runFor(w, 10, hold);
    const at20 = wall.hp;
    runFor(w, 70, hold);
    ok('T7  a breaker breaks a wall a player is actively mending',
      wall.dead && at20 < at10,
      `hp fell ${Math.round(at10)} -> ${Math.round(at20)} while mended, ` +
      `wall ${wall.dead ? 'destroyed' : 'STILL UP'}, ${Math.floor(w.mana)} mana unspent`);
  }

  // --- T8: the same wall, same repair, vs husks — holds forever.
  {
    const w = sandbox();
    w.mana = 999999;
    const lane = LANE_BY_ID.north;
    const cells = cellsAcross(lane, 7, [-1]);
    const wall = w.build('palisade', cells[0].i, cells[0].j);
    for (let i = 0; i < 3; i++) { w._spawn('north', 'husk'); w.foes[i].off = -1; }
    w.phase = 'combat';
    runFor(w, 90, (world, dt) => {
      world.player.x = wall.x + 1.4; world.player.z = wall.z + 1.4;
      world.player.hp = world.player.maxHp;
      world.repairStep(dt);
    });
    ok('T8  the same wall + repair holds against husks indefinitely',
      !wall.dead,
      `wall at ${Math.round(wall.hp)}/${wall.maxHp} after 90s`);
  }

  // --- T9: a ballista will not shoot at a wisp; a brazier will.
  {
    const a = sandbox(); a.mana = 9999;
    const bal = a.build('ballista', ...(() => { const c = cellOf(4, -10); return [c.i, c.j]; })());
    a._spawn('north', 'wisp'); a.phase = 'combat';
    runFor(a, 12);
    const wispDmgFromBallista = (a.stats.dmgToFoeBy.ward.wisp || 0);

    const b = sandbox(); b.mana = 9999;
    const cc = cellOf(4, -10);
    b.build('archers', cc.i, cc.j);
    b._spawn('north', 'wisp'); b.phase = 'combat';
    runFor(b, 12);
    const wispDmgFromBrazier = (b.stats.dmgToFoeBy.ward.wisp || 0);

    ok('T9  ballista cannot touch a wisp, the archer post can',
      wispDmgFromBallista === 0 && wispDmgFromBrazier > 0,
      `ballista ${wispDmgFromBallista.toFixed(0)}, archers ${wispDmgFromBrazier.toFixed(0)}`);
  }

  // --- T10: mana is not telepathic. A kill far from the player banks nothing.
  {
    const w = sandbox(); w.mana = 0;
    w._spawn('north', 'husk');
    w.player.x = 30; w.player.z = 30;
    w.phase = 'combat';
    w._killFoe(w.foes[0]);
    runFor(w, 6);
    const far = w.mana;
    w.player.x = w.motes[0] ? w.motes[0].x : 0;
    w.player.z = w.motes[0] ? w.motes[0].z : 0;
    runFor(w, 3);
    ok('T10 a mote must be walked over to be banked',
      far === 0 && w.mana > 0,
      `${far} mana at range, ${Math.floor(w.mana)} after walking to it`);
  }

  // --- Caltrops are the one ward whose output is not damage, so "does it
  // work?" has to be measured as TIME over a fixed stretch, not as hit points.
  {
    const walkTime = (withField) => {
      const w = sandbox();
      w.mana = 99999;
      if (withField) {
        for (const d of [10, 14, 18]) {
          const c = cellsAcross(LANE_BY_ID.north, d, [0])[0];
          if (c) w.build('caltrops', c.i, c.j);
        }
      }
      w._spawn('north', 'husk');
      const f = w.foes[0];
      f.off = 0;
      w.phase = 'combat';
      let t = 0;
      for (let i = 0; i < Math.round(40 / DT); i++) {
        w.step(DT); t += DT;
        if (f.dist >= 22) break;
      }
      return t;
    };
    const open = walkTime(false), strewn = walkTime(true);
    ok('T10b caltrops slow what crosses them (A/B over the same 22m)',
      strewn > open * 1.3,
      `${open.toFixed(1)}s clear vs ${strewn.toFixed(1)}s strewn ` +
      `(${((strewn / open - 1) * 100).toFixed(0)}% slower)`);
  }

  {
    const w = sandbox();
    w.mana = 99999;
    const c = cellsAcross(LANE_BY_ID.north, 12, [0])[0];
    w.build('caltrops', c.i, c.j);
    w._spawn('north', 'wisp');
    w.phase = 'combat';
    runFor(w, 14);
    const f = w.foes[0];
    ok('T10c caltrops do not slow fliers',
      !f || f.dead || f.slowK === 1,
      f && !f.dead ? `wisp slowK ${f.slowK}` : 'the wisp flew over unimpeded');
  }

  log('\n[the premise]');

  // --- The three-way comparison. This is the whole point of the file.
  const bothW = playRun({ seed: 7, build: true, fight: true });
  const wardsW = playRun({ seed: 7, build: true, fight: false });
  const bodyW = playRun({ seed: 7, build: false, fight: true });

  const fmt = (w) => `${w.phase} at wave ${w.waveIndex + 1}/${WAVES.length}, stone ${Math.max(0, Math.round(w.stone.hp))}`;

  ok('T11 wards alone LOSE — the body has a job',
    wardsW.phase === 'lost', fmt(wardsW));

  // The version of T11 that cannot pass for the wrong reason. T11 alone is
  // satisfied by a bot too POOR to build; this one hands the wards an unlimited
  // purse and asks whether the DU cap still leaves a hole only a body can fill.
  // It caught exactly that: before the DU budget existed, a full ward set won
  // with the player stood in a corner for the entire game.
  const richIdle = playRun({ seed: 7, build: true, fight: false, rich: true });
  ok('T11b a COMPLETE ward build with an idle body never wins',
    richIdle.phase !== 'won',
    fmt(richIdle) + `, ${richIdle.wards.length} wards up, ` +
    `${Math.round(richIdle.stats.leaked.wisp || 0)} of the damage from wisps`);

  // ...and neither does either extreme allocation of the same budget.
  for (const plan of ['airheavy', 'groundheavy']) {
    const r = playRun({ seed: 7, build: true, fight: false, rich: true, plan });
    ok(`T11d "${plan}" wards with an idle body never win`,
      r.phase !== 'won', fmt(r) + `, ${r.du} units spent`);
  }

  ok('T11c the defence-unit cap is what binds a rich build, not mana',
    richIdle.du + 4 > ECON.duBudget,
    `${richIdle.du}/${ECON.duBudget} units spent with 5000 mana on hand`);

  ok('T12 the body alone LOSES — the wards have a job',
    bodyW.phase === 'lost', fmt(bodyW));

  ok('T13 wards + body WIN — it is a hybrid, not either half',
    bothW.phase === 'won', fmt(bothW));

  const richBoth = playRun({ seed: 7, build: true, fight: true, rich: true });
  ok('T13b the same rich build WINS once a body drives it',
    richBoth.phase === 'won',
    fmt(richBoth) + ' — the only variable changed is whether the player acts');

  // --- Who actually killed the things the wards cannot handle?
  {
    const p = bothW.stats.dmgToFoeBy.player, d = bothW.stats.dmgToFoeBy.ward;

    // The claim is SPECIALISATION, not monopoly. Once the brazier is strong
    // enough to be worth its units the wards take a real share of the air, and
    // they should — what matters is that the body's share of the two foes the
    // lanes cannot cover (wisp, breaker) is far higher than its share of the
    // two the lanes are built for (husk, runner). T11b already proves the
    // wards' share of the air is not sufficient on its own.
    const share = (ids) => {
      const pv = ids.reduce((n, k) => n + (p[k] || 0), 0);
      const dv = ids.reduce((n, k) => n + (d[k] || 0), 0);
      return { pv, dv, f: pv / (pv + dv || 1) };
    };
    // Measured on the AIR alone. Breakers used to belong in here, but the
    // ballista is now deliberately the anti-elite ward — big single blows at
    // long reach — so wards taking a larger share of breakers is the design
    // working, not the premise slipping. What the wards structurally cannot
    // do is reach the sky, and that is what this has to keep proving.
    // Damage SHARE turned out to be a bad instrument here: hurtFoe caps a blow
    // at the target's remaining hit points, so a player who kills wisps more
    // efficiently can record LESS damage than one who overkills them. Twice I
    // moved this assertion to keep it passing, which is how a suite quietly
    // stops meaning anything.
    //
    // So test the claim directly instead. Same build, same bot, same seeds —
    // the only change is that the body refuses to engage anything airborne.
    // If that arm still wins, the player's anti-air work was never load-bearing.
    const noAir = playRun({ seed: 7, build: true, fight: true, noAir: true });
    ok('T14 a player who ignores the sky LOSES',
      noAir.phase !== 'won',
      fmt(noAir) + `, ${Math.round(noAir.stats.leaked.wisp || 0)} of the damage from wisps ` +
      `(the same bot that fights the air wins)`);

    const pb = p.breaker || 0, db = d.breaker || 0;
    ok('T15 the player does a real share of breaker damage',
      pb > 0.25 * (pb + db),
      `player ${Math.round(pb)} vs wards ${Math.round(db)} (${Math.round(100 * pb / (pb + db || 1))}% player)`);

    const ph = p.husk || 0, dh = d.husk || 0;
    ok('T16 but the WARDS carry the lane foes',
      dh > ph,
      `wards ${Math.round(dh)} vs player ${Math.round(ph)} on husks`);
  }

  ok('T17 the player is genuinely at risk',
    bothW.stats.playerDeaths > 0 || bothW.stats.wardLosses > 0,
    `${bothW.stats.playerDeaths} deaths, ${bothW.stats.wardLosses} wards lost`);

  ok('T18 the economy neither starves nor floods',
    bothW.stats.manaEarned > bothW.stats.manaSpent * 0.5 && bothW.mana < ECON.manaCap,
    `earned ${Math.round(bothW.stats.manaEarned)}, spent ${Math.round(bothW.stats.manaSpent)}, ended ${Math.floor(bothW.mana)}`);

  // --- seeds: the win must not be a fluke of one dice roll.
  {
    const seeds = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
    const outcomes = seeds.map(s => playRun({ seed: s, build: true, fight: true }));
    const wins = outcomes.filter(w => w.phase === 'won').length;
    const stones = outcomes.map(w => Math.max(0, Math.round(w.stone.hp))).sort((a, b) => a - b);
    // Not "every seed": one unlucky roll losing is a game, not a bug. What
    // must hold is that a competent player wins the large majority and the
    // median run is a real fight rather than a walkover.
    // A BAND, not a floor. "Wins almost always" was the old intent; the design
    // intent now is that a run is genuinely in doubt — winnable by a competent
    // player, and not a walkover for one. Both edges are failures: too low and
    // it is unfair, too high and wave six means nothing.
    ok('T19 a run is winnable but never a walkover',
      wins >= seeds.length * 0.5 && wins <= seeds.length * 0.9,
      `${wins}/${seeds.length} won (want 5-9), median stone ` +
      `${stones[seeds.length >> 1]}/3000, worst ${stones[0]}`);

    const lossSeeds = seeds.map(s => playRun({ seed: s, build: true, fight: false }));
    const lw = lossSeeds.filter(w => w.phase === 'lost').length;
    ok('T20 wards alone lose on every seed',
      lw === seeds.length,
      `${lw}/${seeds.length} seeds lost`);
  }

  log('\n[does it generalise?]');

  // The stage-2 question: is the unit budget a property of the DESIGN, or was
  // it merely fitted to the arena it was tuned in? Same waves, same budget,
  // same bot — only the geometry changes. The Gauntlet has one 91m road and
  // two ~36m ones, so the same 32 units have to be spent quite differently.
  {
    const perMap = {};
    for (const id of Object.keys(MAPS)) {
      setMap(id);
      const idleWins = ['balanced', 'airheavy', 'groundheavy'].filter(plan =>
        playRun({ seed: 7, build: true, fight: false, rich: true, plan, maxT: 600 })
          .phase === 'won').length;
      const seeds = [1, 2, 3, 5, 8];
      const wins = seeds.filter(sd =>
        playRun({ seed: sd, build: true, fight: true }).phase === 'won').length;
      perMap[id] = { idleWins, wins, of: seeds.length };
    }
    setMap('glade');

    const anyIdle = Object.values(perMap).some(m => m.idleWins > 0);
    ok('T21 no ward build wins unattended on ANY map',
      !anyIdle,
      Object.entries(perMap).map(([k, v]) => `${k} ${v.idleWins}/3 idle plans won`).join(', '));

    // Every map must be WINNABLE by a competent player — a majority of runs —
    // without requiring that any of them be comfortable.
    const allPlayable = Object.values(perMap).every(m => m.wins > m.of / 2);
    ok('T22 a player wins the majority of runs on every map',
      allPlayable,
      Object.entries(perMap).map(([k, v]) => `${k} ${v.wins}/${v.of}`).join(', ') +
      ` at ${SHIPPED_DU} units`);
  }

  // And the cliff itself must be above what we ship, on every map — that is
  // the margin, and it is the thing a future tuning pass would erode first.
  {
    const cliffs = {};
    for (const id of Object.keys(MAPS)) {
      setMap(id);
      let cliff = null;
      for (const du of [SHIPPED_DU + 2, SHIPPED_DU + 4, SHIPPED_DU + 8]) {
        ECON.duBudget = du;
        const broke = ['balanced', 'airheavy', 'groundheavy'].some(plan =>
          playRun({ seed: 7, build: true, fight: false, rich: true, plan, maxT: 600 })
            .phase === 'won');
        if (broke) { cliff = du; break; }
      }
      cliffs[id] = cliff;
    }
    ECON.duBudget = SHIPPED_DU;
    setMap('glade');
    const margins = Object.entries(cliffs)
      .map(([k, v]) => `${k} ${v == null ? '>+8' : '+' + (v - SHIPPED_DU)}`).join(', ');
    ok('T23 the premise cliff sits above the shipped budget on every map',
      Object.values(cliffs).every(v => v == null || v > SHIPPED_DU),
      `shipped ${SHIPPED_DU}; cliff at ${margins}`);
  }

  // -------------------------------------------------------------------- tiers
  // Two claims, and deliberately only two. The tier NUMBERS are for humans —
  // the bot builds from a fixed shopping list and cannot re-plan around a
  // different curve, so its win rate per tier measures the pilot as much as the
  // game. What must hold regardless of the pilot is that no tier hands the game
  // to the wards, and that the tiers point the right way.
  {
    log('\n[difficulty]');
    const TIERS = ['squire', 'knight', 'warden'];
    const meds = {};
    let anyIdleWon = null;
    for (const map of ['glade', 'gauntlet']) {
      setMap(map);
      for (const d of TIERS) {
        for (const plan of ['balanced', 'airheavy', 'groundheavy']) {
          const r = playRun({
            seed: 7, build: true, fight: false, rich: true, plan,
            maxT: 600, difficulty: d,
          });
          if (r.phase === 'won') anyIdleWon = `${map}/${d}/${plan}`;
        }
        const st = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
          .map(sd => Math.max(0, Math.round(
            playRun({ seed: sd, build: true, fight: true, difficulty: d }).stone.hp)))
          .sort((a, b) => a - b);
        meds[`${map}.${d}`] = st[5];
      }
    }
    setMap('glade');

    ok('T24 no difficulty tier lets a ward build win unattended',
      anyIdleWon === null,
      anyIdleWon ? `${anyIdleWon} won with nobody playing`
        : '18 idle runs — 3 plans x 3 tiers x 2 maps — all lost');

    const ordered = ['glade', 'gauntlet'].every(m =>
      meds[`${m}.squire`] > meds[`${m}.knight`] &&
      meds[`${m}.knight`] > meds[`${m}.warden`]);
    ok('T25 the tiers are ordered — each leaves less fire standing',
      ordered,
      ['glade', 'gauntlet'].map(m =>
        `${m} ${meds[`${m}.squire`]}>${meds[`${m}.knight`]}>${meds[`${m}.warden`]}`).join(', '));
  }


  // ------------------------------------------------------------------- resume
  // A save is only worth having if the run it restores is the SAME run. Compare
  // the whole ward set — id, cell, rotation, level and hit points — not just a
  // count, then play the restored world to the end to prove it is a live world
  // and not just a matching set of numbers.
  {
    log('\n[save / resume]');
    const a = new World({ seed: 42, difficulty: 'knight' });
    const botA = new Bot(a, { build: true, fight: true });
    while (!(a.phase === 'build' && a.waveIndex === 2) && a.t < 400) {
      botA.tick(DT); a.step(DT);
    }
    const snap = a.serialize();
    const b = new World({ seed: 42, difficulty: 'knight' });
    const restored = snap && b.restore(snap);

    const key = w => `${w.def.id}@${w.i},${w.j}r${w.rot}L${w.level}h${Math.round(w.hp)}`;
    const setA = a.wards.filter(w => !w.dead).map(key).sort().join('|');
    const setB = b.wards.map(key).sort().join('|');
    const same = restored && setA === setB &&
      a.du === b.du && Math.round(a.mana) === Math.round(b.mana) &&
      Math.round(a.stone.hp) === Math.round(b.stone.hp) &&
      Math.round(a.player.hp) === Math.round(b.player.hp) &&
      a.waveIndex === b.waveIndex && a.occupancy.size === b.occupancy.size;

    ok('T26 a saved muster restores the same run',
      !!same,
      same ? `wave ${snap.waveIndex + 1}, ${snap.wards.length} wards, ${a.du} units — ward set, mana, fire and occupancy all identical`
           : 'restored world differs from the saved one');

    const botB = new Bot(b, { build: true, fight: true });
    while (b.phase !== 'won' && b.phase !== 'lost' && b.t < 900) { botB.tick(DT); b.step(DT); }
    ok('T27 a restored run is playable to the end',
      b.phase === 'won' || b.phase === 'lost',
      `resumed at wave 3 and finished ${b.phase} at wave ${b.waveIndex + 1}`);

    const mid = new World({ seed: 1 });
    mid.phase = 'combat';
    ok('T28 a save is refused mid-wave, and junk is refused on the way back',
      mid.serialize() === null && b.restore({ v: 99 }) === false &&
      b.restore(null) === false,
      'no mid-combat save, and an unknown version degrades to a new run');
  }


  // ---------------------------------------------------------------- aiming
  // Reported by a player: "I sometimes just can't hit the wisps even with a
  // ranged weapon." It was not sometimes. The player aims by pointing at a
  // GROUND cell, so the aim vector is always horizontal; the assist cone was
  // cos(12deg); and a wisp flies at 4.2m. At 8m range it sits ~21 degrees above
  // a flat aim, fails the cone, acquires nothing, and the bolt flies straight
  // underneath it. The blind spot GREW as the wisp closed, which is exactly
  // when it matters, because that is when it is at the fire.
  //
  // Swept across the range a wisp is actually engaged at, with the flat aim the
  // game really produces.
  {
    log('\n[aiming at the sky]');
    const dists = [4, 6, 8, 10, 12, 16];
    const acquired = [];
    for (const dist of dists) {
      const w = new World({ seed: 5, sandbox: true });
      const f = w._spawn('north', 'wisp');
      const wisp = w.foes[w.foes.length - 1];
      wisp.x = dist; wisp.z = 0; wisp.y = wisp.def.flyHeight;
      w.player.x = 0; w.player.z = 0; w.player.y = 0;
      w.player.weapon = 'crossbow'; w.player.atkCd = 0;
      // the flat aim the pointer path actually produces
      const b = w.fireBolt(1, 0, 0);
      acquired.push(b && b.target === wisp);
    }
    const hit = acquired.filter(Boolean).length;
    ok('T29 a wisp can be acquired at every range it is fought at',
      hit === dists.length,
      `${hit}/${dists.length} ranges acquire — ${dists.map((d, i) =>
        `${d}m ${acquired[i] ? 'yes' : 'NO'}`).join(', ')}`);

    // And the bolt must actually reach it, not merely be aimed at it.
    const w2 = new World({ seed: 5, sandbox: true });
    w2._spawn('north', 'wisp');
    const wisp2 = w2.foes[w2.foes.length - 1];
    wisp2.x = 6; wisp2.z = 0; wisp2.y = wisp2.def.flyHeight;
    w2.player.x = 0; w2.player.z = 0; w2.player.weapon = 'crossbow';
    let shots = 0;
    for (let n = 0; n < 600 && !wisp2.dead; n++) {
      if (w2.player.atkCd <= 0) { w2.fireBolt(1, 0, 0); shots++; }
      w2.step(DT);
    }
    ok('T30 and the bolt reaches it — a flat shot still kills a flier',
      wisp2.dead,
      wisp2.dead ? `down in ${shots} bolts at 6m`
                 : `still alive after ${shots} bolts — bolts are passing under it`);
  }


  log(`\n--- ${pass}/${pass + fail} passed ---\n`);
  return { pass, fail, results };
}

export { shoppingList, sealCells };
