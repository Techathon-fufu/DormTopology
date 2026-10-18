"""Small I/O boundaries; algorithms remain direct domain function calls.

Also hosts port-reconciliation helpers used when scene revisions change.
"""

from __future__ import annotations

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

    def create_standalone_job(self, envelope: dict) -> None: ...

    def update_standalone_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        stage: str | None = None,
        progress: float | None = None,
        result: dict | None = None,
        error: dict | None = None,
    ) -> dict | None: ...

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


class StoreConflict(Exception):
    """The stored revision or document changed during a use case."""


def _vec_changed(a, b, eps: float = 1e-9) -> bool:
    if a is None or b is None:
        return True
    if len(a) != len(b):
        return True
    return any(abs(float(x) - float(y)) > eps for x, y in zip(a, b))


def reconcile_ports(previous: dict, current: dict) -> set[str]:
    """Return ids of ports whose geometry/type changed between scenes.

    New or reassigned ports also require explicit confirmation.
    """
    old_ports: dict[str, tuple[str, dict]] = {}
    for item in previous.get("items", []):
        for port in item.get("ports", []):
            old_ports[port["id"]] = (item["id"], port)
    changed: set[str] = set()
    for item in current.get("items", []):
        for port in item.get("ports", []):
            previous_port = old_ports.get(port["id"])
            if previous_port is None or previous_port[0] != item["id"]:
                changed.add(port["id"])
                continue
            old = previous_port[1]
            if old.get("type") != port.get("type"):
                changed.add(port["id"])
            elif _vec_changed(old.get("local_position"), port.get("local_position")):
                changed.add(port["id"])
            elif _vec_changed(old.get("local_direction"), port.get("local_direction")):
                changed.add(port["id"])
    return changed
