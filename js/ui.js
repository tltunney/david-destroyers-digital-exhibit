// Everything on screen around the 3D view: the start/pause menu, the exhibit info panel, the room
// label and minimap, music and graphics settings, admin mode, keyboard and touch controls.
import * as THREE from 'three';
import { MUSEUM, ROOMS } from './config.js';
import { renderer, camera, SMALL_SCREEN } from './engine.js';
import { VISIT_ROOMS, outline, roomAt } from './world.js';
import { controls, state, isPlaying, keys, joystick, jump, teleportTo, exhibitAt } from './player.js';
import { setGlassQuality } from './materials.js';
import { AmbientMusic } from './music.js';
import { Admin } from './admin.js';

const LOOK_SPEED = 0.005; // touch: radians of turn per pixel dragged
const $ = (id) => document.getElementById(id);
const ui = {
  overlay: $('overlay'),
  enter: $('enter-btn'),
  enterTouch: $('enter-touch-btn'),
  prompt: $('prompt'),
  roomLabel: $('room-label'),
  minimap: $('minimap'),
  panel: $('info-panel'),
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

// ---------------------------------------------------------------- music
const music = new AmbientMusic(MUSEUM.music);
function toggleMusic() {
  music.toggle();
  updateMusicButtons();
}
function updateMusicButtons() {
  ui.musicBtn.textContent = music.enabled ? '♫ Music: on' : '♫ Music: off';
  ui.musicHud.classList.toggle('off', !music.enabled);
}
updateMusicButtons();
ui.musicBtn.addEventListener('click', toggleMusic);
ui.musicHud.addEventListener('click', toggleMusic);
document.addEventListener('visibilitychange', () => music.setVisible(!document.hidden));

// ---------------------------------------------------------------- graphics quality
// "high" adds soft contact shadows, glow and see-through glass; phones start on "standard".
let quality = SMALL_SCREEN ? 'standard' : 'high';
try {
  quality = localStorage.getItem('museum-quality') ?? quality;
} catch {}
let onQuality = () => {};
export const getQuality = () => quality;
export function onQualityChange(fn) {
  onQuality = fn;
  fn(quality);
}
function setQuality(q) {
  quality = q;
  try {
    localStorage.setItem('museum-quality', q);
  } catch {}
  ui.qualityBtn.textContent = q === 'high' ? 'Graphics: high' : 'Graphics: standard (faster)';
  setGlassQuality(q === 'high');
  onQuality(q);
}
setQuality(quality);
ui.qualityBtn.addEventListener('click', () => setQuality(quality === 'high' ? 'standard' : 'high'));

// ---------------------------------------------------------------- start / pause
if (SMALL_SCREEN) {
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
  state.mode = 'desktop';
  state.touchPlaying = false;
  document.body.classList.remove('touch');
  music.start();
  controls.lock();
});
ui.enterTouch.addEventListener('click', () => {
  state.mode = 'touch';
  state.touchPlaying = true;
  document.body.classList.add('touch');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // easier on phone GPUs
  window.dispatchEvent(new Event('resize'));
  music.start();
  ui.overlay.classList.add('hidden');
  // hide the browser bars where possible (Android, iPad); harmless where unsupported
  document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
});
controls.addEventListener('lock', () => ui.overlay.classList.add('hidden'));
controls.addEventListener('unlock', () => {
  if (state.mode === 'desktop' && !state.panelOpen) showMenu();
});
document.addEventListener('pointerlockerror', () => {
  if (!state.panelOpen) showMenu();
});
$('menu-hud').addEventListener('click', () => {
  state.touchPlaying = false;
  resetJoystick();
  showMenu();
});
$('map-hud').addEventListener('click', () => ui.minimap.classList.toggle('hidden'));
$('jump-btn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  jump();
});

// index.html always starts the newest code. If the museum is updated while this page stays open,
// offer a reload instead of leaving someone on an old version.
setInterval(async () => {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { version } = await res.json();
    if (window.MUSEUM_VERSION && version !== window.MUSEUM_VERSION) $('update-banner').classList.remove('hidden');
  } catch {}
}, 3 * 60 * 1000);
$('update-reload').addEventListener('click', () => location.reload());

// ---------------------------------------------------------------- exhibits
// In admin mode, choosing an exhibit opens its editor instead of the visitor's info panel.
const admin = new Admin(MUSEUM.admin ?? {});
$('admin-btn').addEventListener('click', () => admin.open());

function pauseForDialog() {
  state.panelOpen = true;
  ui.prompt.classList.add('hidden');
  promptFor = null;
  resetJoystick();
  if (state.mode === 'desktop') controls.unlock();
}
function resume() {
  state.panelOpen = false;
  if (state.mode === 'desktop') controls.lock();
}

function openExhibit(exhibit, room) {
  pauseForDialog();
  if (admin.active && exhibit.id) return admin.edit(exhibit, room, resume);
  $('info-room').textContent = room.name;
  $('info-title').textContent = exhibit.title || 'Exhibit coming soon';
  $('info-subtitle').textContent = exhibit.subtitle ?? '';
  const img = $('info-image');
  if (exhibit.image) img.src = exhibit.image;
  else img.removeAttribute('src');
  img.alt = exhibit.title ?? '';
  const description = exhibit.description || (exhibit.title ? '' : 'This space is saved for an upcoming exhibit.');
  $('info-body').replaceChildren(
    ...(Array.isArray(description) ? description : description.split('\n')).map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }),
  );
  ui.panel.classList.remove('hidden');
}
function closePanel() {
  ui.panel.classList.add('hidden');
  resume();
}
$('info-close').addEventListener('click', closePanel);

// what the visitor is looking at, and the "View" prompt for it
let focused = null;
let promptFor = null;
const screenCenter = new THREE.Vector2(0, 0);
function updateFocus() {
  focused = isPlaying() ? exhibitAt(screenCenter) : null;
  if (focused === promptFor) return;
  promptFor = focused;
  if (!focused) return ui.prompt.classList.add('hidden');
  const title = focused.userData.exhibit.title || 'Exhibit coming soon';
  ui.prompt.replaceChildren();
  if (state.mode === 'touch') ui.prompt.append(`Tap to view: ${title}`);
  else {
    const kbd = document.createElement('kbd');
    kbd.textContent = 'E';
    ui.prompt.append(kbd, ` View: ${title}`);
  }
  ui.prompt.classList.remove('hidden');
}
ui.prompt.addEventListener('click', () => {
  if (state.mode === 'touch' && focused) openExhibit(focused.userData.exhibit, focused.userData.room);
});

// ---------------------------------------------------------------- keyboard and mouse
document.addEventListener('keydown', (e) => {
  if (admin.editorOpen || e.target.closest?.('input, textarea')) return;
  if (state.panelOpen) {
    if (e.code === 'KeyE' || e.code === 'Escape') closePanel();
    return;
  }
  keys.add(e.code);
  if (e.code === 'KeyN') toggleMusic();
  if (!controls.isLocked) return;
  if (e.code === 'KeyE' && focused) openExhibit(focused.userData.exhibit, focused.userData.room);
  if (e.code === 'KeyM') ui.minimap.classList.toggle('hidden');
  if (e.code === 'Space') {
    e.preventDefault();
    jump();
  }
  const n = Number(e.key);
  if (n >= 1 && n <= VISIT_ROOMS.length) teleportTo(VISIT_ROOMS[n - 1]);
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('mousedown', () => {
  if (controls.isLocked && focused) openExhibit(focused.userData.exhibit, focused.userData.room);
});

// ---------------------------------------------------------------- touch: thumb stick, drag to look, tap to view
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
const canvas = renderer.domElement;
const drag = { id: null, x: 0, y: 0, startX: 0, startY: 0, time: 0 };
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'touch' || !isPlaying() || drag.id !== null) return;
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
    if (type !== 'pointerup' || !isTap || !isPlaying()) return;
    const tapped = exhibitAt(new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1));
    if (tapped) openExhibit(tapped.userData.exhibit, tapped.userData.room);
  });
}

// ---------------------------------------------------------------- room label and minimap
let currentRoom = null;
function updateRoomLabel() {
  const room = roomAt(camera.position.x, camera.position.z);
  if (!room || room === currentRoom) return;
  currentRoom = room;
  ui.roomLabel.textContent = room.name;
  ui.roomLabel.style.borderLeftColor = room.accent ?? '';
}

// worked out on first use, once the rooms have been placed
let OUTLINES = null;
let toMap = null;
function layoutMap() {
  OUTLINES = new Map(ROOMS.map((r) => [r, outline(r)]));
  const points = [...OUTLINES.values()].flat();
  const minX = Math.min(...points.map((p) => p.x));
  const minZ = Math.min(...points.map((p) => p.z));
  const spanX = Math.max(...points.map((p) => p.x)) - minX;
  const spanZ = Math.max(...points.map((p) => p.z)) - minZ;
  const pad = 12;
  const scale = Math.min((ui.minimap.width - pad * 2) / spanX, (ui.minimap.height - pad * 2) / spanZ);
  const offX = (ui.minimap.width - spanX * scale) / 2;
  const offY = (ui.minimap.height - spanZ * scale) / 2;
  toMap = (x, z) => [offX + (x - minX) * scale, offY + (z - minZ) * scale];
}
const mapCtx = ui.minimap.getContext('2d');
const facing = new THREE.Vector3();
function drawMinimap() {
  if (!OUTLINES) layoutMap();
  const ctx = mapCtx;
  ctx.clearRect(0, 0, ui.minimap.width, ui.minimap.height);
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const r of ROOMS) {
    ctx.beginPath();
    OUTLINES.get(r).forEach((p, k) => (k ? ctx.lineTo(...toMap(p.x, p.z)) : ctx.moveTo(...toMap(p.x, p.z))));
    ctx.closePath();
    ctx.fillStyle = r === currentRoom ? 'rgba(217,164,65,0.45)' : 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const n = VISIT_ROOMS.indexOf(r);
    if (n < 0) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(String(n + 1), ...toMap(r.x, r.z));
  }
  // the visitor, as an arrow
  const [px, py] = toMap(camera.position.x, camera.position.z);
  camera.getWorldDirection(facing);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.atan2(facing.z, facing.x));
  ctx.fillStyle = '#ff5a4f';
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-5, 5);
  ctx.lineTo(-5, -5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Called every frame by app.js.
export function updateUI() {
  updateFocus();
  updateRoomLabel();
  drawMinimap();
}
export { music };
