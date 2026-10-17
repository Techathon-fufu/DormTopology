import copy
import itertools
import tempfile
import unittest
from pathlib import Path

from backend.app.db.sqlite import SQLiteOrganizationRepository
from backend.app.domain.errors import SceneInputError
from backend.app.domain.packing import measure_free_area, plan_packing, validate_layout
from backend.app.domain.rules import validate_scene
from backend.app.service.organization import OrganizationService
from backend.examples.packing_demo import demo_scene, item, preview_scene, region, zone
from backend.tests.test_organization_service import ImmediateExecutor


def preference_scene():
    scene = demo_scene()
    scene.update(
        items=[item("object", "box", (0.2, 0.1, 0.2), (0.5, 0.77, 0.3), ["desktop", "floor"])],
        regions=[
            region("desktop", (0, 1, 0, 0.6)),
            region("floor", (0, 1, 0, 0.6), 0),
        ],
        obstacles=[],
        reserved_zones=[],
        exposure_zones=[],
        cables=[],
        routing_graph={"nodes": [], "edges": []},
    )
    scene["desk"]["width_m"] = 1.0
    return scene


class RegionPreferenceTests(unittest.TestCase):
    def test_missing_and_empty_preferences_preserve_legacy_output(self):
        scene = demo_scene()
        original = copy.deepcopy(scene)
        legacy = plan_packing(scene)
        self.assertEqual(scene, original)
        for obj in scene["items"]:
            obj["preferred_region_ids"] = []
        self.assertEqual(plan_packing(scene), legacy)

    def test_desktop_preference_precedes_maximum_free_desktop_area(self):
        scene = preference_scene()
        legacy = plan_packing(scene)
        self.assertEqual(legacy["items"][0]["target_region_id"], "floor")
        scene["items"][0]["preferred_region_ids"] = ["desktop"]
        original = copy.deepcopy(scene)
        preferred = plan_packing(scene)
        self.assertEqual(preferred["status"], "success")
        self.assertEqual(preferred["items"][0]["target_region_id"], "desktop")
        self.assertLess(
            measure_free_area(preview_scene(scene, preferred)),
            measure_free_area(preview_scene(scene, legacy)),
        )
        self.assertEqual(scene, original)

    def test_preference_group_is_unordered_and_deterministic(self):
        scene = preference_scene()
        scene["regions"].extend([
            region("shelf-left", (0, 0.4, 0, 0.3), 1.2),
            region("shelf-right", (0.6, 1, 0, 0.3), 1.2),
        ])
        obj = scene["items"][0]
        obj["allowed_region_ids"].extend(["shelf-left", "shelf-right"])
        expected = None
        for preferred in itertools.permutations(["shelf-left", "shelf-right"]):
            for reverse_regions in (False, True):
                with self.subTest(preferred=preferred, reverse_regions=reverse_regions):
                    candidate = copy.deepcopy(scene)
                    candidate["items"][0]["preferred_region_ids"] = list(preferred)
                    if reverse_regions:
                        candidate["regions"].reverse()
                        candidate["items"][0]["allowed_region_ids"].reverse()
                    result = plan_packing(candidate)
                    self.assertEqual(result["status"], "success")
                    self.assertIn(result["items"][0]["target_region_id"], preferred)
                    if expected is None:
                        expected = result
                    self.assertEqual(result, expected)

    def test_blocked_or_too_small_preference_falls_back_to_allowed_desktop(self):
        for blocked in (False, True):
            with self.subTest(blocked=blocked):
                scene = preference_scene()
                scene["regions"].append(region("shelf", (0, 1 if blocked else 0.05, 0, 0.6), 1.2))
                scene["items"][0].update(
                    allowed_region_ids=["desktop", "shelf"], preferred_region_ids=["shelf"]
                )
                if blocked:
                    scene["obstacles"] = [zone("shelf-blocked", (0, 1.2, 0), (1, 1.4, 0.6))]
                result = plan_packing(scene)
                self.assertEqual(result["status"], "success")
                self.assertEqual(result["items"][0]["target_region_id"], "desktop")
                self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])

    def test_insufficient_allowed_desktop_retains_item_instead_of_using_floor(self):
        scene = preference_scene()
        scene["regions"].append(region("desk-target", (0, 0.1, 0, 0.1)))
        scene["items"][0].update(
            allowed_region_ids=["desk-target"], preferred_region_ids=["desk-target"]
        )
        result = plan_packing(scene)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["items"][0]["placement_status"], "unplaced")
        self.assertEqual(result["items"][0]["target_pos"], scene["items"][0]["position"])
        self.assertTrue(validate_layout(preview_scene(scene, result))["geometry_valid"])

    def test_fixed_item_preserves_pose_despite_preferred_floor(self):
        scene = preference_scene()
        scene["items"][0].update(fixed=True, preferred_region_ids=["floor"])
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["items"][0]["placement_status"], "unchanged")
        self.assertEqual(result["items"][0]["target_pos"], scene["items"][0]["position"])

    def test_invalid_unknown_disallowed_and_duplicate_preferences_are_rejected(self):
        for preferred in (None, "desktop", {}, [False], [[]], ["unknown"], ["desktop", "desktop"], ["other"]):
            with self.subTest(preferred=preferred):
                scene = preference_scene()
                scene["regions"].append(region("other", (0, 1, 0, 0.6), 1.2))
                scene["items"][0]["preferred_region_ids"] = preferred
                with self.assertRaises(SceneInputError) as caught:
                    validate_scene(scene)
                self.assertEqual(caught.exception.field, "items[0].preferred_region_ids")

    def test_service_preserves_preferences_and_versions_changed_preference(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = SQLiteOrganizationRepository(Path(directory) / "preferences.sqlite3")
            try:
                service = OrganizationService(repository, ImmediateExecutor())
                scene = preference_scene()
                scene["items"][0]["preferred_region_ids"] = ["desktop"]
                saved = service.save_scene("project", scene, None, "original", scene)
                accepted = service.submit(saved["scene_id"], saved["scene_revision"])
                job = service.get_job(accepted["job_id"])
                self.assertEqual(job["result"]["items"][0]["target_region_id"], "desktop")
                applied = service.apply_job(job["job_id"], saved["scene_id"], saved["scene_revision"])
                self.assertEqual(applied["items"][0]["preferred_region_ids"], ["desktop"])
                self.assertEqual(applied["scene_revision"], 2)
                applied["items"][0]["preferred_region_ids"] = ["floor"]
                updated = service.save_scene("project", applied, 2, "original")
                self.assertEqual(updated["scene_revision"], 3)
                self.assertEqual(repository.get_baseline(saved["baseline_id"])["items"][0]["preferred_region_ids"], ["desktop"])
                accepted = service.submit(updated["scene_id"], updated["scene_revision"])
                job = service.get_job(accepted["job_id"])
                self.assertEqual(job["result"]["items"][0]["target_region_id"], "floor")
                final = service.apply_job(job["job_id"], updated["scene_id"], 3)
                self.assertEqual(final["items"][0]["preferred_region_ids"], ["floor"])
                self.assertEqual(final["scene_revision"], 4)
            finally:
                repository.close()


if __name__ == "__main__":
    unittest.main()
