import copy
import tempfile
import unittest
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

from backend.app.db.sqlite import SQLiteOrganizationRepository
from backend.app.domain.errors import SceneInputError
from backend.app.domain.packing import measure_free_area, plan_packing, validate_layout
from backend.app.service.errors import CapacityExceeded, Conflict, InvalidInput
from backend.app.service.executor import LimitedExecutor
from backend.app.service.organization import OrganizationService
from backend.examples.packing_demo import cases, demo_scene, item, region
from backend.tests.test_packing import compound_box


def scene_fixture():
    scene = demo_scene()
    scene.update(
        items=[
            item("left", "book", (0.2, 0.1, 0.15), (0.4, 0.77, 0.3), ["desktop"]),
            item("right", "book", (0.2, 0.1, 0.15), (0.4, 0.77, 0.3), ["desktop"]),
            item(
                "fixed",
                "book",
                (0.1, 0.1, 0.1),
                (0.85, 0.77, 0.5),
                ["desktop"],
                fixed=True,
            ),
        ],
        regions=[region("desktop", (0, 1, 0, 0.6))],
        obstacles=[],
        reserved_zones=[],
        exposure_zones=[],
        cables=[],
        routing_graph={"nodes": [], "edges": []},
    )
    scene["desk"]["width_m"] = 1.0
    return scene


class ImmediateExecutor:
    def reserve(self):
        pass

    def release(self):
        pass

    def submit(self, function):
        future = Future()
        try:
            function()
            future.set_result(None)
        except BaseException as error:
            future.set_exception(error)
            raise
        return future


class HoldingExecutor(ImmediateExecutor):
    def __init__(self):
        self.pending = []

    def submit(self, function):
        self.pending.append(function)
        return Future()

    def run(self):
        while self.pending:
            self.pending.pop(0)()


class OrganizationServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "organization.sqlite3"
        self.repository = SQLiteOrganizationRepository(self.path)
        self.addCleanup(self.repository.close)
        self.service = OrganizationService(self.repository, ImmediateExecutor())

    def save(self, scene=None, project="project"):
        scene = scene_fixture() if scene is None else scene
        return self.service.save_scene(project, scene, None, "original", scene)

    def plan(self, scene):
        accepted = self.service.submit(scene["scene_id"], scene["scene_revision"])
        job = self.service.get_job(accepted["job_id"])
        self.assertEqual(job["status"], "succeeded", job)
        return job

    def test_initial_save_owns_identity_and_allows_overlapping_input(self):
        scene = scene_fixture()
        scene.update(scene_id=None, scene_revision=-100, baseline_id="client-only")
        saved = self.save(scene)
        self.assertTrue(saved["scene_id"].startswith("scene_"))
        self.assertTrue(saved["baseline_id"].startswith("baseline_"))
        self.assertEqual(saved["scene_revision"], 1)
        self.assertFalse(validate_layout(saved)["geometry_valid"])
        self.assertEqual(self.service.get_project_scene("project"), saved)
        self.assertEqual(scene["scene_id"], None)

    def test_baseline_required_confirmed_and_not_replaced_for_same_source(self):
        with self.assertRaises(InvalidInput):
            self.service.save_scene("project", scene_fixture(), None, "original")
        unconfirmed = scene_fixture()
        unconfirmed["items"][0]["dimensions_confirmed"] = False
        with self.assertRaises(InvalidInput):
            self.save(unconfirmed)
        saved = self.save()
        baseline = self.repository.get_baseline(saved["baseline_id"])
        edited = copy.deepcopy(saved)
        edited["items"][0]["name"] = "edited"
        updated = self.service.save_scene("project", edited, 1, "original", edited)
        self.assertEqual(updated["scene_revision"], 2)
        self.assertEqual(updated["baseline_id"], saved["baseline_id"])
        self.assertEqual(self.repository.get_baseline(saved["baseline_id"]), baseline)
        reset = self.service.save_scene("project", updated, 2, "new-original", updated)
        self.assertEqual(reset["scene_revision"], 3)
        self.assertNotEqual(reset["baseline_id"], saved["baseline_id"])
        self.assertEqual(self.repository.get_baseline(saved["baseline_id"]), baseline)

    def test_noop_keeps_revision_and_stale_save_cannot_overwrite(self):
        saved = self.save()
        same = {
            **saved,
            "scene_id": "client",
            "scene_revision": 999,
            "baseline_id": "client",
        }
        self.assertEqual(self.service.save_scene("project", same, 1, "original"), saved)
        edited = copy.deepcopy(saved)
        edited["items"][0]["name"] = "new name"
        updated = self.service.save_scene("project", edited, 1, "original")
        for expected in (None, 1):
            with self.assertRaises(Conflict):
                self.service.save_scene("project", saved, expected, "original")
        self.assertEqual(self.service.get_scene(saved["scene_id"]), updated)

    def test_real_algorithm_metrics_and_apply_preserve_fixed_geometry_and_baseline(
        self,
    ):
        saved = self.save()
        original = copy.deepcopy(saved)
        job = self.plan(saved)
        result = job["result"]
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["scene_id"], saved["scene_id"])
        self.assertEqual(result["scene_revision"], 1)
        self.assertEqual(result["items"], plan_packing(saved)["items"])
        self.assertEqual(
            result["metrics"]["desk_free_before"], measure_free_area(saved)
        )
        applied = self.service.apply_job(job["job_id"], saved["scene_id"], 1)
        self.assertTrue(validate_layout(applied)["geometry_valid"])
        self.assertEqual(applied["scene_revision"], 2)
        self.assertEqual(applied["items"][2], saved["items"][2])
        self.assertEqual(
            result["metrics"]["desk_free_after"], measure_free_area(applied)
        )
        self.assertEqual(self.repository.get_baseline(saved["baseline_id"]), original)
        self.assertTrue(self.service.get_job(job["job_id"])["applied"])
        with self.assertRaises(Conflict):
            self.service.apply_job(job["job_id"], saved["scene_id"], 1)

    def test_partial_preserves_unplaced_item_and_infeasible_cannot_apply(self):
        partial = self.save(cases()["partial"], "partial")
        job = self.plan(partial)
        self.assertEqual(job["result"]["status"], "partial")
        unplaced = next(
            p for p in job["result"]["items"] if p["placement_status"] == "unplaced"
        )
        applied = self.service.apply_job(job["job_id"], partial["scene_id"], 1)
        self.assertEqual(
            next(i for i in partial["items"] if i["id"] == unplaced["item_id"]),
            next(i for i in applied["items"] if i["id"] == unplaced["item_id"]),
        )
        impossible = self.save(cases()["infeasible"], "infeasible")
        job = self.plan(impossible)
        self.assertEqual(job["result"]["status"], "infeasible")
        self.assertTrue(job["result"]["issues"])
        with self.assertRaises(Conflict):
            self.service.apply_job(job["job_id"], impossible["scene_id"], 1)
        self.assertEqual(self.service.get_scene(impossible["scene_id"]), impossible)

    def test_changed_dimensions_make_baseline_area_unknown(self):
        saved = self.save()
        edited = copy.deepcopy(saved)
        edited["items"][0]["size_m"][0] = 0.21
        updated = self.service.save_scene("project", edited, 1, "original")
        job = self.plan(updated)
        self.assertIsNone(job["result"]["metrics"]["desk_free_before"])
        self.assertGreater(job["result"]["metrics"]["desk_free_after"], 0)

    def test_same_dimensions_with_new_collision_make_baseline_area_unknown(self):
        saved = self.save()
        edited = copy.deepcopy(saved)
        edited["items"][0]["collision"] = compound_box(0.12, 0.1, 0.15)
        updated = self.service.save_scene("project", edited, 1, "original")
        self.assertEqual(updated["items"][0]["size_m"], saved["items"][0]["size_m"])
        job = self.plan(updated)
        self.assertIsNone(job["result"]["metrics"]["desk_free_before"])
        self.assertGreater(job["result"]["metrics"]["desk_free_after"], 0)
        self.assertIn("collision geometry", job["result"]["comparison_note"])

    def test_unconfirmed_current_scene_is_saved_but_cannot_plan(self):
        saved = self.save()
        saved["items"][0]["dimensions_confirmed"] = False
        updated = self.service.save_scene("project", saved, 1, "original")
        with self.assertRaises(SceneInputError):
            self.service.submit(updated["scene_id"], 2)

    def test_edit_invalidates_pending_jobs_and_stale_completed_results(self):
        saved = self.save()
        completed = self.plan(saved)
        holding = HoldingExecutor()
        service = OrganizationService(self.repository, holding)
        pending = service.submit(saved["scene_id"], 1)
        saved["items"][0]["name"] = "changed"
        updated = service.save_scene("project", saved, 1, "original")
        holding.run()
        stale = service.get_job(pending["job_id"])
        self.assertEqual(stale["status"], "failed")
        self.assertEqual(stale["error"]["code"], "stale_scene")
        for revision in (1, 2):
            with self.assertRaises(Conflict):
                service.apply_job(completed["job_id"], updated["scene_id"], revision)

    def test_cancelled_task_cannot_publish_a_result(self):
        saved = self.save()
        holding = HoldingExecutor()
        service = OrganizationService(self.repository, holding)
        accepted = service.submit(saved["scene_id"], 1)
        service.cancel_job(accepted["job_id"])
        holding.run()
        job = service.get_job(accepted["job_id"])
        self.assertEqual(job["status"], "cancelled")
        self.assertIsNone(job["result"])

    def test_reopen_preserves_scenes_baselines_results_and_marks_interrupted_jobs(self):
        saved = self.save()
        completed = self.plan(saved)
        service = OrganizationService(self.repository, HoldingExecutor())
        pending = service.submit(saved["scene_id"], 1)
        reopened = SQLiteOrganizationRepository(self.path)
        self.addCleanup(reopened.close)
        reopened.recover_incomplete_jobs()
        restored = OrganizationService(reopened, ImmediateExecutor())
        self.assertEqual(restored.get_scene(saved["scene_id"]), saved)
        self.assertEqual(reopened.get_baseline(saved["baseline_id"]), saved)
        self.assertEqual(restored.get_job(completed["job_id"]), completed)
        self.assertEqual(
            restored.get_job(pending["job_id"])["error"]["code"], "interrupted"
        )
        applied = restored.apply_job(completed["job_id"], saved["scene_id"], 1)
        self.assertEqual(applied["scene_revision"], 2)

    def test_two_writers_cannot_both_save_or_apply_the_same_revision(self):
        saved = self.save()
        other_repository = SQLiteOrganizationRepository(self.path)
        self.addCleanup(other_repository.close)
        other = OrganizationService(other_repository, ImmediateExecutor())
        job = self.plan(saved)
        barrier = Barrier(2)

        def race(service):
            barrier.wait(timeout=5)
            try:
                return service.apply_job(job["job_id"], saved["scene_id"], 1)[
                    "scene_revision"
                ]
            except Conflict:
                return "conflict"

        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(race, [self.service, other]))
        self.assertCountEqual(results, [2, "conflict"])
        barrier = Barrier(2)

        def save_race(service):
            scene = service.get_scene(saved["scene_id"])
            scene["items"][0]["name"] += " changed"
            barrier.wait(timeout=5)
            try:
                return service.save_scene("project", scene, 2, "original")[
                    "scene_revision"
                ]
            except Conflict:
                return "conflict"

        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(save_race, [self.service, other]))
        self.assertCountEqual(results, [3, "conflict"])

    def test_apply_rejects_incomplete_duplicate_fixed_unplaced_and_colliding_targets(
        self,
    ):
        saved = self.save()
        legitimate = self.plan(saved)
        pristine = legitimate["result"]

        def missing(result):
            result["items"].pop()

        def duplicate(result):
            result["items"][1] = copy.deepcopy(result["items"][0])

        def fixed_move(result):
            fixed = next(i for i in result["items"] if i["item_id"] == "fixed")
            fixed["target_pos"][1] += 0.1

        def unplaced_move(result):
            result["status"] = "partial"
            result["items"][0]["placement_status"] = "unplaced"
            result["items"][0]["target_pos"][0] += 0.1

        def collide(result):
            for placement in result["items"][:2]:
                placement["placement_status"] = "placed"
                placement["target_pos"] = [0.4, 0.77, 0.3]

        for mutate in (missing, duplicate, fixed_move, unplaced_move, collide):
            with self.subTest(case=mutate.__name__):
                result = copy.deepcopy(pristine)
                mutate(result)
                envelope = {
                    **legitimate,
                    "job_id": mutate.__name__,
                    "status": "queued",
                    "result": None,
                }
                self.repository.create_job(envelope, saved)
                self.repository.finish_job(envelope["job_id"], result=result)
                with self.assertRaises((InvalidInput, Conflict)):
                    self.service.apply_job(envelope["job_id"], saved["scene_id"], 1)
                self.assertEqual(self.service.get_scene(saved["scene_id"]), saved)


class LimitedExecutorTests(unittest.TestCase):
    def test_capacity_reservation_and_release(self):
        executor = LimitedExecutor(max_workers=1, max_pending=1)
        self.addCleanup(executor.close)
        executor.reserve()
        with self.assertRaises(CapacityExceeded):
            executor.reserve()
        executor.submit(lambda: None).result(timeout=2)
        executor.reserve()
        executor.release()


if __name__ == "__main__":
    unittest.main()
