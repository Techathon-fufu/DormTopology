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


def rectangle(bounds: Sequence[float]) -> Footprint:
    x0, x1, z0, z1 = bounds
    return ((x0, z0), (x1, z0), (x1, z1), (x0, z1))


def footprints_overlap(a: Footprint, b: Footprint) -> bool:
    """SAT for convex rectangles; touching edges do not occupy shared area."""
    for polygon in (a, b):
        for i in (0, 1):
            p, q = polygon[i], polygon[i + 1]
            nx, nz = -(q[1] - p[1]), q[0] - p[0]
            norm = math.hypot(nx, nz)
            nx, nz = nx / norm, nz / norm
            pa = [x * nx + z * nz for x, z in a]
            pb = [x * nx + z * nz for x, z in b]
            if min(max(pa), max(pb)) - max(min(pa), min(pb)) <= NUMERIC_EPSILON:
                return False
    return True


def items_overlap(a: dict, b: dict) -> bool:
    ay, by = a["position"][1], b["position"][1]
    if min(ay + a["size_m"][1], by + b["size_m"][1]) - max(ay, by) <= NUMERIC_EPSILON:
        return False
    return footprints_overlap(footprint(a), footprint(b))


def item_intersects_box(item: dict, box: AABB) -> bool:
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
    return (
        abs(item["position"][1] - region["surface_y_m"]) <= EPSILON + NUMERIC_EPSILON
        and box.minimum[0] >= x0 - EPSILON
        and box.maximum[0] <= x1 + EPSILON
        and box.minimum[2] >= z0 - EPSILON
        and box.maximum[2] <= z1 + EPSILON
        and box.maximum[1]
        <= region["surface_y_m"] + region["clearance_height_m"] + EPSILON
    )


def support_region(item: dict, regions: Sequence[dict]) -> str | None:
    return next((r["id"] for r in regions if fits_region(item, r)), None)
