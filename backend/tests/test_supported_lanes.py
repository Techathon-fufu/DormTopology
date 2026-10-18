import copy
import unittest

from backend.app.domain.routing import plan_routing
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
        # interval; other cables do not displace their individual routes.
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
        for route in baseline_routes:
            single_scene = copy.deepcopy(individual_scene)
            single_scene["cables"] = [c for c in single_scene["cables"] if c["id"] == route["id"]]
            self.assertEqual(route, plan_routing(single_scene)["cables"][0])

        # Applying the candidate is a separate optimization pass.  It changes
        # the installed support evidence, while preserving every individual
        # cable result and its individual geometry.
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

    def test_overlapping_cables_share_tray_but_each_must_fit_its_width(self):
        scene = two_cable_tray_scene(0.004)
        result = plan_routing(scene)
        self.assertEqual(result["status"], "success")
        for route in result["cables"]:
            individual = copy.deepcopy(scene)
            individual["cables"] = [c for c in scene["cables"] if c["id"] == route["id"]]
            self.assertEqual(route, plan_routing(individual)["cables"][0])
            self.assertEqual(route["support_check"]["status"], "verified")

        too_narrow = two_cable_tray_scene(0.001)
        failed = plan_routing(too_narrow)
        self.assertEqual(failed["status"], "infeasible")
        for route in failed["cables"]:
            self.assertEqual(route["reason_code"], "unsupported_span")
            self.assertEqual(route["path_points"], [])
            self.assertEqual(route["curve_segments"], [])
            self.assertIsNone(route["path_length_m"])


if __name__ == "__main__":
    unittest.main()
