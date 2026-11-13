// The rotunda: an octagonal domed hall with damask walls over mahogany wainscot, marble columns at the
// corners, an inlaid marble floor, and a coffered dome open to the sky through an oculus.
import * as THREE from 'three';
import { HALF_WALL, ROOM_LIGHT, compass, parent, frame, buildInto, addCollider, animators } from './world.js';
import { SMALL_SCREEN } from './engine.js';
import { surfaceMaps, surfaceCanvas } from './textures.js';
import { MAT } from './materials.js';
import { canvasTexture, seededRandom } from './util.js';
import { rotundaAO } from './ao.js';
import { buildWall } from './rooms.js';
import { buildExhibit } from './exhibits.js';
import { buildDecor } from './furniture.js';

export function buildRotunda(room, group) {
  const a = room.apothem;
  const H = room.height;
  const R = a / Math.cos(Math.PI / 8); // center to corner
  const faceW = 2 * a * Math.tan(Math.PI / 8);
  const roomPlace = { ...frame };

  const floorMat = new THREE.MeshPhysicalMaterial({ map: floorTexture(room, R), roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.08 }); // polished stone
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 8, Math.PI / 8), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  parent.add(floor);

  // the eight walls, each built like the north wall of a narrow room turned to face the center
  const faceItems = {};
  for (const ex of room.exhibits ?? []) {
    if (ex.face === undefined) continue;
    (faceItems[((ex.face % 360) + 360) % 360] ??= []).push({ ...ex, wall: 'north' });
  }
  for (let k = 0; k < 8; k++) {
    const deg = k * 45;
    const faceGroup = new THREE.Group();
    faceGroup.rotation.y = -THREE.MathUtils.degToRad(deg);
    group.add(faceGroup);
    buildInto(faceGroup, { ...roomPlace, rot: -THREE.MathUtils.degToRad(deg) });
    const openings = room.openings.filter((o) => ((o.angle % 360) + 360) % 360 === deg);
    const face = Object.assign(Object.create(room), {
      x: 0, z: 0, w: faceW, d: 2 * a,
      doors: { north: openings.map((o) => ({ at: 0, width: o.width, to: o.to, label: o.label })), south: [], east: [], west: [] },
      exhibits: faceItems[deg] ?? [],
    });
    buildWall(face, 'north');
    for (const ex of face.exhibits) buildExhibit(face, ex);
  }
  buildInto(group, roomPlace);

  buildColumns(room, R, H);
  const { topY, oculusR } = buildDome(a, H, R);
  buildDaylight(topY, oculusR);

  // a warm room light plus daylight from the oculus
  const warm = new THREE.PointLight(0xffd9a8, ROOM_LIGHT * 1.7, R * 2.2, 1);
  warm.position.set(0, H - 1.5, 0);
  const daylight = new THREE.SpotLight(0xfff4e0, 30, topY + 4, 0.55, 0.7, 1);
  daylight.position.set(0, topY, 0);
  daylight.target.position.set(0, 0, 0);
  parent.add(warm, daylight, daylight.target);

  // the statue, the display cases, and the furniture
  for (const ex of room.exhibits ?? []) if (ex.face === undefined) buildExhibit(room, ex);
  for (const item of room.decor ?? []) buildDecor(room, item);

  floorMat.aoMap = rotundaAO(room, R, faceW);
  floorMat.needsUpdate = true;
}

// Inlaid marble floor: cream stone slabs with a sixteen-point star medallion and a dark border.
function floorTexture(room, R) {
  const S = SMALL_SCREEN ? 1024 : 2048;
  const ppm = S / (2 * R);
  return canvasTexture(S, S, (ctx) => {
    const c = S / 2;
    const at = (deg, r) => {
      const d = compass(deg);
      return [c + d.x * r * ppm, c + d.z * r * ppm];
    };
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
      ctx.beginPath();
      poly([at(deg - 11.25, 1.9), at(deg, k % 2 ? 3.2 : 4.45), at(deg + 11.25, 1.9)]);
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

// Marble columns in the corners, with gilt capitals.
function buildColumns(room, R, H) {
  const shaftH = H - 1.15;
  const columnMat = new THREE.MeshPhysicalMaterial({ ...surfaceMaps('marble', '#ece6da', 1, 2), roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.2 });
  const parts = [
    [new THREE.BoxGeometry(1, 0.28, 1), columnMat, 0.14], // plinth
    [new THREE.CylinderGeometry(0.42, 0.46, 0.16, 32), columnMat, 0.36], // base
    [new THREE.CylinderGeometry(0.31, 0.35, shaftH, 32), columnMat, 0.44 + shaftH / 2], // shaft
    [new THREE.TorusGeometry(0.33, 0.04, 12, 32).rotateX(Math.PI / 2), MAT.gilt, 0.46 + shaftH], // ring
    [new THREE.CylinderGeometry(0.5, 0.36, 0.3, 32), MAT.gilt, 0.6 + shaftH], // capital
    [new THREE.BoxGeometry(1.05, 0.14, 1.05), columnMat, 0.82 + shaftH], // abacus
  ];
  for (let k = 0; k < 8; k++) {
    const deg = 22.5 + k * 45;
    const d = compass(deg);
    const dist = R - 0.95;
    const rot = -THREE.MathUtils.degToRad(deg);
    const col = new THREE.Group();
    col.position.set(d.x * dist, 0, d.z * dist);
    col.rotation.y = rot;
    for (const [geo, mat, y] of parts) {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.castShadow = m.receiveShadow = true;
      col.add(m);
    }
    parent.add(col);
    addCollider(d.x * dist, d.z * dist, 1, 1, rot);
    room.footprints.push({ x: d.x * dist, z: d.z * dist, w: 1, d: 1, rot });
  }
}

// Coffered dome: rows of recessed square panels with gilt rosettes, open at the top.
function buildDome(a, H, R) {
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
  const domeRing = new THREE.Mesh(new THREE.TorusGeometry(domeR, 0.14, 12, 128).rotateX(Math.PI / 2), MAT.gilt);
  domeRing.position.y = H - 0.05;
  parent.add(capMesh, domeRing);

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
  return { topY, oculusR };
}

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

// A faint shaft of daylight falling from the oculus, with dust drifting slowly through it.
function buildDaylight(topY, oculusR) {
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

  const motes = SMALL_SCREEN ? 140 : 320;
  const home = new Float32Array(motes * 4);
  const pos = new Float32Array(motes * 3);
  for (let i = 0; i < motes; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * oculusR * 1.15;
    home.set([Math.cos(a) * rr, Math.random() * (topY - 1), Math.sin(a) * rr, Math.random() * 100], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sprite = canvasTexture(32, 32, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,245,225,1)');
    g.addColorStop(1, 'rgba(255,245,225,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const dust = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, map: sprite, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.frustumCulled = false;
  parent.add(dust);
  const span = topY - 1;
  animators.push((t) => {
    for (let i = 0; i < motes; i++) {
      const [hx, hy, hz, seed] = home.subarray(i * 4, i * 4 + 4);
      pos[i * 3] = hx + Math.sin(t * 0.13 + seed) * 0.35;
      pos[i * 3 + 1] = 0.5 + ((hy - t * 0.05 + span) % span);
      pos[i * 3 + 2] = hz + Math.cos(t * 0.11 + seed * 1.3) * 0.35;
    }
    geo.attributes.position.needsUpdate = true;
  });
}
