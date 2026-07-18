// 监视器入口：驱动整局，逐帧采样贴图可见性。
import { Renderer, PLAYFIELD } from '../gfx/renderer';
import { RotnsScene, type FrameInput, type InputSource } from './scene';
import { installPlaceholders, loadAssets } from './assets';
import { AiController } from './ai/controller';

function maxBrightness(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): number {
  const x = Math.max(0, Math.round(cx) - r), y = Math.max(0, Math.round(cy) - r);
  const w = Math.min(640 - x, r * 2), h = Math.min(480 - y, r * 2);
  if (w <= 0 || h <= 0) return 0;
  const data = ctx.getImageData(x, y, w, h).data;
  let m = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i] + data[i + 1] + data[i + 2];
    if (v > m) m = v;
  }
  return m;
}

export async function watch(createCanvas: (w: number, h: number) => never, seed: number): Promise<string> {
  const canvas = createCanvas(640, 480);
  const renderer = new Renderer(canvas as never, { desynchronized: false });
  installPlaceholders(renderer);
  await loadAssets(renderer as never);

  const controller = new AiController(7);
  controller.enabled = true;
  let scene!: RotnsScene;
  const source: InputSource = { frame: () => controller.frame(scene.aiView()) };
  scene = new RotnsScene({ input: source, events: null, seed, fx: true });

  const lines: string[] = [];
  const goneByMode = new Map<string, number>();
  const goneLog: string[] = [];
  const THRESH = 60; // RGB 合计亮度阈值（bg 很暗）
  const bump = (key: string) => goneByMode.set(key, (goneByMode.get(key) ?? 0) + 1);

  for (let f = 0; f < 40000 && !scene.done; f++) {
    scene.update();
    scene.draw(renderer as never, true);
    const v = scene.aiView();
    const ctx = (canvas as never as { getContext(s: '2d'): CanvasRenderingContext2D }).getContext('2d');
    const bmode = scene.boss.mode;
    if (bmode === 'intro' || bmode === 'warning') continue; // 设计性黑场

    // —— 自机贴图：alive 时中心区域应有亮色 ——
    if (v.playerAlive) {
      const px = PLAYFIELD.x + v.playerX, py = PLAYFIELD.y + v.playerY;
      const b = maxBrightness(ctx, px, py, 6);
      const flicker = v.invuln > 0;
      if (b < THRESH && !flicker) {
        bump(`PLAYER ${bmode} ${v.phaseId}`);
        if (goneLog.length < 30 && f % 50 === 0) goneLog.push(`f=${v.frame} PLAYER gone b=${b} pos=(${v.playerX.toFixed(0)},${v.playerY.toFixed(0)}) inv=${v.invuln} mode=${bmode} phase=${v.phaseId}`);
      }
      const focus = scene.player.focus;
      if (focus) {
        const d = maxBrightness(ctx, px, py, 3);
        if (d < 200 && !flicker) bump(`DOT ${bmode} ${v.phaseId}`);
      }
    }

    // —— 敌机贴图 ——
    if (bmode === 'combat' || bmode === 'declare' || bmode === 'hpcharge') {
      const bx = PLAYFIELD.x + v.bossX, by = PLAYFIELD.y + v.bossY;
      const b = maxBrightness(ctx, bx, by, 8);
      const b2 = maxBrightness(ctx, bx, by + 14, 6);
      if (Math.max(b, b2) < THRESH) bump(`BOSS ${bmode} ${v.phaseId}`);
    }
  }

  lines.push(`seed=${seed}`);
  for (const [k, n] of [...goneByMode.entries()].sort()) lines.push(`${k}: ${n}`);
  lines.push(...goneLog);
  return lines.join('\n');
}
