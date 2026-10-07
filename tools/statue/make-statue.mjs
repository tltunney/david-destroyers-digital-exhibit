// Builds the full-length marble statue of David Copperfield and writes assets/models/copperfield.glb.
//
//   node tools/statue/make-statue.mjs
//
// The figure is described as a signed distance field (for any point in space: how far is it from the
// statue's surface, negative inside). Body parts are simple shapes blended together with "smooth
// union", the way clay is pushed together, then the surface is meshed with naive surface nets.
//
// Pose and costume, from period references:
// - Dress of about 1850: knee-length frock coat with wide lapels, buttoned waistcoat, tall collar
//   and cravat, top hat. Hair side-parted with a wave at the front.
// - Victorian statues of writers stand holding a book. David becomes a novelist, so he holds a book
//   to his chest in his left hand and his top hat in his right.
// - Contrapposto: weight on the right leg, left knee relaxed and forward, head turned a little to
//   his left. Units are meters; feet stand on a low slab at y = 0..0.06, facing +z.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// STATUE_OUT=file.glb writes somewhere else; STATUE_PARTS=head meshes only the head (for quick previews).
const OUT = process.env.STATUE_OUT || resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/models/copperfield.glb');
// The head is meshed on a finer grid than the body; the seam between them hides inside the high collar.
const PARTS = [
  { name: 'body', cell: 0.0075, min: [-0.5, -0.005, -0.3], max: [0.42, 1.6, 0.36] },
  { name: 'head', cell: 0.0021, min: [-0.15, 1.545, -0.16], max: [0.16, 1.89, 0.17] },
];

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
  const pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const h = clamp((pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2]), 0, 1);
  return len3(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - mix(ra, rb, h);
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
function bump(n, [cx, cy, cz], [rx, ry, rz], amount) {
  const dx = (n[0] - cx) / rx;
  const dy = (n[1] - cy) / ry;
  const dz = (n[2] - cz) / rz;
  return amount * Math.exp(-(dx * dx + dy * dy + dz * dz));
}

// ---------------------------------------------------------------- the figure
const S = 0.06; // top of the base slab

// joints (his right side is -x, since he faces +z)
const J = {
  rHip: [-0.09, 0.985, 0], rKnee: [-0.082, 0.56, 0.005], rAnkle: [-0.075, 0.15, -0.02],
  lHip: [0.09, 0.958, 0.012], lKnee: [0.13, 0.55, 0.075], lAnkle: [0.168, 0.148, 0.07],
  rShoulder: [-0.19, 1.405, -0.005], rElbow: [-0.24, 1.13, -0.035], rWrist: [-0.27, 0.9, 0.03],
  lShoulder: [0.192, 1.43, -0.005], lElbow: [0.255, 1.18, -0.045], lWrist: [0.152, 1.16, 0.13],
  neckBase: [0, 1.44, 0], neckTop: [0.006, 1.62, 0.02],
};
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
  let w = roundBox(m, [0.068, -0.02, 0.012], [0.006, 0.024, 0.008], 0.005, [0, 0.35, 0]);
  return w;
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

// The frock coat's skirt: a flared elliptical cone from the waist to just below the knee.
// It closes at the waist and opens toward the hem so the trousers show.
function coatSkirt(p) {
  const top = 1.15;
  const hem = 0.47;
  const t = clamp((top - p[1]) / (top - hem), 0, 1);
  const rx = mix(0.15, 0.25, t);
  const rz = mix(0.108, 0.185, t);
  const cz = mix(0, 0.015, t);
  const e = (Math.hypot(p[0] / rx, (p[2] - cz) / rz) - 1) * Math.min(rx, rz);
  let d = smax(e, hem - p[1], 0.012);
  d = Math.max(d, p[1] - top);
  const w = 0.004 + Math.max(0, 0.9 - p[1]) * 0.33;
  const open = Math.max(Math.abs(p[0] - 0.012) - w, -(p[2] - 0.03));
  return smax(d, -open, 0.014);
}

// Everything below the collar line (the head mesh covers the rest).
function body(p) {
  // base slab
  let d = roundBox(p, [0.035, S / 2, 0.035], [0.3, S / 2, 0.25], 0.012);

  // legs in trousers, and boots
  let legs = Math.min(
    smin(limb(p, J.rHip, J.rKnee, 0.088, 0.07), limb(p, J.rKnee, J.rAnkle, 0.068, 0.062), 0.02),
    smin(limb(p, J.lHip, J.lKnee, 0.086, 0.07), limb(p, J.lKnee, J.lAnkle, 0.068, 0.062), 0.02),
  );
  legs = Math.min(legs, smin(limb(p, [-0.075, 0.105, -0.04], [-0.088, 0.088, 0.16], 0.05, 0.037), sphere(p, [-0.074, 0.1, -0.045], 0.046), 0.02));
  legs = Math.min(legs, smin(limb(p, [0.166, 0.105, 0.04], [0.255, 0.088, 0.225], 0.05, 0.037), sphere(p, [0.164, 0.1, 0.035], 0.046), 0.02));
  d = smin(d, legs, 0.015);

  // torso: pelvis, waist and chest form the body of the coat
  let torso = ellipsoid(p, [0, 1.0, 0.0], [0.16, 0.12, 0.11], [0, 0, 0.05]);
  torso = smin(torso, ellipsoid(p, [0, 1.14, 0.004], [0.155, 0.12, 0.105]), 0.06);
  torso = smin(torso, ellipsoid(p, [0.002, 1.3, 0.004], [0.195, 0.17, 0.122], [0, 0, -0.045]), 0.07);
  // shoulders: sloping from the neck to rounded deltoids
  torso = smin(torso, limb(p, [-0.04, 1.47, -0.005], J.rShoulder, 0.06, 0.055), 0.05);
  torso = smin(torso, limb(p, [0.04, 1.48, -0.005], J.lShoulder, 0.06, 0.055), 0.05);
  torso = smin(torso, coatSkirt(p), 0.045);
  // waist seam and the pleats at the back of the skirt, pressed in a few millimeters
  torso += 0.0022 * Math.exp(-(((p[1] - 1.09) / 0.004) ** 2));
  if (p[2] < 0 && p[1] < 1.08) torso += 0.004 * Math.exp(-((p[0] / 0.006) ** 2));
  d = smin(d, torso, 0.03);

  // broad lapels: a thin layer lying on the chest, between the opening of the coat and a line
  // running from the waist up to the collar, with a notch near the top
  for (const s of [-1, 1]) {
    const u = s * p[0];
    const t = clamp((p[1] - 1.12) / 0.34, 0, 1);
    const inner = mix(0.018, 0.06, t);
    const outer = mix(0.035, 0.13, Math.sqrt(t)) - (p[1] > 1.4 ? (p[1] - 1.4) * 1.6 : 0);
    const region = Math.max(inner - u, u - outer, 1.12 - p[1], p[1] - 1.47, -p[2]);
    const shell = Math.max(torso - 0.013, -torso - 0.02);
    d = smin(d, smax(shell, region, 0.012), 0.004);
    d = smin(d, sphere(p, [s * 0.05, 1.112, 0.106], 0.011), 0.004); // coat buttons
  }
  // waistcoat buttons in the V
  for (const y of [1.3, 1.25, 1.2]) d = smin(d, sphere(p, [0.002, y, mix(0.108, 0.122, (y - 1.2) / 0.1)], 0.008), 0.003);

  // neck (slightly thinner than the head mesh's neck so the two never overlap exactly)
  d = smin(d, limb(p, [0, 1.44, -0.012], [0.004, 1.63, -0.01], 0.055, 0.051), 0.03);
  // tall Victorian collar and a wrapped cravat, which hide the seam with the head
  d = smin(d, cylinder(p, [0.003, 1.52, 0.008], 0.072, 0.06, [0.12, 0, 0]), 0.012);
  d = smin(d, cylinder(p, [0.003, 1.475, 0.01], 0.074, 0.022, [0.12, 0, 0]), 0.012);
  d = smin(d, ellipsoid(p, [0.004, 1.468, 0.082], [0.026, 0.022, 0.022]), 0.008); // cravat knot
  for (const s of [-1, 1]) d = smin(d, ellipsoid(p, [s * 0.036, 1.47, 0.076], [0.03, 0.019, 0.016], [0, 0, s * 0.3]), 0.008); // bow
  d = smin(d, ellipsoid(p, [0.004, 1.415, 0.1], [0.028, 0.045, 0.014], [-0.3, 0, 0]), 0.012); // ends tucked into the waistcoat
  d = smin(d, torus(p, [0.003, 1.578, 0.016], 0.072, 0.004, [0.12, 0, 0]), 0.008); // rolled top edge of the collar

  // right arm, hanging, holding his top hat by the brim
  let arm = smin(limb(p, J.rShoulder, J.rElbow, 0.056, 0.047), limb(p, J.rElbow, J.rWrist, 0.047, 0.039), 0.015);
  arm = smin(arm, ellipsoid(p, [-0.28, 0.845, 0.045], [0.028, 0.06, 0.046], [0.1, 0, 0.12]), 0.012);
  arm = smin(arm, limb(p, [-0.268, 0.86, 0.075], [-0.262, 0.83, 0.088], 0.012, 0.01), 0.006); // thumb
  // the hat's axis points out to his right, its open side turned in toward his leg
  const hatAngles = [0, 0.25, Math.PI / 2 - 0.1];
  const brim = [-0.305, 0.745, 0.05];
  const axis = rot([0, -1, 0], ...hatAngles); // from the brim toward the crown
  const at = (k) => [brim[0] + axis[0] * k, brim[1] + axis[1] * k, brim[2] + axis[2] * k];
  let hat = cylinder(p, at(0.085), 0.08, 0.078, hatAngles);
  hat = smin(hat, cylinder(p, brim, 0.124, 0.011, hatAngles), 0.016);
  hat = smin(hat, torus(p, at(0.022), 0.081, 0.008, hatAngles), 0.004); // hat band
  hat = smin(hat, cylinder(p, at(0.161), 0.083, 0.006, hatAngles), 0.008); // crown edge
  arm = smin(arm, hat, 0.006);
  d = smin(d, arm, 0.02);

  // left arm, bent, holding a closed book against his chest
  arm = smin(limb(p, J.lShoulder, J.lElbow, 0.056, 0.047), limb(p, J.lElbow, J.lWrist, 0.047, 0.039), 0.015);
  const bookC = [0.062, 1.2, 0.165];
  const bookA = [-0.32, 0.12, 0.32];
  let book = roundBox(p, bookC, [0.088, 0.118, 0.022], 0.006, bookA);
  book = smin(book, roundBox(p, [bookC[0] - 0.084, bookC[1] - 0.02, bookC[2]], [0.008, 0.11, 0.024], 0.006, bookA), 0.004);
  arm = smin(arm, ellipsoid(p, [0.118, 1.17, 0.172], [0.03, 0.052, 0.042], [0.2, 0.3, 0.5]), 0.012);
  for (const k of [0, 1, 2]) arm = smin(arm, limb(p, [0.1 - k * 0.012, 1.2 - k * 0.022, 0.19], [0.07 - k * 0.012, 1.215 - k * 0.022, 0.195], 0.01, 0.009), 0.005); // fingers
  arm = Math.min(arm, book);
  d = smin(d, arm, 0.02);

  // coat cuffs
  d = smin(d, torus(p, [-0.266, 0.925, 0.025], 0.043, 0.01, [0.25, 0, 0.1]), 0.006);
  d = smin(d, torus(p, [0.165, 1.158, 0.115], 0.043, 0.01, [1.3, 0.6, 0]), 0.006);
  return d;
}

// The head mesh: neck, head and hair.
function headPart(p) {
  return smin(limb(p, [0, 1.44, -0.012], [0.004, 1.63, -0.01], 0.058, 0.054), headAndHair(p), 0.025);
}
const SDF = { body, head: headPart };

// ---------------------------------------------------------------- surface nets
function surfaceNets(sdf, { cell, min, max }) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const idx = (i, j, k) => i + nx * (j + ny * k);
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) field[idx(i, j, k)] = sdf([min[0] + i * cell, min[1] + j * cell, min[2] + k * cell]);
    }
  }
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
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let count = 0;
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
  // snap vertices onto the true surface; normals from the field's gradient
  const grad = (x, y, z) => {
    const e = cell * 0.5;
    const gx = sdf([x + e, y, z]) - sdf([x - e, y, z]);
    const gy = sdf([x, y + e, z]) - sdf([x, y - e, z]);
    const gz = sdf([x, y, z + e]) - sdf([x, y, z - e]);
    const L = Math.hypot(gx, gy, gz) || 1;
    return [gx / L, gy / L, gz / L];
  };
  const normals = new Float32Array(positions.length);
  for (let n = 0; n < positions.length; n += 3) {
    let [x, y, z] = [positions[n], positions[n + 1], positions[n + 2]];
    for (let step = 0; step < 2; step++) {
      const f = clamp(sdf([x, y, z]), -cell * 0.5, cell * 0.5);
      const g = grad(x, y, z);
      x -= g[0] * f;
      y -= g[1] * f;
      z -= g[2] * f;
    }
    positions[n] = x;
    positions[n + 1] = y;
    positions[n + 2] = z;
    normals.set(grad(x, y, z), n);
  }
  // wind each triangle to face outward
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t] * 3, tris[t + 1] * 3, tris[t + 2] * 3];
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const fx = e1[1] * e2[2] - e1[2] * e2[1];
    const fy = e1[2] * e2[0] - e1[0] * e2[2];
    const fz = e1[0] * e2[1] - e1[1] * e2[0];
    const nn = [normals[a] + normals[b] + normals[c], normals[a + 1] + normals[b + 1] + normals[c + 1], normals[a + 2] + normals[b + 2] + normals[c + 2]];
    if (fx * nn[0] + fy * nn[1] + fz * nn[2] < 0) [tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]];
  }
  return { positions: new Float32Array(positions), normals, indices: tris };
}

// ---------------------------------------------------------------- write a compact .glb
// Positions are stored as 16-bit integers and normals as 8-bit (KHR_mesh_quantization),
// which makes the file about a third of the size. Texture coordinates are made in the museum.
const pad4 = (n) => (n + 3) & ~3;
const bin = [];
let offset = 0;
const bufferViews = [];
const accessors = [];
const nodes = [];
const meshes = [];
function addView(typed, target, byteStride) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target, ...(byteStride ? { byteStride } : {}) });
  bin.push(bytes, Buffer.alloc(pad4(bytes.length) - bytes.length));
  offset = pad4(offset + bytes.length);
  return bufferViews.length - 1;
}

for (const part of PARTS.filter((p) => !process.env.STATUE_PARTS || process.env.STATUE_PARTS.split(',').includes(p.name))) {
  console.time(part.name);
  const { positions, normals, indices } = surfaceNets(SDF[part.name], part);
  console.timeEnd(part.name);
  const count = positions.length / 3;
  console.log(`${part.name}: ${count} vertices, ${indices.length / 3} triangles`);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let n = 0; n < positions.length; n += 3) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], positions[n + a]);
      hi[a] = Math.max(hi[a], positions[n + a]);
    }
  }
  const center = lo.map((l, a) => (l + hi[a]) / 2);
  const half = lo.map((l, a) => (hi[a] - l) / 2);
  const qpos = new Int16Array(count * 4); // padded to 8 bytes per vertex
  const qnor = new Int8Array(count * 4); // padded to 4 bytes per vertex
  for (let n = 0; n < count; n++) {
    for (let a = 0; a < 3; a++) {
      qpos[n * 4 + a] = Math.round(((positions[n * 3 + a] - center[a]) / half[a]) * 32767);
      qnor[n * 4 + a] = Math.round(normals[n * 3 + a] * 127);
    }
  }
  const posView = addView(qpos, 34962, 8);
  const norView = addView(qnor, 34962, 4);
  const wide = count > 65535; // 16-bit indices when they fit
  const idxView = addView(wide ? new Uint32Array(indices) : new Uint16Array(indices), 34963);
  accessors.push(
    { bufferView: posView, componentType: 5122, normalized: true, count, type: 'VEC3', min: [-32767, -32767, -32767], max: [32767, 32767, 32767] },
    { bufferView: norView, componentType: 5120, normalized: true, count, type: 'VEC3' },
    { bufferView: idxView, componentType: wide ? 5125 : 5123, count: indices.length, type: 'SCALAR' },
  );
  const a0 = accessors.length - 3;
  meshes.push({ name: part.name, primitives: [{ attributes: { POSITION: a0, NORMAL: a0 + 1 }, indices: a0 + 2, material: 0 }] });
  nodes.push({ name: part.name, mesh: meshes.length - 1, translation: center, scale: half });
}

const gltf = {
  asset: { version: '2.0', generator: 'make-statue.mjs (David Destroyers Digital Exhibit)' },
  extensionsUsed: ['KHR_mesh_quantization'],
  extensionsRequired: ['KHR_mesh_quantization'],
  scene: 0,
  scenes: [{ nodes: nodes.map((_, n) => n) }],
  nodes,
  meshes,
  materials: [{ name: 'marble', pbrMetallicRoughness: { baseColorFactor: [0.94, 0.93, 0.9, 1], metallicFactor: 0, roughnessFactor: 0.35 } }],
  buffers: [{ byteLength: offset }],
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
