"""Plan every cable against an immutable, versioned scene snapshot."""

import logging
from datetime import datetime, timezone
from uuid import uuid4

from ..domain.errors import SceneInputError
from ..domain.models import Scene
from ..domain.routing import plan_routing, validate_scene
from .errors import Conflict, InvalidInput, NotFound
from .ports import JobExecutor, OrganizationRepository

ALGORITHM_VERSION = "routing-1.1"
logger = logging.getLogger(__name__)


class RoutingService:
    def __init__(self, repository: OrganizationRepository, executor: JobExecutor):
        self.repository = repository
        self.executor = executor

    def submit(
        self,
        scene_id: str,
        scene_revision: int,
        target_ids: list[str] | None = None,
    ) -> dict:
        if type(scene_revision) is not int or scene_revision < 1:
            raise InvalidInput("scene_revision must be a positive integer")
        record = self.repository.get_scene(scene_id)
        if record is None:
            raise NotFound("Scene not found")
        scene = record.scene
        if scene["scene_revision"] != scene_revision:
            raise Conflict("Scene revision changed before task submission")
        if target_ids is not None:
            if (
                not isinstance(target_ids, list)
                or not target_ids
                or any(not isinstance(value, str) or not value for value in target_ids)
                or len(set(target_ids)) != len(target_ids)
            ):
                raise InvalidInput(
                    "target_ids must contain unique cable IDs", field="target_ids"
                )
            available = {cable["id"] for cable in scene["cables"]}
            if not set(target_ids) <= available:
                raise InvalidInput(
                    "target_ids references an unknown cable", field="target_ids"
                )
        validate_scene(scene)
        now = datetime.now(timezone.utc).isoformat()
        envelope = {
            "job_id": f"job_{uuid4().hex}",
            "kind": "cable",
            "status": "queued",
            "scene_id": scene_id,
            "scene_revision": scene_revision,
            "created_at": now,
            "updated_at": now,
            "stage": "Queued",
            "algorithm_version": ALGORITHM_VERSION,
            "cancellable": True,
            "result": None,
            "error": None,
            "applied": False,
            # Targeted actions still verify shared capacity and geometry for all cables.
            "target_ids": target_ids,
        }
        self.executor.reserve()
        try:
            self.repository.create_job(envelope, scene)
            self.executor.submit(lambda: self._run_job(envelope["job_id"], scene))
        except BaseException:
            self.executor.release()
            self.repository.finish_job(
                envelope["job_id"],
                error={"code": "submission_failed", "message": "Task could not start"},
            )
            raise
        return {"job_id": envelope["job_id"], "status": "queued", "created_at": now}

    def _run_job(self, job_id: str, scene: Scene) -> None:
        if not self.repository.claim_job(job_id):
            return
        try:
            result = plan_routing(scene)
            result["algorithm_version"] = ALGORITHM_VERSION
            self.repository.finish_job(job_id, result=result)
        except (SceneInputError, InvalidInput, Conflict) as error:
            self.repository.finish_job(
                job_id, error={"code": error.code, "message": str(error)}
            )
        except Exception:
            logger.exception("Routing task %s failed", job_id)
            self.repository.finish_job(
                job_id,
                error={"code": "internal_error", "message": "Routing task failed"},
            )
