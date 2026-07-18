// 视觉验证：node-canvas 下运行真实 Renderer + 场景 draw，输出 PNG 帧。
// 用法: node tools/render-frames.mjs [title|fight|finale|warning] [outPrefix]
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createCanvas, loadImage, Image as NCImage } from 'canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'tmp', 'render-entry.mjs');
await build({
  entryPoints: [path.join(root, 'src/rotns/render-entry.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
});
const mod = await import(pathToFileURL(outfile).href);

const mode = process.argv[2] ?? 'fight';
const outPrefix = process.argv[3] ?? mode;
const outDir = path.join(root, 'tmp', 'frames');
fs.mkdirSync(outDir, { recursive: true });

// —— DOM 桩（真实像素路径：node-canvas）——
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
// node-canvas 的 Image 与 HTMLImageElement 不同类，Renderer 的 tintCache 用 instanceof 判断——
// 让加载的图像表现为"可缓存"：node-canvas Image 本身就是独立位图，直接可用。

const frames = await mod.renderFrames(mode, createCanvas, 640, 480);
for (const [name, canvas] of frames) {
  const p = path.join(outDir, `${outPrefix}-${name}.png`);
  fs.writeFileSync(p, canvas.toBuffer('image/png'));
  console.log('wrote', p);
}
