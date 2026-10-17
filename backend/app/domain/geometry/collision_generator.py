"""Conservative Bounding Box (AABB) Collision Volume Generator.

Follows the DormTopology data contract (v1):
- Compound convex polyhedra (8 vertices, 12 outward triangular faces)
- Metre units, Y-up, bottom-centre anchor (X in [-w/2, w/2], Y in [0, h], Z in [-d/2, d/2])
- Strict topology validation via backend.app.domain.geometry.convex.validate_compound
- Safe GLB loading with node hierarchy support via trimesh
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import trimesh

from backend.app.domain.geometry.convex import validate_compound


def generate_compound_box(width: float, height: float, depth: float) -> dict[str, Any]:
    """Build a bottom-center aligned compound box satisfying data contract.

    Local coordinates:
    - Origin (0, 0, 0) is at the center of the bottom face.
    - X spans [-width / 2, width / 2]
    - Y spans [0.0, height]
    - Z spans [-depth / 2, depth / 2]
    - 8 vertices, 12 outward triangle faces
    """
    if width <= 0 or height <= 0 or depth <= 0:
        raise ValueError(f"Dimensions must be positive finite floats: {(width, height, depth)}")

    half_w = float(width) / 2.0
    half_d = float(depth) / 2.0
    h = float(height)

    vertices = [
        [-half_w, 0.0, -half_d],  # 0: bottom -x, -z
        [ half_w, 0.0, -half_d],  # 1: bottom +x, -z
        [ half_w, 0.0,  half_d],  # 2: bottom +x, +z
        [-half_w, 0.0,  half_d],  # 3: bottom -x, +z
        [-half_w, h,   -half_d],  # 4: top    -x, -z
        [ half_w, h,   -half_d],  # 5: top    +x, -z
        [ half_w, h,    half_d],  # 6: top    +x, +z
        [-half_w, h,    half_d],  # 7: top    -x, +z
    ]

    # Outward-pointing triangular faces (counter-clockwise winding from outside)
    faces = [
        [0, 1, 2], [0, 2, 3],  # bottom (-Y)
        [4, 6, 5], [4, 7, 6],  # top (+Y)
        [0, 5, 1], [0, 4, 5],  # rear (-Z)
        [1, 6, 2], [1, 5, 6],  # right (+X)
        [2, 7, 3], [2, 6, 7],  # front (+Z)
        [3, 4, 0], [3, 7, 4],  # left (-X)
    ]

    compound = {
        "type": "compound",
        "parts": [
            {
                "vertices_m": vertices,
                "faces": faces,
            }
        ],
    }
    validate_compound(compound)
    return compound


def extract_glb_bounds(glb_path: str | Path) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """Extract global axis-aligned bounding box from a GLB file.

    Handles trimesh.Scene with multiple nodes and transforms.
    Returns (lo, hi) where each is (x, y, z).
    """
    path = Path(glb_path)
    if not path.exists():
        raise FileNotFoundError(f"GLB model not found: {path}")

    scene_or_mesh = trimesh.load(str(path))
    if isinstance(scene_or_mesh, trimesh.Scene):
        bounds = scene_or_mesh.bounds
    else:
        bounds = scene_or_mesh.bounds

    if bounds is None or len(bounds) != 2:
        raise ValueError(f"Could not extract bounding box from {path.name}")

    lo = tuple(float(x) for x in bounds[0])
    hi = tuple(float(x) for x in bounds[1])

    if any(not np.isfinite(x) for x in (*lo, *hi)):
        raise ValueError(f"GLB {path.name} contains non-finite bounds: {lo}, {hi}")

    if any(hi[i] - lo[i] <= 1e-9 for i in range(3)):
        raise ValueError(f"GLB {path.name} has degenerate extents: {[hi[i] - lo[i] for i in range(3)]}")

    return lo, hi


def generate_collision_from_glb(
    glb_path: str | Path,
    target_dimensions: Sequence[float] | None = None,
) -> dict[str, Any]:
    """Generate conservative compound collision for a GLB model.

    If target_dimensions is given (width, height, depth in metres), the box
    is sized according to target_dimensions (from VLM estimation or user input).
    Otherwise, dimensions are directly derived from the GLB extents.
    """
    lo, hi = extract_glb_bounds(glb_path)
    model_extents = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])

    if target_dimensions is not None:
        if len(target_dimensions) != 3 or any(d <= 0 for d in target_dimensions):
            raise ValueError(f"target_dimensions must be 3 positive numbers: {target_dimensions}")
        w, h, d = (float(target_dimensions[0]), float(target_dimensions[1]), float(target_dimensions[2]))
    else:
        w, h, d = model_extents

    return generate_compound_box(w, h, d)


def save_collision_json(collision: dict[str, Any], output_path: str | Path) -> Path:
    """Save collision dictionary to JSON file."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(collision, indent=2, ensure_ascii=False), encoding="utf-8")
    return path
