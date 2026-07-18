// sim vs reality 对拍（干净版）：单 scene 重放，captureFrame 后切换为静止输入，
// 对比 planner 对静止策略的预测 tHit 与实际存活帧数。
import { RotnsScene, type FrameInput, type InputSource } from './scene';
import { AiController } from './ai/controller';
import { Planner } from './ai/planner';
import { CFG } from './config';
import type { AiView } from './types';

const HOLD: FrameInput = { held: new Set(['shoot'] as never), pressed: new Set() };

export function diffTest(seed: number, aiSeed: number, captureFrame: number): string {
  const controller = new AiController(aiSeed);
  controller.enabled = true;
  let scene!: RotnsScene;
  let captured: AiView | null = null;
  const source: InputSource = {
    frame(): FrameInput {
      const v = scene.aiView();
      if (v.frame >= captureFrame) return HOLD;
      return controller.frame(v);
    },
  };
  scene = new RotnsScene({ input: source, events: null, seed, fx: false });

  // 重放到捕获帧
  while (scene.aiView().frame < captureFrame && !scene.done) scene.update();
  captured = scene.aiView();
  const out: string[] = [];
  out.push(`captured f=${captured.frame} pos=(${captured.playerX.toFixed(1)},${captured.playerY.toFixed(1)}) blt=${captured.pool.n} phase=${captured.phaseId} pf=${captured.patternFrame} rng=${captured.rngSeed}`);

  // planner 对静止策略的预测
  const planner = new Planner();
  const stayT = planner.validate(captured, 0, 0, false);
  out.push(`stay-policy predicted tHit=${stayT}  (H=42)`);

  // 真实 scene 静止继续，逐帧记录
  for (let t = 1; t <= 46 && !scene.done; t++) {
    scene.update();
    const v = scene.aiView();
    let minD = Infinity;
    for (let b = 0; b < v.pool.n; b++) {
      const dx = v.pool.x[b] - v.playerX, dy = v.pool.y[b] - v.playerY;
      const d = Math.hypot(dx, dy) - CFG.bullets.sprites[v.pool.sprite[b]].hitbox;
      if (d < minD) minD = d;
    }
    out.push(`t=${t} blt=${v.pool.n} minD=${minD.toFixed(1)} pos=(${v.playerX.toFixed(1)},${v.playerY.toFixed(1)}) alive=${v.playerAlive}`);
    if (!v.playerAlive) { out.push(`DIED at t=${t}`); break; }
  }
  return out.join('\n');
}
