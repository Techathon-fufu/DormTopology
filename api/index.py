import os
import sys
from pathlib import Path

# Vercel serverless 环境：文件系统只读，数据库和临时文件必须放在 /tmp
os.environ.setdefault("DORMTOPOLOGY_DB_PATH", "/tmp/dormtopology.db")
os.environ.setdefault("DORMTOPOLOGY_WORKFLOW_DB_PATH", "/tmp/workflow.db")
os.environ.setdefault("DORMTOPOLOGY_WORKFLOW_DATA_DIR", "/tmp/dormtopology-data")

# 添加 backend 目录到 Python 路径
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.main import app

# Vercel Python runtime 直接支持 ASGI app
handler = app
