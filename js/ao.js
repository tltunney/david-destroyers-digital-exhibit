// Baked soft shadows. Real rooms are darker where surfaces meet: along the base of walls, in corners,
// and under furniture. That shading is painted once into small textures (ambient occlusion maps),
// so it costs nothing while walking.
import * as THREE from 'three';
import { SIDES, HALF_WALL, wallLength, wallPoint, solidRanges, compass } from './world.js';
import { softShadow } from './materials.js';

const AO_PPM = 24; // floor/ceiling shadow texture: pixels per meter

function shadowBand(grad, strength = 1) {
  grad.addColorStop(0, `rgba(0,0,0,${0.45 * strength})`);
  grad.addColorStop(0.3, `rgba(0,0,0,${0.18 * strength})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  return grad;
}

function whiteCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx };
}

// Draws an object's footprint (box or round, possibly turned) as a canvas path.
function footprintShape(ctx, cx, cy, f, ppm) {
  const hw = (f.w / 2) * ppm;
  const hd = (f.d / 2) * ppm;
  // the object turns by `rot` around the vertical axis; on the canvas (z pointing down) that is -rot
  const r = -(f.rot ?? 0);
  if (f.round) {
    ctx.ellipse(cx, cy, hw, hd, r, 0, Math.PI * 2);
    return;
  }
  const c = Math.cos(r);
  const s = Math.sin(r);
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], k) => {
    const x = cx + sx * hw * c - sy * hd * s;
    const y = cy + sx * hw * s + sy * hd * c;
    if (k) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
}

function footprintShadows(ctx, footprints, toCanvas, ppm) {
  for (const f of footprints) {
    const [cx, cy] = toCanvas(f.x, f.z);
    const shape = () => footprintShape(ctx, cx, cy, f, ppm);
    softShadow(ctx, shape, 0.45 * ppm, 0.4); // wide and soft
    softShadow(ctx, shape, 0.08 * ppm, 0.55); // tight contact shadow
  }
}

// Floor (or ceiling) shadow map: dark bands along the walls and soft shadows under objects.
export function roomAO(room, { doors = true, objects = true, strength = 1 } = {}) {
  const { x, z, w, d } = room;
  const { canvas, ctx } = whiteCanvas(Math.ceil(w * AO_PPM), Math.ceil(d * AO_PPM));
  const px = (wx) => (wx - (x - w / 2)) * AO_PPM;
  const pz = (wz) => (wz - (z - d / 2)) * AO_PPM;
  const band = 0.6 * AO_PPM;
  for (const side of Object.keys(SIDES)) {
    const s = SIDES[side];
    const len = wallLength(room, side);
    const ranges = doors ? solidRanges(room, side) : [[-len / 2, len / 2]];
    for (const [a, b] of ranges) {
      const p0 = wallPoint(room, side, a, HALF_WALL);
      const p1 = wallPoint(room, side, b, HALF_WALL);
      const inward = -s.sign * band;
      if (s.horizontal) {
        const y0 = pz(p0.z);
        ctx.fillStyle = shadowBand(ctx.createLinearGradient(0, y0, 0, y0 + inward), strength);
        ctx.fillRect(px(p0.x), Math.min(y0, y0 + inward), px(p1.x) - px(p0.x), band);
      } else {
        const x0 = px(p0.x);
        ctx.fillStyle = shadowBand(ctx.createLinearGradient(x0, 0, x0 + inward, 0), strength);
        ctx.fillRect(Math.min(x0, x0 + inward), pz(p0.z), band, pz(p1.z) - pz(p0.z));
      }
    }
  }
  if (objects) footprintShadows(ctx, room.footprints, (fx, fz) => [px(fx), pz(fz)], AO_PPM);
  return new THREE.CanvasTexture(canvas);
}

// Wall shadow map: darker toward the floor, the ceiling, and both corners.
export function wallAO(room, side) {
  const len = wallLength(room, side);
  const { canvas, ctx } = whiteCanvas(Math.ceil(len * 16), Math.ceil(room.height * 32));
  const { width: cw, height: ch } = canvas;
  const floorBand = 0.5 * 32;
  const ceilBand = 0.6 * 32;
  const cornerBand = 0.6 * 16;
  ctx.fillStyle = shadowBand(ctx.createLinearGradient(0, ch, 0, ch - floorBand));
  ctx.fillRect(0, ch - floorBand, cw, floorBand);
  ctx.fillStyle = shadowBand(ctx.createLinearGradient(0, 0, 0, ceilBand), 0.8);
  ctx.fillRect(0, 0, cw, ceilBand);
  ctx.fillStyle = shadowBand(ctx.createLinearGradient(0, 0, cornerBand, 0), 0.8);
  ctx.fillRect(0, 0, cornerBand, ch);
  ctx.fillStyle = shadowBand(ctx.createLinearGradient(cw, 0, cw - cornerBand, 0), 0.8);
  ctx.fillRect(cw - cornerBand, 0, cornerBand, ch);
  return new THREE.CanvasTexture(canvas);
}

// Shadow map for the rotunda floor: dark along the walls (not across doorways) and under objects.
export function rotundaAO(room, R, faceW) {
  const ppm = AO_PPM;
  const S = Math.ceil(2 * R * ppm);
  const { canvas, ctx } = whiteCanvas(S, S);
  const c = S / 2;
  const band = 0.6 * ppm;
  for (let k = 0; k < 8; k++) {
    const deg = k * 45;
    const n = compass(deg);
    const t = compass(deg + 90); // along the face
    const opening = room.openings.find((o) => ((o.angle % 360) + 360) % 360 === deg);
    const ranges = opening ? [[-faceW / 2, -opening.width / 2], [opening.width / 2, faceW / 2]] : [[-faceW / 2, faceW / 2]];
    const a = room.apothem - HALF_WALL;
    for (const [from, to] of ranges) {
      const p = (along, depth) => [c + (n.x * (a - depth) + t.x * along) * ppm, c + (n.z * (a - depth) + t.z * along) * ppm];
      ctx.fillStyle = shadowBand(ctx.createLinearGradient(...p(0, 0), ...p(0, band / ppm)));
      ctx.beginPath();
      [p(from, 0), p(to, 0), p(to, band / ppm), p(from, band / ppm)].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    }
  }
  footprintShadows(ctx, room.footprints, (fx, fz) => [c + fx * ppm, c + fz * ppm], ppm);
  return new THREE.CanvasTexture(canvas);
}
