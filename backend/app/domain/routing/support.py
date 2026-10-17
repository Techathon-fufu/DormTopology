"""Conservative continuous support checks for mounted cable routes."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise

from .geometry import AABB, BEZIER_SAMPLE_ERROR, Point, _split_bezier, distance

_MAX_DEPTH = 18
_MAX_SUBDIVISIONS = 32768
_RESOLUTION_M = 0.00001


@dataclass(frozen=True)
class SupportVolume:
    id: str
    box: AABB


@dataclass(frozen=True)
class SupportContext:
    volumes: tuple[SupportVolume, ...]
    max_unsupported_span_m: float


@dataclass(frozen=True)
class SupportReport:
    valid: bool
    max_unsupported_span_m: float
    unsupported_length_m: float
    support_ids: tuple[str, ...]
    exhausted: bool


def build_support_context(scene: dict) -> SupportContext | None:
    """Build outward face bands from an already validated scene contract."""
    graph = scene["routing_graph"]
    if "support_policy" not in graph:
        return None
    obstacles = {obstacle["id"]: obstacle for obstacle in scene["obstacles"]}
    volumes: list[SupportVolume] = []
    for support in graph.get("supports", []):
        obstacle = obstacles[support["obstacle_id"]]
        face = support["face"]
        axis = "xyz".index(face[0])
        tangents = [index for index in range(3) if index != axis]
        minimum, maximum = [0.0] * 3, [0.0] * 3
        for tangent, lower, upper in zip(
            tangents,
            support["bounds_uv_m"][::2],
            support["bounds_uv_m"][1::2],
        ):
            minimum[tangent], maximum[tangent] = lower, upper
        if face.endswith("min"):
            maximum[axis] = obstacle["min"][axis]
            minimum[axis] = maximum[axis] - support["stand_off_m"]
        else:
            minimum[axis] = obstacle["max"][axis]
            maximum[axis] = minimum[axis] + support["stand_off_m"]
        volumes.append(
            SupportVolume(support["id"], AABB(tuple(minimum), tuple(maximum)))
        )
    return SupportContext(
        tuple(volumes), graph["support_policy"]["max_unsupported_span_m"]
    )


def _contains(box: AABB, controls: Sequence[Point]) -> bool:
    return all(
        all(box.minimum[axis] <= value[axis] <= box.maximum[axis] for axis in range(3))
        for value in controls
    )


def _overlaps_hull(box: AABB, minimum: Point, maximum: Point) -> bool:
    return all(
        minimum[axis] <= box.maximum[axis] and maximum[axis] >= box.minimum[axis]
        for axis in range(3)
    )


def analyze_support(
    segments: Sequence[Sequence[Point]], context: SupportContext, radius: float
) -> SupportReport:
    """Certify support using convex hulls; length fields are upper bounds.

    A supported leaf must lie wholly inside one eroded support volume. Every
    other leaf contributes its control-polygon length to unsupported runs,
    including unresolved boundary leaves. Runs continue across curve seams.
    """
    if not math.isfinite(radius) or radius < 0.0:
        raise ValueError("radius must be finite and non-negative")
    erosion = radius + BEZIER_SAMPLE_ERROR
    volumes: list[SupportVolume] = []
    for volume in context.volumes:
        eroded = volume.box.inflated(-erosion)
        if all(eroded.minimum[axis] <= eroded.maximum[axis] for axis in range(3)):
            volumes.append(SupportVolume(volume.id, eroded))
    current_run = maximum_run = unsupported_length = 0.0
    support_ids: set[str] = set()
    exhausted = False
    subdivisions = 0
    stack = [(tuple(segment), 0) for segment in reversed(segments)]
    while stack:
        controls, depth = stack.pop()
        upper_length = sum(distance(start, end) for start, end in pairwise(controls))
        certified = next(
            (volume for volume in volumes if _contains(volume.box, controls)), None
        )
        if certified is not None:
            if upper_length > 0.0:
                support_ids.add(certified.id)
                current_run = 0.0
            continue
        minimum = tuple(min(value[axis] for value in controls) for axis in range(3))
        maximum = tuple(max(value[axis] for value in controls) for axis in range(3))
        overlaps = any(
            _overlaps_hull(volume.box, minimum, maximum) for volume in volumes
        )
        can_refine = overlaps and upper_length > _RESOLUTION_M
        if can_refine and depth < _MAX_DEPTH and subdivisions < _MAX_SUBDIVISIONS:
            left, right = _split_bezier(controls)
            subdivisions += 1
            stack.extend(((right, depth + 1), (left, depth + 1)))
            continue
        if can_refine:
            exhausted = True
        unsupported_length += upper_length
        current_run += upper_length
        maximum_run = max(maximum_run, current_run)
    return SupportReport(
        valid=bool(segments)
        and not exhausted
        and maximum_run <= context.max_unsupported_span_m,
        max_unsupported_span_m=maximum_run,
        unsupported_length_m=unsupported_length,
        support_ids=tuple(sorted(support_ids)),
        exhausted=exhausted,
    )
