// Rectangular rooms: floor, ceiling, walls with doorways, period panelling and cornices, lighting,
// the entrance doors, and the everyday fixtures of a real museum.
import * as THREE from 'three';
import {
  SIDES, HALF_WALL, DEFAULT_HEIGHT, DOOR_HEIGHT, ROOM_LIGHT, WAINSCOT_H, PICTURE_RAIL_DROP, ENTRANCE_W, DOOR_W,
  parent, toWorld, addBox, addCollider, mountOnWall, wallLength, wallPoint, blockers,
} from './world.js';
import { surfaceMaps, TILE_SIZE } from './textures.js';
import { MAT, decal, WASH_TEX } from './materials.js';
import { signTexture, exitTexture, fireAlarmTexture } from './art.js';
import { canvasTexture, seededRandom, piece, tube, lathe, rodBetween, FONT, SERIF } from './util.js';
import { roomAO, wallAO } from './ao.js';
import { buildExhibit } from './exhibits.js';
import { buildDecor, buildStanchionLine } from './furniture.js';

const WOOD_COLOR = '#d6b68d';

export function buildRoom(room) {
  const { x, z, w, d, height } = room;

  // floor: photographed wood planks tinted to the room's color
  const [ftx, fty] = TILE_SIZE.wood;
  const floorMat = new THREE.MeshStandardMaterial({ ...surfaceMaps('wood', room.floorColor ?? '#c9a882', w / ftx, d / fty), roughness: 1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0, z);
  floor.receiveShadow = true;
  parent.add(floor);

  // ceiling: wood slats or plain plaster
  const ceilingMaps = room.ceiling === 'wood' ? surfaceMaps('slats', WOOD_COLOR, w, d / TILE_SIZE.slats[1]) : surfaceMaps('plaster', '#f7f4ee', w / 2, d / 2);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ ...ceilingMaps, roughness: 1, aoMap: roomAO(room, { doors: false, objects: false, strength: 0.8 }) }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(x, height, z);
  parent.add(ceiling);

  for (const side of Object.keys(SIDES)) buildWall(room, side);
  buildLights(room);
  buildTracks(room);
  if (room.entrance) buildEntrance(room, room.entrance);
  if (!room.passage) buildFixtures(room);
  if (room.attach) buildWallTitle(room);
  for (const ex of room.exhibits ?? []) buildExhibit(room, ex);
  for (const item of room.decor ?? []) buildDecor(room, item);

  // now that everything is placed, bake the soft floor shadows
  floorMat.aoMap = roomAO(room);
  floorMat.needsUpdate = true;
}

// Period rooms: a brass chandelier (passages: just a warm light). Modern galleries: linear LED strips,
// a glowing cove around the edge, and one real light (real lights are expensive, so we keep them few).
function buildLights(room) {
  const { x, z, w, d, height } = room;
  if (room.victorian) {
    if (!room.passage) buildChandelier(room);
    const light = new THREE.PointLight(0xffd9a8, ROOM_LIGHT * 1.1 * (height / DEFAULT_HEIGHT), Math.max(w, d) * 1.2, 1);
    light.position.set(x, height - (room.passage ? 0.8 : 1.1), z);
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
    if (longAlongX) addBox(span, 0.04, 0.1, MAT.light, x, y, z + off);
    else addBox(0.1, 0.04, span, MAT.light, x + off, y, z);
  }
  const inset = HALF_WALL + 0.25;
  addBox(w - inset * 2, 0.05, 0.06, MAT.light, x, y, z - d / 2 + inset);
  addBox(w - inset * 2, 0.05, 0.06, MAT.light, x, y, z + d / 2 - inset);
  addBox(0.06, 0.05, d - inset * 2, MAT.light, x - w / 2 + inset, y, z);
  addBox(0.06, 0.05, d - inset * 2, MAT.light, x + w / 2 - inset, y, z);
  const light = new THREE.PointLight(0xffe6c8, ROOM_LIGHT * (height / DEFAULT_HEIGHT), Math.max(w, d), 1);
  light.position.set(x, height - 0.8, z);
  parent.add(light);
}

// One wall: solid pieces between doorways and lintels above them, skirting or wainscot, period
// cornice and picture rail, door frames lined through the wall, and a sign over each doorway.
export function buildWall(room, side) {
  const s = SIDES[side];
  const len = wallLength(room, side);
  const H = room.height;
  const kind = room.wallpaper ? 'damask' : 'plaster';
  const color = room.wallpaper ?? (side === room.featureWall ? room.accent ?? '#888' : room.wallColor ?? '#f4f0e8');
  const trim = room.victorian ? MAT.mahogany : MAT.oak;
  const ao = wallAO(room, side);
  // on the south and west walls the box face's texture runs backwards, so mirror the shadow map
  const mirrored = side === 'south' || side === 'west';

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
    const length = b - a;
    const h = H - bottom;
    const p = wallPoint(room, side, (a + b) / 2, HALF_WALL / 2);
    const [tx, ty] = TILE_SIZE[kind];
    const segAO = ao.clone();
    segAO.repeat.set(((mirrored ? -1 : 1) * length) / len, h / H);
    segAO.offset.set((mirrored ? b : a) / len + 0.5, bottom / H);
    const material = new THREE.MeshStandardMaterial({ ...surfaceMaps(kind, color, length / tx, h / ty), roughness: 1, aoMap: segAO });
    const wall = addBox(...(s.horizontal ? [length, h, HALF_WALL] : [HALF_WALL, h, length]), material, p.x, bottom + h / 2, p.z, bottom === 0);
    wall.receiveShadow = true;
    blockers.push(wall);
    if (bottom !== 0) continue;
    // skirting and panelling stop at the frames of doors set into the wall
    for (const [p0, q0] of aroundWallDoors(room, side, a, b)) {
      if (room.wainscot) addWainscot(room, side, (p0 + q0) / 2, q0 - p0);
      else {
        const bp = wallPoint(room, side, (p0 + q0) / 2, HALF_WALL + 0.015); // recessed shadow-gap baseboard, oak
        addBox(...(s.horizontal ? [q0 - p0, 0.12, 0.03] : [0.03, 0.12, q0 - p0]), MAT.oak, bp.x, 0.07, bp.z);
      }
    }
  }
  if (room.victorian) {
    // moulded plaster cornice with a gilt fillet, and a picture rail the frames hang from on cords
    const along = (inset) => wallPoint(room, side, 0, HALF_WALL + inset);
    const run = (thick, h, y, inset, material) => {
      const p = along(inset);
      addBox(...(s.horizontal ? [len, h, thick] : [thick, h, len]), material, p.x, y, p.z);
    };
    run(0.24, 0.36, H - 0.18, 0.12, MAT.plasterwork);
    run(0.03, 0.05, H - 0.4, 0.25, MAT.gilt);
    run(0.04, 0.05, H - PICTURE_RAIL_DROP, 0.02, MAT.mahogany);
  }

  for (const door of room.doors[side]) {
    const at = (off, inset) => wallPoint(room, side, door.at + off, inset);
    const box = (dims, p, y) => addBox(...(s.horizontal ? dims : [dims[2], dims[1], dims[0]]), trim, p.x, y, p.z);
    // frame around the opening on this side
    for (const off of [-door.width / 2 - 0.05, door.width / 2 + 0.05]) box([0.1, DOOR_HEIGHT, 0.04], at(off, HALF_WALL + 0.02), DOOR_HEIGHT / 2);
    box([door.width + 0.2, 0.1, 0.04], at(0, HALF_WALL + 0.02), DOOR_HEIGHT + 0.05);
    // line the opening through this room's half of the wall (the room next door lines its half)
    const depth = HALF_WALL + 0.03;
    for (const sgn of [-1, 1]) box([0.04, DOOR_HEIGHT, depth], at(sgn * (door.width / 2 - 0.02), depth / 2), DOOR_HEIGHT / 2);
    box([door.width, 0.04, depth], at(0, depth / 2), DOOR_HEIGHT - 0.02);
    // sign above the door naming the room it leads to
    if (door.to && !room.passage) {
      const sp = at(0, HALF_WALL + 0.02);
      const signW = Math.max(door.width, 3.2);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signW * (160 / 1024)), new THREE.MeshBasicMaterial({ map: signTexture(door.label ?? door.to.name, door.to.accent ?? '#d9a441') }));
      sign.position.set(sp.x, DOOR_HEIGHT + 0.5, sp.z);
      sign.rotation.y = s.rotY;
      parent.add(sign);
    }
  }
}

// The stretch [a, b] of a wall minus the doors set into it from the floor up (the glass entrance
// doors, panelled doors), so skirting and panelling stop at their frames.
function aroundWallDoors(room, side, a, b) {
  const gaps = [];
  if (room.entrance === side) gaps.push([-ENTRANCE_W / 2 - 0.1, ENTRANCE_W / 2 + 0.1]);
  for (const ex of room.exhibits ?? []) {
    if (ex.type === 'door' && ex.wall === side) gaps.push([(ex.at ?? 0) - DOOR_W / 2 - 0.12, (ex.at ?? 0) + DOOR_W / 2 + 0.12]);
  }
  let pieces = [[a, b]];
  for (const [g0, g1] of gaps) {
    pieces = pieces.flatMap(([p, q]) => [...(p < g0 ? [[p, Math.min(q, g0)]] : []), ...(q > g1 ? [[Math.max(p, g1), q]] : [])]);
  }
  return pieces;
}

// Victorian wall finish below the wallpaper: raised mahogany panels, a chair rail, and a tall skirting.
function addWainscot(room, side, mid, length) {
  const s = SIDES[side];
  const box = (thick, h, y, inset, material) => {
    const p = wallPoint(room, side, mid, HALF_WALL + inset);
    return addBox(...(s.horizontal ? [length, h, thick] : [thick, h, length]), material, p.x, y, p.z);
  };
  const [tx, ty] = TILE_SIZE.wainscot;
  box(0.04, WAINSCOT_H, WAINSCOT_H / 2, 0.02, new THREE.MeshStandardMaterial({ ...surfaceMaps('wainscot', '#5a2a1a', length / tx, WAINSCOT_H / ty), roughness: 1 }));
  box(0.08, 0.07, WAINSCOT_H + 0.03, 0.04, MAT.mahogany); // chair rail
  box(0.06, 0.2, 0.1, 0.03, MAT.mahogany); // skirting
}

function exitSign() {
  return new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.26, 0.06), [MAT.trim, MAT.trim, MAT.trim, MAT.trim, new THREE.MeshBasicMaterial({ map: exitTexture(), color: new THREE.Color(1.6, 1.6, 1.6) }), MAT.trim]);
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
  piece(group, new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: outside, color: new THREE.Color(1.5, 1.5, 1.5) }), 0, H / 2, 0.01);
  piece(group, new THREE.PlaneGeometry(W, H), MAT.glass, 0, H / 2, 0.04);
  const bar = (bw, bh, bx, by) => piece(group, new THREE.BoxGeometry(bw, bh, 0.08), MAT.metal, bx, by, 0.04);
  bar(W + 0.2, 0.12, 0, H + 0.06);
  bar(0.1, H, -W / 2 - 0.05, H / 2);
  bar(0.1, H, W / 2 + 0.05, H / 2);
  bar(0.08, H, 0, H / 2);
  for (const hx of [-0.18, 0.18]) piece(group, new THREE.CylinderGeometry(0.018, 0.018, 1.1, 12), MAT.brass, hx, 1.1, 0.12);
  const exit = exitSign();
  exit.position.set(0, H + 0.45, 0.04);
  group.add(exit);
  mountOnWall(room, { wall: side, at: 0 }, group, 0);
  // daylight spilling onto the floor
  const spill = decal(WASH_TEX, W + 1.5, 4, { additive: true, opacity: 0.35 });
  spill.rotation.x = -Math.PI / 2;
  spill.rotation.z = SIDES[side].rotY + Math.PI;
  const p = wallPoint(room, side, 0, HALF_WALL + 2);
  spill.position.set(p.x, 0.005, p.z);
  parent.add(spill);
}

// One black track along each gallery wall that has things hanging on it, with a spotlight per exhibit.
const SPOT = {
  can: new THREE.CylinderGeometry(0.065, 0.055, 0.22, 20).rotateX(Math.PI / 2),
  lens: new THREE.CircleGeometry(0.048, 20),
  stem: new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8),
};
function buildTracks(room) {
  if (room.victorian) return;
  for (const side of Object.keys(SIDES)) {
    const items = (room.exhibits ?? []).filter((ex) => ex.wall === side && (ex.type === 'painting' || ex.type === 'panel'));
    if (!items.length) continue;
    const len = wallLength(room, side);
    const p = wallPoint(room, side, 0, 1.3);
    addBox(...(SIDES[side].horizontal ? [len - 1.2, 0.04, 0.05] : [0.05, 0.04, len - 1.2]), MAT.metal, p.x, room.height - 0.06, p.z);
    for (const ex of items) {
      const h = ex.height ?? (ex.type === 'panel' ? 1.6 : 1.7);
      const sp = wallPoint(room, side, ex.at ?? 0, 1.3);
      const group = new THREE.Group();
      group.position.set(sp.x, room.height - 0.28, sp.z);
      piece(group, SPOT.stem, MAT.metal, 0, 0.12, 0);
      const pivot = new THREE.Group();
      piece(pivot, SPOT.can, MAT.metal);
      piece(pivot, SPOT.lens, MAT.light, 0, 0, 0.111);
      group.add(pivot);
      parent.add(group);
      const target = wallPoint(room, side, ex.at ?? 0, HALF_WALL);
      const t = toWorld(target.x, target.z);
      pivot.lookAt(t.x, (ex.y ?? (ex.type === 'panel' ? 1.9 : 2.2)) + h * 0.15, t.z);
    }
  }
}

// Brass gasolier: a plaster ceiling rose, a drop rod, a turned brass column and eight curving arms,
// each ending in a frosted globe with a cut-glass drop hanging beneath it.
const CRYSTAL = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, ior: 1.6, transparent: true, opacity: 0.55, envMapIntensity: 2 });
CRYSTAL.userData.mergeable = true; // small beads: fine to draw together even though see-through
function buildChandelier(room) {
  const g = new THREE.Group();
  g.position.set(room.x, room.height, room.z);
  piece(g, new THREE.CylinderGeometry(0.8, 0.8, 0.035, 48), MAT.plasterwork, 0, -0.018, 0);
  for (const [r, t] of [[0.74, 0.03], [0.52, 0.035], [0.3, 0.03]]) piece(g, new THREE.TorusGeometry(r, t, 10, 48).rotateX(Math.PI / 2), MAT.plasterwork, 0, -0.04, 0);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    piece(g, new THREE.SphereGeometry(0.06, 10, 6), MAT.plasterwork, Math.cos(a) * 0.63, -0.04, Math.sin(a) * 0.63).scale.set(1, 0.5, 1.6);
  }
  piece(g, new THREE.CylinderGeometry(0.09, 0.05, 0.08, 20), MAT.gilt, 0, -0.08, 0); // canopy
  const hang = 1.25; // how far below the ceiling the arms are
  piece(g, new THREE.CylinderGeometry(0.016, 0.016, hang - 0.1, 8), MAT.gilt, 0, -0.1 - (hang - 0.1) / 2, 0);
  piece(g, lathe([[0, 0.32], [0.05, 0.3], [0.06, 0.22], [0.035, 0.16], [0.09, 0.05], [0.11, -0.02], [0.07, -0.08], [0.1, -0.14], [0.05, -0.24], [0.025, -0.34], [0.05, -0.4], [0, -0.46]]), MAT.gilt, 0, -hang, 0);
  piece(g, new THREE.TorusGeometry(0.5, 0.012, 8, 64).rotateX(Math.PI / 2), MAT.gilt, 0, -hang - 0.12, 0);
  const arms = 8;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2;
    const at = (r, y) => new THREE.Vector3(Math.cos(a) * r, -hang + y, Math.sin(a) * r);
    tube(g, [at(0.07, 0), at(0.25, -0.16), at(0.47, -0.14), at(0.6, -0.02), at(0.62, 0.06)], 0.014, MAT.gilt, 20);
    const tip = at(0.62, 0.06);
    piece(g, new THREE.CylinderGeometry(0.055, 0.03, 0.06, 16), MAT.gilt, tip.x, tip.y + 0.02, tip.z);
    piece(g, new THREE.SphereGeometry(0.075, 20, 14), MAT.gaslight, tip.x, tip.y + 0.12, tip.z);
    piece(g, new THREE.CylinderGeometry(0.022, 0.028, 0.08, 12, 1, true), CRYSTAL, tip.x, tip.y + 0.22, tip.z);
    rodBetween(g, new THREE.Vector3(tip.x, tip.y - 0.01, tip.z), new THREE.Vector3(tip.x, tip.y - 0.12, tip.z), 0.0025, MAT.gilt);
    piece(g, new THREE.OctahedronGeometry(0.03), CRYSTAL, tip.x, tip.y - 0.15, tip.z).scale.set(0.8, 1.6, 0.8);
    for (let k = 1; k < 6; k++) {
      // swag of crystal beads to the next arm
      const b = ((i + k / 6) / arms) * Math.PI * 2;
      piece(g, new THREE.IcosahedronGeometry(0.012, 0), CRYSTAL, Math.cos(b) * 0.55, -hang - 0.02 - Math.sin((k / 6) * Math.PI) * 0.09, Math.sin(b) * 0.55);
    }
  }
  piece(g, new THREE.SphereGeometry(0.04, 16, 10), MAT.gilt, 0, -hang - 0.5, 0);
  piece(g, new THREE.ConeGeometry(0.025, 0.08, 12).rotateX(Math.PI), MAT.gilt, 0, -hang - 0.57, 0);
  parent.add(g);
}

// Gallery name in big cut vinyl letters on the colored feature wall, the way museums title a room.
function buildWallTitle(room) {
  const side = room.featureWall ?? 'north';
  const [number, name] = room.name.includes(': ') ? room.name.split(': ') : ['', room.name];
  const c = new THREE.Color(room.accent ?? '#888');
  const ink = c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.6 ? '#1d1a17' : '#ffffff';
  const tex = canvasTexture(2048, 400, (ctx, w) => {
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.font = `bold 72px ${FONT}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '18px';
    ctx.fillText(number.toUpperCase(), w / 2, 92);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.font = `bold 210px ${SERIF}`;
    ctx.fillText(name, w / 2, 330, w - 40);
  });
  const width = Math.min(7, wallLength(room, side) - 2);
  const holder = new THREE.Group();
  // matte vinyl, a little self-lit so it stays crisp against the colored wall
  piece(holder, new THREE.PlaneGeometry(width, width * (400 / 2048)), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0x777777, transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 0, 0, 0.006);
  mountOnWall(room, { wall: side, at: 0 }, holder, room.height - 0.78);
}

// Things every real museum has that nobody notices until they're missing.
const FIXTURE = {
  white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb3201e, roughness: 0.35 }),
  dome: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.85 }),
  screen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.9, 0.55) }),
  lens: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.8 }),
};
function buildFixtures(room) {
  const { x, z, w, d, height } = room;
  // ceiling: smoke detectors and a security camera dome in one corner
  for (const t of [-0.25, 0.25]) {
    const sx = x + (w >= d ? w * t : 0);
    const sz = z + (w >= d ? 0 : d * t);
    piece(parent, new THREE.CylinderGeometry(0.075, 0.08, 0.04, 20), FIXTURE.white, sx + 0.6, height - 0.02, sz + 0.6);
  }
  const cam = new THREE.Group();
  cam.position.set(x + w / 2 - 0.8, height, z - d / 2 + 0.8);
  piece(cam, new THREE.CylinderGeometry(0.12, 0.12, 0.04, 24), FIXTURE.white, 0, -0.02, 0);
  piece(cam, new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), FIXTURE.dome, 0, -0.04, 0);
  parent.add(cam);
  if (room.victorian) return; // period rooms keep their walls clear

  const door = room.doors.south[0];
  const wallItem = (side, at, y, build) => {
    const g = new THREE.Group();
    build(g);
    mountOnWall(room, { wall: side, at }, g, y);
  };
  if (door) {
    const exit = exitSign();
    mountOnWall(room, { wall: 'south', at: door.at }, exit, Math.min(height - 0.35, DOOR_HEIGHT + 1.05));
    // light switch and a power outlet beside the doorway
    wallItem('south', door.at - door.width / 2 - 0.45, 1.2, (g) => {
      piece(g, new THREE.BoxGeometry(0.08, 0.12, 0.012), FIXTURE.white, 0, 0, 0.006);
      piece(g, new THREE.BoxGeometry(0.018, 0.035, 0.014), FIXTURE.white, 0, 0.004, 0.016).rotation.x = 0.25;
    });
    wallItem('south', door.at + door.width / 2 + 0.6, 0.3, (g) => {
      piece(g, new THREE.BoxGeometry(0.08, 0.12, 0.012), FIXTURE.white, 0, 0, 0.006);
      for (const oy of [-0.025, 0.025]) piece(g, new THREE.BoxGeometry(0.03, 0.028, 0.004), MAT.trim, 0, oy, 0.013);
    });
  }
  // fire extinguisher in a recessed white cabinet, with the fire alarm pull station and horn-strobe beside it
  wallItem('east', d / 2 - 1.1, 1.15, (g) => {
    piece(g, new THREE.BoxGeometry(0.42, 0.75, 0.14), FIXTURE.white, 0, 0, 0.07);
    piece(g, new THREE.BoxGeometry(0.36, 0.69, 0.02), MAT.trim, 0, 0, 0.13);
    piece(g, new THREE.CylinderGeometry(0.075, 0.075, 0.42, 16), FIXTURE.red, 0, -0.08, 0.15);
    piece(g, new THREE.CylinderGeometry(0.03, 0.04, 0.08, 10), MAT.trim, 0, 0.17, 0.15);
    piece(g, new THREE.PlaneGeometry(0.36, 0.69), MAT.caseGlass, 0, 0, 0.145).renderOrder = 1;
  });
  wallItem('east', d / 2 - 1.8, 1.2, (g) => {
    piece(g, new THREE.BoxGeometry(0.13, 0.17, 0.05), FIXTURE.red, 0, 0, 0.025);
    piece(g, new THREE.PlaneGeometry(0.12, 0.15), new THREE.MeshStandardMaterial({ map: fireAlarmTexture('pull'), roughness: 0.4 }), 0, 0, 0.0505);
    piece(g, new THREE.BoxGeometry(0.07, 0.025, 0.02), FIXTURE.white, 0, 0.005, 0.06);
  });
  wallItem('east', d / 2 - 1.8, 2.3, (g) => {
    piece(g, new THREE.BoxGeometry(0.13, 0.17, 0.05), FIXTURE.white, 0, 0, 0.025);
    piece(g, new THREE.PlaneGeometry(0.12, 0.15), new THREE.MeshStandardMaterial({ map: fireAlarmTexture('strobe'), roughness: 0.4 }), 0, 0, 0.0505);
    piece(g, new THREE.BoxGeometry(0.07, 0.04, 0.03), FIXTURE.lens, 0, 0.035, 0.065);
  });
  // climate monitor (temperature and humidity) on the west wall
  wallItem('west', d / 2 - 1.2, 1.55, (g) => {
    piece(g, new THREE.BoxGeometry(0.16, 0.11, 0.035), FIXTURE.white, 0, 0, 0.018);
    piece(g, new THREE.PlaneGeometry(0.11, 0.05), FIXTURE.screen, 0, 0.012, 0.037);
  });
  // linear floor grilles for the air conditioning, along both long walls
  const grilleTex = canvasTexture(256, 32, (ctx, cw, ch) => {
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#0b0b0b';
    for (let gx = 6; gx < cw - 4; gx += 8) ctx.fillRect(gx, 5, 4, ch - 10);
  });
  const grilleMat = new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.4, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const sgn of [-1, 1]) {
    const grille = piece(parent, new THREE.PlaneGeometry(1.6, 0.2), grilleMat, x + sgn * (w / 2 - HALF_WALL - 0.35), 0.003, z - d / 4);
    grille.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
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
