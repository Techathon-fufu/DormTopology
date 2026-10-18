"""Horizontal handling clearance between vertically overlapping item solids."""

import math
from functools import lru_cache

from ..geometry import NUMERIC_EPSILON, aabb_from_item, items_overlap
from ..geometry.convex import world_parts


def _mounted_pair(a: dict, b: dict) -> bool:
    for mounted, host in ((a, b), (b, a)):
        mount = mounted.get("plug_mount")
        if mount and any(
            port["id"] == mount["socket_port_id"] for port in host.get("ports", [])
        ):
            return True
    return False


def _projection(vertices):
    points = sorted({(vertex[0], vertex[2]) for vertex in vertices})

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    lower, upper = [], []
    for chain, source in ((lower, points), (upper, reversed(points))):
        for point in source:
            while len(chain) >= 2 and cross(chain[-2], chain[-1], point) <= 0:
                chain.pop()
            chain.append(point)
    return tuple(lower[:-1] + upper[:-1])


def _point_segment_distance(point, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dz)
    if length == 0:
        return math.dist(point, a)
    ux, uz = dx / length, dz / length
    along = min(length, max(0, (point[0] - a[0]) * ux + (point[1] - a[1]) * uz))
    return math.hypot(point[0] - a[0] - along * ux, point[1] - a[1] - along * uz)


def _polygon_distance(a, b):
    # Intersecting/contained projections have zero separation, including edge contact.
    separated = False
    for polygon in (a, b):
        for index, point in enumerate(polygon):
            other = polygon[(index + 1) % len(polygon)]
            nx, nz = -(other[1] - point[1]), other[0] - point[0]
            length = math.hypot(nx, nz)
            if length == 0:
                continue
            nx, nz = nx / length, nz / length
            pa = [x * nx + z * nz for x, z in a]
            pb = [x * nx + z * nz for x, z in b]
            if min(max(pa), max(pb)) < max(min(pa), min(pb)):
                separated = True
                break
        if separated:
            break
    if not separated:
        return 0.0
    return min(
        _point_segment_distance(point, polygon[index - 1], endpoint)
        for points, polygon in ((a, b), (b, a))
        for point in points
        for index, endpoint in enumerate(polygon)
    )


def _bounds_too_close(a_min, a_max, b_min, b_max, gap):
    if min(a_max[1], b_max[1]) - max(a_min[1], b_min[1]) <= NUMERIC_EPSILON:
        return False
    dx = max(a_min[0] - b_max[0], b_min[0] - a_max[0], 0)
    dz = max(a_min[2] - b_max[2], b_min[2] - a_max[2], 0)
    return math.hypot(dx, dz) < gap - NUMERIC_EPSILON


@lru_cache(maxsize=512)
def _projected_part(vertices):
    return (
        tuple(min(vertex[i] for vertex in vertices) for i in range(3)),
        tuple(max(vertex[i] for vertex in vertices) for i in range(3)),
        _projection(vertices),
    )


def _part_projections(parts):
    return (_projected_part(vertices) for vertices, _normals, _edges in parts)


def spacing_conflict(scene: dict, a: dict, b: dict) -> bool:
    gap = scene.get("constraints", {}).get("min_item_gap_m", 0)
    if gap <= 0 or _mounted_pair(a, b):
        return False
    a_box, b_box = aabb_from_item(a), aabb_from_item(b)
    if not _bounds_too_close(a_box.minimum, a_box.maximum, b_box.minimum, b_box.maximum, gap):
        return False
    for a_min, a_max, a_polygon in _part_projections(world_parts(a)):
        for b_min, b_max, b_polygon in _part_projections(world_parts(b)):
            if _bounds_too_close(a_min, a_max, b_min, b_max, gap) and (
                _polygon_distance(a_polygon, b_polygon) < gap - NUMERIC_EPSILON
            ):
                return True
    return False


def item_conflicts(scene: dict, a: dict, b: dict) -> bool:
    return items_overlap(a, b) or spacing_conflict(scene, a, b)
