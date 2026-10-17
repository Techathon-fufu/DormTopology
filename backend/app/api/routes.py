from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from ..service.errors import NotImplementedCapability
from ..service.organization import ALGORITHM_VERSION, OrganizationService


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


def create_router(get_service: Callable[[], OrganizationService]) -> APIRouter:
    router = APIRouter(prefix="/api/v1")
    Service = Annotated[OrganizationService, Depends(get_service)]

    @router.get("/health")
    def health():
        return {
            "status": "ok",
            "version": ALGORITHM_VERSION,
            "capabilities": ["organization"],
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

    @router.post("/recognition")
    @router.post("/models/generate")
    @router.post("/cables/plan")
    @router.post("/layout/plan")
    def unsupported():
        raise NotImplementedCapability(
            "This service currently implements organization only"
        )

    return router
