// WebAudio 程序合成（PLAN §7）：零音频文件。
// 全局 AudioContext + 主压缩器防爆音；首次按键后 resume；M 静音。
// BGM 为原创短动机（「幽雅に咲かせ」致敬但不引用原旋律）。

type SfxName =
  | 'shot' | 'graze' | 'enemyHit' | 'bomb' | 'hyper' | 'cancelStar'
  | 'death' | 'warning' | 'spellDeclare' | 'phaseBreak';

export class AudioSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private bgmGain: GainNode | null = null;
  private muted = false;
  private lastShot = 0;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private track: 'boss' | 'finale' | null = null;
  private nextNoteTime = 0;
  private beat = 0;

  // 用户首次按键后调用（浏览器自动播放策略）
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
    return this.muted;
  }

  private tone(opts: {
    type: OscillatorType; f0: number; f1?: number; dur: number; vol: number;
    when?: number; dest?: GainNode;
  }): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = opts.when ?? this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t + opts.dur);
    g.gain.setValueAtTime(opts.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    osc.connect(g);
    g.connect(opts.dest ?? this.master);
    osc.start(t);
    osc.stop(t + opts.dur + 0.02);
  }

  private noise(opts: { dur: number; vol: number; hp?: number; lp?: number; when?: number }): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = opts.when ?? this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * opts.dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    let node: AudioNode = src;
    if (opts.hp) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = opts.hp;
      node.connect(f); node = f;
    }
    if (opts.lp) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = opts.lp;
      node.connect(f); node = f;
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(opts.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    node.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  sfx(name: string): void {
    if (!this.ctx || this.muted) return;
    switch (name as SfxName) {
      case 'shot': {
        // 每 6f 限流
        const now = this.ctx.currentTime;
        if (now - this.lastShot < 0.09) return;
        this.lastShot = now;
        this.tone({ type: 'triangle', f0: 1200, f1: 800, dur: 0.05, vol: 0.05 });
        break;
      }
      case 'graze':
        this.noise({ dur: 0.03, vol: 0.06, hp: 8000 });
        break;
      case 'enemyHit':
        this.tone({ type: 'square', f0: 200, dur: 0.04, vol: 0.05 });
        break;
      case 'bomb':
        this.noise({ dur: 0.8, vol: 0.3, lp: 4000 });
        this.tone({ type: 'sine', f0: 80, f1: 40, dur: 0.8, vol: 0.35 });
        break;
      case 'hyper':
        this.tone({ type: 'sawtooth', f0: 300, f1: 1800, dur: 0.3, vol: 0.18 });
        this.tone({ type: 'triangle', f0: 600, dur: 0.4, vol: 0.1 });
        this.tone({ type: 'triangle', f0: 900, dur: 0.4, vol: 0.08 });
        break;
      case 'cancelStar':
        this.tone({ type: 'sine', f0: 1800 + (Math.random() - 0.5) * 400, dur: 0.06, vol: 0.04 });
        break;
      case 'death':
        this.tone({ type: 'sawtooth', f0: 800, f1: 60, dur: 0.5, vol: 0.25 });
        this.noise({ dur: 0.4, vol: 0.2, lp: 2000 });
        break;
      case 'warning': {
        for (let i = 0; i < 4; i++) {
          this.tone({ type: 'square', f0: i % 2 === 0 ? 700 : 500, dur: 0.18, vol: 0.16, when: this.ctx.currentTime + i * 0.22 });
        }
        break;
      }
      case 'spellDeclare':
        // 钟音 FM 近似：载波+泛音
        this.tone({ type: 'sine', f0: 880, dur: 0.6, vol: 0.14 });
        this.tone({ type: 'sine', f0: 880 * 2.76, dur: 0.4, vol: 0.05 });
        break;
      case 'phaseBreak':
        this.noise({ dur: 0.5, vol: 0.2, lp: 5000 });
        this.tone({ type: 'sine', f0: 660, dur: 0.15, vol: 0.12 });
        this.tone({ type: 'sine', f0: 880, dur: 0.15, vol: 0.12, when: this.ctx.currentTime + 0.1 });
        this.tone({ type: 'sine', f0: 1100, dur: 0.2, vol: 0.12, when: this.ctx.currentTime + 0.2 });
        break;
    }
  }

  // —— BGM：16 小节循环调度器（lookahead 0.1s）——
  // A 段：Bm 小调分解和弦贝斯 + 八分琶音，BPM 152；B 段（发狂）：半音上移 + 鼓组。
  bgm(track: 'boss' | 'finale' | null): void {
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

  private schedule(): void {
    if (!this.ctx || !this.track) return;
    const spb = 60 / 152 / 2; // 八分音符
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.scheduleBeat(this.beat, this.nextNoteTime, spb);
      this.nextNoteTime += spb;
      this.beat = (this.beat + 1) % (16 * 8);
    }
  }

  private scheduleBeat(beat: number, t: number, spb: number): void {
    if (this.muted || !this.bgmGain) return;
    const finale = this.track === 'finale';
    const shift = finale ? 1 : 0; // 半音上移
    // Bm 进行：Bm - G - D - A（每 4 小节换）
    const roots = [59, 55, 50, 57]; // B3 G3 D3 A3 (MIDI)
    const root = roots[Math.floor(beat / 32) % 4] + shift;
    const toHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    // 贝斯：每拍根音（方波 −18dB ≈ 0.126）
    if (beat % 2 === 0) {
      this.tone({ type: 'square', f0: toHz(root - 24), dur: spb * 0.9, vol: 0.10, when: t, dest: this.bgmGain });
    }
    // 琶音：八分 1-3-5-8 分解（三角波）
    const arpNotes = [0, 3, 7, 12, 7, 3];
    const arp = arpNotes[beat % arpNotes.length];
    this.tone({ type: 'triangle', f0: toHz(root + arp), dur: spb * 0.8, vol: 0.06, when: t, dest: this.bgmGain });
    // B 段鼓组：噪声 kick/hat
    if (finale) {
      if (beat % 4 === 0) this.noise({ dur: 0.08, vol: 0.16, lp: 300, when: t });
      if (beat % 2 === 1) this.noise({ dur: 0.03, vol: 0.05, hp: 9000, when: t });
    }
    void spb;
  }
}
