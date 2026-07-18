import { CFG } from '../config';
import { SPRITE } from '../bullets';
import type { Pattern, PatternCtx } from '../types';

// P2 樱符「散华・裂变墨染」—— 母弹飞行途中向多方向二次分裂（PLAN §5.2）
export interface P2State {
  motherVolley: number;
}

export const p2: Pattern<P2State> = {
  init(): P2State {
    return { motherVolley: 0 };
  },
  step(s: P2State, ctx: PatternCtx): void {
    const C = CFG.p2;
    if (ctx.frame % C.mother.interval === 0) {
      const aim = Math.atan2(ctx.playerY - ctx.bossY, ctx.playerX - ctx.bossX);
      const arc = C.mother.aimArcDeg * Math.PI / 180;
      for (let k = 0; k < C.mother.ways; k++) {
        const t = C.mother.ways === 1 ? 0.5 : k / (C.mother.ways - 1);
        ctx.spawn({
          x: ctx.bossX, y: ctx.bossY,
          angle: aim - arc + t * 2 * arc,
          speed: C.mother.speed,
          sprite: SPRITE.BALL_L_BLUE,
          fuse: C.mother.fuse,
          splitKind: 1,
        });
      }
      s.motherVolley += 1;
    }
    if (ctx.frame % C.press.interval === 0) {
      const aim = Math.atan2(ctx.playerY - ctx.bossY, ctx.playerX - ctx.bossX);
      for (let k = 0; k < C.press.ways; k++) {
        ctx.spawn({
          x: ctx.bossX, y: ctx.bossY,
          angle: aim + (k - (C.press.ways - 1) / 2) * 0.09,
          speed: C.press.speed, sprite: SPRITE.NEEDLE_PINK,
        });
      }
    }
  },
};
