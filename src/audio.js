// WARDSTONE — sound.
//
// NOTE the class is called `Sound`, not `Audio`. A class named `Audio` shadows
// the DOM global for the whole module and the failure surfaces somewhere far
// away and unrelated. See [[class-names-shadow-web-api-globals]].
//
// Sound effects are decoded into buffers up front (they are tiny). Music is
// streamed through <audio> elements and loaded LAZILY, so 3.4 MB of tracks can
// never delay the first frame — the game is playable before the music arrives.

const SFX = {
  bolt: ['bolt'],
  impact: ['impact0', 'impact1', 'impact2'],
  hitFlesh: ['hitFlesh0', 'hitFlesh1'],
  hitMetal: ['hitMetal0', 'hitMetal1'],
  blockHit: ['blockHit'],
  swoosh: ['swoosh'],
  rally: ['rally'],
  foeDie: ['foeDie0', 'foeDie1'],
  build: ['build'],
  wardDown: ['wardDown'],
  snare: ['snare'],
  ballista: ['ballista'],
  stoneHit: ['stoneHit'],
  hurt: ['hurt'],
  foeSwing: ['foeSwing'],
  mote: ['mote'],
  spawn: ['spawn'],
  click: ['click'],
  hover: ['hover'],
  select: ['select'],
  waveStart: ['waveStart'],
  waveClear: ['waveClear'],
  win: ['win'],
  lose: ['lose'],
};

// Per-cue mix. Levels are set here rather than in the source files so the
// balance between, say, a bolt and the wardstone alarm is one edit.
const GAIN = {
  hitFlesh: 0.5, hitMetal: 0.42, blockHit: 0.6, swoosh: 0.28, rally: 0.75,
  bolt: 0.20, impact: 0.24, foeDie: 0.32, build: 0.55, wardDown: 0.7,
  snare: 0.6, ballista: 0.3, stoneHit: 0.85, hurt: 0.6, foeSwing: 0.16,
  mote: 0.3, spawn: 0.35, click: 0.4, hover: 0.18, select: 0.45,
  waveStart: 0.6, waveClear: 0.55, win: 0.8, lose: 0.8,
};

// A cue that can fire fifty times a second needs a floor between plays or it
// turns into a buzz and clips the master bus.
const THROTTLE = {
  hitFlesh: 0.03, hitMetal: 0.03, swoosh: 0.05,
  impact: 0.035, foeSwing: 0.09, bolt: 0.05, mote: 0.04, foeDie: 0.05,
  ballista: 0.05, hurt: 0.2, stoneHit: 0.12,
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.ready = false;
    this.muted = false;
    this.last = new Map();
    this.music = { build: null, combat: null };
    this.musicOn = false;
    this.current = null;
    this.musicVol = 0.34;
    this.sfxVol = 0.9;
  }

  // Must be called from a user gesture — browsers will not start an
  // AudioContext otherwise, and a silent game reads as a broken one.
  async unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.sfxVol;
    this.master.connect(this.ctx.destination);
    await this._loadAll();
    this.ready = true;
  }

  async _loadAll() {
    const names = new Set();
    for (const k in SFX) for (const n of SFX[k]) names.add(n);
    await Promise.all([...names].map(async (n) => {
      try {
        const r = await fetch(`assets/audio/${n}.ogg`);
        if (!r.ok) return;
        const ab = await r.arrayBuffer();
        this.buffers.set(n, await this.ctx.decodeAudioData(ab));
      } catch (e) { /* a missing cue must never break the game */ }
    }));
  }

  // Two samples on top of each other, the second pitched and delayed a hair.
  // A single sample reads as a click; a layered pair reads as an impact.
  layer(a, b, vol = 1, rate = 1) {
    this.play(a, vol, rate);
    if (b) setTimeout(() => this.play(b, vol * 0.7, rate * 0.82), 18);
  }

  play(cue, vol = 1, rate = 1) {
    if (!this.ready || this.muted) return;
    const th = THROTTLE[cue];
    if (th) {
      const now = this.ctx.currentTime;
      if ((this.last.get(cue) || -9) + th > now) return;
      this.last.set(cue, now);
    }
    const list = SFX[cue];
    if (!list) return;
    const buf = this.buffers.get(list[(Math.random() * list.length) | 0]);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain();
    g.gain.value = (GAIN[cue] == null ? 0.4 : GAIN[cue]) * vol;
    src.connect(g); g.connect(this.master);
    src.start();
  }

  // ---- music ------------------------------------------------------------
  // Loaded on demand and faded, never hard-cut: the switch from the crypt
  // ambience to the march is the loudest signal that a wave has begun.
  initMusic() {
    if (this.music.build) return;
    const mk = (src) => {
      const a = new window.Audio();
      a.src = src; a.loop = true; a.volume = 0; a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      return a;
    };
    this.music.build = mk('assets/music/build.ogg');
    this.music.combat = mk('assets/music/combat.mp3');
  }

  setPhase(phase) {
    if (!this.musicOn) return;
    this.initMusic();
    const want = phase === 'combat' ? 'combat' : 'build';
    if (this.current === want) return;
    this.current = want;
    for (const k of ['build', 'combat']) {
      const el = this.music[k];
      if (!el) continue;
      if (k === want) {
        el.play().catch(() => {});
        this._fade(el, this.musicVol, 1.2);
      } else {
        this._fade(el, 0, 0.9, true);
      }
    }
  }

  _fade(el, to, secs, pauseAtEnd) {
    if (el._fadeTimer) clearInterval(el._fadeTimer);
    const from = el.volume, t0 = performance.now();
    el._fadeTimer = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / (secs * 1000));
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) {
        clearInterval(el._fadeTimer);
        el._fadeTimer = null;
        if (pauseAtEnd && el.volume <= 0.001) el.pause();
      }
    }, 40);
  }

  setMusicEnabled(on) {
    this.musicOn = on;
    if (!on) {
      for (const k of ['build', 'combat']) {
        const el = this.music[k];
        if (el) { el.pause(); el.volume = 0; }
      }
      this.current = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.sfxVol;
    for (const k of ['build', 'combat']) {
      const el = this.music[k];
      if (el) el.muted = m;
    }
  }
}

// Maps a sim event onto a cue. Kept here so sim.js never learns what a sound
// is and render.js never learns what a cue is named.
export function playEvent(snd, ev, fx) {
  switch (ev.type) {
    case 'bolt':      snd.play('bolt'); break;
    case 'shoot':     snd.play('ballista'); break;
    case 'impact':
      // a player bolt lands with weight; a ward's is background
      if (ev.source === 'player') snd.layer('hitFlesh', 'impact', 1, 1);
      else snd.play('impact', 0.7);
      break;
    case 'kill':
      snd.layer('foeDie', ev.foe === 'breaker' ? 'hitMetal' : null,
        ev.foe === 'breaker' ? 1.4 : 1, ev.foe === 'breaker' ? 0.6 : 1);
      break;
    case 'build':     snd.play('build'); break;
    case 'sell':      snd.play('select'); break;
    case 'swing':
      // the swoosh always plays; the meat only if it connected
      snd.play('swoosh', ev.hits ? 1 : 0.6, ev.hits ? 1 : 1.15);
      if (ev.hits) snd.layer('hitFlesh', 'hitMetal', Math.min(1.4, 0.8 + ev.hits * 0.2), 0.95);
      break;
    case 'blocked':   snd.play('blockHit', 1, 0.9 + Math.random() * 0.2); break;
    case 'rally':     snd.layer('rally', 'waveStart', 1, 0.75); break;
    case 'wardDown':  snd.play('wardDown'); break;
    case 'snare':     snd.play('snare'); break;
    case 'stoneHit':  snd.play('stoneHit', Math.min(1, ev.amount / 90)); break;
    case 'playerHurt':snd.play('hurt'); break;
    case 'foeSwing':  snd.play('foeSwing', ev.at === 'stone' ? 0.9 : 0.5); break;
    case 'mote':      snd.play('mote', 0.8, 1 + Math.random() * 0.25); break;
    case 'spawn':
      // A breaker gets its own arrival: the wardstone bell, pitched right down
      // into a toll. Reuses an existing cue rather than shipping another file.
      if (ev.foe === 'breaker') snd.play('stoneHit', 1.0, 0.42);
      else snd.play('spawn', 0.5);
      break;
    case 'wave':      snd.play('waveStart'); break;
    case 'waveClear': snd.play('waveClear'); break;
    case 'won':       snd.play('win'); break;
    case 'lost':      snd.play('lose'); break;
    case 'playerDown':snd.play('lose', 0.5, 1.3); break;
  }
}
