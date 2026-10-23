import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const vadDirectory = dirname(require.resolve('@ricky0123/vad-web'));
const destination = new URL('../public/speech/', import.meta.url);
const assets = [
  join(vadDirectory, 'vad.worklet.bundle.min.js'),
  join(vadDirectory, 'silero_vad_v5.onnx'),
  require.resolve('onnxruntime-web/ort-wasm-simd-threaded.mjs'),
  require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'),
];

await mkdir(destination, { recursive: true });
await Promise.all(
  assets.map((source) => copyFile(source, new URL(basename(source), destination))),
);
console.log('[speech] Local voice detection assets ready');
