# DormTopology 3D 测试与实验验证套件

本目录记录了寝空拓扑（DormTopology 3D）模块一（视觉多模态初筛与坐标换算）及模块二（Rodin 3D 资产生成）的**全套测试实验、验证数据与基准产物**。

---

## 目录结构

```text
tests/
├── README.md                      # 测试说明文档（本文档）
├── test_images/                   # 输入的宿舍桌面实拍测试原图
│   └── testimage_0001.jpg         # 凌乱宿舍桌面 4K 照片
├── crops/                         # VLM 阶段二自动裁切的 6% 边距高清单品图
│   ├── crop_item_03_鼠标.png       # 436x481 分辨率单品切片
│   ├── crop_item_04_鼠标垫.png     # 1324x861 分辨率单品切片
│   ├── crop_item_05_卷尺.png       # 390x344 分辨率单品切片
│   └── crop_item_07_充电器.png     # 275x395 分辨率单品切片
├── test_vlm_round1/               # 第 1 轮：多模态 2D Grounding 基线测试
│   ├── run_round1.py              # 执行脚本
│   ├── round1_raw_result.json     # Qwen3-VL-32B-Thinking 原始推理与 JSON
│   ├── round1_parsed_items.json   # 初筛提取的物品清单
│   └── round1_visualized.jpg      # 2D 边界框全景可视化图
├── test_vlm_round2/               # 第 2 轮：空间分区扫描 + 3D 桌面物理坐标换算 + 自动切片
│   ├── run_round2.py              # 执行脚本
│   ├── round2_raw_result.json     # 9 大物品精准定位与尺寸预估原始输出
│   ├── round2_visualized.jpg      # 空间分区扫描标注可视化图
│   └── vlm_result_round2.json     # 对齐 data_contract.md 规范的完整感知结果
└── test_rodin_pipeline/           # 第 3 轮：DeemosTech Rodin 3D 模型生成与几何校验
    ├── test_rodin_client.py       # API 连接、余额查询与错误码拦截测试
    ├── test_glb_inspection.py     # GLB 二进制头、PBR 层次与多部件拓扑校验测试
    └── test_prefab_routing.py     # Prefabmodel/ 资产布局、prefab 路由与保真度分层校验
```

---

## 模型资产布局（`Prefabmodel/`）

Git 跟踪的归档 GLB 资产集中存放在仓库根的 `Prefabmodel/` 下，其中包含两类保真度层级，**共处一个平面目录**。前端部署用的运行时 GLB 可放在 `frontend/public/` 下，例如 `frontend/public/models/dorm_desk_assembled.glb`：

| 类别 | 文件 | 是否参与 prefab 路由 |
| --- | --- | --- |
| 低模 prefab | 12 个（`mouse` / `keyboard` / `cup` / `monitor` / `phone` / `charger` / `mousepad` / `tissue_box` / `stainless_bottle` / `laptop_fold` / `laptop_extend` / `books_stack`） | 是，按 `PREFAB_KEYWORDS` 匹配 |
| Rodin 高模（重名） | `charger_detail.glb`、`mousepad_detail.glb` | 否，`_detail` 后缀区分 |
| Rodin 回退资产 | `power_strip.glb`、`tablet.glb`、`tape_measure.glb`、`tissue_pack.glb` | 否，关键词无匹配时按物品 id 回退 |

命名与路由约定：

- `resolve_prefab_rel_path()` 支持命名变体：去下划线（`mouse_pad` → `mousepad.glb`）、空格转下划线（`stainless bottle` → `stainless_bottle.glb`）、`expand`/`extend` 互换（`laptop_expand` → `laptop_extend.glb`）。目标文件一律为**轻量低模**，高模不得被路由命中。
- 同名不同保真度用 `_detail` 后缀共存，不用覆盖：`charger.glb`（4.5 KB，prefab）与 `charger_detail.glb`（474 KB，Rodin 高模）是同一物品的两个层级。
- 代码中统一使用 `vlm_adapter.ASSET_DIR_NAME` 常量拼接资产相对路径，不写死目录名字面量。
- `objects/` 用于 Blender / OBJ 源文件（`.blend` / `.obj`）；归档 GLB 应提交到 `Prefabmodel/`。本地未跟踪的导出 GLB 不参与归档布局检查，也不由测试移动或删除。

---

## 测试复现与执行命令

### 1. 验证 3D 模型二进制结构与拓扑组件
```bash
python tests/test_rodin_pipeline/test_glb_inspection.py
```
* 验证已下载的 `Prefabmodel/tape_measure.glb`（11 个独立几何件）与 `Prefabmodel/mouse.glb`（31 个独立结构件）。

### 2. 验证模型资产布局与 prefab 路由
```bash
python tests/test_rodin_pipeline/test_prefab_routing.py
python -m unittest discover -s tests/test_rodin_pipeline -p test_prefab_routing.py -v
```
* 校验 12 个 `PREFAB_KEYWORDS` 全部解析到真实存在的**轻量低模**（体积上限 2 MB，防止高模误入路由）。
* 校验 `_detail` 高模确实比对应低模大，且不可被任何 prefab key 命中。
* 校验 Rodin 回退资产存在，使用 `git ls-files -z` 检查已跟踪 GLB，仅允许归档目录 `Prefabmodel/` 与前端运行时目录 `frontend/public/`；需要 Git 与仓库检出，枚举失败会明确报错。
* 临时 Git 夹具覆盖本地未跟踪导出、已跟踪运行时资源、错误位置的已跟踪 GLB 与 Git 枚举失败，不改动项目资产或索引。

### 3. 验证 Rodin API 云端连接与余额
```bash
python tests/test_rodin_pipeline/test_rodin_client.py
```

### 4. 复现第 2 轮 VLM 感知测试
```bash
python tests/test_vlm_round2/run_round2.py
```
