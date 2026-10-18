"""Synthetic geometry fixture and reproducible JSON handoff; no vendor assets."""

import argparse
import copy
import json
import math
from pathlib import Path
from time import perf_counter

from backend.app.domain.packing import measure_free_area, plan_packing, validate_layout


def item(
    identifier, category, size, position, regions, *, fixed=False, frequency="medium"
):
    return {
        "id": identifier,
        "name": identifier.replace("_", " "),
        "category": category,
        "size_m": list(size),
        "position": list(position),
        "rotation_y_rad": 0.0,
        "dimensions_source": "template",
        "dimensions_confirmed": True,
        "fixed": fixed,
        "usage_frequency": frequency,
        "allowed_region_ids": list(regions),
        "allowed_rotations_y_rad": [0.0, math.pi / 2],
        "collision": {"type": "box"},
        "ports": [],
        "image_url": None,
        "model_url": None,
        "generation": {
            "task_id": None,
            "status": "not_requested",
            "source": "placeholder",
            "error": None,
        },
    }


def region(identifier, bounds, height=0.77, clearance=1.0):
    return {
        "id": identifier,
        "surface_y_m": height,
        "bounds_xz_m": list(bounds),
        "clearance_height_m": clearance,
    }


def zone(identifier, minimum, maximum):
    return {"id": identifier, "min": list(minimum), "max": list(maximum)}


def port(identifier, kind, position, direction):
    return {
        "id": identifier,
        "type": kind,
        "local_position": list(position),
        "local_direction": list(direction),
        "capacity": 1,
        "confirmed": True,
    }


def cable(identifier, start, end, kind, mode="slot"):
    return {
        "id": identifier,
        "start_port_id": start,
        "end_port_id": end,
        "cable_type": kind,
        "thickness": "thin",
        "length_m": 3.0,
        "diameter_m": 0.004,
        "min_bend_radius_m": 0.015,
        "slack_m": 0.05,
        "mode": mode,
    }


def demo_scene() -> dict:
    shelf_ids = [f"shelf_{i}" for i in range(1, 5)]
    scene = {
        "schema_version": "1.0",
        "scene_id": "packing_demo",
        "scene_revision": 1,
        "baseline_id": "packing_baseline_1",
        "template_id": "demo_desk_v1",
        "desk": {"width_m": 1.45, "depth_m": 0.60, "top_height_m": 0.77},
        "wall": {"z_m": -0.04, "bounds_xy_m": [0.0, 1.45, 0.0, 1.9]},
        "regions": [
            region("desk_left_surface", (0, 1.09, 0, 0.6)),
            region("desk_right_surface", (1.13, 1.45, 0, 0.6)),
            region("desk_hole_back_surface", (1.09, 1.13, 0, 0.01)),
            region("desk_hole_front_surface", (1.09, 1.13, 0.05, 0.6)),
            region("desk_primary", (0.22, 1.16, 0.18, 0.58)),
            region("shelf_1", (0.025, 0.365, 0.025, 0.285), 1.15, 0.30),
            region("shelf_2", (0.395, 0.735, 0.025, 0.285), 1.15, 0.30),
            region("shelf_3", (0.025, 0.365, 0.025, 0.285), 1.50, 0.30),
            region("shelf_4", (0.395, 0.735, 0.025, 0.285), 1.50, 0.30),
            region("drawer", (1.18, 1.42, 0.08, 0.50), 0.45, 0.22),
        ],
        "items": [
            item(
                "keyboard",
                "keyboard",
                (0.40, 0.03, 0.14),
                (0.55, 0.77, 0.42),
                ["desk_primary"],
                frequency="high",
            ),
            item(
                "mouse",
                "mouse",
                (0.06, 0.03, 0.10),
                (0.90, 0.77, 0.45),
                ["desk_primary"],
                frequency="high",
            ),
            item(
                "tablet",
                "tablet",
                (0.22, 0.025, 0.15),
                (0.87, 0.77, 0.22),
                ["desk_primary"],
                frequency="high",
            ),
            item("book", "book", (0.20, 0.05, 0.22), (0.16, 0.77, 0.43), shelf_ids),
            item(
                "cup",
                "cup",
                (0.075, 0.12, 0.075),
                (0.10, 0.77, 0.20),
                shelf_ids,
                frequency="high",
            ),
            item(
                "storage_box",
                "storage_box",
                (0.15, 0.12, 0.16),
                (1.28, 0.77, 0.39),
                ["drawer"],
                frequency="low",
            ),
            item("tissue", "tissue", (0.17, 0.09, 0.12), (1.29, 0.77, 0.15), shelf_ids),
            item(
                "charger",
                "charger",
                (0.08, 0.04, 0.06),
                (0.57, 0.77, 0.15),
                ["drawer"],
                frequency="low",
            ),
            item(
                "strip",
                "power_strip",
                (0.30, 0.04, 0.06),
                (0.91, 0.77, 0.07),
                ["desk_left_surface"],
                fixed=True,
            ),
            item(
                "wall_power",
                "wall_socket",
                (0.07, 0.09, 0.015),
                (1.22, 0.30, -0.04),
                [],
                fixed=True,
            ),
            item(
                "wall_network",
                "wall_network",
                (0.07, 0.09, 0.015),
                (1.35, 0.30, -0.04),
                [],
                fixed=True,
            ),
        ],
        "obstacles": [
            zone("desk_left", (0, 0.745, 0), (1.09, 0.77, 0.60)),
            zone("desk_right", (1.13, 0.745, 0), (1.45, 0.77, 0.60)),
            zone("desk_hole_back", (1.09, 0.745, 0), (1.13, 0.77, 0.01)),
            zone("desk_hole_front", (1.09, 0.745, 0.05), (1.13, 0.77, 0.60)),
            zone("shelf_lower", (0, 1.12, 0), (0.76, 1.15, 0.30)),
            zone("shelf_upper", (0, 1.47, 0), (0.76, 1.50, 0.30)),
            zone("shelf_roof", (0, 1.80, 0), (0.76, 1.83, 0.30)),
            zone("shelf_left", (0, 0.77, 0), (0.02, 1.83, 0.30)),
            zone("shelf_divider", (0.37, 0.77, 0), (0.39, 1.83, 0.30)),
            zone("shelf_right", (0.74, 0.77, 0), (0.76, 1.83, 0.30)),
            zone("drawer_base", (1.16, 0.43, 0.06), (1.44, 0.45, 0.52)),
            zone("drawer_left", (1.16, 0.45, 0.06), (1.18, 0.69, 0.52)),
            zone("drawer_right", (1.42, 0.45, 0.06), (1.44, 0.69, 0.52)),
            zone("drawer_back", (1.18, 0.45, 0.06), (1.42, 0.69, 0.08)),
            zone("drawer_front", (1.18, 0.45, 0.50), (1.42, 0.69, 0.52)),
            zone("drawer_roof", (1.16, 0.67, 0.06), (1.44, 0.69, 0.52)),
            zone("backboard", (0, 0.10, -0.015), (1.45, 0.74, -0.005)),
        ],
        "reserved_zones": [
            zone("front_operation", (0.25, 0.77, 0.585), (1.15, 1.1, 0.60))
        ],
        "exposure_zones": [zone("desktop_exposure", (0, 0.77, 0), (1.45, 1.0, 0.6))],
        "routing_graph": {
            "nodes": [
                {"id": "slot_top", "position": [1.11, 0.81, 0.03], "kind": "corner"},
                {"id": "slot_hole", "position": [1.11, 0.70, 0.03], "kind": "slot"},
                {
                    "id": "slot_bottom",
                    "position": [1.11, 0.30, 0.03],
                    "kind": "fixing_point",
                },
                {"id": "back_top", "position": [1.11, 0.81, -0.08], "kind": "corner"},
                {
                    "id": "back_bottom",
                    "position": [1.11, 0.30, -0.08],
                    "kind": "fixing_point",
                },
            ],
            "edges": [
                {
                    "id": "slot_down",
                    "from_node_id": "slot_top",
                    "to_node_id": "slot_hole",
                    "modes": ["slot"],
                    "clearance_radius_m": 0.015,
                    "exposed": False,
                },
                {
                    "id": "slot_vertical",
                    "from_node_id": "slot_hole",
                    "to_node_id": "slot_bottom",
                    "modes": ["slot"],
                    "clearance_radius_m": 0.015,
                    "exposed": False,
                },
                {
                    "id": "back_vertical",
                    "from_node_id": "back_top",
                    "to_node_id": "back_bottom",
                    "modes": ["backboard"],
                    "clearance_radius_m": 0.015,
                    "exposed": False,
                },
            ],
        },
        "cables": [
            cable("strip_bus", "strip_in", "wall_power_port", "power"),
            cable("charger_power", "charger_port", "strip_socket_1", "power"),
            cable("keyboard_usb", "keyboard_port", "tablet_port", "usb"),
        ],
    }
    by_id = {i["id"]: i for i in scene["items"]}
    by_id["strip"]["socket_count"] = 4
    by_id["strip"]["ports"] = [
        port(
            f"strip_socket_{i + 1}",
            "power_source",
            (-0.10 + i * 0.06, 0.04, 0),
            (0, 1, 0),
        )
        for i in range(4)
    ]
    by_id["strip"]["ports"].append(
        port("strip_in", "power_sink", (0.15, 0.02, 0), (1, 0, 0))
    )
    by_id["wall_power"]["ports"] = [
        port("wall_power_port", "power_source", (0, 0.04, 0.0075), (0, 0, 1))
    ]
    by_id["wall_network"]["ports"] = [
        port("wall_network_port", "network", (0, 0.04, 0.0075), (0, 0, 1))
    ]
    by_id["charger"]["ports"] = [
        port("charger_port", "power_sink", (0.04, 0.02, 0), (1, 0, 0))
    ]
    by_id["keyboard"]["ports"] = [
        port("keyboard_port", "usb", (0, 0.015, -0.07), (0, 0, -1))
    ]
    by_id["tablet"]["ports"] = [
        port("tablet_port", "usb", (0.11, 0.0125, 0), (1, 0, 0))
    ]
    return scene


def cases() -> dict[str, dict]:
    success = demo_scene()
    partial = copy.deepcopy(success)
    partial["regions"].append(
        region("tiny_storage", (1.20, 1.24, 0.10, 0.14), 0.45, 0.01)
    )
    next(i for i in partial["items"] if i["id"] == "storage_box")[
        "allowed_region_ids"
    ] = ["tiny_storage"]
    infeasible = copy.deepcopy(success)
    next(i for i in infeasible["items"] if i["id"] == "wall_power")["position"][0] = 1.8
    newer = copy.deepcopy(success)
    newer["scene_revision"] += 1
    return {
        "success": success,
        "partial": partial,
        "infeasible": infeasible,
        "revision_2": newer,
    }


def preview_scene(scene: dict, result: dict) -> dict:
    """Example-only preview. Real acceptance must check version atomically in B."""
    if (result["scene_id"], result["scene_revision"]) != (
        scene["scene_id"],
        scene["scene_revision"],
    ):
        raise ValueError("stale result")
    if result["status"] == "infeasible":
        return copy.deepcopy(scene)
    preview = copy.deepcopy(scene)
    targets = {i["item_id"]: i for i in result["items"]}
    for current in preview["items"]:
        target = targets[current["id"]]
        current["position"] = list(target["target_pos"])
        current["rotation_y_rad"] = target["target_rotation_y_rad"]
        if "target_book_pose" in target and ("book_pose" in current or target["target_book_pose"] != "original"):
            current["book_pose"] = target["target_book_pose"]
    return preview


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir", type=Path, help="write reproducible input/result JSON examples"
    )
    args = parser.parse_args()
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, scene in cases().items():
        started = perf_counter()
        result = plan_packing(scene)
        elapsed = perf_counter() - started
        preview = preview_scene(scene, result)
        print(
            json.dumps(
                {
                    "case": name,
                    "status": result["status"],
                    "seconds": round(elapsed, 4),
                    "geometry_valid": validate_layout(preview)["geometry_valid"],
                    "before_m2": measure_free_area(scene),
                    "after_m2": measure_free_area(preview),
                }
            )
        )
        if args.output_dir:
            for suffix, payload in (("scene", scene), ("packing_result", result)):
                (args.output_dir / f"{name}_{suffix}.json").write_text(
                    json.dumps(payload, indent=2, ensure_ascii=True, allow_nan=False)
                    + "\n",
                    encoding="utf-8",
                )


if __name__ == "__main__":
    main()
