// Furniture and furnishings from config.js `decor`: benches and settees, the admissions desk, the
// grandfather clock, plants, the coat stand, the museum guide, donation box, brochures, rope lines,
// rugs and banners. x/z are relative to the room's center; at rotation 0 the front faces south.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROOMS } from './config.js';
import { parent, addCollider, outline, animators } from './world.js';
import { surfaceMaps } from './textures.js';
import { MAT, displayMaterial } from './materials.js';
import { plaqueTexture, CLOCK_FACE, rugTexture, bannerTexture } from './art.js';
import { canvasTexture, seededRandom, piece, rodBetween, tube, lathe, SERIF } from './util.js';
import { stanchionPost, velvetRope } from './exhibits.js';

// Each builder adds its parts to group g and returns its footprint [width, depth].
const FURNITURE = {
  bench: buildBench,
  settee: buildSettee,
  admissions: buildAdmissionsDesk,
  clock: buildClock,
  monstera: (g, room, item) => buildMonstera(g, `monstera${item.x},${item.z}`),
  coatstand: buildCoatStand,
  guide: buildGuideEasel,
  donations: buildDonationBox,
  brochures: buildBrochureRack,
};
const ROUND = new Set(['monstera']); // round footprints, for the floor shadows

export function buildDecor(room, item) {
  if (item.type === 'stanchions') return buildStanchionLine(room, item.points);
  if (item.type === 'rug') return buildRug(room, item);
  if (item.type === 'banner') return buildBanner(room, item);
  if (!FURNITURE[item.type]) return console.warn(`Unknown decor type "${item.type}"`);
  const x = room.x + (item.x ?? 0);
  const z = room.z + (item.z ?? 0);
  const rot = THREE.MathUtils.degToRad(item.rotation ?? 0);
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rot;
  const [w, d] = FURNITURE[item.type](group, room, item);
  group.traverse((m) => {
    if (m.isMesh) m.castShadow = m.receiveShadow = true;
  });
  parent.add(group);
  addCollider(x, z, w, d, rot);
  room.footprints.push({ x, z, w, d, round: ROUND.has(item.type), rot });
}

// Museum bench: a leather cushion on a recessed oak base.
function buildBench(g) {
  piece(g, new RoundedBoxGeometry(2.4, 0.14, 0.62, 4, 0.05), MAT.leather, 0, 0.44, 0);
  piece(g, new THREE.BoxGeometry(2.1, 0.37, 0.42), MAT.oak, 0, 0.185, 0);
  return [2.4, 0.62];
}

// Victorian button-tufted velvet ottoman on turned mahogany legs.
function buildSettee(g) {
  piece(g, new RoundedBoxGeometry(2.2, 0.22, 0.75, 4, 0.08), MAT.velvet, 0, 0.47, 0);
  piece(g, new THREE.BoxGeometry(2.1, 0.14, 0.66), MAT.mahogany, 0, 0.3, 0);
  const leg = lathe([[0, 0], [0.03, 0], [0.032, 0.03], [0.022, 0.08], [0.04, 0.15], [0.03, 0.22], [0.045, 0.24], [0, 0.24]], 16);
  for (const [lx, lz] of [[-0.95, -0.27], [0.95, -0.27], [-0.95, 0.27], [0.95, 0.27]]) piece(g, leg, MAT.mahogany, lx, 0, lz);
  return [2.2, 0.75];
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
  piece(d, new THREE.CylinderGeometry(0.075, 0.075, 0.42, 24, 1, true, Math.PI / 2, Math.PI), MAT.bankerGreen, -1.25, 1.42, 0.4).rotation.z = Math.PI / 2;
  piece(d, new THREE.BoxGeometry(0.36, 0.015, 0.04), MAT.gaslight, -1.25, 1.385, 0.4);
  // guest book, open
  piece(d, new THREE.BoxGeometry(0.5, 0.02, 0.34), MAT.bookCover, 0.45, 1.12, 0.42);
  for (const sx of [-1, 1]) piece(d, new THREE.BoxGeometry(0.23, 0.02, 0.31), MAT.paper, 0.45 + sx * 0.12, 1.14, 0.42).rotation.z = sx * 0.06;
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
function buildClock(g) {
  const wood = MAT.mahogany;
  piece(g, new THREE.BoxGeometry(0.62, 0.5, 0.42), wood, 0, 0.25, 0);
  piece(g, new THREE.BoxGeometry(0.48, 1.15, 0.32), wood, 0, 1.075, 0);
  piece(g, new THREE.BoxGeometry(0.28, 0.82, 0.02), MAT.trim, 0, 1.08, 0.16);
  piece(g, new THREE.PlaneGeometry(0.28, 0.82), MAT.caseGlass, 0, 1.08, 0.175).renderOrder = 1;
  const pendulum = new THREE.Group();
  pendulum.position.set(0, 1.45, 0.17);
  piece(pendulum, new THREE.BoxGeometry(0.012, 0.55, 0.006), MAT.gilt, 0, -0.275, 0);
  piece(pendulum, new THREE.CylinderGeometry(0.07, 0.07, 0.015, 24).rotateX(Math.PI / 2), MAT.gilt, 0, -0.56, 0);
  pendulum.userData.dynamic = true; // moves, so it's never merged with the rest
  g.add(pendulum);
  piece(g, new THREE.BoxGeometry(0.62, 0.62, 0.42), wood, 0, 1.96, 0);
  piece(g, new THREE.CircleGeometry(0.2, 48), new THREE.MeshStandardMaterial({ map: CLOCK_FACE, roughness: 0.5 }), 0, 1.96, 0.212);
  piece(g, new THREE.TorusGeometry(0.205, 0.016, 10, 48), MAT.gilt, 0, 1.96, 0.215);
  const hour = piece(g, new THREE.BoxGeometry(0.014, 0.1, 0.004).translate(0, 0.05, 0), MAT.trim, 0, 1.96, 0.222);
  const minute = piece(g, new THREE.BoxGeometry(0.009, 0.15, 0.004).translate(0, 0.075, 0), MAT.trim, 0, 1.96, 0.226);
  hour.userData.dynamic = minute.userData.dynamic = true;
  animators.push((t) => {
    pendulum.rotation.z = 0.12 * Math.sin(t * Math.PI); // one swing per second
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

// Monstera: big split leaves on arching stems, in a glazed pot.
const MONSTERA_LEAF = new THREE.MeshStandardMaterial({
  map: canvasTexture(256, 256, (ctx, w, h) => {
    const cx = w / 2;
    ctx.fillStyle = '#2f5e34'; // heart-shaped leaf, stem end at the bottom
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.9);
    ctx.bezierCurveTo(cx - w * 0.55, h * 0.95, cx - w * 0.5, h * 0.12, cx, h * 0.06);
    ctx.bezierCurveTo(cx + w * 0.5, h * 0.12, cx + w * 0.55, h * 0.95, cx, h * 0.9);
    ctx.fill();
    const g = ctx.createRadialGradient(cx, h * 0.45, 4, cx, h * 0.45, w * 0.45);
    g.addColorStop(0, 'rgba(120,170,100,0.35)');
    g.addColorStop(1, 'rgba(120,170,100,0)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,215,160,0.55)'; // midrib
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.9);
    ctx.lineTo(cx, h * 0.1);
    ctx.stroke();
    ctx.globalCompositeOperation = 'destination-out'; // the slits and holes that give the monstera its look
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
  }),
  alphaTest: 0.5,
  side: THREE.DoubleSide,
  roughness: 0.55,
});
function buildMonstera(g, seed) {
  piece(g, lathe([[0, 0], [0.2, 0], [0.24, 0.04], [0.27, 0.38], [0.29, 0.42], [0, 0.42]], 32), MAT.ceramic);
  piece(g, new THREE.CircleGeometry(0.26, 24).rotateX(-Math.PI / 2), MAT.soil, 0, 0.4, 0);
  const r = seededRandom(seed);
  const leafGeo = new THREE.PlaneGeometry(0.72, 0.72).translate(0, 0.33, 0); // pivot at the stem end
  for (let k = 0; k < 11; k++) {
    const len = 0.55 + r() * 0.45;
    const stem = new THREE.Group();
    stem.position.y = 0.4;
    stem.rotation.set(0.25 + r() * 0.45, (k / 11) * Math.PI * 2 + r() * 0.5, 0, 'YXZ'); // lean out, all around
    piece(stem, new THREE.CylinderGeometry(0.008, 0.012, len, 6).translate(0, len / 2, 0), MAT.stem);
    piece(stem, leafGeo, MONSTERA_LEAF, 0, len, 0).rotation.set(0.35 + r() * 0.4, 0, (r() - 0.5) * 0.6); // held up and outward
    g.add(stem);
  }
  return [0.75, 0.75];
}

// Bentwood hall stand (the Thonet kind every Victorian hallway had): curved legs, a turned post and
// curling hooks, with an overcoat, a bowler hat and a furled umbrella. Made for a back-left corner:
// the coat faces +x, -z.
const COAT_MAT = {
  wool: new THREE.MeshPhysicalMaterial({ color: 0x23293a, roughness: 0.95, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x4a5470) }),
  felt: new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.8 }),
  silk: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45 }),
  horn: new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.3 }),
};
function buildCoatStand(g) {
  const around = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  const bent = (points, radius) => tube(g, points, radius, MAT.mahogany);
  for (let k = 0; k < 4; k++) {
    // legs sweeping out from the post to the floor, ending in a little upturned toe
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    bent([around(a, 0.02, 0.42), around(a, 0.1, 0.26), around(a, 0.22, 0.08), around(a, 0.33, 0.02), around(a, 0.37, 0.05)], 0.018);
    bent([around(a, 0.03, 0.5), around(a, 0.1, 0.56), around(a, 0.17, 0.6)], 0.01); // arms holding the umbrella ring
  }
  piece(g, lathe([[0, 0.3], [0.04, 0.3], [0.045, 0.36], [0.032, 0.42], [0.03, 0.9], [0.042, 0.94], [0.03, 0.98], [0.026, 1.55], [0.04, 1.6], [0.03, 1.64], [0.03, 1.8], [0.045, 1.84], [0, 1.86]], 20), MAT.mahogany);
  piece(g, new THREE.SphereGeometry(0.045, 16, 12), MAT.mahogany, 0, 1.9, 0);
  piece(g, new THREE.TorusGeometry(0.17, 0.012, 8, 40).rotateX(Math.PI / 2), MAT.mahogany, 0, 0.6, 0);
  // hooks: six curling up at the top, and shorter ones just below except where the coat hangs over them
  const coatAngle = -Math.PI / 4; // toward +x, -z: into the room from the corner
  const underCoat = (a) => Math.abs(Math.atan2(Math.sin(a - coatAngle), Math.cos(a - coatAngle))) < 1.4;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    let end = bent([around(a, 0.03, 1.66), around(a, 0.12, 1.7), around(a, 0.19, 1.8), around(a, 0.17, 1.9), around(a, 0.12, 1.88)], 0.012);
    piece(g, new THREE.SphereGeometry(0.018, 10, 8), MAT.mahogany, end.x, end.y, end.z);
    const b = a + Math.PI / 6;
    if (underCoat(b)) continue;
    end = bent([around(b, 0.03, 1.46), around(b, 0.1, 1.48), around(b, 0.14, 1.56), around(b, 0.11, 1.6)], 0.011);
    piece(g, new THREE.SphereGeometry(0.016, 10, 8), MAT.mahogany, end.x, end.y, end.z);
  }

  // overcoat: a lathe-turned body flattened front to back, pressed into soft vertical folds that
  // deepen toward the hem, with sleeves, collar and buttons
  const coat = new THREE.Group();
  coat.position.set(Math.cos(coatAngle) * 0.15, 1.78, Math.sin(coatAngle) * 0.15);
  coat.rotation.y = Math.PI / 2 - coatAngle;
  const L = 1.08;
  const body = lathe([[0, 0], [0.07, -0.01], [0.15, -0.05], [0.18, -0.12], [0.18, -0.35], [0.19, -0.6], [0.23, -0.9], [0.25, -L], [0, -L]], 48);
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const depth = Math.min(1, -pos.getY(i) / L);
    const fold = 1 + depth * (0.06 * Math.sin(a * 7) + 0.03 * Math.sin(a * 13 + 1));
    pos.setXYZ(i, pos.getX(i) * fold, pos.getY(i), pos.getZ(i) * fold * 0.5);
  }
  body.computeVertexNormals();
  piece(coat, body, COAT_MAT.wool);
  piece(coat, new THREE.TorusGeometry(0.1, 0.03, 10, 24, Math.PI * 1.3).rotateX(Math.PI / 2).rotateY(Math.PI * 0.85), COAT_MAT.wool, 0, -0.06, 0.02).scale.set(1, 1, 0.6);
  piece(coat, new THREE.BoxGeometry(0.012, L - 0.25, 0.01), MAT.trim, 0, -0.13 - (L - 0.25) / 2, 0.098);
  for (const by of [-0.32, -0.48, -0.64]) piece(coat, new THREE.SphereGeometry(0.012, 10, 8), COAT_MAT.horn, 0.03, by, 0.1);
  for (const s of [-1, 1]) {
    const sleeve = piece(coat, new THREE.CapsuleGeometry(0.05, 0.5, 6, 14), COAT_MAT.wool, s * 0.19, -0.42, 0.03);
    sleeve.rotation.z = s * 0.06;
    sleeve.scale.set(1, 1, 0.85);
    piece(coat, new THREE.TorusGeometry(0.048, 0.008, 8, 20).rotateX(Math.PI / 2), COAT_MAT.wool, s * 0.205, -0.71, 0.03); // cuff
  }
  g.add(coat);

  // bowler hat on a top hook on the far side
  const hat = new THREE.Group();
  const hatAngle = -Math.PI / 2 - 0.6;
  hat.position.set(Math.cos(hatAngle) * 0.16, 1.86, Math.sin(hatAngle) * 0.16);
  hat.rotation.set(0.25, -hatAngle, 0.35);
  hat.scale.set(1, 1, 1.12);
  piece(hat, new THREE.SphereGeometry(0.095, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), COAT_MAT.felt).scale.y = 0.95;
  piece(hat, new THREE.CylinderGeometry(0.096, 0.098, 0.035, 24), COAT_MAT.felt, 0, -0.015, 0);
  piece(hat, new THREE.CylinderGeometry(0.098, 0.098, 0.02, 24), COAT_MAT.silk, 0, 0.012, 0); // band
  piece(hat, new THREE.TorusGeometry(0.13, 0.012, 8, 32).rotateX(Math.PI / 2), COAT_MAT.felt, 0, -0.032, 0);
  piece(hat, new THREE.CylinderGeometry(0.13, 0.13, 0.006, 32), COAT_MAT.felt, 0, -0.034, 0);
  g.add(hat);

  // furled umbrella standing in the ring: pleated silk around the shaft, a strap, a hooked cane handle
  const umb = new THREE.Group();
  const ua = Math.PI / 5;
  umb.position.set(Math.cos(ua) * 0.15, 0.03, Math.sin(ua) * 0.15);
  umb.rotation.set(Math.sin(ua) * -0.12, 0, Math.cos(ua) * 0.12);
  const canopy = lathe([[0.006, 0.06], [0.02, 0.12], [0.045, 0.3], [0.04, 0.6], [0.022, 0.72], [0.008, 0.76]], 32);
  const cp = canopy.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const pleat = 1 + 0.18 * Math.abs(Math.sin(Math.atan2(cp.getZ(i), cp.getX(i)) * 4));
    cp.setXYZ(i, cp.getX(i) * pleat, cp.getY(i), cp.getZ(i) * pleat);
  }
  canopy.computeVertexNormals();
  piece(umb, canopy, COAT_MAT.silk);
  piece(umb, new THREE.CylinderGeometry(0.004, 0.006, 0.07, 8), MAT.gilt, 0, 0.03, 0); // ferrule
  piece(umb, new THREE.CylinderGeometry(0.008, 0.008, 0.18, 8), MAT.mahogany, 0, 0.84, 0);
  piece(umb, new THREE.TorusGeometry(0.044, 0.006, 6, 20).rotateX(Math.PI / 2), COAT_MAT.silk, 0, 0.42, 0); // strap
  tube(umb, [[0, 0.92, 0], [0, 0.98, 0.01], [0, 1.0, 0.05], [0, 0.97, 0.08], [0, 0.92, 0.075]], 0.011, COAT_MAT.horn);
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
    ctx.font = `600 44px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillText('MUSEUM GUIDE', w / 2, 80);
    ctx.font = `italic 24px ${SERIF}`;
    ctx.fillText('What Trying Costs', w / 2, 116);
    const shapes = ROOMS.map((r) => ({ r, pts: outline(r) }));
    const all = shapes.flatMap((sh) => sh.pts);
    const minX = Math.min(...all.map((p) => p.x));
    const maxX = Math.max(...all.map((p) => p.x));
    const minZ = Math.min(...all.map((p) => p.z));
    const maxZ = Math.max(...all.map((p) => p.z));
    const scale = Math.min((w - 90) / (maxX - minX), (h - 230) / (maxZ - minZ));
    const ox = (w - (maxX - minX) * scale) / 2;
    const map = (p) => [ox + (p.x - minX) * scale, 150 + (p.z - minZ) * scale];
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
        ctx.font = `600 22px ${SERIF}`;
        ctx.fillText(r.name.match(/Gallery (\d)/)?.[1] ?? '', ...map({ x: r.x, z: r.z + 1 }));
      }
    }
    const here = map({ x: room.x, z: room.z + 3 });
    ctx.fillStyle = '#d9583b';
    ctx.beginPath();
    ctx.arc(...here, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8d9b0';
    ctx.font = `italic 20px ${SERIF}`;
    ctx.fillText('you are here', here[0], here[1] + 32);
  });
  for (const [lx, tilt] of [[-0.35, 0.12], [0.35, -0.12]]) piece(g, new THREE.BoxGeometry(0.04, 1.75, 0.04), MAT.mahogany, lx, 0.86, 0.12).rotation.set(-0.12, 0, tilt);
  piece(g, new THREE.BoxGeometry(0.04, 1.6, 0.04), MAT.mahogany, 0, 0.78, -0.3).rotation.x = 0.3;
  piece(g, new THREE.BoxGeometry(0.85, 0.04, 0.08), MAT.mahogany, 0, 0.62, 0.1);
  piece(g, new THREE.BoxGeometry(0.78, 1.04, 0.025), [MAT.mahogany, MAT.mahogany, MAT.mahogany, MAT.mahogany, displayMaterial(board), MAT.mahogany], 0, 1.18, 0.07).rotation.x = -0.12;
  return [0.95, 0.75];
}

// Glass donation box on a mahogany stand.
function buildDonationBox(g) {
  piece(g, new THREE.BoxGeometry(0.42, 0.9, 0.42), MAT.mahogany, 0, 0.45, 0);
  piece(g, new THREE.BoxGeometry(0.38, 0.38, 0.38), MAT.caseGlass, 0, 1.09, 0).renderOrder = 1;
  piece(g, new THREE.BoxGeometry(0.4, 0.03, 0.4), MAT.gilt, 0, 1.295, 0);
  const r = seededRandom('donations');
  for (let k = 0; k < 9; k++) piece(g, new THREE.BoxGeometry(0.14, 0.004, 0.065), MAT.felt, (r() - 0.5) * 0.25, 0.91 + k * 0.012, (r() - 0.5) * 0.25).rotation.y = r() * Math.PI;
  piece(g, new THREE.PlaneGeometry(0.4, 0.08), new THREE.MeshBasicMaterial({ map: plaqueTexture('DONATIONS') }), 0, 0.82, 0.212);
  return [0.5, 0.5];
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
      piece(g, new THREE.BoxGeometry(0.2, 0.26, 0.012), new THREE.MeshStandardMaterial({ color: colors[n++ % colors.length], roughness: 0.6 }), sx, y + 0.03, -0.02 - tier * 0.05).rotation.x = -0.15;
    }
  }
  return [0.62, 0.35];
}

// A line of brass posts joined by velvet ropes (a queue lane), with thin colliders along each rope.
export function buildStanchionLine(room, points) {
  const tops = points.map(([px, pz]) => new THREE.Vector3(room.x + px, 0.9, room.z + pz));
  for (const c of tops) stanchionPost(room, c.x, c.z);
  for (let k = 0; k < tops.length - 1; k++) {
    const [a, b] = [tops[k], tops[k + 1]];
    velvetRope(a, b);
    addCollider((a.x + b.x) / 2, (a.z + b.z) / 2, Math.hypot(b.x - a.x, b.z - a.z), 0.2, Math.atan2(-(b.z - a.z), b.x - a.x));
  }
}

// A Persian rug lying on the floor (nothing to bump into), with a fringe along the short ends.
function buildRug(room, item) {
  const w = item.w ?? 6;
  const d = item.d ?? 4;
  const top = new THREE.MeshPhysicalMaterial({ map: rugTexture(`rug${item.x},${item.z}`), roughness: 1, sheen: 0.8, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x8a4a3a) }); // wool pile
  const side = new THREE.MeshStandardMaterial({ color: 0x5a1815, roughness: 1 });
  const rug = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), [side, side, top, side, side, side]);
  rug.position.set(room.x + (item.x ?? 0), 0.006, room.z + (item.z ?? 0));
  rug.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0);
  rug.receiveShadow = true;
  const fringeTex = canvasTexture(256, 32, (ctx, cw, ch) => {
    const r = seededRandom('fringe');
    for (let fx = 0; fx < cw; fx += 3) {
      ctx.fillStyle = `rgba(235,224,198,${0.7 + r() * 0.3})`;
      ctx.fillRect(fx, 0, 2, ch - r() * 8);
    }
  });
  fringeTex.wrapS = THREE.RepeatWrapping;
  fringeTex.repeat.set(d / 1.5, 1);
  const fringeMat = new THREE.MeshStandardMaterial({ map: fringeTex, transparent: true, alphaTest: 0.3, roughness: 1, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const f = piece(rug, new THREE.PlaneGeometry(d, 0.1), fringeMat, (s * (w + 0.1)) / 2, 0.004, 0);
    f.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  }
  parent.add(rug);
}

// Fabric exhibition banner hanging from a brass rod on two ceiling cables.
function buildBanner(room, item) {
  const W = 1.3;
  const H = 2.8;
  const top = room.height - 0.6;
  const g = new THREE.Group();
  g.position.set(room.x + (item.x ?? 0), 0, room.z + (item.z ?? 0));
  g.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0);
  const geo = new THREE.PlaneGeometry(W, H, 24, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 11) * 0.012); // gentle folds
  geo.computeVertexNormals();
  const cloth = piece(g, geo, new THREE.MeshPhysicalMaterial({ map: bannerTexture(item.title ?? '', item.subtitle ?? '', item.color ?? '#6e1b21'), roughness: 0.85, sheen: 0.5, sheenRoughness: 0.6, side: THREE.DoubleSide }), 0, top - 0.04 - H / 2, 0);
  cloth.castShadow = true;
  piece(g, new THREE.CylinderGeometry(0.018, 0.018, W + 0.16, 12).rotateZ(Math.PI / 2), MAT.gilt, 0, top, 0).castShadow = true;
  for (const s of [-1, 1]) {
    piece(g, new THREE.SphereGeometry(0.035, 14, 10), MAT.gilt, s * (W / 2 + 0.1), top, 0);
    rodBetween(g, new THREE.Vector3(s * (W / 2 - 0.05), top, 0), new THREE.Vector3(s * (W / 2 - 0.05), room.height, 0), 0.003, MAT.metal);
  }
  piece(g, new THREE.CylinderGeometry(0.012, 0.012, W, 8).rotateZ(Math.PI / 2), MAT.gilt, 0, top - 0.04 - H, 0); // weighted hem
  parent.add(g);
}
