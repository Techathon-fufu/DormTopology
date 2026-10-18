# 显示器真实形状碰撞体

2026-10-18 修复：显示器使用现有 `compound` 凸体并集和 SAT 核心，不另建碰撞算法。用户提供的 `item-collision-bundle.zip` 中 README、HANDOFF、VERIFICATION 及几何代码已核对：它是现有共享几何与鼠标/键盘适配的交接包，并未提供显示器的精确分解。

## 原因与几何

`Prefabmodel/monitor.glb` 将底座、支架、屏幕、后壳合在一个网格中。旧生成器逐网格取凸包，得到一个覆盖所有部件的凸体，错误填实屏幕下方和底座两侧的空隙；工作台的整盒选中线框进一步掩盖了实际差异。

新生成器先焊接重复顶点，按三角形连通性分出四个结构。底座、倾斜支架与后壳各为一个凸体；屏幕按原始前表面分出中央面板和四条斜边框，再各自延伸到屏幕背面，保留 3mm 的面板凹陷。最终为 **8 部件、64 顶点、96 三角形**。支架与后壳原网格在装配处缺少封口，仅补齐这些连接面的闭合边界，不跨越部件空隙。

数据来自实际 GLB 顶点及节点变换，不按声明尺寸手绘大盒子；之后与外观采用同一底心、尺寸缩放和旋转约定。前端生成数据保留六位小数（米），因此“吻合”指当前 GLB 的实体表面在浮点/取整容差内吻合，不代表实物扫描精度。模型拓扑变化时生成器明确报错，不能静默回退整体凸包。源 GLB 和运行时副本未修改，SHA256 均为 `6d2c8488875ee69e98876f1e751353ba98ce94360dd56664c88d84485f4db482`。

工作台的选中与干涉线框也改为实际凸体轮廓。拖动仍允许落在干涉位置并提醒；缩放、推荐整理、净距检查与走线使用同一份实体。20mm 净距约定继续生效，倾斜部件投影仍遵循[数据契约](../../docs/data_contract.md#22-区域与碰撞几何)的保守语义。

## 接口与已有项目

示例电源/HDMI 接口由悬空旧坐标改到屏幕背壳 `[±.12,.30,-.02]`，朝后。仅自动修复内置示例中模型、尺寸、方向均匹配且未确认、未编辑的已知旧默认接口，并使旧走线失效；用户确认的接口和自建项目不重写。已确认过旧悬空位置的项目需在单模型描点页重新确认接口。

已有预制显示器刷新页面即使用新碰撞数据，物品位置与不可变基线不重置。新整理/走线请求携带这八个部件，由后端复查。

## 生成与复核

从仓库根目录执行；SciPy 仅用于离线凸包生成，不加入在线领域算法依赖：

```bash
python -m pip install -r backend/requirements-geometry.txt
python -B backend/scripts/generate_colliders.py --model monitor
python -B backend/scripts/generate_colliders.py --check
python -B -m unittest backend.tests.test_monitor_collision -v
cd frontend
./node_modules/.bin/esbuild scripts/sync-prefab-items.ts --bundle --platform=node --format=esm --outfile=scripts/sync-prefab-items.generated.mjs
node scripts/sync-prefab-items.generated.mjs
rm scripts/sync-prefab-items.generated.mjs
./node_modules/.bin/esbuild scripts/check-monitor-collision.ts --bundle --platform=node --format=esm '--define:import.meta.env={}' --outfile=/tmp/dorm-monitor-check.mjs
node /tmp/dorm-monitor-check.mjs
npm run build
```

`check-monitor-collision.ts` 默认调用 `python3` 校验跨端导出的凸体契约，可用 `PYTHON` 指定解释器。模型生成和源表面测试另需上面的离线依赖。

本轮已验证：

- 后端 98 项：显示器源表面覆盖、屏幕凹陷、空隙与实体、节点变换、布局、20mm 净距及复合体走线/接口。
- 22 份碰撞资产契约通过；前端显示器 12 种缩放/旋转组合、两类 API 导出、净距、射线与尺寸限制通过。
- 12 件实际 GLB 共 108 项外观/碰撞边界检查；编辑、分区、旧接口迁移及持久化回归通过。
- 实际示例 17 件整理成功，整理后 7/7 路径有效；原始散乱场景继续如实返回部分走线失败。类型检查与生产构建通过，保留既有大产物提示。
- 浏览器在独立 `5178` 测试：90×80×40mm 小件位于显示器底座右侧、屏幕下方时无相交；移入底座显示干涉；高度增至 300mm 触碰屏幕时保留原尺寸。选中线框沿屏幕、支架和底座显示。
- 桌面与 390×844 模拟手机视口均显示非空场景，无页面横向溢出；无脚本错误，开发模式保留 React Router 既有升级提示。现有 `5177` 预览已载入新构建，`8003` 后端继续运行；本轮不重置其原有物品布局。截图在本机 `.work/monitor-collision/`。

额外运行的旧 `check-collision-volumes.ts` 在“普通占位显示器不得占用打字区”断言失败；用修改前 HEAD 文件重新打包同一脚本，得到相同失败。该断言针对非预制占位模型/旧规则规划，不属于本次形状回归，不记为通过。
