# 桌体 GLB（dormdesk.glb → dorm_desk_body.glb）接入说明

> 状态（2026-10-17，0.9.0）：资产已入仓库并接入运行时（三维工作台 / 方案对比页 / 空间配置三维预览；预览另叠加书架搁板 / 出线孔 / 插座实时标记）。
> 加载失败 / 主动跳过时回退参数化桌体（ParametricDesk）并给出可恢复提示；未伪造模型内容。
>
> 上一版本文档描述的「资产缺失、待接入」状态已结束，本文件按当前实测更新。

## 1. 资产与放置

- **源资产**：`Prefabmodel/dormdesk.glb`（Blender 源 `objects/dormdesk.blend`；整组「上床下桌」家具：
  床架 / 上层四格书架 / L 形桌面（主桌 + 回台）/ 三抽屉侧柜 / 衣柜 / 护栏 / 爬梯 / 四立柱）。
- **运行时副本**：`frontend/public/models/dorm_desk_body.glb` 与 `dorm_desk_drawer_{bottom,middle,top}.glb`
  （Vite `public/` 原样复制：开发 `/models/...`、生产 `dist/models/...`；`resolvePublicAssetUrl()` 兼容子路径部署）。
- 更新资产的流程：从 `Prefabmodel/` 复制到 `frontend/public/models/`，然后运行
  `npx tsx scripts/check-desk-model.ts` 校验命名与尺寸契约是否仍然成立；
  如导出规格有变，同步调整 `scene/deskModel.ts` 的配置与本文件。
- 目录分工：`objects/` 只放 Blender / OBJ **源文件**；`Prefabmodel/` 为 GLB **归档**（低模关键词路由、Rodin 高模 `_detail` 共存）；
  只有 `frontend/public/` 下的副本能被运行时加载。

### 1.1 拆分版资产（无抽屉桌体 + 独立抽屉）

`Prefabmodel/dormdesk_parts/` 的拆分资产已用于运行时，支持抽屉推拉：

| 资产 | 源文件 | 网格数 |
| --- | --- | --- |
| 无抽屉桌体 | `Prefabmodel/dormdesk_parts/dormdesk_body.glb` | 46 |
| 底抽屉 | `Prefabmodel/dormdesk_parts/drawer_bottom.glb` | 9 |
| 中抽屉 | `Prefabmodel/dormdesk_parts/drawer_middle.glb` | 9 |
| 顶抽屉（含锁） | `Prefabmodel/dormdesk_parts/drawer_top.glb` | 11 |

每次抽屉均带同目录 `*.collision.json` 碰撞体（箱壳按底板 + 四壁拆分以保留内腔）。

**运行时装配：桌体和三只抽屉共用变换矩阵。**

- 抽屉与桌体**共用同一装配原点**，抽屉是独立的绝对坐标文件，加载器必须显式施加共同变换。
- `dormdesk_body.glb` 实测 `x` 最小与 `y` 最小均为 **0**，已符合数据契约第 1 节原点。
- 当前展示保留 `centerXZ: true`、`backWallZ: 0` 与 `verticalAlign: 'deskTop'`；`DormDeskModel` 将桌体归一化矩阵同时施加到三只抽屉。不得只移动桌体，或分别按包围盒居中抽屉。
- 源资产相对坐标不变。共同展示变换不表示真实家具碰撞、支撑面与后端坐标已接通。

抽屉的抽拉轴与行程实测：**抽出方向 -x**（面板位于 x 最小侧，滑轨沿 x 延伸），
滑轨长 304 mm，当前交互行程 300 mm，由资产与运动学脚本检查。部件名与抽屉初始 bounds 见
`Prefabmodel/dormdesk_parts/drawers.manifest.json`。
完整约定见 `docs/data_contract.md` 第 1.1 节。

## 2. 模型约定与实测（当前 dormdesk.glb）

| 项目 | 约定 / 实测 | 当前模型 |
| --- | --- | --- |
| 单位 | 米制（glTF 规范） | ✅ 1:1 米制；无需 `unitScale` |
| 朝向 | Y-up，正面朝 +z（后墙 z=0，房间向 +z 展开） | ✅ 无需 `axisRotationY` |
| 原点 | 任意（自动归一化） | 原始包围盒 x[0,2] y[0,2.25] z[-0.9,0.31]；整体 **2.0 × 2.25 × 1.21 m** |
| 桌面标称高度 | 与配置一致性由对齐处理 | `Desk_Top_Main` / `Desk_Top_L_Return` 实测顶面 0.77 m |
| 命名节点 | 契约见 `scripts/check-desk-model.ts`（23 个必需节点） | `Desk_*` / `Bookshelf_*` / `Cabinet_Drawer_{Bot,Mid,Top}_*`（盒体 / 面板 / 拉手槽 / 双滑轨）/ `Cabinet_*` / `Bed_*` / `Wardrobe_Solid_Box` / `Ladder_*` / `Guardrail_*` / `Pillar_{F,B}{L,R}` |
| 动画 | 当前无（抽屉推拉由前端运动学实现，见 [drawer-interaction.md](drawer-interaction.md)） | ✅ `animations: 0` |

## 3. 归一化与配置（scene/deskModel.ts → DORM_DESK_MODEL_CONFIG）

处理顺序：单位换算 → 轴校正 → 预提取锚点 → 等比缩放（`fitWidthM`）→ 垂直对齐 → 居中 / 贴墙 → `offset`。
当前固定模型配置：

- `fitWidthM: null`：按模型原始比例，不做等比缩放；
- `verticalAlign: 'deskTop'`：**桌面锚点对齐到 `RoomConfig.desk.height`（0.75 m）**——
  模型标称 0.77 m，对齐后整组下沉约 20 mm，底脚藏于 2 cm 厚地面内（俯视 / 正视不可见），
  保证「物品摆放面 = 模型桌面 = 逻辑桌面」三者一致；
- `centerXZ: true` + `backWallZ: 0`：x 居中（原始 [0,2] → [-1,1]），背面（最小 z，立柱背面）贴后墙 z = 0；
  主桌面前沿距后墙约 0.61 m；
- 锚点：桌面 = `Desk_Top_Main` + `Desk_Top_L_Return`（2 个，顶面取最大 → 对齐后 0.75）；
  **书架锚点刻意为空**——模型自带上层四格书架（y 1.46–1.9）与「桌面书架」不是同一支撑面（见第 5 节）；
  出线孔锚点不含裸 `hole`（避免 `Cabinet_Lock_Keyhole` 误匹配），当前模型无出线孔节点；
- 俯视剖切：`applyBedCutaway`（`hideBedParts` 属性，工作台 / 对比页在俯视视角传入）隐藏
  `Bed_*` / `Guardrail_*` / `Ladder_*` 节点——**显示 only**，碰撞 / 校验几何不变（与参数化模式 `showBed` 口径一致）。

## 4. 吸附面 / 碰撞边界 / 显示口径

- **交互层（拖拽 / 校验 / 吸附 / 悬空判定）**：优先模型实测锚点（`deskModelStore.metrics`，source=`model`）；
  当前桌面 = 0.75（与配置一致，无行为变化）；书架回退配置口径（source 混合，见第 5 节）。
- **碰撞边界（越界 / 相交 / 房间范围）**：仍以 RoomConfig 为单一事实来源。
- **出线孔**：RoomConfig 为事实来源；工作台 / 对比页在 GLB 模式下由 `RoomShell showCableHoles` 在模型上
  叠加逻辑出线孔标记（模型自身无孔位几何）。
- **墙面插座**：仍由 `RoomShell` 渲染（单块「双插孔 ×2」面板，仅左右移动）。
- **参数化床架**：GLB 就绪时隐藏（模型自带床体），仅在回退模式渲染，避免重复。

## 5. 已知差异（下一步随「桌柜分离模型」与分区重构处理）

1. **L 形桌面 vs 单矩形配置**：RoomConfig 桌面仍为 1.6 × 0.8 m 单矩形；模型真实几何为主桌 1.04 × 0.55 m
   （app 坐标 x -0.45…0.59）+ 回台 0.41 × 0.86 m。桌面面积估算、碰撞盒、整理分区仍是配置口径。
2. **上层四格书架支撑面未对齐**：模型书架在 y 1.46–1.9（配置层「桌面书架」为 1.139）；
   示例书架物品仍按旧高度放置，在模型上会悬空；`organizationZones` / `ruleLayout` 也仍按配置计算。
   对齐方案（书架锚点 → 分区 / 支撑面 / 示例场景一起改）列入与抽屉分离模型同一批工作。
3. **示例物品位置按旧家具布局预置**：部分物品（打印机 / 台灯等）可能悬空于新模型几何之外；随场景重排处理。
4. **桌下横梁（排插推荐位）无模型几何**：模型对应的是背板（`Desk_Back_Baffle`）；
   排插 / 走线口径暂按配置口径。
5. **抽屉为静态几何**：三只抽屉（Bot / Mid / Top）不可开合；推拉交互设计与模型分离契约见
   [drawer-interaction.md](drawer-interaction.md)。

## 6. 组件与状态

- `scene/DormDeskModel.tsx`：GLB 优先渲染；加载中 / 失败 / 跳过时渲染 `scene/ParametricDesk.tsx`。
  属性：`room` / `position` / `rotationY` / `visible` / `hideBedParts`（俯视剖切）。
- `state/deskModelStore.ts`（持久化键 `dormtopology.desk-model`）：
  - 持久化：`forceFallback`、`showDesk`；会话派生：`status` / `error` / `retryNonce` / `metrics`。
- `scene/modelLoader.ts`：GLTFLoader 封装 + `disposeObject3D`；`scene/importModel.ts`：
  `importModel(url, name, position)` 动态导入接口（供后续生成的物品模型复用）。
- `scripts/check-desk-model.ts`：资产契约检查（节点命名 / 包围盒 / 锚点匹配 / 摆放复算），Node 直跑，无浏览器依赖。
- 状态提示：`ui/workspace/DeskModelNotice.tsx`（加载中 / 失败重试 / 简化几何恢复）。

## 7. 手工验证步骤

1. `cd frontend && npm run dev`，打开示例项目三维工作台：
   - 应看到 GLB 整组家具（L 形桌面、右侧三抽屉立柜、上层四格书架、床架）；俯视应隐藏床体 / 护栏 / 爬梯；
   - 移除 `frontend/public/models/dorm_desk_body.glb` 时应回退参数化几何并给出提示，放回后点「重试」恢复。
2. `npx tsx scripts/check-desk-model.ts`：资产契约通过（命名 / 尺寸 / 锚点 / 摆放复算）。
3. `npm run typecheck && npm run build`：`dist/models/` 应包含模型文件。
4. `npm run test:e2e -- tests/workspace.spec.ts`：桌面与模拟手机各 2 项应通过（覆盖含模型的场景渲染）。

### 切换到拆分版资产时需额外复核（见第 1.1 节）

若改用 `Prefabmodel/dormdesk_parts/` 的拆分资产，除上述步骤外必须确认：

- 桌体与抽屉使用同一归一化矩阵；不得只对桌体平移或分别居中抽屉；
- 抽屉单独加载后，三个抽屉应恰好嵌在柜体自下而上三层，与桌体无可见错缝；
- 抽屉沿 **-x** 抽出，最大行程不超过滑轨长度（304 mm），抽出时不与柜体前侧结构穿插。
