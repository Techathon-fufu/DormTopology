# 走线算法实现规划

本文是成员 D 的首版实现计划。字段、单位、坐标系和状态枚举以[数据契约](data_contract.md)为准；本文只补充算法内部的处理顺序、搜索策略和验收规则，不另建一套接口协议。

截至 2026-10-17，走线业务核心已迁入 `backend/app/domain/routing/`：规范入口为 `plan_routing(scene)`，`plan_routes` 是同一函数的兼容名称；曲线工具位于该包的 `geometry.py`，测试位于 `backend/tests/test_routing.py`。旧 `algorithm/cable_routing/` 仅保留兼容导出，领域层不依赖旧包。当前覆盖端口/引用校验、A* / Dijkstra、双策略配置图、Bézier 曲线与基础汇聚/指标，并补充完整终点代价、汇聚曲线段间切向连续性和输入拒绝回归。真实桌体通道、4/6/8 全规格与 3 根线验收、B/A 接入、C 的实际布局结果联调和终端验收仍不视为完成。

## 1. 目标与边界

算法接收用户确认后的当前场景，分别为每条线缆规划 `slot`（穿线孔）或 `backboard`（背板后）路径，并返回已经完成几何复查的三维曲线。算法只返回建议，不修改物品位置、接口或线缆连接；物品移动、尺寸修改、插排规格切换或通道配置变化后，由后端递增 `scene_revision` 并重新调用。

首版采用配置好的稀疏通道图，不从桌体网格自动推导任意通道。图节点和边必须真实对应穿线孔、背板后通道、桌沿、线槽或固定点；不能只切换结果中的 `mode` 标签来模拟另一种策略。

## 2. 输入形式

### 2.1 后端传入的场景

后端把完整的当前 `scene.json` 传给算法。走线需要读取以下字段：

| 输入部分 | 用途 |
| --- | --- |
| `schema_version`、`scene_id`、`scene_revision` | 协议和结果有效性校验，原样写入结果 |
| `items` | 读取物品变换、碰撞盒、接口局部坐标和接口类型 |
| `obstacles`、`reserved_zones` | 路径和线缆体积的禁入体积 |
| `exposure_zones` | 计算当前路径和原始路径的桌面暴露弧长 |
| `routing_graph` | 提供按策略过滤的允许节点和通道边 |
| `cables` | 连接端点、线缆类型、线径、弯曲半径、线长、余量和策略 |

`regions`、`desk` 等字段仍由入口结构校验读取；它们不参与路线搜索时不能被算法忽略。算法不读取 `model_url`、`generation` 等外观字段。

线缆请求沿用数据契约中的完整字段，不添加世界坐标端点：

```json
{
  "id": "cable_laptop_power",
  "start_port_id": "laptop_power",
  "end_port_id": "pdu_socket_1",
  "cable_type": "power",
  "thickness": "thin",
  "length_m": 1.8,
  "diameter_m": 0.004,
  "min_bend_radius_m": 0.02,
  "slack_m": 0.08,
  "mode": "slot"
}
```

### 2.2 入口校验

入口校验失败时不进入搜索。布局与走线共同复用 `backend/app/domain/rules.py` 校验协议版本、完整结构、有限数值、全局唯一 ID 与引用，走线另要求所连接口已确认。缺字段、不能表示为有限浮点数的极大整数和不可表示的物品世界碰撞体均通过带 `field` 的 `RoutingInputError` 拒绝，不泄漏 `KeyError` 或 `OverflowError`。后端负责映射这些错误；算法对单条线缆的语义失败使用数据契约中的 `reason_code`。

校验顺序固定为：

1. 检查 `schema_version == "1.0"`、场景 ID/版本存在，所有坐标和尺寸为有限数，长度和直径为正数，余量为非负数。
2. 建立物品、接口、图节点、图边、线缆的唯一 ID 索引，检查所有引用存在。
3. 按 `position + R_y(rotation_y_rad) * local_position` 计算接口世界坐标，按同一旋转矩阵变换 `local_direction`，并归一化方向。接口坐标不得使用模型包围盒中心替代底面中心。
4. 检查端口类型与 `cable_type` 兼容，统计每个端口在本次请求中的占用数，不超过 `capacity`。插排孔按独立端口处理，总线端口不能代替插孔。
5. 检查请求的 `mode` 是 `slot` 或 `backboard`，并确认图中存在对应边。`slot` 路径必须有实际 `kind: "slot"` 节点；`backboard` 路径必须有背板后的 `fixing_point` 节点和相应边，否则返回 `unsupported_mode`，不自动切换策略。
6. 检查每条边的端点存在、`modes` 非空、`clearance_radius_m` 大于零；边的直线几何仍需在搜索和最终曲线验证时重新检查，不能把配置视为免检。

### 2.3 算法内部的规范化对象

Python 模块内部使用类型化对象，不作为新的网络 JSON：

- `ResolvedEndpoint`：`port_id`、所属物品 ID、世界位置、世界朝外方向、碰撞体引用。
- `CableSpec`：线缆 ID、端口、模式、线径、最小弯曲半径、可用长度和线缆半径 `diameter_m / 2`。
- `RoutingEdge`：图边几何、允许模式、通道半径、暴露提示、相邻节点。
- `OccupiedTube`：已经成功规划的线缆曲线及其半径，用于后续汇聚检查。

所有内部几何仍使用米制右手 Y-up 世界坐标，几何容差沿用 `0.001m`。规范化阶段不复制或改名外部字段。

## 3. 搜索策略

### 3.1 采用 A*，保留 Dijkstra 作为等价调试路径

首版使用 A* 搜索每条线缆的策略子图。启发式为当前节点到目标端点的欧氏距离，这是非负边代价下的可采纳下界。搜索将到目标接口的最后连接和引入段计入完整终点代价，只有完整目标状态出队时才结束，避免在较近图节点提前停止。相同代价函数下与 Dijkstra 得到相同最优代价，并提供 `use_dijkstra=True` 开关及终点连接代价回归。

图边代价只包含非负项：

```text
edge_cost = length
          + exposure_penalty * (exposed ? length : 0)
          + bend_penalty * estimated_turn
```

`exposed` 只是搜索偏好，最终暴露线长必须按 `exposure_zones` 的曲线弧长计算。固定权重放在算法配置中并记录在运行日志；不写入场景协议，也不让前端传入任意权重。节点 ID 作为平局排序键，保证相同输入得到稳定结果。

每条线缆的图搜索过程如下：

1. 按 `mode` 过滤边，并为端口建立有限数量的候选引出边。引出段沿接口朝外方向到所属物品膨胀 OBB 的首出口；只豁免曲线首尾落在该有限直线通道内的连续段。其余段、其他物品、障碍及禁入区仍逐段扫掠检查，旋转设备也在局部坐标中检测，不能整体忽略设备碰撞体。
2. 先做边级净空和禁入体积检查。线缆半径加几何容差必须小于边的 `clearance_radius_m`；与 `obstacles` 或 `reserved_zones` 相交的边直接排除。
3. 在过滤后的图上运行 A*，得到端点到端点的节点折线。路径必须满足对应策略的拓扑条件：穿线孔策略实际穿过 `slot` 节点，背板后策略实际到达背板后固定点再下行。
4. 对折线做去重和共线点简化，保留端点、模式关键节点和线缆汇聚所需的几何点。

### 3.2 多线缆汇聚与有界重规划

多线缆使用“受限优先规划”，首版不引入全局多商品流求解器：

1. 先按可行引出候选数升序、线径降序、线缆 ID 升序排序；越难连接、越粗的线优先。
2. 每成功一条线，就把其验证曲线登记为 `OccupiedTube`。后续线缆可以共用通道，但必须在通道横截面内分配不同中心位置，满足两条线中心距 `>= (d1 + d2) / 2 + 0.001m`，并且所有中心位置都在 `clearance_radius_m` 内。
3. 检测到线缆体积冲突时，只对当前线缆重跑 A*，将冲突边或冲突线段加入临时禁用集合；最多尝试 3 个候选路径。仍失败时最多回退并重规划上一条线一次。
4. 超过总尝试上限立即返回 `no_path`，不能无限重试或把重叠中心线标记为有效汇聚。容量不足和端口重复使用分别返回 `port_occupied` 与 `no_path`。

## 4. 曲线生成与连续几何验证

搜索结果是用于避障的折线，不能直接作为最终线缆。曲线生成和验证必须使用同一批控制点与采样点：

1. 在每个折线转角两侧按 `min_bend_radius_m` 截取切线段，生成圆角过渡；相邻边长度不足以容纳最小半径时，该候选路径失败并换下一条。
2. 将直线段和圆角段编码为三次 Bézier 段。段间端点重合、切向连续，首尾控制点固定为真实接口世界坐标；无转角的直线使用共线控制点。共享通道的侧向偏移按各段端点速度修正控制点，使汇聚后的相邻段仍保持切向连续；复查同时拒绝端点重合但接缝带尖角的分段曲线。
3. 自适应采样每段曲线，直到弦高误差不超过 `0.0005m` 且采样间距不大于局部弯曲半径的 `1/8`。`path_points` 只能来自这些采样点。
4. 对同一曲线执行以下验证：
   - 端点位置与接口世界坐标误差不超过 `0.001m`，解析控制柄切向与起点朝外法向、终点反向法向一致；
   - 用曲线扫掠半径检查 `obstacles`、`reserved_zones`、设备碰撞体和已占用线缆管，不只检查离散点；
   - 用 Bézier 导数计算曲率，针对连续曲线自适应细分，最小曲率半径必须不小于 `min_bend_radius_m`；速度接近零或无法给出保守界时判定失败；
   - 用同一曲线做自适应弧长积分，检查 `path_length_m + slack_m <= length_m`；
   - 重新确认模式关键节点和通道净空仍被曲线覆盖。

曲线平滑后任何一项失败，都不能输出平滑前的折线作为成功结果；应尝试下一条搜索路径，耗尽上限后返回 `no_path`、`collision` 或 `length_exceeded` 等最具体原因。

显示采样用 Bézier 控制凸包到有限弦段的最大距离作保守误差界，并同时限制弦长；碰撞扫掠另加 `0.0005m` 采样误差余量。S 形曲线不能仅凭中点共线而跳过细分，达到细分预算仍无法满足误差时返回空采样并判定路线失败。

## 5. 暴露线长计算

对每条有效曲线，按 `exposure_zones` 的 AABB 并集裁剪同一条 Bézier 曲线，累加位于并集内的弧长，得到 `metrics.exposed_length_m`。该指标不使用 `routing_graph.edges[].exposed` 代替几何计算。

若输入提供某条线缆的 `baseline_path_points`，用同一裁剪和弧长规则计算基线；只要有一条请求线缆缺少基线，`baseline_exposed_length_m` 就为 `null`，不能按零或按当前路径补齐。没有任何有效当前路径时，当前暴露线长也为 `null`。B 汇总时只对已知数值计算差值或比例。

## 6. 输出与失败语义

算法输出一个可 JSON 序列化的 `cable_routing.json`，覆盖全部请求线缆，并原样携带输入 `scene_id`、`scene_revision`：

```json
{
  "schema_version": "1.0",
  "scene_id": "scene_demo",
  "scene_revision": 4,
  "status": "partial",
  "cables": [
    {
      "id": "cable_laptop_power",
      "start_port_id": "laptop_power",
      "end_port_id": "pdu_socket_1",
      "cable_type": "power",
      "thickness": "thin",
      "mode": "slot",
      "diameter_m": 0.004,
      "status": "valid",
      "curve_segments": [
        {"control_points": [[0.90,0.79,0.32],[0.86,0.79,0.32],[0.82,0.78,0.30],[0.78,0.78,0.30]]}
      ],
      "path_points": [[0.90,0.79,0.32],[0.84,0.785,0.3075],[0.78,0.78,0.30]],
      "path_length_m": 0.13,
      "reason_code": null
    }
  ],
  "metrics": {
    "exposed_length_m": 0.08,
    "baseline_exposed_length_m": null
  },
  "issues": []
}
```

单条失败时 `curve_segments`、`path_points` 为空，`path_length_m` 为 `null`，并填写一个已有错误码。顶层状态规则沿用数据契约：全部 `valid` 为 `success`，部分有效为 `partial`，全部失败为 `infeasible`。`unsupported_mode`、`invalid_input` 等原因不能伪装成备用策略成功。

前端只绘制算法返回的 `path_points`；若需要从 `curve_segments` 重建，必须使用数据契约规定的三次 Bézier 定义和同一采样精度，不能自行拟合另一条曲线。

## 7. 后端调用边界

当前纯函数入口位于领域包，后端直接调用：

```python
from backend.app.domain.routing import RoutingInputError, plan_routing

result = plan_routing(scene)
```

`plan_routes` 与 `plan_routing` 指向同一函数，原 `algorithm.cable_routing` 及其 `planner`、`geometry` 模块只重新导出领域对象。`Scene`、`RoutingResult` 和 `Issue` 等类型位于 `domain/models.py`。函数不修改传入对象，不写文件，不调用前端或 Rodin。B 负责保存请求、检查结果版本、应用有效结果和生成指南；D 只负责规划、几何验证、指标和 `issues`。结果版本与输入一致。

`validate_routing(scene, result)` 与 `measure_exposed_length(scene, result=None)` 两个独立入口尚未实现。当前曲线复查和暴露线长计算由规划函数内部执行，不等于已提供可供保存结果、指南独立复用的接口；后端 service、统一装配及正式版本保护也仍待实现。

运行算法与兼容性回归：

```sh
python3 -B -m unittest discover -s backend/tests -v
python3 -B -m unittest discover -s algorithm/cable_routing/tests -v
ruff check backend algorithm
```

`backend/tests/test_domain_boundaries.py` 在隔离 Python 子进程中仅加载复制的领域包，封锁旧算法包、Web、数据库、网络与供应商导入，并在算法运行期间禁止文件、网络及 SQLite I/O。完整共同场景可执行布局、模拟应用后递增版本、复查、面积和三条走线调用；旧包的全部公开入口也逐项核对为领域对象。该测试未运行服务装配或真实通道联调，失败走线仍按失败输出。

## 8. 实施顺序与验收样例

建议按以下顺序实现，每步都保留可独立运行的 JSON 样例：

1. 端口世界坐标、线缆类型/容量校验和单条直线路径。
2. `slot` 图搜索、引出段、A* 与失败原因。
3. Bézier 圆角、采样、弧长、弯曲半径和扫掠碰撞复查。
4. `backboard` 独立图搜索，验证同一端点产生与 `slot` 不同的有效路径。
5. 4/6/8 位插排端口分配、粗细线参数和两条以上线缆的通道汇聚。
6. 暴露线长、版本过期、线长不足、接口遮挡、通道过窄和策略缺失案例。

最低验收集包括：两种策略各一条成功样例；3 根线、4 位插排和多线汇聚；粗线/细线弯曲半径；移动物品后端点随旋转更新；每一种失败原因都没有残留有效路径；布局应用后递增版本并能在新版本重新规划。
