"""Transaction invariants; browser acceptance separately runs real algorithms."""
import copy
import io
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from backend.app.bootstrap import Settings, create_app
from backend.app.db.sqlite_store import SQLiteSceneStore
from backend.app.service.ports import StoreConflict
from backend.app.service.scenes import SceneService, ServiceError
from backend.examples.packing_demo import demo_scene


def empty_scene():
    scene = demo_scene()
    scene.update(items=[], cables=[], baseline_id=None)
    return scene


def packing(scene):
    return dict(schema_version="1.0", scene_id=scene["scene_id"],
                scene_revision=scene["scene_revision"], status="success", items=[], issues=[])


def routing(scene):
    routes = []
    for index, cable in enumerate(scene["cables"]):
        value = copy.deepcopy(cable)
        value.update(status="valid" if index else "failed", path_points=[], curve_segments=[],
                     path_length_m=1.0 if index else None,
                     reason_code=None if index else "length_exceeded")
        routes.append(value)
    return dict(schema_version="1.0", scene_id=scene["scene_id"],
                scene_revision=scene["scene_revision"], status="partial", cables=routes,
                metrics={"exposed_length_m": 0.4, "baseline_exposed_length_m": None}, issues=[])


class SceneServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "scenes.sqlite"
        self.store = SQLiteSceneStore(self.path)
        self.service = SceneService(self.store, empty_scene, packing=packing, routing=routing,
                                    layout_validator=lambda s: {"geometry_valid": True, "issues": []},
                                    free_area=lambda s: 0.8)
        self.doc = self.service.create_scene(None)
        self.sid = self.doc["scene"]["scene_id"]

    def confirm(self):
        return self.service.create_baseline(self.sid, self.doc["scene"]["scene_revision"])

    def test_confirmation_snapshot_and_reopen(self):
        self.doc = self.confirm()
        original = copy.deepcopy(self.doc["baseline"])
        scene = copy.deepcopy(self.doc["scene"])
        scene["desk"]["width_m"] += 0.1
        self.service.update_scene(self.sid, {"expected_revision": 2, "scene": scene})
        restored = SceneService(SQLiteSceneStore(self.path)).get_scene(self.sid)
        self.assertEqual(restored["baseline"], original)
        self.assertEqual(restored["scene"]["scene_revision"], 3)

    def test_packing_requires_confirmed_baseline(self):
        with self.assertRaises(ServiceError) as error:
            self.service.create_packing(self.sid, 1)
        self.assertEqual(error.exception.status, 400)

    def test_preview_does_not_apply_and_accept_consumes_once(self):
        self.doc = self.confirm()
        proposed = self.service.create_packing(self.sid, 2)
        self.assertEqual(proposed["scene"], self.doc["scene"])
        applied = self.service.apply_packing(self.sid, 2)
        self.assertEqual(applied["scene"]["scene_revision"], 3)
        self.assertIsNone(applied["packing_result"])
        with self.assertRaises(ServiceError):
            self.service.apply_packing(self.sid, 2)

    def test_same_revision_cas_rejects_lost_updates(self):
        original = self.store.load(self.sid)
        first = copy.deepcopy(original)
        first["scene"]["photo_url"] = "/first"
        self.store.compare_and_swap(self.sid, 1, first, base_document=original)
        with self.assertRaises(StoreConflict):
            self.store.compare_and_swap(self.sid, 1, original, base_document=original)
        self.assertEqual(self.store.load(self.sid)["scene"]["photo_url"], "/first")

    def test_edit_during_planning_rejects_late_result(self):
        self.doc = self.confirm()
        def interleaved(scene):
            result = packing(scene)
            changed = copy.deepcopy(scene)
            changed["desk"]["width_m"] += 0.1
            self.service.update_scene(self.sid, {"expected_revision": 2, "scene": changed})
            return result
        self.service._packing = interleaved
        with self.assertRaises(ServiceError) as error:
            self.service.create_packing(self.sid, 2)
        self.assertEqual(error.exception.status, 409)
        self.assertIsNone(self.service.get_scene(self.sid)["packing_result"])

    def test_failed_route_total_unknown_and_no_failed_execution_step(self):
        self.doc = self.service.create_scene(demo_scene())
        self.sid = self.doc["scene"]["scene_id"]
        self.doc = self.confirm()
        planned = self.service.create_routing(self.sid, 2)
        self.assertEqual(planned["routing_result"]["metrics"]["exposed_length_m"], 0.4)
        guide = self.service.create_guide(self.sid, 2)
        self.assertEqual(guide["guide"]["status"], "incomplete")
        self.assertIsNone(guide["comparison"]["current_exposed_length_m"])
        failed = self.doc["scene"]["cables"][0]["id"]
        execution = guide["guide"]["markdown"].split("## 已通过校验的接线与固定步骤")[1].split("## 未解决事项")[0]
        self.assertNotIn(failed, execution)
        self.assertEqual(guide["comparison"]["baseline_free_area_m2"], 0.8)
        edited = copy.deepcopy(guide["scene"])
        edited["cables"][0]["length_m"] += 0.1
        saved = self.service.update_scene(self.sid, {"expected_revision": 2, "scene": edited})
        self.assertIsNone(saved["routing_result"])
        self.assertIsNone(saved["guide"])
        with self.assertRaises(ServiceError):
            self.service.get_guide_markdown(self.sid)

    def test_dimension_edit_requires_reconfirmation_and_preserves_source(self):
        self.doc = self.service.create_scene(demo_scene())
        self.sid = self.doc["scene"]["scene_id"]
        self.doc = self.confirm()
        source = self.doc["scene"]["items"][0]["dimensions_source"]
        scene = copy.deepcopy(self.doc["scene"])
        scene["items"][0]["size_m"][0] += 0.01
        saved = self.service.update_scene(self.sid, {"expected_revision": 2, "scene": scene})
        item = saved["scene"]["items"][0]
        self.assertEqual(item["dimensions_source"], source)
        self.assertFalse(item["dimensions_confirmed"])
        report = self.service.create_guide(self.sid, 3)
        self.assertIsNone(report["comparison"]["baseline_free_area_m2"])

    def test_empty_routes_and_stale_revision(self):
        self.doc = self.confirm()
        doc = self.service.create_guide(self.sid, 2)
        self.assertEqual(doc["guide"]["status"], "complete")
        self.assertEqual(doc["comparison"]["current_exposed_length_m"], 0)
        with self.assertRaises(ServiceError) as error:
            self.service.create_baseline(self.sid, 99)
        self.assertEqual(error.exception.status, 409)


WORKFLOW = "/api/v1/workflow"


def make_client(temp_dir: Path) -> TestClient:
    org_db = temp_dir / "organization.sqlite3"
    workflow_db = temp_dir / "workflow.sqlite3"
    workflow_data = temp_dir / "workflow-data"
    settings = Settings(
        database_path=org_db,
        workflow_database_path=workflow_db,
        workflow_data_dir=workflow_data,
    )
    return TestClient(create_app(settings))


class SceneApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)
        self.client = make_client(self.dir)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def test_template_confirmation_and_stale(self):
        created = self.client.post(f'{WORKFLOW}/scenes', json={})
        self.assertEqual(created.status_code, 200, created.text)
        doc = created.json()
        self.assertEqual(sum(not i['fixed'] for i in doc['scene']['items']), 8)
        self.assertEqual(len(doc['scene']['cables']), 3)
        sid = doc['scene']['scene_id']
        confirmed = self.client.post(f'{WORKFLOW}/scenes/{sid}/baseline', json={'expected_revision': 1})
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        stale = self.client.post(f'{WORKFLOW}/scenes/{sid}/baseline', json={'expected_revision': 1})
        self.assertEqual(stale.status_code, 409)

    def test_invalid_schema_and_missing(self):
        self.assertEqual(self.client.post(f'{WORKFLOW}/scenes', json={'scene': {}}).status_code, 400)
        self.assertEqual(self.client.post(f'{WORKFLOW}/scenes', content='{').status_code, 400)
        self.assertEqual(self.client.get(f'{WORKFLOW}/scenes/absent').status_code, 404)

    def test_photo_roundtrip_and_invalid_payload(self):
        doc = self.client.post(f'{WORKFLOW}/scenes', json={}).json()
        sid = doc['scene']['scene_id']
        url = f'{WORKFLOW}/scenes/{sid}/photos'
        invalid = self.client.post(url, data={'expected_revision': '1'}, files={'file': ('x.png', b'invalid', 'image/png')})
        self.assertEqual(invalid.status_code, 400)
        png = io.BytesIO()
        Image.new('RGB', (8, 8), 'teal').save(png, format='PNG')
        saved = self.client.post(url, data={'expected_revision': '1'}, files={'file': ('x.png', png.getvalue(), 'image/png')})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()['scene']['scene_revision'], 1)
        photo_url = saved.json()['photo_url']
        self.assertTrue(photo_url.startswith(f'{WORKFLOW}/photos/'))
        self.assertEqual(self.client.get(photo_url).status_code, 200)

    def test_workflow_and_organization_coexist(self):
        created = self.client.post(f'{WORKFLOW}/scenes', json={})
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(self.client.get('/api/v1/health').status_code, 200)
        org_scene = self.client.get('/api/v1/scenes/absent')
        self.assertEqual(org_scene.status_code, 404)
        workflow_health = self.client.get(f'{WORKFLOW}/health')
        self.assertEqual(workflow_health.status_code, 200)

    def test_application_instances_do_not_share_workflow_resources(self):
        first = self.client.post(f'{WORKFLOW}/scenes', json={}).json()
        sid = first['scene']['scene_id']
        other_dir = self.dir / 'other-app'
        other_settings = Settings(
            database_path=other_dir / 'organization.sqlite3',
            workflow_database_path=other_dir / 'workflow.sqlite3',
            workflow_data_dir=other_dir / 'workflow-data',
        )
        other_app = create_app(other_settings)
        self.assertFalse(other_dir.exists(), 'App factory must defer resource creation until lifespan')
        with TestClient(other_app) as other:
            self.assertEqual(other.get(f'{WORKFLOW}/scenes/{sid}').status_code, 404)
            self.assertEqual(self.client.get(f'{WORKFLOW}/scenes/{sid}').status_code, 200)
            self.assertEqual(other.post(f'{WORKFLOW}/scenes', json={}).status_code, 200)
        self.assertEqual(self.client.get(f'{WORKFLOW}/scenes/{sid}').status_code, 200)


if __name__ == '__main__':
    unittest.main()
