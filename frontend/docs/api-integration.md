# 服务适配层与后端接口约定（前端 0.6.0）

本文档记录前端「后端服务适配层」的实现口径：运行模式切换、统一 HTTP 客户端、四项能力的 wire 契约、
前端本地校验、任务留痕与刷新恢复，以及**当前无法联调的字段缺口**。

> 状态声明（重要）：
> - 仓库内后端 FastAPI 服务尚未实现（`backend/app/domain/` 仅有算法层），**本契约由前端依据
>   [docs/data_contract.md](../../docs/data_contract.md) 推导自定稿**，联调前可能调整；
> - 适配层已实现并通过本地「假 HTTP 服务器」冒烟验证（超时 / 网络错误 / 非 2xx / 坏 JSON / 任务 404 /
>   轮询状态流转 / 取消 / 校验器 / 存储持久化 / 模式解析，详见第 9 节），**尚未与真实后端联调**；
> - 前端不持有任何服务密钥（Rodin 等第三方密钥只在后端）。

---

## 1. 运行模式与切换

| 项 | 说明 |
| --- | --- |
| `VITE_API_MODE` | `mock`（默认，本地模拟服务）/ `real`（调用应用后端） |
| `VITE_SERVICE_MODE` | 旧变量兼容：`mock` / `service`（`service` 等价 `real`）；同时存在时 `VITE_API_MODE` 优先 |
| `VITE_API_BASE_URL` | 后端地址前缀；留空 = 与前端同源。拼接规则：`${base}/api/v1/<path>` |
| `VITE_API_TIMEOUT_MS` | 单次 HTTP 请求超时（默认 15000 ms）；长任务轮询使用独立节奏，不受此值影响 |

运行时可切换：「切换到演示模式」按钮（任一失败提示、服务状态面板内）写入 localStorage
`dormtopology.api-mode-override` 并刷新页面；刷新后仍生效，可在服务状态面板「恢复真实模式」
（清除覆盖键）。环境变量本身是 `mock` 时不会出现切换入口。

**不会静默降级**：`real` 模式下任何失败（网络 / 超时 / 非 2xx / 响应格式错误 / 任务失败 / 任务不存在）
都直接展示真实原因与重试入口，不会回退到 mock 结果假冒成功。

## 2. 统一 HTTP 客户端（`src/api/core/client.ts`）

| 情况 | 处理 | 错误分类 `ApiError.kind` |
| --- | --- | --- |
| 连接失败 / 断网 / 服务未启动 | 抛错，提示「可切换到演示模式」 | `network` |
| 超过 `VITE_API_TIMEOUT_MS` | AbortController 中止并抛超时 | `timeout` |
| 非 2xx | 提取响应体 `detail`/`message`/`error` 作为原因 | `http`（`status` 保留） |
| 404（默认） | 视为「任务或资源不存在（可能过期 / 后端重启）」 | `not-found` |
| 2xx 但响应不是 JSON | 抛格式错误（不猜测内容） | `malformed` |
| 请求前置条件不满足（如未选照片） | 提交前直接拒绝 | `input` |
| 用户取消 | `POST /jobs/{id}/cancel` 后按 cancelled 处理 | `cancelled` |
| 调用方中止（组件卸载） | 任务留存，由 watcher 继续查询 | `aborted` |

## 3. 通用 wire 约定

- 路径前缀 `/api/v1`，字段一律 `snake_case`，长度米制、角度弧度、时间 ISO 8601；
- 任务状态枚举：`queued` / `running` / `succeeded` / `failed` / `cancelled`；
- 所有长任务统一「提交 → jobId → 轮询」两段式：

```jsonc
// POST /api/v1/<capability>  →  202
{ "job_id": "job_...", "status": "queued", "created_at": "2026-10-17T09:00:00Z" }

// GET /api/v1/jobs/{job_id}
{
  "job_id": "job_...",
  "kind": "cable",
  "status": "running",            // queued | running | succeeded | failed | cancelled
  "progress": 0.62,               // 可选 0~1；缺省时界面只显示阶段文字（不伪造百分比）
  "stage": "避障检查",
  "created_at": "2026-10-17T09:00:00Z",
  "updated_at": "2026-10-17T09:00:05Z",
  "algorithm_version": "routing-0.3.1",   // 整理 / 走线等算法任务应回报（界面留痕展示）
  "cancellable": true,
  "result": { /* 见各能力 */ },
  "error": { "code": "E_NO_PATH", "message": "…" }   // failed 时
}
```

- 轮询节奏：首次 0.8 s，×1.3 退避，封顶 4 s；**连续 3 次查询失败**才判定任务失败
  （瞬时网络抖动容忍，但不静默成功）；页面刷新后由 `ApiRuntime` 每 10 s（及 focus / online 事件）
  继续查询非终态任务；
- 取消：`POST /api/v1/jobs/{job_id}/cancel` → 返回更新后的任务信封（或 202 接受，前端置 cancelled）；
- 健康检查：`GET /api/v1/health` → `{ "status": "ok" | "degraded", "version": "0.3.0" }`
  （5 s 超时；无法识别的结构按 `degraded` 处理）。

## 4. 四项能力契约

### 4.1 照片识别 `POST /api/v1/recognition`

请求：`multipart/form-data`

| 字段 | 说明 |
| --- | --- |
| `project_id` | 项目 id |
| `photos` | 照片文件（可多张；前端从 IndexedDB 读取原图上传） |

响应 `result`：

```jsonc
{
  "items": [
    {
      "temp_id": "r_1",
      "name": "台灯",
      "category": "electrical",       // electrical | nonElectrical | storage（兼容 power_strip 等细分）
      "size_m": [0.18, 0.35, 0.18],
      "quantity": 1,
      "needs_power": true,
      "fixed": false,
      "dimensions_source": "estimated", // estimated（估计值，界面强制标注待确认）| user
      "confidence": 0.86,               // 0~1；缺失按 0.5 且计入待确认
      "ports": [
        { "id": "p1", "type": "power_sink", "local_position": [-0.03, 0.05, -0.07], "local_direction": [0, 0, -1] }
      ]
    }
  ],
  "low_confidence": 1,
  "note": "可选说明"
}
```

- 接口类型映射（wire → 内部）：`power_source|power_sink|power|power-ac → power-ac`、`usb|usb-a → usb-a`、
  `usb-c`、`dc`、`network|rj45 → rj45`、`hdmi`、`audio`、`wireless`；未知类型丢弃并计入 warnings；
- `local_position` 为相对物品中心（模型坐标系）的偏移；`local_direction` 取最接近的 6 向之一；
- 前端不信任「估计值＝确认值」：`dimensions_source=estimated` 一律保持「待确认」状态。

### 4.2 模型生成 `POST /api/v1/models/generate`

请求（JSON）：

```jsonc
{
  "project_id": "…",
  "object": { /* WireItem，见 4.5 场景载荷 */ },
  "attempt": 0,
  "photo_id": "照片记录 id 或 null"
}
```

响应 `result`：`{ "object_id": "…", "status": "ready" | "failed", "asset_url": "https://…/x.glb", "format": "glb", "note": "…" }`

- 适配层规则：`status=failed` → 整体按失败（抛 `job` 错误），不写「成功」；
- `asset_url` 就绪时写入 `ModelRef.assetUrl` 且状态置 `ready`；**三维场景暂未接入 URL 模型渲染**，
  仍以匹配尺寸占位几何显示（界面注明），这是本轮如实限制。

### 4.3 空间整理 `POST /api/v1/organization/plan`

请求（JSON）：

```jsonc
{
  "project_id": "…",
  "scene": { /* 场景载荷，见 4.5 */ },
  "preferences": {
    "typing_offset_x": 0.0,       // -0.6 ~ 0.6（相对桌面中心，米）
    "typing_width": 0.6,          // 打字活动区宽度
    "cup_corner": "rightFront",   // leftFront | rightFront | leftBack | rightBack | none
    "preferred_storage_zone": "underDesk"  // desk | shelf | underDesk
  }
}
```

响应 `result`（对应 `docs/data_contract.md` 的 `packing_result`）：

```jsonc
{
  "status": "success",              // success | partial | infeasible
  "algorithm_version": "packing-0.2.0",
  "items": [
    {
      "item_id": "…",
      "name": "台灯",
      "target_pos": [0.35, 0.77, 0.30],
      "target_rotation_y_rad": 1.5708,
      "target_region_id": null,       // 前端暂无 region 概念，可空
      "placement_status": "placed",   // placed | unchanged | unplaced
      "reason_code": null,
      "reason": "靠桌角，避让打字区"
    }
  ],
  "issues": [],
  "metrics": { "desk_free_before": 0.21, "desk_free_after": 0.34, "overlap_count": 0, "out_of_bounds_count": 0 }
}
```

前端本地校验（不通过即丢弃该条目并汇总 warnings，**不静默采用**）：
引用物品存在、数值有限、目标位置在房间边界内、固定 / 锁定物品强制保持原位（即使后端给了移动目标）；
相交数会在本地复核（轴对齐包围盒，0 / π/2 朝向考虑，旋转角未精确建模）并写入方案指标；
`status=infeasible` 的方案只读展示，界面提示未应用任何移动。

### 4.4 走线规划 `POST /api/v1/cables/plan`

请求（JSON）：

```jsonc
{
  "project_id": "…",
  "scene": { /* 场景载荷，含 cables 与各接口局部几何 */ },
  "target_cable_ids": ["c1"],         // null = 全部线缆
  "preferences": { /* 同 4.3 */ }
}
```

响应 `result`：

```jsonc
{
  "status": "ok",                     // ok | partial（供参考；前端不据此判成败）
  "verified": false,                  // 后端避障验证标记；非 true 时前端不标注「已验证」
  "algorithm_version": "routing-0.3.1",
  "cables": [
    {
      "cable_id": "c1",
      "path_points": [[0.1,0.77,0.3],[0.1,0.62,0.3], …],  // ≥ 2 点；首末点应为端点附近（前端以端点坐标贴合首末点）
      "channels": ["deskUnderside", "post"],               // deskEdge | deskUnderside | post | floor | free（兼容 snake_case）
      "length_m": 1.42
    }
  ],
  "issues": [
    { "cable_id": "c2", "code": "E_BEND_RADIUS", "message": "弯折半径不足" }
  ]
}
```

前端本地校验：点数 ≥ 2、逐点为有限数且粗边界内（容差 0.2 m，允许贴墙 / 端点）；不合格路径整条丢弃并
计入 warnings（界面显示未采用数量），其余正常采用；`issues` 中的线缆标记为冲突并展示原因。

### 4.5 场景载荷（`scene`，请求侧）

```jsonc
{
  "schema_version": "1.0",
  "scene_id": "项目 id",
  "desk": { "width_m": 1.45, "depth_m": 0.6, "top_height_m": 0.77 },
  "items": [
    {
      "id": "o1", "name": "显示器", "category": "electrical",
      "size_m": [0.6, 0.4, 0.2],
      "position": [0, 0.77, 0.3], "rotation_y_rad": 0,
      "dimensions_source": "user", "dimensions_confirmed": true,
      "fixed": false, "usage_frequency": "high",
      "ports": [ { "id": "p1", "type": "power-ac", "local_position": [0.1, 0.1, -0.1], "local_direction": [0,0,-1], "powered": true, "confirmed": true } ],
      "model_url": null
    }
  ],
  "cables": [ { "id": "c1", "cable_type": "power", "thickness": "thick", "from": {"object_id":"o1","port_id":"p1"}, "to": {"object_id":"o2"}, "mode": "slot", "diameter_m": 0.0065, "min_bend_radius_m": 0.0325, "length_m": null } ],
  "client_note": "前端字段子集说明"
}
```

- `cable_type`：内部 5 类（power / charging / video / network / data）映射为 `power|power|hdmi|network|usb`；
  `thickness=thick` 覆盖电源 / 网线 / 视频线，`thin` 覆盖充电 / 外设线（与 data_contract 的粗/细预设一致）；
- `diameter_m` / `min_bend_radius_m` 当前使用前端演示预设（粗 6.5 mm / 32.5 mm，细 3.5 mm / 17.5 mm），
  **数值待产品确认后由后端定稿**，前端未存储该配置；
- `length_m`：用户填写的实际线长，未填写为 `null`（后端需容忍）。

### 4.6 布局规划（遗留能力）`POST /api/v1/layout/plan`

请求：`{ "project_id": "…", "scene": { … } }`；响应 `result`：
`{ "assignments": [{ "object_id": "…", "position": [x,y,z], "rotation_y_rad": 0, "zone": "deskBack" }], "score": 78, "summary": "…" }`
（`zone`：`deskBack|deskFront|deskSide|floor|free`）。前端同样做引用 / 有限数 / 边界校验。
说明：该服务当前没有界面调用点（历史服务层预留），契约仅为对齐而记录。

## 5. 任务留痕与刷新恢复

- 每次提交都会在 `state/remoteJobsStore`（localStorage `dormtopology.remote-jobs`，上限 30 条）留痕：
  `id(job_id)`、项目、能力、状态、进度、阶段、算法版本、请求参数摘要、创建 / 更新时间、错误或结果摘要；
  **不保存结果载荷**（避免存储膨胀与陈旧数据被误用）；
- 刷新页面后：`ApiRuntime` 自动继续查询非终态任务（每 10 s + focus / online），更新的状态 / 错误 /
  结果摘要写回任务列表；
- **如实限制**：恢复查询只更新状态与摘要，**不会把结果自动重放应用到场景**（避免陈旧结果覆盖当前编辑）；
  需要重放时请在原入口重新执行一次任务（如重新「生成整理方案」）；
- 界面入口：工作台底栏 / 页头的「任务 N」服务状态面板（重查 / 取消 / 移除 / 清除已结束）。

## 6. 字段缺口（联调前需后端 / 产品定稿）

| 缺口 | 现状 | 影响 |
| --- | --- | --- |
| 坐标原点 | 前端发送内部坐标（x 以桌面中心为 0、后墙 z=0）；[data_contract](../../docs/data_contract.md) 约定「桌面左后角投影」原点 | 若后端按契约解析，需平移 `[desk_width/2, 0, +z 偏移]`；联调前必须二选一定稿 |
| `scene_revision` | 前端暂无修订号 | 后端无法做乐观并发校验 |
| `regions` / `target_region_id` | 前端无区域实体，发送 `null` | 后端区域相关优化不可用 |
| `obstacles` / `reserved_zones` / `routing_graph` / `allowed_region_ids` | 未提供 | 后端避障与走线只能依据物品几何 |
| `dimensions_confirmed` | 由尺寸来源推断（estimated→false） | 语义若不同需对齐 |
| 线径 / 最小弯折半径 | 前端演示预设（见 4.5） | 数值与产品实物不符时结果不可用 |
| `mode`（slot/backboard）与墙面锚点 | 统一发送 `slot`；墙面安装细节未发送 | 背板走线场景受限 |
| `usage_frequency` | 频繁/常用 → high，其余 medium | 若后端分级不同需映射 |
| 识别 `quantity` / `fixed` | 透传，缺省 1 / false | — |
| `photo_id` | 仅透传本地上传记录 id（照片经 multipart 已上传） | 若后端需要照片引用 id 需改为服务端 id |

## 7. 安全边界

- 前端**不配置、不存储、不读取任何服务密钥**（无 token / apiKey 字段；localStorage 仅模式偏好与任务元数据）；
- 第三方模型生成（Rodin 等）由后端代理持有密钥；前端只与「应用后端」通信；
- 上传的照片仅发往应用后端；演示模式不产生任何网络请求。

## 8. 本地校验与数据来源标注

- 真实结果一律经 `src/api/core/wire.ts` 校验后使用；不合格条目显式丢弃并生成 warnings（界面展示原因）；
- 界面数据来源徽标：`模拟`（mock）/ `真实服务`（real，已过本地校验）/ `计算值`（本地纯计算，如长度估算）/
  `未接入` / `演示数据`；
- 走线结果仅在 `verified === true` 时标注后端已验证；否则如实标注「后端未标记 verified」；
- 识别尺寸估计值保持「待确认」，不标记为真实尺寸。

## 9. 冒烟验证（本轮实测）

适配层核心（客户端 / 轮询 / 校验器 / 存储 / 模式）通过临时的本地假 HTTP 服务器（Node `http`）验证：
超时、网络错误（服务不可达端口）、HTTP 500、坏 JSON、任务 404、轮询 queued→running→succeeded、
失败任务、取消、走线路径越界丢弃 + 有效路径采用、识别缺字段警告、整理固定物品保护、
模式解析（env / override / 旧变量）、remoteJobsStore localStorage 持久化；验证后临时文件已删除。
类型检查与生产构建通过（`npm run typecheck` / `npm run build`）。

## 10. 联调与实现清单（对应 teammate 后端）

后端需实现（FastAPI）：

1. `POST /api/v1/recognition`（multipart，照片识别，返回 4.1 结构）
2. `POST /api/v1/models/generate`（对接 Rodin 等生成服务，资产存对象存储 / 静态目录）
3. `POST /api/v1/organization/plan`（`backend/app/domain` 打包算法接入）
4. `POST /api/v1/cables/plan`（走线 / 避障算法接入）
5. `POST /api/v1/layout/plan`（可选，暂无调用点）
6. `GET /api/v1/jobs/{id}`、`POST /api/v1/jobs/{id}/cancel`（统一任务表）
7. `GET /api/v1/health`
8. CORS 允许前端 origin；错误响应体使用 `{ "detail": "…" }`（与 FastAPI 默认一致）

联调步骤：后端就绪后设置 `VITE_API_MODE=real` 与 `VITE_API_BASE_URL`，先看服务状态面板「后端在线」，
再依次验证四项能力与取消 / 刷新恢复；字段缺口（第 6 节）需在此前确认。
