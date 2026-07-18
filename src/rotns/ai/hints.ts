import type { AiView } from '../types';

// 路线先验（PLAN §6.5）：以吸引势场叠加进 planner 软项，不覆盖生存项。
// AI 因此表现为"熟练背版玩家 + 临场应变"。

export interface Hint {
  // 位置代价（越小越好），叠加进软项
  cost(view: AiView, x: number, y: number): number;
  // 习惯性低速（humanizer 用）
  preferFocus?: boolean;
  // 发狂 ride-winder：目标环绕半径
  orbitRadius?: number;
}

function bandCost(y: number, lo: number, hi: number): number {
  if (y < lo) return lo - y;
  if (y > hi) return y - hi;
  return 0;
}

const p1Hint: Hint = {
  // spiral-follow：贴底小幅横移跟随缝隙（缝隙追踪由生存项天然完成）
  cost(_v, _x, y) {
    return bandCost(y, 380, 420) * 2;
  },
};

const p2Hint: Hint = {
  // pre-split：保持与母弹距离（裂变前穿环）——纵向略抬便于穿环
  cost(_v, _x, y) {
    return bandCost(y, 360, 420) * 1.5;
  },
};

const p3Hint: Hint = {
  // stream：左右流带引导狙弹
  cost(view, x, y) {
    const sweep = 192 + 122 * Math.sin(view.frame * 0.011);
    const cx = Math.max(70, Math.min(314, sweep));
    return Math.abs(x - cx) * 0.6 + bandCost(y, 380, 420) * 2;
  },
};

const p4Hint: Hint = {
  // contract：锚定底中微移
  cost(_v, x, y) {
    const dx = x - 192, dy = y - 412;
    return Math.sqrt(dx * dx + dy * dy) * 1.2;
  },
};

const finaleHint: Hint = {
  preferFocus: true,
  // ride-winder（纵版自机的实战形态）：守在 Boss 下方中近距离弧带贴脸缠斗，
  // x 随条带扫频横移，缝隙追踪由生存项完成 —— 火力命中窗口最大化。
  cost(view, x, y) {
    const sweep = view.bossX + 30 * Math.sin(view.finaleOrbit * 2);
    return bandCost(y, 230, 390) * 1.0 + Math.abs(x - sweep) * 0.5;
  },
};

const HINTS: Record<string, Hint> = {
  p1: p1Hint, p2: p2Hint, p3: p3Hint, p4: p4Hint, finale: finaleHint,
};

export function hintFor(phaseId: string): Hint {
  return HINTS[phaseId] ?? p1Hint;
}
