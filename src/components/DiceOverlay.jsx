import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import * as THREE from 'three';

const ARENA_WIDTH = 720;
const ARENA_HEIGHT = 420;
const DIE_SIZE = 32;
const MAX_STEPS = 300;
const WALL_THICKNESS = 12;
const MIN_ROLL_DURATION = 1000;
const MAX_ROLL_DURATION = 2500;
const FACE_NORMALS = [
  { value: 1, normal: new THREE.Vector3(0, 0, 1) },
  { value: 6, normal: new THREE.Vector3(0, 0, -1) },
  { value: 2, normal: new THREE.Vector3(0, 1, 0) },
  { value: 5, normal: new THREE.Vector3(0, -1, 0) },
  { value: 3, normal: new THREE.Vector3(1, 0, 0) },
  { value: 4, normal: new THREE.Vector3(-1, 0, 0) },
];

const mulberry32 = (seed) => {
  let t = seed + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const createDieMesh = () => {
  const geometry = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
  const material = new THREE.MeshStandardMaterial({ color: 0xff4444, metalness: 0.2, roughness: 0.6 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const DiceOverlay = ({ roomId, diceRoll, onSendDiceRoll, onDiceResult }) => {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const rapierRef = useRef(null);
  const worldRef = useRef(null);
  const diceRef = useRef([]);
  const stepRef = useRef(0);
  const animationRef = useRef(null);
  const rollStartedAtRef = useRef(null);
  const settleTimeoutRef = useRef(null);
  const currentRollRef = useRef(null);
  const reportedRollRef = useRef(null);
  const [diceCount, setDiceCount] = useState(2);
  const [status, setStatus] = useState('idle');

  const teardown = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    const world = worldRef.current;
    diceRef.current.forEach((die) => {
      const body = world?.getRigidBody(die.bodyHandle);
      if (body) world.removeRigidBody(body);
      sceneRef.current?.remove(die.mesh);
    });
    diceRef.current = [];
    stepRef.current = 0;
  };

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
    camera.position.set(0, 0, 500);
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

    const halfWidth = ARENA_WIDTH / 2;
    const halfHeight = ARENA_HEIGHT / 2;

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

  const initializePhysics = async () => {
    if (rapierRef.current && worldRef.current) return;
    const RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();
    rapierRef.current = RAPIER;
    worldRef.current = new RAPIER.World({ x: 0, y: 0, z: -600 });
    buildBounds();
  };

  const randomInRange = (rng, min, max) => min + (max - min) * rng();

  const randomRotation = (rng) => {
    const euler = new THREE.Euler(randomInRange(rng, 0, Math.PI * 2), randomInRange(rng, 0, Math.PI * 2), randomInRange(rng, 0, Math.PI * 2));
    const quaternion = new THREE.Quaternion();
    quaternion.setFromEuler(euler);
    return quaternion;
  };

  const determineFaceUp = (quaternion) => {
    const up = new THREE.Vector3(0, 0, 1);
    let best = { value: null, alignment: -Infinity };

    FACE_NORMALS.forEach(({ value, normal }) => {
      const worldNormal = normal.clone().applyQuaternion(quaternion);
      const alignment = worldNormal.dot(up);
      if (alignment > best.alignment) {
        best = { value, alignment };
      }
    });

    return best.value;
  };

  const collectResults = () => {
    const world = worldRef.current;
    if (!world) return [];

    return diceRef.current
      .map((die) => {
        const body = world.getRigidBody(die.bodyHandle);
        if (!body) return null;
        const rotation = body.rotation();
        const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
        return determineFaceUp(quaternion);
      })
      .filter((value) => Number.isInteger(value));
  };

  const reportResults = () => {
    if (!onDiceResult) return;
    const roll = currentRollRef.current;
    if (!roll) return;
    const rollId = `${roll.seed}-${roll.count}`;
    if (reportedRollRef.current === rollId) return;
    const results = collectResults();
    if (!results.length) return;
    reportedRollRef.current = rollId;
    onDiceResult({ ...roll, results });
  };

  const seedDice = (seed, count) => {
    const world = worldRef.current;
    const RAPIER = rapierRef.current;
    const scene = sceneRef.current;
    if (!world || !RAPIER || !scene) return;

    const rng = mulberry32(seed);
    teardown();
    const dice = Array.from({ length: count }, () => {
      const mesh = createDieMesh();
      const rotation = randomRotation(rng);
      return {
        mesh,
        position: {
          x: randomInRange(rng, -ARENA_WIDTH / 2 + DIE_SIZE, ARENA_WIDTH / 2 - DIE_SIZE),
          y: randomInRange(rng, -ARENA_HEIGHT / 2 + DIE_SIZE, ARENA_HEIGHT / 2 - DIE_SIZE),
        },
        velocity: {
          x: randomInRange(rng, -240, 240),
          y: randomInRange(rng, 180, 320),
          z: 0,
        },
        angularVelocity: {
          x: randomInRange(rng, -4, 4),
          y: randomInRange(rng, -4, 4),
          z: randomInRange(rng, -4, 4),
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

      const colliderDesc = RAPIER.ColliderDesc.cuboid(DIE_SIZE / 2, DIE_SIZE / 2, DIE_SIZE / 2)
        .setRestitution(0.55)
        .setFriction(0.32);

      world.createCollider(colliderDesc, body);
      scene.add(die.mesh);

      return { mesh: die.mesh, bodyHandle: body.handle };
    });

    diceRef.current = preparedDice;
    stepRef.current = 0;
  };

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
    const elapsed = rollStartedAtRef.current
      ? (typeof performance !== 'undefined' ? performance.now() : Date.now()) - rollStartedAtRef.current
      : 0;
    const exceededDuration = elapsed > MAX_ROLL_DURATION;
    const pastMinimumDuration = elapsed >= MIN_ROLL_DURATION;

    const stillMoving = diceRef.current.some((die) => {
      const body = world.getRigidBody(die.bodyHandle);
      if (!body) return false;
      const linvel = body.linvel();
      const angvel = body.angvel();
      return (
        Math.abs(linvel.x) > 1.2 ||
        Math.abs(linvel.y) > 1.2 ||
        Math.abs(angvel.x) > 0.18 ||
        Math.abs(angvel.y) > 0.18 ||
        Math.abs(angvel.z) > 0.18
      );
    });

    if ((stepRef.current < MAX_STEPS && stillMoving && !exceededDuration) || (!pastMinimumDuration && !exceededDuration)) {
      animationRef.current = requestAnimationFrame(tick);
    } else {
      if (settleTimeoutRef.current) {
        clearTimeout(settleTimeoutRef.current);
        settleTimeoutRef.current = null;
      }
      diceRef.current.forEach((die) => {
        const body = world.getRigidBody(die.bodyHandle);
        body?.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body?.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
      reportResults();
      setStatus('settled');
    }
  };

  const startSimulation = async (seed, count) => {
    await initializePhysics();
    seedDice(seed, count);
    setStatus('rolling');
    rollStartedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    currentRollRef.current = { seed, count };
    reportedRollRef.current = null;
    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    settleTimeoutRef.current = setTimeout(() => {
      reportResults();
      setStatus('settled');
    }, MAX_ROLL_DURATION);
    animationRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    setupScene();
    initializePhysics();

    return () => {
      teardown();
      worldRef.current = null;
      rendererRef.current?.renderer?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!diceRoll || !diceRoll.seed || !diceRoll.count) return;
    if (currentRollRef.current?.seed === diceRoll.seed && currentRollRef.current?.count === diceRoll.count) return;
    startSimulation(diceRoll.seed, diceRoll.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diceRoll]);

  const broadcastRoll = (seed, count) => {
    if (!onSendDiceRoll) return;
    onSendDiceRoll(seed, count);
  };

  const rollDice = () => {
    const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
    const seed = hasCrypto
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 1_000_000_000) || Date.now();
    setStatus('rolling');
    broadcastRoll(seed, diceCount);
    startSimulation(seed, diceCount);
  };

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
        <button type="button" className="roll-button" onClick={rollDice} aria-label="roll dice">
          Roll dice
        </button>
        <div className="dice-status" data-state={status}>
          {status === 'rolling' ? 'Rolling...' : status === 'settled' ? 'Result locked' : 'Idle'}
        </div>
      </div>
    </div>
  );
};

DiceOverlay.propTypes = {
  roomId: PropTypes.string,
  diceRoll: PropTypes.object,
  onSendDiceRoll: PropTypes.func,
  onDiceResult: PropTypes.func,
};

export default DiceOverlay;
