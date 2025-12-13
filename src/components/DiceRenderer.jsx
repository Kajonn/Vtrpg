import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const createShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile failed', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const createProgram = (gl, vertexSource, fragmentSource) => {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program failed to link', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
};

const perspective = (fov, aspect, near, far) => {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * nf,
    -1,
    0,
    0,
    2 * far * near * nf,
    0,
  ];
};

const normalize = (vector) => {
  const len = Math.hypot(...vector);
  return len > 0 ? vector.map((v) => v / len) : [0, 0, 0];
};

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const scaleVec = (v, s) => v.map((value) => value * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const lookAt = (eye, target, up) => {
  const zAxis = normalize(subtract(eye, target));
  const xAxis = normalize(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);
  return [
    xAxis[0],
    yAxis[0],
    zAxis[0],
    0,
    xAxis[1],
    yAxis[1],
    zAxis[1],
    0,
    xAxis[2],
    yAxis[2],
    zAxis[2],
    0,
    -dot(xAxis, eye),
    -dot(yAxis, eye),
    -dot(zAxis, eye),
    1,
  ];
};

const multiply = (a, b) => {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[row + 4] * b[col * 4 + 1] +
        a[row + 8] * b[col * 4 + 2] +
        a[row + 12] * b[col * 4 + 3];
    }
  }
  return out;
};

const quaternionToMatrix = (q, position) => {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return [
    1 - (yy + zz),
    xy + wz,
    xz - wy,
    0,
    xy - wz,
    1 - (xx + zz),
    yz + wx,
    0,
    xz + wy,
    yz - wx,
    1 - (xx + yy),
    0,
    position[0],
    position[1],
    position[2],
    1,
  ];
};

const integrateQuaternion = (q, angularVelocity, dt) => {
  const [x, y, z, w] = q;
  const [ax, ay, az] = angularVelocity;
  const halfDt = 0.5 * dt;
  const nx = x + halfDt * (ax * w + ay * z - az * y);
  const ny = y + halfDt * (-ax * z + ay * w + az * x);
  const nz = z + halfDt * (ax * y - ay * x + az * w);
  const nw = w + halfDt * (-ax * x - ay * y - az * z);
  const mag = Math.hypot(nx, ny, nz, nw) || 1;
  return [nx / mag, ny / mag, nz / mag, nw / mag];
};

const mulberry32 = (seed) => {
  let t = seed + 0x6d2b79f5;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const DiceRenderer = ({ count, seed, rollId }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    if (!gl) return undefined;

    const vertexSource = `
      attribute vec3 position;
      attribute vec3 color;
      uniform mat4 u_mvp;
      varying vec3 vColor;
      void main() {
        vColor = color;
        gl_Position = u_mvp * vec4(position, 1.0);
      }
    `;

    const fragmentSource = `
      precision mediump float;
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
      }
    `;

    const program = createProgram(gl, vertexSource, fragmentSource);
    if (!program) return undefined;

    const positionLocation = gl.getAttribLocation(program, 'position');
    const colorLocation = gl.getAttribLocation(program, 'color');
    const mvpLocation = gl.getUniformLocation(program, 'u_mvp');

    const cubePositions = [
      // Front
      -0.5, -0.5, 0.5,
      0.5, -0.5, 0.5,
      0.5, 0.5, 0.5,
      -0.5, -0.5, 0.5,
      0.5, 0.5, 0.5,
      -0.5, 0.5, 0.5,
      // Back
      -0.5, -0.5, -0.5,
      -0.5, 0.5, -0.5,
      0.5, 0.5, -0.5,
      -0.5, -0.5, -0.5,
      0.5, 0.5, -0.5,
      0.5, -0.5, -0.5,
      // Left
      -0.5, -0.5, -0.5,
      -0.5, -0.5, 0.5,
      -0.5, 0.5, 0.5,
      -0.5, -0.5, -0.5,
      -0.5, 0.5, 0.5,
      -0.5, 0.5, -0.5,
      // Right
      0.5, -0.5, -0.5,
      0.5, 0.5, -0.5,
      0.5, 0.5, 0.5,
      0.5, -0.5, -0.5,
      0.5, 0.5, 0.5,
      0.5, -0.5, 0.5,
      // Top
      -0.5, 0.5, -0.5,
      -0.5, 0.5, 0.5,
      0.5, 0.5, 0.5,
      -0.5, 0.5, -0.5,
      0.5, 0.5, 0.5,
      0.5, 0.5, -0.5,
      // Bottom
      -0.5, -0.5, -0.5,
      0.5, -0.5, -0.5,
      0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5,
      0.5, -0.5, 0.5,
      -0.5, -0.5, 0.5,
    ];

    const facePalette = [
      [0.93, 0.27, 0.36],
      [0.26, 0.67, 0.93],
      [0.83, 0.79, 0.26],
      [0.27, 0.93, 0.55],
      [0.89, 0.49, 0.93],
      [0.93, 0.62, 0.27],
    ];
    const colors = facePalette.flatMap((color) => Array.from({ length: 6 }, () => color).flat());

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cubePositions), gl.STATIC_DRAW);

    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    const rng = mulberry32((seed || 1) >>> 0);
    const randomRange = (min, max) => min + (max - min) * rng();

    const dice = Array.from({ length: count }, (_, index) => ({
      position: [randomRange(-2, 2), 4 + index, randomRange(-2, 2)],
      velocity: [randomRange(-3, 3), 6 + randomRange(0, 2), randomRange(-3, 3)],
      quaternion: [0, 0, 0, 1],
      angularVelocity: [randomRange(-2, 2), randomRange(-2, 2), randomRange(-2, 2)],
    }));

    const gravity = [0, -9.8, 0];
    const bounds = 6;
    const halfSize = 0.5;
    const restitution = 0.6;
    const friction = 0.99;

    let width = canvas.clientWidth || 1;
    let height = canvas.clientHeight || 1;
    const resize = () => {
      width = canvas.clientWidth || 1;
      height = canvas.clientHeight || 1;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    let lastTime;
    let accumulator = 0;
    const fixedDt = 1 / 60;
    const maxDelta = 0.1;

    const stepPhysics = (dt) => {
      dice.forEach((die) => {
        die.velocity = add(die.velocity, scaleVec(gravity, dt));
        die.position = add(die.position, scaleVec(die.velocity, dt));
        die.quaternion = integrateQuaternion(die.quaternion, die.angularVelocity, dt);

        // Ground
        if (die.position[1] - halfSize < 0) {
          die.position[1] = halfSize;
          if (die.velocity[1] < 0) die.velocity[1] = -die.velocity[1] * restitution;
          die.velocity[0] *= friction;
          die.velocity[2] *= friction;
          die.angularVelocity = scaleVec(die.angularVelocity, friction);
        }
        // Walls X
        if (die.position[0] + halfSize > bounds) {
          die.position[0] = bounds - halfSize;
          die.velocity[0] = -Math.abs(die.velocity[0]) * restitution;
        } else if (die.position[0] - halfSize < -bounds) {
          die.position[0] = -bounds + halfSize;
          die.velocity[0] = Math.abs(die.velocity[0]) * restitution;
        }
        // Walls Z
        if (die.position[2] + halfSize > bounds) {
          die.position[2] = bounds - halfSize;
          die.velocity[2] = -Math.abs(die.velocity[2]) * restitution;
        } else if (die.position[2] - halfSize < -bounds) {
          die.position[2] = -bounds + halfSize;
          die.velocity[2] = Math.abs(die.velocity[2]) * restitution;
        }

        die.velocity = scaleVec(die.velocity, 0.999);
        die.angularVelocity = scaleVec(die.angularVelocity, 0.995);
      });

      for (let i = 0; i < dice.length; i += 1) {
        for (let j = i + 1; j < dice.length; j += 1) {
          const a = dice[i];
          const b = dice[j];
          const diff = subtract(b.position, a.position);
          const distance = Math.hypot(...diff);
          const minDistance = halfSize * 2;
          if (distance < minDistance && distance > 0) {
            const normal = diff.map((v) => v / distance);
            const overlap = minDistance - distance;
            const correction = scaleVec(normal, overlap / 2);
            a.position = subtract(a.position, correction);
            b.position = add(b.position, correction);
            const relativeVelocity = dot(subtract(b.velocity, a.velocity), normal);
            if (relativeVelocity < 0) {
              const impulse = -(1 + restitution) * relativeVelocity * 0.5;
              const impulseVector = scaleVec(normal, impulse);
              a.velocity = subtract(a.velocity, impulseVector);
              b.velocity = add(b.velocity, impulseVector);
            }
          }
        }
      }
    };

    const cameraPosition = [0, 5.5, 14];
    const cameraTarget = [0, 2.5, 0];
    const projectionBase = () => perspective(Math.PI / 4, width / height, 0.1, 100);

    let frame;
    const render = (timestamp) => {
      if (lastTime === undefined) {
        lastTime = timestamp;
      }
      const delta = Math.min((timestamp - lastTime) / 1000, maxDelta);
      lastTime = timestamp;
      accumulator += delta;

      while (accumulator >= fixedDt) {
        stepPhysics(fixedDt);
        accumulator -= fixedDt;
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.enableVertexAttribArray(colorLocation);
      gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);

      const projection = projectionBase();
      const view = lookAt(cameraPosition, cameraTarget, [0, 1, 0]);

      dice.forEach((die) => {
        const model = quaternionToMatrix(die.quaternion, die.position);
        const vp = multiply(view, model);
        const mvp = multiply(projection, vp);
        gl.uniformMatrix4fv(mvpLocation, false, new Float32Array(mvp));
        gl.drawArrays(gl.TRIANGLES, 0, 36);
      });

      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(colorBuffer);
      gl.deleteProgram(program);
    };
  }, [count, rollId, seed]);

  return (
    <canvas
      ref={canvasRef}
      className="dice-overlay"
      aria-hidden="true"
      data-roll-id={rollId}
      data-seed={seed}
    />
  );
};

DiceRenderer.propTypes = {
  count: PropTypes.number.isRequired,
  seed: PropTypes.number.isRequired,
  rollId: PropTypes.number.isRequired,
};

export default DiceRenderer;
