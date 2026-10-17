# 真实整理闭环与验收

2026-10-17 新增 `/workflow`。首页“打开真实整理工作台”进入；旧 `/projects/:id/workspace` 仍使用原有 Mock/HTTP 适配，不据此宣称全部产品入口已经联调。

后续整合说明：最新 main 已接入产品真实整理/走线与固定家具；本页保留独立工作流的首次交付记录。最终 API 前缀为 `/api/v1/workflow`，两套入口共用一个应用工厂，当前范围与验收结果以[分支整合记录](merge_workflow_prefab_acceptance.md)为准。

## 本轮交付

```text
创建示例场景 / 导入完整契约场景 → 编辑物品、连接与实际线长
→ 保存 → 明确确认尺寸、接口与原始位置 → 后端建立不可变快照
→ 实时 Python 整理建议 → 预览 / 取消 / 接受
→ 后端原子递增版本 → 当前场景实时走线 → 比较与 Markdown 指南
```

初始场景来自仓库综合桌面模板，8 件待整理物品，另有固定插排、直插适配器和墙插，三根线包含插排总线。示意尺寸未经实物测量。上传照片只作为参照，保存在本地后端并可刷新恢复；本入口没有把照片识别为清单。展示为简化几何，未完成桌体 GLB、实时 Rodin 生成和显示替换验收。照片识别、原产品工作台字段转换、真实双通道/多规格实物和真机仍按原任务清单保留待办。

## 启动

在仓库根目录：

```powershell
python -m pip install -r backend/requirements.txt
python backend/scripts/serve.py --port 8000
```

另开终端：

```powershell
cd frontend
npm install
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174 --strictPort
```

浏览器访问 `http://127.0.0.1:5174/` 或 `/workflow`。Vite 将 `/api/v1` 转发到 `http://127.0.0.1:8000`。新入口直接使用应用 API，无需将旧工作台切换到 real 模式。服务仅监听本机回环地址；生产环境需要同源反向代理。

本次运行把 FastAPI 依赖安装在 Git 忽略的 `.work/closed-loop/python-deps/`，`serve.py` 在全局尚未安装 FastAPI 时识别此目录；常规安装使用上面的 requirements。整合后工作流场景默认存入产品数据库旁的 `workflow.sqlite3`，照片位于同目录 `workflow-data/photos/`。可用 `DORMTOPOLOGY_WORKFLOW_DB_PATH` 和 `DORMTOPOLOGY_WORKFLOW_DATA_DIR` 独立设置；本轮验收使用 Git 忽略的 `.work/merge-prefab/runtime/`，未修改既有 `backend/data/`。浏览器仅保存当前场景 ID。`create_app(db_path=..., data_dir=...)` 可注入临时数据库与照片目录。

## API

独立工作流统一前缀 `/api/v1/workflow`（产品整理仍为 `/api/v1`）；除下载外返回 `{scene, baseline, packing_result, routing_result, comparison, guide, photo_url}`，空结果为 `null`。字段仍按[数据契约](data_contract.md)，不使用旧前端的部分场景载荷。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /health` | 本机算法服务健康检查 |
| `POST /scenes` | `{}` 创建示例，或 `{scene}` 导入契约场景；后端分配场景 ID |
| `GET /scenes/{id}` | 恢复已保存场景、原始快照和本版本结果 |
| `PUT /scenes/{id}` | `{expected_revision, scene}` 保存编辑并递增版本，清空旧结果 |
| `POST /scenes/{id}/baseline` | `{expected_revision}` 明确确认当前尺寸/接口，建立新基线并递增版本 |
| `POST /scenes/{id}/packing` | `{expected_revision}` 实时计算并保存建议，不改场景版本 |
| `POST /scenes/{id}/packing/apply` | `{expected_revision}` 复查并原子应用当前建议，仅更新物品位姿 |
| `POST /scenes/{id}/routing` | `{expected_revision}` 实时计算当前场景走线 |
| `POST /scenes/{id}/guide` | `{expected_revision}` 当前布局复查、面积与走线汇总、生成指南 |
| `GET /scenes/{id}/guide.md?expected_revision=n` | 下载同版本有效指南，过期返回 409 |
| `POST /scenes/{id}/photos` | multipart：`file`、`expected_revision`，JPEG/PNG/WebP，最多 10MB |
| `GET /photos/{filename}` | 本机照片预览，生成文件名白名单 |

错误为 `{detail: {code, message}}`：400 非法输入、404 不存在、409 过期版本或建议不可应用、503 计算并发已满。结构校验由 API/领域规则处理；算法运行在同步路由的线程池，计算并发上限为 2，无队列或伪造任务。

## 状态与比较规则

- `domain` 没有新增 Web、数据库或供应商依赖。service 声明存储 Protocol；SQLite 以整个文档的版本和哈希进行条件更新，结果与失效操作在同一事务提交。同一几何版本的并发结果更新也不能静默回退。
- 整理预览不移动已保存场景；接受时仅应用位姿，不从旧建议覆盖名称、模型、接口或允许区域。建议被消费后不能重复应用。
- 改尺寸会清除尺寸与接口确认，改接口会清除接口确认；确认不改写尺寸来源。当前基线不可被普通保存改写，重新建立基线保留历次快照。
- 前端阻止未保存草稿进入规划、隐藏草稿中的旧线路，取消请求并丢弃旧响应；409 会读取后端新状态，不自动重新提交修改。
- 面积按同一 1cm 网格重新计算基线和当前值。物品集合、确认尺寸、桌面或保留区变更时原始面积不可比。
- 走线结果的 `metrics.exposed_length_m` 保留领域契约定义的有效路径小计；比较载荷 `current_exposed_length_m` 仅在全部请求线缆有效时给出。部分失败时完整总长未知，不能以小计计算改善比例。原始路径未知时原始暴露线长同样未知。
- 指南列出实际位姿变化、有效路径与支撑 ID；失败线路只进入未解决事项，无可执行穿线步骤。存在未解决事项时明确“未完成”。导出绑定场景 ID、版本和基线。

## 自动验收

后端依赖安装后，根目录运行：

```powershell
python -m pip install -r backend/requirements-dev.txt
python -B -m unittest backend.tests.test_scene_workflow -v
python -B -m unittest discover -s backend/tests -q
```

新状态测试包含 Fake 算法，专门验证存储与编排；它们不能代替下面调用真实算法的浏览器验收。浏览器测试需同时启动前后端：

```powershell
cd frontend
npm run build
node node_modules/@playwright/test/cli.js install chromium --only-shell
$env:WORKFLOW_API_AVAILABLE='1'
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5174'
node node_modules/@playwright/test/cli.js test tests/workflow.spec.ts --workers=1
```

浏览器验收没有 Mock API：桌面 Chromium 与模拟 Pixel 7 分别创建场景、确认、计算整理、取消预览、接受、验证三线有效、生成/下载指南、刷新恢复，再缩短一根线并验证失效、旧版本 409、两线有效/一线失败、完整总长未知与未完成指南。另检验非法结构和伪造图片被拒绝。模拟手机不能替代真实手机。

本轮执行结果见本页后续“验证记录”；只有实际通过的项目才记为通过。

## 验证记录（2026-10-17）

- 新增状态与 API 测试 11/11 通过：临时 SQLite、旧版本、同版本文档竞争、规划期间编辑、基线保持、失败线缆、尺寸确认与照片上传。
- 首轮真实浏览器验收捕获了部分成功指标被错误清空、导致契约解析拒绝的问题。已恢复领域结果的有效线路小计口径，比较载荷单独保持完整总长未知。
- 修正后 `/workflow` 浏览器测试 4/4 通过，桌面与模拟 Pixel 7 各 2 项，约 2.9 分钟；实际调用 FastAPI 和 Python 算法，没有 Mock 响应。三线成功、Markdown 下载、刷新恢复、旧版本 409、缩短一根线后的两线有效/一线失败和未完成指南均通过。
- 全部后端回归 155/155 通过，用时约 383 秒，含新增 11 项应用测试；领域算法实现未修改。随后再次执行新增状态/API 测试 11/11 通过。
- 按截图将线缆表单改为窄屏卡片并补齐尺寸、坐标、线径及弯曲半径输入后，再次执行 `/workflow` 浏览器验收 4/4 通过。原演示工作台的历史测试存在标题重复和旧相机按钮选择器，已按现有界面更新，未改动原工作台产品逻辑。
- 更新后的原工作台专项测试 4/4 通过（约 47 秒，桌面与模拟手机各 2 项），保留非空 Canvas 像素、相机切换、刷新、任务状态和项目隔离检查。与新工作台共 8 项浏览器检查分两次运行通过。
- 最终 TypeScript 检查和生产构建通过；保留 Three.js 主包体积提示。运行截图与报告默认位于 `frontend/test-results/` 和 `frontend/playwright-report/`（后续测试会覆盖）；另保留本次真实工作台截图 `.work/closed-loop/workflow-preview.png`。
- 真机、桌体 GLB、VLM/Rodin 产品接入没有在本轮执行验收。

## 委派记录

按项目约定，后端和前端实现均先交给配置的 `deepseek-pro`，各追加一次修正任务。修正响应包含可解析的完整文件对象及多余尾部文字，helper 因严格 JSON 解析记录失败；保留原回执，由 Codex 恢复选定文件、核对原始哈希并进行集成修正及实际测试，没有把失败回执改成成功。

原演示工作台的测试选择器更新另交给 `deepseek-pro` 起草，Codex 审查后通过 helper 应用，并补齐手机“更多操作”中的相机选择。

已记录用量：连接探测 19 tokens；首次前端回复 49,574 tokens（未提供代码）；原工作台测试修正 14,211 tokens。两个修正草稿及首次后端响应的用量因 helper 解析失败没有留存，标为未知，不计算总耗用或节省比例。原始任务、回执和恢复产物留在 Git 忽略的 `.work/closed-loop/`，不含供应商密钥。
