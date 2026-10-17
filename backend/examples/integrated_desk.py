"""Synthetic full-desk geometry: packing, direct adapter mount, and routing."""

from backend.app.domain.packing import plan_packing
from backend.app.domain.routing import plan_routing
from backend.examples.packing_demo import cable, item, port, preview_scene, region, zone


def _device(
    identifier, category, size, position, targets, priority, frequency="medium"
):
    value = item(identifier, category, size, position, targets, frequency=frequency)
    value["placement_priority"] = priority
    value["allowed_rotations_y_rad"] = [0.0]
    return value


def _support(identifier, obstacle_id, face, bounds, stand_off=0.05, kind="cable_tie"):
    return {
        "id": identifier,
        "kind": kind,
        "obstacle_id": obstacle_id,
        "face": face,
        "bounds_uv_m": list(bounds),
        "stand_off_m": stand_off,
    }


def integrated_desk_scene() -> dict:
    """Return an editable baseline; dimensions are illustrative, not measured."""
    shelf_ids = [f"shelf_{index}" for index in range(1, 5)]
    scene = {
        "schema_version": "1.0",
        "scene_id": "integrated_desk",
        "scene_revision": 1,
        "baseline_id": "integrated_desk_baseline",
        "template_id": "integrated_desk_v1",
        "desk": {"width_m": 1.8, "depth_m": 0.8, "top_height_m": 0.77},
        "wall": {"z_m": -0.12, "bounds_xy_m": [0, 1.8, 0, 2.0]},
        "regions": [
            region("desktop", (0, 1.8, 0, 0.8)),
            region("monitor_back_center", (0.66, 1.24, 0.06, 0.20)),
            region("printer_right", (1.34, 1.76, 0.14, 0.50)),
            region("laptop_left", (0.08, 0.48, 0.43, 0.71)),
            region("keyboard_front", (0.61, 1.03, 0.52, 0.67)),
            region("mouse_front_right", (1.10, 1.20, 0.53, 0.67)),
            region("shelf_1", (0.02, 0.23, 0.03, 0.27), 1.22, 0.30),
            region("shelf_2", (0.27, 0.48, 0.03, 0.27), 1.22, 0.30),
            region("shelf_3", (0.02, 0.23, 0.03, 0.27), 1.58, 0.30),
            region("shelf_4", (0.27, 0.48, 0.03, 0.27), 1.58, 0.30),
            region("drawer", (1.39, 1.74, 0.12, 0.66), 0.43, 0.22),
        ],
        "items": [
            _device(
                "monitor",
                "monitor",
                (0.58, 0.40, 0.14),
                (0.85, 0.77, 0.35),
                ["monitor_back_center"],
                100,
                "high",
            ),
            _device(
                "printer",
                "printer",
                (0.42, 0.28, 0.36),
                (1.55, 0.77, 0.58),
                ["printer_right"],
                90,
                "medium",
            ),
            _device(
                "laptop",
                "laptop",
                (0.40, 0.025, 0.28),
                (0.27, 0.77, 0.50),
                ["laptop_left"],
                70,
                "high",
            ),
            _device(
                "keyboard",
                "keyboard",
                (0.42, 0.03, 0.15),
                (0.82, 0.77, 0.65),
                ["keyboard_front"],
                65,
                "high",
            ),
            _device(
                "mouse",
                "mouse",
                (0.10, 0.04, 0.14),
                (1.13, 0.77, 0.50),
                ["mouse_front_right"],
                60,
                "high",
            ),
            _device(
                "book",
                "book",
                (0.18, 0.05, 0.20),
                (0.22, 0.77, 0.25),
                shelf_ids,
                10,
                "low",
            ),
            _device(
                "cup",
                "cup",
                (0.08, 0.12, 0.08),
                (1.25, 0.77, 0.19),
                shelf_ids,
                5,
                "medium",
            ),
            _device(
                "tissue",
                "tissue",
                (0.19, 0.10, 0.12),
                (1.55, 0.77, 0.12),
                ["drawer"],
                0,
                "low",
            ),
            item(
                "power_strip",
                "power_strip",
                (0.36, 0.035, 0.075),
                (0.30, 0.77, 0.08),
                ["desktop"],
                fixed=True,
            ),
            item(
                "power_adapter",
                "power_adapter",
                (0.09, 0.055, 0.07),
                (0.18, 0.805, 0.08),
                [],
                fixed=True,
            ),
            item(
                "wall_socket",
                "wall_socket",
                (0.07, 0.09, 0.015),
                (0.10, 0.30, -0.12),
                [],
                fixed=True,
            ),
        ],
        "obstacles": [
            zone("desk_top", (0, 0.745, 0), (1.8, 0.77, 0.8)),
            # The rear clamp rail rises 5 mm above the desktop.
            zone("rear_mounting_lip", (0, 0.745, -0.07), (1.8, 0.775, 0)),
            zone("rear_left_leg", (0.02, 0.10, -0.07), (0.16, 0.745, 0.12)),
            zone("shelf_lower", (0, 1.19, 0.01), (0.50, 1.22, 0.29)),
            zone("shelf_upper", (0, 1.55, 0.01), (0.50, 1.58, 0.29)),
            zone("shelf_roof", (0, 1.91, 0.01), (0.50, 1.94, 0.29)),
            zone("shelf_left", (0, 1.22, 0.01), (0.02, 1.91, 0.29)),
            zone("shelf_divider", (0.23, 1.22, 0.01), (0.27, 1.91, 0.29)),
            zone("shelf_right", (0.48, 1.22, 0.01), (0.50, 1.91, 0.29)),
            zone("drawer_base", (1.37, 0.40, 0.10), (1.76, 0.43, 0.68)),
            zone("drawer_left", (1.37, 0.43, 0.10), (1.39, 0.67, 0.68)),
            zone("drawer_right", (1.74, 0.43, 0.10), (1.76, 0.67, 0.68)),
            zone("drawer_back", (1.39, 0.43, 0.10), (1.74, 0.67, 0.12)),
            zone("drawer_front", (1.39, 0.43, 0.66), (1.74, 0.67, 0.68)),
            zone("drawer_roof", (1.37, 0.67, 0.10), (1.76, 0.69, 0.68)),
        ],
        "reserved_zones": [
            zone("front_operation", (0.54, 0.77, 0.73), (1.27, 1.10, 0.8))
        ],
        "exposure_zones": [zone("desktop_exposure", (0, 0.77, 0), (1.8, 1.3, 0.8))],
        "routing_graph": {
            "nodes": [],
            "edges": [],
            "supports": [],
            "support_policy": {"max_unsupported_span_m": 0.23},
        },
        "cables": [
            cable("strip_bus", "wall_power", "strip_input", "power", "backboard"),
            cable(
                "monitor_cable", "adapter_output", "monitor_power", "power", "backboard"
            ),
            cable(
                "printer_cable", "strip_socket_3", "printer_power", "power", "backboard"
            ),
        ],
    }
    by_id = {value["id"]: value for value in scene["items"]}
    by_id["power_strip"]["socket_count"] = 4
    by_id["monitor"]["ports"] = [
        port("monitor_power", "power_sink", (0, 0.017, -0.07), (0, 0, -1))
    ]
    by_id["printer"]["ports"] = [
        port("printer_power", "power_sink", (0, 0.017, -0.18), (0, 0, -1))
    ]
    by_id["power_strip"]["ports"] = [
        port("strip_input", "power_sink", (-0.18, 0.0175, 0), (-1, 0, 0)),
        *[
            port(
                f"strip_socket_{index + 1}",
                "power_source",
                (-0.12 + 0.08 * index, 0.035, 0),
                (0, 1, 0),
            )
            for index in range(4)
        ],
    ]
    by_id["power_adapter"]["ports"] = [
        port("adapter_plug", "power_sink", (0, 0, 0), (0, -1, 0)),
        port("adapter_output", "power_source", (0, 0.015, -0.035), (0, 0, -1)),
    ]
    by_id["power_adapter"]["plug_mount"] = {
        "socket_port_id": "strip_socket_1",
        "plug_port_id": "adapter_plug",
    }
    by_id["wall_socket"]["ports"] = [
        port("wall_power", "power_source", (0, 0.045, 0.0075), (0, 0, 1))
    ]
    graph = scene["routing_graph"]
    points = [
        (0.10, 0.35, -0.10),
        (0.10, 0.52, -0.10),
        (0.10, 0.70, -0.10),
        (0.10, 0.785, -0.10),
        (0.08, 0.785, 0.08),
        (0.18, 0.82, -0.10),
        (0.34, 0.82, -0.10),
        (0.18, 0.72, -0.10),
        (0.34, 0.72, -0.10),
        (0.34, 0.72, 0.04),
        (0.50, 0.72, 0.04),
        (0.70, 0.72, 0.04),
        (0.90, 0.72, 0.04),
        (1.10, 0.72, 0.04),
        (1.30, 0.72, 0.04),
        (1.55, 0.72, 0.04),
        (0.95, 0.72, -0.10),
        (0.95, 0.785, -0.10),
        (1.55, 0.72, -0.10),
        (1.55, 0.785, -0.10),
        (0.18, 0.72, 0.04),
    ]
    graph["nodes"] = [
        {
            "id": f"route_{index}",
            "position": list(point),
            "kind": "fixing_point" if point[1] < 0.745 else "corner",
        }
        for index, point in enumerate(points)
    ]
    graph["edges"] = [
        {
            "id": f"route_edge_{index}",
            "from_node_id": f"route_{first}",
            "to_node_id": f"route_{last}",
            "modes": ["backboard"],
            "clearance_radius_m": 0.08,
            "exposed": any(
                points[node][1] >= 0.77 and points[node][2] >= 0
                for node in (first, last)
            ),
        }
        for index, (first, last) in enumerate(
            [
                (0, 1),
                (1, 2),
                (2, 3),
                (3, 4),
                (5, 7),
                (6, 8),
                (7, 8),
                (8, 9),
                (9, 10),
                (10, 11),
                (11, 12),
                (12, 13),
                (13, 14),
                (14, 15),
                (12, 16),
                (16, 17),
                (15, 18),
                (18, 19),
                (7, 20),
                (20, 9),
            ]
        )
    ]
    # Parallel underside lanes share the same rear entries and mounted ties.
    lane_nodes = {}
    for index in (*range(9, 16), 20):
        position = points[index]
        x, y, z = position
        lane_nodes[f"route_{index}"] = f"parallel_route_{index}"
        graph["nodes"].append(
            {
                "id": f"parallel_route_{index}",
                "position": [x, y - 0.01, z + 0.015],
                "kind": "fixing_point",
            }
        )
    graph["edges"].extend(
        {
            **edge,
            "id": "parallel_" + edge["id"],
            "from_node_id": lane_nodes[edge["from_node_id"]],
            "to_node_id": lane_nodes[edge["to_node_id"]],
        }
        for edge in list(graph["edges"])
        if edge["from_node_id"] in lane_nodes and edge["to_node_id"] in lane_nodes
    )
    for index in (16, 17):
        x, y, z = points[index]
        graph["nodes"].append(
            {
                "id": f"parallel_route_{index}",
                "position": [0.90, 0.71 if index == 16 else y, z],
                "kind": "fixing_point" if y < 0.745 else "corner",
            }
        )
    graph["edges"].extend(
        {
            "id": f"parallel_access_{index}",
            "from_node_id": first,
            "to_node_id": last,
            "modes": ["backboard"],
            "clearance_radius_m": 0.08,
            "exposed": False,
        }
        for index, (first, last) in enumerate(
            [
                ("route_7", "parallel_route_20"),
                ("route_8", "parallel_route_9"),
                ("parallel_route_12", "parallel_route_16"),
                ("parallel_route_16", "parallel_route_17"),
                ("parallel_route_15", "route_18"),
            ]
        )
    )
    graph["supports"] = [
        _support(
            "desktop_rest", "desk_top", "y_max", (0, 1.8, 0, 0.8), 0.02, "surface"
        ),
        _support(
            "rear_lip_rest",
            "rear_mounting_lip",
            "y_max",
            (0, 1.8, -0.07, 0),
            0.02,
            "surface",
        ),
        *[
            _support(
                f"rear_leg_tie_{index}",
                "rear_left_leg",
                "z_min",
                (0.075, 0.125, y - 0.025, y + 0.025),
                0.05,
            )
            for index, y in enumerate((0.35, 0.52, 0.70))
        ],
        *[
            _support(
                f"underdesk_tie_{index}",
                "desk_top",
                "y_min",
                (x - 0.025, x + 0.025, 0.015, 0.065),
                0.05,
            )
            for index, x in enumerate((0.18, 0.34, 0.50, 0.70, 0.90, 1.10, 1.30, 1.50))
        ],
        *[
            _support(
                f"rear_edge_tie_{index}",
                "rear_mounting_lip",
                "z_min",
                (x - 0.025, x + 0.025, 0.745, 0.77),
                0.05,
            )
            for index, x in enumerate((0.18, 0.34, 0.95, 1.55, 0.90))
        ],
        *[
            _support(
                f"rear_lip_tie_{index}",
                "rear_mounting_lip",
                "y_max",
                (x - 0.025, x + 0.025, -0.07, -0.02),
                0.05,
            )
            for index, x in enumerate((0.18, 0.34, 0.95, 1.55, 0.90))
        ],
    ]
    graph["tray_candidates"] = [
        {
            **_support(
                "underdesk_tray_option",
                "desk_top",
                "y_min",
                (0.45, 1.65, 0.005, 0.105),
                0.06,
                "cable_tray",
            ),
            "cable_ids": ["monitor_cable", "printer_cable"],
        }
    ]
    return scene


def build_applied_scenario() -> tuple[dict, dict, dict, dict]:
    """Apply layout to a new revision before resolving and planning cables."""
    baseline = integrated_desk_scene()
    packing = plan_packing(baseline)
    applied = preview_scene(baseline, packing)
    applied["scene_revision"] = baseline["scene_revision"] + 1
    return baseline, packing, applied, plan_routing(applied)
