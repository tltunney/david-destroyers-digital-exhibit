// Real reflections: once everything has loaded, each room photographs itself in all directions from
// its middle (a cube camera), and the shiny things in that room (brass, gilt, glass, polished stone
// and wood, the statue) reflect that photo instead of a generic studio. So the rotunda's marble floor
// shows the red walls and columns around it, and the gallery glass shows the gallery.
import * as THREE from 'three';
import { renderer, scene, SMALL_SCREEN } from './engine.js';
import { materialCopies, setGlassQuality } from './materials.js';

// rooms: [{ room, group }]. Waits for textures and models to finish loading, then captures.
export function captureReflectionsWhenLoaded(rooms) {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    requestAnimationFrame(() => capture(rooms)); // one frame so new textures are on the GPU
  };
  THREE.DefaultLoadingManager.onLoad = go;
  setTimeout(go, 12000); // don't wait forever on a slow connection
}

function capture(rooms) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = new THREE.WebGLCubeRenderTarget(SMALL_SCREEN ? 128 : 256, { type: THREE.HalfFloatType });
  const cubeCamera = new THREE.CubeCamera(0.1, 120, target);
  scene.add(cubeCamera);
  for (const { room, group } of rooms) {
    // stand the camera in the room, at about where reflections are seen from; only that room is
    // drawn, which keeps this quick (doorways show the dark background, which reads as shadow)
    for (const other of rooms) other.group.visible = other.group === group;
    cubeCamera.position.set(room.x, room.shape === 'octagon' ? 3 : 1.8, room.z);
    cubeCamera.update(renderer, scene);
    const env = pmrem.fromCubemap(target.texture).texture;
    const copies = new Map(); // each shared material gets one copy per room
    group.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const swap = (m) => {
        // pictures and text (self-lit) don't need it, and their edit hooks point at the originals
        if (!m.isMeshStandardMaterial || m.emissiveMap || m.envMap) return m;
        if (!copies.has(m)) {
          const copy = Object.assign(m.clone(), { envMap: env });
          copies.set(m, copy);
          materialCopies.set(m, [...(materialCopies.get(m) ?? []), copy]);
        }
        return copies.get(m);
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }
  for (const { group } of rooms) group.visible = true;
  scene.remove(cubeCamera);
  target.dispose();
  pmrem.dispose();
  setGlassQuality(); // the copies take the current glass setting
}
