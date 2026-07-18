import { Renderer } from '../gfx/renderer';
import type { Button } from '../core/input';

export interface TitleChoice {
  start: boolean;
  autoplay: boolean;
}

// 自制极简标题场景（不用 title01.anm，PLAN §3.2）
export class TitleScene {
  private sel = 0;
  private frame = 0;
  private readonly items = ['GAME START', '操作说明'];
  private showHelp = false;

  update(input: { held: ReadonlySet<Button>; pressed: ReadonlySet<Button> }): TitleChoice | null {
    this.frame += 1;
    const p = input.pressed;
    if (this.showHelp) {
      if (p.has('confirm') || p.has('back')) this.showHelp = false;
      return null;
    }
    if (p.has('up')) this.sel = (this.sel + this.items.length - 1) % this.items.length;
    if (p.has('down')) this.sel = (this.sel + 1) % this.items.length;
    if (p.has('confirm')) {
      if (this.sel === 1) { this.showHelp = true; return null; }
      return { start: true, autoplay: false };
    }
    return null;
  }

  draw(R: Renderer): void {
    R.clear('#06030c');
    const art = R.image('inb_title_art');
    if (art) R.ctx.drawImage(art, 0, 0, 640, 480);
    // 标题字（canvas 字体，不依赖生成文字）
    R.ctx.save();
    if (art) { R.ctx.fillStyle = 'rgba(4, 2, 10, 0.45)'; R.ctx.fillRect(0, 0, 640, 480); }
    const logo = R.image('inb_logo_emblem');
    if (logo) {
      R.ctx.save();
      R.ctx.globalCompositeOperation = 'lighter';
      R.ctx.drawImage(logo, 66, 40, 120, 120);
      R.ctx.restore();
    }
    R.text('东方阴蝶梦', 320, 78, { size: 52, color: '#f0d8ff', align: 'center', font: '"MS Gothic", "Yu Gothic", serif' });
    R.text('Requiem of the Night Sparrow', 320, 140, { size: 15, color: '#c8a8e0', align: 'center' });
    R.text('—— 夜雀 × 亡灵公主 · 五段葬送曲 ——', 320, 166, { size: 12, color: '#9078b0', align: 'center' });
    R.ctx.restore();

    if (this.showHelp) {
      R.ctx.save();
      R.ctx.fillStyle = 'rgba(6, 3, 14, 0.92)';
      R.ctx.fillRect(110, 90, 420, 300);
      R.ctx.strokeStyle = '#8060a8';
      R.ctx.strokeRect(110.5, 90.5, 419, 299);
      const lines = [
        'Z / Enter : 射击（按住连发）· 决定',
        '方向键 : 移动',
        'Shift : 低速移动（显示判定点）',
        'X : Bomb（街机式·清屏·对BOSS弱）',
        'C : Hyper 发动（量表满时）',
        'A : FlameTN7代打 ON/OFF（默认关）',
        'R : 立即重开    M : 静音',
        '',
        '擦弹与命中可积攒 HYPER 量表。',
        'Bomb 与 Hyper 互斥；被弹无 deathbomb。',
        'BOSS 为五段式传说级弹幕，人类几乎不可能通关',
        '—— 请多欣赏 FlameTN7 的走位。',
      ];
      lines.forEach((s, i) => R.text(s, 130, 108 + i * 22, { size: 12, color: '#d8c8f0' }));
      R.ctx.restore();
      R.present();
      return;
    }

    this.items.forEach((s, i) => {
      const y = 250 + i * 40;
      const active = i === this.sel;
      if (active) {
        R.ctx.fillStyle = 'rgba(120, 60, 160, 0.4)';
        R.ctx.fillRect(210, y - 4, 220, 30);
        R.text('▶', 222, y, { size: 16, color: '#ffd76a' });
      }
      R.text(s, 320, y, { size: 17, color: active ? '#fff' : '#8878a8', align: 'center', font: 'monospace' });
    });
    const blink = (this.frame >> 4) % 2 === 0;
    if (blink) R.text('同人STG · 素材全部由 gpt-image-2 生成 · 音频程序合成', 320, 430, { size: 11, color: '#685888', align: 'center' });
    R.present();
  }
}
