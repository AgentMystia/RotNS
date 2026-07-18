// 终局 DPS 轨迹：每秒输出 phase/bossHp/玩家位置，诊断发狂段输出窗口。
import { RotnsScene, type FrameInput, type InputSource } from './scene';
import { AiController } from './ai/controller';

export function dpsTrace(seed: number, aiSeed: number, maxFrames: number): string {
  const controller = new AiController(aiSeed);
  controller.enabled = true;
  let scene!: RotnsScene;
  const source: InputSource = { frame: () => controller.frame(scene.aiView()) };
  scene = new RotnsScene({ input: source, events: null, seed, fx: false });
  const lines: string[] = [];
  let lastPhase = -1;
  let lastMiss = 0;
  for (let i = 0; i < maxFrames && !scene.done; i++) {
    scene.update();
    const v = scene.aiView();
    if (v.phaseIndex !== lastPhase) {
      lines.push(`f=${v.frame} >>> 进入 ${v.phaseId} (bossHp=${scene['boss'].hp.toFixed(0)})`);
      lastPhase = v.phaseIndex;
    }
    if (scene.result.miss !== lastMiss) {
      lastMiss = scene.result.miss;
      lines.push(`f=${v.frame} *** MISS#${lastMiss} hyperActive=${v.hyperActive} hyperLeft=${v.hyperLeft} bombs=${v.bombs} pos=(${v.playerX.toFixed(0)},${v.playerY.toFixed(0)}) phase=${v.phaseId}`);
    }
    if (v.frame % 15 === 0 && v.phaseId === 'finale' && v.hyperActive) {
      lines.push(
        `f=${v.frame} [HYPER] hp=${scene['boss'].hp.toFixed(0).padStart(6)} pos=(${v.playerX.toFixed(0)},${v.playerY.toFixed(0)}) blt=${v.pool.n} hypLeft=${v.hyperLeft}`,
      );
    } else if (v.frame % 60 === 0 && v.phaseId === 'finale') {
      lines.push(
        `f=${v.frame} hp=${scene['boss'].hp.toFixed(0).padStart(6)} pos=(${v.playerX.toFixed(0)},${v.playerY.toFixed(0)}) blt=${v.pool.n} hyp=${v.hyperGauge.toFixed(0)} bombs=${v.bombs} planT=${controller.lastPlanTHit}`,
      );
    }
  }
  const r = scene.result;
  lines.push(`END mode=${r.mode} f=${r.frame} miss=${r.miss} bomb=${r.bombsUsed} hyper=${r.hypersUsed} graze=${r.graze}`);
  return lines.join('\n');
}
