# DormTopology 3D 后端核心实现层

本目录包含 DormTopology 3D 的核心外部服务适配器与可执行流水线。

2026-10-17 新增最小 FastAPI 应用：`app/bootstrap.py` 统一装配 `service`、SQLite `db` 与 `api`，供前端 `/workflow` 调用真实布局和走线算法。根目录安装 `python -m pip install -r backend/requirements.txt`，再运行 `python backend/scripts/serve.py --port 8000`。场景与照片保存在 Git 忽略的 `backend/data/`。完整接口、版本事务、测试与当前限制见[真实整理闭环](../docs/closed_loop_acceptance.md)。下方供应商命令仍为独立实验脚本，不代表已接入新产品入口。

---

## 目录结构

```text
backend/
├── app/
│   ├── adapters/                  # 外部服务适配器
│   │   ├── __init__.py
│   │   ├── rodin_adapter.py       # DeemosTech Hyper3D Rodin API v2 工业级客户端
│   │   └── vlm_adapter.py         # 视觉大模型 2D 目标检测与 3D 桌面物理坐标换算
│   └── domain/                    # 契约领域模型与几何规范
│       └── __init__.py
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
