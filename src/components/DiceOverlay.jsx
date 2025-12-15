import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/Addons.js';
import { MTLLoader } from 'three/examples/jsm/Addons.js';

const ARENA_WIDTH = 1024;
const ARENA_HEIGHT = 600;
const DIE_SIZE = 64;
const MAX_STEPS = 400;
const WALL_THICKNESS = 12;

const DICE_TYPES = [4, 6, 8, 10, 12, 20];

// Individual scale factors for each die type
const DIE_SCALES = {
  4: 48,   // d4 
  6: 48,   // d6 
  8: 56,   // d8 - medium-small
  10: 56,  // d10 - medium-small
  12: 64,  // d12 - medium
  20: 92,  // d20 - medium
};

// Individual density (mass) factors for each die type
const DIE_DENSITIES = {
  4: 2.0,   // d4 - standard
  6: 2.2,   // d6 - slightly heavier
  8: 2.1,   // d8 - slightly heavier
  10: 2.2,  // d10 - slightly heavier
  12: 2.3,  // d12 - heavier
  20: 2.5,  // d20 - heaviest
};

const DIE_MODEL_PATHS = {
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

const extractVertices = (geometry) => {
  const position = geometry.getAttribute('position');
  if (!position) return [];
  const seen = new Set();
  const unique = [];
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(x, y, z);
  }
  return unique;
};

const createColliderForSides = (RAPIER, sides, geometry) => {
  const dieSize = DIE_SCALES[sides];
  
  if (sides === 6) {
    return RAPIER.ColliderDesc.cuboid(dieSize / 2, dieSize / 2, dieSize / 2)
      .setRestitution(0.55)
      .setFriction(0.32);
  }

  const vertices = extractVertices(geometry);
  const convex = RAPIER.ColliderDesc.convexHull(new Float32Array(vertices));
  if (convex) {
    convex.setRestitution(0.55).setFriction(0.32);
    return convex;
  }

  return RAPIER.ColliderDesc.ball(dieSize / 2).setRestitution(0.55).setFriction(0.32);
};

const prepareDieMesh = (entry) => {
  if (!entry) return null;
  const mesh = entry.template.clone(true);
  mesh.traverse((node) => {
    if (node.isMesh) {
      node.geometry = entry.geometry;
      node.material = node.material?.clone?.() || node.material;
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  return { mesh, geometry: entry.geometry };
};

const mulberry32 = (seed) => {
  let t = seed + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const DiceOverlay = ({ roomId, diceRoll, onSendDiceRoll }) => {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const rapierRef = useRef(null);
  const worldRef = useRef(null);
  const channelRef = useRef(null);
  const instanceIdRef = useRef(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  const sharedWorkerRef = useRef(null);
  const diceRef = useRef([]);
  const settleTimeoutRef = useRef(null);
  const stepRef = useRef(0);
  const diceModelsRef = useRef({});
  const animationRef = useRef(null);
  const pendingRollRef = useRef(null);
  const [diceCount, setDiceCount] = useState(2);
  const [diceSides, setDiceSides] = useState(6);
  const [status, setStatus] = useState('idle');
  const [modelsReady, setModelsReady] = useState(false);

  const roomKey = useMemo(() => roomId || 'default', [roomId]);
  const channelName = useMemo(() => `vtrpg-dice-${roomKey}`, [roomKey]);

  const teardown = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const world = worldRef.current;
    diceRef.current.forEach((die) => {
      const body = world?.getRigidBody(die.bodyHandle);
      if (body) world.removeRigidBody(body);
      sceneRef.current?.remove(die.mesh);
    });
    diceRef.current = [];
    stepRef.current = 0;
  };

  useEffect(() => {
    let cancelled = false;

    const loadModels = async () => {
      try {
        const entries = await Promise.all(
          DICE_TYPES.map(async (sides) => {
            const paths = DIE_MODEL_PATHS[sides];
            const mtlPath = paths.mtl;
            const objPath = paths.obj;
            
            // Extract the base path for resource loading
            const basePath = mtlPath.substring(0, mtlPath.lastIndexOf('/') + 1);
            
            // Create fresh loader instances for each die
            const mtlLoader = new MTLLoader();
            mtlLoader.setResourcePath(basePath);
            
            const objLoader = new OBJLoader();
            
            // Load and apply materials
            const materials = await mtlLoader.loadAsync(mtlPath);
            materials.preload();
            objLoader.setMaterials(materials);
            
            // Load the OBJ with materials applied
            const obj = await objLoader.loadAsync(objPath);
            
            let firstMesh = null;
            obj.traverse((child) => {
              if (!firstMesh && child.isMesh) {
                firstMesh = child;
              }
            });

            const template = (firstMesh || obj).clone(true);
            let geometry = firstMesh?.geometry || (template.isMesh ? template.geometry : null);
            if (!geometry) {
              throw new Error(`No geometry found for d${sides}`);
            }
            geometry = geometry.clone();
            geometry.computeVertexNormals();

            // Compute bounding box and scale to individual die size
            geometry.computeBoundingBox();
            const bbox = geometry.boundingBox;
            const sizeX = bbox.max.x - bbox.min.x;
            const sizeY = bbox.max.y - bbox.min.y;
            const sizeZ = bbox.max.z - bbox.min.z;
            const maxDimension = Math.max(sizeX, sizeY, sizeZ);
            const targetSize = DIE_SCALES[sides];
            const scale = targetSize / maxDimension;

            // Scale the geometry vertices to match physics size
            geometry.scale(scale, scale, scale);
            geometry.computeBoundingBox();

            template.traverse((node) => {
              if (node.isMesh) {
                node.geometry = geometry;
                node.material = node.material?.clone?.() || node.material;
                node.castShadow = true;
                node.receiveShadow = true;
              }
            });

            return [sides, { template, geometry }];
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

  const setupScene = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(ARENA_WIDTH, ARENA_HEIGHT);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(45, ARENA_WIDTH / ARENA_HEIGHT, 1, 1000);
    camera.position.set(0, 0, 800);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(120, -80, 300);
    directional.castShadow = true;

    scene.add(ambient);
    scene.add(directional);

    rendererRef.current = { renderer, camera };
    sceneRef.current = scene;
  };

  const buildBounds = () => {
    const RAPIER = rapierRef.current;
    const world = worldRef.current;
    if (!RAPIER || !world) return;

    // Add margin so dice don't visually clip canvas edges
    const VISUAL_MARGIN = DIE_SIZE;
    const halfWidth = ARENA_WIDTH / 2 - VISUAL_MARGIN;
    const halfHeight = ARENA_HEIGHT / 2 - VISUAL_MARGIN;

    // Use large cuboid colliders instead of halfspace for more reliable collision
    const floorDepth = WALL_THICKNESS;
    const wallDepth = DIE_SIZE * 4;

    // Floor
    const floor = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -DIE_SIZE - floorDepth / 2)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfWidth * 2, halfHeight * 2, floorDepth / 2)
        .setRestitution(0.5)
        .setFriction(0.6),
      floor
    );

    // Ceiling
    const ceiling = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, DIE_SIZE * 3 + floorDepth / 2)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfWidth * 2, halfHeight * 2, floorDepth / 2)
        .setRestitution(0.3)
        .setFriction(0.5),
      ceiling
    );

    // Right wall
    const rightWall = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(halfWidth + WALL_THICKNESS / 2, 0, wallDepth / 2 - DIE_SIZE)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, halfHeight * 2, wallDepth / 2)
        .setRestitution(0.6)
        .setFriction(0.5),
      rightWall
    );

    // Left wall
    const leftWall = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(-halfWidth - WALL_THICKNESS / 2, 0, wallDepth / 2 - DIE_SIZE)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, halfHeight * 2, wallDepth / 2)
        .setRestitution(0.6)
        .setFriction(0.5),
      leftWall
    );

    // Top wall
    const topWall = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, halfHeight + WALL_THICKNESS / 2, wallDepth / 2 - DIE_SIZE)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfWidth * 2, WALL_THICKNESS / 2, wallDepth / 2)
        .setRestitution(0.6)
        .setFriction(0.5),
      topWall
    );

    // Bottom wall
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

  const initializePhysics = useCallback(async () => {
    if (rapierRef.current && worldRef.current) return;
    const RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();
    rapierRef.current = RAPIER;
    worldRef.current = new RAPIER.World({ x: 0, y: 0, z: -1200 });
    buildBounds();
  }, []);

  const randomInRange = (rng, min, max) => min + (max - min) * rng();

  const randomRotation = (rng) => {
    const euler = new THREE.Euler(randomInRange(rng, 0, Math.PI * 2), randomInRange(rng, 0, Math.PI * 2), randomInRange(rng, 0, Math.PI * 2));
    const quaternion = new THREE.Quaternion();
    quaternion.setFromEuler(euler);
    return quaternion;
  };

  const seedDice = useCallback((seed, count, sides) => {
    const world = worldRef.current;
    const RAPIER = rapierRef.current;
    const scene = sceneRef.current;
    if (!world || !RAPIER || !scene) return;

    const modelEntry = diceModelsRef.current[sides];
    if (!modelEntry) {
      setStatus('loading');
      return;
    }

    const rng = mulberry32(seed);
    teardown();
    const dice = Array.from({ length: count }, () => {
      const { mesh, geometry } = prepareDieMesh(modelEntry);
      const rotation = randomRotation(rng);
      return {
        mesh,
        geometry,
        position: {
          x: randomInRange(rng, -ARENA_WIDTH / 2 + DIE_SIZE, ARENA_WIDTH / 2 - DIE_SIZE),
          y: randomInRange(rng, -ARENA_HEIGHT / 2 + DIE_SIZE, ARENA_HEIGHT / 2 - DIE_SIZE),
        },
        velocity: {
          x: randomInRange(rng, -450, 450),
          y: randomInRange(rng, 320, 620),
          z: randomInRange(rng, 0, 100),
        },
        angularVelocity: {
          x: randomInRange(rng, -10, 10),
          y: randomInRange(rng, -10, 10),
          z: randomInRange(rng, -10, 10),
        },
        rotation,
      };
    });

    const preparedDice = dice.map((die) => {
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(die.position.x, die.position.y, DIE_SIZE * 2)
        .setRotation({ w: die.rotation.w, x: die.rotation.x, y: die.rotation.y, z: die.rotation.z })
        .setLinearDamping(0.48)
        .setAngularDamping(0.72)
        .setCcdEnabled(true);

      const body = world.createRigidBody(bodyDesc);
      body.setLinvel(die.velocity, true);
      body.setAngvel(die.angularVelocity, true);

      const colliderDesc = createColliderForSides(RAPIER, sides, die.geometry);
      colliderDesc.setDensity(DIE_DENSITIES[sides]);

      world.createCollider(colliderDesc, body);
      scene.add(die.mesh);

      return { mesh: die.mesh, bodyHandle: body.handle };
    });

    diceRef.current = preparedDice;
    stepRef.current = 0;
  }, []);

  const renderFrame = () => {
    const { renderer, camera } = rendererRef.current || {};
    const scene = sceneRef.current;
    const world = worldRef.current;
    const RAPIER = rapierRef.current;
    if (!renderer || !camera || !scene || !world || !RAPIER) return;

    diceRef.current.forEach((die) => {
      const body = world.getRigidBody(die.bodyHandle);
      if (!body) return;
      const translation = body.translation();
      const rotation = body.rotation();
      die.mesh.position.set(translation.x, translation.y, translation.z);
      die.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    });

    renderer.render(scene, camera);
  };

  const tick = () => {
    const world = worldRef.current;
    if (!world) return;
    world.step();
    renderFrame();
    stepRef.current += 1;

    const stillMoving = diceRef.current.some((die) => {
      const body = world.getRigidBody(die.bodyHandle);
      if (!body) return false;
      const linvel = body.linvel();
      const angvel = body.angvel();
      return (
        Math.abs(linvel.x) > 1.6 ||
        Math.abs(linvel.y) > 1.6 ||
        Math.abs(angvel.x) > 0.25 ||
        Math.abs(angvel.y) > 0.25 ||
        Math.abs(angvel.z) > 0.25
      );
    });

    if (stepRef.current < MAX_STEPS && stillMoving) {
      animationRef.current = requestAnimationFrame(tick);
    } else {
      if (settleTimeoutRef.current) {
        clearTimeout(settleTimeoutRef.current);
        settleTimeoutRef.current = null;
      }
      setStatus('settled');
    }
  };

  const startSimulation = useCallback(
    async (seed, count, sides) => {
      if (!modelsReady || !diceModelsRef.current[sides]) {
        setStatus('loading');
        pendingRollRef.current = { seed, count, sides };
        return;
      }

      pendingRollRef.current = null;
      setStatus('rolling');
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = setTimeout(() => setStatus('settled'), 3200);
      await initializePhysics();
      seedDice(seed, count, sides);
      animationRef.current = requestAnimationFrame(tick);
    },
    [initializePhysics, modelsReady, seedDice]
  );

  useEffect(() => {
    if (modelsReady && pendingRollRef.current) {
      const pending = pendingRollRef.current;
      pendingRollRef.current = null;
      startSimulation(pending.seed, pending.count, pending.sides);
    }
  }, [modelsReady, startSimulation]);

  const postLocalRoll = useCallback(
    (seed, count, sides) => {
      const message = { type: 'dice-roll', seed, count, sides, room: roomKey, source: instanceIdRef.current };
      if (sharedWorkerRef.current) {
        sharedWorkerRef.current.postMessage(message);
      }
      if (channelRef.current) {
        channelRef.current.postMessage(message);
      }
    },
    [roomKey]
  );

  const handleIncomingRoll = useCallback(
    (data) => {
      if (!data || data.type !== 'dice-roll' || data.room !== roomKey || data.source === instanceIdRef.current) return;
      const nextSides = data.sides || diceSides;
      setDiceSides(nextSides);
      startSimulation(data.seed, data.count, nextSides);
    },
    [diceSides, roomKey, startSimulation]
  );

  useEffect(() => {
    setupScene();
    initializePhysics();

    return () => {
      teardown();
      worldRef.current = null;
      rendererRef.current?.renderer?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!diceRoll || !diceRoll.seed || !diceRoll.count) return;
    const nextSides = diceRoll.sides || diceSides;
    postLocalRoll(diceRoll.seed, diceRoll.count, nextSides);
    if (diceRoll.sides) setDiceSides(diceRoll.sides);
    startSimulation(diceRoll.seed, diceRoll.count, nextSides);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diceRoll]);

  useEffect(() => {
    const cleanupFns = [];

    if (typeof SharedWorker !== 'undefined') {
      try {
        const worker = new SharedWorker(new URL('../workers/diceBus.js', import.meta.url), {
          type: 'module',
          name: 'vtrpg-dice-bus',
        });
        worker.port.start();
        worker.port.onmessage = (event) => handleIncomingRoll(event.data);
        sharedWorkerRef.current = worker.port;
        cleanupFns.push(() => {
          worker.port.onmessage = null;
          worker.port.close();
          sharedWorkerRef.current = null;
        });
      } catch (error) {
        console.warn('SharedWorker not available for dice sync', error);
      }
    }

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(channelName);
      channel.onmessage = (event) => handleIncomingRoll(event.data);
      channelRef.current = channel;
      cleanupFns.push(() => {
        channel.onmessage = null;
        channel.close();
        channelRef.current = null;
      });
    }

    return () => {
      cleanupFns.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, handleIncomingRoll]);

  const broadcastRoll = (seed, count, sides) => {
    postLocalRoll(seed, count, sides);
    if (!onSendDiceRoll) return;
    onSendDiceRoll(seed, count, sides);
  };

  const rollDice = () => {
    const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
    const seed = hasCrypto
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 1_000_000_000) || Date.now();
    setStatus('rolling');
    broadcastRoll(seed, diceCount, diceSides);
    startSimulation(seed, diceCount, diceSides);
  };

  const isRollingDisabled = !modelsReady || status === 'rolling';
  const statusLabel = !modelsReady
    ? 'Loading dice models...'
    : status === 'rolling'
      ? 'Rolling...'
      : status === 'settled'
        ? 'Result locked'
        : 'Idle';

  return (
    <div className="dice-overlay" aria-label="dice-overlay">
      <canvas ref={canvasRef} className="dice-canvas" width={ARENA_WIDTH} height={ARENA_HEIGHT} aria-label="dice-canvas" />
      <div className="dice-controls" aria-live="polite">
        <div className="dice-count">Dice: {diceCount}</div>
        <div className="dice-buttons">
          <button type="button" onClick={() => setDiceCount((prev) => Math.max(1, prev - 1))} aria-label="decrease dice">
            -
          </button>
          <button type="button" onClick={() => setDiceCount((prev) => Math.min(12, prev + 1))} aria-label="increase dice">
            +
          </button>
        </div>
        <div className="dice-type-buttons" role="group" aria-label="Select dice type">
          {DICE_TYPES.map((sides) => (
            <button
              key={sides}
              type="button"
              className={sides === diceSides ? 'active' : ''}
              onClick={() => setDiceSides(sides)}
              aria-label={`use d${sides}`}
            >
              d{sides}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="roll-button"
          onClick={rollDice}
          aria-label="roll dice"
          disabled={isRollingDisabled}
        >
          Roll dice
        </button>
        <div className="dice-status" data-state={!modelsReady ? 'loading' : status}>
          {statusLabel} (d{diceSides})
        </div>
      </div>
    </div>
  );
};

DiceOverlay.propTypes = {
  roomId: PropTypes.string,
  diceRoll: PropTypes.shape({
    seed: PropTypes.number,
    count: PropTypes.number,
    sides: PropTypes.number,
  }),
  onSendDiceRoll: PropTypes.func,
};

export default DiceOverlay;
