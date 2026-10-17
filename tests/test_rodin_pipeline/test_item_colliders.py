"""物品碰撞体回归测试。

断言：
  1. 每个 Prefabmodel/*.glb 物品都有对应的 *.collision.json（桌体/抽屉除外）
  2. 每份碰撞体通过后端契约校验器 validate_compound
  3. 碰撞体忠实于源网格：每个源网格都被某个部件包住（凸包是超集）
  4. keyboard/mouse 走 AABB 路线且为 1 部件（部件数上限护栏）
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import numpy as np
import trimesh

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.domain.geometry.convex import validate_compound  # noqa: E402

ASSET_DIR = PROJECT_ROOT / "Prefabmodel"
COLLIDER_DIR = ASSET_DIR / "collisionsize"

# 场景固定结构，不生成物品碰撞体
EXCLUDED = {"dormdesk.glb", "drawer_bottom.glb", "drawer_middle.glb", "drawer_top.glb"}

# AABB 路线：部件数上限护栏（防止有人改回逐件凸包导致 SAT 代价失控）
AABB_MODELS = {"keyboard.glb": 1, "mouse.glb": 1}


class TestItemColliders(unittest.TestCase):
    def test_every_item_has_collider(self) -> None:
        items = {p.name for p in ASSET_DIR.glob("*.glb")} - EXCLUDED
        self.assertTrue(items, "no item GLB found")
        for name in sorted(items):
            out = COLLIDER_DIR / f"{Path(name).stem}.collision.json"
            self.assertTrue(out.exists(), f"missing collider for {name}")

    def test_no_collider_for_fixtures(self) -> None:
        for name in sorted(EXCLUDED):
            out = COLLIDER_DIR / f"{Path(name).stem}.collision.json"
            self.assertFalse(out.exists(), f"{name} is a room fixture; should not have an item collider")

    def test_all_pass_contract_validator(self) -> None:
        files = sorted(COLLIDER_DIR.glob("*.collision.json"))
        self.assertTrue(files, "no collider files")
        for p in files:
            payload = json.loads(p.read_text(encoding="utf-8"))
            with self.subTest(collider=p.name):
                validate_compound(payload)  # raises on violation

    def test_colliders_enclose_source_meshes(self) -> None:
        """凸包/包围盒必须是源网格的超集 —— 否则碰撞体会漏掉几何。"""
        for name in sorted({p.name for p in ASSET_DIR.glob("*.glb")} - EXCLUDED):
            payload = json.loads((COLLIDER_DIR / f"{Path(name).stem}.collision.json").read_text(encoding="utf-8"))
            boxes = []
            for part in payload["parts"]:
                v = np.asarray(part["vertices_m"], dtype=float)
                boxes.append((v.min(axis=0), v.max(axis=0)))

            scene = trimesh.load(str(ASSET_DIR / name))
            geoms = scene.geometry if isinstance(scene, trimesh.Scene) else {"__single__": scene}
            for gname, g in geoms.items():
                v = np.asarray(g.vertices, dtype=float)
                fin = v[np.isfinite(v).all(axis=1)]
                if len(fin) < 4:
                    continue
                g_lo, g_hi = fin.min(axis=0), fin.max(axis=0)
                ok = any(
                    np.all(lo <= g_lo + 1e-6) and np.all(hi >= g_hi - 1e-6)
                    for lo, hi in boxes
                )
                with self.subTest(model=name, part=gname):
                    self.assertTrue(ok, f"{name}/{gname} not enclosed by any collider part")

    def test_aabb_models_keep_part_budget(self) -> None:
        for name, budget in AABB_MODELS.items():
            payload = json.loads((COLLIDER_DIR / f"{Path(name).stem}.collision.json").read_text(encoding="utf-8"))
            with self.subTest(model=name):
                self.assertLessEqual(
                    len(payload["parts"]), budget,
                    f"{name} should stay at <= {budget} parts (AABB route); "
                    f"got {len(payload['parts'])} — did it switch to per-mesh convex?",
                )

    def test_manifest_covers_all_items(self) -> None:
        manifest = json.loads((COLLIDER_DIR / "manifest.json").read_text(encoding="utf-8"))
        items = {p.name for p in ASSET_DIR.glob("*.glb")} - EXCLUDED
        self.assertEqual(set(manifest["models"]), items)
        for name, entry in manifest["models"].items():
            with self.subTest(model=name):
                self.assertGreaterEqual(entry["collider_parts"], 1)
                self.assertIn(entry["strategy"], {"convex", "aabb"})


if __name__ == "__main__":
    unittest.main()
