"""Filesystem-backed photo storage for workflow scenes."""

from __future__ import annotations

import io
import re
import uuid
from pathlib import Path

from fastapi.responses import FileResponse

from ..service.scenes import ServiceError

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
        return f"/api/v1/workflow/photos/{name}"

    def serve(self, filename: str):
        if not _SAFE.match(filename):
            raise ServiceError(400, "invalid_input", "bad photo name")
        path = self.dir / filename
        if not path.is_file():
            raise ServiceError(404, "not_found", "photo not found")
        return FileResponse(str(path))
