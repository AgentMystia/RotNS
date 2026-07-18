import { CFG } from '../config';
import { Rng } from '../../core/rng';
import type { Plan } from './planner';
import { hintFor } from './hints';
import type { AiView } from '../types';

// 拟人层（PLAN §6.3）：仅在不危及生存时生效。
// 红线实现：任何修饰后的输出必须通过 validator（与 planner 同源的 H 帧前瞻），
// 安全性低于原始计划即回退 —— 因此拟人化永远不会把"安全动作"变成"致命动作"。
// 所有输出保持键级量化（与按键语义一致），杜绝 sim/执行分歧。

export type Validator = (ux: number, uy: number, focus: boolean) => number;

const FAST = CFG.player.speedFast;                 // 4.5
const FAST_D = FAST * CFG.player.diagScale;        // 3.18
const SLOW = CFG.player.speedSlow;                 // 2.0
const SLOW_D = SLOW * CFG.player.diagScale;        // 1.41

interface KeyMove { ux: number; uy: number; focus: boolean }

export class Humanizer {
  private readonly delayRing: KeyMove[] = [];
  private ringIdx = 0;
  private stickCounter = 0;
  private last: KeyMove = { ux: 0, uy: 0, focus: false };
  private breathePhase = 0;
  private readonly rng: Rng;

  constructor(aiSeed: number) {
    this.rng = new Rng(aiSeed);
    for (let i = 0; i < CFG.ai.delayBuffer; i++) {
      this.delayRing.push({ ux: 0, uy: 0, focus: false });
    }
  }

  filter(plan: Plan, view: AiView, validate: Validator): Plan {
    const A = CFG.ai;
    const raw: KeyMove = { ux: plan.ux, uy: plan.uy, focus: plan.focus };

    // 非全安全（tHit < H）的计划是求生动作，原样透传
    if (plan.tHit < A.horizon) {
      this.pushRing(raw);
      this.last = raw;
      return plan;
    }

    // —— 以下为安全域修饰；每个候选修饰都过 validator ——
    let out: KeyMove = { ...raw };

    // 习惯动作：finale 习惯性含 Shift
    if (hintFor(view.phaseId).preferFocus) out.focus = true;

    // 转段间隙：回中轻晃（"整备"感）
    if (!view.inCombat) {
      const cx = 192;
      if (Math.abs(view.playerX - cx) > 24) {
        out = { ux: Math.sign(cx - view.playerX) * FAST, uy: 0, focus: false };
      } else {
        out = this.breathePhase % 48 < 24
          ? { ux: SLOW, uy: 0, focus: true }
          : { ux: -SLOW, uy: 0, focus: true };
      }
      this.breathePhase += 1;
      this.pushRing(out);
      this.last = out;
      return this.toPlan(plan, out, validate);
    }

    // 反应延迟：3f 环形缓冲；t_hit<8f 旁路（人类应激）
    if (plan.tHit < A.bypassBelow) {
      this.pushRing(raw);
      this.last = raw;
      return plan;
    }
    const delayed = this.pushRing(out);
    out = { ...delayed };

    // 动作黏性：方向变更最小间隔（整体复制 KeyMove —— 速度向量与 focus 不可拆，
    // 拆开会产生"慢速向量+focus=off"的非法组合，游戏将按高速执行 → sim/执行分歧）
    const changed = out.ux !== this.last.ux || out.uy !== this.last.uy || out.focus !== this.last.focus;
    if (changed && this.stickCounter > 0) {
      out = { ...this.last };
    }
    this.stickCounter = changed ? A.stickFrames : Math.max(0, this.stickCounter - 1);

    // 呼吸摆动：安全冗余大且静止时，低速微幅摆动（键级量化）
    if (plan.tHit > A.breatheSlack && out.ux === 0 && out.uy === 0) {
      this.breathePhase += 1;
      out = this.breathePhase % 48 < 24
        ? { ux: SLOW, uy: 0, focus: true }
        : { ux: -SLOW, uy: 0, focus: true };
    }

    // 量化噪声：偶发一次正交键 tap（安全时；保持合法键组合）
    if (plan.tHit > A.graceGrazeSlack && this.rng.f() < 0.03) {
      if (out.ux === 0 && out.uy === 0) {
        out = { ux: this.rng.f() < 0.5 ? SLOW : -SLOW, uy: 0, focus: true };
      } else if (out.uy === 0 && out.ux !== 0) {
        out = {
          ux: Math.sign(out.ux) * SLOW_D,
          uy: this.rng.f() < 0.5 ? SLOW_D : -SLOW_D,
          focus: true,
        };
      }
    }

    this.last = out;
    return this.toPlan(plan, out, validate);
  }

  // 安全红线：修饰后输出过 validator，安全性下降则回退原始计划
  private toPlan(plan: Plan, out: KeyMove, validate: Validator): Plan {
    const tHit = validate(out.ux, out.uy, out.focus);
    if (tHit < plan.tHit) return plan;
    return { ...plan, ux: out.ux, uy: out.uy, focus: out.focus };
  }

  // 写入最新，返回最旧（delayBuffer 帧前的动作）
  private pushRing(m: KeyMove): KeyMove {
    this.ringIdx = (this.ringIdx + 1) % this.delayRing.length;
    const oldest = this.delayRing[this.ringIdx];
    this.delayRing[this.ringIdx] = { ...m };
    return oldest;
  }
}

export { FAST, FAST_D, SLOW, SLOW_D };
