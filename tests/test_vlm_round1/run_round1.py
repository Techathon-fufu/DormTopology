import os
import json
import base64
import time
import urllib.request
import urllib.error
from PIL import Image, ImageDraw, ImageFont

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
    
    # Resize preserving aspect ratio
    img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    resized_w, resized_h = img.size
    
    # Save to temp buffer for base64
    temp_path = os.path.join(VLM_DIR, "_temp_vlm_input.jpg")
    img.save(temp_path, format="JPEG", quality=85)
    
    with open(temp_path, "rb") as f:
        b64_str = base64.b64encode(f.read()).decode("utf-8")
        
    return b64_str, (orig_w, orig_h), (resized_w, resized_h)

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
    
    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(API_URL, data=req_data, headers=headers)
    
    start_time = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            elapsed = time.time() - start_time
            result = json.loads(resp.read().decode("utf-8"))
            return result, elapsed
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        raise RuntimeError(f"HTTP Error {e.code}: {err_msg}")

def run_round1():
    print("="*70)
    print("【第一轮测试：Baseline 开箱即用多模态 Grounding 识别】")
    print(f"调用模型: {MODEL_NAME}")
    print("="*70)
    
    api_key = load_api_key()
    b64_img, orig_size, resized_size = prepare_image(IMAGE_FILE, max_dim=1536)
    print(f"原图尺寸: {orig_size}, 缩放送测尺寸: {resized_size}")
    
    prompt = """你是一个高精度的 3D 空间与桌面整理感知 AI。请分析这张桌面照片中的所有物品。

请识别桌面上的每一个物品，并为每个物品输出以下字段：
1. name: 物品名称（中文）
2. category: 分类标签，只能是 "peripheral"（常用外设，如笔记本、键盘、鼠标、数位板）或 "clutter"（需收纳杂物，如水杯、卷尺、收纳盒、湿纸巾、散落插头等）
3. bbox_2d: 物体的 2D 矩形包围框 [xmin, ymin, xmax, ymax]，数值为 0 到 1000 的归一化整数坐标（xmin为左边界，ymin为上边界，xmax为右边界，ymax为下边界）
4. estimated_size_m: 物品的真实物理尺寸 [width, depth, height]（单位为米，如笔记本电脑约 [0.32, 0.23, 0.02]，鼠标约 [0.07, 0.12, 0.04]）

请严格输出合法的 JSON 格式，不要输出多余的解释文字，格式如下：
{
  "items": [
    {
      "name": "机械键盘",
      "category": "peripheral",
      "bbox_2d": [310, 550, 700, 720],
      "estimated_size_m": [0.32, 0.14, 0.035]
    }
  ]
}
"""
    print("\n正在向 SiliconFlow 发送请求，请稍候...")
    resp, elapsed = call_vlm(prompt, b64_img, api_key)
    print(f"请求成功！总耗时: {elapsed:.2f} 秒")
    
    choice = resp["choices"][0]
    message = choice["message"]
    reasoning = message.get("reasoning_content", "")
    content = message.get("content", "")
    
    print("\n--- [模型思维链 (Thinking Process 摘要)] ---")
    print(reasoning[:800] + ("..." if len(reasoning) > 800 else ""))
    
    print("\n--- [模型生成内容 (Raw Content)] ---")
    print(content)
    
    # Save raw response
    out_json_path = os.path.join(VLM_DIR, "round1_raw_result.json")
    with open(out_json_path, "w", encoding="utf-8") as f:
        json.dump(resp, f, ensure_ascii=False, indent=2)
        
    # Parse JSON from content
    clean_json_str = content
    if "```json" in clean_json_str:
        clean_json_str = clean_json_str.split("```json")[1].split("```")[0].strip()
    elif "```" in clean_json_str:
        clean_json_str = clean_json_str.split("```")[1].split("```")[0].strip()
        
    try:
        parsed_data = json.loads(clean_json_str)
        items = parsed_data.get("items", [])
        print(f"\n[OK] 成功解析出 {len(items)} 个物品:")
        
        # Draw on original image
        img_draw = Image.open(IMAGE_FILE).convert("RGB")
        draw = ImageDraw.Draw(img_draw)
        orig_w, orig_h = orig_size
        
        # Desk bounds for 3D coordinate mapping
        # X: [0.410, 1.450], Y: [0.085, 0.585], Z: 0.770
        print("\n" + "="*80)
        print(f"{'序号':4s} {'物品名称':12s} {'类别':12s} {'2D BBox [xmin,ymin,xmax,ymax]':30s} {'估计尺寸(m)':18s} {'3D 初始坐标 [x,y,z]'}")
        print("="*80)
        
        for idx, it in enumerate(items):
            bbox = it.get("bbox_2d", [0, 0, 0, 0])
            xmin, ymin, xmax, ymax = bbox
            # Denormalize to pixel
            px0 = int(xmin / 1000.0 * orig_w)
            py0 = int(ymin / 1000.0 * orig_h)
            px1 = int(xmax / 1000.0 * orig_w)
            py1 = int(ymax / 1000.0 * orig_h)
            
            # 3D coordinate calculation from bottom contact point
            u = (xmin + xmax) / 2000.0  # 0~1 left to right
            v = ymax / 1000.0           # 0~1 top (rear) to bottom (front)
            x_3d = 0.410 + u * 1.040
            y_3d = 0.085 + v * 0.500
            z_3d = 0.770
            it["current_pos"] = [round(x_3d, 3), round(y_3d, 3), round(z_3d, 3)]
            
            color = "#00FF00" if it.get("category") == "peripheral" else "#FF3333"
            draw.rectangle([px0, py0, px1, py1], outline=color, width=6)
            
            label = f"{idx+1}. {it.get('name')} ({it.get('category')})"
            draw.text((px0 + 10, max(0, py0 - 30)), label, fill=color)
            
            print(f"{idx+1:<4d} {it.get('name', 'N/A'):12s} {it.get('category', 'N/A'):12s} {str(bbox):30s} {str(it.get('estimated_size_m', [])):18s} {it['current_pos']}")
            
        vis_path = os.path.join(VLM_DIR, "round1_visualized.jpg")
        img_draw.save(vis_path, format="JPEG", quality=90)
        print(f"\n[OK] 可视化标注图已保存至: {vis_path}")
        
        parsed_out_path = os.path.join(VLM_DIR, "round1_parsed_items.json")
        with open(parsed_out_path, "w", encoding="utf-8") as f:
            json.dump(parsed_data, f, ensure_ascii=False, indent=2)
            
    except Exception as e:
        print("解析输出 JSON 异常:", e)

if __name__ == "__main__":
    run_round1()
