// Procedural surface textures, generated once when the page loads.
// Each surface gets three maps:
//   map           the color
//   normalMap     tiny bumps and grooves, so light catches the grain and seams
//   roughnessMap  where the surface is shiny (polished) or matte
// All of them tile seamlessly.
import * as THREE from 'three';

const SMALL = window.matchMedia('(pointer: coarse)').matches; // phones/tablets get lighter textures

function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise on a lattice that wraps after px × py cells, so it tiles.
function tileNoise(seed, px, py) {
  const r = random(seed);
  const grid = Float32Array.from({ length: px * py }, r);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const x0 = ((xi % px) + px) % px;
    const y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = grid[y0 * px + x0];
    const b = grid[y0 * px + x1];
    const c = grid[y1 * px + x0];
    const d = grid[y1 * px + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// Layered noise (fractal) over the unit square; returns roughly 0..1. Tiles seamlessly.
function fractal(seed, px, py, octaves = 4) {
  const layers = Array.from({ length: octaves }, (_, i) => ({
    noise: tileNoise(seed + i * 977, px * 2 ** i, py * 2 ** i),
    sx: px * 2 ** i,
    sy: py * 2 ** i,
    amp: 0.5 ** i,
  }));
  const norm = layers.reduce((sum, l) => sum + l.amp, 0);
  return (u, v) => {
    let sum = 0;
    for (const l of layers) sum += l.noise(u * l.sx, v * l.sy) * l.amp;
    return sum / norm;
  };
}

// [r, g, b] in 0..255 for any CSS color
function rgb(color) {
  const hex = new THREE.Color(color).getHexString();
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function dataTexture(data, w, h, srgb) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Runs `sample(u, v)` for every pixel. It returns [r, g, b] (0..255), height (0..1) and roughness (0..1).
function surface(w, h, sample, bumpStrength = 2) {
  const color = new Uint8Array(w * h * 4);
  const rough = new Uint8Array(w * h * 4);
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const [r, g, b, ht, ro] = sample(x / w, y / h, x, y);
      color[i * 4] = r;
      color[i * 4 + 1] = g;
      color[i * 4 + 2] = b;
      color[i * 4 + 3] = 255;
      height[i] = ht;
      const rv = Math.max(0, Math.min(255, ro * 255));
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = rv;
      rough[i * 4 + 3] = 255;
    }
  }
  // normal map from the height map (slopes between neighbouring pixels, wrapping at the edges)
  const normal = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = height[y * w + ((x - 1 + w) % w)];
      const r = height[y * w + ((x + 1) % w)];
      const d = height[((y - 1 + h) % h) * w + x];
      const u = height[((y + 1) % h) * w + x];
      let nx = (l - r) * bumpStrength;
      let ny = (d - u) * bumpStrength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      normal[i] = ((nx / len) * 0.5 + 0.5) * 255;
      normal[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      normal[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }
  return {
    map: dataTexture(color, w, h, true),
    normalMap: dataTexture(normal, w, h, false),
    roughnessMap: dataTexture(rough, w, h, false),
  };
}

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const tint = ([r, g, b], k) => [clamp255(r * k), clamp255(g * k), clamp255(b * k)];

// ---------------------------------------------------------------- surfaces

// Lacquered plank floor. One tile = 2 m × 2 m: 11 rows of long boards with staggered end joints.
function woodFloor(color) {
  const size = SMALL ? 512 : 1024;
  const base = rgb(color);
  const rows = 11;
  const r = random(11);
  const rowOffset = Array.from({ length: rows }, () => r());
  const boardTone = Array.from({ length: rows }, () => 0.84 + r() * 0.3);
  const boardShift = Array.from({ length: rows }, () => r() * 50);
  const grain = fractal(21, 3, 60, 4);
  const fine = fractal(31, 64, 64, 2);
  const groovePx = size / 512;
  return surface(size, size, (u, v) => {
    const row = Math.floor(v * rows);
    const fy = v * rows - row;
    const fx = (u + rowOffset[row]) % 1; // one 2 m board per row, joints staggered
    const board = row;
    const g = grain(u, v + boardShift[board] / 60);
    const figure = Math.sin((fy * 2.5 + g * 7 + boardShift[board]) * Math.PI * 2) * 0.5 + 0.5;
    const edge = Math.min(Math.min(fy, 1 - fy) * (size / rows), Math.min(fx, 1 - fx) * size);
    if (edge < groovePx) return [...tint(base, 0.68), 0, 0.9];
    const bevel = Math.min(1, edge / (groovePx * 3));
    const streak = Math.pow(figure, 3);
    const k = boardTone[board] * (0.8 + g * 0.32 - streak * 0.1 + (fine(u, v) - 0.5) * 0.06);
    const c = tint(base, k * (0.9 + bevel * 0.1));
    c[2] = clamp255(c[2] - streak * 10); // darker grain lines are warmer
    return [...c, 0.6 + bevel * 0.4 + g * 0.05, 0.3 + g * 0.2];
  }, 3);
}

// Sealed, polished concrete. One tile = 4 m × 4 m with a saw-cut joint at the edge.
function concrete(color) {
  const size = SMALL ? 512 : 1024;
  const base = rgb(color);
  const cloud = fractal(41, 3, 3, 5);
  const fine = fractal(51, 96, 96, 2);
  const speck = tileNoise(61, 400, 400);
  return surface(size, size, (u, v, x, y) => {
    if (x < 2 || y < 2) return [...tint(base, 0.72), 0, 0.8];
    const c = cloud(u, v);
    const f = fine(u, v);
    const s = speck(u * 400, v * 400);
    let k = 0.9 + c * 0.18 + (f - 0.5) * 0.06;
    if (s > 0.86) k *= 0.88;
    else if (s < 0.1) k *= 1.06;
    return [...tint(base, k), 0.5 + f * 0.08, 0.22 + c * 0.38];
  }, 1.5);
}

// Painted plaster wall: almost flat, with a faint orange-peel texture. One tile = 2 m.
function plaster(color) {
  const size = 512;
  const base = rgb(color);
  const cloud = fractal(71, 6, 6, 4);
  const peel = fractal(81, 48, 48, 2);
  return surface(size, size, (u, v) => {
    const k = 0.985 + cloud(u, v) * 0.03;
    return [...tint(base, k), peel(u, v) * 0.5, 0.86 + cloud(u, v) * 0.08];
  }, 0.5);
}

// Vertical oak slats with deep shadow gaps. One tile = 1 m wide (8 slats) × 2.5 m tall.
function slats(color) {
  const w = SMALL ? 256 : 512;
  const h = w * 2;
  const base = rgb(color);
  const r = random(91);
  const tone = Array.from({ length: 8 }, () => 0.9 + r() * 0.2);
  const shift = Array.from({ length: 8 }, () => r() * 40);
  const grain = fractal(101, 60, 3, 4);
  return surface(w, h, (u, v) => {
    const idx = Math.floor(u * 8);
    const fu = u * 8 - idx;
    if (fu < 0.13 || fu > 0.87) return [...tint(base, 0.28), 0, 0.95];
    const edge = Math.min(fu - 0.13, 0.87 - fu) / 0.1;
    const round = Math.min(1, edge);
    const g = grain(u + shift[idx] / 60, v);
    const k = tone[idx] * (0.86 + g * 0.26) * (0.8 + round * 0.2);
    return [...tint(base, k), 0.4 + round * 0.6, 0.5 + g * 0.15];
  }, 4);
}

// Polished white marble, Carrara-like: a soft cloudy ground with grey veins that wander, fork and fade,
// made by bending a pattern of lines with layered noise (the way the stone itself formed).
// The vein pattern is worked out once and shared by every marble color.
let marbleField = null;
function marblePattern(size) {
  if (marbleField) return marbleField;
  const warpA = fractal(111, 3, 3, 4);
  const warpB = fractal(113, 3, 3, 4);
  const cloud = fractal(117, 2, 2, 3);
  const fine = fractal(121, 40, 40, 2);
  const shade = new Float32Array(size * size);
  const veins = new Float32Array(size * size);
  const glossy = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const a = warpA(u, v);
      const b = warpB(u, v);
      const f = fine(u, v);
      const cl = cloud(u, v);
      // main veins run diagonally, bent twice by the noise
      const main = Math.abs(Math.sin(Math.PI * ((u + v) * 2 + a * 2.6 + b * 1.4)));
      const vein = Math.pow(1 - main, 30) * (0.45 + b * 0.8); // thin, stronger in places, fading in others
      const halo = Math.pow(1 - main, 6) * 0.35; // the soft grey bleed around each vein
      // finer cross veins
      const cross = Math.abs(Math.sin(Math.PI * ((u * 3 - v * 2) * 2 + a * 4 + f * 1.5)));
      const thread = Math.pow(1 - cross, 60) * 0.5;
      const i = y * size + x;
      shade[i] = 1 - Math.min(0.5, vein * 0.42 + halo * 0.07 + thread * 0.22) - (cl - 0.5) * 0.07 + (f - 0.5) * 0.02;
      veins[i] = vein + halo;
      glossy[i] = 0.12 + vein * 0.14 + cl * 0.06;
    }
  }
  marbleField = { size, shade, veins, glossy };
  return marbleField;
}
function marble(color) {
  const { size, shade, veins, glossy } = marblePattern(SMALL ? 256 : 512);
  const base = rgb(color);
  return surface(size, size, (u, v, x, y) => {
    const i = y * size + x;
    const c = tint(base, shade[i]);
    c[2] = clamp255(c[2] + veins[i] * 8); // grey veins lean cool against warm white
    return [...c, 0.5 - veins[i] * 0.08, glossy[i]];
  }, 0.5);
}

// Pebbled leather for bench cushions. One tile = 0.5 m.
function leather(color) {
  const size = 256;
  const base = rgb(color);
  const pebble = fractal(131, 40, 40, 3);
  const cloud = fractal(141, 3, 3, 3);
  return surface(size, size, (u, v) => {
    const p = pebble(u, v);
    return [...tint(base, 0.92 + cloud(u, v) * 0.14 + (p - 0.5) * 0.05), p, 0.48 + p * 0.2];
  }, 2.5);
}

// ---------------------------------------------------------------- Victorian surfaces

// Silk damask wallpaper: the motif is the same color as the ground but shinier, the way real damask
// catches light. One tile = 0.7 m, with two motifs in a half-drop repeat.
function damask(color) {
  const size = SMALL ? 256 : 512;
  const base = rgb(color);
  const cloud = fractal(151, 4, 4, 3);
  const thread = fractal(161, 128, 128, 1);
  const motif = (x, y) => {
    const ax = Math.abs(x); // mirror-symmetric, like a woven pattern
    if (Math.abs(y) < 0.4 && ax < 0.11 * (1 - (y / 0.4) ** 2)) return 1; // central leaf
    const ring = Math.hypot(ax - 0.19, y + 0.1);
    if (ring > 0.055 && ring < 0.085) return 1; // scrolls
    if (((ax - 0.23) / 0.11) ** 2 + ((y - 0.17) / 0.05) ** 2 < 1) return 1; // side leaves
    if (Math.hypot(x, y + 0.43) < 0.045) return 1; // bud
    if (((ax - 0.08) / 0.08) ** 2 + ((y - 0.38) / 0.03) ** 2 < 1) return 1; // base flourish
    return 0;
  };
  return surface(size, size, (u, v) => {
    const center = motif((u - 0.5) * 2, (v - 0.5) * 2);
    const corner = motif((((u + 0.5) % 1) - 0.5) * 2, (((v + 0.5) % 1) - 0.5) * 2);
    const m = Math.max(center, corner);
    const t = thread(u, v);
    const k = (m ? 1.14 : 0.94) * (0.97 + cloud(u, v) * 0.06) * (0.98 + t * 0.04);
    return [...tint(base, k), m * 0.5 + t * 0.06, m ? 0.36 : 0.78];
  }, 1.2);
}

// Polished mahogany wainscot: one raised panel per tile (1 m wide × 1.1 m tall) inside a frame.
function wainscot(color) {
  const size = SMALL ? 256 : 512;
  const base = rgb(color);
  const grain = fractal(171, 40, 3, 4);
  const frame = 0.13;
  const bevel = 0.06;
  return surface(size, size, (u, v) => {
    const edge = Math.min(u, 1 - u, v, 1 - v); // distance from the tile edge
    const g = grain(u, v);
    let h;
    let k;
    if (edge < frame) {
      h = 1; // stiles and rails
      k = 1;
    } else if (edge < frame + 0.012) {
      h = 0.5; // shadow line where the panel meets the frame
      k = 0.6;
    } else if (edge < frame + bevel) {
      const t = (edge - frame - 0.012) / (bevel - 0.012);
      h = 0.55 + t * 0.35; // bevel rising to the panel field
      k = 0.82 + t * 0.12;
    } else {
      h = 0.92; // raised field
      k = 1.04;
    }
    const c = tint(base, k * (0.82 + g * 0.3));
    return [...c, h, 0.3 + g * 0.12];
  }, 7);
}

// Button-tufted velvet for settees. One tile = 0.5 m: a diamond grid of puffs pinned by buttons.
function tufted(color) {
  const size = 256;
  const base = rgb(color);
  const nap = fractal(181, 64, 64, 2);
  return surface(size, size, (u, v) => {
    const a = Math.sin(Math.PI * 2 * (u + v));
    const b = Math.sin(Math.PI * 2 * (u - v));
    const puff = Math.sqrt(Math.abs(a * b)); // 0 along the creases, 1 in the middle of each diamond
    const button = Math.abs(a) < 0.12 && Math.abs(b) < 0.12;
    const k = button ? 0.45 : (0.62 + puff * 0.45) * (0.96 + nap(u, v) * 0.08);
    return [...tint(base, k), button ? 0 : puff, button ? 0.4 : 0.85 - puff * 0.15];
  }, 4);
}

const GENERATORS = { wood: woodFloor, concrete, plaster, slats, marble, leather, damask, wainscot, tufted };

// Photographed surfaces (assets/textures). The photo has one natural color; each room's color is
// reached by tinting it, so `avg` is the photo's average color. Phones load half-size copies.
const PHOTOS = {
  wood: { name: 'hardwood2', maps: { map: 'diffuse', bumpMap: 'bump', roughnessMap: 'roughness' }, avg: [217, 172, 122], bumpScale: 3 },
};
const loader = new THREE.TextureLoader();
const photoCache = new Map();
function photoSet(kind) {
  if (photoCache.has(kind)) return photoCache.get(kind);
  const photo = PHOTOS[kind];
  const set = { textures: {}, waiting: [] };
  for (const [slot, file] of Object.entries(photo.maps)) {
    const url = `assets/textures/${photo.name}_${file}${SMALL ? '_s' : ''}.jpg`;
    const tex = loader.load(url, () => {
      // copies handed out before the photo arrived get it now
      for (const w of set.waiting) {
        if (w.slot !== slot) continue;
        w.copy.source = tex.source;
        w.copy.needsUpdate = true;
      }
    }, undefined, () => console.warn(`Could not load ${url}; the floor will look plain.`));
    set.textures[slot] = tex;
  }
  photoCache.set(kind, set);
  return set;
}
function photoMaps(kind, color, repeatX, repeatY) {
  const photo = PHOTOS[kind];
  const set = photoSet(kind);
  const out = {};
  for (const [slot, tex] of Object.entries(set.textures)) {
    const copy = new THREE.Texture();
    copy.wrapS = copy.wrapT = THREE.RepeatWrapping;
    copy.anisotropy = 8;
    if (slot === 'map') copy.colorSpace = THREE.SRGBColorSpace;
    copy.repeat.set(repeatX, repeatY);
    if (tex.image) {
      copy.source = tex.source;
      copy.needsUpdate = true;
    } else set.waiting.push({ slot, copy });
    out[slot] = copy;
  }
  const target = rgb(color);
  out.color = new THREE.Color().setRGB(...target.map((c, i) => Math.min(1, c / photo.avg[i])), THREE.SRGBColorSpace);
  out.bumpScale = photo.bumpScale;
  return out;
}

const cache = new Map();

// Returns { map, normalMap, roughnessMap } for a surface type and color (photographed surfaces also
// return a tint color and use a bump map instead of a normal map).
// The textures are generated once and cached; the copies returned can each get their own repeat.
export function surfaceMaps(kind, color, repeatX = 1, repeatY = 1) {
  if (PHOTOS[kind]) return photoMaps(kind, color, repeatX, repeatY);
  const key = `${kind}:${color}`;
  if (!cache.has(key)) cache.set(key, (GENERATORS[kind] ?? plaster)(color));
  const set = cache.get(key);
  const out = {};
  for (const [name, tex] of Object.entries(set)) {
    const copy = tex.clone(); // shares the same image, so no extra memory
    copy.repeat.set(repeatX, repeatY);
    out[name] = copy;
  }
  return out;
}

// How big one texture tile is in meters, so surfaces line up with real-world scale.
export const TILE_SIZE = {
  wood: [2.24, 1.12], concrete: [4, 4], plaster: [2, 2], slats: [1, 2.5], marble: [1, 1], leather: [0.5, 0.5],
  damask: [0.7, 0.7], wainscot: [1, 1.1], tufted: [0.5, 0.5],
};

export const SMALL_SCREEN = SMALL;

// A generated surface's color as a canvas (to paint it into other textures, like the rotunda floor).
export function surfaceCanvas(kind, color) {
  const { map } = surfaceMaps(kind, color);
  const { data, width, height } = map.image;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}
