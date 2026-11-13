// The renderer, scene and camera everything else draws into.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const SMALL_SCREEN = window.matchMedia('(pointer: coarse)').matches; // phones and tablets
export const EYE_HEIGHT = 1.7;

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e12);
// a neutral studio light for reflections until each room has captured its own (see reflections.js)
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

// near/far kept tight so phones can tell apart surfaces that sit close together (art, mat, wall)
export const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.12, 120);
camera.rotation.order = 'YXZ';
camera.position.y = EYE_HEIGHT;

export const MAX_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();
