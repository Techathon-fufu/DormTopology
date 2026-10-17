"""Small I/O boundaries; algorithms remain direct domain function calls."""

from collections.abc import Callable
from concurrent.futures import Future
from dataclasses import dataclass
from typing import Protocol

from ..domain.models import Scene


@dataclass(frozen=True)
class SceneRecord:
    project_id: str
    scene: Scene
    baseline_source_id: str


class OrganizationRepository(Protocol):
    def get_project(self, project_id: str) -> SceneRecord | None: ...

    def get_scene(self, scene_id: str) -> SceneRecord | None: ...

    def get_baseline(self, baseline_id: str) -> Scene | None: ...

    def save_scene(
        self,
        record: SceneRecord,
        expected_revision: int | None,
        baseline: Scene | None,
    ) -> None: ...

    def create_job(self, envelope: dict, snapshot: Scene) -> None: ...

    def get_job(self, job_id: str) -> dict | None: ...

    def claim_job(self, job_id: str) -> bool: ...

    def finish_job(
        self, job_id: str, *, result: dict | None = None, error: dict | None = None
    ) -> None: ...

    def cancel_job(self, job_id: str) -> dict: ...

    def apply_job(self, job_id: str, scene: Scene, expected_revision: int) -> None: ...


class JobExecutor(Protocol):
    def reserve(self) -> None: ...

    def release(self) -> None: ...

    def submit(self, function: Callable[[], None]) -> Future: ...
