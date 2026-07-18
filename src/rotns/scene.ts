import { CFG } from './config';
import type { Button } from '../core/input';
import { Rng } from '../core/rng';
import { TAU } from '../core/util';
import { PLAYFIELD, Renderer } from '../gfx/renderer';
import {
  bulletVsPlayer, clearPool, createPool, spawnBullet, stepBullets,
} from './bullets';
import { MystiaPlayer } from './mystia';
import { YuyukoBoss } from './boss-yuyuko';
import { HyperSystem } from './hyper';
import { BombSystem } from './bomb';
import type { AiView, BulletPool, PatternCtx, SpawnSpec } from './types';
import { drawHud, drawOverlayText, type HudState } from './hud';
import { SPRITE_KEYS } from './assets';

// —— 输入源抽象：浏览器=键盘+AI注入，bench=纯 AI ——
export interface FrameInput {
  held: ReadonlySet<Button>;
  pressed: ReadonlySet<Button>;
}
export interface InputSource {
  frame(): FrameInput;
}

// —— 音频/演出事件（bench 传 null；浏览器由 audio-synth 实现）——
export interface SceneEvents {
  sfx(name: string): void;
  bgm(track: 'boss' | 'finale' | null): void;
}

type SceneMode = 'fight' | 'gameover' | 'clear';

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  kind: number;             // 0=化星 1=graze火花 2=死亡碎片 3=金蝶 4=命中火花 5=超屏冲击
  size: number;
}

const PARTICLE_CAP = 512;

export class RotnsScene {
  readonly rng: Rng;                 // 玩法 RNG：仅 patterns + 裂变使用（AI 克隆此 seed）
  private readonly fxRng: Rng;       // 演出 RNG：粒子/音高抖动，与玩法隔离
  readonly pool: BulletPool;
  readonly player = new MystiaPlayer();
  readonly boss = new YuyukoBoss();
  readonly hyper = new HyperSystem();
  readonly bomb = new BombSystem();

  private mode: SceneMode = 'fight';
  private absFrame = 0;
  private hitstop = 0;
  private castInvuln = 0;            // hyper 发动无敌
  private shake = 0;
  private lives = CFG.player.lives;
  private score = 0;
  private hiScore = 0;
  private grazeCount = 0;
  private bombsUsed = 0;
  private hypersUsed = 0;
  private missCount = 0;
  private clearFrame = 0;
  private pauseRequested = false;
  private finalBurstT = 0;
  private particles: Particle[] = [];
  private readonly inputSource: InputSource;
  private readonly events: SceneEvents | null;
  private readonly fxEnabled: boolean;
  aiEnabled = false;                 // HUD 徽标用；实际决策在 InputSource 侧

  // AI 决策耗时观测（性能预算用）
  lastAiMs = 0;

  constructor(opts: {
    input: InputSource;
    events?: SceneEvents | null;
    seed?: number;
    fx?: boolean;
  }) {
    const seed = opts.seed ?? 0x1527;
    this.rng = new Rng(seed);
    this.fxRng = new Rng(seed ^ 0x5eed);
    this.pool = createPool();
    this.inputSource = opts.input;
    this.events = opts.events ?? null;
    this.fxEnabled = opts.fx ?? true;
  }

  // —— AI 只读视图 ——
  aiView(): AiView {
    return {
      frame: this.absFrame,
      pool: this.pool,
      playerX: this.player.x, playerY: this.player.y,
      playerAlive: this.player.alive,
      invuln: Math.max(this.player.invuln, this.bomb.invuln, this.castInvuln),
      bossX: this.boss.x, bossY: this.boss.y,
      bossAlive: this.boss.inCombat || this.boss.mode === 'declare',
      inCombat: this.boss.inCombat,
      phaseIndex: this.boss.phaseIndex,
      phaseId: this.boss.phaseId,
      patternFrame: this.boss.patternFrame,
      patternState: this.boss.patternState,
      rngSeed: this.rng.seed,
      hyperGauge: this.hyper.gauge, hyperActive: this.hyper.active, hyperLeft: this.hyper.left,
      bombs: this.bomb.stock,
      p4IntervalNow: this.boss.p4IntervalNow(),
      finaleOmega: this.boss.finaleOmega(),
      finaleOrbit: this.boss.finaleOrbit(),
      bulletCount: this.pool.n,
      timeLeft: this.boss.timeLeft(),
    };
  }

  get done(): boolean {
    return this.mode === 'gameover' || this.mode === 'clear';
  }

  get result() {
    return {
      mode: this.mode, score: this.score, graze: this.grazeCount,
      bombsUsed: this.bombsUsed, hypersUsed: this.hypersUsed,
      miss: this.missCount, frame: this.absFrame,
    };
  }

  update(): void {
    const input = this.inputSource.frame();
    if (this.mode !== 'fight') {
      this.updateParticles();
      this.clearFrame += 1;
      return;
    }
    if (this.hitstop > 0) {
      this.hitstop -= 1;
      return;
    }
    this.absFrame += 1;
    if (this.shake > 0) this.shake -= 1;
    if (this.castInvuln > 0) this.castInvuln -= 1;

    // —— Boss 入场机 ——
    const ev = this.boss.update(this.absFrame);
    if (ev === 'hpcharge-done') {
      this.boss.startPhase(this.rng, 0);
      this.events?.sfx('spellDeclare');
    } else if (this.boss.mode === 'intro' && this.boss.modeFrame >= CFG.boss.introBlackFrames) {
      this.boss.enterMode('warning');
      this.events?.sfx('warning');
    } else if (this.boss.mode === 'warning' && this.boss.modeFrame >= CFG.boss.warningFrames) {
      this.boss.enterMode('fadein');
    } else if (this.boss.mode === 'declare' && this.boss.modeFrame >= CFG.boss.spellDeclareFrames) {
      this.boss.beginCombat();
      if (this.boss.phaseId === 'finale') this.events?.bgm('finale');
    }
    // 开场可跳过
    if ((this.boss.mode === 'intro' || this.boss.mode === 'warning') && input.pressed.has('confirm')) {
      this.boss.enterMode('fadein');
    }

    // —— 弹幕步进（仅 combat）——
    if (this.boss.inCombat) {
      const ctx: PatternCtx = {
        rng: this.rng,
        frame: this.boss.patternFrame,
        playerX: this.player.x, playerY: this.player.y,
        bossX: this.boss.x, bossY: this.boss.y,
        spawn: (spec: SpawnSpec) => spawnBullet(this.pool, spec),
      };
      this.boss.pattern.step(this.boss.patternState as never, ctx);
      this.boss.patternFrame += 1;
    }

    // —— 资源输入 ——
    if (input.pressed.has('hyper')) this.castHyper();
    if (input.pressed.has('bomb')) this.castBomb();

    // —— 自机 ——
    this.player.update(input.held, this.hyper.firepowerMul, this.hyper.spreadMul, this.boss.x, this.boss.y);
    if (input.held.has('shoot') && this.player.alive && this.absFrame % 6 === 0) {
      this.events?.sfx('shot');
    }

    // —— 弹池 ——
    stepBullets(this.pool, this.rng);

    // —— Bomb 冲击波消弹 ——
    if (this.bomb.update()) {
      const r = this.bomb.radius;
      const r2 = r * r;
      let i = 0;
      while (i < this.pool.n) {
        const dx = this.pool.x[i] - this.player.x, dy = this.pool.y[i] - this.player.y;
        if (dx * dx + dy * dy <= r2) {
          this.score += CFG.bomb.starScore;
          this.spawnParticle(this.pool.x[i], this.pool.y[i], 0);
          // swap-remove（与 bullets.ts 同构，场景侧只做消弹不做运动）
          const j = --this.pool.n;
          if (i !== j) {
            this.pool.x[i] = this.pool.x[j]; this.pool.y[i] = this.pool.y[j];
            this.pool.vx[i] = this.pool.vx[j]; this.pool.vy[i] = this.pool.vy[j];
            this.pool.accel[i] = this.pool.accel[j]; this.pool.vmax[i] = this.pool.vmax[j];
            this.pool.fuse[i] = this.pool.fuse[j]; this.pool.splitKind[i] = this.pool.splitKind[j];
            this.pool.sprite[i] = this.pool.sprite[j]; this.pool.grazed[i] = this.pool.grazed[j];
            this.pool.age[i] = this.pool.age[j];
          }
        } else i++;
      }
    }
    this.hyper.update();

    // —— 自机弹 vs Boss ——
    if (this.boss.inCombat && this.boss.hp > 0) {
      let anyHit = false;
      for (const s of this.player.shots) {
        if (!s.active) continue;
        const dx = s.x - this.boss.x, dy = s.y - this.boss.y;
        const r = CFG.boss.contactHitbox;
        if (dx * dx + dy * dy <= r * r) {
          this.boss.applyDamage(s.dmg);
          s.active = false;
          anyHit = true;
          if (this.fxEnabled && this.fxRng.f() < 0.3) this.spawnParticle(s.x, s.y, 4);
        }
      }
      if (anyHit) {
        this.hyper.addHitFrame();
        if (this.absFrame % 8 === 0) this.events?.sfx('enemyHit');
      }
    }

    // —— 弹 vs 自机（graze / 被弹）——
    if (this.player.alive) {
      const invincible = this.player.invuln > 0 || this.bomb.invuln > 0 || this.castInvuln > 0;
      if (!invincible) {
        let killed = false;
        for (let i = 0; i < this.pool.n; i++) {
          const res = bulletVsPlayer(this.pool, i, this.player.x, this.player.y, CFG.player.hitboxR, CFG.player.grazePad);
          if (res === 2) { killed = true; break; }
          if (res === 1) {
            this.grazeCount += 1;
            this.score += CFG.score.graze;
            this.hyper.addGraze();
            this.spawnParticle(this.player.x + (this.fxRng.f() - 0.5) * 12, this.player.y - 6, 1);
            this.events?.sfx('graze');
          }
        }
        if (killed) this.onPlayerDeath();
      }
    }

    // —— 阶段转进 ——
    if (this.boss.phaseCleared || this.boss.timedOut) {
      if (this.boss.isLastPhase && this.boss.phaseCleared) {
        this.enterFinalBurst();
      } else {
        this.cancelAllBullets(0);
        this.hyper.addPhaseClear();
        this.score += CFG.score.phaseClearBase * Math.max(1, this.lives);
        this.events?.sfx('phaseBreak');
        this.boss.startPhase(this.rng, this.boss.phaseIndex + 1);
        this.events?.sfx('spellDeclare');
      }
    }

    // —— 终局 ——
    if (this.boss.mode === 'finalburst') {
      this.finalBurstT += 1;
      if (this.finalBurstT % 6 === 0) {
        this.spawnParticle(this.boss.x + (this.fxRng.f() - 0.5) * 160, this.boss.y + (this.fxRng.f() - 0.5) * 120, 3);
      }
      if (this.finalBurstT >= 180) {
        this.mode = 'clear';
        this.score += CFG.score.allClearBonus;
        this.events?.bgm(null);
      }
    }

    this.updateParticles();
  }

  private castHyper(): void {
    if (!this.hyper.tryCast()) return;
    this.hypersUsed += 1;
    // 发动瞬间全屏消弹化星（每弹 +1000）+ 60f 无敌 + 震屏
    let stars = 0;
    for (let i = 0; i < this.pool.n; i++) {
      if (stars < 96) this.spawnParticle(this.pool.x[i], this.pool.y[i], 0);
      stars += 1;
    }
    this.score += stars * CFG.score.hyperStar;
    clearPool(this.pool);
    this.castInvuln = CFG.hyper.invulnOnCast;
    this.shake = CFG.hyper.shakeFrames;
    this.events?.sfx('hyper');
  }

  private castBomb(): void {
    if (!this.bomb.tryCast()) return;
    this.bombsUsed += 1;
    this.hyper.terminate();              // 原作互斥：Bomb 发动瞬间 Hyper 中断
    if (this.boss.inCombat) {
      this.boss.applyDamage(CFG.bomb.bossDamageRaw * CFG.bomb.bossResist);
      this.boss.bombFlash = 30;          // 「结界护罩」致敬演出
    }
    this.events?.sfx('bomb');
  }

  private onPlayerDeath(): void {
    this.hitstop = CFG.player.hitstop;
    this.player.kill();
    this.missCount += 1;
    this.lives -= 1;
    this.bomb.resetStock();              // 死亡后 Bomb 重置为 3
    this.hyper.terminate();              // 被弹 → Hyper 即刻终止清零
    this.events?.sfx('death');
    for (let k = 0; k < 24; k++) {
      this.spawnParticle(this.player.x, this.player.y, 2);
    }
    if (this.lives < 0) {
      this.mode = 'gameover';
      this.clearFrame = 0;
      this.events?.bgm(null);
    }
  }

  private enterFinalBurst(): void {
    this.cancelAllBullets(0);
    this.boss.enterMode('finalburst');
    this.finalBurstT = 0;
    this.events?.sfx('phaseBreak');
    this.events?.bgm(null);
  }

  private cancelAllBullets(_scoreEach: number): void {
    let n = 0;
    for (let i = 0; i < this.pool.n; i++) {
      if (n < 128) { this.spawnParticle(this.pool.x[i], this.pool.y[i], 0); n += 1; }
    }
    clearPool(this.pool);
  }

  private spawnParticle(x: number, y: number, kind: number): void {
    if (!this.fxEnabled) return;
    if (this.particles.length >= PARTICLE_CAP) this.particles.shift();
    const r = this.fxRng;
    const ang = r.f() * TAU;
    const sp = kind === 0 ? 0.6 + r.f() * 1.2 : kind === 2 ? 1.5 + r.f() * 3.5 : 0.5 + r.f() * 1.5;
    this.particles.push({
      x, y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - (kind === 0 ? 0.4 : 0),
      life: 0, maxLife: kind === 0 ? 40 : kind === 2 ? 50 : kind === 3 ? 90 : 24,
      kind,
      size: kind === 0 ? 4 : kind === 3 ? 8 : 3,
    });
  }

  private updateParticles(): void {
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life += 1;
      if (p.life >= p.maxLife) continue;
      p.x += p.vx; p.y += p.vy;
      p.vy += p.kind === 2 ? 0.06 : 0;
      this.particles[w++] = p;
    }
    this.particles.length = w;
  }

  // ============================== draw ==============================
  // 与 update 完全隔离（PLAN 铁律 3）：bench 传 null renderer 整体跳过。
  draw(renderer: Renderer, assetsReady: boolean): void {
    const R = renderer;
    R.clear('#050508');
    const shakeX = this.shake > 0 ? (this.fxRng.f() - 0.5) * 6 : 0;
    const shakeY = this.shake > 0 ? (this.fxRng.f() - 0.5) * 6 : 0;

    R.clipPlayfield(() => {
      R.ctx.save();
      R.ctx.translate(shakeX, shakeY);
      this.drawBackground(R);
      this.drawBullets(R);
      this.drawPlayerShots(R);
      this.drawBoss(R);          // Boss 绘于弹之上（街机惯例，针弹涡中心仍可辨）
      this.drawPlayer(R);
      this.drawParticles(R);
      this.drawBombWave(R);
      R.ctx.restore();
      // 边框
      R.ctx.strokeStyle = 'rgba(120, 100, 160, 0.5)';
      R.ctx.lineWidth = 1;
      R.ctx.strokeRect(PLAYFIELD.x - 0.5, PLAYFIELD.y - 0.5, PLAYFIELD.width + 1, PLAYFIELD.height + 1);
    });

    this.drawHudPanel(R, assetsReady);
    this.drawOverlays(R);
    R.present();
  }

  private drawBackground(R: Renderer): void {
    const px = PLAYFIELD.x, py = PLAYFIELD.y;
    const bg = R.image('inb_bg_stage');
    if (bg) {
      const scroll = (this.absFrame * 0.5) % bg.height;
      R.ctx.drawImage(bg, px, py - scroll, PLAYFIELD.width, bg.height);
      R.ctx.drawImage(bg, px, py - scroll + bg.height, PLAYFIELD.width, bg.height);
      // 发狂段叠加墨染涡
      if (this.boss.phaseId === 'finale') {
        const vortex = R.image('inb_bg_finale');
        if (vortex) {
          R.ctx.save();
          R.ctx.globalAlpha = 0.5;
          R.ctx.translate(px + PLAYFIELD.width / 2, py + 140);
          R.ctx.rotate(this.absFrame * 0.003);
          R.ctx.drawImage(vortex, -160, -160, 320, 320);
          R.ctx.restore();
        }
      }
    } else {
      const g = R.ctx.createLinearGradient(0, py, 0, py + PLAYFIELD.height);
      g.addColorStop(0, '#0a0618');
      g.addColorStop(1, '#1a0e2a');
      R.ctx.fillStyle = g;
      R.ctx.fillRect(px, py, PLAYFIELD.width, PLAYFIELD.height);
    }
  }

  private drawBoss(R: Renderer): void {
    if (this.boss.mode === 'intro' || this.boss.mode === 'warning') return;
    const bx = PLAYFIELD.x + this.boss.x, by = PLAYFIELD.y + this.boss.y;
    const img = R.image('inb_yuyuko_idle');
    const alpha = this.boss.mode === 'fadein' ? this.boss.alpha : 1;
    if (this.boss.mode === 'finalburst') {
      const fade = Math.max(0, 1 - this.finalBurstT / 120);
      if (fade <= 0) return;
      R.ctx.globalAlpha = fade;
    }
    // 发狂段炮台群
    if (this.boss.phaseId === 'finale' && (this.boss.inCombat || this.boss.mode === 'declare')) {
      const st = this.boss.patternState as { orbit: number } | null;
      const orbit = st?.orbit ?? 0;
      const turret = R.image('inb_opt_turret');
      for (let k = 0; k < CFG.finale.options.count; k++) {
        const ang = orbit + (k / CFG.finale.options.count) * TAU;
        const ox = bx + Math.cos(ang) * CFG.finale.options.radius;
        const oy = by + Math.sin(ang) * CFG.finale.options.radius;
        if (turret) {
          R.drawSpriteInBatch('inb_opt_turret', 0, 0, turret.width, turret.height, ox, oy, ang + Math.PI / 2, 1, alpha, 'lighter');
        } else {
          R.ctx.fillStyle = '#8fd';
          R.ctx.beginPath(); R.ctx.arc(ox, oy, 8, 0, TAU); R.ctx.fill();
        }
      }
    }
    if (img) {
      R.drawSprite('inb_yuyuko_idle', 0, 0, img.width, img.height, bx, by, { alpha });
    } else {
      R.ctx.save();
      R.ctx.globalAlpha = alpha;
      R.ctx.fillStyle = this.boss.hitFlash > 0 ? '#fff' : '#e8b8ff';
      R.ctx.beginPath(); R.ctx.arc(bx, by, 24, 0, TAU); R.ctx.fill();
      R.ctx.fillStyle = '#a060c0';
      R.ctx.beginPath(); R.ctx.arc(bx, by - 8, 12, 0, TAU); R.ctx.fill();
      R.ctx.restore();
    }
    if (this.boss.hitFlash > 0) {
      R.ctx.save();
      R.ctx.globalAlpha = this.boss.hitFlash / 8;
      R.ctx.globalCompositeOperation = 'lighter';
      R.ctx.fillStyle = '#fff';
      R.ctx.beginPath(); R.ctx.arc(bx, by, 30, 0, TAU); R.ctx.fill();
      R.ctx.restore();
    }
    if (this.boss.bombFlash > 0) {
      R.ctx.save();
      R.ctx.globalAlpha = this.boss.bombFlash / 30;
      R.ctx.strokeStyle = '#ffd040';
      R.ctx.lineWidth = 3;
      R.ctx.beginPath(); R.ctx.arc(bx, by, 40 + (30 - this.boss.bombFlash), 0, TAU); R.ctx.stroke();
      R.ctx.restore();
      R.text('结界护罩', bx + 30, by - 40, { size: 12, color: '#ffd040' });
    }
  }

  private drawBullets(R: Renderer): void {
    R.ctx.save();
    const pool = this.pool;
    for (let i = 0; i < pool.n; i++) {
      const spr = CFG.bullets.sprites[pool.sprite[i]];
      const key = 'inb_' + spr.key;
      const img = R.image(key);
      const x = PLAYFIELD.x + pool.x[i], y = PLAYFIELD.y + pool.y[i];
      const rot = spr.key.startsWith('needle')
        ? Math.atan2(pool.vy[i], pool.vx[i]) + Math.PI / 2
        : spr.key === 'blt_petal'
          ? pool.age[i] * 0.1
          : 0;
      const alpha = (spr as { alpha?: number }).alpha ?? 1;
      if (img) {
        R.drawSpriteInBatch(key, 0, 0, img.width, img.height, x, y, rot, 1, alpha, spr.blend as GlobalCompositeOperation);
      } else {
        // 占位：发光圆点
        R.ctx.globalAlpha = alpha;
        R.ctx.globalCompositeOperation = 'lighter';
        R.ctx.fillStyle = PLACEHOLDER_COLORS[pool.sprite[i] % PLACEHOLDER_COLORS.length];
        R.ctx.beginPath();
        R.ctx.arc(x, y, Math.max(3, spr.hitbox + 2), 0, TAU);
        R.ctx.fill();
      }
    }
    R.ctx.restore();
  }

  private drawPlayerShots(R: Renderer): void {
    R.ctx.save();
    R.ctx.globalCompositeOperation = 'lighter';
    for (const s of this.player.shots) {
      if (!s.active) continue;
      const x = PLAYFIELD.x + s.x, y = PLAYFIELD.y + s.y;
      const key = s.kind === 0 ? 'inb_shot_feather' : 'inb_shot_wave';
      const img = R.image(key);
      if (img) {
        const rot = s.kind === 1 ? Math.atan2(s.vy, s.vx) + Math.PI / 2 : 0;
        R.drawSpriteInBatch(key, 0, 0, img.width, img.height, x, y, rot, 1, 1, 'lighter');
      } else {
        R.ctx.fillStyle = s.kind === 0 ? '#ffe9a0' : '#a0e9ff';
        R.ctx.fillRect(x - 2, y - 8, 4, 16);
      }
    }
    R.ctx.restore();
  }

  private drawPlayer(R: Renderer): void {
    if (!this.player.alive) return;
    const px = PLAYFIELD.x + this.player.x, py = PLAYFIELD.y + this.player.y;
    // 子机
    const offs = this.player.focus ? CFG.player.optSlow.offsets : CFG.player.optFast.offsets;
    const orbImg = R.image('inb_opt_orb');
    R.ctx.save();
    R.ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const wob = Math.sin(this.player.optionSpin + k * Math.PI / 2) * 2;
      const ox = px + offs[k][0], oy = py + offs[k][1] + wob;
      if (orbImg) R.drawSpriteInBatch('inb_opt_orb', 0, 0, orbImg.width, orbImg.height, ox, oy, 0, 1, 0.9, 'lighter');
      else {
        R.ctx.fillStyle = '#ffd76a';
        R.ctx.beginPath(); R.ctx.arc(ox, oy, 5, 0, TAU); R.ctx.fill();
      }
    }
    R.ctx.restore();
    // 本体
    const idle = R.image('inb_mystia_idle');
    const bankImg = R.image('inb_mystia_bank');
    const flicker = this.player.invuln > 0 && (this.absFrame >> 2) % 2 === 0;
    R.ctx.save();
    if (flicker) R.ctx.globalAlpha = 0.45;
    const useBank = Math.abs(this.player.bank) > 0.35 && bankImg;
    if (useBank) {
      R.drawSprite('inb_mystia_bank', 0, 0, bankImg.width, bankImg.height, px, py, { scaleX: this.player.bank > 0 ? -1 : 1 });
    } else if (idle) {
      R.drawSprite('inb_mystia_idle', 0, 0, idle.width, idle.height, px, py, {});
    } else {
      R.ctx.fillStyle = '#ffc0d0';
      R.ctx.beginPath(); R.ctx.arc(px, py, 10, 0, TAU); R.ctx.fill();
      R.ctx.fillStyle = '#804040';
      R.ctx.beginPath(); R.ctx.arc(px, py - 4, 6, 0, TAU); R.ctx.fill();
    }
    R.ctx.restore();
    // 低速：判定点 + 音符光环
    if (this.player.focus) {
      R.ctx.save();
      R.ctx.globalCompositeOperation = 'lighter';
      R.ctx.fillStyle = '#fff';
      R.ctx.beginPath(); R.ctx.arc(px, py, CFG.player.hitboxR + 1.5, 0, TAU); R.ctx.fill();
      R.ctx.strokeStyle = `rgba(255, 220, 120, ${0.5 + 0.3 * Math.sin(this.absFrame * 0.2)})`;
      R.ctx.lineWidth = 1.5;
      R.ctx.beginPath(); R.ctx.arc(px, py, 10 + Math.sin(this.absFrame * 0.15) * 2, 0, TAU); R.ctx.stroke();
      R.ctx.restore();
    }
    // Hyper 金色声波光环
    if (this.hyper.active) {
      const ring = R.image('inb_fx_hyper');
      R.ctx.save();
      R.ctx.globalCompositeOperation = 'lighter';
      R.ctx.globalAlpha = 0.6;
      if (ring) {
        const s = 1 + 0.15 * Math.sin(this.absFrame * 0.3);
        R.drawSprite('inb_fx_hyper', 0, 0, ring.width, ring.height, px, py, { scaleMultiplier: s * 0.4, blend: 'lighter' });
      } else {
        R.ctx.strokeStyle = '#ffd040';
        R.ctx.lineWidth = 2;
        R.ctx.beginPath(); R.ctx.arc(px, py, 18 + Math.sin(this.absFrame * 0.3) * 4, 0, TAU); R.ctx.stroke();
      }
      R.ctx.restore();
    }
  }

  private drawParticles(R: Renderer): void {
    R.ctx.save();
    R.ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const t = 1 - p.life / p.maxLife;
      const x = PLAYFIELD.x + p.x, y = PLAYFIELD.y + p.y;
      if (p.kind === 0) {
        R.ctx.globalAlpha = t;
        R.ctx.fillStyle = '#fff2b0';
        R.ctx.beginPath(); R.ctx.arc(x, y, p.size * t + 1, 0, TAU); R.ctx.fill();
      } else if (p.kind === 1) {
        R.ctx.globalAlpha = t * 0.8;
        R.ctx.fillStyle = '#a0fff0';
        R.ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      } else if (p.kind === 2) {
        R.ctx.globalAlpha = t;
        R.ctx.fillStyle = '#ff7090';
        R.ctx.beginPath(); R.ctx.arc(x, y, p.size * t, 0, TAU); R.ctx.fill();
      } else if (p.kind === 3) {
        R.ctx.globalAlpha = t;
        R.ctx.fillStyle = '#ffd76a';
        R.ctx.beginPath(); R.ctx.arc(x, y, p.size * t, 0, TAU); R.ctx.fill();
      } else {
        R.ctx.globalAlpha = t * 0.7;
        R.ctx.fillStyle = '#fff';
        R.ctx.beginPath(); R.ctx.arc(x, y, 2, 0, TAU); R.ctx.fill();
      }
    }
    R.ctx.restore();
  }

  private drawBombWave(R: Renderer): void {
    if (!this.bomb.active) return;
    const px = PLAYFIELD.x + this.player.x, py = PLAYFIELD.y + this.player.y;
    const r = this.bomb.radius;
    const fx = R.image('inb_fx_bomb');
    R.ctx.save();
    R.ctx.globalCompositeOperation = 'lighter';
    if (fx) {
      const alpha = 1 - this.bomb.waveT / CFG.bomb.expandFrames;
      R.ctx.globalAlpha = Math.max(0.2, alpha);
      const scale = (r * 2) / fx.width;
      R.drawSprite('inb_fx_bomb', 0, 0, fx.width, fx.height, px, py, { scaleMultiplier: scale, blend: 'lighter' });
    } else {
      R.ctx.strokeStyle = '#ffe9a0';
      R.ctx.lineWidth = 6;
      R.ctx.globalAlpha = 1 - this.bomb.waveT / CFG.bomb.expandFrames;
      R.ctx.beginPath(); R.ctx.arc(px, py, r, 0, TAU); R.ctx.stroke();
    }
    R.ctx.restore();
  }

  private drawHudPanel(R: Renderer, assetsReady: boolean): void {
    const panel = R.image('inb_hud_panel');
    const hud: HudState = {
      score: this.score, hiScore: Math.max(this.hiScore, this.score),
      lives: this.lives, bombs: this.bomb.stock,
      hyperGauge: this.hyper.gauge, hyperMax: CFG.hyper.max,
      hyperActive: this.hyper.active, hyperFull: this.hyper.full,
      aiEnabled: this.aiEnabled,
      bossHp: this.boss.hp, bossHpMax: this.boss.hpMax,
      bossActive: this.boss.inCombat || this.boss.mode === 'hpcharge',
      hpCharge: this.boss.mode === 'hpcharge' ? this.boss.hpCharge : 1,
      phaseIndex: this.boss.phaseIndex, phaseCount: CFG.phases.length,
      timeLeft: this.boss.timeLeft(),
      graze: this.grazeCount,
      assetsReady,
    };
    drawHud(R, hud, !!panel);
  }

  private drawOverlays(R: Renderer): void {
    const m = this.boss.mode;
    if (m === 'intro') {
      R.ctx.fillStyle = '#000';
      R.ctx.fillRect(0, 0, 640, 480);
      return;
    }
    if (m === 'warning') {
      const t = this.boss.modeFrame;
      const blink = (t >> 3) % 2 === 0;
      R.ctx.save();
      R.ctx.globalAlpha = 0.85;
      R.ctx.fillStyle = '#000';
      R.ctx.fillRect(PLAYFIELD.x, 180, PLAYFIELD.width, 120);
      // 红黑警告条纹
      for (let i = 0; i < 24; i++) {
        R.ctx.fillStyle = i % 2 === 0 ? '#c01818' : '#180808';
        const x = PLAYFIELD.x + i * 16 - (t % 32);
        R.ctx.beginPath();
        R.ctx.moveTo(x, 180); R.ctx.lineTo(x + 16, 180);
        R.ctx.lineTo(x + 4, 300); R.ctx.lineTo(x - 12, 300);
        R.ctx.fill();
      }
      if (blink) {
        const banner = R.image('inb_warning_banner');
        if (banner) {
          R.ctx.drawImage(banner, PLAYFIELD.x + 32, 210, 320, 60);
        } else {
          R.text('WARNING', PLAYFIELD.x + 192, 216, { size: 40, color: '#ff2020', align: 'center', font: 'monospace' });
        }
        R.text('亡我回天', PLAYFIELD.x + 192, 266, { size: 14, color: '#ffb0b0', align: 'center' });
      }
      R.ctx.restore();
      return;
    }
    if (m === 'declare') {
      const t = this.boss.modeFrame;
      const slide = Math.min(1, t / 12);
      // 右上滑入 cut-in（playfield 右缘内，不遮 HUD 面板）
      const portrait = R.image('inb_yuyuko_portrait');
      if (portrait) {
        const pw = 150, ph = 225;
        const x = PLAYFIELD.x + PLAYFIELD.width - pw * slide;
        R.ctx.save();
        R.ctx.globalAlpha = Math.min(1, t / 20);
        R.ctx.drawImage(portrait, x, 60, pw, ph);
        R.ctx.restore();
      }
      // 符卡名横幅（金字黑底，PCB 式）
      R.ctx.save();
      R.ctx.globalAlpha = Math.min(1, t / 15);
      R.ctx.fillStyle = 'rgba(8, 4, 16, 0.88)';
      R.ctx.fillRect(PLAYFIELD.x, 330, PLAYFIELD.width, 44);
      R.ctx.strokeStyle = '#c8a840';
      R.ctx.lineWidth = 1;
      R.ctx.strokeRect(PLAYFIELD.x + 2, 332, PLAYFIELD.width - 4, 40);
      R.text(this.boss.declareName, PLAYFIELD.x + 192, 342, { size: 18, color: '#f0d878', align: 'center', font: '"MS Gothic", serif' });
      R.ctx.restore();
      return;
    }
    if (this.mode === 'gameover') {
      drawOverlayText(R, 'GAME OVER', '按 R 或 Z 重开', this.clearFrame);
      return;
    }
    if (this.mode === 'clear') {
      const r = this.result;
      R.ctx.save();
      R.ctx.fillStyle = 'rgba(4, 2, 12, 0.75)';
      R.ctx.fillRect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);
      R.text('ALL CLEAR', PLAYFIELD.x + 192, 120, { size: 44, color: '#ffd76a', align: 'center', font: 'monospace' });
      R.text('反魂蝶、散华终焉 —— 献给摘取胜利之人', PLAYFIELD.x + 192, 175, { size: 12, color: '#e8c8ff', align: 'center' });
      R.text(`SCORE  ${r.score.toLocaleString()}`, PLAYFIELD.x + 192, 220, { size: 16, color: '#fff', align: 'center' });
      R.text(`GRAZE  ${r.graze}    MISS  ${r.miss}    BOMB  ${r.bombsUsed}    HYPER  ${r.hypersUsed}`, PLAYFIELD.x + 192, 250, { size: 12, color: '#c0b0e0', align: 'center' });
      R.text(`TIME  ${(r.frame / 60).toFixed(1)}s`, PLAYFIELD.x + 192, 272, { size: 12, color: '#c0b0e0', align: 'center' });
      if (this.clearFrame > 120) R.text('按 Z 返回标题', PLAYFIELD.x + 192, 330, { size: 14, color: '#fff', align: 'center' });
      R.ctx.restore();
    }
  }
}

const PLACEHOLDER_COLORS = ['#ff9ad5', '#7ab8ff', '#ff5a4a', '#ffb0e0', '#90c8ff', '#5a8aff', '#ffc0d8', '#ff9ad5'];

export { SPRITE_KEYS };
