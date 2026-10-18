"""Tests for recognition and model generation HTTP endpoints and services."""

import io
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from PIL import Image

from backend.app.bootstrap import Settings, create_app


class RecognitionAndModelAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        db_path = Path(self.temp.name) / "test.sqlite3"
        data_dir = Path(self.temp.name) / "data"
        self.settings = Settings(
            database_path=db_path,
            workflow_database_path=Path(self.temp.name) / "workflow.sqlite3",
            workflow_data_dir=data_dir,
        )
        self.client = self.enterContext(TestClient(create_app(self.settings)))
        service = self.client.app.state.model_service
        service.generated_models_dir = Path(self.temp.name) / "generated"
        service.prefab_backup_dir = Path(self.temp.name) / "backup"
        service.generated_models_dir.mkdir()
        service.prefab_backup_dir.mkdir()

    def test_health_capabilities_include_recognition_and_model(self):
        resp = self.client.get("/api/v1/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("recognition", data.get("capabilities", []))
        self.assertIn("model", data.get("capabilities", []))

    @patch("backend.app.service.recognition.VLMClient")
    def test_repeated_devices_receive_distinct_port_ids(self, mock_vlm_cls):
        mock_vlm_cls.return_value.perceive.return_value = {"items": [
            {"id": f"item_{index}", "name": name, "estimated_size_m": [0.3, 0.1, 0.2]}
            for index, name in enumerate(["显示器", "显示器", "键盘", "键盘", "台灯", "台灯"])
        ]}
        image = io.BytesIO()
        Image.new("RGB", (16, 16)).save(image, format="PNG")
        response = self.client.post("/api/v1/recognition", data={"project_id": "repeated-devices"},
                                    files=[("photos", ("devices.png", image.getvalue(), "image/png"))])
        self.assertEqual(response.status_code, 202, response.text)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            job = self.client.get(f"/api/v1/jobs/{response.json()['job_id']}").json()
            if job["status"] in ("succeeded", "failed"):
                break
            time.sleep(0.01)
        self.assertEqual(job["status"], "succeeded", job)
        items = job["result"]["items"]
        self.assertEqual(len(items), 6)
        ports = [port for item in items for port in item["ports"]]
        self.assertEqual(len(ports), 8)
        self.assertEqual(len({port["id"] for port in ports}), len(ports))
        self.assertTrue(all(port["confirmed"] is False for port in ports))

    @patch("backend.app.service.recognition.VLMClient")
    def test_recognition_pipeline_end_to_end(self, mock_vlm_cls):
        # Create a mock VLMClient that returns detected items with bbox
        mock_vlm = MagicMock()
        mock_vlm_cls.return_value = mock_vlm
        mock_vlm.perceive.return_value = {
            "items": [
                {
                    "id": "item_01",
                    "name": "机械键盘",
                    "category": "electrical",
                    "bbox_2d": [100, 200, 500, 600],
                    "pose": "flat",
                    "facing": "user",
                    "estimated_size_m": [0.44, 0.14, 0.04],  # w, d, h
                },
                {
                    "id": "item_02",
                    "name": "手办收纳盒",
                    "category": "storage",
                    "bbox_2d": [600, 100, 800, 400],
                    "pose": "upright",
                    "facing": "user",
                    "estimated_size_m": [0.2, 0.2, 0.25],
                },
            ]
        }

        # Create dummy test image
        img_byte_arr = io.BytesIO()
        Image.new("RGB", (800, 600), color="white").save(img_byte_arr, format="JPEG")
        img_bytes = img_byte_arr.getvalue()

        # Submit recognition job
        files = [("photos", ("test_photo.jpg", img_bytes, "image/jpeg"))]
        data = {"project_id": "proj_test_1"}
        resp = self.client.post("/api/v1/recognition", data=data, files=files)
        self.assertEqual(resp.status_code, 202, resp.text)
        job_data = resp.json()
        job_id = job_data["job_id"]
        self.assertTrue(job_id.startswith("job_"))

        # Poll job status until done
        deadline = time.monotonic() + 5
        final_job = None
        while time.monotonic() < deadline:
            poll_resp = self.client.get(f"/api/v1/jobs/{job_id}")
            self.assertEqual(poll_resp.status_code, 200)
            final_job = poll_resp.json()
            if final_job["status"] in ("succeeded", "failed"):
                break
            time.sleep(0.1)

        self.assertEqual(final_job["status"], "succeeded")
        result = final_job["result"]
        self.assertIn("items", result)
        items = result["items"]
        self.assertEqual(len(items), 2)

        # Check item 1 (keyboard) size conversion [w, h, d]
        kb = next(it for it in items if it["temp_id"] == "item_01")
        self.assertEqual(kb["name"], "机械键盘")
        self.assertEqual(kb["category"], "electrical")
        self.assertEqual(kb["size_m"], [0.44, 0.04, 0.14])  # width, height, depth
        self.assertTrue(kb["needs_power"])
        self.assertTrue(len(kb["ports"]) > 0)

        # Verify crop file was generated
        crop_file = (
            Path(self.settings.workflow_data_dir) / "crops" / "proj_test_1" / "item_01.png"
        )
        self.assertTrue(crop_file.exists(), "Auto crop image should be persisted on disk")

    def test_model_generate_prefab_matching(self):
        # A keyboard should directly match local prefab model
        body = {
            "project_id": "proj_test_1",
            "object": {
                "id": "item_kb",
                "name": "机械键盘",
                "category": "electrical",
                "size_m": [0.44, 0.04, 0.14],
            },
            "attempt": 0,
        }
        resp = self.client.post("/api/v1/models/generate", json=body)
        self.assertEqual(resp.status_code, 202)
        job_id = resp.json()["job_id"]

        # Poll job
        deadline = time.monotonic() + 5
        final_job = None
        while time.monotonic() < deadline:
            poll_resp = self.client.get(f"/api/v1/jobs/{job_id}")
            self.assertEqual(poll_resp.status_code, 200)
            final_job = poll_resp.json()
            if final_job["status"] in ("succeeded", "failed"):
                break
            time.sleep(0.1)

        self.assertEqual(final_job["status"], "succeeded")
        self.assertEqual(final_job["result"]["status"], "ready")
        self.assertEqual(
            final_job["result"]["asset_url"],
            "models/items/keyboard.glb",
        )
        self.assertEqual(final_job["result"]["object_id"], "item_kb")

    @patch("backend.app.service.model_generation.RodinClient")
    def test_model_generate_custom_item_with_rodin(self, mock_rodin_cls):
        # Create a mock crop image for a custom item
        crop_dir = Path(self.settings.workflow_data_dir) / "crops" / "proj_test_1"
        crop_dir.mkdir(parents=True, exist_ok=True)
        crop_file = crop_dir / "custom_obj_01.png"
        Image.new("RGB", (100, 100), color="blue").save(crop_file, format="PNG")

        mock_rodin = MagicMock()
        mock_rodin_cls.return_value = mock_rodin

        # Mock download / generation file creation
        def fake_generate(image_path, output_dir, **kwargs):
            target_fn = kwargs.get("target_filename", "model.glb")
            out_file = Path(output_dir) / target_fn
            out_file.parent.mkdir(parents=True, exist_ok=True)
            out_file.write_bytes(b"dummy glb content")
            return MagicMock()

        mock_rodin.generate_glb_from_image.side_effect = fake_generate

        body = {
            "project_id": "proj_test_1",
            "object": {
                "id": "custom_obj_01",
                "name": "特殊造型香薰机",
                "category": "nonElectrical",
                "size_m": [0.1, 0.15, 0.1],
            },
            "attempt": 0,
        }
        resp = self.client.post("/api/v1/models/generate", json=body)
        self.assertEqual(resp.status_code, 202)
        job_id = resp.json()["job_id"]

        # Poll job
        deadline = time.monotonic() + 5
        final_job = None
        while time.monotonic() < deadline:
            poll_resp = self.client.get(f"/api/v1/jobs/{job_id}")
            self.assertEqual(poll_resp.status_code, 200)
            final_job = poll_resp.json()
            if final_job["status"] in ("succeeded", "failed"):
                break
            time.sleep(0.1)

        self.assertEqual(final_job["status"], "succeeded")
        self.assertEqual(final_job["result"]["status"], "ready")
        self.assertEqual(
            final_job["result"]["asset_url"],
            f"models/generated/proj_test_1_{job_id}.glb",
        )
        self.assertEqual(final_job["result"]["object_id"], "custom_obj_01")
        mock_rodin.generate_glb_from_image.assert_called_once()

    def test_cancel_standalone_job(self):
        # Create a job by submitting model generation
        body = {
            "project_id": "proj_test_1",
            "object": {
                "id": "item_mouse",
                "name": "无线鼠标",
                "category": "electrical",
                "size_m": [0.06, 0.04, 0.1],
            },
        }
        resp = self.client.post("/api/v1/models/generate", json=body)
        job_id = resp.json()["job_id"]

        # Cancel job
        cancel_resp = self.client.post(f"/api/v1/jobs/{job_id}/cancel")
        self.assertEqual(cancel_resp.status_code, 200)
        self.assertIn(cancel_resp.json()["status"], ("cancelled", "succeeded"))

        # Exercise the cancellation race deterministically, independent of prefab speed.
        repo = self.client.app.state.model_service.repository
        pending = {**repo.get_job(job_id), "job_id": "job_cancel_race", "status": "queued", "result": None, "error": None}
        repo.create_standalone_job(pending)
        cancelled = repo.update_standalone_job("job_cancel_race", status="cancelled", stage="Cancelled")
        for update in ({"status": "running", "progress": .5},
                       {"status": "succeeded", "result": {"asset_url": "leak.glb"}},
                       {"status": "failed", "error": {"code": "boom"}}):
            self.assertEqual(repo.update_standalone_job("job_cancel_race", **update), cancelled)
        self.assertEqual(repo.get_job("job_cancel_race"), cancelled)
