"""Recognition service orchestrating VLM visual perception and item auto-cropping."""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from typing import Any, Callable

from PIL import Image

from ..adapters.vlm_adapter import VLMClient
from .errors import InvalidInput, NotFound
from .ports import JobExecutor, OrganizationRepository

logger = logging.getLogger(__name__)

ALGORITHM_VERSION = "vlm-qwen3-vl-1.0"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def crop_item_from_bbox(
    image_path: str | Path,
    bbox_1000: list[int],
    save_path: str | Path,
    pad: float = 0.06,
) -> tuple[int, int]:
    """Crops item bounding box with padding for 3D model generation."""
    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    xmin, ymin, xmax, ymax = bbox_1000
    bw, bh = xmax - xmin, ymax - ymin
    left = max(0, int((xmin - bw * pad) / 1000.0 * w))
    top = max(0, int((ymin - bh * pad) / 1000.0 * h))
    right = min(w, int((xmax + bw * pad) / 1000.0 * w))
    bottom = min(h, int((ymax + bh * pad) / 1000.0 * h))

    cropped = img.crop((left, top, right, bottom))
    Path(save_path).parent.mkdir(parents=True, exist_ok=True)
    cropped.save(save_path, format="PNG")
    return cropped.size


def _derive_item_ports(name: str, size_m: list[float]) -> list[dict]:
    """Derives default ports for common recognized electrical items."""
    w, h, d = size_m
    half_d = d / 2.0
    name_lower = name.lower()

    if any(k in name_lower for k in ["键盘", "keyboard"]):
        return [{
            "id": "port_keyboard_usb",
            "type": "usb-c",
            "local_position": [0.0, round(h * 0.5, 3), -round(half_d, 3)],
            "local_direction": [0.0, 0.0, -1.0],
            "powered": True,
            "confirmed": False,
        }]

    if any(k in name_lower for k in ["笔记本", "电脑", "laptop"]):
        return [
            {
                "id": "port_laptop_pwr",
                "type": "power-ac",
                "local_position": [-round(w * 0.45, 3), round(h * 0.4, 3), -round(half_d * 0.5, 3)],
                "local_direction": [-1.0, 0.0, 0.0],
                "powered": True,
                "confirmed": False,
            },
            {
                "id": "port_laptop_usbc",
                "type": "usb-c",
                "local_position": [round(w * 0.45, 3), round(h * 0.4, 3), -round(half_d * 0.5, 3)],
                "local_direction": [1.0, 0.0, 0.0],
                "powered": True,
                "confirmed": False,
            },
        ]

    if any(k in name_lower for k in ["显示器", "屏幕", "monitor"]):
        return [
            {
                "id": "port_monitor_pwr",
                "type": "power-ac",
                "local_position": [round(w * 0.15, 3), round(h * 0.2, 3), -round(half_d, 3)],
                "local_direction": [0.0, 0.0, -1.0],
                "powered": True,
                "confirmed": False,
            },
            {
                "id": "port_monitor_hdmi",
                "type": "hdmi",
                "local_position": [-round(w * 0.15, 3), round(h * 0.2, 3), -round(half_d, 3)],
                "local_direction": [0.0, 0.0, -1.0],
                "powered": False,
                "confirmed": False,
            },
        ]

    if any(k in name_lower for k in ["充电器", "快充", "充电头", "适配器"]):
        return [
            {
                "id": "port_charger_in",
                "type": "power-ac",
                "local_position": [0.0, round(h * 0.2, 3), -round(half_d, 3)],
                "local_direction": [0.0, 0.0, -1.0],
                "powered": True,
                "confirmed": False,
            },
            {
                "id": "port_charger_out",
                "type": "usb-c",
                "local_position": [0.0, round(h * 0.5, 3), round(half_d, 3)],
                "local_direction": [0.0, 0.0, 1.0],
                "powered": True,
                "confirmed": False,
            },
        ]

    if any(k in name_lower for k in ["手机", "phone"]):
        return [{
            "id": "port_phone_usbc",
            "type": "usb-c",
            "local_position": [0.0, round(h * 0.5, 3), round(half_d, 3)],
            "local_direction": [0.0, 0.0, 1.0],
            "powered": True,
            "confirmed": False,
        }]

    if any(k in name_lower for k in ["台灯", "灯", "lamp"]):
        return [{
            "id": "port_lamp_pwr",
            "type": "power-ac",
            "local_position": [0.0, round(h * 0.1, 3), -round(half_d, 3)],
            "local_direction": [0.0, 0.0, -1.0],
            "powered": True,
            "confirmed": False,
        }]

    return []


class RecognitionService:
    def __init__(
        self,
        repository: OrganizationRepository,
        executor: JobExecutor,
        data_dir: Path | str | None = None,
    ):
        self.repository = repository
        self.executor = executor
        self.root_dir = Path(__file__).resolve().parents[3]
        self.data_dir = Path(data_dir) if data_dir else (self.root_dir / "backend" / "data")
        self.crops_dir = self.data_dir / "crops"
        self.uploads_dir = self.data_dir / "uploads"
        self.crops_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)

    def submit(
        self,
        project_id: str,
        saved_photo_paths: list[Path],
    ) -> dict:
        if not project_id or not project_id.strip():
            raise InvalidInput("project_id is required", field="project_id")
        if not saved_photo_paths:
            raise InvalidInput("At least one photo is required", field="photos")

        now = _now()
        job_id = f"job_{uuid4().hex}"
        envelope = {
            "job_id": job_id,
            "kind": "recognition",
            "status": "queued",
            "project_id": project_id,
            "created_at": now,
            "updated_at": now,
            "stage": "Queued",
            "progress": 0.0,
            "algorithm_version": ALGORITHM_VERSION,
            "cancellable": True,
            "result": None,
            "error": None,
        }

        self.executor.reserve()
        try:
            self.repository.create_standalone_job(envelope)
            self.executor.submit(
                lambda: self._run_recognition(job_id, project_id, saved_photo_paths)
            )
        except BaseException:
            self.executor.release()
            self.repository.update_standalone_job(
                job_id,
                status="failed",
                error={"code": "submission_failed", "message": "Recognition task could not start"},
            )
            raise

        return {"job_id": job_id, "status": "queued", "created_at": now}

    def _run_recognition(
        self,
        job_id: str,
        project_id: str,
        photo_paths: list[Path],
    ) -> None:
        try:
            self.repository.update_standalone_job(
                job_id,
                status="running",
                stage="正在调用视觉大模型逐区深度分析桌面物品（约需1~2分钟，请稍候）...",
                progress=0.25,
            )

            vlm_client = VLMClient()
            main_photo = photo_paths[0]

            logger.info("Starting VLM perceive for project %s on photo %s", project_id, main_photo)
            perception_result = vlm_client.perceive(main_photo)
            raw_items = perception_result.get("items", [])

            self.repository.update_standalone_job(
                job_id,
                status="running",
                stage="识别完成，正在裁剪单品切片图...",
                progress=0.6,
            )

            project_crop_dir = self.crops_dir / project_id
            project_crop_dir.mkdir(parents=True, exist_ok=True)

            wire_items = []
            for it in raw_items:
                item_id = it.get("id") or f"item_{uuid4().hex[:6]}"
                name = it.get("name", "未命名物品")
                bbox = it.get("bbox_2d", [0, 0, 0, 0])

                # Execute crop if bbox is valid
                crop_path = project_crop_dir / f"{item_id}.png"
                if len(bbox) == 4 and (bbox[2] > bbox[0]) and (bbox[3] > bbox[1]):
                    try:
                        crop_item_from_bbox(main_photo, bbox, crop_path, pad=0.06)
                        logger.info("Successfully cropped item %s to %s", item_id, crop_path)
                    except Exception as ce:
                        logger.warning("Failed to crop item %s: %s", item_id, ce)

                # Size normalization: VLM returns [width, depth, height], wire contract requires [width, height, depth]
                est_size = it.get("estimated_size_m") or [0.15, 0.15, 0.1]
                if len(est_size) == 3:
                    w = float(est_size[0])
                    d = float(est_size[1])
                    h = float(est_size[2])
                    size_m = [round(max(0.01, w), 3), round(max(0.01, h), 3), round(max(0.01, d), 3)]
                else:
                    size_m = [0.15, 0.1, 0.15]

                # Category classification
                cat_raw = it.get("category", "")
                name_lower = name.lower()
                if any(k in name_lower for k in [
                    "键盘", "鼠标", "电脑", "笔记本", "显示器", "充电器", "快充", "手机",
                    "台灯", "数位板", "平板", "音箱", "耳机", "插座"
                ]):
                    category = "electrical"
                    needs_power = True
                elif any(k in name_lower for k in ["盒", "箱", "收纳", "笔筒", "篮"]):
                    category = "storage"
                    needs_power = False
                else:
                    category = "nonElectrical"
                    needs_power = False

                ports = _derive_item_ports(name, size_m)
                # Template names describe roles, not identities. Each detected
                # item needs its own ports even when several share a category.
                ports = [{**port, "id": f"port_{uuid4().hex}"} for port in ports]

                wire_items.append({
                    "temp_id": item_id,
                    "name": name,
                    "category": category,
                    "size_m": size_m,
                    "quantity": 1,
                    "needs_power": needs_power,
                    "fixed": False,
                    "dimensions_source": "estimated",
                    "confidence": 0.92,
                    "ports": ports,
                })

            result = {
                "items": wire_items,
                "low_confidence": 0,
                "note": f"成功识别出 {len(wire_items)} 件物品并完成高清单品切图",
            }

            self.repository.update_standalone_job(
                job_id,
                status="succeeded",
                stage="识别与切图全部完成",
                progress=1.0,
                result=result,
            )
            logger.info("Recognition task %s completed successfully with %d items", job_id, len(wire_items))

        except Exception as e:
            logger.exception("Recognition task %s failed", job_id)
            self.repository.update_standalone_job(
                job_id,
                status="failed",
                stage="Failed",
                error={"code": "recognition_failed", "message": str(e)},
            )
