// 调试：输出首条命最后 80 帧的 AI 决策 vs 实际威胁，定位 sim/reality 分歧。
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'tmp', 'debug-entry.mjs');

await build({
  entryPoints: [path.join(root, 'src/rotns/debug-entry.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});
const mod = await import(pathToFileURL(outfile).href);
const trace = mod.traceDeath(Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 7));
fs.writeFileSync(path.join(root, 'tmp', 'death-trace.txt'), trace);
console.log(trace.split('\n').slice(-90).join('\n'));
