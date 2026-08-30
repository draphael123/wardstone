// WARDSTONE — everything you can see.
//
// Reads the World, owns no rules. Nothing in here may change a hit point.
//
// The look is derived from the premise rather than chosen for it: you are
// defending the only light in the place. So the wardstone IS the key light,
// its intensity tracks its own health, and losing turns the crypt dark from
// the middle outwards. That means stone HP is legible without reading a bar —
// see [[worlds-as-bands-not-skins]].
//
// Every mesh is generated here. No downloaded models: procedural geometry is
// what keeps this under 4 MB and lets a phone hold 120 foes.

import * as THREE from '../vendor/three.module.js';
import { FOES, FOE_BY_ID, WARDS, WARD_BY_ID, WARDSTONE as STONE_DEF, PLAYER } from './defs.js';
import { LANES, ARENA, CELL, cellCenter, laneAt, nearestLane } from './arena.js';
import { makeRng } from './rand.js';

export const PAL = {
  night:    0x1a1622,   // warm dark, not blue-black
  fog:      0x2a2233,
  floor:    0x585044,   // lit stone. Dark floors read as a void, not a room.
  floorInset:0x413a30,
  floorEdge:0x7d7161,
  lane:     0x3a3140,
  wall:     0x4a4139,
  wallTop:  0x5e5449,
  wallDark: 0x332c25,
  stone:    0xffb347,
  stoneCore:0xfff0d0,
  timber:   0x8a5f38,
  iron:     0x646b7d,
  ember:    0xff8b3d,
  snare:    0xa579ff,
  player:   0xd8e2f0,
  cloak:    0x9a2f3a,
  husk:     0xa8ae9c,
  runner:   0x8fbf6a,
  wisp:     0x63e6ff,
  breaker:  0xa33f36,
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

// ---------------------------------------------------------------------------
// A soft radial sprite. Used for every glow in the game — cheaper than bloom
// by an order of magnitude and it survives on integrated mobile GPUs.
// A CanvasTexture MUST be told it is sRGB or it renders washed out.
// See [[threejs-canvas-textures-srgb]].
// ---------------------------------------------------------------------------
function glowTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Patches a standard material so each instance can flash its own emissive.
// instanceColor is DIFFUSE-only in three.js, so a hit flash done that way is
// invisible under a dark key light — see [[threejs-instancecolor-vs-emissive]].
function withInstanceFlash(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aFlash;\nvarying float vFlash;\n' +
      sh.vertexShader.replace('void main() {', 'void main() {\n\tvFlash = aFlash;');
    sh.fragmentShader = 'varying float vFlash;\n' +
      sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vec3(vFlash);');
  };
  return mat;
}

function flashAttr(geo, n) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFlash', a);
  return a;
}

// merge a list of [geometry, x,y,z, rx,ry,rz] into one buffer geometry
function assemble(parts) {
  const geos = [];
  for (const p of parts) {
    const g = p.g.clone();
    const mm = new THREE.Matrix4();
    const qq = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0));
    mm.compose(new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0), qq,
      new THREE.Vector3(p.sx || 1, p.sy || 1, p.sz || 1));
    g.applyMatrix4(mm);
    geos.push(g);
  }
  return mergeGeometries(geos);
}

// Minimal merge — avoids pulling in BufferGeometryUtils for four attributes.
function mergeGeometries(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) {
    vc += g.attributes.position.count;
    ic += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal;
    pos.set(p.array.subarray(0, p.count * 3), vo * 3);
    if (n) nrm.set(n.array.subarray(0, n.count * 3), vo * 3);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
      io += p.count;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ---------------------------------------------------------------------------
// Unit silhouettes. Each is one merged geometry, built once, drawn instanced.
// Hierarchy first: the four foes must be tellable apart as black shapes at
// twenty metres, so they differ in MASS and PROPORTION before they differ in
// colour. See [[character-silhouette-hierarchy]].
//
// Each also carries a WEAPON. A box stack with nothing in its hands reads as a
// placeholder however well it is lit; a held object is the cheapest thing that
// makes a shape read as a character.
// ---------------------------------------------------------------------------
function huskGeo() {
  return assemble([
    { g: box(0.78, 1.00, 0.50), y: 0.66 },                        // torso
    { g: box(0.86, 0.22, 0.58), y: 1.12 },                        // shoulders
    { g: box(0.44, 0.36, 0.42), y: 1.36 },                        // head
    { g: box(0.30, 0.10, 0.44), y: 1.30, z: 0.20 },               // jaw
    { g: box(0.20, 0.76, 0.20), x: 0.52, y: 0.66, rz: 0.20 },     // arms
    { g: box(0.20, 0.76, 0.20), x: -0.52, y: 0.66, rz: -0.20 },
    { g: box(0.26, 0.58, 0.26), x: 0.21, y: 0.15 },               // legs
    { g: box(0.26, 0.58, 0.26), x: -0.21, y: 0.15 },
    // a cleaver, held low in the right hand
    { g: box(0.10, 0.10, 0.62), x: 0.62, y: 0.34, z: 0.22, rx: 0.5 },
    { g: box(0.34, 0.06, 0.60), x: 0.62, y: 0.30, z: 0.62, rx: 0.5 },
  ]);
}

function runnerGeo() {
  return assemble([
    { g: box(0.54, 0.72, 0.40), y: 0.62, rx: 0.40 },              // hunched torso
    { g: box(0.62, 0.18, 0.34), y: 0.92, z: 0.10 },               // shoulders
    { g: box(0.34, 0.28, 0.42), y: 1.04, z: 0.26 },               // thrust head
    { g: box(0.14, 0.60, 0.14), x: 0.34, y: 0.56, rz: 0.55 },     // long arms
    { g: box(0.14, 0.60, 0.14), x: -0.34, y: 0.56, rz: -0.55 },
    { g: box(0.20, 0.52, 0.20), x: 0.16, y: 0.17, rx: -0.2 },     // sprinter legs
    { g: box(0.20, 0.52, 0.20), x: -0.16, y: 0.17, rx: 0.2 },
    // claws
    { g: box(0.07, 0.07, 0.34), x: 0.46, y: 0.26, z: 0.20, rx: 0.7 },
    { g: box(0.07, 0.07, 0.34), x: -0.46, y: 0.26, z: 0.20, rx: 0.7 },
  ]);
}

function wispGeo() {
  const g = [{ g: new THREE.IcosahedronGeometry(0.30, 0) }];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    g.push({ g: box(0.09, 0.09, 0.42), x: Math.cos(a) * 0.30, z: Math.sin(a) * 0.30, ry: -a });
  }
  // a second, tilted ring so it reads as a turning object, not a flat star
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    g.push({ g: box(0.07, 0.30, 0.07), x: Math.cos(a) * 0.24, y: 0.22, z: Math.sin(a) * 0.24, rz: 0.5 });
  }
  return assemble(g);
}

function breakerGeo() {
  return assemble([
    { g: box(1.80, 1.55, 1.25), y: 1.55 },                        // slab chest
    { g: box(2.15, 0.42, 1.40), y: 2.28 },                        // pauldron bar
    { g: box(0.75, 0.50, 0.75), x: 1.02, y: 2.52, rz: 0.2 },      // pauldrons
    { g: box(0.75, 0.50, 0.75), x: -1.02, y: 2.52, rz: -0.2 },
    { g: box(0.95, 0.60, 0.90), y: 2.62 },                        // sunken head
    { g: box(0.52, 1.55, 0.52), x: 1.18, y: 1.50, rz: 0.14 },     // long arms
    { g: box(0.52, 1.55, 0.52), x: -1.18, y: 1.50, rz: -0.14 },
    { g: box(0.92, 0.52, 0.92), x: 1.28, y: 0.56 },               // fists
    { g: box(0.92, 0.52, 0.92), x: -1.28, y: 0.56 },
    { g: box(0.58, 0.80, 0.58), x: 0.46, y: 0.40 },               // stumps
    { g: box(0.58, 0.80, 0.58), x: -0.46, y: 0.40 },
    // a maul, shouldered on the right — the reason it out-damages your hammer
    { g: box(0.24, 0.24, 2.10), x: 1.34, y: 1.15, z: 0.30, rx: 0.72 },
    { g: box(0.86, 0.80, 0.86), x: 1.34, y: 2.30, z: 1.10 },
  ]);
}

function playerGeo() {
  return assemble([
    { g: box(0.66, 0.84, 0.44), y: 1.04 },                        // cuirass
    { g: box(0.80, 0.20, 0.52), y: 1.40 },                        // shoulders
    { g: box(0.42, 0.38, 0.40), y: 1.66 },                        // helm
    { g: box(0.46, 0.14, 0.46), y: 1.84 },                        // helm ridge
    { g: box(0.12, 0.34, 0.12), y: 2.00 },                        // plume post
    { g: box(0.50, 0.62, 0.10), y: 1.10, z: -0.28 },              // cloak
    { g: box(0.46, 0.30, 0.10), y: 0.66, z: -0.32 },
    { g: box(0.19, 0.66, 0.19), x: 0.44, y: 1.04 },               // arms
    { g: box(0.19, 0.66, 0.19), x: -0.44, y: 1.04 },
    { g: box(0.24, 0.64, 0.24), x: 0.18, y: 0.32 },               // legs
    { g: box(0.24, 0.64, 0.24), x: -0.18, y: 0.32 },
    // the bow, carried across the body in the left hand
    { g: box(0.09, 1.30, 0.09), x: -0.52, y: 1.10, rz: 0.22 },
    { g: box(0.09, 0.30, 0.09), x: -0.62, y: 1.68, rz: 0.8 },
    { g: box(0.09, 0.30, 0.09), x: -0.42, y: 0.52, rz: -0.8 },
  ]);
}

const FOE_GEO = { husk: huskGeo, runner: runnerGeo, wisp: wispGeo, breaker: breakerGeo };
const FOE_CAP = { husk: 90, runner: 110, wisp: 40, breaker: 8 };

// ---------------------------------------------------------------------------
export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.low = !!opts.low;          // mobile / low-power path

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: !this.low, powerPreference: 'high-performance',
      alpha: false, stencil: false,
    });
    this.renderer.setClearColor(PAL.night, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = !this.low;
    if (!this.low) this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PAL.night);
    this.scene.fog = new THREE.Fog(PAL.fog, 46, 132);

    this.camera = new THREE.PerspectiveCamera(56, 1, 0.5, 260);
    this.camYaw = Math.PI;
    this.camDist = 19;
    this.camHeight = 21;      // ~48 deg. Lower than this and the far lane is
                              // edge-on and unreadable; higher and the player
                              // stops being a character and becomes a cursor.
    this.shake = 0;
    // How far past the player the camera aims. Without it the player sits in
    // the middle of frame with dead floor below and the lane you are walking
    // toward cropped off the top — worst on a tall portrait phone.
    this.lookAhead = 4;
    this._camPos = new THREE.Vector3(0, 20, 20);
    this._camLook = new THREE.Vector3();

    this.glowTex = glowTexture();
    this.t = 0;

    this._buildLights();
    this._buildArena();
    this._buildStone();
    this._buildUnits();
    this._buildPools();

    this.wardViews = new Map();   // world ward id -> Object3D
    this.laneFlash = new Map();   // lane id -> seconds remaining
  }

  // ------------------------------------------------------------------ lights
  _buildLights() {
    // Three-point lighting, not one. The earlier version leaned entirely on the
    // wardstone so the room could go dark as it died — but a scene lit from a
    // single point at floor level has no form: every box reads as a flat
    // silhouette, which is exactly why it stopped looking like 3D at all.
    //
    // The stone is still the HERO light and still dims with its health; there
    // is now enough fill and rim underneath that the dimming reads as the room
    // getting colder rather than the geometry disappearing.
    this.hemi = new THREE.HemisphereLight(0x8098c4, 0x3a2e22, 0.62);
    this.scene.add(this.hemi);

    // key — the wardstone itself
    this.key = new THREE.PointLight(PAL.stone, 340, 92, 1.7);
    this.key.position.set(0, 8.5, 0);
    if (!this.low) {
      this.key.castShadow = true;
      this.key.shadow.mapSize.set(1024, 1024);
      this.key.shadow.camera.near = 1;
      this.key.shadow.camera.far = 80;
      this.key.shadow.bias = -0.004;
    }
    this.scene.add(this.key);

    // fill — a high, soft, warm directional that models every surface the
    // point light rakes. This is the light that makes boxes look solid.
    this.fill = new THREE.DirectionalLight(0xffe6c4, 0.5);
    this.fill.position.set(28, 46, 20);
    this.scene.add(this.fill);

    // rim — cold, from behind, so silhouettes separate from the floor
    this.rim = new THREE.DirectionalLight(0x7fa8e8, 0.46);
    this.rim.position.set(-30, 26, -34);
    this.scene.add(this.rim);
  }

  // ------------------------------------------------------------------ arena
  _buildArena() {
    const H = ARENA.half;
    const rng = makeRng(90210);

    // --- base slab UNDER the flagstones, so the grout lines are a real recess
    // with real shading rather than a grid painted on a plane.
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2, H * 2),
      new THREE.MeshStandardMaterial({ color: PAL.floorInset, roughness: 1 }));
    base.rotation.x = -Math.PI / 2;
    base.receiveShadow = !this.low;
    this.scene.add(base);

    // apron past the walls so a camera near an edge never frames the void
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 4, H * 4),
      new THREE.MeshBasicMaterial({ color: 0x171320 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.08;
    this.scene.add(apron);

    // --- flagstones as actual raised slabs with height and colour jitter.
    // This is the single biggest change to whether the floor looks 3D: one
    // flat plane with lines drawn on it never will, however it is lit.
    const tiles = [];
    const T = 4, GAP = 0.34;
    for (let x = -H; x < H; x += T) {
      for (let z = -H; z < H; z += T) {
        const h = 0.16 + rng() * 0.08;
        tiles.push({ g: box(T - GAP, h, T - GAP), x: x + T / 2, y: h / 2, z: z + T / 2 });
      }
    }
    const floor = new THREE.Mesh(assemble(tiles), new THREE.MeshStandardMaterial({
      color: PAL.floor, roughness: 0.94, metalness: 0.02, flatShading: true,
    }));
    floor.receiveShadow = !this.low;
    this.scene.add(floor);

    // --- lanes, sitting on top of the flagstones
    this.laneStrips = {};
    for (const lane of LANES) {
      const parts = [];
      const step = 1.6;
      for (let d = 0; d < lane.total; d += step) {
        const a = laneAt(lane, d, 0), b = laneAt(lane, Math.min(lane.total, d + step), 0);
        parts.push({
          g: box(lane.width, 0.02, step * 1.08),
          x: (a.x + b.x) / 2, y: 0.26, z: (a.z + b.z) / 2,
          ry: Math.atan2(b.x - a.x, b.z - a.z),
        });
      }
      const mesh = new THREE.Mesh(assemble(parts), new THREE.MeshBasicMaterial({
        color: PAL.lane, transparent: true, opacity: 0.55,
      }));
      this.scene.add(mesh);
      this.laneStrips[lane.id] = mesh;

      const kerb = [];
      for (let side = -1; side <= 1; side += 2) {
        for (let d = 0; d < lane.total; d += step) {
          const a = laneAt(lane, d, side * (lane.width / 2));
          const b = laneAt(lane, Math.min(lane.total, d + step), side * (lane.width / 2));
          kerb.push({
            g: box(0.16, 0.09, step * 1.05),
            x: (a.x + b.x) / 2, y: 0.32, z: (a.z + b.z) / 2,
            ry: Math.atan2(b.x - a.x, b.z - a.z),
          });
        }
      }
      this.scene.add(new THREE.Mesh(assemble(kerb), new THREE.MeshStandardMaterial({
        color: 0x7d68b0, emissive: 0x4a3390, emissiveIntensity: 0.34,
        roughness: 0.6, flatShading: true,
      })));
    }

    // --- outer wall as an ARCADE: pilasters, recessed bays, a cornice.
    // A flat extruded box reads as a backdrop. A wall with rhythm and depth
    // reads as a room you are standing inside, which is most of the job.
    const wp = [], dk = [], trim = [];
    const t = 2.2, hh = 12;
    wp.push({ g: box(H * 2 + t * 2, hh, t), y: hh / 2, z: -H - t / 2 });
    wp.push({ g: box(H * 2 + t * 2, hh, t), y: hh / 2, z: H + t / 2 });
    wp.push({ g: box(t, hh, H * 2 + t * 2), y: hh / 2, x: -H - t / 2 });
    wp.push({ g: box(t, hh, H * 2 + t * 2), y: hh / 2, x: H + t / 2 });

    const SP = 9.5;
    for (let i = -H + SP / 2; i < H; i += SP) {
      const spots = [
        { x: i, z: -H + 0.9, ry: 0 },
        { x: i, z: H - 0.9, ry: 0 },
        { x: -H + 0.9, z: i, ry: Math.PI / 2 },
        { x: H - 0.9, z: i, ry: Math.PI / 2 },
      ];
      for (const sp of spots) {
        wp.push({ g: box(2.4, 1.0, 2.0), x: sp.x, y: 0.5, z: sp.z, ry: sp.ry });
        wp.push({ g: box(1.9, hh - 2.2, 1.6), x: sp.x, y: hh / 2, z: sp.z, ry: sp.ry });
        trim.push({ g: box(2.6, 0.7, 2.2), x: sp.x, y: hh - 1.1, z: sp.z, ry: sp.ry });
        const ox = sp.ry ? 0 : SP / 2;
        const oz = sp.ry ? SP / 2 : 0;
        dk.push({
          g: box(SP - 3.4, hh - 4.6, 0.7),
          x: sp.x + ox, y: (hh - 1.6) / 2, z: sp.z + oz, ry: sp.ry,
        });
      }
    }
    const wall = new THREE.Mesh(assemble(wp), new THREE.MeshStandardMaterial({
      color: PAL.wall, roughness: 0.92, metalness: 0.04, flatShading: true,
    }));
    wall.receiveShadow = !this.low;
    wall.castShadow = !this.low;
    this.scene.add(wall);

    this.scene.add(new THREE.Mesh(assemble(dk), new THREE.MeshStandardMaterial({
      color: PAL.wallDark, roughness: 1, flatShading: true,
    })));
    this.scene.add(new THREE.Mesh(assemble(trim), new THREE.MeshStandardMaterial({
      color: PAL.wallTop, roughness: 0.85, flatShading: true,
    })));

    const corn = [];
    const cy = hh - 1.9;
    corn.push({ g: box(H * 2 + t * 2, 0.6, 0.9), y: cy, z: -H + 0.55 });
    corn.push({ g: box(H * 2 + t * 2, 0.6, 0.9), y: cy, z: H - 0.55 });
    corn.push({ g: box(0.9, 0.6, H * 2 + t * 2), y: cy, x: -H + 0.55 });
    corn.push({ g: box(0.9, 0.6, H * 2 + t * 2), y: cy, x: H - 0.55 });
    this.scene.add(new THREE.Mesh(assemble(corn), new THREE.MeshStandardMaterial({
      color: PAL.wallTop, roughness: 0.8, flatShading: true,
    })));

    // --- wall sconces. Emissive bowls everywhere, but only a few real lights:
    // point lights are the expensive thing in this scene, not triangles.
    this.sconces = [];
    const sPos = [];
    for (let i = -H + SP; i < H - 2; i += SP * 2) {
      sPos.push([i, -H + 2.4], [i, H - 2.4], [-H + 2.4, i], [H - 2.4, i]);
    }
    const bowls = [];
    sPos.forEach((p, n) => {
      bowls.push({ g: new THREE.CylinderGeometry(0.52, 0.26, 0.62, 6), x: p[0], y: 5.3, z: p[1] });
      bowls.push({ g: box(0.3, 1.0, 0.3), x: p[0], y: 4.6, z: p[1] });
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: 0xff9c4a, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7,
      }));
      spr.position.set(p[0], 5.8, p[1]);
      spr.scale.set(4.4, 4.4, 1);
      this.scene.add(spr);
      const rec = { spr, seed: n * 1.7 };
      if (!this.low && n % 3 === 0) {
        const li = new THREE.PointLight(0xffa85a, 44, 27, 2);
        li.position.set(p[0], 5.8, p[1]);
        this.scene.add(li);
        rec.light = li;
      }
      this.sconces.push(rec);
    });
    this.scene.add(new THREE.Mesh(assemble(bowls), new THREE.MeshStandardMaterial({
      color: PAL.iron, roughness: 0.5, metalness: 0.7, flatShading: true,
    })));

    // --- broken columns standing in the room. Vertical objects AWAY from the
    // walls are what give a floor-level scene depth: things pass in front of
    // and behind them, which is the strongest 3D cue available.
    const cols = [];
    const colSpots = [];
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * Math.PI * 2 + 0.31;
      const r = 17 + ((a % 3) * 5);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (nearestLane(x, z).dist < 6.5) continue;   // never stand in a road
      colSpots.push([x, z, 3 + rng() * 5.5]);
    }
    for (const [x, z, ch] of colSpots) {
      cols.push({ g: box(2.6, 0.55, 2.6), x, y: 0.42, z });
      cols.push({ g: box(1.9, ch, 1.9), x, y: 0.6 + ch / 2, z });
      if (ch > 6) cols.push({ g: box(2.5, 0.5, 2.5), x, y: 0.6 + ch + 0.2, z });
    }
    if (cols.length) {
      const cm = new THREE.Mesh(assemble(cols), new THREE.MeshStandardMaterial({
        color: 0x5a5247, roughness: 0.95, flatShading: true,
      }));
      cm.castShadow = !this.low;
      cm.receiveShadow = !this.low;
      this.scene.add(cm);
    }

    // --- rubble. Set dressing is what stops a floor reading as a chessboard:
    // a scatter of broken blocks gives the eye something to scale the room by.
    const rub = [];
    for (let i = 0; i < 110; i++) {
      const a = rng() * Math.PI * 2, r = 8 + rng() * 27;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (nearestLane(x, z).dist < 5.2) continue;
      const sc = 0.4 + rng() * 1.2;
      rub.push({
        g: box(sc, sc * (0.4 + rng() * 0.8), sc * (0.6 + rng() * 0.8)),
        x, y: sc * 0.26, z, ry: rng() * Math.PI,
      });
    }
    if (rub.length) {
      const rm = new THREE.Mesh(assemble(rub), new THREE.MeshStandardMaterial({
        color: 0x504839, roughness: 1, flatShading: true,
      }));
      rm.castShadow = !this.low;
      rm.receiveShadow = !this.low;
      this.scene.add(rm);
    }

    // --- the three doors
    this.doorGlows = [];
    for (const lane of LANES) {
      const p = lane.points[0];
      const ang = Math.atan2(lane.segs[0].dx, lane.segs[0].dz);
      const arch = new THREE.Mesh(assemble([
        { g: box(lane.width + 3.4, 1.3, 2.2), y: 7.0 },
        { g: box(1.8, 7.2, 2.2), x: (lane.width + 1.8) / 2, y: 3.6 },
        { g: box(1.8, 7.2, 2.2), x: -(lane.width + 1.8) / 2, y: 3.6 },
        { g: box(lane.width + 4.8, 0.8, 2.6), y: 8.0 },
      ]), new THREE.MeshStandardMaterial({
        color: PAL.wallTop, roughness: 0.85, flatShading: true,
      }));
      arch.position.set(p[0], 0, p[1]);
      arch.rotation.y = ang;
      arch.castShadow = !this.low;
      this.scene.add(arch);

      const g = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: 0x8a4fd0, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5,
      }));
      g.position.set(p[0], 2.8, p[1]);
      g.scale.set(12, 12, 1);
      this.scene.add(g);

      const dl = new THREE.PointLight(0x8a4fd0, 48, 28, 2);
      dl.position.set(p[0] - lane.segs[0].dx * 2, 4.6, p[1] - lane.segs[0].dz * 2);
      this.scene.add(dl);
      this.doorGlows.push({ sprite: g, lane: lane.id, base: 0.5, light: dl });
    }
  }

  // -------------------------------------------------------------- wardstone
  _buildStone() {
    const grp = new THREE.Group();
    const R = STONE_DEF.radius;

    // A stepped octagonal dais, not a smooth dome. A high-segment cylinder
    // reads as a beige blob at this camera distance; eight sides, flat shaded,
    // with a visible riser per tier reads as cut stone.
    const steps = [];
    const tiers = [
      { r: R + 1.6, h: 0.40, y: 0.00 },
      { r: R + 0.9, h: 0.40, y: 0.40 },
      { r: R + 0.2, h: 0.40, y: 0.80 },
      { r: R - 0.6, h: 0.46, y: 1.20 },
    ];
    for (const t of tiers) {
      steps.push({ g: new THREE.CylinderGeometry(t.r, t.r, t.h, 8), y: t.y + t.h / 2 });
    }
    const dais = new THREE.Mesh(assemble(steps), new THREE.MeshStandardMaterial({
      color: 0x6e6559, roughness: 0.9, metalness: 0.06, flatShading: true,
    }));
    dais.receiveShadow = !this.low;
    dais.castShadow = !this.low;
    grp.add(dais);

    // Four corner obelisks. They give the centrepiece a silhouette and, more
    // usefully, something for the crystal's light to actually fall on — a lone
    // floating gem lights nothing and so looks pasted on.
    const posts = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const px = Math.cos(a) * (R + 0.6), pz = Math.sin(a) * (R + 0.6);
      posts.push({ g: box(0.85, 0.5, 0.85), x: px, y: 1.9, z: pz, ry: a });
      posts.push({ g: box(0.62, 2.5, 0.62), x: px, y: 3.15, z: pz, ry: a });
      posts.push({ g: box(0.9, 0.42, 0.9), x: px, y: 4.55, z: pz, ry: a });
    }
    const obelisks = new THREE.Mesh(assemble(posts), new THREE.MeshStandardMaterial({
      color: 0x565d70, roughness: 0.55, metalness: 0.45, flatShading: true,
    }));
    obelisks.castShadow = !this.low;
    grp.add(obelisks);

    // The stone itself: two counter-rotating shells so it reads as a solid
    // object turning in space rather than a flat lozenge.
    // See [[a-sphere-must-show-its-rotation]].
    this.crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.45, 0),
      new THREE.MeshStandardMaterial({
        color: PAL.stoneCore, emissive: PAL.stone, emissiveIntensity: 2.4,
        roughness: 0.22, metalness: 0.1, flatShading: true,
      }));
    this.crystal.position.y = 3.5;
    this.crystal.castShadow = !this.low;
    grp.add(this.crystal);

    this.crystalShell = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.15, 0),
      new THREE.MeshStandardMaterial({
        color: PAL.stone, emissive: PAL.stone, emissiveIntensity: 0.5,
        transparent: true, opacity: 0.16, roughness: 0.1,
        flatShading: true, side: THREE.DoubleSide, depthWrite: false,
      }));
    this.crystalShell.position.y = 3.5;
    grp.add(this.crystalShell);

    this.stoneGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: PAL.stone, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9,
    }));
    this.stoneGlow.position.y = 3.5;
    this.stoneGlow.scale.set(13, 13, 1);
    grp.add(this.stoneGlow);

    this.scene.add(grp);
    this.stoneGrp = grp;
  }

  // ------------------------------------------------------------------ units
  _buildUnits() {
    this.foeMeshes = {};
    for (const def of FOES) {
      const geo = FOE_GEO[def.id]();
      const n = FOE_CAP[def.id];
      const isWisp = def.id === 'wisp';
      const mat = withInstanceFlash(new THREE.MeshStandardMaterial({
        color: PAL[def.id],
        roughness: isWisp ? 0.3 : 0.85,
        metalness: isWisp ? 0.0 : 0.12,
        emissive: isWisp ? 0x1aa8d8 : 0x000000,
        emissiveIntensity: isWisp ? 0.8 : 0,
      }));
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = !this.low && !isWisp;
      mesh.count = 0;
      const flash = flashAttr(geo, n);
      this.foeMeshes[def.id] = { mesh, flash, cap: n };
      this.scene.add(mesh);
    }

    // wisp glows, drawn as one additive instanced quad set
    // Smaller and dimmer than it wants to be: additive quads STACK, so a flock
    // of six wisps at 3.4m/full brightness summed to a solid white blob with no
    // readable shapes in it. Size and opacity are both pulled back so a cluster
    // reads as several lights rather than one cloud.
    this.wispGlow = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(2.1, 2.1),
      new THREE.MeshBasicMaterial({
        map: this.glowTex, color: 0x2fc8ff, transparent: true, opacity: 0.38,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }), FOE_CAP.wisp);
    this.wispGlow.frustumCulled = false;
    this.wispGlow.count = 0;
    this.scene.add(this.wispGlow);

    this.player = new THREE.Mesh(playerGeo(), new THREE.MeshStandardMaterial({
      color: PAL.player, roughness: 0.6, metalness: 0.35,
      emissive: 0x2a3550, emissiveIntensity: 0.4,
    }));
    this.player.castShadow = !this.low;
    this.scene.add(this.player);

    // the lantern you carry — a second, small, moving light source
    this.lantern = new THREE.PointLight(0xffd9a0, 26, 17, 2);
    this.lantern.position.set(0, 1.7, 0);
    this.scene.add(this.lantern);
    this.lanternGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: 0xffd9a0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5,
    }));
    this.lanternGlow.scale.set(5, 5, 1);
    this.scene.add(this.lanternGlow);
  }

  // ------------------------------------------------------------------ pools
  _buildPools() {
    // projectiles
    this.projMesh = new THREE.InstancedMesh(
      box(0.16, 0.16, 0.9),
      new THREE.MeshBasicMaterial({ color: 0xffe0a8 }), 160);
    this.projMesh.frustumCulled = false;
    this.projMesh.count = 0;
    this.scene.add(this.projMesh);

    // mana motes
    this.moteMesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.3, 0),
      new THREE.MeshStandardMaterial({
        color: 0x9fe8ff, emissive: 0x39b6e0, emissiveIntensity: 2.2, roughness: 0.3,
      }), 200);
    this.moteMesh.frustumCulled = false;
    this.moteMesh.count = 0;
    this.scene.add(this.moteMesh);

    // particles — one pool for every spark, puff and ring in the game
    this.PN = this.low ? 220 : 420;
    this.parts = [];
    for (let i = 0; i < this.PN; i++) {
      this.parts.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1, c: 0xffffff, g: -9 });
    }
    this.partMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, vertexColors: true,
      }), this.PN);
    this.partMesh.frustumCulled = false;
    this.partMesh.count = 0;
    this.partMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.PN * 3), 3);
    this.scene.add(this.partMesh);
    this._pn = 0;

    // build ghost
    this.ghost = new THREE.Mesh(box(CELL * 0.92, 0.3, CELL * 0.92),
      new THREE.MeshBasicMaterial({
        color: 0x7fe08a, transparent: true, opacity: 0.42, depthWrite: false,
      }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.ghostPost = new THREE.Mesh(box(0.3, 2.2, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x7fe08a, transparent: true, opacity: 0.3, depthWrite: false }));
    this.ghostPost.visible = false;
    this.scene.add(this.ghostPost);

    // Threat rings — one per breaker, pulsing on the floor. A breaker is the
    // only foe worth abandoning a lane for, and at this camera distance a dark
    // red mass in a dark room is not enough notice.
    this.threatRings = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.72, 1, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0xff5a48, transparent: true, opacity: 0.6,
          side: THREE.DoubleSide, depthWrite: false,
        }));
      m.visible = false;
      m.renderOrder = 2;
      this.scene.add(m);
      this.threatRings.push(m);
    }

    // ward range ring, shown while placing
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x7fe08a, transparent: true, opacity: 0.35,
        side: THREE.DoubleSide, depthWrite: false,
      }));
    this.ring.visible = false;
    this.scene.add(this.ring);
  }

  // ------------------------------------------------------------------- FX
  spark(x, y, z, color, n, speed, size, gravity) {
    for (let i = 0; i < n; i++) {
      const p = this.parts[this._pn];
      this._pn = (this._pn + 1) % this.PN;
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.5;
      const sp = speed * (0.45 + Math.random() * 0.9);
      p.x = x; p.y = y; p.z = z;
      p.vx = Math.cos(a) * Math.cos(e) * sp;
      p.vy = Math.sin(e) * sp;
      p.vz = Math.sin(a) * Math.cos(e) * sp;
      p.life = p.max = 0.35 + Math.random() * 0.45;
      p.s = size * (0.6 + Math.random() * 0.8);
      p.c = color;
      p.g = gravity == null ? -11 : gravity;
    }
  }

  ringBurst(x, y, z, color, radius, n) {
    for (let i = 0; i < n; i++) {
      const p = this.parts[this._pn];
      this._pn = (this._pn + 1) % this.PN;
      const a = (i / n) * Math.PI * 2;
      p.x = x; p.y = y; p.z = z;
      p.vx = Math.cos(a) * radius * 1.6;
      p.vy = 0.7;
      p.vz = Math.sin(a) * radius * 1.6;
      p.life = p.max = 0.5;
      p.s = 1.5; p.c = color; p.g = -1.5;
    }
  }

  addShake(v) { this.shake = Math.min(1.5, this.shake + v); }

  // --------------------------------------------------------------- wards
  _wardMesh(def) {
    const iron = new THREE.MeshStandardMaterial({ color: PAL.iron, roughness: 0.55, metalness: 0.6 });
    const timber = new THREE.MeshStandardMaterial({ color: PAL.timber, roughness: 0.9 });
    const g = new THREE.Group();

    if (def.id === 'palisade') {
      const parts = [];
      for (let i = -1; i <= 1; i++) {
        parts.push({ g: box(0.5, 2.3 + (i === 0 ? 0.3 : 0), 0.5), x: i * 0.6, y: 1.15, rz: i * 0.045 });
      }
      parts.push({ g: box(1.9, 0.22, 0.28), y: 1.75, z: 0.2 });
      parts.push({ g: box(1.9, 0.22, 0.28), y: 0.85, z: 0.2 });
      const m = new THREE.Mesh(assemble(parts), timber);
      m.castShadow = !this.low;
      g.add(m);
    } else if (def.id === 'ballista') {
      const base = new THREE.Mesh(assemble([
        { g: box(1.5, 0.4, 1.5), y: 0.2 },
        { g: box(0.5, 0.7, 0.5), y: 0.6 },
      ]), timber);
      base.castShadow = !this.low;
      g.add(base);
      const head = new THREE.Mesh(assemble([
        { g: box(0.34, 0.34, 1.9), y: 0 },
        { g: box(2.3, 0.2, 0.2), y: 0.12, z: 0.2 },
        { g: box(0.2, 0.5, 0.5), y: 0.1, z: -0.75 },
      ]), iron);
      head.position.y = 1.15;
      head.castShadow = !this.low;
      g.add(head);
      g.userData.head = head;
    } else if (def.id === 'brazier') {
      const bowl = new THREE.Mesh(assemble([
        { g: new THREE.CylinderGeometry(0.16, 0.28, 1.3, 6), y: 0.65 },
        { g: new THREE.CylinderGeometry(0.72, 0.36, 0.55, 8), y: 1.55 },
      ]), iron);
      bowl.castShadow = !this.low;
      g.add(bowl);
      const fire = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: PAL.ember, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.95,
      }));
      fire.position.y = 1.95;
      fire.scale.set(3.4, 3.4, 1);
      g.add(fire);
      const li = new THREE.PointLight(PAL.ember, 34, 15, 2);
      li.position.y = 2.0;
      g.add(li);
      g.userData.fire = fire;
      g.userData.light = li;
    } else if (def.id === 'snare') {
      const plate = new THREE.Mesh(assemble([
        { g: new THREE.CylinderGeometry(0.9, 0.9, 0.16, 8), y: 0.08 },
        { g: new THREE.TorusGeometry(0.78, 0.09, 6, 12).rotateX(Math.PI / 2), y: 0.2 },
      ]), new THREE.MeshStandardMaterial({
        color: 0x3b3550, roughness: 0.7, metalness: 0.4,
        emissive: PAL.snare, emissiveIntensity: 0.9,
      }));
      g.add(plate);
      g.userData.plate = plate;
    }
    return g;
  }

  syncWards(world) {
    const seen = new Set();
    for (const w of world.wards) {
      if (w.dead) continue;
      seen.add(w.id);
      let v = this.wardViews.get(w.id);
      if (!v) {
        v = this._wardMesh(w.def);
        v.position.set(w.x, 0, w.z);
        this.scene.add(v);
        this.wardViews.set(w.id, v);
        this.spark(w.x, 0.6, w.z, 0x7fe08a, 14, 5, 1.1);
      }
      // damage reads as a lean and a sink, not a floating bar
      const f = w.hp / w.maxHp;
      v.scale.y = 0.55 + 0.45 * f;
      v.rotation.z = (1 - f) * 0.14;
      const head = v.userData.head;
      if (head && w.target && !w.target.dead) {
        head.rotation.y = Math.atan2(w.target.x - w.x, w.target.z - w.z);
        const d = Math.hypot(w.target.x - w.x, w.target.z - w.z) || 1;
        head.rotation.x = -Math.atan2((w.target.y + 0.8) - 1.15, d);
      }
      const fire = v.userData.fire;
      if (fire) {
        const fl = 3.1 + Math.sin(this.t * 11 + w.id) * 0.35 + Math.random() * 0.16;
        fire.scale.set(fl, fl, 1);
        v.userData.light.intensity = 30 + Math.sin(this.t * 9 + w.id) * 6;
      }
      const plate = v.userData.plate;
      if (plate) {
        const ready = w.cd <= 0;
        plate.material.emissiveIntensity = ready
          ? 0.85 + Math.sin(this.t * 4) * 0.3 : 0.08;
      }
    }
    for (const [id, v] of this.wardViews) {
      if (seen.has(id)) continue;
      this.scene.remove(v);
      this.wardViews.delete(id);
    }
  }

  // ------------------------------------------------------------------ frame
  update(world, dt, input) {
    this.t += dt;
    const p = world.player;

    // --- camera: chase, high, smoothed. Yaw is the player's to steer.
    let tx = p.x - Math.sin(this.camYaw) * this.camDist;
    let tz = p.z - Math.cos(this.camYaw) * this.camDist;
    const lim = ARENA.half - 2.5;
    tx = Math.max(-lim, Math.min(lim, tx));
    tz = Math.max(-lim, Math.min(lim, tz));
    const k = 1 - Math.pow(0.0016, dt);
    this._camPos.x += (tx - this._camPos.x) * k;
    this._camPos.z += (tz - this._camPos.z) * k;
    this._camPos.y += (this.camHeight - this._camPos.y) * k;
    const la = this.lookAhead;
    const lx = p.x + Math.sin(this.camYaw) * la;
    const lz = p.z + Math.cos(this.camYaw) * la;
    this._camLook.x += (lx - this._camLook.x) * k;
    this._camLook.z += (lz - this._camLook.z) * k;
    this._camLook.y = 1.2;

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.6);
      const s = this.shake * this.shake * 0.9;
      this.camera.position.set(
        this._camPos.x + (Math.random() - 0.5) * s,
        this._camPos.y + (Math.random() - 0.5) * s,
        this._camPos.z + (Math.random() - 0.5) * s);
    } else {
      this.camera.position.copy(this._camPos);
    }
    this.camera.lookAt(this._camLook);

    // --- the stone is the health bar. Its light dims as it is worn down.
    const sf = Math.max(0, world.stone.hp / world.stone.maxHp);
    const pulse = 1 + Math.sin(this.t * 2.2) * 0.06;
    this.key.intensity = (95 + 250 * sf) * pulse;
    // floor is 0.62 so the room stays readable even at zero stone health
    this.hemi.intensity = 0.34 + 0.34 * sf;
    this.crystal.material.emissiveIntensity = (0.7 + 2.2 * sf) * pulse;
    this.crystal.rotation.y += dt * 0.5;
    this.crystal.rotation.x = Math.sin(this.t * 0.7) * 0.12;
    this.crystal.position.y = 3.5 + Math.sin(this.t * 1.4) * 0.16;
    if (this.crystalShell) {
      this.crystalShell.position.y = this.crystal.position.y;
      this.crystalShell.rotation.y -= dt * 0.34;
      this.crystalShell.rotation.z += dt * 0.16;
      this.crystalShell.material.opacity = 0.06 + 0.16 * sf;
    }
    this.stoneGlow.material.opacity = (0.20 + 0.40 * sf) * pulse;
    const gs = 8 + 6 * sf;
    this.stoneGlow.scale.set(gs, gs, 1);
    // as it dies the light goes cold
    _c.setHex(PAL.stone).lerp(new THREE.Color(0x4466aa), 1 - sf);
    this.key.color.copy(_c);
    this.crystal.material.emissive.copy(_c);

    // --- player
    if (p.alive) {
      this.player.visible = true;
      this.player.position.set(p.x, 0, p.z);
      this.player.rotation.y = p.yaw;
      const bob = Math.sin(this.t * 12) * 0.5;
      const moving = input && input.moving;
      this.player.position.y = moving ? Math.abs(bob) * 0.09 : 0;
      this.player.material.emissiveIntensity = p.hurtT > 0 ? 2.4 : 0.4;
      this.lantern.position.set(p.x + Math.sin(p.yaw + 1.2) * 0.6, 1.55,
        p.z + Math.cos(p.yaw + 1.2) * 0.6);
      this.lanternGlow.position.copy(this.lantern.position);
      this.lantern.intensity = 24 + Math.sin(this.t * 7) * 3;
    } else {
      this.player.visible = false;
      this.lantern.intensity = 0;
      this.lanternGlow.position.set(0, -50, 0);
    }

    // --- foes
    const counts = { husk: 0, runner: 0, wisp: 0, breaker: 0 };
    let wg = 0;
    for (const f of world.foes) {
      if (f.dead) continue;
      const slot = this.foeMeshes[f.kind];
      const i = counts[f.kind];
      if (i >= slot.cap) continue;
      counts[f.kind] = i + 1;

      const ang = Math.atan2(f.x - (f.px == null ? f.x - 0.01 : f.px),
        f.z - (f.pz == null ? f.z - 0.01 : f.pz));
      f.px = f.x; f.pz = f.z;

      let y = f.y;
      let lean = 0, sc = 1;
      if (f.def.flying) {
        y = f.y + Math.sin(this.t * 3.4 + f.id) * 0.28;
      } else {
        // a walk cycle without a skeleton: bob and lean by phase
        const ph = this.t * f.def.speed * 2.4 + f.id;
        const walking = f.targetKind == null;
        if (walking) {
          y += Math.abs(Math.sin(ph)) * 0.1;
          lean = Math.sin(ph) * 0.08;
        } else {
          // a strike is a lunge, so an attack is visible from across the room
          const sw = Math.max(0, Math.sin((f.def.attackCd - f.atkCd) * 9));
          lean = -sw * 0.5;
          sc = 1 + sw * 0.06;
        }
      }
      _q.setFromEuler(new THREE.Euler(lean, ang, 0));
      _s.set(sc, sc, sc);
      _m.compose(_v.set(f.x, y, f.z), _q, _s);
      slot.mesh.setMatrixAt(i, _m);
      // capped well below 1: a full-white flash erases the silhouette colour
      slot.flash.array[i] = f.hitT > 0 ? Math.min(0.55, f.hitT * 5.5) : 0;

      if (f.def.flying && wg < FOE_CAP.wisp) {
        _q.copy(this.camera.quaternion);
        _m.compose(_v.set(f.x, y + 0.3, f.z), _q, _s.set(1, 1, 1));
        this.wispGlow.setMatrixAt(wg++, _m);
      }
    }
    for (const id in this.foeMeshes) {
      const slot = this.foeMeshes[id];
      slot.mesh.count = counts[id];
      slot.mesh.instanceMatrix.needsUpdate = true;
      slot.flash.needsUpdate = true;
    }
    this.wispGlow.count = wg;
    this.wispGlow.instanceMatrix.needsUpdate = true;

    // threat rings follow live breakers; the pulse rate rises as one closes on
    // the stone, so urgency is readable without reading a number
    let tr = 0;
    for (const f of world.foes) {
      if (f.dead || f.kind !== 'breaker' || tr >= this.threatRings.length) continue;
      const m = this.threatRings[tr++];
      const near = 1 - Math.min(1, Math.hypot(f.x, f.z) / 40);
      const rate = 3 + near * 7;
      const sc = 2.6 + Math.sin(this.t * rate) * 0.45;
      m.visible = true;
      m.position.set(f.x, 0.06, f.z);
      m.scale.set(sc, 1, sc);
      m.material.opacity = 0.32 + 0.34 * (0.5 + 0.5 * Math.sin(this.t * rate));
    }
    for (let i = tr; i < this.threatRings.length; i++) this.threatRings[i].visible = false;

    // --- projectiles
    let pi = 0;
    for (const b of world.projectiles) {
      if (b.dead || pi >= 160) continue;
      _v.set(b.dx, b.dy, b.dz);
      _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _v.normalize());
      _m.compose(_v.set(b.x, b.y, b.z), _q, _s.set(1, 1, b.source === 'player' ? 1.4 : 1));
      this.projMesh.setMatrixAt(pi++, _m);
    }
    this.projMesh.count = pi;
    this.projMesh.instanceMatrix.needsUpdate = true;

    // --- motes
    let mi = 0;
    for (const m of world.motes) {
      if (m.taken || m.life <= 0 || mi >= 200) continue;
      const y = (m.y || 0.6) + Math.sin(this.t * 3 + m.id) * 0.16;
      _q.setFromEuler(new THREE.Euler(this.t * 1.6 + m.id, this.t * 2.2, 0));
      // about to expire: shrink, so a dying mote is a visible loss
      const near = m.life < 4 ? 0.5 + 0.5 * Math.sin(this.t * 14) : 1;
      _m.compose(_v.set(m.x, y, m.z), _q, _s.set(near, near, near));
      this.moteMesh.setMatrixAt(mi++, _m);
    }
    this.moteMesh.count = mi;
    this.moteMesh.instanceMatrix.needsUpdate = true;

    // --- particles
    let qi = 0;
    for (const q of this.parts) {
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) continue;
      q.vy += q.g * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.05) { q.y = 0.05; q.vy *= -0.32; q.vx *= 0.7; q.vz *= 0.7; }
      const a = q.life / q.max;
      const sz = q.s * (0.35 + a * 0.9);
      _q.copy(this.camera.quaternion);
      _m.compose(_v.set(q.x, q.y, q.z), _q, _s.set(sz, sz, 1));
      this.partMesh.setMatrixAt(qi, _m);
      _c.setHex(q.c).multiplyScalar(a);
      this.partMesh.instanceColor.array[qi * 3] = _c.r;
      this.partMesh.instanceColor.array[qi * 3 + 1] = _c.g;
      this.partMesh.instanceColor.array[qi * 3 + 2] = _c.b;
      qi++;
    }
    this.partMesh.count = qi;
    this.partMesh.instanceMatrix.needsUpdate = true;
    this.partMesh.instanceColor.needsUpdate = true;

    // --- doors pulse while their lane is live
    for (const d of this.doorGlows) {
      const f = this.laneFlash.get(d.lane) || 0;
      if (f > 0) this.laneFlash.set(d.lane, f - dt);
      const puls = Math.sin(this.t * 2 + d.lane.length) * 0.06;
      d.sprite.material.opacity = d.base + Math.max(0, f) * 0.9 + puls;
      if (d.light) d.light.intensity = 42 + Math.max(0, f) * 70 + puls * 40;
    }

    this.syncWards(world);
    this.renderer.render(this.scene, this.camera);
  }

  // --------------------------------------------------------------- ghost
  showGhost(wardId, i, j, ok) {
    const c = cellCenter(i, j);
    const def = WARD_BY_ID[wardId];
    const col = ok ? 0x7fe08a : 0xe0605a;
    this.ghost.visible = true;
    this.ghost.position.set(c.x, 0.16, c.z);
    this.ghost.material.color.setHex(col);
    this.ghostPost.visible = true;
    this.ghostPost.position.set(c.x, 1.1, c.z);
    this.ghostPost.material.color.setHex(col);
    if (def.range) {
      this.ring.visible = true;
      this.ring.position.set(c.x, 0.1, c.z);
      this.ring.scale.set(def.range, 1, def.range);
      this.ring.material.color.setHex(col);
    } else {
      this.ring.visible = false;
    }
  }
  hideGhost() {
    this.ghost.visible = false;
    this.ghostPost.visible = false;
    this.ring.visible = false;
  }

  resize(w, h, dpr) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
