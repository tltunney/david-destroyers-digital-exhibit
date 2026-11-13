// Materials shared across the museum, and the helpers for pictures, decals and wall lighting.
import * as THREE from 'three';
import { surfaceMaps } from './textures.js';
import { canvasTexture } from './util.js';

const physicalGlass = (color, opacity) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.02, metalness: 0, ior: 1.5, thickness: 0.01, transparent: true, opacity, depthWrite: false, envMapIntensity: 1.4 });

export const MAT = {
  frame: new THREE.MeshStandardMaterial({ color: 0xb48a5c, roughness: 0.45 }),
  oak: new THREE.MeshStandardMaterial({ color: 0xc19a6b, roughness: 0.55 }),
  passepartout: new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.95 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x2f2a25, roughness: 0.6 }),
  pedestal: new THREE.MeshStandardMaterial({ ...surfaceMaps('plaster', '#f4f2ed', 0.5, 0.5), roughness: 1 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35, metalness: 0.85 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a35a, roughness: 0.25, metalness: 1 }),
  rope: new THREE.MeshStandardMaterial({ color: 0x5c0f16, roughness: 0.85 }),
  leather: new THREE.MeshStandardMaterial({ ...surfaceMaps('leather', '#3a2a20', 4.8, 1.2), roughness: 1 }),
  mahogany: new THREE.MeshPhysicalMaterial({ color: 0x4a2216, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.25 }), // french-polished
  gilt: new THREE.MeshStandardMaterial({ color: 0xc9a24f, roughness: 0.3, metalness: 1 }),
  plasterwork: new THREE.MeshStandardMaterial({ ...surfaceMaps('plaster', '#efe6d4', 1, 1), roughness: 1 }),
  velvet: new THREE.MeshPhysicalMaterial({ ...surfaceMaps('tufted', '#1d3b2a', 4.4, 1.5), roughness: 1, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0x4f7a62) }),
  gaslight: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 0.95) }),
  counterTop: new THREE.MeshStandardMaterial({ ...surfaceMaps('marble', '#e6dfd2', 2, 0.5), roughness: 1 }),
  felt: new THREE.MeshStandardMaterial({ color: 0x23402f, roughness: 0.95 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xf3ecdc, roughness: 0.9 }),
  bookCover: new THREE.MeshStandardMaterial({ color: 0x5c1a1e, roughness: 0.6 }),
  bankerGreen: new THREE.MeshStandardMaterial({ color: 0x1f6b3a, emissive: 0x0b3a1c, roughness: 0.15, side: THREE.DoubleSide }),
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0x2c5a4c, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }), // glazed
  stem: new THREE.MeshStandardMaterial({ color: 0x3e7a3b, roughness: 0.7 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x3b2a1d, roughness: 1 }),
  // glass: real see-through refraction on high graphics (see setGlassQuality), plain transparency on phones
  glass: physicalGlass(0xdfe8ee, 0.25),
  caseGlass: physicalGlass(0xeef4f2, 0.22),
  // brighter than white so the light strips glow (and bloom) after tone mapping
  light: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.85, 2.6) }),
  sky: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2.1) }),
};

// Per-room copies of shared materials (made by reflections.js), so settings reach them too.
export const materialCopies = new Map();
const withCopies = (m) => [m, ...(materialCopies.get(m) ?? [])];

// High graphics: glass refracts what is behind it. Standard: lighter, plain transparency.
let glassHigh = false;
export function setGlassQuality(high = glassHigh) {
  glassHigh = high;
  for (const m of [MAT.glass, MAT.caseGlass].flatMap(withCopies)) {
    m.transmission = high ? 1 : 0;
    m.opacity = high ? 1 : 0.24;
    m.needsUpdate = true;
  }
}

// Material that stays readable regardless of lighting (art, labels, wall text).
// `layer` nudges it in front of whatever it sits on, so the two never flicker on phones.
export function displayMaterial(map, layer = 0) {
  return new THREE.MeshStandardMaterial({
    map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.85,
    polygonOffset: layer > 0, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer,
  });
}

// Swaps the picture shown by a display material.
export function setMap(material, tex) {
  if (material.map && material.map !== tex) material.map.dispose();
  material.map = tex;
  material.emissiveMap = tex;
  material.needsUpdate = true;
}

// Fits a photo inside a frame of the given shape without stretching it; any spare space is `bg`.
export function fitPhoto(url, aspect, bg, onReady) {
  const img = new Image();
  img.onload = () => {
    const W = aspect >= 1 ? 1536 : Math.round(1536 * aspect);
    const H = Math.round(W / aspect);
    onReady(
      canvasTexture(W, H, (ctx) => {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        const k = Math.min(W / img.naturalWidth, H / img.naturalHeight);
        const dw = img.naturalWidth * k;
        const dh = img.naturalHeight * k;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }),
    );
  };
  img.onerror = () => console.warn(`Could not load image "${url}".`);
  img.src = url;
}

// ---------------------------------------------------------------- decals
// Paints only the blurred shadow of a shape (the shape itself is drawn far off the canvas).
export function softShadow(ctx, drawShape, blur, alpha) {
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

// A pool of warm light thrown onto the wall by a ceiling spotlight (brightest at the top, fading down).
export const WASH_TEX = canvasTexture(256, 512, (ctx, w, h) => {
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

// The warm glow a gas lamp throws on the wall behind it.
export const GLOW_TEX = canvasTexture(256, 256, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,214,150,0.9)');
  g.addColorStop(0.4, 'rgba(255,200,130,0.3)');
  g.addColorStop(1, 'rgba(255,200,130,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
});

export function decal(map, w, h, { additive = false, opacity = 1, layer = 1 } = {}) {
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
export function addWallLighting(group, w, h, washWidth = w + 1.8, withWash = true) {
  const scale = 1 / (1 - 2 * SHADOW_INSET);
  const shadow = decal(SHADOW_TEX, w * scale, h * scale, { opacity: 0.5, layer: 1 });
  shadow.position.set(0, -0.05, 0.012);
  group.add(shadow);
  if (!withWash) return;
  const wash = decal(WASH_TEX, washWidth, h + 2.6, { additive: true, opacity: 0.42, layer: 2 });
  wash.position.set(0, 0.35, 0.022);
  group.add(wash);
}
