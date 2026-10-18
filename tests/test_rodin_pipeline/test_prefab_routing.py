"""校验 Prefabmodel/ 下的模型资产路由与分层约定。

背景：Git 跟踪的归档 GLB 资产放在仓库根的 Prefabmodel/ 下，其中
- 低模 prefab：由 VLM 感知结果按关键词匹配，走 resolve_prefab_rel_path 路由；
- Rodin 真实资产：关键词无匹配时的回退产物，或重名高模（带 _detail 后缀），不参与路由。

本脚本锁定四件事：
1. PREFAB_KEYWORDS 的每个 key 都能解析到一个真实存在的文件；
2. 每个 prefab 目标文件确实是轻量低模（体积上限），避免高模误入路由；
3. _detail 高模与 Rodin 资产存在且不与 prefab 命名冲突。
4. 已跟踪 GLB 仅位于归档目录或 frontend/public/ 运行时目录；本地未跟踪导出不参与检查。

运行：python tests/test_rodin_pipeline/test_prefab_routing.py
"""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path, PurePosixPath

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.adapters.vlm_adapter import (
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


def check_no_stray_glb_outside_asset_dir(project_root: Path = PROJECT_ROOT) -> list[str]:
    """归档约束仅检查 Git 跟踪资产，允许 frontend/public/ 运行时 GLB。"""
    try:
        tracked = subprocess.run(
            ["git", "ls-files", "-z", "--", "*.glb"],
            cwd=project_root,
            capture_output=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        return [f"Unable to list tracked GLB assets with Git: {exc}"]
    errors: list[str] = []
    for name in tracked.stdout.split(b"\0"):
        if not name:
            continue
        path = PurePosixPath(os.fsdecode(name))
        if path.parts[0] == ASSET_DIR_NAME or path.parts[:2] == ("frontend", "public"):
            continue
        errors.append(f"Tracked GLB outside {ASSET_DIR_NAME}/ or frontend/public/: {path}")
    if not errors:
        print(f"[PASS] tracked .glb assets live under {ASSET_DIR_NAME}/ or frontend/public/")
    return errors


class AssetLayoutScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(["git", "init", "--quiet"], cwd=self.root, check=True, capture_output=True)

    def stage_asset(self, relative: str):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"layout-only fixture")
        subprocess.run(["git", "add", "--", relative], cwd=self.root, check=True, capture_output=True)

    def test_untracked_local_glb_is_not_an_archived_asset(self):
        local = self.root / "objects" / "dormdesk.glb"
        local.parent.mkdir()
        local.write_bytes(b"untracked local export")
        self.assertEqual(check_no_stray_glb_outside_asset_dir(self.root), [])
        self.assertTrue(local.exists())

    def test_tracked_archives_and_runtime_glb_are_allowed(self):
        self.stage_asset(f"{ASSET_DIR_NAME}/fixture.glb")
        self.stage_asset(f"{ASSET_DIR_NAME}/dormdesk_parts/fixture.glb")
        self.stage_asset("frontend/public/models/runtime.glb")
        self.stage_asset("frontend/public/generated/模型 export.glb")
        self.assertEqual(check_no_stray_glb_outside_asset_dir(self.root), [])

    def test_tracked_glb_in_source_directory_is_rejected(self):
        self.stage_asset("objects/stray.glb")
        errors = check_no_stray_glb_outside_asset_dir(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn("objects/stray.glb", errors[0])

    def test_git_enumeration_failure_is_not_a_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            errors = check_no_stray_glb_outside_asset_dir(Path(directory))
        self.assertEqual(len(errors), 1)
        self.assertIn("Unable to list tracked GLB assets with Git", errors[0])


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
          "detail tiers and Rodin fallbacks present; tracked GLB locations are valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
