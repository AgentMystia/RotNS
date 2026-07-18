// headless 基准入口（node）：null renderer + 直接循环 scene.update()（PLAN §6.6）。
// 确定性冒烟：同 seed 两次 update 序列 hash 相等。
import { RotnsScene, type FrameInput, type InputSource } from './scene';
import { AiController } from './ai/controller';
import { CFG } from './config';

export interface RunResult {
  seed: number;
  cleared: boolean;
  miss: number;
  bombsUsed: number;
  hypersUsed: number;
  graze: number;
  frames: number;
  phaseReached: number;
  maxAiMs: number;
  p95AiMs: number;
}

export interface BenchResult {
  runs: RunResult[];
  clearRate: number;
  noMissRuns: number;
  avgGraze: number;
  maxAiMs: number;
  determinismOk: boolean;
}

function hashScene(scene: RotnsScene, h: number): number {
  const p = scene.pool;
  let hash = h >>> 0;
  const mix = (v: number) => {
    hash ^= (v * 2654435761) >>> 0;
    hash = ((hash << 5) | (hash >>> 27)) >>> 0;
  };
  mix(p.n);
  for (let i = 0; i < p.n; i++) {
    mix(Math.round(p.x[i] * 16));
    mix(Math.round(p.y[i] * 16));
    mix(p.sprite[i]);
  }
  const r = scene.result;
  mix(r.score & 0xffffff);
  return hash >>> 0;
}

export function runOne(seed: number, aiSeed: number, maxFrames: number): RunResult {
  const controller = new AiController(aiSeed);
  controller.enabled = true;
  let scene!: RotnsScene;
  let maxAiMs = 0;
  const samples: number[] = [];
  const source: InputSource = {
    frame(): FrameInput {
      const t0 = performance.now();
      const f = controller.frame(scene.aiView());
      const dt = performance.now() - t0;
      if (dt > maxAiMs) maxAiMs = dt;
      if (samples.length < 40000) samples.push(dt);
      return f;
    },
  };
  scene = new RotnsScene({ input: source, events: null, seed, fx: false });
  let frames = 0;
  while (!scene.done && frames < maxFrames) {
    scene.update();
    frames += 1;
  }
  samples.sort((a, b) => a - b);
  const p95 = samples.length ? samples[Math.floor(samples.length * 0.95)] : 0;
  const r = scene.result;
  return {
    seed,
    cleared: r.mode === 'clear',
    miss: r.miss,
    bombsUsed: r.bombsUsed,
    hypersUsed: r.hypersUsed,
    graze: r.graze,
    frames,
    phaseReached: scene.aiView().phaseIndex,
    maxAiMs,
    p95AiMs: p95,
  };
}

export function checkDeterminism(seed: number, aiSeed: number, frames: number): boolean {
  const run = (): number => {
    const controller = new AiController(aiSeed);
    controller.enabled = true;
    let scene!: RotnsScene;
    const source: InputSource = { frame: () => controller.frame(scene.aiView()) };
    scene = new RotnsScene({ input: source, events: null, seed, fx: false });
    let h = 0x9e3779b9;
    for (let i = 0; i < frames && !scene.done; i++) {
      scene.update();
      h = hashScene(scene, h);
    }
    return h;
  };
  return run() === run();
}

export function runBench(seeds: number[], aiSeed: number, maxFrames = 20000): BenchResult {
  const runs: RunResult[] = [];
  for (const seed of seeds) runs.push(runOne(seed, aiSeed, maxFrames));
  const clears = runs.filter((r) => r.cleared).length;
  const noMiss = runs.filter((r) => r.cleared && r.miss === 0).length;
  return {
    runs,
    clearRate: clears / runs.length,
    noMissRuns: noMiss,
    avgGraze: runs.reduce((a, r) => a + r.graze, 0) / runs.length,
    maxAiMs: Math.max(...runs.map((r) => r.maxAiMs)),
    determinismOk: checkDeterminism(seeds[0], aiSeed, Math.min(6000, maxFrames)),
  };
}

export const BENCH_CONFIG = CFG.ai;
