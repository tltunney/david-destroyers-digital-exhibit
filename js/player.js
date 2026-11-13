// The visitor: walking, jumping, bumping into things, and jumping between rooms.
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { camera, EYE_HEIGHT } from './engine.js';
import { SIDES, FACING, colliders, interactables, blockers, roomFrame, toWorld, wallPoint } from './world.js';

const PLAYER_RADIUS = 0.35;
const WALK_SPEED = 4;
const RUN_SPEED = 7.5;
const INTERACT_DISTANCE = 6;
const GRAVITY = 18;
const JUMP_SPEED = 4.4; // about half a meter off the floor
const STRIDE = 0.75;

export const controls = new PointerLockControls(camera, document.body);

// mode: 'desktop' (pointer lock + keyboard) or 'touch' (thumb stick + drag), picked on the start screen
export const state = { mode: null, touchPlaying: false, panelOpen: false };
export const isPlaying = () => (state.mode === 'touch' ? state.touchPlaying && !state.panelOpen : controls.isLocked);
export const keys = new Set();
export const joystick = { x: 0, y: 0 }; // -1..1, pushing up is y = -1

export function placePlayer(x, z, facing) {
  camera.position.set(x, EYE_HEIGHT, z);
  camera.rotation.set(0, typeof facing === 'number' ? facing : FACING[facing] ?? 0, 0);
  jumpY = jumpV = bobY = 0;
}

export function teleportTo(room) {
  if (room.shape === 'octagon') return placePlayer(room.x, room.z + room.apothem - 3, 'north');
  if (room.attach) {
    // just inside the doorway from the rotunda, looking into the wing
    const p = toWorld(0, room.d / 2 - 2.5, roomFrame(room));
    return placePlayer(p.x, p.z, room.rot);
  }
  for (const side of Object.keys(SIDES)) {
    // stand just inside the room's first doorway, facing in
    const door = room.doors[side][0];
    if (!door) continue;
    const p = wallPoint(room, side, door.at, 2);
    return placePlayer(p.x, p.z, SIDES[side].opposite);
  }
  placePlayer(room.x, room.z, 'north');
}

// Is the visitor (a circle) overlapping any collider (a possibly-turned box)?
export function blocked(x, z) {
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

// Jumping, and the faint rise and fall of the head while walking, as offsets on the eye height.
let jumpY = 0;
let jumpV = 0;
let bobY = 0;
let gait = 0;
export function jump() {
  if (isPlaying() && jumpY === 0 && jumpV === 0) jumpV = JUMP_SPEED;
}

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function updateMovement(dt) {
  if (!isPlaying()) return;
  if (jumpV !== 0 || jumpY > 0) {
    jumpV -= GRAVITY * dt;
    jumpY += jumpV * dt;
    if (jumpY <= 0) jumpY = jumpV = 0;
  }
  camera.position.y = EYE_HEIGHT + bobY + jumpY;

  let f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  let speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
  if (state.mode === 'touch' && (joystick.x || joystick.y)) {
    f = -joystick.y;
    r = joystick.x;
    speed = WALK_SPEED * 1.4 * Math.min(1, Math.hypot(f, r)); // push further to go faster
  }
  if (!f && !r) {
    bobY *= Math.max(0, 1 - dt * 8); // settle after walking
    return;
  }
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  right.crossVectors(forward, UP);
  move.set(0, 0, 0).addScaledVector(forward, f).addScaledVector(right, r).normalize().multiplyScalar(speed * dt);
  // move one axis at a time so the visitor slides along walls
  const pos = camera.position;
  const x0 = pos.x;
  const z0 = pos.z;
  if (!blocked(pos.x + move.x, pos.z)) pos.x += move.x;
  if (!blocked(pos.x, pos.z + move.z)) pos.z += move.z;
  const walked = Math.hypot(pos.x - x0, pos.z - z0);
  if (walked && jumpY === 0) {
    gait += (walked / STRIDE) * Math.PI;
    bobY = -0.012 + Math.abs(Math.sin(gait)) * 0.024;
  }
}

// Which exhibit (if any) is at this point on the screen (-1..1 coordinates), within reach and not behind a wall.
const raycaster = new THREE.Raycaster();
raycaster.far = INTERACT_DISTANCE;
let targets = null;
export function exhibitAt(ndc) {
  targets ??= [...interactables, ...blockers]; // everything is built by the time anyone looks
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(targets, false)[0];
  return hit?.object.userData.exhibit ? hit.object : null;
}
