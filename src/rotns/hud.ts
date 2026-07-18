import { CFG } from './config';
import { PLAYFIELD, Renderer } from '../gfx/renderer';

export interface HudState {
  score: number; hiScore: number;
  lives: number; bombs: number;
  hyperGauge: number; hyperMax: number;
  hyperActive: boolean; hyperFull: boolean;
  aiEnabled: boolean;
  bossHp: number; bossHpMax: number;
  bossActive: boolean;
  hpCharge: number;
  phaseIndex: number; phaseCount: number;
  timeLeft: number;
  graze: number;
  assetsReady: boolean;
}

const PANEL_X = PLAYFIELD.x + PLAYFIELD.width + 8; // 424

export function drawHud(R: Renderer, h: HudState, hasPanel: boolean): void {
  // 右侧面板（布局适配生成的 hud_panel：中部矩形=数据区，底部椭圆=Hyper 区）
  if (hasPanel) {
    R.ctx.drawImage(R.image('inb_hud_panel')!, PANEL_X - 8, 0, 224, 480);
  } else {
    R.ctx.fillStyle = '#0b0714';
    R.ctx.fillRect(PANEL_X - 8, 0, 640 - PANEL_X + 8, 480);
    R.ctx.strokeStyle = 'rgba(150, 110, 200, 0.35)';
    R.ctx.strokeRect(PANEL_X - 8.5, 0.5, 640 - PANEL_X + 8, 479);
  }

  // —— 中部数据区 ——
  R.text('SCORE', PANEL_X + 16, 92, { size: 11, color: '#b090d0' });
  R.text(h.score.toLocaleString().padStart(11, '0'), PANEL_X + 16, 106, { size: 15, color: '#fff', font: 'monospace' });
  R.text('HISCORE', PANEL_X + 16, 130, { size: 11, color: '#b090d0' });
  R.text(h.hiScore.toLocaleString().padStart(11, '0'), PANEL_X + 16, 144, { size: 15, color: '#f0d878', font: 'monospace' });

  // 残机 / Bomb 图标行
  R.text('残机', PANEL_X + 16, 176, { size: 11, color: '#b090d0' });
  const lifeIcon = R.image('inb_icon_life');
  for (let i = 0; i < Math.max(0, h.lives); i++) {
    if (lifeIcon) R.ctx.drawImage(lifeIcon, PANEL_X + 56 + i * 22, 172, 18, 18);
    else {
      R.ctx.fillStyle = '#ffc0d0';
      R.ctx.beginPath(); R.ctx.arc(PANEL_X + 64 + i * 22, 181, 7, 0, Math.PI * 2); R.ctx.fill();
    }
  }
  R.text('BOMB', PANEL_X + 16, 204, { size: 11, color: '#b090d0' });
  const bombIcon = R.image('inb_icon_bomb');
  for (let i = 0; i < h.bombs; i++) {
    if (bombIcon) R.ctx.drawImage(bombIcon, PANEL_X + 56 + i * 22, 200, 18, 18);
    else {
      R.ctx.fillStyle = '#a0e9ff';
      R.ctx.beginPath(); R.ctx.arc(PANEL_X + 64 + i * 22, 209, 7, 0, Math.PI * 2); R.ctx.fill();
    }
  }

  // GRAZE 计数
  R.text(`GRAZE ${h.graze}`, PANEL_X + 16, 232, { size: 11, color: '#90c8b0' });

  // —— 底部椭圆 Hyper 区（横向量表）——
  R.text(h.hyperActive ? 'HYPER!!' : 'HYPER', PANEL_X + 16, 282, {
    size: 12, color: h.hyperActive ? '#ffb040' : '#9060c0',
  });
  const gx = PANEL_X + 16, gy = 300, gw = 192, gh = 14;
  R.ctx.fillStyle = 'rgba(20, 12, 36, 0.85)';
  R.ctx.fillRect(gx, gy, gw, gh);
  R.ctx.strokeStyle = '#8060a8';
  R.ctx.strokeRect(gx - 0.5, gy - 0.5, gw + 1, gh + 1);
  const ratio = Math.min(1, h.hyperGauge / h.hyperMax);
  const grad = R.ctx.createLinearGradient(gx, 0, gx + gw, 0);
  if (h.hyperActive) {
    grad.addColorStop(0, '#ff9020'); grad.addColorStop(1, '#fff0a0');
  } else if (h.hyperFull) {
    grad.addColorStop(0, '#d0a020'); grad.addColorStop(1, '#ffe870');
  } else {
    grad.addColorStop(0, '#503088'); grad.addColorStop(1, '#9060d0');
  }
  R.ctx.fillStyle = grad;
  R.ctx.fillRect(gx, gy, gw * ratio, gh);
  if (h.hyperFull && !h.hyperActive && (performanceNow() >> 3) % 2 === 0) {
    R.text('[C] 发动!', PANEL_X + 16, 322, { size: 12, color: '#ffe870' });
  }

  // AUTO 徽标（脉动）
  if (h.aiEnabled) {
    const pulse = 0.55 + 0.45 * Math.sin(performanceNow() * 0.012);
    R.ctx.save();
    R.ctx.globalAlpha = pulse;
    R.ctx.fillStyle = '#20c080';
    R.ctx.fillRect(PANEL_X + 16, 348, 74, 22);
    R.ctx.restore();
    R.text('AUTO', PANEL_X + 53, 352, { size: 14, color: '#041008', align: 'center', font: 'monospace' });
  }

  // 操作帮助（底部装饰区上方，小号暗色）
  const help = ['Z 射击 Shift 低速 X Bomb', 'C Hyper  A AI  R 重开  M 静音'];
  help.forEach((s, i) => R.text(s, PANEL_X + 16, 446 + i * 15, { size: 10, color: '#7060a0' }));

  // —— Boss HP 条（playfield 顶部，5 段刻度）——
  if (h.bossActive) {
    const bx = PLAYFIELD.x + 6, bw = PLAYFIELD.width - 12, by = PLAYFIELD.y + 4;
    R.ctx.fillStyle = 'rgba(10, 6, 20, 0.7)';
    R.ctx.fillRect(bx, by, bw, 7);
    const ratio2 = Math.max(0, h.bossHp / h.bossHpMax) * h.hpCharge;
    R.ctx.fillStyle = h.phaseIndex >= CFG.phases.length - 1 ? '#ff4050' : '#e05070';
    R.ctx.fillRect(bx, by, bw * ratio2, 7);
    R.ctx.fillStyle = 'rgba(255,255,255,0.5)';
    R.ctx.fillRect(bx, by, bw * ratio2, 2);
    // 段刻度
    for (let k = 0; k < h.phaseCount; k++) {
      const tx = bx + (k + 0.5) * (bw / h.phaseCount);
      R.ctx.fillStyle = k < h.phaseIndex ? '#584060' : k === h.phaseIndex ? '#ffd76a' : '#c0b0d0';
      R.ctx.beginPath(); R.ctx.arc(tx, by + 12, 2.5, 0, Math.PI * 2); R.ctx.fill();
    }
    // 时限
    if (h.timeLeft !== Infinity && h.bossActive) {
      const sec = Math.ceil(h.timeLeft / 60);
      R.text(String(sec).padStart(2, '0'), PLAYFIELD.x + PLAYFIELD.width - 34, by + 12, {
        size: 13, color: sec <= 10 ? '#ff6060' : '#c0b0e0', font: 'monospace',
      });
    }
  }
}

export function drawOverlayText(R: Renderer, title: string, sub: string, t: number): void {
  R.ctx.save();
  R.ctx.fillStyle = 'rgba(4, 2, 12, 0.7)';
  R.ctx.fillRect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);
  R.text(title, PLAYFIELD.x + 192, 180, { size: 40, color: '#ff8080', align: 'center', font: 'monospace' });
  if (t > 60 && (t >> 4) % 2 === 0) {
    R.text(sub, PLAYFIELD.x + 192, 260, { size: 14, color: '#fff', align: 'center' });
  }
  R.ctx.restore();
}

// 与渲染解耦的单调毫秒源（bench/node 也有 performance）
function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
