import copy
import math
import unittest

from algorithm.cable_routing import RoutingInputError, plan_routes, resolve_port_world
from algorithm.cable_routing.geometry import beziers_arc_length, polyline_length


def scene_for(mode: str = "slot") -> dict:
    return {
        "schema_version": "1.0",
        "scene_id": "routing_test",
        "scene_revision": 4,
        "baseline_id": "baseline_1",
        "template_id": "demo_desk_v1",
        "desk": {"width_m": 1.0, "depth_m": 0.6, "top_height_m": 0.77},
        "wall": {"z_m": 0.6, "bounds_xy_m": [0.0, 1.0, 0.0, 1.0]},
        "items": [
            {
                "id": "source_item",
                "name": "source",
                "category": "device",
                "size_m": [0.1, 0.1, 0.1],
                "position": [0.05, 0.1, 0.1],
                "rotation_y_rad": math.pi / 2,
                "dimensions_confirmed": True,
                "collision": {"type": "box"},
                "ports": [
                    {
                        "id": "source_port",
                        "type": "power_source",
                        "local_position": [0.0, 0.0, 0.05],
                        "local_direction": [0.0, 0.0, 1.0],
                        "capacity": 1,
                        "confirmed": True,
                    }
                ],
            },
            {
                "id": "sink_item",
                "name": "sink",
                "category": "device",
                "size_m": [0.1, 0.1, 0.1],
                "position": [0.8, 0.1, 0.1],
                "rotation_y_rad": 0.0,
                "dimensions_confirmed": True,
                "collision": {"type": "box"},
                "ports": [
                    {
                        "id": "sink_port",
                        "type": "power_sink",
                        "local_position": [-0.05, 0.0, 0.0],
                        "local_direction": [-1.0, 0.0, 0.0],
                        "capacity": 1,
                        "confirmed": True,
                    }
                ],
            },
        ],
        "regions": [],
        "obstacles": [],
        "reserved_zones": [],
        "exposure_zones": [
            {"id": "desktop_exposure", "min": [0.0, 0.0, -0.2], "max": [1.0, 0.4, 0.4]}
        ],
        "routing_graph": {
            "nodes": [
                {"id": "slot_entry", "position": [0.2, 0.1, 0.1], "kind": "corner"},
                {"id": "slot_hole", "position": [0.3, 0.1, 0.1], "kind": "slot"},
                {"id": "back_entry", "position": [0.2, 0.1, 0.3], "kind": "corner"},
                {"id": "back_fix", "position": [0.3, 0.1, 0.3], "kind": "fixing_point"},
            ],
            "edges": [
                {
                    "id": "slot_channel",
                    "from_node_id": "slot_entry",
                    "to_node_id": "slot_hole",
                    "modes": ["slot"],
                    "clearance_radius_m": 0.05,
                    "exposed": False,
                },
                {
                    "id": "back_channel",
                    "from_node_id": "back_entry",
                    "to_node_id": "back_fix",
                    "modes": ["backboard"],
                    "clearance_radius_m": 0.05,
                    "exposed": False,
                },
            ],
        },
        "cables": [
            {
                "id": "cable_1",
                "start_port_id": "source_port",
                "end_port_id": "sink_port",
                "cable_type": "power",
                "thickness": "thin",
                "length_m": 2.0,
                "diameter_m": 0.004,
                "min_bend_radius_m": 0.02,
                "slack_m": 0.05,
                "mode": mode,
            }
        ],
    }


class CableRoutingTests(unittest.TestCase):
    def test_rotated_port_and_both_modes(self):
        scene = scene_for()
        position, direction = resolve_port_world(scene["items"][0], scene["items"][0]["ports"][0])
        self.assertEqual(position, (0.1, 0.1, 0.1))
        self.assertAlmostEqual(direction[0], 1.0)
        for mode in ("slot", "backboard"):
            scene["cables"][0]["mode"] = mode
            result = plan_routes(scene)
            self.assertEqual(result["status"], "success")
            cable = result["cables"][0]
            self.assertEqual(cable["status"], "valid")
            self.assertEqual(cable["reason_code"], None)
            self.assertGreaterEqual(len(cable["curve_segments"]), 1)
            self.assertGreaterEqual(len(cable["path_points"]), 2)
            self.assertEqual(cable["path_points"][0], [0.1, 0.1, 0.1])
            self.assertEqual(cable["path_points"][-1], [0.75, 0.1, 0.1])

    def test_dijkstra_matches_astar(self):
        scene = scene_for("backboard")
        astar = plan_routes(scene)
        dijkstra = plan_routes(scene, use_dijkstra=True)
        self.assertEqual(astar["cables"][0]["status"], "valid")
        self.assertEqual(dijkstra["cables"][0]["status"], "valid")
        self.assertAlmostEqual(
            astar["cables"][0]["path_length_m"], dijkstra["cables"][0]["path_length_m"], places=9
        )
        segments = [
            tuple(tuple(point) for point in segment["control_points"])
            for segment in astar["cables"][0]["curve_segments"]
        ]
        samples = [tuple(point) for point in astar["cables"][0]["path_points"]]
        self.assertAlmostEqual(astar["cables"][0]["path_length_m"], beziers_arc_length(segments), places=7)
        self.assertGreaterEqual(astar["cables"][0]["path_length_m"], polyline_length(samples))

    def test_length_failure_has_no_geometry(self):
        scene = scene_for()
        scene["cables"][0]["length_m"] = 0.1
        result = plan_routes(scene)
        cable = result["cables"][0]
        self.assertEqual(result["status"], "infeasible")
        self.assertEqual(cable["reason_code"], "length_exceeded")
        self.assertEqual(cable["curve_segments"], [])
        self.assertEqual(cable["path_points"], [])
        self.assertIsNone(cable["path_length_m"])
        self.assertIsNone(result["metrics"]["exposed_length_m"])

    def test_empty_request_has_zero_current_exposure(self):
        scene = scene_for()
        scene["cables"] = []
        result = plan_routes(scene)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["metrics"]["exposed_length_m"], 0.0)
        self.assertIsNone(result["metrics"]["baseline_exposed_length_m"])

    def test_capacity_conflict_marks_all_references(self):
        scene = scene_for()
        second = copy.deepcopy(scene["cables"][0])
        second["id"] = "cable_2"
        scene["cables"].append(second)
        result = plan_routes(scene)
        self.assertEqual(result["status"], "infeasible")
        self.assertEqual([c["reason_code"] for c in result["cables"]], ["port_occupied", "port_occupied"])

    def test_missing_strategy_is_reported(self):
        scene = scene_for("backboard")
        scene["routing_graph"]["edges"] = [scene["routing_graph"]["edges"][0]]
        result = plan_routes(scene)
        self.assertEqual(result["cables"][0]["reason_code"], "unsupported_mode")

    def test_unknown_baseline_stays_unknown(self):
        scene = scene_for()
        result = plan_routes(scene)
        self.assertIsNone(result["metrics"]["baseline_exposed_length_m"])

    def test_partial_routes_sum_only_verified_exposure(self):
        scene = scene_for()
        second_source = copy.deepcopy(scene["items"][0]["ports"][0])
        second_source.update({"id": "source_port_2", "local_position": [0.0, 0.02, 0.05]})
        second_sink = copy.deepcopy(scene["items"][1]["ports"][0])
        second_sink.update({"id": "sink_port_2", "local_position": [-0.05, 0.02, 0.0]})
        scene["items"][0]["ports"].append(second_source)
        scene["items"][1]["ports"].append(second_sink)
        failed = copy.deepcopy(scene["cables"][0])
        failed.update(
            {
                "id": "cable_2",
                "start_port_id": "source_port_2",
                "end_port_id": "sink_port_2",
                "length_m": 0.1,
                "mode": "backboard",
            }
        )
        scene["cables"].append(failed)

        single = plan_routes(copy.deepcopy(scene_for()))
        result = plan_routes(scene)

        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["cables"][1]["reason_code"], "length_exceeded")
        self.assertAlmostEqual(
            result["metrics"]["exposed_length_m"],
            single["metrics"]["exposed_length_m"],
            places=8,
        )

    def test_rounded_turn_stays_inside_strategy_channel(self):
        scene = scene_for("slot")
        scene["routing_graph"]["nodes"] = [
            {"id": "slot", "position": [0.2, 0.1, 0.2], "kind": "slot"},
            {"id": "corner", "position": [0.2, 0.1, 0.1], "kind": "corner"},
        ]
        scene["routing_graph"]["edges"] = [
            {
                "id": "slot_turn",
                "from_node_id": "corner",
                "to_node_id": "slot",
                "modes": ["slot"],
                "clearance_radius_m": 0.05,
                "exposed": False,
            }
        ]
        result = plan_routes(scene)
        cable = result["cables"][0]
        self.assertEqual(cable["status"], "valid")
        self.assertTrue(
            any(
                math.dist(point, [0.2, 0.1, 0.2]) <= 0.05
                for point in cable["path_points"]
            )
        )

    def test_unconfirmed_port_is_rejected_before_search(self):
        scene = scene_for()
        scene["items"][0]["ports"][0]["confirmed"] = False
        with self.assertRaises(RoutingInputError):
            plan_routes(scene)

    def test_missing_baseline_is_rejected_before_search(self):
        scene = scene_for()
        scene["baseline_id"] = None
        with self.assertRaises(RoutingInputError):
            plan_routes(scene)

    def test_power_strip_socket_contract_is_validated(self):
        scene = scene_for()
        strip = scene["items"][0]
        strip["category"] = "power_strip"
        strip["socket_count"] = 4
        with self.assertRaises(RoutingInputError):
            plan_routes(scene)

    def test_endpoint_block_and_unconfirmed_collision_item_are_rejected(self):
        scene = scene_for()
        scene["obstacles"] = [{"id": "leadout_block", "min": [0.101, 0.09, 0.09], "max": [0.15, 0.11, 0.11]}]
        self.assertEqual(plan_routes(scene)["cables"][0]["reason_code"], "endpoint_blocked")

        scene = scene_for()
        scene["items"][1]["dimensions_confirmed"] = False
        with self.assertRaises(RoutingInputError):
            plan_routes(scene)

    def test_multi_cable_channel_assigns_distinct_lanes(self):
        scene = scene_for()
        second_source = copy.deepcopy(scene["items"][0]["ports"][0])
        second_source.update({"id": "source_port_2", "local_position": [0.0, 0.02, 0.05]})
        second_sink = copy.deepcopy(scene["items"][1]["ports"][0])
        second_sink.update({"id": "sink_port_2", "local_position": [-0.05, 0.02, 0.0]})
        scene["items"][0]["ports"].append(second_source)
        scene["items"][1]["ports"].append(second_sink)
        scene["cables"].append(
            {
                **scene["cables"][0],
                "id": "cable_2",
                "start_port_id": "source_port_2",
                "end_port_id": "sink_port_2",
            }
        )
        result = plan_routes(scene)
        self.assertEqual(result["status"], "success")
        self.assertTrue(all(cable["status"] == "valid" for cable in result["cables"]))
        self.assertGreater(
            min(
                math.dist(first, second)
                for first in map(tuple, result["cables"][0]["path_points"])
                for second in map(tuple, result["cables"][1]["path_points"])
            ),
            0.005,
        )


if __name__ == "__main__":
    unittest.main()
