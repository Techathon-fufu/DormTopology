"""
Batch Collision Volume Generator for 3D Assets (Conservative AABB).

Reads VLM perception / Rodin contract JSONs or individual GLB files,
computes conservative bounding box collision volumes, validates topology,
and outputs standardized compound collision objects.

Usage:
  python backend/scripts/generate_collision_volumes.py --contract tests/test_vlm_round2/vlm_result_round2.json
  python backend/scripts/generate_collision_volumes.py --glb Prefabmodel/tape_measure.glb --output Prefabmodel/collisionsize/tape_measure.collision.json
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.adapters.vlm_adapter import ASSET_DIR_NAME
from backend.app.domain.geometry.collision_generator import (
    generate_collision_from_glb,
    generate_compound_box,
    save_collision_json,
)


def process_contract(contract_path: Path) -> int:
    """Process all items in a contract JSON and generate collision volumes."""
    if not contract_path.exists():
        print(f"[ERROR] Contract file not found: {contract_path}")
        return 1

    data = json.loads(contract_path.read_text(encoding="utf-8"))
    items = data.get("items", [])
    if not items:
        print(f"[!] No items found in {contract_path.name}")
        return 0

    col_dir = PROJECT_ROOT / ASSET_DIR_NAME / "collisionsize"
    col_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 75)
    print(f"Generating collision volumes for items in {contract_path.name}:")
    print("=" * 75)

    updated_count = 0
    for it in items:
        item_id = it.get("id", "unknown")
        name = it.get("name", "unnamed")
        dims = it.get("size_m") or it.get("estimated_size_m")
        model_url = it.get("model_url")

        glb_path = None
        if model_url:
            candidate = PROJECT_ROOT / model_url
            if candidate.exists():
                glb_path = candidate

        try:
            if glb_path is not None:
                collision = generate_collision_from_glb(glb_path, target_dimensions=dims)
                source_note = f"from GLB {glb_path.name}"
            elif dims is not None:
                collision = generate_compound_box(dims[0], dims[1], dims[2])
                source_note = f"from estimated dimensions {dims}"
            else:
                print(f"[SKIP] {item_id:8s} ({name}): No GLB or dimensions available.")
                continue

            it["collision"] = collision
            if dims and not it.get("size_m"):
                it["size_m"] = list(dims)

            col_file = col_dir / f"{item_id}.collision.json"
            save_collision_json(collision, col_file)
            print(f"[OK]   {item_id:8s} ({name:10s}): {source_note} -> saved {col_file.name}")
            updated_count += 1

        except Exception as e:
            print(f"[FAIL] {item_id:8s} ({name}): Failed to generate collision: {e}")

    contract_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print("=" * 75)
    print(f"[SUCCESS] Updated {updated_count}/{len(items)} items in {contract_path.name} with validated collision volumes!")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Generate conservative bounding box collision volumes")
    parser.add_argument("--contract", type=str, help="Path to contract JSON (e.g. tests/test_vlm_round2/vlm_result_round2.json)")
    parser.add_argument("--glb", type=str, help="Path to single GLB file")
    parser.add_argument("--output", type=str, help="Output path for single collision JSON")
    parser.add_argument("--dims", type=float, nargs=3, help="Override dimensions (width height depth) in metres")

    args = parser.parse_args()

    if args.contract:
        cpath = Path(args.contract)
        if not cpath.is_absolute():
            cpath = PROJECT_ROOT / cpath
        sys.exit(process_contract(cpath))

    if args.glb:
        gp = Path(args.glb)
        if not gp.is_absolute():
            gp = PROJECT_ROOT / gp
        if not gp.exists():
            print(f"[ERROR] GLB file not found: {gp}")
            sys.exit(1)

        collision = generate_collision_from_glb(gp, target_dimensions=args.dims)
        out_p = Path(args.output) if args.output else gp.with_suffix(".collision.json")
        if not out_p.is_absolute():
            out_p = PROJECT_ROOT / out_p
        save_collision_json(collision, out_p)
        print(f"[SUCCESS] Generated collision volume for {gp.name} -> {out_p}")
        return

    # Default action if no arguments provided: process default contract
    default_contract = PROJECT_ROOT / "tests" / "test_vlm_round2" / "vlm_result_round2.json"
    if default_contract.exists():
        sys.exit(process_contract(default_contract))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
