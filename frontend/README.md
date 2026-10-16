# DormTopology 3D 前端（成员 A）

React + TypeScript + Three.js（React Three Fiber + Drei）实现的宿舍桌面整理与理线演示应用。当前为**本地演示模式**：照片识别、模型生成、布局整理与走线规划均由本地 Mock 适配器与规则式演示实现，尚未接入后端 FastAPI 服务、真实算法与 Rodin 生成；界面已就地标注各处数据的真实来源（演示数据 / 模拟 / 计算值 / 未接入）。

本目录的设计基线见 [docs/design-spec.md](docs/design-spec.md)；仓库级约定以 [实施方案](../docs/implementation_roadmap.md) 与 [数据契约](../docs/data_contract.md) 为准。

## 运行与检查

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build      # tsc --noEmit && vite build
```

- Node.js ≥ 18（开发验证使用 Node 24 / npm 11），依赖版本已固定（`package.json` 无 `^` 范围）。
- 环境变量见 `.env.example`：`VITE_SERVICE_MODE=mock`（默认，本地模拟）或 `service`（调用应用后端）；`VITE_API_BASE_URL` 仅 service 模式使用。Rodin 等第三方凭证只在后端持有，前端不配置、不直接调用供应商接口。

## 已实现的流程（演示数据 + 本地规则）

项目列表（含内置示例项目）→ 创建项目 → 空间配置 → 照片导入与物品确认 → 三维工作台 → 执行指南 v0。

- **空间配置**（`/projects/:id/setup`）：桌体、房间、立柱、穿线孔、墙面接口的表单配置，表单为毫米制（与三维内部米制通过 `@/lib/units` 换算），配置冲突有就地校验。
- **照片导入**（`/projects/:id/import`）：示例照片与上传（IndexedDB 保存）、识别 Mock 输出候选清单、物品增删改与尺寸确认、模型生成任务 Mock（等待/失败/重试/部分成功）、物品落位到桌面。
- **三维工作台**（`/projects/:id/workspace`）：
  - 场景与交互：参数化桌体/书架/立柱/穿线孔、相机预设（透视/正面/俯视/左右/桌面）、选择、左键拖动与支撑面吸附、旋转与数值编辑、摆放校验（越界/相交/悬空）就地标注、撤销重做。
  - 空间整理：规则式整理预览（前后对比、归位动画、接受/取消），明确标注为模板建议。
  - 走线规划（规则式演示）：设备接口编辑（局部偏移/朝向/类型）、两点连线、线缆列表与属性、路径规划（优先桌沿/桌底/立柱/穿线孔节点）、平滑采样后的几何复查（给出具体障碍位置与原因）、路径节点拖动、原始/建议对比、收拢动画、设备移动后「需重算」标记与一键更新。
- **执行指南 v0**（`/projects/:id/guide`）：整理步骤、走线步骤（长度为计算值）、配件建议（模拟）、导出 JSON；场景截图与打印版式按钮为未接入占位。

不伪造精确比例与算法结论：规则式演示结果不标注为「真实算法验证」，未接入能力显示为「未接入」。

## 目录结构

```text
frontend/src/
  api/      HTTP 客户端与 Mock 适配器（服务契约、模式切换与数据来源）
  state/    Zustand 状态（项目、工作台、线缆、整理、任务）与 IndexedDB 存取
  scene/    Three.js/R3F 场景与本地几何规则（场景校验、走线规划、路径节点、模型资源）
  ui/       页面与组件（pages / workspace / setup / kit / layout / brand / jobs）
  lib/      通用纯函数（单位换算、工具、指南生成、布局方案辅助）
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
6. **算法来源**：整理与走线目前为前端本地规则式演示（`scene/ruleLayout.ts`、`scene/cableRoute.ts`）；`algorithm/` 的 Python 走线实现与后端 service 尚未接入。

## 未完成事项（对应[任务清单](../docs/project_tasks.md)成员 A）

- 桌体 `models/dorm_desk_assembled.glb` 加载与 `importModel(url, name, position)` 动态导入（当前为参数化简化几何）。
- 真实后端与两项算法联调（Mock 通过不代表真实联调完成）。
- 照片框选补标与后端裁剪、Rodin 生成任务对接。
- 4/6/8 位插排选择、墙面接口沿 Y 轴调整、穿线孔/背板后双策略切换、粗/细线预设与按线径渲染。
- 指南增强：场景截图/俯视图、步骤勾选与高亮、打印版式、配件参数预览与 GLB/STL 导出控制。
- 手机端上传、预览与场景查看的实测记录。

## 验证记录（2026-10-16）

- `npm run typecheck` 通过；`npm run build` 通过（产物约 1.30 MB JS + 22.9 KB CSS，含 Three.js 单块体积警告，属预期）。
- Vite 开发服务器（:5173）入口与各目录模块均返回 200。
- 运行时为浏览器手动验证；本仓库环境无自动化浏览器测试。
