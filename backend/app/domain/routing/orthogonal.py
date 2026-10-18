"""Bounded rectilinear routing on declared channels, with straight port exits.

Corners represent an installation layout, not a certified physical bend radius.
Only the short port-normal exit may be oblique when a device is rotated.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, replace
from itertools import count, pairwise, permutations

from .geometry import AABB, EPSILON, distance, dot, normalize, sub
from .spatial_cost import segment_penalty


def axis_aligned(a, b):
    return sum(abs(x - y) > 1e-12 for x, y in zip(a, b)) == 1


def _manhattan(a, b):
    seen = set()
    for order in permutations(range(3)):
        points = [a]
        for axis in order:
            point = list(points[-1])
            point[axis] = b[axis]
            point = tuple(point)
            if distance(points[-1], point) > 1e-9:
                points.append(point)
        key = tuple(points)
        if key not in seen:
            seen.add(key)
            yield key


def _escape_waypoints(exit_point, boxes, radius):
    """Allow low side sockets to leave an overhead exclusion before rising.

    Finite four-side detours; every segment still undergoes normal collision
    checks. This does not exempt the owning device or its overhead volume.
    """
    candidates = set()
    for box in boxes:
        if (0 <= box.minimum[1] - exit_point[1] <= .05
                and all(box.minimum[k] - radius <= exit_point[k] <= box.maximum[k] + radius for k in (0, 2))):
            for axis in (0, 2):
                for bound in (box.minimum[axis] - radius - .002, box.maximum[axis] + radius + .002):
                    p = list(exit_point)
                    p[axis] = bound
                    candidates.add(tuple(p))
    return sorted(candidates, key=lambda p: (distance(p, exit_point), p))[:8]


def _connectors(exit_point, target, direction, waypoints=()):
    # A small, finite set of vertical clearance levels lets neighboring ports
    # reach different lanes without crossing previously connected cables.
    for origin in (exit_point, *waypoints):
        for rise in (0.0, .012, .024, .036):
            raised = (origin[0], origin[1] + rise * (-1 if direction[1] < -.5 else 1), origin[2])
            prefix = (() if origin == exit_point else (exit_point,)) + ((origin,) if rise else ())
            for points in _manhattan(raised, target):
                candidate = prefix + points
                if any(dot(normalize(sub(b, a)), normalize(sub(c, b))) < -1 + 1e-8
                       for a, b, c in zip(candidate, candidate[1:], candidate[2:])):
                    continue
                yield candidate


@dataclass(frozen=True)
class Leg:
    target: str
    points: tuple
    cost: float
    edge: bool = False


def plan_orthogonal(scene, cable, endpoints, nodes, edges, obstacle_boxes,
                    reserved_boxes, item_boxes, occupied, use_dijkstra, support_context):
    # Import at call time: planner dispatches here and owns the common validators.
    from .planner import (
        CableSpec,
        _arc_clearance,
        _compatible,
        _endpoint_exit,
        _issue,
        _leadout_remainder,
        _line_control_points,
        _tube_conflicts,
        _valid,
        _validate_curve,
    )
    from .support import analyze_support

    spec = CableSpec(cable, cable["diameter_m"] / 2, cable["mode"], 0)
    spatial_policy = scene["routing_graph"].get("spatial_cost_policy")
    start, end = (endpoints[cable[key]] for key in ("start_port_id", "end_port_id"))
    ports = {p["id"]: p for item in scene["items"] for p in item["ports"]}
    if not _compatible(ports[start.port_id]["type"], ports[end.port_id]["type"], cable["cable_type"]):
        return _issue(cable, "incompatible_ports"), None
    mode_edges = [e for e in edges if spec.mode in e["modes"]]
    required_kind = "slot" if spec.mode == "slot" else "fixing_point"
    ids = {e[k] for e in mode_edges for k in ("from_node_id", "to_node_id")}
    if not mode_edges or not any(nodes[n][1] == required_kind for n in ids):
        return _issue(cable, "unsupported_mode"), None

    # A rear route must never use a grommet as a connector shortcut. Close the
    # declared slot tunnel for this cable only; do not change scene geometry.
    forbidden = list(reserved_boxes)
    if spec.mode == "backboard":
        for edge in edges:
            a, b = (nodes[edge[key]] for key in ("from_node_id", "to_node_id"))
            if a[1] == b[1] == "slot" and abs(a[0][1] - b[0][1]) > 1e-8:
                radius = edge["clearance_radius_m"]
                forbidden.append(AABB(
                    tuple(min(a[0][i], b[0][i]) - (radius if i != 1 else 0) for i in range(3)),
                    tuple(max(a[0][i], b[0][i]) + (radius if i != 1 else 0) for i in range(3)),
                ))
    boxes = list(obstacle_boxes) + forbidden + list(item_boxes.values())

    def clear(points, check_occupied=True):
        return all(_arc_clearance(a, b, spec.radius, boxes) for a, b in pairwise(points)) and (not check_occupied or not _tube_conflicts(points, spec.radius, occupied))

    def unsupported(points):
        if support_context is None:
            return 0.0
        segments = [_line_control_points(a, b) for a, b in pairwise(points)]
        result = analyze_support(segments, support_context, spec.radius)
        return result.unsupported_length_m if result.valid else math.inf

    adjacency = {n: [] for n in ids}
    for edge in mode_edges:
        a_id, b_id = edge["from_node_id"], edge["to_node_id"]
        a, b = nodes[a_id][0], nodes[b_id][0]
        if edge["clearance_radius_m"] < spec.radius + EPSILON or not clear((a, b)):
            continue
        penalty = unsupported((a, b))
        if not math.isfinite(penalty):
            continue
        cost = distance(a, b) * (4 if edge["exposed"] else 1) + segment_penalty(a, b, spatial_policy) + 3 * penalty
        adjacency[a_id].append(Leg(b_id, (a, b), cost, True))
        adjacency[b_id].append(Leg(a_id, (b, a), cost, True))

    last_reason = "no_path"
    for extension in (0.04, 0.02, 0.008):
        s, t = replace(start, leadout_extension_m=extension), replace(end, leadout_extension_m=extension)
        s_exit, t_exit = _endpoint_exit(s, spec.radius), _endpoint_exit(t, spec.radius)
        links, geometric_links = {}, {}
        for label, endpoint, exit_point in (("start", s, s_exit), ("end", t, t_exit)):
            connection_boxes = list(obstacle_boxes) + forbidden + [b for id_, b in item_boxes.items() if id_ != endpoint.item_id]
            remainder = _leadout_remainder(endpoint, spec.radius)
            if remainder is not None:
                connection_boxes.append(remainder)
            choices = []
            geometric_links[label] = False
            if _arc_clearance(endpoint.position, exit_point, spec.radius, connection_boxes):
                # Bound both desk surfaces and their three rail levels without
                # truncating the phone's connection to the actual slot branch.
                nearest = sorted(ids, key=lambda n: (distance(exit_point, nodes[n][0]), n))[:96]
                waypoints = _escape_waypoints(exit_point, forbidden, spec.radius)
                for node in nearest:
                    for connector in _connectors(exit_point, nodes[node][0], endpoint.direction, waypoints):
                        if len(connector) < 2 or dot(normalize(sub(connector[1], connector[0])), endpoint.direction) < -1e-8:
                            continue
                        points = (endpoint.position,) + connector
                        if not clear(connector, check_occupied=False):
                            continue
                        geometric_links[label] = True
                        if _tube_conflicts(points, spec.radius, occupied):
                            continue
                        penalty = unsupported(points)
                        if not math.isfinite(penalty):
                            continue
                        # Prefer entering the edge network early over a long
                        # open-space connector that cuts across the desktop.
                        cost = sum(4 * distance(a, b) + segment_penalty(a, b, spatial_policy) for a, b in pairwise(points)) + .05 * (len(points) - 2) + 3 * penalty
                        choices.append(Leg(node, points, cost))
            links[label] = choices
        if not links["start"] or not links["end"]:
            last_reason = "no_path" if all(geometric_links.values()) else "endpoint_blocked"
            continue
        terminal = {}
        for leg in links["end"]:
            terminal.setdefault(leg.target, []).append(Leg("__end__", tuple(reversed(leg.points)), leg.cost))
        serial = count()
        queue, costs, parent = [], {}, {}

        def push(node, passed, used, direction, cost, previous, leg,
                 costs=costs, parent=parent, queue=queue, serial=serial, target=t.position):
            state = (node, passed, used, direction)
            if cost >= costs.get(state, math.inf) - 1e-12:
                return
            costs[state] = cost
            parent[state] = (previous, leg)
            heuristic = 0 if use_dijkstra or node == "__end__" else distance(nodes[node][0], target)
            heapq.heappush(queue, (cost + heuristic, next(serial), cost, state))

        for leg in links["start"]:
            direction = normalize(sub(leg.points[-1], leg.points[-2]))
            push(leg.target, nodes[leg.target][1] == required_kind, False, direction, leg.cost, None, leg)
        goal = None
        while queue:
            _, _, cost, state = heapq.heappop(queue)
            if cost > costs[state] + 1e-12:
                continue
            node, passed, used, direction = state
            if node == "__end__":
                goal = state
                break
            for leg in adjacency[node] + terminal.get(node, []):
                next_passed = passed or (leg.target in nodes and nodes[leg.target][1] == required_kind)
                next_used = used or leg.edge
                if leg.target == "__end__" and not (next_passed and next_used):
                    continue
                outgoing = normalize(sub(leg.points[1], leg.points[0]))
                alignment = dot(direction, outgoing)
                if alignment < -1 + 1e-8:
                    continue
                arrival = normalize(sub(leg.points[-1], leg.points[-2]))
                push(leg.target, next_passed, next_used, arrival, cost + leg.cost + .05 * (1 - alignment), state, leg)
        if goal is None:
            last_reason = "no_path"
            continue
        legs = []
        cursor = goal
        while cursor is not None:
            cursor, leg = parent[cursor]
            legs.append(leg)
        points = []
        for leg in reversed(legs):
            for point in leg.points:
                if not points or distance(point, points[-1]) > 1e-9:
                    points.append(point)
        # Straight cubic segments preserve the existing output contract and
        # render exactly these right-angle vertices, without spline refitting.
        segments = [_line_control_points(a, b) for a, b in pairwise(points)]
        reason, total = _validate_curve(segments, points, spec, s, t, obstacle_boxes,
                                        forbidden, item_boxes, occupied,
                                        support_context=support_context, orthogonal=True)
        if reason is None:
            return _valid(cable, segments, points, total, support_context), (points, spec.radius)
        last_reason = reason
        if reason == "length_exceeded":
            break
    # Distinguish missing supports from a geometric route failure without
    # claiming an unverified path; this fallback is bounded to one pass.
    if support_context and last_reason in {"no_path", "endpoint_blocked"}:
        geometric, _ = plan_orthogonal(scene, cable, endpoints, nodes, edges,
                                       obstacle_boxes, reserved_boxes, item_boxes,
                                       occupied, use_dijkstra, None)
        if geometric["status"] == "valid":
            last_reason = "unsupported_span"
    return _issue(cable, last_reason), None
