import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/Addons.js';
import { MTLLoader } from 'three/examples/jsm/Addons.js';

export const ARENA_WIDTH = 1024;
export const ARENA_HEIGHT = 900;
export const DIE_SIZE = 32;
export const MAX_STEPS = 400;
export const WALL_THICKNESS = 12;
export const MIN_ROLL_DURATION = 1000;
export const MAX_ROLL_DURATION = 2500;

export const DICE_FACE_NORMALS = {
  4: [
    { value: 1, normal: new THREE.Vector3(0.577, 0.577, 0.577) },
    { value: 2, normal: new THREE.Vector3(-0.577, -0.577, 0.577) },
    { value: 3, normal: new THREE.Vector3(0.577, -0.577, -0.577) },
    { value: 4, normal: new THREE.Vector3(-0.577, 0.577, -0.577) },
  ],
  6: [
    { value: 1, normal: new THREE.Vector3(0, 0, 1) },
    { value: 6, normal: new THREE.Vector3(0, 0, -1) },
    { value: 2, normal: new THREE.Vector3(0, 1, 0) },
    { value: 5, normal: new THREE.Vector3(0, -1, 0) },
    { value: 3, normal: new THREE.Vector3(1, 0, 0) },
    { value: 4, normal: new THREE.Vector3(-1, 0, 0) },
  ],
  8: [
    { value: 1, normal: new THREE.Vector3(0.577, 0.577, 0.577) },
    { value: 8, normal: new THREE.Vector3(-0.577, -0.577, -0.577) },
    { value: 2, normal: new THREE.Vector3(-0.577, 0.577, 0.577) },
    { value: 7, normal: new THREE.Vector3(0.577, -0.577, -0.577) },
    { value: 3, normal: new THREE.Vector3(0.577, -0.577, 0.577) },
    { value: 6, normal: new THREE.Vector3(-0.577, 0.577, -0.577) },
    { value: 4, normal: new THREE.Vector3(-0.577, -0.577, 0.577) },
    { value: 5, normal: new THREE.Vector3(0.577, 0.577, -0.577) },
  ],
  10: [
    { value: 1, normal: new THREE.Vector3(0, 0.943, 0.333) },
    { value: 10, normal: new THREE.Vector3(0, -0.943, -0.333) },
    { value: 2, normal: new THREE.Vector3(0.894, 0.294, 0.333) },
    { value: 9, normal: new THREE.Vector3(-0.894, -0.294, -0.333) },
    { value: 3, normal: new THREE.Vector3(0.553, -0.763, 0.333) },
    { value: 8, normal: new THREE.Vector3(-0.553, 0.763, -0.333) },
    { value: 4, normal: new THREE.Vector3(-0.553, -0.763, 0.333) },
    { value: 7, normal: new THREE.Vector3(0.553, 0.763, -0.333) },
    { value: 5, normal: new THREE.Vector3(-0.894, 0.294, 0.333) },
    { value: 6, normal: new THREE.Vector3(0.894, -0.294, -0.333) },
  ],
  12: [
    { value: 1, normal: new THREE.Vector3(0, 0.795, 0.607) },
    { value: 12, normal: new THREE.Vector3(0, -0.795, -0.607) },
    { value: 2, normal: new THREE.Vector3(0.756, 0.246, 0.607) },
    { value: 11, normal: new THREE.Vector3(-0.756, -0.246, -0.607) },
    { value: 3, normal: new THREE.Vector3(0.467, -0.643, 0.607) },
    { value: 10, normal: new THREE.Vector3(-0.467, 0.643, -0.607) },
    { value: 4, normal: new THREE.Vector3(-0.467, -0.643, 0.607) },
    { value: 9, normal: new THREE.Vector3(0.467, 0.643, -0.607) },
    { value: 5, normal: new THREE.Vector3(-0.756, 0.246, 0.607) },
    { value: 8, normal: new THREE.Vector3(0.756, -0.246, -0.607) },
    { value: 6, normal: new THREE.Vector3(0, 0, 1) },
    { value: 7, normal: new THREE.Vector3(0, 0, -1) },
  ],
  20: [
    { value: 1, normal: new THREE.Vector3(0, 0.851, 0.526) },
    { value: 20, normal: new THREE.Vector3(0, -0.851, -0.526) },
    { value: 2, normal: new THREE.Vector3(0.809, 0.263, 0.526) },
    { value: 19, normal: new THREE.Vector3(-0.809, -0.263, -0.526) },
    { value: 3, normal: new THREE.Vector3(0.5, -0.688, 0.526) },
    { value: 18, normal: new THREE.Vector3(-0.5, 0.688, -0.526) },
    { value: 4, normal: new THREE.Vector3(-0.5, -0.688, 0.526) },
    { value: 17, normal: new THREE.Vector3(0.5, 0.688, -0.526) },
    { value: 5, normal: new THREE.Vector3(-0.809, 0.263, 0.526) },
    { value: 16, normal: new THREE.Vector3(0.809, -0.263, -0.526) },
    { value: 6, normal: new THREE.Vector3(0, 0.851, -0.526) },
    { value: 15, normal: new THREE.Vector3(0, -0.851, 0.526) },
    { value: 7, normal: new THREE.Vector3(0.809, 0.263, -0.526) },
    { value: 14, normal: new THREE.Vector3(-0.809, -0.263, 0.526) },
    { value: 8, normal: new THREE.Vector3(0.5, -0.688, -0.526) },
    { value: 13, normal: new THREE.Vector3(-0.5, 0.688, 0.526) },
    { value: 9, normal: new THREE.Vector3(-0.5, -0.688, -0.526) },
    { value: 12, normal: new THREE.Vector3(0.5, 0.688, 0.526) },
    { value: 10, normal: new THREE.Vector3(-0.809, 0.263, -0.526) },
    { value: 11, normal: new THREE.Vector3(0.809, -0.263, 0.526) },
  ],
};

export const DICE_TYPES = [4, 6, 8, 10, 12, 20];

export const DIE_SCALES = {
  4: 90,
  6: 56,
  8: 90,
  10: 90,
  12: 90,
  20: 95,
};

export const DIE_DENSITIES = {
  4: 4,
  6: 6,
  8: 8,
  10: 8,
  12: 9,
  20: 9,
};

export const DIE_MODEL_PATHS = {
  4: {
    obj: new URL('../assets/dice/4Dice.obj', import.meta.url).href,
    mtl: new URL('../assets/dice/4Dice.mtl', import.meta.url).href,
  },
  6: {
    obj: new URL('../assets/dice/6Dice.obj', import.meta.url).href,
    mtl: new URL('../assets/dice/6Dice.mtl', import.meta.url).href,
  },
  8: {
    obj: new URL('../assets/dice/8Dice.obj', import.meta.url).href,
    mtl: new URL('../assets/dice/8Dice.mtl', import.meta.url).href,
  },
  10: {
    obj: new URL('../assets/dice/10Dice.obj', import.meta.url).href,
    mtl: new URL('../assets/dice/10Dice.mtl', import.meta.url).href,
  },
  12: {
    obj: new URL('../assets/dice/12Dice.obj', import.meta.url).href,
    mtl: new URL('../assets/dice/12Dice.mtl', import.meta.url).href,
  },
  20: {
    obj: new URL('../assets/dice/20Dice.obj', import.meta.url).href,
    mtl: new URL('../assets/dice/20Dice.mtl', import.meta.url).href,
  },
};

export const extractVertices = (geometry) => {
  const position = geometry.getAttribute('position');
  if (!position) return [];
  const seen = new Set();
  const unique = [];
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(x, y, z);
  }
  return unique;
};

export const createColliderForSides = (RAPIER, sides, vertices) => {
  const dieSize = DIE_SCALES[sides];
  
  if (sides === 6) {
    return RAPIER.ColliderDesc.cuboid(dieSize / 2, dieSize / 2, dieSize / 2)
      .setRestitution(0.55)
      .setFriction(0.32);
  }

  const convex = RAPIER.ColliderDesc.convexHull(new Float32Array(vertices));
  if (convex) {
    convex.setRestitution(0.55).setFriction(0.32);
    return convex;
  }

  return RAPIER.ColliderDesc.ball(dieSize / 2).setRestitution(0.55).setFriction(0.32);
};

export const prepareDieMesh = (entry) => {
  if (!entry) return null;
  const mesh = entry.template.clone(true);
  mesh.traverse((node) => {
    if (node.isMesh) {
      // Keep each mesh's own geometry and material (don't overwrite)
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  return { mesh, geometry: entry.geometry, vertices: entry.vertices };
};

export const mulberry32 = (seed) => {
  let t = seed + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const makeTextSprite = (message, opts) => {
  const { fontsize, fontface, textColor } = {
    fontsize: 32,
    fontface: 'Arial',
    textColor: { r: 255, g: 255, b: 255, a: 1.0 },
    ...opts,
  };

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = ` ${fontsize}px ${fontface}`;

  const metrics = context.measureText(message);
  const textWidth = metrics.width;
  canvas.width = textWidth + 10;
  canvas.height = fontsize * 1.4;

  context.font = `Bold ${fontsize}px ${fontface}`;
  context.fillStyle = `rgba(${textColor.r},${textColor.g},${textColor.b},${textColor.a})`;
  context.fillText(message, 5, fontsize);

  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;

  const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(25, 25, 1.0);
  return sprite;
};

export const useDiceModels = () => {
  const diceModelsRef = useRef({});
  const [modelsReady, setModelsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      try {
        const entries = await Promise.all(
          DICE_TYPES.map(async (sides) => {
            const paths = DIE_MODEL_PATHS[sides];
            const mtlPath = paths.mtl;
            const objPath = paths.obj;
            
            const basePath = mtlPath.substring(0, mtlPath.lastIndexOf('/') + 1);
            
            const mtlLoader = new MTLLoader();
            mtlLoader.setResourcePath(basePath);
            
            const objLoader = new OBJLoader();
            
            const materials = await mtlLoader.loadAsync(mtlPath);
            materials.preload();
            objLoader.setMaterials(materials);
            
            const obj = await objLoader.loadAsync(objPath);
            
            // Collect all geometries for physics collider (use the largest mesh)
            let largestMesh = null;
            let largestVolume = 0;
            obj.traverse((child) => {
              if (child.isMesh) {
                child.geometry.computeBoundingBox();
                const bbox = child.geometry.boundingBox;
                const volume = (bbox.max.x - bbox.min.x) * (bbox.max.y - bbox.min.y) * (bbox.max.z - bbox.min.z);
                if (volume > largestVolume) {
                  largestVolume = volume;
                  largestMesh = child;
                }
              }
            });

            // Use the full object as template (contains all meshes/materials)
            const template = obj.clone(true);
            
            // Get geometry from largest mesh for physics
            let geometry = largestMesh?.geometry;
            if (!geometry) {
              throw new Error(`No geometry found for d${sides}`);
            }
            geometry = geometry.clone();
            geometry.computeVertexNormals();

            geometry.computeBoundingBox();
            const bbox = geometry.boundingBox;
            const sizeX = bbox.max.x - bbox.min.x;
            const sizeY = bbox.max.y - bbox.min.y;
            const sizeZ = bbox.max.z - bbox.min.z;
            const maxDimension = Math.max(sizeX, sizeY, sizeZ);
            const targetSize = DIE_SCALES[sides];
            const scale = targetSize / maxDimension;

            geometry.scale(scale, scale, scale);

            const vertices = extractVertices(geometry);

            // Scale all meshes in the template and configure rendering
            template.traverse((node) => {
              if (node.isMesh) {
                node.geometry = node.geometry.clone();
                node.geometry.scale(scale, scale, scale);
                node.castShadow = true;
                node.receiveShadow = true;
              }
            });

            return [sides, { template, geometry, vertices }];
          })
        );

        if (!cancelled) {
          entries.forEach(([sides, entry]) => {
            diceModelsRef.current[sides] = entry;
          });
          setModelsReady(true);
        }
      } catch (error) {
        console.error('Failed to load dice models', error);
      }
    };

    loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  return { diceModels: diceModelsRef.current, modelsReady };
};

export const setupScene = (canvas, width = ARENA_WIDTH, height = ARENA_HEIGHT) => {
  if (!canvas) return null;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = null;

  // Calculate camera to always show full physics arena
  const canvasAspect = width / height;
  const arenaAspect = ARENA_WIDTH / ARENA_HEIGHT;
  
  let viewWidth, viewHeight;
  if (canvasAspect > arenaAspect) {
    // Canvas is wider - fit to height
    viewHeight = ARENA_HEIGHT;
    viewWidth = ARENA_HEIGHT * canvasAspect;
  } else {
    // Canvas is taller - fit to width
    viewWidth = ARENA_WIDTH;
    viewHeight = ARENA_WIDTH / canvasAspect;
  }
  
  const camera = new THREE.OrthographicCamera(
    -viewWidth / 2,
    viewWidth / 2,
    viewHeight / 2,
    -viewHeight / 2,
    1,
    1000
  );
  camera.position.set(0, 0, 800);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  const directional = new THREE.DirectionalLight(0xffffff, 0.9);
  directional.position.set(120, -80, 300);
  directional.castShadow = true;
  
  // Configure shadow camera to cover the arena
  directional.shadow.camera.left = -ARENA_WIDTH / 2;
  directional.shadow.camera.right = ARENA_WIDTH / 2;
  directional.shadow.camera.top = ARENA_HEIGHT / 2;
  directional.shadow.camera.bottom = -ARENA_HEIGHT / 2;
  directional.shadow.camera.near = 1;
  directional.shadow.camera.far = 1000;
  
  // Shadow quality
  directional.shadow.mapSize.width = 2048;
  directional.shadow.mapSize.height = 2048;
  directional.shadow.bias = -0.0001;

  scene.add(ambient);
  scene.add(directional);

  return { renderer, camera, scene };
};

export const updateCamera = (camera, renderer, width, height) => {
  if (!camera || !renderer) return;
  
  // Calculate camera to always show full physics arena
  const canvasAspect = width / height;
  const arenaAspect = ARENA_WIDTH / ARENA_HEIGHT;
  
  let viewWidth, viewHeight;
  if (canvasAspect > arenaAspect) {
    // Canvas is wider - fit to height
    viewHeight = ARENA_HEIGHT;
    viewWidth = ARENA_HEIGHT * canvasAspect;
  } else {
    // Canvas is taller - fit to width
    viewWidth = ARENA_WIDTH;
    viewHeight = ARENA_WIDTH / canvasAspect;
  }
  
  camera.left = -viewWidth / 2;
  camera.right = viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  
  renderer.setSize(width, height);
};

export const buildBounds = (world, RAPIER) => {
  if (!RAPIER || !world) return;

  const VISUAL_MARGIN = DIE_SIZE;
  const halfWidth = ARENA_WIDTH / 2 - VISUAL_MARGIN;
  const halfHeight = ARENA_HEIGHT / 2 - VISUAL_MARGIN;

  const floorDepth = WALL_THICKNESS;
  const wallDepth = DIE_SIZE * 4;

  const floor = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -DIE_SIZE - floorDepth / 2)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfWidth * 2, halfHeight * 2, floorDepth / 2)
      .setRestitution(0.5)
      .setFriction(0.6),
    floor
  );

  const ceiling = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, DIE_SIZE * 3 + floorDepth / 2)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfWidth * 2, halfHeight * 2, floorDepth / 2)
      .setRestitution(0.3)
      .setFriction(0.5),
    ceiling
  );

  const rightWall = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(halfWidth + WALL_THICKNESS / 2, 0, wallDepth / 2 - DIE_SIZE)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, halfHeight * 2, wallDepth / 2)
      .setRestitution(0.6)
      .setFriction(0.5),
    rightWall
  );

  const leftWall = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(-halfWidth - WALL_THICKNESS / 2, 0, wallDepth / 2 - DIE_SIZE)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, halfHeight * 2, wallDepth / 2)
      .setRestitution(0.6)
      .setFriction(0.5),
    leftWall
  );

  const topWall = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, halfHeight + WALL_THICKNESS / 2, wallDepth / 2 - DIE_SIZE)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfWidth * 2, WALL_THICKNESS / 2, wallDepth / 2)
      .setRestitution(0.6)
      .setFriction(0.5),
    topWall
  );

  const bottomWall = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -halfHeight - WALL_THICKNESS / 2, wallDepth / 2 - DIE_SIZE)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfWidth * 2, WALL_THICKNESS / 2, wallDepth / 2)
      .setRestitution(0.6)
      .setFriction(0.5),
    bottomWall
  );
};
