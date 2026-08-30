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
  WARDS, WARD_BY_ID, ECON, WAVES, PLAYER, ABILITY, waveByLane, DIFFICULTY,
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
const STEP = 1 / 60;

const isTouch = window.matchMedia('(pointer: coarse)').matches ||
  ('ontouchstart' in window && Math.min(screen.width, screen.height) < 900);

const state = {
  world: null, rend: null, snd: null,
  running: false, selected: null,
  keys: new Set(),
  move: { x: 0, y: 0 },        // -1..1 from stick or WASD
  firing: false, mending: false, wantDodge: false, blocking: false,
  pointer: { x: 0, y: 0, has: false },
  ghostCell: null, ghostRot: null, overhead: false,
  acc: 0, last: 0, lastFrame: 0, hitstop: 0,
  vel: { x: 0, z: 0 },
  hintShown: new Set(),
  low: isTouch,
  musicOn: true, soundOn: true, dmgNums: false,
  musVol: 0.34, sfxVol: 0.9, difficulty: 'knight', paused: false,
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
  const icons = { palisade: '&#9776;', ballista: '&#10142;', archers: '&#9670;', caltrops: '&#9678;' };
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

function select(id) {
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
  const hf = Math.max(0, w.player.hp / w.player.maxHp);
  const hp = $('hpFill');
  hp.style.width = (hf * 100) + '%';
  hp.classList.toggle('low', hf < 0.35);

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
    wp.className = 'wchip ' + p.weapon;
  }
  const ab = $('abil');
  if (ab) {
    const ready = p.abilityCd <= 0;
    ab.classList.toggle('ready', ready);
    ab.style.setProperty('--k', ready ? 1 : (1 - p.abilityCd / ABILITY.cooldown));
    ab.textContent = ready ? 'Rally' : Math.ceil(p.abilityCd) + 's';
  }
  const rl = $('roll');
  if (rl) {
    const ready = p.dodgeCd <= 0;
    rl.classList.toggle('ready', ready);
    rl.style.setProperty('--k', ready ? 1 : (1 - p.dodgeCd / PLAYER.dodge.cooldown));
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
  for (const [id, label] of [['husk', 'goblins'], ['runner', 'scouts'],
                             ['wisp', 'wisps'], ['breaker', 'trolls']]) {
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
      case 'swing':
        if (e.airborneInReach) {
          // the swing passed under it. Say why, once, rather than letting the
          // player conclude the enemy is broken.
          toast('Your sword cannot reach something in the air &mdash; press <b>Q</b>');
          if (s) s.play('foeSwing', 0.9, 0.55);
          r.spark(e.x + e.dx * 2.0, 2.6, e.z + e.dz * 2.0, 0x9fb4d0, 5, 4, 0.7, -2);
        }
        // a sword that connects stops time for a moment; one that whiffs does not
        if (e.hits > 0) {
          state.hitstop = Math.max(state.hitstop, 0.05 + Math.min(0.05, e.hits * 0.02));
          r.addShake(0.10 + Math.min(0.2, e.hits * 0.05));
          r.spark(e.x + e.dx * 1.9, 1.0, e.z + e.dz * 1.9, 0xfff0c8, 8 + e.hits * 3, 7, 1.0, -3);
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
      case 'dodge':
        r.ringBurst(e.x, 0.25, e.z, 0xbcd2f5, 1.5, 12);
        if (s) s.play('foeSwing', 0.5, 1.5);
        break;
      case 'kill': {
        const big = e.foe === 'breaker';
        r.spark(e.x, (e.y || 0) + 0.8, e.z,
          e.foe === 'wisp' ? PAL.wisp : (big ? 0xff8060 : 0xc8b89a),
          big ? 26 : 9, big ? 9 : 4.5, big ? 2.2 : 1);
        if (big) {
          r.addShake(0.65);
          r.ringBurst(e.x, 0.4, e.z, 0xff8060, 3.4, 20);
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
        r.spark(e.x, 1, e.z, 0x8a7a5a, 20, 6, 1.5);
        r.addShake(0.25);
        break;
      case 'caltrops':
        r.ringBurst(e.x, 0.3, e.z, PAL.snare, e.r, 22);
        r.addShake(0.16);
        break;
      case 'stoneHit':
        r.addShake(Math.min(0.7, e.amount / 130));
        r.spark(0, 3.3, 0, 0xffb347, 4, 4, 1.2);
        flash(Math.min(0.4, e.amount / 500));
        break;
      case 'playerHurt':
        flash(0.28);
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
const FOE_TINT = { husk: '#a8ae9c', runner: '#8fbf6a', wisp: '#8fe6c0', breaker: '#8a6a4a' };

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
      for (const k of ['husk', 'runner', 'wisp', 'breaker']) {
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
  flashT = Math.max(flashT, a);
  $('flash').style.opacity = flashT;
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
    `Slain — husks <b>${k.husk || 0}</b>, runners <b>${k.runner || 0}</b>, ` +
    `wisps <b>${k.wisp || 0}</b>, breakers <b>${k.breaker || 0}</b><br>` +
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
    const k = e.key.toLowerCase();
    state.keys.add(k);
    if (k >= '1' && k <= '4') {
      const wd = WARDS[+k - 1];
      if (wd && state.world.isUnlocked(wd.id)) select(wd.id);
      else if (wd) state.snd.play('hover', 0.6, 0.7);
    }
    if (k === 'escape' || k === '0') { state.selected = null; select(null); }
    if (k === 'r') {
      // contextual: R rotates the thing you are holding, or readies the wave
      if (state.selected) {
        state.ghostRot = (state.ghostRot == null ? 0 : state.ghostRot) + Math.PI / 4;
        state.snd.play('hover', 0.7);
      } else if (state.world.ready()) {
        state.snd.play('click');
      }
    }
    if (k === 'q') state.world.swapWeapon();
    if (k === 'tab' || k === 'b') { e.preventDefault(); toggleOverhead(); }
    if (k === ' ') { e.preventDefault(); state.wantDodge = true; }
    if (k === 'v') state.world.rally();
    if (k === 'x' && state.selected === null) sellUnderPointer();
    if (k === 'f' && state.selected === null) {
      const w = state.world;
      const near = state.overhead ? wardUnderPointer() : w.wardNear(4.2);
      const r = w.canUpgrade(near);
      if (r.ok) { w.upgrade(near); }
      else if (near) { toast(r.why); state.snd.play('hover', 0.6, 0.7); }
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
  });

  cv.addEventListener('pointermove', (e) => {
    state.pointer.x = e.clientX; state.pointer.y = e.clientY; state.pointer.has = true;
    if (!dragging) return;
    // Right-drag on desktop turns the camera. On touch, ANY drag turns it —
    // a tap is reserved for placing, which is decided on pointerup by
    // distance travelled, so the two never fight.
    if (dragBtn === 2 || isTouch) {
      state.rend.camYaw -= (e.clientX - lastX) * 0.0055;
      lastX = e.clientX;
    }
  });

  const up = (e) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    const quick = performance.now() - downT < 400;
    if (dragging && dragBtn === 0 && moved < 12 && quick) {
      if (state.selected) tryBuild(e.clientX, e.clientY);
      else if (isTouch) { /* touch fires from the button, not the field */ }
    }
    dragging = false;
    state.firing = false;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', () => { dragging = false; state.firing = false; });

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
  tap($('bRally'), () => state.world.rally());

  // a dedicated turn pad, for when a thumb is busy on the stick
  const cam = $('bCam');
  let camId = null, camX = 0;
  cam.addEventListener('pointerdown', (e) => {
    e.preventDefault(); camId = e.pointerId; camX = e.clientX;
    cam.setPointerCapture(e.pointerId); cam.classList.add('on');
  });
  cam.addEventListener('pointermove', (e) => {
    if (e.pointerId !== camId) return;
    state.rend.camYaw -= (e.clientX - camX) * 0.012;
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
  if (state.keys.has('w') || state.keys.has('arrowup')) my -= 1;
  if (state.keys.has('s') || state.keys.has('arrowdown')) my += 1;
  if (state.keys.has('a') || state.keys.has('arrowleft')) mx -= 1;
  if (state.keys.has('d') || state.keys.has('arrowright')) mx += 1;
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
  w.setBlocking(state.blocking || state.keys.has('shift'));

  // mending
  const wantMend = state.mending || state.keys.has('e');
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
  if (state.wantDodge) {
    state.wantDodge = false;
    if (m > 0.02) w.dodge(vx, vz);
    else w.dodge(Math.sin(p.yaw), Math.cos(p.yaw));
  }

  // attacking — the weapon decides whether that is a sweep or a bolt
  if ((state.firing || state.keys.has('f')) && p.atkCd <= 0 && !state.selected) {
    let ax = fx, az = fz, ay = 0;
    if (!isTouch && state.pointer.has) {
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
    p.yaw = Math.atan2(ax, az);
    if (before === 'ranged') {
      // muzzle flash, thrown forward off the stock
      r.spark(p.x + ax * 1.0, 1.25, p.z + az * 1.0, 0xffe8b8, 6, 5.5, 0.8, -2);
      r.addShake(0.045);
    }
  }

  // whatever ward you are next to (or pointing at) shows its reach
  r._inspect = state.selected ? null
    : (state.overhead ? wardUnderPointer() : w.wardNear(4.6));

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
  if (state.running) stepDoors();
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
  state.rend.camera.fov = aspect < 0.72 ? 78 : (aspect < 1.05 ? 70 : 62);
  state.rend.lookAhead = aspect < 0.72 ? 4.5 : (aspect < 1.05 ? 4 : 3);
  state.rend.resize(w, h, dpr);
  if (state.map) state.map.resize();
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

addEventListener('blur', () => { if (state.running) setPaused(true); });
addEventListener('pagehide', writeSave);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running) { setPaused(true); writeSave(); }
});

// Both entry points come through here. `snap` is a save to restore, or null
// for a fresh run — everything else about starting is identical, and keeping it
// that way is why resume cannot drift out of sync with a new game.
async function startRun(snap) {
  hideOverlay($('intro'), 520);
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

$('begin').addEventListener('click', () => { clearSave(); startRun(null); });
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
const SET_KEYS = ['musicOn', 'soundOn', 'dmgNums', 'hpBars', 'shake', 'low', 'tutorial'];
const SET_NUMS = ['camDist', 'musVol', 'sfxVol'];
function loadSettings() {
  try {
    const raw = localStorage.getItem('wardstone.settings');
    if (!raw) return;
    const o = JSON.parse(raw);
    for (const k of SET_KEYS) if (typeof o[k] === 'boolean') state[k] = o[k];
    if (typeof o.camDist === 'number') state.camDist = o.camDist;
    for (const k of ['musVol', 'sfxVol'])
      if (typeof o[k] === 'number') state[k] = o[k];
    if (DIFFICULTY[o.difficulty]) state.difficulty = o.difficulty;
  } catch (e) { /* no stored settings is the normal case */ }
}
function saveSettings() {
  try {
    const o = {
      camDist: state.rend ? state.rend.camDist : 11,
      musVol: state.musVol, sfxVol: state.sfxVol, difficulty: state.difficulty,
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
    state.rend.allowShake = state.shake;
  }
  resize();
  saveSettings();
}

function syncSettingsPanel() {
  for (const b of document.querySelectorAll('.tgl')) {
    b.classList.toggle('on', !!state[b.dataset.set]);
  }
  const c = $('setCam');
  if (c && state.rend) c.value = Math.round(state.rend.camDist);
  $('setMusVol').value = Math.round(state.musVol * 100);
  $('setSfxVol').value = Math.round(state.sfxVol * 100);
  for (const b of document.querySelectorAll('.dif'))
    b.classList.toggle('on', b.dataset.diff === state.difficulty);
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
  setPaused(false);
}

function bindSettings() {
  for (const b of document.querySelectorAll('.tgl')) {
    b.addEventListener('click', () => {
      const k = b.dataset.set;
      state[k] = !state[k];
      b.classList.toggle('on', state[k]);
      if (k === 'tutorial') $('optTut').classList.toggle('on', state[k]);
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
  $('openHow').addEventListener('click', () => {
    $('how').classList.remove('hidden');
    if (state.snd) state.snd.play('select', 0.6);
  });
  $('closeHow').addEventListener('click', () => $('how').classList.add('hidden'));
  $('openSet').addEventListener('click', openSettings);
  $('closeSet').addEventListener('click', closeSettings);
  $('gearBtn').addEventListener('click', openSettings);
  $('optTut').addEventListener('click', function () {
    state.tutorial = !state.tutorial;
    this.classList.toggle('on', state.tutorial);
    saveSettings();
  });
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
function showTutStep() {
  const t = state.tut;
  const el = $('tut');
  if (!t || t.done) { el.classList.add('hidden'); return; }
  const st = t.step;
  if (!st) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  $('tutStep').textContent = `${t.i + 1} / ${STEPS.length}`;
  $('tutTitle').textContent = st.title;
  $('tutText').innerHTML = (isTouch && st.touch) ? st.touch : st.text;
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
