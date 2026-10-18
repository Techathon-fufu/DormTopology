# frontend-integration 合并取舍（进行中）

本文件固定 `codex/frontend-integration` 合并 `origin/main`（`567c9aa`）时的取舍规则，供本分支所有解决冲突的 agent 共用。冲突中 **ours = 本地快照 HEAD**（含书本姿态、抽屉阻挡提醒、按需绘制/渲染优化），**theirs = origin/main**（实心预制桌面、统一抽屉偏移、背板/鼠标支撑、ResultPage、配置页精简）。

## 硬规则

1. 仅桌面端：远程新增的移动端/断点/触屏分支不恢复（`sm:`/`md:`/`lg:`/`xl:`、CSS 媒体查询断点、抽屉式 Drawer 开合按钮、`pointer: coarse`）。
2. 不改后端理线 API 与契约实现：`frontend/src/api/core/routingWire.ts`、`backend/**` 原样保留；共享转换文件里的理线逻辑不顺带整理。
3. 桌面与家具：采用远程实心预制桌面定义（`36369e9`），保留本地浅色材质、共面裁剪、按需绘制与抽屉点击。
4. 书本姿态保留本地实现：`collisionGeometry` 缓存键含 `bookPose`、`ObjectModel` 书本旋转包裹、`SceneObjectMesh` 书本显示尺寸、`ObjectResizeHandles` 书本对角、`packingWire` 的 `book_pose`。
5. 抽屉与支撑：采用远程统一 `DrawerOffsets` + `drawerDisplayPosition`/`drawerDisplayObjects` + `SupportHit.surfaceId` + `backboard`；本地 `drawerSlot` 传输字段与 `raycastSupports(..., drawerProgress)` 旧签名淘汰。本地 `blockingDrawerOpening` 干扰提醒与「物品落进抽屉自动开抽屉」保留。
6. 数据契约两侧字段都保留：`book_pose` 与 `surface_mount` 并存，不二选一。
7. 结果与历史：采用远程 `/result` `ResultPage`；旧 `/guide`、`/plans/compare` 地址保留兼容跳转，不出现死链；历史方案数据与恢复能力不丢。
8. 冲突解决后文件内不得残留 `<<<<<<<`、`=======`、`>>>>>>>`、`|||||||` 标记，TypeScript 接口保持自洽。

## 禁止

- 禁止 `git checkout --ours/--theirs` 整文件、`git merge --abort`、`git reset`、`git stash`、切换分支、提交或推送。
- 禁止删除或回退他人并行改动里的功能，只做取舍与接线。
