import unittest
from unittest.mock import patch

from backend.app.domain.routing import planner
from backend.app.domain.routing.geometry import AABB, normalize, sample_beziers, sub
from backend.app.domain.routing.support import SupportContext, SupportVolume
from backend.examples.packing_demo import cable


class PortHandleTests(unittest.TestCase):
    def test_search_can_use_parallel_network_around_an_occupied_cable(self):
        far_box = AABB((-2, -2, -2), (-1, -1, -1))
        start = planner.ResolvedEndpoint(
            "source", "source_item", (0.1, 0, 0), (1, 0, 0), far_box
        )
        end = planner.ResolvedEndpoint(
            "sink", "sink_item", (1.0, 0, 0), (-1, 0, 0), far_box
        )
        value = cable("parallel", "source", "sink", "power", "backboard")
        spec = planner.CableSpec(value, 0.002, "backboard", 0.015)
        nodes = {
            "near_start": ((0.3, 0, 0), "fixing_point"),
            "near_end": ((0.7, 0, 0), "fixing_point"),
            "parallel_start": ((0.3, 0, 0.1), "fixing_point"),
            "parallel_end": ((0.7, 0, 0.1), "fixing_point"),
        }
        edges = [
            {
                "id": name,
                "from_node_id": first,
                "to_node_id": last,
                "modes": ["backboard"],
                "clearance_radius_m": 0.02,
                "exposed": False,
            }
            for name, first, last in (
                ("near", "near_start", "near_end"),
                ("parallel", "parallel_start", "parallel_end"),
            )
        ]
        occupied = [(((0.35, 0, 0), (0.65, 0, 0)), 0.002)]
        for dijkstra in (False, True):
            with self.subTest(dijkstra=dijkstra):
                original, _, _ = planner._search_path(
                    nodes, edges, start, end, spec, [], [], {}, set(), dijkstra
                )
                rerouted, _, _ = planner._search_path(
                    nodes, edges, start, end, spec, [], [], {}, set(), dijkstra,
                    occupied=occupied,
                )
                self.assertEqual(original.edge_ids, ("near",))
                self.assertEqual(rerouted.edge_ids, ("parallel",))
                self.assertFalse(
                    planner._tube_conflicts(rerouted.points, spec.radius, occupied)
                )
        scene = {
            "items": [{"ports": [
                {"id": "source", "type": "power_source"},
                {"id": "sink", "type": "power_sink"},
            ]}]
        }
        with patch.object(planner, "_lane_candidates", return_value=()), patch.object(
            planner, "_search_path", wraps=planner._search_path
        ) as search:
            result, tube = planner._plan_one(
                scene, value, {"source": start, "sink": end}, nodes, edges,
                [], [], {}, occupied, False,
            )
        self.assertEqual(search.call_count, 2)
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["path_points"][0], list(start.position))
        self.assertEqual(result["path_points"][-1], list(end.position))
        self.assertFalse(planner._tube_conflicts(tube[0], spec.radius, occupied))

    def test_long_port_connector_avoids_nearby_leg_without_another_search(self):
        points = (
            (0.1, 0.345, -0.1125),
            (0.1, 0.345, -0.1085),
            (0.1, 0.7, -0.1),
            (0.1, 0.785, -0.1),
            (0.116, 0.7875, 0.08),
            (0.12, 0.7875, 0.08),
        )
        start = planner.ResolvedEndpoint(
            "wall",
            "wall_item",
            points[0],
            (0, 0, 1),
            AABB((0.065, 0.3, -0.1275), (0.135, 0.39, -0.1125)),
        )
        end = planner.ResolvedEndpoint(
            "strip",
            "strip_item",
            points[-1],
            (-1, 0, 0),
            AABB((0.12, 0.77, 0.0425), (0.48, 0.805, 0.1175)),
        )
        value = cable("bus", "wall", "strip", "power", "backboard")
        spec = planner.CableSpec(value, 0.002, "backboard", 0.015)
        obstacles = [AABB((0.02, 0.1, -0.07), (0.16, 0.745, 0.12))]
        boxes = {"wall_item": start.collision_box, "strip_item": end.collision_box}
        original = planner._polyline_to_beziers(
            points, 0.0165, start_direction=start.direction, end_direction=end.direction
        )
        reason, _ = planner._validate_curve(
            original,
            sample_beziers(original, 0.015),
            spec,
            start,
            end,
            obstacles,
            [],
            boxes,
            [],
        )
        self.assertEqual(reason, "collision")

        scene = {
            "items": [
                {
                    "ports": [
                        {"id": "wall", "type": "power_source"},
                        {"id": "strip", "type": "power_sink"},
                    ]
                }
            ]
        }
        nodes = {"rear": (points[2], "fixing_point"), "top": (points[3], "corner")}
        edges = [
            {
                "id": "rear_edge",
                "from_node_id": "rear",
                "to_node_id": "top",
                "modes": ["backboard"],
                "clearance_radius_m": 0.08,
            }
        ]
        search_path = planner.SearchPath(points, ("rear_edge",), (points[2],))
        with patch.object(
            planner, "_search_path", return_value=(search_path, ["rear"], ["top"])
        ) as search:
            result, _ = planner._plan_one(
                scene,
                value,
                {"wall": start, "strip": end},
                nodes,
                edges,
                obstacles,
                [],
                boxes,
                [],
                False,
            )
        self.assertEqual(search.call_count, 1)
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["path_points"][0], list(start.position))
        self.assertEqual(result["path_points"][-1], list(end.position))

    def test_local_handles_keep_long_upward_leadout_within_mounted_band(self):
        points = ((0, 0, 0), (0, 0.004, 0), (0, 0.014, -0.3))
        far_box = AABB((-2, -2, -2), (-1, -1, -1))
        start = planner.ResolvedEndpoint(
            "source", "source_item", points[0], (0, 1, 0), far_box
        )
        end = planner.ResolvedEndpoint(
            "sink",
            "sink_item",
            points[-1],
            normalize(sub(points[1], points[-1])),
            far_box,
        )
        value = cable("supported", "source", "sink", "power")
        spec = planner.CableSpec(value, 0.002, "slot", 0.015)
        context = SupportContext(
            (
                SupportVolume(
                    "mounted_band", AABB((-0.1, -0.01, -0.4), (0.1, 0.037, 0.1))
                ),
            ),
            0.03,
        )
        for factor, expected in ((None, "unsupported_span"), (1.2, None)):
            with self.subTest(factor=factor):
                segments = planner._polyline_to_beziers(
                    points,
                    0.0165,
                    start_direction=start.direction,
                    endpoint_handle_factor=factor,
                )
                reason, _ = planner._validate_curve(
                    segments,
                    sample_beziers(segments, 0.015),
                    spec,
                    start,
                    end,
                    [],
                    [],
                    {},
                    [],
                    support_context=context,
                )
                self.assertEqual(reason, expected)
                self.assertEqual(segments[0], planner._line_control_points(*points[:2]))


if __name__ == "__main__":
    unittest.main()
