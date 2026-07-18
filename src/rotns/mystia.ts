import { CFG } from './config';
import type { Button } from '../core/input';

// 米斯蒂娅·萝蕾拉（火力凶猛版，PLAN §4.2）。不依赖 .sht 与原 Player 类。
export interface Shot {
  active: boolean;
  x: number; y: number;
  vx: number; vy: number;
  dmg: number;
  kind: number;             // 0=羽弹(主射) 1=音波弹(子机)
  age: number;
}

export class MystiaPlayer {
  x = CFG.player.spawnX;
  y = CFG.player.spawnY;
  alive = true;
  invuln = 0;               // 复活/hyper/bomb 合并无敌由 scene 管理，这里只存复活无敌
  respawnTimer = 0;
  focus = false;
  bank = 0;                 // 倾斜姿态（视觉）-1..1
  optionSpin = 0;           // 子机视觉旋转
  shotTimerMain = 0;
  shotTimerOpt = 0;
  movingX = 0; movingY = 0;

  readonly shots: Shot[] = [];

  constructor() {
    for (let i = 0; i < CFG.player.shotPoolCap; i++) {
      this.shots.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 0, kind: 0, age: 0 });
    }
  }

  get invincible(): boolean {
    return this.invuln > 0 || !this.alive;
  }

  kill(): void {
    this.alive = false;
    this.respawnTimer = CFG.player.respawnDelay;
  }

  // 每帧：移动/射击。held 来自真实键盘或 AI 注入，路径完全一致。
  update(held: ReadonlySet<Button>, firepowerMul: number, spreadMul: number, bossX: number, bossY: number): void {
    if (!this.alive) {
      this.respawnTimer -= 1;
      if (this.respawnTimer <= 0) {
        this.alive = true;
        this.x = CFG.player.spawnX;
        this.y = CFG.player.spawnY;
        this.invuln = CFG.player.respawnInvuln;
      }
      return;
    }
    if (this.invuln > 0) this.invuln -= 1;

    const P = CFG.player;
    const F = CFG.playfield;
    const focus = held.has('focus');
    this.focus = focus;
    const speed = focus ? P.speedSlow : P.speedFast;
    let dx = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    let dy = (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0);
    if (dx !== 0 && dy !== 0) { dx *= P.diagScale; dy *= P.diagScale; }
    this.x = Math.min(F.maxX, Math.max(F.minX, this.x + dx * speed));
    this.y = Math.min(F.maxY, Math.max(F.minY, this.y + dy * speed));
    this.movingX = dx; this.movingY = dy;
    this.bank += ((dx) - this.bank) * 0.2;
    this.optionSpin += focus ? 0.05 : 0.12;

    if (held.has('shoot')) this.fire(firepowerMul, spreadMul, bossX, bossY);
    this.stepShots();
  }

  private pushShot(x: number, y: number, angle: number, speed: number, dmg: number, kind: number): void {
    for (const s of this.shots) {
      if (s.active) continue;
      s.active = true;
      s.x = x; s.y = y;
      s.vx = Math.cos(angle) * speed;
      s.vy = Math.sin(angle) * speed;
      s.dmg = dmg; s.kind = kind; s.age = 0;
      return;
    }
  }

  private fire(mul: number, spreadMul: number, bossX: number, bossY: number): void {
    const P = CFG.player;
    this.shotTimerMain -= 1;
    if (this.shotTimerMain <= 0) {
      this.shotTimerMain = P.mainShot.interval;
      const d = Math.round(P.mainShot.dmg * mul);
      this.pushShot(this.x - P.mainShot.offsetX, this.y - 10, -Math.PI / 2, P.mainShot.speed, d, 0);
      this.pushShot(this.x + P.mainShot.offsetX, this.y - 10, -Math.PI / 2, P.mainShot.speed, d, 0);
    }
    this.shotTimerOpt -= 1;
    if (this.focus) {
      const O = P.optSlow;
      if (this.shotTimerOpt <= 0) {
        this.shotTimerOpt = O.interval;
        const d = Math.round(O.dmg * mul);
        for (const [ox, oy] of O.offsets) {
          this.pushShot(this.x + ox, this.y + oy, -Math.PI / 2, O.speed, d, 1);
        }
      }
    } else {
      // 高速子机：以窄散布（±0.05/±0.11 rad）瞄准 Boss 的"歌声"扇
      // （PLAN §4.2 名义 DPS 对单体 ≈430 的落位方式 —— 扇心指向目标，中距内两束必中）
      const O = P.optFast;
      if (this.shotTimerOpt <= 0) {
        this.shotTimerOpt = O.interval;
        const d = Math.round(O.dmg * mul);
        for (let k = 0; k < O.offsets.length; k++) {
          const [ox, oy] = O.offsets[k];
          const sx = this.x + ox, sy = this.y + oy;
          const aim = Math.atan2(bossY - sy, bossX - sx);
          const ang = aim + O.angles[k] * spreadMul;
          this.pushShot(sx, sy, ang, O.speed, d, 1);
        }
      }
    }
  }

  private stepShots(): void {
    for (const s of this.shots) {
      if (!s.active) continue;
      s.x += s.vx; s.y += s.vy; s.age += 1;
      if (s.y < -24 || s.x < -24 || s.x > CFG.playfield.w + 24 || s.age > CFG.player.shotLife * 4) {
        s.active = false;
      }
    }
  }

  // 子机当前世界坐标（视觉 + AI 参考）
  optionPositions(out: { x: number; y: number }[]): void {
    const offs = this.focus ? CFG.player.optSlow.offsets : CFG.player.optFast.offsets;
    for (let k = 0; k < 4; k++) {
      out[k].x = this.x + offs[k][0];
      out[k].y = this.y + offs[k][1];
    }
  }
}
