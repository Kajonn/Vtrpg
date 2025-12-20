import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import * as THREE from 'three';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  DIE_SIZE,
  MAX_STEPS,
  MIN_ROLL_DURATION,
  MAX_ROLL_DURATION,
  DICE_FACE_NORMALS,
  DICE_TYPES,
  DIE_SCALES,
  DIE_DENSITIES,
  useDiceModels,
  setupScene,
  buildBounds,
  prepareDieMesh,
  createColliderForSides,
  mulberry32,
} from './DiceRenderer.jsx';

const DiceOverlay = ({ roomId, diceRoll, onSendDiceRoll, onDiceResult, userName }) => {
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
  const animationRef = useRef(null);
  const pendingRollRef = useRef(null);
  const rollStartedAtRef = useRef(null);
  const [diceCount, setDiceCount] = useState(2);
  const [diceSides, setDiceSides] = useState(6);
  const [status, setStatus] = useState('idle');
  const { diceModels, modelsReady } = useDiceModels();

  const roomKey = useMemo(() => roomId || 'default', [roomId]);
  const channelName = useMemo(() => `vtrpg-dice-${roomKey}`, [roomKey]);

  useEffect(() => {
    if (status !== 'settled' || !onDiceResult) return;

    const world = worldRef.current;
    if (!world) return;

    const results = diceRef.current.map((die) => {
      const body = world.getRigidBody(die.bodyHandle);
      if (!body) return 0;

      const rotation = body.rotation();
      const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);

      // Find the face normal that is most aligned with the Z-axis (up)
      let maxDot = -Infinity;
      let topValue = 0;
      const faceNormals = DICE_FACE_NORMALS[die.sides] || [];

      faceNormals.forEach(({ value, normal }) => {
        const worldNormal = normal.clone().applyQuaternion(quaternion);
        const dot = worldNormal.dot(new THREE.Vector3(0, 0, 1));
        if (dot > maxDot) {
          maxDot = dot;
          topValue = value;
        }
      });
      return topValue;
    });

    if (results.length > 0) {
      onDiceResult(results);
    }
  }, [status, onDiceResult]);

  const teardown = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
    const world = worldRef.current;
    if (world) {
      // Remove all dice
      diceRef.current.forEach((die) => {
        const body = world.getRigidBody(die.bodyHandle);
        if (body) world.removeRigidBody(body);
        sceneRef.current?.remove(die.mesh);
      });
      // Clear the world completely for determinism
      world.free();
      worldRef.current = null;
    }
    diceRef.current = [];
    stepRef.current = 0;
    // Render one final frame to clear the canvas
    renderFrame();
  };

  const initializePhysics = useCallback(async () => {
    if (rapierRef.current && worldRef.current) return;
    const RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();
    rapierRef.current = RAPIER;
    
    const world = new RAPIER.World({ x: 0, y: 0, z: -1200 });
    
    // Set integration parameters explicitly for determinism
    const integrationParameters = world.integrationParameters;
    integrationParameters.dt = 1 / 60; // Match the timestep used in world.step()
    integrationParameters.numSolverIterations = 4;
    integrationParameters.numAdditionalFrictionIterations = 4;
    integrationParameters.numInternalPgsIterations = 1;
    
    worldRef.current = world;
    buildBounds(world, RAPIER);
  }, []);

  const randomInRange = (rng, min, max) => min + (max - min) * rng();

  const randomRotation = (rng) => {
    const euler = new THREE.Euler(randomInRange(rng, 0, Math.PI * 2), randomInRange(rng, 0, Math.PI * 2), randomInRange(rng, 0, Math.PI * 2));
    const quaternion = new THREE.Quaternion();
    quaternion.setFromEuler(euler);
    return quaternion;
  };

  const seedDice = useCallback(async (seed, count, sides) => {
    const RAPIER = rapierRef.current;
    const scene = sceneRef.current;
    if (!RAPIER || !scene) return;

    const modelEntry = diceModels[sides];
    if (!modelEntry) {
      setStatus('loading');
      return;
    }

    const rng = mulberry32(seed);
    teardown();
    
    // Recreate world from scratch for determinism
    const world = new RAPIER.World({ x: 0, y: 0, z: -1200 });
    const integrationParameters = world.integrationParameters;
    integrationParameters.dt = 1 / 60;
    integrationParameters.numSolverIterations = 4;
    integrationParameters.numAdditionalFrictionIterations = 4;
    integrationParameters.numInternalPgsIterations = 1;
    worldRef.current = world;
    buildBounds(world, RAPIER);
    const dice = Array.from({ length: count }, () => {
      const { mesh, geometry, vertices } = prepareDieMesh(modelEntry);
      const rotation = randomRotation(rng);
      return {
        mesh,
        geometry,
        vertices,
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

      const colliderDesc = createColliderForSides(RAPIER, sides, die.vertices);
      colliderDesc.setDensity(DIE_DENSITIES[sides]);

      world.createCollider(colliderDesc, body);
      scene.add(die.mesh);

      return { mesh: die.mesh, bodyHandle: body.handle, sides };
    });

    diceRef.current = preparedDice;
    stepRef.current = 0;
  }, [diceModels]);

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
    world.step(null, 1 / 60); // Fixed 60 FPS timestep for deterministic physics
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
        Math.abs(linvel.x) > 1.6 ||
        Math.abs(linvel.y) > 1.6 ||
        Math.abs(angvel.x) > 0.25 ||
        Math.abs(angvel.y) > 0.25 ||
        Math.abs(angvel.z) > 0.25
      );
    });

    if ((stepRef.current < MAX_STEPS && stillMoving && !exceededDuration) || (!pastMinimumDuration && !exceededDuration)) {
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
      if (!modelsReady || !diceModels[sides]) {
        setStatus('loading');
        pendingRollRef.current = { seed, count, sides };
        return;
      }

      pendingRollRef.current = null;
      setStatus('rolling');
      if (settleTimeoutRef.current) clearTimeout(settleTimeoutRef.current);
      settleTimeoutRef.current = setTimeout(() => setStatus('settled'), 3200);
      await initializePhysics();
      await seedDice(seed, count, sides);
      rollStartedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
      animationRef.current = requestAnimationFrame(tick);
    },
    [initializePhysics, modelsReady, seedDice, diceModels]
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
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sceneSetup = setupScene(canvas);
    if (!sceneSetup) return;

    rendererRef.current = { renderer: sceneSetup.renderer, camera: sceneSetup.camera };
    sceneRef.current = sceneSetup.scene;
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

  const broadcastRoll = (seed, count, sides, triggeredBy) => {
    postLocalRoll(seed, count, sides);
    if (!onSendDiceRoll) return;
    onSendDiceRoll(seed, count, sides, triggeredBy);
  };

  const rollDice = () => {
    const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
    const seed = hasCrypto
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 1_000_000_000) || Date.now();
    const triggeredBy = userName || 'Okänd';
    setStatus('rolling');
    broadcastRoll(seed, diceCount, diceSides, triggeredBy);
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
          <button type="button" onClick={() => setDiceCount((prev) => Math.min(20, prev + 1))} aria-label="increase dice">
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
  onDiceResult: PropTypes.func,
  userName: PropTypes.string,
};

export default DiceOverlay;
