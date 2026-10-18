import copy
import math
import unittest
from itertools import pairwise

from backend.app.domain.routing import (
    RoutingInputError,
    plan_routes,
    resolve_port_world,
)
from backend.app.domain.routing.geometry import (
    AABB,
    BEZIER_SAMPLE_ERROR,
    EPSILON,
    bezier_point,
    beziers_arc_length,
    dot,
    minimum_curve_radius,
    normalize,
    obb_from_item,
    polyline_length,
    rotate_y,
    sample_beziers,
    sub,
)
from backend.app.domain.routing.planner import (
    CableSpec,
    ResolvedEndpoint,
    _curve_collides,
    _endpoint_exit,
    _line_control_points,
    _point_on_polyline,
    _search_path,
    _validate_curve,
)


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
                "dimensions_source": "user",
                "fixed": True,
                "usage_frequency": "high",
                "allowed_region_ids": [],
                "allowed_rotations_y_rad": [0.0, math.pi / 2],
                "image_url": None,
                "model_url": None,
                "generation": {"task_id": None, "status": "not_requested", "source": "placeholder", "error": None},
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
                "dimensions_source": "user",
                "fixed": True,
                "usage_frequency": "high",
                "allowed_region_ids": [],
                "allowed_rotations_y_rad": [0.0, math.pi / 2],
                "image_url": None,
                "model_url": None,
                "generation": {"task_id": None, "status": "not_requested", "source": "placeholder", "error": None},
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

    def test_search_includes_final_connection_in_shortest_path_cost(self):
        box = AABB((-2.0, -2.0, -2.0), (-1.0, -1.0, -1.0))
        start = ResolvedEndpoint("start", "source", (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), box)
        end = ResolvedEndpoint("end", "sink", (10.0, 0.0, 0.0), (-1.0, 0.0, 0.0), box)
        nodes = {
            "a": ((1.0, 0.0, 0.0), "corner"),
            "b": ((1.0, 0.0, 1.0), "slot"),
            "c": ((9.0, 0.0, 0.0), "corner"),
            "d": ((9.1, 0.0, 0.0), "slot"),
        }
        edges = [
            {
                "id": edge_id,
                "from_node_id": first,
                "to_node_id": last,
                "modes": ["slot"],
                "clearance_radius_m": 1.0,
                "exposed": False,
            }
            for edge_id, first, last in (("detour", "a", "b"), ("direct", "c", "d"))
        ]
        spec = CableSpec({"id": "test"}, 0.002, "slot", 0.02)
        for use_dijkstra in (False, True):
            path, _, _ = _search_path(
                nodes, edges, start, end, spec, [], [], {}, set(), use_dijkstra
            )
            self.assertIsNotNone(path)
            self.assertEqual(path.edge_ids, ("direct",))
            self.assertAlmostEqual(polyline_length(path.points), 10.0)

    def test_straight_segments_with_a_sharp_join_are_invalid(self):
        box = AABB((-2.0, -2.0, -2.0), (-1.0, -1.0, -1.0))
        start = ResolvedEndpoint("start", "source", (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), box)
        end = ResolvedEndpoint("end", "sink", (1.0, 0.0, 1.0), (0.0, 0.0, -1.0), box)
        segments = [
            _line_control_points(start.position, (1.0, 0.0, 0.0)),
            _line_control_points((1.0, 0.0, 0.0), end.position),
        ]
        spec = CableSpec({"id": "test", "length_m": 10.0, "slack_m": 0.0}, 0.002, "slot", 0.02)
        reason, _ = _validate_curve(
            segments,
            sample_beziers(segments, spec.min_bend_radius),
            spec,
            start,
            end,
            [],
            [],
            {"source": box, "sink": box},
            [],
        )
        self.assertEqual(reason, "no_path")

    def test_self_collision_exemption_is_only_the_finite_leadout(self):
        source_box = AABB((0.0, -0.05, -0.05), (0.1, 0.05, 0.05))
        sink_box = AABB((0.9, -0.05, -0.05), (1.0, 0.05, 0.05))
        start = ResolvedEndpoint("start", "source", (0.1, 0.0, 0.0), (1.0, 0.0, 0.0), source_box)
        end = ResolvedEndpoint("end", "sink", (0.9, 0.0, 0.0), (-1.0, 0.0, 0.0), sink_box)
        boxes = {"source": source_box, "sink": sink_box}
        start_exit, end_exit = _endpoint_exit(start, 0.002), _endpoint_exit(end, 0.002)
        valid = [start.position, start_exit, end_exit, end.position]
        self.assertFalse(_curve_collides(valid, 0.002, [], [], boxes, start, end))
        invalid = [
            [start.position, (0.08, 0.02, 0.0), start_exit, end_exit, end.position],
            valid + [(1.1, 0.0, 0.0), (1.1, 0.0, 0.2), (0.9, 0.0, 0.2), end.position],
            [start.position, start_exit, (0.5, 0.0, 0.0), start_exit] + valid,
        ]
        for samples in invalid:
            self.assertTrue(_curve_collides(samples, 0.002, [], [], boxes, start, end))
        # The centreline misses this obstacle, but the swept cable does not.
        nearby_obstacle = AABB((0.101, 0.0025, -0.001), (0.102, 0.004, 0.001))
        self.assertTrue(_curve_collides(valid, 0.002, [nearby_obstacle], [], boxes, start, end))

    def test_rotated_endpoint_exits_the_oriented_box(self):
        item = scene_for()["items"][0]
        item.update(size_m=[1.0, 0.1, 0.1], rotation_y_rad=math.pi / 4)
        port = item["ports"][0]
        position, direction = resolve_port_world(item, port)
        endpoint = ResolvedEndpoint(port["id"], item["id"], position, direction, obb_from_item(item))
        exit_position = _endpoint_exit(endpoint, 0.002)
        self.assertAlmostEqual(
            math.dist(position, exit_position), 0.002 + 2 * EPSILON + BEZIER_SAMPLE_ERROR
        )
        self.assertAlmostEqual(dot(normalize(sub(exit_position, position)), direction), 1.0)

        # A rigid scene rotation preserves the known valid route, including
        # the parts outside the OBB but inside its world AABB.
        scene = scene_for()
        for item in scene["items"]:
            item["position"] = list(rotate_y(tuple(item["position"]), math.pi / 4))
            item["rotation_y_rad"] += math.pi / 4
        for node in scene["routing_graph"]["nodes"]:
            node["position"] = list(rotate_y(tuple(node["position"]), math.pi / 4))
        result = plan_routes(scene)
        self.assertEqual(result["status"], "success")
        self.assertAlmostEqual(result["cables"][0]["path_length_m"], 0.65)

    def test_external_port_requires_its_analytic_tangent(self):
        box = AABB((-2.0, -2.0, -2.0), (-1.0, -1.0, -1.0))
        start = ResolvedEndpoint("start", "source", (0.0, 0.0, 0.0), (0.0, 0.0, 1.0), box)
        end = ResolvedEndpoint("end", "sink", (1.0, 0.0, 0.0), (-1.0, 0.0, 0.0), box)
        segments = [_line_control_points(start.position, end.position)]
        spec = CableSpec({"id": "test", "length_m": 10.0, "slack_m": 0.0}, 0.002, "slot", 0.02)
        reason, _ = _validate_curve(
            segments,
            sample_beziers(segments, spec.min_bend_radius),
            spec,
            start,
            end,
            [],
            [],
            {"source": box, "sink": box},
            [],
        )
        self.assertEqual(reason, "endpoint_blocked")

    def test_sampler_bounds_s_curve_and_rejects_exhausted_budget(self):
        segment = ((0.0, 0.0, 0.0), (0.0, 0.1, 0.0), (0.001, -0.1, 0.0), (0.001, 0.0, 0.0))
        samples = sample_beziers([segment], 0.02)
        self.assertGreater(len(samples), 2)
        for index in range(1001):
            self.assertTrue(_point_on_polyline(bezier_point(segment, index / 1000), samples, BEZIER_SAMPLE_ERROR))
        self.assertLessEqual(max(math.dist(a, b) for a, b in pairwise(samples)), 0.02 / 8 + 1e-12)
        huge_line = _line_control_points((0.0, 0.0, 0.0), (1e6, 0.0, 0.0))
        self.assertEqual(sample_beziers([huge_line], 0.02), [])

    def test_invalid_contract_fields_raise_routing_input_error(self):
        for key in ("length_m", "diameter_m", "min_bend_radius_m", "slack_m"):
            with self.subTest(missing=key):
                scene = scene_for()
                del scene["cables"][0][key]
                with self.assertRaises(RoutingInputError):
                    plan_routes(scene)
        scene = scene_for()
        scene["cables"][0]["length_m"] = 10**1000
        with self.assertRaises(RoutingInputError):
            plan_routes(scene)
        scene = scene_for()
        scene["items"][0]["allowed_region_ids"] = ["unknown"]
        with self.assertRaises(RoutingInputError):
            plan_routes(scene)

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

    def test_unknown_length_computes_the_same_verified_curve_in_both_modes(self):
        for mode in ("slot", "backboard"):
            with self.subTest(mode=mode):
                scene = scene_for(mode)
                known = plan_routes(scene)
                scene["cables"][0]["length_m"] = None
                original = copy.deepcopy(scene)
                result = plan_routes(scene)
                self.assertEqual(result["status"], "success")
                self.assertEqual(result["cables"], known["cables"])
                self.assertGreater(result["cables"][0]["path_length_m"], 0)
                self.assertEqual(scene, original)

    def test_unknown_length_preserves_obstacle_and_port_checks(self):
        scene = scene_for()
        scene["cables"][0]["length_m"] = None
        scene["obstacles"] = [
            {"id": "blocked", "min": [0.0, 0.05, 0.05], "max": [0.2, 0.15, 0.15]}
        ]
        result = plan_routes(scene)
        self.assertEqual(result["cables"][0]["status"], "failed")
        self.assertEqual(result["cables"][0]["path_points"], [])
        self.assertIsNone(result["cables"][0]["path_length_m"])
        scene["items"][0]["ports"][0]["confirmed"] = False
        with self.assertRaises(RoutingInputError):
            plan_routes(scene)

    def test_only_unknown_length_accepts_null_and_bend_limit_stays_nonnegative(self):
        for key, values in (
            ("length_m", (0, -1, True, "2", math.nan, math.inf)),
            ("diameter_m", (None, 0)),
            ("min_bend_radius_m", (None, -0.001, True, "0", math.nan, math.inf)),
        ):
            for value in values:
                with self.subTest(key=key, value=value):
                    scene = scene_for()
                    scene["cables"][0][key] = value
                    with self.assertRaises(RoutingInputError):
                        plan_routes(scene)

    def test_zero_bend_limit_allows_tight_smooth_turns_for_both_searches(self):
        for dijkstra in (False, True):
            with self.subTest(dijkstra=dijkstra):
                scene = scene_for("backboard")
                scene["cables"][0]["min_bend_radius_m"] = 0.5
                self.assertEqual(plan_routes(scene, use_dijkstra=dijkstra)["cables"][0]["reason_code"], "no_path")
                scene["cables"][0]["min_bend_radius_m"] = 0
                route = plan_routes(scene, use_dijkstra=dijkstra)["cables"][0]
                self.assertEqual(route["status"], "valid")
                segments = [segment["control_points"] for segment in route["curve_segments"]]
                self.assertGreater(minimum_curve_radius(segments), 0)
                self.assertLess(minimum_curve_radius(segments), 0.02)
                for previous, following in pairwise(segments):
                    incoming = normalize(sub(previous[3], previous[2]))
                    outgoing = normalize(sub(following[1], following[0]))
                    self.assertGreater(dot(incoming, outgoing), 1 - 1e-9)

    def test_zero_bend_limit_preserves_obstacles_zones_and_length_checks(self):
        for forbidden in ("obstacles", "reserved_zones"):
            with self.subTest(forbidden=forbidden):
                scene = scene_for()
                scene["cables"][0]["min_bend_radius_m"] = 0
                scene[forbidden] = [{"id": "blocked", "min": [0, 0.05, 0.05], "max": [0.2, 0.15, 0.15]}]
                route = plan_routes(scene)["cables"][0]
                self.assertEqual(route["reason_code"], "endpoint_blocked")
                self.assertEqual(route["path_points"], [])
        scene = scene_for()
        scene["cables"][0].update(min_bend_radius_m=0, length_m=0.1)
        route = plan_routes(scene)["cables"][0]
        self.assertEqual(route["reason_code"], "length_exceeded")
        self.assertEqual(route["path_points"], [])

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

    def test_multi_cable_routes_match_independent_routes_without_spacing(self):
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
        for cable in result["cables"]:
            segments = [entry["control_points"] for entry in cable["curve_segments"]]
            for previous, following in pairwise(segments):
                incoming = normalize(sub(previous[3], previous[2]))
                outgoing = normalize(sub(following[1], following[0]))
                self.assertGreater(dot(incoming, outgoing), 1.0 - 1e-9)
            # Finite endpoint lead-outs remain on the confirmed port normal.
            for segment in (segments[0], segments[-1]):
                self.assertTrue(all(abs(p[2] - 0.1) < 1e-12 for p in segment))
        for route in result["cables"]:
            individual = copy.deepcopy(scene)
            individual["cables"] = [c for c in scene["cables"] if c["id"] == route["id"]]
            self.assertEqual(route, plan_routes(individual)["cables"][0])
        self.assertLess(
            min(math.dist(a, b) for a in result["cables"][0]["path_points"]
                for b in result["cables"][1]["path_points"]),
            scene["cables"][0]["diameter_m"],
        )



if __name__ == "__main__":
    unittest.main()
