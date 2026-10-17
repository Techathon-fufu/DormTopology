# 前后端服务接入

产品工作台的整理与理线固定请求仓库内 FastAPI 与 Python 领域算法，遗留布局也固定走 HTTP；网页已移除本地规则规划模式及切换入口。识别与 Rodin 默认保留明确标记的模拟数据，可在构建时选择真实请求；它们及遗留布局端点尚未接入应用服务，真实请求返回 `501`。指南在前端按当前有效场景生成。完整场景字段与几何语义以[数据契约](../../docs/data_contract.md)为准，本文只记录实际 HTTP 编排和产品转换。

## 1. 本地运行

从仓库根目录启动后端：

```sh
python3 -m pip install -r backend/requirements.txt
python3 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

在 `frontend/` 启动前端：

```sh
npm install
VITE_API_MODE=mock npm run dev
```

打开终端输出的前端地址，进入工作台的「生成整理方案」，核对尺寸与整理前位置并勾选确认。旧版原始快照没有完整场景时，需要重新采集。生成后先预览，接受时后端复查并保存新版本。取消预览保留原布局，已同步的场景与任务记录仍保留。

进入「规划走线」后，核对当前尺寸和位置、逐个确认所引用的接口，再确认并规划。无需输入实际线长；算法返回路径长度，属性面板与指南展示含预留的所需备线长度。未知现有线长传 `length_m: null`，不伪造可用线长；已有数据提供实际线长时仍校验是否足够。连接和通道无解时显示具体失败原因，示例项目不保证所有线路都可行。整理与理线始终需要可用后端。

Vite 将 `/api/v1` 代理到 `http://127.0.0.1:8000`；端口被占用时前端会另选端口。生产部署须配置同源反向代理，或设置后端地址与允许的 CORS origin，后端环境变量见 [backend/README.md](../../backend/README.md)。

| 环境变量 | 用途 |
| --- | --- |
| `VITE_API_MODE` | `mock`（默认）或 `real`，仅控制识别与模型生成，不影响规划 |
| `VITE_ORGANIZATION_API_MODE`、`VITE_CABLE_API_MODE` | 旧规划模式变量，当前代码忽略 |
| `VITE_SERVICE_MODE` | 兼容旧值 `mock/service`；`VITE_API_MODE` 优先 |
| `VITE_API_BASE_URL` | 应用后端地址；默认空字符串，走同源 `/api/v1` |
| `VITE_DEV_API_TARGET` | Vite 开发代理目标，默认 `http://127.0.0.1:8000` |
| `VITE_API_TIMEOUT_MS` | 单请求超时，默认 15000 ms；后台任务独立轮询 |

当前代码不读取旧 `dormtopology.api-mode-override`，即使浏览器留有 `mock` 覆盖也不会启用本地规则规划，无需清空用户项目。网页没有「切换到演示模式」或「恢复真实模式」入口；状态栏分别标记「后端整理 / 理线」与启用时的「识别 / 模型模拟」。健康检查与真实任务恢复始终启用，后端失败显示实际原因。`VITE_*` 配置在构建时生效，改变识别或模型生成模式须重新构建。

## 2. 已实现的场景与任务 API

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/v1/health` | 状态、算法版本、已实现能力列表 |
| `PUT /api/v1/projects/{project_id}/scene` | 保存完整场景，创建或核对正式基线，条件更新版本 |
| `GET /api/v1/projects/{project_id}/scene` | 读取项目当前正式场景 |
| `GET /api/v1/projects/{project_id}/scene-state` | 同次读取 `{scene, baseline_source_id}`，用于安全复查同步中断 |
| `GET /api/v1/scenes/{scene_id}` | 按正式场景 ID 读取 |
| `POST /api/v1/organization/plan` | 提交当前版本的真实布局任务，返回 `202` 与 `job_id` |
| `POST /api/v1/cables/plan` | 提交当前版本的真实走线任务，返回 `202` 与 `job_id`；全量复查当前场景线缆 |
| `GET /api/v1/jobs/{job_id}` | 读取状态、结果或失败原因 |
| `POST /api/v1/jobs/{job_id}/cancel` | 取消未终结任务；后台返回不能覆盖取消状态 |
| `POST /api/v1/jobs/{job_id}/apply` | 仅整理任务：重新校验并原子应用，版本加一，结果只消费一次；走线任务不能用于此操作 |

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

场景同步遇到 `409` 时先读取 `scene-state`，保持后端版本条件更新：已知场景在当前后端明确不存在时，携带完整基线以 `expected_revision: null` 最多重建一次；已有内容、约束及基线来源完全一致时只读重新绑定，允许恢复已应用后的较高版本。来源或内容不同则提示冲突，并在整理面板提供「创建独立副本」：复制当前本地场景到新项目、重新采集快照并要求再次确认，保留原项目及后端场景。跨标签页读取最新引用，存储不可写时保留会话缓存；不读取最新版本后无条件覆盖，也不要求清空数据库或浏览器数据。

提交和应用请求均为：

```json
{ "scene_id": "scene_...", "scene_revision": 1 }
```

任务状态为 `queued/running/succeeded/failed/cancelled`；结果保留输入场景身份和版本。后端以两个工作线程、最多八个运行及排队任务执行算法，容量满返回 `503`。重启后保留正式场景、基线与已结束任务，未完成任务标为失败并说明原因，用户可重新提交。

应用只接受同一场景当前版本的 `success/partial`，检查完整物品覆盖、固定物品、残留物品、区域、朝向、碰撞、支撑与边界。几何检查在写事务外进行，版本 CAS 和一次消费在 SQLite 同一事务内完成。`infeasible`、重复应用、过期版本均被拒绝。后端不接受前端提交的目标位置替代已保存的算法结果。

错误按 HTTP 返回：`422` 为输入或结构错误，`404` 为资源不存在，`409` 为版本、几何或已消费冲突，`503` 为任务容量耗尽，未实现能力为 `501`。客户端显示具体错误，单次请求超时或网络中断不会标记成功。

### 走线任务

前端先使用相同的场景同步入口提交完整当前场景，再调用：

```json
{
  "scene_id": "scene_...",
  "scene_revision": 2,
  "target_ids": ["cable_monitor_power"]
}
```

`target_ids` 可省略；提供时必须为非空、不重复的现有线缆 ID 列表。单线更新仍执行全量规划，返回场景内全部线路，用于共同检查接口容量与线间碰撞，不会把一条新路径与未经复查的旧路径拼成有效结果。任务沿用 `queued/running/succeeded/failed/cancelled` 和共享任务容量；`succeeded` 表示计算结束，几何结果仍可能为 `partial` 或 `infeasible`。

结果为数据契约的 `cable_routing.json`，算法版本为 `routing-1.0`。有效线缆必须有真实接口端点、连续曲线、采样点和正的积分长度；仅在实际线长已知时检查含预留长度不超过它。失败线缆的 `path_points`、`curve_segments` 为 `[]`，`path_length_m` 为 `null`，并有明确 `reason_code`。任务结果保留在后端任务记录中，工作台只显示当前版本匹配的结果，不调用整理的 `/apply`。

产品尚未导出已安装支撑及其确认信息，当前 `support_check.status` 为 `not_evaluated`。几何验证通过不能解释为贴面固定、扎带、线夹或集线槽安装已经可行；配件建议也不能充当已安装事实。原始线缆未提供实测路径时，原始暴露线长与改善比例保持未知。

## 3. 场景转换与结果接收

`src/api/core/packingWire.ts` 转换整理场景，`routingWire.ts` 在其基础上转换真实走线场景，HTTP 集中在 `src/api/http/`。旧 `toWireScenePayload` 只保留未接入的历史适配器用途，不用于真实领域走线。

- `dormdesk-v1` 使用真实 L 形支撑与 75 个保守家具碰撞盒，前端到 API 平移 `[0.45,0,-0.042]`；历史参数化项目保留 `[desk.width/2,0,-0.05]`。结果反向平移，局部端口与碰撞部件不平移。`template_id` 记录家具版本，旧快照不按新家具解释。源资产共同变换、抽屉内腔及开孔见[桌体说明](desk-model.md)。
- 导出当前实际桌面、搁板、横梁、地面支撑，及桌体实体障碍。区域按常用区、杯区、收纳偏好限制允许摆放，大型显示器与打印机优先级高于普通物品。
- 主机允许桌下地面；非高频收纳容器须显式选择桌下收纳才允许落地。普通物品、书本及插排不使用裸地面作为收纳兜底，插排可放横梁或桌面；固定和未安放物品仍按真实原支撑复查。
- 收纳偏好以 `preferred_region_ids` 无序组提交，后端 `packing-1.1` 在几何可行时优先满足，再优化桌面面积；偏好不可行时只在允许区域内回退。保存、响应中断恢复与版本核对均包含该字段。
- 所有项目物品均保留，隐藏状态不免除碰撞检查。使用实际凸体部件，保留复合物体的空隙；算法不依赖展示模型就绪。
- 用户勾选确认绑定当前尺寸、位姿和原始快照，修改后需重新确认。`estimated` 的来源保留，不因确认改写为 `user`。
- 本次为布局场景：`cables`、`exposure_zones` 和走线网络为空，端口保持未确认；插排补未确认的总线输入结构。不据此声称接线或三线走线已验收。
- `scene_revision`、基线引用与后端任务 ID 随整理结果保留。前端拒绝身份、版本、覆盖、状态或几何不合法的结果，固定与未放置物品不得被偷偷移动。
- 接受前再次检查当前完整场景，等待后端确认新版本后才写入本地。应用期间锁定取消、手机面板关闭、其它布局写入和重复操作。
- 候选方案及整理前状态恢复也先按当前家具、尺寸、固定及隐藏物品复查，失败不写入项目或撤销历史。

连续桌面面积来自领域 `measure_free_area`，前后采用同一网格口径。物品集合、尺寸、碰撞体或桌面、保留区改变时，原始比较值为 `null`，界面显示未知。无原始线长时不生成走线改善比例。

走线转换保留全部物品与障碍，并生成穿线孔和背板后通道。所引用接口必须独立确认、容量为 1；USB-A/C 对应契约 USB，AC/DC 按供电与受电端映射。实际线长未知时为 `null`，已知时必须为有限正数，预留为有限非负数；粗/细线使用前端记录的线径与最小弯曲半径预设。自连、重复、无线实体连接、类型不兼容和端口占用均有失败反馈。

真实路径以 `smooth: false` 保存后端采样点和 `route.pathLengthM` 积分长度。工作台、方案对比及交付页直接沿这些点绘制，不再另拟合曲线；失败和过期路径不能作为建议接线动画或执行步骤。任意线路尚无有效路径时，完整走线总长显示未知。手动改变路径或参数会清除旧验证数据，需重新规划。

## 4. 任务与持久化边界

前端 `organizationScenes` 按后端地址和项目保存正式 ID、基线 ID、修订号；同一页面的同项目整理与走线请求共用互斥入口。服务端仍以 CAS 防护多页面或并发写入，不能靠浏览器锁代替事务。版本冲突需核对服务端当前场景，不能盲目重试覆盖。

物品、障碍、房间或偏好变化，以及连接增删、线径、策略、实际线长、预留或路径编辑，都会使旧走线失效并清除旧验证信息；撤销、重做及恢复历史方案也需重新验证。重新采集基线会清除旧认证及撤销历史，真实整理同步前也会使旧认证失效。平移和旋转保留物品局部接口确认，修改尺寸、接口类型、位置或朝向则要求重新确认。客户端草稿在下次同步时由后端按内容更新正式版本；走线返回后再次核对正式场景、版本与完整输入签名，期间的新编辑不会被旧结果覆盖。

场景保存遇到网络中断、超时或 `409` 时，客户端读取 `scene-state`，仅在基线来源与本次快照完全相同、场景内容与本次提交一致且身份版本合法时恢复；核对包括名称、使用频率、图片、尺寸、位姿、碰撞与布局约束，展示模型和生成状态仍以后端权威值为准。首次保存只能恢复版本 1；已有引用要求场景 ID 不变、同基线 ID、版本原值或加一；重建基线必须加一且基线 ID 改变。复查失败保留原错误和旧引用，稍后可再次核对已提交的保存；用户取消不发起恢复。

应用成功但响应中断时，客户端读取同一任务及正式场景，仅在该任务确已应用、正式版本恰好加一且全部目标几何一致时恢复成功；否则保留错误。网络持续中断可重试接受，后续有新编辑的场景不会被当作原结果恢复。

`remoteJobsStore` 留存最多 30 条任务元数据及摘要。轮询首次 0.8 s、退避至 4 s，连续三次查询失败才报告失败；刷新后每 10 s 及 focus/online 继续查询未终结任务。刷新恢复只更新状态和摘要，不会自动应用历史结果。

前端不配置第三方密钥；识别与模型生成在 `VITE_API_MODE=real` 时只能请求应用后端，在 `mock` 时使用明确标记的模拟结果。Rodin 脚本或适配器存在不等于产品应用已接入真实生成；当前应用服务对识别、模型生成和遗留 `/layout/plan` 明确返回未实现，规划服务注册不会改用本地替代结果。

## 5. 验证

服务/API 回归：

```sh
python3 -m unittest backend.tests.test_organization_service backend.tests.test_organization_api -v
python3 -m unittest backend.tests.test_routing_service backend.tests.test_routing_api -v
```

前端构建与转换回归（在 `frontend/`）：

```sh
npm run build
./node_modules/.bin/esbuild scripts/check-backend-only-planning.ts --bundle --platform=node --format=esm --outfile=/tmp/check-backend-only-planning.mjs
node /tmp/check-backend-only-planning.mjs
./node_modules/.bin/esbuild scripts/check-organization-backend.ts --bundle --platform=node --format=esm --outfile=/tmp/check-organization-backend.mjs '--define:import.meta.env={}'
node /tmp/check-organization-backend.mjs
./node_modules/.bin/esbuild scripts/check-monitor-backend.ts --bundle --platform=node --format=esm --outfile=/tmp/check-monitor-backend.mjs '--define:import.meta.env={}'
node /tmp/check-monitor-backend.mjs
./node_modules/.bin/esbuild scripts/check-organization-playback.ts --bundle --platform=node --format=cjs --outfile=/tmp/check-organization-playback.cjs
node /tmp/check-organization-playback.cjs
./node_modules/.bin/esbuild scripts/check-floor-placement.ts --bundle --platform=node --format=cjs --outfile=/tmp/check-floor-placement.cjs
node /tmp/check-floor-placement.cjs
./node_modules/.bin/esbuild scripts/check-scene-sync.ts --bundle --platform=node --format=esm --outfile=/tmp/check-scene-sync.mjs '--define:import.meta.env={}'
node /tmp/check-scene-sync.mjs
node /tmp/check-organization-backend.mjs --plan-demo
./node_modules/.bin/esbuild scripts/check-cable-validation.ts --bundle --platform=node --format=esm --outfile=/tmp/check-cable-validation.mjs
node /tmp/check-cable-validation.mjs
./node_modules/.bin/esbuild scripts/check-cable-geometry.ts --bundle --platform=node --format=esm --outfile=/tmp/check-cable-geometry.mjs
node /tmp/check-cable-geometry.mjs
./node_modules/.bin/esbuild scripts/check-monitor-layout.ts --bundle --platform=node --format=esm --outfile=/tmp/check-monitor-layout.mjs
node /tmp/check-monitor-layout.mjs
./node_modules/.bin/esbuild scripts/check-monitor-backend.ts --bundle --platform=node --format=esm --outfile=/tmp/check-monitor-backend.mjs '--define:import.meta.env={}'
node /tmp/check-monitor-backend.mjs
```

后端启动后，另跑真实 HTTP、同步/应用响应中断恢复与完整 17 件样例：

```sh
./node_modules/.bin/esbuild scripts/check-organization-backend.ts --bundle --platform=node --format=esm --outfile=/tmp/check-organization-backend-http.mjs '--define:import.meta.env={"VITE_API_BASE_URL":"http://127.0.0.1:8000"}'
node /tmp/check-organization-backend-http.mjs --http
./node_modules/.bin/esbuild scripts/check-monitor-backend.ts --bundle --platform=node --format=esm --outfile=/tmp/check-monitor-backend-http.mjs '--define:import.meta.env={"VITE_API_BASE_URL":"http://127.0.0.1:8000"}'
node /tmp/check-monitor-backend-http.mjs --http
```

启动上述真实前后端后运行浏览器专项（地址按实际端口替换）：

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 PLAYWRIGHT_REAL_ORGANIZATION=1 npm run test:e2e -- tests/backend-only-planning.spec.ts tests/organization-backend.spec.ts tests/scene-sync.spec.ts tests/workspace.spec.ts --workers=1
```

真实专项使用独立测试项目，验证 Python 整理、原布局保留、正式版本应用、固定物品保持与过期结果拒绝。普通 `test:e2e` 默认跳过依赖真实后端的专项；独立 `/algorithm-lab` 继续读取离线领域结果，不用它替代产品 API 验收。

并行运行多组 Playwright 时，为每组指定不同的 `--output=/tmp/<独立目录>`，避免共用默认输出目录导致追踪文件被清理。这些产品专项会导入开发服务的状态模块，应使用 `npm run dev`，构建预览另做页面检查。

落地策略专项包含完整 17 件演示项目的真实 Python 预览与原子应用，检查普通物品不落地及默认收纳盒归入书架；`--plan-demo` 另核对显式桌下收纳及最终几何。`check-floor-placement` 验证本地演示的所有偏好、无书架满桌、主机与容器资格、插排支撑、真实容器内收纳、固定和未安放残留物品。

设备摆放专项 `check-monitor-backend` 检查显示器与键鼠区中线对齐、正向摆放和打印机侧部取用位置，也检查固定/锁定物品、中央被挡、偏移越界、原位保留、侧区不足及最终设备相互遮挡。`--http` 另以独立项目验证旧普通桌面约束升级为主视位/侧部约束时保留基线标识，正确递增版本并完成真实规划和原子应用。

2026-10-17 移除规划演示模式：类型检查、构建、后端 service/API 35 项、真实理线 HTTP、11 组服务装配配置及旧规则路径拒绝回归通过。开发服务上桌面/模拟手机的模式移除专项 4 项、历史路径待重算及原数据保留专项 2 项、真实整理与同步专项 10 项通过；更新后的 `5177` 构建预览另完成两种视口的模式入口、确认门槛、三个视角非空 Canvas、脚本/资产加载与横向溢出检查。当前部署保留原数据库，健康能力包含整理和理线；证据与范围见[本地部署](../../docs/local_deployment.md#4-当前版本验证)。以下为此前交付记录。

此前 `check-cable-validation` 与 `check-cable-geometry` 已通过，覆盖连接兼容与占用、线长与预留、线径扫掠及局部弯曲、全场景失效和重新确认、301 个采样点逐点保留、验证积分长度、失败总长未知与执行步骤过滤。`npm run typecheck` 和整理播放、碰撞体、持久化迁移脚本通过；这些结果不计为完整浏览器流程、实体手机或实际安装支撑验收。

真实理线接入另通过 187 项后端测试、前端构建及真实 HTTP 成功/短线/版本变更/锁/同步恢复回归。浏览器实测范围和桌面、手机模拟视口记录见[前端验证记录](../README.md#验证记录)，综合演示的接口受阻不计为三线成功验收。
设备专项验证完整 17 件场景的显示器中央主视位与打印机侧部位置、键鼠区偏移、原侧向屏幕、固定和锁定姿态，以及中央受阻后的合法回退与明确提示。真实专项同时调用 Python 规划和最终几何复查，再经前端结果转换，检查应用目标变换不改变正式区域及约束；浏览器完整演示检查居中、侧放与朝向在正式应用和持久化回读后保持一致。Mock 另检查物品顺序、全桌阻挡与残留物品、非对称碰撞偏移，打印机无合法侧位时不回退到屏幕后方。

2026-10-17 验证：领域 144 项、整理 service/API 22 项、旧入口兼容 1 项通过；构建、5 个前端转换/状态脚本及新增后端 Ruff 通过。浏览器分轮通过算法工作台 76 项、工作台与真实整理专项 8 项，已复核桌面和模拟手机截图及非空 Canvas。真实 HTTP 故障注入通过 16 个场景同步恢复/拒绝案例，并保留应用响应中断恢复检查。未执行实体手机、真实走线及 Rodin 的完整流程验收。

同日落地策略修复：后端 174 项通过，含新增区域偏好 8 项；完整 17 件 Python 样例在书架与桌下收纳两种偏好下均成功且最终几何有效。转换、落地专项、播放回归、构建通过；真实 HTTP 同步恢复/拒绝增至 17 案例，完整演示应用成功。浏览器专项共 10 项，其中 8 项首轮通过，2 项因同时执行大型场景而排队超过测试时限，待任务结束后串行复测通过；已复核桌面及模拟手机的完整演示应用截图。

## 工作流与模型分支整合（2026-10-17）

同一个后端提供产品整理/走线 `/api/v1` 与独立工作流 `/api/v1/workflow`。产品展示采用桌身与三只独立抽屉、12 个预制单品 GLB，模型和碰撞随编辑尺寸同步缩放；真实家具支撑与碰撞沿用最新 main。组合后的 17 件真实物品布局目前返回不可行，仍需调整收纳约束和示例摆放。独立 8 件场景的完整算法工作流单独验收；真实识别、实时 Rodin、抽屉内部物品联动和真机仍待完成。详见[整合验收](../../docs/merge_workflow_prefab_acceptance.md)。
