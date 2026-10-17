"""One deterministic greedy layout, followed by complete-scene verification."""

import math
from itertools import product

from ..geometry import (
    EPSILON,
    aabb_from_item,
    aabb_from_zone,
    fits_region,
    items_overlap,
    pose_extent,
    support_region,
    validate_item_geometry,
)
from ..models import PackingResult, Scene
from ..rules import validate_scene
from .area import DesktopGrid
from .check import WALL_CATEGORIES, check_layout, issue, item_geometry_issues

MAX_CANDIDATES_PER_REGION_ROTATION = 128
FREQUENCY_WEIGHT = {"high": 3.0, "medium": 1.0, "low": 0.2}


def _pose(item: dict, position, angle: float) -> dict:
    return {**item, "position": list(position), "rotation_y_rad": angle}


def _same_pose(a: dict, b: dict) -> bool:
    return a["position"] == b["position"] and a["rotation_y_rad"] == b["rotation_y_rad"]


def _move_cost(original: dict, candidate: dict) -> float:
    return math.dist(original["position"], candidate["position"])


def _access_cost(scene: Scene, item: dict) -> float:
    desk = scene["desk"]
    x, y, z = item["position"]
    return (
        abs(x - desk["width_m"] / 2)
        + abs(z - desk["depth_m"])
        + abs(y - desk["top_height_m"])
    ) * FREQUENCY_WEIGHT[item["usage_frequency"]]


def _candidates(scene: Scene, original: dict, region: dict, placed: list[dict]):
    x0, x1, z0, z1 = region["bounds_xz_m"]
    y = region["surface_y_m"]
    blockers = [aabb_from_item(p) for p in placed]
    # Zone projections add useful edge anchors but never replace OBB collision checks.
    blockers.extend(
        aabb_from_zone(z) for key in ("obstacles", "reserved_zones") for z in scene[key]
    )
    height = pose_extent(original)[2]
    for angle in sorted(set(original["allowed_rotations_y_rad"])):
        # Measure at XZ origin so all four bounds retain their anchor offsets.
        bounds = aabb_from_item(_pose(original, (0, y, 0), angle))
        xmin, xmax = x0 - bounds.minimum[0], x1 - bounds.maximum[0]
        zmin, zmax = z0 - bounds.minimum[2], z1 - bounds.maximum[2]
        if xmin > xmax + 1e-10 or zmin > zmax + 1e-10:
            continue
        if height > region["clearance_height_m"] + 1e-10:
            continue
        xs = {
            xmin,
            xmax,
            (xmin + xmax) / 2,
            min(xmax, max(xmin, original["position"][0])),
        }
        zs = {
            zmin,
            zmax,
            (zmin + zmax) / 2,
            min(zmax, max(zmin, original["position"][2])),
        }
        for box in blockers:
            if (
                min(bounds.maximum[1], box.maximum[1])
                <= max(bounds.minimum[1], box.minimum[1]) + 1e-10
            ):
                continue
            xs.update((
                box.minimum[0] - bounds.maximum[0] - EPSILON,
                box.maximum[0] - bounds.minimum[0] + EPSILON,
            ))
            zs.update((
                box.minimum[2] - bounds.maximum[2] - EPSILON,
                box.maximum[2] - bounds.minimum[2] + EPSILON,
            ))
        candidates = []
        for x, z in product(sorted(xs), sorted(zs)):
            if x < xmin - 1e-10 or x > xmax + 1e-10:
                continue
            if z < zmin - 1e-10 or z > zmax + 1e-10:
                continue
            candidate = _pose(original, (x, y, z), angle)
            try:
                validate_item_geometry(candidate)
            except (OverflowError, ValueError):
                continue
            if (
                fits_region(candidate, region)
                and not item_geometry_issues(scene, candidate)
                and not any(items_overlap(candidate, p) for p in placed)
            ):
                candidates.append(candidate)
        # Bound expensive area scoring; retain edge-first, stable candidates.
        candidates.sort(
            key=lambda p: (
                -(
                    abs(p["position"][0] - (x0 + x1) / 2)
                    + abs(p["position"][2] - (z0 + z1) / 2)
                ),
                _move_cost(original, p),
                p["position"],
            )
        )
        yield from candidates[:MAX_CANDIDATES_PER_REGION_ROTATION]


def _choose(
    scene: Scene, original: dict, placed: list[dict], grid: DesktopGrid
) -> dict | None:
    choices = []
    allowed = set(original["allowed_region_ids"])
    preferred = set(original.get("preferred_region_ids", []))
    preferred_regions = [region for region in scene["regions"] if region["id"] in preferred]
    if (
        any(r["id"] in allowed and fits_region(original, r) for r in scene["regions"])
        and not item_geometry_issues(scene, original)
        and not any(items_overlap(original, p) for p in placed)
    ):
        choices.append(original)
    for region in sorted(scene["regions"], key=lambda r: r["id"]):
        if region["id"] in allowed:
            choices.extend(_candidates(scene, original, region, placed))
    occupied = grid.occupied(placed)
    scored = []
    for candidate in choices:
        free_cells = grid.largest_component(occupied | grid.item_mask(candidate))
        move = _move_cost(original, candidate)
        cost = (
            _access_cost(scene, candidate)
            + 0.1 * move
            + 0.01 * (candidate["rotation_y_rad"] != original["rotation_y_rad"])
        )
        scored.append(
            (
                (
                    int(bool(preferred_regions) and not any(
                        fits_region(candidate, region) for region in preferred_regions
                    )),
                    -free_cells,
                    cost,
                    move,
                    candidate["rotation_y_rad"],
                    tuple(candidate["position"]),
                ),
                candidate,
            )
        )
    return min(scored, key=lambda row: row[0])[1] if scored else None


def _region_id(scene: Scene, item: dict, *, target: bool = False) -> str | None:
    if item["category"] in WALL_CATEGORIES:
        return None
    regions = scene["regions"]
    if target:
        regions = [r for r in regions if r["id"] in item["allowed_region_ids"]]
    return support_region(item, regions)


def plan_packing(scene: Scene) -> PackingResult:
    """Suggest transforms only; accepting/versioning a plan belongs to service.

    No global optimum is promised. Failed items remain at their input pose;
    earlier moves that conflict with these retained poses are rolled back.
    """
    validate_scene(scene, for_planning=True)
    originals = {item["id"]: item for item in scene["items"]}
    poses = {item["id"]: item for item in scene["items"] if item["fixed"]}
    failures: dict[str, str] = {}
    grid = DesktopGrid(scene)
    movable = sorted(
        (i for i in scene["items"] if not i["fixed"]),
        key=lambda i: (
            -i.get("placement_priority", 0),
            len(set(i["allowed_region_ids"])),
            -i["size_m"][0] * i["size_m"][2],
            -FREQUENCY_WEIGHT[i["usage_frequency"]],
            i["id"],
        ),
    )
    for original in movable:
        chosen = _choose(scene, original, list(poses.values()), grid)
        if chosen is None:
            chosen = original
            failures[original["id"]] = (
                "No tested target satisfies region, clearance, obstacle and item constraints"
            )
        poses[original["id"]] = chosen

    # Rollback is monotone: each iteration retains another input pose, so chains terminate.
    while True:
        reverted = False
        retained = [p for key, p in poses.items() if _same_pose(p, originals[key])]
        for key, candidate in list(poses.items()):
            if _same_pose(candidate, originals[key]):
                continue
            if any(p["id"] != key and items_overlap(candidate, p) for p in retained):
                poses[key] = originals[key]
                failures[key] = (
                    "Move rolled back because an item retained at its input pose occupies the target"
                )
                reverted = True
        if not reverted:
            break

    draft = {**scene, "items": [poses[item["id"]] for item in scene["items"]]}
    check = check_layout(draft)
    infeasible = not check["geometry_valid"]
    if infeasible:
        poses = originals
        check = check_layout(scene)
        for item in movable:
            failures.setdefault(
                item["id"],
                "No complete geometry-valid layout found; all moves were discarded",
            )

    # A rollback can restore an already-satisfied target. Report it as unchanged.
    for key in list(failures):
        candidate = poses[key]
        if (
            _region_id(scene, candidate, target=True) is not None
            and not item_geometry_issues(scene, candidate)
            and not any(
                key != other and items_overlap(candidate, p)
                for other, p in poses.items()
            )
        ):
            del failures[key]

    result_items = []
    for original in scene["items"]:
        key = original["id"]
        target = poses[key]
        failed = key in failures
        placement_status = (
            "unplaced"
            if failed
            else "unchanged"
            if _same_pose(original, target)
            else "placed"
        )
        result_items.append(
            {
                "item_id": key,
                "name": original["name"],
                "model_url": original["model_url"],
                "current_pos": list(original["position"]),
                "target_pos": list(target["position"]),
                "target_rotation_y_rad": target["rotation_y_rad"],
                "target_region_id": _region_id(
                    scene, target, target=not failed and not original["fixed"]
                ),
                "placement_status": placement_status,
                "reason_code": "no_space" if failed else None,
            }
        )
    problems = list(check["issues"])
    problems.extend(
        issue(key, "no_space", message) for key, message in sorted(failures.items())
    )
    return {
        "schema_version": scene["schema_version"],
        "scene_id": scene["scene_id"],
        "scene_revision": scene["scene_revision"],
        "status": "infeasible" if infeasible else "partial" if failures else "success",
        "items": result_items,
        "issues": problems,
    }
