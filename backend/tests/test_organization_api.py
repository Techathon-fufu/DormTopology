import copy
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.bootstrap import Settings, create_app
from backend.app.domain.packing import plan_packing, validate_layout
from backend.examples.packing_demo import cases, demo_scene


class OrganizationAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.settings = Settings(Path(self.temp.name) / "api.sqlite3")
        self.client = self.enterContext(TestClient(create_app(self.settings)))

    def save(self, scene=None, project="project"):
        scene = demo_scene() if scene is None else scene
        response = self.client.put(
            f"/api/v1/projects/{project}/scene",
            json={
                "scene": scene,
                "baseline": scene,
                "expected_revision": None,
                "baseline_source_id": "original",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def plan(self, saved):
        response = self.client.post(
            "/api/v1/organization/plan",
            json={
                "scene_id": saved["scene_id"],
                "scene_revision": saved["scene_revision"],
            },
        )
        self.assertEqual(response.status_code, 202, response.text)
        job_id = response.json()["job_id"]
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            response = self.client.get(f"/api/v1/jobs/{job_id}")
            self.assertEqual(response.status_code, 200)
            if response.json()["status"] not in ("queued", "running"):
                return response.json()
            time.sleep(0.01)
        self.fail("Organization task did not reach a terminal state")

    def test_health_real_algorithm_apply_version_and_readback(self):
        self.assertEqual(self.client.get("/api/v1/health").json()["status"], "ok")
        saved = self.save()
        job = self.plan(saved)
        self.assertEqual(job["status"], "succeeded", job)
        self.assertEqual(job["result"]["status"], "success")
        body = {"scene_id": saved["scene_id"], "scene_revision": 1}
        applied = self.client.post(f"/api/v1/jobs/{job['job_id']}/apply", json=body)
        self.assertEqual(applied.status_code, 200, applied.text)
        self.assertEqual(applied.json()["scene_revision"], 2)
        self.assertTrue(validate_layout(applied.json())["geometry_valid"])
        self.assertEqual(
            self.client.get(f"/api/v1/scenes/{saved['scene_id']}").json(),
            applied.json(),
        )
        self.assertEqual(
            self.client.get("/api/v1/projects/project/scene").json(), applied.json()
        )
        self.assertEqual(
            self.client.post(
                f"/api/v1/jobs/{job['job_id']}/apply", json=body
            ).status_code,
            409,
        )
        self.assertEqual(
            self.client.post("/api/v1/organization/plan", json=body).status_code, 409
        )

    def test_project_scene_state_tracks_canonical_scene_and_baseline_source(self):
        self.assertEqual(
            self.client.get("/api/v1/projects/missing/scene-state").status_code, 404
        )
        saved = self.save()
        self.assertEqual(
            self.client.get("/api/v1/projects/project/scene-state").json(),
            {"scene": saved, "baseline_source_id": "original"},
        )
        response = self.client.put(
            "/api/v1/projects/project/scene",
            json={
                "scene": saved,
                "baseline": saved,
                "expected_revision": 1,
                "baseline_source_id": "replacement",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        replaced = response.json()
        self.assertEqual(replaced["scene_revision"], 2)
        self.assertNotEqual(replaced["baseline_id"], saved["baseline_id"])
        self.assertEqual(
            self.client.get("/api/v1/projects/project/scene-state").json(),
            {"scene": replaced, "baseline_source_id": "replacement"},
        )
        self.assertEqual(
            self.client.get("/api/v1/projects/project/scene").json(), replaced
        )

    def test_structure_reference_confirmation_and_http_errors(self):
        invalid = demo_scene()
        del invalid["regions"]
        response = self.client.put(
            "/api/v1/projects/project/scene",
            json={
                "scene": invalid,
                "baseline": invalid,
                "expected_revision": None,
                "baseline_source_id": "original",
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "invalid_input")
        invalid = demo_scene()
        invalid["items"][0]["allowed_region_ids"] = ["missing"]
        response = self.client.put(
            "/api/v1/projects/project/scene",
            json={
                "scene": invalid,
                "baseline": invalid,
                "expected_revision": None,
                "baseline_source_id": "original",
            },
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            self.client.post(
                "/api/v1/organization/plan",
                json={"scene_id": "missing", "scene_revision": True},
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/organization/plan",
                json={"scene_id": "missing", "scene_revision": 1},
            ).status_code,
            404,
        )
        self.assertEqual(self.client.get("/api/v1/jobs/missing").status_code, 404)
        for path in ("recognition", "models/generate", "layout/plan"):
            self.assertEqual(
                self.client.post(f"/api/v1/{path}", json={}).status_code, 501
            )

    def test_infeasible_result_is_completed_job_but_cannot_apply(self):
        saved = self.save(cases()["infeasible"])
        job = self.plan(saved)
        self.assertEqual(job["status"], "succeeded")
        self.assertEqual(job["result"]["status"], "infeasible")
        response = self.client.post(
            f"/api/v1/jobs/{job['job_id']}/apply",
            json={
                "scene_id": saved["scene_id"],
                "scene_revision": 1,
            },
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            self.client.get(f"/api/v1/scenes/{saved['scene_id']}").json(), saved
        )

    def test_atomic_concurrent_http_apply(self):
        saved = self.save()
        job = self.plan(saved)
        barrier = Barrier(2)

        def apply():
            barrier.wait(timeout=5)
            return self.client.post(
                f"/api/v1/jobs/{job['job_id']}/apply",
                json={
                    "scene_id": saved["scene_id"],
                    "scene_revision": 1,
                },
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(lambda _: apply(), range(2)))
        self.assertCountEqual(results, [200, 409])

    def test_edit_then_old_apply_rejected_and_noop_does_not_advance(self):
        saved = self.save()
        job = self.plan(saved)
        noop = self.client.put(
            "/api/v1/projects/project/scene",
            json={
                "scene": saved,
                "expected_revision": 1,
                "baseline_source_id": "original",
            },
        )
        self.assertEqual(noop.json()["scene_revision"], 1)
        edited = copy.deepcopy(saved)
        edited["items"][0]["name"] = "updated"
        response = self.client.put(
            "/api/v1/projects/project/scene",
            json={
                "scene": edited,
                "expected_revision": 1,
                "baseline_source_id": "original",
            },
        )
        self.assertEqual(response.json()["scene_revision"], 2)
        self.assertEqual(
            self.client.post(
                f"/api/v1/jobs/{job['job_id']}/apply",
                json={
                    "scene_id": saved["scene_id"],
                    "scene_revision": 1,
                },
            ).status_code,
            409,
        )

    def test_restart_preserves_completed_task_and_scene(self):
        saved = self.save()
        job = self.plan(saved)
        with TestClient(create_app(self.settings)) as restarted:
            self.assertEqual(restarted.get(f"/api/v1/jobs/{job['job_id']}").json(), job)
            response = restarted.post(
                f"/api/v1/jobs/{job['job_id']}/apply",
                json={
                    "scene_id": saved["scene_id"],
                    "scene_revision": 1,
                },
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["scene_revision"], 2)

    def test_running_cancel_capacity_and_health_remain_responsive(self):
        started, release = Event(), Event()

        def slow_real_plan(scene):
            started.set()
            if not release.wait(timeout=10):
                raise TimeoutError("test did not release planner")
            return plan_packing(scene)

        settings = Settings(
            Path(self.temp.name) / "limited.sqlite3", max_workers=1, max_pending=1
        )
        with (
            patch(
                "backend.app.service.organization.plan_packing",
                side_effect=slow_real_plan,
            ),
            TestClient(create_app(settings)) as client,
        ):
            scene = demo_scene()
            saved = client.put(
                "/api/v1/projects/limited/scene",
                json={
                    "scene": scene,
                    "baseline": scene,
                    "expected_revision": None,
                    "baseline_source_id": "original",
                },
            ).json()
            body = {"scene_id": saved["scene_id"], "scene_revision": 1}
            accepted = client.post("/api/v1/organization/plan", json=body)
            job_id = accepted.json()["job_id"]
            try:
                self.assertTrue(started.wait(timeout=5))
                self.assertEqual(client.get("/api/v1/health").status_code, 200)
                self.assertEqual(
                    client.get(f"/api/v1/jobs/{job_id}").json()["status"], "running"
                )
                full = client.post("/api/v1/organization/plan", json=body)
                self.assertEqual(full.status_code, 503)
                self.assertEqual(full.headers["Retry-After"], "1")
                cancelled = client.post(f"/api/v1/jobs/{job_id}/cancel")
                self.assertEqual(cancelled.status_code, 200)
                self.assertEqual(cancelled.json()["status"], "cancelled")
            finally:
                release.set()
        with TestClient(create_app(settings)) as restarted:
            job = restarted.get(f"/api/v1/jobs/{job_id}").json()
            self.assertEqual(job["status"], "cancelled")
            self.assertIsNone(job["result"])


if __name__ == "__main__":
    unittest.main()
