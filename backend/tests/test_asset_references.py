"""Retired asset paths cannot enter either domain planning workflow."""
import unittest

from backend.app.domain.errors import SceneInputError
from backend.app.domain.packing import plan_packing
from backend.app.domain.routing import plan_routing
from backend.examples.packing_demo import demo_scene


class AssetReferenceTests(unittest.TestCase):
    def test_retired_paths_rejected_before_planning(self):
        for url in ("objects/desk.glb", "/objects/desk.glb", "../objects/desk.glb",
                    r"C:\project\objects\desk.glb", "https://host/%6fbjects/desk.glb",
                    "/%256fbjects%252fdesk.glb"):
            for plan in (plan_packing, plan_routing):
                for field in ("model_url", "image_url"):
                    with self.subTest(url=url, plan=plan.__name__, field=field):
                        scene = demo_scene()
                        scene["items"][0][field] = url
                        with self.assertRaisesRegex(SceneInputError, "objects/ assets are retired"):
                            plan(scene)

    def test_official_asset_reference_is_preserved(self):
        scene = demo_scene()
        scene["items"][0]["model_url"] = "Prefabmodel/monitor.glb"
        self.assertEqual(plan_packing(scene)["status"], "success")
