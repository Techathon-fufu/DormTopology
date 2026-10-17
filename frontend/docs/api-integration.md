# 前后端服务接入

产品工作台的物品整理已接入仓库内 FastAPI 与 Python 领域算法。识别、Rodin、走线和遗留布局端点仍未接入应用服务，真实请求返回 `501`；原有 Mock 演示继续保留。完整场景字段与几何语义以[数据契约](../../docs/data_contract.md)为准，本文只记录实际 HTTP 编排和产品转换。

## 1. 本地运行

从仓库根目录启动后端：

```sh
python3 -m pip install -r backend/requirements.txt
python3 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

在 `frontend/` 启动前端：

```sh
npm install
VITE_ORGANIZATION_API_MODE=real npm run dev
```

打开终端输出的前端地址，进入工作台的「生成整理方案」，核对尺寸与整理前位置并勾选确认。旧版原始快照没有完整场景时，需要重新采集。生成后先预览，接受时后端复查并保存新版本。取消预览保留原布局，已同步的场景与任务记录仍保留。

Vite 将 `/api/v1` 代理到 `http://127.0.0.1:8000`；端口被占用时前端会另选端口。生产部署须配置同源反向代理，或设置后端地址与允许的 CORS origin，后端环境变量见 [backend/README.md](../../backend/README.md)。

| 环境变量 | 用途 |
| --- | --- |
| `VITE_API_MODE` | `mock`（默认）或 `real`，控制所有能力 |
| `VITE_ORGANIZATION_API_MODE` | 单独选择整理的 `mock` 或 `real`；留空跟随全局模式 |
| `VITE_SERVICE_MODE` | 兼容旧值 `mock/service`；`VITE_API_MODE` 优先 |
| `VITE_API_BASE_URL` | 应用后端地址；默认空字符串，走同源 `/api/v1` |
| `VITE_DEV_API_TARGET` | Vite 开发代理目标，默认 `http://127.0.0.1:8000` |
| `VITE_API_TIMEOUT_MS` | 单请求超时，默认 15000 ms；后台任务独立轮询 |

运行时覆盖键为 `dormtopology.api-mode-override`，优先于环境变量。「切换到演示模式」关闭全部真实能力，「恢复真实模式」清除覆盖并恢复环境配置；混合配置显示「真实整理 / 其余演示」，同时启用健康检查与真实任务恢复。真实服务失败不会静默采用 Mock 结果。

## 2. 已实现的整理 API

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/v1/health` | 状态、算法版本、已实现能力列表 |
| `PUT /api/v1/projects/{project_id}/scene` | 保存完整场景，创建或核对正式基线，条件更新版本 |
| `GET /api/v1/projects/{project_id}/scene` | 读取项目当前正式场景 |
| `GET /api/v1/projects/{project_id}/scene-state` | 同次读取 `{scene, baseline_source_id}`，用于安全复查同步中断 |
| `GET /api/v1/scenes/{scene_id}` | 按正式场景 ID 读取 |
| `POST /api/v1/organization/plan` | 提交当前版本的真实布局任务，返回 `202` 与 `job_id` |
| `GET /api/v1/jobs/{job_id}` | 读取状态、结果或失败原因 |
| `POST /api/v1/jobs/{job_id}/cancel` | 取消未终结任务；后台返回不能覆盖取消状态 |
| `POST /api/v1/jobs/{job_id}/apply` | 重新校验并原子应用该任务结果，版本加一，结果只消费一次 |

首次同步：

```jsonc
{
  "scene": { /* 完整契约 Scene */ },
  "expected_revision": null,
  "baseline_source_id": "前端整理前快照 ID",
  "baseline": { /* 用户已核对的完整原始 Scene */ }
}
```

后端分配 `scene_id`、`baseline_id`，初始 `scene_revision=1`。后续同步携带已知 `expected_revision`；相同内容保留版本，变更才加一。新 `baseline_source_id` 必须同时提供完整新基线，旧基线不可改写。保存初始凌乱布局只校验结构与引用，允许碰撞等待整理。

提交和应用请求均为：

```json
{ "scene_id": "scene_...", "scene_revision": 1 }
```

任务状态为 `queued/running/succeeded/failed/cancelled`；结果保留输入场景身份和版本。后端以两个工作线程、最多八个运行及排队任务执行算法，容量满返回 `503`。重启后保留正式场景、基线与已结束任务，未完成任务标为失败并说明原因，用户可重新提交。

应用只接受同一场景当前版本的 `success/partial`，检查完整物品覆盖、固定物品、残留物品、区域、朝向、碰撞、支撑与边界。几何检查在写事务外进行，版本 CAS 和一次消费在 SQLite 同一事务内完成。`infeasible`、重复应用、过期版本均被拒绝。后端不接受前端提交的目标位置替代已保存的算法结果。

错误按 HTTP 返回：`422` 为输入或结构错误，`404` 为资源不存在，`409` 为版本、几何或已消费冲突，`503` 为任务容量耗尽，未实现能力为 `501`。客户端显示具体错误，单次请求超时或网络中断不会标记成功。

## 3. 场景转换与结果接收

`src/api/core/packingWire.ts` 专门转换整理场景，HTTP 集中在 `src/api/http/`。旧 `toWireScenePayload` 仍用于未接入的走线等历史适配器，不是完整算法场景输入。

- 前端原点在桌面中心后墙线，契约原点在桌面左后角地面投影；去程平移 `[desk.width/2, 0, -0.05]`，结果反向平移。局部端口与碰撞部件不平移。
- 导出当前实际桌面、搁板、横梁、地面支撑，及桌体实体障碍。区域按常用区、杯区、收纳偏好限制允许摆放，大型显示器与打印机优先级高于普通物品。
- 所有项目物品均保留，隐藏状态不免除碰撞检查。使用实际凸体部件，保留复合物体的空隙；算法不依赖展示模型就绪。
- 用户勾选确认绑定当前尺寸、位姿和原始快照，修改后需重新确认。`estimated` 的来源保留，不因确认改写为 `user`。
- 本次为布局场景：`cables`、`exposure_zones` 和走线网络为空，端口保持未确认；插排补未确认的总线输入结构。不据此声称接线或三线走线已验收。
- `scene_revision`、基线引用与后端任务 ID 随整理结果保留。前端拒绝身份、版本、覆盖、状态或几何不合法的结果，固定与未放置物品不得被偷偷移动。
- 接受前再次检查当前完整场景，等待后端确认新版本后才写入本地。应用期间锁定取消、手机面板关闭、其它布局写入和重复操作。
- 候选方案及整理前状态恢复也先按当前家具、尺寸、固定及隐藏物品复查，失败不写入项目或撤销历史。

连续桌面面积来自领域 `measure_free_area`，前后采用同一网格口径。物品集合、尺寸、碰撞体或桌面、保留区改变时，原始比较值为 `null`，界面显示未知。无原始线长时不生成走线改善比例。

## 4. 任务与持久化边界

前端 `organizationScenes` 按后端地址和项目保存正式 ID、基线 ID、修订号；同一页面的同项目整理请求互斥。服务端仍以 CAS 防护多页面或并发写入，不能靠浏览器锁代替事务。版本冲突需核对服务端当前场景，不能盲目重试覆盖。

场景保存遇到网络中断、超时或 `409` 时，客户端读取 `scene-state`，仅在基线来源与本次快照完全相同、场景内容与本次提交一致且身份版本合法时恢复；核对包括名称、使用频率、图片、尺寸、位姿、碰撞与布局约束，展示模型和生成状态仍以后端权威值为准。首次保存只能恢复版本 1；已有引用要求场景 ID 不变、同基线 ID、版本原值或加一；重建基线必须加一且基线 ID 改变。复查失败保留原错误和旧引用，稍后可再次核对已提交的保存；用户取消不发起恢复。

应用成功但响应中断时，客户端读取同一任务及正式场景，仅在该任务确已应用、正式版本恰好加一且全部目标几何一致时恢复成功；否则保留错误。网络持续中断可重试接受，后续有新编辑的场景不会被当作原结果恢复。

`remoteJobsStore` 留存最多 30 条任务元数据及摘要。轮询首次 0.8 s、退避至 4 s，连续三次查询失败才报告失败；刷新后每 10 s 及 focus/online 继续查询未终结任务。刷新恢复只更新状态和摘要，不会自动应用历史结果。

前端不配置第三方密钥，识别与模型生成适配器仍只能请求应用后端。Rodin 脚本或适配器存在不等于产品应用已接入真实生成；当前应用服务对识别、模型生成、走线和遗留 `/layout/plan` 明确返回未实现。

## 5. 验证

服务/API 回归：

```sh
python3 -m unittest backend.tests.test_organization_service backend.tests.test_organization_api -v
```

前端构建与转换回归（在 `frontend/`）：

```sh
npm run build
./node_modules/.bin/esbuild scripts/check-organization-backend.ts --bundle --platform=node --format=esm --outfile=/tmp/check-organization-backend.mjs '--define:import.meta.env={}'
node /tmp/check-organization-backend.mjs
./node_modules/.bin/esbuild scripts/check-organization-playback.ts --bundle --platform=node --format=cjs --outfile=/tmp/check-organization-playback.cjs
node /tmp/check-organization-playback.cjs
```

后端启动后，另跑真实 HTTP、同步/应用响应中断恢复与完整 17 件样例：

```sh
./node_modules/.bin/esbuild scripts/check-organization-backend.ts --bundle --platform=node --format=esm --outfile=/tmp/check-organization-backend-http.mjs '--define:import.meta.env={"VITE_API_BASE_URL":"http://127.0.0.1:8000","VITE_ORGANIZATION_API_MODE":"real"}'
node /tmp/check-organization-backend-http.mjs --http
```

启动上述真实前后端后运行浏览器专项（地址按实际端口替换）：

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 PLAYWRIGHT_REAL_ORGANIZATION=1 npm run test:e2e -- tests/organization-backend.spec.ts tests/workspace.spec.ts
```

真实专项使用独立测试项目，验证 Python 整理、原布局保留、正式版本应用、固定物品保持与过期结果拒绝。普通 `test:e2e` 默认跳过依赖真实后端的专项；独立 `/algorithm-lab` 继续读取离线领域结果，不用它替代产品 API 验收。

2026-10-17 验证：领域 144 项、整理 service/API 22 项、旧入口兼容 1 项通过；构建、5 个前端转换/状态脚本及新增后端 Ruff 通过。浏览器分轮通过算法工作台 76 项、工作台与真实整理专项 8 项，已复核桌面和模拟手机截图及非空 Canvas。真实 HTTP 故障注入通过 16 个场景同步恢复/拒绝案例，并保留应用响应中断恢复检查。未执行实体手机、真实走线及 Rodin 的完整流程验收。
