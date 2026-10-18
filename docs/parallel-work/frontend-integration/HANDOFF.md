# 前端整合交接

## main 非敏感整合（2026-10-18）

用户随后授权“备份后整合”与“全部非敏感成果”，目标是将当前 `9d62e6f` 的结果合入本地 main；不是继续整合尚未吸收的功能分支，也不推送。

- 原 main 为 `948c0be`。105 个未提交/未跟踪文件已复制并逐文件校验，备份位于 `C:/Users/jdz/.codex/worktrees/main-merge-backup-20261018-9d62e6f/`，包含原文件、索引/工作树补丁和校验清单。
- 其中 69 个文件与既有快照 `e3de759` 完全一致，已经包含在整合来源中；其余 36 个未跟踪文件不加入提交、原位保留。接入路径采用先承接该快照、再快进重建提交，不使用 reset、stash 或覆盖式恢复。
- 从 `9d62e6f` 重建非敏感代码树，排除 `vlm/key.txt`、`vlm/rodin_key.txt` 及其历史；保留 main 的密钥忽略规则，不引入两条白名单。未读取这两份文件内容，也不改写原功能分支历史。
- 保留 main 通用 AGENTS，仅同步正式资产来源约束，不带入 integration 分支专用任务指令。后端/API 与其余功能文件沿用整合来源，不顺带修改算法或契约。
- 验证工作区为 `C:/Users/jdz/.codex/worktrees/main-safe-integration`，桌面服务为 `http://127.0.0.1:5218`；`npm run typecheck`、`VITE_API_MODE=mock npm run build` 通过（保留大 chunk 提示），`python -m pytest backend/tests -q` 为 **285 passed、361 subtests passed**。
- 桌面回归使用 `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5218`，运行 `parallel-project-creation / isolated-marking / parallel-model-quality / parallel-preview-camera / prefab-desktop / drawer / scene-rendering` 七个 spec，参数 `--project=desktop-chromium --workers=1 --timeout=120000`。首轮 **16 passed、2 failed**；失败为 `drawer.spec.ts:210` 的抽屉动画等待和 `scene-rendering.spec.ts:44` 的相机绘制等待，均为 5 秒谓词超时。后端回归结束后，原参数单独复跑两项得到 **2 passed**，未改代码或测试阈值；仍记录时序不稳定，不将首轮写成全通过。
- `/routing-demo` 与工作台的实心桌板/GLB 请求检查本轮均通过。1440×1000 的新建工作台及绘制回归截图已查看，场景非空、控件无重叠；6 条既有布局警示保留，不宣称几何零冲突或真实供应商验收。截图保存在验证工作区 `frontend/test-results/` 与 `frontend/test-results/main-retry/`，不提交。
- 尚未整合的 workspace-simple、result-playback，以及 85% 创建入口接线、全站主题挂载和指南清理仍保留为后续工作，本次合入不代表七条功能分支全部完成。

以下为创建流程整合及更早基线的历史记录，其中“不更新 main”是当时的授权范围，已由上面的本次授权取代。

## 创建流程整合进度（2026-10-18）

用户当时要求只整合本地任务分支，暂不处理 origin，不更新 main、不推送；影响功能和流程的冲突分批协商。已确认首页“创建项目”为主按钮、“体验示例”为次按钮，以及“两段创建＋草稿恢复，已有项目编辑后回工作台”。

- 已移植主题 `3d3ba23` → `a55673a`、默认尺寸 `6faff5f` → `42f9179`、模型 `9d886ba` → `dacca06`、预览相机 `e3d3010` → `62d968c`，各分支交接随附；尚未完成全部功能的联合回归。
- 本批处理创建分支 `1f12b99`：保留 `ProjectWorkspaceGate`、结果页及旧 guide/compare 跳转、独立描点路由；名称并入空间页，完成创建清除显式草稿标记，已有项目设置不重新走创建流程。
- 两侧存储 v4 合并为 v5：保留实心桌面旧数据迁移，保留已有 `creationDrafts`，没有标记的旧项目不按 stage 推断为草稿；草稿字典接入现有逐记录存储，避免其他标签页的保存抹掉草稿。
- 本批检查：`npm run typecheck`、`VITE_API_MODE=mock npm run build` 通过（仅既有大 chunk 提示）；`PLAYWRIGHT_BASE_URL=http://127.0.0.1:5208 npm run test:e2e -- tests/parallel-project-creation.spec.ts --project=desktop-chromium --workers=1 --timeout=120000` 为 **5 passed**，`tests/isolated-marking.spec.ts` 同参数为 **3 passed**。
- 5 项专项覆盖真实按钮完成创建、草稿恢复与工作台拦截、v4 旧项目/v4 已有草稿迁移、跨标签页存储合并；使用示例物品，不涉及真实识别、Rodin 或后端规划成功验收。截图 `frontend/test-results/parallel-project-creation--0a58d--completed-project-directly-desktop-chromium/created-workspace.png` 已检查：1440×1000、场景非空、控件无重叠；Playwright 使用 SwiftShader，不证明真实 GPU 性能。
- 开发服务：本 worktree 的 `http://127.0.0.1:5208`。本批未修改后端、前端 API、源资产或其他工作区。
- 待后续协商整合：workspace-simple、result-playback、85% 默认尺寸的创建页接线、全站主题挂载、指南彻底清理、分支合并记录与完整回归。`8baf733` 是 `6faff5f` 的重复移植，不重复应用；检查时 result-playback 提交顶点仍为任务说明 `7766722`，未将其算作已交付功能。
- 下列第 1–6 节为 `c678d43` 的历史交接，不代表当前全部检查通过；其中 `/routing-demo` 资产请求回归和抽屉时序问题本批没有复查。

## 历史基线：c678d43

`origin/main`（`567c9aa`）此前已合入 `codex/frontend-integration`，26 个冲突文件按 [MERGE-DECISIONS.md](MERGE-DECISIONS.md) 解决；历史验证结果见下文，本批未再同步远程。

- 共同基线：`e3de759ad223f2c541617924ae45d61c70d3cf33`
- 合并前本地快照：`5c37b91`（含书本姿态、抽屉阻挡提醒、按需绘制与渲染优化等未推送改动）
- 合并对象：`origin/main` = `567c9aa`（实心预制桌面 `36369e9`、统一抽屉偏移、背板/鼠标支撑、ResultPage、配置页精简）
- 七条并行功能分支（frontend-visual / project-creation / workspace-simple / result-playback / model-quality / object-defaults / preview-camera）当前只有任务说明提交，没有产品实现可合；功能落地后按本文件“跨分支接口”一节接线。

## 1. 实际改动

- 合并提交：`codex/frontend-integration` 上的 `merge origin/main` 提交，包含 26 个冲突文件的解决结果。
- 冲突文件：`docs/data_contract.md`、`docs/implementation_roadmap.md`、`frontend/src/App.tsx`、`api/core/packingWire.ts`、`data/demoProject.ts`、`features/connections/MarkingPage.tsx`、`scene/{DormDeskModel,ObjectModel,ObjectResizeHandles,ParametricDesk,SceneObjectMesh,collisionGeometry,sceneValidation,useObjectDrag}.ts(x)`、`state/{drawerStore,workspaceStore}.ts`、`ui/home/home.css`、`ui/layout/AppShell.tsx`、`ui/pages/{ImportPage,SpaceSetupPage,WorkspacePage}.tsx`、`ui/workspace/{PlanPanel,StatusBar,Toolbar,Viewport}.tsx`、`tests/cable-management.spec.ts`。
- 整合口径摘要：
  - 桌面：只保留 GLB 实心桌板一层，保留浅色材质、共面裁剪、按需绘制与抽屉点击；`DormDeskModel` 是抽屉 progress 唯一推进者，`SceneLighting` 的 drawer 订阅负责唤醒 demand canvas。
  - 抽屉/支撑：统一 `DrawerOffsets`（米制）+ `drawerDisplayPosition`/`drawerDisplayObjects` + `SupportHit.surfaceId` + 背板支撑；本地 `blockingDrawerOpening` 阻挡提醒改为先把显示坐标换回关闭态坐标再判定，避免抽屉打开时误报；「物品落进抽屉自动开抽屉」保留。
  - 书本：`book_pose` 全链路保留（碰撞缓存键同时含 `bookPose` 与 `powerStrip.mount`、`ObjectModel` 旋转包裹、`SceneObjectMesh` 显示尺寸与轮廓、`ResizeHandles` 对角换算、`packingWire` 上传/回读校验）；契约里与远程 `surface_mount`、桌面区域、支撑字段并存。
  - 路由：新增 `/projects/:id/result`；`/guide`、`/compare` 通过 `LegacyResultRedirect` 兼容跳转到结果页，无死链、无未使用 import；工作台保留嵌套路由 `objects/:objectId/ports` → `ObjectPortsPage` 作为唯一描点状态源，远程会话覆盖层与双 canvas 已删除。
  - 界面：工作台 1–4 步、指南导出/打印入口退场；左侧物体/连线、右侧「整理与理线」；远程移动端 Drawer、断点类、`pointer: coarse`、小屏 matchMedia 分支一律未恢复；`home.css` 仅保留 `prefers-reduced-motion`。
  - 数据：`demoProject` 种子版本取 9，两侧版本条目都保留；配置页取远程精简（去掉书架分层/出线孔/重复摘要），补「实心桌面按模型原样显示」说明。
- 为让合并后行为可验证而一并修正的测试与注释：
  - `tests/drawer.spec.ts`：`raycastSupports` 第 4 参改为米制偏移 `{ top: -.3 }`，命中改断言 `surfaceId === 'support-drawer-top'` 与显示坐标 x=0.48（旧断言读已删除的 `hit.drawerSlot`，且旧语义是比例）。
  - `tests/scene-rendering.spec.ts`：旧的 `/compare`+`/guide` 导出截图用例改为结果回放用例（跳转断言 + 画布几何 + 播放/上一步/按住查看摆放前）。
  - `tests/workspace-ui-polish.spec.ts`：右栏标签改为实际 `整理与理线`，走线按钮改为 `生成走线`。
  - `tests/workspace.spec.ts`：配置页书架/出线孔控件改为「不存在」断言（精简后的真实现状）。
  - `tests/home.spec.ts`：帮助面板改为断言当前四步文案；按“仅桌面端”范围退役 390/320/768 视口用例。
  - `scene/furnitureAppearance.ts` 注释与 `frontend/docs/scene-rendering.md` 更正为「GLB 实心桌板按原样显示，不再叠穿孔桌面」。

## 2. 本地验证

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `frontend/node_modules/.bin/tsc --noEmit -p frontend/tsconfig.json` | 0 error |
| 构建 | `VITE_API_MODE=mock` + `vite build` | 成功（仅 chunk >500kB 既有告警） |
| 后端 | `python -m pytest backend/tests -q` | 285 passed，361 subtests passed（本地临时安装 pytest/pydantic/fastapi/python-multipart） |
| 前端回归 | `playwright test tests/{home,workspace,drawer,scene-rendering,workspace-ui-polish,prefab-desktop,thin-contact,book-organization,primitive-geometry}.spec.ts --project=desktop-chromium --workers=1 --timeout=180000` | 26 passed / 2 failed，见第 6 节 |

- 日志：`.task-artifacts/integration-playwright.log`（未提交），截图与 trace 在 `frontend/test-results/`（已忽略）。
- 复跑命令（integration worktree 的 `frontend/` 下，需先把主工作区 `frontend/node_modules` 以 junction 链入本 worktree）：
  `./node_modules/.bin/playwright.cmd test <spec> --project=desktop-chromium --workers=1 --timeout=180000`

## 3. 跨分支接口（后续功能分支接线点）

- `frontend/src/state/workspaceStore.ts`：`DragState = { objectId, position, displayPosition?, object?, support: 'desk'|'shelf'|'drawer'|'beam'|'floor'|'backboard'|'none', valid, lastValid }`，**已无 `drawerSlot`**。
- `frontend/src/scene/sceneValidation.ts`：`raycastSupports(ray, room, metrics?, offsets: DrawerOffsets = {}, object?)`；`SupportHit` = `{ kind, y, label, surfaceId?, x, z, rayDistance }`；`placementIssues(object, displayPosition, objects, room, metrics?, offsets?)`；`validateScene(objects, room, metrics?, offsets?)`。
- `frontend/src/state/drawerStore.ts`：新增 `closeAll`、`currentDrawerOffsets`、`useDrawerOffsets`。
- `frontend/src/ui/workspace/Toolbar.tsx`：props 已去掉 `plansOpen` 与面板开合回调；`onPlanCables` 仍保留未用，接线时确认后再决定去留。
- `frontend/src/features/connections/MarkingPage.tsx`：回调统一 `onObjectChange` / `onExit`（与 `ObjectPortsPage` 一致）。
- 路由：`/projects/:id/result`（ResultPage）、`/guide`、`/compare`（均 redirect 到 result）。
- 已无引用的模块可按需清理：`ui/pages/GuidePage.tsx`、`ui/pages/PlanComparePage.tsx`、`ui/workspace/IsolatedObjectViewport.tsx`（本轮未删，保留历史实现）。

## 4. 未完成 / 风险

- **本地 main 未更新**：主工作区 `F:\DormTopology` 仍有大量已跟踪修改与未跟踪文件（属于用户/他人工作），快进 main 会覆盖这些修改。清理或提交后执行：`git -C F:\DormTopology merge --ff-only codex/frontend-integration`。未推送任何分支。
- 无后端服务的环境下未执行依赖真实后端接口的前端用例：`organization-backend`、`cable-management`、`surface-connections`、`backend-only-planning`、`workflow`、`scene-sync` 等，需与后端负责人联跑。
- 依赖 `tsx` 的脚本（`check-workstation-zones.ts`、`check-project-persist-migrate.ts` 及 `check-*.ts` 系列）未运行，仅做静态比对。
- `projectsStore.ensureDemo` 目前只有 v6→v7 原位迁移；示例种子已到 v9，本地 v7/v8 用户的内置示例会走「归档 + 重种」（编辑内容保留在归档项目里）。是否补 7→9 原位迁移需产品确认，本轮未改迁移语义。
- 后端文件随 `origin/main` 原样合入（`routing/optimizer.py`、新增 `routing/orthogonal.py` 等），未手工编辑；`frontend/src/api/core/routingWire.ts` 本轮无任何改动。

## 5. 边界确认

- 未修改后端理线 API 与契约实现，未在共享转换文件里顺带整理理线逻辑。
- 在隔离 worktree（`C:\Users\jdz\.codex\worktrees\frontend-parallel-probe\DormTopology`）内工作，未切换他人分支、未覆盖他人修改、未强推、未推送。

## 6. 冻结状态与未决问题（交接给下一位 agent）

本轮已按用户要求冻结在合并提交上，工作区干净、可随时继续。

**未决问题 1（唯一的合并引入回归）**：`tests/prefab-desktop.spec.ts` 的 `/routing-demo` 用例失败在 `expect(assets.size).toBe(4)`（收到 0）。
- 现象：`/routing-demo` 下 2 个 `Desk_Top_*` 可见网格存在（poll 通过），但没有任何 `/models/dormdesk_parts/*.glb` 的 200 响应；同一测试的工作台路由用例通过，`workspace.spec.ts` 里工作台的 4 个 GLB 请求也正常。
- 已核验：该文件是 `origin/main` 独有测试；`origin/main` 探针 worktree（`C:\Users\jdz\.codex\worktrees\origin-main-probe`，detached `567c9aa`，已链入同一 `node_modules`）上 `prefab-desktop.spec.ts` 两条用例 34.6s 全通过，因此确认是本次合并引入。
- 首要怀疑点（按排查优先级）：`scene/ParametricDesk.tsx` 的 `buildFixedDesk` 现在用预制件名（如 `Desk_Top_Left/Right`）命名回退网格，使「可见 `Desk_Top_*`」在 GLB 未加载的回退路径下也成立，于是 poll 通过而 GLB 实际没加载；下一步应确认 `/routing-demo` 里 `useDeskModelStore.status` 是否停在 `failed`/未加载（8 秒等待后读取 store，或临时挂 `page.on('pageerror')` 打印），再对比 `DormDeskModel` 中 `prepareFurnitureAppearance(body)`、`useLayoutEffect(applyBedCutaway)` 与抽屉单一 `useFrame` 推进是否让加载流程抛错。
- 排查入口：`frontend/src/scene/DormDeskModel.tsx`（加载 effect、`prepareFurnitureAppearance` 调用、父级 `useFrame`）、`frontend/src/scene/ParametricDesk.tsx`（回退几何与命名）、`frontend/src/scene/furnitureAppearance.ts`（首次被用到桌体 GLB 上）。

**未决问题 2（并发下的偶发超时）**：`tests/drawer.spec.ts:143` 与 `tests/workspace.spec.ts:135` 在默认 `--workers=2`、软件渲染（SwiftShader）下曾因资源争用超时；单独复跑均通过（drawer 两条、workspace:135 17.1s）。冻结批次里 `drawer.spec.ts:143` 再次在单 worker 长跑中失败一次，属同一类时序抖动，建议下一轮用 `--workers=1` 且单独复跑确认稳定后再判定。

**已就绪、不要重复做的事**：26 个冲突文件已全部解决（无残留标记）、类型检查 0 error、构建通过、后端 285 用例通过、路由/抽屉/书本/桌面口径已按 [MERGE-DECISIONS.md](MERGE-DECISIONS.md) 落地；`docs/data_contract.md` 与 `docs/implementation_roadmap.md` 已合并两侧口径。`origin-main-probe` worktree 仅用于基線对照，用完可 `git worktree remove --force` 删除。
