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
    └── test_glb_inspection.py     # GLB 二进制头、PBR 层次与多部件拓扑校验测试
```

---

## 测试复现与执行命令

### 1. 验证 3D 模型二进制结构与拓扑组件
```bash
python tests/test_rodin_pipeline/test_glb_inspection.py
```
* 验证已下载的 `objects/tape_measure.glb`（11 个独立几何件）与 `objects/mouse.glb`（31 个独立结构件）。

### 2. 验证 Rodin API 云端连接与余额
```bash
python tests/test_rodin_pipeline/test_rodin_client.py
```

### 3. 复现第 2 轮 VLM 感知测试
```bash
python tests/test_vlm_round2/run_round2.py
```
