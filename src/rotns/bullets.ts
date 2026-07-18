import { CFG } from './config';
import type { BulletPool, SpawnSpec } from './types';
import type { Rng } from '../core/rng';

// —— 裂变表（splitKind → 裂变规格）——
// kind 1: P2 母弹裂变：14 发径向均布，继承 30% 母弹动量，75% 粉针/25% 蝶弹。
export const SPLIT_TABLE = [
  null,
  { count: CFG.p2.split.count, speed: CFG.p2.split.speed, momentum: CFG.p2.split.momentum, butterflyRatio: CFG.p2.split.butterflyRatio },
] as const;

export const SPRITE = {
  NEEDLE_PINK: 0, NEEDLE_BLUE: 1, NEEDLE_RED: 2,
  BALL_S_PINK: 3, BALL_S_BLUE: 4, BALL_L_BLUE: 5,
  PETAL: 6, BUTTERFLY: 7,
} as const;

export function createPool(cap = CFG.bullets.cap): BulletPool {
  return {
    n: 0, cap,
    x: new Float32Array(cap), y: new Float32Array(cap),
    vx: new Float32Array(cap), vy: new Float32Array(cap),
    accel: new Float32Array(cap), vmax: new Float32Array(cap),
    fuse: new Int16Array(cap), splitKind: new Uint8Array(cap),
    sprite: new Uint8Array(cap), grazed: new Uint8Array(cap),
    age: new Int16Array(cap),
  };
}

export function spawnBullet(pool: BulletPool, spec: SpawnSpec): void {
  if (pool.n >= pool.cap) return; // 满则丢弃（峰值 ~1800，cap 2400 不应触达）
  const i = pool.n++;
  pool.x[i] = spec.x; pool.y[i] = spec.y;
  pool.vx[i] = Math.cos(spec.angle) * spec.speed;
  pool.vy[i] = Math.sin(spec.angle) * spec.speed;
  pool.accel[i] = spec.accel ?? 0;
  pool.vmax[i] = spec.vmax ?? 0;
  pool.fuse[i] = spec.fuse ?? -1;
  pool.splitKind[i] = spec.splitKind ?? 0;
  pool.sprite[i] = spec.sprite;
  pool.grazed[i] = 0;
  pool.age[i] = 0;
}

// 瞬态裂变事件队列（每次 stepBullets 内排空，不参与克隆）
const splitQ: { x: number; y: number; vx: number; vy: number; kind: number }[] = [];

// 纯函数铁律（PLAN §3 铁律 2）：弹运动/加速/裂变判定全部在此，
// scene 与 AI 前瞻同源调用，禁止在场景内散写弹运动副作用。
export function stepBullet(pool: BulletPool, i: number): boolean {
  pool.age[i] += 1;
  const fuse = pool.fuse[i];
  if (fuse > 0) {
    const nf = fuse - 1;
    pool.fuse[i] = nf;
    if (nf === 0 && pool.splitKind[i] > 0) {
      splitQ.push({ x: pool.x[i], y: pool.y[i], vx: pool.vx[i], vy: pool.vy[i], kind: pool.splitKind[i] });
      return false;
    }
  }
  const a = pool.accel[i];
  if (a !== 0) {
    const vx = pool.vx[i], vy = pool.vy[i];
    const sp = Math.sqrt(vx * vx + vy * vy);
    if (sp > 1e-6) {
      let ns = sp + a;
      const vmax = pool.vmax[i];
      if (vmax > 0 && ns > vmax) ns = vmax;
      if (ns < 0) ns = 0;
      const k = ns / sp;
      pool.vx[i] = vx * k; pool.vy[i] = vy * k;
    }
  }
  pool.x[i] += pool.vx[i];
  pool.y[i] += pool.vy[i];
  const m = CFG.bullets.cullMargin;
  if (pool.x[i] < -m || pool.x[i] > CFG.playfield.w + m || pool.y[i] < -m || pool.y[i] > CFG.playfield.h + m) {
    return false;
  }
  return true;
}

function swapRemove(pool: BulletPool, i: number): void {
  const j = --pool.n;
  if (i === j) return;
  pool.x[i] = pool.x[j]; pool.y[i] = pool.y[j];
  pool.vx[i] = pool.vx[j]; pool.vy[i] = pool.vy[j];
  pool.accel[i] = pool.accel[j]; pool.vmax[i] = pool.vmax[j];
  pool.fuse[i] = pool.fuse[j]; pool.splitKind[i] = pool.splitKind[j];
  pool.sprite[i] = pool.sprite[j]; pool.grazed[i] = pool.grazed[j];
  pool.age[i] = pool.age[j];
}

function drainSplits(pool: BulletPool, rng: Rng): void {
  for (let e = 0; e < splitQ.length; e++) {
    const ev = splitQ[e];
    const spec = SPLIT_TABLE[ev.kind];
    if (!spec) continue;
    const base = rng.f() * Math.PI * 2;
    for (let k = 0; k < spec.count; k++) {
      const ang = base + (k / spec.count) * Math.PI * 2;
      const cx = Math.cos(ang) * spec.speed + ev.vx * spec.momentum;
      const cy = Math.sin(ang) * spec.speed + ev.vy * spec.momentum;
      const butterfly = rng.f() < spec.butterflyRatio;
      if (pool.n >= pool.cap) break;
      const i = pool.n++;
      pool.x[i] = ev.x; pool.y[i] = ev.y;
      pool.vx[i] = cx; pool.vy[i] = cy;
      pool.accel[i] = 0; pool.vmax[i] = 0;
      pool.fuse[i] = -1; pool.splitKind[i] = 0;
      pool.sprite[i] = butterfly ? SPRITE.BUTTERFLY : SPRITE.NEEDLE_PINK;
      pool.grazed[i] = 0;
      pool.age[i] = 0;
    }
  }
  splitQ.length = 0;
}

// 每帧弹池驱动：步进→交换删除→裂变排空。scene 与 AI 前瞻唯一入口。
export function stepBullets(pool: BulletPool, rng: Rng): void {
  let i = 0;
  while (i < pool.n) {
    if (stepBullet(pool, i)) i++;
    else swapRemove(pool, i);
  }
  drainSplits(pool, rng);
}

// AI 可达域剪枝克隆：只复制与 (cx,cy) 可达包络相交的弹。
export function clonePoolInto(dst: BulletPool, src: BulletPool, cx: number, cy: number, reach: number): void {
  dst.n = 0;
  const r2 = reach * reach;
  for (let i = 0; i < src.n; i++) {
    const dx = src.x[i] - cx, dy = src.y[i] - cy;
    if (dx * dx + dy * dy > r2) continue;
    const j = dst.n++;
    dst.x[j] = src.x[i]; dst.y[j] = src.y[i];
    dst.vx[j] = src.vx[i]; dst.vy[j] = src.vy[i];
    dst.accel[j] = src.accel[i]; dst.vmax[j] = src.vmax[i];
    dst.fuse[j] = src.fuse[i]; dst.splitKind[j] = src.splitKind[i];
    dst.sprite[j] = src.sprite[i]; dst.grazed[j] = src.grazed[i];
    dst.age[j] = src.age[i];
  }
}

export function clearPool(pool: BulletPool): void {
  pool.n = 0;
}

// —— 碰撞（圆判定；graze 盒 = 判定 + grazePad，逐弹一次）——
export function bulletHitPlayer(pool: BulletPool, i: number, px: number, py: number, playerR: number): boolean {
  const r = CFG.bullets.sprites[pool.sprite[i]].hitbox + playerR;
  const dx = pool.x[i] - px, dy = pool.y[i] - py;
  return dx * dx + dy * dy <= r * r;
}

// 返回 0=无接触 1=graze 2=命中
export function bulletVsPlayer(pool: BulletPool, i: number, px: number, py: number, playerR: number, grazePad: number): 0 | 1 | 2 {
  const hb = CFG.bullets.sprites[pool.sprite[i]].hitbox;
  const dx = pool.x[i] - px, dy = pool.y[i] - py;
  const d2 = dx * dx + dy * dy;
  const rHit = hb + playerR;
  if (d2 <= rHit * rHit) return 2;
  if (pool.grazed[i] === 0) {
    const rG = hb + grazePad;
    if (d2 <= rG * rG) { pool.grazed[i] = 1; return 1; }
  }
  return 0;
}
