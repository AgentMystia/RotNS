import { CFG } from '../config';
import { SPRITE } from '../bullets';
import { DEG } from '../../core/util';
import type { Pattern, PatternCtx } from '../types';

// P3 死符「幽明重圏」—— 高密度全方位环幕 + 自机狙叠加（PLAN §5.3）
export interface P3State {
  ringBase: number;
}

export const p3: Pattern<P3State> = {
  init(): P3State {
    return { ringBase: 0 };
  },
  step(s: P3State, ctx: PatternCtx): void {
    const C = CFG.p3;
    if (ctx.frame % C.ring.interval === 0) {
      for (let k = 0; k < C.ring.ways; k++) {
        const jitter = (ctx.rng.f() * 2 - 1) * C.ring.jitterDeg * DEG;
        ctx.spawn({
          x: ctx.bossX, y: ctx.bossY,
          angle: s.ringBase + (k / C.ring.ways) * Math.PI * 2 + jitter,
          speed: C.ring.speed, sprite: SPRITE.BALL_S_PINK,
        });
      }
      s.ringBase += C.ring.dBaseDeg * DEG;
    }
    if (ctx.frame % C.aim.interval === 0) {
      const aim = Math.atan2(ctx.playerY - ctx.bossY, ctx.playerX - ctx.bossX);
      const fan = C.aim.fanDeg * DEG;
      for (let k = 0; k < C.aim.ways; k++) {
        const t = C.aim.ways === 1 ? 0.5 : k / (C.aim.ways - 1);
        ctx.spawn({
          x: ctx.bossX, y: ctx.bossY,
          angle: aim - fan / 2 + t * fan,
          speed: C.aim.speed, sprite: SPRITE.NEEDLE_BLUE,
        });
      }
    }
  },
};
