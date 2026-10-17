import copy
import itertools
import unittest

from backend.app.domain.packing import plan_packing, validate_layout
from backend.examples.packing_demo import demo_scene, item, preview_scene, region


def contested_scene():
    scene = demo_scene()
    scene.update(
        items=[],
        obstacles=[],
        reserved_zones=[],
        exposure_zones=[],
        cables=[],
        routing_graph={"nodes": [], "edges": []},
        regions=[
            region("desktop", (0, 1, 0, 0.6)),
            region("target", (0, 0.2, 0, 0.2)),
            region("narrow", (0, 0.1, 0, 0.2), 1.2),
        ],
    )
    scene["desk"]["width_m"] = 1.0
    return scene


def placements(result):
    return {placement["item_id"]: placement for placement in result["items"]}


class PlacementPriorityTests(unittest.TestCase):
    def test_high_priority_wins_scarce_target_despite_more_allowed_regions(self):
        scene = contested_scene()
        device = item(
            "device",
            "device",
            (0.2, 0.1, 0.2),
            (0.6, 0.77, 0.3),
            ["target", "narrow"],
            frequency="low",
        )
        device["placement_priority"] = 90
        clutter = item(
            "clutter",
            "box",
            (0.2, 0.1, 0.2),
            (0.85, 0.77, 0.3),
            ["target"],
            frequency="high",
        )
        clutter["placement_priority"] = 10
        expected = None
        for order in itertools.permutations([device, clutter]):
            with self.subTest(order=[obj["id"] for obj in order]):
                scene["items"] = list(order)
                result = plan_packing(scene)
                actual = placements(result)
                self.assertEqual(result["status"], "partial")
                self.assertEqual(actual["device"]["target_region_id"], "target")
                self.assertEqual(actual["device"]["placement_status"], "placed")
                self.assertEqual(actual["clutter"]["placement_status"], "unplaced")
                self.assertEqual(actual["clutter"]["target_pos"], clutter["position"])
                self.assertTrue(
                    validate_layout(preview_scene(scene, result))["geometry_valid"]
                )
                if expected is None:
                    expected = actual
                self.assertEqual(actual, expected)

    def test_priority_precedes_area_and_usage_frequency(self):
        scene = contested_scene()
        device = item(
            "device",
            "device",
            (0.15, 0.1, 0.2),
            (0.6, 0.77, 0.3),
            ["target"],
            frequency="low",
        )
        device["placement_priority"] = 1
        clutter = item(
            "clutter",
            "box",
            (0.2, 0.1, 0.2),
            (0.85, 0.77, 0.3),
            ["target"],
            frequency="high",
        )
        scene["items"] = [clutter, device]
        result = plan_packing(scene)
        actual = placements(result)
        self.assertEqual(actual["device"]["placement_status"], "placed")
        self.assertEqual(actual["clutter"]["placement_status"], "unplaced")
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])

    def test_equal_priority_preserves_constrained_region_fallback(self):
        scene = contested_scene()
        flexible = item(
            "flexible",
            "box",
            (0.2, 0.1, 0.2),
            (0.6, 0.77, 0.3),
            ["target", "narrow"],
        )
        constrained = item(
            "constrained",
            "box",
            (0.2, 0.1, 0.2),
            (0.85, 0.77, 0.3),
            ["target"],
        )
        for obj in [flexible, constrained]:
            obj["placement_priority"] = 80
        scene["items"] = [flexible, constrained]
        result = placements(plan_packing(scene))
        self.assertEqual(result["constrained"]["placement_status"], "placed")
        self.assertEqual(result["flexible"]["placement_status"], "unplaced")

    def test_missing_priority_matches_explicit_zero(self):
        scene = demo_scene()
        original = copy.deepcopy(scene)
        legacy = plan_packing(scene)
        self.assertEqual(scene, original)
        for obj in scene["items"]:
            obj["placement_priority"] = 0
        self.assertEqual(plan_packing(scene), legacy)

    def test_priority_does_not_displace_fixed_items_or_relax_geometry(self):
        scene = contested_scene()
        fixed = item(
            "fixed",
            "box",
            (0.2, 0.1, 0.2),
            (0.1, 0.77, 0.1),
            ["target"],
            fixed=True,
        )
        device = item(
            "device",
            "device",
            (0.2, 0.1, 0.2),
            (0.7, 0.77, 0.3),
            ["target"],
        )
        device["placement_priority"] = 100
        scene["items"] = [device, fixed]
        result = plan_packing(scene)
        actual = placements(result)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(actual["device"]["placement_status"], "unplaced")
        self.assertEqual(actual["device"]["target_pos"], device["position"])
        self.assertEqual(actual["fixed"]["target_pos"], fixed["position"])
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])


if __name__ == "__main__":
    unittest.main()
