"""HTTP adapter for the scene service."""

from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, StrictInt

from ..service.scenes import SceneService, ServiceError


class CreateSceneBody(BaseModel):
    scene: dict | None = None


class UpdateSceneBody(BaseModel):
    expected_revision: StrictInt
    scene: dict


class RevisionBody(BaseModel):
    expected_revision: StrictInt


def build_router(service: SceneService, photo_store=None) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    def _error(status: int, code: str, message: str):
        return JSONResponse(status_code=status, content={"detail": {"code": code, "message": message}})

    def _guard(fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ServiceError as error:
            return _error(error.status, error.code, error.message)

    @router.get("/health")
    def health():
        return {
            "status": "ok",
            "capabilities": {"packing": True, "routing": True},
        }

    @router.post("/scenes")
    def create_scene(body: CreateSceneBody):
        return _guard(service.create_scene, body.scene)

    @router.get("/scenes/{scene_id}")
    def get_scene(scene_id: str):
        return _guard(service.get_scene, scene_id)

    @router.put("/scenes/{scene_id}")
    def update_scene(scene_id: str, body: UpdateSceneBody):
        return _guard(
            service.update_scene,
            scene_id,
            {"expected_revision": body.expected_revision, "scene": body.scene},
        )

    @router.post("/scenes/{scene_id}/baseline")
    def create_baseline(scene_id: str, body: RevisionBody):
        return _guard(service.create_baseline, scene_id, body.expected_revision)

    @router.post("/scenes/{scene_id}/packing")
    def create_packing(scene_id: str, body: RevisionBody):
        return _guard(service.create_packing, scene_id, body.expected_revision)

    @router.post("/scenes/{scene_id}/packing/apply")
    def apply_packing(scene_id: str, body: RevisionBody):
        return _guard(service.apply_packing, scene_id, body.expected_revision)

    @router.post("/scenes/{scene_id}/routing")
    def create_routing(scene_id: str, body: RevisionBody):
        return _guard(service.create_routing, scene_id, body.expected_revision)

    @router.post("/scenes/{scene_id}/guide")
    def create_guide(scene_id: str, body: RevisionBody):
        return _guard(service.create_guide, scene_id, body.expected_revision)

    @router.get("/scenes/{scene_id}/guide.md")
    def get_guide(scene_id: str, expected_revision: int | None = None):
        try:
            markdown = service.get_guide_markdown(scene_id, expected_revision)
        except ServiceError as error:
            return _error(error.status, error.code, error.message)
        return PlainTextResponse(markdown, media_type="text/markdown",
                                 headers={"Content-Disposition": 'attachment; filename="dormtopology-guide.md"'})

    @router.post("/scenes/{scene_id}/photos")
    def upload_photo(
        scene_id: str,
        expected_revision: int = Form(...),
        file: UploadFile = File(...),
    ):
        if photo_store is None:
            return _error(500, "internal", "photo storage unavailable")
        try:
            service.get_scene(scene_id)
            url = photo_store.save(file.file.read(10 * 1024 * 1024 + 1), file.filename or "", file.content_type or "")
        except ServiceError as error:
            return _error(error.status, error.code, error.message)
        except ValueError as error:
            return _error(400, "invalid_image", str(error))
        return _guard(service.set_photo_url, scene_id, expected_revision, url)

    @router.get("/photos/{filename}")
    def get_photo(filename: str):
        if photo_store is None:
            return _error(404, "not_found", "photo storage unavailable")
        try:
            return photo_store.serve(filename)
        except ServiceError as error:
            return _error(error.status, error.code, error.message)
        except FileNotFoundError:
            return _error(404, "not_found", "photo not found")

    return router
