"""Domain curve and cable-volume geometry used by the cable router.

All coordinates are world-space metres. The module intentionally uses tuples
instead of a third-party vector type so the planner stays easy to call from a
FastAPI service and easy to serialize in tests.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from itertools import pairwise

from backend.app.domain.geometry import (
    AABB,
    EPSILON,
    Point,
    aabb_from_item,
    aabb_from_zone,
    add,
    distance,
    dot,
    length,
    normalize,
    point,
    rotate_y,
    scale,
    sub,
)

__all__ = [
    "AABB",
    "BEZIER_SAMPLE_ERROR",
    "EPSILON",
    "OBB",
    "Point",
    "aabb_from_item",
    "aabb_from_zone",
    "add",
    "bezier_arc_length",
    "bezier_derivative",
    "bezier_point",
    "bezier_second_derivative",
    "beziers_arc_length",
    "boxes_from_entities",
    "cross",
    "distance",
    "dot",
    "exposed_bezier_length",
    "exposed_polyline_length",
    "length",
    "minimum_curve_radius",
    "normalize",
    "obb_from_item",
    "point",
    "polyline_length",
    "rotate_y",
    "sample_beziers",
    "scale",
    "segment_intersects_aabb",
    "segment_intersects_box",
    "segment_segment_distance",
    "sub",
]

# The sampler bounds continuous curve deviation from each chord by this value. The
# planner uses it as a conservative clearance margin when checking the sampled
# polyline against continuous geometry.
BEZIER_SAMPLE_ERROR = 0.0005


@dataclass(frozen=True)
class OBB:
    local_box: AABB
    position: Point
    rotation_y_rad: float

    def to_local(self, value: Point) -> Point:
        return rotate_y(sub(value, self.position), -self.rotation_y_rad)

    def to_world(self, value: Point) -> Point:
        return add(self.position, rotate_y(value, self.rotation_y_rad))


def obb_from_item(item: dict) -> OBB:
    width, height, depth = item["size_m"]
    return OBB(
        AABB((-width / 2.0, 0.0, -depth / 2.0), (width / 2.0, height, depth / 2.0)),
        point(item["position"]),
        item["rotation_y_rad"],
    )


def segment_intersects_box(start: Point, end: Point, box: AABB | OBB, inflate: float = 0.0) -> bool:
    if isinstance(box, OBB):
        return segment_intersects_aabb(box.to_local(start), box.to_local(end), box.local_box, inflate)
    return segment_intersects_aabb(start, end, box, inflate)


def cross(a: Point, b: Point) -> Point:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def segment_intersects_aabb(start: Point, end: Point, box: AABB, inflate: float = 0.0) -> bool:
    """Slab test for a segment against an optionally inflated AABB."""
    box = box.inflated(inflate)
    direction = sub(end, start)
    t_min, t_max = 0.0, 1.0
    for axis in range(3):
        origin = start[axis]
        delta = direction[axis]
        lower, upper = box.minimum[axis], box.maximum[axis]
        if abs(delta) <= 1e-12:
            if origin < lower or origin > upper:
                return False
            continue
        inverse = 1.0 / delta
        near = (lower - origin) * inverse
        far = (upper - origin) * inverse
        if near > far:
            near, far = far, near
        t_min = max(t_min, near)
        t_max = min(t_max, far)
        if t_min > t_max:
            return False
    return True


def polyline_length(points: Sequence[Point]) -> float:
    return sum(distance(a, b) for a, b in pairwise(points))


def segment_segment_distance(a0: Point, a1: Point, b0: Point, b1: Point) -> float:
    """Closest distance between two finite 3D segments."""
    u = sub(a1, a0)
    v = sub(b1, b0)
    w = sub(a0, b0)
    aa, bb, cc = dot(u, u), dot(u, v), dot(v, v)
    dd, ee = dot(u, w), dot(v, w)
    denominator = aa * cc - bb * bb
    if aa <= 1e-14 and cc <= 1e-14:
        return distance(a0, b0)
    if aa <= 1e-14:
        t = min(1.0, max(0.0, ee / cc))
        return distance(a0, add(b0, scale(v, t)))
    if cc <= 1e-14:
        s = min(1.0, max(0.0, -dd / aa))
        return distance(add(a0, scale(u, s)), b0)
    if denominator > 1e-14:
        s = (bb * ee - cc * dd) / denominator
        t = (aa * ee - bb * dd) / denominator
    else:
        s, t = 0.0, ee / cc
    s = min(1.0, max(0.0, s))
    t = min(1.0, max(0.0, t))
    # Recompute the other parameter after clamping one endpoint.
    t = min(1.0, max(0.0, (bb * s + ee) / cc))
    s = min(1.0, max(0.0, (bb * t - dd) / aa))
    return distance(add(a0, scale(u, s)), add(b0, scale(v, t)))


def bezier_point(control_points: Sequence[Point], t: float) -> Point:
    p0, p1, p2, p3 = control_points
    one_minus = 1.0 - t
    return add(
        add(scale(p0, one_minus**3), scale(p1, 3.0 * one_minus**2 * t)),
        add(scale(p2, 3.0 * one_minus * t**2), scale(p3, t**3)),
    )


def bezier_derivative(control_points: Sequence[Point], t: float) -> Point:
    p0, p1, p2, p3 = control_points
    one_minus = 1.0 - t
    return add(
        add(scale(sub(p1, p0), 3.0 * one_minus**2), scale(sub(p2, p1), 6.0 * one_minus * t)),
        scale(sub(p3, p2), 3.0 * t**2),
    )


def bezier_second_derivative(control_points: Sequence[Point], t: float) -> Point:
    p0, p1, p2, p3 = control_points
    return add(
        scale(add(sub(p2, scale(p1, 2.0)), p0), 6.0 * (1.0 - t)),
        scale(add(sub(p3, scale(p2, 2.0)), p1), 6.0 * t),
    )


def bezier_arc_length(
    control_points: Sequence[Point],
    *,
    tolerance: float = 1e-8,
    max_depth: int = 20,
) -> float:
    """Integrate the arc length of one cubic Bezier segment.

    The adaptive Simpson estimate uses the derivative of the same control
    points that are serialized in the routing result.  This avoids reporting
    the shorter chord length of the display samples as the cable length.
    """
    if tolerance <= 0:
        raise ValueError("tolerance must be positive")
    derivative = lambda parameter: length(bezier_derivative(control_points, parameter))

    def simpson(lower: float, upper: float, f_lower: float, f_mid: float, f_upper: float) -> float:
        return (upper - lower) * (f_lower + 4.0 * f_mid + f_upper) / 6.0

    f_lower = derivative(0.0)
    f_mid = derivative(0.5)
    f_upper = derivative(1.0)
    whole = simpson(0.0, 1.0, f_lower, f_mid, f_upper)

    def refine(
        lower: float,
        upper: float,
        f_lower: float,
        f_mid: float,
        f_upper: float,
        estimate: float,
        budget: float,
        depth: int,
    ) -> float:
        midpoint = (lower + upper) / 2.0
        left_midpoint = (lower + midpoint) / 2.0
        right_midpoint = (midpoint + upper) / 2.0
        f_left_midpoint = derivative(left_midpoint)
        f_right_midpoint = derivative(right_midpoint)
        left = simpson(lower, midpoint, f_lower, f_left_midpoint, f_mid)
        right = simpson(midpoint, upper, f_mid, f_right_midpoint, f_upper)
        refined = left + right
        if depth >= max_depth or abs(refined - estimate) <= 15.0 * budget:
            # Richardson extrapolation improves the estimate without changing
            # the control points or the sampled display path.
            return refined + (refined - estimate) / 15.0
        return refine(
            lower,
            midpoint,
            f_lower,
            f_left_midpoint,
            f_mid,
            left,
            budget / 2.0,
            depth + 1,
        ) + refine(
            midpoint,
            upper,
            f_mid,
            f_right_midpoint,
            f_upper,
            right,
            budget / 2.0,
            depth + 1,
        )

    return refine(0.0, 1.0, f_lower, f_mid, f_upper, whole, tolerance, 0)


def beziers_arc_length(
    segments: Sequence[Sequence[Point]],
    *,
    tolerance: float = 1e-8,
) -> float:
    """Return the summed arc length of a continuous Bezier chain."""
    return sum(bezier_arc_length(segment, tolerance=tolerance) for segment in segments)


def _split_bezier(control_points: Sequence[Point]) -> tuple[tuple[Point, ...], tuple[Point, ...]]:
    p0, p1, p2, p3 = control_points
    p01 = scale(add(p0, p1), 0.5)
    p12 = scale(add(p1, p2), 0.5)
    p23 = scale(add(p2, p3), 0.5)
    p012 = scale(add(p01, p12), 0.5)
    p123 = scale(add(p12, p23), 0.5)
    midpoint = scale(add(p012, p123), 0.5)
    return (p0, p01, p012, midpoint), (midpoint, p123, p23, p3)


def _curve_radius(control_points: Sequence[Point], parameter: float) -> float:
    velocity = bezier_derivative(control_points, parameter)
    speed = length(velocity)
    if speed <= 1e-12:
        return 0.0
    numerator = length(cross(velocity, bezier_second_derivative(control_points, parameter)))
    return math.inf if numerator <= 1e-12 else speed**3 / numerator


def _curve_radius_lower_bound(control_points: Sequence[Point]) -> float:
    """Bound the radius from below using the derivative control hull."""
    p0, p1, p2, p3 = control_points
    derivative_controls = (
        scale(sub(p1, p0), 3.0),
        scale(sub(p2, p1), 3.0),
        scale(sub(p3, p2), 3.0),
    )
    component_ranges = [
        (min(value[axis] for value in derivative_controls), max(value[axis] for value in derivative_controls))
        for axis in range(3)
    ]
    speed_lower = math.sqrt(
        sum(
            (lower if lower > 0.0 else min(0.0, upper)) ** 2
            for lower, upper in component_ranges
        )
    )
    speed_upper = max(length(value) for value in derivative_controls)
    acceleration_controls = (
        scale(add(sub(p2, scale(p1, 2.0)), p0), 6.0),
        scale(add(sub(p3, scale(p2, 2.0)), p1), 6.0),
    )
    acceleration_upper = max(length(value) for value in acceleration_controls)
    if speed_lower <= 1e-12:
        return 0.0
    if acceleration_upper <= 1e-12 or speed_upper <= 1e-12:
        return math.inf
    # |v x a| <= |v| |a|, so this is a conservative radius lower bound.
    return speed_lower**3 / (speed_upper * acceleration_upper)


def _adaptive_sample_segment(
    control_points: Sequence[Point],
    max_chord: float,
    max_error: float,
    max_depth: int = 14,
) -> list[Point]:
    samples: list[Point] = [control_points[0]]
    failed = False

    def subdivide(controls: Sequence[Point], depth: int) -> None:
        nonlocal failed
        if failed:
            return
        start, end = controls[0], controls[-1]
        chord = sub(end, start)
        squared_length = dot(chord, chord)

        def distance_to_chord(value: Point) -> float:
            parameter = 0.0 if squared_length <= 1e-30 else max(
                0.0, min(1.0, dot(sub(value, start), chord) / squared_length)
            )
            return distance(value, add(start, scale(chord, parameter)))

        # A Bezier curve lies in its control hull, whose distance to a convex
        # finite chord is bounded by the most distant control point.
        flat = max(distance_to_chord(value) for value in controls) <= max_error
        if distance(start, end) <= max_chord and flat:
            samples.append(end)
            return
        if depth >= max_depth:
            failed = True
            return
        left, right = _split_bezier(controls)
        subdivide(left, depth + 1)
        subdivide(right, depth + 1)

    subdivide(control_points, 0)
    return [] if failed else samples


def sample_beziers(segments: Sequence[Sequence[Point]], min_bend_radius: float) -> list[Point]:
    max_chord = min(0.01, min_bend_radius / 8.0)
    result: list[Point] = []
    for index, segment in enumerate(segments):
        sampled = _adaptive_sample_segment(segment, max_chord, BEZIER_SAMPLE_ERROR)
        if not sampled:
            return []
        if index:
            sampled = sampled[1:]
        result.extend(sampled)
    return result


def minimum_curve_radius(segments: Sequence[Sequence[Point]]) -> float:
    """Return a conservative lower bound for the continuous curve radius.

    A fixed parameter grid can miss a narrow high-curvature interval. Each
    Bezier sub-interval is recursively split while its derivative control hull
    leaves meaningful uncertainty; the returned bound is never greater than
    the true minimum radius on that interval.
    """
    minimum = math.inf
    max_depth = 12
    tolerance = 1e-6

    def inspect(control_points: Sequence[Point], depth: int) -> float:
        lower_bound = _curve_radius_lower_bound(control_points)
        sampled_bound = min(_curve_radius(control_points, parameter) for parameter in (0.0, 0.5, 1.0))
        if depth >= max_depth or lower_bound >= sampled_bound - tolerance:
            return lower_bound
        left, right = _split_bezier(control_points)
        return min(inspect(left, depth + 1), inspect(right, depth + 1))

    for segment in segments:
        minimum = min(minimum, inspect(segment, 0))
    return minimum


def _segment_zone_interval(start: Point, end: Point, zone: AABB) -> tuple[float, float] | None:
    direction = sub(end, start)
    t_min, t_max = 0.0, 1.0
    for axis in range(3):
        origin, delta = start[axis], direction[axis]
        lower, upper = zone.minimum[axis], zone.maximum[axis]
        if abs(delta) <= 1e-12:
            if origin < lower or origin > upper:
                return None
            continue
        near = (lower - origin) / delta
        far = (upper - origin) / delta
        if near > far:
            near, far = far, near
        t_min, t_max = max(t_min, near), min(t_max, far)
        if t_min > t_max:
            return None
    return (max(0.0, t_min), min(1.0, t_max))


def exposed_polyline_length(points: Sequence[Point], zones: Sequence[AABB]) -> float:
    """Compute the arc length inside the union of axis-aligned zones."""
    exposed = 0.0
    for start, end in pairwise(points):
        segment_len = distance(start, end)
        if segment_len <= 1e-12:
            continue
        intervals = [interval for zone in zones if (interval := _segment_zone_interval(start, end, zone))]
        intervals.sort()
        merged: list[tuple[float, float]] = []
        for lower, upper in intervals:
            if not merged or lower > merged[-1][1]:
                merged.append((lower, upper))
            else:
                merged[-1] = (merged[-1][0], max(merged[-1][1], upper))
        exposed += segment_len * sum(upper - lower for lower, upper in merged)
    return exposed


def exposed_bezier_length(
    segments: Sequence[Sequence[Point]],
    zones: Sequence[AABB],
    *,
    tolerance: float = 1e-5,
    max_depth: int = 18,
) -> float:
    """Measure continuous Bezier arc length inside the union of zones.

    Control-hull tests accept sub-curves wholly inside one zone or wholly
    outside all zones. Ambiguous pieces are subdivided until their chord is at
    most ``tolerance``; a small midpoint quadrature then bounds the remaining
    zone-boundary error without replacing the curve with a display polyline.
    """
    if not zones:
        return 0.0
    if tolerance <= 0:
        raise ValueError("tolerance must be positive")

    def bounds(control_points: Sequence[Point]) -> AABB:
        return AABB(
            tuple(min(value[axis] for value in control_points) for axis in range(3)),
            tuple(max(value[axis] for value in control_points) for axis in range(3)),
        )

    def contains(box: AABB, value: Point) -> bool:
        return all(box.minimum[axis] <= value[axis] <= box.maximum[axis] for axis in range(3))

    def intersects(first: AABB, second: AABB) -> bool:
        return all(
            first.minimum[axis] <= second.maximum[axis] and second.minimum[axis] <= first.maximum[axis]
            for axis in range(3)
        )

    def in_union(value: Point) -> bool:
        return any(contains(zone, value) for zone in zones)

    def measure(control_points: Sequence[Point], depth: int) -> float:
        box = bounds(control_points)
        if any(all(contains(zone, value) for value in control_points) for zone in zones):
            return bezier_arc_length(control_points, tolerance=tolerance / 10.0)
        if not any(intersects(box, zone) for zone in zones):
            return 0.0
        if depth >= max_depth or distance(control_points[0], control_points[-1]) <= tolerance:
            # The remaining interval is shorter than the declared geometric
            # tolerance. Sampling its midpoint avoids an all-or-nothing
            # endpoint test when the curve crosses a zone boundary.
            values = [
                bezier_point(control_points, parameter)
                for parameter in (0.0, 0.25, 0.5, 0.75, 1.0)
            ]
            inside_count = sum(in_union(value) for value in values)
            return bezier_arc_length(control_points, tolerance=tolerance / 10.0) * inside_count / len(values)
        left, right = _split_bezier(control_points)
        return measure(left, depth + 1) + measure(right, depth + 1)

    return sum(measure(segment, 0) for segment in segments)


def boxes_from_entities(entities: Iterable[dict], *, item: bool = False) -> list[AABB]:
    return [aabb_from_item(entity) if item else aabb_from_zone(entity) for entity in entities]
