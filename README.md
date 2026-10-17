# 寝空拓扑 DormTopology 3D

面向高校宿舍桌面的整理与理线原型：使用照片辅助建立物品清单，由用户确认尺寸和连接关系，再生成可调整的摆放方案、走线路径与执行指南。Rodin 用于生成单件物品的展示模型，几何算法负责摆放和路径验证。

参赛目标：Techathon 2026（上海科技大学），面向影眸科技（DeemosTech）HYPER3D Rodin 专项奖及全场大奖。参赛要求与 API 使用条件以赛事和服务方的实际规定为准。

## 当前状态

前端已有可运行的演示应用（`frontend/`，React + R3F，本地 Mock 与规则式演示，尚未与后端和算法联调），已覆盖「空间配置 → 照片与物品 → 三维工作台 → 方案交付（执行指南）」的完整演示流程，并提供首页「一键演示」6 步导览（可重置重播、可跳过模拟等待、遵循系统减少动态效果偏好；三个重点画面——杂乱桌面的三维还原、物品归位动画、线缆收拢前后对比——串为一段可重复操作的完整流程）；演示脚本、验收结论与能力边界见 [frontend/docs/demo-and-acceptance.md](frontend/docs/demo-and-acceptance.md)。

物品布局与走线核心现统一位于 `backend/app/domain/`，包含共享几何、多平面贪心摆放、布局复查、连续可用面积、双策略走线搜索与曲线验证；已有算法回归和仅加载领域目录的隔离测试。`algorithm/cable_routing/` 保留兼容导入。后端 FastAPI 服务、真实场景通道、完整前后端联调与 Rodin 接入尚未完成，前端演示不代表这些集成验收已通过；各交付轮次的更新记录见 [CHANGELOG.md](CHANGELOG.md)。

新增独立[算法可视化验证工作台](docs/algorithm_visual_testing.md)：前端 `/algorithm-lab` 直接查看 14 组 Python 真实算法 JSON，支持整理前后、几何图层、有效路径、失败原因和导入导出，并提供桌面/手机 Chromium 的 Playwright 检查。包含桌沿/孔边/柜侧固定、桌下扎带、连续集线托盘、无支撑失败，以及先逐线规划再推荐集线槽的三线案例；候选槽与已安装支撑分开。新增[综合桌面样例](docs/integrated_desk_scenario.md)，包含高优先级显示器和打印机、直插插排的适配器，以及应用整理后重新生成的三根线。开启支撑策略时复查最终曲线的最大悬空跨距，历史场景明确标记支撑未评估。无需先准备精细模型；该入口与产品 Mock 流程独立，不计为 FastAPI、真实资产或完整流程验收。

| 现有文件 | 状态与用途 |
| --- | --- |
| `frontend/` | 前端演示应用（成员 A）：空间配置、照片导入与物品确认、三维工作台、整理预览、走线规划（规则式演示）与方案交付（执行指南，含配件参数预览与导出）；提供「一键演示」6 步导览（三个重点画面——杂乱还原 / 归位动画 / 收拢对比——串为可重复流程）与验收说明（[demo-and-acceptance.md](frontend/docs/demo-and-acceptance.md)），运行方式与已知差异见 [frontend/README.md](frontend/README.md) |
| `objects/dorm_desk.blend` | 桌体 Blender 源文件；尺寸、原点、轴向与网格仍需核验 |
| `objects/tissue_box.obj` | 纸巾盒 OBJ 资产；运行时导入前需校正尺寸与轴向 |
| `objects/杯子.obj` | 杯子 OBJ 资产；运行时导入前需校正尺寸与轴向 |
| `algorithm/cable_routing/` | 旧走线模块的兼容导出，不再承载业务实现 |
| `backend/app/domain/` | C/D 的纯 Python 布局与走线算法、共享几何、输入校验及领域类型；调用与证据见[布局算法交接](docs/packing_algorithm.md)和[走线算法说明](docs/routing_algorithm_plan.md) |

仓库仍没有已导出的桌体 GLB 实际文件。前端桌体 GLB 加载管线已就绪（0.5.1：加载 / 归一化 / 命名锚点实测、失败自动回退参数化简化几何并可重试、`importModel(url, name, position)` 动态导入接口；细节见 [frontend/docs/desk-model.md](frontend/docs/desk-model.md)）：将 `dorm_desk_assembled.glb` 放入 `frontend/public/models/` 即自动启用；独立单品 GLB 仍待按数据契约导出接入。

## 首版目标

```text
上传照片 → 确认物品、尺寸和原始位置 → 简化场景
→ 推荐整理布局 → 确认接口、连接关系和线长
→ 规划并验证走线 → 整理前后对比 → 导出执行指南
```

Rodin 在后台异步生成外观模型，完成后替换简化模型；生成失败时仍可继续整理。

- 演示规模：一个标准桌面场景、8 件待整理物品，插排、墙插和网口等基础设备另计；3 根线包含插排总线。至少完成 1 件真实 Rodin 资产生成，其余使用简化模型或明确标注的缓存。
- 整理范围：常用外设保留在桌面中央，杂物分配至上层四格书架或右侧抽屉，支持手动调整；抽屉首版作为固定收纳区域。
- 理线范围：用户表面取点并确认连接、粗细线及实际参数；支持穿线孔和背板后两种策略、4/6/8 位插排选择及多线缆汇聚，输出已验证曲线；不可行时返回原因。
- 前端与资产：桌体 GLB、1–2 个独立单品 GLB（至少 1 件真实 Rodin 资产）、可拖动的动态模型导入、墙插/网口默认离地 0.30m 并可沿墙面调整；电脑完成完整流程，手机支持图片上传、预览及场景查看。
- 交付期限：4 人、有 Web 开发基础，在 48 小时内完成比赛原型；A 负责前端，B 负责后端，C、D 分别独立负责物品布局与走线算法，并行计划与降级顺序见实施方案。
- 后续扩展：完整移动端编辑、抽屉开合交互、自由堆叠、刚体交互、AR、参数化打印配件和多宿舍模板。

不承诺单张照片恢复毫米级真实空间、整桌资产秒级生成、全局最优布局或电气安全认证。实际生成耗时、移动端性能与打印适配需要分别实测。

## 文档导航与维护规则

| 文档 | 唯一负责的内容 |
| --- | --- |
| [项目实施方案](docs/implementation_roadmap.md) | 首版范围、技术架构、算法选择、工期与模块职责 |
| [走线算法规划](docs/routing_algorithm_plan.md) | 走线输入、A* 搜索、双策略、曲线复查、多线汇聚与输出约定 |
| [布局算法交接](docs/packing_algorithm.md) | 已实现的布局函数、共享几何、运行命令、样例及算法验收证据 |
| [算法可视化验证](docs/algorithm_visual_testing.md) | 真实算法 JSON 工作台、14 类样例、支撑与集线槽建议、导入版本规则和浏览器测试命令 |
| [综合桌面样例](docs/integrated_desk_scenario.md) | 显示器、打印机等 8 件物品的摆放优先级、直插适配器与整理后走线设计 |
| [用户体验设计](docs/ux_design.md) | 用户流程、交互方式、加载状态与错误反馈 |
| [数据契约](docs/data_contract.md) | 坐标、单位、资产规范、场景与模块 JSON 协议 |
| [研发任务与验收](docs/project_tasks.md) | 任务负责人、依赖、验收条件与集成检查 |
| [产品更新日志](CHANGELOG.md) | 已交付版本的功能更新与已知限制 |

范围和工期以实施方案为准；字段和空间约定以数据契约为准。修改这两类约定时，必须同步检查 UX 与任务清单。其他文档通过链接引用协议，不再维护第二套 JSON 示例。

2026-10-16 已将用户提供的 `tasks.md` 要求合并到首版范围，逐项对应见[附件要求对照](docs/project_tasks.md#8-附件-tasksmd-要求对照)。截至 2026-10-17，C、D 已有算法层实现和测试；清单仍区分算法证据与真实联调、资产及终端验收。Mock 接口验证不替代真实联调，无法走通的端点必须返回失败。

## 开发入口

当前可复用的算法入口包括 `backend.app.domain.packing` 的 `plan_packing(scene)`、`validate_layout(scene)`、`measure_free_area(scene)`，以及 `backend.app.domain.routing.plan_routing(scene)`（保留同一函数的 `plan_routes` 别名和旧包入口）。调用、测试和四类 JSON 样例生成命令见[布局交接说明](docs/packing_algorithm.md)，走线参数见[走线算法说明](docs/routing_algorithm_plan.md)。下一步需实现后端编排和前端接入，再用 8 件待整理物品及 3 根线完成集成验收；具体任务见[任务清单](docs/project_tasks.md)。

算法分为两个独立任务：[C：物品布局算法](docs/project_tasks.md#4-成员-c物品布局算法)与[D：走线算法](docs/project_tasks.md#5-成员-d走线算法)。两人使用共同场景样例并行实现，分别交付整理与走线结果；集成时走线使用已应用布局后的当前场景。

新增后端时按[分层架构与依赖方向](docs/implementation_roadmap.md#分层与依赖方向)组织工程：`domain` 承载规则与算法，`service` 编排用例，`api` 处理 HTTP，`db` 与外部适配器实现存储及供应商能力。当前走线模块已保持纯函数和无外部 I/O；后续由统一装配入口接入 service，不能把 Web、数据库或凭证依赖放回算法模块。

前端应用的安装、启动与环境变量说明见 [frontend/README.md](frontend/README.md)。默认为本地 Mock 演示模式（`VITE_API_MODE=mock`）；服务适配层已实现（0.6.0，`VITE_API_MODE=real` 调用应用后端，契约见 [frontend/docs/api-integration.md](frontend/docs/api-integration.md)），但后端 FastAPI 服务尚未实现、暂无法真实联调。后端 FastAPI 服务的启动命令、环境变量和依赖安装说明将在实现后补充。
