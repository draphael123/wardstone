// WARDSTONE — the guided tutorial.
//
// A list of steps, each with a prompt and a CHECK that reads the world. It
// overlays the normal game rather than replacing it: the muster phase is held
// open until the lessons are done, and a couple of foes are spawned on demand
// so the combat lessons have something to practise on.
//
// The order is the order the game's ideas depend on each other: move, build a
// wall, put something behind it, shoot, swap, roll, then the two lessons that
// are the whole premise — Wall Goblins ignore your lanes, and a Giant Goblin outpaces your
// hammer. Nothing here teaches a control the player will not need in wave one.

import { LANE_BY_ID, distToLane, nearestLane } from './arena.js';

export const STEPS = [
  {
    id: 'move',
    point: null,          // movement has no button to point at
    title: 'Get your feet',
    text: 'Move with <b>W A S D</b>. Hold the <b>right mouse button</b> and drag to look around.',
    touch: 'Move with the <b>stick</b>. Drag anywhere to look around.',
    check: (w, s) => s.moved > 9,
  },
  {
    id: 'wall',
    point: '.ward[data-id="palisade"]',
    title: 'Block a track',
    text: 'Press <b>{ward1}</b> for a Palisade, then <b>click a green square</b> on one of the dirt tracks. ' +
          'Goblins do not walk around walls — they stop and hack at them.',
    touch: 'Tap <b>Palisade</b>, then tap a <b>green square</b> on a dirt track.',
    check: (w) => w.wards.some(x => !x.dead && x.def.id === 'palisade' &&
      nearestLane(x.x, x.z).dist < 4.5),
  },
  {
    id: 'ballista',
    point: '.ward[data-id="ballista"]',
    title: 'Something behind it',
    text: 'A wall deals no damage. Press <b>{ward2}</b> and place a <b>Ballista</b> just behind your wall, ' +
          'where it can shoot whatever stops there.',
    touch: 'Tap <b>Ballista</b> and place it just behind your wall.',
    setup: (w) => w.grant('ballista'),
    check: (w) => w.wards.some(x => !x.dead && x.def.id === 'ballista'),
  },
  {
    id: 'shoot',
    point: '#weap',       // touch has a Loose button; desktop clicks the field
    title: 'Your crossbow',
    text: 'Two of them are coming up the track. <b>Left click</b> to loose a bolt.',
    touch: 'Two are coming. Hold <b>Loose</b> to shoot.',
    spawn: [['north', 'husk'], ['north', 'husk']],
    check: (w, s) => s.playerKills >= 1,
  },
  {
    id: 'swap',
    point: '#weap',
    title: 'Your sword',
    text: 'Press <b>{swap}</b> to draw your sword. It hits far harder and sweeps everything in front of you — ' +
          'but only within arm’s reach, and it cannot touch anything airborne. Kill one with it.',
    touch: 'Tap <b>Swap</b> for your sword — harder hitting, but only up close. Kill one with it.',
    spawn: [['east', 'husk'], ['east', 'runner']],
    check: (w, s) => s.swordKills >= 1,
  },
  {
    id: 'chain',
    point: null,
    title: 'The sword is a chain',
    text: 'Three swings, not one. Each click links into the next if you keep going, and the ' +
          '<b>third lands hardest</b>. Hold the button instead and you wind up a <b>heavy</b>: ' +
          'slower, costs energy, and the only thing that goes through a raised shield.',
    touch: 'Tap to chain three swings &mdash; the third lands hardest. Hold to wind up a heavy.',
    spawn: [['north', 'husk'], ['north', 'husk'], ['north', 'husk']],
    check: (w, s) => s.chain >= 3 || s.heavies >= 1,
  },
  {
    id: 'guard',
    point: '#blockChip',
    title: 'Your shield, and what it costs',
    text: 'Hold <b>{block}</b> to raise your shield. It cuts what gets through and slows you down, ' +
          'and it <b>drains the green bar</b> &mdash; energy, which the heavy and the bash also spend. ' +
          'Run it dry and the shield drops on its own.',
    touch: 'Hold <b>Block</b> to raise your shield. It drains energy, which your heavy and bash also spend.',
    spawn: [['north', 'husk'], ['east', 'husk']],
    check: (w, s) => s.blocked >= 1,
  },
  {
    id: 'roll',
    point: '#roll',
    title: 'Get out of trouble',
    text: 'Press <b>{roll}</b> to roll. You are briefly untouchable while you do, and it is on a short timer.',
    touch: 'Tap <b>Roll</b>. You are briefly untouchable, on a short timer.',
    check: (w, s) => s.rolled >= 1,
  },
  {
    id: 'rally',
    point: '#abil',
    title: 'Shield bash',
    text: 'Press <b>{rally}</b> to <b>bash</b>. It is a short frontal shove &mdash; about three metres, ' +
          'in the arc you are facing &mdash; that stuns what it catches and knocks it back. ' +
          'It costs energy and has a long cooldown: it is what you spend to get out of a corner.',
    touch: 'Tap <b>Bash</b>. A short frontal shove that stuns and knocks back what it catches.',
    spawn: [['north', 'husk'], ['north', 'husk'], ['east', 'runner']],
    check: (w, s) => s.rallied >= 1,
  },
  {
    id: 'mana',
    title: 'Mana does not come to you',
    text: 'Mana drops where things die and has to be <b>walked over</b>. That is the reason to leave your wall.',
    check: (w, s) => s.motes >= 1,
  },
  {
    // The lesson the whole game rests on. It used to be the will-o-wisp; with
    // the air gone, the Wall Goblin carries it — same job, on the ground.
    id: 'climber',
    point: null,
    title: 'This one does not use the road',
    text: 'A <b>Wall Goblin</b>. It comes over the rocks instead of down a track, so it never meets ' +
          'the wall you built or the gun behind it — everything you build sits on a <b>lane</b>, ' +
          'and this has no lane. Your wards barely scratch it. <b>Kill it yourself.</b>',
    touch: 'A <b>Wall Goblin</b> — it comes over the rocks, past everything you built. Kill it yourself.',
    spawn: [['north', 'climber'], ['east', 'climber']],
    check: (w, s) => (s.killsByKind.climber || 0) >= 1,
  },
  {
    id: 'mend',
    point: '#wpMend',
    title: 'Mending, and its limit',
    text: 'Hold <b>{mend}</b> beside a damaged ward to mend it for mana. ' +
          'It will not save you from a Troll: one ruins a wall faster than you can mend it. ' +
          'A wall buys you time to kill it, and nothing else.',
    touch: 'Hold <b>Mend</b> beside a damaged ward. It will not out-heal a Troll.',
    // Scuff a ward so there is something to mend. Without this the step's
    // "everything is already at full health" escape fired the instant it
    // became current, and the one lesson that states the premise outright
    // flashed past unread. Measured: the step was skipped every single run.
    setup: (w) => {
      const live = w.wards.filter(x => !x.dead);
      if (!live.length) return;
      const worst = live.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b));
      worst.hp = Math.min(worst.hp, worst.maxHp * 0.45);
    },
    check: (w, s) => s.mended > 60 || !w.wards.some(x => !x.dead),
  },
  {
    id: 'ready',
    point: '#ready',
    title: 'Hold the fire',
    text: 'That is everything. Spend what mana you have, then press <b>{rotate}</b> to call the first wave. ' +
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
      mended: 0, rallied: 0, killsByKind: {},
      blocked: 0, litBrazier: 0, heavies: 0, braced: 0, chain: 0,
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
    if (ev.type === 'rally') s.rallied++;
    if (ev.type === 'block' && ev.on) s.blocked++;
    if (ev.type === 'brazier' && ev.lit) s.litBrazier++;
    if (ev.type === 'swing' && ev.kind === 'heavy') s.heavies++;
    if (ev.type === 'bolt' && ev.braced) s.braced++;
    // the chain only counts when it actually reaches the third link
    if (ev.type === 'swing' && ev.hits > 0) {
      s.chain = (world.player.combo === 0 && s.chain >= 2) ? 3 : s.chain + 1;
    }
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

  // Whatever a step needs staged, done once when it becomes current: foes to
  // practise on, and any world change the lesson depends on.
  takeSpawns(world) {
    if (this.done || this.shown === this.i) return null;
    this.shown = this.i;
    const st = STEPS[this.i];
    if (!st) return [];
    if (st.setup && world) st.setup(world);
    return st.spawn ? st.spawn : [];
  }
}
