import { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import * as THREE from 'three';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  DIE_SIZE,
  DICE_FACE_NORMALS,
  DICE_TYPES,
  DIE_SCALES,
  DIE_DENSITIES,
  useDiceModels,
  setupScene,
  buildBounds,
  prepareDieMesh,
  createColliderForSides,
  makeTextSprite,
} from './DiceRenderer.jsx';

const DiceDebug = () => {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const rapierRef = useRef(null);
  const worldRef = useRef(null);
  const diceRef = useRef([]);
  const animationRef = useRef(null);
  const { diceModels, modelsReady } = useDiceModels();
  const [selectedDie, setSelectedDie] = useState(null);
  const [rotations, setRotations] = useState({});

  const renderFrame = useCallback(() => {
    const { renderer, camera } = rendererRef.current || {};
    const scene = sceneRef.current;
    if (!renderer || !camera || !scene) return;

    renderer.render(scene, camera);
  }, []);

  const clearScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    diceRef.current.forEach((die) => {
      scene.remove(die.mesh);
      die.mesh.traverse((node) => {
        if (node.isMesh) {
          node.geometry?.dispose();
          node.material?.dispose();
        }
      });
    });

    // Remove all debug visuals (lines and sprites)
    const objectsToRemove = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
        objectsToRemove.push(obj);
      }
    });
    objectsToRemove.forEach((obj) => {
      scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });

    diceRef.current = [];
  }, []);

  const visualizeDice = useCallback(async () => {
    if (!modelsReady) return;

    const RAPIER = rapierRef.current;
    const scene = sceneRef.current;
    if (!RAPIER || !scene) return;

    clearScene();

    // Create world with no gravity for static display
    if (worldRef.current) {
      worldRef.current.free();
    }
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    worldRef.current = world;
    buildBounds(world, RAPIER);

    const spacing = 150;
    const startX = -((DICE_TYPES.length - 1) * spacing) / 2;

    const preparedDice = DICE_TYPES.map((sides, index) => {
      const modelEntry = diceModels[sides];
      if (!modelEntry) return null;

      const { mesh } = prepareDieMesh(modelEntry);
      const position = {
        x: startX + index * spacing,
        y: 0,
        z: 0,
      };

      // Create fixed body to prevent movement
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
      const body = world.createRigidBody(bodyDesc);

      const colliderDesc = createColliderForSides(RAPIER, sides, modelEntry.vertices);
      colliderDesc.setDensity(DIE_DENSITIES[sides]);
      world.createCollider(colliderDesc, body);

      // Set mesh position to match the body
      mesh.position.set(position.x, position.y, position.z);
      
      // Apply rotation to mesh (yaw=Y, pitch=X, roll=Z)
      const rotation = rotations[sides];
      if (rotation) {
        mesh.rotation.order = 'YXZ';
        mesh.rotation.set(rotation.pitch || 0, rotation.yaw || 0, rotation.roll || 0);
      }
      
      scene.add(mesh);

      // Add debug visuals for normals (no rotation applied to normals)
      const faceNormals = DICE_FACE_NORMALS[sides] || [];
      faceNormals.forEach(({ value, normal }) => {
        // Skip normals with negative z (facing away from camera)
        if (normal.z < 0) return;
        
        // Create colored line for each face normal
        const color = new THREE.Color().setHSL(value / sides, 0.8, 0.6);
        const lineMaterial = new THREE.LineBasicMaterial({ color });
        
        const endPoint = normal.clone().multiplyScalar(DIE_SCALES[sides] * 1.2);
        const points = [new THREE.Vector3(0, 0, 0), endPoint];
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(lineGeometry, lineMaterial);
        line.position.copy(new THREE.Vector3(position.x, position.y, position.z));
        scene.add(line);

        // Add text label at the end of the line
        const sprite = makeTextSprite(String(value), {
          fontsize: 24,
          textColor: { r: 255, g: 255, b: 255, a: 1.0 },
        });
        sprite.position.set(position.x + endPoint.x, position.y + endPoint.y, position.z + endPoint.z);
        scene.add(sprite);
      });

      // Add die type label below the die
      const dieLabel = makeTextSprite(`d${sides}`, {
        fontsize: 28,
        textColor: { r: 200, g: 200, b: 200, a: 1.0 },
      });
      dieLabel.position.set(position.x, position.y - DIE_SCALES[sides] * 1.5, position.z);
      scene.add(dieLabel);

      return { mesh, bodyHandle: body.handle, sides, position };
    }).filter(Boolean);

    diceRef.current = preparedDice;
    renderFrame();
  }, [modelsReady, diceModels, clearScene, renderFrame, rotations]);

  useEffect(() => {
    const initializePhysics = async () => {
      if (rapierRef.current) return;
      const RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();
      rapierRef.current = RAPIER;
    };

    const canvas = canvasRef.current;
    if (!canvas) return;

    const sceneSetup = setupScene(canvas);
    if (!sceneSetup) return;

    rendererRef.current = { renderer: sceneSetup.renderer, camera: sceneSetup.camera };
    sceneRef.current = sceneSetup.scene;

    initializePhysics();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      clearScene();
      if (worldRef.current) {
        worldRef.current.free();
        worldRef.current = null;
      }
      rendererRef.current?.renderer?.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
    };
  }, [clearScene]);

  useEffect(() => {
    if (modelsReady && rapierRef.current) {
      visualizeDice();
    }
  }, [modelsReady, visualizeDice]);

  const rotateDie = (sides, axis, amount) => {
    setRotations(prev => {
      const current = prev[sides] || { yaw: 0, pitch: 0, roll: 0 };
      return {
        ...prev,
        [sides]: {
          ...current,
          [axis]: current[axis] + amount,
        },
      };
    });
  };

  const resetRotation = (sides) => {
    setRotations(prev => {
      const newRotations = { ...prev };
      delete newRotations[sides];
      return newRotations;
    });
  };

  const logNormals = () => {
    console.log('=== DICE FACE NORMALS (Copy this to DiceRenderer.jsx) ===\n');
    
    const output = {};
    DICE_TYPES.forEach(sides => {
      const rotation = rotations[sides];
      const faceNormals = DICE_FACE_NORMALS[sides] || [];
      
      output[sides] = faceNormals;
      
      const rotationInfo = rotation 
        ? `\n  // Mesh rotation: Yaw=${(rotation.yaw * 180 / Math.PI).toFixed(1)}° Pitch=${(rotation.pitch * 180 / Math.PI).toFixed(1)}° Roll=${(rotation.roll * 180 / Math.PI).toFixed(1)}°`
        : '';
      
      const formatted = `  ${sides}: [${rotationInfo}\n${faceNormals.map(({ value, normal }) => 
        `    { value: ${value}, normal: new THREE.Vector3(${normal.x.toFixed(3)}, ${normal.y.toFixed(3)}, ${normal.z.toFixed(3)}) },`
      ).join('\n')}\n  ],`;
      
      console.log(formatted);
    });
    
    console.log('\n=== END ===');
    return output;
  };

  const statusLabel = !modelsReady ? 'Loading dice models...' : 'Debug view: Face normal visualization';

  return (
    <div className="dice-overlay" aria-label="dice-debug">
      <canvas
        ref={canvasRef}
        className="dice-canvas"
        width={ARENA_WIDTH}
        height={ARENA_HEIGHT}
        aria-label="dice-debug-canvas"
      />
      <div className="dice-controls" aria-live="polite" style={{ maxHeight: '580px', overflowY: 'auto' }}>
        <div className="dice-status" data-state={!modelsReady ? 'loading' : 'debug'}>
          {statusLabel}
        </div>
        <button type="button" onClick={visualizeDice} aria-label="refresh debug view" disabled={!modelsReady}>
          Refresh
        </button>
        <button 
          type="button" 
          onClick={logNormals} 
          aria-label="log normals" 
          disabled={!modelsReady}
          style={{ 
            backgroundColor: '#4CAF50', 
            color: 'white', 
            fontWeight: 'bold',
            padding: '8px 16px'
          }}
        >
          Log Normals to Console
        </button>
        
        <div style={{ marginTop: '20px', borderTop: '1px solid #ccc', paddingTop: '10px' }}>
          <label htmlFor="die-select" style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Select Die to Rotate:
          </label>
          <select 
            id="die-select"
            value={selectedDie || ''} 
            onChange={(e) => setSelectedDie(e.target.value ? parseInt(e.target.value) : null)}
            style={{ width: '100%', padding: '6px', marginBottom: '12px' }}
          >
            <option value="">-- Select a die --</option>
            {DICE_TYPES.map(sides => (
              <option key={sides} value={sides}>d{sides}</option>
            ))}
          </select>
          
          {selectedDie && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <strong>Yaw (Y-axis, left/right):</strong>
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <button onClick={() => rotateDie(selectedDie, 'yaw', -Math.PI / 12)}>-15°</button>
                  <button onClick={() => rotateDie(selectedDie, 'yaw', -Math.PI / 24)}>-7.5°</button>
                  <button onClick={() => rotateDie(selectedDie, 'yaw', Math.PI / 24)}>+7.5°</button>
                  <button onClick={() => rotateDie(selectedDie, 'yaw', Math.PI / 12)}>+15°</button>
                </div>
              </div>
              
              <div>
                <strong>Pitch (X-axis, up/down):</strong>
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <button onClick={() => rotateDie(selectedDie, 'pitch', -Math.PI / 12)}>-15°</button>
                  <button onClick={() => rotateDie(selectedDie, 'pitch', -Math.PI / 24)}>-7.5°</button>
                  <button onClick={() => rotateDie(selectedDie, 'pitch', Math.PI / 24)}>+7.5°</button>
                  <button onClick={() => rotateDie(selectedDie, 'pitch', Math.PI / 12)}>+15°</button>
                </div>
              </div>
              
              <div>
                <strong>Roll (Z-axis, tilt):</strong>
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <button onClick={() => rotateDie(selectedDie, 'roll', -Math.PI / 12)}>-15°</button>
                  <button onClick={() => rotateDie(selectedDie, 'roll', -Math.PI / 24)}>-7.5°</button>
                  <button onClick={() => rotateDie(selectedDie, 'roll', Math.PI / 24)}>+7.5°</button>
                  <button onClick={() => rotateDie(selectedDie, 'roll', Math.PI / 12)}>+15°</button>
                </div>
              </div>
              
              <button 
                onClick={() => resetRotation(selectedDie)} 
                style={{ marginTop: '8px', backgroundColor: '#f44336', color: 'white' }}
              >
                Reset d{selectedDie} Rotation
              </button>
              
              <div style={{ fontSize: '12px', marginTop: '8px', color: '#666' }}>
                Current: Yaw={((rotations[selectedDie]?.yaw || 0) * 180 / Math.PI).toFixed(1)}° 
                Pitch={((rotations[selectedDie]?.pitch || 0) * 180 / Math.PI).toFixed(1)}° 
                Roll={((rotations[selectedDie]?.roll || 0) * 180 / Math.PI).toFixed(1)}°
              </div>
            </div>
          )}
        </div>
        
        <div className="debug-info" style={{ marginTop: '20px', fontSize: '12px' }}>
          <p><strong>Instructions:</strong></p>
          <p>1. Select a die from the dropdown</p>
          <p>2. Use rotation buttons to align face normals</p>
          <p>3. Click "Log Normals to Console" to copy updated values</p>
          <p>4. Check browser console (F12) for formatted output</p>
        </div>
      </div>
    </div>
  );
};

DiceDebug.propTypes = {};

export default DiceDebug;
