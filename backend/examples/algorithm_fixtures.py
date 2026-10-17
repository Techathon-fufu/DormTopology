"""Generate deterministic workbench fixtures with the real domain algorithms."""

import argparse
import copy
import json
from pathlib import Path

from backend.app.domain.packing import measure_free_area, plan_packing, validate_layout
from backend.app.domain.routing import plan_routing
from backend.examples.packing_demo import (
    cable,
    cases,
    item,
    port,
    preview_scene,
    region,
    zone,
)


def routing_scene(mode: str = "slot") -> dict:
    """A diagnostic desk with an actual hole and a separate rear channel."""
    sink_z = 0.15 if mode == "slot" else -0.08
    scene = {
        "schema_version": "1.0",
        "scene_id": f"routing_{mode}",
        "scene_revision": 1,
        "baseline_id": f"routing_{mode}_baseline",
        "template_id": "diagnostic_desk_v1",
        "desk": {"width_m": 1.45, "depth_m": 0.60, "top_height_m": 0.77},
        "wall": {"z_m": -0.10, "bounds_xy_m": [0.0, 1.45, 0.0, 1.2]},
        "regions": [
            region("desk_left_surface", (0.0, 0.75, 0.0, 0.60)),
            region("desk_right_surface", (0.85, 1.45, 0.0, 0.60)),
            region("desk_slot_back_surface", (0.75, 0.85, 0.0, 0.10)),
            region("desk_slot_front_surface", (0.75, 0.85, 0.20, 0.60)),
        ],
        "items": [
            item(
                "source", "device", (0.1, 0.1, 0.1), (0.15, 0.77, 0.15), [], fixed=True
            ),
            item(
                "sink", "device", (0.1, 0.1, 0.1), (1.2, 0.30, sink_z), [], fixed=True
            ),
        ],
        "obstacles": [
            zone("desk_left", (0.0, 0.745, 0.0), (0.75, 0.77, 0.60)),
            zone("desk_right", (0.85, 0.745, 0.0), (1.45, 0.77, 0.60)),
            zone("desk_slot_back", (0.75, 0.745, 0.0), (0.85, 0.77, 0.10)),
            zone("desk_slot_front", (0.75, 0.745, 0.20), (0.85, 0.77, 0.60)),
            zone("backboard", (0.0, 0.10, -0.015), (1.45, 0.74, -0.005)),
        ],
        "reserved_zones": [],
        "exposure_zones": [
            zone("desktop_exposure", (0.0, 0.77, 0.0), (1.45, 1.0, 0.60))
        ],
        "routing_graph": {
            "nodes": [
                {"id": "slot_top", "position": [0.8, 0.82, 0.15], "kind": "corner"},
                {"id": "slot_down", "position": [0.8, 0.65, 0.15], "kind": "slot"},
                {
                    "id": "slot_low",
                    "position": [0.8, 0.35, 0.15],
                    "kind": "fixing_point",
                },
                {"id": "back_top", "position": [0.8, 0.82, -0.08], "kind": "corner"},
                {
                    "id": "back_bottom",
                    "position": [0.8, 0.35, -0.08],
                    "kind": "fixing_point",
                },
            ],
            "edges": [
                {
                    "id": "slot_entry",
                    "from_node_id": "slot_top",
                    "to_node_id": "slot_down",
                    "modes": ["slot"],
                    "clearance_radius_m": 0.06,
                    "exposed": False,
                },
                {
                    "id": "slot_vertical",
                    "from_node_id": "slot_down",
                    "to_node_id": "slot_low",
                    "modes": ["slot"],
                    "clearance_radius_m": 0.06,
                    "exposed": False,
                },
                {
                    "id": "back_vertical",
                    "from_node_id": "back_top",
                    "to_node_id": "back_bottom",
                    "modes": ["backboard"],
                    "clearance_radius_m": 0.06,
                    "exposed": False,
                },
            ],
        },
        "cables": [cable("power", "source_port", "sink_port", "power", mode)],
    }
    scene["items"][0]["ports"] = [
        port("source_port", "power_source", (0.05, 0.05, 0.0), (1.0, 0.0, 0.0))
    ]
    scene["items"][1]["ports"] = [
        port("sink_port", "power_sink", (-0.05, 0.05, 0.0), (-1.0, 0.0, 0.0))
    ]
    return scene


def _mount(
    identifier: str,
    kind: str,
    obstacle_id: str,
    face: str,
    bounds: tuple[float, float, float, float],
    stand_off: float = 0.02,
) -> dict:
    return {
        "id": identifier,
        "kind": kind,
        "obstacle_id": obstacle_id,
        "face": face,
        "bounds_uv_m": list(bounds),
        "stand_off_m": stand_off,
    }


def _support_graph(points: list[tuple[float, float, float]], mode: str) -> dict:
    return {
        "support_policy": {"max_unsupported_span_m": 0.23},
        "nodes": [
            {
                "id": f"supported_node_{index}",
                "position": list(position),
                "kind": "corner",
            }
            for index, position in enumerate(points)
        ],
        "edges": [
            {
                "id": f"supported_edge_{index}",
                "from_node_id": f"supported_node_{index}",
                "to_node_id": f"supported_node_{index + 1}",
                "modes": [mode],
                "clearance_radius_m": 0.025,
                "exposed": False,
            }
            for index in range(len(points) - 1)
        ],
        "supports": [],
    }


def underdesk_scene(support_kind: str = "cable_tie") -> dict:
    """A horizontal cable 13 mm below the real desk underside."""
    scene = routing_scene("backboard")
    scene["scene_id"] = f"routing_underdesk_{support_kind}"
    scene["baseline_id"] = f"{scene['scene_id']}_baseline"
    scene["obstacles"] = [zone("desk_top", (0, 0.745, 0), (1.45, 0.77, 0.6))]
    scene["regions"] = [region("desktop_surface", (0, 1.45, 0, 0.6))]
    scene["items"] = [
        item(
            "source", "device", (0.08, 0.05, 0.08), (0.12, 0.692, 0.15), [], fixed=True
        ),
        item("sink", "device", (0.08, 0.05, 0.08), (1.30, 0.692, 0.15), [], fixed=True),
    ]
    scene["items"][0]["ports"] = [
        port("source_port", "power_source", (0.04, 0.04, 0), (1, 0, 0))
    ]
    scene["items"][1]["ports"] = [
        port("sink_port", "power_sink", (-0.04, 0.04, 0), (-1, 0, 0))
    ]
    scene["routing_graph"] = _support_graph(
        [(x, 0.732, 0.15) for x in (0.21, 0.4, 0.6, 0.8, 1.0, 1.2)], "backboard"
    )
    scene["routing_graph"]["nodes"][2]["kind"] = "fixing_point"
    if support_kind == "cable_tie":
        scene["routing_graph"]["supports"] = [
            _mount(
                f"underside_tie_{index}",
                "cable_tie",
                "desk_top",
                "y_min",
                (x - 0.02, x + 0.02, 0.13, 0.17),
            )
            for index, x in enumerate((0.21, 0.4, 0.6, 0.8, 1.0, 1.2))
        ]
    elif support_kind == "cable_tray":
        scene["routing_graph"]["supports"] = [
            _mount(
                "underside_tray",
                "cable_tray",
                "desk_top",
                "y_min",
                (0.17, 1.25, 0.10, 0.20),
            )
        ]
    elif support_kind != "none":
        raise ValueError(f"unknown underside support: {support_kind}")
    return scene


def composite_underdesk_scene() -> dict:
    """Three individually routed underside lanes with an optional tray candidate.

    The candidate is intentionally kept outside ``supports``.  It describes a
    possible installation that can be evaluated after the individual cable
    routes are known; it must not silently turn an uninstalled tray into a
    verified support.
    """
    scene = underdesk_scene("cable_tie")
    scene["scene_id"] = "routing_underdesk_composite"
    scene["baseline_id"] = "routing_underdesk_composite_baseline"
    for support in scene["routing_graph"]["supports"]:
        # The lower two lanes are 10 mm and 20 mm below the first lane.
        support["stand_off_m"] = 0.05

    lane_heights = (0.04, 0.03, 0.02)
    for index, local_height in enumerate(lane_heights[1:], start=2):
        for item_value, port_id in zip(
            scene["items"], (f"source_port_{index}", f"sink_port_{index}")
        ):
            port_value = copy.deepcopy(item_value["ports"][0])
            port_value["id"] = port_id
            port_value["local_position"][1] = local_height
            item_value["ports"].append(port_value)
        scene["cables"].append(
            {
                **scene["cables"][0],
                "id": f"power_{index}",
                "start_port_id": f"source_port_{index}",
                "end_port_id": f"sink_port_{index}",
            }
        )

    # This is an optimization proposal, rather than an installed support.
    # Keep its cable membership explicit so a later service can reject stale
    # or incompatible candidates without changing route validity.
    scene["routing_graph"]["tray_candidates"] = [
        {
            "id": "underside_tray_option",
            "kind": "cable_tray",
            "obstacle_id": "desk_top",
            "face": "y_min",
            "bounds_uv_m": [0.17, 1.25, 0.10, 0.20],
            "stand_off_m": 0.05,
            "cable_ids": [cable_value["id"] for cable_value in scene["cables"]],
        }
    ]
    return scene


def supported_edge_scene() -> dict:
    """Rest on the top, cross the hole rim, then follow mounted cabinet ties."""
    scene = routing_scene("slot")
    scene["scene_id"] = "routing_supported_edge"
    scene["baseline_id"] = "routing_supported_edge_baseline"
    scene["items"][0]["position"][2] = 0.05
    scene["items"][0]["ports"] = [
        port("source_port", "power_source", (0.05, 0.017, -0.02), (1, 0, 0))
    ]
    scene["items"][0]["size_m"] = [0.10, 0.04, 0.10]
    scene["items"][1] = item(
        "sink", "device", (0.04, 0.09, 0.08), (0.925, 0.26, 0.03), [], fixed=True
    )
    scene["items"][1]["ports"] = [
        port("sink_port", "power_sink", (0.012, 0.09, 0), (0, 1, 0))
    ]
    scene["obstacles"] = [
        obstacle for obstacle in scene["obstacles"] if obstacle["id"] != "backboard"
    ] + [zone("cabinet_side", (0.95, 0.10, 0), (1.45, 0.745, 0.50))]
    scene["regions"][2]["bounds_xz_m"][3] = 0.01
    scene["regions"][3]["bounds_xz_m"][2] = 0.05
    for obstacle in scene["obstacles"]:
        if obstacle["id"] == "desk_slot_back":
            obstacle["max"][2] = 0.01
        elif obstacle["id"] == "desk_slot_front":
            obstacle["min"][2] = 0.05
    scene["routing_graph"] = _support_graph(
        [
            (0.30, 0.787, 0.03),
            (0.70, 0.787, 0.03),
            (0.78, 0.787, 0.03),
            (0.78, 0.732, 0.03),
            (0.937, 0.732, 0.03),
            (0.937, 0.57, 0.03),
            (0.937, 0.42, 0.03),
            (0.937, 0.38, 0.03),
        ],
        "slot",
    )
    scene["routing_graph"]["nodes"][3]["kind"] = "slot"
    for node in scene["routing_graph"]["nodes"][4:]:
        node["kind"] = "fixing_point"
    scene["routing_graph"]["supports"] = [
        _mount("desktop_rest", "surface", "desk_left", "y_max", (0, 0.75, 0, 0.08)),
        _mount(
            "hole_rim_tie",
            "cable_tie",
            "desk_left",
            "x_max",
            (0.745, 0.77, 0.01, 0.05),
            0.05,
        ),
        *[
            _mount(
                f"cabinet_tie_{index}",
                "cable_tie",
                "cabinet_side",
                "x_min",
                (y - 0.02, y + 0.02, 0.01, 0.05),
            )
            for index, y in enumerate((0.72, 0.57, 0.42, 0.36))
        ],
    ]
    return scene


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def _case_urls(identifier: str, *, packing: bool, applied: bool = False) -> dict:
    prefix = f"/algorithm-fixtures/{identifier}"
    urls = {
        "scene_url": f"{prefix}/scene.json",
        "routing_result_url": f"{prefix}/cable_routing.json",
    }
    if packing:
        urls["packing_result_url"] = f"{prefix}/packing_result.json"
    if applied:
        urls["applied_scene_url"] = f"{prefix}/applied_scene.json"
    return urls


def _assert_version(scene: dict, result: dict) -> None:
    if (scene["scene_id"], scene["scene_revision"]) != (
        result["scene_id"],
        result["scene_revision"],
    ):
        raise AssertionError("fixture result does not belong to its scene revision")


def _routing_expected(result: dict) -> dict:
    return {
        "routing_status": result["status"],
        "reason_codes": sorted(
            {c["reason_code"] for c in result["cables"] if c["reason_code"]}
        ),
    }


def generate(output_dir: Path) -> dict:
    """Write actual algorithm outputs; fail if a fixture changes its guarantee."""
    manifest = {
        "schema_version": "1.0",
        "generated_by": "backend.examples.algorithm_fixtures",
        "cases": [],
    }
    labels = {
        "success": "Packing success",
        "partial": "Packing partial",
        "infeasible": "Packing infeasible",
        "revision_2": "Packing revision 2",
    }
    descriptions = {
        "success": "Eight movable items, four shelf cells, and a fixed drawer.",
        "partial": "The storage box cannot fit its assigned region and stays in place.",
        "infeasible": "An invalid fixed wall socket prevents the layout being applied.",
        "revision_2": "A second input revision exercises source and applied result versions.",
    }
    for name, scene in cases().items():
        identifier = f"packing-{name.replace('_', '-')}"
        result = plan_packing(scene)
        expected_status = "success" if name == "revision_2" else name
        if result["status"] != expected_status:
            raise AssertionError(
                f"{identifier}: expected {expected_status}, got {result['status']}"
            )
        _assert_version(scene, result)
        applied = preview_scene(scene, result)
        can_apply = result["status"] != "infeasible"
        if can_apply:
            applied["scene_revision"] += 1
            if not validate_layout(applied)["geometry_valid"]:
                raise AssertionError(f"{identifier}: applied layout is invalid")
        routing = plan_routing(applied)
        _assert_version(applied, routing)
        for filename, payload in (
            ("scene.json", scene),
            ("packing_result.json", result),
            ("cable_routing.json", routing),
        ):
            _write_json(output_dir / identifier / filename, payload)
        applied_path = output_dir / identifier / "applied_scene.json"
        if can_apply:
            _write_json(applied_path, applied)
        else:
            applied_path.unlink(missing_ok=True)
        manifest["cases"].append(
            {
                "id": identifier,
                "label": labels[name],
                "kind": "packing",
                "description": descriptions[name],
                **_case_urls(identifier, packing=True, applied=can_apply),
                "expected": {
                    "packing_status": expected_status,
                    **_routing_expected(routing),
                },
                "metrics": {
                    "before_free_area_m2": measure_free_area(scene),
                    "after_free_area_m2": measure_free_area(applied),
                },
            }
        )

    slot = routing_scene("slot")
    backboard = routing_scene("backboard")
    too_short = copy.deepcopy(slot)
    too_short["scene_id"] = "routing_length_exceeded"
    too_short["cables"][0]["length_m"] = 0.20
    blocked = copy.deepcopy(slot)
    blocked["scene_id"] = "routing_endpoint_blocked"
    blocked["obstacles"].append(
        zone("leadout_block", (0.201, 0.81, 0.14), (0.25, 0.83, 0.16))
    )
    routing_cases = (
        ("routing-slot", "Slot route", slot, None),
        ("routing-backboard", "Backboard route", backboard, None),
        ("routing-length-exceeded", "Cable too short", too_short, "length_exceeded"),
        ("routing-endpoint-blocked", "Blocked endpoint", blocked, "endpoint_blocked"),
        (
            "routing-supported-edge",
            "Supported desk and cabinet edges",
            supported_edge_scene(),
            None,
        ),
        (
            "routing-underdesk-ties",
            "Underdesk cable ties",
            underdesk_scene("cable_tie"),
            None,
        ),
        (
            "routing-underdesk-tray",
            "Underdesk cable tray",
            underdesk_scene("cable_tray"),
            None,
        ),
        (
            "routing-underdesk-composite",
            "Composite underside lanes with tray option",
            composite_underdesk_scene(),
            None,
        ),
        (
            "routing-unsupported-span",
            "Missing underside supports",
            underdesk_scene("none"),
            "unsupported_span",
        ),
    )
    for identifier, label, scene, reason in routing_cases:
        routing = plan_routing(scene)
        _assert_version(scene, routing)
        expected = _routing_expected(routing)
        expected_status = "infeasible" if reason else "success"
        if expected != {
            "routing_status": expected_status,
            "reason_codes": [reason] if reason else [],
        }:
            raise AssertionError(f"{identifier}: unexpected routing outcome {expected}")
        if identifier == "routing-underdesk-composite":
            groups = routing["underside_tray_optimizations"]
            if (
                len(groups) != 1
                or groups[0]["status"] != "recommended"
                or set(groups[0]["cable_ids"]) != {value["id"] for value in scene["cables"]}
                or groups[0]["shared_length_m"] < 0.8
                or not groups[0]["requires_installation"]
            ):
                raise AssertionError("composite tray recommendation changed")
        policy = scene["routing_graph"].get("support_policy")
        if policy and not reason:
            declared_supports = {
                support["id"] for support in scene["routing_graph"]["supports"]
            }
            for routed_cable in routing["cables"]:
                check = routed_cable["support_check"]
                if (
                    check["status"] != "verified"
                    or check["max_unsupported_span_m"]
                    > policy["max_unsupported_span_m"]
                    or set(check["support_ids"]) != declared_supports
                ):
                    raise AssertionError(f"{identifier}: support verification changed")
        _write_json(output_dir / identifier / "scene.json", scene)
        _write_json(output_dir / identifier / "cable_routing.json", routing)
        manifest["cases"].append(
            {
                "id": identifier,
                "label": label,
                "kind": "routing",
                "description": (
                    "A diagnostic route through the desk hole."
                    if identifier == "routing-slot"
                    else "A diagnostic route behind the backboard."
                    if identifier == "routing-backboard"
                    else "A verified route rests on the desktop and uses ties at the hole rim and cabinet side."
                    if identifier == "routing-supported-edge"
                    else "A verified route runs 13 mm below the desktop with mounted cable ties."
                    if identifier == "routing-underdesk-ties"
                    else "A verified route runs inside a mechanical tray 13 mm below the desktop."
                    if identifier == "routing-underdesk-tray"
                    else "Three individually routed underside lanes retain a separate optional tray candidate."
                    if identifier == "routing-underdesk-composite"
                    else f"The domain planner rejects the cable with {reason}."
                ),
                **_case_urls(identifier, packing=False),
                "expected": expected,
            }
        )
    _write_json(output_dir / "manifest.json", manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2]
        / "frontend/public/algorithm-fixtures",
    )
    args = parser.parse_args()
    manifest = generate(args.output_dir)
    for entry in manifest["cases"]:
        print(json.dumps({"case": entry["id"], **entry["expected"]}, sort_keys=True))


if __name__ == "__main__":
    main()
