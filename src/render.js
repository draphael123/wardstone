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
import {
  FOES, FOE_BY_ID, WARDS, WARD_BY_ID, WARDSTONE as STONE_DEF, PLAYER, ECON,
} from './defs.js';
import {
  LANES, ARENA, CELL, cellOf, cellCenter, laneAt, nearestLane, isBuildableCell,
  currentMap, groundY,
} from './arena.js';
import { makeRng } from './rand.js';
import { AGGRO } from './defs.js';
const WINDUP = AGGRO.windup;
// Display-only crowd fan-out: bucket size, and how far a packed bucket spreads.
const CROWD_CELL = 0.55;
const CROWD_FAN = 0.44;

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
  caltrops:    0xa579ff,
  player:   0x9aa8bd,
  cloak:    0x9a2f3a,
  husk:     0xa8ae9c,
  runner:   0x8fbf6a,
  wisp:     0x63e6ff,
  breaker:  0xa33f36,

  // forest theme
  duskSky:  0x1d2438,
  grass:    0x4e6b38,
  grassDark:0x3b5230,
  dirt:     0x51422f,
  bark:     0x3d3227,
  leaf:     0x37552f,
  bush:     0x44663a,
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
// Also carries the WALK. These bodies are instanced, so limbs cannot be
// separate meshes — the gait is done by displacing vertices in OBJECT space
// before the instance matrix: everything low on the body swings fore and aft
// by a per-instance phase, arms counter-swing, the body bobs. One attribute,
// no extra draw calls, and it is the whole difference between a crowd that
// walks and a crowd that slides.
// The gait displacement, as a string, because two materials need to apply it
// identically: the body, and the back-faced hull drawn behind it. An outline
// that does not walk with the legs peels off them.
const WALK_CHUNK = [
  // --- the walk
  'float legMask = 1.0 - smoothstep(0.10, 0.85, position.y);',
  'float sideSign = position.x < 0.0 ? 3.14159265 : 0.0;',
  'float sw = sin(aPhase + sideSign);',
  'transformed.z += sw * 0.36 * legMask;',
  'float armMask = smoothstep(0.55, 1.05, position.y) * step(0.32, abs(position.x));',
  'transformed.y += abs(sin(aPhase)) * 0.055 * step(0.2, position.y);',
  // --- the weapon arm.
  // Everything on the +x side is the weapon side: the arm AND whatever it is
  // holding. That distinction is the whole fix. The walk mask only moves
  // geometry above y=0.55, and a goblin carries its blade at about y=0.32 — so
  // the weapon never moved at all and every attack read as the body bobbing.
  // Reported twice. A SIDE mask takes the weapon with the arm by construction.
  'float wpnSide = step(0.32, position.x);',
  'float swinging = step(0.001, aSwing);',
  'float armSwing = armMask * (1.0 - swinging * wpnSide);',
  'transformed.z -= sw * 0.30 * armSwing;',
  // Windup rocks back slowly; the strike drives forward fast. The asymmetry is
  // the point — the slow half is the half you get to react to.
  'float k = aSwing;',
  'float ang = k < 0.45',
  '  ? -2.0 * (k / 0.45)',
  '  : mix(-2.0, 1.9, pow((k - 0.45) / 0.55, 0.55));',
  'ang *= swinging * wpnSide;',
  // rotate about the shoulder in the YZ plane: an overhead chop
  'vec3 piv = vec3(0.0, 1.02, 0.0);',
  'vec3 rel = transformed - piv;',
  'float ca = cos(ang), sa = sin(ang);',
  'transformed = piv + vec3(rel.x, rel.y * ca - rel.z * sa, rel.y * sa + rel.z * ca);',
  // and the body leans in behind it, so the blow has weight
  'transformed.z += swinging * sin(k * 3.14159265) * 0.10 * step(0.2, position.y);',
].join('\n');

// A back-faced hull pushed out along the normals. This is the single biggest
// thing separating "stylised 3D character" from "box": without a dark edge, a
// dark figure on dark ground has no boundary at all and the eye reads mass
// rather than shape.
function outlineMat(width) {
  const m = new THREE.MeshBasicMaterial({
    color: 0x0b0e14, side: THREE.BackSide, fog: true,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aPhase;\nattribute float aSwing;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        WALK_CHUNK,
        'transformed += normalize(normal) * ' + width.toFixed(3) + ';',
      ].join('\n'));
  };
  return m;
}

function withInstanceFlash(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader =
      'attribute float aFlash;\nattribute float aPhase;\nattribute float aSwing;\nattribute float emis;\n' +
      'varying float vFlash;\nvarying float vEmis;\n' +
      sh.vertexShader
        .replace('void main() {', 'void main() {\n\tvFlash = aFlash;\n\tvEmis = emis;')
        // the SAME chunk the outline hull uses, so the two never drift apart
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n' + WALK_CHUNK);
    sh.fragmentShader = 'varying float vFlash;\nvarying float vEmis;\n' +
      sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' +
        '\ttotalEmissiveRadiance += vec3(vFlash);\n' +
        '\ttotalEmissiveRadiance += diffuseColor.rgb * vEmis * 2.6;');
  };
  return mat;
}

function flashAttr(geo, n) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFlash', a);
  return a;
}

// Merge a list of placed boxes into one geometry. A part may carry `c`, a hex
// colour, which becomes a VERTEX COLOUR — that is what lets a single instanced
// mesh with one material have skin, cloth, iron and EYES on it. Without it
// every unit is one flat colour and reads as a mannequin.
function assemble(parts) {
  const geos = [];
  let anyColor = false;
  for (const p of parts) {
    const g = p.g.clone();
    const mm = new THREE.Matrix4();
    const qq = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0));
    mm.compose(new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0), qq,
      new THREE.Vector3(p.sx || 1, p.sy || 1, p.sz || 1));
    g.applyMatrix4(mm);
    if (p.c != null) {
      anyColor = true;
      const ne = g.attributes.position.count;
      const ea = new Float32Array(ne).fill(p.e || 0);
      g.setAttribute('emis', new THREE.BufferAttribute(ea, 1));
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      _c.setHex(p.c).convertSRGBToLinear();
      for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    geos.push(g);
  }
  // every part needs the attribute if any part has it, or the merge misaligns
  if (anyColor) {
    for (const g of geos) {
      if (g.attributes.color) continue;
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3).fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.setAttribute('emis', new THREE.BufferAttribute(new Float32Array(n), 1));
    }
  }
  return mergeGeometries(geos, anyColor);
}

// Minimal merge — avoids pulling in BufferGeometryUtils for four attributes.
function mergeGeometries(geos, withColor) {
  let vc = 0, ic = 0;
  for (const g of geos) {
    vc += g.attributes.position.count;
    ic += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vc * 3);
  const nrm = new Float32Array(vc * 3);
  const col = withColor ? new Float32Array(vc * 3) : null;
  const emi = withColor ? new Float32Array(vc) : null;
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
    const em = g.attributes.emis;
    pos.set(p.array.subarray(0, p.count * 3), vo * 3);
    if (n) nrm.set(n.array.subarray(0, n.count * 3), vo * 3);
    if (col && c) col.set(c.array.subarray(0, c.count * 3), vo * 3);
    if (emi && em) emi.set(em.array.subarray(0, em.count), vo);
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
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (emi) out.setAttribute('emis', new THREE.BufferAttribute(emi, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ---------------------------------------------------------------------------
// Unit silhouettes. One merged geometry each, drawn instanced.
//
// Hierarchy first: the four foes must be tellable apart as black shapes at
// twenty metres, so they differ in MASS and PROPORTION before they differ in
// colour. See [[character-silhouette-hierarchy]].
//
// Every part may carry `c` (a colour) and `e` (emissive strength), which is
// how a single instanced mesh with one material gets skin, cloth, iron and
// GLOWING EYES. A body in one flat colour reads as a mannequin however good
// its proportions are; two lit eyes turn the same box stack into a creature.
// ---------------------------------------------------------------------------
const EYE = (x, y, z, s, col) =>
  ({ g: box(s, s * 0.8, s * 0.5), x, y, z, c: col, e: 1 });

function huskGeo() {
  const bone = 0xb0b5a2, dark = 0x8d9280, iron = 0x8a8f9c;
  return assemble([
    { g: box(0.78, 1.00, 0.50), y: 0.66, c: bone },
    { g: box(0.86, 0.22, 0.58), y: 1.12, c: dark },
    { g: box(0.44, 0.36, 0.42), y: 1.36, c: bone },
    { g: box(0.30, 0.10, 0.44), y: 1.28, z: 0.20, c: 0xe8e2cc },   // jaw
    EYE(0.11, 1.40, 0.22, 0.10, 0x9fe8ff),
    EYE(-0.11, 1.40, 0.22, 0.10, 0x9fe8ff),
    { g: box(0.20, 0.76, 0.20), x: 0.52, y: 0.66, rz: 0.20, c: dark },
    { g: box(0.20, 0.76, 0.20), x: -0.52, y: 0.66, rz: -0.20, c: dark },
    { g: box(0.26, 0.58, 0.26), x: 0.21, y: 0.15, c: dark },
    { g: box(0.26, 0.58, 0.26), x: -0.21, y: 0.15, c: dark },
    { g: box(0.10, 0.10, 0.62), x: 0.62, y: 0.34, z: 0.22, rx: 0.5, c: 0x5a4634 },
    { g: box(0.34, 0.06, 0.60), x: 0.62, y: 0.30, z: 0.62, rx: 0.5, c: iron },
  ]);
}

function runnerGeo() {
  const skin = 0x8fbf6a, dark = 0x74a252;
  return assemble([
    { g: box(0.54, 0.72, 0.40), y: 0.62, rx: 0.40, c: skin },
    { g: box(0.62, 0.18, 0.34), y: 0.92, z: 0.10, c: dark },
    { g: box(0.34, 0.28, 0.42), y: 1.04, z: 0.26, c: skin },
    EYE(0.09, 1.08, 0.46, 0.09, 0xffdd44),
    EYE(-0.09, 1.08, 0.46, 0.09, 0xffdd44),
    { g: box(0.14, 0.60, 0.14), x: 0.34, y: 0.56, rz: 0.55, c: dark },
    { g: box(0.14, 0.60, 0.14), x: -0.34, y: 0.56, rz: -0.55, c: dark },
    { g: box(0.20, 0.52, 0.20), x: 0.16, y: 0.17, rx: -0.2, c: dark },
    { g: box(0.20, 0.52, 0.20), x: -0.16, y: 0.17, rx: 0.2, c: dark },
    { g: box(0.07, 0.07, 0.34), x: 0.46, y: 0.26, z: 0.20, rx: 0.7, c: 0xc8d2e2 },
    { g: box(0.07, 0.07, 0.34), x: -0.46, y: 0.26, z: 0.20, rx: 0.7, c: 0xc8d2e2 },
  ]);
}

function wispGeo() {
  const g = [{ g: new THREE.IcosahedronGeometry(0.30, 0), c: 0xa8f2ff, e: 0.9 }];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    g.push({ g: box(0.09, 0.09, 0.42), x: Math.cos(a) * 0.30, z: Math.sin(a) * 0.30,
             ry: -a, c: 0x63e6ff, e: 0.7 });
  }
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    g.push({ g: box(0.07, 0.30, 0.07), x: Math.cos(a) * 0.24, y: 0.22,
             z: Math.sin(a) * 0.24, rz: 0.5, c: 0x63e6ff, e: 0.6 });
  }
  // a dim core so it is not uniformly bright
  g.push({ g: box(0.16, 0.16, 0.16), y: 0.02, c: 0x1a5a70, e: 0 });
  return assemble(g);
}

function breakerGeo() {
  const hide = 0xa33f36, dark = 0x7c2f28, iron = 0x6a6f7d;
  return assemble([
    { g: box(1.80, 1.55, 1.25), y: 1.55, c: hide },
    { g: box(2.15, 0.42, 1.40), y: 2.28, c: dark },
    { g: box(0.75, 0.50, 0.75), x: 1.02, y: 2.52, rz: 0.2, c: iron },
    { g: box(0.75, 0.50, 0.75), x: -1.02, y: 2.52, rz: -0.2, c: iron },
    { g: box(0.95, 0.60, 0.90), y: 2.62, c: hide },
    EYE(0.22, 2.66, 0.48, 0.15, 0xffcc33),
    EYE(-0.22, 2.66, 0.48, 0.15, 0xffcc33),
    { g: box(0.52, 1.55, 0.52), x: 1.18, y: 1.50, rz: 0.14, c: dark },
    { g: box(0.52, 1.55, 0.52), x: -1.18, y: 1.50, rz: -0.14, c: dark },
    { g: box(0.92, 0.52, 0.92), x: 1.28, y: 0.56, c: iron },
    { g: box(0.92, 0.52, 0.92), x: -1.28, y: 0.56, c: iron },
    { g: box(0.58, 0.80, 0.58), x: 0.46, y: 0.40, c: dark },
    { g: box(0.58, 0.80, 0.58), x: -0.46, y: 0.40, c: dark },
    { g: box(0.24, 0.24, 2.10), x: 1.34, y: 1.15, z: 0.30, rx: 0.72, c: 0x4a3a2c },
    { g: box(0.86, 0.80, 0.86), x: 1.34, y: 2.30, z: 1.10, c: iron },
  ]);
}

function playerGeo() {
  return assemble([
    { g: box(0.66, 0.84, 0.44), y: 1.04 },
    { g: box(0.42, 0.38, 0.40), y: 1.66 },
    { g: box(0.24, 0.64, 0.24), x: 0.18, y: 0.32 },
    { g: box(0.24, 0.64, 0.24), x: -0.18, y: 0.32 },
  ]);
}

// --- forest cast -----------------------------------------------------------
// Same four ROLES, different bodies. Goblins are short and top-heavy so they
// read as a different species from the player at a glance, and every one of
// them carries something and looks back at you.
function goblinGeo() {
  const skin = 0x7d9c46, limb = 0x6b883a, rag = 0x7a6440;
  return assemble([
    { g: box(0.62, 0.62, 0.44), y: 0.62, rx: 0.16, c: skin },
    { g: box(0.70, 0.18, 0.48), y: 0.92, c: limb },
    { g: box(0.52, 0.46, 0.46), y: 1.18, z: 0.06, c: skin },
    { g: box(0.30, 0.14, 0.12), y: 1.08, z: 0.28, c: limb },        // snout
    { g: box(0.22, 0.05, 0.05), y: 1.02, z: 0.31, c: 0xf2ecd6 },    // teeth
    EYE(0.13, 1.26, 0.26, 0.12, 0xffe14a),
    EYE(-0.13, 1.26, 0.26, 0.12, 0xffe14a),
    { g: box(0.06, 0.03, 0.03), x: 0.13, y: 1.34, z: 0.26, c: 0x3a2c14 },  // brow
    { g: box(0.06, 0.03, 0.03), x: -0.13, y: 1.34, z: 0.26, c: 0x3a2c14 },
    { g: box(0.30, 0.20, 0.06), x: 0.36, y: 1.30, rz: 0.5, c: skin },
    { g: box(0.30, 0.20, 0.06), x: -0.36, y: 1.30, rz: -0.5, c: skin },
    { g: box(0.17, 0.54, 0.17), x: 0.42, y: 0.66, rz: 0.24, c: limb },
    { g: box(0.17, 0.54, 0.17), x: -0.42, y: 0.66, rz: -0.24, c: limb },
    { g: box(0.22, 0.40, 0.22), x: 0.17, y: 0.16, c: limb },
    { g: box(0.22, 0.40, 0.22), x: -0.17, y: 0.16, c: limb },
    { g: box(0.44, 0.26, 0.40), y: 0.34, c: rag },
    { g: box(0.13, 0.13, 0.66), x: 0.52, y: 0.36, z: 0.24, rx: 0.6, c: 0x4a3a2c },
    { g: box(0.28, 0.28, 0.34), x: 0.52, y: 0.24, z: 0.70, rx: 0.6, c: 0x5b4a34 },
  ]);
}

function scoutGeo() {
  const skin = 0x9fae56, dark = 0x84924a, hood = 0x4d5c33;
  return assemble([
    { g: box(0.46, 0.56, 0.36), y: 0.56, rx: 0.42, c: skin },
    { g: box(0.56, 0.16, 0.30), y: 0.84, z: 0.12, c: hood },
    { g: box(0.40, 0.36, 0.38), y: 0.98, z: 0.28, c: skin },
    { g: box(0.42, 0.20, 0.34), y: 1.10, z: 0.20, c: hood },        // hood
    { g: box(0.24, 0.12, 0.10), y: 0.92, z: 0.48, c: dark },
    EYE(0.10, 1.02, 0.46, 0.10, 0xff7a3a),
    EYE(-0.10, 1.02, 0.46, 0.10, 0xff7a3a),
    { g: box(0.34, 0.16, 0.05), x: 0.30, y: 1.10, rz: 0.7, c: skin },
    { g: box(0.34, 0.16, 0.05), x: -0.30, y: 1.10, rz: -0.7, c: skin },
    { g: box(0.13, 0.50, 0.13), x: 0.30, y: 0.52, rz: 0.6, c: dark },
    { g: box(0.13, 0.50, 0.13), x: -0.30, y: 0.52, rz: -0.6, c: dark },
    { g: box(0.18, 0.44, 0.18), x: 0.15, y: 0.18, rx: -0.24, c: dark },
    { g: box(0.18, 0.44, 0.18), x: -0.15, y: 0.18, rx: 0.24, c: dark },
    { g: box(0.07, 0.07, 0.42), x: 0.40, y: 0.30, z: 0.26, rx: 0.8, c: 0xc8d2e2 },
    { g: box(0.07, 0.07, 0.42), x: -0.40, y: 0.30, z: 0.26, rx: 0.8, c: 0xc8d2e2 },
  ]);
}

function trollGeo() {
  const hide = 0x8a6a4a, dark = 0x6e523a, horn = 0xd6c9ae;
  return assemble([
    { g: box(1.70, 1.45, 1.20), y: 1.55, rx: 0.12, c: hide },
    { g: box(2.10, 0.46, 1.30), y: 2.22, c: dark },
    { g: box(0.80, 0.52, 0.80), x: 0.98, y: 2.44, rz: 0.22, c: dark },
    { g: box(0.80, 0.52, 0.80), x: -0.98, y: 2.44, rz: -0.22, c: dark },
    { g: box(0.86, 0.70, 0.86), y: 2.48, z: 0.24, c: hide },
    { g: box(0.46, 0.18, 0.14), y: 2.34, z: 0.62, c: dark },        // jaw
    { g: box(0.30, 0.07, 0.07), y: 2.27, z: 0.64, c: 0xf2ecd6 },    // tusks
    EYE(0.20, 2.58, 0.62, 0.15, 0xff5030),
    EYE(-0.20, 2.58, 0.62, 0.15, 0xff5030),
    { g: box(0.10, 0.30, 0.10), x: 0.22, y: 2.86, rz: 0.2, c: horn },
    { g: box(0.10, 0.30, 0.10), x: -0.22, y: 2.86, rz: -0.2, c: horn },
    { g: box(0.54, 1.70, 0.54), x: 1.14, y: 1.42, rz: 0.16, c: hide },
    { g: box(0.54, 1.70, 0.54), x: -1.14, y: 1.42, rz: -0.16, c: hide },
    { g: box(0.92, 0.56, 0.92), x: 1.26, y: 0.48, c: dark },
    { g: box(0.92, 0.56, 0.92), x: -1.26, y: 0.48, c: dark },
    { g: box(0.62, 0.86, 0.62), x: 0.44, y: 0.43, c: dark },
    { g: box(0.62, 0.86, 0.62), x: -0.44, y: 0.43, c: dark },
    { g: box(0.34, 0.34, 2.30), x: 1.32, y: 1.05, z: 0.34, rx: 0.68, c: 0x4a3a2c },
    { g: box(0.95, 0.95, 0.95), x: 1.32, y: 2.24, z: 1.22, c: 0x5b4a34 },
  ]);
}

// The bomber. Hunched around what it is carrying, so the KEG is the read —
// the silhouette has to say "that one is different, deal with it first" from
// across the clearing, and the fuse gives it a light nothing else has.
function bomberGeo() {
  const skin = 0x8a9c4a, dark = 0x6f8038;
  return assemble([
    { g: box(0.54, 0.52, 0.40), y: 0.56, rx: 0.30, c: skin },
    { g: box(0.46, 0.40, 0.42), y: 0.98, z: 0.10, c: skin },       // head
    { g: box(0.26, 0.12, 0.10), y: 0.90, z: 0.30, c: dark },
    EYE(0.12, 1.06, 0.24, 0.11, 0xffe14a),
    EYE(-0.12, 1.06, 0.24, 0.11, 0xffe14a),
    { g: box(0.26, 0.18, 0.05), x: 0.30, y: 1.14, rz: 0.6, c: skin },
    { g: box(0.26, 0.18, 0.05), x: -0.30, y: 1.14, rz: -0.6, c: skin },
    // the keg, clutched to the chest with both arms round it
    { g: box(0.62, 0.62, 0.58), y: 0.66, z: 0.34, c: 0x6b4a2f },
    { g: box(0.68, 0.12, 0.62), y: 0.80, z: 0.34, c: 0x3f3128 },
    { g: box(0.68, 0.12, 0.62), y: 0.52, z: 0.34, c: 0x3f3128 },
    { g: box(0.15, 0.44, 0.15), x: 0.38, y: 0.66, z: 0.30, rz: 0.7, c: dark },
    { g: box(0.15, 0.44, 0.15), x: -0.38, y: 0.66, z: 0.30, rz: -0.7, c: dark },
    // the fuse, which is the only warm light on it
    { g: box(0.07, 0.26, 0.07), y: 1.06, z: 0.34, rz: 0.3, c: 0x2a2118 },
    { g: box(0.15, 0.15, 0.15), y: 1.24, z: 0.38, c: 0xffd070, e: 1 },
    { g: box(0.20, 0.40, 0.20), x: 0.14, y: 0.20, c: dark },
    { g: box(0.20, 0.40, 0.20), x: -0.14, y: 0.20, c: dark },
  ]);
}

// Roles are fixed; bodies are per theme. Nothing in sim.js knows any of this
// exists — a husk is a husk whether it is a dead thing in a crypt or a goblin
// in a wood.
// The goblin line. Same rule as the wards: SILHOUETTE BY ROLE, so what a thing
// does is legible before you can read a health bar. Cutter is the yardstick;
// each of the others is unmistakable against it from above.
//
//   Cutter   upright, a short blade         — the baseline
//   Maul     hunched and BROAD, huge head   — it is here for your walls
//   Slinger  lean and empty-handed-looking  — a bow reads as "no melee threat"
//   Bruiser  head and shoulders TALLER      — the one you must not stand in front of
//
// Every weapon sits at x > 0.32, which is the side the swing shader rotates.
// A weapon placed anywhere else does not move when the goblin attacks — that
// was the original bug and it is a placement rule now, not a coincidence.
function maulGeo() {
  const skin = 0x6f8f3e, limb = 0x5e7c33, rag = 0x6b5a38, iron = 0x767d8a;
  return assemble([
    // hunched: the torso pitches forward and the shoulders are wide
    { g: box(0.86, 0.60, 0.54), y: 0.60, rx: 0.34, c: skin },
    { g: box(0.98, 0.22, 0.60), y: 0.90, rx: 0.2, c: limb },
    { g: box(0.46, 0.40, 0.42), y: 1.10, z: 0.20, c: skin },
    { g: box(0.26, 0.13, 0.12), y: 1.02, z: 0.40, c: limb },
    EYE(0.11, 1.16, 0.38, 0.11, 0xffb03a),
    EYE(-0.11, 1.16, 0.38, 0.11, 0xffb03a),
    { g: box(0.24, 0.16, 0.06), x: 0.32, y: 1.20, rz: 0.5, c: skin },
    { g: box(0.24, 0.16, 0.06), x: -0.32, y: 1.20, rz: -0.5, c: skin },
    // a slab of iron on the back, so it reads as armoured from the chase camera
    { g: box(0.70, 0.44, 0.10), y: 0.72, z: -0.30, c: iron },
    { g: box(0.22, 0.58, 0.22), x: 0.50, y: 0.62, rz: 0.3, c: limb },
    { g: box(0.22, 0.58, 0.22), x: -0.50, y: 0.62, rz: -0.3, c: limb },
    { g: box(0.26, 0.42, 0.26), x: 0.20, y: 0.17, c: limb },
    { g: box(0.26, 0.42, 0.26), x: -0.20, y: 0.17, c: limb },
    { g: box(0.52, 0.28, 0.44), y: 0.34, c: rag },
    // the maul itself: a long haft and a head far too big for it
    { g: box(0.14, 0.14, 0.92), x: 0.56, y: 0.52, z: 0.26, rx: 0.45, c: 0x4a3a2c },
    { g: box(0.44, 0.46, 0.46), x: 0.56, y: 0.30, z: 0.86, c: iron },
    { g: box(0.50, 0.14, 0.50), x: 0.56, y: 0.30, z: 0.86, c: 0x9aa2b0 },
  ]);
}

function slingerGeo() {
  const skin = 0x86a352, limb = 0x71904a, rag = 0x6a5f42;
  return assemble([
    // lean and upright — nothing about it says "melee"
    { g: box(0.46, 0.66, 0.34), y: 0.66, c: skin },
    { g: box(0.54, 0.16, 0.38), y: 0.98, c: limb },
    { g: box(0.40, 0.40, 0.38), y: 1.22, z: 0.06, c: skin },
    { g: box(0.24, 0.12, 0.12), y: 1.14, z: 0.26, c: limb },
    EYE(0.10, 1.30, 0.22, 0.10, 0x9be04a),
    EYE(-0.10, 1.30, 0.22, 0.10, 0x9be04a),
    { g: box(0.26, 0.18, 0.06), x: 0.30, y: 1.32, rz: 0.55, c: skin },
    { g: box(0.26, 0.18, 0.06), x: -0.30, y: 1.32, rz: -0.55, c: skin },
    // a hood, which is most of what separates it from a cutter at a glance
    { g: box(0.46, 0.20, 0.44), y: 1.40, c: rag },
    { g: box(0.34, 0.24, 0.16), y: 1.30, z: -0.20, c: rag },
    { g: box(0.14, 0.50, 0.14), x: 0.34, y: 0.70, rz: 0.2, c: limb },
    { g: box(0.14, 0.50, 0.14), x: -0.34, y: 0.70, rz: -0.2, c: limb },
    { g: box(0.18, 0.42, 0.18), x: 0.14, y: 0.18, c: limb },
    { g: box(0.18, 0.42, 0.18), x: -0.14, y: 0.18, c: limb },
    // quiver on the off side, arrows showing
    { g: box(0.16, 0.44, 0.16), x: -0.30, y: 0.82, z: -0.22, rx: -0.3, c: 0x5a4530 },
    { g: box(0.04, 0.22, 0.04), x: -0.30, y: 1.10, z: -0.28, c: 0xd8cdb0 },
    { g: box(0.04, 0.22, 0.04), x: -0.24, y: 1.10, z: -0.28, c: 0xd8cdb0 },
    // the bow: a stave with a string, held out on the weapon side
    { g: box(0.06, 0.86, 0.10), x: 0.44, y: 0.78, z: 0.26, rz: 0.1, c: 0x6b4a2c },
    { g: box(0.06, 0.26, 0.08), x: 0.44, y: 1.16, z: 0.20, rx: 0.5, c: 0x6b4a2c },
    { g: box(0.06, 0.26, 0.08), x: 0.44, y: 0.40, z: 0.20, rx: -0.5, c: 0x6b4a2c },
    { g: box(0.03, 0.76, 0.03), x: 0.44, y: 0.78, z: 0.12, c: 0x2a2a2a },
  ]);
}

function bruiserGeo() {
  const skin = 0x5f7f3c, limb = 0x506d31, iron = 0x6d7480, rag = 0x5a4a30;
  return assemble([
    // head and shoulders above everything else on the field
    { g: box(1.06, 0.86, 0.66), y: 1.10, c: skin },
    { g: box(1.22, 0.26, 0.74), y: 1.56, c: limb },
    { g: box(0.56, 0.50, 0.52), y: 1.86, z: 0.06, c: skin },
    { g: box(0.32, 0.16, 0.14), y: 1.76, z: 0.30, c: limb },
    { g: box(0.24, 0.06, 0.06), y: 1.68, z: 0.34, c: 0xf2ecd6 },
    EYE(0.15, 1.96, 0.28, 0.13, 0xff7a3a),
    EYE(-0.15, 1.96, 0.28, 0.13, 0xff7a3a),
    // tusks — a heavy reads as heavier with something sticking out of its face
    { g: box(0.07, 0.20, 0.07), x: 0.16, y: 1.68, z: 0.30, rx: 0.2, c: 0xe8e0c8 },
    { g: box(0.07, 0.20, 0.07), x: -0.16, y: 1.68, z: 0.30, rx: 0.2, c: 0xe8e0c8 },
    { g: box(0.34, 0.24, 0.08), x: 0.44, y: 2.00, rz: 0.5, c: skin },
    { g: box(0.34, 0.24, 0.08), x: -0.44, y: 2.00, rz: -0.5, c: skin },
    // pauldrons, which is where the mass reads from above
    { g: box(0.42, 0.30, 0.52), x: 0.58, y: 1.52, c: iron },
    { g: box(0.42, 0.30, 0.52), x: -0.58, y: 1.52, c: iron },
    { g: box(0.28, 0.72, 0.28), x: 0.62, y: 1.06, rz: 0.22, c: limb },
    { g: box(0.28, 0.72, 0.28), x: -0.62, y: 1.06, rz: -0.22, c: limb },
    { g: box(0.34, 0.62, 0.34), x: 0.26, y: 0.31, c: limb },
    { g: box(0.34, 0.62, 0.34), x: -0.26, y: 0.31, c: limb },
    { g: box(0.78, 0.34, 0.62), y: 0.66, c: rag },
    // a two-handed axe, carried high so the overhead chop has somewhere to go
    { g: box(0.16, 0.16, 1.30), x: 0.72, y: 1.16, z: 0.30, rx: 0.4, c: 0x46372a },
    { g: box(0.20, 0.86, 0.30), x: 0.72, y: 0.90, z: 0.92, rx: 0.4, c: iron },
    { g: box(0.22, 0.94, 0.12), x: 0.72, y: 0.90, z: 1.02, rx: 0.4, c: 0xa8b0bd },
    { g: box(0.20, 0.22, 0.22), x: 0.72, y: 1.52, z: -0.02, c: 0x8a7a52 },
  ]);
}

const SKINS = {
  crypt: {
    husk:    { geo: huskGeo,    name: 'Husk' },
    bomber:  { geo: bomberGeo,  name: 'Powder Wight' },
    runner:  { geo: runnerGeo,  name: 'Runner' },
    wisp:    { geo: wispGeo,    name: 'Wisp' },
    breaker: { geo: breakerGeo, name: 'Breaker' },
    maul:    { geo: maulGeo,    name: 'Maul Wight' },
    slinger: { geo: slingerGeo, name: 'Bone Archer' },
    bruiser: { geo: bruiserGeo, name: 'Bruiser' },
  },
  forest: {
    husk:    { geo: goblinGeo, name: 'Goblin' },
    bomber:  { geo: bomberGeo, name: 'Powder Goblin' },
    runner:  { geo: scoutGeo,  name: 'Scout' },
    wisp:    { geo: wispGeo,   name: 'Will-o-wisp' },
    breaker: { geo: trollGeo,  name: 'Troll' },
    maul:    { geo: maulGeo,    name: 'Maul Goblin' },
    slinger: { geo: slingerGeo, name: 'Slinger' },
    bruiser: { geo: bruiserGeo, name: 'Bruiser' },
  },
};

const FOE_CAP = {
  husk: 90, runner: 110, wisp: 40, breaker: 8, bomber: 24,
  maul: 20, slinger: 24, bruiser: 12,
};

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

    const forest = (currentMap() && currentMap().theme) === 'forest';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(forest ? PAL.duskSky : PAL.night);
    // Far plane pushed out for the forest so the hill bands read as distance
    // rather than as flat fog: at 118 they were geometry the fog had already
    // finished with. The near plane is unchanged, so the treeline hazes as before.
    this.scene.fog = new THREE.Fog(forest ? 0x27324a : PAL.fog, 40, forest ? 168 : 118);

    this.camera = new THREE.PerspectiveCamera(56, 1, 0.5, 260);
    this.camYaw = Math.PI;
    // Dungeon Defenders sits close behind the character, not above the board:
    // ~34 degrees and 11m back. You lose the whole-arena read that a tactical
    // overhead gives, which is exactly why the minimap exists — awareness moves
    // to the map and the 3D view becomes a place you are standing in.
    // Wheel zooms out to 26 for players who want the old view.
    this.camDist = 11;
    this.camHeight = 7.5;
    this.shake = 0;
    this.showHpBars = true;
    this.allowShake = true;
    // How far past the player the camera aims. Without it the player sits in
    // the middle of frame with dead floor below and the lane you are walking
    // toward cropped off the top — worst on a tall portrait phone.
    this.lookAhead = 4;

    // Overhead build view — Dungeon Defenders' "overlord" camera. Lifts off
    // the shoulder to a high angled view you can pan, so a far track can be
    // built on without walking there. Deliberately NOT straight down: a few
    // degrees of tilt keeps the wards' silhouettes readable, which a pure
    // plan view destroys.
    this.overhead = false;
    this.ohTarget = { x: 0, z: 0 };
    this.ohHeight = 40;
    this.ohBlend = 0;              // 0 = chase, 1 = overhead
    this._camPos = new THREE.Vector3(0, 20, 20);
    this._camLook = new THREE.Vector3();

    this.glowTex = glowTexture();
    this.t = 0;

    this.theme = (currentMap() && currentMap().theme) || 'crypt';
    this._buildLights();
    if (this.theme === 'forest') {
      this._buildForest();
      this._buildScenery();
      this._buildHearth();
    }
    else { this._buildArena(); this._buildStone(); }
    this._buildUnits();
    this._buildPools();
    this._buildShocks();
    this._buildTrail();

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
    const forest = this.theme === 'forest';
    this.hemi = forest
      ? new THREE.HemisphereLight(0x7d9ad0, 0x3a4a26, 1.05)   // dusk sky, mossy ground
      : new THREE.HemisphereLight(0x8098c4, 0x3a2e22, 0.62);
    this.scene.add(this.hemi);

    // key — the wardstone itself
    this.key = new THREE.PointLight(forest ? 0xff9a3c : PAL.stone, 340, 92, 1.7);
    this.key.position.set(0, forest ? 5.6 : 8.5, 0);
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
    this.fill = new THREE.DirectionalLight(forest ? 0xbcd2f5 : 0xffe6c4, forest ? 0.85 : 0.5);
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

  // ---------------------------------------------------------------- forest
  // A clearing at dusk. The lanes are worn dirt tracks through grass, the
  // boundary is a treeline rather than a wall, and the light in the middle is
  // a fire — which keeps the "the world dims as the objective dies" mechanic
  // literal rather than metaphorical.
  // --------------------------------------------------------------- scenery
  // Everything here is decoration and NOTHING here sits on a lane or in a
  // buildable cell — a prop the player cannot build behind would be a bug
  // dressed as a tree. Each group merges into a single mesh, so the whole pass
  // costs a handful of draw calls.
  //
  // The brief was "the clearing looks empty". The cure is the same one that
  // fixed flat facades: break the symmetry, and give the eye something at
  // THREE distances — silhouettes on the horizon, mass in the middle, and
  // small detail down where the chase camera actually lives.
  // See [[procedural-facades-beat-flat-boxes]].
  _buildScenery() {
    const H = ARENA.half;
    const rng = makeRng(1337);
    const clear = (x, z, laneGap, homeGap) =>
      nearestLane(x, z).dist > laneGap && Math.hypot(x, z) > (homeGap || 9);

    const addMesh = (parts, opts = {}) => {
      if (!parts.length) return null;
      const m = new THREE.Mesh(assemble(parts), new THREE.MeshStandardMaterial({
        color: 0xffffff, vertexColors: true, flatShading: true,
        roughness: opts.rough == null ? 1 : opts.rough,
        emissive: opts.emissive || 0x000000,
        emissiveIntensity: opts.emissiveIntensity || 0,
      }));
      m.castShadow = !this.low && opts.shadow !== false;
      m.receiveShadow = !this.low && opts.shadow !== false;
      this.scene.add(m);
      return m;
    };

    // --- 1. distant hills. Three receding bands beyond the treeline, each
    // flatter and hazier than the last. This is the cheapest depth in the
    // scene: it turns "a wall of trees" into "a wood with somewhere behind it".
    for (let band = 0; band < 3; band++) {
      const parts = [];
      const dist = 100 + band * 24;
      const tint = [0x2b3a42, 0x27333d, 0x232c38][band];
      for (let a = 0; a < 46; a++) {
        const ang = (a / 46) * Math.PI * 2 + rng() * 0.06;
        const hgt = (22 - band * 4) * (0.6 + rng() * 0.7);
        const wid = 34 + rng() * 40;
        parts.push({
          g: box(wid, hgt, 10),
          x: Math.cos(ang) * dist, y: hgt / 2 - 5, z: Math.sin(ang) * dist,
          ry: ang, rz: (rng() - 0.5) * 0.06, c: tint,
        });
      }
      const m = new THREE.Mesh(assemble(parts), new THREE.MeshBasicMaterial({
        color: 0xffffff, vertexColors: true, fog: true,
      }));
      m.renderOrder = -3;
      this.scene.add(m);
    }

    // --- 2. birches in the treeline. The wood was one species and read as
    // wallpaper; a pale trunk every dozen trees is what makes it a wood.
    const birch = [], birchLeaf = [];
    for (let i = 0; i < 34; i++) {
      const ang = rng() * Math.PI * 2;
      const r = H - 2 + rng() * 13;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const th = 5.5 + rng() * 4;
      birch.push({ g: box(0.42, th, 0.42), x, y: th / 2, z, c: 0xcfc9b4 });
      // the dark bands that make a birch a birch
      for (let b = 0; b < 4; b++) {
        birch.push({
          g: box(0.46, 0.16, 0.46), x, z,
          y: th * (0.22 + b * 0.18), c: 0x3a3830,
        });
      }
      let ry = th * 0.9, rr = 2.2;
      for (let k = 0; k < 3; k++) {
        birchLeaf.push({ g: box(rr, 1.3, rr), x, y: ry, z, ry: rng() * 0.8, c: 0x6a7f3a });
        ry += 1.0; rr *= 0.74;
      }
    }
    addMesh(birch, { rough: 0.9 });
    addMesh(birchLeaf);

    // --- 3. ferns. Angled fronds off a common root, which reads as a plant
    // from above where a crossed quad reads as a cone.
    // See [[voxel-look-pass]].
    const ferns = [];
    for (let i = 0; i < 90; i++) {
      const ang = rng() * Math.PI * 2, r = 11 + rng() * 26;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (!clear(x, z, 4.6)) continue;
      const n = 5 + ((rng() * 3) | 0);
      const sc = 0.7 + rng() * 0.5;
      for (let f = 0; f < n; f++) {
        const fa = (f / n) * Math.PI * 2 + rng() * 0.4;
        const len = (0.9 + rng() * 0.5) * sc;
        ferns.push({
          g: box(0.16 * sc, 0.07, len),
          x: x + Math.cos(fa) * len * 0.42,
          y: 0.34 + rng() * 0.2,
          z: z + Math.sin(fa) * len * 0.42,
          ry: -fa, rx: -0.5 - rng() * 0.3,
          c: rng() < 0.3 ? 0x4c6b32 : 0x3f5c2c,
        });
      }
    }
    addMesh(ferns);

    // --- 4. wildflowers. Tiny, and the only saturated colour on the floor — a
    // green field with nothing warm in it reads as flat however much relief it
    // has.
    const flowers = [];
    const FCOL = [0xd8d2b0, 0xc9a2d8, 0xe0b25c, 0xd86a72];
    for (let i = 0; i < 260; i++) {
      const x = (rng() * 2 - 1) * (H - 4), z = (rng() * 2 - 1) * (H - 4);
      if (!clear(x, z, 3.9, 7)) continue;
      const c = FCOL[(rng() * FCOL.length) | 0];
      const h = 0.24 + rng() * 0.2;
      flowers.push({ g: box(0.05, h, 0.05), x, y: 0.16 + h / 2, z, c: 0x53703a });
      flowers.push({ g: box(0.17, 0.1, 0.17), x, y: 0.16 + h, z, ry: rng() * 3, c });
    }
    addMesh(flowers, { shadow: false });

    // --- 5. mushroom rings, faintly lit. At night these are the only thing in
    // the undergrowth that draws the eye, and they sell "this wood is odd"
    // without a line of text.
    const caps = [], stems = [];
    for (let i = 0; i < 9; i++) {
      const ang = rng() * Math.PI * 2, r = 13 + rng() * 22;
      const cx = Math.cos(ang) * r, cz = Math.sin(ang) * r;
      if (!clear(cx, cz, 5.4)) continue;
      const ring = 0.9 + rng() * 1.5;
      const n = 5 + ((rng() * 5) | 0);
      for (let k = 0; k < n; k++) {
        const a2 = (k / n) * Math.PI * 2 + rng() * 0.3;
        const x = cx + Math.cos(a2) * ring, z = cz + Math.sin(a2) * ring;
        const s = 0.09 + rng() * 0.09;
        stems.push({ g: box(s * 0.4, s * 1.5, s * 0.4), x, y: 0.16 + s * 0.75, z, c: 0xdad3bd });
        caps.push({ g: box(s * 1.6, s * 0.6, s * 1.6), x, y: 0.16 + s * 1.6, z, ry: rng() * 3, c: 0x7fd4c0 });
      }
    }
    addMesh(stems, { shadow: false });
    addMesh(caps, { emissive: 0x2f6f60, emissiveIntensity: 0.45, shadow: false });

    // --- 6. cairns. Vertical accents that are neither tree nor ward, so the
    // middle distance has something to read against without ever being
    // mistaken for something you built.
    const cairn = [];
    for (let i = 0; i < 9; i++) {
      const ang = rng() * Math.PI * 2, r = 14 + rng() * 20;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (!clear(x, z, 6.2)) continue;
      let y = 0.16, w = 1.15;
      const n = 3 + ((rng() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const h = 0.34 + rng() * 0.3;
        cairn.push({
          g: box(w, h, w * (0.8 + rng() * 0.3)),
          x: x + (rng() - 0.5) * 0.16, y: y + h / 2, z: z + (rng() - 0.5) * 0.16,
          ry: rng() * 3, c: rng() < 0.4 ? 0x6e6a5c : 0x5d5a4e,
        });
        y += h; w *= 0.78;
      }
    }
    addMesh(cairn, { rough: 0.95 });

    // --- 7. roots and mossy logs. Detail at ankle height, where the chase
    // camera actually spends its time.
    const roots = [], moss = [];
    for (let i = 0; i < 46; i++) {
      const ang = rng() * Math.PI * 2, r = 12 + rng() * 24;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (!clear(x, z, 5.0)) continue;
      if (rng() < 0.55) {
        const n = 2 + ((rng() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const a2 = rng() * Math.PI * 2;
          const L = 1.1 + rng() * 1.3;
          roots.push({
            g: box(0.3, 0.24, L),
            x: x + Math.cos(a2) * L * 0.4, y: 0.24, z: z + Math.sin(a2) * L * 0.4,
            ry: -a2, rx: 0.1, c: 0x392f24,
          });
        }
      } else {
        const L = 2.0 + rng() * 2.2, ry = rng() * 3;
        roots.push({ g: box(0.62, 0.62, L), x, y: 0.44, z, ry, c: 0x453729 });
        // moss on the upper face only — a log mossed all round reads as a tube
        moss.push({ g: box(0.5, 0.14, L * 0.9), x, y: 0.76, z, ry, c: 0x5c7a3c });
      }
    }
    addMesh(roots);
    addMesh(moss, { shadow: false });

    // --- 8. fireflies. The one moving thing in the scenery, and the reason the
    // clearing feels alive rather than modelled. Instanced and driven off a
    // sine per index, so 90 of them cost one draw call and no allocation.
    const fg = new THREE.SphereGeometry(0.07, 5, 4);
    const fm = new THREE.MeshBasicMaterial({
      color: 0xffe9a0, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.fireflies = new THREE.InstancedMesh(fg, fm, 90);
    this.fireflies.frustumCulled = false;
    this._flySeeds = [];
    for (let i = 0; i < 90; i++) {
      const ang = rng() * Math.PI * 2, r = 8 + rng() * 26;
      this._flySeeds.push({
        x: Math.cos(ang) * r, z: Math.sin(ang) * r,
        y: 0.7 + rng() * 2.1, ph: rng() * 6.28, sp: 0.35 + rng() * 0.55,
        rad: 0.7 + rng() * 1.5,
      });
    }
    this.scene.add(this.fireflies);
  }

  // Fireflies drift and blink. Kept out of update()'s body so a frame reads as
  // camera / world / wards rather than camera / world / bugs / wards.
  _stepFireflies() {
    if (!this.fireflies) return;
    const t = this.t;
    for (let i = 0; i < this._flySeeds.length; i++) {
      const s = this._flySeeds[i];
      const a = t * s.sp + s.ph;
      _v.set(
        s.x + Math.cos(a) * s.rad,
        s.y + Math.sin(a * 1.7 + s.ph) * 0.35,
        s.z + Math.sin(a * 0.8) * s.rad,
      );
      // blink by SCALE rather than opacity: one shared material means fading
      // one would fade all ninety, and a wink reads better than a dim anyway
      const blink = Math.max(0, Math.sin(a * 2.1 + s.ph * 3));
      const sc = 0.35 + blink * 0.9;
      _m.compose(_v, _q.identity(), _s.set(sc, sc, sc));
      this.fireflies.setMatrixAt(i, _m);
    }
    this.fireflies.instanceMatrix.needsUpdate = true;
  }


  _buildForest() {
    const H = ARENA.half;
    const rng = makeRng(4242);

    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2, H * 2),
      new THREE.MeshStandardMaterial({ color: PAL.grassDark, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = !this.low;
    this.scene.add(grass);

    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 5, H * 5),
      new THREE.MeshBasicMaterial({ color: 0x10160f }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.1;
    this.scene.add(apron);

    // --- turf. Slabs of grass with height and tone jitter, so the ground has
    // relief instead of being a painted plane. Same trick as the flagstones,
    // but irregular rather than gridded so it does not read as tiling.
    // A low sward over the base, then TUFTS. Big slabs read as cracked paving;
    // a scatter of small blades at this camera distance reads as grass.
    const sward = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 2, H * 2),
      new THREE.MeshStandardMaterial({ color: PAL.grass, roughness: 1 }));
    sward.rotation.x = -Math.PI / 2;
    sward.position.y = 0.16;
    sward.receiveShadow = !this.low;
    this.scene.add(sward);

    const tufts = [];
    for (let i = 0; i < 1050; i++) {
      const x = (rng() * 2 - 1) * H, z = (rng() * 2 - 1) * H;
      if (nearestLane(x, z).dist < 3.4) continue;      // tracks are worn bare
      const h = 0.14 + rng() * 0.26;
      const w = 0.09 + rng() * 0.11;
      tufts.push({ g: box(w, h, w), x, y: 0.16 + h / 2, z, ry: rng() * 3 });
      // clump: a blade alone reads as a stick, three together read as grass
      const blades = 2 + ((rng() * 2) | 0);
      for (let b = 0; b < blades; b++) {
        const hh = h * (0.55 + rng() * 0.6);
        tufts.push({
          g: box(w * 0.85, hh, w * 0.85),
          x: x + (rng() - 0.5) * 0.62, y: 0.16 + hh / 2, z: z + (rng() - 0.5) * 0.62,
          ry: rng() * 3, rz: (rng() - 0.5) * 0.45,
        });
      }
    }
    const turfMesh = new THREE.Mesh(assemble(tufts), new THREE.MeshStandardMaterial({
      color: 0x5f7d40, roughness: 1, flatShading: true,
    }));
    this.scene.add(turfMesh);

    // --- the tracks: bare earth worn through the grass. Dirt against green is
    // a strong enough contrast that the lanes need no glowing markers at all.
    this.laneStrips = {};
    for (const lane of LANES) {
      const parts = [], edge = [];
      const step = 1.5;
      for (let d = 0; d < lane.total; d += step) {
        const a = laneAt(lane, d, 0), b = laneAt(lane, Math.min(lane.total, d + step), 0);
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const ry = Math.atan2(b.x - a.x, b.z - a.z);
        parts.push({ g: box(lane.width * (0.92 + rng() * 0.14), 0.09, step * 1.12),
                     x: mx, y: 0.24, z: mz, ry });
        // stones kicked to the verge
        if (rng() < 0.5) {
          const side = rng() < 0.5 ? -1 : 1;
          const q = laneAt(lane, d, side * (lane.width / 2 + rng() * 0.5));
          const sc = 0.28 + rng() * 0.42;
          edge.push({ g: box(sc, sc * 0.7, sc), x: q.x, y: 0.26, z: q.z, ry: rng() * 3 });
        }
      }
      const mesh = new THREE.Mesh(assemble(parts), new THREE.MeshStandardMaterial({
        color: PAL.dirt, roughness: 1, flatShading: true,
      }));
      mesh.receiveShadow = !this.low;
      this.scene.add(mesh);
      this.laneStrips[lane.id] = mesh;
      if (edge.length) {
        this.scene.add(new THREE.Mesh(assemble(edge), new THREE.MeshStandardMaterial({
          color: 0x6e6a5c, roughness: 0.95, flatShading: true,
        })));
      }
    }

    // --- trees. One merged mesh for trunks, one for canopy, so a whole wood
    // costs two draw calls. Stacked tapering boxes read as conifer at this
    // camera without a single triangle of foliage detail.
    const trunks = [], canopy = [];
    const addTree = (x, z, scale) => {
      const th = (3.2 + rng() * 2.6) * scale;
      trunks.push({ g: box(0.62 * scale, th, 0.62 * scale), x, y: th / 2, z });
      let r = 2.5 * scale, y = th * 0.86;
      for (let i = 0; i < 4; i++) {
        canopy.push({ g: box(r, 1.5 * scale, r), x, y, z, ry: rng() * 0.7 });
        y += 1.15 * scale;
        r *= 0.72;
      }
    };

    // the treeline: a dense band just outside the playable floor
    for (let a = 0; a < 200; a++) {
      const ang = (a / 200) * Math.PI * 2;
      const r = H - 1 + rng() * 12;
      addTree(Math.cos(ang) * r, Math.sin(ang) * r, 1.0 + rng() * 0.5);
    }
    // and trees standing IN the clearing, off the tracks — the depth cue that
    // stops the middle reading as an empty field
    for (let i = 0; i < 20; i++) {
      const ang = rng() * Math.PI * 2, r = 15 + rng() * 18;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (nearestLane(x, z).dist < 6.5) continue;
      // deliberately smaller than the treeline: a full-size canopy this close
      // to the camera blots out the half of the clearing you are fighting in
      addTree(x, z, 0.45 + rng() * 0.25);
    }
    const trunkMesh = new THREE.Mesh(assemble(trunks), new THREE.MeshStandardMaterial({
      color: PAL.bark, roughness: 1, flatShading: true,
    }));
    trunkMesh.castShadow = !this.low;
    this.scene.add(trunkMesh);
    const leafMesh = new THREE.Mesh(assemble(canopy), new THREE.MeshStandardMaterial({
      color: PAL.leaf, roughness: 1, flatShading: true,
    }));
    leafMesh.castShadow = !this.low;
    this.scene.add(leafMesh);

    // --- undergrowth: bushes, ferns, stumps, fallen logs, mushrooms
    const bush = [], rock = [], wood = [];
    for (let i = 0; i < 150; i++) {
      const ang = rng() * Math.PI * 2, r = 6 + rng() * 30;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (nearestLane(x, z).dist < 4.4) continue;
      const roll = rng();
      if (roll < 0.5) {
        const sc = 0.55 + rng() * 0.55;
        bush.push({ g: box(sc, sc * 0.72, sc), x, y: sc * 0.34, z, ry: rng() * 3 });
        bush.push({ g: box(sc * 0.7, sc * 0.6, sc * 0.7), x: x + 0.3, y: sc * 0.6, z, ry: rng() * 3 });
      } else if (roll < 0.78) {
        const sc = 0.38 + rng() * 0.6;
        rock.push({ g: box(sc, sc * 0.68, sc * 0.85), x, y: sc * 0.3, z, ry: rng() * 3 });
      } else if (roll < 0.92) {
        const L = 1.5 + rng() * 1.9;
        wood.push({ g: box(0.52, 0.52, L), x, y: 0.3, z, ry: rng() * 3, rx: 0.06 });
      } else {
        wood.push({ g: box(0.72, 0.56, 0.72), x, y: 0.28, z });   // stump
      }
    }
    const addMesh = (parts, color, rough) => {
      if (!parts.length) return;
      const m = new THREE.Mesh(assemble(parts), new THREE.MeshStandardMaterial({
        color, roughness: rough == null ? 1 : rough, flatShading: true,
      }));
      m.castShadow = !this.low;
      m.receiveShadow = !this.low;
      this.scene.add(m);
    };
    addMesh(bush, PAL.bush);
    addMesh(rock, 0x6e6a5c, 0.95);
    addMesh(wood, PAL.bark);

    // --- the three tracks in. Rough timber frames the goblins have worn
    // through, rather than carved arches.
    this.doorGlows = [];
    for (const lane of LANES) {
      const p = lane.points[0];
      const ang = Math.atan2(lane.segs[0].dx, lane.segs[0].dz);
      const post = new THREE.Mesh(assemble([
        { g: box(0.7, 5.2, 0.7), x: (lane.width + 1.2) / 2, y: 2.6, rz: 0.05 },
        { g: box(0.7, 5.2, 0.7), x: -(lane.width + 1.2) / 2, y: 2.6, rz: -0.05 },
        { g: box(lane.width + 2.6, 0.5, 0.5), y: 5.0 },
        { g: box(0.4, 0.4, 0.4), x: 0, y: 5.5 },
      ]), new THREE.MeshStandardMaterial({
        color: 0x4e4034, roughness: 1, flatShading: true,
      }));
      post.position.set(p[0], 0, p[1]);
      post.rotation.y = ang;
      post.castShadow = !this.low;
      this.scene.add(post);

      const g = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: 0x4a7f5a, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.28,
      }));
      g.position.set(p[0], 2.2, p[1]);
      g.scale.set(10, 10, 1);
      this.scene.add(g);

      const dl = new THREE.PointLight(0x6fae7a, 22, 22, 2);
      dl.position.set(p[0] - lane.segs[0].dx * 2, 3.4, p[1] - lane.segs[0].dz * 2);
      this.scene.add(dl);
      this.doorGlows.push({ sprite: g, lane: lane.id, base: 0.28, light: dl });
    }
    this.sconces = [];
  }

  // ------------------------------------------------------------- hearthfire
  _buildHearth() {
    const grp = new THREE.Group();
    const R = STONE_DEF.radius;
    const rng = makeRng(77);

    // a ring of hearth stones, deliberately irregular
    const ring = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rng() * 0.15;
      const rr = R + 0.3 + rng() * 0.3;
      const sc = 0.52 + rng() * 0.4;
      ring.push({
        g: box(sc, sc * (0.6 + rng() * 0.5), sc * 0.9),
        x: Math.cos(a) * rr, y: sc * 0.3, z: Math.sin(a) * rr, ry: a + rng(),
      });
    }
    const stones = new THREE.Mesh(assemble(ring), new THREE.MeshStandardMaterial({
      color: 0x6a6459, roughness: 0.96, flatShading: true,
    }));
    stones.castShadow = !this.low;
    stones.receiveShadow = !this.low;
    grp.add(stones);

    // ash bed
    const ash = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 0.24, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: 1, flatShading: true }));
    ash.position.y = 0.12;
    grp.add(ash);

    // stacked logs
    const logs = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      logs.push({
        g: box(0.42, 0.42, 2.5), x: Math.cos(a) * 0.75, y: 0.5 + (i % 2) * 0.42,
        z: Math.sin(a) * 0.75, ry: a + 1.57, rx: -0.24,
      });
    }
    const logMesh = new THREE.Mesh(assemble(logs), new THREE.MeshStandardMaterial({
      color: 0x5a4231, roughness: 1, flatShading: true,
    }));
    logMesh.castShadow = !this.low;
    grp.add(logMesh);

    // the flame: three nested tapering shells that counter-rotate, so it reads
    // as a moving fire rather than an orange cone
    this.flames = [];
    for (let i = 0; i < 3; i++) {
      const h = 2.15 - i * 0.5;
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(0.92 - i * 0.22, h, 5),
        new THREE.MeshStandardMaterial({
          color: i === 0 ? 0xff7a2a : (i === 1 ? 0xffa23d : 0xffe08a),
          emissive: i === 0 ? 0xff5a10 : (i === 1 ? 0xff9020 : 0xffd070),
          emissiveIntensity: 1.6 + i * 0.9,
          roughness: 0.4, flatShading: true,
          transparent: true, opacity: 0.92 - i * 0.06,
        }));
      m.position.y = 0.85 + h / 2;
      m.position.x = (i - 1) * 0.12;
      m.rotation.z = (i - 1) * 0.09;
      grp.add(m);
      this.flames.push({ mesh: m, base: m.position.y, spin: (i % 2 ? -1 : 1) * (0.5 + i * 0.4) });
    }
    // kept under the old names so update() needs no branching
    this.crystal = this.flames[0].mesh;
    this.crystalShell = this.flames[2].mesh;

    this.stoneGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: 0xffa23d, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9,
    }));
    this.stoneGlow.position.y = 1.9;
    this.stoneGlow.scale.set(9.5, 9.5, 1);
    grp.add(this.stoneGlow);

    this.scene.add(grp);
    this.stoneGrp = grp;
  }

  // ------------------------------------------------------------------ units
  _buildUnits() {
    this.foeMeshes = {};
    const skins = SKINS[this.theme] || SKINS.crypt;
    for (const def of FOES) {
      const skin = skins[def.id];
      const geo = skin.geo();
      const n = FOE_CAP[def.id];
      const isWisp = def.id === 'wisp';
      const mat = withInstanceFlash(new THREE.MeshStandardMaterial({
        color: 0xffffff, vertexColors: true,
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

      // Outline hull: the same geometry, back faces, pushed along the normals.
      // It SHARES the body's instanceMatrix object, so it can never drift out
      // of sync and costs no extra bookkeeping — only one more draw call.
      let outline = null;
      if (!isWisp) {
        outline = new THREE.InstancedMesh(geo, outlineMat(def.id === 'breaker' ? 0.09 : 0.055), n);
        outline.instanceMatrix = mesh.instanceMatrix;
        outline.frustumCulled = false;
        outline.count = 0;
        outline.renderOrder = -1;
        this.scene.add(outline);
      }
      const flash = flashAttr(geo, n);
      const phase = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      phase.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aPhase', phase);
      const tele = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      tele.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aTele', tele);
      const swing = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      swing.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aSwing', swing);
      this.foeMeshes[def.id] = { mesh, outline, flash, phase, tele, swing, cap: n };
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

    this._buildPlayerRig();

    // the lantern you carry — a second, small, moving light source
    this.lantern = new THREE.PointLight(0xffd9a0, 10, 9.5, 2);
    this.lantern.position.set(0, 1.7, 0);
    this.scene.add(this.lantern);
    this.lanternGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, color: 0xffd9a0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5,
    }));
    this.lanternGlow.scale.set(3.2, 3.2, 1);
    this.scene.add(this.lanternGlow);
  }

  // The player is ONE object, so unlike the instanced foes it can afford a
  // real rig: limbs as separate meshes on their own pivots. This is what makes
  // walking read as walking rather than as a bobbing statue, and it lets the
  // held weapon actually change when you swap.
  _buildPlayerRig() {
    const steel = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0.32,
      emissive: 0x1e2740, emissiveIntensity: 0.22, flatShading: true,
    });
    const cloth = new THREE.MeshStandardMaterial({
      color: PAL.cloak, roughness: 0.9, flatShading: true,
    });
    // limbs are a full value step darker than the torso, so the body has
    // internal shape instead of reading as one silhouette
    const dark = new THREE.MeshStandardMaterial({
      color: 0x5d6982, roughness: 0.62, metalness: 0.3, flatShading: true,
    });
    const wood = new THREE.MeshStandardMaterial({
      color: 0x6b4a2f, roughness: 0.85, flatShading: true,
    });

    const g = new THREE.Group();

    // Deliberately UNREALISTIC proportions. A head the same width as the torso
    // reads as "a smaller box on a bigger box" at sixty screen pixels; every
    // legible blocky character exaggerates the head and shortens the legs.
    // Value contrast per part matters as much: one steel colour merges torso,
    // arms and legs into a single mass with no internal shape.
    const DARK = 0x59657e, LIGHT = 0xb2c0d6, RED = 0xa8323c, GOLD = 0xd7a24e;
    const body = new THREE.Mesh(assemble([
      { g: box(0.76, 0.70, 0.48), y: 0.90, c: 0x8b9ab2 },          // cuirass
      { g: box(0.52, 0.44, 0.10), y: 0.88, z: 0.25, c: RED },      // tabard
      { g: box(1.02, 0.24, 0.56), y: 1.20, c: DARK },              // shoulder bar
      { g: box(0.34, 0.30, 0.38), x: 0.50, y: 1.26, c: LIGHT },    // pauldrons
      { g: box(0.34, 0.30, 0.38), x: -0.50, y: 1.26, c: LIGHT },
      { g: box(0.62, 0.56, 0.56), y: 1.60, c: LIGHT },             // BIG helm
      { g: box(0.66, 0.12, 0.60), y: 1.42, c: DARK },              // helm rim
      { g: box(0.44, 0.11, 0.10), y: 1.60, z: 0.30, c: 0x161c26 }, // visor slit
      { g: box(0.14, 0.30, 0.60), y: 1.94, c: RED },               // crest
      { g: box(0.10, 0.16, 0.30), y: 2.14, z: -0.12, c: RED },
      { g: box(0.44, 0.16, 0.42), y: 0.52, c: GOLD },              // belt
    ]), steel);
    body.castShadow = !this.low;
    g.add(body);

    const cape = new THREE.Mesh(assemble([
      { g: box(0.66, 0.66, 0.09), y: 1.00, z: -0.30 },
      { g: box(0.56, 0.32, 0.09), y: 0.54, z: -0.34, rx: 0.18 },
    ]), cloth);
    g.add(cape);

    const limb = (w, h, d, mat) => {
      const m = new THREE.Mesh(box(w, h, d || w), mat || dark);
      m.geometry.translate(0, -h / 2, 0);      // pivot at the TOP, i.e. the joint
      m.castShadow = !this.low;
      return m;
    };

    // short, thick legs and a low hip — the other half of the chibi read
    const legL = limb(0.28, 0.50, 0.30), legR = limb(0.28, 0.50, 0.30);
    legL.position.set(0.19, 0.54, 0);
    legR.position.set(-0.19, 0.54, 0);
    g.add(legL, legR);

    const armL = limb(0.22, 0.54, 0.24), armR = limb(0.22, 0.54, 0.24);
    armL.position.set(0.52, 1.18, 0);
    armR.position.set(-0.52, 1.18, 0);
    g.add(armL, armR);

    // --- the two weapons, each parented to a hand so they follow the swing
    const sword = new THREE.Mesh(assemble([
      { g: box(0.10, 0.10, 0.28), y: -0.70 },                    // grip
      { g: box(0.30, 0.07, 0.09), y: -0.76 },                    // crossguard
      { g: box(0.13, 0.06, 1.05), y: -0.80, z: 0.60 },           // blade
      { g: box(0.06, 0.05, 0.22), y: -0.80, z: 1.20 },           // point
    ]), new THREE.MeshStandardMaterial({
      color: 0xc8d2e2, roughness: 0.32, metalness: 0.8, flatShading: true,
    }));
    armR.add(sword);

    const bow = new THREE.Mesh(assemble([
      { g: box(0.09, 0.16, 0.62), y: -0.66, z: 0.10 },           // stock
      { g: box(0.86, 0.07, 0.09), y: -0.66, z: 0.32 },           // lath
      { g: box(0.07, 0.07, 0.30), y: -0.60, z: -0.06 },          // butt
    ]), wood);
    armR.add(bow);

    // The shield, on the left arm. It was previously nowhere — the red shape
    // on his back was the cloak.
    const shield = new THREE.Mesh(assemble([
      { g: box(0.72, 0.86, 0.10), y: -0.52, z: 0.18, c: 0x9c3038 },
      { g: box(0.80, 0.20, 0.11), y: -0.52, z: 0.19, c: 0xd7a24e },
      { g: box(0.18, 0.62, 0.12), y: -0.52, z: 0.20, c: 0xd7a24e },
      { g: box(0.22, 0.22, 0.13), y: -0.52, z: 0.21, c: 0xe6d5b0 },
    ]), new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0.2,
      flatShading: true,
    }));
    armL.add(shield);

    // Outline every rig part. The player is the one thing always in frame, so
    // this is where the dark edge matters most.
    const ow = 0.045;
    for (const part of [body, cape, legL, legR, armL, armR]) {
      const o = new THREE.Mesh(part.geometry, new THREE.MeshBasicMaterial({
        color: 0x0b0e14, side: THREE.BackSide, fog: true,
      }));
      o.scale.setScalar(1 + ow / 0.5);
      o.renderOrder = -1;
      part.add(o);
    }

    g.scale.setScalar(1.12);   // presence at an 11m camera
    this.scene.add(g);
    this.playerRig = {
      group: g, body, cape, legL, legR, armL, armR, sword, bow, shield,
      gait: 0, mat: steel,
    };
    this.player = g;               // kept so existing code can hide/show it
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
        depthWrite: false,
      }), this.PN);
    this.partMesh.frustumCulled = false;
    this.partMesh.count = 0;
    this.partMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.PN * 3), 3);
    this.scene.add(this.partMesh);
    this._pn = 0;

    // build ghost
    this.ghost = new THREE.Mesh(box(CELL * 0.92, 0.32, CELL * 0.55),
      new THREE.MeshBasicMaterial({
        color: 0x7fe08a, transparent: true, opacity: 0.62, depthWrite: false,
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

    // Mana caches. One instanced crate, plus a glint sprite so they can be
    // picked out across a dark clearing — the whole point is that you go and
    // look for them, which requires being able to see them from a distance.
    this.CACHEN = 16;
    this.cacheMesh = new THREE.InstancedMesh(assemble([
      { g: box(1.05, 0.85, 0.85), y: 0.42, c: 0x6b4a2f },
      { g: box(1.12, 0.16, 0.92), y: 0.20, c: 0x4a3524 },
      { g: box(1.12, 0.16, 0.92), y: 0.68, c: 0x4a3524 },
      { g: box(0.30, 0.24, 0.30), y: 0.95, c: 0x8fa2c0 },
      { g: box(0.16, 0.16, 0.16), y: 1.12, c: 0x9fe8ff, e: 0.9 },
    ]), new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.9, flatShading: true,
    }), this.CACHEN);
    this.cacheMesh.frustumCulled = false;
    this.cacheMesh.count = 0;
    this.cacheMesh.castShadow = !this.low;
    flashAttr(this.cacheMesh.geometry, this.CACHEN);
    this.cacheMesh.geometry.setAttribute('aPhase',
      new THREE.InstancedBufferAttribute(new Float32Array(this.CACHEN), 1));
    this.cacheMesh.geometry.setAttribute('aTele',
      new THREE.InstancedBufferAttribute(new Float32Array(this.CACHEN), 1));
    this.scene.add(this.cacheMesh);

    this.cacheGlow = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({
        map: this.glowTex, color: 0x9fe8ff, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }), this.CACHEN);
    this.cacheGlow.frustumCulled = false;
    this.cacheGlow.count = 0;
    this.scene.add(this.cacheGlow);

    // Health bars. Two instanced billboards: a dark backing and a coloured
    // fill whose geometry is offset so scaling X grows it from the LEFT.
    this.HPN = 160;
    const barGeo = () => new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
    this.hpBack = new THREE.InstancedMesh(barGeo(),
      new THREE.MeshBasicMaterial({ color: 0x101319, transparent: true, opacity: 0.72,
        depthWrite: false, depthTest: false }), this.HPN);
    this.hpFill = new THREE.InstancedMesh(barGeo(),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95,
        depthWrite: false, depthTest: false }), this.HPN);
    this.hpFill.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.HPN * 3), 3);
    for (const m of [this.hpBack, this.hpFill]) {
      m.frustumCulled = false; m.count = 0; m.renderOrder = 6;
      this.scene.add(m);
    }

    // Build grid. Shown the moment a ward is picked: without it you are
    // guessing where placement is legal, which was the single most common
    // complaint after the first playtest.
    this.GRIDN = 420;
    // OUTLINES, not filled quads. A 30%-opacity green fill over a warm lit
    // floor is invisible — which is how the first version shipped a build grid
    // that technically rendered 204 cells and told the player nothing.
    const cellOutline = assemble([
      { g: box(CELL * 0.9, 0.04, 0.13), z: CELL * 0.45 },
      { g: box(CELL * 0.9, 0.04, 0.13), z: -CELL * 0.45 },
      { g: box(0.13, 0.04, CELL * 0.9), x: CELL * 0.45 },
      { g: box(0.13, 0.04, CELL * 0.9), x: -CELL * 0.45 },
    ]);
    this.gridMesh = new THREE.InstancedMesh(
      cellOutline,
      new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.9, depthWrite: false,
      }), this.GRIDN);
    this.gridMesh.frustumCulled = false;
    this.gridMesh.count = 0;
    this.gridMesh.renderOrder = 1;
    this.gridMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.GRIDN * 3), 3);
    this.scene.add(this.gridMesh);

    // A sword arc. Appears on the swing and sweeps through the strike, so a
    // melee hit has a visible shape rather than just a number leaving a foe.
    this.arc = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 2.6, 22, 1, -0.85, 1.7).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xffeab0, transparent: true, opacity: 0, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
    this.arc.visible = false;
    this.arc.renderOrder = 4;
    this.scene.add(this.arc);

    // ward range ring, shown while placing
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x7fe08a, transparent: true, opacity: 0.6,
        side: THREE.DoubleSide, depthWrite: false,
      }));
    this.ring.visible = false;
    this.scene.add(this.ring);

    // A second ring for a ward you are standing next to or pointing at, so
    // "what does this actually cover?" is answerable without selling it and
    // placing it again.
    this.inspectRing = new THREE.Mesh(
      new THREE.RingGeometry(0.955, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x9fc8ff, transparent: true, opacity: 0.4,
        side: THREE.DoubleSide, depthWrite: false,
      }));
    this.inspectRing.visible = false;
    this.scene.add(this.inspectRing);
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

  // `shakeScale` is the player's dial; `calm` is the accessibility switch that
  // takes the top off everything sudden. Both land here so no call site has to
  // know about either.
  addShake(v) {
    if (!this.allowShake) return;
    const k = (this.shakeScale == null ? 1 : this.shakeScale) * (this.calm ? 0.35 : 1);
    this.shake = Math.min(1.5, this.shake + v * k);
  }

  // ------------------------------------------------------------------ juice
  // Shockwaves. A flat expanding ring on the ground reads as force in a way a
  // particle spray does not — the spray says "something broke", the ring says
  // "something LANDED". Pooled and reused, because allocating a mesh on a hit
  // is how a game stutters exactly when it should feel best.
  //
  // They do not depth-test. Behind a chase camera the contact point is often
  // behind the player's own body, and a ring you cannot see is a ring that did
  // not happen. See [[impact-fx-must-not-depth-test]].
  _buildShocks() {
    this.shocks = [];
    const geo = new THREE.RingGeometry(0.87, 1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      m.visible = false;
      m.renderOrder = 12;
      this.scene.add(m);
      this.shocks.push({ mesh: m, life: 0, max: 1, r0: 1, r1: 4, tilt: 0 });
    }
    this._shockN = 0;
  }

  // r0 -> r1 over `dur`, fading as it goes. `tilt` lets a wall impact stand the
  // ring up so it reads on a vertical surface instead of sinking into the floor.
  shock(x, y, z, color, r0, r1, dur, tilt) {
    const s = this.shocks[this._shockN];
    this._shockN = (this._shockN + 1) % this.shocks.length;
    s.life = s.max = dur || 0.42;
    s.r0 = r0; s.r1 = r1;
    s.mesh.position.set(x, y, z);
    s.mesh.rotation.set(tilt || 0, Math.random() * 3, 0);
    s.mesh.material.color.setHex(color);
    s.mesh.visible = true;
  }

  _stepShocks(dt) {
    for (const s of this.shocks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; s.mesh.material.opacity = 0; continue; }
      const k = 1 - s.life / s.max;
      // ease-out: fast at the front, so it snaps rather than inflates
      const e = 1 - Math.pow(1 - k, 2.6);
      const r = s.r0 + (s.r1 - s.r0) * e;
      s.mesh.scale.set(r, 1, r);
      s.mesh.material.opacity = (1 - k) * 0.52;
    }
  }

  // The sword's arc. A ribbon swept through the swing rather than a static
  // crescent: frame data says where the blade IS, and the trail is the record
  // of where it has BEEN, which is the part the eye reads as speed.
  _buildTrail() {
    const N = 14;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    this.trail = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: 0xfff2cc, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 11;
    this.scene.add(this.trail);
    this._trailPts = [];
    this._trailN = N;
  }

  // Called each frame while a swing is live. `k` is 0..1 through the arc.
  pushTrail(x, y, z, yaw, k, reach) {
    this._trailLive = true;
    const sweep = -1.15 + k * 2.3;                 // the arc the blade travels
    const a = yaw + sweep;
    this._trailPts.unshift({
      ix: x + Math.sin(a) * reach * 0.42, iy: y + 0.15,
      iz: z + Math.cos(a) * reach * 0.42,
      ox: x + Math.sin(a) * reach, oy: y + 0.5, oz: z + Math.cos(a) * reach,
    });
    if (this._trailPts.length > this._trailN) this._trailPts.length = this._trailN;
  }

  _stepTrail(dt) {
    const pts = this._trailPts;
    if (!pts.length) {
      this.trail.material.opacity = Math.max(0, this.trail.material.opacity - dt * 6);
      if (this.trail.material.opacity <= 0) this.trail.visible = false;
      return;
    }
    this.trail.visible = true;
    this.trail.material.opacity = 0.62;
    const pos = this.trail.geometry.attributes.position;
    for (let i = 0; i < this._trailN; i++) {
      const p = pts[Math.min(i, pts.length - 1)];
      // taper the ribbon toward the tail so it reads as a wake, not a blade
      const t = 1 - i / this._trailN;
      pos.setXYZ(i * 2, p.ix, p.iy, p.iz);
      pos.setXYZ(i * 2 + 1,
        p.ix + (p.ox - p.ix) * t, p.iy + (p.oy - p.iy) * t, p.iz + (p.oz - p.iz) * t);
    }
    pos.needsUpdate = true;
    // The tail only retires once the swing is OVER. Draining every frame — as
    // this first did — cancelled the push and the ribbon never grew past one
    // segment, so the effect existed and was invisible.
    if (!this._trailLive) pts.pop();
    this._trailLive = false;
  }



  // --------------------------------------------------------------- wards
  // ONE RULE: silhouette by role, so two wards can never be confused at a
  // glance — least of all from the overhead build camera, where everything is
  // seen from above and colour is most of what is left.
  //
  //   Palisade   a WALL      — flat-on, wide, vertical stakes
  //   Ballista   LOW         — a wide, heavy, obviously mechanical engine
  //   Watchtower TALL        — the tallest thing you own, on legs
  //   Caltrops   FLAT        — no vertical mass at all, scattered on the dirt
  //
  // And each shows its function while idle: the ballista's arms are drawn and
  // a bolt is loaded, the watchtower's archer is scanning, the caltrops glint.
  _wardMesh(def) {
    const iron = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.55,
      flatShading: true,
    });
    const timber = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.95, flatShading: true,
    });
    const W = 0x6b4a2f, WD = 0x503522, IR = 0x707a8c, ID = 0x4d5666;
    const g = new THREE.Group();

    if (def.id === 'palisade') {
      // a WALL: sharpened stakes, lashed, leaning into whatever is coming
      const parts = [];
      for (let i = -2; i <= 2; i++) {
        const h = 2.2 + (i % 2 ? 0.18 : 0);
        parts.push({ g: box(0.34, h, 0.34), x: i * 0.42, y: h / 2, rz: i * 0.03, c: i % 2 ? W : WD });
        parts.push({ g: box(0.34, 0.30, 0.34), x: i * 0.42, y: h + 0.12, rz: i * 0.03, c: 0x8a6a44 });
      }
      parts.push({ g: box(2.2, 0.20, 0.22), y: 1.62, z: 0.20, c: WD });
      parts.push({ g: box(2.2, 0.20, 0.22), y: 0.80, z: 0.20, c: WD });
      parts.push({ g: box(0.20, 1.5, 0.20), x: 0.7, y: 0.75, z: 0.5, rx: 0.6, c: WD });
      parts.push({ g: box(0.20, 1.5, 0.20), x: -0.7, y: 0.75, z: 0.5, rx: 0.6, c: WD });
      const m = new THREE.Mesh(assemble(parts), timber);
      m.castShadow = !this.low;
      g.add(m);

    } else if (def.id === 'ballista') {
      // LOW and WIDE: a heavy engine on a splayed frame, arms drawn, loaded
      const base = new THREE.Mesh(assemble([
        { g: box(2.3, 0.30, 1.9), y: 0.15, c: WD },
        { g: box(0.34, 0.66, 0.34), x: 0.85, y: 0.4, rz: 0.30, c: W },
        { g: box(0.34, 0.66, 0.34), x: -0.85, y: 0.4, rz: -0.30, c: W },
        { g: box(0.30, 0.30, 1.7), y: 0.44, c: W },
        { g: box(0.5, 0.34, 0.5), y: 0.66, c: ID },
      ]), timber);
      base.castShadow = !this.low;
      g.add(base);

      const head = new THREE.Mesh(assemble([
        { g: box(0.40, 0.26, 1.9), c: W },                          // stock
        { g: box(0.24, 0.20, 0.5), z: -0.9, c: ID },                // butt
        { g: box(2.7, 0.16, 0.16), z: 0.30, c: ID },                // bow arms
        { g: box(0.22, 0.22, 0.5), x: 1.28, z: 0.14, rz: 0.5, c: W },
        { g: box(0.22, 0.22, 0.5), x: -1.28, z: 0.14, rz: -0.5, c: W },
        { g: box(0.10, 0.10, 1.5), z: 0.62, c: 0xd8c9a8 },          // loaded bolt
        { g: box(0.22, 0.06, 0.22), z: 1.30, c: 0xe8e0cc },
        { g: box(1.9, 0.05, 0.05), z: -0.10, c: 0x2a2a2a },         // drawn string
      ]), iron);
      head.position.y = 0.86;
      head.castShadow = !this.low;
      g.add(head);
      g.userData.head = head;

    } else if (def.id === 'archers') {
      // TALL: legs, a deck at 3.4m, a rail, and an archer above everything
      const legs = new THREE.Mesh(assemble([
        { g: box(0.24, 3.4, 0.24), x: 0.62, y: 1.7, z: 0.62, rz: 0.05, c: WD },
        { g: box(0.24, 3.4, 0.24), x: -0.62, y: 1.7, z: 0.62, rz: -0.05, c: WD },
        { g: box(0.24, 3.4, 0.24), x: 0.62, y: 1.7, z: -0.62, rz: 0.05, c: WD },
        { g: box(0.24, 3.4, 0.24), x: -0.62, y: 1.7, z: -0.62, rz: -0.05, c: WD },
        { g: box(1.7, 0.16, 0.16), y: 1.2, z: 0.62, c: W },
        { g: box(1.7, 0.16, 0.16), y: 2.2, z: -0.62, c: W },
        { g: box(0.16, 1.6, 0.16), x: 0.62, y: 1.6, z: 0, rx: 0.7, c: W },
      ]), timber);
      legs.castShadow = !this.low;
      g.add(legs);

      const deck = new THREE.Mesh(assemble([
        { g: box(1.9, 0.22, 1.9), y: 3.5, c: W },
        { g: box(2.0, 0.44, 0.16), y: 3.86, z: 0.9, c: WD },
        { g: box(2.0, 0.44, 0.16), y: 3.86, z: -0.9, c: WD },
        { g: box(0.16, 0.44, 2.0), y: 3.86, x: 0.9, c: WD },
        { g: box(0.16, 0.44, 2.0), y: 3.86, x: -0.9, c: WD },
      ]), timber);
      deck.castShadow = !this.low;
      g.add(deck);

      const archer = new THREE.Mesh(assemble([
        { g: box(0.40, 0.52, 0.30), y: 3.92, c: 0x4a5a6e },
        { g: box(0.46, 0.14, 0.34), y: 4.22, c: 0x39465a },
        { g: box(0.30, 0.28, 0.30), y: 4.40, c: 0xc0a688 },
        { g: box(0.34, 0.12, 0.32), y: 4.50, c: 0x39465a },
        { g: box(0.10, 1.0, 0.10), x: 0.30, y: 4.02, rz: 0.18, c: 0x6b4a2f },
        { g: box(0.05, 0.9, 0.05), x: 0.36, y: 4.02, c: 0x1e1e1e },
        { g: box(0.16, 0.16, 0.34), x: -0.26, y: 3.98, z: 0.16, c: 0x8a6a44 },
      ]), new THREE.MeshStandardMaterial({
        color: 0xffffff, vertexColors: true, roughness: 0.85, flatShading: true,
      }));
      archer.castShadow = !this.low;
      g.add(archer);
      g.userData.head = archer;

    } else if (def.id === 'caltrops') {
      // FLAT: nothing stands up. A scatter of iron on the dirt that glints.
      const spikes = [];
      const rng = makeRng(7);
      for (let i = 0; i < 26; i++) {
        const a = rng() * Math.PI * 2;
        const r = rng() * 1.5;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const s = 0.13 + rng() * 0.09;
        // each caltrop is a little jack: three crossed spikes, one always up
        spikes.push({ g: box(s * 2.6, s * 0.34, s * 0.34), x, y: s * 0.5, z, ry: rng() * 3, c: IR });
        spikes.push({ g: box(s * 0.34, s * 0.34, s * 2.6), x, y: s * 0.5, z, ry: rng() * 3, c: ID });
        spikes.push({ g: box(s * 0.30, s * 1.7, s * 0.30), x, y: s * 1.1, z, c: 0x9aa6ba });
      }
      const m = new THREE.Mesh(assemble(spikes), new THREE.MeshStandardMaterial({
        color: 0xffffff, vertexColors: true, roughness: 0.32, metalness: 0.8,
        flatShading: true,
      }));
      g.add(m);
      // a scuffed patch of ground, so the covered area is legible from above
      const patch = new THREE.Mesh(
        new THREE.CircleGeometry(def.range * 0.92, 16).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0x8a94a8, transparent: true, opacity: 0.14, depthWrite: false,
        }));
      patch.position.y = 0.28;
      g.add(patch);
      g.userData.patch = patch;
    }
    return g;
  }

  syncWards(world, dt) {
    const seen = new Set();
    for (const w of world.wards) {
      if (w.dead) continue;
      seen.add(w.id);
      let v = this.wardViews.get(w.id);
      if (!v) {
        v = this._wardMesh(w.def);
        const tint = [];
        v.traverse(o => { if (o.material && o.material.color && !o.material.map) tint.push(o.material.clone()); });
        // clone materials per ward, or tinting one wears down all of them
        let ti = 0;
        v.traverse(o => { if (o.material && o.material.color && !o.material.map) o.material = tint[ti++]; });
        v.userData.tintable = tint;
        const pen = new THREE.Mesh(assemble([
          { g: box(0.09, 1.5, 0.09), y: 0.75, c: 0x4a3a2c },
          { g: box(0.05, 0.42, 0.72), x: 0.02, y: 1.28, z: 0.36, c: 0xb03a3a },
        ]), new THREE.MeshStandardMaterial({
          color: 0xffffff, vertexColors: true, roughness: 0.9, flatShading: true,
        }));
        pen.position.set(0.55, 0.9, -0.35);
        pen.visible = false;
        v.add(pen);
        v.userData.pennant = pen;
        v.position.set(w.x, groundY(w.x, w.z), w.z);
        v.rotation.y = w.rot || 0;
        this.scene.add(v);
        this.wardViews.set(w.id, v);
        this.spark(w.x, 0.6, w.z, 0x7fe08a, 14, 5, 1.1);
      }
      // Under construction: rise out of the ground. Everything else about the
      // ward is already correct, so the animation is just the reveal.
      if (w.buildT > 0) {
        const k = 1 - w.buildT / w.buildTotal;
        v.scale.y = 0.08 + 0.92 * k;
        v.scale.x = v.scale.z = 0.7 + 0.3 * k;
        v.rotation.z = (1 - k) * 0.07 * Math.sin(this.t * 22);   // judder
        if (Math.random() < dt * 26) {
          this.spark(w.x + (Math.random() - 0.5) * 1.4, 0.25 + k * 1.4,
            w.z + (Math.random() - 0.5) * 1.4, 0xd8b070, 1, 2.4, 0.7, -5);
        }
        continue;
      }
      // Level shows as MASS: an upgraded ward is visibly bigger and squarer.
      const lv = (w.level || 1) - 1;
      const grow = 1 + lv * 0.13;
      v.scale.x = v.scale.z = grow;

      // Condition shows as a lean and a sink, and — the part that was missing —
      // as COLOUR. A ward at a tenth of its hit points looked identical to a
      // fresh one apart from being slightly shorter.
      const f = w.hp / w.maxHp;
      v.scale.y = (0.62 + 0.38 * f) * grow;
      v.rotation.z = (w.rot ? 0 : 1) * (1 - f) * 0.1 + Math.sin(this.t * 1.2 + w.id) * (1 - f) * 0.03;
      if (v.userData.tintable) {
        for (const m of v.userData.tintable) {
          if (!m.userData.baseCol) m.userData.baseCol = m.color.getHex();
          _c.setHex(m.userData.baseCol);
          // scorch and grey as it is worn down; brighten a little per level
          _c.multiplyScalar(0.45 + 0.55 * f).lerp(new THREE.Color(0xffe0a0), lv * 0.12);
          m.color.copy(_c);
        }
      }
      // smoke and embers off a ward that is nearly gone
      if (f < 0.35 && Math.random() < dt * (1 - f) * 14) {
        this.spark(w.x + (Math.random() - 0.5) * 1.2, 0.8 + Math.random(),
          w.z + (Math.random() - 0.5) * 1.2, f < 0.18 ? 0xff7a3a : 0x6b6055,
          1, 1.4, 0.8, -1.2);
      }
      // a pennant once it is fully upgraded, so a maxed ward is unmistakable
      if (v.userData.pennant) v.userData.pennant.visible = w.level >= 3;
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
      if (world.player.repairing === w && Math.random() < dt * 30) {
        const p = world.player;
        const k = Math.random();
        this.spark(p.x + (w.x - p.x) * k, 1.1 + Math.sin(k * 3.1) * 0.5,
          p.z + (w.z - p.z) * k, 0x8fe8a0, 1, 1.2, 0.6, -0.6);
      }

      const patch = v.userData.patch;
      if (patch) {
        // brightens while something is actually crawling through it
        const busy = world.foes.some(f => !f.dead && !f.def.flying &&
          Math.hypot(f.x - w.x, f.z - w.z) < w.def.range);
        const want = busy ? 0.30 : 0.12;
        patch.material.opacity += (want - patch.material.opacity) * Math.min(1, dt * 5);
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

  // The title-screen camera. A slow orbit of the hearth, well back and high
  // enough to take in the treeline — the menu's job is to show the place you
  // are about to defend, so the clearing IS the art. Handed the same fireflies
  // and ward sync as a live frame, because a still background looks like a
  // screenshot and a moving one looks like a world.
  menuFrame(world, dt) {
    this.t += dt;
    this._menuA = (this._menuA || 0) + dt * 0.055;
    const a = this._menuA;
    // Close in. A wide shot of the clearing reads as empty grass; the fire has
    // to be the biggest warm thing in the frame for the menu to feel like a
    // place rather than a backdrop.
    const r = 17 + Math.sin(a * 0.7) * 2.4;
    this.camera.position.set(Math.cos(a) * r, 7.6 + Math.sin(a * 0.9) * 1.1, Math.sin(a) * r);
    this.camera.lookAt(0, 2.2, 0);
    // The menu column owns the left of the frame, so yaw the camera left to
    // push the fire and the knight into the half that is actually visible.
    this.camera.rotateY(0.26);

    // The knight stands at the fire while the menu is up. He is placed here
    // rather than by update(), which does not run before the fire is lit — so
    // without this the one character in the game is absent from its own title
    // screen.
    if (this.player) {
      this.player.visible = true;
      this.player.position.set(3.4, groundY(3.4, 4.4), 4.4);
      this.player.rotation.y = Math.PI + Math.sin(a * 0.9) * 0.25;
    }

    this._stepFireflies();
    this.syncWards(world, dt);
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ frame
  update(world, dt, input) {
    this.t += dt;
    const p = world.player;

    // --- camera: chase, high, smoothed. Yaw is the player's to steer.
    // The two cameras are blended rather than switched, so entering and
    // leaving the build view is a move you can follow rather than a cut.
    const want = this.overhead ? 1 : 0;
    this.ohBlend += (want - this.ohBlend) * Math.min(1, dt * 6.5);
    if (this.ohBlend < 0.001) this.ohBlend = 0;
    if (this.ohBlend > 0.999) this.ohBlend = 1;
    const ob = this.ohBlend * this.ohBlend * (3 - 2 * this.ohBlend);   // smoothstep

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

    // fold the overhead camera in over the top of the chase result
    if (ob > 0) {
      const oh = this.ohTarget;
      const ox = oh.x, oz = oh.z + this.ohHeight * 0.38;
      this._camPos.x += (ox - this._camPos.x) * ob;
      this._camPos.y += (this.ohHeight - this._camPos.y) * ob;
      this._camPos.z += (oz - this._camPos.z) * ob;
      this._camLook.x += (oh.x - this._camLook.x) * ob;
      this._camLook.z += (oh.z - this._camLook.z) * ob;
      this._camLook.y += (0 - this._camLook.y) * ob;
    }

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
    this.key.intensity = (this.theme === 'forest' ? 70 : 95) * pulse +
      (this.theme === 'forest' ? 170 : 250) * sf * pulse;
    // floor is 0.62 so the room stays readable even at zero stone health
    this.hemi.intensity = (this.theme === 'forest' ? 0.42 : 0.34) + 0.34 * sf;
    if (!this.flames) this.crystal.material.emissiveIntensity = (0.7 + 2.2 * sf) * pulse;
    if (this.flames) {
      for (let i = 0; i < this.flames.length; i++) {
        const fl = this.flames[i];
        fl.mesh.rotation.y += dt * fl.spin;
        const flick = 0.82 + Math.sin(this.t * (8 + i * 4) + i * 2) * 0.13 + Math.random() * 0.07;
        fl.mesh.scale.set(flick, (0.7 + 0.55 * sf) * flick, flick);
        fl.mesh.position.y = fl.base * (0.55 + 0.5 * sf);
        fl.mesh.visible = sf > 0.02 || i === 0;
      }
    } else {
      this.crystal.rotation.y += dt * 0.5;
      this.crystal.rotation.x = Math.sin(this.t * 0.7) * 0.12;
    }
    if (!this.flames) this.crystal.position.y = 3.5 + Math.sin(this.t * 1.4) * 0.16;
    if (this.crystalShell && !this.flames) {
      this.crystalShell.position.y = this.crystal.position.y;
      this.crystalShell.rotation.y -= dt * 0.34;
      this.crystalShell.rotation.z += dt * 0.16;
      this.crystalShell.material.opacity = 0.06 + 0.16 * sf;
    }
    this.stoneGlow.material.opacity = (0.20 + 0.40 * sf) * pulse;
    const gs = 8 + 6 * sf;
    this.stoneGlow.scale.set(gs, gs, 1);
    // as it dies the light goes cold
    _c.setHex(this.flames ? 0xff9a3c : PAL.stone)
      .lerp(new THREE.Color(this.flames ? 0x6a3a20 : 0x4466aa), 1 - sf);
    this.key.color.copy(_c);
    if (!this.flames) this.crystal.material.emissive.copy(_c);

    // --- player
    if (p.alive) {
      const rig = this.playerRig;
      this.player.visible = true;
      // p.y is the jump. Without adding it the whole arc is invisible and the
      // jump reads as a cooldown that does nothing.
      this.player.position.set(p.x, groundY(p.x, p.z) + p.y, p.z);
      this.player.rotation.y = p.yaw;

      // gait from ground covered, same rule as the foes
      const pdx = p.x - (this._px == null ? p.x : this._px);
      const pdz = p.z - (this._pz == null ? p.z : this._pz);
      this._px = p.x; this._pz = p.z;
      const stride = Math.hypot(pdx, pdz);
      rig.gait += stride * 2.3;
      const sw = Math.sin(rig.gait);
      const speedK = Math.min(1, stride * 90);        // damp the swing at a walk

      rig.legL.rotation.x = sw * 0.85 * speedK;
      rig.legR.rotation.x = -sw * 0.85 * speedK;
      rig.armL.rotation.x = -sw * 0.55 * speedK;
      rig.armR.rotation.x = sw * 0.45 * speedK;
      const baseY = groundY(p.x, p.z) + p.y;
      this.player.position.y = baseY + Math.abs(sw) * 0.055 * speedK;
      rig.cape.rotation.x = -0.10 - speedK * 0.22;

      // the swing: a fast forward chop that overrides the walk on the arm
      if (p.swingT > 0) {
        const k = 1 - (p.swingT / 0.18);
        rig.armR.rotation.x = -1.5 + k * 2.6;
        rig.armR.rotation.z = 0.4 - k * 0.5;
      } else {
        rig.armR.rotation.z = 0;
      }
      // airborne: legs tuck at the top, then reach for the ground on the way
      // down, so the arc reads as a jump rather than a float
      if (p.y > 0.02) {
        const rising = p.vy > 0;
        const tuck = rising ? -1.0 : -0.35;
        rig.legL.rotation.x = tuck; rig.legR.rotation.x = tuck * 0.7;
        rig.armL.rotation.x = rising ? -0.9 : -0.3;
        rig.cape.rotation.x = -0.45;
      }
      // the roll: tuck and spin
      if (p.dodgeT > 0) {
        const k = 1 - (p.dodgeT / PLAYER.dodge.time);
        this.player.position.y = baseY + Math.sin(k * Math.PI) * 0.45;
        rig.body.rotation.x = k * Math.PI * 2;
        rig.legL.rotation.x = -1.2; rig.legR.rotation.x = -1.2;
      } else {
        rig.body.rotation.x = 0;
      }

      // the arc follows the swing and fades out over it
      if (p.swingT > 0) {
        const k = 1 - (p.swingT / 0.18);
        this.arc.visible = true;
        this.arc.position.set(p.x, 0.9, p.z);
        this.arc.rotation.y = -p.yaw + Math.PI / 2;
        const sc = 0.7 + k * 0.55;
        this.arc.scale.set(sc, 1, sc);
        this.arc.material.opacity = 0.34 * (1 - k) + 0.05;
        // and the ribbon records where the blade has BEEN, which is the part
        // the eye reads as speed. Only while a sword is actually out.
        if (p.weapon === 'sword') this.pushTrail(p.x, 1.0, p.z, p.yaw, k, 2.8);
      } else {
        this.arc.visible = false;
      }

      // braced: shield up and across, body turned behind it
      if (p.blocking) {
        rig.armL.rotation.x = -1.15;
        rig.armL.rotation.z = -0.55;
        rig.body.rotation.y = 0.35;
        rig.armR.rotation.x = 0.5;
      } else {
        rig.armL.rotation.z = 0;
        rig.body.rotation.y = 0;
      }
      rig.shield.visible = p.weapon === 'sword';

      rig.sword.visible = p.weapon === 'sword';
      rig.bow.visible = p.weapon === 'crossbow';
      // embers rising off you while you warm at the fire
      if (p.warming && Math.random() < dt * 22) {
        this.spark(p.x + (Math.random() - 0.5) * 1.3, 0.5 + Math.random() * 1.4,
          p.z + (Math.random() - 0.5) * 1.3, 0xffc074, 1, 1.6, 0.8, -1.4);
      }
      rig.mat.emissiveIntensity = p.warming ? 1.1 : p.hurtT > 0 ? 2.4
        : (p.invuln > 0 ? 1.4 : 0.35);
      this.lantern.position.set(p.x + Math.sin(p.yaw + 1.2) * 0.6, 1.55,
        p.z + Math.cos(p.yaw + 1.2) * 0.6);
      this.lanternGlow.position.copy(this.lantern.position);
      this.lantern.intensity = 9.5 + Math.sin(this.t * 7) * 1.4;
    } else {
      this.player.visible = false;
      this.lantern.intensity = 0;
      this.lanternGlow.position.set(0, -50, 0);
    }

    // --- foes
    const counts = { husk: 0, runner: 0, wisp: 0, breaker: 0 };
    let wg = 0;
    const crowd = this._crowdOffsets(world);
    for (const f of world.foes) {
      if (f.dead) continue;
      const slot = this.foeMeshes[f.kind];
      const i = counts[f.kind];
      if (i >= slot.cap) continue;
      counts[f.kind] = i + 1;

      const ang = Math.atan2(f.x - (f.px == null ? f.x - 0.01 : f.px),
        f.z - (f.pz == null ? f.z - 0.01 : f.pz));
      f.px = f.x; f.pz = f.z;

      // Ground foes stand on the visible floor; fliers keep their own altitude,
      // measured from it so a wisp over a track is as high as one over grass.
      const co = crowd.get(f.id);
      const fx = f.x + (co ? co.dx : 0);
      const fz = f.z + (co ? co.dz : 0);
      const gy = groundY(fx, fz);
      let y = f.y + gy;
      let lean = 0, sc = 1, lunge = 0;
      // The gait phase advances with GROUND COVERED, not with the clock, so a
      // foe held at a wall stops stepping instead of jogging on the spot.
      const gdx = f.x - (f.gx == null ? f.x : f.gx);
      const gdz = f.z - (f.gz == null ? f.z : f.gz);
      f.gx = f.x; f.gz = f.z;
      f.gait = (f.gait || (f.id % 6)) + Math.hypot(gdx, gdz) * 2.6;
      if (f.def.flying) {
        y = f.y + Math.sin(this.t * 3.4 + f.id) * 0.28;
        // the same three beats as everything on the ground: rear up through
        // the windup, dive on the blow, drift back. A hovering wisp that only
        // bobbed read as frozen even while it was eating the fire.
        if (f.windT > 0) {
          const k = 1 - f.windT / WINDUP;
          y += k * 0.85;
          lunge = -0.3 * k;
          sc = 1 + k * 0.10;
        } else if (f.targetKind === 'stone') {
          const since = f.def.attackCd - f.atkCd;
          const k = Math.max(0, 1 - since / 0.22);
          y -= k * 0.75;
          lunge = 0.55 * k;
          sc = 1 + k * 0.07;
        }
      } else {
        const ph = f.gait;
        const walking = f.targetKind == null;
        if (walking) {
          lean = Math.sin(ph) * 0.05;
        } else {
          // Three readable beats instead of a bob: rear BACK through the
          // windup, snap forward on the blow, then settle. The windup is the
          // part the player is meant to react to, so it is the slow one.
          if (f.windT > 0) {
            const k = 1 - f.windT / WINDUP;          // 0 -> 1 across the windup
            lean = 0.80 * k;                          // rocked right back, weapon up
            lunge = -0.45 * k;
            sc = 1 + k * 0.12;
          } else {
            const since = f.def.attackCd - f.atkCd;
            const k = Math.max(0, 1 - since / 0.22);  // 1 -> 0 just after the blow
            lean = -1.15 * k;                         // thrown bodily forward
            lunge = 1.05 * k;
            sc = 1 + k * 0.08;
          }
        }
        // recoil: a squash-and-stretch punch on the frame a hit lands
        if (f.hitT > 0) {
          const hk = f.hitT / 0.1;
          sc *= 1 + hk * 0.13;
          lean += hk * 0.16;
        }
      }
      // 'YXZ': yaw FIRST, then pitch in the rotated frame. With the default
      // XYZ order the pitch is applied in world space after the yaw, so a foe
      // walking east "leans" sideways instead of forward and the whole attack
      // animation reads as a wobble. See [[world-space-tests-cannot-see-inverted-controls]].
      _q.setFromEuler(new THREE.Euler(lean, ang, 0, 'YXZ'));
      _s.set(sc, sc, sc);
      // lunge is along the foe's own facing, so a strike visibly travels
      const lx = f.def.flying && f.faceX != null ? f.faceX : Math.sin(ang);
      const lz = f.def.flying && f.faceZ != null ? f.faceZ : Math.cos(ang);
      _m.compose(_v.set(fx + lx * lunge, y, fz + lz * lunge), _q, _s);
      slot.mesh.setMatrixAt(i, _m);
      // capped well below 1: a full-white flash erases the silhouette colour
      slot.flash.array[i] = f.hitT > 0 ? Math.min(0.55, f.hitT * 5.5) : 0;
      slot.phase.array[i] = f.def.flying ? 0 : (f.gait || 0);
      // the whole swing arc as one number, straight from the sim
      slot.swing.array[i] = f.swingK || 0;
      // a lit fuse pushes the telegraph channel hard, so the one foe you
      // must deal with NOW is the brightest thing on the field
      slot.tele.array[i] = f.fuseT > 0
        ? 0.5 + 0.5 * Math.abs(Math.sin(this.t * 26))
        : (f.windT > 0 ? (1 - f.windT / WINDUP) * 0.9 : 0);

      if (f.def.flying && wg < FOE_CAP.wisp) {
        _q.copy(this.camera.quaternion);
        _m.compose(_v.set(f.x, y + 0.3, f.z), _q, _s.set(1, 1, 1));
        this.wispGlow.setMatrixAt(wg++, _m);
      }
    }
    for (const id in this.foeMeshes) {
      const slot = this.foeMeshes[id];
      slot.mesh.count = counts[id];
      if (slot.outline) slot.outline.count = counts[id];
      slot.mesh.instanceMatrix.needsUpdate = true;
      slot.flash.needsUpdate = true;
      slot.phase.needsUpdate = true;
      slot.swing.needsUpdate = true;
      slot.tele.needsUpdate = true;
    }
    this.wispGlow.count = wg;
    this.wispGlow.instanceMatrix.needsUpdate = true;

    // --- health bars over anything that has been hurt (and every breaker,
    // which is worth tracking before it is hurt)
    let hb = 0;
    const hcol = this.hpFill.instanceColor.array;
    for (const f of world.foes) {
      if (f.dead || hb >= this.HPN || !this.showHpBars) continue;
      const frac = f.hp / f.maxHp;
      if (frac >= 0.999 && f.kind !== 'breaker') continue;
      const big = f.kind === 'breaker';
      const W = big ? 2.6 : 1.15, Hh = big ? 0.24 : 0.13;
      const y = f.y + f.def.height + (big ? 0.45 : 0.30);
      _q.copy(this.camera.quaternion);
      _m.compose(_v.set(f.x - W / 2, y, f.z), _q, _s.set(W, Hh, 1));
      this.hpBack.setMatrixAt(hb, _m);
      _m.compose(_v.set(f.x - W / 2, y, f.z), _q, _s.set(W * Math.max(0, frac), Hh * 0.74, 1));
      this.hpFill.setMatrixAt(hb, _m);
      // green -> amber -> red as it drops
      const cr = frac > 0.5 ? (1 - frac) * 2 : 1;
      const cg = frac > 0.5 ? 1 : frac * 2;
      hcol[hb * 3] = cr * 0.95; hcol[hb * 3 + 1] = cg * 0.9; hcol[hb * 3 + 2] = 0.28;
      hb++;
    }
    // Wards get bars too, whenever hurt or being mended. This answers two
    // complaints at once: "which wall is hurt" and "holding E feels like
    // nothing is happening" — mending is now a bar you can watch move.
    for (const wd of world.wards) {
      if (wd.dead || hb >= this.HPN) continue;
      const mending = world.player.repairing === wd;
      const frac = wd.hp / wd.maxHp;
      if (frac >= 0.999 && !mending && wd.buildT <= 0) continue;
      const building = wd.buildT > 0;
      const shown = building ? 1 - wd.buildT / wd.buildTotal : frac;
      const W = 1.7, Hh = 0.16;
      const y = 2.6 + (wd.def.id === 'archers' ? 2.6 : 0);
      _q.copy(this.camera.quaternion);
      _m.compose(_v.set(wd.x - W / 2, y, wd.z), _q, _s.set(W, Hh, 1));
      this.hpBack.setMatrixAt(hb, _m);
      _m.compose(_v.set(wd.x - W / 2, y, wd.z), _q,
        _s.set(W * Math.max(0, shown), Hh * 0.72, 1));
      this.hpFill.setMatrixAt(hb, _m);
      // amber while going up, green while being mended, else red-to-green
      if (building) { hcol[hb * 3] = 0.95; hcol[hb * 3 + 1] = 0.72; hcol[hb * 3 + 2] = 0.25; }
      else if (mending) { hcol[hb * 3] = 0.42; hcol[hb * 3 + 1] = 1.0; hcol[hb * 3 + 2] = 0.5; }
      else {
        hcol[hb * 3] = frac > 0.5 ? (1 - frac) * 2 : 1;
        hcol[hb * 3 + 1] = frac > 0.5 ? 0.85 : frac * 1.7;
        hcol[hb * 3 + 2] = 0.3;
      }
      hb++;
    }

    this.hpBack.count = hb;
    this.hpFill.count = hb;
    this.hpBack.instanceMatrix.needsUpdate = true;
    this.hpFill.instanceMatrix.needsUpdate = true;
    this.hpFill.instanceColor.needsUpdate = true;

    // a bomber with a lit fuse shows the ground it is about to take out
    let fz = 0;
    for (const f of world.foes) {
      if (f.dead || f.fuseT <= 0 || fz >= this.threatRings.length) continue;
      const m = this.threatRings[this.threatRings.length - 1 - fz];
      const b = f.def.blast;
      const k = 1 - f.fuseT / b.fuse;
      m.visible = true;
      m.position.set(f.x, 0.07, f.z);
      const sc = b.radius * (0.55 + 0.45 * k);
      m.scale.set(sc, 1, sc);
      m.material.opacity = 0.3 + 0.5 * k;
      fz++;
    }

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
    for (let i = tr; i < this.threatRings.length - fz; i++) this.threatRings[i].visible = false;

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

    // --- caches
    let ci = 0;
    const cflash = this.cacheMesh.geometry.attributes.aFlash;
    for (const c of world.caches) {
      if (c.dead || ci >= this.CACHEN) continue;
      if (c.hitT > 0) c.hitT -= dt;
      const bob = Math.sin(this.t * 1.6 + c.spin) * 0.05;
      _q.setFromEuler(new THREE.Euler(0, c.spin, 0));
      const k = 0.75 + 0.25 * (c.hp / c.maxHp);      // splinters as it breaks
      _m.compose(_v.set(c.x, bob, c.z), _q, _s.set(k, k, k));
      this.cacheMesh.setMatrixAt(ci, _m);
      cflash.array[ci] = c.hitT > 0 ? Math.min(0.6, c.hitT * 6) : 0;
      _q.copy(this.camera.quaternion);
      _m.compose(_v.set(c.x, 1.1 + bob, c.z), _q, _s.set(1, 1, 1));
      this.cacheGlow.setMatrixAt(ci, _m);
      ci++;
    }
    this.cacheMesh.count = ci;
    this.cacheGlow.count = ci;
    this.cacheMesh.instanceMatrix.needsUpdate = true;
    this.cacheGlow.instanceMatrix.needsUpdate = true;
    cflash.needsUpdate = true;

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

    // show the reach of whatever ward the player is attending to
    const insp = world.player.repairing ||
      (this._inspect && !this._inspect.dead ? this._inspect : null);
    if (insp && insp.def.range) {
      this.inspectRing.visible = true;
      this.inspectRing.position.set(insp.x, 0.34, insp.z);
      const rr = insp.def.range;
      this.inspectRing.scale.set(rr, 1, rr);
      this.inspectRing.material.opacity = 0.26 + Math.sin(this.t * 3) * 0.08;
    } else {
      this.inspectRing.visible = false;
    }

    this._stepFireflies();
    this._stepShocks(dt);
    this._stepTrail(dt);
    this.syncWards(world, dt);
    this.renderer.render(this.scene, this.camera);
  }

  // Paint every cell within reach of the player: green where this ward can go,
  // amber where something already stands, dim red where the ground refuses it.
  showBuildGrid(world, wardId, px, pz, radius) {
    const R = radius || 16;
    // Affordability asked DIRECTLY. Probing canBuild() at a fixed cell does not
    // work: it returns 'not buildable ground' first and never reaches the
    // mana/unit checks, so the dim state would never trigger.
    const def = WARD_BY_ID[wardId];
    const affordable = !!def && world.mana >= def.cost &&
      world.du + def.du <= ECON.duBudget;
    const c0 = cellOf(px - R, pz - R), c1 = cellOf(px + R, pz + R);
    let n = 0;
    const col = this.gridMesh.instanceColor.array;
    for (let i = c0.i; i <= c1.i && n < this.GRIDN; i++) {
      for (let j = c0.j; j <= c1.j && n < this.GRIDN; j++) {
        const c = cellCenter(i, j);
        if (Math.hypot(c.x - px, c.z - pz) > R) continue;
        const terrainOk = isBuildableCell(i, j);
        const occupied = !!world.wardAtCell(i, j);
        if (!terrainOk && !occupied) continue;      // don't paint the void

        // Colour by what is true of the GROUND, then dim the whole grid if the
        // player simply cannot afford this ward. Colouring by canBuild() alone
        // turns every cell red the moment the unit budget is spent, which
        // teaches nothing about where wards go — and being out of units is
        // already stated in the HUD.
        let cr, cg, cb;
        if (occupied) { cr = 1.00; cg = 0.74; cb = 0.20; }      // something there
        else if (!terrainOk) { cr = 1.00; cg = 0.24; cb = 0.20; } // refuses a ward
        else { cr = 0.24; cg = 1.00; cb = 0.38; }                // free ground
        if (!affordable) { cr *= 0.34; cg *= 0.34; cb *= 0.34; }
        _q.identity();
        _m.compose(_v.set(c.x, 0.34, c.z), _q, _s.set(1, 1, 1));
        this.gridMesh.setMatrixAt(n, _m);
        col[n * 3] = cr; col[n * 3 + 1] = cg; col[n * 3 + 2] = cb;
        n++;
      }
    }
    this.gridMesh.count = n;
    this.gridMesh.instanceMatrix.needsUpdate = true;
    this.gridMesh.instanceColor.needsUpdate = true;
  }

  hideBuildGrid() { this.gridMesh.count = 0; }

  // --------------------------------------------------------------- ghost
  showGhost(wardId, i, j, ok, rot) {
    const c = cellCenter(i, j);
    const def = WARD_BY_ID[wardId];
    const col = ok ? 0x7fe08a : 0xe0605a;
    this.ghost.visible = true;
    this.ghost.position.set(c.x, groundY(c.x, c.z) + 0.01, c.z);
    this.ghost.material.color.setHex(col);
    this.ghostPost.visible = true;
    this.ghostPost.position.set(c.x, 1.1, c.z);
    this.ghostPost.rotation.y = rot || 0;
    this.ghost.rotation.y = rot || 0;
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
    this.hideBuildGrid();
    this.ghost.visible = false;
    this.ghostPost.visible = false;
    this.ring.visible = false;
  }

  // The wall-run preview: one marker per cell the drag will actually build.
  // Pooled, and it shows the TRUE plan — the sim stops the run at the first
  // cell it cannot pay for, so what is drawn is exactly what will appear.
  _ensureRunPool(n) {
    if (!this.runMarks) { this.runMarks = []; }
    while (this.runMarks.length < n) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 2.2, 0.5),
        new THREE.MeshBasicMaterial({
          color: 0x7fe08a, transparent: true, opacity: 0.34, depthWrite: false,
        }));
      m.visible = false;
      this.scene.add(m);
      this.runMarks.push(m);
    }
  }

  showRun(cells, rot, ok) {
    this._ensureRunPool(cells.length);
    for (let k = 0; k < this.runMarks.length; k++) {
      const m = this.runMarks[k];
      if (k >= cells.length) { m.visible = false; continue; }
      const c = cellCenter(cells[k].i, cells[k].j);
      m.visible = true;
      m.position.set(c.x, 1.1, c.z);
      m.rotation.y = rot || 0;
      m.material.color.setHex(ok ? 0x7fe08a : 0xe0605a);
    }
  }

  hideRun() {
    if (!this.runMarks) return;
    for (const m of this.runMarks) m.visible = false;
  }

  // The aim marker: brackets around whatever the next shot will actually go to.
  //
  // Aim assist silently snapped to a target and the player had no way to know
  // WHICH — reported as wanting it "clearer, more clear what I will hit". The
  // marker is drawn in world space at the foe rather than as a screen reticle,
  // so it reads as "that one" rather than "somewhere near the middle".
  showAimMark(f) {
    if (!this.aimMark) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd89a, transparent: true, opacity: 0.9,
        depthTest: false, depthWrite: false,
      });
      // four corner brackets, which read at any size and never occlude the foe
      for (let i = 0; i < 4; i++) {
        const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1;
        const a = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.05), mat);
        a.position.set(sx * 0.34, sy * 0.5, 0);
        const b = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.30), mat);
        b.position.set(sx * 0.47, sy * 0.37, 0);
        g.add(a); g.add(b);
      }
      g.renderOrder = 20;
      this.aimMark = g;
      this.scene.add(g);
    }
    this.aimMark.visible = true;
    const h = f.def.height;
    this.aimMark.position.set(f.x, f.y + h * 0.55, f.z);
    const s = Math.max(0.9, h * 0.95);
    this.aimMark.scale.set(s, s, s);
    this.aimMark.quaternion.copy(this.camera.quaternion);   // always face the player
  }

  hideAimMark() { if (this.aimMark) this.aimMark.visible = false; }

  // The rally radius, shown while the player is considering it. Reuses the
  // ward inspect ring — a player who has learned that a ring means "this is
  // what it reaches" should not have to learn a second visual language for it.
  showAbilityRing(x, z, radius, ready) {
    this.abilRing = this.abilRing || (() => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.95, 1, 64).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0xffd89a, transparent: true, opacity: 0.4, depthWrite: false,
        }));
      m.visible = false;
      this.scene.add(m);
      return m;
    })();
    this.abilRing.visible = true;
    this.abilRing.position.set(x, 0.13, z);
    this.abilRing.scale.set(radius, 1, radius);
    this.abilRing.material.color.setHex(ready ? 0xffd89a : 0x6f788b);
    this.abilRing.material.opacity = 0.2 + Math.sin(this.t * 3.4) * 0.08 + (ready ? 0.16 : 0);
  }

  hideAbilityRing() { if (this.abilRing) this.abilRing.visible = false; }

  // Display-only crowd fan-out.
  //
  // A crowd pressed against a wall genuinely occupies almost one point, and the
  // sim is RIGHT to let it — separation there turned out to be a balance dial
  // that swung both maps hard in every configuration tried. But six bodies in
  // one place still reads as one goblin with too many limbs.
  //
  // So the spreading happens here, in the renderer, where it cannot affect a
  // single hit point. Foes are bucketed on a coarse grid and any bucket holding
  // more than one fans its members out around a small circle, deterministically
  // by id so nothing jitters frame to frame.
  _crowdOffsets(world) {
    const buckets = this._crowdBuckets || (this._crowdBuckets = new Map());
    const out = this._crowdOut || (this._crowdOut = new Map());
    buckets.clear();
    out.clear();
    for (const f of world.foes) {
      if (f.dead || f.def.flying) continue;
      const key = `${Math.round(f.x / CROWD_CELL)},${Math.round(f.z / CROWD_CELL)}`;
      let b = buckets.get(key);
      if (!b) { b = []; buckets.set(key, b); }
      b.push(f);
    }
    for (const b of buckets.values()) {
      if (b.length < 2) continue;
      // stable order, so a foe keeps its place in the ring while the crowd holds
      b.sort((p, q) => p.id - q.id);
      const r = Math.min(CROWD_FAN, 0.16 * b.length);
      for (let i = 0; i < b.length; i++) {
        const a = (i / b.length) * Math.PI * 2;
        out.set(b[i].id, { dx: Math.cos(a) * r, dz: Math.sin(a) * r });
      }
    }
    return out;
  }

  // Which foe is under the pointer, in SCREEN space.
  //
  // This exists because the player aims with a mouse on a 2D screen, so the
  // assist has to work there too. The old assist tested a cone in WORLD space
  // against an aim vector taken from the ground cell under the pointer — which
  // is always horizontal — so a wisp at 4.2m altitude sat ~21 degrees above the
  // aim at 8m range and failed a 12-degree cone. Wisps were unacquirable inside
  // ~14m and the bolt flew flat underneath them, which got WORSE the closer
  // they came. Screen space has no such blind spot: what looks under the
  // crosshair is under the crosshair.
  foeUnderPointer(world, sx, sy, radiusPx) {
    const el = this.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    let best = null, bestD = radiusPx == null ? 90 : radiusPx;
    for (const f of world.foes) {
      if (f.dead) continue;
      _v.set(f.x, f.y + f.def.height * 0.5, f.z).project(this.camera);
      if (_v.z > 1) continue;                       // behind the camera
      const px = (_v.x * 0.5 + 0.5) * w, py = (-_v.y * 0.5 + 0.5) * h;
      const d = Math.hypot(px - sx, py - sy);
      // fliers get a slightly more generous radius: they are small, they move
      // in three axes, and they are the one thing only the player can answer
      const r = f.def.flying ? bestD * 1.35 : bestD;
      if (d < r && d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  resize(w, h, dpr) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
