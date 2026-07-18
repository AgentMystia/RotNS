// 对拍工具入口
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'tmp', 'diff-entry.mjs');
await build({
  entryPoints: [path.join(root, 'src/rotns/diff-entry.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
});
const mod = await import(pathToFileURL(outfile).href);
console.log(mod.diffTest(Number(process.argv[2] ?? 1), Number(process.argv[3] ?? 7), Number(process.argv[4] ?? 9327)));
