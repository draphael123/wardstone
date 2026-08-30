// WARDSTONE — the guided tutorial.
//
// A list of steps, each with a prompt and a CHECK that reads the world. It
// overlays the normal game rather than replacing it: the muster phase is held
// open until the lessons are done, and a couple of foes are spawned on demand
// so the combat lessons have something to practise on.
//
// The order is the order the game's ideas depend on each other: move, build a
// wall, put something behind it, shoot, swap, roll, then the two lessons that
// are the whole premise — wisps ignore your wall, and a breaker outpaces your
// hammer. Nothing here teaches a control the player will not need in wave one.

import { LANE_BY_ID, distToLane, nearestLane } from './arena.js';

export const STEPS = [
  {
    id: 'move',
    title: 'Get your feet',
    text: 'Move with <b>W A S D</b>. Hold the <b>right mouse button</b> and drag to look around.',
    touch: 'Move with the <b>stick</b>. Drag anywhere to look around.',
    check: (w, s) => s.moved > 9,
  },
  {
    id: 'wall',
    title: 'Block a track',
    text: 'Press <b>1</b> for a Palisade, then <b>click a green square</b> on one of the dirt tracks. ' +
          'Goblins do not walk around walls — they stop and hack at them.',
    touch: 'Tap <b>Palisade</b>, then tap a <b>green square</b> on a dirt track.',
    check: (w) => w.wards.some(x => !x.dead && x.def.id === 'palisade' &&
      nearestLane(x.x, x.z).dist < 4.5),
  },
  {
    id: 'ballista',
    title: 'Something behind it',
    text: 'A wall deals no damage. Press <b>2</b> and place a <b>Ballista</b> just behind your wall, ' +
          'where it can shoot whatever stops there.',
    touch: 'Tap <b>Ballista</b> and place it just behind your wall.',
    check: (w) => w.wards.some(x => !x.dead && x.def.id === 'ballista'),
  },
  {
    id: 'shoot',
    title: 'Your crossbow',
    text: 'Two of them are coming up the track. <b>Left click</b> to loose a bolt.',
    touch: 'Two are coming. Hold <b>Loose</b> to shoot.',
    spawn: [['north', 'husk'], ['north', 'husk']],
    check: (w, s) => s.playerKills >= 1,
  },
  {
    id: 'swap',
    title: 'Your sword',
    text: 'Press <b>Q</b> to draw your sword. It hits far harder and sweeps everything in front of you — ' +
          'but only within arm’s reach, and it cannot touch anything airborne. Kill one with it.',
    touch: 'Tap <b>Swap</b> for your sword — harder hitting, but only up close. Kill one with it.',
    spawn: [['east', 'husk'], ['east', 'runner']],
    check: (w, s) => s.swordKills >= 1,
  },
  {
    id: 'roll',
    title: 'Get out of trouble',
    text: 'Press <b>Space</b> to roll. You are briefly untouchable while you do, and it is on a short timer.',
    touch: 'Tap <b>Roll</b>. You are briefly untouchable, on a short timer.',
    check: (w, s) => s.rolled >= 1,
  },
  {
    id: 'mana',
    title: 'Mana does not come to you',
    text: 'Mana drops where things die and has to be <b>walked over</b>. That is the reason to leave your wall.',
    check: (w, s) => s.motes >= 1,
  },
  {
    id: 'wisp',
    title: 'This one does not walk',
    text: 'A will-o-wisp. It flies <b>straight over every wall you own</b>. Only the Brazier can reach one, ' +
          'and it is the weakest ward you have — so mostly this is your job. ' +
          'Press <b>Q</b> for your crossbow and shoot it down.',
    touch: 'A will-o-wisp — it flies <b>over</b> your walls. Tap <b>Swap</b> for the crossbow and shoot it.',
    spawn: [['north', 'wisp']],
    check: (w, s) => (s.killsByKind.wisp || 0) >= 1,
  },
  {
    id: 'mend',
    title: 'Mending, and its limit',
    text: 'Hold <b>E</b> beside a damaged ward to mend it for mana. ' +
          'It will not save you from a Troll: one ruins a wall faster than you can mend it. ' +
          'A wall buys you time to kill it, and nothing else.',
    touch: 'Hold <b>Mend</b> beside a damaged ward. It will not out-heal a Troll.',
    check: (w, s) => s.mended > 40 || w.wards.every(x => x.dead || x.hp >= x.maxHp * 0.999),
  },
  {
    id: 'ready',
    title: 'Hold the fire',
    text: 'That is everything. Spend what mana you have, then press <b>R</b> to call the first wave. ' +
          'Six of them. If the fire goes out, you are done.',
    touch: 'That is everything. Spend your mana, then tap <b>Ready</b>.',
    check: (w) => w.phase === 'combat',
  },
];

export class Tutorial {
  constructor(world) {
    this.w = world;
    this.i = 0;
    this.done = false;
    this.shown = -1;
    // counters the checks read; the sim knows nothing about any of this
    this.s = {
      moved: 0, playerKills: 0, swordKills: 0, rolled: 0, motes: 0,
      mended: 0, killsByKind: {},
    };
    this._px = world.player.x;
    this._pz = world.player.z;
  }

  get step() { return this.done ? null : STEPS[this.i]; }

  // Called with the events already drained by main, so this never competes
  // with the renderer for them.
  note(ev, world) {
    const s = this.s;
    if (ev.type === 'kill') {
      s.killsByKind[ev.foe] = (s.killsByKind[ev.foe] || 0) + 1;
      if (ev.by === 'player') {
        s.playerKills++;
        if (ev.withWeapon === 'sword') s.swordKills++;
      }
    }
    if (ev.type === 'mote') s.motes++;
    if (ev.type === 'dodge') s.rolled++;
  }

  tick(dt, world, playerDidKill, weapon) {
    if (this.done) return;
    const p = world.player;
    this.s.moved += Math.hypot(p.x - this._px, p.z - this._pz);
    this._px = p.x; this._pz = p.z;

    const st = STEPS[this.i];
    if (!st) { this.done = true; return; }
    if (st.check(world, this.s)) {
      this.i++;
      if (this.i >= STEPS.length) this.done = true;
      return true;                       // advanced
    }
    return false;
  }

  // Foes a step needs, spawned once when the step becomes current.
  takeSpawns() {
    if (this.done || this.shown === this.i) return null;
    this.shown = this.i;
    const st = STEPS[this.i];
    return st && st.spawn ? st.spawn : [];
  }
}
