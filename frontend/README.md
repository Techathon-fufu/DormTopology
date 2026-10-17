# DormTopology 3D 前端（成员 A）

React + TypeScript + Three.js（React Three Fiber + Drei）实现的宿舍桌面整理与理线演示应用。产品流程当前为**本地演示模式**：照片识别、模型生成、布局整理与走线规划由本地 Mock 适配器与规则式演示实现，尚未接入后端 FastAPI 服务与 Rodin。独立的 `/algorithm-lab` 现可读取真实 Python 领域算法导出的 JSON，查看布局、路径和失败原因；这不代表产品流程联调已完成。

本目录的设计基线见 [docs/design-spec.md](docs/design-spec.md)；仓库级约定以 [实施方案](../docs/implementation_roadmap.md) 与 [数据契约](../docs/data_contract.md) 为准。

## 运行与检查

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build      # tsc --noEmit && vite build
```

- 开发及浏览器测试使用 Node.js ≥ 20（本轮验证 Node 22 / npm 10），依赖版本已固定（`package.json` 无 `^` 范围）。
- 环境变量见 `.env.example`：`VITE_SERVICE_MODE=mock`（默认，本地模拟）或 `service`（调用应用后端）；`VITE_API_BASE_URL` 仅 service 模式使用。Rodin 等第三方凭证只在后端持有，前端不配置、不直接调用供应商接口。

## 算法验证入口

从项目首页点击「算法验证」，或打开 `/algorithm-lab`。内置 14 组真实算法输入/结果，支持整理前后、碰撞体/支撑区域/网络图层、已验证路径、失败原因、物品详情及契约 JSON 导入导出。综合桌面样例包含显示器、打印机、8 件待整理物品和直插插排的适配器；物品详情显示摆放优先级与插装关系，接口可单独选择。「固定与支撑」图层显示已安装支撑及悬空跨距上界；「集线槽建议」独立显示可选收束位置、分组与占用宽度，不影响逐线有效性。历史数据标记支撑未评估。查看器直接使用契约坐标，不转换为产品演示模型。

在仓库根目录运行 `python3 -B -m backend.examples.algorithm_fixtures` 可重新生成样例。在本目录运行 `npx playwright install chromium` 后，`npm run test:e2e` 执行桌面/手机 Chromium 检查，`npm run test:e2e:report` 查看截图与报告。完整的文件、版本和验收边界见[算法可视化验证](../docs/algorithm_visual_testing.md)。

## 已实现的流程（演示数据 + 本地规则）

项目列表（含内置示例项目）→ 创建项目 → 空间配置 → 照片导入与物品确认 → 三维工作台 → 方案交付（执行指南）。

- **一键演示导览**（首页「一键演示」）：6 步固定顺序（查看凌乱桌面 → 确认识别物品 → 自动整理 → 规划走线 → 对比前后 → 查看执行指南），步骤切换自动导航、完成自动打勾、可点步骤条跳转；「重置并重播」重新种入示例项目并清理交付勾选 / 候选方案 / 任务记录 / 撤销历史；导览进度本地持久化；工作台步骤自动切换桌面视角（路演三幕：杂乱还原 / 归位动画 / 收拢对比）。演示辅助：「跳过模拟等待」（全局演示加速，仅 mock 生效）与系统「减少动态效果」偏好（整理 / 收拢动画直接显示末态）。演示脚本与验收明细见 [docs/demo-and-acceptance.md](docs/demo-and-acceptance.md)。

- **空间配置**（`/projects/:id/setup`）：桌体、房间、立柱、穿线孔、墙面接口的表单配置，表单为毫米制（与三维内部米制通过 `@/lib/units` 换算），配置冲突有就地校验。
- **照片导入**（`/projects/:id/import`）：示例照片与上传（IndexedDB 保存）、识别 Mock 输出候选清单、物品增删改与尺寸确认、模型生成任务 Mock（等待/失败/重试/部分成功）、物品落位到桌面。
- **三维工作台**（`/projects/:id/workspace`）：
  - 场景与交互：参数化桌体/书架/立柱/穿线孔、相机预设（透视/正面/俯视/左右/桌面）、选择、左键拖动与支撑面吸附、旋转与数值编辑、摆放校验（越界/相交/悬空）就地标注、撤销重做。
  - 空间整理：规则式整理预览（前后对比、归位动画、接受/取消），明确标注为模板建议。
  - 走线规划（规则式演示）：设备接口编辑（局部偏移/朝向/类型）、两点连线、线缆列表与属性、路径规划（优先桌沿/桌底/立柱/穿线孔节点）、平滑采样后的几何复查（给出具体障碍位置与原因）、路径节点拖动、原始/建议对比、收拢动画、设备移动后「需重算」标记与一键更新。
- **方案交付（执行指南）**（`/projects/:id/guide`）：所有内容由当前方案数据实时推导，未写死演示步骤。
  - 整理后的场景视图：俯视 / 透视机位切换、点击步骤或对象高亮（线缆高亮时其余降透明）、导出 PNG 截图。
  - 物品摆放步骤（按支撑面与占地排序，含锁定物品保持原位提示）、线缆连接次序（按接入端高度排序）、收拢固定次序（桌沿 → 桌底 → 立柱 → 地面分组）；步骤可勾选完成，进度保存在本地。
  - 配件清单：卡扣 / 挂钩 / 扎带 / 理线槽等数量 = 走线规划标注 + 本地规则估算（估算规则与理由逐条展示）。
  - 配件参数预览面板：线径 / 容纳数量 / 桌板厚度或立柱截面输入，参数化几何预览（外观预览，非可打印几何体）；GLB 导出已实现（外观预览模型，three-stdlib GLTFExporter），STL 明确标注未接入。
  - 未解决的问题清单：摆放校验（越界 / 相交 / 悬空）、走线检查（边界 / 避让区 / 端点，含障碍位置坐标）、线长核对（实际线长缺失 / 不足）与供电未接线，均可点击定位。
  - 导出项目 JSON（含场景、指南、配件参数与诚实标注）；浏览器打印 / 保存 PDF 版式（标题 + 生成信息 + 场景截图，步骤避免跨页切断）；工作台方案修改后以方案指纹检测并提示「重新生成指南」。

不伪造精确比例与算法结论：规则式演示结果不标注为「真实算法验证」，未接入能力显示为「未接入」。

## 目录结构

```text
frontend/src/
  algorithm-lab/  真实领域 JSON 的独立解析、三维查看与版本检查
  api/      HTTP 客户端与 Mock 适配器（服务契约、模式切换与数据来源）
  state/    Zustand 状态（项目、工作台、线缆、整理、任务、交付、导览、演示加速）与 IndexedDB 存取
  scene/    Three.js/R3F 场景与本地几何规则（场景校验、走线规划、路径节点、模型资源）
  ui/       页面与组件（pages / workspace / setup / deliver / tour / kit / layout / brand / jobs）
  lib/      通用纯函数（单位换算、工具、指南生成、布局方案辅助、WebGL 检测、模拟等待节奏、减少动态偏好）
  types/    领域类型（与数据契约的对应关系见下）
  data/     演示项目与示例照片
```

## 与仓库数据契约的已知差异（联调前需解决）

当前演示应用的内部约定与[数据契约](../docs/data_contract.md)存在以下差异；联调时在 `api/` 层转换或按契约调整，避免直接以内部模型充当 wire format：

1. **坐标系原点**：本应用原点为「后墙面与地面交线上的桌面中心点」（x 以桌面中心为 0，后墙 z = 0）；契约为「桌面左后角在地面的投影」（X ≥ 0、Z ≥ 0）。转换需平移约 `[desk_width/2, 0, -0.05]`。
2. **演示尺寸**：本应用演示桌 1.2 × 0.6 × 0.75 m（桌板厚 25 mm，穿线孔 ⌀50 mm）；契约演示配置 `demo_desk_v1` 为 1.45 × 0.60 × 0.77 m。需统一演示场景参数后再联调。
3. **字段命名**：内部领域类型为 camelCase（`types/project.ts`），契约 JSON 为 snake_case（`scene.json` / `packing_result.json` / `cable_routing.json`）；`api/` 层负责双向转换。
4. **接口与线缆模型**：契约端口含 `capacity` / `confirmed`，线缆含 `thickness` / `mode` / `length_m` / `min_bend_radius_m` / `slack_m` 及失败原因码；本应用演示模型尚未包含这些字段与枚举，联调时按契约补齐。
5. **结果状态语义**：契约使用 `success/partial/infeasible`、`valid/failed` 与统一 `reason_code`；本应用内部状态（planned/stale/conflict 等）仅用于本地展示，需在 `api/` 层映射。
6. **算法来源**：产品工作台仍使用前端本地规则式演示（`scene/ruleLayout.ts`、`scene/cableRoute.ts`）；Python 领域实现位于 `backend/app/domain/`。独立验证入口已解析其真实 JSON，产品 service 调用仍未接入。

## 未完成事项（对应[任务清单](../docs/project_tasks.md)成员 A）

- 桌体 `models/dorm_desk_assembled.glb` 加载与 `importModel(url, name, position)` 动态导入（当前为参数化简化几何）。
- 真实后端与两项算法联调（Mock 通过不代表真实联调完成）。
- 照片框选补标与后端裁剪、Rodin 生成任务对接。
- 4/6/8 位插排选择、墙面接口沿 Y 轴调整、穿线孔/背板后双策略切换、粗/细线预设与按线径渲染。
- STL 导出与打印级配件几何：需要封闭（水密）几何生成能力（布尔合并），当前配件预览仅为外观预览。
- 候选方案对比 UI：「保存方案」的候选方案已持久化保留，对比界面未实现（工作台按钮暂禁用并标注「后续阶段」）。
- 手机端上传、预览与场景查看的实测记录。

## 验证记录（2026-10-17，工作台阶段复检与路演三幕）

新增算法验证入口的检查记录独立维护于[算法可视化验证](../docs/algorithm_visual_testing.md#验证记录2026-10-17)：真实样例生成、构建以及桌面/手机 Chromium 自动检查通过，最新检查数量见该记录。下文为此前产品 Mock 流程的历史记录。

- `npm run typecheck` 通过；`npm run build` 通过（产物 1,376.29 kB JS + 25.67 kB CSS，含 Three.js 单块体积警告，属预期）。
- Headless 冒烟（esbuild 打包 + Node 运行，38 项断言全过）：拖拽落点决策 6 种情形（有效提交 / 无效回退到最后有效位置 / 未移动与无效回退不提交）、选中状态、属性与位姿同步、引用设备的 3 条线缆 stale 标记与撤销还原、撤销 / 重做时间线、localStorage 序列化内容断言（名称 / 位置）、视角预设强制重应用、导览三幕定义与提示、收拢动画共用入口（无原始走线提示 / 播放 / 导览信号 / 推进到末态）、摆放校验（越界 / 相交 / 空位）。
- Vite 开发服务器（临时端口 :5199）入口与本轮改动模块（dragCommit / useObjectDrag / collectAnim / tourStore / workspaceStore / DemoTour / CableListPanel / CablePanel / demoProject / WorkspacePage / RightPanel / OrganizePanel）14/14 返回 200。
- 运行时为浏览器手动验证；本仓库环境无自动化浏览器测试。第 04 阶段复检结论见 [docs/demo-and-acceptance.md](docs/demo-and-acceptance.md) 第 6 节。

## 验证记录（2026-10-17，演示与验收收尾）

- `npm run typecheck` 通过；`npm run build` 通过（产物约 1.37 MB JS + 25.7 KB CSS，含 Three.js 单块体积警告，属预期）。
- Headless 冒烟（esbuild 打包 + Node 运行，26 项断言全过）：演示加速（立即完成 / 正常计时 / 唤醒进行中的等待）、模拟服务失败与重试（台灯首次失败、重试成功）、一键演示重置（示例项目回凌乱初始、整理前快照重采、交付 / 候选方案 / 任务记录 / 撤销历史清理）、导览信号与步骤推进、接受整理方案 → 恢复整理前状态（与快照一致）、prefers-reduced-motion 下整理与收拢动画直落末态。
- Vite 开发服务器（临时端口 :5199）入口与新增模块（tourStore / mockPacing / motion / DemoTour / FastForwardToggle 等）均返回 200。
- 运行时为浏览器手动验证；本仓库环境无自动化浏览器测试。10 条验收流程结论与演示脚本见 [docs/demo-and-acceptance.md](docs/demo-and-acceptance.md)。

## 验证记录（2026-10-17，方案交付页）

- `npm run typecheck` 通过；`npm run build` 通过（产物约 1.36 MB JS + 25.1 KB CSS，含 Three.js 单块体积警告，属预期）。
- Headless 冒烟（esbuild 打包 + Node 运行）：示例项目指南生成（12 摆放步骤 / 5 连接步骤 / 配件估算与问题清单）与方案指纹（同数据稳定、移动物品后变化）通过；配件几何两种型号网格数 10 / 8，GLB 二进制导出魔数校验通过（17.3 KB / 13.5 KB）。
- Vite 开发服务器（临时端口 :5199）入口与新增模块（GuidePage / DeliverViewport / AccessoryPanel / guide / accessoryGeometry / deliverStore / webgl）均返回 200。
- 运行时为浏览器手动验证；本仓库环境无自动化浏览器测试。

## 验证记录（2026-10-16）

- `npm run typecheck` 通过；`npm run build` 通过（产物约 1.30 MB JS + 22.9 KB CSS，含 Three.js 单块体积警告，属预期）。
- Vite 开发服务器（:5173）入口与各目录模块均返回 200。
- 运行时为浏览器手动验证；本仓库环境无自动化浏览器测试。
