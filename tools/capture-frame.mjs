// 定点抓帧：跑到指定帧，输出自机周边放大裁片。
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createCanvas, Image as NCImage } from 'canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'tmp', 'capture-entry.mjs');
await build({
  entryPoints: [path.join(root, 'src/rotns/capture-entry.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
});
globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => createCanvas(640, 480),
  createElement: (tag) => (tag === 'canvas' ? createCanvas(1, 1) : {}),
};
globalThis.addEventListener = () => {};
globalThis.Image = class extends NCImage {
  set src(v) { super.src = path.join(root, v); }
  get src() { return super.src; }
};
globalThis.location = { search: '' };
globalThis.performance ??= { now: () => Date.now() };

const mod = await import(pathToFileURL(outfile).href);
const frame = Number(process.argv[2] ?? 13193);
const out = await mod.capture(createCanvas, frame);
const p = path.join(root, 'tmp', 'frames', `capture-${frame}.png`);
fs.mkdirSync(path.dirname(p), { recursive: true });
fs.writeFileSync(p, out);
console.log('wrote', p);
