export const SCREEN_W = 640;
export const SCREEN_H = 480;
// Playfield rectangle inside the 640×480 frame (TH07 layout).
export const PLAYFIELD = { x: 32, y: 16, width: 384, height: 448 } as const;

export interface DrawOptions {
  scaleMultiplier?: number;
  scaleX?: number;
  scaleY?: number;
  offsetX?: number;
  offsetY?: number;
  alpha?: number;
  color?: number;
  rotation?: number;
  blend?: GlobalCompositeOperation;
}

function colorParts(color: number): { r: number; g: number; b: number } {
  return { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff };
}

// Canvas2D renderer distilled from th07_web: sprite/batch draws with tint
// caching, offscreen backbuffer present for low-latency contexts, playfield
// clipping. The ANM runner, 3D quad projection and replay/test hooks of the
// original are intentionally gone — sprites here are plain whole images.
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private readonly displayCtx: CanvasRenderingContext2D;
  private readonly backbuffer: HTMLCanvasElement | null;
  assets: Record<string, HTMLImageElement | HTMLCanvasElement> = {};
  private tintCache = new Map<string, HTMLCanvasElement>();
  private tintCacheOrder: string[] = [];
  private tintImageIds = new WeakMap<HTMLImageElement, number>();
  private tintNextImageId = 1;
  private readonly tintCacheLimit = 384;

  constructor(canvas: HTMLCanvasElement, options: { desynchronized?: boolean } = {}) {
    this.canvas = canvas;
    const requestedDesynchronized = options.desynchronized ?? true;
    const displayCtx = canvas.getContext('2d', {
      desynchronized: requestedDesynchronized,
      alpha: false
    });
    if (!displayCtx) throw new Error('Canvas 2D context unavailable');
    this.displayCtx = displayCtx;
    displayCtx.imageSmoothingEnabled = false;
    const actualDesynchronized = displayCtx.getContextAttributes?.().desynchronized ?? false;
    if (actualDesynchronized) {
      // Chrome's low-latency path may expose the front buffer while drawing;
      // finish frames offscreen and present in one op.
      const backbuffer = document.createElement('canvas');
      backbuffer.width = SCREEN_W;
      backbuffer.height = SCREEN_H;
      const ctx = backbuffer.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Canvas 2D backbuffer unavailable');
      ctx.imageSmoothingEnabled = false;
      this.backbuffer = backbuffer;
      this.ctx = ctx;
    } else {
      this.backbuffer = null;
      this.ctx = displayCtx;
    }
    // A restored 2D context comes back in default state: re-pin smoothing
    // and drop raster caches. (node-canvas 无 addEventListener，视觉验证环境下跳过)
    const restoreRasterState = (): void => {
      displayCtx.imageSmoothingEnabled = false;
      this.ctx.imageSmoothingEnabled = false;
      this.tintCache.clear();
      this.tintCacheOrder.length = 0;
      this.present();
    };
    if (typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('contextrestored', restoreRasterState);
    }
    if (this.backbuffer && typeof this.backbuffer.addEventListener === 'function') {
      this.backbuffer.addEventListener('contextrestored', restoreRasterState);
    }
  }

  present(): void {
    if (!this.backbuffer) return;
    this.displayCtx.drawImage(this.backbuffer, 0, 0);
  }

  clear(color = '#000'): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

  image(key: string): HTMLImageElement | HTMLCanvasElement | null {
    return this.assets[key] ?? null;
  }

  drawImage(key: string, x: number, y: number, w?: number, h?: number): void {
    const img = this.assets[key];
    if (!img) return;
    this.ctx.drawImage(img, x, y, w ?? img.width, h ?? img.height);
  }

  // Draws a sprite rect centered on (x, y).
  drawSprite(imageKey: string, sx: number, sy: number, sw: number, sh: number, x: number, y: number, options: DrawOptions = {}): void {
    const img = this.assets[imageKey];
    if (!img) return;
    const ctx = this.ctx;
    const scaleX = (options.scaleX ?? 1) * (options.scaleMultiplier ?? 1);
    const scaleY = (options.scaleY ?? 1) * (options.scaleMultiplier ?? 1);
    const w = Math.abs(sw * scaleX);
    const h = Math.abs(sh * scaleY);
    ctx.save();
    ctx.globalAlpha = options.alpha ?? 1;
    ctx.globalCompositeOperation = options.blend ?? 'source-over';
    ctx.translate(x + (options.offsetX ?? 0), y + (options.offsetY ?? 0));
    if (options.rotation) ctx.rotate(options.rotation);
    if (scaleX < 0) ctx.scale(-1, 1);
    if (scaleY < 0) ctx.scale(1, -1);
    const color = options.color;
    if (color != null && (color & 0x00ffffff) !== 0x00ffffff) {
      this.tintedSprite(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h, color);
    } else {
      ctx.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }

  // Fast path for many untinted entity sprites. The caller must bracket a
  // batch with one ctx.save()/restore(); mutable state is assigned only on
  // change so adjacent sprites cannot leak state to each other.
  drawSpriteInBatch(
    imageKey: string,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    x: number,
    y: number,
    rotation: number,
    scaleMultiplier: number,
    alpha: number,
    blend: GlobalCompositeOperation,
    color?: number
  ): void {
    const img = this.assets[imageKey];
    if (!img || alpha <= 0) return;
    const ctx = this.ctx;
    if (ctx.globalAlpha !== alpha) ctx.globalAlpha = alpha;
    if (ctx.globalCompositeOperation !== blend) ctx.globalCompositeOperation = blend;
    const w = Math.max(0.001, Math.abs(sw * scaleMultiplier));
    const h = Math.max(0.001, Math.abs(sh * scaleMultiplier));
    const tinted = color != null && (color & 0x00ffffff) !== 0x00ffffff
      ? this.tintedSpriteCanvas(img, sx, sy, sw, sh, color)
      : null;
    if (rotation === 0) {
      ctx.resetTransform();
      if (tinted) ctx.drawImage(tinted, 0, 0, tinted.width, tinted.height, x - w / 2, y - h / 2, w, h);
      else ctx.drawImage(img, sx, sy, sw, sh, x - w / 2, y - h / 2, w, h);
      return;
    }
    ctx.resetTransform();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    if (tinted) {
      ctx.drawImage(tinted, 0, 0, tinted.width, tinted.height, -w / 2, -h / 2, w, h);
      return;
    }
    ctx.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  }

  private tintedSprite(img: HTMLImageElement | HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, color: number): void {
    const cached = this.tintedSpriteCanvas(img, sx, sy, sw, sh, color);
    if (cached) this.ctx.drawImage(cached, 0, 0, cached.width, cached.height, dx, dy, dw, dh);
  }

  private tintedSpriteCanvas(img: HTMLImageElement | HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, color: number): HTMLCanvasElement | null {
    const cacheable = img instanceof HTMLImageElement;
    let key: string | null = null;
    if (cacheable) {
      let imageId = this.tintImageIds.get(img);
      if (!imageId) {
        imageId = this.tintNextImageId++;
        this.tintImageIds.set(img, imageId);
      }
      key = `${imageId}:${sx}:${sy}:${sw}:${sh}:${color >>> 0}`;
      const hit = this.tintCache.get(key);
      if (hit) return hit;
    }
    const width = Math.max(1, Math.ceil(sw));
    const height = Math.max(1, Math.ceil(sh));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const c = colorParts(color);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    if (key) {
      this.tintCache.set(key, canvas);
      this.tintCacheOrder.push(key);
      while (this.tintCacheOrder.length > this.tintCacheLimit) {
        const oldKey = this.tintCacheOrder.shift();
        if (oldKey) this.tintCache.delete(oldKey);
      }
    }
    return canvas;
  }

  text(str: string, x: number, y: number, options: { size?: number; color?: string; align?: CanvasTextAlign; stroke?: boolean; font?: string } = {}): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${options.size ?? 14}px ${options.font ?? '"MS Gothic", "Yu Gothic", monospace'}`;
    ctx.textAlign = options.align ?? 'left';
    ctx.textBaseline = 'top';
    if (options.stroke !== false) {
      ctx.strokeStyle = 'rgba(0, 0, 20, 0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = options.color ?? '#fff';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  clipPlayfield(fn: () => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);
    ctx.clip();
    fn();
    ctx.restore();
  }
}
