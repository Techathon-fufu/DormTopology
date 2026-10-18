"""Right-angle geometry is validated as geometry, never just an output label."""

import copy
import math
import unittest
from itertools import pairwise

from backend.app.domain.routing import RoutingInputError, plan_routing
from backend.app.domain.routing.geometry import dot, normalize, sub
from backend.examples.algorithm_fixtures import underdesk_scene
from backend.tests.test_routing import scene_for


def orthogonal_scene():
    scene = scene_for("backboard")
    scene["cables"][0]["min_bend_radius_m"] = 0
    scene["routing_graph"] = {
        "path_style": "orthogonal",
        "nodes": [
            {"id": "a", "position": [.25, .1, .2], "kind": "fixing_point"},
            {"id": "b", "position": [.5, .1, .2], "kind": "corner"},
            {"id": "c", "position": [.6, .1, .2], "kind": "corner"},
        ],
        "edges": [{"id": "ab", "from_node_id": "a", "to_node_id": "b",
                   "modes": ["backboard"], "clearance_radius_m": .02, "exposed": False},
                  {"id": "bc", "from_node_id": "b", "to_node_id": "c",
                   "modes": ["backboard"], "clearance_radius_m": .02, "exposed": False}],
    }
    return scene


class OrthogonalRoutingTests(unittest.TestCase):
    def assert_straight(self, result):
        cable = result["cables"][0]
        self.assertEqual(cable["status"], "valid", cable["reason_code"])
        points = cable["path_points"]
        for index, segment in enumerate(cable["curve_segments"]):
            controls = segment["control_points"]
            self.assertEqual(controls[0], points[index])
            self.assertEqual(controls[3], points[index + 1])
            for i, control in enumerate(controls):
                expected = [a + (b - a) * i / 3 for a, b in zip(controls[0], controls[3])]
                for actual, wanted in zip(control, expected):
                    self.assertAlmostEqual(actual, wanted)
        for a, b in pairwise(points[1:-1]):
            self.assertEqual(sum(abs(x - y) > 1e-9 for x, y in zip(a, b)), 1)
        for a, b, c in zip(points[1:], points[2:], points[3:-1]):
            alignment = dot(normalize(sub(b, a)), normalize(sub(c, b)))
            self.assertTrue(abs(alignment) < 1e-8 or abs(alignment - 1) < 1e-8)
        self.assertAlmostEqual(cable["path_length_m"], sum(math.dist(a, b) for a, b in pairwise(points)))

    def test_straight_segments_and_right_angle_vertices(self):
        scene = orthogonal_scene()
        original = copy.deepcopy(scene)
        self.assert_straight(plan_routing(scene))
        self.assertEqual(scene, original)

    def test_rotated_port_keeps_normal_exit(self):
        scene = orthogonal_scene()
        scene["items"][0]["rotation_y_rad"] = math.pi / 4
        result = plan_routing(scene)
        self.assert_straight(result)
        a, b = result["cables"][0]["path_points"][:2]
        direction = normalize(sub(b, a))
        self.assertAlmostEqual(direction[0], math.sqrt(.5))
        self.assertAlmostEqual(direction[2], math.sqrt(.5))

    def test_astar_matches_dijkstra(self):
        scene = orthogonal_scene()
        self.assertEqual(plan_routing(scene), plan_routing(scene, use_dijkstra=True))

    def test_shared_channel_keeps_each_independent_route(self):
        scene = orthogonal_scene()
        for item in scene["items"]:
            port = copy.deepcopy(item["ports"][0])
            port["id"] += "_second"
            port["local_position"][1] += .02
            item["ports"].append(port)
        scene["cables"].append({**scene["cables"][0], "id": "cable_2",
                                "start_port_id": "source_port_second",
                                "end_port_id": "sink_port_second", "diameter_m": .0065})
        result = plan_routing(scene)
        self.assertEqual(result["status"], "success")
        for route in result["cables"]:
            single = copy.deepcopy(scene)
            single["cables"] = [c for c in single["cables"] if c["id"] == route["id"]]
            self.assertEqual(route, plan_routing(single)["cables"][0])
        reversed_scene = copy.deepcopy(scene)
        reversed_scene["cables"].reverse()
        self.assertEqual(plan_routing(reversed_scene)["cables"], list(reversed(result["cables"])))

    def test_short_cable_has_no_geometry(self):
        scene = orthogonal_scene()
        scene["cables"][0]["length_m"] = .05
        cable = plan_routing(scene)["cables"][0]
        self.assertEqual(cable["reason_code"], "length_exceeded")
        self.assertEqual(cable["path_points"], [])
        self.assertEqual(cable["curve_segments"], [])
        self.assertIsNone(cable["path_length_m"])

    def test_unknown_length_still_reports_actual_route_length(self):
        scene = orthogonal_scene()
        scene["cables"][0]["length_m"] = None
        self.assert_straight(plan_routing(scene))

    def test_diagonal_network_is_rejected(self):
        scene = orthogonal_scene()
        scene["routing_graph"]["nodes"][1]["position"][2] += .1
        with self.assertRaisesRegex(RoutingInputError, "axis aligned"):
            plan_routing(scene)

    def test_positive_physical_bend_constraint_is_not_silently_ignored(self):
        scene = orthogonal_scene()
        scene["cables"][0]["min_bend_radius_m"] = .01
        with self.assertRaisesRegex(RoutingInputError, "bend-radius"):
            plan_routing(scene)

    def test_endpoint_obstacle_is_not_ignored(self):
        scene = orthogonal_scene()
        scene["obstacles"] = [{"id": "blocked", "min": [.101, 0, -.1], "max": [.2, .3, .4]}]
        result = plan_routing(scene)["cables"][0]
        self.assertEqual(result["reason_code"], "endpoint_blocked")
        self.assertEqual(result["path_points"], [])

    def test_support_is_still_required_when_enabled(self):
        scene = underdesk_scene("none")
        scene["routing_graph"]["path_style"] = "orthogonal"
        for cable in scene["cables"]:
            cable["min_bend_radius_m"] = 0
        result = plan_routing(scene)["cables"][0]
        self.assertEqual(result["reason_code"], "unsupported_span")
        self.assertEqual(result["path_points"], [])


if __name__ == "__main__":
    unittest.main()
