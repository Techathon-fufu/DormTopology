"""Versioned scene orchestration with packing, routing and guide generation."""

from __future__ import annotations

import copy
import threading
import uuid
from typing import Callable, Protocol

from ..domain import rules
from ..domain.errors import SceneInputError
from ..domain.packing import measure_free_area, plan_packing, validate_layout
from ..domain.routing import plan_routing
from ..domain.geometry import aabb_from_zone
from ..domain.routing.geometry import exposed_polyline_length, point
from . import ports as port_helpers
from .ports import StoreConflict


class Store(Protocol):
    def load(self, scene_id: str) -> dict | None: ...
    def insert(self, document: dict) -> None: ...
    def compare_and_swap(self, scene_id, expected_revision, document,
                         base_document=None) -> None: ...


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


_RESULTS = ("packing_result", "routing_result", "comparison", "guide", "guide_md")


def _blank_artifacts(doc: dict) -> None:
    for key in _RESULTS:
        doc[key] = None
    doc["packing_history"] = doc.get("packing_history") or []


class SceneService:
    def __init__(
        self,
        store: Store,
        template_loader: Callable[[], dict] | None = None,
        *,
        packing: Callable[[dict], dict] = plan_packing,
        routing: Callable[[dict], dict] = plan_routing,
        layout_validator: Callable[[dict], dict] = validate_layout,
        free_area: Callable[[dict], float] = measure_free_area,
        max_concurrent_compute: int = 2,
    ):
        self._store = store
        self._template_loader = template_loader
        self._packing = packing
        self._routing = routing
        self._validate_layout = layout_validator
        self._free_area = free_area
        self._semaphore = threading.BoundedSemaphore(max_concurrent_compute)

    # -- helpers -------------------------------------------------------------
    def _compute(self, fn, *args, **kwargs):
        if not self._semaphore.acquire(blocking=False):
            raise ServiceError(503, "busy", "too many concurrent planning requests")
        try:
            return fn(*args, **kwargs)
        except SceneInputError as error:
            raise ServiceError(400, error.code, str(error)) from error
        finally:
            self._semaphore.release()

    def _require(self, scene_id: str) -> dict:
        doc = self._store.load(scene_id)
        if doc is None:
            raise ServiceError(404, "not_found", f"unknown scene {scene_id}")
        return doc

    def _validate(self, scene: dict, *, for_planning: bool) -> None:
        try:
            rules.validate_scene(scene, for_planning=for_planning)
        except SceneInputError as error:
            code = getattr(error, "code", "invalid_input")
            raise ServiceError(400, code, str(error)) from error
        except ValueError as error:
            raise ServiceError(400, "invalid_input", str(error)) from error

    def _swap(self, scene_id: str, base: dict, new: dict) -> None:
        try:
            self._store.compare_and_swap(
                scene_id, base["scene"]["scene_revision"], new, base_document=base
            )
        except StoreConflict as error:
            raise ServiceError(409, "version_conflict", "stale document") from error

    def _scene_of(self, doc: dict) -> dict:
        return doc["scene"]

    # -- documents -----------------------------------------------------------
    def document(self, scene_id: str) -> dict:
        doc = self._require(scene_id)
        scene = self._scene_of(doc)
        guide = doc.get("guide")
        if guide is not None and guide.get("scene_revision") != scene["scene_revision"]:
            guide = None
        return {
            "scene": scene,
            "baseline": doc.get("baseline"),
            "packing_result": _current(doc, "packing_result", scene),
            "routing_result": _current(doc, "routing_result", scene),
            "comparison": doc.get("comparison") if (
                doc.get("comparison") or {}
            ).get("scene_revision") == scene["scene_revision"] else None,
            "guide": guide,
            "photo_url": scene.get("photo_url"),
        }

    # -- scene lifecycle -----------------------------------------------------
    def create_scene(self, scene: dict | None) -> dict:
        if scene is None:
            if self._template_loader is None:
                raise ServiceError(400, "invalid_input", "no scene or template")
            candidate = copy.deepcopy(self._template_loader())
        else:
            if not isinstance(scene, dict):
                raise ServiceError(400, "invalid_input", "scene must be an object")
            candidate = copy.deepcopy(scene)
        self._validate(candidate, for_planning=False)
        candidate["scene_id"] = str(uuid.uuid4())
        candidate["scene_revision"] = 1
        candidate["baseline_id"] = None
        candidate["photo_url"] = None
        doc = {"scene": candidate, "baseline": None}
        _blank_artifacts(doc)
        self._store.insert(doc)
        return self.document(candidate["scene_id"])

    def get_scene(self, scene_id: str) -> dict:
        return self.document(scene_id)

    def update_scene(self, scene_id: str, payload: dict) -> dict:
        if not isinstance(payload, dict):
            raise ServiceError(400, "invalid_input", "body must be an object")
        expected = payload.get("expected_revision")
        if isinstance(expected, bool) or not isinstance(expected, int):
            raise ServiceError(400, "invalid_input", "expected_revision required")
        incoming = payload.get("scene")
        if not isinstance(incoming, dict):
            raise ServiceError(400, "invalid_input", "scene required")
        if incoming.get("scene_id") != scene_id:
            raise ServiceError(400, "invalid_input", "scene_id mismatch")
        if incoming.get("scene_revision") != expected:
            raise ServiceError(400, "invalid_input", "scene_revision mismatch")
        self._validate(incoming, for_planning=False)

        doc = self._require(scene_id)
        current = self._scene_of(doc)
        if current["scene_revision"] != expected:
            raise ServiceError(409, "version_conflict", "scene revision is stale")

        updated = copy.deepcopy(incoming)
        updated["baseline_id"] = current.get("baseline_id")
        updated["scene_revision"] = current["scene_revision"] + 1
        updated["photo_url"] = current.get("photo_url")
        self._apply_confirmation_rules(current, updated)

        new_doc = copy.deepcopy(doc)
        new_doc["scene"] = updated
        _blank_artifacts(new_doc)
        self._swap(scene_id, doc, new_doc)
        return self.document(scene_id)

    def _apply_confirmation_rules(self, previous: dict, current: dict) -> None:
        old_items = {item["id"]: item for item in previous["items"]}
        for item in current["items"]:
            old = old_items.get(item["id"])
            if old is None:
                item["dimensions_confirmed"] = False
                for port in item["ports"]:
                    port["confirmed"] = False
                continue
            item["dimensions_confirmed"] = old["dimensions_confirmed"]
            old_ports = {port["id"]: port for port in old["ports"]}
            for port in item["ports"]:
                port["confirmed"] = old_ports.get(port["id"], {}).get("confirmed", False)
            if _vector_changed(old.get("size_m"), item.get("size_m")):
                item["dimensions_confirmed"] = False
                for port in item.get("ports", []):
                    port["confirmed"] = False
        changed_ports = port_helpers.reconcile_ports(previous, current)
        if changed_ports:
            for item in current["items"]:
                for port in item.get("ports", []):
                    if port["id"] in changed_ports:
                        port["confirmed"] = False

    # -- baseline ------------------------------------------------------------
    def create_baseline(self, scene_id: str, expected_revision: int) -> dict:
        doc = self._require(scene_id)
        current = self._scene_of(doc)
        if current["scene_revision"] != expected_revision:
            raise ServiceError(409, "version_conflict", "scene revision is stale")

        snapshot = copy.deepcopy(current)
        for item in snapshot["items"]:
            item["dimensions_confirmed"] = True
            for port in item.get("ports", []):
                port["confirmed"] = True
        baseline_id = str(uuid.uuid4())
        snapshot["baseline_id"] = baseline_id
        self._validate(snapshot, for_planning=False)

        updated = copy.deepcopy(current)
        for item in updated["items"]:
            item["dimensions_confirmed"] = True
            for port in item.get("ports", []):
                port["confirmed"] = True
        updated["baseline_id"] = baseline_id
        updated["scene_revision"] = current["scene_revision"] + 1

        new_doc = copy.deepcopy(doc)
        new_doc["scene"] = updated
        new_doc["baseline"] = snapshot
        new_doc.setdefault("baselines", {})[baseline_id] = snapshot
        _blank_artifacts(new_doc)
        self._swap(scene_id, doc, new_doc)
        return self.document(scene_id)

    # -- packing -------------------------------------------------------------
    def create_packing(self, scene_id: str, expected_revision: int) -> dict:
        doc = self._require(scene_id)
        scene = self._scene_of(doc)
        if scene["scene_revision"] != expected_revision:
            raise ServiceError(409, "version_conflict", "scene revision is stale")
        self._validate(scene, for_planning=True)
        result = self._compute(self._packing, copy.deepcopy(scene))
        if result.get("scene_id") != scene_id or result.get("scene_revision") != expected_revision:
            raise ServiceError(500, "algorithm_error", "packing result mismatch")
        new_doc = copy.deepcopy(doc)
        new_doc["packing_result"] = result
        self._swap(scene_id, doc, new_doc)
        return self.document(scene_id)

    def apply_packing(self, scene_id: str, expected_revision: int) -> dict:
        doc = self._require(scene_id)
        scene = self._scene_of(doc)
        if scene["scene_revision"] != expected_revision:
            raise ServiceError(409, "version_conflict", "scene revision is stale")
        proposal = doc.get("packing_result")
        if proposal is None or proposal.get("scene_revision") != expected_revision:
            raise ServiceError(409, "no_proposal", "no current packing proposal")
        if proposal.get("scene_id") != scene_id:
            raise ServiceError(409, "no_proposal", "packing proposal mismatch")
        if proposal.get("status") not in ("success", "partial"):
            raise ServiceError(409, "no_proposal", "packing proposal not applicable")

        by_id = {i["item_id"]: i for i in proposal.get("items", [])}
        current_ids = {i["id"] for i in scene["items"]}
        if set(by_id) != current_ids:
            raise ServiceError(409, "no_proposal", "item set changed")

        updated = copy.deepcopy(scene)
        for item in updated["items"]:
            p = by_id[item["id"]]
            item["position"] = list(p["target_pos"])
            item["rotation_y_rad"] = float(p["target_rotation_y_rad"])
        updated["scene_revision"] = scene["scene_revision"] + 1

        check = self._compute(self._validate_layout, copy.deepcopy(updated))
        if not check.get("geometry_valid"):
            raise ServiceError(409, "invalid_layout", "packing result does not validate")

        new_doc = copy.deepcopy(doc)
        history = list(new_doc.get("packing_history") or [])
        history.append({"scene_revision": expected_revision, "result": proposal})
        new_doc["packing_history"] = history
        new_doc["scene"] = updated
        _blank_artifacts(new_doc)
        new_doc["packing_history"] = history
        self._swap(scene_id, doc, new_doc)
        return self.document(scene_id)

    # -- routing -------------------------------------------------------------
    def create_routing(self, scene_id: str, expected_revision: int) -> dict:
        doc = self._require(scene_id)
        scene = self._scene_of(doc)
        if scene["scene_revision"] != expected_revision:
            raise ServiceError(409, "version_conflict", "scene revision is stale")
        baseline = doc.get("baseline")
        if not baseline or scene.get("baseline_id") != baseline.get("baseline_id"):
            raise ServiceError(400, "invalid_input", "confirm a baseline before routing")
        if not all(i.get("dimensions_confirmed") for i in scene["items"]):
            raise ServiceError(400, "invalid_input", "dimensions not confirmed")
        if not all(
            p.get("confirmed")
            for i in scene["items"]
            for p in i.get("ports", [])
        ):
            raise ServiceError(400, "invalid_input", "ports not confirmed")
        self._validate(scene, for_planning=True)
        check = self._compute(self._validate_layout, copy.deepcopy(scene))
        if not check.get("geometry_valid"):
            raise ServiceError(400, "invalid_layout", "layout geometry invalid")
        result = self._compute(self._routing, copy.deepcopy(scene))
        if result.get("scene_id") != scene_id or result.get("scene_revision") != expected_revision:
            raise ServiceError(500, "algorithm_error", "routing result mismatch")
        route_ids = [value["id"] for value in result["cables"]]
        if len(route_ids) != len(set(route_ids)) or set(route_ids) != {c["id"] for c in scene["cables"]}:
            raise ServiceError(500, "algorithm_error", "routing result coverage mismatch")
        new_doc = copy.deepcopy(doc)
        new_doc["routing_result"] = result
        new_doc["comparison"] = None
        new_doc["guide"] = None
        new_doc["guide_md"] = None
        self._swap(scene_id, doc, new_doc)
        return self.document(scene_id)

    # -- guide ---------------------------------------------------------------
    def create_guide(self, scene_id: str, expected_revision: int) -> dict:
        doc = self._require(scene_id)
        scene = self._scene_of(doc)
        if scene["scene_revision"] != expected_revision:
            raise ServiceError(409, "version_conflict", "scene revision is stale")
        baseline = doc.get("baseline")
        if not baseline:
            raise ServiceError(400, "invalid_input", "baseline required for guide")

        check = self._compute(self._validate_layout, copy.deepcopy(scene))
        current_free = float(self._compute(self._free_area, copy.deepcopy(scene)))
        baseline_free = float(self._compute(self._free_area, copy.deepcopy(baseline)))

        routing = doc.get("routing_result")
        routing_ok = routing is not None and routing.get("scene_revision") == expected_revision
        routes = routing.get("cables", []) if routing_ok else []
        valid_routes = [c for c in routes if c.get("status") == "valid"]

        requested = scene.get("cables", [])
        requested_ids = {c["id"] for c in requested}
        valid_ids = {c["id"] for c in valid_routes}

        comparison = _build_comparison(
            scene, baseline, check, current_free, baseline_free, routing, valid_routes
        )
        markdown, status = _build_guide(
            scene, baseline, valid_routes, comparison, check, requested_ids, valid_ids
        )
        guide = {
            "markdown": markdown,
            "status": status,
            "scene_id": scene_id,
            "scene_revision": scene["scene_revision"],
            "baseline_id": baseline.get("baseline_id"),
        }
        new_doc = copy.deepcopy(doc)
        new_doc["comparison"] = comparison
        new_doc["guide"] = guide
        new_doc["guide_md"] = markdown
        self._swap(scene_id, doc, new_doc)
        return self.document(scene_id)

    def get_guide_markdown(self, scene_id: str, expected_revision: int | None = None) -> str:
        doc = self._require(scene_id)
        scene = self._scene_of(doc)
        if expected_revision is not None and scene["scene_revision"] != expected_revision:
            raise ServiceError(409, "version_conflict", "guide version is stale")
        guide = doc.get("guide")
        if (
            guide is None
            or doc.get("guide_md") is None
            or guide.get("scene_revision") != scene["scene_revision"]
        ):
            raise ServiceError(409, "no_guide", "no current guide")
        return doc["guide_md"]

    # -- photos --------------------------------------------------------------
    def set_photo_url(self, scene_id: str, expected_revision: int, url: str) -> dict:
        doc = self._require(scene_id)
        scene = self._scene_of(doc)
        if scene["scene_revision"] != expected_revision:
            raise ServiceError(409, "version_conflict", "scene revision is stale")
        new_doc = copy.deepcopy(doc)
        new_doc["scene"]["photo_url"] = url
        try:
            self._store.compare_and_swap(
                scene_id, expected_revision, new_doc, base_document=doc
            )
        except StoreConflict as error:
            raise ServiceError(409, "version_conflict", "stale document") from error
        return self.document(scene_id)

# -- module helpers ----------------------------------------------------------
def _current(doc: dict, key: str, scene: dict):
    value = doc.get(key)
    if value is None:
        return None
    if value.get("scene_revision") != scene["scene_revision"]:
        return None
    return value


def _vector_changed(a, b) -> bool:
    if a is None or b is None or len(a) != len(b):
        return True
    return any(abs(float(x) - float(y)) > 1e-9 for x, y in zip(a, b))


def _build_comparison(scene, baseline, check, current_free, baseline_free,
                      routing, valid_routes) -> dict:
    issues: list[dict] = list(check.get("issues", []))
    note_parts: list[str] = []

    if routing is None or routing.get("scene_revision") != scene["scene_revision"]:
        note_parts.append("routing result missing for current revision")
        current_exposed = None
        baseline_exposed = None
        for cable in scene.get("cables", []):
            issues.append({
                "entity_id": cable["id"],
                "code": "invalid_input",
                "message": "尚未完成当前版本的走线校验",
            })
    else:
        metrics = routing.get("metrics", {}) or {}
        current_exposed = metrics.get("exposed_length_m")
        baseline_exposed = None
        requested = {c["id"] for c in scene.get("cables", [])}
        produced = {c["id"] for c in routing.get("cables", [])}
        for missing in sorted(requested - produced):
            issues.append({
                "entity_id": missing,
                    "code": "no_path",
                "message": "no route produced for requested cable",
            })
        for cable in routing.get("cables", []):
            if cable.get("status") != "valid":
                issues.append({
                    "entity_id": cable["id"],
                    "code": cable.get("reason_code") or "no_path",
                    "message": "route failed",
                })
        if routing.get("metrics", {}).get("exposed_length_m") is None:
            note_parts.append("some cable routes failed")

    def item_dimensions(value):
        return {i["id"]: (i["size_m"], i["dimensions_confirmed"]) for i in value["items"]}
    comparable = (item_dimensions(baseline) == item_dimensions(scene)
                  and baseline["desk"] == scene["desk"]
                  and baseline["reserved_zones"] == scene["reserved_zones"])
    if not comparable:
        note_parts.append("物品集合、尺寸、桌面或保留区域变化，面积不可直接比较")
    def cable_signature(value):
        fields = ("start_port_id", "end_port_id", "cable_type", "thickness",
                  "diameter_m", "min_bend_radius_m", "length_m", "slack_m")
        return {c["id"]: tuple(c[k] for k in fields) for c in value["cables"]}
    cable_comparable = (cable_signature(baseline) == cable_signature(scene)
                        and baseline["exposure_zones"] == scene["exposure_zones"])
    if not scene["cables"]:
        current_exposed = 0.0
    elif {c["id"] for c in valid_routes} != {c["id"] for c in scene["cables"]}:
        current_exposed = None
    if cable_comparable and all("baseline_path_points" in c for c in baseline["cables"]):
        boxes = [aabb_from_zone(zone) for zone in baseline["exposure_zones"]]
        baseline_exposed = sum(exposed_polyline_length([point(p) for p in c["baseline_path_points"]], boxes)
                               for c in baseline["cables"])
    elif not cable_comparable:
        note_parts.append("连接、线材参数或暴露区域变化，线长不可直接比较")
    else:
        note_parts.append("原始线缆路径未知，原始暴露线长未知")
    if routing and routing.get("scene_revision") == scene["scene_revision"]:
        issues.extend(routing.get("issues", []))
    issues = list({(i.get("entity_id"), i.get("code")): i for i in issues}.values())
    unresolved_keys = {(i.get("entity_id"), i.get("code")) for i in issues}

    return {
        "schema_version": "1.0",
        "scene_id": scene.get("scene_id"),
        "scene_revision": scene.get("scene_revision"),
        "baseline_id": baseline.get("baseline_id") if isinstance(baseline, dict) else None,
        "area_grid_cell_m": 0.01,
        "baseline_free_area_m2": baseline_free if comparable else None,
        "current_free_area_m2": current_free,
        "baseline_exposed_length_m": baseline_exposed,
        "current_exposed_length_m": current_exposed,
        "issues": issues,
        "unresolved_issue_count": len(unresolved_keys),
        "comparison_note": "; ".join(note_parts) if note_parts else None,
    }


def _build_guide(scene, baseline, valid_routes, comparison, check, requested_ids, valid_ids):
    lines: list[str] = []
    complete = bool(check.get("geometry_valid")) and requested_ids == valid_ids and not comparison["issues"]
    lines.append("# 宿舍整理执行指南")
    lines.append("")
    lines.append(f"- 场景：{scene['scene_id']} · 版本：{scene['scene_revision']}")
    lines.append(f"- 原始快照：{baseline['baseline_id']}")
    lines.append(f"- 状态：{'已完成' if complete else '未完成'}")
    lines.append("")
    lines.append("## 物品移动（从原始位置到当前摆放）")
    baseline_items = {i["id"]: i for i in baseline.get("items", [])}
    move_count = 0
    for item in scene.get("items", []):
        old = baseline_items.get(item["id"])
        if old is None:
            continue
        if _vector_changed(old.get("position"), item.get("position")) or abs(
            float(old.get("rotation_y_rad", 0)) - float(item.get("rotation_y_rad", 0))
        ) > 1e-9:
            move_count += 1
            lines.append(f"- {item['name']}（{item['id']}）：{old['position']} → {item['position']} 米；朝向 {old['rotation_y_rad']} → {item['rotation_y_rad']} 弧度")
    if move_count == 0:
        lines.append("- 没有物品移动。")
    lines.append("")
    lines.append("## 已通过校验的接线与固定步骤")
    if not valid_routes:
        lines.append("- 当前没有可执行的有效走线路径。")
    for cable in valid_routes:
        check_data = cable.get("support_check") or {}
        support_ids = check_data.get("support_ids", []) if isinstance(check_data, dict) else []
        length = cable.get("path_length_m")
        lines.append(
            f"- {cable['id']}: {cable.get('start_port_id')} -> {cable.get('end_port_id')} "
            f"路径长度 {length:.4f} 米；策略 {cable.get('mode', '未知')}；固定点 {support_ids}"
        )
    lines.append("")
    lines.append("## 未解决事项")
    issues = comparison.get("issues", [])
    if not issues:
        lines.append("- 无。")
    for issue in issues:
        lines.append(
            f"- {issue.get('entity_id')}: {issue.get('code')} - {issue.get('message')}"
        )
    lines.append("")

    lines.extend(["", "## 比较指标", f"- 面积网格：{comparison['area_grid_cell_m']} 米",
                  f"- 原始/当前连续可用面积：{comparison['baseline_free_area_m2']} / {comparison['current_free_area_m2']} 平方米",
                  f"- 原始/当前暴露线长：{comparison['baseline_exposed_length_m']} / {comparison['current_exposed_length_m']} 米",
                  f"- 说明：{comparison['comparison_note'] or '相同口径比较'}",
                  "- 未知值不代表零；当前外观为简化模型，实际尺寸和固定位置需现场核对。"])
    lines = [line.replace('None', '未知') for line in lines]
    return "\n".join(lines), "complete" if complete else "incomplete"
