# 本地 main 全量整合前冲突分析（2026-10-18）

手机贴桌破碎条纹及视角移动闪烁已按用户确认标记为解决，记录在 `frontend/docs/scene-rendering.md`。最终五组视角、手机中心及四角采样回归通过；构建通过。本报告只完成合并预演，没有正式合并、提交、推送、切换分支或改动真实索引。

## 已核验的提交范围

- 已成功执行 `git fetch --all --tags`。本地 main 为 `948c0be`，远程 main 为 `567c9aa`，共同祖先 `648d5a9`。
- main 各自独有本地 4、远程 13 个提交（包含 merge commit）。所有本地命名分支上的提交均被这两个 main 的并集覆盖。
- 全部 origin 分支相对于上述并集另有 3 个提交，见下表。没有假设它们已合入。
- 当前 51 个已跟踪文件修改、54 个未跟踪文件；另有原有 stash 一份，未触碰。未提交功能包括书本立放/平放、渲染优化及闪烁修复、接口定位调整等，不能只合并提交后忽略。
- 使用 `git merge-tree` 预演。提交间共 19 个冲突文件；独立临时索引加入当前工作代码后共 26 个冲突文件。预演未将日志、SQLite、交付压缩包等无关未跟踪产物加入代码快照；所有原文件留在原处。
- 26 为 main 对 main 加当前工作代码的冲突数；其他 3 个分支单独预演，不把多次预演计数相加，也不声称全量最终冲突一定为 26。

## 需要处理的功能部件

| 功能部件 | 冲突与影响 | 建议整合方式 |
| --- | --- | --- |
| 仅桌面端布局 | 本地移除了移动端抽屉、断点样式和触屏分支；远程仍带这些代码。影响 `home.css`、`AppShell.tsx`、`ImportPage.tsx`、工作台页面/工具栏/状态栏、`cable-management.spec.ts` 及实施方案。 | 保留明确的桌面端要求；只迁移远程新增业务交互，不能整文件选择远程而恢复移动端。自动合并的 AGENTS 也要复核。 |
| 接口描点及页面路由 | `App.tsx`、`WorkspacePage.tsx`、`MarkingPage.tsx`。本地为嵌套路由与 `ObjectPortsPage`，远程为工作台会话覆盖层与 `IsolatedObjectViewport`，回调名和状态同步也不同。 | 保留独立物品视图、切换物品、草稿取消/保存、原模式恢复及键盘屏蔽；统一一种状态来源，旧入口保留兼容或重定向，避免出现两套描点状态。 |
| 抽屉、拖拽、缩放与背板安装 | `SceneObjectMesh.tsx`、`sceneValidation.ts`、`useObjectDrag.ts`、`drawerStore.ts`、`workspaceStore.ts`、`Viewport.tsx`。本地按 progress 临时补显示偏移，远程使用统一 DrawerOffsets、displayPosition 和背板支撑。 | 采用一致的关闭抽屉保存坐标/打开抽屉显示坐标转换，只应用一次偏移；保留背板插排、拖放、10°旋转和缩放约束。开关抽屉不能改变保存坐标。 |
| 渲染与真实桌面 | 未提交改动额外冲突于 `DormDeskModel.tsx`、`ParametricDesk.tsx`。本地仍隐藏 GLB 桌面并叠加穿孔桌面，远程 `36369e9` 改为实心预制桌面；回退家具又增加了抽屉交互。 | 跟随远程真实桌面定义，同时保留浅色材质、共面裁剪和按需绘制。不能重新叠两层桌面。回退家具必须保留抽屉点击，动画必须能唤醒 demand Canvas，避免重复动画驱动。 |
| 书本姿态与背板/分区契约 | 额外冲突于 `ObjectModel.tsx`、`ObjectResizeHandles.tsx`、`collisionGeometry.ts`、`packingWire.ts`、`docs/data_contract.md`。本地新增 bookPose，远程新增 mount、surface_mount、桌面区域与更多允许角度。 | 两套字段和变换都保留；碰撞缓存键同时含 bookPose 与 mount，转换校验同时保留 book_pose 与 surface_mount，书本旋转包裹与背板几何组合。模型加载继续执行手机/鼠标垫/底座面朝向修复。 |
| 结果页、历史方案与指南 | `App.tsx`、`WorkspacePage.tsx`、`PlanPanel.tsx`。远程将 guide/compare 重定向到 ResultPage，并以简化历史方案替换完整对比面板；本地仍保留指南导出和多方案对比。 | 这是功能替换，需要主动整合。建议新增结果回放并保留原有指南/导出与方案对比入口，避免以新结果页覆盖所有旧入口导致已交付功能失联。远程新增 ResultPage 还需要接入统一照明、DPR 与按需绘制配置。 |
| 配置页与视角精简 | `SpaceSetupPage.tsx`、`Toolbar.tsx`，远程最新 `567c9aa` 去掉书架/穿线孔配置、空间摘要和视角入口，本地仍保留这些入口。 | 采用远程最新页面精简，同时保留固定家具、墙插配置及必要的底层视角能力；需要同步导览和测试选择器，不能只消掉文本冲突。 |
| 示例数据与持久化迁移 | `demoProject.ts` 冲突包含本地 v7 删除演示书本和远程 v8/v9 区域/支撑物初始化。迁移函数可能文本自动合并，但仍有语义风险。 | 保留用户已有位置和原始基线，迁移只补必要字段；检查新示例、旧 v6/v7/v8 项目和独立归档，不能用重置示例绕开迁移。 |

## 另外三个未合并提交

| 分支 / 提交 | 核验结果 | 建议 |
| --- | --- | --- |
| origin/feat/desk-split-prefab-items / e2a2f91 | 唯一差异为 Q/E 从 90° 改为 10°。远程 main 已用 ROTATION_STEP = π/18 实现相同行为，祖先历史尚未包含该提交。与远程 main 合并时 WorkspacePage 文本冲突。 | 纳入历史时保留远程统一常量；不要退回旧版键盘处理函数。 |
| origin/feat/vlm-perception / 0fcb1f8 | 唯一差异是 .gitignore 的 Python 字节码规则和换行；当前 main 已有 `*.py[cod]`。双方 main 预演该分支均在 .gitignore 冲突。 | 合入历史并保留现行完整忽略规则；不能用这个老文件覆盖后来增加的本地数据和临时目录规则。 |
| origin/fix/scene-sync-recovery / 6784dbc | 独有提交的核心 sceneSync、organizationScenes、检查脚本与本地当前文件已一致；远程 main 在此基础上增加 demo 基线隔离。单独对远程 main 预演有 6 个冲突文件：CHANGELOG、api-integration、sceneSync、http/index、OrganizePanel、scene-sync.spec。 | 不整体恢复旧版同步实现；保留网络/409恢复、独立副本及远程 demo 的基线隔离，核验差异后吸收历史。 |

这些提交在祖先关系上未合并，不代表功能全部缺失；已对实际内容做了比较。

## 不会报文本冲突但必须复核的部件

- 后端书本姿态与远程规划/挂载自动拼接：支撑、碰撞、接口坐标、合法朝向、保存回读和失败原因仍需联跑；“自动合并”不等于功能兼容。
- 固定家具实心桌面、背板、显示器碰撞、桌面区域绑定与正交走线须使用同一几何。旧出线孔引用和回退几何不能复活。
- `ResultPage`、远程独立物品画布等新 Canvas 不能绕过现有 GPU/渲染预算配置。
- `7841d11` 新增被跟踪的 `vlm/key.txt`、`vlm/rodin_key.txt`，并在 .gitignore 中放行。仅核验路径与规则，未读取密钥内容。整合时应保留外部能力代码、恢复本地凭证配置方式，避免密钥文件进入后续交付；历史中已存在的内容仍需项目所有者管理。
- 原 stash、其他 worktree 的未提交内容、日志/数据库/压缩包不是当前分支提交，不会擅自合入；命名分支历史已纳入本次可达性检查。

## 建议执行次序

1. 记录并保护当前工作区，使用隔离的整合目录处理，保留原 main 作为可恢复基线。
2. 整合双方 main 及 3 个未覆盖提交；先统一家具/抽屉/姿态契约，再解决路由和界面，最后接回渲染优化。
3. 执行后端领域/服务、前端类型/构建、场景迁移、抽屉拖放/背板缩放、接口描点、指南/结果/对比及手机贴桌专项回归。
4. 所有目标分支提交可达性核验后才更新本地 main；不推送远程。

原始清单位于同目录 `report.json`、`committed-conflicts.md`、`working-conflicts.md`。它们包含预演冲突内容，仅作为分析证据，不能作为已解决的源码。
