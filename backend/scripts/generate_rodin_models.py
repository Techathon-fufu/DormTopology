"""
3D Asset Generation Pipeline via Rodin API
Generates realistic .glb 3D digital twin assets from cropped 2D item images.

Usage:
  python scripts/generate_rodin_models.py --item item_05
  python scripts/generate_rodin_models.py --image vlm/crops/crop_item_05_卷尺.png --name tape_measure
  python scripts/generate_rodin_models.py --check-balance
"""

import sys
import os
import json
import argparse
from pathlib import Path

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.adapters.rodin_adapter import RodinClient, RodinAPIError


DEFAULT_CANDIDATE_ITEMS = {
    "item_05": {
        "name": "卷尺",
        "english_name": "tape_measure",
        "crop_path": "tests/crops/crop_item_05_卷尺.png",
        "prompt": "A compact round yellow and black tape measure, hard surface, realistic 3D asset",
    },
    "item_03": {
        "name": "鼠标",
        "english_name": "mouse",
        "crop_path": "tests/crops/crop_item_03_鼠标.png",
        "prompt": "A modern ergonomic wireless optical computer mouse, black matte finish",
    },
    "item_07": {
        "name": "充电器",
        "english_name": "charger",
        "crop_path": "tests/crops/crop_item_07_充电器.png",
        "prompt": "A white compact multi-port USB-C fast charger wall adapter plug",
    },
    "item_04": {
        "name": "鼠标垫",
        "english_name": "mousepad",
        "crop_path": "tests/crops/crop_item_04_鼠标垫.png",
        "prompt": "A black desk mousepad mat with smooth edge stitching",
    },
}


def run_check_balance(client: RodinClient):
    print("Checking Rodin account balance...")
    balance_info = client.check_balance()
    print("Balance information:")
    print(json.dumps(balance_info, indent=2, ensure_ascii=False))


def generate_single_item(
    client: RodinClient,
    item_id: str,
    image_path: Path,
    prompt: str,
    target_filename: str,
    output_dir: Path,
    tier: str = "standard",
    use_agentic: bool = True,
):
    print(f"\n==========================================", flush=True)
    print(f"Generating 3D asset for: {item_id} ({target_filename})", flush=True)
    print(f"Source Image: {image_path}", flush=True)
    print(f"Prompt: {prompt}", flush=True)
    print(f"Target Output: {output_dir / target_filename}", flush=True)
    print(f"Tier: {tier}, Mode: {'Agentic' if use_agentic else 'Gen-2.5'}", flush=True)
    print(f"==========================================", flush=True)

    def on_progress(msg: str):
        print(f"[*] {msg}", flush=True)

    result = client.generate_glb_from_image(
        image_path=image_path,
        output_dir=output_dir,
        prompt=prompt,
        use_agentic=use_agentic,
        tier=tier,
        target_filename=target_filename,
        on_progress=on_progress,
    )

    print(f"[+] Successfully generated asset: {result.downloaded_files}", flush=True)
    return result


def update_detection_json(item_id: str, model_rel_path: str):
    candidate_json_paths = [
        PROJECT_ROOT / "tests" / "test_vlm_round2" / "vlm_result_round2.json",
        PROJECT_ROOT / "vlm" / "results" / "vlm_result_round2.json",
    ]
    for json_path in candidate_json_paths:
        if json_path.exists():
            try:
                data = json.loads(json_path.read_text(encoding="utf-8"))
                for item in data.get("items", []):
                    if item.get("id") == item_id:
                        item["model_url"] = model_rel_path
                        print(f"[+] Linked model '{model_rel_path}' to {item_id} in {json_path.name}")
                json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception as e:
                print(f"[!] Warning: Failed to update {json_path}: {e}")


def main():
    parser = argparse.ArgumentParser(description="Generate 3D GLB assets using Hyper3D Rodin API")
    parser.add_argument("--item", choices=list(DEFAULT_CANDIDATE_ITEMS.keys()) + ["all"], default="item_05",
                        help="Pre-configured item to generate (default: item_05 = 卷尺)")
    parser.add_argument("--image", type=str, help="Custom image path")
    parser.add_argument("--name", type=str, help="Custom output model filename without extension")
    parser.add_argument("--prompt", type=str, help="Custom prompt for Rodin")
    parser.add_argument("--tier", type=str, default="standard", help="Rodin tier: standard, basic, or pro")
    parser.add_argument("--gen25", action="store_true", help="Use standard Gen-2.5 endpoint instead of Agentic")
    parser.add_argument("--check-balance", action="store_true", help="Only check account balance")
    parser.add_argument("--api-key", type=str, help="Rodin API Key override")
    parser.add_argument("--resume-uuid", type=str, help="Resume downloading an existing task uuid")
    parser.add_argument("--resume-sub-key", type=str, help="Resume polling with subscription_key")
    parser.add_argument("--resume-name", type=str, default="tape_measure.glb", help="Filename for resumed download")

    args = parser.parse_args()

    # Verify key presence safely
    try:
        client = RodinClient(api_key=args.api_key)
    except ValueError as e:
        print(f"\n[ERROR] {e}", flush=True)
        print("\nPlease write your Rodin API Key into 'vlm/rodin_key.txt' (or set RODIN_API_KEY environment variable).", flush=True)
        sys.exit(1)

    if args.check_balance:
        run_check_balance(client)
        return

    output_dir = PROJECT_ROOT / "objects"

    if args.resume_uuid and args.resume_sub_key:
        print(f"[*] Resuming polling for task {args.resume_uuid}...", flush=True)
        def _prog_cb(status_dict):
            jobs = status_dict.get("jobs") or ([status_dict["job"]] if "job" in status_dict else [])
            states = ", ".join([f"{j.get('uuid', '')[:8]}:{j.get('status')}" for j in jobs])
            print(f"[*] Job status: [{states}]", flush=True)

        client.poll_status(args.resume_sub_key, on_progress=_prog_cb)
        print(f"[*] Task completed! Downloading asset to {output_dir / args.resume_name}...", flush=True)
        saved = client.download_assets(args.resume_uuid, output_dir, target_filename=args.resume_name)
        print(f"[+] Download complete: {saved}", flush=True)
        update_detection_json("item_05", f"objects/{args.resume_name}")
        return

    if args.image:
        img_p = Path(args.image)
        if not img_p.is_absolute():
            img_p = PROJECT_ROOT / img_p
        model_name = f"{args.name or img_p.stem}.glb"
        generate_single_item(
            client=client,
            item_id="custom",
            image_path=img_p,
            prompt=args.prompt or "",
            target_filename=model_name,
            output_dir=output_dir,
            tier=args.tier,
            use_agentic=not args.gen25,
        )
        return

    items_to_process = [args.item] if args.item != "all" else list(DEFAULT_CANDIDATE_ITEMS.keys())

    for item_key in items_to_process:
        info = DEFAULT_CANDIDATE_ITEMS[item_key]
        img_p = PROJECT_ROOT / info["crop_path"]
        model_name = f"{info['english_name']}.glb"
        
        if not img_p.exists():
            print(f"[!] Warning: Image not found for {item_key}: {img_p}. Skipping.")
            continue

        res = generate_single_item(
            client=client,
            item_id=item_key,
            image_path=img_p,
            prompt=info["prompt"],
            target_filename=model_name,
            output_dir=output_dir,
            tier=args.tier,
            use_agentic=not args.gen25,
        )
        rel_model_path = f"objects/{model_name}"
        update_detection_json(item_key, rel_model_path)


if __name__ == "__main__":
    main()
