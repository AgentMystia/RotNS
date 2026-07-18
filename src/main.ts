import { Loop, type LoopClient } from './core/loop';
import { Input, type Button } from './core/input';
import { Renderer } from './gfx/renderer';
import { installPlaceholders, loadAssets } from './rotns/assets';
import { RotnsScene, type FrameInput, type InputSource } from './rotns/scene';
import { TitleScene } from './rotns/title';
import { AudioSynth } from './rotns/audio-synth';
import { AiController } from './rotns/ai/controller';

// 浏览器输入源：AI 开启时走 AiController（与键盘同路的虚拟手柄），否则透传键盘快照。
class BrowserInputSource implements InputSource {
  private scene: RotnsScene | null = null;
  snapshot: FrameInput = { held: new Set(), pressed: new Set() };

  constructor(
    private readonly ai: AiController,
  ) {}

  attach(scene: RotnsScene): void {
    this.scene = scene;
  }

  frame(): FrameInput {
    if (this.ai.enabled && this.scene) {
      return this.ai.frame(this.scene.aiView());
    }
    return this.snapshot;
  }
}

class GameRoot implements LoopClient {
  private mode: 'title' | 'fight' = 'title';
  private readonly title = new TitleScene();
  private scene: RotnsScene | null = null;
  private paused = false;
  private assetsReady = false;
  private seed = 0x1527;
  private restartCount = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: AudioSynth,
    private readonly source: BrowserInputSource,
    private readonly ai: AiController,
  ) {
    const params = new URLSearchParams(location.search);
    const seedParam = params.get('seed');
    if (seedParam) this.seed = (parseInt(seedParam, 10) & 0xffff) || 0x1527;
    if (params.get('ai') === '1') {
      this.startFight(true);
    }
  }

  startFight(autoplay: boolean): void {
    this.ai.enabled = autoplay;
    const scene = new RotnsScene({
      input: this.source,
      events: this.audio,
      seed: (this.seed + this.restartCount) & 0xffff,
      fx: true,
    });
    scene.aiEnabled = autoplay;
    this.source.attach(scene);
    this.scene = scene;
    this.mode = 'fight';
    this.paused = false;
    this.audio.bgm('boss');
  }

  update(): void {
    const frame = this.input.frame();
    this.source.snapshot = frame;

    if (this.mode === 'title') {
      const choice = this.title.update(frame);
      if (choice?.start) this.startFight(choice.autoplay);
      return;
    }
    const scene = this.scene!;
    scene.aiEnabled = this.ai.enabled;

    if (scene.done) {
      if (frame.pressed.has('confirm')) {
        if (scene.result.mode === 'clear') {
          this.mode = 'title';
          this.scene = null;
          this.audio.bgm(null);
        } else {
          this.restartCount += 1;
          this.startFight(this.ai.enabled);
        }
      }
      return;
    }

    if (frame.pressed.has('pause')) this.paused = !this.paused;
    if (this.paused) return;
    scene.update();
  }

  draw(): void {
    if (this.mode === 'title' || !this.scene) {
      this.title.draw(this.renderer);
      return;
    }
    this.scene.draw(this.renderer, this.assetsReady);
    if (this.paused) {
      this.renderer.ctx.fillStyle = 'rgba(4, 2, 10, 0.6)';
      this.renderer.ctx.fillRect(0, 0, 640, 480);
      this.renderer.text('PAUSED', 320, 220, { size: 28, color: '#d8c8f0', align: 'center', font: 'monospace' });
    }
    this.renderer.present();
  }

  setAssetsReady(): void {
    this.assetsReady = true;
  }

  get fighting(): boolean {
    return this.mode === 'fight';
  }

  restart(): void {
    if (this.mode !== 'fight') return;
    this.restartCount += 1;
    this.startFight(this.ai.enabled);
  }
}

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('canvas#game not found');
  const renderer = new Renderer(canvas);
  installPlaceholders(renderer);

  const input = new Input();
  const audio = new AudioSynth();
  const ai = new AiController(7);
  const source = new BrowserInputSource(ai);
  const root = new GameRoot(renderer, input, audio, source, ai);

  // 首次按键解锁音频（自动播放策略）
  addEventListener('keydown', () => audio.unlock(), { once: false });

  // 场景局部按键（不进 Button）：A=AI 切替 / R=重开 / M=静音
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyA') {
      ai.enabled = !ai.enabled;
      if (!ai.enabled) input.clearInjected();
    } else if (e.code === 'KeyR') {
      root.restart();
    } else if (e.code === 'KeyM') {
      audio.toggleMute();
    }
  });

  loadAssets(renderer).then(({ loaded, missing }) => {
    root.setAssetsReady();
    console.info(`[rotns] assets loaded=${loaded.length} missing=${missing.length}`, missing);
  });

  const loop = new Loop(root, false, true);
  loop.start();
}

boot();
