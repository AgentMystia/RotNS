# 东方阴蝶梦 ～ Requiem of the Night Sparrow

**夜雀 米斯蒂娅·萝蕾拉 × 亡灵公主 西行寺幽幽子 的同人单面弹幕 STG** —— 开场即 Boss 战的五段式传说级弹幕（无时限终段），附可优雅自动通关的 **AutoplayAI**。

基于 [th07_web](https://github.com/AgentMystia/th07_web) 引擎精简改造（TypeScript / esbuild 静态构建 / Canvas2D / 固定 60FPS / 可播种 RNG）。**全部图片素材由 gpt-image-2 生成，音频为 WebAudio 程序合成，零版权文件，可独立分发。**

BOSS 的真身与出处，请亲自打到终段体会 —— 懂的都懂。:)

## 运行

```bash
npm ci
npm run build      # → dist/rotns.js
npm run dev        # watch + 本地静态服务（默认 http://localhost:8000）
```

浏览器打开 `index.html`（经 dev 服务）即可。URL 参数：`?ai=1` 跳过标题直接 AI 开局；`?seed=N` 指定种子。

## 操作

| 键 | 功能 |
|---|---|
| 方向键 | 移动 |
| Z / Enter | 射击（按住连发）· 决定 |
| Shift | 低速移动（显示判定点） |
| **X** | **Bomb**（街机式：当帧生效·全屏消弹化星·180f 无敌·对 Boss 强抗性·无 deathbomb） |
| **C** | **Hyper**（量表满时：瞬间全屏消弹化星+60f 无敌，12s 火力 ×2.5；与 Bomb 互斥） |
| **A** | **FlameTN7代打 ON/OFF**（默认关闭，可随时切换） |
| R | 立即重开 |
| M | 静音 |
| Esc | 暂停 |

残机 3，无 extend。擦弹与自机弹命中可积攒 Hyper 量表。

## BOSS：五段葬送曲（4 段通常战 + 无时限终段）

| 段 | 符卡 | 构成 |
|---|---|---|
| P1 | 蝶符「亡我流・回旋针雨」 | 双向旋转针弹涡（螺旋泳道） |
| P2 | 樱符「散华・裂变墨染」 | 裂变母弹 + 高速自机狙 |
| P3 | 死符「幽明重圏」 | 高密度环幕 + 自机狙叠加 |
| P4 | 死蝶「终焉加速」 | 间隔渐短、弹速渐快的加速环 |
| 终段 | 反魂「墨染の洗濯機 〜 葬送二重奏」 | 旋转炮台快慢双层条带 + 红弹环 + 花瓣薄片扇 + 受控随机相位，**无时限** |

弹幕几何/密度/速度按传说级街机基准换算，未为可玩性削弱。人类几乎不可能通关 —— 多用 AUTOPLAY 观赏。

## AutoplayAI（界面显示名：FlameTN7代打）

默认**关闭**，按 **A** 随时切换。

- **全保真前瞻**：克隆弹池（typed array 可达域剪枝）+ Pattern 状态（POJO）+ RNG，精确推演 42f（战术）/120f（战略，防"追缝入角"陷阱）；
- **分层搜索**：17 恒定策略 + t=12f 分叉 + 生存分层（"足够安全"时软代价接管，避免安全但零输出的角落瘫痪）；
- **拟人层**：反应延迟 / 动作黏性 / 呼吸摆动 / 背版式路线先验（hints），所有修饰经同源前瞻安全校验后才出手；
- **资源策略**：Hyper 主动输出窗（贴脸爆发）+ 缝隙过窄防御清屏 + Bomb 拟人化延迟（真急救当帧）；
- 整局可复现（场景/AI 均播种）。

### 基准（`npm run ai:bench`，headless ×30+ 实时）

验收线：30 seed 通关率 ≥85%、≥1 局 no-miss、AI 决策 p95 <6ms。
**当前成绩：通关率 90.0%（27/30）、no-miss 9 局、p95 1.13ms、确定性校验 OK。**

## 素材管线（scripts/ + assets/rotns-img/）

- 生成：`image_gen.py`（gpt-image-2），角色以原作立绘为风格锚（edit 参考图），弹形以原作图集为参考；
- 后处理：`scripts/rotns_postprocess.py`（chroma 抠绿 despill / additive 黑底 / 白弹母图预染色 / LANCZOS 缩放）→ `assets/rotns-img/`；
- 质检：`scripts/rotns_contact_sheet.py` 拼板；`tools/render-frames.mjs` 真实渲染游戏帧（node-canvas）验证游戏内观感；
- 原始生成图（v1 编号、不覆盖）存档于本地 `output/imagegen/`，不随仓库分发。

## 致谢

- 引擎：[AgentMystia/th07_web](https://github.com/AgentMystia/th07_web)（东方妖妖梦 Web 复刻）
- 原作：上海爱丽丝幻乐团《东方妖妖梦》《东方永夜抄》
- 以及某部传说级街机弹幕游戏 —— 向 12 年后摘取胜利的那位玩家致敬。
- 本作为非商业同人衍生，素材全部由 gpt-image-2 原创生成。

## 开发

```bash
npm run check      # tsc 类型检查
npm run build      # esbuild → dist/rotns.js
npm run ai:bench   # AI 通关率基准（30 seed）
npm run smoke      # 启动冒烟（DOM 桩）
npm run render -- title|warning|fight|declare|finale|clear [prefix]  # 渲染游戏帧到 tmp/frames/
```
