import { CFG } from './config';

// Hyper System —— 替代森罗结界（PLAN §4.4）。
// 满槽按 C 发动：瞬间全屏消弹化星+60f 无敌；720f 火力 ×2.5、量表匀速流干；
// 期间不积攒；被弹或 Bomb 即刻终止且清零。无 Rank（有意简化，见 PLAN §4.4）。
export class HyperSystem {
  gauge = 0;
  active = false;
  left = 0;                 // 剩余帧

  get full(): boolean {
    return this.gauge >= CFG.hyper.max;
  }

  get firepowerMul(): number {
    return this.active ? CFG.hyper.firepowerMul : 1;
  }

  get spreadMul(): number {
    return this.active ? CFG.hyper.spreadMul : 1;
  }

  addGraze(): void {
    if (this.active) return;
    this.gauge = Math.min(CFG.hyper.max, this.gauge + CFG.hyper.gainGraze);
  }

  addHitFrame(): void {
    if (this.active) return;
    this.gauge = Math.min(CFG.hyper.max, this.gauge + CFG.hyper.gainHitPerFrame);
  }

  addPhaseClear(): void {
    if (this.active) return;
    this.gauge = Math.min(CFG.hyper.max, this.gauge + CFG.hyper.gainPhaseClear);
  }

  // 返回 true = 成功发动（scene 据此触发全屏消弹化星）
  tryCast(): boolean {
    if (this.active || !this.full) return false;
    this.active = true;
    this.left = CFG.hyper.duration;
    return true;
  }

  // 被弹死亡或 Bomb → 立即终止且量表清零
  terminate(): void {
    this.active = false;
    this.left = 0;
    this.gauge = 0;
  }

  update(): void {
    if (!this.active) return;
    this.left -= 1;
    this.gauge = Math.max(0, CFG.hyper.max * this.left / CFG.hyper.duration);
    if (this.left <= 0) {
      this.active = false;
      this.gauge = 0;
    }
  }
}
