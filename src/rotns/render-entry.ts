// 视觉验证入口：用真实 Renderer 渲染标题/战斗/发狂/WARNING 帧。
// draw 路径与浏览器完全一致（同一份 scene.draw/title.draw 代码）。
import { Renderer } from '../gfx/renderer';
import { RotnsScene, type FrameInput, type InputSource } from './scene';
import { TitleScene } from './title';
import { installPlaceholders, loadAssets } from './assets';
import { AiController } from './ai/controller';

const HOLD: FrameInput = { held: new Set(), pressed: new Set() };

// node-canvas 兼容垫片：Renderer 期望 HTMLCanvasElement/HTMLImageElement。
export async function renderFrames(
  mode: string,
  createCanvas: (w: number, h: number) => never,
  _w: number,
  _h: number,
): Promise<[string, never][]> {
  const canvas = createCanvas(640, 480);
  const renderer = new Renderer(canvas as never, { desynchronized: false });
  installPlaceholders(renderer);
  const { loaded, missing } = await loadAssets(renderer as never);
  console.log(`[render] assets loaded=${loaded.length} missing=${missing.length}`);

  const out: [string, never][] = [];

  if (mode === 'title') {
    const title = new TitleScene();
    for (let i = 0; i < 90; i++) title.update({ held: new Set(), pressed: new Set() });
    title.draw(renderer as never);
    out.push(['title', canvas as never]);
    return out;
  }

  // 战斗场景：AI 驱动到指定时刻后抓帧
  const controller = new AiController(7);
  controller.enabled = true;
  let scene!: RotnsScene;
  const source: InputSource = { frame: () => controller.frame(scene.aiView()) };
  scene = new RotnsScene({ input: source, events: null, seed: 5, fx: true });
  scene.aiEnabled = true;

  const targets: Record<string, number> = {
    warning: 40,     // WARNING 演出
    p1: 700,         // P1 弹幕战中
    fight: 1200,     // P1 中段
    declare: 3120,   // 符卡宣言 cut-in（P1→P2 转段附近）
    finale: 0,       // 发狂段（定位到 phase=finale 后 800f）
    clear: -1,       // 快进到通关结算
  };
  const want = targets[mode] ?? 1200;

  if (mode === 'finale') {
    // 快进到发狂段
    let guard = 0;
    while (scene.aiView().phaseId !== 'finale' && !scene.done && guard < 20000) {
      scene.update();
      guard++;
    }
    for (let i = 0; i < 800 && !scene.done; i++) scene.update();
  } else if (mode === 'declare') {
    // 快进至 declare 模式
    let guard = 0;
    while (scene['boss'].mode !== 'declare' && !scene.done && guard < 20000) {
      scene.update();
      guard++;
    }
    for (let i = 0; i < 20 && !scene.done; i++) scene.update();
  } else if (mode === 'clear') {
    let guard = 0;
    while (!scene.done && guard < 40000) {
      scene.update();
      guard++;
    }
    for (let i = 0; i < 150; i++) scene.update();
  } else {
    for (let i = 0; i < want && !scene.done; i++) scene.update();
  }

  scene.draw(renderer as never, true);
  out.push([mode, canvas as never]);
  // 再抓 30f 后一帧（动画参照）
  for (let i = 0; i < 30 && !scene.done; i++) scene.update();
  scene.draw(renderer as never, true);
  out.push([`${mode}-f30`, canvas as never]);
  return out;
}
