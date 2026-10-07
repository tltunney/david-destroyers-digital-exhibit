import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MUSEUM, ROOMS } from './config.js';

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
const ROOM_LIGHT = 12;

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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e12);

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

function floorTexture(style, color) {
  const tex = canvasTexture(512, 512, (ctx, w, h) => {
    const rand = seededRandom(style + color);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    if (style === 'wood') {
      const plank = h / 8;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = shade(color, (rand() - 0.5) * 0.08);
        ctx.fillRect(0, i * plank, w, plank);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0, i * plank, w, 2);
        ctx.fillRect(rand() * w, i * plank, 2, plank);
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        for (let g = 0; g < 6; g++) {
          const y = i * plank + rand() * plank;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(w / 3, y + 4, (2 * w) / 3, y - 4, w, y);
          ctx.stroke();
        }
      }
    } else if (style === 'tile') {
      const n = 4;
      const s = w / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = (i + j) % 2 ? shade(color, -0.12) : shade(color, 0.04);
          ctx.fillRect(i * s, j * s, s, s);
        }
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(w, i * s); ctx.stroke();
      }
    } else if (style === 'marble') {
      ctx.lineWidth = 1.5;
      for (let v = 0; v < 14; v++) {
        ctx.strokeStyle = `rgba(90,90,100,${0.08 + rand() * 0.15})`;
        ctx.beginPath();
        let x = rand() * w, y = 0;
        ctx.moveTo(x, y);
        while (y < h) {
          x += (rand() - 0.5) * 60;
          y += 20 + rand() * 40;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.strokeRect(0, 0, w, h);
    } else {
      // carpet: fine noise
      const img = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rand() - 0.5) * 24;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

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

function textPanelTexture(title, text, aspect, accent) {
  const W = 1024;
  const H = Math.round(W / aspect);
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#16161b';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.fillRect(48, 48, 10, H - 96);
    ctx.fillStyle = '#f4efe6';
    ctx.font = 'bold 72px Georgia, serif';
    ctx.fillText(title, 90, 120);
    ctx.font = '40px Georgia, serif';
    ctx.fillStyle = '#d6cfc2';
    wrapText(ctx, text ?? '', W - 160).forEach((line, i) => ctx.fillText(line, 90, 200 + i * 56));
  });
}

function labelTexture(title, subtitle) {
  return canvasTexture(512, 160, (ctx, w, h) => {
    ctx.fillStyle = '#f3efe7';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b1b1b';
    ctx.font = 'bold 44px Georgia, serif';
    ctx.fillText(title, 24, 64, w - 48);
    ctx.font = 'italic 30px Georgia, serif';
    ctx.fillStyle = '#555';
    ctx.fillText(subtitle ?? 'Click to learn more', 24, 116, w - 48);
  });
}

function signTexture(text, accent) {
  return canvasTexture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#121216';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, h - 10, w, 10);
    ctx.fillStyle = '#f4efe6';
    ctx.font = 'bold 64px Georgia, serif';
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
  frame: new THREE.MeshStandardMaterial({ color: 0x6b4a1f, roughness: 0.4, metalness: 0.5 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.7 }),
  pedestal: new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5 }),
  bench: new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.6 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3, metalness: 0.8 }),
  pot: new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.8 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9 }),
  light: new THREE.MeshBasicMaterial({ color: 0xfff6e0 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, emissive: 0x3a3732, roughness: 1 }),
};

// ---------------------------------------------------------------- room builders
function buildRoom(room) {
  const { x, z, w, d, height } = room;
  const wallMat = new THREE.MeshStandardMaterial({ color: room.wallColor ?? '#ddd', roughness: 0.9 });

  // floor
  const tex = floorTexture(room.floor ?? 'wood', room.floorColor ?? '#888');
  tex.repeat.set(w / 4, d / 4);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ map: tex, roughness: room.floor === 'marble' ? 0.25 : 0.75 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0, z);
  scene.add(floor);

  // ceiling
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(x, height, z);
  scene.add(ceiling);

  // walls (with door openings), baseboards, door trim and signs
  for (const side of Object.keys(SIDES)) buildWall(room, side, wallMat);

  // ceiling: a grid of glowing panels, but only one real light per room (lights are expensive)
  const cols = Math.max(1, Math.round(w / 9));
  const rows = Math.max(1, Math.round(d / 9));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const lx = x - w / 2 + (w / cols) * (i + 0.5);
      const lz = z - d / 2 + (d / rows) * (j + 0.5);
      addBox(1.6, 0.06, 1.6, MAT.light, lx, height - 0.04, lz);
    }
  }
  const light = new THREE.PointLight(0xfff1d6, ROOM_LIGHT, Math.max(w, d) * 0.9, 1);
  light.position.set(x, height - 0.6, z);
  scene.add(light);

  for (const ex of room.exhibits ?? []) {
    if (ex.type === 'painting') buildPainting(room, ex);
    else if (ex.type === 'panel') buildPanel(room, ex);
    else if (ex.type === 'pedestal') buildPedestal(room, ex);
    else console.warn(`Unknown exhibit type "${ex.type}" in room "${room.id}"`);
  }
  for (const item of room.decor ?? []) buildDecor(room, item);
}

function buildWall(room, side, wallMat) {
  const s = SIDES[side];
  const len = wallLength(room, side);
  const H = room.height;
  const openings = room.doors[side]
    .map((door) => [door.at - door.width / 2, door.at + door.width / 2])
    .sort((p, q) => p[0] - q[0]);

  // split the wall into solid pieces + lintels above each door
  const segments = [];
  let cursor = -len / 2;
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
    const wall = addBox(bw, h, bd, wallMat, p.x, bottom + h / 2, p.z, bottom === 0);
    blockers.push(wall);

    if (bottom === 0) {
      const bp = wallPoint(room, side, mid, HALF_WALL + 0.02);
      const [tw, td] = s.horizontal ? [length, 0.04] : [0.04, length];
      addBox(tw, 0.16, td, MAT.trim, bp.x, 0.08, bp.z);
    }
  }

  for (const door of room.doors[side]) {
    // dark frame around the opening
    const along = (off) => wallPoint(room, side, door.at + off, HALF_WALL + 0.03);
    const post = s.horizontal ? [0.14, DOOR_HEIGHT, 0.06] : [0.06, DOOR_HEIGHT, 0.14];
    for (const off of [-door.width / 2, door.width / 2]) {
      const p = along(off);
      addBox(...post, MAT.trim, p.x, DOOR_HEIGHT / 2, p.z);
    }
    const tp = along(0);
    const top = s.horizontal ? [door.width + 0.14, 0.14, 0.06] : [0.06, 0.14, door.width + 0.14];
    addBox(...top, MAT.trim, tp.x, DOOR_HEIGHT, tp.z);

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

  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.24, h + 0.24, 0.08), MAT.frame);
  frame.position.z = 0.04;
  const artMat = displayMaterial(artTexture(ex.title ?? 'untitled', room.accent ?? '#888'));
  if (ex.image) loadImage(ex.image, artMat);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), artMat);
  art.position.z = 0.085;

  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), displayMaterial(labelTexture(ex.title ?? '', ex.subtitle)));
  label.position.set(w / 2 + 0.6, -h / 2 + 0.14, 0.02);
  if (w / 2 + 1.1 > 3) label.position.set(0, -h / 2 - 0.35, 0.02); // big paintings: label underneath

  // small picture light above the frame
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, Math.min(w, 1.2), 12), MAT.metal);
  lamp.rotation.z = Math.PI / 2;
  lamp.position.set(0, h / 2 + 0.25, 0.25);

  group.add(frame, art, label, lamp);
  mountOnWall(room, ex, group, y);
  makeInteractive([frame, art, label], ex, room);
}

function buildPanel(room, ex) {
  const w = ex.width ?? 2.4;
  const h = ex.height ?? 1.6;
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.06),
    [MAT.trim, MAT.trim, MAT.trim, MAT.trim, displayMaterial(textPanelTexture(ex.title ?? '', ex.text, w / h, room.accent ?? '#d9a441')), MAT.trim],
  );
  panel.geometry.translate(0, 0, 0.03);
  mountOnWall(room, ex, panel, ex.y ?? 1.9);
  makeInteractive([panel], { ...ex, description: ex.description ?? ex.text }, room);
}

function makeShape(shape, color) {
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
  const cap = addBox(baseW + 0.1, 0.06, baseW + 0.1, MAT.pedestal, px, baseH + 0.03, pz);
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
  } else {
    const shape = makeShape(ex.shape, ex.color);
    shape.scale.setScalar(scale);
    holder.add(shape);
  }
  if (ex.spin !== false) spinners.push(holder);
}

function buildDecor(room, item) {
  const x = room.x + (item.x ?? 0);
  const z = room.z + (item.z ?? 0);
  const rot = THREE.MathUtils.degToRad(item.rotation ?? 0);
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rot;
  let size = [1, 1];

  if (item.type === 'bench') {
    size = [2.4, 0.6];
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.6), MAT.bench);
    seat.position.y = 0.45;
    group.add(seat);
    for (const lx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.5), MAT.metal);
      leg.position.set(lx, 0.2, 0);
      group.add(leg);
    }
  } else if (item.type === 'plant') {
    size = [0.8, 0.8];
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.6, 20), MAT.pot);
    pot.position.y = 0.3;
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), MAT.leaf);
    leaves.position.y = 1.05;
    leaves.scale.set(1, 1.3, 1);
    group.add(pot, leaves);
  } else if (item.type === 'desk') {
    size = [3.2, 1];
    const desk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.05, 1), MAT.bench);
    desk.position.y = 0.525;
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 1.15), MAT.pedestal);
    top.position.y = 1.08;
    group.add(desk, top);
  } else {
    console.warn(`Unknown decor type "${item.type}"`);
    return;
  }
  scene.add(group);

  // axis-aligned collision box that covers the rotated footprint
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  addCollider(x, z, size[0] * c + size[1] * s, size[0] * s + size[1] * c);
}

// ---------------------------------------------------------------- build everything
linkDoors();
ROOMS.forEach(buildRoom);
scene.add(new THREE.HemisphereLight(0xfff8ee, 0x3a3530, 0.9));

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

function updateMovement(dt) {
  if (!controls.isLocked) return;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  if (!f && !r) return;

  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  right.crossVectors(forward, UP);
  move.set(0, 0, 0).addScaledVector(forward, f).addScaledVector(right, r).normalize();
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
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
};
document.title = MUSEUM.title;
$('museum-title').textContent = MUSEUM.title;
$('museum-subtitle').textContent = MUSEUM.subtitle ?? '';
$('credits').textContent = MUSEUM.credits ?? '';

let panelOpen = false;
let focused = null;

ui.enter.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => ui.overlay.classList.add('hidden'));
controls.addEventListener('unlock', () => {
  keys.clear();
  if (!panelOpen) {
    ui.enter.textContent = 'Resume';
    ui.overlay.classList.remove('hidden');
  }
});
document.addEventListener('pointerlockerror', () => {
  if (!panelOpen) ui.overlay.classList.remove('hidden');
});

function openPanel(exhibit, room) {
  panelOpen = true;
  $('info-room').textContent = room.name;
  $('info-title').textContent = exhibit.title ?? '';
  $('info-subtitle').textContent = exhibit.subtitle ?? '';
  const img = $('info-image');
  if (exhibit.image) img.src = exhibit.image;
  else img.removeAttribute('src');
  img.alt = exhibit.title ?? '';
  const body = $('info-body');
  body.replaceChildren();
  const paragraphs = Array.isArray(exhibit.description) ? exhibit.description : [exhibit.description ?? ''];
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
  controls.unlock();
}

function closePanel() {
  panelOpen = false;
  ui.panel.classList.add('hidden');
  controls.lock();
}
$('info-close').addEventListener('click', closePanel);

document.addEventListener('keydown', (e) => {
  if (panelOpen) {
    if (e.code === 'KeyE' || e.code === 'Escape') closePanel();
    return;
  }
  keys.add(e.code);
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

function updateFocus() {
  focused = null;
  if (controls.isLocked) {
    raycaster.setFromCamera(screenCenter, camera);
    const hit = raycaster.intersectObjects(rayTargets, false)[0];
    if (hit?.object.userData.exhibit) focused = hit.object;
  }
  if (focused) {
    ui.prompt.innerHTML = '';
    const kbd = document.createElement('kbd');
    kbd.textContent = 'E';
    ui.prompt.append(kbd, ` View: ${focused.userData.exhibit.title ?? 'Exhibit'}`);
    ui.prompt.classList.remove('hidden');
  } else ui.prompt.classList.add('hidden');
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
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateMovement(dt);
  for (const s of spinners) s.rotation.y += dt * 0.5;
  updateFocus();
  updateRoomLabel();
  drawMinimap();
  renderer.render(scene, camera);
});

// handy for debugging in the browser console: museum.teleport('legacy')
window.museum = {
  scene,
  camera,
  controls,
  rooms: ROOMS,
  teleport: (id) => teleportTo(ROOMS.find((r) => r.id === id) ?? ROOMS[0]),
};
