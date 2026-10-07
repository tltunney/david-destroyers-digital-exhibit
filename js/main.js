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
import { surfaceMaps, TILE_SIZE } from './textures.js';
import { MUSEUM, ROOMS } from './config.js';
import { AmbientMusic } from './music.js';

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

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ';

const controls = new PointerLockControls(camera, document.body);
const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

const colliders = [];     // { minX, maxX, minZ, maxZ } boxes the player can't walk through
const interactables = []; // meshes with userData.exhibit
const blockers = [];      // walls, so exhibits can't be clicked through them
const spinners = [];      // objects that slowly rotate

for (const room of ROOMS) {
  room.height ??= DEFAULT_HEIGHT;
  room.doors ??= {};
  for (const side of Object.keys(SIDES)) room.doors[side] ??= [];
  room.footprints = []; // things standing on the floor, for the baked floor shadows
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

function addCollider(x, z, w, d) {
  colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

function addBox(w, h, d, material, x, y, z, collide = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  if (collide) addCollider(x, z, w, d);
  return mesh;
}

// A door declared on one room gets a matching opening in the room behind that wall.
function linkDoors() {
  for (const a of ROOMS) {
    for (const side of Object.keys(SIDES)) {
      for (const door of [...a.doors[side]]) {
        if (door.to) continue;
        const opp = SIDES[side].opposite;
        const world = wallCenter(a, side) + door.at;
        for (const b of ROOMS) {
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
      const shape = () => {
        const cx = px(f.x);
        const cy = pz(f.z);
        const hw = (f.w / 2) * AO_PPM;
        const hd = (f.d / 2) * AO_PPM;
        if (f.round) ctx.ellipse(cx, cy, hw, hd, 0, 0, Math.PI * 2);
        else ctx.rect(cx - hw, cy - hd, hw * 2, hd * 2);
      };
      softShadow(ctx, shape, 0.45 * AO_PPM, 0.4); // wide and soft
      softShadow(ctx, shape, 0.08 * AO_PPM, 0.55); // tight contact shadow
    }
  }
  return new THREE.CanvasTexture(canvas);
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
function addWallLighting(group, w, h, washWidth = w + 1.8) {
  const scale = 1 / (1 - 2 * SHADOW_INSET);
  const shadow = decal(SHADOW_TEX, w * scale, h * scale, { opacity: 0.5, layer: 1 });
  shadow.position.set(0, -0.05, 0.004);
  const wash = decal(WASH_TEX, washWidth, h + 2.6, { additive: true, opacity: 0.42, layer: 2 });
  wash.position.set(0, 0.35, 0.008);
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
  scene.add(group);
  pivot.lookAt(target.x, targetY, target.z);
}

// One black track along each wall that has things hanging on it.
function buildTracks(room) {
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
function displayMaterial(map) {
  return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.85 });
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
  velvet: new THREE.MeshStandardMaterial({ color: 0x5c0f16, roughness: 0.85 }),
  leather: new THREE.MeshStandardMaterial({ ...surfaceMaps('leather', '#3a2a20', 4.8, 1.2), roughness: 1 }),
  planter: new THREE.MeshStandardMaterial({ ...surfaceMaps('concrete', '#8d8a84', 0.5, 0.5), roughness: 1 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x3d7a3f, roughness: 0.75 }),
  leafDark: new THREE.MeshStandardMaterial({ color: 0x2c5e33, roughness: 0.75 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xdfe8ee, roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.25 }),
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
  scene.add(floor);

  // ceiling: wood slats or plain plaster
  const ceilingMaps = room.ceiling === 'wood' ? surfaceMaps('slats', WOOD_COLOR, w, d / TILE_SIZE.slats[1]) : surfaceMaps('plaster', '#f7f4ee', w / 2, d / 2);
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ ...ceilingMaps, roughness: 1, aoMap: roomAO(room, { doors: false, objects: false, strength: 0.8 }) }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(x, height, z);
  scene.add(ceiling);

  // walls (with door openings), baseboards, door trim and signs
  for (const side of Object.keys(SIDES)) buildWall(room, side);
  buildCeilingLights(room);
  buildTracks(room);
  if (room.entrance) buildEntrance(room, room.entrance);

  for (const ex of room.exhibits ?? []) {
    if (ex.type === 'painting') buildPainting(room, ex);
    else if (ex.type === 'panel') buildPanel(room, ex);
    else if (ex.type === 'pedestal') buildPedestal(room, ex);
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
    scene.add(light);
  }
}

function buildWall(room, side) {
  const s = SIDES[side];
  const len = wallLength(room, side);
  const H = room.height;
  const wood = side === room.woodWall;
  const kind = wood ? 'slats' : 'plaster';
  const color = wood ? WOOD_COLOR : side === room.featureWall ? room.accent ?? '#888' : room.wallColor ?? '#f4f0e8';
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

    if (bottom === 0 && !wood) {
      // recessed shadow-gap baseboard, oak
      const bp = wallPoint(room, side, mid, HALF_WALL + 0.015);
      const [tw, td] = s.horizontal ? [length, 0.03] : [0.03, length];
      addBox(tw, 0.12, td, MAT.oak, bp.x, 0.07, bp.z);
    }
  }

  for (const door of room.doors[side]) {
    // light oak frame around the opening
    const along = (off) => wallPoint(room, side, door.at + off, HALF_WALL + 0.02);
    const post = s.horizontal ? [0.1, DOOR_HEIGHT, 0.04] : [0.04, DOOR_HEIGHT, 0.1];
    for (const off of [-door.width / 2 - 0.05, door.width / 2 + 0.05]) {
      const p = along(off);
      addBox(...post, MAT.oak, p.x, DOOR_HEIGHT / 2, p.z);
    }
    const tp = along(0);
    const top = s.horizontal ? [door.width + 0.2, 0.1, 0.04] : [0.04, 0.1, door.width + 0.2];
    addBox(...top, MAT.oak, tp.x, DOOR_HEIGHT + 0.05, tp.z);

    // sign above the door naming the room it leads to
    if (door.to) {
      const sp = wallPoint(room, side, door.at, HALF_WALL + 0.02);
      const signW = Math.max(door.width, 3.2);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(signW, signW * (160 / 1024)),
        new THREE.MeshBasicMaterial({ map: signTexture(door.to.name, door.to.accent ?? '#d9a441') }),
      );
      sign.position.set(sp.x, DOOR_HEIGHT + 0.5, sp.z);
      sign.rotation.y = s.rotY;
      scene.add(sign);
    }
  }
}

// Glass entrance doors with daylight outside and an EXIT sign above, centered on a wall.
function buildEntrance(room, side) {
  const group = new THREE.Group();
  const W = 3.4;
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
  const exitTex = canvasTexture(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#0b8a3e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2fff4';
    ctx.font = `bold 64px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', w / 2, h / 2 + 3);
  });
  const exit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.26, 0.06), [MAT.trim, MAT.trim, MAT.trim, MAT.trim, new THREE.MeshBasicMaterial({ map: exitTex, color: new THREE.Color(1.6, 1.6, 1.6) }), MAT.trim]);
  exit.position.set(0, H + 0.45, 0.04);
  group.add(exit);
  mountOnWall(room, { wall: side, at: 0 }, group, 0);

  // daylight spilling onto the floor
  const spill = decal(WASH_TEX, W + 1.5, 4, { additive: true, opacity: 0.35 });
  spill.rotation.x = -Math.PI / 2;
  const p = wallPoint(room, side, 0, HALF_WALL + 2);
  spill.position.set(p.x, 0.005, p.z);
  spill.rotation.z = SIDES[side].rotY + Math.PI;
  scene.add(spill);
}

function mountOnWall(room, ex, object, y) {
  const p = wallPoint(room, ex.wall, ex.at ?? 0, HALF_WALL);
  object.position.set(p.x, y, p.z);
  object.rotation.y = SIDES[ex.wall].rotY;
  scene.add(object);
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
  const y = ex.y ?? 2.2;
  const group = new THREE.Group();

  // beveled oak frame around a white mat, gallery style
  const frame = new THREE.Mesh(frameGeometry(w + 0.4, h + 0.4, w + 0.28, h + 0.28, 0.035), MAT.frame);
  frame.position.z = 0.012;
  frame.castShadow = true;
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.3, h + 0.3), MAT.passepartout);
  mat.position.z = 0.03;
  const artMat = displayMaterial(ex.title || ex.image ? artTexture(ex.title || 'untitled', room.accent ?? '#888') : emptySlotTexture());
  if (ex.image) loadImage(ex.image, artMat);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), artMat);
  art.position.z = 0.034;

  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), displayMaterial(labelTexture(ex.title ?? '', ex.subtitle)));
  label.position.set(w / 2 + 0.75, -h / 2 + 0.14, 0.012);
  if (w / 2 + 1.1 > 3) label.position.set(0, -h / 2 - 0.4, 0.012); // big paintings: label underneath

  group.add(frame, mat, art);
  if (ex.title) group.add(label);
  addWallLighting(group, w + 0.4, h + 0.4);
  mountOnWall(room, ex, group, y);
  makeInteractive([frame, mat, art, label], ex, room);
}

function buildPanel(room, ex) {
  const w = ex.width ?? 2.4;
  const h = ex.height ?? 1.6;
  const group = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.05),
    [MAT.trim, MAT.trim, MAT.trim, MAT.trim, displayMaterial(textPanelTexture(ex.title ?? '', ex.text, w, w / h, room.accent ?? '#d9a441')), MAT.trim],
  );
  panel.position.z = 0.035; // stands off the wall on hidden spacers
  group.add(panel);
  addWallLighting(group, w, h, w + 1);
  mountOnWall(room, ex, group, ex.y ?? 1.9);
  makeInteractive([panel], { ...ex, description: ex.description ?? ex.text }, room);
}

// A marble portrait bust built from simple shapes, about 1 unit tall, centered on y = 0.
// For a real likeness, export a scanned/sculpted .glb and use `model` instead.
function makeBust(color) {
  const marble = new THREE.MeshStandardMaterial({ ...surfaceMaps('marble', color ?? '#f1eee8'), roughness: 1 });
  const hairMat = marble.clone();
  hairMat.side = THREE.DoubleSide;
  const bust = new THREE.Group();
  const part = (geometry, [x, y, z], [sx, sy, sz] = [1, 1, 1], rotX = 0, material = marble) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.x = rotX;
    m.castShadow = true;
    m.receiveShadow = true;
    bust.add(m);
    return m;
  };
  const ball = new THREE.SphereGeometry(1, 48, 32);

  // round socle the bust stands on
  part(new THREE.CylinderGeometry(0.15, 0.2, 0.12, 48), [0, -0.44, 0]);
  // chest and shoulders: a lathe dome squashed front-to-back
  const profile = [[0, 0], [0.92, 0], [1, 0.1], [0.98, 0.38], [0.86, 0.66], [0.55, 0.9], [0.25, 0.99], [0, 1]].map(([r, y]) => new THREE.Vector2(r, y));
  part(new THREE.LatheGeometry(profile, 64), [0, -0.38, 0], [0.36, 0.44, 0.2]);
  // Victorian dress: coat lapels, a high stand-up collar, and a tied cravat
  for (const side of [-1, 1]) {
    const lapel = part(new THREE.BoxGeometry(0.05, 0.2, 0.015), [side * 0.055, -0.1, 0.165]);
    lapel.rotation.set(-0.45, 0, side * 0.4);
    part(ball, [side * 0.04, 0.045, 0.082], [0.03, 0.018, 0.018]); // cravat bow
  }
  part(new THREE.CylinderGeometry(0.09, 0.094, 0.08, 40, 1, true), [0, 0.07, 0], [1, 1, 1], 0, hairMat);
  part(ball, [0, 0.045, 0.088], [0.03, 0.026, 0.024]); // cravat knot
  part(ball, [0, -0.005, 0.112], [0.042, 0.05, 0.022]); // cravat drape
  // neck
  part(new THREE.CylinderGeometry(0.075, 0.085, 0.16, 32), [0, 0.09, 0]);
  // head and jaw
  part(ball, [0, 0.27, 0.005], [0.128, 0.165, 0.15]);
  part(ball, [0, 0.2, 0.02], [0.1, 0.075, 0.095]);
  part(ball, [0, 0.13, 0.085], [0.038, 0.03, 0.035]);
  // brow, eyes, nose, ears
  part(ball, [0, 0.305, 0.118], [0.095, 0.018, 0.035]);
  for (const side of [-1, 1]) {
    part(ball, [side * 0.048, 0.285, 0.128], [0.02, 0.014, 0.016]);
    part(ball, [side * 0.128, 0.26, -0.005], [0.018, 0.045, 0.03]);
    part(ball, [side * 0.12, 0.22, 0.035], [0.018, 0.05, 0.03]); // sideburns
  }
  part(ball, [0, 0.245, 0.145], [0.02, 0.045, 0.03], -0.25);
  // hair: a cap that hugs the skull, tipped back so the hairline sits high at the front,
  // with extra volume swept up and back on top
  part(new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.55), [0, 0.29, -0.01], [0.136, 0.17, 0.158], -0.45, hairMat);
  part(ball, [0, 0.4, 0.02], [0.11, 0.05, 0.11], -0.3);
  part(ball, [0, 0.385, -0.06], [0.125, 0.06, 0.11], 0.15);
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
  const baseW = 0.9 * scale;
  const baseH = 1.1;

  const base = addBox(baseW, baseH, baseW, MAT.pedestal, px, baseH / 2, pz, true);
  const cap = addBox(baseW + 0.1, 0.06, baseW + 0.1, MAT.oak, px, baseH + 0.03, pz);
  base.castShadow = base.receiveShadow = cap.castShadow = cap.receiveShadow = true;
  room.footprints.push({ x: px, z: pz, w: baseW, d: baseW });
  if (ex.rope) buildRopeBarrier(room, px, pz, baseW + 1.6);
  const holder = new THREE.Group();
  holder.position.set(px, baseH + 0.06 + 0.5 * scale, pz);
  scene.add(holder);

  // invisible box so the whole object area is easy to click
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(baseW, scale, baseW), new THREE.MeshBasicMaterial({ visible: false }));
  holder.add(hitbox);
  makeInteractive([base, cap, hitbox], ex, room);

  if (ex.model) {
    gltfLoader.load(
      ex.model,
      (gltf) => {
        const model = gltf.scene;
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
  // objects are modeled facing south (+z); FACING is for the camera, which starts out facing north
  holder.rotation.y = (FACING[ex.facing ?? 'south'] ?? 0) + Math.PI;

  if (ex.spotlight) {
    const spot = new THREE.SpotLight(0xfff3e2, 45, 14, 0.35, 0.6, 1);
    spot.position.set(px, room.height - 0.3, pz + 3);
    spot.target = holder;
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.02;
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 15;
    scene.add(spot);
  }
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
      scene.add(m);
    }
    room.footprints.push({ x: c.x, z: c.z, w: 0.34, d: 0.34, round: true });
  }
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= 0.22;
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).setY(a.y - 0.15), mid, b.clone().lerp(mid, 0.5).setY(b.y - 0.15), b]);
    const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.022, 10), MAT.velvet);
    rope.castShadow = true;
    scene.add(rope);
  }
  addCollider(cx, cz, size + 0.3, size + 0.3);
}

function buildDecor(room, item) {
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
  } else if (item.type === 'desk') {
    size = [3.2, 1];
    const desk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.05, 1), MAT.oak);
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
  scene.add(group);

  // axis-aligned collision box that covers the rotated footprint
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  const fw = size[0] * c + size[1] * s;
  const fd = size[0] * s + size[1] * c;
  addCollider(x, z, fw, fd);
  room.footprints.push({ x, z, w: fw, d: fd, round });
}

// ---------------------------------------------------------------- build everything
linkDoors();
ROOMS.forEach(buildRoom);
scene.add(new THREE.HemisphereLight(0xfff6ea, 0x4a3f35, 0.6));

// ---------------------------------------------------------------- player
const spawnRoom = ROOMS[0];
function placePlayer(x, z, facing) {
  camera.position.set(x, EYE_HEIGHT, z);
  camera.rotation.set(0, FACING[facing] ?? 0, 0);
}
placePlayer(MUSEUM.spawn?.x ?? spawnRoom.x, MUSEUM.spawn?.z ?? spawnRoom.z, MUSEUM.spawn?.facing ?? 'north');

function teleportTo(room) {
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

function blocked(x, z) {
  return colliders.some(
    (c) => x + PLAYER_RADIUS > c.minX && x - PLAYER_RADIUS < c.maxX && z + PLAYER_RADIUS > c.minZ && z - PLAYER_RADIUS < c.maxZ,
  );
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
  if (!f && !r) return;

  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  right.crossVectors(forward, UP);
  move.set(0, 0, 0).addScaledVector(forward, f).addScaledVector(right, r).normalize();
  move.multiplyScalar(speed * dt);

  // move one axis at a time so the player slides along walls
  const pos = camera.position;
  if (!blocked(pos.x + move.x, pos.z)) pos.x += move.x;
  if (!blocked(pos.x, pos.z + move.z)) pos.z += move.z;
}

function roomAt(x, z) {
  return ROOMS.find((r) => Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2);
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
  ui.musicBtn.textContent = music.enabled ? '\u266B Music: on' : '\u266B Music: off';
  ui.musicHud.classList.toggle('off', !music.enabled);
}
function toggleMusic() {
  music.toggle();
  updateMusicButtons();
}
updateMusicButtons();
ui.musicBtn.addEventListener('click', toggleMusic);
ui.musicHud.addEventListener('click', toggleMusic);
document.addEventListener('visibilitychange', () => music.setVisible(!document.hidden));

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
  if (n >= 1 && n <= ROOMS.length) teleportTo(ROOMS[n - 1]);
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
const bounds = ROOMS.reduce(
  (b, r) => ({
    minX: Math.min(b.minX, r.x - r.w / 2), maxX: Math.max(b.maxX, r.x + r.w / 2),
    minZ: Math.min(b.minZ, r.z - r.d / 2), maxZ: Math.max(b.maxZ, r.z + r.d / 2),
  }),
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
  ROOMS.forEach((r, i) => {
    const [mx, my] = toMap(r.x - r.w / 2, r.z - r.d / 2);
    ctx.fillStyle = r === currentRoom ? 'rgba(217,164,65,0.45)' : 'rgba(255,255,255,0.12)';
    ctx.fillRect(mx, my, r.w * mapScale, r.d * mapScale);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + 0.5, my + 0.5, r.w * mapScale - 1, r.d * mapScale - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const [cx, cy] = toMap(r.x, r.z);
    ctx.fillText(String(i + 1), cx, cy);
  });
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
  rooms: ROOMS,
  teleport: (id) => teleportTo(ROOMS.find((r) => r.id === id) ?? ROOMS[0]),
};
