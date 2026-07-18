// 死亡现场还原：环形缓冲记录每帧状态，每次 MISS 导出前 50 帧。
import { RotnsScene, type FrameInput, type InputSource } from './scene';
import { AiController } from './ai/controller';
import { CFG } from './config';

export function traceDeath(seed: number, aiSeed: number): string {
  const controller = new AiController(aiSeed);
  controller.enabled = true;
  let scene!: RotnsScene;
  const source: InputSource = { frame: () => controller.frame(scene.aiView()) };
  scene = new RotnsScene({ input: source, events: null, seed, fx: false });
  const ring: string[] = [];
  const out: string[] = [];
  let lastMiss = 0;
  for (let i = 0; i < 20000 && !scene.done; i++) {
    scene.update();
    const v = scene.aiView();
    let minD = Infinity;
    for (let b = 0; b < v.pool.n; b++) {
      const dx = v.pool.x[b] - v.playerX, dy = v.pool.y[b] - v.playerY;
      const d = Math.hypot(dx, dy) - CFG.bullets.sprites[v.pool.sprite[b]].hitbox;
      if (d < minD) minD = d;
    }
    ring.push(
      `f=${v.frame} pos=(${v.playerX.toFixed(1)},${v.playerY.toFixed(1)}) inv=${v.invuln} ` +
      `blt=${v.pool.n} minD=${minD.toFixed(1)} ${v.phaseId} pf=${v.patternFrame} hyp=${v.hyperGauge.toFixed(0)} ` +
      `bombs=${v.bombs} planT=${controller.lastPlanTHit} raw=(${controller.lastPlanRaw?.ux.toFixed(1)},${controller.lastPlanRaw?.uy.toFixed(1)}) exec=(${controller.lastExecMove}) ` +
      `bossHp=${scene['boss'].hp.toFixed(0)}`,
    );
    if (ring.length > 50) ring.shift();
    if (scene.result.miss !== lastMiss) {
      lastMiss = scene.result.miss;
      // 导出凶手弹（最近 3 颗）
      const v = scene.aiView();
      const arr: string[] = [];
      for (let b = 0; b < v.pool.n; b++) {
        const dx = v.pool.x[b] - v.playerX, dy = v.pool.y[b] - v.playerY;
        const d = Math.hypot(dx, dy);
        arr.push(`${d.toFixed(1)}|b(x=${v.pool.x[b].toFixed(1)},y=${v.pool.y[b].toFixed(1)},vx=${v.pool.vx[b].toFixed(2)},vy=${v.pool.vy[b].toFixed(2)},age=${v.pool.age[b]},spr=${v.pool.sprite[b]},fuse=${v.pool.fuse[b]})`);
      }
      arr.sort((a, b) => parseFloat(a) - parseFloat(b));
      out.push(`\n=== MISS #${lastMiss} (frame ${v.frame}) ===`, ...ring, '--- nearest bullets (dist|desc) ---', ...arr.slice(0, 5));
      ring.length = 0;
    }
    if (scene.done) {
      out.push(`\n=== END mode=${scene.result.mode} frame=${v.frame} phase=${v.phaseId} ===`);
    }
  }
  return out.join('\n');
}
