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
./node_modules/.bin/esbuild scripts/check-fixed-furniture.ts --bundle --platform=node --format=esm --outfile=/tmp/dorm-furniture-check.mjs '--define:import.meta.env={}'
node /tmp/dorm-furniture-check.mjs
```

生成器核对 GLB 与配套碰撞 JSON 的部件数量及边界（0.1mm 容差），按几何匹配部件，记录源 GLB 的 SHA256，生成 `src/scene/furnitureAsset.generated.json` 并复制四份运行时资产。不能手工改生成 JSON 来绕过资产不一致，也不覆盖 `objects/` 源文件。回归脚本需要根目录 Python 领域模块可导入，会执行真实布局与走线。

旧 `dorm_desk_assembled.glb` 与 `check-desk-model.ts` 保留作历史资产核验；不再作为新示例的默认加载入口。

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

孔位须完整位于一块真实桌板内。原 GLB 桌板节点隐藏，使用共享桌板几何切出圆孔内接正方形通道，以保守保证线缆净空；模型标记仍显示配置孔径。原模型未预制孔位。

加载中、失败或用户选择简化家具时，`ParametricDesk` 使用同一组碰撞盒绘制回退；不存在旧版虚构横梁和低位书架。俯视仅隐藏床、护栏和梯子，碰撞保持不变。任一资产加载失败会释放已加载部件并显示重试入口。

75 个部件 AABB 是保守障碍，斜梯和曲面装饰的包围盒可能排除一些实际空隙。抽屉壳体由独立底板/侧壁组成，内腔保持可用；抽屉目前静态，未实现推拉或取物可达性验证。运动设计保留在[抽屉交互方案](drawer-interaction.md)。走线仍需完整曲线复查；允许网络不表示现场已安装扎带或集线槽。

## 版本与验证

`RoomConfig.furnitureModel` 为 `dormdesk-v1` 时使用上述几何；缺省时保留旧参数化模型与旧 API 平移。内置示例种子为第 4 版，升级前将旧示例保留为独立项目，失效旧走线路径；已有用户项目及不可变后端基线不重写。

固定家具初始透视机位从桌前方观察，避免右侧梯子遮挡工作区；历史参数化机位保持原值，用户仍可切换预设或自由旋转。

部署步骤见[本地部署](../../docs/local_deployment.md)。除上述资产/算法回归外，运行 `npm run typecheck`、生产构建和真实后端浏览器专项；检查桌面及模拟手机上的非空 Canvas、四份资产、俯视剖切、简化回退、整理应用/保存与旧项目兼容。自动化不能替代实体手机、真实安装支撑或完整首版验收。

## 独立抽屉与单品模型整合

`DormDeskModel` 保留固定家具共同变换、桌面开孔的同源几何与历史参数化回退，并为三个独立抽屉增加推拉交互。`ObjectModel` 在工作台、对比及交付页使用随包单品 GLB；底心归一化后通过共同尺寸缩放，保持与碰撞一致。抽屉位移仍是会话中的展示状态，不会移动已保存的家具碰撞或内部物品；不能把打开抽屉当成后端收纳区域改变。详见[整合验收](../../docs/merge_workflow_prefab_acceptance.md)。
