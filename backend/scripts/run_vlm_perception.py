"""
Run VLM Object Grounding, Pose Estimation & 3D Desk Coordinate Mapping.

Features:
- Identifies desktop clutter with 2D bounding boxes and physical dimensions
- Identifies object pose (flat vs upright) and facing direction
- Automatically classifies items into PREFAB catalog vs Rodin dynamic generation
- Excludes power strip standard parts
- Saves standard data contract to JSON and generates visual debug image

Usage:
  python backend/scripts/run_vlm_perception.py --image vlm/testimage_0001.jpg
"""

import sys
import os
import json
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.adapters.vlm_adapter import VLMClient


def main():
    parser = argparse.ArgumentParser(description="Run VLM Perception on desk image")
    parser.add_argument("--image", type=str, default="vlm/testimage_0001.jpg", help="Path to desktop image")
    parser.add_argument("--output", type=str, default="tests/test_vlm_round2/vlm_result_round2.json", help="Path to output JSON")
    parser.add_argument("--vis", type=str, default="vlm/vlm_visualized.jpg", help="Path to debug image")
    args = parser.parse_args()

    img_path = Path(args.image)
    if not img_path.is_absolute():
        img_path = PROJECT_ROOT / img_path

    if not img_path.exists():
        print(f"[ERROR] Image not found: {img_path}")
        sys.exit(1)

    print("=" * 75)
    print("【VLM 桌面感知流水线：姿态识别 + 预制模型分流 + 3D 坐标映射】")
    print(f"输入照片: {img_path}")
    print("=" * 75)

    client = VLMClient()
    print("[*] 正在调用 VLM 模型进行推理与姿态感知...")
    result = client.perceive(img_path)

    items = result.get("items", [])
    print(f"\n[+] 成功解析出 {len(items)} 个物品 (已过滤排插标准件):")
    print("-" * 88)
    print(f"{'ID':8s} {'名称':12s} {'姿态(pose)':10s} {'来源(source)':14s} {'预制键(key)':16s} {'3D 坐标'}")
    print("-" * 88)
    for it in items:
        source_label = f"[{it.get('model_source').upper()}]"
        prefab_key = str(it.get('prefab_key') or '-')
        print(f"{it.get('id',''):8s} {it.get('name',''):12s} {it.get('pose',''):10s} {source_label:14s} {prefab_key:16s} {it.get('current_pos')}")
    print("-" * 88)

    # Generate initial conservative AABB collision volumes for detected items
    from backend.app.domain.geometry.collision_generator import generate_compound_box
    for it in items:
        dims = it.get("estimated_size_m") or it.get("size_m")
        if dims and "collision" not in it:
            try:
                it["collision"] = generate_compound_box(dims[0], dims[1], dims[2])
            except Exception as e:
                print(f"[!] Warning: Failed to generate initial collision for {it.get('id')}: {e}")

    # Save output contract JSON
    out_path = Path(args.output)
    if not out_path.is_absolute():
        out_path = PROJECT_ROOT / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"items": items}, f, ensure_ascii=False, indent=2)
    print(f"\n[+] 结构化数据契约 (含碰撞体积) 已保存至: {out_path}")

    # Generate visualization image
    vis_path = Path(args.vis)
    if not vis_path.is_absolute():
        vis_path = PROJECT_ROOT / vis_path
    vis_path.parent.mkdir(parents=True, exist_ok=True)

    img = Image.open(img_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    orig_w, orig_h = result.get("image_size", img.size)

    for it in items:
        bbox = it.get("bbox_2d", [0, 0, 0, 0])
        xmin, ymin, xmax, ymax = bbox
        px0 = int(xmin / 1000.0 * orig_w)
        py0 = int(ymin / 1000.0 * orig_h)
        px1 = int(xmax / 1000.0 * orig_w)
        py1 = int(ymax / 1000.0 * orig_h)

        is_prefab = it.get("model_source") == "prefab"
        color = "#00FF66" if is_prefab else "#FF3366"
        draw.rectangle([px0, py0, px1, py1], outline=color, width=4)
        tag = f"PREFAB:{it.get('prefab_key')}" if is_prefab else "RODIN"
        label = f"{it.get('name')} [{it.get('pose')}] ({tag})"
        draw.text((px0 + 8, max(0, py0 - 24)), label, fill=color)

    img.save(vis_path, quality=90)
    print(f"[+] 调试标注可视化已保存至: {vis_path}")


if __name__ == "__main__":
    main()
