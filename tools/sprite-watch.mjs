// 精灵消失复现：逐帧渲染完整对局，采样自机/敌机/判定点区域最大亮度，
// 排除设计性不可见状态（死亡/入场/爆散），报告异常空白帧。
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createCanvas, Image as NCImage } from 'canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'tmp', 'watch-entry.mjs');
await build({
  entryPoints: [path.join(root, 'src/rotns/watch-entry.ts')],
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
const report = await mod.watch(createCanvas, Number(process.argv[2] ?? 5));
console.log(report);
