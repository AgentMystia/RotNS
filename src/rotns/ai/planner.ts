import { CFG } from '../config';
import { Rng } from '../../core/rng';
import { clonePoolInto, createPool, spawnBullet, stepBullets } from '../bullets';
import { bossDriftPos, patternFor } from '../boss-yuyuko';
import type { AiView, BulletPool, Pattern, PatternCtx, SpawnSpec } from '../types';
import { hintFor } from './hints';

// 规划器（PLAN §6.2）：全保真前瞻 H=42f + 分层搜索。
//
// 性能结构：P1/P4/finale 的弹幕与自机位置无关 → 弹轨可只模拟一次（shared 路径），
// 17/153 个候选策略只做碰撞评估；P2/P3 含自机狙/瞄准裂变 → 逐候选全量模拟，
// 这两段弹量较少（<500）可承受。

export interface Plan {
  ux: number; uy: number;
  focus: boolean;
  hyper: boolean;
  bomb: boolean;
  tHit: number;
  minGap: number;
}

interface Policy { ux: number; uy: number; focus: boolean }

const H = CFG.ai.horizon;        // 战术层 42f
const H2 = 120;                  // 战略层 120f：看穿"追缝入角"类延迟陷阱
const SAFE_TIER = 34;            // 生存分层阈值：≥34f 即"足够安全"，软代价接管
const STRAT_TIER = 50;           // 战略层分层阈值（>replan 余量，防陷阱）
const BAND_FINALE = [230, 390] as const;  // 发狂段 y 锚带（缠斗区；过深贴底会被花瓣扇封死）
const BAND_HYPER_DIVE = [215, 320] as const; // Hyper 主动窗贴脸带
const P = CFG.player;
const BULLET_MAX_SPEED = 5.2; // 全弹种最大速度（P4 上限）

// 弹轨快照的空间网格（shared 路径）：64px 单元覆盖 playfield+cullMargin，
// 候选策略只查玩家周边 3×3 单元 —— 1800 弹发狂段的碰撞评估 ~9x 提速。
const CELL = 64;
const GRID_X0 = -CFG.bullets.cullMargin, GRID_Y0 = -CFG.bullets.cullMargin;
const GRID_COLS = Math.ceil((CFG.playfield.w + CFG.bullets.cullMargin * 2) / CELL);   // 8
const GRID_ROWS = Math.ceil((CFG.playfield.h + CFG.bullets.cullMargin * 2) / CELL);   // 8
const GRID_CELLS = GRID_COLS * GRID_ROWS;

function cellOf(x: number, y: number): number {
  let cx = ((x - GRID_X0) / CELL) | 0;
  let cy = ((y - GRID_Y0) / CELL) | 0;
  if (cx < 0) cx = 0; else if (cx >= GRID_COLS) cx = GRID_COLS - 1;
  if (cy < 0) cy = 0; else if (cy >= GRID_ROWS) cy = GRID_ROWS - 1;
  return cy * GRID_COLS + cx;
}

// 统一比较器：先比分层（min(tHit,tier)），同层未达阈时比绝对生存，最后比软代价。
// 这让"足够安全"的火力巷道位能赢过"绝对安全但零输出"的角落。
function better(tA: number, softA: number, tB: number, softB: number, tier: number): boolean {
  const ta = Math.min(tA, tier), tb = Math.min(tB, tier);
  if (ta !== tb) return ta > tb;
  if (ta < tier && tA !== tB) return tA > tB;
  return softA < softB;
}

// 发狂段输出窗口只有 ~15-30f（人类在此微操缠斗），分层阈值必须随之降低，
// 否则 AI 永远选绝对安全的角落 = 零输出。Hyper 主动窗更激进（×2.5 抢伤害）。
function tierFor(view: AiView): number {
  if (view.phaseId !== 'finale') return SAFE_TIER;
  return view.hyperActive ? 10 : 16;
}

// 弹种是否含自机相关性（aimed）
const AIMED_PHASES = new Set(['p2', 'p3']);

const POLICIES: Policy[] = [{ ux: 0, uy: 0, focus: false }];
for (const focus of [false, true]) {
  const speed = focus ? P.speedSlow : P.speedFast;
  for (let k = 0; k < 8; k++) {
    POLICIES.push({ ux: Math.cos(k * Math.PI / 4) * speed, uy: Math.sin(k * Math.PI / 4) * speed, focus });
  }
}

function secondPolicies(base: Policy, out: Policy[]): void {
  out.length = 0;
  out.push({ ux: 0, uy: 0, focus: base.focus });
  const speed = Math.hypot(base.ux, base.uy) || P.speedFast;
  for (let k = 0; k < 8; k++) {
    out.push({ ux: Math.cos(k * Math.PI / 4) * speed, uy: Math.sin(k * Math.PI / 4) * speed, focus: base.focus });
  }
}

interface EvalOut {
  tHit: number;
  grazeFrames: number;
  endX: number; endY: number;
  minGap: number;
}

const evalOut: EvalOut = { tHit: 0, grazeFrames: 0, endX: 0, endY: 0, minGap: Infinity };

export class Planner {
  private readonly scratch = createPool();
  private readonly rng = new Rng();
  private readonly layer2: Policy[] = [];
  // shared 弹轨快照（H × cap）
  private readonly snapX: Float32Array;
  private readonly snapY: Float32Array;
  private readonly snapSpr: Uint8Array;
  private readonly snapN: Int32Array;
  private readonly gridHead: Int32Array;
  private readonly gridNext: Int32Array;
  private sharedValid = false;
  private trackOriginFrame = 0;
  private prevUx = 0; private prevUy = 0;
  private prevPlan: Plan | null = null;
  private bombCooldown = 0;
  private lastFrame = -1;

  constructor() {
    const cap = CFG.bullets.cap;
    this.snapX = new Float32Array(H2 * cap);
    this.snapY = new Float32Array(H2 * cap);
    this.snapSpr = new Uint8Array(H2 * cap);
    this.snapN = new Int32Array(H2);
    this.gridHead = new Int32Array(H2 * GRID_CELLS);
    this.gridNext = new Int32Array(H2 * cap);
  }

  decide(view: AiView): Plan {
    if (this.lastFrame >= 0) this.bombCooldown = Math.max(0, this.bombCooldown - (view.frame - this.lastFrame));
    this.lastFrame = view.frame;
    this.sharedValid = false;

    const shared = !AIMED_PHASES.has(view.phaseId);
    if (shared) this.buildSharedTrack(view);
    this.sharedValid = shared;

    // 滞回：上一帧计划仍安全则沿用
    if (this.prevPlan && this.prevPlan.tHit >= H - CFG.ai.hysteresisMargin) {
      const check = this.evalPolicy(view, this.prevPlan.ux, this.prevPlan.uy, this.prevPlan.focus, null, H);
      if (check.tHit >= H - CFG.ai.hysteresisMargin) {
        this.prevPlan.hyper = false; this.prevPlan.bomb = false;
        this.prevPlan.minGap = check.minGap;
        this.applyResourceRules(view, this.prevPlan, check);
        return this.prevPlan;
      }
    }

    // 第一层：17 恒定策略（战术 H）
    const tier = tierFor(view);
    let best: Plan | null = null;
    let bestSoft = Infinity;
    const layer1T: number[] = [];
    for (let pi = 0; pi < POLICIES.length; pi++) {
      const pol = POLICIES[pi];
      const r = this.evalPolicy(view, pol.ux, pol.uy, pol.focus, null, H);
      layer1T.push(r.tHit);
      const soft = this.softCost(view, r, pol);
      if (!best || better(r.tHit, soft, best.tHit, bestSoft, tier)) {
        best = { ux: pol.ux, uy: pol.uy, focus: pol.focus, hyper: false, bomb: false, tHit: r.tHit, minGap: r.minGap };
        bestSoft = soft;
      }
    }

    // 第二层：t=12f 分叉。只对 12f 内存活的首段分叉，且按 (tHit,soft) 取前 4
    // （aimed 段全量模拟单条昂贵，branch 数封顶保预算）
    if (best!.tHit < H) {
      const branchAt = CFG.ai.branchAt;
      const order: number[] = [];
      for (let pi = 0; pi < POLICIES.length; pi++) {
        if (layer1T[pi] > branchAt) order.push(pi);
      }
      order.sort((a, b) => layer1T[b] - layer1T[a]);
      if (order.length > 4) order.length = 4;
      for (const pi of order) {
        const first = POLICIES[pi];
        secondPolicies(first, this.layer2);
        for (const second of this.layer2) {
          const r = this.evalPolicy(view, first.ux, first.uy, first.focus, second, H);
          const soft = this.softCost(view, r, second) + 0.5;
          if (better(r.tHit, soft, best!.tHit, bestSoft, tier)) {
            best = { ux: first.ux, uy: first.uy, focus: first.focus, hyper: false, bomb: false, tHit: r.tHit, minGap: r.minGap };
            bestSoft = soft;
          }
        }
      }
    }

    // 战略层：短期全安全时，用 120f 前瞻重选（静止+8 快速方向足以看穿陷阱）
    if (best!.tHit >= H) {
      let strat: Plan | null = null;
      let stratT = -1;
      let stratSoft = Infinity;
      for (let pi = 0; pi <= 8; pi++) {
        const pol = POLICIES[pi];
        const r = this.evalPolicy(view, pol.ux, pol.uy, pol.focus, null, H2);
        const soft = this.softCost(view, r, pol);
        if (!strat || better(r.tHit, soft, stratT, stratSoft, STRAT_TIER)) {
          strat = { ux: pol.ux, uy: pol.uy, focus: pol.focus, hyper: false, bomb: false, tHit: Math.min(r.tHit, H) >= H ? H : r.tHit, minGap: r.minGap };
          stratT = r.tHit;
          stratSoft = soft;
        }
      }
      // 战略层确认短期安全才采纳（防 120f 内早期死亡）
      if (strat && strat.tHit >= H) {
        strat.tHit = best!.tHit;   // 对外暴露战术安全性（≥H 即安全）
        best = strat;
      }
    }

    this.applyResourceRules(view, best!, null);
    this.prevUx = best!.ux; this.prevUy = best!.uy;
    this.prevPlan = best!;
    return best!;
  }

  // humanizer 安全红线用：评估单策略 H 帧前瞻 tHit（须在同帧 decide() 之后调用，
  // shared 弹轨快照仍有效；aimed 段每次独立全量模拟）。
  // 键语义归一化：把 (ux,uy,focus) 映射回按键再按游戏物理还原速度，
  // 保证验证的就是游戏将执行的，从结构上杜绝 sim/执行分歧。
  // 快照帧偏移：decide 后第 k 帧调用时按 k 偏移读取弹轨（每帧急救校验用）。
  validate(view: AiView, ux: number, uy: number, focus: boolean): number {
    const kx = ux < -0.01 ? -1 : ux > 0.01 ? 1 : 0;
    const ky = uy < -0.01 ? -1 : uy > 0.01 ? 1 : 0;
    const speed = focus ? P.speedSlow : P.speedFast;
    const diag = kx !== 0 && ky !== 0 ? P.diagScale : 1;
    if (this.sharedValid) {
      const offset = Math.max(0, view.frame - this.trackOriginFrame);
      if (offset > H2 - H) return 0; // 快照过期（不应发生）
      return this.evalShared(view, kx * speed * diag, ky * speed * diag, null, H, offset).tHit;
    }
    return this.evalFull(view, kx * speed * diag, ky * speed * diag, focus, null, H).tHit;
  }

  private applyResourceRules(view: AiView, plan: Plan, check: EvalOut | null): void {
    const minGap = check ? check.minGap : plan.minGap;
    const tHit = check ? check.tHit : plan.tHit;
    const hyperReady = !view.hyperActive && view.hyperGauge >= CFG.hyper.max;

    if (view.phaseId === 'p4' && hyperReady
        && view.p4IntervalNow > 0 && view.p4IntervalNow < CFG.p4.hyperHintInterval
        && view.bulletCount > CFG.ai.p4BulletCountHint) {
      plan.hyper = true;
      return;
    }
    if (view.phaseId === 'finale' && minGap < CFG.ai.gambleGapPx && view.invuln <= 0) {
      if (hyperReady) { plan.hyper = true; return; }
      if (view.bombs > 0 && this.bombCooldown <= 0) {
        plan.bomb = true;
        this.bombCooldown = CFG.ai.bombPanicCooldown;
        return;
      }
    }
    // 发狂输出窗口：满槽 + 过入场保留期 → 主动 Hyper（发动消弹+60f 无敌
    // 自带贴脸窗口，墙角发动也能借消弹空隙转入爆发位）
    if (view.phaseId === 'finale' && hyperReady && view.patternFrame > 300) {
      plan.hyper = true;
      return;
    }
    // 预测无解：有满槽 Hyper→C；否则 X；均无→博命
    if (tHit < CFG.ai.panicThreshold) {
      if (hyperReady) { plan.hyper = true; return; }
      if (view.bombs > 0 && this.bombCooldown <= 0 && view.invuln <= 0) {
        plan.bomb = true;
        this.bombCooldown = CFG.ai.bombPanicCooldown;
      }
    }
  }

  private softCost(view: AiView, r: EvalOut, pol: Policy): number {
    const A = CFG.ai;
    const finale = view.phaseId === 'finale';
    // 发狂段贴近缠斗（街机贴脸文化）；Hyper 主动窗=贴脸爆发窗
    const bandY = finale
      ? (view.hyperActive ? BAND_HYPER_DIVE : BAND_FINALE)
      : A.anchorBandY;
    let anchor = 0;
    if (r.endY < bandY[0]) anchor += (bandY[0] - r.endY) * 1.5;
    if (r.endY > bandY[1]) anchor += (r.endY - bandY[1]) * 1.5;
    anchor += Math.max(0, Math.abs(r.endX - view.bossX) - A.anchorBossXPad);
    // 火力巷道：安全选项里优先待在 Boss 正下方（防"安全但零输出"的角落瘫痪）。
    // 分带奖励：主射对齐带（|Δx|<24）与副炮命中带（|Δx|<110）—— 鼓励驻留输出。
    const hyperDive = finale && view.hyperActive;
    const laneW = hyperDive ? 20 : finale ? 8 : 4;
    const laneDist = Math.abs(r.endX - view.bossX);
    anchor += Math.max(0, laneDist - 30) * laneW;
    if (r.endY > view.bossY + 100) {
      if (laneDist < 24) anchor -= 250;
      else if (laneDist < 110) anchor -= 200;
    }
    if (r.endY < view.bossY + 80) anchor += 200;
    // Hyper 发动初期的贴脸紧迫项：12s 窗口的前 100f 必须到位，否则爆发浪费
    if (hyperDive && view.hyperLeft > CFG.hyper.duration - 100) {
      const inBand = r.endY >= BAND_HYPER_DIVE[0] && r.endY <= BAND_HYPER_DIVE[1];
      if (inBand && laneDist < 60) anchor -= 1500;
      else anchor += 800;
    }
    // 无敌将尽（<90f）：撤掉一切火力诱惑，强制回安全位 —— 防"借无敌抢位、
    // 无敌结束瞬间暴毙"的连锁死亡
    if (view.invuln > 0 && view.invuln < 90) {
      anchor += Math.abs(r.endX - 192) * 2;
      if (r.endY < 330) anchor += (330 - r.endY) * 4;
      if (laneDist < 110) anchor += 400;
    }
    // 侧墙邻近罚（贴墙=被条带挤死的经典死法）
    if (Math.abs(r.endX - 192) > 170) anchor += 150;
    const flip = (pol.ux !== this.prevUx || pol.uy !== this.prevUy) ? 1 : 0;
    const grazeReward = r.tHit > A.graceGrazeSlack ? r.grazeFrames : 0;
    const hint = hintFor(view.phaseId).cost(view, r.endX, r.endY);
    return A.weightAnchor * anchor + A.weightFlip * flip
      - A.weightGraze * grazeReward * 0.1 + A.weightHint * hint;
  }

  private evalPolicy(view: AiView, ux: number, uy: number, focus: boolean, second: Policy | null, frames: number): EvalOut {
    return this.sharedValid
      ? this.evalShared(view, ux, uy, second, frames, 0)
      : this.evalFull(view, ux, uy, focus, second, frames);
  }

  // —— shared：弹轨与自机无关，模拟一次存快照（全长 H2，战术/战略共用）——
  private buildSharedTrack(view: AiView): void {
    const reach = (P.speedFast + BULLET_MAX_SPEED) * H2 + 40;
    clonePoolInto(this.scratch, view.pool, view.playerX, view.playerY, reach);
    const pool = this.scratch;
    const pattern = view.inCombat ? patternFor(view.phaseId as never) : null;
    const pstate = view.patternState ? Object.assign({}, view.patternState) : null;
    this.rng.seed = view.rngSeed;
    const rng = this.rng;
    const cap = CFG.bullets.cap;
    this.trackOriginFrame = view.frame;
    const ctx: PatternCtx = {
      rng, frame: 0,
      playerX: view.playerX, playerY: view.playerY,
      bossX: 0, bossY: 0,
      spawn: (s: SpawnSpec) => spawnBullet(pool, s),
    };
    for (let t = 1; t <= H2; t++) {
      if (pattern && pstate) {
        const bpos = bossDriftPos(view.phaseId as never, view.frame + t);
        ctx.frame = view.patternFrame + t - 1;
        ctx.bossX = bpos.x; ctx.bossY = bpos.y;
        pattern.step(pstate as never, ctx);
      }
      stepBullets(pool, rng);
      const base = (t - 1) * cap;
      const n = pool.n;
      this.snapN[t - 1] = n;
      // 空间网格：重置本帧单元头后逐弹插入
      const gBase = (t - 1) * GRID_CELLS;
      this.gridHead.fill(-1, gBase, gBase + GRID_CELLS);
      for (let i = 0; i < n; i++) {
        this.snapX[base + i] = pool.x[i];
        this.snapY[base + i] = pool.y[i];
        this.snapSpr[base + i] = pool.sprite[i];
        const c = cellOf(pool.x[i], pool.y[i]);
        this.gridNext[base + i] = this.gridHead[gBase + c];
        this.gridHead[gBase + c] = i;
      }
    }
  }

  private evalShared(view: AiView, ux: number, uy: number, second: Policy | null, frames: number, snapOffset: number): EvalOut {
    let px = view.playerX, py = view.playerY;
    let tHit = frames, grazeFrames = 0, minGap = Infinity;
    const branchAt = CFG.ai.branchAt;
    const cap = CFG.bullets.cap;
    const F = CFG.playfield;
    const gp = P.grazePad;
    for (let t = 1; t <= frames; t++) {
      let mx = ux, my = uy;
      if (second && t > branchAt) { mx = second.ux; my = second.uy; }
      px = Math.min(F.maxX, Math.max(F.minX, px + mx));
      py = Math.min(F.maxY, Math.max(F.minY, py + my));
      const margin = t > CFG.ai.safeMarginBase ? (t - CFG.ai.safeMarginBase) * CFG.ai.safeMarginRate : 0;
      const pr = P.hitboxR + margin;
      const base = (snapOffset + t - 1) * cap;
      // 只查玩家周边 3×3 单元（空间网格）
      let gapLeft = -Infinity, gapRight = Infinity;
      let hit = false;
      const vulnerable = t > view.invuln;   // 无敌帧内跳过碰撞（bomb/hyper/复活窗口可穿弹抢位）
      const pcx = Math.min(GRID_COLS - 1, Math.max(0, ((px - GRID_X0) / CELL) | 0));
      const pcy = Math.min(GRID_ROWS - 1, Math.max(0, ((py - GRID_Y0) / CELL) | 0));
      const gBase = (snapOffset + t - 1) * GRID_CELLS;
      for (let gy = pcy - 1; gy <= pcy + 1 && !hit; gy++) {
        if (gy < 0 || gy >= GRID_ROWS) continue;
        for (let gx = pcx - 1; gx <= pcx + 1 && !hit; gx++) {
          if (gx < 0 || gx >= GRID_COLS) continue;
          for (let i = this.gridHead[gBase + gy * GRID_COLS + gx]; i !== -1; i = this.gridNext[base + i]) {
            const dx = this.snapX[base + i] - px;
            const adx = dx < 0 ? -dx : dx;
            if (adx > 40) continue;
            const dy = this.snapY[base + i] - py;
            const ady = dy < 0 ? -dy : dy;
            if (ady > 40) continue;
            const hb = CFG.bullets.sprites[this.snapSpr[base + i]].hitbox;
            if (vulnerable) {
              const rr = hb + pr;
              if (adx <= rr && ady <= rr && dx * dx + dy * dy <= rr * rr) { hit = true; break; }
              const rg = hb + gp;
              if (adx <= rg && ady <= rg) grazeFrames += 1;
            }
            if (ady < 26) {
              const bx = this.snapX[base + i];
              if (dx <= 0 && bx > gapLeft) gapLeft = bx;
              if (dx > 0 && bx < gapRight) gapRight = bx;
            }
          }
        }
      }
      if (gapLeft > -Infinity && gapRight < Infinity) {
        const gap = gapRight - gapLeft;
        if (gap < minGap) minGap = gap;
      }
      if (hit) { tHit = t; break; }
    }
    evalOut.tHit = tHit;
    evalOut.grazeFrames = grazeFrames;
    evalOut.endX = px; evalOut.endY = py;
    evalOut.minGap = minGap;
    return evalOut;
  }

  // —— full：自机狙段逐候选全量模拟 ——
  private evalFull(view: AiView, ux: number, uy: number, focus: boolean, second: Policy | null, frames: number): EvalOut {
    const reach = (P.speedFast + BULLET_MAX_SPEED) * frames + 40;
    clonePoolInto(this.scratch, view.pool, view.playerX, view.playerY, reach);
    const pool = this.scratch;
    const pattern = view.inCombat ? patternFor(view.phaseId as never) : null;
    const pstate = view.patternState ? Object.assign({}, view.patternState) : null;
    this.rng.seed = view.rngSeed;
    const rng = this.rng;
    void focus;

    let px = view.playerX, py = view.playerY;
    let tHit = frames, grazeFrames = 0, minGap = Infinity;
    const branchAt = CFG.ai.branchAt;
    const F = CFG.playfield;
    const gp = P.grazePad;
    const ctx: PatternCtx = {
      rng, frame: 0, playerX: px, playerY: py, bossX: 0, bossY: 0,
      spawn: (s: SpawnSpec) => spawnBullet(pool, s),
    };

    for (let t = 1; t <= frames; t++) {
      let mx = ux, my = uy;
      if (second && t > branchAt) { mx = second.ux; my = second.uy; }
      px = Math.min(F.maxX, Math.max(F.minX, px + mx));
      py = Math.min(F.maxY, Math.max(F.minY, py + my));
      if (pattern && pstate) {
        const bpos = bossDriftPos(view.phaseId as never, view.frame + t);
        ctx.frame = view.patternFrame + t - 1;
        ctx.playerX = px; ctx.playerY = py;
        ctx.bossX = bpos.x; ctx.bossY = bpos.y;
        pattern.step(pstate as never, ctx);
      }
      stepBullets(pool, rng);
      const margin = t > CFG.ai.safeMarginBase ? (t - CFG.ai.safeMarginBase) * CFG.ai.safeMarginRate : 0;
      const pr = P.hitboxR + margin;
      let gapLeft = -Infinity, gapRight = Infinity;
      let hit = false;
      const vulnerable = t > view.invuln;
      for (let i = 0; i < pool.n; i++) {
        const dx = pool.x[i] - px;
        const adx = dx < 0 ? -dx : dx;
        if (adx > 40) continue;
        const dy = pool.y[i] - py;
        const ady = dy < 0 ? -dy : dy;
        if (ady > 40) continue;
        const hb = CFG.bullets.sprites[pool.sprite[i]].hitbox;
        if (vulnerable) {
          const rr = hb + pr;
          if (adx <= rr && ady <= rr && dx * dx + dy * dy <= rr * rr) { hit = true; break; }
          const rg = hb + gp;
          if (adx <= rg && ady <= rg && pool.grazed[i] === 0) { pool.grazed[i] = 1; grazeFrames += 1; }
        }
        if (ady < 26) {
          const bx = pool.x[i];
          if (dx <= 0 && bx > gapLeft) gapLeft = bx;
          if (dx > 0 && bx < gapRight) gapRight = bx;
        }
      }
      if (gapLeft > -Infinity && gapRight < Infinity) {
        const gap = gapRight - gapLeft;
        if (gap < minGap) minGap = gap;
      }
      if (hit) { tHit = t; break; }
    }
    evalOut.tHit = tHit;
    evalOut.grazeFrames = grazeFrames;
    evalOut.endX = px; evalOut.endY = py;
    evalOut.minGap = minGap;
    return evalOut;
  }
}
