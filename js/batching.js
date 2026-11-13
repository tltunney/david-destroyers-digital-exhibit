// Fewer draw calls for phones: once a room is built, its small static parts that share a material
// (brass posts, gilt trim, chandelier pieces, mouldings, furniture) are merged into one mesh per
// material. Anything that can be clicked, moves, changes, or is see-through stays separate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { blockers } from './world.js';

const keep = (mesh) => {
  if (!mesh.isMesh || mesh.isInstancedMesh || Array.isArray(mesh.material)) return true;
  const m = mesh.material;
  if ((m.transparent && !m.userData.mergeable) || m.emissiveMap || m.transmission) return true; // glass, decals, pictures and text
  if (mesh.userData.exhibit || blockers.includes(mesh)) return true; // clicked, or blocks clicks
  for (let o = mesh; o; o = o.parent) if (o.userData.dynamic || !o.visible) return true;
  return false;
};

export function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const batches = new Map(); // material + shadow flags -> meshes
  group.traverse((mesh) => {
    if (keep(mesh)) return;
    const key = `${mesh.material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(mesh);
  });
  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      // same attributes on every piece: position, normal, uv; indexed
      let g = mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.clone().setIndex([...Array(mesh.geometry.attributes.position.count).keys()]);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.morphAttributes = {};
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toGroup, mesh.matrixWorld));
    });
    const merged = mergeGeometries(geometries, false);
    if (!merged) continue; // incompatible pieces: leave them as they are
    const one = new THREE.Mesh(merged, meshes[0].material);
    one.castShadow = meshes[0].castShadow;
    one.receiveShadow = meshes[0].receiveShadow;
    group.add(one);
    for (const mesh of meshes) mesh.removeFromParent();
    for (const g of geometries) g.dispose();
  }
}
