# 创建项目流程与导航交接

整合补记（2026-10-18）：`frontend-integration` 按用户确认的两段创建与草稿恢复方案移植 `1f12b99`，保留已有结果页/旧地址跳转和独立描点路由；两侧存储 v4 统一为 v5，草稿字段接入逐记录存储。5208 上创建专项 5 项、独立描点 3 项通过，类型及构建通过；全部跨分支回归尚未完成，详情见 [整合交接](../frontend-integration/HANDOFF.md)。

以下为原功能分支交接：功能实现与独立验证完成时，结果页接线尚待整合。

- 分支：`codex/project-creation`
- 共同基线：`e3de759ad223f2c541617924ae45d61c70d3cf33`
- 功能提交：见本分支最新提交（本文件与功能一起提交）

## 实际改动

1. `/projects/new` 不再显示独立起名页：创建或恢复一个持久化草稿，直接进入 `/projects/:id/setup`。
2. 项目名称并入“项目与空间”步骤；创建导航只保留“项目与空间 / 照片与物品”两段。
3. `projectsStore` schema 升到 v4，增加显式 `creationDrafts`。旧数据迁移默认视为已完成，避免把历史 `space/photos/assets` 阶段项目错误拦回创建流程。
4. 草稿再次访问 `/projects/new` 会恢复到同一项目的正确步骤；草稿直接访问 workspace 会被送回 setup/import。
5. 完成物品确认后清除草稿标记、更新阶段并进入 `/projects/:id/workspace`。已完成项目再次进入空间/物品页只作为设置入口，保存后直接回工作台。
6. 空间页按远程精简方向移除书架层数、出线孔、重复摘要和恢复标准空间按钮；保留墙插位置、三维预览与结构校验。未修改 `SpacePreview3D`。
7. 新增专项桌面 Playwright 测试 `frontend/tests/parallel-project-creation.spec.ts`，覆盖新建、恢复、完成、旧阶段兼容与 workspace 拦截。

## 验证

- `npm run typecheck`：通过。
- `npm run build`：通过；仅保留既有的 Vite 大 chunk 警告。
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5202 playwright test "parallel-project-creation" --project=desktop-chromium`：2 passed，桌面视口 1440×1000，SwiftShader 软件渲染。
- `git diff --check`：通过。
- 第一次专项测试失败源于测试初始化脚本在每次导航清空 storage；修正为每个测试上下文只清理一次后通过。失败证据未作为交付结果。

DeepSeek-Worker 按根 AGENTS.md 尝试了一次限定委派，端点返回多段 JSON 导致解析失败：`Extra data: line 1 column 6409`；没有应用其代码，之后由 Codex 本地实现并执行真实检查。

## integration 分支接线

最终动画页未在本分支基线中，遵循任务说明未创建同名空壳。合入 result-playback 功能后，在 `frontend/src/App.tsx`：

1. 导入真实 `ResultPage`。
2. 增加 `/projects/:id/result` 路由。
3. 将旧 `/projects/:id/guide` 与 `/projects/:id/compare` 改为保留 id 的重定向到 `/projects/:id/result`，或直接渲染真实 ResultPage 后用 replace 规范 URL。
4. 保留本分支的 `ProjectWorkspaceGate`，并保留独立描点地址 `objects/:objectId/ports`。

`frontend/src/ui/pages/ProjectsPage.tsx` 不属于本分支独占范围。整合时删除其“查看执行指南”菜单项，或在结果分支接入后改为“查看整理演示”并导航 `/projects/${project.id}/result`。当前创建流程及 `ProjectSteps` 已无指南入口。

默认物品尺寸 85% 由 object-defaults 分支提供工厂后，再接入 `ImportPage` 的新建对象路径；不得对用户已确认尺寸或载入旧项目统一缩放。

## 未改动与风险

- 未修改后端、理线 API/契约、算法、模型资产、相机或 `SpacePreview3D`。
- 未推送、未更新 main、未覆盖其他分支修改。
- `node_modules` 仅以本地 junction 供验证使用，未跟踪；构建输出与测试日志均未加入提交。
- 本分支仍保留基线的 GuidePage/PlanComparePage 路由，直到真实 ResultPage 合入；这是有意避免制造空壳页面的暂态接线。
