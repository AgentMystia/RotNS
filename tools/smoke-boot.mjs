// 启动冒烟：最小 DOM 桩下执行浏览器 bundle（构造 Renderer、占位贴图、标题绘制、
// 场景切换、RotnsScene.update/draw 若干帧），捕获 boot 期异常。
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'tmp', 'smoke-bundle.cjs');
await build({
  entryPoints: [path.join(root, 'src/main.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'silent',
});

// —— DOM 桩 ——
const gradient = { addColorStop() {} };
function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => gradient;
      if (k === 'createPattern') return () => ({});
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === 'getContextAttributes') return () => ({ desynchronized: false });
      if (k === 'canvas') return {};
      if (typeof t[k] !== 'undefined') return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeCanvas() {
  return {
    width: 640, height: 480,
    getContext: () => makeCtx(),
    addEventListener() {},
  };
}
const listeners = {};
globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => makeCanvas(),
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : {}),
};
globalThis.addEventListener = (name, fn) => { (listeners[name] ??= []).push(fn); };
globalThis.Image = class {
  set src(_v) { setTimeout(() => this.onerror?.(), 0); }
};
globalThis.location = { search: '?ai=1&seed=5' };
globalThis.performance ??= { now: () => Date.now() };
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };

await import(pathToFileURL(outfile).href);
console.log('[smoke] bundle imported & boot() ran');

// 驱动 300 帧（标题→AI 战）
let t = 0;
for (let i = 0; i < 300; i++) {
  const cb = rafCb;
  if (!cb) break;
  rafCb = null;
  t += 16.7;
  cb(t);
}
await new Promise((r) => setTimeout(r, 20));
for (let i = 0; i < 600; i++) {
  const cb = rafCb;
  if (!cb) break;
  rafCb = null;
  t += 16.7;
  cb(t);
}
console.log('[smoke] 900 frames driven, no crash — boot OK');
