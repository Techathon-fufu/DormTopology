"""
Parallel Multi-Key Rodin 3D Generation Pipeline
Distributes 3D asset generation tasks across multiple Rodin API keys concurrently.

Key features:
- Multi-key pool rotation (each key runs 1-2 tasks in parallel)
- ThreadPoolExecutor execution with automatic rate limit backoff
- Thread-safe progress reporting and data contract updates
"""

import sys
import os
import json
import time
import threading
from pathlib import Path
from queue import Queue
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, List

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.adapters.rodin_adapter import RodinClient, RodinAPIError
from backend.app.adapters.vlm_adapter import ASSET_DIR_NAME


def load_tasks_from_contract(contract_path: Path) -> List[Dict[str, Any]]:
    """
    Dynamically loads tasks from contract, strictly filtering out:
    1. Items matching the PREFAB catalog (handled via preset models)
    2. Items matching standard parts (e.g. power strip)
    Only items with model_source == 'rodin' are returned for 3D generation.
    """
    if not contract_path.exists():
        print(f"[!] Contract not found: {contract_path}")
        return []

    data = json.loads(contract_path.read_text(encoding="utf-8"))
    items = data.get("items", [])

    tasks = []
    for it in items:
        name = it.get("name", "")
        source = it.get("model_source", "rodin")
        
        # Exclude standard parts
        if any(k in name for k in ["排插", "插排", "接线板"]):
            continue

        # Exclude prefab models
        if source == "prefab" or it.get("prefab_key"):
            continue

        iid = it["id"]
        tasks.append({
            "id": iid,
            "name": name,
            "output_name": f"{iid}.glb",
            "prompt": f"A realistic 3D model of {name}, high fidelity, accurate desktop object proportions",
            "tier": "basic",
            "size_m": it.get("size_m") or it.get("estimated_size_m"),
        })
    return tasks


LOCK = threading.Lock()


def load_api_keys() -> List[str]:
    """Load all distinct valid API keys from vlm/rodin_key.txt or rodin_keys.txt."""
    candidate_paths = [
        PROJECT_ROOT / "vlm" / "rodin_key.txt",
        PROJECT_ROOT / "rodin_key.txt",
        PROJECT_ROOT / "tests" / "rodin_key.txt",
    ]
    keys = []
    for p in candidate_paths:
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                k = line.strip()
                if k and not k.startswith("#") and k not in keys:
                    keys.append(k)
    return keys


def update_contract(item_id: str, model_rel_path: str, collision: Dict[str, Any] | None = None):
    """Thread-safe update to contract JSON with model_url and collision volume."""
    with LOCK:
        contract_path = PROJECT_ROOT / "tests" / "test_vlm_round2" / "vlm_result_pose_test.json"
        if not contract_path.exists():
            contract_path = PROJECT_ROOT / "tests" / "test_vlm_round2" / "vlm_result_round2.json"
        if not contract_path.exists():
            return
        try:
            data = json.loads(contract_path.read_text(encoding="utf-8"))
            for item in data.get("items", []):
                if item.get("id") == item_id:
                    item["model_url"] = model_rel_path
                    if collision is not None:
                        item["collision"] = collision
                    print(f"[{item_id}] Linked '{model_rel_path}' and collision into {contract_path.name}", flush=True)
            contract_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"[{item_id}] Failed to update contract: {e}", flush=True)


def find_crop_path(item_id: str) -> Path:
    crops_dir = PROJECT_ROOT / "tests" / "crops"
    matches = list(crops_dir.glob(f"crop_{item_id}_*.png"))
    if not matches:
        raise FileNotFoundError(f"No crop found matching crop_{item_id}_*.png in {crops_dir}")
    return matches[0]


def worker_task(item_info: Dict[str, Any], key_queue: Queue) -> Dict[str, Any]:
    item_id = item_info["id"]
    name = item_info["name"]
    output_name = item_info["output_name"]
    prompt = item_info["prompt"]
    tier = item_info.get("tier", "basic")

    # Acquire an API key from the pool
    api_key = key_queue.get()
    key_tag = f"{api_key[:4]}...{api_key[-4:]}"
    output_dir = PROJECT_ROOT / ASSET_DIR_NAME

    try:
        crop_path = find_crop_path(item_id)
        print(f"[{item_id} | {name}] Starting with Key [{key_tag}]. Image: {crop_path.name}", flush=True)

        client = RodinClient(api_key=api_key)

        def on_prog(msg: str):
            print(f"[{item_id} | {name}] {msg}", flush=True)

        res = client.generate_glb_from_image(
            image_path=crop_path,
            output_dir=output_dir,
            prompt=prompt,
            use_agentic=True,
            tier=tier,
            target_filename=output_name,
            on_progress=on_prog,
        )

        rel_model_path = f"{ASSET_DIR_NAME}/{output_name}"
        glb_file = output_dir / output_name

        # Generate conservative AABB collision volume
        collision = None
        try:
            from backend.app.domain.geometry.collision_generator import (
                generate_collision_from_glb,
                save_collision_json,
            )
            collision = generate_collision_from_glb(
                glb_file,
                target_dimensions=item_info.get("size_m"),
            )
            col_dir = PROJECT_ROOT / ASSET_DIR_NAME / "collisionsize"
            col_path = col_dir / f"{item_id}.collision.json"
            save_collision_json(collision, col_path)
            print(f"[{item_id} | {name}] Generated collision volume: {col_path.name}", flush=True)
        except Exception as ce:
            print(f"[{item_id} | {name}] Warning: Failed to generate collision volume: {ce}", flush=True)

        update_contract(item_id, rel_model_path, collision)
        print(f"[{item_id} | {name}] SUCCESS! Generated {rel_model_path}", flush=True)
        return {"id": item_id, "status": "success", "file": rel_model_path, "collision": collision}

    except Exception as e:
        print(f"[{item_id} | {name}] FAILED: {e}", flush=True)
        return {"id": item_id, "status": "failed", "error": str(e)}

    finally:
        # Return API key back to pool
        key_queue.put(api_key)


def main():
    print("=" * 70, flush=True)
    print("DormTopology 3D Multi-Key Parallel Generation Pipeline", flush=True)
    print("=" * 70, flush=True)

    keys = load_api_keys()
    print(f"[*] Loaded {len(keys)} API keys from config.", flush=True)
    if not keys:
        print("[ERROR] No API keys found! Exiting.", flush=True)
        sys.exit(1)

    contract_path = PROJECT_ROOT / "tests" / "test_vlm_round2" / "vlm_result_pose_test.json"
    if not contract_path.exists():
        contract_path = PROJECT_ROOT / "tests" / "test_vlm_round2" / "vlm_result_round2.json"

    tasks = load_tasks_from_contract(contract_path)
    print(f"[*] Dynamically loaded {len(tasks)} Rodin 3D generation tasks from {contract_path.name}:", flush=True)
    for t in tasks:
        print(f"    - {t['id']} ({t['name']}) -> {t['output_name']}", flush=True)

    if not tasks:
        print("[+] All items are covered by PREFAB catalog or standard parts. Zero Rodin tasks needed!", flush=True)
        return

    # Initialize key queue
    key_queue = Queue()
    for k in keys:
        key_queue.put(k)

    max_workers = min(len(keys), len(tasks))
    print(f"[*] Launching {len(tasks)} tasks with {max_workers} parallel workers...", flush=True)

    start_time = time.monotonic()
    results = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(worker_task, item, key_queue): item["id"]
            for item in tasks
        }

        for f in as_completed(futures):
            item_id = futures[f]
            try:
                res = f.result()
                results.append(res)
            except Exception as e:
                print(f"[!] Unhandled exception for {item_id}: {e}", flush=True)
                results.append({"id": item_id, "status": "error", "error": str(e)})

    elapsed = time.monotonic() - start_time
    print("=" * 70, flush=True)
    print(f"All parallel generation jobs finished in {elapsed:.1f} seconds!", flush=True)
    for r in results:
        status_symbol = "[OK]" if r.get("status") == "success" else "[FAIL]"
        print(f"  {status_symbol} {r['id']}: {r.get('file') or r.get('error')}", flush=True)
    print("=" * 70, flush=True)


if __name__ == "__main__":
    main()
