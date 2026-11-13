// The museum's layout: where each room sits, its doors, and the helpers every builder uses to place
// things on walls and floors. Also the shared lists the rest of the app reads (what you can bump into,
// what you can click, what moves every frame).
import * as THREE from 'three';
import { ROOMS } from './config.js';
import { scene } from './engine.js';

const WALL_THICKNESS = 0.4;
export const HALF_WALL = WALL_THICKNESS / 2; // each room owns half of a shared wall
export const DEFAULT_HEIGHT = 5;
export const DOOR_HEIGHT = 3.4;
export const ROOM_LIGHT = 10;
export const WAINSCOT_H = 1.1; // height of the mahogany panelling in period rooms
export const PICTURE_RAIL_DROP = 0.62; // how far below the ceiling the picture rail runs
export const ENTRANCE_W = 3.4; // the glass front doors
export const DOOR_W = 1.1; // panelled doors that don't open
export const DOOR_H = 2.4;

// In rooms with wainscot, lift anything on the wall so its bottom clears the chair rail.
export const clearOfWainscot = (room, y, h) => (room.wainscot ? Math.max(y, WAINSCOT_H + 0.25 + h / 2) : y);

export const SIDES = {
  north: { horizontal: true, sign: -1, opposite: 'south', rotY: 0 },
  south: { horizontal: true, sign: 1, opposite: 'north', rotY: Math.PI },
  west: { horizontal: false, sign: -1, opposite: 'east', rotY: Math.PI / 2 },
  east: { horizontal: false, sign: 1, opposite: 'west', rotY: -Math.PI / 2 },
};
export const FACING = { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 };

// Compass bearings for the rotunda: 0 = north, 90 = east, 180 = south, -90 = west.
export const compass = (deg) => {
  const a = THREE.MathUtils.degToRad(deg);
  return { x: Math.sin(a), z: -Math.cos(a) };
};

export const colliders = []; // turned boxes the visitor can't walk through (world space)
export const interactables = []; // meshes with userData.exhibit
export const blockers = []; // walls, so exhibits can't be clicked through them
export const animators = []; // functions called every frame with the time in seconds

// ---------------------------------------------------------------- preparing the rooms
// A stable name for each exhibit from where it is (so reordering config.js doesn't mix them up),
// e.g. "price/painting/west/-4", "rotunda/panel/face0/0", "price/pedestal/floor/-2,-3.5".
function exhibitId(room, ex) {
  const onWall = ex.wall || ex.face !== undefined;
  const where = ex.wall ?? (ex.face !== undefined ? `face${ex.face}` : 'floor');
  return `${room.id}/${ex.type}/${where}/${onWall ? ex.at ?? 0 : `${ex.x ?? 0},${ex.z ?? 0}`}`;
}

// Fills in defaults, lays admin-mode edits (content/exhibits.json) over config.js, places the gallery
// wings around the rotunda, and gives every door its matching opening in the room behind it.
export function prepareRooms(content) {
  for (const room of ROOMS) {
    room.height ??= DEFAULT_HEIGHT;
    room.doors ??= {};
    for (const side of Object.keys(SIDES)) room.doors[side] ??= [];
    room.footprints = []; // things standing on the floor, for the baked floor shadows
    room.openings ??= [];
    for (const ex of room.exhibits ?? []) {
      ex.id ??= exhibitId(room, ex);
      Object.assign(ex, content[ex.id]);
    }
  }
  // wings attached to the rotunda: where each sits and turns, and matching doorways in both
  for (const room of ROOMS) {
    if (!room.attach) continue;
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
  for (const room of ROOMS) {
    for (const opening of room.openings) {
      if (!opening.link) continue;
      const other = ROOMS.find((r) => r.id === opening.link);
      other.doors.north.push({ at: 0, width: opening.width, to: room });
      opening.to = other;
    }
  }
  linkDoors();
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

// ---------------------------------------------------------------- walls
function wallPlane(room, side) {
  const s = SIDES[side];
  return s.horizontal ? room.z + (s.sign * room.d) / 2 : room.x + (s.sign * room.w) / 2;
}
const wallCenter = (room, side) => (SIDES[side].horizontal ? room.x : room.z);
export const wallLength = (room, side) => (SIDES[side].horizontal ? room.w : room.d);

// x/z of a point `along` a wall, `inset` meters in from the wall's outer plane.
export function wallPoint(room, side, along, inset) {
  const s = SIDES[side];
  const inward = wallPlane(room, side) - s.sign * inset;
  return s.horizontal ? { x: room.x + along, z: inward } : { x: inward, z: room.z + along };
}

// The parts of a wall that are solid from the floor up (everything except the doorways), as [from, to].
export function solidRanges(room, side) {
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

// ---------------------------------------------------------------- the build context
// Each room is built in its own local space (centered on 0,0, unturned) inside a group that places
// and turns it in the world. `parent` is the group being built into; `frame` is its placement.
export let parent = scene;
export let frame = { x: 0, z: 0, rot: 0 };
export function buildInto(group, placement) {
  parent = group;
  frame = placement;
}

export const roomFrame = (room) => ({ x: room.x, z: room.z, rot: room.rot ?? 0 });

export function toWorld(lx, lz, f = frame) {
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

// A solid box the visitor can't walk through, in the current room's local space (may be turned).
export function addCollider(x, z, w, d, rot = 0) {
  const p = toWorld(x, z);
  const total = frame.rot + rot;
  colliders.push({ x: p.x, z: p.z, hw: w / 2, hd: d / 2, c: Math.cos(total), s: Math.sin(total) });
}

export function addBox(w, h, d, material, x, y, z, collide = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  if (collide) addCollider(x, z, w, d);
  return mesh;
}

export function mountOnWall(room, ex, object, y) {
  const p = wallPoint(room, ex.wall, ex.at ?? 0, HALF_WALL);
  object.position.set(p.x, y, p.z);
  object.rotation.y = SIDES[ex.wall].rotY;
  parent.add(object);
}

// Meshes that open `exhibit` when clicked or tapped.
export function makeInteractive(meshes, exhibit, room) {
  for (const m of meshes) {
    m.userData.exhibit = exhibit;
    m.userData.room = room;
    interactables.push(m);
  }
}

// ---------------------------------------------------------------- which room is where
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
export const roomAt = (x, z) => ROOMS.find((r) => inRoom(r, x, z));

// A room's outline in world space: four corners, or eight for the rotunda (for the maps).
export function outline(room) {
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

// Rooms the number keys, the map and the guide count (the short passage isn't one).
export const VISIT_ROOMS = ROOMS.filter((r) => !r.passage);
