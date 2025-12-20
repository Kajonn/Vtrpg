import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Blob } from 'buffer';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = Blob;
}

if (typeof globalThis.FileReader === 'undefined') {
  class SimpleFileReader {
    constructor() {
      this.onloadend = null;
      this.result = null;
    }

    async readAsArrayBuffer(blob) {
      this.result = await blob.arrayBuffer();
      if (this.onloadend) this.onloadend();
    }

    async readAsDataURL(blob) {
      const buffer = Buffer.from(await blob.arrayBuffer());
      const base64data = buffer.toString('base64');
      const mime = blob.type || 'application/octet-stream';
      this.result = `data:${mime};base64,${base64data}`;
      if (this.onloadend) this.onloadend();
    }
  }

  globalThis.FileReader = SimpleFileReader;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'src', 'assets', 'dice');

const DIE_SIZE = 32;

const createPentagonalTrapezohedronGeometry = (radius) => {
  const top = [0, 1, 0];
  const bottom = [0, -1, 0];
  const ringTop = [];
  const ringBottom = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    ringTop.push([Math.cos(angle), 0.2, Math.sin(angle)]);
    const offsetAngle = angle + Math.PI / 5;
    ringBottom.push([Math.cos(offsetAngle), -0.2, Math.sin(offsetAngle)]);
  }

  const vertices = [top, ...ringTop, ...ringBottom, bottom].flat();
  const topIndex = 0;
  const bottomIndex = 11;
  const indices = [];

  for (let i = 0; i < 5; i += 1) {
    const next = (i + 1) % 5;
    const upper = 1 + i;
    const lower = 6 + i;
    const lowerNext = 6 + next;
    const upperNext = 1 + next;

    indices.push(topIndex, upper, lower);
    indices.push(topIndex, lower, upperNext);
    indices.push(bottomIndex, lower, upper);
    indices.push(bottomIndex, upper, lowerNext);
  }

  return new THREE.PolyhedronGeometry(vertices, indices, radius, 0);
};

const DICE_SHAPES = {
  4: () => new THREE.TetrahedronGeometry(DIE_SIZE * 0.85),
  6: () => new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE),
  8: () => new THREE.OctahedronGeometry(DIE_SIZE * 0.82),
  10: () => createPentagonalTrapezohedronGeometry(DIE_SIZE * 0.88),
  12: () => new THREE.DodecahedronGeometry(DIE_SIZE * 0.88),
  20: () => new THREE.IcosahedronGeometry(DIE_SIZE * 0.88),
};

const MATERIALS = {
  4: new THREE.MeshStandardMaterial({ color: 0xe57373, metalness: 0.2, roughness: 0.55 }),
  6: new THREE.MeshStandardMaterial({ color: 0x64b5f6, metalness: 0.2, roughness: 0.55 }),
  8: new THREE.MeshStandardMaterial({ color: 0x4db6ac, metalness: 0.2, roughness: 0.55 }),
  10: new THREE.MeshStandardMaterial({ color: 0xffb74d, metalness: 0.2, roughness: 0.55 }),
  12: new THREE.MeshStandardMaterial({ color: 0xba68c8, metalness: 0.2, roughness: 0.55 }),
  20: new THREE.MeshStandardMaterial({ color: 0xa1887f, metalness: 0.2, roughness: 0.55 }),
};

const exporter = new GLTFExporter();

const exportDie = async (sides) => {
  const geometryFactory = DICE_SHAPES[sides];
  if (!geometryFactory) throw new Error(`No geometry defined for d${sides}`);
  const geometry = geometryFactory();
  geometry.computeVertexNormals();
  const material = MATERIALS[sides] || MATERIALS[6];
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return new Promise((resolve, reject) => {
    exporter.parse(
      mesh,
      async (result) => {
        try {
          const json = JSON.stringify(result, null, 2);
          const outputPath = path.join(outputDir, `d${sides}.gltf`);
          await writeFile(outputPath, json, 'utf8');
          resolve(outputPath);
        } catch (err) {
          reject(err);
        }
      },
      (error) => reject(error),
      { binary: false }
    );
  });
};

const run = async () => {
  await mkdir(outputDir, { recursive: true });
  const dice = [4, 6, 8, 10, 12, 20];
  for (const sides of dice) {
    const outputPath = await exportDie(sides);
    console.log(`Exported d${sides} to ${outputPath}`);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
