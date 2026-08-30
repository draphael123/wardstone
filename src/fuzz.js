// WARDSTONE — adversarial fuzzer.
//
// The balance suite asks "is the design sound?". This asks the different and
// much dumber question: "can a player break it?". It drives the World with
// deliberately hostile input — selling a wall the instant a breaker commits to
// it, sealing every lane and going to sleep, spamming build/sell on one cell,
// firing at nothing, walking into geometry — and checks a set of invariants
// after EVERY step, so a violation is reported at the step it first appears
// rather than as a crash ten seconds later.
//
// It exists because the one resource I cannot generate is Daniel's playtest
// time, and a crash or an obvious exploit found on his first session burns it.

import { World } from './sim.js';
import { Bot } from './harness.js';
import { WARDS, WARD_BY_ID, FOES, ECON, WAVES, PLAYER } from './defs.js';
import {
  LANES, LANE_BY_ID, GRID_N, cellOf, cellCenter, cellKey, isBuildableCell, laneAt,
} from './arena.js';
import { makeRng } from './rand.js';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// Invariants. Each returns a string describing the breach, or null.
// ---------------------------------------------------------------------------
const num = (v) => typeof v === 'number' && Number.isFinite(v);

const INVARIANTS = [
  ['stone hp in range', (w) =>
    !num(w.stone.hp) ? `stone.hp is ${w.stone.hp}`
      : w.stone.hp > w.stone.maxHp ? `stone.hp ${w.stone.hp} > max`
      : w.stone.hp < 0 ? `stone.hp ${w.stone.hp} < 0` : null],

  ['mana finite and non-negative', (w) =>
    !num(w.mana) ? `mana is ${w.mana}`
      : w.mana < -1e-6 ? `mana ${w.mana} < 0`
      : w.mana > ECON.manaCap + 1e-6 ? `mana ${w.mana} > cap` : null],

  ['defence units within budget', (w) =>
    !num(w.du) ? `du is ${w.du}`
      : w.du < 0 ? `du ${w.du} < 0`
      : w.du > ECON.duBudget ? `du ${w.du} > budget ${ECON.duBudget}` : null],

  // The single most likely place for a leak: units are debited on build and
  // credited on BOTH sell and destruction. Recompute from scratch and compare.
  ['du equals the sum of live wards', (w) => {
    let real = 0, live = 0;
    for (let i = 0; i < w.wards.length; i++) {
      if (!w.wards[i].dead) { real += w.wards[i].def.du; live++; }
    }
    if (Math.abs(real - w.du) > 1e-9) return `du says ${w.du}, live wards sum to ${real}`;
    return w.occupancy.size !== live ? `occupancy ${w.occupancy.size} vs ${live} live wards` : null;
  }],

  ['occupancy matches the ward list', (w) => {
    for (let i = 0; i < w.wards.length; i++) {
      const x = w.wards[i];
      if (x.dead) continue;
      if (w.occupancy.get(cellKey(x.i, x.j)) !== x) {
        return `live ward ${x.def.id} at ${x.i},${x.j} not in occupancy`;
      }
    }
    for (const [k, x] of w.occupancy) {
      if (x.dead) return `dead ${x.def.id} still occupies cell ${k}`;
    }
    return null;
  }],

  ['no ward exceeds its own max hp', (w) => {
    for (const x of w.wards) {
      if (!num(x.hp)) return `${x.def.id} hp is ${x.hp}`;
      if (x.hp > x.maxHp + 1e-6) return `${x.def.id} hp ${x.hp} > max ${x.maxHp}`;
    }
    return null;
  }],

  ['every position is a finite number', (w) => {
    for (const f of w.foes) {
      if (!num(f.x) || !num(f.y) || !num(f.z)) return `foe ${f.kind} at ${f.x},${f.y},${f.z}`;
      if (!num(f.hp)) return `foe ${f.kind} hp ${f.hp}`;
      if (!num(f.dist)) return `foe ${f.kind} dist ${f.dist}`;
    }
    for (const b of w.projectiles) {
      if (!num(b.x) || !num(b.y) || !num(b.z)) return `projectile at ${b.x},${b.y},${b.z}`;
      if (!num(b.dx) || !num(b.dy) || !num(b.dz)) return `projectile dir ${b.dx},${b.dy},${b.dz}`;
    }
    const p = w.player;
    return (!num(p.x) || !num(p.z) || !num(p.hp) || !num(p.yaw))
      ? `player ${p.x},${p.z} hp ${p.hp} yaw ${p.yaw}` : null;
  }],

  ['nothing leaves the arena', (w) => {
    const lim = 60;
    for (const f of w.foes) {
      if (Math.abs(f.x) > lim || Math.abs(f.z) > lim) {
        return `foe ${f.kind} escaped to ${f.x.toFixed(1)},${f.z.toFixed(1)}`;
      }
    }
    const p = w.player;
    return (Math.abs(p.x) > 40 || Math.abs(p.z) > 40)
      ? `player at ${p.x.toFixed(1)},${p.z.toFixed(1)}` : null;
  }],

  ['player hp in range', (w) => {
    const p = w.player;
    if (p.hp > p.maxHp + 1e-6) return `player hp ${p.hp} > max`;
    if (p.alive && p.hp <= 0) return `player alive at ${p.hp} hp`;
    return null;
  }],

  // Runaway growth would not crash, it would just eat the frame budget until
  // the game died. Bound every pool well above any legitimate load.
  ['entity pools stay bounded', (w) =>
    w.foes.length > 400 ? `${w.foes.length} foes`
      : w.projectiles.length > 600 ? `${w.projectiles.length} projectiles`
      : w.motes.length > 600 ? `${w.motes.length} motes`
      : w.wards.length > 200 ? `${w.wards.length} wards`
      : w.events.length > 600 ? `${w.events.length} events` : null],

  ['phase is a known value', (w) =>
    ['build', 'combat', 'won', 'lost'].includes(w.phase) ? null : `phase is ${w.phase}`],

  ['a dead foe is never left in the live list', (w) => {
    // culling happens at the end of step(), so nothing dead should survive it
    let d = 0;
    for (let i = 0; i < w.foes.length; i++) if (w.foes[i].dead) d++;
    return d ? `${d} dead foes still listed` : null;
  }],
];

// Every invariant, every step. An earlier version sampled the two structural
// ones on a stride for speed while the summary still claimed "checked per
// step" — a cap nobody reading the output would have known about. Once the
// checks were written allocation-free the sampling bought little, so it is
// gone rather than merely disclosed.
function checkAll(w) {
  for (const [name, fn] of INVARIANTS) {
    let r;
    try { r = fn(w); } catch (e) { return `${name} THREW: ${e.message}`; }
    if (r) return `${name}: ${r}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hostile actors. Each is a policy that does something a real player might do
// but the happy path never covers.
// ---------------------------------------------------------------------------
function allBuildableCells() {
  const out = [];
  for (let i = 0; i < GRID_N; i++) {
    for (let j = 0; j < GRID_N; j++) if (isBuildableCell(i, j)) out.push({ i, j });
  }
  return out;
}
const CELLS = allBuildableCells();

const ACTORS = {
  // Random everything. The baseline: does anything at all break?
  chaos(w, rng) {
    const roll = rng();
    if (roll < 0.30) {
      const c = rng.pick(CELLS);
      w.build(rng.pick(WARDS).id, c.i, c.j);
    } else if (roll < 0.42 && w.wards.length) {
      w.sell(rng.pick(w.wards));
    } else if (roll < 0.55) {
      w.repairStep(DT);
    } else if (roll < 0.75) {
      const a = rng() * Math.PI * 2;
      w.fireBolt(Math.cos(a), Math.sin(a), rng.range(-1, 1));
    } else if (roll < 0.95) {
      const a = rng() * Math.PI * 2;
      w.movePlayer(Math.cos(a) * PLAYER.speed, Math.sin(a) * PLAYER.speed, DT);
    } else {
      w.ready();
    }
  },

  // Build and immediately sell the same cell forever. Targets the DU ledger
  // and the occupancy map, which are the two pieces of bookkeeping that can
  // silently drift.
  churn(w, rng) {
    const c = rng.pick(CELLS);
    const id = rng.pick(WARDS).id;
    w.build(id, c.i, c.j);
    const standing = w.wardAtCell(c.i, c.j);
    if (standing && rng() < 0.8) w.sell(standing);
    if (rng() < 0.1) w.ready();
  },

  // Sell whatever is currently being attacked, at the moment it is attacked.
  // This is the case where a foe holds a reference to a ward that vanishes.
  yank(w, rng) {
    for (const f of w.foes) {
      if (f.targetKind === 'ward' && f.target && !f.target.dead && rng() < 0.25) {
        w.sell(f.target);
      }
    }
    if (rng() < 0.35) {
      const c = rng.pick(CELLS);
      w.build(rng.pick(WARDS).id, c.i, c.j);
    }
    if (rng() < 0.2) w.repairStep(DT);
    if (rng() < 0.05) w.ready();
  },

  // Wall every lane mouth solid, then do nothing at all. Tests the state the
  // design explicitly permits (a sealed lane) with a player who never acts.
  turtle(w, rng) {
    if (w.phase === 'build') {
      for (const lane of LANES) {
        for (const o of [-3, -1, 1, 3]) {
          const p = laneAt(lane, 7, o);
          const c = cellOf(p.x, p.z);
          if (isBuildableCell(c.i, c.j)) w.build('palisade', c.i, c.j);
        }
      }
      w.ready();
    }
  },

  // Never build, never move, never fight. The pure-idle path — the one a
  // player hits by tabbing away mid-wave.
  idle() {},

  // ---- competent-but-hostile -------------------------------------------
  // The actors above all die in wave 1, so they only ever proved that the
  // first thirty seconds are safe: no breaker, no wisp, never more than ~24
  // foes. These wrap the real Bot so the game actually reaches wave 6 with a
  // full board, and commit the hostile act THERE, which is the only place the
  // interesting references exist.
  botYank(w, rng, bot) {
    bot.tick(DT);
    for (const f of w.foes) {
      // sell the wall a breaker is mid-swing on
      if (f.targetKind === 'ward' && f.target && !f.target.dead && rng() < 0.03) {
        w.sell(f.target);
      }
    }
  },

  botChurn(w, rng, bot) {
    bot.tick(DT);
    if (rng() < 0.3) {
      const c = rng.pick(CELLS);
      const standing = w.wardAtCell(c.i, c.j);
      if (standing) w.sell(standing);
      else w.build(rng.pick(WARDS).id, c.i, c.j);
    }
  },

  // Play properly, but dump the entire defence the moment wave 6 starts.
  botCollapse(w, rng, bot) {
    bot.tick(DT);
    if (w.waveIndex >= 5 && w.phase === 'combat' && rng() < 0.08) {
      const live = w.wards.filter(x => !x.dead);
      if (live.length) w.sell(rng.pick(live));
    }
  },

  // Play properly and never keep a ward — reaches deep waves with a naked map.
  botNaked(w, rng, bot) {
    const before = w.wards.length;
    bot.tick(DT);
    // NOT `while (w.wards.length > before)`. sell() only MARKS a ward dead;
    // the array is compacted at the end of step(), so the length does not drop
    // here and that loop never terminates. Walk the new entries by index.
    for (let i = before; i < w.wards.length; i++) w.sell(w.wards[i]);
  },

  // Try every illegal build the UI is supposed to prevent, to be certain the
  // World rejects them rather than relying on main.js to ask nicely.
  illegal(w, rng) {
    w.build('nonexistent', 4, 4);
    w.build('palisade', -5, 3);
    w.build('palisade', 9999, 3);
    w.build('palisade', 3, -5);
    w.build('palisade', GRID_N + 4, GRID_N + 4);
    const c = cellOf(0, 0);                 // dead centre: the plinth
    w.build('ballista', c.i, c.j);
    w.sell(null);
    w.sell({ dead: true });
    if (rng() < 0.3) {
      const cc = rng.pick(CELLS);
      w.build(rng.pick(WARDS).id, cc.i, cc.j);
    }
    if (rng() < 0.15) w.ready();
  },
};

// ---------------------------------------------------------------------------
export function runFuzz(log = console.log, opts = {}) {
  const allSeeds = opts.seeds || [1, 2, 3, 4, 5, 6, 7, 11, 19, 23];
  // Bot-backed actors play a FULL game each; the dumb ones die in wave 1 and
  // cost almost nothing. Give the expensive ones fewer seeds.
  const seedsFor = (n) => n.startsWith('bot') ? allSeeds.slice(0, 4) : allSeeds;
  const maxT = opts.maxT || 700;
  const names = opts.actors || Object.keys(ACTORS);
  let runs = 0, steps = 0, fails = 0;
  const failures = [];

  log('\n--- WARDSTONE fuzz ---\n');

  for (const name of names) {
    const actor = ACTORS[name];
    let worst = null;
    // Coverage. A fuzzer that terminates early is worse than none: it reports
    // green while testing nothing. These numbers are printed so that a clean
    // run can actually be believed. See [[asserts-must-fit-the-thing-tested]].
    const cov = { builds: 0, sells: 0, kills: 0, spawns: 0, wardLosses: 0,
      maxWave: 0, maxFoes: 0, maxDu: 0, ended: 0, tSum: 0 };
    const seeds = seedsFor(name);
    for (const seed of seeds) {
      const w = new World({ seed });
      const rng = makeRng(seed * 7919 + 13);
      // Bot-backed actors need a real policy underneath the hostility.
      const bot = name.startsWith('bot') ? new Bot(w, { build: true, fight: true }) : null;
      runs++;
      let n = 0;
      const cap = Math.round(maxT / DT);
      for (; n < cap && w.phase !== 'won' && w.phase !== 'lost'; n++) {
        try {
          actor(w, rng, bot);
          w.step(DT);
          for (const e of w.events) {
            if (e.type === 'build') cov.builds++;
            else if (e.type === 'sell') cov.sells++;
            else if (e.type === 'kill') cov.kills++;
            else if (e.type === 'spawn') cov.spawns++;
            else if (e.type === 'wardDown') cov.wardLosses++;
          }
          w.events.length = 0;
        } catch (e) {
          worst = `seed ${seed} step ${n}: THREW ${e.message}`;
          break;
        }
        const bad = checkAll(w);
        if (bad) { worst = `seed ${seed} step ${n} (t=${w.t.toFixed(1)}s): ${bad}`; break; }
        if (w.foes.length > cov.maxFoes) cov.maxFoes = w.foes.length;
        if (w.du > cov.maxDu) cov.maxDu = w.du;
      }
      cov.maxWave = Math.max(cov.maxWave, w.waveIndex + 1);
      cov.tSum += w.t;
      if (w.phase === 'won' || w.phase === 'lost') cov.ended++;
      steps += n;
      if (worst) break;
    }
    if (worst) {
      fails++; failures.push(`${name} — ${worst}`);
      log(`  FAIL  ${name.padEnd(8)} ${worst}`);
    } else {
      log(`  ok    ${name.padEnd(8)} ${seeds.length}x clean | ` +
        `built ${cov.builds}, sold ${cov.sells}, killed ${cov.kills}, wards lost ${cov.wardLosses} | ` +
        `peak ${cov.maxFoes} foes / ${cov.maxDu}du / wave ${cov.maxWave} | ` +
        `${cov.ended}/${seeds.length} ended, ${Math.round(cov.tSum / seeds.length)}s avg`);
      // A pass that exercised nothing is not a pass.
      if (cov.spawns === 0) {
        fails++;
        failures.push(`${name} — NO FOES EVER SPAWNED; the run tested nothing`);
        log(`  FAIL  ${name.padEnd(8)} coverage: no foes ever spawned`);
      }
    }
  }

  log(`\n  ${runs} runs, ${steps.toLocaleString()} steps, ${INVARIANTS.length} invariants checked per step`);
  log(fails ? `\n--- ${fails} actor(s) FAILED ---\n` : `\n--- all actors clean ---\n`);
  return { fails, failures, runs, steps };
}

export { ACTORS, INVARIANTS, checkAll };
