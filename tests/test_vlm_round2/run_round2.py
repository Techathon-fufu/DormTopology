import os
import json
import base64
import time
import urllib.request
import urllib.error
from PIL import Image, ImageDraw

VLM_DIR = r"D:\DormTopology\vlm"
KEY_FILE = os.path.join(VLM_DIR, "key.txt")
IMAGE_FILE = os.path.join(VLM_DIR, "testimage_0001.jpg")
API_URL = "https://api.siliconflow.cn/v1/chat/completions"
MODEL_NAME = "Qwen/Qwen3-VL-32B-Thinking"

def load_api_key():
    with open(KEY_FILE, "r", encoding="utf-8") as f:
        return f.read().strip()

def prepare_image(image_path, max_dim=1536):
    img = Image.open(image_path)
    orig_w, orig_h = img.size
    img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    temp_path = os.path.join(VLM_DIR, "_temp_vlm_input.jpg")
    img.save(temp_path, format="JPEG", quality=85)
    with open(temp_path, "rb") as f:
        b64_str = base64.b64encode(f.read()).decode("utf-8")
    return b64_str, (orig_w, orig_h)

def call_vlm(prompt, b64_image, api_key):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{b64_image}"
                        }
                    }
                ]
            }
        ],
        "temperature": 0.2,
        "max_tokens": 4096
    }
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode("utf-8"), headers=headers)
    start_time = time.time()
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            elapsed = time.time() - start_time
            return json.loads(resp.read().decode("utf-8")), elapsed
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")

def crop_item_from_bbox(image_path, bbox_1000, save_path, pad=0.05):
    """根据 bbox_2d [xmin, ymin, xmax, ymax] (0~1000) 自动裁剪高精切片供 3D 生模使用"""
    img = Image.open(image_path)
    w, h = img.size
    xmin, ymin, xmax, ymax = bbox_1000
    bw, bh = xmax - xmin, ymax - ymin
    left = max(0, int((xmin - bw * pad) / 1000.0 * w))
    top = max(0, int((ymin - bh * pad) / 1000.0 * h))
    right = min(w, int((xmax + bw * pad) / 1000.0 * w))
    bottom = min(h, int((ymax + bh * pad) / 1000.0 * h))
    cropped = img.crop((left, top, right, bottom))
    cropped.save(save_path)
    return cropped.size

def run_round2():
    print("="*70, flush=True)
    print("【第二轮测试：空间分区扫描 + 宿舍理线数据契约对齐 + 自动后置切图】", flush=True)
    print(f"调用模型: {MODEL_NAME}", flush=True)
    print("="*70, flush=True)
    
    api_key = load_api_key()
    b64_img, orig_size = prepare_image(IMAGE_FILE, max_dim=1536)
    
    prompt = """你是一个专业的 3D 宿舍桌面整理与理线感知 AI。请分析这张桌面照片。

请按【桌面左侧区】 -> 【桌面中央主操作区】 -> 【桌面右侧供电与外设区】的顺序逐区扫描，找出所有物品。
请重点识别出：
1. 常用核心外设（笔记本、机械键盘、鼠标、鼠标垫、数位板/平板）；
2. 供电设备与充电桩（排插、充电器插头）；
3. 散落杂物（卷尺、纸巾包等）。

请精简思考过程，直接结合键盘（长约 32cm）等尺寸基准推算各物品实际尺寸。
强制输出合法的 JSON，格式如下：
{
  "items": [
    {
      "id": "item_01",
      "name": "机械键盘",
      "category": "peripheral",
      "usage_frequency": "high",
      "bbox_2d": [xmin, ymin, xmax, ymax],
      "estimated_size_m": [width, depth, height]
    }
  ]
}
其中 bbox_2d 为 0~1000 整数，xmin/ymin/xmax/ymax 分别为左/上/右/下边界。
"""
    print("\n正在向 SiliconFlow 发送第二轮请求...")
    resp, elapsed = call_vlm(prompt, b64_img, api_key)
    print(f"第二轮请求成功！耗时: {elapsed:.2f} 秒")
    
    choice = resp["choices"][0]
    message = choice["message"]
    reasoning = message.get("reasoning_content", "")
    content = message.get("content", "")
    
    print("\n--- [第二轮思维链 (Thinking Process 摘要)] ---")
    print(reasoning[:800] + ("..." if len(reasoning) > 800 else ""))
    
    # Save raw result
    with open(os.path.join(VLM_DIR, "round2_raw_result.json"), "w", encoding="utf-8") as f:
        json.dump(resp, f, ensure_ascii=False, indent=2)
        
    clean_json_str = content
    if "```json" in clean_json_str:
        clean_json_str = clean_json_str.split("```json")[1].split("```")[0].strip()
    elif "```" in clean_json_str:
        clean_json_str = clean_json_str.split("```")[1].split("```")[0].strip()
        
    parsed_data = json.loads(clean_json_str)
    items = parsed_data.get("items", [])
    print(f"\n[OK] 第二轮成功解析出 {len(items)} 个物品:")
    
    # Draw visualization
    img_draw = Image.open(IMAGE_FILE).convert("RGB")
    draw = ImageDraw.Draw(img_draw)
    orig_w, orig_h = orig_size
    
    print("\n" + "="*85)
    print(f"{'ID':8s} {'名称':12s} {'类别':12s} {'频次':8s} {'2D BBox':28s} {'尺寸 [w,d,h]':18s} {'3D 坐标 [x,y,z]'}")
    print("="*85)
    
    for it in items:
        bbox = it.get("bbox_2d", [0, 0, 0, 0])
        xmin, ymin, xmax, ymax = bbox
        px0 = int(xmin / 1000.0 * orig_w)
        py0 = int(ymin / 1000.0 * orig_h)
        px1 = int(xmax / 1000.0 * orig_w)
        py1 = int(ymax / 1000.0 * orig_h)
        
        # 3D coordinate mapping
        u = (xmin + xmax) / 2000.0
        v = ymax / 1000.0
        x_3d = 0.410 + u * 1.040
        y_3d = 0.085 + v * 0.500
        z_3d = 0.770
        it["current_pos"] = [round(x_3d, 3), round(y_3d, 3), round(z_3d, 3)]
        
        cat = it.get("category", "")
        color = "#00E5FF" if cat == "peripheral" else "#FF5252"
        draw.rectangle([px0, py0, px1, py1], outline=color, width=6)
        label = f"{it.get('name')} ({cat})"
        draw.text((px0 + 10, max(0, py0 - 28)), label, fill=color)
        
        print(f"{it.get('id',''):8s} {it.get('name',''):12s} {cat:12s} {it.get('usage_frequency',''):8s} {str(bbox):28s} {str(it.get('estimated_size_m',[])):18s} {it['current_pos']}")
        
    vis_path = os.path.join(VLM_DIR, "round2_visualized.jpg")
    img_draw.save(vis_path, format="JPEG", quality=90)
    print(f"\n[OK] 第二轮可视化标注图已保存至: {vis_path}")
    
    # Save standard vlm_result_round2.json
    out_json = os.path.join(VLM_DIR, "vlm_result_round2.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(parsed_data, f, ensure_ascii=False, indent=2)
    print(f"[OK] 标准结构化数据已保存至: {out_json}")
    
    # Test 3-line crop function on 2 representative items (e.g. 卷尺 and 机械键盘 or 充电器)
    print("\n" + "="*70)
    print("【测试后置自动切图功能 (供 Rodin 3D 资产生成使用)】")
    print("="*70)
    crop_dir = os.path.join(VLM_DIR, "crops")
    os.makedirs(crop_dir, exist_ok=True)
    
    for it in items:
        name = it.get("name", "")
        if any(k in name for k in ["卷尺", "充电器", "鼠标", "湿纸巾"]):
            save_name = f"crop_{it.get('id')}_{name}.png"
            save_path = os.path.join(crop_dir, save_name)
            csize = crop_item_from_bbox(IMAGE_FILE, it["bbox_2d"], save_path, pad=0.06)
            print(f"成功裁切高精单品资产图: {save_name} (分辨率: {csize[0]}x{csize[1]})")

if __name__ == "__main__":
    run_round2()
