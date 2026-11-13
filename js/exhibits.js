// The things visitors come to see: framed pictures, wall text, the statue and other objects on
// plinths, display cases, posters, and the panelled doors set into walls. Each exhibit that admin
// mode can edit gets a refresh() that redraws it from its current title, text and photo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  FACING, PICTURE_RAIL_DROP, DOOR_W, DOOR_H, clearOfWainscot, parent, addBox, addCollider, mountOnWall, makeInteractive,
} from './world.js';
import { surfaceMaps } from './textures.js';
import { MAT, displayMaterial, setMap, fitPhoto, addWallLighting, decal, GLOW_TEX } from './materials.js';
import { artTexture, emptySlotTexture, labelTexture, textPanelTexture, plaqueTexture, posterTexture } from './art.js';
import { piece, rodBetween } from './util.js';

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export function buildExhibit(room, ex) {
  const builders = { painting: buildPainting, panel: buildPanel, pedestal: buildPedestal, case: buildCase, poster: buildPoster, door: buildFakeDoor };
  if (builders[ex.type]) builders[ex.type](room, ex);
  else console.warn(`Unknown exhibit type "${ex.type}" in room "${room.id}"`);
}

// Beveled picture-frame moulding: a rectangle with a rectangular hole, extruded.
function frameGeometry(outerW, outerH, innerW, innerH, depth) {
  const shape = new THREE.Shape([
    new THREE.Vector2(-outerW / 2, -outerH / 2), new THREE.Vector2(outerW / 2, -outerH / 2),
    new THREE.Vector2(outerW / 2, outerH / 2), new THREE.Vector2(-outerW / 2, outerH / 2),
  ]);
  shape.holes.push(new THREE.Path([
    new THREE.Vector2(-innerW / 2, -innerH / 2), new THREE.Vector2(-innerW / 2, innerH / 2),
    new THREE.Vector2(innerW / 2, innerH / 2), new THREE.Vector2(innerW / 2, -innerH / 2),
  ]));
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
}

// A framed picture on a white mat with a label beside it (in period rooms it hangs from the picture rail).
function buildPainting(room, ex) {
  const w = ex.width ?? 2.4;
  const h = ex.height ?? 1.7;
  const y = clearOfWainscot(room, ex.y ?? 2.2, h + 0.4);
  const group = new THREE.Group();
  const frame = piece(group, frameGeometry(w + 0.4, h + 0.4, w + 0.28, h + 0.28, 0.035), MAT.frame, 0, 0, 0.03);
  frame.castShadow = true;
  const mat = piece(group, new THREE.PlaneGeometry(w + 0.3, h + 0.3), MAT.passepartout, 0, 0, 0.05);
  const artMat = displayMaterial(emptySlotTexture(), 2);
  const art = piece(group, new THREE.PlaneGeometry(w, h), artMat, 0, 0, 0.062);
  const label = piece(group, new THREE.PlaneGeometry(0.9, 0.28), displayMaterial(labelTexture(''), 1), w / 2 + 0.75, -h / 2 + 0.14, 0.03);
  if (w / 2 + 1.1 > 3) label.position.set(0, -h / 2 - 0.4, 0.03); // big pictures: label underneath
  ex.refresh = () => {
    if (ex.image) fitPhoto(ex.image, w / h, '#f6f3ec', (tex) => setMap(artMat, tex));
    else setMap(artMat, ex.title ? artTexture(ex.title, room.accent ?? '#888') : emptySlotTexture());
    setMap(label.material, labelTexture(ex.title ?? '', ex.subtitle));
    label.visible = !!ex.title;
  };
  ex.refresh();
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

// Wall text on a dark panel, with gas-lamp sconces either side in period rooms. Can carry a photo.
function buildPanel(room, ex) {
  const w = ex.width ?? 2.4;
  const h = ex.height ?? 1.6;
  const accent = room.accent ?? '#d9a441';
  const group = new THREE.Group();
  const face = displayMaterial(textPanelTexture(ex.title ?? '', ex.text, w, w / h, accent));
  const panel = piece(group, new THREE.BoxGeometry(w, h, 0.05), [MAT.trim, MAT.trim, MAT.trim, MAT.trim, face, MAT.trim], 0, 0, 0.045);
  addWallLighting(group, w, h, w + 1, !room.victorian);
  const y = clearOfWainscot(room, ex.y ?? 1.9, h);
  mountOnWall(room, ex, group, y);
  if (room.victorian) for (const sgn of [-1, 1]) addSconce(room, ex.wall, (ex.at ?? 0) + sgn * (w / 2 + 0.6), Math.max(2.4, y + 0.4));
  // what the visitor's info panel shows
  const info = { ...ex, description: ex.description || ex.text || 'Text coming soon.' };
  info.refresh = () => {
    info.description = info.text || 'Text coming soon.';
    const draw = (img) => setMap(face, textPanelTexture(info.title ?? '', info.text, w, w / h, accent, img));
    draw(null);
    if (info.image) {
      const img = new Image();
      img.onload = () => draw(img);
      img.src = info.image;
    }
  };
  if (info.image) info.refresh();
  makeInteractive([panel], info, room);
}

// A brass gas-lamp sconce with a frosted glass globe and a warm glow on the wall behind it.
const SCONCE = {
  plate: new THREE.CylinderGeometry(0.075, 0.075, 0.025, 24).rotateX(Math.PI / 2),
  arm: new THREE.CylinderGeometry(0.014, 0.014, 0.24, 10).rotateX(Math.PI / 2),
  cup: new THREE.CylinderGeometry(0.055, 0.03, 0.07, 20),
  globe: new THREE.SphereGeometry(0.085, 24, 16),
  chimney: new THREE.CylinderGeometry(0.03, 0.04, 0.09, 16, 1, true),
};
function addSconce(room, side, at, y) {
  const g = new THREE.Group();
  piece(g, SCONCE.plate, MAT.gilt, 0, 0, 0.012);
  piece(g, SCONCE.arm, MAT.gilt, 0, -0.05, 0.13);
  piece(g, SCONCE.cup, MAT.gilt, 0, -0.03, 0.24);
  piece(g, SCONCE.globe, MAT.gaslight, 0, 0.07, 0.24);
  piece(g, SCONCE.chimney, MAT.gilt, 0, 0.18, 0.24);
  const glow = decal(GLOW_TEX, 1.5, 1.5, { additive: true, opacity: 0.5, layer: 3 });
  glow.position.set(0, 0.1, 0.03);
  g.add(glow);
  mountOnWall(room, { wall: side, at }, g, y);
}

// ---------------------------------------------------------------- plinths and the statue
// An object on a plinth. `scale` is the object's size in meters (its largest side); `model` is a
// .glb file; `plinth: { width, height, inscription }` makes it a monument; with no model the plinth
// stands empty, waiting for an exhibit.
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
  else piece(parent, new THREE.PlaneGeometry(0.46, 0.08), new THREE.MeshBasicMaterial({ map: plaqueTexture('PLEASE DO NOT TOUCH'), polygonOffset: true, polygonOffsetFactor: -1 }), px, 0.97, pz + baseW / 2 + 0.004);

  const holder = new THREE.Group();
  holder.position.set(px, baseH + 0.06 + 0.5 * scale, pz);
  holder.rotation.y = turn;
  parent.add(holder);
  // invisible box so the whole object area is easy to click
  const hitbox = piece(holder, new THREE.BoxGeometry(baseW, scale, baseW), new THREE.MeshBasicMaterial({ visible: false }));
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
        model.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(fit));
        holder.add(model);
      },
      undefined,
      () => console.warn(`Could not load model "${ex.model}".`),
    );
  }

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
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.bias = -0.0003;
    spot.shadow.normalBias = 0.02;
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 24;
  }
  parent.add(spot);
}

// A monument plinth for a full-length statue: a cream marble step and moldings around a darker
// veined marble die, with a bronze name plaque on the front. Its top is at height + 0.06.
function buildMonumentPlinth(room, px, pz, w, h, turn, inscription) {
  const light = new THREE.MeshPhysicalMaterial({ ...surfaceMaps('marble', '#e9e2d5', w, 0.5), roughness: 1, clearcoat: 0.4, clearcoatRoughness: 0.2 });
  const dark = new THREE.MeshPhysicalMaterial({ ...surfaceMaps('marble', '#6b5d53', w, h), roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.12 });
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
    const plate = piece(parent, new THREE.PlaneGeometry(w * 0.82, w * 0.82 * (104 / 512)), new THREE.MeshStandardMaterial({ map: plaqueTexture(inscription), metalness: 0.5, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1 }));
    const out = w / 2 + 0.004;
    plate.position.set(px + Math.sin(turn) * out, 0.28 + (h - 0.42) * 0.6, pz + Math.cos(turn) * out);
    plate.rotation.y = turn;
    parts.push(plate);
  }
  return parts;
}

// Gives a loaded model a polished white marble surface. Models made by tools/statue carry baked
// shading in their vertex colors (darker in folds and crevices) but no texture coordinates, so the
// veining is projected onto them from the side at a slant (no seams to hide).
function carveInMarble(model, color = '#f1eee8') {
  let hasShading = false;
  model.traverse((m) => (hasShading ||= !!m.geometry?.attributes.color));
  const material = new THREE.MeshPhysicalMaterial({
    ...surfaceMaps('marble', color, 1.5, 1.5),
    roughness: 0.9, // the map's roughness is low, so this ends up softly polished
    normalScale: new THREE.Vector2(0.3, 0.3),
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
    sheen: 0.4, // light scattering just under the surface gives marble its soft glow
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0xfff4e6),
    vertexColors: hasShading,
  });
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
const POST = {
  base: new THREE.CylinderGeometry(0.15, 0.17, 0.035, 32),
  pole: new THREE.CylinderGeometry(0.022, 0.026, 0.95, 16),
  top: new THREE.SphereGeometry(0.045, 20, 12),
};
// A brass stanchion post at x, z (world-space within the current room group).
export function stanchionPost(room, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  piece(g, POST.base, MAT.brass, 0, 0.018, 0);
  piece(g, POST.pole, MAT.brass, 0, 0.475, 0);
  piece(g, POST.top, MAT.brass, 0, 0.97, 0);
  g.traverse((m) => m.isMesh && (m.castShadow = true));
  parent.add(g);
  room.footprints.push({ x, z, w: 0.34, d: 0.34, round: true });
}
// A sagging velvet rope between two post tops.
export function velvetRope(a, b) {
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= 0.22;
  const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).setY(a.y - 0.15), mid, b.clone().lerp(mid, 0.5).setY(b.y - 0.15), b]);
  const rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.022, 10), MAT.rope);
  rope.castShadow = true;
  parent.add(rope);
}
function buildRopeBarrier(room, cx, cz, size) {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => new THREE.Vector3(cx + (sx * size) / 2, 0.9, cz + (sz * size) / 2));
  for (const c of corners) stanchionPost(room, c.x, c.z);
  for (let i = 0; i < 4; i++) velvetRope(corners[i], corners[(i + 1) % 4]);
  addCollider(cx, cz, size + 0.3, size + 0.3);
}

// ---------------------------------------------------------------- cases, posters, doors
// Display case: a mahogany cabinet with a glass vitrine on top; shows a photo on a little stand.
function buildCase(room, ex) {
  const g = new THREE.Group();
  const x = room.x + (ex.x ?? 0);
  const z = room.z + (ex.z ?? 0);
  const rot = THREE.MathUtils.degToRad(ex.rotation ?? 0);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  const cabinet = piece(g, new THREE.BoxGeometry(1.5, 0.85, 0.75), new THREE.MeshStandardMaterial({ ...surfaceMaps('wainscot', '#5a2a1a', 1.5, 0.85 / 1.1), roughness: 1 }), 0, 0.425, 0);
  piece(g, new THREE.BoxGeometry(1.58, 0.05, 0.83), MAT.mahogany, 0, 0.875, 0);
  piece(g, new THREE.BoxGeometry(1.4, 0.02, 0.66), MAT.felt, 0, 0.91, 0);
  const glass = piece(g, new THREE.BoxGeometry(1.46, 0.56, 0.72), MAT.caseGlass, 0, 1.18, 0);
  glass.renderOrder = 1;
  for (const [cx, cz] of [[-0.73, -0.36], [0.73, -0.36], [-0.73, 0.36], [0.73, 0.36]]) piece(g, new THREE.BoxGeometry(0.03, 0.56, 0.03), MAT.gilt, cx, 1.18, cz);
  piece(g, new THREE.BoxGeometry(1.5, 0.04, 0.76), MAT.mahogany, 0, 1.48, 0);
  // a placeholder book until a photo is chosen, then the photo on a little stand
  const book = piece(g, new THREE.BoxGeometry(0.5, 0.04, 0.36), MAT.bookCover, 0, 0.94, 0);
  book.rotation.y = 0.3;
  const card = new THREE.Group();
  card.position.set(0, 0.92, -0.04);
  card.rotation.x = -0.3;
  piece(card, new THREE.BoxGeometry(0.66, 0.48, 0.02), MAT.mahogany, 0, 0.24, -0.012);
  const cardMat = displayMaterial(emptySlotTexture(), 1);
  piece(card, new THREE.PlaneGeometry(0.6, 0.42), cardMat, 0, 0.24, 0);
  g.add(card);
  book.userData.dynamic = card.userData.dynamic = true; // shown or hidden by edits
  ex.refresh = () => {
    book.visible = !!ex.title && !ex.image;
    card.visible = !!ex.image;
    if (ex.image) fitPhoto(ex.image, 0.6 / 0.42, '#1d1a17', (tex) => setMap(cardMat, tex));
  };
  ex.refresh();
  g.traverse((m) => {
    if (m.isMesh && m !== glass) m.castShadow = m.receiveShadow = true;
  });
  parent.add(g);
  makeInteractive([cabinet, glass], ex, room);
  addCollider(x, z, 1.58, 0.83, rot);
  room.footprints.push({ x, z, w: 1.58, d: 0.83, rot });
}

// Framed exhibition poster behind glass, in a slim gilt frame.
function buildPoster(room, ex) {
  const w = 0.95;
  const h = w * (912 / 640);
  const g = new THREE.Group();
  piece(g, frameGeometry(w + 0.08, h + 0.08, w, h, 0.03), MAT.gilt, 0, 0, 0.02);
  piece(g, new THREE.PlaneGeometry(w, h), displayMaterial(posterTexture(ex.design), 2), 0, 0, 0.03);
  piece(g, new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.08, depthWrite: false }), 0, 0, 0.045);
  addWallLighting(g, w + 0.08, h + 0.08, undefined, false);
  mountOnWall(room, ex, g, clearOfWainscot(room, ex.y ?? 2.1, h + 0.1));
}

// A panelled mahogany door that doesn't open (staff rooms, restrooms): architrave, four raised
// panels, a brass knob and kick plate, and a small brass sign.
function buildFakeDoor(room, ex) {
  const g = new THREE.Group();
  const box = (w, h, d, mat, x, y, z) => piece(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  for (const s of [-1, 1]) box(0.13, DOOR_H + 0.06, 0.1, MAT.mahogany, s * (DOOR_W / 2 + 0.065), (DOOR_H + 0.06) / 2, 0.05);
  box(DOOR_W + 0.26, 0.16, 0.1, MAT.mahogany, 0, DOOR_H + 0.11, 0.05);
  box(DOOR_W + 0.34, 0.04, 0.13, MAT.mahogany, 0, DOOR_H + 0.21, 0.065);
  box(DOOR_W, DOOR_H, 0.05, MAT.mahogany, 0, DOOR_H / 2, 0.04);
  for (const [h, y] of [[1.0, 1.72], [0.72, 0.6]]) {
    for (const s of [-1, 1]) {
      box(0.38, h, 0.012, MAT.trim, s * (DOOR_W / 4 + 0.005), y, 0.068);
      box(0.32, h - 0.06, 0.02, MAT.mahogany, s * (DOOR_W / 4 + 0.005), y, 0.074);
    }
  }
  const kx = DOOR_W / 2 - 0.1;
  piece(g, new THREE.CylinderGeometry(0.035, 0.035, 0.012, 20).rotateX(Math.PI / 2), MAT.brass, kx, 1.0, 0.071);
  piece(g, new THREE.SphereGeometry(0.03, 16, 12), MAT.brass, kx, 1.0, 0.11);
  piece(g, new THREE.CylinderGeometry(0.008, 0.012, 0.035, 10).rotateX(Math.PI / 2), MAT.brass, kx, 1.0, 0.088);
  box(0.03, 0.06, 0.006, MAT.brass, kx, 0.9, 0.068);
  box(DOOR_W - 0.08, 0.2, 0.006, MAT.brass, 0, 0.12, 0.068);
  if (ex.sign) piece(g, new THREE.PlaneGeometry(0.62, 0.126), new THREE.MeshBasicMaterial({ map: plaqueTexture(ex.sign), polygonOffset: true, polygonOffsetFactor: -1 }), 0, 1.58, 0.0855);
  g.traverse((m) => m.isMesh && (m.receiveShadow = true));
  mountOnWall(room, ex, g, 0);
}
