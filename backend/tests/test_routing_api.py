import copy
import tempfile
import time
import unittest
from pathlib import Path
from threading import Event
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.bootstrap import Settings, create_app
from backend.app.domain.routing import plan_routing
from backend.tests.test_routing import scene_for


class RoutingAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.settings = Settings(Path(self.temp.name) / "api.sqlite3")
        self.client = self.enterContext(TestClient(create_app(self.settings)))

    def save(self, scene=None):
        scene = scene_for() if scene is None else scene
        response = self.client.put(
            "/api/v1/projects/project/scene",
            json={
                "scene": scene,
                "baseline": scene,
                "expected_revision": None,
                "baseline_source_id": "original",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def submit(self, saved, **extra):
        return self.client.post(
            "/api/v1/cables/plan",
            json={
                "scene_id": saved["scene_id"],
                "scene_revision": saved["scene_revision"],
                **extra,
            },
        )

    def wait(self, job_id):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            response = self.client.get(f"/api/v1/jobs/{job_id}")
            self.assertEqual(response.status_code, 200)
            if response.json()["status"] not in ("queued", "running"):
                return response.json()
            time.sleep(0.01)
        self.fail("Routing task did not reach a terminal state")

    def test_submit_real_routing_readback_without_mutating_scene(self):
        self.assertIn(
            "cable", self.client.get("/api/v1/health").json()["capabilities"]
        )
        saved = self.save()
        response = self.submit(saved)
        self.assertEqual(response.status_code, 202, response.text)
        accepted = response.json()
        self.assertEqual(accepted["status"], "queued")
        self.assertIn("created_at", accepted)
        job = self.wait(accepted["job_id"])
        self.assertEqual(job["status"], "succeeded", job)
        self.assertEqual(job["kind"], "cable")
        self.assertEqual(job["result"]["cables"], plan_routing(saved)["cables"])
        self.assertEqual(job["result"]["scene_revision"], 1)
        self.assertEqual(
            self.client.get(f"/api/v1/scenes/{saved['scene_id']}").json(), saved
        )
        applied = self.client.post(
            f"/api/v1/jobs/{accepted['job_id']}/apply",
            json={"scene_id": saved["scene_id"], "scene_revision": 1},
        )
        self.assertEqual(applied.status_code, 409)
        with TestClient(create_app(self.settings)) as restarted:
            self.assertEqual(
                restarted.get(f"/api/v1/jobs/{accepted['job_id']}").json(), job
            )

    def test_unknown_length_is_saved_and_planned_without_fabricating_availability(self):
        scene = scene_for()
        scene["cables"][0]["length_m"] = None
        saved = self.save(scene)
        self.assertIsNone(saved["cables"][0]["length_m"])
        accepted = self.submit(saved)
        self.assertEqual(accepted.status_code, 202, accepted.text)
        job = self.wait(accepted.json()["job_id"])
        self.assertEqual(job["status"], "succeeded", job)
        self.assertEqual(job["result"]["status"], "success")
        self.assertGreater(job["result"]["cables"][0]["path_length_m"], 0)
        self.assertEqual(
            self.client.get(f"/api/v1/scenes/{saved['scene_id']}").json(), saved
        )
        with TestClient(create_app(self.settings)) as restarted:
            self.assertIsNone(
                restarted.get(f"/api/v1/scenes/{saved['scene_id']}").json()["cables"][0]["length_m"]
            )

    def test_short_cable_returns_honest_failure_geometry(self):
        scene = scene_for()
        scene["cables"][0]["length_m"] = 0.01
        accepted = self.submit(self.save(scene))
        self.assertEqual(accepted.status_code, 202)
        job = self.wait(accepted.json()["job_id"])
        self.assertEqual(job["status"], "succeeded")
        self.assertEqual(job["result"]["status"], "infeasible")
        cable = job["result"]["cables"][0]
        self.assertEqual(cable["reason_code"], "length_exceeded")
        self.assertEqual(cable["path_points"], [])
        self.assertIsNone(cable["path_length_m"])

    def test_revision_and_target_validation_are_http_errors(self):
        saved = self.save()
        for extra in (
            {"target_ids": []},
            {"target_ids": ["unknown"]},
            {"target_ids": ["a", "a"]},
        ):
            self.assertEqual(self.submit(saved, **extra).status_code, 422)
        body = {"scene_id": saved["scene_id"], "scene_revision": True}
        self.assertEqual(
            self.client.post("/api/v1/cables/plan", json=body).status_code, 422
        )
        self.assertEqual(
            self.submit({**saved, "scene_revision": 2}).status_code, 409
        )
        self.assertEqual(
            self.submit({**saved, "scene_id": "missing"}).status_code, 404
        )
        self.assertEqual(
            self.client.post("/api/v1/cables/plan", json={}).status_code, 422
        )

    def test_targeted_task_still_checks_full_scene_occupancy(self):
        scene = scene_for()
        second = copy.deepcopy(scene["cables"][0])
        second["id"] = "second_cable"
        scene["cables"].append(second)
        saved = self.save(scene)
        accepted = self.submit(saved, target_ids=[scene["cables"][0]["id"]])
        job = self.wait(accepted.json()["job_id"])
        self.assertEqual(len(job["result"]["cables"]), 2)
        self.assertTrue(
            all(c["reason_code"] == "port_occupied" for c in job["result"]["cables"])
        )

    def test_shared_task_capacity_cancel_and_health(self):
        started, release = Event(), Event()

        def slow_plan(scene):
            started.set()
            if not release.wait(timeout=10):
                raise TimeoutError("test did not release planner")
            return plan_routing(scene)

        settings = Settings(
            Path(self.temp.name) / "limited.sqlite3", max_workers=1, max_pending=1
        )
        with (
            patch("backend.app.service.routing.plan_routing", side_effect=slow_plan),
            TestClient(create_app(settings)) as client,
        ):
            scene = scene_for()
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
            accepted = client.post("/api/v1/cables/plan", json=body)
            self.assertEqual(accepted.status_code, 202)
            job_id = accepted.json()["job_id"]
            try:
                self.assertTrue(started.wait(timeout=5))
                self.assertEqual(client.get("/api/v1/health").status_code, 200)
                self.assertEqual(
                    client.post("/api/v1/organization/plan", json=body).status_code, 503
                )
                cancelled = client.post(f"/api/v1/jobs/{job_id}/cancel")
                self.assertEqual(cancelled.json()["status"], "cancelled")
            finally:
                release.set()
        with TestClient(create_app(settings)) as restarted:
            job = restarted.get(f"/api/v1/jobs/{job_id}").json()
            self.assertEqual(job["status"], "cancelled")
            self.assertIsNone(job["result"])


if __name__ == "__main__":
    unittest.main()
