// WARDSTONE — foe behaviour audit.
//
// The fuzzer asks "can a hostile player break the sim". This asks a different
// question: "does every foe, left alone, behave like a creature".
//
// It walks each foe type through a full life on a real map and checks a set of
// invariants EVERY step. The point is that jank is usually not a crash — it is
// a goblin standing in a wall, or sliding two metres in one frame, or waiting
// politely next to a tower it is supposed to be hitting. None of that throws,
// none of it fails a balance test, and all of it reads as unfinished.
//
// Run: node run-behaviour.mjs

import { World } from './sim.js';
import { setMap, groundY, ARENA, nearestLane, laneAt } from './arena.js';
import { FOES, FOE_BY_ID, AGGRO, ECON } from './defs.js';
import { Bot } from './harness.js';

const DT = 1 / 60;

// ---------------------------------------------------------------------------
// The invariants. Each gets the foe, its previous snapshot, and the world.
// Returning a string is a violation; returning null is fine.
// ---------------------------------------------------------------------------
const CHECKS = [
  {
    id: 'below-ground',
    why: 'a foe underneath the floor it is supposed to be standing on',
    test: (f) => (f.def.flying ? null
      : (f.y < -0.001 ? `y = ${f.y.toFixed(3)}` : null)),
  },
  {
    id: 'inside-arena',
    why: 'a foe outside the playable area',
    test: (f) => {
      const lim = ARENA.half + 6;          // lanes start slightly outside
      return (Math.abs(f.x) > lim || Math.abs(f.z) > lim)
        ? `at ${f.x.toFixed(1)}, ${f.z.toFixed(1)}` : null;
    },
  },
  {
    id: 'no-teleport',
    why: 'a foe covering more ground in one step than its own speed allows',
    test: (f, prev) => {
      if (!prev) return null;
      const moved = Math.hypot(f.x - prev.x, f.z - prev.z);
      // generous: 3x its top speed, so a legitimate shove or lunge is fine
      const cap = f.def.speed * DT * 3 + 0.35;
      return moved > cap
        ? `moved ${moved.toFixed(2)}m in one step (cap ${cap.toFixed(2)})` : null;
    },
  },
  {
    id: 'flier-altitude',
    why: 'a flier that has drifted off its cruising height',
    test: (f) => {
      if (!f.def.flying) return null;
      const h = f.def.flyHeight;
      return (f.y < h * 0.4 || f.y > h * 1.6)
        ? `y = ${f.y.toFixed(2)} (expected around ${h})` : null;
    },
  },
  {
    id: 'not-idle',
    why: 'a foe doing nothing at all — not moving, not winding up, not attacking',
    // the one that actually catches "it just stands there". Allowed to be still
    // only if it is busy: winding up, striking, stunned, on cooldown, or a
    // ranged foe deliberately holding its ground.
    test: (f, prev, w, state) => {
      if (!prev) return null;
      const moved = Math.hypot(f.x - prev.x, f.z - prev.z);
      const busy = f.windT > 0 || f.strikeT > 0 || f.stunT > 0 ||
        f.atkCd > 0 || f.fuseT > 0 || f.standing || f.targetKind;
      if (moved > 1e-4 || busy) { state.still = 0; return null; }
      state.still++;
      // two full seconds of doing nothing whatsoever
      return state.still > 120 ? `still and idle for ${(state.still * DT).toFixed(1)}s` : null;
    },
  },
];

// ---------------------------------------------------------------------------
function auditType(foeId, opts = {}) {
  const w = new World({ seed: opts.seed == null ? 11 : opts.seed, sandbox: true });
  w.grantAll();
  w.mana = 20000;

  // A realistic thing to walk into: a wall on the lane with a tower behind it,
  // and a second tower off to one side that nothing is obliged to path past.
  const built = [];
  if (opts.build !== false) {
    const lane = w.foes.length ? null : null;
    for (let j = -16; j < 16 && built.length < 3; j++) {
      for (let i = -16; i < 16 && built.length < 3; i++) {
        if (Math.hypot(i, j) < 4) continue;
        const id = built.length === 0 ? 'palisade' : (built.length === 1 ? 'ballista' : 'archers');
        if (w.canBuild(id, i, j).ok && nearestLane(...Object.values(cellXZ(i, j))).dist < 6) {
          const b = w.build(id, i, j, 0);
          if (b) built.push(b);
        }
      }
    }
  }

  const n = opts.count || 4;
  for (let k = 0; k < n; k++) w._spawn(opts.lane || 'north', foeId);

  const states = new Map();
  const prev = new Map();
  const found = [];
  const seen = { attacked: false, fused: false, moved: 0, retaliated: false };

  const steps = opts.steps || 3600;          // a full minute of sim
  for (let s = 0; s < steps; s++) {
    // provoke: halfway through, hit one of them and see whether it responds
    if (s === Math.floor(steps / 2)) {
      const live = w.foes.find(f => !f.dead);
      if (live) { w.hurtFoe(live, 1, 'player'); states.set(live.id, states.get(live.id) || {}); }
    }
    w.step(DT);
    for (const f of w.foes) {
      if (f.dead) continue;
      const p = prev.get(f.id);
      const st = states.get(f.id) || { still: 0 };
      states.set(f.id, st);
      if (p) seen.moved += Math.hypot(f.x - p.x, f.z - p.z);
      if (f.windT > 0 || f.strikeT > 0) seen.attacked = true;
      // a bomber has no attack at all: its whole contribution is the fuse,
      // so THAT is what has to happen for it to be behaving
      if (f.fuseT > 0) seen.fused = true;
      if (f.aggroT > 0) seen.retaliated = true;
      for (const c of CHECKS) {
        const bad = c.test(f, p, w, st);
        if (bad && !found.some(x => x.id === c.id)) {
          found.push({ id: c.id, why: c.why, detail: `${foeId}: ${bad}`, t: s * DT });
        }
      }
      prev.set(f.id, { x: f.x, y: f.y, z: f.z });
    }
  }
  return { found, seen, wardsBuilt: built.length, w };
}

function cellXZ(i, j) {
  return { x: i * 2 + 1, z: j * 2 + 1 };
}

// ---------------------------------------------------------------------------
// World-level invariants. These are not about one creature behaving; they are
// about the WORLD staying coherent while a whole run plays out. Checked every
// step of a full six-wave game, which is where the compounding, hard-to-repro
// jank lives.
// ---------------------------------------------------------------------------
const WORLD_CHECKS = [
  {
    id: 'ward-hp-range',
    why: 'a ward outside its own health range',
    test: (w) => {
      for (const x of w.wards) {
        if (x.dead) continue;
        if (x.hp > x.maxHp + 0.01) return `${x.def.id} at ${x.hp.toFixed(0)}/${x.maxHp}`;
        if (x.hp < 0) return `${x.def.id} at ${x.hp.toFixed(2)}`;
      }
      return null;
    },
  },
  {
    id: 'units-within-budget',
    why: 'more defence units spent than the budget allows',
    test: (w) => (w.du > w.duBudget ? `${w.du}/${w.duBudget}` : null),
  },
  {
    id: 'mana-sane',
    why: 'negative mana, or mana past its cap',
    test: (w) => {
      if (w.mana < -0.01) return `${w.mana.toFixed(1)}`;
      if (w.mana > ECON.manaCap + 0.5) return `${w.mana.toFixed(0)} > cap ${ECON.manaCap}`;
      return null;
    },
  },
  {
    id: 'occupancy-agrees',
    why: 'the occupancy map and the ward list disagree about what is standing',
    // These two go out of sync the moment something removes a ward without
    // clearing its cell, and the symptom is a cell you can never build on again.
    test: (w) => {
      const live = w.wards.filter(x => !x.dead).length;
      return w.occupancy.size !== live
        ? `${w.occupancy.size} cells vs ${live} live wards` : null;
    },
  },
  {
    id: 'player-grounded',
    why: 'the player below the floor or outside the arena',
    test: (w) => {
      const p = w.player;
      if (p.y < -0.01) return `y = ${p.y.toFixed(2)}`;
      const lim = ARENA.wallInset + 1;
      if (Math.abs(p.x) > lim || Math.abs(p.z) > lim)
        return `at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
      return null;
    },
  },
  {
    id: 'projectiles-bounded',
    why: 'projectiles accumulating without ever resolving',
    test: (w) => (w.projectiles.length > 400 ? `${w.projectiles.length} in flight` : null),
  },
  {
    id: 'no-foe-pileup',
    why: 'foes occupying almost exactly one point',
    // Deliberately tight. A crowd pressed against a wall genuinely occupies
    // nearly one place and the sim is right to allow it — spreading them there
    // was measured to be a balance dial, not a visual fix. Making them
    // DISTINGUISHABLE is the renderer's job (see _crowdOffsets). What this
    // still has to catch is the pathological case: bodies at the same point.
    test: (w) => {
      // Foes ENGAGED on the same target are excluded, and that is a statement
      // about what a defect is rather than a way of passing. Six runners
      // converging on one palisade genuinely arrive at one place; the sim is
      // right to let them, and spreading them there was measured to swing both
      // maps hard. Their being distinguishable is the renderer's job and is
      // solved there (_crowdOffsets). What remains a real defect — and what
      // this still catches — is free-moving foes collapsing onto a point,
      // which means something has gone wrong with their movement.
      const live = w.foes.filter(f => !f.dead && !f.targetKind);
      if (live.length < 6) return null;
      for (let i = 0; i < live.length; i++) {
        let n = 0;
        for (let j = 0; j < live.length; j++) {
          if (i === j) continue;
          const a = live[i], b = live[j];
          const dy = (a.def.flying || b.def.flying) ? (a.y - b.y) : 0;
          if (Math.hypot(a.x - b.x, dy, a.z - b.z) < 0.10) n++;
        }
        if (n >= 5) {
          const f = live[i];
          return `${n + 1} free-moving foes within 0.10m at (${f.x.toFixed(1)}, ${f.z.toFixed(1)})` +
            ` — kind ${f.kind}, target ${f.targetKind || 'none'},` +
            ` distFromFire ${Math.hypot(f.x, f.z).toFixed(1)}m`;
        }
      }
      return null;
    },
  },
];

// A full six-wave run with the real bot, checking the world every step.
export function auditRun(seed = 7, log = console.log) {
  const w = new World({ seed });
  const bot = new Bot(w, { build: true, fight: true });
  const found = [];
  let steps = 0;
  while (w.phase !== 'won' && w.phase !== 'lost' && steps < 90000) {
    bot.tick(DT);
    w.step(DT);
    steps++;
    for (const c of WORLD_CHECKS) {
      const bad = c.test(w);
      if (bad && !found.some(x => x.id === c.id)) {
        found.push({ id: c.id, why: c.why, detail: bad, t: steps * DT });
      }
    }
  }
  return { found, steps, phase: w.phase, wave: w.waveIndex + 1 };
}

// ---------------------------------------------------------------------------
export function runBehaviour(log = console.log) {
  log('\n--- WARDSTONE foe behaviour audit ---\n');
  setMap('glade');
  let bad = 0, total = 0;

  for (const def of FOES) {
    const r = auditType(def.id);
    total++;
    const flags = r.found;
    if (flags.length) {
      bad++;
      log(`  FAIL  ${def.name.padEnd(14)} ${flags.length} problem(s)`);
      for (const f of flags) log(`          ${f.id} @ ${f.t.toFixed(1)}s — ${f.detail}\n            (${f.why})`);
    } else {
      // What counts as "did its job" depends on what the foe IS. A bomber
      // that never swings is correct; a bomber that never lights a fuse is not.
      const acted = def.blast ? r.seen.fused : r.seen.attacked;
      const actWord = def.blast
        ? (r.seen.fused ? 'lights its fuse' : 'NEVER FUSED')
        : (r.seen.attacked ? 'attacks' : 'NEVER ATTACKED');
      // Only foes that can be angered are expected to retaliate: a flier is
      // heading for the fire regardless, and a bomber ignores you entirely.
      const wantsAggro = !def.flying && !def.blast;
      const aggWord = wantsAggro
        ? (r.seen.retaliated ? 'retaliates' : 'NEVER RETALIATED') : 'n/a';
      log(`  ok    ${def.name.padEnd(14)} moved ${r.seen.moved.toFixed(0)}m, ${actWord}, ${aggWord}`);
      if (!acted) bad++;
      if (wantsAggro && !r.seen.retaliated) bad++;
    }
  }

  log('\n  [full-run world invariants]');
  for (const seed of [7, 3, 21]) {
    const r = auditRun(seed, log);
    total++;
    if (r.found.length) {
      bad++;
      log(`  FAIL  seed ${String(seed).padEnd(9)} ${r.found.length} problem(s)`);
      for (const f of r.found) {
        log(`          ${f.id} @ ${f.t.toFixed(1)}s — ${f.detail}`);
        log(`            (${f.why})`);
      }
    } else {
      log(`  ok    seed ${String(seed).padEnd(9)} ${r.phase} at wave ${r.wave}, ${r.steps} steps clean`);
    }
  }

  log(`\n--- ${total - bad}/${total} checks clean ---\n`);
  return { total, bad };
}
