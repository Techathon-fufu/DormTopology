# 本地实例部署

先按下节启动当前工作区，物品整理和理线固定使用后端。后半部分保留固定提交 `6784dbc`（`fix/scene-sync-recovery`）的旧版独立实例及验证记录；旧版包含规划演示模式，不能用旧启动步骤验证本次删除模式的修改。

前端使用构建产物，通过 Vite preview 的同源代理访问后端。服务只监听 `127.0.0.1`；Vite preview 用于本机预览，公网长期部署需另行配置静态服务、反向代理及访问控制。

## 当前工作区启动

当前代码源为 `/Users/qdd09/Projects/DormTopology`。以下命令使用当前工作区中的前后端代码，部署前以 `git status` 核对分支和修改。Python 虚拟环境和数据库复用前次独立实例的运行目录 `/private/tmp/dorm-monitor-placement/.work/local-demo-20261017`；保留原 `organization.sqlite3`，不删库、不清除用户项目。

当前工作区已保存前序修复为 `24dc7f2`，并通过 `678f78f` 合并远端 main 的家具更新。固定示例采用拆分家具 `dormdesk-v1`，桌面包络 1.45×0.86m，实际支撑为 L 形；布局与走线适配提交真实桌板、书架、抽屉和碰撞体。设备策略由前端场景适配提交给后端，不能仅凭 `packing-1.1` 版本判定部署正确。部署前运行下述专项，并在真实浏览器检查完整 17 件场景的显示器居中、朝向和打印机侧置。

### 1. 准备与构建

需要 Python 3.11+、Node.js 20+ 和 npm。先核对 `8003`、`5177` 上的既有进程，检查进程命令及工作目录，确认属于待替换的本项目实例后停止。旧服务即便健康，也不能代替当前工作区的后端。

```bash
lsof -nP -iTCP:8003 -iTCP:5177 -sTCP:LISTEN
cd /Users/qdd09/Projects/DormTopology
git status --short --branch
export DORM_DEPLOY_DATA=/private/tmp/dorm-monitor-placement/.work/local-demo-20261017
export DORM_DEPLOY_PYTHON="$DORM_DEPLOY_DATA/venv/bin/python"
"$DORM_DEPLOY_PYTHON" -m pip install -r backend/requirements.txt
cd frontend
npm ci
./node_modules/.bin/esbuild scripts/generate-furniture-geometry.ts --bundle --platform=node --format=esm --outfile=/tmp/dorm-deploy-furniture.mjs
node /tmp/dorm-deploy-furniture.mjs
VITE_API_MODE=mock VITE_API_BASE_URL='' VITE_DEV_API_TARGET=http://127.0.0.1:8003 npm run build
./node_modules/.bin/esbuild scripts/check-fixed-furniture.ts --bundle --platform=node --format=esm --outfile=/tmp/dorm-deploy-fixed.mjs '--define:import.meta.env={}'
node /tmp/dorm-deploy-fixed.mjs
./node_modules/.bin/esbuild scripts/check-monitor-backend.ts --bundle --platform=node --format=esm --outfile=/tmp/dorm-deploy-monitor.mjs '--define:import.meta.env={}'
node /tmp/dorm-deploy-monitor.mjs
./node_modules/.bin/esbuild scripts/check-demo-routing.ts --bundle --platform=node --format=esm --outfile=/tmp/dorm-deploy-routing.mjs '--define:import.meta.env={}'
node /tmp/dorm-deploy-routing.mjs
./node_modules/.bin/esbuild scripts/check-cable-management.ts --bundle --platform=node --format=esm --outfile=/tmp/dorm-deploy-management.mjs '--define:import.meta.env={}'
node /tmp/dorm-deploy-management.mjs
```

本机已建立上述虚拟环境；若该临时目录被系统清理，应先以 `python3 -m venv "$DORM_DEPLOY_DATA/venv"` 重建环境，再安装依赖，并从备份恢复所需数据库。`VITE_API_MODE=mock` 仅为识别和模型生成保留明确标记的模拟数据；整理、理线和遗留布局始终走 HTTP。真实识别、Rodin 及遗留布局应用端点尚未实现，选择或调用时返回 HTTP 501。

不再设置 `VITE_ORGANIZATION_API_MODE` 或 `VITE_CABLE_API_MODE`，当前代码忽略它们；旧浏览器键 `dormtopology.api-mode-override` 也不再生效。模式和 API 地址是构建时配置，修改后重新构建。

### 2. 终端 A：启动当前后端

```bash
cd /Users/qdd09/Projects/DormTopology
export DORM_DEPLOY_DATA=/private/tmp/dorm-monitor-placement/.work/local-demo-20261017
DORMTOPOLOGY_DB_PATH="$DORM_DEPLOY_DATA/organization.sqlite3" "$DORM_DEPLOY_DATA/venv/bin/python" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8003
```

运行单个 Uvicorn 进程，不加 `--workers` 或 `--reload`。代码从当前仓库根目录导入；复用的虚拟环境只提供依赖。环境变量由进程读取，不会自动加载后端 `.env`。

### 3. 终端 B：预览当前前端构建

```bash
cd /Users/qdd09/Projects/DormTopology/frontend
VITE_DEV_API_TARGET=http://127.0.0.1:8003 npm run preview -- --host 127.0.0.1 --port 5177 --strictPort
```

Vite preview 继承 `vite.config.ts` 的代理；空 `VITE_API_BASE_URL` 使 `/api/v1` 同源转发到 `8003`，无需扩大 CORS。前端地址为 <http://127.0.0.1:5177/>，示例工作台为 <http://127.0.0.1:5177/projects/demo-dorm-101/workspace>，后端文档为 <http://127.0.0.1:8003/docs>。两终端保持前台运行，分别按 `Ctrl+C` 并等待退出后停止；重新启动仍使用同一个数据库文件。

本轮实际实例由当前工作区 `.work/backend-only/launch.mjs` 在后台启动，参数等同上述命令；该启动器属于本机临时文件，重新部署可直接使用前台命令。日志为 `.work/backend-only/backend.log`、`frontend.log`，PID 文件为同目录 `backend.pid`、`frontend.pid`。停止后台实例时，以 `lsof` 查询的当前监听进程为准，再用 `ps -p <PID> -o pid,command` 和 `lsof -a -p <PID> -d cwd` 核对命令及目录，确认后执行 `kill -TERM <PID>`；不要仅凭旧 PID 文件终止进程。

### 4. 当前版本验证

2026-10-18 物品最小净距版本：产品整理默认 `constraints.min_item_gap_m: 0.02`，按真实部件水平距离检查，并保护穿线孔上方空间。后端 225 项及兼容 1 项通过，包含 20 项净距边界与延长接口引出避开已有线缆的回归；真实默认 17 件布局与 7/7 走线脚本、前端转换/间距/候选恢复/播放/同步检查、类型检查和生产构建通过。本轮修改文件的 Ruff 通过；全仓 Ruff 尚有 79 项既有问题，位于未改动的供应商适配器、几何模块和离线脚本。生产构建保留 Three.js 大产物提示。

`5177` 最终构建的桌面/模拟手机三视角检查通过：Canvas 非空，资产加载正常，无脚本错误或横向溢出，截图位于 `.work/backend-only/preview-*.png`。已有项目须刷新后重新生成并接受整理，原始位置及基线不自动改变；低间距旧候选不能恢复为有效新布局。

最终单套精确锚点版本在本机独立测量时，17 件整理约 29.94 秒，物品 ID 完整、几何有效。桌面浏览器完成真实整理、接受及七线规划，核对实际净距至少 20mm、7/7 有效、正式版本 `1→2→3`，应用后场景与后端保存一致；截图与报告位于 `/private/tmp/dorm-item-spacing-final-efficient-seven-results`。所有写入回归使用独立 QA 数据库；用户数据库 6 份原始基线重启前后 SHA256 均为 `256e42bb2493511f7c42686c7c1e81b6f8a192bcad1a48c63cd3ef30f42bc862`，未完成任务数为 0。耗时属于本机测量，不是服务时限或性能承诺。

最终浏览器共 3 项通过，保持原测试超时：上述桌面完整流程，以及桌面/模拟手机的真实设备布局两例，确认显示器居中、打印机侧置、普通物品不落地。两种视口的应用截图位于 `/private/tmp/dorm-item-spacing-final-efficient-organization-results`，已复核场景非空及控件无重叠；近景相机仍可能裁切右侧设备。临时 QA `5178` / `8004` 已停止，交付实例 `5177` / `8003` 保持运行。此轮仍不计为实体手机、实物安装、含插排总线的首版三线或真实供应商验收。

以下为前一轮的验证与数据库记录，不能替代上述最小净距版本的复测：

2026-10-17 桌后缘与配件版本：后端 204 项、类型检查、生产构建、真实 HTTP 及转换/几何/指南/持久化回归通过。上方 `check-demo-routing.ts` 使用真实默认 17 件物品及 7 根兼容线，原始碰撞布局如实返回部分失败；整理后全部物品几何有效、接口引出无遮挡、7/7 走线有效。浏览器共 107 项通过、1 项跳过：桌面完成整理、原子应用、接口确认及七线规划，正式版本按 `1→2→3` 递增并与后端保存一致；配件添加、安装确认、删除、撤销/重做、持久化、实际三维显示、真实集线槽分析与编辑失效覆盖桌面和模拟手机。完整默认七线流程仅在桌面运行，手机同例跳过；实体安装、含插排总线的首版三线及真实供应商验收仍待完成。

当前 `5177` 生产预览与 `8003` 后端已刷新，临时 QA `5178` / `8004` 已停止。桌面/模拟手机三个视角的 Canvas 像素、资源加载、脚本错误和横向溢出通过，截图已复核。所有写入回归均使用独立 QA 数据库；用户数据库重启前后 5 份原始基线内容 SHA256 均为 `c771108ba0fbcf9ecff1c045460d2058d16bc112b7cfc3aa0553144442244d39`，未完成任务数为 0。默认七线与配件截图位于 `/private/tmp/dorm-cable-management-final-results`，生产预览证据位于 `.work/backend-only/preview-*.png` 与 `preview-results.json`。这些证据是本机生成文件，不随代码提交。

```bash
curl --fail --silent --show-error http://127.0.0.1:8003/api/v1/health
curl --fail --silent --show-error http://127.0.0.1:5177/api/v1/health
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:5177/projects/demo-dorm-101/workspace
```

健康检查应返回 `status: "ok"`，能力包含 `organization` 和 `cable`；缺少 `cable` 表示仍在使用旧后端。浏览器状态应标记「后端整理 / 理线」以及默认启用的「识别 / 模型模拟」，不出现规划模式切换入口。核对尺寸与原始位置后生成整理方案并接受，再确认接口后提交理线，无需输入实际线长；成功后检查所需线长包含路径与预留，未知现有线长按 `null` 保存。规划失败应显示后端原因，不能返回规则演示结果。既有示例不保证所有线缆都能成功。

以下为合并家具时的较早验证记录：后端 192 项、真实 17 件布局与前端结果复查、四份 GLB 的 75 个部件边界、抽屉内腔/柜壳/开孔、基础真实走线与 HTTP 通过；类型检查、生产构建和 Ruff 通过。完整桌面/模拟手机浏览器 104 项通过，初始机位避开梯子后补测工作台 8 项通过。旧存储恢复覆盖示例归档和用户几何保留；当次重启前后 4 份基线 SHA256 为 `4c55c1cb829cf2ddc86a90a193523a2994c034358e1a702f47198a4067fee3e7`。证据位于 `/private/tmp/furniture-browser-final` 与 `/private/tmp/furniture-camera-final`，不替代本轮七线和配件结果。

数据库复用不代表浏览器状态清空。`5177` 上已有用户项目、后端引用、照片和模型仍按原存储规则保留；升级第 4 版示例时将旧示例归档为「旧家具保留」项目，旧基线与历史快照不重写。干净验证使用全新浏览器上下文及独立测试项目。建立另一个完全独立实例时选择新数据目录和端口，不删除当前数据库或旧 `5174` 数据。

更新设备策略后，刷新页面并重新生成整理方案，接受后才改变物品位置；已有项目不会被自动搬动。旧规则场景携正确版本同步时保留原始基线，更新当前约束并递增版本；引用缺失且内容不同仍显示冲突及创建独立副本入口，不跳过版本检查。

桌后缘与配件版本不要求重置用户项目。未确认且未修改的旧默认接口会迁移到真实实体表面；已确认接口保留，位置不贴合实体时需重新取点并确认。默认笔记本和手机连接适配器的独立 USB 输出，新增适配器 AC 线走桌后策略；既有用户 AC 策略不覆盖。理线配件位于走线列表，可添加、确认安装或删除；支撑跨距检查默认关闭，待安装集线槽只是规划后的汇聚候选。修改布局、接口或配件后须重新确认并规划，旧结果失效。

2026-10-17 本轮验证：`npm run typecheck` 和生产构建通过；后端整理、理线 service/API 共 35 项通过，真实理线 HTTP 回归通过；服务装配的 11 组配置及旧规则路径无效化回归通过。`5178` 独立测试实例的桌面/模拟手机 Chromium 共 16 项通过，覆盖确认门槛、旧模式偏好、503 保留原场景与恢复、真实整理应用、过期拒绝及场景同步；历史规则路径显示待重算、不计入已规划数量且保留原数据。并行测试曾发生输出目录清理冲突，使用各自输出目录重跑全部通过。

当前 `5177` 构建预览和 `8003` 后端已更新，保留原 SQLite 数据库；直接健康检查与前端代理均返回 `organization`、`cable`。构建页面的桌面/模拟手机检查通过：旧 `mock` 偏好不能恢复规则入口，未确认时不能生成整理方案，透视/俯视/正视 Canvas 均非空，无脚本错误、资产请求失败或横向溢出，截图已复核。预览证据位于 `.work/backend-only/preview-results.json` 与 `preview-*.png`；未执行真实供应商、实体手机或完整三线成功验收。下列记录保留为历史证据。

同日补入设备布局修复后，生产构建、整理转换、设备布局 Python 专项及真实理线 HTTP 再次通过。桌面/模拟手机共 16 项浏览器回归通过，完整 17 件场景核对显示器与键鼠区中线对齐且正向、打印机位于侧部、全部应用后姿态与服务端保存一致，截图位于 `/private/tmp/dorm-monitor-restored-e2e`。独立 QA 数据库中，旧规则项目真实同步及应用按版本 `1→2→3` 完成，原始基线 ID、来源和内容 SHA256 保持不变。`5177` 构建预览的两种视口与三个视角复查通过，用户数据库未用于这些写入测试。

当前工作区同日另完成走线线长输入移除：后端 191 项、生产构建、真实 HTTP、几何与指南回归、桌面/模拟手机工作台和同步 12 项、算法工作台契约 4 项通过；`5177` 构建与 `8003` 后端已更新。未知现有线长保存为 `null`，有效路径显示含预留的所需长度，已有短线仍返回失败。重启前后 3 个原始基线的内容指纹一致；不将未知现有线长当作已验证足够。

## 历史：固定提交 `6784dbc` 的独立实例

以下仅用于复现删除规划模式之前的版本，勿与上方当前工作区启动命令混用。该实例曾使用独立代码目录、Python 虚拟环境、SQLite 文件和前端 origin。

### 1. 能力与环境

- Python 3.11+、Node.js 20+、npm、Git；首次安装需要访问依赖仓库。
- 真实能力：场景与不可变基线保存、版本检查、Python 物品整理、预览和后端原子应用。
- 演示能力：识别、Rodin、产品走线和指南；本实例不调用真实供应商。走线领域算法的离线展示仍可在 `/algorithm-lab` 查看。不能把演示结果视为真实走线或资产生成验收。
- 后端固定 `8003`，前端固定 `5177`。端口被占用时先核对进程所属实例，或为新实例选择另一对端口；不要终止无关进程。`--strictPort` 可阻止前端静默换端口。
- 具体接口与环境变量见[后端说明](../backend/README.md)和[前端接入说明](../frontend/docs/api-integration.md)。

### 2. 准备独立检出

建议使用长期保留的目录。以下命令不会带入原工作区中未提交的代码、模型或 `.env.local`；目标目录必须尚不存在。

```bash
git clone --branch fix/scene-sync-recovery https://github.com/Techathon-fufu/DormTopology.git "$HOME/Projects/DormTopology-local-demo"
cd "$HOME/Projects/DormTopology-local-demo"
git switch --detach 6784dbc
git rev-parse --short HEAD
git status --short
```

版本应为 `6784dbc`，状态应为空。首次准备全新数据目录与依赖：

```bash
export DORM_DEMO_ROOT="$PWD"
export DORM_DEMO_DATA="$DORM_DEMO_ROOT/.work/local-demo-20261017"
mkdir -p "$DORM_DEMO_DATA"
python3 -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ required"'
python3 -m venv "$DORM_DEMO_DATA/venv"
"$DORM_DEMO_DATA/venv/bin/python" -m pip install -r backend/requirements.txt
cd "$DORM_DEMO_ROOT/frontend"
npm ci
VITE_API_MODE=mock VITE_ORGANIZATION_API_MODE=real VITE_API_BASE_URL='' VITE_DEV_API_TARGET=http://127.0.0.1:8003 npm run build
```

首次部署前确认 `$DORM_DEMO_DATA/organization.sqlite3` 不存在；若已存在，它就是已有实例的数据，选择新的数据目录来创建干净实例。安装过程不会创建 SQLite 文件，后端首次启动时自动建库。

`VITE_*` 模式和 API 地址在构建时写入产物，修改后须重新构建。不要将全局 `VITE_API_MODE` 改为 `real`：此版本其它真实应用接口返回 HTTP 501。上述模式为「真实整理 / 其余演示」。第三方密钥不放入前端或本地部署文档。

### 3. 启动后端

在终端 A 从独立检出根目录运行；此终端保持前台运行：

```bash
cd "$HOME/Projects/DormTopology-local-demo"
export DORM_DEMO_ROOT="$PWD"
export DORM_DEMO_DATA="$DORM_DEMO_ROOT/.work/local-demo-20261017"
export DORMTOPOLOGY_DB_PATH="$DORM_DEMO_DATA/organization.sqlite3"
"$DORM_DEMO_DATA/venv/bin/python" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8003
```

只运行一个 Uvicorn 进程，不加 `--workers` 或 `--reload`。整理后台默认 2 个工作线程、最多 8 个运行或排队任务；应用关闭时等待已开始的计算退出。后端从进程环境读取配置，不会自动加载 `.env` 文件。

### 4. 启动前端

在终端 B 运行；此终端同样保持前台运行：

```bash
cd "$HOME/Projects/DormTopology-local-demo/frontend"
VITE_DEV_API_TARGET=http://127.0.0.1:8003 npm run preview -- --host 127.0.0.1 --port 5177 --strictPort
```

固定版本中的 Vite preview 继承 `vite.config.ts` 的开发代理，因此启动 preview 时也须设置 `VITE_DEV_API_TARGET`。前端使用空 `VITE_API_BASE_URL`，通过同源 `/api/v1` 访问 `8003`，无需扩大后端 CORS 范围。

- 首页：<http://127.0.0.1:5177/>
- 示例工作台：<http://127.0.0.1:5177/projects/demo-dorm-101/workspace>
- 算法工作台：<http://127.0.0.1:5177/algorithm-lab>
- 后端接口文档：<http://127.0.0.1:8003/docs>

### 5. 健康检查与使用验证

在另一个终端执行。两次健康检查都应返回 JSON，`status` 为 `ok`，`capabilities` 包含 `organization`：

```bash
curl --fail --silent --show-error http://127.0.0.1:8003/api/v1/health
curl --fail --silent --show-error http://127.0.0.1:5177/api/v1/health
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:5177/projects/demo-dorm-101/workspace
```

第三个请求只验证深链接由前端入口接管，不能替代浏览器渲染检查。浏览器按以下步骤验收：

1. 用全新浏览器上下文或隐私窗口打开上述 `5177` 示例工作台，确认显示「真实整理 / 其余演示」、后端健康，3D 场景非空，切换俯视或正视后仍可见；检查桌面和手机视口。
2. 打开空间整理面板，核对尺寸与整理前位置并勾选确认，生成整理方案。等待真实 Python 任务完成，核对预览仍保留原布局、全部物品有结果；显示器应位于中央主视位，打印机应位于侧部。
3. 接受方案，确认物品移动、后端场景版本递增，刷新后布局仍保留。初始整理后的保存版本通常由 1 变为 2，后续编辑继续递增。
4. 用同一数据库停止并重启服务，确认原场景可读取。恢复未完成任务的规则见[后端说明](../backend/README.md)。

构建检查可单独重跑：

```bash
cd "$HOME/Projects/DormTopology-local-demo/frontend"
npm run typecheck
VITE_API_MODE=mock VITE_ORGANIZATION_API_MODE=real VITE_API_BASE_URL='' VITE_DEV_API_TARGET=http://127.0.0.1:8003 npm run build
```

现有 `workspace.spec.ts`、`organization-backend.spec.ts` 等浏览器用例会动态导入 `/src/state/*.ts`，需配套 Vite dev 服务，不能直接针对本节的构建后 preview 执行。开发态自动化命令见[前端接入验证](../frontend/docs/api-integration.md#5-验证)。构建预览的浏览器检查应按实际运行记录，不能沿用旧测试结果。桌体或单品未提供运行时模型时使用简化几何，不将回退显示计为真实模型加载验收。

### 6. 数据、停止与重启

| 位置 | 用途 |
| --- | --- |
| `.work/local-demo-20261017/venv/` | 该实例的 Python 虚拟环境 |
| `.work/local-demo-20261017/organization.sqlite3` | 后端场景、基线、任务及版本；由后端创建 |
| `frontend/node_modules/`、`frontend/dist/` | 安装依赖与本次前端构建产物 |
| 浏览器 origin `http://127.0.0.1:5177` 的 localStorage | 项目与布局、后端场景引用、模式覆盖及其它小型状态 |
| 同一 origin 的 IndexedDB `dormtopology-files` | 上传照片与模型文件 |

`.work/` 已在根 `.gitignore` 中忽略。服务输出在两个前台终端中查看；停止时分别按 `Ctrl+C` 并等待退出。重启直接重复第 3、4 节，使用相同代码、数据库路径和浏览器 origin；无需重新安装、构建或删除数据库。升级代码或改变前端构建变量时再重新构建。

全新 SQLite 文件只隔离后端数据。浏览器 origin 按协议、主机和端口区分，`localhost:5177` 与 `127.0.0.1:5177` 也不同。已有 origin 中的 `dormtopology.api-mode-override` 会覆盖构建模式；使用隐私窗口，或在页面提供的「恢复真实模式」入口清除覆盖。创建新实例应选择新数据目录和新的前端端口或浏览器上下文，保证两端都独立。

不要删除默认 `~/.local/share/dormtopology/organization.sqlite3`、旧 `5174` 浏览器数据或其它实例的数据库来规避版本冲突。遇到真实内容冲突时按页面提示创建独立副本；换用全新数据库后也应使用独立浏览器状态。

### 7. 本机实例记录

2026-10-17 此前部署使用已有的独立工作树 `/private/tmp/dorm-monitor-placement`，代码固定为 `6784dbc`，运行目录为 `/private/tmp/dorm-monitor-placement/.work/local-demo-20261017`，端口为后端 `8003`、前端 `5177`。此处只记录旧实例；重现旧实例时，将本历史章节第 3、4 节的检出路径替换为 `/private/tmp/dorm-monitor-placement`，其它配置保持一致。当前修改使用本文开头的工作区启动命令。

此前服务由助手在后台启动。日志为运行目录中的 `organization.log`、`frontend.log`，启动 PID 记录在 `backend.pid`、`frontend.pid`。停止前先用下面的命令核对当前监听进程，再对确认属于本实例的 PID 执行 `kill -TERM <PID>`；PID 文件可能已过期，不直接按旧 PID 停止进程。停止后可按本文开头的当前启动命令以前台方式重启。

```bash
lsof -nP -iTCP:8003 -iTCP:5177 -sTCP:LISTEN
tail -n 40 /private/tmp/dorm-monitor-placement/.work/local-demo-20261017/organization.log
tail -n 40 /private/tmp/dorm-monitor-placement/.work/local-demo-20261017/frontend.log
```

`/private/tmp` 仅记录本次实际位置，系统清理后不保证保留。长期使用请按第 2 节在持久目录重新部署，并保留所需数据库与浏览器项目导出；不要把临时目录当作长期数据备份。

### 8. 历史验证记录

2026-10-17，Python 3.11、Node.js 22.23.1、npm 10.9.8：

- 独立虚拟环境安装、`pip check`、`npm ci` 和 `npm run build` 通过；构建仍有既有 Three.js 大包提示。
- 后端整理 service/API 回归 22 项通过；新安装的 Starlette 对测试客户端输出依赖弃用提示，未影响用例。
- 直连后端及经过前端代理的 `/api/v1/health` 均正常，工作台深链接返回构建入口。
- 针对构建产物运行 Chromium：1440 × 1000 桌面和模拟 Pixel 7 检查工作台、透视/俯视/正视、刷新、页面横向溢出和 Canvas 像素，均通过，页面运行错误为 0；复核了截图。这不是实体手机验收。
- 在独立 `verification.sqlite3` 上通过浏览器完成 17 件示例物品的真实整理、预览和应用；接受前后端仍保留原布局，接受后版本 1 → 2，显示器居中、打印机位于侧边，物品未丢失，普通物品未被移到地板。重启后回读的完整场景与应用结果一致。
- 验证后停止临时后端，交付实例换用此前不存在的 `organization.sqlite3`。再以全新浏览器上下文完成桌面/手机只读检查，数据库的 `scenes`、`baselines`、`jobs` 均为 0；首次使用会从示例初始布局开始。

本机浏览器检查与截图位于运行目录的 `verification-results.json`、`clean-results.json`、`verification-*.png` 和 `clean-*.png`，属于本地生成证据，不随代码提交。没有将现有依赖开发服务器源码入口的 Playwright 专项计为构建预览的验证，也未验证真实供应商调用、产品走线或精细模型资产。
