import { CFG, type PhaseId } from './config';
import { p1, type P1State } from './patterns/p1';
import { p2, type P2State } from './patterns/p2';
import { p3, type P3State } from './patterns/p3';
import { p4, p4IntervalAt, type P4State } from './patterns/p4';
import { finale, type FinaleState } from './patterns/finale';
import type { Pattern } from './types';
import type { Rng } from '../core/rng';

export type BossMode =
  | 'intro'        // 黑场
  | 'warning'      // 街机式 WARNING 演出
  | 'fadein'       // 幽幽子淡入 + 蝶粒子聚拢
  | 'hpcharge'     // HP 条充能
  | 'combat'       // 弹幕战
  | 'declare'      // 转段：符卡宣言演出
  | 'finalburst'   // 击破：整屏化星金蝶爆散
  | 'cleared';     // 结算

const PATTERNS: Record<PhaseId, Pattern<never>> = {
  p1: p1 as unknown as Pattern<never>,
  p2: p2 as unknown as Pattern<never>,
  p3: p3 as unknown as Pattern<never>,
  p4: p4 as unknown as Pattern<never>,
  finale: finale as unknown as Pattern<never>,
};

// 全场绝对帧驱动的悬停漂移纯函数（scene 与 AI 前瞻共用）；发狂段固定居中。
export function bossDriftPos(phaseId: PhaseId, absFrame: number): { x: number; y: number } {
  const B = CFG.boss;
  if (phaseId === 'finale') {
    return { x: B.cx, y: B.cy };
  }
  return {
    x: B.cx + Math.sin((absFrame / B.driftXPeriod) * Math.PI * 2) * B.driftXAmp,
    y: B.cy + Math.sin((absFrame / B.driftYPeriod) * Math.PI * 2) * B.driftYAmp,
  };
}

export class YuyukoBoss {
  x = CFG.boss.cx;
  y = -60;                    // 淡入前在屏上外
  mode: BossMode = 'intro';
  modeFrame = 0;
  phaseIndex = 0;
  hp = 0;
  hpMax = 1;
  hpCharge = 0;               // 充能演出进度 0..1
  patternState: unknown = null;
  patternFrame = 0;
  alpha = 0;                  // 淡入
  hitFlash = 0;               // 被弹白闪
  bombFlash = 0;              // 「结界护罩」闪光
  declareName = '';           // 演出用符卡名
  fanSpin = 0;                // 视觉

  get phaseCfg() {
    return CFG.phases[this.phaseIndex];
  }

  get phaseId(): PhaseId {
    return this.phaseCfg.id as PhaseId;
  }

  get pattern(): Pattern<never> {
    return PATTERNS[this.phaseId];
  }

  get inCombat(): boolean {
    return this.mode === 'combat';
  }

  // 全场绝对帧驱动的悬停漂移（AI 前瞻可复现）
  driftPos(absFrame: number): { x: number; y: number } {
    return bossDriftPos(this.phaseId, absFrame);
  }

  enterMode(mode: BossMode): void {
    this.mode = mode;
    this.modeFrame = 0;
  }

  startPhase(rng: Rng, idx: number): void {
    this.phaseIndex = idx;
    const cfg = this.phaseCfg;
    this.hp = cfg.hp;
    this.hpMax = cfg.hp;
    this.patternState = (this.pattern as Pattern<unknown>).init(rng);
    this.patternFrame = 0;
    this.declareName = cfg.name;
    this.enterMode('declare');
  }

  // declare 演出结束 → 正式开战
  beginCombat(): void {
    this.patternFrame = 0;
    this.enterMode('combat');
  }

  applyDamage(d: number): void {
    if (!this.inCombat || this.hp <= 0) return;
    this.hp -= d;
    this.hitFlash = 4;
  }

  get phaseCleared(): boolean {
    return this.inCombat && this.hp <= 0;
  }

  get timedOut(): boolean {
    const tl = this.phaseCfg.timeLimit;
    return this.inCombat && tl > 0 && this.patternFrame >= tl;
  }

  get isLastPhase(): boolean {
    return this.phaseIndex >= CFG.phases.length - 1;
  }

  // 返回 'hpcharge-done' 时由 scene 调用 startPhase(rng, 0) 启动首段。
  update(absFrame: number): 'hpcharge-done' | null {
    this.modeFrame += 1;
    if (this.hitFlash > 0) this.hitFlash -= 1;
    if (this.bombFlash > 0) this.bombFlash -= 1;
    this.fanSpin += 0.03;
    if (this.mode === 'fadein') {
      this.alpha = Math.min(1, this.modeFrame / 40);
      this.y = -60 + (CFG.boss.cy + 60) * Math.min(1, this.modeFrame / 50);
      if (this.modeFrame >= 50) this.enterMode('hpcharge');
      return null;
    }
    if (this.mode === 'hpcharge') {
      this.hpCharge = Math.min(1, this.modeFrame / CFG.boss.hpChargeFrames);
      const pos = this.driftPos(absFrame);
      this.x = pos.x; this.y = pos.y;
      if (this.hpCharge >= 1) return 'hpcharge-done';
      return null;
    }
    if (this.mode === 'combat' || this.mode === 'declare') {
      const pos = this.driftPos(absFrame);
      this.x = pos.x; this.y = pos.y;
    }
    return null;
  }

  p4IntervalNow(): number {
    if (this.phaseId !== 'p4' || !this.patternState) return 0;
    return p4IntervalAt(this.patternFrame);
  }

  finaleOmega(): number {
    if (this.phaseId !== 'finale' || !this.patternState) return 0;
    return (this.patternState as FinaleState).omega;
  }

  finaleOrbit(): number {
    if (this.phaseId !== 'finale' || !this.patternState) return 0;
    return (this.patternState as FinaleState).orbit;
  }

  timeLeft(): number {
    const tl = this.phaseCfg.timeLimit;
    if (tl <= 0) return Infinity;
    return Math.max(0, tl - this.patternFrame);
  }
}

// 供 AI 前瞻重建 typed pattern（避免把 Record 类型拖进 hot path）
export function patternFor(id: PhaseId): Pattern<unknown> {
  return PATTERNS[id] as Pattern<unknown>;
}

export type { P1State, P2State, P3State, P4State, FinaleState };
