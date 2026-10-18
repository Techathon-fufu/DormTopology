# 固定桌体、支撑面与碰撞几何

默认示例使用 `dormdesk-v1` 固定家具。桌体与三个抽屉共同加载，L 形桌面、书架和抽屉内腔用于渲染、吸附、摆放复查以及 Python 整理/理线输入。旧参数化项目继续使用旧几何，不将历史位置套到新家具上。

## 资产与生成

源目录为 `Prefabmodel/dormdesk_parts/`，运行时副本为 `frontend/public/models/dormdesk_parts/`：

| 文件 | 网格数 |
| --- | --- |
| `dormdesk_body.glb` | 46 |
| `drawer_bottom.glb` | 9 |
| `drawer_middle.glb` | 9 |
| `drawer_top.glb` | 11 |

从 `frontend/` 执行：

```bash
./node_modules/.bin/esbuild scripts/generate-furniture-geometry.ts --bundle --platform=node --format=esm --outfile=/tmp/dorm-furniture-generate.mjs
node /tmp/dorm-furniture-generate.mjs
./node_modules/.bin/esbuild scripts/sync-desk-parts.ts --bundle --platform=node --format=esm --outfile=scripts/sync-desk-parts.generated.mjs
node scripts/sync-desk-parts.generated.mjs
rm scripts/sync-desk-parts.generated.mjs
./node_modules/.bin/esbuild scripts/check-desk-model.ts --bundle --platform=node --format=esm --outfile=scripts/check-desk-model.generated.mjs '--define:import.meta.env={}'
node scripts/check-desk-model.generated.mjs
rm scripts/check-desk-model.generated.mjs
./node_modules/.bin/esbuild scripts/check-fixed-furniture.ts --bundle --platform=node --format=esm --outfile=/tmp/dorm-furniture-check.mjs '--define:import.meta.env={}'
node /tmp/dorm-furniture-check.mjs
```

几何生成器只读取源 GLB 与配套碰撞 JSON，核对部件数量及边界（0.1mm 容差），按几何匹配部件，记录源 GLB 的 SHA256，生成 `src/scene/furnitureAsset.generated.json`。运行时四份 GLB 由 `sync-desk-parts.ts` 统一写入：桌体原样复制，三个抽屉从 `Prefabmodel/dormdesk.glb` 提取材质并按节点名分配，保留原 BIN 几何数据。几何生成器不会覆盖已注入材质的运行时副本。不能手工改生成 JSON 来绕过资产不一致，也不覆盖任何源资产或使用 `objects/` 模型替代。

同步与资产检查脚本通过 `import.meta.url` 定位源目录，因此上述临时编译产物放在 `scripts/` 内并在运行后移除；不要将它们编译到 `/tmp` 后直接执行。`check-desk-model.ts` 检查当前拆分模型、抽屉材质与推拉参数；`check-fixed-furniture.ts` 还需要根目录 Python 领域模块可导入，会执行真实布局与走线。旧 `dorm_desk_assembled.glb` 不再作为新示例的默认加载入口。

## 共同变换与支撑

四份 GLB 先加入共同父节点，再统一平移 `[-1,-0.02,0.9]`；不分别居中、缩放或底部对齐。源资产均为米制 Y-up。API 转换另平移 `[0.45,0,-0.042]`，物品局部碰撞体与端口不重复转换。权威约定见[数据契约](../../docs/data_contract.md#11-桌体与抽屉的资产分离)。

以下坐标为产品前端坐标：

| 支撑面 | X / Z 范围（m） | 高度 / 上方净空（m） |
| --- | --- | --- |
| 主桌面 | [-0.45,0.59] / [0.06,0.61] | 0.75；净高受实际障碍约束 |
| 右回台 | [0.59,1] / [0.042,0.902] | 0.75；净高受实际障碍约束 |
| 左格下层 | [-0.43,-0.11] / [0.04,0.29] | 1.46 / 0.192 |
| 左格上层 | 同上 | 1.668 / 0.192 |
| 其余三格 | [-0.091,0.231]、[0.249,0.581]、[0.599,0.92] / [0.04,0.29] | 1.46 / 0.40 |
| 下抽屉 | [0.64,0.92] / [0.524,0.817] | 0.084 / 0.2135 |
| 中抽屉 | 同上 | 0.334 / 0.181 |
| 上抽屉 | 同上 | 0.549 / 0.156 |

`fixedFurniture.ts` 是共享入口，显示/碰撞/支撑不依赖 GLB 下载完成。桌面包络是 1.45×0.86m，L 形空缺没有支撑，也不计入桌面可用面积；重叠的用途区域不重复计面积。打印机可使用右回台，显示器仍优先对齐键鼠区中线并面向使用者。

## 开孔、回退与限制

正式模型未预制桌面穿线孔。GLB 的 `Desk_Top_*` 节点保持可见，禁止另生成桌板替换它；同源碰撞盒和支撑面保持完整。`effectiveCableHoles` 对固定家具返回空集合，旧孔位不会产生可视标记、碰撞开口、保留区或 slot 通道；所有产品线缆走桌后/背板，legacy 参数化场景保留其配置。空间设置不提供固定桌体开孔编辑。

加载中、失败或用户选择简化家具时，`ParametricDesk` 使用同一组碰撞盒绘制回退；不存在旧版虚构横梁和低位书架。俯视仅隐藏床、护栏和梯子，碰撞保持不变。任一资产加载失败会释放已加载部件并显示重试入口。

75 个部件 AABB 是保守障碍，斜梯和曲面装饰的包围盒可能排除一些实际空隙。抽屉壳体由独立底板/侧壁组成，内腔保持可用；抽屉推拉同步移动壳体碰撞、唯一吸附目标及内部物品；保存和自动规划使用关闭状态坐标，未实现连续搬运轨迹的可达性验证。运动设计见[抽屉交互方案](drawer-interaction.md)。走线仍需完整曲线复查；允许网络不表示现场已安装扎带或集线槽。

## 版本与验证

`RoomConfig.furnitureModel` 为 `dormdesk-v1` 时使用上述几何；缺省时保留旧参数化模型与旧 API 平移。当前内置示例种子为第 9 版；本次桌板修复不重种示例，不改变用户摆放，持久化迁移仅移除虚构孔并失效旧走线。不可变后端基线不重写。

固定家具初始透视机位从桌前方观察，避免右侧梯子遮挡工作区；历史参数化机位保持原值，用户仍可切换预设或自由旋转。

部署步骤见[本地部署](../../docs/local_deployment.md)。除上述资产/算法回归外，运行 `npm run typecheck`、生产构建和真实后端浏览器专项；检查桌面及模拟手机上的非空 Canvas、四份资产、俯视剖切、简化回退、整理应用/保存与旧项目兼容。自动化不能替代实体手机、真实安装支撑或完整首版验收。

## 独立抽屉与单品模型整合

`DormDeskModel` 保留固定家具共同变换、GLB 原始桌板及同源完整碰撞与历史参数化回退，并为三个独立抽屉增加推拉交互。`ObjectModel` 在工作台、对比及交付页使用随包单品 GLB；底心归一化后通过共同尺寸缩放，保持与碰撞一致。抽屉位移是会话状态，内部物品按关闭内腔坐标保存；打开后渲染、吸附和即时碰撞同时平移。算法仍使用关闭内腔，以保证整理后能够收回抽屉。详见[整合验收](../../docs/merge_workflow_prefab_acceptance.md)。

## 原桌板修复（2026-10-18）

项目持久化 v4 移除固定家具的历史虚构孔并失效全部旧走线及集线槽分析，保留物品位置、连接和不可变基线。规划输入签名更新，旧异步候选不能被接受。原资产 GLB 与碰撞 JSON 不修改。

`/routing-demo` 与业务工作台共用 `DormDeskModel`。从 `frontend/` 编译并执行 `scripts/check-demo-routing.ts --write-demo` 可重新生成正式场景、已应用布局及七线结果；编译命令为 `./node_modules/.bin/esbuild scripts/check-demo-routing.ts --bundle --platform=node --format=esm --outfile=/tmp/desk-demo.mjs '--define:import.meta.env={}'`，随后 `node /tmp/desk-demo.mjs --write-demo`。它是离线真实算法证据，不替代 HTTP 全流程或安装支撑验收。

回归入口：`scripts/check-fixed-furniture.ts`（GLB 射线命中旧孔位置、渲染/碰撞共同变换、实际布局和走线）、`scripts/check-project-persist-migrate.ts`（旧项目迁移）、`scripts/check-asset-policy.ts`（非法路径）、`tests/prefab-desktop.spec.ts`（桌面/手机原桌板可见）、`tests/workspace.spec.ts`（空间配置及失败回退）。

本次验证：生产构建通过；上述两组 Playwright 共 12 项通过（空间配置两项修正旧按钮文案断言后重跑通过）；实际七线均为有效 backboard 路径；资产路径、模型几何和旧项目迁移回归通过。后端全量 277 项中 275 项通过，两项显示器凸体生成测试报错；在未修改的 main `7415af8`、同一 Python 环境中复现相同错误，非本次修复引入。Blender 场景脚本只完成语法检查，未执行渲染。
