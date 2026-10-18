# 空间配置预览视角约束交接

状态：功能已实现，本地验证通过（2026-10-18）。

- 共同基线：`e3de759ad223f2c541617924ae45d61c70d3cf33`
- 分支：`codex/preview-camera`
- 功能提交：`e3d3010`（feat(frontend): constrain the space-setup preview camera to the room interior）
- 文档提交：本文件所在提交
- 未推送、未切换共享 main、未改动后端理线 API / 契约。

## 1. 实际功能提交与修改文件

| 文件 | 变更 |
| --- | --- |
| `frontend/src/scene/previewCameraBounds.ts` | 新增。纯函数约束模型（无 three.js、无 WebGL 依赖），可被 node 脚本直接回归。 |
| `frontend/src/scene/CameraRig.tsx` | 新增可选 `bounds` prop = 显式独立约束模式；无 `bounds` 时行为与原来一致。 |
| `frontend/src/ui/setup/SpacePreview3D.tsx` | 预览接入约束模式；移除透视 / 正视 / 俯视按钮与冗长说明，只留一行交互提示。 |
| `frontend/tests/parallel-preview-camera.spec.ts` | 新增专项浏览器回归（桌面 1440×1000）。 |
| `frontend/scripts/check-parallel-preview-camera.ts` | 新增专项数学回归（轨道 / 缩放 / 取景 / 对抗起点 / 负对照）。 |

设计要点（为什么这样约束，而不是只藏墙或只限一个方位角）：

- 硬边界来自真实房间：后墙 `z≈0`、左墙 `x=-L/2`、地面 `y=0`（含 0.18 m 净距）。
  正前方 / 右侧 / 顶部本来就是开口，不额外造墙，也不隐藏任何墙面。
- 家具体积：`dormdesk-v1` 直接使用随包碰撞数据的 75 个包围盒（与摆放校验同源）；历史 /
  自定义房间按 `RoomConfig` 复算桌面、书架、床架体积。相机不可进入这些实体，贴墙角落另有
  「最近可用盒面推出」兜底。
- 轨道中心固定在家具包围盒中心（标准房间为 `[0, 1.105, 0.605]`），不平移，避免把取景中心拖进墙里。
- 垂直角 8°–85°（不会正俯视万向锁死，也不会低到穿地平视）；水平角由「墙内侧两个半空间」按
  当前半径反解，再叠加 ±80° 舒适上限（避免掠射贴墙的无效视角）；半径变化时范围随之收敛。
- 距离：上限 = 家具总览取景距离 ×1.15（取景距离按家具包围盒 8 个角点与画布宽高比实时解算，
  因此小画布也保证家具完整入画）；下限 = max(0.55 × 家具包围盒对角线, 0.9 m)，并按当前方向
  与家具实体的离开距离抬高。
- 预览缩放比默认值略降（`rotateSpeed` 0.6）：344×286 的小画布沿用画布高度换算转速，原值过于灵敏。

## 2. 本地验证命令、结果及证据

依赖安装（本 worktree 用仓库自带锁文件，未换包管理器、未重生成 lockfile）：

```powershell
cd <worktree>/frontend
node <bundled>/node.exe <bundled>/pnpm.mjs install --frozen-lockfile
# pnpm 忽略了 esbuild 的 postinstall，esbuild 直接按 store 路径调用：
node node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild --version   # 0.21.5
```

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `node node_modules/typescript/bin/tsc --noEmit` | 通过（无输出） |
| 构建 | `node node_modules/vite/bin/vite.js build` | ✓ built；仅有既有 chunk 体积告警 |
| 专项数学回归 | 见下 | 通过（exit 0） |
| 专项浏览器回归 | 见下 | 3 passed |
| 桌面截图 | `F:/DormTopology/.work/preview-camera/final-*.png` | 见下 |

专项数学回归：

```powershell
node node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild scripts/check-parallel-preview-camera.ts `
  --bundle --platform=node --format=esm --alias:@=./src --outfile=../.work/preview-camera/check-parallel-preview-camera.mjs
node ../.work/preview-camera/check-parallel-preview-camera.mjs
```

覆盖内容与结果（报告：`F:/DormTopology/.work/preview-camera/check-report.json`）：

- 两套房间（`dormdesk-v1` 固定家具 / 参数化回退）× 3 种画布宽高比 × 6 个预设方向：
  违例 0；家具包围盒 8/8 角点全部落在裁剪空间内（取景完整）。
- 固定家具初始机位：距离 3.78 m，位置 `[-0.03, 1.85, 4.31]`，`maxNdcY=0.937`（不裁切）。
- 轨道扫描 1080 个采样（5 个垂直角 × 3 比例 × 72 个水平角）+ 缩放 42 个采样（0.1–12 m）：
  违例 0；缩放到极小 / 极大距离都不进家具、不穿墙地。
- 负对照：同一批水平整圈方向若不约束，有 613 个采样落在墙后 / 地下——证明「只限一个方位角
  或只藏墙」不够，也证明违例检测不是空转。
- 对抗起点（后墙后 / 左墙后 / 地面下 / 衣柜内 / 房间上方）夹取后违例 0。
- 违例检测器本身的负对照：`behind-back-wall` / `behind-left-wall` / `under-floor` 均能被检出。

专项浏览器回归：

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5207'
node node_modules/@playwright/test/cli.js test tests/parallel-preview-camera.spec.ts `
  --project=desktop-chromium --workers=1
```

3 passed（约 18 s）：

- 连续左右 / 上下拖拽（含大幅越界拖拽）、滚轮放大缩小、右键拖拽后读取真实相机：
  `violations=[]`、`z≥wallZ`、`x≥wallX`、`y≥floorY`；初始取景 `complete=true`（8/8）。
- 缩放确实改变半径（先增后减）并停在边界（放大停在 minDistance=1.78 m，缩小不超过取景上限）。
- 右键平移不改变轨道目标点（约束模式下平移已关闭）。
- 工作台画布无约束探针、拖拽后仍正常出图、无运行时报错（其他调用者无回归）。
- 预览不再有「透视 / 正视 / 俯视」按钮，交互提示为「拖动旋转 · 滚轮缩放 · 不会绕到墙后」。

证据截图（`F:/DormTopology/.work/preview-camera/`）：

- `final-setup-initial.png` 完整页面（1440×1000，无控件重叠，预览卡片无按钮）
- `final-preview-initial.png` 初始取景（床 / 书架 / L 桌面 / 抽屉 / 梯子全部入画）
- `final-preview-orbit-left.png`、`final-preview-orbit-right.png` 左 / 右旋转到边界
- `final-preview-zoom-in.png`（1.78 m 近景，桌面细节）、`final-preview-zoom-out.png`（家具总览）

与本任务无关的既有失败（同 worktree 用**基线文件** A/B 复现，非本分支引入）：

- `tests/workspace.spec.ts:135`：reload 后画布非空判定超时 → 基线同样失败。
- `tests/scene-rendering.spec.ts:44`：空闲抽帧=0 在软件渲染下不稳定（基线 0.53 / 本分支 0 与 2056 波动）；
  用脚本直接测空闲抽帧（`F:/DormTopology/.work/preview-camera/idle.mjs`）：基线与本分支都是
  约 4–5 s 收敛到 0，行为一致。
- `tests/home.spec.ts:297` / `:315`：窄屏与紧凑布局用例 → 基线同样失败（移动端能力已按根 AGENTS 废弃）。
- `tests/drawer.spec.ts:143`：首次 30 s 超时、复跑通过（软件渲染负载）。

## 3. 跨分支接口、精确调用点与建议补丁

- 新增导出（`frontend/src/scene/previewCameraBounds.ts`）：`createPreviewCameraBounds`、
  `previewCameraPlacement`、`previewAzimuthRange`、`previewKeepOutRadius`、`previewFitDistance`、
  `previewFrameCoverage`、`previewCameraViolations`、`clampPreviewCameraPosition`、
  `previewMaxDistance`、`PREVIEW_CAMERA_FOV`。
- `CameraRig` 新 prop：`bounds?: PreviewCameraBounds`（缺省 = 原自由轨道，工作台 / 描点 /
  最终页不要传）。接入方式：

```tsx
const bounds = useMemo(() => createPreviewCameraBounds(room), [room])
<CameraRig preset="persp" furnitureModel={room.furnitureModel} bounds={bounds} />
```

- 精确调用点：`frontend/src/ui/setup/SpacePreview3D.tsx` 的 `<CameraRig ... bounds={bounds} />`。
- 开发探针：`window.__previewCamera`（仅 `import.meta.env.DEV`，生产构建不注入），提供
  `state()` / `coverage()` / `violations()` / `bounds`，供 e2e 读取真实相机，不影响产品行为。
- 建议补丁（不属于本分支文件，未修改）：`frontend/src/scene/renderProfile.ts` 的 `sceneDpr()`
  使用 `pointer: coarse`，与根 AGENTS「不得新增 `pointer: coarse` 覆盖」冲突，建议由模型 / 整合
  分支移除该分支逻辑。

## 4. 未完成项、实际阻塞与整合风险

- 家具贴墙角落（衣柜紧贴床柱）在正常交互中不会出现（每帧最小半径已按家具离开距离抬高），
  但仍保留「沿最近可用盒面推出」的兜底与对抗用例；后续如更换家具资产或改变 `keepOut` 结构，
  需复跑数学回归。
- 小画布 344×286 下的转速手感与卡片高度相关：视觉 / 工作台分支若改动预览卡片尺寸，请复跑
  `tests/parallel-preview-camera.spec.ts` 与截图确认。
- 垂直角上限 85° 表示不提供「贴地平视」低机位；如需桌面平视特写需另立需求。
- 未在真实 GPU 上验证性能：Playwright 为软件渲染（swiftshader），截图与坐标断言有效，
  不代表真机帧率。

## 5. 确认

- 未改动 `backend/`、`algorithm/`、`vlm/`、`frontend/src/api/`；未改理线请求 / 响应契约、
  规划算法、源模型资产、碰撞资产与旧项目数据。
- 只提交本分支归属文件（含本任务专属前缀的测试 / 脚本 / 文档），未覆盖他人修改。
- 未推送、未更新 main、未强制改写历史。
