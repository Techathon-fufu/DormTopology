from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from mangum import Mangum
import sys
from pathlib import Path

# 添加 backend 目录到 Python 路径
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.main import app as fastapi_app

# 添加缓存控制中间件，防止 304 响应
class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        if "/health" in request.url.path or "/api/" in request.url.path:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

fastapi_app.add_middleware(NoCacheMiddleware)

# Vercel serverless handler - 配置以支持所有 HTTP 方法
handler = Mangum(
    fastapi_app,
    lifespan="off",
    api_gateway_base_path=None,
    text_mime_types=["application/json", "text/plain"]
)
