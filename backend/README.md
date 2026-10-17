# DormTopology 3D 后端核心实现层

本目录包含领域算法、整理与走线应用服务、SQLite 持久化、FastAPI 接口，以及独立的外部服务适配器与脚本。整理服务调用真实 `plan_packing`，走线服务调用真实 `plan_routing`；照片识别、Rodin 和独立布局规划的应用接口尚未接入，返回 HTTP 501，独立脚本不等于应用接口验收。

## 启动规划服务

固定提交的独立检出、虚拟环境、全新 SQLite 与前端代理配置见[干净本地实例部署](../docs/local_deployment.md)。

从仓库根目录执行（Python 3.11+）：

```bash
python3 -m pip install -r backend/requirements.txt
python3 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

健康检查为 `http://127.0.0.1:8000/api/v1/health`，接口文档为 `http://127.0.0.1:8000/docs`。前端开发服务器通过同源 `/api/v1` 代理访问，或显式设置 `VITE_API_BASE_URL=http://127.0.0.1:8000`。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `DORMTOPOLOGY_DB_PATH` | `~/.local/share/dormtopology/organization.sqlite3` | SQLite 场景、不可变基线和任务持久化；自动建立父目录 |
| `DORMTOPOLOGY_JOB_WORKERS` | `2` | 整理与走线共用的后台工作线程数 |
| `DORMTOPOLOGY_JOB_CAPACITY` | `8` | 运行和排队任务总上限，必须不小于工作线程数；满时 HTTP 503 |
| `DORMTOPOLOGY_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | 允许直接跨域访问的前端来源，逗号分隔；使用同源代理无需额外设置 |

运行一个后端进程。每个 SQLite 读取或事务独立创建并关闭连接，算法在写事务之外执行。应用 lifespan 统一创建服务与执行器，关闭时等待后台工作退出；重新启动后未完成任务变为 `failed`，错误代码 `interrupted`，允许用户重新提交。取消会阻止结果发布；已开始的 Python 算法会完成当前计算后释放执行容量。

## 场景与规划接口

接口前缀为 `/api/v1`，请求和返回均使用米制、桌面左后角投影原点的[完整领域场景](../docs/data_contract.md)。

| 方法与路径 | 请求 / 返回 |
| --- | --- |
| `GET /health` | `{status: "ok", version, capabilities: ["organization", "cable"]}` |
| `PUT /projects/{project_id}/scene` | `{scene, expected_revision, baseline_source_id, baseline?}` → 完整正式 `Scene` |
| `GET /projects/{project_id}/scene` | 完整正式 `Scene` |
| `GET /projects/{project_id}/scene-state` | 同一次读取的 `{scene: Scene, baseline_source_id}`，用于核对响应中断的同步 |
| `GET /scenes/{scene_id}` | 完整正式 `Scene` |
| `POST /organization/plan` | `{scene_id, scene_revision}` → HTTP 202 `{job_id, status, created_at}` |
| `POST /cables/plan` | `{scene_id, scene_revision, target_ids?}` → HTTP 202 `{job_id, status, created_at}` |
| `GET /jobs/{job_id}` | 持久化任务信封；`kind` 为 `organization` / `cable`，成功时 `result` 为完整 `packing_result` / `cable_routing` |
| `POST /jobs/{job_id}/cancel` | 返回当前任务信封，已结束任务保持其终态 |
| `POST /jobs/{job_id}/apply` | `{scene_id, scene_revision}` → 应用后完整 `Scene`，仅支持整理任务 |

首次保存传 `expected_revision: null`，并提供完整 `baseline` 与稳定的 `baseline_source_id`。后端分配正式 `scene_id`、`baseline_id` 和修订号 1，替换客户端临时标识。原始快照允许物品重叠，但须确认所有尺寸及已有线缆引用的接口；初始几何混乱不会被误当作结构错误拒绝。

后续保存必须携带当前版本；`baseline_source_id` 不变时忽略传入的基线、保留原始快照，改变时必须提交新的完整基线。内容无变化保留版本，实际编辑或重建基线递增一次。规划要求确认当前物品尺寸。接受 `success` / `partial` 时服务复查完整物品覆盖、固定和残留物品原位、支撑、碰撞及边界，在同一事务中消费建议并保存新版本。`infeasible`、旧版本、重复应用或并发输掉版本检查均 HTTP 409。

保存已提交但响应中断时，客户端可读取 `scene-state`，核对基线来源、完整提交内容和合法身份版本后恢复。首次保存仅接受版本 1；已有引用要求场景 ID 不变、版本为原值或加一；重建基线必须版本加一且基线 ID 改变。来源、内容或版本不符保留原错误，不能重试覆盖其它客户端的场景。用户取消不触发恢复。

成功任务保留领域输出的 `scene_id`、`scene_revision`、全部物品和 `issues`，并扩展 `algorithm_version` 与 `metrics`。`desk_free_before` 来自不可变原始快照的最大连续面积；物品 ID、尺寸、碰撞体、桌面或保留区变化时为 `null`。纯外观替换不改变碰撞体，仍可比较。`desk_free_after` 为目标场景的同口径面积，不使用前端粗算替代。失败/取消任务不提供有效规划结果；几何不可行仍属于已完成的算法计算，任务为 `succeeded`、领域结果为 `infeasible`。

走线请求使用已保存的完整当前场景，并要求尺寸及连接引用的接口已确认。`target_ids` 可省略或为 `null`；提供时必须是非空、不重复的现有线缆 ID。它仅记录本次操作的触发范围：首版始终共同规划全部场景线缆，完整检查端口容量、线缆间占用与集线槽分组，结果覆盖全部线缆。保存结果在 SQLite 事务内复核输入版本；场景修改、取消或重启后旧任务不能发布新结果。规划本身不递增场景版本，也不需要 `/apply`；后者会拒绝走线任务。读取历史任务后仍须核对其版本与当前正式场景一致。

走线 `algorithm_version` 为 `routing-1.0`。输入 `length_m` 允许为 `null`，未知现有线长也能规划并计算所需长度 `path_length_m + slack_m`；已知线长仍须为有限正数并校验是否足够。任务 `succeeded` 仅表示计算结束，仍须检查结果 `status` 与每根线的 `valid` / `failed`；线长不足等失败结果不含路径、控制点或有效长度。缺失原始实测路径时基线暴露长度为 `null`。未配置安装支撑策略的场景返回 `support_check.status: "not_evaluated"`，不代表已验证施工可行性。独立 `validate_routing` / `measure_exposed_length`、产品安装件编辑与确认、真实布局应用后三线全流程及正式指南仍待验收。

错误结构为 `{error: {code, message, field?}, detail?}`；HTTP 422 表示结构、引用或确认状态错误，404 表示资源不存在，409 表示冲突，503 表示任务容量已满。`POST /recognition`、`/models/generate`、`/layout/plan` 明确返回 501。

## 验证

```bash
python3 -B -m unittest backend.tests.test_organization_service backend.tests.test_organization_api backend.tests.test_routing_service backend.tests.test_routing_api -v
python3 -B -m unittest discover -s backend/tests -v
ruff check backend/app/service backend/app/db backend/app/api backend/app/bootstrap.py backend/app/main.py backend/tests/test_organization_service.py backend/tests/test_organization_api.py backend/tests/test_routing_service.py backend/tests/test_routing_api.py
```

新增服务与接口测试使用临时 SQLite 文件，覆盖真实算法、原始基线、并发版本、取消、重启恢复、不可行结果和重复应用，不产生仓库数据库或改写 `objects/`。2026-10-17 本轮 35 项整理与走线 service/API 回归、后端全量 187 项测试及上述 Ruff 检查通过；走线新增 13 项覆盖实际有效曲线、短线失败、全场占用、过期/取消结果、重启持久化及拒绝误用布局应用接口。前端真实 HTTP 与浏览器证据另见[接入验证](../frontend/docs/api-integration.md#5-验证)，不将这些后端测试计为完整产品或安装支撑验收。

---

## 目录结构

```text
backend/
├── app/
│   ├── adapters/                  # 外部服务适配器
│   │   ├── __init__.py
│   │   ├── rodin_adapter.py       # DeemosTech Hyper3D Rodin API v2 工业级客户端
│   │   └── vlm_adapter.py         # 视觉大模型 2D 目标检测与 3D 桌面物理坐标换算
│   ├── domain/                    # 契约领域模型、共享几何、布局与走线算法
│   ├── service/                   # 场景、基线、后台整理/走线与应用结果编排及能力接口
│   ├── db/                        # SQLite 存储适配器和原子版本事务
│   ├── api/                       # HTTP 解析、路由与统一错误映射
│   ├── bootstrap.py               # 配置、依赖装配与 lifespan 资源生命周期
│   └── main.py                    # ASGI 启动入口
├── scripts/                       # 自动化可执行流水线入口
│   ├── generate_rodin_models.py   # 单品/批量 3D 资产生成与数据契约回填脚本
│   └── run_vlm_perception.py      # 桌面原图感知推理执行脚本
└── requirements.txt               # 后端依赖包
```

---

## 常用执行命令

### 1. 检查 Rodin 账户余额
```bash
python backend/scripts/generate_rodin_models.py --check-balance
```

### 2. 提交切片生成 3D 资产
```bash
# 生成卷尺
python backend/scripts/generate_rodin_models.py --item item_05 --tier basic

# 生成鼠标
python backend/scripts/generate_rodin_models.py --item item_03 --tier basic

# 自定义切片生模
python backend/scripts/generate_rodin_models.py --image tests/crops/crop_item_07_充电器.png --name charger
```

## 独立完整契约工作流

同一应用工厂另提供 `/api/v1/workflow`，包括场景保存、基线、实时整理/走线、比较、照片参照及 Markdown 指南。它与产品后台规划接口分开，避免同名 `/scenes/{id}` 互相覆盖。工作流默认数据库为产品数据库旁 `workflow.sqlite3`，照片位于同级 `workflow-data/photos/`；`DORMTOPOLOGY_WORKFLOW_DB_PATH`、`DORMTOPOLOGY_WORKFLOW_DATA_DIR` 可覆盖。照片识别与实时 Rodin 没有因本次合并而接入。详见[工作流说明](../docs/closed_loop_acceptance.md)与[整合验收](../docs/merge_workflow_prefab_acceptance.md)。
