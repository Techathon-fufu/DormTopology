# 表面描点与全场理线：进展、工作思路与交接文档

日期：2026-10-18。独立分支 `codex/surface-connections`，基于整合提交 `29b2009`。开发工作树独立于 `F:/DormTopology`；未切换共享目录分支，未合并其他并行任务，未修改主页、公共样式、模型生成、碰撞箱或后端代码。

## 当前结论与交付位置

本轮负责产品 roadmap 中“用户在物体上手动描点并支持标记信息，并对场上所有物体的连线逻辑进行分析、生成理线方案”的前端部分。桌面操作闭环已经实现并完成实际验收；跨设备标记同步、服务端原子应用仍需后端接口支持。此结论只覆盖本任务，不代表整个项目 roadmap 已完成。

| 项目 | 当前状态 | 交付或限制 |
| --- | --- | --- |
| 真实表面描点、局部坐标与法向 | 已完成并验证 | 简化模型和真实 GLB；支持尺寸变化与旋转后的拾取 |
| 名称、类型、角色、说明及重新描点 | 已完成并验证 | 本机保存；重新描点保留端口 ID，过期草稿拒绝写入 |
| 描点入口：物品右键 → 全屏描点页面 | 已完成并验证 | 一般模式不渲染描点控件；页面为会话态覆盖层，不切路由、不重挂三维视图 |
| 全场连接关系检查 | 已完成并验证 | 包括隐藏物品；条目可「定位」到物品与接口；区分阻断问题与人工复核提示 |
| 请求真实后端规划 | 已接入并验证 | 沿用现有服务与轮询；当前协议未来可调整 |
| 候选路径、失败原因、显式接受及撤销 | 已完成并验证 | 接受前检查正式版本；只应用算法验证通过的有效路径，失败线路保持原状 |
| 服务端原子应用候选结果 | 待后端支持 | 当前 GET 版本复核与本机写入之间不具备服务端事务保证 |
| 名称与说明跨设备同步 | 待后端支持 | 当前端口协议不持久化这些信息 |
| 自动推断“应如何接线”并推荐 | 本轮未实现 | 当前分析用户已确认关系；未来推荐必须由用户确认 |
| 手机查看 | 已完成模拟设备验收 | 走线面板入口可打开描点页面查看标记、审计与结果；完整手机编辑及物理真机未验收 |

代码位置：`C:/Users/jdz/.codex/worktrees/surface-connections/DormTopology`。GitHub 仓库：[Techathon-fufu/DormTopology](https://github.com/Techathon-fufu/DormTopology)。分支：`codex/surface-connections`；本次文档整理前，以下两个功能提交已推送至同名远端分支：

- `c9a9199` — `feat: add surface endpoint editing and guarded routing previews`
- `4360abf` — `feat: mount surface connection tools and verify frontend routing flow`

最近验收使用的本地页面：`http://127.0.0.1:5190/projects/demo-dorm-101/workspace`，后端为 `http://127.0.0.1:8001`。这是本地联调地址，文档编写时未重新探测进程存活；服务启动方法以当前工程 README 和配置为准。

## 工作思路与实现依据

### 1. 将交互、空间数据和页面布局分开

描点工具放在独立的 `features/connections` 模块，由现有工作台挂载。这样工作台优化任务可以调整面板位置，模型任务可以更新外观与碰撞，后端任务可以演进协议，而不必重写描点交互。最小共享修改只用于事件、方向解析、保存与规划入口。

真实模型只决定用户点击的位置；接口仍使用既有底面中心局部坐标与米制规范。命中法向先经过网格完整变换，再转换到物品局部空间，避免把嵌套 GLB、非均匀缩放或旋转误当成简单盒体。移动物品后继续由局部接口推导世界几何，避免端点留在旧位置。

### 2. 将连接语义检查和物理路径计算分开

前端先检查 ID 引用、端点确认、接口用途、占用等用户可以修正的问题；真实后端继续负责路径、碰撞、净空与长度判定。未连接设备可以提示复核，但不因为接口看起来兼容就自动生成用户已确认连线。前端绘制后端验证过的采样路径，失败结果展示原因，不用平滑曲线掩盖失败。

### 3. 先形成候选，再由用户接受

描点草稿和理线候选均为临时状态。只有用户保存端点或接受有效候选才修改项目，后者形成一次可撤销操作。异步请求返回时需要检查原输入、场景快照与候选身份；仅比较场景 ID 不足以阻止旧请求覆盖新编辑。

接受候选前再次读取服务端正式场景，检查版本和几何；等待期间如果用户取消、换候选或编辑场景，则拒绝迟到结果。当前实现对浏览器本机状态进行防护；未来服务端应用仍必须提供带预期版本的原子条件写入。

### 4. 将接口变化限制在适配边界

不新增与数据契约同义的传输字段。自由法向使用前端可选字段表示，在现有 wire adapter 中映射到 `local_direction`；旧六向数据继续可读。后端接口更新优先调整服务适配与 `routingPreview.ts` 接受边界，再通过契约和回归检查验证，不让协议细节散落到展示组件。

## 已实现的使用流程

一般工作台（编辑 / 整理 / 走线任一模式）不渲染任何描点控件。描点入口是先选中或直接右键物品，在右键菜单里选「表面描点」，进入全屏的描点页面；该页面是工作台内的会话态覆盖层，不改路由、不刷新、不重挂三维视图，退出后回到原模式。走线模式左侧另有一个「描点与连接检查」按钮，供键盘操作与手机端进入同一页面。

描点页面内完成全部操作：上部是标题、当前物品与「返回工作台」，右侧（手机为底部抽屉）是物品下拉、在表面标记接口、接口列表（编辑标记 / 确认接口 / 以此点连线 / 删除）、撤销与全场检查。物品下拉包含隐藏物品并标注「已隐藏」，隐藏物品可查看与确认已有接口、不能描点。点击「在表面标记接口」后点击其实际模型表面，输入名称、接口类型、受电角色和说明，保存后确认接口，点击两个接口建立连接。原有插排、墙面端点和线缆规格编辑继续沿用。

点位使用物品底面中心局部坐标保存，法向从真实命中网格经过完整法线矩阵变换取得，再逆变换到物品坐标。选择框、碰撞辅助框和预览箭头不用于确定端口位置。支持原生 GLB 的嵌套变换、编辑尺寸及 Y 旋转，不从物品外包盒推测点击位置。普通非电气物品也可手动添加接口。

按下与抬起的指针 ID 必须相同、屏幕位移不超过 4px 才形成一次描点；拖动相机不会新增点位，描点期间不移动其他物品。Esc、取消和切换项目不保存草稿。重新描点保留原端口 ID 及未保存的名称/说明；编辑过程中物品尺寸、位姿、模型或接口发生变化时拒绝保存旧草稿。新描点面板禁止直接删除已被线缆引用的接口，必须先移除或改接线缆；此保护不代表旧编辑器的所有删除入口均已改造，其他入口产生的悬空引用由全场审计阻止进入规划。

全场检查扫描全部物品与线缆，包括隐藏物品，报告重复 ID、悬空引用、类型或用途不兼容、重复连接、端口占用、未确认端点、无效向量及当前后端不支持的音频物理接口。无需接线、无线、缺少接口、尚未连接与已建立连接分别展示。可选接口未使用、设备尚未接线属于用户复核提示，不凭类型兼容自动创建连接。每条阻断问题带对象与接口标识，点「定位」即切到该物品并高亮对应接口——这解决了「未确认端口的修复入口找不到」的问题：隐藏物品同样能定位并确认。

规划继续提交完整场景及全部已确认连线，包含未选中的障碍物和线路。结果先进入临时候选，不立即改写项目；三维虚线仅显示候选中的有效采样路径，不重新拟合样条，失败路径不作为有效连接展示。接受时核对输入签名、原始快照、当前候选身份及服务端正式版本，确认后**只把算法验证通过的有效路径**写入本机（一次可撤销），失败线路保持原状并在提示中如实报数；取消、替换候选、编辑场景及过期版本均不能被迟到结果覆盖。

## 供工作台优化任务使用的组件入口

| 入口 | 宿主使用方式 |
| --- | --- |
| `src/features/connections/MarkingPage.tsx` | 全屏描点页面，位于三维视口容器内、`Viewport` 之后；传入 `project`、`objectId`、可选 `busy` 与 `onExit`。打开时宿主隐藏工具栏、左右面板与状态栏，但保持 `Viewport` 在同一树位，Canvas 不重挂 |
| `src/features/connections/ObjectContextMenu.tsx` | 物品右键菜单，`fixed` 定位到指针处；传入 `x/y/title/items/onClose`。当前唯一菜单项是进入描点页面，后续加条目不需要改页面 |
| `src/features/connections/RoutingPreviewPanel.tsx` | 传入 `project`，可移到新的右侧任务结果区域；当前暂挂在 `CableListPanel` 顶部 |
| `src/features/connections/useSurfacePortPick.ts` | 接到 `SceneObjectMesh` 内层真实模型组，勿接到包含辅助线框的外层组 |
| `src/features/connections/SurfacePointOverlay.tsx` | 位于 R3F Canvas 内，消费临时描点状态，显示候选点及法向 |
| `src/features/connections/RoutingPreviewLayer.tsx` | 位于走线模式的 Canvas 内，绘制仍匹配当前输入/快照的候选路径 |

桌面完整描点与理线编辑已验收；手机范围是查看已保存标记和连接检查，不把它称为完整移动端编辑。

共享挂载点均为小范围修改：`SceneObjectMesh.tsx` 增加拾取事件、右键上报与拖动互斥；`PortMarkers.tsx` 支持普通物品接口及说明；`Viewport.tsx` 添加两个叠加层并透传 `onObjectContextMenu`；`CableListPanel.tsx` 只保留「描点与连接检查」入口按钮，不再内嵌描点面板；`WorkspacePage.tsx` 持有描点页面与右键菜单的会话状态、在规划前审计，规划后改为候选暂存。合并时逐段保留其他 agent 的布局变化，不整文件覆盖。

## 供后端/API任务使用的边界

唯一空间协议仍为[数据契约](../../docs/data_contract.md)，本次没有新增后端接口或另一套 JSON 字段。

- `Port.localDirection?: Vec3` 与 `Port.note?: string` 是浏览器项目内部字段。前者序列化到契约已有的 `local_direction`，后者和名称保存在本机项目中；当前后端端口协议不保存名称/说明，跨设备同步需后续接口支持。
- 旧数据仍可只提供六向 `direction`，不需要数据重种或更改持久化 schema 版本。显式向量存在时优先使用并归一化。原六向编辑器修改方向时清除旧自由法向，避免用户选择被忽略。
- 新增或修改位置/方向/类型/供电角色后端点须重新确认；平移/旋转物品保留局部端点确认；修改尺寸清除确认。元信息编辑不改变几何。
- `src/features/connections/portGeometry.ts` 提供方向解析。`api/core/packingWire.ts` 和 `routingWire.ts` 只改已有 `local_direction` 的取值，未改变请求 URL 或整体载荷。
- 规划入口仍为 `services.cablePlanning.planCables`；现有 `api/http/index.ts`、任务轮询和结果解析继续负责网络及服务端协议。本任务未编辑 HTTP 服务注册文件。
- 候选阶段入口为 `useRoutingPreviewStore.stage(project, result, baselineId)`。`CablePlanningResult` 必须覆盖全部当前线缆，保留单线有效/失败状态和正式场景引用；不能只返回被选择的线路而漏掉其余线路。
- 当前 `acceptRoutingPreview` 位于独立的 `routingPreview.ts`，通过已有 `GET /projects/{id}/scene` 复核正式几何与版本，然后保存本机项目。它只把 `isValidRoute` 通过的有效路径按线缆 id 合并回当前项目，失败线路保持原状，并返回 `{applied, skipped}` 供界面如实报数。界面明确写明本机保存；它不是服务端原子应用，也不宣称远端方案已被保存。后端增加应用接口后，在此边界接入条件写入并处理版本冲突，面板无需重写。
- 当前检查与提交仅分析用户确认的连接关系，不猜测设备应当接到哪个端口。如果新接口提供接线推荐，须先展示待确认建议，不能直接把推荐变成用户已确认连接。

## 验证方法与证据

在 `frontend/` 运行 `npm run build`。独立脚本可用已经安装的 esbuild 打包，不需要安装额外工具：

```powershell
node node_modules/esbuild/bin/esbuild scripts/check-surface-connections.ts --bundle --platform=node --format=esm --outfile=../.work/check-surface-connections.mjs '--define:import.meta.env={}'
node ../.work/check-surface-connections.mjs
node node_modules/esbuild/bin/esbuild scripts/check-routing-preview.ts --bundle --platform=node --format=esm --outfile=../.work/check-routing-preview.mjs '--define:import.meta.env={}'
node ../.work/check-routing-preview.mjs
```

`check-surface-connections` 检查旋转点位与法向、向量归一化、确认失效/保留、旧六向编辑覆盖、隐藏物品、重复占用、用途不匹配和传输字段。`check-routing-preview` 使用明确的传输夹具（一条有效 + 一条必然失败）验证候选无提前写入、完整覆盖、取消/替换/场景编辑/服务端版本变化后的迟到响应、只应用有效路径（失败线路逐字段保持不变）与单步可撤销接受；它不作为真实算法几何验收。

新浏览器文件为 `tests/surface-connections.spec.ts`。既有 `backend-only-planning.spec.ts` 的真实走线用例仅补充候选预览和显式接受后再检查项目，其他失败/未确认语义保持。

```powershell
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5190'
$env:PLAYWRIGHT_REAL_ORGANIZATION='1'
node node_modules/@playwright/test/cli.js test tests/surface-connections.spec.ts --workers=1
```

实际演示使用独立前端端口 5190，连接现有 8001 后端，不替换共享 5174 服务。为了复用依赖而使用的 `node_modules` 目录联接会共享 Vite 默认缓存，故本地临时配置指定独立缓存；正式代码不包含机器路径或新的全局构建配置。

本轮（右键入口与只应用有效路径的改动）实测：`tsc --noEmit` 与 `vite build` 通过（仅既有的 chunk 体积提示）；两个行为脚本通过；`tests/surface-connections.spec.ts` 串行 **5 项通过、7 项跳过**（约 1.4 分钟，未启动 8001 后端）。通过项为桌面右键→描点页面全流程（描点/刷新/取消/重新定位/过期草稿拒绝）、旋转物品描点、被引用接口删除保护、已加载并修改尺寸/旋转的真实 GLB 拾取、手机经走线面板入口查看标记与全场检查。跳过项是手机端完整描点编辑、桌面重复的手机专用查看，以及需要 `PLAYWRIGHT_REAL_ORGANIZATION=1` 的真实后端候选接受用例——**本轮没有真实后端在跑，所以该项没有被验证，也不计为通过**。当前后端领域代码未修改，本次没有重跑或声称完成此前 217 项后端全量回归。

已修正的测试容差与取点时序：`project()` 先等相机动画稳定再投影（此前刷新或切视角后取点会偶发落到别处），一次真实点击落点的世界坐标存在约 1mm 的像素量化误差，原先按 0.5mm 断言会偶发失败，现按 5mm 断言。两处都只调整断言与等待，不修改拾取实现。

早期测试失败保留在 `.work/surface-connections/`：初次启动/导航超时、临时启动目录导致主题配置未加载、测试刷新后未重新取得相机、异步接口响应应为 202，以及手机查询需限定可见抽屉。未将这些失败记为通过，也未注入命中数据伪造描点。最终结果以同目录的最终验收日志为准；桌面与模拟手机截图已检查，未作真机验收。

## 委派记录

依项目要求，具体模块、测试、实际失败日志分析与草稿修复先委派给配置的 `deepseek-pro`；Codex 负责接口与模块边界、审查修正、集成和实际验收。5 次完整请求有记录用量合计 115,460 tokens；另外 2 次响应截断或有额外尾部导致解析失败，用量未知，仅恢复审查过的完整文件，失败回执保持原状。两个本地任务 JSON 格式错误在发送前失败，未把它们计作已调用模型。所有任务及回执均留在忽略目录，不包含凭证。

本轮改动（右键菜单入口、全屏描点页面、接受时只应用有效路径、审计条目定位、测试容差修正）未再委派外部模型，由本机实现并按下文命令验收。

## 文件归属与合并建议

所有下列路径相对于仓库根目录。前端功能主目录为 `frontend/src/features/connections/`，包括 `MarkingPage.tsx`（全屏描点页面）、`ObjectContextMenu.tsx`（物品右键菜单）、`model.ts`、`portGeometry.ts`、`store.ts`、`useSurfacePortPick.ts`、`SurfacePointOverlay.tsx`、`routingPreview.ts`、`RoutingPreviewPanel.tsx` 与 `RoutingPreviewLayer.tsx`。原 `ConnectionsPanel.tsx` 已由 `MarkingPage.tsx` 取代并删除。

配套修改涉及 `frontend/src/types/project.ts`、`frontend/src/scene/ports.ts`、`frontend/src/state/workspaceStore.ts`、现有 packing/routing wire adapter，以及前述场景与页面挂载点。验证文件为 `frontend/scripts/check-surface-connections.ts`、`frontend/scripts/check-routing-preview.ts`、`frontend/tests/surface-connections.spec.ts`，以及既有真实理线测试的小范围调整。

| 并行任务 | 对接内容 | 合并时重点 |
| --- | --- | --- |
| 工作台页面优化 | 全屏描点页面、物品右键菜单、两个 Canvas 叠加层、规划候选入口 | 保留最新页面布局；页面与菜单是会话态，不要改成路由级页面或整文件替换 |
| 后端理线 API | 现有规划服务、wire adapter、候选接受边界 | 确认全量结果覆盖、失败语义、场景版本、条件应用接口 |
| 手动生成模型碰撞箱 | 模型替换、尺寸与确认失效 | 保留端口 ID/局部坐标/说明；尺寸或接口几何变化后要求重新确认 |
| 主页美化 | 无直接接入点 | 本任务未修改主页和公共样式 |

接手前先确认所在工作树、分支与 `git status`，保留其他 agent 的修改。建议先比较整合基线 `29b2009` 与本分支，再在干净的整合工作树合并本分支；共享页面冲突由整合者逐段处理。不要为合并本任务而切换仍有其他 agent 在工作的共享目录分支，不覆盖他人文件，不强制推送。

## 尚未完成与建议接续顺序

1. **先与后端确定应用语义。** 明确预期场景版本、原子应用、冲突响应和应用后的新版本。将正式写入接到 `acceptRoutingPreview`，服务端成功后再更新浏览器状态；保留取消、替换和等待期间编辑的保护。当前 GET 检查不能替代服务端原子版本校验。
2. **确认元信息持久化协议。** 决定名称与说明的正式字段、读写和旧数据兼容方式。当前它们只在浏览器项目中保存，不应宣称已跨设备同步。
3. **由工作台任务整合描点页面位置与样式。** 页面目前是覆盖在视口容器内的会话层，右侧卡片（手机为底部抽屉）。调整布局时保留 Canvas 叠加层、拾取事件、右键入口和规划前审计，并复测桌面完整流程与手机查看。
4. **如需推荐连接，增加待确认步骤。** 推荐结果需要明确来源、目标和理由，由用户确认后才能进入正式线缆集合。此项不能用当前审计功能冒充完成。
5. **整合最新 API 后重新做真实验收。** 至少覆盖有效路线、失败原因、版本冲突、取消后迟到响应、模型替换、端点确认变化及撤销。本轮验证不能自动视为未来接口版本已通过。

## 接手者可复现的验收步骤

1. 按工程实际配置启动后端与本分支前端，打开工作台并确认 3D 场景和物品加载。
2. 右键任一物品选「表面描点」进入全屏描点页面，确认工具面板消失、三维视图没有刷新或重挂；进入与退出都不触发路由跳转。
3. 选择普通物品，在真实表面描点，填写名称、类型、角色和说明并保存；刷新确认标记与说明保留。旋转物品后检查接口跟随。
4. 重新描点，检查原端口 ID 及未保存说明被保留；按 Esc 或取消确认草稿未落盘。编辑中改变物品尺寸，确认旧草稿被拒绝。
5. 确认端点并建立连接，查看全场审计；检查被引用端点的删除保护。加入错误引用或未确认连接时，应阻止规划并给出原因；点审计条目的「定位」应切到该物品（含隐藏物品）并高亮接口。
6. 调用真实规划，确认结果先显示为候选，当前项目线缆未提前改变；检查单线有效/失败状态、原因及有效路径。
7. 接受候选，确认服务端版本检查成功后只有有效路径写入本机且可单步撤销，失败线路保持原状；取消、编辑场景或换候选后不应被迟到返回覆盖。
8. 在模拟手机经走线面板「描点与连接检查」查看保存的标记、全场检查和结果，确认可读、无明显重叠；完整手机编辑不在本次完成范围。

## 验收留痕与交付限制

最终日志为本开发工作树中的 `.work/surface-connections/acceptance.log`，截图包括 `glb-picking.png`、`surface-mobile.png`、`routing-accepted-desktop.png` 与 `surface-port-desktop.png`，均位于同目录。`.work` 是忽略目录，日志、临时配置和截图未随功能提交推送；换机器接手应按上述方法重新生成证据。

本轮（右键入口 + 只应用有效路径）的 5 项通过、7 项跳过由下面这条命令产生：未启动后端、未设置 `PLAYWRIGHT_BASE_URL`，由 Playwright 自带 `webServer` 在 4174 起 Vite，真实后端用例按环境变量跳过。

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/jdz/AppData/Local/ms-playwright'
node frontend/node_modules/@playwright/test/cli.js test --config frontend/playwright.config.ts frontend/tests/surface-connections.spec.ts --workers=1 --grep 'surface port marking|real service routing|mobile can|picks a loaded GLB' --trace=off
```

上一轮（含真实后端 8001、含 `backend-only-planning.spec.ts`）8 项通过、6 项跳过的命令保留如下，接续者启动后端后可重跑以覆盖真实走线与候选接受：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/jdz/AppData/Local/ms-playwright'
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5190'
$env:PLAYWRIGHT_REAL_ORGANIZATION='1'
node frontend/node_modules/@playwright/test/cli.js test --config frontend/playwright.config.ts frontend/tests/surface-connections.spec.ts frontend/tests/backend-only-planning.spec.ts --workers=1 --grep 'surface port marking|real service routing|mobile can|picks a loaded GLB|plans a verified route' --trace=off --output=.work/surface-connections/acceptance-results
```

换机器时应设置本机实际浏览器路径或按现有工程方式安装浏览器，不复制上述用户目录。生产构建仍有既有大体积 chunk 提示，本轮未扩展到打包性能优化。真实后端浏览器验收覆盖指定用例，不代表任意完整 17 件场景、所有模型和所有连线组合都已验证可行。

本文件统一承载本任务进展、工作思路及交接内容；后续以实际提交、接口契约和新验收结果更新，不把计划项直接改为已完成。
