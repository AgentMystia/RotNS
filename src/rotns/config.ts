// 全部魔法数字集中地（PLAN §4/§5 数值表逐条落位）。
// 调参协议：只许向原型参考视频拟合，不许为"让人打得过"降密度。

export const CFG = {
  playfield: { w: 384, h: 448, minX: 8, maxX: 376, minY: 16, maxY: 432 },

  player: {
    spawnX: 192, spawnY: 400,
    speedFast: 4.5, speedSlow: 2.0, diagScale: 0.7071,
    hitboxR: 2.0,
    grazePad: 20,               // graze 盒 = 弹判定 + 20
    lives: 3,
    respawnDelay: 60,           // 被弹爆散后多少帧原地复活
    respawnInvuln: 240,
    hitstop: 8,                 // 被弹全局静止帧
    // 主射：双列羽弹
    mainShot: { interval: 3, dmg: 8, speed: 12, offsetX: 6, sprite: 'shot' },
    // 高速 4 子机：瞄准 Boss 的音波弹扇（扇心=Boss 方位，窄散布保证中距命中；
    // 视觉仍为四列扇形。±0.05/±0.11 rad：300px 处内两束必中、外两束近失）
    optFast: {
      interval: 6, dmg: 5, speed: 10,
      offsets: [[-36, 4], [-20, -8], [20, -8], [36, 4]] as const,
      angles: [-0.11, -0.05, 0.05, 0.11] as const,
    },
    // 低速 4 子机：收拢平行前射（点烧）
    optSlow: {
      interval: 4, dmg: 6, speed: 12,
      offsets: [[-22, -2], [-10, -4], [10, -4], [22, -2]] as const,
    },
    shotPoolCap: 96,
    shotLife: 60,               // 弹顶出屏余量
  },

  hyper: {
    max: 10000,
    gainGraze: 100,
    gainHitPerFrame: 20,        // 自机弹每命中帧（蓄力循环；§6.6 授权迭代 +10% 档）
    gainPhaseClear: 2500,
    duration: 720,              // 12s，量表匀速流干
    invulnOnCast: 60,
    firepowerMul: 2.5,
    spreadMul: 1.5,             // 子机散布角 +50%
    shakeFrames: 6,
  },

  bomb: {
    stock: 3, cap: 3,
    expandFrames: 24, radiusMax: 460,
    invuln: 180,
    bossDamageRaw: 3000, bossResist: 0.10,  // → 300，蜂系 Bomb 无效化再现
    lockFrames: 180,            // 期间不可再 Bomb
    starScore: 100,
  },

  score: {
    graze: 500,
    hyperStar: 1000,
    phaseClearBase: 5_000_000,  // ×剩余残机系数
    allClearBonus: 100_000_000,
  },

  boss: {
    cx: 192, cy: 112,
    driftXAmp: 16, driftXPeriod: 240,
    driftYAmp: 8, driftYPeriod: 300,
    totalHp: 142_000,
    contactHitbox: 24,
    introBlackFrames: 30,
    warningFrames: 90,
    hpChargeFrames: 60,
    spellDeclareFrames: 90,     // 转段符卡宣言演出 1.5s
    rankOmegaScale: 0,          // 预留：Rank→发狂Ω增幅（默认 0 = 不做 Rank）
  },

  phases: [
    { id: 'p1', name: '蝶符「亡我流・回旋针雨」', hp: 20000, timeLimit: 45 * 60 },
    { id: 'p2', name: '樱符「散华・裂变墨染」', hp: 20000, timeLimit: 45 * 60 },
    { id: 'p3', name: '死符「幽明重圏」', hp: 20000, timeLimit: 45 * 60 },
    { id: 'p4', name: '死蝶「终焉加速」', hp: 16000, timeLimit: 40 * 60 },
    { id: 'finale', name: '反魂「墨染の洗濯機 〜 葬送二重奏」', hp: 66000, timeLimit: 0 }, // 无时限
  ],

  // —— P1 旋转针弹涡 ——
  p1: {
    emitterA: { interval: 3, ways: 6, dTheta: 0.11, speedLo: 3.4, speedHi: 4.6, waveFrames: 300 },
    emitterB: { interval: 3, ways: 6, dTheta: -0.13, speed: 4.0 },
    ring: { interval: 45, ways: 32, speed: 2.8 },
  },

  // —— P2 裂变弹 ——
  p2: {
    mother: { interval: 20, ways: 8, aimArcDeg: 30, speed: 2.2, fuse: 40 },
    split: { count: 14, speed: 3.0, momentum: 0.30, butterflyRatio: 0.25 },
    press: { interval: 6, ways: 3, speed: 5.0 },
  },

  // —— P3 密环+自机狙 ——
  p3: {
    ring: { interval: 30, ways: 48, speed: 2.0, jitterDeg: 0.5, dBaseDeg: 3.75 },
    aim: { interval: 10, ways: 5, speed: 4.2, fanDeg: 24 },
  },

  // —— P4 加速环 ——
  p4: {
    ways: 40,
    intervalStart: 26, intervalEnd: 12, rampFrames: 20 * 60,
    speed0: 1.6, accel: 0.02, speedMax: 5.2,
    baseJitterDeg: 7,
    hyperHintInterval: 14,      // 低于此值进入设计上的 Hyper 脱出窗口
  },

  // —— 发狂 洗衣机 ——
  finale: {
    options: {
      count: 6, radius: 56, omega: 0.034,
      interval: 4, speedFast: 6.0, speedSlow: 3.4,
    },
    redRing: { interval: 30, ways: 16, speed: 4.0, dBase: 0.12 },
    fugu: { interval: 90, fans: 3, petalsPerFan: 24, speed: 2.4, fanDeg: 60 },
    gamble: { everyVolleys: 32, wFlip: 3, wJump: 3, wNone: 4, phaseJump: 0.35 },
  },

  bullets: {
    cap: 2400,
    cullMargin: 40,
    // sprite 表：判定半径/贴图 key/混合（索引即 pool.sprite 的值）
    sprites: [
      { key: 'needle_pink', w: 10, h: 26, hitbox: 3, blend: 'lighter' },
      { key: 'needle_blue', w: 10, h: 26, hitbox: 3, blend: 'lighter' },
      { key: 'needle_red', w: 10, h: 26, hitbox: 3, blend: 'lighter' },
      { key: 'ball_s_pink', w: 16, h: 16, hitbox: 4, blend: 'lighter' },
      { key: 'ball_s_blue', w: 16, h: 16, hitbox: 4, blend: 'lighter' },
      { key: 'ball_l_blue', w: 28, h: 28, hitbox: 8, blend: 'lighter' },
      { key: 'blt_petal', w: 22, h: 22, hitbox: 5, blend: 'lighter', alpha: 0.65 },
      { key: 'blt_butterfly', w: 24, h: 24, hitbox: 3, blend: 'lighter' },
    ] as const,
  },

  ai: {
    horizon: 42,
    replanEvery: 2,
    branchAt: 12,
    hysteresisMargin: 4,
    anchorBandY: [392, 420] as const,
    anchorBossXPad: 40,
    weightAnchor: 1.0,
    weightFlip: 0.5,
    weightGraze: 0.35,
    weightHint: 0.8,
    safeMarginBase: 20,         // 此帧后碰撞半径逐帧 +0.1
    safeMarginRate: 0.1,
    graceGrazeSlack: 12,        // 安全冗余>12f 时奖励近距擦弹
    panicThreshold: 10,         // 全候选 t_hit < 10f → 资源决策
    delayBuffer: 3,             // humanizer 反应延迟（帧）
    bypassBelow: 8,             // t_hit<8f 旁路延迟
    stickFrames: 4,             // 方向变更最小间隔
    breatheAmp: 3,              // 安全时呼吸摆动幅度
    breatheSlack: 30,
    noiseSigma: 0.7,
    gambleGapPx: 18,            // 发狂缝隙阈值 → Hyper
    gambleLookahead: 90,
    bombPanicCooldown: 240,
    bombHumanDelay: 2,
    p4BulletCountHint: 120,   // interval<14 且屏弹>此值 → Hyper 脱出窗口
    reachPad: 120,              // 可达域剪枝余量
    perfBudgetMs: 6,
  },
};

export type PhaseId = 'p1' | 'p2' | 'p3' | 'p4' | 'finale';
