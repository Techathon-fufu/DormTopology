# 前端并行任务总表（2026-10-18）

本轮只准备分支、独立工作目录和交接说明，不代表各功能已实现或 agent 已自动启动。

共同基线：`e3de759ad223f2c541617924ae45d61c70d3cf33`，对应本地主工作区的冻结快照；原 main 与真实索引保持原样。远程参考为 `567c9aaee8bdd509087ce9c648fa20497b4b689a`，尚未全量合并。不得把这些分支误当作已整合远程 main 的版本。

产品方向：我的空间 → 创建项目（空间、物品两段）→ 项目工作台 → 整理动画最终页。仅桌面端；后端理线 API 及契约禁止改动。

| 分支 | 负责人任务 | 独立端口 | 开始文件 |
| --- | --- | --- | --- |
| codex/frontend-visual | 统一全站视觉与主题 | 5201 | 根目录 AGENTS.md；docs/parallel-work/frontend-visual/HANDOFF.md |
| codex/project-creation | 创建项目流程与导航 | 5202 | 根目录 AGENTS.md；docs/parallel-work/project-creation/HANDOFF.md |
| codex/workspace-simple | 工作台简化与接口描点整合 | 5203 | 根目录 AGENTS.md；docs/parallel-work/workspace-simple/HANDOFF.md |
| codex/result-playback | 整理动画最终页与指南退场 | 5204 | 根目录 AGENTS.md；docs/parallel-work/result-playback/HANDOFF.md |
| codex/model-quality | 模型稳定显示、杯底修复与物品配色 | 5205 | 根目录 AGENTS.md；docs/parallel-work/model-quality/HANDOFF.md |
| codex/object-defaults | 新建物品默认尺寸缩小至85% | 5206 | 根目录 AGENTS.md；docs/parallel-work/object-defaults/HANDOFF.md |
| codex/preview-camera | 空间配置预览视角约束 | 5207 | 根目录 AGENTS.md；docs/parallel-work/preview-camera/HANDOFF.md |

另有 `codex/frontend-integration`，只负责接线、冲突解决、整体回归与最终本地 main 更新。

## 接口与唯一归属

### codex/frontend-visual

- `frontend/src/index.css`
- `frontend/src/ui/kit/`
- `frontend/src/ui/brand/`
- `frontend/src/ui/home/`
- `frontend/src/ui/layout/AppShell.tsx`
- `frontend/src/ui/layout/PageIntro.tsx`
- `frontend/src/ui/pages/ProjectsPage.tsx`
- `frontend/src/ui/theme/`
### codex/project-creation

- `frontend/src/App.tsx`
- `frontend/src/ui/layout/ProjectSteps.tsx`
- `frontend/src/ui/pages/NewProjectPage.tsx`
- `frontend/src/ui/pages/SpaceSetupPage.tsx`
- `frontend/src/ui/pages/ImportPage.tsx`
- `frontend/src/ui/setup/spaceForm.ts`
- `frontend/src/state/projectsStore.ts`
- `frontend/src/ui/create/`
### codex/workspace-simple

- `frontend/src/ui/pages/WorkspacePage.tsx`
- `frontend/src/ui/workspace/`
- `frontend/src/features/connections/MarkingPage.tsx`
- `frontend/src/features/connections/ObjectPortsPage.tsx`
- `frontend/src/features/connections/IsolatedModelViewport.tsx`
- `frontend/src/features/connections/SurfacePointOverlay.tsx`
- `frontend/src/features/connections/model.ts`
- `frontend/src/state/workspaceStore.ts`
- `frontend/src/state/drawerStore.ts`
- `frontend/src/state/objectResizeStore.ts`
- 目录例外（不归本分支）：`frontend/src/ui/workspace/HoldCompareButton.tsx`, `frontend/src/ui/workspace/Viewport.tsx`, `frontend/src/ui/workspace/IsolatedObjectViewport.tsx`, `frontend/src/ui/workspace/ObjectResizeTooltip.tsx`。
### codex/result-playback

- `frontend/src/ui/pages/ResultPage.tsx`
- `frontend/src/features/replay/`
- `frontend/src/ui/workspace/HoldCompareButton.tsx`
- `frontend/src/ui/pages/GuidePage.tsx`
- `frontend/src/ui/pages/PlanComparePage.tsx`
- `frontend/src/ui/deliver/`
- `frontend/src/lib/guide.ts`
- `frontend/src/scene/PlanCompareScene.tsx`
- `frontend/src/lib/sceneCapture.ts`
### codex/model-quality

- `frontend/src/scene/ObjectModel.tsx`
- `frontend/src/scene/modelLoader.ts`
- `frontend/src/scene/importModel.ts`
- `frontend/src/scene/meshWinding.ts`
- `frontend/src/scene/prefabAppearance.ts`
- `frontend/src/scene/prefabModelGeometry.ts`
- `frontend/src/scene/furnitureAppearance.ts`
- `frontend/src/scene/batchPrefab.ts`
- `frontend/src/scene/renderProfile.ts`
- `frontend/src/scene/SceneLighting.tsx`
- `frontend/src/scene/DormDeskModel.tsx`
- `frontend/src/scene/ParametricDesk.tsx`
- `frontend/src/scene/RoomShell.tsx`
- `frontend/src/scene/resources.ts`
- `frontend/src/scene/SceneObjectMesh.tsx`
- `frontend/src/scene/ObjectResizeHandles.tsx`
- `frontend/src/scene/dormDeskDrawers.ts`
- `frontend/src/scene/drawerContents.ts`
- `frontend/src/scene/backboardMount.ts`
- `frontend/src/scene/placementEditing.ts`
- `frontend/src/scene/fixedFurniture.ts`
- `frontend/src/scene/useDrawerInteraction.ts`
- `frontend/src/scene/useObjectDrag.ts`
- `frontend/src/scene/sceneValidation.ts`
- `frontend/src/scene/collisionGeometry.ts`
- `frontend/src/scene/CollisionOutline.tsx`
- `frontend/src/ui/workspace/Viewport.tsx`
- `frontend/src/ui/workspace/IsolatedObjectViewport.tsx`
- `frontend/src/ui/workspace/ObjectResizeTooltip.tsx`
### codex/object-defaults

- `frontend/src/data/demoProject.ts`
- `frontend/src/data/objectDefaults.ts`
- `frontend/src/scene/prefabItems.ts`
- `frontend/src/scene/objectDefaults.ts`
### codex/preview-camera

- `frontend/src/scene/CameraRig.tsx`
- `frontend/src/ui/setup/SpacePreview3D.tsx`
- `frontend/src/scene/previewCameraBounds.ts`

## 并行与依赖顺序

1. 七条功能分支可同时开始；优先稳定视觉令牌、85%默认值帮助函数和 `/result` 回放组件的接口。创建/工作台分支保留接线清单，待接口合入后接通，不创造重复实现。
2. 创建分支独占 App.tsx、ProjectSteps、projectsStore。工作台分支独占 WorkspacePage 与大多数工具面板。模型分支独占场景/渲染和工作台画布；相机分支只管 CameraRig 与 SpacePreview3D。
3. 默认尺寸分支只提供新建工厂/帮助函数与新示例策略，页面入口由各页面负责人接入。旧项目迁移不可隐式缩小尺寸。
4. 最终页分支实现组件及回放，创建分支接路由、工作台分支接按钮；最终删除旧 guide 模块需在所有调用者清理后由 integration 完成。
5. integration 先处理远程前端家具/抽屉/背板/桌面分区兼容，再依次整合主题、默认尺寸、模型、相机、创建、工作台和最终页，最后补交叉接线和回归。可以按依赖调整顺序，不要求每条功能分支先合其他整条分支。
6. 远程与本地所有提交的可达性整合仍是 integration 的职责。正在优化的后端 API 不由本轮前端 agent 解决；先记录固定远程 SHA，与后端负责人完成后再合相应代码，不能为凑“全部已合并”覆盖协作成果。
7. 各任务功能提交不能带其他分支根 AGENTS。合并时选择性吸收功能提交，或明确保留 integration 根说明；为保留全部提交祖先关系而 merge 时必须人工保留正确 AGENTS。

## 共同验收

创建草稿恢复→完成后进入工作台→添加/编辑/整理/接线→进入动画最终页；无执行指南入口；旧 guide/compare 路径兼容；旧项目/原始基线不变；10°旋转、Ctrl缩放、抽屉/背板/书本正确；新默认只缩小一次；杯子及导入模型多角度贴桌回归；配置预览不看墙背面；类型/构建/桌面浏览器验证。后端 API 无本轮修改。

## 启动单个任务

在对应 worktree 新开 agent，先读根 AGENTS.md，再读本表和本分支 HANDOFF。提示：按照本分支 AGENTS 执行归属任务，你不是独自在代码库工作；只修改本分支拥有文件，不切共享 main，不改后端理线 API，完工留下提交和验证证据。
