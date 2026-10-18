from fastapi import FastAPI
from mangum import Mangum
import sys
from pathlib import Path

# 添加 backend 目录到 Python 路径
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.main import app as fastapi_app

# Vercel serverless handler
handler = Mangum(fastapi_app, lifespan="off")
