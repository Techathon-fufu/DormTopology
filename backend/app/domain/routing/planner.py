"""Domain cable routing planner for the DormTopology v1 scene contract.

The public entry point is :func:`plan_routes`. It is a pure function: input is
never mutated, no files are written, and the returned dictionary is directly
serializable as ``cable_routing.json``.
"""

from __future__ import annotations

import heapq
import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from itertools import pairwise

from ..errors import SceneInputError
from ..geometry import (
    direction_to_world,
    item_intersects_box,
    items_overlap,
    local_to_world,
)
from ..geometry.convex import TOLERANCE, segment_hits, segment_interval
from ..models import RoutingResult, Scene
from ..rules import validate_scene as validate_domain_scene
from .geometry import (
    AABB,
    BEZIER_SAMPLE_ERROR,
    EPSILON,
    OBB,
    CollisionBody,
    Compound,
    Point,
    aabb_from_zone,
    add,
    beziers_arc_length,
    collision_from_item,
    cross,
    distance,
    dot,
    exposed_bezier_length,
    exposed_polyline_length,
    length,
    minimum_curve_radius,
    normalize,
    point,
    rotate_y,
    sample_beziers,
    scale,
    segment_intersects_box,
    segment_segment_distance,
    sub,
)
from .optimizer import optimize_underside_trays
from .support import SupportContext, analyze_support, build_support_context

ERROR_MESSAGES = {
    "invalid_input": "The scene or cable fields are invalid",
    "collision": "The verified path collides with forbidden geometry",
    "incompatible_ports": "Cable and port types are incompatible",
    "port_occupied": "A port capacity is exceeded",
    "length_exceeded": "Path length plus slack exceeds the cable length",
    "endpoint_blocked": "An endpoint lead-out is blocked",
    "no_path": "No path satisfies clearance, bend, and exclusion constraints",
    "unsupported_mode": "The selected routing mode has no configured channel",
    "unsupported_span": "The route exceeds the configured unsupported span; add mounted ties or a tray",
}


class RoutingInputError(SceneInputError):
    """Raised when the complete scene cannot enter routing."""

    def __init__(self, message: str, *, field: str | None = None):
        super().__init__(message, field=field)


@dataclass(frozen=True)
class ResolvedEndpoint:
    port_id: str
    item_id: str
    position: Point
    direction: Point
    collision_box: CollisionBody
    leadout_extension_m: float = 0.0


@dataclass(frozen=True)
class CableSpec:
    cable: dict
    radius: float
    mode: str
    min_bend_radius: float

    @property
    def cable_id(self) -> str:
        return self.cable["id"]


@dataclass(frozen=True)
class Arc:
    target: str
    length: float
    edge_id: str | None
    exposed: bool
    unsupported_length: float = 0.0


@dataclass(frozen=True)
class SearchPath:
    points: tuple[Point, ...]
    edge_ids: tuple[str, ...]
    required_points: tuple[Point, ...] = ()
    # Each route segment carries the configured channel radius when it is a
    # graph edge. Endpoint lead-outs and open-space connector segments carry
    # ``None`` and are validated by collision geometry only.
    corridors: tuple[tuple[Point, Point, float | None], ...] = ()


def validate_scene(scene: dict) -> None:
    """Reuse the scene contract, then require every connected port confirmed."""
    try:
        validate_domain_scene(scene, for_planning=True)
    except SceneInputError as error:
        raise RoutingInputError(str(error), field=error.field) from error
    for index, adapter in enumerate(scene["items"]):
        if "plug_mount" not in adapter:
            continue
        field = f"items[{index}].plug_mount"
        if any(
            other["id"] != adapter["id"] and items_overlap(adapter, other)
            for other in scene["items"]
        ):
            raise RoutingInputError("mounted adapter body overlaps another item", field=field)
        if any(
            item_intersects_box(adapter, aabb_from_zone(zone))
            for key in ("obstacles", "reserved_zones")
            for zone in scene[key]
        ):
            raise RoutingInputError("mounted adapter body intersects a forbidden zone", field=field)
    ports = {
        port["id"]: port
        for item in scene["items"]
        for port in item["ports"]
    }
    for cable in scene["cables"]:
        for port_id in (cable["start_port_id"], cable["end_port_id"]):
            if not ports[port_id]["confirmed"]:
                raise RoutingInputError(
                    "routing port is not confirmed", field=f"{port_id}.confirmed"
                )


def resolve_port_world(item: dict, port: dict) -> tuple[Point, Point]:
    """Transform a confirmed local port using the contract's Y rotation."""
    position = local_to_world(item, port["local_position"])
    direction = normalize(direction_to_world(item, port["local_direction"]))
    return position, direction


def _build_endpoints(scene: dict) -> dict[str, ResolvedEndpoint]:
    endpoints: dict[str, ResolvedEndpoint] = {}
    for item in scene["items"]:
        box = collision_from_item(item)
        for port in item["ports"]:
            position, direction = resolve_port_world(item, port)
            endpoints[port["id"]] = ResolvedEndpoint(port["id"], item["id"], position, direction, box)
    return endpoints


def _compatible(start_type: str, end_type: str, cable_type: str) -> bool:
    if cable_type == "power":
        return {start_type, end_type} == {"power_source", "power_sink"}
    return start_type == cable_type and end_type == cable_type


def _issue(cable: dict, reason: str) -> dict:
    return {
        "id": cable["id"],
        "start_port_id": cable["start_port_id"],
        "end_port_id": cable["end_port_id"],
        "cable_type": cable["cable_type"],
        "thickness": cable["thickness"],
        "mode": cable["mode"],
        "diameter_m": cable["diameter_m"],
        "status": "failed",
        "curve_segments": [],
        "path_points": [],
        "path_length_m": None,
        "reason_code": reason,
        "support_check": {"status": "not_evaluated", "max_unsupported_span_m": None, "support_ids": []},
    }

def _valid(cable: dict, segments: Sequence[Sequence[Point]], samples: Sequence[Point], path_length: float,
           support_context: SupportContext | None = None) -> dict:
    support = analyze_support(segments, support_context, cable["diameter_m"] / 2) if support_context else None
    return {
        "id": cable["id"],
        "start_port_id": cable["start_port_id"],
        "end_port_id": cable["end_port_id"],
        "cable_type": cable["cable_type"],
        "thickness": cable["thickness"],
        "mode": cable["mode"],
        "diameter_m": cable["diameter_m"],
        "status": "valid",
        "curve_segments": [{"control_points": [list(p) for p in segment]} for segment in segments],
        "path_points": [list(p) for p in samples],
        "path_length_m": path_length,
        "reason_code": None,
        "support_check": {
            "status": "verified" if support else "not_evaluated",
            "max_unsupported_span_m": support.max_unsupported_span_m if support else None,
            "support_ids": list(support.support_ids) if support else [],
        },
    }


def _line_control_points(start: Point, end: Point) -> tuple[Point, Point, Point, Point]:
    vector = sub(end, start)
    return (start, add(start, scale(vector, 1.0 / 3.0)), add(start, scale(vector, 2.0 / 3.0)), end)


def _port_handle_length(
    anchor: Point,
    opposite_control: Point,
    direction: Point,
    original_length: float,
    minimum_radius: float,
    factor: float | None,
) -> float:
    if factor is None:
        return original_length
    normal = normalize(direction)
    offset = sub(opposite_control, anchor)
    transverse = length(sub(offset, scale(normal, dot(offset, normal))))
    if transverse <= 1e-9:
        return original_length
    # For P1=P0+h*normal, the endpoint radius is 3*h*h/(2*transverse).
    # Interior curvature and all physical constraints still require validation.
    local_length = math.sqrt(2.0 * minimum_radius * transverse / 3.0)
    return min(original_length, factor * local_length)


def _polyline_to_beziers(
    points: Sequence[Point],
    minimum_radius: float,
    *,
    start_direction: Point | None = None,
    end_direction: Point | None = None,
    endpoint_handle_factor: float | None = None,
    flexible_corners: bool = False,
) -> list[tuple[Point, Point, Point, Point]] | None:
    cleaned: list[Point] = []
    for value in points:
        if not cleaned or distance(cleaned[-1], value) > 1e-9:
            cleaned.append(value)
    if len(cleaned) < 2:
        return None

    # Lead-out segments are required to remain straight through the device
    # collision box. Remove them from the corner pass, then constrain the
    # adjacent curve handles to the same tangent before restoring the lines.
    has_start_leadout = start_direction is not None and len(cleaned) >= 3
    has_end_leadout = end_direction is not None and len(cleaned) >= 3
    if has_start_leadout or has_end_leadout:
        first_route_index = 1 if has_start_leadout else 0
        last_route_index = len(cleaned) - (2 if has_end_leadout else 1)
        route_points = cleaned[first_route_index : last_route_index + 1]
        if len(route_points) < 2:
            return None
        core = _polyline_to_beziers(route_points, minimum_radius, flexible_corners=flexible_corners)
        if not core:
            return None
        adjusted = list(core)
        if has_start_leadout:
            first = list(adjusted[0])
            handle_length = _port_handle_length(
                first[0], first[2], start_direction,
                distance(first[0], first[3]) / 3.0,
                minimum_radius, endpoint_handle_factor,
            )
            first[1] = add(first[0], scale(normalize(start_direction), handle_length))
            adjusted[0] = tuple(first)
        if has_end_leadout:
            last = list(adjusted[-1])
            handle_length = _port_handle_length(
                last[3], last[1], end_direction,
                distance(last[0], last[3]) / 3.0,
                minimum_radius, endpoint_handle_factor,
            )
            # Traversal enters the endpoint in the opposite direction of its
            # outward normal, so P3-P2 must point along -end_direction.
            last[2] = add(last[3], scale(normalize(end_direction), handle_length))
            adjusted[-1] = tuple(last)
        result: list[tuple[Point, Point, Point, Point]] = []
        if has_start_leadout and distance(cleaned[0], cleaned[1]) > 1e-9:
            result.append(_line_control_points(cleaned[0], cleaned[1]))
        result.extend(adjusted)
        if has_end_leadout and distance(cleaned[-2], cleaned[-1]) > 1e-9:
            result.append(_line_control_points(cleaned[-2], cleaned[-1]))
        return result

    if len(cleaned) == 2:
        return [_line_control_points(cleaned[0], cleaned[1])]

    corners: dict[int, tuple[Point, Point, Point, Point]] = {}
    for index in range(1, len(cleaned) - 1):
        previous, current, following = cleaned[index - 1], cleaned[index], cleaned[index + 1]
        incoming_vector, outgoing_vector = sub(current, previous), sub(following, current)
        previous_length, following_length = length(incoming_vector), length(outgoing_vector)
        if previous_length <= 1e-9 or following_length <= 1e-9:
            return None
        incoming, outgoing = scale(incoming_vector, 1.0 / previous_length), scale(outgoing_vector, 1.0 / following_length)
        turn = math.acos(max(-1.0, min(1.0, dot(incoming, outgoing))))
        if turn < 1e-5:
            continue
        if turn >= math.pi - 1e-5:
            return None
        corner_radius = minimum_radius
        if flexible_corners:
            # Near a reversal, a fixed radius cuts far away from the graph
            # vertex. Keep the local trim small as well as fitting both arms.
            maximum_trim = min(minimum_radius, min(previous_length, following_length) / 4)
            corner_radius = min(corner_radius, maximum_trim / math.tan(turn / 2))
        tangent = corner_radius * math.tan(turn / 2.0)
        if tangent > previous_length / 2.0 or tangent > following_length / 2.0:
            return None
        entry = sub(current, scale(incoming, tangent))
        exit = add(current, scale(outgoing, tangent))
        handle = (4.0 / 3.0) * corner_radius * math.tan(turn / 4.0)
        corners[index] = (entry, exit, add(entry, scale(incoming, handle)), sub(exit, scale(outgoing, handle)))

    segments: list[tuple[Point, Point, Point, Point]] = []
    cursor = cleaned[0]
    for index in range(1, len(cleaned) - 1):
        if index not in corners:
            continue
        entry, exit, first_control, second_control = corners[index]
        if distance(cursor, entry) > 1e-9:
            segments.append(_line_control_points(cursor, entry))
        segments.append((entry, first_control, second_control, exit))
        cursor = exit
    if distance(cursor, cleaned[-1]) > 1e-9:
        segments.append(_line_control_points(cursor, cleaned[-1]))
    return segments or [_line_control_points(cleaned[0], cleaned[-1])]


def _segment_clear(start: Point, end: Point, radius: float, boxes: Sequence[CollisionBody]) -> bool:
    return not any(segment_intersects_box(start, end, box, radius + EPSILON) for box in boxes)


def _tube_conflicts(samples: Sequence[Point], radius: float, occupied: Sequence[tuple[Sequence[Point], float]]) -> bool:
    for other_samples, other_radius in occupied:
        for start, end in pairwise(samples):
            for other_start, other_end in pairwise(other_samples):
                if segment_segment_distance(start, end, other_start, other_end) < (
                    radius + other_radius + EPSILON + 2.0 * BEZIER_SAMPLE_ERROR
                ):
                    return True
    return False


def _lateral_direction(direction: Point) -> Point:
    """Choose a stable cross-section direction for a lane offset."""
    axis = (0.0, 1.0, 0.0)
    if abs(dot(direction, axis)) > 0.9:
        axis = (1.0, 0.0, 0.0)
    lateral = normalize((
        direction[1] * axis[2] - direction[2] * axis[1],
        direction[2] * axis[0] - direction[0] * axis[2],
        direction[0] * axis[1] - direction[1] * axis[0],
    ))
    return lateral


def _offset_beziers(
    segments: Sequence[Sequence[Point]],
    offset: float,
    sign: float,
    lateral: Point,
    *,
    preserve_start_segment: bool = False,
    preserve_end_segment: bool = False,
    ramp_fraction: float = 0.5,
) -> list[tuple[Point, Point, Point, Point]]:
    """Offset a curve through a shared channel while keeping its endpoints.

    A smooth zero-at-end ramp keeps the verified endpoint lead-outs unchanged;
    the same offset is applied at every shared segment boundary so the chain
    remains continuous. The resulting curve is always re-sampled and fully
    re-validated by the caller.
    """
    first = int(preserve_start_segment)
    stop = len(segments) - int(preserve_end_segment)
    core = segments[first:stop]
    segment_lengths = [distance(segment[0], segment[3]) for segment in core]
    total = sum(segment_lengths)
    if total <= 1e-12:
        return [tuple(segment) for segment in segments]
    prefix = 0.0
    result = [tuple(segment) for segment in segments[:first]]
    for segment, segment_length in zip(core, segment_lengths):
        start_fraction, end_fraction = prefix / total, (prefix + segment_length) / total

        def ramp(fraction: float) -> float:
            local = min(fraction, 1.0 - fraction, ramp_fraction) / ramp_fraction
            return sign * offset * math.sin(math.pi * local / 2) ** 2

        def slope(fraction: float) -> float:
            if ramp_fraction <= fraction <= 1.0 - ramp_fraction:
                return 0.0
            local = min(fraction, 1.0 - fraction) / ramp_fraction
            side = 1.0 if fraction < ramp_fraction else -1.0
            return sign * side * offset * math.pi * math.sin(math.pi * local) / (2 * ramp_fraction * total)

        start_offset, end_offset = ramp(start_fraction), ramp(end_fraction)
        # Match the offset derivative to each segment's endpoint speed. This
        # preserves the shared tangent even when adjacent handles differ.
        offsets = (
            start_offset,
            start_offset + slope(start_fraction) * distance(segment[0], segment[1]),
            end_offset - slope(end_fraction) * distance(segment[2], segment[3]),
            end_offset,
        )
        result.append(tuple(add(value, scale(lateral, amount)) for value, amount in zip(segment, offsets)))
        prefix += segment_length
    result.extend(tuple(segment) for segment in segments[stop:])
    return result


def _lane_candidates(
    segments: Sequence[Sequence[Point]],
    radius: float,
    occupied: Sequence[tuple[Sequence[Point], float]],
    channel_clearance: float,
    *,
    preserve_start_segment: bool = False,
    preserve_end_segment: bool = False,
    flexible: bool = False,
) -> Iterable[list[tuple[Point, Point, Point, Point]]]:
    if not occupied:
        return ()
    direction = sub(segments[-1][-1], segments[0][0])
    if length(direction) <= 1e-9:
        return ()
    direction = normalize(direction)
    lateral = _lateral_direction(direction)
    lane_axes = (lateral, normalize(cross(direction, lateral))) if flexible else (lateral,)
    required = max(
        radius + other_radius + EPSILON + 2.0 * BEZIER_SAMPLE_ERROR
        for _, other_radius in occupied
    )
    available = channel_clearance - radius - EPSILON
    if available + EPSILON < required:
        return ()
    candidates: list[list[tuple[Point, Point, Point, Point]]] = []
    for ramp_fraction in ((0.5, 0.2, 0.05) if flexible else (0.5,)):
        for lane_axis in lane_axes:
            for sign in (1.0, -1.0):
                for factor in (1.0, 1.5, 2.0, 3.0, 5.0, 7.0):
                    offset = required * factor
                    if offset <= available + EPSILON:
                        candidates.append(_offset_beziers(
                            segments,
                            offset,
                            sign,
                            lane_axis,
                            preserve_start_segment=preserve_start_segment,
                            preserve_end_segment=preserve_end_segment,
                            ramp_fraction=ramp_fraction,
                        ))
    return candidates


def _point_on_polyline(value: Point, samples: Sequence[Point], tolerance: float = EPSILON) -> bool:
    for start, end in pairwise(samples):
        segment = sub(end, start)
        denominator = dot(segment, segment)
        if denominator <= 1e-14:
            if distance(value, start) <= tolerance:
                return True
            continue
        parameter = max(0.0, min(1.0, dot(sub(value, start), segment) / denominator))
        projection = add(start, scale(segment, parameter))
        if distance(value, projection) <= tolerance:
            return True
    return False


def _curve_collides(
    samples: Sequence[Point],
    radius: float,
    obstacles: Sequence[AABB],
    reserved: Sequence[AABB],
    item_boxes: dict[str, CollisionBody],
    start_endpoint: ResolvedEndpoint,
    end_endpoint: ResolvedEndpoint,
) -> bool:
    forbidden = list(obstacles) + list(reserved)
    # The collision sweep uses chord samples. Include the sampler's maximum
    # geometric error so the sampled check remains conservative for the
    # continuous Bezier curve.
    clearance = radius + EPSILON + BEZIER_SAMPLE_ERROR
    chords = list(pairwise(samples))

    def finite_leadout(endpoint: ResolvedEndpoint, *, reverse: bool = False) -> set[int]:
        channel = (endpoint.position, _endpoint_exit(endpoint, radius))
        indices = range(len(chords) - 1, -1, -1) if reverse else range(len(chords))
        allowed: set[int] = set()
        for index in indices:
            if not all(_point_on_polyline(p, channel, 1e-9) for p in chords[index]):
                break
            allowed.add(index)
        return allowed

    start_allowed = finite_leadout(start_endpoint)
    end_allowed = finite_leadout(end_endpoint, reverse=True)
    start_remainder = _leadout_remainder(start_endpoint, radius)
    end_remainder = _leadout_remainder(end_endpoint, radius)
    for index, (start, end) in enumerate(chords):
        if any(segment_intersects_box(start, end, box, clearance) for box in forbidden):
            return True
        for item_id, box in item_boxes.items():
            if item_id == start_endpoint.item_id and index in start_allowed:
                box = start_remainder
            elif item_id == end_endpoint.item_id and index in end_allowed:
                box = end_remainder
            if box is None:
                continue
            if segment_intersects_box(start, end, box, clearance):
                return True
    return False


def _arc_clearance(
    start: Point,
    end: Point,
    radius: float,
    boxes: Sequence[CollisionBody],
) -> bool:
    return _segment_clear(start, end, radius, boxes)


def _port_host_parts(endpoint: ResolvedEndpoint, radius: float) -> tuple:
    body = endpoint.collision_box
    if not isinstance(body, Compound):
        return ()
    containing = tuple(
        part for part in body.parts
        if segment_hits(endpoint.position, endpoint.position, (part,), TOLERANCE)
    )
    if containing:
        return containing
    # A confirmed port can sit just outside its shell. Only the nearest solid
    # directly behind its outward normal is its host; a separate part ahead
    # must still block the finite lead-out.
    clearance = radius + EPSILON + BEZIER_SAMPLE_ERROR
    direction = normalize(endpoint.direction)
    behind = []
    for part in body.parts:
        interval = segment_interval(endpoint.position, direction, part)
        if (
            interval is not None
            and -clearance <= interval[1] <= TOLERANCE
            and segment_hits(endpoint.position, endpoint.position, (part,), clearance)
        ):
            behind.append((interval[1], part))
    nearest = max((exit for exit, _ in behind), default=-math.inf)
    return tuple(part for exit, part in behind if exit >= nearest - TOLERANCE)


def _endpoint_exit(endpoint: ResolvedEndpoint, radius: float) -> Point:
    shell_exit = _shell_exit(endpoint, radius)
    return add(shell_exit, scale(normalize(endpoint.direction), endpoint.leadout_extension_m))


def _shell_exit(endpoint: ResolvedEndpoint, radius: float) -> Point:
    """Return a short point beyond the port's containing solids.

    The extra tolerance keeps the post-exit graph segment from being rejected
    solely because its first point lies on the inflated boundary. A compound
    port only exempts its actual host solids, never nearby independent parts.
    """
    if isinstance(endpoint.collision_box, Compound):
        direction = normalize(endpoint.direction)
        clearance = radius + EPSILON + BEZIER_SAMPLE_ERROR
        exits: list[float] = []
        for part in _port_host_parts(endpoint, radius):
            interval = segment_interval(endpoint.position, direction, part, clearance)
            if interval is not None:
                exits.append(interval[1])
        if not exits:
            return endpoint.position
        return add(endpoint.position, scale(direction, max(exits) + EPSILON))
    oriented = endpoint.collision_box if isinstance(endpoint.collision_box, OBB) else None
    box = (oriented.local_box if oriented else endpoint.collision_box).inflated(
        radius + EPSILON + BEZIER_SAMPLE_ERROR
    )
    origin = oriented.to_local(endpoint.position) if oriented else endpoint.position
    direction = normalize(endpoint.direction)
    if oriented:
        direction = rotate_y(direction, -oriented.rotation_y_rad)
    inside = all(box.minimum[axis] <= origin[axis] <= box.maximum[axis] for axis in range(3))
    if not inside:
        return endpoint.position
    distances: list[float] = []
    for axis, component in enumerate(direction):
        if component > 1e-12:
            distances.append((box.maximum[axis] - origin[axis]) / component)
        elif component < -1e-12:
            distances.append((box.minimum[axis] - origin[axis]) / component)
    positive = [value for value in distances if value >= -EPSILON]
    if not positive:
        return endpoint.position
    distance_to_exit = max(0.0, min(positive))
    result = add(origin, scale(direction, distance_to_exit + EPSILON))
    return oriented.to_world(result) if oriented else result


def _leadout_remainder(endpoint: ResolvedEndpoint, radius: float = 0.0) -> Compound | None:
    body = endpoint.collision_box
    if isinstance(body, Compound):
        hosts = _port_host_parts(endpoint, radius)
        return Compound(tuple(part for part in body.parts if part not in hosts))
    return None


def _search_path(
    nodes: dict[str, tuple[Point, str]],
    edges: list[dict],
    start: ResolvedEndpoint,
    end: ResolvedEndpoint,
    spec: CableSpec,
    obstacle_boxes: Sequence[AABB],
    reserved_boxes: Sequence[AABB],
    item_boxes: dict[str, CollisionBody],
    banned_edges: set[str],
    use_dijkstra: bool,
    candidate_node_ids: set[str] | None = None,
    support_context: SupportContext | None = None,
    occupied: Sequence[tuple[Sequence[Point], float]] = (),
) -> tuple[SearchPath | None, bool, bool]:
    """Search the mode-specific graph and return path plus endpoint candidates.

    The two candidate flags are kept separate so a blocked lead-out can be
    reported as ``endpoint_blocked`` even when the opposite endpoint has a
    usable graph connection.
    """
    start_node, end_node = "__start__", "__end__"
    all_boxes = list(obstacle_boxes) + list(reserved_boxes) + list(item_boxes.values())
    start_connection_boxes = list(obstacle_boxes) + list(reserved_boxes) + [
        box for item_id, box in item_boxes.items() if item_id != start.item_id
    ]
    end_connection_boxes = list(obstacle_boxes) + list(reserved_boxes) + [
        box for item_id, box in item_boxes.items() if item_id != end.item_id
    ]
    for endpoint, connection_boxes in ((start, start_connection_boxes), (end, end_connection_boxes)):
        remainder = _leadout_remainder(endpoint, spec.radius)
        if remainder is not None:
            connection_boxes.append(remainder)
    start_exit = _endpoint_exit(start, spec.radius)
    end_exit = _endpoint_exit(end, spec.radius)
    start_leadout = distance(start.position, start_exit)
    end_leadout = distance(end.position, end_exit)
    adjacency: dict[str, list[Arc]] = {node_id: [] for node_id in nodes}
    adjacency[start_node] = []
    adjacency[end_node] = []
    start_candidates = False
    end_candidates = False
    def support_for(*points: Point):
        if support_context is None:
            return None
        segments = [_line_control_points(first, last) for first, last in pairwise(points)
                    if distance(first, last) > 1e-12]
        return analyze_support(segments, support_context, spec.radius) if segments else None

    for node_id, (node_position, _) in nodes.items():
        if candidate_node_ids is not None and node_id not in candidate_node_ids:
            continue
        if (
            _arc_clearance(start.position, start_exit, spec.radius, start_connection_boxes)
            and _arc_clearance(start_exit, node_position, spec.radius, all_boxes)
        ):
            start_candidates = True
            support = support_for(start.position, start_exit, node_position)
            if (support is None or support.valid) and not _tube_conflicts(
                (start.position, start_exit, node_position), spec.radius, occupied
            ):
                adjacency[start_node].append(Arc(node_id, distance(start_exit, node_position), None, False,
                                                 support.unsupported_length_m if support else 0.0))
        if (
            _arc_clearance(node_position, end_exit, spec.radius, all_boxes)
            and _arc_clearance(end_exit, end.position, spec.radius, end_connection_boxes)
        ):
            end_candidates = True
            support = support_for(node_position, end_exit, end.position)
            if (support is None or support.valid) and not _tube_conflicts(
                (node_position, end_exit, end.position), spec.radius, occupied
            ):
                adjacency[node_id].append(Arc(end_node, distance(node_position, end_exit) + end_leadout, None, False,
                                              support.unsupported_length_m if support else 0.0))

    for edge in edges:
        edge_id = edge["id"]
        if edge_id in banned_edges or spec.mode not in edge["modes"]:
            continue
        from_id, to_id = edge["from_node_id"], edge["to_node_id"]
        from_position, to_position = nodes[from_id][0], nodes[to_id][0]
        if edge["clearance_radius_m"] < spec.radius + EPSILON:
            continue
        if not _arc_clearance(from_position, to_position, spec.radius, all_boxes):
            continue
        if _tube_conflicts((from_position, to_position), spec.radius, occupied):
            continue
        support = support_for(from_position, to_position)
        if support is not None and not support.valid:
            continue
        edge_length = distance(from_position, to_position)
        unsupported = support.unsupported_length_m if support else 0.0
        adjacency[from_id].append(Arc(to_id, edge_length, edge_id, bool(edge["exposed"]), unsupported))
        adjacency[to_id].append(Arc(from_id, edge_length, edge_id, bool(edge["exposed"]), unsupported))

    required_kind = "slot" if spec.mode == "slot" else "fixing_point"
    positions = {node_id: value[0] for node_id, value in nodes.items()}
    exposure_penalty = 3.0
    bend_penalty = 0.03
    start_states: list[tuple[str, bool, bool, str | None, float]] = []
    for arc in adjacency[start_node]:
        start_states.append(
            (
                arc.target,
                nodes[arc.target][1] == required_kind,
                False,
                start_node,
                start_leadout + arc.length + 3.0 * arc.unsupported_length,
            )
        )
    if not start_states:
        return None, start_candidates, end_candidates
    queue: list[tuple[float, float, str, bool, bool, str | None]] = []
    parents: dict[tuple[str, bool, bool, str | None], tuple[str, bool, bool, str | None] | None] = {}
    parent_arcs: dict[tuple[str, bool, bool, str | None], Arc | None] = {}
    costs: dict[tuple[str, bool, bool, str | None], float] = {}
    for node_id, passed, used_edge, previous, cost in start_states:
        state = (node_id, passed, used_edge, previous)
        estimate = 0.0 if use_dijkstra else distance(positions[node_id], end.position)
        heapq.heappush(queue, (cost + estimate, cost, node_id, passed, used_edge, previous))
        if state not in costs or cost < costs[state]:
            costs[state] = cost
            parents[state] = None
            parent_arcs[state] = None
    goal: tuple[str, bool, bool, str | None] | None = None
    while queue:
        _, cost, node_id, passed, used_edge, previous = heapq.heappop(queue)
        state = (node_id, passed, used_edge, previous)
        if cost > costs.get(state, math.inf) + 1e-12:
            continue
        if node_id == end_node:
            if passed and used_edge:
                goal = state
                break
            continue
        for arc in sorted(adjacency[node_id], key=lambda candidate: (candidate.target, candidate.edge_id or "")):
            if arc.target == start_node:
                continue
            next_passed = passed or (arc.target in nodes and nodes[arc.target][1] == required_kind)
            next_used_edge = used_edge or arc.edge_id is not None
            if arc.target == end_node and not (next_passed and next_used_edge):
                continue
            turn_cost = 0.0
            if previous is not None and node_id in positions:
                previous_position = start_exit if previous == start_node else positions[previous]
                previous_vector = sub(positions[node_id], previous_position)
                next_vector = sub(
                    (end_exit if arc.target == end_node else positions[arc.target]),
                    positions[node_id],
                )
                if length(previous_vector) > 1e-9 and length(next_vector) > 1e-9:
                    previous_direction = normalize(previous_vector)
                    next_direction = normalize(next_vector)
                    alignment = dot(previous_direction, next_direction)
                    # The curve builder cannot round an exact reversal. Search
                    # a different exit instead of repeatedly selecting a spur
                    # out to a strategy node and back along the same channel.
                    if alignment < -1.0 + 1e-5:
                        continue
                    turn_cost = bend_penalty * (1.0 - alignment)
            next_cost = cost + arc.length + (exposure_penalty * arc.length if arc.exposed else 0.0) + turn_cost + 3.0 * arc.unsupported_length
            next_state = (arc.target, next_passed, next_used_edge, node_id)
            if next_cost + 1e-12 >= costs.get(next_state, math.inf):
                continue
            costs[next_state] = next_cost
            parents[next_state] = state
            parent_arcs[next_state] = arc
            estimate = 0.0 if use_dijkstra or arc.target == end_node else distance(positions[arc.target], end.position)
            heapq.heappush(queue, (next_cost + estimate, next_cost, arc.target, next_passed, next_used_edge, node_id))
    if goal is None:
        return None, start_candidates, end_candidates
    state_path: list[tuple[str, bool, bool, str | None]] = []
    cursor: tuple[str, bool, bool, str | None] | None = goal
    while cursor is not None:
        state_path.append(cursor)
        cursor = parents.get(cursor)
    state_path.reverse()
    # The terminal connection participates in search cost, while the explicit
    # endpoint lead-in below supplies its geometry.
    state_path.pop()
    node_path = [state[0] for state in state_path]
    points = [start.position]
    if distance(points[-1], start_exit) > 1e-9:
        points.append(start_exit)
    for node_id in node_path:
        if node_id in positions and distance(points[-1], positions[node_id]) > 1e-9:
            points.append(positions[node_id])
    if distance(points[-1], end_exit) > 1e-9:
        points.append(end_exit)
    points.append(end.position)
    edge_ids: list[str] = []
    selected_arcs: list[Arc] = []
    for state in state_path[1:]:
        arc = parent_arcs[state]
        if arc is not None:
            selected_arcs.append(arc)
            if arc.edge_id is not None:
                edge_ids.append(arc.edge_id)
    required_points = tuple(
        positions[node_id]
        for node_id in node_path
        if node_id in positions and nodes[node_id][1] == required_kind
    )
    corridor_by_edge = {edge["id"]: edge for edge in edges}
    corridors: list[tuple[Point, Point, float | None]] = []
    if distance(start.position, start_exit) > 1e-9:
        corridors.append((start.position, start_exit, None))
    if node_path:
        corridors.append((start_exit, positions[node_path[0]], None))
    for index, arc in enumerate(selected_arcs):
        from_id, to_id = node_path[index], node_path[index + 1]
        edge_clearance = (
            corridor_by_edge[arc.edge_id]["clearance_radius_m"]
            if arc.edge_id is not None
            else None
        )
        corridors.append((positions[from_id], positions[to_id], edge_clearance))
    if node_path:
        corridors.append((positions[node_path[-1]], end_exit, None))
    if distance(end_exit, end.position) > 1e-9:
        corridors.append((end_exit, end.position, None))
    return SearchPath(tuple(points), tuple(edge_ids), required_points, tuple(corridors)), start_candidates, end_candidates


def _validate_curve(
    segments: Sequence[Sequence[Point]],
    samples: Sequence[Point],
    spec: CableSpec,
    start: ResolvedEndpoint,
    end: ResolvedEndpoint,
    obstacle_boxes: Sequence[AABB],
    reserved_boxes: Sequence[AABB],
    item_boxes: dict[str, CollisionBody],
    occupied: Sequence[tuple[Sequence[Point], float]],
    required_points: Sequence[Point] = (),
    required_tolerance: float = EPSILON,
    corridors: Sequence[tuple[Point, Point, float | None]] = (),
    support_context: SupportContext | None = None,
    orthogonal: bool = False,
) -> tuple[str | None, float]:
    if orthogonal:
        from .orthogonal import axis_aligned
        for index, segment in enumerate(segments):
            if any(distance(actual, expected) > 1e-9 for actual, expected in zip(segment, _line_control_points(segment[0], segment[3]))):
                return "no_path", 0.0
            if 0 < index < len(segments) - 1 and not axis_aligned(segment[0], segment[3]):
                return "no_path", 0.0
    for previous, following in pairwise(segments):
        if distance(previous[3], following[0]) > 1e-9:
            return "no_path", 0.0
        incoming, outgoing = sub(previous[3], previous[2]), sub(following[1], following[0])
        if length(incoming) <= 1e-12 or length(outgoing) <= 1e-12:
            return "no_path", 0.0
        alignment = dot(normalize(incoming), normalize(outgoing))
        if (not orthogonal and alignment < 1.0 - 1e-9) or (orthogonal and alignment < -1.0 + 1e-9):
            return "no_path", 0.0
    if len(samples) < 2:
        return "no_path", 0.0
    if distance(samples[0], start.position) > EPSILON or distance(samples[-1], end.position) > EPSILON:
        return "collision", 0.0
    if any(not _point_on_polyline(required, samples, required_tolerance) for required in required_points):
        return "no_path", 0.0
    if corridors:
        raw_lengths = [distance(start, end) for start, end, _ in corridors]
        raw_total = sum(raw_lengths)
        curve_prefix = [0.0]
        curve_prefix.extend(
            curve_prefix[-1] + distance(start, end)
            for start, end in pairwise(samples)
        )
        curve_total = curve_prefix[-1]
        if raw_total <= 1e-12 or curve_total <= 1e-12:
            return "no_path", 0.0
        raw_prefix = 0.0
        segment_index = 0
        for sample_index, sample in enumerate(samples):
            target = raw_total * curve_prefix[sample_index] / curve_total
            while (
                segment_index < len(corridors) - 1
                and target > raw_prefix + raw_lengths[segment_index]
            ):
                raw_prefix += raw_lengths[segment_index]
                segment_index += 1
            corridor_start, corridor_end, clearance = corridors[segment_index]
            if clearance is None:
                continue
            segment = sub(corridor_end, corridor_start)
            denominator = dot(segment, segment)
            parameter = 0.0
            if denominator > 1e-14:
                parameter = max(
                    0.0,
                    min(1.0, dot(sub(sample, corridor_start), segment) / denominator),
                )
            projection = add(corridor_start, scale(segment, parameter))
            allowed = clearance - spec.radius - EPSILON - BEZIER_SAMPLE_ERROR
            if allowed <= 0.0 or distance(sample, projection) > allowed:
                return "no_path", 0.0
    first_tangent = sub(segments[0][1], segments[0][0])
    last_tangent = sub(segments[-1][3], segments[-1][2])
    if length(first_tangent) <= 1e-12 or length(last_tangent) <= 1e-12:
        return "no_path", 0.0
    if (
        dot(normalize(first_tangent), start.direction) < 1.0 - 1e-9
        or dot(normalize(last_tangent), end.direction) > -1.0 + 1e-9
    ):
        return "endpoint_blocked", 0.0
    if _curve_collides(samples, spec.radius, obstacle_boxes, reserved_boxes, item_boxes, start, end):
        return "collision", 0.0
    if _tube_conflicts(samples, spec.radius, occupied):
        return "no_path", 0.0
    if spec.min_bend_radius > 0 and minimum_curve_radius(segments) + EPSILON < spec.min_bend_radius:
        return "no_path", 0.0
    path_length = beziers_arc_length(segments)
    available_length = spec.cable["length_m"]
    if available_length is not None and path_length + spec.cable["slack_m"] > available_length + EPSILON:
        return "length_exceeded", path_length
    if support_context and not analyze_support(segments, support_context, spec.radius).valid:
        return "unsupported_span", path_length
    return None, path_length


def _plan_one(
    scene: dict,
    cable: dict,
    endpoints: dict[str, ResolvedEndpoint],
    nodes: dict[str, tuple[Point, str]],
    edges: list[dict],
    obstacle_boxes: Sequence[AABB],
    reserved_boxes: Sequence[AABB],
    item_boxes: dict[str, CollisionBody],
    occupied: Sequence[tuple[Sequence[Point], float]],
    use_dijkstra: bool,
    support_context: SupportContext | None = None,
    leadout_extension_m: float | None = None,
) -> tuple[dict, tuple[Sequence[Point], float] | None]:
    if scene.get("routing_graph", {}).get("path_style") == "orthogonal":
        from .orthogonal import plan_orthogonal
        return plan_orthogonal(scene, cable, endpoints, nodes, edges, obstacle_boxes,
                               reserved_boxes, item_boxes, occupied, use_dijkstra, support_context)
    if cable["min_bend_radius_m"] == 0 and leadout_extension_m is None:
        for extension in (0.04, 0.02, 0.0):
            result, tube = _plan_one(
                scene, cable, endpoints, nodes, edges, obstacle_boxes, reserved_boxes,
                item_boxes, occupied, use_dijkstra, support_context, extension,
            )
            if tube is not None:
                return result, tube
        return result, None
    start = endpoints[cable["start_port_id"]]
    end = endpoints[cable["end_port_id"]]
    if leadout_extension_m:
        start = replace(start, leadout_extension_m=leadout_extension_m)
        end = replace(end, leadout_extension_m=leadout_extension_m)
    spec = CableSpec(cable, cable["diameter_m"] / 2.0, cable["mode"], cable["min_bend_radius_m"])
    port_map = {
        port["id"]: port
        for item in scene["items"]
        for port in item["ports"]
    }
    if not _compatible(port_map[start.port_id]["type"], port_map[end.port_id]["type"], cable["cable_type"]):
        return _issue(cable, "incompatible_ports"), None
    mode_edges = [edge for edge in edges if cable["mode"] in edge["modes"]]
    required_kind = "slot" if cable["mode"] == "slot" else "fixing_point"
    mode_key_nodes = {
        node_id
        for edge in mode_edges
        for node_id in (edge["from_node_id"], edge["to_node_id"])
        if nodes[node_id][1] == required_kind
    }
    if not mode_edges or not mode_key_nodes:
        return _issue(cable, "unsupported_mode"), None
    # Rounded Bézier corners intentionally deviate from the graph vertex. The
    # cable centreline still has to remain within the configured channel around
    # each strategy node, after reserving its own radius and the geometry
    # tolerance.
    required_tolerance = max(
        EPSILON,
        min(edge["clearance_radius_m"] for edge in mode_edges)
        - spec.radius
        - EPSILON,
    )
    candidate_node_ids = {
        node_id
        for edge in mode_edges
        for node_id in (edge["from_node_id"], edge["to_node_id"])
    }
    banned_edges: set[str] = set()
    last_reason = "no_path"
    saw_length_exceeded = False
    saw_unsupported = False
    saw_geometry_failure = False
    for _attempt in range(1 if leadout_extension_m else 3):
        search_occupied = occupied if (_attempt or leadout_extension_m) else ()
        search_path, start_candidates, end_candidates = _search_path(
            nodes,
            edges,
            start,
            end,
            spec,
            obstacle_boxes,
            reserved_boxes,
            item_boxes,
            banned_edges,
            use_dijkstra,
            candidate_node_ids,
            support_context,
            search_occupied,
        )
        if search_path is None:
            if not start_candidates or not end_candidates:
                last_reason = "endpoint_blocked"
            else:
                last_reason = "no_path"
                if support_context:
                    geometric_path, _, _ = _search_path(
                        nodes, edges, start, end, spec, obstacle_boxes, reserved_boxes,
                        item_boxes, banned_edges, use_dijkstra, candidate_node_ids,
                        occupied=search_occupied,
                    )
                    if geometric_path is not None and not saw_geometry_failure:
                        last_reason = "unsupported_span"
            break
        start_exit = _endpoint_exit(start, spec.radius)
        end_exit = _endpoint_exit(end, spec.radius)
        # Zero disables the physical bend limit, but still uses finite smooth
        # corners. Smaller local profiles stay close to tight edge channels.
        profiles = (
            ((0.005, None), (0.005, 0.35), (0.002, 0.35), (0.0005, 0.25))
            if spec.min_bend_radius == 0
            else tuple((spec.min_bend_radius * 1.1, factor) for factor in (None, 1.2, 1.3))
        )
        for smoothing_radius, endpoint_handle_factor in profiles:
            segments = _polyline_to_beziers(
                search_path.points,
                smoothing_radius,
                start_direction=start.direction
                if distance(start.position, start_exit) > 1e-9
                else None,
                end_direction=end.direction
                if distance(end.position, end_exit) > 1e-9
                else None,
                endpoint_handle_factor=endpoint_handle_factor,
                flexible_corners=spec.min_bend_radius == 0,
            )
            if not segments:
                last_reason = "no_path"
                saw_geometry_failure = True
                continue
            # Ports already outside the device still require their confirmed
            # tangent, even though they have no collision-box lead-out.
            first = list(segments[0])
            first_handle = _port_handle_length(
                first[0], first[2], start.direction,
                distance(first[0], first[1]), smoothing_radius,
                endpoint_handle_factor,
            )
            first[1] = add(first[0], scale(start.direction, first_handle))
            segments[0] = tuple(first)
            last = list(segments[-1])
            last_handle = _port_handle_length(
                last[3], last[1], end.direction,
                distance(last[2], last[3]), smoothing_radius,
                endpoint_handle_factor,
            )
            last[2] = add(last[3], scale(end.direction, last_handle))
            segments[-1] = tuple(last)
            path_clearances = [
                edge["clearance_radius_m"]
                for edge in edges
                if edge["id"] in search_path.edge_ids
            ]
            path_required_tolerance = (
                max(EPSILON, min(path_clearances) - spec.radius - EPSILON)
                if path_clearances
                else required_tolerance
            )
            samples = sample_beziers(segments, spec.min_bend_radius)
            last_reason, path_length = _validate_curve(
                segments,
                samples,
                spec,
                start,
                end,
                obstacle_boxes,
                reserved_boxes,
                item_boxes,
                occupied,
                search_path.required_points,
                path_required_tolerance,
                search_path.corridors,
                support_context,
            )
            if last_reason == "no_path" and occupied and _tube_conflicts(samples, spec.radius, occupied):
                edge_clearances = [
                    edge["clearance_radius_m"]
                    for edge in edges
                    if edge["id"] in search_path.edge_ids
                ]
                channel_clearance = min(edge_clearances, default=0.0)
                for lane_segments in _lane_candidates(
                    segments,
                    spec.radius,
                    occupied,
                    channel_clearance,
                    preserve_start_segment=distance(start.position, start_exit) > 1e-9,
                    preserve_end_segment=distance(end.position, end_exit) > 1e-9,
                    flexible=spec.min_bend_radius == 0,
                ):
                    lane_samples = sample_beziers(lane_segments, spec.min_bend_radius)
                    lane_reason, lane_length = _validate_curve(
                        lane_segments,
                        lane_samples,
                        spec,
                        start,
                        end,
                        obstacle_boxes,
                        reserved_boxes,
                        item_boxes,
                        occupied,
                        search_path.required_points,
                        required_tolerance=max(path_required_tolerance, channel_clearance),
                        corridors=search_path.corridors,
                        support_context=support_context,
                    )
                    if lane_reason is None:
                        return _valid(cable, lane_segments, lane_samples, lane_length, support_context), (
                            lane_samples,
                            spec.radius,
                        )
            if last_reason is None:
                return _valid(cable, segments, samples, path_length, support_context), (samples, spec.radius)
            if last_reason == "length_exceeded":
                saw_length_exceeded = True
            if last_reason == "unsupported_span":
                saw_unsupported = True
            elif last_reason in {"no_path", "collision", "endpoint_blocked"}:
                saw_geometry_failure = True
        if search_path.edge_ids:
            banned_edges.add(search_path.edge_ids[min(_attempt, len(search_path.edge_ids) - 1)])
        else:
            break
    if saw_length_exceeded and last_reason in {"no_path", "length_exceeded"}:
        last_reason = "length_exceeded"
    if saw_unsupported and last_reason == "no_path":
        last_reason = "unsupported_span"
    return _issue(cable, last_reason), None


def _failed_issue(cable_id: str, reason: str) -> dict:
    return {"entity_id": cable_id, "code": reason, "message": ERROR_MESSAGES[reason]}


def _validate_port_capacity(scene: dict) -> set[str]:
    ports = {
        port["id"]: port
        for item in scene["items"]
        for port in item["ports"]
    }
    counts: dict[str, int] = {port_id: 0 for port_id in ports}
    for item in scene["items"]:
        if "plug_mount" in item:
            counts[item["plug_mount"]["socket_port_id"]] += 1
            counts[item["plug_mount"]["plug_port_id"]] += 1
    for cable in scene["cables"]:
        counts[cable["start_port_id"]] += 1
        counts[cable["end_port_id"]] += 1
    return {
        port_id
        for port_id, count in counts.items()
        if count > ports[port_id]["capacity"]
    }


def plan_routes(scene: Scene, *, use_dijkstra: bool = False) -> RoutingResult:
    """Validate and route every cable in a scene.

    ``use_dijkstra`` is a deterministic debug switch used to compare the A*
    implementation against the same non-negative graph cost function.
    """
    validate_scene(scene)
    support_context = build_support_context(scene)
    endpoints = _build_endpoints(scene)
    nodes = {node["id"]: (point(node["position"]), node["kind"]) for node in scene["routing_graph"]["nodes"]}
    edges = scene["routing_graph"]["edges"]
    obstacle_boxes = [aabb_from_zone(zone) for zone in scene["obstacles"]]
    reserved_boxes = [aabb_from_zone(zone) for zone in scene["reserved_zones"]]
    exposure_boxes = [aabb_from_zone(zone) for zone in scene["exposure_zones"]]
    item_boxes = {item["id"]: collision_from_item(item) for item in scene["items"]}
    occupied_ports = _validate_port_capacity(scene)
    results_by_id: dict[str, dict] = {}
    for cable in sorted(scene["cables"], key=lambda value: value["id"]):
        if cable["start_port_id"] in occupied_ports or cable["end_port_id"] in occupied_ports:
            results_by_id[cable["id"]] = _issue(cable, "port_occupied")
            continue
        # Each route retains its own diameter for solid/channel clearance.
        # Other cables are not obstacles, so route order cannot consume lanes.
        result, _ = _plan_one(
            scene, cable, endpoints, nodes, edges, obstacle_boxes,
            reserved_boxes, item_boxes, (), use_dijkstra, support_context,
        )
        results_by_id[cable["id"]] = result

    results = [results_by_id[cable["id"]] for cable in scene["cables"]]
    issues = [
        _failed_issue(result["id"], result["reason_code"])
        for result in results
        if result["status"] == "failed"
    ]
    valid_results = [result for result in results if result["status"] == "valid"]
    if not results:
        # No requested cables means a known zero, rather than an unknown
        # metric.
        exposed_length = 0.0
    else:
        # Failed cables do not contribute; when at least one route is valid,
        # expose the sum of those verified curves. With no valid routes the
        # metric is unknown rather than a fabricated zero.
        if not valid_results:
            exposed_length = None
        else:
            exposed_length = sum(
                exposed_bezier_length(
                    [
                        tuple(tuple(point) for point in segment["control_points"])
                        for segment in result["curve_segments"]
                    ],
                    exposure_boxes,
                )
                for result in valid_results
            )
    baseline_length = None
    if scene["cables"] and all("baseline_path_points" in cable for cable in scene["cables"]):
        baseline_length = sum(
            exposed_polyline_length([point(value) for value in cable["baseline_path_points"]], exposure_boxes)
            for cable in scene["cables"]
        )
    valid_count = sum(result["status"] == "valid" for result in results)
    if valid_count == len(results):
        status = "success"
    elif valid_count:
        status = "partial"
    else:
        status = "infeasible"
    return {
        "schema_version": "1.0",
        "scene_id": scene["scene_id"],
        "scene_revision": scene["scene_revision"],
        "status": status,
        "cables": results,
        "metrics": {
            "exposed_length_m": exposed_length,
            "baseline_exposed_length_m": baseline_length,
        },
        "issues": issues,
        "underside_tray_optimizations": optimize_underside_trays(scene, results),
    }
