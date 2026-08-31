// WARDSTONE — wiring.
//
// Owns the loop, the input and the DOM. It is the only file that knows a
// browser exists AND knows the rules exist; sim.js has no DOM, render.js has
// no rules, and this is where the two are introduced to each other.

import * as THREE from '../vendor/three.module.js';
import { World } from './sim.js';
import { Renderer, PAL } from './render.js';
import { Sound, playEvent } from './audio.js';
import { Minimap } from './minimap.js';
import { Tutorial, STEPS } from './tutorial.js';
import {
  WARDS, WARD_BY_ID, ECON, WAVES, PLAYER, ABILITY, waveByLane, DIFFICULTY, UPGRADE,
  ENERGY, WARDSTONE,
} from './defs.js';
import {
  cellOf, cellCenter, isBuildableCell, ARENA, LANES, laneDoor, MAPS, currentMap,
} from './arena.js';

const $ = (id) => document.getElementById(id);

// Fade an overlay out, then take it out of the layout on a TIMER. Relying on
// the CSS transition alone leaves the element stuck at whatever opacity it had
// reached if the tab loses focus mid-fade — the transition simply stops.
// See [[css-transition-stalls-when-unfocused]].
function hideOverlay(el, ms = 750) {
  el.classList.add('gone');
  clearTimeout(el._hideT);
  el._hideT = setTimeout(() => el.classList.add('hidden'), ms);
}
function showOverlay(el) {
  clearTimeout(el._hideT);
  el.classList.remove('hidden');
  void el.offsetWidth;
  el.classList.remove('gone');
}
// ---------------------------------------------------------------------------
// Key bindings.
//
// Every key the game reads goes through here. Nothing compares a raw key string
// any more, which is the only way remapping stays honest — a single hardcoded
// `k === 'q'` left behind is a control the player cannot rebind and will not
// understand why.
//
// `ready` and `rotate` deliberately share a key: with a ward in hand it turns
// the ghost, with empty hands it calls the wave. They are one binding because
// they are one button to the player.
// ---------------------------------------------------------------------------
const ACTIONS = [
  { id: 'up', name: 'Move forward', def: 'w' },
  { id: 'down', name: 'Move back', def: 's' },
  { id: 'left', name: 'Move left', def: 'a' },
  { id: 'right', name: 'Move right', def: 'd' },
  { id: 'swap', name: 'Swap weapon', def: 'q' },
  { id: 'roll', name: 'Roll', def: ' ' },
  { id: 'jump', name: 'Jump', def: 'shift' },
  { id: 'block', name: 'Block', def: 'control' },
  { id: 'rally', name: 'Rally', def: 'v' },
  { id: 'mend', name: 'Mend (hold)', def: 'e' },
  { id: 'build', name: 'Build view', def: 'tab' },
  { id: 'rotate', name: 'Rotate / Ready', def: 'r' },
  { id: 'upgrade', name: 'Upgrade ward', def: 'f' },
  { id: 'sell', name: 'Sell ward', def: 'x' },
  { id: 'ward1', name: 'Pick ward 1', def: '1' },
  { id: 'ward2', name: 'Pick ward 2', def: '2' },
  { id: 'ward3', name: 'Pick ward 3', def: '3' },
  { id: 'ward4', name: 'Pick ward 4', def: '4' },
];
const ACTION_BY_ID = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

// Keys that always mean the same thing and cannot be rebound onto, because
// losing them would leave the player with no way out of a menu.
const RESERVED = new Set(['escape']);

function defaultBinds() {
  const o = {};
  for (const a of ACTIONS) o[a.id] = a.def;
  return o;
}

// action id -> key, and the reverse lookup rebuilt whenever it changes

function rebuildKeymap() {
  state.keyToAction = {};
  for (const [id, key] of Object.entries(state.binds)) {
    if (!key) continue;
    (state.keyToAction[key] = state.keyToAction[key] || []).push(id);
  }
}

// Is this action's key down right now? Movement also accepts the arrows
// unconditionally, because a player who rebinds WASD has not thereby asked for
// the arrow keys to stop working.
const ARROWS = { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };
function held(action) {
  const k = state.binds[action];
  if (k && state.keys.has(k)) return true;
  return !!(ARROWS[action] && state.keys.has(ARROWS[action]));
}

function keyLabel(k) {
  if (!k) return '—';
  if (k === ' ') return 'Space';
  if (k === 'control') return 'Ctrl';
  if (k.length === 1) return k.toUpperCase();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

const STEP = 1 / 60;
// How long the pale 'you just lost this' bar hangs before draining.
const GHOST_HOLD = 420;

const isTouch = window.matchMedia('(pointer: coarse)').matches ||
  ('ontouchstart' in window && Math.min(screen.width, screen.height) < 900);

const state = {
  world: null, rend: null, snd: null,
  running: false, selected: null,
  keys: new Set(),
  move: { x: 0, y: 0 },        // -1..1 from stick or WASD
  firing: false, mending: false, wantDodge: false, blocking: false,
  pointer: { x: 0, y: 0, has: false },
  ghostCell: null, ghostRot: null, overhead: false, showAbil: false, wantJump: false,
  binds: defaultBinds(), keyToAction: {},
  inspect: null, runFrom: null,
  acc: 0, last: 0, lastFrame: 0, hitstop: 0,
  vel: { x: 0, z: 0 },
  hintShown: new Set(),
  low: isTouch,
  musicOn: true, soundOn: true, dmgNums: false,
  musVol: 0.34, sfxVol: 0.9, difficulty: 'knight', paused: false,
  shakeAmt: 1, sens: 1, fov: 62, minimap: true, calm: false,
  autoPause: true, fps: false, autoWave: false,
  hpBars: true, shake: true, tutorial: true, tut: null,
};

// ---------------------------------------------------------------------------
// Ground pick. Turns a screen point into the grid cell under it. Everything
// about building goes through this one function.
// ---------------------------------------------------------------------------
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();

function pickCell(px, py) {
  const r = state.rend;
  if (!r) return null;
  const rect = r.canvas.getBoundingClientRect();
  _ndc.x = ((px - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((py - rect.top) / rect.height) * 2 + 1;
  _ray.setFromCamera(_ndc, r.camera);
  if (!_ray.ray.intersectPlane(_plane, _hit)) return null;
  const lim = ARENA.half;
  if (Math.abs(_hit.x) > lim || Math.abs(_hit.z) > lim) return null;
  return cellOf(_hit.x, _hit.z);
}

// The cell in front of the player, used when there is no pointer (touch, before
// the first tap) so the ghost is never nowhere.
function cellAhead() {
  const w = state.world, r = state.rend;
  const p = w.player;
  const d = 7;
  return cellOf(p.x - Math.sin(r.camYaw) * -d, p.z - Math.cos(r.camYaw) * -d);
}

// ---------------------------------------------------------------------------
// Build bar
// ---------------------------------------------------------------------------
function buildBar() {
  const bar = $('bar');
  bar.innerHTML = '';
  const icons = { palisade: '&#9776;', ballista: '&#10142;' };
  for (const w of WARDS) {
    const el = document.createElement('div');
    el.className = 'ward';
    el.dataset.id = w.id;
    el.innerHTML =
      `<div class="k">${w.key}</div>` +
      `<div class="ic">${icons[w.id]}</div>` +
      `<div class="nm">${w.name}</div>` +
      `<div class="cost mono">${w.cost}<s>${w.du}u</s></div>` +
      `<div class="lock"></div>`;
    el.title = w.blurb;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.world.isUnlocked(w.id)) select(w.id);
      else state.snd.play('hover', 0.6, 0.7);
    });
    el.addEventListener('pointerenter', () => state.snd && state.snd.play('hover'));
    bar.appendChild(el);
  }
}

let dragHintShown = false;
function select(id) {
  // Drag-to-build has existed for rounds and was reported missing, for the same
  // reason the ward panel was: nothing on screen said the gesture was there.
  if (id && WARD_BY_ID[id] && WARD_BY_ID[id].kind === 'blockade' && !dragHintShown) {
    dragHintShown = true;
    toast('Click to place one &mdash; or <b>drag</b> to lay a whole run of them');
  }
  state.selected = state.selected === id ? null : id;
  state.ghostRot = null;      // each pick starts square-on to the track again
  for (const el of document.querySelectorAll('.ward')) {
    el.classList.toggle('sel', el.dataset.id === state.selected);
  }
  if (state.snd) state.snd.play('select');
  if (!state.selected) state.rend.hideGhost();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
let lastStoneHp = -1;
function syncHud() {
  const w = state.world;
  const wave = WAVES[Math.min(w.waveIndex, WAVES.length - 1)];
  $('waveNo').textContent = Math.min(w.waveIndex + 1, WAVES.length);
  $('waveName').textContent = wave ? wave.name : '—';

  if (w.phase === 'build') {
    $('phase').innerHTML = `Muster &mdash; <b>${Math.ceil(w.phaseTimer)}s</b>`;
    $('ready').classList.remove('gone');
    // The countdown lives ON the button. It used to sit in the corner while the
    // button said only "Ready", so the two never looked related.
    $('ready').textContent = `Ready · ${Math.ceil(w.phaseTimer)}s`;
    // Auto-start: skip the wait entirely once there is nothing left to spend on.
    if (state.autoWave && w.phaseTimer > 1.5) w.phaseTimer = 1.5;
  } else if (w.phase === 'combat') {
    const left = w.spawnQueue.length + w.foes.length;
    $('phase').innerHTML = `<b>${left}</b> still coming`;
    $('ready').classList.add('gone');
  } else {
    $('phase').textContent = w.phase === 'won' ? 'Held.' : 'The light is out.';
    $('ready').classList.add('gone');
  }

  $('manaN').textContent = Math.floor(w.mana);
  const duEl = $('duN');
  duEl.textContent = `${w.du}/${ECON.duBudget}`;
  duEl.classList.toggle('full', w.du >= ECON.duBudget);

  const sf = Math.max(0, w.stone.hp / w.stone.maxHp);
  const fill = $('stoneFill');
  fill.style.width = (sf * 100) + '%';
  fill.classList.toggle('low', sf < 0.35);

  const hw = $('hpWrap');
  if (hw) hw.classList.toggle('warming', !!w.player.warming);
  // Health, with a ghost bar that lags behind it. Scale rather than width so
  // the browser animates a transform instead of relaying out the bar.
  const hf = Math.max(0, w.player.hp / w.player.maxHp);
  const hp = $('hpFill');
  hp.style.transform = `scaleX(${hf})`;
  hp.classList.toggle('low', hf < 0.35);
  $('hpNum').textContent = `${Math.max(0, Math.ceil(w.player.hp))} / ${w.player.maxHp}`;
  // The ghost only ever CATCHES UP. It drops to the current value on a delay
  // after damage, and snaps up instantly on a heal, so it always reads as
  // "this is what you just lost" and never as a second health bar.
  //
  // Driven by a TIMESTAMP, not a timeout. The first version re-armed a
  // setTimeout on every frame that health was below the ghost — which is every
  // frame after a hit — so it cleared itself before it could ever fire and the
  // ghost would have hung at full health permanently.
  const ghost = $('hpGhost');
  const now = performance.now();
  if (state._ghost == null || hf >= state._ghost) {
    state._ghost = hf;              // healed, or first frame: snap up
    state._ghostHold = null;
  } else {
    if (state._ghostHold == null) state._ghostHold = now;
    if (now - state._ghostHold > GHOST_HOLD) {
      state._ghost = hf;            // held long enough; let it drain
      state._ghostHold = null;
    }
  }
  ghost.style.transform = `scaleX(${state._ghost})`;

  // Energy, and the charge overlaid on it.
  const ef = Math.max(0, Math.min(1, w.player.energy / ENERGY.max));
  const en = $('enFill');
  en.style.transform = `scaleX(${ef})`;
  en.classList.toggle('low', w.player.energy < ENERGY.heavy);
  // While a heavy is charging, a pale bar fills across exactly the slice of
  // energy the swing will cost — so the meter shows both "how charged" and
  // "what it will take" in one shape.
  const hold = w.player.holdT;
  const charging = hold > 0 && hold < 900 && !w.player.atkPhase &&
    w.weaponDef(w.player).kind === 'melee';
  const cg = $('enCharge');
  if (charging) {
    const k = Math.min(1, hold / PLAYER.weapons.sword.heavy.charge);
    const slice = (ENERGY.heavy / ENERGY.max) * k;
    cg.style.transform = `scaleX(${Math.min(ef, slice)})`;
  } else {
    cg.style.transform = 'scaleX(0)';
  }

  const mf = Math.max(0, Math.min(1, w.mana / ECON.manaCap));
  $('mpFill').style.transform = `scaleX(${mf})`;
  $('mpNum').textContent = Math.floor(w.mana);

  for (const el of document.querySelectorAll('.ward')) {
    const d = WARD_BY_ID[el.dataset.id];
    const locked = !w.isUnlocked(d.id);
    el.classList.toggle('locked', locked);
    el.classList.toggle('poor', !locked &&
      (w.mana < d.cost || w.du + d.du > ECON.duBudget));
    const lk = el.querySelector('.lock');
    if (lk) lk.textContent = locked ? `wave ${(d.unlockWave || 0) + 1}` : '';
  }

  const p = w.player;
  const wp = $('weap');
  if (wp) {
    wp.textContent = PLAYER.weapons[p.weapon].name;
    // Assigning className wholesale wiped any other class on this element
    // every frame — which silently deleted the tutorial's pointer ring the
    // instant it was added. Touch only the classes this actually owns.
    wp.classList.toggle('sword', p.weapon === 'sword');
    wp.classList.toggle('crossbow', p.weapon === 'crossbow');
  }
  // Chips carry their own key, so a rebind is visible where the control is
  // rather than only in a settings list nobody reopens.
  const bc = $('blockChip');
  if (bc) {
    const canBlock = w.weaponDef(p).kind === 'melee';
    bc.classList.toggle('ready', canBlock && !p.blocking);
    bc.classList.toggle('on', !!p.blocking);
    bc.textContent = canBlock
      ? `Block ${keyLabel(state.binds.block)}`
      : 'Block — sword only';
  }
  const ab = $('abil');
  if (ab) {
    const ready = p.abilityCd <= 0;
    ab.classList.toggle('ready', ready);
    ab.style.setProperty('--k', ready ? 1 : (1 - p.abilityCd / ABILITY.cooldown));
    ab.textContent = ready
      ? `Bash ${keyLabel(state.binds.rally)}`
      : Math.ceil(p.abilityCd) + 's';
  }
  const rl = $('roll');
  if (rl) {
    const ready = p.dodgeCd <= 0;
    rl.classList.toggle('ready', ready);
    rl.style.setProperty('--k', ready ? 1 : (1 - p.dodgeCd / PLAYER.dodge.cooldown));
    rl.textContent = ready
      ? `Roll ${keyLabel(state.binds.roll)}`
      : Math.ceil(p.dodgeCd * 10) / 10 + 's';
  }
}

// short-lived line in the hint slot, for one-off confirmations
// What that wave actually cost you, and what is coming. Without it a cleared
// wave is a number changing in the corner.
function showTally(e) {
  const w = state.world;
  const k = w.stats.kills, prev = state.tallyPrev || {};
  const d = (id) => (k[id] || 0) - (prev[id] || 0);
  state.tallyPrev = { ...k };
  const bits = [];
  for (const [id, label] of [['husk', 'cutters'], ['runner', 'scouts'],
                             ['climber', 'wall goblins'], ['archer', 'archers'], ['shieldman', 'shield goblins'],
                             ['maul', 'mauls'], ['bruiser', 'bruisers'],
                             ['breaker', 'giants']]) {
    if (d(id) > 0) bits.push(`<b>${d(id)}</b> ${label}`);
  }
  const lostNow = w.stats.wardLosses - (state.tallyWards || 0);
  state.tallyWards = w.stats.wardLosses;
  const rows = [
    bits.length ? 'Slain — ' + bits.join(', ') : 'Nothing reached you',
    `Fire at <b>${Math.round(100 * w.stone.hp / w.stone.maxHp)}%</b>` +
      (lostNow ? ` &nbsp;·&nbsp; <b>${lostNow}</b> ward${lostNow > 1 ? 's' : ''} lost` : ''),
    `Bounty <b>+${e.bonus}</b> mana`,
  ];
  $('tallyRows').innerHTML = rows.join('<br>');
  const nxt = WAVES[w.waveIndex + 1];
  $('tallyNext').innerHTML = nxt
    ? `Next: <b>${nxt.name}</b> — ${waveByLane(nxt) && Object.values(waveByLane(nxt)).reduce((n, x) => n + x.total, 0)} coming`
    : 'That was the last of them.';
  const t = $('tally');
  t.classList.remove('on');
  void t.offsetWidth;
  t.classList.add('on');
}

function toast(msg) {
  const h = $('hint');
  h.innerHTML = msg;
  h.classList.remove('gone');
  clearTimeout(showHint._t);
  showHint._t = setTimeout(() => h.classList.add('gone'), 1800);
}

function banner(t, s) {
  $('bannerT').textContent = t;
  $('bannerS').textContent = s || '';
  const b = $('banner');
  b.classList.remove('show');
  void b.offsetWidth;            // restart the animation
  b.classList.add('show');
}

const HINTS = [
  'Wall a lane with <b>Palisades</b>, then put a <b>Ballista</b> behind it. Mana drops where things die — walk over it.',
  'Three doors open now. You cannot afford to hold all of them equally.',
  '<b>Wisps fly.</b> They ignore every wall you own. Only the Brazier reaches them — everything else is your bow.',
  'Something heavy is coming. <b>You cannot mend a wall faster than a Breaker ruins it.</b> Kill it.',
  'Two lanes under pressure at once, and they are far apart. Choose.',
  'Everything, on every door. Hold.',
];

function showHint(i) {
  if (state.hintShown.has(i)) return;
  state.hintShown.add(i);
  const h = $('hint');
  h.innerHTML = HINTS[i] || '';
  h.classList.remove('gone');
  clearTimeout(showHint._t);
  showHint._t = setTimeout(() => h.classList.add('gone'), 9000);
}

// ---------------------------------------------------------------------------
// Events → sound + particles
// ---------------------------------------------------------------------------
function drainEvents() {
  const w = state.world, r = state.rend, s = state.snd;
  for (const e of w.events) {
    if (s) playEvent(s, e);
    if (state.tut && !state.tut.done) state.tut.note(e, w);
    switch (e.type) {
      case 'impact':
        r.spark(e.x, e.y, e.z, e.source === 'player' ? 0xffe0a8 : 0xffc27a,
          e.source === 'player' ? 11 : 5, e.source === 'player' ? 8 : 5, 0.9);
        if (e.source === 'player') { r.addShake(0.08); state.hitstop = Math.max(state.hitstop, 0.035); }
        break;
      // The pell always shows its numbers, whatever the damage-number setting
      // says. It is the one place in the game whose entire job is to tell you
      // what your own moveset does, and hiding that would make it a post.
      case 'pell': {
        const d = DN.find(n => n.life <= 0);
        if (d) {
          d.life = d.max = 1.0;
          d.x = e.x + (Math.random() - 0.5) * 0.5;
          d.y = 2.4; d.z = e.z; d.vy = 1.5;
          d.el.textContent = Math.round(e.damage);
          d.el.className = 'dnum' + (e.kind === 'heavy' ? ' big' : '');
        }
        if (e.combo >= 3) banner('Three', 'The finisher lands hardest');
        r.addShake(e.kind === 'heavy' ? 0.5 : 0.22);
        state.hitstop = e.kind === 'heavy' ? 0.06 : 0.03;
        break;
      }
      case 'swing':
        // show the wedge that was actually swept, at its real arc and reach
        if (e.arc) {
          r.swingFan(e.x, e.z, Math.atan2(e.dx, e.dz), e.arc, e.range || 2.8);
        }
        if (e.airborneInReach) {
          // the swing passed under it. Say why, once, rather than letting the
          // player conclude the enemy is broken.
          toast('Your sword cannot reach something in the air &mdash; press <b>Q</b>');
          if (s) s.play('foeSwing', 0.9, 0.55);
          r.spark(e.x + e.dx * 2.0, 2.6, e.z + e.dz * 2.0, 0x9fb4d0, 5, 4, 0.7, -2);
        }
        // a sword that connects stops time for a moment; one that whiffs does not
        if (e.hits > 0) {
          const heavy = e.kind === 'heavy';
          const big = heavy ? 2.2 : (e.arc > 2.3 ? 1.5 : 1);   // finisher or heavy
          state.hitstop = Math.max(state.hitstop,
            (0.05 + Math.min(0.05, e.hits * 0.02)) * big);
          r.addShake((0.10 + Math.min(0.2, e.hits * 0.05)) * big);
          if (heavy) {
            r.shock(e.x + e.dx * 1.6, 0.2, e.z + e.dz * 1.6, 0xfff0c8, 0.8, 4.4, 0.42);
            flash(0.10);
          }
          r.spark(e.x + e.dx * 1.9, 1.0, e.z + e.dz * 1.9, 0xfff0c8, 8 + e.hits * 3, 7, 1.0, -3);
          // stood UP on its edge, so a sword hit reads across the target's body
          // rather than as a puddle on the floor under it
          r.shock(e.x + e.dx * 1.9, 1.0, e.z + e.dz * 1.9, 0xfff0c8,
            0.6, 2.2 + e.hits * 0.5, 0.3, Math.PI / 2);
        }
        break;
      case 'swap':
        if (s) s.play('select', 0.7);
        break;
      case 'rally':
        r.ringBurst(e.x, 0.5, e.z, 0xffd89a, 10, 40);
        r.addShake(0.55);
        flash(0.16);
        state.hitstop = Math.max(state.hitstop, 0.09);
        toast(`Rally &mdash; ${e.hit} scattered`);
        break;
      case 'blocked':
        r.spark(e.x, 1.2, e.z, 0xffe8b8, 7, 5, 0.7, -1);
        r.addShake(0.09);
        break;
      case 'jump':
        r.shock(e.x, 0.12, e.z, 0xbcd2f5, 0.4, 1.9, 0.28);
        if (s) s.play('foeSwing', 0.4, 1.8);
        break;
      case 'land':
        // dust, and a small kick — a landing with no weight reads as floating
        r.spark(e.x, 0.2, e.z, 0xa8b4c8, 7, 3.2, 0.7, -6);
        r.shock(e.x, 0.12, e.z, 0xa8b4c8, 0.5, 2.4, 0.3);
        r.addShake(0.06);
        break;
      case 'windupPlayer':
        if (e.kind === 'heavy') {
          // a charged blow announces itself
          r.spark(w.player.x + e.dx * 1.1, 1.5, w.player.z + e.dz * 1.1, 0xffd89a, 7, 3, 0.7, -1);
          if (s) s.play('select', 0.7, 0.6);
        }
        break;
      case 'perfect':
        // the loudest defensive moment in the game deserves to look like one
        r.shock(e.x, 0.9, e.z, 0xbfe8ff, 0.5, 3.6, 0.42, Math.PI / 2);
        r.spark(e.x, 1.2, e.z, 0xdff2ff, 14, 7, 0.9, -2);
        r.addShake(0.24);
        state.hitstop = Math.max(state.hitstop, 0.09);
        toast('Perfect guard');
        if (s) s.play('impact', 1.0, 1.3);
        break;
      case 'stagger':
        // A stagger is the loudest positive feedback in the game: it is the
        // moment the player learns their swing did something. Give it the ring,
        // the sparks and a beat of hitstop.
        r.shock(e.x, e.y, e.z, 0xfff0c8, 0.5, 2.4, 0.3, Math.PI / 2);
        r.spark(e.x, e.y, e.z, 0xfff4d8, 10, 6, 0.85, -4);
        r.addShake(0.16);
        state.hitstop = Math.max(state.hitstop, 0.06);
        if (s) s.play('impact', 1.0, 0.8);
        break;
      case 'dodge':
        r.ringBurst(e.x, 0.25, e.z, 0xbcd2f5, 1.5, 12);
        r.shock(e.x, 0.14, e.z, 0x9fc0f0, 0.5, 2.6, 0.34);   // dust off the push
        if (s) s.play('foeSwing', 0.5, 1.5);
        break;
      case 'kill': {
        const big = e.foe === 'breaker';
        r.spark(e.x, (e.y || 0) + 0.8, e.z,
          e.foe === 'climber' ? 0xc8e08a : (big ? 0xff8060 : 0xc8b89a),
          big ? 26 : 9, big ? 9 : 4.5, big ? 2.2 : 1);
        if (big) {
          r.addShake(0.65);
          r.ringBurst(e.x, 0.4, e.z, 0xff8060, 3.4, 20);
          r.shock(e.x, 0.16, e.z, 0xff9a70, 1.2, 7.5, 0.6);
          state.hitstop = Math.max(state.hitstop, 0.13);   // a troll dying lands
          flash(0.14);
        } else if (e.by === 'player') {
          r.addShake(0.05);
        }
        break;
      }
      case 'build':
        r.ringBurst(e.x, 0.3, e.z, 0x7fe08a, 1.6, 12);
        break;
      case 'wardDown':
        // Losing a ward is a real event and used to look like a puff of dust.
        // Timber, a dust ring, a heavier kick, and a beat of hitstop.
        r.spark(e.x, 1.2, e.z, 0x8a7a5a, 26, 7, 1.7, -9);
        r.spark(e.x, 0.6, e.z, 0x5b4a34, 16, 4.5, 1.2, -12);
        r.shock(e.x, 0.18, e.z, 0xc8a878, 0.8, 6.2, 0.55);
        r.addShake(0.42);
        state.hitstop = Math.max(state.hitstop, 0.05);
        break;
      case 'caltrops':
        r.ringBurst(e.x, 0.3, e.z, PAL.snare, e.r, 22);
        r.addShake(0.16);
        break;
      case 'stoneHit':
        r.addShake(Math.min(0.7, e.amount / 130));
        r.spark(0, 3.3, 0, 0xffb347, 4, 4, 1.2);
        // the fire recoils: a ring off the hearth scaled by how hard it was hit
        r.shock(0, 0.2, 0, 0xffb347, 1.4, 4 + Math.min(9, e.amount / 26), 0.5);
        flash(Math.min(0.4, e.amount / 500));
        break;
      case 'playerHurt':
        // Getting hit was a red tint and nothing else. It now stops time for a
        // beat, kicks the camera and throws a ring off the player, because the
        // most important hit in the game to notice is the one you take.
        flash(0.34);
        state.hitstop = Math.max(state.hitstop, 0.07);
        r.addShake(0.34);
        r.shock(w.player.x, 0.9, w.player.z, 0xe0605a, 0.5, 3.0, 0.38, Math.PI / 2);
        r.spark(w.player.x, 1.2, w.player.z, 0xe0605a, 9, 5, 0.9, -3);
        r.addShake(0.2);
        break;
      case 'playerDown':
        flash(0.75); r.addShake(0.9);
        banner('You fell', 'back in five');
        break;
      case 'spawn':
        r.laneFlash.set(e.lane, 0.5);
        if (e.foe === 'breaker') {          // announce it loudly
          r.laneFlash.set(e.lane, 2.2);
          r.ringBurst(e.x, 0.4, e.z, 0xff5a48, 4, 20);
          r.addShake(0.34);
          banner('Something heavy', 'at the ' + e.lane + ' door');
        }
        break;
      case 'dmg':
        popDamage(e.x, e.y, e.z, e.amount);
        break;
      case 'upgrade':
        r.ringBurst(e.x, 0.5, e.z, 0xffd89a, 2.2, 18);
        if (s) s.play('build', 1, 0.8);
        toast(`${WARD_BY_ID[e.ward].name} — level ${e.level}`);
        break;
      case 'fuse':
        if (s) s.play('hover', 1, 0.5);
        toast('<b>Powder goblin</b> &mdash; get clear');
        break;
      case 'blast':
        r.addShake(0.8);
        r.ringBurst(e.x, 0.5, e.z, 0xff9c3a, e.r, 30);
        r.spark(e.x, 1.1, e.z, 0xffd070, 34, 12, 2.2);
        flash(0.3);
        state.hitstop = Math.max(state.hitstop, 0.11);
        if (s) s.layer('snare', 'wardDown', 1.2, 0.7);
        break;
      case 'cacheHit':
        r.spark(e.x, 0.8, e.z, 0xc9a978, 5, 4, 0.7);
        if (s) s.play('impact', 0.7, 1.2);
        break;
      case 'cacheBreak':
        r.ringBurst(e.x, 0.4, e.z, 0x9fe8ff, 1.8, 16);
        r.spark(e.x, 0.9, e.z, 0xc9a978, 16, 6, 1.1);
        r.addShake(0.14);
        if (s) s.layer('wardDown', 'mote', 0.8, 1.25);
        break;
      case 'caches':
        toast(`<b>${e.n}</b> caches in the wood &mdash; break them for mana`);
        break;
      case 'built':
        r.ringBurst(e.x, 0.4, e.z, 0x9fe8a0, 1.9, 14);
        if (s) s.play('build');
        break;
      case 'mote':
        break;
      case 'wave':
        banner(e.name, `Wave ${e.index + 1} of ${WAVES.length}`);
        showHint(e.index);
        break;
      case 'waveClear':
        showTally(e);
        writeSave();     // the muster has begun; this is the checkpoint
        break;
      case 'won': endGame(true); break;
      case 'lost': endGame(false); break;
    }
  }
  w.events.length = 0;
}

// ---------------------------------------------------------------------------
// Floating damage numbers. A pool of DOM nodes projected from world space —
// far cheaper than text in the 3D scene and it stays crisp at any distance.
// Off by default: they are informative for some players and visual noise for
// others, which is exactly what a setting is for.
const DN = [];
const _dv = new THREE.Vector3();
function initDamageNumbers() {
  const host = $('dmg');
  for (let i = 0; i < 26; i++) {
    const el = document.createElement('div');
    el.className = 'dnum';
    host.appendChild(el);
    DN.push({ el, life: 0, x: 0, y: 0, z: 0, vy: 0 });
  }
}
function popDamage(x, y, z, amount) {
  if (!state.dmgNums) return;
  const d = DN.find(n => n.life <= 0);
  if (!d) return;
  d.life = d.max = 0.85;
  d.x = x + (Math.random() - 0.5) * 0.7;
  d.y = y; d.z = z + (Math.random() - 0.5) * 0.7;
  d.vy = 2.4;
  d.el.textContent = Math.round(amount);
  d.el.className = 'dnum' + (amount >= 34 ? ' crit' : '');
}
function stepDamageNumbers(dt) {
  const cam = state.rend.camera;
  for (const d of DN) {
    if (d.life <= 0) { if (d.el.style.opacity !== '0') d.el.style.opacity = '0'; continue; }
    d.life -= dt;
    d.y += d.vy * dt;
    d.vy -= 3.2 * dt;
    if (d.life <= 0) { d.el.style.opacity = '0'; continue; }
    _dv.set(d.x, d.y, d.z).project(cam);
    if (_dv.z > 1) { d.el.style.opacity = '0'; continue; }
    const sx = (_dv.x * 0.5 + 0.5) * innerWidth;
    const sy = (-_dv.y * 0.5 + 0.5) * innerHeight;
    const k = d.life / d.max;
    d.el.style.transform = `translate(${sx.toFixed(0)}px,${sy.toFixed(0)}px)`;
    d.el.style.opacity = (k > 0.7 ? (1 - k) / 0.3 : k / 0.7).toFixed(2);
  }
}

// ---------------------------------------------------------------------------
// In-world markers over each gate during the muster. The minimap already says
// what is coming per track; this puts it where you are LOOKING, so choosing
// which door to reinforce does not require reading a corner of the screen.
// ---------------------------------------------------------------------------
const DOORS = new Map();
const _dp = new THREE.Vector3();
const FOE_TINT = {
  husk: '#a8ae9c', runner: '#8fbf6a', climber: '#a8c95e',
  archer: '#a2bd5c', shieldman: '#6f8f3f', maul: '#8fae4a', bruiser: '#7d9c44', breaker: '#8a6a4a',
};

function initDoors() {
  const host = $('doors');
  for (const lane of LANES) {
    const el = document.createElement('div');
    el.className = 'door';
    el.innerHTML = '<div class="cnt"></div><div class="pips"></div><div class="nm"></div>';
    host.appendChild(el);
    DOORS.set(lane.id, { el, cnt: el.querySelector('.cnt'), pips: el.querySelector('.pips'),
      nm: el.querySelector('.nm'), lane });
  }
}

function hideDoors() {
  for (const [, d] of DOORS) d.el.classList.remove('on');
}

function stepDoors() {
  const w = state.world, cam = state.rend.camera;
  const show = w.phase === 'build' && w.waveIndex < WAVES.length;
  const inc = show ? waveByLane(WAVES[w.waveIndex]) : null;
  for (const [id, d] of DOORS) {
    const info = inc && inc[id];
    if (!info || !info.total) { d.el.classList.remove('on'); continue; }
    const p = laneDoor(d.lane);
    _dp.set(p.x, 6.5, p.z).project(cam);
    if (_dp.z > 1) { d.el.classList.remove('on'); continue; }
    d.el.classList.add('on');
    // Clamp into the play area. A distant gate projects near the horizon and
    // lands underneath the top HUD, where the marker is worse than useless.
    const sx = (_dp.x * 0.5 + 0.5) * innerWidth;
    const sy = (-_dp.y * 0.5 + 0.5) * innerHeight;
    d.el.style.left = Math.max(56, Math.min(innerWidth - 56, sx)).toFixed(0) + 'px';
    d.el.style.top = Math.max(118, Math.min(innerHeight - 190, sy)).toFixed(0) + 'px';
    if (d.cnt.textContent !== String(info.total)) {
      d.cnt.textContent = info.total;
      d.nm.textContent = d.lane.name;
      d.pips.innerHTML = '';
      for (const k of ['husk', 'runner', 'climber', 'archer', 'shieldman', 'maul', 'bruiser', 'breaker']) {
        const n = info.kinds[k];
        if (!n) continue;
        for (let i = 0; i < Math.min(6, Math.ceil(n / 4)); i++) {
          const pip = document.createElement('div');
          pip.className = 'pip';
          pip.style.background = FOE_TINT[k];
          d.pips.appendChild(pip);
        }
      }
    }
  }
}

let flashT = 0;
function flash(a) {
  // "Reduce flashes" damps rather than removes: the flash carries information
  // (you were hit, the fire was hit) and deleting it outright would cost the
  // player a signal rather than sparing them one.
  flashT = Math.max(flashT, state.calm ? a * 0.3 : a);
  $('flash').style.opacity = flashT;
}

// The low-health edge. Driven every frame rather than by an event, because it
// is a STATE — being nearly dead — not a moment.
let vigT = 0;
function stepVignette(dt) {
  const p = state.world && state.world.player;
  const frac = state.running && p && p.alive ? p.hp / p.maxHp : 1;
  // nothing at all above a third health, then it climbs steeply
  const want = frac > 0.34 ? 0 : (1 - frac / 0.34);
  vigT += (want - vigT) * Math.min(1, dt * 3.4);
  if (vigT < 0.004) { $('vig').style.opacity = 0; return; }
  const pulse = 0.72 + Math.sin(state.world.t * 4.4) * 0.28;
  $('vig').style.opacity = vigT * pulse * (state.calm ? 0.55 : 1);
}

// FPS, averaged over half a second so the number is readable rather than a blur.
let fpsAcc = 0, fpsN = 0, fpsT = 0;
function stepFps(dt) {
  if (!state.fps) return;
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT < 0.5) return;
  $('fps').textContent = `${Math.round(fpsN / fpsAcc)} FPS · ${state.rend.renderer.info.render.calls} calls`;
  fpsAcc = 0; fpsN = 0; fpsT = 0;
}

// ---------------------------------------------------------------------------
function endGame(won) {
  state.running = false;
  clearSave();     // a finished run is not something to resume into
  const w = state.world;
  $('overT').textContent = won ? 'Held' : 'The light is out';
  $('overT').className = won ? '' : 'bad';
  $('overP').textContent = won
    ? 'Six waves. The stone still burns. Whatever the lanes could not cover, you covered.'
    : 'The wardstone went dark. Something walked past a wall, or flew over one.';
  const k = w.stats.kills;
  $('overS').innerHTML =
    `Wave reached <b>${Math.min(w.waveIndex + 1, WAVES.length)}</b> of ${WAVES.length} &nbsp;·&nbsp; ` +
    `Wardstone <b>${Math.max(0, Math.round(w.stone.hp))}</b>/${w.stone.maxHp}<br>` +
    `Slain — cutters <b>${k.husk || 0}</b>, scouts <b>${k.runner || 0}</b>, ` +
    `wall goblins <b>${k.climber || 0}</b>, giants <b>${k.breaker || 0}</b><br>` +
    `Wards lost <b>${w.stats.wardLosses}</b> &nbsp;·&nbsp; you fell <b>${w.stats.playerDeaths}</b> times`;
  $('over').classList.add('on');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function bindInput() {
  const cv = $('stage');

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (bindCapture(e)) return;   // rebinding owns the keyboard while it is armed
    const k = e.key.toLowerCase();
    state.keys.add(k);
    if (k === 'escape' || k === '0') {
      if (state.inspect) { inspectWard(null); return; }
      state.selected = null; select(null);
      return;
    }
    const acts = state.keyToAction[k];
    if (!acts) return;
    // In the hall, MEND's key is the "use" key. It is the same verb — put your
    // hand on the thing in front of you — and it means the room needs no key
    // of its own to learn.
    if (state.world.hub && acts.includes('mend')) {
      e.preventDefault();
      if (useStation()) { state.snd.play('click'); return; }
    }
    // In the field the same key is FIRE when you are standing at the hearth or
    // at a brazier, and mend everywhere else. One key, and what it means is
    // decided by what you are next to — the same rule the hall uses.
    if (!state.world.hub && acts.includes('mend')) {
      const r = state.world.useFire();
      if (r) {
        e.preventDefault();
        state.snd.play(r === 'lit' ? 'build' : 'click');
        if (r === 'took') banner('A brand', 'Carry it to a brazier — no shield while you do');
        return;
      }
    }
    for (const act of acts) {
    if (act === 'ward1' || act === 'ward2' || act === 'ward3' || act === 'ward4') {
      const wd = WARDS[+act.slice(4) - 1];
      if (wd && state.world.isUnlocked(wd.id)) select(wd.id);
      else if (wd) state.snd.play('hover', 0.6, 0.7);
    }
    if (act === 'rotate') {
      // contextual: R rotates the thing you are holding, or readies the wave
      if (state.selected) {
        state.ghostRot = (state.ghostRot == null ? 0 : state.ghostRot) + Math.PI / 4;
        state.snd.play('hover', 0.7);
      } else if (state.inspect) {
        state.world.rotateWard(state.inspect);
        state.snd.play('hover', 0.7);
      } else if (state.world.ready()) {
        state.snd.play('click');
      }
    }
    if (act === 'swap') state.world.swapWeapon();
    if (act === 'build') { e.preventDefault(); toggleOverhead(); }
    if (act === 'roll') { e.preventDefault(); state.wantDodge = true; }
    if (act === 'jump') { e.preventDefault(); state.wantJump = true; }
    if (act === 'rally') {
      const yy = state.rend.camYaw;
      state.world.rally(-Math.sin(yy), -Math.cos(yy));
    }
    if (act === 'sell' && state.selected === null) sellUnderPointer();
    if (act === 'upgrade' && state.selected === null) {
      if (state.inspect) { upgradeInspected(); return; }
      const w = state.world;
      const near = state.overhead ? wardUnderPointer() : w.wardNear(4.2);
      const r = w.canUpgrade(near);
      if (r.ok) { w.upgrade(near); }
      else if (near) { toast(r.why); state.snd.play('hover', 0.6, 0.7); }
    }
    }
  });
  addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { state.keys.clear(); state.firing = false; });

  // ---- pointer: left = act, right-drag = turn
  let dragging = false, dragBtn = 0, lastX = 0, downX = 0, downY = 0, downT = 0;

  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    dragging = true; dragBtn = e.button;
    lastX = downX = e.clientX; downY = e.clientY; downT = performance.now();
    state.pointer.x = e.clientX; state.pointer.y = e.clientY; state.pointer.has = true;
    if (e.button === 0 && !isTouch && !state.selected) state.firing = true;
    // Holding a blockade and pressing down on the field starts a WALL RUN:
    // the drag lays a straight line of them in one gesture. Anchored here so
    // the run is measured from where the gesture began, not where it ended.
    if (e.button === 0 && state.selected &&
        WARD_BY_ID[state.selected] && WARD_BY_ID[state.selected].kind === 'blockade') {
      state.runFrom = pickCell(e.clientX, e.clientY);
    }
  });

  cv.addEventListener('pointermove', (e) => {
    state.pointer.x = e.clientX; state.pointer.y = e.clientY; state.pointer.has = true;
    if (!dragging) return;
    // Right-drag on desktop turns the camera. On touch, ANY drag turns it —
    // a tap is reserved for placing, which is decided on pointerup by
    // distance travelled, so the two never fight.
    if (dragBtn === 2 || isTouch) {
      // A wall run owns the drag: turning the camera mid-drag would swing the
      // line out from under the pointer.
      if (state.runFrom) return;
      state.rend.camYaw -= (e.clientX - lastX) * 0.0055 * state.sens;
      lastX = e.clientX;
    }
  });

  const up = (e) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    const quick = performance.now() - downT < 400;

    // --- a wall run, if the drag went anywhere
    if (state.runFrom && dragBtn === 0) {
      const to = pickCell(e.clientX, e.clientY);
      const a = state.runFrom;
      state.runFrom = null;
      state.rend.hideRun();
      if (to && (to.i !== a.i || to.j !== a.j)) {
        const rot = state.ghostRot;
        const built = state.world.buildRun(state.selected, a.i, a.j, to.i, to.j, rot);
        if (built.length) {
          if (state.snd) state.snd.play('build');
          toast(`${built.length} palisades raised`);
        } else {
          const plan = state.world.planRun(state.selected, a.i, a.j, to.i, to.j);
          if (plan.stoppedBy) toast(plan.stoppedBy);
        }
        dragging = false; state.firing = false;
        return;                      // a run is not also a single placement
      }
    }

    if (dragging && dragBtn === 0 && moved < 12 && quick) {
      if (state.selected) tryBuild(e.clientX, e.clientY);
      else if (!isTouch) {
        // Nothing in hand: a click on a built ward opens its panel, and a
        // click on bare ground closes it.
        inspectWard(wardUnderPointer());
      }
    }
    dragging = false;
    state.firing = false;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', () => {
    dragging = false; state.firing = false;
    state.runFrom = null; state.rend.hideRun();
  });

  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (state.overhead) {
      state.rend.ohHeight = Math.max(22, Math.min(64,
        state.rend.ohHeight + Math.sign(e.deltaY) * 3));
    } else {
      state.rend.camDist = Math.max(7, Math.min(26, state.rend.camDist + Math.sign(e.deltaY) * 1.3));
      state.rend.camHeight = 2.2 + state.rend.camDist * 0.48;
    }
  }, { passive: false });

  // ---- touch stick
  const stick = $('stick'), knob = $('knob');
  let sid = null, sc = { x: 0, y: 0 };
  const stickStart = (e) => {
    sid = e.pointerId;
    const r = stick.getBoundingClientRect();
    sc.x = r.left + r.width / 2; sc.y = r.top + r.height / 2;
    stick.setPointerCapture(e.pointerId);
    stickMove(e);
  };
  const stickMove = (e) => {
    if (e.pointerId !== sid) return;
    const dx = e.clientX - sc.x, dy = e.clientY - sc.y;
    const m = Math.hypot(dx, dy), lim = 48;
    const k = m > lim ? lim / m : 1;
    knob.style.transform = `translate(${dx * k}px,${dy * k}px)`;
    state.move.x = (dx * k) / lim;
    state.move.y = (dy * k) / lim;
  };
  const stickEnd = (e) => {
    if (e.pointerId !== sid) return;
    sid = null; state.move.x = state.move.y = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerdown', stickStart);
  stick.addEventListener('pointermove', stickMove);
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);

  const hold = (el, set) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(true); el.classList.add('on'); });
    el.addEventListener('pointerup', () => { set(false); el.classList.remove('on'); });
    el.addEventListener('pointercancel', () => { set(false); el.classList.remove('on'); });
  };
  hold($('bFire'), (v) => state.firing = v);
  hold($('bMend'), (v) => state.mending = v);
  hold($('bBlock'), (v) => state.blocking = v);

  const tap = (el, fn) => el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); fn();
  });
  tap($('bRoll'), () => state.wantDodge = true);
  tap($('bSwap'), () => state.world.swapWeapon());
  tap($('bView'), () => toggleOverhead());
  tap($('bRally'), () => {
    const yy = state.rend.camYaw;
    state.world.rally(-Math.sin(yy), -Math.cos(yy));
  });
  // The chip was a read-only cooldown display. It is the knight's ONE ability
  // and the only way to use it was a key nothing mentioned, so it is now a
  // button, and hovering it draws what it will reach.
  const abil = $('abil');
  abil.style.pointerEvents = 'auto';
  abil.style.cursor = 'pointer';
  abil.title = `${ABILITY.name} (${keyLabel(state.binds.rally)}) — shove and interrupt ` +
    `whatever is in front of you, out to ${ABILITY.range}m. Sword only.`;
  abil.addEventListener('click', () => {
    const yy = state.rend.camYaw;
    if (!state.world.rally(-Math.sin(yy), -Math.cos(yy)) && state.snd) {
      state.snd.play('hover', 0.6, 0.7);
    }
  });
  abil.addEventListener('pointerenter', () => { state.showAbil = true; });
  abil.addEventListener('pointerleave', () => { state.showAbil = false; });

  // a dedicated turn pad, for when a thumb is busy on the stick
  const cam = $('bCam');
  let camId = null, camX = 0;
  cam.addEventListener('pointerdown', (e) => {
    e.preventDefault(); camId = e.pointerId; camX = e.clientX;
    cam.setPointerCapture(e.pointerId); cam.classList.add('on');
  });
  cam.addEventListener('pointermove', (e) => {
    if (e.pointerId !== camId) return;
    state.rend.camYaw -= (e.clientX - camX) * 0.012 * state.sens;
    camX = e.clientX;
  });
  const camEnd = () => { camId = null; cam.classList.remove('on'); };
  cam.addEventListener('pointerup', camEnd);
  cam.addEventListener('pointercancel', camEnd);

  $('ready').addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.world.ready()) state.snd.play('click');
  });
  $('again').addEventListener('click', () => location.reload());
}

// The build view. Freezes the body and lifts the camera so a far track can be
// worked on without walking there — the single biggest quality-of-life gap
// against Dungeon Defenders. Available in combat too, because a wall you
// cannot rebuild mid-wave is the same as no wall.
function toggleOverhead(on) {
  const r = state.rend, w = state.world;
  const next = on == null ? !state.overhead : on;
  if (next === state.overhead) return;
  state.overhead = next;
  r.overhead = next;
  if (next) {
    r.ohTarget.x = w.player.x;
    r.ohTarget.z = w.player.z;
    state.firing = false;
    state.vel.x = state.vel.z = 0;
  }
  $('ohBadge').classList.toggle('on', next);
  const b = $('bView');
  if (b) b.classList.toggle('on', next);
  state.snd.play('select', 0.8, next ? 1.1 : 0.85);
}

function tryBuild(px, py) {
  const w = state.world;
  const c = pickCell(px, py) || cellAhead();
  if (!c) return;
  const r = w.canBuild(state.selected, c.i, c.j);
  if (r.ok) {
    w.build(state.selected, c.i, c.j, state.ghostRot);
    // keep the ward selected so a wall can be laid in one gesture per cell
    if (w.mana < WARD_BY_ID[state.selected].cost) select(null);
  } else {
    state.snd.play('hover', 0.6, 0.7);
    const h = $('hint');
    h.innerHTML = { 'occupied': 'Something already stands there.',
      'not buildable ground': 'Nothing may be built there.',
      'no defence units': 'No defence units left. Sell a ward to free some.',
      'not enough mana': 'Not enough mana.' }[r.why] || r.why;
    h.classList.remove('gone');
    clearTimeout(showHint._t);
    showHint._t = setTimeout(() => h.classList.add('gone'), 2400);
  }
}

// ---------------------------------------------------------------------------
// The ward panel.
//
// Upgrade and rotate both existed from the start and neither had any on-screen
// presence — they were F and R, context-dependent, and F was ALSO an alternate
// fire key, so it shot instead of upgrading whenever a ward was selected.
// Measured by a player: "I still don't see a way to upgrade or rotate".
//
// Clicking a ward now selects it and says what can be done to it, with live
// costs. The keys still work for anyone who learns them, but nothing is only
// on a key any more.
// ---------------------------------------------------------------------------
function inspectWard(w) {
  state.inspect = w && !w.dead ? w : null;
  syncWardPanel();
  if (state.inspect && state.snd) state.snd.play('hover', 0.7);
}

function syncWardPanel() {
  const el = $('wardPanel');
  const w = state.inspect;
  if (!w || w.dead || !state.running) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');

  const world = state.world;
  const ROMAN = ['I', 'II', 'III', 'IV'];
  $('wpName').textContent = w.def.name;
  $('wpLvl').textContent = ROMAN[w.level - 1] || w.level;
  const frac = Math.max(0, w.hp / w.maxHp);
  $('wpHp').style.width = `${frac * 100}%`;
  $('wpHp').style.background = frac > 0.6 ? '#7fd4c0' : (frac > 0.3 ? '#e0b25c' : '#e08a80');

  const bits = [`${Math.round(w.hp)} / ${w.maxHp} hp`, `${w.def.du} units`];
  if (w.def.range) bits.push(`${w.def.range}m reach`);
  if (w.buildT > 0) bits.push('under construction');
  $('wpStat').textContent = bits.join('  ·  ');

  const up = world.canUpgrade(w);
  const atMax = w.level >= UPGRADE.maxLevel;
  $('wpUp').disabled = !up.ok;
  $('wpUpCost').textContent = atMax ? 'max' : `${world.upgradeCost(w)} mana`;
  $('wpSellBack').textContent = `+${Math.floor(w.def.cost * 0.6)}`;
  // Only say why it CANNOT be upgraded, and only when that is the interesting
  // fact — "already at full strength" is not a complaint, it is a state.
  $('wpHint').textContent = (!up.ok && !atMax) ? up.why : '';
}

function upgradeInspected() {
  const w = state.inspect;
  if (!w) return;
  const r = state.world.canUpgrade(w);
  if (r.ok) {
    state.world.upgrade(w);
    if (state.snd) state.snd.play('build');
    state.rend.shock(w.x, 0.2, w.z, 0x7fe08a, 0.8, 3.2, 0.4);
  } else if (state.snd) {
    state.snd.play('hover', 0.6, 0.7);
  }
  syncWardPanel();
}


function wardUnderPointer() {
  const w = state.world;
  const c = state.pointer.has ? pickCell(state.pointer.x, state.pointer.y) : cellAhead();
  return c ? w.wardAtCell(c.i, c.j) : null;
}

function sellUnderPointer() {
  const ward = wardUnderPointer();
  if (ward) state.world.sell(ward);
}

// ---------------------------------------------------------------------------
// Per-frame player intent
// ---------------------------------------------------------------------------
function applyInput(dt) {
  const w = state.world, r = state.rend, p = w.player;
  if (!p.alive) return;

  let mx = state.move.x, my = state.move.y;
  if (held('up')) my -= 1;
  if (held('down')) my += 1;
  if (held('left')) mx -= 1;
  if (held('right')) mx += 1;
  const m = Math.hypot(mx, my);
  if (m > 1) { mx /= m; my /= m; }

  // Movement is camera-relative, which is the only scheme that survives a
  // camera the player is free to spin. Test the TRANSFORM, not the sim —
  // see [[world-space-tests-cannot-see-inverted-controls]].
  // In the build view the body is parked and the same keys pan the camera.
  if (state.overhead) {
    const sp = 34 * (state.rend.ohHeight / 40);
    const pan = state.rend.ohTarget;
    pan.x += mx * sp * dt;
    pan.z += my * sp * dt;
    const lim = ARENA.half - 4;
    pan.x = Math.max(-lim, Math.min(lim, pan.x));
    pan.z = Math.max(-lim, Math.min(lim, pan.z));
    state._moving = false;
    state.vel.x = state.vel.z = 0;
    if (state.selected) {
      const c = (state.pointer.has ? pickCell(state.pointer.x, state.pointer.y) : null);
      r.showBuildGrid(w, state.selected, pan.x, pan.z, 26);
      if (c) {
        const cc = cellCenter(c.i, c.j);
        const rot = state.ghostRot == null ? w.defaultRotAt(cc.x, cc.z) : state.ghostRot;
        r.showGhost(state.selected, c.i, c.j, w.canBuild(state.selected, c.i, c.j).ok, rot);
      }
    } else {
      r.hideGhost();
    }
    return;
  }

  const sin = Math.sin(r.camYaw), cos = Math.cos(r.camYaw);
  const fx = -sin, fz = -cos;          // camera forward on the ground plane
  const rx = cos, rz = -sin;           // camera right
  const vx = (fx * -my + rx * mx) * PLAYER.speed;
  const vz = (fz * -my + rz * mx) * PLAYER.speed;

  // Momentum. Snapping straight to full speed and to a dead stop is most of
  // what "movement feels off" was: there is no weight to a body that changes
  // direction instantly, and no walk cycle can rescue it.
  const rate = m > 0.02 ? 15 : 12;
  const k = 1 - Math.exp(-rate * dt);
  state.vel.x += (vx - state.vel.x) * k;
  state.vel.z += (vz - state.vel.z) * k;
  const sp = Math.hypot(state.vel.x, state.vel.z);

  // The roll drives position itself; do not fight it with input.
  if (sp > 0.05 && p.dodgeT <= 0) w.movePlayer(state.vel.x, state.vel.z, dt);

  // Turn toward travel instead of snapping. Shortest way round.
  if (sp > 0.5 && p.dodgeT <= 0) {
    const want = Math.atan2(state.vel.x, state.vel.z);
    let d = want - p.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    p.yaw += d * Math.min(1, dt * 15);
  }
  state._moving = sp > 0.5;

  // bracing behind the shield
  w.setBlocking(state.blocking || held('block'));

  // mending
  const wantMend = state.mending || held('mend');
  if (wantMend) {
    const hp = w.repairStep(dt);
    if (state.tut && hp > 0) state.tut.s.mended += hp;
    if (hp > 0 && Math.random() < dt * 14) {
      const t = w.repairTarget();
      if (t) r.spark(t.x, 1.1, t.z, 0x7fe08a, 1, 2.2, 0.7, -2);
    }
  } else {
    p.repairing = null;
  }

  // the roll. Direction is whatever you are holding; if nothing, straight ahead.
  if (state.wantJump) { w.jump(); state.wantJump = false; }
  if (state.wantDodge) {
    state.wantDodge = false;
    if (m > 0.02) w.dodge(vx, vz);
    else w.dodge(Math.sin(p.yaw), Math.cos(p.yaw));
  }

  // The sword is held rather than tapped: the sim owns the charge timer so
  // mouse, key and touch all get identical timing. A tap comes out as the next
  // link in the chain, a hold as the heavy.
  if (w.weaponDef(p).kind === 'melee' && !state.selected) {
    let mx = fx, mz = fz;
    if (!isTouch && state.pointer.has) {
      const c = pickCell(state.pointer.x, state.pointer.y);
      if (c) {
        const cc = cellCenter(c.i, c.j);
        const ddx = cc.x - p.x, ddz = cc.z - p.z;
        const dd = Math.hypot(ddx, ddz);
        if (dd > 0.5) { mx = ddx / dd; mz = ddz / dd; }
      }
    }
    w.meleeInput(state.firing, mx, mz);
  }

  // attacking — the weapon decides whether that is a sweep or a bolt
  if (state.firing && p.atkCd <= 0 && !state.selected && w.weaponDef(p).kind !== 'melee') {
    let ax = fx, az = fz, ay = 0;
    // A foe under the crosshair wins outright, and we aim at it in THREE
    // dimensions. Picking a ground cell — which is what this used to do — can
    // only ever produce a horizontal shot, and a horizontal shot cannot hit
    // something flying at four metres.
    const aimed = (!isTouch && state.pointer.has)
      ? r.foeUnderPointer(w, state.pointer.x, state.pointer.y)
      : (w.weaponDef(p).kind === 'ranged' ? w.nearestFlier(PLAYER.weapons.crossbow.range) : null);
    if (aimed) {
      const dx = aimed.x - p.x;
      const dy = (aimed.y + aimed.def.height * 0.5) - (p.y + 1.2);
      const dz = aimed.z - p.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      ax = dx / d; ay = dy / d; az = dz / d;
    } else if (!isTouch && state.pointer.has) {
      const c = pickCell(state.pointer.x, state.pointer.y);
      if (c) {
        const cc = cellCenter(c.i, c.j);
        const dx = cc.x - p.x, dz = cc.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) { ax = dx / d; az = dz / d; }
      }
    }
    const before = w.weaponDef(p).kind;
    w.attack(ax, az, ay);
    p.yaw = Math.atan2(ax, az);   // facing is horizontal; the bolt is not
    if (before === 'ranged') {
      // muzzle flash, thrown forward off the stock
      r.spark(p.x + ax * 1.0, 1.25, p.z + az * 1.0, 0xffe8b8, 6, 5.5, 0.8, -2);
      r.addShake(0.045);
    }
  }

  // whatever ward you are next to (or pointing at) shows its reach
  r._inspect = state.selected ? null
    : (state.inspect || (state.overhead ? wardUnderPointer() : w.wardNear(4.6)));

  // Tell the player a ward is clickable, because nothing ever did. The panel
  // that upgrades, repairs and demolishes was built two rounds ago and reported
  // missing twice — not because it was hard to use, but because there was no
  // way to discover it existed.
  const tip = $('wardTip');
  const overWard = (!state.selected && !isTouch && state.pointer.has)
    ? wardUnderPointer() : null;
  if (overWard && !state.inspect) {
    tip.classList.remove('hidden');
    tip.style.left = `${state.pointer.x}px`;
    tip.style.top = `${state.pointer.y}px`;
    tip.innerHTML = `<b>${overWard.def.name}</b> &nbsp;·&nbsp; click to upgrade, repair or demolish`;
  } else {
    tip.classList.add('hidden');
  }

  // What the next bolt will hit, marked on the foe itself. Shown whenever the
  // ranged weapon is out, not only while firing, so aiming is something you can
  // do deliberately instead of discovering after the shot.
  const aimAt = (w.weaponDef(p).kind === 'ranged' && !state.selected && !state.overhead)
    ? (state.pointer.has ? r.foeUnderPointer(w, state.pointer.x, state.pointer.y) : null)
    : null;
  if (aimAt) r.showAimMark(aimAt); else r.hideAimMark();

  // Rally's reach, while the player is thinking about it
  if (state.showAbil) r.showAbilityRing(p.x, p.z, ABILITY.range, w.canRally());
  else r.hideAbilityRing();

  // A wall run in progress replaces the single-cell ghost with the whole line.
  if (state.runFrom && state.pointer.has) {
    const to = pickCell(state.pointer.x, state.pointer.y);
    if (to) {
      const a = state.runFrom;
      const plan = w.planRun(state.selected, a.i, a.j, to.i, to.j);
      r.hideGhost();
      r.showBuildGrid(w, state.selected, p.x, p.z, 17);
      r.showRun(plan.cells, state.ghostRot || 0, !plan.stoppedBy);
      return;
    }
  }
  r.hideRun();

  // ghost while building
  if (state.selected) {
    const c = (!isTouch && state.pointer.has ? pickCell(state.pointer.x, state.pointer.y) : null) || cellAhead();
    r.showBuildGrid(w, state.selected, p.x, p.z, 17);
    if (c) {
      state.ghostCell = c;
      const cc = cellCenter(c.i, c.j);
      const rot = state.ghostRot == null ? w.defaultRotAt(cc.x, cc.z) : state.ghostRot;
      r.showGhost(state.selected, c.i, c.j, w.canBuild(state.selected, c.i, c.j).ok, rot);
    }
  } else {
    r.hideGhost();
  }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - state.last) / 1000 || 0);
  state.last = now;
  state.lastFrame = performance.now();

  stepDamageNumbers(dt);
  syncWardPanel();
  stepVignette(dt);
  stepFps(dt);
  // The lane doors belong to the arena. In the hall they were floating
  // 'THE STAIR / THE UNDERCROFT' labels over an empty room 400m away.
  if (state.running && !state.world.hub) stepDoors();
  else if (state.world.hub) hideDoors();
  if (flashT > 0) {
    flashT = Math.max(0, flashT - dt * 2.2);
    $('flash').style.opacity = flashT;
  }

  if (state.running && !state.paused) {
    applyInput(dt);
    // Fixed timestep so the sim is identical to the one the harness measured.
    // Hitstop: the sim slows to a crawl for a few frames on a meaty connect
    // while the camera and particles keep running at full speed. It is the
    // cheapest thing in the toolbox that makes a hit feel like it landed on
    // something solid rather than passed through it.
    let simDt = dt;
    if (state.hitstop > 0) {
      state.hitstop -= dt;
      simDt = dt * 0.12;
    }
    state.acc += simDt;
    let n = 0;
    while (state.acc >= STEP && n++ < 5) {
      state.world.step(STEP);
      state.acc -= STEP;
    }
    drainEvents();
    tickTutorial(dt);
    syncHud();
    if (state.snd) state.snd.setPhase(state.world.phase);
    const ph = state.world.phase;
    if ((ph === 'won' || ph === 'lost') && !$('over').classList.contains('on')) {
      endGame(ph === 'won');
    }
  }
  // Before the fire is lit the camera belongs to the title screen, which orbits
  // the clearing rather than sitting behind a player who is not there yet.
  if (state.running) state.rend.update(state.world, dt, { moving: state._moving });
  else state.rend.menuFrame(state.world, dt);
  if (state.world.hub) {
    state.rend.stepHall(dt, state.world);
    syncStation();
  } else if (state.running) {
    syncFirePrompt();
  }
  if (state.map) {
    // during the muster, show what each door is about to send
    const w = state.world;
    const inc = w.phase === 'build' ? waveByLane(WAVES[w.waveIndex]) : null;
    state.map.draw(w, state.rend.camYaw, inc);
  }
}

function resize() {
  const w = innerWidth, h = innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, state.low ? 1.5 : 2);
  // A portrait phone sees far less of the board horizontally at a fixed FOV,
  // and this game is about watching three lanes at once. Widen the lens as the
  // viewport gets taller than it is wide.
  const aspect = w / h;
  // The aspect rules still apply — a portrait phone sees far less of the board
  // at a fixed lens — but they now offset the player's chosen field of view
  // instead of overriding it.
  const widen = aspect < 0.72 ? 16 : (aspect < 1.05 ? 8 : 0);
  state.rend.camera.fov = Math.min(96, state.fov + widen);
  state.rend.lookAhead = aspect < 0.72 ? 4.5 : (aspect < 1.05 ? 4 : 3);
  state.rend.resize(w, h, dpr);
  if (state.map) state.map.resize();
}

// ---------------------------------------------------------------------------
// The hall
// ---------------------------------------------------------------------------
// Everything a menu could have done is a place you stand instead. This is the
// glue: what are you near, what does it say, and what happens when you use it.
// The same prompt chrome the hall uses, for the fire. It is the only thing in
// the field you walk up to and USE, so it gets the same affordance as a station
// rather than a line of hint text somewhere else on the screen.
function syncFirePrompt() {
  const el = $('station');
  if (!el) return;
  const w = state.world;
  let name = null, sub = null;
  if (w.brandT > 0) {
    const b = w.nearBrazier();
    if (b && !b.lit) { name = 'Brazier'; sub = 'Light it — press E'; }
    else { name = 'Burning brand'; sub = `${Math.ceil(w.brandT)}s — carry it to a brazier`; }
  } else if (Math.hypot(w.player.x, w.player.z) < WARDSTONE.radius + 3.2) {
    name = 'The Hearthfire'; sub = 'Take a brand — press E';
  } else {
    const b = w.nearBrazier();
    if (b) { name = 'Brazier'; sub = b.lit ? 'Burning' : 'Unlit — fetch a brand from the fire'; }
  }
  if (!name) { el.classList.add('hidden'); return; }
  el.querySelector('.stName').textContent = name;
  el.querySelector('.stSub').textContent = sub;
  el.classList.remove('hidden');
}

function syncStation() {
  const el = $('station');
  if (!el) return;
  const st = state.world.station();
  if (!st) { el.classList.add('hidden'); state._station = null; return; }
  state._station = st;
  let sub = st.prompt;
  if (st.id === 'muster') sub = `${DIFFICULTY[state.difficulty].name} — press E to change`;
  else if (st.id === 'dummy') sub = 'Swing. Hold to charge a heavy.';
  else sub = `${st.prompt} — press E`;
  el.querySelector('.stName').textContent = st.name;
  el.querySelector('.stSub').textContent = sub;
  el.classList.remove('hidden');
}

function useStation() {
  const st = state._station;
  if (!st) return false;
  if (st.id === 'portal') {
    state.world.leaveHall();
    state.rend.setHall(false);
    state.rend.snapCamera(state.world);
    $('station').classList.add('hidden');
    startRun(null);
    return true;
  }
  if (st.id === 'muster') {
    const order = ['squire', 'knight', 'warden'];
    const i = (order.indexOf(state.difficulty) + 1) % order.length;
    state.difficulty = order[i];
    state.world.setDifficulty(state.difficulty);
    saveSettings();
    syncSettingsPanel();
    banner(DIFFICULTY[state.difficulty].name, DIFFICULTY[state.difficulty].blurb);
    return true;
  }
  if (st.id === 'rack') {
    const lines = WARDS.map(w =>
      `${w.name} — ${w.cost} mana, ${w.du} unit${w.du > 1 ? 's' : ''}. ${w.blurb}`);
    banner('The Ward Rack', lines.join('  ·  '));
    return true;
  }
  return false;
}

// Walk in. The war is not running while you are here.
function enterHall() {
  hideOverlay($('intro'), 420);
  state.world.enterHall();
  state.rend.setHall(true);
  state.rend.snapCamera(state.world);
  state.running = true;
  state.paused = false;
  $('hud').classList.remove('hide');
  $('hud').classList.add('inHall');
  if (isTouch) $('touch').classList.remove('hidden');
  if (state.snd) { state.snd.unlock().catch(() => {}); state.snd.setMuted(!state.soundOn); }
  banner('The Hall', 'Walk to the gate when you are ready');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function boot() {
  state.world = new World({
    seed: (Math.random() * 1e9) | 0,
    difficulty: state.difficulty,
  });
  state.rend = new Renderer($('stage'), { low: state.low });
  state.snd = new Sound();
  state.map = new Minimap($('map'));
  buildBar();
  initDamageNumbers();
  initDoors();
  bindInput();
  bindSettings();
  loadSettings();
  if (!state.binds) state.binds = defaultBinds();
  rebuildKeymap();
  syncSettingsPanel();   // so the intro's difficulty buttons show what is stored
  syncResume();          // and the resume button only if there is a run to resume
  resize();
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 250));

  $('ctrlHint').textContent = isTouch
    ? 'Stick to move · drag to turn · tap a ward then tap the ground.'
    : 'WASD to move · right-drag to turn · 1-4 pick a ward, click to place · E mends · R readies.';

  if (isTouch) $('touch').classList.add('on');   // shown once play begins

  window.__wsBooted = true;
  hideOverlay($('boot'));
  showOverlay($('intro'));

  requestAnimationFrame((t) => { state.last = t; frame(t); });

  // A render watchdog. Some embedded panels throttle or stop rAF entirely and
  // the canvas goes black with no error at all.
  // See [[preview-panel-raf-blackscreen]].
  setInterval(() => {
    if (performance.now() - state.lastFrame > 900) {
      // Drain as well as render. The end-of-game overlay is raised from a sim
      // EVENT, so a watchdog that only re-renders leaves a finished game with
      // no result screen for as long as rAF stays throttled.
      if (state.running) { drainEvents(); syncHud(); }
      state.rend.update(state.world, 0.016, { moving: false });
      if (state.map) state.map.draw(state.world, state.rend.camYaw);
      state.lastFrame = performance.now();
    }
  }, 1000);
}

addEventListener('blur', () => {
  if (state.running && state.autoPause) setPaused(true);
});
addEventListener('pagehide', writeSave);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running) {
    if (state.autoPause) setPaused(true);
    writeSave();     // saved regardless: leaving the tab is when it matters most
  }
});

// Both entry points come through here. `snap` is a save to restore, or null
// for a fresh run — everything else about starting is identical, and keeping it
// that way is why resume cannot drift out of sync with a new game.
async function startRun(snap) {
  hideOverlay($('intro'), 520);
  state.world.hub = false;
  if (state.rend) state.rend.setHall(false);
  $('hud').classList.remove('inHall');
  const stEl = $('station');
  if (stEl) stEl.classList.add('hidden');
  state._station = null;
  $('hud').classList.remove('hide');
  if (isTouch) $('touch').classList.remove('hidden');
  if (state.map) state.map.resize();   // HUD is visible now, so it can measure

  let resumed = false;
  if (snap) {
    state.world.setDifficulty(snap.difficulty);
    resumed = state.world.restore(snap);
    if (resumed) state.difficulty = snap.difficulty;
  }
  if (!resumed) state.world.setDifficulty(state.difficulty);

  syncHud();
  state.running = true;
  try {
    await state.snd.unlock();
    state.snd.setMuted(!state.soundOn);
    state.snd.setMusicEnabled(state.musicOn);
    state.snd.setPhase(state.world.phase);
  } catch (e) { /* muted is survivable; a crash is not */ }
  applySettings();

  if (resumed) {
    // No tutorial on a resumed run — you have already played these lessons.
    banner('Muster', `Wave ${state.world.waveIndex + 1} of ${WAVES.length} next`);
  } else if (state.tutorial) {
    state.tut = new Tutorial(state.world);
    showTutStep();
  } else {
    banner('Muster', 'Build while the tracks are quiet');
    showHint(0);
  }
  syncHud();
}

// The main action is now walking into your own hall, not starting a fight. A
// run begins by going through the gate at the far end of it, which is the one
// change that turns "pick a level from a list" into "leave home".
$('begin').addEventListener('click', () => { clearSave(); state.tutorial = false; enterHall(); });
// Training is its OWN mode rather than a toggle on a new game: it is a thing
// you choose to do, and you can come back to it without starting a real run.
$('beginTut').addEventListener('click', () => { clearSave(); state.tutorial = true; startRun(null); });
$('resume').addEventListener('click', () => startRun(readSave()));


// ---------------------------------------------------------------------------
// Capture hooks. The tab this runs in is frequently hidden (an embedded pane,
// or an unfocused Chrome window), which throttles rAF to nothing — so single
// screenshots show a frozen game and I end up reviewing a still life.
//
// These drive the sim and the renderer EXPLICITLY, so they work no matter what
// the tab's visibility is, and `filmstrip` composites N frames into one grid
// image so motion is visible in a single picture.
// See [[screenshot-pipeline]] and [[preview-panel-raf-blackscreen]].
// ---------------------------------------------------------------------------
function captureFrames(opts = {}) {
  const cols = opts.cols || 3;
  const rows = opts.rows || 2;
  const n = cols * rows;
  const stepsPer = opts.stepsPer == null ? 30 : opts.stepsPer;   // 0.5s of sim
  const scale = opts.scale || 0.42;
  const cv = state.rend.canvas;
  const fw = Math.round(cv.width * scale), fh = Math.round(cv.height * scale);

  const sheet = document.createElement('canvas');
  sheet.width = fw * cols;
  sheet.height = fh * rows;
  const g = sheet.getContext('2d');
  g.fillStyle = '#05070c';
  g.fillRect(0, 0, sheet.width, sheet.height);

  for (let i = 0; i < n; i++) {
    for (let k = 0; k < stepsPer; k++) {
      state.world.step(STEP);
      if (opts.bot) opts.bot(state.world, STEP);
    }
    drainEvents();
    syncHud();
    // render and copy in the SAME tick — without preserveDrawingBuffer the
    // backbuffer is cleared as soon as control returns to the browser.
    state.rend.update(state.world, stepsPer * STEP, { moving: true });
    if (state.map) state.map.draw(state.world, state.rend.camYaw);
    g.drawImage(cv, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh);
    // label each frame with the clock and what is on the board
    g.font = '600 13px ui-monospace,Menlo,Consolas,monospace';
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect((i % cols) * fw + 4, Math.floor(i / cols) * fh + 4, 150, 18);
    g.fillStyle = '#ffd89a';
    g.fillText(`t=${state.world.t.toFixed(1)}s  foes ${state.world.foes.length}`,
      (i % cols) * fw + 9, Math.floor(i / cols) * fh + 17);
  }
  return sheet;
}

window.WARDSTONE_CAP = {
  // one frame, full size
  shot(q = 0.8) {
    state.rend.update(state.world, 0.016, { moving: false });
    if (state.map) state.map.draw(state.world, state.rend.camYaw);
    return state.rend.canvas.toDataURL('image/jpeg', q);
  },
  // a grid of frames with the sim advancing between them
  filmstrip(opts = {}) {
    return captureFrames(opts).toDataURL('image/jpeg', opts.q || 0.72);
  },
  // Drive N whole frames explicitly — sim, HUD overlays and renderer — so the
  // per-frame features (vignette, FPS, trails) can be exercised in a pane where
  // requestAnimationFrame is throttled to nothing.
  // See [[preview-panel-raf-blackscreen]].
  tick(n = 1, dt = 0.016) {
    for (let i = 0; i < n; i++) {
      stepDamageNumbers(dt);
      syncWardPanel();
      stepVignette(dt);
      stepFps(dt);
      if (state.running && !state.paused) {
        applyInput(dt);
        state.acc += dt;
        let g = 0;
        while (state.acc >= STEP && g++ < 5) { state.world.step(STEP); state.acc -= STEP; }
        drainEvents();
        tickTutorial(dt);
        syncHud();      // or nothing on the HUD advances under this hook
      }
      state.rend.update(state.world, dt, { moving: false });
    }
  },
  // POST a data URL to the local collector; text/plain avoids a CORS preflight
  async post(url, dataUrl, name) {
    const r = await fetch(`${url}?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: dataUrl,
    });
    return r.status;
  },
};

// ---------------------------------------------------------------------------
// Save / resume. The world only serialises at the muster, so this writes at the
// start of every build phase and on the way out of the tab. A run is six waves;
// the worst a crash can cost is the wave you were in.
// ---------------------------------------------------------------------------
const SAVE_KEY = 'wardstone.save';

function writeSave() {
  if (!state.running || !state.world) return;
  const snap = state.world.serialize();      // null unless we are at a muster
  if (!snap) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
  } catch (e) { /* a browser that refuses storage just does not get resume */ }
}

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* fine */ }
}

// The resume button only appears when there is something to resume, and it
// says WHAT it will resume — a button that silently drops you into a run you
// do not remember is worse than no button.
function syncResume() {
  const snap = readSave();
  const btn = $('resume');
  if (!btn) return;
  if (!snap || !WAVES[snap.waveIndex] || snap.map !== currentMap().id) {
    btn.classList.add('gone');
    return;
  }
  btn.classList.remove('gone');
  const map = MAPS[snap.map] ? MAPS[snap.map].name : snap.map;
  const tier = DIFFICULTY[snap.difficulty] ? DIFFICULTY[snap.difficulty].name : '';
  $('resumeSub').textContent =
    `${map} · ${tier} · before wave ${snap.waveIndex + 1} of ${WAVES.length} · ` +
    `${snap.wards.length} ward${snap.wards.length === 1 ? '' : 's'} standing`;
}

// ---------------------------------------------------------------------------
// Settings. Persisted per browser, wrapped so a private window or blocked
// site data cannot break boot.
// ---------------------------------------------------------------------------
const SET_KEYS = ['musicOn', 'soundOn', 'dmgNums', 'hpBars', 'shake', 'low', 'tutorial',
  'minimap', 'calm', 'autoPause', 'fps', 'autoWave'];
const SET_NUMS = ['camDist', 'musVol', 'sfxVol'];
function loadSettings() {
  try {
    const raw = localStorage.getItem('wardstone.settings');
    if (!raw) return;
    const o = JSON.parse(raw);
    for (const k of SET_KEYS) if (typeof o[k] === 'boolean') state[k] = o[k];
    if (typeof o.camDist === 'number') state.camDist = o.camDist;
    for (const k of ['musVol', 'sfxVol', 'shakeAmt', 'sens', 'fov'])
      if (typeof o[k] === 'number') state[k] = o[k];
    if (DIFFICULTY[o.difficulty]) state.difficulty = o.difficulty;
    if (o.binds && typeof o.binds === 'object') {
      // merge rather than replace, so a build that ADDS an action does not
      // leave anyone who saved settings with an unbound control
      state.binds = { ...defaultBinds(), ...o.binds };
    }
  } catch (e) { /* no stored settings is the normal case */ }
}
function saveSettings() {
  try {
    const o = {
      camDist: state.rend ? state.rend.camDist : 11,
      musVol: state.musVol, sfxVol: state.sfxVol, difficulty: state.difficulty,
      shakeAmt: state.shakeAmt, sens: state.sens, fov: state.fov,
      binds: state.binds,
    };
    for (const k of SET_KEYS) o[k] = state[k];
    localStorage.setItem('wardstone.settings', JSON.stringify(o));
  } catch (e) { /* nothing to do about a browser that refuses */ }
}

function applySettings() {
  if (state.snd) {
    state.snd.setSfxVolume(state.sfxVol);
    state.snd.setMusicVolume(state.musVol);
    state.snd.setMuted(!state.soundOn);
    state.snd.setMusicEnabled(state.musicOn);
    if (state.musicOn && state.running) state.snd.setPhase(state.world.phase);
  }
  if (state.rend) {
    state.rend.low = state.low;
    state.rend.renderer.shadowMap.enabled = !state.low;
    state.rend.showHpBars = state.hpBars;
    // Shake is a DIAL now, not a switch: 0 is off, and the old toggle is the
    // 0/1 ends of the same control.
    state.rend.allowShake = state.shakeAmt > 0;
    state.rend.shakeScale = state.shakeAmt;
    state.rend.calm = state.calm;
  }
  $('map').style.display = state.minimap ? '' : 'none';
  $('fps').classList.toggle('hidden', !state.fps);
  resize();
  saveSettings();
}

// The rebinding list. Click a key, press a new one.
//
// Clashes are SHOWN rather than prevented: two actions on one key is sometimes
// exactly what someone wants (block and jump on the same finger), and silently
// refusing a bind is more confusing than marking it. Escape is reserved,
// because a player who binds over it has no way out of a menu.
let listeningFor = null;

function renderBinds() {
  const host = $('binds');
  if (!host) return;
  const used = {};
  for (const a of ACTIONS) {
    const k = state.binds[a.id];
    if (k) (used[k] = used[k] || []).push(a.id);
  }
  host.innerHTML = '';
  for (const a of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'bindRow' + ((used[state.binds[a.id]] || []).length > 1 ? ' clash' : '');
    const label = document.createElement('span');
    label.textContent = a.name;
    const btn = document.createElement('button');
    btn.textContent = listeningFor === a.id ? 'press a key' : keyLabel(state.binds[a.id]);
    if (listeningFor === a.id) btn.classList.add('listening');
    btn.addEventListener('click', () => {
      listeningFor = listeningFor === a.id ? null : a.id;
      renderBinds();
    });
    row.appendChild(label);
    row.appendChild(btn);
    host.appendChild(row);
  }
}

// Captured before the game's own keydown handler, so binding "W" to something
// does not also walk you forward while you are setting it.
function bindCapture(e) {
  if (listeningFor === null) return false;
  const k = e.key.toLowerCase();
  e.preventDefault();
  e.stopPropagation();
  if (k === 'escape') { listeningFor = null; renderBinds(); return true; }
  if (RESERVED.has(k)) { listeningFor = null; renderBinds(); return true; }
  state.binds[listeningFor] = k;
  listeningFor = null;
  rebuildKeymap();
  saveSettings();
  renderBinds();
  if (state.snd) state.snd.play('select', 0.7);
  return true;
}

function syncSettingsPanel() {
  for (const b of document.querySelectorAll('.tgl')) {
    b.classList.toggle('on', !!state[b.dataset.set]);
  }
  const c = $('setCam');
  if (c && state.rend) c.value = Math.round(state.rend.camDist);
  $('setMusVol').value = Math.round(state.musVol * 100);
  $('setSfxVol').value = Math.round(state.sfxVol * 100);
  $('setShake').value = Math.round(state.shakeAmt * 100);
  $('setSens').value = Math.round(state.sens * 100);
  $('setFov').value = Math.round(state.fov);
  for (const b of document.querySelectorAll('.dif'))
    b.classList.toggle('on', b.dataset.diff === state.difficulty);
  renderBinds();
}

// Pause. The sim simply stops being stepped while the renderer keeps running,
// so the world is still there behind the overlay rather than a frozen image —
// and crucially the accumulator is CLEARED on resume, or the first frame back
// would try to catch up on however long the pause lasted.
function setPaused(on) {
  if (state.paused === on) return;
  state.paused = on;
  $('paused').classList.toggle('hidden', !on || !state.running);
  if (!on) { state.acc = 0; state.last = performance.now(); }
  if (state.snd) state.snd.duck(on);
}

function openSettings() {
  syncSettingsPanel();
  $('settings').classList.remove('hidden');
  setPaused(true);
}
function closeSettings() {
  $('settings').classList.add('hidden');
  // If the game is running, closing settings returns you to the pause screen
  // rather than dumping you straight back into a fight you were not watching.
  if (state.running && state.paused) $('paused').classList.remove('hidden');
  else setPaused(false);
}

function bindSettings() {
  for (const b of document.querySelectorAll('.tgl')) {
    b.addEventListener('click', () => {
      const k = b.dataset.set;
      state[k] = !state[k];
      b.classList.toggle('on', state[k]);
      // the old inline toggle is gone; Training is its own menu entry now
      if (k === 'tutorial' && $('optTut')) $('optTut').classList.toggle('on', state[k]);
      applySettings();
    });
  }
  $('setCam').addEventListener('input', (e) => {
    state.rend.camDist = +e.target.value;
    state.rend.camHeight = 2.2 + state.rend.camDist * 0.48;
    saveSettings();
  });
  $('setMusVol').addEventListener('input', (e) => {
    state.musVol = +e.target.value / 100;
    if (state.snd) state.snd.setMusicVolume(state.musVol);
    saveSettings();
  });
  $('setSfxVol').addEventListener('input', (e) => {
    state.sfxVol = +e.target.value / 100;
    if (state.snd) {
      state.snd.setSfxVolume(state.sfxVol);
      state.snd.play('select', 0.6);     // so the slider is audible while dragged
    }
    saveSettings();
  });
  for (const b of document.querySelectorAll('.dif')) {
    b.addEventListener('click', () => {
      state.difficulty = b.dataset.diff;
      for (const o of document.querySelectorAll('.dif')) o.classList.toggle('on', o === b);
      saveSettings();
      if (state.snd) state.snd.play('select', 0.6);
    });
  }
  const slider = (id, apply) => $(id).addEventListener('input', (e) => {
    apply(+e.target.value);
    applySettings();
  });
  slider('setShake', v => { state.shakeAmt = v / 100; });
  slider('setSens', v => { state.sens = v / 100; });
  slider('setFov', v => { state.fov = v; });

  $('bindReset').addEventListener('click', () => {
    state.binds = defaultBinds();
    listeningFor = null;
    rebuildKeymap();
    saveSettings();
    renderBinds();
  });

  // Mend from the panel. Held, like the key — mending is a continuous spend,
  // and a single click that quietly drained mana would be worse than no button.
  const mend = $('wpMend');
  const setMend = (on) => { state.mending = on; mend.classList.toggle('on', on); };
  mend.addEventListener('pointerdown', (e) => { e.preventDefault(); setMend(true); });
  addEventListener('pointerup', () => setMend(false));
  mend.addEventListener('pointerleave', () => setMend(false));

  // Block, as a button rather than only a key nobody was told about.
  const blockChip = $('blockChip');
  blockChip.style.pointerEvents = 'auto';
  blockChip.style.cursor = 'pointer';
  blockChip.addEventListener('pointerdown', (e) => { e.preventDefault(); state.blocking = true; });
  addEventListener('pointerup', () => { state.blocking = false; });

  $('wpUp').addEventListener('click', upgradeInspected);
  $('wpRot').addEventListener('click', () => {
    if (!state.inspect) return;
    state.world.rotateWard(state.inspect);
    if (state.snd) state.snd.play('hover', 0.7);
  });
  $('wpSell').addEventListener('click', () => {
    const w = state.inspect;
    if (!w) return;
    const back = state.world.sell(w);
    if (state.snd) state.snd.play('select', 0.8);
    state.rend.shock(w.x, 0.2, w.z, 0xe0b25c, 0.6, 2.6, 0.36);
    toast(`Sold &mdash; <b>${back}</b> mana back`);
    inspectWard(null);
  });

  $('pResume').addEventListener('click', () => setPaused(false));
  $('pSettings').addEventListener('click', () => {
    // settings already pauses; opening it from here just swaps the overlay
    $('paused').classList.add('hidden');
    openSettings();
  });
  $('pQuit').addEventListener('click', () => {
    writeSave();                       // keep the run so Resume can find it
    location.reload();
  });

  $('openHow').addEventListener('click', () => {
    $('how').classList.remove('hidden');
    if (state.snd) state.snd.play('select', 0.6);
  });
  $('closeHow').addEventListener('click', () => $('how').classList.add('hidden'));
  $('openSet').addEventListener('click', openSettings);
  $('closeSet').addEventListener('click', closeSettings);
  $('gearBtn').addEventListener('click', openSettings);

  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('how').classList.contains('hidden')) { $('how').classList.add('hidden'); return; }
    if (!$('settings').classList.contains('hidden')) { closeSettings(); return; }
    // Esc used to open settings with the wave still running underneath. Now it
    // pauses first; a second Esc resumes, and the gear opens settings.
    if (state.running) setPaused(!state.paused);
    else openSettings();
  });
  $('tutSkip').addEventListener('click', () => {
    if (state.tut) state.tut.done = true;
    $('tut').classList.add('hidden');
  });
}

// ---------------------------------------------------------------------------
// Tutorial driving
// ---------------------------------------------------------------------------
// Pulse whatever the current step is asking you to press. Telling someone to
// "press 1 for a Palisade" is not the same as showing them which thing that is.
function paintTutPointer(step) {
  for (const el of document.querySelectorAll('.tutPoint')) el.classList.remove('tutPoint');
  if (!step || !step.point) return;
  // Touch-only controls are absent on desktop, so a missing or hidden target is
  // skipped rather than thrown on. Visibility is tested with getClientRects and
  // NOT offsetParent: offsetParent is null for any `position: fixed` element,
  // which silently dropped the pointer on half the HUD.
  const el = document.querySelector(step.point);
  if (el && el.getClientRects().length > 0) el.classList.add('tutPoint');
}

function showTutStep() {
  const t = state.tut;
  const el = $('tut');
  if (!t || t.done) { el.classList.add('hidden'); paintTutPointer(null); return; }
  const st = t.step;
  if (!st) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('tutStep').textContent = `${t.i + 1} / ${STEPS.length}`;
  $('tutTitle').textContent = st.title;
  $('tutText').innerHTML = (isTouch && st.touch) ? st.touch : st.text;
  paintTutPointer(st);
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
  if (state.snd) state.snd.play('select', 0.5);
}

function tickTutorial(dt) {
  const t = state.tut;
  if (!t || t.done) return;
  // The muster phase does not run out while the tutorial is still teaching.
  if (state.world.phase === 'build') state.world.phaseTimer = 99;
  const pending = t.takeSpawns(state.world);
  if (pending && pending.length) {
    for (const [lane, foe] of pending) state.world._spawn(lane, foe);
  }
  if (t.tick(dt, state.world)) {
    showTutStep();
    if (t.done) {
      $('tut').classList.add('hidden');
      banner('Ready', 'the tutorial is done');
      if (state.world.phase === 'build') state.world.phaseTimer = ECON.interPhase;
    }
  }
}

boot();

// Console handles for poking at a live game.
window.WARDSTONE = {
  get world() { return state.world; },
  get rend() { return state.rend; },
  state, WARDS, WAVES, ECON,
  step: (n = 1) => { for (let i = 0; i < n; i++) state.world.step(STEP); },
  give: (m = 1000) => { state.world.mana += m; },
  skip: () => state.world.ready(),
};
