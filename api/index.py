import os
import sys
from pathlib import Path

# Vercel serverless 环境：文件系统只读，数据库和临时文件必须放在 /tmp
os.environ.setdefault("DORMTOPOLOGY_DB_PATH", "/tmp/dormtopology.db")
os.environ.setdefault("DORMTOPOLOGY_WORKFLOW_DB_PATH", "/tmp/workflow.db")
os.environ.setdefault("DORMTOPOLOGY_WORKFLOW_DATA_DIR", "/tmp/dormtopology-data")
os.environ.setdefault("DORMTOPOLOGY_GENERATED_MODELS_DIR", "/tmp/dormtopology-models")

# 添加 backend 目录到 Python 路径
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.main import app
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

# Vercel Python runtime 去掉 /api 前缀，需要加回来
class AddApiPrefixMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Vercel 传递的路径是相对于 api/ 目录的，需要加上 /api 前缀
        if not request.url.path.startswith("/api"):
            scope = request.scope
            scope["path"] = "/api" + request.url.path
            request = Request(scope, request.receive)
        return await call_next(request)

app.add_middleware(AddApiPrefixMiddleware)

# Vercel Python runtime 直接支持 ASGI app
handler = app
