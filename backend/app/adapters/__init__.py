"""
Adapters layer for external services and hardware/file storage.
Includes:
- Rodin 3D Generation API adapter
- Vision Language Model (VLM) grounding adapter
"""

from .rodin_adapter import RodinClient, RodinTaskResult
from .vlm_adapter import VLMClient

__all__ = ["RodinClient", "RodinTaskResult", "VLMClient"]
