import copy
import unittest

from backend.app.domain.routing import RoutingInputError, plan_routing
from backend.examples.algorithm_fixtures import supported_edge_scene, underdesk_scene


class SupportedPlanningTests(unittest.TestCase):
    def test_underside_needs_installed_support_not_only_proximity(self):
        unsupported = underdesk_scene("none")
        before = copy.deepcopy(unsupported)
        result = plan_routing(unsupported)
        self.assertEqual(result["cables"][0]["reason_code"], "unsupported_span")
        self.assertEqual(result["cables"][0]["path_points"], [])
        self.assertEqual(result["cables"][0]["curve_segments"], [])
        self.assertIsNone(result["metrics"]["exposed_length_m"])
        self.assertEqual(unsupported, before)

    def test_ties_and_continuous_tray_have_verified_support(self):
        for kind in ("cable_tie", "cable_tray"):
            with self.subTest(kind=kind):
                scene = underdesk_scene(kind)
                before = copy.deepcopy(scene)
                result = plan_routing(scene)
                route = result["cables"][0]
                self.assertEqual(route["status"], "valid")
                check = route["support_check"]
                self.assertEqual(check["status"], "verified")
                self.assertLessEqual(check["max_unsupported_span_m"], 0.23)
                self.assertTrue(check["support_ids"])
                self.assertTrue(all(abs(p[1] - 0.732) < 1e-9 for p in route["path_points"]))
                self.assertEqual(scene, before)

    def test_tie_spacing_and_policy_changes_invalidate_route(self):
        scene = underdesk_scene("cable_tie")
        scene["routing_graph"]["supports"] = scene["routing_graph"]["supports"][::2]
        self.assertEqual(plan_routing(scene)["cables"][0]["reason_code"], "unsupported_span")
        scene = underdesk_scene("cable_tie")
        scene["routing_graph"]["support_policy"]["max_unsupported_span_m"] = 0.05
        self.assertEqual(plan_routing(scene)["cables"][0]["reason_code"], "unsupported_span")

    def test_longer_supported_route_replaces_midair_shortcut(self):
        scene = supported_edge_scene()
        astar = plan_routing(scene)["cables"][0]
        dijkstra = plan_routing(scene, use_dijkstra=True)["cables"][0]
        self.assertEqual(astar["status"], "valid")
        self.assertEqual(dijkstra["status"], "valid")
        self.assertAlmostEqual(astar["path_length_m"], dijkstra["path_length_m"], places=8)
        self.assertIn("hole_rim_tie", astar["support_check"]["support_ids"])
        self.assertTrue(any(identifier.startswith("cabinet_tie_") for identifier in astar["support_check"]["support_ids"]))
        legacy = copy.deepcopy(scene)
        del legacy["routing_graph"]["support_policy"]
        del legacy["routing_graph"]["supports"]
        unchecked = plan_routing(legacy)["cables"][0]
        self.assertEqual(unchecked["support_check"]["status"], "not_evaluated")
        self.assertGreater(astar["path_length_m"], unchecked["path_length_m"] + 0.01)

    def test_mount_contract_rejects_invalid_physical_support(self):
        mutations = (
            lambda scene: scene["routing_graph"].pop("support_policy"),
            lambda scene: scene["routing_graph"]["supports"][0].update(obstacle_id="missing"),
            lambda scene: scene["routing_graph"]["supports"][0].update(id="source"),
            lambda scene: scene["routing_graph"]["supports"][0].update(kind="surface"),
            lambda scene: scene["routing_graph"]["supports"][0].update(stand_off_m=0.051),
            lambda scene: scene["routing_graph"]["supports"][0].update(bounds_uv_m=[0, 0.4, 0.1, 0.14]),
            lambda scene: scene["routing_graph"]["supports"][0].update(bounds_uv_m=[-0.01, 0.01, 0.1, 0.14]),
            lambda scene: scene["routing_graph"]["support_policy"].update(max_unsupported_span_m=0),
            lambda scene: scene["routing_graph"]["support_policy"].update(max_unsupported_span_m=float("nan")),
        )
        for index, mutate in enumerate(mutations):
            with self.subTest(mutation=index):
                scene = underdesk_scene("cable_tie")
                mutate(scene)
                with self.assertRaises(RoutingInputError) as caught:
                    plan_routing(scene)
                self.assertEqual(caught.exception.code, "invalid_input")
                self.assertTrue(caught.exception.field.startswith("routing_graph"))

    def test_impossible_bend_is_not_misreported_as_missing_support(self):
        scene = supported_edge_scene()
        scene["cables"][0]["min_bend_radius_m"] = 1.0
        route = plan_routing(scene)["cables"][0]
        self.assertEqual(route["reason_code"], "no_path")
        self.assertEqual(route["path_points"], [])
        self.assertEqual(route["curve_segments"], [])
        self.assertEqual(route["support_check"]["status"], "not_evaluated")


if __name__ == "__main__":
    unittest.main()
