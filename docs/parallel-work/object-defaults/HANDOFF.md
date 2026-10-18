# 新建物品默认尺寸缩小至 85% 交接

状态：功能实现和本地验证完成；页面调用点由创建分支与工作台分支接入。

- 共同基线：`e3de759ad223f2c541617924ae45d61c70d3cf33`
- 分支：`codex/object-defaults`；独立端口 `http://127.0.0.1:5206`

## 本分支实现

- `frontend/src/data/objectDefaults.ts`：统一 0.85 比例、尺寸/端口缩放、固定/排插/已确认尺寸/生成模型的豁免判定。
- `frontend/src/scene/objectDefaults.ts`：`createNewSceneObject(spec)` 新建工厂；`applyNewObjectDefaults(object)` 一次性应用默认比例（WeakMap 记忆源与结果，不二次缩小）；鼠标垫支撑顶面定位与桌面投影夹取（`supportTopY`、`placeOnSupport`、`syncSupportPose`）。
- `frontend/src/data/demoProject.ts`：`createNewSampleSceneObjects(projectId)` 仅供新项目使用。旧的 `createDemoSceneObjects`、`DEMO_SEED_VERSION`（7）、种子与迁移路径保持不变，避免旧项目误缩。
- `frontend/src/scene/prefabItems.ts`：`prefabDefaultDimensions(prefabId)` 返回实测预制尺寸 × 0.85；未知 id 返回 `null`。`PREFAB_ITEMS` 注册表尺寸本身不改。
- `frontend/scripts/check-parallel-object-defaults.ts`：专项回归，覆盖比例、端口、重复应用豁免、支撑、预制模型和旧示例。
- `docs/parallel-work/object-defaults/HANDOFF.md`：本文件。

### 规则落地

- **比例只在新建立施加**：唯一入口 `createNewSceneObject` / `applyNewObjectDefaults` / `createNewSampleSceneObjects`。家具、房间、固定墙插不是 `SceneObject`，天然不经过该比例。
- **不适用清单**（`newObjectDefaultSkipReason`）：`fixed`（固定摆放，含排插）、`power-strip`（长度 = 2 × 留边 + (孔数 − 1) × 孔间距，由规格重算）、`measured`（`recognition.dimensionSource === 'user'`）、`imported`（`model.source === 'generated'`，生成 / 导入模型的实测尺寸）。
- **不二次缩放**：`applyNewObjectDefaults` 用 `WeakMap` 记忆「源对象 → 结果」，同一源重复调用返回同一结果实例；纯函数语义，源对象不被改写。示例函数每次从源字面量重建，重复「添加 / 打开」不会叠加缩小。
- **局部接口同比**：`port.offset` 三轴 × 0.85，`direction` / `localDirection` / `type` / `label` 不变；按契约「改尺寸或接口后重新确认」，缩放后已确认接口置 `confirmed: false`；无 `offset` 的接口按背面中心派生，保持原引用。
- **锚点与支撑**：底面中心锚点不变，缩放后物品底面仍停在同一支撑面（`y` 不重算）；堆叠关系用「底面中心 + 声明高度」求支撑顶面；`syncSupportPose` 把 `prefabId === 'mouse'` 放到最近的可见 `mousepad` 顶面并夹取到垫内（远程示例新增鼠标垫 / 纸巾盒后仍成立）。
- **与既有碰撞一致**：`collisionGeometry` 对预制物品按 `object.dimensions` 非均匀缩放随包碰撞数据，渲染 `createPrefabInstance` 也按 `dimensions` 缩放，因此 0.85 同时作用于视觉与碰撞；未改任何碰撞 / 理线算法。

## 页面分支接线

此分支未修改页面、`projectsStore` 或工作台 store。接线负责人请按以下入口替换：

1. `NewProjectPage.tsx:26`：新项目选择示例物品时用 `createNewSampleSceneObjects(id)`；传给 `createDemoCables` 的对象也用这批新尺寸对象。空白项目仍为空。

```diff
-import { createDemoCables, createDemoSceneObjects, createStandardRoom } from '@/data/demoProject'
+import { createDemoCables, createNewSampleSceneObjects, createStandardRoom } from '@/data/demoProject'
-    const objects = withDemoObjects ? createDemoSceneObjects(id) : []
+    const objects = withDemoObjects ? createNewSampleSceneObjects(id) : []
```

2. `ImportPage.tsx:314`：手动「自定义物品」目前标作 `dimensionSource: 'user'`，属用户确认尺寸，保持原值。识别清单写入对象（约 `:339` 的 `recognized.map`）只对 `dimensionSource === 'estimated'` 的新物品施加默认比例；`user` 项保持原尺寸。跳过识别载入示例的 `:386` 应改用 `createNewSampleSceneObjects(projectId)`。

```diff
+import { applyNewObjectDefaults } from '@/scene/objectDefaults'
@@ const confirmItems = () => {
     const objects: SceneObject[] = recognized.map((item, index) => ({
       ...
       recognition: { confidence: item.confidence, source: isMockMode ? 'mock' : 'ai', dimensionSource: item.dimensionSource },
-    }))
+    })).map(applyNewObjectDefaults)   // user 项在 skip 判定内自动豁免
```

```diff
-    const objects = createDemoSceneObjects(projectId)
+    const objects = createNewSampleSceneObjects(projectId)
     ... createDemoCables(objects, projectId)  // 不变
```

3. `LeftPanel.tsx:204`：工作台「加载示例物品」应改用 `createNewSampleSceneObjects(project.id)`，仅追加新物品，不处理已有物品。

```diff
-    const fresh = createDemoSceneObjects(project.id).filter((o) => !existingNames.has(o.name))
+    const fresh = createNewSampleSceneObjects(project.id).filter((o) => !existingNames.has(o.name))
```

4. `LeftPanel.tsx:210–234`：手动「添加自定义物品」可把新建字面量交给 `applyNewObjectDefaults`，或等价改为 `createNewSceneObject`；仅对本次新构造对象调用一次。预制物品入口优先用 `prefabDefaultDimensions(prefabId)` 作为源尺寸，或传源尺寸到 `createNewSceneObject`，不可二次缩放。

```diff
+import { createNewSceneObject } from '@/scene/objectDefaults'
@@ const addCustomObject = () => {
-    addObject(project.id, {
-      id: uid('obj'), projectId: project.id, name: `自定义物品 ${n}`, category: 'nonElectrical',
-      dimensions: { width: 0.15, height: 0.1, depth: 0.1 },
-      transform: { position: initialDeskPlacement(project.objects.length, project.room), rotationY: 0 },
-      model: { status: 'none', source: 'demo', format: 'placeholder-box', shape: 'genericBox' },
-      ports: [], quantity: 1, needsPower: false, fixed: false, locked: false, frequent: false,
-      visible: true, source: 'manual',
-    })
+    addObject(project.id, createNewSceneObject({
+      id: uid('obj'),
+      projectId: project.id,
+      name: `自定义物品 ${n}`,
+      category: 'nonElectrical',
+      dimensions: { width: 0.15, height: 0.1, depth: 0.1 },   // 150/100/100 mm → 127.5/85/85 mm
+      position: initialDeskPlacement(project.objects.length, project.room),
+      shape: 'genericBox',
+    }))
```

（`initialDeskPlacement` 在 `@/scene/geometry`；`source` 默认 `manual`，与现行为一致。）

5. `projectsStore.ts` 的旧项目恢复、种子迁移继续调用 `createDemoSceneObjects`，不得换成新建版本。

需要鼠标垫时，用 `prefabId: 'mousepad'` 保持预制识别（语义 shape 可用 `genericBox`）；鼠标默认位置可传入 `support` 或在新对象批次上调用 `syncSupportPose`，鼠标会贴合垫面并夹取在垫面水平投影内。本分支不凭空向既有示例插入鼠标垫，也不更改示例摆放。

## 验证（均已实际执行）

```powershell
cd frontend
npm ci                                              # 本 worktree 锁文件，exit 0
npx tsx scripts/check-parallel-object-defaults.ts   # 全部 ok，exit 0
npm run typecheck                                   # exit 0
npm run build                                       # exit 0（dist 1,735.95 kB JS + 53.77 kB CSS，含既有 chunk 体积提示）
npx tsx scripts/check-demo-seed.ts                  # exit 0（种子版本 7 未变、14 件物品、v6 定向迁移与归档不变）
npx tsx scripts/check-prefab-model.ts               # exit 0（108 例 / 12 个真实 GLB）
npx tsx scripts/check-item-spacing.ts               # exit 0
npx tsx scripts/check-floor-placement.ts            # exit 0
git diff --check                                    # 通过
```

- 浏览器内验证（`npx vite --host 127.0.0.1 --port 5206 --strictPort` + Playwright chromium 在页面上下文 import 真实模块）：旧示例笔记本 350 mm 不变；新示例 297.5 × 193.8 × 294.1 mm（= 350 / 228 / 346 × 0.85），接口偏移 0.175 → 0.14875 m，底面中心 y 仍为 0.75，固定排插 210 mm 不变，物品数 14，重复施加不再缩小。
- `/projects/demo-dorm-101` 桌面 1440×1000 正常渲染：1 个 WebGL canvas（888×847）、`pageerror` 为 0、左侧场景物体 14 件。
- 证据：`.work/object-defaults-browser/verify.mjs`、`workspace.mjs`、`workspace.png`（临时脚本与截图在 `.work/`，未入库）。
- 界面级「新建物品小了 15%」需在接线后的页面分支截图确认——本分支未接页面。

已核实的**基线既有失败**（与本分支改动无关，改动前后各复现一次）：

- `npx tsx scripts/check-project-persist-migrate.ts`：`port-laptop-usbc` 期望 `[0.172, 0.009, -0.06]`，实际 `[0.175, 0.005, -0.06]`（`migrateDefaultDemoPorts` 不再改写该端口）。
- `npx tsx scripts/check-collision-volumes.ts`：`ordinary monitor placement must not occupy the reserved typing area`（actual 1 / expected 0）。

## 未完成项 / 整合风险

1. 页面接线未落地在本分支（按归属由创建分支 / 工作台分支执行），见上节四组补丁；本分支只给模块级浏览器内证据。
2. 内置示例项目（`createDemoProject`）刻意未缩尺：新项目示例物品库小 15%，内置示例仍为原尺寸；是否重种示例属产品决策，重种会归档旧示例，不在本分支。
3. 远程 `demoProject.ts`（v9，含 `desktopBindings` 分区 / 鼠标垫 / 纸巾盒）合并时需把同一策略套到远程物品清单；摆放夹取以远程 `desktopBindings` 为权威，`placeOnSupport` 只负责初始落到支撑面顶面。
4. 支撑顶面用「底面中心 + 声明高度」推算（垫子类支撑即其厚度）；若出现非常规形状支撑面，应改用 `collisionGeometry.worldCollision(...).bounds.max[1]`，本分支不为此扩散依赖。
5. 上述两项基线既有失败不在本任务范围；接入后用同一命令确认仍是同一失败，而非新增回归。

## 边界

仅修改本分支文件；未改后端理线 API / 请求响应契约 / `frontend/src/api/`、算法、示例种子语义、模型碰撞源资产、页面或 store；未改 `types/project.ts`（无新增字段）；未推送、未改 main、未 rebase 远程。功能提交由本分支维护，调用点属于 `codex/project-creation` 与 `codex/workspace-simple`。
