"""校验 Prefabmodel/ 下的模型资产路由与分层约定。

背景：全部 GLB 资产统一放在仓库根的 Prefabmodel/ 下，其中
- 低模 prefab：由 VLM 感知结果按关键词匹配，走 resolve_prefab_rel_path 路由；
- Rodin 真实资产：关键词无匹配时的回退产物，或重名高模（带 _detail 后缀），不参与路由。

本脚本锁定三件事：
1. PREFAB_KEYWORDS 的每个 key 都能解析到一个真实存在的文件；
2. 每个 prefab 目标文件确实是轻量低模（体积上限），避免高模误入路由；
3. _detail 高模与 Rodin 资产存在且不与 prefab 命名冲突。

运行：python tests/test_rodin_pipeline/test_prefab_routing.py
"""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.adapters.vlm_adapter import (  # noqa: E402
    ASSET_DIR_NAME,
    PREFAB_KEYWORDS,
    VLMClient,
)

PREFAB_DIR = PROJECT_ROOT / ASSET_DIR_NAME

# prefab 必须是轻量低模：当前最大的 mouse.glb 约 0.93 MB，留一倍余量。
# Rodin 高模（charger_detail 0.47MB / mousepad_detail 1.58MB / tablet 25MB）不得参与路由。
PREFAB_MAX_BYTES = 2 * 1024 * 1024

# 关键词无匹配时的回退资产（Rodin 生成），按约定位于同一目录但不参与 prefab 路由
RODIN_FALLBACK_ASSETS = [
    "power_strip.glb",
    "tablet.glb",
    "tape_measure.glb",
    "tissue_pack.glb",
]

# 同名双保真度资产：低模走 prefab，高模带 _detail 后缀
DETAIL_PAIRS = [
    ("charger.glb", "charger_detail.glb"),
    ("mousepad.glb", "mousepad_detail.glb"),
]


def check_prefab_keywords_resolve() -> list[str]:
    """每个 prefab key 必须解析到存在的文件，且该文件是轻量低模。"""
    errors: list[str] = []
    for key in PREFAB_KEYWORDS:
        rel = VLMClient.resolve_prefab_rel_path(key)
        path = PROJECT_ROOT / rel
        if not path.exists():
            errors.append(f"prefab key {key!r} resolved to missing file: {rel}")
            continue
        if path.stat().st_size > PREFAB_MAX_BYTES:
            errors.append(
                f"prefab key {key!r} resolved to an oversized asset ({rel}, "
                f"{path.stat().st_size} bytes) — high-poly assets must not be routed as prefabs"
            )
        print(f"[PASS] {key:18} -> {rel} ({path.stat().st_size:,} bytes)")
    return errors


def check_detail_assets() -> list[str]:
    """_detail 高模必须存在、确实更大，且不被任何 prefab key 路由到。"""
    errors: list[str] = []
    routed = {VLMClient.resolve_prefab_rel_path(k) for k in PREFAB_KEYWORDS}
    for low_name, detail_name in DETAIL_PAIRS:
        low = PREFAB_DIR / low_name
        detail = PREFAB_DIR / detail_name
        for p in (low, detail):
            if not p.exists():
                errors.append(f"expected asset missing: {p.relative_to(PROJECT_ROOT)}")
        if not (low.exists() and detail.exists()):
            continue
        if detail.stat().st_size <= low.stat().st_size:
            errors.append(
                f"{detail_name} should be the higher-fidelity tier but is not larger "
                f"than {low_name} ({detail.stat().st_size} <= {low.stat().st_size})"
            )
        if f"{ASSET_DIR_NAME}/{detail_name}" in routed:
            errors.append(f"{detail_name} must not be reachable from prefab keywords")
        print(
            f"[PASS] {low_name:22} {low.stat().st_size:>12,} bytes (prefab)  "
            f"| {detail_name:22} {detail.stat().st_size:>12,} bytes (detail)"
        )
    return errors


def check_rodin_fallback_assets() -> list[str]:
    """Rodin 回退资产存在，且不被 prefab 路由占用。"""
    errors: list[str] = []
    routed = {VLMClient.resolve_prefab_rel_path(k) for k in PREFAB_KEYWORDS}
    for name in RODIN_FALLBACK_ASSETS:
        path = PREFAB_DIR / name
        if not path.exists():
            errors.append(f"expected Rodin fallback asset missing: {path.relative_to(PROJECT_ROOT)}")
            continue
        if f"{ASSET_DIR_NAME}/{name}" in routed:
            errors.append(f"{name} is expected to be Rodin-only but is routed as a prefab")
        print(f"[PASS] {name:22} {path.stat().st_size:>12,} bytes (Rodin fallback)")
    return errors


def check_no_stray_glb_outside_asset_dir() -> list[str]:
    """除 Prefabmodel/ 外，仓库内不应出现其它 .glb（objects/ 只保留 Blender/OBJ 源文件）。"""
    errors: list[str] = []
    skip = {".git", "node_modules", "dist", ".work"}
    for p in PROJECT_ROOT.rglob("*.glb"):
        if any(part in skip for part in p.relative_to(PROJECT_ROOT).parts):
            continue
        if p.parent == PREFAB_DIR:
            continue
        errors.append(f"GLB outside {ASSET_DIR_NAME}/: {p.relative_to(PROJECT_ROOT)}")
    if not errors:
        print(f"[PASS] all .glb assets live under {ASSET_DIR_NAME}/")
    return errors


def main() -> int:
    print(f"Validating model asset layout in {ASSET_DIR_NAME}/ ...")
    if not PREFAB_DIR.is_dir():
        print(f"[FAIL] asset directory not found: {PREFAB_DIR}")
        return 1

    errors: list[str] = []
    for check in (
        check_prefab_keywords_resolve,
        check_detail_assets,
        check_rodin_fallback_assets,
        check_no_stray_glb_outside_asset_dir,
    ):
        errors.extend(check())

    if errors:
        print("\n[FAIL] asset routing checks failed:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"\n[SUCCESS] {len(PREFAB_KEYWORDS)} prefab keys resolve to lightweight assets; "
          "detail tiers and Rodin fallbacks present; no stray GLB outside the asset directory.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
