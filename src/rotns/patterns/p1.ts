import { CFG } from '../config';
import { SPRITE } from '../bullets';
import type { Pattern, PatternCtx } from '../types';

// P1 蝶符「亡我流・回旋针雨」—— 双向旋转针弹涡（PLAN §5.1）
export interface P1State {
  thetaA: number;
  thetaB: number;
  volley: number;
}

export const p1: Pattern<P1State> = {
  init(): P1State {
    return { thetaA: 0, thetaB: Math.PI / 2, volley: 0 };
  },
  step(s: P1State, ctx: PatternCtx): void {
    const C = CFG.p1;
    if (ctx.frame % C.emitterA.interval === 0) {
      // 交替波：偶发慢速、奇发高速，形成呼吸式涡旋
      const speed = s.volley % 2 === 0 ? C.emitterA.speedLo : C.emitterA.speedHi;
      for (let k = 0; k < C.emitterA.ways; k++) {
        ctx.spawn({
          x: ctx.bossX, y: ctx.bossY,
          angle: s.thetaA + (k / C.emitterA.ways) * Math.PI * 2,
          speed, sprite: SPRITE.NEEDLE_PINK,
        });
      }
      for (let k = 0; k < C.emitterB.ways; k++) {
        ctx.spawn({
          x: ctx.bossX, y: ctx.bossY,
          angle: s.thetaB + (k / C.emitterB.ways) * Math.PI * 2,
          speed: C.emitterB.speed, sprite: SPRITE.NEEDLE_BLUE,
        });
      }
      s.thetaA += C.emitterA.dTheta;
      s.thetaB += C.emitterB.dTheta;
      s.volley += 1;
    }
    if (ctx.frame > 0 && ctx.frame % C.ring.interval === 0) {
      for (let k = 0; k < C.ring.ways; k++) {
        ctx.spawn({
          x: ctx.bossX, y: ctx.bossY,
          angle: (k / C.ring.ways) * Math.PI * 2,
          speed: C.ring.speed, sprite: SPRITE.BALL_S_PINK,
        });
      }
    }
  },
};
