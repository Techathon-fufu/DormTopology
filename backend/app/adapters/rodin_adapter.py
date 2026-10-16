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

import os
import time
import mimetypes
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Callable, Optional, Dict, Any, List
import requests


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
        """Resolve API key from arg, env, or key file."""
        if api_key and api_key.strip():
            return api_key.strip()
        
        env_key = os.environ.get("RODIN_API_KEY", "").strip()
        if env_key:
            return env_key
            
        # Search candidate key file locations
        candidate_paths = [
            Path("vlm/rodin_key.txt"),
            Path("rodin_key.txt"),
            Path(__file__).resolve().parents[3] / "vlm" / "rodin_key.txt",
            Path(__file__).resolve().parents[3] / "rodin_key.txt",
        ]
        for p in candidate_paths:
            if p.exists():
                content = p.read_text(encoding="utf-8").strip()
                if content:
                    return content
                    
        raise ValueError(
            "Rodin API Key is missing or empty. Please set RODIN_API_KEY environment variable "
            "or write your key into 'vlm/rodin_key.txt'."
        )

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
            files = {"images": (path.name, f, mime_type)}
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
            files = {"images": (path.name, f, mime_type)}
            result = self._request_with_rate_limit("POST", "rodin", data=data, files=files)
            
        return result

    def poll_status(
        self,
        subscription_key: str,
        deadline_seconds: int = 1200,
        initial_delay: int = 5,
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
            
            jobs = status_data.get("jobs", [])
            if on_progress:
                on_progress(status_data)

            states = [j.get("status") for j in jobs]
            if "Failed" in states:
                raise RuntimeError(f"Rodin task failed: {status_data}")

            if states and all(s == "Done" for s in states):
                return jobs

            delay = min(delay + 5, 30)

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
            r = self.session.get(url, stream=True, timeout=120)
            r.raise_for_status()
            with target_file.open("wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            saved_files.append(target_file)

        return saved_files

    def generate_glb_from_image(
        self,
        image_path: str | Path,
        output_dir: str | Path,
        prompt: Optional[str] = None,
        use_agentic: bool = True,
        tier: str = "standard",
        target_filename: Optional[str] = None,
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> RodinTaskResult:
        """
        Convenience end-to-end method: Submit -> Poll -> Download.
        """
        if on_progress:
            on_progress(f"Submitting image {image_path} to Rodin...")

        if use_agentic:
            gen_resp = self.submit_agentic_image_to_3d(image_path, prompt=prompt, tier=tier, export_type="glb")
            task_uuid = gen_resp["uuid"]
            subscription_key = gen_resp["job"]["subscription_key"]
        else:
            gen_resp = self.submit_gen25_image_to_3d(image_path, prompt=prompt)
            task_uuid = gen_resp["uuid"]
            subscription_key = gen_resp["jobs"]["subscription_key"]

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
