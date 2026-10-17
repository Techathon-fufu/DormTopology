"""
Test Suite: 3D Asset Validation
Inspects and validates generated .glb digital twin models.
"""

import sys
from pathlib import Path
import trimesh

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_glb_asset(glb_rel_path: str, expected_min_geometries: int = 1):
    glb_path = PROJECT_ROOT / glb_rel_path
    assert glb_path.exists(), f"Asset not found: {glb_path}"
    
    # 1. Validate glTF 2.0 binary header
    with glb_path.open("rb") as f:
        magic = f.read(4)
        version = int.from_bytes(f.read(4), "little")
        total_len = int.from_bytes(f.read(4), "little")
        
    assert magic == b"glTF", f"Invalid magic in {glb_path.name}: {magic}"
    assert version == 2, f"Expected glTF version 2, got {version}"
    assert total_len == glb_path.stat().st_size, "Header length mismatch"
    print(f"[PASS] Header validation: {glb_path.name} (glTF v{version}, {total_len} bytes)")

    # 2. Validate Scene and Mesh structures
    scene = trimesh.load(str(glb_path))
    if isinstance(scene, trimesh.Scene):
        geom_count = len(scene.geometry)
        assert geom_count >= expected_min_geometries, f"Expected at least {expected_min_geometries} geometries, got {geom_count}"
        print(f"[PASS] Geometry hierarchy: {geom_count} sub-meshes found:")
        for name, geom in scene.geometry.items():
            print(f"       - {name}: {len(geom.vertices)} vertices, {len(geom.faces)} faces, bounds={geom.extents.round(3).tolist()}")
    else:
        assert len(scene.vertices) > 0
        print(f"[PASS] Single mesh: {len(scene.vertices)} vertices, bounds={scene.extents.round(3).tolist()}")


def main():
    print("=" * 60)
    print("Running 3D Asset Validation Tests...")
    print("=" * 60)
    
    # 全部 GLB 资产统一放在 Prefabmodel/ 下（objects/ 只保留 Blender/OBJ 源文件）。
    # charger/mousepad 存在两个保真度层级：低模 prefab 与 Rodin 高模（-detail 后缀）；
    # mouse/keyboard 两个目录原本逐字节相同，已合并为一份。
    test_glb_asset("Prefabmodel/tape_measure.glb", expected_min_geometries=5)
    test_glb_asset("Prefabmodel/mouse.glb", expected_min_geometries=10)
    test_glb_asset("Prefabmodel/charger_detail.glb", expected_min_geometries=1)
    test_glb_asset("Prefabmodel/keyboard.glb", expected_min_geometries=1)
    test_glb_asset("Prefabmodel/mousepad_detail.glb", expected_min_geometries=1)
    test_glb_asset("Prefabmodel/power_strip.glb", expected_min_geometries=1)
    test_glb_asset("Prefabmodel/tissue_pack.glb", expected_min_geometries=1)
    test_glb_asset("Prefabmodel/tablet.glb", expected_min_geometries=1)
    
    print("\n[SUCCESS] All 3D asset validation tests passed!")


if __name__ == "__main__":
    main()
