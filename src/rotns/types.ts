import type { Rng } from '../core/rng';

// —— 弹池（SoA typed arrays；scene 与 AI 前瞻共用同一份 step 驱动）——
export interface BulletPool {
  n: number;
  cap: number;
  x: Float32Array; y: Float32Array;
  vx: Float32Array; vy: Float32Array;
  accel: Float32Array;      // 沿当前朝向的加速度（0=无）
  vmax: Float32Array;       // 加速上限速度
  fuse: Int16Array;         // >0: 距裂变帧数；-1: 无
  splitKind: Uint8Array;    // fuse 到期时查 SPLIT 表；0=不裂变
  sprite: Uint8Array;
  grazed: Uint8Array;
  age: Int16Array;
}

export interface SpawnSpec {
  x: number; y: number;
  angle: number;            // rad，0 = +x 轴，逆时针正（屏幕 y 向下 → 视觉上顺时针）
  speed: number;
  sprite: number;
  accel?: number;           // 每帧速度增量
  vmax?: number;
  fuse?: number;
  splitKind?: number;
}

// Pattern 契约（PLAN §3 铁律 1）：状态 S 为 JSON 可克隆 POJO，一切随机取自 ctx.rng。
export interface PatternCtx {
  rng: Rng;
  frame: number;            // pattern 局部帧号（step 被调次数）
  playerX: number; playerY: number;
  bossX: number; bossY: number;
  spawn(spec: SpawnSpec): void;
}

export interface Pattern<S> {
  init(rng: Rng): S;
  step(s: S, ctx: PatternCtx): void;
}

// —— AI 只读视图（PLAN §6.1）——
export interface AiView {
  frame: number;            // scene 绝对帧
  pool: BulletPool;         // 只读引用，AI 不得写
  playerX: number; playerY: number;
  playerAlive: boolean;
  invuln: number;           // 剩余无敌帧（bomb/复活/hyper 发动合并）
  bossX: number; bossY: number;
  bossAlive: boolean;
  inCombat: boolean;        // 当前段是否处于开火状态（declare/入场期=false）
  phaseIndex: number;
  phaseId: string;
  patternFrame: number;     // 当前段已进行帧数
  patternState: unknown;    // 当前 pattern 的 POJO 状态（AI 克隆用）
  rngSeed: number;          // 场景主 Rng 当前 seed（AI 克隆推演用）
  hyperGauge: number; hyperActive: boolean; hyperLeft: number;
  bombs: number;
  p4IntervalNow: number;    // 仅 p4 有意义：当前发射间隔（其余段 = 0）
  finaleOmega: number;      // 仅 finale 有意义：当前 Ω（含符号）
  finaleOrbit: number;      // 仅 finale 有意义：炮台群公转相位
  bulletCount: number;
  timeLeft: number;         // 安全时限剩余帧（finale=Infinity）
}

export interface AiAction {
  dir: number;              // 0..8：8 方向 + 8 静止（numpad 布局 1..9，5=静止；0=静止）
  focus: boolean;
  bomb: boolean;
  hyper: boolean;
}
