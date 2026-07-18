// 抓帧入口：渲染指定帧，裁出自机周边 4x 放大图。
import { Renderer, PLAYFIELD } from '../gfx/renderer';
import { RotnsScene, type InputSource } from './scene';
import { installPlaceholders, loadAssets } from './assets';
import { AiController } from './ai/controller';

export async function capture(createCanvas: (w: number, h: number) => never, frame: number): Promise<Uint8Array> {
  const canvas = createCanvas(640, 480);
  const renderer = new Renderer(canvas as never, { desynchronized: false });
  installPlaceholders(renderer);
  await loadAssets(renderer as never);

  const controller = new AiController(7);
  controller.enabled = true;
  let scene!: RotnsScene;
  const source: InputSource = { frame: () => controller.frame(scene.aiView()) };
  scene = new RotnsScene({ input: source, events: null, seed: 5, fx: true });

  for (let f = 0; f < frame && !scene.done; f++) scene.update();

  // 分步绘制：每步后采样自机中心亮度，定位吃掉贴图的步骤
  const ctx = (canvas as never as { getContext(s: '2d'): CanvasRenderingContext2D }).getContext('2d');
  const v0 = scene.aiView();
  const px0 = PLAYFIELD.x + v0.playerX, py0 = PLAYFIELD.y + v0.playerY;
  const probe = (tag: string): void => {
    const d = ctx.getImageData(Math.round(px0) - 4, Math.round(py0) - 4, 8, 8).data;
    let m = 0;
    for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i] + d[i + 1] + d[i + 2]);
    console.log(`  after ${tag}: player-center brightness=${m}`);
  };
  const s = scene as never as {
    drawBackground(r: never): void; drawBullets(r: never): void; drawPlayerShots(r: never): void;
    drawBoss(r: never): void; drawPlayer(r: never): void; drawParticles(r: never): void; drawBombWave(r: never): void;
  };
  renderer.clear('#050508');
  renderer.clipPlayfield(() => {
    s.drawBackground(renderer as never); probe('background');
    s.drawBullets(renderer as never); probe('bullets');
    s.drawPlayerShots(renderer as never); probe('playerShots');
    s.drawBoss(renderer as never); probe('boss');
    s.drawPlayer(renderer as never); probe('player');
    s.drawParticles(renderer as never); probe('particles');
    s.drawBombWave(renderer as never); probe('bombWave');
  });

  scene.draw(renderer as never, true);

  const v = scene.aiView();
  const px = PLAYFIELD.x + v.playerX, py = PLAYFIELD.y + v.playerY;
  const sx = Math.max(0, Math.round(px) - 48), sy = Math.max(0, Math.round(py) - 48);
  const crop = createCanvas(96, 96);
  const cctx = (crop as never as { getContext(s: '2d'): CanvasRenderingContext2D }).getContext('2d');
  cctx.imageSmoothingEnabled = false;
  cctx.drawImage(canvas as never, sx, sy, 96, 96, 0, 0, 96, 96);
  const big = createCanvas(384, 384);
  const bctx = (big as never as { getContext(s: '2d'): CanvasRenderingContext2D }).getContext('2d');
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(crop as never, 0, 0, 96, 96, 0, 0, 384, 384);
  console.log(`frame=${frame} player=(${v.playerX.toFixed(1)},${v.playerY.toFixed(1)}) focus=${scene.player.focus} bank=${scene.player.bank.toFixed(2)} invuln=${v.invuln} phase=${v.phaseId} hyperActive=${v.hyperActive} bombActive=${scene.bomb.active} alive=${v.playerAlive}`);
  return (big as never as { toBuffer(m: string): Uint8Array }).toBuffer('image/png');
}
