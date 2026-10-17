"""Validate the scene contract before running domain algorithms."""

import math

from .errors import SceneInputError


def _fail(field: str, message: str):
    raise SceneInputError(f"{field}: {message}", field=field)


def _object(value, fields: str, path: str) -> dict:
    if not isinstance(value, dict):
        _fail(path, "must be an object")
    for key in fields.split():
        if key not in value:
            _fail(f"{path}.{key}", "missing field")
    return value


def _array(value, path: str) -> list:
    if not isinstance(value, list):
        _fail(path, "must be an array")
    return value


def _string(value, path: str) -> str:
    if not isinstance(value, str) or not value:
        _fail(path, "must be a non-empty string")
    return value


def _number(value, path: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(path, "must be a finite number")
    try:
        result = float(value)
    except OverflowError:
        _fail(path, "must be a finite number")
    if not math.isfinite(result) or (positive and result <= 0):
        _fail(path, "must be finite and positive" if positive else "must be finite")
    return result


def _vector(value, count: int, path: str) -> list[float]:
    values = _array(value, path)
    if len(values) != count:
        _fail(path, f"must contain {count} numbers")
    return [_number(v, path) for v in values]


def _bounds(value, path: str) -> None:
    a, b, c, d = _vector(value, 4, path)
    if a >= b or c >= d:
        _fail(path, "bounds must be strictly increasing")


def _boolean(value, path: str) -> None:
    if not isinstance(value, bool):
        _fail(path, "must be boolean")


def _enum(value, choices, path: str) -> None:
    if not isinstance(value, str) or value not in choices:
        _fail(path, f"expected one of {sorted(choices)}")


def _nullable_string(value, path: str) -> None:
    if value is not None:
        _string(value, path)


def validate_scene(scene: dict, *, for_planning: bool = False) -> None:
    """No mutation. Draft geometry checks permit unconfirmed dimensions/baseline.

    Packing requires a confirmed baseline and every item's dimensions. Port
    confirmation is a routing prerequisite, not a packing prerequisite.
    """
    _object(
        scene,
        "schema_version scene_id scene_revision baseline_id template_id desk wall "
        "items regions obstacles reserved_zones exposure_zones routing_graph cables",
        "scene",
    )
    if scene["schema_version"] != "1.0":
        _fail("schema_version", "unsupported version")
    for key in ("scene_id", "template_id"):
        _string(scene[key], key)
    revision = scene["scene_revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        _fail("scene_revision", "must be a positive integer")
    _nullable_string(scene["baseline_id"], "baseline_id")
    if for_planning and scene["baseline_id"] is None:
        _fail("baseline_id", "confirm the original snapshot before packing")
    desk = _object(scene["desk"], "width_m depth_m top_height_m", "desk")
    for key in ("width_m", "depth_m", "top_height_m"):
        _number(desk[key], f"desk.{key}", positive=True)
    wall = _object(scene["wall"], "z_m bounds_xy_m", "wall")
    _number(wall["z_m"], "wall.z_m")
    _bounds(wall["bounds_xy_m"], "wall.bounds_xy_m")

    seen: set[str] = set()

    def entity(value, fields: str, path: str) -> dict:
        obj = _object(value, "id " + fields, path)
        identifier = _string(obj["id"], path + ".id")
        if identifier in seen:
            _fail(path + ".id", f"duplicate ID {identifier}")
        seen.add(identifier)
        return obj

    regions = {}
    for i, value in enumerate(_array(scene["regions"], "regions")):
        path = f"regions[{i}]"
        region = entity(value, "surface_y_m bounds_xz_m clearance_height_m", path)
        _number(region["surface_y_m"], path + ".surface_y_m")
        _bounds(region["bounds_xz_m"], path + ".bounds_xz_m")
        _number(
            region["clearance_height_m"], path + ".clearance_height_m", positive=True
        )
        regions[region["id"]] = region
    for key in ("obstacles", "reserved_zones", "exposure_zones"):
        for i, value in enumerate(_array(scene[key], key)):
            path = f"{key}[{i}]"
            zone = entity(value, "min max", path)
            low = _vector(zone["min"], 3, path + ".min")
            high = _vector(zone["max"], 3, path + ".max")
            if any(a >= b for a, b in zip(low, high)):
                _fail(path, "box bounds must be strictly increasing")

    ports = {}
    for i, value in enumerate(_array(scene["items"], "items")):
        path = f"items[{i}]"
        item = entity(
            value,
            "name category size_m position rotation_y_rad dimensions_source "
            "dimensions_confirmed fixed usage_frequency allowed_region_ids "
            "allowed_rotations_y_rad collision ports image_url model_url generation",
            path,
        )
        _string(item["name"], path + ".name")
        _string(item["category"], path + ".category")
        size = _vector(item["size_m"], 3, path + ".size_m")
        if any(v <= 0 for v in size):
            _fail(path + ".size_m", "dimensions must be positive")
        _vector(item["position"], 3, path + ".position")
        _number(item["rotation_y_rad"], path + ".rotation_y_rad")
        _enum(
            item["dimensions_source"],
            {"user", "template", "estimated"},
            path + ".dimensions_source",
        )
        _boolean(item["dimensions_confirmed"], path + ".dimensions_confirmed")
        _boolean(item["fixed"], path + ".fixed")
        if for_planning and not item["dimensions_confirmed"]:
            _fail(path + ".dimensions_confirmed", "confirm dimensions before packing")
        _enum(
            item["usage_frequency"],
            {"high", "medium", "low"},
            path + ".usage_frequency",
        )
        allowed = _array(item["allowed_region_ids"], path + ".allowed_region_ids")
        if not allowed and not item["fixed"]:
            _fail(path + ".allowed_region_ids", "movable items need a target region")
        for region_id in allowed:
            _string(region_id, path + ".allowed_region_ids")
            if region_id not in regions:
                _fail(path + ".allowed_region_ids", f"unknown region {region_id}")
        rotations = _array(
            item["allowed_rotations_y_rad"], path + ".allowed_rotations_y_rad"
        )
        if not rotations:
            _fail(path + ".allowed_rotations_y_rad", "must not be empty")
        for angle in rotations:
            angle = _number(angle, path + ".allowed_rotations_y_rad")
            if angle not in (0.0, math.pi / 2):
                _fail(
                    path + ".allowed_rotations_y_rad", "only 0 and pi/2 are supported"
                )
        collision = _object(item["collision"], "type", path + ".collision")
        _enum(collision["type"], {"box"}, path + ".collision.type")
        for key in ("image_url", "model_url"):
            _nullable_string(item[key], path + "." + key)
        generation = _object(
            item["generation"], "task_id status source error", path + ".generation"
        )
        for key in ("task_id", "error"):
            _nullable_string(generation[key], path + ".generation." + key)
        _enum(
            generation["status"],
            {"not_requested", "queued", "running", "succeeded", "failed"},
            path + ".generation.status",
        )
        _enum(
            generation["source"],
            {"placeholder", "live", "cache"},
            path + ".generation.source",
        )
        for j, value in enumerate(_array(item["ports"], path + ".ports")):
            pp = f"{path}.ports[{j}]"
            port = entity(
                value, "type local_position local_direction capacity confirmed", pp
            )
            _enum(
                port["type"],
                {"power_source", "power_sink", "usb", "network", "hdmi"},
                pp + ".type",
            )
            _vector(port["local_position"], 3, pp + ".local_position")
            direction = _vector(port["local_direction"], 3, pp + ".local_direction")
            if abs(math.hypot(*direction) - 1) > 0.001:
                _fail(pp + ".local_direction", "must be a unit vector")
            if type(port["capacity"]) is not int or port["capacity"] != 1:
                _fail(pp + ".capacity", "first version requires capacity 1")
            _boolean(port["confirmed"], pp + ".confirmed")
            ports[port["id"]] = port
        if item["category"] == "power_strip":
            count = item.get("socket_count")
            if type(count) is not int or count not in (4, 6, 8):
                _fail(path + ".socket_count", "expected 4, 6 or 8")
            if (
                sum(p["type"] == "power_source" for p in item["ports"]) != count
                or sum(p["type"] == "power_sink" for p in item["ports"]) != 1
            ):
                _fail(path + ".ports", "expected socket_count sources and one bus sink")

    graph = _object(scene["routing_graph"], "nodes edges", "routing_graph")
    nodes = {}
    for i, value in enumerate(_array(graph["nodes"], "routing_graph.nodes")):
        path = f"routing_graph.nodes[{i}]"
        node = entity(value, "position kind", path)
        _vector(node["position"], 3, path + ".position")
        _enum(
            node["kind"], {"corner", "slot", "fixing_point", "endpoint"}, path + ".kind"
        )
        nodes[node["id"]] = node
    for i, value in enumerate(_array(graph["edges"], "routing_graph.edges")):
        path = f"routing_graph.edges[{i}]"
        edge = entity(
            value, "from_node_id to_node_id modes clearance_radius_m exposed", path
        )
        for key in ("from_node_id", "to_node_id"):
            _string(edge[key], path + "." + key)
            if edge[key] not in nodes:
                _fail(path + "." + key, "unknown node")
        if (
            nodes[edge["from_node_id"]]["position"]
            == nodes[edge["to_node_id"]]["position"]
        ):
            _fail(path, "edge must have nonzero length")
        modes = _array(edge["modes"], path + ".modes")
        if not modes:
            _fail(path + ".modes", "must not be empty")
        for mode in modes:
            _enum(mode, {"slot", "backboard"}, path + ".modes")
        _number(edge["clearance_radius_m"], path + ".clearance_radius_m", positive=True)
        _boolean(edge["exposed"], path + ".exposed")
    for i, value in enumerate(_array(scene["cables"], "cables")):
        path = f"cables[{i}]"
        cable = entity(
            value,
            "start_port_id end_port_id cable_type thickness length_m diameter_m "
            "min_bend_radius_m slack_m mode",
            path,
        )
        for key in ("start_port_id", "end_port_id"):
            _string(cable[key], path + "." + key)
            if cable[key] not in ports:
                _fail(path + "." + key, "unknown port")
        if cable["start_port_id"] == cable["end_port_id"]:
            _fail(path, "endpoints must differ")
        for key, choices in (
            ("cable_type", {"power", "usb", "network", "hdmi"}),
            ("thickness", {"thick", "thin"}),
            ("mode", {"slot", "backboard"}),
        ):
            _enum(cable[key], choices, path + "." + key)
        for key in ("length_m", "diameter_m", "min_bend_radius_m"):
            _number(cable[key], path + "." + key, positive=True)
        if _number(cable["slack_m"], path + ".slack_m") < 0:
            _fail(path + ".slack_m", "must be nonnegative")
        if "baseline_path_points" in cable:
            points = _array(
                cable["baseline_path_points"], path + ".baseline_path_points"
            )
            if len(points) < 2:
                _fail(path + ".baseline_path_points", "expected at least two points")
            for p in points:
                _vector(p, 3, path + ".baseline_path_points")
