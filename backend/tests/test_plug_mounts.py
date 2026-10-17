import copy
import math
import unittest

from backend.app.domain.errors import SceneInputError
from backend.app.domain.geometry import local_to_world, rotate_y
from backend.app.domain.packing import plan_packing, validate_layout
from backend.app.domain.routing import RoutingInputError, plan_routing
from backend.app.domain.rules import validate_scene
from backend.examples.packing_demo import (
    cable,
    demo_scene,
    item,
    port,
    preview_scene,
    region,
)


def plug_scene():
    scene = demo_scene()
    strip = item(
        "strip",
        "power_strip",
        (0.36, 0.035, 0.075),
        (0.5, 0.77, 0.3),
        ["desktop"],
        fixed=True,
    )
    strip["socket_count"] = 4
    strip["ports"] = [
        port(f"socket_{index}", "power_source", (x, 0.035, 0), (0, 1, 0))
        for index, x in enumerate((-0.12, -0.04, 0.04, 0.12))
    ]
    strip["ports"].append(port("strip_bus", "power_sink", (0.18, 0.0175, 0), (1, 0, 0)))
    adapter = item(
        "adapter",
        "power_adapter",
        (0.09, 0.07, 0.055),
        (0.38, 0.805, 0.3),
        [],
        fixed=True,
    )
    adapter["ports"] = [
        port("adapter_plug", "power_sink", (0, 0, 0), (0, -1, 0)),
        port("adapter_usb", "usb", (0.045, 0.035, 0), (1, 0, 0)),
    ]
    adapter["plug_mount"] = {
        "socket_port_id": "socket_0",
        "plug_port_id": "adapter_plug",
    }
    scene.update(
        items=[strip, adapter],
        regions=[region("desktop", (0, 1.45, 0, 0.6))],
        obstacles=[],
        reserved_zones=[],
        exposure_zones=[],
        cables=[],
        routing_graph={"nodes": [], "edges": []},
    )
    return scene


class PlugMountTests(unittest.TestCase):
    def test_fixed_direct_plug_is_supported_without_a_flexible_cable(self):
        scene = plug_scene()
        before = copy.deepcopy(scene)
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        packing = plan_packing(scene)
        self.assertEqual(packing["status"], "success")
        adapter = next(
            value for value in packing["items"] if value["item_id"] == "adapter"
        )
        self.assertEqual(adapter["placement_status"], "unchanged")
        self.assertIsNone(adapter["target_region_id"])
        routing = plan_routing(scene)
        self.assertEqual(routing["status"], "success")
        self.assertEqual(routing["cables"], [])
        self.assertEqual(scene, before)

    def test_world_alignment_uses_each_items_rotation_and_local_anchor(self):
        scene = plug_scene()
        strip, adapter = scene["items"]
        strip["rotation_y_rad"] = adapter["rotation_y_rad"] = math.pi / 2
        adapter["ports"][0]["local_position"] = [0.01, 0, 0.005]
        socket_world = local_to_world(strip, strip["ports"][0]["local_position"])
        offset = rotate_y(
            tuple(adapter["ports"][0]["local_position"]), adapter["rotation_y_rad"]
        )
        adapter["position"] = [a - b for a, b in zip(socket_world, offset)]
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        self.assertEqual(plan_routing(scene)["status"], "success")
        adapter["rotation_y_rad"] = 0
        check = validate_layout(scene)
        self.assertFalse(check["geometry_valid"])
        self.assertTrue(
            any("endpoints" in issue["message"] for issue in check["issues"])
        )
        with self.assertRaises(RoutingInputError):
            plan_routing(scene)

    def test_misaligned_or_wrong_direction_mount_is_not_valid(self):
        mutations = [
            lambda value: value["position"].__setitem__(0, value["position"][0] + 0.01),
            lambda value: value["ports"][0].update(local_direction=[0, 1, 0]),
            lambda value: value["ports"][0].update(local_direction=[1, 0, 0]),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                scene = plug_scene()
                mutate(scene["items"][1])
                check = validate_layout(scene)
                self.assertFalse(check["geometry_valid"])
                self.assertTrue(
                    any(
                        issue["entity_id"] == "adapter"
                        and issue["code"] == "invalid_input"
                        for issue in check["issues"]
                    )
                )
                with self.assertRaises(RoutingInputError):
                    plan_routing(scene)

    def test_submillimetre_body_penetration_is_still_collision(self):
        scene = plug_scene()
        scene["items"][1]["position"][1] -= 0.0005
        check = validate_layout(scene)
        self.assertFalse(check["geometry_valid"])
        self.assertTrue(
            any(
                issue["entity_id"] == "adapter" and issue["code"] == "collision"
                for issue in check["issues"]
            )
        )
        with self.assertRaises(RoutingInputError):
            plan_routing(scene)

    def test_small_overhang_is_allowed_but_large_or_poor_support_is_not(self):
        scene = plug_scene()
        strip, adapter = scene["items"]
        strip["ports"][0]["local_position"][0] = -0.15
        adapter["position"][0] = 0.35
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        strip["ports"][0]["local_position"][0] = -0.17
        adapter["position"][0] = 0.33
        self.assertFalse(validate_layout(scene)["geometry_valid"])
        with self.assertRaises(RoutingInputError):
            plan_routing(scene)
        scene = plug_scene()
        strip, adapter = scene["items"]
        strip["size_m"][0] = 0.02
        strip["ports"][0]["local_position"][0] = 0
        adapter["position"][0] = strip["position"][0]
        adapter["size_m"][0] = 0.06
        check = validate_layout(scene)
        self.assertFalse(check["geometry_valid"])
        self.assertTrue(
            any("half its base" in issue["message"] for issue in check["issues"])
        )

    def test_adapter_body_keeps_neighbor_item_collisions(self):
        scene = plug_scene()
        scene["items"].append(
            item(
                "neighbor", "box", (0.04, 0.1, 0.04), (0.41, 0.805, 0.3), [], fixed=True
            )
        )
        check = validate_layout(scene)
        self.assertFalse(check["geometry_valid"])
        self.assertTrue(
            any(
                issue["entity_id"] == "adapter" and issue["code"] == "collision"
                for issue in check["issues"]
            )
        )
        with self.assertRaises(RoutingInputError):
            plan_routing(scene)

    def test_mount_inherits_strip_region_clearance_without_a_roof_obstacle(self):
        scene = plug_scene()
        scene["regions"][0]["clearance_height_m"] = 0.1
        self.assertEqual(scene["obstacles"], [])
        check = validate_layout(scene)
        self.assertFalse(check["geometry_valid"])
        self.assertTrue(
            any(
                issue["entity_id"] == "adapter"
                and "support region clearance" in issue["message"]
                for issue in check["issues"]
            )
        )
        with self.assertRaises(RoutingInputError):
            plan_routing(scene)
        scene["regions"][0]["clearance_height_m"] = 0.105
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        self.assertEqual(plan_routing(scene)["status"], "success")

    def test_packing_can_repair_movable_item_overlapping_a_fixed_adapter(self):
        scene = plug_scene()
        scene["items"].append(
            item("movable", "box", (0.04, 0.1, 0.04), (0.41, 0.805, 0.3), ["desktop"])
        )
        self.assertFalse(validate_layout(scene)["geometry_valid"])
        with self.assertRaises(RoutingInputError):
            plan_routing(scene)
        result = plan_packing(scene)
        self.assertEqual(result["status"], "success")
        applied = preview_scene(scene, result)
        self.assertTrue(validate_layout(applied)["geometry_valid"])
        self.assertEqual(plan_routing(applied)["status"], "success")

    def test_mount_occupies_socket_and_plug_against_all_flexible_references(self):
        scene = plug_scene()
        sink = item(
            "sink",
            "device",
            (0.05, 0.1, 0.05),
            (0.9, 0.77, 0.3),
            ["desktop"],
            fixed=True,
        )
        sink["ports"] = [port("sink_port", "power_sink", (-0.025, 0.05, 0), (-1, 0, 0))]
        scene["items"].append(sink)
        scene["cables"] = [
            cable("duplicate_socket_1", "socket_0", "sink_port", "power"),
            cable("duplicate_socket_2", "socket_0", "adapter_plug", "power"),
        ]
        result = plan_routing(scene)
        self.assertEqual(
            [route["reason_code"] for route in result["cables"]],
            ["port_occupied", "port_occupied"],
        )
        self.assertTrue(
            all(route["curve_segments"] == [] for route in result["cables"])
        )
        self.assertEqual(scene["items"][1]["plug_mount"]["socket_port_id"], "socket_0")

    def test_wide_adapter_blocks_neighbor_socket_leadout(self):
        scene = plug_scene()
        strip, adapter = scene["items"]
        strip["ports"][0]["local_position"][0] = -0.08
        adapter["position"][0] = 0.42
        adapter["size_m"][0] = 0.17
        sink = item(
            "sink",
            "device",
            (0.05, 0.1, 0.05),
            (0.9, 0.77, 0.3),
            ["desktop"],
            fixed=True,
        )
        sink["ports"] = [port("sink_port", "power_sink", (-0.025, 0.05, 0), (-1, 0, 0))]
        scene["items"].append(sink)
        scene["routing_graph"] = {
            "nodes": [
                {"id": "up", "position": [0.5, 0.95, 0.3], "kind": "corner"},
                {"id": "across", "position": [0.7, 0.95, 0.3], "kind": "slot"},
            ],
            "edges": [
                {
                    "id": "channel",
                    "from_node_id": "up",
                    "to_node_id": "across",
                    "modes": ["slot"],
                    "clearance_radius_m": 0.05,
                    "exposed": False,
                }
            ],
        }
        scene["cables"] = [cable("neighbor_cable", "socket_1", "sink_port", "power")]
        self.assertTrue(validate_layout(scene)["geometry_valid"])
        route = plan_routing(scene)["cables"][0]
        self.assertEqual(route["reason_code"], "endpoint_blocked")
        self.assertEqual(route["path_points"], [])

    def test_mount_requires_a_legal_support_region_under_its_strip(self):
        scene = plug_scene()
        scene["regions"][0]["bounds_xz_m"] = [0.8, 1.45, 0, 0.6]
        check = validate_layout(scene)
        self.assertFalse(check["geometry_valid"])
        self.assertTrue(
            any(
                issue["entity_id"] == "adapter"
                and "strip has no legal support region" in issue["message"]
                for issue in check["issues"]
            )
        )
        with self.assertRaisesRegex(
            RoutingInputError, "strip has no legal support region"
        ):
            plan_routing(scene)

    def test_structural_reference_and_confirmation_errors_are_rejected(self):
        mutations = [
            lambda scene: scene["items"][1]["plug_mount"].update(
                socket_port_id="missing"
            ),
            lambda scene: scene["items"][1]["plug_mount"].update(
                plug_port_id="strip_bus"
            ),
            lambda scene: scene["items"][1].update(category="box"),
            lambda scene: scene["items"][1].update(fixed=False),
            lambda scene: scene["items"][0].update(fixed=False),
            lambda scene: scene["items"][0]["ports"][0].update(confirmed=False),
            lambda scene: scene["items"][1]["ports"][0].update(confirmed=False),
            lambda scene: scene["items"][1].update(dimensions_confirmed=False),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                scene = plug_scene()
                mutate(scene)
                with self.assertRaises(SceneInputError):
                    validate_layout(scene)
                with self.assertRaises(RoutingInputError):
                    plan_routing(scene)

    def test_duplicate_mount_reference_is_rejected(self):
        scene = plug_scene()
        other = copy.deepcopy(scene["items"][1])
        other["id"] = "adapter_2"
        for value in other["ports"]:
            value["id"] += "_2"
        other["plug_mount"]["plug_port_id"] = "adapter_plug_2"
        scene["items"].append(other)
        with self.assertRaisesRegex(SceneInputError, "already mounted"):
            validate_layout(scene)

    def test_priority_is_optional_strict_and_does_not_modify_legacy_input(self):
        scene = plug_scene()
        before = copy.deepcopy(scene)
        validate_scene(scene)
        self.assertEqual(scene, before)
        for value in (0, 1, 100):
            scene["items"][1]["placement_priority"] = value
            validate_scene(scene)
        for value in (-1, 101, 0.0, True, "1", None):
            with self.subTest(priority=value):
                scene["items"][1]["placement_priority"] = value
                with self.assertRaises(SceneInputError) as caught:
                    validate_scene(scene)
                self.assertTrue(caught.exception.field.endswith("placement_priority"))


if __name__ == "__main__":
    unittest.main()
