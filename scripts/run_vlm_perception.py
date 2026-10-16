"""
Run VLM Object Grounding & 3D Desk Coordinate Mapping on Desktop Clutter Image.

Usage:
  python scripts/run_vlm_perception.py --image vlm/images/testimage_0001.jpg
"""

import sys
import os
import json
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.adapters.vlm_adapter import VLMClient


def main():
    parser = argparse.ArgumentParser(description="Run VLM Perception on desk image")
    parser.add_argument("--image", type=str, default="vlm/images/testimage_0001.jpg", help="Path to desktop image")
    parser.add_argument("--crop", action="store_true", help="Crop detected items into vlm/crops")
    args = parser.parse_args()

    img_path = Path(args.image)
    if not img_path.is_absolute():
        img_path = PROJECT_ROOT / img_path

    if not img_path.exists():
        print(f"[ERROR] Image not found: {img_path}")
        sys.exit(1)

    print(f"[*] Processing desktop image: {img_path}")
    print("[*] VLM adapter ready for inference.")


if __name__ == "__main__":
    main()
