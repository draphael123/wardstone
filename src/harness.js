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
  isBuildableCell, CELL,
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

// A wall across the lane mouth. Four offsets because a 6m lane needs its full
// width covered and the grid does not align to a diagonal segment.
function sealCells(lane, d) {
  return cellsAcross(lane, d, [-3, -1, 1, 3]);
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

  // pass 1 — a wall and a ballista on every lane
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const d = 7;
    for (const c of sealCells(lane, d)) list.push({ ward: 'palisade', ...c });
    const b = supportCell(lane, d + 5, 1);
    if (b) list.push({ ward: 'ballista', ...b });
  }
  // pass 2 — braziers, which are the only answer to a wisp that is not the player
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const c = supportCell(lane, 14, -1);
    if (c) list.push({ ward: 'brazier', ...c });
  }
  // pass 3 — snares just behind each wall, where the queue bunches up
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const c = cellsAcross(LANE_BY_ID[id], 10, [0, -2, 2])[0];
    if (c) list.push({ ward: 'snare', ...c });
  }
  // pass 4 — a second ballista per lane, deeper
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const c = supportCell(lane, 20, 1);
    if (c) list.push({ ward: 'ballista', ...c });
  }
  // pass 5 — braziers around the stone itself, the last word against wisps
  for (const [x, z] of [[6, 6], [-6, 6], [6, -6], [-6, -6]]) {
    const c = cellOf(x, z);
    if (isBuildableCell(c.i, c.j)) list.push({ ward: 'brazier', ...c });
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
      if (isBuildableCell(c.i, c.j)) list.push({ ward: 'brazier', ...c });
    }
  }
  for (const id of ['north', 'east', 'west']) {
    for (const c of sealCells(LANE_BY_ID[id], 7)) list.push({ ward: 'palisade', ...c });
  }
  return list;
}

// The opposite: every unit into walls and ballistas, no anti-air whatsoever.
function groundHeavyList() {
  const list = [];
  const laneOrder = ['north', 'east', 'west'];
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    for (const c of sealCells(lane, 7)) list.push({ ward: 'palisade', ...c });
    const b = supportCell(lane, 12, 1);
    if (b) list.push({ ward: 'ballista', ...b });
  }
  for (const id of laneOrder) {
    const lane = LANE_BY_ID[id];
    const c = supportCell(lane, 20, 1);
    if (c) list.push({ ward: 'ballista', ...c });
    const t = cellsAcross(lane, 10, [0, -2, 2])[0];
    if (t) list.push({ ward: 'snare', ...t });
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
      this.blocked.add(n);                             // bad cell, never retry
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
      gox = foe.x; goz = foe.z; standoff = 11;
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

    if (foe && p.boltCd <= 0) {
      const ax = foe.x - p.x;
      const ay = (foe.y + foe.def.height * 0.5) - (p.y + 1.2);
      const az = foe.z - p.z;
      const al = Math.hypot(ax, ay, az) || 1;
      if (al <= PLAYER.boltRange) w.fireBolt(ax / al, az / al, ay / al);
    }
  }
}

// `rich` tops the purse up every step so the DU budget is the ONLY limit on
// the defence. That is the arm that asks the honest question: not "can a poor
// player lose?" but "does a COMPLETE ward set still need a body?".
export function playRun(opts = {}) {
  const w = new World({ seed: opts.seed == null ? 7 : opts.seed });
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
function sandbox() { return new World({ seed: 3, sandbox: true }); }

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
      WARD_BY_ID.brazier.dps,
    `brazier ${WARD_BY_ID.brazier.dps} dps vs ballista ${(WARD_BY_ID.ballista.damage / WARD_BY_ID.ballista.cooldown).toFixed(0)}`);

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
    b.build('brazier', cc.i, cc.j);
    b._spawn('north', 'wisp'); b.phase = 'combat';
    runFor(b, 12);
    const wispDmgFromBrazier = (b.stats.dmgToFoeBy.ward.wisp || 0);

    ok('T9  ballista cannot touch a wisp, brazier can',
      wispDmgFromBallista === 0 && wispDmgFromBrazier > 0,
      `ballista ${wispDmgFromBallista.toFixed(0)}, brazier ${wispDmgFromBrazier.toFixed(0)}`);
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
    const gap = share(['wisp', 'breaker']);
    const lane = share(['husk', 'runner']);
    ok('T14 the body specialises in what the lanes cannot cover',
      gap.f > lane.f * 1.4,
      `player is ${Math.round(100 * gap.f)}% of damage to wisps+breakers ` +
      `but only ${Math.round(100 * lane.f)}% to husks+runners`);

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
    const seeds = [1, 2, 3, 5, 8, 13, 21];
    const outcomes = seeds.map(s => playRun({ seed: s, build: true, fight: true }));
    const wins = outcomes.filter(w => w.phase === 'won').length;
    ok('T19 the full build wins on every seed',
      wins === seeds.length,
      `${wins}/${seeds.length} seeds won`);

    const lossSeeds = seeds.map(s => playRun({ seed: s, build: true, fight: false }));
    const lw = lossSeeds.filter(w => w.phase === 'lost').length;
    ok('T20 wards alone lose on every seed',
      lw === seeds.length,
      `${lw}/${seeds.length} seeds lost`);
  }

  log(`\n--- ${pass}/${pass + fail} passed ---\n`);
  return { pass, fail, results };
}

export { shoppingList, sealCells };
