"""Application bootstrap: store, service, router, photo storage."""

from __future__ import annotations

import io
import json
import re
import uuid
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from .api.scenes import build_router
from .db.sqlite_store import SQLiteSceneStore
from .service.scenes import SceneService, ServiceError

_ALLOWED = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_SAFE = re.compile(r"^[0-9a-f-]{36}\.[a-z0-9]{1,5}$")
MAX_BYTES = 10 * 1024 * 1024


class PhotoStore:
    def __init__(self, data_dir: str | Path):
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)

    def save(self, data: bytes, filename: str, content_type: str) -> str:
        if len(data) > MAX_BYTES:
            raise ServiceError(400, "invalid_image", "image exceeds 10MB")
        ext = _ALLOWED.get(content_type)
        if ext is None:
            low = (filename or "").lower()
            for mime, suffix in _ALLOWED.items():
                if low.endswith(suffix):
                    ext = suffix
                    break
        if ext is None:
            raise ServiceError(400, "invalid_image", "only jpeg/png/webp allowed")
        try:
            from PIL import Image
            with Image.open(io.BytesIO(data)) as img:
                actual = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}.get(img.format)
                if actual is None:
                    raise ServiceError(400, "invalid_image", "only jpeg/png/webp allowed")
                ext = actual
                img.verify()
        except ServiceError:
            raise
        except Exception as error:  # noqa: BLE001
            raise ServiceError(400, "invalid_image", f"not a valid image: {error}") from error
        name = f"{uuid.uuid4()}{ext}"
        (self.dir / name).write_bytes(data)
        return f"/api/v1/photos/{name}"

    def serve(self, filename: str):
        if not _SAFE.match(filename):
            raise ServiceError(400, "invalid_input", "bad photo name")
        path = self.dir / filename
        if not path.is_file():
            raise ServiceError(404, "not_found", "photo not found")
        return FileResponse(str(path))


def _default_template_loader():
    path = (
        Path(__file__).resolve().parents[2]
        / "frontend" / "public" / "algorithm-fixtures"
        / "packing-integrated-desk" / "scene.json"
    )

    def load() -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

    return load


def create_app(db_path: str | None = None, data_dir: str | None = None):
    base = Path(data_dir) if data_dir else Path(__file__).resolve().parents[1] / "data"
    base.mkdir(parents=True, exist_ok=True)
    photos_dir = base / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    db_file = db_path or str(base / "dormtopology.sqlite3")

    store = SQLiteSceneStore(db_file)
    photo_store = PhotoStore(photos_dir)
    service = SceneService(store, _default_template_loader())

    app = FastAPI(title="DormTopology API")
    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        return JSONResponse(status_code=400, content={"detail": {
            "code": "invalid_input", "message": "请求字段或类型不正确"}})

    @app.exception_handler(ServiceError)
    async def service_error(request, error):
        return JSONResponse(status_code=error.status, content={"detail": {
            "code": error.code, "message": error.message}})

    app.include_router(build_router(service, photo_store))

    @app.on_event("shutdown")
    def _shutdown():
        store.close()

    return app
