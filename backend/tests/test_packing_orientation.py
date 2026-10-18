import copy
import math
import unittest

from backend.app.domain.packing import plan_packing
from backend.examples.packing_demo import demo_scene, item, region


class TowerOrientationTests(unittest.TestCase):
    def scene(self):
        scene = demo_scene()
        scene.update(items=[], obstacles=[], reserved_zones=[], exposure_zones=[], cables=[], routing_graph={"nodes": [], "edges": []})
        scene["regions"] = [region("under-desk", (0, 1, 0, 1), height=0, clearance=1)]
        tower = item("tower", "computerTower", [.3, .5, .1], [.1, 0, .1], ["under-desk"])
        tower["allowed_rotations_y_rad"] = [0, math.pi / 2]
        scene["items"] = [tower]
        return scene

    def test_translation_keeps_tower_orientation_when_both_orientations_fit(self):
        scene = self.scene()
        scene["reserved_zones"] = [{"id": "seat", "min": [0, 0, 0], "max": [.3, .5, .3]}]
        result = plan_packing(scene)
        target = result["items"][0]
        self.assertEqual(result["status"], "success")
        self.assertEqual(target["target_rotation_y_rad"], 0)
        self.assertGreater(target["target_pos"][2], .3)

    def test_rotation_is_fallback_when_original_orientation_has_no_candidate(self):
        scene = self.scene()
        scene["regions"] = [region("under-desk", (0, .15, 0, 1), height=0, clearance=1)]
        result = plan_packing(scene)
        target = result["items"][0]
        self.assertEqual(result["status"], "success")
        self.assertEqual(target["target_rotation_y_rad"], math.pi / 2)

    def test_input_is_not_mutated(self):
        scene = self.scene()
        original = copy.deepcopy(scene)
        plan_packing(scene)
        self.assertEqual(scene, original)
