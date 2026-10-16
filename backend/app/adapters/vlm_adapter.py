"""
VLM Perception Adapter
Integrates Vision-Language Models (e.g. Qwen/Qwen3-VL-32B-Thinking via SiliconFlow)
to perform 2D visual grounding and 3D coordinate mapping on desktop clutter photos.
"""

import os
import json
import base64
from pathlib import Path
from typing import Dict, Any, List, Optional
from PIL import Image
import requests


class VLMClient:
    """Client for VLM 2D grounding and object perception."""

    DEFAULT_DESK_BOUNDS = {
        "x_min": 0.410,
        "x_max": 1.450,
        "y_min": 0.085,
        "y_max": 0.585,
        "z_desk": 0.770,
    }

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.siliconflow.cn/v1",
        model: str = "Qwen/Qwen3-VL-32B-Thinking",
        timeout: int = 300,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.api_key = self._resolve_api_key(api_key)

    def _resolve_api_key(self, api_key: Optional[str]) -> str:
        if api_key and api_key.strip():
            return api_key.strip()
        env_key = os.environ.get("SILICONFLOW_API_KEY", "").strip()
        if env_key:
            return env_key
        candidate_paths = [
            Path("vlm/key.txt"),
            Path("key.txt"),
            Path("tests/key.txt"),
            Path(".env"),
            Path(__file__).resolve().parents[3] / "vlm" / "key.txt",
            Path(__file__).resolve().parents[3] / "key.txt",
            Path(__file__).resolve().parents[3] / "tests" / "key.txt",
            Path(__file__).resolve().parents[3] / ".env",
        ]
        for p in candidate_paths:
            if p.exists():
                c = p.read_text(encoding="utf-8").strip()
                if c:
                    return c
        raise ValueError("SiliconFlow API key not found. Please provide api_key or set in 'vlm/key.txt'.")

    @staticmethod
    def encode_image_base64(image_path: str | Path) -> str:
        with open(image_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")

    @classmethod
    def bbox_to_desk_coords(
        cls,
        bbox_1000: List[int],
        desk_bounds: Optional[Dict[str, float]] = None,
    ) -> List[float]:
        """Maps normalized 2D bbox [ymin, xmin, ymax, xmax] or [xmin, ymin, xmax, ymax] to desk 3D [x, y, z]."""
        bounds = desk_bounds or cls.DEFAULT_DESK_BOUNDS
        xmin, ymin, xmax, ymax = bbox_1000
        cx = (xmin + xmax) / 2.0 / 1000.0
        cy = (ymin + ymax) / 2.0 / 1000.0

        x_desk = bounds["x_min"] + cx * (bounds["x_max"] - bounds["x_min"])
        y_desk = bounds["y_min"] + (1.0 - cy) * (bounds["y_max"] - bounds["y_min"])
        z_desk = bounds["z_desk"]
        return [round(x_desk, 3), round(y_desk, 3), round(z_desk, 3)]

    @staticmethod
    def crop_item(
        image_path: str | Path,
        bbox_1000: List[int],
        save_path: str | Path,
        pad: float = 0.06,
    ) -> Path:
        """Crops item sub-image with padding for 3D asset generation."""
        img = Image.open(image_path)
        w, h = img.size
        xmin, ymin, xmax, ymax = bbox_1000
        bw, bh = xmax - xmin, ymax - ymin
        left = max(0, int((xmin - bw * pad) / 1000.0 * w))
        top = max(0, int((ymin - bh * pad) / 1000.0 * h))
        right = min(w, int((xmax + bw * pad) / 1000.0 * w))
        bottom = min(h, int((ymax + bh * pad) / 1000.0 * h))

        save_p = Path(save_path)
        save_p.parent.mkdir(parents=True, exist_ok=True)
        img.crop((left, top, right, bottom)).save(save_p)
        return save_p
