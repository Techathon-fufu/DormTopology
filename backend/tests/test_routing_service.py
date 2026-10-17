import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.sqlite import SQLiteOrganizationRepository
from backend.app.domain.errors import SceneInputError
from backend.app.domain.routing import plan_routing
from backend.app.service.errors import Conflict, InvalidInput, NotFound
from backend.app.service.organization import OrganizationService
from backend.app.service.routing import RoutingService
from backend.tests.test_organization_service import HoldingExecutor, ImmediateExecutor
from backend.tests.test_routing import scene_for


class RoutingServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "routing.sqlite3"
        self.repository = SQLiteOrganizationRepository(self.path)
        self.addCleanup(self.repository.close)
        self.organization = OrganizationService(self.repository, ImmediateExecutor())
        self.service = RoutingService(self.repository, ImmediateExecutor())

    def save(self, scene=None):
        scene = scene_for() if scene is None else scene
        return self.organization.save_scene("project", scene, None, "original", scene)

    def plan(self, scene, target_ids=None):
        accepted = self.service.submit(
            scene["scene_id"], scene["scene_revision"], target_ids
        )
        return self.organization.get_job(accepted["job_id"])

    def test_real_routing_snapshot_result_and_revision_are_preserved(self):
        saved = self.save()
        original = copy.deepcopy(saved)
        job = self.plan(saved)
        self.assertEqual(job["kind"], "cable")
        self.assertEqual(job["status"], "succeeded", job)
        self.assertEqual(job["result"]["status"], "success")
        self.assertEqual(job["result"]["cables"], plan_routing(saved)["cables"])
        self.assertEqual(job["result"]["scene_id"], saved["scene_id"])
        self.assertEqual(job["result"]["scene_revision"], 1)
        self.assertEqual(self.organization.get_scene(saved["scene_id"]), original)
        self.assertEqual(self.repository.get_baseline(saved["baseline_id"]), original)
        self.assertFalse(job["applied"])
        with self.assertRaises(Conflict):
            self.organization.apply_job(job["job_id"], saved["scene_id"], 1)

    def test_short_cable_is_a_completed_infeasible_plan_with_no_valid_path(self):
        scene = scene_for()
        scene["cables"][0]["length_m"] = 0.01
        saved = self.save(scene)
        job = self.plan(saved)
        self.assertEqual(job["status"], "succeeded", job)
        self.assertEqual(job["result"]["status"], "infeasible")
        cable = job["result"]["cables"][0]
        self.assertEqual(cable["status"], "failed")
        self.assertEqual(cable["reason_code"], "length_exceeded")
        self.assertEqual(cable["path_points"], [])
        self.assertEqual(cable["curve_segments"], [])
        self.assertIsNone(cable["path_length_m"])

    def test_targeted_request_keeps_all_connections_for_capacity_validation(self):
        scene = scene_for()
        second = copy.deepcopy(scene["cables"][0])
        second["id"] = "second_cable"
        scene["cables"].append(second)
        saved = self.save(scene)
        target_ids = [scene["cables"][0]["id"]]
        job = self.plan(saved, target_ids)
        self.assertEqual(job["target_ids"], target_ids)
        self.assertEqual(len(job["result"]["cables"]), 2)
        self.assertTrue(
            all(
                cable["reason_code"] == "port_occupied"
                for cable in job["result"]["cables"]
            )
        )

    def test_invalid_revision_targets_missing_scene_and_unconfirmed_ports_rejected(self):
        saved = self.save()
        for revision in (True, 0, -1, 1.1):
            with self.subTest(revision=revision), self.assertRaises(InvalidInput):
                self.service.submit(saved["scene_id"], revision)
        with self.assertRaises(Conflict):
            self.service.submit(saved["scene_id"], 2)
        with self.assertRaises(NotFound):
            self.service.submit("missing", 1)
        cable_id = saved["cables"][0]["id"]
        for targets in ([], [cable_id, cable_id], ["missing"], [1], "cable"):
            with self.subTest(targets=targets), self.assertRaises(InvalidInput):
                self.service.submit(saved["scene_id"], 1, targets)
        edited = copy.deepcopy(saved)
        edited["items"][0]["ports"][0]["confirmed"] = False
        updated = self.organization.save_scene("project", edited, 1, "original")
        with self.assertRaises(SceneInputError):
            self.service.submit(updated["scene_id"], 2)

    def test_scene_edit_invalidates_queued_task_and_prevents_publication(self):
        saved = self.save()
        holding = HoldingExecutor()
        service = RoutingService(self.repository, holding)
        accepted = service.submit(saved["scene_id"], 1)
        edited = copy.deepcopy(saved)
        edited["items"][0]["name"] = "edited"
        self.organization.save_scene("project", edited, 1, "original")
        holding.run()
        job = self.organization.get_job(accepted["job_id"])
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error"]["code"], "stale_scene")
        self.assertIsNone(job["result"])

    def test_edit_while_running_prevents_a_late_result(self):
        saved = self.save()

        def editing_plan(scene):
            updated = copy.deepcopy(scene)
            updated["items"][0]["position"][0] += 0.1
            self.organization.save_scene("project", updated, 1, "original")
            return plan_routing(scene)

        with patch(
            "backend.app.service.routing.plan_routing", side_effect=editing_plan
        ):
            job = self.plan(saved)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error"]["code"], "stale_scene")
        self.assertIsNone(job["result"])

    def test_cancellation_prevents_routing_publication(self):
        saved = self.save()
        holding = HoldingExecutor()
        service = RoutingService(self.repository, holding)
        accepted = service.submit(saved["scene_id"], 1)
        self.organization.cancel_job(accepted["job_id"])
        holding.run()
        job = self.organization.get_job(accepted["job_id"])
        self.assertEqual(job["status"], "cancelled")
        self.assertIsNone(job["result"])

    def test_completed_result_persists_and_interrupted_routing_is_failed(self):
        saved = self.save()
        completed = self.plan(saved)
        service = RoutingService(self.repository, HoldingExecutor())
        accepted = service.submit(saved["scene_id"], 1)
        reopened = SQLiteOrganizationRepository(self.path)
        self.addCleanup(reopened.close)
        reopened.recover_incomplete_jobs()
        self.assertEqual(reopened.get_job(completed["job_id"]), completed)
        interrupted = reopened.get_job(accepted["job_id"])
        self.assertEqual(interrupted["status"], "failed")
        self.assertEqual(interrupted["error"]["code"], "interrupted")
        self.assertIsNone(interrupted["result"])


if __name__ == "__main__":
    unittest.main()
