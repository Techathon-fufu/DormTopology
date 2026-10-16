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

## 2. 场景输入 `scene.json`

顶层必需字段：

| 字段 | 定义 |
| --- | --- |
| `schema_version` | 固定字符串 `"1.0"`；不兼容版本必须拒绝 |
| `scene_id` | 场景稳定 ID |
| `scene_revision` | 单调递增整数，尺寸、位置、接口、连接或规划条件改变时递增 |
| `baseline_id` | 用户确认的原始快照 ID；快照单独保存，不被当前状态覆盖 |
| `template_id` | 场景模板 ID，首版为 `demo_desk_v1` |
| `desk` | `{width_m, depth_m, top_height_m}`，均为正数，必须与区域、碰撞体和显示几何一致 |
| `items` | 下述物品数组，包括设备、插排、墙插与网口 |
| `regions` | 可摆放的桌面与书架支撑面 |
| `obstacles` | 桌板、立柱、背板等固定碰撞体 |
| `reserved_zones` | 不可占用或穿越的操作区、水杯活动区等体积 |
| `exposure_zones` | 用于计算桌面暴露线长的体积，字段为 `id`、`min`、`max`，不参与禁止通行判定 |
| `routing_graph` | 已配置的允许走线节点和边，包含穿线孔与固定点 |
| `cables` | 用户确认的线缆和连接关系 |

### 2.1 物品

| 字段 | 定义 |
| --- | --- |
| `id`, `name`, `category` | 唯一 ID、显示名、类别；算法不使用名称作为主键 |
| `size_m`, `position`, `rotation_y_rad` | 按第 1 节解释 |
| `dimensions_source` | `user` / `template` / `estimated`，估计值需要用户确认 |
| `fixed` | 是否禁止自动移动 |
| `usage_frequency` | `high` / `medium` / `low` |
| `allowed_region_ids` | 允许摆放的区域 ID；固定墙面设备可为空 |
| `allowed_rotations_y_rad` | 允许的朝向数组，首版采用 0 与 π/2 的子集 |
| `collision` | 首版 `type: "box"`，使用 `size_m` 与物品变换；可保守包围圆柱物品 |
| `ports` | 接口数组，字段见下文 |
| `image_url`, `model_url` | 图片与已归一化模型 URL，无资产时为 `null` |
| `generation` | `{task_id, status, source, error}`；无任务时 `task_id` 为 `null` |

`generation.status` 为 `not_requested` / `queued` / `running` / `succeeded` / `failed`。`source` 为 `placeholder` / `live` / `cache`；完成前保留 `placeholder`，错误为空时用 `null`。供应商任务标识保留在后端适配器，不与内部 `task_id` 混用。模型替换不修改 `scene_revision`，因为规划几何不变；尺寸校正则必须修改版本。

接口字段为 `id`、`type`、`local_position`、`local_direction`、`capacity`。首版 `capacity` 为 1，接口 ID 在场景内唯一；插排每个插孔是独立接口。类型为 `power_source` / `power_sink` / `usb` / `network` / `hdmi`。电源线连接 source 与 sink，其他线连接同类接口；USB 等复杂协议协商不在首版范围。

前端可接收物品表面任意取点的世界坐标，按第 1 节逆变换写入接口的 `local_position`，表面法向转换为 `local_direction`，确认类型后再提交线缆；不另加与接口坐标重复的线缆端点字段。终点同样引用插排、墙插或网口的独立接口。

插排使用 `category: "power_strip"`，额外必需字段 `socket_count` 为 `4` / `6` / `8`，必须恰有相同数量的 `power_source` 接口，并有一个供插排总线使用的 `power_sink` 接口。选择规格时同步更新尺寸、碰撞体与接口；保留仍存在的接口 ID，移除接口上的线缆必须由用户重新指定，不能自动改接或静默删除。编辑过程中可提示悬空连接，但输入进入算法前仍须通过全部 ID 引用校验；切换规格递增场景版本。

照片识别需区分常用外设与待收纳杂物，用户确认后映射到现有 `category`、`allowed_region_ids` 和 `fixed`，不另加同义分类字段。键盘、鼠标、数位板允许区域为桌面中央；课本、水杯、收纳盒等允许区域为书架格或抽屉，具体区域 ID 由演示场景配置。

### 2.2 区域与碰撞几何

- `regions[]`：`id`、`surface_y_m`、`bounds_xz_m: [x_min, x_max, z_min, z_max]`、`clearance_height_m`。物品底面必须完整落在区域内，`position[1]` 等于支撑面高度，物品高度不超过净空。
- 四格书架每格单独配置区域；右侧抽屉区域使用内部底面、内边界与净高，内壁纳入 `obstacles`。抽屉在固定可访问状态规划，不要求开合动画，不允许通过忽略壁厚扩大收纳容积。
- `obstacles[]` 与 `reserved_zones[]`：`id`、`min: [x,y,z]`、`max: [x,y,z]`，均为世界坐标 AABB。区域接触作为支撑处理，体积相交作为冲突处理；几何容差固定为 0.001m，不能用容差豁免明确的穿透。
- 桌板穿线孔必须同时体现在桌板碰撞体分割和走线通道中，不能仅给封闭桌板添加路径节点。
- `routing_graph.nodes[]`：`id`、`position`、`kind`，kind 为 `corner` / `slot` / `fixing_point` / `endpoint`。
- `routing_graph.edges[]`：`id`、`from_node_id`、`to_node_id`、`modes`、`clearance_radius_m`、`exposed`；边首版表示直线通道，需通过碰撞检查，净空半径不得小于线缆半径。`modes` 为 `slot` / `backboard` 的非空子集，图边为双向。
- `slot` 路径必须经过 `kind: "slot"` 的实际开孔通道下行；背板后通道以 `fixing_point` 节点与允许 `backboard` 的边配置，路径必须绕至背板后下行。两种模式的完整通道均需在演示场景配置，不能仅通过更改输出标签表示不同策略。
- 多线缆允许在同一通道汇聚，必须为线缆体积安排不相交的位置并复查共享通道净空。单个插孔的容量规则不因汇聚而改变；通道不足时返回 `no_path`。
- 设备接口通过经碰撞检查的引出段连接到图；仅允许在已标定接口附近的短引出通道离开所属设备碰撞体，不能整体忽略该设备障碍。

### 2.3 线缆输入

每条线缆必需字段为 `id`、`start_port_id`、`end_port_id`、`cable_type`、`thickness`、`length_m`、`diameter_m`、`min_bend_radius_m`、`slack_m`、`mode`。

- `cable_type`：`power` / `usb` / `network` / `hdmi`，用于连接类型校验。
- `thickness`：`thick` / `thin`，用于界面预设；实际规划采用用户确认的 `diameter_m` 和 `min_bend_radius_m`。
- 粗线预设覆盖台式机/显示器电源线、网线与插排总线，细线预设覆盖充电线、外设连接线；预设提供不同线径和弯曲半径，数值需在实现时记录并由用户确认，不能仅依据电气类型强制指定粗细。
- `length_m` 是现有线长；最终路径长度加 `slack_m` 不得超过它。
- `mode`：首版必须支持 `slot` 与 `backboard`。对应实现或通道缺失时返回 `unsupported_mode`，仍属于该策略验收未完成，不能改走另一策略后标记成功。
- 原始线缆可选 `baseline_path_points`；未提供时，原始暴露线长未知，不能按零计算。

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

示例只含一个物品，实际输出必须覆盖所有参与整理的物品，固定物品也需要保留。`current_pos` 是本次输入的位置，不是原始快照位置。`target_region_id` 引用输入区域，不能由自然语言临时生成。

每条物品结果包含 `name` 与 `model_url`，分别复制当前输入物品的显示名和已归一化独立资产路径，无模型时为 `null`；前端仍按 `item_id` 匹配，不以名称为主键。`current_pos` 与 `target_pos` 分别满足附件要求的整理前坐标和目标坐标。以上载荷可序列化下载为 `packing_result.json`，不要求后端和算法通过磁盘通信。

顶层 `status` 为 `success` / `partial` / `infeasible`：全部满足收纳要求为 success，存在未安放物品但整体仍无冲突为 partial，无法给出满足硬约束的布局为 infeasible。每件物品 `placement_status` 为 `placed` / `unchanged` / `unplaced`。后两种的目标位置与朝向保持输入值；`unplaced` 需带原因，目标区域无法确认时为 `null`，且继续参与最终场景碰撞检查。

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
  "metrics": {
    "exposed_length_m": null,
    "baseline_exposed_length_m": null
  },
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

`metrics.exposed_length_m` 是所有有效当前路径在 `exposure_zones` 并集内的弧长之和；没有任何有效路径时为 `null`。只有所有请求线缆都提供 `baseline_path_points`，才能用相同规则计算 `metrics.baseline_exposed_length_m`，否则为 `null`。失败线缆不贡献当前暴露线长，未知基线不能按零处理。该指标由走线算法计算，前端不自行估算。

附件“任意两点成功生成样条”表示接受任意合法表面点并在约束可行时生成路径，不承诺穿越障碍或突破线长限制；不可行条件仍必须返回失败。

## 5. 版本、错误与结果有效性

客户端只接受 `scene_id`、`scene_revision` 均匹配当前场景的规划结果。不匹配则丢弃并重新请求；旧结果不能覆盖新变换。指南绑定原始 `baseline_id` 和当前 `scene_revision`，变更后必须重新生成。模型生成结果按物品 ID 与当前 `task_id` 匹配，仅替换外观，不能回写提交任务时的旧变换；已删除物品或被新任务替代的结果不再应用。

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
