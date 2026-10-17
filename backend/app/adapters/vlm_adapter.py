"""
VLM Perception Adapter
Integrates Vision-Language Models (e.g. Qwen/Qwen3-VL-32B-Thinking via SiliconFlow)
to perform 2D visual grounding, 3D coordinate mapping, and object pose/orientation estimation
on desktop clutter photos.
"""

import os
import json
import base64
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from PIL import Image
import requests


# Pre-fabricated 3D models catalog defined by user (do NOT submit to Rodin)
PREFAB_KEYWORDS: Dict[str, List[str]] = {
    "mouse_pad": ["鼠标垫", "桌垫"],
    "mouse": ["鼠标"],
    "keyboard": ["键盘"],
    "tissue_box": ["纸巾盒", "纸巾包", "抽纸", "纸巾"],
    "cup": ["水杯", "杯子", "马克杯", "玻璃杯"],
    "stainless bottle": ["保温杯", "不锈钢", "水壶"],
    "phone": ["手机"],
    "charger": ["充电器", "充电头", "快充头", "适配器"],
    "monitor": ["显示器", "屏幕"],
    "laptop_fold": ["合盖笔记本", "闭合笔记本"],
    "laptop_expand": ["展开笔记本", "打开笔记本", "笔记本", "电脑"],
    "books_stack": ["一摞书", "书堆", "书籍", "课本", "教材"],
}

# Standard parts managed by other teammates (completely excluded from recognition)
EXCLUDED_STANDARD_PARTS = ["排插", "插排", "接线板"]

# Keywords indicating books / textbooks
BOOK_KEYWORDS = [
    "书", "课本", "教材", "书籍", "书本", "读物", "册子", "练习册", "作业本", 
    "本子", "记事本", "真题", "卷子", "试卷", "辅导", "字典", "杂志", "book"
]


def is_book_item(name: str) -> bool:
    """Checks whether an item is a book/textbook (excluding laptop/computer)."""
    name_lower = name.lower()
    if any(k in name_lower for k in ["电脑", "laptop", "pc", "mac"]):
        return False
    return any(k in name_lower for k in BOOK_KEYWORDS)


class VLMClient:
    """Client for VLM 2D grounding, object pose perception, and 3D coordinate mapping."""

    DEFAULT_DESK_BOUNDS = {
        "x_min": 0.410,
        "x_max": 1.450,
        "y_min": 0.085,
        "y_max": 0.585,
        "z_desk": 0.770,
    }

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.siliconflow.cn/v1",
        model: str = "Qwen/Qwen3-VL-32B-Thinking",
        timeout: int = 300,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.api_key = self._resolve_api_key(api_key)

    def _resolve_api_key(self, api_key: Optional[str]) -> str:
        if api_key and api_key.strip():
            return api_key.strip()
        env_key = os.environ.get("SILICONFLOW_API_KEY", "").strip()
        if env_key:
            return env_key
        candidate_paths = [
            Path("vlm/key.txt"),
            Path("key.txt"),
            Path("tests/key.txt"),
            Path(".env"),
            Path(__file__).resolve().parents[3] / "vlm" / "key.txt",
            Path(__file__).resolve().parents[3] / "key.txt",
            Path(__file__).resolve().parents[3] / "tests" / "key.txt",
            Path(__file__).resolve().parents[3] / ".env",
        ]
        for p in candidate_paths:
            if p.exists():
                c = p.read_text(encoding="utf-8").strip()
                if c:
                    return c
        raise ValueError("SiliconFlow API key not found. Please provide api_key or set in 'vlm/key.txt'.")

    @staticmethod
    def encode_image_base64(image_path: str | Path, max_dim: int = 1536) -> Tuple[str, Tuple[int, int]]:
        img = Image.open(image_path)
        orig_w, orig_h = img.size
        if max(orig_w, orig_h) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        temp_dir = Path(__file__).resolve().parents[3] / "vlm"
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp_path = temp_dir / "_temp_vlm_input.jpg"
        img.save(temp_path, format="JPEG", quality=85)
        with open(temp_path, "rb") as f:
            b64_str = base64.b64encode(f.read()).decode("utf-8")
        if temp_path.exists():
            temp_path.unlink()
        return b64_str, (orig_w, orig_h)

    @classmethod
    def match_prefab_model(cls, name: str, pose: str = "flat") -> Optional[str]:
        """
        Checks if detected item matches the user's pre-fabricated model catalog.
        Returns the prefab key (e.g. 'mouse', 'laptop_expand') or None if non-prefab.
        """
        name_lower = name.lower()
        # Handle laptop state specifically
        if "笔记本" in name or "电脑" in name or "laptop" in name_lower:
            if "合" in name or "闭" in name or pose == "flat":
                return "laptop_fold"
            return "laptop_expand"

        for key, kws in PREFAB_KEYWORDS.items():
            if key in ["laptop_fold", "laptop_expand"]:
                continue
            for kw in kws:
                if kw in name_lower:
                    return key
        return None

    @classmethod
    def resolve_prefab_rel_path(cls, prefab_key: str) -> str:
        """Finds matching model file in Prefabmodel directory supporting naming variations."""
        prefab_dir = Path(__file__).resolve().parents[3] / "Prefabmodel"
        candidates = [
            f"{prefab_key}.glb",
            f"{prefab_key.replace(' ', '_')}.glb",
            f"{prefab_key.replace('_', '')}.glb",
            f"{prefab_key.replace('expand', 'extend')}.glb",
            f"{prefab_key.replace('extend', 'expand')}.glb",
        ]
        for c in candidates:
            if (prefab_dir / c).exists():
                return f"Prefabmodel/{c}"
        return f"Prefabmodel/{prefab_key}.glb"

    @classmethod
    def bbox_to_desk_coords(
        cls,
        bbox_1000: List[int],
        desk_bounds: Optional[Dict[str, float]] = None,
    ) -> List[float]:
        """
        Maps normalized 2D bbox [xmin, ymin, xmax, ymax] (0~1000) to desk 3D [x, y, z].
        Observer sitting at chair (+Y) facing desk (-Y):
        - Left hand (+X) is towards wardrobe (X=1.450)
        - Right hand (-X) is towards drawer cabinet (X=0.410)
        Formula: x = 1.450 - u * (1.450 - 0.410)
        """
        bounds = desk_bounds or cls.DEFAULT_DESK_BOUNDS
        xmin, ymin, xmax, ymax = bbox_1000
        u = (xmin + xmax) / 2000.0
        v = ymax / 1000.0

        x_desk = bounds["x_max"] - u * (bounds["x_max"] - bounds["x_min"])
        y_desk = bounds["y_min"] + v * (bounds["y_max"] - bounds["y_min"])
        z_desk = bounds["z_desk"]
        return [round(x_desk, 3), round(y_desk, 3), round(z_desk, 3)]

    def generate_perception_prompt(self) -> str:
        """Constructs the standard VLM perception prompt with pose and direction detection."""
        return """你是一个专业的 3D 宿舍桌面整理与理线感知 AI。请分析这张桌面照片。

请按【桌面左侧区】 -> 【桌面中央主操作区】 -> 【桌面右侧供电与外设区】的顺序逐区扫描，找出所有物品。
请重点识别出：
1. 常用核心外设（笔记本、机械键盘、鼠标、鼠标垫、数位板/平板、显示器、手机等）；
2. 桌面日常杂物（纸巾包/盒、水杯/保温杯、卷尺、充电器等）。
注意：【排插】为固定标准件，由团队其他成员专门负责，本模块严禁识别或输出排插！

请特别标记每个物品的摆放姿态（是否躺着/立着）与朝向：
- pose: "flat" (躺平/平放在桌上) 或 "upright" (竖立/立着放置)
- facing: "user" (朝向坐在桌前的使用者), "away" (背向使用者/朝向墙壁), "left", "right"
对于笔记本电脑：若屏幕打开展开则标记为展开笔记本 (pose="upright")，若盖上则标记为合盖笔记本 (pose="flat")。

强制输出合法的 JSON，格式如下：
{
  "items": [
    {
      "id": "item_01",
      "name": "机械键盘",
      "category": "peripheral",
      "usage_frequency": "high",
      "pose": "flat",
      "facing": "user",
      "bbox_2d": [xmin, ymin, xmax, ymax],
      "estimated_size_m": [width, depth, height]
    }
  ]
}
其中 bbox_2d 为 0~1000 整数，xmin/ymin/xmax/ymax 分别为左/上/右/下边界。尺寸单位为米(m)。"""

    def perceive(self, image_path: str | Path) -> Dict[str, Any]:
        """
        Executes end-to-end VLM inference on an image:
        - Calls VLM for 2D grounding & pose detection
        - Filters out standard parts (power strip)
        - Matches against pre-fabricated model catalog vs Rodin dynamic generation
        - Calculates 3D desk coordinates
        """
        b64_img, (orig_w, orig_h) = self.encode_image_base64(image_path)
        prompt = self.generate_perception_prompt()

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"},
                        },
                    ],
                }
            ],
            "temperature": 0.2,
            "max_tokens": 4096,
        }

        resp = requests.post(
            f"{self.base_url}/chat/completions",
            json=payload,
            headers=headers,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        res_json = resp.json()

        content = res_json["choices"][0]["message"]["content"]
        if "```json" in content:
            clean_str = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            clean_str = content.split("```")[1].split("```")[0].strip()
        else:
            clean_str = content.strip()

        raw_data = json.loads(clean_str)
        raw_items = raw_data.get("items", [])

        book_items = []
        regular_items = []

        for it in raw_items:
            name = it.get("name", "")
            # 1. Skip excluded standard parts
            if any(k in name for k in EXCLUDED_STANDARD_PARTS):
                continue

            # 2. Check if item is a book/textbook
            if is_book_item(name):
                book_items.append(it)
            else:
                regular_items.append(it)

        processed_items = []

        # Process regular items
        for it in regular_items:
            name = it.get("name", "")
            pose = it.get("pose", "flat")
            prefab_key = self.match_prefab_model(name, pose=pose)
            if prefab_key:
                it["model_source"] = "prefab"
                it["prefab_key"] = prefab_key
                it["model_url"] = self.resolve_prefab_rel_path(prefab_key)
            else:
                it["model_source"] = "rodin"
                it["prefab_key"] = None
                it["model_url"] = f"objects/{it['id']}.glb"

            bbox = it.get("bbox_2d", [0, 0, 0, 0])
            it["current_pos"] = self.bbox_to_desk_coords(bbox)
            processed_items.append(it)

        # 3. User rule: 识别到是书统一不建模，无论有几本，最后都统一用一个一小摞书模型替代，绝不提交 Rodin
        if book_items:
            all_bboxes = [it.get("bbox_2d", [0, 0, 0, 0]) for it in book_items]
            agg_bbox = [
                min(b[0] for b in all_bboxes),
                min(b[1] for b in all_bboxes),
                max(b[2] for b in all_bboxes),
                max(b[3] for b in all_bboxes),
            ]
            agg_pos = self.bbox_to_desk_coords(agg_bbox)
            book_names = [it.get("name", "书") for it in book_items]
            print(f"[*] 触发书籍合并规则：识别到 {len(book_items)} 本书 ({', '.join(book_names)})，全部合并为一小摞书预制件 [books_stack]，禁止提交 Rodin 建模。")

            stack_item = {
                "id": "item_books_stack",
                "name": "一摞书",
                "category": "scattered",
                "usage_frequency": "medium",
                "pose": "flat",
                "facing": "user",
                "bbox_2d": agg_bbox,
                "estimated_size_m": [0.26, 0.19, 0.06],
                "model_source": "prefab",
                "prefab_key": "books_stack",
                "model_url": "Prefabmodel/books_stack.glb",
                "current_pos": agg_pos,
                "book_count": len(book_items),
            }
            processed_items.append(stack_item)

        return {
            "image_path": str(image_path),
            "image_size": [orig_w, orig_h],
            "items": processed_items,
        }
