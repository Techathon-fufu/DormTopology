"""Cable routing planner for the DormTopology v1 scene contract.

The public entry point is :func:`plan_routes`. It is a pure function: input is
never mutated, no files are written, and the returned dictionary is directly
serializable as ``cable_routing.json``.
"""

from __future__ import annotations

import heapq
import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

from backend.app.domain.geometry import direction_to_world, local_to_world

from .geometry import (
    AABB,
    BEZIER_SAMPLE_ERROR,
    EPSILON,
    Point,
    aabb_from_item,
    aabb_from_zone,
    add,
    beziers_arc_length,
    distance,
    dot,
    exposed_bezier_length,
    exposed_polyline_length,
    length,
    minimum_curve_radius,
    normalize,
    point,
    sample_beziers,
    scale,
    segment_intersects_aabb,
    segment_segment_distance,
    sub,
)

SUPPORTED_CABLE_TYPES = {"power", "usb", "network", "hdmi"}
SUPPORTED_THICKNESSES = {"thin", "thick"}
SUPPORTED_MODES = {"slot", "backboard"}
PORT_TYPES = {"power_source", "power_sink", "usb", "network", "hdmi"}
ERROR_MESSAGES = {
    "invalid_input": "The scene or cable fields are invalid",
    "collision": "The verified path collides with forbidden geometry",
    "incompatible_ports": "Cable and port types are incompatible",
    "port_occupied": "A port capacity is exceeded",
    "length_exceeded": "Path length plus slack exceeds the cable length",
    "endpoint_blocked": "An endpoint lead-out is blocked",
    "no_path": "No path satisfies clearance, bend, and exclusion constraints",
    "unsupported_mode": "The selected routing mode has no configured channel",
}


class RoutingInputError(ValueError):
    """Raised when the complete scene cannot enter routing."""

    def __init__(self, message: str, *, field: str | None = None):
        super().__init__(message)
        self.field = field


@dataclass(frozen=True)
class ResolvedEndpoint:
    port_id: str
    item_id: str
    position: Point
    direction: Point
    collision_box: AABB


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


@dataclass(frozen=True)
class SearchPath:
    points: tuple[Point, ...]
    edge_ids: tuple[str, ...]
    required_points: tuple[Point, ...] = ()
    # Each route segment carries the configured channel radius when it is a
    # graph edge. Endpoint lead-outs and open-space connector segments carry
    # ``None`` and are validated by collision geometry only.
    corridors: tuple[tuple[Point, Point, float | None], ...] = ()


def _finite(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise RoutingInputError(f"{field} must be a finite number", field=field)
    return float(value)


def _point(value: Any, field: str) -> Point:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise RoutingInputError(f"{field} must contain three coordinates", field=field)
    return tuple(_finite(component, f"{field}[{index}]") for index, component in enumerate(value))  # type: ignore[return-value]


def _positive(value: Any, field: str) -> float:
    result = _finite(value, field)
    if result <= 0:
        raise RoutingInputError(f"{field} must be positive", field=field)
    return result


def _non_negative(value: Any, field: str) -> float:
    result = _finite(value, field)
    if result < 0:
        raise RoutingInputError(f"{field} must be non-negative", field=field)
    return result


def _required(mapping: dict, key: str, field: str | None = None) -> Any:
    if key not in mapping:
        raise RoutingInputError(f"missing field {key}", field=field or key)
    return mapping[key]


def _id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise RoutingInputError(f"{field} must be a non-empty string", field=field)
    return value


def _unique_ids(groups: Iterable[Iterable[dict]], *, field: str = "id") -> None:
    seen: set[str] = set()
    for group in groups:
        for entity in group:
            entity_id = _id(_required(entity, field), field)
            if entity_id in seen:
                raise RoutingInputError(f"duplicate id {entity_id}", field=field)
            seen.add(entity_id)


def _validate_box_entity(entity: dict, field: str) -> None:
    _id(_required(entity, "id", field), f"{field}.id")
    minimum = _point(_required(entity, "min", field), f"{field}.min")
    maximum = _point(_required(entity, "max", field), f"{field}.max")
    if any(lower >= upper for lower, upper in zip(minimum, maximum)):
        raise RoutingInputError(f"{field} bounds must be strictly increasing", field=field)


def validate_scene(scene: dict) -> None:
    """Validate structural fields before any graph search starts."""
    if not isinstance(scene, dict):
        raise RoutingInputError("scene must be an object")
    for key in (
        "schema_version",
        "scene_id",
        "scene_revision",
        "baseline_id",
        "template_id",
        "desk",
        "wall",
        "items",
        "regions",
        "obstacles",
        "reserved_zones",
        "exposure_zones",
        "routing_graph",
        "cables",
    ):
        _required(scene, key)
    if scene["schema_version"] != "1.0":
        raise RoutingInputError("unsupported schema_version", field="schema_version")
    _id(scene["scene_id"], "scene_id")
    revision = scene["scene_revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise RoutingInputError("scene_revision must be a positive integer", field="scene_revision")
    if not isinstance(scene["baseline_id"], str) or not scene["baseline_id"]:
        raise RoutingInputError("baseline_id must be a confirmed snapshot id", field="baseline_id")
    if not isinstance(scene["items"], list) or not isinstance(scene["cables"], list):
        raise RoutingInputError("items and cables must be arrays")
    if not isinstance(scene["regions"], list):
        raise RoutingInputError("regions must be an array", field="regions")
    for key in ("obstacles", "reserved_zones", "exposure_zones"):
        if not isinstance(scene[key], list):
            raise RoutingInputError(f"{key} must be an array", field=key)

    desk = scene["desk"]
    if not isinstance(desk, dict):
        raise RoutingInputError("desk must be an object", field="desk")
    for key in ("width_m", "depth_m", "top_height_m"):
        _positive(_required(desk, key, "desk"), f"desk.{key}")
    wall = scene["wall"]
    if not isinstance(wall, dict):
        raise RoutingInputError("wall must be an object", field="wall")
    _finite(_required(wall, "z_m", "wall"), "wall.z_m")
    bounds = _required(wall, "bounds_xy_m", "wall")
    if not isinstance(bounds, (list, tuple)) or len(bounds) != 4:
        raise RoutingInputError("wall.bounds_xy_m must contain four values", field="wall.bounds_xy_m")
    wall_bounds = tuple(_finite(value, "wall.bounds_xy_m") for value in bounds)
    if wall_bounds[0] >= wall_bounds[1] or wall_bounds[2] >= wall_bounds[3]:
        raise RoutingInputError("wall bounds must be strictly increasing", field="wall.bounds_xy_m")

    for index, region in enumerate(scene["regions"]):
        if not isinstance(region, dict):
            raise RoutingInputError("region must be an object", field=f"regions[{index}]")
        _id(_required(region, "id"), f"regions[{index}].id")
        _finite(_required(region, "surface_y_m"), f"regions[{index}].surface_y_m")
        bounds = _required(region, "bounds_xz_m")
        if not isinstance(bounds, (list, tuple)) or len(bounds) != 4:
            raise RoutingInputError("region bounds must contain four values", field=f"regions[{index}]")
        values = tuple(_finite(value, f"regions[{index}].bounds_xz_m") for value in bounds)
        if values[0] >= values[1] or values[2] >= values[3]:
            raise RoutingInputError("region bounds must be strictly increasing", field=f"regions[{index}]")
        _positive(_required(region, "clearance_height_m"), f"regions[{index}].clearance_height_m")

    for key in ("obstacles", "reserved_zones", "exposure_zones"):
        for index, entity in enumerate(scene[key]):
            if not isinstance(entity, dict):
                raise RoutingInputError(f"{key} entity must be an object", field=f"{key}[{index}]")
            _validate_box_entity(entity, f"{key}[{index}]")

    item_ids: set[str] = set()
    port_ids: set[str] = set()
    ports: dict[str, tuple[dict, dict]] = {}
    for item_index, item in enumerate(scene["items"]):
        field = f"items[{item_index}]"
        if not isinstance(item, dict):
            raise RoutingInputError("item must be an object", field=field)
        item_id = _id(_required(item, "id", field), f"{field}.id")
        if item_id in item_ids:
            raise RoutingInputError(f"duplicate id {item_id}", field=f"{field}.id")
        item_ids.add(item_id)
        _required(item, "name", field)
        category = _required(item, "category", field)
        if item.get("dimensions_confirmed") is not True:
            raise RoutingInputError(
                "routing item dimensions are not confirmed",
                field=f"{field}.dimensions_confirmed",
            )
        size = _point(_required(item, "size_m", field), f"{field}.size_m")
        if any(value <= 0 for value in size):
            raise RoutingInputError("item size must be positive", field=f"{field}.size_m")
        _point(_required(item, "position", field), f"{field}.position")
        _finite(_required(item, "rotation_y_rad", field), f"{field}.rotation_y_rad")
        collision = item.get("collision")
        if not isinstance(collision, dict) or collision.get("type") != "box":
            raise RoutingInputError("only box collision is supported", field=f"{field}.collision")
        if not isinstance(item.get("ports"), list):
            raise RoutingInputError("item ports must be an array", field=f"{field}.ports")
        for port_index, port in enumerate(item["ports"]):
            port_field = f"{field}.ports[{port_index}]"
            if not isinstance(port, dict):
                raise RoutingInputError("port must be an object", field=port_field)
            port_id = _id(_required(port, "id", port_field), f"{port_field}.id")
            if port_id in port_ids or port_id in item_ids:
                raise RoutingInputError(f"duplicate id {port_id}", field=f"{port_field}.id")
            port_ids.add(port_id)
            port_type = _required(port, "type", port_field)
            if not isinstance(port_type, str) or port_type not in PORT_TYPES:
                raise RoutingInputError(f"unsupported port type {port_type}", field=f"{port_field}.type")
            _point(_required(port, "local_position", port_field), f"{port_field}.local_position")
            local_direction = _point(_required(port, "local_direction", port_field), f"{port_field}.local_direction")
            if abs(length(local_direction) - 1.0) > 0.001:
                raise RoutingInputError("local_direction must be a unit vector", field=f"{port_field}.local_direction")
            capacity = _required(port, "capacity", port_field)
            if isinstance(capacity, bool) or not isinstance(capacity, int) or capacity < 1:
                raise RoutingInputError("port capacity must be a positive integer", field=f"{port_field}.capacity")
            ports[port_id] = (item, port)
        if category == "power_strip":
            socket_count = item.get("socket_count")
            if socket_count not in (4, 6, 8):
                raise RoutingInputError("power_strip socket_count must be 4, 6, or 8", field=f"{field}.socket_count")
            source_count = sum(port["type"] == "power_source" for port in item["ports"])
            sink_count = sum(port["type"] == "power_sink" for port in item["ports"])
            if source_count != socket_count or sink_count != 1:
                raise RoutingInputError(
                    "power_strip must have socket_count power_source ports and one power_sink bus port",
                    field=field,
                )

    overlap = item_ids & port_ids
    if overlap:
        duplicate = min(overlap)
        raise RoutingInputError(f"duplicate id {duplicate}", field="id")

    graph = scene["routing_graph"]
    if not isinstance(graph, dict):
        raise RoutingInputError("routing_graph must be an object", field="routing_graph")
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise RoutingInputError("routing_graph nodes and edges must be arrays", field="routing_graph")
    node_ids: set[str] = set()
    node_positions: set[Point] = set()
    node_positions_by_id: dict[str, Point] = {}
    valid_kinds = {"corner", "slot", "fixing_point", "endpoint"}
    for index, node in enumerate(nodes):
        field = f"routing_graph.nodes[{index}]"
        if not isinstance(node, dict):
            raise RoutingInputError("node must be an object", field=field)
        node_id = _id(_required(node, "id", field), f"{field}.id")
        if node_id in node_ids or node_id in item_ids or node_id in port_ids:
            raise RoutingInputError(f"duplicate id {node_id}", field=f"{field}.id")
        node_ids.add(node_id)
        node_position = _point(_required(node, "position", field), f"{field}.position")
        if any(distance(node_position, existing) <= 1e-9 for existing in node_positions):
            raise RoutingInputError("routing graph nodes must have unique positions", field=f"{field}.position")
        node_positions.add(node_position)
        node_positions_by_id[node_id] = node_position
        node_kind = _required(node, "kind", field)
        if not isinstance(node_kind, str) or node_kind not in valid_kinds:
            raise RoutingInputError("unsupported node kind", field=f"{field}.kind")
    edge_ids: set[str] = set()
    for index, edge in enumerate(edges):
        field = f"routing_graph.edges[{index}]"
        if not isinstance(edge, dict):
            raise RoutingInputError("edge must be an object", field=field)
        edge_id = _id(_required(edge, "id", field), f"{field}.id")
        if edge_id in edge_ids or edge_id in item_ids or edge_id in port_ids or edge_id in node_ids:
            raise RoutingInputError(f"duplicate id {edge_id}", field=f"{field}.id")
        edge_ids.add(edge_id)
        from_node_id = _id(_required(edge, "from_node_id", field), f"{field}.from_node_id")
        to_node_id = _id(_required(edge, "to_node_id", field), f"{field}.to_node_id")
        if from_node_id not in node_ids or to_node_id not in node_ids:
            raise RoutingInputError("edge references an unknown node", field=field)
        if from_node_id == to_node_id:
            raise RoutingInputError("routing graph edges cannot be self-loops", field=f"{field}.from_node_id")
        modes = _required(edge, "modes", field)
        if (
            not isinstance(modes, list)
            or not modes
            or any(not isinstance(mode, str) for mode in modes)
            or not set(modes).issubset(SUPPORTED_MODES)
        ):
            raise RoutingInputError("edge modes must be a non-empty subset of slot/backboard", field=f"{field}.modes")
        if distance(node_positions_by_id[from_node_id], node_positions_by_id[to_node_id]) <= 1e-9:
            raise RoutingInputError("routing graph edges must have non-zero length", field=field)
        _positive(_required(edge, "clearance_radius_m", field), f"{field}.clearance_radius_m")
        if not isinstance(_required(edge, "exposed", field), bool):
            raise RoutingInputError("edge exposed must be boolean", field=f"{field}.exposed")

    cable_ids: set[str] = set()
    for index, cable in enumerate(scene["cables"]):
        field = f"cables[{index}]"
        if not isinstance(cable, dict):
            raise RoutingInputError("cable must be an object", field=field)
        cable_id = _id(_required(cable, "id", field), f"{field}.id")
        if cable_id in cable_ids or cable_id in item_ids or cable_id in port_ids or cable_id in node_ids or cable_id in edge_ids:
            raise RoutingInputError(f"duplicate id {cable_id}", field=f"{field}.id")
        cable_ids.add(cable_id)
        for key in ("start_port_id", "end_port_id", "cable_type", "thickness", "mode"):
            _required(cable, key, field)
        start_port_id = _id(cable["start_port_id"], f"{field}.start_port_id")
        end_port_id = _id(cable["end_port_id"], f"{field}.end_port_id")
        if start_port_id not in ports or end_port_id not in ports:
            raise RoutingInputError("cable references an unknown port", field=field)
        if start_port_id == end_port_id:
            raise RoutingInputError("cable endpoints must be different", field=field)
        if (
            not isinstance(cable["cable_type"], str)
            or not isinstance(cable["thickness"], str)
            or cable["cable_type"] not in SUPPORTED_CABLE_TYPES
            or cable["thickness"] not in SUPPORTED_THICKNESSES
        ):
            raise RoutingInputError("unsupported cable type or thickness", field=field)
        if not isinstance(cable["mode"], str) or cable["mode"] not in SUPPORTED_MODES:
            raise RoutingInputError("unsupported cable mode", field=field)
        _positive(cable["length_m"], f"{field}.length_m")
        _positive(cable["diameter_m"], f"{field}.diameter_m")
        _positive(cable["min_bend_radius_m"], f"{field}.min_bend_radius_m")
        _non_negative(cable["slack_m"], f"{field}.slack_m")
        if "baseline_path_points" in cable:
            baseline = cable["baseline_path_points"]
            if not isinstance(baseline, list) or len(baseline) < 2:
                raise RoutingInputError("baseline_path_points must contain at least two points", field=field)
            for point_index, value in enumerate(baseline):
                _point(value, f"{field}.baseline_path_points[{point_index}]")

    for cable in scene["cables"]:
        for port_id in (cable["start_port_id"], cable["end_port_id"]):
            _, port = ports[port_id]
            if port.get("confirmed") is not True:
                raise RoutingInputError("routing port is not confirmed", field=f"{port_id}.confirmed")

    _unique_ids(
        (
            scene["regions"],
            scene["obstacles"],
            scene["reserved_zones"],
            scene["exposure_zones"],
        )
    )
    all_other_ids = item_ids | port_ids | node_ids | edge_ids | cable_ids
    for group in (scene["regions"], scene["obstacles"], scene["reserved_zones"], scene["exposure_zones"]):
        for entity in group:
            if entity["id"] in all_other_ids:
                raise RoutingInputError(f"duplicate id {entity['id']}", field="id")
            all_other_ids.add(entity["id"])


def resolve_port_world(item: dict, port: dict) -> tuple[Point, Point]:
    """Transform a confirmed local port using the contract's Y rotation."""
    position = local_to_world(item, port["local_position"])
    direction = normalize(direction_to_world(item, port["local_direction"]))
    return position, direction


def _build_endpoints(scene: dict) -> dict[str, ResolvedEndpoint]:
    endpoints: dict[str, ResolvedEndpoint] = {}
    for item in scene["items"]:
        box = aabb_from_item(item)
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
    }

def _valid(cable: dict, segments: Sequence[Sequence[Point]], samples: Sequence[Point], path_length: float) -> dict:
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
    }


def _line_control_points(start: Point, end: Point) -> tuple[Point, Point, Point, Point]:
    vector = sub(end, start)
    return (start, add(start, scale(vector, 1.0 / 3.0)), add(start, scale(vector, 2.0 / 3.0)), end)


def _polyline_to_beziers(
    points: Sequence[Point],
    minimum_radius: float,
    *,
    start_direction: Point | None = None,
    end_direction: Point | None = None,
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
        core = _polyline_to_beziers(route_points, minimum_radius)
        if not core:
            return None
        adjusted = list(core)
        if has_start_leadout:
            first = list(adjusted[0])
            handle_length = distance(first[0], first[3]) / 3.0
            first[1] = add(first[0], scale(normalize(start_direction), handle_length))
            adjusted[0] = tuple(first)
        if has_end_leadout:
            last = list(adjusted[-1])
            handle_length = distance(last[0], last[3]) / 3.0
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
        tangent = minimum_radius * math.tan(turn / 2.0)
        if tangent > previous_length / 2.0 or tangent > following_length / 2.0:
            return None
        entry = sub(current, scale(incoming, tangent))
        exit = add(current, scale(outgoing, tangent))
        handle = (4.0 / 3.0) * minimum_radius * math.tan(turn / 4.0)
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


def _segment_clear(start: Point, end: Point, radius: float, boxes: Sequence[AABB]) -> bool:
    return not any(segment_intersects_aabb(start, end, box, radius + EPSILON) for box in boxes)


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
) -> list[tuple[Point, Point, Point, Point]]:
    """Offset a curve through a shared channel while keeping its endpoints.

    A smooth zero-at-end ramp keeps the verified endpoint lead-outs unchanged;
    the same offset is applied at every shared segment boundary so the chain
    remains continuous. The resulting curve is always re-sampled and fully
    re-validated by the caller.
    """
    segment_lengths = [distance(segment[0], segment[3]) for segment in segments]
    total = sum(segment_lengths)
    if total <= 1e-12:
        return [tuple(segment) for segment in segments]
    prefix = 0.0
    result: list[tuple[Point, Point, Point, Point]] = []
    for segment, segment_length in zip(segments, segment_lengths):
        control_points: list[Point] = []
        for index, value in enumerate(segment):
            fraction = (prefix + segment_length * index / 3.0) / total
            ramp = math.sin(math.pi * max(0.0, min(1.0, fraction))) ** 2
            control_points.append(add(value, scale(lateral, sign * offset * ramp)))
        result.append(tuple(control_points))
        prefix += segment_length
    return result


def _lane_candidates(
    segments: Sequence[Sequence[Point]],
    radius: float,
    occupied: Sequence[tuple[Sequence[Point], float]],
    channel_clearance: float,
) -> Iterable[list[tuple[Point, Point, Point, Point]]]:
    if not occupied:
        return ()
    direction = sub(segments[-1][-1], segments[0][0])
    if length(direction) <= 1e-9:
        return ()
    lateral = _lateral_direction(normalize(direction))
    required = max(
        radius + other_radius + EPSILON + 2.0 * BEZIER_SAMPLE_ERROR
        for _, other_radius in occupied
    )
    available = channel_clearance - radius - EPSILON
    if available + EPSILON < required:
        return ()
    candidates: list[list[tuple[Point, Point, Point, Point]]] = []
    for sign in (1.0, -1.0):
        for factor in (1.0, 1.5, 2.0, 3.0, 5.0, 7.0):
            offset = required * factor
            if offset <= available + EPSILON:
                candidates.append(_offset_beziers(segments, offset, sign, lateral))
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
    item_boxes: dict[str, AABB],
    start_item_id: str,
    end_item_id: str,
) -> bool:
    forbidden = list(obstacles) + list(reserved)
    # The collision sweep uses chord samples. Include the sampler's maximum
    # geometric error so the sampled check remains conservative for the
    # continuous Bezier curve.
    clearance = radius + EPSILON + BEZIER_SAMPLE_ERROR
    start_box = item_boxes[start_item_id].inflated(clearance)
    end_box = item_boxes[end_item_id].inflated(clearance)
    start_exit_seen = False
    end_entry_seen = False

    def inside(value: Point, box: AABB) -> bool:
        return all(box.minimum[axis] <= value[axis] <= box.maximum[axis] for axis in range(3))

    for start, end in pairwise(samples):
        if any(segment_intersects_aabb(start, end, box, clearance) for box in forbidden):
            return True
        for item_id, box in item_boxes.items():
            inflated = start_box if item_id == start_item_id else end_box if item_id == end_item_id else box.inflated(clearance)
            if item_id == end_item_id and end_entry_seen:
                continue
            if item_id == start_item_id and not start_exit_seen and segment_intersects_aabb(start, end, inflated, 0.0):
                if inside(start, inflated):
                    if not inside(end, inflated):
                        start_exit_seen = True
                    continue
                return True
            if item_id == end_item_id and not end_entry_seen and segment_intersects_aabb(start, end, inflated, 0.0):
                if inside(end, inflated):
                    if not inside(start, inflated):
                        end_entry_seen = True
                    continue
                return True
            if segment_intersects_aabb(start, end, inflated, 0.0):
                return True
    return False


def _arc_clearance(
    start: Point,
    end: Point,
    radius: float,
    boxes: Sequence[AABB],
) -> bool:
    return _segment_clear(start, end, radius, boxes)


def _endpoint_exit(endpoint: ResolvedEndpoint, radius: float) -> Point:
    """Return a short point beyond the first outward ray exit.

    The extra tolerance keeps the post-exit graph segment from being rejected
    solely because its first point lies on the inflated AABB boundary. If an
    interface is already outside its conservative box, no exemption is needed.
    """
    box = endpoint.collision_box.inflated(radius + EPSILON)
    origin = endpoint.position
    direction = normalize(endpoint.direction)
    inside = all(box.minimum[axis] <= origin[axis] <= box.maximum[axis] for axis in range(3))
    if not inside:
        return origin
    distances: list[float] = []
    for axis, component in enumerate(direction):
        if component > 1e-12:
            distances.append((box.maximum[axis] - origin[axis]) / component)
        elif component < -1e-12:
            distances.append((box.minimum[axis] - origin[axis]) / component)
    positive = [value for value in distances if value >= -EPSILON]
    if not positive:
        return origin
    distance_to_exit = max(0.0, min(positive))
    return add(origin, scale(direction, distance_to_exit + EPSILON))


def _search_path(
    nodes: dict[str, tuple[Point, str]],
    edges: list[dict],
    start: ResolvedEndpoint,
    end: ResolvedEndpoint,
    spec: CableSpec,
    obstacle_boxes: Sequence[AABB],
    reserved_boxes: Sequence[AABB],
    item_boxes: dict[str, AABB],
    banned_edges: set[str],
    use_dijkstra: bool,
    candidate_node_ids: set[str] | None = None,
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
    start_exit = _endpoint_exit(start, spec.radius)
    end_exit = _endpoint_exit(end, spec.radius)
    start_leadout = distance(start.position, start_exit)
    end_leadout = distance(end.position, end_exit)
    adjacency: dict[str, list[Arc]] = {node_id: [] for node_id in nodes}
    adjacency[start_node] = []
    adjacency[end_node] = []
    start_candidates = False
    end_candidates = False
    for node_id, (node_position, _) in nodes.items():
        if candidate_node_ids is not None and node_id not in candidate_node_ids:
            continue
        if (
            _arc_clearance(start.position, start_exit, spec.radius, start_connection_boxes)
            and _arc_clearance(start_exit, node_position, spec.radius, all_boxes)
        ):
            adjacency[start_node].append(Arc(node_id, distance(start_exit, node_position), None, False))
            start_candidates = True
        if (
            _arc_clearance(node_position, end_exit, spec.radius, all_boxes)
            and _arc_clearance(end_exit, end.position, spec.radius, end_connection_boxes)
        ):
            adjacency[node_id].append(Arc(end_node, distance(node_position, end_exit) + end_leadout, None, False))
            end_candidates = True

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
        edge_length = distance(from_position, to_position)
        adjacency[from_id].append(Arc(to_id, edge_length, edge_id, bool(edge["exposed"])))
        adjacency[to_id].append(Arc(from_id, edge_length, edge_id, bool(edge["exposed"])))

    required_kind = "slot" if spec.mode == "slot" else "fixing_point"
    positions = {node_id: value[0] for node_id, value in nodes.items()}
    exposure_penalty = 0.2
    bend_penalty = 0.03
    start_states: list[tuple[str, bool, bool, str | None, float]] = []
    for arc in adjacency[start_node]:
        start_states.append(
            (
                arc.target,
                nodes[arc.target][1] == required_kind,
                False,
                start_node,
                start_leadout + arc.length,
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
        if any(arc.target == end_node for arc in adjacency[node_id]) and passed and used_edge:
            goal = state
            break
        for arc in sorted(adjacency[node_id], key=lambda candidate: (candidate.target, candidate.edge_id or "")):
            if arc.target == start_node:
                continue
            next_passed = passed or (arc.target in nodes and nodes[arc.target][1] == required_kind)
            if arc.target == end_node and not next_passed:
                continue
            next_used_edge = used_edge or arc.edge_id is not None
            turn_cost = 0.0
            if previous not in (None, start_node) and node_id in positions and previous in positions:
                previous_vector = sub(positions[node_id], positions[previous])
                next_vector = sub(
                    (end.position if arc.target == end_node else positions[arc.target]),
                    positions[node_id],
                )
                if length(previous_vector) > 1e-9 and length(next_vector) > 1e-9:
                    previous_direction = normalize(previous_vector)
                    next_direction = normalize(next_vector)
                    turn_cost = bend_penalty * (1.0 - dot(previous_direction, next_direction))
            next_cost = cost + arc.length + (exposure_penalty * arc.length if arc.exposed else 0.0) + turn_cost
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
    item_boxes: dict[str, AABB],
    occupied: Sequence[tuple[Sequence[Point], float]],
    required_points: Sequence[Point] = (),
    required_tolerance: float = EPSILON,
    corridors: Sequence[tuple[Point, Point, float | None]] = (),
) -> tuple[str | None, float]:
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
    first_direction = normalize(sub(samples[1], samples[0]))
    last_direction = normalize(sub(samples[-1], samples[-2]))
    if dot(first_direction, start.direction) < -0.25 or dot(last_direction, end.direction) > 0.25:
        return "endpoint_blocked", 0.0
    if _curve_collides(samples, spec.radius, obstacle_boxes, reserved_boxes, item_boxes, start.item_id, end.item_id):
        return "collision", 0.0
    if _tube_conflicts(samples, spec.radius, occupied):
        return "no_path", 0.0
    radius = minimum_curve_radius(segments)
    if radius + EPSILON < spec.min_bend_radius:
        return "no_path", 0.0
    path_length = beziers_arc_length(segments)
    if path_length + spec.cable["slack_m"] > spec.cable["length_m"] + EPSILON:
        return "length_exceeded", path_length
    return None, path_length


def _plan_one(
    scene: dict,
    cable: dict,
    endpoints: dict[str, ResolvedEndpoint],
    nodes: dict[str, tuple[Point, str]],
    edges: list[dict],
    obstacle_boxes: Sequence[AABB],
    reserved_boxes: Sequence[AABB],
    item_boxes: dict[str, AABB],
    occupied: Sequence[tuple[Sequence[Point], float]],
    use_dijkstra: bool,
) -> tuple[dict, tuple[Sequence[Point], float] | None]:
    start = endpoints[cable["start_port_id"]]
    end = endpoints[cable["end_port_id"]]
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
    for _attempt in range(3):
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
        )
        if search_path is None:
            if not start_candidates or not end_candidates:
                last_reason = "endpoint_blocked"
            else:
                last_reason = "no_path"
            break
        start_exit = _endpoint_exit(start, spec.radius)
        end_exit = _endpoint_exit(end, spec.radius)
        segments = _polyline_to_beziers(
            search_path.points,
            spec.min_bend_radius * 1.1,
            start_direction=start.direction
            if distance(start.position, start_exit) > 1e-9
            else None,
            end_direction=end.direction
            if distance(end.position, end_exit) > 1e-9
            else None,
        )
        if not segments:
            last_reason = "no_path"
        else:
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
                    )
                    if lane_reason is None:
                        return _valid(cable, lane_segments, lane_samples, lane_length), (
                            lane_samples,
                            spec.radius,
                        )
            if last_reason is None:
                return _valid(cable, segments, samples, path_length), (samples, spec.radius)
            if last_reason == "length_exceeded":
                saw_length_exceeded = True
        if search_path.edge_ids:
            banned_edges.add(search_path.edge_ids[min(_attempt, len(search_path.edge_ids) - 1)])
        else:
            break
    if saw_length_exceeded and last_reason in {"no_path", "length_exceeded"}:
        last_reason = "length_exceeded"
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
    for cable in scene["cables"]:
        counts[cable["start_port_id"]] += 1
        counts[cable["end_port_id"]] += 1
    return {
        port_id
        for port_id, count in counts.items()
        if count > ports[port_id]["capacity"]
    }


def _candidate_count(
    cable: dict,
    endpoints: dict[str, ResolvedEndpoint],
    nodes: dict[str, tuple[Point, str]],
    edges: Sequence[dict],
    obstacle_boxes: Sequence[AABB],
    reserved_boxes: Sequence[AABB],
    item_boxes: dict[str, AABB],
) -> int:
    """Estimate usable endpoint-to-channel connections for stable ordering."""
    mode_edges = [edge for edge in edges if cable["mode"] in edge["modes"]]
    candidate_node_ids = {
        node_id
        for edge in mode_edges
        for node_id in (edge["from_node_id"], edge["to_node_id"])
    }
    if not candidate_node_ids:
        return 0
    start, end = endpoints[cable["start_port_id"]], endpoints[cable["end_port_id"]]
    radius = cable["diameter_m"] / 2.0
    start_exit, end_exit = _endpoint_exit(start, radius), _endpoint_exit(end, radius)
    all_boxes = list(obstacle_boxes) + list(reserved_boxes) + list(item_boxes.values())
    start_boxes = list(obstacle_boxes) + list(reserved_boxes) + [
        box for item_id, box in item_boxes.items() if item_id != start.item_id
    ]
    end_boxes = list(obstacle_boxes) + list(reserved_boxes) + [
        box for item_id, box in item_boxes.items() if item_id != end.item_id
    ]
    start_leadout_clear = _arc_clearance(start.position, start_exit, radius, start_boxes)
    end_leadout_clear = _arc_clearance(end_exit, end.position, radius, end_boxes)
    start_count = 0
    end_count = 0
    for node_id in candidate_node_ids:
        node_position = nodes[node_id][0]
        if start_leadout_clear and _arc_clearance(start_exit, node_position, radius, all_boxes):
            start_count += 1
        if end_leadout_clear and _arc_clearance(node_position, end_exit, radius, all_boxes):
            end_count += 1
    return min(start_count, end_count)


def plan_routes(scene: dict, *, use_dijkstra: bool = False) -> dict:
    """Validate and route every cable in a scene.

    ``use_dijkstra`` is a deterministic debug switch used to compare the A*
    implementation against the same non-negative graph cost function.
    """
    validate_scene(scene)
    endpoints = _build_endpoints(scene)
    nodes = {node["id"]: (point(node["position"]), node["kind"]) for node in scene["routing_graph"]["nodes"]}
    edges = scene["routing_graph"]["edges"]
    obstacle_boxes = [aabb_from_zone(zone) for zone in scene["obstacles"]]
    reserved_boxes = [aabb_from_zone(zone) for zone in scene["reserved_zones"]]
    exposure_boxes = [aabb_from_zone(zone) for zone in scene["exposure_zones"]]
    item_boxes = {item["id"]: aabb_from_item(item) for item in scene["items"]}
    occupied_ports = _validate_port_capacity(scene)
    ordered_cables = sorted(
        scene["cables"],
        key=lambda cable: (
            _candidate_count(
                cable,
                endpoints,
                nodes,
                edges,
                obstacle_boxes,
                reserved_boxes,
                item_boxes,
            ),
            -cable["diameter_m"],
            cable["id"],
        ),
    )
    results_by_id: dict[str, dict] = {}
    occupied: list[tuple[Sequence[Point], float]] = []
    for cable in ordered_cables:
        if cable["start_port_id"] in occupied_ports or cable["end_port_id"] in occupied_ports:
            results_by_id[cable["id"]] = _issue(cable, "port_occupied")
            continue
        result, tube = _plan_one(
            scene,
            cable,
            endpoints,
            nodes,
            edges,
            obstacle_boxes,
            reserved_boxes,
            item_boxes,
            occupied,
            use_dijkstra,
        )
        results_by_id[cable["id"]] = result
        if tube is not None:
            occupied.append(tube)

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
    }
