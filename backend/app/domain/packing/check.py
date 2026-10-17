"""Geometry validity is independent of whether storage goals were achieved."""

from itertools import combinations

from ..geometry import (
    EPSILON,
    NUMERIC_EPSILON,
    aabb_from_item,
    aabb_from_zone,
    fits_region,
    item_intersects_box,
    items_overlap,
)
from ..models import Issue, LayoutCheck, Scene
from ..plug_mounts import plug_mount_geometry_issues
from ..rules import validate_scene

WALL_CATEGORIES = {"wall_socket", "wall_network"}


def issue(entity_id: str | None, code: str, message: str) -> Issue:
    return {"entity_id": entity_id, "code": code, "message": message}


def legal_regions(scene: Scene, item: dict) -> list[dict]:
    return [region for region in scene["regions"] if fits_region(item, region)]


def item_geometry_issues(scene: Scene, item: dict) -> list[Issue]:
    problems = []
    if item["category"] in WALL_CATEGORIES:
        x, y, z = item["position"]
        w, h, _ = item["size_m"]
        x0, x1, y0, y1 = scene["wall"]["bounds_xy_m"]
        if (
            not item["fixed"]
            or item["rotation_y_rad"] != 0
            or item["allowed_region_ids"]
            or abs(z - scene["wall"]["z_m"]) > EPSILON
            or x - w / 2 < x0 - EPSILON
            or x + w / 2 > x1 + EPSILON
            or y < y0 - EPSILON
            or y + h > y1 + EPSILON
        ):
            problems.append(
                issue(
                    item["id"],
                    "no_space",
                    "Wall panel violates its fixed wall bounds or pose",
                )
            )
    elif "plug_mount" in item:
        problems.extend(plug_mount_geometry_issues(scene, item))
    elif not legal_regions(scene, item):
        problems.append(
            issue(
                item["id"],
                "no_space",
                "No full support region satisfies bounds and clearance height",
            )
        )
    bounds = aabb_from_item(item)
    for key in ("obstacles", "reserved_zones"):
        for zone in scene[key]:
            box = aabb_from_zone(zone)
            if any(
                min(bounds.maximum[i], box.maximum[i])
                - max(bounds.minimum[i], box.minimum[i]) <= NUMERIC_EPSILON
                for i in range(3)
            ):
                continue
            if item_intersects_box(item, box):
                problems.append(
                    issue(item["id"], "collision", f"Intersects {key} {zone['id']}")
                )
    return problems


def check_layout(scene: Scene) -> LayoutCheck:
    """Internal validated-input check, also used during final plan verification."""
    problems = []
    for item in scene["items"]:
        problems.extend(item_geometry_issues(scene, item))
    for a, b in combinations(scene["items"], 2):
        if items_overlap(a, b):
            problems.extend(
                (
                    issue(a["id"], "collision", f"Overlaps item {b['id']}"),
                    issue(b["id"], "collision", f"Overlaps item {a['id']}"),
                )
            )
    geometry_valid = not problems
    for item in scene["items"]:
        if not item["fixed"] and not any(
            r["id"] in item["allowed_region_ids"] for r in legal_regions(scene, item)
        ):
            problems.append(
                issue(item["id"], "no_space", "Storage target has not been reached")
            )
    return {"geometry_valid": geometry_valid, "issues": problems}


def validate_layout(scene: Scene) -> LayoutCheck:
    """Recheck current or manually edited geometry without requiring a baseline."""
    validate_scene(scene)
    return check_layout(scene)
