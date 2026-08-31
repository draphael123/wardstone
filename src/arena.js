// WARDSTONE — the map.
//
// Three hand-authored lanes and a build grid. There is no navmesh and no
// flow field, and that is the single decision that makes this genre cheap:
// foes walk a fixed polyline from their door to the stone, and a blockade in
// the way is not repathed around, it is ATTACKED. Dungeon Defenders does the
// same thing, and it is why the game ships.
//
// Consequence worth stating: a lane can be sealed completely and that is legal.
// Nothing here validates reachability, because "the wall is the point".

import { makeRng } from './rand.js';

import { WARDSTONE } from './defs.js';

export const ARENA = {
  half: 38,        // floor spans -38..38 on both axes
  wallInset: 36,   // the player is bound inside this
  buildInset: 34,  // wards may not be placed outside this
};

// ---------------------------------------------------------------------------
// Lanes. Each bends at least twice: a straight lane has exactly one good ward
// position (the far end) and a bent one has three or four, which is the whole
// reason to author them by hand.
// ---------------------------------------------------------------------------
// Maps. Lane IDs are deliberately the SAME across maps (north/east/west) so
// the wave table is untouched when the map changes — that isolates GEOMETRY as
// the single variable when asking whether the unit budget generalises or is
// merely fitted to the arena it was tuned in.
export const MAPS = {
  // The arena everything was balanced in: three lanes of comparable length,
  // each bending twice.
  // Level one. The LANES are unchanged from the arena every balance number
  // was swept in — only the theme differs — so the entire sweep, both arms and
  // all 28 assertions carry over untouched. Art is a skin; geometry is not.
  glade: {
    name: 'The Glade',
    theme: 'forest',
    blurb: 'Three tracks into the clearing, and one fire.',
    lanes: [
      // `widths` is one entry PER POINT and interpolates along the lane, so a
      // track pinches and opens instead of being a corridor of constant bore.
      // That is the whole of the chokepoint design: a 3m pinch is sealed by two
      // palisades where an 8m mouth needs five, so WHERE you wall a lane is a
      // decision with a price attached rather than a formality.
      //
      // The three lanes deliberately choke in three different PLACES, which is
      // what stops them being one lane drawn three times:
      //   north  chokes in the middle, at the top of its dog-leg
      //   east   chokes LATE, close enough to the fire to be a last stand
      //   west   chokes at the MOUTH, so it can be corked before it starts
      // Every throat sits in the first third of its lane. That is not an
      // accident and it is the whole finding of this pass: a chokepoint deep
      // in a lane is a TRAP, not an opportunity. Walling one 29m in costs two
      // palisades instead of six and still loses, because a wall is worth
      // nothing on its own — it is worth what your guns kill while the queue
      // is stopped at it, and a wall that far in sits outside their reach.
      // Measured: the same pinches walled at the throat 0/21, walled at the
      // door 19/21. A chokepoint has to be somewhere you would want to fight
      // anyway; then it makes the natural play CHEAPER instead of luring you
      // somewhere your battery cannot follow.
      //
      // The three differ in the KIND of throat, not its depth:
      //   north  one tight gate at 10m, then it opens right out
      //   east   a long narrow neck, 10m to 19m — looser, but cheap for longer
      //   west   a corridor from the doorstep, so it can be corked at the mouth
      // The extra points on each first segment are COLLINEAR — they change no
      // geometry at all, they exist so the width profile has the resolution to
      // hold a throat FLAT for a few metres.
      //
      // A V-shaped pinch is not a chokepoint. A palisade fills a 2m cell, so
      // sealing samples the width across d-1.2..d+1.2, and on a V that picks up
      // the widening shoulders: the throat measured 3.4m and the wall still had
      // to be built for 4.6m, saving one unit out of five. A flat bottom is
      // what makes the saving real.
      { id: 'north', name: 'The Stair',
        points: [[0, -34], [0, -30], [0, -26], [0, -24], [8, -18], [8, -9], [2, -3], [0, 0]],
        widths: [6.5, 3.0, 2.8, 2.8, 6.5, 7, 6.5, 6] },
      { id: 'east', name: 'The Undercroft',
        points: [[34, 10], [30, 10], [26, 10], [24, 10], [17, 4], [9, 4], [3, 1.5], [0, 0]],
        widths: [7, 4.4, 2.9, 2.9, 3.3, 7.2, 6.5, 5.5] },
      { id: 'west', name: 'The Sluice',
        points: [[-34, -2], [-30, -2], [-26, -2], [-24, -2], [-16, -6], [-8, -6], [-3, -2], [0, 0]],
        widths: [2.8, 2.8, 3.2, 4.2, 7, 7.5, 7, 6] },
    ],
    terraces: [
    // Positions are not hand-picked; they came out of a clearance search that
    // measures every square metre of the pad AND its ramp aprons against every
    // lane's own local width. Nothing bigger than this fits beside a lane, which
    // is why they are 9x8 rather than the 13x12 the first draft assumed — a
    // terrace that overlaps a track would change the wave's route, and the whole
    // point is that it does not.
    //
    // Two of the three sit right beside a road, close enough to shoot down onto
    // it. The third is behind the fire, where the off-lane Wall Goblins converge.
    { x: -14, z: -20, rx: 4.5, rz: 4.0, h: 1.15,
      ramps: [{ side: 'w', at: 0, w: 3.0 }, { side: 'n', at: 0, w: 3.0 }] },
    { x: 24, z: -10, rx: 4.5, rz: 4.0, h: 1.15,
      ramps: [{ side: 'e', at: 0, w: 3.0 }, { side: 'n', at: 0, w: 3.0 }] },
    { x: -10, z: 14, rx: 4.5, rz: 4.0, h: 1.45,
      ramps: [{ side: 's', at: 0, w: 3.2 }, { side: 'w', at: 0, w: 3.0 }] },
    ],
  },

  // The asymmetric test: one long winding approach worth ~3x the walking time
  // of the other two, which arrive almost straight. If 32 units still works
  // here, the budget is a property of the design; if it does not, the budget
  // is a property of the crypt and has to scale off lane length.
  gauntlet: {
    name: 'The Gauntlet',
    theme: 'forest',
    lanes: [
      { id: 'north', name: 'The Long Way',
        points: [[26, -28], [26, -16], [14, -12], [14, -2], [22, 6], [22, 14],
                 [8, 18], [0, 12], [0, 0]], width: 5 },
      { id: 'east', name: 'The Breach',
        points: [[36, 4], [24, 4], [12, 2], [0, 0]], width: 7 },
      { id: 'west', name: 'The Drain',
        points: [[-36, -8], [-24, -6], [-12, -3], [0, 0]], width: 5 },
    ],
  },
};

function buildLane(raw) {
  const pts = raw.points;
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    segs.push({ ax: a[0], az: a[1], dx: dx / len, dz: dz / len, len, start: total });
    total += len;
  }
  // `width` survives as the lane's WIDEST point. Everything that needs the
  // width somewhere specific asks widthAt(); everything that needs a safe
  // bound — a spawn clamp, a render extent — can still read .width and never
  // be too small.
  const width = raw.widths ? Math.max(...raw.widths) : raw.width;
  return { ...raw, segs, total, width };
}

// The lane's width at a distance along it. Linear between the authored points,
// which is enough: a pinch reads as a funnel because the DIRT narrows, and a
// smoother curve would not change where the two palisades go.
export function widthAt(lane, d) {
  const ws = lane.widths;
  if (!ws) return lane.width;
  const segs = lane.segs;
  const dc = d < 0 ? 0 : (d > lane.total ? lane.total : d);
  let i = segs.length - 1;
  for (let k = 0; k < segs.length; k++) {
    if (dc <= segs[k].start + segs[k].len) { i = k; break; }
  }
  const s = segs[i];
  const t = s.len > 0 ? (dc - s.start) / s.len : 0;
  const a = ws[i], b = ws[i + 1] == null ? ws[i] : ws[i + 1];
  return a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);
}

// How wide the lane is where this point sits beside it. Used by anything that
// has a world position rather than a lane distance.
export function widthNear(lane, x, z) {
  return widthAt(lane, alongLane(lane, x, z));
}

// `let`, not `const`: ES module named exports are LIVE bindings, so importers
// see the new lanes after setMap() without any of them holding a stale copy.
// Stamp each map with its own key so anything holding a map object can name it
// — a save file has to record which map it belongs to, and passing the object
// around otherwise loses that.
for (const [k, m] of Object.entries(MAPS)) m.id = k;

export let MAP_ID = 'glade';
export let LANES = MAPS.glade.lanes.map(buildLane);
export let LANE_BY_ID = Object.fromEntries(LANES.map(l => [l.id, l]));

export function currentMap() { return MAPS[MAP_ID]; }

export function rebuildProps() { PROPS = buildProps(); PROP_CELLS = null; }

export function setMap(id) {
  const m = MAPS[id];
  if (!m) throw new Error('no such map: ' + id);
  MAP_ID = id;
  LANES = m.lanes.map(buildLane);
  LANE_BY_ID = Object.fromEntries(LANES.map(l => [l.id, l]));
  PROPS = null;                  // lanes moved; re-laid on next use
  PROP_CELLS = null;
  TERRACES = MAPS[id].terraces || [];
  RAMPS = null;
  MOUNDS = null;
  return m;
}

// Position along a lane at arc-length `d`, with lateral offset `off`.
// The offset tapers to zero over the last TAPER metres so that everything
// converges on the stone instead of striking it from a spread-out arc.
const TAPER = 7;
// Metres either side of a bend over which the lane's normal turns, rather than
// flipping in a single frame.
//
// Deliberately the SMALLEST value that removes the jump, not the smoothest one.
// This shifts where foes actually walk, and the gauntlet is sensitive to it —
// swept over 21 seeds on both maps, a 2.2m blend cost that map 14/21 -> 8/21
// because the bot's ward placements are sized for the old lane shape. At 0.4m
// the behaviour audit is clean and the balance is the best of any value tried.
const LANE_BLEND = 0.4;

export function laneAt(lane, d, off, out) {
  out = out || { x: 0, z: 0, dx: 0, dz: 0 };
  const dc = Math.max(0, Math.min(lane.total, d));
  let s = lane.segs[lane.segs.length - 1], si = lane.segs.length - 1;
  for (let i = 0; i < lane.segs.length; i++) {
    const g = lane.segs[i];
    if (dc <= g.start + g.len) { s = g; si = i; break; }
  }
  const t = dc - s.start;
  const remaining = lane.total - dc;
  const k = remaining < TAPER ? remaining / TAPER : 1;
  const o = (off || 0) * k;

  // The direction the OFFSET is measured against, blended through corners.
  //
  // This used to be the current segment's tangent, full stop — so the instant a
  // foe's arclength crossed a bend, the perpendicular flipped to the new
  // segment's and the foe SNAPPED sideways by up to twice its lateral offset.
  // Measured by the behaviour audit: every ground foe jumped 1.0-1.4m in a
  // single frame, on every lane, within the first few seconds. The centreline
  // was always continuous; only the normal was not.
  let ndx = s.dx, ndz = s.dz;
  if (si > 0 && t < LANE_BLEND) {
    const p = lane.segs[si - 1];
    const u = 0.5 + 0.5 * (t / LANE_BLEND);
    const e = u * u * (3 - 2 * u);
    ndx = p.dx + (s.dx - p.dx) * e;
    ndz = p.dz + (s.dz - p.dz) * e;
  } else if (si < lane.segs.length - 1 && (s.len - t) < LANE_BLEND) {
    const q = lane.segs[si + 1];
    const u = 0.5 * (1 - (s.len - t) / LANE_BLEND);
    const e = u * u * (3 - 2 * u);
    ndx = s.dx + (q.dx - s.dx) * e;
    ndz = s.dz + (q.dz - s.dz) * e;
  }
  const nl = Math.hypot(ndx, ndz) || 1;
  ndx /= nl; ndz /= nl;

  // left normal of (dx,dz) is (dz,-dx)
  out.x = s.ax + s.dx * t + ndz * o;
  out.z = s.az + s.dz * t - ndx * o;
  out.dx = s.dx;
  out.dz = s.dz;
  return out;
}

// Shortest distance from a point to a lane centreline. Used to paint the floor
// and by the harness to prove a ward actually sits on the lane it claims to.
export function distToLane(lane, x, z) {
  let best = Infinity;
  for (const s of lane.segs) {
    const px = x - s.ax, pz = z - s.az;
    let t = px * s.dx + pz * s.dz;
    t = t < 0 ? 0 : (t > s.len ? s.len : t);
    const qx = px - s.dx * t, qz = pz - s.dz * t;
    const d = Math.hypot(qx, qz);
    if (d < best) best = d;
  }
  return best;
}

// How far ALONG the lane the nearest point to (x,z) sits. Needed now that the
// width varies: "how wide is the lane here" has no answer without it.
export function alongLane(lane, x, z) {
  let best = Infinity, along = 0;
  for (const s of lane.segs) {
    const px = x - s.ax, pz = z - s.az;
    let t = px * s.dx + pz * s.dz;
    t = t < 0 ? 0 : (t > s.len ? s.len : t);
    const qx = px - s.dx * t, qz = pz - s.dz * t;
    const d = Math.hypot(qx, qz);
    if (d < best) { best = d; along = s.start + t; }
  }
  return along;
}

export function nearestLane(x, z) {
  let best = null, bd = Infinity;
  for (const l of LANES) {
    const d = distToLane(l, x, z);
    if (d < bd) { bd = d; best = l; }
  }
  return { lane: best, dist: bd };
}

// ---------------------------------------------------------------------------
// The height of the visible ground at a point.
//
// This exists because everything that walks was drawn at y = 0 while the ground
// the player can SEE is the sward at 0.16 and the worn dirt of a track at 0.285.
// Every goblin stood 16-28cm inside the terrain, and — worse — sank further the
// instant it stepped from grass onto a track, because the ground changed height
// under it and the foe did not. Reported as "the goblins fall through the
// terrain" and "they don't remain consistent as they move", and it was both.
//
// One function, imported by everything that stands on the floor, so a foe, the
// player and a ward can never disagree about where the floor is.
// ---------------------------------------------------------------------------
export const SWARD_Y = 0.16;   // the grass plane
export const LANE_Y = 0.285;   // the top face of a worn dirt track

// Raised ground.
//
// The clearing was dead flat, which is why it read as a floor with things
// standing on it rather than as a place. These are broad, low swells in the
// open ground between the lanes.
//
// Two rules make them safe. They are generated clear of every lane, so no
// metre of track changes height. And `sim.js` does not import groundY at all
// — the simulation's world is flat and only the RENDERER lifts things onto
// the ground — so the shape of the clearing cannot move the balance by
// construction, not merely by measurement.
//
// Wide and shallow on purpose: a swell 12m across and 50cm tall rises about
// 8cm over the 2m of a build cell, so a ward standing on one sits on it
// rather than tilting off it. The verticality you read is the horizon
// breaking up behind the fight, not a hill to climb.
let MOUNDS = null;
function buildMounds() {
  const rng = makeRng(31337);
  const out = [];
  for (let i = 0; i < 90 && out.length < 22; i++) {
    const a = rng() * Math.PI * 2;
    const d = 14 + rng() * (ARENA.half - 16);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const r = 9 + rng() * 7;
    const h = 0.30 + rng() * 0.34;
    if (Math.hypot(x, z) < 13) continue;             // never under the fire
    if (nearestLane(x, z).dist < r + 3) continue;    // never under a lane
    out.push({ x, z, r, h });
  }
  return out;
}
export function mounds() {
  if (MOUNDS === null) MOUNDS = buildMounds();
  return MOUNDS;
}

// The bank height alone, with no lane blending. The ground MESH is displaced
// by this, while the worn tracks are drawn as their own flat strips on top —
// so the two must not both carry the lane term or the tracks would sit 12cm
// inside the grass they are meant to be worn into.
export function moundY(x, z) {
  const ms = mounds();
  let y = 0;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    const dx = x - m.x, dz = z - m.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= m.r * m.r) continue;
    const k = 1 - Math.sqrt(d2) / m.r;
    // MAX, not sum. Summing stacked the overlaps into 2.8m spikes with cliff
    // faces across build cells; taking the highest bank makes two that meet
    // read as one longer ridge, which is also the better shape.
    const v = m.h * (k * k * (3 - 2 * k));
    if (v > y) y = v;
  }
  // The rim. The swells shape the ground you fight on; this is what gives the
  // clearing a HORIZON. Ground beyond radius 35 climbs away into the treeline,
  // so the wood stands on a rising bank rather than on the same flat plane you
  // do, and the eye reads a bowl with a lip instead of a floor with a fence.
  //
  // It starts outside ARENA.wallInset (36) and is quadratic, so at the very
  // edge of where the player can walk it is under 2cm — nothing that can be
  // stood on, climbed, or built on ever leaves the flat.
  //
  // Measured on the SQUARE metric, not the radius, because the arena is a
  // square: a radial rim reaches 4m under the corner build cells while leaving
  // the edge cells alone, which is exactly backwards. On max(|x|,|z|) it
  // starts at 36.5 — half a metre outside the player's own bound — so no cell
  // anything can stand on, walk to, or build in is touched at all.
  const sq = Math.max(Math.abs(x), Math.abs(z));
  if (sq > 36.5 && sq < 120) {
    const k = Math.min(1, (sq - 36.5) / 13);
    y += 7.0 * k * k;
  }
  return y;
}


// ---------------------------------------------------------------------------
// TERRACES — the raised ground you fight ON.
//
// The earlier verticality pass was swells and a rim: relief you could see and
// nothing could stand on. This is the other thing entirely. A terrace is a
// rectangle of ground about a metre up, and the only way onto it is a RAMP.
//
// That single rule is what makes height a position rather than a decoration:
//
//   * you can hold the top of a ramp against a crowd, because they arrive in
//     single file instead of surrounding you
//   * you can be flanked up there, because every terrace has more than one
//   * you can drop off an edge for free, but you cannot climb one — so
//     retreating upward costs you the walk to a ramp, and retreating downward
//     is instant
//
// Lane foes are untouched: no terrace is ever placed on a lane, so the wave
// still walks its polyline and the whole balance sweep carries over. What the
// terraces change is where the BODY fights — you, and the things that come off
// the road after you.
// ---------------------------------------------------------------------------
export const STEP_UP = 0.34;    // the most any body may climb without a ramp

// Authored, not generated. Three terraces is a shape you can learn; a random
// scatter of them is a cluttered field with nowhere in particular to stand.
// Each is placed in the open ground BETWEEN two lanes, which is exactly where
// the off-lane foes walk and where the player has no wall to hide behind.
// Terraces belong to a MAP, exactly as lanes do.
//
// They were module-level at first and applied to every map, so the glade's
// three landed wherever they happened to fall on the gauntlet — on its lanes,
// as it turned out, which quietly rerouted that map's waves and took it from
// 17/21 to 10/21. The clearance search that placed them was run against the
// glade's roads and means nothing anywhere else.
export let TERRACES = MAPS.glade.terraces || [];

// A ramp as a world-space box, plus the direction "up" points.
function rampBox(t, r) {
  const L = 4.2;                      // how far the slope runs out from the edge
  if (r.side === 'e') return { x0: t.x + t.rx, x1: t.x + t.rx + L, z0: t.z + r.at - r.w / 2, z1: t.z + r.at + r.w / 2, ax: 'x', dir: -1 };
  if (r.side === 'w') return { x0: t.x - t.rx - L, x1: t.x - t.rx, z0: t.z + r.at - r.w / 2, z1: t.z + r.at + r.w / 2, ax: 'x', dir: 1 };
  if (r.side === 'n') return { x0: t.x + r.at - r.w / 2, x1: t.x + r.at + r.w / 2, z0: t.z - t.rz - L, z1: t.z - t.rz, ax: 'z', dir: 1 };
  return { x0: t.x + r.at - r.w / 2, x1: t.x + r.at + r.w / 2, z0: t.z + t.rz, z1: t.z + t.rz + L, ax: 'z', dir: -1 };
}

let RAMPS = null;
export function ramps() {
  if (RAMPS === null) {
    RAMPS = [];
    for (const t of TERRACES) for (const r of t.ramps) RAMPS.push({ ...rampBox(t, r), h: t.h, t });
  }
  return RAMPS;
}

// How high the walkable surface is here, above the sward. Flat on top of a
// terrace, sloped on a ramp, zero everywhere else.
export function terraceY(x, z) {
  for (const t of TERRACES) {
    if (Math.abs(x - t.x) <= t.rx && Math.abs(z - t.z) <= t.rz) return t.h;
  }
  for (const r of ramps()) {
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
    // 0 at the outer end, full height where it meets the terrace
    const u = r.ax === 'x'
      ? (r.dir > 0 ? (x - r.x0) / (r.x1 - r.x0) : (r.x1 - x) / (r.x1 - r.x0))
      : (r.dir > 0 ? (z - r.z0) / (r.z1 - r.z0) : (r.z1 - z) / (r.z1 - r.z0));
    return r.h * Math.max(0, Math.min(1, u));
  }
  return 0;
}

// Can a body at (x0,z0) step to (x1,z1)?
//
// Up is gated, down is free. That asymmetry IS the mechanic: holding a terrace
// means holding its ramps, and bailing off the side is always available to you
// and to everything chasing you.
export function canStep(x0, z0, x1, z1) {
  const a = terraceY(x0, z0), b = terraceY(x1, z1);
  return b - a <= STEP_UP;
}

export function groundY(x, z) {
  let y = SWARD_Y + moundY(x, z) + terraceY(x, z);
  const n = nearestLane(x, z);
  if (n.lane) {
    // Blended across the verge rather than a hard step: a 12cm cliff at the edge
    // of every track would read as a stutter every time anything walked on.
    const half = widthNear(n.lane, x, z) / 2;
    const a = half - 0.5, b = half + 0.7;
    const t = n.dist <= a ? 1 : (n.dist >= b ? 0 : 1 - (n.dist - a) / (b - a));
    const e = t * t * (3 - 2 * t);          // smoothstep
    y += (LANE_Y - SWARD_Y) * e;
  }
  return y;
}

// ---------------------------------------------------------------------------
// Solid scenery.
//
// Trees, boulders and cairns were pure decoration living in the renderer, so
// you walked through them — reported, and it makes the whole clearing feel
// like a painted backdrop rather than a place.
//
// The positions are generated HERE, deterministically, so the sim can collide
// with exactly what the renderer draws. Nothing is placed on a lane, in a
// buildable cell, or near the fire: a prop that blocked a lane would change the
// balance, and one on a build cell would be a square you can never use.
// ---------------------------------------------------------------------------
let PROPS = null;
// Built on FIRST USE rather than at module load or in setMap(). At load the
// lanes it needs may not be laid yet, and setMap() is never called at all by
// the browser build — which left the collider list empty and the scenery
// walk-through-able while every headless test saw it populated.
export function solidProps() {
  if (PROPS === null) PROPS = buildProps();
  return PROPS;
}

function buildProps() {
  const rng = makeRng(90210);
  const out = [];
  const H = ARENA.half;
  const tryPut = (x, z, r, kind) => {
    if (Math.hypot(x, z) < 12) return false;          // keep the hearth clear
    if (nearestLane(x, z).dist < 3.6 + r) return false; // never narrows a lane
    if (Math.abs(x) > H - 1 || Math.abs(z) > H - 1) return false;
    for (const p of out) {
      if (Math.hypot(p.x - x, p.z - z) < p.r + r + 0.5) return false;
    }
    out.push({ x, z, r, kind });
    return true;
  };

  // --- COPSES AND CAIRNS, in the open ground you actually fight in.
  //
  // This is the fix to "we need collision with objects like trees". The player
  // and the wards always collided with this list — but the list was empty
  // inside the arena. Every candidate was thrown out by a guard that refused
  // any buildable cell, and buildable cells cover nearly all of it: 49
  // colliders existed and 0 of them were in the clearing. Everything you could
  // see and walk through was scattered separately by the renderer.
  //
  // They are allowed to take build cells now, and isBuildableCell() refuses
  // those squares. A tree standing on ground you cannot wall is the honest
  // version of this: the scenery constrains where a defence can go, which is
  // what makes it terrain instead of decoration.
  //
  // CLUSTERED, not scattered. A copse is a landmark you can navigate by and
  // fight around; twenty evenly-spread trunks are just noise with collision on.
  const CLUSTERS = 7;
  for (let c = 0; c < CLUSTERS; c++) {
    const a = (c / CLUSTERS) * Math.PI * 2 + rng() * 0.7;
    const d = 15 + rng() * 13;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    const treeish = rng() < 0.55;
    const n = 3 + ((rng() * 4) | 0);
    for (let k = 0; k < n; k++) {
      const ka = rng() * Math.PI * 2, kd = rng() * 3.4;
      tryPut(
        cx + Math.cos(ka) * kd, cz + Math.sin(ka) * kd,
        treeish ? 1.1 + rng() * 0.5 : 0.6 + rng() * 0.4,
        treeish ? 'tree' : 'rock',
      );
    }
  }
  // a few loners between the copses, so the clearing is not "clumps and void"
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2, d = 13 + rng() * (H - 18);
    tryPut(Math.cos(a) * d, Math.sin(a) * d, 0.6 + rng() * 0.7, rng() < 0.4 ? 'tree' : 'rock');
  }
  // the treeline itself is solid, which is what stops you leaving the clearing
  for (let i = 0; i < 150; i++) {
    const a = (i / 150) * Math.PI * 2 + rng() * 0.04;
    const d = H - 2 + rng() * 5;
    tryPut(Math.cos(a) * d, Math.sin(a) * d, 0.85 + rng() * 0.5, 'tree');
  }
  return out;
}

// Which build cells a solid prop sits on. Built once alongside the props.
let PROP_CELLS = null;
function propCells() {
  if (PROP_CELLS === null) {
    PROP_CELLS = new Set();
    for (const p of solidProps()) {
      const reach = p.r + 0.35;
      for (let x = p.x - reach; x <= p.x + reach + 1e-6; x += 0.5) {
        for (let z = p.z - reach; z <= p.z + reach + 1e-6; z += 0.5) {
          if (Math.hypot(x - p.x, z - p.z) > reach) continue;
          const c = cellOf(x, z);
          PROP_CELLS.add(cellKey(c.i, c.j));
        }
      }
    }
  }
  return PROP_CELLS;
}

// ---------------------------------------------------------------------------
// Build grid. 2m cells. A ward occupies exactly one cell, which keeps
// placement legible and makes occupancy an O(1) map lookup rather than a
// pairwise overlap test.
// ---------------------------------------------------------------------------
export const CELL = 2;
export const GRID_N = (ARENA.half * 2) / CELL;   // 38

export function cellOf(x, z) {
  return {
    i: Math.floor((x + ARENA.half) / CELL),
    j: Math.floor((z + ARENA.half) / CELL),
  };
}

export function cellCenter(i, j) {
  return {
    x: -ARENA.half + i * CELL + CELL / 2,
    z: -ARENA.half + j * CELL + CELL / 2,
  };
}

export function cellKey(i, j) { return i * 1000 + j; }

// Terrain-only legality. Occupancy is the World's business, not the map's.
export function isBuildableCell(i, j) {
  if (i < 0 || j < 0 || i >= GRID_N || j >= GRID_N) return false;
  const c = cellCenter(i, j);
  if (Math.abs(c.x) > ARENA.buildInset || Math.abs(c.z) > ARENA.buildInset) return false;
  // Nothing inside the plinth. +1.6 keeps a ward from clipping the stone mesh.
  if (Math.hypot(c.x, c.z) < WARDSTONE.radius + 1.6) return false;
  // Nor on top of a tree or a boulder. This is what makes the scenery terrain:
  // it takes ground away from your defence as well as from your feet.
  if (propCells().has(cellKey(i, j))) return false;
  return true;
}

export function clampToArena(x, z, r) {
  const lim = ARENA.wallInset - (r || 0);
  return {
    x: Math.max(-lim, Math.min(lim, x)),
    z: Math.max(-lim, Math.min(lim, z)),
  };
}

// Where each lane's door sits, for spawn VFX and the minimap.
export function laneDoor(lane) {
  const p = lane.points[0];
  return { x: p[0], z: p[1] };
}


// ---------------------------------------------------------------------------
// THE HALL.
//
// The home room. It lives in the same scene as the arena, 400m away — far past
// the fog, so nothing of one is ever visible from the other — rather than in a
// scene of its own.
//
// That is deliberate and it is the whole reason this was cheap: the player rig,
// the camera, the controls, the sword, the damage numbers and the HUD are the
// same objects doing the same job. A separate scene would have meant a second
// copy of all of it, and the renderer has no teardown path to swap between two.
// The bounded rim above is what makes it work — past 120m the ground is flat
// again, so the hall does not sit 7m up the arena's earthworks.
// ---------------------------------------------------------------------------
export const HALL = {
  x: 0, z: 400,           // where the room sits in world space
  half: 15,               // interior half-extent, wall to wall
  door: { x: 0, z: 409 }, // where you stand in
};

export function inHall(x, z) {
  return Math.hypot(x - HALL.x, z - HALL.z) < 120;
}

export function clampToHall(x, z, r) {
  const lim = HALL.half - (r || 0);
  return {
    x: HALL.x + Math.max(-lim, Math.min(lim, x - HALL.x)),
    z: HALL.z + Math.max(-lim, Math.min(lim, z - HALL.z)),
  };
}

// The things you can walk up to. Each is a PLACE rather than a menu entry,
// which is the entire point of having a room at all: picking a difficulty is
// standing at the muster stone, not ticking a box on a title screen.
export const STATIONS = [
  // A gate PER MAP, side by side at the far end, each with the road it opens
  // written on it. One portal that silently meant "whatever was last selected"
  // is a menu wearing an arch; two you can walk between is a choice you make
  // with your feet.
  { id: 'gate:glade',    name: 'The Glade',    map: 'glade',    x: -5.2, z: 388, r: 3.0,
    prompt: 'March out' },
  { id: 'gate:gauntlet', name: 'The Gauntlet', map: 'gauntlet', x: 5.2,  z: 388, r: 3.0,
    prompt: 'March out' },
  { id: 'board',   name: 'The Muster Board', x: 0,    z: 404.5, r: 3.0,
    prompt: 'Look over the muster' },
  { id: 'dummy',   name: 'The Pells',        x: -9.3, z: 400,   r: 3.4,
    prompt: 'Practise' },
  { id: 'rack',    name: 'The Ward Rack',    x: 8.5,  z: 400,   r: 2.6,
    prompt: 'Inspect the wards' },
  { id: 'muster',  name: 'The Muster Stone', x: 6.8,  z: 407.6, r: 2.6,
    prompt: 'Choose the watch' },
];

export function nearestStation(x, z) {
  let best = null, bd = Infinity;
  for (const s of STATIONS) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < s.r && d < bd) { bd = d; best = s; }
  }
  return best;
}
