// headless 通关率基准（PLAN §6.6）：esbuild 打包 bench-entry 后 node 直跑。
// 用法: npm run ai:bench [-- --seeds 1..30 --aiSeed 7 --maxFrames 20000]
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'tmp', 'bench-entry.mjs');

await build({
  entryPoints: [path.join(root, 'src/rotns/bench-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});

const mod = await import(pathToFileURL(outfile).href);

const args = process.argv.slice(2);
function argNum(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
}
let seeds = [];
const seedsArg = args.find((a) => a.startsWith('--seeds='));
if (seedsArg) {
  const spec = seedsArg.slice(8);
  if (spec.includes(',')) {
    seeds = spec.split(',').map(Number);
  } else {
    const [a, b] = spec.split('..').map(Number);
    for (let s = a; s <= b; s++) seeds.push(s);
  }
} else {
  for (let s = 1; s <= 30; s++) seeds.push(s);
}
const aiSeed = argNum('aiSeed', 7);
const maxFrames = argNum('maxFrames', 20000);

console.log(`[bench] seeds=${seeds[0]}..${seeds[seeds.length - 1]} aiSeed=${aiSeed} maxFrames=${maxFrames}`);
const t0 = performance.now();
const res = mod.runBench(seeds, aiSeed, maxFrames);
const wall = ((performance.now() - t0) / 1000).toFixed(1);

const phaseName = ['P1', 'P2', 'P3', 'P4', 'FIN'];
console.log('seed  result  miss bomb hyper graze  frames  phase  aiMs  p95ms');
for (const r of res.runs) {
  console.log(
    String(r.seed).padStart(4),
    (r.cleared ? 'CLEAR ' : 'DEAD  '),
    String(r.miss).padStart(4),
    String(r.bombsUsed).padStart(4),
    String(r.hypersUsed).padStart(5),
    String(r.graze).padStart(5),
    String(r.frames).padStart(7),
    (phaseName[Math.min(r.phaseReached, 4)] ?? '?').padStart(4),
    r.maxAiMs.toFixed(1).padStart(5),
    r.p95AiMs.toFixed(2).padStart(5),
  );
}
console.log('---');
console.log(`通关率: ${(res.clearRate * 100).toFixed(1)}%  (验收线 ≥85%)`);
console.log(`no-miss 局数: ${res.noMissRuns}  (验收线 ≥1)`);
const p95All = Math.max(...res.runs.map((r) => r.p95AiMs));
console.log(`平均 graze: ${res.avgGraze.toFixed(0)}  单帧最大AI耗时: ${res.maxAiMs.toFixed(2)}ms  p95: ${p95All.toFixed(2)}ms  (验收线 p95<6ms)`);
console.log(`确定性: ${res.determinismOk ? 'OK' : 'FAIL'}`);
console.log(`wall: ${wall}s  (≈${((res.runs.reduce((a, r) => a + r.frames, 0) / 60) / Number(wall)).toFixed(0)}x 实时)`);
process.exit(res.clearRate >= 0.85 && res.noMissRuns >= 1 && p95All < 6 && res.determinismOk ? 0 : 1);
