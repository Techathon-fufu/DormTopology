"""Architecture regressions for the pure domain and legacy routing facade."""

import importlib
import json
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from backend.examples.packing_demo import demo_scene


class DomainBoundaryTests(unittest.TestCase):
    def test_complete_scene_runs_with_only_domain_and_standard_library(self):
        backend_root = Path(__file__).resolve().parents[1]
        script = textwrap.dedent(
            """
            import copy
            import importlib.abc
            import json
            import sys

            blocked = (
                "algorithm", "fastapi", "starlette", "sqlite3", "sqlalchemy",
                "requests", "httpx", "aiohttp", "urllib", "socket",
                "rodin", "hyper3d", "backend.app.api", "backend.app.service",
                "backend.app.db", "backend.app.adapters", "backend.examples",
                "backend.tests",
            )

            class DomainOnlyImports(importlib.abc.MetaPathFinder):
                def find_spec(self, fullname, path=None, target=None):
                    if any(fullname == name or fullname.startswith(name + ".")
                           for name in blocked):
                        raise AssertionError("Domain imported " + fullname)
                    return None

            for name in tuple(sys.modules):
                if any(name == prefix or name.startswith(prefix + ".")
                       for prefix in blocked):
                    del sys.modules[name]
            sys.meta_path.insert(0, DomainOnlyImports())
            sys.path.insert(0, sys.argv[1])
            from backend.app.domain.packing import (
                measure_free_area, plan_packing, validate_layout,
            )
            from backend.app.domain.routing import plan_routing

            scene = json.load(sys.stdin)
            original = copy.deepcopy(scene)

            def prohibit_io(event, args):
                if event in {"open", "socket.__new__", "sqlite3.connect"}:
                    raise AssertionError("Domain attempted I/O: " + event)

            sys.addaudithook(prohibit_io)
            packing = plan_packing(scene)
            assert packing["status"] == "success", packing
            assert scene == original, "Packing mutated its input"
            assert len(packing["items"]) == len(scene["items"])
            assert packing["scene_revision"] == scene["scene_revision"]

            preview = copy.deepcopy(scene)
            targets = {item["item_id"]: item for item in packing["items"]}
            for item in preview["items"]:
                target = targets[item["id"]]
                item["position"] = target["target_pos"]
                item["rotation_y_rad"] = target["target_rotation_y_rad"]
            preview["scene_revision"] += 1
            current = copy.deepcopy(preview)
            check = validate_layout(preview)
            assert check["geometry_valid"], check
            before = measure_free_area(scene)
            after = measure_free_area(preview)
            assert after >= before

            routing = plan_routing(preview)
            assert len(routing["cables"]) == len(preview["cables"]) == 3
            assert routing["scene_id"] == preview["scene_id"]
            assert routing["scene_revision"] == preview["scene_revision"]
            assert routing["status"] in {"success", "partial", "infeasible"}
            assert preview == current, "Domain checks or routing mutated input"
            assert scene == original, "Domain checks mutated the baseline"
            json.dumps({"packing": packing, "routing": routing}, allow_nan=False)
            print(json.dumps({"packing": packing["status"],
                              "routing_cables": len(routing["cables"])}))
            """
        )
        with tempfile.TemporaryDirectory() as isolated_root:
            app_root = Path(isolated_root) / "backend" / "app"
            app_root.mkdir(parents=True)
            (app_root.parent / "__init__.py").touch()
            (app_root / "__init__.py").touch()
            shutil.copytree(
                backend_root / "app" / "domain",
                app_root / "domain",
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
            completed = subprocess.run(
                [sys.executable, "-I", "-S", "-B", "-c", script, isolated_root],
                input=json.dumps(demo_scene(), allow_nan=False),
                capture_output=True,
                text=True,
                cwd=isolated_root,
                timeout=60,
                check=False,
            )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(
            json.loads(completed.stdout),
            {"packing": "success", "routing_cables": 3},
        )

    def test_all_legacy_public_exports_are_domain_objects(self):
        domain = importlib.import_module("backend.app.domain.routing")
        legacy = importlib.import_module("algorithm.cable_routing")
        legacy_planner = importlib.import_module("algorithm.cable_routing.planner")
        for name in legacy.__all__:
            with self.subTest(module="planner", name=name):
                self.assertIs(getattr(legacy, name), getattr(domain, name))
                self.assertIs(getattr(legacy_planner, name), getattr(domain, name))
        self.assertIs(domain.plan_routes, domain.plan_routing)

        legacy_geometry = importlib.import_module("algorithm.cable_routing.geometry")
        domain_geometry = importlib.import_module("backend.app.domain.routing.geometry")
        for name in legacy_geometry.__all__:
            with self.subTest(module="geometry", name=name):
                self.assertIs(
                    getattr(legacy_geometry, name), getattr(domain_geometry, name)
                )
