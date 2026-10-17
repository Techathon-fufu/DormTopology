"""
Unit test suite for Conservative Bounding Box Collision Volume Generation.

Verifies:
1. Compound box geometry validity (8 vertices, 12 triangular faces, outward normals, positive volume).
2. Correct bottom-center anchoring (Y=0 bottom, X/Z centered at 0).
3. GLB bounding box extraction across complex node hierarchies.
4. SAT collision detection compatibility with backend.app.domain.geometry.convex.
5. JSON serialization and contract compliance.
"""

import json
import math
import tempfile
import unittest
from pathlib import Path

import trimesh

from backend.app.domain.geometry.collision_generator import (
    extract_glb_bounds,
    generate_collision_from_glb,
    generate_compound_box,
    save_collision_json,
)
from backend.app.domain.geometry.convex import (
    bounds,
    items_overlap,
    validate_compound,
    world_parts,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class TestCollisionGeneration(unittest.TestCase):

    def test_compound_box_structure_and_validation(self):
        """Verify compound box satisfies the strict geometric manifold validator."""
        w, h, d = 0.25, 0.10, 0.15
        compound = generate_compound_box(w, h, d)

        # 1. Structural checks
        self.assertEqual(compound["type"], "compound")
        self.assertEqual(len(compound["parts"]), 1)
        part = compound["parts"][0]
        self.assertEqual(len(part["vertices_m"]), 8)
        self.assertEqual(len(part["faces"]), 12)

        # 2. Geometry validator from domain/geometry/convex.py
        validate_compound(compound)

        # 3. Bottom-center anchor verification
        lo, hi = bounds(part["vertices_m"])
        self.assertAlmostEqual(lo[0], -w / 2.0, places=7)
        self.assertAlmostEqual(hi[0],  w / 2.0, places=7)
        self.assertAlmostEqual(lo[1],  0.0,     places=7)  # Bottom sits on ground / surface
        self.assertAlmostEqual(hi[1],  h,       places=7)
        self.assertAlmostEqual(lo[2], -d / 2.0, places=7)
        self.assertAlmostEqual(hi[2],  d / 2.0, places=7)

    def test_invalid_dimensions_rejected(self):
        """Reject non-positive or degenerate dimensions."""
        with self.assertRaises(ValueError):
            generate_compound_box(0, 0.1, 0.1)
        with self.assertRaises(ValueError):
            generate_compound_box(-0.1, 0.1, 0.1)

    def test_extract_glb_bounds_existing_assets(self):
        """Extract bounds from existing GLB assets."""
        candidate_assets = [
            PROJECT_ROOT / "Prefabmodel" / "tape_measure.glb",
            PROJECT_ROOT / "Prefabmodel" / "mouse.glb",
            PROJECT_ROOT / "Prefabmodel" / "tissue_pack.glb",
        ]
        for glb in candidate_assets:
            if not glb.exists():
                continue
            lo, hi = extract_glb_bounds(glb)
            for i in range(3):
                self.assertLess(lo[i], hi[i])
                self.assertTrue(math.isfinite(lo[i]))
                self.assertTrue(math.isfinite(hi[i]))

    def test_generate_from_glb_with_target_dimensions(self):
        """Verify scaling to target dimensions (VLM estimated size)."""
        glb = PROJECT_ROOT / "Prefabmodel" / "tape_measure.glb"
        if not glb.exists():
            self.skipTest(f"Asset {glb} not found")

        target_dims = (0.08, 0.06, 0.08)
        compound = generate_collision_from_glb(glb, target_dimensions=target_dims)
        validate_compound(compound)

        part = compound["parts"][0]
        lo, hi = bounds(part["vertices_m"])
        self.assertAlmostEqual(hi[0] - lo[0], 0.08, places=7)
        self.assertAlmostEqual(hi[1] - lo[1], 0.06, places=7)
        self.assertAlmostEqual(hi[2] - lo[2], 0.08, places=7)
        self.assertAlmostEqual(lo[1], 0.0, places=7)

    def test_sat_collision_with_generated_compound(self):
        """Verify SAT collision behavior: overlapping vs separated vs surface touching."""
        box1_col = generate_compound_box(0.1, 0.1, 0.1)
        box2_col = generate_compound_box(0.1, 0.1, 0.1)

        item1 = {
            "id": "item1",
            "size_m": [0.1, 0.1, 0.1],
            "position": [0.0, 0.77, 0.0],
            "rotation_y_rad": 0.0,
            "collision": box1_col,
        }

        # Penetration (x offset 0.05 < 0.10)
        item2 = {
            "id": "item2",
            "size_m": [0.1, 0.1, 0.1],
            "position": [0.05, 0.77, 0.0],
            "rotation_y_rad": 0.0,
            "collision": box2_col,
        }
        self.assertTrue(items_overlap(item1, item2))

        # Separated (x offset 0.20 > 0.10)
        item2["position"] = [0.20, 0.77, 0.0]
        self.assertFalse(items_overlap(item1, item2))

        # Exact surface touch (x offset 0.10, tolerance allows touch)
        item2["position"] = [0.10, 0.77, 0.0]
        self.assertFalse(items_overlap(item1, item2))

    def test_save_and_reload_collision_json(self):
        """Ensure save_collision_json creates compliant JSON file."""
        compound = generate_compound_box(0.3, 0.05, 0.2)
        with tempfile.TemporaryDirectory() as tmpdir:
            out_file = Path(tmpdir) / "test.collision.json"
            save_collision_json(compound, out_file)
            self.assertTrue(out_file.exists())

            loaded = json.loads(out_file.read_text(encoding="utf-8"))
            validate_compound(loaded)
            self.assertEqual(loaded, compound)


if __name__ == "__main__":
    unittest.main()
