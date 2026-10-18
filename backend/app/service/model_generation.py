"""Model generation service integrating local prefab matching and Rodin AI fast Image-to-3D."""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from typing import Any

from ..adapters.rodin_adapter import RodinClient
from ..adapters.vlm_adapter import VLMClient
from .errors import InvalidInput, NotFound
from .ports import JobExecutor, OrganizationRepository

logger = logging.getLogger(__name__)

ALGORITHM_VERSION = "rodin-fast-1.0"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# Map standard prefab keys to files in frontend/public/models/items
PREFAB_FILE_MAP = {
    "mouse_pad": "mousepad",
    "mousepad": "mousepad",
    "mouse": "mouse",
    "keyboard": "keyboard",
    "tissue_box": "tissue_box",
    "cup": "cup",
    "stainless bottle": "stainless_bottle",
    "stainless_bottle": "stainless_bottle",
    "phone": "phone",
    "charger": "charger",
    "monitor": "monitor",
    "laptop_fold": "laptop_fold",
    "laptop_expand": "laptop_extend",
    "laptop_extend": "laptop_extend",
    "books_stack": "books_stack",
}


def _match_prefab_id(name: str) -> str | None:
    """Matches an object name against local pre-fabricated 3D models."""
    name_lower = name.lower()
    matched_key = VLMClient.match_prefab_model(name)
    if matched_key and matched_key in PREFAB_FILE_MAP:
        return PREFAB_FILE_MAP[matched_key]

    for key, target in PREFAB_FILE_MAP.items():
        if key in name_lower or target in name_lower:
            return target

    return None


class ModelGenerationService:
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
        self.frontend_models_dir = self.root_dir / "frontend" / "public" / "models"
        self.generated_models_dir = self.frontend_models_dir / "generated"
        self.prefab_backup_dir = self.root_dir / "Prefabmodel"

        self.crops_dir.mkdir(parents=True, exist_ok=True)
        self.generated_models_dir.mkdir(parents=True, exist_ok=True)
        self.prefab_backup_dir.mkdir(parents=True, exist_ok=True)

    def submit(
        self,
        project_id: str,
        wire_object: dict,
        attempt: int = 0,
        photo_id: str | None = None,
    ) -> dict:
        if not project_id or not project_id.strip():
            raise InvalidInput("project_id is required", field="project_id")
        if not wire_object or not isinstance(wire_object, dict):
            raise InvalidInput("object payload is required", field="object")
        object_id = wire_object.get("id")
        if not object_id:
            raise InvalidInput("object.id is required", field="object.id")

        now = _now()
        job_id = f"job_{uuid4().hex}"
        envelope = {
            "job_id": job_id,
            "kind": "model",
            "status": "queued",
            "project_id": project_id,
            "object_id": object_id,
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
                lambda: self._run_generate(job_id, project_id, wire_object, attempt)
            )
        except BaseException:
            self.executor.release()
            self.repository.update_standalone_job(
                job_id,
                status="failed",
                error={"code": "submission_failed", "message": "Model generation task could not start"},
            )
            raise

        return {"job_id": job_id, "status": "queued", "created_at": now}

    def _find_crop_image(self, project_id: str, object_id: str, object_name: str) -> Path | None:
        """Finds cropped image for an object by id or fuzzy name match."""
        proj_crops = self.crops_dir / project_id
        if not proj_crops.exists():
            return None

        # 1. Exact ID match
        exact_file = proj_crops / f"{object_id}.png"
        if exact_file.exists():
            return exact_file

        # 2. File starting with object_id
        for f in proj_crops.glob(f"{object_id}*"):
            if f.is_file() and f.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]:
                return f

        # 3. File containing object_name
        for f in proj_crops.glob(f"*{object_name}*"):
            if f.is_file() and f.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]:
                return f

        # 4. Fallback: check other project crops or any crop in directory
        for f in proj_crops.iterdir():
            if f.is_file() and f.suffix.lower() in [".png", ".jpg", ".jpeg", ".webp"]:
                return f

        return None

    def _run_generate(
        self,
        job_id: str,
        project_id: str,
        wire_object: dict,
        attempt: int,
    ) -> None:
        try:
            object_id = wire_object["id"]
            name = wire_object.get("name", "未命名物品")

            self.repository.update_standalone_job(
                job_id,
                status="running",
                stage=f"正在分析模型匹配：{name}",
                progress=0.1,
            )

            # -------------------------------------------------------------
            # 策略 1：优先匹配本地 Prefab 预制件（秒级直通）
            # -------------------------------------------------------------
            prefab_key = _match_prefab_id(name)
            if prefab_key:
                prefab_rel_url = f"models/items/{prefab_key}.glb"
                prefab_disk_path = self.frontend_models_dir / "items" / f"{prefab_key}.glb"
                if prefab_disk_path.exists():
                    logger.info("Object %s (%s) matched local prefab %s", object_id, name, prefab_key)
                    result = {
                        "object_id": object_id,
                        "status": "ready",
                        "asset_url": prefab_rel_url,
                        "format": "glb",
                        "note": f"已匹配本地预制模型：{prefab_key}",
                    }
                    self.repository.update_standalone_job(
                        job_id,
                        status="succeeded",
                        stage="已匹配本地高质量预制模型",
                        progress=1.0,
                        result=result,
                    )
                    return

            # -------------------------------------------------------------
            # 策略 2：非预制件未知物品 -> 调用 Rodin AI 极速 3D 生成
            # -------------------------------------------------------------
            self.repository.update_standalone_job(
                job_id,
                status="running",
                stage=f"非预制件未知物品，正在寻找切片图提交 Rodin 生成 3D 资产...",
                progress=0.3,
            )

            crop_file = self._find_crop_image(project_id, object_id, name)
            if not crop_file or not crop_file.exists():
                raise FileNotFoundError(
                    f"未找到该物品 ({name}) 的单品高清切片图，无法提交 3D 建模；建议使用占位模型。"
                )

            logger.info("Found crop file for object %s: %s", object_id, crop_file)
            self.repository.update_standalone_job(
                job_id,
                status="running",
                stage=f"已定位单品切片图，正在提交 Rodin AI 极速生成 (Low-Poly Base Geometry)...",
                progress=0.4,
            )

            rodin_client = RodinClient()
            target_filename = f"{object_id}.glb"
            prompt = f"A clean low poly 3D object of {name}, single isolated game asset"

            def _on_prog(msg: str):
                self.repository.update_standalone_job(
                    job_id,
                    status="running",
                    stage=f"Rodin 建模中: {msg}",
                    progress=0.7,
                )

            task_result = rodin_client.generate_glb_from_image(
                image_path=crop_file,
                output_dir=self.generated_models_dir,
                prompt=prompt,
                fast_mode=True,
                tier="Gen-2.5-Low",
                quality_override=1500,
                target_filename=target_filename,
                on_progress=_on_prog,
            )

            target_glb = self.generated_models_dir / target_filename
            if not target_glb.exists():
                raise RuntimeError(f"Rodin 资产生成未在预期目录生成 {target_filename}")

            # Backup generated model to Prefabmodel/
            try:
                shutil.copy2(target_glb, self.prefab_backup_dir / target_filename)
            except Exception as e:
                logger.warning("Failed to backup generated model to Prefabmodel: %s", e)

            asset_url = f"models/generated/{target_filename}"
            result = {
                "object_id": object_id,
                "status": "ready",
                "asset_url": asset_url,
                "format": "glb",
                "note": "由 Rodin AI 极速生成 (GLB Low-Poly)",
            }

            self.repository.update_standalone_job(
                job_id,
                status="succeeded",
                stage="3D 资产生成成功",
                progress=1.0,
                result=result,
            )
            logger.info("Successfully generated 3D asset for %s (%s) at %s", object_id, name, asset_url)

        except Exception as e:
            logger.exception("Model generation task %s for object %s failed", job_id, wire_object.get("id"))
            self.repository.update_standalone_job(
                job_id,
                status="failed",
                stage="Failed",
                error={"code": "generation_failed", "message": str(e)},
            )
