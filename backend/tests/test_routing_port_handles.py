import unittest
from dataclasses import replace
from unittest.mock import patch

from backend.app.domain.routing import planner
from backend.app.domain.routing.geometry import (
    AABB,
    dot,
    normalize,
    sample_beziers,
    sub,
)
from backend.app.domain.routing.support import SupportContext, SupportVolume
from backend.examples.packing_demo import cable


class PortHandleTests(unittest.TestCase):
    def test_lanes_can_use_the_other_channel_axis_without_crossing_side_walls(self):
        far_box = AABB((-2, -2, -2), (-1, -1, -1))
        start = planner.ResolvedEndpoint("source", "source_item", (0, 0, 0), (1, 0, 0), far_box)
        end = planner.ResolvedEndpoint("sink", "sink_item", (1, 0, 0), (-1, 0, 0), far_box)
        value = cable("lanes", "source", "sink", "power", "backboard")
        value["min_bend_radius_m"] = 0
        spec = planner.CableSpec(value, 0.002, "backboard", 0)
        segments = [planner._line_control_points((index / 10, 0, 0), ((index + 1) / 10, 0, 0)) for index in range(10)]
        occupied = [(((0.2, 0, 0), (0.8, 0, 0)), 0.002)]
        side_walls = [
            AABB((-0.1, -0.1, 0.004), (1.1, 0.1, 0.1)),
            AABB((-0.1, -0.1, -0.1), (1.1, 0.1, -0.004)),
        ]
        verified = []
        for candidate in planner._lane_candidates(segments, spec.radius, occupied, 0.013, flexible=True):
            samples = sample_beziers(candidate, 0)
            reason, _ = planner._validate_curve(candidate, samples, spec, start, end, side_walls, [], {}, occupied)
            if reason is None:
                verified.append(samples)
        self.assertTrue(verified)
        self.assertTrue(any(max(abs(point[1]) for point in samples) > 0.006 for samples in verified))
        self.assertTrue(all(abs(point[2]) < 0.0005 for samples in verified for point in samples))

    def test_search_uses_another_exit_instead_of_reversing_at_a_slot(self):
        far_box = AABB((-2, -2, -2), (-1, -1, -1))
        start = planner.ResolvedEndpoint("source", "source_item", (0, 0, 0), (1, 0, 0), far_box)
        end = planner.ResolvedEndpoint("sink", "sink_item", (0.1, 0, 0), (1, 0, 0), far_box)
        value = cable("same_side", "source", "sink", "power", "slot")
        spec = planner.CableSpec(value, 0.002, "slot", 0)
        nodes = {
            "entry": ((0.3, 0, 0), "corner"),
            "hole": ((0.4, 0, 0), "slot"),
            "other_exit": ((0.3, 0, 0.04), "corner"),
        }
        edges = [
            {"id": identifier, "from_node_id": first, "to_node_id": "hole",
             "modes": ["slot"], "clearance_radius_m": 0.02, "exposed": False}
            for identifier, first in (("in", "entry"), ("out", "other_exit"))
        ]
        for dijkstra in (False, True):
            with self.subTest(dijkstra=dijkstra):
                result, _, _ = planner._search_path(
                    nodes, edges, start, end, spec, [], [], {}, set(), dijkstra
                )
                self.assertIsNotNone(result)
                self.assertIn(nodes["other_exit"][0], result.points)
                cleaned = [value for index, value in enumerate(result.points) if index == 0 or value != result.points[index - 1]]
                for previous, current, following in zip(cleaned, cleaned[1:], cleaned[2:]):
                    self.assertGreater(dot(normalize(sub(current, previous)), normalize(sub(following, current))), -1 + 1e-5)
                impossible, _, _ = planner._search_path(
                    nodes, edges[:1], start, end, spec, [], [], {}, set(), dijkstra
                )
                self.assertIsNone(impossible)

    def test_search_prefers_sheltered_rear_edge_over_shorter_exposed_edge(self):
        far_box = AABB((-2, -2, -2), (-1, -1, -1))
        start = planner.ResolvedEndpoint("source", "source_item", (0.1, 0, 0), (1, 0, 0), far_box)
        end = planner.ResolvedEndpoint("sink", "sink_item", (1, 0, 0), (-1, 0, 0), far_box)
        value = cable("rear_preference", "source", "sink", "power", "backboard")
        spec = planner.CableSpec(value, 0.002, "backboard", 0)
        nodes = {
            "front_start": ((0.3, 0, 0), "fixing_point"),
            "front_end": ((0.7, 0, 0), "fixing_point"),
            "rear_start": ((0.3, 0, 0.15), "fixing_point"),
            "rear_end": ((0.7, 0, 0.15), "fixing_point"),
        }
        edges = [
            {
                "id": identifier,
                "from_node_id": first,
                "to_node_id": last,
                "modes": ["backboard"],
                "clearance_radius_m": 0.02,
                "exposed": exposed,
            }
            for identifier, first, last, exposed in (
                ("front", "front_start", "front_end", True),
                ("rear", "rear_start", "rear_end", False),
            )
        ]
        for dijkstra in (False, True):
            with self.subTest(dijkstra=dijkstra):
                result, _, _ = planner._search_path(
                    nodes, edges, start, end, spec, [], [], {}, set(), dijkstra
                )
                self.assertEqual(result.edge_ids, ("rear",))

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

    def test_extended_leadouts_search_parallel_channel_around_existing_cable(self):
        source_box = AABB((0, -0.025, -0.025), (0.1, 0.025, 0.025))
        sink_box = AABB((1, -0.025, -0.025), (1.1, 0.025, 0.025))
        start = planner.ResolvedEndpoint("source", "source_item", (0.1, 0, 0), (1, 0, 0), source_box)
        end = planner.ResolvedEndpoint("sink", "sink_item", (1, 0, 0), (-1, 0, 0), sink_box)
        value = cable("parallel_leadout", "source", "sink", "power", "backboard")
        value["min_bend_radius_m"] = 0
        nodes = {
            "near_start": ((0.3, 0, 0), "fixing_point"),
            "near_end": ((0.7, 0, 0), "fixing_point"),
            "parallel_start": ((0.3, 0, 0.1), "fixing_point"),
            "parallel_end": ((0.7, 0, 0.1), "fixing_point"),
        }
        edges = [
            {"id": identifier, "from_node_id": first, "to_node_id": last,
             "modes": ["backboard"], "clearance_radius_m": clearance, "exposed": False}
            for identifier, first, last, clearance in (
                ("near", "near_start", "near_end", 0.004),
                ("parallel", "parallel_start", "parallel_end", 0.02),
            )
        ]
        # The short channel physically fits one cable, with a separate open
        # parallel channel beyond its walls. A lateral curve offset cannot fit.
        obstacles = [
            AABB((0.3, -0.04, 0.004), (0.7, 0.04, 0.04)),
            AABB((0.3, -0.04, -0.04), (0.7, 0.04, -0.004)),
        ]
        boxes = {"source_item": source_box, "sink_item": sink_box}
        occupied = [(((0.35, 0, 0), (0.65, 0, 0)), 0.002)]
        scene = {"items": [{"ports": [
            {"id": "source", "type": "power_source"},
            {"id": "sink", "type": "power_sink"},
        ]}]}
        for extension in (0.04, 0.02):
            with self.subTest(extension=extension), patch.object(
                planner, "_search_path", wraps=planner._search_path
            ) as search:
                result, tube = planner._plan_one(
                    scene, value, {"source": start, "sink": end}, nodes, edges,
                    obstacles, [], boxes, occupied, False,
                    leadout_extension_m=extension,
                )
                self.assertEqual(search.call_count, 1)
                self.assertEqual(result["status"], "valid")
                self.assertIsNotNone(tube)
                self.assertEqual(result["path_points"][0], list(start.position))
                self.assertEqual(result["path_points"][-1], list(end.position))
                self.assertTrue(planner._point_on_polyline(
                    nodes["parallel_start"][0], tube[0], 0.017
                ))
                self.assertFalse(planner._tube_conflicts(tube[0], 0.002, occupied))
                self.assertFalse(planner._curve_collides(
                    tube[0], 0.002, obstacles, [], boxes,
                    replace(start, leadout_extension_m=extension),
                    replace(end, leadout_extension_m=extension),
                ))
                controls = result["curve_segments"]
                self.assertGreater(dot(normalize(sub(
                    controls[0]["control_points"][1], controls[0]["control_points"][0]
                )), start.direction), 1 - 1e-9)
                self.assertLess(dot(normalize(sub(
                    controls[-1]["control_points"][3], controls[-1]["control_points"][2]
                )), end.direction), -1 + 1e-9)

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
