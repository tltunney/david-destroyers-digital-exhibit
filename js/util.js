// Small helpers shared by the builders: canvas textures, repeatable randomness, text wrapping,
// and adding simple meshes to a group.
import * as THREE from 'three';
import { MAX_ANISOTROPY } from './engine.js';

export const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
export const SERIF = 'Georgia, "Times New Roman", serif';

// A texture painted on a 2D canvas by draw(ctx, width, height).
export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = MAX_ANISOTROPY;
  return tex;
}

// The same "random" numbers every time for the same seed text, so the museum looks the same on every visit.
export function seededRandom(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// A CSS color made lighter (+) or darker (-).
export const shade = (color, amount) => '#' + new THREE.Color(color).offsetHSL(0, 0, amount).getHexString();

// Splits text into lines that fit maxWidth with the canvas's current font. Keeps line breaks.
export function wrapText(ctx, text, maxWidth) {
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

// Adds a mesh to a group at a position, and returns it.
export function piece(group, geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

// A thin rod between two points (cords, cables, chains).
export function rodBetween(group, a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 6), material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  group.add(m);
  return m;
}

// A smooth tube along points [[x, y, z], ...]; returns where it ends.
export function tube(group, points, radius, material, segments = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 8), material));
  return curve.getPoint(1);
}

// A shape turned on a lathe from [[radius, height], ...].
export const lathe = (profile, segments = 24) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
