import copy
import itertools
import unittest

from backend.app.domain.routing import plan_routing
from backend.app.domain.routing.geometry import (
    BEZIER_SAMPLE_ERROR,
    segment_segment_distance,
)
from backend.examples.algorithm_fixtures import (
    composite_underdesk_scene,
    underdesk_scene,
)


def two_cable_tray_scene(half_width_m: float) -> dict:
    scene = underdesk_scene("cable_tray")
    tray = scene["routing_graph"]["supports"][0]
    tray["bounds_uv_m"][2:] = [0.15 - half_width_m, 0.15 + half_width_m]
    tray["stand_off_m"] = 0.05
    for item, port_id in zip(scene["items"], ("source_port_2", "sink_port_2")):
        port = copy.deepcopy(item["ports"][0])
        port["id"] = port_id
        port["local_position"][1] = 0.03
        item["ports"].append(port)
    scene["cables"].append(
        {
            **scene["cables"][0],
            "id": "power_2",
            "start_port_id": "source_port_2",
            "end_port_id": "sink_port_2",
        }
    )
    return scene


class SupportedLaneTests(unittest.TestCase):
    def test_composite_lanes_can_be_grouped_by_an_optional_tray(self):
        baseline_scene = composite_underdesk_scene()
        baseline = plan_routing(baseline_scene)
        self.assertEqual(baseline["status"], "success")
        baseline_routes = baseline["cables"]
        baseline_by_id = {route["id"]: route for route in baseline_routes}
        recommendation = baseline["underside_tray_optimizations"][0]
        self.assertEqual(recommendation["status"], "recommended")
        self.assertEqual(recommendation["cable_ids"], ["power", "power_2", "power_3"])
        self.assertTrue(recommendation["requires_installation"])
        individual_scene = copy.deepcopy(baseline_scene)
        individual_scene["routing_graph"].pop("tray_candidates")
        individual = plan_routing(individual_scene)
        self.assertEqual(individual["cables"], baseline_routes)
        self.assertEqual(individual["metrics"], baseline["metrics"])
        self.assertEqual(individual["underside_tray_optimizations"], [])
        self.assertEqual(
            {route["id"] for route in baseline_routes},
            set(baseline_scene["routing_graph"]["tray_candidates"][0]["cable_ids"]),
        )
        self.assertTrue(
            all(
                route["status"] == "valid"
                and route["support_check"]["status"] == "verified"
                and all(
                    support_id.startswith("underside_tie_")
                    for support_id in route["support_check"]["support_ids"]
                )
                for route in baseline_routes
            )
        )

        # The individual paths share a long, parallel desktop-underbody
        # interval, while the cable-volume checks keep their lanes separate.
        intervals = [
            (
                min(point[0] for point in route["path_points"]),
                max(point[0] for point in route["path_points"]),
            )
            for route in baseline_routes
        ]
        shared_start = max(interval[0] for interval in intervals)
        shared_end = min(interval[1] for interval in intervals)
        self.assertGreater(shared_end - shared_start, 0.5)
        for first, second in itertools.combinations(baseline_routes, 2):
            separation = min(
                segment_segment_distance(
                    tuple(start), tuple(end), tuple(other_start), tuple(other_end)
                )
                for start, end in zip(first["path_points"], first["path_points"][1:])
                for other_start, other_end in zip(
                    second["path_points"], second["path_points"][1:]
                )
            )
            self.assertGreaterEqual(
                separation, baseline_scene["cables"][0]["diameter_m"] + 1e-6
            )

        # Applying the candidate is a separate optimization pass.  It changes
        # the installed support evidence, while preserving every individual
        # cable result and its no-collision lane assignment.
        optimized_scene = copy.deepcopy(baseline_scene)
        candidate = optimized_scene["routing_graph"].pop("tray_candidates")[0]
        candidate.pop("cable_ids")
        optimized_scene["routing_graph"]["supports"] = [candidate]
        optimized_scene["scene_revision"] += 1
        optimized = plan_routing(optimized_scene)
        self.assertEqual(optimized["status"], "success")
        self.assertEqual(optimized["scene_revision"], baseline["scene_revision"] + 1)
        self.assertEqual(baseline_scene["scene_revision"], baseline["scene_revision"])
        self.assertEqual(optimized["underside_tray_optimizations"][0]["status"], "verified")
        self.assertFalse(optimized["underside_tray_optimizations"][0]["requires_installation"])
        self.assertEqual(
            [route["id"] for route in optimized["cables"]],
            [route["id"] for route in baseline_routes],
        )
        for route in optimized["cables"]:
            self.assertEqual(route["status"], "valid")
            self.assertEqual(
                route["support_check"]["support_ids"], ["underside_tray_option"]
            )
            self.assertEqual(
                route["path_points"], baseline_by_id[route["id"]]["path_points"]
            )

    def test_collision_avoiding_lane_must_still_fit_the_installed_tray(self):
        broad_scene = two_cable_tray_scene(0.025)
        broad = plan_routing(broad_scene)
        self.assertEqual(broad["status"], "success")
        self.assertTrue(
            all(
                route["support_check"]["status"] == "verified"
                for route in broad["cables"]
            )
        )

        narrow_scene = two_cable_tray_scene(0.004)
        radius = narrow_scene["cables"][1]["diameter_m"] / 2.0
        narrow_centerline_limit = 0.004 - radius - BEZIER_SAMPLE_ERROR
        offset_route = broad["cables"][1]
        self.assertGreater(
            max(abs(point[2] - 0.15) for point in offset_route["path_points"]),
            narrow_centerline_limit,
        )

        # The second cable alone fits: occupied cable volume forces the offset.
        single_scene = copy.deepcopy(narrow_scene)
        single_scene["cables"] = [single_scene["cables"][1]]
        single = plan_routing(single_scene)["cables"][0]
        self.assertEqual(single["status"], "valid")
        self.assertEqual(single["support_check"]["status"], "verified")

        narrow = plan_routing(narrow_scene)
        self.assertEqual(narrow["status"], "partial")
        first, second = narrow["cables"]
        self.assertEqual(first["status"], "valid")
        self.assertEqual(first["support_check"]["status"], "verified")
        self.assertEqual(second["status"], "failed")
        self.assertNotEqual(second["support_check"]["status"], "verified")
        self.assertEqual(second["curve_segments"], [])
        self.assertEqual(second["path_points"], [])
        self.assertIsNone(second["path_length_m"])


if __name__ == "__main__":
    unittest.main()
