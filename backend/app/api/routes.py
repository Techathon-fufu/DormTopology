from collections.abc import Callable
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from ..service.errors import NotImplementedCapability
from ..service.model_generation import ModelGenerationService
from ..service.organization import ALGORITHM_VERSION, OrganizationService
from ..service.recognition import RecognitionService
from ..service.routing import RoutingService


class SceneSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scene: dict
    expected_revision: Annotated[StrictInt, Field(ge=1)] | None
    baseline_source_id: Annotated[str, Field(min_length=1)]
    baseline: dict | None = None


class SceneRevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scene_id: Annotated[str, Field(min_length=1)]
    scene_revision: Annotated[StrictInt, Field(ge=1)]


class CablePlanRequest(SceneRevisionRequest):
    target_ids: list[Annotated[str, Field(min_length=1)]] | None = None


class ModelGenerateRequest(BaseModel):
    project_id: Annotated[str, Field(min_length=1)]
    object: dict
    attempt: int = 0
    photo_id: str | None = None


def create_router(
    get_service: Callable[[], OrganizationService],
    get_routing_service: Callable[[], RoutingService],
    get_recognition_service: Callable[[], RecognitionService] | None = None,
    get_model_service: Callable[[], ModelGenerationService] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/v1")
    Service = Annotated[OrganizationService, Depends(get_service)]
    Routing = Annotated[RoutingService, Depends(get_routing_service)]
    Recognition = Annotated[RecognitionService, Depends(get_recognition_service)] if get_recognition_service else None
    ModelGen = Annotated[ModelGenerationService, Depends(get_model_service)] if get_model_service else None

    @router.get("/health")
    def health():
        return {
            "status": "ok",
            "version": ALGORITHM_VERSION,
            "capabilities": ["organization", "cable", "recognition", "model"],
        }

    @router.put("/projects/{project_id}/scene")
    def save_scene(
        project_id: str,
        body: SceneSaveRequest,
        service: Service,
    ):
        return service.save_scene(
            project_id,
            body.scene,
            body.expected_revision,
            body.baseline_source_id,
            body.baseline,
        )

    @router.get("/scenes/{scene_id}")
    def get_scene(scene_id: str, service: Service):
        return service.get_scene(scene_id)

    @router.get("/projects/{project_id}/scene")
    def get_project_scene(project_id: str, service: Service):
        return service.get_project_scene(project_id)

    @router.get("/projects/{project_id}/scene-state")
    def get_project_scene_state(project_id: str, service: Service):
        return service.get_project_scene_state(project_id)

    @router.post("/organization/plan", status_code=202)
    def plan_organization(body: SceneRevisionRequest, service: Service):
        return service.submit(body.scene_id, body.scene_revision)

    @router.post("/cables/plan", status_code=202)
    def plan_cables(body: CablePlanRequest, service: Routing):
        return service.submit(body.scene_id, body.scene_revision, body.target_ids)

    @router.get("/jobs/{job_id}")
    def get_job(job_id: str, service: Service):
        return service.get_job(job_id)

    @router.post("/jobs/{job_id}/cancel")
    def cancel_job(job_id: str, service: Service):
        return service.cancel_job(job_id)

    @router.post("/jobs/{job_id}/apply")
    def apply_job(
        job_id: str,
        body: SceneRevisionRequest,
        service: Service,
    ):
        return service.apply_job(job_id, body.scene_id, body.scene_revision)

    @router.post("/recognition", status_code=202)
    async def recognize(
        project_id: Annotated[str, Form()],
        photos: list[UploadFile] = File(...),
        service: RecognitionService = Depends(get_recognition_service) if get_recognition_service else None,
    ):
        if not service:
            raise NotImplementedCapability("Recognition service is not configured")
        saved_paths = []
        upload_dir = service.uploads_dir / project_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        for idx, photo in enumerate(photos):
            ext = Path(photo.filename).suffix if photo.filename else ".jpg"
            save_path = upload_dir / f"photo_{idx + 1}{ext}"
            contents = await photo.read()
            save_path.write_bytes(contents)
            saved_paths.append(save_path)
        return service.submit(project_id, saved_paths)

    @router.post("/models/generate", status_code=202)
    def generate_model(
        body: ModelGenerateRequest,
        service: ModelGenerationService = Depends(get_model_service) if get_model_service else None,
    ):
        if not service:
            raise NotImplementedCapability("Model generation service is not configured")
        return service.submit(body.project_id, body.object, body.attempt, body.photo_id)

    @router.post("/layout/plan")
    def unsupported():
        raise NotImplementedCapability(
            "This service currently implements organization, cable routing, recognition, and model generation"
        )

    return router
