"""One composition root owns concrete resources and their application lifespan."""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .adapters.organization_strategy_adapter import (
    ChatCompletionsOrganizationStrategyProvider,
)
from .api.errors import register_error_handlers
from .api.routes import create_router
from .api.scenes import build_router as build_workflow_router
from .db.photos import PhotoStore
from .db.sqlite import SQLiteOrganizationRepository
from .db.sqlite_store import SQLiteSceneStore
from .service.executor import LimitedExecutor
from .service.model_generation import ModelGenerationService
from .service.organization import OrganizationService
from .service.recognition import RecognitionService
from .service.routing import RoutingService
from .service.scenes import SceneService


@dataclass(frozen=True)
class Settings:
    database_path: str | Path
    max_workers: int = 16
    max_pending: int = 64
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    workflow_database_path: str | Path | None = None
    workflow_data_dir: str | Path | None = None
    # An explicit Chat Completions base URL (including any required /v1).
    # All three fields are required; no provider/key/model discovery is used.
    org_llm_base_url: str | None = None
    org_llm_api_key: str | None = field(default=None, repr=False)
    org_llm_model: str | None = None

    @classmethod
    def from_environment(cls):
        default = (
            Path.home() / ".local" / "share" / "dormtopology" / "organization.sqlite3"
        )
        return cls(
            database_path=os.environ.get("DORMTOPOLOGY_DB_PATH", str(default)),
            max_workers=int(os.environ.get("DORMTOPOLOGY_JOB_WORKERS", "16")),
            max_pending=int(os.environ.get("DORMTOPOLOGY_JOB_CAPACITY", "64")),
            cors_origins=tuple(
                origin.strip()
                for origin in os.environ.get(
                    "DORMTOPOLOGY_CORS_ORIGINS",
                    "http://localhost:5173,http://127.0.0.1:5173",
                ).split(",")
                if origin.strip()
            ),
            workflow_database_path=os.environ.get("DORMTOPOLOGY_WORKFLOW_DB_PATH"),
            workflow_data_dir=os.environ.get("DORMTOPOLOGY_WORKFLOW_DATA_DIR"),
            org_llm_base_url=os.environ.get("DORMTOPOLOGY_ORG_LLM_BASE_URL"),
            org_llm_api_key=os.environ.get("DORMTOPOLOGY_ORG_LLM_API_KEY"),
            org_llm_model=os.environ.get("DORMTOPOLOGY_ORG_LLM_MODEL"),
        )


def _resolve_workflow_paths(settings: Settings) -> tuple[Path, Path]:
    org_path = Path(settings.database_path)
    if settings.workflow_database_path:
        db_file = Path(settings.workflow_database_path)
    else:
        db_file = org_path.with_name("workflow.sqlite3")
    if settings.workflow_data_dir:
        data_dir = Path(settings.workflow_data_dir)
    else:
        data_dir = db_file.parent / "workflow-data"
    return db_file, data_dir


def _default_template_loader():
    path = (
        Path(__file__).resolve().parents[2]
        / "frontend" / "public" / "algorithm-fixtures"
        / "packing-integrated-desk" / "scene.json"
    )

    def load() -> dict:
        return json.loads(path.read_text(encoding="utf-8"))

    return load


def create_app(
    settings: Settings | None = None,
    *,
    db_path: str | None = None,
    data_dir: str | None = None,
) -> FastAPI:
    settings = settings or Settings.from_environment()
    if db_path is not None or data_dir is not None:
        settings = replace(
            settings,
            workflow_database_path=db_path
            if db_path is not None
            else settings.workflow_database_path,
            workflow_data_dir=data_dir
            if data_dir is not None
            else settings.workflow_data_dir,
        )

    workflow_db, workflow_data = _resolve_workflow_paths(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        repository = await run_in_threadpool(
            SQLiteOrganizationRepository, settings.database_path
        )
        executor = None
        scene_store = None
        photo_store = None
        try:
            executor = LimitedExecutor(
                max_workers=settings.max_workers, max_pending=settings.max_pending
            )
            await run_in_threadpool(repository.recover_incomplete_jobs)

            strategy_provider = None
            if all(
                isinstance(value, str) and value.strip()
                for value in (
                    settings.org_llm_base_url,
                    settings.org_llm_api_key,
                    settings.org_llm_model,
                )
            ):
                strategy_provider = ChatCompletionsOrganizationStrategyProvider(
                    base_url=settings.org_llm_base_url,
                    api_key=settings.org_llm_api_key,
                    model=settings.org_llm_model,
                )
            organization_service = OrganizationService(
                repository, executor, strategy_provider=strategy_provider
            )
            routing_service = RoutingService(repository, executor)
            recognition_service = RecognitionService(repository, executor, data_dir=workflow_data)
            model_service = ModelGenerationService(repository, executor, data_dir=workflow_data)

            scene_store = await run_in_threadpool(SQLiteSceneStore, workflow_db)
            photo_store = await run_in_threadpool(PhotoStore, workflow_data / "photos")
            workflow_service = SceneService(
                scene_store,
                _default_template_loader(),
            )

            app.state.organization_service = organization_service
            app.state.routing_service = routing_service
            app.state.recognition_service = recognition_service
            app.state.model_service = model_service
            app.state.workflow_service = workflow_service
            app.state.workflow_photo_store = photo_store
            yield
        finally:
            try:
                if executor is not None:
                    await run_in_threadpool(executor.close)
            finally:
                try:
                    if scene_store is not None:
                        await run_in_threadpool(scene_store.close)
                finally:
                    await run_in_threadpool(repository.close)

    app = FastAPI(title="DormTopology API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type"],
    )
    register_error_handlers(app)
    organization_validation_handler = app.exception_handlers[RequestValidationError]

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        if request.url.path.startswith("/api/v1/workflow/"):
            return JSONResponse(status_code=400, content={"detail": {
                "code": "invalid_input", "message": "请求字段或类型不正确"}})
        return await organization_validation_handler(request, error)

    def get_service() -> OrganizationService:
        return app.state.organization_service

    def get_routing_service() -> RoutingService:
        return app.state.routing_service

    def get_recognition_service() -> RecognitionService:
        return app.state.recognition_service

    def get_model_service() -> ModelGenerationService:
        return app.state.model_service

    def get_workflow_service() -> SceneService:
        return app.state.workflow_service

    def get_workflow_photos() -> PhotoStore:
        return app.state.workflow_photo_store

    app.include_router(
        create_router(
            get_service,
            get_routing_service,
            get_recognition_service,
            get_model_service,
        )
    )
    app.include_router(build_workflow_router(get_workflow_service, get_workflow_photos))

    return app
