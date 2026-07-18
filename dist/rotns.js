"use strict";
(() => {
  // src/core/pacing.ts
  var STEP_MS = 1e3 / 60;
  var MAX_FRAME_DELTA_MS = 250;
  var CATCHUP_STEPS = 3;
  var SNAP_TOLERANCE_MS = 1;
  function pace(acc, rawDeltaMs, snap = true, drift = 0) {
    let delta = Math.min(MAX_FRAME_DELTA_MS, rawDeltaMs);
    if (snap) {
      const k = Math.round(delta / STEP_MS);
      if (k >= 1 && k <= CATCHUP_STEPS && Math.abs(delta - k * STEP_MS) <= SNAP_TOLERANCE_MS) {
        drift += delta - k * STEP_MS;
        delta = k * STEP_MS;
        if (drift >= STEP_MS) {
          delta += STEP_MS;
          drift -= STEP_MS;
        } else if (drift <= -STEP_MS) {
          delta -= STEP_MS;
          drift += STEP_MS;
        }
      }
    }
    acc += delta;
    let steps = 0;
    while (acc >= STEP_MS && steps < CATCHUP_STEPS) {
      steps++;
      acc -= STEP_MS;
    }
    if (acc > STEP_MS) acc = STEP_MS;
    return { steps, acc, drift };
  }

  // src/core/loop.ts
  var Loop = class _Loop {
    constructor(client, measureCosts = false, snap = true) {
      this.client = client;
      this.measureCosts = measureCosts;
      this.snap = snap;
      this.last = 0;
      this.acc = 0;
      this.drift = 0;
      this.running = false;
      this.updateCostCursor = 0;
      this.updateCostCount = 0;
      this.drawCostCursor = 0;
      this.drawCostCount = 0;
      this.updateCosts = measureCosts ? new Float64Array(_Loop.COST_RING) : null;
      this.drawCosts = measureCosts ? new Float64Array(_Loop.COST_RING) : null;
    }
    static {
      this.COST_RING = 600;
    }
    recordCost(kind, ms) {
      const ring = kind === "update" ? this.updateCosts : this.drawCosts;
      if (!ring) return;
      if (kind === "update") {
        ring[this.updateCostCursor] = ms;
        this.updateCostCursor = (this.updateCostCursor + 1) % ring.length;
        this.updateCostCount = Math.min(ring.length, this.updateCostCount + 1);
      } else {
        ring[this.drawCostCursor] = ms;
        this.drawCostCursor = (this.drawCostCursor + 1) % ring.length;
        this.drawCostCount = Math.min(ring.length, this.drawCostCount + 1);
      }
    }
    readCosts(ring, cursor, count) {
      if (!ring || count === 0) return [];
      const out = new Array(count);
      const start = count === ring.length ? cursor : 0;
      for (let i = 0; i < count; i++) out[i] = ring[(start + i) % ring.length];
      return out;
    }
    timedUpdate() {
      if (!this.measureCosts) {
        this.client.update();
        return;
      }
      const t0 = performance.now();
      this.client.update();
      this.recordCost("update", performance.now() - t0);
    }
    timedDraw() {
      if (!this.measureCosts) {
        this.client.draw();
        return;
      }
      const t0 = performance.now();
      this.client.draw();
      this.recordCost("draw", performance.now() - t0);
    }
    frameCosts() {
      return {
        update: this.readCosts(this.updateCosts, this.updateCostCursor, this.updateCostCount),
        draw: this.readCosts(this.drawCosts, this.drawCostCursor, this.drawCostCount)
      };
    }
    start() {
      if (this.running) return;
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.tick(t));
    }
    // Test tooling can stop the real rAF driver before using advance(), making
    // frame-exact probes immune to an incidental browser tick between calls.
    stop() {
      this.running = false;
    }
    tick(now) {
      if (!this.running) return;
      const paced = pace(this.acc, now - this.last, this.snap, this.drift);
      this.last = now;
      this.acc = paced.acc;
      this.drift = paced.drift;
      for (let i = 0; i < paced.steps; i++) this.timedUpdate();
      if (paced.steps > 0) this.timedDraw();
      requestAnimationFrame((t) => this.tick(t));
    }
    // Test hook: run n synchronous update steps (and one draw).
    advance(n) {
      for (let i = 0; i < n; i++) this.timedUpdate();
      this.timedDraw();
    }
  };

  // src/core/input.ts
  var KEY_MAP = /* @__PURE__ */ new Map([
    ["ArrowUp", ["up"]],
    ["ArrowDown", ["down"]],
    ["ArrowLeft", ["left"]],
    ["ArrowRight", ["right"]],
    ["KeyZ", ["shoot", "confirm"]],
    ["Enter", ["shoot", "confirm"]],
    ["KeyX", ["bomb", "back"]],
    ["KeyC", ["hyper"]],
    ["ShiftLeft", ["focus"]],
    ["ShiftRight", ["focus"]],
    ["Escape", ["pause", "back"]]
  ]);
  var Input = class {
    constructor() {
      this.held = /* @__PURE__ */ new Set();
      this.codes = /* @__PURE__ */ new Set();
      this.downEdges = /* @__PURE__ */ new Set();
      // Reused snapshots keep the 60 Hz input hot path allocation-free. Every
      // consumer reads InputFrame synchronously during the same update tick.
      this.frameHeld = /* @__PURE__ */ new Set();
      this.framePressed = /* @__PURE__ */ new Set();
      this.frameState = { held: this.frameHeld, pressed: this.framePressed };
      addEventListener("keydown", (e) => this.down(e), { passive: false });
      addEventListener("keyup", (e) => this.up(e), { passive: false });
      addEventListener("blur", () => {
        this.held.clear();
        this.codes.clear();
        this.downEdges.clear();
      });
    }
    down(event) {
      const buttons = KEY_MAP.get(event.code);
      if (!buttons) return;
      event.preventDefault();
      this.codes.add(event.code);
      for (const button of buttons) {
        if (!event.repeat && !this.held.has(button)) this.downEdges.add(button);
        this.held.add(button);
      }
    }
    up(event) {
      const buttons = KEY_MAP.get(event.code);
      if (!buttons) return;
      event.preventDefault();
      this.codes.delete(event.code);
      this.held.clear();
      for (const code of this.codes) {
        for (const button of KEY_MAP.get(code) ?? []) this.held.add(button);
      }
    }
    // AI hook: injects synthetic state for one frame.
    inject(held, pressed) {
      for (const b of pressed) this.downEdges.add(b);
      for (const b of held) this.held.add(b);
    }
    clearInjected() {
      this.held.clear();
      this.codes.clear();
    }
    frame() {
      this.frameHeld.clear();
      for (const button of this.held) this.frameHeld.add(button);
      this.framePressed.clear();
      for (const button of this.downEdges) this.framePressed.add(button);
      this.downEdges.clear();
      return this.frameState;
    }
  };

  // src/gfx/renderer.ts
  var SCREEN_W = 640;
  var SCREEN_H = 480;
  var PLAYFIELD = { x: 32, y: 16, width: 384, height: 448 };
  function colorParts(color) {
    return { r: color >> 16 & 255, g: color >> 8 & 255, b: color & 255 };
  }
  var Renderer = class {
    constructor(canvas, options = {}) {
      this.assets = {};
      this.tintCache = /* @__PURE__ */ new Map();
      this.tintCacheOrder = [];
      this.tintImageIds = /* @__PURE__ */ new WeakMap();
      this.tintNextImageId = 1;
      this.tintCacheLimit = 384;
      this.canvas = canvas;
      const requestedDesynchronized = options.desynchronized ?? true;
      const displayCtx = canvas.getContext("2d", {
        desynchronized: requestedDesynchronized,
        alpha: false
      });
      if (!displayCtx) throw new Error("Canvas 2D context unavailable");
      this.displayCtx = displayCtx;
      displayCtx.imageSmoothingEnabled = false;
      const actualDesynchronized = displayCtx.getContextAttributes?.().desynchronized ?? false;
      if (actualDesynchronized) {
        const backbuffer = document.createElement("canvas");
        backbuffer.width = SCREEN_W;
        backbuffer.height = SCREEN_H;
        const ctx = backbuffer.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("Canvas 2D backbuffer unavailable");
        ctx.imageSmoothingEnabled = false;
        this.backbuffer = backbuffer;
        this.ctx = ctx;
      } else {
        this.backbuffer = null;
        this.ctx = displayCtx;
      }
      const restoreRasterState = () => {
        displayCtx.imageSmoothingEnabled = false;
        this.ctx.imageSmoothingEnabled = false;
        this.tintCache.clear();
        this.tintCacheOrder.length = 0;
        this.present();
      };
      if (typeof canvas.addEventListener === "function") {
        canvas.addEventListener("contextrestored", restoreRasterState);
      }
      if (this.backbuffer && typeof this.backbuffer.addEventListener === "function") {
        this.backbuffer.addEventListener("contextrestored", restoreRasterState);
      }
    }
    present() {
      if (!this.backbuffer) return;
      this.displayCtx.drawImage(this.backbuffer, 0, 0);
    }
    clear(color = "#000") {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    }
    image(key) {
      return this.assets[key] ?? null;
    }
    drawImage(key, x, y, w, h) {
      const img = this.assets[key];
      if (!img) return;
      this.ctx.drawImage(img, x, y, w ?? img.width, h ?? img.height);
    }
    // Draws a sprite rect centered on (x, y).
    drawSprite(imageKey, sx, sy, sw, sh, x, y, options = {}) {
      const img = this.assets[imageKey];
      if (!img) return;
      const ctx = this.ctx;
      const scaleX = (options.scaleX ?? 1) * (options.scaleMultiplier ?? 1);
      const scaleY = (options.scaleY ?? 1) * (options.scaleMultiplier ?? 1);
      const w = Math.abs(sw * scaleX);
      const h = Math.abs(sh * scaleY);
      ctx.save();
      ctx.globalAlpha = options.alpha ?? 1;
      ctx.globalCompositeOperation = options.blend ?? "source-over";
      ctx.translate(x + (options.offsetX ?? 0), y + (options.offsetY ?? 0));
      if (options.rotation) ctx.rotate(options.rotation);
      if (scaleX < 0) ctx.scale(-1, 1);
      if (scaleY < 0) ctx.scale(1, -1);
      const color = options.color;
      if (color != null && (color & 16777215) !== 16777215) {
        this.tintedSprite(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h, color);
      } else {
        ctx.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }
    // Fast path for many untinted entity sprites. The caller must bracket a
    // batch with one ctx.save()/restore(); mutable state is assigned only on
    // change so adjacent sprites cannot leak state to each other.
    drawSpriteInBatch(imageKey, sx, sy, sw, sh, x, y, rotation, scaleMultiplier, alpha, blend, color) {
      const img = this.assets[imageKey];
      if (!img || alpha <= 0) return;
      const ctx = this.ctx;
      if (ctx.globalAlpha !== alpha) ctx.globalAlpha = alpha;
      if (ctx.globalCompositeOperation !== blend) ctx.globalCompositeOperation = blend;
      const w = Math.max(1e-3, Math.abs(sw * scaleMultiplier));
      const h = Math.max(1e-3, Math.abs(sh * scaleMultiplier));
      const tinted = color != null && (color & 16777215) !== 16777215 ? this.tintedSpriteCanvas(img, sx, sy, sw, sh, color) : null;
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
    tintedSprite(img, sx, sy, sw, sh, dx, dy, dw, dh, color) {
      const cached = this.tintedSpriteCanvas(img, sx, sy, sw, sh, color);
      if (cached) this.ctx.drawImage(cached, 0, 0, cached.width, cached.height, dx, dy, dw, dh);
    }
    tintedSpriteCanvas(img, sx, sy, sw, sh, color) {
      const cacheable = img instanceof HTMLImageElement;
      let key = null;
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
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const c = colorParts(color);
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
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
    text(str, x, y, options = {}) {
      const ctx = this.ctx;
      ctx.save();
      ctx.font = `${options.size ?? 14}px ${options.font ?? '"MS Gothic", "Yu Gothic", monospace'}`;
      ctx.textAlign = options.align ?? "left";
      ctx.textBaseline = "top";
      if (options.stroke !== false) {
        ctx.strokeStyle = "rgba(0, 0, 20, 0.9)";
        ctx.lineWidth = 3;
        ctx.strokeText(str, x, y);
      }
      ctx.fillStyle = options.color ?? "#fff";
      ctx.fillText(str, x, y);
      ctx.restore();
    }
    clipPlayfield(fn) {
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.rect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);
      ctx.clip();
      fn();
      ctx.restore();
    }
  };

  // src/rotns/assets.ts
  var SPRITE_KEYS = [
    "inb_mystia_idle",
    "inb_mystia_bank",
    "inb_yuyuko_portrait",
    "inb_yuyuko_idle",
    "inb_opt_orb",
    "inb_shot_feather",
    "inb_shot_wave",
    "inb_needle_pink",
    "inb_needle_blue",
    "inb_needle_red",
    "inb_ball_s_pink",
    "inb_ball_s_blue",
    "inb_ball_l_blue",
    "inb_blt_petal",
    "inb_blt_butterfly",
    "inb_opt_turret",
    "inb_fx_bomb",
    "inb_fx_hyper",
    "inb_bg_stage",
    "inb_bg_finale",
    "inb_hud_panel",
    "inb_title_art",
    "inb_logo_emblem",
    "inb_warning_banner",
    "inb_icon_bomb",
    "inb_icon_life"
  ];
  function installPlaceholders(renderer) {
    for (const key of SPRITE_KEYS) {
      if (renderer.assets[key]) continue;
      renderer.assets[key] = makePlaceholder(key);
    }
  }
  function makePlaceholder(key) {
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    const glow = (color, r, core = true) => {
      const grad = g.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, r);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(core ? 0.35 : 0.1, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
    };
    switch (key) {
      case "inb_needle_pink":
      case "inb_needle_blue":
      case "inb_needle_red": {
        c.width = 10;
        c.height = 26;
        const col = key.endsWith("pink") ? "#ff9ad5" : key.endsWith("blue") ? "#7ab8ff" : "#ff5a4a";
        const grad = g.createLinearGradient(0, 0, 0, 26);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.5, col);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(5, 13, 4, 12, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#fff";
        g.beginPath();
        g.ellipse(5, 13, 1.8, 8, 0, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "inb_ball_s_pink":
      case "inb_ball_s_blue": {
        c.width = 16;
        c.height = 16;
        glow(key.endsWith("pink") ? "#ffb0e0" : "#90c8ff", 8);
        break;
      }
      case "inb_ball_l_blue": {
        c.width = 28;
        c.height = 28;
        glow("#5a8aff", 14);
        g.strokeStyle = "#cfe4ff";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(14, 14, 10, 0, Math.PI * 2);
        g.stroke();
        break;
      }
      case "inb_blt_petal": {
        c.width = 22;
        c.height = 22;
        g.globalAlpha = 0.65;
        glow("#ffc0d8", 11, false);
        g.globalAlpha = 1;
        break;
      }
      case "inb_blt_butterfly": {
        c.width = 24;
        c.height = 24;
        g.fillStyle = "#ff9ad5";
        g.beginPath();
        g.ellipse(8, 12, 6, 9, -0.4, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.ellipse(16, 12, 6, 9, 0.4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#fff";
        g.fillRect(11, 5, 2, 14);
        break;
      }
      case "inb_opt_turret": {
        c.width = 28;
        c.height = 28;
        glow("#8fd8c8", 13);
        g.fillStyle = "#e0fff4";
        g.beginPath();
        g.moveTo(14, 4);
        g.lineTo(22, 20);
        g.lineTo(6, 20);
        g.closePath();
        g.fill();
        break;
      }
      case "inb_opt_orb": {
        c.width = 20;
        c.height = 20;
        glow("#ffd76a", 10);
        break;
      }
      case "inb_shot_feather": {
        c.width = 16;
        c.height = 32;
        g.fillStyle = "#ffe9a0";
        g.beginPath();
        g.ellipse(8, 16, 4, 14, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#fff";
        g.beginPath();
        g.ellipse(8, 16, 1.5, 10, 0, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "inb_shot_wave": {
        c.width = 14;
        c.height = 28;
        glow("#a0e9ff", 7);
        g.fillStyle = "#a0e9ff";
        g.fillRect(5, 2, 4, 24);
        break;
      }
      case "inb_fx_bomb": {
        c.width = 512;
        c.height = 512;
        g.strokeStyle = "#ffe9a0";
        for (let r = 40; r < 250; r += 42) {
          g.globalAlpha = 0.5 - r / 600;
          g.lineWidth = 10;
          g.beginPath();
          g.arc(256, 256, r, 0, Math.PI * 2);
          g.stroke();
        }
        g.globalAlpha = 1;
        break;
      }
      case "inb_fx_hyper": {
        c.width = 256;
        c.height = 256;
        g.strokeStyle = "#ffd040";
        for (let r = 30; r < 120; r += 22) {
          g.globalAlpha = 0.7 - r / 220;
          g.lineWidth = 5;
          g.beginPath();
          g.arc(128, 128, r, 0, Math.PI * 2);
          g.stroke();
        }
        g.globalAlpha = 1;
        break;
      }
      case "inb_bg_stage": {
        c.width = 384;
        c.height = 768;
        const grad = g.createLinearGradient(0, 0, 0, 768);
        grad.addColorStop(0, "#0a0618");
        grad.addColorStop(0.6, "#150c26");
        grad.addColorStop(1, "#1f1032");
        g.fillStyle = grad;
        g.fillRect(0, 0, 384, 768);
        g.fillStyle = "rgba(120, 90, 180, 0.12)";
        for (let i = 0; i < 40; i++) {
          const x = i * 97 % 384, y = i * 211 % 768;
          g.beginPath();
          g.arc(x, y, 8 + i % 5 * 6, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case "inb_bg_finale": {
        c.width = 512;
        c.height = 512;
        g.strokeStyle = "rgba(200, 120, 160, 0.25)";
        for (let i = 0; i < 24; i++) {
          g.lineWidth = 2 + i % 3;
          g.beginPath();
          g.arc(256, 256, 20 + i * 10, i * 0.5, i * 0.5 + 4);
          g.stroke();
        }
        break;
      }
      case "inb_hud_panel": {
        c.width = 224;
        c.height = 480;
        g.fillStyle = "#0b0714";
        g.fillRect(0, 0, 224, 480);
        g.strokeStyle = "#50386e";
        g.strokeRect(1, 1, 222, 478);
        break;
      }
      case "inb_title_art": {
        c.width = 640;
        c.height = 480;
        const grad = g.createLinearGradient(0, 0, 0, 480);
        grad.addColorStop(0, "#1a0e2e");
        grad.addColorStop(1, "#06030c");
        g.fillStyle = grad;
        g.fillRect(0, 0, 640, 480);
        g.fillStyle = "#e8d8ff";
        g.beginPath();
        g.arc(480, 120, 60, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(200, 120, 160, 0.3)";
        for (let i = 0; i < 30; i++) {
          g.beginPath();
          g.arc(i * 173 % 640, i * 271 % 480, 3 + i % 4, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case "inb_logo_emblem": {
        c.width = 200;
        c.height = 200;
        g.strokeStyle = "#d0a830";
        g.lineWidth = 6;
        g.beginPath();
        g.arc(100, 100, 80, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = "#f0d878";
        g.beginPath();
        g.ellipse(80, 100, 24, 40, -0.5, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.ellipse(120, 100, 24, 40, 0.5, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "inb_warning_banner": {
        c.width = 384;
        c.height = 96;
        g.fillStyle = "#100404";
        g.fillRect(0, 0, 384, 96);
        g.fillStyle = "#e02020";
        g.font = "bold 56px monospace";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("WARNING", 192, 50);
        break;
      }
      case "inb_icon_bomb": {
        c.width = 24;
        c.height = 24;
        glow("#a0e9ff", 12);
        g.fillStyle = "#fff";
        g.font = "14px monospace";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("\u266A", 12, 13);
        break;
      }
      case "inb_icon_life": {
        c.width = 24;
        c.height = 24;
        glow("#ffc0d0", 12);
        g.fillStyle = "#804040";
        g.beginPath();
        g.ellipse(12, 12, 5, 9, 0.3, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "inb_mystia_idle":
      case "inb_mystia_bank": {
        c.width = 56;
        c.height = 72;
        g.fillStyle = "#ffc0d0";
        g.beginPath();
        g.ellipse(28, 36, 14, 20, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#804040";
        g.beginPath();
        g.ellipse(28, 24, 10, 10, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#c08050";
        g.beginPath();
        g.ellipse(10, 36, 8, 18, 0.5, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.ellipse(46, 36, 8, 18, -0.5, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "inb_yuyuko_portrait": {
        c.width = 300;
        c.height = 450;
        g.fillStyle = "#181028";
        g.fillRect(0, 0, 300, 450);
        g.fillStyle = "#e8b8ff";
        g.beginPath();
        g.ellipse(150, 200, 80, 120, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#f0c8d8";
        g.beginPath();
        g.arc(150, 120, 50, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case "inb_yuyuko_idle": {
        c.width = 96;
        c.height = 120;
        g.fillStyle = "#e8b8ff";
        g.beginPath();
        g.ellipse(48, 60, 26, 40, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#f0c8d8";
        g.beginPath();
        g.arc(48, 36, 18, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#4060a0";
        g.beginPath();
        g.arc(48, 26, 16, Math.PI, 0);
        g.fill();
        break;
      }
      default: {
        c.width = 16;
        c.height = 16;
        glow("#ff00ff", 8);
      }
    }
    return c;
  }
  async function loadAssets(renderer) {
    const loaded = [];
    const missing = [];
    await Promise.all(SPRITE_KEYS.map((key) => new Promise((resolve) => {
      const name = key.slice(4);
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

  // src/rotns/config.ts
  var CFG = {
    playfield: { w: 384, h: 448, minX: 8, maxX: 376, minY: 16, maxY: 432 },
    player: {
      spawnX: 192,
      spawnY: 400,
      speedFast: 4.5,
      speedSlow: 2,
      diagScale: 0.7071,
      hitboxR: 2,
      grazePad: 20,
      // graze 盒 = 弹判定 + 20
      lives: 3,
      respawnDelay: 60,
      // 被弹爆散后多少帧原地复活
      respawnInvuln: 240,
      hitstop: 8,
      // 被弹全局静止帧
      // 主射：双列羽弹
      mainShot: { interval: 3, dmg: 8, speed: 12, offsetX: 6, sprite: "shot" },
      // 高速 4 子机：瞄准 Boss 的音波弹扇（扇心=Boss 方位，窄散布保证中距命中；
      // 视觉仍为四列扇形。±0.05/±0.11 rad：300px 处内两束必中、外两束近失）
      optFast: {
        interval: 6,
        dmg: 5,
        speed: 10,
        offsets: [[-36, 4], [-20, -8], [20, -8], [36, 4]],
        angles: [-0.11, -0.05, 0.05, 0.11]
      },
      // 低速 4 子机：收拢平行前射（点烧）
      optSlow: {
        interval: 4,
        dmg: 6,
        speed: 12,
        offsets: [[-22, -2], [-10, -4], [10, -4], [22, -2]]
      },
      shotPoolCap: 96,
      shotLife: 60
      // 弹顶出屏余量
    },
    hyper: {
      max: 1e4,
      gainGraze: 100,
      gainHitPerFrame: 20,
      // 自机弹每命中帧（蓄力循环；§6.6 授权迭代 +10% 档）
      gainPhaseClear: 2500,
      duration: 720,
      // 12s，量表匀速流干
      invulnOnCast: 60,
      firepowerMul: 2.5,
      spreadMul: 1.5,
      // 子机散布角 +50%
      shakeFrames: 6
    },
    bomb: {
      stock: 3,
      cap: 3,
      expandFrames: 24,
      radiusMax: 460,
      invuln: 180,
      bossDamageRaw: 3e3,
      bossResist: 0.1,
      // → 300，蜂系 Bomb 无效化再现
      lockFrames: 180,
      // 期间不可再 Bomb
      starScore: 100
    },
    score: {
      graze: 500,
      hyperStar: 1e3,
      phaseClearBase: 5e6,
      // ×剩余残机系数
      allClearBonus: 1e8
    },
    boss: {
      cx: 192,
      cy: 112,
      driftXAmp: 16,
      driftXPeriod: 240,
      driftYAmp: 8,
      driftYPeriod: 300,
      totalHp: 142e3,
      contactHitbox: 24,
      introBlackFrames: 30,
      warningFrames: 90,
      hpChargeFrames: 60,
      spellDeclareFrames: 90,
      // 转段符卡宣言演出 1.5s
      rankOmegaScale: 0
      // 预留：Rank→发狂Ω增幅（默认 0 = 不做 Rank）
    },
    phases: [
      { id: "p1", name: "\u8776\u7B26\u300C\u4EA1\u6211\u6D41\u30FB\u56DE\u65CB\u9488\u96E8\u300D", hp: 2e4, timeLimit: 45 * 60 },
      { id: "p2", name: "\u6A31\u7B26\u300C\u6563\u534E\u30FB\u88C2\u53D8\u58A8\u67D3\u300D", hp: 2e4, timeLimit: 45 * 60 },
      { id: "p3", name: "\u6B7B\u7B26\u300C\u5E7D\u660E\u91CD\u570F\u300D", hp: 2e4, timeLimit: 45 * 60 },
      { id: "p4", name: "\u6B7B\u8776\u300C\u7EC8\u7109\u52A0\u901F\u300D", hp: 16e3, timeLimit: 40 * 60 },
      { id: "finale", name: "\u53CD\u9B42\u300C\u58A8\u67D3\u306E\u6D17\u6FEF\u6A5F \u301C \u846C\u9001\u4E8C\u91CD\u594F\u300D", hp: 66e3, timeLimit: 0 }
      // 无时限
    ],
    // —— P1 旋转针弹涡 ——
    p1: {
      emitterA: { interval: 3, ways: 6, dTheta: 0.11, speedLo: 3.4, speedHi: 4.6, waveFrames: 300 },
      emitterB: { interval: 3, ways: 6, dTheta: -0.13, speed: 4 },
      ring: { interval: 45, ways: 32, speed: 2.8 }
    },
    // —— P2 裂变弹 ——
    p2: {
      mother: { interval: 20, ways: 8, aimArcDeg: 30, speed: 2.2, fuse: 40 },
      split: { count: 14, speed: 3, momentum: 0.3, butterflyRatio: 0.25 },
      press: { interval: 6, ways: 3, speed: 5 }
    },
    // —— P3 密环+自机狙 ——
    p3: {
      ring: { interval: 30, ways: 48, speed: 2, jitterDeg: 0.5, dBaseDeg: 3.75 },
      aim: { interval: 10, ways: 5, speed: 4.2, fanDeg: 24 }
    },
    // —— P4 加速环 ——
    p4: {
      ways: 40,
      intervalStart: 26,
      intervalEnd: 12,
      rampFrames: 20 * 60,
      speed0: 1.6,
      accel: 0.02,
      speedMax: 5.2,
      baseJitterDeg: 7,
      hyperHintInterval: 14
      // 低于此值进入设计上的 Hyper 脱出窗口
    },
    // —— 发狂 洗衣机 ——
    finale: {
      options: {
        count: 6,
        radius: 56,
        omega: 0.034,
        interval: 4,
        speedFast: 6,
        speedSlow: 3.4
      },
      redRing: { interval: 30, ways: 16, speed: 4, dBase: 0.12 },
      fugu: { interval: 90, fans: 3, petalsPerFan: 24, speed: 2.4, fanDeg: 60 },
      gamble: { everyVolleys: 32, wFlip: 3, wJump: 3, wNone: 4, phaseJump: 0.35 }
    },
    bullets: {
      cap: 2400,
      cullMargin: 40,
      // sprite 表：判定半径/贴图 key/混合（索引即 pool.sprite 的值）
      sprites: [
        { key: "needle_pink", w: 10, h: 26, hitbox: 3, blend: "lighter" },
        { key: "needle_blue", w: 10, h: 26, hitbox: 3, blend: "lighter" },
        { key: "needle_red", w: 10, h: 26, hitbox: 3, blend: "lighter" },
        { key: "ball_s_pink", w: 16, h: 16, hitbox: 4, blend: "lighter" },
        { key: "ball_s_blue", w: 16, h: 16, hitbox: 4, blend: "lighter" },
        { key: "ball_l_blue", w: 28, h: 28, hitbox: 8, blend: "lighter" },
        { key: "blt_petal", w: 22, h: 22, hitbox: 5, blend: "lighter", alpha: 0.65 },
        { key: "blt_butterfly", w: 24, h: 24, hitbox: 3, blend: "lighter" }
      ]
    },
    ai: {
      horizon: 42,
      replanEvery: 2,
      branchAt: 12,
      hysteresisMargin: 4,
      anchorBandY: [392, 420],
      anchorBossXPad: 40,
      weightAnchor: 1,
      weightFlip: 0.5,
      weightGraze: 0.35,
      weightHint: 0.8,
      safeMarginBase: 20,
      // 此帧后碰撞半径逐帧 +0.1
      safeMarginRate: 0.1,
      graceGrazeSlack: 12,
      // 安全冗余>12f 时奖励近距擦弹
      panicThreshold: 10,
      // 全候选 t_hit < 10f → 资源决策
      delayBuffer: 3,
      // humanizer 反应延迟（帧）
      bypassBelow: 8,
      // t_hit<8f 旁路延迟
      stickFrames: 4,
      // 方向变更最小间隔
      breatheAmp: 3,
      // 安全时呼吸摆动幅度
      breatheSlack: 30,
      noiseSigma: 0.7,
      gambleGapPx: 18,
      // 发狂缝隙阈值 → Hyper
      gambleLookahead: 90,
      bombPanicCooldown: 240,
      bombHumanDelay: 2,
      p4BulletCountHint: 120,
      // interval<14 且屏弹>此值 → Hyper 脱出窗口
      reachPad: 120,
      // 可达域剪枝余量
      perfBudgetMs: 6
    }
  };

  // src/core/rng.ts
  var Rng = class {
    constructor(seed = 5415) {
      this.seed = seed & 65535;
    }
    u16() {
      const a = (this.seed ^ 38448) - 25939 & 65535;
      this.seed = (((a & 49152) >> 14) + a * 4 & 65535) >>> 0;
      return this.seed;
    }
    u32() {
      return (this.u16() << 16 | this.u16()) >>> 0;
    }
    u16InRange(range) {
      return range ? this.u16() % range : 0;
    }
    u32InRange(range) {
      return range ? this.u32() % range : 0;
    }
    f() {
      return this.u32() / 4294967296;
    }
    range(v) {
      return this.f() * v;
    }
  };

  // src/core/util.ts
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  // src/rotns/bullets.ts
  var SPLIT_TABLE = [
    null,
    { count: CFG.p2.split.count, speed: CFG.p2.split.speed, momentum: CFG.p2.split.momentum, butterflyRatio: CFG.p2.split.butterflyRatio }
  ];
  var SPRITE = {
    NEEDLE_PINK: 0,
    NEEDLE_BLUE: 1,
    NEEDLE_RED: 2,
    BALL_S_PINK: 3,
    BALL_S_BLUE: 4,
    BALL_L_BLUE: 5,
    PETAL: 6,
    BUTTERFLY: 7
  };
  function createPool(cap = CFG.bullets.cap) {
    return {
      n: 0,
      cap,
      x: new Float32Array(cap),
      y: new Float32Array(cap),
      vx: new Float32Array(cap),
      vy: new Float32Array(cap),
      accel: new Float32Array(cap),
      vmax: new Float32Array(cap),
      fuse: new Int16Array(cap),
      splitKind: new Uint8Array(cap),
      sprite: new Uint8Array(cap),
      grazed: new Uint8Array(cap),
      age: new Int16Array(cap)
    };
  }
  function spawnBullet(pool, spec) {
    if (pool.n >= pool.cap) return;
    const i = pool.n++;
    pool.x[i] = spec.x;
    pool.y[i] = spec.y;
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
  var splitQ = [];
  function stepBullet(pool, i) {
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
        pool.vx[i] = vx * k;
        pool.vy[i] = vy * k;
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
  function swapRemove(pool, i) {
    const j = --pool.n;
    if (i === j) return;
    pool.x[i] = pool.x[j];
    pool.y[i] = pool.y[j];
    pool.vx[i] = pool.vx[j];
    pool.vy[i] = pool.vy[j];
    pool.accel[i] = pool.accel[j];
    pool.vmax[i] = pool.vmax[j];
    pool.fuse[i] = pool.fuse[j];
    pool.splitKind[i] = pool.splitKind[j];
    pool.sprite[i] = pool.sprite[j];
    pool.grazed[i] = pool.grazed[j];
    pool.age[i] = pool.age[j];
  }
  function drainSplits(pool, rng) {
    for (let e = 0; e < splitQ.length; e++) {
      const ev = splitQ[e];
      const spec = SPLIT_TABLE[ev.kind];
      if (!spec) continue;
      const base = rng.f() * Math.PI * 2;
      for (let k = 0; k < spec.count; k++) {
        const ang = base + k / spec.count * Math.PI * 2;
        const cx = Math.cos(ang) * spec.speed + ev.vx * spec.momentum;
        const cy = Math.sin(ang) * spec.speed + ev.vy * spec.momentum;
        const butterfly = rng.f() < spec.butterflyRatio;
        if (pool.n >= pool.cap) break;
        const i = pool.n++;
        pool.x[i] = ev.x;
        pool.y[i] = ev.y;
        pool.vx[i] = cx;
        pool.vy[i] = cy;
        pool.accel[i] = 0;
        pool.vmax[i] = 0;
        pool.fuse[i] = -1;
        pool.splitKind[i] = 0;
        pool.sprite[i] = butterfly ? SPRITE.BUTTERFLY : SPRITE.NEEDLE_PINK;
        pool.grazed[i] = 0;
        pool.age[i] = 0;
      }
    }
    splitQ.length = 0;
  }
  function stepBullets(pool, rng) {
    let i = 0;
    while (i < pool.n) {
      if (stepBullet(pool, i)) i++;
      else swapRemove(pool, i);
    }
    drainSplits(pool, rng);
  }
  function clonePoolInto(dst, src, cx, cy, reach) {
    dst.n = 0;
    const r2 = reach * reach;
    for (let i = 0; i < src.n; i++) {
      const dx = src.x[i] - cx, dy = src.y[i] - cy;
      if (dx * dx + dy * dy > r2) continue;
      const j = dst.n++;
      dst.x[j] = src.x[i];
      dst.y[j] = src.y[i];
      dst.vx[j] = src.vx[i];
      dst.vy[j] = src.vy[i];
      dst.accel[j] = src.accel[i];
      dst.vmax[j] = src.vmax[i];
      dst.fuse[j] = src.fuse[i];
      dst.splitKind[j] = src.splitKind[i];
      dst.sprite[j] = src.sprite[i];
      dst.grazed[j] = src.grazed[i];
      dst.age[j] = src.age[i];
    }
  }
  function clearPool(pool) {
    pool.n = 0;
  }
  function bulletVsPlayer(pool, i, px, py, playerR, grazePad) {
    const hb = CFG.bullets.sprites[pool.sprite[i]].hitbox;
    const dx = pool.x[i] - px, dy = pool.y[i] - py;
    const d2 = dx * dx + dy * dy;
    const rHit = hb + playerR;
    if (d2 <= rHit * rHit) return 2;
    if (pool.grazed[i] === 0) {
      const rG = hb + grazePad;
      if (d2 <= rG * rG) {
        pool.grazed[i] = 1;
        return 1;
      }
    }
    return 0;
  }

  // src/rotns/mystia.ts
  var MystiaPlayer = class {
    constructor() {
      this.x = CFG.player.spawnX;
      this.y = CFG.player.spawnY;
      this.alive = true;
      this.invuln = 0;
      // 复活/hyper/bomb 合并无敌由 scene 管理，这里只存复活无敌
      this.respawnTimer = 0;
      this.focus = false;
      this.bank = 0;
      // 倾斜姿态（视觉）-1..1
      this.optionSpin = 0;
      // 子机视觉旋转
      this.shotTimerMain = 0;
      this.shotTimerOpt = 0;
      this.movingX = 0;
      this.movingY = 0;
      this.shots = [];
      for (let i = 0; i < CFG.player.shotPoolCap; i++) {
        this.shots.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 0, kind: 0, age: 0 });
      }
    }
    get invincible() {
      return this.invuln > 0 || !this.alive;
    }
    kill() {
      this.alive = false;
      this.respawnTimer = CFG.player.respawnDelay;
    }
    // 每帧：移动/射击。held 来自真实键盘或 AI 注入，路径完全一致。
    update(held, firepowerMul, spreadMul, bossX, bossY) {
      if (!this.alive) {
        this.respawnTimer -= 1;
        if (this.respawnTimer <= 0) {
          this.alive = true;
          this.x = CFG.player.spawnX;
          this.y = CFG.player.spawnY;
          this.invuln = CFG.player.respawnInvuln;
        }
        return;
      }
      if (this.invuln > 0) this.invuln -= 1;
      const P2 = CFG.player;
      const F = CFG.playfield;
      const focus = held.has("focus");
      this.focus = focus;
      const speed = focus ? P2.speedSlow : P2.speedFast;
      let dx = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
      let dy = (held.has("down") ? 1 : 0) - (held.has("up") ? 1 : 0);
      if (dx !== 0 && dy !== 0) {
        dx *= P2.diagScale;
        dy *= P2.diagScale;
      }
      this.x = Math.min(F.maxX, Math.max(F.minX, this.x + dx * speed));
      this.y = Math.min(F.maxY, Math.max(F.minY, this.y + dy * speed));
      this.movingX = dx;
      this.movingY = dy;
      this.bank += (dx - this.bank) * 0.2;
      this.optionSpin += focus ? 0.05 : 0.12;
      if (held.has("shoot")) this.fire(firepowerMul, spreadMul, bossX, bossY);
      this.stepShots();
    }
    pushShot(x, y, angle, speed, dmg, kind) {
      for (const s of this.shots) {
        if (s.active) continue;
        s.active = true;
        s.x = x;
        s.y = y;
        s.vx = Math.cos(angle) * speed;
        s.vy = Math.sin(angle) * speed;
        s.dmg = dmg;
        s.kind = kind;
        s.age = 0;
        return;
      }
    }
    fire(mul, spreadMul, bossX, bossY) {
      const P2 = CFG.player;
      this.shotTimerMain -= 1;
      if (this.shotTimerMain <= 0) {
        this.shotTimerMain = P2.mainShot.interval;
        const d = Math.round(P2.mainShot.dmg * mul);
        this.pushShot(this.x - P2.mainShot.offsetX, this.y - 10, -Math.PI / 2, P2.mainShot.speed, d, 0);
        this.pushShot(this.x + P2.mainShot.offsetX, this.y - 10, -Math.PI / 2, P2.mainShot.speed, d, 0);
      }
      this.shotTimerOpt -= 1;
      if (this.focus) {
        const O = P2.optSlow;
        if (this.shotTimerOpt <= 0) {
          this.shotTimerOpt = O.interval;
          const d = Math.round(O.dmg * mul);
          for (const [ox, oy] of O.offsets) {
            this.pushShot(this.x + ox, this.y + oy, -Math.PI / 2, O.speed, d, 1);
          }
        }
      } else {
        const O = P2.optFast;
        if (this.shotTimerOpt <= 0) {
          this.shotTimerOpt = O.interval;
          const d = Math.round(O.dmg * mul);
          for (let k = 0; k < O.offsets.length; k++) {
            const [ox, oy] = O.offsets[k];
            const sx = this.x + ox, sy = this.y + oy;
            const aim = Math.atan2(bossY - sy, bossX - sx);
            const ang = aim + O.angles[k] * spreadMul;
            this.pushShot(sx, sy, ang, O.speed, d, 1);
          }
        }
      }
    }
    stepShots() {
      for (const s of this.shots) {
        if (!s.active) continue;
        s.x += s.vx;
        s.y += s.vy;
        s.age += 1;
        if (s.y < -24 || s.x < -24 || s.x > CFG.playfield.w + 24 || s.age > CFG.player.shotLife * 4) {
          s.active = false;
        }
      }
    }
    // 子机当前世界坐标（视觉 + AI 参考）
    optionPositions(out) {
      const offs = this.focus ? CFG.player.optSlow.offsets : CFG.player.optFast.offsets;
      for (let k = 0; k < 4; k++) {
        out[k].x = this.x + offs[k][0];
        out[k].y = this.y + offs[k][1];
      }
    }
  };

  // src/rotns/patterns/p1.ts
  var p1 = {
    init() {
      return { thetaA: 0, thetaB: Math.PI / 2, volley: 0 };
    },
    step(s, ctx) {
      const C = CFG.p1;
      if (ctx.frame % C.emitterA.interval === 0) {
        const speed = s.volley % 2 === 0 ? C.emitterA.speedLo : C.emitterA.speedHi;
        for (let k = 0; k < C.emitterA.ways; k++) {
          ctx.spawn({
            x: ctx.bossX,
            y: ctx.bossY,
            angle: s.thetaA + k / C.emitterA.ways * Math.PI * 2,
            speed,
            sprite: SPRITE.NEEDLE_PINK
          });
        }
        for (let k = 0; k < C.emitterB.ways; k++) {
          ctx.spawn({
            x: ctx.bossX,
            y: ctx.bossY,
            angle: s.thetaB + k / C.emitterB.ways * Math.PI * 2,
            speed: C.emitterB.speed,
            sprite: SPRITE.NEEDLE_BLUE
          });
        }
        s.thetaA += C.emitterA.dTheta;
        s.thetaB += C.emitterB.dTheta;
        s.volley += 1;
      }
      if (ctx.frame > 0 && ctx.frame % C.ring.interval === 0) {
        for (let k = 0; k < C.ring.ways; k++) {
          ctx.spawn({
            x: ctx.bossX,
            y: ctx.bossY,
            angle: k / C.ring.ways * Math.PI * 2,
            speed: C.ring.speed,
            sprite: SPRITE.BALL_S_PINK
          });
        }
      }
    }
  };

  // src/rotns/patterns/p2.ts
  var p2 = {
    init() {
      return { motherVolley: 0 };
    },
    step(s, ctx) {
      const C = CFG.p2;
      if (ctx.frame % C.mother.interval === 0) {
        const aim = Math.atan2(ctx.playerY - ctx.bossY, ctx.playerX - ctx.bossX);
        const arc = C.mother.aimArcDeg * Math.PI / 180;
        for (let k = 0; k < C.mother.ways; k++) {
          const t = C.mother.ways === 1 ? 0.5 : k / (C.mother.ways - 1);
          ctx.spawn({
            x: ctx.bossX,
            y: ctx.bossY,
            angle: aim - arc + t * 2 * arc,
            speed: C.mother.speed,
            sprite: SPRITE.BALL_L_BLUE,
            fuse: C.mother.fuse,
            splitKind: 1
          });
        }
        s.motherVolley += 1;
      }
      if (ctx.frame % C.press.interval === 0) {
        const aim = Math.atan2(ctx.playerY - ctx.bossY, ctx.playerX - ctx.bossX);
        for (let k = 0; k < C.press.ways; k++) {
          ctx.spawn({
            x: ctx.bossX,
            y: ctx.bossY,
            angle: aim + (k - (C.press.ways - 1) / 2) * 0.09,
            speed: C.press.speed,
            sprite: SPRITE.NEEDLE_PINK
          });
        }
      }
    }
  };

  // src/rotns/patterns/p3.ts
  var p3 = {
    init() {
      return { ringBase: 0 };
    },
    step(s, ctx) {
      const C = CFG.p3;
      if (ctx.frame % C.ring.interval === 0) {
        for (let k = 0; k < C.ring.ways; k++) {
          const jitter = (ctx.rng.f() * 2 - 1) * C.ring.jitterDeg * DEG;
          ctx.spawn({
            x: ctx.bossX,
            y: ctx.bossY,
            angle: s.ringBase + k / C.ring.ways * Math.PI * 2 + jitter,
            speed: C.ring.speed,
            sprite: SPRITE.BALL_S_PINK
          });
        }
        s.ringBase += C.ring.dBaseDeg * DEG;
      }
      if (ctx.frame % C.aim.interval === 0) {
        const aim = Math.atan2(ctx.playerY - ctx.bossY, ctx.playerX - ctx.bossX);
        const fan = C.aim.fanDeg * DEG;
        for (let k = 0; k < C.aim.ways; k++) {
          const t = C.aim.ways === 1 ? 0.5 : k / (C.aim.ways - 1);
          ctx.spawn({
            x: ctx.bossX,
            y: ctx.bossY,
            angle: aim - fan / 2 + t * fan,
            speed: C.aim.speed,
            sprite: SPRITE.NEEDLE_BLUE
          });
        }
      }
    }
  };

  // src/rotns/patterns/p4.ts
  function p4IntervalAt(frame) {
    const C = CFG.p4;
    const t = Math.min(1, frame / C.rampFrames);
    return C.intervalStart + (C.intervalEnd - C.intervalStart) * t;
  }
  var p4 = {
    init() {
      return { interval: CFG.p4.intervalStart, sinceLast: 0, base: 0, ringParity: 0 };
    },
    step(s, ctx) {
      const C = CFG.p4;
      s.interval = p4IntervalAt(ctx.frame);
      s.sinceLast += 1;
      if (s.sinceLast >= s.interval) {
        s.sinceLast = 0;
        const sprite = s.ringParity % 2 === 0 ? SPRITE.BALL_S_PINK : SPRITE.BALL_S_BLUE;
        for (let k = 0; k < C.ways; k++) {
          ctx.spawn({
            x: ctx.bossX,
            y: ctx.bossY,
            angle: s.base + k / C.ways * Math.PI * 2,
            speed: C.speed0,
            sprite,
            accel: C.accel,
            vmax: C.speedMax
          });
        }
        s.base += (ctx.rng.f() * 2 - 1) * C.baseJitterDeg * DEG;
        s.ringParity += 1;
      }
    }
  };

  // src/rotns/patterns/finale.ts
  var finale = {
    init(rng) {
      return {
        omega: CFG.finale.options.omega,
        orbit: rng.f() * Math.PI * 2,
        volley: 0,
        redBase: 0,
        fuguBase: rng.f() * Math.PI * 2,
        gambleCountdown: CFG.finale.gamble.everyVolleys
      };
    },
    step(s, ctx) {
      const C = CFG.finale;
      if (ctx.frame % C.options.interval === 0) {
        const fast = s.volley % 2 === 0;
        const speed = fast ? C.options.speedFast : C.options.speedSlow;
        for (let k = 0; k < C.options.count; k++) {
          const ang = s.orbit + k / C.options.count * Math.PI * 2;
          const ox = ctx.bossX + Math.cos(ang) * C.options.radius;
          const oy = ctx.bossY + Math.sin(ang) * C.options.radius;
          ctx.spawn({ x: ox, y: oy, angle: ang, speed, sprite: SPRITE.BALL_L_BLUE });
        }
        s.volley += 1;
        s.gambleCountdown -= 1;
        if (s.gambleCountdown <= 0) {
          s.gambleCountdown = C.gamble.everyVolleys;
          const total = C.gamble.wFlip + C.gamble.wJump + C.gamble.wNone;
          const roll = ctx.rng.u16InRange(total);
          if (roll < C.gamble.wFlip) {
            s.omega = -s.omega;
          } else if (roll < C.gamble.wFlip + C.gamble.wJump) {
            const sign = ctx.rng.u16InRange(2) === 0 ? 1 : -1;
            s.orbit += sign * C.gamble.phaseJump;
          }
        }
      }
      s.orbit += s.omega;
      if (ctx.frame > 0 && ctx.frame % C.redRing.interval === 0) {
        for (let k = 0; k < C.redRing.ways; k++) {
          ctx.spawn({
            x: ctx.bossX,
            y: ctx.bossY,
            angle: s.redBase + k / C.redRing.ways * Math.PI * 2,
            speed: C.redRing.speed,
            sprite: SPRITE.NEEDLE_RED
          });
        }
        s.redBase += C.redRing.dBase;
      }
      if (ctx.frame > 0 && ctx.frame % C.fugu.interval === 0) {
        const fan = C.fugu.fanDeg * DEG;
        for (let f = 0; f < C.fugu.fans; f++) {
          const center = s.fuguBase + f * (Math.PI * 2 / C.fugu.fans);
          for (let k = 0; k < C.fugu.petalsPerFan; k++) {
            const t = C.fugu.petalsPerFan === 1 ? 0.5 : k / (C.fugu.petalsPerFan - 1);
            ctx.spawn({
              x: ctx.bossX,
              y: ctx.bossY,
              angle: center - fan / 2 + t * fan,
              speed: C.fugu.speed,
              sprite: SPRITE.PETAL
            });
          }
        }
        s.fuguBase += 0.21;
      }
    }
  };

  // src/rotns/boss-yuyuko.ts
  var PATTERNS = {
    p1,
    p2,
    p3,
    p4,
    finale
  };
  function bossDriftPos(phaseId, absFrame) {
    const B = CFG.boss;
    if (phaseId === "finale") {
      return { x: B.cx, y: B.cy };
    }
    return {
      x: B.cx + Math.sin(absFrame / B.driftXPeriod * Math.PI * 2) * B.driftXAmp,
      y: B.cy + Math.sin(absFrame / B.driftYPeriod * Math.PI * 2) * B.driftYAmp
    };
  }
  var YuyukoBoss = class {
    constructor() {
      this.x = CFG.boss.cx;
      this.y = -60;
      // 淡入前在屏上外
      this.mode = "intro";
      this.modeFrame = 0;
      this.phaseIndex = 0;
      this.hp = 0;
      this.hpMax = 1;
      this.hpCharge = 0;
      // 充能演出进度 0..1
      this.patternState = null;
      this.patternFrame = 0;
      this.alpha = 0;
      // 淡入
      this.hitFlash = 0;
      // 被弹白闪
      this.bombFlash = 0;
      // 「结界护罩」闪光
      this.declareName = "";
      // 演出用符卡名
      this.fanSpin = 0;
    }
    // 视觉
    get phaseCfg() {
      return CFG.phases[this.phaseIndex];
    }
    get phaseId() {
      return this.phaseCfg.id;
    }
    get pattern() {
      return PATTERNS[this.phaseId];
    }
    get inCombat() {
      return this.mode === "combat";
    }
    // 全场绝对帧驱动的悬停漂移（AI 前瞻可复现）
    driftPos(absFrame) {
      return bossDriftPos(this.phaseId, absFrame);
    }
    enterMode(mode) {
      this.mode = mode;
      this.modeFrame = 0;
    }
    startPhase(rng, idx) {
      this.phaseIndex = idx;
      const cfg = this.phaseCfg;
      this.hp = cfg.hp;
      this.hpMax = cfg.hp;
      this.patternState = this.pattern.init(rng);
      this.patternFrame = 0;
      this.declareName = cfg.name;
      this.enterMode("declare");
    }
    // declare 演出结束 → 正式开战
    beginCombat() {
      this.patternFrame = 0;
      this.enterMode("combat");
    }
    applyDamage(d) {
      if (!this.inCombat || this.hp <= 0) return;
      this.hp -= d;
      this.hitFlash = 4;
    }
    get phaseCleared() {
      return this.inCombat && this.hp <= 0;
    }
    get timedOut() {
      const tl = this.phaseCfg.timeLimit;
      return this.inCombat && tl > 0 && this.patternFrame >= tl;
    }
    get isLastPhase() {
      return this.phaseIndex >= CFG.phases.length - 1;
    }
    // 返回 'hpcharge-done' 时由 scene 调用 startPhase(rng, 0) 启动首段。
    update(absFrame) {
      this.modeFrame += 1;
      if (this.hitFlash > 0) this.hitFlash -= 1;
      if (this.bombFlash > 0) this.bombFlash -= 1;
      this.fanSpin += 0.03;
      if (this.mode === "fadein") {
        this.alpha = Math.min(1, this.modeFrame / 40);
        this.y = -60 + (CFG.boss.cy + 60) * Math.min(1, this.modeFrame / 50);
        if (this.modeFrame >= 50) this.enterMode("hpcharge");
        return null;
      }
      if (this.mode === "hpcharge") {
        this.hpCharge = Math.min(1, this.modeFrame / CFG.boss.hpChargeFrames);
        this.hpMax = CFG.phases[this.phaseIndex].hp;
        this.hp = this.hpMax * this.hpCharge;
        const pos = this.driftPos(absFrame);
        this.x = pos.x;
        this.y = pos.y;
        if (this.hpCharge >= 1) return "hpcharge-done";
        return null;
      }
      if (this.mode === "combat" || this.mode === "declare") {
        const pos = this.driftPos(absFrame);
        this.x = pos.x;
        this.y = pos.y;
      }
      return null;
    }
    p4IntervalNow() {
      if (this.phaseId !== "p4" || !this.patternState) return 0;
      return p4IntervalAt(this.patternFrame);
    }
    finaleOmega() {
      if (this.phaseId !== "finale" || !this.patternState) return 0;
      return this.patternState.omega;
    }
    finaleOrbit() {
      if (this.phaseId !== "finale" || !this.patternState) return 0;
      return this.patternState.orbit;
    }
    timeLeft() {
      const tl = this.phaseCfg.timeLimit;
      if (tl <= 0) return Infinity;
      return Math.max(0, tl - this.patternFrame);
    }
  };
  function patternFor(id) {
    return PATTERNS[id];
  }

  // src/rotns/hyper.ts
  var HyperSystem = class {
    constructor() {
      this.gauge = 0;
      this.active = false;
      this.left = 0;
    }
    // 剩余帧
    get full() {
      return this.gauge >= CFG.hyper.max;
    }
    get firepowerMul() {
      return this.active ? CFG.hyper.firepowerMul : 1;
    }
    get spreadMul() {
      return this.active ? CFG.hyper.spreadMul : 1;
    }
    addGraze() {
      if (this.active) return;
      this.gauge = Math.min(CFG.hyper.max, this.gauge + CFG.hyper.gainGraze);
    }
    addHitFrame() {
      if (this.active) return;
      this.gauge = Math.min(CFG.hyper.max, this.gauge + CFG.hyper.gainHitPerFrame);
    }
    addPhaseClear() {
      if (this.active) return;
      this.gauge = Math.min(CFG.hyper.max, this.gauge + CFG.hyper.gainPhaseClear);
    }
    // 返回 true = 成功发动（scene 据此触发全屏消弹化星）
    tryCast() {
      if (this.active || !this.full) return false;
      this.active = true;
      this.left = CFG.hyper.duration;
      return true;
    }
    // 被弹死亡或 Bomb → 立即终止且量表清零
    terminate() {
      this.active = false;
      this.left = 0;
      this.gauge = 0;
    }
    update() {
      if (!this.active) return;
      this.left -= 1;
      this.gauge = Math.max(0, CFG.hyper.max * this.left / CFG.hyper.duration);
      if (this.left <= 0) {
        this.active = false;
        this.gauge = 0;
      }
    }
  };

  // src/rotns/bomb.ts
  var BombSystem = class {
    constructor() {
      this.stock = CFG.bomb.stock;
      this.active = false;
      this.waveT = 0;
      // 冲击波已进行帧
      this.invuln = 0;
      this.lock = 0;
    }
    // 再使用锁
    get radius() {
      if (!this.active) return 0;
      return CFG.bomb.radiusMax * Math.min(1, this.waveT / CFG.bomb.expandFrames);
    }
    get waveDone() {
      return this.waveT >= CFG.bomb.expandFrames;
    }
    resetStock() {
      this.stock = CFG.bomb.stock;
    }
    // 返回 true = 成功发动
    tryCast() {
      if (this.stock <= 0 || this.lock > 0 || this.active) return false;
      this.stock -= 1;
      this.active = true;
      this.waveT = 0;
      this.invuln = CFG.bomb.invuln;
      this.lock = CFG.bomb.lockFrames;
      return true;
    }
    update() {
      if (this.lock > 0) this.lock -= 1;
      if (this.invuln > 0) this.invuln -= 1;
      if (!this.active) return false;
      this.waveT += 1;
      if (this.waveT >= CFG.bomb.expandFrames) {
        this.active = false;
        return false;
      }
      return true;
    }
  };

  // src/rotns/hud.ts
  var PANEL_X = PLAYFIELD.x + PLAYFIELD.width + 8;
  function drawHud(R, h, hasPanel) {
    if (hasPanel) {
      R.ctx.drawImage(R.image("inb_hud_panel"), PANEL_X - 8, 0, 224, 480);
    } else {
      R.ctx.fillStyle = "#0b0714";
      R.ctx.fillRect(PANEL_X - 8, 0, 640 - PANEL_X + 8, 480);
      R.ctx.strokeStyle = "rgba(150, 110, 200, 0.35)";
      R.ctx.strokeRect(PANEL_X - 8.5, 0.5, 640 - PANEL_X + 8, 479);
    }
    R.text("SCORE", PANEL_X + 16, 92, { size: 11, color: "#b090d0" });
    R.text(h.score.toLocaleString().padStart(11, "0"), PANEL_X + 16, 106, { size: 15, color: "#fff", font: "monospace" });
    R.text("HISCORE", PANEL_X + 16, 130, { size: 11, color: "#b090d0" });
    R.text(h.hiScore.toLocaleString().padStart(11, "0"), PANEL_X + 16, 144, { size: 15, color: "#f0d878", font: "monospace" });
    R.text("\u6B8B\u673A", PANEL_X + 16, 176, { size: 11, color: "#b090d0" });
    const lifeIcon = R.image("inb_icon_life");
    for (let i = 0; i < Math.max(0, h.lives); i++) {
      if (lifeIcon) R.ctx.drawImage(lifeIcon, PANEL_X + 56 + i * 22, 172, 18, 18);
      else {
        R.ctx.fillStyle = "#ffc0d0";
        R.ctx.beginPath();
        R.ctx.arc(PANEL_X + 64 + i * 22, 181, 7, 0, Math.PI * 2);
        R.ctx.fill();
      }
    }
    R.text("BOMB", PANEL_X + 16, 204, { size: 11, color: "#b090d0" });
    const bombIcon = R.image("inb_icon_bomb");
    for (let i = 0; i < h.bombs; i++) {
      if (bombIcon) R.ctx.drawImage(bombIcon, PANEL_X + 56 + i * 22, 200, 18, 18);
      else {
        R.ctx.fillStyle = "#a0e9ff";
        R.ctx.beginPath();
        R.ctx.arc(PANEL_X + 64 + i * 22, 209, 7, 0, Math.PI * 2);
        R.ctx.fill();
      }
    }
    R.text(`GRAZE ${h.graze}`, PANEL_X + 16, 232, { size: 11, color: "#90c8b0" });
    R.text(h.hyperActive ? "HYPER!!" : "HYPER", PANEL_X + 16, 282, {
      size: 12,
      color: h.hyperActive ? "#ffb040" : "#9060c0"
    });
    const gx = PANEL_X + 16, gy = 300, gw = 192, gh = 14;
    R.ctx.fillStyle = "rgba(20, 12, 36, 0.85)";
    R.ctx.fillRect(gx, gy, gw, gh);
    R.ctx.strokeStyle = "#8060a8";
    R.ctx.strokeRect(gx - 0.5, gy - 0.5, gw + 1, gh + 1);
    const ratio = Math.min(1, h.hyperGauge / h.hyperMax);
    const grad = R.ctx.createLinearGradient(gx, 0, gx + gw, 0);
    if (h.hyperActive) {
      grad.addColorStop(0, "#ff9020");
      grad.addColorStop(1, "#fff0a0");
    } else if (h.hyperFull) {
      grad.addColorStop(0, "#d0a020");
      grad.addColorStop(1, "#ffe870");
    } else {
      grad.addColorStop(0, "#503088");
      grad.addColorStop(1, "#9060d0");
    }
    R.ctx.fillStyle = grad;
    R.ctx.fillRect(gx, gy, gw * ratio, gh);
    if (h.hyperFull && !h.hyperActive && (performanceNow() >> 3) % 2 === 0) {
      R.text("[C] \u53D1\u52A8!", PANEL_X + 16, 322, { size: 12, color: "#ffe870" });
    }
    if (h.aiEnabled) {
      const pulse = 0.55 + 0.45 * Math.sin(performanceNow() * 0.012);
      R.ctx.save();
      R.ctx.globalAlpha = pulse;
      R.ctx.fillStyle = "#20c080";
      R.ctx.fillRect(PANEL_X + 16, 348, 118, 22);
      R.ctx.restore();
      R.text("FlameTN7\u4EE3\u6253", PANEL_X + 75, 352, { size: 11, color: "#041008", align: "center", font: "monospace" });
    }
    const help = ["Z \u5C04\u51FB Shift \u4F4E\u901F X Bomb", "C Hyper  A \u4EE3\u6253  R \u91CD\u5F00  M \u9759\u97F3"];
    help.forEach((s, i) => R.text(s, PANEL_X + 16, 446 + i * 15, { size: 10, color: "#7060a0" }));
    if (h.bossActive) {
      const bx = PLAYFIELD.x + 6, bw = PLAYFIELD.width - 12, by = PLAYFIELD.y + 4;
      R.ctx.fillStyle = "rgba(10, 6, 20, 0.7)";
      R.ctx.fillRect(bx, by, bw, 7);
      const ratio2 = Math.max(0, h.bossHp / h.bossHpMax) * h.hpCharge;
      R.ctx.fillStyle = h.phaseIndex >= CFG.phases.length - 1 ? "#ff4050" : "#e05070";
      R.ctx.fillRect(bx, by, bw * ratio2, 7);
      R.ctx.fillStyle = "rgba(255,255,255,0.5)";
      R.ctx.fillRect(bx, by, bw * ratio2, 2);
      for (let k = 0; k < h.phaseCount; k++) {
        const tx = bx + (k + 0.5) * (bw / h.phaseCount);
        R.ctx.fillStyle = k < h.phaseIndex ? "#584060" : k === h.phaseIndex ? "#ffd76a" : "#c0b0d0";
        R.ctx.beginPath();
        R.ctx.arc(tx, by + 12, 2.5, 0, Math.PI * 2);
        R.ctx.fill();
      }
      if (h.timeLeft !== Infinity && h.bossActive) {
        const sec = Math.ceil(h.timeLeft / 60);
        R.text(String(sec).padStart(2, "0"), PLAYFIELD.x + PLAYFIELD.width - 34, by + 12, {
          size: 13,
          color: sec <= 10 ? "#ff6060" : "#c0b0e0",
          font: "monospace"
        });
      }
    }
  }
  function drawOverlayText(R, title, sub, t) {
    R.ctx.save();
    R.ctx.fillStyle = "rgba(4, 2, 12, 0.7)";
    R.ctx.fillRect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);
    R.text(title, PLAYFIELD.x + 192, 180, { size: 40, color: "#ff8080", align: "center", font: "monospace" });
    if (t > 60 && (t >> 4) % 2 === 0) {
      R.text(sub, PLAYFIELD.x + 192, 260, { size: 14, color: "#fff", align: "center" });
    }
    R.ctx.restore();
  }
  function performanceNow() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  // src/rotns/scene.ts
  var PARTICLE_CAP = 512;
  var RotnsScene = class {
    constructor(opts) {
      this.player = new MystiaPlayer();
      this.boss = new YuyukoBoss();
      this.hyper = new HyperSystem();
      this.bomb = new BombSystem();
      this.mode = "fight";
      this.absFrame = 0;
      this.hitstop = 0;
      this.castInvuln = 0;
      // hyper 发动无敌
      this.shake = 0;
      this.lives = CFG.player.lives;
      this.score = 0;
      this.hiScore = 0;
      this.grazeCount = 0;
      this.bombsUsed = 0;
      this.hypersUsed = 0;
      this.missCount = 0;
      this.clearFrame = 0;
      this.pauseRequested = false;
      this.finalBurstT = 0;
      this.particles = [];
      this.aiEnabled = false;
      // HUD 徽标用；实际决策在 InputSource 侧
      // AI 决策耗时观测（性能预算用）
      this.lastAiMs = 0;
      const seed = opts.seed ?? 5415;
      this.rng = new Rng(seed);
      this.fxRng = new Rng(seed ^ 24301);
      this.pool = createPool();
      this.inputSource = opts.input;
      this.events = opts.events ?? null;
      this.fxEnabled = opts.fx ?? true;
    }
    // —— AI 只读视图 ——
    aiView() {
      return {
        frame: this.absFrame,
        pool: this.pool,
        playerX: this.player.x,
        playerY: this.player.y,
        playerAlive: this.player.alive,
        invuln: Math.max(this.player.invuln, this.bomb.invuln, this.castInvuln),
        bossX: this.boss.x,
        bossY: this.boss.y,
        bossAlive: this.boss.inCombat || this.boss.mode === "declare",
        inCombat: this.boss.inCombat,
        phaseIndex: this.boss.phaseIndex,
        phaseId: this.boss.phaseId,
        patternFrame: this.boss.patternFrame,
        patternState: this.boss.patternState,
        rngSeed: this.rng.seed,
        hyperGauge: this.hyper.gauge,
        hyperActive: this.hyper.active,
        hyperLeft: this.hyper.left,
        bombs: this.bomb.stock,
        p4IntervalNow: this.boss.p4IntervalNow(),
        finaleOmega: this.boss.finaleOmega(),
        finaleOrbit: this.boss.finaleOrbit(),
        bulletCount: this.pool.n,
        timeLeft: this.boss.timeLeft()
      };
    }
    get done() {
      return this.mode === "gameover" || this.mode === "clear";
    }
    get result() {
      return {
        mode: this.mode,
        score: this.score,
        graze: this.grazeCount,
        bombsUsed: this.bombsUsed,
        hypersUsed: this.hypersUsed,
        miss: this.missCount,
        frame: this.absFrame
      };
    }
    update() {
      const input = this.inputSource.frame();
      if (this.mode !== "fight") {
        this.updateParticles();
        this.clearFrame += 1;
        return;
      }
      if (this.hitstop > 0) {
        this.hitstop -= 1;
        return;
      }
      this.absFrame += 1;
      if (this.shake > 0) this.shake -= 1;
      if (this.castInvuln > 0) this.castInvuln -= 1;
      const ev = this.boss.update(this.absFrame);
      if (ev === "hpcharge-done") {
        this.boss.startPhase(this.rng, 0);
        this.events?.sfx("spellDeclare");
      } else if (this.boss.mode === "intro" && this.boss.modeFrame >= CFG.boss.introBlackFrames) {
        this.boss.enterMode("warning");
        this.events?.sfx("warning");
      } else if (this.boss.mode === "warning" && this.boss.modeFrame >= CFG.boss.warningFrames) {
        this.boss.enterMode("fadein");
      } else if (this.boss.mode === "declare" && this.boss.modeFrame >= CFG.boss.spellDeclareFrames) {
        this.boss.beginCombat();
        if (this.boss.phaseId === "finale") this.events?.bgm("finale");
      }
      if ((this.boss.mode === "intro" || this.boss.mode === "warning") && input.pressed.has("confirm")) {
        this.boss.enterMode("fadein");
      }
      if (this.boss.inCombat) {
        const ctx = {
          rng: this.rng,
          frame: this.boss.patternFrame,
          playerX: this.player.x,
          playerY: this.player.y,
          bossX: this.boss.x,
          bossY: this.boss.y,
          spawn: (spec) => spawnBullet(this.pool, spec)
        };
        this.boss.pattern.step(this.boss.patternState, ctx);
        this.boss.patternFrame += 1;
      }
      if (input.pressed.has("hyper")) this.castHyper();
      if (input.pressed.has("bomb")) this.castBomb();
      this.player.update(input.held, this.hyper.firepowerMul, this.hyper.spreadMul, this.boss.x, this.boss.y);
      if (input.held.has("shoot") && this.player.alive && this.absFrame % 6 === 0) {
        this.events?.sfx("shot");
      }
      stepBullets(this.pool, this.rng);
      if (this.bomb.update()) {
        const r = this.bomb.radius;
        const r2 = r * r;
        let i = 0;
        while (i < this.pool.n) {
          const dx = this.pool.x[i] - this.player.x, dy = this.pool.y[i] - this.player.y;
          if (dx * dx + dy * dy <= r2) {
            this.score += CFG.bomb.starScore;
            this.spawnParticle(this.pool.x[i], this.pool.y[i], 0);
            const j = --this.pool.n;
            if (i !== j) {
              this.pool.x[i] = this.pool.x[j];
              this.pool.y[i] = this.pool.y[j];
              this.pool.vx[i] = this.pool.vx[j];
              this.pool.vy[i] = this.pool.vy[j];
              this.pool.accel[i] = this.pool.accel[j];
              this.pool.vmax[i] = this.pool.vmax[j];
              this.pool.fuse[i] = this.pool.fuse[j];
              this.pool.splitKind[i] = this.pool.splitKind[j];
              this.pool.sprite[i] = this.pool.sprite[j];
              this.pool.grazed[i] = this.pool.grazed[j];
              this.pool.age[i] = this.pool.age[j];
            }
          } else i++;
        }
      }
      this.hyper.update();
      if (this.boss.inCombat && this.boss.hp > 0) {
        let anyHit = false;
        for (const s of this.player.shots) {
          if (!s.active) continue;
          const dx = s.x - this.boss.x, dy = s.y - this.boss.y;
          const r = CFG.boss.contactHitbox;
          if (dx * dx + dy * dy <= r * r) {
            this.boss.applyDamage(s.dmg);
            s.active = false;
            anyHit = true;
            if (this.fxEnabled && this.fxRng.f() < 0.3) this.spawnParticle(s.x, s.y, 4);
          }
        }
        if (anyHit) {
          this.hyper.addHitFrame();
          if (this.absFrame % 8 === 0) this.events?.sfx("enemyHit");
        }
      }
      if (this.player.alive) {
        const invincible = this.player.invuln > 0 || this.bomb.invuln > 0 || this.castInvuln > 0;
        if (!invincible) {
          let killed = false;
          for (let i = 0; i < this.pool.n; i++) {
            const res = bulletVsPlayer(this.pool, i, this.player.x, this.player.y, CFG.player.hitboxR, CFG.player.grazePad);
            if (res === 2) {
              killed = true;
              break;
            }
            if (res === 1) {
              this.grazeCount += 1;
              this.score += CFG.score.graze;
              this.hyper.addGraze();
              this.spawnParticle(this.player.x + (this.fxRng.f() - 0.5) * 12, this.player.y - 6, 1);
              this.events?.sfx("graze");
            }
          }
          if (killed) this.onPlayerDeath();
        }
      }
      if (this.boss.phaseCleared || this.boss.timedOut) {
        if (this.boss.isLastPhase && this.boss.phaseCleared) {
          this.enterFinalBurst();
        } else {
          this.cancelAllBullets(0);
          this.hyper.addPhaseClear();
          this.score += CFG.score.phaseClearBase * Math.max(1, this.lives);
          this.events?.sfx("phaseBreak");
          this.boss.startPhase(this.rng, this.boss.phaseIndex + 1);
          this.events?.sfx("spellDeclare");
        }
      }
      if (this.boss.mode === "finalburst") {
        this.finalBurstT += 1;
        if (this.finalBurstT % 6 === 0) {
          this.spawnParticle(this.boss.x + (this.fxRng.f() - 0.5) * 160, this.boss.y + (this.fxRng.f() - 0.5) * 120, 3);
        }
        if (this.finalBurstT >= 180) {
          this.mode = "clear";
          this.score += CFG.score.allClearBonus;
          this.events?.bgm(null);
        }
      }
      this.updateParticles();
    }
    castHyper() {
      if (!this.hyper.tryCast()) return;
      this.hypersUsed += 1;
      let stars = 0;
      for (let i = 0; i < this.pool.n; i++) {
        if (stars < 96) this.spawnParticle(this.pool.x[i], this.pool.y[i], 0);
        stars += 1;
      }
      this.score += stars * CFG.score.hyperStar;
      clearPool(this.pool);
      this.castInvuln = CFG.hyper.invulnOnCast;
      this.shake = CFG.hyper.shakeFrames;
      this.events?.sfx("hyper");
    }
    castBomb() {
      if (!this.bomb.tryCast()) return;
      this.bombsUsed += 1;
      this.hyper.terminate();
      if (this.boss.inCombat) {
        this.boss.applyDamage(CFG.bomb.bossDamageRaw * CFG.bomb.bossResist);
        this.boss.bombFlash = 30;
      }
      this.events?.sfx("bomb");
    }
    onPlayerDeath() {
      this.hitstop = CFG.player.hitstop;
      this.player.kill();
      this.missCount += 1;
      this.lives -= 1;
      this.bomb.resetStock();
      this.hyper.terminate();
      this.events?.sfx("death");
      for (let k = 0; k < 24; k++) {
        this.spawnParticle(this.player.x, this.player.y, 2);
      }
      if (this.lives < 0) {
        this.mode = "gameover";
        this.clearFrame = 0;
        this.events?.bgm(null);
      }
    }
    enterFinalBurst() {
      this.cancelAllBullets(0);
      this.boss.enterMode("finalburst");
      this.finalBurstT = 0;
      this.events?.sfx("phaseBreak");
      this.events?.bgm(null);
    }
    cancelAllBullets(_scoreEach) {
      let n = 0;
      for (let i = 0; i < this.pool.n; i++) {
        if (n < 128) {
          this.spawnParticle(this.pool.x[i], this.pool.y[i], 0);
          n += 1;
        }
      }
      clearPool(this.pool);
    }
    spawnParticle(x, y, kind) {
      if (!this.fxEnabled) return;
      if (this.particles.length >= PARTICLE_CAP) this.particles.shift();
      const r = this.fxRng;
      const ang = r.f() * TAU;
      const sp = kind === 0 ? 0.6 + r.f() * 1.2 : kind === 2 ? 1.5 + r.f() * 3.5 : 0.5 + r.f() * 1.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - (kind === 0 ? 0.4 : 0),
        life: 0,
        maxLife: kind === 0 ? 40 : kind === 2 ? 50 : kind === 3 ? 90 : 24,
        kind,
        size: kind === 0 ? 4 : kind === 3 ? 8 : 3
      });
    }
    updateParticles() {
      let w = 0;
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        p.life += 1;
        if (p.life >= p.maxLife) continue;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.kind === 2 ? 0.06 : 0;
        this.particles[w++] = p;
      }
      this.particles.length = w;
    }
    // ============================== draw ==============================
    // 与 update 完全隔离（PLAN 铁律 3）：bench 传 null renderer 整体跳过。
    draw(renderer, assetsReady) {
      const R = renderer;
      R.clear("#050508");
      const shakeX = this.shake > 0 ? (this.fxRng.f() - 0.5) * 6 : 0;
      const shakeY = this.shake > 0 ? (this.fxRng.f() - 0.5) * 6 : 0;
      R.clipPlayfield(() => {
        R.ctx.save();
        R.ctx.translate(shakeX, shakeY);
        this.drawBackground(R);
        this.drawBullets(R);
        this.drawPlayerShots(R);
        this.drawBoss(R);
        this.drawPlayer(R);
        this.drawParticles(R);
        this.drawBombWave(R);
        R.ctx.restore();
        R.ctx.strokeStyle = "rgba(120, 100, 160, 0.5)";
        R.ctx.lineWidth = 1;
        R.ctx.strokeRect(PLAYFIELD.x - 0.5, PLAYFIELD.y - 0.5, PLAYFIELD.width + 1, PLAYFIELD.height + 1);
      });
      this.drawHudPanel(R, assetsReady);
      this.drawOverlays(R);
      R.present();
    }
    drawBackground(R) {
      const px = PLAYFIELD.x, py = PLAYFIELD.y;
      const bg = R.image("inb_bg_stage");
      if (bg) {
        const scroll = this.absFrame * 0.5 % bg.height;
        R.ctx.drawImage(bg, px, py - scroll, PLAYFIELD.width, bg.height);
        R.ctx.drawImage(bg, px, py - scroll + bg.height, PLAYFIELD.width, bg.height);
        if (this.boss.phaseId === "finale") {
          const vortex = R.image("inb_bg_finale");
          if (vortex) {
            R.ctx.save();
            R.ctx.globalAlpha = 0.5;
            R.ctx.translate(px + PLAYFIELD.width / 2, py + 140);
            R.ctx.rotate(this.absFrame * 3e-3);
            R.ctx.drawImage(vortex, -160, -160, 320, 320);
            R.ctx.restore();
          }
        }
      } else {
        const g = R.ctx.createLinearGradient(0, py, 0, py + PLAYFIELD.height);
        g.addColorStop(0, "#0a0618");
        g.addColorStop(1, "#1a0e2a");
        R.ctx.fillStyle = g;
        R.ctx.fillRect(px, py, PLAYFIELD.width, PLAYFIELD.height);
      }
    }
    drawBoss(R) {
      if (this.boss.mode === "intro" || this.boss.mode === "warning" || this.boss.mode === "cleared") return;
      R.ctx.save();
      const bx = PLAYFIELD.x + this.boss.x, by = PLAYFIELD.y + this.boss.y;
      const img = R.image("inb_yuyuko_idle");
      const alpha = this.boss.mode === "fadein" ? this.boss.alpha : 1;
      if (this.boss.mode === "finalburst") {
        const fade = Math.max(0, 1 - this.finalBurstT / 120);
        if (fade <= 0) {
          R.ctx.restore();
          return;
        }
        R.ctx.globalAlpha = fade;
      }
      if (this.boss.phaseId === "finale" && (this.boss.inCombat || this.boss.mode === "declare")) {
        const st = this.boss.patternState;
        const orbit = st?.orbit ?? 0;
        const turret = R.image("inb_opt_turret");
        for (let k = 0; k < CFG.finale.options.count; k++) {
          const ang = orbit + k / CFG.finale.options.count * TAU;
          const ox = bx + Math.cos(ang) * CFG.finale.options.radius;
          const oy = by + Math.sin(ang) * CFG.finale.options.radius;
          if (turret) {
            R.drawSpriteInBatch("inb_opt_turret", 0, 0, turret.width, turret.height, ox, oy, ang + Math.PI / 2, 1, alpha, "lighter");
          } else {
            R.ctx.fillStyle = "#8fd";
            R.ctx.beginPath();
            R.ctx.arc(ox, oy, 8, 0, TAU);
            R.ctx.fill();
          }
        }
      }
      if (img) {
        R.drawSprite("inb_yuyuko_idle", 0, 0, img.width, img.height, bx, by, { alpha });
      } else {
        R.ctx.save();
        R.ctx.globalAlpha = alpha;
        R.ctx.fillStyle = this.boss.hitFlash > 0 ? "#fff" : "#e8b8ff";
        R.ctx.beginPath();
        R.ctx.arc(bx, by, 24, 0, TAU);
        R.ctx.fill();
        R.ctx.fillStyle = "#a060c0";
        R.ctx.beginPath();
        R.ctx.arc(bx, by - 8, 12, 0, TAU);
        R.ctx.fill();
        R.ctx.restore();
      }
      if (this.boss.hitFlash > 0) {
        R.ctx.save();
        R.ctx.globalAlpha = this.boss.hitFlash / 8;
        R.ctx.globalCompositeOperation = "lighter";
        R.ctx.fillStyle = "#fff";
        R.ctx.beginPath();
        R.ctx.arc(bx, by, 30, 0, TAU);
        R.ctx.fill();
        R.ctx.restore();
      }
      if (this.boss.bombFlash > 0) {
        R.ctx.save();
        R.ctx.globalAlpha = this.boss.bombFlash / 30;
        R.ctx.strokeStyle = "#ffd040";
        R.ctx.lineWidth = 3;
        R.ctx.beginPath();
        R.ctx.arc(bx, by, 40 + (30 - this.boss.bombFlash), 0, TAU);
        R.ctx.stroke();
        R.ctx.restore();
        R.text("\u7ED3\u754C\u62A4\u7F69", bx + 30, by - 40, { size: 12, color: "#ffd040" });
      }
      R.ctx.restore();
    }
    drawBullets(R) {
      R.ctx.save();
      const pool = this.pool;
      for (let i = 0; i < pool.n; i++) {
        const spr = CFG.bullets.sprites[pool.sprite[i]];
        const key = "inb_" + spr.key;
        const img = R.image(key);
        const x = PLAYFIELD.x + pool.x[i], y = PLAYFIELD.y + pool.y[i];
        const rot = spr.key.startsWith("needle") ? Math.atan2(pool.vy[i], pool.vx[i]) + Math.PI / 2 : spr.key === "blt_petal" ? pool.age[i] * 0.1 : 0;
        const alpha = spr.alpha ?? 1;
        if (img) {
          R.drawSpriteInBatch(key, 0, 0, img.width, img.height, x, y, rot, 1, alpha, spr.blend);
        } else {
          R.ctx.globalAlpha = alpha;
          R.ctx.globalCompositeOperation = "lighter";
          R.ctx.fillStyle = PLACEHOLDER_COLORS[pool.sprite[i] % PLACEHOLDER_COLORS.length];
          R.ctx.beginPath();
          R.ctx.arc(x, y, Math.max(3, spr.hitbox + 2), 0, TAU);
          R.ctx.fill();
        }
      }
      R.ctx.restore();
    }
    drawPlayerShots(R) {
      R.ctx.save();
      R.ctx.globalCompositeOperation = "lighter";
      for (const s of this.player.shots) {
        if (!s.active) continue;
        const x = PLAYFIELD.x + s.x, y = PLAYFIELD.y + s.y;
        const key = s.kind === 0 ? "inb_shot_feather" : "inb_shot_wave";
        const img = R.image(key);
        if (img) {
          const rot = s.kind === 1 ? Math.atan2(s.vy, s.vx) + Math.PI / 2 : 0;
          R.drawSpriteInBatch(key, 0, 0, img.width, img.height, x, y, rot, 1, 1, "lighter");
        } else {
          R.ctx.fillStyle = s.kind === 0 ? "#ffe9a0" : "#a0e9ff";
          R.ctx.fillRect(x - 2, y - 8, 4, 16);
        }
      }
      R.ctx.restore();
    }
    drawPlayer(R) {
      if (!this.player.alive) return;
      const px = PLAYFIELD.x + this.player.x, py = PLAYFIELD.y + this.player.y;
      const offs = this.player.focus ? CFG.player.optSlow.offsets : CFG.player.optFast.offsets;
      const orbImg = R.image("inb_opt_orb");
      R.ctx.save();
      R.ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < 4; k++) {
        const wob = Math.sin(this.player.optionSpin + k * Math.PI / 2) * 2;
        const ox = px + offs[k][0], oy = py + offs[k][1] + wob;
        if (orbImg) R.drawSpriteInBatch("inb_opt_orb", 0, 0, orbImg.width, orbImg.height, ox, oy, 0, 1, 0.9, "lighter");
        else {
          R.ctx.fillStyle = "#ffd76a";
          R.ctx.beginPath();
          R.ctx.arc(ox, oy, 5, 0, TAU);
          R.ctx.fill();
        }
      }
      R.ctx.restore();
      const idle = R.image("inb_mystia_idle");
      const flicker = this.player.invuln > 0 && (this.absFrame >> 2) % 2 === 0;
      R.ctx.save();
      if (flicker) R.ctx.globalAlpha = 0.45;
      if (idle) {
        R.drawSprite("inb_mystia_idle", 0, 0, idle.width, idle.height, px, py, {});
      } else {
        R.ctx.fillStyle = "#ffc0d0";
        R.ctx.beginPath();
        R.ctx.arc(px, py, 10, 0, TAU);
        R.ctx.fill();
        R.ctx.fillStyle = "#804040";
        R.ctx.beginPath();
        R.ctx.arc(px, py - 4, 6, 0, TAU);
        R.ctx.fill();
      }
      R.ctx.restore();
      if (this.player.focus) {
        R.ctx.save();
        R.ctx.globalCompositeOperation = "lighter";
        R.ctx.fillStyle = "#fff";
        R.ctx.beginPath();
        R.ctx.arc(px, py, CFG.player.hitboxR + 1.5, 0, TAU);
        R.ctx.fill();
        R.ctx.strokeStyle = `rgba(255, 220, 120, ${0.5 + 0.3 * Math.sin(this.absFrame * 0.2)})`;
        R.ctx.lineWidth = 1.5;
        R.ctx.beginPath();
        R.ctx.arc(px, py, 10 + Math.sin(this.absFrame * 0.15) * 2, 0, TAU);
        R.ctx.stroke();
        R.ctx.restore();
      }
      if (this.hyper.active) {
        const ring = R.image("inb_fx_hyper");
        R.ctx.save();
        R.ctx.globalCompositeOperation = "lighter";
        R.ctx.globalAlpha = 0.6;
        if (ring) {
          const s = 1 + 0.15 * Math.sin(this.absFrame * 0.3);
          R.drawSprite("inb_fx_hyper", 0, 0, ring.width, ring.height, px, py, { scaleMultiplier: s * 0.4, blend: "lighter" });
        } else {
          R.ctx.strokeStyle = "#ffd040";
          R.ctx.lineWidth = 2;
          R.ctx.beginPath();
          R.ctx.arc(px, py, 18 + Math.sin(this.absFrame * 0.3) * 4, 0, TAU);
          R.ctx.stroke();
        }
        R.ctx.restore();
      }
    }
    drawParticles(R) {
      R.ctx.save();
      R.ctx.globalCompositeOperation = "lighter";
      for (const p of this.particles) {
        const t = 1 - p.life / p.maxLife;
        const x = PLAYFIELD.x + p.x, y = PLAYFIELD.y + p.y;
        if (p.kind === 0) {
          R.ctx.globalAlpha = t;
          R.ctx.fillStyle = "#fff2b0";
          R.ctx.beginPath();
          R.ctx.arc(x, y, p.size * t + 1, 0, TAU);
          R.ctx.fill();
        } else if (p.kind === 1) {
          R.ctx.globalAlpha = t * 0.8;
          R.ctx.fillStyle = "#a0fff0";
          R.ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        } else if (p.kind === 2) {
          R.ctx.globalAlpha = t;
          R.ctx.fillStyle = "#ff7090";
          R.ctx.beginPath();
          R.ctx.arc(x, y, p.size * t, 0, TAU);
          R.ctx.fill();
        } else if (p.kind === 3) {
          R.ctx.globalAlpha = t;
          R.ctx.fillStyle = "#ffd76a";
          R.ctx.beginPath();
          R.ctx.arc(x, y, p.size * t, 0, TAU);
          R.ctx.fill();
        } else {
          R.ctx.globalAlpha = t * 0.7;
          R.ctx.fillStyle = "#fff";
          R.ctx.beginPath();
          R.ctx.arc(x, y, 2, 0, TAU);
          R.ctx.fill();
        }
      }
      R.ctx.restore();
    }
    drawBombWave(R) {
      if (!this.bomb.active) return;
      const px = PLAYFIELD.x + this.player.x, py = PLAYFIELD.y + this.player.y;
      const r = this.bomb.radius;
      const fx = R.image("inb_fx_bomb");
      R.ctx.save();
      R.ctx.globalCompositeOperation = "lighter";
      if (fx) {
        const alpha = 1 - this.bomb.waveT / CFG.bomb.expandFrames;
        R.ctx.globalAlpha = Math.max(0.2, alpha);
        const scale = r * 2 / fx.width;
        R.drawSprite("inb_fx_bomb", 0, 0, fx.width, fx.height, px, py, { scaleMultiplier: scale, blend: "lighter" });
      } else {
        R.ctx.strokeStyle = "#ffe9a0";
        R.ctx.lineWidth = 6;
        R.ctx.globalAlpha = 1 - this.bomb.waveT / CFG.bomb.expandFrames;
        R.ctx.beginPath();
        R.ctx.arc(px, py, r, 0, TAU);
        R.ctx.stroke();
      }
      R.ctx.restore();
    }
    drawHudPanel(R, assetsReady) {
      const panel = R.image("inb_hud_panel");
      const hud = {
        score: this.score,
        hiScore: Math.max(this.hiScore, this.score),
        lives: this.lives,
        bombs: this.bomb.stock,
        hyperGauge: this.hyper.gauge,
        hyperMax: CFG.hyper.max,
        hyperActive: this.hyper.active,
        hyperFull: this.hyper.full,
        aiEnabled: this.aiEnabled,
        bossHp: this.boss.hp,
        bossHpMax: this.boss.hpMax,
        bossActive: this.boss.inCombat || this.boss.mode === "hpcharge",
        hpCharge: this.boss.mode === "hpcharge" ? this.boss.hpCharge : 1,
        phaseIndex: this.boss.phaseIndex,
        phaseCount: CFG.phases.length,
        timeLeft: this.boss.timeLeft(),
        graze: this.grazeCount,
        assetsReady
      };
      drawHud(R, hud, !!panel);
    }
    drawOverlays(R) {
      const m = this.boss.mode;
      if (m === "intro") {
        R.ctx.fillStyle = "#000";
        R.ctx.fillRect(0, 0, 640, 480);
        return;
      }
      if (m === "warning") {
        const t = this.boss.modeFrame;
        const blink = (t >> 3) % 2 === 0;
        R.ctx.save();
        R.ctx.globalAlpha = 0.85;
        R.ctx.fillStyle = "#000";
        R.ctx.fillRect(PLAYFIELD.x, 180, PLAYFIELD.width, 120);
        for (let i = 0; i < 24; i++) {
          R.ctx.fillStyle = i % 2 === 0 ? "#c01818" : "#180808";
          const x = PLAYFIELD.x + i * 16 - t % 32;
          R.ctx.beginPath();
          R.ctx.moveTo(x, 180);
          R.ctx.lineTo(x + 16, 180);
          R.ctx.lineTo(x + 4, 300);
          R.ctx.lineTo(x - 12, 300);
          R.ctx.fill();
        }
        if (blink) {
          const banner = R.image("inb_warning_banner");
          if (banner) {
            R.ctx.drawImage(banner, PLAYFIELD.x + 32, 210, 320, 60);
          } else {
            R.text("WARNING", PLAYFIELD.x + 192, 216, { size: 40, color: "#ff2020", align: "center", font: "monospace" });
          }
          R.text("\u4EA1\u6211\u56DE\u5929", PLAYFIELD.x + 192, 266, { size: 14, color: "#ffb0b0", align: "center" });
        }
        R.ctx.restore();
        return;
      }
      if (m === "declare") {
        const t = this.boss.modeFrame;
        const slide = Math.min(1, t / 12);
        const portrait = R.image("inb_yuyuko_portrait");
        if (portrait) {
          const pw = 150, ph = 225;
          const x = PLAYFIELD.x + PLAYFIELD.width - pw * slide;
          R.ctx.save();
          R.ctx.globalAlpha = Math.min(1, t / 20);
          R.ctx.drawImage(portrait, x, 60, pw, ph);
          R.ctx.restore();
        }
        R.ctx.save();
        R.ctx.globalAlpha = Math.min(1, t / 15);
        R.ctx.fillStyle = "rgba(8, 4, 16, 0.88)";
        R.ctx.fillRect(PLAYFIELD.x, 330, PLAYFIELD.width, 44);
        R.ctx.strokeStyle = "#c8a840";
        R.ctx.lineWidth = 1;
        R.ctx.strokeRect(PLAYFIELD.x + 2, 332, PLAYFIELD.width - 4, 40);
        R.text(this.boss.declareName, PLAYFIELD.x + 192, 342, { size: 18, color: "#f0d878", align: "center", font: '"MS Gothic", serif' });
        R.ctx.restore();
        return;
      }
      if (this.mode === "gameover") {
        drawOverlayText(R, "GAME OVER", "\u6309 R \u6216 Z \u91CD\u5F00", this.clearFrame);
        return;
      }
      if (this.mode === "clear") {
        const r = this.result;
        R.ctx.save();
        R.ctx.fillStyle = "rgba(4, 2, 12, 0.75)";
        R.ctx.fillRect(PLAYFIELD.x, PLAYFIELD.y, PLAYFIELD.width, PLAYFIELD.height);
        R.text("ALL CLEAR", PLAYFIELD.x + 192, 120, { size: 44, color: "#ffd76a", align: "center", font: "monospace" });
        R.text("\u53CD\u9B42\u8776\u3001\u6563\u534E\u7EC8\u7109 \u2014\u2014 \u732E\u7ED9\u6458\u53D6\u80DC\u5229\u4E4B\u4EBA", PLAYFIELD.x + 192, 175, { size: 12, color: "#e8c8ff", align: "center" });
        R.text(`SCORE  ${r.score.toLocaleString()}`, PLAYFIELD.x + 192, 220, { size: 16, color: "#fff", align: "center" });
        R.text(`GRAZE  ${r.graze}    MISS  ${r.miss}    BOMB  ${r.bombsUsed}    HYPER  ${r.hypersUsed}`, PLAYFIELD.x + 192, 250, { size: 12, color: "#c0b0e0", align: "center" });
        R.text(`TIME  ${(r.frame / 60).toFixed(1)}s`, PLAYFIELD.x + 192, 272, { size: 12, color: "#c0b0e0", align: "center" });
        if (this.clearFrame > 120) R.text("\u6309 Z \u8FD4\u56DE\u6807\u9898", PLAYFIELD.x + 192, 330, { size: 14, color: "#fff", align: "center" });
        R.ctx.restore();
      }
    }
  };
  var PLACEHOLDER_COLORS = ["#ff9ad5", "#7ab8ff", "#ff5a4a", "#ffb0e0", "#90c8ff", "#5a8aff", "#ffc0d8", "#ff9ad5"];

  // src/rotns/title.ts
  var TitleScene = class {
    constructor() {
      this.sel = 0;
      this.frame = 0;
      this.items = ["GAME START", "\u64CD\u4F5C\u8BF4\u660E"];
      this.showHelp = false;
    }
    update(input) {
      this.frame += 1;
      const p = input.pressed;
      if (this.showHelp) {
        if (p.has("confirm") || p.has("back")) this.showHelp = false;
        return null;
      }
      if (p.has("up")) this.sel = (this.sel + this.items.length - 1) % this.items.length;
      if (p.has("down")) this.sel = (this.sel + 1) % this.items.length;
      if (p.has("confirm")) {
        if (this.sel === 1) {
          this.showHelp = true;
          return null;
        }
        return { start: true, autoplay: false };
      }
      return null;
    }
    draw(R) {
      R.clear("#06030c");
      const art = R.image("inb_title_art");
      if (art) R.ctx.drawImage(art, 0, 0, 640, 480);
      R.ctx.save();
      if (art) {
        R.ctx.fillStyle = "rgba(4, 2, 10, 0.45)";
        R.ctx.fillRect(0, 0, 640, 480);
      }
      const logo = R.image("inb_logo_emblem");
      if (logo) {
        R.ctx.save();
        R.ctx.globalCompositeOperation = "lighter";
        R.ctx.drawImage(logo, 66, 40, 120, 120);
        R.ctx.restore();
      }
      R.text("\u4E1C\u65B9\u9634\u8776\u68A6", 320, 78, { size: 52, color: "#f0d8ff", align: "center", font: '"MS Gothic", "Yu Gothic", serif' });
      R.text("Requiem of the Night Sparrow", 320, 140, { size: 15, color: "#c8a8e0", align: "center" });
      R.text("\u2014\u2014 \u591C\u96C0 \xD7 \u4EA1\u7075\u516C\u4E3B \xB7 \u4E94\u6BB5\u846C\u9001\u66F2 \u2014\u2014", 320, 166, { size: 12, color: "#9078b0", align: "center" });
      R.ctx.restore();
      if (this.showHelp) {
        R.ctx.save();
        R.ctx.fillStyle = "rgba(6, 3, 14, 0.92)";
        R.ctx.fillRect(110, 90, 420, 300);
        R.ctx.strokeStyle = "#8060a8";
        R.ctx.strokeRect(110.5, 90.5, 419, 299);
        const lines = [
          "Z / Enter : \u5C04\u51FB\uFF08\u6309\u4F4F\u8FDE\u53D1\uFF09\xB7 \u51B3\u5B9A",
          "\u65B9\u5411\u952E : \u79FB\u52A8",
          "Shift : \u4F4E\u901F\u79FB\u52A8\uFF08\u663E\u793A\u5224\u5B9A\u70B9\uFF09",
          "X : Bomb\uFF08\u8857\u673A\u5F0F\xB7\u6E05\u5C4F\xB7\u5BF9BOSS\u5F31\uFF09",
          "C : Hyper \u53D1\u52A8\uFF08\u91CF\u8868\u6EE1\u65F6\uFF09",
          "A : FlameTN7\u4EE3\u6253 ON/OFF\uFF08\u9ED8\u8BA4\u5173\uFF09",
          "R : \u7ACB\u5373\u91CD\u5F00    M : \u9759\u97F3",
          "",
          "\u64E6\u5F39\u4E0E\u547D\u4E2D\u53EF\u79EF\u6512 HYPER \u91CF\u8868\u3002",
          "Bomb \u4E0E Hyper \u4E92\u65A5\uFF1B\u88AB\u5F39\u65E0 deathbomb\u3002",
          "BOSS \u4E3A\u4E94\u6BB5\u5F0F\u4F20\u8BF4\u7EA7\u5F39\u5E55\uFF0C\u4EBA\u7C7B\u51E0\u4E4E\u4E0D\u53EF\u80FD\u901A\u5173",
          "\u2014\u2014 \u8BF7\u591A\u6B23\u8D4F FlameTN7 \u7684\u8D70\u4F4D\u3002"
        ];
        lines.forEach((s, i) => R.text(s, 130, 108 + i * 22, { size: 12, color: "#d8c8f0" }));
        R.ctx.restore();
        R.present();
        return;
      }
      this.items.forEach((s, i) => {
        const y = 250 + i * 40;
        const active = i === this.sel;
        if (active) {
          R.ctx.fillStyle = "rgba(120, 60, 160, 0.4)";
          R.ctx.fillRect(210, y - 4, 220, 30);
          R.text("\u25B6", 222, y, { size: 16, color: "#ffd76a" });
        }
        R.text(s, 320, y, { size: 17, color: active ? "#fff" : "#8878a8", align: "center", font: "monospace" });
      });
      const blink = (this.frame >> 4) % 2 === 0;
      if (blink) R.text("\u540C\u4EBASTG \xB7 \u7D20\u6750\u5168\u90E8\u7531 gpt-image-2 \u751F\u6210 \xB7 \u97F3\u9891\u7A0B\u5E8F\u5408\u6210", 320, 430, { size: 11, color: "#685888", align: "center" });
      R.present();
    }
  };

  // src/rotns/audio-synth.ts
  var AudioSynth = class {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.comp = null;
      this.bgmGain = null;
      this.muted = false;
      this.lastShot = 0;
      this.bgmTimer = null;
      this.track = null;
      this.nextNoteTime = 0;
      this.beat = 0;
    }
    // 用户首次按键后调用（浏览器自动播放策略）
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext ?? window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.comp = this.ctx.createDynamicsCompressor();
        this.comp.threshold.value = -18;
        this.comp.ratio.value = 6;
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.comp);
        this.comp.connect(this.ctx.destination);
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.value = 0.4;
        this.bgmGain.connect(this.master);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    }
    toggleMute() {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
      return this.muted;
    }
    tone(opts) {
      if (!this.ctx || !this.master || this.muted) return;
      const t = opts.when ?? this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = opts.type;
      osc.frequency.setValueAtTime(opts.f0, t);
      if (opts.f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t + opts.dur);
      g.gain.setValueAtTime(opts.vol, t);
      g.gain.exponentialRampToValueAtTime(1e-4, t + opts.dur);
      osc.connect(g);
      g.connect(opts.dest ?? this.master);
      osc.start(t);
      osc.stop(t + opts.dur + 0.02);
    }
    noise(opts) {
      if (!this.ctx || !this.master || this.muted) return;
      const t = opts.when ?? this.ctx.currentTime;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * opts.dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      let node = src;
      if (opts.hp) {
        const f = this.ctx.createBiquadFilter();
        f.type = "highpass";
        f.frequency.value = opts.hp;
        node.connect(f);
        node = f;
      }
      if (opts.lp) {
        const f = this.ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = opts.lp;
        node.connect(f);
        node = f;
      }
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(opts.vol, t);
      g.gain.exponentialRampToValueAtTime(1e-4, t + opts.dur);
      node.connect(g);
      g.connect(this.master);
      src.start(t);
    }
    sfx(name) {
      if (!this.ctx || this.muted) return;
      switch (name) {
        case "shot": {
          const now = this.ctx.currentTime;
          if (now - this.lastShot < 0.09) return;
          this.lastShot = now;
          this.tone({ type: "triangle", f0: 1200, f1: 800, dur: 0.05, vol: 0.05 });
          break;
        }
        case "graze":
          this.noise({ dur: 0.03, vol: 0.06, hp: 8e3 });
          break;
        case "enemyHit":
          this.tone({ type: "square", f0: 200, dur: 0.04, vol: 0.05 });
          break;
        case "bomb":
          this.noise({ dur: 0.8, vol: 0.3, lp: 4e3 });
          this.tone({ type: "sine", f0: 80, f1: 40, dur: 0.8, vol: 0.35 });
          break;
        case "hyper":
          this.tone({ type: "sawtooth", f0: 300, f1: 1800, dur: 0.3, vol: 0.18 });
          this.tone({ type: "triangle", f0: 600, dur: 0.4, vol: 0.1 });
          this.tone({ type: "triangle", f0: 900, dur: 0.4, vol: 0.08 });
          break;
        case "cancelStar":
          this.tone({ type: "sine", f0: 1800 + (Math.random() - 0.5) * 400, dur: 0.06, vol: 0.04 });
          break;
        case "death":
          this.tone({ type: "sawtooth", f0: 800, f1: 60, dur: 0.5, vol: 0.25 });
          this.noise({ dur: 0.4, vol: 0.2, lp: 2e3 });
          break;
        case "warning": {
          for (let i = 0; i < 4; i++) {
            this.tone({ type: "square", f0: i % 2 === 0 ? 700 : 500, dur: 0.18, vol: 0.16, when: this.ctx.currentTime + i * 0.22 });
          }
          break;
        }
        case "spellDeclare":
          this.tone({ type: "sine", f0: 880, dur: 0.6, vol: 0.14 });
          this.tone({ type: "sine", f0: 880 * 2.76, dur: 0.4, vol: 0.05 });
          break;
        case "phaseBreak":
          this.noise({ dur: 0.5, vol: 0.2, lp: 5e3 });
          this.tone({ type: "sine", f0: 660, dur: 0.15, vol: 0.12 });
          this.tone({ type: "sine", f0: 880, dur: 0.15, vol: 0.12, when: this.ctx.currentTime + 0.1 });
          this.tone({ type: "sine", f0: 1100, dur: 0.2, vol: 0.12, when: this.ctx.currentTime + 0.2 });
          break;
      }
    }
    // —— BGM：16 小节循环调度器（lookahead 0.1s）——
    // A 段：Bm 小调分解和弦贝斯 + 八分琶音，BPM 152；B 段（发狂）：半音上移 + 鼓组。
    bgm(track) {
      if (this.track === track) return;
      this.track = track;
      if (this.bgmTimer) {
        clearInterval(this.bgmTimer);
        this.bgmTimer = null;
      }
      if (!track || !this.ctx) return;
      this.nextNoteTime = this.ctx.currentTime + 0.05;
      this.beat = 0;
      this.bgmTimer = setInterval(() => this.schedule(), 40);
    }
    schedule() {
      if (!this.ctx || !this.track) return;
      const spb = 60 / 152 / 2;
      while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
        this.scheduleBeat(this.beat, this.nextNoteTime, spb);
        this.nextNoteTime += spb;
        this.beat = (this.beat + 1) % (16 * 8);
      }
    }
    scheduleBeat(beat, t, spb) {
      if (this.muted || !this.bgmGain) return;
      const finale2 = this.track === "finale";
      const shift = finale2 ? 1 : 0;
      const roots = [59, 55, 50, 57];
      const root = roots[Math.floor(beat / 32) % 4] + shift;
      const toHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
      if (beat % 2 === 0) {
        this.tone({ type: "square", f0: toHz(root - 24), dur: spb * 0.9, vol: 0.1, when: t, dest: this.bgmGain });
      }
      const arpNotes = [0, 3, 7, 12, 7, 3];
      const arp = arpNotes[beat % arpNotes.length];
      this.tone({ type: "triangle", f0: toHz(root + arp), dur: spb * 0.8, vol: 0.06, when: t, dest: this.bgmGain });
      if (finale2) {
        if (beat % 4 === 0) this.noise({ dur: 0.08, vol: 0.16, lp: 300, when: t });
        if (beat % 2 === 1) this.noise({ dur: 0.03, vol: 0.05, hp: 9e3, when: t });
      }
      void spb;
    }
  };

  // src/rotns/ai/hints.ts
  function bandCost(y, lo, hi) {
    if (y < lo) return lo - y;
    if (y > hi) return y - hi;
    return 0;
  }
  var p1Hint = {
    // spiral-follow：贴底小幅横移跟随缝隙（缝隙追踪由生存项天然完成）
    cost(_v, _x, y) {
      return bandCost(y, 380, 420) * 2;
    }
  };
  var p2Hint = {
    // pre-split：保持与母弹距离（裂变前穿环）——纵向略抬便于穿环
    cost(_v, _x, y) {
      return bandCost(y, 360, 420) * 1.5;
    }
  };
  var p3Hint = {
    // stream：左右流带引导狙弹
    cost(view, x, y) {
      const sweep = 192 + 122 * Math.sin(view.frame * 0.011);
      const cx = Math.max(70, Math.min(314, sweep));
      return Math.abs(x - cx) * 0.6 + bandCost(y, 380, 420) * 2;
    }
  };
  var p4Hint = {
    // contract：锚定底中微移
    cost(_v, x, y) {
      const dx = x - 192, dy = y - 412;
      return Math.sqrt(dx * dx + dy * dy) * 1.2;
    }
  };
  var finaleHint = {
    preferFocus: true,
    // ride-winder（纵版自机的实战形态）：守在 Boss 下方中近距离弧带贴脸缠斗，
    // x 随条带扫频横移，缝隙追踪由生存项完成 —— 火力命中窗口最大化。
    cost(view, x, y) {
      const sweep = view.bossX + 30 * Math.sin(view.finaleOrbit * 2);
      return bandCost(y, 230, 390) * 1 + Math.abs(x - sweep) * 0.5;
    }
  };
  var HINTS = {
    p1: p1Hint,
    p2: p2Hint,
    p3: p3Hint,
    p4: p4Hint,
    finale: finaleHint
  };
  function hintFor(phaseId) {
    return HINTS[phaseId] ?? p1Hint;
  }

  // src/rotns/ai/planner.ts
  var H = CFG.ai.horizon;
  var H2 = 120;
  var SAFE_TIER = 34;
  var STRAT_TIER = 50;
  var BAND_FINALE = [230, 390];
  var BAND_HYPER_DIVE = [215, 320];
  var P = CFG.player;
  var BULLET_MAX_SPEED = 5.2;
  var CELL = 64;
  var GRID_X0 = -CFG.bullets.cullMargin;
  var GRID_Y0 = -CFG.bullets.cullMargin;
  var GRID_COLS = Math.ceil((CFG.playfield.w + CFG.bullets.cullMargin * 2) / CELL);
  var GRID_ROWS = Math.ceil((CFG.playfield.h + CFG.bullets.cullMargin * 2) / CELL);
  var GRID_CELLS = GRID_COLS * GRID_ROWS;
  function cellOf(x, y) {
    let cx = (x - GRID_X0) / CELL | 0;
    let cy = (y - GRID_Y0) / CELL | 0;
    if (cx < 0) cx = 0;
    else if (cx >= GRID_COLS) cx = GRID_COLS - 1;
    if (cy < 0) cy = 0;
    else if (cy >= GRID_ROWS) cy = GRID_ROWS - 1;
    return cy * GRID_COLS + cx;
  }
  function better(tA, softA, tB, softB, tier) {
    const ta = Math.min(tA, tier), tb = Math.min(tB, tier);
    if (ta !== tb) return ta > tb;
    if (ta < tier && tA !== tB) return tA > tB;
    return softA < softB;
  }
  function tierFor(view) {
    if (view.phaseId !== "finale") return SAFE_TIER;
    return view.hyperActive ? 10 : 16;
  }
  var AIMED_PHASES = /* @__PURE__ */ new Set(["p2", "p3"]);
  var POLICIES = [{ ux: 0, uy: 0, focus: false }];
  for (const focus of [false, true]) {
    const speed = focus ? P.speedSlow : P.speedFast;
    for (let k = 0; k < 8; k++) {
      POLICIES.push({ ux: Math.cos(k * Math.PI / 4) * speed, uy: Math.sin(k * Math.PI / 4) * speed, focus });
    }
  }
  function secondPolicies(base, out) {
    out.length = 0;
    out.push({ ux: 0, uy: 0, focus: base.focus });
    const speed = Math.hypot(base.ux, base.uy) || P.speedFast;
    for (let k = 0; k < 8; k++) {
      out.push({ ux: Math.cos(k * Math.PI / 4) * speed, uy: Math.sin(k * Math.PI / 4) * speed, focus: base.focus });
    }
  }
  var evalOut = { tHit: 0, grazeFrames: 0, endX: 0, endY: 0, minGap: Infinity };
  var Planner = class {
    constructor() {
      this.scratch = createPool();
      this.rng = new Rng();
      this.layer2 = [];
      this.sharedValid = false;
      this.trackOriginFrame = 0;
      this.prevUx = 0;
      this.prevUy = 0;
      this.prevPlan = null;
      this.bombCooldown = 0;
      this.lastFrame = -1;
      const cap = CFG.bullets.cap;
      this.snapX = new Float32Array(H2 * cap);
      this.snapY = new Float32Array(H2 * cap);
      this.snapSpr = new Uint8Array(H2 * cap);
      this.snapN = new Int32Array(H2);
      this.gridHead = new Int32Array(H2 * GRID_CELLS);
      this.gridNext = new Int32Array(H2 * cap);
    }
    decide(view) {
      if (this.lastFrame >= 0) this.bombCooldown = Math.max(0, this.bombCooldown - (view.frame - this.lastFrame));
      this.lastFrame = view.frame;
      this.sharedValid = false;
      const shared = !AIMED_PHASES.has(view.phaseId);
      if (shared) this.buildSharedTrack(view);
      this.sharedValid = shared;
      if (this.prevPlan && this.prevPlan.tHit >= H - CFG.ai.hysteresisMargin) {
        const check = this.evalPolicy(view, this.prevPlan.ux, this.prevPlan.uy, this.prevPlan.focus, null, H);
        if (check.tHit >= H - CFG.ai.hysteresisMargin) {
          this.prevPlan.hyper = false;
          this.prevPlan.bomb = false;
          this.prevPlan.minGap = check.minGap;
          this.applyResourceRules(view, this.prevPlan, check);
          return this.prevPlan;
        }
      }
      const tier = tierFor(view);
      let best = null;
      let bestSoft = Infinity;
      const layer1T = [];
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
      if (best.tHit < H) {
        const branchAt = CFG.ai.branchAt;
        const order = [];
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
            if (better(r.tHit, soft, best.tHit, bestSoft, tier)) {
              best = { ux: first.ux, uy: first.uy, focus: first.focus, hyper: false, bomb: false, tHit: r.tHit, minGap: r.minGap };
              bestSoft = soft;
            }
          }
        }
      }
      if (best.tHit >= H) {
        let strat = null;
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
        if (strat && strat.tHit >= H) {
          strat.tHit = best.tHit;
          best = strat;
        }
      }
      this.applyResourceRules(view, best, null);
      this.prevUx = best.ux;
      this.prevUy = best.uy;
      this.prevPlan = best;
      return best;
    }
    // humanizer 安全红线用：评估单策略 H 帧前瞻 tHit（须在同帧 decide() 之后调用，
    // shared 弹轨快照仍有效；aimed 段每次独立全量模拟）。
    // 键语义归一化：把 (ux,uy,focus) 映射回按键再按游戏物理还原速度，
    // 保证验证的就是游戏将执行的，从结构上杜绝 sim/执行分歧。
    // 快照帧偏移：decide 后第 k 帧调用时按 k 偏移读取弹轨（每帧急救校验用）。
    validate(view, ux, uy, focus) {
      const kx = ux < -0.01 ? -1 : ux > 0.01 ? 1 : 0;
      const ky = uy < -0.01 ? -1 : uy > 0.01 ? 1 : 0;
      const speed = focus ? P.speedSlow : P.speedFast;
      const diag = kx !== 0 && ky !== 0 ? P.diagScale : 1;
      if (this.sharedValid) {
        const offset = Math.max(0, view.frame - this.trackOriginFrame);
        if (offset > H2 - H) return 0;
        return this.evalShared(view, kx * speed * diag, ky * speed * diag, null, H, offset).tHit;
      }
      return this.evalFull(view, kx * speed * diag, ky * speed * diag, focus, null, H).tHit;
    }
    applyResourceRules(view, plan, check) {
      const minGap = check ? check.minGap : plan.minGap;
      const tHit = check ? check.tHit : plan.tHit;
      const hyperReady = !view.hyperActive && view.hyperGauge >= CFG.hyper.max;
      if (view.phaseId === "p4" && hyperReady && view.p4IntervalNow > 0 && view.p4IntervalNow < CFG.p4.hyperHintInterval && view.bulletCount > CFG.ai.p4BulletCountHint) {
        plan.hyper = true;
        return;
      }
      if (view.phaseId === "finale" && minGap < CFG.ai.gambleGapPx && view.invuln <= 0) {
        if (hyperReady) {
          plan.hyper = true;
          return;
        }
        if (view.bombs > 0 && this.bombCooldown <= 0) {
          plan.bomb = true;
          this.bombCooldown = CFG.ai.bombPanicCooldown;
          return;
        }
      }
      if (view.phaseId === "finale" && hyperReady && view.patternFrame > 300) {
        plan.hyper = true;
        return;
      }
      if (tHit < CFG.ai.panicThreshold) {
        if (hyperReady) {
          plan.hyper = true;
          return;
        }
        if (view.bombs > 0 && this.bombCooldown <= 0 && view.invuln <= 0) {
          plan.bomb = true;
          this.bombCooldown = CFG.ai.bombPanicCooldown;
        }
      }
    }
    softCost(view, r, pol) {
      const A = CFG.ai;
      const finale2 = view.phaseId === "finale";
      const bandY = finale2 ? view.hyperActive ? BAND_HYPER_DIVE : BAND_FINALE : A.anchorBandY;
      let anchor = 0;
      if (r.endY < bandY[0]) anchor += (bandY[0] - r.endY) * 1.5;
      if (r.endY > bandY[1]) anchor += (r.endY - bandY[1]) * 1.5;
      anchor += Math.max(0, Math.abs(r.endX - view.bossX) - A.anchorBossXPad);
      const hyperDive = finale2 && view.hyperActive;
      const laneW = hyperDive ? 20 : finale2 ? 8 : 4;
      const laneDist = Math.abs(r.endX - view.bossX);
      anchor += Math.max(0, laneDist - 30) * laneW;
      if (r.endY > view.bossY + 100) {
        if (laneDist < 24) anchor -= 250;
        else if (laneDist < 110) anchor -= 200;
      }
      if (r.endY < view.bossY + 80) anchor += 200;
      if (hyperDive && view.hyperLeft > CFG.hyper.duration - 100) {
        const inBand = r.endY >= BAND_HYPER_DIVE[0] && r.endY <= BAND_HYPER_DIVE[1];
        if (inBand && laneDist < 60) anchor -= 1500;
        else anchor += 800;
      }
      if (view.invuln > 0 && view.invuln < 90) {
        anchor += Math.abs(r.endX - 192) * 2;
        if (r.endY < 330) anchor += (330 - r.endY) * 4;
        if (laneDist < 110) anchor += 400;
      }
      if (Math.abs(r.endX - 192) > 170) anchor += 150;
      const flip = pol.ux !== this.prevUx || pol.uy !== this.prevUy ? 1 : 0;
      const grazeReward = r.tHit > A.graceGrazeSlack ? r.grazeFrames : 0;
      const hint = hintFor(view.phaseId).cost(view, r.endX, r.endY);
      return A.weightAnchor * anchor + A.weightFlip * flip - A.weightGraze * grazeReward * 0.1 + A.weightHint * hint;
    }
    evalPolicy(view, ux, uy, focus, second, frames) {
      return this.sharedValid ? this.evalShared(view, ux, uy, second, frames, 0) : this.evalFull(view, ux, uy, focus, second, frames);
    }
    // —— shared：弹轨与自机无关，模拟一次存快照（全长 H2，战术/战略共用）——
    buildSharedTrack(view) {
      const reach = (P.speedFast + BULLET_MAX_SPEED) * H2 + 40;
      clonePoolInto(this.scratch, view.pool, view.playerX, view.playerY, reach);
      const pool = this.scratch;
      const pattern = view.inCombat ? patternFor(view.phaseId) : null;
      const pstate = view.patternState ? Object.assign({}, view.patternState) : null;
      this.rng.seed = view.rngSeed;
      const rng = this.rng;
      const cap = CFG.bullets.cap;
      this.trackOriginFrame = view.frame;
      const ctx = {
        rng,
        frame: 0,
        playerX: view.playerX,
        playerY: view.playerY,
        bossX: 0,
        bossY: 0,
        spawn: (s) => spawnBullet(pool, s)
      };
      for (let t = 1; t <= H2; t++) {
        if (pattern && pstate) {
          const bpos = bossDriftPos(view.phaseId, view.frame + t);
          ctx.frame = view.patternFrame + t - 1;
          ctx.bossX = bpos.x;
          ctx.bossY = bpos.y;
          pattern.step(pstate, ctx);
        }
        stepBullets(pool, rng);
        const base = (t - 1) * cap;
        const n = pool.n;
        this.snapN[t - 1] = n;
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
    evalShared(view, ux, uy, second, frames, snapOffset) {
      let px = view.playerX, py = view.playerY;
      let tHit = frames, grazeFrames = 0, minGap = Infinity;
      const branchAt = CFG.ai.branchAt;
      const cap = CFG.bullets.cap;
      const F = CFG.playfield;
      const gp = P.grazePad;
      for (let t = 1; t <= frames; t++) {
        let mx = ux, my = uy;
        if (second && t > branchAt) {
          mx = second.ux;
          my = second.uy;
        }
        px = Math.min(F.maxX, Math.max(F.minX, px + mx));
        py = Math.min(F.maxY, Math.max(F.minY, py + my));
        const margin = t > CFG.ai.safeMarginBase ? (t - CFG.ai.safeMarginBase) * CFG.ai.safeMarginRate : 0;
        const pr = P.hitboxR + margin;
        const base = (snapOffset + t - 1) * cap;
        let gapLeft = -Infinity, gapRight = Infinity;
        let hit = false;
        const vulnerable = t > view.invuln;
        const pcx = Math.min(GRID_COLS - 1, Math.max(0, (px - GRID_X0) / CELL | 0));
        const pcy = Math.min(GRID_ROWS - 1, Math.max(0, (py - GRID_Y0) / CELL | 0));
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
                if (adx <= rr && ady <= rr && dx * dx + dy * dy <= rr * rr) {
                  hit = true;
                  break;
                }
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
        if (hit) {
          tHit = t;
          break;
        }
      }
      evalOut.tHit = tHit;
      evalOut.grazeFrames = grazeFrames;
      evalOut.endX = px;
      evalOut.endY = py;
      evalOut.minGap = minGap;
      return evalOut;
    }
    // —— full：自机狙段逐候选全量模拟 ——
    evalFull(view, ux, uy, focus, second, frames) {
      const reach = (P.speedFast + BULLET_MAX_SPEED) * frames + 40;
      clonePoolInto(this.scratch, view.pool, view.playerX, view.playerY, reach);
      const pool = this.scratch;
      const pattern = view.inCombat ? patternFor(view.phaseId) : null;
      const pstate = view.patternState ? Object.assign({}, view.patternState) : null;
      this.rng.seed = view.rngSeed;
      const rng = this.rng;
      void focus;
      let px = view.playerX, py = view.playerY;
      let tHit = frames, grazeFrames = 0, minGap = Infinity;
      const branchAt = CFG.ai.branchAt;
      const F = CFG.playfield;
      const gp = P.grazePad;
      const ctx = {
        rng,
        frame: 0,
        playerX: px,
        playerY: py,
        bossX: 0,
        bossY: 0,
        spawn: (s) => spawnBullet(pool, s)
      };
      for (let t = 1; t <= frames; t++) {
        let mx = ux, my = uy;
        if (second && t > branchAt) {
          mx = second.ux;
          my = second.uy;
        }
        px = Math.min(F.maxX, Math.max(F.minX, px + mx));
        py = Math.min(F.maxY, Math.max(F.minY, py + my));
        if (pattern && pstate) {
          const bpos = bossDriftPos(view.phaseId, view.frame + t);
          ctx.frame = view.patternFrame + t - 1;
          ctx.playerX = px;
          ctx.playerY = py;
          ctx.bossX = bpos.x;
          ctx.bossY = bpos.y;
          pattern.step(pstate, ctx);
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
            if (adx <= rr && ady <= rr && dx * dx + dy * dy <= rr * rr) {
              hit = true;
              break;
            }
            const rg = hb + gp;
            if (adx <= rg && ady <= rg && pool.grazed[i] === 0) {
              pool.grazed[i] = 1;
              grazeFrames += 1;
            }
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
        if (hit) {
          tHit = t;
          break;
        }
      }
      evalOut.tHit = tHit;
      evalOut.grazeFrames = grazeFrames;
      evalOut.endX = px;
      evalOut.endY = py;
      evalOut.minGap = minGap;
      return evalOut;
    }
  };

  // src/rotns/ai/humanizer.ts
  var FAST = CFG.player.speedFast;
  var FAST_D = FAST * CFG.player.diagScale;
  var SLOW = CFG.player.speedSlow;
  var SLOW_D = SLOW * CFG.player.diagScale;
  var Humanizer = class {
    constructor(aiSeed) {
      this.delayRing = [];
      this.ringIdx = 0;
      this.stickCounter = 0;
      this.last = { ux: 0, uy: 0, focus: false };
      this.breathePhase = 0;
      this.rng = new Rng(aiSeed);
      for (let i = 0; i < CFG.ai.delayBuffer; i++) {
        this.delayRing.push({ ux: 0, uy: 0, focus: false });
      }
    }
    filter(plan, view, validate) {
      const A = CFG.ai;
      const raw = { ux: plan.ux, uy: plan.uy, focus: plan.focus };
      if (plan.tHit < A.horizon) {
        this.pushRing(raw);
        this.last = raw;
        return plan;
      }
      let out = { ...raw };
      if (hintFor(view.phaseId).preferFocus) out.focus = true;
      if (!view.inCombat) {
        const cx = 192;
        if (Math.abs(view.playerX - cx) > 24) {
          out = { ux: Math.sign(cx - view.playerX) * FAST, uy: 0, focus: false };
        } else {
          out = this.breathePhase % 48 < 24 ? { ux: SLOW, uy: 0, focus: true } : { ux: -SLOW, uy: 0, focus: true };
        }
        this.breathePhase += 1;
        this.pushRing(out);
        this.last = out;
        return this.toPlan(plan, out, validate);
      }
      if (plan.tHit < A.bypassBelow) {
        this.pushRing(raw);
        this.last = raw;
        return plan;
      }
      const delayed = this.pushRing(out);
      out = { ...delayed };
      const changed = out.ux !== this.last.ux || out.uy !== this.last.uy || out.focus !== this.last.focus;
      if (changed && this.stickCounter > 0) {
        out = { ...this.last };
      }
      this.stickCounter = changed ? A.stickFrames : Math.max(0, this.stickCounter - 1);
      if (plan.tHit > A.breatheSlack && out.ux === 0 && out.uy === 0) {
        this.breathePhase += 1;
        out = this.breathePhase % 48 < 24 ? { ux: SLOW, uy: 0, focus: true } : { ux: -SLOW, uy: 0, focus: true };
      }
      if (plan.tHit > A.graceGrazeSlack && this.rng.f() < 0.03) {
        if (out.ux === 0 && out.uy === 0) {
          out = { ux: this.rng.f() < 0.5 ? SLOW : -SLOW, uy: 0, focus: true };
        } else if (out.uy === 0 && out.ux !== 0) {
          out = {
            ux: Math.sign(out.ux) * SLOW_D,
            uy: this.rng.f() < 0.5 ? SLOW_D : -SLOW_D,
            focus: true
          };
        }
      }
      this.last = out;
      return this.toPlan(plan, out, validate);
    }
    // 安全红线：修饰后输出过 validator，安全性下降则回退原始计划
    toPlan(plan, out, validate) {
      const tHit = validate(out.ux, out.uy, out.focus);
      if (tHit < plan.tHit) return plan;
      return { ...plan, ux: out.ux, uy: out.uy, focus: out.focus };
    }
    // 写入最新，返回最旧（delayBuffer 帧前的动作）
    pushRing(m) {
      this.ringIdx = (this.ringIdx + 1) % this.delayRing.length;
      const oldest = this.delayRing[this.ringIdx];
      this.delayRing[this.ringIdx] = { ...m };
      return oldest;
    }
  };

  // src/rotns/ai/controller.ts
  var AiController = class {
    constructor(aiSeed = 7) {
      this.enabled = false;
      this.planner = new Planner();
      this.replanCounter = 0;
      this.bombDelay = 0;
      this.lastMove = { ux: 0, uy: 0, focus: false };
      this.lastPlanTHit = -1;
      // 调试观测：最近计划的 tHit
      this.lastPlanRaw = null;
      this.lastExecMove = "";
      // 调试观测：最近被执行动作 (ux,uy,focus)
      this.heldSet = /* @__PURE__ */ new Set();
      this.pressedSet = /* @__PURE__ */ new Set();
      this.frameState = { held: this.heldSet, pressed: this.pressedSet };
      this.humanizer = new Humanizer(aiSeed);
    }
    // 每帧调用；返回拟人化后的按键集合。
    frame(view) {
      this.heldSet.clear();
      this.pressedSet.clear();
      if (!view.playerAlive) return this.frameState;
      this.replanCounter -= 1;
      let hyper = false;
      if (this.replanCounter <= 0) {
        this.replanCounter = this.lastPlanTHit >= 0 && this.lastPlanTHit < 16 ? 1 : CFG.ai.replanEvery;
        const raw = this.planner.decide(view);
        this.lastPlanTHit = raw.tHit;
        this.lastPlanRaw = raw;
        const plan = this.humanizer.filter(raw, view, (ux, uy, focus) => this.planner.validate(view, ux, uy, focus));
        this.lastMove = { ux: plan.ux, uy: plan.uy, focus: plan.focus };
        this.lastExecMove = `${plan.ux.toFixed(2)},${plan.uy.toFixed(2)},${plan.focus ? 1 : 0}`;
        if (plan.hyper) hyper = true;
        if (plan.bomb && this.bombDelay <= 0) {
          this.bombDelay = raw.tHit < 8 ? 1 : CFG.ai.bombHumanDelay;
        }
      } else if (view.bombs > 0 && view.invuln <= 0) {
        const m2 = this.lastMove;
        const tHit = this.planner.validate(view, m2.ux, m2.uy, m2.focus);
        if (tHit < 8) this.pressedSet.add("bomb");
      }
      const m = this.lastMove;
      if (m.ux < -0.01) this.heldSet.add("left");
      if (m.ux > 0.01) this.heldSet.add("right");
      if (m.uy < -0.01) this.heldSet.add("up");
      if (m.uy > 0.01) this.heldSet.add("down");
      if (m.focus) this.heldSet.add("focus");
      this.heldSet.add("shoot");
      if (hyper) this.pressedSet.add("hyper");
      if (this.bombDelay > 0) {
        this.bombDelay -= 1;
        if (this.bombDelay === 0) this.pressedSet.add("bomb");
      }
      return this.frameState;
    }
  };

  // src/main.ts
  var BrowserInputSource = class {
    constructor(ai) {
      this.ai = ai;
      this.scene = null;
      this.snapshot = { held: /* @__PURE__ */ new Set(), pressed: /* @__PURE__ */ new Set() };
    }
    attach(scene) {
      this.scene = scene;
    }
    frame() {
      if (this.ai.enabled && this.scene) {
        return this.ai.frame(this.scene.aiView());
      }
      return this.snapshot;
    }
  };
  var GameRoot = class {
    constructor(renderer, input, audio, source, ai) {
      this.renderer = renderer;
      this.input = input;
      this.audio = audio;
      this.source = source;
      this.ai = ai;
      this.mode = "title";
      this.title = new TitleScene();
      this.scene = null;
      this.paused = false;
      this.assetsReady = false;
      this.seed = 5415;
      this.restartCount = 0;
      const params = new URLSearchParams(location.search);
      const seedParam = params.get("seed");
      if (seedParam) this.seed = parseInt(seedParam, 10) & 65535 || 5415;
      if (params.get("ai") === "1") {
        this.startFight(true);
      }
    }
    startFight(autoplay) {
      this.ai.enabled = autoplay;
      const scene = new RotnsScene({
        input: this.source,
        events: this.audio,
        seed: this.seed + this.restartCount & 65535,
        fx: true
      });
      scene.aiEnabled = autoplay;
      this.source.attach(scene);
      this.scene = scene;
      this.mode = "fight";
      this.paused = false;
      this.audio.bgm("boss");
    }
    update() {
      const frame = this.input.frame();
      this.source.snapshot = frame;
      if (this.mode === "title") {
        const choice = this.title.update(frame);
        if (choice?.start) this.startFight(choice.autoplay);
        return;
      }
      const scene = this.scene;
      scene.aiEnabled = this.ai.enabled;
      if (scene.done) {
        if (frame.pressed.has("confirm")) {
          if (scene.result.mode === "clear") {
            this.mode = "title";
            this.scene = null;
            this.audio.bgm(null);
          } else {
            this.restartCount += 1;
            this.startFight(this.ai.enabled);
          }
        }
        return;
      }
      if (frame.pressed.has("pause")) this.paused = !this.paused;
      if (this.paused) return;
      scene.update();
    }
    draw() {
      if (this.mode === "title" || !this.scene) {
        this.title.draw(this.renderer);
        return;
      }
      this.scene.draw(this.renderer, this.assetsReady);
      if (this.paused) {
        this.renderer.ctx.fillStyle = "rgba(4, 2, 10, 0.6)";
        this.renderer.ctx.fillRect(0, 0, 640, 480);
        this.renderer.text("PAUSED", 320, 220, { size: 28, color: "#d8c8f0", align: "center", font: "monospace" });
      }
      this.renderer.present();
    }
    setAssetsReady() {
      this.assetsReady = true;
    }
    get fighting() {
      return this.mode === "fight";
    }
    restart() {
      if (this.mode !== "fight") return;
      this.restartCount += 1;
      this.startFight(this.ai.enabled);
    }
  };
  function boot() {
    const canvas = document.getElementById("game");
    if (!canvas) throw new Error("canvas#game not found");
    const renderer = new Renderer(canvas);
    installPlaceholders(renderer);
    const input = new Input();
    const audio = new AudioSynth();
    const ai = new AiController(7);
    const source = new BrowserInputSource(ai);
    const root = new GameRoot(renderer, input, audio, source, ai);
    addEventListener("keydown", () => audio.unlock(), { once: false });
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "KeyA") {
        ai.enabled = !ai.enabled;
        if (!ai.enabled) input.clearInjected();
      } else if (e.code === "KeyR") {
        root.restart();
      } else if (e.code === "KeyM") {
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
})();
//# sourceMappingURL=rotns.js.map
