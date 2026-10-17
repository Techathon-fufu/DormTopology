"""Save confirmed snapshots, plan organization, and atomically accept valid plans."""

import copy
import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

from ..domain.errors import SceneInputError
from ..domain.geometry import fits_region, items_overlap
from ..domain.models import Scene
from ..domain.packing import measure_free_area, plan_packing, validate_layout
from ..domain.packing.check import item_geometry_issues
from ..domain.rules import validate_scene
from .errors import Conflict, InvalidInput, NotFound
from .ports import JobExecutor, OrganizationRepository, SceneRecord

ALGORITHM_VERSION = "packing-1.1"
logger = logging.getLogger(__name__)


def _clone_scene(value: dict) -> Scene:
    if not isinstance(value, dict):
        raise InvalidInput("Scene must be an object", field="scene")
    try:
        return json.loads(json.dumps(value, allow_nan=False))
    except (ValueError, TypeError, OverflowError) as error:
        raise InvalidInput(
            "Scene must contain finite JSON values", field="scene"
        ) from error


def _canonical_scene(
    value: dict, scene_id: str, baseline_id: str, revision: int
) -> Scene:
    scene = _clone_scene(value)
    scene.update(scene_id=scene_id, baseline_id=baseline_id, scene_revision=revision)
    validate_scene(scene)
    return scene


def _validate_baseline(scene: Scene) -> None:
    # Snapshot confirmation is independent of layout feasibility.
    for index, item in enumerate(scene["items"]):
        if not item["dimensions_confirmed"]:
            raise InvalidInput(
                "Confirm all baseline dimensions",
                field=f"baseline.items[{index}].dimensions_confirmed",
            )
    ports = {port["id"]: port for item in scene["items"] for port in item["ports"]}
    for cable in scene["cables"]:
        if any(
            not ports[cable[key]]["confirmed"]
            for key in ("start_port_id", "end_port_id")
        ):
            raise InvalidInput(
                "Confirm all connected baseline ports", field="baseline.cables"
            )


def _same_pose(item: dict, placement: dict) -> bool:
    return (
        item["position"] == placement["target_pos"]
        and item["rotation_y_rad"] == placement["target_rotation_y_rad"]
    )


def _apply_targets(scene: Scene, result: dict) -> Scene:
    if (
        result.get("scene_id") != scene["scene_id"]
        or result.get("scene_revision") != scene["scene_revision"]
        or result.get("schema_version") != scene["schema_version"]
    ):
        raise Conflict("Plan does not match its input scene and revision")
    if result.get("status") not in ("success", "partial"):
        raise Conflict("An infeasible plan cannot be applied")
    placements = result.get("items")
    if not isinstance(placements, list) or any(
        not isinstance(p, dict) for p in placements
    ):
        raise InvalidInput("Plan item list is malformed")
    original_ids = {item["id"] for item in scene["items"]}
    plan_ids = [placement.get("item_id") for placement in placements]
    if len(plan_ids) != len(original_ids) or any(
        not isinstance(identifier, str) for identifier in plan_ids
    ):
        raise InvalidInput("Plan must cover every scene item exactly once")
    if set(plan_ids) != original_ids or len(set(plan_ids)) != len(plan_ids):
        raise InvalidInput("Plan must cover every scene item exactly once")
    by_id = {placement["item_id"]: placement for placement in placements}
    candidate = copy.deepcopy(scene)
    has_unplaced = False
    for item in candidate["items"]:
        placement = by_id[item["id"]]
        status = placement.get("placement_status")
        if status not in ("placed", "unchanged", "unplaced"):
            raise InvalidInput("Unknown placement status")
        if "target_pos" not in placement or "target_rotation_y_rad" not in placement:
            raise InvalidInput("Plan target transform is required")
        if (item["fixed"] or status in ("unchanged", "unplaced")) and not _same_pose(
            item, placement
        ):
            raise InvalidInput(
                "Fixed, unchanged, and unplaced items must retain their pose"
            )
        has_unplaced |= status == "unplaced"
        item["position"] = copy.deepcopy(placement["target_pos"])
        item["rotation_y_rad"] = placement["target_rotation_y_rad"]
    validate_scene(candidate)
    regions = {region["id"]: region for region in candidate["regions"]}
    for item in candidate["items"]:
        placement = by_id[item["id"]]
        if not item["fixed"] and placement["placement_status"] != "unplaced":
            region_id = placement.get("target_region_id")
            if (
                region_id not in item["allowed_region_ids"]
                or region_id not in regions
                or not fits_region(item, regions[region_id])
                or (
                    placement["placement_status"] == "placed"
                    and item["rotation_y_rad"] not in item["allowed_rotations_y_rad"]
                )
            ):
                raise InvalidInput(
                    "A placed target violates region or orientation constraints"
                )
    check = validate_layout(candidate)
    if not check["geometry_valid"]:
        raise Conflict("The proposed layout fails the final geometry check")
    if result["status"] == "success" and has_unplaced:
        raise InvalidInput("A success result cannot contain unplaced items")
    return candidate


def _area_comparable(baseline: Scene, current: Scene) -> bool:
    def signature(scene):
        return (
            {
                item["id"]: (item["size_m"], item["collision"])
                for item in scene["items"]
            },
            scene["desk"],
            sorted(scene["reserved_zones"], key=lambda zone: zone["id"]),
        )

    return signature(baseline) == signature(current)


class OrganizationService:
    def __init__(self, repository: OrganizationRepository, executor: JobExecutor):
        self.repository = repository
        self.executor = executor

    def save_scene(
        self,
        project_id: str,
        scene: dict,
        expected_revision: int | None,
        baseline_source_id: str,
        baseline: dict | None = None,
    ) -> Scene:
        if not isinstance(project_id, str) or not project_id.strip():
            raise InvalidInput("project_id is required")
        if not isinstance(baseline_source_id, str) or not baseline_source_id.strip():
            raise InvalidInput("baseline_source_id is required")
        if expected_revision is not None and (
            type(expected_revision) is not int or expected_revision < 1
        ):
            raise InvalidInput("expected_revision must be null or a positive integer")
        current = self.repository.get_project(project_id)
        if (current is None) != (expected_revision is None):
            raise Conflict(
                "Use null for initial creation or the current revision for edits"
            )
        if current and current.scene["scene_revision"] != expected_revision:
            raise Conflict("Scene revision changed; reload before saving")
        new_baseline = (
            current is None or current.baseline_source_id != baseline_source_id
        )
        if new_baseline and baseline is None:
            raise InvalidInput(
                "A complete baseline is required for a new baseline source",
                field="baseline",
            )
        scene_id = current.scene["scene_id"] if current else f"scene_{uuid4().hex}"
        baseline_id = (
            f"baseline_{uuid4().hex}" if new_baseline else current.scene["baseline_id"]
        )
        revision = expected_revision or 1
        canonical = _canonical_scene(scene, scene_id, baseline_id, revision)
        if current:
            appearances = {item["id"]: item for item in current.scene["items"]}
            for item in canonical["items"]:
                old = appearances.get(item["id"])
                if old is not None:
                    # Client geometry drafts cannot roll back persisted generation state.
                    item["model_url"] = old["model_url"]
                    item["generation"] = copy.deepcopy(old["generation"])
            if canonical != current.scene or new_baseline:
                canonical["scene_revision"] += 1
        snapshot = None
        if new_baseline:
            snapshot = _canonical_scene(
                baseline, scene_id, baseline_id, canonical["scene_revision"]
            )
            _validate_baseline(snapshot)
        self.repository.save_scene(
            SceneRecord(project_id, canonical, baseline_source_id),
            expected_revision,
            snapshot,
        )
        return canonical

    def get_scene(self, scene_id: str) -> Scene:
        record = self.repository.get_scene(scene_id)
        if record is None:
            raise NotFound("Scene not found")
        return record.scene

    def get_project_scene(self, project_id: str) -> Scene:
        record = self.repository.get_project(project_id)
        if record is None:
            raise NotFound("Project scene not found")
        return record.scene

    def get_project_scene_state(self, project_id: str) -> dict:
        record = self.repository.get_project(project_id)
        if record is None:
            raise NotFound("Project scene not found")
        return {
            "scene": record.scene,
            "baseline_source_id": record.baseline_source_id,
        }

    def submit(self, scene_id: str, scene_revision: int) -> dict:
        scene = self.get_scene(scene_id)
        if scene["scene_revision"] != scene_revision:
            raise Conflict("Scene revision changed before task submission")
        validate_scene(scene, for_planning=True)
        now = datetime.now(timezone.utc).isoformat()
        envelope = {
            "job_id": f"job_{uuid4().hex}",
            "kind": "organization",
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
            result = plan_packing(scene)
            target = (
                scene
                if result["status"] == "infeasible"
                else _apply_targets(scene, result)
            )
            baseline = self.repository.get_baseline(scene["baseline_id"])
            comparable = baseline is not None and _area_comparable(baseline, scene)
            result["metrics"] = {
                "desk_free_before": measure_free_area(baseline) if comparable else None,
                "desk_free_after": measure_free_area(target),
                "overlap_count": sum(
                    items_overlap(a, b)
                    for index, a in enumerate(target["items"])
                    for b in target["items"][index + 1 :]
                ),
                "out_of_bounds_count": sum(
                    any(
                        issue["code"] == "no_space"
                        for issue in item_geometry_issues(target, item)
                    )
                    for item in target["items"]
                ),
            }
            if not comparable:
                result["comparison_note"] = (
                    "Item dimensions or collision geometry, desktop, or reserved zones "
                    "differ from the original baseline"
                )
            result["algorithm_version"] = ALGORITHM_VERSION
            self.repository.finish_job(job_id, result=result)
        except (SceneInputError, InvalidInput, Conflict) as error:
            self.repository.finish_job(
                job_id, error={"code": error.code, "message": str(error)}
            )
        except Exception:
            logger.exception("Organization task %s failed", job_id)
            self.repository.finish_job(
                job_id,
                error={"code": "internal_error", "message": "Organization task failed"},
            )

    def get_job(self, job_id: str) -> dict:
        job = self.repository.get_job(job_id)
        if job is None:
            raise NotFound("Job not found")
        return job

    def cancel_job(self, job_id: str) -> dict:
        return self.repository.cancel_job(job_id)

    def apply_job(self, job_id: str, scene_id: str, scene_revision: int) -> Scene:
        job = self.get_job(job_id)
        if (
            job["status"] != "succeeded"
            or job.get("applied")
            or job["scene_id"] != scene_id
            or job["scene_revision"] != scene_revision
        ):
            raise Conflict("Plan is unavailable, stale, or already applied")
        scene = self.get_scene(scene_id)
        if scene["scene_revision"] != scene_revision:
            raise Conflict("Scene revision changed before applying the plan")
        candidate = _apply_targets(scene, job["result"])
        candidate["scene_revision"] = scene_revision + 1
        self.repository.apply_job(job_id, candidate, scene_revision)
        return candidate
