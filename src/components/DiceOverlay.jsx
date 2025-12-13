import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import * as THREE from 'three';

const ARENA_WIDTH = 720;
const ARENA_HEIGHT = 420;
const DIE_SIZE = 32;
const FIXED_DT = 1 / 60;
const MAX_STEPS = 420;

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
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.6 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const DiceOverlay = ({ roomId }) => {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const diceRef = useRef([]);
  const stepRef = useRef(0);
  const animationRef = useRef(null);
  const channelRef = useRef(null);
  const [diceCount, setDiceCount] = useState(2);
  const [status, setStatus] = useState('idle');

  const channelName = useMemo(() => `vtrpg-dice-${roomId || 'default'}`, [roomId]);

  const teardown = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
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
    camera.position.set(0, -200, 350);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(120, -80, 140);
    directional.castShadow = true;

    scene.add(ambient);
    scene.add(directional);

    rendererRef.current = { renderer, camera };
    sceneRef.current = scene;
  };

  const randomInRange = (rng, min, max) => min + (max - min) * rng();

  const seedDice = (seed, count) => {
    const rng = mulberry32(seed);
    const dice = Array.from({ length: count }, () => {
      const mesh = createDieMesh();
      return {
        mesh,
        position: {
          x: randomInRange(rng, -ARENA_WIDTH / 2 + DIE_SIZE, ARENA_WIDTH / 2 - DIE_SIZE),
          y: randomInRange(rng, -ARENA_HEIGHT / 2 + DIE_SIZE, ARENA_HEIGHT / 2 - DIE_SIZE),
        },
        velocity: {
          x: randomInRange(rng, -240, 240),
          y: randomInRange(rng, 180, 320),
        },
        angularVelocity: {
          x: randomInRange(rng, -4, 4),
          y: randomInRange(rng, -4, 4),
          z: randomInRange(rng, -4, 4),
        },
        rotation: {
          x: randomInRange(rng, 0, Math.PI * 2),
          y: randomInRange(rng, 0, Math.PI * 2),
          z: randomInRange(rng, 0, Math.PI * 2),
        },
      };
    });

    diceRef.current = dice;
    stepRef.current = 0;
  };

  const resolveCollisions = () => {
    const dice = diceRef.current;
    for (let i = 0; i < dice.length; i += 1) {
      for (let j = i + 1; j < dice.length; j += 1) {
        const a = dice[i];
        const b = dice[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = DIE_SIZE;
        if (distance < minDist) {
          const overlap = (minDist - distance) / 2;
          const nx = dx / distance;
          const ny = dy / distance;
          a.position.x -= nx * overlap;
          a.position.y -= ny * overlap;
          b.position.x += nx * overlap;
          b.position.y += ny * overlap;

          const va = a.velocity.x * nx + a.velocity.y * ny;
          const vb = b.velocity.x * nx + b.velocity.y * ny;
          const exchange = vb - va;
          a.velocity.x += exchange * nx;
          a.velocity.y += exchange * ny;
          b.velocity.x -= exchange * nx;
          b.velocity.y -= exchange * ny;
        }
      }
    }
  };

  const stepPhysics = () => {
    const dice = diceRef.current;
    dice.forEach((die) => {
      die.position.x += die.velocity.x * FIXED_DT;
      die.position.y += die.velocity.y * FIXED_DT;

      die.rotation.x += die.angularVelocity.x * FIXED_DT;
      die.rotation.y += die.angularVelocity.y * FIXED_DT;
      die.rotation.z += die.angularVelocity.z * FIXED_DT;

      die.velocity.x *= 0.992;
      die.velocity.y *= 0.992;
      die.angularVelocity.x *= 0.985;
      die.angularVelocity.y *= 0.985;
      die.angularVelocity.z *= 0.985;

      const limitX = ARENA_WIDTH / 2 - DIE_SIZE / 2;
      const limitY = ARENA_HEIGHT / 2 - DIE_SIZE / 2;
      if (die.position.x < -limitX) {
        die.position.x = -limitX;
        die.velocity.x *= -0.82;
      } else if (die.position.x > limitX) {
        die.position.x = limitX;
        die.velocity.x *= -0.82;
      }
      if (die.position.y < -limitY) {
        die.position.y = -limitY;
        die.velocity.y *= -0.82;
      } else if (die.position.y > limitY) {
        die.position.y = limitY;
        die.velocity.y *= -0.82;
      }
    });

    resolveCollisions();
  };

  const renderFrame = () => {
    const { renderer, camera } = rendererRef.current || {};
    const scene = sceneRef.current;
    if (!renderer || !camera || !scene) return;

    diceRef.current.forEach((die) => {
      if (!scene.children.includes(die.mesh)) scene.add(die.mesh);
      die.mesh.position.set(die.position.x, die.position.y, 0);
      die.mesh.rotation.set(die.rotation.x, die.rotation.y, die.rotation.z);
    });

    renderer.render(scene, camera);
  };

  const tick = () => {
    stepPhysics();
    renderFrame();
    stepRef.current += 1;

    const stillMoving = diceRef.current.some(
      (die) =>
        Math.abs(die.velocity.x) > 2 ||
        Math.abs(die.velocity.y) > 2 ||
        Math.abs(die.angularVelocity.x) > 0.2 ||
        Math.abs(die.angularVelocity.y) > 0.2 ||
        Math.abs(die.angularVelocity.z) > 0.2
    );

    if (stepRef.current < MAX_STEPS && stillMoving) {
      animationRef.current = requestAnimationFrame(tick);
    } else {
      setStatus('settled');
    }
  };

  const startSimulation = (seed, count) => {
    teardown();
    seedDice(seed, count);
    setStatus('rolling');
    animationRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    setupScene();

    return () => {
      teardown();
      rendererRef.current?.renderer?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;
    const handler = (event) => {
      const { type, payload } = event.data || {};
      if (type === 'dice-roll' && payload?.seed && payload?.count) {
        startSimulation(payload.seed, payload.count);
      }
    };
    channel.addEventListener('message', handler);

    return () => {
      channel.removeEventListener('message', handler);
      channel.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName]);

  const broadcastRoll = (seed, count) => {
    channelRef.current?.postMessage({ type: 'dice-roll', payload: { seed, count } });
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
};

export default DiceOverlay;
