import { CFG } from '../config';
import { SPRITE } from '../bullets';
import { DEG } from '../../core/util';
import type { Pattern, PatternCtx } from '../types';

// P4 死蝶「终焉加速」—— 发射间隔渐短、单弹渐快的加速环（PLAN §5.4）
export interface P4State {
  interval: number;    // 当前发射间隔（线性 ramp）
  sinceLast: number;
  base: number;
  ringParity: number;
}

export function p4IntervalAt(frame: number): number {
  const C = CFG.p4;
  const t = Math.min(1, frame / C.rampFrames);
  return C.intervalStart + (C.intervalEnd - C.intervalStart) * t;
}

export const p4: Pattern<P4State> = {
  init(): P4State {
    return { interval: CFG.p4.intervalStart, sinceLast: 0, base: 0, ringParity: 0 };
  },
  step(s: P4State, ctx: PatternCtx): void {
    const C = CFG.p4;
    s.interval = p4IntervalAt(ctx.frame);
    s.sinceLast += 1;
    if (s.sinceLast >= s.interval) {
      s.sinceLast = 0;
      const sprite = s.ringParity % 2 === 0 ? SPRITE.BALL_S_PINK : SPRITE.BALL_S_BLUE;
      for (let k = 0; k < C.ways; k++) {
        ctx.spawn({
          x: ctx.bossX, y: ctx.bossY,
          angle: s.base + (k / C.ways) * Math.PI * 2,
          speed: C.speed0, sprite,
          accel: C.accel, vmax: C.speedMax,
        });
      }
      s.base += (ctx.rng.f() * 2 - 1) * C.baseJitterDeg * DEG;
      s.ringParity += 1;
    }
  },
};
