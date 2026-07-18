import { Renderer } from '../gfx/renderer';

// 新素材清单（全部来自 gpt-image-2 管线，assets/rotns-img/）。
// 新模式一概不引用 assets/th07-img 与 th07-data（PLAN §12 红线 8）。
export const SPRITE_KEYS = [
  'inb_mystia_idle', 'inb_mystia_bank',
  'inb_yuyuko_portrait', 'inb_yuyuko_idle',
  'inb_opt_orb', 'inb_shot_feather', 'inb_shot_wave',
  'inb_needle_pink', 'inb_needle_blue', 'inb_needle_red',
  'inb_ball_s_pink', 'inb_ball_s_blue', 'inb_ball_l_blue',
  'inb_blt_petal', 'inb_blt_butterfly', 'inb_opt_turret',
  'inb_fx_bomb', 'inb_fx_hyper',
  'inb_bg_stage', 'inb_bg_finale', 'inb_hud_panel',
  'inb_title_art', 'inb_logo_emblem', 'inb_warning_banner',
  'inb_icon_bomb', 'inb_icon_life',
] as const;

export type SpriteKey = typeof SPRITE_KEYS[number];

// 程序化占位（素材未生成前游戏即可完整游玩；实图加载后自动替换）。
export function installPlaceholders(renderer: Renderer): void {
  for (const key of SPRITE_KEYS) {
    if (renderer.assets[key]) continue;
    renderer.assets[key] = makePlaceholder(key);
  }
}

function makePlaceholder(key: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const glow = (color: string, r: number, core = true) => {
    const grad = g.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(core ? 0.35 : 0.1, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
  };
  switch (key) {
    case 'inb_needle_pink': case 'inb_needle_blue': case 'inb_needle_red': {
      c.width = 10; c.height = 26;
      const col = key.endsWith('pink') ? '#ff9ad5' : key.endsWith('blue') ? '#7ab8ff' : '#ff5a4a';
      const grad = g.createLinearGradient(0, 0, 0, 26);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath(); g.ellipse(5, 13, 4, 12, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(5, 13, 1.8, 8, 0, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'inb_ball_s_pink': case 'inb_ball_s_blue': {
      c.width = 16; c.height = 16;
      glow(key.endsWith('pink') ? '#ffb0e0' : '#90c8ff', 8);
      break;
    }
    case 'inb_ball_l_blue': {
      c.width = 28; c.height = 28;
      glow('#5a8aff', 14);
      g.strokeStyle = '#cfe4ff';
      g.lineWidth = 2;
      g.beginPath(); g.arc(14, 14, 10, 0, Math.PI * 2); g.stroke();
      break;
    }
    case 'inb_blt_petal': {
      c.width = 22; c.height = 22;
      g.globalAlpha = 0.65;
      glow('#ffc0d8', 11, false);
      g.globalAlpha = 1;
      break;
    }
    case 'inb_blt_butterfly': {
      c.width = 24; c.height = 24;
      g.fillStyle = '#ff9ad5';
      g.beginPath(); g.ellipse(8, 12, 6, 9, -0.4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(16, 12, 6, 9, 0.4, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.fillRect(11, 5, 2, 14);
      break;
    }
    case 'inb_opt_turret': {
      c.width = 28; c.height = 28;
      glow('#8fd8c8', 13);
      g.fillStyle = '#e0fff4';
      g.beginPath(); g.moveTo(14, 4); g.lineTo(22, 20); g.lineTo(6, 20); g.closePath(); g.fill();
      break;
    }
    case 'inb_opt_orb': {
      c.width = 20; c.height = 20;
      glow('#ffd76a', 10);
      break;
    }
    case 'inb_shot_feather': {
      c.width = 16; c.height = 32;
      g.fillStyle = '#ffe9a0';
      g.beginPath(); g.ellipse(8, 16, 4, 14, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(8, 16, 1.5, 10, 0, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'inb_shot_wave': {
      c.width = 14; c.height = 28;
      glow('#a0e9ff', 7);
      g.fillStyle = '#a0e9ff';
      g.fillRect(5, 2, 4, 24);
      break;
    }
    case 'inb_fx_bomb': {
      c.width = 512; c.height = 512;
      g.strokeStyle = '#ffe9a0';
      for (let r = 40; r < 250; r += 42) {
        g.globalAlpha = 0.5 - r / 600;
        g.lineWidth = 10;
        g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'inb_fx_hyper': {
      c.width = 256; c.height = 256;
      g.strokeStyle = '#ffd040';
      for (let r = 30; r < 120; r += 22) {
        g.globalAlpha = 0.7 - r / 220;
        g.lineWidth = 5;
        g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'inb_bg_stage': {
      c.width = 384; c.height = 768;
      const grad = g.createLinearGradient(0, 0, 0, 768);
      grad.addColorStop(0, '#0a0618');
      grad.addColorStop(0.6, '#150c26');
      grad.addColorStop(1, '#1f1032');
      g.fillStyle = grad;
      g.fillRect(0, 0, 384, 768);
      g.fillStyle = 'rgba(120, 90, 180, 0.12)';
      for (let i = 0; i < 40; i++) {
        const x = (i * 97) % 384, y = (i * 211) % 768;
        g.beginPath(); g.arc(x, y, 8 + (i % 5) * 6, 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case 'inb_bg_finale': {
      c.width = 512; c.height = 512;
      g.strokeStyle = 'rgba(200, 120, 160, 0.25)';
      for (let i = 0; i < 24; i++) {
        g.lineWidth = 2 + (i % 3);
        g.beginPath();
        g.arc(256, 256, 20 + i * 10, i * 0.5, i * 0.5 + 4);
        g.stroke();
      }
      break;
    }
    case 'inb_hud_panel': {
      c.width = 224; c.height = 480;
      g.fillStyle = '#0b0714';
      g.fillRect(0, 0, 224, 480);
      g.strokeStyle = '#50386e';
      g.strokeRect(1, 1, 222, 478);
      break;
    }
    case 'inb_title_art': {
      c.width = 640; c.height = 480;
      const grad = g.createLinearGradient(0, 0, 0, 480);
      grad.addColorStop(0, '#1a0e2e');
      grad.addColorStop(1, '#06030c');
      g.fillStyle = grad;
      g.fillRect(0, 0, 640, 480);
      g.fillStyle = '#e8d8ff';
      g.beginPath(); g.arc(480, 120, 60, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(200, 120, 160, 0.3)';
      for (let i = 0; i < 30; i++) {
        g.beginPath(); g.arc((i * 173) % 640, (i * 271) % 480, 3 + (i % 4), 0, Math.PI * 2); g.fill();
      }
      break;
    }
    case 'inb_logo_emblem': {
      c.width = 200; c.height = 200;
      g.strokeStyle = '#d0a830';
      g.lineWidth = 6;
      g.beginPath(); g.arc(100, 100, 80, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#f0d878';
      g.beginPath(); g.ellipse(80, 100, 24, 40, -0.5, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(120, 100, 24, 40, 0.5, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'inb_warning_banner': {
      c.width = 384; c.height = 96;
      g.fillStyle = '#100404';
      g.fillRect(0, 0, 384, 96);
      g.fillStyle = '#e02020';
      g.font = 'bold 56px monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('WARNING', 192, 50);
      break;
    }
    case 'inb_icon_bomb': {
      c.width = 24; c.height = 24;
      glow('#a0e9ff', 12);
      g.fillStyle = '#fff';
      g.font = '14px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('♪', 12, 13);
      break;
    }
    case 'inb_icon_life': {
      c.width = 24; c.height = 24;
      glow('#ffc0d0', 12);
      g.fillStyle = '#804040';
      g.beginPath(); g.ellipse(12, 12, 5, 9, 0.3, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'inb_mystia_idle': case 'inb_mystia_bank': {
      c.width = 56; c.height = 72;
      g.fillStyle = '#ffc0d0';
      g.beginPath(); g.ellipse(28, 36, 14, 20, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#804040';
      g.beginPath(); g.ellipse(28, 24, 10, 10, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c08050';
      g.beginPath(); g.ellipse(10, 36, 8, 18, 0.5, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(46, 36, 8, 18, -0.5, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'inb_yuyuko_portrait': {
      c.width = 300; c.height = 450;
      g.fillStyle = '#181028';
      g.fillRect(0, 0, 300, 450);
      g.fillStyle = '#e8b8ff';
      g.beginPath(); g.ellipse(150, 200, 80, 120, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f0c8d8';
      g.beginPath(); g.arc(150, 120, 50, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'inb_yuyuko_idle': {
      c.width = 96; c.height = 120;
      g.fillStyle = '#e8b8ff';
      g.beginPath(); g.ellipse(48, 60, 26, 40, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f0c8d8';
      g.beginPath(); g.arc(48, 36, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4060a0';
      g.beginPath(); g.arc(48, 26, 16, Math.PI, 0); g.fill();
      break;
    }
    default: {
      c.width = 16; c.height = 16;
      glow('#ff00ff', 8);
    }
  }
  return c;
}

// 实图加载：fetch assets/rotns-img/*.png，成功的键替换占位；404 容忍。
export async function loadAssets(renderer: Renderer): Promise<{ loaded: string[]; missing: string[] }> {
  const loaded: string[] = [];
  const missing: string[] = [];
  await Promise.all(SPRITE_KEYS.map((key) => new Promise<void>((resolve) => {
    const name = key.slice(4); // 去 inb_ 前缀
    const img = new Image();
    img.onload = () => {
      renderer.assets[key] = img;
      loaded.push(key);
      resolve();
    };
    img.onerror = () => {
      missing.push(key);
      resolve();
    };
    img.src = `assets/rotns-img/${name}.png`;
  })));
  return { loaded, missing };
}
