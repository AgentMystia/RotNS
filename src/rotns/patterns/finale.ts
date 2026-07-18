import { CFG } from '../config';
import { SPRITE } from '../bullets';
import { DEG } from '../../core/util';
import type { Pattern, PatternCtx } from '../types';

// 发狂 反魂「墨染の洗濯機 〜 葬送二重奏」—— 四层构造忠实还原（PLAN §5.5）：
// 旋转炮台群快慢双层 winder + 红弹环 + ふぐ刺し花瓣扇 + 受控随机赌博段。
export interface FinaleState {
  omega: number;          // 当前角速度（赌博可反转符号）
  orbit: number;          // 炮台群公转相位
  volley: number;         // Option 齐射计数（快慢交替 + 赌博计数）
  redBase: number;
  fuguBase: number;
  gambleCountdown: number;
}

export const finale: Pattern<FinaleState> = {
  init(rng): FinaleState {
    return {
      omega: CFG.finale.options.omega,
      orbit: rng.f() * Math.PI * 2,
      volley: 0,
      redBase: 0,
      fuguBase: rng.f() * Math.PI * 2,
      gambleCountdown: CFG.finale.gamble.everyVolleys,
    };
  },
  step(s: FinaleState, ctx: PatternCtx): void {
    const C = CFG.finale;

    // 1. 旋转炮台群：6 Option 径向外射大型青弹，速度按发数交替 → 快慢双层条带
    if (ctx.frame % C.options.interval === 0) {
      const fast = s.volley % 2 === 0;
      const speed = fast ? C.options.speedFast : C.options.speedSlow;
      for (let k = 0; k < C.options.count; k++) {
        const ang = s.orbit + (k / C.options.count) * Math.PI * 2;
        const ox = ctx.bossX + Math.cos(ang) * C.options.radius;
        const oy = ctx.bossY + Math.sin(ang) * C.options.radius;
        ctx.spawn({ x: ox, y: oy, angle: ang, speed, sprite: SPRITE.BALL_L_BLUE });
      }
      s.volley += 1;

      // 4. 受控随机赌博段：Ω 反转 / 群相位跳变 / 无事（3:3:4）
      s.gambleCountdown -= 1;
      if (s.gambleCountdown <= 0) {
        s.gambleCountdown = C.gamble.everyVolleys;
        const total = C.gamble.wFlip + C.gamble.wJump + C.gamble.wNone;
        const roll = ctx.rng.u16InRange(total);
        if (roll < C.gamble.wFlip) {
          s.omega = -s.omega;
        } else if (roll < C.gamble.wFlip + C.gamble.wJump) {
          const sign = ctx.rng.u16InRange(2) === 0 ? 1 : -1;
          s.orbit += sign * C.gamble.phaseJump;
        }
      }
    }
    s.orbit += s.omega;

    // 2. 红弹环
    if (ctx.frame > 0 && ctx.frame % C.redRing.interval === 0) {
      for (let k = 0; k < C.redRing.ways; k++) {
        ctx.spawn({
          x: ctx.bossX, y: ctx.bossY,
          angle: s.redBase + (k / C.redRing.ways) * Math.PI * 2,
          speed: C.redRing.speed, sprite: SPRITE.NEEDLE_RED,
        });
      }
      s.redBase += C.redRing.dBase;
    }

    // 3. ふぐ刺し：3 张花瓣薄片扇，基角缓慢旋转
    if (ctx.frame > 0 && ctx.frame % C.fugu.interval === 0) {
      const fan = C.fugu.fanDeg * DEG;
      for (let f = 0; f < C.fugu.fans; f++) {
        const center = s.fuguBase + f * (Math.PI * 2 / C.fugu.fans);
        for (let k = 0; k < C.fugu.petalsPerFan; k++) {
          const t = C.fugu.petalsPerFan === 1 ? 0.5 : k / (C.fugu.petalsPerFan - 1);
          ctx.spawn({
            x: ctx.bossX, y: ctx.bossY,
            angle: center - fan / 2 + t * fan,
            speed: C.fugu.speed, sprite: SPRITE.PETAL,
          });
        }
      }
      s.fuguBase += 0.21;
    }
  },
};
