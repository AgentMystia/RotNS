import { CFG } from './config';

// Bomb —— 街机式简化（PLAN §4.3）。
// X 当帧生效无前摇；冲击波 24f 扩张 0→460px，触弹即消化星；
// 无敌 180f；对 Boss 3000×0.10=300（蜂系 Bomb 无效化再现）；
// 与 Hyper 互斥（发动瞬间 Hyper 中断）；180f 内不可再 Bomb。无 deathbomb。
export class BombSystem {
  stock = CFG.bomb.stock;
  active = false;
  waveT = 0;                // 冲击波已进行帧
  invuln = 0;
  lock = 0;                 // 再使用锁

  get radius(): number {
    if (!this.active) return 0;
    return CFG.bomb.radiusMax * Math.min(1, this.waveT / CFG.bomb.expandFrames);
  }

  get waveDone(): boolean {
    return this.waveT >= CFG.bomb.expandFrames;
  }

  resetStock(): void {
    this.stock = CFG.bomb.stock;
  }

  // 返回 true = 成功发动
  tryCast(): boolean {
    if (this.stock <= 0 || this.lock > 0 || this.active) return false;
    this.stock -= 1;
    this.active = true;
    this.waveT = 0;
    this.invuln = CFG.bomb.invuln;
    this.lock = CFG.bomb.lockFrames;
    return true;
  }

  update(): boolean {
    // 返回 true 的帧：冲击波仍存在，scene 做消弹判定
    if (this.lock > 0) this.lock -= 1;
    if (this.invuln > 0) this.invuln -= 1;
    if (!this.active) return false;
    this.waveT += 1;
    if (this.waveT >= CFG.bomb.expandFrames) {
      this.active = false;
      return false;
    }
    return true;
  }
}
