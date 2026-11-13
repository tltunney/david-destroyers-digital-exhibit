// Builds the full-length marble statue of David Copperfield and writes assets/models/copperfield.glb.
//
//   cd tools/statue && npm install && node make-statue.mjs      (about a minute on 4 cores)
//
// The figure is described as a signed distance field (for any point in space: how far is it from the
// statue's surface, negative inside). Body parts are shapes blended together with "smooth union",
// the way clay is pushed together, and cloth folds are small displacements added on top. Each part is
// meshed with naive surface nets on its own grid (fine where there is fine detail), simplified with
// meshoptimizer, given ambient occlusion baked from the field (vertex colors) and written as a
// compressed glTF (KHR_mesh_quantization + EXT_meshopt_compression).
//
// Pose and costume, from period references:
// - Dress of about 1850: knee-length frock coat with rolled lapels, waistcoat with a double watch
//   chain, high shirt collar and a cravat tied in a bow, ankle boots, top hat.
// - Victorian statues of writers stand holding a book. David becomes a novelist, so he presses a
//   book to his chest with his left hand and holds his top hat by the brim in his right.
// - Contrapposto: weight on the right leg, left knee relaxed and forward, head turned a little to
//   his left. Units are meters; feet stand on a low slab at y = 0..0.06, facing +z. His right is -x.
//
// Env: STATUE_OUT=file.glb writes elsewhere; STATUE_PARTS=head,handL meshes only some parts;
// STATUE_FAST=1 uses coarser grids for quick previews.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const OUT = process.env.STATUE_OUT || resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/models/copperfield.glb');
const FAST = process.env.STATUE_FAST ? 1.7 : 1;

// ---------------------------------------------------------------- vector and SDF helpers
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a + (b - a) * t;
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
const smax = (a, b, k) => -smin(-a, -b, k);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
// a frame {o, X, Y, Z}; local() takes a world point into it, world() back out
const local = (p, F) => {
  const d = sub(p, F.o);
  return [dot(d, F.X), dot(d, F.Y), dot(d, F.Z)];
};
const world = (F, l) => add(F.o, add(mul(F.X, l[0]), add(mul(F.Y, l[1]), mul(F.Z, l[2]))));

// rotate (x, y, z) by angles around x, then y, then z
function rot([x, y, z], rx = 0, ry = 0, rz = 0) {
  let c = Math.cos(rx);
  let s = Math.sin(rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry);
  s = Math.sin(ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz);
  s = Math.sin(rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}
// the inverse of rot()
function unrot([x, y, z], rx = 0, ry = 0, rz = 0) {
  let c = Math.cos(-rz);
  let s = Math.sin(-rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(-ry);
  s = Math.sin(-ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(-rx);
  s = Math.sin(-rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
}

function sphere(p, c, r) {
  return len3(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;
}
// approximate ellipsoid distance (good near the surface)
function ellipsoid(p, c, r, angles) {
  let q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  if (angles) q = unrot(q, ...angles);
  const k0 = len3(q[0] / r[0], q[1] / r[1], q[2] / r[2]);
  const k1 = len3(q[0] / (r[0] * r[0]), q[1] / (r[1] * r[1]), q[2] / (r[2] * r[2]));
  return k0 < 1e-9 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
}
// a capsule whose radius changes along its length (a limb segment)
function limb(p, a, b, ra, rb) {
  const pa0 = p[0] - a[0], pa1 = p[1] - a[1], pa2 = p[2] - a[2];
  const ba0 = b[0] - a[0], ba1 = b[1] - a[1], ba2 = b[2] - a[2];
  const h = clamp((pa0 * ba0 + pa1 * ba1 + pa2 * ba2) / (ba0 * ba0 + ba1 * ba1 + ba2 * ba2), 0, 1);
  return len3(pa0 - ba0 * h, pa1 - ba1 * h, pa2 - ba2 * h) - (ra + (rb - ra) * h);
}
function roundBox(p, c, half, r, angles) {
  let q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  if (angles) q = unrot(q, ...angles);
  const dx = Math.abs(q[0]) - half[0] + r;
  const dy = Math.abs(q[1]) - half[1] + r;
  const dz = Math.abs(q[2]) - half[2] + r;
  return len3(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0) - r;
}
// a cylinder along local y
function cylinder(p, c, radius, halfHeight, angles) {
  let q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  if (angles) q = unrot(q, ...angles);
  const dr = Math.hypot(q[0], q[2]) - radius;
  const dy = Math.abs(q[1]) - halfHeight;
  return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0));
}
// a ring around local y
function torus(p, c, R, r, angles) {
  let q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  if (angles) q = unrot(q, ...angles);
  return Math.hypot(Math.hypot(q[0], q[2]) - R, q[1]) - r;
}
// distance to a box (for skipping far-away parts)
function boxDist(p, min, max) {
  const dx = Math.max(min[0] - p[0], 0, p[0] - max[0]);
  const dy = Math.max(min[1] - p[1], 0, p[1] - max[1]);
  const dz = Math.max(min[2] - p[2], 0, p[2] - max[2]);
  return len3(dx, dy, dz);
}
// smooth value noise in -1..1
function hash(i, j, k) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 32767.5 - 1;
}
function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const a = mix(mix(hash(i, j, k), hash(i + 1, j, k), u), mix(hash(i, j + 1, k), hash(i + 1, j + 1, k), u), v);
  const b = mix(mix(hash(i, j, k + 1), hash(i + 1, j, k + 1), u), mix(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), u), v);
  return mix(a, b, w);
}

// ---------------------------------------------------------------- the head (approved; unchanged)
// The head is sculpted in its own frame: origin in the middle of the skull, x to his left, y up,
// z out of the face. Proportions follow the usual canon for an adult: eyes halfway between the top
// of the head and the chin, the face in three equal parts (hairline to brow, brow to the base of the
// nose, nose to chin), ears between the brow and the base of the nose, eyes one eye-width apart.
// Like Michelangelo's David, the head is made a little large because it is seen from far below.
const HEAD = { c: [0.006, 1.734, 0.022], yaw: 0.26, pitch: 0.1, scale: 1.05 };
const EYE = { x: 0.031, y: -0.01, z: 0.066, r: 0.0125 };

// distance with x mirrored, for features that come in pairs
const pair = (f) => (q) => f([Math.abs(q[0]), q[1], q[2]]);
const carve = (d, cut, k) => smax(d, -cut, k);

function face(q) {
  const m = [Math.abs(q[0]), q[1], q[2]];
  // skull and the mass of the face
  let d = ellipsoid(q, [0, 0.022, -0.012], [0.073, 0.09, 0.097]); // cranium
  d = smin(d, ellipsoid(q, [0, -0.035, 0.02], [0.056, 0.05, 0.056]), 0.03); // cheeks and upper jaw
  d = smin(d, ellipsoid(q, [0, -0.072, 0.03], [0.041, 0.038, 0.046]), 0.03); // lower face
  d = smin(d, ellipsoid(m, [0.047, -0.022, 0.045], [0.018, 0.013, 0.022]), 0.02); // cheekbones
  d = smin(d, ellipsoid(m, [0.036, -0.058, 0.048], [0.02, 0.024, 0.022]), 0.025); // full young cheeks
  d = smin(d, ellipsoid(m, [0.058, 0.0, 0.025], [0.014, 0.03, 0.035]), 0.03); // temples
  d = smin(d, limb(m, [0.05, -0.045, -0.022], [0.044, -0.084, -0.008], 0.013, 0.013), 0.025); // back of the jaw
  d = smin(d, limb(m, [0.044, -0.086, -0.006], [0.015, -0.114, 0.064], 0.012, 0.013), 0.025); // jawline
  d = smin(d, ellipsoid(q, [0, -0.11, 0.067], [0.021, 0.018, 0.02]), 0.02); // chin
  d = smin(d, ellipsoid(q, [0, -0.07, 0.058], [0.03, 0.028, 0.026]), 0.03); // around the mouth
  d = smin(d, limb(m, [0.01, 0.006, 0.085], [0.03, 0.011, 0.083], 0.0068, 0.0068), 0.016); // brow ridge, arched
  d = smin(d, limb(m, [0.03, 0.011, 0.083], [0.05, 0.005, 0.068], 0.0068, 0.005), 0.016);
  d = smin(d, ellipsoid(q, [0, 0.004, 0.082], [0.012, 0.012, 0.008]), 0.012); // between the brows

  // eye sockets, eyeballs, lids
  d = carve(d, ellipsoid(m, [EYE.x + 0.001, EYE.y + 0.001, 0.087], [0.0155, 0.0115, 0.012]), 0.012);
  d = smin(d, ellipsoid(m, [0.0095, -0.012, 0.08], [0.004, 0.011, 0.006]), 0.006); // soften the inner corners of the eyes
  const e = [m[0] - EYE.x, m[1] - EYE.y, m[2] - EYE.z];
  let eye = len3(...e) - EYE.r;
  // a shallow drilled pupil, as Victorian sculptors often carved them, so he seems to look at you
  const g = len3(e[0] + 0.0015, e[1] + 0.0005, e[2] - EYE.r); // from the front of the eye (looking a touch inward)
  eye = carve(eye, g - 0.0029, 0.0012);
  const upper = EYE.y + 0.0055 - 30 * e[0] * e[0];
  const lower = EYE.y - 0.006 + 24 * e[0] * e[0];
  const lidUp = smax(len3(...e) - (EYE.r + 0.0016), upper - m[1], 0.0015);
  const lidLow = smax(len3(...e) - (EYE.r + 0.0011), m[1] - lower, 0.0015);
  eye = smin(eye, Math.min(lidUp, lidLow), 0.0015);
  d = smin(d, eye, 0.003);

  // nose
  d = smin(d, limb([q[0] * 1.6, q[1], q[2]], [0, 0.002, 0.087], [0, -0.037, 0.102], 0.0062, 0.0086), 0.008); // bridge: narrow and straight
  d = smin(d, sphere(q, [0, -0.042, 0.0985], 0.0072), 0.01); // tip
  d = smin(d, sphere(m, [0.0098, -0.0482, 0.089], 0.0055), 0.008); // wings
  d = smin(d, ellipsoid(q, [0, -0.052, 0.096], [0.0045, 0.004, 0.008]), 0.004);
  d = carve(d, ellipsoid(m, [0.007, -0.0555, 0.093], [0.0032, 0.002, 0.0042], [0, 0, 0.3]), 0.002); // nostrils

  // mouth: lips with a slight upturn at the corners
  d = carve(d, ellipsoid(q, [0, -0.0615, 0.094], [0.0038, 0.006, 0.003]), 0.003); // groove under the nose
  for (const s of [-1, 1]) d = smin(d, ellipsoid(q, [s * 0.008, -0.0688, 0.0868], [0.013, 0.0058, 0.0072], [0, 0, s * 0.1]), 0.008); // upper lip
  d = smin(d, ellipsoid(q, [0, -0.0815, 0.0826], [0.0165, 0.0066, 0.0075]), 0.008); // lower lip
  // the lips meet in a soft crease, the upper overhanging the lower a little
  const crease = -0.0752 + 5 * q[0] * q[0];
  d += 0.0018 * Math.exp(-(((q[1] - crease) / 0.0016) ** 2)) * smoothstep(0.022, 0.012, Math.abs(q[0])) * smoothstep(0.075, 0.085, q[2]);
  d = carve(d, ellipsoid(q, [0, -0.093, 0.09], [0.014, 0.0038, 0.006]), 0.006); // under the lower lip

  // ears: tipped back a little, with a hollow inside the rim
  const ear = (p) => {
    let a = ellipsoid(p, [0.075, -0.022, -0.014], [0.009, 0.029, 0.017], [0.2, 0.25, 0]);
    a = carve(a, ellipsoid(p, [0.082, -0.026, -0.011], [0.005, 0.016, 0.009], [0.2, 0.25, 0]), 0.003);
    return a;
  };
  d = smin(d, pair(ear)(q), 0.006);
  return d;
}

// Long, thick, wavy hair parted on his left and swept across the forehead, falling over the
// tops of the ears to the collar, with short side-whiskers (after Maclise's 1839 portrait of the
// young Dickens, David's original, and Phiz's plates of the grown-up David).
function hair(q) {
  const [x, y, z] = q;
  const az = Math.atan2(x, z); // 0 = front, + = his left
  const a = Math.abs(az);
  // how far down the hair comes, going round the head
  let line =
    a < 0.5 ? 0.06 + 0.014 * az :
    a < 0.85 ? mix(0.06 + 0.007 * Math.sign(az), 0.036, (a - 0.5) / 0.35) :
    a < 1.35 ? mix(0.03, -0.03, (a - 0.85) / 0.5) :
    a < 2.3 ? mix(-0.03, -0.125, (a - 1.35) / 0.95) : -0.125;
  line -= 0.014 * Math.exp(-(((az + 0.35) / 0.3) ** 2)); // the sweep dips onto his right temple
  const grow = smoothstep(line - 0.004, line + 0.03, y);
  if (grow <= 0) return 1;

  // the mass of the hair: a cap over the skull and a fall at the back reaching the collar
  let mass = ellipsoid(q, [0, 0.016, -0.016], [0.081, 0.097, 0.103]);
  mass = smin(mass, ellipsoid(q, [0, -0.035, -0.04], [0.08, 0.085, 0.078]), 0.03);
  mass = smin(mass, ellipsoid(q, [-0.015, 0.08, -0.002], [0.055, 0.028, 0.058], [0, 0, 0.2]), 0.03); // wave on top, toward his right
  for (const s of [-1, 1]) mass = smin(mass, ellipsoid(q, [s * 0.068, -0.01, -0.032], [0.022, 0.042, 0.046]), 0.03); // over the ears

  // locks: ridges running along the direction the hair is combed, with a slow wave across them
  const n = [x / 0.09, (y - 0.018) / 0.1, (z + 0.014) / 0.106];
  const L = len3(...n) || 1;
  const front = smoothstep(0.2, 0.7, n[2] / L) * smoothstep(-0.1, 0.4, n[1] / L);
  // combed direction: across the forehead toward his right at the front, down and back elsewhere
  const F = [mix(0, -1, front), mix(-1, -0.25, front), mix(-0.35, 0, front)];
  const nn = [n[0] / L, n[1] / L, n[2] / L];
  const perp = [nn[1] * F[2] - nn[2] * F[1], nn[2] * F[0] - nn[0] * F[2], nn[0] * F[1] - nn[1] * F[0]];
  const along = x * F[0] + y * F[1] + z * F[2];
  const across = x * perp[0] + y * perp[1] + z * perp[2];
  const lock = Math.sin(across * 260 + Math.sin(along * 110) * 2);
  const waves = (0.0018 * Math.sin(along * 140 + az * 2) + 0.003 * lock) * (1 - 0.6 * front);
  const part = 0.004 * Math.exp(-(((x - 0.03) / 0.003) ** 2)) * smoothstep(0.03, 0.08, y) * smoothstep(-0.02, 0.04, z);

  const h = mass - waves + part;
  // thin out to nothing at the hairline so it meets the skin softly
  return smax(h, -(grow - 0.5) * 0.02, 0.006);
}

function whiskers(q) {
  const m = [Math.abs(q[0]), q[1], q[2]];
  return roundBox(m, [0.068, -0.02, 0.012], [0.006, 0.024, 0.008], 0.005, [0, 0.35, 0]);
}

function headAndHair(p) {
  let q = [p[0] - HEAD.c[0], p[1] - HEAD.c[1], p[2] - HEAD.c[2]];
  q = unrot(q, HEAD.pitch, HEAD.yaw, 0);
  q = [q[0] / HEAD.scale, q[1] / HEAD.scale, q[2] / HEAD.scale];
  const far = len3(q[0] / 0.1, (q[1] - 0.0) / 0.14, q[2] / 0.13);
  if (far > 1.5) return (far - 1.35) * 0.1 * HEAD.scale; // far away: cheap estimate
  let d = face(q);
  d = smin(d, whiskers(q), 0.004);
  d = smin(d, hair(q), 0.006);
  return d * HEAD.scale;
}

// The head mesh: neck, head and hair.
function headPart(p) {
  return smin(limb(p, [0, 1.44, -0.012], [0.004, 1.63, -0.01], 0.058, 0.054), headAndHair(p), 0.025);
}

// ---------------------------------------------------------------- skeleton of the pose
const S = 0.06; // top of the base slab
const J = {
  rHip: [-0.09, 0.985, 0], rKnee: [-0.082, 0.56, 0.005], rAnkle: [-0.075, 0.15, -0.02],
  lHip: [0.09, 0.958, 0.012], lKnee: [0.13, 0.55, 0.075], lAnkle: [0.168, 0.148, 0.07],
  rShoulder: [-0.19, 1.405, -0.005], rElbow: [-0.236, 1.13, -0.04],
  lShoulder: [0.192, 1.43, -0.005], lElbow: [0.252, 1.17, -0.045],
};

// ---------------------------------------------------------------- hands
// A hand is sculpted in its own frame: origin at the wrist, x toward the thumb (radial side),
// y along the hand toward the fingers, z out of the back of the hand. Each placed hand gives the
// three axes in world space, so the same code makes a left and a right hand.
// Finger knuckle positions and phalanx lengths for a large man's hand (palm ~10 cm, middle finger ~9.5 cm).
const FINGERS = [
  { base: [0.0285, 0.097, 0.0], len: [0.044, 0.026, 0.021], rad: [0.0098, 0.0089, 0.0079, 0.0069] }, // index
  { base: [0.0085, 0.101, 0.0005], len: [0.048, 0.03, 0.022], rad: [0.0101, 0.0091, 0.0081, 0.0071] }, // middle
  { base: [-0.0115, 0.0975, 0.0], len: [0.045, 0.028, 0.021], rad: [0.0096, 0.0087, 0.0077, 0.0067] }, // ring
  { base: [-0.0295, 0.089, -0.001], len: [0.035, 0.021, 0.019], rad: [0.0086, 0.0077, 0.0069, 0.0061] }, // little
];
// a finger: [spread (toward the thumb), flex at the knuckle, middle joint, end joint]
function finger(q, f, [spread, a1, a2, a3]) {
  const s = Math.sin(spread), c = Math.cos(spread);
  let P = f.base;
  let a = 0;
  let d = 1;
  const flex = [a1, a2, a3];
  for (let k = 0; k < 3; k++) {
    const prev = a;
    a += flex[k];
    const ca = Math.cos(a), sa = Math.sin(a);
    const Q = [P[0] + s * ca * f.len[k], P[1] + c * ca * f.len[k], P[2] - sa * f.len[k]];
    let seg = limb(q, P, Q, f.rad[k], f.rad[k + 1]);
    if (k === 2) {
      // the finger pad is fuller than the back, and the nail lies flat on the back of the tip
      const back = [s * sa, c * sa, ca];
      const tip = [mix(P[0], Q[0], 0.62), mix(P[1], Q[1], 0.62), mix(P[2], Q[2], 0.62)];
      const nail = dot(sub(q, tip), back) - f.rad[3] * 0.82;
      seg = smax(seg, nail, 0.003);
    }
    d = k === 0 ? seg : smin(d, seg, 0.0022);
    if (k > 0) {
      // the bony bump on the back of each joint, showing more the more it is bent
      const m = (prev + a) / 2 - flex[k] / 2;
      const back = [s * Math.sin(m + flex[k] / 2), c * Math.sin(m + flex[k] / 2), Math.cos(m + flex[k] / 2)];
      const r = f.rad[k];
      d = smin(d, sphere(q, add(P, mul(back, r * (0.25 + 0.2 * Math.min(1, flex[k])))), r * 0.78), 0.003);
    }
    P = Q;
  }
  return d;
}
function thumb(q, dirs) {
  const len = [0.043, 0.033, 0.028];
  const rad = [0.0128, 0.0108, 0.0099, 0.0086];
  let P = [0.02, 0.016, -0.007];
  let d = 1;
  for (let k = 0; k < 3; k++) {
    const dir = norm(dirs[k]);
    const Q = add(P, mul(dir, len[k]));
    const seg = limb(q, P, Q, rad[k], rad[k + 1]);
    d = k === 0 ? seg : smin(d, seg, 0.003);
    if (k > 0) d = smin(d, sphere(q, P, rad[k] * 1.04), 0.003); // joint
    P = Q;
  }
  return d;
}
function hand(q, pose) {
  const far = len3(q[0] / 0.11, (q[1] - 0.05) / 0.17, q[2] / 0.11);
  if (far > 1.7) return (far - 1.5) * 0.1;
  // forearm stub, slightly flattened, running back into the sleeve along the forearm's direction
  const F = pose.forearm;
  const fq = [q[0], q[1], q[2]];
  const wrist = limb([fq[0], fq[1], fq[2]], mul(F, -0.11), [0, 0.008, 0], 0.03, 0.0255);
  // palm: wider and thinner toward the knuckles
  const t = smoothstep(-0.005, 0.085, q[1]);
  const hw = mix(0.029, 0.0385, t);
  const ht = mix(0.0158, 0.0118, t);
  const r = 0.0105;
  const dx = Math.abs(q[0] - 0.0005) - hw + r;
  const dy = Math.abs(q[1] - 0.05) - 0.047 + r;
  const dz = Math.abs(q[2] + 0.001) - ht + r;
  let palm = len3(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0) - r;
  palm = smin(palm, wrist, 0.022);
  palm = smin(palm, ellipsoid(q, [0.02, 0.032, -0.007], [0.017, 0.03, 0.013], [0, 0, -0.5]), 0.012); // ball of the thumb
  palm = smin(palm, ellipsoid(q, [-0.026, 0.042, -0.004], [0.012, 0.034, 0.011]), 0.01); // heel of the little finger
  for (const f of FINGERS) palm = smin(palm, sphere(q, add(f.base, [0, -0.003, 0.004]), f.rad[0] * 1.02), 0.008); // knuckles
  palm = carve(palm, ellipsoid(q, [0.002, 0.058, -0.022], [0.017, 0.026, 0.009]), 0.008); // hollow of the palm
  // tendons on the back of the hand, fanning from the wrist to the knuckles
  for (const f of FINGERS.slice(0, 3)) palm = smin(palm, limb(q, [f.base[0] * 0.35, 0.015, 0.0095], add(f.base, [0, -0.012, 0.0095]), 0.0022, 0.0028), 0.006);
  let d = smin(palm, thumb(q, pose.thumb), 0.011);
  for (let i = 0; i < 4; i++) d = Math.min(d, smin(palm, finger(q, FINGERS[i], pose.fingers[i]), 0.0065));
  return d;
}

// ---------------------------------------------------------------- the book and the left hand
// The book's frame: x toward the fore-edge (his right), y up the book, z out of the front cover.
const BOOK = { W: 0.068, H: 0.101, T: 0.0185 };
const bookF = (() => {
  const Z = norm([0.3, 0.1, 1]);
  let Y = norm([-0.17, 1, 0]);
  Y = norm(sub(Y, mul(Z, dot(Y, Z))));
  const X = cross(Z, Y); // points to his right (-x): the book's frame is mirrored, which is fine for distances
  return { o: [0.064, 1.205, 0.165], X, Y, Z };
})();
function book(p) {
  const q = local(p, bookF);
  const { W, H, T } = BOOK;
  const far = boxDist(q, [-W - 0.02, -H - 0.01, -T - 0.01], [W + 0.01, H + 0.01, T + 0.01]);
  if (far > 0.01) return far;
  const [x, y, z] = q;
  // boards, overhanging the page block by a few millimeters
  const board = (zc) => roundBox(q, [0.0015, 0, zc], [W - 0.0015, H, 0.0019], 0.0012);
  let d = Math.min(board(T - 0.0019), board(-T + 0.0019));
  // the page block, its fore-edge slightly hollow as in a rounded and backed binding, with the
  // leaves showing as fine lines
  const hollow = 0.0022 * (1 - (z / T) ** 2);
  let pages = roundBox(q, [-0.001, 0, 0], [W - 0.0035 - hollow / 2, H - 0.0032, T - 0.0034], 0.0008);
  pages += 0.00025 * Math.sin(z * 2600) * smoothstep(W - 0.012, W - 0.004, Math.max(x, Math.abs(y) - H + W));
  d = Math.min(d, pages);
  // rounded spine with four raised bands
  const sx = x + W - 0.007;
  let spine = (Math.hypot(sx / 0.011, z / (T + 0.0005)) - 1) * 0.011;
  spine = Math.max(spine, Math.abs(y) - H, sx);
  for (const yb of [-0.062, -0.022, 0.018, 0.058]) spine -= 0.0016 * Math.exp(-(((y - yb) / 0.0032) ** 2)) * smoothstep(-0.004, -0.008, sx);
  d = smin(d, spine, 0.002);
  // a blind-tooled frame on the front cover
  const fx = Math.abs(x - 0.002) - (W - 0.013);
  const fy = Math.abs(y) - (H - 0.012);
  const frame = Math.abs(Math.max(fx, fy));
  if (z > 0) d += 0.0007 * Math.exp(-((frame / 0.0012) ** 2));
  return d;
}

// The left hand lies on the front cover, the fingers curling round the fore-edge, the thumb
// along the cover. Its frame is placed relative to the book's.
const LHAND = (() => {
  const { X: bx, Y: by, Z: bz } = bookF;
  // turn the hand in the plane of the cover so the knuckles of the middle joints line up on the fore-edge
  const R0 = norm(add(mul(by, 0.968), mul(bx, -0.25)));
  const D0 = norm(add(mul(by, 0.25), mul(bx, 0.968)));
  // and tip it so the heel of the hand lifts off the cover and the wrist clears the spine
  const beta = 0.2;
  const D = norm(sub(mul(D0, Math.cos(beta)), mul(bz, Math.sin(beta))));
  const Z = norm(add(mul(bz, Math.cos(beta)), mul(D0, Math.sin(beta))));
  const F = { o: [0, 0, 0], X: R0, Y: D, Z };
  // the middle finger's middle joint sits just past the fore-edge, on the cover
  const anchorHand = [0.0085, 0.149, 0];
  const anchorBook = [BOOK.W + 0.003, 0.02, BOOK.T + 0.0098];
  const aw = world(bookF, anchorBook);
  F.o = sub(aw, add(mul(F.X, anchorHand[0]), add(mul(F.Y, anchorHand[1]), mul(F.Z, anchorHand[2]))));
  return F;
})();
const lWrist = LHAND.o;
const lForearm = norm(sub(lWrist, J.lElbow));
const LPOSE = {
  forearm: [dot(lForearm, LHAND.X), dot(lForearm, LHAND.Y), dot(lForearm, LHAND.Z)],
  fingers: [
    [0.07, 0.2, 1.45, 0.75],
    [0.0, 0.2, 1.5, 0.8],
    [-0.07, 0.22, 1.5, 0.85],
    [-0.15, 0.3, 1.2, 0.9],
  ],
  thumb: [[0.75, 0.62, 0.0], [0.6, 0.8, -0.02], [0.45, 0.89, -0.04]],
};
function handLPart(p) {
  return Math.min(book(p), hand(local(p, LHAND), LPOSE));
}

// ---------------------------------------------------------------- the hat and the right hand
// The right hand hangs at his side, palm forward, pinching the front of the hat's brim between the
// thumb (outside, on the brim) and the curled index finger (inside); the crown points out to his right.
const RHAND = (() => {
  const o = [-0.25, 0.905, 0.035];
  const Y = norm([0, -1, 0.17]); // toward the fingers
  const X = [-1, 0, 0]; // toward the thumb
  const Z = cross(Y, X); // right hand: back of the hand = distal x radial... checked: points backward
  return { o, X, Y, Z };
})();
const rForearm = norm(sub(RHAND.o, J.rElbow));
const RPOSE = {
  forearm: [dot(rForearm, RHAND.X), dot(rForearm, RHAND.Y), dot(rForearm, RHAND.Z)],
  fingers: [
    [-0.06, 0.45, 1.05, 0.55],
    [-0.02, 0.75, 1.3, 0.7],
    [0.03, 0.85, 1.4, 0.75],
    [0.1, 0.95, 1.45, 0.75],
  ],
  thumb: [[0.55, 0.72, -0.4], [0.18, 0.95, -0.25], [0.05, 0.97, -0.22]],
};
// The hat's frame: y along the axis from the brim to the crown, z toward the wearer's front.
const HAT = { rim: 0.125, crownH: 0.152, wall: 0.0045 };
const hatF = (() => {
  const Y = RHAND.X; // crown on the thumb side, pointing out from his side
  const Z = mul(RHAND.Y, -1); // the hat's front edge is the one in his hand
  const X = cross(Y, Z);
  const plateX = 0.037; // brim's mid-plane, in hand coordinates
  const rimY = 0.1; // where the brim's edge enters the hand
  const o = world(RHAND, [plateX, rimY + HAT.rim * 1.06, 0]);
  return { o, X, Y, Z };
})();
function hat(p) {
  const q = local(p, hatF);
  const far = boxDist(q, [-0.15, -0.04, -0.16], [0.15, 0.17, 0.16]);
  if (far > 0.01) return far;
  const [x, y, z] = q;
  // oval in plan, longer front to back, with a slightly belled crown
  const r = 0.076 + 0.006 * (y / HAT.crownH) ** 2;
  const oval = Math.hypot(x / 0.88, z);
  const outer = smax((oval - r) * 0.92, y - HAT.crownH, 0.012);
  const inner = Math.max(oval - (r - HAT.wall), y - (HAT.crownH - HAT.wall));
  let crown = smax(outer, -inner, 0.002);
  crown = Math.max(crown, -0.002 - y);
  // band, with a small flat bow on the left side
  const band = smax((oval - r - 0.0016) * 0.92, Math.abs(y - 0.022) - 0.0175, 0.002);
  crown = smin(crown, band, 0.0015);
  crown = smin(crown, ellipsoid(q, [r * 0.88 + 0.002, 0.024, -0.01], [0.004, 0.012, 0.016]), 0.003);
  // brim: curled up at the sides, dipping a little front and back, with a rolled edge
  const rimOval = Math.hypot(x / 0.9, z / 1.06);
  const curl = 0.028 * Math.max(0, Math.abs(x) / 0.12) ** 3 - 0.004 * (z / 0.13) ** 2;
  const slope = Math.hypot(0.028 * 3 * (Math.abs(x) / 0.12) ** 2 / 0.12, 1);
  const edge = smoothstep(HAT.rim - 0.012, HAT.rim, rimOval);
  let brim = Math.max((Math.abs(y - curl) / slope) - 0.0024 - 0.0022 * edge, rimOval - HAT.rim);
  brim = smax(brim, -(oval - (r - HAT.wall)), 0.003); // the opening
  return smin(crown, brim, 0.006);
}
function handRPart(p) {
  return smin(hat(p), hand(local(p, RHAND), RPOSE), 0.002);
}

// ---------------------------------------------------------------- shoes (ankle boots)
// Each boot in its own frame: origin under the back of the heel on the slab, z toward the toe,
// x toward the outside of the foot.
function footFrame(heel, dir, outward) {
  const Z = norm([dir[0], 0, dir[1]]);
  const Y = [0, 1, 0];
  let X = cross(Y, Z);
  if (X[0] * outward < 0) X = mul(X, -1);
  return { o: [heel[0], S, heel[1]], X, Y, Z };
}
const FEET = [
  { F: footFrame([-0.072, -0.092], [-0.065, 1], -1), ankle: J.rAnkle },
  { F: footFrame([0.145, -0.008], [0.43, 0.9], 1), ankle: J.lAnkle },
];
function footprint(u, w) {
  // the sole's outline: round heel, narrow waist, broad ball, rounded toe
  const heel = Math.hypot(u, w - 0.04) - 0.035;
  const ball = Math.hypot(u - 0.006, w - 0.185) - 0.046;
  const toe = Math.hypot(u + 0.003, w - 0.238) - 0.04;
  return smin(heel, smin(ball, toe, 0.05), 0.11);
}
function boot(p, F) {
  const [u, v, w] = local(p, F);
  if (v > 0.26 || w < -0.03 || w > 0.32 || Math.abs(u) > 0.09) return Math.max(v - 0.25, w - 0.31, -0.02 - w, Math.abs(u) - 0.08, 0.01);
  const toeSpring = 0.011 * smoothstep(0.19, 0.3, w) ** 1.5;
  const arch = 0.007 * smoothstep(0.075, 0.095, w) * smoothstep(0.17, 0.135, w);
  const fp = footprint(u, w);
  // sole with a welt standing out round the upper
  const solBot = toeSpring + arch;
  let d = Math.max(fp, solBot - v, v - (solBot + 0.011));
  d = smax(d, -0.0004 + 0 * u, 0.0001) ;
  // heel block, slightly inset
  const heel = Math.max(fp + 0.002, w - 0.085, -v, v - 0.03);
  d = Math.min(d, heel);
  // stacked-leather lines on the heel
  if (w < 0.09 && v < 0.03) d += 0.0003 * Math.sin(v * 900);
  // upper: toe box rising to the instep and up into the ankle shaft
  const top = 0.011 + toeSpring;
  const h = w > 0.13 ? mix(0.085, 0.04, smoothstep(0.13, 0.29, w)) : mix(0.12, 0.085, smoothstep(0.02, 0.13, w));
  let upper = smax(fp + 0.0035, v - (h - 9 * u * u - 0.0) , 0.02);
  upper = Math.max(upper, top - 0.003 - v);
  // ankle shaft inside the trousers
  const shaft = limb(p, add(F.o, add(mul(F.Z, 0.065), [0, 0.06, 0])), [p[0], 0, p[2]].map((_, i) => (i === 1 ? 0.24 : add(F.o, mul(F.Z, 0.07))[i])), 0.042, 0.04);
  upper = smin(upper, shaft, 0.04);
  // toe cap seam and the welt seam
  upper += 0.0009 * Math.exp(-(((w - 0.2 - 0.25 * u * u / 0.04) / 0.0018) ** 2)) * smoothstep(0.03, 0.05, v);
  upper += 0.0008 * Math.exp(-(((v - top - 0.004) / 0.0015) ** 2));
  d = Math.min(d, upper);
  return d;
}
function feetPart(p) {
  return Math.min(boot(p, FEET[0].F), boot(p, FEET[1].F));
}

// ---------------------------------------------------------------- trousers
function trouserLeg(p, hip, knee, ankle, foot, relaxed) {
  const thigh = limb(p, hip, knee, 0.088, 0.07);
  if (thigh > 0.08 && p[1] > 0.5) return thigh;
  const ank = [ankle[0], 0.12, ankle[2]];
  let d = smin(thigh, limb(p, knee, ank, 0.066, 0.066), 0.03);
  if (d > 0.04) return d;
  const axis = norm(sub(knee, ank));
  const h = dot(sub(p, ank), axis); // height above the ankle along the shin
  const rv = sub(sub(p, ank), mul(axis, h));
  const rl = Math.hypot(rv[0], rv[1], rv[2]) || 1;
  const fwd = foot.F.Z;
  const side = cross(axis, fwd);
  const c = dot(rv, fwd) / rl; // 1 = front of the leg
  const s = dot(rv, side) / rl;
  const phi = Math.atan2(s, c);
  // the cloth gathers where it breaks over the boot: the front bellies out, then folds once or twice
  const low = smoothstep(0.16, 0.0, h);
  d -= 0.006 * low * (0.5 + 0.5 * c);
  d -= 0.0042 * Math.sin((h - 0.012 + 0.012 * s) * 2 * Math.PI / 0.046) * smoothstep(0.13, 0.03, h) * (0.35 + 0.65 * Math.max(c, 0));
  // a pressed crease down the front, and long soft folds
  d -= 0.0018 * Math.exp(-(((phi) / 0.12) ** 2)) * smoothstep(0.1, 0.25, h);
  d -= 0.0016 * noise3(phi * 1.8 + (relaxed ? 7 : 0), h * 7, 3.3);
  if (relaxed) {
    // the forward knee drags the cloth: diagonal folds running from the knee down the shin
    d -= 0.0032 * Math.sin((h + 0.06 * phi) * 2 * Math.PI / 0.075 + 1) * smoothstep(0.12, 0.2, h) * smoothstep(0.42, 0.3, h) * (0.4 + 0.6 * Math.abs(s));
  }
  // hem: lower in front where it rests on the instep, higher behind the heel
  const hemY = 0.085 + 0.016 * c + 0.004 * Math.sin(phi * 3);
  d = smax(d, hemY - p[1], 0.004);
  // the open hem: hollow for a few centimeters
  d = smax(d, -Math.max(rl - 0.05, p[1] - hemY - 0.03), 0.003);
  return d;
}

// ---------------------------------------------------------------- the coat
// The opening of the coat above the waist button, between the lapels (u = |x|).
const lapelInner = (y) => 0.014 + 0.07 * clamp((y - 1.11) / 0.32, 0, 1) ** 0.7;
function skirt(p) {
  const [x, y, z] = p;
  const top = 1.13;
  const hem0 = 0.47;
  const t = clamp((top - y) / (top - hem0), 0, 1);
  const rx = mix(0.152, 0.246, t ** 0.9);
  const rz = mix(0.11, 0.182, t);
  const cz = mix(0, 0.014, t) + 0.012 * t * smoothstep(0, 0.15, x); // the left knee pushes the cloth forward
  const theta = Math.atan2(x, z - cz); // 0 = front, + = his left
  // hanging folds: deepest at the hem, flatter on the fronts, a strong pair at the back from the pleats
  const fm = 0.35 + 0.65 * smoothstep(0.25, 0.9, Math.abs(theta));
  const wave = 0.55 * Math.sin(7 * theta + 1.3 + 0.6 * t) + 0.32 * Math.sin(12 * theta + 0.4 + 1.5 * t) + 0.18 * Math.sin(19 * theta + 2.1) + 0.25 * noise3(theta * 3, t * 2, 1.7);
  const amp = 0.0012 + 0.0105 * t ** 1.6;
  const folds = amp * fm * wave;
  const e = (Math.hypot(x / rx, (z - cz) / rz) - 1) * Math.min(rx, rz) * 0.95 - folds;
  // hollow below the hips, so the legs stand inside it
  const th = mix(0.12, 0.013, smoothstep(0.98, 0.76, y));
  let d = Math.max(e, -(e + th));
  // hem, swinging a little lower on the ridges of the folds
  const hemY = hem0 - 0.25 * folds - 0.01 * Math.cos(theta) * smoothstep(0.0, 0.2, x);
  d = smax(d, hemY - y, 0.005);
  d = Math.max(d, y - top - 0.05);
  // the fronts part below the waist button
  const w = 0.004 + 0.1 * smoothstep(1.08, 0.48, y) ** 1.2;
  const open = Math.max(Math.abs(x - 0.014) - w, 0.02 - z);
  d = smax(d, -open, 0.006);
  // back vent between the tails, opening toward the hem
  const vw = 0.0022 + 0.011 * smoothstep(0.98, 0.47, y);
  const vent = Math.max(Math.abs(x + 0.004) - vw, z + 0.02, y - 1.0);
  d = smax(d, -vent, 0.003);
  // the two pleats running down from the back buttons
  if (z < 0) for (const s of [-1, 1]) d += 0.0055 * smoothstep(1.09, 0.95, y) * Math.exp(-(((x - s * 0.05) / 0.0065) ** 2)) * smoothstep(0.0, -0.04, z);
  return { d, e };
}
// pocket flaps on the hips: a thin layer lying on the skirt
function pocketFlaps(p, e) {
  const [x, y, z] = p;
  if (y < 0.9 || y > 1.04 || z < -0.05) return 1;
  const theta = Math.atan2(x, z);
  let d = 1;
  for (const s of [-1, 1]) {
    const arc = (theta - s * 0.95) * 0.19;
    const region = Math.max(Math.abs(arc) - 0.072, y - 0.995, 0.948 - y + 0.004 * Math.cos(arc * 30));
    const layer = Math.max(e - 0.0045, -e - 0.012);
    d = Math.min(d, smax(layer, region, 0.004));
  }
  return d;
}
function torsoCore(p) {
  let t = ellipsoid(p, [0, 1.0, 0.0], [0.16, 0.12, 0.11], [0, 0, 0.05]);
  t = smin(t, ellipsoid(p, [0, 1.14, 0.004], [0.155, 0.12, 0.105]), 0.06);
  t = smin(t, ellipsoid(p, [0.002, 1.3, 0.004], [0.195, 0.17, 0.122], [0, 0, -0.045]), 0.07);
  // shoulders: sloping from the neck to rounded deltoids, shoulder blades behind
  t = smin(t, limb(p, [-0.04, 1.47, -0.005], J.rShoulder, 0.06, 0.055), 0.05);
  t = smin(t, limb(p, [0.04, 1.48, -0.005], J.lShoulder, 0.06, 0.055), 0.05);
  for (const s of [-1, 1]) t = smin(t, ellipsoid(p, [s * 0.085, 1.33, -0.06], [0.07, 0.09, 0.06]), 0.04);
  return t;
}
function sleeve(p, Sh, E, Wr, side) {
  const u = norm(sub(E, Sh));
  const l = norm(sub(Wr, E));
  const end = sub(Wr, mul(l, 0.018)); // the cuff stops just short of the wrist
  const upper = limb(p, Sh, E, 0.058, 0.05);
  const lower = limb(p, E, end, 0.05, 0.0465);
  let d = smin(upper, lower, 0.03);
  if (d > 0.04) return d;
  // where on the arm is this point: s = distance from the elbow along the arm, phi = angle round it
  const onLower = lower < upper;
  const axis = onLower ? l : u;
  const s = onLower ? dot(sub(p, E), l) : dot(sub(p, E), u);
  const ap = add(E, mul(axis, s));
  const rv = norm(sub(p, ap));
  let inner = sub(l, u);
  const bend = Math.hypot(...inner);
  inner = norm(sub(inner, mul(axis, dot(inner, axis))));
  const ci = bend > 0.05 ? dot(rv, inner) : 0;
  const phi = Math.atan2(dot(rv, cross(axis, inner)), ci);
  // compression folds fanning out from the inside of the elbow
  const fan = Math.sin((2 * Math.PI * s) / (0.03 * (1 + 1.3 * (1 - ci))) + 0.8);
  d -= 0.005 * Math.min(1, bend * 1.4) * fan * Math.exp(-((s / 0.09) ** 2)) * smoothstep(-0.5, 0.6, ci);
  // the sleeve hangs in long soft folds, and gathers in ripples above the cuff
  d -= 0.0022 * noise3(s * 13, phi * 1.4, side * 5);
  const ae = dot(sub(p, end), l);
  if (onLower) d -= 0.002 * Math.sin((2 * Math.PI * ae) / 0.032 + phi) * smoothstep(-0.16, -0.1, ae) * smoothstep(-0.05, -0.065, ae);
  // flat end, turned-back cuff, and the opening the wrist comes out of
  d = smax(d, ae, 0.005);
  d -= 0.0028 * smoothstep(-0.062, -0.056, ae);
  d += 0.0012 * Math.exp(-(((ae + 0.059) / 0.0018) ** 2));
  const rho = Math.hypot(...sub(sub(p, end), mul(l, ae)));
  d = smax(d, -Math.max(rho - 0.031, -ae - 0.05), 0.004);
  // the sleeve-head seam round the shoulder
  const sh = dot(sub(p, Sh), u);
  d += 0.0012 * Math.exp(-(((sh - 0.012) / 0.003) ** 2)) * smoothstep(0.09, 0.06, Math.hypot(...sub(sub(p, Sh), mul(u, sh))));
  return d;
}

const rWrist = RHAND.o;
function body(p) {
  const [x, y, z] = p;
  // base slab
  let d = roundBox(p, [0.035, S / 2, 0.035], [0.3, S / 2, 0.25], 0.012);
  if (y < 0.06) return d;

  // legs in trousers (hidden under the coat above the knee)
  d = Math.min(d, trouserLeg(p, J.rHip, J.rKnee, J.rAnkle, FEET[0], false));
  d = Math.min(d, trouserLeg(p, J.lHip, J.lKnee, J.lAnkle, FEET[1], true));
  if (y < 0.4) return d;

  // the coat's body
  let torso = torsoCore(p);
  const sk = skirt(p);
  torso = smin(torso, sk.d, 0.04);
  // the waistcoat shows between the lapels, set back behind the fronts of the coat
  const inner = lapelInner(y);
  const vmask = smoothstep(0.003, -0.004, Math.abs(x) - inner) * smoothstep(1.105, 1.13, y) * smoothstep(0.03, 0.07, z) * smoothstep(1.47, 1.44, y);
  const shirt = smoothstep(0.004, -0.003, Math.abs(x) - (0.012 + (y - 1.36) * 0.55)) * smoothstep(1.35, 1.38, y);
  let coat = torso + 0.009 * vmask + 0.005 * vmask * shirt;
  // waist seam, center back seam and the side-back seams of the tailoring
  coat += 0.0022 * Math.exp(-(((y - 1.09) / 0.004) ** 2));
  if (z < 0 && y > 1.09) {
    coat += 0.0013 * Math.exp(-((x / 0.003) ** 2));
    for (const s of [-1, 1]) coat += 0.0011 * Math.exp(-(((x - s * (0.09 + (y - 1.09) * 0.25)) / 0.003) ** 2));
  }
  // strain folds pulling from the waist button up toward the sides
  if (z > 0 && y > 1.1 && y < 1.3) {
    const bx = Math.abs(x) - inner;
    if (bx > 0) coat -= 0.0022 * Math.sin((y - 1.11 - bx * 0.55) * 2 * Math.PI / 0.045) * smoothstep(0.0, 0.03, bx) * smoothstep(0.16, 0.08, bx) * smoothstep(1.3, 1.2, y);
  }
  d = smin(d, coat, 0.006);
  d = smin(d, pocketFlaps(p, sk.e), 0.002);

  // rolled lapels: a layer lying on the chest, thick and rounded along the roll line (the edge of
  // the opening), thinner at the free edge, with a notch where the collar meets them
  if (z > 0 && y > 1.1 && y < 1.5) {
    const u = Math.abs(x);
    const outer = inner + mix(0.022, 0.074, smoothstep(1.11, 1.37, y)) - (y > 1.41 ? (y - 1.41) * 1.1 : 0);
    const notch = Math.max(Math.abs(y - 1.4) - 0.0035 - 0.28 * Math.max(0, u - inner - 0.028), inner + 0.028 - u);
    const region = Math.max(inner - u, u - outer, 1.11 - y, y - 1.475, -notch);
    const roll = Math.exp(-(((u - inner) / 0.014) ** 2));
    const layer = Math.max(torso - (0.0065 + 0.0075 * roll), -torso - 0.02);
    d = smin(d, smax(layer, region, 0.004), 0.003);
  }
  // the coat collar standing round the back of the neck and rolling down onto the shoulders
  {
    const q = unrot([x - 0.003, y - 1.47, z + 0.004], 0.12, 0, 0);
    const az = Math.atan2(q[0], q[2]);
    const rho = Math.hypot(q[0], q[2]);
    const yt = 0.035 - 0.06 * Math.max(0, Math.cos(az)) ** 2;
    const R = 0.083 + Math.max(0, yt - q[1]) * 0.55;
    const collar = Math.max(Math.abs(rho - R) - 0.007, q[1] - yt, -0.07 - q[1], Math.cos(az) - 0.8);
    d = smin(d, collar, 0.008);
  }
  // back buttons at the top of the pleats
  if (z < 0) for (const s of [-1, 1]) d = smin(d, sphere(p, [s * 0.05, 1.1, -0.112], 0.0095), 0.003);

  // neck (slightly thinner than the head mesh's neck so the two never overlap exactly)
  d = smin(d, limb(p, [0, 1.44, -0.012], [0.004, 1.63, -0.01], 0.055, 0.051), 0.03);
  // the high shirt collar wrapped in the cravat (a stock), which hides the seam with the head
  {
    let stock = cylinder(p, [0.003, 1.52, 0.008], 0.072, 0.06, [0.12, 0, 0]);
    stock = smin(stock, cylinder(p, [0.003, 1.475, 0.01], 0.074, 0.022, [0.12, 0, 0]), 0.012);
    stock -= 0.0016 * Math.sin((y - 1.46) * 2 * Math.PI / 0.021) * smoothstep(1.57, 1.55, y);
    stock = smin(stock, torus(p, [0.003, 1.578, 0.016], 0.072, 0.004, [0.12, 0, 0]), 0.008); // rolled top edge
    d = smin(d, stock, 0.012);
  }

  // sleeves
  d = smin(d, sleeve(p, J.rShoulder, J.rElbow, rWrist, -1), 0.02);
  d = smin(d, sleeve(p, J.lShoulder, J.lElbow, lWrist, 1), 0.02);
  return d;
}

// ---------------------------------------------------------------- small carved details
// Buttons, the watch chain, the cravat bow and the shirt-collar points: separate pieces lying on
// the body, meshed on a fine grid.
function surfaceZ(x, y) {
  // walk forward from inside the chest to the body's surface
  let z = 0.0;
  while (body([x, y, z]) < 0 && z < 0.3) z += 0.002;
  let a = z - 0.002, b = z;
  for (let i = 0; i < 20; i++) {
    const m = (a + b) / 2;
    if (body([x, y, m]) < 0) a = m; else b = m;
  }
  return (a + b) / 2;
}
function catmull(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
let DETAIL = null;
function detailSetup() {
  if (DETAIL) return DETAIL;
  const lift = (x, y, h) => [x, y, surfaceZ(x, y) + h];
  // a double ("Albert") watch chain: from a buttonhole across to a pocket on each side, the ends
  // slipping under the lapels, with a short drop and a seal hanging from the bar
  const chainR = 0.0021;
  const chain = catmull([[-0.06, 1.236], [-0.032, 1.208], [-0.006, 1.226], [0.005, 1.246], [0.018, 1.226], [0.04, 1.206], [0.064, 1.234]], 0.002).map(([x, y]) => lift(x, y, chainR * 0.9));
  const drop = catmull([[0.005, 1.244], [0.006, 1.226], [0.0045, 1.206]], 0.002).map(([x, y]) => lift(x, y, chainR));
  const seal = lift(0.0045, 1.196, 0.006);
  const vButtons = [1.15, 1.192, 1.246, 1.3, 1.352].map((y) => lift(0.003 - (y - 1.25) * 0.02, y, 0.0005));
  const cButtons = [-1, 1].map((s) => lift(s * 0.052, 1.112, 0.0005));
  // arc length along the chain, for the links
  const arcs = (pts) => {
    const a = [0];
    for (let i = 1; i < pts.length; i++) a.push(a[i - 1] + Math.hypot(...sub(pts[i], pts[i - 1])));
    return a;
  };
  DETAIL = { chain, chainArc: arcs(chain), drop, dropArc: arcs(drop), chainR, seal, vButtons, cButtons };
  return DETAIL;
}
function chainDist(p, pts, arc, r) {
  let best = 1;
  let bs = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ba = sub(b, a);
    const h = clamp(dot(sub(p, a), ba) / dot(ba, ba), 0, 1);
    const dd = Math.hypot(...sub(sub(p, a), mul(ba, h)));
    if (dd < best) {
      best = dd;
      bs = arc[i] + h * (arc[i + 1] - arc[i]);
    }
  }
  // oval links, alternately seen face-on and edge-on
  return best - r * (0.78 + 0.3 * Math.abs(Math.sin((bs * Math.PI) / 0.0052)));
}
function button(p, c, r, n) {
  // a domed button with a rim, facing along n
  const q = sub(p, c);
  const h = dot(q, n);
  const rr = Math.hypot(...sub(q, mul(n, h)));
  let d = Math.max(rr - r, Math.abs(h) - r * 0.3);
  d = Math.min(d, ellipsoid([rr, h - r * 0.15, 0], [0, 0, 0], [r * 0.8, r * 0.38, r * 0.8]));
  return d - 0.0004 * Math.exp(-(((rr - r * 0.82) / 0.0007) ** 2));
}
function detailsPart(p) {
  const D = detailSetup();
  const [x, y, z] = p;
  let d = 1;
  // watch chain
  if (y > 1.17 && y < 1.27 && Math.abs(x) < 0.08) {
    d = Math.min(d, chainDist(p, D.chain, D.chainArc, D.chainR));
    d = Math.min(d, chainDist(p, D.drop, D.dropArc, D.chainR * 0.85));
    d = Math.min(d, smin(ellipsoid(p, D.seal, [0.0055, 0.0075, 0.004]), sphere(p, add(D.seal, [0, 0.009, -0.001]), 0.0025), 0.003));
    // the T-bar through the buttonhole
    d = Math.min(d, limb(p, add(D.chain[Math.floor(D.chain.length / 2)], [-0.008, 0.002, 0]), add(D.chain[Math.floor(D.chain.length / 2)], [0.008, 0.002, 0]), 0.0017, 0.0017));
  }
  // buttons
  for (const c of D.vButtons) d = Math.min(d, button(p, c, 0.0058, [0, 0.15, 0.99]));
  for (const c of D.cButtons) d = Math.min(d, button(p, c, 0.0105, [0, 0.1, 0.995]));
  // cravat: knot, two loops of the bow with a crease along each, and the ends hanging into the waistcoat
  if (y > 1.37 && y < 1.62 && z > 0.02) {
    const knot = ellipsoid(p, [0.004, 1.469, 0.087], [0.016, 0.015, 0.012]);
    let bow = knot;
    for (const s of [-1, 1]) {
      const c = [0.004 + s * 0.031, 1.472, 0.082];
      const q = unrot(sub(p, c), 0, -s * 0.45, s * 0.14);
      let loop = ellipsoid(q, [0, 0, 0], [0.024, 0.0135, 0.0085]);
      loop = smin(loop, ellipsoid(q, [s * 0.017, 0, 0], [0.008, 0.016, 0.008]), 0.008); // the loop's rounded end
      loop += 0.0012 * Math.exp(-((q[1] / 0.0018) ** 2)) * smoothstep(0, 0.004, q[2]);
      bow = smin(bow, loop, 0.006);
      // ends of the cravat, flaring as they go down under the waistcoat
      const e = unrot(sub(p, [0.004 + s * 0.012, 1.428, 0.1]), -0.38, 0, s * 0.22);
      const wdt = mix(0.009, 0.015, clamp((0.03 - e[1]) / 0.06, 0, 1));
      let end = roundBox([e[0], e[1], e[2]], [0, 0, 0], [wdt, 0.032, 0.0026], 0.0022);
      end -= 0.0009 * Math.sin(e[0] * 700 + e[1] * 120);
      bow = smin(bow, end, 0.004);
    }
    d = Math.min(d, bow);
    // shirt-collar points standing above the stock, under the jaw
    const q = unrot([x - 0.003, y - 1.52, z - 0.008], 0.12, 0, 0);
    const az = Math.atan2(q[0], q[2]);
    const rho = Math.hypot(q[0], q[2]);
    for (const s of [-1, 1]) {
      const a = s * az;
      const tip = 0.068 - 1.4 * Math.abs(a - 0.42) * 0.12;
      const region = Math.max(0.15 - a, a - 0.95, q[1] - tip, 0.02 - q[1]);
      const sheet = Math.abs(rho - 0.0745) - 0.0016;
      d = Math.min(d, smax(sheet, region, 0.003));
    }
  }
  return d;
}

// ---------------------------------------------------------------- parts
// Each part is meshed on its own grid. Seams are hidden: the head's neck goes down inside the stock,
// the wrists go up inside the cuffs, the boots' shafts up inside the trousers; buttons, chain and
// cravat are separate pieces lying on the cloth.
const PARTS = [
  { name: 'body', sdf: body, cell: 0.0042, min: [-0.36, -0.005, -0.27], max: [0.4, 1.6, 0.3], err: 0.0006, posStep: 2 },
  { name: 'head', sdf: headPart, cell: 0.0019, min: [-0.15, 1.545, -0.16], max: [0.16, 1.89, 0.17], err: 0.00022, posStep: 1 },
  { name: 'handL', sdf: handLPart, cell: 0.0017, min: [-0.04, 1.05, 0.02], max: [0.24, 1.36, 0.25], err: 0.00022, posStep: 1 },
  { name: 'handR', sdf: handRPart, cell: 0.0018, min: [-0.49, 0.5, -0.12], max: [-0.18, 0.95, 0.2], err: 0.00025, posStep: 1 },
  { name: 'feet', sdf: feetPart, cell: 0.0022, min: [-0.16, 0.055, -0.12], max: [0.33, 0.26, 0.3], err: 0.0003, posStep: 1 },
  { name: 'details', sdf: detailsPart, cell: 0.0012, min: [-0.11, 1.09, 0.02], max: [0.12, 1.625, 0.16], err: 0.00012, posStep: 1 },
];
const BOX_PAD = 0.01;
// everything together, for the ambient occlusion
function globalSDF(p) {
  let d = 1e9;
  for (const part of PARTS) {
    const b = boxDist(p, part.min, part.max);
    d = Math.min(d, b > 0.03 ? b : part.sdf(p));
  }
  return d;
}

// ---------------------------------------------------------------- worker side
const B = 4; // narrow band: blocks of B^3 cells far from the surface are skipped
function fieldTask({ part: pi, k0, k1, buf, dims }) {
  const part = PARTS[pi];
  const field = new Float32Array(buf);
  const [nx, ny, nz] = dims;
  const cell = part.cell * FAST;
  const half = B * cell * 0.5 * Math.sqrt(3);
  const thresh = half * 1.35 + 2.5 * cell;
  const p = [0, 0, 0];
  for (let bk = k0; bk < k1; bk++) {
    for (let bj = 0; bj * B < ny; bj++) {
      for (let bi = 0; bi * B < nx; bi++) {
        const dc = part.sdf([part.min[0] + (bi * B + B / 2) * cell, part.min[1] + (bj * B + B / 2) * cell, part.min[2] + (bk * B + B / 2) * cell]);
        const far = Math.abs(dc) > thresh;
        for (let k = bk * B; k < Math.min(bk * B + B, nz); k++) {
          for (let j = bj * B; j < Math.min(bj * B + B, ny); j++) {
            for (let i = bi * B; i < Math.min(bi * B + B, nx); i++) {
              const n = i + nx * (j + ny * k);
              if (far) field[n] = dc;
              else {
                p[0] = part.min[0] + i * cell;
                p[1] = part.min[1] + j * cell;
                p[2] = part.min[2] + k * cell;
                field[n] = part.sdf(p);
              }
            }
          }
        }
      }
    }
  }
}
// tetrahedral gradient
function gradient(sdf, x, y, z, e) {
  const a = sdf([x + e, y - e, z - e]);
  const b = sdf([x - e, y - e, z + e]);
  const c = sdf([x - e, y + e, z - e]);
  const d = sdf([x + e, y + e, z + e]);
  const gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d;
  const L = Math.hypot(gx, gy, gz) || 1;
  return [gx / L, gy / L, gz / L];
}
const AO_DIST = [0.004, 0.009, 0.016, 0.026, 0.04, 0.06];
const AO_W = [1, 0.9, 0.8, 0.65, 0.5, 0.35];
function vertsTask({ part: pi, positions }) {
  const part = PARTS[pi];
  const sdf = part.sdf;
  const cell = part.cell * FAST;
  const n = positions.length / 3;
  const normals = new Float32Array(n * 3);
  const ao = new Float32Array(n);
  const wsum = AO_W.reduce((a, b) => a + b, 0);
  for (let v = 0; v < n; v++) {
    let x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    for (let step = 0; step < 3; step++) {
      const f = clamp(sdf([x, y, z]), -cell * 0.6, cell * 0.6);
      if (Math.abs(f) < cell * 0.002) break;
      const g = gradient(sdf, x, y, z, cell * 0.35);
      x -= g[0] * f;
      y -= g[1] * f;
      z -= g[2] * f;
    }
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    const g = gradient(sdf, x, y, z, cell * 0.45);
    normals.set(g, v * 3);
    // ambient occlusion: how much closer the surroundings are than they would be on open ground
    let occ = 0;
    for (let i = 0; i < AO_DIST.length; i++) {
      const h = AO_DIST[i];
      const s = globalSDF([x + g[0] * h, y + g[1] * h, z + g[2] * h]);
      occ += AO_W[i] * clamp((h - s) / h, 0, 1);
    }
    ao[v] = occ / wsum;
  }
  return { positions, normals, ao };
}
if (!isMainThread) {
  parentPort.on('message', (msg) => {
    if (msg.type === 'field') {
      fieldTask(msg);
      parentPort.postMessage({ id: msg.id });
    } else {
      const r = vertsTask(msg);
      parentPort.postMessage({ id: msg.id, ...r }, [r.positions.buffer, r.normals.buffer, r.ao.buffer]);
    }
  });
}

// ---------------------------------------------------------------- main side
function surfaceNets(field, nx, ny, nz, min, cell) {
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const cidx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const positions = [];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = field[idx(i + CORNER[c][0], j + CORNER[c][1], k + CORNER[c][2])];
          if (v[c] < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, count = 0;
        for (const [a, b] of EDGES) {
          if ((v[a] < 0) === (v[b] < 0)) continue;
          const t = v[a] / (v[a] - v[b]);
          sx += CORNER[a][0] + (CORNER[b][0] - CORNER[a][0]) * t;
          sy += CORNER[a][1] + (CORNER[b][1] - CORNER[a][1]) * t;
          sz += CORNER[a][2] + (CORNER[b][2] - CORNER[a][2]) * t;
          count++;
        }
        cellVert[cidx(i, j, k)] = positions.length / 3;
        positions.push(min[0] + (i + sx / count) * cell, min[1] + (j + sy / count) * cell, min[2] + (k + sz / count) * cell);
      }
    }
  }
  const tris = [];
  const quad = (a, b, c, d) => {
    if (a >= 0 && b >= 0 && c >= 0 && d >= 0) tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const f0 = field[idx(i, j, k)] < 0;
        if (f0 !== (field[idx(i + 1, j, k)] < 0)) quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)]);
        if (f0 !== (field[idx(i, j + 1, k)] < 0)) quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)]);
        if (f0 !== (field[idx(i, j, k + 1)] < 0)) quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)]);
      }
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(tris) };
}

async function main() {
  const { MeshoptSimplifier, MeshoptEncoder } = await import('meshoptimizer');
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const nw = Math.max(1, Math.min(8, availableParallelism()));
  const workers = Array.from({ length: nw }, () => new Worker(new URL(import.meta.url)));
  const pending = new Map();
  let nextId = 0;
  for (const w of workers) w.on('message', (m) => { pending.get(m.id)(m); pending.delete(m.id); });
  // run tasks on whichever worker is free
  async function runAll(tasks, transfer) {
    const results = new Array(tasks.length);
    let next = 0;
    await Promise.all(workers.map(async (w) => {
      while (next < tasks.length) {
        const t = next++;
        const id = nextId++;
        results[t] = await new Promise((res) => {
          pending.set(id, res);
          w.postMessage({ ...tasks[t], id }, transfer ? transfer(tasks[t]) : []);
        });
      }
    }));
    return results;
  }

  const pad4 = (n) => (n + 3) & ~3;
  const bin = []; // compressed data, in the GLB's BIN chunk
  let binOffset = 0;
  let fallbackOffset = 0; // the uncompressed layout that the compressed views decode into
  const bufferViews = [];
  const accessors = [];
  const nodes = [];
  const meshes = [];
  function addView(typed, count, stride, mode, target, isIndex) {
    const raw = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const enc = MeshoptEncoder.encodeGltfBuffer(raw, count, stride, mode);
    bufferViews.push({
      buffer: 1, byteOffset: fallbackOffset, byteLength: raw.length, target, ...(isIndex ? {} : { byteStride: stride }),
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: binOffset, byteLength: enc.length, byteStride: stride, mode, count } },
    });
    bin.push(Buffer.from(enc), Buffer.alloc(pad4(enc.length) - enc.length));
    binOffset += pad4(enc.length);
    fallbackOffset += pad4(raw.length);
    return bufferViews.length - 1;
  }

  const only = process.env.STATUE_PARTS?.split(',');
  const stats = [];
  for (let pi = 0; pi < PARTS.length; pi++) {
    const part = PARTS[pi];
    if (only && !only.includes(part.name)) continue;
    const t0 = Date.now();
    const cell = part.cell * FAST;
    const nx = Math.ceil((part.max[0] - part.min[0]) / cell) + 1;
    const ny = Math.ceil((part.max[1] - part.min[1]) / cell) + 1;
    const nz = Math.ceil((part.max[2] - part.min[2]) / cell) + 1;
    const buf = new SharedArrayBuffer(nx * ny * nz * 4);
    const nbk = Math.ceil(nz / B);
    const tasks = [];
    for (let k = 0; k < nbk; k += 2) tasks.push({ type: 'field', part: pi, k0: k, k1: Math.min(nbk, k + 2), buf, dims: [nx, ny, nz] });
    await runAll(tasks);
    const field = new Float32Array(buf);
    const nets = surfaceNets(field, nx, ny, nz, part.min, cell);
    const nv = nets.positions.length / 3;
    // project the vertices onto the surface, take normals and occlusion, in parallel chunks
    const chunk = Math.ceil(nv / (nw * 6));
    const vt = [];
    for (let s = 0; s < nv; s += chunk) vt.push({ type: 'verts', part: pi, positions: nets.positions.slice(s * 3, Math.min(nv, s + chunk) * 3) });
    const vr = await runAll(vt, (t) => [t.positions.buffer]);
    const positions = new Float32Array(nv * 3);
    const normals = new Float32Array(nv * 3);
    const occ = new Float32Array(nv);
    let o = 0;
    for (const r of vr) {
      positions.set(r.positions, o * 3);
      normals.set(r.normals, o * 3);
      occ.set(r.ao, o);
      o += r.ao.length;
    }
    const indices = nets.indices;
    // wind each triangle to face outward
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
      const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
      const f = cross(e1, e2);
      const nn = [normals[a] + normals[b] + normals[c], normals[a + 1] + normals[b + 1] + normals[c + 1], normals[a + 2] + normals[b + 2] + normals[c + 2]];
      if (dot(f, nn) < 0) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
    }
    // simplify: flat areas lose most of their triangles, folds and features keep theirs
    const [simp] = MeshoptSimplifier.simplify(indices, positions, 3, 0, part.err, ['ErrorAbsolute']);
    const [remap, count] = MeshoptEncoder.reorderMesh(simp, true, true);
    const P = new Float32Array(count * 3);
    const N = new Float32Array(count * 3);
    const A = new Float32Array(count);
    for (let i = 0; i < nv; i++) {
      const r = remap[i];
      if (r === 0xffffffff) continue;
      for (let a = 0; a < 3; a++) {
        P[r * 3 + a] = positions[i * 3 + a];
        N[r * 3 + a] = normals[i * 3 + a];
      }
      A[r] = occ[i];
    }
    // quantize: positions to 16 bits in the part's box (node translation/scale), normals to 8 bits,
    // occlusion to an 8-bit gray vertex color (1 = open, never darker than 0.45)
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], P[i * 3 + a]);
      hi[a] = Math.max(hi[a], P[i * 3 + a]);
    }
    const center = lo.map((l, a) => (l + hi[a]) / 2);
    const half = lo.map((l, a) => (hi[a] - l) / 2);
    const qpos = new Int16Array(count * 4);
    const qnor = new Int8Array(count * 4);
    const qcol = new Uint8Array(count * 4);
    const qmin = [32767, 32767, 32767], qmax = [-32767, -32767, -32767];
    for (let i = 0; i < count; i++) {
      for (let a = 0; a < 3; a++) {
        let q = Math.round(((P[i * 3 + a] - center[a]) / half[a]) * 32767);
        q = clamp(Math.round(q / part.posStep) * part.posStep, -32767, 32767);
        qpos[i * 4 + a] = q;
        qmin[a] = Math.min(qmin[a], q);
        qmax[a] = Math.max(qmax[a], q);
        qnor[i * 4 + a] = Math.round(N[i * 3 + a] * 127);
      }
      const ao = clamp(1 - 1.25 * A[i], 0.45, 1);
      qcol[i * 4] = qcol[i * 4 + 1] = qcol[i * 4 + 2] = Math.round(ao * 255);
      qcol[i * 4 + 3] = 255;
    }
    const wide = count > 65535;
    const idx = wide ? simp : new Uint16Array(simp);
    const posView = addView(qpos, count, 8, 'ATTRIBUTES', 34962);
    const norView = addView(qnor, count, 4, 'ATTRIBUTES', 34962);
    const colView = addView(qcol, count, 4, 'ATTRIBUTES', 34962);
    const idxView = addView(idx, simp.length, wide ? 4 : 2, 'TRIANGLES', 34963, true);
    accessors.push(
      { bufferView: posView, componentType: 5122, normalized: true, count, type: 'VEC3', min: qmin, max: qmax },
      { bufferView: norView, componentType: 5120, normalized: true, count, type: 'VEC3' },
      { bufferView: colView, componentType: 5121, normalized: true, count, type: 'VEC3' },
      { bufferView: idxView, componentType: wide ? 5125 : 5123, count: simp.length, type: 'SCALAR' },
    );
    const a0 = accessors.length - 4;
    meshes.push({ name: part.name, primitives: [{ attributes: { POSITION: a0, NORMAL: a0 + 1, COLOR_0: a0 + 2 }, indices: a0 + 3, material: 0 }] });
    nodes.push({ name: part.name, mesh: meshes.length - 1, translation: center, scale: half });
    const line = `${part.name}: ${nv} -> ${count} vertices, ${indices.length / 3} -> ${simp.length / 3} triangles (${((Date.now() - t0) / 1000).toFixed(1)} s)`;
    console.log(line);
    stats.push(line);
  }
  for (const w of workers) w.terminate();

  const gltf = {
    asset: { version: '2.0', generator: 'make-statue.mjs (David Destroyers Digital Exhibit)' },
    extensionsUsed: ['KHR_mesh_quantization', 'EXT_meshopt_compression'],
    extensionsRequired: ['KHR_mesh_quantization', 'EXT_meshopt_compression'],
    scene: 0,
    scenes: [{ nodes: nodes.map((_, n) => n) }],
    nodes,
    meshes,
    materials: [{ name: 'marble', pbrMetallicRoughness: { baseColorFactor: [0.94, 0.93, 0.9, 1], metallicFactor: 0, roughnessFactor: 0.35 } }],
    buffers: [{ byteLength: binOffset }, { byteLength: fallbackOffset, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    bufferViews,
    accessors,
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
  const binChunk = Buffer.concat(bin);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binChunk.length, 8);
  const chunkHeader = (length, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(length, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.concat([header, chunkHeader(json.length, 0x4e4f534a), json, chunkHeader(binChunk.length, 0x004e4942), binChunk]));
  console.log(`wrote ${OUT} (${((28 + json.length + binChunk.length) / 1e6).toFixed(2)} MB)`);
}
if (isMainThread) main();
