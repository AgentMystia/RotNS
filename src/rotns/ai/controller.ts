import type { Button } from '../../core/input';
import { CFG } from '../config';
import type { AiView } from '../types';
import { Planner, type Plan } from './planner';
import { Humanizer } from './humanizer';

// AI 控制器（PLAN §6.1 总架构）：
//   view → planner.decide → humanizer.filter → 方向键/功能键集合
// 决策与噪声均取自播种源（aiSeed），整局可复现（bench 依赖）。
export class AiController {
  enabled = false;
  private readonly planner = new Planner();
  private readonly humanizer: Humanizer;
  private replanCounter = 0;
  private bombDelay = 0;
  private lastMove: { ux: number; uy: number; focus: boolean } = { ux: 0, uy: 0, focus: false };
  lastPlanTHit = -1;       // 调试观测：最近计划的 tHit
  lastPlanRaw: Plan | null = null;
  lastExecMove = '';       // 调试观测：最近被执行动作 (ux,uy,focus)
  private heldSet = new Set<Button>();
  private pressedSet = new Set<Button>();
  private frameState = { held: this.heldSet, pressed: this.pressedSet };

  constructor(aiSeed = 7) {
    this.humanizer = new Humanizer(aiSeed);
  }

  // 每帧调用；返回拟人化后的按键集合。
  frame(view: AiView): { held: ReadonlySet<Button>; pressed: ReadonlySet<Button> } {
    this.heldSet.clear();
    this.pressedSet.clear();
    if (!view.playerAlive) return this.frameState;

    this.replanCounter -= 1;
    let hyper = false;
    if (this.replanCounter <= 0) {
      // 自适应节奏：危险域（tHit<16）逐帧重规划，安全域 2f（节流+防抖）
      this.replanCounter = this.lastPlanTHit >= 0 && this.lastPlanTHit < 16 ? 1 : CFG.ai.replanEvery;
      const raw = this.planner.decide(view);
      this.lastPlanTHit = raw.tHit;
      this.lastPlanRaw = raw;
      const plan = this.humanizer.filter(raw, view, (ux, uy, focus) => this.planner.validate(view, ux, uy, focus));
      this.lastMove = { ux: plan.ux, uy: plan.uy, focus: plan.focus };
      this.lastExecMove = `${plan.ux.toFixed(2)},${plan.uy.toFixed(2)},${plan.focus ? 1 : 0}`;
      if (plan.hyper) hyper = true;
      if (plan.bomb && this.bombDelay <= 0) {
        // Bomb 拟人化延迟 2f —— 但真·急救（tHit<8）必须当帧按出，否则延迟即死亡
        this.bombDelay = raw.tHit < 8 ? 1 : CFG.ai.bombHumanDelay;
      }
    } else if (view.bombs > 0 && view.invuln <= 0) {
      // 补规划间隙的逐帧急救校验：赌博段翻Ω等突变可在 2f 内从安全变致命
      const m = this.lastMove;
      const tHit = this.planner.validate(view, m.ux, m.uy, m.focus);
      if (tHit < 8) this.pressedSet.add('bomb');
    }

    const m = this.lastMove;
    if (m.ux < -0.01) this.heldSet.add('left');
    if (m.ux > 0.01) this.heldSet.add('right');
    if (m.uy < -0.01) this.heldSet.add('up');
    if (m.uy > 0.01) this.heldSet.add('down');
    if (m.focus) this.heldSet.add('focus');
    this.heldSet.add('shoot'); // 常时射击（街机式自动连发按住）
    if (hyper) this.pressedSet.add('hyper');
    if (this.bombDelay > 0) {
      this.bombDelay -= 1;
      if (this.bombDelay === 0) this.pressedSet.add('bomb');
    }
    return this.frameState;
  }
}
