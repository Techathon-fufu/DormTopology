import copy
import unittest
from unittest.mock import patch

from backend.app.domain.routing import RoutingInputError, plan_routing
from backend.app.domain.routing.optimizer import optimize_underside_trays
from backend.examples.algorithm_fixtures import composite_underdesk_scene


def line_route(identifier, start, end, diameter=0.004):
    controls = [
        [a + (b - a) * fraction for a, b in zip(start, end)]
        for fraction in (0, 1 / 3, 2 / 3, 1)
    ]
    return {
        "id": identifier,
        "status": "valid",
        "diameter_m": diameter,
        "curve_segments": [{"control_points": controls}],
        "path_points": [list(start), list(end)],
        "support_check": {
            "status": "not_evaluated",
            "max_unsupported_span_m": None,
            "support_ids": [],
        },
    }


def tray_scene(*, installed=False, bounds=(0.1, 1.3, 0.1, 0.3)):
    mount = {
        "id": "tray",
        "kind": "cable_tray",
        "obstacle_id": "desktop",
        "face": "y_min",
        "bounds_uv_m": list(bounds),
        "stand_off_m": 0.06,
        "cable_ids": ["a", "b", "c"],
    }
    graph = {"supports": [mount]} if installed else {"tray_candidates": [mount]}
    return {
        "obstacles": [{"id": "desktop", "min": [0, 0.75, 0], "max": [1.4, 0.78, 0.6]}],
        "routing_graph": graph,
    }


class TrayOptimizerTests(unittest.TestCase):
    def test_composite_routes_are_grouped_after_planning_without_mutation(self):
        scene = composite_underdesk_scene()
        result = plan_routing(scene)
        before_scene, before_routes = (
            copy.deepcopy(scene),
            copy.deepcopy(result["cables"]),
        )
        optimization = optimize_underside_trays(scene, result["cables"])[0]
        self.assertEqual(optimization["status"], "recommended")
        self.assertEqual(optimization["cable_ids"], ["power", "power_2", "power_3"])
        self.assertGreater(optimization["shared_length_m"], 0.8)
        self.assertLessEqual(
            optimization["occupied_width_m"], optimization["available_width_m"]
        )
        self.assertTrue(optimization["requires_installation"])
        self.assertIsNone(optimization["support_id"])
        self.assertEqual(scene, before_scene)
        self.assertEqual(result["cables"], before_routes)
        self.assertTrue(
            all(
                "underside_tray_option" not in route["support_check"]["support_ids"]
                for route in result["cables"]
            )
        )

    def test_candidate_and_installed_tray_have_distinct_semantics(self):
        routes = [
            line_route("a", (0.2, 0.73, 0.18), (1.2, 0.73, 0.18)),
            line_route("b", (0.2, 0.72, 0.20), (1.2, 0.72, 0.20)),
        ]
        before = copy.deepcopy(routes)
        proposed = optimize_underside_trays(tray_scene(), routes)[0]
        unsupported = optimize_underside_trays(tray_scene(installed=True), routes)[0]
        self.assertEqual(unsupported["status"], "not_used")
        verified_routes = copy.deepcopy(routes)
        for route in verified_routes:
            route["support_check"] = {
                "status": "verified",
                "max_unsupported_span_m": 0.0,
                "support_ids": ["tray"],
            }
        installed = optimize_underside_trays(
            tray_scene(installed=True), verified_routes
        )[0]
        self.assertEqual(proposed["status"], "recommended")
        self.assertTrue(proposed["requires_installation"])
        self.assertEqual(installed["status"], "verified")
        self.assertFalse(installed["requires_installation"])
        self.assertEqual(installed["support_id"], "tray")
        self.assertAlmostEqual(installed["shared_length_m"], 1.0)
        self.assertAlmostEqual(installed["occupied_width_m"], 0.025)
        self.assertEqual(routes, before)

    def test_disconnected_parallel_runs_cannot_be_joined_by_projection(self):
        first = line_route("a", (0.2, 0.73, 0.18), (0.32, 0.73, 0.18))
        outside = line_route("a", (0.32, 0.73, 0.18), (0.30, 0.60, 0.18))
        returning = line_route("a", (0.30, 0.60, 0.18), (0.30, 0.73, 0.18))
        last = line_route("a", (0.30, 0.73, 0.18), (0.42, 0.73, 0.18))
        first["curve_segments"] += (
            outside["curve_segments"]
            + returning["curve_segments"]
            + last["curve_segments"]
        )
        other = line_route("b", (0.2, 0.72, 0.20), (0.42, 0.72, 0.20))
        optimization = optimize_underside_trays(tray_scene(), [first, other])[0]
        self.assertEqual(optimization["status"], "not_used")
        self.assertEqual(optimization["shared_length_m"], 0.0)

    def test_single_failed_crossing_and_nonoverlapping_routes_are_not_grouped(self):
        first = line_route("a", (0.2, 0.73, 0.18), (1.2, 0.73, 0.18))
        failed = {
            **line_route("b", (0.2, 0.72, 0.20), (1.2, 0.72, 0.20)),
            "status": "failed",
        }
        cases = [
            [first],
            [first, failed],
            [first, line_route("b", (0.7, 0.72, 0.1), (0.7, 0.72, 0.3))],
            [
                line_route("a", (0.2, 0.73, 0.18), (0.6, 0.73, 0.18)),
                line_route("b", (0.7, 0.72, 0.20), (1.2, 0.72, 0.20)),
            ],
            [first, line_route("b", (1.2, 0.72, 0.20), (1.3, 0.72, 0.20))],
        ]
        for routes in cases:
            with self.subTest(routes=routes):
                optimization = optimize_underside_trays(tray_scene(), routes)[0]
                self.assertEqual(optimization["status"], "not_used")
                self.assertEqual(optimization["cable_ids"], [])
                self.assertEqual(optimization["shared_length_m"], 0.0)
                self.assertEqual(optimization["occupied_width_m"], 0.0)

    def test_coincident_routes_are_grouped_without_spacing_check(self):
        routes = [line_route(identifier, (0.2, 0.73, 0.18), (1.2, 0.73, 0.18), diameter)
                  for identifier, diameter in (("a", .004), ("b", .0065))]
        result = optimize_underside_trays(tray_scene(), routes)[0]
        self.assertEqual(result["status"], "recommended")
        self.assertEqual(result["cable_ids"], ["a", "b"])
        self.assertAlmostEqual(result["occupied_width_m"], .0075)

    def test_narrow_or_shallow_candidate_cannot_claim_capacity(self):
        routes = [
            line_route("a", (0.2, 0.73, 0.18), (1.2, 0.73, 0.18)),
            line_route("b", (0.2, 0.72, 0.20), (1.2, 0.72, 0.20)),
        ]
        narrow = tray_scene(bounds=(0.1, 1.3, 0.175, 0.185))
        result = optimize_underside_trays(narrow, routes)[0]
        self.assertEqual(result["status"], "not_used")
        self.assertEqual(result["reason_code"], "insufficient_width")
        shallow = tray_scene()
        shallow["routing_graph"]["tray_candidates"][0]["stand_off_m"] = 0.01
        self.assertEqual(
            optimize_underside_trays(shallow, routes)[0]["status"], "not_used"
        )

    def test_reverse_direction_and_z_longitudinal_trays_are_supported(self):
        routes = [
            line_route("a", (0.18, 0.73, 0.2), (0.18, 0.73, 1.2)),
            line_route("b", (0.20, 0.72, 1.2), (0.20, 0.72, 0.2)),
        ]
        scene = tray_scene(bounds=(0.1, 0.3, 0.1, 1.3))
        scene["obstacles"][0]["max"][2] = 1.4
        result = optimize_underside_trays(scene, routes)[0]
        self.assertEqual(result["status"], "recommended")
        self.assertAlmostEqual(result["shared_length_m"], 1.0)

    def test_budget_exhaustion_does_not_report_a_verified_group(self):
        routes = [
            line_route("a", (0.0, 0.73, 0.18), (1.4, 0.73, 0.18)),
            line_route("b", (0.0, 0.72, 0.20), (1.4, 0.72, 0.20)),
        ]
        with patch("backend.app.domain.routing.optimizer._MAX_SUBDIVISIONS", 0):
            result = optimize_underside_trays(tray_scene(), routes)[0]
        self.assertEqual(result["status"], "not_used")
        self.assertEqual(result["reason_code"], "not_evaluated")
        routes = [
            line_route("a", (0.2, 0.73, 0.18), (1.2, 0.73, 0.18)),
            line_route("b", (0.2, 0.72, 0.20), (1.2, 0.72, 0.20)),
        ]
        for budget in ("_MAX_RUNS", "_MAX_MEMBERSHIP_SETS"):
            with (
                self.subTest(budget=budget),
                patch(f"backend.app.domain.routing.optimizer.{budget}", 0),
            ):
                result = optimize_underside_trays(tray_scene(), routes)[0]
                self.assertEqual(result["status"], "not_used")
                self.assertEqual(result["reason_code"], "not_evaluated")

    def test_invalid_candidate_fields_are_rejected_at_planning_boundary(self):
        mutations = [
            lambda value: value.update(face="y_max"),
            lambda value: value.update(kind="surface"),
            lambda value: value.update(cable_ids=["power", "missing"]),
            lambda value: value.update(cable_ids=["power"]),
            lambda value: value.update(cable_ids=["power", "power"]),
            lambda value: value.update(stand_off_m=0.11),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                scene = composite_underdesk_scene()
                mutate(scene["routing_graph"]["tray_candidates"][0])
                with self.assertRaises(RoutingInputError) as caught:
                    plan_routing(scene)
                self.assertTrue(
                    caught.exception.field.startswith("routing_graph.tray_candidates")
                )

    def test_uninstalled_candidate_cannot_rescue_unsupported_cables(self):
        scene = composite_underdesk_scene()
        scene["routing_graph"]["supports"] = []
        result = plan_routing(scene)
        self.assertEqual(result["status"], "infeasible")
        for route in result["cables"]:
            self.assertEqual(route["reason_code"], "unsupported_span")
            self.assertEqual(route["path_points"], [])
            self.assertEqual(route["curve_segments"], [])
            self.assertEqual(route["support_check"]["status"], "not_evaluated")
        group = result["underside_tray_optimizations"][0]
        self.assertEqual(group["status"], "not_used")
        self.assertEqual(group["cable_ids"], [])


if __name__ == "__main__":
    unittest.main()
