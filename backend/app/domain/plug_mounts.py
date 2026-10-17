"""Geometry for fixed adapters plugged directly into a fixed strip top."""

from __future__ import annotations

from itertools import pairwise

from .geometry import (
    EPSILON,
    NUMERIC_EPSILON,
    direction_to_world,
    distance,
    fits_region,
    local_to_world,
    normalize,
    world_to_local,
)
from .models import Issue

MAX_PLUG_OVERHANG_M = 0.02
MIN_PLUG_SUPPORT_RATIO = 0.5


def _clip(polygon, axis: int, boundary: float, *, lower: bool):
    result = []
    if not polygon:
        return result
    for start, end in pairwise([*polygon, polygon[0]]):
        start_inside = start[axis] >= boundary if lower else start[axis] <= boundary
        end_inside = end[axis] >= boundary if lower else end[axis] <= boundary
        if start_inside != end_inside:
            fraction = (boundary - start[axis]) / (end[axis] - start[axis])
            result.append(tuple(a + fraction * (b - a) for a, b in zip(start, end)))
        if end_inside:
            result.append(end)
    return result


def _area(polygon) -> float:
    if len(polygon) < 3:
        return 0.0
    return (
        abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in pairwise([*polygon, polygon[0]])))
        / 2
    )


def plug_mount_geometry_issues(scene: dict, adapter: dict) -> list[Issue]:
    """Check an already structurally validated mount using the current pose.

    Other-item and zone collisions remain the complete layout check's job.
    This exception supports only the named strip; it creates no general stack
    or horizontal placement region for other items.
    """
    mount = adapter["plug_mount"]
    strip = next(
        item
        for item in scene["items"]
        if any(port["id"] == mount["socket_port_id"] for port in item["ports"])
    )
    socket = next(
        port for port in strip["ports"] if port["id"] == mount["socket_port_id"]
    )
    plug = next(
        port for port in adapter["ports"] if port["id"] == mount["plug_port_id"]
    )
    problems: list[Issue] = []

    def report(code: str, message: str):
        problems.append({"entity_id": adapter["id"], "code": code, "message": message})

    socket_position = local_to_world(strip, socket["local_position"])
    plug_position = local_to_world(adapter, plug["local_position"])
    socket_direction = normalize(direction_to_world(strip, socket["local_direction"]))
    plug_direction = normalize(direction_to_world(adapter, plug["local_direction"]))
    if distance(socket_position, plug_position) > EPSILON + NUMERIC_EPSILON:
        report("invalid_input", "Direct plug world endpoints do not coincide")
    if distance(socket_direction, tuple(-value for value in plug_direction)) > EPSILON:
        report("invalid_input", "Direct plug directions must be opposite")

    for item, port, top, expected, label in (
        (strip, socket, strip["size_m"][1], (0.0, 1.0, 0.0), "Strip socket"),
        (adapter, plug, 0.0, (0.0, -1.0, 0.0), "Adapter plug"),
    ):
        x, y, z = port["local_position"]
        if (
            abs(y - top) > EPSILON + NUMERIC_EPSILON
            or abs(x) > item["size_m"][0] / 2 + NUMERIC_EPSILON
            or abs(z) > item["size_m"][2] / 2 + NUMERIC_EPSILON
            or distance(
                normalize(direction_to_world(item, port["local_direction"])), expected
            )
            > EPSILON
        ):
            report(
                "invalid_input",
                f"{label} must lie on its mating horizontal face and point outward",
            )

    strip_top = strip["position"][1] + strip["size_m"][1]
    if abs(adapter["position"][1] - strip_top) > EPSILON + NUMERIC_EPSILON:
        report("no_space", "Mounted adapter must rest at the strip top height")
    support_regions = [
        region for region in scene["regions"] if fits_region(strip, region)
    ]
    adapter_top = adapter["position"][1] + adapter["size_m"][1]
    if not support_regions:
        report("no_space", "Mounted adapter strip has no legal support region")
    elif not any(
        adapter_top
        <= region["surface_y_m"] + region["clearance_height_m"] + NUMERIC_EPSILON
        for region in support_regions
    ):
        report("no_space", "Mounted adapter exceeds its strip support region clearance")
    half_width, half_depth = strip["size_m"][0] / 2, strip["size_m"][2] / 2
    width, _, depth = adapter["size_m"]
    corners = [
        world_to_local(strip, local_to_world(adapter, (x, 0, z)))
        for x, z in (
            (-width / 2, -depth / 2),
            (width / 2, -depth / 2),
            (width / 2, depth / 2),
            (-width / 2, depth / 2),
        )
    ]
    polygon = [(corner[0], corner[2]) for corner in corners]
    if any(
        abs(x) > half_width + MAX_PLUG_OVERHANG_M + NUMERIC_EPSILON
        or abs(z) > half_depth + MAX_PLUG_OVERHANG_M + NUMERIC_EPSILON
        for x, z in polygon
    ):
        report("no_space", "Mounted adapter overhang exceeds 0.02m from the strip")
    clipped = polygon
    for axis, bound in ((0, half_width), (1, half_depth)):
        clipped = _clip(clipped, axis, -bound, lower=True)
        clipped = _clip(clipped, axis, bound, lower=False)
    if _area(clipped) + NUMERIC_EPSILON < _area(polygon) * MIN_PLUG_SUPPORT_RATIO:
        report(
            "no_space",
            "Mounted adapter needs at least half its base supported by the strip",
        )
    return problems
