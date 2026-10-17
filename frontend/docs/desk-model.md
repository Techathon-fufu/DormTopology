# 桌体 GLB（dorm_desk_assembled.glb）接入说明

> 状态：加载管线已实现（本阶段），但仓库当前 **不包含** `dorm_desk_assembled.glb` 资产文件。
> 资产缺失 / 加载失败时，工作台自动回退参数化简化桌体（ParametricDesk），并给出可恢复的提示；
> 未伪造模型内容、未把占位几何标注为真实资产。

## 1. 资产放置与路径

- 放置路径：`frontend/public/models/dorm_desk_assembled.glb`
  （Vite `public/` 原样复制到构建产物：开发 `/models/...`、生产 `dist/models/...`）。
- 路径解析：`scene/deskModel.ts` 的 `resolvePublicAssetUrl()` 基于 `import.meta.env.BASE_URL`，
  子路径部署（`vite.config.ts` 的 `base`）同样正确。
- 仓库内另存有 Blender 源文件 `objects/dorm_desk.blend`（导出 GLB 的流程未在仓库内自动化，需手工导出）。

## 2. 模型约定（导出时建议满足）

| 项目 | 约定 | 不满足时的处理 |
| --- | --- | --- |
| 单位 | 米制（glTF 规范为米） | 配置 `unitScale`（如厘米导出填 `0.01`） |
| 朝向 | Y 轴向上，正面朝 +z（后墙在 z=0，房间向 +z 展开） | 配置 `axisRotationY`（Z-up 导出可设 `-Math.PI / 2`） |
| 原点 | 任意（自动归一化） | 自动：居中到桌面基准、底部贴地（或按锚点对齐） |
| 命名节点（可选） | 桌面节点名含 `DeskTop` / `desk_top` / `桌面`；搁板含 `Shelf` / `搁板` / `书架`；出线孔含 `CableHole` / `hole` / `出线孔` | 无锚点时支撑面高度回退 RoomConfig 口径 |

## 3. 归一化与配置（scene/deskModel.ts → DORM_DESK_MODEL_CONFIG）

处理顺序：单位换算 → 轴校正 → 预提取锚点 → 可选等比缩放（`fitWidthM`）→ 垂直对齐
（`bottom` 底部贴地 / `deskTop` 将桌面锚点对齐到 `RoomConfig.desk.height`）→ 居中 XZ
（x=0、z=桌面中心）→ `offset` 微调。

- 默认配置不做等比缩放（`fitWidthM: null`）：模型按导出的米制实际尺寸使用。
  若导出比例与项目配置不符，再启用 `fitWidthM`（按宽度统一缩放）或修改导出。
- 若模型含「床架 / 立柱」等高于桌面的结构，`verticalAlign: 'bottom'` + `centerXZ: true` 仍适用。

## 4. 吸附面 / 碰撞边界的口径（本阶段）

- **交互层（拖拽 / 校验 / 吸附 / 悬空判定）**：优先采用模型实测锚点
  （`deskModelStore.metrics.deskTopY / shelfTopY`，source=`model`）；无锚点或未加载模型时
  回退 RoomConfig 口径（source=`config`）。见 `sceneValidation.ts` 的 `deskTopY(room, metrics)` /
  `shelfTopY(room, metrics)` / `supportsContaining` / `raycastSupports` / `placementIssues`。
- **碰撞边界（越界 / 相交 / 房间范围）**：仍以 RoomConfig 为单一事实来源；归一化保证模型
  XZ 与配置对齐，因此边界口径不变。
- **已知限制（如实标注）**：整理分区计算（`organizationZones.ts`）与规则式布局
  （`ruleLayout.ts` / 组织方案生成）当前仍按 RoomConfig 计算，未接入模型锚点；
  出线孔 / 电源锚点仅做诊断记录，未接入走线路径计算。待资产入库并核验锚点后按同一 metrics
  口径统一接入（避免「看到的区域 ≠ 计算的区域」在这之前出现口径分叉）。

## 5. 组件与状态

- `scene/DormDeskModel.tsx`：GLB 优先渲染；加载中占位 / 失败 / 用户跳过时渲染
  `scene/ParametricDesk.tsx`（参数化 fallback）。支持 `position` / `rotationY` / `visible` 属性。
- `state/deskModelStore.ts`（持久化键 `dormtopology.desk-model`）：
  - 持久化：`forceFallback`（改用简化几何）、`showDesk`（工具栏显示 / 隐藏开关）；
  - 会话派生：`status`（idle/loading/loaded/failed/skipped）、`error`、`retryNonce`、`metrics`（刷新后重新加载重算）。
- `scene/modelLoader.ts`：GLTFLoader 封装 + `disposeObject3D`；`scene/importModel.ts`：
  `importModel(url, name, position)` 动态导入接口（底面中心锚点对齐，供后续生成的物品模型复用；
  当前物品渲染仍为参数化占位几何，未接生成 GLB）。
- 状态提示：`ui/workspace/DeskModelNotice.tsx`（视口右下角）：加载中 / 失败（含「重试」
  「改用简化几何」）/ 已跳过（「尝试加载模型」）。

## 6. 手工验证步骤

1. `cd frontend && npm run dev`，打开示例项目的三维工作台：
   - 资产缺失时应看到右下角「加载失败 → 已回退到参数化简化桌体」提示，桌体为参数化几何；
   - 将 `dorm_desk_assembled.glb` 放入 `frontend/public/models/` 后点「重试」，
     桌体应切换为 GLB（控制台输出归一化测量与锚点信息见 `loadSucceeded` 指标）。
2. 拖动桌面物品：吸附面高度应与模型桌面一致（有锚点时按实测，否则按配置）。
3. `npm run typecheck && npm run build`：确认类型检查与构建通过；`dist/models/` 应包含模型文件（放入后）。
