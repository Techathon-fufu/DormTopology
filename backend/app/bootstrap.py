"""One composition root owns concrete resources and their application lifespan."""

import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .api.errors import register_error_handlers
from .api.routes import create_router
from .db.sqlite import SQLiteOrganizationRepository
from .service.executor import LimitedExecutor
from .service.organization import OrganizationService


@dataclass(frozen=True)
class Settings:
    database_path: str | Path
    max_workers: int = 2
    max_pending: int = 8
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")

    @classmethod
    def from_environment(cls):
        default = (
            Path.home() / ".local" / "share" / "dormtopology" / "organization.sqlite3"
        )
        return cls(
            database_path=os.environ.get("DORMTOPOLOGY_DB_PATH", str(default)),
            max_workers=int(os.environ.get("DORMTOPOLOGY_JOB_WORKERS", "2")),
            max_pending=int(os.environ.get("DORMTOPOLOGY_JOB_CAPACITY", "8")),
            cors_origins=tuple(
                origin.strip()
                for origin in os.environ.get(
                    "DORMTOPOLOGY_CORS_ORIGINS",
                    "http://localhost:5173,http://127.0.0.1:5173",
                ).split(",")
                if origin.strip()
            ),
        )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        repository = await run_in_threadpool(
            SQLiteOrganizationRepository, settings.database_path
        )
        executor = None
        try:
            executor = LimitedExecutor(
                max_workers=settings.max_workers, max_pending=settings.max_pending
            )
            await run_in_threadpool(repository.recover_incomplete_jobs)
            service = OrganizationService(repository, executor)
            app.state.organization_service = service
            yield
        finally:
            try:
                if executor is not None:
                    await run_in_threadpool(executor.close)
            finally:
                await run_in_threadpool(repository.close)

    app = FastAPI(title="DormTopology organization service", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type"],
    )
    register_error_handlers(app)

    def get_service() -> OrganizationService:
        return app.state.organization_service

    app.include_router(create_router(get_service))
    return app
