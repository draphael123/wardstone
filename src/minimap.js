// WARDSTONE — the minimap.
//
// Three lanes 68 m apart and a chase camera means you cannot see the lane you
// are not standing on. That is the single largest readability gap in the game:
// without this you find out the west wall fell by watching the wardstone bar
// drop. Canvas 2D, redrawn from the same World the 3D scene reads.
//
// It deliberately shows FOES and WARD HEALTH and nothing else clever. The
// question it has to answer at a glance is "which lane is in trouble?".

import { LANES, ARENA, laneAt } from './arena.js';
import { WARDSTONE as STONE_DEF } from './defs.js';

// World forward for a yaw is (sin, cos). The map draws world x to the right
// and world z DOWNWARD, so a world yaw becomes a screen angle measured from
// +x as atan2(cos, sin). Derived, not guessed: a rotate() with a hand-picked
// offset is how a facing indicator ends up mirrored.
const screenAngle = (yaw) => Math.atan2(Math.cos(yaw), Math.sin(yaw));

const COL = {
  bg: 'rgba(10,13,20,0.72)',
  edge: 'rgba(255,255,255,0.14)',
  lane: 'rgba(138,111,208,0.5)',
  laneHot: 'rgba(200,120,255,0.95)',
  stone: '#ffb347',
  stoneLow: '#e0605a',
  player: '#e9e6dd',
  ward: '#7fe08a',
  wardHurt: '#e0a04a',
  husk: '#b9b3a0',
  runner: '#8fbf6a',
  climber: '#a8c95e',
  breaker: '#ff6a5a',
};

export class Minimap {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = 0;
    this._lanePaths = null;
    this.resize();
  }

  // Measuring while the HUD is still display:none returns 0, which clamps the
  // backing store to the 60px floor and then stretches it to 150 — a blurry
  // map that looks like a rendering bug. So the measurement is re-taken until
  // it agrees with the element, rather than once at construction.
  resize() {
    const r = this.cv.getBoundingClientRect();
    if (r.width < 1) { this.size = 0; return; }   // not laid out yet
    const s = Math.round(r.width);
    if (s === this.size && this.cv.width === Math.round(s * this.dpr)) return;
    this.size = s;
    this.cv.width = Math.round(s * this.dpr);
    this.cv.height = Math.round(s * this.dpr);
    this._lanePaths = null;
  }

  // world (x,z) -> canvas px
  _p(x, z) {
    const k = this.size / (ARENA.half * 2 + 6);
    return [(x + ARENA.half + 3) * k, (z + ARENA.half + 3) * k];
  }

  _buildLanePaths() {
    this._lanePaths = LANES.map((lane) => {
      const pts = [];
      for (let d = 0; d <= lane.total; d += 2) {
        const q = laneAt(lane, d, 0);
        pts.push(this._p(q.x, q.z));
      }
      return { id: lane.id, pts };
    });
  }

  draw(world, camYaw, incoming) {
    // Re-measure now and then: the element's size changes with orientation,
    // and the first measurement can land before the HUD is laid out at all.
    if ((this._tick = (this._tick || 0) + 1) % 20 === 1) this.resize();
    const ctx = this.ctx;
    const s = this.size;
    if (!s) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);

    // plate
    ctx.fillStyle = COL.bg;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 0, s, s, 6) : ctx.rect(0, 0, s, s);
    ctx.fill();
    ctx.strokeStyle = COL.edge;
    ctx.lineWidth = 1;
    ctx.stroke();

    // lanes — a lane with something on it lights up, so "which door is live?"
    // is answered without counting dots.
    if (!this._lanePaths) this._buildLanePaths();
    const hot = {};
    for (const f of world.foes) {
      if (!f.dead && f.lane) hot[f.lane.id] = (hot[f.lane.id] || 0) + 1;
    }
    ctx.lineCap = 'round';
    for (const lp of this._lanePaths) {
      const live = hot[lp.id] || 0;
      ctx.strokeStyle = live ? COL.laneHot : COL.lane;
      ctx.lineWidth = live ? 2.4 : 1.4;
      ctx.beginPath();
      for (let i = 0; i < lp.pts.length; i++) {
        const [px, py] = lp.pts[i];
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }

    // wards, sized by health so a wall being eaten visibly thins
    for (const wd of world.wards) {
      if (wd.dead) continue;
      const [px, py] = this._p(wd.x, wd.z);
      const f = wd.hp / wd.maxHp;
      ctx.fillStyle = f > 0.55 ? COL.ward : COL.wardHurt;
      const r = 1.4 + f * 1.4;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }

    // foes
    for (const f of world.foes) {
      if (f.dead) continue;
      const [px, py] = this._p(f.x, f.z);
      ctx.fillStyle = COL[f.kind] || '#fff';
      const r = f.kind === 'breaker' ? 3.6 : (f.kind === 'climber' ? 2.1 : 1.7);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      if (f.kind === 'breaker') {          // the one foe worth interrupting for
        ctx.strokeStyle = COL.breaker;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, 5.5 + Math.sin(world.t * 5) * 1.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // the stone, pulsing and going cold exactly as the 3D one does
    {
      const [px, py] = this._p(0, 0);
      const sf = Math.max(0, world.stone.hp / world.stone.maxHp);
      ctx.fillStyle = sf > 0.35 ? COL.stone : COL.stoneLow;
      ctx.globalAlpha = 0.28;
      ctx.beginPath(); ctx.arc(px, py, 4 + 5 * sf, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(px, py - 4); ctx.lineTo(px + 4, py);
      ctx.lineTo(px, py + 4); ctx.lineTo(px - 4, py);
      ctx.closePath(); ctx.fill();
    }

    // Incoming, per door: the count for the NEXT wave, drawn at each lane's
    // mouth during the muster so you can see where to spend before you spend.
    if (incoming) {
      for (const lp of this._lanePaths) {
        const info = incoming[lp.id];
        if (!info || !info.total) continue;
        const [px, py] = lp.pts[0];
        const cx = Math.max(11, Math.min(s - 11, px));
        const cy = Math.max(9, Math.min(s - 9, py));
        ctx.fillStyle = 'rgba(10,13,20,0.9)';
        ctx.strokeStyle = 'rgba(255,179,71,0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(cx - 10, cy - 7, 20, 14, 3)
                      : ctx.rect(cx - 10, cy - 7, 20, 14);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffd89a';
        ctx.font = '700 10px ui-monospace,Menlo,Consolas,monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(info.total), cx, cy + 0.5);
        // a pip per foe type that door is sending
        let ox = cx - 8;
        for (const k of ['husk', 'runner', 'climber', 'breaker']) {
          if (!info.kinds[k]) continue;
          ctx.fillStyle = COL[k];
          ctx.fillRect(ox, cy + 8, 4, 2.5);
          ox += 5.5;
        }
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      }
    }

    // the player, as an arrow so facing is readable, plus the camera wedge
    const p = world.player;
    if (p.alive) {
      const [px, py] = this._p(p.x, p.z);
      const camA = screenAngle(camYaw);
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, 17, camA - 0.52, camA + 0.52);
      ctx.closePath();
      ctx.fill();

      const pa = screenAngle(p.yaw);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(pa);                 // arrow is authored pointing along +x
      ctx.fillStyle = COL.player;
      ctx.beginPath();
      ctx.moveTo(4.6, 0); ctx.lineTo(-3.2, 3); ctx.lineTo(-1.6, 0); ctx.lineTo(-3.2, -3);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}
