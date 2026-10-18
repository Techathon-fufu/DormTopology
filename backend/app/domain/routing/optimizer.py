"""Conservative tray suggestions after individual cable routes are fixed."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import combinations, pairwise

from .geometry import (
    BEZIER_SAMPLE_ERROR,
    Point,
    _split_bezier,
)

_MIN_SHARED_LENGTH_M = 0.15
_PARALLEL_TANGENT = math.tan(math.radians(15.0))
_MAX_DEPTH = 18
_MAX_SUBDIVISIONS = 16384
_MAX_MEMBERSHIP_SETS = 2048
_MAX_RUNS = 1024
_MAX_ROUTES = 256
_MAX_SEGMENTS = 4096
_RESOLUTION_M = 0.00001


@dataclass(frozen=True)
class _Fragment:
    run: int
    lower: float
    upper: float
    cross_min: tuple[float, float]
    cross_max: tuple[float, float]
    controls: tuple[Point, ...]


@dataclass(frozen=True)
class _RouteIntervals:
    radius: float
    fragments: tuple[_Fragment, ...]
    exhausted: bool


def _mount_bounds(mount: dict, obstacle: dict) -> tuple[Point, Point, int, int]:
    x0, x1, z0, z1 = mount["bounds_uv_m"]
    y1 = obstacle["min"][1]
    lower = (x0, y1 - mount["stand_off_m"], z0)
    upper = (x1, y1, z1)
    longitudinal = 0 if x1 - x0 >= z1 - z0 else 2
    return lower, upper, longitudinal, 2 - longitudinal


def _parallel(controls: Sequence[Point], axis: int) -> bool:
    derivatives = [tuple(b[i] - a[i] for i in range(3)) for a, b in pairwise(controls)]
    sign = 1.0 if controls[-1][axis] >= controls[0][axis] else -1.0
    transverse = [i for i in range(3) if i != axis]
    return all(
        sign * value[axis] >= 0.0
        and math.hypot(*(value[i] for i in transverse))
        <= _PARALLEL_TANGENT * sign * value[axis] + 1e-14
        for value in derivatives
    )


def _could_be_parallel(controls: Sequence[Point], axis: int) -> bool:
    derivatives = [tuple(b[i] - a[i] for i in range(3)) for a, b in pairwise(controls)]
    transverse = [i for i in range(3) if i != axis]
    for sign in (1.0, -1.0):
        reach = max(sign * value[axis] for value in derivatives)
        if reach <= 1e-14:
            continue
        limit = _PARALLEL_TANGENT * reach
        if all(
            min(value[i] for value in derivatives) <= limit
            and max(value[i] for value in derivatives) >= -limit
            for i in transverse
        ):
            return True
    return False


def _route_intervals(
    route: dict,
    lower: Point,
    upper: Point,
    longitudinal: int,
    transverse: int,
) -> _RouteIntervals:
    radius = route["diameter_m"] / 2.0
    erosion = radius + BEZIER_SAMPLE_ERROR
    low = tuple(value + erosion for value in lower)
    high = tuple(value - erosion for value in upper)
    if low[longitudinal] >= high[longitudinal] or low[1] >= high[1]:
        return _RouteIntervals(radius, (), False)
    segments = route["curve_segments"]
    if len(segments) > _MAX_SEGMENTS:
        return _RouteIntervals(radius, (), True)
    # Lateral fit is checked after grouping. Keeping this axis unbounded here
    # lets a too-narrow candidate report capacity instead of fabricating a fit.
    checked_axes = (longitudinal, 1)
    stack = [
        (tuple(tuple(p) for p in segment["control_points"]), 0)
        for segment in reversed(segments)
    ]
    fragments: list[_Fragment] = []
    subdivisions = 0
    exhausted = False
    run = 0
    previous_end = None
    previous_sign = None
    while stack:
        controls, depth = stack.pop()
        minimum = tuple(min(p[i] for p in controls) for i in range(3))
        maximum = tuple(max(p[i] for p in controls) for i in range(3))
        if any(maximum[i] < low[i] or minimum[i] > high[i] for i in checked_axes):
            previous_end = None
            continue
        if not _could_be_parallel(controls, longitudinal):
            previous_end = None
            continue
        contained = all(
            low[i] <= minimum[i] and maximum[i] <= high[i] for i in checked_axes
        )
        start, end = controls[0][longitudinal], controls[-1][longitudinal]
        if contained and _parallel(controls, longitudinal):
            if abs(end - start) > 1e-12:
                sign = 1 if end > start else -1
                if previous_end != controls[0] or previous_sign != sign:
                    run += 1
                fragments.append(
                    _Fragment(
                        run,
                        min(start, end),
                        max(start, end),
                        (minimum[1], minimum[transverse]),
                        (maximum[1], maximum[transverse]),
                        controls,
                    )
                )
                previous_end, previous_sign = controls[-1], sign
            continue
        extent = max(maximum[i] - minimum[i] for i in range(3))
        if extent <= _RESOLUTION_M:
            previous_end = None
            continue
        if depth >= _MAX_DEPTH or subdivisions >= _MAX_SUBDIVISIONS:
            exhausted = True
            previous_end = None
            continue
        left, right = _split_bezier(controls)
        subdivisions += 1
        stack.extend(((right, depth + 1), (left, depth + 1)))
    return _RouteIntervals(radius, tuple(fragments), exhausted)


def _groups(
    routes: dict[str, _RouteIntervals],
) -> list[tuple[tuple[tuple[str, int], ...], float, float]] | None:
    intervals: dict[tuple[str, int], tuple[float, float]] = {}
    for identifier, route in routes.items():
        for part in route.fragments:
            key = (identifier, part.run)
            previous = intervals.get(key, (part.lower, part.upper))
            intervals[key] = (
                min(previous[0], part.lower),
                max(previous[1], part.upper),
            )
            if len(intervals) > _MAX_RUNS:
                return None
    endpoints = sorted({value for interval in intervals.values() for value in interval})
    ordered = sorted(
        intervals.items(), key=lambda entry: (-(entry[1][1] - entry[1][0]), entry[0])
    )
    memberships: set[tuple[tuple[str, int], ...]] = set()
    for lower, upper in pairwise(endpoints):
        midpoint = (lower + upper) / 2.0
        selected: dict[str, tuple[str, int]] = {}
        for key, interval in ordered:
            if interval[0] <= midpoint <= interval[1]:
                selected.setdefault(key[0], key)
        active = tuple(sorted(selected.values()))
        if len(active) < 2:
            continue
        memberships.add(active)
        # Pair alternatives allow a smaller compatible bundle when an extra
        # lane crosses the tray or exceeds its capacity.
        memberships.update(combinations(active, 2))
        if len(memberships) > _MAX_MEMBERSHIP_SETS:
            return None
    groups: list[tuple[tuple[tuple[str, int], ...], float, float]] = []
    for members in sorted(memberships):
        lower = max(intervals[key][0] for key in members)
        upper = min(intervals[key][1] for key in members)
        if upper - lower >= _MIN_SHARED_LENGTH_M:
            groups.append((members, lower, upper))
    return sorted(
        groups,
        key=lambda group: (-len(group[0]), -(group[2] - group[1]), group[0], group[1]),
    )


def _cross_bounds(
    route: _RouteIntervals, run: int, lower: float, upper: float
) -> tuple[tuple[float, float], tuple[float, float]]:
    parts = [
        part
        for part in route.fragments
        if part.run == run and part.lower < upper and part.upper > lower
    ]
    minimum = tuple(min(part.cross_min[i] for part in parts) for i in range(2))
    maximum = tuple(max(part.cross_max[i] for part in parts) for i in range(2))
    return minimum, maximum


def _optimize_mount(
    scene: dict, mount: dict, routes: list[dict], installed: bool
) -> dict:
    obstacle = next(
        value for value in scene["obstacles"] if value["id"] == mount["obstacle_id"]
    )
    lower, upper, longitudinal, transverse = _mount_bounds(mount, obstacle)
    available_width = upper[transverse] - lower[transverse]
    output = {
        "id": mount["id"],
        "status": "not_used",
        "support_id": mount["id"] if installed else None,
        "cable_ids": [],
        "shared_length_m": 0.0,
        "occupied_width_m": 0.0,
        "available_width_m": available_width,
        "requires_installation": not installed,
        "reason_code": "no_compatible_routes",
        "mount": {
            key: list(mount[key]) if key == "bounds_uv_m" else mount[key]
            for key in ("obstacle_id", "face", "bounds_uv_m", "stand_off_m")
        },
    }
    allowed = None if installed else set(mount["cable_ids"])
    eligible = [
        route
        for route in routes
        if route["status"] == "valid"
        and (allowed is None or route["id"] in allowed)
        and (
            not installed
            or (
                route.get("support_check", {}).get("status") == "verified"
                and mount["id"] in route["support_check"]["support_ids"]
            )
        )
    ]
    if len(eligible) < 2:
        return output
    if len(eligible) > _MAX_ROUTES:
        output["reason_code"] = "not_evaluated"
        return output
    reports = {
        route["id"]: _route_intervals(route, lower, upper, longitudinal, transverse)
        for route in eligible
    }
    exhausted = any(report.exhausted for report in reports.values())
    groups = _groups(reports)
    if groups is None:
        output["reason_code"] = "not_evaluated"
        return output
    for member_runs, start, end in groups:
        members = tuple(identifier for identifier, _ in member_runs)
        bounds = {
            identifier: _cross_bounds(reports[identifier], run, start, end)
            for identifier, run in member_runs
        }
        width_min = min(
            bounds[identifier][0][1] - reports[identifier].radius - BEZIER_SAMPLE_ERROR
            for identifier in members
        )
        width_max = max(
            bounds[identifier][1][1] + reports[identifier].radius + BEZIER_SAMPLE_ERROR
            for identifier in members
        )
        if width_min < lower[transverse] or width_max > upper[transverse]:
            output["reason_code"] = "insufficient_width"
            continue
        # Coincident routes remain eligible; each cable still has to fit
        # within the tray bounds above using its own radius and error margin.
        output.update(
            status="verified" if installed else "recommended",
            cable_ids=list(members),
            shared_length_m=end - start,
            occupied_width_m=width_max - width_min,
            reason_code=None,
        )
        return output
    if exhausted and output["reason_code"] == "no_compatible_routes":
        output["reason_code"] = "not_evaluated"
    return output


def optimize_underside_trays(scene: dict, routes: list[dict]) -> list[dict]:
    """Group fixed, valid curves inside optional or installed underside trays.

    Shared length is a certified longitudinal projection, not the sum of cable
    arc lengths. Suggestions leave all cable paths, statuses and support
    evidence untouched; accepting a candidate is a separate scene edit.
    """
    graph = scene["routing_graph"]
    mounts = [
        (mount, True)
        for mount in graph.get("supports", [])
        if mount["kind"] == "cable_tray" and mount["face"] == "y_min"
    ]
    mounts.extend((mount, False) for mount in graph.get("tray_candidates", []))
    return [
        _optimize_mount(scene, mount, routes, installed)
        for mount, installed in sorted(mounts, key=lambda entry: entry[0]["id"])
    ]
