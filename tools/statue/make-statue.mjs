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

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/models/copperfield.glb');
// The head is meshed on a finer grid than the body; the seam between them hides inside the high collar.
const PARTS = [
  { name: 'body', cell: 0.0085, min: [-0.5, -0.005, -0.3], max: [0.42, 1.6, 0.36] },
  { name: 'head', cell: 0.0026, min: [-0.14, 1.535, -0.14], max: [0.16, 1.885, 0.18] },
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
const HEAD = { c: [0.006, 1.697, 0.024], r: [0.095, 0.124, 0.11], yaw: 0.26, pitch: -0.05 };

// Head features, as offsets on a unit sphere (face toward +z), carried over from the bust.
const FACE = [
  [[0, 0.25, 0.95], [0.5, 0.075, 0.3], 0.075], // brow ridge
  [[0, 0.55, 0.82], [0.5, 0.25, 0.3], 0.02], // forehead
  [[0, 0.2, 0.98], [0.07, 0.06, 0.2], -0.02], // between the brows
  [[0, 0.02, 1], [0.06, 0.12, 0.2], 0.035], // bridge of the nose
  [[0, -0.12, 1], [0.075, 0.1, 0.2], 0.075],
  [[0, -0.22, 0.97], [0.08, 0.065, 0.2], 0.115], // tip of the nose
  [[0, -0.345, 0.95], [0.05, 0.03, 0.1], -0.006],
  [[0, -0.425, 0.94], [0.14, 0.03, 0.15], 0.03], // upper lip
  [[0, -0.47, 0.94], [0.15, 0.012, 0.15], -0.022], // line between the lips
  [[0, -0.515, 0.91], [0.11, 0.035, 0.15], 0.035], // lower lip
  [[0, -0.6, 0.87], [0.12, 0.035, 0.15], -0.025], // fold under the lip
  [[0, -0.7, 0.76], [0.22, 0.12, 0.25], 0.1], // chin
];
for (const s of [-1, 1]) {
  FACE.push(
    [[s * 0.32, 0.11, 0.94], [0.17, 0.1, 0.2], -0.14], // eye socket
    [[s * 0.32, 0.08, 0.965], [0.075, 0.05, 0.1], 0.065], // eyeball
    [[s * 0.31, 0.075, 0.99], [0.022, 0.022, 0.1], -0.018], // drilled pupil, as in Victorian portrait busts
    [[s * 0.32, 0.125, 0.96], [0.08, 0.018, 0.1], 0.012], // upper lid
    [[s * 0.33, 0.01, 0.95], [0.09, 0.025, 0.1], 0.01], // lower lid
    [[s * 0.52, -0.06, 0.8], [0.2, 0.13, 0.25], 0.07], // cheekbone
    [[s * 0.42, -0.36, 0.8], [0.14, 0.14, 0.3], -0.025], // cheek hollow
    [[s * 0.62, -0.5, 0.45], [0.22, 0.2, 0.28], 0.06], // angle of the jaw
    [[s * 0.98, 0.02, -0.05], [0.07, 0.22, 0.15], 0.13], // ear
    [[s * 0.11, -0.28, 0.97], [0.055, 0.045, 0.1], 0.035], // nostril wing
    [[s * 0.21, -0.39, 0.92], [0.035, 0.09, 0.1], -0.018], // smile line
    [[s * 0.19, -0.475, 0.93], [0.04, 0.04, 0.1], -0.015], // corner of the mouth
  );
}

// Head and hair in the head's own unit-sphere space; returns a distance in meters.
function headAndHair(p) {
  let q = [p[0] - HEAD.c[0], p[1] - HEAD.c[1], p[2] - HEAD.c[2]];
  q = unrot(q, HEAD.pitch, HEAD.yaw, 0);
  q = [q[0] / HEAD.r[0], q[1] / HEAD.r[1], q[2] / HEAD.r[2]];
  const L = len3(...q);
  if (L > 1.6) return (L - 1.3) * HEAD.r[0]; // far away: cheap estimate
  const n = [q[0] / L, q[1] / L, q[2] / L];
  const jaw = smoothstep(0.1, -0.9, n[1]);
  const taper = 1 - 0.12 * jaw; // the jaw narrows toward the chin
  const qt = [q[0] / taper, q[1], q[2]];
  const Lt = len3(...qt);
  const nt = [qt[0] / Lt, qt[1] / Lt, qt[2] / Lt];
  let d = 0;
  for (const [c, r, a] of FACE) d += bump(nt, c, r, a);
  const head = Lt - (1 + d);

  // hair: high hairline at the forehead, above the ears at the sides, low at the nape;
  // thick waves swept back from a part on his left
  const f = nt[2];
  const hairline = f >= 0 ? mix(0.2, 0.36, f) : mix(0.2, -0.62, -f);
  const grow = smoothstep(hairline - 0.08, hairline + 0.16, nt[1]);
  const partX = -0.3;
  const waves = Math.sin((nt[0] - partX) * 12 + nt[2] * 4 + Math.sin(nt[1] * 6) * 1.6) * 0.02;
  const strands = Math.sin((nt[0] - partX) * 55 + nt[2] * 8) * 0.004;
  let h = 0.085 + waves + strands;
  h += bump(nt, [-0.05, 0.78, 0.58], [0.45, 0.22, 0.32], 0.11);
  h += bump(nt, [0.4, 0.72, 0.25], [0.35, 0.25, 0.4], 0.045);
  h += bump(nt, [-0.55, 0.55, 0.35], [0.25, 0.3, 0.4], 0.03);
  h += bump(nt, [partX, 0.9, 0.3], [0.025, 0.35, 0.7], -0.035);
  h -= bump(nt, [Math.sign(nt[0]) * 0.95, 0, 0], [0.12, 0.3, 0.25], 0.05);
  const hair = Lt - (0.93 + (0.07 + h) * grow);
  return smin(head, hair, 0.02) * HEAD.r[0] * 0.95;
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
  d = smin(d, limb(p, J.neckBase, J.neckTop, 0.059, 0.055), 0.03);
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
  return smin(limb(p, J.neckBase, J.neckTop, 0.062, 0.058), headAndHair(p), 0.025);
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

for (const part of PARTS) {
  console.time(part.name);
  const { positions, normals, indices } = surfaceNets(SDF[part.name], part);
  console.timeEnd(part.name);
  const count = positions.length / 3;
  if (count >= 65536) throw new Error(`${part.name}: ${count} vertices is too many for 16-bit indices; use a coarser cell`);
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
  const idxView = addView(new Uint16Array(indices), 34963);
  accessors.push(
    { bufferView: posView, componentType: 5122, normalized: true, count, type: 'VEC3', min: [-32767, -32767, -32767], max: [32767, 32767, 32767] },
    { bufferView: norView, componentType: 5120, normalized: true, count, type: 'VEC3' },
    { bufferView: idxView, componentType: 5123, count: indices.length, type: 'SCALAR' },
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
