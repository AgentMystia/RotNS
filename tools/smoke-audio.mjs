// 音频配方冒烟：桩 AudioContext 下调用全部 sfx 配方与 BGM 调度，抓拼写/参数错误。
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'tmp', 'audio-smoke.mjs');
await build({
  entryPoints: [path.join(root, 'src/rotns/audio-synth.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
});
const { AudioSynth } = await import(pathToFileURL(outfile).href);

// —— WebAudio 桩 ——
const node = () => ({
  connect() {}, start() {}, stop() {},
  gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
  frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
  threshold: { value: 0 }, ratio: { value: 0 },
  type: '', buffer: null,
});
class FakeAC {
  state = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  createOscillator() { return node(); }
  createGain() { return node(); }
  createDynamicsCompressor() { return node(); }
  createBiquadFilter() { return node(); }
  createBufferSource() { return node(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  resume() { return Promise.resolve(); }
}
globalThis.window = { AudioContext: FakeAC };

const synth = new AudioSynth();
synth.unlock();
const names = ['shot', 'graze', 'enemyHit', 'bomb', 'hyper', 'cancelStar', 'death', 'warning', 'spellDeclare', 'phaseBreak'];
for (const n of names) synth.sfx(n);
synth.bgm('boss');
await new Promise((r) => setTimeout(r, 300)); // 让调度器真实排程若干拍
synth.bgm('finale');
await new Promise((r) => setTimeout(r, 300));
synth.bgm(null);
synth.toggleMute();
synth.toggleMute();
for (const n of names) synth.sfx(n); // 静音路径
console.log('[audio-smoke] all sfx recipes + bgm scheduler OK');
process.exit(0);
