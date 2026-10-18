"""One deterministic greedy layout, followed by complete-scene verification."""

import math

from ..book_pose import BOOK_CATEGORIES, upright
from itertools import product

from ..geometry import (
    AABB,
    EPSILON,
    aabb_from_item,
    aabb_from_zone,
    add,
    direction_to_world,
    fits_region,
    local_to_world,
    normalize,
    pose_extent,
    scale,
    support_region,
    validate_item_geometry,
)
from ..geometry.convex import bounds, segment_hits, world_parts
from ..models import PackingResult, Scene
from ..rules import validate_scene
from .area import DesktopGrid
from .check import WALL_CATEGORIES, check_layout, issue, item_geometry_issues
from .spacing import item_conflicts

MAX_CANDIDATES_PER_REGION_ROTATION = 128
FREQUENCY_WEIGHT = {"high": 3.0, "medium": 1.0, "low": 0.2}
PORT_LEADOUT_M = 0.025
PORT_CLEARANCE_M = 0.005


def _pose(item: dict, position, angle: float) -> dict:
    return {**item, "position": list(position), "rotation_y_rad": angle}


def _same_pose(a: dict, b: dict) -> bool:
    return (a["position"] == b["position"] and a["rotation_y_rad"] == b["rotation_y_rad"]
            and a.get("book_pose", "original") == b.get("book_pose", "original"))


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


def _port_leadouts(item: dict):
    for port in item.get("ports", []):
        start = local_to_world(item, port["local_position"])
        direction = normalize(direction_to_world(item, port["local_direction"]))
        yield start, add(start, scale(direction, PORT_LEADOUT_M))


def _port_geometry(item: dict):
    parts = world_parts(item)
    low, high = bounds(tuple(vertex for part in parts for vertex in part[0]))
    return AABB(low, high), parts


def _leadout_hits(start, end, geometry):
    box, parts = geometry
    if any(max(start[i], end[i]) + PORT_CLEARANCE_M < box.minimum[i]
           or min(start[i], end[i]) - PORT_CLEARANCE_M > box.maximum[i]
           for i in range(3)):
        return False
    return segment_hits(start, end, parts, PORT_CLEARANCE_M)


def _port_access_cost(candidate: dict, placed_geometry, placed_leadouts) -> int:
    # A soft preference preserves real connector access without inventing solid volumes.
    candidate_geometry = _port_geometry(candidate)
    own_blocked = sum(any(_leadout_hits(start, end, geometry) for geometry in placed_geometry)
                      for start, end in _port_leadouts(candidate))
    other_blocked = sum(_leadout_hits(start, end, candidate_geometry)
                        for start, end in placed_leadouts)
    return own_blocked + other_blocked


def _candidates(scene: Scene, original: dict, region: dict, placed: list[dict]):
    x0, x1, z0, z1 = region["bounds_xz_m"]
    y = region["surface_y_m"]
    gap = scene.get("constraints", {}).get("min_item_gap_m", 0)
    blockers = [(aabb_from_item(p), gap) for p in placed]
    # Zone projections add useful edge anchors but never replace OBB collision checks.
    blockers.extend(
        (aabb_from_zone(z), 0) for key in ("obstacles", "reserved_zones") for z in scene[key]
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
        for box, padding in blockers:
            if (
                min(bounds.maximum[1], box.maximum[1])
                <= max(bounds.minimum[1], box.minimum[1]) + 1e-10
            ):
                continue
            clearance = padding if padding > 0 else EPSILON
            xs.update((
                box.minimum[0] - bounds.maximum[0] - clearance,
                box.maximum[0] - bounds.minimum[0] + clearance,
            ))
            zs.update((
                box.minimum[2] - bounds.maximum[2] - clearance,
                box.maximum[2] - bounds.minimum[2] + clearance,
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
                and not any(item_conflicts(scene, candidate, p) for p in placed)
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
        original["rotation_y_rad"] in original["allowed_rotations_y_rad"]
        and any(r["id"] in allowed and fits_region(original, r) for r in scene["regions"])
        and not item_geometry_issues(scene, original)
        and not any(item_conflicts(scene, original, p) for p in placed)
    ):
        choices.append(original)
    for region in sorted(scene["regions"], key=lambda r: r["id"]):
        if region["id"] in allowed:
            variants = ([{**original, "book_pose": pose} for pose in ("upright", "flat")]
                        if original["category"] in BOOK_CATEGORIES else [original])
            for variant in variants:
                choices.extend(_candidates(scene, variant, region, placed))
    # Posture is ranked ahead of all soft costs; avoid scoring flat alternatives
    # after any fully geometry-valid upright candidate has been found.
    if original["category"] in BOOK_CATEGORIES:
        standing = [candidate for candidate in choices if upright(candidate)]
        if standing:
            choices = standing
    occupied = grid.occupied(placed)
    placed_geometry = [_port_geometry(item) for item in placed]
    # Furniture can block a low rear connector even when the device body fits.
    for obstacle in scene['obstacles']:
        low, high = obstacle['min'], obstacle['max']
        size = [high[i] - low[i] for i in range(3)]
        placed_geometry.append(_port_geometry({
            'position': [(low[0] + high[0]) / 2, low[1], (low[2] + high[2]) / 2],
            'rotation_y_rad': 0, 'size_m': size, 'collision': {'type': 'box'},
        }))
    placed_leadouts = [leadout for item in placed for leadout in _port_leadouts(item)]
    scored = []
    seen = set()
    for candidate in choices:
        pose_key = (tuple(candidate["position"]), candidate["rotation_y_rad"], candidate.get("book_pose", "original"))
        if pose_key in seen:
            continue
        seen.add(pose_key)
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
                    int(original["category"] in BOOK_CATEGORIES and not upright(candidate)),
                    int(bool(preferred_regions) and not any(
                        fits_region(candidate, region) for region in preferred_regions
                    )),
                    # Towers keep their front facing the user: within the
                    # preferred storage tier, translate before trying rotation.
                    int(original["category"] == "computerTower" and abs(math.remainder(
                        candidate["rotation_y_rad"] - original["rotation_y_rad"], 2 * math.pi
                    )) > 1e-8),
                    _port_access_cost(candidate, placed_geometry, placed_leadouts),
                    int(original["category"] in BOOK_CATEGORIES and upright(candidate)
                        and candidate["rotation_y_rad"] != (
                            math.pi / 2 if original["size_m"][1] < original["size_m"][2] else 0
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
    if item["category"] in WALL_CATEGORIES or "surface_mount" in item:
        return None
    regions = scene["regions"]
    if target:
        if item["rotation_y_rad"] not in item["allowed_rotations_y_rad"]:
            return None
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
                "No tested target satisfies region, clearance, obstacle and item spacing constraints"
            )
        poses[original["id"]] = chosen

    # Rollback is monotone: each iteration retains another input pose, so chains terminate.
    while True:
        reverted = False
        retained = [p for key, p in poses.items() if _same_pose(p, originals[key])]
        for key, candidate in list(poses.items()):
            if _same_pose(candidate, originals[key]):
                continue
            if any(p["id"] != key and item_conflicts(scene, candidate, p) for p in retained):
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
                key != other and item_conflicts(scene, candidate, p)
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
                **({"target_book_pose": target.get("book_pose", "original")}
                   if original["category"] in BOOK_CATEGORIES else {}),
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
