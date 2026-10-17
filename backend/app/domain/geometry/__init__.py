"""Shared metre/Y-up/bottom-centre geometry for packing and cable routing."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

Point = tuple[float, float, float]
Footprint = tuple[tuple[float, float], ...]
EPSILON = 0.001
# Floating point noise only: physical penetration is not waived by EPSILON.
NUMERIC_EPSILON = 1e-10


def point(value: Sequence[float]) -> Point:
    if len(value) != 3:
        raise ValueError("point must contain three coordinates")
    return (float(value[0]), float(value[1]), float(value[2]))


def add(a: Point, b: Point) -> Point:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Point, b: Point) -> Point:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Point, factor: float) -> Point:
    return (a[0] * factor, a[1] * factor, a[2] * factor)


def dot(a: Point, b: Point) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def length(a: Point) -> float:
    return math.sqrt(dot(a, a))


def distance(a: Point, b: Point) -> float:
    return length(sub(a, b))


def normalize(a: Point) -> Point:
    magnitude = length(a)
    if magnitude <= 1e-12:
        raise ValueError("zero-length vector")
    return scale(a, 1.0 / magnitude)


def rotate_y(vector: Point, angle: float) -> Point:
    cosine, sine = math.cos(angle), math.sin(angle)
    return (
        cosine * vector[0] + sine * vector[2],
        vector[1],
        -sine * vector[0] + cosine * vector[2],
    )


def local_to_world(item: dict, local: Sequence[float]) -> Point:
    return add(
        point(item["position"]), rotate_y(point(local), item.get("rotation_y_rad", 0.0))
    )


def world_to_local(item: dict, world: Sequence[float]) -> Point:
    return rotate_y(
        sub(point(world), point(item["position"])), -item.get("rotation_y_rad", 0.0)
    )


def direction_to_world(item: dict, local: Sequence[float]) -> Point:
    return rotate_y(point(local), item.get("rotation_y_rad", 0.0))


def direction_to_local(item: dict, world: Sequence[float]) -> Point:
    return rotate_y(point(world), -item.get("rotation_y_rad", 0.0))


@dataclass(frozen=True)
class AABB:
    minimum: Point
    maximum: Point

    def inflated(self, amount: float) -> AABB:
        offset = (amount, amount, amount)
        return AABB(sub(self.minimum, offset), add(self.maximum, offset))


def footprint(item: dict) -> Footprint:
    width, _, depth = item["size_m"]
    corners = (
        (-width / 2, -depth / 2),
        (width / 2, -depth / 2),
        (width / 2, depth / 2),
        (-width / 2, depth / 2),
    )
    return tuple(
        (p[0], p[2]) for x, z in corners for p in (local_to_world(item, (x, 0, z)),)
    )


def aabb_from_item(item: dict) -> AABB:
    if item.get("collision", {}).get("type") == "compound":
        from .convex import world_parts, bounds
        minimum, maximum = bounds(tuple(v for p in world_parts(item) for v in p[0]))
        return AABB(minimum, maximum)
    corners = footprint(item)
    return AABB(
        (min(p[0] for p in corners), item["position"][1], min(p[1] for p in corners)),
        (
            max(p[0] for p in corners),
            item["position"][1] + item["size_m"][1],
            max(p[1] for p in corners),
        ),
    )


def aabb_from_zone(zone: dict) -> AABB:
    return AABB(point(zone["min"]), point(zone["max"]))


def pose_extent(item: dict) -> tuple[float, float, float]:
    """Unrotated collision half-sizes and vertical clearance extent.

    Footprint half-sizes describe the bounding box, not distances from the anchor
    to its edges. Candidate placement must retain actual min/max offsets when
    the collision geometry is asymmetric about the anchor.
    """
    if item.get("collision", {}).get("type") == "compound":
        from .convex import local_parts, bounds

        vertices = tuple(v for part in local_parts(item) for v in part[0])
        minimum, maximum = bounds(vertices)
        return (
            max((maximum[0] - minimum[0]) / 2, 0.0),
            max((maximum[2] - minimum[2]) / 2, 0.0),
            max(maximum[1] - min(minimum[1], 0.0), 0.0),
        )
    width, height, depth = item["size_m"]
    return (width / 2, depth / 2, height)


def rectangle(bounds: Sequence[float]) -> Footprint:
    x0, x1, z0, z1 = bounds
    return ((x0, z0), (x1, z0), (x1, z1), (x0, z1))


def _footprint_axes(polygon: Footprint) -> tuple[tuple[float, float], ...]:
    if len(polygon) != 4 or any(
        len(p) != 2 or not all(math.isfinite(v) for v in p) for p in polygon
    ):
        raise ValueError("footprint must have four finite coordinate pairs")
    axes = []
    for i, p in enumerate(polygon):
        q = polygon[(i + 1) % 4]
        nx, nz = -(q[1] - p[1]), q[0] - p[0]
        norm = math.hypot(nx, nz)
        if not math.isfinite(norm) or norm == 0:
            raise ValueError("footprint edges must have finite nonzero length")
        axes.append((nx / norm, nz / norm))
    if axes[0][0] * axes[1][1] - axes[0][1] * axes[1][0] == 0:
        raise ValueError("footprint must have nonzero area")
    return tuple(axes[:2])


def validate_item_geometry(item: dict) -> None:
    """Reject boxes whose world geometry collapses or overflows float precision."""
    _footprint_axes(footprint(item))
    bottom = float(item["position"][1])
    top = bottom + float(item["size_m"][1])
    if not math.isfinite(top) or top <= bottom:
        raise ValueError("item height must have finite nonzero world extent")


def footprints_overlap(a: Footprint, b: Footprint) -> bool:
    """SAT for convex rectangles; touching edges do not occupy shared area."""
    for nx, nz in _footprint_axes(a) + _footprint_axes(b):
        pa = [x * nx + z * nz for x, z in a]
        pb = [x * nx + z * nz for x, z in b]
        if min(max(pa), max(pb)) - max(min(pa), min(pb)) <= NUMERIC_EPSILON:
            return False
    return True


def items_overlap(a: dict, b: dict) -> bool:
    if any(i.get("collision", {}).get("type") == "compound" for i in (a, b)):
        from .convex import items_overlap as compound_overlap
        return compound_overlap(a, b)
    ay, by = a["position"][1], b["position"][1]
    if min(ay + a["size_m"][1], by + b["size_m"][1]) - max(ay, by) <= NUMERIC_EPSILON:
        return False
    return footprints_overlap(footprint(a), footprint(b))


def item_intersects_box(item: dict, box: AABB) -> bool:
    if item.get("collision", {}).get("type") == "compound":
        from .convex import world_parts, overlap
        vertices = tuple((x,y,z) for x in (box.minimum[0],box.maximum[0]) for y in (box.minimum[1],box.maximum[1]) for z in (box.minimum[2],box.maximum[2]))
        axes = ((1,0,0),(0,1,0),(0,0,1))
        return any(overlap(p,(vertices,axes,axes)) for p in world_parts(item))
    y = item["position"][1]
    if (
        min(y + item["size_m"][1], box.maximum[1]) - max(y, box.minimum[1])
        <= NUMERIC_EPSILON
    ):
        return False
    return footprints_overlap(
        footprint(item),
        rectangle((box.minimum[0], box.maximum[0], box.minimum[2], box.maximum[2])),
    )


def fits_region(item: dict, region: dict) -> bool:
    box = aabb_from_item(item)
    x0, x1, z0, z1 = region["bounds_xz_m"]
    # Clearance uses the real volume height: a compound item can be shorter than size_m,
    # and using the declared height would reject regions it actually fits.
    height = pose_extent(item)[2]
    return (
        abs(item["position"][1] - region["surface_y_m"]) <= EPSILON + NUMERIC_EPSILON
        and box.minimum[0] >= x0 - NUMERIC_EPSILON
        and box.maximum[0] <= x1 + NUMERIC_EPSILON
        and box.minimum[2] >= z0 - NUMERIC_EPSILON
        and box.maximum[2] <= z1 + NUMERIC_EPSILON
        and height <= region["clearance_height_m"] + NUMERIC_EPSILON
        and box.maximum[1]
        <= region["surface_y_m"] + region["clearance_height_m"] + NUMERIC_EPSILON
    )


def support_region(item: dict, regions: Sequence[dict]) -> str | None:
    return next((r["id"] for r in regions if fits_region(item, r)), None)
