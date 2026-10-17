"""从 Prefabmodel/*.glb 生成物品碰撞体，输出到 Prefabmodel/colliders/。

范围：**物品（单品）**。桌体与抽屉属于场景固定结构，不在此脚本内表达
（契约 2.2：`compound` 只描述物品自身凸体；固定家具按 `obstacles[]` 表达）。

契约对齐（docs/data_contract.md 第 1 节、2.2 节）：
- 输出结构：`{type:"compound", parts:[{vertices_m:[[x,y,z]...], faces:[[i,j,k]...]}]}`
  该结构同时被前端 `exportCollision` 与后端 `validate_compound` 接受，
  因此产出是跨端通用的，不是某一种语言的私有格式。
- 坐标：米、右手 Y-up、物品局部坐标、底面中心锚点。
- 约束：parts 1..128；每 part 4..128 顶点、4..256 三角形；坐标有限；
  面外向一致定向、闭合流形、体积为正。

提取策略（逐个模型经实测确定，不是猜测）：
- `convex`（路线 A）：逐网格凸包。忠实于模型自身形状；对凸体网格（如纯盒）为精确值。
  保留部件之间的空隙，符合契约「不允许看得见的是 A、算碰撞的是 B」。
- `aabb`（路线 B）：整体轴对齐包围盒。仅用于部件数过多、且单件物品场景够用的模型：
  `keyboard.glb`（93 个网格）、`mouse.glb`（31 个网格）—— 逐件凸包会让 SAT 代价升一个量级。

用法：
    python backend/scripts/generate_colliders.py            # 生成
    python backend/scripts/generate_colliders.py --check    # 仅校验已生成结果
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import trimesh

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

ASSET_DIR = PROJECT_ROOT / "Prefabmodel"
COLLIDER_DIR = ASSET_DIR / "collisionsize"

# 契约容差（docs/data_contract.md 2.2）
TOLERANCE = 1e-7

# 不生成物品碰撞体的模型：桌体与抽屉是场景固定结构，按 obstacles[] 表达。
EXCLUDED = {
    "dormdesk.glb",
    "drawer_bottom.glb",
    "drawer_middle.glb",
    "drawer_top.glb",
}

# 提取策略覆盖（默认为 convex）
STRATEGY: dict[str, str] = {
    "keyboard.glb": "aabb",
    "mouse.glb": "aabb",
}


@dataclass
class Part:
    vertices: list[list[float]]
    faces: list[list[int]]


@dataclass
class ModelCollider:
    name: str
    strategy: str
    parts: list[Part] = field(default_factory=list)
    source_parts: int = 0
    notes: list[str] = field(default_factory=list)


def box_part(minv: list[float], maxv: list[float]) -> Part:
    """轴对齐盒体 -> 8 顶点 / 12 三角形闭合凸体（外法向，右手定则）。"""
    x0, y0, z0 = minv
    x1, y1, z1 = maxv
    v = [
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ]
    f = [
        [0, 2, 1], [0, 3, 2],   # z0 面
        [4, 5, 6], [4, 6, 7],   # z1 面
        [0, 1, 5], [0, 5, 4],   # y0 面
        [3, 7, 6], [3, 6, 2],   # y1 面
        [0, 4, 7], [0, 7, 3],   # x0 面
        [1, 2, 6], [1, 6, 5],   # x1 面
    ]
    return Part(v, f)


def convex_part(mesh: trimesh.Trimesh) -> Part | None:
    """单网格 -> 凸包 -> 契约格式。凸包保证闭合、外法向、正体积。"""
    try:
        hull = mesh.convex_hull
    except Exception:
        return None
    if hull is None or len(hull.vertices) < 4 or len(hull.faces) < 4:
        return None
    verts = [[float(x) for x in p] for p in hull.vertices]
    faces = [[int(i) for i in t] for t in hull.faces]
    # 契约上限：每 part 4..128 顶点、4..256 面
    if len(verts) > 128 or len(faces) > 256:
        return None
    return Part(verts, faces)


def finite_mesh(g) -> trimesh.Trimesh | None:
    """剔除含 NaN 的顶点与三角形，返回可用的 Trimesh。"""
    v = np.asarray(g.vertices, dtype=float)
    f = np.asarray(g.faces, dtype=int)
    fin = np.isfinite(v).all(axis=1)
    if not fin.all():
        f = f[fin[f].all(axis=1)] if len(f) else f
        v = v[fin]
    if len(f) == 0 or len(v) < 4:
        return None
    try:
        return trimesh.Trimesh(vertices=v, faces=f, process=True)
    except Exception:
        return None


def build_aabb(name: str, scene) -> ModelCollider:
    m = ModelCollider(name=name, strategy="aabb")
    geoms = scene.geometry if isinstance(scene, trimesh.Scene) else {"__single__": scene}
    m.source_parts = len(geoms)
    lo = np.array([np.inf] * 3)
    hi = np.array([-np.inf] * 3)
    for g in geoms.values():
        v = np.asarray(g.vertices, dtype=float)
        fin = v[np.isfinite(v).all(axis=1)]
        if len(fin) == 0:
            continue
        lo = np.minimum(lo, fin.min(axis=0))
        hi = np.maximum(hi, fin.max(axis=0))
    if not np.isfinite(lo).all():
        m.notes.append("no finite vertices; AABB skipped")
        return m
    m.parts.append(box_part(lo.tolist(), hi.tolist()))
    m.notes.append(f"AABB of {m.source_parts} source parts -> 1 box (route B)")
    return m


def build_convex(name: str, scene) -> ModelCollider:
    m = ModelCollider(name=name, strategy="convex")
    geoms = scene.geometry if isinstance(scene, trimesh.Scene) else {"__single__": scene}
    m.source_parts = len(geoms)
    for gname, g in geoms.items():
        v = np.asarray(g.vertices, dtype=float)
        fin = np.isfinite(v).all(axis=1)
        if not fin.all():
            m.notes.append(f"{gname}: dropped {int((~fin).sum())} NaN vertices")
        mesh = finite_mesh(g)
        if mesh is None:
            continue
        p = convex_part(mesh)
        if p:
            m.parts.append(p)
    m.notes.append(f"{m.source_parts} source parts -> {len(m.parts)} convex parts (route A)")
    return m


def collider_payload(m: ModelCollider) -> dict:
    return {
        "type": "compound",
        "parts": [{"vertices_m": p.vertices, "faces": p.faces} for p in m.parts],
    }


def generate() -> int:
    files = sorted(ASSET_DIR.glob("*.glb"))
    models: list[ModelCollider] = []
    for p in files:
        if p.name in EXCLUDED:
            continue
        strat = STRATEGY.get(p.name, "convex")
        scene = trimesh.load(str(p))
        m = build_aabb(p.name, scene) if strat == "aabb" else build_convex(p.name, scene)
        models.append(m)

    COLLIDER_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema": "dormtopology.colliders/1",
        "scope": "items only (room fixtures such as desk and drawers are expressed by obstacles[])",
        "unit": "m",
        "up": "y",
        "anchor": "bottom-center (local coords)",
        "tolerance": TOLERANCE,
        "models": {},
    }
    for m in models:
        out = COLLIDER_DIR / f"{Path(m.name).stem}.collision.json"
        out.write_text(json.dumps(collider_payload(m), ensure_ascii=False, indent=1), encoding="utf-8")
        manifest["models"][m.name] = {
            "file": out.name,
            "source_glb": m.name,
            "strategy": m.strategy,
            "source_parts": m.source_parts,
            "collider_parts": len(m.parts),
            "vertices": sum(len(x.vertices) for x in m.parts),
            "faces": sum(len(x.faces) for x in m.parts),
            **({"notes": m.notes} if m.notes else {}),
        }
    (COLLIDER_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"generated {len(models)} item colliders -> {COLLIDER_DIR.relative_to(PROJECT_ROOT)}")
    for m in models:
        print(f"  {m.name:24} {m.strategy:7} parts={len(m.parts):3}")
    return 0


def check() -> int:
    """用后端契约校验器复核已生成的碰撞体。"""
    from backend.app.domain.geometry.convex import validate_compound

    files = sorted(COLLIDER_DIR.glob("*.collision.json"))
    if not files:
        print("no collider files found")
        return 1
    fail = 0
    for p in files:
        payload = json.loads(p.read_text(encoding="utf-8"))
        try:
            validate_compound(payload)
        except Exception as e:  # noqa: BLE001
            print(f"FAIL {p.name}: {type(e).__name__}: {e}")
            fail += 1
        else:
            print(f"PASS {p.name}")
    print(f"\n{len(files) - fail} passed, {fail} failed")
    return 0 if fail == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="生成物品碰撞体")
    ap.add_argument("--check", action="store_true", help="仅校验已生成结果")
    args = ap.parse_args()
    return check() if args.check else generate()


if __name__ == "__main__":
    raise SystemExit(main())
