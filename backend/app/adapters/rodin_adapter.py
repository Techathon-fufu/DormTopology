"""
Rodin 3D Generation API Client & Adapter
Implements DeemosTech Hyper3D Rodin API v2 specification.

Key endpoints supported:
- POST /api/v2/rodin_agentic: Image-to-3D with AI agentic optimization (GLB output)
- POST /api/v2/rodin: Rodin Gen-2.5 Image-to-3D
- POST /api/v2/status: Poll job status by subscription_key
- POST /api/v2/download: Retrieve downloadable asset URLs by task_uuid
- GET  /api/v2/check_balance: Check remaining account credits
"""

import logging
import os
import threading
import time
import mimetypes
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Callable, Optional, Dict, Any, List
import requests

logger = logging.getLogger(__name__)


@dataclass
class RodinTaskResult:
    task_uuid: str
    subscription_key: str
    status: str
    downloaded_files: List[Path]
    raw_response: Dict[str, Any]


class RodinAPIError(Exception):
    """Exception raised for errors returned by Rodin API."""
    def __init__(self, error_code: str, message: str, status_code: int = None):
        super().__init__(f"Rodin API Error [{error_code}] (HTTP {status_code}): {message}")
        self.error_code = error_code
        self.message = message
        self.status_code = status_code


class RodinKeyPool:
    """Thread-safe pool managing multiple Rodin API keys (from different accounts) for concurrent round-robin dispatch."""

    def __init__(self, keys: Optional[List[str]] = None):
        self._lock = threading.Lock()
        self._index = 0
        if keys:
            self._keys = [k.strip() for k in keys if k and k.strip()]
        else:
            self._keys = self._discover_keys()

    def _discover_keys(self) -> List[str]:
        keys: List[str] = []

        # 1. Environment variable (comma-separated or single)
        env_val = os.environ.get("RODIN_API_KEYS") or os.environ.get("RODIN_API_KEY", "")
        if env_val.strip():
            for k in env_val.replace(";", ",").split(","):
                k = k.strip()
                if k and k not in keys:
                    keys.append(k)

        # 2. File locations
        candidate_paths = [
            Path("vlm/rodin_key.txt"),
            Path("rodin_key.txt"),
            Path(".env"),
            Path(__file__).resolve().parents[3] / "vlm" / "rodin_key.txt",
            Path(__file__).resolve().parents[3] / "rodin_key.txt",
            Path(__file__).resolve().parents[3] / ".env",
        ]
        for p in candidate_paths:
            if p.exists():
                try:
                    content = p.read_text(encoding="utf-8").strip()
                    for line in content.splitlines():
                        line = line.strip()
                        if line and not line.startswith("#") and line not in keys:
                            keys.append(line)
                except Exception:
                    pass

        return keys

    def get_next_key(self) -> str:
        with self._lock:
            if not self._keys:
                self._keys = self._discover_keys()
                if not self._keys:
                    raise ValueError(
                        "Rodin API Key is missing or empty. Please set RODIN_API_KEY environment variable "
                        "or write your key(s) into 'vlm/rodin_key.txt'."
                    )
            key = self._keys[self._index % len(self._keys)]
            self._index = (self._index + 1) % len(self._keys)
            logger.info(
                "RodinKeyPool: Dispatched key ...%s (index %d/%d)",
                key[-4:] if len(key) >= 4 else "...",
                (self._index - 1) % len(self._keys),
                len(self._keys),
            )
            return key

    @property
    def key_count(self) -> int:
        with self._lock:
            return len(self._keys)


DEFAULT_RODIN_KEY_POOL = RodinKeyPool()


class RodinClient:
    """Client for interacting with DeemosTech Rodin 3D Generation API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.hyper3d.com/api/v2",
        timeout: int = 60,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.api_key = self._resolve_api_key(api_key)
        
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {self.api_key}"

    def _resolve_api_key(self, api_key: Optional[str]) -> str:
        """Resolve API key from arg or round-robin key pool."""
        if api_key and api_key.strip():
            return api_key.strip()
        return DEFAULT_RODIN_KEY_POOL.get_next_key()

    def _request_with_rate_limit(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """Send HTTP request with automatic 429 rate limit backoff and error validation."""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        while True:
            response = self.session.request(method, url, timeout=self.timeout, **kwargs)
            
            # Handle rate limiting (429)
            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After", "5")
                try:
                    delay = max(1, int(retry_after))
                except ValueError:
                    try:
                        date_header = response.headers.get("Date")
                        delay = max(1, int((parsedate_to_datetime(retry_after) - parsedate_to_datetime(date_header)).total_seconds()))
                    except Exception:
                        delay = 5
                time.sleep(delay)
                continue
                
            # Non-429 responses
            try:
                data = response.json()
            except Exception:
                response.raise_for_status()
                return {}

            # Catch application-level errors returned with HTTP 200/201
            if isinstance(data, dict) and "error" in data:
                err_code = data.get("error", "UNKNOWN_ERROR")
                err_msg = data.get("message", "No error message provided.")
                raise RodinAPIError(err_code, err_msg, response.status_code)

            if not response.ok:
                err_msg = data.get("message", response.text) if isinstance(data, dict) else response.text
                raise RodinAPIError(f"HTTP_{response.status_code}", err_msg, response.status_code)

            return data

    def check_balance(self, usage_page: int = 1) -> Dict[str, Any]:
        """Check available Rodin credits and usage history."""
        return self._request_with_rate_limit("GET", "check_balance", params={"usage_page": usage_page})

    def submit_agentic_image_to_3d(
        self,
        image_path: str | Path,
        prompt: Optional[str] = None,
        tier: str = "standard",
        export_type: str = "glb",
    ) -> Dict[str, Any]:
        """
        Submit an Image-to-3D job via Rodin Agentic endpoint.
        
        Args:
            image_path: Path to local cropped item image
            prompt: Optional semantic description (e.g. 'a desktop wireless mouse')
            tier: 'basic' (3 min, 0.5 cred), 'standard' (5 min, 1 cred), 'pro' (10 min, 2 cred)
            export_type: 'glb' (default)
        """
        path = Path(image_path)
        if not path.is_file():
            raise FileNotFoundError(f"Input image not found: {path}")

        mime_type, _ = mimetypes.guess_type(str(path))
        if not mime_type:
            mime_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"

        data = {"tier": tier, "export_type": export_type}
        if prompt:
            data["prompt"] = prompt

        with path.open("rb") as f:
            files = {"images": ("input.png", f, mime_type)}
            result = self._request_with_rate_limit("POST", "rodin_agentic", data=data, files=files)
            
        return result

    def submit_gen25_image_to_3d(
        self,
        image_path: str | Path,
        prompt: Optional[str] = None,
        tier: str = "Gen-2.5-Medium",
        mesh_mode: str = "Raw",
        quality: str = "medium",
    ) -> Dict[str, Any]:
        """
        Submit an Image-to-3D job via standard Rodin Gen-2.5 endpoint.
        """
        path = Path(image_path)
        if not path.is_file():
            raise FileNotFoundError(f"Input image not found: {path}")

        mime_type, _ = mimetypes.guess_type(str(path))
        if not mime_type:
            mime_type = "image/png"

        data = {"tier": tier, "mesh_mode": mesh_mode, "quality": quality}
        if prompt:
            data["prompt"] = prompt

        with path.open("rb") as f:
            files = {"images": ("input.png", f, mime_type)}
            result = self._request_with_rate_limit("POST", "rodin", data=data, files=files)
            
        return result

    def poll_status(
        self,
        subscription_key: str,
        deadline_seconds: int = 1200,
        initial_delay: int = 3,
        on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Poll task status until all sub-jobs are 'Done' or any job has 'Failed'.
        """
        started_at = time.monotonic()
        delay = initial_delay

        while True:
            if time.monotonic() - started_at >= deadline_seconds:
                raise TimeoutError(f"Rodin generation timed out after {deadline_seconds} seconds")

            time.sleep(delay)
            status_data = self._request_with_rate_limit("POST", "status", json={"subscription_key": subscription_key})
            
            jobs = status_data.get("jobs") or ([status_data["job"]] if "job" in status_data else [])
            if on_progress:
                on_progress(status_data)

            states = [j.get("status") for j in jobs]
            if "Failed" in states:
                raise RuntimeError(f"Rodin task failed: {status_data}")

            if states and all(s == "Done" for s in states):
                return jobs

            delay = min(delay + 2, 8)

    def download_assets(
        self,
        task_uuid: str,
        output_dir: str | Path,
        target_filename: Optional[str] = None,
    ) -> List[Path]:
        """
        Fetch download list and save asset files (.glb, etc.) to output_dir.
        """
        out_path = Path(output_dir)
        out_path.mkdir(parents=True, exist_ok=True)

        download_resp = self._request_with_rate_limit("POST", "download", json={"task_uuid": task_uuid})
        file_list = download_resp.get("list", [])
        
        saved_files = []
        for item in file_list:
            url = item.get("url")
            raw_name = item.get("name", "model.glb")
            filename = target_filename or raw_name
            
            target_file = out_path / filename
            # Download asset using raw requests (avoids sending Bearer token to presigned S3/OSS URLs)
            r = requests.get(url, stream=True, timeout=120)
            r.raise_for_status()
            with target_file.open("wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            saved_files.append(target_file)

        return saved_files

    def submit_fast_image_to_3d(
        self,
        image_path: str | Path,
        prompt: Optional[str] = None,
        tier: str = "Gen-2.5-Low",
        quality_override: int = 1500,
        geometry_file_format: str = "glb",
    ) -> Dict[str, Any]:
        """
        Submit high-speed low-poly Base Geometry task (~15-20s).
        Enforces material='None' (no texture baking) and custom low poly face budget.
        """
        path = Path(image_path)
        if not path.is_file():
            raise FileNotFoundError(f"Input image not found: {path}")

        mime_type, _ = mimetypes.guess_type(str(path))
        if not mime_type:
            mime_type = "image/png"

        data = {
            "tier": tier,
            "mesh_mode": "Raw",
            "material": "None",
            "quality_override": quality_override,
            "geometry_file_format": geometry_file_format,
        }
        if prompt:
            data["prompt"] = prompt

        with path.open("rb") as f:
            files = {"images": ("input.png", f, mime_type)}
            result = self._request_with_rate_limit("POST", "rodin", data=data, files=files)

        return result

    def generate_glb_from_image(
        self,
        image_path: str | Path,
        output_dir: str | Path,
        prompt: Optional[str] = None,
        use_agentic: bool = False,
        fast_mode: bool = True,
        tier: str = "Gen-2.5-Low",
        quality_override: int = 1500,
        target_filename: Optional[str] = None,
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> RodinTaskResult:
        """
        Convenience end-to-end method: Submit -> Poll -> Download.
        Default: fast_mode=True (15-20s generation, low-poly ~1500 faces, base geometry).
        """
        if on_progress:
            on_progress(f"Submitting image {image_path} to Rodin (fast_mode={fast_mode})...")

        if fast_mode:
            gen_resp = self.submit_fast_image_to_3d(
                image_path=image_path,
                prompt=prompt,
                tier=tier if tier.startswith("Gen-2.5") else "Gen-2.5-Low",
                quality_override=quality_override,
                geometry_file_format="glb",
            )
            task_uuid = gen_resp["uuid"]
            job_info = gen_resp.get("jobs") or gen_resp.get("job", {})
            subscription_key = job_info.get("subscription_key")
        elif use_agentic:
            gen_resp = self.submit_agentic_image_to_3d(image_path, prompt=prompt, tier="standard", export_type="glb")
            task_uuid = gen_resp["uuid"]
            job_info = gen_resp.get("job") or gen_resp.get("jobs", {})
            subscription_key = job_info.get("subscription_key")
        else:
            gen_resp = self.submit_gen25_image_to_3d(image_path, prompt=prompt, tier=tier)
            task_uuid = gen_resp["uuid"]
            job_info = gen_resp.get("jobs") or gen_resp.get("job", {})
            subscription_key = job_info.get("subscription_key")

        if not subscription_key:
            raise ValueError(f"Could not extract subscription_key from response: {gen_resp}")

        if on_progress:
            on_progress(f"Task submitted. UUID: {task_uuid}, subscription_key: {subscription_key}. Polling...")

        def _progress_cb(status_dict):
            if on_progress:
                jobs = status_dict.get("jobs", [])
                states_summary = ", ".join([f"{j.get('uuid', '')[:8]}:{j.get('status')}" for j in jobs])
                on_progress(f"Job status: [{states_summary}]")

        self.poll_status(subscription_key, on_progress=_progress_cb)

        if on_progress:
            on_progress(f"Task {task_uuid} completed. Downloading assets to {output_dir}...")

        saved_files = self.download_assets(task_uuid, output_dir, target_filename=target_filename)
        
        return RodinTaskResult(
            task_uuid=task_uuid,
            subscription_key=subscription_key,
            status="Done",
            downloaded_files=saved_files,
            raw_response=gen_resp,
        )
