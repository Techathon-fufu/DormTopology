"""Bounded soft policies and deterministic scores for organization trials.

These helpers never persist scenes or trust a provider to evaluate its own plan.
Trial results must first be applied and validated against the original scene by
the organization service.
"""

from __future__ import annotations

import copy
import math

from ..domain.geometry import fits_region
from ..domain.models import Scene
from ..domain.packing import measure_free_area
from ..domain.packing.area import GRID_CELL_M


class StrategyValidationError(ValueError):
    """The provider returned an invalid strategy envelope."""


def build_summary(scene: Scene, baseline_result: dict, baseline_target: Scene) -> dict:
    """Expose only the fields needed to suggest a soft policy, with no aliases."""
    summary = {
        "items": [
            {
                "id": item["id"],
                "category": item["category"],
                "size_m": item["size_m"],
                "position": item["position"],
                "usage_frequency": item["usage_frequency"],
                "placement_priority": item.get("placement_priority", 0),
                "allowed_region_ids": item["allowed_region_ids"],
                "preferred_region_ids": item.get("preferred_region_ids", []),
                "fixed": item["fixed"],
            }
            for item in scene["items"]
        ],
        "regions": [
            {
                key: region[key]
                for key in (
                    "id", "surface_y_m", "bounds_xz_m", "clearance_height_m"
                )
            }
            for region in scene["regions"]
        ],
        "fixed_item_ids": [item["id"] for item in scene["items"] if item["fixed"]],
        "reserved_zones": [
            {key: zone[key] for key in ("id", "min", "max")}
            for zone in scene["reserved_zones"]
        ],
        "baseline": {
            "status": baseline_result["status"],
            "unplaced_item_ids": [
                item["item_id"]
                for item in baseline_result["items"]
                if item["placement_status"] == "unplaced"
            ],
            "issues": [
                {key: issue[key] for key in ("entity_id", "code", "message")}
                for issue in baseline_result["issues"]
            ],
            "desk_free_area_m2": measure_free_area(baseline_target),
        },
    }
    # A provider may mutate any of the nested data handed to it.
    return copy.deepcopy(summary)


def _candidate_scene(scene: Scene, candidate: object) -> Scene | None:
    if type(candidate) is not dict or set(candidate) != {"items"}:
        return None
    patches = candidate["items"]
    if type(patches) is not list or not patches:
        return None
    originals = {item["id"]: item for item in scene["items"]}
    if len(patches) > len(originals):
        return None
    priorities = {
        item_id: item.get("placement_priority", 0)
        for item_id, item in originals.items()
    }
    changes: dict[str, dict] = {}
    seen: set[str] = set()
    for patch in patches:
        if (
            type(patch) is not dict
            or "item_id" not in patch
            or not set(patch) <= {
                "item_id", "placement_priority", "preferred_region_ids"
            }
            or len(patch) == 1
        ):
            return None
        item_id = patch["item_id"]
        if type(item_id) is not str or item_id not in originals or item_id in seen:
            return None
        seen.add(item_id)
        original = originals[item_id]
        if original["fixed"]:
            return None
        update = {}
        if "placement_priority" in patch:
            priority = patch["placement_priority"]
            if type(priority) is not int or not 0 <= priority <= 100:
                return None
            if priority != priorities[item_id]:
                update["placement_priority"] = priority
                priorities[item_id] = priority
        if "preferred_region_ids" in patch:
            preferred = patch["preferred_region_ids"]
            if type(preferred) is not list or any(type(v) is not str for v in preferred):
                return None
            selected = set(preferred)
            if len(selected) != len(preferred):
                return None
            old_preferred = set(original.get("preferred_region_ids", []))
            if not selected <= set(original["allowed_region_ids"]):
                return None
            if old_preferred and (not selected or not selected <= old_preferred):
                return None
            if selected != old_preferred:
                update["preferred_region_ids"] = list(preferred)
        if update:
            changes[item_id] = update

    # Compare every original priority tier, including unchanged and fixed items.
    # Splitting a tie is allowed; merging or reversing distinct tiers is not.
    tiers: dict[int, list[int]] = {}
    for item_id, original in originals.items():
        tiers.setdefault(original.get("placement_priority", 0), []).append(
            priorities[item_id]
        )
    preceding_max = -1
    for original_priority in sorted(tiers):
        values = tiers[original_priority]
        if min(values) <= preceding_max:
            return None
        preceding_max = max(values)
    if not changes:
        return None
    trial = copy.deepcopy(scene)
    for item in trial["items"]:
        item.update(changes.get(item["id"], {}))
    return trial


def candidate_scenes(scene: Scene, proposal: dict) -> list[Scene]:
    """Reject an invalid envelope or candidate without repairing provider data."""
    if type(proposal) is not dict or set(proposal) != {"candidates"}:
        raise StrategyValidationError("Strategy must contain only candidates")
    candidates = proposal["candidates"]
    if type(candidates) is not list or len(candidates) > 2:
        raise StrategyValidationError("Strategy must contain at most two candidates")
    trials = []
    for candidate in candidates:
        trial = _candidate_scene(scene, candidate)
        if trial is not None:
            trials.append(trial)
    return trials


def score_plan(original_scene: Scene, result: dict, target: Scene) -> tuple[int, int, int, float]:
    """Rank a validated plan against original goals; smaller is strictly better."""
    target_items = {item["id"]: item for item in target["items"]}
    regions = {region["id"]: region for region in original_scene["regions"]}
    violations = sum(
        bool(item.get("preferred_region_ids"))
        and not any(
            fits_region(target_items[item["id"]], regions[region_id])
            for region_id in item["preferred_region_ids"]
        )
        for item in original_scene["items"]
    )
    free_cells = round(measure_free_area(target) / GRID_CELL_M**2)
    movement = math.fsum(
        math.dist(item["position"], target_items[item["id"]]["position"])
        for item in original_scene["items"]
    )
    return (
        sum(item["placement_status"] == "unplaced" for item in result["items"]),
        violations,
        -free_cells,
        movement,
    )
