# 表面描点与全场理线：前端交接

日期：2026-10-18。独立分支 `codex/surface-connections`，基于整合提交 `29b2009`。开发工作树独立于 `F:/DormTopology`；未切换共享目录分支，未合并其他并行任务，未修改主页、公共样式、模型生成、碰撞箱或后端代码。

## 已实现的使用流程

进入工作台的「规划走线」模式，左侧打开「描点与连接检查」。选择任意可见物品，点击「在表面标记接口」，再点击其实际模型表面。输入名称、接口类型、受电角色和说明，保存后确认接口，点击两个接口建立连接。原有插排、墙面端点和线缆规格编辑继续沿用。

点位使用物品底面中心局部坐标保存，法向从真实命中网格经过完整法线矩阵变换取得，再逆变换到物品坐标。选择框、碰撞辅助框和预览箭头不用于确定端口位置。支持原生 GLB 的嵌套变换、编辑尺寸及 Y 旋转，不从物品外包盒推测点击位置。普通非电气物品也可手动添加接口。

按下与抬起的指针 ID 必须相同、屏幕位移不超过 4px 才形成一次描点；拖动相机不会新增点位，描点期间不移动其他物品。Esc、取消和切换项目不保存草稿。重新描点保留原端口 ID 及未保存的名称/说明；编辑过程中物品尺寸、位姿、模型或接口发生变化时拒绝保存旧草稿。已被线缆引用的接口不能直接删除，必须先移除或改接线缆。

全场检查扫描全部物品与线缆，包括隐藏物品，报告重复 ID、悬空引用、类型或用途不兼容、重复连接、端口占用、未确认端点、无效向量及当前后端不支持的音频物理接口。无需接线、无线、缺少接口、尚未连接与已建立连接分别展示。可选接口未使用、设备尚未接线属于用户复核提示，不凭类型兼容自动创建连接。

规划继续提交完整场景及全部已确认连线，包含未选中的障碍物和线路。结果先进入临时候选，不立即改写项目；三维虚线仅显示候选中的有效采样路径，不重新拟合样条，失败路径不作为有效连接展示。接受时核对输入签名、原始快照、当前候选身份及服务端正式版本，确认后一次写入本机并可撤销。取消、替换候选、编辑场景及过期版本均不能被迟到结果覆盖。

## 供工作台优化任务使用的组件入口

| 入口 | 宿主使用方式 |
| --- | --- |
| `src/features/connections/ConnectionsPanel.tsx` | 传入 `project` 与可选 `busy`，可直接挂入新的左侧物体工具区域；端点编辑、说明和连接审计独立于页面布局 |
| `src/features/connections/RoutingPreviewPanel.tsx` | 传入 `project`，可移到新的右侧任务结果区域；当前暂挂在 `CableListPanel` 顶部 |
| `src/features/connections/useSurfacePortPick.ts` | 接到 `SceneObjectMesh` 内层真实模型组，勿接到包含辅助线框的外层组 |
| `src/features/connections/SurfacePointOverlay.tsx` | 位于 R3F Canvas 内，消费临时描点状态，显示候选点及法向 |
| `src/features/connections/RoutingPreviewLayer.tsx` | 位于走线模式的 Canvas 内，绘制仍匹配当前输入/快照的候选路径 |

不要在最终工作台同时挂载两份可见编辑器。桌面完整描点与理线编辑已验收；手机范围是查看已保存标记和连接检查，不把它称为完整移动端编辑。

共享挂载点均为小范围修改：`SceneObjectMesh.tsx` 增加拾取事件与拖动互斥；`PortMarkers.tsx` 支持普通物品接口及说明；`Viewport.tsx` 添加两个叠加层；`CableListPanel.tsx` 挂载两个独立面板；`WorkspacePage.tsx` 在规划前审计，规划后改为候选暂存。合并时逐段保留其他 agent 的布局变化，不整文件覆盖。

## 供后端/API任务使用的边界

唯一空间协议仍为[数据契约](../../docs/data_contract.md)，本次没有新增后端接口或另一套 JSON 字段。

- `Port.localDirection?: Vec3` 与 `Port.note?: string` 是浏览器项目内部字段。前者序列化到契约已有的 `local_direction`，后者和名称保存在本机项目中；当前后端端口协议不保存名称/说明，跨设备同步需后续接口支持。
- 旧数据仍可只提供六向 `direction`，不需要数据重种或更改持久化 schema 版本。显式向量存在时优先使用并归一化。原六向编辑器修改方向时清除旧自由法向，避免用户选择被忽略。
- 新增或修改位置/方向/类型/供电角色后端点须重新确认；平移/旋转物品保留局部端点确认；修改尺寸清除确认。元信息编辑不改变几何。
- `src/features/connections/portGeometry.ts` 提供方向解析。`api/core/packingWire.ts` 和 `routingWire.ts` 只改已有 `local_direction` 的取值，未改变请求 URL 或整体载荷。
- 规划入口仍为 `services.cablePlanning.planCables`；现有 `api/http/index.ts`、任务轮询和结果解析继续负责网络及服务端协议。本任务未编辑 HTTP 服务注册文件。
- 候选阶段入口为 `useRoutingPreviewStore.stage(project, result, baselineId)`。`CablePlanningResult` 必须覆盖全部当前线缆，保留单线有效/失败状态和正式场景引用；不能只返回被选择的线路而漏掉其余线路。
- 当前 `acceptRoutingPreview` 位于独立的 `routingPreview.ts`，通过已有 `GET /projects/{id}/scene` 复核正式几何与版本，然后保存本机项目。界面明确写明本机保存；它不是服务端原子应用，也不宣称远端方案已被保存。后端增加应用接口后，在此边界接入条件写入并处理版本冲突，面板无需重写。
- 当前检查与提交仅分析用户确认的连接关系，不猜测设备应当接到哪个端口。如果新接口提供接线推荐，须先展示待确认建议，不能直接把推荐变成用户已确认连接。

## 验证方法与证据

在 `frontend/` 运行 `npm run build`。独立脚本可用已经安装的 esbuild 打包，不需要安装额外工具：

```powershell
node node_modules/esbuild/bin/esbuild scripts/check-surface-connections.ts --bundle --platform=node --format=esm --outfile=../.work/check-surface-connections.mjs '--define:import.meta.env={}'
node ../.work/check-surface-connections.mjs
node node_modules/esbuild/bin/esbuild scripts/check-routing-preview.ts --bundle --platform=node --format=esm --outfile=../.work/check-routing-preview.mjs '--define:import.meta.env={}'
node ../.work/check-routing-preview.mjs
```

`check-surface-connections` 检查旋转点位与法向、向量归一化、确认失效/保留、旧六向编辑覆盖、隐藏物品、重复占用、用途不匹配和传输字段。`check-routing-preview` 使用明确的传输夹具验证候选无提前写入、完整覆盖、取消/替换/场景编辑/服务端版本变化后的迟到响应，以及单步可撤销接受；它不作为真实算法几何验收。

新浏览器文件为 `tests/surface-connections.spec.ts`。既有 `backend-only-planning.spec.ts` 的真实走线用例仅补充候选预览和显式接受后再检查项目，其他失败/未确认语义保持。

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5190'
$env:PLAYWRIGHT_REAL_ORGANIZATION='1'
node node_modules/@playwright/test/cli.js test tests/surface-connections.spec.ts --workers=1
```

实际演示使用独立前端端口 5190，连接现有 8001 后端，不替换共享 5174 服务。为了复用依赖而使用的 `node_modules` 目录联接会共享 Vite 默认缓存，故本地临时配置指定独立缓存；正式代码不包含机器路径或新的全局构建配置。

最终实测：生产构建与类型检查通过；两个行为脚本通过；串行浏览器验收 **8 项通过、6 项按终端范围跳过**（约 1.6 分钟）。通过项为桌面描点/刷新/取消/重新定位/过期草稿拒绝、旋转物品描点、被引用接口删除保护、真实后端候选接受、已加载并修改尺寸/旋转的真实 GLB 拾取，以及既有真实理线用例在桌面与模拟手机各一次、手机已保存标记与全场检查查看。跳过项是手机完整描点编辑和桌面重复的手机专用查看，不计为通过。当前后端领域代码未修改，本次没有重跑或声称完成此前 217 项后端全量回归。

早期测试失败保留在 `.work/surface-connections/`：初次启动/导航超时、临时启动目录导致主题配置未加载、测试刷新后未重新取得相机、异步接口响应应为 202，以及手机查询需限定可见抽屉。未将这些失败记为通过，也未注入命中数据伪造描点。最终结果以同目录的最终验收日志为准；桌面与模拟手机截图已检查，未作真机验收。

## 委派记录

依项目要求，具体模块、测试、实际失败日志分析与草稿修复先委派给配置的 `deepseek-pro`；Codex 负责接口与模块边界、审查修正、集成和实际验收。5 次完整请求有记录用量合计 115,460 tokens；另外 2 次响应截断或有额外尾部导致解析失败，用量未知，仅恢复审查过的完整文件，失败回执保持原状。两个本地任务 JSON 格式错误在发送前失败，未把它们计作已调用模型。所有任务及回执均留在忽略目录，不包含凭证。
