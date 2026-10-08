import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { surfaceMaps, surfaceCanvas, TILE_SIZE, SMALL_SCREEN } from './textures.js';
import { MUSEUM, ROOMS } from './config.js';
import { AmbientMusic } from './music.js';
import { Footsteps } from './footsteps.js';

// ---------------------------------------------------------------- constants
const WALL_THICKNESS = 0.4;
const HALF_WALL = WALL_THICKNESS / 2; // each room owns half of a shared wall
const DEFAULT_HEIGHT = 5;
const DOOR_HEIGHT = 3.4;
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.35;
const WALK_SPEED = 4;
const RUN_SPEED = 7.5;
const INTERACT_DISTANCE = 6;
const ROOM_LIGHT = 10;
const LOOK_SPEED = 0.005; // touch: radians of turn per pixel dragged
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const SIDES = {
  north: { horizontal: true,  sign: -1, opposite: 'south', rotY: 0 },
  south: { horizontal: true,  sign: 1,  opposite: 'north', rotY: Math.PI },
  west:  { horizontal: false, sign: -1, opposite: 'east',  rotY: Math.PI / 2 },
  east:  { horizontal: false, sign: 1,  opposite: 'west',  rotY: -Math.PI / 2 },
};
const FACING = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 };

// ---------------------------------------------------------------- setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e12);
// soft "photo studio" light that bounces off everything, plus gentle reflections
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

// near/far kept tight so phones can tell apart surfaces that sit close together (art, mat, wall)
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.12, 120);
camera.rotation.order = 'YXZ';

const controls = new PointerLockControls(camera, document.body);
const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

const colliders = [];     // { minX, maxX, minZ, maxZ } boxes the player can't walk through
const interactables = []; // meshes with userData.exhibit
const blockers = [];      // walls, so exhibits can't be clicked through them
const spinners = [];      // objects that slowly rotate
const animators = [];     // functions called every frame with the time in seconds
const rugs = [];          // where the rugs lie (world space), for the sound of footsteps

for (const room of ROOMS) {
  room.height ??= DEFAULT_HEIGHT;
  room.doors ??= {};
  for (const side of Object.keys(SIDES)) room.doors[side] ??= [];
  room.footprints = []; // things standing on the floor, for the baked floor shadows
  room.openings ??= [];
}

// Gallery wings attached to the rotunda: work out where each one sits and turns,
// and cut matching doorways in the wing and in the rotunda wall it touches.
for (const room of ROOMS) {
  if (room.attach) {
    const hub = ROOMS.find((r) => r.id === room.attach.to);
    const angle = THREE.MathUtils.degToRad(room.attach.angle);
    const dist = hub.apothem + room.d / 2;
    room.x = hub.x + Math.sin(angle) * dist;
    room.z = hub.z - Math.cos(angle) * dist;
    room.rot = -angle; // the wing's own "north" points away from the rotunda
    const width = room.attach.door ?? 4;
    room.doors.south.push({ at: 0, width, to: hub });
    hub.openings.push({ angle: room.attach.angle, width, to: room });
  }
}
for (const room of ROOMS) {
  for (const opening of room.openings) {
    if (!opening.link) continue;
    const other = ROOMS.find((r) => r.id === opening.link);
    other.doors.north.push({ at: 0, width: opening.width, to: room });
    opening.to = other;
  }
}

// ---------------------------------------------------------------- geometry helpers
function wallPlane(room, side) {
  const s = SIDES[side];
  return s.horizontal ? room.z + (s.sign * room.d) / 2 : room.x + (s.sign * room.w) / 2;
}
const wallCenter = (room, side) => (SIDES[side].horizontal ? room.x : room.z);
const wallLength = (room, side) => (SIDES[side].horizontal ? room.w : room.d);

// World x/z of a point `along` a wall, `inset` meters in from the wall's outer plane.
function wallPoint(room, side, along, inset) {
  const s = SIDES[side];
  const inward = wallPlane(room, side) - s.sign * inset;
  return s.horizontal ? { x: room.x + along, z: inward } : { x: inward, z: room.z + along };
}

// The parts of a wall that are solid from the floor up (everything except the doorways), as [from, to] offsets.
function solidRanges(room, side) {
  const len = wallLength(room, side);
  const ranges = [];
  let cursor = -len / 2;
  const openings = room.doors[side].map((door) => [door.at - door.width / 2, door.at + door.width / 2]).sort((p, q) => p[0] - q[0]);
  for (const [a, b] of openings) {
    if (a > cursor) ranges.push([cursor, a]);
    cursor = b;
  }
  if (cursor < len / 2) ranges.push([cursor, len / 2]);
  return ranges;
}

// Each room is built in its own local space (centered on 0,0, unturned) inside a group that places
// and turns it in the world. `parent` is the group being built into; `frame` is its placement.
let parent = scene;
let frame = { x: 0, z: 0, rot: 0 };

function toWorld(lx, lz, f = frame) {
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c };
}
function toLocal(wx, wz, f) {
  const dx = wx - f.x;
  const dz = wz - f.z;
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
const roomFrame = (room) => ({ x: room.x, z: room.z, rot: room.rot ?? 0 });

// Solid boxes the visitor can't walk through, stored in world space and allowed to sit at an angle.
function addCollider(x, z, w, d, rot = 0) {
  const p = toWorld(x, z);
  const total = frame.rot + rot;
  colliders.push({ x: p.x, z: p.z, hw: w / 2, hd: d / 2, c: Math.cos(total), s: Math.sin(total) });
}

function addBox(w, h, d, material, x, y, z, collide = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  if (collide) addCollider(x, z, w, d);
  return mesh;
}

// A door declared on one room gets a matching opening in the room behind that wall.
function linkDoors() {
  const plain = (r) => !r.rot && !r.shape;
  for (const a of ROOMS.filter(plain)) {
    for (const side of Object.keys(SIDES)) {
      for (const door of [...a.doors[side]]) {
        if (door.to) continue;
        const opp = SIDES[side].opposite;
        const world = wallCenter(a, side) + door.at;
        for (const b of ROOMS.filter(plain)) {
          if (b === a || Math.abs(wallPlane(b, opp) - wallPlane(a, side)) > 0.01) continue;
          const local = world - wallCenter(b, opp);
          if (Math.abs(local) + door.width / 2 > wallLength(b, opp) / 2 + 0.01) continue;
          let match = b.doors[opp].find((d) => Math.abs(d.at - local) < 0.01);
          if (!match) {
            match = { at: local, width: door.width };
            b.doors[opp].push(match);
          }
          door.to = b;
          match.to = a;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- canvas textures
function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function seededRandom(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shade(color, amount) {
  return '#' + new THREE.Color(color).offsetHSL(0, 0, amount).getHexString();
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

// ---------------------------------------------------------------- baked soft shadows
// Real rooms are darker where surfaces meet: along the base of walls, in corners, and under furniture.
// That shading is painted once into small textures (ambient occlusion maps), so it costs nothing while walking.
const AO_PPM = 24; // floor/ceiling shadow texture: pixels per meter

// Paints only the blurred shadow of a shape (the shape itself is drawn far off the canvas).
function softShadow(ctx, drawShape, blur, alpha) {
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 10000;
  ctx.translate(-10000, 0);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  drawShape();
  ctx.fill();
  ctx.restore();
}

function shadowBand(grad, strength = 1) {
  grad.addColorStop(0, `rgba(0,0,0,${0.45 * strength})`);
  grad.addColorStop(0.3, `rgba(0,0,0,${0.18 * strength})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  return grad;
}

// Floor (or ceiling) shadow map: dark bands along the walls and soft shadows under objects.
function roomAO(room, { doors = true, objects = true, strength = 1 } = {}) {
  const { x, z, w, d } = room;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * AO_PPM);
  canvas.height = Math.ceil(d * AO_PPM);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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
  if (objects) {
    for (const f of room.footprints) {
      const shape = () => footprintShape(ctx, px(f.x), pz(f.z), f, AO_PPM);
      softShadow(ctx, shape, 0.45 * AO_PPM, 0.4); // wide and soft
      softShadow(ctx, shape, 0.08 * AO_PPM, 0.55); // tight contact shadow
    }
  }
  return new THREE.CanvasTexture(canvas);
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

// Wall shadow map: darker toward the floor, the ceiling, and both corners.
function wallAO(room, side) {
  const len = wallLength(room, side);
  const H = room.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(len * 16);
  canvas.height = Math.ceil(H * 32);
  const { width: cw, height: ch } = canvas;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
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

// ---------------------------------------------------------------- wall decals
// A pool of warm light thrown onto the wall by a ceiling spotlight (brightest at the top, fading down).
const WASH_TEX = canvasTexture(256, 512, (ctx, w, h) => {
  ctx.translate(w / 2, h * 0.12);
  ctx.scale(1, 2.4);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.5);
  g.addColorStop(0, 'rgba(255,238,215,1)');
  g.addColorStop(0.45, 'rgba(255,234,210,0.45)');
  g.addColorStop(1, 'rgba(255,234,210,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-w, -h, w * 2, h * 2);
});

// The soft shadow a frame or panel casts on the wall behind it.
const SHADOW_INSET = 40 / 256;
const SHADOW_TEX = canvasTexture(256, 256, (ctx, w, h) => {
  const i = w * SHADOW_INSET;
  softShadow(ctx, () => ctx.rect(i, i, w - 2 * i, h - 2 * i), 22, 0.95);
});

function decal(map, w, h, { additive = false, opacity = 1, layer = 1 } = {}) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      map, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer,
    }),
  );
}

// Adds the wall shadow and spotlight wash behind something hanging on a wall (local coordinates of its group).
function addWallLighting(group, w, h, washWidth = w + 1.8, withWash = true) {
  const scale = 1 / (1 - 2 * SHADOW_INSET);
  const shadow = decal(SHADOW_TEX, w * scale, h * scale, { opacity: 0.5, layer: 1 });
  shadow.position.set(0, -0.05, 0.012);
  if (!withWash) {
    group.add(shadow);
    return;
  }
  const wash = decal(WASH_TEX, washWidth, h + 2.6, { additive: true, opacity: 0.42, layer: 2 });
  wash.position.set(0, 0.35, 0.022);
  group.add(shadow, wash);
}

// A ceiling track spotlight aimed at an exhibit on a wall.
const SPOT_PARTS = {
  can: new THREE.CylinderGeometry(0.065, 0.055, 0.22, 20).rotateX(Math.PI / 2),
  lens: new THREE.CircleGeometry(0.048, 20),
  stem: new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8),
};
function addTrackSpot(room, side, along, targetY) {
  const p = wallPoint(room, side, along, 1.3);
  const target = wallPoint(room, side, along, HALF_WALL);
  const group = new THREE.Group();
  group.position.set(p.x, room.height - 0.28, p.z);
  const stem = new THREE.Mesh(SPOT_PARTS.stem, MAT.metal);
  stem.position.y = 0.12;
  const pivot = new THREE.Group();
  const can = new THREE.Mesh(SPOT_PARTS.can, MAT.metal);
  const lens = new THREE.Mesh(SPOT_PARTS.lens, MAT.light);
  lens.position.z = 0.111;
  pivot.add(can, lens);
  group.add(stem, pivot);
  parent.add(group);
  const t = toWorld(target.x, target.z);
  pivot.lookAt(t.x, targetY, t.z);
}

// One black track along each wall that has things hanging on it.
function buildTracks(room) {
  if (room.victorian) return;
  for (const side of Object.keys(SIDES)) {
    const items = (room.exhibits ?? []).filter((ex) => ex.wall === side && (ex.type === 'painting' || ex.type === 'panel'));
    if (!items.length) continue;
    const len = wallLength(room, side);
    const p = wallPoint(room, side, 0, 1.3);
    const s = SIDES[side];
    const [tw, td] = s.horizontal ? [len - 1.2, 0.05] : [0.05, len - 1.2];
    addBox(tw, 0.04, td, MAT.metal, p.x, room.height - 0.06, p.z);
    for (const ex of items) {
      const h = ex.height ?? (ex.type === 'panel' ? 1.6 : 1.7);
      addTrackSpot(room, side, ex.at ?? 0, (ex.y ?? (ex.type === 'panel' ? 1.9 : 2.2)) + h * 0.15);
    }
  }
}

// Beveled picture-frame moulding: a rectangle with a rectangular hole, extruded.
function frameGeometry(outerW, outerH, innerW, innerH, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-outerW / 2, -outerH / 2);
  shape.lineTo(outerW / 2, -outerH / 2);
  shape.lineTo(outerW / 2, outerH / 2);
  shape.lineTo(-outerW / 2, outerH / 2);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-innerW / 2, -innerH / 2);
  hole.lineTo(-innerW / 2, innerH / 2);
  hole.lineTo(innerW / 2, innerH / 2);
  hole.lineTo(innerW / 2, -innerH / 2);
  hole.closePath();
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
}

const WOOD_COLOR = '#d6b68d';

function artTexture(title, accent) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const rand = seededRandom(title);
    const base = new THREE.Color(accent).offsetHSL(rand() - 0.5, 0, 0);
    const hue = (o) => '#' + base.clone().offsetHSL(o, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.4).getHexString();
    const grad = ctx.createLinearGradient(0, 0, w * rand(), h);
    grad.addColorStop(0, hue(0));
    grad.addColorStop(1, hue(0.5));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      ctx.globalAlpha = 0.35 + rand() * 0.5;
      ctx.fillStyle = hue(rand() * 0.6 - 0.3);
      const x = rand() * w, y = rand() * h, s = 30 + rand() * 180;
      ctx.beginPath();
      if (rand() > 0.5) ctx.arc(x, y, s / 2, 0, Math.PI * 2);
      else ctx.rect(x - s / 2, y - s / 2, s, s * (0.3 + rand()));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

// Wall text. Wider panels get a sharper canvas, and the body font shrinks until the text fits.
function textPanelTexture(title, text, widthMeters, aspect, accent) {
  const W = Math.round(THREE.MathUtils.clamp((1024 * widthMeters) / 3, 1024, 2048));
  const H = Math.round(W / aspect);
  const k = W / 1024;
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#27231f';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.fillRect(48 * k, 48 * k, 10 * k, H - 96 * k);
    ctx.fillStyle = '#f4efe6';
    ctx.font = `bold ${64 * k}px ${FONT}`;
    ctx.fillText(title, 90 * k, 116 * k, W - 140 * k);

    const top = 186 * k;
    const bottom = H - 56 * k;
    let size = 40 * k;
    let lines;
    for (; size > 14 * k; size -= 2 * k) {
      ctx.font = `${size}px ${FONT}`;
      lines = wrapText(ctx, text ?? '', W - 160 * k);
      if (lines.length * size * 1.4 <= bottom - top + size) break;
    }
    ctx.fillStyle = '#d6cfc2';
    if (!text) {
      ctx.font = `italic ${36 * k}px ${FONT}`;
      ctx.fillStyle = '#8f877c';
      ctx.fillText('Text coming soon', 90 * k, top);
      return;
    }
    lines.forEach((line, i) => ctx.fillText(line, 90 * k, top + i * size * 1.4));
  });
}

// An empty frame waiting for its exhibit.
function emptySlotTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#ecebe7';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b9b7b0';
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 14]);
    ctx.strokeRect(28, 28, w - 56, h - 56);
    ctx.fillStyle = '#9a978f';
    ctx.font = `28px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('Exhibit coming soon', w / 2, h / 2 + 10);
  });
}

function labelTexture(title, subtitle) {
  return canvasTexture(512, 160, (ctx, w, h) => {
    ctx.fillStyle = '#f3efe7';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = 'bold 44px ' + FONT;
    ctx.fillText(title, 24, 64, w - 48);
    ctx.font = 'italic 30px ' + FONT;
    ctx.fillStyle = '#555';
    ctx.fillText(subtitle ?? 'Click to learn more', 24, 116, w - 48);
  });
}

function signTexture(text, accent) {
  return canvasTexture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#211d19';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, h - 10, w, 10);
    ctx.fillStyle = '#f4efe6';
    ctx.font = 'bold 64px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 - 4, w - 40);
  });
}

// Material that stays readable regardless of lighting.
// `layer` nudges it in front of whatever it sits on, so the two never flicker on phones.
function displayMaterial(map, layer = 0) {
  return new THREE.MeshStandardMaterial({
    map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.85,
    polygonOffset: layer > 0, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer,
  });
}

function loadImage(url, material) {
  textureLoader.load(
    url,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      material.map = tex;
      material.emissiveMap = tex;
      material.needsUpdate = true;
    },
    undefined,
    () => console.warn(`Could not load image "${url}". Check the path in config.js.`),
  );
}

// ---------------------------------------------------------------- shared materials
const MAT = {
  frame: new THREE.MeshStandardMaterial({ color: 0xb48a5c, roughness: 0.45 }),
  oak: new THREE.MeshStandardMaterial({ color: 0xc19a6b, roughness: 0.55 }),
  passepartout: new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.95 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x2f2a25, roughness: 0.6 }),
  pedestal: new THREE.MeshStandardMaterial({ ...surfaceMaps('plaster', '#f4f2ed', 0.5, 0.5), roughness: 1 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35, metalness: 0.85 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a35a, roughness: 0.28, metalness: 1 }),
  rope: new THREE.MeshStandardMaterial({ color: 0x5c0f16, roughness: 0.85 }),
  leather: new THREE.MeshStandardMaterial({ ...surfaceMaps('leather', '#3a2a20', 4.8, 1.2), roughness: 1 }),
  planter: new THREE.MeshStandardMaterial({ ...surfaceMaps('concrete', '#8d8a84', 0.5, 0.5), roughness: 1 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x3d7a3f, roughness: 0.75 }),
  leafDark: new THREE.MeshStandardMaterial({ color: 0x2c5e33, roughness: 0.75 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.25 }),
  // Victorian
  mahogany: new THREE.MeshStandardMaterial({ color: 0x4a2216, roughness: 0.35 }),
  gilt: new THREE.MeshStandardMaterial({ color: 0xc9a24f, roughness: 0.32, metalness: 1 }),
  plasterwork: new THREE.MeshStandardMaterial({ ...surfaceMaps('plaster', '#efe6d4', 1, 1), roughness: 1 }),
  velvet: new THREE.MeshStandardMaterial({ ...surfaceMaps('tufted', '#1d3b2a', 4.4, 1.5), roughness: 1 }),
  gaslight: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 0.95) }),
  counterTop: new THREE.MeshStandardMaterial({ ...surfaceMaps('marble', '#e6dfd2', 2, 0.5), roughness: 1 }),
  caseGlass: new THREE.MeshStandardMaterial({ color: 0xeef4f2, roughness: 0.03, metalness: 0.9, transparent: true, opacity: 0.24, depthWrite: false }),
  felt: new THREE.MeshStandardMaterial({ color: 0x23402f, roughness: 0.95 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xf3ecdc, roughness: 0.9 }),
  bookCover: new THREE.MeshStandardMaterial({ color: 0x5c1a1e, roughness: 0.6 }),
  bankerGreen: new THREE.MeshStandardMaterial({ color: 0x1f6b3a, emissive: 0x0b3a1c, roughness: 0.15, side: THREE.DoubleSide }),
  ceramic: new THREE.MeshStandardMaterial({ color: 0x2c5a4c, roughness: 0.15 }),
  palm: new THREE.MeshStandardMaterial({ color: 0x3e7a3b, roughness: 0.7, side: THREE.DoubleSide }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4e33, roughness: 0.95 }),
  coat: new THREE.MeshStandardMaterial({ color: 0x1f2433, roughness: 0.9 }),
  // brighter than white so the light strips glow (and bloom) after tone mapping
  light: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.85, 2.6) }),
  sky: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.1) }),
};

// ---------------------------------------------------------------- room builders
function buildRoom(room) {
  const { x, z, w, d, height } = room;

  // floor: wood planks or polished concrete, with real grain, seams and shine
  const floorKind = room.floor === 'concrete' ? 'concrete' : 'wood';
  const [ftx, fty] = TILE_SIZE[floorKind];
  const floorMat = new THREE.MeshStandardMaterial({ ...surfaceMaps(floorKind, room.floorColor ?? '#c9a882', w / ftx, d / fty), roughness: 1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0, z);
  floor.receiveShadow = true;
  parent.add(floor);

  // ceiling: wood slats or plain plaster
  const ceilingMaps = room.ceiling === 'wood' ? surfaceMaps('slats', WOOD_COLOR, w, d / TILE_SIZE.slats[1]) : surfaceMaps('plaster', '#f7f4ee', w / 2, d / 2);
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ ...ceilingMaps, roughness: 1, aoMap: roomAO(room, { doors: false, objects: false, strength: 0.8 }) }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(x, height, z);
  parent.add(ceiling);

  // walls (with door openings), baseboards, door trim and signs
  for (const side of Object.keys(SIDES)) buildWall(room, side);
  buildCeilingLights(room);
  buildTracks(room);
  if (room.entrance) buildEntrance(room, room.entrance);
  if (!room.passage && room.fixtures !== false) buildFixtures(room);
  if (room.attach && room.wallTitle !== false) buildWallTitle(room);

  for (const ex of room.exhibits ?? []) {
    if (ex.type === 'painting') buildPainting(room, ex);
    else if (ex.type === 'panel') buildPanel(room, ex);
    else if (ex.type === 'pedestal') buildPedestal(room, ex);
    else if (ex.type === 'case') buildCase(room, ex);
    else if (ex.type === 'door') buildFakeDoor(room, ex);
    else if (ex.type === 'poster') buildPoster(room, ex);
    else console.warn(`Unknown exhibit type "${ex.type}" in room "${room.id}"`);
  }
  for (const item of room.decor ?? []) buildDecor(room, item);

  // now that everything is placed, bake the soft floor shadows
  floorMat.aoMap = roomAO(room);
  floorMat.needsUpdate = true;
}

// Linear LED strips, a glowing cove around the edge, an optional skylight,
// and a couple of real lights (real lights are expensive, so we keep them few).
function buildCeilingLights(room) {
  const { x, z, w, d, height } = room;
  if (room.victorian) {
    // lit by gas-lamp sconces and a brass chandelier instead of LED strips
    const chandelier = !room.passage && room.chandelier !== false;
    if (chandelier) buildChandelier(room);
    const light = new THREE.PointLight(0xffd9a8, ROOM_LIGHT * 1.1 * (height / DEFAULT_HEIGHT), Math.max(w, d) * 1.2, 1);
    light.position.set(x, height - (chandelier ? 1.1 : 0.8), z);
    parent.add(light);
    return;
  }
  const y = height - 0.03;
  const longAlongX = w >= d;
  const span = (longAlongX ? w : d) - 3;
  const across = longAlongX ? d : w;
  const strips = Math.max(2, Math.round(across / 3.5));
  for (let i = 0; i < strips; i++) {
    const off = -across / 2 + (across / strips) * (i + 0.5);
    if (room.skylight && Math.abs(off) < across * 0.3) continue;
    if (longAlongX) addBox(span, 0.04, 0.1, MAT.light, x, y, z + off);
    else addBox(0.1, 0.04, span, MAT.light, x + off, y, z);
  }
  // perimeter cove glow
  const inset = HALF_WALL + 0.25;
  addBox(w - inset * 2, 0.05, 0.06, MAT.light, x, y, z - d / 2 + inset);
  addBox(w - inset * 2, 0.05, 0.06, MAT.light, x, y, z + d / 2 - inset);
  addBox(0.06, 0.05, d - inset * 2, MAT.light, x - w / 2 + inset, y, z);
  addBox(0.06, 0.05, d - inset * 2, MAT.light, x + w / 2 - inset, y, z);

  if (room.skylight) {
    const sw = w * 0.45;
    const sd = d * 0.5;
    addBox(sw, 0.02, sd, MAT.sky, x, height - 0.01, z);
    const n = 4;
    for (let i = 1; i < n; i++) {
      addBox(0.08, 0.1, sd, MAT.metal, x - sw / 2 + (sw / n) * i, height - 0.05, z);
      addBox(sw, 0.1, 0.08, MAT.metal, x, height - 0.05, z - sd / 2 + (sd / n) * i);
    }
    // deep reveal around the skylight opening
    addBox(sw + 0.3, 0.3, 0.15, MAT.metal, x, height - 0.15, z - sd / 2);
    addBox(sw + 0.3, 0.3, 0.15, MAT.metal, x, height - 0.15, z + sd / 2);
    addBox(0.15, 0.3, sd, MAT.metal, x - sw / 2, height - 0.15, z);
    addBox(0.15, 0.3, sd, MAT.metal, x + sw / 2, height - 0.15, z);
  }

  const count = Math.max(w, d) > 18 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i === 0 ? -0.25 : 0.25);
    const light = new THREE.PointLight(0xffe6c8, ROOM_LIGHT * (height / DEFAULT_HEIGHT), Math.max(w, d), 1);
    light.position.set(x + (longAlongX ? w * t : 0), height - 0.8, z + (longAlongX ? 0 : d * t));
    parent.add(light);
  }
}

function buildWall(room, side) {
  const s = SIDES[side];
  const len = wallLength(room, side);
  const H = room.height;
  const wood = side === room.woodWall;
  const kind = wood ? 'slats' : room.wallpaper ? 'damask' : 'plaster';
  const color = wood ? WOOD_COLOR : room.wallpaper ?? (side === room.featureWall ? room.accent ?? '#888' : room.wallColor ?? '#f4f0e8');
  const ao = wallAO(room, side);
  // on the south and west walls the box face's texture runs backwards, so mirror the shadow map
  const mirrored = side === 'south' || side === 'west';

  // split the wall into solid pieces + lintels above each door
  const segments = [];
  let cursor = -len / 2;
  const openings = room.doors[side].map((door) => [door.at - door.width / 2, door.at + door.width / 2]).sort((p, q) => p[0] - q[0]);
  for (const [a, b] of openings) {
    if (a > cursor) segments.push([cursor, a, 0]);
    segments.push([a, b, DOOR_HEIGHT]);
    cursor = b;
  }
  if (cursor < len / 2) segments.push([cursor, len / 2, 0]);

  for (const [a, b, bottom] of segments) {
    const mid = (a + b) / 2;
    const length = b - a;
    const h = H - bottom;
    const p = wallPoint(room, side, mid, HALF_WALL / 2);
    const [bw, bd] = s.horizontal ? [length, HALF_WALL] : [HALF_WALL, length];
    const [tx, ty] = TILE_SIZE[kind];
    const segAO = ao.clone();
    segAO.repeat.set(((mirrored ? -1 : 1) * length) / len, h / H);
    segAO.offset.set((mirrored ? b : a) / len + 0.5, bottom / H);
    const material = new THREE.MeshStandardMaterial({ ...surfaceMaps(kind, color, length / tx, h / ty), roughness: 1, aoMap: segAO });
    const wall = addBox(bw, h, bd, material, p.x, bottom + h / 2, p.z, bottom === 0);
    wall.receiveShadow = true;
    blockers.push(wall);

    if (bottom !== 0) continue;
    // wall finishes stop at the frame of the glass entrance doors
    for (const [p, q] of aroundWallDoors(room, side, a, b)) {
      const pm = (p + q) / 2;
      const pl = q - p;
      if (room.wainscot) addWainscot(room, side, pm, pl);
      else if (!wood) {
        // recessed shadow-gap baseboard, oak
        const bp = wallPoint(room, side, pm, HALF_WALL + 0.015);
        const [tw, td] = s.horizontal ? [pl, 0.03] : [0.03, pl];
        addBox(tw, 0.12, td, MAT.oak, bp.x, 0.07, bp.z);
      }
    }
  }
  if (room.victorian) {
    // moulded plaster cornice where the wall meets the ceiling, with a gilt fillet
    const cp = wallPoint(room, side, 0, HALF_WALL + 0.12);
    const [cw, cd] = s.horizontal ? [len, 0.24] : [0.24, len];
    addBox(cw, 0.36, cd, MAT.plasterwork, cp.x, H - 0.18, cp.z);
    const gp = wallPoint(room, side, 0, HALF_WALL + 0.25);
    const [gw, gd] = s.horizontal ? [len, 0.03] : [0.03, len];
    addBox(gw, 0.05, gd, MAT.gilt, gp.x, H - 0.4, gp.z);
    // picture rail: pictures hang from it on cords, as they did before nails in plaster
    const rp = wallPoint(room, side, 0, HALF_WALL + 0.02);
    const [rw, rd] = s.horizontal ? [len, 0.04] : [0.04, len];
    addBox(rw, 0.05, rd, MAT.mahogany, rp.x, H - PICTURE_RAIL_DROP, rp.z);
  }

  for (const door of room.doors[side]) {
    // light oak frame around the opening
    const along = (off) => wallPoint(room, side, door.at + off, HALF_WALL + 0.02);
    const post = s.horizontal ? [0.1, DOOR_HEIGHT, 0.04] : [0.04, DOOR_HEIGHT, 0.1];
    for (const off of [-door.width / 2 - 0.05, door.width / 2 + 0.05]) {
      const p = along(off);
      addBox(...post, room.victorian ? MAT.mahogany : MAT.oak, p.x, DOOR_HEIGHT / 2, p.z);
    }
    const tp = along(0);
    const top = s.horizontal ? [door.width + 0.2, 0.1, 0.04] : [0.04, 0.1, door.width + 0.2];
    addBox(...top, room.victorian ? MAT.mahogany : MAT.oak, tp.x, DOOR_HEIGHT + 0.05, tp.z);
    // line the opening through this room's half of the wall (the room next door lines its half),
    // so you never see the raw edge of the wall beyond
    const depth = HALF_WALL + 0.03;
    for (const sgn of [-1, 1]) {
      const jp = wallPoint(room, side, door.at + sgn * (door.width / 2 - 0.02), depth / 2);
      addBox(...(s.horizontal ? [0.04, DOOR_HEIGHT, depth] : [depth, DOOR_HEIGHT, 0.04]), room.victorian ? MAT.mahogany : MAT.oak, jp.x, DOOR_HEIGHT / 2, jp.z);
    }
    const sp0 = wallPoint(room, side, door.at, depth / 2);
    addBox(...(s.horizontal ? [door.width, 0.04, depth] : [depth, 0.04, door.width]), room.victorian ? MAT.mahogany : MAT.oak, sp0.x, DOOR_HEIGHT - 0.02, sp0.z);

    // sign above the door naming the room it leads to
    if (door.to && !room.passage) {
      const sp = wallPoint(room, side, door.at, HALF_WALL + 0.02);
      const signW = Math.max(door.width, 3.2);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(signW, signW * (160 / 1024)),
        new THREE.MeshBasicMaterial({ map: signTexture(door.label ?? door.to.name, door.to.accent ?? '#d9a441') }),
      );
      sign.position.set(sp.x, DOOR_HEIGHT + 0.5, sp.z);
      sign.rotation.y = s.rotY;
      parent.add(sign);
    }
  }
}

const ENTRANCE_W = 3.4;

// Victorian wall finish below the wallpaper: raised mahogany panels, a chair rail, and a tall skirting.
const WAINSCOT_H = 1.1;
const PICTURE_RAIL_DROP = 0.62; // how far below the ceiling the picture rail runs
function addWainscot(room, side, mid, length) {
  const s = SIDES[side];
  const box = (thick, h, y, inset, material) => {
    const p = wallPoint(room, side, mid, HALF_WALL + inset);
    const [bw, bd] = s.horizontal ? [length, thick] : [thick, length];
    return addBox(bw, h, bd, material, p.x, y, p.z);
  };
  const [tx, ty] = TILE_SIZE.wainscot;
  box(0.04, WAINSCOT_H, WAINSCOT_H / 2, 0.02, new THREE.MeshStandardMaterial({ ...surfaceMaps('wainscot', '#5a2a1a', length / tx, WAINSCOT_H / ty), roughness: 1 }));
  box(0.08, 0.07, WAINSCOT_H + 0.03, 0.04, MAT.mahogany); // chair rail
  box(0.06, 0.2, 0.1, 0.03, MAT.mahogany); // skirting
}

// A brass gas-lamp sconce with a frosted glass globe and a warm glow on the wall behind it.
const SCONCE_PARTS = {
  plate: new THREE.CylinderGeometry(0.075, 0.075, 0.025, 24).rotateX(Math.PI / 2),
  arm: new THREE.CylinderGeometry(0.014, 0.014, 0.24, 10).rotateX(Math.PI / 2),
  cup: new THREE.CylinderGeometry(0.055, 0.03, 0.07, 20),
  globe: new THREE.SphereGeometry(0.085, 24, 16),
  chimney: new THREE.CylinderGeometry(0.03, 0.04, 0.09, 16, 1, true),
};
const GLOW_TEX = canvasTexture(256, 256, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,214,150,0.9)');
  g.addColorStop(0.4, 'rgba(255,200,130,0.3)');
  g.addColorStop(1, 'rgba(255,200,130,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
});
function addSconce(room, side, at, y = 2.6) {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(SCONCE_PARTS.plate, MAT.gilt);
  plate.position.z = 0.012;
  const arm = new THREE.Mesh(SCONCE_PARTS.arm, MAT.gilt);
  arm.position.set(0, -0.05, 0.13);
  const cup = new THREE.Mesh(SCONCE_PARTS.cup, MAT.gilt);
  cup.position.set(0, -0.03, 0.24);
  const globe = new THREE.Mesh(SCONCE_PARTS.globe, MAT.gaslight);
  globe.position.set(0, 0.07, 0.24);
  const chimney = new THREE.Mesh(SCONCE_PARTS.chimney, MAT.gilt);
  chimney.position.set(0, 0.18, 0.24);
  const glow = decal(GLOW_TEX, 1.5, 1.5, { additive: true, opacity: 0.5, layer: 3 });
  glow.position.set(0, 0.1, 0.03);
  g.add(plate, arm, cup, globe, chimney, glow);
  mountOnWall(room, { wall: side, at }, g, y);
}

// Glass entrance doors with daylight outside and an EXIT sign above, centered on a wall.
function buildEntrance(room, side) {
  const group = new THREE.Group();
  const W = ENTRANCE_W;
  const H = 3;
  const outside = canvasTexture(512, 512, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#cfe3f5');
    sky.addColorStop(0.55, '#eef4f6');
    sky.addColorStop(0.62, '#9fb08f');
    sky.addColorStop(1, '#b9b3a6');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.filter = 'blur(6px)';
    const r = seededRandom('trees');
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(${70 + r() * 40},${105 + r() * 40},${70 + r() * 30},0.85)`;
      ctx.beginPath();
      ctx.arc(r() * w, h * 0.55 + r() * 30, 30 + r() * 60, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const view = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: outside, color: new THREE.Color(1.5, 1.5, 1.5) }));
  view.position.set(0, H / 2, 0.01);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), MAT.glass);
  glass.position.set(0, H / 2, 0.04);
  group.add(view, glass);
  // frame and mullions
  const bar = (bw, bh, bx, by) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.08), MAT.metal);
    m.position.set(bx, by, 0.04);
    group.add(m);
  };
  bar(W + 0.2, 0.12, 0, H + 0.06);
  bar(0.1, H, -W / 2 - 0.05, H / 2);
  bar(0.1, H, W / 2 + 0.05, H / 2);
  bar(0.08, H, 0, H / 2);
  for (const hx of [-0.18, 0.18]) {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.1, 12), MAT.brass);
    handle.position.set(hx, 1.1, 0.12);
    group.add(handle);
  }
  // EXIT sign
  const exit = exitSign();
  exit.position.set(0, H + 0.45, 0.04);
  group.add(exit);
  mountOnWall(room, { wall: side, at: 0 }, group, 0);

  // daylight spilling onto the floor
  const spill = decal(WASH_TEX, W + 1.5, 4, { additive: true, opacity: 0.35 });
  spill.rotation.x = -Math.PI / 2;
  const p = wallPoint(room, side, 0, HALF_WALL + 2);
  spill.position.set(p.x, 0.005, p.z);
  spill.rotation.z = SIDES[side].rotY + Math.PI;
  parent.add(spill);
}

function mountOnWall(room, ex, object, y) {
  const p = wallPoint(room, ex.wall, ex.at ?? 0, HALF_WALL);
  object.position.set(p.x, y, p.z);
  object.rotation.y = SIDES[ex.wall].rotY;
  parent.add(object);
}

function makeInteractive(meshes, exhibit, room) {
  for (const m of meshes) {
    m.userData.exhibit = exhibit;
    m.userData.room = room;
    interactables.push(m);
  }
}

function buildPainting(room, ex) {
  const w = ex.width ?? 2.4;
  const h = ex.height ?? 1.7;
  const y = clearOfWainscot(room, ex.y ?? 2.2, h + 0.4);
  const group = new THREE.Group();

  // beveled oak frame around a white mat, gallery style
  const frame = new THREE.Mesh(frameGeometry(w + 0.4, h + 0.4, w + 0.28, h + 0.28, 0.035), MAT.frame);
  frame.position.z = 0.03; // back of the frame sits just off the wall
  frame.castShadow = true;
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.3, h + 0.3), MAT.passepartout);
  mat.position.z = 0.05;
  const artMat = displayMaterial(ex.title || ex.image ? artTexture(ex.title || 'untitled', room.accent ?? '#888') : emptySlotTexture(), 2);
  if (ex.image) loadImage(ex.image, artMat);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), artMat);
  art.position.z = 0.062;

  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), displayMaterial(labelTexture(ex.title ?? '', ex.subtitle), 1));
  label.position.set(w / 2 + 0.75, -h / 2 + 0.14, 0.03);
  if (w / 2 + 1.1 > 3) label.position.set(0, -h / 2 - 0.4, 0.03); // big paintings: label underneath

  group.add(frame, mat, art);
  if (ex.title) group.add(label);
  if (room.victorian) {
    // two brass cords from hooks on the picture rail to the top corners of the frame
    const railY = room.height - PICTURE_RAIL_DROP - y;
    for (const sgn of [-1, 1]) {
      const hook = new THREE.Vector3(sgn * 0.15, railY - 0.02, 0.045);
      rodBetween(group, hook, new THREE.Vector3(sgn * (w / 2 + 0.05), h / 2 + 0.19, 0.035), 0.004, MAT.gilt);
      piece(group, new THREE.SphereGeometry(0.018, 10, 8), MAT.gilt, hook.x, hook.y, hook.z);
    }
  }
  addWallLighting(group, w + 0.4, h + 0.4, undefined, !room.victorian);
  mountOnWall(room, ex, group, y);
  makeInteractive([frame, mat, art, label], ex, room);
}

// In rooms with wainscot, lift anything on the wall so its bottom clears the chair rail.
function clearOfWainscot(room, y, h) {
  return room.wainscot ? Math.max(y, WAINSCOT_H + 0.25 + h / 2) : y;
}

function buildPanel(room, ex) {
  const w = ex.width ?? 2.4;
  const h = ex.height ?? 1.6;
  const group = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.05),
    [MAT.trim, MAT.trim, MAT.trim, MAT.trim, displayMaterial(textPanelTexture(ex.title ?? '', ex.text, w, w / h, room.accent ?? '#d9a441')), MAT.trim],
  );
  panel.position.z = 0.045; // stands off the wall on hidden spacers
  group.add(panel);
  addWallLighting(group, w, h, w + 1, !room.victorian);
  const y = clearOfWainscot(room, ex.y ?? 1.9, h);
  mountOnWall(room, ex, group, y);
  if (room.victorian && ex.sconces !== false) {
    for (const sgn of [-1, 1]) addSconce(room, ex.wall, (ex.at ?? 0) + sgn * (w / 2 + 0.6), Math.max(2.4, y + 0.4));
  }
  makeInteractive([panel], { ...ex, description: ex.description || ex.text || 'Text coming soon.' }, room);
}

// ---------------------------------------------------------------- the bust
// A marble portrait bust of David Copperfield, sculpted in code: each part starts as a smooth,
// dense shape whose surface is pushed in or out (brow, eye sockets, nose, lips, chin, hair waves...).
// About 1 unit tall, centered on y = 0, facing +z. For a scanned likeness, use `model` in config.js instead.

// A soft round bulge (positive amount) or dent (negative) centered at c, with a radius per axis.
function bump(p, [cx, cy, cz], [rx, ry, rz], amount) {
  const dx = (p.x - cx) / rx;
  const dy = (p.y - cy) / ry;
  const dz = (p.z - cz) / rz;
  return amount * Math.exp(-(dx * dx + dy * dy + dz * dz));
}
const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Moves every vertex with shape(position, originalDirection), then recomputes the smooth shading.
function sculpt(geometry, shape) {
  const pos = geometry.attributes.position;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.copy(p).normalize();
    shape(p, n);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Skull proportions: narrower than tall, and the jaw tapers toward the chin.
function skullShape(p, n) {
  const jaw = smoothstep(0.1, -0.9, n.y);
  p.x *= 0.8 * (1 - 0.18 * jaw);
  p.z *= 0.9;
  if (n.y < 0) p.z += 0.015 * jaw * Math.max(0, n.z); // lower face sits slightly forward
}

function sculptHead() {
  // seam of the sphere turned to the back of the head, where the hair hides it
  return sculpt(new THREE.SphereGeometry(1, 160, 120, -Math.PI / 2), (p, n) => {
    let d = 0;
    d += bump(n, [0, 0.25, 0.95], [0.48, 0.07, 0.3], 0.06); // brow ridge, overhanging the eyes
    d += bump(n, [0, 0.55, 0.82], [0.5, 0.25, 0.3], 0.02); // forehead
    d += bump(n, [0, 0.2, 0.98], [0.07, 0.06, 0.2], -0.02); // between the brows
    for (const s of [-1, 1]) {
      d += bump(n, [s * 0.32, 0.1, 0.94], [0.15, 0.085, 0.2], -0.095); // eye socket
      d += bump(n, [s * 0.32, 0.08, 0.965], [0.07, 0.045, 0.1], 0.05); // eyeball
      d += bump(n, [s * 0.32, 0.125, 0.96], [0.08, 0.018, 0.1], 0.012); // upper eyelid
      d += bump(n, [s * 0.33, 0.01, 0.95], [0.09, 0.025, 0.1], 0.01); // lower eyelid
      d += bump(n, [s * 0.5, -0.08, 0.82], [0.18, 0.12, 0.25], 0.045); // cheekbone
      d += bump(n, [s * 0.42, -0.36, 0.8], [0.14, 0.14, 0.3], -0.025); // cheek hollow
      d += bump(n, [s * 0.62, -0.55, 0.45], [0.2, 0.18, 0.25], 0.03); // angle of the jaw
      d += bump(n, [s * 0.98, 0.02, -0.05], [0.07, 0.22, 0.15], 0.13); // ear
      d += bump(n, [s * 0.11, -0.3, 0.97], [0.055, 0.04, 0.1], 0.065); // nostril wing
      d += bump(n, [s * 0.21, -0.39, 0.92], [0.035, 0.09, 0.1], -0.018); // smile line
      d += bump(n, [s * 0.19, -0.475, 0.93], [0.04, 0.04, 0.1], -0.018); // corner of the mouth
    }
    d += bump(n, [0, 0.02, 1], [0.06, 0.12, 0.2], 0.05); // bridge of the nose
    d += bump(n, [0, -0.13, 1], [0.07, 0.1, 0.2], 0.11);
    d += bump(n, [0, -0.25, 0.97], [0.075, 0.065, 0.2], 0.16); // tip of the nose
    d += bump(n, [0, -0.345, 0.95], [0.045, 0.025, 0.1], -0.01);
    d += bump(n, [0, -0.425, 0.94], [0.14, 0.028, 0.15], 0.03); // upper lip
    d += bump(n, [0, -0.47, 0.94], [0.16, 0.01, 0.15], -0.035); // line between the lips
    d += bump(n, [0, -0.515, 0.91], [0.11, 0.032, 0.15], 0.035); // lower lip
    d += bump(n, [0, -0.6, 0.87], [0.12, 0.035, 0.15], -0.03); // fold under the lip
    d += bump(n, [0, -0.73, 0.76], [0.2, 0.12, 0.25], 0.11); // chin
    p.multiplyScalar(1 + d);
    skullShape(p, n);
  });
}

// Thick, wavy hair swept back from a side part, with Victorian sideburns.
function sculptHair() {
  return sculpt(new THREE.SphereGeometry(1, 160, 120, -Math.PI / 2), (p, n) => {
    // hairline: high on the forehead, above the ears at the sides, low at the nape
    const f = n.z;
    const hairline = f >= 0 ? THREE.MathUtils.lerp(0.2, 0.42, f) : THREE.MathUtils.lerp(0.2, -0.62, -f);
    const grow = smoothstep(hairline - 0.08, hairline + 0.16, n.y);
    const partX = -0.3; // part on his left
    const waves = Math.sin((n.x - partX) * 12 + n.z * 4 + Math.sin(n.y * 6) * 1.6) * 0.02;
    const strands = Math.sin((n.x - partX) * 55 + n.z * 8) * 0.004;
    let d = 0.085 + waves + strands;
    d += bump(n, [-0.05, 0.78, 0.58], [0.45, 0.22, 0.32], 0.11); // volume swept over the forehead
    d += bump(n, [0.4, 0.72, 0.25], [0.35, 0.25, 0.4], 0.045);
    d += bump(n, [-0.55, 0.55, 0.35], [0.25, 0.3, 0.4], 0.03);
    d += bump(n, [partX, 0.9, 0.3], [0.025, 0.35, 0.7], -0.035); // the part
    d -= bump(n, [Math.sign(n.x) * 0.95, 0, 0], [0.12, 0.3, 0.25], 0.05); // tucked above the ears
    // where no hair grows, the surface sinks inside the head and is hidden
    p.multiplyScalar(0.93 + (0.07 + d) * grow);
    skullShape(p, n);
  });
}

// Shoulders and chest in a high-collared frock coat with lapels.
function sculptTorso() {
  // the bottom is cut straight through the chest, like a classical bust
  const profile = [[0, 0], [0.84, 0], [0.92, 0.025], [0.97, 0.09], [1, 0.25], [0.99, 0.4], [0.93, 0.54], [0.72, 0.68], [0.46, 0.78], [0.3, 0.85], [0, 0.88]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  // seam at the back
  return sculpt(new THREE.LatheGeometry(profile, 128, Math.PI), (p) => {
    const front = p.z > 0;
    const ax = Math.abs(p.x);
    if (front) p.z *= 1 + 0.18 * Math.exp(-(((p.y - 0.45) / 0.25) ** 2)); // chest
    else p.z *= 0.85; // flatter back
    p.y -= 0.12 * ax * ax * smoothstep(0.4, 0.88, p.y); // shoulders slope down from the neck
    if (front && p.y > 0.2 && p.y < 0.86) {
      // coat lapels: raised bands outside a V from the collar down to the chest
      const v = 0.2 + (0.85 - p.y) * 0.6;
      const lapel = smoothstep(v, v + 0.03, ax) * (1 - smoothstep(v + 0.24, v + 0.32, ax));
      const opening = 1 - smoothstep(v - 0.03, v, ax); // waistcoat inside the V sits deeper
      p.z += 0.055 * lapel * smoothstep(0.2, 0.35, p.y) - 0.03 * opening;
    }
    p.x *= 0.42;
    p.y *= 0.42;
    p.z *= 0.24;
  });
}

function makeBust(color) {
  const marble = new THREE.MeshStandardMaterial({ ...surfaceMaps('marble', color ?? '#f1eee8'), roughness: 1 });
  const doubleSided = marble.clone();
  doubleSided.side = THREE.DoubleSide;
  const bust = new THREE.Group();
  const add = (geometry, [x, y, z], material = marble) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    bust.add(m);
    return m;
  };

  // turned socle
  const socle = [[0, 0], [0.2, 0], [0.2, 0.025], [0.175, 0.04], [0.15, 0.065], [0.135, 0.095], [0.16, 0.105], [0.165, 0.12], [0, 0.12]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(socle, 64), [0, -0.5, 0]);
  add(sculptTorso(), [0, -0.38, 0]);

  // neck, leaning slightly forward
  const neck = add(new THREE.CylinderGeometry(0.088, 0.1, 0.22, 48), [0, 0.07, -0.005]);
  neck.rotation.x = 0.12;

  // high stand-up collar (open at the front) and a tied cravat
  // Victorian neckline: a cravat wrapped around the neck, a puffed knot, and upturned shirt-collar points
  const wrap = sculpt(new THREE.TorusGeometry(0.098, 0.036, 24, 96), (p) => {
    const a = Math.atan2(p.y, p.x);
    p.z *= 1 + Math.sin(a * 5) * 0.03; // a few soft folds in the fabric
  });
  const band = add(wrap, [0, 0.06, -0.005]);
  band.rotation.x = Math.PI / 2 + 0.12;
  band.scale.set(1, 1, 1.15);
  const knot = add(sculpt(new THREE.SphereGeometry(1, 48, 32), (p, n) => {
    p.multiplyScalar(1 + Math.sin(n.x * 7 + n.y * 3) * 0.03);
  }), [0, 0.045, 0.115]);
  knot.scale.set(0.042, 0.04, 0.03);
  const ascot = add(sculpt(new THREE.SphereGeometry(1, 48, 32), (p, n) => {
    p.multiplyScalar(1 + Math.sin(n.x * 8) * 0.035 * smoothstep(0.3, -0.8, n.y)); // folds fanning downward
  }), [0, -0.02, 0.14]);
  ascot.scale.set(0.05, 0.06, 0.022);
  ascot.rotation.x = -0.55;
  const tip = new THREE.Shape();
  tip.moveTo(0, 0);
  tip.lineTo(0.045, 0);
  tip.lineTo(0.012, 0.055);
  tip.closePath();
  for (const side of [-1, 1]) {
    const point = add(new THREE.ExtrudeGeometry(tip, { depth: 0.006, bevelEnabled: false }), [side * 0.03, 0.08, 0.08], doubleSided);
    point.scale.x = side;
    point.rotation.set(-0.25, side * 0.55, side * -0.15);
  }

  // head and hair, chin lifted a touch
  const head = new THREE.Group();
  head.position.set(0, 0.29, 0.015);
  head.rotation.x = -0.06;
  head.scale.setScalar(0.2);
  for (const geometry of [sculptHead(), sculptHair()]) {
    const m = new THREE.Mesh(geometry, marble);
    m.castShadow = m.receiveShadow = true;
    head.add(m);
  }
  bust.add(head);
  return bust;
}

function makeShape(shape, color) {
  if (shape === 'bust') return makeBust(color);
  const geometries = {
    torusKnot: () => new THREE.TorusKnotGeometry(0.28, 0.09, 128, 16),
    icosahedron: () => new THREE.IcosahedronGeometry(0.4, 0),
    sphere: () => new THREE.SphereGeometry(0.38, 48, 32),
    box: () => new THREE.BoxGeometry(0.55, 0.55, 0.55),
    cone: () => new THREE.ConeGeometry(0.35, 0.8, 32),
    torus: () => new THREE.TorusGeometry(0.3, 0.12, 24, 64),
  };
  const geometry = (geometries[shape] ?? geometries.icosahedron)();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: color ?? '#c9a227', metalness: 0.55, roughness: 0.3 }));
}

function buildPedestal(room, ex) {
  const scale = ex.scale ?? 1;
  const px = room.x + (ex.x ?? 0);
  const pz = room.z + (ex.z ?? 0);
  const baseW = ex.plinth?.width ?? 0.9 * scale;
  const baseH = ex.plinth?.height ?? 1.1;
  // objects are modeled facing south (+z); FACING is for the camera, which starts out facing north
  const turn = (FACING[ex.facing ?? 'south'] ?? 0) + Math.PI;

  let stand;
  if (ex.plinth) stand = buildMonumentPlinth(room, px, pz, baseW, baseH, turn, ex.plinth.inscription);
  else {
    const base = addBox(baseW, baseH, baseW, MAT.pedestal, px, baseH / 2, pz, true);
    const cap = addBox(baseW + 0.1, 0.06, baseW + 0.1, MAT.oak, px, baseH + 0.03, pz);
    base.castShadow = base.receiveShadow = cap.castShadow = cap.receiveShadow = true;
    room.footprints.push({ x: px, z: pz, w: baseW, d: baseW });
    stand = [base, cap];
  }
  if (ex.rope) buildRopeBarrier(room, px, pz, baseW + 1.6);
  else {
    const note = piece(parent, new THREE.PlaneGeometry(0.46, 0.08), new THREE.MeshBasicMaterial({ map: plaqueTexture('PLEASE DO NOT TOUCH') }), px, 0.97, pz + baseW / 2 + 0.004);
    note.material.polygonOffset = true;
    note.material.polygonOffsetFactor = -1;
  }
  const holder = new THREE.Group();
  holder.position.set(px, baseH + 0.06 + 0.5 * scale, pz);
  parent.add(holder);

  // invisible box so the whole object area is easy to click
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(baseW, scale, baseW), new THREE.MeshBasicMaterial({ visible: false }));
  holder.add(hitbox);
  makeInteractive([...stand, hitbox], ex, room);

  if (ex.model) {
    gltfLoader.load(
      ex.model,
      (gltf) => {
        const model = gltf.scene;
        if (ex.material === 'marble') carveInMarble(model, ex.color);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const fit = scale / Math.max(size.x, size.y, size.z);
        model.scale.setScalar(fit);
        const center = box.getCenter(new THREE.Vector3()).multiplyScalar(fit);
        model.position.sub(center);
        holder.add(model);
      },
      undefined,
      () => {
        console.warn(`Could not load model "${ex.model}". Showing a placeholder shape.`);
        const shape = makeShape(ex.shape, ex.color);
        shape.scale.setScalar(scale);
        holder.add(shape);
      },
    );
  } else if (ex.shape) {
    const shape = makeShape(ex.shape, ex.color);
    shape.scale.setScalar(scale);
    holder.add(shape);
  } // no shape or model: an empty plinth waiting for its exhibit
  if (ex.spin !== false) spinners.push(holder);
  holder.rotation.y = turn;

  if (ex.spotlight) {
    if (ex.plinth) {
      // a monument: a key light high in the dome in front, and a softer one behind so its back isn't dark
      const reach = Math.max(3, scale * 1.2);
      const high = room.height + scale * 0.5;
      addSpot(px + Math.sin(turn) * reach, high, pz + Math.cos(turn) * reach, holder, 85, 0.55, true);
      addSpot(px - Math.sin(turn + 0.6) * reach, high, pz - Math.cos(turn + 0.6) * reach, holder, 28, 0.55, false);
    } else addSpot(px, room.height - 0.3, pz + 3, holder, 45, 0.35, true);
  }
}

function addSpot(x, y, z, target, intensity, angle, shadows) {
  const spot = new THREE.SpotLight(0xfff3e2, intensity, 24, angle, 0.6, 1);
  spot.position.set(x, y, z);
  spot.target = target;
  if (shadows) {
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.02;
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 24;
  }
  parent.add(spot);
}

// A monument plinth for a full-length statue: a cream marble step and moldings around a darker
// veined marble die, with a bronze name plaque on the front. Its top is at height + 0.06.
function buildMonumentPlinth(room, px, pz, w, h, turn, inscription) {
  const light = new THREE.MeshStandardMaterial({ ...surfaceMaps('marble', '#e9e2d5', w, 0.5), roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ ...surfaceMaps('marble', '#6b5d53', w, h), roughness: 1 });
  const parts = [
    addBox(w + 0.34, 0.18, w + 0.34, light, px, 0.09, pz, true), // step
    addBox(w + 0.14, 0.1, w + 0.14, light, px, 0.23, pz), // base molding
    addBox(w, h - 0.42, w, dark, px, 0.28 + (h - 0.42) / 2, pz), // die
    addBox(w + 0.14, 0.14, w + 0.14, light, px, h - 0.07, pz), // top molding
    addBox(w + 0.22, 0.06, w + 0.22, light, px, h + 0.03, pz), // cap
  ];
  for (const m of parts) m.castShadow = m.receiveShadow = true;
  room.footprints.push({ x: px, z: pz, w: w + 0.34, d: w + 0.34 });
  if (inscription) {
    const plate = piece(parent, new THREE.PlaneGeometry(w * 0.82, w * 0.82 * (104 / 512)), new THREE.MeshBasicMaterial({ map: plaqueTexture(inscription) }));
    const out = w / 2 + 0.004;
    plate.position.set(px + Math.sin(turn) * out, 0.28 + (h - 0.42) * 0.6, pz + Math.cos(turn) * out);
    plate.rotation.y = turn;
    plate.material.polygonOffset = true;
    plate.material.polygonOffsetFactor = -1;
    parts.push(plate);
  }
  return parts;
}

// Gives a loaded model a white marble surface. Models made by tools/statue have no texture
// coordinates, so they are projected from the side at a slant (no seams to hide).
function carveInMarble(model, color = '#f1eee8') {
  const material = new THREE.MeshStandardMaterial({ ...surfaceMaps('marble', color, 1.5, 1.5), roughness: 1, normalScale: new THREE.Vector2(0.4, 0.4) });
  model.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      uv[i * 2] = p.x + p.z * 0.7;
      uv[i * 2 + 1] = p.y;
    }
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    mesh.material = material;
    mesh.castShadow = mesh.receiveShadow = true;
  });
}

// Brass posts with a sagging velvet rope, in a square around an object.
function buildRopeBarrier(room, cx, cz, size) {
  const h = 0.95;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => new THREE.Vector3(cx + (sx * size) / 2, h - 0.05, cz + (sz * size) / 2));
  const baseGeo = new THREE.CylinderGeometry(0.15, 0.17, 0.035, 32);
  const poleGeo = new THREE.CylinderGeometry(0.022, 0.026, h, 16);
  const topGeo = new THREE.SphereGeometry(0.045, 20, 12);
  for (const c of corners) {
    const base = new THREE.Mesh(baseGeo, MAT.brass);
    base.position.set(c.x, 0.018, c.z);
    const pole = new THREE.Mesh(poleGeo, MAT.brass);
    pole.position.set(c.x, h / 2, c.z);
    const top = new THREE.Mesh(topGeo, MAT.brass);
    top.position.set(c.x, h + 0.02, c.z);
    for (const m of [base, pole, top]) {
      m.castShadow = true;
      parent.add(m);
    }
    room.footprints.push({ x: c.x, z: c.z, w: 0.34, d: 0.34, round: true });
  }
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= 0.22;
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).setY(a.y - 0.15), mid, b.clone().lerp(mid, 0.5).setY(b.y - 0.15), b]);
    const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.022, 10), MAT.rope);
    rope.castShadow = true;
    parent.add(rope);
  }
  addCollider(cx, cz, size + 0.3, size + 0.3);
}

// ---------------------------------------------------------------- museum furniture
// Small helper: add a mesh to a group at a position.
function piece(group, geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

// Gold lettering on a dark plaque (for the admissions desk and donation box).
function plaqueTexture(text) {
  return canvasTexture(512, 104, (ctx, w, h) => {
    ctx.fillStyle = '#1d1712';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b8913a';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#d9b45a';
    ctx.font = `600 46px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2, w - 40);
  });
}

// Admissions desk: paneled mahogany counter with a marble top, a banker's lamp, a guest book,
// a service bell, and a chair for the attendant. The front faces the room's visitors (+z).
function buildAdmissionsDesk(g) {
  const d = new THREE.Group();
  d.position.z = 0.25; // center the whole desk-plus-chair footprint on the group
  g.add(d);
  const panel = new THREE.MeshStandardMaterial({ ...surfaceMaps('wainscot', '#5a2a1a', 3.6, 1.05 / 1.1), roughness: 1 });
  piece(d, new THREE.BoxGeometry(3.6, 1.05, 0.08), panel, 0, 0.525, 0.55);
  for (const sx of [-1, 1]) piece(d, new THREE.BoxGeometry(0.08, 1.05, 1.1), MAT.mahogany, sx * 1.76, 0.525, 0.04);
  piece(d, new THREE.BoxGeometry(3.64, 0.12, 0.1), MAT.mahogany, 0, 0.06, 0.6);
  piece(d, new RoundedBoxGeometry(3.86, 0.06, 0.62, 2, 0.02), MAT.counterTop, 0, 1.08, 0.42);
  piece(d, new THREE.BoxGeometry(3.44, 0.04, 0.7), MAT.mahogany, 0, 0.76, 0.05);
  piece(d, new THREE.PlaneGeometry(1.3, 0.26), new THREE.MeshBasicMaterial({ map: plaqueTexture('ADMISSIONS') }), 0, 0.8, 0.595);
  // banker's lamp
  piece(d, new THREE.CylinderGeometry(0.09, 0.1, 0.03, 24), MAT.gilt, -1.25, 1.125, 0.4);
  piece(d, new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), MAT.gilt, -1.25, 1.26, 0.4);
  const shade = piece(d, new THREE.CylinderGeometry(0.075, 0.075, 0.42, 24, 1, true, Math.PI / 2, Math.PI), MAT.bankerGreen, -1.25, 1.42, 0.4);
  shade.rotation.z = Math.PI / 2;
  piece(d, new THREE.BoxGeometry(0.36, 0.015, 0.04), MAT.gaslight, -1.25, 1.385, 0.4);
  // guest book, open
  piece(d, new THREE.BoxGeometry(0.5, 0.02, 0.34), MAT.bookCover, 0.45, 1.12, 0.42);
  for (const sx of [-1, 1]) {
    const page = piece(d, new THREE.BoxGeometry(0.23, 0.02, 0.31), MAT.paper, 0.45 + sx * 0.12, 1.14, 0.42);
    page.rotation.z = sx * 0.06;
  }
  // service bell
  piece(d, new THREE.CylinderGeometry(0.06, 0.06, 0.012, 24), MAT.mahogany, 1.25, 1.117, 0.45);
  piece(d, new THREE.SphereGeometry(0.05, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.gilt, 1.25, 1.123, 0.45);
  // attendant's chair
  piece(d, new THREE.BoxGeometry(0.5, 0.08, 0.48), MAT.leather, 0, 0.5, -0.8);
  piece(d, new THREE.BoxGeometry(0.5, 0.7, 0.06), MAT.mahogany, 0, 0.9, -1.03);
  const leg = new THREE.CylinderGeometry(0.025, 0.02, 0.46, 10);
  for (const [lx, lz] of [[-0.22, -0.6], [0.22, -0.6], [-0.22, -1], [0.22, -1]]) piece(d, leg, MAT.mahogany, lx, 0.23, lz);
  return [3.9, 1.75];
}

// Longcase (grandfather) clock with a swinging pendulum and hands that show the real time.
const CLOCK_FACE = canvasTexture(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#f2ead8';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1712';
  ctx.font = '600 26px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const numerals = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  numerals.forEach((n, k) => {
    const a = (k / 12) * Math.PI * 2;
    ctx.fillText(n, w / 2 + Math.sin(a) * 96, h / 2 - Math.cos(a) * 96);
  });
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2;
    const r1 = k % 5 ? 118 : 112;
    ctx.fillRect(w / 2 + Math.sin(a) * r1 - 1, h / 2 - Math.cos(a) * r1 - 1, 2, 2);
  }
});
function buildClock(g) {
  const wood = MAT.mahogany;
  piece(g, new THREE.BoxGeometry(0.62, 0.5, 0.42), wood, 0, 0.25, 0);
  piece(g, new THREE.BoxGeometry(0.48, 1.15, 0.32), wood, 0, 1.075, 0);
  piece(g, new THREE.BoxGeometry(0.28, 0.82, 0.02), MAT.trim, 0, 1.08, 0.16);
  const glass = piece(g, new THREE.PlaneGeometry(0.28, 0.82), MAT.caseGlass, 0, 1.08, 0.175);
  glass.renderOrder = 1;
  const pendulum = new THREE.Group();
  pendulum.position.set(0, 1.45, 0.17);
  piece(pendulum, new THREE.BoxGeometry(0.012, 0.55, 0.006), MAT.gilt, 0, -0.275, 0);
  piece(pendulum, new THREE.CylinderGeometry(0.07, 0.07, 0.015, 24).rotateX(Math.PI / 2), MAT.gilt, 0, -0.56, 0);
  g.add(pendulum);
  animators.push((t) => {
    pendulum.rotation.z = 0.12 * Math.sin(t * Math.PI); // one swing per second
  });
  piece(g, new THREE.BoxGeometry(0.62, 0.62, 0.42), wood, 0, 1.96, 0);
  piece(g, new THREE.CircleGeometry(0.2, 48), new THREE.MeshStandardMaterial({ map: CLOCK_FACE, roughness: 0.5 }), 0, 1.96, 0.212);
  piece(g, new THREE.TorusGeometry(0.205, 0.016, 10, 48), MAT.gilt, 0, 1.96, 0.215);
  const hour = piece(g, new THREE.BoxGeometry(0.014, 0.1, 0.004).translate(0, 0.05, 0), MAT.trim, 0, 1.96, 0.222);
  const minute = piece(g, new THREE.BoxGeometry(0.009, 0.15, 0.004).translate(0, 0.075, 0), MAT.trim, 0, 1.96, 0.226);
  animators.push(() => {
    const now = new Date();
    const m = now.getMinutes() + now.getSeconds() / 60;
    minute.rotation.z = -(m / 60) * Math.PI * 2;
    hour.rotation.z = -(((now.getHours() % 12) + m / 60) / 12) * Math.PI * 2;
  });
  const crown = piece(g, new THREE.CylinderGeometry(0.31, 0.31, 0.42, 32, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), wood, 0, 2.27, 0);
  crown.scale.y = 0.45;
  for (const fx of [-0.26, 0, 0.26]) piece(g, new THREE.SphereGeometry(0.035, 12, 8), MAT.gilt, fx, fx ? 2.32 : 2.44, 0.1);
  return [0.64, 0.44];
}

// Kentia palm in a glazed ceramic urn, a Victorian parlor favorite.
function buildPalm(g, seed) {
  const urn = [[0, 0], [0.2, 0], [0.24, 0.06], [0.2, 0.14], [0.27, 0.42], [0.31, 0.56], [0.28, 0.6], [0, 0.6]].map(([r, y]) => new THREE.Vector2(r, y));
  piece(g, new THREE.LatheGeometry(urn, 32), MAT.ceramic);
  piece(g, new THREE.TorusGeometry(0.29, 0.018, 8, 32).rotateX(Math.PI / 2), MAT.gilt, 0, 0.59, 0);
  piece(g, new THREE.CylinderGeometry(0.035, 0.05, 1.1, 10), MAT.trunk, 0, 1.1, 0);
  const r = seededRandom(seed);
  const frond = new THREE.SphereGeometry(1, 16, 8);
  for (let k = 0; k < 13; k++) {
    const holder = new THREE.Group();
    holder.position.y = 1.55 + r() * 0.2;
    holder.rotation.y = (k / 13) * Math.PI * 2 + r() * 0.4;
    const len = 0.55 + r() * 0.35;
    const leaf = piece(holder, frond, MAT.palm, 0, 0, len);
    leaf.scale.set(0.13, 0.012, len);
    holder.rotation.x = 0.15 + r() * 0.65; // fronds arch outward and droop
    g.add(holder);
  }
  return [0.7, 0.7];
}

// Bentwood hall stand (the Thonet kind every Victorian hallway had): curved legs, a turned post and
// curling hooks, with an overcoat, a bowler hat and a furled umbrella. Made for a back-left corner:
// the coat faces +x, -z.
const COAT_MAT = {
  wool: new THREE.MeshStandardMaterial({ color: 0x23293a, roughness: 0.95 }),
  felt: new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.8 }),
  silk: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45 }),
  horn: new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.3 }),
};
function bentwood(g, points, radius = 0.016, material = MAT.mahogany) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius, 8), material);
  g.add(m);
  return curve.getPoint(1);
}
function buildCoatStand(g) {
  const around = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  // four legs sweeping out from the post to the floor, ending in a little upturned toe
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    bentwood(g, [around(a, 0.02, 0.42), around(a, 0.1, 0.26), around(a, 0.22, 0.08), around(a, 0.33, 0.02), around(a, 0.37, 0.05)], 0.018);
  }
  // turned post with rings, and a finial
  const profile = [[0.0, 0.3], [0.04, 0.3], [0.045, 0.36], [0.032, 0.42], [0.03, 0.9], [0.042, 0.94], [0.03, 0.98], [0.026, 1.55], [0.04, 1.6], [0.03, 1.64], [0.03, 1.8], [0.045, 1.84], [0.0, 1.86]];
  piece(g, new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 20), MAT.mahogany);
  piece(g, new THREE.SphereGeometry(0.045, 16, 12), MAT.mahogany, 0, 1.9, 0);
  // umbrella ring held out on short bentwood arms
  piece(g, new THREE.TorusGeometry(0.17, 0.012, 8, 40).rotateX(Math.PI / 2), MAT.mahogany, 0, 0.6, 0);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    bentwood(g, [around(a, 0.03, 0.5), around(a, 0.1, 0.56), around(a, 0.17, 0.6)], 0.01);
  }
  // hooks: six curling up at the top, and shorter ones just below except where the coat hangs over them
  const coatAngle = -Math.PI / 4; // toward +x, -z: into the room from the corner
  const underCoat = (a) => Math.abs(Math.atan2(Math.sin(a - coatAngle), Math.cos(a - coatAngle))) < 1.4;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    let end = bentwood(g, [around(a, 0.03, 1.66), around(a, 0.12, 1.7), around(a, 0.19, 1.8), around(a, 0.17, 1.9), around(a, 0.12, 1.88)], 0.012);
    piece(g, new THREE.SphereGeometry(0.018, 10, 8), MAT.mahogany, end.x, end.y, end.z);
    const b = a + Math.PI / 6;
    if (underCoat(b)) continue;
    end = bentwood(g, [around(b, 0.03, 1.46), around(b, 0.1, 1.48), around(b, 0.14, 1.56), around(b, 0.11, 1.6)], 0.011);
    piece(g, new THREE.SphereGeometry(0.016, 10, 8), MAT.mahogany, end.x, end.y, end.z);
  }

  // overcoat hanging from the hook facing the room: a lathe-turned body flattened front to back,
  // pressed into soft vertical folds that deepen toward the hem, with sleeves, collar and buttons
  const coat = new THREE.Group();
  coat.position.set(Math.cos(coatAngle) * 0.15, 1.78, Math.sin(coatAngle) * 0.15);
  coat.rotation.y = Math.PI / 2 - coatAngle;
  const L = 1.08;
  const shape = [[0.0, 0], [0.07, -0.01], [0.15, -0.05], [0.18, -0.12], [0.18, -0.35], [0.19, -0.6], [0.23, -0.9], [0.25, -L], [0.0, -L]];
  const body = new THREE.LatheGeometry(shape.map(([r, y]) => new THREE.Vector2(r, y)), 48);
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const depth = Math.min(1, -y / L);
    const fold = 1 + depth * (0.06 * Math.sin(a * 7) + 0.03 * Math.sin(a * 13 + 1));
    pos.setXYZ(i, x * fold, y, z * fold * 0.5);
  }
  body.computeVertexNormals();
  piece(coat, body, COAT_MAT.wool);
  // collar turned up around the hook, and the front opening with three buttons
  piece(coat, new THREE.TorusGeometry(0.1, 0.03, 10, 24, Math.PI * 1.3).rotateX(Math.PI / 2).rotateY(Math.PI * 0.85), COAT_MAT.wool, 0, -0.06, 0.02).scale.set(1, 1, 0.6);
  piece(coat, new THREE.BoxGeometry(0.012, L - 0.25, 0.01), MAT.trim, 0.0, -0.13 - (L - 0.25) / 2, 0.093 + 0.005);
  for (const by of [-0.32, -0.48, -0.64]) piece(coat, new THREE.SphereGeometry(0.012, 10, 8), COAT_MAT.horn, 0.03, by, 0.1);
  // sleeves hanging at the sides, slightly forward
  for (const s of [-1, 1]) {
    const sleeve = piece(coat, new THREE.CapsuleGeometry(0.05, 0.5, 6, 14), COAT_MAT.wool, s * 0.19, -0.42, 0.03);
    sleeve.rotation.z = s * 0.06;
    sleeve.scale.set(1, 1, 0.85);
    piece(coat, new THREE.TorusGeometry(0.048, 0.008, 8, 20).rotateX(Math.PI / 2), COAT_MAT.wool, s * 0.205, -0.71, 0.03); // cuff
  }
  coat.traverse((m) => m.isMesh && (m.castShadow = true));
  g.add(coat);

  // bowler hat on a top hook on the far side
  const hat = new THREE.Group();
  const hatAngle = -Math.PI / 2 - 0.6;
  hat.position.set(Math.cos(hatAngle) * 0.16, 1.86, Math.sin(hatAngle) * 0.16);
  hat.rotation.set(0.25, -hatAngle, 0.35);
  piece(hat, new THREE.SphereGeometry(0.095, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), COAT_MAT.felt, 0, 0.0, 0).scale.set(1, 0.95, 1.12);
  piece(hat, new THREE.CylinderGeometry(0.096, 0.098, 0.035, 24), COAT_MAT.felt, 0, -0.015, 0).scale.set(1, 1, 1.12);
  piece(hat, new THREE.CylinderGeometry(0.098, 0.098, 0.02, 24), COAT_MAT.silk, 0, 0.012, 0).scale.set(1, 1, 1.12); // band
  const brim = piece(hat, new THREE.TorusGeometry(0.13, 0.012, 8, 32).rotateX(Math.PI / 2), COAT_MAT.felt, 0, -0.032, 0);
  brim.scale.set(1, 1, 1.12);
  piece(hat, new THREE.CylinderGeometry(0.13, 0.13, 0.006, 32), COAT_MAT.felt, 0, -0.034, 0).scale.set(1, 1, 1.12);
  hat.traverse((m) => m.isMesh && (m.castShadow = true));
  g.add(hat);

  // furled umbrella standing in the ring: pleated silk around the shaft, a strap, a hooked cane handle
  const umb = new THREE.Group();
  const ua = Math.PI / 5;
  umb.position.set(Math.cos(ua) * 0.15, 0.03, Math.sin(ua) * 0.15);
  umb.rotation.set(Math.sin(ua) * -0.12, 0, Math.cos(ua) * 0.12);
  const canopy = new THREE.LatheGeometry([[0.006, 0.06], [0.02, 0.12], [0.045, 0.3], [0.04, 0.6], [0.022, 0.72], [0.008, 0.76]].map(([r, y]) => new THREE.Vector2(r, y)), 32);
  const cp = canopy.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const a = Math.atan2(cp.getZ(i), cp.getX(i));
    const pleat = 1 + 0.18 * Math.abs(Math.sin(a * 4));
    cp.setXYZ(i, cp.getX(i) * pleat, cp.getY(i), cp.getZ(i) * pleat);
  }
  canopy.computeVertexNormals();
  piece(umb, canopy, COAT_MAT.silk);
  piece(umb, new THREE.CylinderGeometry(0.004, 0.006, 0.07, 8), MAT.gilt, 0, 0.03, 0); // ferrule
  piece(umb, new THREE.CylinderGeometry(0.008, 0.008, 0.18, 8), MAT.mahogany, 0, 0.84, 0);
  piece(umb, new THREE.TorusGeometry(0.044, 0.006, 6, 20).rotateX(Math.PI / 2), COAT_MAT.silk, 0, 0.42, 0); // strap
  bentwood(umb, [[0, 0.92, 0], [0, 0.98, 0.01], [0, 1.0, 0.05], [0, 0.97, 0.08], [0, 0.92, 0.075]], 0.011, COAT_MAT.horn);
  umb.traverse((m) => m.isMesh && (m.castShadow = true));
  g.add(umb);
  return [0.75, 0.75];
}

// Floor easel with the museum guide: a map of the building with "you are here".
function buildGuideEasel(g, room) {
  const board = canvasTexture(512, 680, (ctx, w, h) => {
    ctx.fillStyle = '#1f3a2e';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c29b45';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#e8d9b0';
    ctx.font = `600 44px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillText('MUSEUM GUIDE', w / 2, 80);
    ctx.font = `italic 24px Georgia, serif`;
    ctx.fillText('What Trying Costs', w / 2, 116);
    const shapes = ROOMS.map((r) => ({ r, pts: outline(r) }));
    const all = shapes.flatMap((sh) => sh.pts);
    const minX = Math.min(...all.map((p) => p.x));
    const maxX = Math.max(...all.map((p) => p.x));
    const minZ = Math.min(...all.map((p) => p.z));
    const maxZ = Math.max(...all.map((p) => p.z));
    const scale = Math.min((w - 90) / (maxX - minX), (h - 230) / (maxZ - minZ));
    const ox = (w - (maxX - minX) * scale) / 2;
    const oy = 150;
    const map = (p) => [ox + (p.x - minX) * scale, oy + (p.z - minZ) * scale];
    for (const { r, pts } of shapes) {
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(...map(p)) : ctx.moveTo(...map(p))));
      ctx.closePath();
      ctx.fillStyle = r.accent && r.attach ? r.accent : '#e8d9b0';
      ctx.globalAlpha = r.attach ? 0.75 : 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#e8d9b0';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (r.attach) {
        ctx.fillStyle = '#10201a';
        ctx.font = '600 22px Georgia, serif';
        ctx.fillText(r.name.match(/Gallery (\d)/)?.[1] ?? '', ...map({ x: r.x, z: r.z + 1 }));
      }
    }
    const here = map({ x: room.x, z: room.z + 3 });
    ctx.fillStyle = '#d9583b';
    ctx.beginPath();
    ctx.arc(...here, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8d9b0';
    ctx.font = 'italic 20px Georgia, serif';
    ctx.fillText('you are here', here[0], here[1] + 32);
  });
  for (const [lx, lz, tilt] of [[-0.35, 0.12, 0.12], [0.35, 0.12, -0.12]]) {
    const leg = piece(g, new THREE.BoxGeometry(0.04, 1.75, 0.04), MAT.mahogany, lx, 0.86, lz);
    leg.rotation.set(-0.12, 0, tilt);
  }
  const back = piece(g, new THREE.BoxGeometry(0.04, 1.6, 0.04), MAT.mahogany, 0, 0.78, -0.3);
  back.rotation.x = 0.3;
  piece(g, new THREE.BoxGeometry(0.85, 0.04, 0.08), MAT.mahogany, 0, 0.62, 0.1);
  const sign = piece(g, new THREE.BoxGeometry(0.78, 1.04, 0.025), [MAT.mahogany, MAT.mahogany, MAT.mahogany, MAT.mahogany, displayMaterial(board), MAT.mahogany], 0, 1.18, 0.07);
  sign.rotation.x = -0.12;
  return [0.95, 0.75];
}

// Glass donation box on a mahogany stand.
function buildDonationBox(g) {
  piece(g, new THREE.BoxGeometry(0.42, 0.9, 0.42), MAT.mahogany, 0, 0.45, 0);
  const box = piece(g, new THREE.BoxGeometry(0.38, 0.38, 0.38), MAT.caseGlass, 0, 1.09, 0);
  box.renderOrder = 1;
  piece(g, new THREE.BoxGeometry(0.4, 0.03, 0.4), MAT.gilt, 0, 1.295, 0);
  const r = seededRandom('donations');
  for (let k = 0; k < 9; k++) {
    const note = piece(g, new THREE.BoxGeometry(0.14, 0.004, 0.065), MAT.felt, (r() - 0.5) * 0.25, 0.91 + k * 0.012, (r() - 0.5) * 0.25);
    note.rotation.y = r() * Math.PI;
  }
  piece(g, new THREE.PlaneGeometry(0.4, 0.08), new THREE.MeshBasicMaterial({ map: plaqueTexture('DONATIONS') }), 0, 0.82, 0.212);
  return [0.5, 0.5];
}

// A line of brass posts joined by velvet ropes (a queue lane), with thin colliders along each rope.
function buildStanchionLine(room, points) {
  const h = 0.95;
  const posts = points.map(([px, pz]) => new THREE.Vector3(room.x + px, h - 0.05, room.z + pz));
  const baseGeo = new THREE.CylinderGeometry(0.15, 0.17, 0.035, 32);
  const poleGeo = new THREE.CylinderGeometry(0.022, 0.026, h, 16);
  const topGeo = new THREE.SphereGeometry(0.045, 20, 12);
  for (const c of posts) {
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    piece(g, baseGeo, MAT.brass, 0, 0.018, 0);
    piece(g, poleGeo, MAT.brass, 0, h / 2, 0);
    piece(g, topGeo, MAT.brass, 0, h + 0.02, 0);
    g.traverse((m) => m.isMesh && (m.castShadow = true));
    parent.add(g);
    room.footprints.push({ x: c.x, z: c.z, w: 0.34, d: 0.34, round: true });
  }
  for (let k = 0; k < posts.length - 1; k++) {
    const a = posts[k];
    const b = posts[k + 1];
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= 0.22;
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).setY(a.y - 0.15), mid, b.clone().lerp(mid, 0.5).setY(b.y - 0.15), b]);
    const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.022, 10), MAT.rope);
    rope.castShadow = true;
    parent.add(rope);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    addCollider((a.x + b.x) / 2, (a.z + b.z) / 2, Math.hypot(dx, dz), 0.2, Math.atan2(-dz, dx));
  }
}

// Display case: a mahogany cabinet with a glass vitrine on top. An exhibit slot like a plinth.
function buildCase(room, ex) {
  const g = new THREE.Group();
  const x = room.x + (ex.x ?? 0);
  const z = room.z + (ex.z ?? 0);
  const rot = THREE.MathUtils.degToRad(ex.rotation ?? 0);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  const cabinetMat = new THREE.MeshStandardMaterial({ ...surfaceMaps('wainscot', '#5a2a1a', 1.5, 0.85 / 1.1), roughness: 1 });
  const cabinet = piece(g, new THREE.BoxGeometry(1.5, 0.85, 0.75), cabinetMat, 0, 0.425, 0);
  piece(g, new THREE.BoxGeometry(1.58, 0.05, 0.83), MAT.mahogany, 0, 0.875, 0);
  piece(g, new THREE.BoxGeometry(1.4, 0.02, 0.66), MAT.felt, 0, 0.91, 0);
  const glass = piece(g, new THREE.BoxGeometry(1.46, 0.56, 0.72), MAT.caseGlass, 0, 1.18, 0);
  glass.renderOrder = 1;
  for (const [cx, cz] of [[-0.73, -0.36], [0.73, -0.36], [-0.73, 0.36], [0.73, 0.36]]) piece(g, new THREE.BoxGeometry(0.03, 0.56, 0.03), MAT.gilt, cx, 1.18, cz);
  piece(g, new THREE.BoxGeometry(1.5, 0.04, 0.76), MAT.mahogany, 0, 1.48, 0);
  if (ex.title) {
    // a placeholder object until an image or model is chosen
    piece(g, new THREE.BoxGeometry(0.5, 0.04, 0.36), MAT.bookCover, 0, 0.94, 0).rotation.y = 0.3;
  }
  g.traverse((m) => {
    if (m.isMesh && m.material !== MAT.caseGlass) m.castShadow = m.receiveShadow = true;
  });
  parent.add(g);
  makeInteractive([cabinet, glass], ex, room);
  addCollider(x, z, 1.58, 0.83, rot);
  room.footprints.push({ x, z, w: 1.58, d: 0.83, rot });
}

// Monstera: big split leaves on arching stems, in a low pot. Quieter than a palm.
const MONSTERA_LEAF = (() => {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    const cx = w / 2;
    // heart-shaped leaf, stem end at the bottom
    ctx.fillStyle = '#2f5e34';
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.9);
    ctx.bezierCurveTo(cx - w * 0.55, h * 0.95, cx - w * 0.5, h * 0.12, cx, h * 0.06);
    ctx.bezierCurveTo(cx + w * 0.5, h * 0.12, cx + w * 0.55, h * 0.95, cx, h * 0.9);
    ctx.fill();
    // a lighter sheen toward the middle
    const g = ctx.createRadialGradient(cx, h * 0.45, 4, cx, h * 0.45, w * 0.45);
    g.addColorStop(0, 'rgba(120,170,100,0.35)');
    g.addColorStop(1, 'rgba(120,170,100,0)');
    ctx.fillStyle = g;
    ctx.fill();
    // midrib and side veins
    ctx.strokeStyle = 'rgba(190,215,160,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.9);
    ctx.lineTo(cx, h * 0.1);
    ctx.stroke();
    // cut the slits and holes that give the monstera its look
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const y = h * (0.2 + k * 0.12);
      for (const sx of [-1, 1]) {
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(cx + sx * w * 0.5, y - 10);
        ctx.lineTo(cx + sx * w * 0.16, y + 8);
        ctx.stroke();
        if (k > 0 && k < 5) {
          ctx.beginPath();
          ctx.ellipse(cx + sx * w * 0.1, y + 2, 4, 9, sx * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  });
  return new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
})();
function buildMonstera(g, seed) {
  const pot = [[0, 0], [0.2, 0], [0.24, 0.04], [0.27, 0.38], [0.29, 0.42], [0, 0.42]].map(([r, y]) => new THREE.Vector2(r, y));
  piece(g, new THREE.LatheGeometry(pot, 32), MAT.ceramic);
  piece(g, new THREE.CircleGeometry(0.26, 24).rotateX(-Math.PI / 2), MAT.trunk, 0, 0.4, 0);
  const r = seededRandom(seed);
  const leafGeo = new THREE.PlaneGeometry(0.72, 0.72).translate(0, 0.33, 0); // pivot at the stem end
  for (let k = 0; k < 11; k++) {
    const angle = (k / 11) * Math.PI * 2 + r() * 0.5;
    const lean = 0.25 + r() * 0.45; // how far the stem leans out
    const len = 0.55 + r() * 0.45;
    const stem = new THREE.Group();
    stem.position.y = 0.4;
    stem.rotation.set(lean, angle, 0, 'YXZ');
    piece(stem, new THREE.CylinderGeometry(0.008, 0.012, len, 6).translate(0, len / 2, 0), MAT.palm);
    const leaf = piece(stem, leafGeo, MONSTERA_LEAF, 0, len, 0);
    leaf.rotation.set(0.35 + r() * 0.4, 0, (r() - 0.5) * 0.6); // leaves held up and outward, facing the viewer
    g.add(stem);
  }
  return [0.75, 0.75];
}

// Green EXIT sign (shared texture).
let EXIT_TEX = null;
function exitSign() {
  EXIT_TEX ??= canvasTexture(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#0b8a3e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2fff4';
    ctx.font = `bold 64px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', w / 2, h / 2 + 3);
  });
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.26, 0.06),
    [MAT.trim, MAT.trim, MAT.trim, MAT.trim, new THREE.MeshBasicMaterial({ map: EXIT_TEX, color: new THREE.Color(1.6, 1.6, 1.6) }), MAT.trim],
  );
}

// Things every real museum has that nobody notices until they're missing.
const FIXTURE_MAT = {
  white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb3201e, roughness: 0.35 }),
  dome: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.85 }),
  screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.9, 0.55) }),
};
function buildFixtures(room) {
  const { x, z, w, d, height } = room;
  // ceiling: smoke detectors and a security camera dome in one corner
  for (const t of [-0.25, 0.25]) {
    const sx = x + (w >= d ? w * t : 0);
    const sz = z + (w >= d ? 0 : d * t);
    piece(parent, new THREE.CylinderGeometry(0.075, 0.08, 0.04, 20), FIXTURE_MAT.white, sx + 0.6, height - 0.02, sz + 0.6);
  }
  const cam = new THREE.Group();
  cam.position.set(x + w / 2 - 0.8, height, z - d / 2 + 0.8);
  piece(cam, new THREE.CylinderGeometry(0.12, 0.12, 0.04, 24), FIXTURE_MAT.white, 0, -0.02, 0);
  piece(cam, new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), FIXTURE_MAT.dome, 0, -0.04, 0);
  parent.add(cam);
  if (room.victorian) return; // period rooms keep their walls clear

  const door = room.doors.south[0];
  // EXIT sign above the doorway, inside the room
  if (door) {
    const exit = exitSign();
    mountOnWall(room, { wall: 'south', at: door.at }, exit, Math.min(height - 0.35, DOOR_HEIGHT + 1.05));
  }
  // fire extinguisher in a recessed white cabinet, near the doorway end of the east wall
  const ext = new THREE.Group();
  piece(ext, new THREE.BoxGeometry(0.42, 0.75, 0.14), FIXTURE_MAT.white, 0, 0, 0.07);
  piece(ext, new THREE.BoxGeometry(0.36, 0.69, 0.02), MAT.trim, 0, 0, 0.13);
  piece(ext, new THREE.CylinderGeometry(0.075, 0.075, 0.42, 16), FIXTURE_MAT.red, 0, -0.08, 0.15);
  piece(ext, new THREE.CylinderGeometry(0.03, 0.04, 0.08, 10), MAT.trim, 0, 0.17, 0.15);
  const glass = piece(ext, new THREE.PlaneGeometry(0.36, 0.69), MAT.caseGlass, 0, 0, 0.145);
  glass.renderOrder = 1;
  mountOnWall(room, { wall: 'east', at: d / 2 - 1.1 }, ext, 1.15);
  // climate monitor (temperature and humidity) on the west wall
  const monitor = new THREE.Group();
  piece(monitor, new THREE.BoxGeometry(0.16, 0.11, 0.035), FIXTURE_MAT.white, 0, 0, 0.018);
  piece(monitor, new THREE.PlaneGeometry(0.11, 0.05), FIXTURE_MAT.screen, 0, 0.012, 0.037);
  mountOnWall(room, { wall: 'west', at: d / 2 - 1.2 }, monitor, 1.55);
  // light switch and a power outlet beside the doorway
  const plate = (group, w, h) => piece(group, new THREE.BoxGeometry(w, h, 0.012), FIXTURE_MAT.white, 0, 0, 0.006);
  if (door) {
    const sw = new THREE.Group();
    plate(sw, 0.08, 0.12);
    piece(sw, new THREE.BoxGeometry(0.018, 0.035, 0.014), FIXTURE_MAT.white, 0, 0.004, 0.016).rotation.x = 0.25;
    mountOnWall(room, { wall: 'south', at: door.at - door.width / 2 - 0.45 }, sw, 1.2);
    const out = new THREE.Group();
    plate(out, 0.08, 0.12);
    for (const oy of [-0.025, 0.025]) piece(out, new THREE.BoxGeometry(0.03, 0.028, 0.004), MAT.trim, 0, oy, 0.013);
    mountOnWall(room, { wall: 'south', at: door.at + door.width / 2 + 0.6 }, out, 0.3);
  }
  // fire alarm pull station by the extinguisher, with a horn-strobe above it
  const pull = new THREE.Group();
  piece(pull, new THREE.BoxGeometry(0.13, 0.17, 0.05), FIXTURE_MAT.red, 0, 0, 0.025);
  piece(pull, new THREE.PlaneGeometry(0.12, 0.15), new THREE.MeshStandardMaterial({ map: fireAlarmTexture('pull'), roughness: 0.4 }), 0, 0, 0.0505);
  piece(pull, new THREE.BoxGeometry(0.07, 0.025, 0.02), FIXTURE_MAT.white, 0, 0.005, 0.06);
  mountOnWall(room, { wall: 'east', at: d / 2 - 1.8 }, pull, 1.2);
  const strobe = new THREE.Group();
  piece(strobe, new THREE.BoxGeometry(0.13, 0.17, 0.05), FIXTURE_MAT.white, 0, 0, 0.025);
  piece(strobe, new THREE.PlaneGeometry(0.12, 0.15), new THREE.MeshStandardMaterial({ map: fireAlarmTexture('strobe'), roughness: 0.4 }), 0, 0, 0.0505);
  piece(strobe, new THREE.BoxGeometry(0.07, 0.04, 0.03), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.8 }), 0, 0.035, 0.065);
  mountOnWall(room, { wall: 'east', at: d / 2 - 1.8 }, strobe, 2.3);
  // linear floor grilles for the air conditioning, along both long walls
  const grilleTex = canvasTexture(256, 32, (ctx, cw, ch) => {
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#0b0b0b';
    for (let gx = 6; gx < cw - 4; gx += 8) ctx.fillRect(gx, 5, 4, ch - 10);
  });
  for (const sgn of [-1, 1]) {
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.2), new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.4, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    grille.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    grille.position.set(x + sgn * (w / 2 - HALF_WALL - 0.35), 0.003, z - d / 4);
    parent.add(grille);
  }
  // the guard's chair against the west wall near the doorway, facing into the room
  const chair = new THREE.Group();
  const cx = x - w / 2 + 0.55;
  const cz = z + d / 2 - 2;
  chair.position.set(cx, 0, cz);
  chair.rotation.y = Math.PI / 2;
  piece(chair, new THREE.BoxGeometry(0.45, 0.05, 0.42), MAT.trim, 0, 0.46, 0);
  piece(chair, new THREE.BoxGeometry(0.45, 0.42, 0.04), MAT.trim, 0, 0.72, -0.2);
  const leg = new THREE.CylinderGeometry(0.015, 0.015, 0.46, 8);
  for (const [lx, lz] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) piece(chair, leg, MAT.metal, lx, 0.23, lz);
  chair.traverse((m) => m.isMesh && (m.castShadow = true));
  parent.add(chair);
  addCollider(cx, cz, 0.5, 0.5, Math.PI / 2);
  room.footprints.push({ x: cx, z: cz, w: 0.5, d: 0.5, rot: Math.PI / 2 });
  // a low rope keeps visitors a step back from the large work on the far wall
  if ((room.exhibits ?? []).some((ex) => ex.wall === 'north' && ex.type === 'painting')) {
    buildStanchionLine(room, [[-2.1, -d / 2 + 1.3], [2.1, -d / 2 + 1.3]]);
  }
}

// Brochure rack: a slanted mahogany stand with three tiers of colorful pamphlets.
function buildBrochureRack(g) {
  piece(g, new THREE.BoxGeometry(0.6, 1.1, 0.05), MAT.mahogany, 0, 0.75, -0.1).rotation.x = -0.15;
  for (const [lx, lz] of [[-0.25, 0.12], [0.25, 0.12], [-0.25, -0.12], [0.25, -0.12]]) piece(g, new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), MAT.gilt, lx, 0.15, lz);
  piece(g, new THREE.BoxGeometry(0.6, 0.04, 0.3), MAT.mahogany, 0, 0.3, 0);
  const colors = [0x2f6fde, 0xe4572e, 0x1f9d6b, 0x7b5cf0, 0xc9a24a, 0x8a3b2a];
  let n = 0;
  for (let tier = 0; tier < 3; tier++) {
    const y = 0.45 + tier * 0.32;
    piece(g, new THREE.BoxGeometry(0.58, 0.02, 0.08), MAT.gilt, 0, y - 0.1, -0.01 - tier * 0.05);
    for (const sx of [-0.15, 0.15]) {
      const b = piece(g, new THREE.BoxGeometry(0.2, 0.26, 0.012), new THREE.MeshStandardMaterial({ color: colors[n++ % colors.length], roughness: 0.6 }), sx, y + 0.03, -0.02 - tier * 0.05);
      b.rotation.x = -0.15;
    }
  }
  return [0.62, 0.35];
}

const FURNITURE = {
  admissions: buildAdmissionsDesk,
  clock: buildClock,
  palm: (g, room, item) => buildPalm(g, `palm${item.x},${item.z}`),
  monstera: (g, room, item) => buildMonstera(g, `monstera${item.x},${item.z}`),
  brochures: buildBrochureRack,
  coatstand: buildCoatStand,
  guide: buildGuideEasel,
  donations: buildDonationBox,
};

function buildDecor(room, item) {
  if (item.type === 'stanchions') return buildStanchionLine(room, item.points);
  if (item.type === 'rug') return buildRug(room, item);
  if (item.type === 'banner') return buildBanner(room, item);
  const x = room.x + (item.x ?? 0);
  const z = room.z + (item.z ?? 0);
  const rot = THREE.MathUtils.degToRad(item.rotation ?? 0);
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rot;
  let size = [1, 1];
  let round = false;

  if (item.type === 'bench') {
    // museum bench: tufted leather cushion on a recessed oak base
    size = [2.4, 0.62];
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.14, 0.62, 4, 0.05), MAT.leather);
    cushion.position.y = 0.44;
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.37, 0.42), MAT.oak);
    base.position.y = 0.185;
    group.add(cushion, base);
  } else if (item.type === 'plant') {
    // tall concrete planter with a leafy shrub
    size = [0.7, 0.7];
    round = true;
    const planter = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.75, 32), MAT.planter);
    planter.position.y = 0.375;
    group.add(planter);
    const r = seededRandom(`plant${x},${z}`);
    for (let i = 0; i < 14; i++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + r() * 0.12, 1), r() > 0.5 ? MAT.leaf : MAT.leafDark);
      const a = r() * Math.PI * 2;
      const rr = r() * 0.28;
      leaf.position.set(Math.cos(a) * rr, 0.95 + r() * 0.75, Math.sin(a) * rr);
      leaf.scale.set(1, 0.8 + r() * 0.5, 1);
      group.add(leaf);
    }
  } else if (item.type === 'settee') {
    // Victorian button-tufted velvet ottoman on turned mahogany legs
    size = [2.2, 0.75];
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(2.2, 0.22, 0.75, 4, 0.08), MAT.velvet);
    cushion.position.y = 0.47;
    const apron = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.14, 0.66), MAT.mahogany);
    apron.position.y = 0.3;
    group.add(cushion, apron);
    const legGeo = new THREE.CylinderGeometry(0.045, 0.03, 0.24, 16);
    for (const [lx, lz] of [[-0.95, -0.27], [0.95, -0.27], [-0.95, 0.27], [0.95, 0.27]]) {
      const leg = new THREE.Mesh(legGeo, MAT.mahogany);
      leg.position.set(lx, 0.12, lz);
      group.add(leg);
    }
  } else if (FURNITURE[item.type]) {
    size = FURNITURE[item.type](group, room, item);
    round = item.type === 'palm' || item.type === 'monstera';
  } else if (item.type === 'desk') {
    size = [3.2, 1];
    const desk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.05, 1), room.victorian ? MAT.mahogany : MAT.oak);
    desk.position.y = 0.525;
    const top = new THREE.Mesh(new RoundedBoxGeometry(3.4, 0.06, 1.15, 2, 0.02), MAT.pedestal);
    top.position.y = 1.08;
    group.add(desk, top);
  } else {
    console.warn(`Unknown decor type "${item.type}"`);
    return;
  }
  group.traverse((m) => {
    if (m.isMesh) m.castShadow = m.receiveShadow = true;
  });
  parent.add(group);

  addCollider(x, z, size[0], size[1], rot);
  room.footprints.push({ x, z, w: size[0], d: size[1], round, rot });
}

// ---------------------------------------------------------------- finishing touches
// A thin rod between two points (cords, cables, chains).
function rodBetween(group, a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 6), material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  group.add(m);
  return m;
}

// Brass gasolier: a plaster ceiling rose, a drop rod, a turned brass column and eight curving arms,
// each ending in a frosted globe with a cut-glass drop hanging beneath it.
const CRYSTAL = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.55 });
function buildChandelier(room) {
  const g = new THREE.Group();
  g.position.set(room.x, room.height, room.z);
  // ceiling rose: a round plaster medallion with moulded rings and a leafy edge
  piece(g, new THREE.CylinderGeometry(0.8, 0.8, 0.035, 48), MAT.plasterwork, 0, -0.018, 0);
  for (const [r, t] of [[0.74, 0.03], [0.52, 0.035], [0.3, 0.03]]) piece(g, new THREE.TorusGeometry(r, t, 10, 48).rotateX(Math.PI / 2), MAT.plasterwork, 0, -0.04, 0);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    piece(g, new THREE.SphereGeometry(0.06, 10, 6), MAT.plasterwork, Math.cos(a) * 0.63, -0.04, Math.sin(a) * 0.63).scale.set(1, 0.5, 1.6);
  }
  piece(g, new THREE.CylinderGeometry(0.09, 0.05, 0.08, 20), MAT.gilt, 0, -0.08, 0); // canopy
  const hang = 1.25; // how far below the ceiling the arms are
  piece(g, new THREE.CylinderGeometry(0.016, 0.016, hang - 0.1, 8), MAT.gilt, 0, -0.1 - (hang - 0.1) / 2, 0);
  // turned brass column
  const profile = [[0, 0.32], [0.05, 0.3], [0.06, 0.22], [0.035, 0.16], [0.09, 0.05], [0.11, -0.02], [0.07, -0.08], [0.1, -0.14], [0.05, -0.24], [0.025, -0.34], [0.05, -0.4], [0, -0.46]];
  const column = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 24);
  piece(g, column, MAT.gilt, 0, -hang, 0);
  piece(g, new THREE.TorusGeometry(0.5, 0.012, 8, 64).rotateX(Math.PI / 2), MAT.gilt, 0, -hang - 0.12, 0);
  const arms = 8;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2;
    const at = (r, y) => new THREE.Vector3(Math.cos(a) * r, -hang + y, Math.sin(a) * r);
    const curve = new THREE.CatmullRomCurve3([at(0.07, 0.0), at(0.25, -0.16), at(0.47, -0.14), at(0.6, -0.02), at(0.62, 0.06)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.014, 8), MAT.gilt));
    const tip = at(0.62, 0.06);
    piece(g, new THREE.CylinderGeometry(0.055, 0.03, 0.06, 16), MAT.gilt, tip.x, tip.y + 0.02, tip.z);
    piece(g, new THREE.SphereGeometry(0.075, 20, 14), MAT.gaslight, tip.x, tip.y + 0.12, tip.z);
    piece(g, new THREE.CylinderGeometry(0.022, 0.028, 0.08, 12, 1, true), CRYSTAL, tip.x, tip.y + 0.22, tip.z);
    // cut-glass drop under the cup
    rodBetween(g, new THREE.Vector3(tip.x, tip.y - 0.01, tip.z), new THREE.Vector3(tip.x, tip.y - 0.12, tip.z), 0.0025, MAT.gilt);
    piece(g, new THREE.OctahedronGeometry(0.03), CRYSTAL, tip.x, tip.y - 0.15, tip.z).scale.set(0.8, 1.6, 0.8);
  }
  // swags of crystal beads between the arms, and a finial at the bottom
  for (let i = 0; i < arms; i++) {
    for (let k = 1; k < 6; k++) {
      const a = ((i + k / 6) / arms) * Math.PI * 2;
      const sag = Math.sin((k / 6) * Math.PI) * 0.09;
      piece(g, new THREE.IcosahedronGeometry(0.012, 0), CRYSTAL, Math.cos(a) * 0.55, -hang - 0.02 - sag, Math.sin(a) * 0.55);
    }
  }
  piece(g, new THREE.SphereGeometry(0.04, 16, 10), MAT.gilt, 0, -hang - 0.5, 0);
  piece(g, new THREE.ConeGeometry(0.025, 0.08, 12).rotateX(Math.PI), MAT.gilt, 0, -hang - 0.57, 0);
  parent.add(g);
}

// A Persian-style rug: madder-red field with a central medallion, corner pieces and a navy border.
function rugTexture(seed) {
  return canvasTexture(1024, 640, (ctx, w, h) => {
    const r = seededRandom(seed);
    const red = '#6b1c1a';
    const navy = '#1a2238';
    const ivory = '#ddd0b2';
    const gold = '#b08640';
    ctx.fillStyle = red;
    ctx.fillRect(0, 0, w, h);
    // abrash: the slow color shifts of hand-dyed wool
    for (let y = 0; y < h; y += 4) {
      ctx.fillStyle = `rgba(${r() > 0.5 ? '40,10,8' : '150,60,50'},${0.04 + r() * 0.05})`;
      ctx.fillRect(0, y, w, 4);
    }
    // border
    const B = 70;
    ctx.fillStyle = navy;
    ctx.fillRect(0, 0, w, B);
    ctx.fillRect(0, h - B, w, B);
    ctx.fillRect(0, 0, B, h);
    ctx.fillRect(w - B, 0, B, h);
    const motif = (x, y, s) => {
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.fill();
      ctx.fillStyle = red;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let x = B / 2; x < w; x += 46) {
      motif(x, B / 2, 16);
      motif(x, h - B / 2, 16);
    }
    for (let y = B / 2 + 46; y < h - B; y += 46) {
      motif(B / 2, y, 16);
      motif(w - B / 2, y, 16);
    }
    ctx.strokeStyle = ivory;
    ctx.lineWidth = 5;
    ctx.strokeRect(B + 6, B + 6, w - 2 * B - 12, h - 2 * B - 12);
    ctx.strokeStyle = gold;
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.strokeRect(B - 3, B - 3, w - 2 * B + 6, h - 2 * B + 6);
    // scattered small flowers over the field
    for (let i = 0; i < 160; i++) {
      const x = B + 20 + r() * (w - 2 * B - 40);
      const y = B + 20 + r() * (h - 2 * B - 40);
      ctx.fillStyle = [ivory, gold, navy, '#2f5d4a'][Math.floor(r() * 4)];
      ctx.globalAlpha = 0.75;
      for (let p = 0; p < 4; p++) {
        ctx.beginPath();
        ctx.arc(x + Math.cos(p * 1.57) * 5, y + Math.sin(p * 1.57) * 5, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // corner pieces
    const corner = (cx, cy, sx, sy) => {
      ctx.fillStyle = navy;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + sx * 190, cy);
      ctx.quadraticCurveTo(cx + sx * 120, cy + sy * 40, cx + sx * 110, cy + sy * 110);
      ctx.quadraticCurveTo(cx + sx * 40, cy + sy * 120, cx, cy + sy * 170);
      ctx.fill();
      ctx.strokeStyle = gold;
      ctx.lineWidth = 3;
      ctx.stroke();
    };
    corner(B + 12, B + 12, 1, 1);
    corner(w - B - 12, B + 12, -1, 1);
    corner(B + 12, h - B - 12, 1, -1);
    corner(w - B - 12, h - B - 12, -1, -1);
    // central medallion: a stepped lozenge with pendants, a star inside
    const cx = w / 2;
    const cy = h / 2;
    const lozenge = (rx, ry, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const rr = k % 2 ? 0.82 : 1;
        ctx.lineTo(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr);
      }
      ctx.closePath();
      ctx.fill();
    };
    lozenge(250, 170, ivory);
    lozenge(238, 160, navy);
    lozenge(170, 110, red);
    lozenge(120, 78, gold);
    lozenge(70, 46, navy);
    for (const s of [-1, 1]) {
      ctx.fillStyle = navy;
      ctx.fillRect(cx + s * 250 - 22, cy - 22, 44, 44);
      ctx.fillStyle = gold;
      ctx.fillRect(cx + s * 250 - 10, cy - 10, 20, 20);
    }
    // wear and wool texture
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(${r() > 0.5 ? '0,0,0' : '255,240,220'},${r() * 0.06})`;
      ctx.fillRect(r() * w, r() * h, 2, 2);
    }
  });
}
function buildRug(room, item) {
  const w = item.w ?? 6;
  const d = item.d ?? 4;
  const top = new THREE.MeshStandardMaterial({ map: rugTexture(`rug${item.x},${item.z}`), roughness: 1 });
  const side = new THREE.MeshStandardMaterial({ color: 0x5a1815, roughness: 1 });
  const rug = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), [side, side, top, side, side, side]);
  rug.position.set(room.x + (item.x ?? 0), 0.006, room.z + (item.z ?? 0));
  rug.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0);
  rug.receiveShadow = true;
  // remember where it lies, so footsteps go quiet on it
  const center = toWorld(rug.position.x, rug.position.z);
  const turn = frame.rot + rug.rotation.y;
  rugs.push({ x: center.x, z: center.z, hw: w / 2, hd: d / 2, c: Math.cos(turn), s: Math.sin(turn) });
  // fringe along the two short ends
  const fringeTex = canvasTexture(256, 32, (ctx, cw, ch) => {
    for (let x = 0; x < cw; x += 3) {
      ctx.fillStyle = `rgba(235,224,198,${0.7 + Math.random() * 0.3})`;
      ctx.fillRect(x, 0, 2, ch - Math.random() * 8);
    }
  });
  fringeTex.repeat.set(d / 1.5, 1);
  fringeTex.wrapS = THREE.RepeatWrapping;
  const fringeMat = new THREE.MeshStandardMaterial({ map: fringeTex, transparent: true, alphaTest: 0.3, roughness: 1, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(d, 0.1), fringeMat);
    f.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    f.position.set((s * (w + 0.1)) / 2, 0.004, 0);
    rug.add(f);
  }
  parent.add(rug);
}

// Fabric exhibition banner hanging from a brass rod on two ceiling cables.
function bannerTexture(title, subtitle, accent) {
  return canvasTexture(512, 1104, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, shade(accent, -0.18));
    g.addColorStop(0.5, accent);
    g.addColorStop(1, shade(accent, -0.18));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d6b25e';
    ctx.fillRect(40, 70, w - 80, 4);
    ctx.fillRect(40, h - 110, w - 80, 4);
    ctx.textAlign = 'center';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText('AN EXHIBITION', w / 2, 130);
    ctx.fillStyle = '#f6efe0';
    ctx.font = `bold 92px Georgia, "Times New Roman", serif`;
    const words = title.toUpperCase().split(' ');
    words.forEach((word, i) => ctx.fillText(word, w / 2, 280 + i * 108, w - 60));
    const below = 280 + words.length * 108;
    ctx.fillStyle = '#d6b25e';
    ctx.beginPath();
    ctx.moveTo(w / 2, below - 20);
    ctx.lineTo(w / 2 + 16, below - 4);
    ctx.lineTo(w / 2, below + 12);
    ctx.lineTo(w / 2 - 16, below - 4);
    ctx.fill();
    ctx.fillRect(w / 2 - 120, below - 5, 90, 2);
    ctx.fillRect(w / 2 + 30, below - 5, 90, 2);
    ctx.fillStyle = '#efe4c8';
    ctx.font = `italic 34px Georgia, "Times New Roman", serif`;
    wrapText(ctx, subtitle, w - 90).forEach((line, i) => ctx.fillText(line, w / 2, below + 80 + i * 46));
    // woven texture
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + (y % 6 ? 0.02 : 0)})`;
      ctx.fillRect(0, y, w, 1);
    }
  });
}
function buildBanner(room, item) {
  const W = 1.3;
  const H = 2.8;
  const top = room.height - 0.6;
  const g = new THREE.Group();
  g.position.set(room.x + (item.x ?? 0), 0, room.z + (item.z ?? 0));
  g.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0);
  // gentle folds in the cloth
  const geo = new THREE.PlaneGeometry(W, H, 24, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 11) * 0.012);
  geo.computeVertexNormals();
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: bannerTexture(item.title ?? '', item.subtitle ?? '', item.color ?? '#6e1b21'), roughness: 0.85, side: THREE.DoubleSide }));
  cloth.position.y = top - 0.04 - H / 2;
  cloth.castShadow = true;
  g.add(cloth);
  const rod = piece(g, new THREE.CylinderGeometry(0.018, 0.018, W + 0.16, 12).rotateZ(Math.PI / 2), MAT.gilt, 0, top, 0);
  rod.castShadow = true;
  for (const s of [-1, 1]) {
    piece(g, new THREE.SphereGeometry(0.035, 14, 10), MAT.gilt, s * (W / 2 + 0.1), top, 0);
    rodBetween(g, new THREE.Vector3(s * (W / 2 - 0.05), top, 0), new THREE.Vector3(s * (W / 2 - 0.05), room.height, 0), 0.003, MAT.metal);
  }
  piece(g, new THREE.CylinderGeometry(0.012, 0.012, W, 8).rotateZ(Math.PI / 2), MAT.gilt, 0, top - 0.04 - H, 0); // weighted hem
  parent.add(g);
}

// Gallery name in big cut vinyl letters on the colored feature wall, the way museums title a room.
function buildWallTitle(room) {
  const side = room.featureWall ?? 'north';
  const [number, name] = room.name.includes(': ') ? room.name.split(': ') : ['', room.name];
  const c = new THREE.Color(room.accent ?? '#888');
  const light = c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.6;
  const ink = light ? '#1d1a17' : '#ffffff';
  const tex = canvasTexture(2048, 400, (ctx, w, h) => {
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.font = `bold 72px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '18px';
    ctx.fillText(number.toUpperCase(), w / 2, 92);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.font = `bold 210px Georgia, "Times New Roman", serif`;
    ctx.fillText(name, w / 2, 330, w - 40);
  });
  const width = Math.min(7, wallLength(room, side) - 2);
  const title = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * (400 / 2048)),
    // matte vinyl, a little self-lit so it stays crisp against the colored wall
    new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0x777777, transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  title.position.z = 0.006;
  const holder = new THREE.Group();
  holder.add(title);
  mountOnWall(room, { wall: side, at: 0 }, holder, room.height - 0.78);
}

// A panelled mahogany door that doesn't open (staff rooms, restrooms): architrave, four raised
// panels, a brass knob and kick plate, and a small brass sign.
const DOOR_W = 1.1;
const DOOR_H = 2.4;
function buildFakeDoor(room, ex) {
  const g = new THREE.Group();
  const box = (w, h, d, mat, x, y, z) => piece(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  // architrave: two posts and a head with a little cornice
  for (const s of [-1, 1]) box(0.13, DOOR_H + 0.06, 0.1, MAT.mahogany, s * (DOOR_W / 2 + 0.065), (DOOR_H + 0.06) / 2, 0.05);
  box(DOOR_W + 0.26, 0.16, 0.1, MAT.mahogany, 0, DOOR_H + 0.11, 0.05);
  box(DOOR_W + 0.34, 0.04, 0.13, MAT.mahogany, 0, DOOR_H + 0.21, 0.065);
  // the door itself, set back a little in its frame
  box(DOOR_W, DOOR_H, 0.05, MAT.mahogany, 0, DOOR_H / 2, 0.04);
  const panel = (w, h, y) => {
    for (const s of [-1, 1]) {
      box(w, h, 0.012, MAT.trim, s * (DOOR_W / 4 + 0.005), y, 0.068);
      box(w - 0.06, h - 0.06, 0.02, MAT.mahogany, s * (DOOR_W / 4 + 0.005), y, 0.074);
    }
  };
  panel(0.38, 1.0, 1.72);
  panel(0.38, 0.72, 0.6);
  // brass knob with its round rose, keyhole escutcheon, and kick plate
  piece(g, new THREE.CylinderGeometry(0.035, 0.035, 0.012, 20).rotateX(Math.PI / 2), MAT.brass, DOOR_W / 2 - 0.1, 1.0, 0.071);
  piece(g, new THREE.SphereGeometry(0.03, 16, 12), MAT.brass, DOOR_W / 2 - 0.1, 1.0, 0.11);
  piece(g, new THREE.CylinderGeometry(0.008, 0.012, 0.035, 10).rotateX(Math.PI / 2), MAT.brass, DOOR_W / 2 - 0.1, 1.0, 0.088);
  box(0.03, 0.06, 0.006, MAT.brass, DOOR_W / 2 - 0.1, 0.9, 0.068);
  box(DOOR_W - 0.08, 0.2, 0.006, MAT.brass, 0, 0.12, 0.068);
  if (ex.sign) {
    const sign = piece(g, new THREE.PlaneGeometry(0.62, 0.126), new THREE.MeshBasicMaterial({ map: plaqueTexture(ex.sign) }), 0, 1.58, 0.0855);
    sign.material.polygonOffset = true;
    sign.material.polygonOffsetFactor = -1;
  }
  g.traverse((m) => m.isMesh && (m.receiveShadow = true));
  mountOnWall(room, ex, g, 0);
}

// The stretch [a, b] of a wall, minus anything that sits in the wall from the floor up
// (the glass entrance doors, panelled doors), so skirting and panelling stop at their frames.
function aroundWallDoors(room, side, a, b) {
  const gaps = [];
  if (room.entrance === side) gaps.push([-ENTRANCE_W / 2 - 0.1, ENTRANCE_W / 2 + 0.1]);
  for (const ex of room.exhibits ?? []) {
    if (ex.type === 'door' && ex.wall === side) gaps.push([(ex.at ?? 0) - DOOR_W / 2 - 0.12, (ex.at ?? 0) + DOOR_W / 2 + 0.12]);
  }
  let pieces = [[a, b]];
  for (const [g0, g1] of gaps) {
    pieces = pieces.flatMap(([p, q]) => {
      const out = [];
      if (p < g0) out.push([p, Math.min(q, g0)]);
      if (q > g1) out.push([Math.max(p, g1), q]);
      return out;
    });
  }
  return pieces;
}

// Framed exhibition poster behind glass, in a slim gilt frame.
function posterTexture(design) {
  return canvasTexture(640, 912, (ctx, w, h) => {
    const serif = 'Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    if (design === 'micawber') {
      ctx.fillStyle = '#1f3a2e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#c9a24a';
      ctx.lineWidth = 3;
      ctx.strokeRect(26, 26, w - 52, h - 52);
      ctx.strokeRect(36, 36, w - 72, h - 72);
      ctx.fillStyle = '#c9a24a';
      ctx.font = `bold 150px ${serif}`;
      ctx.fillText('“', w / 2, 210);
      ctx.fillStyle = '#efe6d2';
      ctx.font = `italic 36px ${serif}`;
      const quote = 'Annual income twenty pounds, annual expenditure nineteen nineteen and six, result happiness. Annual income twenty pounds, annual expenditure twenty pounds ought and six, result misery.';
      const lines = wrapText(ctx, quote, w - 130);
      lines.forEach((line, i) => ctx.fillText(line, w / 2, 260 + i * 50));
      const y = 260 + lines.length * 50 + 40;
      ctx.fillStyle = '#c9a24a';
      ctx.fillRect(w / 2 - 60, y, 120, 3);
      ctx.font = `600 30px ${serif}`;
      ctx.fillText('MR. MICAWBER', w / 2, y + 60);
      ctx.font = `italic 26px ${serif}`;
      ctx.fillStyle = '#d9cfb8';
      ctx.fillText('David Copperfield, Chapter 12', w / 2, y + 100);
    } else {
      ctx.fillStyle = '#efe6d2';
      ctx.fillRect(0, 0, w, h);
      // paper grain
      const r = seededRandom('poster');
      for (let i = 0; i < 5000; i++) {
        ctx.fillStyle = `rgba(90,70,40,${r() * 0.06})`;
        ctx.fillRect(r() * w, r() * h, 2, 2);
      }
      ctx.fillStyle = '#6e1b21';
      ctx.font = `600 24px ${FONT}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
      ctx.fillText('AN EXHIBITION IN FOUR GALLERIES', w / 2, 90);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.fillStyle = '#1d1a17';
      ctx.font = `bold 108px ${serif}`;
      ['WHAT', 'TRYING', 'COSTS'].forEach((word, i) => ctx.fillText(word, w / 2, 220 + i * 112));
      // a gold sovereign
      const cy = 610;
      ctx.fillStyle = '#c9a24a';
      ctx.beginPath();
      ctx.arc(w / 2, cy, 92, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a6a26';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w / 2, cy, 78, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 60; k++) {
        const a = (k / 60) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(w / 2 + Math.cos(a) * 84, cy + Math.sin(a) * 84);
        ctx.lineTo(w / 2 + Math.cos(a) * 90, cy + Math.sin(a) * 90);
        ctx.stroke();
      }
      ctx.fillStyle = '#5a4316';
      ctx.font = `bold 80px ${serif}`;
      ctx.fillText('£', w / 2, cy + 28);
      ctx.fillStyle = '#6e1b21';
      ctx.font = `italic 32px ${serif}`;
      wrapText(ctx, 'Debt and its price in Charles Dickens’s David Copperfield', w - 120).forEach((line, i) => ctx.fillText(line, w / 2, 765 + i * 42));
      ctx.fillStyle = '#1d1a17';
      ctx.font = `600 22px ${FONT}`;
      ctx.fillText('THE ROTUNDA  →  GALLERIES 1–4', w / 2, h - 50);
    }
  });
}
function buildPoster(room, ex) {
  const w = 0.95;
  const h = w * (912 / 640);
  const y = clearOfWainscot(room, ex.y ?? 2.1, h + 0.1);
  const g = new THREE.Group();
  const frame = new THREE.Mesh(frameGeometry(w + 0.08, h + 0.08, w, h, 0.03), MAT.gilt);
  frame.position.z = 0.02;
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), displayMaterial(posterTexture(ex.design), 2));
  art.position.z = 0.03;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.08, depthWrite: false }));
  glass.position.z = 0.045;
  g.add(frame, art, glass);
  addWallLighting(g, w + 0.08, h + 0.08, undefined, false);
  mountOnWall(room, ex, g, y);
}

// Fire alarm pull station with a horn-strobe above it, as building codes require in every gallery.
function fireAlarmTexture(kind) {
  return canvasTexture(128, 160, (ctx, w, h) => {
    ctx.fillStyle = kind === 'strobe' ? '#f2f2ee' : '#c3201d';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = kind === 'strobe' ? '#c3201d' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `bold 34px ${FONT}`;
    ctx.fillText('FIRE', w / 2, kind === 'strobe' ? h - 22 : 44);
    if (kind !== 'strobe') {
      ctx.font = `bold 16px ${FONT}`;
      ctx.fillText('PULL DOWN', w / 2, h - 18);
    }
  });
}

// ---------------------------------------------------------------- the rotunda
// An octagonal domed hall: damask walls over mahogany wainscot, marble columns at the corners,
// an inlaid marble floor, and a coffered dome open to the sky through an oculus.
// Angles are compass bearings: 0 = north, 90 = east, 180 = south, -90 = west.
const compass = (deg) => {
  const a = THREE.MathUtils.degToRad(deg);
  return { x: Math.sin(a), z: -Math.cos(a) };
};

// Inlaid marble floor: cream stone with a sixteen-point star medallion and a dark border.
function rotundaFloorTexture(room, R) {
  const S = SMALL_SCREEN ? 1024 : 2048;
  const ppm = S / (2 * R);
  return canvasTexture(S, S, (ctx) => {
    const c = S / 2;
    const at = (deg, r) => {
      const d = compass(deg);
      return [c + d.x * r * ppm, c + d.z * r * ppm];
    };
    // adds a closed shape to the current path (call ctx.beginPath() first)
    const poly = (pts) => {
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    const octagon = (apothem) => poly(Array.from({ length: 8 }, (_, k) => at(22.5 + k * 45, apothem / Math.cos(Math.PI / 8))));
    ctx.fillStyle = '#e6dfd0';
    ctx.fillRect(0, 0, S, S);
    // each cut slab of stone is a slightly different shade
    const r = seededRandom('rotunda-floor');
    for (let rr = 6.5; rr < R; rr += 1.6) {
      for (let deg = 0; deg < 360; deg += 15) {
        const a0 = THREE.MathUtils.degToRad(deg - 90);
        const a1 = THREE.MathUtils.degToRad(deg + 15 - 90);
        ctx.beginPath();
        ctx.arc(c, c, (rr + 1.6) * ppm, a0, a1);
        ctx.arc(c, c, rr * ppm, a1, a0, true);
        ctx.fillStyle = r() > 0.5 ? `rgba(255,252,244,${r() * 0.25})` : `rgba(120,105,85,${r() * 0.08})`;
        ctx.fill();
      }
    }
    // stone joints: rings and spokes
    ctx.strokeStyle = 'rgba(90,80,65,0.28)';
    ctx.lineWidth = Math.max(1, ppm * 0.012);
    for (let rr = 6.5; rr < R; rr += 1.6) {
      ctx.beginPath();
      ctx.arc(c, c, rr * ppm, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let deg = 0; deg < 360; deg += 15) {
      ctx.beginPath();
      ctx.moveTo(...at(deg, 5.4));
      ctx.lineTo(...at(deg, R));
      ctx.stroke();
    }
    // border band just inside the walls
    ctx.fillStyle = '#23413a';
    ctx.beginPath();
    octagon(room.apothem - 0.25);
    octagon(room.apothem - 1.05);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#b8913a';
    ctx.lineWidth = ppm * 0.04;
    ctx.beginPath();
    octagon(room.apothem - 1.1);
    ctx.stroke();
    // medallion: rings and a sixteen-point star in rust and green
    ctx.beginPath();
    ctx.arc(c, c, 5.2 * ppm, 0, Math.PI * 2);
    ctx.arc(c, c, 4.75 * ppm, 0, Math.PI * 2, true);
    ctx.fillStyle = '#23413a';
    ctx.fill();
    ctx.strokeStyle = '#b8913a';
    ctx.beginPath();
    ctx.arc(c, c, 4.6 * ppm, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 16; k++) {
      const deg = k * 22.5;
      const tip = k % 2 ? 3.2 : 4.45;
      ctx.beginPath();
      poly([at(deg - 11.25, 1.9), at(deg, tip), at(deg + 11.25, 1.9)]);
      ctx.fillStyle = k % 2 ? '#8a3b2a' : '#23413a';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(c, c, 1.9 * ppm, 0, Math.PI * 2);
    ctx.fillStyle = '#d9cfbb';
    ctx.fill();
    ctx.strokeStyle = '#8a3b2a';
    ctx.lineWidth = ppm * 0.06;
    ctx.stroke();
    // real marble veining through everything, laid in 1.6 m slabs
    const veins = surfaceCanvas('marble', '#ffffff');
    const pattern = ctx.createPattern(veins, 'repeat');
    pattern.setTransform?.(new DOMMatrix().scale((ppm * 1.6) / veins.width));
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';
  });
}

// Shadow map for the rotunda floor: dark along the walls (not across doorways) and under objects.
function rotundaAO(room, R, faceW) {
  const ppm = AO_PPM;
  const S = Math.ceil(2 * R * ppm);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, S, S);
  const c = S / 2;
  const band = 0.6 * ppm;
  for (let k = 0; k < 8; k++) {
    const deg = k * 45;
    const n = compass(deg);
    const t = compass(deg + 90); // along the face
    const opening = room.openings.find((o) => ((o.angle % 360) + 360) % 360 === deg);
    const ranges = opening
      ? [[-faceW / 2, -opening.width / 2], [opening.width / 2, faceW / 2]]
      : [[-faceW / 2, faceW / 2]];
    const a = room.apothem - HALF_WALL;
    for (const [from, to] of ranges) {
      const p = (along, depth) => [c + (n.x * (a - depth) + t.x * along) * ppm, c + (n.z * (a - depth) + t.z * along) * ppm];
      const g = ctx.createLinearGradient(...p(0, 0), ...p(0, band / ppm));
      ctx.fillStyle = shadowBand(g);
      ctx.beginPath();
      [p(from, 0), p(to, 0), p(to, band / ppm), p(from, band / ppm)].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    }
  }
  for (const f of room.footprints) {
    const shape = () => footprintShape(ctx, c + f.x * ppm, c + f.z * ppm, f, ppm);
    softShadow(ctx, shape, 0.45 * ppm, 0.4);
    softShadow(ctx, shape, 0.08 * ppm, 0.55);
  }
  return new THREE.CanvasTexture(canvas);
}

// Coffered dome: rows of recessed square panels with gilt rosettes, narrowing toward the oculus.
function cofferTexture() {
  const W = SMALL_SCREEN ? 1024 : 2048;
  return canvasTexture(W, W / 2, (ctx, w, h) => {
    ctx.fillStyle = '#ece3d1';
    ctx.fillRect(0, 0, w, h);
    const cols = 24;
    const rows = 5;
    const band = h * 0.1;
    const cw = w / cols;
    const ch = (h - band) / rows;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const x = col * cw;
        const y = r * ch;
        const step = (inset, color) => {
          ctx.fillStyle = color;
          ctx.fillRect(x + cw * inset, y + ch * inset, cw * (1 - 2 * inset), ch * (1 - 2 * inset));
        };
        step(0.1, '#d8ccb3');
        step(0.17, '#c6b89b');
        const g = ctx.createLinearGradient(x, y + ch * 0.24, x, y + ch * 0.76);
        g.addColorStop(0, '#b3a385');
        g.addColorStop(1, '#cdbfa2');
        ctx.fillStyle = g;
        ctx.fillRect(x + cw * 0.24, y + ch * 0.24, cw * 0.52, ch * 0.52);
        ctx.fillStyle = '#c29b45';
        ctx.beginPath();
        ctx.arc(x + cw / 2, y + ch / 2, Math.min(cw, ch) * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // gilt band where the dome meets the cornice
    ctx.fillStyle = '#c29b45';
    ctx.fillRect(0, h - band, w, band * 0.25);
    ctx.fillStyle = '#e2d6bd';
    ctx.fillRect(0, h - band * 0.75, w, band * 0.75);
    ctx.fillStyle = '#b48a3a';
    for (let x = 0; x < w; x += w / 96) {
      ctx.beginPath();
      ctx.ellipse(x + w / 192, h - band * 0.38, w / 380, band * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function buildRotunda(room, group) {
  const a = room.apothem;
  const H = room.height;
  const R = a / Math.cos(Math.PI / 8); // center to corner
  const faceW = 2 * a * Math.tan(Math.PI / 8);
  const roomPlace = { ...frame };

  // floor
  const floorMat = new THREE.MeshStandardMaterial({ map: rotundaFloorTexture(room, R), roughness: 0.22 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 8, Math.PI / 8), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  parent.add(floor);

  // the eight walls, each built like the north wall of a narrow room turned to face the center
  const faceItems = {};
  for (const ex of room.exhibits ?? []) {
    if (ex.face === undefined) continue;
    const key = ((ex.face % 360) + 360) % 360;
    (faceItems[key] ??= []).push({ ...ex, wall: 'north' });
  }
  for (let k = 0; k < 8; k++) {
    const deg = k * 45;
    const faceGroup = new THREE.Group();
    faceGroup.rotation.y = -THREE.MathUtils.degToRad(deg);
    group.add(faceGroup);
    parent = faceGroup;
    frame = { ...roomPlace, rot: -THREE.MathUtils.degToRad(deg) };
    const openings = room.openings.filter((o) => ((o.angle % 360) + 360) % 360 === deg);
    const face = Object.assign(Object.create(room), {
      x: 0, z: 0, w: faceW, d: 2 * a,
      doors: { north: openings.map((o) => ({ at: 0, width: o.width, to: o.to, label: o.label })), south: [], east: [], west: [] },
      exhibits: faceItems[deg] ?? [],
    });
    buildWall(face, 'north');
    for (const ex of face.exhibits) {
      if (ex.type === 'painting') buildPainting(face, ex);
      else if (ex.type === 'panel') buildPanel(face, ex);
    }
  }
  parent = group;
  frame = roomPlace;

  // marble columns in the corners, with gilt capitals
  const shaftH = H - 1.15;
  const columnMat = new THREE.MeshStandardMaterial({ ...surfaceMaps('marble', '#ece6da', 1, 2), roughness: 1 });
  const parts = {
    plinth: new THREE.BoxGeometry(1, 0.28, 1),
    base: new THREE.CylinderGeometry(0.42, 0.46, 0.16, 32),
    shaft: new THREE.CylinderGeometry(0.31, 0.35, shaftH, 32),
    ring: new THREE.TorusGeometry(0.33, 0.04, 12, 32).rotateX(Math.PI / 2),
    capital: new THREE.CylinderGeometry(0.5, 0.36, 0.3, 32),
    abacus: new THREE.BoxGeometry(1.05, 0.14, 1.05),
  };
  for (let k = 0; k < 8; k++) {
    const deg = 22.5 + k * 45;
    const d = compass(deg);
    const dist = R - 0.95;
    const col = new THREE.Group();
    col.position.set(d.x * dist, 0, d.z * dist);
    col.rotation.y = -THREE.MathUtils.degToRad(deg);
    const piece = (geo, mat, y) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.castShadow = m.receiveShadow = true;
      col.add(m);
    };
    piece(parts.plinth, columnMat, 0.14);
    piece(parts.base, columnMat, 0.36);
    piece(parts.shaft, columnMat, 0.44 + shaftH / 2);
    piece(parts.ring, MAT.gilt, 0.46 + shaftH);
    piece(parts.capital, MAT.gilt, 0.6 + shaftH);
    piece(parts.abacus, columnMat, 0.82 + shaftH);
    parent.add(col);
    addCollider(d.x * dist, d.z * dist, 1, 1, -THREE.MathUtils.degToRad(deg));
    room.footprints.push({ x: d.x * dist, z: d.z * dist, w: 1, d: 1, rot: -THREE.MathUtils.degToRad(deg) });
  }

  // ring of ceiling between the octagon and the round dome, with a gilt molding at the dome's base
  const domeR = a - HALF_WALL - 0.35;
  const cap = new THREE.Shape(Array.from({ length: 8 }, (_, k) => {
    const d = compass(22.5 + k * 45);
    return new THREE.Vector2(d.x * (R + 0.3), d.z * (R + 0.3));
  }));
  const hole = new THREE.Path();
  hole.absarc(0, 0, domeR, 0, Math.PI * 2, true);
  cap.holes.push(hole);
  const capMesh = new THREE.Mesh(new THREE.ShapeGeometry(cap, 96), MAT.plasterwork);
  capMesh.rotation.x = Math.PI / 2;
  capMesh.position.y = H;
  parent.add(capMesh);
  const domeRing = new THREE.Mesh(new THREE.TorusGeometry(domeR, 0.14, 12, 128).rotateX(Math.PI / 2), MAT.gilt);
  domeRing.position.y = H - 0.05;
  parent.add(domeRing);

  // the dome, open at the top
  const OCULUS = 0.2; // how much of the top is open
  const rise = 0.62;
  const domeTex = cofferTexture();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(domeR, 96, 32, 0, Math.PI * 2, OCULUS, Math.PI / 2 - OCULUS),
    new THREE.MeshStandardMaterial({ map: domeTex, emissiveMap: domeTex, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.9, side: THREE.BackSide }),
  );
  dome.scale.y = rise;
  dome.position.y = H;
  parent.add(dome);
  const oculusR = domeR * Math.sin(OCULUS);
  const topY = H + domeR * Math.cos(OCULUS) * rise;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(oculusR, 0.16, 12, 64).rotateX(Math.PI / 2), MAT.gilt);
  rim.position.y = topY;
  const sky = new THREE.Mesh(new THREE.CircleGeometry(oculusR + 0.3, 48).rotateX(Math.PI / 2), MAT.sky);
  sky.position.y = topY + 0.4;
  parent.add(rim, sky);

  // a faint shaft of daylight falling from the oculus
  const shaftTex = canvasTexture(4, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,248,232,0.9)');
    g.addColorStop(1, 'rgba(255,248,232,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(oculusR * 0.95, oculusR * 1.35, topY, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  shaft.position.y = topY / 2;
  parent.add(shaft);
  // dust drifting slowly through the daylight
  const motes = SMALL_SCREEN ? 140 : 320;
  const moteHome = new Float32Array(motes * 4);
  const motePos = new Float32Array(motes * 3);
  for (let i = 0; i < motes; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * oculusR * 1.15;
    moteHome.set([Math.cos(a) * rr, Math.random() * (topY - 1), Math.sin(a) * rr, Math.random() * 100], i * 4);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteTex = canvasTexture(32, 32, (ctx, w, h) => {
    const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,245,225,1)');
    gr.addColorStop(1, 'rgba(255,245,225,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
  });
  const dust = new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: 0.09, map: moteTex, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.frustumCulled = false;
  parent.add(dust);
  const span = topY - 1;
  animators.push((t) => {
    for (let i = 0; i < motes; i++) {
      const [hx, hy, hz, seed] = moteHome.subarray(i * 4, i * 4 + 4);
      motePos[i * 3] = hx + Math.sin(t * 0.13 + seed) * 0.35;
      motePos[i * 3 + 1] = 0.5 + ((hy - t * 0.05 + span) % span);
      motePos[i * 3 + 2] = hz + Math.cos(t * 0.11 + seed * 1.3) * 0.35;
    }
    moteGeo.attributes.position.needsUpdate = true;
  });

  // light: a warm room light plus daylight from the oculus
  const warm = new THREE.PointLight(0xffd9a8, ROOM_LIGHT * 1.7, R * 2.2, 1);
  warm.position.set(0, H - 1.5, 0);
  const daylight = new THREE.SpotLight(0xfff4e0, 30, topY + 4, 0.55, 0.7, 1);
  daylight.position.set(0, topY, 0);
  daylight.target.position.set(0, 0, 0);
  parent.add(warm, daylight, daylight.target);

  // the bust and anything else standing on the floor
  for (const ex of room.exhibits ?? []) {
    if (ex.face !== undefined) continue;
    if (ex.type === 'pedestal') buildPedestal(room, ex);
    else if (ex.type === 'case') buildCase(room, ex);
  }
  for (const item of room.decor ?? []) buildDecor(room, item);

  floorMat.aoMap = rotundaAO(room, R, faceW);
  floorMat.needsUpdate = true;
}

// ---------------------------------------------------------------- build everything
linkDoors();
for (const room of ROOMS) {
  // build each room in its own placed-and-turned group
  const group = new THREE.Group();
  group.position.set(room.x, 0, room.z);
  group.rotation.y = room.rot ?? 0;
  scene.add(group);
  parent = group;
  frame = roomFrame(room);
  const local = Object.assign(Object.create(room), { x: 0, z: 0 }); // same room, local coordinates
  if (room.shape === 'octagon') buildRotunda(local, group);
  else buildRoom(local);
}
parent = scene;
frame = { x: 0, z: 0, rot: 0 };
scene.add(new THREE.HemisphereLight(0xfff6ea, 0x4a3f35, 0.6));

// ---------------------------------------------------------------- player
const spawnRoom = ROOMS[0];
function placePlayer(x, z, facing) {
  camera.position.set(x, EYE_HEIGHT, z);
  camera.rotation.set(0, typeof facing === 'number' ? facing : FACING[facing] ?? 0, 0);
}
placePlayer(MUSEUM.spawn?.x ?? spawnRoom.x, MUSEUM.spawn?.z ?? spawnRoom.z, MUSEUM.spawn?.facing ?? 'north');

const VISIT_ROOMS = ROOMS.filter((r) => !r.passage); // rooms the number keys and minimap count

function teleportTo(room) {
  if (room.shape === 'octagon') return placePlayer(room.x, room.z + room.apothem - 3, 'north');
  if (room.attach) {
    // just inside the doorway from the rotunda, looking into the wing
    const p = toWorld(0, room.d / 2 - 2.5, roomFrame(room));
    return placePlayer(p.x, p.z, room.rot);
  }
  // stand just inside the room's first doorway, facing in
  for (const side of Object.keys(SIDES)) {
    const door = room.doors[side][0];
    if (!door) continue;
    const p = wallPoint(room, side, door.at, 2);
    placePlayer(p.x, p.z, SIDES[side].opposite);
    return;
  }
  placePlayer(room.x, room.z, 'north');
}

const keys = new Set();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Is the visitor (a circle) overlapping any collider (a possibly-turned box)?
function blocked(x, z) {
  for (const b of colliders) {
    const dx = x - b.x;
    const dz = z - b.z;
    const lx = dx * b.c - dz * b.s; // into the box's own axes
    const lz = dx * b.s + dz * b.c;
    const qx = lx - THREE.MathUtils.clamp(lx, -b.hw, b.hw);
    const qz = lz - THREE.MathUtils.clamp(lz, -b.hd, b.hd);
    if (qx * qx + qz * qz < PLAYER_RADIUS * PLAYER_RADIUS) return true;
  }
  return false;
}

// 'desktop' (pointer lock + keyboard) or 'touch' (thumb stick + drag), picked on the start screen
let mode = null;
let touchPlaying = false;
let panelOpen = false;
const joystick = { x: 0, y: 0 }; // -1..1, pushing up is y = -1
const isPlaying = () => (mode === 'touch' ? touchPlaying && !panelOpen : controls.isLocked);

function updateMovement(dt) {
  if (!isPlaying()) return;
  let f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  let speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
  if (mode === 'touch' && (joystick.x || joystick.y)) {
    f = -joystick.y;
    r = joystick.x;
    speed = WALK_SPEED * 1.4 * Math.min(1, Math.hypot(f, r)); // push further to go faster
  }
  if (!f && !r) {
    camera.position.y += (EYE_HEIGHT - camera.position.y) * Math.min(1, dt * 8); // settle after walking
    return;
  }

  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  right.crossVectors(forward, UP);
  move.set(0, 0, 0).addScaledVector(forward, f).addScaledVector(right, r).normalize();
  move.multiplyScalar(speed * dt);

  // move one axis at a time so the player slides along walls
  const pos = camera.position;
  const x0 = pos.x;
  const z0 = pos.z;
  if (!blocked(pos.x + move.x, pos.z)) pos.x += move.x;
  if (!blocked(pos.x, pos.z + move.z)) pos.z += move.z;
  walk(Math.hypot(pos.x - x0, pos.z - z0));
}

// A footstep sound every stride, and the faint rise and fall of the head while walking.
const STRIDE = 0.75;
const footsteps = new Footsteps();
let strideLeft = STRIDE / 2;
let gait = 0;
function walk(distance) {
  if (!distance) return;
  gait += (distance / STRIDE) * Math.PI;
  camera.position.y = EYE_HEIGHT - 0.012 + Math.abs(Math.sin(gait)) * 0.024;
  strideLeft -= distance;
  if (strideLeft <= 0) {
    strideLeft += STRIDE;
    if (music.enabled) footsteps.step(surfaceAt(camera.position.x, camera.position.z));
  }
}
function surfaceAt(x, z) {
  for (const b of rugs) {
    const dx = x - b.x;
    const dz = z - b.z;
    if (Math.abs(dx * b.c - dz * b.s) < b.hw && Math.abs(dx * b.s + dz * b.c) < b.hd) return 'rug';
  }
  const room = roomAt(x, z);
  if (room?.shape === 'octagon') return 'marble';
  return room?.floor === 'concrete' ? 'concrete' : 'wood';
}

function inRoom(room, x, z) {
  const p = toLocal(x, z, roomFrame(room));
  if (room.shape === 'octagon') {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      if (p.x * Math.sin(a) - p.z * Math.cos(a) > room.apothem) return false;
    }
    return true;
  }
  return Math.abs(p.x) <= room.w / 2 && Math.abs(p.z) <= room.d / 2;
}
function roomAt(x, z) {
  return ROOMS.find((r) => inRoom(r, x, z));
}

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
const ui = {
  overlay: $('overlay'),
  enter: $('enter-btn'),
  prompt: $('prompt'),
  roomLabel: $('room-label'),
  minimap: $('minimap'),
  panel: $('info-panel'),
  enterTouch: $('enter-touch-btn'),
  musicBtn: $('music-btn'),
  musicHud: $('music-hud'),
  qualityBtn: $('quality-btn'),
  joystick: $('joystick'),
  knob: $('joystick-knob'),
};
document.title = MUSEUM.title;
$('museum-title').textContent = MUSEUM.title;
$('museum-subtitle').textContent = MUSEUM.subtitle ?? '';
$('credits').textContent = MUSEUM.credits ?? '';

let focused = null;

// ---- music
const music = new AmbientMusic(MUSEUM.music);
function updateMusicButtons() {
  ui.musicBtn.textContent = music.enabled ? '\u266B Sound: on' : '\u266B Sound: off';
  ui.musicHud.classList.toggle('off', !music.enabled);
}
function toggleMusic() {
  music.toggle();
  updateMusicButtons();
}
updateMusicButtons();
ui.musicBtn.addEventListener('click', toggleMusic);
ui.musicHud.addEventListener('click', toggleMusic);
document.addEventListener('visibilitychange', () => {
  music.setVisible(!document.hidden);
  footsteps.setVisible(!document.hidden);
});

// ---- start / pause screen
const prefersTouch = window.matchMedia('(pointer: coarse)').matches;

// ---- graphics quality: "high" adds soft contact shadows (GTAO) and glow (bloom) as a post-process
let quality = prefersTouch ? 'standard' : 'high';
try {
  quality = localStorage.getItem('museum-quality') ?? quality;
} catch {}
let composer = null;

function setupComposer() {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  gtao.blendIntensity = 0.85;
  composer.addPass(gtao);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.18, 0.4, 2.2));
  composer.addPass(new OutputPass());
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
}

function setQuality(q) {
  quality = q;
  try {
    localStorage.setItem('museum-quality', q);
  } catch {}
  if (q === 'high' && !composer) setupComposer();
  ui.qualityBtn.textContent = q === 'high' ? 'Graphics: high' : 'Graphics: standard (faster)';
}
setQuality(quality);
ui.qualityBtn.addEventListener('click', () => setQuality(quality === 'high' ? 'standard' : 'high'));
if (prefersTouch) {
  ui.enter.classList.remove('primary');
  ui.enterTouch.classList.add('primary');
  ui.enterTouch.parentElement.prepend(ui.enterTouch);
}

function showMenu() {
  keys.clear();
  ui.enter.textContent = 'Resume with mouse & keyboard';
  ui.enterTouch.textContent = 'Resume on phone / tablet';
  ui.overlay.classList.remove('hidden');
}

ui.enter.addEventListener('click', () => {
  mode = 'desktop';
  touchPlaying = false;
  document.body.classList.remove('touch');
  music.start();
  footsteps.unlock();
  controls.lock();
});

ui.enterTouch.addEventListener('click', () => {
  mode = 'touch';
  touchPlaying = true;
  document.body.classList.add('touch');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // easier on phone GPUs
  composer?.setPixelRatio(renderer.getPixelRatio());
  composer?.setSize(window.innerWidth, window.innerHeight);
  music.start();
  footsteps.unlock();
  ui.overlay.classList.add('hidden');
  // hide the browser bars where possible (Android, iPad); harmless where unsupported
  document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
});

controls.addEventListener('lock', () => ui.overlay.classList.add('hidden'));
controls.addEventListener('unlock', () => {
  if (mode === 'desktop' && !panelOpen) showMenu();
});
document.addEventListener('pointerlockerror', () => {
  if (!panelOpen) showMenu();
});

$('menu-hud').addEventListener('click', () => {
  touchPlaying = false;
  resetJoystick();
  showMenu();
});
$('map-hud').addEventListener('click', () => ui.minimap.classList.toggle('hidden'));

function openPanel(exhibit, room) {
  panelOpen = true;
  $('info-room').textContent = room.name;
  $('info-title').textContent = exhibit.title || 'Exhibit coming soon';
  $('info-subtitle').textContent = exhibit.subtitle ?? '';
  const img = $('info-image');
  if (exhibit.image) img.src = exhibit.image;
  else img.removeAttribute('src');
  img.alt = exhibit.title ?? '';
  const body = $('info-body');
  body.replaceChildren();
  const description = exhibit.description || (exhibit.title ? '' : 'This space is saved for an upcoming exhibit.');
  const paragraphs = Array.isArray(description) ? description : description.split('\n');
  for (const text of paragraphs) {
    const p = document.createElement('p');
    p.textContent = text;
    body.append(p);
  }
  const link = $('info-link');
  link.textContent = exhibit.link ? (exhibit.linkText ?? 'Learn more →') : '';
  link.href = exhibit.link ?? '#';
  ui.panel.classList.remove('hidden');
  ui.prompt.classList.add('hidden');
  promptFor = null;
  resetJoystick();
  if (mode === 'desktop') controls.unlock();
}

function closePanel() {
  panelOpen = false;
  ui.panel.classList.add('hidden');
  if (mode === 'desktop') controls.lock();
}
$('info-close').addEventListener('click', closePanel);

document.addEventListener('keydown', (e) => {
  if (panelOpen) {
    if (e.code === 'KeyE' || e.code === 'Escape') closePanel();
    return;
  }
  keys.add(e.code);
  if (e.code === 'KeyN') toggleMusic();
  if (!controls.isLocked) return;
  if (e.code === 'KeyE' && focused) openPanel(focused.userData.exhibit, focused.userData.room);
  if (e.code === 'KeyM') ui.minimap.classList.toggle('hidden');
  const n = Number(e.key);
  if (n >= 1 && n <= VISIT_ROOMS.length) teleportTo(VISIT_ROOMS[n - 1]);
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('mousedown', () => {
  if (controls.isLocked && focused) openPanel(focused.userData.exhibit, focused.userData.room);
});

// what is the visitor looking at?
const raycaster = new THREE.Raycaster();
raycaster.far = INTERACT_DISTANCE;
const screenCenter = new THREE.Vector2(0, 0);
const rayTargets = [...interactables, ...blockers];

function exhibitAt(ndc) {
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(rayTargets, false)[0];
  return hit?.object.userData.exhibit ? hit.object : null;
}

let promptFor = null;
function updateFocus() {
  focused = isPlaying() ? exhibitAt(screenCenter) : null;
  if (focused === promptFor) return;
  promptFor = focused;
  if (focused) {
    ui.prompt.replaceChildren();
    const title = focused.userData.exhibit.title || 'Exhibit coming soon';
    if (mode === 'touch') ui.prompt.append(`Tap to view: ${title}`);
    else {
      const kbd = document.createElement('kbd');
      kbd.textContent = 'E';
      ui.prompt.append(kbd, ` View: ${title}`);
    }
    ui.prompt.classList.remove('hidden');
  } else ui.prompt.classList.add('hidden');
}
ui.prompt.addEventListener('click', () => {
  if (mode === 'touch' && focused) openPanel(focused.userData.exhibit, focused.userData.room);
});

// ---------------------------------------------------------------- touch controls
const STICK_RADIUS = 50;
let stickPointer = null;

function resetJoystick() {
  stickPointer = null;
  joystick.x = joystick.y = 0;
  ui.knob.style.transform = '';
}

function moveStick(e) {
  const rect = ui.joystick.getBoundingClientRect();
  let dx = e.clientX - (rect.left + rect.width / 2);
  let dy = e.clientY - (rect.top + rect.height / 2);
  const dist = Math.hypot(dx, dy);
  if (dist > STICK_RADIUS) {
    dx *= STICK_RADIUS / dist;
    dy *= STICK_RADIUS / dist;
  }
  ui.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  const deadZone = dist < STICK_RADIUS * 0.15;
  joystick.x = deadZone ? 0 : dx / STICK_RADIUS;
  joystick.y = deadZone ? 0 : dy / STICK_RADIUS;
}

ui.joystick.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  stickPointer = e.pointerId;
  ui.joystick.setPointerCapture(e.pointerId);
  moveStick(e);
});
ui.joystick.addEventListener('pointermove', (e) => {
  if (e.pointerId === stickPointer) moveStick(e);
});
for (const type of ['pointerup', 'pointercancel']) {
  ui.joystick.addEventListener(type, (e) => {
    if (e.pointerId === stickPointer) resetJoystick();
  });
}

// drag anywhere on the 3D view to look around; a quick tap on an exhibit opens it
const canvas = renderer.domElement;
const drag = { id: null, x: 0, y: 0, startX: 0, startY: 0, time: 0 };

canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'touch' || !isPlaying() || drag.id !== null) return;
  Object.assign(drag, { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, time: performance.now() });
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== drag.id) return;
  camera.rotation.y -= (e.clientX - drag.x) * LOOK_SPEED;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - (e.clientY - drag.y) * LOOK_SPEED, -1.4, 1.4);
  drag.x = e.clientX;
  drag.y = e.clientY;
});
for (const type of ['pointerup', 'pointercancel']) {
  canvas.addEventListener(type, (e) => {
    if (e.pointerId !== drag.id) return;
    drag.id = null;
    const isTap = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 10 && performance.now() - drag.time < 350;
    if (type === 'pointerup' && isTap && isPlaying()) {
      const tapped = exhibitAt(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1));
      if (tapped) openPanel(tapped.userData.exhibit, tapped.userData.room);
    }
  });
}

let currentRoom = null;
function updateRoomLabel() {
  const room = roomAt(camera.position.x, camera.position.z);
  if (room && room !== currentRoom) {
    currentRoom = room;
    ui.roomLabel.textContent = room.name;
    ui.roomLabel.style.borderLeftColor = room.accent ?? '';
  }
}

// ---------------------------------------------------------------- minimap
// each room's outline in world space: four corners, or eight for the rotunda
function outline(room) {
  const f = roomFrame(room);
  if (room.shape === 'octagon') {
    const r = room.apothem / Math.cos(Math.PI / 8);
    return Array.from({ length: 8 }, (_, k) => {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      return toWorld(Math.sin(a) * r, -Math.cos(a) * r, f);
    });
  }
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => toWorld((sx * room.w) / 2, (sz * room.d) / 2, f));
}
const OUTLINES = new Map(ROOMS.map((r) => [r, outline(r)]));
const bounds = [...OUTLINES.values()].flat().reduce(
  (b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minZ: Math.min(b.minZ, p.z), maxZ: Math.max(b.maxZ, p.z) }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
);
const mapCtx = ui.minimap.getContext('2d');
const MAP_PAD = 12;
const mapScale = Math.min(
  (ui.minimap.width - MAP_PAD * 2) / (bounds.maxX - bounds.minX),
  (ui.minimap.height - MAP_PAD * 2) / (bounds.maxZ - bounds.minZ),
);
const mapOffX = (ui.minimap.width - (bounds.maxX - bounds.minX) * mapScale) / 2;
const mapOffY = (ui.minimap.height - (bounds.maxZ - bounds.minZ) * mapScale) / 2;
const toMap = (x, z) => [mapOffX + (x - bounds.minX) * mapScale, mapOffY + (z - bounds.minZ) * mapScale];

function drawMinimap() {
  const ctx = mapCtx;
  ctx.clearRect(0, 0, ui.minimap.width, ui.minimap.height);
  for (const r of ROOMS) {
    ctx.beginPath();
    OUTLINES.get(r).forEach((p, k) => {
      const [mx, my] = toMap(p.x, p.z);
      if (k) ctx.lineTo(mx, my);
      else ctx.moveTo(mx, my);
    });
    ctx.closePath();
    ctx.fillStyle = r === currentRoom ? 'rgba(217,164,65,0.45)' : 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const n = VISIT_ROOMS.indexOf(r);
    if (n < 0) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const [cx, cy] = toMap(r.x, r.z);
    ctx.fillText(String(n + 1), cx, cy);
  }
  // player arrow
  const [px, py] = toMap(camera.position.x, camera.position.z);
  camera.getWorldDirection(forward);
  const angle = Math.atan2(forward.z, forward.x);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.fillStyle = '#ff5a4f';
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, 5);
  ctx.lineTo(-5, -5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- main loop
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateMovement(dt);
  for (const s of spinners) s.rotation.y += dt * 0.5;
  for (const animate of animators) animate(clock.elapsedTime);
  updateFocus();
  updateRoomLabel();
  drawMinimap();
  if (quality === 'high' && composer) composer.render(dt);
  else renderer.render(scene, camera);
});

// handy for debugging in the browser console: museum.teleport('legacy')
window.museum = {
  scene,
  camera,
  controls,
  music,
  blocked, // blocked(x, z): would a visitor standing here hit something?
  rooms: ROOMS,
  teleport: (id) => teleportTo(ROOMS.find((r) => r.id === id) ?? ROOMS[0]),
};
