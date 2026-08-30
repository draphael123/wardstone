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
const RAW_LANES = [
  {
    id: 'north', name: 'The Stair',
    points: [[0, -34], [0, -24], [8, -18], [8, -9], [2, -3], [0, 0]],
    width: 6,
  },
  {
    id: 'east', name: 'The Undercroft',
    points: [[34, 10], [24, 10], [17, 4], [9, 4], [3, 1.5], [0, 0]],
    width: 6,
  },
  {
    id: 'west', name: 'The Sluice',
    points: [[-34, -2], [-24, -2], [-16, -6], [-8, -6], [-3, -2], [0, 0]],
    width: 6,
  },
];

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
  return { ...raw, segs, total };
}

export const LANES = RAW_LANES.map(buildLane);
export const LANE_BY_ID = Object.fromEntries(LANES.map(l => [l.id, l]));

// Position along a lane at arc-length `d`, with lateral offset `off`.
// The offset tapers to zero over the last TAPER metres so that everything
// converges on the stone instead of striking it from a spread-out arc.
const TAPER = 7;
export function laneAt(lane, d, off, out) {
  out = out || { x: 0, z: 0, dx: 0, dz: 0 };
  const dc = Math.max(0, Math.min(lane.total, d));
  let s = lane.segs[lane.segs.length - 1];
  for (let i = 0; i < lane.segs.length; i++) {
    const g = lane.segs[i];
    if (dc <= g.start + g.len) { s = g; break; }
  }
  const t = dc - s.start;
  const remaining = lane.total - dc;
  const k = remaining < TAPER ? remaining / TAPER : 1;
  const o = (off || 0) * k;
  // left normal of (dx,dz) is (dz,-dx)
  out.x = s.ax + s.dx * t + s.dz * o;
  out.z = s.az + s.dz * t - s.dx * o;
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

export function nearestLane(x, z) {
  let best = null, bd = Infinity;
  for (const l of LANES) {
    const d = distToLane(l, x, z);
    if (d < bd) { bd = d; best = l; }
  }
  return { lane: best, dist: bd };
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
