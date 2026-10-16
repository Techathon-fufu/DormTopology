# DormTopology 3D 数据契约 v1

本文是空间和模块数据的唯一约定，属于待实现协议。首版范围见[实施方案](implementation_roadmap.md)。`scene.json`、`packing_result.json`、`cable_routing.json` 表示数据载荷名称，不要求算法通过磁盘文件通信；应用接口路径由后端实现时记录。

## 1. 坐标、单位与资产

| 项目 | 约定 |
| --- | --- |
| 世界坐标 | 右手系，Y 向上，X 向桌面右侧，Z 从桌后朝使用者 |
| 原点 | 桌面左后角在地面上的投影；桌面区域为 X ≥ 0、Z ≥ 0 |
| 长度与位置 | 统一用米，面积用平方米；界面可转换为厘米或毫米 |
| 物品尺寸 | `size_m: [width, height, depth]`，分别对应未旋转的局部 X/Y/Z |
| 物品位置 | `position` 为底面中心的世界坐标，非模型包围盒中心 |
| 物品朝向 | `rotation_y_rad`，按右手规则绕 Y 轴旋转，单位弧度；自动摆放仅取 0 或 π/2 |
| 接口位置 | `local_position` 相对所属物品的底面中心，`local_direction` 为朝外单位向量 |
| 接口变换 | 世界位置为 `position + R_y(rotation_y_rad) × local_position`，方向仅乘旋转矩阵 |
| 墙面位置 | 后墙为配置的固定 Z 平面；墙插和网口沿 X/Y 调整，不能脱离墙面 |

演示配置 ID 为 `demo_desk_v1`：桌宽 1.45m、净深 0.60m、桌面顶高 0.77m。这些是可替换的示例参数，不是学校实测标准，也未核验现有 Blender 模型。书架尺寸、穿线孔形状和墙面位置需在首个演示场景中明确填写；不预设所有桌体都有 55cm 开孔。

演示场景必须配置上层四格书架、右侧抽屉内部收纳区域、真实穿线孔与背板后通道。墙插和网口物品底面中心的默认高度为 `position[1] = 0.30`，可在后墙平面内沿 X/Y 调整，Z 固定；该默认值同样不是实测值。桌体运行时资产目标为 `models/dorm_desk_assembled.glb`，仅包含固定结构；可移动物品使用独立资产。

桌体 GLB 使用同一世界原点，单品 GLB 使用底面中心锚点。Blender 源文件若为 Z-up，由导出流程转换到 glTF 的 Y-up，前端不再次旋转。资产导入时统一尺寸和锚点，保留物品变换；不能把生成网格直接当作精确碰撞体。

物品 `size_m` 是规划尺寸；接口局部坐标使用实际米制值。编辑尺寸时必须同步更新碰撞体，并由用户重新确认接口位置，不能只缩放外观而保留不匹配的接口。

旋转矩阵采用 `R_y(θ) = [[cosθ, 0, sinθ], [0, 1, 0], [-sinθ, 0, cosθ]]`。例如局部点 `[0.1, 0, 0]` 旋转 π/2 后为 `[0, 0, -0.1]`，再叠加物品世界位置；表面取点用该矩阵的转置做逆变换。

## 2. 场景输入 `scene.json`

顶层必需字段：

| 字段 | 定义 |
| --- | --- |
| `schema_version` | 固定字符串 `"1.0"`；不兼容版本必须拒绝 |
| `scene_id` | 场景稳定 ID |
| `scene_revision` | 从 1 开始的整数，由后端在一次编辑提交成功后递增一次；变更范围见第 5 节 |
| `baseline_id` | 用户确认的原始快照 ID；确认前为 `null`，此时不能提交整理、走线或对比指南 |
| `template_id` | 场景模板 ID，首版为 `demo_desk_v1` |
| `desk` | `{width_m, depth_m, top_height_m}`，均为正数，必须与区域、碰撞体和显示几何一致 |
| `wall` | `{z_m, bounds_xy_m: [x_min, x_max, y_min, y_max]}`，给出后墙平面及面板可放置边界 |
| `items` | 下述物品数组，包括设备、插排、墙插与网口 |
| `regions` | 可摆放的桌面、四格书架与抽屉内部支撑面 |
| `obstacles` | 桌板、立柱、背板等固定碰撞体 |
| `reserved_zones` | 不可占用或穿越的操作区、水杯活动区等体积 |
| `exposure_zones` | 用于计算桌面暴露线长的体积，字段为 `id`、`min`、`max`，不参与禁止通行判定 |
| `routing_graph` | 已配置的允许走线节点和边，包含穿线孔与固定点 |
| `cables` | 用户确认的线缆和连接关系 |

演示的“8 件物品”指 8 件待整理物品；插排、墙插和网口等基础设备另计，但均放入 `items` 并参与碰撞与结果输出。固定桌体结构放入 `obstacles`，不重复注册为物品。“3 根线”指 `cables` 中的 3 条连接，包含插排总线；H0–H4 的共同样例必须列明全部物品 ID、基础设备 ID 及三条起止接口，所有模块使用同一清单。

所有坐标、尺寸和数值必须有限，位置、方向和 `size_m` 为三元数组，边界数组长度按字段定义；物品尺寸、桌体尺寸、区域净高和通道净空为正数，边界下限严格小于上限。各类实体的 ID 在场景内全局唯一，所有引用必须存在。浏览器可为新物品和接口生成 UUID，后端验证唯一性后原样保存；后端创建的实体由后端生成 ID，双方均不得在保存时重新编号。场景 ID、快照 ID 与内部生成任务 ID 由后端分配。

### 2.1 物品

| 字段 | 定义 |
| --- | --- |
| `id`, `name`, `category` | 唯一 ID、显示名、类别；算法不使用名称作为主键 |
| `size_m`, `position`, `rotation_y_rad` | 按第 1 节解释 |
| `dimensions_source` | `user` / `template` / `estimated`，估计值需要用户确认 |
| `dimensions_confirmed` | 布尔值，表示用户已确认当前尺寸；来源与确认状态相互独立 |
| `fixed` | 是否禁止自动移动 |
| `usage_frequency` | `high` / `medium` / `low` |
| `allowed_region_ids` | 自动收纳的目标区域 ID，非固定物品必须非空；原位保留规则见第 3 节，固定墙面设备可为空 |
| `allowed_rotations_y_rad` | 自动推荐允许的朝向，采用 0 与 π/2 的非空子集；手动朝向可为任意有限弧度，固定物品保持输入朝向 |
| `collision` | 首版 `type: "box"`，使用 `size_m` 与物品变换；可保守包围圆柱物品 |
| `ports` | 接口数组，字段见下文 |
| `image_url`, `model_url` | 图片与已归一化模型 URL，无资产时为 `null` |
| `generation` | `{task_id, status, source, error}`；无任务时 `task_id` 为 `null` |

`generation.status` 为 `not_requested` / `queued` / `running` / `succeeded` / `failed`，表示当前内部任务状态；未请求时 `task_id` 为 `null`。`source` 为 `placeholder` / `live` / `cache`，描述当前显示外观的来源；没有可用资产时为 `placeholder`，内置或复用资产为 `cache`。`error` 为错误说明字符串或 `null`。重新生成期间和失败后保留已有可用外观及来源，没有旧资产才显示简化模型。同一任务状态只向终态前进，重提生成创建新 `task_id`；查询重试沿用原任务。供应商任务标识保留在后端适配器，不与内部 `task_id` 混用。模型替换不修改 `scene_revision`，因为规划几何不变；尺寸校正则必须修改版本。

接口字段为 `id`、`type`、`local_position`、`local_direction`、`capacity`、`confirmed`。`confirmed` 为用户已确认当前接口位置和类型的布尔值；`local_direction` 必须为单位向量。首版 `capacity` 为 1，插排每个插孔是独立接口。类型为 `power_source` / `power_sink` / `usb` / `network` / `hdmi`。电源线连接 source 与 sink，其他线连接同类接口，起止顺序不影响兼容性；USB 等复杂协议协商不在首版范围。

所有参与规划的物品须 `dimensions_confirmed: true`，走线引用的接口须 `confirmed: true`。尺寸编辑先置尺寸及全部接口为未确认；确认尺寸不会自动确认接口。接口位置、方向或类型修改后需重新确认，单纯平移或旋转整个物品保留局部接口确认状态。`dimensions_source` 不因用户确认而从 `estimated` 改成 `user`，只有用户实际输入替代尺寸时才改变来源。

前端可接收物品表面任意取点的世界坐标，按第 1 节逆变换写入接口的 `local_position`，表面法向转换为 `local_direction`，确认类型后再提交线缆；不另加与接口坐标重复的线缆端点字段。终点同样引用插排、墙插或网口的独立接口。

插排使用 `category: "power_strip"`，额外必需字段 `socket_count` 为 `4` / `6` / `8`，必须恰有相同数量的 `power_source` 接口，并有一个供插排总线使用的 `power_sink` 接口。选择规格时同步更新尺寸、碰撞体与接口；保留仍存在的接口 ID，移除接口上的线缆必须由用户重新指定，不能自动改接或静默删除。规格切换与改接作为同一次编辑提交：悬空引用只允许存在于客户端草稿，未修复前不保存为正式场景、不进入算法；取消则恢复旧规格和连接。提交成功后场景版本只递增一次，变更的尺寸与接口仍须确认。

照片识别需区分常用外设与待收纳杂物，用户确认后映射到现有 `category`、`allowed_region_ids` 和 `fixed`，不另加同义分类字段。键盘、鼠标、数位板允许区域为桌面中央；课本、水杯、收纳盒等允许区域为书架格或抽屉，具体区域 ID 由演示场景配置。

### 2.2 区域与碰撞几何

- `regions[]`：`id`、`surface_y_m`、`bounds_xz_m: [x_min, x_max, z_min, z_max]`、`clearance_height_m`。物品底面必须完整落在区域内，`position[1]` 等于支撑面高度，物品高度不超过净空。
- 四格书架每格单独配置区域；右侧抽屉区域使用内部底面、内边界与净高，内壁纳入 `obstacles`。抽屉在固定可访问状态规划，不要求开合动画，不允许通过忽略壁厚扩大收纳容积。
- 墙插与网口使用 `category: "wall_socket"` / `"wall_network"`、`fixed: true`、`rotation_y_rad: 0` 和空 `allowed_region_ids`，不受水平支撑面限制；其底面中心 Z 等于 `wall.z_m`，面板 X/Y 投影必须在 `bounds_xy_m` 内。仍参与物品与障碍碰撞检查，用户只可沿墙面平移，不旋转面板。其他物品的 `fixed` 同样只禁止自动移动，不禁止用户手动编辑。
- `obstacles[]` 与 `reserved_zones[]`：`id`、`min: [x,y,z]`、`max: [x,y,z]`，均为世界坐标 AABB。区域接触作为支撑处理，体积相交作为冲突处理；几何容差固定为 0.001m，不能用容差豁免明确的穿透。
- 桌板穿线孔必须同时体现在桌板碰撞体分割和走线通道中，不能仅给封闭桌板添加路径节点。
- `routing_graph.nodes[]`：`id`、`position`、`kind`，kind 为 `corner` / `slot` / `fixing_point` / `endpoint`。
- `routing_graph.edges[]`：`id`、`from_node_id`、`to_node_id`、`modes`、`clearance_radius_m`、`exposed`；边首版表示直线通道，需通过碰撞检查，净空半径不得小于线缆半径。`modes` 为 `slot` / `backboard` 的非空子集，图边为双向。
- `slot` 路径必须经过 `kind: "slot"` 的实际开孔通道下行；背板后通道以 `fixing_point` 节点与允许 `backboard` 的边配置，路径必须绕至背板后下行。两种模式的完整通道均需在演示场景配置，不能仅通过更改输出标签表示不同策略。
- 多线缆允许在同一通道汇聚，必须为线缆体积安排不相交的位置并复查共享通道净空。单个插孔的容量规则不因汇聚而改变；通道不足时返回 `no_path`。
- 设备接口通过经碰撞检查的引出段连接到图。显示网格表面可能位于保守碰撞 box 内：从真实接口沿世界接口方向发出射线，取离开所属物品 OBB 按“线缆半径 + 0.001m”膨胀后的首个出口；接口至出口的直线扫掠体是唯一允许豁免自身碰撞的有限引出通道。曲线端点仍为真实接口，起始沿起点朝外方向离开，末尾沿终点朝外方向的反向进入；其余曲线不得再次穿过自身。通道始终检查其他物品、障碍与禁入区，受阻返回 `endpoint_blocked`，不能整体忽略所属设备。
- `routing_graph.edges[].exposed` 仅用于搜索偏好，不作为暴露线长的统计依据；统计始终按 `exposure_zones` 并集计算。

### 2.3 线缆输入

每条线缆必需字段为 `id`、`start_port_id`、`end_port_id`、`cable_type`、`thickness`、`length_m`、`diameter_m`、`min_bend_radius_m`、`slack_m`、`mode`。

- `cable_type`：`power` / `usb` / `network` / `hdmi`，用于连接类型校验。
- `thickness`：`thick` / `thin`，用于界面预设；实际规划采用用户确认的 `diameter_m` 和 `min_bend_radius_m`。
- 粗线预设覆盖台式机/显示器电源线、网线与插排总线，细线预设覆盖充电线、外设连接线；预设提供不同线径和弯曲半径，数值需在实现时记录并由用户确认，不能仅依据电气类型强制指定粗细。
- `length_m` 是现有线长；最终路径长度加 `slack_m` 不得超过它。
- `length_m`、`diameter_m` 和 `min_bend_radius_m` 必须有限且大于零，`slack_m` 必须有限且非负。线缆起止接口不得相同。多条请求同时超出某接口容量时，所有引用该接口的冲突线缆均返回 `port_occupied`，不按数组顺序保留一条；无冲突线缆继续规划。
- `mode`：首版必须支持 `slot` 与 `backboard`。对应实现或通道缺失时返回 `unsupported_mode`，仍属于该策略验收未完成，不能改走另一策略后标记成功。
- 原始线缆可选 `baseline_path_points`，为至少两个世界坐标点组成的实测或用户确认折线；只在建立基线时写入，后续当前场景中的同名值只读复制自该快照。基线确认时未提供则保持未知，后补原始路径须显式建立新基线，不回写旧快照。

## 3. 整理输出 `packing_result.json`

```json
{
  "schema_version": "1.0",
  "scene_id": "scene_demo",
  "scene_revision": 3,
  "status": "success",
  "items": [
    {
      "item_id": "laptop_1",
      "name": "笔记本电脑",
      "model_url": null,
      "current_pos": [0.9, 0.77, 0.35],
      "target_pos": [0.725, 0.77, 0.3],
      "target_rotation_y_rad": 0,
      "target_region_id": "desk_primary",
      "placement_status": "placed",
      "reason_code": null
    }
  ],
  "issues": []
}
```

示例只含一个物品，实际输出必须覆盖输入 `items` 的全部物品，包括另计的基础设备。`current_pos` 是本次输入的位置，不是原始快照位置。`target_region_id` 引用输入区域；固定墙面设备返回 `unchanged`、原变换及 `target_region_id: null`，不能虚构水平支撑面。

每条物品结果包含 `name` 与 `model_url`，分别复制当前输入物品的显示名和已归一化独立资产路径，无模型时为 `null`；前端仍按 `item_id` 匹配，不以名称为主键。`current_pos` 与 `target_pos` 分别满足附件要求的整理前坐标和目标坐标。以上载荷可序列化下载为 `packing_result.json`，不要求后端和算法通过磁盘通信。

顶层 `status` 为 `success` / `partial` / `infeasible`：全部满足收纳要求为 success，存在未安放物品但整体仍无冲突为 partial，无法给出满足硬约束的布局为 infeasible。每件物品 `placement_status` 为 `placed` / `unchanged` / `unplaced`。后两种的目标位置与朝向保持输入值；`unplaced` 需带原因，目标区域无法确认时为 `null`，且继续参与最终场景碰撞检查。

`allowed_region_ids` 与自动朝向限制约束推荐的 `placed` 目标；`unchanged` 用于固定物品或已满足目标而无需移动的物品。`unplaced` 可以留在不属于收纳目标的原支撑面，例如仍在桌面的杂物；这是未完成收纳，不是成功落位。它仍必须满足真实支撑、边界、净高、不碰撞和不占保留区等几何硬约束，`target_region_id` 填实际原支撑面；无法确认合法原位时只能返回 `infeasible`。指南和指标不能忽略残留物品。

仅当整个输出布局满足硬约束时才能应用；`partial` 表示部分物品未能收纳但整体仍无冲突。`infeasible` 不应用任何移动，返回保持输入变换的结果及具体问题。应用有效布局后场景版本递增，后续走线使用新版本重新计算。

## 4. 走线输出 `cable_routing.json`

```json
{
  "schema_version": "1.0",
  "scene_id": "scene_demo",
  "scene_revision": 4,
  "status": "infeasible",
  "cables": [
    {
      "id": "cable_laptop_power",
      "start_port_id": "pdu_socket_1",
      "end_port_id": "laptop_power",
      "cable_type": "power",
      "thickness": "thin",
      "mode": "slot",
      "diameter_m": 0.004,
      "status": "failed",
      "curve_segments": [],
      "path_points": [],
      "path_length_m": null,
      "reason_code": "length_exceeded"
    }
  ],
  "issues": [
    {
      "entity_id": "cable_laptop_power",
      "code": "length_exceeded",
      "message": "当前线长不足，需调整设备或使用更长线缆"
    }
  ]
}
```

结果覆盖全部请求线缆。顶层 `status` 为 `success` / `partial` / `infeasible`：全部有效为 success，部分有效为 partial，全部失败为 infeasible。上例展示一根线缆因长度不足而失败的完整响应。

单线 `status` 为 `valid` / `failed`。有效路径 `path_points` 是已平滑并复查的世界坐标采样点，至少两个点，首尾与对应接口一致；`path_length_m` 为实际验证曲线的弧长，`reason_code` 为 `null`。渲染器按采样点绘制已验证路径，不再擅自使用另一条可能穿模的插值曲线。

`curve_segments` 为必需数组，保存已验证样条的世界坐标控制点，每段为 `{control_points: [P0, P1, P2, P3]}`；每个 P 为 `[x,y,z]`，固定表示三次 Bézier 曲线 `B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t)t^2 P2 + t^3 P3`，`0 ≤ t ≤ 1`。有效结果至少一段，首尾为真实接口位置，段间端点重合且切向连续，直线可用共线控制点表示。`path_points` 必须采样自这些段，弧长和最小弯曲半径也必须基于同一连续曲线验证。前端若从控制点重建，仅可使用相同定义并遵守验证采用的采样精度，不得另行拟合样条。

失败时 `curve_segments` 和 `path_points` 均为 `[]`，长度为 `null`，并包含原因。弯曲半径依据连续曲线校验，不能把采样点间的折线尖角视为符合半径要求。碰撞检查应覆盖曲线与采样点之间的线缆体积，而不只是点本身；验证需保守覆盖采样近似误差。算法实现时记录采样误差与弧长积分精度，并提供成功与失败 JSON 样例供前端解析和下载为 `cable_routing.json`。

附件“任意两点成功生成样条”表示接受任意合法表面点并在约束可行时生成路径，不承诺穿越障碍或突破线长限制；不可行条件仍必须返回失败。

## 5. 版本、错误与结果有效性

后端是正式场景和版本的唯一权威。客户端编辑是草稿，提交时携带预期版本；后端校验后原子保存并返回新场景。名称、类别、尺寸与确认状态、位置、接口、连接、区域、障碍、规划条件、物品增删或 `baseline_id` 改变时，版本递增；仅生成状态和外观 URL 更新不递增。无效或取消的编辑不递增。保存整份场景时必须合并后端当前外观与任务信息，不能由旧客户端副本回退生成进度。

规划接收与应用遵循以下规则：

1. 未保存草稿存在时不能应用规划结果；客户端只接受 `scene_id`、输入 `scene_revision` 均匹配正式场景的建议。输入变化后丢弃旧建议，由用户重新触发规划，避免自动重试循环。
2. `packing_result` 的版本始终是输入版本 n；接受建议后后端只应用目标变换，原子生成 n+1，原建议作为已消费的历史来源保留，不能再次应用或改写版本伪装成新结果。应用时不复制结果里的 `name`、`model_url` 或整份旧物品数据。
3. 当前布局是否有效由当前场景重新校验，指南的物品移动从原始快照与当前场景的差异生成，不要求历史布局建议仍匹配当前版本。后续仅编辑接线时无需重新整理，但须复查当前布局并重新走线。任意版本变化都使旧走线、比较指标与指南失效，首版重新验证全部请求线缆。
4. 后端保存规划、接受布局或发布指南时都在事务内复核场景 ID 和预期版本；前端丢弃旧响应不能代替后端检查。规划与指南发布本身不递增几何版本；应用布局才递增。

原始快照保存其确认时的完整场景，建立时所有物品尺寸及已有连接引用的接口必须确认，之后不可变。重新建立基线生成新 `baseline_id` 并递增当前版本；物品或连接集合改变后，旧基线仍保留，但比较按第 6 节标记不可比，不靠删除基线实体制造改进。

模型生成结果按场景 ID、物品 ID 与当前 `task_id` 匹配，仅替换外观，不能回写提交任务时的旧变换；已删除物品或被新任务替代的结果不再应用。同一版本的轮询响应也须按任务 ID 和状态前进规则合并，不能用较早的 `running` 响应覆盖已完成资产。

`issues[]` 统一结构为 `{entity_id, code, message}`，其中场景级问题的 `entity_id` 为 `null`。物品 `reason_code` 和线缆 `reason_code` 使用相同错误码集合：

| 错误码 | 含义 |
| --- | --- |
| `invalid_input` | 缺失字段、非法尺寸、未知 ID、重复 ID 或不兼容协议版本 |
| `no_space` | 无符合摆放约束的位置 |
| `collision` | 最终布局或路径存在碰撞 |
| `incompatible_ports` | 接口与线材类型不兼容 |
| `port_occupied` | 接口容量已占满 |
| `length_exceeded` | 路径与余量超过线长 |
| `endpoint_blocked` | 接口引出通道被遮挡 |
| `no_path` | 无满足净空、弯曲或禁入区条件的路径 |
| `unsupported_mode` | 策略未实现或对应通道未配置 |

协议版本、结构或 ID 引用错误在入口拒绝，不进入算法；具体 HTTP 状态由后端接口实现统一记录。供应商失败通过 `generation.error` 返回服务错误信息，不冒充几何规划失败。

## 6. 比较指标与指南数据

B 汇总独立比较载荷，A 用同一载荷展示指标，指南引用同一次比较；它不嵌入 C、D 的历史建议，也不另用一套统计口径。必需字段如下：

| 字段 | 定义 |
| --- | --- |
| `schema_version`, `scene_id`, `scene_revision`, `baseline_id` | 当前场景与基线标识，均遵循前文定义 |
| `area_grid_cell_m` | 首版固定为 `0.01`；面积比较双方采用同一网格 |
| `baseline_free_area_m2`, `current_free_area_m2` | 基线和当前主桌面最大连续可用面积，有限非负数；不可比时基线值为 `null` |
| `baseline_exposed_length_m`, `current_exposed_length_m` | 基线和当前全部请求线缆的桌面暴露总弧长，有限非负数或 `null` |
| `issues` | 当前场景的布局复查及本版本走线结果问题，沿用 `{entity_id, code, message}` |
| `unresolved_issue_count` | 当前 `issues` 按 `(entity_id, code)` 去重后的数量；不混入历史失败建议 |
| `comparison_note` | 不可比或未知值的原因字符串，全部可比时为 `null` |

面积统计范围固定为主桌面：在 X/Z 世界原点对齐的 0.01m 网格上，统计完全落在桌面矩形内、且不与桌面物品底部投影或该支撑面上的保留区相交的格子，取最大四邻接连通分量面积；格线接触不算体积占用。桌面物品指底面高度与 `desk.top_height_m` 在几何容差内一致的物品，保留区在 `min[1] <= desk.top_height_m < max[1]` 时投影为占用。书架、抽屉不累加到桌面面积，不同高度的悬空结构不投影为桌面占用。C 的面积函数对基线与当前场景分别计算，不能用“本次算法输入与目标”的面积冒充原始前后比较。

任一基线线缆路径未知时，基线暴露总长为 `null`；任一当前请求线缆失败或缺少本版本验证结果时，当前总长为 `null`，不能把失败空路径按零计入。没有请求线缆时总长为 0。基线折线按线段与暴露区域并集的交段长度计算，当前值按 D 已验证曲线弧长计算；两侧使用相同暴露区域，重叠区域不重复计数。

物品 ID 集合、确认尺寸、桌面尺寸或保留区改变时，面积比较不可比，基线面积返回 `null`；线缆 ID、起止接口、物理线材参数或 `exposure_zones` 改变时，线长比较不可比，基线线长返回 `null`。当前值仍按当前场景计算，`comparison_note` 说明变化；重新建立基线后才恢复对应比较。仅改变走线 `mode` 不影响基线可比性。任一比较值为 `null` 时不展示该项改进比例，基线为 0 时也不计算百分比。

指南绑定以上四个标识，由基线到当前的实际变化、当前布局复查及当前版本走线结果生成；包含搬动顺序、连接、穿线孔/固定点、线长与未解决事项。部分成功可导出带有“未完成”标记的指南，失败线不得有可执行穿线步骤；历史指南可查看但必须标记过期，不能作为当前有效方案。
