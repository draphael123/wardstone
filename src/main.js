// WARDSTONE — wiring.
//
// Owns the loop, the input and the DOM. It is the only file that knows a
// browser exists AND knows the rules exist; sim.js has no DOM, render.js has
// no rules, and this is where the two are introduced to each other.

import * as THREE from '../vendor/three.module.js';
import { World } from './sim.js';
import { Renderer, PAL } from './render.js';
import { Sound, playEvent } from './audio.js';
import { WARDS, WARD_BY_ID, ECON, WAVES, PLAYER } from './defs.js';
import { cellOf, cellCenter, isBuildableCell, ARENA } from './arena.js';

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
  firing: false, mending: false,
  pointer: { x: 0, y: 0, has: false },
  ghostCell: null,
  acc: 0, last: 0, lastFrame: 0,
  hintShown: new Set(),
  low: isTouch,
  musicOn: true, soundOn: true,
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
  const icons = { palisade: '&#9776;', ballista: '&#10142;', brazier: '&#9670;', snare: '&#9678;' };
  for (const w of WARDS) {
    const el = document.createElement('div');
    el.className = 'ward';
    el.dataset.id = w.id;
    el.innerHTML =
      `<div class="k">${w.key}</div>` +
      `<div class="ic">${icons[w.id]}</div>` +
      `<div class="nm">${w.name}</div>` +
      `<div class="cost mono">${w.cost}<s>${w.du}u</s></div>`;
    el.title = w.blurb;
    el.addEventListener('click', (e) => { e.stopPropagation(); select(w.id); });
    el.addEventListener('pointerenter', () => state.snd && state.snd.play('hover'));
    bar.appendChild(el);
  }
}

function select(id) {
  state.selected = state.selected === id ? null : id;
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

  const hf = Math.max(0, w.player.hp / w.player.maxHp);
  const hp = $('hpFill');
  hp.style.width = (hf * 100) + '%';
  hp.classList.toggle('low', hf < 0.35);

  for (const el of document.querySelectorAll('.ward')) {
    const d = WARD_BY_ID[el.dataset.id];
    el.classList.toggle('poor', w.mana < d.cost || w.du + d.du > ECON.duBudget);
  }
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
    switch (e.type) {
      case 'impact':
        r.spark(e.x, e.y, e.z, e.source === 'player' ? 0xffe0a8 : 0xffc27a, 5, 5, 0.8);
        break;
      case 'kill': {
        const big = e.foe === 'breaker';
        r.spark(e.x, (e.y || 0) + 0.8, e.z,
          e.foe === 'wisp' ? PAL.wisp : (big ? 0xff8060 : 0xc8b89a),
          big ? 26 : 9, big ? 9 : 4.5, big ? 2.2 : 1);
        if (big) { r.addShake(0.5); r.ringBurst(e.x, 0.4, e.z, 0xff8060, 3, 16); }
        break;
      }
      case 'build':
        r.ringBurst(e.x, 0.3, e.z, 0x7fe08a, 1.6, 12);
        break;
      case 'wardDown':
        r.spark(e.x, 1, e.z, 0x8a7a5a, 20, 6, 1.5);
        r.addShake(0.25);
        break;
      case 'snare':
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
        break;
      case 'mote':
        break;
      case 'wave':
        banner(e.name, `Wave ${e.index + 1} of ${WAVES.length}`);
        showHint(e.index);
        break;
      case 'waveClear':
        banner('Wave held', `+${e.bonus} mana · muster`);
        break;
      case 'won': endGame(true); break;
      case 'lost': endGame(false); break;
    }
  }
  w.events.length = 0;
}

let flashT = 0;
function flash(a) {
  flashT = Math.max(flashT, a);
  $('flash').style.opacity = flashT;
}

// ---------------------------------------------------------------------------
function endGame(won) {
  state.running = false;
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
      const w = WARDS[+k - 1];
      if (w) select(w.id);
    }
    if (k === 'escape' || k === '0') { state.selected = null; select(null); }
    if (k === 'r' || k === ' ') { if (state.world.ready()) state.snd.play('click'); }
    if (k === 'x' && state.selected === null) sellUnderPointer();
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
    state.rend.camDist = Math.max(9, Math.min(30, state.rend.camDist + Math.sign(e.deltaY) * 1.4));
    state.rend.camHeight = state.rend.camDist * 0.8;
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

function tryBuild(px, py) {
  const w = state.world;
  const c = pickCell(px, py) || cellAhead();
  if (!c) return;
  const r = w.canBuild(state.selected, c.i, c.j);
  if (r.ok) {
    w.build(state.selected, c.i, c.j);
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

function sellUnderPointer() {
  const w = state.world;
  const c = state.pointer.has ? pickCell(state.pointer.x, state.pointer.y) : cellAhead();
  if (!c) return;
  const ward = w.wardAtCell(c.i, c.j);
  if (ward) w.sell(ward);
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
  const sin = Math.sin(r.camYaw), cos = Math.cos(r.camYaw);
  const fx = -sin, fz = -cos;          // camera forward on the ground plane
  const rx = cos, rz = -sin;           // camera right
  const vx = (fx * -my + rx * mx) * PLAYER.speed;
  const vz = (fz * -my + rz * mx) * PLAYER.speed;
  if (m > 0.02) {
    w.movePlayer(vx, vz, dt);
    p.yaw = Math.atan2(vx, vz);
  }
  state._moving = m > 0.02;

  // mending
  const wantMend = state.mending || state.keys.has('e');
  if (wantMend) {
    const hp = w.repairStep(dt);
    if (hp > 0 && Math.random() < dt * 14) {
      const t = w.repairTarget();
      if (t) r.spark(t.x, 1.1, t.z, 0x7fe08a, 1, 2.2, 0.7, -2);
    }
  } else {
    p.repairing = null;
  }

  // loosing a bolt — aimed down the camera unless the pointer says otherwise
  if ((state.firing || state.keys.has('f')) && p.boltCd <= 0 && !state.selected) {
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
    w.fireBolt(ax, az, ay);
    p.yaw = Math.atan2(ax, az);
    r.spark(p.x + ax * 0.8, 1.25, p.z + az * 0.8, 0xffe0a8, 3, 3, 0.5, -1);
  }

  // ghost while building
  if (state.selected) {
    const c = (!isTouch && state.pointer.has ? pickCell(state.pointer.x, state.pointer.y) : null) || cellAhead();
    if (c) {
      state.ghostCell = c;
      r.showGhost(state.selected, c.i, c.j, w.canBuild(state.selected, c.i, c.j).ok);
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

  if (flashT > 0) {
    flashT = Math.max(0, flashT - dt * 2.2);
    $('flash').style.opacity = flashT;
  }

  if (state.running) {
    applyInput(dt);
    // Fixed timestep so the sim is identical to the one the harness measured.
    state.acc += dt;
    let n = 0;
    while (state.acc >= STEP && n++ < 5) {
      state.world.step(STEP);
      state.acc -= STEP;
    }
    drainEvents();
    syncHud();
    if (state.snd) state.snd.setPhase(state.world.phase);
  }
  state.rend.update(state.world, dt, { moving: state._moving });
}

function resize() {
  const w = innerWidth, h = innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, state.low ? 1.5 : 2);
  // A portrait phone sees far less of the board horizontally at a fixed FOV,
  // and this game is about watching three lanes at once. Widen the lens as the
  // viewport gets taller than it is wide.
  const aspect = w / h;
  state.rend.camera.fov = aspect < 0.72 ? 76 : (aspect < 1.05 ? 66 : 56);
  state.rend.lookAhead = aspect < 0.72 ? 7.5 : (aspect < 1.05 ? 6 : 4);
  state.rend.resize(w, h, dpr);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function boot() {
  state.world = new World({ seed: (Math.random() * 1e9) | 0 });
  state.rend = new Renderer($('stage'), { low: state.low });
  state.snd = new Sound();
  buildBar();
  bindInput();
  resize();
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 250));

  $('ctrlHint').textContent = isTouch
    ? 'Stick to move · drag to turn · tap a ward then tap the ground.'
    : 'WASD to move · right-drag to turn · 1-4 pick a ward, click to place · E mends · R readies.';

  if (isTouch) $('touch').classList.add('on');   // shown once play begins
  $('optLow').classList.toggle('on', state.low);

  window.__wsBooted = true;
  hideOverlay($('boot'));
  showOverlay($('intro'));

  requestAnimationFrame((t) => { state.last = t; frame(t); });

  // A render watchdog. Some embedded panels throttle or stop rAF entirely and
  // the canvas goes black with no error at all.
  // See [[preview-panel-raf-blackscreen]].
  setInterval(() => {
    if (performance.now() - state.lastFrame > 900) {
      state.rend.update(state.world, 0.016, { moving: false });
      state.lastFrame = performance.now();
    }
  }, 1000);
}

$('optMusic').addEventListener('click', function () {
  state.musicOn = !state.musicOn; this.classList.toggle('on', state.musicOn);
});
$('optSound').addEventListener('click', function () {
  state.soundOn = !state.soundOn; this.classList.toggle('on', state.soundOn);
});
$('optLow').addEventListener('click', function () {
  state.low = !state.low; this.classList.toggle('on', state.low);
  state.rend.low = state.low;
  state.rend.renderer.shadowMap.enabled = !state.low;
  state.rend.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  resize();
});

$('begin').addEventListener('click', async () => {
  hideOverlay($('intro'), 520);
  $('hud').classList.remove('hide');
  if (isTouch) $('touch').classList.remove('hidden');
  state.running = true;
  try {
    await state.snd.unlock();
    state.snd.setMuted(!state.soundOn);
    state.snd.setMusicEnabled(state.musicOn);
    state.snd.setPhase(state.world.phase);
  } catch (e) { /* muted is survivable; a crash is not */ }
  banner('Muster', 'Build while the doors are shut');
  showHint(0);
  syncHud();
});

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
